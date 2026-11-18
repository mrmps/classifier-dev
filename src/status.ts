import type { Env } from "./index";
import { sql } from "./report";
import { FOOT, HOME_CSS, META, NAV } from "./home";
import { esc, page } from "./ui";

export type ServiceStatus = "operational" | "degraded" | "outage" | "unknown";
type Row = Record<string, unknown>;
type Component = {
  id: string;
  name: string;
  status: ServiceStatus;
  requests: number;
  successful: number;
  failed: number;
  rejected: number;
  avg_ms: number | null;
  last_request_at: string | null;
};
type PublicComponent = Omit<
  Component,
  "requests" | "successful" | "failed" | "rejected"
> & {
  requests: number | null;
  successful: number | null;
  failed: number | null;
  rejected: number | null;
};
export type StatusSnapshot = {
  status: ServiceStatus;
  generated_at: string;
  window_minutes: number;
  source: "request_analytics";
  estimates: true;
  unavailable: string[];
  components: PublicComponent[];
  history: {
    at: string;
    status: ServiceStatus;
    requests: number;
    failed: number;
    escalation_failed: number;
    counts_partial: boolean;
  }[];
};
const WINDOW = 15;
const n = (value: unknown) => {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim()))
    throw new Error("Missing status aggregate");
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0)
    throw new Error("Invalid status aggregate");
  return number;
};
const date = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed =
    typeof value === "number"
      ? new Date(value * 1000)
      : new Date(String(value).replace(" ", "T").replace(/Z?$/, "Z"));
  if (!Number.isFinite(parsed.getTime()))
    throw new Error("Invalid status timestamp");
  return parsed.toISOString();
};
const health = (ok: number, failed: number): ServiceStatus =>
  failed ? (ok ? "degraded" : "outage") : ok ? "operational" : "unknown";
const combine = (states: ServiceStatus[]): ServiceStatus =>
  states.some((s) => s === "degraded" || s === "outage")
    ? "degraded"
    : states.includes("operational")
      ? "operational"
      : "unknown";

function bounds(cutoff: Date, minutes: number) {
  const stamp = (ms: number) =>
    new Date(ms).toISOString().slice(0, 19).replace("T", " ");
  return `timestamp > toDateTime('${stamp(cutoff.getTime() - minutes * 60_000)}') AND timestamp <= toDateTime('${stamp(cutoff.getTime())}')`;
}
function requestQuery(cutoff: Date, minutes: number, history: boolean) {
  return `SELECT ${history ? "toStartOfInterval(timestamp, INTERVAL '15' MINUTE) AS bucket," : ""}
    blob4 AS status, blob7 AS reason, double5 AS failed_per_request, double15 AS escalated_per_request, sum(_sample_interval) AS requests,
    sum(double2 * _sample_interval) AS ms_sum,
    sum(double5 * _sample_interval) AS escalation_failed,
    sum(double15 * _sample_interval) AS escalated, max(timestamp) AS latest
    FROM classifier_events WHERE ${bounds(cutoff, minutes)}
    GROUP BY ${history ? "bucket, " : ""}status, reason, failed_per_request, escalated_per_request`;
}
function chatQuery(cutoff: Date, minutes: number, history: boolean) {
  return `SELECT ${history ? "toStartOfInterval(timestamp, INTERVAL '15' MINUTE) AS bucket," : ""}
    blob2 AS outcome, sum(_sample_interval) AS requests,
    sum(double2 * _sample_interval) AS ms_sum, max(timestamp) AS latest
    FROM classifier_chat_events WHERE ${bounds(cutoff, minutes)}
    GROUP BY ${history ? "bucket, " : ""}outcome`;
}
function component(
  id: string,
  name: string,
  rows: Row[],
  chat = false,
): Component {
  let successful = 0,
    failed = 0,
    rejected = 0,
    ms = 0,
    latest: string | null = null;
  for (const row of rows) {
    const count = n(row.requests);
    const ok = chat ? row.outcome === "completed" : row.status === "200";
    const error = chat
      ? row.outcome === "failed" || row.outcome === "unavailable"
      : /^5\d\d$/.test(String(row.status)) ||
        (row.status === "429" &&
          [
            "chunklaya_busy",
            "typesafe_429",
            "imajev_429",
            "jevomni_429",
          ].includes(String(row.reason)));
    if (ok) successful += count;
    else if (error) failed += count;
    else rejected += count;
    if (ok || error) {
      ms += n(row.ms_sum);
      const at = date(row.latest);
      if (at && (!latest || at > latest)) latest = at;
    }
  }
  return {
    id,
    name,
    status: health(successful, failed),
    requests: successful + failed + rejected,
    successful,
    failed,
    rejected,
    avg_ms: successful + failed ? ms / (successful + failed) : null,
    last_request_at: latest,
  };
}
function escalation(rows: Row[]): Component {
  let successful = 0,
    failed = 0,
    latest: string | null = null;
  for (const row of rows) {
    const ok = n(row.escalated),
      errors = n(row.escalation_failed);
    successful += ok;
    failed += errors;
    const at = date(row.latest);
    if (ok + errors > 0 && at && (!latest || at > latest)) latest = at;
  }
  return {
    id: "escalation",
    name: "Smart escalation",
    status: failed ? "degraded" : health(successful, 0),
    requests: successful + failed,
    successful,
    failed,
    rejected: 0,
    avg_ms: null,
    last_request_at: latest,
  };
}

