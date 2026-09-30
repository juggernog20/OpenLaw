// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The entity-type taxonomy (ENT-001): a configurable, ordered list of
 * types, Admin-managed via Entities Settings → Types. The columns are
 * the shared taxonomy shape (`taxonomyColumns` — `contract_types` and
 * `matter_types` are the same machinery per CTR-002/MTR-001). Five rows
 * are seeded by the migration that creates the table; the `other` row
 * is system-protected in application code — no archive, no hard delete —
 * so a non-null fallback type always exists. Like the other type
 * tables, Entity types carry Fields through a join table,
 * `entity_type_fields`, the third record-type mount of the shared
 * attachment machinery (TECH-023, M27). The nullable columns keep the
 * shared `taxonomyColumns` semantics: `description` NULL = no
 * description (the routes normalize an empty string to NULL; the M27
 * per-type editor writes it), and `archived_at` NULL = live, a
 * timestamp = archived (SET-003).
 */

import { sql } from "drizzle-orm";
import { check, text, pgTable, uniqueIndex } from "drizzle-orm/pg-core";
import { taxonomyColumns } from "./helpers.js";

export const REGISTER_KINDS = ["shares", "partnership", "trust", "none"] as const;
export type RegisterKind = (typeof REGISTER_KINDS)[number];

export const entityTypes = pgTable(
  "entity_types",
  {
    ...taxonomyColumns(),
    registerKind: text("register_kind", { enum: REGISTER_KINDS }).notNull().default("shares"),
  },
  (table) => [
    check(
      "entity_types_register_kind_check",
      sql`${table.registerKind} in ('shares', 'partnership', 'trust', 'none')`,
    ),
    uniqueIndex("entity_types_slug_unique").on(table.slug),
  ],
);

export type EntityType = typeof entityTypes.$inferSelect;
