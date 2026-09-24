import { withResponsePricing } from "../classification-usage";
import { spendingClassification } from "./spending-classification";
import worker, { type Env } from "../index";
import { newMeter } from "../cost";
import rates from "../retail-rates.json";
import { AppError, type AppEnv } from "../server/db";
import { requireApiAccount } from "../server/account-access";
import { authorizeAndReserve } from "../server/usage";
import { parseTokenRateCard, priceTokens } from "../server/token-pricing";
import { extendTokenReservation, providerCallBound } from "../server/token-reservation";
import { refundTokenReservation, settleTokenReservation } from "../server/token-ledger";
import { writeAccountAnalytics } from "../server/analytics/write";
import { typeSafeDecisionCount } from "../typesafe-compat";
import { isLongContextRequest } from "../long-context";
import { documentRequest } from "./document";

const card = parseTokenRateCard(JSON.stringify(rates))!;
const background = { waitUntil(promise: Promise<unknown>) { void promise.catch(() => {}); } } as ExecutionContext;

/** REST and MCP share real inference, exact pricing and provider-bounded holds. */
export async function accountClassification(request: Request, env: AppEnv & Partial<Env>, source: "API" | "MCP" = "API",
  ctx: ExecutionContext = background): Promise<Response | null> {
  if (!/^Bearer\s+classifier_agent_/i.test(request.headers.get("authorization") || "")) return null;
  const path = new URL(request.url).pathname;
  const typeSafe = path === "/v1/systemone";
  const jobPath = /^\/v1\/long-context\/jobs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/(create|status|finish|cancel|parts\/\d+))?$/.exec(path);
  if (jobPath) {
    if (!env.LONG_CONTEXT_JOBS) throw new AppError(503, "Long-context jobs are unavailable.");
    return env.LONG_CONTEXT_JOBS.get(env.LONG_CONTEXT_JOBS.idFromName(jobPath[1])).fetch(request);
  }
  if (request.method === "POST" && ["/", "/v1/classify"].includes(path)) {
    const document = await documentRequest(request, env);
    if (document instanceof Response) return document;
    request = document;
  }
  if (request.method !== "POST" || !["/", "/v1/classify", "/v1/classify/batch", "/sandbox/classify", "/v1/sandbox/classify", "/v1/systemone"].includes(path)) return null;
  if (env.SPENDING_ENABLED === "true") return spendingClassification(request, env, source, ctx);
  const accountId = await requireApiAccount(request, env);
  if (Number(request.headers.get("content-length") || 0) > 1_000_000) throw new AppError(413, "Request is too large.");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 1_000_000) throw new AppError(413, "Request is too large.");
  let body: Record<string, unknown> = {};
  let itemCount: number;
  if (typeSafe) {
    itemCount = typeSafeDecisionCount(text);
  } else {
    try { body = JSON.parse(text); } catch { throw new AppError(400, "Send valid JSON."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new AppError(400, "Send a JSON object.");
    if (Object.hasOwn(body, "url") || isLongContextRequest(body)) return spendingClassification(
      new Request(request.url, { method: "POST", headers: request.headers, body: text }), env, source, ctx);
    const rawInputs = body.inputs ?? body.items ?? body.input;
    const inputs = typeof rawInputs === "string" ? [rawInputs] : rawInputs;
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > 10_000 || inputs.some((input) => typeof input !== "string"))
      throw new AppError(400, "Provide a nonempty list of text inputs.");
    itemCount = inputs.length;
    if (body.tier !== undefined && !["fast", "smart"].includes(String(body.tier))) throw new AppError(400, "Invalid classification tier.");
  }
  const tier = !typeSafe && body.tier === "smart" ? "smart" : "fast";
  const usageType = typeSafe ? "TypeSafe System One" : body.dimensions ? "Dimensions" : body.multi ? "Multi-label" : "Single-label";
  const reservation = await authorizeAndReserve(request, env, 0, itemCount, {
    type: `${source} · ${usageType}`, meteringMode: "tokens",
  });
  if (!reservation) throw new AppError(401, "Missing account credential.");
  const meter = newMeter();
  let admissionError: AppError | undefined;
  let reservationQueue = Promise.resolve();
  meter.beforeCall = (provider, model, maxOutput) => {
    const admission = reservationQueue.then(async () => {
      if (admissionError) throw admissionError;
      try { await extendTokenReservation(env.APP_DB, reservation.id, providerCallBound(card, provider, model, maxOutput)); }
      catch (error) {
        admissionError = error instanceof AppError ? error : new AppError(503, "Credit reservation is temporarily unavailable.");
        throw admissionError;
      }
    });
    reservationQueue = admission.catch(() => {});
    return admission;
  };
  const started = Date.now();
  const tokens = () => {
    const sum = (field: "inputTokens" | "outputTokens" | "cachedInputTokens") =>
      meter.tokens.length && meter.tokens.every((row) => row[field] !== null)
        ? meter.tokens.reduce((total, row) => total + row[field]!, 0) : null;
    return { inputTokens: sum("inputTokens"), outputTokens: sum("outputTokens"), cachedInputTokens: sum("cachedInputTokens") };
  };
  const analytics = (success: boolean, retailCostUsd: number | null) => writeAccountAnalytics(env, {
    accountId, keyId: reservation.agentId, requestId: reservation.id, source, tier,
    status: success ? "success" : "error", items: itemCount, ...tokens(),
    model: meter.tokens.map((row) => row.model).join(","), providerCostUsd: meter.tokens.length ? meter.usd : null,
    retailCostUsd, latencyMs: Date.now() - started,
    escalations: meter.tokens.filter((row) => row.provider === "openrouter").reduce((total, row) => total + row.calls, 0),
  });
  let response: Response;
  try {
    response = await worker.fetch(new Request(request.url, { method: "POST", headers: request.headers, body: text }), env as Env, ctx,
      { account: { id: accountId, multiplier: reservation.billingPlan === "free" ? 1 : 10 }, meter });
    await reservationQueue;
    if (admissionError) throw admissionError;
  } catch (error) {
    await reservationQueue;
    await refundTokenReservation(env.APP_DB, reservation.id);
    analytics(false, 0);
    if (error instanceof AppError) throw error;
    throw new AppError(502, "Classification failed. Your reserved balance was returned.");
  }
  if (!response.ok) {
    await refundTokenReservation(env.APP_DB, reservation.id);
    analytics(false, 0);
  } else {
    const charge = priceTokens(card, meter.tokens);
    // Failed settlement stays held: never refund a successful inference merely
    // because the database response was lost or provider usage was missing.
    try { await settleTokenReservation(env.APP_DB, reservation.id, charge, tokens()); }
    catch {
      analytics(true, null);
      return Response.json({
        error: "Classification completed but billing confirmation is pending. Contact support with the request ID.",
        requestId: reservation.id,
      }, { status: 503, headers: {
        "cache-control": "no-store", "x-request-id": reservation.id, "x-billing-status": "review",
      } });
    }
    analytics(true, charge ? Number(charge.nanodollars) / 1e9 : null);
  }
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-request-id", reservation.id);
  headers.set("x-billing-status", response.ok ? (priceTokens(card, meter.tokens) ? "settled" : "review") : "refunded");
  const resultResponse = new Response(response.body, { status: response.status, headers });
  const charge = priceTokens(card, meter.tokens);
  return response.ok && !typeSafe
    ? withResponsePricing(resultResponse, { currency: "USD", rate_version: card.version,
        total_usd: charge ? Number(charge.nanodollars) / 1e9 : null,
        billing_status: charge ? "settled" : "review",
        models: meter.tokens.map(row => {
          const rate = card.models.find(rate => rate.provider === row.provider && rate.model === row.model);
          return { provider: row.provider, model: row.model,
            input_usd_per_million: rate ? Number(rate.inputNanodollars) / 1000 : null,
            output_usd_per_million: rate ? Number(rate.outputNanodollars) / 1000 : null,
            cached_input_usd_per_million: rate ? Number(rate.cachedInputNanodollars) / 1000 : null };
        }),
      })
    : resultResponse;
}
