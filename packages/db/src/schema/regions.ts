// SPDX-License-Identifier: AGPL-3.0-only

/** SET-012 Region taxonomy, shared by Contract and Matter classification. */

import { sql } from "drizzle-orm";
import { pgTable, uniqueIndex } from "drizzle-orm/pg-core";
import { taxonomyColumns } from "./helpers.js";

export const regions = pgTable("regions", taxonomyColumns(), (table) => [
  uniqueIndex("regions_slug_unique").on(table.slug),
  uniqueIndex("regions_display_name_unique").on(table.displayName),
  uniqueIndex("regions_display_name_lower_unique").on(sql`lower(${table.displayName})`),
]);

export type Region = typeof regions.$inferSelect;
