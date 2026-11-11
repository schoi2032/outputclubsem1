ALTER TABLE "billing_accounts" DROP CONSTRAINT "billing_accounts_paddle_subscription_id_unique";--> statement-breakpoint
ALTER TABLE "billing_accounts" DROP COLUMN "paddle_customer_id";--> statement-breakpoint
ALTER TABLE "billing_accounts" DROP COLUMN "paddle_subscription_id";