import { addTokens, type Meter } from "./cost";
import type { JevResult } from "./jev";

export type Processing = "fast" | "bulk";
export type LayaEnv = {
  LAYA_FAST_URL?: string;
  LAYA_BULK_URL?: string;
  LAYA_MODAL_KEY?: string;
  LAYA_MODAL_SECRET?: string;
  LAYA_ENABLED?: string;
  LIMITER: DurableObjectNamespace;
};
export const LAYA_LIMITS = {
  fast: { rpm: 60, daily: 2000, questions: 4 },
  bulk: { rpm: 1000, daily: 20_000, questions: 64 },
} as const;
export const layaModel = (lane: Processing, checkpoint = "routed") => `laya-0.3.4-${checkpoint}-${lane}`;
export class LayaError extends Error {
  constructor(message: string, readonly status: 400 | 429 | 502 | 503, readonly retryAfter = 1, readonly scope?: "day") { super(message); }
}
export type LayaTask = { input: string; labels: string[]; instructions?: string; multi?: boolean };
type Row = { state: string; questions: Record<string, unknown> };
export type LayaPlan = { batches: Row[][]; tasks: LayaTask[]; cost: number; processing: Processing };

/** Validate and chunk before any quota, billing, or inference side effects. */
export function planLaya(tasks: LayaTask[], processing: Processing): LayaPlan {
  if (!tasks.length || tasks.length > 1000) throw new LayaError("Laya accepts 1–1,000 decisions per request", 400);
  if (processing === "fast" && tasks.length > 1) throw new LayaError("Laya fast accepts one decision per call; use processing: bulk for batches or dimensions", 400);
  const batches: Row[][] = [];
  let batch: Row[] = [], size = 0, bytes = 0, cost = 0;
  for (const task of tasks) {
    if (task.labels.length < 2 || task.labels.length > 16 || task.labels.some(l => l.length > 100) ||
        task.input.length > 2000 || (task.instructions?.length ?? 0) > 400) {
      throw new LayaError("Laya trial accepts short text (≤2,000 characters), 2–16 short labels, and instructions ≤400 characters; the full question must also fit the selected checkpoint's token budget", 400);
    }
    const questions: Record<string, unknown> = {};
    if (task.multi) task.labels.forEach((label, i) => {
      questions[`q${i}`] = { type: "noul", instructions: `Does this text belong to the category ${JSON.stringify(label)}? ${task.instructions ?? ""}` };
    });
    else questions.q = { type: "choice", instructions: `Which category fits this text? ${task.instructions ?? ""}`,
      criteria: Object.fromEntries(task.labels.map(label => [label, null])) };
    const n = Object.keys(questions).length;
    if (n > LAYA_LIMITS[processing].questions) throw new LayaError("Too many questions for Laya fast; use processing: bulk", 400);
    const row = { state: task.input, questions };
    const rowBytes = new TextEncoder().encode(JSON.stringify(row)).length;
    if (batch.length && (size + n > LAYA_LIMITS[processing].questions || bytes + rowBytes > 200_000)) {
      batches.push(batch); batch = []; size = 0; bytes = 0;
    }
    batch.push(row); size += n; bytes += rowBytes; cost += n;
  }
  if (cost > LAYA_LIMITS[processing].rpm) throw new LayaError("Batch exceeds the Laya per-minute question quota; split it into smaller calls", 400);
  if (batch.length) batches.push(batch);
  return { batches, tasks, cost, processing };
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
    // Unlike the legacy quota, this protects a deliberately small GPU pool.
    throw new LayaError("Laya admission control is temporarily unavailable", 503);
  }
}

const probability = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

export type LayaTiming = { fetchMs?: number; headersMs?: number; backendMs?: number };

