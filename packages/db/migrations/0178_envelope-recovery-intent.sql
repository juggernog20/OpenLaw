ALTER TABLE "contract_envelopes" ADD COLUMN "creation_kind" text;--> statement-breakpoint
ALTER TABLE "contract_envelopes" ADD COLUMN "creation_status_id" text;--> statement-breakpoint
ALTER TABLE "contract_envelopes" ADD COLUMN "creation_status_revision" integer;--> statement-breakpoint
ALTER TABLE "contract_envelopes" ADD CONSTRAINT "contract_envelopes_creation_kind_check" CHECK (creation_kind is null or creation_kind in ('draft', 'send'));--> statement-breakpoint
ALTER TABLE "contract_envelopes" ADD CONSTRAINT "contract_envelopes_creation_revision_check" CHECK (creation_status_revision is null or creation_status_revision >= 0);