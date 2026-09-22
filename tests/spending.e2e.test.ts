import { afterAll, afterEach, expect, test } from "bun:test";
import { SQL } from "bun";
import { readFileSync, readdirSync } from "node:fs";
import worker, { type Env } from "../src/index";
import { FreeBudget } from "../src/spending/free-budget";
import { database as portableDatabase } from "./support/postgres";
import { provisionTestAccount } from "./support/account";
import { performAction } from "../src/server/agents";
import { accountClassification } from "../src/http/classification";
import { postgresDatabase, type AppEnv } from "../src/server/db";

function database() {
  if (!process.env.POSTGRES_TEST_URL) return portableDatabase();
  const sql = new SQL(process.env.POSTGRES_TEST_URL, { max: 16 });
  const schema = `spending_${crypto.randomUUID().replaceAll("-", "")}`;
  const ready = sql.begin(async connection => {
    await connection.unsafe(`CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema}`).simple();
    const directory = new URL("../migrations/postgres/", import.meta.url);
    for (const name of readdirSync(directory).filter(name => name.endsWith(".sql")).sort())
      await connection.unsafe(readFileSync(new URL(name, directory), "utf8")).simple();
  });
  afterAll(async () => { await ready; await sql.unsafe(`DROP SCHEMA ${schema} CASCADE`); await sql.close(); });
  return postgresDatabase(async queries => {
    await ready;
    return sql.begin("ISOLATION LEVEL READ COMMITTED", async connection => {
      await connection.unsafe(`SET LOCAL search_path TO ${schema}`);
      const results = [];
      for (const query of queries) {
        const rows = await connection.unsafe(query.sql, query.params);
        results.push({ results: Array.from(rows), meta: { changes: rows.count } });
      }
      return results;
    });
  });
}

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
function setup(overrides: Record<string, unknown> = {}) {
  const stored = new Map<string, unknown>();
  let queue = Promise.resolve();
  const storage = {
    async get(key: string) { return structuredClone(stored.get(key)); },
    async put(key: string, value: unknown) { stored.set(key, structuredClone(value)); },
    async delete(key: string) { return stored.delete(key); },
    async list({ prefix = "" } = {}) { return new Map([...stored].filter(([k]) => k.startsWith(prefix))); },
    async setAlarm() {},
    async getAlarm() { return null; },
    transaction<T>(fn: (tx: typeof storage) => Promise<T>): Promise<T> {
      const result = queue.then(() => fn(storage));
      queue = result.then(() => {}, () => {});
      return result;
    },
  };
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil(p: Promise<unknown>) { pending.push(p); } } as ExecutionContext;
  const env = {
    SPENDING_ENABLED: "true", PRIVACY_SALT: "test-private-identity", SPUR_API_KEY: "fixture",
    TYPESAFE_API_KEY: "fixture", OPENROUTER_API_KEY: "fixture", AI_GATEWAY_DISABLED: "true",
    STATS: { get: async () => null, put: async () => {} }, ...overrides,
  } as unknown as Env;
  const budget = new FreeBudget({ storage } as unknown as DurableObjectState, env);
  env.FREE_BUDGET = { idFromName: () => "one", get: () => ({ fetch: (input: string | Request, init?: RequestInit) => budget.fetch(new Request(input, init)) }) } as unknown as DurableObjectNamespace;
  return { env, ctx, stored, async flush() { while (pending.length) await Promise.all(pending.splice(0)); } };
}
function request(ip = "203.0.113.1", path = "/v1/classify", body: unknown = { inputs: ["hello"], labels: ["a", "b"] }, extra: Record<string, string> = {}) {
  return new Request(`https://classifier.dev${path}`, { method: "POST", headers: { "cf-connecting-ip": ip, "content-type": "application/json", ...extra }, body: JSON.stringify(body) });
}
function providers(onCall?: () => Promise<void>, spur: unknown = {}) {
  const calls: string[] = [];
  globalThis.fetch = (async (url, init) => {
    if (String(url).startsWith("https://api.spur.us/")) return Response.json(spur);
    calls.push(String(url));
    await onCall?.();
    const b = JSON.parse(String(init?.body));
    return Response.json({ model: "jev-1.13.0", usage: { input_tokens: 100, output_tokens: 0 }, answers: Object.fromEntries(Object.entries(b.questions ?? {}).map(([id, q]) => {
      const choices = Object.keys((q as { criteria: object }).criteria);
      return [id, { choice: choices[0], confidence: 0.99, probabilities: Object.fromEntries(choices.map((c, i) => [c, i ? 0.01 : 0.99])) }];
    })) });
  }) as typeof fetch;
  return calls;
}

