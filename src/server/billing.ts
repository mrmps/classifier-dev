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
    }>();
  if (!row) throw new AppError(404, "Account not found.");
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
