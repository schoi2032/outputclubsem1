CREATE TABLE "custom_crates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"name" text NOT NULL,
	"emoji" text DEFAULT '📦' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"color_a" text NOT NULL,
	"color_b" text NOT NULL,
	"price" integer NOT NULL,
	"drops" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sales" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "custom_crates" ADD CONSTRAINT "custom_crates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_crates" ADD CONSTRAINT "custom_crates_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_crates_org_idx" ON "custom_crates" USING btree ("org_id","status");