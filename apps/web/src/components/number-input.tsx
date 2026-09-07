// SPDX-License-Identifier: AGPL-3.0-only

import { useState, type ComponentPropsWithoutRef } from "react";
import { useIntl } from "react-intl";
import { Input } from "./ui/input";

/** Group saved numbers; keep an unformatted draft while editing to preserve the caret. */
export function NumberInput({
  value,
  onValueChange,
  onFocus,
  onBlur,
  ...props
}: Omit<ComponentPropsWithoutRef<"input">, "value" | "onChange" | "type"> & {
  value: string;
  onValueChange: (value: string) => void;
}) {
  const intl = useIntl();
  const [focused, setFocused] = useState(false);
  const parts = intl.formatNumberToParts(12345.6);
  const group = parts.find((part) => part.type === "group")?.value;
  const decimal = parts.find((part) => part.type === "decimal")?.value ?? ".";
  const number = Number(value);
  const display =
    !focused && value.trim() !== "" && Number.isFinite(number)
      ? intl.formatNumber(number, { maximumFractionDigits: 20 })
      : value.replace(".", decimal);
  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      value={display}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      onChange={(event) => {
        const typed = group ? event.target.value.split(group).join("") : event.target.value;
        onValueChange(typed.replace(decimal, "."));
      }}
    />
  );
}
