import { classificationPricing, withResponsePricing } from "../classification-usage";
import worker, { type Env } from "../index";
import { newMeter } from "../cost";
import { AppError, hashToken, now, type AppEnv } from "../server/db";
import { classificationCharge, classificationInputTokens, longContextCharge } from "../lib/classification-pricing";
import { isLongContextRequest, longContextInputTokens, LongContextError, LONG_CONTEXT_MAX_INPUTS, LONG_CONTEXT_MAX_DECISIONS, LONG_CONTEXT_MAX_TOKENS } from "../long-context";
import { refundTokenReservation, settleTokenReservation } from "../server/token-ledger";
import { Permit } from "../spending/permit";
import { boundedRequest } from "../spending";
import { SpendingError, errorResponse, fingerprint, policy } from "../spending/policy";
import { writeAccountAnalytics } from "../server/analytics/write";
import { typeSafeDecisionCount } from "../typesafe-compat";

export async function spendingClassification(request: Request, env: AppEnv & Partial<Env>, source: "API" | "MCP", ctx: ExecutionContext): Promise<Response> {
  try {
    if (env.APP_ACCOUNTS_ENABLED !== "true") throw new AppError(503, "Account credentials are disabled.");
    request = await boundedRequest(request);
    const text = await request.clone().text();
    let body: Record<string, unknown>;
    try { body = JSON.parse(text); } catch { throw new AppError(400, "Send valid JSON."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new AppError(400, "Send a JSON object.");
    const longContext = new URL(request.url).pathname !== "/v1/systemone" && isLongContextRequest(body);
    if (longContext) {
      if (["inputs", "items", "input"].filter(key => Object.hasOwn(body, key)).length > 1)
        throw new SpendingError(400, "invalid_request", "Use only one of inputs, items or input for long context.");
      if (Object.hasOwn(body, "items") && !Object.hasOwn(body, "dimensions"))
        throw new SpendingError(400, "invalid_request", "items requires dimensions; use input or inputs for label classification.");
    }
    const inputs = body.inputs ?? body.items ?? body.input;
    const items = new URL(request.url).pathname === "/v1/systemone" ? typeSafeDecisionCount(text) : Array.isArray(inputs) ? inputs.length : 1;
    if (items < 1 || items > 10000) throw new AppError(400, "Invalid item count.");
    const limits = policy(env);
    const id = crypto.randomUUID();
    const idem = request.headers.get("idempotency-key");
    if (idem && idem.length > 200) throw new AppError(400, "Idempotency keys may contain at most 200 characters.");
    const keyHash = await hashToken(request.headers.get("authorization")!.replace(/^Bearer\s+/i, ""));
    const maxCredits = Math.ceil(limits.paidRequest / 10000);
    const decisions = items * (body.dimensions && typeof body.dimensions === "object" ? Math.max(1, Object.keys(body.dimensions).length) : 1);
    let contextTokens: number | undefined;
    if (longContext) {
      const documents = typeof inputs === "string" ? [inputs] : inputs;
      if (!Array.isArray(documents) || !documents.length || documents.some(input => typeof input !== "string" || !input.trim()))
        throw new SpendingError(400, "long_context_input", "Long context requires nonempty text inputs.");
      if (documents.length > LONG_CONTEXT_MAX_INPUTS)
        throw new SpendingError(400, "too_many_inputs", `Long context supports at most ${LONG_CONTEXT_MAX_INPUTS} inputs per request.`);
      if (decisions > LONG_CONTEXT_MAX_DECISIONS)
        throw new SpendingError(400, "too_many_decisions", `Long context supports at most ${LONG_CONTEXT_MAX_DECISIONS} decisions per request.`);
      if (body.tier === "smart") throw new SpendingError(400, "bad_tier", "Long context supports the fast tier only.");
      let count: number;
      try { count = longContextInputTokens(documents); }
      catch (error) {
        if (error instanceof LongContextError) throw new SpendingError(error.status, error.code, error.message);
        throw error;
      }
      if (count > LONG_CONTEXT_MAX_TOKENS)
        throw new SpendingError(400, "long_context_too_large", `Long context supports at most ${LONG_CONTEXT_MAX_TOKENS.toLocaleString("en-US")} original context tokens per request.`);
      contextTokens = count;
    }
    const trial = body.model === "laya" || body.model === "kev" || body.model === "chunklaya" || body.model === "dgemma";
    const quotedCharge = contextTokens !== undefined ? longContextCharge(contextTokens)
      : classificationCharge(trial ? 0 : 65536 * decisions, body.tier === "smart" ? decisions : 0);
    const quote = Number((quotedCharge.nanodollars + 9999n) / 10000n);
    if (quote > maxCredits) throw new SpendingError(402, "request_spending_limit", "This request exceeds the workspace request allowance. Split the batch.");
    const idempotencyHash = idem ? await fingerprint(env, `account-idempotency:${idem}`) : null;
    const result = await env.APP_DB.prepare(`WITH owner AS (
      SELECT a.id,a.balance,a.paid_balance,(a.paid_balance>0 OR (a.billing_plan IN ('pro','max','scale') AND a.reset_at::timestamptz>now())) AS funded,k.id AS agent_id FROM app_accounts a JOIN app_agents k ON k.account_id=a.id
      WHERE k.token_hash=? AND k.status IN ('pending','connected') AND NOT a.billing_hold FOR UPDATE OF a
    ), held AS (
      INSERT INTO app_usage(id,account_id,agent_id,items,credits,status,created_at,paid_credits,usage_type,metering_mode,idempotency_key,classifications)
      SELECT ?,id,agent_id,?,?::bigint,'pending',?,
        GREATEST(0,?::bigint-(balance-paid_balance)),?,'tokens',?,?
      FROM owner WHERE balance>0 AND (funded OR balance>=?) AND (NOT ?::boolean OR funded) ON CONFLICT DO NOTHING RETURNING *
    ), debited AS (
      UPDATE app_accounts a SET balance=a.balance-h.credits,paid_balance=a.paid_balance-h.paid_credits
      FROM held h WHERE a.id=h.account_id RETURNING a.id
    ), agent AS (
      UPDATE app_agents a SET used=a.used+h.credits FROM held h,debited d WHERE a.id=h.agent_id AND d.id=h.account_id RETURNING a.id
    ) SELECT h.account_id,h.agent_id,h.credits,o.funded FROM held h JOIN owner o ON o.id=h.account_id JOIN agent k ON k.id=h.agent_id`)
      .bind(keyHash, id, items, quote, now(), quote, `${source} · Classification`, idempotencyHash, decisions, quote, longContext)
      .first<{ account_id: string; agent_id: string; credits: number; funded: boolean }>();
    if (!result) {
      const reason = await env.APP_DB.prepare(`SELECT k.status,a.billing_hold,
        (a.paid_balance>0 OR (a.billing_plan IN ('pro','max','scale') AND a.reset_at::timestamptz>now())) AS funded,
        (SELECT id FROM app_usage WHERE account_id=a.id AND idempotency_key=?) AS request_id
        FROM app_agents k JOIN app_accounts a ON a.id=k.account_id WHERE k.token_hash=?`)
        .bind(idempotencyHash, keyHash).first<{ status: string; billing_hold: boolean; funded: boolean; request_id: string | null }>();
      if (!reason) throw new SpendingError(401, "invalid_api_key", "This workspace API key is not valid.");
      if (!["pending", "connected"].includes(reason.status)) throw new SpendingError(403, "inactive_api_key", "This workspace API key is paused or revoked.");
      if (reason.request_id) throw new SpendingError(409, "duplicate_request", "This workspace already admitted the idempotency key.", { requestId: reason.request_id });
      if (longContext && !reason.funded) throw new SpendingError(402, "long_context_payment_required", "Long context requires a funded workspace: add paid credits or use an active paid subscription. Signup credit alone does not qualify.");
      throw new SpendingError(402, "insufficient_balance", reason.billing_hold ? "Workspace billing is awaiting review; funds remain held." : "The workspace cannot fund a new request. Add funds to clear any debt or cover the free-credit reservation, or wait for in-flight reservations to settle.", { reservationUsd: quote / 100000 });
    }
    const meter = newMeter();
    const permit = result.funded ? new Permit(limits.paidRequest, Date.now() + 90000) : undefined;
    if (permit) { meter.permit = permit; meter.beforeCall = async () => {}; }
    const started = Date.now();
    let response: Response;
    try {
      response = await worker.fetch(request, env as Env, ctx, { meter, account: { id: result.account_id, multiplier: result.funded ? 10 : 1 }, funded: result.funded });
      if (permit?.error && !(response.ok && permit.error.code === "request_spending_limit")) response = errorResponse(permit.error);
    } catch (error) {
      response = error instanceof SpendingError ? errorResponse(error) : Response.json({ error: "Classification failed." }, { status: 502 });
    }
    const payload = response.ok ? await response.clone().json().catch(() => null) as { usage?: { escalated?: unknown } } | null : null;
    const escalations = longContext || new URL(request.url).pathname === "/v1/systemone" ? 0 : payload?.usage?.escalated;
    const inputTokens = contextTokens ?? (trial ? 0 : classificationInputTokens(meter.tokens));
    const charge = response.ok && inputTokens !== null && typeof escalations === "number" && Number.isSafeInteger(escalations) && escalations >= 0 && escalations <= decisions
      ? contextTokens !== undefined ? longContextCharge(contextTokens) : classificationCharge(inputTokens, escalations) : null;
    const settle = async () => {
      const actual = meter.permit;
      actual?.close();
      await actual?.drain();
      const tokens = actual?.tokens ?? [];
      const upstreamInputTokens = tokens.length && tokens.every(t => t.inputTokens !== null)
        ? tokens.reduce((sum, t) => sum + t.inputTokens!, 0) : null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (!response.ok || (!longContext && (!actual || actual.used === 0))) await refundTokenReservation(env.APP_DB, id);
          else await settleTokenReservation(env.APP_DB, id, charge, {
            inputTokens: longContext ? upstreamInputTokens : inputTokens,
            outputTokens: tokens.length && tokens.every(t => t.outputTokens !== null) ? tokens.reduce((sum, t) => sum + t.outputTokens!, 0) : null,
          });
          if (charge !== null) await env.APP_DB.prepare("UPDATE app_usage SET escalations=? WHERE id=? AND status='completed'").bind(escalations, id).run();
          writeAccountAnalytics(env, { accountId: result.account_id, keyId: result.agent_id, requestId: id, source,
            tier: body.tier === "smart" ? "smart" : "fast", status: response.ok ? "success" : "error", items,
            inputTokens: longContext ? upstreamInputTokens : inputTokens, longContext: meter.longContext,
            outputTokens: tokens.every(t => t.outputTokens !== null) ? tokens.reduce((sum, t) => sum + t.outputTokens!, 0) : null,
            cachedInputTokens: null, model: tokens.map(t => t.model).join(","), providerCostUsd: actual?.unknown ? null : (actual?.used ?? 0) / 1e9,
            retailCostUsd: !response.ok ? 0 : charge ? Number(charge.nanodollars) / 1e9 : null, latencyMs: Date.now() - started, escalations: typeof escalations === "number" ? escalations : 0 });
          return;
        } catch { /* Durable pending funds remain unavailable until reconciliation. */ }
      }
    };
    ctx.waitUntil(settle());
    const headers = new Headers(response.headers);
    if (charge) {
      headers.set("x-billed-input-tokens", String(inputTokens));
      headers.set("x-smart-escalations", String(escalations));
      headers.set("x-usage-cost-usd", (Number(charge.nanodollars) / 1e9).toFixed(9));
    }
    headers.set("x-request-id", id); headers.set("x-billing-status", "pending"); headers.set("cache-control", "no-store");
    const resultResponse = new Response(response.body, { status: response.status, headers });
    return response.ok && new URL(request.url).pathname !== "/v1/systemone"
      ? withResponsePricing(resultResponse, {
          ...classificationPricing(meter, typeof escalations === "number" ? escalations : 0, contextTokens),
          total_usd: charge ? Number(charge.nanodollars) / 1e9 : null,
          billing_status: "pending",
        })
      : resultResponse;
  } catch (error) {
    if (error instanceof SpendingError) return errorResponse(error);
    throw error;
  }
}
