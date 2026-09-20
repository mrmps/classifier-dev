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
    const handlerStarted = performance.now();
    let readMs = 0, writeMs = 0;
    const respond = (body: Record<string, unknown>) => {
      const response = Response.json(body);
      // Local execution only. Runtime delivery/output-gate delay after this
      // point is not included; callers separately measure the complete RPC.
      const duration = (ms: number) => Math.max(0, ms).toFixed(2);
      response.headers.set("server-timing", `handler;dur=${duration(performance.now() - handlerStarted)}, read;dur=${duration(readMs)}, write;dur=${duration(writeMs)}`);
      return response;
    };
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit") ?? "60");
    const daily = Number(url.searchParams.get("daily") ?? "5000");
    const cost = Number(url.searchParams.get("cost") ?? "1");
    const now = Date.now();
    const minute = Math.floor(now / 60_000);
    const day = Math.floor(now / 86_400_000);

    const readStarted = performance.now();
    let b = (await this.state.storage.get<{ m: number; n: number }>("b")) ?? { m: minute, n: 0 };
    if (b.m !== minute) b = { m: minute, n: 0 };

    let d = (await this.state.storage.get<{ d: number; n: number }>("d")) ?? { d: day, n: 0 };
    readMs = performance.now() - readStarted;
    if (d.d !== day) d = { d: day, n: 0 };

    if (d.n + cost > daily) {
      return respond({ limited: true, scope: "day", remaining: 0, resetIn: Math.ceil(((day + 1) * 86_400_000 - now) / 1000) });
    }
    if (b.n + cost > limit) {
      return respond({
        limited: true,
        scope: "minute",
        remaining: 0,
        resetIn: Math.ceil(((minute + 1) * 60_000 - now) / 1000),
      });
    }
    b.n += cost;
    d.n += cost;
    const writeStarted = performance.now();
    await this.state.storage.put({ b, d });
    writeMs = performance.now() - writeStarted;
    return respond({
      limited: false,
      remaining: Math.max(0, limit - b.n),
      dailyRemaining: Math.max(0, daily - d.n),
    });
  }
}
