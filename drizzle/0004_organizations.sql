CREATE TABLE "app_organization_operations" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_accounts" DROP CONSTRAINT "app_accounts_email_key";--> statement-breakpoint
ALTER TABLE "app_organization_operations" ADD CONSTRAINT "app_organization_operations_workspace_id_app_workspaces_account_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."app_workspaces"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_accounts_personal_email" ON "app_accounts" USING btree ("email") WHERE id NOT LIKE 'workos:org_%';