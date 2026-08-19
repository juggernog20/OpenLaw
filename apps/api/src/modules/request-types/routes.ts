// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The request-type taxonomy routes (INT-002, #85): the shared taxonomy
 * machinery (`taxonomyRoutes`) mounted on `request_types` with the
 * INT-002 vocabulary — the fourth mount, and the point of #85 is that
 * this file is configuration, not a copy. Every mutation is
 * Administrator-only and audit-logged (DD-017) — see the factory for
 * the behavior set.
 *
 * Two things are said by omission here.
 *
 * **No protected slug.** There is no fallback request type: no record
 * needs a non-null request type once conversion is done, so nothing has
 * to survive an Administrator's tidy-up. A row someone names "Other"
 * archives and deletes like any other row.
 *
 * **No extras yet.** The target columns are in the table and in the
 * seeds from this change, and they join the row projection and the
 * strict PATCH body with the editor (#354) — until then the mount is
 * the plain taxonomy the three type tables are.
 *
 * In-use counts read zero until `requests` exists in M20, exactly as
 * matter types read zero until M22.
 */

import { requestTypes } from "@openlaw/db";
import { taxonomyRoutes } from "../../lib/taxonomy-routes.js";

export const requestTypesRoutes = taxonomyRoutes({
  table: requestTypes,
  path: "request-types",
  tag: "request-types",
  idSingular: "RequestType",
  idPlural: "RequestTypes",
  keySingular: "requestType",
  keyPlural: "requestTypes",
  noun: "request type",
  decision: "INT-002",
  actionPrefix: "request_type",
  recordsMilestone: "M20",
  recordNoun: { singular: "request", plural: "requests" },
});
