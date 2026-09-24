import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { Database } from "bun:sqlite";
import worker, { type Env } from "../src/index";

// Failure cases: SDK aliases hide model versions; quota failures disappear;
// sampled rows skew shares; old/missing tokens look like zero; 4xx dilute latency;
// hourly GPUs look free; unavailable queries look empty; private inputs leak.
const baseline = process.argv.includes("--baseline");
const serve = process.argv.includes("--serve");
const db = new Database(":memory:");
db.exec(`CREATE TABLE classifier_events (timestamp INTEGER, _sample_interval REAL DEFAULT 1, index1 TEXT,
  ${Array.from({length: 20}, (_, i) => `blob${i+1} TEXT DEFAULT ''`).join(",")},
  ${Array.from({length: 20}, (_, i) => `double${i+1} REAL DEFAULT 0`).join(",")})`);
db.exec("CREATE TABLE classifier_chat_events AS SELECT * FROM classifier_events WHERE 0");
const events: unknown[] = [];
let quota = false, down = false, noTokens = false, failQuery = false;
const pending: Promise<unknown>[] = [];
const store = new Map<string, string>();
const env = {
  TYPESAFE_API_KEY: "fixture", DGEMMA_ENABLED: "true", DGEMMA_URL: "https://pod.example", DGEMMA_TOKEN: "fixture",
  ADMIN_PASSWORD: "analytics-fixture", ADMIN_SIGNING_KEY: "fixture", PRIVACY_SALT: "fixture",
  STATS: { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => { store.set(k, v); } },
  LIMITER: { idFromName: (s: string) => s, get: () => ({ fetch: async () => Response.json({ limited: quota, remaining: 99, resetIn: 60 }) }) },
  AE: { writeDataPoint(event: {blobs: string[]; doubles: number[]; indexes: string[]}) {
    events.push(event);
    const cols = ["timestamp", "index1", ...event.blobs.map((_, i) => `blob${i+1}`), ...event.doubles.map((_, i) => `double${i+1}`)];
    db.query(`INSERT INTO classifier_events (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(Math.floor(Date.now()/1000), event.indexes[0], ...event.blobs, ...event.doubles);
  } },
} as unknown as Env;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (url, init) => {
  if (String(url).includes("api.cloudflare.com")) {
    if (failQuery && String(init?.body).includes("blob11")) return new Response("fixture outage", {status: 503});
    const sql = String(init?.body)
      .replace(/toStartOfInterval\(timestamp, INTERVAL '(\d+)' (HOUR|DAY)\)/g, (_, n, unit) => `datetime((timestamp / ${Number(n)*(unit === 'DAY' ? 86400 : 3600)}) * ${Number(n)*(unit === 'DAY' ? 86400 : 3600)}, 'unixepoch')`)
      .replace(/toDateTime\(now\(\)\) - INTERVAL '(\d+)' HOUR/g, (_, n) => `(unixepoch() - ${Number(n)*3600})`);
    return Response.json({data: db.query(sql).all()});
  }
  if (String(url).startsWith("http://127.0.0.1")) return originalFetch(url, init);
  if (down) return Response.json({error: "fixture outage"}, {status: 503});
  const body = JSON.parse(String(init?.body));
  if (!body.questions) return Response.json({error: "invalid"}, {status: 400});
  const pod = String(url).includes("pod.example");
  return Response.json({model: pod ? "dgemma" : "jev-1.13.0", answers: {red: {type:"noul", noul:0.98}},
    usage: noTokens ? {} : {input_tokens: pod ? 341 : 42, output_tokens: pod ? 8 : 0}});
}) as typeof fetch;
const server = Bun.serve({hostname:"127.0.0.1", port: serve ? 4319 : 0, async fetch(req) {
  const url = new URL(req.url);
  if (url.pathname.startsWith("/admin-assets/")) return new Response(Bun.file(`public${url.pathname}`));
  if (url.pathname === "/preview") return new Response(Bun.file(`captures/models-${baseline ? "before" : "after"}.html`));
  const res = await worker.fetch(req, env, {waitUntil(p: Promise<unknown>) { pending.push(p); }} as ExecutionContext);
  await Promise.all(pending.splice(0));
  return res;
}});
const origin = `http://127.0.0.1:${server.port}`;
const questions = {red:{type:"noul", instructions:"PRIVATE PROMPT"}};
const post = (body: unknown) => originalFetch(`${origin}/v1/systemone`, {method:"POST", headers:{"content-type":"application/json", "cf-connecting-ip":"203.0.113.123"}, body:JSON.stringify(body)});
const admin = async (cookie: string, range = "24h") => {
  const res = await originalFetch(`${origin}/admin?range=${range}`, {headers:{cookie}});
  const html = await res.text();
  const encoded = html.match(/data-admin="([^"]+)"/)![1].replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
  return {html, data: JSON.parse(encoded).data};
};
try {
  assert.equal((await originalFetch(`${origin}/admin`)).status, 401);
  assert.equal((await post({state:"PRIVATE INPUT", questions})).status, 200);
  const image = "data:image/png;base64,aGVsbG8=";
  assert.equal((await post({state:"PRIVATE INPUT", images:[image], questions})).status, 200);
  noTokens = true;
  assert.equal((await post({questions})).status, 200);
  noTokens = false;
  down = true;
  assert.equal((await post({model:"dgemma", questions})).status, 503);
  down = false;
  quota = true;
  assert.equal((await post({model:"dgemma", questions})).status, 429);
  quota = false;
  assert.equal((await post({model:"PRIVATE MODEL", state:"PRIVATE INPUT"})).status, 400);
  db.exec(`INSERT INTO classifier_events(timestamp,index1,blob4,blob6,double1,double2,_sample_interval) VALUES(unixepoch(),'old','200','legacy-model',2,100,10)`);
  db.exec("UPDATE classifier_events SET double2 = CASE blob4 WHEN '200' THEN 100 WHEN '503' THEN 700 ELSE 1 END WHERE blob6 = 'dgemma'");
  const login = await originalFetch(`${origin}/admin`, {method:"POST", redirect:"manual", headers:{origin,"content-type":"application/x-www-form-urlencoded"}, body:"password=analytics-fixture"});
  assert.equal(login.status, 302);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const {html, data} = await admin(cookie);
  await mkdir("captures", {recursive:true});
  await writeFile(`captures/models-${baseline ? "before" : "after"}.html`, html);
  if (!baseline) {
    assert.deepEqual(data.unavailable, []);
    assert.equal(events.length, 6);
    assert.equal(data.dimensionTraffic.length, 0);
    assert.doesNotMatch(JSON.stringify(events), /PRIVATE|203\.0\.113\.123|aGVsbG8/);
    const jev = data.byModel.find((r: any) => r.model === "jev-1.13.0");
    assert.equal(jev.requests, 2);
    assert.equal(jev.input_tokens, 42);
    assert.equal(jev.token_requests, 1);
    const pod = data.byModel.find((r: any) => r.model === "dgemma");
    assert.equal(pod.requests, 3);
    assert.equal(pod.failures, 1);
    assert.equal(pod.rejected, 1);
    assert.equal(pod.image_requests, 1);
    assert.equal(pod.images, 1);
    assert.equal(pod.avg_ms, 400);
    assert.equal(pod.provider, "RunPod");
    assert.equal(pod.cost_basis, "Hourly GPU excluded");
    const legacy = data.byModel.find((r: any) => r.model === "legacy-model");
    assert.equal(legacy.requests, 10);
    assert.equal(legacy.classifications, 20);
    assert.equal(legacy.input_tokens, null);
    assert.equal(legacy.image_requests, null);
    assert.equal(legacy.calls, null);
    assert.equal(data.modelSeries.reduce((s: number, r: any) => s + Number(r.requests), 0), 16);
    assert.ok(data.modelFailures.some((r: any) => r.model === "dgemma" && r.reason === "rate_limit"));
    for (const range of ["7d", "30d"]) {
      const longer = (await admin(cookie, range)).data;
      assert.deepEqual(longer.unavailable, []);
      assert.equal(longer.byModel.find((r: any) => r.model === "dgemma").requests, 3);
    }
    failQuery = true;
    const failed = (await admin(cookie)).data;
    assert.ok(failed.unavailable.includes("byModel"));
    failQuery = false;
    await writeFile("captures/model-analytics-e2e.json", JSON.stringify({runtime:"Bun HTTP server running Worker handlers; SQLite executes aggregate SQL; deterministic provider fixtures", passed:true, events:events.length, data}, null, 2));
    console.log("PASS: HTTP classification → analytics write → authenticated dashboard; sampling, partial tokens, privacy, errors, image usage, query outage.");
  }
  if (serve) console.log(`Preview: ${origin}/preview#Cost%20%26%20models`);
} finally {
  if (!serve) { server.stop(); db.close(); globalThis.fetch = originalFetch; }
}
