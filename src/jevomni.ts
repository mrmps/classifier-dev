import { addTokens, type Meter } from "./cost";
import { providerFetch } from "./spending/permit";
import { SpendingError } from "./spending/policy";

/**
 * Jev-Omni: typed decisions over text, an image, speech or a video clip.
 *
 * A 12B Gemma 4 model with a 256-option decision head, served by our own RunPod
 * pod behind inference/jevomni/server.py. It is opt-in by name - only a body
 * that says model: "jev-omni" comes here. Images with no model still go to
 * imajev-4b, so nobody's existing traffic moves.
 *
 * The pod answers one question per forward pass with no batching, which is why
 * a request is held to eight questions: eight questions about a video is the
 * most expensive ordinary request (~34K tokens, ~25s) and it fits both the
 * token ceiling and the timeout below.
 */
export interface JevomniEnv {
  JEVOMNI_URL?: string;
  JEVOMNI_TOKEN?: string;
}

export const JEVOMNI_MODEL = "jev-omni";
/** The pod refuses, before running it, any forward pass that would take a request past this. */
export const JEVOMNI_MAX_INPUT_TOKENS = 65_536;
const MAX_QUESTIONS = 8;
const MAX_STATE_ITEMS = 20;
const MAX_MEDIA_CHARS = 900_000;
const MEDIA = /^data:(image\/(png|jpeg|webp|gif)|audio\/(wav|mpeg|mp4|webm)|video\/(mp4|webm));base64,[A-Za-z0-9+/]+={0,2}$/;
const TIMEOUT_MS = 60_000;

export const jevomniEnabled = (env: JevomniEnv) => !!(env.JEVOMNI_URL && env.JEVOMNI_TOKEN);
export const isJevomniRequest = (body: Record<string, unknown> | undefined) => body?.model === JEVOMNI_MODEL;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const probability = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

type StateItem = { id: string; text: string; rubric?: string };

/**
 * System One state as the pod's items. A string is one item; an object's keys
 * become item ids, so a question that names `ticket` still finds the ticket;
 * an array of {id, text} items passes through. Anything else is kept whole as
 * JSON rather than guessed at.
 */
export function jevomniState(state: unknown): StateItem[] {
  if (state === undefined || state === null) return [{ id: "state", text: "" }];
  if (typeof state === "string") return [{ id: "state", text: state }];
  if (Array.isArray(state) && state.length && state.every(item => object(item) && typeof item.id === "string" &&
      typeof item.text === "string" && (item.rubric === undefined || typeof item.rubric === "string")))
    return state.map(item => ({ id: item.id as string, text: item.text as string,
      ...(item.rubric === undefined ? {} : { rubric: item.rubric as string }) }));
  if (object(state) && Object.keys(state).length)
    return Object.entries(state).map(([id, value]) => ({ id, text: typeof value === "string" ? value : JSON.stringify(value) }));
  return [{ id: "state", text: JSON.stringify(state) }];
}

