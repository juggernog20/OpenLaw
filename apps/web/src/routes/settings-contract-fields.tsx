// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Contracts · Fields (#83), the shared CTR-016 field catalog scoped to
 * contract and global fields, per the ST11 frame of settings.pen: the
 * ListEditor in its DES-021 table variant — column header, no reorder
 * (the catalog is unordered; per-type attachment orders rendering), the
 * scope pill, the type and tag columns, and the sparkle marking fields
 * with an AI extraction prompt (CTR-008). Creation has seven dimensions
 * (two of them immutable), so add and edit go through the field-editor
 * dialog rather than an inline row; the name still renames in place
 * (DES-017). Archive is guarded but never blocked and never reassigns —
 * stored values are retained by rule (MTR-014), which the guard says
 * out loud. The loader is the client half of SET-002's gate; the API's
 * 403 is the real refusal.
 */

import { useRef, useState, type ReactNode } from "react";
import type { paths } from "@openlaw/api-client";
import { redirect, useLoaderData } from "react-router";
import { FormattedMessage, useIntl, type IntlShape } from "react-intl";
import { History, Pencil, Sparkles, TriangleAlert } from "lucide-react";
import { api } from "../lib/api";
import { problemDetail } from "../lib/messages";
import { currentUser, needsSetup } from "../lib/session";
import { ContractsSettingsTabs } from "../components/contracts-settings-tabs";
import { MattersSettingsTabs } from "../components/matters-settings-tabs";
import { ListEditor } from "../components/list-editor";
import { PageTitle } from "../components/page-title";
import { type FieldStatus } from "../components/status-note";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

async function settingsFieldsLoader(module: ModuleScope) {
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  if (user.role !== "administrator") return redirect("/settings/profile");
  const { data } = await api.GET("/api/v1/fields", {
    params: { query: { includeArchived: "true" } },
  });
  if (!data) throw new Error("The fields could not be read.");
  return {
    fields: data.fields.filter((field) => isFieldRow(field, module)),
  };
}

export function settingsContractFieldsLoader() {
  return settingsFieldsLoader("contract");
}

export function settingsMatterFieldsLoader() {
  return settingsFieldsLoader("matter");
}

/** The nine CTR-016 field types, immutable after creation. */
const FIELD_TYPES = [
  "text",
  "long_text",
  "number",
  "date",
  "boolean",
  "single_select",
  "multi_select",
  "user",
  "entity",
] as const;
type FieldType = (typeof FIELD_TYPES)[number];

/** The select types — the only ones that carry an options list. */
const SELECT_TYPES = new Set<FieldType>(["single_select", "multi_select"]);

/** The scopes this pane's picker offers (CTR-016): matter and entity
 * join with their milestones. */
type ModuleScope = "contract" | "matter";
type Scope = ModuleScope | "global";

const TAGS = ["business", "legal"] as const;
type Tag = (typeof TAGS)[number];

type ApiField =
  paths["/api/v1/fields"]["get"]["responses"]["200"]["content"]["application/json"]["fields"][number];
type FieldRow = ApiField & { moduleScope: Scope };

function isFieldRow(field: ApiField, module: ModuleScope): field is FieldRow {
  return field.moduleScope === module || field.moduleScope === "global";
}

function fieldRow(field: ApiField, module: ModuleScope): FieldRow {
  if (!isFieldRow(field, module)) {
    throw new Error(`A ${module} field operation returned a field outside this catalog.`);
  }
  return field;
}

function typeLabel(intl: IntlShape, fieldType: FieldType): string {
  return intl.formatMessage(
    {
      id: "settings.contractFields.typeLabel",
      defaultMessage:
        "{type, select, text {Text} long_text {Long text} number {Number} " +
        "date {Date} boolean {Boolean} single_select {Single select} " +
        "multi_select {Multi select} user {User} entity {Entity} other {Unknown}}",
    },
    { type: fieldType },
  );
}

