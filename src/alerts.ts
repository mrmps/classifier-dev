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
import { jevAttemptsQuery } from "./jev-observability";
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
  /** Jev answers in the window before "none came through the gateway" means the gateway is refusing, not idle. */
  gatewayMinJev: 20,
};

/**
 * Is the Jev key still good?
 *
 * TypeSafe publishes no credits or balance endpoint — its API is /v1/systemone
 * and /v1/models, nothing else — so there is no number to watch. What there is
 * is a cheap authenticated call, and a key that has run out stops working. This
 * asks /v1/models every fifteen minutes and reports whatever TypeSafe says
 * back, rather than guessing which status means "out of credit".
 *
 * The value of probing rather than waiting for traffic: it fires at 3am on a
 * quiet host, before a single user meets the fallback chain.
 */
async function probeJev(env: Env): Promise<Alert | null> {
  if (!env.TYPESAFE_API_KEY) return null;
  let res: Response;
  try {
    res = await fetch("https://api.typesafe.ai/v1/models", {
      headers: { authorization: `Bearer ${env.TYPESAFE_API_KEY}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    return {
      id: "jev_unreachable",
      severity: "warning",
      title: "cannot reach TypeSafe",
      detail:
        `api.typesafe.ai did not answer: ${(e as Error).message}.\n\nIf this persists, every request is ` +
        `being served by the LLM fallback chain at much lower accuracy.`,
    };
  }
  if (res.ok) return null;

  // Report TypeSafe's own words: it is the only thing that actually knows
  // whether this is a dead key, an exhausted balance or a suspended account.
  let said = (await res.text().catch(() => "")).slice(0, 300);
  try {
    const j = JSON.parse(said) as { detail?: { error_type?: string; message?: string } };
    if (j.detail?.message) said = `${j.detail.error_type ?? "error"}: ${j.detail.message}`;
  } catch { /* not JSON, use the raw text */ }

  if (res.status === 429) {
    return {
      id: "jev_unreachable",
      severity: "warning",
      title: "TypeSafe is rate limiting us",
      detail: `/v1/models returned 429.\n\n${said}`,
    };
  }
  if (res.status === 401 || res.status === 402 || res.status === 403) {
    return {
      id: "jev_credentials",
      severity: "critical",
      title: `TypeSafe is refusing the key (${res.status})`,
      detail:
        `TypeSafe says:\n  ${said}\n\nA ${res.status} here means the key is out of credit, revoked, or ` +
        `wrong. Until it is fixed every classification is answered by the LLM fallback chain, which is ` +
        `markedly less accurate and costs more — and callers get an answer either way, so nothing else ` +
        `will tell you.\n\nCheck the balance and the key, then: npx wrangler secret put TYPESAFE_API_KEY`,
    };
  }
  return {
    id: "jev_unreachable",
    severity: "warning",
    title: `TypeSafe returned ${res.status}`,
    detail: `/v1/models is failing.\n\n${said}`,
  };
}

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
  const probed = await probeJev(env).catch(() => null);
  const pre: Alert[] = probed ? [probed] : [];

  let recent: Row[] = [];
  let baseline: Row[] = [];
  let note = "";
  try {
    recent = await sql(
      env,
      `SELECT blob6 AS model, blob4 AS status, blob7 AS reason, blob9 AS mode,
              count() AS requests, sum(double2 * 1) AS ms_sum, sum(double3) AS usd, sum(double5) AS escfail, sum(double9) AS fallback
       FROM ${DATASET} WHERE timestamp > toDateTime(now()) - INTERVAL '${WINDOW_MIN}' MINUTE
       GROUP BY model, status, reason, mode`,
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
        ...pre,
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

  const alerts: Alert[] = [...pre];
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

  // A new feature can be completely broken while aggregate traffic looks healthy.
  const dimensions = recent.filter((r) => r.mode === "dimensions");
  const dimensionErrors = dimensions.filter((r) => String(r.status).startsWith("5"));
  const dimensionFailures = dimensionErrors.reduce((n, r) => n + num(r.requests), 0);
  const dimensionRequests = dimensions.reduce((n, r) => n + num(r.requests), 0);
  const dimensionFallback = dimensions.reduce((n, r) => n + num(r.fallback), 0);
  if (dimensionFailures >= 3 && dimensionFailures / dimensionRequests > 0.1) {
    alerts.push({
      id: "dimensions_5xx", severity: "critical",
      title: "Multidimensional classification is failing",
      detail: `${dimensionFailures} of ${dimensionRequests} requests in the last ${WINDOW_MIN}m returned 5xx. ` +
        `Causes: ${dimensionErrors.map((r) => `${r.reason || "unknown"} (${num(r.requests)})`).join(", ")}. Check /admin and the Jev provider.`,
    });
  }
  if (dimensionFallback > 0) {
    alerts.push({
      id: "dimensions_fallback", severity: "warning",
      title: "Multidimensional classification is using the LLM fallback",
      detail: `${dimensionFallback} fields used the fallback in the last ${WINDOW_MIN}m. Check Jev availability; requests above 20 decisions cannot use this fallback.`,
    });
  }

  // With a gateway key set, every Jev answer should be coming through it for
  // free. When none does, the gateway is refusing or rate-limiting every
  // request and TypeSafe is quietly paid for all of it; the caller sees the
  // same answers, so nothing else reports it.
  const byGateway = answered
    .filter((r) => String(r.model).toLowerCase().includes("jev@vercel"))
    .reduce((a, r) => a + num(r.requests), 0);
  if (env.AI_GATEWAY_API_KEY && env.AI_GATEWAY_DISABLED !== "true" && byJev >= T.gatewayMinJev && byGateway === 0) {
    alerts.push({
      id: "gateway_refused",
      severity: "warning",
      title: "the AI Gateway is refusing every Jev request",
      detail:
        `AI_GATEWAY_API_KEY is set, but none of the ${byJev} Jev answers in the last ${WINDOW_MIN}m came ` +
        `through Vercel's AI Gateway (model jev@vercel); all of them went to TypeSafe directly, which is ` +
        `being paid for every one.\n\nThe gateway is refusing or rate-limiting each request. Check the ` +
        `Vercel AI Gateway dashboard for the team: the credit balance, whether a card is on file (the ` +
        `personal scope needs one), and the key itself. Answers are unaffected; only the bill is.`,
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

  if (env.JEV_AE) {
    try {
      const attempts = await sql(env, jevAttemptsQuery(WINDOW_MIN));
      for (const provider of ["gateway", "typesafe"]) {
        // Disabled gateway failures are historical, not an active incident.
        if (provider === "gateway" && env.AI_GATEWAY_DISABLED === "true") continue;
        const rows = attempts.filter((r) => r.provider === provider && r.outcome !== "skipped");
        const total = rows.reduce((n, r) => n + num(r.attempts), 0);
        const failures = rows.filter((r) => r.outcome === "failure");
        const failed = failures.reduce((n, r) => n + num(r.attempts), 0);
        if (failed >= 3 && failed / total > 0.05) alerts.push({
          id: `${provider}_attempt_failures`, severity: "warning",
          title: `${provider} is failing ${pct(failed / total)} of Jev attempts`,
          detail: `${failed} of ${total} attempts in the last ${WINDOW_MIN}m failed, including failures recovered by fallback or retry. ` +
            failures.map((r) => `${r.reason} (HTTP ${r.status}: ${num(r.attempts)})`).join(", "),
        });
      }
    } catch {
      alerts.push({ id: "jev_analytics", severity: "warning", title: "cannot read Jev attempt analytics", detail: "Provider failures may be hidden by successful fallback. Check the JEV_AE binding and Analytics Engine query access." });
    }
  }

  return { alerts, checked: true, note };
}

// ---------------------------------------------------------------- state

type State = { since: string; lastSent: string };

/**
 * Fire on the way in, once more every six hours while it lasts, and once on
 * the way out. Without this the same outage would send ninety-six emails a day.
 */
async function plan(env: Env, firing: Alert[]) {
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
    if (!prev) toSend.push({ alert: a, kind: "new" });
    else if (now - Date.parse(prev.lastSent) > RENOTIFY_HOURS * 3_600_000) toSend.push({ alert: a, kind: "still" });
  }

  const firingIds = new Set(firing.map((a) => a.id));
  const recovered: { id: string; since: string }[] = [];
  for (const [id, st] of open) if (!firingIds.has(id)) recovered.push({ id, since: st.since });

  return { toSend, recovered, open, now };
}

/**
 * Record what was said — and only ever after it was actually said. Writing
 * this before delivery meant a Resend failure marked the alert sent and then
 * lost it for six hours, which is the exact silence this module exists to
 * break.
 */
async function commit(
  env: Env,
  firing: Alert[],
  p: Awaited<ReturnType<typeof plan>>,
) {
  const stamp = new Date(p.now).toISOString();
  const sent = new Set(p.toSend.map((t) => t.alert.id));
  for (const a of firing) {
    const prev = p.open.get(a.id);
    const since = prev?.since ?? stamp;
    const lastSent = sent.has(a.id) ? stamp : prev?.lastSent ?? stamp;
    await env.STATS.put(`alert:${a.id}`, JSON.stringify({ since, lastSent } satisfies State));
  }
  for (const r of p.recovered) await env.STATS.delete(`alert:${r.id}`);
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
  const p = await plan(env, alerts);
  // An operator preview describes the current incident, even after its email
  // has been sent. Notification deduplication only governs delivery.
  if (opts.send === false && alerts.length) {
    const { subject, body } = compose(alerts.map((alert) => ({ alert, kind: p.open.has(alert.id) ? "still" : "new" })), p.recovered);
    return `SUBJECT: ${subject}\n\n${body}\n\n(preview only — not emailed)`;
  }

  if (!p.toSend.length && !p.recovered.length) {
    // Still record state, so a condition that started and is merely waiting out
    // its renotify window keeps its original `since`.
    if (opts.send !== false) await commit(env, alerts, p);
    return `no alerts${checked ? "" : " (analytics unavailable)"} — ${alerts.length} firing, nothing new to say`;
  }

  const { subject, body } = compose(p.toSend, p.recovered);
  // A preview neither sends nor records: it must not silence the real alert.
  if (opts.send === false) return `SUBJECT: ${subject}\n\n${body}\n\n(preview only — not emailed)`;

  await deliver(env, subject, body);
  await commit(env, alerts, p);
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
