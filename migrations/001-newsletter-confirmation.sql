-- Existing addresses remain unconfirmed. Never backfill consent.
ALTER TABLE subscriber ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
GRANT SELECT (email, confirmed_at, unsubscribed_at), UPDATE (confirmed_at)
  ON subscriber TO newsletter_writer;