export async function runLaya(env: LayaEnv, plan: LayaPlan, meter?: Meter, timing?: LayaTiming): Promise<JevResult[]> {
  const url = plan.processing === "fast" ? env.LAYA_FAST_URL : env.LAYA_BULK_URL;
  if (env.LAYA_ENABLED !== "true" || !url || !env.LAYA_MODAL_KEY || !env.LAYA_MODAL_SECRET)
    throw new LayaError("Laya trial is currently unavailable", 503);
  const model = layaModel(plan.processing);
  const output: JevResult[] = [];
  let completeBackendTiming = true;
  const deadline = Date.now() + 90_000;
  for (const batch of plan.batches) {
    if (Date.now() >= deadline) throw new LayaError("Laya request deadline exceeded; use smaller batches", 503);
    await meter?.beforeCall?.("modal", model, 0);
    let response: Response;
    const started = performance.now();
    try {
      response = await fetch(url + "/predict", { method: "POST",
        headers: { "content-type": "application/json", "Modal-Key": env.LAYA_MODAL_KEY, "Modal-Secret": env.LAYA_MODAL_SECRET },
        body: JSON.stringify({ batch }), signal: AbortSignal.timeout(Math.min(15_000, deadline - Date.now())) });
    } catch { throw new LayaError("Laya timed out or could not be reached", 503, 5); }
    if (timing) timing.headersMs = (timing.headersMs ?? 0) + performance.now() - started;
    if (response.status === 429 || response.status === 503)
      throw new LayaError("Laya is busy or starting; retry with backoff", response.status, response.status === 503 ? 10 : 1);
    if (response.status === 400 || response.status === 413)
      throw new LayaError("Laya rejected the input: shorten text, instructions, or labels to fit the selected checkpoint's context", 400);
    if (!response.ok) throw new LayaError("Laya inference failed", 502);
    let body: { inference_ms?: unknown; results?: Array<{ routing?: { model?: string }; answers?: Record<string, { choice?: string; confidence?: number; probabilities?: Record<string, number>; noul?: number }>; usage?: { input_tokens?: number } }> };
    try { body = await response.json(); } catch { throw new LayaError("Invalid Laya response", 502); }
    if (timing) {
      timing.fetchMs = (timing.fetchMs ?? 0) + performance.now() - started;
      if (typeof body?.inference_ms === "number" && Number.isFinite(body.inference_ms) && body.inference_ms >= 0)
        timing.backendMs = (timing.backendMs ?? 0) + body.inference_ms;
      else completeBackendTiming = false;
    }
    if (!Array.isArray(body?.results) || body.results.length !== batch.length) throw new LayaError("Incomplete Laya response", 502);
    for (const row of body.results) {
      if (!row || typeof row !== "object") throw new LayaError("Invalid Laya response", 502);
      const checkpoint = row.routing?.model;
      if (!checkpoint || !["english", "multilingual", "typed-decisions"].includes(checkpoint))
        throw new LayaError("Invalid Laya routing metadata", 502);
      const task = plan.tasks[output.length];
      let scores: Record<string, number>, label: string, confidence: number;
      if (task.multi) {
        scores = {};
        task.labels.forEach((name, i) => {
          const value = row.answers?.[`q${i}`]?.noul;
          if (!probability(value)) throw new LayaError("Invalid Laya probabilities", 502);
          Object.defineProperty(scores, name, { value, enumerable: true });
        });
        label = task.labels.reduce((a, b) => scores[a] >= scores[b] ? a : b);
        confidence = scores[label];
      } else {
        const answer = row.answers?.q;
        if (!answer || !task.labels.includes(answer.choice ?? "") || !probability(answer.confidence) ||
            !answer.probabilities || !task.labels.every(l => probability(answer.probabilities?.[l])))
          throw new LayaError("Invalid Laya probabilities", 502);
        label = answer.choice!; confidence = answer.confidence;
        scores = Object.fromEntries(task.labels.map(l => [l, answer.probabilities![l]]));
      }
      output.push({ label, confidence, scores, model: layaModel(plan.processing, checkpoint) });
    }
    const counts = body.results.map(r => r.usage?.input_tokens);
    addTokens(meter, "modal", model, { inputTokens: counts.every(n => Number.isSafeInteger(n) && n! >= 0) ? counts.reduce<number>((sum, n) => sum + n!, 0) : undefined,
      outputTokens: 0, cachedInputTokens: 0 });
  }
  if (timing && !completeBackendTiming) delete timing.backendMs;
  return output;
}
