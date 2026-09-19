/**
 * TypeSafe's Jev, the model behind both tiers.
 *
 * Jev is not a language model prompted to classify; it is a decision model
 * that returns a calibrated probability per option. That changes the shape of
 * everything upstream of it:
 *
 *   - Many items ride in one request. State is an array of {id, text} and each
 *     item gets its own question, so a thousand short inputs cost one round
 *     trip (~1.5s) instead of a thousand. Measured: 100 items packed scored
 *     the same as 100 sent one at a time (0.72 vs 0.69 on six-way emotion).
 *   - Multi-label is one yes/no question per label, read straight off the
 *     probabilities. No chunking, no second pass: F1 0.879 on the seven-case
 *     set against 0.799 for the LLM cascade it replaces, in 200ms.
 *   - `confidence` means something. On six-way emotion, answers above 0.9
 *     were right 82% of the time and answers below 0.5 were right 29%, which
 *     is what lets the smart tier hand only the uncertain ones to a reasoning
 *     model.
 *
 * Limits, from the model card: 64k tokens per request across state and
 * questions, 32k for state plus the longest question. Requests are packed to
 * a conservative budget and run concurrently.
 */

import { recordJevAttempt } from "./jev-observability";
import { addJevCost, addUsd, type Meter } from "./cost";

const API = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";

/**
 * Jev is also served through Vercel's AI Gateway, which carries a monthly
 * free credit per team and, as of September 2026, bills Jev at $0 on top of
 * it. When a gateway key is set the gateway is asked first; anything it will
 * not answer — a free-tier 429, an exhausted credit (402), a team without a
 * card on file (403), an outage — falls straight through to TypeSafe, so the
 * caller sees one answer either way and the meter counts only what was
 * actually charged.
 *
 * The endpoint is the one the AI SDK's `evaluate()` calls; the four `ai-*`
 * headers are how that SDK identifies itself and the request is refused
 * without them. Questions and answers are translated to and from Jev's own
 * shape at the edge so nothing downstream knows which door was used.
 *
 * One thing the translation cannot undo: the gateway rounds probabilities
 * and confidences to two decimals (its answers say so, `rounding:
 * {probabilityDecimals: 2}`) where TypeSafe returns four. Probed September
 * 2026: a top-level `rounding` in the request is ignored and
 * `providerOptions.typesafe.rounding` / `.probabilityDecimals` come back as
 * `warnings: [{type: "unsupported"}]`, so there is no way to ask for more.
 * The thresholds compared against these values — MULTI_THRESHOLD here,
 * ESCALATE_BELOW in index.ts, GATES.jev in skills.ts — therefore see
 * 2-decimal scores whenever the gateway answered.
 */
const GATEWAY = "https://ai-gateway.vercel.sh/v4/ai/evaluation-model";
const GATEWAY_MODEL = "typesafe-ai/jev";
/** The gateway does not say which Jev answered. Starts with "jev" so the digest and the alerts count it as the primary. */
const GATEWAY_MODEL_LABEL = "jev@vercel";

/**
 * After the gateway refuses, requests skip it for a while instead of each
 * paying a failed round trip before TypeSafe. Rate limits lift in seconds;
 * a refused key or an empty balance takes a person. Per isolate.
 */
const GATEWAY_PAUSE_MS = { limited: 30_000, refused: 5 * 60_000, failed: 30_000 } as const;
/** A 429's Retry-After is honoured up to this; a longer wait is a misconfiguration, not a rate limit. */
const RETRY_AFTER_CAP_MS = 5 * 60_000;
let gatewayPausedUntil = 0;

/** For the tests, which share one module across cases. */
export function resetGatewayPause() {
  gatewayPausedUntil = 0;
}

/** Where Jev can be asked. Either key alone works; with both, the gateway goes first and TypeSafe catches what it drops. */
export type JevKeys = { typesafe?: string; gateway?: string; analytics?: AnalyticsEngineDataset };

