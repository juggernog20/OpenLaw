// SPDX-License-Identifier: AGPL-3.0-only

/** ENT-001's Administrator-managed officer role taxonomy. */
import { pgTable, uniqueIndex } from "drizzle-orm/pg-core";
import { taxonomyColumns } from "./helpers.js";

export const officerRoles = pgTable("officer_roles", taxonomyColumns(), (table) => [
  uniqueIndex("officer_roles_slug_unique").on(table.slug),
]);

export type OfficerRole = typeof officerRoles.$inferSelect;
