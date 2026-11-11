CREATE TABLE "data_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"tbl" text NOT NULL,
	"op" text NOT NULL,
	"user_id" text,
	"old" jsonb,
	"new" jsonb
);
--> statement-breakpoint
CREATE INDEX "data_log_tbl_idx" ON "data_log" USING btree ("tbl","at");--> statement-breakpoint
CREATE INDEX "data_log_user_idx" ON "data_log" USING btree ("user_id","at");