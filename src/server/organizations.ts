import { AppError, now, type AppEnv } from "./db";
import {
  BILLING_PLANS,
  isBillingPlanId,
} from "../lib/billing";
import type {
  OrganizationAction,
  OrganizationContext,
  OrganizationRole,
  WorkspaceSummary,
} from "./organization-contracts";
export const WORKSPACE_COOKIE = "classifier_workspace";
export async function isDemoWorkspaceRecord(
  accountId: string,
  env: AppEnv,
): Promise<boolean> {
  if (accountId === "local-demo") return true;
  return !!(await env.APP_DB.prepare(
    "SELECT account_id FROM app_workspaces WHERE account_id=? AND mode='demo' AND kind='organization'",
  )
    .bind(accountId)
    .first());
}
export async function isDemoWorkspace(
  accountId: string,
  env: AppEnv,
): Promise<boolean> {
  return (
    env.APP_DEMO === "true" && (await isDemoWorkspaceRecord(accountId, env))
  );
}
export async function countWorkspaceSeats(
  accountId: string,
  env: AppEnv,
): Promise<number> {
  const row = await env.APP_DB.prepare(
    "SELECT (SELECT COUNT(*) FROM app_memberships WHERE workspace_id=?)+(SELECT COUNT(*) FROM app_invitations WHERE workspace_id=? AND status='prepared') AS count",
  )
    .bind(accountId, accountId)
    .first<{ count: number }>();
  return Math.max(1, row?.count ?? 0);
}
async function workspaceSeatLimit(
  accountId: string,
  env: AppEnv,
): Promise<number> {
  const row = await env.APP_DB.prepare(
    "SELECT billing_plan,scheduled_plan FROM app_accounts WHERE id=?",
  )
    .bind(accountId)
    .first<{ billing_plan: string; scheduled_plan: string | null }>();
  const current = isBillingPlanId(row?.billing_plan)
    ? BILLING_PLANS[row.billing_plan].seatLimit
    : 1;
  const scheduled = isBillingPlanId(row?.scheduled_plan)
    ? BILLING_PLANS[row.scheduled_plan].seatLimit
    : null;
  return Math.min(
    current ?? Number.MAX_SAFE_INTEGER,
    scheduled ?? Number.MAX_SAFE_INTEGER,
  );
}
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
    ).bind(identityId, identityId === "local-demo" ? "demo" : "hosted", now()),
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
    mode: (await isDemoWorkspace(active.id, env)) ? "demo" : "unconfigured",
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
  const active = await resolveWorkspace(identityId, requested, env);
  if (
    env.APP_DEMO !== "true" ||
    identityId !== "local-demo" ||
    !(await isDemoWorkspace(active.id, env))
  )
    throw new AppError(
      503,
      "Hosted organization management is not configured.",
    );
  if (action.type === "create") {
    const id = `demo-org:${crypto.randomUUID()}`;
    const timestamp = now();
    await env.APP_DB.batch([
      env.APP_DB.prepare(
        "INSERT INTO app_accounts(id,email,name,balance,reset_at,created_at,period_start) VALUES(?,?,?,?,?,?,?)",
      ).bind(
        id,
        `${id}@workspace.invalid`,
        action.name.trim(),
        0,
        new Date(Date.now() + 30 * 86400000).toISOString(),
        timestamp,
        timestamp,
      ),
      env.APP_DB.prepare(
        "INSERT INTO app_workspaces(account_id,kind,mode,created_at) VALUES(?,'organization','demo',?)",
      ).bind(id, timestamp),
      env.APP_DB.prepare(
        "INSERT INTO app_memberships(identity_account_id,workspace_id,role,joined_at) VALUES(?,?,'owner',?)",
      ).bind(identityId, id, timestamp),
    ]);
    return getOrganizationContext(identityId, id, env);
  }
  if (active.kind !== "organization")
    throw new AppError(400, "Create an organization to manage a team.");
  if (active.role === "member")
    throw new AppError(403, "An owner or admin role is required.");
  if (action.type === "rename")
    await env.APP_DB.prepare("UPDATE app_accounts SET name=? WHERE id=?")
      .bind(action.name.trim(), active.id)
      .run();
  else if (action.type === "invite") {
    const email = action.email.trim().toLowerCase();
    const exists = await env.APP_DB.prepare(
      "SELECT 1 FROM app_memberships m JOIN app_accounts a ON a.id=m.identity_account_id WHERE m.workspace_id=? AND lower(a.email)=?",
    )
      .bind(active.id, email)
      .first();
    if (exists) throw new AppError(409, "This person is already a member.");
    const duplicate = await env.APP_DB.prepare(
      "SELECT id FROM app_invitations WHERE workspace_id=? AND email=? AND status='prepared'",
    )
      .bind(active.id, email)
      .first();
    if (duplicate)
      throw new AppError(
        409,
        "A pending invitation already exists for this email.",
      );
    const cap = await workspaceSeatLimit(active.id, env);
    const result = await env.APP_DB.prepare(
      "INSERT INTO app_invitations(id,workspace_id,email,role,created_at,created_by) SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM app_memberships WHERE workspace_id=?)+(SELECT COUNT(*) FROM app_invitations WHERE workspace_id=? AND status='prepared')<?",
    )
      .bind(
        crypto.randomUUID(),
        active.id,
        email,
        action.role,
        now(),
        identityId,
        active.id,
        active.id,
        cap,
      )
      .run();
    if (!result.meta.changes)
      throw new AppError(
        409,
        "Your plan has no available team seats. Remove a pending invitation or choose a plan with more seats.",
      );
  } else if (action.type === "revoke-invite") {
    const result = await env.APP_DB.prepare(
      "UPDATE app_invitations SET status='revoked' WHERE id=? AND workspace_id=? AND status='prepared'",
    )
      .bind(action.invitationId, active.id)
      .run();
    if (!result.meta.changes)
      throw new AppError(404, "Pending invitation not found.");
  } else {
    if (active.role !== "owner")
      throw new AppError(403, "Only owners can change membership.");
    const target = await env.APP_DB.prepare(
      "SELECT role FROM app_memberships WHERE identity_account_id=? AND workspace_id=?",
    )
      .bind(action.accountId, active.id)
      .first<{ role: OrganizationRole }>();
    if (!target) throw new AppError(404, "Member not found.");
    if (
      target.role === "owner" &&
      (action.type === "remove-member" || action.role !== "owner")
    ) {
      const owners = await env.APP_DB.prepare(
        "SELECT COUNT(*) AS count FROM app_memberships WHERE workspace_id=? AND role='owner'",
      )
        .bind(active.id)
        .first<{ count: number }>();
      if (owners?.count === 1)
        throw new AppError(
          409,
          "Assign another owner before removing or demoting the last owner.",
        );
    }
    if (action.type === "set-role")
      await env.APP_DB.prepare(
        "UPDATE app_memberships SET role=? WHERE identity_account_id=? AND workspace_id=?",
      )
        .bind(action.role, action.accountId, active.id)
        .run();
    else
      await env.APP_DB.prepare(
        "DELETE FROM app_memberships WHERE identity_account_id=? AND workspace_id=?",
      ).bind(action.accountId, active.id).run();
  }
  return getOrganizationContext(
    identityId,
    action.type === "remove-member" && action.accountId === identityId
      ? undefined
      : active.id,
    env,
  );
}
