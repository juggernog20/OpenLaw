// SPDX-License-Identifier: AGPL-3.0-only

/** SET-010 picker with live choices and a disabled label for an archived current Department. */

import { useIntl } from "react-intl";
import { CONTROL_CLASS } from "../lib/form-controls";

export function DepartmentPicker({
  id,
  label,
  value,
  currentName,
  options,
  disabled,
  onChange,
}: Readonly<{
  id?: string;
  label?: string;
  value: string | null;
  currentName?: string | null;
  options: readonly { id: string; displayName: string }[];
  disabled?: boolean;
  onChange: (value: string | null) => void;
}>) {
  const intl = useIntl();
  return (
    <select
      id={id}
      aria-label={label}
      className={CONTROL_CLASS}
      disabled={disabled}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">
        {intl.formatMessage({ id: "departments.none", defaultMessage: "No Department" })}
      </option>
      {value && !options.some((option) => option.id === value) && (
        <option value={value} disabled>
          {intl.formatMessage(
            { id: "departments.archived", defaultMessage: "{name} (archived)" },
            { name: currentName ?? value },
          )}
        </option>
      )}
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.displayName}
        </option>
      ))}
    </select>
  );
}
