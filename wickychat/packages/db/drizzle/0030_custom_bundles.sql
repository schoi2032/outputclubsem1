CREATE TABLE "custom_bundles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"name" text NOT NULL,
	"emoji" text DEFAULT '🎁' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"color_a" text NOT NULL,
	"color_b" text NOT NULL,
	"price" integer NOT NULL,
	"items" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sales" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "custom_bundles" ADD CONSTRAINT "custom_bundles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_bundles" ADD CONSTRAINT "custom_bundles_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_bundles_org_idx" ON "custom_bundles" USING btree ("org_id","status");