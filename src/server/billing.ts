import { maintainDemoCredits } from "./credit-period";
import { isDemoWorkspace, countWorkspaceSeats } from "./organizations";
import {
  FREE_ALLOWANCE_CREDITS,
  BILLING_PLANS,
  type BillingPlanId,
} from "../lib/billing";
import type { AppAction, BillingSnapshot } from "./contracts";
import { AppError, now, type AppEnv } from "./db";

type BillingAction = Extract<AppAction, { type: "billing-subscribe" }>;
/** Local subscription simulator. Production grants require verified provider events. */
export async function performBillingAction(
  accountId: string,
  action: BillingAction,
  env: AppEnv,
) {
  if (action.type !== "billing-subscribe")
    throw new AppError(
      403,
      "Only subscriptions are available. Top-ups and automatic purchases are disabled.",
    );
  if (!(await isDemoWorkspace(accountId, env)))
    throw new AppError(503, "Payments are not configured. No charge was made.");
  await maintainDemoCredits(accountId, env);
  const cap = BILLING_PLANS[action.plan].seatLimit;
  if (cap !== null && (await countWorkspaceSeats(accountId, env)) > cap)
    throw new AppError(
      409,
      `This plan includes ${cap} ${cap === 1 ? "seat" : "seats"}. Remove members or pending invitations before changing plans.`,
    );
  await changePlan(accountId, action.plan, action.idempotencyKey, env);
}

export async function billingSnapshot(
  accountId: string,
  env: AppEnv,
): Promise<BillingSnapshot> {
  const row = await env.APP_DB.prepare("SELECT * FROM app_accounts WHERE id=?")
    .bind(accountId)
    .first<{
      balance: number;
      paid_balance: number;
      billing_plan: BillingPlanId;
      scheduled_plan: BillingPlanId | null;
      cancel_at_period_end: number;
    }>();
  if (!row) throw new AppError(404, "Account not found.");
  const demo = await isDemoWorkspace(accountId, env);
  const { results } = await env.APP_DB.prepare(
    "SELECT id,kind,amount_cents,credits,created_at FROM app_transactions WHERE account_id=? ORDER BY created_at DESC LIMIT 100",
  )
    .bind(accountId)
    .all<{
      id: string;
      kind: "top_up" | "subscription" | "auto_top_up";
      amount_cents: number;
      credits: number;
      created_at: string;
    }>();
  return {
    availableCredits: row.balance,
    paidCredits: row.paid_balance,
    includedCredits: row.balance - row.paid_balance,
    plan: row.billing_plan,
    scheduledPlan: row.scheduled_plan,
    cancelAtPeriodEnd: !!row.cancel_at_period_end,
    mode: demo ? "demo" : env.APP_ACCOUNTS_ENABLED === "true" && env.AUTUMN_SECRET_KEY && env.AUTUMN_PRO_PLAN_ID ? "autumn" : "unconfigured",
    transactions: results.map((t) => ({
      id: t.id,
      kind: t.kind,
      amountCents: t.amount_cents,
      credits: t.credits,
      createdAt: t.created_at,
      status: demo ? "simulated" : "confirmed",
    })),
  };
}
export { FREE_ALLOWANCE_CREDITS };

