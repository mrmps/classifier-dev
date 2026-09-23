CREATE TABLE app_complimentary_pro (
 email TEXT PRIMARY KEY CHECK (email = lower(email)),
 starts_at TEXT NOT NULL,
 ends_at TEXT NOT NULL,
 account_id TEXT UNIQUE REFERENCES app_accounts(id),
 last_period_start TEXT,
 operation_id TEXT,
 CHECK (ends_at > starts_at)
);
