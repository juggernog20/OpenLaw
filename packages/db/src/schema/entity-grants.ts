// SPDX-License-Identifier: AGPL-3.0-only

/** Explicit readers of a Confidential Entity (ENT-004). */
import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { entities } from "./entities.js";

export const entityGrants = pgTable(
  "entity_grants",
  {
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.entityId, table.userId] }),
    index("entity_grants_user_idx").on(table.userId),
  ],
);

export type EntityGrant = typeof entityGrants.$inferSelect;
