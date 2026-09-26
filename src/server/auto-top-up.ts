import { chargeAutumnAutoTopUp, type AutumnEnv } from "./autumn";
import { reconcileAutumnCustomer } from "./billing-sync";
import { TOP_UP_MAX_CENTS, TOP_UP_MIN_CENTS } from "../lib/billing";

/** One in-flight charge at a time; a stale claim stops blocking after this. */
const SINGLE_FLIGHT_MS = 15 * 60 * 1000;
/** A declined card must not be retried on every request. */
const FAILURE_COOLDOWN_MS = 60 * 60 * 1000;

/** Charge the saved payment method when the balance falls below the owner's
 * threshold. The attempt row is claimed first inside one statement: it is the
 * single-flight lock, the failure cooldown and the calendar-month cap ledger,
 * so no sequence of concurrent settlements can double-charge or exceed the cap.
 * The wallet itself is only ever credited by invoice-verified reconciliation. */
export async function maybeAutoTopUp(env: AutumnEnv, accountId: string): Promise<boolean> {
  if (env.APP_ACCOUNTS_ENABLED !== "true" || !env.AUTUMN_SECRET_KEY || !env.AUTUMN_TOPUP_PLAN_ID) return false;
  const now = new Date();
  const claim = await env.APP_DB.prepare(`INSERT INTO app_auto_topup_attempts(id,account_id,month,amount_cents,created_at)
    SELECT ?,a.id,?,a.auto_top_up_amount_cents,? FROM app_accounts a
    WHERE a.id=? AND a.auto_top_up_enabled=1 AND NOT a.billing_hold
    AND a.balance<a.auto_top_up_threshold_cents::bigint*1000
    AND a.auto_top_up_amount_cents BETWEEN ? AND ? AND a.auto_top_up_amount_cents%100=0
    AND NOT EXISTS(SELECT 1 FROM app_auto_topup_attempts p WHERE p.account_id=a.id AND p.status='pending' AND p.created_at>?)
    AND NOT EXISTS(SELECT 1 FROM app_auto_topup_attempts f WHERE f.account_id=a.id AND f.status='failed' AND f.created_at>?)
    AND (a.auto_top_up_cap_cents<=0 OR a.auto_top_up_amount_cents+(SELECT COALESCE(SUM(x.amount_cents),0)
      FROM app_auto_topup_attempts x WHERE x.account_id=a.id AND x.month=? AND x.status IN ('pending','charged'))<=a.auto_top_up_cap_cents)
    RETURNING id,amount_cents`)
    .bind(crypto.randomUUID(), now.toISOString().slice(0, 7), now.toISOString(), accountId,
      TOP_UP_MIN_CENTS, TOP_UP_MAX_CENTS,
      new Date(now.getTime() - SINGLE_FLIGHT_MS).toISOString(),
      new Date(now.getTime() - FAILURE_COOLDOWN_MS).toISOString(),
      now.toISOString().slice(0, 7))
    .first<{ id: string; amount_cents: number }>();
  if (!claim) return false;
  const settle = (status: "charged" | "failed", invoiceId: string | null, reason: string | null) =>
    env.APP_DB.prepare("UPDATE app_auto_topup_attempts SET status=?,invoice_id=?,reason=?,updated_at=? WHERE id=? AND status='pending'")
      .bind(status, invoiceId, reason, new Date().toISOString(), claim.id).run();
  const mapping = await env.APP_DB.prepare("SELECT customer_id FROM app_autumn_customers WHERE account_id=?")
    .bind(accountId).first<{ customer_id: string }>();
  if (!mapping) { await settle("failed", null, "no_billing_identity"); return false; }
  let charge: Awaited<ReturnType<typeof chargeAutumnAutoTopUp>>;
  try { charge = await chargeAutumnAutoTopUp(env, mapping.customer_id, claim.amount_cents); }
  catch {
    // A timeout can mean the provider accepted the charge. The claim stays
    // pending: it keeps counting against the monthly cap, and if an invoice
    // exists reconciliation will still verify and credit it.
    await env.APP_DB.prepare("UPDATE app_auto_topup_attempts SET reason='provider_unavailable',updated_at=? WHERE id=? AND status='pending'")
      .bind(new Date().toISOString(), claim.id).run();
    return false;
  }
  if (!charge.charged) { await settle("failed", charge.invoiceId, charge.reason); return false; }
  await env.APP_DB.prepare("UPDATE app_auto_topup_attempts SET invoice_id=?,updated_at=? WHERE id=? AND status='pending'")
    .bind(charge.invoiceId, new Date().toISOString(), claim.id).run();
  // Credit promptly; the webhook and the scheduled sweep are the backstops.
  try { await reconcileAutumnCustomer(env, mapping.customer_id); } catch { /* retryable */ }
  return true;
}

/** Scheduled backstop for balances that fell below their threshold without a
 * settlement trigger. The claim statement enforces every limit again. */
export async function sweepAutoTopUps(env: AutumnEnv): Promise<{ attempted: number }> {
  if (env.APP_ACCOUNTS_ENABLED !== "true" || !env.AUTUMN_SECRET_KEY || !env.AUTUMN_TOPUP_PLAN_ID) return { attempted: 0 };
  const candidates = await env.APP_DB.prepare(`SELECT id FROM app_accounts
    WHERE auto_top_up_enabled=1 AND NOT billing_hold AND balance<auto_top_up_threshold_cents::bigint*1000 LIMIT 5`)
    .all<{ id: string }>();
  let attempted = 0;
  for (const candidate of candidates.results) {
    try { if (await maybeAutoTopUp(env, candidate.id)) attempted++; }
    catch { /* the next sweep retries */ }
  }
  return { attempted };
}
