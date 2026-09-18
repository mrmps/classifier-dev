import type { Env } from "./index";

const DATASET = "classifier_events";
const WINDOW_HOURS = 8; // three reports a day

/**
 * Daily digest. Reads Cloudflare Analytics Engine over its SQL API — nothing to
 * deploy or maintain beyond this worker — and emails a plain-text summary.
 * Degrades to KV-only counts if Analytics Engine is unavailable.
 */
async function sql(env: Env, query: string) {
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
    `SELECT count() AS requests, sum(double1) AS classifications, avg(double2) AS avg_ms
     FROM ${DATASET} WHERE timestamp > ${since}`,
    [],
    (r) => r,
  );
  visitors = await q(
    `SELECT index1, count() AS n FROM ${DATASET} WHERE timestamp > ${since} GROUP BY index1`,
    0,
    (r) => r.length,
  );
  classifiers = await q(
    `SELECT blob2, count() AS n FROM ${DATASET} WHERE timestamp > ${since} AND blob2 != '' GROUP BY blob2`,
    0,
    (r) => r.length,
  );
  byTier = await q(
    `SELECT blob1 AS tier, count() AS requests, sum(double1) AS classifications, avg(double2) AS avg_ms
     FROM ${DATASET} WHERE timestamp > ${since} GROUP BY tier ORDER BY requests DESC`,
    [],
    (r) => r,
  );
  byClient = await q(
    `SELECT blob5 AS client, blob4 AS status, count() AS requests,
            sum(double1) AS classifications, avg(double2) AS avg_ms
     FROM ${DATASET} WHERE timestamp > ${since}
     GROUP BY client, status ORDER BY client, status`,
    [],
    (r) => r,
  );
  enterpriseClassifiers = await q(
    `SELECT blob2 AS labels, blob1 AS tier, count() AS requests
     FROM ${DATASET}
     WHERE timestamp > ${since} AND blob5 = 'enterprise' AND blob2 != ''
     GROUP BY labels, tier ORDER BY requests DESC LIMIT 12`,
    [],
    (r) => r,
  );
  topClassifiers = await q(
    `SELECT blob2 AS labels, count() AS requests
     FROM ${DATASET} WHERE timestamp > ${since} AND blob2 != '' GROUP BY labels ORDER BY requests DESC LIMIT 12`,
    [],
    (r) => r,
  );
  byCountry = await q(
    `SELECT blob3 AS country, count() AS requests FROM ${DATASET}
     WHERE timestamp > ${since} GROUP BY country ORDER BY requests DESC LIMIT 8`,
    [],
    (r) => r,
  );
  byModel = await q(
    `SELECT blob6 AS model, blob1 AS tier, count() AS requests, avg(double2) AS avg_ms
     FROM ${DATASET} WHERE timestamp > ${since} AND blob6 != ''
     GROUP BY model, tier ORDER BY requests DESC LIMIT 10`,
    [],
    (r) => r,
  );
  errors = await q(
    `SELECT blob4 AS status, count() AS n FROM ${DATASET}
     WHERE timestamp > ${since} AND blob4 != '200' GROUP BY status ORDER BY n DESC`,
    [],
    (r) => r,
  );

  const t = totals[0] ?? {};
  const requests = num(t.requests);
  const classifications = num(t.classifications);

  lines.push(`LAST ${WINDOW_HOURS} HOURS`);
  lines.push(`  requests         ${requests}`);
  lines.push(`  classifications  ${classifications}`);
  lines.push(`  unique visitors  ${visitors}`);
  lines.push(`  distinct label sets ${classifiers}`);
  lines.push(`  avg latency      ${Math.round(num(t.avg_ms))}ms`);
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
      { requests: number; classifications: number; ok: number; failed: number; latency: number; statuses: string[] }
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
        latency: 0,
        statuses: [],
      };
      current.requests += requests;
      current.classifications += num(r.classifications);
      current.latency += num(r.avg_ms) * requests;
      if (status === "200") current.ok += requests;
      else current.failed += requests;
      current.statuses.push(`${status}:${requests}`);
      clients.set(client, current);
    }

    lines.push("BY CLIENT");
    for (const [client, r] of clients) {
      lines.push(
        `  ${pad(client, 12)} ${r.requests} req  ${r.classifications} cls  ${r.ok} ok  ${r.failed} failed  ` +
          `${Math.round(r.latency / Math.max(1, r.requests))}ms  [${r.statuses.join(" ")}]`,
      );
    }
    lines.push("");
  }

  if (enterpriseClassifiers.length) {
    lines.push("ENTERPRISE LABEL SETS");
    for (const r of enterpriseClassifiers) {
      lines.push(`  ${pad(String(num(r.requests)), 6)} ${pad(String(r.tier ?? "?"), 8)} ${String(r.labels)}`);
    }
    lines.push("");
  }

  if (topClassifiers.length) {
    lines.push("TOP CLASSIFIERS  (label sets people actually use)");
    for (const r of topClassifiers) {
      lines.push(`  ${pad(String(num(r.requests)), 6)} ${String(r.labels)}`);
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
    lines.push("");
  }

  // All-time distinct classifiers, from the KV registry.
  try {
    const list = await env.STATS.list({ prefix: "cls:", limit: 1000 });
    lines.push(`ALL-TIME distinct label sets: ${list.keys.length}${list.list_complete ? "" : "+"}`);
    lines.push("");
  } catch {
    /* ignore */
  }

  if (aeError) {
    lines.push(`(analytics unavailable: ${aeError})`, "");
  }

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
  const errCount = errors.reduce((a, r) => a + num(r.n), 0);

  const body = lines.join("\n");

  // The subject is the report. Reading it in a notification should be enough.
  const subject =
    requests === 0
      ? `classifier.dev · quiet · 0 req/${WINDOW_HOURS}h`
      : [
          "classifier.dev ·",
          errCount ? `⚠${errCount} err ·` : "",
          `${arrow}${requests} req ·`,
          `${visitors} ppl ·`,
          `${classifiers} labelsets ·`,
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
