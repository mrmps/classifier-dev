/**
 * Per-IP rate limiting in a Durable Object.
 *
 * KV cannot do this: its reads are edge-cached and eventually consistent, so a
 * counter written this second is invisible to the next request. Cloudflare's
 * native ratelimit binding registered but never decremented in testing. A DO is
 * single-threaded and strongly consistent, which is exactly what a counter needs.
 */
import type { Counter } from "./admission";
export class RateLimiter implements DurableObject {
  constructor(private state: DurableObjectState, private env?: {QUOTAS?: DurableObjectNamespace}) {}

  async fetch(req: Request): Promise<Response> {
    // Do not hold the legacy input gate while forwarding: the destination may
    // need to recover its snapshot from this object after an interrupted import.
    const result = await this.state.blockConcurrencyWhile(() => this.local(req));
    if (result instanceof Response) return result;
    if (!this.env?.QUOTAS) throw new Error("Transferred quota is unavailable");
    const url = new URL(req.url);
    url.pathname = "/legacy";
    url.searchParams.set("scope", result.scope);
    url.searchParams.set("id", this.state.id.toString());
    return this.env.QUOTAS.get(this.env.QUOTAS.idFromString(result.target)).fetch(url.toString());
  }

  private async local(req: Request): Promise<Response | {target:string;scope:string}> {
    const requestUrl = new URL(req.url);
    if (requestUrl.pathname === "/transfer") {
      const target = await req.json() as {target:string;scope:string};
      if (!this.env?.QUOTAS || !target || !/^[a-f0-9]{64}$/.test(target.target) || !["fast","smart","laya:fast","laya:bulk"].includes(target.scope))
        return new Response("Invalid quota transfer", {status:400});
      const existing = await this.state.storage.get<typeof target>("forward");
      if (existing && (existing.target !== target.target || existing.scope !== target.scope))
        return new Response("Quota already transferred", {status:409});
      const now = Date.now();
      const counter: Counter = {
        b:await this.state.storage.get("b") ?? {m:Math.floor(now/60_000),n:0},
        d:await this.state.storage.get("d") ?? {d:Math.floor(now/86_400_000),n:0},
      };
      await this.state.storage.put("forward", target);
      return Response.json({transferred:true,counter});
    }
    const forward = await this.state.storage.get<{target:string;scope:string}>("forward");
    if (forward) return forward;
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
    // put() may resolve at the write buffer. Diagnostic calls explicitly await
    // the durability the output gate already requires before delivering a reply.
    if (url.searchParams.get("timing") === "1") await this.state.storage.sync();
    writeMs = performance.now() - writeStarted;
    return respond({
      limited: false,
      remaining: Math.max(0, limit - b.n),
      dailyRemaining: Math.max(0, daily - d.n),
    });
  }
}
