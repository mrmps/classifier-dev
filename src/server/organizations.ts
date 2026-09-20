import { AppError, now, type AppEnv } from "./db";
import type {
  OrganizationAction,
  OrganizationContext,
  OrganizationRole,
  WorkspaceSummary,
} from "./organization-contracts";
import { BILLING_PLANS, type BillingPlanId } from "../lib/billing";
import {
  workos,
  workosUserId,
  organizationId,
  organizationAccess,
  membershipRole,
} from "./workos";
export const WORKSPACE_COOKIE = "classifier_workspace";
async function ensurePersonal(identityId: string, env: AppEnv) {
  const account = await env.APP_DB.prepare(
    "SELECT id,name,email,created_at AS joinedAt FROM app_accounts WHERE id=?",
  )
    .bind(identityId)
    .first<{ id: string; name: string; email: string; joinedAt: string }>();
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
  if (requested && requested !== identityId) {
    const workspace = await env.APP_DB.prepare(
      "SELECT a.id,a.name,w.kind FROM app_workspaces w JOIN app_accounts a ON a.id=w.account_id WHERE a.id=? AND w.kind='organization'",
    )
      .bind(requested)
      .first<Omit<WorkspaceSummary, "role">>();
    if (!workspace || !requested.startsWith("workos:org_"))
      throw new AppError(403, "You do not have access to this workspace.");
    const access = await organizationAccess(identityId, requested, env);
    return {
      ...workspace,
      name: access.membership.organizationName,
      role: access.role,
    };
  }
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
  const personal: WorkspaceSummary = {
    id: identity.id,
    name: identity.name,
    kind: "personal",
    role: "owner",
  };
  const workspaces: WorkspaceSummary[] = [personal];
  if (env.WORKOS_API_KEY) {
    const client = workos(env);
    const memberships = await (
      await client.userManagement.listOrganizationMemberships({
        userId: workosUserId(identityId),
        statuses: ["active"],
      })
    ).autoPagination();
    for (const membership of memberships) {
      const id = `workos:${membership.organizationId}`;
      const exists = await env.APP_DB.prepare(
        "SELECT account_id FROM app_workspaces WHERE account_id=? AND kind='organization'",
      )
        .bind(id)
        .first();
      if (!exists) continue;
      const { data: roles } = await client.authorization.listOrganizationRoles(
        membership.organizationId,
      );
      workspaces.push({
        id,
        name: membership.organizationName,
        kind: "organization",
        role: membershipRole(membership, roles),
      });
    }
  }
  let members: OrganizationContext["members"] = [
    {
      accountId: identity.id,
      name: identity.name,
      email: identity.email,
      role: "owner",
      joinedAt: identity.joinedAt,
    },
  ];
  let invitations: OrganizationContext["invitations"] = [];
  if (active.kind === "organization") {
    const { client, id, roles } = await organizationAccess(
      identityId,
      active.id,
      env,
    );
    const memberships = await (
      await client.userManagement.listOrganizationMemberships({
        organizationId: id,
        statuses: ["active"],
      })
    ).autoPagination();
    members = await Promise.all(
      memberships.map(async (membership) => {
        const user = await client.userManagement.getUser(membership.userId);
        return {
          accountId: `workos:${user.id}`,
          name:
            [user.firstName, user.lastName].filter(Boolean).join(" ") ||
            user.email,
          email: user.email,
          role: membershipRole(membership, roles),
          joinedAt: membership.createdAt,
        };
      }),
    );
    if (active.role !== "member") {
      invitations = (
        await (
          await client.userManagement.listInvitations({ organizationId: id })
        ).autoPagination()
      )
        .filter(
          (invite) =>
            invite.state === "pending" &&
            Date.parse(invite.expiresAt) > Date.now(),
        )
        .map((invite) => ({
          id: invite.id,
          email: invite.email,
          role: invite.roleSlug === "admin" ? "admin" : "member",
          createdAt: invite.createdAt,
          status: "pending",
        }));
    }
  }
  return {
    identity,
    active,
    workspaces,
    members,
    invitations,
    mode: env.WORKOS_API_KEY ? "workos" : "unconfigured",
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
  const client = workos(env);
  const userId = workosUserId(identityId);
  if (action.type === "create") {
    const identity = await ensurePersonal(identityId, env);
    const organization = await client.organizations.createOrganization({
      name: action.name.trim(),
    });
    const id = `workos:${organization.id}`;
    try {
      await client.userManagement.createOrganizationMembership({
        organizationId: organization.id,
        userId,
        roleSlug: "owner",
      });
      const timestamp = now();
      await env.APP_DB.batch([
        env.APP_DB.prepare(
          "INSERT INTO app_accounts(id,email,name,balance,reset_at,created_at,period_start) VALUES(?,?,?,0,?,?,?)",
        ).bind(
          id,
          identity.email,
          organization.name,
          timestamp,
          timestamp,
          timestamp,
        ),
        env.APP_DB.prepare(
          "INSERT INTO app_workspaces(account_id,kind,mode,created_at) VALUES(?,'organization','hosted',?)",
        ).bind(id, timestamp),
        env.APP_DB.prepare(
          "INSERT INTO app_autumn_customers(account_id,customer_id,identity_verified_at) VALUES(?,?,?)",
        ).bind(id, organization.id, timestamp),
      ]);
    } catch (error) {
      // Only remove an uncommitted organization. A database timeout may have committed.
      const persisted = await env.APP_DB.prepare(
        "SELECT account_id FROM app_workspaces WHERE account_id=?",
      )
        .bind(id)
        .first();
      if (persisted) return getOrganizationContext(identityId, id, env);
      await client.organizations.deleteOrganization(organization.id);
      throw error;
    }
    return getOrganizationContext(identityId, id, env);
  }
  const active = await resolveWorkspace(identityId, requested, env);
  const id = organizationId(active.id);
  const token = crypto.randomUUID();
  const lock = await env.APP_DB.prepare(
    "INSERT INTO app_organization_operations(workspace_id,token,expires_at) VALUES(?,?,now()+interval '2 minutes') ON CONFLICT(workspace_id) DO UPDATE SET token=EXCLUDED.token,expires_at=EXCLUDED.expires_at WHERE app_organization_operations.expires_at<now() RETURNING token",
  )
    .bind(active.id, token)
    .first();
  if (!lock)
    throw new AppError(
      409,
      "Another team change is in progress. Please try again.",
    );
  try {
    // Check authorization again after acquiring the mutation lease.
    const { role, roles } = await organizationAccess(
      identityId,
      active.id,
      env,
    );
    if (role === "member")
      throw new AppError(
        403,
        "Only owners and admins can manage this organization.",
      );
    if (action.type === "rename") {
      await client.organizations.updateOrganization({
        organization: id,
        name: action.name.trim(),
      });
      await env.APP_DB.prepare("UPDATE app_accounts SET name=? WHERE id=?")
        .bind(action.name.trim(), active.id)
        .run();
    } else if (action.type === "invite") {
      const email = action.email.trim().toLowerCase();
      const context = await getOrganizationContext(identityId, active.id, env);
      if (
        context.members.some((member) => member.email.toLowerCase() === email)
      )
        throw new AppError(409, "This person is already a member.");
      if (
        context.invitations.some(
          (invite) => invite.email.toLowerCase() === email,
        )
      )
        throw new AppError(
          409,
          "An invitation is already pending for this email.",
        );
      const account = await env.APP_DB.prepare(
        "SELECT billing_plan FROM app_accounts WHERE id=?",
      )
        .bind(active.id)
        .first<{ billing_plan: BillingPlanId }>();
      const limit = BILLING_PLANS[account?.billing_plan ?? "free"].seatLimit;
      if (
        limit !== null &&
        context.members.length + context.invitations.length >= limit
      )
        throw new AppError(
          409,
          "All seats are in use. Upgrade your plan or cancel an invitation.",
        );
      await client.userManagement.sendInvitation({
        organizationId: id,
        inviterUserId: userId,
        email,
        roleSlug: action.role,
      });
    } else if (action.type === "revoke-invite") {
      const invite = await client.userManagement.getInvitation(
        action.invitationId,
      );
      if (invite.organizationId !== id)
        throw new AppError(404, "Invitation not found in this organization.");
      if (invite.state !== "pending")
        throw new AppError(
          409,
          "This invitation is no longer pending. Refresh the team.",
        );
      await client.userManagement.revokeInvitation(invite.id);
    } else {
      if (role !== "owner")
        throw new AppError(
          403,
          "Only owners can change member roles or remove members.",
        );
      const memberships = await (
        await client.userManagement.listOrganizationMemberships({
          organizationId: id,
          statuses: ["active"],
        })
      ).autoPagination();
      const member = memberships.find(
        (member) => `workos:${member.userId}` === action.accountId,
      );
      if (!member)
        throw new AppError(404, "Member not found in this organization.");
      if (
        membershipRole(member, roles) === "owner" &&
        (action.type === "remove-member" || action.role !== "owner") &&
        memberships.filter(
          (member) => membershipRole(member, roles) === "owner",
        ).length === 1
      )
        throw new AppError(409, "The last owner cannot be removed or demoted.");
      if (action.accountId === identityId)
        throw new AppError(
          409,
          "Ask another owner to change your role or remove you.",
        );
      if (action.type === "remove-member")
        await client.userManagement.deleteOrganizationMembership(member.id);
      else
        await client.userManagement.updateOrganizationMembership(member.id, {
          roleSlug: action.role,
        });
    }
  } finally {
    await env.APP_DB.prepare(
      "DELETE FROM app_organization_operations WHERE workspace_id=? AND token=?",
    )
      .bind(active.id, token)
      .run();
  }
  return getOrganizationContext(identityId, active.id, env);
}

/** A removed member can still open their personal dashboard. Explicit mutations
 * and analytics reads keep their strict tenant checks. */
export async function getDashboardOrganizationContext(
  identityId: string,
  requested: string | undefined,
  env: AppEnv,
) {
  try {
    return await getOrganizationContext(identityId, requested, env);
  } catch (error) {
    if (requested && error instanceof AppError && error.status === 403)
      return getOrganizationContext(identityId, undefined, env);
    throw error;
  }
}
