import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { mkdir, writeFile } from "node:fs/promises";
import worker, { type Env } from "../src/index";
import type { StatusSnapshot } from "../src/status";

// Failure modes: HTTP 200 hides failed escalation; quiet/stale traffic appears
// green; 4xx dilute reliability; sampling skews totals; a query outage looks like
// no traffic; private request content leaks; confident Smart answers imply a
// working reasoning provider; failed history buckets disappear after recovery.
const db = new Database(":memory:");
for (const name of ["classifier_events", "classifier_chat_events"])
  db.exec(`CREATE TABLE ${name}(timestamp INTEGER, _sample_interval REAL DEFAULT 1, index1 TEXT,
    ${Array.from({ length: 20 }, (_, i) => `blob${i + 1} TEXT DEFAULT ''`).join(",")},
    ${Array.from({ length: 20 }, (_, i) => `double${i + 1} REAL DEFAULT 0`).join(",")})`);
let malformedQuery = false;
let queryDown = false,
  chatQueryDown = false,
  providerDown = false,
  escalationDown = false,
  uncertain = false;
const pending: Promise<unknown>[] = [];
const store = new Map<string, string>();
const dataset = (table: string) => ({
  writeDataPoint(event: {
    indexes?: string[];
    blobs: string[];
    doubles: number[];
  }) {
    const cols = [
      "timestamp",
      "index1",
      ...event.blobs.map((_, i) => `blob${i + 1}`),
      ...event.doubles.map((_, i) => `double${i + 1}`),
    ];
    db.query(
      `INSERT INTO ${table} (${cols}) VALUES (${cols.map(() => "?")})`,
    ).run(
      Math.floor(Date.now() / 1000),
      event.indexes?.[0] ?? "",
      ...event.blobs,
      ...event.doubles,
    );
  },
});
const env = {
  TYPESAFE_API_KEY: "PRIVATE_KEY",
  OPENROUTER_API_KEY: "PRIVATE_KEY",
  PRIVACY_SALT: "fixture",
  STATS: {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => {
      store.set(k, v);
    },
  },
  LIMITER: {
    idFromName: (s: string) => s,
    get: () => ({
      fetch: async () => Response.json({ limited: false, remaining: 99 }),
    }),
  },
  AE: dataset("classifier_events"),
  CHAT_AE: dataset("classifier_chat_events"),
} as unknown as Env;
const nativeFetch = globalThis.fetch;
globalThis.fetch = (async (input, init) => {
  const url = String(input);
  if (url.includes("/analytics_engine/sql")) {
    if (
      queryDown ||
      (chatQueryDown && String(init?.body).includes("classifier_chat_events"))
    )
      return new Response("private upstream diagnostics", { status: 503 });
    const sql = String(init?.body)
      .replace(
        /toStartOfInterval\(timestamp, INTERVAL '(\d+)' (MINUTE|HOUR)\)/g,
        (_, n, unit) =>
          `datetime((timestamp / ${Number(n) * (unit === "HOUR" ? 3600 : 60)})*${Number(n) * (unit === "HOUR" ? 3600 : 60)}, 'unixepoch')`,
      )
      .replace(
        /toDateTime\(now\(\)\) - INTERVAL '(\d+)' (MINUTE|HOUR)/g,
        (_, n, unit) =>
          `(unixepoch()-${Number(n) * (unit === "HOUR" ? 3600 : 60)})`,
      );
    const data = db
      .query(sql.replace(/toDateTime\('([^']+)'\)/g, "unixepoch('$1')"))
      .all() as Record<string, unknown>[];
    if (
      malformedQuery &&
      String(init?.body).includes("FROM classifier_events") &&
      data.length
    )
      data[0]!.requests = null;
    return Response.json({ data });
  }
  if (url.includes("openrouter.ai")) {
    const body = JSON.parse(String(init?.body));
    if (body.stream)
      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Fixture reply" } }] })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    return escalationDown || providerDown
      ? Response.json({ error: { message: "fixture" } }, { status: 402 })
      : Response.json({
          choices: [{ message: { content: "A" } }],
          usage: { prompt_tokens: 10, completion_tokens: 1, cost: 0.00001 },
        });
  }
  if (url.includes("typesafe")) {
    if (providerDown)
      return Response.json({ error: "fixture" }, { status: 503 });
    const body = JSON.parse(String(init?.body)) as {
      questions: Record<string, { criteria: Record<string, unknown> }>;
    };
    const answers = Object.fromEntries(
      Object.entries(body.questions).map(([id, q]) => {
        const labels = Object.keys(q.criteria);
        return [
          id,
          {
            choice: labels[0],
            confidence: uncertain ? 0.5 : 0.99,
            probabilities: Object.fromEntries(
              labels.map((label, i) => [label, i === 0 ? 0.8 : 0.2]),
            ),
          },
        ];
      }),
    );
    return Response.json({
      model: "jev-fixture",
      answers,
      usage: { input_tokens: 10, output_tokens: 0 },
    });
  }
  return nativeFetch(input, init);
}) as typeof fetch;
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: process.argv.includes("--serve") ? 4327 : 0,
  async fetch(req) {
    const response = await worker.fetch(req, env, {
      waitUntil: (p: Promise<unknown>) => pending.push(p),
    } as ExecutionContext);
    await Promise.all(pending.splice(0));
    return response;
  },
});
const base = `http://127.0.0.1:${server.port}`;
const snapshot = async () => {
  const r = await nativeFetch(`${base}/v1/status`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("cache-control") ?? "", /no-cache/);
  return r.json() as Promise<StatusSnapshot>;
};
const classify = (tier = "fast") =>
  nativeFetch(`${base}/v1/classify`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": "203.0.113.42",
    },
    body: JSON.stringify({
      input: "PRIVATE INPUT",
      labels: ["private label a", "private label b"],
      tier,
    }),
  });
