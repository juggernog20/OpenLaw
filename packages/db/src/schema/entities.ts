// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Entities registry core (ENT-001, M7): our own corporate entities —
 * subsidiaries, holding companies, branches — carrying the identity-card
 * scalars only. Legal name and type are required; the rest of the card
 * is optional. `status` is the fixed ENT-001 enum (surfaces branch on
 * it — it is code, not a configurable list). Deferred ENT-001 pieces
 * (officers, share capital, registrations, holdings, obligations,
 * custom fields, the confidential flag) land with the features that
 * read them (M27), per the incremental-schema doctrine. No global
 * sequence number: entities are a registry, not numbered work records.
 * Soft delete via `archived_at` (NULL = live), like every registry row.
 */

import { sql } from "drizzle-orm";
import { check, date, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { entityTypes } from "./entity-types.js";
import { searchVector, uuidPk } from "./helpers.js";

/** The fixed ENT-001 status enum. Code branches on it (pickers filter
 * to `active`, list pills color by it), so it is not admin-configurable. */
export const ENTITY_STATUSES = ["active", "dormant", "dissolved", "divested"] as const;
export type EntityStatus = (typeof ENTITY_STATUSES)[number];

export const entities = pgTable(
  "entities",
  {
    id: uuidPk(),
    legalName: text("legal_name").notNull(),
    /** The configured entity type (ENT-001); required at registration.
     * No cascade: an in-use type refuses hard delete (SET-003, #100). */
    entityTypeId: text("entity_type_id")
      .notNull()
      .references(() => entityTypes.id),
    /** Formation jurisdiction; per-registration jurisdictions are ENT-002 (M27). */
    jurisdiction: text("jurisdiction"),
    formedOn: date("formed_on"),
    registrationNumber: text("registration_number"),
    taxId: text("tax_id"),
    registeredAgent: text("registered_agent"),
    registeredAddress: text("registered_address"),
    status: text("status", { enum: ENTITY_STATUSES }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    /** SET-003 soft delete: NULL = live; a timestamp = archived, out of
     * the default list and the M8 signing-entity picker, nothing lost. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /** M25's row-owned registry vector. The configured Entity type name
     * remains a query-time join rather than a copied label. */
    searchVector: searchVector("search_vector").generatedAlwaysAs(sql`
      setweight(to_tsvector('english', coalesce("legal_name", '')), 'A') ||
      setweight(to_tsvector('english', coalesce("jurisdiction", '')), 'C') ||
      setweight(to_tsvector('english', coalesce("registration_number", '')), 'C') ||
      setweight(to_tsvector('english', coalesce("status", '')), 'C')
    `),
  },
  (table) => [
    // The registry's one read shape: the list (and the M8 picker seam)
    // orders by case-insensitive legal name, then created_at.
    index("entities_legal_name_idx").on(sql`lower(${table.legalName})`, table.createdAt),
    index("entities_search_vector_idx").using("gin", table.searchVector),
    check(
      "entities_status_check",
      sql`${table.status} in ('active', 'dormant', 'dissolved', 'divested')`,
    ),
  ],
);

export type Entity = typeof entities.$inferSelect;
