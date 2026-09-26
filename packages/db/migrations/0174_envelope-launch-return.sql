-- SPDX-License-Identifier: AGPL-3.0-only

CREATE TABLE "envelope_launches" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"envelope_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"provider_environment" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "contract_envelopes" ADD COLUMN "confirmation_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "envelope_launches" ADD CONSTRAINT "envelope_launches_envelope_id_contract_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."contract_envelopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envelope_launches" ADD CONSTRAINT "envelope_launches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
