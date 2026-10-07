import { addTokens, type Meter } from "./cost";
import { providerFetch } from "./spending/permit";
import { SpendingError } from "./spending/policy";

export interface ImajevEnv {
  IMAJEV_URL?: string;
  IMAJEV_TOKEN?: string;
  IMAJEV_SERVICE?: Fetcher;
}

export const IMAJEV_MODEL = "imajev-4b";
export const imajevEnabled = (env: ImajevEnv) => !!((env.IMAJEV_SERVICE || env.IMAJEV_URL) && env.IMAJEV_TOKEN);
export const isImageRequest = (body: Record<string, unknown> | undefined) =>
  body?.model === IMAJEV_MODEL || (body?.images !== undefined && body.images !== null);

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const probability = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

export async function imajevResponse(request: Request, env: ImajevEnv, body: Record<string, unknown>, meter: Meter): Promise<Response> {
  if (!imajevEnabled(env)) throw new SpendingError(503, "image_unavailable", "Image classification is temporarily unavailable.");
  if (body.model !== undefined && body.model !== IMAJEV_MODEL)
    throw new SpendingError(400, "bad_model", "Use imajev-4b for image classification.");
  if (!Array.isArray(body.images) || body.images.length < 1 || body.images.length > 2 ||
      body.images.some(image => typeof image !== "string" || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)))
    throw new SpendingError(400, "bad_image", "Provide one or two JPEG, PNG, or WebP base64 data URLs.");
  if (!object(body.questions) || Object.keys(body.questions).length < 1 || Object.keys(body.questions).length > 8 ||
      Object.values(body.questions).some(q => !object(q) || !["choice", "noul", "score"].includes(String(q.type)) ||
        Object.keys(q).some(key => !["type", "instructions", "criteria"].includes(key))))
    throw new SpendingError(400, "invalid_request", "Provide one to eight choice, noul, or score questions.");
  if (body.context !== undefined || body.config !== undefined)
    throw new SpendingError(400, "invalid_request", "Put image context in state; per-request model configuration is not supported.");
  if (body.thinking) throw new SpendingError(400, "invalid_request", "Image classification uses single-pass decisions.");
  await meter.beforeCall?.("runpod", IMAJEV_MODEL, 0);
  const started = Date.now();
  const response = await providerFetch(meter, "runpod", IMAJEV_MODEL, 0, env.IMAJEV_SERVICE ? "http://imajev/v1/systemone" : env.IMAJEV_URL!, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.IMAJEV_TOKEN}` },
    body: JSON.stringify({ model: IMAJEV_MODEL, state: body.state ?? "", images: body.images, questions: body.questions }),
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
  }, env.IMAJEV_SERVICE ? (input, init) => env.IMAJEV_SERVICE!.fetch(input, init) : undefined);
  const headers = new Headers({ "cache-control": "no-store" });
  for (const name of ["server-timing", "retry-after"]) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    const status = [400, 413, 422, 429, 503].includes(response.status) ? response.status : 502;
    return Response.json(object(error) && typeof error.error === "string" ? error
      : { error: "Image model is temporarily unavailable.", code: "image_unavailable" }, { status, headers });
  }
  const payload: unknown = await response.json();
  if (!object(payload) || payload.model !== IMAJEV_MODEL || !object(payload.answers) || !object(payload.usage) ||
      !Number.isSafeInteger(payload.usage.input_tokens) || Number(payload.usage.input_tokens) < 1 ||
      Number(payload.usage.input_tokens) > 8 * 4096 || payload.usage.output_tokens !== 0)
    throw new SpendingError(502, "image_response", "Image model returned incomplete usage or answers.");
  const answers = payload.answers;
  for (const [id, question] of Object.entries(body.questions)) {
    const answer = answers[id];
    if (!object(question) || !object(answer) || answer.type !== question.type ||
        !probability(answer.unknown_probability) || typeof answer.abstained !== "boolean")
      throw new SpendingError(502, "image_response", "Image model returned an invalid answer.");
    const valid = question.type === "noul" ? probability(answer.noul)
      : question.type === "choice" ? object(question.criteria) && typeof answer.choice === "string" && Object.hasOwn(question.criteria, answer.choice)
      : Array.isArray(question.criteria) && typeof answer.score === "number" && Number.isFinite(answer.score) && answer.score >= 0 && answer.score <= question.criteria.length - 1;
    if (!valid || (question.type !== "noul" && (!probability(answer.confidence) || !object(answer.probabilities) ||
        Object.values(answer.probabilities).some(value => !probability(value)))))
      throw new SpendingError(502, "image_response", "Image model returned an invalid decision.");
    if (question.type !== "noul") {
      const expected = question.type === "choice" ? Object.keys(question.criteria as object)
        : (question.criteria as unknown[]).map((_, index) => String(index));
      const probabilities = answer.probabilities as Record<string, number>;
      if (Object.keys(probabilities).length !== expected.length || expected.some(key => !Object.hasOwn(probabilities, key)) ||
          Math.abs(Object.values(probabilities).reduce((sum, value) => sum + value, 0) - 1) > 0.0001)
        throw new SpendingError(502, "image_response", "Image model returned an incomplete probability distribution.");
    }
  }
  headers.append("server-timing", `gpu_request;dur=${Date.now() - started}`);
  addTokens(meter, "runpod", IMAJEV_MODEL, { inputTokens: payload.usage.input_tokens, outputTokens: 0, cachedInputTokens: 0 });
  return Response.json(payload, { headers });
}
