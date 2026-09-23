import type { LongContextAnalyticsEnv, LongContextStats } from "./server/analytics/contracts";

/** Called once by request completion, independently of account analytics and billing. */
export function recordLongContext(
  env: LongContextAnalyticsEnv,
  stats: LongContextStats | undefined,
  status: "success" | "error",
): boolean {
  if (!env.LONG_CONTEXT_AE || !stats) return false;
  try {
    const known = (value: number | null) => typeof value === "number" && Number.isFinite(value) && value >= 0;
    const n = (value: number | null) => known(value) ? value as number : 0;
    env.LONG_CONTEXT_AE.writeDataPoint({
      indexes: [],
      blobs: ["1", status, "cl100k_base"],
      doubles: [1, n(stats.contextTokens), n(stats.documents), n(stats.chunks),
        n(stats.screenedChunks), n(stats.eligibleChunks), n(stats.selectedChunks), n(stats.omittedChunks),
        n(stats.screeningInputTokens), n(stats.finalInputTokens),
        Number(!known(stats.screeningInputTokens)), Number(!known(stats.finalInputTokens)),
        n(stats.screeningCalls), n(stats.finalCalls), n(stats.screeningMs), n(stats.finalMs)],
    });
    return true;
  } catch { return false; }
}
