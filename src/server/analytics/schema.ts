/** Append-only v1 mapping. Never change an existing column's meaning. */
export const ACCOUNT_DATASET = "classifier_account_events";
export const blobs = {
  version: "blob1", requestId: "blob2", keyId: "blob3", agentId: "blob4",
  source: "blob5", tier: "blob6", model: "blob7", status: "blob8", content: "blob9",
} as const;
export const doubles = {
  requests: "double1", items: "double2", inputTokens: "double3", outputTokens: "double4",
  cachedInputTokens: "double5", providerCostUsd: "double6", retailCostUsd: "double7",
  latencyMs: "double8", escalations: "double9", missingInputTokens: "double10",
  missingOutputTokens: "double11", missingProviderCost: "double12", missingRetailCost: "double13",
  truncatedContent: "double14", missingCachedTokens: "double15",
} as const;
export function validAccountIndex(value: string): boolean {
  return /^[A-Za-z0-9_:@.\-]{1,96}$/.test(value);
}
