import { billingCustomerId } from "../billing-identity";
import { autumnRequest, type AutumnEnv } from "./autumn";
import { reconcileAutumnCustomer } from "./billing-sync";
import { AppError } from "./db";

/** Called with WorkOS's authenticated user, never a browser-supplied email.
 * Existing free and paid customers keep their original Autumn/Stripe identity.
 * A failed first reconciliation stays pending and is retried on the next visit. */
export async function linkPersonalBilling(
  user: { id: string; email: string; emailVerified: boolean },
  env: AutumnEnv,
): Promise<void> {
  if (!user.emailVerified) throw new AppError(403, "Verify your email before opening your account.");
  if (!env.BILLING_SIGNING_KEY || !env.AUTUMN_SECRET_KEY || !env.AUTUMN_PRO_PLAN_ID)
    throw new AppError(503, "Billing identity verification is unavailable. Please try again.");
  const accountId = `workos:${user.id}`;
  type Mapping = { customer_id: string; identity_verified_at: string | null };
  const read = () => env.APP_DB.prepare("SELECT customer_id,identity_verified_at FROM app_autumn_customers WHERE account_id=?")
    .bind(accountId).first<Mapping>();
  let mapping = await read();
  if (!mapping) {
    const customerId = await billingCustomerId(user.email, env.BILLING_SIGNING_KEY);
    await env.APP_DB.prepare("INSERT INTO app_autumn_customers(account_id,customer_id) VALUES(?,?) ON CONFLICT DO NOTHING")
      .bind(accountId, customerId).run();
    mapping = await read();
    // A customer may only belong to one identity, even during concurrent claims.
    if (!mapping || mapping.customer_id !== customerId)
      throw new AppError(409, "This billing account is already linked. Contact support to recover access.");
  }
  if (mapping.identity_verified_at) return;
  if (mapping.customer_id !== await billingCustomerId(user.email, env.BILLING_SIGNING_KEY))
    throw new AppError(409, "Your billing accounts need reconciliation. Contact support before starting another subscription.");
  const customer = await autumnRequest(env, "customers.get_or_create", { customer_id: mapping.customer_id, email: user.email.trim().toLowerCase() });
  if (customer.id !== mapping.customer_id) throw new AppError(503, "Billing identity verification failed. Please try again.");
  await reconcileAutumnCustomer(env, mapping.customer_id);
  await env.APP_DB.prepare("UPDATE app_autumn_customers SET identity_verified_at=? WHERE account_id=? AND customer_id=?")
    .bind(new Date().toISOString(), accountId, mapping.customer_id).run();
}
