// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The custom-field vocabulary the contract surfaces share (CTR-016):
 * what one attached field looks like, what a stored value looks like,
 * and the two conversions between a stored value and what a control
 * holds while someone is typing into it.
 *
 * The draft is a separate shape on purpose. A number box holds a
 * half-typed string that is not yet a number, and an empty box is a
 * state no number can carry; a date box holds "" while it is empty. So
 * every control drives a draft, and the draft becomes a value — or
 * `null`, which clears the field — only at the moment of commit.
 */

import type { paths } from "@openlaw/api-client";

type RecordResponse =
  paths["/api/v1/contracts/{number}"]["get"]["responses"]["200"]["content"]["application/json"];

/**
 * One field the contract's type attaches, as the record renders it: the
 * catalog's definition plus the attachment's order and required flag.
 * The API answers them in attachment order, so surfaces render the
 * order they are given.
 */
export type AttachedField = RecordResponse["fields"][number];
export type CustomFieldType = AttachedField["fieldType"];

/** The stored values, keyed by the field's slug. An absent key is the
 * only empty: nothing is ever stored as null. */
export type CustomFieldValues = RecordResponse["contract"]["customFields"];
export type CustomFieldValue = CustomFieldValues[string];

/**
 * The people and Entities the stored values name. The pickers offer
 * live rows only, so a person archived after being picked would fall
 * out of the option lists — these are the rows the record actually
 * holds, and merging them in is what stops a control from showing a
 * bare id where it should show a name.
 */
export type CustomFieldRefs = RecordResponse["customFieldRefs"];

/** What a control holds between commits. `string` covers the seven
 * scalar-ish types, `boolean` the toggle, `string[]` the multi-select. */
export type CustomFieldDraft = string | boolean | string[];

/** The empty draft for a field, by type — what an unanswered control
 * shows. */
export function emptyDraft(field: AttachedField): CustomFieldDraft {
  if (field.fieldType === "boolean") return false;
  if (field.fieldType === "multi_select") return [];
  return "";
}

/** The stored value as its control holds it. */
export function toDraft(
  field: AttachedField,
  value: CustomFieldValue | undefined,
): CustomFieldDraft {
  if (value === undefined) return emptyDraft(field);
  if (field.fieldType === "boolean") return value === true;
  if (field.fieldType === "multi_select") return Array.isArray(value) ? value : [];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/**
 * The draft as the value to commit, or `null` to clear the field. A
 * number that is not a number is refused here rather than sent, so the
 * form answers a mistake it can see for itself — the same guard an
 * empty title already gets. The seam refuses it too.
 */
export function toValue(
  field: AttachedField,
  draft: CustomFieldDraft,
): { value: CustomFieldValue | null } | { error: "number" } {
  if (field.fieldType === "boolean") return { value: draft === true };
  if (field.fieldType === "multi_select") {
    const chosen = Array.isArray(draft) ? draft : [];
    return { value: chosen.length === 0 ? null : chosen };
  }
  const text = typeof draft === "string" ? draft.trim() : "";
  if (text === "") return { value: null };
  if (field.fieldType === "number") {
    const parsed = Number(text);
    return Number.isFinite(parsed) ? { value: parsed } : { error: "number" };
  }
  return { value: text };
}

/** Whether two drafts read the same — what decides that a blur commits
 * nothing (DES-017). */
export function sameDraft(left: CustomFieldDraft, right: CustomFieldDraft): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item) => right.includes(item));
  }
  return left === right;
}

/** Whether a value counts as recorded — the client half of MTR-014's
 * hard-required rule, mirroring the seam's own test. */
export function isAnswered(value: CustomFieldValue | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** The fields a type demands that the values do not yet answer — what
 * the create dialog collects and what the re-type dialog prompts for. */
export function unansweredRequired(
  fields: readonly AttachedField[],
  values: CustomFieldValues,
): AttachedField[] {
  return fields.filter((field) => field.isRequired && !isAnswered(values[field.slug]));
}

/**
 * A field's control commits the moment it changes (a toggle, a select,
 * a checkbox group) rather than on blur. The split is the one the
 * record already draws between its selects and its text boxes: picking
 * is a decision, typing is a draft.
 */
export function commitsOnChange(field: AttachedField): boolean {
  return (
    field.fieldType === "boolean" ||
    field.fieldType === "single_select" ||
    field.fieldType === "multi_select" ||
    field.fieldType === "user" ||
    field.fieldType === "entity"
  );
}
