import { addTokens, type Meter, type ModelTokenUsage } from "../cost";
import { modelPrice, SpendingError, type Provider } from "./policy";

export class Permit {
  used = 0;
  tokens: ModelTokenUsage[] = [];
  unknown = false;
  error?: SpendingError;
  private closed = false;
  close() { this.closed = true; }
  private pending = new Set<Promise<unknown>>();
  constructor(readonly amount: number, readonly expires: number) {}
  async drain() { while (this.pending.size) await Promise.allSettled([...this.pending]); }
  async fetch(provider: Provider, model: string, output: number, input: RequestInfo | URL, init: RequestInit): Promise<Response> {
    let bound: number;
    try {
      if (this.closed) throw new SpendingError(402, "request_finished", "The request allowance has closed.");
      if (this.error) throw this.error;
      const price = modelPrice(provider, model, output, typeof init.body === "string" ? init.body : undefined);
      bound = price.bound;
      while (this.used + bound > this.amount && this.pending.size && bound <= this.amount && !this.closed)
        await Promise.race([...this.pending].map(p => p.catch(() => {})));
      if (this.closed || Date.now() >= this.expires || this.used + bound > this.amount) throw new SpendingError(402, "request_spending_limit", "This request cannot fit another provider attempt within its allowance.", { limitUsd: this.amount / 1e9, spentOrReservedUsd: this.used / 1e9, requiredAttemptUsd: bound / 1e9 });
      if (provider === "openrouter") {
        const body = JSON.parse(String(init.body));
        body.provider = { ...body.provider, max_price: { prompt: price.input, completion: price.output }, require_parameters: true };
        init = { ...init, body: JSON.stringify(body) };
      }
    } catch (error) {
      this.error = error instanceof SpendingError ? error : new SpendingError(503, "spending_configuration", "Provider spending configuration is unavailable.");
      throw this.error;
    }
    this.used += bound;
    const execute = async () => {
      try {
        const response = await fetch(input, { ...init, signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
        if (response.headers.get("content-type")?.includes("text/event-stream")) {
          // Streaming callers report usage at EOF; no reservation is released here.
          return response;
        }
        const payload = await response.clone().json().catch(() => null) as Record<string, unknown> | null;
        const usage = payload?.usage as Record<string, unknown> | undefined;
        // TypeSafe rejects authentication/credit failures before inference.
        if (provider === "typesafe" && [401, 402, 403].includes(response.status) && payload?.detail && !usage) {
          this.used -= bound;
          return response;
        }
        const count = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
        const inputTokens = count(provider === "openrouter" ? usage?.prompt_tokens : usage?.input_tokens);
        const outputTokens = count(provider === "openrouter" ? usage?.completion_tokens : usage?.output_tokens);
        const reportedCost = provider === "openrouter" ? usage?.cost : inputTokens === null ? undefined : inputTokens * modelPrice(provider, model, output).input / 1e6;
        if (payload?.model === model && typeof reportedCost === "number" && Number.isFinite(reportedCost) && reportedCost >= 0 && Math.ceil(reportedCost * 1e9) <= bound) {
          this.used -= bound - Math.ceil(reportedCost * 1e9);
          const details = usage?.prompt_tokens_details as { cached_tokens?: unknown } | undefined;
          const meter = { usd: 0, tokens: this.tokens };
          addTokens(meter, provider, model, { inputTokens, outputTokens, cachedInputTokens: provider === "openrouter" ? count(details?.cached_tokens) ?? 0 : 0 });
        } else this.unknown = true;
        return response;
      } catch (error) { this.unknown = true; throw error; }
    };
    const promise = execute();
    this.pending.add(promise);
    try { return await promise; } finally { this.pending.delete(promise); }
  }
}
export function providerFetch(meter: Meter | undefined, provider: Provider, model: string, output: number, input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  return meter?.permit ? meter.permit.fetch(provider, model, output, input, init) : fetch(input, init);
}
