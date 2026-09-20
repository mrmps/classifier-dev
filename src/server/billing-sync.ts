import { autumnRequest, getAutumnCustomer, type AutumnEnv } from "./autumn";
import { AppError } from "./db";

/** Fetch current state rather than trusting an out-of-order webhook snapshot.
 * A monotonically increasing local revision fences slower concurrent fetches. */
export async function reconcileAutumnCustomer(env: AutumnEnv, customerId: string) {
  if (!env.AUTUMN_PRO_PLAN_ID) throw new AppError(503, "Billing plan is not configured.");
  const mapping = await env.APP_DB.prepare("UPDATE app_autumn_customers SET revision=revision+1 WHERE customer_id=? RETURNING revision,account_id")
    .bind(customerId).first<{ revision: number; account_id: string }>();
  // Unmapped customers belong to the old deployment or another application.
  if (!mapping) return false;
  const customer = await getAutumnCustomer(env, customerId);
  await env.APP_DB.prepare("UPDATE app_autumn_customers SET snapshot=?::jsonb,synced_at=?,reconciliation_required=TRUE WHERE customer_id=? AND revision=?")
    .bind(JSON.stringify(customer), new Date().toISOString(), customerId, mapping.revision).run();
  const active = customer.subscriptions.filter((subscription) => subscription.plan_id === env.AUTUMN_PRO_PLAN_ID && subscription.status === "active" && !subscription.past_due &&
    subscription.current_period_end !== null && subscription.current_period_end > Date.now());
  if (active.length > 1) throw new AppError(503, "Multiple subscriptions need reconciliation.");
  if (!active.length) {
    // Do not erase the one-time signup balance on accounts that never subscribed.
    // When a paid plan ends, its unused included allowance expires; purchased
    // funds are not touched. Pending requests must settle before this transition.
    const results = await env.APP_DB.batch([
      env.APP_DB.prepare("SELECT id FROM app_accounts WHERE id=? FOR UPDATE").bind(mapping.account_id),
      env.APP_DB.prepare(`UPDATE app_accounts SET balance=paid_balance,billing_plan='free',scheduled_plan=NULL,cancel_at_period_end=0,billing_revision=billing_revision+1
        WHERE id=? AND billing_plan='pro' AND NOT EXISTS(SELECT 1 FROM app_usage WHERE account_id=? AND status='pending')
        AND EXISTS(SELECT 1 FROM app_autumn_customers WHERE customer_id=? AND revision=?)`).bind(mapping.account_id, mapping.account_id, customerId, mapping.revision),
      env.APP_DB.prepare("SELECT billing_plan FROM app_accounts WHERE id=?").bind(mapping.account_id),
    ]);
    if (results[2].results[0]?.billing_plan === "pro") throw new AppError(503, "Subscription reconciliation is awaiting pending usage or a newer sync.");
    return true;
  }
  const subscription = active[0];
  const start = subscription.current_period_start, end = subscription.current_period_end;
  if (start === null || end === null || start > Date.now() || end <= Date.now() || end <= start) return true;
  // Paid status alone is insufficient: match the actual recurring base-plan
  // line and period. Unsupported discounts/prorations stay for reconciliation.
  const invoices = await autumnRequest(env, "invoices.list", { customer_id: customerId, status: ["paid"], limit: 100 });
  if (!Array.isArray(invoices.list)) throw new AppError(503, "Invalid billing invoice response.");
  const grant = await env.APP_DB.prepare("SELECT invoice_id FROM app_autumn_grants WHERE account_id=? AND period_start=?")
    .bind(mapping.account_id, start).first<{ invoice_id: string }>();
  const refunded = grant && invoices.list.find((invoice) => invoice?.customer_id === customerId && invoice.stripe_id === grant.invoice_id &&
    typeof invoice.refunded_amount === "number" && invoice.refunded_amount > 0);
  if (refunded) {
    await env.APP_DB.batch([
      env.APP_DB.prepare("SELECT id FROM app_accounts WHERE id=? FOR UPDATE").bind(mapping.account_id),
      env.APP_DB.prepare(`UPDATE app_accounts SET billing_hold=TRUE WHERE id=? AND EXISTS(SELECT 1 FROM app_autumn_customers WHERE customer_id=? AND revision=?)`)
        .bind(mapping.account_id, customerId, mapping.revision),
      env.APP_DB.prepare(`UPDATE app_autumn_grants SET revoked_at=? WHERE invoice_id=? AND EXISTS(SELECT 1 FROM app_accounts WHERE id=? AND billing_hold=TRUE)`)
        .bind(new Date().toISOString(), grant.invoice_id, mapping.account_id),
      env.APP_DB.prepare(`UPDATE app_accounts SET balance=paid_balance WHERE id=? AND billing_hold=TRUE AND NOT EXISTS(SELECT 1 FROM app_usage WHERE account_id=? AND status='pending')`)
        .bind(mapping.account_id, mapping.account_id),
    ]);
    return true;
  }
  const invoice = invoices.list.find((invoice) => invoice && typeof invoice === "object" &&
    invoice.customer_id === customerId && invoice.entity_id === null && invoice.status === "paid" &&
    invoice.currency === "usd" && invoice.amount_paid === 20 && invoice.total === 20 && invoice.refunded_amount === 0 &&
    typeof invoice.stripe_id === "string" && Array.isArray(invoice.items) && invoice.items.length === 1 &&
    invoice.items[0]?.plan_id === env.AUTUMN_PRO_PLAN_ID && invoice.items[0]?.feature_id === null &&
    invoice.items[0]?.amount === 20 && invoice.items[0]?.period_start === start && invoice.items[0]?.period_end === end);
  if (!invoice) throw new AppError(503, "A paid invoice for this billing period is not available yet.");
  const operation = crypto.randomUUID(), timestamp = new Date().toISOString();
  const results = await env.APP_DB.batch([
    env.APP_DB.prepare("SELECT id FROM app_accounts WHERE id=? FOR UPDATE").bind(mapping.account_id),
    env.APP_DB.prepare(`INSERT INTO app_autumn_grants(invoice_id,account_id,period_start,period_end,operation_id,created_at)
      SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM app_autumn_customers WHERE customer_id=? AND revision=?)
      AND NOT EXISTS(SELECT 1 FROM app_usage WHERE account_id=? AND status='pending')
      AND NOT EXISTS(SELECT 1 FROM app_autumn_grants WHERE account_id=? AND period_start>=?) ON CONFLICT DO NOTHING`)
      .bind(invoice.stripe_id, mapping.account_id, start, end, operation, timestamp, customerId, mapping.revision, mapping.account_id, mapping.account_id, start),
    env.APP_DB.prepare(`UPDATE app_accounts SET balance=paid_balance+2000000,billing_hold=FALSE,billing_plan='pro',period_start=?,reset_at=?,
      scheduled_plan=NULL,cancel_at_period_end=0,billing_revision=billing_revision+1
      WHERE id=? AND EXISTS(SELECT 1 FROM app_autumn_grants WHERE operation_id=?)`)
      .bind(new Date(start).toISOString(), new Date(end).toISOString(), mapping.account_id, operation),
    env.APP_DB.prepare(`INSERT INTO app_transactions(id,account_id,idempotency_key,kind,amount_cents,credits,created_at,plan_id)
      SELECT ?,?,?,'subscription',2000,2000000,?,'pro' WHERE EXISTS(SELECT 1 FROM app_autumn_grants WHERE operation_id=?)`)
      .bind(crypto.randomUUID(), mapping.account_id, `autumn:${invoice.stripe_id}`, timestamp, operation),
    env.APP_DB.prepare("SELECT invoice_id FROM app_autumn_grants WHERE account_id=? AND period_start=?").bind(mapping.account_id, start),
  ]);
  if (!results[4].results.length) throw new AppError(503, "Subscription reconciliation is awaiting pending usage or a newer sync.");
  await env.APP_DB.prepare("UPDATE app_autumn_customers SET reconciliation_required=FALSE WHERE customer_id=? AND revision=?").bind(customerId, mapping.revision).run();
  return true;
}