export const jevKeys = (env: { TYPESAFE_API_KEY?: string; AI_GATEWAY_API_KEY?: string; AI_GATEWAY_DISABLED?: string; JEV_AE?: AnalyticsEngineDataset }): JevKeys | null => {
  const gateway = env.AI_GATEWAY_DISABLED === "true" ? undefined : env.AI_GATEWAY_API_KEY;
  return env.TYPESAFE_API_KEY || gateway
    ? { typesafe: env.TYPESAFE_API_KEY, gateway, ...(env.JEV_AE ? { analytics: env.JEV_AE } : {}) }
    : null;
};

// Only fixed categories are recorded; upstream error strings can contain inputs.
function failureReason(status: number, errorType: string) {
  if (["timeout", "network", "malformed_response", "max_tokens_exceeded"].includes(errorType)) return errorType;
  if (status === 429) return "rate_limit";
  if ([401, 402, 403].includes(status)) return "credentials_or_credit";
  return "upstream_error";
}

// Tokens per request, kept well under the documented 64k because the count
// here is an estimate. Per-item overhead was fitted from real usage figures.
const TOKEN_BUDGET = 48_000;
const STATE_QUESTION_BUDGET = 28_000;
const MAX_ITEMS = 1000;
const CONCURRENCY = 8;
const UPSTREAM_TIMEOUT_MS = 10_000;

/**
 * Tokens in a string, estimated. ASCII runs at about 3.5 characters a token;
 * everything else is counted at two tokens a character, which is what CJK
 * text costs on the tokenizers this is modelled on and a safe overcount for
 * accented Latin. The old estimate divided every character by 3.5, so a
 * batch of Chinese text packed to 20k estimated tokens carried 80k real
 * ones, Jev answered 400 max_tokens_exceeded, and the request fell to the
 * LLM fallback (slow) or, past FALLBACK_MAX_INPUTS, to a 502. Overcounting
 * only costs an extra request, which runs concurrently.
 */
export function estimateTokens(s: string) {
  let ascii = 0;
  let other = 0;
  for (let i = 0; i < s.length; i++) (s.charCodeAt(i) < 128 ? ascii++ : other++);
  return Math.ceil(ascii / 3.5) + other * 2 + 1;
}
const est = estimateTokens;

/** A refusal from Jev, with the status and the error_type the API gives. */
export class JevError extends Error {
  constructor(message: string, readonly status: number, readonly errorType: string) {
    super(message);
  }
}

/** Below this a multi-label yes/no does not count. 0.7 maximised F1 on the eval set. */
export const MULTI_THRESHOLD = 0.7;

export type JevResult = {
  label: string;
  confidence: number;
  /** Probability per label; sums to 1 for single-label, independent per label for multi. */
  scores: Record<string, number>;
  model: string;
};

export type Question =
  | { type: "choice"; instructions: string; criteria: Record<string, null> }
  | { type: "noul"; instructions: string };

type JevBody = { state: { id: string; text: string }[]; model: string; questions: Record<string, Question> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function safeErrorType(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9_:-]{1,80}$/.test(value) ? value : "";
}

/** Do not turn a partial or malformed upstream response into a confident answer. */
function validAnswer(answer: unknown, question: Question): boolean {
  if (!isRecord(answer)) return false;
  if (question.type === "noul") return isProbability(answer.noul);
  if (typeof answer.choice !== "string" || !isProbability(answer.confidence) || !isRecord(answer.probabilities)) return false;
  const probabilities = answer.probabilities;
  if (!Object.prototype.hasOwnProperty.call(question.criteria, answer.choice)) return false;
  return Object.keys(question.criteria).every(
    (label) => Object.prototype.hasOwnProperty.call(probabilities, label) && isProbability(probabilities[label]),
  );
}

export type JevAnswer = { choice?: string; confidence?: number; probabilities?: Record<string, number>; noul?: number };
type JevPayload = { model: string; answers: Record<string, JevAnswer>; usage?: { input_tokens?: number } };

function validPayload(payload: unknown, body: JevBody): payload is JevPayload {
  if (!isRecord(payload) || typeof payload.model !== "string" || !payload.model || !isRecord(payload.answers)) return false;
  const answers = payload.answers;
  return Object.entries(body.questions).every(([id, question]) => validAnswer(answers[id], question));
}