/** One command owns a plan change. Paid upgrades add only the difference; downgrades wait. */
async function changePlan(
  accountId: string,
  target: BillingPlanId,
  idempotencyKey: string,
  env: AppEnv,
) {
  const previous = await env.APP_DB.prepare(
    "SELECT plan_id FROM app_billing_commands WHERE account_id=? AND idempotency_key=?",
  )
    .bind(accountId, idempotencyKey)
    .first<{ plan_id: string }>();
  if (previous) {
    if (previous.plan_id !== target)
      throw new AppError(
        409,
        "This plan-change attempt has different details. Start a new attempt.",
      );
    return;
  }
  const account = await env.APP_DB.prepare(
    "SELECT billing_plan,billing_revision FROM app_accounts WHERE id=?",
  )
    .bind(accountId)
    .first<{ billing_plan: BillingPlanId; billing_revision: number }>();
  if (!account) throw new AppError(404, "Account not found.");
  const current = BILLING_PLANS[account.billing_plan],
    next = BILLING_PLANS[target];
  if (!current || !next) throw new AppError(400, "Unknown plan.");
  const initial = current.id === "free" && next.id !== "free";
  const upgrade = next.priceCents > current.priceCents;
  const amount = upgrade ? next.priceCents - current.priceCents : 0;
  const grant = initial
    ? next.includedCredits
    : upgrade
      ? next.includedCredits - current.includedCredits
      : 0;
  const timestamp = now();
  const operationId = crypto.randomUUID();
  const command = env.APP_DB.prepare(
    `INSERT INTO app_billing_commands(account_id,idempotency_key,plan_id,created_at,operation_id)
    SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM app_accounts WHERE id=? AND billing_revision=?)
    AND NOT EXISTS(SELECT 1 FROM app_usage WHERE account_id=? AND status='pending')
    AND (SELECT COUNT(*) FROM app_memberships WHERE workspace_id=?)+(SELECT COUNT(*) FROM app_invitations WHERE workspace_id=? AND status='prepared')<=? ON CONFLICT DO NOTHING`,
  ).bind(
    accountId,
    idempotencyKey,
    target,
    timestamp,
    operationId,
    accountId,
    account.billing_revision,
    accountId,
    accountId,
    accountId,
    next.seatLimit ?? 2147483647,
  );
  const update = initial
    ? env.APP_DB.prepare(
        "UPDATE app_accounts SET billing_plan=?,scheduled_plan=NULL,cancel_at_period_end=0,balance=paid_balance+?,bonus_active=0,period_start=?,reset_at=?,billing_revision=billing_revision+1 WHERE id=? AND EXISTS(SELECT 1 FROM app_billing_commands WHERE operation_id=?)",
      ).bind(
        target,
        grant,
        timestamp,
        new Date(Date.now() + 30 * 86400000).toISOString(),
        accountId,
        operationId,
      )
    : upgrade
      ? env.APP_DB.prepare(
          "UPDATE app_accounts SET billing_plan=?,scheduled_plan=NULL,cancel_at_period_end=0,balance=balance+?,billing_revision=billing_revision+1 WHERE id=? AND EXISTS(SELECT 1 FROM app_billing_commands WHERE operation_id=?)",
        ).bind(target, grant, accountId, operationId)
      : env.APP_DB.prepare(
          "UPDATE app_accounts SET scheduled_plan=?,cancel_at_period_end=?,billing_revision=billing_revision+1 WHERE id=? AND EXISTS(SELECT 1 FROM app_billing_commands WHERE operation_id=?)",
        ).bind(
          target === current.id ? null : target,
          target === "free" && current.id !== "free" ? 1 : 0,
          accountId,
          operationId,
        );
  const statements = [command, update];
  if (upgrade)
    statements.push(
      env.APP_DB.prepare(
        "INSERT INTO app_transactions(id,account_id,idempotency_key,kind,amount_cents,credits,created_at,plan_id) SELECT ?,?,?,'subscription',?,?,?,? WHERE EXISTS(SELECT 1 FROM app_billing_commands WHERE operation_id=?)",
      ).bind(
        crypto.randomUUID(),
        accountId,
        `plan:${idempotencyKey}`,
        amount,
        grant,
        timestamp,
        target,
        operationId,
      ),
    );
  if (initial)
    statements.push(
      env.APP_DB.prepare(
        "UPDATE app_agents SET used=0 WHERE account_id=? AND EXISTS(SELECT 1 FROM app_billing_commands WHERE operation_id=?)",
      ).bind(accountId, operationId),
    );
  const result = await env.APP_DB.batch(statements);
  if (!result[0].meta.changes) {
    const duplicate = await env.APP_DB.prepare(
      "SELECT plan_id FROM app_billing_commands WHERE account_id=? AND idempotency_key=?",
    )
      .bind(accountId, idempotencyKey)
      .first<{ plan_id: string }>();
    if (duplicate?.plan_id === target) return;
    throw new AppError(
      409,
      "Your plan changed or a classification is still running. Refresh and try again.",
    );
  }
}
