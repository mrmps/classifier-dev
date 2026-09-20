-- Application records and newsletter can share this Neon project. Currency is
-- stored as integer credits; timestamps remain ISO UTC strings at the API boundary.
CREATE TABLE app_accounts (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 balance BIGINT NOT NULL DEFAULT 0 CHECK(balance >= 0),
 bonus_granted INTEGER NOT NULL DEFAULT 0, intent TEXT NOT NULL DEFAULT 'agent',
 reset_at TEXT NOT NULL, created_at TEXT NOT NULL, period_start TEXT,
 bonus_active BIGINT NOT NULL DEFAULT 0,
 paid_balance BIGINT NOT NULL DEFAULT 0 CHECK(paid_balance >= 0),
 billing_plan TEXT NOT NULL DEFAULT 'free',
 cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
 auto_top_up_enabled INTEGER NOT NULL DEFAULT 0,
 auto_top_up_threshold_cents INTEGER NOT NULL DEFAULT 200,
 auto_top_up_amount_cents INTEGER NOT NULL DEFAULT 1000,
 auto_top_up_cap_cents INTEGER NOT NULL DEFAULT 5000,
 scheduled_plan TEXT, billing_revision INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE app_sessions (
 token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES app_accounts(id), expires_at TEXT NOT NULL
);
CREATE TABLE app_agents (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES app_accounts(id), name TEXT NOT NULL,
 client TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', credit_limit BIGINT NOT NULL DEFAULT 1000,
 used BIGINT NOT NULL DEFAULT 0, token_hash TEXT NOT NULL UNIQUE, prefix TEXT NOT NULL,
 created_at TEXT NOT NULL, last_used TEXT
);
CREATE INDEX app_agents_account ON app_agents(account_id);
CREATE TABLE app_usage (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES app_accounts(id), agent_id TEXT NOT NULL REFERENCES app_agents(id),
 items INTEGER NOT NULL, credits BIGINT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL,
 paid_credits BIGINT NOT NULL DEFAULT 0, usage_type TEXT NOT NULL DEFAULT 'classification',
 input_tokens BIGINT, output_tokens BIGINT
);
CREATE INDEX app_usage_account ON app_usage(account_id, created_at);
CREATE INDEX app_usage_pending ON app_usage(account_id, created_at) WHERE status='pending';
CREATE TABLE app_transactions (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES app_accounts(id), idempotency_key TEXT NOT NULL,
 kind TEXT NOT NULL, amount_cents BIGINT NOT NULL, credits BIGINT NOT NULL,
 created_at TEXT NOT NULL, plan_id TEXT, UNIQUE(account_id,idempotency_key)
);
CREATE INDEX app_transactions_account ON app_transactions(account_id,created_at);
CREATE TABLE app_billing_commands (
 account_id TEXT NOT NULL REFERENCES app_accounts(id), idempotency_key TEXT NOT NULL,
 plan_id TEXT NOT NULL, created_at TEXT NOT NULL, operation_id TEXT NOT NULL,
 PRIMARY KEY(account_id,idempotency_key)
);
CREATE TABLE app_workspaces (
 account_id TEXT PRIMARY KEY REFERENCES app_accounts(id),
 kind TEXT NOT NULL CHECK(kind IN ('personal','organization')),
 mode TEXT NOT NULL CHECK(mode IN ('demo','hosted')), created_at TEXT NOT NULL
);
CREATE TABLE app_memberships (
 identity_account_id TEXT NOT NULL REFERENCES app_accounts(id),
 workspace_id TEXT NOT NULL REFERENCES app_workspaces(account_id),
 role TEXT NOT NULL CHECK(role IN ('owner','admin','member')), joined_at TEXT NOT NULL,
 PRIMARY KEY(identity_account_id,workspace_id)
);
CREATE INDEX app_memberships_workspace ON app_memberships(workspace_id);
CREATE TABLE app_invitations (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES app_workspaces(account_id), email TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('admin','member')), created_at TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES app_accounts(id),
 status TEXT NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','revoked'))
);
CREATE UNIQUE INDEX app_pending_invitation ON app_invitations(workspace_id,email) WHERE status='prepared';

CREATE FUNCTION app_keep_last_owner() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.role='owner' AND (TG_OP='DELETE' OR NEW.role!='owner') THEN
   -- Lock the workspace so concurrent removals cannot both observe two owners.
   PERFORM 1 FROM app_workspaces WHERE account_id=OLD.workspace_id FOR UPDATE;
   IF (SELECT COUNT(*) FROM app_memberships WHERE workspace_id=OLD.workspace_id AND role='owner')=1 THEN
     RAISE EXCEPTION 'The last owner cannot be removed or demoted.';
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER app_keep_last_owner_delete BEFORE DELETE ON app_memberships
 FOR EACH ROW EXECUTE FUNCTION app_keep_last_owner();
CREATE TRIGGER app_keep_last_owner_update BEFORE UPDATE OF role ON app_memberships
 FOR EACH ROW EXECUTE FUNCTION app_keep_last_owner();
