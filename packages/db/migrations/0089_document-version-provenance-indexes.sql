-- SPDX-License-Identifier: AGPL-3.0-only

-- Index both provenance columns. They reference this same table, so a
-- hard delete of a document asks, for every round it removes, whether
-- any row still names that round as a comparison operand. Unindexed
-- each of those checks is a scan of the whole table.
--
-- Both are partial: a generated redline is the only kind that fills
-- these columns, so the index holds one entry per redline rather than
-- one per round in the install. The predicate is implied by the
-- equality the FK check makes, so the partial index still serves it.
--
-- Plain CREATE INDEX, as migration 0080 settled for the same reason:
-- the blessed upgrade runs before the API starts, so nothing is writing
-- while this builds and CONCURRENTLY would buy nothing.

CREATE INDEX "document_versions_compared_from_idx" ON "document_versions" USING btree ("compared_from_version_id") WHERE "document_versions"."compared_from_version_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "document_versions_compared_to_idx" ON "document_versions" USING btree ("compared_to_version_id") WHERE "document_versions"."compared_to_version_id" IS NOT NULL;
