/** Append-only v1 mapping. Never change an existing column's meaning. */
export const ACCOUNT_DATASET = "classifier_account_events";
export const blobs = {
  version: "blob1", requestId: "blob2", keyId: "blob3", agentId: "blob4",
  source: "blob5", tier: "blob6", model: "blob7", status: "blob8",
} as const;
export const doubles = {
  requests: "double1", items: "double2", inputTokens: "double3", outputTokens: "double4",
  cachedInputTokens: "double5", providerCostUsd: "double6", retailCostUsd: "double7",
  latencyMs: "double8", escalations: "double9", missingInputTokens: "double10",
  missingOutputTokens: "double11", missingProviderCost: "double12", missingRetailCost: "double13",
  missingCachedTokens: "double15",
  longContextRequests: "double16", contextTokens: "double17",
  screeningInputTokens: "double18", finalInputTokens: "double19",
  missingLongContextUsage: "double20",
} as const;

/** One event per long-context request, including errors; no caller or content identifiers. */
export const LONG_CONTEXT_DATASET = "classifier_long_context_events";
export const longContextBlobs = { version: "blob1", status: "blob2", tokenizer: "blob3" } as const;
export const longContextDoubles = {
  requests: "double1", contextTokens: "double2", documents: "double3", chunks: "double4",
  screenedChunks: "double5", eligibleChunks: "double6", selectedChunks: "double7", omittedChunks: "double8",
  screeningInputTokens: "double9", finalInputTokens: "double10",
  missingScreeningInputTokens: "double11", missingFinalInputTokens: "double12",
  screeningCalls: "double13", finalCalls: "double14", screeningMs: "double15", finalMs: "double16",
} as const;
export function validAccountIndex(value: string): boolean {
  return /^[A-Za-z0-9_:@.\-]{1,96}$/.test(value);
}
