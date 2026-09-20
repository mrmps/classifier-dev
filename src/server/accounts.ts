import { isDemoWorkspace } from "./organizations";
import { billingSnapshot } from "./billing";
import { BILLING_PLANS, type BillingPlanId } from "../lib/billing";
import { maintainDemoCredits } from "./credit-period";
import type { AppSnapshot, AgentStatus, UsageAggregate } from "./contracts";
import { AppError, type AppEnv } from "./db";
export async function getSnapshot(
  accountId: string,
  env: AppEnv,
): Promise<AppSnapshot> {
  await maintainDemoCredits(accountId, env);
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
  const demo = await isDemoWorkspace(accountId, env);
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
  // Demo fixtures use PostgreSQL. Hosted analytics are loaded on demand from AE,
  // never by scanning the financial ledger during every dashboard action.
  const { results: usage } = demo
    ? await env.APP_DB.prepare(
        "SELECT u.id,u.created_at,u.items,u.credits,u.status,u.agent_id,u.usage_type,u.input_tokens,u.output_tokens,a.name FROM app_usage u JOIN app_agents a ON a.id=u.agent_id WHERE u.account_id=? AND u.created_at>=? ORDER BY u.created_at DESC LIMIT 100",
      )
        .bind(
          accountId,
          new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10),
        )
        .all<{
          id: string;
          created_at: string;
          items: number;
          credits: number;
          status: string;
          name: string;
          agent_id: string;
          usage_type: string;
          input_tokens: number | null;
          output_tokens: number | null;
        }>()
    : { results: [] };
  const totals = demo
    ? await env.APP_DB.prepare(
        "SELECT COALESCE(SUM(items),0) AS items,COALESCE(SUM(credits),0) AS credits,COUNT(*) AS requests FROM app_usage WHERE account_id=? AND created_at>=? AND status='completed'",
      )
        .bind(accountId, account.period_start)
        .first<{ items: number; credits: number; requests: number }>()
    : null;
  const { results: dailyUsage } = demo
    ? await env.APP_DB.prepare(
        "SELECT substr(created_at,1,10) AS day,SUM(items) AS items,SUM(credits) AS credits,COUNT(*) AS requests FROM app_usage WHERE account_id=? AND created_at>=? AND status='completed' GROUP BY substr(created_at,1,10) ORDER BY day",
      )
        .bind(
          accountId,
          new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
        )
        .all<{
          day: string;
          items: number;
          credits: number;
          requests: number;
        }>()
    : { results: [] };
  const { results: usageAggregates } = demo
    ? await env.APP_DB.prepare(
        `SELECT substr(u.created_at,1,10) AS day,
    substr(u.created_at,1,13)||':00:00Z' AS hour,u.agent_id AS "keyId",a.name AS "keyName",u.usage_type AS type,
    SUM(u.items) AS items,SUM(u.credits) AS credits,COUNT(*) AS requests,
    CASE WHEN COUNT(u.input_tokens)=COUNT(*) THEN SUM(u.input_tokens) ELSE NULL END AS "inputTokens",
    CASE WHEN COUNT(u.output_tokens)=COUNT(*) THEN SUM(u.output_tokens) ELSE NULL END AS "outputTokens"
    FROM app_usage u JOIN app_agents a ON a.id=u.agent_id WHERE u.account_id=? AND u.created_at>=? AND u.status='completed'
    GROUP BY day,hour,u.agent_id,a.name,u.usage_type ORDER BY hour`,
      )
        .bind(
          accountId,
          new Date(Date.now() - 89 * 86400000).toISOString().slice(0, 10),
        )
        .all<UsageAggregate>()
    : { results: [] };
  return {
    billing: await billingSnapshot(accountId, env),
    usageAggregates,
    dailyUsage,
    usageTotals: totals ?? { items: 0, credits: 0, requests: 0 },
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
    usage: usage.map((u) => ({
      id: u.id,
      time: u.created_at,
      agentName: u.name,
      keyId: u.agent_id,
      keyName: u.name,
      type: u.usage_type,
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      items: u.items,
      credits: u.status === "refunded" ? 0 : u.credits,
      status: u.status,
    })),
    onboarding: {
      intent: account.intent,
      client: agents.find((a) => a.client !== "API")?.client ?? null,
      completed: agents.some((a) => a.last_used !== null),
    },
    demo,
  };
}
