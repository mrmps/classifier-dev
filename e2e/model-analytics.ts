import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { Database } from "bun:sqlite";
import worker, { type Env } from "../src/index";
import { accountClassification } from "../src/http/classification";

// Failure cases: SDK aliases hide model versions; quota failures disappear;
// sampled rows skew shares; old/missing tokens look like zero; 4xx dilute latency;
// hourly GPUs look free; unavailable queries look empty; private inputs leak;
// unknown TypeSafe and explicit non-Jev successes skew the Jev fallback alert.
// Retired models or image payloads could reach a provider or reserve credits.
const baseline = process.argv.includes("--baseline");
const serve = process.argv.includes("--serve");
const db = new Database(":memory:");
db.exec(`CREATE TABLE classifier_events (timestamp INTEGER, _sample_interval REAL DEFAULT 1, index1 TEXT,
  ${Array.from({length: 20}, (_, i) => `blob${i+1} TEXT DEFAULT ''`).join(",")},
  ${Array.from({length: 20}, (_, i) => `double${i+1} REAL DEFAULT 0`).join(",")})`);
db.exec("CREATE TABLE classifier_chat_events AS SELECT * FROM classifier_events WHERE 0");
const events: unknown[] = [];
let quota = false, down = false, noTokens = false, failQuery = false;
let providerCalls = 0;
let reservationAttempts = 0;
const pending: Promise<unknown>[] = [];
const store = new Map<string, string>();
const env = {
  TYPESAFE_API_KEY: "fixture",
  ADMIN_PASSWORD: "analytics-fixture", ADMIN_SIGNING_KEY: "fixture", REPORT_KEY: "report-fixture", PRIVACY_SALT: "fixture",
  STATS: { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => { store.set(k, v); } },
  LIMITER: { idFromName: (s: string) => s, get: () => ({ fetch: async () => Response.json({ limited: quota, remaining: 99, resetIn: 60 }) }) },
  AE: { writeDataPoint(event: {blobs: string[]; doubles: number[]; indexes: string[]}) {
    events.push(event);
    const cols = ["timestamp", "index1", ...event.blobs.map((_, i) => `blob${i+1}`), ...event.doubles.map((_, i) => `double${i+1}`)];
    db.query(`INSERT INTO classifier_events (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(Math.floor(Date.now()/1000), event.indexes[0], ...event.blobs, ...event.doubles);
  } },
} as unknown as Env;
const originalFetch = globalThis.fetch;
const paidEnv = { ...env, SPENDING_ENABLED: "true", APP_ACCOUNTS_ENABLED: "true",
  APP_DB: { prepare() { reservationAttempts++; throw new Error("Unexpected reservation"); } } } as unknown as Env;
globalThis.fetch = (async (url, init) => {
  if (String(url).includes("api.cloudflare.com")) {
    if (failQuery && String(init?.body).includes("blob11")) return new Response("fixture outage", {status: 503});
    const sql = String(init?.body)
      .replace(/toStartOfInterval\(timestamp, INTERVAL '(\d+)' (HOUR|DAY)\)/g, (_, n, unit) => `datetime((timestamp / ${Number(n)*(unit === 'DAY' ? 86400 : 3600)}) * ${Number(n)*(unit === 'DAY' ? 86400 : 3600)}, 'unixepoch')`)
      .replace(/toDateTime\(now\(\)\) - INTERVAL '(\d+)' HOUR/g, (_, n) => `(unixepoch() - ${Number(n)*3600})`)
      .replace(/toDateTime\(now\(\)\) - INTERVAL '(\d+)' MINUTE/g, (_, n) => `(unixepoch() - ${Number(n)*60})`);
    return Response.json({data: db.query(sql).all()});
  }
  if (String(url).startsWith("http://127.0.0.1")) return originalFetch(url, init);
  if (String(url).endsWith("/v1/models")) return Response.json({models:[]});
  providerCalls++;
  if (down) return Response.json({error: "fixture outage"}, {status: 503});
  const body = JSON.parse(String(init?.body));
  if (!body.questions) return Response.json({error: "invalid"}, {status: 400});
  return Response.json({model: "jev-1.13.0", answers: {red: {type:"noul", noul:0.98}},
    usage: noTokens ? {} : {input_tokens: 42, output_tokens: 0}});
}) as typeof fetch;
const server = Bun.serve({hostname:"127.0.0.1", port: serve ? 4319 : 0, async fetch(req) {
  const url = new URL(req.url);
  if (url.pathname.startsWith("/admin-assets/")) return new Response(Bun.file(`public${url.pathname}`));
  if (url.pathname === "/preview") return new Response(Bun.file(`captures/models-${baseline ? "before" : "after"}.html`));
  if (req.headers.get("authorization")?.startsWith("Bearer classifier_agent_"))
    return (await accountClassification(req, paidEnv, "API", {waitUntil(p: Promise<unknown>) { pending.push(p); }} as ExecutionContext))!;
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
  const retired = await post({model:"dgemma", state:"PRIVATE INPUT", questions});
  assert.equal(retired.status, 400);
  assert.equal((await retired.json()).code, "bad_model");
  const unsupportedImage = await post({state:"PRIVATE INPUT", images:[image], questions});
  assert.equal(unsupportedImage.status, 400);
  assert.equal((await unsupportedImage.json()).code, "images_unsupported");
  for (const body of [{model:"dgemma", state:"PRIVATE INPUT", questions}, {state:"PRIVATE INPUT", images:[image], questions}]) {
    const paid = await originalFetch(`${origin}/v1/systemone`, {method:"POST", headers:{"content-type":"application/json", authorization:"Bearer classifier_agent_fixture"}, body:JSON.stringify(body)});
    assert.equal(paid.status, 400);
  }
  assert.equal(reservationAttempts, 0);
  noTokens = true;
  assert.equal((await post({questions})).status, 200);
  noTokens = false;
  down = true;
  assert.equal((await post({questions})).status, 503);
  down = false;
  quota = true;
  assert.equal((await post({questions})).status, 429);
  quota = false;
  assert.equal((await post({model:"PRIVATE MODEL", state:"PRIVATE INPUT"})).status, 400);
  db.exec(`INSERT INTO classifier_events(timestamp,index1,blob4,blob6,double1,double2,_sample_interval) VALUES(unixepoch(),'old','200','legacy-model',2,100,10)`);
  db.exec("INSERT INTO classifier_events(timestamp,index1,blob4,blob6,blob10,blob11,double1,double2,double13,double14,_sample_interval) VALUES(unixepoch(),'historic-image','200','dgemma','image','dgemma',1,100,1,1,1)");
  const login = await originalFetch(`${origin}/admin`, {method:"POST", redirect:"manual", headers:{origin,"content-type":"application/x-www-form-urlencoded"}, body:"password=analytics-fixture"});
  assert.equal(login.status, 302);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const {html, data} = await admin(cookie);
  const developers = await (await originalFetch(`${origin}/developers`)).text();
  const docs = await (await originalFetch(origin)).text();
  await mkdir("captures", {recursive:true});
  await writeFile(`captures/models-${baseline ? "before" : "after"}.html`, html);
  if (!baseline) {
    assert.deepEqual(data.unavailable, []);
    assert.equal(events.length, 7);
    assert.equal(providerCalls, 4);
    assert.match(docs, /IMAGE CLASSIFICATION/);
    assert.doesNotMatch(developers, /dgemma/i);
    assert.doesNotMatch(docs, /dgemma|data:image\/png;base64/i);
    const openapi = await (await originalFetch(`${origin}/openapi.json`)).text();
    assert.doesNotMatch(openapi, /dgemma|DiffusionGemma/);
    assert.equal(data.dimensionTraffic.length, 0);
    assert.doesNotMatch(JSON.stringify(events), /PRIVATE|203\.0\.113\.123|aGVsbG8/);
    const jev = data.byModel.find((r: any) => r.model === "jev-1.13.0");
    assert.equal(jev.requests, 2);
    assert.equal(jev.input_tokens, 42);
    assert.equal(jev.token_requests, 1);
    const unknown = data.byModel.find((r: any) => r.model === "Unknown model (TypeSafe route)");
    assert.equal(unknown.requests, 4);
    assert.equal(data.byModel.find((r: any) => r.model === "imajev-4b").requests, 1);
    assert.equal(unknown.provider, "Not recorded");
    assert.ok(data.modelSeries.some((r: any) => r.model === unknown.model));
    assert.ok(data.modelFailures.some((r: any) => r.model === unknown.model && r.reason === "typesafe_503"));
    assert.ok(!data.byModel.some((r: any) => r.model === "typesafe"));
    const historicImage = data.byModel.find((r: any) => r.model === "dgemma");
    assert.equal(historicImage.requests, 1);
    assert.equal(historicImage.provider, "RunPod");
    assert.equal(historicImage.cost_basis, "Hourly GPU excluded");
    const legacy = data.byModel.find((r: any) => r.model === "legacy-model");
    assert.equal(legacy.requests, 10);
    assert.equal(legacy.classifications, 20);
    assert.equal(legacy.input_tokens, null);
    assert.equal(legacy.image_requests, null);
    assert.equal(legacy.calls, null);
    assert.equal(data.modelSeries.reduce((s: number, r: any) => s + Number(r.requests), 0), 18);
    for (const range of ["7d", "30d"]) {
      const longer = (await admin(cookie, range)).data;
      assert.deepEqual(longer.unavailable, []);
      assert.equal(longer.byModel.find((r: any) => r.model === "dgemma").requests, 1);
    }
    failQuery = true;
    const failed = (await admin(cookie)).data;
    assert.ok(failed.unavailable.includes("byModel"));
    failQuery = false;
    await writeFile("captures/model-analytics-e2e.json", JSON.stringify({runtime:"Bun HTTP server running Worker and workspace handlers; SQLite executes aggregate SQL; deterministic provider fixtures", passed:true, events:events.length, providerCalls, reservationAttempts, data}, null, 2));
    db.exec("DELETE FROM classifier_events WHERE blob6 = 'legacy-model'");
    db.exec("INSERT INTO classifier_events(timestamp,index1,blob4,blob6,double1,double2,_sample_interval) VALUES(unixepoch(),'old-sdk','200','typesafe',1,100,10)");
    db.exec("INSERT INTO classifier_events(timestamp,index1,blob4,blob6,double1,double2,_sample_interval) VALUES(unixepoch(),'image','200','dgemma',1,100,10)");
    db.exec("INSERT INTO classifier_events(timestamp,index1,blob4,blob6,double1,double2,_sample_interval) VALUES(unixepoch(),'laya','200','jev/laya',1,100,10)");
    const alertPreview = await originalFetch(`${origin}/alerts`, {headers:{authorization:"Bearer report-fixture"}});
    assert.equal(alertPreview.status, 200);
    assert.doesNotMatch(await alertPreview.text(), /Jev is not answering/);
    db.exec("INSERT INTO classifier_events(timestamp,index1,blob4,blob6,double1,double2,_sample_interval) VALUES(unixepoch(),'backup','200','google/gemini-3.8-flash',1,100,10)");
    const fallbackPreview = await originalFetch(`${origin}/alerts`, {headers:{authorization:"Bearer report-fixture"}});
    assert.equal(fallbackPreview.status, 200);
    assert.match(await fallbackPreview.text(), /Jev is not answering/);
    console.log("PASS: HTTP classification → analytics write → authenticated dashboard; retired input refusal, historical model usage, sampling, privacy and query outage.");
  }
  if (serve) console.log(`Preview: ${origin}/preview#Cost%20%26%20models`);
} finally {
  if (!serve) { server.stop(); db.close(); globalThis.fetch = originalFetch; }
}
