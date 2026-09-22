ALTER TABLE app_usage ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS app_usage_idempotency ON app_usage(account_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
