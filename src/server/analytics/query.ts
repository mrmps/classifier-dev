import { AppError } from "../db";
import type { AccountAnalyticsEnv, AccountAnalyticsResponse, AnalyticsKind, AnalyticsRow } from "./contracts";
import { ACCOUNT_DATASET, blobs, doubles, validAccountIndex } from "./schema";

const DAY = 86_400_000;
const dimensions = { key: blobs.keyId, agent: blobs.agentId, tier: blobs.tier, model: blobs.model };
const quote = (value: string) => `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
const dateSql = (date: Date) => `toDateTime(${Math.floor(date.getTime() / 1000)})`;
/** SQL is entirely server-owned; parameters can only select validated filters. */
export function accountAnalyticsSql(accountId: string, kind: AnalyticsKind, params: URLSearchParams, now = new Date()): string {
  if (!validAccountIndex(accountId)) throw new AppError(400, "Invalid account identifier.");
  if (!["summary", "timeseries", "breakdown", "activity"].includes(kind)) throw new AppError(400, "Invalid analytics query.");
  const allowed = new Set(["from", "to", "interval", "key_id", "agent_id", "tier", "group_by", "source", "status"]);
  for (const key of params.keys()) if (!allowed.has(key) || params.getAll(key).length !== 1)
    throw new AppError(400, "Invalid analytics filter.");
  const from = new Date(params.get("from") ?? now.getTime() - 30 * DAY);
  const to = new Date(params.get("to") ?? now.getTime());
  if (!Number.isFinite(+from) || !Number.isFinite(+to) || +from >= +to || +from < +now - 90 * DAY || +to > +now + 60_000)
    throw new AppError(400, "Choose an analytics range within the last 90 days.");
  const where = [`index1 = ${quote(accountId)}`, `${blobs.version} = '1'`, `timestamp >= ${dateSql(from)}`, `timestamp < ${dateSql(to)}`];
  for (const [param, column, values] of [["source", blobs.source, ["api", "mcp"]], ["status", blobs.status, ["success", "error"]]] as const) {
    const value = params.get(param);
    if (value === null) continue;
    if (!(values as readonly string[]).includes(value)) throw new AppError(400, "Invalid analytics filter.");
    where.push(`${column} = ${quote(param === "source" ? value.toUpperCase() : value)}`);
  }
  for (const [param, column] of [["key_id", blobs.keyId], ["agent_id", blobs.agentId], ["tier", blobs.tier]]) {
    const value = params.get(param);
    if (value === null) continue;
    if (!/^[A-Za-z0-9_:@.\-]{1,256}$/.test(value) || (param === "tier" && !["fast", "smart"].includes(value)))
      throw new AppError(400, "Invalid analytics filter.");
    where.push(`${column} = ${quote(value)}`);
  }
  const aggregate = Object.entries(doubles).filter(([name]) => !["latencyMs", "truncatedContent"].includes(name))
    .map(([name, column]) => `SUM(_sample_interval * ${column}) AS ${name}`);
  aggregate.push(`SUM(_sample_interval * ${doubles.latencyMs}) / SUM(_sample_interval) AS latencyMs`,
    `SUM(IF(${blobs.status} = 'error', _sample_interval, 0)) AS errors`,
    "MAX(_sample_interval) AS sampleInterval", "MAX(timestamp) AS latestEventAt");
  let select = aggregate.join(", ");
  let suffix = "";
  if (kind === "timeseries") {
    const interval = params.get("interval") ?? "day";
    if (!["day", "hour"].includes(interval) || (interval === "hour" && +to - +from > 31 * DAY))
      throw new AppError(400, "Hourly charts support at most 31 days.");
    select = `toStartOfInterval(timestamp, INTERVAL '1' ${interval.toUpperCase()}) AS bucket, ${select}`;
    suffix = " GROUP BY bucket ORDER BY bucket ASC LIMIT 745";
  } else if (kind === "breakdown") {
    const group = params.get("group_by") ?? "key";
    if (!Object.hasOwn(dimensions, group)) throw new AppError(400, "Invalid breakdown dimension.");
    select = `${dimensions[group as keyof typeof dimensions]} AS dimension, ${select}`;
    suffix = " GROUP BY dimension ORDER BY requests DESC LIMIT 50";
  } else if (kind === "activity") {
    select = ["timestamp", ...Object.entries(blobs).filter(([name]) => !["version", "content"].includes(name)).map(([name, column]) => `${column} AS ${name}`),
      ...Object.entries(doubles).map(([name, column]) => `${column} AS ${name}`), "_sample_interval AS sampleInterval", "timestamp AS latestEventAt"].join(", ");
    suffix = " ORDER BY timestamp DESC LIMIT 100";
  }
  return `SELECT ${select} FROM ${ACCOUNT_DATASET} WHERE ${where.join(" AND ")}${suffix} FORMAT JSON`;
}

export async function readAccountAnalytics(env: AccountAnalyticsEnv, accountId: string, kind: AnalyticsKind,
  params = new URLSearchParams(), fetcher: typeof fetch = fetch): Promise<AccountAnalyticsResponse> {
  const now = new Date();
  const sql = accountAnalyticsSql(accountId, kind, params, now);
  if (!env.CF_ANALYTICS_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID || !/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID))
    throw new AppError(503, "Usage analytics are not configured.");
  // Query budgets cover both the dashboard and API. Fail closed: a broken
  // limiter must not turn an analytics refresh loop into unbounded reads.
  if (env.APP_ACCOUNTS_ENABLED === "true") {
    if (!env.LIMITER) throw new AppError(503, "Usage analytics are temporarily unavailable.");
    for (const [name, minute, daily] of [[`account-analytics:${accountId}`, 120, 2000], ["account-analytics:global", 1000, 20000]] as const) {
      let limited: unknown;
      try {
        const response = await env.LIMITER.get(env.LIMITER.idFromName(name)).fetch(
          `https://limiter/?limit=${minute}&daily=${daily}&cost=1`);
        if (!response.ok) throw new Error("Limiter unavailable");
        limited = (await response.json() as { limited?: unknown }).limited;
        if (typeof limited !== "boolean") throw new Error("Invalid limiter response");
      } catch { throw new AppError(503, "Usage analytics are temporarily unavailable."); }
      if (limited) throw new AppError(429, "Usage analytics query limit reached. Try again later; your balance is unaffected.");
    }
  }
  try {
    const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/analytics_engine/sql`, {
      method: "POST", headers: { authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, "content-type": "text/plain" },
      body: sql, signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Analytics query failed");
    const body = await response.json() as { data?: unknown };
    if (!Array.isArray(body.data) || body.data.length > 745) throw new Error("Invalid analytics response");
    const data: AnalyticsRow[] = body.data.map((row: unknown) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Invalid analytics row");
      return Object.fromEntries(Object.entries(row).map(([key, value]) => {
        if (value !== null && typeof value !== "string" && typeof value !== "number") throw new Error("Invalid analytics value");
        if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Invalid analytics number");
        return [key, value];
      }));
    });
    const latest = data.filter((row) => Number(row.requests) > 0).map((row) => row.latestEventAt)
      .filter((value): value is string => typeof value === "string").sort().at(-1) ?? null;
    return { data, meta: { queriedAt: now.toISOString(), latestEventAt: latest, sampled: data.some((row) => Number(row.sampleInterval) > 1), exact: false, retentionDays: 90 } };
  } catch { throw new AppError(503, "Usage analytics are temporarily unavailable. Your balance is unaffected."); }
}
