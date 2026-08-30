// SPDX-License-Identifier: AGPL-3.0-only

/** ST21 Matter-template editor for reusable defaults, tasks, and key dates. */

import { useState } from "react";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { defineMessages, FormattedMessage, useIntl, type IntlShape } from "react-intl";
import { Link, redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import type { paths } from "@openlaw/api-client";
import { api } from "../lib/api";
import { readRegistry } from "../lib/entities";
import {
  emptyDraft,
  toDraft,
  toValue,
  type AttachedField,
  type CustomFieldDraft,
  type CustomFieldValue,
  type CustomFieldValues,
} from "../lib/custom-fields";
import { problem } from "../lib/problem";
import { requireUser } from "../lib/session";
import { MattersSettingsTabs } from "../components/matters-settings-tabs";
import { CustomFieldControl, type FieldReference } from "../components/custom-field-control";
import {
  newDraftKey,
  TemplateKeyDatesEditor,
  TemplateTasksEditor,
  type TemplateKeyDateDraft,
  type TemplateTaskDraft,
} from "../components/matter-template-content-editor";
import { PageTitle } from "../components/page-title";
import { SettingsCard } from "../components/settings-card";
import { StatusNote, type FieldStatus } from "../components/status-note";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export async function settingsMatterTemplateEditorLoader({ params }: LoaderFunctionArgs) {
  const user = await requireUser();
  if (user.role !== "administrator") return redirect("/settings/profile");
  const [templateResult, types] = await Promise.all([
    api.GET("/api/v1/matter-templates/{id}", {
      params: { path: { id: params.templateId ?? "" } },
    }),
    api.GET("/api/v1/matter-types", { params: { query: { includeArchived: "true" } } }),
  ]);
  if (templateResult.response.status === 404) {
    throw new Response("No Matter template exists with this id.", { status: 404 });
  }
  if (!templateResult.data || !types.data) {
    throw new Error("The Matter template could not be read.");
  }
  const matterTemplate = templateResult.data.matterTemplate;
  const [attachments, catalog, users, entities] = await Promise.all([
    api.GET("/api/v1/matter-types/{id}/fields", {
      params: { path: { id: matterTemplate.matterTypeId } },
    }),
    api.GET("/api/v1/fields", { params: { query: { includeArchived: "true" } } }),
    api.GET("/api/v1/users", {}),
    readRegistry({ includeArchived: "true" }),
  ]);
  if (!attachments.data || !catalog.data || !users.data || !entities.data) {
    throw new Error("The Matter template fields could not be read.");
  }
  const catalogById = new Map(catalog.data.fields.map((field) => [field.id, field]));
  const attachedFields = attachments.data.attachedFields.flatMap((attachment) => {
    const field = catalogById.get(attachment.fieldId);
    if (!field) return [];
    return [
      {
        fieldId: attachment.fieldId,
        slug: attachment.slug,
        displayName: attachment.displayName,
        description: field.description,
        fieldType: attachment.fieldType,
        fieldTag: field.fieldTag,
        options: field.options,
        displayOrder: attachment.displayOrder,
        isRequired: attachment.isRequired,
      } satisfies AttachedField,
    ];
  });
  return {
    matterTemplate,
    matterType: types.data.matterTypes.find((type) => type.id === matterTemplate.matterTypeId),
    attachedFields,
    fieldCatalog: catalog.data.fields,
    people: users.data.users.map((person) => ({
      id: person.id,
      label: person.displayName,
      archived: person.status === "archived",
    })),
    entities: entities.data.entities.map((entity) => ({
      id: entity.id,
      label: entity.legalName,
      archived: entity.archivedAt !== null,
    })),
  };
}

type ApiTemplate =
  paths["/api/v1/matter-templates"]["get"]["responses"]["200"]["content"]["application/json"]["matterTemplates"][number];
type Severity = NonNullable<ApiTemplate["defaultPriority"]>;

const SEVERITIES: readonly Severity[] = ["low", "medium", "high", "critical"];
const SEVERITY_MESSAGES = defineMessages({
  low: { id: "severity.low", defaultMessage: "Low" },
  medium: { id: "severity.medium", defaultMessage: "Medium" },
  high: { id: "severity.high", defaultMessage: "High" },
  critical: { id: "severity.critical", defaultMessage: "Critical" },
});

function initialCustomFieldDrafts(
  fields: readonly AttachedField[],
  values: CustomFieldValues,
): Record<string, CustomFieldDraft> {
  return Object.fromEntries(
    fields.map((field) => [field.slug, toDraft(field, values[field.slug])]),
  );
}

function staleValueLabel(
  intl: IntlShape,
  value: CustomFieldValue,
  fieldType: string | undefined,
  people: readonly FieldReference[],
  entities: readonly FieldReference[],
): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") {
    return value
      ? intl.formatMessage({ id: "settings.matterTemplateEditor.staleYes", defaultMessage: "Yes" })
      : intl.formatMessage({ id: "settings.matterTemplateEditor.staleNo", defaultMessage: "No" });
  }
  if (fieldType === "user")
    return people.find((person) => person.id === value)?.label ?? String(value);
  if (fieldType === "entity") {
    return entities.find((entity) => entity.id === value)?.label ?? String(value);
  }
  return String(value);
}

