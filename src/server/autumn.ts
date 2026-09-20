import { AppError, type AppEnv } from "./db";

export type AutumnEnv = AppEnv & {
  AUTUMN_SECRET_KEY?: string;
  AUTUMN_WEBHOOK_SECRET?: string;
  AUTUMN_PRO_PLAN_ID?: string;
  APP_ORIGIN?: string;
};
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
  }>;
};
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
  const data = await autumnRequest(env, "customers.get", { customer_id: customerId });
  if (data.id !== customerId || !Array.isArray(data.subscriptions)) throw unavailable();
  for (const subscription of data.subscriptions) {
    if (!subscription || typeof subscription !== "object" || typeof subscription.id !== "string" ||
      typeof subscription.plan_id !== "string" || typeof subscription.status !== "string" || typeof subscription.past_due !== "boolean" ||
      ![subscription.current_period_start, subscription.current_period_end].every((value) => value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0))) throw unavailable();
  }
  return { id: customerId, subscriptions: data.subscriptions.map((subscription) => ({
    id: subscription.id, plan_id: subscription.plan_id, status: subscription.status, past_due: subscription.past_due,
    current_period_start: subscription.current_period_start, current_period_end: subscription.current_period_end,
  })) };
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
export async function createAutumnCheckout(env: AutumnEnv, accountId: string, returnUrl: string) {
  if (!env.AUTUMN_PRO_PLAN_ID) throw unavailable();
  const customerId = await customerForWorkspace(env, accountId);
  const customer = await getAutumnCustomer(env, customerId);
  if (customer.subscriptions.some((subscription) => subscription.plan_id === env.AUTUMN_PRO_PLAN_ID)) {
    // Includes scheduled, past-due and cancel-at-period-end subscriptions.
    // Let the existing subscription's portal resolve them rather than attach again.
    return createAutumnPortal(env, accountId, returnUrl);
  }
  const result = await autumnRequest(env, "billing.attach", {
    customer_id: customerId, plan_id: env.AUTUMN_PRO_PLAN_ID,
    redirect_mode: "always", success_url: returnUrl, enable_plan_immediately: false,
  });
  if (result.customer_id !== customerId) throw unavailable();
  return { url: billingUrl(result.payment_url) };
}

export async function createAutumnPortal(env: AutumnEnv, accountId: string, returnUrl: string) {
  const customerId = await customerForWorkspace(env, accountId);
  const result = await autumnRequest(env, "billing.open_customer_portal", { customer_id: customerId, return_url: returnUrl });
  if (result.customer_id !== customerId) throw unavailable();
  return { url: billingUrl(result.url) };
}
