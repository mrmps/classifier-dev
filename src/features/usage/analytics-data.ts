import type { AnalyticsRow } from "../../server/analytics/contracts";
import type { UsageTotals } from "./usage-data";

export function measurement(row: AnalyticsRow, key: string): number | null {
  const missing: Record<string, string> = {
    inputTokens: "missingInputTokens",
    outputTokens: "missingOutputTokens",
    retailCostUsd: "missingRetailCost",
    providerCostUsd: "missingProviderCost",
  };
  if (Number(row[missing[key]]) > 0) return null;
  const value = row[key];
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
export function analyticsTimestamp(
  value: string | number | null | undefined,
): string {
  const text = String(value ?? "");
  return text.includes("T") ? text : `${text.replace(" ", "T")}Z`;
}
export function analyticsTotals(row: AnalyticsRow = {}): UsageTotals {
  return {
    credits: (measurement(row, "retailCostUsd") ?? 0) * 100_000,
    requests: measurement(row, "requests") ?? 0,
    items: measurement(row, "items") ?? 0,
    inputTokens: measurement(row, "inputTokens"),
    outputTokens: measurement(row, "outputTokens"),
  };
}
export function analyticsParameters(
  days: number,
  interval: "hourly" | "daily",
  now = new Date(),
) {
  const from = new Date(now);
  from.setUTCHours(0, 0, 0, 0);
  from.setUTCDate(from.getUTCDate() - days + 1);
  // Minute precision keeps query identities stable during incidental renders.
  const to = new Date(now);
  to.setUTCSeconds(0, 0);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    interval: interval === "hourly" ? "hour" : "day",
  };
}
