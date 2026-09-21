// SPDX-License-Identifier: AGPL-3.0-only
import { useFormText } from "./messages";
import { useEffect, useState } from "react";
import type { FormBranch, FormCondition, FormOperator, FormRow, FormScalar } from "@openlaw/shared";
import type { ApiField } from "../../lib/field-catalog";
import { CONTROL_CLASS } from "../../lib/form-controls";
import { CurrencySelect } from "../currency-select";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { referenceOptions } from "./reference-options";
import { OPERATORS, optionsFor, rowName } from "./model";

export function Conditions({
  branch,
  rows,
  catalog,
  disabled,
  onChange,
  onCancel,
}: Readonly<{
  branch: FormBranch;
  rows: FormRow[];
  catalog: readonly ApiField[];
  disabled: boolean;
  onChange: (branch: FormBranch) => void;
  onCancel: () => void;
}>) {
  const t = useFormText();
  const [draft, setDraft] = useState(branch);
  function change(next: FormBranch) {
    setDraft(next);
    onChange(next);
  }
  function condition(index: number, next: FormCondition) {
    change({ ...draft, conditions: draft.conditions.map((c, i) => (i === index ? next : c)) });
  }
  return (
    <div
      className="flex flex-col gap-3 px-4 py-3"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <fieldset
        aria-describedby={`note-${branch.id}-condition`}
        disabled={disabled}
        className="flex flex-col gap-3"
      >
        <legend className="sr-only">{t("Branch conditions")}</legend>
        <div role="radiogroup" aria-label={t("Match")} className="flex gap-3">
          {(["all", "any"] as const).map((match) => (
            <label key={match} className="flex items-center gap-2">
              <input
                type="radio"
                checked={draft.match === match}
                name={`match-${branch.id}`}
                onChange={() => change({ ...draft, match })}
              />
              {match === "all" ? t("All") : t("Any")}
            </label>
          ))}
        </div>
        {draft.conditions.map((c, index) => {
          const row = rows.find((r) => r.rowRef === c.rowRef);
          return (
            <div key={index} className="flex flex-wrap items-start gap-2">
              <label className="flex min-w-40 flex-1 flex-col gap-1">
                {t("Row")}
                <select
                  autoFocus={index === 0 && !c.rowRef}
                  aria-describedby={`above-${branch.id}`}
                  className={CONTROL_CLASS}
                  value={c.rowRef}
                  onChange={(e) =>
                    condition(index, { rowRef: e.target.value, operator: "equals", value: null })
                  }
                >
                  <option value="">{t("Select Row")}</option>
                  {rows.map((r) => (
                    <option key={r.id} value={r.rowRef}>
                      {rowName(r, catalog, t)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-40 flex-1 flex-col gap-1">
                {t("Operator")}
                <select
                  className={CONTROL_CLASS}
                  value={c.operator}
                  onChange={(e) => {
                    const operator = e.target.value as FormOperator;
                    condition(index, {
                      ...c,
                      operator,
                      value:
                        operator === "is_set"
                          ? null
                          : operator === "is_one_of"
                            ? c.value === null
                              ? []
                              : Array.isArray(c.value)
                                ? c.value
                                : [c.value as FormScalar]
                            : Array.isArray(c.value)
                              ? (c.value[0] ?? null)
                              : c.value,
                    });
                  }}
                >
                  {Object.entries(OPERATORS)
                    .filter(
                      ([op]) =>
                        !["greater_than", "less_than"].includes(op) ||
                        (row && ["number", "money", "date"].includes(row.fieldType)),
                    )
                    .map(([op, label]) => (
                      <option key={op} value={op}>
                        {t(label)}
                      </option>
                    ))}
                </select>
              </label>
              {c.operator !== "is_set" && (
                <Operand
                  key={`${c.rowRef}-${c.operator}-${index}`}
                  condition={c}
                  row={row}
                  catalog={catalog}
                  onChange={(value) => condition(index, { ...c, value })}
                />
              )}
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove condition ${index + 1}`}
                onClick={() =>
                  change({ ...draft, conditions: draft.conditions.filter((_, i) => i !== index) })
                }
              >
                ×
              </Button>
            </div>
          );
        })}
        <p id={`above-${branch.id}`} className="text-sm text-muted">
          {rows.length ? t("Rows above only") : t("Add a Row above this Branch first")}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            change({
              ...draft,
              conditions: [...draft.conditions, { rowRef: "", operator: "equals", value: null }],
            })
          }
        >
          {t("Add condition")}
        </Button>
      </fieldset>
    </div>
  );
}

function Operand({
  condition,
  row,
  catalog,
  onChange,
}: Readonly<{
  condition: FormCondition;
  row?: FormRow;
  catalog: readonly ApiField[];
  onChange: (value: FormCondition["value"]) => void;
}>) {
  const t = useFormText();
  const [references, setReferences] = useState<{ value: string; label: string }[] | null>(null);
  const [referenceError, setReferenceError] = useState(false);
  useEffect(() => {
    let active = true;
    if (row)
      void referenceOptions(row)
        .then((options) => {
          if (active) setReferences(options);
        })
        .catch(() => {
          if (active) setReferenceError(true);
        });
    return () => {
      active = false;
    };
  }, [row]);
  const many = condition.operator === "is_one_of";
  const display = (value: unknown) =>
    row?.fieldType === "money" && typeof value === "number"
      ? String(value / 100)
      : String(value ?? "");
  const saved = Array.isArray(condition.value)
    ? condition.value.map(display).join(", ")
    : display(condition.value);
  const [text, setText] = useState(saved);
  const options = row ? optionsFor(row, catalog) : [];
  const choices =
    row?.fieldType === "boolean"
      ? [
          { value: "true", label: "Yes" },
          { value: "false", label: "No" },
        ]
      : (references ?? options);
  function scalar(value: string): FormScalar {
    return row?.fieldType === "boolean"
      ? value === "true"
      : row?.fieldType === "number"
        ? Number(value)
        : row?.fieldType === "money"
          ? Math.round(Number(value) * 100)
          : value;
  }
  function commit() {
    onChange(
      text.trim() === ""
        ? null
        : many
          ? text.split(",").map((s) => scalar(s.trim()))
          : scalar(text),
    );
  }
  return (
    <label className="flex min-w-40 flex-1 flex-col gap-1">
      Value
      {choices.length ||
      references !== null ||
      row?.fieldType === "user" ||
      row?.fieldType === "entity" ||
      row?.fieldType === "single_select" ||
      row?.fieldType === "multi_select" ? (
        <select
          aria-label={t("Value")}
          className={CONTROL_CLASS}
          multiple={many}
          value={
            many
              ? Array.isArray(condition.value)
                ? condition.value.map(String)
                : []
              : String(condition.value ?? "")
          }
          onChange={(e) =>
            onChange(
              many
                ? [...e.target.selectedOptions].map((o) => scalar(o.value))
                : e.target.value === ""
                  ? null
                  : scalar(e.target.value),
            )
          }
        >
          {!many && <option value="">{t("Select value")}</option>}
          {choices.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : row?.fieldType === "currency" && !many ? (
        <CurrencySelect
          aria-label={t("Value")}
          value={String(condition.value ?? "")}
          onValueChange={onChange}
        />
      ) : (
        <Input
          aria-label={t("Value")}
          type={
            !many && row?.fieldType === "date"
              ? "date"
              : !many && row && ["number", "money"].includes(row.fieldType)
                ? "number"
                : "text"
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              e.stopPropagation();
              setText(saved);
            }
          }}
        />
      )}
      {referenceError && (
        <span role="alert">
          {t("Options could not be loaded. Close and reopen conditions to retry.")}
        </span>
      )}
      {condition.value === null && (
        <span className="text-xs text-status-danger-fg">{t("Choose a value")}</span>
      )}
    </label>
  );
}