const get = (s: StatusSnapshot, id: string) =>
  s.components.find((c) => c.id === id)!;
const artifacts: Record<string, unknown> = {};
try {
  let s = await snapshot();
  assert.equal(s.status, "unknown");
  assert.equal(get(s, "api").status, "unknown");
  artifacts.empty = s;
  assert.equal((await classify()).status, 200);
  s = await snapshot();
  assert.equal(get(s, "api").status, "operational");
  assert.equal(get(s, "escalation").status, "unknown");
  malformedQuery = true;
  s = await snapshot();
  assert.equal(get(s, "api").status, "unknown");
  assert.equal(get(s, "api").requests, null);
  malformedQuery = false;
  uncertain = true;
  escalationDown = true;
  const degraded = await classify("smart");
  assert.equal(degraded.status, 200);
  assert.equal((await degraded.json()).usage.escalation_failed, 1);
  s = await snapshot();
  assert.equal(s.status, "degraded");
  assert.equal(get(s, "escalation").status, "degraded");
  assert.equal(get(s, "escalation").failed, 1);
  chatQueryDown = true;
  s = await snapshot();
  assert.equal(
    s.status,
    "degraded",
    "known escalation failures must remain visible during a chat telemetry outage",
  );
  chatQueryDown = false;
  artifacts.degraded = s;
  await mkdir("captures", { recursive: true });
  await writeFile(
    "captures/status-degraded.html",
    await (
      await nativeFetch(`${base}/status`, { headers: { accept: "text/html" } })
    ).text(),
  );
  escalationDown = false;
  assert.equal((await classify("smart")).status, 200);
  s = await snapshot();
  assert.equal(get(s, "escalation").successful, 1);
  assert.equal(
    get(s, "escalation").status,
    "degraded",
    "success must not hide recent failures",
  );
  providerDown = true;
  assert.equal((await classify()).status, 502);
  s = await snapshot();
  assert.equal(get(s, "api").status, "degraded");
  assert.equal(get(s, "api").failed, 1);
  providerDown = false;
  db.exec("UPDATE classifier_events SET _sample_interval=3");
  s = await snapshot();
  assert.equal(get(s, "api").failed, 3);
  assert.equal(get(s, "escalation").failed, 3);
  const meanBeforeRejection = get(s, "api").avg_ms;
  db.exec(
    "INSERT INTO classifier_events(timestamp,blob1,blob4,double2,_sample_interval) VALUES(unixepoch(),'fast','429',999999,100)",
  );
  s = await snapshot();
  assert.equal(get(s, "api").rejected, 100);
  assert.equal(get(s, "api").avg_ms, meanBeforeRejection);
  assert.equal(get(s, "api").successful, 9);
  const conversation = await nativeFetch(`${base}/v1/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "PRIVATE INPUT" }],
    }),
  });
  assert.equal(conversation.status, 200);
  await conversation.text();
  await Promise.all(pending.splice(0));
  s = await snapshot();
  assert.equal(get(s, "chat").successful, 1);
  assert.equal(get(s, "chat").status, "operational");
  const now = Math.floor(Date.now() / 1000);
  const oldestTimestamp = now - 86400 + 1;
  db.query(
    "INSERT INTO classifier_events(timestamp,blob1,blob4,double2) VALUES(?, 'fast', '502', 10)",
  ).run(oldestTimestamp);
  s = await snapshot();
  assert.ok(
    s.history.some(
      (bucket) =>
        new Date(bucket.at).getTime() <= oldestTimestamp * 1000 &&
        oldestTimestamp * 1000 < new Date(bucket.at).getTime() + 900000 &&
        bucket.failed > 0,
    ),
    "the oldest partial bucket must remain in the rolling 24h history",
  );
  artifacts.sampled = s;
  db.exec(
    "INSERT INTO classifier_events(timestamp,blob1,blob4,blob7,double2) VALUES(unixepoch(),'fast','429','chunklaya_busy',10)",
  );
  s = await snapshot();
  assert.equal(get(s, "api").failed, 4);
  assert.equal(get(s, "api").rejected, 100);
  assert.equal(get(s, "api").status, "degraded");
  db.exec(
    "INSERT INTO classifier_events(timestamp,blob1,blob4,double2) VALUES(unixepoch()+600,'fast','502',10)",
  );
  s = await snapshot();
  assert.equal(
    get(s, "api").failed,
    4,
    "all queries must exclude events after the common cutoff",
  );
  chatQueryDown = true;
  s = await snapshot();
  assert.ok(s.history.every((bucket) => bucket.counts_partial));
  assert.ok(
    s.history.some((bucket) => bucket.failed > 0),
    "surviving history failures stay visible",
  );
  chatQueryDown = false;
  artifacts.capacity = s;
  for (const method of ["POST", "DELETE"])
    assert.equal((await nativeFetch(`${base}/status`, { method })).status, 405);
  assert.equal(
    (await nativeFetch(`${base}/v1/status`, { method: "HEAD" })).status,
    200,
  );
  const html = await (
    await nativeFetch(`${base}/status`, { headers: { accept: "text/html" } })
  ).text();
  for (const privateValue of [
    "PRIVATE INPUT",
    "PRIVATE_KEY",
    "private label",
    "203.0.113.42",
    "private upstream diagnostics",
  ]) {
    assert.ok(!html.includes(privateValue));
    assert.ok(!JSON.stringify(s).includes(privateValue));
  }
  assert.match(html, /Smart escalation/);
  assert.match(html, /Last 24 hours/);
  assert.match(
    await (await nativeFetch(`${base}/status.md`)).text(),
    /Smart escalation/,
  );
  db.exec(
    "UPDATE classifier_events SET timestamp=timestamp-3600; UPDATE classifier_chat_events SET timestamp=timestamp-3600",
  );
  s = await snapshot();
  assert.equal(get(s, "api").status, "unknown");
  assert.ok(s.history.some((b) => b.status === "degraded"));
  artifacts.stale = s;
  queryDown = true;
  s = await snapshot();
  assert.equal(s.status, "unknown");
  assert.equal(s.unavailable.length, 4);
  assert.equal(get(s, "api").status, "unknown");
  artifacts.unavailable = s;
  await writeFile(
    "captures/status-unavailable.html",
    await (
      await nativeFetch(`${base}/status`, { headers: { accept: "text/html" } })
    ).text(),
  );
  queryDown = false;
  db.exec("DELETE FROM classifier_events");
  providerDown = true;
  assert.equal((await classify()).status, 502);
  s = await snapshot();
  assert.equal(s.status, "outage");
  assert.ok(s.history.some((bucket) => bucket.status === "outage"));
  artifacts.outage = s;
  await writeFile(
    "captures/status-outage.html",
    await (
      await nativeFetch(`${base}/status`, { headers: { accept: "text/html" } })
    ).text(),
  );
  providerDown = false;
  db.exec("DELETE FROM classifier_events");
  uncertain = false;
  await classify();
  const recovered = await snapshot();
  assert.equal(recovered.status, "operational");
  assert.equal(get(recovered, "api").failed, 0);
  artifacts.recovered = recovered;
  await writeFile(
    "captures/status-e2e.json",
    JSON.stringify(artifacts, null, 2) + "\n",
  );
  console.log(
    "Status E2E passed: actual requests, degraded HTTP 200, recovery, sampling, stale and missing telemetry, privacy, HTML/Markdown/HEAD. Artifact: captures/status-e2e.json",
  );
  if (process.argv.includes("--serve")) console.log(`Preview ${base}/status`);
} finally {
  if (!process.argv.includes("--serve")) {
    server.stop(true);
    db.close();
    globalThis.fetch = nativeFetch;
  }
}
