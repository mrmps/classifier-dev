/**
 * Per-IP rate limiting in a Durable Object.
 *
 * KV cannot do this: its reads are edge-cached and eventually consistent, so a
 * counter written this second is invisible to the next request. Cloudflare's
 * native ratelimit binding registered but never decremented in testing. A DO is
 * single-threaded and strongly consistent, which is exactly what a counter needs.
 */
export class RateLimiter implements DurableObject {
  constructor(private state: DurableObjectState) {}

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit") ?? "60");
    const cost = Number(url.searchParams.get("cost") ?? "1");
    const minute = Math.floor(Date.now() / 60_000);

    let b = (await this.state.storage.get<{ m: number; n: number }>("b")) ?? { m: minute, n: 0 };
    if (b.m !== minute) b = { m: minute, n: 0 };

    if (b.n >= limit) {
      return Response.json({ limited: true, remaining: 0, resetIn: 60 - (Math.floor(Date.now() / 1000) % 60) });
    }
    b.n += cost;
    await this.state.storage.put("b", b);
    return Response.json({ limited: false, remaining: Math.max(0, limit - b.n) });
  }
}
