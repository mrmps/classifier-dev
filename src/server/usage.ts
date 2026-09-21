import { AppError, hashToken, now, type AppEnv } from "./db";
export interface Reservation {
  id: string;
  accountId: string;
  agentId: string;
  cost: number;
  billingPlan: string;
}
/** Serializable transaction: conditional ledger insertion, account and agent debit. */
export async function authorizeAndReserve(
  request: Request,
  env: AppEnv,
  cost: number,
  itemCount = cost,
  metadata?: { type?: string; meteringMode?: "credits" | "tokens" },
): Promise<Reservation | null> {
  const token =
    request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token.startsWith("classifier_agent_")) return null;
  if (env.APP_ACCOUNTS_ENABLED !== "true")
    throw new AppError(
      503,
      "Account credentials are not enabled for this deployment.",
    );
  const meteringMode = metadata?.meteringMode ?? "credits";
  if (
    !Number.isSafeInteger(cost) ||
    cost < (meteringMode === "tokens" ? 0 : 1) ||
    (meteringMode === "credits" && cost > 10000)
  )
    throw new AppError(400, "Invalid reservation amount.");
  if (
    !Number.isSafeInteger(itemCount) ||
    itemCount < 1 ||
    itemCount > 10000 ||
    (meteringMode === "credits" && itemCount > cost)
  )
    throw new AppError(400, "Invalid classification item count.");
  const agent = await env.APP_DB.prepare(
    "SELECT id,account_id FROM app_agents WHERE token_hash=?",
  )
    .bind(await hashToken(token))
    .first<{ id: string; account_id: string }>();
  if (!agent) throw new AppError(401, "Invalid agent credential.");
  const id = crypto.randomUUID();
  const results = await env.APP_DB.batch([
    env.APP_DB.prepare(
      "INSERT INTO app_usage(id,account_id,agent_id,items,credits,status,created_at,paid_credits,usage_type,metering_mode) SELECT ?,?,?,?,?,?,?,GREATEST(0,?-(balance-paid_balance)),?,? FROM app_accounts WHERE id=? AND balance>=? AND NOT billing_hold AND EXISTS(SELECT 1 FROM app_agents WHERE id=? AND account_id=? AND status IN ('pending','connected'))",
    ).bind(
      id,
      agent.account_id,
      agent.id,
      itemCount,
      cost,
      "pending",
      now(),
      cost,
      metadata?.type?.slice(0, 80) || "classification",
      meteringMode,
      agent.account_id,
      cost,
      agent.id,
      agent.account_id,
    ),
    env.APP_DB.prepare(
      "UPDATE app_accounts SET balance=balance-?,paid_balance=paid_balance-(SELECT paid_credits FROM app_usage WHERE id=?) WHERE id=? AND EXISTS(SELECT 1 FROM app_usage WHERE id=?) RETURNING billing_plan",
    ).bind(cost, id, agent.account_id, id),
    env.APP_DB.prepare(
      "UPDATE app_agents SET used=used+? WHERE id=? AND EXISTS(SELECT 1 FROM app_usage WHERE id=?)",
    ).bind(cost, agent.id, id),
  ]);
  if (!results[0].meta.changes)
    throw new AppError(
      403,
      "Credential is paused or revoked, or the workspace balance is too low.",
    );
  // Reuse the account row already locked by reservation instead of making
  // classification pay another database round trip to look up its plan.
  return { id, accountId: agent.account_id, agentId: agent.id, cost,
    billingPlan: results[1].results[0].billing_plan as string };
}
/** Idempotent settlement; failures restore both account and agent reservations. */
export async function completeReservation(
  r: Reservation,
  env: AppEnv,
  success: boolean,
  tokens?: { inputTokens: number | null; outputTokens: number | null },
): Promise<void> {
  if (success) {
    await env.APP_DB.batch([
      env.APP_DB.prepare(
        "UPDATE app_agents SET last_used=?,status=CASE WHEN status='pending' THEN 'connected' ELSE status END WHERE id=? AND EXISTS(SELECT 1 FROM app_usage WHERE id=? AND status='pending')",
      ).bind(now(), r.agentId, r.id),
      env.APP_DB.prepare(
        "UPDATE app_usage SET status='completed',input_tokens=?,output_tokens=? WHERE id=? AND status='pending'",
      ).bind(
        validTokenCount(tokens?.inputTokens),
        validTokenCount(tokens?.outputTokens),
        r.id,
      ),
    ]);
  } else {
    await env.APP_DB.batch([
      env.APP_DB.prepare(
        "UPDATE app_accounts SET balance=balance+?,paid_balance=paid_balance+(SELECT paid_credits FROM app_usage WHERE id=?) WHERE id=? AND EXISTS(SELECT 1 FROM app_usage WHERE id=? AND status='pending')",
      ).bind(r.cost, r.id, r.accountId, r.id),
      env.APP_DB.prepare(
        "UPDATE app_agents SET used=used-? WHERE id=? AND EXISTS(SELECT 1 FROM app_usage WHERE id=? AND status='pending')",
      ).bind(r.cost, r.agentId, r.id),
      env.APP_DB.prepare(
        "UPDATE app_usage SET status='refunded' WHERE id=? AND status='pending'",
      ).bind(r.id),
    ]);
  }
}

function validTokenCount(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}
