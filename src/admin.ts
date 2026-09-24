/**
 * GET /admin — the operator dashboard.
 *
 * Reads the same Analytics Engine dataset the daily digest reads, so it needs
 * nothing deployed beyond this worker and it shows the full retained history
 * from the moment it ships. Cost is the one exception: `double3` was added
 * when this page was, so spend reads 0 for anything older than that deploy.
 *
 * Gated by a single shared password, held in the ADMIN_PASSWORD secret and
 * never in the source. A correct password mints an HMAC-signed, expiring
 * cookie; there is no session store to keep. Without that secret the route
 * does not answer at all, because a page that says what it is is a page worth
 * attacking.
 *
 * The caller column is a day-scoped hash and the label column a keyed
 * fingerprint, both made in src/privacy.ts before per-request analytics are
 * written. A separate 90-day registry resolves successful classifier
 * fingerprints to aggregate label names; it contains no caller or source text.
 */

import { modelName, modelUsage, modelUsageQuery } from "./model-analytics";
import type { Env } from "./index";
import { CHAT_DATASET, CHAT_FIELDS } from "./chat-analytics";
import { sql } from "./report";
import { reasonText } from "./features/admin/reasons";
import { esc, BASE_CSS } from "./ui";
import { secretEquals, deriveSigningKey, hmacHex } from "./secrets";
import { recordedClassifierLabels } from "./privacy";

const DATASET = "classifier_events";
// The __Secure- prefix is enforced by the browser, not by us: it refuses to
// store or send the cookie unless it was set over HTTPS with Secure. It costs a
// re-login when it changes, which is cheaper than a cookie a sibling host can
// overwrite.
const COOKIE = "__Secure-cd_admin";
const SESSION_HOURS = 12;
/**
 * The login form's own token, and the reason it exists: this page sends
 * `Referrer-Policy: no-referrer`, which costs it both header answers at once.
 * Referer is stripped outright, and Chrome serializes the origin of a form post
 * from such a page as `null`, so `Origin` says nothing either. On this page the
 * token is not a fallback at all — it is the check that actually runs. The same random
 * value goes into the form and into a SameSite=Strict cookie; a cross-site post
 * carries neither, and Strict is what makes that true whatever the prefix. It
 * takes the session cookie's prefix and path for the same reasons.
 */
const CSRF_COOKIE = "__Secure-cd_csrf";
const CSRF_MINUTES = 30;
/** Wrong passwords are cheap to try, so they go through the same limiter as the API. */
const LOGIN_ATTEMPTS_PER_MIN = 10;
/**
 * And a ceiling for the deployment, because ten a minute per IP is no limit at
 * all to somebody with a thousand IPs. Set well above anything one operator
 * signing in could reach, so tripping it means a spray is underway — and the
 * worst it can do is make the dashboard ask again later.
 */
const LOGIN_ATTEMPTS_PER_MIN_TOTAL = 120;

export type RangeKey = "24h" | "7d" | "30d";
const RANGES: Record<
  RangeKey,
  { hours: number; interval: string; label: string }
> = {
  "24h": {
    hours: 24,
    interval: "1' HOUR",
    label: "last 24 hours",
  },
  "7d": {
    hours: 24 * 7,
    interval: "6' HOUR",
    label: "last 7 days",
  },
  "30d": {
    hours: 24 * 30,
    interval: "1' DAY",
    label: "last 30 days",
  },
};

// ---------------------------------------------------------------- auth

/**
 * The cookie is signed with a key of its own, not with the password. Signing
 * with the password meant a leaked cookie carried an offline oracle for it —
 * the holder knows `exp` and the digest, so they could grind guesses until the
 * HMAC matched. ADMIN_SIGNING_KEY should be a random secret; if it is not set
 * the password is stretched instead, which makes each guess expensive rather
 * than free.
 *
 * Rotating the password still has to end live sessions, so a keyed fingerprint
 * of it is part of what gets signed.
 */
async function sessionSig(env: Env, password: string, exp: string) {
  const key = await deriveSigningKey(env.ADMIN_SIGNING_KEY || password);
  const fingerprint = await hmacHex(key, `pw:${password}`);
  return hmacHex(key, `${exp}:${fingerprint}`);
}

