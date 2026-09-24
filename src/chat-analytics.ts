import { callerId, type PrivacyEnv } from "./privacy";

export const CHAT_DATASET = "classifier_chat_events";
export const CHAT_FIELDS = [
  "turns",
  "ms",
  "modelCalls",
  "inputTokens",
  "outputTokens",
  "usd",
  "unknownTokenCalls",
  "unknownCostCalls",
  "toolCalls",
  "classifyCalls",
  "webSearches",
  "pageReads",
  "clockCalls",
  "toolErrors",
  "starts",
] as const;
export type ChatStats = Record<(typeof CHAT_FIELDS)[number], number>;
export type ChatOutcome =
  | "completed"
  | "failed"
  | "stopped"
  | "rate_limited"
  | "invalid_request"
  | "unavailable";
export const chatStats = (): ChatStats =>
  Object.fromEntries(
    CHAT_FIELDS.map((key) => [key, key === "turns" ? 1 : 0]),
  ) as ChatStats;

export async function recordChat(
  env: PrivacyEnv & { CHAT_AE?: AnalyticsEngineDataset },
  ip: string,
  outcome: ChatOutcome,
  stats: ChatStats,
) {
  if (!env.CHAT_AE) return;
  try {
    env.CHAT_AE.writeDataPoint({
      indexes: [await callerId(env, ip)],
      blobs: ["1", outcome],
      doubles: CHAT_FIELDS.map((key) => stats[key]),
    });
  } catch {
    /* Analytics must not interrupt the conversation. */
  }
}
