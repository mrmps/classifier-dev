import type { Meter } from "./cost";
import {
  type JevKeys, type JevResult, type JevQuestionGroup, type Question, type Backend,
  LAYA_BACKEND, KEV_BACKEND, JevError, prepareJevBatches, runJevBatches,
} from "./jev";

/**
 * Laya and Kev, both hosted by Beam.
 *
 * Beam speaks TypeSafe's System One protocol, so there is no separate client
 * here any more: this module owns the product contract — which lanes exist,
 * what a caller may send, and what a lane costs against quota — and hands the
 * actual request to `src/jev.ts`, which owns every System One transport.
 *
 * What the move off Modal changed, visibly:
 *   - There is no GPU pool to keep warm, so `fast` and `bulk` are quota lanes
 *     rather than separate deployments. Neither can return "still starting".
 *   - Beam does not report which checkpoint answered, so a result is labelled
 *     `jev/laya` or `jev/kev` rather than `laya-0.3.4-<checkpoint>-<lane>`.
 *   - Spend is per input token and reported, so account analytics no longer
 *     marks provider cost unknown.
 */

export type Processing = "fast" | "bulk";
export type LayaModel = "laya" | "kev";

export type LayaEnv = {
  LAYA_ENABLED?: string;
  LAYA_FAST_ADMISSION?: RateLimit;
  LIMITER: DurableObjectNamespace;
};

/**
 * Lane quotas. These are a product decision about shared capacity, not a
 * property of Beam, so they survived the move unchanged: existing callers keep
 * the limits they were issued against.
 */
export const LAYA_LIMITS = {
  fast: { rpm: 60, daily: 2000, questions: 4 },
  bulk: { rpm: 1000, daily: 20_000, questions: 64 },
} as const;

export const BACKEND_FOR: Record<LayaModel, Backend> = { laya: LAYA_BACKEND, kev: KEV_BACKEND };
/** The label a result carries; Beam returns the same string. */
export const layaModel = (model: LayaModel = "laya") => BACKEND_FOR[model].model;

export class LayaError extends Error {
  constructor(message: string, readonly status: 400 | 429 | 502 | 503, readonly retryAfter = 1, readonly scope?: "day") { super(message); }
}

export type LayaTask = { input: string; labels: string[]; instructions?: string; multi?: boolean };
export type LayaPlan = { tasks: LayaTask[]; cost: number; processing: Processing; model: LayaModel };

/** Validate and price before any quota, billing, or inference side effects. */
export function planLaya(tasks: LayaTask[], processing: Processing, model: LayaModel = "laya"): LayaPlan {
  if (!tasks.length || tasks.length > 1000) throw new LayaError("Laya accepts 1–1,000 decisions per request", 400);
  if (processing === "fast" && tasks.length > 1) throw new LayaError("Laya fast accepts one decision per call; use processing: bulk for batches or dimensions", 400);
  let cost = 0;
  for (const task of tasks) {
    if (task.labels.length < 2 || task.labels.length > 16 || task.labels.some(l => l.length > 100) ||
        task.input.length > 2000 || (task.instructions?.length ?? 0) > 400) {
      throw new LayaError("Laya trial accepts short text (≤2,000 characters), 2–16 short labels, and instructions ≤400 characters; the full question must also fit the selected checkpoint's token budget", 400);
    }
    const questions = task.multi ? task.labels.length : 1;
    if (questions > LAYA_LIMITS[processing].questions) throw new LayaError("Too many questions for Laya fast; use processing: bulk", 400);
    cost += questions;
  }
  if (cost > LAYA_LIMITS[processing].rpm) throw new LayaError("Batch exceeds the Laya per-minute question quota; split it into smaller calls", 400);
  return { tasks, cost, processing, model };
}

export type QuotaTiming = Partial<Record<"handler" | "read" | "write", number>>;
export function readQuotaTiming(response: Response, timing?: QuotaTiming) {
  if (!timing) return;
  for (const part of (response.headers.get("server-timing") ?? "").split(",")) {
    const match = /^(handler|read|write);dur=(\d+(?:\.\d+)?)$/.exec(part.trim());
    if (match && Number.isFinite(Number(match[2]))) timing[match[1] as keyof QuotaTiming] = Number(match[2]);
  }
}

export async function limitLaya(env: LayaEnv, lane: Processing, owner: string, cost: number, timing?: QuotaTiming) {
  const { rpm, daily } = LAYA_LIMITS[lane];
  try {
    const id = env.LIMITER.idFromName(`laya:${lane}:${owner}`);
    const response = await env.LIMITER.get(id).fetch(`https://limiter/?limit=${rpm}&daily=${daily}&cost=${cost}${timing ? "&timing=1" : ""}`);
    readQuotaTiming(response, timing);
    if (!response.ok) throw new Error("limiter unavailable");
    const result = await response.json() as { limited: boolean; remaining: number; resetIn?: number; scope?: "minute" | "day" };
    if (typeof result.limited !== "boolean" || !Number.isFinite(result.remaining)) throw new Error("invalid limiter response");
    if (result.limited) throw new LayaError("Laya trial limit reached; retry after the window resets", 429, result.resetIn ?? 60, result.scope === "day" ? "day" : undefined);
    return result.remaining;
  } catch (error) {
    if (error instanceof LayaError) throw error;
    // Unlike the legacy quota, this protects a deliberately small shared pool.
    throw new LayaError("Laya admission control is temporarily unavailable", 503);
  }
}

