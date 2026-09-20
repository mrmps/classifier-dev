-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TABLE "app_schema_migrations" (
	"name" text PRIMARY KEY NOT NULL,
	"sha256" text NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"expires_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"credits" bigint NOT NULL,
	"created_at" text NOT NULL,
	"plan_id" text,
	CONSTRAINT "app_transactions_account_id_idempotency_key_key" UNIQUE("idempotency_key","account_id")
);
--> statement-breakpoint
CREATE TABLE "app_workspaces" (
	"account_id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"mode" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "app_workspaces_kind_check" CHECK (kind = ANY (ARRAY['personal'::text, 'organization'::text])),
	CONSTRAINT "app_workspaces_mode_check" CHECK (mode = ANY (ARRAY['demo'::text, 'hosted'::text]))
);
--> statement-breakpoint
CREATE TABLE "app_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text NOT NULL,
	"status" text DEFAULT 'prepared' NOT NULL,
	CONSTRAINT "app_invitations_role_check" CHECK (role = ANY (ARRAY['admin'::text, 'member'::text])),
	CONSTRAINT "app_invitations_status_check" CHECK (status = ANY (ARRAY['prepared'::text, 'revoked'::text]))
);
--> statement-breakpoint
CREATE TABLE "app_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"items" integer NOT NULL,
	"credits" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" text NOT NULL,
	"paid_credits" bigint DEFAULT 0 NOT NULL,
	"usage_type" text DEFAULT 'classification' NOT NULL,
	"input_tokens" bigint,
	"output_tokens" bigint,
	"reserved_credits" bigint,
	"reserved_paid_credits" bigint,
	"actual_nano" bigint,
	"rate_version" text,
	"metering_mode" text DEFAULT 'credits' NOT NULL,
	"reporting_status" text DEFAULT 'not_ready' NOT NULL,
	CONSTRAINT "app_usage_actual_nano_check" CHECK (actual_nano >= 0),
	CONSTRAINT "app_usage_metering_mode_check" CHECK (metering_mode = ANY (ARRAY['credits'::text, 'tokens'::text, 'legacy'::text])),
	CONSTRAINT "app_usage_reporting_status_check" CHECK (reporting_status = ANY (ARRAY['not_ready'::text, 'review'::text, 'pending'::text, 'reported'::text, 'exempt'::text]))
);
--> statement-breakpoint
CREATE TABLE "app_agents" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"client" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"credit_limit" bigint DEFAULT 1000 NOT NULL,
	"used" bigint DEFAULT 0 NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"created_at" text NOT NULL,
	"last_used" text,
	"encrypted_secret" text,
	CONSTRAINT "app_agents_token_hash_key" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "app_autumn_customers" (
	"account_id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"snapshot" jsonb,
	"synced_at" text,
	"reconciliation_required" boolean DEFAULT true NOT NULL,
	CONSTRAINT "app_autumn_customers_customer_id_key" UNIQUE("customer_id")
);
--> statement-breakpoint
CREATE TABLE "app_autumn_events" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"received_at" text NOT NULL,
	"processed_at" text
);
--> statement-breakpoint
CREATE TABLE "app_autumn_grants" (
	"invoice_id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"period_start" bigint NOT NULL,
	"period_end" bigint NOT NULL,
	"operation_id" text NOT NULL,
	"created_at" text NOT NULL,
	"revoked_at" text,
	CONSTRAINT "app_autumn_grants_account_id_period_start_key" UNIQUE("period_start","account_id")
);
--> statement-breakpoint
CREATE TABLE "app_autumn_sync_budget" (
	"day" text PRIMARY KEY NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "app_autumn_sync_budget_calls_check" CHECK ((calls >= 0) AND (calls <= 60))
);
--> statement-breakpoint
CREATE TABLE "app_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"bonus_granted" integer DEFAULT 0 NOT NULL,
	"intent" text DEFAULT 'agent' NOT NULL,
	"reset_at" text NOT NULL,
	"created_at" text NOT NULL,
	"period_start" text,
	"bonus_active" bigint DEFAULT 0 NOT NULL,
	"paid_balance" bigint DEFAULT 0 NOT NULL,
	"billing_plan" text DEFAULT 'free' NOT NULL,
	"cancel_at_period_end" integer DEFAULT 0 NOT NULL,
	"auto_top_up_enabled" integer DEFAULT 0 NOT NULL,
	"auto_top_up_threshold_cents" integer DEFAULT 200 NOT NULL,
	"auto_top_up_amount_cents" integer DEFAULT 1000 NOT NULL,
	"auto_top_up_cap_cents" integer DEFAULT 5000 NOT NULL,
	"scheduled_plan" text,
	"billing_revision" integer DEFAULT 0 NOT NULL,
	"fractional_spend_nano" bigint DEFAULT 0 NOT NULL,
	"default_key_provisioned" boolean DEFAULT false NOT NULL,
	"billing_hold" boolean DEFAULT false NOT NULL,
	"signup_granted_at" text,
	CONSTRAINT "app_accounts_email_key" UNIQUE("email"),
	CONSTRAINT "app_accounts_balance_check" CHECK (balance >= 0),
	CONSTRAINT "app_accounts_paid_balance_check" CHECK (paid_balance >= 0),
	CONSTRAINT "app_accounts_fractional_spend_nano_check" CHECK ((fractional_spend_nano >= 0) AND (fractional_spend_nano < 10000))
);
--> statement-breakpoint
CREATE TABLE "app_memberships" (
	"identity_account_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"role" text NOT NULL,
	"joined_at" text NOT NULL,
	CONSTRAINT "app_memberships_pkey" PRIMARY KEY("workspace_id","identity_account_id"),
	CONSTRAINT "app_memberships_role_check" CHECK (role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text]))
);
--> statement-breakpoint
CREATE TABLE "app_billing_commands" (
	"account_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"plan_id" text NOT NULL,
	"created_at" text NOT NULL,
	"operation_id" text NOT NULL,
	CONSTRAINT "app_billing_commands_pkey" PRIMARY KEY("idempotency_key","account_id")
);
--> statement-breakpoint
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."app_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_transactions" ADD CONSTRAINT "app_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."app_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_workspaces" ADD CONSTRAINT "app_workspaces_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."app_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_invitations" ADD CONSTRAINT "app_invitations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."app_workspaces"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_invitations" ADD CONSTRAINT "app_invitations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."app_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_usage" ADD CONSTRAINT "app_usage_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."app_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_usage" ADD CONSTRAINT "app_usage_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."app_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_agents" ADD CONSTRAINT "app_agents_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."app_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_autumn_customers" ADD CONSTRAINT "app_autumn_customers_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."app_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_autumn_grants" ADD CONSTRAINT "app_autumn_grants_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."app_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_memberships" ADD CONSTRAINT "app_memberships_identity_account_id_fkey" FOREIGN KEY ("identity_account_id") REFERENCES "public"."app_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_memberships" ADD CONSTRAINT "app_memberships_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."app_workspaces"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_billing_commands" ADD CONSTRAINT "app_billing_commands_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."app_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_transactions_account" ON "app_transactions" USING btree ("account_id" text_ops,"created_at" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "app_pending_invitation" ON "app_invitations" USING btree ("workspace_id" text_ops,"email" text_ops) WHERE (status = 'prepared'::text);--> statement-breakpoint
CREATE INDEX "app_usage_account" ON "app_usage" USING btree ("account_id" text_ops,"created_at" text_ops);--> statement-breakpoint
CREATE INDEX "app_usage_pending" ON "app_usage" USING btree ("account_id" text_ops,"created_at" text_ops) WHERE (status = 'pending'::text);--> statement-breakpoint
CREATE INDEX "app_usage_reporting" ON "app_usage" USING btree ("account_id" text_ops,"created_at" text_ops) WHERE (reporting_status = 'pending'::text);--> statement-breakpoint
CREATE INDEX "app_agents_account" ON "app_agents" USING btree ("account_id" text_ops);--> statement-breakpoint
CREATE INDEX "app_memberships_workspace" ON "app_memberships" USING btree ("workspace_id" text_ops);
*/