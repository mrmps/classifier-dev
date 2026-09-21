/**
 * Wire-compatible TypeSafe API surface.
 *
 * The official clients already own request construction, validation and
 * response decoding. Keeping this adapter as a transparent pass-through means
 * new question fields and model aliases continue to work without a second,
 * subtly different implementation in classifier.dev.
 */

const TYPESAFE_ORIGIN = "https://api.typesafe.ai";
const PRIVATE_REQUEST_HEADERS = /^(authorization|cookie|host|content-length|connection|forwarded|cf-|x-forwarded-|x-real-ip$|true-client-ip$|fly-client-ip$)/i;

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

  let response: Response;
  try {
    response = await fetch(upstream, {
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
