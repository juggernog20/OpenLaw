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

import {
  defineMessage,
  FormattedMessage,
  useIntl,
  type IntlShape,
  type MessageDescriptor,
} from "react-intl";
import type { CustomFieldValue } from "../../lib/custom-fields";
import { formatFullDate, formatCurrency } from "../../lib/format";
import type { StaffRequestField, StaffRequestFieldRefs } from "../../lib/requests";

const BOOLEAN_VALUE: MessageDescriptor = defineMessage({
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
  answers = {},
}: Readonly<{
  field: StaffRequestField;
  value: CustomFieldValue;
  refs: StaffRequestFieldRefs;
  answers?: Readonly<Record<string, CustomFieldValue>>;
}>) {
  const intl = useIntl();
  if (field.fieldType === "long_text") {
    return <span className="whitespace-pre-line">{String(value)}</span>;
  }
  const text = customFieldValueText(intl, field, value, refs, answers);
  if (!isArchivedCustomFieldReference(field, value, refs)) return <>{text}</>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span>{text}</span>
      <span className="inline-flex rounded-pill bg-status-neutral-bg px-2 py-0.5 text-xs font-medium text-status-neutral-fg">
        <FormattedMessage id="inbox.request.archivedReference" defaultMessage="Archived" />
      </span>
    </span>
  );
}

/** Whether a carried reference names a row that the staff read reports
 * as archived. A missing row is left to the raw-id fallback: #437 is
 * the archived-row repair and does not invent a state for hard delete. */
export function isArchivedCustomFieldReference(
  field: StaffRequestField,
  value: CustomFieldValue,
  refs: StaffRequestFieldRefs,
): boolean {
  if (field.fieldType === "user") {
    return refs.users.find((person) => person.id === value)?.archived === true;
  }
  if (field.fieldType === "entity") {
    const entity = refs.entities.find((row) => row.id === value);
    return entity?.restricted === false && entity.archived;
  }
  return false;
}

/** The same reading as a plain string, for the places that put a value
 * beside a label in one line rather than in its own block. */
export function customFieldValueText(
  intl: IntlShape,
  field: StaffRequestField,
  value: CustomFieldValue,
  refs: StaffRequestFieldRefs,
  answers: Readonly<Record<string, CustomFieldValue>> = {},
): string {
  if (
    field.builtInKey === "value_amount" &&
    typeof value === "number" &&
    typeof answers.value_currency === "string"
  ) {
    return formatCurrency(
      { amount: value, currency: answers.value_currency },
      { locale: intl.locale },
    );
  }
  if (
    ["counterparties", "owning_department", "department", "region"].includes(
      field.builtInKey ?? "",
    ) &&
    typeof value === "string" &&
    refs.builtins?.[value]
  )
    return refs.builtins[value];
  switch (field.fieldType) {
    case "number":
      return typeof value === "number" ? intl.formatNumber(value) : String(value);
    case "date":
      return typeof value === "string" ? formatFullDate(value) : String(value);
    case "boolean":
      return intl.formatMessage(BOOLEAN_VALUE, { value: String(value === true) });
    case "multi_select":
      return Array.isArray(value)
        ? intl.formatList(
            value.map((v) =>
              ["counterparties", "owning_department", "department", "region"].includes(
                field.builtInKey ?? "",
              )
                ? (refs.builtins?.[v] ?? v)
                : v,
            ),
            { type: "conjunction" },
          )
        : String(value);
    case "user":
      return refs.users.find((person) => person.id === value)?.displayName ?? String(value);
    case "entity": {
      const entity = refs.entities.find((row) => row.id === value);
      return entity?.restricted
        ? intl.formatMessage({ id: "entities.restricted", defaultMessage: "Restricted Entity" })
        : (entity?.legalName ?? String(value));
    }
    default:
      return String(value);
  }
}
