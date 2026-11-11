CREATE TABLE "wishlist" (
	"user_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wishlist_user_id_item_id_pk" PRIMARY KEY("user_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "showcase" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "wishlist" ADD CONSTRAINT "wishlist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;