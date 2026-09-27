import { BILLING_PLANS, centsToCredits, isValidTopUpCents } from "../lib/billing";
import { AppError, type AppEnv } from "./db";
import { hasActiveComplimentaryPro } from "./complimentary-pro";

export type AutumnEnv = AppEnv & {
  AUTUMN_SECRET_KEY?: string;
  AUTUMN_WEBHOOK_SECRET?: string;
  AUTUMN_PRO_PLAN_ID?: string;
  AUTUMN_SCALE_PLAN_ID?: string;
  AUTUMN_TOPUP_PLAN_ID?: string;
  APP_ORIGIN?: string;
};
export type SubscriptionPlan = {
  id: "pro" | "scale";
  planId: string;
  amountUsd: number;
  cents: number;
  credits: number;
};
/** Provider plan ids come from configuration; prices and allowances from the
 * catalogue. A plan without its configured provider id simply does not exist. */
export function subscriptionPlans(env: AutumnEnv): SubscriptionPlan[] {
  const plans: SubscriptionPlan[] = [];
  for (const id of ["pro", "scale"] as const) {
    const planId = id === "pro" ? env.AUTUMN_PRO_PLAN_ID : env.AUTUMN_SCALE_PLAN_ID;
    if (planId) plans.push({
      id, planId, amountUsd: BILLING_PLANS[id].priceCents / 100,
      cents: BILLING_PLANS[id].priceCents, credits: BILLING_PLANS[id].includedCredits,
    });
  }
  return plans;
}
export function billingReturnUrl(env: AutumnEnv) {
  const url = new URL(env.APP_ORIGIN || "https://classifier.dev");
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new AppError(503, "Application origin must be a trusted HTTPS origin.");
  return `${url.origin}/app/plans`;
}
export type AutumnCustomer = {
  id: string;
  subscriptions: Array<{
    id: string; plan_id: string; status: string; past_due: boolean;
    current_period_start: number | null; current_period_end: number | null;
    canceled_at: number | null;
  }>;
  /** Saved-card summary for display, or {type:"none"} when the provider
   * reported no saved method. Advisory only: never a payment authorization. */
  paymentMethod: PaymentMethodSummary;
};
export type PaymentMethodSummary =
  | { type: "card"; brand: string; last4: string; expMonth: number; expYear: number }
  | { type: "other" }
  | { type: "none" };
function paymentMethodSummary(value: unknown): PaymentMethodSummary {
  if (!value || typeof value !== "object") return { type: "none" };
  const method = value as { type?: unknown; card?: { brand?: unknown; last4?: unknown; exp_month?: unknown; exp_year?: unknown } | null };
  const card = method.card;
  if (method.type === "card" && card && typeof card === "object" &&
    typeof card.brand === "string" && /^[a-z_]{1,20}$/.test(card.brand) &&
    typeof card.last4 === "string" && /^\d{4}$/.test(card.last4) &&
    typeof card.exp_month === "number" && Number.isSafeInteger(card.exp_month) && card.exp_month >= 1 && card.exp_month <= 12 &&
    typeof card.exp_year === "number" && Number.isSafeInteger(card.exp_year) && card.exp_year >= 2000 && card.exp_year <= 3000)
    return { type: "card", brand: card.brand, last4: card.last4, expMonth: card.exp_month, expYear: card.exp_year };
  return { type: "other" };
}
const unavailable = () => new AppError(503, "Billing is temporarily unavailable.");

/** Version pinned to the published Autumn REST contract. No automatic retries
 * for mutations: a timeout can mean the provider accepted the operation. */
