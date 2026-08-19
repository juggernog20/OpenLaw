// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract-type taxonomy routes (CTR-002, #81): the shared taxonomy
 * machinery (`taxonomyRoutes`, extracted with #85) mounted on
 * `contract_types` with the CTR-002 vocabulary. The `other` row is
 * system-protected; every mutation is Administrator-only and
 * audit-logged (DD-017) — see the factory for the behavior set.
 *
 * The SET-003 archive guard is live from #113: the contract record
 * supplies the usage hook, so every count is a real query over
 * `contracts.contract_type_id` and archiving an in-use type moves its
 * contracts to a target type.
 */

import { contractTypes } from "@openlaw/db";
import { taxonomyRoutes } from "../../lib/taxonomy-routes.js";
import { contractTypeUsage } from "../contracts/type-usage.js";

export const contractTypesRoutes = taxonomyRoutes({
  table: contractTypes,
  path: "contract-types",
  tag: "contract-types",
  idSingular: "ContractType",
  idPlural: "ContractTypes",
  keySingular: "contractType",
  keyPlural: "contractTypes",
  noun: "contract type",
  decision: "CTR-002",
  actionPrefix: "contract_type",
  usage: contractTypeUsage,
  recordNoun: { singular: "contract", plural: "contracts" },
  protectedSlug: "other",
});
