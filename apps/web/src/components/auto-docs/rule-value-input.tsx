// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-004 and ADO-006: Clause and Assignment rules share typed values and missing-option cues. */
import { AutoResizeTextarea } from "../auto-resize-textarea";
import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "../ui/button";
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
  if (
    multiple &&
    (field?.fieldType === "date" ||
      field?.fieldType === "number" ||
      field?.fieldType === "currency")
  ) {
    return (
      <RuleTypedList
        key={`${fieldSlug}:${field.fieldType}`}
        value={value}
        fieldType={field.fieldType}
        onChange={onChange}
      />
    );
  }
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
    <AutoResizeTextarea
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

function RuleTypedList({
  value,
  fieldType,
  onChange,
}: {
  value: AutoDocClauseRule["value"];
  fieldType: "date" | "number" | "currency";
  onChange: (value: AutoDocClauseRule["value"]) => void;
}) {
  const intl = useIntl();
  const asRows = (value: AutoDocClauseRule["value"]) =>
    Array.isArray(value) && value.length ? value.map(String) : [String(value ?? "")];
  const [rows, setRows] = useState(() => asRows(value));
  const [source, setSource] = useState(value);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const focusIndex = useRef<number | null>(null);
  if (source !== value) {
    setSource(value);
    setRows(asRows(value));
  }
  useEffect(() => {
    if (focusIndex.current !== null) {
      inputs.current[focusIndex.current]?.focus();
      focusIndex.current = null;
    }
  }, [rows.length]);
  function change(next: string[]) {
    setRows(next);
    const values = next.map((text) =>
      fieldType !== "date" && text.trim() !== "" && Number.isFinite(Number(text))
        ? Number(text)
        : text,
    );
    setSource(values);
    onChange(values);
  }
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-1">
        <FormattedMessage id="autoDocs.ruleValues" defaultMessage="Values" />
      </legend>
      {rows.map((text, index) => (
        <div key={index} className="flex items-center gap-2">
          <input
            ref={(input) => {
              inputs.current[index] = input;
            }}
            type={fieldType === "date" ? "date" : "number"}
            step="any"
            required
            aria-label={intl.formatMessage(
              { id: "autoDocs.ruleValueNumber", defaultMessage: "Value {number}" },
              { number: index + 1 },
            )}
            className={CONTROL_CLASS}
            value={text}
            onChange={(event) =>
              change(rows.map((row, at) => (at === index ? event.target.value : row)))
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0"
            disabled={rows.length === 1}
            aria-label={intl.formatMessage(
              { id: "autoDocs.ruleRemoveValue", defaultMessage: "Remove value {number}" },
              { number: index + 1 },
            )}
            onClick={() => {
              focusIndex.current = Math.min(index, rows.length - 2);
              change(rows.filter((_, at) => at !== index));
            }}
          >
            <X size={16} aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="self-start"
        onClick={() => {
          focusIndex.current = rows.length;
          change([...rows, ""]);
        }}
      >
        <Plus size={16} aria-hidden="true" />
        <FormattedMessage id="autoDocs.ruleAddValue" defaultMessage="Add value" />
      </Button>
    </fieldset>
  );
}
