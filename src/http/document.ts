import type { Env } from "../index";
import { countContextTokens, LONG_CONTEXT_MAX_TOKENS, LONG_CONTEXT_THRESHOLD } from "../long-context";
import { AppError } from "../server/db";

export const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JSON_REQUEST_BYTES = 1_000_000;

/** Keep the ordinary API synchronous. Larger single documents are forwarded
 * as a stream; the caller sends the same JSON once and receives a job URL. */
export async function documentRequest(request: Request, env: Partial<Env>): Promise<Request | Response> {
  let asynchronous = /(?:^|,)\s*respond-async(?:\s|,|$)/i.test(request.headers.get("prefer") ?? "") ||
    request.headers.get("content-type")?.startsWith("text/plain") ||
    Number(request.headers.get("content-length")) > JSON_REQUEST_BYTES;
  if (!asynchronous && request.body) {
    const reader = request.body.getReader();
    const prefix: Uint8Array[] = [];
    let size = 0, complete = false;
    while (size <= JSON_REQUEST_BYTES) {
      const next = await reader.read();
      if (next.done) { complete = true; break; }
      prefix.push(next.value); size += next.value.byteLength;
    }
    if (complete) {
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of prefix) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      try {
        const body = JSON.parse(new TextDecoder().decode(bytes));
        const inputs = body.input ?? body.inputs ?? body.items;
        const input = typeof inputs === "string" ? inputs : Array.isArray(inputs) && inputs.length === 1 ? inputs[0] : null;
        if ((body.model === undefined || body.model === "jev") && typeof input === "string" && input.length > LONG_CONTEXT_THRESHOLD)
          asynchronous = countContextTokens(input) > LONG_CONTEXT_MAX_TOKENS;
      } catch { /* Ordinary validation owns malformed small requests. */ }
      request = new Request(request, { body: bytes });
    } else {
      asynchronous = true;
      let index = 0;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (index < prefix.length) { controller.enqueue(prefix[index++]); return; }
          const next = await reader.read();
          if (next.done) controller.close(); else controller.enqueue(next.value);
        },
        cancel(reason) { return reader.cancel(reason); },
      });
      request = new Request(request, { body: stream });
    }
  }
  if (!asynchronous) return request;
  if (!env.LONG_CONTEXT_JOBS) throw new AppError(503, "Long-context jobs are unavailable.");
  const supplied = request.headers.get("idempotency-key");
  if (supplied && !JOB_ID_PATTERN.test(supplied)) throw new AppError(400, "Use a UUID for the document Idempotency-Key.");
  const id = supplied?.toLowerCase() ?? crypto.randomUUID();
  const url = new URL(request.url);
  url.pathname = `/v1/long-context/jobs/${id}/upload`;
  return env.LONG_CONTEXT_JOBS.get(env.LONG_CONTEXT_JOBS.idFromName(id)).fetch(new Request(url, request));
}
