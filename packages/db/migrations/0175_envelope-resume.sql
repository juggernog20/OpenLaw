ALTER TABLE "contract_envelopes" DROP CONSTRAINT "contract_envelopes_sent_time";--> statement-breakpoint
ALTER TABLE "contract_envelopes" DROP CONSTRAINT "contract_envelopes_status_check";--> statement-breakpoint
ALTER TABLE "contract_envelopes" ADD COLUMN "launch_claim_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contract_envelopes" ADD CONSTRAINT "contract_envelopes_sent_time" CHECK ((status in ('preparing', 'draft', 'preparation_failed', 'discarded')) = (sent_at is null));--> statement-breakpoint
ALTER TABLE "contract_envelopes" ADD CONSTRAINT "contract_envelopes_status_check" CHECK (status in ('preparing', 'draft', 'preparation_failed', 'discarded', 'sent', 'signed', 'declined', 'voided'));