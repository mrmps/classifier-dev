import { test, expect, afterEach } from "bun:test";
import worker, { type Env } from "../src/index";
import { planLaya, runLaya, limitLaya } from "../src/laya";
import { newMeter } from "../src/cost";
import { parseTokenRateCard, priceTokens } from "../src/server/token-pricing";
import { providerCallBound } from "../src/server/token-reservation";
import rates from "../src/retail-rates.json";

const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });
const env = { LAYA_ENABLED: "true", LAYA_FAST_URL: "https://fast.example", LAYA_BULK_URL: "https://bulk.example",
  LAYA_MODAL_KEY: "key", LAYA_MODAL_SECRET: "secret", STATS: { get: async () => null, put: async () => {} },
  LIMITER: { idFromName: (s: string) => s, get: () => ({ fetch: async () => Response.json({ limited: false, remaining: 59 }) }) } } as unknown as Env;
const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;
const task = { input: "refund", labels: ["billing", "tech"] };
const request = (body: object, bindings = env) => worker.fetch(new Request("https://classifier.dev/v1/classify", {
  method: "POST", body: JSON.stringify({ model: "laya", ...body }) }), bindings, ctx);

function mockLaya() {
  const calls: { url: string; rows: { state: string; questions: Record<string, { type: string; criteria?: object }> }[] }[] = [];
  globalThis.fetch = (async (url, init) => {
    const { batch } = JSON.parse(String(init?.body));
    calls.push({ url: String(url), rows: batch });
    return Response.json({ results: batch.map((row: typeof calls[number]["rows"][number]) => ({
      answers: Object.fromEntries(Object.entries(row.questions).map(([id, q]) => {
        const labels = Object.keys(q.criteria ?? {});
        return [id, q.type === "noul" ? { noul: .9 } : { choice: labels[0], confidence: .9,
          probabilities: Object.fromEntries(labels.map((label, i) => [label, i ? .1 / (labels.length - 1) : .9])) }];
      })), usage: { input_tokens: 20 }, routing: { model: "english" },
    })) });
  }) as typeof fetch;
  return calls;
}

function combinedEnv(result: unknown | ((url: string, init: RequestInit) => Promise<Response>) = {limited:false,remaining:2900,laneRemaining:56}) {
  const admissions: any[] = [], admissionUrls: string[] = [];
  let legacyCalls = 0;
  const bindings = {...env, QUOTA_COORDINATOR_ENABLED:"true", LIMITER:{
    idFromName:(s: string) => s, get:() => ({fetch:async () => {legacyCalls++; throw new Error("unexpected legacy call");}}),
  }, QUOTAS:{idFromName:(s: string) => s,get:() => ({fetch:async (url: string, init: RequestInit) => {
    admissionUrls.push(url);
    admissions.push(JSON.parse(String(init.body)));
    if (result instanceof Error) throw result;
    if (typeof result === "function") return result(url,init);
    return Response.json(result);
  }})}} as unknown as Env;
  return {bindings,admissions,admissionUrls,legacyCalls:() => legacyCalls};
}

test("combined admission makes one RPC with separate decision and multi-label question costs", async () => {
  mockLaya();
  const f = combinedEnv();
  const response = await request({...task,multi:true},f.bindings);
  expect(response.status).toBe(200);
  expect(response.headers.get("ratelimit-remaining")).toBe("56");
  expect(f.admissions).toHaveLength(1);
  expect(f.admissionUrls).toEqual(["https://quota/admit"]);
  expect(f.admissions[0].quotas).toMatchObject([
    {scope:"fast",cost:1,limit:3000,daily:20000},
    {scope:"laya:fast",cost:2,limit:60,daily:2000},
  ]);
  expect(f.legacyCalls()).toBe(0);
});

