import { AppError, hashToken, now, parseCreditInteger, type AppEnv } from "./db";
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
  metadata?: { type?: string; meteringMode?: "credits" | "tokens"; reservationId?: string },
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
  const id = metadata?.reservationId ?? crypto.randomUUID();
  if (metadata?.reservationId) {
    const recover = async (): Promise<Reservation | null> => {
      const prior = await env.APP_DB.prepare("SELECT u.account_id,u.agent_id,u.credits,u.items,u.status,u.metering_mode,a.billing_plan FROM app_usage u JOIN app_accounts a ON a.id=u.account_id WHERE u.id=?")
        .bind(id).first<{ account_id: string; agent_id: string; credits: number; items: number; status: string; metering_mode: string; billing_plan: string }>();
      if (!prior) return null;
      if (prior.account_id !== agent.account_id || parseCreditInteger(String(prior.credits)) !== cost || prior.items !== itemCount ||
          prior.metering_mode !== meteringMode || prior.status !== "pending")
          throw new AppError(409, "This reservation cannot be reused. Start a new document job.");
      return { id, accountId: prior.account_id, agentId: prior.agent_id, cost, billingPlan: prior.billing_plan };
    };
    const prior = await recover();
    if (prior) return prior;
    // Debit only the row inserted by this statement, never an earlier hold
    // that committed after the recovery read (including a lost HTTP reply).
    const admitted = await env.APP_DB.batch([env.APP_DB.prepare(`WITH admitted AS (
      INSERT INTO app_usage(id,account_id,agent_id,items,credits,status,created_at,paid_credits,usage_type,metering_mode)
      SELECT ?,?,?,?,?, 'pending', ?,GREATEST(0,?-(balance-paid_balance)),?,?
      FROM app_accounts WHERE id=? AND balance>=? AND NOT billing_hold
        AND EXISTS(SELECT 1 FROM app_agents WHERE id=? AND account_id=? AND status IN ('pending','connected'))
      ON CONFLICT(id) DO NOTHING RETURNING id,paid_credits
    ), account_debit AS (
      UPDATE app_accounts SET balance=balance-?,paid_balance=paid_balance-admitted.paid_credits
      FROM admitted WHERE app_accounts.id=? RETURNING billing_plan
    ), agent_debit AS (
      UPDATE app_agents SET used=used+? FROM admitted WHERE app_agents.id=? RETURNING app_agents.id
    ) SELECT billing_plan FROM account_debit`).bind(id, agent.account_id, agent.id, itemCount, cost, now(), cost,
      metadata.type?.slice(0, 80) || "classification", meteringMode, agent.account_id, cost, agent.id, agent.account_id,
      cost, agent.account_id, cost, agent.id)]);
    const inserted = admitted[0].results[0] as { billing_plan: string } | undefined;
    if (inserted) return { id, accountId: agent.account_id, agentId: agent.id, cost, billingPlan: inserted.billing_plan };
    const concurrent = await recover();
    if (concurrent) return concurrent;
    throw new AppError(403, "Credential is paused or revoked, or the workspace balance is too low.");
  }
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
