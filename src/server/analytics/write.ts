import type { AccountAnalyticsEnv, AccountAnalyticsEvent } from "./contracts";
import { validAccountIndex } from "./schema";

function clean(value: string, limit = 256): string {
  return value.replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/(?:classifier_(?:agent|pro)_|sk[_-]|ck_)[A-Za-z0-9_.-]+/g, "[redacted]").slice(0, limit);
}
/** Best effort only: this event must never authorize spending or fail inference. */
export function writeAccountAnalytics(env: AccountAnalyticsEnv, event: AccountAnalyticsEvent): boolean {
  if (!env.ACCOUNT_AE || !validAccountIndex(event.accountId)) return false;
  try {
    const known = (n: number | null | undefined) => typeof n === "number" && Number.isFinite(n) && n >= 0;
    const n = (value: number | null | undefined) => known(value) ? value as number : 0;
    // blob9 and double14 are retired content slots; leave them empty without
    // shifting the measurements in this append-only dataset.
    env.ACCOUNT_AE.writeDataPoint({
      indexes: [event.accountId],
      blobs: ["1", clean(event.requestId), clean(event.keyId ?? ""), clean(event.agentId ?? ""),
        event.source, event.tier, clean(event.model ?? ""), event.status, ""],
      doubles: [1, n(event.items), n(event.inputTokens), n(event.outputTokens), n(event.cachedInputTokens),
        n(event.providerCostUsd), n(event.retailCostUsd), n(event.latencyMs), n(event.escalations),
        Number(!known(event.inputTokens)), Number(!known(event.outputTokens)), Number(!known(event.providerCostUsd)),
        Number(!known(event.retailCostUsd)), 0, Number(!known(event.cachedInputTokens)),
        Number(!!event.longContext), n(event.longContext?.contextTokens),
        n(event.longContext?.screeningInputTokens), n(event.longContext?.finalInputTokens),
        Number(!!event.longContext && (!known(event.longContext.screeningInputTokens) || !known(event.longContext.finalInputTokens)))],
    });
    return true;
  } catch { return false; }
}