function scopeLabel(intl: IntlShape, scope: Scope): string {
  return intl.formatMessage(
    {
      id: "settings.contractFields.scopeLabel",
      defaultMessage:
        "{scope, select, contract {Contract} matter {Matter} global {Global} other {Unknown}}",
    },
    { scope },
  );
}

function tagLabel(intl: IntlShape, tag: Tag): string {
  return intl.formatMessage(
    {
      id: "settings.contractFields.tagLabel",
      defaultMessage: "{tag, select, business {Business} legal {Legal} other {Unknown}}",
    },
    { tag },
  );
}

/** The shared form-control look (ST8 normalization, C10 field spec). */
const CONTROL_CLASS =
  "h-8 w-full rounded-button border border-border-default bg-raised px-2 text-sm " +
  "text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link";

const TEXTAREA_CLASS =
  "min-h-16 w-full rounded-button border border-border-default bg-raised p-2 text-sm " +
  "text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link";

/** What the editor dialog collects; the immutable dimensions only count
 * in create mode. */
interface EditorDraft {
  name: string;
  description: string;
  fieldType: FieldType | "";
  scope: Scope;
  tag: Tag;
  optionsText: string;
  aiPrompt: string;
}

function draftOf(target: FieldRow | null, module: ModuleScope): EditorDraft {
  if (!target) {
    return {
      name: "",
      description: "",
      fieldType: "",
      scope: module,
      tag: "business",
      optionsText: "",
      aiPrompt: "",
    };
  }
  return {
    name: target.displayName,
    description: target.description ?? "",
    fieldType: target.fieldType,
    scope: target.moduleScope,
    tag: target.fieldTag,
    optionsText: (target.options ?? []).join("\n"),
    aiPrompt: target.aiPrompt ?? "",
  };
}

