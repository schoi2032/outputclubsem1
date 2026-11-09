ALTER TABLE "notification_preferences" ADD COLUMN "email_offline" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN "last_offline_email_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN "last_digest_at" timestamp with time zone;