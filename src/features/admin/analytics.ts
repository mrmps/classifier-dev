import type { AdminData, RangeKey } from "../../admin";

export const number = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};
export const count = (n: number) => Math.round(n).toLocaleString("en-US");
export const compact = (n: number) =>
  Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
export const money = (n: number) =>
  n === 0
    ? "$0"
    : n < 0.01
      ? `$${n.toPrecision(2)}`
      : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 3 : 2 })}`;
export const latency = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)}ms`;
export const percent = (n: number, total: number) =>
  total > 0 ? `${((n / total) * 100).toFixed(2)}%` : "—";
export const sum = (rows: Record<string, unknown>[], key: string) =>
  rows.reduce((n, row) => n + number(row[key]), 0);
export const timestamp = (value: unknown) => {
  const s = String(value).replace(" ", "T");
  return Date.parse(/Z|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
};
export function change(current: number, previous: number) {
  if (!previous) return current ? "No prior traffic" : "No change";
  const p = ((current - previous) / previous) * 100;
  return `${p > 0 ? "+" : ""}${p.toFixed(1)}% vs previous period`;
}

/** Empty traffic buckets are zero; absent latency samples are deliberately null. */
export function timeline(data: AdminData, range: RangeKey) {
  const hours = range === "24h" ? 24 : range === "7d" ? 168 : 720;
  const step = (range === "24h" ? 1 : range === "7d" ? 6 : 24) * 3600000;
  const end = Date.parse(data.generatedAt);
  const start = Math.floor((end - hours * 3600000) / step) * step;
  const traffic = new Map(data.series.map((r) => [timestamp(r.t), r]));
  const performance = new Map(data.performance.map((r) => [timestamp(r.t), r]));
  const chat = new Map(data.chatSeries.map((r) => [timestamp(r.t), r]));
  const dimensions = new Map(
    data.dimensionSeries.map((r) => [timestamp(r.t), r]),
  );
  const statuses = new Map<
    number,
    { ok: number; failed: number; rejected: number }
  >();
  for (const r of data.outcomes) {
    const t = timestamp(r.t),
      row = statuses.get(t) ?? { ok: 0, failed: 0, rejected: 0 };
    const status = String(r.status);
    if (status === "200") row.ok += number(r.requests);
    if (status.startsWith("5")) row.failed += number(r.requests);
    if (status.startsWith("4")) row.rejected += number(r.requests);
    statuses.set(t, row);
  }
  const result = [];
  for (let t = start; t <= end; t += step) {
    const r = traffic.get(t),
      p = performance.get(t),
      d = dimensions.get(t),
      status = statuses.get(t);
    result.push({
      time: new Date(t).toISOString().slice(0, 16).replace("T", " "),
      requests: number(r?.requests),
      classifications: number(r?.classifications),
      spend: number(r?.usd),
      cost: number(r?.classifications)
        ? (number(r?.usd) / number(r?.classifications)) * 1000
        : null,
      latency: p ? number(p.avg_ms) : null,
      batch: p ? number(p.batch_size) : null,
      decisions: number(d?.classifications),
      dimensionRequests: number(d?.requests),
      chatTurns: number(chat.get(t)?.turns),
      chatSpend: number(chat.get(t)?.usd),
      chatLatency: chat.has(t) ? number(chat.get(t)?.avg_ms) : null,
      failed: status?.failed ?? 0,
      rejected: status?.rejected ?? 0,
      errorRate:
        status && status.ok + status.failed > 0
          ? (status.failed / (status.ok + status.failed)) * 100
          : null,
    });
  }
  return result;
}
