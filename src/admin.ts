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
 * cookie; there is no session store to keep.
 */

import type { Env } from "./index";
import { sql } from "./report";

const DATASET = "classifier_events";
const COOKIE = "cd_admin";
const SESSION_HOURS = 12;
/** Wrong passwords are cheap to try, so they go through the same limiter as the API. */
const LOGIN_ATTEMPTS_PER_MIN = 10;

type RangeKey = "24h" | "7d" | "30d";
const RANGES: Record<RangeKey, { hours: number; interval: string; label: string; tick: string }> = {
  "24h": { hours: 24, interval: "1' HOUR", label: "last 24 hours", tick: "%H:%M" },
  "7d": { hours: 24 * 7, interval: "6' HOUR", label: "last 7 days", tick: "%b %d" },
  "30d": { hours: 24 * 30, interval: "1' DAY", label: "last 30 days", tick: "%b %d" },
};

// ---------------------------------------------------------------- auth

const enc = new TextEncoder();

async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Comparison that does not leak how far it got. */
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function mint(secret: string) {
  const exp = String(Date.now() + SESSION_HOURS * 3_600_000);
  return `${exp}.${await hmac(secret, exp)}`;
}

async function valid(secret: string, token: string | undefined) {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return false;
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await hmac(secret, exp));
}

function readCookie(req: Request, name: string) {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

async function loginLimited(env: Env, ip: string) {
  try {
    const id = env.LIMITER.idFromName(`adminlogin:${ip}`);
    const res = await env.LIMITER.get(id).fetch(
      `https://limiter/?limit=${LOGIN_ATTEMPTS_PER_MIN}&daily=200&cost=1`,
    );
    return ((await res.json()) as { limited?: boolean }).limited === true;
  } catch {
    return false; // a limiter wobble must not lock the operator out
  }
}

// ---------------------------------------------------------------- helpers

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

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

  const q = async <T>(query: string, fallback: T, use: (rows: Row[]) => T): Promise<T> => {
    try {
      return use(await sql(env, query));
    } catch (e) {
      const m = (e as Error).message;
      if (!errors.includes(m)) errors.push(m);
      return fallback;
    }
  };

  const [totals, series, byTier, byModel, byCountry, byStatus, byClient, topLabels, visitors, labelSets,
         byReason, byAgent, failLabels] =
    await Promise.all([
      q(
        `SELECT count() AS requests, sum(double1) AS classifications,
                sum(double3) AS usd, avg(double2) AS avg_ms
         FROM ${DATASET} WHERE timestamp > ${since}`,
        [] as Row[],
        (x) => x,
      ),
      q(
        `SELECT toStartOfInterval(timestamp, INTERVAL '${r.interval}) AS t,
                count() AS requests, sum(double1) AS classifications, sum(double3) AS usd
         FROM ${DATASET} WHERE timestamp > ${since} GROUP BY t ORDER BY t`,
        [] as Row[],
        (x) => x,
      ),
      q(
        `SELECT blob1 AS tier, count() AS requests, sum(double1) AS classifications,
                sum(double3) AS usd, avg(double2) AS avg_ms
         FROM ${DATASET} WHERE timestamp > ${since} GROUP BY tier ORDER BY requests DESC`,
        [] as Row[],
        (x) => x,
      ),
      q(
        `SELECT blob6 AS model, count() AS requests, sum(double1) AS classifications,
                sum(double3) AS usd, avg(double2) AS avg_ms
         FROM ${DATASET} WHERE timestamp > ${since} AND blob6 != ''
         GROUP BY model ORDER BY requests DESC LIMIT 10`,
        [] as Row[],
        (x) => x,
      ),
      q(
        `SELECT blob3 AS country, count() AS requests FROM ${DATASET}
         WHERE timestamp > ${since} GROUP BY country ORDER BY requests DESC LIMIT 10`,
        [] as Row[],
        (x) => x,
      ),
      q(
        `SELECT blob4 AS status, count() AS requests FROM ${DATASET}
         WHERE timestamp > ${since} GROUP BY status ORDER BY requests DESC`,
        [] as Row[],
        (x) => x,
      ),
      q(
        `SELECT blob5 AS client, count() AS requests, sum(double1) AS classifications, sum(double3) AS usd
         FROM ${DATASET} WHERE timestamp > ${since} GROUP BY client ORDER BY requests DESC`,
        [] as Row[],
        (x) => x,
      ),
      q(
        `SELECT blob2 AS labels, count() AS requests, sum(double1) AS classifications, sum(double3) AS usd
         FROM ${DATASET} WHERE timestamp > ${since} AND blob2 != ''
         GROUP BY labels ORDER BY requests DESC LIMIT 12`,
        [] as Row[],
        (x) => x,
      ),
      // Analytics Engine SQL has no uniq(); a distinct count is the row count of a GROUP BY.
      q(
        `SELECT index1, count() AS n FROM ${DATASET} WHERE timestamp > ${since} GROUP BY index1`,
        0,
        (x) => x.length,
      ),
      q(
        `SELECT blob2, count() AS n FROM ${DATASET} WHERE timestamp > ${since} AND blob2 != '' GROUP BY blob2`,
        0,
        (x) => x.length,
      ),
      // Why requests fail. blob7 is "" on success, so this is the failure set.
      q(
        `SELECT blob7 AS reason, blob4 AS status, blob8 AS agent, count() AS requests, avg(double4) AS avg_inputs
         FROM ${DATASET} WHERE timestamp > ${since} AND blob7 != ''
         GROUP BY reason, status, agent ORDER BY requests DESC LIMIT 60`,
        [] as Row[],
        (x) => x,
      ),
      q(
        `SELECT blob8 AS agent, count() AS requests, sum(double1) AS classifications
         FROM ${DATASET} WHERE timestamp > ${since} AND blob8 != ''
         GROUP BY agent ORDER BY requests DESC LIMIT 10`,
        [] as Row[],
        (x) => x,
      ),
      // Which classifier configurations are the failing ones.
      q(
        `SELECT blob2 AS labels, blob7 AS reason, count() AS requests
         FROM ${DATASET} WHERE timestamp > ${since} AND blob7 != '' AND blob2 != ''
         GROUP BY labels, reason ORDER BY requests DESC LIMIT 12`,
        [] as Row[],
        (x) => x,
      ),
    ]);

  return { totals, series, byTier, byModel, byCountry, byStatus, byClient, topLabels, visitors, labelSets,
    byReason, byAgent, failLabels, errors };
}