/** One option per line, trimmed, empties dropped. */
function parseOptions(optionsText: string): string[] {
  return optionsText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function FieldEditorDialog({
  target,
  module,
  onOpenChange,
  onRowChanged,
  onCreated,
}: Readonly<{
  /** The field being edited, or null for create mode. */
  target: FieldRow | null;
  module: ModuleScope;
  onOpenChange: (open: boolean) => void;
  /** An edited row, after each successful step (scope, then the rest). */
  onRowChanged: (row: FieldRow) => void;
  onCreated: (row: FieldRow) => void;
}>) {
  const intl = useIntl();
  const [draft, setDraft] = useState<EditorDraft>(() => draftOf(target, module));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scopes: Scope[] = [module, "global"];

  const isSelect = draft.fieldType !== "" && SELECT_TYPES.has(draft.fieldType);
  // The prompt rides on contract-scoped fields only (CTR-008/CTR-016).
  const promptable = draft.scope === "contract";

  const set = <K extends keyof EditorDraft>(key: K, value: EditorDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  function refuse(message: string) {
    setError(message);
    setBusy(false);
  }

  async function create() {
    const options = parseOptions(draft.optionsText);
    const { data, error: problem } = await api
      .POST("/api/v1/fields", {
        body: {
          displayName: draft.name.trim(),
          description: draft.description.trim() || undefined,
          moduleScope: draft.scope,
          fieldType: draft.fieldType as FieldType,
          fieldTag: draft.tag,
          options: isSelect ? options : undefined,
          aiPrompt: promptable && draft.aiPrompt.trim() ? draft.aiPrompt.trim() : undefined,
        },
      })
      .catch(() => ({ data: null, error: undefined }));
    if (!data) {
      refuse(
        problemDetail(problem) ??
          intl.formatMessage({
            id: "settings.contractFields.createError",
            defaultMessage: "The field could not be created.",
          }),
      );
      return false;
    }
    onCreated(fieldRow(data.field, module));
    return true;
  }

  async function edit(existing: FieldRow) {
    let latest = existing;
    // Scope first: the prompt rules follow the scope the field ends on.
    if (draft.scope !== existing.moduleScope) {
      const { data, error: problem } = await api
        .PUT("/api/v1/fields/{id}/scope", {
          params: { path: { id: existing.id } },
          body: { moduleScope: draft.scope },
        })
        .catch(() => ({ data: null, error: undefined }));
      if (!data) {
        refuse(
          problemDetail(problem) ??
            intl.formatMessage({
              id: "settings.contractFields.editError",
              defaultMessage: "The field could not be saved.",
            }),
        );
        return false;
      }
      latest = fieldRow(data.field, module);
      onRowChanged(latest);
    }

    const body: Record<string, unknown> = {};
    const name = draft.name.trim();
    if (name !== latest.displayName) body.displayName = name;
    const description = draft.description.trim();
    if (description !== (latest.description ?? "")) body.description = description || null;
    if (draft.tag !== latest.fieldTag) body.fieldTag = draft.tag;
    if (isSelect) {
      const options = parseOptions(draft.optionsText);
      if (options.join("\n") !== (latest.options ?? []).join("\n")) body.options = options;
    }
    if (promptable) {
      const aiPrompt = draft.aiPrompt.trim();
      if (aiPrompt !== (latest.aiPrompt ?? "")) body.aiPrompt = aiPrompt || null;
    }
    if (Object.keys(body).length === 0) return true;

    const { data, error: problem } = await api
      .PATCH("/api/v1/fields/{id}", { params: { path: { id: latest.id } }, body })
      .catch(() => ({ data: null, error: undefined }));
    if (!data) {
      refuse(
        problemDetail(problem) ??
          intl.formatMessage({
            id: "settings.contractFields.editError",
            defaultMessage: "The field could not be saved.",
          }),
      );
      return false;
    }
    onRowChanged(fieldRow(data.field, module));
    return true;
  }

  async function submit() {
    if (busy) return;
    setError(null);
    if (draft.name.trim() === "") {
      refuse(
        intl.formatMessage({
          id: "settings.contractFields.nameMissing",
          defaultMessage: "Name the field.",
        }),
      );
      return;
    }
    if (target === null && draft.fieldType === "") {
      refuse(
        intl.formatMessage({
          id: "settings.contractFields.typeMissing",
          defaultMessage: "Pick a type for the new field.",
        }),
      );
      return;
    }
    if (isSelect && parseOptions(draft.optionsText).length === 0) {
      refuse(
        intl.formatMessage({
          id: "settings.contractFields.optionsMissing",
          defaultMessage: "Add at least one option, one per line.",
        }),
      );
      return;
    }
    setBusy(true);
    try {
      const done = target === null ? await create() : await edit(target);
      if (done) onOpenChange(false);
    } catch {
      setError(
        intl.formatMessage({
          id: "settings.contractFields.invalidResponse",
          defaultMessage: "The server returned a field outside this catalog.",
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          {target === null ? (
            <FormattedMessage id="settings.contractFields.addTitle" defaultMessage="Add field" />
          ) : (
            <FormattedMessage
              id="settings.contractFields.editTitle"
              defaultMessage="Edit {name}"
              values={{ name: target.displayName }}
            />
          )}
        </DialogTitle>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="field-name">
              <FormattedMessage id="settings.contractFields.nameLabel" defaultMessage="Name" />
            </Label>
            <Input
              id="field-name"
              autoFocus
              value={draft.name}
              onChange={(event) => set("name", event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="field-description">
              <FormattedMessage
                id="settings.contractFields.descriptionLabel"
                defaultMessage="Description"
              />
            </Label>
            <Input
              id="field-description"
              value={draft.description}
              onChange={(event) => set("description", event.target.value)}
            />
            <p className="text-xs text-muted">
              <FormattedMessage
                id="settings.contractFields.descriptionHelp"
                defaultMessage="Shown as help text wherever the field renders."
              />
            </p>
          </div>
          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="field-type">
                <FormattedMessage id="settings.contractFields.typeColumn" defaultMessage="Type" />
              </Label>
              {target === null ? (
                <select
                  id="field-type"
                  value={draft.fieldType}
                  className={CONTROL_CLASS}
                  onChange={(event) => {
                    set("fieldType", event.target.value as FieldType | "");
                    // Picking a type answers the pick-a-type refusal.
                    if (event.target.value !== "") setError(null);
                  }}
                >
                  <option value="">
                    {intl.formatMessage({
                      id: "settings.contractFields.typePlaceholder",
                      defaultMessage: "Type…",
                    })}
                  </option>
                  {FIELD_TYPES.map((fieldType) => (
                    <option key={fieldType} value={fieldType}>
                      {typeLabel(intl, fieldType)}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  <span className="flex h-8 items-center text-sm text-primary">
                    {typeLabel(intl, target.fieldType)}
                  </span>
                  <p className="text-xs text-muted">
                    <FormattedMessage
                      id="settings.contractFields.typeImmutable"
                      defaultMessage="The field type is immutable after creation."
                    />
                  </p>
                </>
              )}
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="field-scope">
                <FormattedMessage id="settings.contractFields.scopeColumn" defaultMessage="Scope" />
              </Label>
              <select
                id="field-scope"
                value={draft.scope}
                className={CONTROL_CLASS}
                onChange={(event) => set("scope", event.target.value as Scope)}
              >
                {scopes.map((scope) => (
                  <option key={scope} value={scope}>
                    {scopeLabel(intl, scope)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="field-tag">
                <FormattedMessage id="settings.contractFields.tagColumn" defaultMessage="Tag" />
              </Label>
              <select
                id="field-tag"
                value={draft.tag}
                className={CONTROL_CLASS}
                onChange={(event) => set("tag", event.target.value as Tag)}
              >
                {TAGS.map((tag) => (
                  <option key={tag} value={tag}>
                    {tagLabel(intl, tag)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {isSelect && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="field-options">
                <FormattedMessage
                  id="settings.contractFields.optionsLabel"
                  defaultMessage="Options"
                />
              </Label>
              <textarea
                id="field-options"
                value={draft.optionsText}
                className={TEXTAREA_CLASS}
                onChange={(event) => set("optionsText", event.target.value)}
              />
              <p className="text-xs text-muted">
                <FormattedMessage
                  id="settings.contractFields.optionsHelp"
                  defaultMessage="One option per line, in display order."
                />
              </p>
            </div>
          )}
          {promptable && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="field-ai-prompt">
                <FormattedMessage
                  id="settings.contractFields.aiPromptLabel"
                  defaultMessage="AI prompt"
                />
              </Label>
              <textarea
                id="field-ai-prompt"
                value={draft.aiPrompt}
                className={TEXTAREA_CLASS}
                onChange={(event) => set("aiPrompt", event.target.value)}
              />
              <p className="text-xs text-muted">
                <FormattedMessage
                  id="settings.contractFields.aiPromptHelp"
                  defaultMessage="Contract analysis extracts this field with the prompt. Leave empty to skip it."
                />
              </p>
            </div>
          )}
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
              {target === null ? (
                <FormattedMessage
                  id="settings.contractFields.createSubmit"
                  defaultMessage="Add field"
                />
              ) : (
                <FormattedMessage id="settings.contractFields.editSubmit" defaultMessage="Save" />
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveFieldDialog({
  target,
  module,
  onOpenChange,
  onArchived,
  onArchivedCloseFocus,
}: Readonly<{
  target: FieldRow;
  module: ModuleScope;
  onOpenChange: (open: boolean) => void;
  onArchived: (row: FieldRow) => void;
  /** Where focus lands after a successful archive — the row's archive
   * button unmounts with the row, so the default restore has no home. */
  onArchivedCloseFocus: () => void;
}>) {
  const intl = useIntl();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const archived = useRef(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { data, error: problem } = await api.POST("/api/v1/fields/{id}/archive", {
        params: { path: { id: target.id } },
      });
      if (data) {
        archived.current = true;
        onArchived(fieldRow(data.field, module));
        onOpenChange(false);
      } else {
        // The API's own refusal (already archived, a stale list) is
        // more actionable than any generic line.
        setError(
          problemDetail(problem) ??
            intl.formatMessage({
              id: "settings.contractFields.archiveError",
              defaultMessage: "The field could not be archived.",
            }),
        );
      }
    } catch {
      // A network-level failure never produces a problem envelope.
      setError(
        intl.formatMessage({
          id: "settings.contractFields.archiveError",
          defaultMessage: "The field could not be archived.",
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          if (!archived.current) return;
          event.preventDefault();
          onArchivedCloseFocus();
        }}
      >
        <DialogTitle>
          <FormattedMessage
            id="settings.contractFields.archiveTitle"
            defaultMessage="Archive {name}"
            values={{ name: target.displayName }}
          />
        </DialogTitle>
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex items-start gap-2 rounded-card bg-status-warning-bg p-3 text-sm text-status-warning-fg">
            <TriangleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            {/* Fields never reassign and never block: everything is
                retained by rule (MTR-014), which is the whole message.
                The count is type attachments until the record
                milestones (M8, M22) add records holding values — the
                copy revisits then. */}
            <p>
              <FormattedMessage
                id="settings.contractFields.archiveWarning"
                defaultMessage={
                  "{count, plural, =0 {{name} is not attached to any type. The definition " +
                  "is kept and the field can be restored.} one {{name} is attached to " +
                  "# type — the attachment is kept, hidden until the field is restored.} " +
                  "other {{name} is attached to # types — the attachments are kept, " +
                  "hidden until the field is restored.}}"
                }
                values={{ name: target.displayName, count: target.inUseCount }}
              />
            </p>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <History size={16} aria-hidden="true" />
            <FormattedMessage
              id="settings.contractFields.auditNote"
              defaultMessage="The change applies immediately and is recorded in the audit log."
            />
          </p>
          {error && (
            <p role="alert" className="text-xs text-status-danger-fg">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="button" variant="danger" disabled={busy} onClick={() => void submit()}>
              <FormattedMessage
                id="settings.contractFields.archiveSubmit"
                defaultMessage="Archive field"
              />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingsFieldsPage({
  initialFields,
  module,
  tabs,
}: Readonly<{ initialFields: FieldRow[]; module: ModuleScope; tabs: ReactNode }>) {
  const intl = useIntl();

  const [rows, setRows] = useState<FieldRow[]>(initialFields);
  const [rowStatus, setRowStatus] = useState<Record<string, FieldStatus>>({});
  const [rowError, setRowError] = useState<Record<string, string | undefined>>({});
  /** The editor dialog: closed, create mode, or an edit target. */
  const [editor, setEditor] = useState<{ target: FieldRow | null } | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<FieldRow | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // The catalog is unordered (no display order — attachment order rules
  // rendering once types attach fields); the list keeps creation order.
  const live = rows.filter((row) => !row.archivedAt);
  const archived = rows.filter((row) => row.archivedAt);

  function noteRow(id: string, status: FieldStatus, detail?: string) {
    setRowStatus((current) => ({ ...current, [id]: status }));
    setRowError((current) => ({ ...current, [id]: detail }));
  }

  function replaceRow(row: FieldRow) {
    setRows((current) => current.map((existing) => (existing.id === row.id ? row : existing)));
  }

  async function rename(row: FieldRow, displayName: string) {
    noteRow(row.id, "saving");
    const { data, error } = await api
      .PATCH("/api/v1/fields/{id}", {
        params: { path: { id: row.id } },
        body: { displayName },
      })
      .catch(() => ({ data: null, error: undefined }));
    if (data) {
      replaceRow(fieldRow(data.field, module));
      noteRow(row.id, "saved");
    } else {
      noteRow(row.id, "error", problemDetail(error));
    }
  }

  async function restore(row: FieldRow) {
    noteRow(row.id, "saving");
    const { data, error } = await api
      .POST("/api/v1/fields/{id}/restore", { params: { path: { id: row.id } } })
      .catch(() => ({ data: null, error: undefined }));
    if (data) {
      replaceRow(fieldRow(data.field, module));
      noteRow(row.id, "saved");
    } else {
      noteRow(row.id, "error", problemDetail(error));
    }
  }

  /** The ST11 scope pill: neutral for module scopes, info for global.
   * The sr-only prefix keeps a field named Contract unambiguous. */
  function scopePill(row: FieldRow) {
    return (
      <span
        className={`inline-flex rounded-pill px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${
          row.moduleScope === "global"
            ? "bg-status-info-bg text-status-info-fg"
            : "bg-status-neutral-bg text-status-neutral-fg"
        }`}
      >
        <span className="sr-only">
          <FormattedMessage id="settings.contractFields.scopePrefix" defaultMessage="Scope:" />{" "}
        </span>
        {scopeLabel(intl, row.moduleScope)}
      </span>
    );
  }

  /** The ST11 table cells after the name: type, scope, tag, sparkle. */
  function rowDetails(row: FieldRow) {
    return (
      <>
        <span className="w-24 shrink-0 text-sm whitespace-nowrap text-muted">
          <span className="sr-only">
            <FormattedMessage id="settings.contractFields.typePrefix" defaultMessage="Type:" />{" "}
          </span>
          {typeLabel(intl, row.fieldType)}
        </span>
        <span className="w-24 shrink-0">{scopePill(row)}</span>
        <span className="w-20 shrink-0 text-sm whitespace-nowrap text-muted">
          <span className="sr-only">
            <FormattedMessage id="settings.contractFields.tagPrefix" defaultMessage="Tag:" />{" "}
          </span>
          {tagLabel(intl, row.fieldTag)}
        </span>
        <span className="flex w-16 shrink-0 items-center">
          {row.aiPrompt ? (
            <Sparkles
              size={16}
              role="img"
              aria-label={intl.formatMessage(
                {
                  id: "settings.contractFields.hasPrompt",
                  defaultMessage: "{name} has an AI extraction prompt",
                },
                { name: row.displayName },
              )}
              className="text-status-info-fg"
            />
          ) : (
            <>
              <span aria-hidden="true" className="text-sm text-muted">
                —
              </span>
              <span className="sr-only">
                <FormattedMessage
                  id="settings.contractFields.noPrompt"
                  defaultMessage="No AI prompt"
                />
              </span>
            </>
          )}
        </span>
      </>
    );
  }

  return (
    <>
      <PageTitle
        title={intl.formatMessage({
          id: "settings.contractFields.pageTitle",
          defaultMessage: "Fields",
        })}
      />
      <div className="flex w-full max-w-(--width-settings-card) flex-col gap-4">
        {tabs}
        <ListEditor
          rows={live}
          archivedRows={archived}
          title={<FormattedMessage id="settings.contractFields.title" defaultMessage="Fields" />}
          headerCaption={
            <FormattedMessage
              id="settings.contractFields.scopeCaption"
              defaultMessage="{module, select, contract {Contract} matter {Matter} other {Module}} and global fields"
              values={{ module }}
            />
          }
          count={
            <FormattedMessage
              id="settings.contractFields.count"
              defaultMessage="{count, plural, one {# field} other {# fields}}"
              values={{ count: live.length }}
            />
          }
          addLabel={
            <FormattedMessage id="settings.contractFields.add" defaultMessage="Add field" />
          }
          onAdd={() => setEditor({ target: null })}
          help={
            <FormattedMessage
              id="settings.contractFields.help"
              defaultMessage={
                "Field type is immutable after creation. Archiving a field keeps stored " +
                "values. Global fields are shared across modules — the sparkle marks fields " +
                "with a contract AI extraction prompt."
              }
            />
          }
          columnsHeader={
            <div className="flex h-8 items-center border-b border-border-default pe-3 text-xs font-semibold text-muted">
              <span className="flex min-w-0 flex-1 items-center gap-2 ps-4">
                <span className="min-w-0 flex-1">
                  <FormattedMessage
                    id="settings.contractFields.fieldColumn"
                    defaultMessage="Field"
                  />
                </span>
                <span className="w-24 shrink-0">
                  <FormattedMessage id="settings.contractFields.typeColumn" defaultMessage="Type" />
                </span>
                <span className="w-24 shrink-0">
                  <FormattedMessage
                    id="settings.contractFields.scopeColumn"
                    defaultMessage="Scope"
                  />
                </span>
                <span className="w-20 shrink-0">
                  <FormattedMessage id="settings.contractFields.tagColumn" defaultMessage="Tag" />
                </span>
                <span className="w-16 shrink-0">
                  <FormattedMessage
                    id="settings.contractFields.promptColumn"
                    defaultMessage="AI prompt"
                  />
                </span>
              </span>
              {/* The trailing-action column has no header (ST11). */}
              <span className="w-15" aria-hidden="true" />
            </div>
          }
          rowStatus={rowStatus}
          rowError={rowError}
          renameLabel={(row) =>
            intl.formatMessage(
              { id: "settings.contractFields.renameLabel", defaultMessage: "Rename {name}" },
              { name: row.displayName },
            )
          }
          onRename={(row, displayName) => void rename(row, displayName)}
          rowDetails={rowDetails}
          nameSlotClassName="min-w-0 flex-1"
          rowActions={(row) =>
            row.archivedAt ? null : (
              <Button
                variant="ghost"
                size="sm"
                className="px-1.5"
                disabled={rowStatus[row.id] === "saving"}
                aria-label={intl.formatMessage(
                  { id: "settings.contractFields.edit", defaultMessage: "Edit {name}" },
                  { name: row.displayName },
                )}
                onClick={() => setEditor({ target: row })}
              >
                <Pencil size={16} aria-hidden="true" className="text-muted" />
              </Button>
            )
          }
          archiveLabel={(row) =>
            intl.formatMessage(
              { id: "settings.contractFields.archive", defaultMessage: "Archive {name}" },
              { name: row.displayName },
            )
          }
          onArchive={setArchiveTarget}
          restoreLabel={(row) =>
            intl.formatMessage(
              { id: "settings.contractFields.restore", defaultMessage: "Restore {name}" },
              { name: row.displayName },
            )
          }
          onRestore={(row) => void restore(row)}
          listRef={listRef}
        />
      </div>
      {editor && (
        <FieldEditorDialog
          target={editor.target}
          module={module}
          onOpenChange={(open) => {
            if (!open) setEditor(null);
          }}
          onRowChanged={replaceRow}
          onCreated={(row) => setRows((current) => [...current, row])}
        />
      )}
      {archiveTarget && (
        <ArchiveFieldDialog
          target={archiveTarget}
          module={module}
          onOpenChange={(open) => {
            if (!open) setArchiveTarget(null);
          }}
          onArchived={replaceRow}
          onArchivedCloseFocus={() => listRef.current?.focus()}
        />
      )}
    </>
  );
}

export function SettingsContractFieldsPage() {
  const { fields } = useLoaderData<typeof settingsContractFieldsLoader>();
  return (
    <SettingsFieldsPage initialFields={fields} module="contract" tabs={<ContractsSettingsTabs />} />
  );
}

export function SettingsMatterFieldsPage() {
  const { fields } = useLoaderData<typeof settingsMatterFieldsLoader>();
  return (
    <SettingsFieldsPage initialFields={fields} module="matter" tabs={<MattersSettingsTabs />} />
  );
}
