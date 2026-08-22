// SPDX-License-Identifier: AGPL-3.0-only

/**
 * One collected value on a Request, drawn the way its field type reads
 * (INT-002, the INT-001 M20/10 rules).
 *
 * It is here rather than inside the staff detail because two surfaces
 * draw the same values: the detail's Form responses card, and the
 * Convert dialog's list of what carries into the contract (#420). Those
 * sit on one screen at one moment, so a second formatter would let one
 * value read two ways a dialog apart.
 *
 * The two types that name a row are resolved by the API — a bare id is
 * not a value anybody can read — and an id that resolves to nothing
 * falls back to the id, because a Request that holds one must go on
 * showing that it holds something.
 */

import { defineMessage, useIntl, type IntlShape } from "react-intl";
import type { CustomFieldValue } from "../../lib/custom-fields";
import { formatFullDate } from "../../lib/format";
import type { StaffRequestField, StaffRequestFieldRefs } from "../../lib/requests";

const BOOLEAN_VALUE = defineMessage({
  id: "inbox.request.booleanValue",
  defaultMessage: "{value, select, true {Yes} other {No}}",
});

/**
 * The value as a node, so `long_text` keeps the line breaks its author
 * typed and every other type stays plain text.
 */
export function CustomFieldValueText({
  field,
  value,
  refs,
}: Readonly<{
  field: StaffRequestField;
  value: CustomFieldValue;
  refs: StaffRequestFieldRefs;
}>) {
  const intl = useIntl();
  if (field.fieldType === "long_text") {
    return <span className="whitespace-pre-line">{String(value)}</span>;
  }
  return <>{customFieldValueText(intl, field, value, refs)}</>;
}

/** The same reading as a plain string, for the places that put a value
 * beside a label in one line rather than in its own block. */
export function customFieldValueText(
  intl: IntlShape,
  field: StaffRequestField,
  value: CustomFieldValue,
  refs: StaffRequestFieldRefs,
): string {
  switch (field.fieldType) {
    case "number":
      return typeof value === "number" ? intl.formatNumber(value) : String(value);
    case "date":
      return typeof value === "string" ? formatFullDate(value) : String(value);
    case "boolean":
      return intl.formatMessage(BOOLEAN_VALUE, { value: String(value === true) });
    case "multi_select":
      return Array.isArray(value) ? intl.formatList(value, { type: "conjunction" }) : String(value);
    case "user":
      return refs.users.find((person) => person.id === value)?.displayName ?? String(value);
    case "entity":
      return refs.entities.find((row) => row.id === value)?.legalName ?? String(value);
    default:
      return String(value);
  }
}
