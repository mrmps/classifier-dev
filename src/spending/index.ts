import type { Meter } from "../cost";
import { Permit } from "./permit";
import { SpendingError, errorResponse, network, type SpendingEnv } from "./policy";
export { FreeBudget } from "./free-budget";
export type { SpendingEnv } from "./policy";

export async function withFreeSpending(request: Request, env: SpendingEnv, ctx: ExecutionContext, meter: Meter, execute: () => Promise<Response>, options: { tier: "fast" | "smart"; operator: boolean }): Promise<Response> {
  let hold: { id: string; amount: number; expires: number } | undefined;
  let admission: Promise<void> | undefined;
  const stub = () => {
    if (!env.FREE_BUDGET) throw new SpendingError(503, "spending_unavailable", "Free admission is unavailable.");
    return env.FREE_BUDGET.get(env.FREE_BUDGET.idFromName(options.operator ? "operator-spending" : "free-spending"), { locationHint: "wnam" });
  };
  meter.beforeCall = () => admission ??= (async () => {
    const ip = request.headers.get("cf-connecting-ip") ?? "";
    if (!options.operator) network(ip);
    const response = await stub().fetch("https://budget/reserve", { method: "POST", body: JSON.stringify({ ip, operator: options.operator, tier: options.tier, idempotency: request.headers.get("idempotency-key") ?? undefined }) });
    if (!response.ok) {
      const error = await response.json() as { error: string; code: string };
      throw new SpendingError(response.status, error.code, error.error, error);
    }
    hold = await response.json();
    meter.permit = new Permit(hold!.amount, hold!.expires);
  })();
  try {
    const result = await execute();
    if (meter.permit?.error && !(options.tier === "smart" && result.ok && meter.permit.error.code === "request_spending_limit"))
      return errorResponse(meter.permit.error);
    // Some inference paths translate thrown provider errors; preserve admission errors.
    if (admission) await admission;
    return result;
  } catch (error) {
    if (error instanceof SpendingError) return errorResponse(error);
    throw error;
  } finally {
    if (hold && meter.permit) {
      const permit = meter.permit, id = hold.id;
      permit.close();
      ctx.waitUntil((async () => {
        await permit.drain();
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const settled = await stub().fetch("https://budget/settle", { method: "POST", body: JSON.stringify({ id, used: permit.used }) });
            if (settled.ok) return;
          } catch { /* The durable hold remains charged when settlement is unavailable. */ }
        }
      })());
    }
  }
}
export async function boundedRequest(request: Request): Promise<Request> {
  if ((request.headers.get("idempotency-key")?.length ?? 0) > 200)
    throw new SpendingError(400, "invalid_request", "Idempotency-Key must contain at most 200 characters.");
  if (!request.body) return request;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1_000_000) { await reader.cancel(); throw new SpendingError(413, "payload_too_large", "The maximum request body is 1 MB."); }
    chunks.push(value);
  }
  const body = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return new Request(request, { body });
}
