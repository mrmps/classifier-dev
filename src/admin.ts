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

/** Bar cells, in block characters. Monospace makes the column align itself. */
const BAR_CELLS = 20;

function blockBar(value: number, max: number, color: string) {
  const filled = max > 0 ? Math.max(1, Math.round((value / max) * BAR_CELLS)) : 0;
  return (
    `<span class="fill" style="color:${color}">${"█".repeat(filled)}</span>` +
    `<span class="track">${"░".repeat(BAR_CELLS - filled)}</span>`
  );
}

/**
 * One measure over time. Two measures of different scale get two charts, never
 * two y-axes on one. Thin marks, a recessive grid, and the hover layer wired up
 * by the script at the bottom of the page.
 */
function areaChart(id: string, points: { t: string; v: number }[], color: string, fmt: (n: number) => string) {
  const W = 760;
  const H = 190;
  const L = 64;
  const R = 8;
  const T = 12;
  const B = 26;
  if (!points.length) return `<div class="empty">no data in this range yet</div>`;

  const max = Math.max(...points.map((p) => p.v), 0);
  const top = max <= 0 ? 1 : max * 1.15;
  const iw = W - L - R;
  const ih = H - T - B;
  const x = (i: number) => L + (points.length === 1 ? iw / 2 : (i * iw) / (points.length - 1));
  const y = (v: number) => T + ih - (v / top) * ih;

  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const area = `${line}L${x(points.length - 1).toFixed(1)},${T + ih}L${x(0).toFixed(1)},${T + ih}Z`;

  const grid = [0, top / 2, top]
    .map(
      (v) =>
        `<line class="gridline" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>` +
        `<text class="ylab" x="${L - 10}" y="${(y(v) + 4).toFixed(1)}">${esc(fmt(v))}</text>`,
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

  const cell = iw / Math.max(points.length, 1);
  const hit = points
    .map((p, i) => `<rect class="hit" data-i="${i}" x="${(x(i) - cell / 2).toFixed(1)}" y="${T}" width="${cell.toFixed(1)}" height="${ih}"/>`)
    .join("");

  return `<div class="chartwrap" data-chart="${id}">
  <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Time series; the table at the end of the page lists every value.">
    <defs><linearGradient id="g-${id}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0.01"/>
    </linearGradient></defs>
    ${grid}
    <path d="${area}" fill="url(#g-${id})"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <line class="cross" x1="0" x2="0" y1="${T}" y2="${T + ih}" style="display:none"/>
    <circle class="dot" r="4" fill="${color}" style="display:none"/>
    ${xlab}
    ${hit}
  </svg>
  <div class="tip" hidden></div>
</div>`;
}

/** Bars, always direct-labelled — the number is never carried by colour alone. */
function barList(rows: { name: string; value: number; note?: string; color: string }[], fmt: (n: number) => string) {
  if (!rows.length) return `<div class="empty">nothing here yet</div>`;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return `<div class="scroll"><div class="bars">${rows
    .map(
      (r) => `<div class="bar">
      <span class="bname" title="${esc(r.name)}">${esc(r.name)}</span>
      <span class="btrack">${blockBar(r.value, max, r.color)}</span>
      <span class="bval">${esc(fmt(r.value))}</span>
      <span class="bnote">${r.note ? esc(r.note) : ""}</span>
    </div>`,
    )
    .join("")}</div></div>`;
}

// ---------------------------------------------------------------- page

/**
 * The site is plain text on purpose, so the one HTML surface it has reads like
 * a rendered markdown document in a terminal: the syntax stays visible and
 * unselectable, links are bracketed, and nothing is a card.
 */
const STYLE = `
:root{
  --bg:#0b0e14;
  --fg:#e5e5e5; --bright:#f5f5f5; --muted:#a3a3a3; --dim:#737373;
  --syntax:#525252; --line:#404040; --rule:#262626;
  --blue:#58a6ff; --blue-bg:#1f6feb; --blue-fg:#bfdbfe;
  --amber:#d29922; --green:#3fb950; --red:#f85149;
}
*{box-sizing:border-box}
html{color-scheme:dark}
body{margin:0;background:var(--bg);color:var(--fg);
  font:14px/1.625 ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
  -webkit-font-smoothing:antialiased}
.page{padding:64px 16px}
.doc{max-width:896px;margin:0 auto}
.doc>*+*{margin-top:24px}
section>*+*{margin-top:8px}
h1{font-size:20px;font-weight:700;color:var(--bright);margin:0;letter-spacing:-.01em}
h2{font-size:14px;font-weight:600;color:var(--fg);margin:0}
p{margin:0}
/* Markdown syntax: visible, muted, never part of a copy. */
.syn{user-select:none;color:var(--syntax)}
.quote{border-left:2px solid var(--rule);padding-left:12px;color:var(--muted)}
.row{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center}
/* The bracketed control. Hover and focus fill, exactly like a selected line. */
.b{display:inline-flex;align-items:center;gap:6px;padding:0 6px;color:var(--blue);
  text-decoration:none;background:none;border:0;font:inherit;cursor:pointer;
  outline:none;transition:background-color .1s,color .1s;white-space:nowrap}
.b:hover,.b:focus-visible{background:var(--blue-bg);color:#fff}
.b .br{user-select:none;color:var(--syntax);transition:color .1s}
.b:hover .br,.b:focus-visible .br{color:var(--blue-fg)}
.b.dim{color:var(--muted)}
.b.on{background:var(--blue-bg);color:#fff}
.b.on .br{color:var(--blue-fg)}
.b svg{width:15px;height:15px;flex:none}
.note{border-left:2px solid var(--amber);padding-left:12px;color:var(--muted)}
.note b{color:var(--fg);font-weight:600}
/* key/value block: the digest's aligned columns, on screen */
.kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:0 32px;margin:0}
.kv .k{display:flex;justify-content:space-between;gap:16px;padding:1px 0}
.kv dt{color:var(--dim)}
.kv dd{margin:0;color:var(--bright);font-variant-numeric:tabular-nums}
.kv .sub{color:var(--dim)}
/* block-character bars */
.bars{display:grid;grid-template-columns:auto auto minmax(0,9ch) 1fr;gap:2px 12px;align-items:baseline;min-width:max-content}
/* Rows share the grid so every bar starts on the same column. */
.bar{display:contents}
.bname{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:40ch}
.btrack{letter-spacing:-.5px;white-space:nowrap}
.track{color:var(--rule)}
.bval{color:var(--bright);font-variant-numeric:tabular-nums;text-align:right}
.bnote{color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* charts */
.chartwrap{position:relative}
.chartwrap svg{width:100%;height:180px;display:block;overflow:visible}
.gridline{stroke:var(--rule);stroke-width:1}
.ylab,.xlab{fill:var(--dim);font-size:11px;font-family:inherit}
.ylab{text-anchor:end}
.cross{stroke:var(--line);stroke-width:1;stroke-dasharray:2 3}
.dot{stroke:var(--bg);stroke-width:2}
.hit{fill:transparent}
.tip{position:absolute;pointer-events:none;background:#161b22;border:1px solid var(--line);
  color:var(--fg);font-size:12px;padding:4px 8px;white-space:nowrap;
  transform:translate(-50%,-145%);z-index:5;font-variant-numeric:tabular-nums}
/* tables */
.scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th,td{text-align:right;padding:2px 10px 2px 0;white-space:nowrap}
th:first-child,td:first-child{text-align:left}
th{color:var(--dim);font-weight:500;border-bottom:1px solid var(--rule)}
td{color:var(--fg)}
td.lab{max-width:38ch;overflow:hidden;text-overflow:ellipsis;color:var(--muted)}
details>summary{cursor:pointer;color:var(--muted);list-style:none;user-select:none;padding:2px 0}
details>summary::-webkit-details-marker{display:none}
details>summary:hover{color:var(--fg)}
details>summary::before{content:"▸ ";color:var(--syntax)}
details[open]>summary::before{content:"▾ ";color:var(--syntax)}
.empty{color:var(--dim)}
@media (max-width:640px){
  .page{padding:40px 12px}
  .bname{max-width:20ch}
  .doc{font-size:13px}
}
/* login */
.login{min-height:100dvh;display:grid;place-items:center;padding:24px}
.loginbox{width:100%;max-width:420px}
.loginbox>*+*{margin-top:16px}
input[type=password]{width:100%;padding:6px 8px;background:#11161f;color:var(--fg);
  border:1px solid var(--line);font:inherit;outline:none}
input[type=password]:focus{border-color:var(--blue)}
.err{color:var(--red)}
`;

function shell(title: string, body: string, extra = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#0b0e14">
<title>${esc(title)}</title><style>${STYLE}</style></head>
<body>${body}${extra}</body></html>`;
}

const COPY_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;

/** A bracketed control, the one interactive idiom on the page. */
const btn = (label: string, opts: { href?: string; cls?: string; icon?: string; attrs?: string } = {}) => {
  const inner = `<span class="br">[</span>${opts.icon ?? ""}<span class="lbl">${esc(label)}</span><span class="br">]</span>`;
  const cls = `b${opts.cls ? ` ${opts.cls}` : ""}`;
  return opts.href
    ? `<a class="${cls}" href="${opts.href}"${opts.attrs ?? ""}>${inner}</a>`
    : `<button type="button" class="${cls}"${opts.attrs ?? ""}>${inner}</button>`;
};

function loginPage(error?: string) {
  return shell(
    "admin · classifier.dev",
    `<div class="login"><form class="loginbox" method="POST" action="/admin">
      <h1><span class="syn"># </span>classifier.dev admin</h1>
      <p class="quote">operator dashboard, password required</p>
      <div>
        <p><span class="syn">## </span>password</p>
        <input id="p" name="password" type="password" autocomplete="current-password" autofocus required>
      </div>
      <p><button type="submit" class="b"><span class="br">[</span>sign in<span class="br">]</span></button></p>
      ${error ? `<p class="err">${esc(error)}</p>` : ""}
    </form></div>`,
  );
}

/** What each reason code means, in the words the caller would use. */
const REASON_TEXT: Record<string, string> = {
  bad_json: "body was not valid JSON",
  no_input: "no text to classify",
  too_many_inputs: "over 1,000 inputs",
  too_few_labels: "fewer than 2 labels",
  too_many_labels: "over 100 labels",
  empty_label: "a label was empty or not a string",
  duplicate_labels: "labels were not distinct",
  empty_input: "an input was empty or not a string",
  input_too_long: "an input was over 32,000 characters",
  rate_limit_minute: "per-minute rate limit",
  rate_limit_day: "daily rate limit",
  chain_exhausted: "every model in the chain failed",
  batch_unavailable: "batch too large for the LLM fallback",
  timeout: "upstream timed out",
  upstream_other: "other upstream failure",
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
    return range === "24h" ? `${dt.toISOString().slice(11, 16)}Z` : dt.toISOString().slice(5, 10);
  };

  const pts = d.series.map((r) => ({ t: fmtT(r.t), reqs: num(r.requests), cls: num(r.classifications), usd: num(r.usd) }));

  const kv = (rows: [string, string, string?][]) =>
    `<dl class="kv">${rows
      .map(
        ([k, v, sub]) =>
          `<div class="k"><dt>${esc(k)}</dt><dd>${esc(v)}${sub ? ` <span class="sub">${esc(sub)}</span>` : ""}</dd></div>`,
      )
      .join("")}</dl>`;

  const h2 = (s: string) => `<h2><span class="syn">## </span>${esc(s)}</h2>`;
  const tierColor: Record<string, string> = { fast: "var(--blue)", smart: "var(--amber)" };
  const statusColor = (s: string) => (s === "200" ? "var(--green)" : s.startsWith("4") ? "var(--amber)" : "var(--red)");

  const tabs = (["24h", "7d", "30d"] as RangeKey[])
    .map((k) => btn(k, { href: `/admin?range=${k}`, cls: k === range ? "on" : "" }))
    .join("");

  // Failure causes, summed across the client/status split the table keeps.
  const reasonTotals = new Map<string, { requests: number; status: string }>();
  for (const r of d.byReason) {
    const k = String(r.reason);
    const cur = reasonTotals.get(k) ?? { requests: 0, status: String(r.status ?? "") };
    cur.requests += num(r.requests);
    reasonTotals.set(k, cur);
  }
  const reasonRows = [...reasonTotals.entries()].sort((a, b) => b[1].requests - a[1].requests);

  // The same numbers as plain text, for the copy control.
  const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
  const report = [
    `classifier.dev — ${RANGES[range].label} — ${new Date().toISOString().slice(0, 16).replace("T", " ")}Z`,
    "",
    `  requests          ${group(requests)}`,
    `  classifications   ${group(classifications)}`,
    `  upstream spend    ${usd(spend)}`,
    `  cost / 1k         ${usd(per1k)}`,
    `  avg latency       ${ms(avgMs)}`,
    `  error rate        ${errRate.toFixed(1)}%  (${group(failed)} of ${group(requests)})`,
    `  unique IPs        ${group(d.visitors)}`,
    `  label sets        ${group(d.labelSets)}`,
    "",
    ...(reasonRows.length
      ? ["WHY REQUESTS FAIL", ...reasonRows.map(([r, v]) => `  ${pad(reasonText(r), 38)} ${group(v.requests)}`), ""]
      : []),
    ...(d.byModel.length
      ? ["BY MODEL", ...d.byModel.map((r) => `  ${pad(String(r.model ?? "?"), 38)} ${group(num(r.requests))}  ${usd(num(r.usd))}`)]
      : []),
  ].join("\n");

  const section = (title: string, body: string) => `<section>${h2(title)}${body}</section>`;

  return shell(
    "admin · classifier.dev",
    `<div class="page"><article class="doc">
  <h1><span class="syn"># </span>classifier.dev admin</h1>
  <p class="quote">${esc(RANGES[range].label)}, generated ${esc(new Date().toISOString().slice(0, 16).replace("T", " "))}Z</p>

  <p class="row">${tabs}${btn("copy report", {
      cls: "dim",
      icon: COPY_ICON,
      attrs: ' id="copy" aria-label="Copy these figures to your clipboard"',
    })}${btn("sign out", { href: "/admin?logout=1", cls: "dim" })}</p>

  ${d.errors.length ? `<p class="note"><b>some panels are empty.</b> analytics engine returned: ${esc(d.errors.join(" · ").slice(0, 300))}</p>` : ""}
  ${
    spend === 0 && requests > 0
      ? `<p class="note">spend reads <b>$0</b>, and failures have no recorded cause, for traffic served before this instrumentation shipped — both are real only after that deploy.</p>`
      : ""
  }

  ${section(
    "Totals",
    kv([
      ["requests", group(requests)],
      ["classifications", group(classifications), requests ? `${(classifications / requests).toFixed(1)}/req` : ""],
      ["upstream spend", usd(spend), "provider-reported"],
      ["cost / 1k", usd(per1k)],
      ["avg latency", ms(avgMs)],
      ["error rate", `${errRate.toFixed(1)}%`, `${group(failed)} of ${group(requests)}`],
      ["unique IPs", group(d.visitors)],
      ["label sets", group(d.labelSets)],
    ]),
  )}

  ${section("Requests over time", areaChart("req", pts.map((p) => ({ t: p.t, v: p.reqs })), "var(--blue)", group))}
  ${section("Upstream spend over time", areaChart("usd", pts.map((p) => ({ t: p.t, v: p.usd })), "var(--amber)", usd))}

  ${section(
    "Why requests fail",
    (reasonRows.length
      ? barList(
          reasonRows.map(([reason, v]) => ({
            name: reasonText(reason),
            value: v.requests,
            color: v.status.startsWith("5") ? "var(--red)" : "var(--amber)",
          })),
          group,
        )
      : `<div class="empty">no failures recorded in this range</div>`) +
      `<details><summary>by client and status</summary><div class="scroll"><table>
      <thead><tr><th>cause</th><th>client</th><th>status</th><th>requests</th><th>avg inputs</th></tr></thead><tbody>
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
          : `<tr><td colspan="5" class="empty">nothing yet</td></tr>`
      }
      </tbody></table></div></details>`,
  )}

  ${section(
    "By tier",
    barList(
      d.byTier.map((r) => ({
        name: String(r.tier || "?"),
        value: num(r.requests),
        note: `${usd(num(r.usd))} · ${ms(num(r.avg_ms))}`,
        color: tierColor[String(r.tier)] ?? "var(--blue)",
      })),
      group,
    ),
  )}

  ${section(
    "By model",
    barList(
      d.byModel.map((r) => ({
        name: String(r.model || "?"),
        value: num(r.requests),
        note: usd(num(r.usd)),
        color: "var(--blue)",
      })),
      group,
    ),
  )}

  ${section(
    "By status",
    barList(
      d.byStatus.map((r) => ({ name: String(r.status || "?"), value: num(r.requests), color: statusColor(String(r.status)) })),
      group,
    ),
  )}

  ${section(
    "By client",
    barList(
      d.byAgent.map((r) => ({
        name: String(r.agent || "?"),
        value: num(r.requests),
        note: `${group(num(r.classifications))} cls`,
        color: "var(--blue)",
      })),
      group,
    ),
  )}

  ${section(
    "By country",
    barList(
      d.byCountry.map((r) => ({ name: String(r.country || "??"), value: num(r.requests), color: "var(--green)" })),
      group,
    ),
  )}

  ${section(
    "Label sets that fail",
    `<div class="scroll"><table><thead><tr><th>labels</th><th>cause</th><th>requests</th></tr></thead><tbody>
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
        : `<tr><td colspan="3" class="empty">nothing yet</td></tr>`
    }
    </tbody></table></div>`,
  )}

  ${section(
    "Public vs enterprise",
    `<div class="scroll"><table><thead><tr><th>client</th><th>requests</th><th>classifications</th><th>spend</th></tr></thead><tbody>
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
        : `<tr><td colspan="4" class="empty">nothing yet</td></tr>`
    }
    </tbody></table></div>`,
  )}

  ${section(
    "Top label sets",
    `<div class="scroll"><table><thead><tr><th>labels</th><th>requests</th><th>classifications</th><th>spend</th></tr></thead><tbody>
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
        : `<tr><td colspan="4" class="empty">nothing yet</td></tr>`
    }
    </tbody></table></div>`,
  )}

  ${section(
    "The numbers behind the charts",
    `<details><summary>every bucket (${pts.length})</summary><div class="scroll"><table>
    <thead><tr><th>bucket</th><th>requests</th><th>classifications</th><th>spend</th></tr></thead><tbody>
    ${pts
      .map((p) => `<tr><td>${esc(p.t)}</td><td>${group(p.reqs)}</td><td>${group(p.cls)}</td><td>${esc(usd(p.usd))}</td></tr>`)
      .join("")}
    </tbody></table></div></details>`,
  )}
</article></div>`,
    `<script>
const DATA = ${JSON.stringify({
      req: pts.map((p) => [p.t, `${group(p.reqs)} requests`]),
      usd: pts.map((p) => [p.t, `${usd(p.usd)} spend`]),
    }).replace(/</g, "\\u003c")};
const REPORT = ${JSON.stringify(report).replace(/</g, "\\u003c")};
const copy = document.getElementById("copy");
if (copy) copy.addEventListener("click", async () => {
  const label = copy.querySelector(".lbl");
  try { await navigator.clipboard.writeText(REPORT); label.textContent = "copied"; }
  catch { label.textContent = "press ctrl+c"; }
  setTimeout(() => { label.textContent = "copy report"; }, 1600);
});
for (const wrap of document.querySelectorAll(".chartwrap")) {
  const key = wrap.dataset.chart, svg = wrap.querySelector("svg");
  if (!svg || !DATA[key]) continue;
  const cross = svg.querySelector(".cross"), dot = svg.querySelector(".dot"), tip = wrap.querySelector(".tip");
  const line = svg.querySelector("path[stroke]"), hits = svg.querySelectorAll(".hit");
  const show = (i, rect) => {
    const row = DATA[key][i], h = hits[i];
    if (!row || !h) return;
    const cx = +h.getAttribute("x") + +h.getAttribute("width") / 2;
    // Walk the path to the x we want; cheap enough at these point counts.
    let lo = 0, hi = line.getTotalLength(), pt = line.getPointAtLength(0);
    for (let k = 0; k < 18; k++) { const mid = (lo + hi) / 2; pt = line.getPointAtLength(mid);
      if (pt.x < cx) lo = mid; else hi = mid; }
    cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.style.display = "";
    dot.setAttribute("cx", pt.x); dot.setAttribute("cy", pt.y); dot.style.display = "";
    tip.hidden = false; tip.textContent = row[0] + "  " + row[1];
    tip.style.left = (pt.x / 760 * rect.width) + "px";
    tip.style.top = (pt.y / 190 * rect.height) + "px";
  };
  svg.addEventListener("mousemove", (e) => {
    const rect = svg.getBoundingClientRect();
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
