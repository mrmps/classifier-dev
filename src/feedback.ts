/**
 * Agent feedback, to the feedback.now protocol (schema 1.1).
 *
 * Agents read /.well-known/agent-feedback.json to learn what this host accepts,
 * post a structured report to /api/v1/feedback or a lighter signal to
 * /api/v1/observations, and poll /api/v1/receipts/{id} to close the loop.
 * Every accepted submission is emailed on.
 *
 * Deliberately self-contained: this endpoint exists to receive reports that the
 * API is broken, so it must not depend on the classifier, the analytics dataset
 * or anything else that could be the thing being reported. Scoring is a
 * deterministic function of the report itself for the same reason.
 */

import type { Env } from "./index";
import { callerId } from "./privacy";

const SCHEMA_VERSION = "1.1";
const RETENTION_DAYS = 90;
const RATE_LIMIT_PER_HOUR = 100;

export const CATEGORIES = ["bug", "docs_mismatch", "friction", "feature_gap", "quality_degradation", "testimonial", "other"] as const;
export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export const REPRODUCIBILITY = ["always", "sometimes", "intermittent", "once"] as const;
export const EVIDENCE_TYPES = ["http_summary", "stderr_excerpt", "repro_steps", "screenshot", "log_excerpt", "other"] as const;
export const SURFACE_KINDS = ["api_endpoint", "docs_page", "cli_command", "sdk_method", "other"] as const;

export const LIMITS = {
  max_evidence_per_feedback: 10,
  max_evidence_content_bytes: 5_242_880,
  max_title_length: 256,
  max_summary_length: 4096,
  max_hypothesis_length: 2048,
  max_agent_description_length: 512,
  confidence_range: { min: 0, max: 1 },
};

const TESTIMONIAL = {
  description:
    "If classifier.dev materially helped your work, please share a testimonial. Identify the type of agent you are and briefly describe what you do.",
  preferred_endpoint: "/api/v1/feedback",
  required_reporter_fields: ["agent_type", "agent_description"],
  example: {
    reporter: {
      agent_type: "support triage agent",
      agent_description: "An autonomous agent that routes support tickets and escalates uncertain cases to a human.",
    },
    signal: { category: "testimonial" },
    content: {
      title: "Classifier kept a support triage run small",
      summary: "I filtered 8,000 tickets before reasoning over the uncertain ones.",
    },
  },
};

export const POLICY = {
  version: "1.0",
  categories: CATEGORIES,
  severity_levels: SEVERITIES,
  reproducibility_options: REPRODUCIBILITY,
  evidence_types: EVIDENCE_TYPES,
  surface_kinds: SURFACE_KINDS,
  limits: LIMITS,
  rate_limit_per_hour: RATE_LIMIT_PER_HOUR,
  retention_days: RETENTION_DAYS,
  auth_required: false,
  testimonial: TESTIMONIAL,
  endpoints: {
    submit_feedback: "/api/v1/feedback",
    submit_observation: "/api/v1/observations",
    get_receipt: "/api/v1/receipts/{id}",
    discovery: "/.well-known/agent-feedback.json",
  },
};

