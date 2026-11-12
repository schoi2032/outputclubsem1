ALTER TABLE "cosmetics" ADD COLUMN "spec" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "name_effect" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "message_effect" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "typing_style" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reaction_skin" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mention_style" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sound_pack" text;