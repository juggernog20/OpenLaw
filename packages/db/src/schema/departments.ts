// SPDX-License-Identifier: AGPL-3.0-only

/** SET-010 Department taxonomy, shared by users and Contract classification. */

import { pgTable, uniqueIndex } from "drizzle-orm/pg-core";
import { taxonomyColumns } from "./helpers.js";

export const departments = pgTable("departments", taxonomyColumns(), (table) => [
  uniqueIndex("departments_slug_unique").on(table.slug),
]);

export type Department = typeof departments.$inferSelect;
