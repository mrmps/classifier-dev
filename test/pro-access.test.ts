import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import worker, { type Env, type ClassificationExecution } from "../src/index";
import { newMeter } from "../src/cost";

const key = "classifier_agent_test";
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

test.each(["classifier_pro_invalid", `classifier_pro_${"a".repeat(64)}.${"b".repeat(64)}`, "unknown-key", "classifier_agent_unverified"])("unsupported credential %s cannot fall through to free inference", async token => {
  const f = fixture();
  const response = await classify(f.env, { token });
  expect(response.status).toBe(401);
  expect((await response.json()).code).toBe("invalid_api_key");
  expect(f.quotaCalls).toHaveLength(0);
  expect(upstreamCalls).toBe(0);
});

test.each([["fast", 3000, 20000], ["smart", 200, 2000]] as const)("anonymous %s allowance stays per IP", async (tier, limit, daily) => {
  const f = fixture();
  expect((await classify(f.env, { tier })).status).toBe(200);
  expect(f.quotaCalls[0]).toEqual({ owner: `${tier}:192.0.2.1`, limit, daily, cost: 1 });
});

test.each(["enterprise-test", "operator-test"])("%s has arranged access", async token => {
  const f = fixture();
  const response = await classify(f.env, { token });
  expect(response.status).toBe(200);
  expect(response.headers.get("ratelimit-policy")).toBe("unlimited");
  expect(f.quotaCalls).toHaveLength(0);
});

test("MCP reports an unsupported credential without running inference", async () => {
  const f = fixture();
  const response = await worker.fetch(new Request("https://classifier.dev/mcp", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer classifier_pro_invalid" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "classify_texts", arguments: { inputs: ["positive example"], labels: ["positive", "negative"] } } }),
  }), f.env, ctx);
  expect((await response.json()).result.isError).toBe(true);
  expect(f.quotaCalls).toHaveLength(0);
  expect(upstreamCalls).toBe(0);
});

function fixture(options: { quotaScope?: "minute" | "day" } = {}) {
  const quotaCalls: { owner: string; limit: number; daily: number; cost: number }[] = [];
  const spent = new Map<string, number>();
  const env = {
    TYPESAFE_API_KEY: "test", ENTERPRISE_API_KEY: "enterprise-test", AGENT_API_KEY: "operator-test",
    STATS: { get: async () => null, put: async () => {} },
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
  return { env, quotaCalls };
}
function classify(env: Env, { token, tier = "fast", count = 1, ip = "192.0.2.1" }: { token?: string; tier?: string; count?: number; ip?: string } = {}, execution?: ClassificationExecution) {
  return worker.fetch(new Request("https://classifier.dev/v1/classify", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ inputs: Array(count).fill("positive example"), labels: ["positive", "negative"], tier }),
  }), env, ctx, execution);
}

