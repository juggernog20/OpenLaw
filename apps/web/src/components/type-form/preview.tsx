// SPDX-License-Identifier: AGPL-3.0-only

/** DD-028 and INT-002 intake preview. Answers and attachments stay local. */
import { useIntl } from "react-intl";
import { useFormText } from "./messages";
import { useEffect, useState, type ComponentProps } from "react";
import {
  evaluateForm,
  formRowsForTouchpoint,
  type Form,
  type FormAnswers,
  type FormRow,
} from "@openlaw/shared";
import type { ApiField } from "../../lib/field-catalog";
import { toValue, type AttachedField, type CustomFieldDraft } from "../../lib/custom-fields";
import { readPortalEntityOptions } from "../../lib/portal-entities";
import { api } from "../../lib/api";
import { CONTROL_CLASS } from "../../lib/form-controls";
import { Field, AttachmentsField } from "../intake/form-fields";
import { CustomFieldControl, type FieldReference } from "../custom-field-control";
import { DepartmentPicker } from "../department-picker";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { CurrencySelect } from "../currency-select";
import { toMinorUnits } from "../../lib/format";
import { VALUE_CADENCES, cadenceLabel } from "../../lib/contracts";
import {
  IntakeCounterpartiesInput,
  type IntakeCounterpartySelection,
} from "../intake/counterparties-input";
import { optionsFor, rowName } from "./model";

