import { afterEach, expect, spyOn, test } from "bun:test";
import { planLaya, runLaya, readQuotaTiming, type QuotaTiming, type LayaEnv, type LayaTiming } from "../src/laya";

test("quota timing accepts only known finite numeric spans", () => {
  const timing: QuotaTiming = {};
  readQuotaTiming(new Response(null, { headers: { "server-timing": "handler;dur=9.50, read;dur=2, write;dur=7.5, secret;dur=123, read;dur=-5, write;dur=Infinity" } }), timing);
  expect(timing).toEqual({ handler: 9.5, read: 2, write: 7.5 });
  readQuotaTiming(new Response(null), timing);
  expect(timing.handler).toBe(9.5);
});

const originalFetch = globalThis.fetch;
let clock: ReturnType<typeof spyOn> | undefined;
afterEach(() => {
  globalThis.fetch = originalFetch;
  clock?.mockRestore();
  clock = undefined;
});
const env = { LAYA_ENABLED: "true", LAYA_FAST_URL: "https://fast.example", LAYA_BULK_URL: "https://bulk.example",
  LAYA_MODAL_KEY: "fixture", LAYA_MODAL_SECRET: "fixture" } as LayaEnv;
const task = { input: "refund", labels: ["billing", "support"] };

function mockBackend(durations: unknown[]) {
  let calls = 0;
  globalThis.fetch = (async (_url, init) => {
    const { batch } = JSON.parse(String(init?.body));
    const body = { inference_ms: durations[calls++], results: batch.map(() => ({
      routing: { model: "english" }, usage: { input_tokens: 20 }, answers: {
        q: { choice: "billing", confidence: .9, probabilities: { billing: .9, support: .1 } },
      },
    })) };
    // Preserve non-finite values here to exercise the parser's runtime guard,
    // rather than JSON.stringify silently converting them to null.
    const response = Response.json({});
    response.json = async () => body;
    return response;
  }) as typeof fetch;
  return () => calls;
}

test.each([0, 12.5])("records finite nonnegative backend duration %s", async backendMs => {
  mockBackend([backendMs]);
  const timing: LayaTiming = {};
  const results = await runLaya(env, planLaya([task], "fast"), undefined, timing);
  expect(results[0].label).toBe("billing");
  expect(timing.backendMs).toBe(backendMs);
  expect(Number.isFinite(timing.fetchMs)).toBe(true);
  expect(timing.fetchMs!).toBeGreaterThanOrEqual(timing.headersMs!);
});

test.each([undefined, null, -1, "12.5", NaN, Infinity, {}])("ignores absent or invalid backend duration %j", async duration => {
  mockBackend([duration]);
  const timing: LayaTiming = {};
  expect(await runLaya(env, planLaya([task], "fast"), undefined, timing)).toHaveLength(1);
  expect(timing).not.toHaveProperty("backendMs");
  expect(Number.isFinite(timing.fetchMs)).toBe(true);
});

test("aggregates bulk chunk durations instead of overwriting with the last chunk", async () => {
  const calls = mockBackend([2.25, 4.5]);
  const timestamps = [0, 3, 5, 10, 14, 17];
  clock = spyOn(performance, "now").mockImplementation(() => timestamps.shift()!);
  const timing: LayaTiming = {};
  expect(await runLaya(env, planLaya(Array.from({ length: 65 }, () => task), "bulk"), undefined, timing)).toHaveLength(65);
  expect(calls()).toBe(2);
  expect(timing).toEqual({ headersMs: 7, fetchMs: 12, backendMs: 6.75 });
});

test("timing remains optional for existing callers", async () => {
  mockBackend([12]);
  expect(await runLaya(env, planLaya([task], "fast"))).toHaveLength(1);
});

test.each([{ durations: [2.25, undefined] }, { durations: [undefined, 2.25] }])("omits an incomplete bulk backend total %j", async ({ durations }) => {
  mockBackend(durations);
  const timing: LayaTiming = {};
  expect(await runLaya(env, planLaya(Array.from({ length: 65 }, () => task), "bulk"), undefined, timing)).toHaveLength(65);
  expect(timing).not.toHaveProperty("backendMs");
  expect(Number.isFinite(timing.fetchMs)).toBe(true);
});
