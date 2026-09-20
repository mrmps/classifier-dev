import { billingSnapshot } from "./billing";
import { BILLING_PLANS, type BillingPlanId } from "../lib/billing";
import type { AppSnapshot, AgentStatus } from "./contracts";
import { AppError, type AppEnv } from "./db";
export async function getSnapshot(
  accountId: string,
  env: AppEnv,
): Promise<AppSnapshot> {
  const account = await env.APP_DB.prepare(
    "SELECT * FROM app_accounts WHERE id=?",
  )
    .bind(accountId)
    .first<{
      id: string;
      name: string;
      email: string;
      balance: number;
      billing_plan: BillingPlanId;
      bonus_granted: number;
      bonus_active: number;
      period_start: string;
      intent: "agent" | "api";
      reset_at: string;
    }>();
  if (!account) throw new AppError(404, "Account not found.");
  const workspace = await env.APP_DB.prepare(
    "SELECT kind FROM app_workspaces WHERE account_id=?",
  )
    .bind(accountId)
    .first<{ kind: string }>();
  const { results: agents } = await env.APP_DB.prepare(
    "SELECT id,name,client,status,used,last_used,prefix,created_at,encrypted_secret IS NOT NULL AS recoverable FROM app_agents WHERE account_id=? ORDER BY created_at DESC",
  )
    .bind(accountId)
    .all<{
      id: string;
      name: string;
      client: string;
      status: AgentStatus;
      used: number;
      last_used: string | null;
      prefix: string;
      created_at: string;
      recoverable: boolean;
    }>();
  return {
    billing: await billingSnapshot(accountId, env),
    usageAggregates: [],
    dailyUsage: [],
    usageTotals: { items: 0, credits: 0, requests: 0 },
    account: { id: account.id, name: account.name, email: account.email },
    credits: {
      balance: account.balance,
      included:
        account.billing_plan === "free" && workspace?.kind === "organization"
          ? 0
          : (BILLING_PLANS[account.billing_plan]?.includedCredits ?? 0),
      bonus: account.bonus_active,
      resetAt: account.reset_at,
    },
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      client: a.client,
      status: a.status,
      used: a.used,
      lastUsed: a.last_used,
    })),
    keys: agents.map((a) => ({
      id: a.id,
      name: a.name,
      prefix: a.prefix,
      recoverable: a.recoverable,
      createdAt: a.created_at,
      status: a.status,
    })),
    usage: [],
    onboarding: {
      intent: account.intent,
      client: agents.find((a) => a.client !== "API")?.client ?? null,
      completed: agents.some((a) => a.last_used !== null),
    },
  };
}
