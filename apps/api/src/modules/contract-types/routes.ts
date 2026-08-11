// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract-type taxonomy routes (CTR-002, #81): the shared taxonomy
 * machinery (`taxonomyRoutes`, extracted with #85) mounted on
 * `contract_types` with the CTR-002 vocabulary. The `other` row is
 * system-protected; every mutation is Administrator-only and
 * audit-logged (DD-017) — see the factory for the behavior set.
 */

import { contractTypes } from "@openlaw/db";
import { taxonomyRoutes } from "../../lib/taxonomy-routes.js";

export const contractTypesRoutes = taxonomyRoutes({
  table: contractTypes,
  path: "contract-types",
  tag: "contract-types",
  idSingular: "ContractType",
  idPlural: "ContractTypes",
  keySingular: "contractType",
  keyPlural: "contractTypes",
  noun: "contract type",
  nounPlural: "contract types",
  decision: "CTR-002",
  actionPrefix: "contract_type",
  recordsMilestone: "M8",
  recordNoun: "contracts",
});
