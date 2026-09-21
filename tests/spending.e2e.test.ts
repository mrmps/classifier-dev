import { afterEach, expect, test } from "bun:test";
import worker, { type Env } from "../src/index";
import { FreeBudget } from "../src/spending/free-budget";
import { database } from "./support/postgres";
import { provisionTestAccount } from "./support/account";
import { performAction } from "../src/server/agents";
import { accountClassification } from "../src/http/classification";
import type { AppEnv } from "../src/server/db";

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
