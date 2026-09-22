// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DD-028 built-in Row keys and pinned Rows shared by type Form readers and writers.
 */

import type { FormRow, FormRowType } from "./form-evaluator.js";

/** DD-028 built-in identities shared by Forms, analysis and Auto-Docs. */
export const BUILTIN_KEYS = {
  title: "title",
  contract_type: "contract_type",
  matter_type: "matter_type",
  description: "description",
  entity: "entity",
  counterparties: "counterparties",
  owning_department: "owning_department",
  department: "department",
  region: "region",
  priority: "priority",
  risk: "risk",
  term_type: "term_type",
  effective_date: "effective_date",
  expiry_date: "expiry_date",
  renewal_period_months: "renewal_period_months",
  notice_period_days: "notice_period_days",
  value: "value",
  needed_by: "needed_by",
} as const;

/** Value remains one compound money Row. */
export const FORM_BUILTINS = {
  contract: {
    [BUILTIN_KEYS.description]: "long_text",
    [BUILTIN_KEYS.entity]: "entity",
    [BUILTIN_KEYS.counterparties]: "multi_select",
    [BUILTIN_KEYS.owning_department]: "single_select",
    [BUILTIN_KEYS.region]: "single_select",
    [BUILTIN_KEYS.priority]: "single_select",
    [BUILTIN_KEYS.risk]: "single_select",
    [BUILTIN_KEYS.term_type]: "single_select",
    [BUILTIN_KEYS.effective_date]: "date",
    [BUILTIN_KEYS.expiry_date]: "date",
    [BUILTIN_KEYS.renewal_period_months]: "number",
    [BUILTIN_KEYS.notice_period_days]: "number",
    [BUILTIN_KEYS.value]: "money",
    [BUILTIN_KEYS.needed_by]: "date",
  },
  matter: {
    [BUILTIN_KEYS.description]: "long_text",
    [BUILTIN_KEYS.department]: "single_select",
    [BUILTIN_KEYS.region]: "single_select",
    [BUILTIN_KEYS.priority]: "single_select",
    [BUILTIN_KEYS.risk]: "single_select",
    [BUILTIN_KEYS.needed_by]: "date",
  },
  entity: {},
} as const satisfies Record<string, Record<string, FormRowType>>;
export type FormModule = keyof typeof FORM_BUILTINS;

/** Entity built-ins remain on its existing create form (DD-028.10). */
export function pinnedFormRows(module: FormModule): FormRow[] {
  if (module === "entity") return [];
  return [
    BUILTIN_KEYS.title,
    module === "contract" ? BUILTIN_KEYS.contract_type : BUILTIN_KEYS.matter_type,
  ].map((key, index) => ({
    kind: "row",
    id: key,
    rowRef: key,
    fieldType: index === 0 ? "text" : "single_select",
    onIntakeForm: false,
    isRequired: true,
    visibleOnPortal: true,
  }));
}

export const AUTO_DOC_CONTRACT_ATTRIBUTES = [
  BUILTIN_KEYS.title,
  BUILTIN_KEYS.counterparties,
  BUILTIN_KEYS.entity,
  BUILTIN_KEYS.owning_department,
  BUILTIN_KEYS.region,
  BUILTIN_KEYS.value,
  BUILTIN_KEYS.effective_date,
  BUILTIN_KEYS.expiry_date,
  BUILTIN_KEYS.term_type,
] as const;
