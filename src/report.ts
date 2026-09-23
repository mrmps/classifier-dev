import { jevAttemptsQuery } from "./jev-observability";
import type { Env } from "./index";
import { recordedClassifierLabels } from "./privacy";

const DATASET = "classifier_events";
const WINDOW_HOURS = 8; // three reports a day

/**
 * Daily digest. Reads Cloudflare Analytics Engine over its SQL API — nothing to
 * deploy or maintain beyond this worker — and emails a plain-text summary.
 * Degrades to KV-only counts if Analytics Engine is unavailable.
 */
export async function sql(env: Env, query: string) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/analytics_engine/sql`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, "content-type": "text/plain" },
      body: query,
    },
  );
  if (!res.ok) throw new Error(`AE ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { data?: Record<string, unknown>[] };
  return j.data ?? [];
}

const num = (v: unknown) => Number(v ?? 0);
const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);

export async function dailyReport(
  env: Env,
  opts: { send?: boolean; primaries?: string[] } = { send: true },
) {
  const lines: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  lines.push(`classifier.dev — last ${WINDOW_HOURS}h — ${today}`, "");

  let totals: Record<string, unknown>[] = [];
  let byTier: Record<string, unknown>[] = [];
  let byClient: Record<string, unknown>[] = [];
  let enterpriseClassifiers: Record<string, unknown>[] = [];
  let topClassifiers: Record<string, unknown>[] = [];
  let byCountry: Record<string, unknown>[] = [];
  let errors: Record<string, unknown>[] = [];
  let reasons: Record<string, unknown>[] = [];
  let byModel: Record<string, unknown>[] = [];
  let aeError = "";

  let visitors = 0;
  let classifiers = 0;

  // Cloudflare's Analytics Engine SQL is a narrow ClickHouse subset: no uniq(),
  // no SELECT DISTINCT. Distinct counts come from GROUP BY row counts. Each
  // query is isolated so one unsupported feature cannot blank the whole report.
  const since = `toDateTime(now()) - INTERVAL '${WINDOW_HOURS}' HOUR`;
  const q = async <T>(query: string, fallback: T, use: (rows: Record<string, unknown>[]) => T): Promise<T> => {
    try {
      return use(await sql(env, query));
    } catch (e) {
      if (!aeError) aeError = (e as Error).message;
      return fallback;
    }
  };

  totals = await q(
    `SELECT sum(_sample_interval) AS requests, sum(double1 * _sample_interval) AS classifications, sum(double2 * _sample_interval) / sum(_sample_interval) AS avg_ms
     FROM ${DATASET} WHERE timestamp > ${since}`,
    [],
    (r) => r,
  );
  visitors = await q(
    `SELECT index1, sum(_sample_interval) AS n FROM ${DATASET} WHERE timestamp > ${since} GROUP BY index1`,
    0,
    (r) => r.length,
  );
  classifiers = await q(
    `SELECT blob2, sum(_sample_interval) AS n FROM ${DATASET} WHERE timestamp > ${since} AND blob2 != '' GROUP BY blob2`,
    0,
    (r) => r.length,
  );
  byTier = await q(
    `SELECT blob1 AS tier, sum(_sample_interval) AS requests, sum(double1 * _sample_interval) AS classifications, sum(double2 * _sample_interval) / sum(_sample_interval) AS avg_ms
     FROM ${DATASET} WHERE timestamp > ${since} GROUP BY tier ORDER BY requests DESC`,
    [],
    (r) => r,
  );
  byClient = await q(
    `SELECT blob5 AS client, blob4 AS status, sum(_sample_interval) AS requests,
            sum(double1 * _sample_interval) AS classifications, sum(double2 * _sample_interval) / sum(_sample_interval) AS avg_ms
     FROM ${DATASET} WHERE timestamp > ${since}
     GROUP BY client, status ORDER BY client, status`,
    [],
    (r) => r,
  );
  enterpriseClassifiers = await q(
    `SELECT blob2 AS labels, blob1 AS tier, sum(_sample_interval) AS requests
     FROM ${DATASET}
     WHERE timestamp > ${since} AND blob5 = 'enterprise' AND blob2 != ''
     GROUP BY labels, tier ORDER BY requests DESC LIMIT 12`,
    [],
    (r) => r,
  );
  topClassifiers = await q(
    `SELECT blob2 AS labels, sum(_sample_interval) AS requests
     FROM ${DATASET} WHERE timestamp > ${since} AND blob2 != '' GROUP BY labels ORDER BY requests DESC LIMIT 12`,
    [],
    (r) => r,
  );
  byCountry = await q(
    `SELECT blob3 AS country, sum(_sample_interval) AS requests FROM ${DATASET}
     WHERE timestamp > ${since} GROUP BY country ORDER BY requests DESC LIMIT 8`,
    [],
    (r) => r,
  );
  byModel = await q(
    `SELECT blob6 AS model, blob1 AS tier, sum(_sample_interval) AS requests, sum(double2 * _sample_interval) / sum(_sample_interval) AS avg_ms
     FROM ${DATASET} WHERE timestamp > ${since} AND blob6 != ''
     GROUP BY model, tier ORDER BY requests DESC LIMIT 10`,
    [],
    (r) => r,
  );
  errors = await q(
    `SELECT blob4 AS status, sum(_sample_interval) AS n FROM ${DATASET}
     WHERE timestamp > ${since} AND blob4 != '200' GROUP BY status ORDER BY n DESC`,
    [],
    (r) => r,
  );
  // A status code says a request failed; blob7 says why, which is the part
  // that tells you whether to fix the docs, the limits, or a provider.
  reasons = await q(
    `SELECT blob7 AS reason, blob8 AS agent, sum(_sample_interval) AS n
     FROM ${DATASET} WHERE timestamp > ${since} AND blob7 != ''
     GROUP BY reason, agent ORDER BY n DESC LIMIT 8`,
    [],
    (r) => r,
  );

  const nameClassifiers = async (rows: Record<string, unknown>[]) => Promise.all(rows.map(async (row) => {
    const labels = await recordedClassifierLabels(env.STATS, String(row.labels ?? ""));
    return { ...row, label_names: labels.join(" · ") };
  }));
  [enterpriseClassifiers, topClassifiers] = await Promise.all([
    nameClassifiers(enterpriseClassifiers),
    nameClassifiers(topClassifiers),
  ]);

  const t = totals[0] ?? {};
  const requests = num(t.requests);
  const classifications = num(t.classifications);
  const serverErrors = errors.filter((r) => String(r.status).startsWith("5")).reduce((n, r) => n + num(r.n), 0);
  const rejected = errors.filter((r) => String(r.status).startsWith("4")).reduce((n, r) => n + num(r.n), 0);

  lines.push(`LAST ${WINDOW_HOURS} HOURS`);
  lines.push(`  requests         ${requests}`);
  lines.push(`  classifications  ${classifications}`);
  lines.push(`  server failures  ${serverErrors}`);
  lines.push(`  rejected requests ${rejected} (validation or quota)`);
  // A caller pseudonym is scoped to a UTC day, so over a window longer than a
  // day this counts caller-days rather than people. See src/privacy.ts.
  lines.push(`  unique callers   ${visitors}`);
  lines.push(`  distinct classifiers ${classifiers}`);
  lines.push(`  avg latency      ${Math.round(num(t.avg_ms))}ms`);
  lines.push("  Traffic and latency are sampling-adjusted estimates. Latency includes rejected requests. Unique counts reflect observed fingerprints.");
  lines.push("");

  if (byTier.length) {
    lines.push("BY TIER");
    for (const r of byTier) {
      lines.push(
        `  ${pad(String(r.tier ?? "?"), 8)} ${pad(String(num(r.requests)), 8)} req  ${pad(
          String(num(r.classifications)),
          8,
        )} cls  ${Math.round(num(r.avg_ms))}ms`,
      );
    }
    lines.push("");
  }

  if (byClient.length) {
    const clients = new Map<
      string,
      { requests: number; classifications: number; ok: number; failed: number; rejected: number; latency: number; statuses: string[] }
    >();
    for (const r of byClient) {
      const client = String(r.client || "public");
      const requests = num(r.requests);
      const status = String(r.status ?? "?");
      const current = clients.get(client) ?? {
        requests: 0,
        classifications: 0,
        ok: 0,
        failed: 0,
        rejected: 0,
        latency: 0,
        statuses: [],
      };
      current.requests += requests;
      current.classifications += num(r.classifications);
      current.latency += num(r.avg_ms) * requests;
      if (status === "200") current.ok += requests;
      else if (status.startsWith("5")) current.failed += requests;
      else if (status.startsWith("4")) current.rejected += requests;
      current.statuses.push(`${status}:${requests}`);
      clients.set(client, current);
    }

    lines.push("BY CLIENT");
    for (const [client, r] of clients) {
      lines.push(
        `  ${pad(client, 12)} ${r.requests} req  ${r.classifications} cls  ${r.ok} ok  ${r.failed} server failures  ${r.rejected} rejected  ` +
          `${Math.round(r.latency / Math.max(1, r.requests))}ms  [${r.statuses.join(" ")}]`,
      );
    }
    lines.push("");
  }

  if (enterpriseClassifiers.length) {
    lines.push("ENTERPRISE CLASSIFIERS");
    for (const r of enterpriseClassifiers) {
      lines.push(`  ${pad(String(num(r.requests)), 6)} ${pad(String(r.tier ?? "?"), 8)} ${String(r.label_names || r.labels)}`);
    }
    lines.push("");
  }

  if (topClassifiers.length) {
    lines.push("TOP CLASSIFIERS  (aggregate label names; source text and callers are not kept here)");
    for (const r of topClassifiers) {
      lines.push(`  ${pad(String(num(r.requests)), 6)} ${String(r.label_names || r.labels)}`);
    }
    lines.push("");
  }

  if (byCountry.length) {
    lines.push("COUNTRIES  " + byCountry.map((r) => `${r.country}:${num(r.requests)}`).join("  "));
    lines.push("");
  }

  // Which model actually answered. A chain that has quietly fallen through to
  // its backup looks healthy in every other number in this report.
  if (byModel.length) {
    const primaries = opts.primaries ?? [];
    lines.push("BY MODEL");
    for (const r of byModel) {
      const model = String(r.model ?? "?");
      const servedModels = model.split(",").filter(Boolean);
      const fallback = primaries.length && servedModels.some(
        (servedModel) => !primaries.some(
          (primary) => servedModel === primary || servedModel.startsWith(primary),
        ),
      );
      lines.push(
        `  ${pad(String(num(r.requests)), 6)} ${pad(String(r.tier ?? "?"), 6)} ${pad(model, 34)} ` +
          `${Math.round(num(r.avg_ms))}ms${fallback ? "  <- FALLBACK, primary is not answering" : ""}`,
      );
    }
    lines.push("");
  }

  if (errors.length) {
    lines.push("NON-200  " + errors.map((r) => `${r.status}:${num(r.n)}`).join("  "));
    if (reasons.length) {
      lines.push("WHY");
      for (const r of reasons) {
        lines.push(`  ${pad(String(r.reason ?? "?"), 20)} ${pad(String(num(r.n)), 7)} ${r.agent ?? "?"}`);
      }
    }
    lines.push("");
  }

  // All-time distinct classifiers, from the KV registry.
  try {
    const list = await env.STATS.list({ prefix: "cls:", limit: 1000 });
    lines.push(`ALL-TIME distinct classifiers: ${list.keys.length}${list.list_complete ? "" : "+"}`);
    lines.push("");
  } catch {
    /* ignore */
  }

  if (aeError) {
    lines.push(`(analytics unavailable: ${aeError})`, "");
  }

  lines.push("JEV ROUTING", `  gateway: ${env.AI_GATEWAY_DISABLED === "true" ? "disabled (TypeSafe direct)" : env.AI_GATEWAY_API_KEY ? "enabled" : "not configured"}`);
  if (env.JEV_AE) {
    try {
      const attempts = await sql(env, jevAttemptsQuery(WINDOW_HOURS * 60));
      if (!attempts.length) lines.push("  No provider attempts recorded in this window.");
      for (const r of attempts) lines.push(`  ${r.provider}  ${r.outcome}  ${r.reason || "ok"}  HTTP ${r.status}  ${num(r.attempts)} attempts  ${Math.round(num(r.avg_ms))}ms`);
    } catch {
      lines.push("  Provider attempt analytics unavailable; routing health is unknown.");
    }
  } else lines.push("  Provider attempt analytics not configured.");
  lines.push("");
  lines.push("https://classifier.dev  ·  https://classifier.dev/benchmark");

  // Compare against the previous window so the subject can show direction.
  let prev = 0;
  try {
    prev = Number((await env.STATS.get("last:requests")) ?? "0");
    await env.STATS.put("last:requests", String(requests));
  } catch {
    /* ignore */
  }
  const arrow = prev === 0 ? (requests > 0 ? "+" : "") : requests > prev ? "▲" : requests < prev ? "▼" : "=";

  const body = lines.join("\n");

  // The subject is the report. Reading it in a notification should be enough.
  const subject =
    requests === 0
      ? `classifier.dev · quiet · 0 req/${WINDOW_HOURS}h`
      : [
          "classifier.dev ·",
          serverErrors ? `⚠${serverErrors} server failures ·` : "",
          rejected ? `${rejected} rejected ·` : "",
          `${arrow}${requests} req ·`,
          `${visitors} callers ·`,
          `${classifiers} classifiers ·`,
          `${Math.round(num(t.avg_ms))}ms`,
        ]
          .filter(Boolean)
          .join(" ");

  if (opts.send === false) return body + "\n\n(preview only — not emailed)";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: "classifier.dev <onboarding@resend.dev>",
      to: [env.REPORT_TO],
      subject,
      text: body,
    }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return body;
}
