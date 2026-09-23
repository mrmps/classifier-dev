import { providerFetch } from "./spending/permit";
import { addTokens, type Meter } from "./cost";

/**
 * The image door of POST /v1/systemone.
 *
 * DiffusionGemma behind vLLM's structured-read interposer speaks the System
 * One contract and additionally reads an `images` array; Jev does not. A body
 * that names model "dgemma" or carries images goes to that service and
 * nowhere else: there is no fallback to Jev, which cannot look at the image,
 * and none the other way. Everything else on the route stays TypeSafe's to
 * validate, so the official SDKs keep their native behaviour.
 */

export const DGEMMA_MODEL = "dgemma";
export const DGEMMA_MAX_IMAGES = 4;
/** Base64 characters across all images. The route's body is bounded at 1 MB regardless. */
export const DGEMMA_MAX_IMAGE_CHARS = 900_000;
const DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
const TIMEOUT_MS = 60_000;

export type DgemmaRefusalCode = "images_unsupported" | "dgemma_input";
export type DgemmaRoute =
  | { kind: "typesafe" }
  | { kind: "dgemma"; body: string }
  | { kind: "refuse"; status: number; code: DgemmaRefusalCode; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const refuse = (code: DgemmaRefusalCode, message: string): DgemmaRoute => ({ kind: "refuse", status: 400, code, message });

/** Which door a System One body goes through. A body that is not clearly ours stays TypeSafe's to validate. */
export function dgemmaRoute(body: string): DgemmaRoute {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return { kind: "typesafe" }; }
  if (!isRecord(parsed)) return { kind: "typesafe" };
  const images = parsed.images;
  // Presence selects the door; what the field holds is validated after, so an
  // empty or malformed images field never travels to TypeSafe as an unknown key.
  const hasImages = images !== undefined && images !== null;
  const named = parsed.model === DGEMMA_MODEL;
  if (!hasImages && !named) return { kind: "typesafe" };
  if (hasImages && parsed.model !== undefined && !named) {
    return refuse("images_unsupported", `Jev does not accept images; set model to "${DGEMMA_MODEL}" or remove images`);
  }
  if (hasImages) {
    if (!Array.isArray(images) || images.length === 0 || images.length > DGEMMA_MAX_IMAGES) {
      return refuse("dgemma_input", `images must be an array of 1 to ${DGEMMA_MAX_IMAGES} data URLs`);
    }
    let chars = 0;
    for (const image of images) {
      if (typeof image !== "string" || !DATA_URL.test(image)) {
        return refuse("dgemma_input", "Each image must be a data:image/png, image/jpeg, image/webp or image/gif URL with base64 content");
      }
      chars += image.length;
    }
    if (chars > DGEMMA_MAX_IMAGE_CHARS) {
      return refuse("dgemma_input", `images must total at most ${DGEMMA_MAX_IMAGE_CHARS.toLocaleString("en-US")} base64 characters`);
    }
  }
  return { kind: "dgemma", body: JSON.stringify({ ...parsed, model: DGEMMA_MODEL }) };
}

/** The question ids a forwarded body asks; the route already parsed it once, so a failure here is impossible in practice. */
function questionIds(body: string): string[] {
  try {
    const parsed: unknown = JSON.parse(body);
    return isRecord(parsed) && isRecord(parsed.questions) ? Object.keys(parsed.questions) : [];
  } catch { return []; }
}

const NO_STORE = { "cache-control": "no-store" };
const unavailable = (retryAfter: number) => Response.json(
  { error: "The image-capable model is temporarily unavailable", code: "dgemma_unavailable" },
  { status: 503, headers: { ...NO_STORE, "retry-after": String(retryAfter) } },
);

/** Not configured or switched off: the caller asked for this model by name or by sending an image, so nothing else may answer. */
export const dgemmaUnconfigured = () => unavailable(60);

/** Forward one System One body to the service and answer in the route's shapes. */
export async function dgemmaResponse(
  pod: { url: string; token: string },
  body: string,
  meter?: Meter,
  signal?: AbortSignal,
): Promise<Response> {
  // Images and the bearer only ever travel encrypted, and never to a redirect target.
  let origin: URL;
  try { origin = new URL(pod.url); } catch { return unavailable(60); }
  if (origin.protocol !== "https:") return unavailable(60);
  const url = pod.url.replace(/\/+$/, "") + "/v1/systemone";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  signal?.addEventListener("abort", () => controller.abort());
  await meter?.beforeCall?.("dgemma", DGEMMA_MODEL, 0);
  let res: Response;
  let payload: unknown = null;
  try {
    res = await providerFetch(meter, "dgemma", DGEMMA_MODEL, 0, url, {
      method: "POST",
      headers: { authorization: `Bearer ${pod.token}`, "content-type": "application/json" },
      body,
      redirect: "error",
      signal: controller.signal,
    });
    // The deadline covers the body too: headers followed by a stalled body is still a dead pod.
    try { payload = JSON.parse(await res.text()); } catch { /* handled by status below */ }
  } catch {
    return unavailable(10);
  } finally {
    clearTimeout(timer);
  }
  if (res.ok) {
    // A 200 is only a 200 when it is the whole contract: this model, an entry
    // for every question asked (null when the service skipped it under ask_if),
    // and a usage count. Anything less is an outage.
    const asked = questionIds(body);
    const usage = isRecord(payload) && isRecord(payload.usage) ? payload.usage : null;
    if (!isRecord(payload) || payload.model !== DGEMMA_MODEL || !isRecord(payload.answers) || !usage
        || !Number.isInteger(usage.input_tokens) || !Number.isInteger(usage.output_tokens)
        || asked.some((id) => !Object.prototype.hasOwnProperty.call(payload.answers, id))) return unavailable(10);
    if (meter) addTokens(meter, "dgemma", DGEMMA_MODEL, { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens });
    return Response.json(payload, { headers: NO_STORE });
  }
  // The service's validation messages are about the caller's own schema, so they travel; nothing else does.
  const message = isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string"
    ? payload.error.message.slice(0, 300)
    : "";
  if (res.status === 400 || res.status === 422) {
    return Response.json({ error: message || "The image-capable model refused this request", code: "dgemma_input" }, { status: 400, headers: NO_STORE });
  }
  if (res.status === 429) {
    return Response.json({ error: "The image-capable model is busy; retry shortly", code: "dgemma_busy" }, { status: 429, headers: { ...NO_STORE, "retry-after": "2" } });
  }
  return unavailable(10);
}
