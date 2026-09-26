import { autumnRequest, getAutumnCustomer, subscriptionPlans, type AutumnEnv, type SubscriptionPlan } from "./autumn";
import { centsToCredits } from "../lib/billing";
import { AppError } from "./db";
import { hasActiveComplimentaryPro } from "./complimentary-pro";

type Mapping = { revision: number; account_id: string };

/** A paid one-off top-up invoice credits purchased funds exactly once, keyed by
 * its invoice id. A later refund removes the same amount exactly once; already
 * consumed usage is not reverse-charged and the balance may go negative. */
async function reconcileTopUps(env: AutumnEnv, customerId: string, mapping: Mapping, invoices: unknown[]) {
  if (!env.AUTUMN_TOPUP_PLAN_ID) return;
  for (const invoice of invoices) {
    if (!invoice || typeof invoice !== "object") continue;
    const record = invoice as Record<string, unknown>;
    const items = record.items;
    if (record.customer_id !== customerId || record.entity_id !== null || record.status !== "paid" ||
      record.currency !== "usd" || typeof record.stripe_id !== "string" ||
      !Array.isArray(items) || items.length !== 1) continue;
    const item = items[0] as Record<string, unknown> | null;
    if (!item || typeof item !== "object" || item.plan_id !== env.AUTUMN_TOPUP_PLAN_ID) continue;
    // From here on the invoice claims to be a top-up; anything malformed must
    // surface as a retryable failure rather than being silently skipped.
    const cents = typeof record.total === "number" ? Math.round(record.total * 100) : NaN;
    const quantity = typeof item.quantity === "number" ? item.quantity : NaN;
    if (!Number.isSafeInteger(cents) || cents <= 0 || record.amount_paid !== record.total ||
      item.amount !== record.total || !Number.isSafeInteger(quantity) || quantity !== centsToCredits(cents) ||
      typeof record.refunded_amount !== "number")
      throw new AppError(503, "A top-up invoice needs manual reconciliation.");
    const timestamp = new Date().toISOString();
    if (record.refunded_amount > 0) {
      // The batch is one serializable transaction: the timestamp written by the
      // revoke is what authorizes the matching wallet deduction, exactly once.
      await env.APP_DB.batch([
        env.APP_DB.prepare("SELECT id FROM app_accounts WHERE id=? FOR UPDATE").bind(mapping.account_id),
        env.APP_DB.prepare(`UPDATE app_autumn_topups SET revoked_at=? WHERE invoice_id=? AND account_id=? AND revoked_at IS NULL
          AND EXISTS(SELECT 1 FROM app_autumn_customers WHERE customer_id=? AND revision=?)`)
          .bind(timestamp, record.stripe_id, mapping.account_id, customerId, mapping.revision),
        env.APP_DB.prepare(`UPDATE app_accounts a SET balance=a.balance-t.credits,paid_balance=a.paid_balance-t.credits,billing_revision=a.billing_revision+1
          FROM app_autumn_topups t WHERE t.invoice_id=? AND t.revoked_at=? AND a.id=t.account_id`)
          .bind(record.stripe_id, timestamp),
      ]);
      continue;
    }
    const operation = crypto.randomUUID();
    await env.APP_DB.batch([
      env.APP_DB.prepare("SELECT id FROM app_accounts WHERE id=? FOR UPDATE").bind(mapping.account_id),
      env.APP_DB.prepare(`INSERT INTO app_autumn_topups(invoice_id,account_id,credits,amount_cents,kind,operation_id,created_at)
        SELECT ?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM app_auto_topup_attempts WHERE invoice_id=? AND account_id=?) THEN 'auto_top_up' ELSE 'top_up' END,?,?
        WHERE EXISTS(SELECT 1 FROM app_autumn_customers WHERE customer_id=? AND revision=?) ON CONFLICT DO NOTHING`)
        .bind(record.stripe_id, mapping.account_id, quantity, cents, record.stripe_id, mapping.account_id, operation, timestamp, customerId, mapping.revision),
      env.APP_DB.prepare(`UPDATE app_accounts SET balance=balance+?,paid_balance=paid_balance+?,billing_revision=billing_revision+1
        WHERE id=? AND EXISTS(SELECT 1 FROM app_autumn_topups WHERE operation_id=?)`)
        .bind(quantity, quantity, mapping.account_id, operation),
      env.APP_DB.prepare(`INSERT INTO app_transactions(id,account_id,idempotency_key,kind,amount_cents,credits,created_at,plan_id)
        SELECT ?,?,?,t.kind,?,?,?,NULL FROM app_autumn_topups t WHERE t.operation_id=? ON CONFLICT DO NOTHING`)
        .bind(crypto.randomUUID(), mapping.account_id, `autumn:${record.stripe_id}`, cents, quantity, timestamp, operation),
      env.APP_DB.prepare("UPDATE app_auto_topup_attempts SET status='charged',updated_at=? WHERE invoice_id=? AND account_id=? AND status='pending'")
        .bind(timestamp, record.stripe_id, mapping.account_id),
    ]);
  }
}

