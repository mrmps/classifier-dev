import type { AppAction } from "./contracts";
import type { AppEnv } from "./db";
import { performAction } from "./agents";
import { getSnapshot } from "./accounts";
import { ensureDefaultKey } from "./api-keys";
import {
  assertWorkspaceMutation,
  getOrganizationContext,
} from "./organizations";

/** Identity comes exclusively from requireAccount, never from the action payload. */
export async function performWorkspaceAction(
  identity: string,
  workspaceId: string | undefined,
  action: AppAction,
  env: AppEnv,
) {
  const organizations = await getOrganizationContext(
    identity,
    workspaceId,
    env,
  );
  if (action?.type !== "set-name")
    assertWorkspaceMutation(organizations.active.role, action?.type);
  const target =
    action?.type === "set-name" ? identity : organizations.active.id;
  if (action?.type === "refresh") await ensureDefaultKey(target, env);
  const result = await performAction(target, action, env);
  const context = await getOrganizationContext(
    identity,
    organizations.active.id,
    env,
  );
  return {
    ...result,
    snapshot: {
      ...(await getSnapshot(context.active.id, env)),
      organizations: context,
    },
  };
}
