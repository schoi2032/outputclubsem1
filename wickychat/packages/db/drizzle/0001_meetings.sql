ALTER TABLE "meetings" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "duration_minutes" integer DEFAULT 30 NOT NULL;