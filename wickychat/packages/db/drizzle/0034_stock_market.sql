CREATE TABLE "holdings" (
	"user_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"qty" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "holdings_user_id_item_id_pk" PRIMARY KEY("user_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "market_supply" (
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"supply" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "market_supply_org_id_key_pk" PRIMARY KEY("org_id","key")
);
--> statement-breakpoint
CREATE TABLE "person_shares" (
	"holder_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"qty" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "person_shares_holder_id_target_id_pk" PRIMARY KEY("holder_id","target_id")
);
--> statement-breakpoint
CREATE TABLE "price_ticks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"price" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cosmetics" ADD COLUMN "dynamic" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_supply" ADD CONSTRAINT "market_supply_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_shares" ADD CONSTRAINT "person_shares_holder_id_users_id_fk" FOREIGN KEY ("holder_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_shares" ADD CONSTRAINT "person_shares_target_id_users_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_shares" ADD CONSTRAINT "person_shares_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_ticks" ADD CONSTRAINT "price_ticks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "person_shares_target_idx" ON "person_shares" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "price_ticks_key_idx" ON "price_ticks" USING btree ("org_id","key","created_at");