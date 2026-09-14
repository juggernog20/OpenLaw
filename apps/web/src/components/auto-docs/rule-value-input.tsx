// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-004 and ADO-006: Clause and Assignment rules share typed values and missing-option cues. */
import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "../../lib/form-controls";
import type { AutoDocClauseRule, AutoDocField } from "../../lib/auto-docs";

export function defaultRuleValue(
  operator: AutoDocClauseRule["operator"],
  field?: AutoDocField,
): AutoDocClauseRule["value"] {
  const value =
    field?.fieldType === "boolean"
      ? true
      : field?.fieldType === "number" || field?.fieldType === "currency"
        ? 0
        : (field?.options?.[0] ?? "");
  return operator === "is_set" ? null : operator === "is_one_of" ? [value] : value;
}

export function RuleValueInput({
  field,
  fieldSlug,
  operator,
  value,
  onChange,
}: {
  field: AutoDocField | undefined;
  fieldSlug: string;
  operator: AutoDocClauseRule["operator"];
  value: AutoDocClauseRule["value"];
  onChange: (value: AutoDocClauseRule["value"]) => void;
}) {
  const intl = useIntl();
  if (operator === "is_set") return null;
  const choices = field?.options ?? (field?.fieldType === "boolean" ? ["true", "false"] : null);
  const multiple = operator === "is_one_of";
  const scalar = (text: string) => (field?.fieldType === "boolean" ? text === "true" : text);
  const stored = Array.isArray(value) ? value.map(String) : value === null ? [] : [String(value)];
  return (
    <label className="block space-y-1">
      <span>
        <FormattedMessage id="autoDocs.ruleValue" defaultMessage="Value" />
      </span>
      {choices ? (
        <select
          className={CONTROL_CLASS}
          required
          multiple={multiple}
          value={multiple ? (Array.isArray(value) ? value.map(String) : []) : String(value ?? "")}
          onChange={(event) =>
            onChange(
              multiple
                ? Array.from(event.target.selectedOptions, (option) => scalar(option.value))
                : scalar(event.target.value),
            )
          }
        >
          {[...new Set([...choices, ...stored])].map((option) => (
            <option key={option} value={option}>
              {choices.includes(option)
                ? field?.fieldType === "boolean"
                  ? option === "true"
                    ? intl.formatMessage({ id: "common.yes", defaultMessage: "Yes" })
                    : intl.formatMessage({ id: "common.no", defaultMessage: "No" })
                  : option
                : intl.formatMessage(
                    { id: "autoDocs.missingRuleOption", defaultMessage: "{value} (missing)" },
                    { value: option },
                  )}
            </option>
          ))}
        </select>
      ) : (
        <RuleTextValue
          key={`${fieldSlug}:${field?.fieldType}:${operator}`}
          value={value}
          multiple={multiple}
          fieldType={field?.fieldType}
          onChange={onChange}
        />
      )}
    </label>
  );
}

function RuleTextValue({
  value,
  multiple,
  fieldType,
  onChange,
}: {
  value: AutoDocClauseRule["value"];
  multiple: boolean;
  fieldType: AutoDocField["fieldType"] | undefined;
  onChange: (value: AutoDocClauseRule["value"]) => void;
}) {
  const intl = useIntl();
  const [text, setText] = useState(Array.isArray(value) ? value.join("\n") : String(value ?? ""));
  const [sourceValue, setSourceValue] = useState(value);
  if (value !== sourceValue) {
    setSourceValue(value);
    setText(Array.isArray(value) ? value.join("\n") : String(value ?? ""));
  }
  const scalar = (value: string) =>
    fieldType === "number" || fieldType === "currency" ? Number(value) : value;
  function edit(value: string) {
    setText(value);
    const next = multiple
      ? value
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map(scalar)
      : scalar(value);
    setSourceValue(next);
    onChange(next);
  }
  const values = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const invalid =
    !values.length ||
    ((fieldType === "number" || fieldType === "currency") &&
      values.some((value) => !Number.isFinite(Number(value))));
  return multiple ? (
    <textarea
      ref={(element) => {
        element?.setCustomValidity(
          invalid
            ? intl.formatMessage({
                id: "autoDocs.ruleListRefused",
                defaultMessage:
                  "Enter one value per line, using numbers for a number or currency field.",
              })
            : "",
        );
      }}
      required
      className={TEXTAREA_CLASS}
      value={text}
      onChange={(event) => edit(event.target.value)}
    />
  ) : (
    <input
      required
      type={
        fieldType === "number" || fieldType === "currency"
          ? "number"
          : fieldType === "date"
            ? "date"
            : "text"
      }
      step="any"
      className={CONTROL_CLASS}
      value={text}
      onChange={(event) => edit(event.target.value)}
    />
  );
}
