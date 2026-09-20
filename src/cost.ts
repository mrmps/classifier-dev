/**
 * What a request cost us to answer, in USD.
 *
 * Both figures come from the providers' own accounting rather than a price
 * list, which is the same rule /benchmark is held to: OpenRouter returns the
 * charge for a call when the request asks for it, and TypeSafe bills Jev on
 * input tokens at the rate below. `eval/bench.py` prices the benchmarks the
 * same two ways, so a number on the dashboard and a number on /benchmark mean
 * the same thing.
 *
 * One request can make several upstream calls — a packed Jev batch is one call
 * per chunk, the smart tier adds one per escalated item, and the LLM fallback
 * is one per input — so spend accumulates in a meter that is threaded through
 * the call chain and read once, at the end, by `record()`.
 */

/** TypeSafe bills Jev per input token: $0.042 per million. */
export const JEV_USD_PER_MTOK = 0.042;

export type TokenCounts = {
  /** Includes cached input; subtract cachedInputTokens only when both are known. */
  inputTokens: number | null;
  /** Includes reasoning tokens when the provider includes them in its completion count. */
  outputTokens: number | null;
  cachedInputTokens: number | null;
};

export type ModelTokenUsage = TokenCounts & {
  provider: "typesafe" | "vercel" | "openrouter" | "modal";
  model: string;
  calls: number;
};

/** Per-request accumulator. Token counts are upstream usage, not a retail price. */
export type Meter = {
  usd: number;
  tokens: ModelTokenUsage[];
  /** Trusted account billing hook. Called before every provider attempt, never HTTP supplied. */
  beforeCall?: (provider: ModelTokenUsage["provider"], model: string, maxOutputTokens: number) => Promise<void>;
};

export const newMeter = (): Meter => ({ usd: 0, tokens: [] });

/** Missing, coerced, or invalid provider counts must never look like measured zeroes. */
function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function sumTokens(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : tokenCount(a + b);
}

/**
 * Add one answered upstream call. Unknown counts propagate through a model's
 * total so billing cannot mistake a partial measurement for complete usage.
 * Cache reads are a subset of input tokens and must not be added a second time.
 */
export function addTokens(
  meter: Meter | undefined,
  provider: ModelTokenUsage["provider"],
  model: string,
  usage: { inputTokens?: unknown; outputTokens?: unknown; cachedInputTokens?: unknown },
) {
  if (!meter) return;
  const inputTokens = tokenCount(usage.inputTokens);
  const outputTokens = tokenCount(usage.outputTokens);
  let cachedInputTokens = tokenCount(usage.cachedInputTokens);
  if (inputTokens !== null && cachedInputTokens !== null && cachedInputTokens > inputTokens) cachedInputTokens = null;
  const existing = meter.tokens.find((row) => row.provider === provider && row.model === model);
  if (existing) {
    existing.calls++;
    existing.inputTokens = sumTokens(existing.inputTokens, inputTokens);
    existing.outputTokens = sumTokens(existing.outputTokens, outputTokens);
    existing.cachedInputTokens = sumTokens(existing.cachedInputTokens, cachedInputTokens);
  } else {
    meter.tokens.push({ provider, model, calls: 1, inputTokens, outputTokens, cachedInputTokens });
  }
}

/** Jev is priced off the input-token count it reports back. */
export function addJevCost(meter: Meter | undefined, inputTokens: unknown) {
  const n = Number(inputTokens);
  if (meter && Number.isFinite(n) && n > 0) meter.usd += (n * JEV_USD_PER_MTOK) / 1e6;
}

/** OpenRouter reports the charge for the call directly, already in USD. */
export function addUsd(meter: Meter | undefined, usd: unknown) {
  const n = Number(usd);
  if (meter && Number.isFinite(n) && n > 0) meter.usd += n;
}
