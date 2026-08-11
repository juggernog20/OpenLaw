// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reading submitted form fields. `FormData.get` answers `string | File`,
 * so a plain `String(...)` cast would send a File on as the literal text
 * "[object File]". Every field these forms submit is a text control, so a
 * non-string value means the form is not the one the handler expects —
 * read it as absent and let the API's own validation refuse it.
 */

/** The named field as text; "" when absent or not a text value. */
export function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
