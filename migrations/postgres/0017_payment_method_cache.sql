-- Saved-card summary cached during reconciliation so the billing page can show
-- the card on file without a provider call. NULL means not yet observed;
-- {"type":"none"} means the provider reported no saved payment method.
ALTER TABLE app_autumn_customers ADD COLUMN payment_method JSONB;
