// SPDX-License-Identifier: AGPL-3.0-only

/** The M8 create-matter dialog, with all type-driven fields redrawn on type change. */
import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../../lib/api";
import {
  emptyDraft,
  toDraft,
  toValue,
  type CustomFieldDraft,
  type CustomFieldValue,
} from "../../lib/custom-fields";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "../../lib/form-controls";
import {
  MATTER_SEVERITIES,
  matterSeverityLabel,
  matterReference,
  type MatterRow,
  type MatterTypeOption,
  type MatterUserOption,
} from "../../lib/matters";
import { problemDetail } from "../../lib/messages";
import { ConfidentialToggle } from "../confidential-toggle";
import { CustomFieldControl, type FieldReference } from "../custom-field-control";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

function isMatterSeverity(value: string): value is MatterRow["priority"] {
  return value === "low" || value === "medium" || value === "high" || value === "critical";
}

export function CreateMatterDialog({
  matterTypes,
  users,
  entities,
  parent,
  onOpenChange,
  onCreated,
}: Readonly<{
  matterTypes: MatterTypeOption[];
  users: MatterUserOption[];
  entities: readonly FieldReference[];
  parent?: Readonly<{ number: number; title: string }>;
  onOpenChange: (open: boolean) => void;
  onCreated: (matter: MatterRow) => void;
}>) {
  const intl = useIntl();
  const [title, setTitle] = useState("");
  const [matterTypeId, setMatterTypeId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [managerId, setManagerId] = useState("");
  const [priority, setPriority] = useState<MatterRow["priority"]>("medium");
  const [risk, setRisk] = useState<MatterRow["risk"]>(null);
  const [description, setDescription] = useState("");
  const [drafts, setDrafts] = useState<Record<string, CustomFieldDraft>>({});
  const [confidential, setConfidential] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fields = matterTypes.find((type) => type.id === matterTypeId)?.fields ?? [];
  const selectedType = matterTypes.find((type) => type.id === matterTypeId);
  const templates = selectedType?.templates ?? [];
  const selectedTemplate = templates.find((template) => template.id === templateId);
  const people = users.map((person) => ({
    id: person.id,
    label: person.displayName,
    archived: person.archived,
  }));
  const managers = users.filter(
    (person) => person.role === "administrator" || person.role === "legal_team_member",
  );

  /**
   * Re-seed the form from a template, or from none. Priority, risk, and
   * the custom-field drafts always follow the new template. The title
   * follows only while it is blank or still the previous template's
   * prefix, so a title the person typed survives a template or type
   * switch.
   */
  function seedTemplate(type: MatterTypeOption | undefined, nextTemplateId: string) {
    const template = type?.templates?.find((candidate) => candidate.id === nextTemplateId);
    setTemplateId(template?.id ?? "");
    const untouched = title.trim() === "" || title === (selectedTemplate?.titlePrefix ?? "");
    if (untouched) setTitle(template?.titlePrefix ?? "");
    setPriority(template?.defaultPriority ?? "medium");
    setRisk(template?.defaultRisk ?? null);
    setDrafts(
      Object.fromEntries(
        (type?.fields ?? []).map((field) => [
          field.slug,
          toDraft(field, template?.defaultCustomFields[field.slug]),
        ]),
      ),
    );
  }

  async function submit() {
    if (busy) return;
    const missing: string[] = [];
    if (!title.trim())
      missing.push(intl.formatMessage({ id: "matters.field.title", defaultMessage: "Title" }));
    if (!matterTypeId)
      missing.push(intl.formatMessage({ id: "matters.field.type", defaultMessage: "Matter type" }));
    const customFields: Record<string, CustomFieldValue> = {};
    const invalidNumbers: string[] = [];
    for (const field of fields) {
      const parsed = toValue(field, drafts[field.slug] ?? emptyDraft(field));
      if ("error" in parsed) invalidNumbers.push(field.displayName);
      else if (parsed.value !== null) customFields[field.slug] = parsed.value;
      else if (field.isRequired) missing.push(field.displayName);
    }
    if (invalidNumbers.length || missing.length) {
      const pieces = [
        missing.length
          ? intl.formatMessage(
              { id: "matters.validation.missing", defaultMessage: "Fill {fields}." },
              { fields: missing.join(", ") },
            )
          : "",
        invalidNumbers.length
          ? intl.formatMessage(
              {
                id: "matters.validation.number",
                defaultMessage: "Enter {fields} as a number.",
              },
              { fields: invalidNumbers.join(", ") },
            )
          : "",
      ].filter(Boolean);
      setError(pieces.join(" "));
      return;
    }
    setBusy(true);
    const { data, error: problem } = await api
      .POST("/api/v1/matters", {
        body: {
          title: title.trim(),
          matterTypeId,
          managerId: managerId || null,
          priority,
          risk,
          description: description.trim() || null,
          customFields,
          ...(templateId ? { templateId } : {}),
          isConfidential: confidential,
          ...(parent ? { parentMatterNumber: parent.number } : {}),
        },
      })
      .catch(() => ({ data: undefined, error: undefined }));
    setBusy(false);
    if (!data) {
      setError(
        problemDetail(problem) ??
          intl.formatMessage({
            id: "matters.createFailed",
            defaultMessage: "The matter could not be created.",
          }),
      );
      return;
    }
    onCreated(data.matter);
    onOpenChange(false);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          {parent ? (
            <FormattedMessage
              id="matters.create.subMatterTitle"
              defaultMessage="Create sub-Matter"
            />
          ) : (
            <FormattedMessage id="matters.create.title" defaultMessage="Create matter" />
          )}
        </DialogTitle>
        {parent && (
          <p className="mt-2 text-sm text-muted">
            <FormattedMessage
              id="matters.create.parent"
              defaultMessage="Parent: {reference} {title}"
              values={{ reference: matterReference(intl, parent.number), title: parent.title }}
            />
          </p>
        )}
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="matter-new-title">
              <FormattedMessage id="matters.field.title" defaultMessage="Title" />
            </Label>
            <Input
              id="matter-new-title"
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="matter-new-type">
              <FormattedMessage id="matters.field.type" defaultMessage="Matter type" />
            </Label>
            <select
              id="matter-new-type"
              className={CONTROL_CLASS}
              value={matterTypeId}
              onChange={(event) => {
                const nextType = matterTypes.find((type) => type.id === event.target.value);
                setMatterTypeId(event.target.value);
                const nextTemplates = nextType?.templates ?? [];
                if (nextTemplates.length === 1) seedTemplate(nextType, nextTemplates[0]!.id);
                else if (templateId) seedTemplate(nextType, "");
                else setTemplateId("");
                setError(null);
              }}
            >
              <option value="">
                {intl.formatMessage({ id: "matters.typePlaceholder", defaultMessage: "Type…" })}
              </option>
              {matterTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.displayName}
                </option>
              ))}
            </select>
          </div>
          {selectedType && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="matter-new-template">
                <FormattedMessage
                  id="matters.field.template"
                  defaultMessage="Template (optional)"
                />
              </Label>
              <select
                id="matter-new-template"
                className={CONTROL_CLASS}
                value={templateId}
                onChange={(event) => {
                  seedTemplate(selectedType, event.target.value);
                  setError(null);
                }}
              >
                <option value="">
                  {intl.formatMessage({
                    id: "matters.template.none",
                    defaultMessage: "No template",
                  })}
                </option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
              {selectedTemplate && (
                <p className="text-xs text-muted">
                  <FormattedMessage
                    id="matters.template.contentHint"
                    defaultMessage="Template adds {taskCount, plural, one {# task} other {# tasks}} and {keyDateCount, plural, one {# key date} other {# key dates}}."
                    values={{
                      taskCount: selectedTemplate.taskCount,
                      keyDateCount: selectedTemplate.keyDateCount,
                    }}
                  />
                </p>
              )}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="matter-new-manager">
              <FormattedMessage id="matters.field.manager" defaultMessage="Matter Manager" />
            </Label>
            <select
              id="matter-new-manager"
              className={CONTROL_CLASS}
              value={managerId}
              onChange={(event) => setManagerId(event.target.value)}
            >
              <option value="">
                {intl.formatMessage({ id: "matters.unassigned", defaultMessage: "Unassigned" })}
              </option>
              {managers.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="matter-new-priority">
                <FormattedMessage id="matters.field.priority" defaultMessage="Priority" />
              </Label>
              <select
                id="matter-new-priority"
                className={CONTROL_CLASS}
                value={priority}
                onChange={(event) => {
                  if (isMatterSeverity(event.target.value)) setPriority(event.target.value);
                }}
              >
                {MATTER_SEVERITIES.map((level) => (
                  <option key={level} value={level}>
                    {matterSeverityLabel(intl, level)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="matter-new-risk">
                <FormattedMessage id="matters.field.risk" defaultMessage="Risk" />
              </Label>
              <select
                id="matter-new-risk"
                className={CONTROL_CLASS}
                value={risk ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "" || isMatterSeverity(value)) setRisk(value || null);
                }}
              >
                <option value="">
                  {intl.formatMessage({
                    id: "matters.notAssessed",
                    defaultMessage: "Not assessed",
                  })}
                </option>
                {MATTER_SEVERITIES.map((level) => (
                  <option key={level} value={level}>
                    {matterSeverityLabel(intl, level)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {fields.map((field) => (
            <div key={field.slug} className="flex flex-col gap-1.5">
              <Label htmlFor={`matter-new-${field.slug}`}>
                {field.displayName}
                {field.isRequired ? " *" : ""}
              </Label>
              <CustomFieldControl
                id={`matter-new-${field.slug}`}
                field={field}
                draft={drafts[field.slug] ?? emptyDraft(field)}
                people={people}
                entities={entities}
                required={field.isRequired}
                onDraft={(draft) => {
                  setDrafts((current) => ({ ...current, [field.slug]: draft }));
                  setError(null);
                }}
              />
              {field.description && <p className="text-xs text-muted">{field.description}</p>}
            </div>
          ))}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="matter-new-description">
              <FormattedMessage id="matters.field.description" defaultMessage="Description" />
            </Label>
            <textarea
              id="matter-new-description"
              className={TEXTAREA_CLASS}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <ConfidentialToggle
            id="matter-new-confidential"
            record="matter"
            confidential={confidential}
            onChange={setConfidential}
          />
          {error && (
            <p role="alert" className="text-xs text-status-danger-fg">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="submit" disabled={busy}>
              <FormattedMessage id="matters.create.submit" defaultMessage="Create" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
