// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The type editor screen (#85: one machinery, every type editor), from
 * the ST15/ST16 frames of settings.pen (DES-022): one taxonomy type's
 * own screen, reached from its row on a Types pane. The left card
 * edits identity — display name and description on DES-017
 * commit-on-confirm inputs, the immutable slug as a fact — and the
 * right card is the attachment surface: catalog fields in per-type
 * order with drag or arrow-key reorder, a per-attachment required
 * checkbox, detach, and an Attach menu over the module's attachable
 * catalog fields. Every change applies immediately on save (SET-003).
 * Each module's editor mounts this with its own vocabulary and API
 * adapter — the contract (CTR-016) and matter (MTR-011) editors are
 * configuration, not copies.
 */

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { FormattedMessage, useIntl, type IntlShape, type MessageDescriptor } from "react-intl";
import { ArrowLeft, GripVertical, Plus, X } from "lucide-react";
import { PageTitle } from "./page-title";
import { SettingsCard } from "./settings-card";
import { StatusNote, type FieldStatus } from "./status-note";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import type { ApiResult } from "../lib/api-result";

/** The single-type read behind the editor, as the client sees it. */
export interface EditorTypeRow {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  archivedAt: string | null;
  inUseCount: number;
}

export type EditorFieldType =
  | "text"
  | "long_text"
  | "number"
  | "date"
  | "boolean"
  | "single_select"
  | "multi_select"
  | "user"
  | "entity";

/** One attached field, as the editor renders it. */
export interface AttachedFieldRow {
  fieldId: string;
  slug: string;
  displayName: string;
  fieldType: EditorFieldType;
  moduleScope: string;
  displayOrder: number;
  isRequired: boolean;
}

/** One catalog row the Attach menu offers. */
export interface EditorCatalogRow {
  id: string;
  displayName: string;
  moduleScope: string;
  fieldType: EditorFieldType;
}

/** The API seam each module's editor implements over its own routes. */
export interface TypeEditorApi {
  update(
    id: string,
    body: { displayName?: string; description?: string | null },
  ): Promise<ApiResult<EditorTypeRow>>;
  attach(id: string, fieldId: string): Promise<ApiResult<AttachedFieldRow>>;
  detach(id: string, fieldId: string): Promise<{ ok: boolean; detail?: string }>;
  setRequired(
    id: string,
    fieldId: string,
    isRequired: boolean,
  ): Promise<ApiResult<AttachedFieldRow>>;
  reorder(id: string, fieldIds: string[]): Promise<ApiResult<AttachedFieldRow[]>>;
}

/** The editor's vocabulary, defined per module with `defineMessages`. */
export interface TypeEditorMessages {
  allTypes: MessageDescriptor;
  displayName: MessageDescriptor;
  description: MessageDescriptor;
  slug: MessageDescriptor;
  slugNote: MessageDescriptor;
  inUse: MessageDescriptor;
  attachedFields: MessageDescriptor;
  fieldColumn: MessageDescriptor;
  requiredColumn: MessageDescriptor;
  requiredFor: MessageDescriptor;
  detach: MessageDescriptor;
  detached: MessageDescriptor;
  attach: MessageDescriptor;
  allAttached: MessageDescriptor;
  empty: MessageDescriptor;
  reorder: MessageDescriptor;
  moved: MessageDescriptor;
  globalCaption: MessageDescriptor;
  help: MessageDescriptor;
}

/** The Fields pane's vocabulary, reused verbatim across modules (one
 * id, one label — the field-type names are module-neutral). */
