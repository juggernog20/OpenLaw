// SPDX-License-Identifier: AGPL-3.0-only

/** SET-012 Region taxonomy, shared by users and Contract classification. */

import { pgTable, uniqueIndex } from "drizzle-orm/pg-core";
import { taxonomyColumns } from "./helpers.js";

export const regions = pgTable("regions", taxonomyColumns(), (table) => [
  uniqueIndex("regions_slug_unique").on(table.slug),
  uniqueIndex("regions_display_name_unique").on(table.displayName),
]);

export type Region = typeof regions.$inferSelect;
