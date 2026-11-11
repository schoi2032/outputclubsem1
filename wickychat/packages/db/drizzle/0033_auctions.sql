CREATE TABLE "auctions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"serial" integer,
	"start_price" integer NOT NULL,
	"top_bid" integer,
	"top_bidder_id" uuid,
	"bids" integer DEFAULT 0 NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_top_bidder_id_users_id_fk" FOREIGN KEY ("top_bidder_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auctions_org_idx" ON "auctions" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "auctions_due_idx" ON "auctions" USING btree ("status","ends_at");