-- SPDX-License-Identifier: AGPL-3.0-only

CREATE TABLE "oauth_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"allowed_client_id" text NOT NULL,
	"toolsets" text[] NOT NULL,
	"scope" text NOT NULL,
	"consent_id" text,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	CONSTRAINT "oauth_grants_scope_check" CHECK ("oauth_grants"."scope" in ('read', 'write')),
	CONSTRAINT "oauth_grants_toolsets_check" CHECK (cardinality("oauth_grants"."toolsets") > 0)
);
--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_person_id_users_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_allowed_client_id_allowed_clients_id_fk" FOREIGN KEY ("allowed_client_id") REFERENCES "public"."allowed_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_consent_id_oauth_consents_id_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."oauth_consents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_grants_person_client_unique" ON "oauth_grants" USING btree ("person_id","allowed_client_id");--> statement-breakpoint
CREATE INDEX "oauth_grants_allowed_client_idx" ON "oauth_grants" USING btree ("allowed_client_id");