ALTER TABLE "contract_envelopes" ADD COLUMN "recovery_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_envelopes" ADD COLUMN "next_recovery_at" timestamp with time zone DEFAULT now() + interval '15 minutes';--> statement-breakpoint
ALTER TABLE "contract_envelopes" ADD COLUMN "recovery_stopped" text;--> statement-breakpoint
ALTER TABLE "contract_envelopes" ADD CONSTRAINT "contract_envelopes_recovery_attempts_check" CHECK (recovery_attempts >= 0);--> statement-breakpoint
ALTER TABLE "contract_envelopes" ADD CONSTRAINT "contract_envelopes_recovery_stopped_check" CHECK (recovery_stopped is null or recovery_stopped in ('lookup_expired', 'attempts_exhausted', 'identity_missing'));