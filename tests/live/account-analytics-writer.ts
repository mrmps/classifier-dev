import { writeAccountAnalytics } from "../../src/server/analytics/write";
import type { AccountAnalyticsEnv } from "../../src/server/analytics/contracts";

/** Ephemeral protected verification Worker. Never mounted by the application. */
export default {
  async fetch(request: Request, env: AccountAnalyticsEnv & { TEST_SECRET: string; TEST_ACCOUNT: string }) {
    if (request.method !== "POST" || request.headers.get("authorization") !== `Bearer ${env.TEST_SECRET}`) return new Response(null, { status: 403 });
    for (const [accountId, items] of [[env.TEST_ACCOUNT, 3], [`${env.TEST_ACCOUNT}_other`, 91]] as const) {
      if (!writeAccountAnalytics(env, {
        accountId, requestId: `${accountId}_request`, keyId: "synthetic_key", source: "API",
        tier: "fast", model: "synthetic_model", status: "success", items,
        inputTokens: 120, outputTokens: 0, cachedInputTokens: 0,
        providerCostUsd: 0.00000504, retailCostUsd: 0.00000504, latencyMs: 17,
      })) return new Response(null, { status: 500 });
    }
    return new Response(null, { status: 204 });
  },
};
