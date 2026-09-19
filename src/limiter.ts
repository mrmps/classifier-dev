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
    const daily = Number(url.searchParams.get("daily") ?? "5000");
    const cost = Number(url.searchParams.get("cost") ?? "1");
    const now = Date.now();
    const minute = Math.floor(now / 60_000);
    const day = Math.floor(now / 86_400_000);

    let b = (await this.state.storage.get<{ m: number; n: number }>("b")) ?? { m: minute, n: 0 };
    if (b.m !== minute) b = { m: minute, n: 0 };

    let d = (await this.state.storage.get<{ d: number; n: number }>("d")) ?? { d: day, n: 0 };
    if (d.d !== day) d = { d: day, n: 0 };

    if (d.n + cost > daily) {
      return Response.json({ limited: true, scope: "day", remaining: 0, resetIn: Math.ceil(((day + 1) * 86_400_000 - now) / 1000) });
    }
    if (b.n + cost > limit) {
      return Response.json({
        limited: true,
        scope: "minute",
        remaining: 0,
        resetIn: Math.ceil(((minute + 1) * 60_000 - now) / 1000),
      });
    }
    b.n += cost;
    d.n += cost;
    await this.state.storage.put({ b, d });
    return Response.json({
      limited: false,
      remaining: Math.max(0, limit - b.n),
      dailyRemaining: Math.max(0, daily - d.n),
    });
  }
}
