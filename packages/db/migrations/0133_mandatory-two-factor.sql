-- SPDX-License-Identifier: AGPL-3.0-only

ALTER TABLE "org_settings" ADD COLUMN "require_two_factor" boolean DEFAULT false NOT NULL;
