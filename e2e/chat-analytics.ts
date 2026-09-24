import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { mkdir, writeFile } from "node:fs/promises";
import worker, { type Env } from "../src/index";
import { adminResponse } from "../src/admin";

const points: { indexes: string[]; blobs: string[]; doubles: number[] }[] = [];
const pending: Promise<unknown>[] = [];
const ctx = {
  waitUntil: (promise: Promise<unknown>) => pending.push(promise),
  passThroughOnException() {},
} as ExecutionContext;
let mode = "success",
  limited = false,
  calls = 0;
const db = new Database(":memory:");
for (const name of ["classifier_events", "classifier_chat_events"])
  db.exec(
    `CREATE TABLE ${name} (timestamp INTEGER, _sample_interval REAL, index1 TEXT, ${Array.from({ length: 20 }, (_, i) => `blob${i + 1} TEXT DEFAULT ''`).join(",")}, ${Array.from({ length: 20 }, (_, i) => `double${i + 1} REAL DEFAULT 0`).join(",")})`,
  );
const now = Math.floor(Date.now() / 1000);
const provider = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const body = (await req.json()) as {
      messages: { role: string; content: string }[];
    };
    calls++;
    if (mode === "failure")
      return new Response("synthetic upstream failure", { status: 503 });
    if (mode === "slow") await Bun.sleep(1000);
    const tool = body.messages.at(-1)?.role === "user";
    const delta = tool
      ? {
          tool_calls: [
            {
              index: 0,
              id: "clock",
              function: {
                name: "current_time",
                arguments:
                  mode === "tool-error" ? '{"timezone":"invalid-zone"}' : "{}",
              },
            },
          ],
        }
      : { content: "The clock answered." };
    const usage =
      mode === "unknown"
        ? ""
        : `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 10, cost: mode === "zero-cost" ? 0 : 0.002 } })}\n\n`;
    return new Response(
      `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n${usage}data: [DONE]\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    );
  },
});
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input, init) => {
  const url = String(input);
  if (url.includes("openrouter.ai")) return originalFetch(provider.url, init);
  if (url.includes("/analytics_engine/sql")) {
    const query = String(init?.body)
      .replace(
        /toStartOfInterval\(timestamp, INTERVAL '(\d+)' (HOUR|DAY)\)/g,
        (_, n, unit) =>
          `CAST(timestamp / ${Number(n) * (unit === "DAY" ? 86400 : 3600)} AS INTEGER)*${Number(n) * (unit === "DAY" ? 86400 : 3600)}`,
      )
      .replace(/toDateTime\(now\(\)\) - INTERVAL '(\d+)' HOUR/g, (_, n) =>
        String(now - Number(n) * 3600),
      );
    return Response.json({ data: db.query(query).all() });
  }
  throw new Error("Unexpected upstream");
}) as typeof fetch;
const env = {
  OPENROUTER_API_KEY: "fixture",
  PRIVACY_SALT: "private-fixture",
  ADMIN_PASSWORD: "fixture",
  ADMIN_SIGNING_KEY: "fixture",
  LIMITER: {
    idFromName: (s: string) => s,
    get: () => ({
      fetch: async () => Response.json({ limited, remaining: 10, resetIn: 60 }),
    }),
  },
  CHAT_AE: {
    writeDataPoint(point: (typeof points)[number]) {
      points.push(structuredClone(point));
      const values = [
        now,
        2,
        point.indexes[0],
        ...point.blobs,
        ...point.doubles,
      ];
      const columns = [
        "timestamp",
        "_sample_interval",
        "index1",
        ...point.blobs.map((_, i) => `blob${i + 1}`),
        ...point.doubles.map((_, i) => `double${i + 1}`),
      ];
      db.query(
        `INSERT INTO classifier_chat_events (${columns.join(",")}) VALUES (${values.map(() => "?").join(",")})`,
      ).run(...values);
    },
  },
} as unknown as Env;
const drain = async () => {
  while (pending.length) await Promise.all(pending.splice(0));
};
const send = (messages: unknown) =>
  worker.fetch(
    new Request("https://classifier.dev/v1/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.49",
      },
      body: JSON.stringify({ messages }),
    }),
    env,
    ctx,
  );
const message = [{ role: "user", content: "PRIVATE PROMPT DO NOT STORE" }];
const report: {
  scenarios: string[];
  points: typeof points;
  dashboard?: unknown;
} = { scenarios: [], points };
try {
  const response = await send(message);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /The clock answered/);
  await drain();
  assert.equal(points.length, 1);
  assert.equal(points[0].blobs[1], "completed");
  assert.deepEqual(points[0].doubles.slice(2, 8), [2, 200, 20, 0.004, 0, 0]);
  assert.equal(points[0].doubles[12], 1);
  assert.equal(points[0].doubles[14], 1);
  report.scenarios.push(
    "one event after a two-model-call tool turn; measured tokens and spend",
  );
  mode = "unknown";
  await (
    await send([...message, { role: "assistant", content: "ok" }, ...message])
  ).text();
  await drain();
  assert.deepEqual(points[1].doubles.slice(2, 8), [2, 0, 0, 0, 2, 2]);
  assert.equal(points[1].doubles[14], 0);
  report.scenarios.push(
    "missing provider accounting stays unknown; follow-ups distinguished",
  );
  mode = "failure";
  await (await send(message)).text();
  await drain();
  assert.equal(points[2].blobs[1], "failed");
  const before = calls;
  limited = true;
  assert.equal((await send(message)).status, 429);
  await drain();
  assert.equal(calls, before);
  assert.equal(points[3].blobs[1], "rate_limited");
  limited = false;
  assert.equal((await send([])).status, 400);
  await drain();
  assert.equal(points[4].blobs[1], "invalid_request");
  report.scenarios.push(
    "upstream failures, refused turns and invalid bodies counted without inference",
  );
  mode = "slow";
  const stopped = await send(message);
  await stopped.body!.cancel();
  await drain();
  assert.equal(points[5].blobs[1], "stopped");
  assert.equal(points.length, 6);
  report.scenarios.push(
    "cancelled streams finish once and retain unknown usage",
  );
  const serialized = JSON.stringify(points);
  assert.ok(!serialized.includes("PRIVATE PROMPT"));
  assert.ok(!serialized.includes("203.0.113.49"));
  assert.ok(!serialized.includes("The clock answered"));
  const login = (await adminResponse(
    new Request("https://classifier.dev/admin", {
      method: "POST",
      headers: { origin: "https://classifier.dev" },
      body: new URLSearchParams({ password: "fixture" }),
    }),
    env,
    "admin",
    "test",
  ))!;
  const cookie = login.headers.getSetCookie()[0].split(";")[0];
  const page = (await adminResponse(
    new Request("https://classifier.dev/admin", { headers: { cookie } }),
    env,
    "admin",
    "test",
  ))!;
  const html = await page.text();
  const data = JSON.parse(
    html
      .match(/data-admin="([^"]+)"/)![1]
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&"),
  ).data;
  assert.deepEqual(data.unavailable, []);
  assert.equal(data.chatCallers, 1);
  assert.equal(
    data.chatOutcomes.find(
      (r: { outcome: string }) => r.outcome === "completed",
    ).turns,
    4,
  );
  assert.equal(
    data.chatOutcomes.find(
      (r: { outcome: string }) => r.outcome === "completed",
    ).usd,
    0.008,
  );
  assert.equal(
    data.chatOutcomes.find(
      (r: { outcome: string }) => r.outcome === "completed",
    ).unknownCostCalls,
    4,
  );
  report.dashboard = data.chatOutcomes;
  report.scenarios.push(
    "authenticated dashboard queries sampling-weighted usage; no prompt or raw IP retained",
  );
  mode = "tool-error";
  await (await send(message)).text();
  await drain();
  assert.equal(points.at(-1)!.doubles[13], 1);
  assert.equal(points.at(-1)!.blobs[1], "completed");
  mode = "zero-cost";
  await (await send(message)).text();
  await drain();
  assert.equal(points.at(-1)!.doubles[5], 0);
  assert.equal(points.at(-1)!.doubles[7], 0);
  report.scenarios.push(
    "tool errors counted even when the assistant completes; measured zero cost is known",
  );
  const original = env.CHAT_AE;
  env.CHAT_AE = {
    writeDataPoint() {
      throw new Error("telemetry down");
    },
  } as AnalyticsEngineDataset;
  mode = "success";
  assert.match(await (await send(message)).text(), /The clock answered/);
  await drain();
  env.CHAT_AE = original;
  report.scenarios.push("telemetry failure never breaks chat");
} finally {
  globalThis.fetch = originalFetch;
  provider.stop(true);
  db.close();
  await mkdir("captures", { recursive: true });
  await writeFile(
    "captures/chat-analytics.json",
    JSON.stringify(report, null, 2),
  );
}
console.log(
  `${report.scenarios.length} chat analytics scenarios passed; captures/chat-analytics.json`,
);
