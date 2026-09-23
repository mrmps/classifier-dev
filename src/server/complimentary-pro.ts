import { BILLING_PLANS } from "../lib/billing";
import { AppError, type AppEnv } from "./db";

type Grant = {
  email: string;
  starts_at: string;
  ends_at: string;
  account_id: string | null;
  last_period_start: string | null;
};

function period(grant: Grant, now: Date) {
  const start = new Date(grant.starts_at);
  const end = new Date(grant.ends_at);
  if (now < start || now >= end) return null;
  let current = start;
  let next = start;
  for (let month = 1; month <= 12; month++) {
    const year = start.getUTCFullYear();
    const targetMonth = start.getUTCMonth() + month;
    const lastDay = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();
    next = new Date(Date.UTC(year, targetMonth, Math.min(start.getUTCDate(), lastDay),
      start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(), start.getUTCMilliseconds()));
    if (next > now) break;
    current = next;
  }
  return { start: current.toISOString(), end: new Date(Math.min(next.getTime(), end.getTime())).toISOString() };
}

export async function hasActiveComplimentaryPro(env: AppEnv, accountId: string, now = new Date()): Promise<boolean> {
  const timestamp = now.toISOString();
  const row = await env.APP_DB.prepare(`SELECT 1 FROM app_complimentary_pro c JOIN app_accounts a
      ON c.account_id=a.id OR (c.account_id IS NULL AND lower(a.email)=c.email)
    WHERE a.id=? AND c.starts_at<=? AND c.ends_at>?
    AND NOT EXISTS(SELECT 1 FROM app_autumn_grants g WHERE g.account_id=a.id AND g.period_end>? AND g.revoked_at IS NULL)`)
    .bind(accountId, timestamp, timestamp, now.getTime()).first();
  return !!row;
}

/** The verified sign-in identity claims a preapproved grant; the same function
 * renews its allowance on a cron and removes it at the fixed end date. */
export async function syncComplimentaryPro(env: AppEnv, email: string, accountId: string, now = new Date()): Promise<void> {
  const normalized = email.trim().toLowerCase();
  let grant = await env.APP_DB.prepare("SELECT * FROM app_complimentary_pro WHERE email=?").bind(normalized).first<Grant>();
  if (!grant) return;
  if (grant.account_id && grant.account_id !== accountId) throw new AppError(409, "Complimentary plan belongs to another account.");
  const timestamp = now.toISOString();
  if (!grant.account_id && !grant.last_period_start) {
    const end = new Date(now);
    end.setUTCFullYear(end.getUTCFullYear() + 1);
    const claimed = await env.APP_DB.prepare(`UPDATE app_complimentary_pro SET account_id=?,starts_at=?,ends_at=?
      WHERE email=? AND account_id IS NULL AND last_period_start IS NULL
      AND EXISTS(SELECT 1 FROM app_accounts WHERE id=? AND lower(email)=?)
      AND NOT EXISTS(SELECT 1 FROM app_autumn_grants WHERE account_id=? AND period_end>? AND revoked_at IS NULL)
      RETURNING *`)
      .bind(accountId, timestamp, end.toISOString(), normalized, accountId, normalized, accountId, now.getTime()).first<Grant>();
    grant = claimed ?? await env.APP_DB.prepare("SELECT * FROM app_complimentary_pro WHERE email=?").bind(normalized).first<Grant>();
    if (grant?.account_id && grant.account_id !== accountId)
      throw new AppError(409, "Complimentary plan belongs to another account.");
    if (!grant?.account_id) {
      const paid = await env.APP_DB.prepare("SELECT 1 FROM app_autumn_grants WHERE account_id=? AND period_end>? AND revoked_at IS NULL")
        .bind(accountId, now.getTime()).first();
      if (paid) return;
      throw new AppError(503, "Complimentary plan could not be claimed.");
    }
  }
  const active = period(grant, now);
  if (!active) {
    if (now < new Date(grant.starts_at) || !grant.account_id) return;
    await env.APP_DB.batch([
      env.APP_DB.prepare("SELECT id FROM app_accounts WHERE id=? FOR UPDATE").bind(accountId),
      env.APP_DB.prepare(`UPDATE app_accounts SET balance=paid_balance,billing_plan='free',scheduled_plan=NULL,cancel_at_period_end=0,billing_revision=billing_revision+1
        WHERE id=? AND billing_plan='pro' AND NOT EXISTS(SELECT 1 FROM app_usage WHERE account_id=? AND status='pending')
        AND NOT EXISTS(SELECT 1 FROM app_autumn_grants WHERE account_id=? AND period_end>? AND revoked_at IS NULL)`)
        .bind(accountId, accountId, accountId, now.getTime()),
    ]);
    return;
  }
  if (grant.last_period_start === active.start) return;
  const operation = crypto.randomUUID();
  const result = await env.APP_DB.batch([
    env.APP_DB.prepare("SELECT id FROM app_accounts WHERE id=? FOR UPDATE").bind(accountId),
    env.APP_DB.prepare(`UPDATE app_complimentary_pro SET account_id=?,last_period_start=?,operation_id=? WHERE email=?
      AND (account_id IS NULL OR account_id=?) AND (last_period_start IS NULL OR last_period_start<?)
      AND NOT EXISTS(SELECT 1 FROM app_usage WHERE account_id=? AND status='pending')
      AND NOT EXISTS(SELECT 1 FROM app_autumn_grants WHERE account_id=? AND period_end>? AND revoked_at IS NULL)`)
      .bind(accountId, active.start, operation, normalized, accountId, active.start, accountId, accountId, now.getTime()),
    env.APP_DB.prepare(`UPDATE app_accounts SET balance=paid_balance+?,billing_plan='pro',billing_hold=FALSE,
      period_start=?,reset_at=?,scheduled_plan=?,cancel_at_period_end=?,billing_revision=billing_revision+1
      WHERE id=? AND EXISTS(SELECT 1 FROM app_complimentary_pro WHERE email=? AND account_id=? AND operation_id=?)`)
      .bind(BILLING_PLANS.pro.includedCredits, active.start, active.end, active.end === grant.ends_at ? "free" : null,
        active.end === grant.ends_at ? 1 : 0, accountId, normalized, accountId, operation),
    env.APP_DB.prepare(`INSERT INTO app_transactions(id,account_id,idempotency_key,kind,amount_cents,credits,created_at,plan_id)
      SELECT ?,?,?,'subscription',0,?,?,'pro' WHERE EXISTS(SELECT 1 FROM app_complimentary_pro WHERE email=? AND account_id=? AND operation_id=?) ON CONFLICT DO NOTHING`)
      .bind(operation, accountId, `complimentary:${normalized}:${active.start}`, BILLING_PLANS.pro.includedCredits, timestamp,
        normalized, accountId, operation),
  ]);
  if (!result[1].meta.changes) throw new AppError(503, "Complimentary plan renewal is awaiting pending usage or paid billing.");
}

export async function syncComplimentaryProAccounts(env: AppEnv): Promise<void> {
  const grants = await env.APP_DB.prepare("SELECT email,account_id FROM app_complimentary_pro WHERE account_id IS NOT NULL")
    .all<{ email: string; account_id: string }>();
  for (const grant of grants.results) await syncComplimentaryPro(env, grant.email, grant.account_id);
}
