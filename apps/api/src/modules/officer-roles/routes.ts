// SPDX-License-Identifier: AGPL-3.0-only

/** ENT-001 officer roles, the fifth configured taxonomy mount (TECH-023). */
import { officerRoles } from "@openlaw/db";
import { taxonomyRoutes } from "../../lib/taxonomy-routes.js";
import { officerRoleUsage } from "./usage.js";

export const officerRolesRoutes = taxonomyRoutes({
  table: officerRoles,
  path: "officer-roles",
  tag: "officer-roles",
  idSingular: "OfficerRole",
  idPlural: "OfficerRoles",
  keySingular: "officerRole",
  keyPlural: "officerRoles",
  noun: "officer role",
  decision: "ENT-001",
  actionPrefix: "officer_role",
  recordNoun: { singular: "officer", plural: "officers" },
  usage: officerRoleUsage,
  protectedSlug: "other",
});