test("HTTP concurrency is atomic across aliases, IPv6 spellings, and caller-supplied forwarding headers", async () => {
  const s = setup();
  let release!: () => void;
  const wait = new Promise<void>(r => { release = r; });
  const calls = providers(() => wait);
  const running = Array.from({ length: 12 }, (_, i) => worker.fetch(request(i % 2 ? "2001:db8:1:2::1" : "2001:0db8:0001:0002::abcd", i % 2 ? "/v1/sandbox/classify" : "/v1/classify", undefined, { "x-forwarded-for": `1.1.1.${i}` }), s.env, s.ctx));
  await new Promise(r => setTimeout(r, 100));
  expect(calls.length).toBe(4);
  release();
  const statuses = (await Promise.all(running)).map(r => r.status);
  await s.flush();
  expect(statuses.filter(s => s === 200).length).toBe(4);
  expect(statuses.filter(s => s === 429).length).toBe(8);
  expect(JSON.stringify([...s.stored])).not.toContain("2001:");
});

test("global subsidy holds reject other IPs before provider work and settlement releases only unused spend", async () => {
  const s = setup({ FREE_DAILY_USD: "0.02", FREE_REQUEST_USD: "0.01" });
  let release!: () => void;
  const wait = new Promise<void>(r => { release = r; });
  const calls = providers(() => wait);
  const a = worker.fetch(request("203.0.113.1"), s.env, s.ctx);
  const b = worker.fetch(request("203.0.113.2"), s.env, s.ctx);
  await new Promise(r => setTimeout(r, 100));
  expect((await worker.fetch(request("203.0.113.3"), s.env, s.ctx)).status).toBe(429);
  expect(calls.length).toBe(2);
  release();
  await Promise.all([a, b]); await s.flush();
  expect((await worker.fetch(request("203.0.113.3"), s.env, s.ctx)).status).toBe(200);
  await s.flush();
});

test("missing trusted identity, unpriced models, oversized payloads and expensive free work cannot reach a provider", async () => {
  const s = setup(); const calls = providers();
  const cases = [
    new Request("https://classifier.dev/v1/classify", { method: "POST", body: JSON.stringify({ inputs: ["hi"], labels: ["a", "b"] }) }),
    request("203.0.113.1", "/v1/systemone", { model: "future-expensive-model", state: [], questions: {} }),
    request("203.0.113.1", "/v1/classify", { inputs: ["hi"], labels: ["a", "b"], instructions: "x".repeat(1_100_000) }),
    request("203.0.113.1", "/v1/classify", { inputs: ["x".repeat(32000)], labels: ["a", "b"], tier: "smart" }),
  ];
  for (const r of cases) expect((await worker.fetch(r, s.env, s.ctx)).status).toBeGreaterThanOrEqual(400);
  await s.flush(); expect(calls.length).toBe(0);
});

test("known anonymous proxies are refused, enterprise VPNs accepted, and Spur has a hard lookup budget", async () => {
  const blocked = setup(); const blockedCalls = providers(undefined, { tunnels: [{ anonymous: true, type: "PROXY" }] });
  expect((await worker.fetch(request(), blocked.env, blocked.ctx)).status).toBe(403);
  expect(blockedCalls.length).toBe(0);
  const allowed = setup({ SPUR_MONTHLY_LOOKUPS: "1" }); const calls = providers(undefined, { infrastructure: "DATACENTER", tunnels: [{ anonymous: false, type: "VPN" }] });
  expect((await worker.fetch(request(), allowed.env, allowed.ctx)).status).toBe(200); await allowed.flush();
  expect((await worker.fetch(request(), allowed.env, allowed.ctx)).status).toBe(200); await allowed.flush();
  expect((await worker.fetch(request("203.0.113.2"), allowed.env, allowed.ctx)).status).toBe(503);
  expect(calls.length).toBe(2);
});

