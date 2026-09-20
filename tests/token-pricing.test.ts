import { expect, test } from "bun:test";
import { parseTokenRateCard, priceTokens } from "../src/server/token-pricing";
import type { ModelTokenUsage } from "../src/cost";

// Synthetic rates for arithmetic tests, not the product's retail price card.
const jevPrice = { provider: "typesafe", model: "jev-test", inputUsdPerMillion: "0.042", outputUsdPerMillion: "0", cachedInputUsdPerMillion: "0.042" };
const geminiPrice = { provider: "openrouter", model: "gemini-test", inputUsdPerMillion: "0.300", outputUsdPerMillion: "2.500", cachedInputUsdPerMillion: "0.030" };
const raw = (models: unknown[] = [jevPrice, geminiPrice]) => JSON.stringify({ version: "test-v1", models });
const card = parseTokenRateCard(raw());
const jev = (inputTokens: number | null): ModelTokenUsage => ({ provider: "typesafe", model: "jev-test", calls: 1, inputTokens, outputTokens: null, cachedInputTokens: null });
const gemini = (inputTokens = 100, outputTokens = 10, cachedInputTokens: number | null = 60): ModelTokenUsage => ({ provider: "openrouter", model: "gemini-test", calls: 1, inputTokens, outputTokens, cachedInputTokens });

test("prices Jev input only plus Gemini input/cache/output without double counting", () => {
  expect(priceTokens(card, [jev(1000), gemini()])).toEqual({
    version: "test-v1", nanodollars: 1000n * 42n + 40n * 300n + 60n * 30n + 10n * 2500n,
  });
});

test("individual requests and a batch settle to exactly the same amount", () => {
  const individually = Array.from({ length: 1000 }, () => priceTokens(card, [jev(1)])!.nanodollars).reduce((sum, value) => sum + value, 0n);
  expect(individually).toBe(priceTokens(card, [jev(1000)])!.nanodollars);
  expect(individually).toBe(42_000n);
  expect(priceTokens(card, Array.from({ length: 1000 }, () => gemini(3, 1, 2)))!.nanodollars)
    .toBe(priceTokens(card, [gemini(3000, 1000, 2000)])!.nanodollars);
});

test("BigInt preserves exact prices when totals exceed JavaScript safe integers", () => {
  const tokens = Number.MAX_SAFE_INTEGER;
  expect(priceTokens(card, [jev(tokens)])!.nanodollars).toBe(BigInt(tokens) * 42n);
});

test("absent config disables token prices; missing measurements cannot become free", () => {
  expect(parseTokenRateCard(undefined)).toBeNull();
  expect(parseTokenRateCard(" ")).toBeNull();
  expect(priceTokens(null, [jev(10)])).toBeNull();
  expect(priceTokens(card, [])).toBeNull();
  expect(priceTokens(card, [jev(null)])).toBeNull();
  expect(priceTokens(card, [gemini(100, 10, null)])).toBeNull();
  expect(priceTokens(card, [{ ...gemini(), outputTokens: null }])).toBeNull();
  expect(priceTokens(card, [{ ...gemini(), inputTokens: NaN }])).toBeNull();
  expect(priceTokens(card, [{ ...gemini(), cachedInputTokens: 101 }])).toBeNull();
  expect(priceTokens(card, [{ ...jev(5), model: "new-jev" }])).toBeNull();
  expect(priceTokens(card, [{ ...jev(5), provider: "vercel" }])).toBeNull();
  expect(priceTokens(card, [{ ...jev(5), calls: 0 }])).toBeNull();
});

test("measured zero usage is free; explicit zero rates do not require unavailable usage", () => {
  expect(priceTokens(card, [jev(0), gemini(0, 0, 0)])!.nanodollars).toBe(0n);
  const free = parseTokenRateCard(raw([{ ...jevPrice, inputUsdPerMillion: "0", cachedInputUsdPerMillion: "0" }]));
  expect(priceTokens(free, [jev(null)])!.nanodollars).toBe(0n);
});

test.each(["0.0001", "-1", ".042", "1e-3", "NaN", "Infinity", 0.042, null, undefined, "", "1.2345"])(
  "invalid precision or non-decimal rate %s is rejected instead of rounded", (value) => {
    expect(() => parseTokenRateCard(raw([{ ...jevPrice, inputUsdPerMillion: value }]))).toThrow();
  },
);

test("incomplete or ambiguous supplied configurations fail closed", () => {
  for (const config of ["{", "null", "{}", raw([]), raw([jevPrice, jevPrice]), raw([{ ...jevPrice, provider: "unknown" }]), JSON.stringify({ version: "", models: [jevPrice] })]) {
    expect(() => parseTokenRateCard(config)).toThrow();
  }
  expect(() => parseTokenRateCard(raw([{ ...jevPrice, outputUsdPerMillion: undefined }]))).toThrow();
});
