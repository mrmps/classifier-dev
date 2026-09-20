import { pgTable, text, timestamp, foreignKey, index, unique, bigint, check, uniqueIndex, integer, jsonb, boolean, primaryKey } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const subscriber = pgTable("subscriber", {
  id: bigint({ mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
  email: text().notNull().unique(),
  source: text().notNull().default("site"),
  wants: text().array().notNull().default(sql`'{}'`),
  desired_latency_ms: integer(),
  created_at: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
  confirmed_at: timestamp({ withTimezone: true, mode: "string" }),
  unsubscribed_at: timestamp({ withTimezone: true, mode: "string" }),
}, (table) => [
  check("subscriber_faster_latency_check", sql`(${table.desired_latency_ms} IS NULL AND NOT ('faster' = ANY(${table.wants}))) OR (${table.desired_latency_ms} IS NOT NULL AND ${table.desired_latency_ms} BETWEEN 1 AND 60000 AND 'faster' = ANY(${table.wants}))`),
]);


export const app_schema_migrations = pgTable("app_schema_migrations", {
	name: text().primaryKey().notNull(),
	sha256: text().notNull(),
	applied_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const app_sessions = pgTable("app_sessions", {
	token_hash: text().primaryKey().notNull(),
	account_id: text().notNull(),
	expires_at: text().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.account_id],
			foreignColumns: [app_accounts.id],
			name: "app_sessions_account_id_fkey"
		}),
]);

export const app_transactions = pgTable("app_transactions", {
	id: text().primaryKey().notNull(),
	account_id: text().notNull(),
	idempotency_key: text().notNull(),
	kind: text().notNull(),
	amount_cents: bigint({ mode: "bigint" }).notNull(),
	credits: bigint({ mode: "bigint" }).notNull(),
	created_at: text().notNull(),
	plan_id: text(),
}, (table) => [
	index("app_transactions_account").using("btree", table.account_id.asc().nullsLast().op("text_ops"), table.created_at.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.account_id],
			foreignColumns: [app_accounts.id],
			name: "app_transactions_account_id_fkey"
		}),
	unique("app_transactions_account_id_idempotency_key_key").on(table.idempotency_key, table.account_id),
]);

export const app_workspaces = pgTable("app_workspaces", {
	account_id: text().primaryKey().notNull(),
	kind: text().notNull(),
	mode: text().notNull(),
	created_at: text().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.account_id],
			foreignColumns: [app_accounts.id],
			name: "app_workspaces_account_id_fkey"
		}),
	check("app_workspaces_kind_check", sql`kind = ANY (ARRAY['personal'::text, 'organization'::text])`),
	check("app_workspaces_mode_check", sql`mode = ANY (ARRAY['demo'::text, 'hosted'::text])`),
]);

export const app_invitations = pgTable("app_invitations", {
	id: text().primaryKey().notNull(),
	workspace_id: text().notNull(),
	email: text().notNull(),
	role: text().notNull(),
	created_at: text().notNull(),
	created_by: text().notNull(),
	status: text().default('prepared').notNull(),
}, (table) => [
	uniqueIndex("app_pending_invitation").using("btree", table.workspace_id.asc().nullsLast().op("text_ops"), table.email.asc().nullsLast().op("text_ops")).where(sql`(status = 'prepared'::text)`),
	foreignKey({
			columns: [table.workspace_id],
			foreignColumns: [app_workspaces.account_id],
			name: "app_invitations_workspace_id_fkey"
		}),
	foreignKey({
			columns: [table.created_by],
			foreignColumns: [app_accounts.id],
			name: "app_invitations_created_by_fkey"
		}),
	check("app_invitations_role_check", sql`role = ANY (ARRAY['admin'::text, 'member'::text])`),
	check("app_invitations_status_check", sql`status = ANY (ARRAY['prepared'::text, 'revoked'::text])`),
]);

export const app_usage = pgTable("app_usage", {
	id: text().primaryKey().notNull(),
	account_id: text().notNull(),
	agent_id: text().notNull(),
	items: integer().notNull(),
	credits: bigint({ mode: "bigint" }).notNull(),
	status: text().default('pending').notNull(),
	created_at: text().notNull(),
	paid_credits: bigint({ mode: "bigint" }).default(sql`0`).notNull(),
	usage_type: text().default('classification').notNull(),
	input_tokens: bigint({ mode: "bigint" }),
	output_tokens: bigint({ mode: "bigint" }),
	reserved_credits: bigint({ mode: "bigint" }),
	reserved_paid_credits: bigint({ mode: "bigint" }),
	actual_nano: bigint({ mode: "bigint" }),
	rate_version: text(),
	metering_mode: text().default('credits').notNull(),
	reporting_status: text().default('not_ready').notNull(),
}, (table) => [
	index("app_usage_account").using("btree", table.account_id.asc().nullsLast().op("text_ops"), table.created_at.asc().nullsLast().op("text_ops")),
	index("app_usage_pending").using("btree", table.account_id.asc().nullsLast().op("text_ops"), table.created_at.asc().nullsLast().op("text_ops")).where(sql`(status = 'pending'::text)`),
	index("app_usage_reporting").using("btree", table.account_id.asc().nullsLast().op("text_ops"), table.created_at.asc().nullsLast().op("text_ops")).where(sql`(reporting_status = 'pending'::text)`),
	foreignKey({
			columns: [table.account_id],
			foreignColumns: [app_accounts.id],
			name: "app_usage_account_id_fkey"
		}),
	foreignKey({
			columns: [table.agent_id],
			foreignColumns: [app_agents.id],
			name: "app_usage_agent_id_fkey"
		}),
	check("app_usage_actual_nano_check", sql`actual_nano >= 0`),
	check("app_usage_metering_mode_check", sql`metering_mode = ANY (ARRAY['credits'::text, 'tokens'::text, 'legacy'::text])`),
	check("app_usage_reporting_status_check", sql`reporting_status = ANY (ARRAY['not_ready'::text, 'review'::text, 'pending'::text, 'reported'::text, 'exempt'::text])`),
]);

