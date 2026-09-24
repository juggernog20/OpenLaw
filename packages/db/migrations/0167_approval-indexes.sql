-- SPDX-License-Identifier: AGPL-3.0-only

-- Handling an approval finds every recipient's open copy by its request
-- id: the Contract Approval id inside the payload, or the API key
-- request id in entity_id. Both indexes are partial over the open rows,
-- because those are the only rows the handler ever looks for.
--
-- Plain CREATE INDEX, as 0080, 0089 and 0099 settled: TECH-005 runs
-- migrations on container start, before the API accepts a request, so
-- nothing is writing while these build and CONCURRENTLY would buy
-- nothing. It would also cost the runner's transaction: Drizzle applies
-- every pending migration and its journal row in one transaction, and a
-- COMMIT in the middle of a file leaves DDL behind with no journal row
-- when a later statement fails.

CREATE INDEX "notifications_open_contract_approval_idx" ON "notifications" USING btree (("payload"->>'approvalId')) WHERE "notifications"."approval_kind" = 'contract' and "notifications"."handled_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_open_api_key_approval_idx" ON "notifications" USING btree ("entity_id") WHERE "notifications"."approval_kind" = 'api_key' and "notifications"."handled_at" is null;
