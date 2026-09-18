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

/** Per-request spend accumulator. One per request — never a module global. */
export type Meter = { usd: number };

export const newMeter = (): Meter => ({ usd: 0 });

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
