import worker, { type Env } from "../index";
import { newMeter } from "../cost";
import { AppError, hashToken, now, type AppEnv } from "../server/db";
import rates from "../retail-rates.json";
import { parseTokenRateCard, priceTokens } from "../server/token-pricing";
import { refundTokenReservation, settleTokenReservation } from "../server/token-ledger";
import { Permit } from "../spending/permit";
import { boundedRequest } from "../spending";
import { SpendingError, errorResponse, fingerprint, policy } from "../spending/policy";
import { writeAccountAnalytics } from "../server/analytics/write";

const card = parseTokenRateCard(JSON.stringify(rates))!;
export async function spendingClassification(request: Request, env: AppEnv & Partial<Env>, source: "API" | "MCP", ctx: ExecutionContext): Promise<Response> {
  try {
    if (env.APP_ACCOUNTS_ENABLED !== "true") throw new AppError(503, "Account credentials are disabled.");
    request = await boundedRequest(request);
    const text = await request.clone().text();
    let body: Record<string, unknown>;
    try { body = JSON.parse(text); } catch { throw new AppError(400, "Send valid JSON."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new AppError(400, "Send a JSON object.");
    const inputs = body.inputs ?? body.items ?? body.input;
    const items = Array.isArray(inputs) ? inputs.length : 1;
    if (items < 1 || items > 10000) throw new AppError(400, "Invalid item count.");
    const limits = policy(env);
    const id = crypto.randomUUID();
    const idem = request.headers.get("idempotency-key");
    if (idem && idem.length > 200) throw new AppError(400, "Idempotency keys may contain at most 200 characters.");
    const keyHash = await hashToken(request.headers.get("authorization")!.replace(/^Bearer\s+/i, ""));
    const maxCredits = Math.ceil(limits.paidRequest / 10000);
    const quote = Math.min(maxCredits, Math.ceil(items * (body.tier === "smart" || body.messages || body.skill ? 300000 : 1500)));
    const result = await env.APP_DB.prepare(`WITH owner AS (
      SELECT a.id,a.balance,a.paid_balance,k.id AS agent_id FROM app_accounts a JOIN app_agents k ON k.account_id=a.id
      WHERE k.token_hash=? AND k.status IN ('pending','connected') AND NOT a.billing_hold FOR UPDATE OF a
    ), held AS (
      INSERT INTO app_usage(id,account_id,agent_id,items,credits,status,created_at,paid_credits,usage_type,metering_mode,idempotency_key)
      SELECT ?,id,agent_id,?,LEAST(balance,CASE WHEN paid_balance>0 THEN ?::bigint ELSE ?::bigint END),'pending',?,
        GREATEST(0,LEAST(balance,CASE WHEN paid_balance>0 THEN ?::bigint ELSE ?::bigint END)-(balance-paid_balance)),?,'tokens',?
      FROM owner WHERE balance>0 ON CONFLICT DO NOTHING RETURNING *
    ), debited AS (
      UPDATE app_accounts a SET balance=a.balance-h.credits,paid_balance=a.paid_balance-h.paid_credits
      FROM held h WHERE a.id=h.account_id RETURNING a.id
    ), agent AS (
      UPDATE app_agents a SET used=a.used+h.credits FROM held h,debited d WHERE a.id=h.agent_id AND d.id=h.account_id RETURNING a.id
    ) SELECT h.account_id,h.agent_id,h.credits,o.paid_balance>0 AS funded FROM held h JOIN owner o ON o.id=h.account_id JOIN agent k ON k.id=h.agent_id`)
      .bind(keyHash, id, items, quote, Math.ceil(limits.request / 10000), now(), quote, Math.ceil(limits.request / 10000), `${source} · Classification`, idem ? await fingerprint(env, `account-idempotency:${idem}`) : null)
      .first<{ account_id: string; agent_id: string; credits: number; funded: boolean }>();
    if (!result) throw new AppError(idem ? 409 : 402, idem ? "This idempotency key already exists, or the key has no available balance." : "The key is inactive or has no available balance.");
    const meter = newMeter();
    const permit = result.funded ? new Permit(limits.paidRequest, Date.now() + 90000, { card, credits: result.credits }) : undefined;
    if (permit) { meter.permit = permit; meter.beforeCall = async () => {}; }
    const started = Date.now();
    let response: Response;
    try {
      response = await worker.fetch(request, env as Env, ctx, { meter, account: { id: result.account_id, multiplier: result.funded ? 10 : 1 }, funded: result.funded });
      if (permit?.error) response = errorResponse(permit.error);
    } catch (error) {
      response = error instanceof SpendingError ? errorResponse(error) : Response.json({ error: "Classification failed." }, { status: 502 });
    }
    const settle = async () => {
      const actual = meter.permit;
      actual?.close();
      await actual?.drain();
      const tokens = actual?.tokens ?? [];
      const charge = actual?.unknown ? null : response.ok && tokens.length ? priceTokens(card, tokens) : { version: card.version, nanodollars: 0n };
      // Uncertain attempts remain held for reconciliation, even on an HTTP error.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (!actual || actual.used === 0) await refundTokenReservation(env.APP_DB, id);
          else await settleTokenReservation(env.APP_DB, id, charge);
          writeAccountAnalytics(env, { accountId: result.account_id, keyId: result.agent_id, requestId: id, source,
            tier: body.tier === "smart" ? "smart" : "fast", status: response.ok ? "success" : "error", items,
            inputTokens: tokens.every(t => t.inputTokens !== null) ? tokens.reduce((sum, t) => sum + t.inputTokens!, 0) : null,
            outputTokens: tokens.every(t => t.outputTokens !== null) ? tokens.reduce((sum, t) => sum + t.outputTokens!, 0) : null,
            cachedInputTokens: null, model: tokens.map(t => t.model).join(","), providerCostUsd: actual?.unknown ? null : (actual?.used ?? 0) / 1e9,
            retailCostUsd: charge ? Number(charge.nanodollars) / 1e9 : null, latencyMs: Date.now() - started, escalations: tokens.filter(t => t.provider === "openrouter").reduce((n, t) => n + t.calls, 0) });
          return;
        } catch { /* Durable pending funds remain unavailable until reconciliation. */ }
      }
    };
    ctx.waitUntil(settle());
    const headers = new Headers(response.headers);
    headers.set("x-request-id", id); headers.set("x-billing-status", "pending"); headers.set("cache-control", "no-store");
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    if (error instanceof SpendingError) return errorResponse(error);
    throw error;
  }
}
