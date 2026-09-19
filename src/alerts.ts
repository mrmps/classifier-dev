/**
 * Alerting: an email when something is actually wrong, and nothing otherwise.
 *
 * The digest runs three times a day, which is the right cadence for "how is it
 * going" and far too slow for "it is broken". This runs every fifteen minutes
 * and stays silent unless a condition fires.
 *
 * Two things keep it quiet enough to be worth reading. It only alerts on
 * conditions with an action attached — a 4xx flood is scanners probing for
 * /wp-admin and means nothing, so 4xx is ignored entirely and only 5xx counts.
 * And it is stateful: each condition emails once when it starts, once when it
 * clears, and a reminder every six hours in between, rather than every quarter
 * of an hour for as long as it lasts.
 */

import type { Env } from "./index";
import { sql } from "./report";

const DATASET = "classifier_events";
const WINDOW_MIN = 60;
const RENOTIFY_HOURS = 6;

/** Thresholds, gathered so they are easy to argue with. */
const T = {
  /** Below this share of successes answered by Jev, the primary is effectively down. */
  jevShare: 0.5,
  /** Ignore all of the below unless the window saw at least this many requests. */
  minRequests: 10,
  /** Server-side failures as a share of all requests. */
  serverErrorRate: 0.05,
  /** Mean latency over the window. */
  latencyMs: 3000,
  /** Spend in the window against the trailing daily average, and a floor so
   *  fractions of a cent cannot trip it. */
  costMultiple: 10,
  costFloorUsd: 1,
  /** Traffic stopping outright, when the day says it should not have. */
  quietBaselinePerHour: 20,
};

export type Alert = {
  id: string;
  severity: "critical" | "warning";
  title: string;
  detail: string;
};

