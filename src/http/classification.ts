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

const card = parseTokenRateCard(JSON.stringify(rates))!;
const background = { waitUntil(promise: Promise<unknown>) { void promise.catch(() => {}); } } as ExecutionContext;

/** REST and MCP share real inference, exact pricing and provider-bounded holds. */
export async function accountClassification(request: Request, env: AppEnv & Partial<Env>, source: "API" | "MCP" = "API",
  ctx: ExecutionContext = background): Promise<Response | null> {
  if (!/^Bearer\s+classifier_agent_/i.test(request.headers.get("authorization") || "")) return null;
  if (request.method !== "POST" || !["/", "/v1/classify", "/v1/classify/batch"].includes(new URL(request.url).pathname))
    throw new AppError(400, "Account classification supports POST /v1/classify.");
  const accountId = await requireApiAccount(request, env);
  if (!env.TYPESAFE_API_KEY) throw new AppError(503, "Account inference is not configured.");
  if (Number(request.headers.get("content-length") || 0) > 1_000_000) throw new AppError(413, "Request is too large.");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 1_000_000) throw new AppError(413, "Request is too large.");
  let body: Record<string, unknown>;
  try { body = JSON.parse(text); } catch { throw new AppError(400, "Send valid JSON."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AppError(400, "Send a JSON object.");
  const inputs = body.inputs ?? body.items;
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 10_000 || inputs.some((input) => typeof input !== "string"))
    throw new AppError(400, "Provide a nonempty list of text inputs.");
  if (body.tier !== undefined && !["fast", "smart"].includes(String(body.tier))) throw new AppError(400, "Invalid classification tier.");
  const tier = body.tier === "smart" ? "smart" : "fast";
  const reservation = await authorizeAndReserve(request, env, 0, inputs.length, {
    type: `${source} · ${body.dimensions ? "Dimensions" : body.multi ? "Multi-label" : "Single-label"}`, meteringMode: "tokens",
  });
  if (!reservation) throw new AppError(401, "Missing account credential.");
  const plan = await env.APP_DB.prepare("SELECT billing_plan FROM app_accounts WHERE id=?").bind(accountId).first<{ billing_plan: string }>();
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
    status: success ? "success" : "error", items: inputs.length, ...tokens(),
    model: meter.tokens.map((row) => row.model).join(","), providerCostUsd: meter.tokens.length ? meter.usd : null,
    retailCostUsd, latencyMs: Date.now() - started,
    escalations: meter.tokens.filter((row) => row.provider === "openrouter").reduce((total, row) => total + row.calls, 0),
    content: { inputs, labels: body.labels, instructions: body.instructions },
  });
  let response: Response;
  try {
    response = await worker.fetch(new Request(request.url, { method: "POST", headers: request.headers, body: text }), env as Env, ctx,
      { account: { id: accountId, multiplier: plan?.billing_plan === "free" ? 1 : 10 }, meter });
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
      throw new AppError(503, "Classification completed but billing confirmation is pending. Contact support with the request ID.");
    }
    analytics(true, charge ? Number(charge.nanodollars) / 1e9 : null);
  }
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-request-id", reservation.id);
  headers.set("x-billing-status", response.ok ? (priceTokens(card, meter.tokens) ? "settled" : "review") : "refunded");
  return new Response(response.body, { status: response.status, headers });
}
