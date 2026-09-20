import { AppError, type AppEnv } from "../db";
import { resolveWorkspace } from "../organizations";
import { readAccountAnalytics } from "./query";
import type { AnalyticsKind } from "./contracts";

export interface WorkspaceAnalyticsInput {
  workspaceId: string;
  kind: AnalyticsKind;
  params: Record<string, string>;
}

/** Authorize the workspace named by the query cache, independent of tab cookies. */
export async function readWorkspaceAnalytics(
  identityId: string,
  data: WorkspaceAnalyticsInput,
  env: AppEnv,
  fetcher: typeof fetch = fetch,
) {
  if (
    !data || typeof data.workspaceId !== "string" || !data.workspaceId ||
    !["summary", "timeseries", "breakdown", "activity"].includes(data.kind) ||
    !data.params || typeof data.params !== "object" || Array.isArray(data.params) ||
    Object.values(data.params).some((value) => typeof value !== "string")
  ) throw new AppError(400, "Invalid analytics query.");
  const workspace = await resolveWorkspace(identityId, data.workspaceId, env);
  return readAccountAnalytics(env, workspace.id, data.kind, new URLSearchParams(data.params), fetcher);
}
