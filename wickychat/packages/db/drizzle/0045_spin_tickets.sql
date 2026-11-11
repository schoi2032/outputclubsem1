DROP TABLE "referrals" CASCADE;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "spin_tickets" integer DEFAULT 0 NOT NULL;