describe("trusted account classification context", () => {
  test.each([["fast", 10, 30000, 200000], ["smart", 10, 2000, 20000], ["smart", 1, 200, 2000]] as const)(
    "%s account multiplier %s determines quota and headers", async (tier, multiplier, limit, daily) => {
      const f = fixture();
      const meter = newMeter();
      const response = await classify(f.env, { token: key, tier }, { account: { id: "org-a", multiplier }, meter });
      expect(response.status).toBe(200);
      expect(f.quotaCalls).toEqual([{ owner: `${tier}:account:org-a`, limit, daily, cost: 1 }]);
      expect(response.headers.get("ratelimit-policy")).toBe(`${limit};w=60, ${daily};w=86400`);
      expect(response.headers.has("x-ratelimit-limit")).toBe(false);
      expect(meter.tokens).toEqual([{ provider: "typesafe", model: "jev-test", calls: 1, inputTokens: 10, outputTokens: null, cachedInputTokens: null }]);
      const body = await response.json();
      expect(JSON.stringify(body)).not.toContain("org-a");
      expect(body.usage).not.toHaveProperty("tokens");
      expect(body.usage).not.toHaveProperty("usd");
    },
  );

  test("account context shares quotas across IPs, overrides enterprise headers, and keeps organizations separate", async () => {
    const f = fixture();
    for (const [id, ip, remaining] of [["org-a", "192.0.2.1", "29999"], ["org-a", "192.0.2.2", "29998"], ["org-b", "192.0.2.1", "29999"]]) {
      const response = await classify(f.env, { token: "enterprise-test", ip }, { account: { id, multiplier: 10 } });
      expect(response.status).toBe(200);
      expect(response.headers.get("ratelimit-remaining")).toBe(remaining);
    }
    expect(f.quotaCalls.map(call => call.owner)).toEqual(["fast:account:org-a", "fast:account:org-a", "fast:account:org-b"]);
  });

  test("internal paid context admits larger Smart batches while internal free does not", async () => {
    const f = fixture();
    expect((await classify(f.env, { tier: "smart", count: 1000 }, { account: { id: "paid", multiplier: 10 } })).status).toBe(200);
    const response = await classify(f.env, { tier: "smart", count: 201 }, { account: { id: "free", multiplier: 1 } });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("too_many_inputs");
    expect(f.quotaCalls).toHaveLength(1);
  });

  test("HTTP body and headers cannot spoof internal account privileges or metering", async () => {
    const f = fixture();
    const response = await worker.fetch(new Request("https://classifier.dev/v1/classify?account=org-a&multiplier=10", {
      method: "POST", headers: {
        "content-type": "application/json", "cf-connecting-ip": "192.0.2.1",
        "x-account-id": "org-a", "x-account-multiplier": "10", "x-classifier-internal": "true",
      },
      body: JSON.stringify({ input: "positive example", labels: ["positive", "negative"], tier: "smart", account: { id: "org-a", multiplier: 10 }, execution: { account: { id: "org-a", multiplier: 10 } }, meter: { usd: -100, tokens: [] } }),
    }), f.env, ctx);
    expect(response.status).toBe(200);
    expect(f.quotaCalls).toEqual([{ owner: "smart:192.0.2.1", limit: 200, daily: 2000, cost: 1 }]);
    expect(response.headers.get("ratelimit-limit")).toBe("200");
  });

  test("account quota rejection reports account scope and stops inference", async () => {
    const f = fixture({ quotaScope: "day" });
    const response = await classify(f.env, {}, { account: { id: "org-a", multiplier: 10 } });
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error).toContain("per account per day");
    expect(body).not.toHaveProperty("upgrade");
    expect(upstreamCalls).toBe(0);
  });

  test("the sandbox alias preserves the supplied account and meter", async () => {
    const f = fixture();
    const meter = newMeter();
    const response = await worker.fetch(new Request("https://classifier.dev/v1/sandbox/classify", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "positive example", labels: ["positive", "negative"] }),
    }), f.env, ctx, { account: { id: "org-a", multiplier: 10 }, meter });
    expect(response.status).toBe(200);
    expect(f.quotaCalls[0].owner).toBe("fast:account:org-a");
    expect(meter.tokens[0].inputTokens).toBe(10);
  });

  test("MCP preserves internal context without authenticating its forwarded credential", async () => {
    const f = fixture();
    const meter = newMeter();
    const response = await worker.fetch(new Request("https://classifier.dev/mcp", {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${key}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "classify_texts", arguments: { inputs: ["positive example"], labels: ["positive", "negative"] } } }),
    }), f.env, ctx, { account: { id: "org-a", multiplier: 10 }, meter });
    expect(response.status).toBe(200);
    expect((await response.json()).result.isError).not.toBe(true);
    expect(f.quotaCalls[0].owner).toBe("fast:account:org-a");
    expect(meter.tokens[0].inputTokens).toBe(10);
  });

  test.each([0, -1, NaN, Infinity, 1.5])("invalid internal multiplier %s stops before inference", async multiplier => {
    const f = fixture();
    await expect(classify(f.env, {}, { account: { id: "org-a", multiplier } })).rejects.toThrow("Invalid internal classification account context");
    expect(upstreamCalls).toBe(0);
    expect(f.quotaCalls).toHaveLength(0);
  });
});