test("duplicate idempotency keys never execute twice and body conflicts are rejected", async () => {
  const s = setup(); const calls = providers();
  const headers = { "idempotency-key": "one-operation" };
  expect((await worker.fetch(request(undefined, undefined, undefined, headers), s.env, s.ctx)).status).toBe(200); await s.flush();
  expect((await worker.fetch(request(undefined, undefined, undefined, headers), s.env, s.ctx)).status).toBe(409);
  expect((await worker.fetch(request(undefined, undefined, { inputs: ["different"], labels: ["a", "b"] }, headers), s.env, s.ctx)).status).toBe(409);
  expect(calls.length).toBe(1);
});

test("uncertain attempts consume allowance, retries cannot exceed a penny, and failed work is not refunded from the subsidy", async () => {
  const s = setup({ FREE_IP_DAILY_USD: "0.01" });
  let calls = 0;
  globalThis.fetch = (async url => {
    if (String(url).startsWith("https://api.spur.us/")) return Response.json({});
    calls++;
    return Response.json({ error: "upstream failed" }, { status: 500 });
  }) as typeof fetch;
  expect((await worker.fetch(request(), s.env, s.ctx)).status).toBeGreaterThanOrEqual(400); await s.flush();
  expect(calls).toBeLessThanOrEqual(12);
  expect(calls).toBeGreaterThan(0);
  expect((await worker.fetch(request(), s.env, s.ctx)).status).toBe(429);
});

test("funded HTTP classification skips Spur/free budget, reserves once, returns before settlement, and bills actual tokens", async () => {
  const s = setup();
  const env = { ...s.env, APP_DB: database(), APP_ACCOUNTS_ENABLED: "true", API_KEY_ENCRYPTION_KEY: "test-only-key-encryption-secret-32-characters" } as Env & AppEnv;
  await provisionTestAccount(new Request("http://localhost/auth/demo", { headers: { origin: "http://localhost" } }), env);
  await env.APP_DB.prepare("UPDATE app_accounts SET paid_balance=balance WHERE id='local-demo'").run();
  const enrolled = await performAction("local-demo", { type: "enroll", client: "Codex" }, env);
  const calls = providers();
  const r = await accountClassification(request("203.0.113.1", undefined, undefined, { authorization: `Bearer ${enrolled.secret}` }), env, "API", s.ctx);
  expect(r?.status).toBe(200);
  expect(r?.headers.get("x-billing-status")).toBe("pending");
  await s.flush();
  const row = await env.APP_DB.prepare("SELECT status,actual_nano::text AS nano FROM app_usage WHERE id=?").bind(r!.headers.get("x-request-id")).first();
  expect(row).toEqual({ status: "completed", nano: "4200" });
  expect(calls.length).toBe(1);
  expect(s.stored.size).toBe(0);
});

test("ordinary smart inference escalates to Gemini within the free allowance", async () => {
  const s = setup();
  const calls: string[] = [];
  globalThis.fetch = (async (url, init) => {
    if (String(url).startsWith("https://api.spur.us/")) return Response.json({});
    const b = JSON.parse(String(init?.body)); calls.push(b.model);
    if (b.model === "google/gemini-3.8-flash") return Response.json({ model: b.model, choices: [{ message: { content: "A" } }], usage: { prompt_tokens: 200, completion_tokens: 150, cost: 0.0007125, prompt_tokens_details: { cached_tokens: 0 } } });
    return Response.json({ model: "jev-1.13.0", usage: { input_tokens: 100, output_tokens: 0 }, answers: Object.fromEntries(Object.entries(b.questions).map(([id, q]) => [id, { choice: Object.keys((q as { criteria: object }).criteria)[0], confidence: 0.51, probabilities: Object.fromEntries(Object.keys((q as { criteria: object }).criteria).map((c, i) => [c, i ? 0.49 : 0.51])) }])) });
  }) as typeof fetch;
  const r = await worker.fetch(request(undefined, undefined, { inputs: ["Please help me with my invoice"], labels: ["billing", "support"], tier: "smart" }), s.env, s.ctx);
  expect(r.status).toBe(200);
  expect(calls).toContain("google/gemini-3.8-flash");
  await s.flush();
});