function typeLabel(intl: IntlShape, fieldType: EditorFieldType): string {
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

export function TypeEditorScreen({
  initialType,
  initialAttached,
  catalog,
  tabs,
  backPath,
  api,
  messages,
}: Readonly<{
  initialType: EditorTypeRow;
  initialAttached: AttachedFieldRow[];
  /** The module's attachable catalog (live fields, already scoped). */
  catalog: EditorCatalogRow[];
  /** The module's section head (title + tab strip). */
  tabs: ReactNode;
  /** The Types pane this editor was reached from. */
  backPath: string;
  api: TypeEditorApi;
  messages: TypeEditorMessages;
}>) {
  const intl = useIntl();

  /** The ST16 field caption: the type, with the scope riding along only
   * when it is global — "Single select · global". */
  function fieldCaption(row: { fieldType: EditorFieldType; moduleScope: string }) {
    const label = typeLabel(intl, row.fieldType);
    return row.moduleScope === "global"
      ? intl.formatMessage(messages.globalCaption, { type: label })
      : label;
  }

  const [saved, setSaved] = useState<EditorTypeRow>(initialType);
  const [nameDraft, setNameDraft] = useState(saved.displayName);
  const [descriptionDraft, setDescriptionDraft] = useState(saved.description ?? "");
  const [typeStatus, setTypeStatus] = useState<Record<"name" | "description", FieldStatus>>({
    name: "idle",
    description: "idle",
  });
  const [typeError, setTypeError] = useState<Record<"name" | "description", string | undefined>>({
    name: undefined,
    description: undefined,
  });

  const [rows, setRows] = useState<AttachedFieldRow[]>(initialAttached);
  const [rowStatus, setRowStatus] = useState<Record<string, FieldStatus>>({});
  const [rowError, setRowError] = useState<Record<string, string | undefined>>({});
  const [orderStatus, setOrderStatus] = useState<FieldStatus>("idle");
  const [orderError, setOrderError] = useState<string | undefined>(undefined);
  const [attachStatus, setAttachStatus] = useState<FieldStatus>("idle");
  const [attachError, setAttachError] = useState<string | undefined>(undefined);
  const [announcement, setAnnouncement] = useState("");
  const dragFrom = useRef<number | null>(null);

  const attachable: EditorCatalogRow[] = catalog.filter(
    (field) => !rows.some((row) => row.fieldId === field.id),
  );

  function noteRow(fieldId: string, status: FieldStatus, detail?: string) {
    setRowStatus((current) => ({ ...current, [fieldId]: status }));
    setRowError((current) => ({ ...current, [fieldId]: detail }));
  }

  /** One PATCH per committed identity field (DES-017). */
  async function commitType(
    key: "name" | "description",
    body: { displayName?: string; description?: string | null },
  ) {
    setTypeStatus((current) => ({ ...current, [key]: "saving" }));
    const { data, detail } = await api
      .update(saved.id, body)
      .catch(() => ({ data: undefined, detail: undefined }));
    if (data) {
      setSaved(data);
      setNameDraft(data.displayName);
      setDescriptionDraft(data.description ?? "");
      setTypeStatus((current) => ({ ...current, [key]: "saved" }));
      setTypeError((current) => ({ ...current, [key]: undefined }));
    } else {
      setTypeStatus((current) => ({ ...current, [key]: "error" }));
      setTypeError((current) => ({ ...current, [key]: detail }));
    }
  }

  function commitName() {
    const displayName = nameDraft.trim();
    if (displayName === "" || displayName === saved.displayName) {
      // Nothing to save (or nothing valid): revert per DES-017.
      setNameDraft(saved.displayName);
      return;
    }
    void commitType("name", { displayName });
  }

  function commitDescription() {
    const description = descriptionDraft.trim();
    if (description === (saved.description ?? "")) {
      setDescriptionDraft(saved.description ?? "");
      return;
    }
    void commitType("description", { description: description || null });
  }

  async function attach(field: EditorCatalogRow) {
    setAttachStatus("saving");
    setAttachError(undefined);
    const { data, detail } = await api
      .attach(saved.id, field.id)
      .catch(() => ({ data: undefined, detail: undefined }));
    if (data) {
      setRows((current) => [...current, data]);
      setAttachStatus("saved");
    } else {
      setAttachStatus("error");
      setAttachError(detail);
    }
  }

  async function detach(row: AttachedFieldRow) {
    noteRow(row.fieldId, "saving");
    const { ok, detail } = await api
      .detach(saved.id, row.fieldId)
      .catch(() => ({ ok: false, detail: undefined }));
    if (ok) {
      setRows((current) => current.filter((existing) => existing.fieldId !== row.fieldId));
      noteRow(row.fieldId, "idle");
      setAnnouncement(intl.formatMessage(messages.detached, { name: row.displayName }));
    } else {
      noteRow(row.fieldId, "error", detail);
    }
  }

  async function toggleRequired(row: AttachedFieldRow, isRequired: boolean) {
    noteRow(row.fieldId, "saving");
    const { data, detail } = await api
      .setRequired(saved.id, row.fieldId, isRequired)
      .catch(() => ({ data: undefined, detail: undefined }));
    if (data) {
      setRows((current) =>
        current.map((existing) => (existing.fieldId === row.fieldId ? data : existing)),
      );
      noteRow(row.fieldId, "saved");
    } else {
      noteRow(row.fieldId, "error", detail);
    }
  }

  /** One validated move from the grip (arrow key or drop) — commit the
   * permutation and announce the landing position (DES-020). */
  async function move(fromIndex: number, toIndex: number) {
    if (toIndex < 0 || toIndex >= rows.length || fromIndex === toIndex) return;
    if (orderStatus === "saving") return;
    const row = rows[fromIndex]!;
    const fieldIds = rows.map(({ fieldId }) => fieldId);
    fieldIds.splice(fromIndex, 1);
    fieldIds.splice(toIndex, 0, row.fieldId);

    setOrderStatus("saving");
    setOrderError(undefined);
    const { data, detail } = await api
      .reorder(saved.id, fieldIds)
      .catch(() => ({ data: undefined, detail: undefined }));
    if (data) {
      setRows(data);
      setOrderStatus("saved");
      setAnnouncement(
        intl.formatMessage(messages.moved, {
          name: row.displayName,
          position: toIndex + 1,
          total: rows.length,
        }),
      );
    } else {
      setOrderStatus("error");
      setOrderError(detail);
    }
  }

  function drop(event: DragEvent, targetIndex: number) {
    event.preventDefault();
    const from = dragFrom.current;
    dragFrom.current = null;
    if (from === null || from === targetIndex) return;
    void move(from, targetIndex);
  }

  return (
    <>
      <PageTitle title={saved.displayName} />
      <div className="flex w-full max-w-270 flex-col gap-4">
        {tabs}
        <Link
          to={backPath}
          className="flex w-fit items-center gap-1.5 rounded-chip text-sm font-medium text-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          <FormattedMessage {...messages.allTypes} />
        </Link>
        <div className="flex flex-wrap items-start gap-4">
          <SettingsCard title={saved.displayName} className="w-140 shrink-0 grow-0">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="type-display-name">
                <FormattedMessage {...messages.displayName} />
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="type-display-name"
                  className="w-80"
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                  onBlur={commitName}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitName();
                    if (event.key === "Escape") setNameDraft(saved.displayName);
                  }}
                />
                <StatusNote status={typeStatus.name} detail={typeError.name} />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="type-description">
                <FormattedMessage {...messages.description} />
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="type-description"
                  className="w-full"
                  value={descriptionDraft}
                  onChange={(event) => setDescriptionDraft(event.target.value)}
                  onBlur={commitDescription}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitDescription();
                    if (event.key === "Escape") setDescriptionDraft(saved.description ?? "");
                  }}
                />
                <StatusNote status={typeStatus.description} detail={typeError.description} />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="type-slug">
                <FormattedMessage {...messages.slug} />
              </Label>
              <Input
                id="type-slug"
                className="w-80 text-muted"
                value={saved.slug}
                readOnly
                aria-describedby="type-slug-note"
              />
              <p id="type-slug-note" className="text-xs text-muted">
                <FormattedMessage {...messages.slugNote} />
              </p>
            </div>

            <p className="text-sm text-muted">
              <FormattedMessage {...messages.inUse} values={{ count: saved.inUseCount }} />
            </p>
          </SettingsCard>

          <div className="flex min-w-80 flex-1 flex-col gap-2">
            <SettingsCard
              title={<FormattedMessage {...messages.attachedFields} />}
              flush
              actions={<StatusNote status={orderStatus} detail={orderError} />}
            >
              {/* Keyboard moves and detaches are announced here; the row
                  order itself is silent to a reader (WCAG 4.1.3). */}
              <span aria-live="polite" className="sr-only">
                {announcement}
              </span>
              <div
                aria-hidden="true"
                className="flex h-9 items-center border-b border-border-default pe-3"
              >
                <span className="w-9 shrink-0" />
                <span className="flex-1 ps-1 text-xs font-semibold text-muted">
                  <FormattedMessage {...messages.fieldColumn} />
                </span>
                <span className="w-24 px-3 text-xs font-semibold text-muted">
                  <FormattedMessage {...messages.requiredColumn} />
                </span>
                <span className="w-11 shrink-0" />
              </div>
              <ul tabIndex={-1}>
                {rows.map((row, index) => (
                  <li
                    key={row.fieldId}
                    draggable
                    onDragStart={() => {
                      dragFrom.current = index;
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => drop(event, index)}
                    className="flex h-11 items-center border-b border-border-muted pe-3"
                  >
                    <span className="flex w-9 shrink-0 justify-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="cursor-grab px-1"
                        // aria-disabled, not disabled: a disabled grip
                        // drops keyboard focus mid-reorder (DES-011);
                        // `move` already refuses while a save is in
                        // flight.
                        aria-disabled={orderStatus === "saving"}
                        aria-label={intl.formatMessage(messages.reorder, {
                          name: row.displayName,
                          position: index + 1,
                          total: rows.length,
                        })}
                        onKeyDown={(event) => {
                          if (event.key === "ArrowUp") {
                            event.preventDefault();
                            void move(index, index - 1);
                          }
                          if (event.key === "ArrowDown") {
                            event.preventDefault();
                            void move(index, index + 1);
                          }
                        }}
                      >
                        <GripVertical size={16} aria-hidden="true" className="text-muted" />
                      </Button>
                    </span>
                    <span className="flex min-w-0 flex-1 items-center gap-2 ps-1">
                      <span className="truncate text-base font-medium text-primary">
                        {row.displayName}
                      </span>
                      <span className="text-sm whitespace-nowrap text-muted">
                        {fieldCaption(row)}
                      </span>
                    </span>
                    <span className="flex w-24 items-center px-3">
                      <Checkbox
                        checked={row.isRequired}
                        disabled={rowStatus[row.fieldId] === "saving"}
                        aria-label={intl.formatMessage(messages.requiredFor, {
                          name: row.displayName,
                        })}
                        onCheckedChange={(checked) => void toggleRequired(row, checked === true)}
                      />
                    </span>
                    <span className="flex items-center gap-1">
                      <StatusNote
                        status={rowStatus[row.fieldId] ?? "idle"}
                        detail={rowError[row.fieldId]}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="px-1.5"
                        disabled={rowStatus[row.fieldId] === "saving"}
                        aria-label={intl.formatMessage(messages.detach, {
                          name: row.displayName,
                        })}
                        onClick={() => void detach(row)}
                      >
                        <X size={16} aria-hidden="true" className="text-muted" />
                      </Button>
                    </span>
                  </li>
                ))}
                {rows.length === 0 && (
                  <li className="flex h-11 items-center border-b border-border-muted px-4 text-sm text-muted">
                    <FormattedMessage {...messages.empty} />
                  </li>
                )}
              </ul>
              <div className="flex items-center gap-2 px-4 py-2.5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary" size="sm" disabled={attachable.length === 0}>
                      <Plus size={16} aria-hidden="true" />
                      <FormattedMessage {...messages.attach} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {attachable.map((field) => (
                      <DropdownMenuItem key={field.id} onSelect={() => void attach(field)}>
                        <span className="text-base text-primary">{field.displayName}</span>
                        <span className="text-sm text-muted">{fieldCaption(field)}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <StatusNote status={attachStatus} detail={attachError} />
                {attachable.length === 0 && (
                  <span className="text-sm text-muted">
                    <FormattedMessage {...messages.allAttached} />
                  </span>
                )}
              </div>
            </SettingsCard>
            <p className="text-sm text-muted">
              <FormattedMessage {...messages.help} />
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
