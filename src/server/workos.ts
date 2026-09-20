import {
  WorkOS,
  type OrganizationMembership,
  type Role,
} from "@workos-inc/node";
import { AppError, type AppEnv } from "./db";
import type { OrganizationRole } from "./organization-contracts";

export const MANAGE_WORKSPACE = "classifier:workspace:manage";
export const OWN_WORKSPACE = "classifier:workspace:own";
export function workos(env: AppEnv) {
  if (!env.WORKOS_API_KEY)
    throw new AppError(
      503,
      "Organization management requires WorkOS configuration.",
    );
  return new WorkOS(env.WORKOS_API_KEY, {
    clientId: env.WORKOS_CLIENT_ID,
    timeout: 10_000,
    maxRetries: 0,
  });
}
export function workosUserId(identityId: string) {
  if (!identityId.startsWith("workos:user_"))
    throw new AppError(401, "Sign in to manage organizations.");
  return identityId.slice(7);
}
export function organizationId(workspaceId: string) {
  if (!workspaceId.startsWith("workos:org_"))
    throw new AppError(400, "Select an organization first.");
  return workspaceId.slice(7);
}
/** Resolve fresh permissions, including custom and multiple roles. Never trust a cookie's role. */
export function membershipRole(
  membership: OrganizationMembership,
  roles: Role[],
): OrganizationRole {
  const slugs = new Set([
    membership.role.slug,
    ...(membership.roles ?? []).map((role) => role.slug),
  ]);
  const permissions = new Set(
    roles
      .filter((role) => slugs.has(role.slug))
      .flatMap((role) => role.permissions),
  );
  if (permissions.has(OWN_WORKSPACE)) return "owner";
  if (permissions.has(MANAGE_WORKSPACE)) return "admin";
  return "member";
}
export async function organizationAccess(
  identityId: string,
  workspaceId: string,
  env: AppEnv,
) {
  const client = workos(env);
  const id = organizationId(workspaceId);
  const memberships = await client.userManagement.listOrganizationMemberships({
    userId: workosUserId(identityId),
    organizationId: id,
    statuses: ["active"],
  });
  const membership = memberships.data[0];
  if (!membership)
    throw new AppError(403, "You do not have access to this workspace.");
  const { data: roles } = await client.authorization.listOrganizationRoles(id);
  return {
    client,
    id,
    membership,
    roles,
    role: membershipRole(membership, roles),
  };
}
