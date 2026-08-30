// SPDX-License-Identifier: AGPL-3.0-only

/**
 * One control per custom-field type (CTR-016's nine), shared by the
 * three surfaces that render a field: the record's Fields card, the
 * create dialog, and the re-type dialog. It is fully controlled — it
 * holds a draft and reports every change — so the surface above it
 * decides when a draft becomes a commit. That is what lets the record
 * commit per field on blur (DES-017) while a dialog collects several
 * and confirms once.
 *
 * The two types that name a row reuse the pickers the record already
 * has rather than growing new ones: `user` is the Owner select's list,
 * `entity` is the signing-entity select's list, both offering live rows
 * plus whatever the record already holds — an archived person or Entity
 * stays selectable as themselves, or the select would lie about what
 * the contract says.
 */

import { FormattedMessage, useIntl } from "react-intl";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "../lib/form-controls";
import type { AttachedField, CustomFieldDraft } from "../lib/custom-fields";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import { RestrictedRecordCell } from "./restricted-record-cell";

export interface FieldReference {
  id: string;
  label: string;
  /** SET-005: an archived person renders greyed but stays selectable. */
  archived?: boolean;
  restricted?: boolean;
}

export interface CustomFieldControlProps {
  id: string;
  field: AttachedField;
  draft: CustomFieldDraft;
  disabled?: boolean;
  people?: readonly FieldReference[];
  entities?: readonly FieldReference[];
  /** The id of the field's help text, when it has any — every control
   * carries it, so the description is announced with the control rather
   * than left as text beside it. */
  describedBy?: string;
  /** The attachment's required flag (MTR-014, INT-002), announced on
   * the control itself. A surface that draws the asterisk in the label
   * has told a sighted reader; this tells everybody else. */
  required?: boolean;
  /** This control is the one a refusal named. Surfaces that mark the
   * offending boxes set it; the ones that only print a sentence do
   * not. */
  invalid?: boolean;
  onDraft: (draft: CustomFieldDraft) => void;
  onBlur?: (event: React.FocusEvent<HTMLElement>) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void;
}

export function CustomFieldControl({
  id,
  field,
  draft,
  disabled = false,
  people = [],
  entities = [],
  describedBy,
  required = false,
  invalid = false,
  onDraft,
  onBlur,
  onKeyDown,
}: Readonly<CustomFieldControlProps>) {
  const intl = useIntl();
  const text = typeof draft === "string" ? draft : "";
  const chosen = Array.isArray(draft) ? draft : [];
  const shared = {
    id,
    disabled,
    "aria-describedby": describedBy,
    "aria-required": required || undefined,
    "aria-invalid": invalid || undefined,
  };

  switch (field.fieldType) {
    case "long_text":
      return (
        <textarea
          {...shared}
          value={text}
          className={TEXTAREA_CLASS}
          onChange={(event) => onDraft(event.target.value)}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
        />
      );
    case "number":
      return (
        <Input
          {...shared}
          type="number"
          inputMode="decimal"
          value={text}
          onChange={(event) => onDraft(event.target.value)}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
        />
      );
    case "date":
      return (
        <Input
          {...shared}
          type="date"
          value={text}
          onChange={(event) => onDraft(event.target.value)}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
        />
      );
    case "boolean":
      return (
        <Switch {...shared} checked={draft === true} onCheckedChange={(next) => onDraft(next)} />
      );
    case "single_select":
      return (
        <select
          {...shared}
          value={text}
          className={CONTROL_CLASS}
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={onKeyDown}
        >
          {/* Empty is a real answer on an optional field, and the only
              way to clear one; the seam refuses it on a required one. */}
          <option value="">
            {intl.formatMessage({
              id: "contracts.field.selectPlaceholder",
              defaultMessage: "Not set",
            })}
          </option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    case "multi_select":
      return (
        // A checkbox group, not a multi-select listbox: a native
        // multiple select hides its selection behind a scroll and
        // needs a modifier key to add one, and DES-004 offers no
        // combobox for it. A group takes its name from the surface's
        // label by reference — `for` can only name one control, and
        // this is several.
        <div
          id={id}
          aria-describedby={describedBy}
          // No `aria-required` or `aria-invalid` here: neither is
          // allowed on `group`. The group's demand is carried by the
          // label the surface draws the asterisk into, and a refusal
          // is carried by the checkboxes below — `checkbox` is a role
          // `aria-invalid` is allowed on.
          role="group"
          aria-labelledby={`${id}-label`}
          className="flex flex-wrap gap-x-4 gap-y-2"
          onBlur={onBlur}
          onKeyDown={onKeyDown}
        >
          {(field.options ?? []).map((option) => (
            <label key={option} className="flex items-center gap-2 text-md">
              <Checkbox
                checked={chosen.includes(option)}
                disabled={disabled}
                aria-invalid={invalid || undefined}
                onCheckedChange={(next) =>
                  onDraft(
                    next === true
                      ? [...chosen, option]
                      : chosen.filter((picked) => picked !== option),
                  )
                }
              />
              {option}
            </label>
          ))}
          {(field.options ?? []).length === 0 && (
            <p className="text-base text-muted">
              <FormattedMessage
                id="contracts.field.noOptions"
                defaultMessage="This field has no options yet."
              />
            </p>
          )}
        </div>
      );
    case "user":
    case "entity":
      if (
        field.fieldType === "entity" &&
        entities.some((row) => row.id === text && row.restricted)
      ) {
        return (
          <RestrictedRecordCell
            label={{ id: "entities.restricted", defaultMessage: "Restricted Entity" }}
          />
        );
      }
      return (
        <select
          {...shared}
          value={text}
          className={CONTROL_CLASS}
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={onKeyDown}
        >
          <option value="">
            {intl.formatMessage({
              id: "contracts.field.selectPlaceholder",
              defaultMessage: "Not set",
            })}
          </option>
          {(field.fieldType === "user" ? people : entities).map((row) => (
            <option key={row.id} value={row.id}>
              {row.label}
            </option>
          ))}
        </select>
      );
    case "text":
      return (
        <Input
          {...shared}
          value={text}
          onChange={(event) => onDraft(event.target.value)}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
        />
      );
    default: {
      const exhaustiveCheck: never = field.fieldType;
      throw new Error(`Unhandled field type: ${exhaustiveCheck}`);
    }
  }
}
