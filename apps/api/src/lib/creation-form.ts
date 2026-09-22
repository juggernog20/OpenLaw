// SPDX-License-Identifier: AGPL-3.0-only

/** The creation touchpoint of a type's Form (DD-028): the Intake and
 * Creation Rows a create or convert collects, Branches evaluated on the
 * answers, and Required enforced on the visible set only, for Contracts,
 * Matters and Entities alike. */
import { regions, sql, type Executor } from "@openlaw/db";
import {
  evaluateForm,
  formForTouchpoint,
  formRowsForTouchpoint,
  type FormAnswers,
  type FormModule,
} from "@openlaw/shared";
import type { AttachedCustomField } from "./custom-fields.js";
import { readTypeForm } from "./type-form-routes.js";
import { httpError } from "./problem.js";

const labels: Record<string, string> = {
  title: "Title",
  contract_type: "Contract type",
  matter_type: "Matter type",
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
  value: "Value",
  needed_by: "Needed by",
};
export async function assertCreationForm(
  db: Executor,
  module: FormModule,
  typeId: string,
  fields: readonly AttachedCustomField[],
  answers: FormAnswers,
): Promise<void> {
  if (module !== "entity" && typeof answers.region === "string") {
    const [region] = await db
      .select({ id: regions.id })
      .from(regions)
      .where(sql`lower(${regions.displayName}) = lower(${answers.region})`);
    if (region) answers = { ...answers, region: region.id };
  }
  const required = formRowsForTouchpoint(
    evaluateForm(formForTouchpoint(await readTypeForm(db, module, typeId), "creation"), answers)
      .enforcedRequiredRows,
    "creation",
  );
  const missing = required.filter((row) => {
    const value = answers[row.rowRef];
    return (
      value == null ||
      (typeof value === "string" && !value.trim()) ||
      (Array.isArray(value) && !value.length)
    );
  });
  if (missing.length)
    throw httpError(
      400,
      `Fill ${missing.map((row) => fields.find((f) => f.slug === row.rowRef)?.displayName ?? labels[row.rowRef] ?? row.rowRef).join(", ")}.`,
    );
}