export async function readStatus(env: Env): Promise<StatusSnapshot> {
  const generated = new Date();
  const queries = [
    {
      name: "classification",
      query: requestQuery(generated, WINDOW, false),
      chat: false,
      history: false,
    },
    {
      name: "chat",
      query: chatQuery(generated, WINDOW, false),
      chat: true,
      history: false,
    },
    {
      name: "classification_history",
      query: requestQuery(generated, 1440, true),
      chat: false,
      history: true,
    },
    {
      name: "chat_history",
      query: chatQuery(generated, 1440, true),
      chat: true,
      history: true,
    },
  ];
  const unavailable: string[] = [];
  const rows = await Promise.all(
    queries.map(async ({ name, query, chat, history }) => {
      try {
        const result = await sql(env, query, AbortSignal.timeout(8000));
        // Validate before exposing totals; a malformed source is unknown, never green.
        component("api", "", result, chat);
        if (!chat) escalation(result);
        for (const row of result)
          if (history && !date(row.bucket)) throw new Error("Missing bucket");
        return result;
      } catch {
        unavailable.push(name);
        return [];
      }
    }),
  );
  const [requests, chat, requestHistory, chatHistory] = rows as [
    Row[],
    Row[],
    Row[],
    Row[],
  ];
  const components = [
    component("api", "Classification API", requests),
    escalation(requests),
    component("chat", "Chat assistant", chat, true),
  ];
  const interval = 900_000;
  const lastBucket = Math.floor(generated.getTime() / interval) * interval;
  const firstBucket =
    Math.floor((generated.getTime() - 86_400_000) / interval) * interval;
  const history = Array.from(
    { length: (lastBucket - firstBucket) / interval + 1 },
    (_, i) => {
      const at = new Date(firstBucket + i * interval).toISOString();
      const r = requestHistory.filter((row) => date(row.bucket) === at),
        c = chatHistory.filter((row) => date(row.bucket) === at);
      const api = component("api", "", r),
        assistant = component("chat", "", c, true),
        smart = escalation(r);
      return {
        at,
        status:
          api.status === "outage"
            ? "outage"
            : api.failed + assistant.failed + smart.failed > 0
              ? "degraded"
              : unavailable.includes("classification_history") ||
                  unavailable.includes("chat_history")
                ? "unknown"
                : combine([api.status, assistant.status, smart.status]),
        requests: api.requests + assistant.requests,
        failed: api.failed + assistant.failed,
        escalation_failed: smart.failed,
        counts_partial:
          unavailable.includes("classification_history") ||
          unavailable.includes("chat_history"),
      };
    },
  );
  const observedStatus =
    components[0]!.status === "outage"
      ? "outage"
      : combine(components.map((c) => c.status));
  const status =
    observedStatus === "degraded" || observedStatus === "outage"
      ? observedStatus
      : unavailable.includes("classification") || unavailable.includes("chat")
        ? "unknown"
        : observedStatus;
  return {
    status,
    generated_at: generated.toISOString(),
    window_minutes: WINDOW,
    source: "request_analytics",
    estimates: true,
    unavailable: unavailable.sort(),
    components: components.map((c) =>
      unavailable.includes(c.id === "chat" ? "chat" : "classification")
        ? {
            ...c,
            requests: null,
            successful: null,
            failed: null,
            rejected: null,
          }
        : c,
    ),
    history,
  };
}

