// SPDX-License-Identifier: AGPL-3.0-only

/** Legacy Request attachment routes remain until the contract migration.
Portal forms read destination Forms, and this mount offers no companion attach. */

import { requestTypeFields, requestTypes, type RequestType } from "@openlaw/db";
import { typeFieldRoutes } from "../../lib/type-field-routes.js";
import { requestFormRequiredRule, requestTypeScopeRule } from "./form-definition.js";

export const requestTypeFieldsRoutes = typeFieldRoutes<RequestType>({
  typesTable: requestTypes,
  joinTable: requestTypeFields,
  path: "request-types",
  tag: "request-types",
  idInfix: "RequestType",
  noun: "request type",
  scopeRule: requestTypeScopeRule,
  scopeSummary: "the scopes this type's target allows (INT-002)",
  requiredRule: requestFormRequiredRule,
  actionPrefix: "request_type_field",
  // The portal enforces the flag when a requester submits (M20); there
  // is no request to enforce it against until then.
  requiredMilestone: "M20",
});
