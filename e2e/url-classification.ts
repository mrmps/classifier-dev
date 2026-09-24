import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { countTokens } from "gpt-tokenizer/encoding/cl100k_base";
import { accountApi } from "../src/http/account-api";
import { AppError, parseCreditInteger, postgresDatabase } from "../src/server/db";
import { appEnvironment } from "../src/server/environment";
import { performAction } from "../src/server/agents";
import { provisionTestAccount } from "../tests/support/account";
import { RateLimiter } from "../src/limiter";
import type { Env } from "../src/index";

// Run with bun e2e/url-classification.ts. Real migrations, ledger and Worker
// inference; only provider responses and Cloudflare storage bindings are fixtures.
const artifact = "captures/url-classification.json";
type AnalyticsPoint = { indexes: string[]; blobs: string[]; doubles: number[] };
const longEvents: AnalyticsPoint[] = [];
const report: { runtime: string; results: unknown[]; dedicatedAnalytics: AnalyticsPoint[] } = {
  runtime: `Bun account HTTP handler → Worker inference → local HTTP provider; in-memory PGlite with all migrations; DATABASE_URL ignored`,
  results: [],
  dedicatedAnalytics: longEvents,
};
const pg = new PGlite({ parsers: { 20: parseCreditInteger, 1700: parseCreditInteger } });
const originalFetch = globalThis.fetch;
let providerCalls = 0;
const reportedTokens = 123;
const longArticle = "This annual contract renews automatically. ".repeat(1500);
let mode = "normal";
let scrapeCalls = 0;
const provider = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  providerCalls++;
  const body = await request.json() as { model: string; questions: Record<string, { criteria: Record<string, unknown> }> };
  const screening = Object.values(body.questions).some(q => Object.hasOwn(q.criteria, "irrelevant"));
  if (!screening && mode === "fail-final")
    return Response.json({ detail: { error_type: "invalid_request" } }, { status: 400 });
  return Response.json({ model: body.model, usage: { input_tokens: reportedTokens, output_tokens: 0 },
    answers: Object.fromEntries(Object.entries(body.questions).map(([id, q]) => {
      const labels = Object.keys(q.criteria);
      const choice = screening ? mode === "none" ? "irrelevant" : "relevant" : labels[0];
      return [id, { choice, confidence: 0.99,
        probabilities: Object.fromEntries(labels.map(label => [label, label === choice ? 0.99 : 0.01 / (labels.length - 1)])) }];
    })),
  });
} });
globalThis.fetch = ((input, init) => {
  if (String(input).startsWith("https://api.context.dev/")) {
    scrapeCalls++;
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("pdf[ocr]"), "false");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-context");
    if (mode === "network") return Promise.reject(new Error("Network response lost"));
    if (mode === "oversized") return Promise.resolve(new Response("x".repeat(8_000_001)));
    if (mode === "blocked") return Promise.resolve(Response.json({ error_code: "WEBSITE_BLOCKED", key_metadata: { credits_consumed: 0 } }, { status: 403 }));
    if (mode === "missing") return Promise.resolve(Response.json({ error_code: "NOT_FOUND", key_metadata: { credits_consumed: 1 } }, { status: 404 }));
    return Promise.resolve(Response.json({ success: true, markdown: mode === "empty" ? "" : mode === "long" ? longArticle : "# Annual contract\nThis contract renews annually.", html: "<article>This contract renews annually.</article>", metadata: { title: "Annual contract" }, key_metadata: { credits_consumed: 1 } }));
  }
  assert.equal(String(input), "https://api.typesafe.ai/v1/systemone", "unexpected external request");
  return originalFetch(provider.url, init);
}) as typeof fetch;