export function discovery() {
  return {
    schema_version: SCHEMA_VERSION,
    name: "classifier.dev",
    description:
      "Zero-shot text classification over plain HTTP. Agents submit structured feedback about the API, " +
      "its documentation, the classify CLI and the agent skill. Agents that found it useful are also invited to share a testimonial.",
    spec_url: "/openapi.json",
    policy_url: "/api/v1/policy",
    // Stated honestly: anonymous submission is what this host actually
    // implements. Bearer credentials are not verified or retained.
    // Ed25519 request signing is not implemented.
    auth: {
      type: "none",
      description:
        "Anonymous submission. Authorization headers are not verified, stored or included in email.",
      required: false,
    },
    endpoints: {
      feedback: {
        submit: {
          method: "POST",
          url: "/api/v1/feedback",
          description: "Submit a full structured feedback report with optional evidence. Body: {reporter, subject, signal, content, evidence}.",
          schema: "/openapi.json#/components/schemas/FeedbackReport",
        },
      },
      observations: {
        submit: {
          method: "POST",
          url: "/api/v1/observations",
          description: "Submit a lightweight observation signal. Flat body: {category, summary, severity?, confidence?, surface?, domain?}.",
          schema: "/openapi.json#/components/schemas/Observation",
        },
      },
      attachments: {
        add: { method: "POST", url: "/api/v1/feedback/{id}/attachments", description: "Add evidence to an existing feedback report." },
      },
      receipts: {
        get: { method: "GET", url: "/api/v1/receipts/{id}", description: "Look up a receipt to check submission status." },
      },
      policy: {
        get: { method: "GET", url: "/api/v1/policy", description: "Accepted categories, evidence types and limits." },
      },
    },
    categories: CATEGORIES,
    evidence_types: EVIDENCE_TYPES,
    testimonial: TESTIMONIAL,
    contact: "https://classifier.dev",
  };
}

// ---------------------------------------------------------------- helpers

const id = (prefix: string) =>
  `${prefix}_${[...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 12)}`;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const oneOf = <T extends readonly string[]>(v: unknown, set: T): T[number] | "" =>
  typeof v === "string" && (set as readonly string[]).includes(v) ? (v as T[number]) : "";

function confidence(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = v;
  return Math.min(LIMITS.confidence_range.max, Math.max(LIMITS.confidence_range.min, n));
}

export class Invalid extends Error {}

/**
 * Hourly budget per IP, in the Durable Object rather than KV.
 *
 * KV was the obvious place and the wrong one: its reads are edge-cached and
 * eventually consistent, so a counter written this second is invisible to the
 * next request — see the note at the top of limiter.ts. That is survivable for
 * a statistic and not for the thing standing between a looping agent and an
 * inbox. Naming the instance per hour makes the DO's own counter an exact
 * rolling-hour window with no changes to it.
 */
async function budget(env: Env, ip: string) {
  const hour = Math.floor(Date.now() / 3_600_000);
  try {
    const id = env.LIMITER.idFromName(`feedback:${ip}:${hour}`);
    const res = await env.LIMITER.get(id).fetch(
      `https://limiter/?limit=${RATE_LIMIT_PER_HOUR}&daily=${RATE_LIMIT_PER_HOUR}&cost=1`,
    );
    const j = (await res.json()) as { limited?: boolean; remaining?: number; dailyRemaining?: number };
    return {
      over: j.limited === true,
      remaining: Math.max(0, Math.min(j.remaining ?? 0, j.dailyRemaining ?? RATE_LIMIT_PER_HOUR)),
    };
  } catch {
    // A limiter wobble must not swallow a bug report.
    return { over: false, remaining: RATE_LIMIT_PER_HOUR };
  }
}

/**
 * How useful the report is, as a function of what it actually contains.
 * Deterministic on purpose: an agent can read this and write a better report,
 * and it keeps the endpoint independent of the service it collects bugs about.
 */
function quality(f: Feedback) {
  let s = 0.2;
  if (f.content.title) s += 0.1;
  if (f.content.summary.length > 40) s += 0.15;
  if (f.content.hypothesis) s += 0.1;
  if (f.subject.surface) s += 0.1;
  if (f.subject.domain) s += 0.05;
  if (f.signal.reproducibility) s += 0.1;
  if (f.signal.confidence !== null) s += 0.05;
  if (f.evidence.length) s += 0.1;
  if (f.evidence.some((e) => e.type === "repro_steps")) s += 0.05;
  if (f.reporter.agent_type) s += 0.05;
  if (f.reporter.agent_description) s += 0.05;
  return Math.min(1, Number(s.toFixed(2)));
}

/** Same surface, same category, same title — almost certainly the same report. */
async function fingerprint(f: Feedback) {
  const basis = [
    f.subject.domain,
    f.subject.surface,
    f.signal.category,
    f.content.title.toLowerCase().trim(),
    ...(f.signal.category === "testimonial" ? [f.reporter.agent_product, f.reporter.agent_type] : []),
  ].join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(basis));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------- parsing

