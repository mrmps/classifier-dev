import { createServerFn } from "@tanstack/react-start";
import type { OrganizationAction } from "../../server/organization-contracts";
import { appEnvironment } from "../../server/environment";
export const getOrganizationContext = createServerFn({ method: "GET" }).handler(
  async () => {
    const { env } = await import("cloudflare:workers");
    const { getRequest, setResponseHeader, setCookie } =
      await import("@tanstack/react-start/server");
    const { requireAccount } = await import("../../server/auth");
    const { getOrganizationContext, selectedWorkspace } =
      await import("../../server/organizations");
    const bindings = appEnvironment(env);
    const request = getRequest();
    setResponseHeader("Cache-Control", "no-store");
    return getOrganizationContext(
      await requireAccount(request, bindings),
      selectedWorkspace(request),
      bindings,
    );
  },
);
export const organizationAction = createServerFn({ method: "POST" })
  .validator((data: OrganizationAction) => data)
  .handler(async ({ data }) => {
    const { env } = await import("cloudflare:workers");
    const { getRequest, setResponseHeader, setCookie } =
      await import("@tanstack/react-start/server");
    const { requireAccount, assertSameOrigin } =
      await import("../../server/auth");
    const { performOrganizationAction, selectedWorkspace } =
      await import("../../server/organizations");
    const bindings = appEnvironment(env);
    const request = getRequest();
    assertSameOrigin(request);
    setResponseHeader("Cache-Control", "no-store");
    const identity = await requireAccount(request, bindings);
    const result = await performOrganizationAction(
      identity,
      selectedWorkspace(request),
      data,
      bindings,
    );
    if (
      (data.type === "create" || data.type === "switch") &&
      result.active.kind === "organization"
    ) {
      const { switchToOrganization } =
        await import("@workos/authkit-tanstack-react-start");
      await switchToOrganization({
        data: {
          organizationId: result.active.id.slice(7),
          returnTo: "/app/team",
        },
      });
    }
    setCookie("classifier_workspace", result.active.id, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 31536000,
      secure: new URL(request.url).protocol === "https:",
    });
    return result;
  });
