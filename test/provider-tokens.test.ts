import { afterEach, expect, spyOn, test } from "bun:test";
import * as cost from "../src/cost";
import worker, { type Env } from "../src/index";
import { jevClassify, resetGatewayPause } from "../src/jev";

const realFetch = globalThis.fetch;
const realSetTimeout = globalThis.setTimeout;
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
const env = { OPENROUTER_API_KEY: "test", TYPESAFE_API_KEY: "test", STATS: { get: async () => null, put: async () => {} } } as unknown as Env;
let meterSpy: ReturnType<typeof spyOn> | undefined;

afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.setTimeout = realSetTimeout;
  meterSpy?.mockRestore();
  resetGatewayPause();
});

async function classify() {
  return worker.fetch(new Request("https://classifier.dev/v1/classify", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ inputs: ["broken checkout", "missing feature"], labels: ["bug", "feature"], tier: "smart" }),
  }), env, ctx);
}

test("Smart preserves batch Jev tokens and adds every Gemini escalation including reasoning and cached input", async () => {
  const meter = cost.newMeter();
  meterSpy = spyOn(cost, "newMeter").mockReturnValue(meter);
  globalThis.fetch = (async (url) => {
    if (String(url).includes("typesafe.ai")) return Response.json({
      model: "jev-1.13.0", usage: { input_tokens: 320, output_tokens: 12 },
      answers: Object.fromEntries(["i0", "i1"].map(id => [id, { choice: "bug", confidence: 0.5, probabilities: { bug: 0.5, feature: 0.5 } }])),
    });
    return Response.json({ model: "google/gemini-3.8-flash", choices: [{ message: { content: "B" } }], usage: {
      prompt_tokens: 100, completion_tokens: 31, prompt_tokens_details: { cached_tokens: 60 },
      completion_tokens_details: { reasoning_tokens: 30 }, cost: 0.001,
    } });
  }) as typeof fetch;
  const response = await classify();
  expect(response.status).toBe(200);
  const body = await response.json() as { results: { label: string; escalated: boolean }[] };
  expect(body.results.every(result => result.label === "feature" && result.escalated)).toBe(true);
  expect(meter.tokens).toEqual([
    { provider: "typesafe", model: "jev-1.13.0", calls: 1, inputTokens: 320, outputTokens: 12, cachedInputTokens: null },
    { provider: "openrouter", model: "google/gemini-3.8-flash", calls: 2, inputTokens: 200, outputTokens: 62, cachedInputTokens: 120 },
  ]);
  expect(meter.usd).toBeCloseTo(0.002 + 320 * 0.042 / 1e6, 12);
});

test("transport failures invent no usage and a valid answer without usage is explicitly unknown", async () => {
  const meter = cost.newMeter();
  meterSpy = spyOn(cost, "newMeter").mockReturnValue(meter);
  globalThis.setTimeout = ((callback: TimerHandler, _ms?: number, ...args: unknown[]) => realSetTimeout(callback, 0, ...args)) as typeof setTimeout;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (calls <= 3) throw new Error("offline");
    return Response.json({ choices: [{ message: { content: "A" } }] });
  }) as typeof fetch;
  const response = await classify();
  expect(response.status).toBe(200);
  expect(meter.tokens).toEqual([
    { provider: "openrouter", model: "google/gemini-3.8-flash", calls: 2, inputTokens: null, outputTokens: null, cachedInputTokens: null },
  ]);
  expect(meter.usd).toBe(0);
});

test("a refused gateway contributes no tokens when direct TypeSafe answers", async () => {
  const meter = cost.newMeter();
  globalThis.fetch = (async (url) => String(url).includes("vercel.sh")
    ? Response.json({ error: { type: "rate_limit" }, usage: { inputTokens: 900 } }, { status: 429 })
    : Response.json({ model: "jev-test", usage: { input_tokens: 50 }, answers: {
      i0: { choice: "bug", confidence: 0.9, probabilities: { bug: 0.9, feature: 0.1 } },
    } })) as typeof fetch;
  await jevClassify({ gateway: "gateway", typesafe: "direct" }, ["broken"], ["bug", "feature"], undefined, false, meter);
  expect(meter.tokens).toEqual([
    { provider: "typesafe", model: "jev-test", calls: 1, inputTokens: 50, outputTokens: null, cachedInputTokens: null },
  ]);
});

test("a failed multi-label chunk waits for sibling usage before returning", async () => {
  const meter = cost.newMeter();
  let admissions = 0;
  // Admit the first two chunks, then refuse retries of the failed chunk.
  meter.beforeCall = async () => { if (++admissions > 2) throw new Error("budget exhausted"); };
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  globalThis.fetch = (async () => {
    if (++calls === 1) return Response.json({ error: { code: "invalid_request" } }, { status: 400 });
    await delayed;
    return Response.json({ model: "chunk-fixture", choices: [{ message: { content: "1" } }],
      usage: { prompt_tokens: 100, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 0 } } });
  }) as typeof fetch;
  let finished = false;
  const response = worker.fetch(new Request("https://classifier.dev/v1/classify", {
    method: "POST", body: JSON.stringify({ input: "a useful sentence", multi: true,
      labels: Array.from({ length: 13 }, (_, i) => `label-${i}`) }),
  }), { ...env, TYPESAFE_API_KEY: undefined }, ctx, { meter }).then(result => { finished = true; return result; });
  try {
    await new Promise(resolve => realSetTimeout(resolve, 20));
    expect(calls).toBe(2);
    expect(finished).toBe(false);
  } finally {
    release();
    await response;
  }
  expect((await response).status).toBe(502);
  expect(meter.tokens).toEqual([
    { provider: "openrouter", model: "chunk-fixture", calls: 1, inputTokens: 100, outputTokens: 1, cachedInputTokens: 0 },
  ]);
});