/**
  * Beam reports no server-side duration, so there is nothing to record beyond
  * the client-side span. The Modal deployment's `inference_ms` and the
  * headers/body split went with it rather than being reported as zero.
  */
export type LayaTiming = { fetchMs?: number };

/** One question per label for multi-label, one choice otherwise — Jev's own shape. */
function groupsFor(plan: LayaPlan): JevQuestionGroup<number>[] {
  return plan.tasks.map((task, index) => {
    const id = `i${index}`;
    const questions: Record<string, Question> = {};
    if (task.multi) {
      task.labels.forEach((label, i) => {
        questions[`${id}_${i}`] = { type: "noul", instructions: `Does this text belong to the category ${JSON.stringify(label)}? ${task.instructions ?? ""}`.trim() };
      });
    } else {
      questions[id] = {
        type: "choice",
        instructions: `Which category fits this text? ${task.instructions ?? ""}`.trim(),
        criteria: Object.fromEntries(task.labels.map(label => [label, null])),
      };
    }
    return { state: { id, text: task.input }, questions, value: index };
  });
}

/**
 * A Beam refusal in the vocabulary callers already handle. The mapping is
 * deliberately lossy — upstream strings can echo caller text, so only the
 * status and our own message travel outward.
 */
function asLayaError(error: unknown): LayaError {
  if (!(error instanceof JevError)) return new LayaError("Laya inference failed", 502);
  // Input the model will not accept, however Beam phrased the refusal.
  if (error.errorType === "max_tokens_exceeded" || error.errorType === "invalid_request" ||
      error.status === 400 || error.status === 413 || error.status === 422)
    return new LayaError("Laya rejected the input: shorten text, instructions, or labels to fit the selected checkpoint's context", 400);
  if (error.status === 429) return new LayaError("Laya is busy; retry with backoff", 429, 1);
  // A key or balance problem is ours, not the caller's: it reads as unavailable.
  if (error.status === 401 || error.status === 402 || error.status === 403 || error.status === 503)
    return new LayaError("Laya trial is currently unavailable", 503, 10);
  if (error.errorType === "timeout" || error.errorType === "network")
    return new LayaError("Laya timed out or could not be reached", 503, 5);
  return new LayaError("Laya inference failed", 502);
}

export async function runLaya(env: LayaEnv, keys: JevKeys, plan: LayaPlan, meter?: Meter, timing?: LayaTiming, signal?: AbortSignal): Promise<JevResult[]> {
  if (env.LAYA_ENABLED !== "true" || !keys.beam) throw new LayaError("Laya trial is currently unavailable", 503);
  const backend = BACKEND_FOR[plan.model];
  const started = performance.now();
  let answered;
  try {
    answered = await runJevBatches(keys, prepareJevBatches(groupsFor(plan), { limits: backend.limits }), meter, backend, signal);
  } catch (error) {
    throw asLayaError(error);
  }
  if (timing) timing.fetchMs = performance.now() - started;

  const out: JevResult[] = new Array(plan.tasks.length);
  for (const { value: index, model, answers } of answered) {
    const task = plan.tasks[index];
    const id = `i${index}`;
    let scores: Record<string, number>, label: string, confidence: number | null;
    if (task.multi) {
      scores = {};
      task.labels.forEach((name, i) => {
        const value = answers[`${id}_${i}`]?.noul;
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)
          throw new LayaError("Invalid Laya probabilities", 502);
        // Define own properties so a label such as __proto__ stays data.
        Object.defineProperty(scores, name, { value: Number(value.toFixed(4)), enumerable: true, writable: true, configurable: true });
      });
      label = task.labels.reduce((a, b) => (scores[a] >= scores[b] ? a : b));
      // Per-label nouls have no comparable choice confidence; see JevResult.
      confidence = null;
    } else {
      const answer = answers[id];
      const ok = answer && task.labels.includes(answer.choice ?? "") &&
        typeof answer.confidence === "number" && answer.confidence >= 0 && answer.confidence <= 1 &&
        answer.probabilities && task.labels.every(l => typeof answer.probabilities![l] === "number");
      if (!ok) throw new LayaError("Invalid Laya probabilities", 502);
      label = answer!.choice!;
      confidence = Number(answer!.confidence!.toFixed(4));
      scores = Object.fromEntries(task.labels.map(l => [l, Number(answer!.probabilities![l].toFixed(4))]));
    }
    out[index] = { label, confidence, scores, model };
  }
  if (out.some(row => row === undefined)) throw new LayaError("Incomplete Laya response", 502);
  return out;
}
