import type { ModelTokenUsage } from "../cost";

type TokenRate = {
  provider: ModelTokenUsage["provider"];
  model: string;
  inputNanodollars: bigint;
  outputNanodollars: bigint;
  cachedInputNanodollars: bigint;
};

export type TokenRateCard = { version: string; models: TokenRate[] };
export type TokenCharge = { version: string; nanodollars: bigint };

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Rates are decimal USD per million tokens. Three decimal places resolve to
 * whole nanodollars per token (e.g. "0.042" => 42). Reject finer rates rather
 * than round each request: tiny rounding errors grow across 100M requests.
 */
function rate(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,8})(\.\d{1,3})?$/.test(value)) {
    throw new Error("Token prices must be nonnegative decimal strings with at most three decimal places (USD per million tokens).");
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
}

/**
 * An absent card disables retail token pricing. A supplied malformed card is
 * a deployment error, never an implicit free price. Every model is explicit;
 * there is no guessed fallback rate for a newly routed model.
 */
export function parseTokenRateCard(json: string | undefined): TokenRateCard | null {
  if (json === undefined || json.trim() === "") return null;
  const data = object(JSON.parse(json));
  if (!data || typeof data.version !== "string" || !/^[A-Za-z0-9_.-]{1,80}$/.test(data.version) || !Array.isArray(data.models) || !data.models.length) {
    throw new Error("Token rate card requires a version and explicit model prices.");
  }
  const seen = new Set<string>();
  const models = data.models.map(value => {
    const row = object(value);
    if (!row || !["typesafe", "vercel", "openrouter"].includes(String(row.provider)) || typeof row.model !== "string" || !row.model.trim() || row.model.length > 200) {
      throw new Error("Invalid provider or model in token rate card.");
    }
    const key = `${row.provider}:${row.model}`;
    if (seen.has(key)) throw new Error("Duplicate provider/model in token rate card.");
    seen.add(key);
    return {
      provider: row.provider as ModelTokenUsage["provider"], model: row.model,
      inputNanodollars: rate(row.inputUsdPerMillion),
      outputNanodollars: rate(row.outputUsdPerMillion),
      cachedInputNanodollars: rate(row.cachedInputUsdPerMillion),
    };
  });
  return { version: data.version, models };
}

function count(value: number | null): bigint | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
}

/**
 * Input includes cache reads. Apply its discount only to that subset; output
 * already includes reasoning when reported by OpenRouter. Null means pricing
 * is disabled, a model is unpriced, or a required measurement is unavailable.
 * A zero rate needs no token measurement, which allows Jev's input-only price.
 */
export function priceTokens(card: TokenRateCard | null, usage: readonly ModelTokenUsage[]): TokenCharge | null {
  if (!card || !usage.length) return null;
  let nanodollars = 0n;
  for (const row of usage) {
    const prices = card.models.find(price => price.provider === row.provider && price.model === row.model);
    if (!prices || !Number.isSafeInteger(row.calls) || row.calls < 1) return null;
    const input = count(row.inputTokens);
    const output = count(row.outputTokens);
    const cached = count(row.cachedInputTokens);
    if (prices.inputNanodollars === prices.cachedInputNanodollars) {
      if (prices.inputNanodollars !== 0n) {
        if (input === null) return null;
        nanodollars += input * prices.inputNanodollars;
      }
    } else {
      if (input === null || cached === null || cached > input) return null;
      nanodollars += (input - cached) * prices.inputNanodollars + cached * prices.cachedInputNanodollars;
    }
    if (prices.outputNanodollars !== 0n) {
      if (output === null) return null;
      nanodollars += output * prices.outputNanodollars;
    }
  }
  return { version: card.version, nanodollars };
}
