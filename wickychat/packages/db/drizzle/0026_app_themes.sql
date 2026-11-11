ALTER TABLE "cosmetics" ADD COLUMN "kind" text DEFAULT 'decoration' NOT NULL;--> statement-breakpoint
ALTER TABLE "cosmetics" ADD COLUMN "css" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "app_theme" text;