test.each([
  [{limited:true,remaining:0,limitedBy:"tier",scope:"minute",resetIn:19},429,"rate_limit_minute"],
  [{limited:true,remaining:0,limitedBy:"lane",scope:"minute",resetIn:19},429,"laya_rate_limit"],
  [{limited:true,remaining:0,limitedBy:"lane",scope:"day",resetIn:19},429,"rate_limit_day"],
  [new Error("storage failed"),503,"laya_unavailable"],
  [{},503,"laya_unavailable"],
] as const)("combined admission refuses inference on denial or unavailable storage: %j", async (result,status,code) => {
  const calls=mockLaya(), f=combinedEnv(result);
  const response=await request(task,f.bindings);
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({code});
  expect(calls).toHaveLength(0);
});

test("fast local admission lets exact admission and inference overlap", async () => {
  mockLaya();
  const predict = globalThis.fetch;
  let started!: () => void;
  const modalStarted = new Promise<void>(resolve => { started = resolve; });
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => { started(); return predict(...args); }) as typeof fetch;
  const f = combinedEnv(async () => {
    await modalStarted;
    return Response.json({limited:false,remaining:2999,laneRemaining:59});
  });
  const bindings = {...f.bindings, LAYA_FAST_ADMISSION:{limit:async () => ({success:true})}} as unknown as Env;
  const response = await request(task,bindings);
  expect(response.status).toBe(200);
  expect(f.admissionUrls).toEqual(["https://quota/admit"]);
});

test.each(["lane", "tier"])("exact %s admission rejection aborts speculative fast inference", async limitedBy => {
  let started!: () => void, aborted!: () => void;
  const modalStarted = new Promise<void>(resolve => { started = resolve; });
  const modalAborted = new Promise<void>(resolve => { aborted = resolve; });
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve,reject) => {
    started();
    init?.signal?.addEventListener("abort",() => { aborted(); reject(new DOMException("aborted","AbortError")); },{once:true});
  })) as typeof fetch;
  const f = combinedEnv(async () => {
    await modalStarted;
    return Response.json({limited:true,remaining:2999,limitedBy,scope:"minute",resetIn:12});
  });
  const bindings = {...f.bindings, LAYA_FAST_ADMISSION:{limit:async () => ({success:true})}} as unknown as Env;
  const response = await request(task,bindings);
  expect(response.status).toBe(429);
  expect(await response.json()).toMatchObject({code:limitedBy === "lane" ? "laya_rate_limit" : "rate_limit_minute"});
  await modalAborted;
});

test.each([false, true])("local burst shield blocks inference when unavailable=%s", async unavailable => {
  const calls = mockLaya();
  const f = combinedEnv();
  const bindings = {...f.bindings, LAYA_FAST_ADMISSION:{limit:async () => {
    if (unavailable) throw new Error("unavailable");
    return {success:false};
  }}} as unknown as Env;
  const response = await request(task,bindings);
  expect(response.status).toBe(unavailable ? 503 : 429);
  expect(calls).toHaveLength(0);
  expect(f.admissions).toHaveLength(0);
});

test("bulk chunks by question count, retains order and meters the selected lane", async () => {
  const calls = mockLaya(), meter = newMeter();
  const tasks = Array.from({ length: 1000 }, (_, i) => ({ ...task, input: String(i) }));
  const result = await runLaya(env, planLaya(tasks, "bulk"), meter);
  expect(calls).toHaveLength(16);
  expect(calls.every(c => c.url === "https://bulk.example/predict" && c.rows.length <= 64)).toBe(true);
  expect(calls.flatMap(c => c.rows.map(r => r.state))).toEqual(tasks.map(t => t.input));
  expect(result).toHaveLength(1000);
  expect(meter.tokens[0]).toMatchObject({ provider: "modal", model: "laya-0.3.4-routed-bulk", calls: 16, inputTokens: 20_000 });
});

