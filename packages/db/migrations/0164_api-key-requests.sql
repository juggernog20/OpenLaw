CREATE TABLE "api_key_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"requester_id" text NOT NULL,
	"client_name" text NOT NULL,
	"toolsets" jsonb NOT NULL,
	"scope" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"key_id" text,
	"sealed_key" text,
	"decided_by" text,
	"decision_note" text,
	"decided_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"expiry_audited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_key_requests_scope_check" CHECK ("api_key_requests"."scope" in ('read', 'write')),
	CONSTRAINT "api_key_requests_status_check" CHECK ("api_key_requests"."status" in ('pending', 'approved', 'denied', 'cancelled')),
	CONSTRAINT "api_key_requests_approval_check" CHECK (("api_key_requests"."status" = 'approved') = ("api_key_requests"."key_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"config_id" text DEFAULT 'default' NOT NULL,
	"name" text,
	"start" text,
	"prefix" text,
	"reference_id" text NOT NULL,
	"key" text NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"rate_limit_enabled" boolean DEFAULT true NOT NULL,
	"rate_limit_time_window" integer,
	"rate_limit_max" integer,
	"request_count" integer DEFAULT 0 NOT NULL,
	"remaining" integer,
	"last_request" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
ALTER TABLE "api_key_requests" ADD CONSTRAINT "api_key_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key_requests" ADD CONSTRAINT "api_key_requests_key_id_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key_requests" ADD CONSTRAINT "api_key_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_reference_id_users_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_key_requests_owner_idx" ON "api_key_requests" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "api_key_requests_status_idx" ON "api_key_requests" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_requests_key_unique" ON "api_key_requests" USING btree ("key_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_unique" ON "api_keys" USING btree ("key");--> statement-breakpoint
CREATE INDEX "api_keys_owner_idx" ON "api_keys" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "api_keys_expiry_idx" ON "api_keys" USING btree ("expires_at");