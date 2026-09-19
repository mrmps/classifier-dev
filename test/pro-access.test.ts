import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import worker, { type Env } from "../src/index";

const customer = "a".repeat(64);
const key = `classifier_pro_${customer}.${"b".repeat(64)}`;
const rotatedKey = `classifier_pro_${customer}.${"c".repeat(64)}`;
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
const realFetch = globalThis.fetch;
let upstreamCalls = 0;
beforeEach(() => {
  upstreamCalls = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    expect(String(input instanceof Request ? input.url : input)).toContain("api.typesafe.ai");
    upstreamCalls++;
    const body = JSON.parse(String(init?.body));
    const answers = Object.fromEntries(Object.entries(body.questions).map(([id, question]) => {
      const labels = Object.keys((question as { criteria: Record<string, unknown> }).criteria);
      return [id, { choice: labels[0], confidence: 0.99, probabilities: { [labels[0]]: 0.99, [labels[1]]: 0.01 } }];
    }));
    return Response.json({ model: "jev-test", answers, usage: { input_tokens: 10 } });
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

function fixture(options: { billingStatus?: number; billingThrows?: boolean; quotaScope?: "minute" | "day" } = {}) {
  const authCalls: { customerId: string; secret: string }[] = [];
  const quotaCalls: { owner: string; limit: number; daily: number; cost: number }[] = [];
  const spent = new Map<string, number>();
  const env = {
    TYPESAFE_API_KEY: "test", ENTERPRISE_API_KEY: "enterprise-test", AGENT_API_KEY: "operator-test",
    STATS: { get: async () => null, put: async () => {} },
    BILLING: {
      idFromName: (name: string) => name,
      get: (id: string) => ({ fetch: async (request: Request) => {
        expect(request.url).toBe("https://billing/authenticate");
        const body = await request.json() as { customerId: string; secret: string };
        expect(body.customerId).toBe(id);
        authCalls.push(body);
        if (options.billingThrows) throw new Error("unavailable");
        const status = options.billingStatus ?? 200;
        return Response.json(status === 200 ? { active: true } : { error: "Access refused" }, { status });
      } }),
    },
    LIMITER: {
      idFromName: (name: string) => name,
      get: (owner: string) => ({ fetch: async (request: string) => {
        const params = new URL(request).searchParams;
        const limit = Number(params.get("limit")), daily = Number(params.get("daily")), cost = Number(params.get("cost"));
        quotaCalls.push({ owner, limit, daily, cost });
        if (options.quotaScope) return Response.json({ limited: true, remaining: 0, scope: options.quotaScope, resetIn: 30 });
        const total = (spent.get(owner) ?? 0) + cost;
        spent.set(owner, total);
        return Response.json({ limited: false, remaining: limit - total });
      } }),
    },
  } as unknown as Env;
  return { env, authCalls, quotaCalls };
}
function classify(env: Env, { token, tier = "fast", count = 1, ip = "192.0.2.1" }: { token?: string; tier?: string; count?: number; ip?: string } = {}) {
  return worker.fetch(new Request("https://classifier.dev/v1/classify", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ inputs: Array(count).fill("positive example"), labels: ["positive", "negative"], tier }),
  }), env, ctx);
}

