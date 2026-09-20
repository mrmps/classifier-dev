import { BILLING_PLANS, type BillingPlanId } from "../lib/billing";
import { isDemoWorkspace } from "./organizations";
import type { AppEnv } from "./db";

const PERIOD_MS = 30 * 86400000;
const RESERVATION_TIMEOUT_MS = 5 * 60000;

/** Local offer only. Production allowances remain owned by the billing integration. */
export async function maintainDemoCredits(
  accountId: string,
  env: AppEnv,
): Promise<void> {
  if (!(await isDemoWorkspace(accountId, env))) return;
  const timestamp = new Date().toISOString();
  const staleBefore = new Date(
    Date.now() - RESERVATION_TIMEOUT_MS,
  ).toISOString();
  // All three statements see one transaction. A late completion sees refunded and
  // cannot charge again, activate the connection, or grant a welcome bonus.
  await env.APP_DB.batch([
    env.APP_DB.prepare(
      `UPDATE app_accounts SET balance=balance+COALESCE((
      SELECT SUM(credits) FROM app_usage WHERE account_id=? AND status='pending' AND metering_mode='credits' AND created_at<?
    ),0),paid_balance=paid_balance+COALESCE((SELECT SUM(paid_credits) FROM app_usage WHERE account_id=? AND status='pending' AND metering_mode='credits' AND created_at<?),0) WHERE id=?`,
    ).bind(accountId, staleBefore, accountId, staleBefore, accountId),
    env.APP_DB.prepare(
      `UPDATE app_agents SET used=used-COALESCE((
      SELECT SUM(credits) FROM app_usage WHERE agent_id=app_agents.id AND status='pending' AND metering_mode='credits' AND created_at<?
    ),0) WHERE account_id=?`,
    ).bind(staleBefore, accountId),
    env.APP_DB.prepare(
      "UPDATE app_usage SET status='refunded' WHERE account_id=? AND status='pending' AND metering_mode='credits' AND created_at<?",
    ).bind(accountId, staleBefore),
  ]);
  const account = await env.APP_DB.prepare(
    "SELECT reset_at,billing_plan,scheduled_plan,billing_revision FROM app_accounts WHERE id=?",
  )
    .bind(accountId)
    .first<{
      reset_at: string;
      billing_plan: BillingPlanId;
      scheduled_plan: BillingPlanId | null;
      billing_revision: number;
    }>();
  if (!account || account.reset_at > timestamp) return;
  // Signup credit is a one-time grant, with no periodic free replenishment.
  if (account.billing_plan === "free" && !account.scheduled_plan) return;
  const nextPlan =
    BILLING_PLANS[account.scheduled_plan ?? account.billing_plan];
  if (!nextPlan) return;
  const oldReset = new Date(account.reset_at).getTime();
  const intervals = Math.floor((Date.now() - oldReset) / PERIOD_MS) + 1;
  const nextReset = new Date(oldReset + intervals * PERIOD_MS).toISOString();
  // Wait for live reservations to settle. This prevents a prior-period refund
  // from inflating the new allowance or reducing a freshly reset agent counter.
  await env.APP_DB.batch([
    env.APP_DB.prepare(
      `UPDATE app_agents SET used=0 WHERE account_id=? AND EXISTS(
      SELECT 1 FROM app_accounts WHERE id=? AND reset_at=? AND billing_revision=?
    ) AND NOT EXISTS(SELECT 1 FROM app_usage WHERE account_id=? AND status='pending')`,
    ).bind(
      accountId,
      accountId,
      account.reset_at,
      account.billing_revision,
      accountId,
    ),
    env.APP_DB.prepare(
      `INSERT INTO app_transactions(id,account_id,idempotency_key,kind,amount_cents,credits,created_at,plan_id)
       SELECT ?,id,?,'subscription',?,?,?,? FROM app_accounts WHERE id=? AND reset_at=? AND billing_revision=? AND ?>0
       AND NOT EXISTS(SELECT 1 FROM app_usage WHERE account_id=? AND status='pending') ON CONFLICT DO NOTHING`,
    ).bind(
      crypto.randomUUID(),
      `renew:${account.reset_at}`,
      nextPlan.priceCents,
      nextPlan.id === "free" ? 0 : nextPlan.includedCredits,
      timestamp,
      nextPlan.id,
      accountId,
      account.reset_at,
      account.billing_revision,
      nextPlan.priceCents,
      accountId,
    ),
    env.APP_DB.prepare(
      `UPDATE app_accounts SET balance=paid_balance+?,auto_top_up_enabled=0,billing_plan=?,scheduled_plan=NULL,cancel_at_period_end=0,bonus_active=0,period_start=?,reset_at=?,billing_revision=billing_revision+1
      WHERE id=? AND reset_at=? AND billing_revision=? AND NOT EXISTS(
      SELECT 1 FROM app_usage WHERE account_id=? AND status='pending')`,
    ).bind(
      nextPlan.id === "free" ? 0 : nextPlan.includedCredits,
      nextPlan.id,
      timestamp,
      nextReset,
      accountId,
      account.reset_at,
      account.billing_revision,
      accountId,
    ),
  ]);
}
