-- Recoverable API keys are encrypted at rest; legacy hash-only keys remain valid.
ALTER TABLE app_agents ADD COLUMN encrypted_secret TEXT;
ALTER TABLE app_accounts ADD COLUMN default_key_provisioned BOOLEAN NOT NULL DEFAULT FALSE;
-- Existing workspaces already have credentials. Do not silently add access to them.
UPDATE app_accounts SET default_key_provisioned=TRUE WHERE EXISTS (
 SELECT 1 FROM app_agents WHERE account_id=app_accounts.id
);