const objects = new Map<string, RateLimiter>();
const limiter = {
  idFromName: (name: string) => name,
  get(name: string) {
    if (!objects.has(name)) {
      const data = new Map<string, unknown>();
      let queue = Promise.resolve();
      objects.set(name, new RateLimiter({ storage: {
        get: async (key: string) => structuredClone(data.get(key)),
        put: async (values: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(values)) data.set(key, structuredClone(value));
        },
      }, blockConcurrencyWhile<T>(run: () => Promise<T>) {
        const result = queue.then(run);
        queue = result.then(() => {}, () => {});
        return result;
      } } as unknown as DurableObjectState));
    }
    return { fetch: (input: string | Request) => objects.get(name)!.fetch(new Request(input)) };
  },
} as unknown as DurableObjectNamespace;
const db = postgresDatabase(queries => pg.transaction(async tx => {
  const results = [];
  for (const query of queries) {
    const result = await tx.query<Record<string, unknown>>(query.sql, query.params);
    results.push({ results: result.rows, meta: { changes: result.affectedRows ?? 0 } });
  }
  return results;
}));
const pending: Promise<unknown>[] = [];
const ctx = { waitUntil(promise: Promise<unknown>) { pending.push(promise); } } as ExecutionContext;
async function flush() { while (pending.length) await Promise.all(pending.splice(0)); }
const kv = new Map<string, string>();
const events: { doubles: number[] }[] = [];
const env = appEnvironment({ APP_DB: db, APP_ACCOUNTS_ENABLED: "true", SPENDING_ENABLED: "true",
  PRIVACY_SALT: "local-e2e-privacy", API_KEY_ENCRYPTION_KEY: "test-only-key-encryption-secret-32-characters",
  CONTEXT_API_KEY: "fixture-context", TYPESAFE_API_KEY: "fixture", AI_GATEWAY_DISABLED: "true", LIMITER: limiter,
  STATS: { get: async (key: string) => kv.get(key) ?? null, put: async (key: string, value: string) => { kv.set(key, value); } },
  ACCOUNT_AE: { writeDataPoint(point: { doubles: number[] }) { events.push(point); } },
  LONG_CONTEXT_AE: { writeDataPoint(point: AnalyticsPoint) { longEvents.push(point); } },
} as unknown as Env & { APP_DB: typeof db });
let secret = "";
const body = { url: "https://example.com/article", labels: ["renewing", "not-renewing"] };
async function send(payload: Record<string, unknown> = body, idem?: string) {
  const request = new Request("https://classifier.dev/v1/classify", { method: "POST", headers: {
    authorization: `Bearer ${secret}`, "content-type": "application/json", "cf-connecting-ip": "203.0.113.1",
    ...(idem ? { "idempotency-key": idem } : {}),
  }, body: JSON.stringify(payload) });
  let response;
  try { response = await accountApi(request, env, ctx); }
  catch (error) { if (!(error instanceof AppError)) throw error; response = Response.json({ error: error.message }, { status: error.status }); }
  assert.ok(response);
  await flush();
  return { response, data: await response.json() as any };
}
try {
  const directory = new URL("../migrations/postgres/", import.meta.url);
  for (const name of (await readdir(directory)).filter(name => name.endsWith(".sql")).sort()) await pg.exec(await readFile(new URL(name, directory), "utf8"));
  await provisionTestAccount(new Request("http://localhost/auth/demo"), env);
  secret = String((await performAction("local-demo", { type: "enroll", client: "Codex" }, env)).secret);
  await db.prepare("UPDATE app_accounts SET paid_balance=balance WHERE id='local-demo'").run();
  for (const spending of ["true", "false"]) {
    env.SPENDING_ENABLED = spending;
    const { response, data } = await send({ ...body, include: ["markdown", "html"] });
    assert.equal(response.status, 200, JSON.stringify(data));
    assert.equal(data.results[0].label, "renewing");
    assert.ok(data.article.markdown.includes("contract"));
    assert.ok(data.article.html.includes("<article>"));
    assert.equal(data.pricing.scrape_usd, 0.0022);
    assert.equal(data.pricing.total_usd, (2200000 + reportedTokens * 42) / 1e9);
    const ledger = await db.prepare("SELECT status,actual_nano::text AS nano FROM app_usage WHERE id=?").bind(response.headers.get("x-request-id")).first();
    assert.equal(ledger?.status, "completed");
    assert.equal(ledger?.nano, String(2200000 + reportedTokens * 42));
    report.results.push({ name: `URL and both formats, spending=${spending}`, data, ledger });
  }
  env.SPENDING_ENABLED = "true";
  const compact = await send(body, "one-url");
  assert.equal(compact.response.status, 200);
  assert.equal(compact.data.article.markdown, undefined);
  assert.equal(compact.data.article.html, undefined);
  let calls = scrapeCalls;
  assert.equal((await send(body, "one-url")).response.status, 409);
  assert.equal(scrapeCalls, calls);
  report.results.push({ name: "compact response and duplicate does not scrape", status: "passed" });
  for (const payload of [{ ...body, input: "ambiguous" }, { ...body, url: "http://127.0.0.1" }, { ...body, url: "file:///etc/passwd" }, { ...body, include: ["pdf"] }, { ...body, labels: ["one"] }]) {
    calls = scrapeCalls;
    assert.equal((await send(payload)).response.status, 400);
    assert.equal(scrapeCalls, calls);
  }
  report.results.push({ name: "invalid requests rejected before scrape", status: "passed" });
  for (const [failure, status, charged] of [["blocked", 422, 0], ["missing", 422, 0.0022], ["empty", 422, 0.0022], ["fail-final", 503, 0.0022], ["network", 502, 0.0022], ["oversized", 413, 0.0022]] as const) {
    mode = failure;
    const { response, data } = await send();
    assert.equal(response.status, status, JSON.stringify(data));
    assert.equal(data.pricing.total_usd, charged);
    const ledger = await db.prepare("SELECT status,actual_nano::text AS nano FROM app_usage WHERE id=?").bind(response.headers.get("x-request-id")).first();
    assert.equal(ledger?.status, charged ? "completed" : "refunded");
    if (charged) assert.equal(ledger?.nano, "2200000");
    report.results.push({ name: failure, status, pricing: data.pricing });
  }
  mode = "long";
  const lengthy = await send();
  assert.equal(lengthy.response.status, 200, JSON.stringify(lengthy.data));
  assert.equal(lengthy.data.pricing.total_usd, (2200000 + countTokens(longArticle) * 84) / 1e9);
  assert.ok(lengthy.data.usage.long_context.context_tokens > 0);
  report.results.push({ name: "long article classifies without truncation", pricing: lengthy.data.pricing });
  mode = "normal";
  const dimensions = await send({ url: body.url, dimensions: { renewal: body.labels } });
  assert.equal(dimensions.response.status, 200, JSON.stringify(dimensions.data));
  report.results.push({ name: "URL dimensions", data: dimensions.data });
  const mcp = await accountApi(new Request("https://classifier.dev/mcp", { method: "POST", headers: {
    authorization: `Bearer ${secret}`, "content-type": "application/json", accept: "application/json, text/event-stream",
  }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "classify_texts", arguments: { ...body, include: ["markdown"] } } }) }), env, ctx);
  await flush();
  assert.ok(mcp);
  const rpc = await mcp.json() as any;
  assert.ok(!rpc.error && !rpc.result.isError, JSON.stringify(rpc));
  assert.ok(rpc.result.structuredContent.article.markdown.includes("contract"));
  report.results.push({ name: "MCP URL content and billing", result: rpc.result.structuredContent });
  env.PAID_REQUEST_USD = "0.002"; calls = scrapeCalls;
  assert.equal((await send()).response.status, 402);
  assert.equal(scrapeCalls, calls);
  delete env.PAID_REQUEST_USD;
  report.results.push({ name: "request spending cap includes scrape", status: "passed" });
  calls = scrapeCalls;
  const duplicate = await Promise.all([send(body, "concurrent-url"), send(body, "concurrent-url")]);
  assert.deepEqual(duplicate.map(r => r.response.status).sort(), [200, 409]);
  assert.equal(scrapeCalls, calls + 1);
  report.results.push({ name: "concurrent duplicate admits one provider request", status: "passed" });
  for (const sql of ["UPDATE app_accounts SET balance=1,paid_balance=1 WHERE id='local-demo'", "UPDATE app_accounts SET balance=500000,paid_balance=0,billing_plan='free' WHERE id='local-demo'"]) {
    await db.prepare(sql).run(); calls = scrapeCalls;
    assert.equal((await send()).response.status, 402);
    assert.equal(scrapeCalls, calls);
  }
  report.results.push({ name: "insufficient balance and unfunded workspace incur no provider cost", status: "passed" });
} finally {
  await mkdir("captures", { recursive: true });
  await writeFile(artifact, JSON.stringify(report, null, 2));
  globalThis.fetch = originalFetch;
  provider.stop(true);
  await pg.close();
}
console.log(`${report.results.length} URL E2E scenarios passed; ${artifact}`);
