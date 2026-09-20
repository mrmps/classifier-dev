import type { AccountAnalyticsEnv, AccountAnalyticsEvent } from "./contracts";
import { validAccountIndex } from "./schema";

const encoder = new TextEncoder();
function clean(value: string, limit = 256): string {
  return value.replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/(?:classifier_(?:agent|pro)_|sk[_-]|ck_)[A-Za-z0-9_.-]+/g, "[redacted]").slice(0, limit);
}
function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[truncated]";
  if (typeof value === "string") return clean(value, 2000);
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => sanitize(entry, depth + 1));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 30).map(([key, entry]) =>
    [clean(key, 80), /authorization|cookie|password|secret|token|api.?key/i.test(key) ? "[redacted]" : sanitize(entry, depth + 1)]));
  return undefined;
}
/** Best effort only: this event must never authorize spending or fail inference. */
export function writeAccountAnalytics(env: AccountAnalyticsEnv, event: AccountAnalyticsEvent): boolean {
  if (!env.ACCOUNT_AE || !validAccountIndex(event.accountId)) return false;
  try {
    let content = "";
    let truncated = 0;
    if (env.ACCOUNT_ANALYTICS_CONTENT_ENABLED === "true" && event.content !== undefined) {
      content = JSON.stringify(sanitize(event.content)) ?? "";
      // Do not split UTF-8/JSON: discard oversize content, retaining an explicit flag.
      if (encoder.encode(content).length > 10_000) { content = ""; truncated = 1; }
      else truncated = Number(content !== JSON.stringify(event.content));
    }
    const known = (n: number | null | undefined) => typeof n === "number" && Number.isFinite(n) && n >= 0;
    const n = (value: number | null | undefined) => known(value) ? value as number : 0;
    env.ACCOUNT_AE.writeDataPoint({
      indexes: [event.accountId],
      blobs: ["1", clean(event.requestId), clean(event.keyId ?? ""), clean(event.agentId ?? ""),
        event.source, event.tier, clean(event.model ?? ""), event.status, content],
      doubles: [1, n(event.items), n(event.inputTokens), n(event.outputTokens), n(event.cachedInputTokens),
        n(event.providerCostUsd), n(event.retailCostUsd), n(event.latencyMs), n(event.escalations),
        Number(!known(event.inputTokens)), Number(!known(event.outputTokens)), Number(!known(event.providerCostUsd)),
        Number(!known(event.retailCostUsd)), truncated, Number(!known(event.cachedInputTokens))],
    });
    return true;
  } catch { return false; }
}
