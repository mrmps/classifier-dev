CREATE TABLE "subscriber" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "subscriber_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"email" text NOT NULL,
	"source" text DEFAULT 'site' NOT NULL,
	"wants" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	CONSTRAINT "subscriber_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "app_accounts" ALTER COLUMN "balance" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "app_accounts" ALTER COLUMN "bonus_active" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "app_accounts" ALTER COLUMN "paid_balance" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "app_accounts" ALTER COLUMN "fractional_spend_nano" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "app_agents" ALTER COLUMN "credit_limit" SET DEFAULT 1000;--> statement-breakpoint
ALTER TABLE "app_agents" ALTER COLUMN "used" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "app_autumn_customers" ALTER COLUMN "revision" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "app_usage" ALTER COLUMN "paid_credits" SET DEFAULT 0;