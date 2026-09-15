-- SPDX-License-Identifier: AGPL-3.0-only

ALTER TABLE "sessions" ADD COLUMN "second_factor_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "authentication_policy" jsonb;
