import { createServerFn } from "@tanstack/react-start";
import { appEnvironment } from "../../server/environment";

export const getBillingLink = createServerFn({ method: "POST" })
  .validator((value: unknown): { action: "checkout" | "portal" } => {
    if (!value || typeof value !== "object" || !("action" in value) ||
      (value.action !== "checkout" && value.action !== "portal")) throw new Error("Invalid billing action.");
    return { action: value.action };
  })
  .handler(async ({ data }) => {
    const { env } = await import("cloudflare:workers");
    const { getRequest, setResponseHeader } = await import("@tanstack/react-start/server");
    const { requireAccount, assertSameOrigin } = await import("../../server/auth");
    const { getOrganizationContext, selectedWorkspace } = await import("../../server/organizations");
    const { AppError } = await import("../../server/db");
    const { createAutumnCheckout, createAutumnPortal, billingReturnUrl } = await import("../../server/autumn");
    const request = getRequest(), bindings = appEnvironment(env);
    assertSameOrigin(request);
    setResponseHeader("Cache-Control", "no-store");
    const context = await getOrganizationContext(await requireAccount(request, bindings), selectedWorkspace(request), bindings);
    if (context.active.role !== "owner") throw new AppError(403, "Only the workspace owner can manage billing.");
    // The dashboard is hosted on our application origin; no caller supplied URL.
    const returnUrl = billingReturnUrl(bindings);
    return data.action === "checkout"
      ? createAutumnCheckout(bindings, context.active.id, returnUrl)
      : createAutumnPortal(bindings, context.active.id, returnUrl);
  });
