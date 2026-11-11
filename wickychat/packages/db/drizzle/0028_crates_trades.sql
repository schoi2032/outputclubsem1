CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"give" jsonb NOT NULL,
	"get" jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_crates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"crate_id" text NOT NULL,
	"gifted_by" uuid,
	"opened_at" timestamp with time zone,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cosmetics" ADD COLUMN "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "cosmetics" ADD COLUMN "stock" integer;--> statement-breakpoint
ALTER TABLE "user_items" ADD COLUMN "serial" integer;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_from_id_users_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_to_id_users_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_crates" ADD CONSTRAINT "user_crates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_crates" ADD CONSTRAINT "user_crates_gifted_by_users_id_fk" FOREIGN KEY ("gifted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trades_to_idx" ON "trades" USING btree ("to_id","status");--> statement-breakpoint
CREATE INDEX "trades_from_idx" ON "trades" USING btree ("from_id","status");--> statement-breakpoint
CREATE INDEX "user_crates_user_idx" ON "user_crates" USING btree ("user_id","opened_at");