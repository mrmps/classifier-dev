import type { Meter, TokenCounts } from "./cost";
import { CLASSIFICATION_PRICING, classificationCharge, classificationInputTokens, INPUT_PRICE_PER_MILLION } from "./lib/classification-pricing";

export function classificationUsage(meter: Meter) {
  const sum = (field: keyof TokenCounts): number | null => {
    if (!meter.tokens.length || meter.tokens.some(row => row[field] === null)) return null;
    const total = meter.tokens.reduce((n, row) => n + row[field]!, 0);
    return Number.isSafeInteger(total) ? total : null;
  };
  const input = sum("inputTokens"), output = sum("outputTokens");
  const total = input === null || output === null ? null : input + output;
  return {
    input_tokens: input, output_tokens: output,
    total_tokens: total !== null && Number.isSafeInteger(total) ? total : null,
    cached_input_tokens: sum("cachedInputTokens"),
    models: meter.tokens.map(row => ({ provider: row.provider, model: row.model, calls: row.calls,
      input_tokens: row.inputTokens, output_tokens: row.outputTokens, cached_input_tokens: row.cachedInputTokens })),
  };
}

export function classificationPricing(meter: Meter, escalations: number) {
  const input = classificationInputTokens(meter.tokens);
  return {
    currency: "USD",
    rate_version: CLASSIFICATION_PRICING.version,
    input_tokens: input,
    escalations,
    input_usd_per_million: INPUT_PRICE_PER_MILLION,
    usd_per_escalation: CLASSIFICATION_PRICING.escalationNanodollars / 1e9,
    estimated_usd: input === null ? null : Number(classificationCharge(input, escalations).nanodollars) / 1e9,
    total_usd: 0,
    billing_status: "not_billed",
  };
}

export async function withResponsePricing(response: Response, pricing: object): Promise<Response> {
  const body = await response.json() as Record<string, unknown>;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return Response.json({ ...body, pricing }, { status: response.status, headers });
}
