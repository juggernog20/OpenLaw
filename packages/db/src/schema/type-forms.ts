// SPDX-License-Identifier: AGPL-3.0-only
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { FormCondition } from "@openlaw/shared";
import { contractTypes } from "./contract-types.js";
import { matterTypes } from "./matter-types.js";
import { entityTypes } from "./entity-types.js";

/** Branch IDs belong to a type; composite foreign keys keep every child on that type. */
function branchTable<N extends string>(name: N, typeColumn: string, typeId: () => AnyPgColumn) {
  const table = pgTable(
    name,
    {
      typeId: text(typeColumn).notNull().references(typeId, { onDelete: "cascade" }),
      id: text("id").notNull(),
      parentBranchId: text("parent_branch_id"),
      displayOrder: integer("display_order").notNull(),
      match: text("match", { enum: ["all", "any"] }).notNull(),
      conditions: jsonb("conditions").$type<FormCondition[]>().notNull(),
    },
    (t) => [
      primaryKey({ columns: [t.typeId, t.id] }),
      foreignKey({
        columns: [t.typeId, t.parentBranchId],
        foreignColumns: [t.typeId, t.id],
      }).onDelete("cascade"),
      check(`${name}_match_check`, sql`${t.match} in ('all', 'any')`),
      check(`${name}_conditions_check`, sql`jsonb_typeof(${t.conditions}) = 'array'`),
    ],
  );
  return table;
}
export const contractTypeBranches = branchTable(
  "contract_type_branches",
  "contract_type_id",
  () => contractTypes.id,
);
export const matterTypeBranches = branchTable(
  "matter_type_branches",
  "matter_type_id",
  () => matterTypes.id,
);
export const entityTypeBranches = branchTable(
  "entity_type_branches",
  "entity_type_id",
  () => entityTypes.id,
);

function builtinTable<N extends string>(
  name: N,
  typeColumn: string,
  typeId: () => AnyPgColumn,
  branches: typeof contractTypeBranches | typeof matterTypeBranches,
) {
  return pgTable(
    name,
    {
      typeId: text(typeColumn).notNull().references(typeId, { onDelete: "cascade" }),
      builtinKey: text("builtin_key").notNull(),
      displayOrder: integer("display_order").notNull(),
      isRequired: boolean("is_required").notNull().default(false),
      onIntakeForm: boolean("on_intake_form").notNull().default(false),
      branchId: text("branch_id"),
    },
    (t) => [
      primaryKey({ columns: [t.typeId, t.builtinKey] }),
      foreignKey({
        columns: [t.typeId, t.branchId],
        foreignColumns: [branches.typeId, branches.id],
      }).onDelete("cascade"),
      check(
        `${name}_unpinned_check`,
        sql`${t.builtinKey} not in ('title', 'contract_type', 'matter_type')`,
      ),
    ],
  );
}
export const contractTypeBuiltinRows = builtinTable(
  "contract_type_builtin_rows",
  "contract_type_id",
  () => contractTypes.id,
  contractTypeBranches,
);
export const matterTypeBuiltinRows = builtinTable(
  "matter_type_builtin_rows",
  "matter_type_id",
  () => matterTypes.id,
  matterTypeBranches,
);
