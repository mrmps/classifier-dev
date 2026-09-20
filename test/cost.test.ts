import { expect, test } from "bun:test";
import { addTokens, addJevCost, addUsd, newMeter } from "../src/cost";

test("usage accumulates by provider/model and cached reads remain a subset of input", () => {
  const meter = newMeter();
  addTokens(meter, "typesafe", "jev-test", { inputTokens: 500 });
  addTokens(meter, "openrouter", "google/gemini-3.8-flash", { inputTokens: 200, outputTokens: 100, cachedInputTokens: 150 });
  addTokens(meter, "openrouter", "google/gemini-3.8-flash", { inputTokens: 100, outputTokens: 20, cachedInputTokens: 0 });
  addTokens(meter, "vercel", "jev-test", { inputTokens: 50, outputTokens: 0 });
  expect(meter.tokens).toEqual([
    { provider: "typesafe", model: "jev-test", calls: 1, inputTokens: 500, outputTokens: null, cachedInputTokens: null },
    { provider: "openrouter", model: "google/gemini-3.8-flash", calls: 2, inputTokens: 300, outputTokens: 120, cachedInputTokens: 150 },
    { provider: "vercel", model: "jev-test", calls: 1, inputTokens: 50, outputTokens: 0, cachedInputTokens: null },
  ]);
  expect(meter.usd).toBe(0);
});

test.each([undefined, null, "12", "", true, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
  "invalid or absent usage (%s) cannot become zero or a partial sum",
  (value) => {
    const meter = newMeter();
    addTokens(meter, "openrouter", "model", { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 });
    addTokens(meter, "openrouter", "model", { inputTokens: value, outputTokens: value, cachedInputTokens: value });
    addTokens(meter, "openrouter", "model", { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 });
    expect(meter.tokens).toEqual([
      { provider: "openrouter", model: "model", calls: 3, inputTokens: null, outputTokens: null, cachedInputTokens: null },
    ]);
  },
);

test("zeroes are measured; impossible cache counts and overflowing sums stay unknown", () => {
  const meter = newMeter();
  addTokens(meter, "openrouter", "zero", { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 });
  addTokens(meter, "openrouter", "cache", { inputTokens: 10, outputTokens: 2, cachedInputTokens: 11 });
  addTokens(meter, "openrouter", "overflow", { inputTokens: Number.MAX_SAFE_INTEGER });
  addTokens(meter, "openrouter", "overflow", { inputTokens: 1 });
  expect(meter.tokens[0]).toMatchObject({ inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 });
  expect(meter.tokens[1]).toMatchObject({ inputTokens: 10, outputTokens: 2, cachedInputTokens: null });
  expect(meter.tokens[2].inputTokens).toBeNull();
});

test("token accumulation is independent of existing upstream cost accounting and per request", () => {
  const meter = newMeter();
  addJevCost(meter, 1000);
  addUsd(meter, 0.01);
  addTokens(meter, "typesafe", "jev", { inputTokens: 1000 });
  expect(meter.usd).toBeCloseTo(0.010042, 12);
  expect(newMeter()).toEqual({ usd: 0, tokens: [] });
  expect(() => addTokens(undefined, "typesafe", "jev", {})).not.toThrow();
});
