-- Organizations have their owner's billing email, but their own account/customer.
ALTER TABLE app_accounts DROP CONSTRAINT app_accounts_email_key;
CREATE UNIQUE INDEX app_accounts_personal_email ON app_accounts(email)
 WHERE id NOT LIKE 'workos:org_%';
-- Serialize seat reservations and last-owner changes across Worker isolates.
CREATE TABLE app_organization_operations (
 workspace_id TEXT PRIMARY KEY REFERENCES app_workspaces(account_id),
 token TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL
);
