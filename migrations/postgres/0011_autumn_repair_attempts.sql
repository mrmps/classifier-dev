-- Failed provider calls must advance the repair queue without pretending that
-- the provider snapshot was refreshed. Preserve existing queue age on rollout.
ALTER TABLE app_autumn_customers ADD COLUMN last_attempt_at TEXT;
UPDATE app_autumn_customers SET last_attempt_at=synced_at;
CREATE INDEX app_autumn_repair_queue ON app_autumn_customers(last_attempt_at NULLS FIRST,customer_id);
