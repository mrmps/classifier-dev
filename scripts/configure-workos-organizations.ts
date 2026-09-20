// Idempotent environment-level RBAC setup. Preserves all existing permissions.
// Run with the same WORKOS_API_KEY used by the deployment before enabling teams.
import { WorkOS } from "@workos-inc/node";
import { MANAGE_WORKSPACE, OWN_WORKSPACE } from "../src/server/workos";
if (!process.env.WORKOS_API_KEY) throw new Error("Set WORKOS_API_KEY.");
const client = new WorkOS(process.env.WORKOS_API_KEY);
const permissions = await (
  await client.authorization.listPermissions()
).autoPagination();
for (const [slug, name] of [
  [MANAGE_WORKSPACE, "Manage classifier workspace"],
  [OWN_WORKSPACE, "Own classifier workspace and billing"],
]) {
  if (!permissions.some((permission) => permission.slug === slug))
    await client.authorization.createPermission({ slug, name });
}
const { data: roles } = await client.authorization.listEnvironmentRoles();
for (const [slug, name] of [
  ["member", "Member"],
  ["admin", "Admin"],
  ["owner", "Owner"],
]) {
  if (!roles.some((role) => role.slug === slug))
    await client.authorization.createEnvironmentRole({ slug, name });
}
await client.authorization.addEnvironmentRolePermission("admin", {
  permissionSlug: MANAGE_WORKSPACE,
});
await client.authorization.addEnvironmentRolePermission("owner", {
  permissionSlug: MANAGE_WORKSPACE,
});
await client.authorization.addEnvironmentRolePermission("owner", {
  permissionSlug: OWN_WORKSPACE,
});
console.log("Organization roles configured; existing permissions preserved.");
