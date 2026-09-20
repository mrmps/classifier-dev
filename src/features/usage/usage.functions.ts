import { createServerFn } from "@tanstack/react-start";
import type { AnalyticsKind } from "../../server/analytics/contracts";

export const getUsageAnalytics = createServerFn({ method: "GET" })
  .validator(
    (input: { kind: AnalyticsKind; params: Record<string, string> }) => input,
  )
  .handler(async ({ data }) => {
    const { env } = await import("cloudflare:workers");
    const { getRequest, setResponseHeader } =
      await import("@tanstack/react-start/server");
    const { appEnvironment } = await import("../../server/environment");
    const { requireAccount } = await import("../../server/auth");
    const { getOrganizationContext, selectedWorkspace } =
      await import("../../server/organizations");
    const { readAccountAnalytics } =
      await import("../../server/analytics/query");
    const bindings = appEnvironment(env);
    const request = getRequest();
    setResponseHeader("Cache-Control", "no-store");
    const organizations = await getOrganizationContext(
      await requireAccount(request, bindings),
      selectedWorkspace(request),
      bindings,
    );
    if (
      !data ||
      !["summary", "timeseries", "breakdown", "activity"].includes(data.kind) ||
      !data.params ||
      Object.values(data.params).some((value) => typeof value !== "string")
    ) {
      throw new Error("Invalid analytics query.");
    }
    return readAccountAnalytics(
      bindings,
      organizations.active.id,
      data.kind,
      new URLSearchParams(data.params),
    );
  });
