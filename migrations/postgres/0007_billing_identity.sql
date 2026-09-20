-- Completing identity linkage is distinct from later subscription reconciliation.
-- Once linked, an Autumn outage must not prevent an existing user from signing in.
ALTER TABLE app_autumn_customers ADD COLUMN identity_verified_at TEXT;
