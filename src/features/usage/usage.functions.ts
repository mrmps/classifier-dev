import { createServerFn } from "@tanstack/react-start";
import type { WorkspaceAnalyticsInput } from "../../server/analytics/workspace";

export const getUsageAnalytics = createServerFn({ method: "GET" })
  .validator(
    (input: WorkspaceAnalyticsInput) => input,
  )
  .handler(async ({ data }) => {
    const { env } = await import("cloudflare:workers");
    const { getRequest, setResponseHeader } =
      await import("@tanstack/react-start/server");
    const { appEnvironment } = await import("../../server/environment");
    const { requireAccount } = await import("../../server/auth");
    const { readWorkspaceAnalytics } =
      await import("../../server/analytics/workspace");
    const bindings = appEnvironment(env);
    const request = getRequest();
    setResponseHeader("Cache-Control", "no-store");
    return readWorkspaceAnalytics(
      await requireAccount(request, bindings),
      data,
      bindings,
    );
  });
