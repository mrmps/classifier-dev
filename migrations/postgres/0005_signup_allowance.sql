ALTER TABLE app_accounts ADD COLUMN signup_granted_at TEXT;

-- Preserve grants already consumed or replaced by a paid plan. An account that
-- only signed in before activation has no funds or billing/usage history and is
-- still eligible for its one-time allowance when accounts are enabled.
UPDATE app_accounts a SET signup_granted_at=a.created_at
WHERE a.balance>0 OR a.paid_balance>0 OR a.billing_plan!='free'
 OR EXISTS(SELECT 1 FROM app_usage u WHERE u.account_id=a.id)
 OR EXISTS(SELECT 1 FROM app_transactions t WHERE t.account_id=a.id);
