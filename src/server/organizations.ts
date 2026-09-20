import { AppError, now, type AppEnv } from "./db";
import type {
  OrganizationAction,
  OrganizationContext,
  OrganizationRole,
  WorkspaceSummary,
} from "./organization-contracts";
export const WORKSPACE_COOKIE = "classifier_workspace";
async function ensurePersonal(identityId: string, env: AppEnv) {
  const account = await env.APP_DB.prepare(
    "SELECT id,name,email FROM app_accounts WHERE id=?",
  )
    .bind(identityId)
    .first<{ id: string; name: string; email: string }>();
  if (!account) throw new AppError(401, "Account not found.");
  await env.APP_DB.batch([
    env.APP_DB.prepare(
      "INSERT INTO app_workspaces(account_id,kind,mode,created_at) VALUES(?,'personal',?,?) ON CONFLICT DO NOTHING",
    ).bind(identityId, "hosted", now()),
    env.APP_DB.prepare(
      "INSERT INTO app_memberships(identity_account_id,workspace_id,role,joined_at) VALUES(?,?,'owner',?) ON CONFLICT DO NOTHING",
    ).bind(identityId, identityId, now()),
  ]);
  return account;
}
export function selectedWorkspace(request: Request): string | undefined {
  const value = request.headers
    .get("Cookie")
    ?.match(/(?:^|;\s*)classifier_workspace=([^;]*)/)?.[1];
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    throw new AppError(400, "Invalid workspace selection.");
  }
}
export async function resolveWorkspace(
  identityId: string,
  requested: string | undefined,
  env: AppEnv,
): Promise<WorkspaceSummary> {
  await ensurePersonal(identityId, env);
  const workspace = await env.APP_DB.prepare(
    "SELECT a.id,a.name,w.kind,m.role FROM app_memberships m JOIN app_workspaces w ON w.account_id=m.workspace_id JOIN app_accounts a ON a.id=w.account_id WHERE m.identity_account_id=? AND m.workspace_id=?",
  )
    .bind(identityId, requested || identityId)
    .first<WorkspaceSummary>();
  if (!workspace)
    throw new AppError(403, "You do not have access to this workspace.");
  return workspace;
}
export async function getOrganizationContext(
  identityId: string,
  requested: string | undefined,
  env: AppEnv,
): Promise<OrganizationContext> {
  const identity = await ensurePersonal(identityId, env);
  const active = await resolveWorkspace(identityId, requested, env);
  const { results: workspaces } = await env.APP_DB.prepare(
    "SELECT a.id,a.name,w.kind,m.role FROM app_memberships m JOIN app_workspaces w ON w.account_id=m.workspace_id JOIN app_accounts a ON a.id=w.account_id WHERE m.identity_account_id=? ORDER BY w.kind DESC,a.created_at",
  )
    .bind(identityId)
    .all<WorkspaceSummary>();
  const { results: members } = await env.APP_DB.prepare(
    "SELECT a.id AS accountId,a.name,a.email,m.role,m.joined_at AS joinedAt FROM app_memberships m JOIN app_accounts a ON a.id=m.identity_account_id WHERE m.workspace_id=? ORDER BY m.joined_at",
  )
    .bind(active.id)
    .all<OrganizationContext["members"][number]>();
  const { results: invitations } =
    active.role === "member"
      ? { results: [] }
      : await env.APP_DB.prepare(
          "SELECT id,email,role,created_at AS createdAt,status FROM app_invitations WHERE workspace_id=? AND status='prepared' ORDER BY created_at DESC",
        )
          .bind(active.id)
          .all<OrganizationContext["invitations"][number]>();
  return {
    identity,
    active,
    workspaces,
    members,
    invitations,
    mode: "unconfigured",
  };
}
export function assertWorkspaceMutation(
  role: OrganizationRole,
  actionType: unknown,
) {
  if (typeof actionType !== "string")
    throw new AppError(400, "Invalid account action.");
  if (actionType === "refresh") return;
  if (role === "member")
    throw new AppError(
      403,
      "Only workspace owners and admins can manage connections or billing.",
    );
  if (actionType.startsWith("billing-") && role !== "owner")
    throw new AppError(403, "Only workspace owners can manage billing.");
}
function validated(value: unknown): OrganizationAction {
  if (!value || typeof value !== "object")
    throw new AppError(400, "Invalid organization action.");
  const a = value as Record<string, unknown>;
  const string = (key: string, max = 100) =>
    typeof a[key] === "string" &&
    (a[key] as string).trim().length > 0 &&
    (a[key] as string).length <= max;
  if ((a.type === "create" || a.type === "rename") && string("name", 80))
    return a as unknown as OrganizationAction;
  if (a.type === "switch" && string("workspaceId"))
    return a as unknown as OrganizationAction;
  if (
    a.type === "invite" &&
    string("email", 254) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email as string) &&
    ["admin", "member"].includes(a.role as string)
  )
    return a as unknown as OrganizationAction;
  if (a.type === "revoke-invite" && string("invitationId"))
    return a as unknown as OrganizationAction;
  if (a.type === "remove-member" && string("accountId"))
    return a as unknown as OrganizationAction;
  if (
    a.type === "set-role" &&
    string("accountId") &&
    ["owner", "admin", "member"].includes(a.role as string)
  )
    return a as unknown as OrganizationAction;
  throw new AppError(400, "Invalid organization action.");
}
/** Session identity is passed by the authenticated server function, never by the browser. */
export async function performOrganizationAction(
  identityId: string,
  requested: string | undefined,
  input: unknown,
  env: AppEnv,
): Promise<OrganizationContext> {
  const action = validated(input);
  if (action.type === "switch")
    return getOrganizationContext(identityId, action.workspaceId, env);
  await resolveWorkspace(identityId, requested, env);
  throw new AppError(503, "Organization management is not available yet.");
}