// ---------------------------------------------------------------- charts

/**
 * One measure over time. Two measures of different scale get two charts, never
 * two y-axes on one. Marks are thin, the grid is recessive, and the hover layer
 * is wired up by the script at the bottom of the page.
 */
function areaChart(id: string, points: { t: string; v: number }[], color: string, fmt: (n: number) => string) {
  const W = 760;
  const H = 200;
  const L = 52;
  const R = 12;
  const T = 14;
  const B = 28;
  if (!points.length) return `<div class="empty">No data in this range yet.</div>`;

  const max = Math.max(...points.map((p) => p.v), 0);
  const top = max <= 0 ? 1 : max * 1.15;
  const iw = W - L - R;
  const ih = H - T - B;
  const x = (i: number) => L + (points.length === 1 ? iw / 2 : (i * iw) / (points.length - 1));
  const y = (v: number) => T + ih - (v / top) * ih;

  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const area = `${line}L${x(points.length - 1).toFixed(1)},${T + ih}L${x(0).toFixed(1)},${T + ih}Z`;

  const ticks = [0, top / 2, top];
  const grid = ticks
    .map(
      (v) =>
        `<line class="gridline" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>` +
        `<text class="ylab" x="${L - 8}" y="${(y(v) + 4).toFixed(1)}">${esc(fmt(v))}</text>`,
    )
    .join("");

  // A label on every point is noise; first, middle and last carry the axis.
  const xi = points.length <= 2 ? [0, points.length - 1] : [0, Math.floor((points.length - 1) / 2), points.length - 1];
  const xlab = [...new Set(xi)]
    .map(
      (i) =>
        `<text class="xlab" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="${
          i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"
        }">${esc(points[i].t)}</text>`,
    )
    .join("");

  const hit = points
    .map(
      (p, i) =>
        `<rect class="hit" data-i="${i}" x="${(x(i) - iw / Math.max(points.length, 1) / 2).toFixed(1)}" y="${T}" ` +
        `width="${(iw / Math.max(points.length, 1)).toFixed(1)}" height="${ih}"/>`,
    )
    .join("");

  return `<div class="chartwrap" data-chart="${id}">
  <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Time series; the table below lists every value.">
    <defs><linearGradient id="g-${id}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.26"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
    </linearGradient></defs>
    ${grid}
    <path d="${area}" fill="url(#g-${id})"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <line class="cross" x1="0" x2="0" y1="${T}" y2="${T + ih}" style="display:none"/>
    <circle class="dot" r="4.5" fill="${color}" style="display:none"/>
    ${xlab}
    ${hit}
  </svg>
  <div class="tip" hidden></div>
</div>`;
}