test("mixed Router checkpoints preserve row order and meter one routed wrapper", async () => {
  const checkpoints = ["english", "multilingual", "typed-decisions", "multilingual"];
  const expected = ["billing", "tech", "billing", "tech"];
  const meter = newMeter();
  const bounds: string[] = [];
  meter.beforeCall = async (_provider, model) => { bounds.push(model); };
  globalThis.fetch = (async () => Response.json({ results: checkpoints.map((model, i) => ({
    routing: { model }, usage: { input_tokens: 20 + i }, answers: { q: {
      choice: expected[i], confidence: .9,
      probabilities: { billing: expected[i] === "billing" ? .9 : .1, tech: expected[i] === "tech" ? .9 : .1 },
    } },
  })) })) as typeof fetch;
  const results = await runLaya(env, planLaya(["refund", "无法登录", "invoice 123", "connexion impossible"].map(input => ({ ...task, input })), "bulk"), meter);
  expect(results.map(result => result.label)).toEqual(expected);
  expect(results.map(result => result.model)).toEqual(checkpoints.map(model => `laya-0.3.4-${model}-bulk`));
  expect(bounds).toEqual(["laya-0.3.4-routed-bulk"]);
  expect(meter.tokens).toEqual([{ provider: "modal", model: "laya-0.3.4-routed-bulk", calls: 1,
    inputTokens: 86, outputTokens: 0, cachedInputTokens: 0 }]);
});

test.each([undefined, {}, { model: "unknown" }, { model: ["english"] }])("missing or unknown Router checkpoint fails closed: %j", async routing => {
  globalThis.fetch = (async () => Response.json({ results: [{ routing, usage: { input_tokens: 20 }, answers: {
    q: { choice: "billing", confidence: .9, probabilities: { billing: .9, tech: .1 } },
  } }] })) as typeof fetch;
  expect((await request({ input: task.input, labels: task.labels })).status).toBe(502);
});

test("fast refuses large work before fetching; multi counts each label", () => {
  expect(() => planLaya([task, task], "fast")).toThrow("one decision");
  expect(() => planLaya([{ ...task, input: "x".repeat(2001) }], "bulk")).toThrow("short text");
  const plan = planLaya(Array.from({ length: 100 }, () => ({ ...task, multi: true })), "bulk");
  expect(plan.cost).toBe(200);
  expect(plan.batches.map(b => b.length)).toEqual([32, 32, 32, 4]);
});

test("POST selects fast or bulk and returns familiar output", async () => {
  const calls = mockLaya();
  const response = await request({ input: task.input, labels: task.labels });
  expect(response.status).toBe(200);
  expect(response.headers.get("ratelimit-limit")).toBe("60");
  expect(response.headers.get("x-classifier-processing")).toBe("fast");
  expect(await response.json()).toMatchObject({ results: [{ label: "billing", model: "laya-0.3.4-english-fast" }] });
  expect(calls[0].url).toContain("fast.example");
  const bulk = await request({ inputs: ["a", "b"], labels: task.labels, processing: "bulk", multi: true });
  expect(bulk.status).toBe(200);
  expect(await bulk.json()).toMatchObject({ results: [{ labels: ["billing", "tech"] }, { labels: ["billing", "tech"] }] });
});

test("dimensions preserve row/column order on bulk", async () => {
  mockLaya();
  const response = await request({ items: ["a", "b"], dimensions: { team: ["billing", "tech"], kind: ["bug", "request"] }, processing: "bulk" });
  expect(response.status).toBe(200);
  const body = await response.json() as { results: unknown[] };
  expect(JSON.stringify(body.results)).toContain("billing");
  expect(JSON.stringify(body.results)).toContain("bug");
});

test.each([
  { inputs: Array(30).fill("headline"), labels: task.labels },
  { items: ["headline"], dimensions: { team: task.labels, kind: ["bug", "request"] } },
  { input: "headline", labels: ["ai", "security", "business", "hardware", "other"], multi: true },
])("omitted Laya processing selects bulk for the complete workload: %j", async body => {
  const calls = mockLaya();
  const response = await request(body);
  expect(response.status).toBe(200);
  expect(response.headers.get("x-classifier-processing")).toBe("bulk");
  expect(calls.every(call => call.url === "https://bulk.example/predict")).toBe(true);
});

test.each(["fast", "bulk"])("processing %s implies Laya when model is omitted", async processing => {
  const calls = mockLaya();
  const response = await request({ model: undefined, input: task.input, labels: task.labels, processing });
  expect(response.status).toBe(200);
  expect(calls[0].url).toBe(`https://${processing}.example/predict`);
});

