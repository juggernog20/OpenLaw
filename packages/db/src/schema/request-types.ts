// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The request-type taxonomy (INT-002): the ordered list of front doors
 * a requester picks from in the portal, Admin-managed via Intake
 * Settings → Request types. The shared taxonomy shape
 * (`taxonomyColumns` — `contract_types`, `matter_types`, and
 * `entity_types` are the same machinery) plus the three columns that
 * are intake's own: the target.
 *
 * **The target is the routing decision, pre-encoded.** A request type
 * targets nothing, the Matter module, or the Contract module — and
 * inside Matter or Contract it may name one specific type. So "NDA
 * request" targets the NDA contract type, "Contract review" targets the
 * Contract module and leaves the type to the reviewer at conversion,
 * and "Legal question" targets nothing at all. The module-only state is
 * the third state INT-002 as written did not have; it is what lets a
 * request type promise a contract without pre-deciding which kind.
 *
 * Three columns hold it, and one check constraint holds them together:
 * `target_module` is NULL, `matter`, or `contract`; at most one type id
 * is set; and a type id may only be set under its matching module.
 *
 * **Deleting a targeted type demotes, never strands.** Both type FKs
 * are `on delete set null` while `target_module` stays, so
 * hard-deleting the NDA contract type turns "Contract · NDA" into
 * "Contract" — a state the model already has. Archiving a targeted type
 * is left alone: the target picker offers live types only, the editor
 * flags an archived target, and conversion reads it as no type.
 *
 * No row here is system-protected. There is no fallback request type
 * to keep, because no record needs a non-null request type once
 * conversion is done — a row an Administrator happens to name "Other"
 * archives and deletes like any other.
 */

import { sql } from "drizzle-orm";
import { check, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { contractTypes } from "./contract-types.js";
import { matterTypes } from "./matter-types.js";
import { taxonomyColumns } from "./helpers.js";

export const requestTypes = pgTable(
  "request_types",
  {
    ...taxonomyColumns(),
    /** What converting one of these requests creates: NULL (nothing),
     * `matter`, or `contract`. */
    targetModule: text("target_module"),
    /** The specific matter type, set only under `target_module =
     * 'matter'`; NULL leaves the type to the reviewer at conversion. */
    targetMatterTypeId: text("target_matter_type_id").references(() => matterTypes.id, {
      onDelete: "set null",
    }),
    /** The specific contract type, set only under `target_module =
     * 'contract'`; NULL leaves the type to the reviewer at conversion. */
    targetContractTypeId: text("target_contract_type_id").references(() => contractTypes.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("request_types_slug_unique").on(table.slug),
    /**
     * The whole three-state target in one constraint: no target carries
     * no type id, and each module admits its own type id and refuses
     * the other's. It also closes `target_module` to the two modules —
     * every other value falls through all three arms — for the reason
     * every other closed union in this schema is guarded here.
     *
     * The two module arms compare with `is not distinct from` rather
     * than `=`: a check constraint refuses only what evaluates to
     * FALSE, so a NULL module beside a set type id would compare to
     * NULL, leave the whole expression NULL, and be waved through.
     */
    check(
      "request_types_target_check",
      sql`(
        (${table.targetModule} is null and ${table.targetMatterTypeId} is null and ${table.targetContractTypeId} is null)
        or (${table.targetModule} is not distinct from 'matter' and ${table.targetContractTypeId} is null)
        or (${table.targetModule} is not distinct from 'contract' and ${table.targetMatterTypeId} is null)
      )`,
    ),
  ],
);

export type RequestType = typeof requestTypes.$inferSelect;
