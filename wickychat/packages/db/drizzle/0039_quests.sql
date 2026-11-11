CREATE TABLE "quest_claims" (
	"user_id" uuid NOT NULL,
	"day" text NOT NULL,
	"quest_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quest_claims_user_id_day_quest_id_pk" PRIMARY KEY("user_id","day","quest_id")
);
--> statement-breakpoint
ALTER TABLE "quest_claims" ADD CONSTRAINT "quest_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;