/** Fetch current state rather than trusting an out-of-order webhook snapshot.
 * A monotonically increasing local revision fences slower concurrent fetches. */
export async function reconcileAutumnCustomer(env: AutumnEnv, customerId: string) {
  const plans = subscriptionPlans(env);
  if (!plans.length) throw new AppError(503, "Billing plan is not configured.");
  const mapping = await env.APP_DB.prepare("UPDATE app_autumn_customers SET revision=revision+1,last_attempt_at=?,reconciliation_required=TRUE WHERE customer_id=? RETURNING revision,account_id")
    .bind(new Date().toISOString(), customerId).first<Mapping>();
  // Unmapped customers belong to the old deployment or another application.
  if (!mapping) return false;
  const customer = await getAutumnCustomer(env, customerId);
  const snapshot = await env.APP_DB.prepare("UPDATE app_autumn_customers SET snapshot=?::jsonb,synced_at=?,reconciliation_required=TRUE WHERE customer_id=? AND revision=?")
    .bind(JSON.stringify(customer), new Date().toISOString(), customerId, mapping.revision).run();
  if (!snapshot.meta.changes) throw new AppError(503, "Subscription reconciliation was superseded by a newer sync.");
  const finish = async () => {
    const result = await env.APP_DB.prepare("UPDATE app_autumn_customers SET reconciliation_required=FALSE WHERE customer_id=? AND revision=?")
      .bind(customerId, mapping.revision).run();
    if (!result.meta.changes) throw new AppError(503, "Subscription reconciliation was superseded by a newer sync.");
  };
  // An overdue payment flag is not cancellation. The current period's invoice
  // below determines whether an allowance was paid for, including during dunning.
  const planIds = plans.map((plan) => plan.planId);
  const paid = customer.subscriptions.filter((subscription) => planIds.includes(subscription.plan_id) && subscription.status === "active");
  if (paid.some((subscription) => subscription.current_period_start === null || subscription.current_period_end === null))
    throw new AppError(503, "The current billing period is not available yet.");
  const active = paid.filter((subscription) => subscription.current_period_end! > Date.now());
  if (active.length > 1) throw new AppError(503, "Multiple subscriptions need reconciliation.");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- provider JSON, narrowed by the matchers below
  let invoiceList: any[] = [];
  if (env.AUTUMN_TOPUP_PLAN_ID || active.length) {
    const invoices = await autumnRequest(env, "invoices.list", { customer_id: customerId, status: ["paid"], limit: 100 });
    if (!Array.isArray(invoices.list)) throw new AppError(503, "Invalid billing invoice response.");
    invoiceList = invoices.list;
  }
  // Purchased funds are independent of any subscription: verify them first so a
  // subscription in an unsupported state cannot delay a paid top-up.
  await reconcileTopUps(env, customerId, mapping, invoiceList);
  if (await hasActiveComplimentaryPro(env, mapping.account_id)) {
    // The complimentary grant manages the included allowance on its own cycle.
    await finish();
    return true;
  }
  if (!active.length) {
    // Do not erase the one-time signup balance on accounts that never subscribed.
    // When a paid plan ends, its unused included allowance expires; purchased
    // funds are not touched. Pending requests must settle before this transition.
    const results = await env.APP_DB.batch([
      env.APP_DB.prepare("SELECT id FROM app_accounts WHERE id=? FOR UPDATE").bind(mapping.account_id),
      env.APP_DB.prepare(`UPDATE app_accounts SET balance=paid_balance,billing_plan='free',scheduled_plan=NULL,cancel_at_period_end=0,billing_revision=billing_revision+1
        WHERE id=? AND billing_plan IN ('pro','scale') AND NOT EXISTS(SELECT 1 FROM app_usage WHERE account_id=? AND status='pending')
        AND EXISTS(SELECT 1 FROM app_autumn_customers WHERE customer_id=? AND revision=?)`).bind(mapping.account_id, mapping.account_id, customerId, mapping.revision),
      env.APP_DB.prepare("SELECT billing_plan FROM app_accounts WHERE id=?").bind(mapping.account_id),
    ]);
    if (["pro", "scale"].includes(String(results[2].results[0]?.billing_plan))) throw new AppError(503, "Subscription reconciliation is awaiting pending usage or a newer sync.");
    await finish();
    return true;
  }
  const subscription = active[0];
  const plan = plans.find((candidate) => candidate.planId === subscription.plan_id) as SubscriptionPlan;
  const start = subscription.current_period_start, end = subscription.current_period_end;
  if (start === null || end === null || start > Date.now() || end <= Date.now() || end <= start)
    throw new AppError(503, "The current billing period is not available yet.");
  // Paid status alone is insufficient: match the actual recurring base-plan
  // line and period. Unsupported discounts/prorations stay for reconciliation.
  const grant = await env.APP_DB.prepare("SELECT invoice_id FROM app_autumn_grants WHERE account_id=? AND period_start=?")
    .bind(mapping.account_id, start).first<{ invoice_id: string }>();
  const refunded = grant && invoiceList.find((invoice) => invoice?.customer_id === customerId && invoice.stripe_id === grant.invoice_id &&
    typeof invoice.refunded_amount === "number" && invoice.refunded_amount > 0);
  if (refunded) {
    const results = await env.APP_DB.batch([
      env.APP_DB.prepare("SELECT id FROM app_accounts WHERE id=? FOR UPDATE").bind(mapping.account_id),
      env.APP_DB.prepare(`UPDATE app_accounts SET billing_hold=TRUE WHERE id=? AND EXISTS(SELECT 1 FROM app_autumn_customers WHERE customer_id=? AND revision=?)`)
        .bind(mapping.account_id, customerId, mapping.revision),
      env.APP_DB.prepare(`UPDATE app_autumn_grants SET revoked_at=? WHERE invoice_id=? AND EXISTS(SELECT 1 FROM app_accounts WHERE id=? AND billing_hold=TRUE)
        AND EXISTS(SELECT 1 FROM app_autumn_customers WHERE customer_id=? AND revision=?)`)
        .bind(new Date().toISOString(), grant.invoice_id, mapping.account_id, customerId, mapping.revision),
      env.APP_DB.prepare(`UPDATE app_accounts SET balance=paid_balance WHERE id=? AND billing_hold=TRUE AND NOT EXISTS(SELECT 1 FROM app_usage WHERE account_id=? AND status='pending')
        AND EXISTS(SELECT 1 FROM app_autumn_customers WHERE customer_id=? AND revision=?)`)
        .bind(mapping.account_id, mapping.account_id, customerId, mapping.revision),
    ]);
    // Commit the hold immediately, but keep delivery retryable until funds from
    // pending reservations have returned and the allowance can be removed.
    if (!results[3].meta.changes) throw new AppError(503, "Refund reconciliation is awaiting pending usage or a newer sync.");
    await finish();
    return true;
  }
  const invoice = invoiceList.find((invoice) => invoice && typeof invoice === "object" &&
    invoice.customer_id === customerId && invoice.entity_id === null && invoice.status === "paid" &&
    invoice.currency === "usd" && invoice.amount_paid === plan.amountUsd && invoice.total === plan.amountUsd && invoice.refunded_amount === 0 &&
    typeof invoice.stripe_id === "string" && Array.isArray(invoice.items) && invoice.items.length === 1 &&
    invoice.items[0]?.plan_id === plan.planId && invoice.items[0]?.feature_id === null &&
    invoice.items[0]?.amount === plan.amountUsd && invoice.items[0]?.period_start === start && invoice.items[0]?.period_end === end);
  if (!invoice) throw new AppError(503, "A paid invoice for this billing period is not available yet.");
  const operation = crypto.randomUUID(), timestamp = new Date().toISOString();
  const results = await env.APP_DB.batch([
    env.APP_DB.prepare("SELECT id FROM app_accounts WHERE id=? FOR UPDATE").bind(mapping.account_id),
    env.APP_DB.prepare(`INSERT INTO app_autumn_grants(invoice_id,account_id,period_start,period_end,operation_id,created_at)
      SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM app_autumn_customers WHERE customer_id=? AND revision=?)
      AND NOT EXISTS(SELECT 1 FROM app_usage WHERE account_id=? AND status='pending')
      AND NOT EXISTS(SELECT 1 FROM app_autumn_grants WHERE account_id=? AND period_start>=?) ON CONFLICT DO NOTHING`)
      .bind(invoice.stripe_id, mapping.account_id, start, end, operation, timestamp, customerId, mapping.revision, mapping.account_id, mapping.account_id, start),
    env.APP_DB.prepare(`UPDATE app_accounts SET balance=paid_balance+?,billing_hold=FALSE,billing_plan=?,period_start=?,reset_at=?,
      scheduled_plan=NULL,cancel_at_period_end=0,billing_revision=billing_revision+1
      WHERE id=? AND EXISTS(SELECT 1 FROM app_autumn_grants WHERE operation_id=?)`)
      .bind(plan.credits, plan.id, new Date(start).toISOString(), new Date(end).toISOString(), mapping.account_id, operation),
    env.APP_DB.prepare(`INSERT INTO app_transactions(id,account_id,idempotency_key,kind,amount_cents,credits,created_at,plan_id)
      SELECT ?,?,?,'subscription',?,?,?,? WHERE EXISTS(SELECT 1 FROM app_autumn_grants WHERE operation_id=?)`)
      .bind(crypto.randomUUID(), mapping.account_id, `autumn:${invoice.stripe_id}`, plan.cents, plan.credits, timestamp, plan.id, operation),
    env.APP_DB.prepare("SELECT invoice_id FROM app_autumn_grants WHERE account_id=? AND period_start=?").bind(mapping.account_id, start),
    // Schedule changes can occur after this period's allowance was granted.
    // Update only the schedule; never refill a spent balance on cancel/resume.
    env.APP_DB.prepare(`UPDATE app_accounts SET cancel_at_period_end=?,scheduled_plan=? WHERE id=? AND billing_plan=?
      AND EXISTS(SELECT 1 FROM app_autumn_customers WHERE customer_id=? AND revision=?)
      AND EXISTS(SELECT 1 FROM app_autumn_grants WHERE account_id=? AND period_start=? AND revoked_at IS NULL)`)
      .bind(subscription.canceled_at !== null ? 1 : 0, subscription.canceled_at !== null ? "free" : null,
        mapping.account_id, plan.id, customerId, mapping.revision, mapping.account_id, start),
  ]);
  if (!results[4].results.length) throw new AppError(503, "Subscription reconciliation is awaiting pending usage or a newer sync.");
  await finish();
  return true;
}

/** Repair missed webhooks without putting Autumn on the inference path. At most
 * ten customers/run and sixty provider calls/day globally. A failed attempt
 * consumes its budget too. Webhook-driven reconciliation is separate. */
export async function syncAutumnAccounts(env: AutumnEnv) {
  if (!env.AUTUMN_SECRET_KEY || !env.AUTUMN_PRO_PLAN_ID) return { synced: 0, failed: 0 };
  const day = new Date().toISOString().slice(0, 10);
  await env.APP_DB.prepare("INSERT INTO app_autumn_sync_budget(day) VALUES(?) ON CONFLICT DO NOTHING").bind(day).run();
  const candidates = await env.APP_DB.prepare("SELECT customer_id FROM app_autumn_customers ORDER BY last_attempt_at NULLS FIRST,customer_id LIMIT 10")
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
