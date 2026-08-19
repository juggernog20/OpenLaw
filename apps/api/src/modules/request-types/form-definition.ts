// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The form definition's cross-cutting rule (INT-002, #355): which
 * catalog fields a request type's portal form may collect, and what
 * follows from that when the type is re-pointed.
 *
 * **It lives here because two mounts read it.** The attachment routes
 * ask it what may attach; the taxonomy routes' target validator asks it
 * what a proposed target would strand. Neither owns it — a rule stated
 * twice is a rule that drifts — so both import it, and the seam between
 * the join table and the taxonomy row is this one file.
 *
 * The rule is CTR-016's scope rule applied one level out: a request
 * type does not have a scope of its own, so it borrows the scope of the
 * module its target names. Target Contract takes `contract` and
 * `global`; target Matter takes `matter` and `global`; no target takes
 * `global` only. The matter arm is live and empty until M22 opens the
 * `matter` field scope, exactly as `matter_type_fields` already is.
 */

import { and, asc, count, eq, fields, inArray, isNull, requestTypeFields } from "@openlaw/db";
import type { Executor, FieldModuleScope, RequestType } from "@openlaw/db";
import type { TypeFieldScopeRule } from "../../lib/type-field-routes.js";

/** The two modules a request type may convert into (INT-002). Said
 * once, here, because the taxonomy routes turn it into the wire enum
 * and the scope rule below branches on it. */
export const TARGET_MODULES = ["matter", "contract"] as const;
export type TargetModule = (typeof TARGET_MODULES)[number];

/**
 * What a request type with this target may collect. Read off the
 * target alone, so a caller that is deciding a target — rather than
 * reading one — asks the same question about the target it is about to
 * write.
 */
export function formFieldScopeRule(targetModule: TargetModule | null): TypeFieldScopeRule {
  switch (targetModule) {
    case "contract":
      return {
        scopes: ["contract", "global"],
        refusal:
          "This request type targets Contract, so its form takes " +
          "contract-scoped and global fields only.",
      };
    case "matter":
      return {
        scopes: ["matter", "global"],
        refusal:
          "This request type targets Matter, so its form takes " +
          "matter-scoped and global fields only.",
      };
    default:
      return {
        scopes: ["global"],
        refusal:
          "This request type has no target, so its form takes global fields only. " +
          "Point it at Matter or Contract to attach that module's fields.",
      };
  }
}

/** The rule for one row, as the attachment mount reads it. */
export const requestTypeScopeRule = (type: RequestType): TypeFieldScopeRule =>
  formFieldScopeRule(type.targetModule as TargetModule | null);

/**
 * The attached fields a move to `scopes` would leave with nowhere to
 * land, by display name, in form order.
 *
 * **Archived fields are not stranded.** Their attachments persist but
 * never render (the list route hides them), so an Administrator has no
 * row to detach — and a refusal naming one would be a refusal nobody
 * could clear. It is the same "archived means hidden everywhere" rule
 * the attach route already follows.
 */
export async function strandedFieldNames(
  tx: Executor,
  typeId: string,
  scopes: readonly FieldModuleScope[],
): Promise<string[]> {
  const attached = await tx
    .select({ displayName: fields.displayName, moduleScope: fields.moduleScope })
    .from(requestTypeFields)
    .innerJoin(fields, eq(requestTypeFields.fieldId, fields.id))
    .where(and(eq(requestTypeFields.typeId, typeId), isNull(fields.archivedAt)))
    .orderBy(asc(requestTypeFields.displayOrder), asc(requestTypeFields.createdAt));
  return attached.filter((row) => !scopes.includes(row.moduleScope)).map((row) => row.displayName);
}

/** "Contract value" / "Contract value and Governing law" — the refusal
 * names every stranded field, and `Intl` joins them (the M4 rule). */
const nameList = new Intl.ListFormat("en-US", { style: "long", type: "conjunction" });

/**
 * The refusal a target change earns when it would strand attached
 * fields. It names them, because the Administrator's next act is to
 * detach exactly those (SET-003's house style: guards refuse and
 * explain, they do not delete quietly).
 */
export function strandRefusal(names: readonly string[]): string {
  return (
    `${nameList.format(names)} ${names.length === 1 ? "does" : "do"} not fit that target. ` +
    `Detach ${names.length === 1 ? "it" : "them"} from the form first.`
  );
}

/**
 * How many live fields each of these types collects, keyed by type id —
 * the Form fields column on the ST12 pane.
 *
 * Batched over the whole answer set for the reason `TaxonomyUsage.
 * counts` is: the pane reads every type at once, and a count read row
 * by row would be an N+1 behind one list.
 *
 * Live fields only, so the number matches the list the editor draws:
 * an attachment to an archived field is hidden there, and a column that
 * counted it would send an Administrator looking for a row that is not
 * on the screen.
 */
export async function formFieldCounts(
  db: Executor,
  ids: readonly string[],
): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ typeId: requestTypeFields.typeId, total: count() })
    .from(requestTypeFields)
    .innerJoin(fields, eq(requestTypeFields.fieldId, fields.id))
    .where(and(inArray(requestTypeFields.typeId, [...ids]), isNull(fields.archivedAt)))
    .groupBy(requestTypeFields.typeId);
  return new Map(rows.map((row) => [row.typeId, row.total]));
}
