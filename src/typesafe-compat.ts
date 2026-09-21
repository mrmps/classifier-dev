import { providerFetch } from "./spending/permit";
import { SpendingError } from "./spending/policy";
/**
 * Wire-compatible TypeSafe API surface.
 *
 * The official clients already own request construction, validation and
 * response decoding. Keeping this adapter as a transparent pass-through means
 * new question fields and model aliases continue to work without a second,
 * subtly different implementation in classifier.dev.
 */

import { addJevCost, addTokens, JEV_ACCOUNT_MODEL, type Meter } from "./cost";

const TYPESAFE_ORIGIN = "https://api.typesafe.ai";
const PRIVATE_REQUEST_HEADERS = /^(authorization|cookie|host|content-length|connection|forwarded|cf-|x-forwarded-|x-real-ip$|true-client-ip$|fly-client-ip$)/i;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** One System One question is one decision for classifier.dev quota purposes. */
export function typeSafeDecisionCount(body: string): number {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return 1;
    const questions = (parsed as Record<string, unknown>).questions;
    if (!questions || typeof questions !== "object" || Array.isArray(questions)) return 1;
    return Math.max(1, Object.keys(questions).length);
  } catch {
    // Let TypeSafe return its native validation response. Invalid requests are
    // still admitted as one decision so they cannot bypass the request limit.
    return 1;
  }
}

/** Forward one official TypeSafe SDK request using the service credential. */
export async function typeSafeCompatibleResponse(
  request: Request,
  apiKey: string | undefined,
  body?: string,
  meter?: Meter,
): Promise<Response> {
  if (!apiKey) {
    return Response.json(
      { error: "The TypeSafe-compatible endpoint is temporarily unavailable." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const incoming = new URL(request.url);
  const upstream = new URL(`${incoming.pathname}${incoming.search}`, TYPESAFE_ORIGIN);
  // Preserve SDK-supplied request options, including custom tracing headers,
  // while keeping the caller's credential, cookies and edge identity private.
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (!PRIVATE_REQUEST_HEADERS.test(name)) headers.append(name, value);
  }
  headers.set("authorization", `Bearer ${apiKey}`);

  // Only trusted account execution supplies this hook. Reserve the maximum
  // provider exposure before the paid request leaves the Worker.
  // The request itself remains untouched, so TypeSafe aliases retain their
  // native behavior; an unexpected future response model stays held for review.
  if (meter?.beforeCall && body) {
    let parsed;
    try { parsed = JSON.parse(body); } catch { throw new SpendingError(400, "invalid_request", "Send valid JSON."); }
    if (parsed.model && !["jev-latest", JEV_ACCOUNT_MODEL].includes(parsed.model)) throw new SpendingError(400, "unpriced_model", "This TypeSafe model is not configured for spending.");
    body = JSON.stringify({ ...parsed, model: JEV_ACCOUNT_MODEL });
  }
  await meter?.beforeCall?.("typesafe", JEV_ACCOUNT_MODEL, 0);

  let response: Response;
  try {
    response = await providerFetch(meter, "typesafe", JEV_ACCOUNT_MODEL, 0, upstream, {
      method: request.method,
      headers,
      body,
      signal: request.signal,
    });
  } catch {
    return Response.json(
      { error: "TypeSafe is temporarily unavailable." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }

  if (response.ok && meter) {
    const payload = object(await response.clone().json().catch(() => null));
    const usage = object(payload?.usage);
    const model = typeof payload?.model === "string" && payload.model ? payload.model : "";
    if (model) {
      addJevCost(meter, usage?.input_tokens);
      addTokens(meter, "typesafe", model, {
        inputTokens: usage?.input_tokens,
        outputTokens: usage?.output_tokens,
      });
    }
  }

  // Keep response metadata additive so future official SDK behavior does not
  // require a matching deploy here. API responses must never set browser state.
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("set-cookie");
  responseHeaders.set("cache-control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}