test("explicit model and lane choices are not silently overridden", async () => {
  const calls = mockLaya();
  expect((await request({ processing: "fast", inputs: ["a", "b"], labels: task.labels })).status).toBe(400);
  expect(calls).toHaveLength(0);
});

test("chat's MCP batch succeeds with omitted model or omitted lane", async () => {
  const calls = mockLaya();
  for (const options of [{ processing: "bulk" }, { model: "laya" }]) {
    const response = await worker.fetch(new Request("https://classifier.dev/mcp", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {
        name: "classify_texts", arguments: { inputs: Array(30).fill("headline"), labels: task.labels, ...options },
      } }),
    }), env, ctx);
    const body = await response.json() as { result: { isError?: boolean; structuredContent: { results: unknown[] } } };
    expect(body.result.isError).not.toBe(true);
    expect(body.result.structuredContent.results).toHaveLength(30);
  }
  expect(calls.every(call => call.url === "https://bulk.example/predict")).toBe(true);
});

test.each([undefined, "fast", "bulk"])("explicit Jev batches accept processing hint %s without selecting Laya", async processing => {
  const urls: string[] = [];
  globalThis.fetch = (async (url, init) => {
    urls.push(String(url));
    const sent = JSON.parse(String(init?.body));
    return Response.json({ model: "jev-test", answers: Object.fromEntries(Object.keys(sent.questions).map(id =>
      [id, { choice: "billing", confidence: .9, probabilities: { billing: .9, tech: .1 } }])) });
  }) as typeof fetch;
  const response = await request({ model: "jev", processing, inputs: Array(30).fill("headline"), labels: task.labels },
    { ...env, TYPESAFE_API_KEY: "test" });
  expect(response.status).toBe(200);
  const body = await response.json() as { results: { model: string }[] };
  expect(body.results).toHaveLength(30);
  expect(body.results.every(row => row.model === "jev-test")).toBe(true);
  expect(urls.every(url => url === "https://api.typesafe.ai/v1/systemone")).toBe(true);
  expect(response.headers.has("x-classifier-processing")).toBe(false);
});

test.each([429, 503, 400, 500])("upstream %s never falls back or retries", async status => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response("secret upstream body", { status }); }) as typeof fetch;
  const response = await request({ input: task.input, labels: task.labels });
  expect(response.status).toBe(status === 500 ? 502 : status);
  expect(calls).toBe(1);
  expect(await response.text()).not.toContain("secret upstream");
});

test("malformed output and disabled inference cannot become successful or fallback", async () => {
  globalThis.fetch = (async () => Response.json({ results: [null] })) as typeof fetch;
  expect((await request({ input: task.input, labels: task.labels })).status).toBe(502);
  globalThis.fetch = (async () => Response.json({ results: [{}] })) as typeof fetch;
  expect((await request({ input: task.input, labels: task.labels })).status).toBe(502);
  expect((await request({ input: task.input, labels: task.labels }, { ...env, LAYA_ENABLED: "false" })).status).toBe(503);
});

test("processing requires a literal lane string", async () => {
  const calls = mockLaya();
  for (const processing of [["bulk"], {}, true, "slow"]) {
    expect((await request({ input: task.input, labels: task.labels, processing })).status).toBe(400);
  }
  expect(calls).toHaveLength(0);
});

test("anonymous Laya success reports only numeric critical-path timings", async () => {
  mockLaya();
  const predict = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    await new Promise(resolve => setTimeout(resolve, 15));
    const body = await (await predict(...args)).json();
    return Response.json({ ...body, inference_ms: 7.25 });
  }) as typeof fetch;
  const bindings = { ...env, LIMITER: {
    idFromName: (name: string) => name,
    get: () => ({ fetch: async () => {
      await new Promise(resolve => setTimeout(resolve, 15));
      return Response.json({ limited: false, remaining: 59 });
    } }),
  } } as unknown as Env;
  const response = await request({ input: task.input, labels: task.labels }, bindings);
  expect(response.status).toBe(200);
  const header = response.headers.get("server-timing")!;
  const rows = header.split(", ");
  expect(rows.every(row => /^[a-z_]+;dur=\d+\.\d{2}$/.test(row))).toBe(true);
  const timing = Object.fromEntries(rows.map(row => { const [name, duration] = row.split(";dur="); return [name, Number(duration)]; }));
  expect(timing.backend).toBe(7.25);
  expect(timing.quota_regular).toBeGreaterThanOrEqual(10);
  expect(timing.quota_laya).toBeGreaterThanOrEqual(10);
  expect(timing.modal_fetch).toBeGreaterThanOrEqual(10);
  expect(timing.laya_run).toBeGreaterThanOrEqual(timing.modal_fetch);
  expect(timing.worker_total).toBeGreaterThanOrEqual(timing.quota_regular + timing.quota_laya + timing.laya_run - .1);
  expect(header).not.toContain(task.input);
});