/** Horizontal bars. Always direct-labelled, which is also the light-mode relief rule. */
function barList(rows: { name: string; value: number; note?: string; color: string }[], fmt: (n: number) => string) {
  if (!rows.length) return `<div class="empty">Nothing here yet.</div>`;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return `<div class="bars">${rows
    .map(
      (r) => `<div class="bar">
      <div class="bar-name" title="${esc(r.name)}">${esc(r.name)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max((r.value / max) * 100, 1.5)}%;background:${r.color}"></div></div>
      <div class="bar-val">${esc(fmt(r.value))}${r.note ? `<span class="bar-note">${esc(r.note)}</span>` : ""}</div>
    </div>`,
    )
    .join("")}</div>`;
}

// ---------------------------------------------------------------- page

const STYLE = `
:root{
  color-scheme:light;
  --bg:#f6f6f4; --surface:#fcfcfb; --surface-2:#f1f1ee; --border:#e2e2dd;
  --text:#14131a; --text-2:#52514e; --muted:#7a7a74;
  --accent:#5b2fd6;
  --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a;
  --good:#1a7f37; --warn:#9a6700; --crit:#cf222e;
  --shadow:0 1px 2px rgba(20,19,26,.06),0 4px 16px rgba(20,19,26,.05);
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  color-scheme:dark;
  --bg:#121016; --surface:#1a1720; --surface-2:#221d2b; --border:#2e2838;
  --text:#f4f2f8; --text-2:#c3c0cc; --muted:#8e8a9a;
  --accent:#a98cff;
  --s1:#3987e5; --s2:#d95926; --s3:#199e70;
  --good:#3fb950; --warn:#d29922; --crit:#f85149;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 4px 20px rgba(0,0,0,.3);
}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
  font:15px/1.5 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;
  -webkit-font-smoothing:antialiased}
a{color:var(--accent)}
.wrap{max-width:1140px;margin:0 auto;padding:28px 16px 72px}
header{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:8px}
.mark{width:26px;height:26px;border-radius:7px;background:var(--accent);flex:none}
h1{font-size:17px;margin:0;font-weight:640;letter-spacing:-.01em}
h1 span{color:var(--muted);font-weight:450}
.sub{color:var(--muted);font-size:13px;margin:0 0 22px}
.spacer{flex:1}
.tabs{display:flex;gap:2px;background:var(--surface-2);padding:3px;border-radius:9px;border:1px solid var(--border)}
.tabs a{padding:5px 13px;border-radius:7px;font-size:13px;text-decoration:none;color:var(--text-2);font-weight:500}
.tabs a.on{background:var(--surface);color:var(--text);box-shadow:var(--shadow)}
.logout{font-size:13px;color:var(--muted);text-decoration:none}
.logout:hover{color:var(--text)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:12px;margin-bottom:24px}
.kpi{background:var(--surface);border:1px solid var(--border);border-radius:13px;padding:15px 16px;box-shadow:var(--shadow)}
.kpi .k{font-size:12px;color:var(--muted);letter-spacing:.02em;margin-bottom:7px}
.kpi .v{font-size:25px;font-weight:660;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1.15}
.kpi .n{font-size:12px;color:var(--text-2);margin-top:5px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media(max-width:820px){.grid{grid-template-columns:1fr}}
.card{background:var(--surface);border:1px solid var(--border);border-radius:13px;padding:16px 18px 18px;box-shadow:var(--shadow);margin-bottom:16px;min-width:0}
.card h2{font-size:13px;margin:0 0 3px;font-weight:600;letter-spacing:.01em}
.card .cap{font-size:12px;color:var(--muted);margin:0 0 14px}
.chartwrap{position:relative}
.chartwrap svg{width:100%;height:190px;display:block;overflow:visible}
.gridline{stroke:var(--border);stroke-width:1}
.ylab,.xlab{fill:var(--muted);font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.ylab{text-anchor:end}
.cross{stroke:var(--muted);stroke-width:1;stroke-dasharray:3 3}
.dot{stroke:var(--surface);stroke-width:2}
.hit{fill:transparent}
.tip{position:absolute;pointer-events:none;background:var(--text);color:var(--bg);font-size:12px;
  padding:6px 9px;border-radius:7px;white-space:nowrap;transform:translate(-50%,-135%);z-index:5;
  font-variant-numeric:tabular-nums;box-shadow:var(--shadow)}
.bars{display:flex;flex-direction:column;gap:9px}
.bar{display:grid;grid-template-columns:minmax(72px,132px) 1fr auto;gap:11px;align-items:center}
.bar-name{font-size:13px;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar-track{background:var(--surface-2);border-radius:4px;height:9px;overflow:hidden}
.bar-fill{height:100%;border-radius:4px}
.bar-val{font-size:13px;font-variant-numeric:tabular-nums;font-weight:560;text-align:right}
.bar-note{color:var(--muted);font-weight:430;margin-left:6px;font-size:12px}
table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
th,td{text-align:right;padding:7px 8px;border-bottom:1px solid var(--border)}
th:first-child,td:first-child{text-align:left}
th{color:var(--muted);font-weight:530;font-size:12px}
td.lab{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;max-width:340px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
tbody tr:last-child td{border-bottom:0}
details{margin-top:6px}
summary{cursor:pointer;font-size:12px;color:var(--muted);padding:5px 0}
.empty{color:var(--muted);font-size:13px;padding:22px 0;text-align:center}
.note{background:var(--surface-2);border:1px solid var(--border);border-radius:9px;padding:9px 12px;
  font-size:12px;color:var(--text-2);margin-bottom:16px}
.pill{display:inline-block;width:8px;height:8px;border-radius:3px;margin-right:7px;vertical-align:baseline}
.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--text-2);margin-bottom:10px}
/* login */
.login{min-height:100dvh;display:grid;place-items:center;padding:24px}
.loginbox{background:var(--surface);border:1px solid var(--border);border-radius:15px;padding:26px;
  width:100%;max-width:340px;box-shadow:var(--shadow)}
.loginbox h1{margin:14px 0 5px}
.loginbox p{color:var(--muted);font-size:13px;margin:0 0 18px}
label{display:block;font-size:12px;color:var(--text-2);margin-bottom:6px}
input[type=password]{width:100%;padding:10px 12px;border-radius:9px;border:1px solid var(--border);
  background:var(--bg);color:var(--text);font-size:14px;font-family:inherit}
input[type=password]:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:transparent}
button{width:100%;margin-top:13px;padding:10px;border-radius:9px;border:0;background:var(--accent);
  color:#fff;font-size:14px;font-weight:580;cursor:pointer;font-family:inherit}
button:hover{filter:brightness(1.07)}
.err{color:var(--crit);font-size:13px;margin-top:12px}
`;

