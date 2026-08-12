// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract-type taxonomy (CTR-002): a configurable, ordered list of
 * types, Admin-managed via Contracts Settings → Types. The columns are
 * the shared taxonomy shape (`taxonomyColumns` — `matter_types` is the
 * same machinery per MTR-001). Eight rows are seeded by the migration
 * that creates the table; the `other` row is system-protected in
 * application code — no archive, no hard delete — so a non-null
 * fallback type always exists. The per-type field attachments live in
 * `contract_type_fields` (CTR-016), managed from the type editor.
 */

import { pgTable, uniqueIndex } from "drizzle-orm/pg-core";
import { taxonomyColumns } from "./helpers.js";

export const contractTypes = pgTable("contract_types", taxonomyColumns(), (table) => [
  uniqueIndex("contract_types_slug_unique").on(table.slug),
]);

export type ContractType = typeof contractTypes.$inferSelect;
