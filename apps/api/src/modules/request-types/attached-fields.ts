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
 * Only the user Field type cannot be required. Entity Fields use the
 * Portal-listed Entity picker (ENT-010).
 *
 * The companion attach on the default destination type is this
 * mount's too (`target-attach.ts`): a form field that the target type
 * does not attach would collect a value with nowhere to land, so the
 * attach body may ask for both in one act.
 *
 * The four basics (Title, Description, Attachments, Urgency) are not
 * attachments. INT-002 fixes them on every form, so they have no rows
 * here and never reach these routes. The editor draws them as locked
 * rows above the ones that do.
 */

import { requestTypeFields, requestTypes, type RequestType } from "@openlaw/db";
import { typeFieldRoutes } from "../../lib/type-field-routes.js";
import { requestFormRequiredRule, requestTypeScopeRule } from "./form-definition.js";
import { requestTypeTargetAttach } from "./target-attach.js";

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
  // The companion attach on the default destination type (INT-002,
  // 2026-09-19): the one mount with a target is the one that states it.
  targetAttach: requestTypeTargetAttach,
  actionPrefix: "request_type_field",
  // The portal enforces the flag when a requester submits (M20); there
  // is no request to enforce it against until then.
  requiredMilestone: "M20",
});
