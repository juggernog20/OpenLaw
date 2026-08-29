// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The entity-type taxonomy (ENT-001): a configurable, ordered list of
 * types, Admin-managed via Entities Settings → Types. The columns are
 * the shared taxonomy shape (`taxonomyColumns` — `contract_types` and
 * `matter_types` are the same machinery per CTR-002/MTR-001). Five rows
 * are seeded by the migration that creates the table; the `other` row
 * is system-protected in application code — no archive, no hard delete —
 * so a non-null fallback type always exists. Unlike the other type
 * tables, Entity types carry Fields through `entity_type_fields`, the
 * third mount of the shared attachment machinery (TECH-023). The nullable columns
 * keep the shared `taxonomyColumns` semantics: `description` NULL = no
 * description (the routes normalize an empty string to NULL; with no
 * per-type editor screen it is API-writable only for now), and
 * `archived_at` NULL = live, a timestamp = archived (SET-003).
 */

import { pgTable, uniqueIndex } from "drizzle-orm/pg-core";
import { taxonomyColumns } from "./helpers.js";

export const entityTypes = pgTable("entity_types", taxonomyColumns(), (table) => [
  uniqueIndex("entity_types_slug_unique").on(table.slug),
]);

export type EntityType = typeof entityTypes.$inferSelect;
