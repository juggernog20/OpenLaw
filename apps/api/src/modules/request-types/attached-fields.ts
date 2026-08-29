// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The request type editor's form definition (INT-002, #355): the shared
 * per-type field attachment routes (`typeFieldRoutes`) mounted on
 * `request_type_fields`. This is the third mount, and the point of #85
 * is that this file is configuration, not a copy. See the factory for
 * the behavior set.
 *
 * The scope rule is a function of the row, not a constant. What may
 * attach follows the type's target, so this mount passes the rule
 * `form-definition.ts` states and the attach route resolves it against
 * the row it has already locked. The target validator reads the same
 * rule when it refuses a re-point that would strand fields, which is
 * why neither file owns it.
 *
 * The required rule is this mount's own. A `user` or `entity` field
 * may be attached to a request type but may never be marked required
 * on its form: the portal offers a requester no rows for either, so a
 * required one could never be answered. The refusal names the field,
 * and it reaches the Administrator who set the flag rather than the
 * requester who would meet it (the INT-002 M20/11 addendum).
 *
 * The four basics (Summary, Description, Attachments, Urgency) are not
 * attachments. INT-002 fixes them on every form, so they have no rows
 * here and never reach these routes. The editor draws them as locked
 * rows above the ones that do.
 */

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
  // The one rule that is this mount's alone: a `user` or `entity` field
  // may sit on a request form, but may never be required on one (#400).
  // The other two mounts pass nothing. Their pickers have rows.
  requiredRule: requestFormRequiredRule,
  actionPrefix: "request_type_field",
  // The portal enforces the flag when a requester submits (M20); there
  // is no request to enforce it against until then.
  requiredMilestone: "M20",
});
