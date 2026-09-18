// SPDX-License-Identifier: AGPL-3.0-only

export const INTAKE_BASIC_FIELD_KEYS = [
  "basic:title",
  "basic:description",
  "basic:attachments",
  "basic:department",
  "basic:urgency",
] as const;

/** Keep saved positions, ignore removed fields, and append newly attached fields. */
export function resolveIntakeFieldOrder(
  fieldIds: readonly string[],
  saved: readonly string[] = [],
) {
  const available = [...INTAKE_BASIC_FIELD_KEYS, ...fieldIds];
  const allowed = new Set<string>(available);
  return [...new Set([...saved.filter((key) => allowed.has(key)), ...available])];
}
