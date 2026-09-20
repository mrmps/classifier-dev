import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { AppAction } from "../../server/contracts";
import { appEnvironment } from "../../server/environment";
import { authReturnPath } from "../../lib/auth-return-path";

async function viewerImageUrl() {
  const { getAuth } = await import("@workos/authkit-tanstack-react-start");
  return (await getAuth()).user?.profilePictureUrl ?? null;
}

export const getDashboard = createServerFn({ method: "GET" })
  .validator((data: { returnTo?: string } | undefined) => authReturnPath(data?.returnTo))
  .handler(async ({ data }) => {
    const { env } = await import("cloudflare:workers");
    const { getRequest, setResponseHeader, setCookie } =
      await import("@tanstack/react-start/server");
    const { requireAccount } = await import("../../server/auth");
    const { getSnapshot } = await import("../../server/accounts");
    setResponseHeader("Cache-Control", "no-store");
    const bindings = appEnvironment(env);
    try {
      const { getDashboardOrganizationContext, selectedWorkspace } =
        await import("../../server/organizations");
      const request = getRequest();
      const organizations = await getDashboardOrganizationContext(
        await requireAccount(request, bindings),
        selectedWorkspace(request),
        bindings,
      );
      if (
        selectedWorkspace(request) &&
        selectedWorkspace(request) !== organizations.active.id
      )
        setCookie("classifier_workspace", "", {
          httpOnly: true, sameSite: "lax", path: "/", maxAge: 0,
          secure: new URL(request.url).protocol === "https:",
        });
      const { ensureDefaultKey } = await import("../../server/api-keys");
      await ensureDefaultKey(organizations.active.id, bindings);
      return {
        ...(await getSnapshot(organizations.active.id, bindings)),
        organizations,
        viewerImageUrl: await viewerImageUrl(),
      };
    } catch (error) {
      const { AppError } = await import("../../server/db");
      if (error instanceof AppError && error.status === 401)
        throw redirect({
          to: "/login",
          search: { returnTo: data, error: undefined },
        });
      throw error;
    }
  });

export const dashboardAction = createServerFn({ method: "POST" })
  .validator((data: AppAction) => data)
  .handler(async ({ data }) => {
    const { env } = await import("cloudflare:workers");
    const { getRequest, setResponseHeader } =
      await import("@tanstack/react-start/server");
    const { requireAccount, assertSameOrigin } =
      await import("../../server/auth");
    const { performWorkspaceAction } =
      await import("../../server/workspace-actions");
    const request = getRequest();
    assertSameOrigin(request);
    setResponseHeader("Cache-Control", "no-store");
    const bindings = appEnvironment(env);
    const { selectedWorkspace } = await import("../../server/organizations");
    const result = await performWorkspaceAction(
      await requireAccount(request, bindings),
      selectedWorkspace(request),
      data,
      bindings,
    );
    return {
      ...result,
      snapshot: { ...result.snapshot, viewerImageUrl: await viewerImageUrl() },
    };
  });