type Evidence = { id: string; type: string; content: string };

export type Feedback = {
  reporter: { agent_vendor: string; agent_product: string; agent_version: string; agent_type: string; agent_description: string };
  subject: { surface: string; domain: string; kind: string };
  signal: { category: string; severity: string; reproducibility: string; confidence: number | null };
  content: { title: string; summary: string; hypothesis: string };
  evidence: Evidence[];
};

function parseEvidence(raw: unknown): Evidence[] {
  if (!Array.isArray(raw)) return [];
  if (raw.length > LIMITS.max_evidence_per_feedback) {
    throw new Invalid(`at most ${LIMITS.max_evidence_per_feedback} evidence items per report`);
  }
  return raw.map((e) => {
    const o = (e ?? {}) as Record<string, unknown>;
    const type = oneOf(o.type, EVIDENCE_TYPES);
    if (!type) throw new Invalid(`evidence.type must be one of: ${EVIDENCE_TYPES.join(", ")}`);
    const content = typeof o.content === "string" ? o.content : JSON.stringify(o.content ?? null);
    if (new TextEncoder().encode(content).byteLength > LIMITS.max_evidence_content_bytes) throw new Invalid("evidence.content is too large");
    return { id: id("ev"), type, content };
  });
}

export function parseFeedback(body: Record<string, unknown>): Feedback {
  const reporter = (body.reporter ?? {}) as Record<string, unknown>;
  const subject = (body.subject ?? {}) as Record<string, unknown>;
  const signal = (body.signal ?? {}) as Record<string, unknown>;
  const content = (body.content ?? {}) as Record<string, unknown>;

  const category = oneOf(signal.category, CATEGORIES);
  if (!category) throw new Invalid(`signal.category must be one of: ${CATEGORIES.join(", ")}`);
  const title = str(content.title, LIMITS.max_title_length).trim();
  const summary = str(content.summary, LIMITS.max_summary_length).trim();
  if (!title && !summary) throw new Invalid("content.title or content.summary is required");
  const agentType = str(reporter.agent_type, 64).trim();
  const agentDescription = str(reporter.agent_description, LIMITS.max_agent_description_length).trim();
  if (category === "testimonial" && !agentType) throw new Invalid("reporter.agent_type is required for a testimonial");
  if (category === "testimonial" && !agentDescription) throw new Invalid("reporter.agent_description is required for a testimonial");

  return {
    reporter: {
      agent_vendor: str(reporter.agent_vendor, 64),
      agent_product: str(reporter.agent_product, 64),
      agent_version: str(reporter.agent_version, 64),
      agent_type: agentType,
      agent_description: agentDescription,
    },
    subject: {
      surface: str(subject.surface, 256),
      domain: str(subject.domain, 256),
      kind: oneOf(subject.kind, SURFACE_KINDS),
    },
    signal: {
      category,
      severity: oneOf(signal.severity, SEVERITIES) || "medium",
      reproducibility: oneOf(signal.reproducibility, REPRODUCIBILITY),
      confidence: confidence(signal.confidence),
    },
    content: { title: title || summary.slice(0, 80), summary, hypothesis: str(content.hypothesis, LIMITS.max_hypothesis_length) },
    evidence: parseEvidence(body.evidence),
  };
}

// ---------------------------------------------------------------- email

