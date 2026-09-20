-- Provider state is not proof of payment. Only a verified paid-period grant may
-- change the wallet. A webhook merely refreshes this canonical snapshot.
CREATE TABLE app_autumn_customers (
 account_id TEXT PRIMARY KEY REFERENCES app_accounts(id),
 customer_id TEXT NOT NULL UNIQUE,
 revision BIGINT NOT NULL DEFAULT 0,
 snapshot JSONB,
 synced_at TEXT,
 reconciliation_required BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE app_autumn_events (
 id TEXT PRIMARY KEY,
 customer_id TEXT NOT NULL,
 received_at TEXT NOT NULL,
 processed_at TEXT
);
CREATE TABLE app_autumn_grants (
 invoice_id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES app_accounts(id),
 period_start BIGINT NOT NULL,
 period_end BIGINT NOT NULL,
 operation_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 revoked_at TEXT,
 UNIQUE(account_id,period_start)
);
ALTER TABLE app_accounts ADD COLUMN billing_hold BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE app_autumn_sync_budget (
 day TEXT PRIMARY KEY,
 calls INTEGER NOT NULL DEFAULT 0 CHECK(calls>=0 AND calls<=60)
);
