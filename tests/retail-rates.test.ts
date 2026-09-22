import { expect, test } from "bun:test";
import rates from "../src/retail-rates.json";
import { JEV_USD_PER_MTOK, type ModelTokenUsage } from "../src/cost";
import { parseTokenRateCard, priceTokens } from "../src/server/token-pricing";

const card = parseTokenRateCard(JSON.stringify(rates));
const jev = (inputTokens: number): ModelTokenUsage => ({
  provider: "typesafe", model: "jev-1.13.0", calls: 1,
  inputTokens, outputTokens: null, cachedInputTokens: null,
});
const gemini = (inputTokens: number, outputTokens: number, cachedInputTokens = 0): ModelTokenUsage => ({
  provider: "openrouter", model: "google/gemini-3.8-flash", calls: 1,
  inputTokens, outputTokens, cachedInputTokens,
});

test("launch Jev retail price matches the provider-cost constant exactly", () => {
  expect(Number(rates.models[0].inputUsdPerMillion)).toBe(JEV_USD_PER_MTOK);
  expect(priceTokens(card, [jev(1_000_000)])!.nanodollars).toBe(42_000_000n);
  expect(priceTokens(card, [jev(1)])!.nanodollars).toBe(42n);
});

test("launch Gemini input/output/cache rates are precisely 20 percent above verified list rates", () => {
  expect(priceTokens(card, [gemini(1_000_000, 0)])!.nanodollars).toBe(750_000_000n * 6n / 5n);
  expect(priceTokens(card, [gemini(0, 1_000_000)])!.nanodollars).toBe(3_750_000_000n * 6n / 5n);
  expect(priceTokens(card, [gemini(1_000_000, 0, 1_000_000)])!.nanodollars).toBe(75_000_000n * 6n / 5n);
});

test("Smart adds only actual escalation usage, without a tier fee or double-counting cached input", () => {
  const base = priceTokens(card, [jev(1000)])!;
  expect(base.nanodollars).toBe(42_000n);
  const escalated = priceTokens(card, [jev(1000), gemini(1000, 100, 250)])!;
  expect(escalated.nanodollars).toBe(42_000n + 750n * 900n + 250n * 90n + 100n * 4500n);
  expect(escalated.version).toBe(rates.version);
});

test("unpriced fallback, gateway and changed model versions never inherit a guessed price", () => {
  expect(priceTokens(card, [{ ...jev(1), model: "jev-new" }])).toBeNull();
  expect(priceTokens(card, [{ ...jev(1), provider: "vercel", model: "jev@vercel" }])).toBeNull();
  expect(priceTokens(card, [{ ...gemini(1, 1), model: "unconfigured/fallback" }])).toBeNull();
});
