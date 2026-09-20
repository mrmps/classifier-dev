import type { BillingPlanId } from "../lib/billing";
/** Browser-safe product contracts. Never export secrets or database handles here. */
export type AgentStatus = "pending" | "connected" | "paused" | "revoked";
export interface BillingSnapshot {
  availableCredits: number;
  paidCredits: number;
  includedCredits: number;
  plan: BillingPlanId;
  scheduledPlan: BillingPlanId | null;
  cancelAtPeriodEnd: boolean;
  mode: "autumn" | "unconfigured";
  transactions: Array<{
    id: string;
    createdAt: string;
    kind: "top_up" | "subscription" | "auto_top_up";
    amountCents: number;
    credits: number;
    status: "confirmed";
  }>;
}
export interface UsageAggregate {
  day: string;
  hour: string;
  keyId: string;
  keyName: string;
  type: string;
  items: number;
  credits: number;
  requests: number;
  inputTokens: number | null;
  outputTokens: number | null;
}
export interface AppSnapshot {
  organizations?: import("./organization-contracts").OrganizationContext;
  billing: BillingSnapshot;
  usageAggregates: UsageAggregate[];
  dailyUsage: Array<{
    day: string;
    items: number;
    credits: number;
    requests: number;
  }>;
  usageTotals: { items: number; credits: number; requests: number };
  account: { id: string; name: string; email: string };
  credits: {
    balance: number;
    included: number;
    bonus: number;
    resetAt: string;
  };
  agents: Array<{
    id: string;
    name: string;
    client: string;
    status: AgentStatus;
    used: number;
    lastUsed: string | null;
  }>;
  usage: Array<{
    id: string;
    time: string;
    agentName: string;
    keyId: string;
    keyName: string;
    type: string;
    inputTokens: number | null;
    outputTokens: number | null;
    items: number;
    credits: number;
    status: string;
    costAvailable?: boolean;
  }>;
  keys: Array<{
    id: string;
    name: string;
    prefix: string;
    recoverable?: boolean;
    createdAt: string;
    status: AgentStatus;
  }>;
  onboarding: {
    intent: "agent" | "api";
    client: string | null;
    completed: boolean;
  };
}
export type AppAction =
  | { type: "refresh" }
  | { type: "reveal-key"; keyId: string }
  | { type: "rotate-key"; keyId: string; prefix: string }
  | { type: "rename-key"; keyId: string; name: string }
  | { type: "enroll"; client: string; name?: string }
  | { type: "create-key"; name: string }
  | { type: "revoke-key"; keyId: string }
  | { type: "pause" | "resume" | "revoke"; agentId: string }
  | { type: "intent"; intent: "agent" | "api" }
  | { type: "set-name"; name: string };
export interface ActionResult {
  snapshot: AppSnapshot;
  secret?: string;
  agentId?: string;
}
