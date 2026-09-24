-- SPDX-License-Identifier: AGPL-3.0-only

-- DD-017's via attribution (#1061): what a person acted through. NULL on
-- every row written before this and on every row the browser writes; an
-- MCP write carries the credential and the Client's name.
--
-- The preamble is TECH-006's #390 rule: four statements that must land
-- together get a transaction of their own on every upgrade path.
--
-- The CHECK is validated in place, as 0080, 0089, 0099 and 0164 settled
-- for indexes: TECH-005 runs migrations on container start, before the
-- API accepts a request, so nothing writes while the scan runs and a
-- NOT VALID constraint with a later VALIDATE would buy nothing. It would
-- also cost a second migration file whose only work is that scan.
COMMIT;--> statement-breakpoint
BEGIN;--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN "via_kind" text;--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN "via_id" text;--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN "via_client_name" text;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_via_kind_check" CHECK ("activity_log"."via_kind" in ('ui', 'api_key', 'oauth_client'));