export async function jevomniResponse(request: Request, env: JevomniEnv, body: Record<string, unknown>, meter: Meter): Promise<Response> {
  if (!jevomniEnabled(env)) throw new SpendingError(503, "jevomni_unavailable", "Jev-Omni is temporarily unavailable.");
  const media = [...(Array.isArray(body.media) ? body.media : body.media === undefined ? [] : [body.media]),
    ...(Array.isArray(body.images) ? body.images : body.images === undefined || body.images === null ? [] : [body.images])];
  if (media.length > 1)
    throw new SpendingError(400, "bad_media", "Jev-Omni reads one media file per request; send one image, audio clip or video.");
  if (media.some(item => typeof item !== "string" || item.length > MAX_MEDIA_CHARS || !MEDIA.test(item)))
    throw new SpendingError(400, "bad_media",
      "Send media as one base64 data URL: PNG, JPEG, WebP or GIF; WAV, MP3, AAC or Opus audio; MP4 or WebM video; at most 900,000 characters.");
  if (!object(body.questions) || Object.keys(body.questions).length < 1 || Object.keys(body.questions).length > MAX_QUESTIONS ||
      Object.values(body.questions).some(q => !object(q) || !["choice", "noul"].includes(String(q.type)) ||
        Object.keys(q).some(key => !["type", "instructions", "criteria"].includes(key)) ||
        typeof q.instructions !== "string" ||
        (q.type === "choice" && (!object(q.criteria) || Object.keys(q.criteria).length < 2 || Object.keys(q.criteria).length > 256))))
    throw new SpendingError(400, "invalid_request",
      `Provide one to ${MAX_QUESTIONS} choice or noul questions; a choice needs 2 to 256 criteria. Jev-Omni does not answer score questions.`);
  if (body.context !== undefined || body.config !== undefined)
    throw new SpendingError(400, "invalid_request", "Put context in state; per-request model configuration is not supported.");
  if (body.thinking) throw new SpendingError(400, "invalid_request", "Jev-Omni uses single-pass decisions.");
  const state = jevomniState(body.state);
  if (state.length > MAX_STATE_ITEMS)
    throw new SpendingError(400, "invalid_request", `State may hold at most ${MAX_STATE_ITEMS} items.`);

  await meter.beforeCall?.("runpod", JEVOMNI_MODEL, 0);
  const started = Date.now();
  const response = await providerFetch(meter, "runpod", JEVOMNI_MODEL, 0, env.JEVOMNI_URL!, {
    method: "POST",
    // RunPod's proxy sits behind Cloudflare, which answered Python's default
    // user agent with 403 while letting curl through. Name ourselves rather
    // than depend on whatever the runtime sends.
    headers: { "content-type": "application/json", authorization: `Bearer ${env.JEVOMNI_TOKEN}`, "user-agent": "classifier.dev" },
    body: JSON.stringify({ model: JEVOMNI_MODEL, state, questions: body.questions, ...(media.length ? { media } : {}) }),
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(TIMEOUT_MS)]),
    redirect: "manual",
  });
  const headers = new Headers({ "cache-control": "no-store" });
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) headers.set("retry-after", retryAfter);
  if (!response.ok) {
    // The pod refuses as {error: {type, message}}; the API answers {error, code}.
    // Only a refusal about the caller's input passes through; anything else is
    // the pod's problem, not theirs.
    const refusal: unknown = await response.json().catch(() => null);
    const inner = object(refusal) && object(refusal.error) ? refusal.error : null;
    if ([400, 413].includes(response.status) && inner && typeof inner.message === "string")
      return Response.json({ error: inner.message, code: "jevomni_input" }, { status: response.status, headers });
    const status = [429, 503].includes(response.status) ? response.status : 502;
    return Response.json({ error: "Jev-Omni is temporarily unavailable.", code: "jevomni_unavailable" }, { status, headers });
  }
  const payload: unknown = await response.json();
  if (!object(payload) || payload.model !== JEVOMNI_MODEL || !object(payload.answers) || !object(payload.usage) ||
      !Number.isSafeInteger(payload.usage.input_tokens) || Number(payload.usage.input_tokens) < 1 ||
      Number(payload.usage.input_tokens) > JEVOMNI_MAX_INPUT_TOKENS || payload.usage.output_tokens !== 0)
    throw new SpendingError(502, "jevomni_response", "Jev-Omni returned incomplete usage or answers.");
  const answers = payload.answers;
  for (const [id, question] of Object.entries(body.questions)) {
    const answer = answers[id];
    if (!object(question) || !object(answer) || answer.type !== question.type)
      throw new SpendingError(502, "jevomni_response", "Jev-Omni returned an invalid answer.");
    if (question.type === "noul") {
      if (!probability(answer.noul)) throw new SpendingError(502, "jevomni_response", "Jev-Omni returned an invalid decision.");
      continue;
    }
    const criteria = Object.keys(question.criteria as object);
    const probabilities = answer.probabilities;
    if (typeof answer.choice !== "string" || !criteria.includes(answer.choice) || !probability(answer.confidence) ||
        !object(probabilities) || Object.keys(probabilities).length !== criteria.length ||
        criteria.some(key => !probability(probabilities[key])) ||
        Math.abs(criteria.reduce((sum, key) => sum + (probabilities[key] as number), 0) - 1) > 0.0001)
      throw new SpendingError(502, "jevomni_response", "Jev-Omni returned an incomplete probability distribution.");
  }
  headers.append("server-timing", `gpu_request;dur=${Date.now() - started}`);
  addTokens(meter, "runpod", JEVOMNI_MODEL, { inputTokens: payload.usage.input_tokens as number, outputTokens: 0, cachedInputTokens: 0 });
  // Answer in the public shape: the pod's own diagnostics stay on the pod.
  return Response.json({ model: JEVOMNI_MODEL, answers, usage: { input_tokens: payload.usage.input_tokens, output_tokens: 0 } }, { headers });
}