async function mint(env: Env, password: string) {
  const exp = String(Date.now() + SESSION_HOURS * 3_600_000);
  return `${exp}.${await sessionSig(env, password, exp)}`;
}

async function valid(env: Env, password: string, token: string | undefined) {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return false;
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  return secretEquals(sig, await sessionSig(env, password, exp));
}

function readCookie(req: Request, name: string) {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/**
 * A login POST has to come from this site's own form, and this asks the two
 * headers that would know. Neither one present is not a verdict — it is a
 * question they cannot answer, and the form token answers it instead.
 *
 * `Origin: null` is that same silence spelled out loud. A page that sends
 * `Referrer-Policy: no-referrer` — which this one does, a few lines down — gets
 * its origin serialized to the literal string "null" on a form post, so Chrome
 * says `null` for our own login form. A sandboxed frame says exactly the same
 * thing, so it can never be read as a pass on its own; it means only that the
 * browser declined to say, which is the case the token exists for.
 */
function statedOrigin(req: Request, url: URL): "match" | "mismatch" | "absent" {
  const stated = req.headers.get("origin") ?? req.headers.get("referer");
  if (!stated || stated === "null") return "absent";
  try {
    return new URL(stated).origin === url.origin ? "match" : "mismatch";
  } catch {
    return "mismatch";
  }
}

const mintCsrf = () =>
  [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");

/** The token is compared against the cookie, so it is a secret like any other. */
async function csrfOk(req: Request, given: string) {
  const held = readCookie(req, CSRF_COOKIE);
  if (!held || !given) return false;
  return secretEquals(given, held);
}

async function limiterSays(env: Env, name: string, limit: number, daily: number) {
  try {
    const id = env.LIMITER.idFromName(name);
    const res = await env.LIMITER.get(id).fetch(`https://limiter/?limit=${limit}&daily=${daily}&cost=1`);
    return ((await res.json()) as { limited?: boolean }).limited === true;
  } catch {
    return false; // a limiter wobble must not lock the operator out
  }
}

async function loginLimited(env: Env, ip: string) {
  const [perIp, everyone] = await Promise.all([
    limiterSays(env, `adminlogin:${ip}`, LOGIN_ATTEMPTS_PER_MIN, 200),
    limiterSays(env, "adminlogin:all", LOGIN_ATTEMPTS_PER_MIN_TOTAL, 5_000),
  ]);
  return perIp || everyone;
}

// ---------------------------------------------------------------- helpers

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const group = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function usd(n: number) {
  if (n <= 0) return "$0";
  // Per-request spend is fractions of a cent; a fixed 4dp rounds real numbers
  // to $0.0000 and reads like a broken panel, so small values keep two
  // significant figures instead.
  if (n < 0.01) return `$${n.toPrecision(2)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)}ms`);

// ---------------------------------------------------------------- data

type Row = Record<string, unknown>;

async function load(env: Env, range: RangeKey) {
  const r = RANGES[range];
  const since = `toDateTime(now()) - INTERVAL '${r.hours}' HOUR`;
  const errors: string[] = [];
  const unavailable: string[] = [];

  const q = async <T>(
    name: string,
    query: string,
    fallback: T,
    use: (rows: Row[]) => T,
  ): Promise<T> => {
    try {
      return use(await sql(env, query));
    } catch (e) {
      unavailable.push(name);
      const m = (e as Error).message;
      if (!errors.includes(m)) errors.push(m);
      return fallback;
    }
  };

  const [
    totals,
    series,
    byTier,
    byModel,
    modelSeries,
    modelFailures,
    byCountry,
    byStatus,
    byClient,
    topLabels,
    visitors,
    labelSets,
    byReason,
    byAgent,
    failLabels,
    dimensionTraffic,
    dimensionCallers,
    dimensionSeries,
    previous,
    performance,
    outcomes,
    chatOutcomes,
    chatSeries,
    chatCallers,
  ] = await Promise.all([
    q(
      "totals",
      `SELECT sum(_sample_interval) AS requests, sum(double1 * _sample_interval) AS classifications,
                sum(double3 * _sample_interval) AS usd, sum(double2 * _sample_interval) / sum(_sample_interval) AS avg_ms
         FROM ${DATASET} WHERE timestamp > ${since}`,
      [] as Row[],
      (x) => x,
    ),
    q(
      "series",
      `SELECT toStartOfInterval(timestamp, INTERVAL '${r.interval}) AS t,
                sum(_sample_interval) AS requests, sum(double1 * _sample_interval) AS classifications, sum(double3 * _sample_interval) AS usd
         FROM ${DATASET} WHERE timestamp > ${since} GROUP BY t ORDER BY t`,
      [] as Row[],
      (x) => x,
    ),
    q(
      "byTier",
      `SELECT blob1 AS tier, sum(_sample_interval) AS requests, sum(double1 * _sample_interval) AS classifications,
                sum(double3 * _sample_interval) AS usd, sum(double2 * _sample_interval) / sum(_sample_interval) AS avg_ms
         FROM ${DATASET} WHERE timestamp > ${since} GROUP BY tier ORDER BY requests DESC`,
      [] as Row[],
      (x) => x,
    ),
    q(
      "byModel",
      modelUsageQuery(since),
      [] as ReturnType<typeof modelUsage>,
      modelUsage,
    ),
    q(
      "modelSeries",
      `SELECT toStartOfInterval(timestamp, INTERVAL '${r.interval}) AS t, blob6 AS model,
        sum(_sample_interval) AS requests, sum(double1 * _sample_interval) AS classifications
        FROM ${DATASET} WHERE timestamp > ${since} GROUP BY t, model ORDER BY t`,
      [] as Row[], (x) => x.map(row => ({...row, model: modelName(row.model)})),
    ),
    q(
      "modelFailures",
      `SELECT blob6 AS model, blob7 AS reason, blob4 AS status, sum(_sample_interval) AS requests
        FROM ${DATASET} WHERE timestamp > ${since} AND blob4 != '200'
        GROUP BY model, reason, status ORDER BY requests DESC LIMIT 50`,
      [] as Row[], (x) => x.map(row => ({...row, model: modelName(row.model)})),
    ),
    q(
      "byCountry",
      `SELECT blob3 AS country, sum(_sample_interval) AS requests FROM ${DATASET}
         WHERE timestamp > ${since} GROUP BY country ORDER BY requests DESC LIMIT 10`,
      [] as Row[],
      (x) => x,
    ),
    q(
      "byStatus",
      `SELECT blob4 AS status, sum(_sample_interval) AS requests FROM ${DATASET}
         WHERE timestamp > ${since} GROUP BY status ORDER BY requests DESC`,
      [] as Row[],
      (x) => x,
    ),
    q(
      "byClient",
      `SELECT blob5 AS client, sum(_sample_interval) AS requests, sum(double1 * _sample_interval) AS classifications, sum(double3 * _sample_interval) AS usd
         FROM ${DATASET} WHERE timestamp > ${since} GROUP BY client ORDER BY requests DESC`,
      [] as Row[],
      (x) => x,
    ),
    q(
      "topLabels",
      `SELECT blob2 AS labels, sum(_sample_interval) AS requests, sum(double1 * _sample_interval) AS classifications, sum(double3 * _sample_interval) AS usd
         FROM ${DATASET} WHERE timestamp > ${since} AND blob2 != ''
         GROUP BY labels ORDER BY requests DESC LIMIT 12`,
      [] as Row[],
      (x) => x,
    ),
    // Analytics Engine SQL has no uniq(); a distinct count is the row count of a GROUP BY.
    q(
      "visitors",
      `SELECT index1, sum(_sample_interval) AS n FROM ${DATASET} WHERE timestamp > ${since} GROUP BY index1`,
      0,
      (x) => x.length,
    ),
    q(
      "labelSets",
      `SELECT blob2, sum(_sample_interval) AS n FROM ${DATASET} WHERE timestamp > ${since} AND blob2 != '' GROUP BY blob2`,
      0,
      (x) => x.length,
    ),
    // Why requests fail. blob7 is "" on success, so this is the failure set.
    q(
      "byReason",
      `SELECT blob7 AS reason, blob4 AS status, blob8 AS agent, sum(_sample_interval) AS requests, sum(double4 * _sample_interval) / sum(_sample_interval) AS avg_inputs
         FROM ${DATASET} WHERE timestamp > ${since} AND blob7 != ''
         GROUP BY reason, status, agent ORDER BY requests DESC LIMIT 60`,
      [] as Row[],
      (x) => x,
    ),
    q(
      "byAgent",
      `SELECT blob8 AS agent, sum(_sample_interval) AS requests, sum(double1 * _sample_interval) AS classifications
         FROM ${DATASET} WHERE timestamp > ${since} AND blob8 != ''
         GROUP BY agent ORDER BY requests DESC LIMIT 10`,
      [] as Row[],
      (x) => x,
    ),
    // Which classifier configurations are the failing ones.
    q(
      "failLabels",
      `SELECT blob2 AS labels, blob7 AS reason, sum(_sample_interval) AS requests
         FROM ${DATASET} WHERE timestamp > ${since} AND blob7 != '' AND blob2 != ''
         GROUP BY labels, reason ORDER BY requests DESC LIMIT 12`,
      [] as Row[],
      (x) => x,
    ),
    q(
      "dimensionTraffic",
      `SELECT blob4 AS status, blob7 AS reason, sum(_sample_interval) AS requests,
                sum(double1 * _sample_interval) AS classifications, sum(double6 * _sample_interval) AS items,
                sum(double7 * _sample_interval) AS dimensions, sum(double8 * _sample_interval) AS uncertain,
                sum(double9 * _sample_interval) AS fallback, sum(double3 * _sample_interval) AS usd, sum(double2 * _sample_interval) AS ms_sum
         FROM ${DATASET} WHERE timestamp > ${since} AND blob9 = 'dimensions'
         GROUP BY status, reason`,
      [] as Row[],
      (x) => x,
    ),
    q(
      "dimensionCallers",
      `SELECT index1, sum(_sample_interval) AS n FROM ${DATASET}
         WHERE timestamp > ${since} AND blob9 = 'dimensions' GROUP BY index1`,
      0,
      (x) => x.length,
    ),
    q(
      "dimensionSeries",
      `SELECT toStartOfInterval(timestamp, INTERVAL '${r.interval}) AS t,
                sum(_sample_interval) AS requests, sum(double1 * _sample_interval) AS classifications
         FROM ${DATASET} WHERE timestamp > ${since} AND blob9 = 'dimensions'
         GROUP BY t ORDER BY t`,
      [] as Row[],
      (x) => x,
    ),
    q(
      "previous",
      `SELECT sum(_sample_interval) AS requests, sum(double1 * _sample_interval) AS classifications,
                sum(double3 * _sample_interval) AS usd, sum(double2 * _sample_interval) / sum(_sample_interval) AS avg_ms
         FROM ${DATASET} WHERE timestamp > toDateTime(now()) - INTERVAL '${r.hours * 2}' HOUR AND timestamp <= ${since}`,
      [] as Row[],
      (x) => x,
    ),
    q(
      "performance",
      `SELECT toStartOfInterval(timestamp, INTERVAL '${r.interval}) AS t,
                sum(double2 * _sample_interval) / sum(_sample_interval) AS avg_ms,
                sum(double1 * _sample_interval) / sum(_sample_interval) AS batch_size,
                sum(_sample_interval) AS requests
         FROM ${DATASET} WHERE timestamp > ${since} AND (blob4 = '200' OR blob4 LIKE '5%')
         GROUP BY t ORDER BY t`,
      [] as Row[],
      (x) => x,
    ),
    q(
      "outcomes",
      `SELECT toStartOfInterval(timestamp, INTERVAL '${r.interval}) AS t, blob4 AS status,
                sum(_sample_interval) AS requests
         FROM ${DATASET} WHERE timestamp > ${since} GROUP BY t, status ORDER BY t`,
      [] as Row[],
      (x) => x,
    ),
    q("chatOutcomes", `SELECT blob2 AS outcome, ${CHAT_FIELDS.map((name, i) => `sum(double${i + 1} * _sample_interval) AS ${name}`).join(", ")}
      FROM ${CHAT_DATASET} WHERE timestamp > ${since} GROUP BY outcome`, [] as Row[], x => x),
    q("chatSeries", `SELECT toStartOfInterval(timestamp, INTERVAL '${r.interval}) AS t,
      sum(double1 * _sample_interval) AS turns, sum(double6 * _sample_interval) AS usd,
      sum(double2 * _sample_interval) / sum(_sample_interval) AS avg_ms
      FROM ${CHAT_DATASET} WHERE timestamp > ${since} AND blob2 IN ('completed', 'failed', 'stopped') GROUP BY t ORDER BY t`, [] as Row[], x => x),
    q("chatCallers", `SELECT index1, sum(_sample_interval) AS n FROM ${CHAT_DATASET}
      WHERE timestamp > ${since} AND blob2 IN ('completed', 'failed', 'stopped') GROUP BY index1`, 0, x => x.length),
  ]);

  const classifierNames = new Map<string, string>();
  const fingerprints = [...new Set(
    [...topLabels, ...failLabels]
      .map((row) => String(row.labels ?? ""))
      .filter(Boolean),
  )];
  await Promise.all(fingerprints.map(async (fingerprint) => {
    const labels = await recordedClassifierLabels(env.STATS, fingerprint);
    if (labels.length) classifierNames.set(fingerprint, labels.join(" · "));
  }));
  const nameClassifiers = (rows: Row[]) => rows.map((row) => ({
    ...row,
    label_names: classifierNames.get(String(row.labels ?? "")) ?? "—",
  }));

  return {
    totals,
    series,
    byTier,
    byModel,
    modelSeries,
    modelFailures,
    byCountry,
    byStatus,
    byClient,
    topLabels: nameClassifiers(topLabels),
    visitors,
    labelSets,
    byReason,
    byAgent,
    failLabels: nameClassifiers(failLabels),
    dimensionTraffic,
    dimensionCallers,
    dimensionSeries,
    previous,
    performance,
    outcomes,
    chatOutcomes,
    chatSeries,
    chatCallers,
    errors,
    unavailable,
    generatedAt: new Date().toISOString(),
  };
}

export type AdminData = Awaited<ReturnType<typeof load>>;

// The plain HTML report remains readable before the chart bundle loads and
// when JavaScript is disabled. It shares the same authenticated data snapshot.
const STYLE =
  BASE_CSS +
  `
.kv{display:grid;gap:8px;margin:16px 0}.kv .k{display:flex;justify-content:space-between;gap:20px}
.kv dd{margin:0;font-variant-numeric:tabular-nums}.kv dt{color:var(--muted)}
.login{min-height:100dvh;display:grid;place-items:center;padding:24px}
.loginbox{width:100%;max-width:420px}.loginbox>*+*{margin-top:16px}
input[type=password]{width:100%;padding:8px;background:var(--surface);color:var(--fg);border:1px solid var(--line-strong);border-radius:var(--r);font:inherit}
.err{color:var(--bad)}
`;

function shell(title: string, body: string, extra = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">
<meta name="theme-color" content="#0b0e14">
<title>${esc(title)}</title><style>${STYLE}</style></head>
<body>${body}${extra}</body></html>`;
}

function loginPage(error: string | undefined, csrf: string) {
  return shell(
    "admin · classifier.dev",
    `<div class="login"><form class="loginbox" method="POST" action="/admin">
      <input type="hidden" name="csrf" value="${esc(csrf)}">
      <h1><span class="syn"># </span>classifier.dev admin</h1>
      <p class="quote">operator dashboard, password required</p>
      <div>
        <label for="p">Password</label>
        <input id="p" name="password" type="password" autocomplete="current-password" autofocus required>
      </div>
      <p><button type="submit" class="b"><span class="br">[</span>sign in<span class="br">]</span></button></p>
      ${error ? `<p class="err">${esc(error)}</p>` : ""}
    </form></div>`,
  );
}

export function dashboard(range: RangeKey, d: AdminData, nonce: string) {
  const t = d.totals[0] ?? {};
  const requests = num(t.requests),
    classifications = num(t.classifications);
  const total = (rows: Row[], key: string) =>
    rows.reduce((n, r) => n + num(r[key]), 0);
  const failed = total(
    d.byStatus.filter((r) => String(r.status).startsWith("5")),
    "requests",
  );
  const ok = total(
    d.byStatus.filter((r) => String(r.status) === "200"),
    "requests",
  );
  const dimFailed = total(
    d.dimensionTraffic.filter((r) => String(r.status).startsWith("5")),
    "requests",
  );
  const dimOk = total(
    d.dimensionTraffic.filter((r) => String(r.status) === "200"),
    "requests",
  );
  const rate = (n: number, total: number) =>
    total ? `${((n / total) * 100).toFixed(1)}%` : "—";
  const kv = (rows: [string, string][]) =>
    `<dl class="kv">${rows.map(([k, v]) => `<div class="k"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`;
  const unavailable = (key: string, content: string) =>
    d.unavailable.includes(key)
      ? `<p>Data unavailable. Refresh to retry.</p>`
      : content;
  const table = (name: string, rows: Row[], keys: string[], query: string) =>
    `<section><h2>${esc(name)}</h2>${unavailable(query, rows.length ? `<div class="scroll"><table><thead><tr>${keys.map((k) => `<th>${esc(k)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${keys.map((k) => `<td>${esc(k === "reason" ? reasonText(String(r[k] || "")) : (r[k] ?? "—"))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<p>No activity in this period.</p>`)}</section>`;
  const body = `<div class="page"><article class="doc">
<h1>Service analytics</h1><p>${esc(RANGES[range].label)} · ${esc(d.generatedAt)} · UTC</p>
<nav aria-label="Time range"><a href="/admin?range=24h">24h</a> · <a href="/admin?range=7d">7d</a> · <a href="/admin?range=30d">30d</a> · <a href="/admin?logout=1">Sign out</a></nav>
<noscript><p>Enable JavaScript for interactive charts. The data report is available below.</p></noscript>
${d.errors.length ? `<p role="alert">some panels are empty because data is unavailable. Refresh to retry. ${esc(d.errors.join(" · ").slice(0, 300))}</p>` : ""}
<section><h2>Totals</h2>${unavailable(
    "totals",
    kv([
      ["requests", group(requests)],
      ["classifications", group(classifications)],
      ["upstream spend", usd(num(t.usd))],
      ["avg latency", ms(num(t.avg_ms))],
    ]),
  )}${unavailable(
    "byStatus",
    kv([
      ["server error rate", rate(failed, ok + failed)],
      [
        "rejected requests",
        group(
          total(
            d.byStatus.filter((r) => String(r.status).startsWith("4")),
            "requests",
          ),
        ),
      ],
    ]),
  )}<p>Traffic, spend and latency are sampling-adjusted estimates. Caller identifiers rotate daily; counts reflect observed caller-days, not unique people.</p></section>
<section><h2>Multidimensional classification</h2>${unavailable(
    "dimensionTraffic",
    kv([
      ["requests", group(total(d.dimensionTraffic, "requests"))],
      ["successful items", group(total(d.dimensionTraffic, "items"))],
      ["decisions", group(total(d.dimensionTraffic, "classifications"))],
      ["uncertain fields", group(total(d.dimensionTraffic, "uncertain"))],
      ["fallback fields", group(total(d.dimensionTraffic, "fallback"))],
      [
        "server failures",
        `${group(dimFailed)} (${rate(dimFailed, dimOk + dimFailed)} of accepted)`,
      ],
    ]),
  )}</section>
${table("Chat usage", d.chatOutcomes, ["outcome", "turns", "modelCalls", "inputTokens", "outputTokens", "usd", "unknownTokenCalls", "unknownCostCalls", "toolCalls", "starts"], "chatOutcomes")}
${table("Traffic buckets", d.series, ["t", "requests", "classifications", "usd"], "series")}
${table("Accepted-request performance", d.performance, ["t", "avg_ms", "batch_size"], "performance")}
${table("Models", d.byModel, ["model", "provider", "requests", "classifications", "failures", "rejected", "avg_ms", "input_tokens", "output_tokens", "token_requests", "image_requests", "usd", "cost_basis"], "byModel")}
<p>Model combinations share a request; totals are not per-model allocations. Latency excludes 4xx. Token and image details start with this release; missing historical usage is unknown. Recorded spend excludes hourly GPUs, hosting and revenue.</p>
${table("Model failures", d.modelFailures, ["model", "reason", "status", "requests"], "modelFailures")}
${table("Tiers", d.byTier, ["tier", "requests", "classifications", "usd", "avg_ms"], "byTier")}
${table("Failure causes", d.byReason, ["reason", "status", "agent", "requests"], "byReason")}
${table("Dimension outcomes", d.dimensionTraffic, ["status", "reason", "requests", "uncertain", "fallback"], "dimensionTraffic")}
${table("Clients", d.byAgent, ["agent", "requests", "classifications"], "byAgent")}
${table("Countries", d.byCountry, ["country", "requests"], "byCountry")}
${table("Busiest classifiers", d.topLabels, ["label_names", "labels", "requests", "classifications", "usd"], "topLabels")}
</article></div>`;
  return shell(
    "admin · classifier.dev",
    body,
    `<link rel="stylesheet" href="/admin-assets/admin.css">
<script nonce="${nonce}" src="/admin-assets/admin.js" defer data-admin="${esc(JSON.stringify({ range, data: d }))}"></script>`,
  );
}

// ---------------------------------------------------------------- entry

async function classifierRegistry(env: Env, cursor: string) {
  const listed = await env.STATS.list({ prefix: "clsn:ls_", limit: 50, ...(cursor ? { cursor } : {}) });
  const rows = await Promise.all(listed.keys.map(async ({ name }) => {
    const fingerprint = name.slice(5);
    const raw = await env.STATS.get(`cls:${fingerprint}`);
    let labels: string[] = [];
    try {
      const parsed = JSON.parse(raw ?? "null")?.labels;
      if (Array.isArray(parsed) && parsed.length && parsed.every(label => typeof label === "string")) labels = parsed;
    } catch { /* Legacy timestamp-only entries have no label names. */ }
    return { fingerprint, labels };
  }));
  return { rows: rows.filter(row => row.labels.length), cursor: listed.list_complete ? "" : listed.cursor };
}

function classifierRegistryPage(data: Awaited<ReturnType<typeof classifierRegistry>> | null, cursor: string) {
  const navigation = (position: string) => `<nav class="actions label-pages" aria-label="${position} label set pages">
    ${cursor ? '<a class="control" href="/admin?view=labels">First page</a>' : ""}
    ${data?.cursor ? `<a class="control" href="/admin?view=labels&amp;cursor=${esc(encodeURIComponent(data.cursor))}" rel="next">Next page →</a>` : ""}
  </nav>`;
  return shell("All label sets · classifier.dev", `<div class="admin-app dark">
    <a class="label-skip control" href="#label-sets">Skip to label sets</a>
    <header class="topbar"><a class="brand" href="/">classifier<span>.dev</span></a><a class="signout" href="/admin?logout=1">Sign out ↗</a></header>
    <main id="label-sets">
      <div class="page-heading"><div><h1>All label sets</h1><p>Full retained registry · up to 90 days · not limited by the analytics date range</p></div>
      <a class="control" href="/admin#Adoption">Back to analytics</a></div>
      <p>All collected label names, grouped by label set. Historical fingerprints without names are not listed. Dimension definitions remain fingerprint-only.</p>
      ${data ? `<p>${data.rows.length} label sets on this page, in fingerprint order. New entries may take a minute to appear.</p>${navigation("Top")}
        ${data.rows.length ? `<table class="label-registry"><thead><tr><th scope="col">Labels</th><th scope="col">Classifier fingerprint</th></tr></thead><tbody>
          ${data.rows.map(row => `<tr data-classifier="${esc(row.fingerprint)}"><td><ul class="label-values">${row.labels.map(label => `<li>${esc(label)}</li>`).join("")}</ul></td><td><code>${esc(row.fingerprint)}</code></td></tr>`).join("")}
        </tbody></table>${navigation("Bottom")}` : `<p class="empty-state">${cursor ? "No label sets on this page. Return to the first page to refresh the registry." : "No label sets collected yet. Successful classifications will appear here."}</p>`}`
        : '<p role="alert">Unable to load label sets. Reload this page to retry, or <a href="/admin?view=labels">start from the first page</a>.</p>'}
    </main></div>`, '<link rel="stylesheet" href="/admin-assets/admin.css">');
}

/**
 * What a page of operator figures is allowed to do, which is nothing. It loads
 * no third-party anything, so `default-src 'none'` costs it nothing and turns
 * any injected `<script src>` into a console error. The script it does carry
 * runs off a per-response nonce; inline `style=` attributes stay allowed
 * because the charts are drawn with them and none of them is caller-controlled.
 *
 * The rest keeps the page out of indexes, out of frames, out of caches, and
 * out of the Referer header of anything an operator clicks next.
 */
function securityHeaders(nonce?: string): Record<string, string> {
  const csp = [
    "default-src 'none'",
    nonce ? `script-src 'nonce-${nonce}'` : "script-src 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  return {
    "content-security-policy": csp,
    "x-robots-tag": "noindex, nofollow, noarchive, nosnippet",
    "cache-control": "no-store, no-cache, must-revalidate, private",
    pragma: "no-cache",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "permissions-policy": "accelerometer=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
  };
}

const nonce = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/=+$/, "");

/** The dashboard, the one page here that carries a script. */
function page(status: number, build: (nonce: string) => string) {
  const n = nonce();
  return new Response(build(n), {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...securityHeaders(n) },
  });
}

/** Everything before sign-in: no script, so no nonce, so `script-src 'none'`. */
function locked(status: number, error?: string, clearSession = false) {
  const token = mintCsrf();
  const headers = new Headers({ "content-type": "text/html; charset=utf-8", ...securityHeaders() });
  // Two cookies on one response, so `append`: an object literal would let the
  // session-clearing header replace the token the next attempt needs.
  headers.append("set-cookie", csrfCookie(token));
  if (clearSession) headers.append("set-cookie", cookie("", 0));
  return new Response(loginPage(error, token), { status, headers });
}

const cookie = (value: string, maxAge: number) =>
  `${COOKIE}=${value}; Path=/admin; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;

const csrfCookie = (value: string) =>
  `${CSRF_COOKIE}=${value}; Path=/admin; Max-Age=${CSRF_MINUTES * 60}; HttpOnly; Secure; SameSite=Strict`;

/** Returns null when the path is not /admin, so the caller can carry on routing. */
export async function adminResponse(req: Request, env: Env, path: string, ip: string): Promise<Response | null> {
  if (path !== "admin") return null;

  const secret = env.ADMIN_PASSWORD;
  // With no password configured there is no dashboard, and saying so would
  // confirm the route to anyone who asks. It reads as any other missing page.
  if (!secret) return null;

  const url = new URL(req.url);

  if (url.searchParams.get("logout") !== null) {
    return new Response(null, {
      status: 302,
      headers: {
        location: "/admin",
        "set-cookie": cookie("", 0),
        "clear-site-data": '"cookies"',
        ...securityHeaders(),
      },
    });
  }

  if (req.method === "POST") {
    // A cross-site form can post here, and SameSite=Strict only protects the
    // cookie it would set, not the guess it carries. `Origin` settles it when
    // the browser sends one. When it does not, the form's token does: a
    // cross-site post cannot read it and its Strict cookie does not travel.
    const stated = statedOrigin(req, url);
    if (stated === "mismatch") return locked(403, "Bad request origin.");
    const form = await req.formData().catch(() => null);
    if (stated === "absent" && !(await csrfOk(req, String(form?.get("csrf") ?? "")))) {
      // Said plainly, because the ordinary way to arrive here is a form left
      // open past the token's half hour, and the page now carries a fresh one.
      return locked(403, "Login form expired. Try again.");
    }
    if (await loginLimited(env, ip)) return locked(429, "Too many attempts. Wait a minute and try again.");
    const given = String(form?.get("password") ?? "");
    if (!(await secretEquals(given, secret))) return locked(401, "Wrong password.");
    return new Response(null, {
      status: 302,
      headers: {
        location: "/admin",
        "set-cookie": cookie(await mint(env, secret), SESSION_HOURS * 3600),
        ...securityHeaders(),
      },
    });
  }

  const token = readCookie(req, COOKIE);
  if (!(await valid(env, secret, token))) {
    // A cookie that does not check out is either stale or a forgery attempt,
    // and forging is worth rate limiting for the same reason guessing is.
    if (token && (await loginLimited(env, ip))) return locked(429, "Too many attempts. Wait a minute and try again.");
    // A cookie that does not check out should not come back on the next request.
    return locked(401, undefined, Boolean(token));
  }

  const asked = url.searchParams.get("range") ?? "24h";
  if (url.searchParams.get("view") === "labels") {
    const cursor = url.searchParams.get("cursor") ?? "";
    try {
      if (cursor.length > 2048) return page(400, () => classifierRegistryPage(null, ""));
      const registry = await classifierRegistry(env, cursor);
      return page(200, () => classifierRegistryPage(registry, cursor));
    } catch {
      return page(503, () => classifierRegistryPage(null, cursor));
    }
  }
  const range: RangeKey = asked === "7d" || asked === "30d" ? asked : "24h";
  const data = await load(env, range);
  return page(200, (n) => dashboard(range, data, n));
}