/** Repair missed webhooks without putting Autumn on the inference path. At most
 * ten customers/run and sixty provider calls/day globally. A failed attempt
 * consumes its budget too. Webhook-driven reconciliation is separate. */
export async function syncAutumnAccounts(env: AutumnEnv) {
  if (!env.AUTUMN_SECRET_KEY || !env.AUTUMN_PRO_PLAN_ID) return { synced: 0, failed: 0 };
  const day = new Date().toISOString().slice(0, 10);
  await env.APP_DB.prepare("INSERT INTO app_autumn_sync_budget(day) VALUES(?) ON CONFLICT DO NOTHING").bind(day).run();
  const candidates = await env.APP_DB.prepare("SELECT customer_id FROM app_autumn_customers ORDER BY synced_at NULLS FIRST LIMIT 10")
    .all<{ customer_id: string }>();
  let synced = 0, failed = 0;
  for (const candidate of candidates.results) {
    const budget = await env.APP_DB.prepare("UPDATE app_autumn_sync_budget SET calls=calls+2 WHERE day=? AND calls<=58 RETURNING calls").bind(day).first();
    if (!budget) break;
    try { await reconcileAutumnCustomer(env, candidate.customer_id); synced++; }
    catch { failed++; }
  }
  return { synced, failed };
}
