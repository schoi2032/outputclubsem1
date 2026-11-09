CREATE TABLE "voice_room_participants" (
	"room_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"role" text NOT NULL,
	"hand_raised" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voice_room_participants_room_id_user_id_pk" PRIMARY KEY("room_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "voice_rooms" ADD COLUMN "mode" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_room_participants" ADD CONSTRAINT "voice_room_participants_room_id_voice_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."voice_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_room_participants" ADD CONSTRAINT "voice_room_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_room_participants" ADD CONSTRAINT "voice_room_participants_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voice_room_participants_user_idx" ON "voice_room_participants" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "voice_rooms_channel_uq" ON "voice_rooms" USING btree ("channel_id");