export const STATUS_LABEL: Record<ServiceStatus, string> = {
  operational: "No issues observed",
  degraded: "Degraded service",
  outage: "Requests failing",
  unknown: "No recent evidence",
};
const count = (value: number | null) =>
  value === null ? "—" : Math.round(value).toLocaleString("en-US");
const time = (at: string) =>
  new Date(at).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hour12: false,
  }) + " UTC";
const rate = (c: PublicComponent) =>
  c.successful !== null && c.failed !== null && c.successful + c.failed
    ? `${((100 * c.successful) / (c.successful + c.failed)).toFixed(2)}%`
    : "—";

export function statusText(s: StatusSnapshot) {
  return (
    `# classifier.dev status\n\n${s.status === "unknown" && s.unavailable.length ? "Status unavailable" : STATUS_LABEL[s.status]}\nUpdated ${s.generated_at}. Last ${s.window_minutes} minutes of observed requests.\n\n` +
    s.components
      .map(
        (c) =>
          `## ${c.name}\n${c.requests === null ? "Status unavailable" : STATUS_LABEL[c.status]} · ${count(c.successful)} succeeded · ${count(c.failed)} failed · ${count(c.rejected)} rejected or stopped\n`,
      )
      .join("\n") +
    `\nCounts are sampling-adjusted estimates. Smart escalation counts decisions; a failed escalation can still return HTTP 200 with the first model's answer. No traffic means unknown.\n` +
    (s.unavailable.length
      ? `\nTelemetry unavailable: ${s.unavailable.join(", ")}.\n`
      : "")
  );
}
export function statusHtml(s: StatusSnapshot, signedIn = false) {
  const api = s.components[0]!;
  const statusUnavailable = s.status === "unknown" && s.unavailable.length > 0;
  const historyIncomplete =
    s.unavailable.includes("classification_history") ||
    s.unavailable.includes("chat_history");
  const historyUnavailable =
    s.unavailable.includes("classification_history") &&
    s.unavailable.includes("chat_history");
  const headline = statusUnavailable
    ? "Status unavailable"
    : STATUS_LABEL[s.status];
  const description =
    "Service status from actual classification and chat requests.";
  const rows = s.components
    .map(
      (
        c,
      ) => `<tr><th scope="row"><span class="component-name">${c.name}</span><span class="component-detail">${c.id === "escalation" ? "Reasoning decisions" : c.id === "chat" ? "Conversation outcomes" : "Recorded API outcomes"}</span></th>
    <td><span class="state ${c.status}"><i aria-hidden="true"></i>${c.requests === null ? "Status unavailable" : STATUS_LABEL[c.status]}</span><span class="component-detail">${c.requests === null ? "Request analytics unavailable" : c.last_request_at ? `Last observed ${time(c.last_request_at)}` : "No recorded attempts in the last 15 min"}</span></td>
    <td class="numeric">${rate(c)}<span class="component-detail">${c.requests === null ? "Counts unavailable" : `${count(c.successful)} succeeded · ${count(c.failed)} failed${c.rejected ? ` · ${count(c.rejected)} rejected` : ""}`}</span></td></tr>`,
    )
    .join("");
  const bars = s.history
    .map(
      (b) =>
        `<span class="history-bar ${b.status}" title="${esc(`${time(b.at)} · ${b.counts_partial ? "Partial counts · " : ""}${STATUS_LABEL[b.status]} · ${count(b.requests)} requests · ${count(b.failed)} service failures · ${count(b.escalation_failed)} failed escalations`)}"></span>`,
    )
    .join("");
  const affected = s.history.filter((b) => b.failed || b.escalation_failed);
  return page({
    title: "Status · classifier.dev",
    head: META("classifier.dev status", description, "/status"),
    script:
      '<script>setInterval(function(){if(!document.hidden&&!document.querySelector("details[open]"))location.reload()},60000)</script>',
    css: `${HOME_CSS}
.status{max-width:960px;--warning:#e8bf6a}.status>*+*{margin-top:44px}.status h1{font-size:30px;line-height:1.2;letter-spacing:-.03em}.status-intro p{margin-top:10px;color:var(--muted);max-width:64ch}
.status-summary{display:flex;align-items:flex-start;gap:16px;padding-block:12px}.status-summary>i{width:12px;height:12px;margin-top:12px;flex:none;border-radius:50%;background:var(--dim)}
.status-summary.operational>i{background:var(--good)}.status-summary.degraded>i{background:var(--warning)}.status-summary.outage>i{background:var(--bad)}.status-summary h2{font-size:26px;letter-spacing:-.03em;color:var(--bright)}.status-summary p{margin-top:6px;color:var(--muted)}
.status-meta{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:18px;color:var(--dim);font-size:12px}.status-meta a{color:var(--accent)}
.status-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}.status-metrics dt{color:var(--muted);font-size:12px;min-height:20px}.status-metrics dd{margin:7px 0 0;color:var(--bright);font-size:28px;letter-spacing:-.03em;font-variant-numeric:tabular-nums}.status-metrics small{font-size:12px;color:var(--dim)}
.status-table{width:100%;border-collapse:collapse}.status-table th,.status-table td{padding:22px 12px;vertical-align:top;text-align:start;border:0}.status-table th{padding-inline-start:0;width:32%;font-weight:500}.status-table td:last-child{padding-inline-end:0;text-align:end}.status-table tbody tr+tr{border-top:1px solid var(--rule)}
.component-name{color:var(--bright)}.component-detail{display:block;margin-top:5px;color:var(--dim);font-size:12px;font-weight:400}.state{display:inline-flex;align-items:center;gap:8px;white-space:nowrap}.state i{width:6px;height:6px;border-radius:50%;background:var(--dim)}.state.unknown{color:var(--muted)}.state.operational{color:var(--good)}.state.operational i{background:var(--good)}.state.degraded{color:var(--warning)}.state.degraded i{background:var(--warning)}.state.outage{color:var(--bad)}.state.outage i{background:var(--bad)}.numeric{font-variant-numeric:tabular-nums}
.history-heading{display:flex;justify-content:space-between;align-items:center;gap:16px}.history-heading h2{font-size:18px;color:var(--bright)}.history-heading span{font-size:12px;color:var(--dim)}.history-bars{display:flex;gap:3px;height:40px;margin-top:20px}.history-bar{flex:1;min-width:0;border-radius:2px;background:var(--line)}.history-bar.operational{background:var(--good)}.history-bar.degraded{background:var(--warning)}.history-bar.outage{background:var(--bad)}.history-labels{display:flex;justify-content:space-between;color:var(--dim);font-size:12px;margin-top:10px}.history-legend{display:flex;flex-wrap:wrap;gap:8px 24px;margin-top:18px;font-size:12px}.history-note{margin-top:16px;color:var(--muted);font-size:12px}.status details{margin-top:20px}.status summary{cursor:pointer;color:var(--accent)}.status details ul{padding-inline-start:20px;color:var(--muted);font-size:12px}.status-explanation{color:var(--muted);font-size:12px;max-width:85ch}.status-explanation p+p{margin-top:12px}.telemetry-note{color:var(--warning)}
@media(max-width:480px){.status-metrics dt{min-height:40px}}
@media(max-width:700px){.status>*+*{margin-top:32px}.status-table,.status-table tbody,.status-table tr,.status-table th,.status-table td{display:block;width:100%}.status-table tr{position:relative;padding:20px 0}.status-table th,.status-table td{padding:0}.status-table td{margin-top:12px}.status-table td:last-child{text-align:start}.status-table .numeric{font-size:12px;color:var(--dim)}.status-table .numeric .component-detail{display:inline;margin-inline-start:8px}.status-table .numeric .component-detail::before{content:"· ";margin-inline-end:4px}.history-bars{gap:1px}.status-metrics{gap:12px}.status-metrics dd{font-size:23px}.status-summary h2{font-size:22px}.status-summary{gap:12px}}
`,
    body: `${NAV("status", signedIn)}<div class="page"><main class="doc status" id="main">
<header class="status-intro"><h1>Service status</h1><p>How classifier.dev is handling real requests.</p></header>
<section aria-label="Current status"><div class="status-summary ${s.status}"><i aria-hidden="true"></i><div><h2>${headline}</h2><p>${statusUnavailable ? "Request analytics could not be read; health is unverified." : s.status === "outage" ? "Classification requests are failing." : s.status === "degraded" ? "Some requests or Smart escalations failed in the last 15 minutes." : s.status === "unknown" ? "There is not enough recent request data to report service health." : "Observed requests are succeeding. Quiet components remain unverified."}</p></div></div>
<div class="status-meta"><span>Updated <time datetime="${s.generated_at}">${time(s.generated_at)}</time></span><span>Last 15 minutes · refreshes every minute</span><a href="/status">Refresh status</a><a href="/v1/status">JSON</a></div>
${s.unavailable.length ? '<p class="telemetry-note history-note">Some request analytics are unavailable. Affected components and history are unverified.</p>' : ""}</section>
<dl class="status-metrics" aria-label="Classification API in the last 15 minutes"><div><dt>API requests</dt><dd>${count(api.requests)}</dd></div><div><dt>API success rate</dt><dd>${rate(api)}</dd></div><div><dt>Mean API response</dt><dd>${api.avg_ms === null ? "—" : count(api.avg_ms)}${api.avg_ms === null ? "" : "<small> ms</small>"}</dd></div></dl>
<section aria-label="Components"><table class="status-table"><caption class="sr">Components in the last 15 minutes. Success rates exclude rejected or stopped requests.</caption><tbody>${rows}</tbody></table></section>
<section aria-label="Request history"><div class="history-heading"><h2>Last 24 hours</h2><span>15-minute intervals</span></div>${
      historyUnavailable
        ? '<p class="history-note">History unavailable. Request analytics could not be read.</p>'
        : `<div class="history-bars" role="img" aria-label="${affected.length} intervals with observed failures; grey intervals have no conclusive request evidence.">${bars}</div><div class="history-labels"><span>${time(new Date(new Date(s.generated_at).getTime() - 86_400_000).toISOString())} yesterday</span><span>Now</span></div>
<div class="history-legend"><span class="state operational"><i aria-hidden="true"></i>No issues observed</span><span class="state degraded"><i aria-hidden="true"></i>Failures observed</span><span class="state outage"><i aria-hidden="true"></i>Requests failing</span><span class="state unknown"><i aria-hidden="true"></i>${historyIncomplete ? "Unverified" : "No evidence"}</span></div>${historyIncomplete ? '<p class="history-note">History is incomplete. Some request analytics could not be read.</p>' : ""}`
    }
${affected.length ? `<details><summary>View ${affected.length} ${affected.length === 1 ? "interval" : "intervals"} with failures</summary><ul>${affected.map((b) => `<li>${esc(b.at.replace("T", " ").replace(".000Z", " UTC"))}: ${count(b.failed)} service failures, ${count(b.escalation_failed)} failed escalations</li>`).join("")}</ul></details>` : ""}</section>
<section class="status-explanation" aria-label="How status is measured"><p>Based on recorded classification and chat outcomes, with sampling-adjusted estimates and up to a few minutes of reporting delay. No recent traffic means no evidence, never a health check passed.</p><p>A failed Smart escalation is degraded even when the API returns HTTP 200 with the first model’s answer. Escalation success counts begin with this status page’s release. API success rates exclude rejected requests${api.rejected === null ? "" : ` (${count(api.rejected)} recorded)`}, including validation, credit and quota limits. Chat excludes invalid, rate-limited and stopped turns.</p><p>This page measures request completion, not answer accuracy, login or billing. <a class="inline" href="/contact">Report a problem →</a></p></section>
${FOOT}</main></div>`,
  });
}