export const app_agents = pgTable("app_agents", {
	id: text().primaryKey().notNull(),
	account_id: text().notNull(),
	name: text().notNull(),
	client: text().notNull(),
	status: text().default('pending').notNull(),
	credit_limit: bigint({ mode: "bigint" }).default(sql`1000`).notNull(),
	used: bigint({ mode: "bigint" }).default(sql`0`).notNull(),
	token_hash: text().notNull(),
	prefix: text().notNull(),
	created_at: text().notNull(),
	last_used: text(),
	encrypted_secret: text(),
}, (table) => [
	index("app_agents_account").using("btree", table.account_id.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.account_id],
			foreignColumns: [app_accounts.id],
			name: "app_agents_account_id_fkey"
		}),
	unique("app_agents_token_hash_key").on(table.token_hash),
]);

export const app_autumn_customers = pgTable("app_autumn_customers", {
	account_id: text().primaryKey().notNull(),
	customer_id: text().notNull(),
	revision: bigint({ mode: "bigint" }).default(sql`0`).notNull(),
	snapshot: jsonb(),
	synced_at: text(),
	identity_verified_at: text(),
	reconciliation_required: boolean().default(true).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.account_id],
			foreignColumns: [app_accounts.id],
			name: "app_autumn_customers_account_id_fkey"
		}),
	unique("app_autumn_customers_customer_id_key").on(table.customer_id),
]);

export const app_autumn_events = pgTable("app_autumn_events", {
	id: text().primaryKey().notNull(),
	customer_id: text().notNull(),
	received_at: text().notNull(),
	processed_at: text(),
});

export const app_autumn_grants = pgTable("app_autumn_grants", {
	invoice_id: text().primaryKey().notNull(),
	account_id: text().notNull(),
	period_start: bigint({ mode: "bigint" }).notNull(),
	period_end: bigint({ mode: "bigint" }).notNull(),
	operation_id: text().notNull(),
	created_at: text().notNull(),
	revoked_at: text(),
}, (table) => [
	foreignKey({
			columns: [table.account_id],
			foreignColumns: [app_accounts.id],
			name: "app_autumn_grants_account_id_fkey"
		}),
	unique("app_autumn_grants_account_id_period_start_key").on(table.period_start, table.account_id),
]);

export const app_autumn_sync_budget = pgTable("app_autumn_sync_budget", {
	day: text().primaryKey().notNull(),
	calls: integer().default(0).notNull(),
}, (table) => [
	check("app_autumn_sync_budget_calls_check", sql`(calls >= 0) AND (calls <= 60)`),
]);

export const app_accounts = pgTable("app_accounts", {
	id: text().primaryKey().notNull(),
	email: text().notNull(),
	name: text().notNull(),
	balance: bigint({ mode: "bigint" }).default(sql`0`).notNull(),
	bonus_granted: integer().default(0).notNull(),
	intent: text().default('agent').notNull(),
	reset_at: text().notNull(),
	created_at: text().notNull(),
	period_start: text(),
	bonus_active: bigint({ mode: "bigint" }).default(sql`0`).notNull(),
	paid_balance: bigint({ mode: "bigint" }).default(sql`0`).notNull(),
	billing_plan: text().default('free').notNull(),
	cancel_at_period_end: integer().default(0).notNull(),
	auto_top_up_enabled: integer().default(0).notNull(),
	auto_top_up_threshold_cents: integer().default(200).notNull(),
	auto_top_up_amount_cents: integer().default(1000).notNull(),
	auto_top_up_cap_cents: integer().default(5000).notNull(),
	scheduled_plan: text(),
	billing_revision: integer().default(0).notNull(),
	fractional_spend_nano: bigint({ mode: "bigint" }).default(sql`0`).notNull(),
	default_key_provisioned: boolean().default(false).notNull(),
	billing_hold: boolean().default(false).notNull(),
	signup_granted_at: text(),
}, (table) => [
	unique("app_accounts_email_key").on(table.email),
	check("app_accounts_balance_check", sql`balance >= 0`),
	check("app_accounts_paid_balance_check", sql`paid_balance >= 0`),
	check("app_accounts_fractional_spend_nano_check", sql`(fractional_spend_nano >= 0) AND (fractional_spend_nano < 10000)`),
]);

export const app_memberships = pgTable("app_memberships", {
	identity_account_id: text().notNull(),
	workspace_id: text().notNull(),
	role: text().notNull(),
	joined_at: text().notNull(),
}, (table) => [
	index("app_memberships_workspace").using("btree", table.workspace_id.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.identity_account_id],
			foreignColumns: [app_accounts.id],
			name: "app_memberships_identity_account_id_fkey"
		}),
	foreignKey({
			columns: [table.workspace_id],
			foreignColumns: [app_workspaces.account_id],
			name: "app_memberships_workspace_id_fkey"
		}),
	primaryKey({ columns: [table.workspace_id, table.identity_account_id], name: "app_memberships_pkey"}),
	check("app_memberships_role_check", sql`role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])`),
]);

export const app_billing_commands = pgTable("app_billing_commands", {
	account_id: text().notNull(),
	idempotency_key: text().notNull(),
	plan_id: text().notNull(),
	created_at: text().notNull(),
	operation_id: text().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.account_id],
			foreignColumns: [app_accounts.id],
			name: "app_billing_commands_account_id_fkey"
		}),
	primaryKey({ columns: [table.idempotency_key, table.account_id], name: "app_billing_commands_pkey"}),
]);
