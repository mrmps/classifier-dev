import type { ModelTokenUsage } from "../cost";

export const CLASSIFICATION_PRICING = {
  version: "2026-09-22-input-escalation-v1",
  inputNanodollars: 42,
  escalationNanodollars: 2_000_000,
} as const;

export const INPUT_PRICE_PER_MILLION = CLASSIFICATION_PRICING.inputNanodollars / 1000;
export const ESCALATION_PRICE_PER_THOUSAND = CLASSIFICATION_PRICING.escalationNanodollars / 1e6;

export function classificationCharge(inputTokens: number, escalations: number) {
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 || !Number.isSafeInteger(escalations) || escalations < 0)
    throw new Error("Invalid classification billing counts.");
  return { version: CLASSIFICATION_PRICING.version,
    nanodollars: BigInt(inputTokens) * BigInt(CLASSIFICATION_PRICING.inputNanodollars)
      + BigInt(escalations) * BigInt(CLASSIFICATION_PRICING.escalationNanodollars) };
}

export function classificationInputTokens(tokens: ModelTokenUsage[]): number | null {
  // Only answered primary calls count. Recovery and Smart provider costs are ours.
  const primary = tokens.filter(row => row.provider === "typesafe" || row.provider === "vercel");
  return primary.every(row => row.inputTokens !== null)
    ? primary.reduce((sum, row) => sum + row.inputTokens!, 0) : null;
}