function questionsFor(id: string, labels: string[], instructions: string | undefined, multi: boolean) {
  const extra = instructions ? ` ${instructions.trim()}` : "";
  const out: Record<string, Question> = {};
  if (multi) {
    labels.forEach((l, i) => {
      out[`${id}_${i}`] = {
        type: "noul",
        instructions:
          `Does the category "${l}" apply to item \`${id}\`? ` +
          `A category applies if the text meaningfully touches it, even briefly.${extra}`,
      };
    });
  } else {
    out[id] = {
      type: "choice",
      instructions: `Which category does item \`${id}\` belong to?${extra}`,
      criteria: Object.fromEntries(labels.map((l) => [l, null])),
    };
  }
  return out;
}

/** An indivisible set of questions about one state item. Recovery splits between groups, never within one. */
export type JevQuestionGroup<T> = {
  state: { id: string; text: string };
  questions: Record<string, Question>;
  value: T;
};

/** A prepared request. Callers retain it when validation must happen before quota or network work. */
export type JevBatch<T> = { groups: JevQuestionGroup<T>[]; state: { id: string; text: string }[]; questions: Record<string, Question> };

/** A single dimension cell can be rejected before quota work; ordinary classification lets Jev make that decision. */
export class JevContextError extends Error {}

function stateCost(state: JevQuestionGroup<unknown>["state"]) {
  return est(state.text) + 20;
}

function questionCost(question: Question) {
  return est(JSON.stringify(question)) + 16 * (question.type === "choice" ? Object.keys(question.criteria).length : 0) + 40;
}

function batchFrom<T>(groups: JevQuestionGroup<T>[]): JevBatch<T> {
  const states = new Map<string, { id: string; text: string }>();
  const questions: Record<string, Question> = {};
  for (const group of groups) {
    states.set(group.state.id, group.state);
    Object.assign(questions, group.questions);
  }
  return { groups, state: [...states.values()], questions };
}

/** Own both documented context budgets and greedily preserve group order. */
export function prepareJevBatches<T>(groups: JevQuestionGroup<T>[], options: { rejectOversized?: boolean } = {}): JevBatch<T>[] {
  const batches: JevBatch<T>[] = [];
  let current: JevQuestionGroup<T>[] = [];
  let included = new Set<string>();
  let stateTokens = 0;
  let questionTokens = 0;
  let longestQuestion = 0;

  const flush = () => {
    if (current.length) batches.push(batchFrom(current));
    current = [];
    included = new Set();
    stateTokens = questionTokens = longestQuestion = 0;
  };

  for (const group of groups) {
    const addedState = included.has(group.state.id) ? 0 : stateCost(group.state);
    const costs = Object.values(group.questions).map(questionCost);
    const addedQuestions = costs.reduce((sum, cost) => sum + cost, 0);
    const groupLongest = Math.max(0, ...costs);
    if (options.rejectOversized && stateCost(group.state) + groupLongest > STATE_QUESTION_BUDGET) {
      throw new JevContextError("A state item and question exceed Jev's context budget");
    }
    const overBudget = stateTokens + addedState + questionTokens + addedQuestions > TOKEN_BUDGET ||
      stateTokens + addedState + Math.max(longestQuestion, groupLongest) > STATE_QUESTION_BUDGET ||
      (!included.has(group.state.id) && included.size >= MAX_ITEMS);
    if (current.length && overBudget) flush();

    current.push(group);
    if (!included.has(group.state.id)) {
      included.add(group.state.id);
      stateTokens += stateCost(group.state);
    }
    questionTokens += addedQuestions;
    longestQuestion = Math.max(longestQuestion, groupLongest);
  }
  flush();
  return batches;
}

/** Jev's questions in the gateway's vocabulary: a yes/no is a `boolean` there, and a choice is a choice. */
function gatewayQuestion(q: Question) {
  return q.type === "noul"
    ? { type: "boolean", instructions: q.instructions }
    : { type: "choice", instructions: q.instructions, criteria: q.criteria };
}

/**
 * A gateway answer in Jev's own shape, or null when it is not one. The
 * calibrated confidence rides in provider metadata rather than on the answer;
 * when it is missing or not a probability, `own` — the winning option's
 * probability — is a stand-in for the calibrated confidence.
 */