export function SettingsMatterTemplateEditorPage() {
  const { matterTemplate, matterType, attachedFields, fieldCatalog, people, entities } =
    useLoaderData<typeof settingsMatterTemplateEditorLoader>();
  const intl = useIntl();
  const [template, setTemplate] = useState(matterTemplate);
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? "");
  const [defaultPriority, setDefaultPriority] = useState<Severity | "">(
    template.defaultPriority ?? "",
  );
  const [defaultRisk, setDefaultRisk] = useState<Severity | "">(template.defaultRisk ?? "");
  const [titlePrefix, setTitlePrefix] = useState(template.titlePrefix ?? "");
  const [customFieldDrafts, setCustomFieldDrafts] = useState<Record<string, CustomFieldDraft>>(() =>
    initialCustomFieldDrafts(attachedFields, template.defaultCustomFields),
  );
  const [tasks, setTasks] = useState<TemplateTaskDraft[]>(() =>
    template.tasks.map((task) => ({
      key: task.id,
      title: task.title,
      dueOffsetDays: task.dueOffsetDays === null ? "" : String(task.dueOffsetDays),
      assigneeRole: task.assigneeRole,
    })),
  );
  const [keyDates, setKeyDates] = useState<TemplateKeyDateDraft[]>(() =>
    template.keyDates.map((keyDate) => ({
      key: keyDate.id,
      label: keyDate.label,
      offsetDays: String(keyDate.offsetDays),
      note: keyDate.note ?? "",
    })),
  );
  const [status, setStatus] = useState<FieldStatus>("idle");
  const [detail, setDetail] = useState<string | null>(null);

  async function save() {
    if (status === "saving") return;
    if (name.trim() === "") {
      setStatus("error");
      setDetail(
        intl.formatMessage({
          id: "settings.matterTemplateEditor.nameMissing",
          defaultMessage: "Name the template.",
        }),
      );
      return;
    }
    const invalidTask = tasks.some((task) => {
      if (task.title.trim() === "") return true;
      if (task.dueOffsetDays === "") return false;
      const dueOffsetDays = Number(task.dueOffsetDays);
      return !Number.isInteger(dueOffsetDays) || dueOffsetDays < 0 || dueOffsetDays > 3650;
    });
    const invalidKeyDate = keyDates.some((keyDate) => {
      const offsetDays = Number(keyDate.offsetDays);
      return (
        keyDate.label.trim() === "" ||
        keyDate.offsetDays === "" ||
        !Number.isInteger(offsetDays) ||
        offsetDays < 0 ||
        offsetDays > 3650
      );
    });
    if (invalidTask || invalidKeyDate) {
      setStatus("error");
      setDetail(
        intl.formatMessage({
          id: "settings.matterTemplateEditor.contentInvalid",
          defaultMessage: "Give every row a name and use whole-number offsets from 0 to 3650 days.",
        }),
      );
      return;
    }
    const customFieldValues: Record<string, CustomFieldValue> = {};
    for (const field of attachedFields) {
      const result = toValue(field, customFieldDrafts[field.slug] ?? emptyDraft(field));
      if ("error" in result) {
        setStatus("error");
        setDetail(
          intl.formatMessage(
            {
              id: "settings.matterTemplateEditor.fieldNumberInvalid",
              defaultMessage: "Give {field} a number.",
            },
            { field: field.displayName },
          ),
        );
        return;
      }
      if (result.value !== null) customFieldValues[field.slug] = result.value;
    }
    setStatus("saving");
    setDetail(null);
    const result = await api
      .PATCH("/api/v1/matter-templates/{id}", {
        params: { path: { id: template.id } },
        body: {
          name: name.trim(),
          description: description.trim() || null,
          defaultPriority: defaultPriority || null,
          defaultRisk: defaultRisk || null,
          titlePrefix: titlePrefix.trim() || null,
        },
      })
      .catch(() => undefined);
    const { data } = result ?? {};
    if (!data) {
      setStatus("error");
      setDetail(
        (await problem(result)).detail ??
          intl.formatMessage({
            id: "settings.matterTemplateEditor.saveError",
            defaultMessage: "The Matter template could not be saved.",
          }),
      );
      return;
    }
    setTemplate(data.matterTemplate);

    const fieldResult = await api
      .PUT("/api/v1/matter-templates/{id}/custom-fields", {
        params: { path: { id: template.id } },
        body: { defaultCustomFields: customFieldValues },
      })
      .catch(() => undefined);
    if (!fieldResult?.data) {
      setStatus("error");
      setDetail(
        (await problem(fieldResult)).detail ??
          intl.formatMessage({
            id: "settings.matterTemplateEditor.fieldsSaveError",
            defaultMessage:
              "The custom-field defaults could not be saved. Earlier changes may already be saved.",
          }),
      );
      return;
    }
    setTemplate(fieldResult.data.matterTemplate);

    const taskResult = await api
      .PUT("/api/v1/matter-templates/{id}/tasks", {
        params: { path: { id: template.id } },
        body: {
          tasks: tasks.map((task) => ({
            title: task.title.trim(),
            dueOffsetDays: task.dueOffsetDays === "" ? null : Number(task.dueOffsetDays),
            assigneeRole: task.assigneeRole,
          })),
        },
      })
      .catch(() => undefined);
    if (!taskResult?.data) {
      setStatus("error");
      setDetail(
        (await problem(taskResult)).detail ??
          intl.formatMessage({
            id: "settings.matterTemplateEditor.tasksSaveError",
            defaultMessage:
              "The template Tasks could not be saved. Earlier changes may already be saved.",
          }),
      );
      return;
    }
    setTemplate(taskResult.data.matterTemplate);

    const keyDateResult = await api
      .PUT("/api/v1/matter-templates/{id}/key-dates", {
        params: { path: { id: template.id } },
        body: {
          keyDates: keyDates.map((keyDate) => ({
            label: keyDate.label.trim(),
            offsetDays: Number(keyDate.offsetDays),
            note: keyDate.note.trim() || null,
          })),
        },
      })
      .catch(() => undefined);
    if (!keyDateResult?.data) {
      setStatus("error");
      setDetail(
        (await problem(keyDateResult)).detail ??
          intl.formatMessage({
            id: "settings.matterTemplateEditor.keyDatesSaveError",
            defaultMessage:
              "The template Key dates could not be saved. Earlier changes may already be saved.",
          }),
      );
      return;
    }
    setTemplate(keyDateResult.data.matterTemplate);
    setCustomFieldDrafts(
      initialCustomFieldDrafts(
        attachedFields,
        keyDateResult.data.matterTemplate.defaultCustomFields,
      ),
    );
    setTasks(
      keyDateResult.data.matterTemplate.tasks.map((task) => ({
        key: task.id || newDraftKey("task"),
        title: task.title,
        dueOffsetDays: task.dueOffsetDays === null ? "" : String(task.dueOffsetDays),
        assigneeRole: task.assigneeRole,
      })),
    );
    setKeyDates(
      keyDateResult.data.matterTemplate.keyDates.map((keyDate) => ({
        key: keyDate.id || newDraftKey("key-date"),
        label: keyDate.label,
        offsetDays: String(keyDate.offsetDays),
        note: keyDate.note ?? "",
      })),
    );
    setStatus("saved");
  }

  return (
    <>
      <PageTitle title={template.name} />
      <div className="flex w-full max-w-5xl flex-col gap-4">
        <MattersSettingsTabs />
        <Link
          to="/settings/matters/templates"
          className="flex w-fit items-center gap-1.5 text-sm text-muted hover:text-primary"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          <FormattedMessage
            id="settings.matterTemplateEditor.allTemplates"
            defaultMessage="All templates"
          />
        </Link>
        <div className="grid grid-cols-1 gap-4 @3xl/page:grid-cols-2">
          <SettingsCard
            title={
              <FormattedMessage
                id="settings.matterTemplateEditor.details"
                defaultMessage="Template details"
              />
            }
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="template-editor-name">
                <FormattedMessage id="settings.matterTemplateEditor.name" defaultMessage="Name" />
              </Label>
              <Input
                id="template-editor-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="template-editor-description">
                <FormattedMessage
                  id="settings.matterTemplateEditor.description"
                  defaultMessage="Description"
                />
              </Label>
              <textarea
                id="template-editor-description"
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="rounded-button border border-border-default bg-raised px-2.5 py-2 text-base text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
              />
            </div>
          </SettingsCard>
          <SettingsCard
            title={
              <FormattedMessage
                id="settings.matterTemplateEditor.defaults"
                defaultMessage="Matter defaults"
              />
            }
          >
            <p className="text-xs text-muted">
              <FormattedMessage
                id="settings.matterTemplateEditor.type"
                defaultMessage="Matter type: {name}"
                values={{ name: matterType?.displayName ?? template.matterTypeName }}
              />
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="template-editor-priority">
                  <FormattedMessage
                    id="settings.matterTemplateEditor.priority"
                    defaultMessage="Priority"
                  />
                </Label>
                <select
                  id="template-editor-priority"
                  value={defaultPriority}
                  onChange={(event) => setDefaultPriority(event.target.value as Severity | "")}
                  className="h-8 rounded-button border border-border-default bg-raised px-2 text-base text-primary"
                >
                  <option value="">
                    {intl.formatMessage({
                      id: "settings.matterTemplateEditor.noDefault",
                      defaultMessage: "No default",
                    })}
                  </option>
                  {SEVERITIES.map((severity) => (
                    <option key={severity} value={severity}>
                      {intl.formatMessage(SEVERITY_MESSAGES[severity])}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="template-editor-risk">
                  <FormattedMessage id="settings.matterTemplateEditor.risk" defaultMessage="Risk" />
                </Label>
                <select
                  id="template-editor-risk"
                  value={defaultRisk}
                  onChange={(event) => setDefaultRisk(event.target.value as Severity | "")}
                  className="h-8 rounded-button border border-border-default bg-raised px-2 text-base text-primary"
                >
                  <option value="">
                    {intl.formatMessage({
                      id: "settings.matterTemplateEditor.noDefault",
                      defaultMessage: "No default",
                    })}
                  </option>
                  {SEVERITIES.map((severity) => (
                    <option key={severity} value={severity}>
                      {intl.formatMessage(SEVERITY_MESSAGES[severity])}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="template-editor-prefix">
                <FormattedMessage
                  id="settings.matterTemplateEditor.titlePrefix"
                  defaultMessage="Title prefix"
                />
              </Label>
              <Input
                id="template-editor-prefix"
                value={titlePrefix}
                onChange={(event) => setTitlePrefix(event.target.value)}
              />
            </div>
          </SettingsCard>
        </div>
        <SettingsCard
          title={
            <FormattedMessage
              id="settings.matterTemplateEditor.customFields"
              defaultMessage="Custom field defaults"
            />
          }
        >
          {attachedFields.length === 0 && template.staleCustomFieldSlugs.length === 0 ? (
            <p className="text-base text-muted">
              <FormattedMessage
                id="settings.matterTemplateEditor.noCustomFields"
                defaultMessage="This Matter type has no custom fields."
              />
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 @3xl/page:grid-cols-2">
              {attachedFields.map((field) => {
                const controlId = `template-field-${field.fieldId}`;
                const descriptionId = field.description ? `${controlId}-description` : undefined;
                return (
                  <div key={field.fieldId} className="flex flex-col gap-1.5">
                    <Label id={`${controlId}-label`} htmlFor={controlId}>
                      {field.displayName}
                    </Label>
                    <CustomFieldControl
                      id={controlId}
                      field={field}
                      draft={customFieldDrafts[field.slug] ?? emptyDraft(field)}
                      disabled={status === "saving" || template.archivedAt !== null}
                      people={people}
                      entities={entities}
                      describedBy={descriptionId}
                      onDraft={(draft) =>
                        setCustomFieldDrafts((current) => ({
                          ...current,
                          [field.slug]: draft,
                        }))
                      }
                    />
                    {field.description && (
                      <p id={descriptionId} className="text-xs text-muted">
                        {field.description}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {template.staleCustomFieldSlugs.map((slug) => {
            const field = fieldCatalog.find((candidate) => candidate.slug === slug);
            const value = template.defaultCustomFields[slug];
            if (value === undefined) return null;
            return (
              <div
                key={slug}
                role="status"
                className="flex gap-2 rounded-card bg-status-warning-bg p-3 text-sm text-status-warning-fg"
              >
                <AlertTriangle className="mt-0.5 shrink-0" size={16} aria-hidden="true" />
                <p>
                  <FormattedMessage
                    id="settings.matterTemplateEditor.staleField"
                    defaultMessage="{field} is no longer attached to this Matter type. Its saved value ({value}) is retained."
                    values={{
                      field: field?.displayName ?? slug,
                      value: staleValueLabel(intl, value, field?.fieldType, people, entities),
                    }}
                  />
                </p>
              </div>
            );
          })}
        </SettingsCard>
        <TemplateTasksEditor
          rows={tasks}
          disabled={status === "saving" || template.archivedAt !== null}
          onChange={setTasks}
        />
        <TemplateKeyDatesEditor
          rows={keyDates}
          disabled={status === "saving" || template.archivedAt !== null}
          onChange={setKeyDates}
        />
        <div className="flex items-center justify-end gap-3">
          <StatusNote status={status} detail={detail} />
          <Button
            disabled={status === "saving" || template.archivedAt !== null}
            onClick={() => void save()}
          >
            <FormattedMessage
              id="settings.matterTemplateEditor.save"
              defaultMessage="Save template"
            />
          </Button>
        </div>
      </div>
    </>
  );
}
