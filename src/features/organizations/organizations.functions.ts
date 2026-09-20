import { createServerFn } from "@tanstack/react-start";
import type { OrganizationAction } from "../../server/organization-contracts";
import { appEnvironment } from "../../server/environment";
export const getOrganizationContext = createServerFn({ method: "GET" }).handler(
  async () => {
    const { env } = await import("cloudflare:workers");
    const { getRequest, setResponseHeader } =
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
    const { getRequest, setResponseHeader } =
      await import("@tanstack/react-start/server");
    const { requireAccount, assertSameOrigin, isLocalDemo } =
      await import("../../server/auth");
    const { performOrganizationAction, selectedWorkspace } =
      await import("../../server/organizations");
    const { AppError } = await import("../../server/db");
    const bindings = appEnvironment(env);
    const request = getRequest();
    assertSameOrigin(request);
    setResponseHeader("Cache-Control", "no-store");
    const identity = await requireAccount(request, bindings);
    if (data?.type !== "switch" && !isLocalDemo(request, bindings))
      throw new AppError(
        503,
        "Hosted organization management is not configured.",
      );
    const result = await performOrganizationAction(
      identity,
      selectedWorkspace(request),
      data,
      bindings,
    );
    setResponseHeader(
      "Set-Cookie",
      `classifier_workspace=${encodeURIComponent(result.active.id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
    );
    return result;
  });