function fromGateway(payload: unknown): (JevPayload & { cost?: unknown }) | null {
  if (!isRecord(payload) || !isRecord(payload.answers)) return null;
  const meta = isRecord(payload.providerMetadata) ? payload.providerMetadata : {};
  const typesafe = isRecord(meta.typesafe) ? meta.typesafe : {};
  const confidence = isRecord(typesafe.confidence) ? typesafe.confidence : {};
  const gateway = isRecord(meta.gateway) ? meta.gateway : {};
  const usage = isRecord(payload.usage) ? payload.usage : {};
  const answers: Record<string, JevAnswer> = {};
  for (const [id, a] of Object.entries(payload.answers)) {
    if (!isRecord(a)) continue;
    if (a.type === "boolean") {
      answers[id] = { noul: a.probability as number };
    } else if (a.type === "choice") {
      const probabilities = isRecord(a.probabilities) ? (a.probabilities as Record<string, number>) : undefined;
      const own = typeof a.choice === "string" ? probabilities?.[a.choice] : undefined;
      answers[id] = { choice: a.choice as string, confidence: isProbability(confidence[id]) ? confidence[id] : (own as number), probabilities };
    }
  }
  return { model: GATEWAY_MODEL_LABEL, answers, usage: { input_tokens: usage.inputTokens as number }, cost: gateway.cost };
}

/**
 * The error type of a gateway refusal. A refusal that came from TypeSafe
 * arrives as `type: "AI_APICallError"` with TypeSafe's own body as a JSON
 * string in `message` (probed: `{"error_type":"max_tokens_exceeded"}`), so
 * that is unwrapped first and the batch halving upstream sees the same
 * `max_tokens_exceeded` it would from TypeSafe directly. Failing that, a
 * message about tokens, context or length is taken to mean the same thing.
 */
function gatewayErrorType(err: Record<string, unknown>): string {
  const own = safeErrorType(err.type) || safeErrorType(err.code);
  const message = typeof err.message === "string" ? err.message : "";
  if (own === "max_tokens_exceeded" || /max_tokens_exceeded/.test(message)) return "max_tokens_exceeded";
  if (message.startsWith("{")) {
    try {
      const inner = JSON.parse(message) as unknown;
      const innerType = isRecord(inner) ? safeErrorType(inner.error_type) || safeErrorType(inner.type) : "";
      if (innerType) return innerType;
    } catch { /* not TypeSafe's body; fall through */ }
  }
  if (/\b(tokens?|context( length| window)?|too (long|large))\b/i.test(message) && /(exceed|limit|too (long|large)|maximum)/i.test(message)) {
    return "max_tokens_exceeded";
  }
  return own;
}

function pauseGateway(kind: keyof typeof GATEWAY_PAUSE_MS, retryAfter?: string | null) {
  const asked = Number(retryAfter);
  const ms = kind === "limited" && Number.isFinite(asked) && asked > 0 ? Math.min(asked * 1000, RETRY_AFTER_CAP_MS) : GATEWAY_PAUSE_MS[kind];
  gatewayPausedUntil = Math.max(gatewayPausedUntil, Date.now() + ms);
}