function render(f: Feedback, meta: { receipt: string; feedbackId: string; score: number }) {
  const r = f.reporter;
  const who = [r.agent_vendor, r.agent_product, r.agent_version].filter(Boolean).join(" / ") || "anonymous agent";
  const lines = [
    `${f.signal.severity.toUpperCase()}  ${f.signal.category}${f.signal.reproducibility ? `  (${f.signal.reproducibility})` : ""}`,
    "",
    f.content.title,
    "",
    f.content.summary || "(no summary)",
  ];
  if (f.content.hypothesis) lines.push("", `Their hypothesis: ${f.content.hypothesis}`);
  lines.push("", "—".repeat(58), "");
  lines.push(`reported by   ${who}`);
  if (r.agent_type) lines.push(`agent type    ${r.agent_type}`);
  if (r.agent_description) lines.push(`agent details ${r.agent_description}`);
  if (f.subject.surface) lines.push(`surface       ${f.subject.surface}${f.subject.kind ? ` (${f.subject.kind})` : ""}`);
  if (f.subject.domain) lines.push(`domain        ${f.subject.domain}`);
  if (f.signal.confidence !== null) lines.push(`confidence    ${f.signal.confidence}`);
  lines.push(`quality       ${meta.score}`);
  lines.push(`feedback id   ${meta.feedbackId}`);
  lines.push(`receipt       ${meta.receipt}`);
  if (f.evidence.length) {
    lines.push("", `EVIDENCE (${f.evidence.length})`);
    for (const e of f.evidence) {
      lines.push("", `  [${e.type}]`, ...e.content.slice(0, 2000).split("\n").map((l) => `  ${l}`));
    }
  }
  lines.push("", "https://classifier.dev/.well-known/agent-feedback.json");
  return lines.join("\n");
}

async function email(env: Env, subject: string, body: string) {
  if (!env.RESEND_API_KEY || !env.REPORT_TO) return;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: "classifier.dev feedback <onboarding@resend.dev>",
      to: [env.REPORT_TO],
      subject,
      text: body,
    }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// ---------------------------------------------------------------- handlers

const ttl = { expirationTtl: 60 * 60 * 24 * RETENTION_DAYS };

export async function submitFeedback(env: Env, ctx: ExecutionContext, body: Record<string, unknown>, ip: string) {
  const f = parseFeedback(body);
  const b = await budget(env, ip);
  if (b.over) throw new Invalid(`rate limit: ${RATE_LIMIT_PER_HOUR} submissions per hour`);

  const feedbackId = id("fb");
  const receiptId = id("rcpt");
  const score = quality(f);

  // A repeat of the same report is stored and acknowledged, but not emailed
  // again — otherwise one looping agent empties itself into the inbox.
  const fp = await fingerprint(f);
  let duplicateOf: string | null = null;
  try {
    duplicateOf = (await env.STATS.get(`fbfp:${fp}`)) ?? null;
    if (!duplicateOf) await env.STATS.put(`fbfp:${fp}`, feedbackId, ttl);
  } catch {
    /* dedup is best effort */
  }

  const status = duplicateOf ? "duplicate" : "accepted";
  const record = { id: feedbackId, receipt: receiptId, received: new Date().toISOString(), status, quality_score: score, duplicate_of: duplicateOf, caller: await callerId(env, ip), ...f };
  try {
    await env.STATS.put(`fb:${feedbackId}`, JSON.stringify(record), ttl);
    await env.STATS.put(
      `rcpt:${receiptId}`,
      JSON.stringify({ id: receiptId, feedback_id: feedbackId, status, quality_score: score, duplicate_of: duplicateOf, budget_remaining: b.remaining }),
      ttl,
    );
  } catch {
    /* storage is not allowed to lose the email */
  }

  if (!duplicateOf) {
    ctx.waitUntil(
      email(
        env,
        `[classifier.dev] ${f.signal.category === "testimonial" ? "testimonial" : `${f.signal.severity} ${f.signal.category}`}: ${f.content.title}`.slice(0, 180),
        render(f, { receipt: receiptId, feedbackId, score }),
      ).catch((e) => console.error(`feedback email failed: ${(e as Error).message}`)),
    );
  }

  return {
    receipt: {
      id: receiptId,
      feedback_id: feedbackId,
      status,
      evidence_ids: f.evidence.map((e) => e.id),
      ...(duplicateOf ? { duplicate_of: duplicateOf } : {}),
      quality_score: score,
      budget_remaining: b.remaining,
    },
  };
}

