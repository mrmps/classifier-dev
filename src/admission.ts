/** Shared tier/lane admission, with resumable transfer of the existing counters. */
export type Counter = { b: { m: number; n: number }; d: { d: number; n: number } };
export type Quota = { scope: string; id: string; cost: number; limit: number; daily: number };
export type AdmissionResult = { limited: boolean; remaining: number; dailyRemaining?: number;
  scope?: "minute" | "day"; resetIn?: number; limitedBy?: "tier" | "lane"; laneRemaining?: number };
type Env = { LIMITER: DurableObjectNamespace; QUOTAS: DurableObjectNamespace };
const scopes = new Set(["fast", "smart", "laya:fast", "laya:bulk"]);

export function validCounter(value: unknown): value is Counter {
  const v = value as Counter | undefined;
  return !!v && [v.b?.m, v.b?.n, v.d?.d, v.d?.n].every(n => Number.isSafeInteger(n) && n >= 0);
}

export class QuotaCoordinator implements DurableObject {
  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const started = performance.now();
    const url = new URL(request.url);
    let quotas: Quota[];
    if (url.pathname === "/legacy") {
      const q = url.searchParams;
      quotas = [{scope:q.get("scope")!, id:q.get("id") ?? "", cost:Number(q.get("cost") ?? 1),
        limit:Number(q.get("limit") ?? 60), daily:Number(q.get("daily") ?? 5000)}];
    } else {
      const body = await request.json() as { quotas?: Quota[] };
      quotas = body.quotas!;
    }
    if (!Array.isArray(quotas) || quotas.length < 1 || quotas.length > 2 ||
      quotas.some(q => !q || !scopes.has(q.scope) || !/^[a-f0-9]{64}$/.test(q.id) ||
        ![q.cost,q.limit,q.daily].every(n => Number.isSafeInteger(n) && n >= 0)) ||
      new Set(quotas.map(q => q.scope)).size !== quotas.length ||
      (quotas.length === 2 && (quotas[0].scope.startsWith("laya:") || !quotas[1].scope.startsWith("laya:")))) {
      return new Response("Invalid admission request", {status:400});
    }
    // Import and decisions share one input gate. A legacy object freezes before
    // returning its snapshot; retries can import that same snapshot after a crash.
    return this.state.blockConcurrencyWhile(async () => {
      const readStarted = performance.now();
      const counters: Record<string, Counter> = {};
      const imported: Record<string, Counter> = {};
      await Promise.all(quotas.map(async quota => {
        let counter = await this.state.storage.get<Counter>(quota.scope);
        if (!counter) {
          if (!quota.id) throw new Error("Quota transfer has not completed");
          const source = this.env.LIMITER.get(this.env.LIMITER.idFromString(quota.id));
          const transferred = await source.fetch("https://limiter/transfer?cost=0", {
            method:"POST", body:JSON.stringify({target:this.state.id.toString(), scope:quota.scope}),
          });
          const snapshot = await transferred.json() as { transferred?: boolean; counter?: Counter };
          if (!transferred.ok || snapshot.transferred !== true || !validCounter(snapshot.counter))
            throw new Error("Quota transfer is unavailable");
          counter = snapshot.counter;
          imported[quota.scope] = counter;
        }
        counters[quota.scope] = structuredClone(counter);
      }));
      // Both sources are frozen. One atomic snapshot write makes recovery
      // independent of which transfer completed first.
      if (Object.keys(imported).length) await this.state.storage.put(imported);
      const readMs = performance.now() - readStarted;
      const now = Date.now(), minute = Math.floor(now/60_000), day = Math.floor(now/86_400_000);
      const writes: Record<string, Counter> = {};
      let result: AdmissionResult = {limited:false, remaining:-1};
      for (const quota of quotas) {
        const counter = counters[quota.scope];
        if (counter.b.m !== minute) counter.b = {m:minute,n:0};
        if (counter.d.d !== day) counter.d = {d:day,n:0};
        const scope = counter.d.n+quota.cost > quota.daily ? "day" : counter.b.n+quota.cost > quota.limit ? "minute" : undefined;
        if (scope) {
          const window = scope === "day" ? 86_400_000 : 60_000;
          result = {limited:true,remaining:0,scope,limitedBy:quota.scope.startsWith("laya:") ? "lane" : "tier",
            resetIn:Math.ceil(((Math.floor(now/window)+1)*window-now)/1000)};
          break;
        }
        counter.b.n += quota.cost;
        counter.d.n += quota.cost;
        writes[quota.scope] = counter;
        const remaining = Math.max(0,quota.limit-counter.b.n);
        if (quota.scope.startsWith("laya:")) result.laneRemaining = remaining;
        else result.remaining = remaining;
        result.dailyRemaining = Math.max(0,quota.daily-counter.d.n);
      }
      // Preserve admission order: a tier refusal spends nothing; a lane refusal
      // retains the tier debit, just as the original two sequential calls did.
      const writeStarted = performance.now();
      if (Object.keys(writes).length) await this.state.storage.put(writes);
      if (url.searchParams.get("timing") === "1" && Object.keys(writes).length) await this.state.storage.sync();
      if (url.pathname === "/legacy" && quotas[0].scope.startsWith("laya:") && !result.limited)
        result.remaining = result.laneRemaining!;
      const response = Response.json(result);
      response.headers.set("server-timing", `handler;dur=${(performance.now()-started).toFixed(2)}, read;dur=${readMs.toFixed(2)}, write;dur=${(performance.now()-writeStarted).toFixed(2)}`);
      return response;
    });
  }
}

export async function admit(env: Env, owner: string, quotas: Omit<Quota,"id">[], timing = false) {
  const id = env.QUOTAS.idFromName(owner);
  const response = await env.QUOTAS.get(id).fetch(`https://quota/admit${timing ? "?timing=1" : ""}`, {
    method:"POST", body:JSON.stringify({quotas:quotas.map(q => ({...q,id:env.LIMITER.idFromName(`${q.scope}:${owner}`).toString()}))}),
  });
  if (!response.ok) throw new Error("Quota admission unavailable");
  return response;
}
