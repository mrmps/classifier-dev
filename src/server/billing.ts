import { FREE_ALLOWANCE_CREDITS, type BillingPlanId } from "../lib/billing";
import type { BillingSnapshot } from "./contracts";
import { AppError, type AppEnv } from "./db";

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
      auto_top_up_enabled: number;
      auto_top_up_amount_cents: number;
      auto_top_up_threshold_cents: number;
      auto_top_up_cap_cents: number;
    }>();
  if (!row) throw new AppError(404, "Account not found.");
  const month = new Date().toISOString().slice(0, 7);
  const autoTopUpMonth = await env.APP_DB.prepare(
    "SELECT COALESCE(SUM(amount_cents),0) AS used FROM app_auto_topup_attempts WHERE account_id=? AND month=? AND status IN ('pending','charged')",
  ).bind(accountId, month).first<{ used: number }>();
  const lastAttempt = await env.APP_DB.prepare(
    "SELECT status,reason,created_at FROM app_auto_topup_attempts WHERE account_id=? ORDER BY created_at DESC LIMIT 1",
  ).bind(accountId).first<{ status: string; reason: string | null; created_at: string }>();
  const lastFailure = lastAttempt?.status === "failed" ? lastAttempt : null;
  const complimentary = row.billing_plan === "pro"
    ? await env.APP_DB.prepare("SELECT ends_at FROM app_complimentary_pro WHERE account_id=? AND starts_at<=? AND ends_at>?")
      .bind(accountId, new Date().toISOString(), new Date().toISOString()).first<{ ends_at: string }>()
    : null;

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
    complimentaryUntil: complimentary?.ends_at ?? null,
    mode:
      env.APP_ACCOUNTS_ENABLED === "true" &&
      env.AUTUMN_SECRET_KEY &&
      env.AUTUMN_PRO_PLAN_ID
        ? "autumn"
        : "unconfigured",
    payAsYouGo:
      env.APP_ACCOUNTS_ENABLED === "true" &&
      !!env.AUTUMN_SECRET_KEY &&
      !!env.AUTUMN_TOPUP_PLAN_ID,
    autoTopUp: {
      enabled: !!row.auto_top_up_enabled,
      amountCents: row.auto_top_up_amount_cents,
      thresholdCents: row.auto_top_up_threshold_cents,
      capCents: row.auto_top_up_cap_cents,
      monthUsedCents: autoTopUpMonth?.used ?? 0,
      lastFailure: lastFailure
        ? { reason: lastFailure.reason ?? "unknown", at: lastFailure.created_at }
        : null,
    },
    transactions: results.map((transaction) => ({
      id: transaction.id,
      kind: transaction.kind,
      amountCents: transaction.amount_cents,
      credits: transaction.credits,
      createdAt: transaction.created_at,
      status: "confirmed",
    })),
  };
}

export { FREE_ALLOWANCE_CREDITS };
