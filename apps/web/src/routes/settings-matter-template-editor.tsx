// SPDX-License-Identifier: AGPL-3.0-only

/** ST21 Matter-template editor for reusable defaults, tasks, and key dates. */

import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { Link, redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import type { paths } from "@openlaw/api-client";
import { api } from "../lib/api";
import { problemDetail } from "../lib/messages";
import { currentUser, needsSetup } from "../lib/session";
import { MattersSettingsTabs } from "../components/matters-settings-tabs";
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
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  if (user.role !== "administrator") return redirect("/settings/profile");
  const [templates, types] = await Promise.all([
    api.GET("/api/v1/matter-templates", {
      params: { query: { includeArchived: "true" } },
    }),
    api.GET("/api/v1/matter-types", { params: { query: { includeArchived: "true" } } }),
  ]);
  if (!templates.data || !types.data) throw new Error("The Matter template could not be read.");
  const matterTemplate = templates.data.matterTemplates.find(
    (template) => template.id === params.templateId,
  );
  if (!matterTemplate)
    throw new Response("No Matter template exists with this id.", { status: 404 });
  return {
    matterTemplate,
    matterType: types.data.matterTypes.find((type) => type.id === matterTemplate.matterTypeId),
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

export function SettingsMatterTemplateEditorPage() {
  const { matterTemplate, matterType } = useLoaderData<typeof settingsMatterTemplateEditorLoader>();
  const intl = useIntl();
  const [template, setTemplate] = useState(matterTemplate);
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? "");
  const [defaultPriority, setDefaultPriority] = useState<Severity | "">(
    template.defaultPriority ?? "",
  );
  const [defaultRisk, setDefaultRisk] = useState<Severity | "">(template.defaultRisk ?? "");
  const [titlePrefix, setTitlePrefix] = useState(template.titlePrefix ?? "");
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
    setStatus("saving");
    setDetail(null);
    const { data, error } = await api
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
      .catch(() => ({ data: null, error: undefined }));
    if (!data) {
      setStatus("error");
      setDetail(
        problemDetail(error) ??
          intl.formatMessage({
            id: "settings.matterTemplateEditor.saveError",
            defaultMessage: "The Matter template could not be saved.",
          }),
      );
      return;
    }
    setTemplate(data.matterTemplate);

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
      .catch(() => ({ data: null, error: undefined }));
    if (!taskResult.data) {
      setStatus("error");
      setDetail(
        problemDetail(taskResult.error) ??
          intl.formatMessage({
            id: "settings.matterTemplateEditor.tasksSaveError",
            defaultMessage: "The template tasks could not be saved.",
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
      .catch(() => ({ data: null, error: undefined }));
    if (!keyDateResult.data) {
      setStatus("error");
      setDetail(
        problemDetail(keyDateResult.error) ??
          intl.formatMessage({
            id: "settings.matterTemplateEditor.keyDatesSaveError",
            defaultMessage: "The template key dates could not be saved.",
          }),
      );
      return;
    }
    setTemplate(keyDateResult.data.matterTemplate);
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
