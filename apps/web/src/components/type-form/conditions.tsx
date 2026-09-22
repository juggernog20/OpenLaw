// SPDX-License-Identifier: AGPL-3.0-only

/** DD-028 condition editor for one Branch and its preceding Rows. */
import { useFormText } from "./messages";
import { Fragment, useEffect, useState } from "react";
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
  // The AND / OR question, asked at the moment the second condition is
  // added, which is where the join first means anything (2026-09-22,
  // from live review). One join covers the whole Branch, so it is asked
  // once and changed afterwards on the join itself.
  const [asking, setAsking] = useState(false);
  function change(next: FormBranch) {
    setDraft(next);
    onChange(next);
  }
  function addCondition(match?: FormBranch["match"]) {
    setAsking(false);
    change({
      ...draft,
      ...(match ? { match } : {}),
      conditions: [...draft.conditions, { rowRef: "", operator: "equals", value: null }],
    });
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
        {draft.conditions.map((c, index) => {
          const row = rows.find((r) => r.rowRef === c.rowRef);
          return (
            <Fragment key={index}>
              {index === 1 ? (
                <select
                  aria-label={t("Join conditions")}
                  // Sized to its two words, not the row: w-auto cannot
                  // beat the shared class's w-full on its own, and the
                  // editor's flex column would stretch it regardless.
                  className={`${CONTROL_CLASS.replace("w-full", "w-auto")} self-start`}
                  value={draft.match}
                  onChange={(e) =>
                    change({ ...draft, match: e.target.value as FormBranch["match"] })
                  }
                >
                  <option value="all">{t("AND")}</option>
                  <option value="any">{t("OR")}</option>
                </select>
              ) : (
                index > 1 && (
                  // One join covers every condition, so the later ones
                  // only repeat what the first select already says.
                  <span aria-hidden="true" className="text-sm text-muted">
                    {draft.match === "all" ? t("AND") : t("OR")}
                  </span>
                )
              )}
              <div className="flex flex-wrap items-start gap-2">
                <label className="flex min-w-40 flex-1 flex-col gap-1">
                  {t("Row")}
                  <select
                    autoFocus={!c.rowRef && index === draft.conditions.length - 1}
                    aria-describedby={rows.length ? undefined : `above-${branch.id}`}
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
                  aria-label={t("Remove condition {number}", { number: index + 1 })}
                  onClick={() =>
                    change({ ...draft, conditions: draft.conditions.filter((_, i) => i !== index) })
                  }
                >
                  ×
                </Button>
              </div>
            </Fragment>
          );
        })}
        {/* Only the empty case earns a caption: with Rows to choose
            from, the select's own contents already say which ones are
            eligible (2026-09-22, from live review). */}
        {!rows.length && (
          <p id={`above-${branch.id}`} className="text-sm text-muted">
            {t("Add a Row above this Branch first")}
          </p>
        )}
        {asking ? (
          <div
            role="group"
            aria-label={t("Join the next condition with")}
            className="flex flex-wrap items-center gap-2"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setAsking(false);
              }
            }}
          >
            <span className="text-sm text-muted">{t("Join the next condition with")}</span>
            <Button autoFocus variant="secondary" size="sm" onClick={() => addCondition("all")}>
              {t("AND")}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => addCondition("any")}>
              {t("OR")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
              {t("Cancel")}
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => (draft.conditions.length === 1 ? setAsking(true) : addCondition())}
          >
            {t("Add another condition")}
          </Button>
        )}
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
  const display = (value: unknown) => String(value ?? "");
  const saved = Array.isArray(condition.value)
    ? condition.value.map(display).join(", ")
    : display(condition.value);
  const [text, setText] = useState(saved);
  const options = row ? optionsFor(row, catalog, t) : [];
  const choices =
    row?.fieldType === "boolean"
      ? [
          { value: "true", label: t("Yes") },
          { value: "false", label: t("No") },
        ]
      : (references ?? options);
  function scalar(value: string): FormScalar {
    return row?.fieldType === "boolean"
      ? value === "true"
      : row?.fieldType === "number" || row?.fieldType === "money"
        ? Number(value)
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
      {t("Value")}
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
      {row?.fieldType === "money" && (
        <span className="text-xs text-muted">
          {t("Enter minor units. For example, 5,000 JPY or 50 USD is 5,000 minor units.")}
        </span>
      )}
      {condition.value === null && (
        <span className="text-xs text-status-danger-fg">{t("Choose a value")}</span>
      )}
    </label>
  );
}
