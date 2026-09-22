// SPDX-License-Identifier: AGPL-3.0-only

/** The creation Rows of a type's Form drawn inside a create or convert
 * dialog (DD-028, DES-090): built-in Rows through the record's own
 * controls, Field Rows through the shared custom-field control, hidden
 * Rows dropped from what the dialog sends. */
import { FormattedMessage } from "react-intl";
import { DatePicker } from "../date-picker";
import { useEffect, useState } from "react";
import {
  evaluateForm,
  formRowsForTouchpoint,
  recordFormAnswers,
  type Form,
  type FormRow,
} from "@openlaw/shared";
import {
  emptyDraft,
  toValue,
  type AttachedField,
  type CustomFieldDraft,
} from "../../lib/custom-fields";
import { type ContractValue } from "../../lib/contracts";
import { api } from "../../lib/api";
import { readRegistry } from "../../lib/entities";
import { CustomFieldControl, type FieldReference } from "../custom-field-control";
import { DescribedField } from "../described-field";
import { ValueField } from "../contracts/value-field";
import { DepartmentPicker } from "../department-picker";
import { AutoResizeTextarea } from "../auto-resize-textarea";
import { IntakeCounterpartiesInput } from "../intake/counterparties-input";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { CONTROL_CLASS } from "../../lib/form-controls";
import { optionsFor, rowName } from "./model";
import { useFormText } from "./messages";

export interface CreationValues {
  valueError?: string;
  regionId?: string | null;
  description?: string | null;
  entityId?: string | null;
  owningDepartmentId?: string | null;
  departmentId?: string | null;
  region?: string | null;
  priority?: "low" | "medium" | "high" | "critical";
  risk?: "low" | "medium" | "high" | "critical" | null;
  termType?: "fixed" | "auto_renew" | "evergreen";
  effectiveDate?: string | null;
  expiryDate?: string | null;
  renewalPeriodMonths?: number | null;
  noticePeriodDays?: number | null;
  value?: ContractValue | null;
  neededBy?: string | null;
  counterparties?: ({ counterpartyId: string } | { name: string })[];
}
export const creationKeys: Record<string, keyof CreationValues> = {
  description: "description",
  entity: "entityId",
  owning_department: "owningDepartmentId",
  department: "departmentId",
  region: "region",
  priority: "priority",
  risk: "risk",
  term_type: "termType",
  effective_date: "effectiveDate",
  expiry_date: "expiryDate",
  renewal_period_months: "renewalPeriodMonths",
  notice_period_days: "noticePeriodDays",
  value: "value",
  needed_by: "neededBy",
  counterparties: "counterparties",
};

export function creationRows(
  form: Form | undefined,
  fields: readonly AttachedField[],
  drafts: Readonly<Record<string, CustomFieldDraft>>,
  native: CreationValues,
  basics: Record<string, unknown> = {},
) {
  const customFields = Object.fromEntries(
    fields.map((field) => {
      const parsed = toValue(field, drafts[field.slug] ?? emptyDraft(field));
      return [field.slug, "value" in parsed ? parsed.value : null];
    }),
  );
  const answers = recordFormAnswers({
    ...native,
    ...basics,
    customFields,
    counterparties: native.counterparties?.map((p) =>
      "counterpartyId" in p ? p.counterpartyId : p.name,
    ),
  });
  const tree =
    form ??
    fields.map((f): FormRow => ({
      kind: "row",
      id: f.fieldId,
      rowRef: f.slug,
      fieldType: f.fieldType,
      isRequired: f.isRequired,
      visibleOnPortal: true,
    }));
  const rows = formRowsForTouchpoint(evaluateForm(tree, answers).visibleRows, "creation").filter(
    (r) => !["title", "contract_type", "matter_type"].includes(r.rowRef),
  );
  return {
    rows,
    answers,
    fields: rows.flatMap((r) => {
      const f = fields.find((f) => f.slug === r.rowRef);
      return f ? [{ ...f, isRequired: r.isRequired }] : [];
    }),
  };
}
export function creationNativeValues(
  rows: readonly FormRow[],
  native: CreationValues,
): CreationValues {
  const visible = new Set(rows.map((r) => creationKeys[r.rowRef]));
  return Object.fromEntries(
    Object.entries(native).filter(([key]) => visible.has(key as keyof CreationValues)),
  );
}

