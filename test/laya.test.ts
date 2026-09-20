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
      })), usage: { input_tokens: 20 },
    })) });
  }) as typeof fetch;
  return calls;
}

test("bulk chunks by question count, retains order and meters the selected lane", async () => {
  const calls = mockLaya(), meter = newMeter();
  const tasks = Array.from({ length: 1000 }, (_, i) => ({ ...task, input: String(i) }));
  const result = await runLaya(env, planLaya(tasks, "bulk"), meter);
  expect(calls).toHaveLength(16);
  expect(calls.every(c => c.url === "https://bulk.example/predict" && c.rows.length <= 64)).toBe(true);
  expect(calls.flatMap(c => c.rows.map(r => r.state))).toEqual(tasks.map(t => t.input));
  expect(result).toHaveLength(1000);
  expect(meter.tokens[0]).toMatchObject({ provider: "modal", calls: 16, inputTokens: 20_000 });
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

test("lane limiter fails closed and respects quota refusal", async () => {
  await expect(limitLaya({ ...env, LIMITER: undefined! }, "fast", "anon", 1)).rejects.toMatchObject({ status: 503 });
  const denied = { ...env, LIMITER: { idFromName: () => "id", get: () => ({ fetch: async () => Response.json({ limited: true, remaining: 0, resetIn: 37 }) }) } } as unknown as Env;
  await expect(limitLaya(denied, "bulk", "anon", 1)).rejects.toMatchObject({ status: 429, retryAfter: 37 });
});

test("trial billing explicitly prices both Laya lanes at zero without making reviews free", () => {
  const card = parseTokenRateCard(JSON.stringify(rates))!;
  for (const lane of ["fast", "bulk"]) {
    const model = `laya-0.3.4-english-${lane}`;
    expect(providerCallBound(card, "modal", model, 0)).toBe(0);
    expect(priceTokens(card, [{ provider: "modal", model, calls: 1, inputTokens: 1000, outputTokens: 0, cachedInputTokens: 0 }])?.nanodollars).toBe(0n);
  }
  expect(providerCallBound(card, "openrouter", "google/gemini-3.8-flash", 2000)).toBeGreaterThan(0);
});
