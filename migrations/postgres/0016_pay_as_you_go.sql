-- Pay-as-you-go top-ups. A purchase becomes spendable only after its paid
-- invoice is verified; the invoice id is the idempotency key for the grant.
CREATE TABLE app_autumn_topups (
 invoice_id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES app_accounts(id),
 credits BIGINT NOT NULL CHECK(credits > 0),
 amount_cents BIGINT NOT NULL CHECK(amount_cents > 0),
 kind TEXT NOT NULL CHECK(kind IN ('top_up','auto_top_up')),
 operation_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 revoked_at TEXT
);
CREATE INDEX app_autumn_topups_account ON app_autumn_topups(account_id,created_at);
-- Every automatic charge is claimed here first: the claim is the single-flight
-- lock, the failure cooldown, and the calendar-month spending-cap ledger.
CREATE TABLE app_auto_topup_attempts (
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES app_accounts(id),
 month TEXT NOT NULL,
 amount_cents BIGINT NOT NULL CHECK(amount_cents > 0),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','charged','failed')),
 invoice_id TEXT,
 reason TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT
);
CREATE INDEX app_auto_topup_attempts_account ON app_auto_topup_attempts(account_id,month,created_at);
