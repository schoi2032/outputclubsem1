ALTER TABLE "billing_accounts" ADD COLUMN "trial_started_email_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "trial_ending_email_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "trial_ended_email_at" timestamp with time zone;