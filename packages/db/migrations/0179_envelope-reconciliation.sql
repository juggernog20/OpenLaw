-- SPDX-License-Identifier: AGPL-3.0-only

DROP INDEX "contract_envelopes_live_idx";--> statement-breakpoint
ALTER TABLE "contract_envelopes" ADD COLUMN "scheduled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_envelopes" ADD COLUMN "externally_restored" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_envelopes_live_idx" ON "contract_envelopes" USING btree ("contract_id") WHERE status in ('preparing', 'draft', 'sent') and not externally_restored;