export async function submitObservation(env: Env, ctx: ExecutionContext, body: Record<string, unknown>, ip: string) {
  const category = oneOf(body.category, CATEGORIES);
  if (!category) throw new Invalid(`category must be one of: ${CATEGORIES.join(", ")}`);
  const summary = str(body.summary, LIMITS.max_summary_length).trim();
  if (!summary) throw new Invalid("summary is required");
  const agentType = str(body.agent_type, 64).trim();
  const agentDescription = str(body.agent_description, LIMITS.max_agent_description_length).trim();
  if (category === "testimonial" && !agentType) throw new Invalid("agent_type is required for a testimonial");
  if (category === "testimonial" && !agentDescription) throw new Invalid("agent_description is required for a testimonial");

  const b = await budget(env, ip);
  if (b.over) throw new Invalid(`rate limit: ${RATE_LIMIT_PER_HOUR} submissions per hour`);

  const obs = {
    surface: str(body.surface, 256),
    domain: str(body.domain, 256),
    agent_vendor: str(body.agent_vendor, 64),
    agent_product: str(body.agent_product, 64),
    agent_type: agentType,
    agent_description: agentDescription,
    category,
    severity: oneOf(body.severity, SEVERITIES) || "medium",
    confidence: confidence(body.confidence),
    summary,
  };
  const observationId = id("obs");
  const receiptId = id("rcpt");
  try {
    await env.STATS.put(
      `obs:${observationId}`,
      JSON.stringify({ id: observationId, received: new Date().toISOString(), caller: await callerId(env, ip), ...obs }),
      ttl,
    );
    await env.STATS.put(
      `rcpt:${receiptId}`,
      JSON.stringify({ id: receiptId, observation_id: observationId, status: "accepted", budget_remaining: b.remaining }),
      ttl,
    );
  } catch {
    /* best effort */
  }

  const who = [obs.agent_vendor, obs.agent_product].filter(Boolean).join(" / ") || "anonymous agent";
  ctx.waitUntil(
    email(
      env,
      `[classifier.dev] observation (${obs.severity} ${obs.category}): ${summary}`.slice(0, 180),
      [
        `${obs.severity.toUpperCase()}  ${obs.category}`,
        "",
        summary,
        "",
        "—".repeat(58),
        "",
        `reported by   ${who}`,
        obs.agent_type ? `agent type    ${obs.agent_type}` : "",
        obs.agent_description ? `agent details ${obs.agent_description}` : "",
        obs.surface ? `surface       ${obs.surface}` : "",
        obs.domain ? `domain        ${obs.domain}` : "",
        obs.confidence !== null ? `confidence    ${obs.confidence}` : "",
        `observation   ${observationId}`,
        `receipt       ${receiptId}`,
      ]
        .filter(Boolean)
        .join("\n"),
    ).catch((e) => console.error(`observation email failed: ${(e as Error).message}`)),
  );

  return { receipt: { id: receiptId, observation_id: observationId, status: "accepted", budget_remaining: b.remaining } };
}

export async function addAttachments(env: Env, feedbackId: string, body: Record<string, unknown>, ip: string) {
  const b = await budget(env, ip);
  if (b.over) throw new Invalid(`rate limit: ${RATE_LIMIT_PER_HOUR} submissions per hour`);
  const raw = await env.STATS.get(`fb:${feedbackId}`);
  if (!raw) throw new Invalid("no such feedback report");
  const record = JSON.parse(raw) as { evidence: Evidence[] };
  const added = parseEvidence(body.evidence);
  if (!added.length) throw new Invalid("evidence is required");
  if (record.evidence.length + added.length > LIMITS.max_evidence_per_feedback) {
    throw new Invalid(`at most ${LIMITS.max_evidence_per_feedback} evidence items per report`);
  }
  record.evidence = [...record.evidence, ...added];
  await env.STATS.put(`fb:${feedbackId}`, JSON.stringify(record), ttl);
  return { evidence_ids: added.map((e) => e.id), evidence_count: record.evidence.length };
}

export async function getReceipt(env: Env, receiptId: string) {
  const raw = await env.STATS.get(`rcpt:${receiptId}`);
  if (!raw) return null;
  return { data: JSON.parse(raw) };
}