type Row = Record<string, unknown>;
const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export async function evaluate(env: Env): Promise<{ alerts: Alert[]; checked: boolean; note: string }> {
  let recent: Row[] = [];
  let baseline: Row[] = [];
  let note = "";
  try {
    recent = await sql(
      env,
      `SELECT blob6 AS model, blob4 AS status, blob7 AS reason,
              count() AS requests, sum(double2 * 1) AS ms_sum, sum(double3) AS usd, sum(double5) AS escfail
       FROM ${DATASET} WHERE timestamp > toDateTime(now()) - INTERVAL '${WINDOW_MIN}' MINUTE
       GROUP BY model, status, reason`,
    );
    baseline = await sql(
      env,
      `SELECT count() AS requests, sum(double3) AS usd
       FROM ${DATASET} WHERE timestamp > toDateTime(now()) - INTERVAL '24' HOUR`,
    );
  } catch (e) {
    // A broken query is itself worth knowing about, but it cannot be diagnosed
    // from here, so it is reported rather than silently treated as healthy.
    return {
      alerts: [
        {
          id: "analytics",
          severity: "warning",
          title: "cannot read Analytics Engine",
          detail: `The alert check could not query the dataset, so nothing else in this run was evaluated.\n${(e as Error).message.slice(0, 300)}`,
        },
      ],
      checked: false,
      note: "analytics unavailable",
    };
  }

  const requests = recent.reduce((a, r) => a + num(r.requests), 0);
  const serverErrors = recent.filter((r) => String(r.status).startsWith("5")).reduce((a, r) => a + num(r.requests), 0);
  const msSum = recent.reduce((a, r) => a + num(r.ms_sum), 0);
  const spend = recent.reduce((a, r) => a + num(r.usd), 0);
  const escFail = recent.reduce((a, r) => a + num(r.escfail), 0);

  // "Answered" means a 200 that names the model that served it.
  const answered = recent.filter((r) => String(r.status) === "200" && String(r.model || ""));
  const answeredTotal = answered.reduce((a, r) => a + num(r.requests), 0);
  const byJev = answered
    .filter((r) => String(r.model).toLowerCase().includes("jev"))
    .reduce((a, r) => a + num(r.requests), 0);

  const dayRequests = num(baseline[0]?.requests);
  const daySpend = num(baseline[0]?.usd);
  const perHour = dayRequests / 24;

  const alerts: Alert[] = [];
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  // The failure this service has actually had: the primary vanishes upstream
  // and the fallback chain answers quietly at much worse accuracy.
  if (answeredTotal >= 5 && byJev / answeredTotal < T.jevShare) {
    const models = answered
      .filter((r) => !String(r.model).toLowerCase().includes("jev"))
      .map((r) => `${r.model} (${num(r.requests)})`)
      .join(", ");
    alerts.push({
      id: "fallback",
      severity: "critical",
      title: "Jev is not answering — serving from the fallback chain",
      detail:
        `Only ${byJev} of ${answeredTotal} answered requests in the last ${WINDOW_MIN}m came from Jev ` +
        `(${pct(byJev / answeredTotal)}).\nAnswering instead: ${models || "unknown"}.\n\n` +
        `Most likely TYPESAFE_API_KEY is rejected or api.typesafe.ai is failing. The fallback chain is ` +
        `far less accurate, so this is worth fixing now rather than at the next digest.`,
    });
  }

  if (requests >= T.minRequests && serverErrors / requests > T.serverErrorRate) {
    const reasons = recent
      .filter((r) => String(r.status).startsWith("5") && String(r.reason || ""))
      .map((r) => `${r.reason} (${num(r.requests)})`)
      .join(", ");
    alerts.push({
      id: "5xx",
      severity: "critical",
      title: `${pct(serverErrors / requests)} of requests are failing server-side`,
      detail:
        `${serverErrors} of ${requests} requests in the last ${WINDOW_MIN}m returned 5xx.\n` +
        `Causes: ${reasons || "not recorded"}.\n\n4xx is excluded — that is scanner noise, not a fault.`,
    });
  }

  // The smart tier degrades silently when the escalation model is unreachable:
  // callers get fast-tier answers under a smart-tier label.
  if (escFail > 0) {
    alerts.push({
      id: "escalation",
      severity: "warning",
      title: `${escFail} smart-tier escalations could not reach the reasoning model`,
      detail:
        `Smart-tier answers are falling back to the fast tier without escalation, which is the ` +
        `shape an exhausted OPENROUTER_API_KEY takes. Callers still get an answer, so nothing else ` +
        `reports this.\n\nCheck the OpenRouter account's usage and limits.`,
    });
  }

  if (requests >= T.minRequests && msSum / requests > T.latencyMs) {
    alerts.push({
      id: "latency",
      severity: "warning",
      title: `mean latency is ${Math.round(msSum / requests)}ms`,
      detail: `Over ${requests} requests in the last ${WINDOW_MIN}m, against a ${T.latencyMs}ms threshold.`,
    });
  }

  if (spend > T.costFloorUsd && daySpend > 0 && spend > (daySpend / 24) * T.costMultiple) {
    alerts.push({
      id: "cost",
      severity: "warning",
      title: `spend is ${(spend / (daySpend / 24)).toFixed(1)}x the usual hourly rate`,
      detail:
        `$${spend.toFixed(4)} in the last ${WINDOW_MIN}m against a trailing average of ` +
        `$${(daySpend / 24).toFixed(4)}/hour.\n\nEither real demand or someone leaning on the free tier.`,
    });
  }

  if (requests === 0 && perHour >= T.quietBaselinePerHour) {
    alerts.push({
      id: "quiet",
      severity: "critical",
      title: "no requests at all in the last hour",
      detail:
        `The trailing day averages ${perHour.toFixed(0)} requests/hour, so silence is unexpected. ` +
        `Check DNS, the route, and that the worker is deployed.`,
    });
  }

  return { alerts, checked: true, note };
}

// ---------------------------------------------------------------- state

type State = { since: string; lastSent: string };

/**
 * Fire on the way in, once more every six hours while it lasts, and once on
 * the way out. Without this the same outage would send ninety-six emails a day.
 */
