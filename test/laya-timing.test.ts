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
const env = { LAYA_ENABLED: "true" } as LayaEnv;
const keys = { beam: "beam-key" };
const task = { input: "refund", labels: ["billing", "support"] };

/**
 * Beam answers in System One's shape and reports no server-side duration, so
 * the only span there is to record is the client-side one.
 */
function mockBeam() {
  let calls = 0;
  globalThis.fetch = (async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body)) as { state: { id: string }[] };
    const answers = Object.fromEntries(body.state.map(item => [item.id, {
      choice: "billing", confidence: .9, probabilities: { billing: .9, support: .1 },
    }]));
    return Response.json({ model: "jev/laya", answers, usage: { input_tokens: 20 * body.state.length, output_tokens: 0 } });
  }) as typeof fetch;
  return () => calls;
}

test("records a client-side span for a fast call", async () => {
  mockBeam();
  const timing: LayaTiming = {};
  const results = await runLaya(env, keys, planLaya([task], "fast"), undefined, timing);
  expect(results[0].label).toBe("billing");
  expect(Number.isFinite(timing.fetchMs)).toBe(true);
  expect(timing.fetchMs!).toBeGreaterThanOrEqual(0);
});

test("reports no backend duration, because Beam does not return one", async () => {
  mockBeam();
  const timing: LayaTiming = {};
  await runLaya(env, keys, planLaya([task], "fast"), undefined, timing);
  expect(timing).not.toHaveProperty("backendMs");
  expect(timing).not.toHaveProperty("headersMs");
});

test("a bulk span covers every chunk, not just the last", async () => {
  const calls = mockBeam();
  const timestamps = [0, 17];
  clock = spyOn(performance, "now").mockImplementation(() => timestamps.shift() ?? 17);
  const timing: LayaTiming = {};
  // 65 items exceed Laya's 16-item ceiling, so this is several Beam requests.
  expect(await runLaya(env, keys, planLaya(Array.from({ length: 65 }, () => task), "bulk"), undefined, timing)).toHaveLength(65);
  expect(calls()).toBeGreaterThan(1);
  expect(timing).toEqual({ fetchMs: 17 });
});

test("timing remains optional for existing callers", async () => {
  mockBeam();
  expect(await runLaya(env, keys, planLaya([task], "fast"))).toHaveLength(1);
});
