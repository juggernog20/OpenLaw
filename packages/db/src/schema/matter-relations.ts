// SPDX-License-Identifier: AGPL-3.0-only

/** One canonically ordered, undirected related-Matter pair (MTR-015). */
import { sql } from "drizzle-orm";
import { check, index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { matters } from "./matters.js";

export const matterRelations = pgTable(
  "matter_relations",
  {
    matterAId: text("matter_a_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    matterBId: text("matter_b_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "matter_relations_pkey",
      columns: [table.matterAId, table.matterBId],
    }),
    index("matter_relations_b_idx").on(table.matterBId),
    // Canonical ordering says both "not self" and "one direction only"
    // at the database boundary, including for writers outside the API.
    check("matter_relations_canonical_check", sql`${table.matterAId} < ${table.matterBId}`),
  ],
);

export type MatterRelation = typeof matterRelations.$inferSelect;
