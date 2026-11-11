ALTER TABLE "billing_accounts" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "customer_id" text;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "subscription_id" text;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_subscription_id_unique" UNIQUE("subscription_id");--> statement-breakpoint
UPDATE "billing_accounts" SET "provider" = 'paddle', "customer_id" = "paddle_customer_id", "subscription_id" = "paddle_subscription_id" WHERE "paddle_subscription_id" IS NOT NULL;
