CREATE TABLE "conversion_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"target_module" text NOT NULL,
	"target_type_id" text NOT NULL,
	"snapshot" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"model" text,
	"suggestions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"conflicts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failure" text,
	"started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ai_connector" ADD COLUMN "matter_preparation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "matters" ADD COLUMN "ai_unverified" jsonb;--> statement-breakpoint
ALTER TABLE "conversion_drafts" ADD CONSTRAINT "conversion_drafts_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_drafts" ADD CONSTRAINT "conversion_drafts_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversion_drafts_snapshot_idx" ON "conversion_drafts" USING btree ("request_id","actor_id","target_module","target_type_id","snapshot");--> statement-breakpoint
CREATE INDEX "conversion_drafts_pending_idx" ON "conversion_drafts" USING btree ("state","started_at");