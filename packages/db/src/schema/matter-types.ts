// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The matter-type taxonomy (MTR-001): a configurable, ordered list of
 * types, Admin-managed via Matters Settings → Types. The columns are
 * the shared taxonomy shape (`taxonomyColumns` — `contract_types` is
 * the same machinery per CTR-002). Nine rows are seeded by the
 * migration that creates the table; the `other` row is
 * system-protected in application code — no archive, no hard delete —
 * so a non-null fallback type always exists. The per-type field
 * attachments live in `matter_type_fields` (MTR-011), managed from the
 * type editor.
 */

import { pgTable, uniqueIndex } from "drizzle-orm/pg-core";
import { taxonomyColumns } from "./helpers.js";

export const matterTypes = pgTable("matter_types", taxonomyColumns(), (table) => [
  uniqueIndex("matter_types_slug_unique").on(table.slug),
]);

export type MatterType = typeof matterTypes.$inferSelect;
