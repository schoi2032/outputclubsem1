CREATE TABLE "cosmetics" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price" integer NOT NULL,
	"frame_file_id" uuid,
	"sticker_file_id" uuid,
	"sticker_position" text DEFAULT 'tr' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"sales" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_items" ADD COLUMN "gifted_by" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "banner_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "banner_animated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "profile_style" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "cosmetics" ADD CONSTRAINT "cosmetics_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cosmetics" ADD CONSTRAINT "cosmetics_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cosmetics" ADD CONSTRAINT "cosmetics_frame_file_id_files_id_fk" FOREIGN KEY ("frame_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cosmetics" ADD CONSTRAINT "cosmetics_sticker_file_id_files_id_fk" FOREIGN KEY ("sticker_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cosmetics" ADD CONSTRAINT "cosmetics_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cosmetics_org_status_idx" ON "cosmetics" USING btree ("org_id","status","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cosmetics_creator_idx" ON "cosmetics" USING btree ("creator_id");--> statement-breakpoint
ALTER TABLE "user_items" ADD CONSTRAINT "user_items_gifted_by_users_id_fk" FOREIGN KEY ("gifted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;