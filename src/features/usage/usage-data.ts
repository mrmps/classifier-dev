import type { AppSnapshot } from "@/server/contracts";

type Aggregate = AppSnapshot["usageAggregates"][number];
export type UsageGranularity = "hourly" | "daily";
export type UsageMetric = "spend" | "tokens" | "requests";
export type UsageTotals = Pick<
  Aggregate,
  "credits" | "requests" | "items" | "inputTokens" | "outputTokens"
>;

export function summarizeUsage(rows: UsageTotals[]): UsageTotals {
  return rows.reduce<UsageTotals>(
    (total, row) => ({
      credits: total.credits + row.credits,
      requests: total.requests + row.requests,
      items: total.items + row.items,
      inputTokens:
        total.inputTokens === null || row.inputTokens === null
          ? null
          : total.inputTokens + row.inputTokens,
      outputTokens:
        total.outputTokens === null || row.outputTokens === null
          ? null
          : total.outputTokens + row.outputTokens,
    }),
    { credits: 0, requests: 0, items: 0, inputTokens: 0, outputTokens: 0 },
  );
}

export function tokenTotal(
  row: Pick<UsageTotals, "inputTokens" | "outputTokens">,
) {
  return row.inputTokens === null || row.outputTokens === null
    ? null
    : row.inputTokens + row.outputTokens;
}

export function usageRange(days: number, now = new Date()) {
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  const dates = Array.from({ length: days }, (_, index) => {
    const date = new Date(end);
    date.setUTCDate(date.getUTCDate() - (days - 1 - index));
    return date.toISOString().slice(0, 10);
  });
  return { dates, start: dates[0], end: dates[dates.length - 1] };
}

export function filterUsage(
  rows: Aggregate[],
  range: ReturnType<typeof usageRange>,
  keyId: string,
  source: string,
) {
  return rows.filter(
    (row) =>
      row.day >= range.start &&
      row.day <= range.end &&
      (keyId === "all" || row.keyId === keyId) &&
      (source === "all" || row.type === source),
  );
}

export function dailyUsage(rows: Aggregate[], dates: string[]) {
  return dates.map((day) => {
    const totals = summarizeUsage(rows.filter((row) => row.day === day));
    return {
      day,
      spend: totals.credits / 100_000,
      requests: totals.requests,
      tokens: tokenTotal(totals),
    };
  });
}

/** Fill elapsed UTC hours only; the current hour is a partial bucket. */
export function hourlyUsage(
  rows: Aggregate[],
  range: ReturnType<typeof usageRange>,
  now = new Date(),
) {
  const start = Date.parse(`${range.start}T00:00:00Z`);
  const end = Math.min(
    Date.parse(`${range.end}T23:00:00Z`),
    Math.floor(now.getTime() / 3_600_000) * 3_600_000,
  );
  const groups = new Map<string, Aggregate[]>();
  for (const row of rows) {
    const bucket = groups.get(row.hour) ?? [];
    bucket.push(row);
    groups.set(row.hour, bucket);
  }
  return Array.from(
    { length: Math.max(0, (end - start) / 3_600_000 + 1) },
    (_, index) => {
      const day = new Date(start + index * 3_600_000)
        .toISOString()
        .replace(".000Z", "Z");
      const totals = summarizeUsage(groups.get(day) ?? []);
      return {
        day,
        spend: totals.credits / 100_000,
        requests: totals.requests,
        tokens: tokenTotal(totals),
      };
    },
  );
}

export function usageBreakdown(rows: Aggregate[], dimension: "key" | "type") {
  const groups = new Map<string, { name: string; rows: Aggregate[] }>();
  for (const row of rows) {
    const id = dimension === "key" ? row.keyId : row.type;
    const name = dimension === "key" ? row.keyName : row.type;
    const group = groups.get(id) ?? { name, rows: [] };
    group.rows.push(row);
    groups.set(id, group);
  }
  return Array.from(groups, ([id, group]) => ({
    id,
    name: group.name,
    ...summarizeUsage(group.rows),
  })).sort((a, b) => b.credits - a.credits || b.requests - a.requests);
}
