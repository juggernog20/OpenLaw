// SPDX-License-Identifier: AGPL-3.0-only
import {
  contractTypes,
  matterTypes,
  requestTypes,
  contractTypeFields,
  matterTypeFields,
  departments,
  regions,
  eq,
  isNull,
  type Executor,
} from "@openlaw/db";
import { formForTouchpoint, type Form, type FormRow } from "@openlaw/shared";
import { readTypeForm } from "./type-form-routes.js";
import { selectAttachedFields, type AttachedCustomField } from "./custom-fields.js";
import { httpError } from "./problem.js";

const labels: Record<string, string> = {
  description: "Description",
  entity: "Our entity",
  counterparties: "Counterparties",
  owning_department: "Department",
  department: "Department",
  region: "Region",
  priority: "Priority",
  risk: "Risk",
  term_type: "Term type",
  effective_date: "Effective date",
  expiry_date: "Expiry date",
  renewal_period_months: "Renewal period",
  notice_period_days: "Notice period",
  value_amount: "Value amount",
  value_currency: "Value currency",
  value_cadence: "Value frequency",
  needed_by: "Needed by",
};
const options: Record<string, string[]> = {
  priority: ["low", "medium", "high", "critical"],
  risk: ["low", "medium", "high", "critical"],
  term_type: ["fixed", "auto_renew", "evergreen"],
  value_cadence: ["one_time", "monthly", "annually"],
};
export function intakeRows(form: Form): FormRow[] {
  return form.flatMap((n) => (n.kind === "row" ? [n] : intakeRows(n.children)));
}
export function intakeRowKeys(rowRef: string): string[] {
  return rowRef === "value" ? ["value_amount", "value_currency", "value_cadence"] : [rowRef];
}

/** The Request type selects a Form; it owns no questions of its own. */
export async function readIntakeForm(db: Executor, requestTypeId: string, lock = false) {
  const [requestType] = await db
    .select()
    .from(requestTypes)
    .where(eq(requestTypes.id, requestTypeId));
  if (!requestType) throw httpError(404, "That Request type does not exist.");
  const module = requestType.targetModule;
  const table = module === "contract" ? contractTypes : matterTypes;
  const selected =
    module === "contract" ? requestType.targetContractTypeId : requestType.targetMatterTypeId;
  const query = db
    .select({ id: table.id })
    .from(table)
    .where(selected ? eq(table.id, selected) : eq(table.isDefault, true));
  const [type] = await (lock ? query.for("share") : query);
  if (!type) throw httpError(400, "This Request type needs a destination type.");
  const form = formForTouchpoint(await readTypeForm(db, module, type.id), "intake");
  const attached = await selectAttachedFields(
    db,
    module === "contract" ? contractTypeFields : matterTypeFields,
    type.id,
  );
  const fields: AttachedCustomField[] = intakeRows(form).flatMap((row) => {
    const field = attached.find((f) => f.fieldId === row.id);
    if (field) return [{ ...field, isRequired: row.fieldType !== "user" && row.isRequired }];
    return intakeRowKeys(row.rowRef).map((key): AttachedCustomField => ({
      fieldId: key,
      slug: key,
      builtInKey: key,
      displayName: labels[key] ?? key,
      description: null,
      fieldTag: "business",
      displayOrder: 0,
      fieldType:
        row.rowRef === "value"
          ? key === "value_amount"
            ? "number"
            : key === "value_currency"
              ? "currency"
              : "single_select"
          : row.fieldType === "money"
            ? "number"
            : row.fieldType,
      options: options[key] ?? null,
      isRequired: row.isRequired,
    }));
  });
  const [departmentOptions, regionOptions] = await Promise.all([
    db
      .select({ id: departments.id, displayName: departments.displayName })
      .from(departments)
      .where(isNull(departments.archivedAt)),
    db
      .select({ id: regions.id, displayName: regions.displayName })
      .from(regions)
      .where(isNull(regions.archivedAt)),
  ]);
  for (const [index, field] of fields.entries()) {
    field.displayOrder = index + 1;
    if (["owning_department", "department"].includes(field.builtInKey ?? ""))
      field.options = departmentOptions.map((o) => o.id);
    if (field.builtInKey === "region") field.options = regionOptions.map((o) => o.id);
  }
  return { form, fields, regions: regionOptions, module, typeId: type.id };
}
