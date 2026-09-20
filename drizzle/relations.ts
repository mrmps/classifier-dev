import { relations } from "drizzle-orm/relations";
import { app_accounts, app_sessions, app_transactions, app_workspaces, app_invitations, app_usage, app_agents, app_autumn_customers, app_autumn_grants, app_memberships, app_billing_commands } from "./schema";

export const app_sessionsRelations = relations(app_sessions, ({one}) => ({
	app_account: one(app_accounts, {
		fields: [app_sessions.account_id],
		references: [app_accounts.id]
	}),
}));

export const app_accountsRelations = relations(app_accounts, ({many}) => ({
	app_sessions: many(app_sessions),
	app_transactions: many(app_transactions),
	app_workspaces: many(app_workspaces),
	app_invitations: many(app_invitations),
	app_usages: many(app_usage),
	app_agents: many(app_agents),
	app_autumn_customers: many(app_autumn_customers),
	app_autumn_grants: many(app_autumn_grants),
	app_memberships: many(app_memberships),
	app_billing_commands: many(app_billing_commands),
}));

export const app_transactionsRelations = relations(app_transactions, ({one}) => ({
	app_account: one(app_accounts, {
		fields: [app_transactions.account_id],
		references: [app_accounts.id]
	}),
}));

export const app_workspacesRelations = relations(app_workspaces, ({one, many}) => ({
	app_account: one(app_accounts, {
		fields: [app_workspaces.account_id],
		references: [app_accounts.id]
	}),
	app_invitations: many(app_invitations),
	app_memberships: many(app_memberships),
}));

export const app_invitationsRelations = relations(app_invitations, ({one}) => ({
	app_workspace: one(app_workspaces, {
		fields: [app_invitations.workspace_id],
		references: [app_workspaces.account_id]
	}),
	app_account: one(app_accounts, {
		fields: [app_invitations.created_by],
		references: [app_accounts.id]
	}),
}));

export const app_usageRelations = relations(app_usage, ({one}) => ({
	app_account: one(app_accounts, {
		fields: [app_usage.account_id],
		references: [app_accounts.id]
	}),
	app_agent: one(app_agents, {
		fields: [app_usage.agent_id],
		references: [app_agents.id]
	}),
}));

export const app_agentsRelations = relations(app_agents, ({one, many}) => ({
	app_usages: many(app_usage),
	app_account: one(app_accounts, {
		fields: [app_agents.account_id],
		references: [app_accounts.id]
	}),
}));

export const app_autumn_customersRelations = relations(app_autumn_customers, ({one}) => ({
	app_account: one(app_accounts, {
		fields: [app_autumn_customers.account_id],
		references: [app_accounts.id]
	}),
}));

export const app_autumn_grantsRelations = relations(app_autumn_grants, ({one}) => ({
	app_account: one(app_accounts, {
		fields: [app_autumn_grants.account_id],
		references: [app_accounts.id]
	}),
}));

export const app_membershipsRelations = relations(app_memberships, ({one}) => ({
	app_account: one(app_accounts, {
		fields: [app_memberships.identity_account_id],
		references: [app_accounts.id]
	}),
	app_workspace: one(app_workspaces, {
		fields: [app_memberships.workspace_id],
		references: [app_workspaces.account_id]
	}),
}));

export const app_billing_commandsRelations = relations(app_billing_commands, ({one}) => ({
	app_account: one(app_accounts, {
		fields: [app_billing_commands.account_id],
		references: [app_accounts.id]
	}),
}));