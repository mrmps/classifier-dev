import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { AppAction } from "../../server/contracts";
import { appEnvironment } from "../../server/environment";

export const getDashboard = createServerFn({ method: "GET" }).handler(
  async () => {
    const { env } = await import("cloudflare:workers");
    const { getRequest, setResponseHeader } =
      await import("@tanstack/react-start/server");
    const { requireAccount } = await import("../../server/auth");
    const { getSnapshot } = await import("../../server/accounts");
    setResponseHeader("Cache-Control", "no-store");
    const bindings = appEnvironment(env);
    try {
      const { getOrganizationContext, selectedWorkspace } =
        await import("../../server/organizations");
      const request = getRequest();
      const organizations = await getOrganizationContext(
        await requireAccount(request, bindings),
        selectedWorkspace(request),
        bindings,
      );
      const { ensureDefaultKey } = await import("../../server/api-keys");
      await ensureDefaultKey(organizations.active.id, bindings);
      return {
        ...(await getSnapshot(organizations.active.id, bindings)),
        organizations,
      };
    } catch (error) {
      const { AppError } = await import("../../server/db");
      if (error instanceof AppError && error.status === 401)
        throw redirect({ to: "/login" });
      throw error;
    }
  },
);

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
    return performWorkspaceAction(
      await requireAccount(request, bindings),
      selectedWorkspace(request),
      data,
      bindings,
    );
  });

export const getLoginInfo = createServerFn({ method: "GET" }).handler(
  async () => {
    const { env } = await import("cloudflare:workers");
    const { getRequest } = await import("@tanstack/react-start/server");
    const { isLocalDemo } = await import("../../server/auth");
    return {
      demo: isLocalDemo(
        getRequest(),
        env as unknown as import("../../server/db").AppEnv,
      ),
    };
  },
);
