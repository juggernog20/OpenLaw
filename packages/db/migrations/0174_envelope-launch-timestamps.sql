-- SPDX-License-Identifier: AGPL-3.0-only

-- Existing correlations receive the upgrade time; their expiry and consumption are unchanged.
ALTER TABLE "envelope_launches" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "envelope_launches" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;