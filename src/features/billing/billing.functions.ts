import { createServerFn } from "@tanstack/react-start";
import { appEnvironment } from "../../server/environment";
import { isValidTopUpCents } from "../../lib/billing";

type BillingLinkRequest =
  | { action: "checkout"; plan: "pro" | "scale" }
  | { action: "portal" }
  | { action: "top-up"; amountCents: number }
  | { action: "setup-payment" };

/** Every billing mutation shares one gate: verified session, owner role on the
 * selected workspace, same-origin request, server-derived return URL. */
async function ownerBillingContext() {
  const { env } = await import("cloudflare:workers");
  const { getRequest, setResponseHeader } = await import("@tanstack/react-start/server");
  const { requireAccount, assertSameOrigin } = await import("../../server/auth");
  const { getOrganizationContext, selectedWorkspace } = await import("../../server/organizations");
  const { AppError } = await import("../../server/db");
  const request = getRequest(), bindings = appEnvironment(env);
  assertSameOrigin(request);
  setResponseHeader("Cache-Control", "no-store");
  const context = await getOrganizationContext(await requireAccount(request, bindings), selectedWorkspace(request), bindings);
  if (context.active.role !== "owner") throw new AppError(403, "Only the workspace owner can manage billing.");
  return { bindings, accountId: context.active.id };
}

export const getBillingLink = createServerFn({ method: "POST" })
  .validator((value: unknown): BillingLinkRequest => {
    if (!value || typeof value !== "object" || !("action" in value)) throw new Error("Invalid billing action.");
    const request = value as Record<string, unknown>;
    if (request.action === "portal" || request.action === "setup-payment") return { action: request.action };
    if (request.action === "checkout") {
      if (request.plan !== "pro" && request.plan !== "scale") throw new Error("Invalid billing plan.");
      return { action: "checkout", plan: request.plan };
    }
    if (request.action === "top-up") {
      if (!isValidTopUpCents(request.amountCents)) throw new Error("Top-ups are whole dollar amounts between $5 and $1,000.");
      return { action: "top-up", amountCents: request.amountCents };
    }
    throw new Error("Invalid billing action.");
  })
  .handler(async ({ data }) => {
    const { createAutumnCheckout, createAutumnPortal, createAutumnTopUpCheckout, createAutumnPaymentSetup, billingReturnUrl } =
      await import("../../server/autumn");
    const { bindings, accountId } = await ownerBillingContext();
    // The dashboard is hosted on our application origin; no caller supplied URL.
    const returnUrl = billingReturnUrl(bindings);
    const creditsReturnUrl = `${returnUrl.replace(/\/app\/plans$/, "/app/credits")}?billing=refresh`;
    switch (data.action) {
      case "checkout": return createAutumnCheckout(bindings, accountId, returnUrl, data.plan);
      case "portal": return createAutumnPortal(bindings, accountId, returnUrl);
      case "top-up": return createAutumnTopUpCheckout(bindings, accountId, creditsReturnUrl, data.amountCents);
      case "setup-payment": return createAutumnPaymentSetup(bindings, accountId, creditsReturnUrl);
    }
  });

export const updateAutoTopUp = createServerFn({ method: "POST" })
  .validator((value: unknown): { enabled: boolean; amountCents: number; thresholdCents: number; capCents: number } => {
    if (!value || typeof value !== "object") throw new Error("Invalid auto top-up settings.");
    const settings = value as Record<string, unknown>;
    if (typeof settings.enabled !== "boolean") throw new Error("Invalid auto top-up settings.");
    if (!isValidTopUpCents(settings.amountCents)) throw new Error("Recharge amounts are whole dollars between $5 and $1,000.");
    const threshold = settings.thresholdCents, cap = settings.capCents;
    if (typeof threshold !== "number" || !Number.isSafeInteger(threshold) || threshold < 100 || threshold > 100_000 || threshold % 100 !== 0)
      throw new Error("The balance threshold is a whole dollar amount between $1 and $1,000.");
    if (typeof cap !== "number" || !Number.isSafeInteger(cap) || cap < 0 || cap > 1_000_000 || cap % 100 !== 0)
      throw new Error("The monthly maximum is a whole dollar amount up to $10,000, or 0 for no maximum.");
    return { enabled: settings.enabled, amountCents: settings.amountCents, thresholdCents: threshold, capCents: cap };
  })
  .handler(async ({ data }) => {
    const { bindings, accountId } = await ownerBillingContext();
    await bindings.APP_DB.prepare(
      "UPDATE app_accounts SET auto_top_up_enabled=?,auto_top_up_amount_cents=?,auto_top_up_threshold_cents=?,auto_top_up_cap_cents=? WHERE id=?",
    ).bind(data.enabled ? 1 : 0, data.amountCents, data.thresholdCents, data.capCents, accountId).run();
    return { saved: true as const };
  });

/** Called when returning from a top-up checkout so the purchase shows without
 * waiting for a webhook. Reconciliation is idempotent and invoice-verified. */
export const refreshBilling = createServerFn({ method: "POST" }).handler(async () => {
  const { reconcileAutumnCustomer } = await import("../../server/billing-sync");
  const { bindings, accountId } = await ownerBillingContext();
  const mapping = await bindings.APP_DB.prepare("SELECT customer_id FROM app_autumn_customers WHERE account_id=?")
    .bind(accountId).first<{ customer_id: string }>();
  if (!mapping) return { refreshed: false as const };
  try { await reconcileAutumnCustomer(bindings, mapping.customer_id); return { refreshed: true as const }; }
  catch { return { refreshed: false as const }; }
});
