import { AppError, type AppEnv } from "../server/db";
import { readAccountBalance, requireApiAccount } from "../server/account-access";
import { readAccountAnalytics } from "../server/analytics/query";
import type { AccountAnalyticsEnv, AnalyticsKind } from "../server/analytics/contracts";

/** Public account API uses API-key authentication, independent of dashboard sessions. */
export async function accountReadRoutes(request: Request, env: AppEnv & AccountAnalyticsEnv,
  fetcher: typeof fetch = fetch): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/v1/account/balance") {
    if (request.method !== "GET") throw new AppError(405, "Use GET for your balance.");
    if (url.search) throw new AppError(400, "Balance does not accept query parameters.");
    const accountId = await requireApiAccount(request, env);
    return Response.json(await readAccountBalance(accountId, env), { headers: { "cache-control": "private, no-store" } });
  }
  return accountAnalytics(request, env, (req) => requireApiAccount(req, env), fetcher);
}

/** authorize must verify session/key and workspace membership, never just parse an ID. */
export async function accountAnalytics(request: Request, env: AccountAnalyticsEnv,
  authorize: (request: Request) => Promise<string>, fetcher: typeof fetch = fetch): Promise<Response | null> {
  const url = new URL(request.url);
  const match = /^\/v1\/account\/(?:usage\/(summary|timeseries|breakdown)|(activity))$/.exec(url.pathname);
  if (!match) return null;
  if (request.method !== "GET") throw new AppError(405, "Use GET for usage analytics.");
  const accountId = await authorize(request);
  const result = await readAccountAnalytics(env, accountId, (match[1] ?? match[2]) as AnalyticsKind, url.searchParams, fetcher);
  return Response.json(result, { headers: { "cache-control": "private, no-store" } });
}
