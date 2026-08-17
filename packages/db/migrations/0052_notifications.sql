CREATE TABLE "notification_preferences" (
	"user_id" text NOT NULL,
	"event_group" text NOT NULL,
	"channel" text NOT NULL,
	"enabled" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_pkey" PRIMARY KEY("user_id","event_group","channel"),
	CONSTRAINT "notification_preferences_group_check" CHECK ("notification_preferences"."event_group" in ('assigned_to_you', 'activity_on_your_records', 'dates_approaching', 'new_requests', 'requester_events')),
	CONSTRAINT "notification_preferences_channel_check" CHECK ("notification_preferences"."channel" in ('in_app', 'email'))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"event_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"email_owed" boolean DEFAULT false NOT NULL,
	"emailed_at" timestamp with time zone,
	"email_skipped_at" timestamp with time zone,
	"reminder_date" date,
	"reminder_offset_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_entity_type_check" CHECK ("notifications"."entity_type" in ('matter', 'contract', 'document', 'request')),
	CONSTRAINT "notifications_reminder_pair" CHECK (("notifications"."reminder_date" is null) = ("notifications"."reminder_offset_days" is null)),
	CONSTRAINT "notifications_email_outcome" CHECK (not ("notifications"."emailed_at" is not null and "notifications"."email_skipped_at" is not null)),
	CONSTRAINT "notifications_email_owed" CHECK ("notifications"."email_owed" or ("notifications"."emailed_at" is null and "notifications"."email_skipped_at" is null))
);
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("user_id") WHERE read_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_reminder_idx" ON "notifications" USING btree ("user_id","event_type","entity_id","reminder_date","reminder_offset_days") WHERE reminder_date is not null;