export async function autumnRequest(env: AutumnEnv, path: string, payload: unknown): Promise<Record<string, unknown>> {
  if (!env.AUTUMN_SECRET_KEY) throw unavailable();
  try {
    const response = await fetch(`https://api.useautumn.com/v1/${path}`, {
      method: "POST", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${env.AUTUMN_SECRET_KEY}`, "Content-Type": "application/json", "x-api-version": "2.4.0" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw unavailable();
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) throw unavailable();
    return data as Record<string, unknown>;
  } catch { throw unavailable(); }
}

export async function getAutumnCustomer(env: AutumnEnv, customerId: string): Promise<AutumnCustomer> {
  const data = await autumnRequest(env, "customers.get", { customer_id: customerId, expand: ["payment_method"] });
  if (data.id !== customerId || !Array.isArray(data.subscriptions)) throw unavailable();
  for (const subscription of data.subscriptions) {
    if (!subscription || typeof subscription !== "object" || typeof subscription.id !== "string" ||
      typeof subscription.plan_id !== "string" || typeof subscription.status !== "string" || typeof subscription.past_due !== "boolean" ||
      ![subscription.current_period_start, subscription.current_period_end, subscription.canceled_at ?? null].every((value) => value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0))) throw unavailable();
  }
  return { id: customerId, subscriptions: data.subscriptions.map((subscription) => ({
    id: subscription.id, plan_id: subscription.plan_id, status: subscription.status, past_due: subscription.past_due,
    current_period_start: subscription.current_period_start, current_period_end: subscription.current_period_end,
    canceled_at: subscription.canceled_at ?? null,
  })), paymentMethod: paymentMethodSummary(data.payment_method) };
}

async function customerForWorkspace(env: AutumnEnv, accountId: string) {
  const account = await env.APP_DB.prepare("SELECT a.name,a.email FROM app_accounts a JOIN app_workspaces w ON w.account_id=a.id WHERE a.id=? AND w.mode='hosted'")
    .bind(accountId).first<{ name: string; email: string }>();
  if (!account) throw new AppError(404, "Workspace not found.");
  // Verified sign-in resolves the billing identity before any checkout or portal
  // operation. Never invent a second customer for an existing subscriber.
  const mapping = await env.APP_DB.prepare("SELECT customer_id FROM app_autumn_customers WHERE account_id=?").bind(accountId).first<{ customer_id: string }>();
  if (!mapping) throw new AppError(409, "Sign in again to link your existing billing account before continuing.");
  const customer = await autumnRequest(env, "customers.get_or_create", { customer_id: mapping.customer_id, name: account.name, email: account.email });
  if (customer.id !== mapping.customer_id) throw unavailable();
  return mapping.customer_id;
}
function billingUrl(value: unknown) {
  if (typeof value !== "string") throw unavailable();
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password ||
    !["stripe.com", "useautumn.com"].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw unavailable();
  return url.href;
}

/** Call only after verifying workspace owner and same-origin mutation. Return URL
 * must be supplied by server configuration, never copied from request JSON. */
export async function createAutumnCheckout(env: AutumnEnv, accountId: string, returnUrl: string, plan: "pro" | "scale" = "pro") {
  const target = subscriptionPlans(env).find((candidate) => candidate.id === plan);
  if (!target) throw unavailable();
  if (await hasActiveComplimentaryPro(env, accountId))
    throw new AppError(409, "Your complimentary Pro plan is active until its displayed end date.");
  const customerId = await customerForWorkspace(env, accountId);
  const customer = await getAutumnCustomer(env, customerId);
  const subscriptionPlanIds = subscriptionPlans(env).map((candidate) => candidate.planId);
  if (customer.subscriptions.some((subscription) => subscriptionPlanIds.includes(subscription.plan_id) &&
    !["expired", "canceled"].includes(subscription.status))) {
    // Includes scheduled, past-due and cancel-at-period-end subscriptions on
    // any paid plan. Terminal history permits a new purchase; all other states
    // stay in the existing portal, including unknown states, rather than risk
    // a duplicate or an unreviewed plan switch.
    return createAutumnPortal(env, accountId, returnUrl);
  }
  const result = await autumnRequest(env, "billing.attach", {
    customer_id: customerId, plan_id: target.planId,
    redirect_mode: "always", success_url: returnUrl, enable_plan_immediately: false,
  });
  if (result.customer_id !== customerId) throw unavailable();
  return { url: billingUrl(result.payment_url) };
}

/** Pay-as-you-go purchase through hosted checkout. The wallet is credited only
 * after reconciliation verifies the paid invoice, never on return. */
export async function createAutumnTopUpCheckout(env: AutumnEnv, accountId: string, returnUrl: string, amountCents: number) {
  if (!env.AUTUMN_TOPUP_PLAN_ID) throw unavailable();
  if (!isValidTopUpCents(amountCents)) throw new AppError(400, "Top-ups are whole dollar amounts between $5 and $1,000.");
  const customerId = await customerForWorkspace(env, accountId);
  const result = await autumnRequest(env, "billing.attach", {
    customer_id: customerId, plan_id: env.AUTUMN_TOPUP_PLAN_ID,
    redirect_mode: "always", success_url: returnUrl,
    feature_quantities: [{ feature_id: "credits", quantity: centsToCredits(amountCents) }],
  });
  if (result.customer_id !== customerId) throw unavailable();
  return { url: billingUrl(result.payment_url) };
}

/** Save or replace a payment method without purchasing anything. Automatic
 * top-ups charge the saved method, so this is their prerequisite. */
export async function createAutumnPaymentSetup(env: AutumnEnv, accountId: string, returnUrl: string) {
  const customerId = await customerForWorkspace(env, accountId);
  const result = await autumnRequest(env, "billing.setup_payment", { customer_id: customerId, success_url: returnUrl });
  if (result.customer_id !== customerId) throw unavailable();
  return { url: billingUrl(result.url) };
}

/** Charge the saved payment method for an automatic top-up. Callers must have
 * claimed the attempt first; the wallet is credited only via reconciliation. */
export async function chargeAutumnAutoTopUp(env: AutumnEnv, customerId: string, amountCents: number):
  Promise<{ charged: boolean; invoiceId: string | null; reason: string | null }> {
  if (!env.AUTUMN_TOPUP_PLAN_ID) throw unavailable();
  if (!isValidTopUpCents(amountCents)) throw new AppError(400, "Top-ups are whole dollar amounts between $5 and $1,000.");
  const result = await autumnRequest(env, "billing.attach", {
    customer_id: customerId, plan_id: env.AUTUMN_TOPUP_PLAN_ID,
    redirect_mode: "never",
    feature_quantities: [{ feature_id: "credits", quantity: centsToCredits(amountCents) }],
  });
  if (result.customer_id !== customerId) throw unavailable();
  const action = result.required_action as { code?: unknown; reason?: unknown } | null | undefined;
  const invoice = result.invoice as { status?: unknown; stripe_id?: unknown } | null | undefined;
  const invoiceId = invoice && typeof invoice.stripe_id === "string" ? invoice.stripe_id : null;
  if (action && typeof action === "object" && typeof action.code === "string")
    return { charged: false, invoiceId, reason: action.code };
  if (invoice && invoice.status === "paid" && invoiceId) return { charged: true, invoiceId, reason: null };
  // An accepted charge that is still processing settles through reconciliation.
  return { charged: false, invoiceId, reason: typeof invoice?.status === "string" ? `invoice_${invoice.status}` : "unknown" };
}

export async function createAutumnPortal(env: AutumnEnv, accountId: string, returnUrl: string) {
  if (await hasActiveComplimentaryPro(env, accountId))
    throw new AppError(409, "Your complimentary Pro plan does not have a paid subscription to manage.");
  const customerId = await customerForWorkspace(env, accountId);
  const result = await autumnRequest(env, "billing.open_customer_portal", { customer_id: customerId, return_url: returnUrl });
  if (result.customer_id !== customerId) throw unavailable();
  return { url: billingUrl(result.url) };
}