test("timing headers exclude authenticated requests, Jev and failures", async () => {
  mockLaya();
  const response = await worker.fetch(new Request("https://classifier.dev/v1/classify", {
    method: "POST", headers: { authorization: "Bearer fixture" },
    body: JSON.stringify({ model: "laya", input: task.input, labels: task.labels }),
  }), { ...env, ENTERPRISE_API_KEY: "fixture" }, ctx);
  expect(response.status).toBe(200);
  expect(response.headers.has("server-timing")).toBe(false);
  const failure = await request({ input: task.input, labels: task.labels, processing: "invalid" });
  expect(failure.status).toBe(400);
  expect(failure.headers.has("server-timing")).toBe(false);
  globalThis.fetch = (async () => Response.json({ model: "jev-test", answers: {
    i0: { choice: "billing", confidence: .9, probabilities: { billing: .9, tech: .1 } },
  } })) as typeof fetch;
  const jev = await request({ model: "jev", input: task.input, labels: task.labels }, { ...env, TYPESAFE_API_KEY: "fixture" });
  expect(jev.status).toBe(200);
  expect(jev.headers.has("server-timing")).toBe(false);
});

test("lane limiter fails closed and respects quota refusal", async () => {
  await expect(limitLaya({ ...env, LIMITER: undefined! }, "fast", "anon", 1)).rejects.toMatchObject({ status: 503 });
  const denied = { ...env, LIMITER: { idFromName: () => "id", get: () => ({ fetch: async () => Response.json({ limited: true, remaining: 0, resetIn: 37 }) }) } } as unknown as Env;
  await expect(limitLaya(denied, "bulk", "anon", 1)).rejects.toMatchObject({ status: 429, retryAfter: 37 });
});

test("normal batch and tier rejection cannot debit Laya quota", async () => {
  const calls = mockLaya();
  const debits: string[] = [];
  const bindings = { ...env, LIMITER: {
    idFromName: (name: string) => name,
    get: (name: string) => ({ fetch: async () => {
      debits.push(name);
      return Response.json({ limited: true, remaining: 0, resetIn: 60 });
    } }),
  } } as unknown as Env;
  const oversized = await request({ inputs: Array(201).fill(task.input), labels: task.labels, tier: "smart", processing: "bulk" }, bindings);
  expect(oversized.status).toBe(400);
  expect(debits).toHaveLength(0);
  const blocked = await request({ input: task.input, labels: task.labels, tier: "smart" }, bindings);
  expect(blocked.status).toBe(429);
  expect(debits.length).toBeGreaterThan(0);
  expect(debits.every(name => !name.startsWith("laya:"))).toBe(true);
  expect(calls).toHaveLength(0);
});

test("trial billing explicitly prices both Laya lanes at zero without making reviews free", () => {
  const card = parseTokenRateCard(JSON.stringify(rates))!;
  for (const lane of ["fast", "bulk"]) {
    const model = `laya-0.3.4-routed-${lane}`;
    expect(providerCallBound(card, "modal", model, 0)).toBe(0);
    expect(priceTokens(card, [{ provider: "modal", model, calls: 1, inputTokens: 1000, outputTokens: 0, cachedInputTokens: 0 }])?.nanodollars).toBe(0n);
  }
  expect(providerCallBound(card, "openrouter", "google/gemini-3.8-flash", 2000)).toBeGreaterThan(0);
});
