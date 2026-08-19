// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract type editor's attachment routes (CTR-016, #84): the
 * shared per-type field attachment machinery (`typeFieldRoutes`,
 * extracted with #85) mounted on `contract_type_fields` with the
 * CTR-016 scope rule — contract-scoped and global fields only; other
 * modules' scopes are refused. The rule is one line for every contract
 * type, so the mount states it as a constant. See the factory for the
 * behavior set.
 */

import { contractTypeFields, contractTypes } from "@openlaw/db";
import { typeFieldRoutes } from "../../lib/type-field-routes.js";

export const attachedFieldsRoutes = typeFieldRoutes({
  typesTable: contractTypes,
  joinTable: contractTypeFields,
  path: "contract-types",
  tag: "contract-types",
  idInfix: "ContractType",
  noun: "contract type",
  scopeRule: {
    scopes: ["contract", "global"],
    refusal: "Only contract-scoped and global fields attach to contract types.",
  },
  scopeSummary: "contract-scoped and global fields only (CTR-016)",
  actionPrefix: "contract_type_field",
  // No `requiredMilestone`: the contract record enforces the flag from
  // #112, at creation and at re-type (CTR-016/MTR-014).
});