describe("Pro classification access", () => {
  test.each([
    ["fast", 30000, 200000], ["smart", 2000, 20000],
  ] as const)("%s uses 10x quotas in enforcement and response headers", async (tier, limit, daily) => {
    const f = fixture();
    const response = await classify(f.env, { token: key, tier, count: 3 });
    expect(response.status).toBe(200);
    expect(f.quotaCalls).toEqual([{ owner: `${tier}:pro:${customer}`, limit, daily, cost: 3 }]);
    expect(response.headers.get("ratelimit-limit")).toBe(String(limit));
    expect(response.headers.get("ratelimit-policy")).toBe(`${limit};w=60, ${daily};w=86400`);
    expect(response.headers.get("ratelimit-remaining")).toBe(String(limit - 3));
    expect(response.headers.get("x-ratelimit-limit")).toBe(`${limit}/min`);
  });
  test.each(["minute", "day"] as const)("exhausted Pro %s quota returns correct ceilings", async scope => {
    const f = fixture({ quotaScope: scope });
    const response = await classify(f.env, { token: key });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get("ratelimit-remaining")).toBe("0");
    expect(response.headers.get("ratelimit-policy")).toBe("30000;w=60, 200000;w=86400");
    expect(response.headers.get("x-ratelimit-limit")).toBe(scope === "day" ? "200000/day" : "30000/min");
    expect((await response.json()).code).toBe(`rate_limit_${scope}`);
    expect(upstreamCalls).toBe(0);
  });
  test("smart Pro accepts 1,000 inputs while free rejects 201 before spending quota", async () => {
    const f = fixture();
    const paid = await classify(f.env, { token: key, tier: "smart", count: 1000 });
    expect(paid.status).toBe(200);
    expect((await paid.json()).results).toHaveLength(1000);
    expect(f.quotaCalls[0].cost).toBe(1000);
    const free = await classify(f.env, { tier: "smart", count: 201 });
    expect(free.status).toBe(400);
    expect((await free.json()).code).toBe("too_many_inputs");
    expect(f.quotaCalls).toHaveLength(1);
  });
  test.each([["fast", 3000, 20000], ["smart", 200, 2000]] as const)("free %s allowance stays per IP", async (tier, limit, daily) => {
    const f = fixture();
    const response = await classify(f.env, { tier });
    expect(response.status).toBe(200);
    expect(response.headers.get("ratelimit-policy")).toBe(`${limit};w=60, ${daily};w=86400`);
    expect(f.quotaCalls[0]).toEqual({ owner: `${tier}:192.0.2.1`, limit, daily, cost: 1 });
    expect(f.authCalls).toHaveLength(0);
  });
  test.each(["enterprise-test", "operator-test"])("%s retains unmetered access", async token => {
    const f = fixture();
    const response = await classify(f.env, { token });
    expect(response.status).toBe(200);
    expect(response.headers.get("ratelimit-policy")).toBe("unlimited");
    expect(f.authCalls).toHaveLength(0);
    expect(f.quotaCalls).toHaveLength(0);
  });
  test.each([[401, "invalid_pro_key"], [403, "pro_inactive"], [503, "billing_unavailable"]] as const)("billing refusal %s stops classification", async (billingStatus, code) => {
    const f = fixture({ billingStatus });
    const response = await classify(f.env, { token: key });
    expect(response.status).toBe(billingStatus);
    expect((await response.json()).code).toBe(code);
    expect(f.quotaCalls).toHaveLength(0);
    expect(upstreamCalls).toBe(0);
  });
  test("malformed Pro key returns 401 without calling billing", async () => {
    const f = fixture();
    expect((await classify(f.env, { token: "classifier_pro_invalid" })).status).toBe(401);
    expect(f.authCalls).toHaveLength(0);
    expect(upstreamCalls).toBe(0);
  });
  test("billing transport failure returns 503 without a free fallback", async () => {
    const f = fixture({ billingThrows: true });
    expect((await classify(f.env, { token: key })).status).toBe(503);
    expect(f.quotaCalls).toHaveLength(0);
    expect(upstreamCalls).toBe(0);
  });
  test("different IPs and a rotated key spend the same account quota", async () => {
    const f = fixture();
    for (const [token, ip, remaining] of [[key, "192.0.2.1", "29999"], [key, "192.0.2.2", "29998"], [rotatedKey, "192.0.2.3", "29997"]]) {
      const response = await classify(f.env, { token, ip });
      expect(response.status).toBe(200);
      expect(response.headers.get("ratelimit-remaining")).toBe(remaining);
    }
    expect(new Set(f.quotaCalls.map(call => call.owner))).toEqual(new Set([`fast:pro:${customer}`]));
    expect(f.authCalls[2].secret).toBe("c".repeat(64));
  });
  test("MCP forwards the Pro credential to the shared classification handler", async () => {
    const f = fixture();
    const response = await worker.fetch(new Request("https://classifier.dev/mcp", {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${key}`, "cf-connecting-ip": "192.0.2.10" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "classify_texts", arguments: { inputs: ["positive example"], labels: ["positive", "negative"] } } }),
    }), f.env, ctx);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.error).toBeUndefined();
    expect(payload.result.isError).not.toBe(true);
    expect(f.authCalls).toEqual([{ customerId: customer, secret: "b".repeat(64) }]);
    expect(f.quotaCalls[0]).toEqual({ owner: `fast:pro:${customer}`, limit: 30000, daily: 200000, cost: 1 });
  });
});
