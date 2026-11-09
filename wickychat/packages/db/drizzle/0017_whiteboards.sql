ALTER TABLE "canvases" ADD COLUMN "kind" text DEFAULT 'doc' NOT NULL;--> statement-breakpoint
ALTER TABLE "canvases" ADD COLUMN "scene" jsonb;