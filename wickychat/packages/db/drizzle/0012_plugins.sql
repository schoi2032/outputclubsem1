CREATE TABLE "plugins" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"tagline" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"developer_name" text NOT NULL,
	"developer_email" text NOT NULL,
	"homepage_url" text,
	"icon_key" text,
	"manifest" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"private_org_id" uuid,
	"submitted_by" uuid,
	"secret_ciphertext" text NOT NULL,
	"secret_iv" text NOT NULL,
	"secret_tag" text NOT NULL,
	"review_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plugins_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "plugins" ADD CONSTRAINT "plugins_private_org_id_organizations_id_fk" FOREIGN KEY ("private_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugins" ADD CONSTRAINT "plugins_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugins" ADD CONSTRAINT "plugins_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plugins_status_idx" ON "plugins" USING btree ("status");--> statement-breakpoint
CREATE INDEX "plugins_private_org_idx" ON "plugins" USING btree ("private_org_id");