test("an explicit provider credit refusal leaves the free allowance available for smart fallback", async () => {
  const s = setup();
  const calls: string[] = [];
  globalThis.fetch = (async (url, init) => {
    if (String(url).startsWith("https://api.spur.us/")) return Response.json({});
    const b = JSON.parse(String(init?.body)); calls.push(b.model);
    if (String(url).includes("typesafe.ai")) return Response.json({ detail: { error_type: "insufficient_credits" } }, { status: 402 });
    return Response.json({ model: b.model, choices: [{ message: { content: "A" } }], usage: { prompt_tokens: 200, completion_tokens: 150, cost: 0.0007125 } });
  }) as typeof fetch;
  const r = await worker.fetch(request(undefined, undefined, { inputs: ["Please help me with my invoice"], labels: ["billing", "support"], tier: "smart" }), s.env, s.ctx);
  expect(r.status).toBe(200);
  expect(calls).toContain("google/gemini-3.8-flash");
  await s.flush();
});

test("a Spur outage fails closed and repeated callers do not exhaust its lookup budget", async () => {
  const s = setup(); let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({}, { status: 503 }); }) as typeof fetch;
  for (let i = 0; i < 3; i++) {
    const response = await worker.fetch(request(), s.env, s.ctx);
    expect(response.status).toBe(503);
    expect((await response.json() as { code: string }).code).toBe("reputation_unavailable");
  }
  expect(calls).toBe(1);
});

test("operator alert previews expose exhausted subsidy and unresolved billing without caller data", async () => {
  const s = setup({ REPORT_KEY: "operator", FREE_DAILY_USD: "0.01" });
  const env = { ...s.env, APP_DB: database(), APP_ACCOUNTS_ENABLED: "true", API_KEY_ENCRYPTION_KEY: "test-only-key-encryption-secret-32-characters" } as Env & AppEnv;
  await provisionTestAccount(new Request("http://localhost/auth/demo", { headers: { origin: "http://localhost" } }), env);
  await performAction("local-demo", { type: "enroll", client: "Codex" }, env);
  await env.APP_DB.prepare("INSERT INTO app_usage(id,account_id,agent_id,items,credits,status,created_at,metering_mode) SELECT 'lost',account_id,id,1,100,'pending',?,'tokens' FROM app_agents WHERE account_id='local-demo' LIMIT 1").bind(new Date(Date.now()-600000).toISOString()).run();
  providers();
  const stub = s.env.FREE_BUDGET!.get(s.env.FREE_BUDGET!.idFromName("one"));
  expect((await stub.fetch("https://budget/reserve", { method: "POST", body: JSON.stringify({ ip: "203.0.113.1" }) })).status).toBe(200);
  const response = await worker.fetch(new Request("https://classifier.dev/alerts", { headers: { authorization: "Bearer operator" } }), env, s.ctx);
  const message = await response.text();
  expect(message).toContain("free spending pool");
  expect(message).toContain("billing reservations need review");
  expect(message).not.toContain("203.0.113.1");
});

test("chat and skill APIs require the internal secret, including for paid and enterprise callers", async () => {
  const s = setup({ INTERNAL_API_KEY: "internal-only", ENTERPRISE_API_KEY: "external-enterprise" });
  const calls = providers();
  for (const path of ["/v1/chat", "/v1/skills", "/v1/skills/example", "//v1/chat", "/%76%31/skills", "/skills", "/skills.md"]) {
    for (const authorization of ["", "Bearer external-enterprise", "Bearer classifier_agent_unverified"]) {
      expect((await worker.fetch(request(undefined, path, {}, { authorization }), s.env, s.ctx)).status).toBe(404);
    }
  }
  expect(calls).toHaveLength(0);
  expect((await worker.fetch(request(undefined, "/v1/chat", {}, { authorization: "Bearer internal-only" }), s.env, s.ctx)).status).toBe(400);
});

test("budget errors teach agents when to retry and when to change the request", async () => {
  const s = setup({ FREE_DAILY_USD: '0.005' }); providers();
  const response = await worker.fetch(request(), s.env, s.ctx);
  const error = await response.json() as Record<string, unknown>;
  expect(response.status).toBe(429);
  expect(error.code).toBe('free_daily_budget');
  expect(error.action).toContain('funded');
  expect(error.docs).toBe('https://classifier.dev/developers');
  expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
});