async function reconcile(env: Env, firing: Alert[], persist: boolean) {
  const now = Date.now();
  const open = new Map<string, State>();
  try {
    const listed = await env.STATS.list({ prefix: "alert:" });
    for (const k of listed.keys) {
      const raw = await env.STATS.get(k.name);
      if (raw) open.set(k.name.slice("alert:".length), JSON.parse(raw) as State);
    }
  } catch {
    /* if state is unreadable, prefer sending to staying silent */
  }

  const toSend: { alert: Alert; kind: "new" | "still" }[] = [];
  for (const a of firing) {
    const prev = open.get(a.id);
    if (!prev) {
      toSend.push({ alert: a, kind: "new" });
    } else if (now - Date.parse(prev.lastSent) > RENOTIFY_HOURS * 3_600_000) {
      toSend.push({ alert: a, kind: "still" });
    }
    const sending = toSend.some((t) => t.alert.id === a.id);
    const stamp = new Date(now).toISOString();
    const since = prev?.since ?? stamp;
    const lastSent = sending ? stamp : prev?.lastSent ?? stamp;
    // A preview must not mark an alert as sent, or it would silence the real one.
    if (persist) await env.STATS.put(`alert:${a.id}`, JSON.stringify({ since, lastSent } satisfies State));
  }

  const firingIds = new Set(firing.map((a) => a.id));
  const recovered: { id: string; since: string }[] = [];
  for (const [id, st] of open) {
    if (!firingIds.has(id)) {
      recovered.push({ id, since: st.since });
      if (persist) await env.STATS.delete(`alert:${id}`);
    }
  }
  return { toSend, recovered };
}

// ---------------------------------------------------------------- run

function compose(toSend: { alert: Alert; kind: "new" | "still" }[], recovered: { id: string; since: string }[]) {
  const lines: string[] = [];
  const crit = toSend.filter((t) => t.alert.severity === "critical");

  let subject: string;
  if (toSend.length === 0) subject = `classifier.dev recovered: ${recovered.map((r) => r.id).join(", ")}`;
  else if (toSend.length === 1) subject = `classifier.dev ${crit.length ? "CRITICAL" : "warning"}: ${toSend[0].alert.title}`;
  else subject = `classifier.dev: ${toSend.length} alerts${crit.length ? ` (${crit.length} critical)` : ""}`;

  for (const { alert, kind } of toSend) {
    lines.push(`${alert.severity === "critical" ? "CRITICAL" : "WARNING"}  ${alert.title}`);
    if (kind === "still") lines.push("(still firing — reminder)");
    lines.push("");
    lines.push(alert.detail);
    lines.push("");
    lines.push("—".repeat(58));
    lines.push("");
  }
  for (const r of recovered) {
    lines.push(`RECOVERED  ${r.id}  (started ${r.since.slice(0, 16).replace("T", " ")}Z)`);
  }
  lines.push("");
  lines.push("https://classifier.dev/admin  ·  the dashboard this was read from");
  return { subject, body: lines.join("\n") };
}

/**
 * Evaluate, decide what is worth saying, and say it. Returns the text it would
 * have sent so the same path can be previewed without emailing.
 */
export async function runAlerts(env: Env, opts: { send?: boolean; demo?: boolean } = { send: true }) {
  // A demo goes through compose and Resend exactly as a real alert does, so
  // sending one proves the whole path rather than the parts before the email.
  if (opts.demo) {
    const sample: Alert = {
      id: "demo",
      severity: "critical",
      title: "this is a test alert, nothing is wrong",
      detail:
        "Sent deliberately to prove the alerting path works end to end.\n\nA real one looks like this: what " +
        "fired, the numbers behind it, and what to go and check. Alerts email once when a condition starts, " +
        "again every six hours while it lasts, and once when it clears.",
    };
    const { subject, body } = compose([{ alert: sample, kind: "new" }], []);
    if (opts.send === false) return `SUBJECT: ${subject}\n\n${body}\n\n(preview only — not emailed)`;
    await deliver(env, subject, body);
    return `sent test alert: ${subject}`;
  }

  const { alerts, checked } = await evaluate(env);
  const { toSend, recovered } = await reconcile(env, alerts, opts.send !== false);

  if (!toSend.length && !recovered.length) {
    return `no alerts${checked ? "" : " (analytics unavailable)"} — ${alerts.length} firing, nothing new to say`;
  }

  const { subject, body } = compose(toSend, recovered);
  if (opts.send === false) return `SUBJECT: ${subject}\n\n${body}\n\n(preview only — not emailed)`;
  await deliver(env, subject, body);
  return `sent: ${subject}`;
}

async function deliver(env: Env, subject: string, body: string) {
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
}
