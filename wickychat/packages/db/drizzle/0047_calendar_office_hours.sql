CREATE TABLE "calendar_event_done" (
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"done_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_event_done_event_id_user_id_pk" PRIMARY KEY("event_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"channel_id" uuid,
	"created_by" uuid,
	"kind" text DEFAULT 'event' NOT NULL,
	"title" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"all_day" boolean DEFAULT false NOT NULL,
	"reminded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "office_hour_bookings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"office_hour_id" uuid,
	"teacher_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"topic" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"meeting_id" uuid,
	"status" text DEFAULT 'booked' NOT NULL,
	"cancelled_by" uuid,
	"reminded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "office_hours" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"teacher_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"slot_minutes" integer DEFAULT 15 NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"online" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"timezone" text NOT NULL,
	"skip_dates" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_event_done" ADD CONSTRAINT "calendar_event_done_event_id_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_done" ADD CONSTRAINT "calendar_event_done_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_hour_bookings" ADD CONSTRAINT "office_hour_bookings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_hour_bookings" ADD CONSTRAINT "office_hour_bookings_office_hour_id_office_hours_id_fk" FOREIGN KEY ("office_hour_id") REFERENCES "public"."office_hours"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_hour_bookings" ADD CONSTRAINT "office_hour_bookings_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_hour_bookings" ADD CONSTRAINT "office_hour_bookings_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_hour_bookings" ADD CONSTRAINT "office_hour_bookings_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_hour_bookings" ADD CONSTRAINT "office_hour_bookings_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_hours" ADD CONSTRAINT "office_hours_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_hours" ADD CONSTRAINT "office_hours_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_events_org_idx" ON "calendar_events" USING btree ("org_id","starts_at");--> statement-breakpoint
CREATE INDEX "calendar_events_channel_idx" ON "calendar_events" USING btree ("channel_id","starts_at");--> statement-breakpoint
CREATE INDEX "calendar_events_due_idx" ON "calendar_events" USING btree ("starts_at") WHERE "calendar_events"."reminded_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "office_hour_bookings_slot_uq" ON "office_hour_bookings" USING btree ("teacher_id","starts_at") WHERE "office_hour_bookings"."status" = 'booked';--> statement-breakpoint
CREATE INDEX "office_hour_bookings_student_idx" ON "office_hour_bookings" USING btree ("student_id","starts_at");--> statement-breakpoint
CREATE INDEX "office_hour_bookings_teacher_idx" ON "office_hour_bookings" USING btree ("teacher_id","starts_at");--> statement-breakpoint
CREATE INDEX "office_hours_teacher_idx" ON "office_hours" USING btree ("org_id","teacher_id");