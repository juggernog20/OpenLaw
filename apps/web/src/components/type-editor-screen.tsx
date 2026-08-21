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
 *
 * Four parts are per mount (#354, #355, #400, ST14).
 *
 * **The right card is optional.** A mount with no attachment surface
 * omits `attachments` and the screen is the left card alone.
 *
 * **The left card takes one more control.** `identityExtra` draws below
 * the slug — ST14's Target select and its help line. It is the mount's
 * own column, so it owns its own save, exactly as the extras hook owns
 * its own columns on the API side.
 *
 * **The right card takes locked rows above the attachments.** `basics`
 * is what a form always collects whatever an Administrator configures
 * — ST14's Summary, Description, Attachments, and Urgency (INT-002).
 * They are stated, not configured: no catalog row is behind them,
 * nothing detaches them, and their required flags are facts, so the
 * card draws them disabled and never offers them in the Attach menu.
 *
 * **A mount may lock the required box on some attached rows.**
 * `requiredRule` names the field types whose box this mount never
 * offers — a request form may collect a `user` or an `entity` but may
 * never require one, because the portal shows a requester no rows to
 * pick from (#400). The row still attaches, reorders, and detaches; it
 * is only the flag that is refused, and the API refuses it too.
 */

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { FormattedMessage, useIntl, type IntlShape, type MessageDescriptor } from "react-intl";
import { ArrowLeft, GripVertical, Lock, Plus, X } from "lucide-react";
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

/**
 * One row the mount states rather than configures: what this kind of
 * form always collects (ST14's four basics — INT-002 fixes Summary,
 * Description, Attachments, and Urgency on every request form).
 *
 * It is not an attachment. There is no catalog row behind it, nothing
 * detaches it, and its required flag is a fact rather than a control —
 * the card draws it locked and disabled so an Administrator can read
 * the contract without being invited to change it.
 */
export interface EditorBasicRow {
  /** React key and test handle; never shown. */
  key: string;
  name: MessageDescriptor;
  /** The type caption beside the name — "Long text", or the DES-018
   * severity ramp for Urgency. */
  caption: MessageDescriptor;
  isRequired: boolean;
}

/**
 * Attachments whose required box this mount never offers (INT-002's
 * `user` and `entity` rule, #400).
 *
 * It is the client half of a refusal the API already makes, and it is
 * per mount for the same reason the API's is: a `user` field is
 * ordinary on a contract type, where staff pick from a list that has
 * rows, and unanswerable on a request form, where the portal shows a
 * requester none. A mount that omits this may require every field it
 * attaches.
 *
 * The row still attaches, reorders, and detaches. Only the box is
 * locked, and the reason is said twice — once beside the box for a
 * reader, once in the card's help line for everybody else — because a
 * disabled control with no reason is a screen that refuses without
 * explaining (SET-003).
 */
export interface EditorRequiredRule {
  /** The field types whose required box is drawn locked. */
  fieldTypes: readonly EditorFieldType[];
  /** Why this row's box is locked. Takes `{name}`. */
  reason: MessageDescriptor;
}

/** The identity half of the API seam — the one call every mount makes. */
export interface TypeEditorIdentityApi {
  update(
    id: string,
    body: { displayName?: string; description?: string | null },
  ): Promise<ApiResult<EditorTypeRow>>;
}

/** The attachment half, implemented by a mount that draws the right card. */
export interface TypeEditorAttachmentsApi {
  attach(id: string, fieldId: string): Promise<ApiResult<AttachedFieldRow>>;
  detach(id: string, fieldId: string): Promise<{ ok: boolean; detail?: string }>;
  setRequired(
    id: string,
    fieldId: string,
    isRequired: boolean,
  ): Promise<ApiResult<AttachedFieldRow>>;
  reorder(id: string, fieldIds: string[]): Promise<ApiResult<AttachedFieldRow[]>>;
}

/** Both halves, which is what a mount with a right card implements. */
export type TypeEditorApi = TypeEditorIdentityApi & TypeEditorAttachmentsApi;

/** The left card's vocabulary, defined per module with `defineMessages`. */
export interface TypeEditorIdentityMessages {
  allTypes: MessageDescriptor;
  displayName: MessageDescriptor;
  description: MessageDescriptor;
  slug: MessageDescriptor;
  slugNote: MessageDescriptor;
  /** The count caption under the identity fields. A mount whose records
   * do not exist yet has nothing but a zero to print, so it omits the
   * slot and draws no caption — as the Types pane already does. */
  inUse?: MessageDescriptor;
}

/** The right card's vocabulary, for a mount that draws one. */
export interface TypeEditorAttachmentsMessages {
  attachedFields: MessageDescriptor;
  fieldColumn: MessageDescriptor;
  requiredColumn: MessageDescriptor;
  requiredFor: MessageDescriptor;
  detach: MessageDescriptor;
  detached: MessageDescriptor;
  attach: MessageDescriptor;
  /** The aria-live confirmation after a successful attach. */
  attached: MessageDescriptor;
  allAttached: MessageDescriptor;
  empty: MessageDescriptor;
  reorder: MessageDescriptor;
  moved: MessageDescriptor;
  globalCaption: MessageDescriptor;
  help: MessageDescriptor;
}

/**
 * The rows a mount states rather than configures, and the two lines
 * that make them readable (ST14's four basics).
 *
 * The three travel together for `TypeEditorAttachments`' reason: a
 * locked row with no caption saying why it is locked, or a lock glyph a
 * screen reader cannot name, is not a half-built row — it is a bug.
 */
export interface TypeEditorBasics {
  rows: readonly EditorBasicRow[];
  /** The header caption over them — "Basics are always on the form". */
  caption: MessageDescriptor;
  /** What a reader hears in place of the grip on a locked row. */
  locked: MessageDescriptor;
}

/** Both halves, which is what the contract and matter mounts pass. */
export type TypeEditorMessages = TypeEditorIdentityMessages & TypeEditorAttachmentsMessages;

/**
 * The right card, for a mount that has one.
 *
 * The four parts travel together because a card with a catalog and no
 * way to attach from it, or an API with no rows to act on, is not a
 * half-built card — it is a bug. Request types mount the editor without
 * it: the form definition is #355's, and until then the screen is the
 * left card alone.
 */
export interface TypeEditorAttachments {
  initialAttached: AttachedFieldRow[];
  /** The module's attachable catalog (live fields, already scoped). */
  catalog: EditorCatalogRow[];
  api: TypeEditorAttachmentsApi;
  messages: TypeEditorAttachmentsMessages;
  /**
   * Rows the mount states rather than configures, drawn locked above
   * the attachments (ST14's four basics). The two type editors have
   * none: every field on a contract type is attached, so there is
   * nothing to state.
   */
  basics?: TypeEditorBasics;
  /**
   * Which attached rows may never be marked required here (#400). The
   * two type editors pass none: every field they attach is one staff
   * can answer.
   */
  requiredRule?: EditorRequiredRule;
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

/**
 * The right card (ST15/ST16): the module's catalog fields attached to
 * one type, in per-type order, with drag or arrow-key reorder, a
 * per-attachment required checkbox, detach, and an Attach menu over
 * what the module's scope rule allows. A mount that has no attachment
 * surface never renders this.
 */
function AttachedFieldsCard({
  typeId,
  initialAttached,
  catalog,
  api,
  messages,
  basics,
  requiredRule,
}: Readonly<TypeEditorAttachments & { typeId: string }>) {
  const intl = useIntl();

  /** The ST16 field caption: the type, with the scope riding along only
   * when it is global — "Single select · global". */
  function fieldCaption(row: { fieldType: EditorFieldType; moduleScope: string }) {
    const label = typeLabel(intl, row.fieldType);
    return row.moduleScope === "global"
      ? intl.formatMessage(messages.globalCaption, { type: label })
      : label;
  }

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
  // A const binding, so the guard below narrows inside JSX — a property
  // access would not.
  const locked = basics;
  const lockedRequired = requiredRule;

  /** Whether this mount locks this row's required box (#400). */
  const isRequiredLocked = (row: AttachedFieldRow) =>
    lockedRequired?.fieldTypes.includes(row.fieldType) === true;

  function noteRow(fieldId: string, status: FieldStatus, detail?: string) {
    setRowStatus((current) => ({ ...current, [fieldId]: status }));
    setRowError((current) => ({ ...current, [fieldId]: detail }));
  }

  async function attach(field: EditorCatalogRow) {
    setAttachStatus("saving");
    setAttachError(undefined);
    const { data, detail } = await api
      .attach(typeId, field.id)
      .catch(() => ({ data: undefined, detail: undefined }));
    if (data) {
      setRows((current) => [...current, data]);
      setAttachStatus("saved");
      // The new row lands below the menu, out of a reader's view —
      // announce it like detach and reorder do (WCAG 4.1.3).
      setAnnouncement(intl.formatMessage(messages.attached, { name: field.displayName }));
    } else {
      setAttachStatus("error");
      setAttachError(detail);
    }
  }

  async function detach(row: AttachedFieldRow) {
    noteRow(row.fieldId, "saving");
    const { ok, detail } = await api
      .detach(typeId, row.fieldId)
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
      .setRequired(typeId, row.fieldId, isRequired)
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
      .reorder(typeId, fieldIds)
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
    <div className="flex min-w-80 flex-1 flex-col gap-2">
      <SettingsCard
        title={<FormattedMessage {...messages.attachedFields} />}
        flush
        actions={
          <span className="flex items-center gap-2">
            {locked && (
              <span className="text-sm text-muted">
                <FormattedMessage {...locked.caption} />
              </span>
            )}
            <StatusNote status={orderStatus} detail={orderError} />
          </span>
        }
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
        {/* The rows the form always collects, above the ones an
            Administrator chose. Their own list, not the reorderable
            one: nothing here moves, detaches, or takes focus.

            No dimming, though the mock draws the row at 60%: the lock,
            the disabled box, and the muted caption already say locked,
            and fading text the reader still has to read would drop it
            under DES-011's contrast floor. */}
        {locked && locked.rows.length > 0 && (
          // Two lists in one card, so each says which it is: a reader
          // moving between them hears "always on the form" and the
          // card's own title rather than two anonymous lists.
          <ul aria-label={intl.formatMessage(locked.caption)}>
            {locked.rows.map((basic) => (
              <li
                key={basic.key}
                className="flex h-11 items-center border-b border-border-muted pe-3"
              >
                <span className="flex w-9 shrink-0 justify-center">
                  <Lock size={16} aria-hidden="true" className="text-muted" />
                  <span className="sr-only">
                    <FormattedMessage
                      {...locked.locked}
                      values={{ name: intl.formatMessage(basic.name) }}
                    />
                  </span>
                </span>
                <span className="flex min-w-0 flex-1 items-center gap-2 ps-1">
                  <span className="truncate text-base font-medium text-primary">
                    <FormattedMessage {...basic.name} />
                  </span>
                  <span className="text-sm whitespace-nowrap text-muted">
                    <FormattedMessage {...basic.caption} />
                  </span>
                </span>
                <span className="flex w-24 items-center px-3">
                  <Checkbox
                    checked={basic.isRequired}
                    disabled
                    aria-label={intl.formatMessage(messages.requiredFor, {
                      name: intl.formatMessage(basic.name),
                    })}
                  />
                </span>
                {/* The detach column, kept empty so the locked rows and
                    the attached ones line up as one table. */}
                <span className="w-11 shrink-0" />
              </li>
            ))}
          </ul>
        )}
        <ul tabIndex={-1} aria-label={intl.formatMessage(messages.attachedFields)}>
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
                <span className="text-sm whitespace-nowrap text-muted">{fieldCaption(row)}</span>
              </span>
              <span className="flex w-24 items-center px-3">
                <Checkbox
                  checked={row.isRequired}
                  disabled={isRequiredLocked(row) || rowStatus[row.fieldId] === "saving"}
                  aria-label={intl.formatMessage(messages.requiredFor, {
                    name: row.displayName,
                  })}
                  // The reason is the box's description, not a sentence
                  // that happens to sit beside it — a reader that lands
                  // on the box hears why it is shut.
                  aria-describedby={
                    isRequiredLocked(row) ? `required-locked-${row.fieldId}` : undefined
                  }
                  onCheckedChange={(checked) => void toggleRequired(row, checked === true)}
                />
                {/* A disabled box says "not yours to set" and nothing
                    more, so the reason rides beside it. The help line
                    under the card says the same thing on the screen. */}
                {lockedRequired && isRequiredLocked(row) && (
                  <span id={`required-locked-${row.fieldId}`} className="sr-only">
                    <FormattedMessage
                      {...lockedRequired.reason}
                      values={{ name: row.displayName }}
                    />
                  </span>
                )}
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
              {/* Not disabled when the catalog is exhausted: Radix
                  returns focus here when the menu closes, and a
                  disabled trigger drops it to the body after the
                  last attach (DES-011). The empty state renders
                  inside the menu instead. */}
              <Button variant="secondary" size="sm">
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
              {attachable.length === 0 && (
                <div className="px-3 py-2 text-sm text-muted">
                  <FormattedMessage {...messages.allAttached} />
                </div>
              )}
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
  );
}

export function TypeEditorScreen({
  initialType,
  tabs,
  backPath,
  api,
  messages,
  identityExtra,
  attachments,
}: Readonly<{
  initialType: EditorTypeRow;
  /** The module's section head (title + tab strip). */
  tabs: ReactNode;
  /** The Types pane this editor was reached from. */
  backPath: string;
  api: TypeEditorIdentityApi;
  messages: TypeEditorIdentityMessages;
  /**
   * One more control on the left card, below the slug (ST14's Target
   * select and its help line). It owns its own save, because what it
   * writes is the mount's column and not the shared identity — see the
   * request-type editor, the only mount that passes one.
   */
  identityExtra?: ReactNode;
  /** The right card; omit for a mount that has no attachment surface. */
  attachments?: TypeEditorAttachments;
}>) {
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

  // A const binding, so the `inUse &&` guard below narrows inside JSX —
  // a property access would not.
  const inUse = messages.inUse;

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

            {identityExtra}

            {inUse && (
              <p className="text-sm text-muted">
                <FormattedMessage {...inUse} values={{ count: saved.inUseCount }} />
              </p>
            )}
          </SettingsCard>

          {attachments && <AttachedFieldsCard typeId={saved.id} {...attachments} />}
        </div>
      </div>
    </>
  );
}