/** One attempt through the gateway. It is never retried here: TypeSafe is the retry. */
async function postGateway(key: string, body: JevBody, meter?: Meter, analytics?: AnalyticsEngineDataset): Promise<JevPayload> {
  const started = Date.now();
  const observe = (status: number, reason = "") => recordJevAttempt(analytics, { provider: "gateway", outcome: reason ? "failure" : "success", reason, status, ms: Date.now() - started, items: body.state.length, attempt: 1 });
  const questions = Object.fromEntries(Object.entries(body.questions).map(([id, q]) => [id, gatewayQuestion(q)]));
  let res: Response;
  try {
    res = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        "ai-gateway-protocol-version": "0.0.1",
        "ai-gateway-auth-method": "api-key",
        "ai-evaluation-model-specification-version": "4",
        "ai-model-id": GATEWAY_MODEL,
      },
      body: JSON.stringify({ state: body.state, questions }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
    pauseGateway("failed");
    observe(timeout ? 504 : 0, timeout ? "timeout" : "network");
    throw new JevError(`gateway ${timeout ? "timeout" : "network failure"}`, timeout ? 504 : 0, timeout ? "timeout" : "network");
  }
  const raw = await res.json().catch(() => null);
  if (res.ok) {
    const payload = fromGateway(raw);
    if (payload && validPayload(payload, body)) {
      // The gateway says what it charged. When it does not, Jev's own rate
      // is the honest guess; addUsd ignores the zero it reports today.
      if (payload.cost !== undefined) addUsd(meter, payload.cost);
      else addJevCost(meter, payload.usage?.input_tokens);
      observe(res.status);
      return payload;
    }
    observe(res.status, "malformed_response");
    pauseGateway("failed");
    throw new JevError("gateway 200: malformed response", 200, "malformed_response");
  }
  const err = isRecord(raw) && isRecord(raw.error) ? raw.error : {};
  const errorType = gatewayErrorType(err);
  observe(res.status, failureReason(res.status, errorType));
  if (res.status === 429) pauseGateway("limited", res.headers.get("retry-after"));
  else if (res.status === 401 || res.status === 402 || res.status === 403) pauseGateway("refused");
  else if (res.status >= 500) pauseGateway("failed");
  // A 400 is about this request, not the gateway; the next request may try again.
  throw new JevError(`gateway ${res.status}: ${errorType || "upstream failure"}`, res.status, errorType);
}

/** The gateway when it is configured and not paused, TypeSafe otherwise; and TypeSafe again when the gateway drops a request. */
async function post(keys: JevKeys, body: JevBody, meter?: Meter): Promise<JevPayload> {
  // Without a TypeSafe key there is nothing to pause towards, so the gateway is always tried.
  const tryGateway = keys.gateway && (!keys.typesafe || Date.now() >= gatewayPausedUntil);
  if (keys.gateway && tryGateway) {
    try {
      return await postGateway(keys.gateway, body, meter, keys.analytics);
    } catch (e) {
      if (!keys.typesafe) throw e;
      // Too big for Jev is too big through either door: let the caller halve it
      // rather than pay TypeSafe a round trip for the same refusal.
      if (e instanceof JevError && e.errorType === "max_tokens_exceeded") throw e;
    }
  }
  if (keys.gateway && !tryGateway) {
    recordJevAttempt(keys.analytics, { provider: "gateway", outcome: "skipped", reason: "cooldown", status: 0, ms: 0, items: body.state.length, attempt: 0 });
  }
  if (!keys.typesafe) throw new JevError("typesafe: no key configured", 0, "unconfigured");
  return postTypesafe(keys.typesafe, body, meter, keys.analytics);
}

