// SPDX-License-Identifier: AGPL-3.0-only

/** DD-028 tree operations and display names for Rows and Branches. */
import {
  FORM_BUILTINS,
  type Form,
  type FormBranch,
  type FormNode,
  type FormRow,
  type FormModule,
  type FormOperator,
} from "@openlaw/shared";
import type { FormMessageKey, FormText } from "./messages";
import { formatCount } from "../../lib/format";
import type { ApiField } from "../../lib/field-catalog";

export const OPERATORS: Record<FormOperator, FormMessageKey> = {
  equals: "is",
  is_not: "is not",
  is_one_of: "is one of",
  is_set: "is set",
  greater_than: "is greater than",
  less_than: "is less than",
};
const LABELS: Record<string, FormMessageKey> = {
  title: "Title",
  contract_type: "Type",
  matter_type: "Type",
  description: "Description",
  entity: "Entity",
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
export function rowName(row: FormRow, catalog: readonly ApiField[], t: FormText = (text) => text) {
  const label = LABELS[row.rowRef];
  return catalog.find((f) => f.id === row.id)?.displayName ?? (label ? t(label) : row.rowRef);
}
export function isPinned(node: FormNode) {
  return node.kind === "row" && ["title", "contract_type", "matter_type"].includes(node.rowRef);
}
export function isBuiltin(row: FormRow, module: FormModule) {
  return isPinned(row) || Object.hasOwn(FORM_BUILTINS[module], row.rowRef);
}
export function flatten(form: Form): FormNode[] {
  return form.flatMap((n) => (n.kind === "row" ? [n] : [n, ...flatten(n.children)]));
}
export function replaceNode(form: Form, id: string, replacement: Form): Form {
  return form.flatMap((n) =>
    n.id === id
      ? replacement
      : [n.kind === "branch" ? { ...n, children: replaceNode(n.children, id, replacement) } : n],
  );
}
export function appendNode(form: Form, parent: string | null, node: FormNode): Form {
  return parent === null
    ? [...form, node]
    : form.map((n) =>
        n.kind === "branch"
          ? {
              ...n,
              children:
                n.id === parent ? [...n.children, node] : appendNode(n.children, parent, node),
            }
          : n,
      );
}
export function location(
  form: Form,
  id: string,
  parent: FormBranch | null = null,
): { siblings: Form; parent: FormBranch | null; index: number } | undefined {
  for (const [index, node] of form.entries()) {
    if (node.id === id) return { siblings: form, parent, index };
    if (node.kind === "branch") {
      const found = location(node.children, id, node);
      if (found) return found;
    }
  }
}
export function optionsFor(
  row: FormRow,
  catalog: readonly ApiField[],
  t: FormText = (text) => text,
): { value: string; label: string }[] {
  const field = catalog.find((f) => f.id === row.id);
  if (field) return (field.options ?? []).map((value) => ({ value, label: value }));
  const values: Record<string, string[]> = {
    term_type: ["fixed", "auto_renew", "evergreen"],
    priority: ["low", "medium", "high", "critical"],
    risk: ["low", "medium", "high", "critical"],
  };
  const labels: Record<string, FormMessageKey> = {
    fixed: "Fixed",
    auto_renew: "Auto-renew",
    evergreen: "Evergreen",
    low: "Low",
    medium: "Medium",
    high: "High",
    critical: "Critical",
  };
  return (values[row.rowRef] ?? []).map((value) => ({
    value,
    label: t(labels[value]!),
  }));
}
export function branchName(
  branch: FormBranch,
  form: Form,
  catalog: readonly ApiField[],
  t: FormText = (text) => text,
  referenceLabels: Record<string, { value: string; label: string }[]> = {},
) {
  const rows = flatten(form).filter((n): n is FormRow => n.kind === "row");
  if (!branch.conditions.length || branch.conditions.some((c) => !c.rowRef))
    return t("Add a condition");
  return (
    (branch.match === "all" ? t("Show when all of:") : t("Show when any of:")) +
    " " +
    branch.conditions
      .map((c) => {
        const row = rows.find((r) => r.rowRef === c.rowRef);
        const value = (v: unknown) => {
          if (!row) return String(v);
          const option = (referenceLabels[row.rowRef] ?? optionsFor(row, catalog, t)).find(
            (o) => o.value === v,
          );
          if (option) return option.label;
          if (row.fieldType === "boolean") return t(v === true ? "Yes" : "No");
          if (row.fieldType === "money" && typeof v === "number")
            return t("{amount} minor units", { amount: formatCount(v) });
          if (
            ["user", "entity"].includes(row.fieldType) ||
            [
              "counterparties",
              "department",
              "owning_department",
              "region",
              "contract_type",
              "matter_type",
            ].includes(row.rowRef)
          )
            return t("Unavailable value");
          return String(v);
        };
        return `${row ? rowName(row, catalog, t) : c.rowRef} ${t(OPERATORS[c.operator])}${c.operator === "is_set" ? "" : ` ${Array.isArray(c.value) ? c.value.map(value).join(", ") : value(c.value ?? "")}`}`;
      })
      .join(", ")
  );
}

export function fieldTypeName(type: FormRow["fieldType"], t: FormText) {
  const labels: Record<FormRow["fieldType"], FormMessageKey> = {
    text: "Text",
    long_text: "Long text",
    number: "Number",
    date: "Date",
    boolean: "Boolean",
    single_select: "Single select",
    multi_select: "Multi select",
    user: "User",
    entity: "Entity",
    currency: "Currency",
    money: "Money",
  };
  return t(labels[type]);
}
