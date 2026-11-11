CREATE TABLE "class_war_weeks" (
	"org_id" uuid NOT NULL,
	"week" text NOT NULL,
	"results" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_war_weeks_org_id_week_pk" PRIMARY KEY("org_id","week")
);
--> statement-breakpoint
ALTER TABLE "class_war_weeks" ADD CONSTRAINT "class_war_weeks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;