test("a current paid subscription uses its paid allowance without a purchased top-up", async () => {
  const s = setup();
  const env = { ...s.env, APP_DB: database(), APP_ACCOUNTS_ENABLED: 'true', API_KEY_ENCRYPTION_KEY: 'test-only-key-encryption-secret-32-characters' } as Env & AppEnv;
  await provisionTestAccount(new Request('http://localhost/auth/demo', { headers: { origin: 'http://localhost' } }), env);
  await env.APP_DB.prepare("UPDATE app_accounts SET billing_plan='pro',reset_at=?,paid_balance=0 WHERE id='local-demo'").bind(new Date(Date.now()+86400000).toISOString()).run();
  const key = await performAction('local-demo', { type: 'enroll', client: 'Codex' }, env);
  providers();
  const response = await accountClassification(request(undefined, undefined, undefined, { authorization: `Bearer ${key.secret}` }), env, 'API', s.ctx);
  expect(response?.status).toBe(200); await s.flush();
  expect(s.stored.size).toBe(0);
});

test("funded requests accept work above the free request ceiling and concurrent keys share one balance", async () => {
  const s = setup();
  const env = { ...s.env, APP_DB: database(), APP_ACCOUNTS_ENABLED: "true", API_KEY_ENCRYPTION_KEY: "test-only-key-encryption-secret-32-characters" } as Env & AppEnv;
  await provisionTestAccount(new Request("http://localhost/auth/demo", { headers: { origin: "http://localhost" } }), env);
  await env.APP_DB.prepare("UPDATE app_accounts SET paid_balance=balance WHERE id='local-demo'").run();
  const key = await performAction("local-demo", { type: "enroll", client: "Codex" }, env);
  providers();
  const body = { inputs: ["invoice ".repeat(2000)], labels: ["billing", "support"], tier: "smart" };
  expect((await worker.fetch(request(undefined, undefined, body), env, s.ctx)).status).toBe(402);
  const large = await accountClassification(request(undefined, undefined, body, { authorization: `Bearer ${key.secret}` }), env, "API", s.ctx);
  expect(large?.status).toBe(200); await s.flush();
  await env.APP_DB.prepare("UPDATE app_accounts SET balance=1000,paid_balance=1000,fractional_spend_nano=0 WHERE id='local-demo'").run();
  const second = await performAction("local-demo", { type: "enroll", client: "Claude" }, env);
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const calls = providers(() => barrier);
  const running = Array.from({ length: 12 }, (_, i) => accountClassification(request(undefined, undefined, undefined, { authorization: `Bearer ${i % 2 ? key.secret : second.secret}` }), env, "API", s.ctx));
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(calls).toHaveLength(1); release();
  const statuses = (await Promise.all(running)).map(r => r?.status);
  expect(statuses.filter(status => status === 200)).toHaveLength(1);
  expect(statuses.filter(status => status === 402)).toHaveLength(11);
  await s.flush();
  const balance = await env.APP_DB.prepare("SELECT balance FROM app_accounts WHERE id='local-demo'").first<{ balance: number }>();
  expect(Number(balance!.balance)).toBe(999);
  expect(s.stored.size).toBe(0);
});

test.skipIf(process.env.LIVE_TOKEN_BILLING !== "true")("live TypeSafe inference settles the new funded HTTP path", async () => {
  const s = setup({ TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY });
  const env = { ...s.env, APP_DB: database(), APP_ACCOUNTS_ENABLED: "true", API_KEY_ENCRYPTION_KEY: "test-only-key-encryption-secret-32-characters" } as Env & AppEnv;
  await provisionTestAccount(new Request("http://localhost/auth/demo", { headers: { origin: "http://localhost" } }), env);
  await env.APP_DB.prepare("UPDATE app_accounts SET paid_balance=balance WHERE id='local-demo'").run();
  const key = await performAction("local-demo", { type: "enroll", client: "Codex" }, env);
  const response = await accountClassification(request(undefined, undefined, { input: "Your invoice is overdue.", labels: ["billing", "technical"] }, { authorization: `Bearer ${key.secret}` }), env, "API", s.ctx);
  expect(response?.status).toBe(200);
  const body = await response!.json() as { results: { label: string }[] };
  expect(body.results[0].label).toBe("billing");
  await s.flush();
  const row = await env.APP_DB.prepare("SELECT status,actual_nano::text AS nano FROM app_usage WHERE id=?").bind(response!.headers.get("x-request-id")).first<{ status: string; nano: string }>();
  expect(row!.status).toBe("completed");
  expect(Number(row!.nano)).toBeGreaterThan(0);
  expect(s.stored.size).toBe(0);
});
