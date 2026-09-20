export type AnalyticsKind = "summary" | "timeseries" | "breakdown" | "activity";
export type AnalyticsRow = Record<string, string | number | null>;
export interface AccountAnalyticsResponse {
  data: AnalyticsRow[];
  meta: {
    queriedAt: string;
    latestEventAt: string | null;
    sampled: boolean;
    exact: false;
    retentionDays: 90;
  };
}
export interface AccountAnalyticsEnv {
  LIMITER?: DurableObjectNamespace;
  APP_ACCOUNTS_ENABLED?: string;
  ACCOUNT_AE?: { writeDataPoint(point: { indexes: string[]; blobs: string[]; doubles: number[] }): void };
  CLOUDFLARE_ACCOUNT_ID?: string;
  CF_ANALYTICS_TOKEN?: string;
}
export interface AccountAnalyticsEvent {
  accountId: string;
  requestId: string;
  keyId?: string;
  agentId?: string;
  source: "API" | "MCP";
  tier: "fast" | "smart";
  model?: string;
  status: "success" | "error";
  items: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens?: number | null;
  providerCostUsd: number | null;
  retailCostUsd: number | null;
  latencyMs: number;
  escalations?: number;
}