function shell(title: string, body: string, extra = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title><style>${STYLE}</style></head>
<body>${body}${extra}</body></html>`;
}

function loginPage(error?: string) {
  return shell(
    "admin · classifier.dev",
    `<div class="login"><form class="loginbox" method="POST" action="/admin">
      <div class="mark"></div>
      <h1>classifier.dev <span>admin</span></h1>
      <p>Operator dashboard. Password required.</p>
      <label for="p">Password</label>
      <input id="p" name="password" type="password" autocomplete="current-password" autofocus required>
      <button type="submit">Sign in</button>
      ${error ? `<div class="err">${esc(error)}</div>` : ""}
    </form></div>`,
  );
}

/** What each reason code means, in the words the caller would use. */
const REASON_TEXT: Record<string, string> = {
  bad_json: "Body was not valid JSON",
  no_input: "No text to classify",
  too_many_inputs: "Over 1,000 inputs",
  too_few_labels: "Fewer than 2 labels",
  too_many_labels: "Over 100 labels",
  empty_label: "A label was empty or not a string",
  duplicate_labels: "Labels were not distinct",
  empty_input: "An input was empty or not a string",
  input_too_long: "An input was over 32,000 characters",
  rate_limit_minute: "Per-minute rate limit",
  rate_limit_day: "Daily rate limit",
  chain_exhausted: "Every model in the chain failed",
  batch_unavailable: "Batch too large for the LLM fallback",
  timeout: "Upstream timed out",
  upstream_other: "Other upstream failure",
};
const reasonText = (r: string) => REASON_TEXT[r] ?? (r.startsWith("typesafe_") ? `TypeSafe returned ${r.slice(9)}` : r);

function dashboard(range: RangeKey, d: Awaited<ReturnType<typeof load>>) {
  const t = d.totals[0] ?? {};
  const requests = num(t.requests);
  const classifications = num(t.classifications);
  const spend = num(t.usd);
  const avgMs = num(t.avg_ms);

  const ok = d.byStatus.filter((r) => String(r.status) === "200").reduce((a, r) => a + num(r.requests), 0);
  const failed = requests - ok;
  const errRate = requests ? (failed / requests) * 100 : 0;
  const per1k = classifications ? (spend / classifications) * 1000 : 0;

  const fmtT = (iso: unknown) => {
    const s = String(iso ?? "").replace(" ", "T");
    const dt = new Date(/Z|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
    if (Number.isNaN(dt.getTime())) return String(iso ?? "");
    return range === "24h"
      ? dt.toISOString().slice(11, 16) + "Z"
      : dt.toISOString().slice(5, 10);
  };

  const pts = d.series.map((r) => ({ t: fmtT(r.t), reqs: num(r.requests), cls: num(r.classifications), usd: num(r.usd) }));

  const kpi = (k: string, v: string, n?: string) =>
    `<div class="kpi"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>${
      n ? `<div class="n">${esc(n)}</div>` : ""
    }</div>`;

  const tierColor: Record<string, string> = { fast: "var(--s1)", smart: "var(--s2)" };
  const statusColor = (s: string) =>
    s === "200" ? "var(--good)" : s.startsWith("4") ? "var(--warn)" : "var(--crit)";

  const tabs = (["24h", "7d", "30d"] as RangeKey[])
    .map((k) => `<a href="/admin?range=${k}"${k === range ? ' class="on"' : ""}>${k}</a>`)
    .join("");

  return shell(
    `admin · classifier.dev`,
    `<div class="wrap">
  <header>
    <div class="mark"></div>
    <h1>classifier.dev <span>admin</span></h1>
    <div class="spacer"></div>
    <nav class="tabs">${tabs}</nav>
    <a class="logout" href="/admin?logout=1">Sign out</a>
  </header>
  <p class="sub">${esc(RANGES[range].label)} · generated ${esc(new Date().toISOString().slice(0, 16).replace("T", " "))}Z</p>

  ${
    d.errors.length
      ? `<div class="note"><strong>Some panels are empty.</strong> Analytics Engine returned: ${esc(
          d.errors.join(" · ").slice(0, 300),
        )}</div>`
      : ""
  }
  ${
    spend === 0 && requests > 0
      ? `<div class="note">Spend reads <strong>$0</strong>, and failures have no recorded cause, for traffic served before this instrumentation shipped — both are real only for requests after that deploy.</div>`
      : ""
  }

  <div class="kpis">
    ${kpi("Requests", group(requests))}
    ${kpi("Classifications", group(classifications), requests ? `${(classifications / requests).toFixed(1)} per request` : undefined)}
    ${kpi("Upstream spend", usd(spend), "provider-reported")}
    ${kpi("Cost / 1k", usd(per1k), "per 1,000 classifications")}
    ${kpi("Avg latency", ms(avgMs))}
    ${kpi("Error rate", `${errRate.toFixed(1)}%`, `${group(failed)} of ${group(requests)}`)}
    ${kpi("Unique IPs", group(d.visitors))}
    ${kpi("Label sets", group(d.labelSets), "distinct classifiers")}
  </div>

  <div class="grid">
    <div class="card">
      <h2>Requests over time</h2>
      <p class="cap">One point per ${esc(RANGES[range].interval.replace("'", "").toLowerCase())} bucket.</p>
      ${areaChart("req", pts.map((p) => ({ t: p.t, v: p.reqs })), "var(--s1)", (n) => group(n))}
    </div>
    <div class="card">
      <h2>Upstream spend over time</h2>
      <p class="cap">What TypeSafe and OpenRouter charged, on its own scale.</p>
      ${areaChart("usd", pts.map((p) => ({ t: p.t, v: p.usd })), "var(--s2)", (n) => usd(n))}
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <h2>By tier</h2>
      <p class="cap">Requests, with spend and latency alongside.</p>
      ${barList(
        d.byTier.map((r) => ({
          name: String(r.tier || "?"),
          value: num(r.requests),
          note: `${usd(num(r.usd))} · ${ms(num(r.avg_ms))}`,
          color: tierColor[String(r.tier)] ?? "var(--s3)",
        })),
        group,
      )}
    </div>
    <div class="card">
      <h2>By model</h2>
      <p class="cap">Which model actually answered. A surprise here is a fallback.</p>
      ${barList(
        d.byModel.map((r) => ({
          name: String(r.model || "?"),
          value: num(r.requests),
          note: usd(num(r.usd)),
          color: "var(--s1)",
        })),
        group,
      )}
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <h2>By status</h2>
      <p class="cap">Green is 200; amber is a client error; red is upstream.</p>
      ${barList(
        d.byStatus.map((r) => ({
          name: String(r.status || "?"),
          value: num(r.requests),
          color: statusColor(String(r.status)),
        })),
        group,
      )}
    </div>
    <div class="card">
      <h2>By country</h2>
      <p class="cap">Coarse geography from the edge; no request text is ever stored.</p>
      ${barList(
        d.byCountry.map((r) => ({ name: String(r.country || "??"), value: num(r.requests), color: "var(--s3)" })),
        group,
      )}
    </div>
  </div>

  <div class="card">
    <h2>Public vs enterprise</h2>
    <p class="cap">Enterprise callers carry a bearer token and skip the rate limiter.</p>
    <table><thead><tr><th>Client</th><th>Requests</th><th>Classifications</th><th>Spend</th></tr></thead><tbody>
    ${
      d.byClient.length
        ? d.byClient
            .map(
              (r) =>
                `<tr><td>${esc(r.client || "public")}</td><td>${group(num(r.requests))}</td><td>${group(
                  num(r.classifications),
                )}</td><td>${esc(usd(num(r.usd)))}</td></tr>`,
            )
            .join("")
        : `<tr><td colspan="4" class="empty">Nothing here yet.</td></tr>`
    }
    </tbody></table>
  </div>

  <div class="card">
    <h2>Why requests fail</h2>
    <p class="cap">Every rejection now names its own cause. Amber is the caller's
      side of the wire, red is ours.</p>
    ${(() => {
      const byReason = new Map<string, { requests: number; status: string }>();
      for (const r of d.byReason) {
        const k = String(r.reason);
        const cur = byReason.get(k) ?? { requests: 0, status: String(r.status ?? "") };
        cur.requests += num(r.requests);
        byReason.set(k, cur);
      }
      const rows = [...byReason.entries()].sort((a, b) => b[1].requests - a[1].requests);
      if (!rows.length) return `<div class="empty">No failures recorded in this range.</div>`;
      return barList(
        rows.map(([reason, v]) => ({
          name: reasonText(reason),
          value: v.requests,
          color: v.status.startsWith("5") ? "var(--crit)" : "var(--warn)",
        })),
        group,
      );
    })()}
    <details><summary>Break it down by client and status</summary>
    <table><thead><tr><th>Cause</th><th>Client</th><th>Status</th><th>Requests</th><th>Avg inputs</th></tr></thead><tbody>
    ${
      d.byReason.length
        ? d.byReason
            .slice(0, 25)
            .map(
              (r) =>
                `<tr><td>${esc(reasonText(String(r.reason)))}</td><td>${esc(r.agent || "?")}</td><td>${esc(
                  r.status || "?",
                )}</td><td>${group(num(r.requests))}</td><td>${num(r.avg_inputs).toFixed(1)}</td></tr>`,
            )
            .join("")
        : `<tr><td colspan="5" class="empty">Nothing yet.</td></tr>`
    }
    </tbody></table></details>
  </div>

  <div class="grid">
    <div class="card">
      <h2>By client</h2>
      <p class="cap">Which kind of caller, from the User-Agent. One broken
        integration shows up here.</p>
      ${barList(
        d.byAgent.map((r) => ({
          name: String(r.agent || "?"),
          value: num(r.requests),
          note: `${group(num(r.classifications))} cls`,
          color: "var(--s1)",
        })),
        group,
      )}
    </div>
    <div class="card">
      <h2>Label sets that fail</h2>
      <p class="cap">The classifier configurations behind the rejections.</p>
      <table><thead><tr><th>Labels</th><th>Cause</th><th>Requests</th></tr></thead><tbody>
      ${
        d.failLabels.length
          ? d.failLabels
              .map(
                (r) =>
                  `<tr><td class="lab" title="${esc(r.labels)}">${esc(r.labels)}</td><td>${esc(
                    reasonText(String(r.reason)),
                  )}</td><td>${group(num(r.requests))}</td></tr>`,
              )
              .join("")
          : `<tr><td colspan="3" class="empty">Nothing yet.</td></tr>`
      }
      </tbody></table>
    </div>
  </div>

  <div class="card">
    <h2>Top label sets</h2>
    <p class="cap">The classifiers people actually built, busiest first.</p>
    <table><thead><tr><th>Labels</th><th>Requests</th><th>Classifications</th><th>Spend</th></tr></thead><tbody>
    ${
      d.topLabels.length
        ? d.topLabels
            .map(
              (r) =>
                `<tr><td class="lab" title="${esc(r.labels)}">${esc(r.labels)}</td><td>${group(
                  num(r.requests),
                )}</td><td>${group(num(r.classifications))}</td><td>${esc(usd(num(r.usd)))}</td></tr>`,
            )
            .join("")
        : `<tr><td colspan="4" class="empty">Nothing here yet.</td></tr>`
    }
    </tbody></table>
  </div>

  <div class="card">
    <h2>The numbers behind the charts</h2>
    <p class="cap">Every bucket, so nothing on this page is readable only by colour.</p>
    <details><summary>Show table (${pts.length} buckets)</summary>
    <table><thead><tr><th>Bucket</th><th>Requests</th><th>Classifications</th><th>Spend</th></tr></thead><tbody>
    ${pts
      .map(
        (p) =>
          `<tr><td>${esc(p.t)}</td><td>${group(p.reqs)}</td><td>${group(p.cls)}</td><td>${esc(usd(p.usd))}</td></tr>`,
      )
      .join("")}
    </tbody></table></details>
  </div>
</div>`,
    `<script>
// Crosshair + tooltip. The series is re-read from the table so the markup stays
// the single source of truth for what the chart is showing.
const DATA = ${JSON.stringify({
      req: pts.map((p) => [p.t, group(p.reqs) + " requests"]),
      usd: pts.map((p) => [p.t, usd(p.usd) + " spend"]),
    })};
for (const wrap of document.querySelectorAll(".chartwrap")) {
  const key = wrap.dataset.chart, svg = wrap.querySelector("svg");
  if (!svg || !DATA[key]) continue;
  const cross = svg.querySelector(".cross"), dot = svg.querySelector(".dot"), tip = wrap.querySelector(".tip");
  const line = svg.querySelector("path[stroke]");
  const show = (i, rect) => {
    const row = DATA[key][i]; if (!row) return;
    const hits = svg.querySelectorAll(".hit"), h = hits[i]; if (!h) return;
    const cx = +h.getAttribute("x") + +h.getAttribute("width") / 2;
    const len = line.getTotalLength();
    // Walk the path to the x we want; cheap enough at these point counts.
    let lo = 0, hi = len, pt = line.getPointAtLength(0);
    for (let k = 0; k < 18; k++) { const mid = (lo + hi) / 2; pt = line.getPointAtLength(mid);
      if (pt.x < cx) lo = mid; else hi = mid; }
    cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.style.display = "";
    dot.setAttribute("cx", pt.x); dot.setAttribute("cy", pt.y); dot.style.display = "";
    tip.hidden = false; tip.textContent = row[0] + " · " + row[1];
    tip.style.left = (pt.x / 760 * rect.width) + "px";
    tip.style.top = (pt.y / 200 * rect.height) + "px";
  };
  svg.addEventListener("mousemove", (e) => {
    const rect = svg.getBoundingClientRect();
    const hits = svg.querySelectorAll(".hit");
    const xr = (e.clientX - rect.left) / rect.width * 760;
    let best = 0, bd = Infinity;
    hits.forEach((h, i) => { const c = +h.getAttribute("x") + +h.getAttribute("width") / 2;
      const dd = Math.abs(c - xr); if (dd < bd) { bd = dd; best = i; } });
    show(best, rect);
  });
  svg.addEventListener("mouseleave", () => {
    cross.style.display = "none"; dot.style.display = "none"; tip.hidden = true;
  });
}
</script>`,
  );
}

// ---------------------------------------------------------------- entry

const HTML = { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex, nofollow", "cache-control": "no-store" };

/** Returns null when the path is not /admin, so the caller can carry on routing. */
export async function adminResponse(req: Request, env: Env, path: string, ip: string): Promise<Response | null> {
  if (path !== "admin") return null;

  const secret = env.ADMIN_PASSWORD;
  if (!secret) {
    return new Response(
      shell("admin · classifier.dev", `<div class="login"><div class="loginbox"><div class="mark"></div>
        <h1>classifier.dev <span>admin</span></h1>
        <p>ADMIN_PASSWORD is not set. Run <code>npx wrangler secret put ADMIN_PASSWORD</code> and redeploy.</p>
      </div></div>`),
      { status: 503, headers: HTML },
    );
  }

  const url = new URL(req.url);

  if (url.searchParams.get("logout") !== null) {
    return new Response(null, {
      status: 302,
      headers: { location: "/admin", "set-cookie": `${COOKIE}=; Path=/admin; Max-Age=0; HttpOnly; Secure; SameSite=Strict`, ...HTML },
    });
  }

  if (req.method === "POST") {
    if (await loginLimited(env, ip)) {
      return new Response(loginPage("Too many attempts. Wait a minute and try again."), { status: 429, headers: HTML });
    }
    const form = await req.formData().catch(() => null);
    const given = String(form?.get("password") ?? "");
    if (!safeEqual(await hmac(secret, given), await hmac(secret, secret))) {
      return new Response(loginPage("Wrong password."), { status: 401, headers: HTML });
    }
    return new Response(null, {
      status: 302,
      headers: {
        location: "/admin",
        "set-cookie": `${COOKIE}=${await mint(secret)}; Path=/admin; Max-Age=${SESSION_HOURS * 3600}; HttpOnly; Secure; SameSite=Strict`,
        ...HTML,
      },
    });
  }

  if (!(await valid(secret, readCookie(req, COOKIE)))) {
    return new Response(loginPage(), { status: 401, headers: HTML });
  }

  const asked = url.searchParams.get("range") ?? "24h";
  const range: RangeKey = asked === "7d" || asked === "30d" ? asked : "24h";
  return new Response(dashboard(range, await load(env, range)), { status: 200, headers: HTML });
}