async function postTypesafe(key: string, body: JevBody, meter?: Meter, analytics?: AnalyticsEngineDataset): Promise<JevPayload> {
  let last: Error = new Error("typesafe: no attempt made");
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = Date.now();
    const observe = (status: number, reason = "") => recordJevAttempt(analytics, { provider: "typesafe", outcome: reason ? "failure" : "success", reason, status, ms: Date.now() - started, items: body.state.length, attempt: attempt + 1 });
    let res: Response;
    try {
      res = await fetch(API, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (e) {
      const timeout = e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
      observe(timeout ? 504 : 0, timeout ? "timeout" : "network");
      last = new JevError(`typesafe ${timeout ? "timeout" : "network failure"}`, timeout ? 504 : 0, timeout ? "timeout" : "network");
      if (attempt < 2) await new Promise((r) => setTimeout(r, 300 * 2 ** attempt + Math.random() * 200));
      continue;
    }
    const rawPayload = await res.json().catch(() => null);
    const payload = (isRecord(rawPayload) ? rawPayload : {}) as Partial<JevPayload> & { error_type?: string; error?: unknown };
    if (res.ok && !payload.error && validPayload(payload, body)) {
      // Only a call that answered is billed; a retried 429 is not.
      addJevCost(meter, payload.usage?.input_tokens);
      observe(res.status);
      return payload;
    }
    // TypeSafe's live errors are wrapped in `detail`; retain top-level support
    // for responses that use the older shape. Never copy provider messages.
    const detail = isRecord(rawPayload) && isRecord(rawPayload.detail) ? rawPayload.detail : {};
    const errorType = res.ok ? "malformed_response" : safeErrorType(detail.error_type) || safeErrorType(payload.error_type);
    observe(res.status, failureReason(res.status, errorType));
    last = new JevError(
      `typesafe ${res.status}: ${res.ok ? "malformed response" : errorType || "upstream failure"}`,
      res.status,
      errorType,
    );
    // 429 and 529 are the documented "back off and retry" statuses.
    const retryable = res.status === 408 || res.status === 425 || res.status === 429 || res.status === 529 || res.status >= 500 || res.ok;
    if (!retryable || attempt >= 2) break;
    await new Promise((r) => setTimeout(r, 300 * 2 ** attempt + Math.random() * 200));
  }
  throw last;
}

/**
 * One request, questions written by the caller. The skills review asks Jev
 * about intent and quality in its own words rather than as a label set, and
 * gets the same validated, calibrated answers back.
 */
export async function jevAsk(keys: JevKeys, state: { id: string; text: string }[], questions: Record<string, Question>, meter?: Meter) {
  const res = await post(keys, { state, model: MODEL, questions }, meter);
  return { model: res.model, answers: res.answers };
}

export type JevBatchResult<T> = { value: T; model: string; answers: Record<string, JevAnswer> };

/** Execute prepared requests with bounded concurrency and recover from an underestimated context by halving groups. */
export async function runJevBatches<T>(keys: JevKeys, prepared: JevBatch<T>[], meter?: Meter): Promise<JevBatchResult<T>[]> {
  const queue = [...prepared];
  const positions = new Map(prepared.flatMap((batch) => batch.groups).map((group, index) => [group, index]));
  const out: JevBatchResult<T>[] = new Array(positions.size);
  let next = 0;
  let failure: unknown;

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (!failure && next < queue.length) {
      const batch = queue[next++];
      try {
        const res = await post(keys, { state: batch.state, model: MODEL, questions: batch.questions }, meter);
        for (const group of batch.groups) out[positions.get(group)!] = { value: group.value, model: res.model, answers: res.answers };
      } catch (error) {
        if (error instanceof JevError && error.errorType === "max_tokens_exceeded" && batch.groups.length > 1) {
          const mid = Math.ceil(batch.groups.length / 2);
          queue.push(batchFrom(batch.groups.slice(0, mid)), batchFrom(batch.groups.slice(mid)));
        } else {
          failure = error;
        }
      }
    }
  }));
  if (failure) throw failure;
  return out;
}

export async function jevClassify(
  keys: JevKeys,
  inputs: string[],
  labels: string[],
  instructions: string | undefined,
  multi: boolean,
  meter?: Meter,
): Promise<JevResult[]> {
  const groups = inputs.map((text, index): JevQuestionGroup<number> => {
    const id = `i${index}`;
    return { state: { id, text }, questions: questionsFor(id, labels, instructions, multi), value: index };
  });
  const answered = await runJevBatches(keys, prepareJevBatches(groups), meter);
  return answered.map(({ value: index, model, answers }) => {
    const id = `i${index}`;
    if (multi) {
      // Define own properties so labels such as __proto__ remain data.
      const scores = Object.fromEntries(labels.map((label, labelIndex) => [
        label, Number((answers[`${id}_${labelIndex}`]?.noul ?? 0).toFixed(4)),
      ]));
      const best = labels.reduce((a, label) => (scores[label] > scores[a] ? label : a), labels[0]);
      return { label: best, confidence: scores[best], scores, model };
    }
    const answer = answers[id];
    const scores = Object.fromEntries(labels.map((label) => [
      label, Number((answer?.probabilities?.[label] ?? 0).toFixed(4)),
    ]));
    return {
      label: answer?.choice && labels.includes(answer.choice) ? answer.choice : labels[0],
      confidence: Number((answer?.confidence ?? 0).toFixed(4)),
      scores,
      model,
    };
  });
}