export function CreationRows({
  rows,
  fields,
  drafts,
  onDraft,
  native,
  onNative,
  people = [],
  entities = [],
  departments: givenDepartments,
  regions: givenRegions,
  partyLabels = {},
}: Readonly<{
  partyLabels?: Readonly<Record<string, string>>;
  rows: readonly FormRow[];
  fields: readonly AttachedField[];
  drafts: Readonly<Record<string, CustomFieldDraft>>;
  onDraft: (slug: string, value: CustomFieldDraft) => void;
  native: CreationValues;
  onNative: (value: CreationValues) => void;
  people?: readonly FieldReference[];
  entities?: readonly FieldReference[];
  /** Choices the opener already holds. Absent means the component reads them itself. */
  departments?: readonly { id: string; displayName: string }[];
  regions?: readonly { id: string; displayName: string }[];
}>) {
  const t = useFormText();
  const [readDepartments, setDepartments] = useState<{ id: string; displayName: string }[]>([]);
  const [readRegions, setRegions] = useState<{ id: string; displayName: string }[]>([]);
  const departments = givenDepartments ?? readDepartments;
  const regions = givenRegions ?? readRegions;
  const [references, setReferences] = useState<{
    people: FieldReference[];
    entities: FieldReference[];
  }>({ people: [], entities: [] });

  const [partyNames, setPartyNames] = useState<Record<string, string>>({});
  const [valueError, setValueError] = useState<string>();
  const [optionsError, setOptionsError] = useState(false);
  const needsDepartments =
    !givenDepartments && rows.some((r) => ["department", "owning_department"].includes(r.rowRef));
  const needsRegions = !givenRegions && rows.some((r) => r.rowRef === "region");
  const needsPeople = !people.length && rows.some((r) => r.fieldType === "user");
  const needsEntities = !entities.length && rows.some((r) => r.fieldType === "entity");
  useEffect(() => {
    let live = true;
    void Promise.allSettled([
      needsDepartments ? api.GET("/api/v1/departments/options") : Promise.resolve(undefined),
      needsRegions ? api.GET("/api/v1/contracts/options") : Promise.resolve(undefined),
      needsPeople ? api.GET("/api/v1/entities/officer-roles") : Promise.resolve(undefined),
      needsEntities ? readRegistry() : Promise.resolve(undefined),
    ]).then(([departments, regions, people, entities]) => {
      if (!live) return;
      if (departments.status === "fulfilled" && departments.value?.data)
        setDepartments(departments.value.data.departments);
      if (regions.status === "fulfilled" && regions.value?.data)
        setRegions(regions.value.data.regions);
      if (people.status === "fulfilled" && people.value?.data)
        setReferences((r) => ({
          ...r,
          people: people.value!.data!.users.map((u) => ({
            id: u.id,
            label: u.displayName,
            archived: false,
          })),
        }));
      if (entities.status === "fulfilled" && entities.value?.data)
        setReferences((r) => ({
          ...r,
          entities: entities.value!.data!.entities.map((e) => ({
            id: e.id,
            label: e.legalName,
            archived: e.archivedAt !== null,
          })),
        }));
      setOptionsError(
        [departments, regions, people, entities].some(
          (r) => r.status === "rejected" || (r.value !== undefined && !r.value.data),
        ),
      );
    });
    return () => {
      live = false;
    };
  }, [needsDepartments, needsRegions, needsPeople, needsEntities]);
  function set(key: keyof CreationValues, value: unknown) {
    onNative({ ...native, [key]: key === "termType" && value === null ? undefined : value });
  }
  return (
    <>
      {optionsError && (
        <p role="alert" className="text-xs text-status-danger-fg">
          <FormattedMessage
            id="typeForm.creationOptionsFailed"
            defaultMessage="Some choices could not be loaded. Close the dialog and try again."
          />
        </p>
      )}
      {rows.map((row) => {
        const field = fields.find((f) => f.slug === row.rowRef);
        const id = `creation-${row.rowRef}`;
        const label = field?.displayName ?? rowName(row, [], t);
        const key = creationKeys[row.rowRef];
        const value = key ? native[key] : undefined;
        let control;
        if (field)
          control = (
            <CustomFieldControl
              id={id}
              field={field}
              required={row.isRequired}
              draft={drafts[field.slug] ?? emptyDraft(field)}
              describedBy={field.description ? `${id}-help` : undefined}
              people={people.length ? people : references.people}
              entities={entities.length ? entities : references.entities}
              onDraft={(draft) => onDraft(field.slug, draft)}
            />
          );
        else if (row.rowRef === "value")
          return (
            <ValueField
              idPrefix={id}
              required={row.isRequired}
              key={row.id}
              value={native.value ?? null}
              frozen={false}
              status={valueError ? "error" : "idle"}
              error={valueError}
              onStatus={(_, detail) => setValueError(detail)}
              onCommit={(value) => set("value", value)}
              onDraftChange={(value, valueError) => onNative({ ...native, value, valueError })}
            />
          );
        else if (row.rowRef === "counterparties")
          control = (
            <IntakeCounterpartiesInput
              id={id}
              requestTypeId=""
              selections={(native.counterparties ?? []).map((pick) => ({
                pick,
                label:
                  "name" in pick
                    ? pick.name
                    : (partyLabels[pick.counterpartyId] ??
                      partyNames[pick.counterpartyId] ??
                      pick.counterpartyId),
              }))}
              required={row.isRequired}
              searchOptions={async (query) => {
                const { data } = await api.GET("/api/v1/counterparties", {
                  params: { query: { query } },
                });
                if (!data) throw new Error("Counterparties could not be read.");
                return data.counterparties;
              }}
              onChange={(next) => {
                setPartyNames((current) => ({
                  ...current,
                  ...Object.fromEntries(
                    next.flatMap((p) =>
                      "counterpartyId" in p.pick ? [[p.pick.counterpartyId, p.label]] : [],
                    ),
                  ),
                }));
                set(
                  "counterparties",
                  next.map((p) => p.pick),
                );
              }}
            />
          );
        else if (key === "departmentId" || key === "owningDepartmentId")
          control = (
            <DepartmentPicker
              id={id}
              value={typeof value === "string" ? value : null}
              options={departments}
              required={row.isRequired}
              onChange={(value) => set(key, value)}
            />
          );
        else if (key === "description")
          control = (
            <AutoResizeTextarea
              id={id}
              aria-required={row.isRequired}
              value={native.description ?? ""}
              onChange={(e) => set(key, e.target.value)}
            />
          );
        else if (key && (row.fieldType === "single_select" || row.fieldType === "entity")) {
          const choices =
            key === "region"
              ? regions.map((r) => ({ value: r.displayName, label: r.displayName }))
              : key === "entityId"
                ? (entities.length ? entities : references.entities).map((e) => ({
                    value: e.id,
                    label: e.label,
                  }))
                : optionsFor(row, [], t);
          control = (
            <select
              id={id}
              className={CONTROL_CLASS}
              aria-required={row.isRequired}
              value={
                key === "region"
                  ? (regions.find((r) => r.id === native.regionId)?.displayName ??
                    (typeof value === "string" ? value : ""))
                  : typeof value === "string"
                    ? value
                    : ""
              }
              onChange={(e) =>
                key === "region"
                  ? onNative({
                      ...native,
                      region: e.target.value || null,
                      regionId: regions.find((r) => r.displayName === e.target.value)?.id ?? null,
                    })
                  : set(key, e.target.value || null)
              }
            >
              {key !== "priority" && <option value="">{t("Not set")}</option>}
              {choices.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          );
        } else if (key && row.fieldType === "date")
          control = (
            <DatePicker
              id={id}
              value={typeof value === "string" ? value : ""}
              onChange={(value) => set(key, value || null)}
            />
          );
        else if (key)
          control = (
            <Input
              id={id}
              aria-required={row.isRequired}
              type={
                row.fieldType === "date" ? "date" : row.fieldType === "number" ? "number" : "text"
              }
              value={typeof value === "string" || typeof value === "number" ? value : ""}
              onChange={(e) =>
                set(
                  key,
                  row.fieldType === "number"
                    ? e.target.value === ""
                      ? null
                      : Number(e.target.value)
                    : e.target.value || null,
                )
              }
            />
          );
        return (
          <DescribedField
            key={row.id}
            description={field?.description}
            descriptionId={`${id}-help`}
            className="flex flex-col gap-1.5"
          >
            <Label id={`${id}-label`} htmlFor={id} required={row.isRequired}>
              {label}
            </Label>
            {control}
          </DescribedField>
        );
      })}
    </>
  );
}
