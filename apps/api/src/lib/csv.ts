// SPDX-License-Identifier: AGPL-3.0-only

/**
 * One CSV field, quoted per RFC 4180 and defused for a spreadsheet.
 *
 * Everything is quoted, and an embedded quote is doubled. A value
 * opening with `=`, `+`, `-`, `@`, a tab, or a carriage return is
 * prefixed with an apostrophe: these files are opened in spreadsheets,
 * and a name of `=1+1` is a formula there. The apostrophe is visible in
 * the cell text, which is the honest trade: an export must not execute,
 * and it must not silently drop what it could not carry.
 */
export function csvField(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const defused = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${defused.replaceAll('"', '""')}"`;
}

export function csvRow(values: readonly unknown[]): string {
  return `${values.map(csvField).join(",")}\r\n`;
}
