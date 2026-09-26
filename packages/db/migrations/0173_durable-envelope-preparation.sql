-- SPDX-License-Identifier: AGPL-3.0-only
ALTER TABLE "contract_envelopes" DROP CONSTRAINT "contract_envelopes_status_check";--> statement-breakpoint
ALTER TABLE "contract_envelopes" DROP CONSTRAINT "contract_envelopes_completed_at";--> statement-breakpoint
DROP INDEX "contract_envelopes_live_idx";--> statement-breakpoint
ALTER TABLE "contract_envelopes" ALTER COLUMN "provider_envelope_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_envelopes" ALTER COLUMN "sent_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_envelopes" ADD COLUMN "document_id" text;--> statement-breakpoint
ALTER TABLE "contract_envelopes" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "contract_envelopes" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "contract_envelopes" ADD COLUMN "request_fingerprint" text;--> statement-breakpoint
ALTER TABLE "contract_envelopes" ADD COLUMN "provider_transaction_id" text;--> statement-breakpoint
ALTER TABLE "contract_envelopes" ADD COLUMN "provider_account_id" text;--> statement-breakpoint
ALTER TABLE "contract_envelopes" ADD COLUMN "provider_environment" text;--> statement-breakpoint
ALTER TABLE "contract_envelopes" ADD COLUMN "preparation_state" text;--> statement-breakpoint
ALTER TABLE "contract_envelopes" ADD CONSTRAINT "contract_envelopes_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_envelopes_idempotency_idx" ON "contract_envelopes" USING btree ("contract_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_envelopes_transaction_idx" ON "contract_envelopes" USING btree ("provider_transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_envelopes_live_idx" ON "contract_envelopes" USING btree ("contract_id") WHERE status in ('preparing', 'draft', 'sent');--> statement-breakpoint
ALTER TABLE "contract_envelopes" ADD CONSTRAINT "contract_envelopes_creation_check" CHECK (preparation_state is null or preparation_state in ('pending', 'uncertain', 'created', 'failed'));--> statement-breakpoint
ALTER TABLE "contract_envelopes" ADD CONSTRAINT "contract_envelopes_provider_required" CHECK (status in ('preparing', 'preparation_failed') or provider_envelope_id is not null);--> statement-breakpoint
ALTER TABLE "contract_envelopes" ADD CONSTRAINT "contract_envelopes_sent_time" CHECK ((status in ('preparing', 'draft', 'preparation_failed')) = (sent_at is null));--> statement-breakpoint
ALTER TABLE "contract_envelopes" ADD CONSTRAINT "contract_envelopes_status_check" CHECK (status in ('preparing', 'draft', 'preparation_failed', 'sent', 'signed', 'declined', 'voided'));--> statement-breakpoint
ALTER TABLE "contract_envelopes" ADD CONSTRAINT "contract_envelopes_completed_at" CHECK ((status in ('preparing', 'draft', 'sent')) = (completed_at is null));