export function IntakePreview({
  form,
  catalog,
  typeName,
  requestType: suppliedRequestType,
  typeId,
  isDefault,
  module,
  onClose,
  onCloseAutoFocus,
}: Readonly<{
  form: Form;
  catalog: readonly ApiField[];
  typeName: string;
  requestType?: { displayName: string; description: string | null };
  typeId: string;
  isDefault: boolean;
  module: "contract" | "matter" | "entity";
  onClose: () => void;
  onCloseAutoFocus: ComponentProps<typeof DialogContent>["onCloseAutoFocus"];
}>) {
  const t = useFormText();
  const intl = useIntl();
  const [answers, setAnswers] = useState<FormAnswers>({
    priority: "medium",
    [`${module}_type`]: typeId,
  });
  const [drafts, setDrafts] = useState<Record<string, CustomFieldDraft>>({});
  const [counterparties, setCounterparties] = useState<IntakeCounterpartySelection[]>([]);
  const [regions, setRegions] = useState<{ id: string; displayName: string }[]>([]);
  const [files, setFiles] = useState<readonly File[]>([]);
  const [entities, setEntities] = useState<FieldReference[]>([]);
  const [departments, setDepartments] = useState<{ id: string; displayName: string }[]>([]);
  const [requestTypes, setRequestTypes] = useState<
    { id: string; displayName: string; description: string | null }[] | null
  >(null);
  const [requestTypeId, setRequestTypeId] = useState("");
  const requestType =
    suppliedRequestType ?? requestTypes?.find((r) => r.id === requestTypeId) ?? requestTypes?.[0];
  const [submitted, setSubmitted] = useState(false);
  const [complete, setComplete] = useState(false);
  const [departmentsReady, setDepartmentsReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      readPortalEntityOptions(),
      api.GET("/api/v1/departments/options"),
      api.GET("/api/v1/regions", {}),
      suppliedRequestType ? Promise.resolve(null) : api.GET("/api/v1/request-types", {}),
    ]).then(([entities, response, regions, requests]) => {
      if (!active) return;
      if (entities.status === "fulfilled") setEntities(entities.value);
      if (response.status === "fulfilled" && response.value.data) {
        setDepartments(response.value.data.departments);
        setDepartmentsReady(true);
      }
      if (regions.status === "fulfilled" && regions.value.data)
        setRegions(regions.value.data.regions);
      if (requests.status === "fulfilled" && requests.value?.data)
        setRequestTypes(
          requests.value?.data.requestTypes.filter(
            (r) =>
              !r.archivedAt &&
              r.targetModule === module &&
              (r.targetTypeId === typeId || (r.targetTypeId === null && isDefault)),
          ),
        );
      setLoadError(
        entities.status === "rejected" ||
          response.status === "rejected" ||
          !response.value.data ||
          regions.status === "rejected" ||
          !regions.value.data ||
          requests.status === "rejected" ||
          (!suppliedRequestType && !requests.value?.data),
      );
    });
    return () => {
      active = false;
    };
  }, [module, typeId, isDefault, suppliedRequestType]);
  const visible = formRowsForTouchpoint(evaluateForm(form, answers).visibleRows, "intake").filter(
    (r) =>
      ![
        "title",
        "contract_type",
        "matter_type",
        "department",
        "owning_department",
        "priority",
      ].includes(r.rowRef),
  );
  const answered = (ref: string) => {
    const v = answers[ref];
    return (
      v !== undefined &&
      v !== null &&
      (typeof v !== "string" || v.trim() !== "") &&
      (!Array.isArray(v) || v.length > 0)
    );
  };
  function answer(key: string, value: unknown) {
    setComplete(false);
    setAnswers((old) => ({ ...old, [key]: value }));
  }
  function money(row: FormRow, key: string, value: string) {
    const next = { ...drafts, [`${row.id}-${key}`]: value };
    setDrafts(next);
    const amount = String(next[`${row.id}-amount`] ?? "");
    const currency = String(next[`${row.id}-currency`] ?? "");
    const minor = amount !== "" && currency ? toMinorUnits(Number(amount), currency) : NaN;
    answer(
      row.rowRef,
      Number.isSafeInteger(minor)
        ? { amount: minor, currency, cadence: next[`${row.id}-cadence`] ?? "one_time" }
        : null,
    );
  }
  function field(row: FormRow): AttachedField {
    const definition = catalog.find((f) => f.id === row.id);
    return {
      fieldId: row.id,
      slug: row.rowRef,
      displayName: rowName(row, catalog, t),
      description: definition?.description ?? null,
      fieldType: row.fieldType === "money" ? "number" : row.fieldType,
      options: optionsFor(row, catalog, t).map((o) => o.value),
      isRequired: row.isRequired,
      displayOrder: 0,
      fieldTag: "business",
      visibleOnPortal: row.visibleOnPortal,
    };
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        width="3xl"
        aria-describedby="preview-caption"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogTitle>{t("Preview intake form")}</DialogTitle>
        <p id="preview-caption" className="mt-1 text-sm text-muted">
          {t("Preview only. No Request will be sent.")}
        </p>
        <form
          className="mt-4 flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(true);
            setComplete(
              departmentsReady &&
                answered("title") &&
                (!departments.length || answered("department")) &&
                visible.every((r) => !r.isRequired || answered(r.rowRef)),
            );
          }}
        >
          {!suppliedRequestType && requestTypes && requestTypes.length > 1 && (
            <label className="flex flex-col gap-1">
              {t("Request type")}
              <select
                className={CONTROL_CLASS}
                value={requestTypeId || requestTypes[0]?.id || ""}
                onChange={(e) => setRequestTypeId(e.target.value)}
              >
                {requestTypes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.displayName}
                  </option>
                ))}
              </select>
            </label>
          )}
          <h3 className="font-semibold">{requestType?.displayName ?? typeName}</h3>
          {requestType?.description && (
            <p className="text-sm text-muted">{requestType.description}</p>
          )}
          {!suppliedRequestType && requestTypes?.length === 0 && (
            <p className="text-sm text-muted">{t("No Request type uses this Form yet")}</p>
          )}
          {loadError && (
            <p role="alert">
              {t("Some Portal options could not be loaded. Reopen the preview to retry.")}
            </p>
          )}
          <Field
            htmlFor="preview-title"
            label={t("Title")}
            required
            unanswered={submitted && !answered("title")}
          >
            <Input
              id="preview-title"
              value={String(answers.title ?? "")}
              onChange={(e) => answer("title", e.target.value)}
            />
          </Field>
          <Field
            htmlFor="preview-department"
            label={t("Department")}
            required={departments.length > 0}
            unanswered={submitted && departments.length > 0 && !answered("department")}
          >
            <DepartmentPicker
              id="preview-department"
              value={typeof answers.department === "string" ? answers.department : null}
              options={departments}
              onChange={(value) => {
                answer("department", value);
                answer("owning_department", value);
              }}
            />
          </Field>
          <Field htmlFor="preview-priority" label={t("Urgency")}>
            <select
              id="preview-priority"
              className={CONTROL_CLASS}
              value={String(answers.priority ?? "medium")}
              onChange={(e) => answer("priority", e.target.value)}
            >
              {(["Low", "Medium", "High", "Critical"] as const).map((v) => (
                <option key={v} value={v.toLowerCase()}>
                  {t(v)}
                </option>
              ))}
            </select>
          </Field>
          <p aria-live="polite" className="sr-only">
            {t("{count} questions shown: {questions}", {
              count: visible.length,
              questions: visible.map((r) => rowName(r, catalog, t)).join(", "),
            })}
          </p>
          {visible.map((row) => {
            const id = `preview-${row.id}`;
            const options = optionsFor(row, catalog, t);
            return (
              <Field
                key={row.id}
                htmlFor={id}
                label={rowName(row, catalog, t)}
                required={row.isRequired}
                unanswered={submitted && row.isRequired && !answered(row.rowRef)}
              >
                {row.rowRef === "counterparties" ? (
                  <IntakeCounterpartiesInput
                    id={id}
                    requestTypeId=""
                    searchOptions={searchPreviewCounterparties}
                    selections={counterparties}
                    required={row.isRequired}
                    onChange={(next) => {
                      setCounterparties(next);
                      answer(
                        row.rowRef,
                        next.map((s) =>
                          "counterpartyId" in s.pick ? s.pick.counterpartyId : s.pick.name,
                        ),
                      );
                    }}
                  />
                ) : row.rowRef === "region" ? (
                  <select
                    id={id}
                    className={CONTROL_CLASS}
                    value={String(answers[row.rowRef] ?? "")}
                    onChange={(e) => answer(row.rowRef, e.target.value)}
                  >
                    <option value="">{t("Not set")}</option>
                    {regions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.displayName}
                      </option>
                    ))}
                  </select>
                ) : row.fieldType === "money" ? (
                  <div role="group" aria-label={t("Value")} className="flex flex-wrap gap-2">
                    <Input
                      id={id}
                      aria-label={t("Value amount")}
                      type="number"
                      value={String(drafts[`${row.id}-amount`] ?? "")}
                      onChange={(e) => money(row, "amount", e.target.value)}
                    />
                    <CurrencySelect
                      aria-label={t("Value currency")}
                      allowCreate={false}
                      value={String(drafts[`${row.id}-currency`] ?? "")}
                      onValueChange={(currency) => money(row, "currency", currency)}
                    />
                    <select
                      aria-label={t("Value cadence")}
                      className={CONTROL_CLASS}
                      value={String(drafts[`${row.id}-cadence`] ?? "one_time")}
                      onChange={(e) => money(row, "cadence", e.target.value)}
                    >
                      {VALUE_CADENCES.map((c) => (
                        <option key={c} value={c}>
                          {cadenceLabel(intl, c)}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : options.length && row.fieldType === "single_select" ? (
                  <select
                    id={id}
                    aria-required={row.isRequired}
                    className={CONTROL_CLASS}
                    value={String(answers[row.rowRef] ?? "")}
                    onChange={(e) => answer(row.rowRef, e.target.value)}
                  >
                    <option value="">{t("Not set")}</option>
                    {options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <CustomFieldControl
                    allowCreateCurrency={false}
                    id={id}
                    field={field(row)}
                    draft={
                      drafts[row.id] ??
                      (row.fieldType === "boolean"
                        ? false
                        : row.fieldType === "multi_select"
                          ? []
                          : "")
                    }
                    entities={entities}
                    required={row.isRequired}
                    invalid={submitted && row.isRequired && !answered(row.rowRef)}
                    onDraft={(draft) => {
                      setDrafts((old) => ({ ...old, [row.id]: draft }));
                      const converted = toValue(field(row), draft);
                      answer(row.rowRef, "value" in converted ? converted.value : null);
                    }}
                  />
                )}
              </Field>
            );
          })}
          <AttachmentsField files={files} onFiles={setFiles} />
          {complete && <p role="status">{t("Preview complete. No Request was sent")}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={!departmentsReady}>
              {t("Submit request")}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              {t("Close")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Both registry endpoints call searchCounterparties and return the same Portal labels.
async function searchPreviewCounterparties(query: string) {
  const { data } = await api.GET("/api/v1/counterparties", { params: { query: { query } } });
  if (!data) throw new Error("Counterparties could not be read");
  return data.counterparties;
}
