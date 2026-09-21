// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DD-028 built-in Row keys and pinned Rows shared by type Form readers and writers.
 */

import type { FormRow, FormRowType } from "./form-evaluator.js";

/** DD-028's canonical built-in keys. Value remains one compound money Row. */
export const FORM_BUILTINS = {
  contract: {
    description: "long_text",
    entity: "entity",
    counterparties: "multi_select",
    owning_department: "single_select",
    region: "single_select",
    priority: "single_select",
    risk: "single_select",
    term_type: "single_select",
    effective_date: "date",
    expiry_date: "date",
    renewal_period_months: "number",
    notice_period_days: "number",
    value: "money",
    needed_by: "date",
  },
  matter: {
    description: "long_text",
    department: "single_select",
    region: "single_select",
    priority: "single_select",
    risk: "single_select",
    needed_by: "date",
  },
  entity: {},
} as const satisfies Record<string, Record<string, FormRowType>>;
export type FormModule = keyof typeof FORM_BUILTINS;

/** Entity built-ins remain on its existing create form (DD-028.10). */
export function pinnedFormRows(module: FormModule): FormRow[] {
  if (module === "entity") return [];
  return ["title", `${module}_type`].map((key, index) => ({
    kind: "row",
    id: key,
    rowRef: key,
    fieldType: index === 0 ? "text" : "single_select",
    onIntakeForm: false,
    isRequired: true,
    visibleOnPortal: true,
  }));
}
