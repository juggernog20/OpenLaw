// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The type editor screen (#85: one machinery, every type editor), from
 * the ST15/ST16 frames of settings.pen (DES-022): one taxonomy type's
 * own screen, reached from its row on a Types pane. The details card
 * edits identity — display name and description on DES-017
 * commit-on-confirm inputs — and the
 * main card is the attachment surface: catalog fields in per-type
 * order with drag or arrow-key reorder, a per-attachment required
 * checkbox, detach, and an Attach menu over the module's attachable
 * catalog fields. Every change applies immediately on save (SET-003).
 * Each module's editor mounts this with its own vocabulary and API
 * adapter — the contract (CTR-016) and matter (MTR-011) editors are
 * configuration, not copies.
 *
 * Four parts are per mount (#354, #355, #400, ST14).
 *
 * **The fields card is optional.** A mount with no attachment surface
 * omits `attachments` and the screen is the details card alone.
 *
 * **The details card takes one more control.** `identityExtra` draws below
 * the description — ST14's Target select and its help line. It is the mount's
 * own column, so it owns its own save, exactly as the extras hook owns
 * its own columns on the API side.
 *
 * **The fields card includes questions that cannot be removed.** `basics`
 * is what a form always collects whatever an Administrator configures
 * — ST14's Title, Description, Attachments, Department, and Urgency (INT-002).
 * They are stated, not configured: no catalog row is behind them,
 * nothing detaches them, and their required flags are facts, so the
 * card disables their required checkboxes and omits them from the Attach menu.
 * With `formOrder`, their position can change alongside attached fields.
 *
 * **A mount may lock the required box on some attached rows.**
 * `requiredRule` names the field types whose box this mount never
 * offers — a request form may collect a `user` or an `entity` but may
 * never require one, because the portal shows a requester no rows to
 * pick from (#400). The row still attaches, reorders, and detaches; it
 * is only the flag that is refused, and the API refuses it too.
 */

import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { FormattedMessage, useIntl, type IntlShape, type MessageDescriptor } from "react-intl";
import { ArrowLeft, GripVertical, Lock, Plus, X } from "lucide-react";
import { resolveIntakeFieldOrder } from "@openlaw/shared";
import { DefaultFields } from "./default-fields";
import { FieldEditorDialog } from "./field-editor-dialog";
import { PageTitle } from "./page-title";
import { SettingsCard } from "./settings-card";
import { StatusNote, type FieldStatus } from "./status-note";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { problem, type ProblemResult } from "../lib/problem";

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
  | "currency"
  | "date"
  | "boolean"
  | "single_select"
  | "multi_select"
  | "user"
  | "entity";

/** One attached field, as the editor renders it. */
export interface AttachedFieldRow {
  builtInKey?: string | null;
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
  builtInKey?: string | null;
  id: string;
  displayName: string;
  moduleScope: string;
  fieldType: EditorFieldType;
}

/**
 * One row the mount states rather than configures: what this kind of
 * form always collects (ST14's fixed basics — INT-002 fixes Title,
 * Description, Attachments, Department, and Urgency on every request form).
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
  /** The type caption beside the name, such as "Long text" or "Single select". */
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
  ): Promise<ProblemResult<EditorTypeRow>>;
}

/** What an attach may ask for beyond the row (INT-002, 2026-09-19). */
export interface AttachOptions {
  /** Attach the same field to the type's default destination type in
   * the same act. Only a mount with a `targetOffer` ever sends it. */
  alsoAttachToTarget?: boolean;
}

/** The target's side of a companion attach, as the route answers it. */
export interface TargetAttachment {
  module: "contract" | "matter";
  typeId: string;
  typeDisplayName: string;
  /** False when the target already had the field — the outcome asked
   * for, so not a refusal. */
  attached: boolean;
}

/** The attach route's answer: the new row, and the target's side when
 * the mount asked for one. */
export interface AttachResult extends AttachedFieldRow {
  alsoAttachedTo?: TargetAttachment | null;
}

/** The attachment half, implemented by a mount that draws the fields card. */
export interface TypeEditorAttachmentsApi {
  attach(
    id: string,
    fieldId: string,
    options?: AttachOptions,
  ): Promise<ProblemResult<AttachResult>>;
  detach(id: string, fieldId: string): Promise<{ ok: boolean } & ProblemResult<never>>;
  setRequired(
    id: string,
    fieldId: string,
    isRequired: boolean,
  ): Promise<ProblemResult<AttachedFieldRow>>;
  reorder(id: string, fieldIds: string[]): Promise<ProblemResult<AttachedFieldRow[]>>;
}

/** Both halves, which is what a mount with a fields card implements. */
export type TypeEditorApi = TypeEditorIdentityApi & TypeEditorAttachmentsApi;

/** The details card's vocabulary, defined per module with `defineMessages`. */
export interface TypeEditorIdentityMessages {
  allTypes: MessageDescriptor;
  displayName: MessageDescriptor;
  description: MessageDescriptor;
  /** The count caption under the identity fields. A mount whose records
   * do not exist yet has nothing but a zero to print, so it omits the
   * slot and draws no caption — as the Types pane already does. */
  inUse?: MessageDescriptor;
}

/** The fields card's vocabulary, for a mount that draws one. */
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
  help?: MessageDescriptor;
}

/**
 * The rows a mount states rather than configures, and the two lines
 * that make them readable (ST14's fixed basics).
 *
 * The three travel together for `TypeEditorAttachments`' reason: a
 * locked row with no caption saying why it is locked, or a lock glyph a
 * screen reader cannot name, is not a half-built row — it is a bug.
 */
export interface TypeEditorBasics {
  rows: readonly EditorBasicRow[];
  /** The header caption over them — "Basics are always on the form". */
  caption: MessageDescriptor;
  /** Explains why a basic question cannot be removed or made optional. */
  locked: MessageDescriptor;
}

/** Both halves, which is what the contract and matter mounts pass. */
export type TypeEditorMessages = TypeEditorIdentityMessages & TypeEditorAttachmentsMessages;

/** One offer the card puts to the Administrator before an attach. */
export interface TargetOffer {
  module: "contract" | "matter";
  typeDisplayName: string;
}

/**
 * The companion attach on the type's target, for a mount whose types
 * point at another module's type (INT-002, 2026-09-19). Before a field
 * is attached, `check` says whether the target type lacks it; when it
 * does, the card asks whether to attach it there too, in the copy the
 * mount supplies, and sends the answer as `alsoAttachToTarget`. A
 * check that fails answers null, and the attach goes on without the
 * offer: the form attach is the act asked for, and a lookup that could
 * not run must not refuse it.
 */
export interface TypeEditorTargetOffer {
  check(field: EditorCatalogRow): Promise<TargetOffer | null>;
  /** "Attach {name} to {target} too?" */
  title: MessageDescriptor;
  /** Why: the carry rule, in the mount's words. `{name}`, `{target}`, `{module}`. */
  body: MessageDescriptor;
  /** The button that attaches to both. */
  accept: MessageDescriptor;
  /** The button that attaches to the form alone. */
  decline: MessageDescriptor;
  /** The aria-live confirmation when both were attached. `{name}`, `{target}`. */
  attachedBoth: MessageDescriptor;
}

/**
 * The fields card, for a mount that has one.
 *
 * The four parts travel together because a card with a catalog and no
 * way to attach from it, or an API with no rows to act on, is not a
 * half-built card — it is a bug. Request types mount the editor without
 * it: the form definition is #355's, and until then the screen is the
 * details card alone.
 */
export interface TypeEditorAttachments {
  defaultFieldsModule?: "contract" | "matter";
  formOrder?: {
    initial: string[];
    save(typeId: string, keys: string[]): Promise<ProblemResult<string[]>>;
  };
  initialAttached: AttachedFieldRow[];
  createFieldModule?: "contract" | "matter" | "choose";
  /** The module's attachable catalog (live fields, already scoped). */
  catalog: EditorCatalogRow[];
  api: TypeEditorAttachmentsApi;
  messages: TypeEditorAttachmentsMessages;
  /**
   * Always-present questions. With formOrder, these can move among the
   * attachments; otherwise they appear above them.
   */
  basics?: TypeEditorBasics;
  /**
   * Which attached rows may never be marked required here (#400). The
   * two type editors pass none: every field they attach is one staff
   * can answer.
   */
  requiredRule?: EditorRequiredRule;
  /**
   * The offer to attach the same field to the type's target (INT-002,
   * 2026-09-19). Request types pass it; the two record-side editors
   * have no target and pass none.
   */
  targetOffer?: TypeEditorTargetOffer;
}

/** The Fields pane's vocabulary, reused verbatim across modules (one
 * id, one label — the field-type names are module-neutral). */
function typeLabel(intl: IntlShape, fieldType: EditorFieldType): string {
  return intl.formatMessage(
    {
      id: "settings.contractFields.typeLabel",
      defaultMessage:
        "{type, select, text {Text} long_text {Long text} number {Number} " +
        "date {Date} currency {Currency} boolean {Boolean} single_select {Single select} " +
        "multi_select {Multi select} user {User} entity {Entity} other {Unknown}}",
    },
    { type: fieldType },
  );
}

/**
 * The fields card (ST15/ST16): the module's catalog fields attached to
 * one type, in per-type order, with drag or arrow-key reorder, a
 * per-attachment required checkbox, detach, and an Attach menu over
 * what the module's scope rule allows. A mount that has no attachment
 * surface never renders this.
 */
function AttachedFieldsCard({
  typeId,
  initialAttached,
  defaultFieldsModule,
  formOrder,
  createFieldModule,
  catalog,
  api,
  messages,
  basics,
  requiredRule,
  targetOffer,
}: Readonly<TypeEditorAttachments & { typeId: string }>) {
  const intl = useIntl();

  /** Display the field type beside its name. */
  function fieldCaption(row: { fieldType: EditorFieldType; builtInKey?: string | null }) {
    if (row.builtInKey === "counterparties")
      return intl.formatMessage({
        id: "settings.fields.counterpartyLookup",
        defaultMessage: "Counterparty lookup",
      });
    return typeLabel(intl, row.fieldType);
  }

  const [rows, setRows] = useState<AttachedFieldRow[]>(initialAttached);
  const [savedFormOrder, setSavedFormOrder] = useState(formOrder?.initial ?? []);
  const orderedKeys = formOrder
    ? resolveIntakeFieldOrder(
        rows.map((row) => row.fieldId),
        savedFormOrder,
      )
    : rows.map((row) => row.fieldId);
  const entries = orderedKeys.map((key) => {
    const basic = formOrder ? basics?.rows.find((item) => `basic:${item.key}` === key) : undefined;
    const row = rows.find((item) => item.fieldId === key);
    return {
      key,
      basic,
      row,
      name: basic ? intl.formatMessage(basic.name) : (row?.displayName ?? key),
    };
  });
  const [createdFields, setCreatedFields] = useState<EditorCatalogRow[]>([]);
  const [addingField, setAddingField] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [fieldSearch, setFieldSearch] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const attachTrigger = useRef<HTMLButtonElement>(null);
  const [rowStatus, setRowStatus] = useState<Record<string, FieldStatus>>({});
  const [rowError, setRowError] = useState<Record<string, string | undefined>>({});
  const [orderStatus, setOrderStatus] = useState<FieldStatus>("idle");
  const [orderError, setOrderError] = useState<string | undefined>(undefined);
  const [attachStatus, setAttachStatus] = useState<FieldStatus>("idle");
  const [attachError, setAttachError] = useState<string | undefined>(undefined);
  const [announcement, setAnnouncement] = useState("");
  const dragFrom = useRef<number | null>(null);
  /** The offer on screen, with the attach that waits on its answer. */
  const [pendingOffer, setPendingOffer] = useState<{
    field: EditorCatalogRow;
    offer: TargetOffer;
    answer: (choice: "both" | "form" | "cancel") => void;
  } | null>(null);

  const availableCreatedFields = createdFields.filter(
    (field) =>
      !createFieldModule ||
      createFieldModule === "choose" ||
      field.moduleScope === createFieldModule,
  );
  const attachable: EditorCatalogRow[] = [...catalog, ...availableCreatedFields].filter(
    (field) => !rows.some((row) => row.fieldId === field.id),
  );
  const matchingFields = attachable
    .filter((field) =>
      field.displayName
        .toLocaleLowerCase(intl.locale)
        .includes(fieldSearch.trim().toLocaleLowerCase(intl.locale)),
    )
    .sort((a, b) =>
      a.displayName.localeCompare(b.displayName, intl.locale, {
        sensitivity: "base",
        numeric: true,
      }),
    );
  useEffect(() => {
    if (!attachMenuOpen) return;
    // Wait for the menu's own focus handling before focusing its search.
    const frame = requestAnimationFrame(() => searchInput.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [attachMenuOpen]);
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

  /**
   * Puts the mount's offer, if the target type lacks this field, and
   * waits for the answer. "cancel" is Esc or the overlay: the attach
   * is not made, and nothing is reported, because nothing was asked.
   */
  async function askTargetOffer(field: EditorCatalogRow): Promise<"both" | "form" | "cancel"> {
    if (!targetOffer) return "form";
    const offer = await targetOffer.check(field).catch(() => null);
    if (!offer) return "form";
    return new Promise((answer) => setPendingOffer({ field, offer, answer }));
  }

  async function attach(field: EditorCatalogRow) {
    const choice = await askTargetOffer(field);
    if (choice === "cancel") return false;
    setAttachStatus("saving");
    setAttachError(undefined);
    const { data, detail } = await api
      .attach(typeId, field.id, choice === "both" ? { alsoAttachToTarget: true } : undefined)
      .catch(async () => ({ data: undefined, ...(await problem(undefined)) }));
    if (data) {
      const { alsoAttachedTo, ...row } = data;
      setRows((current) => [...current, row]);
      setAttachStatus("saved");
      // The new row lands below the menu, out of a reader's view —
      // announce it like detach and reorder do (WCAG 4.1.3).
      setAnnouncement(
        alsoAttachedTo?.attached && targetOffer
          ? intl.formatMessage(targetOffer.attachedBoth, {
              name: field.displayName,
              target: alsoAttachedTo.typeDisplayName,
            })
          : intl.formatMessage(messages.attached, { name: field.displayName }),
      );
    } else {
      setAttachStatus("error");
      setAttachError(detail);
    }
    return !!data;
  }

  async function detach(row: AttachedFieldRow) {
    noteRow(row.fieldId, "saving");
    const { ok, detail } = await api
      .detach(typeId, row.fieldId)
      .catch(async () => ({ ok: false, ...(await problem(undefined)) }));
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
      .catch(async () => ({ data: undefined, ...(await problem(undefined)) }));
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
    if (toIndex < 0 || toIndex >= entries.length || fromIndex === toIndex) return;
    if (orderStatus === "saving") return;
    if (formOrder) {
      const keys = [...orderedKeys];
      const moved = keys.splice(fromIndex, 1)[0]!;
      keys.splice(toIndex, 0, moved);
      setOrderStatus("saving");
      setOrderError(undefined);
      const { data, detail } = await formOrder
        .save(typeId, keys)
        .catch(async () => ({ data: undefined, ...(await problem(undefined)) }));
      if (data) {
        setSavedFormOrder(data);
        setOrderStatus("saved");
        setAnnouncement(
          intl.formatMessage(messages.moved, {
            name: entries[fromIndex]!.name,
            position: toIndex + 1,
            total: entries.length,
          }),
        );
      } else {
        setOrderStatus("error");
        setOrderError(detail);
      }
      return;
    }
    const row = rows[fromIndex]!;
    const fieldIds = rows.map(({ fieldId }) => fieldId);
    fieldIds.splice(fromIndex, 1);
    fieldIds.splice(toIndex, 0, row.fieldId);

    setOrderStatus("saving");
    setOrderError(undefined);
    const { data, detail } = await api
      .reorder(typeId, fieldIds)
      .catch(async () => ({ data: undefined, ...(await problem(undefined)) }));
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

  function renderGrip(name: string, index: number) {
    return (
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
            name,
            position: index + 1,
            total: entries.length,
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
    );
  }

  function drop(event: DragEvent, targetIndex: number) {
    event.preventDefault();
    const from = dragFrom.current;
    dragFrom.current = null;
    if (from === null || from === targetIndex) return;
    void move(from, targetIndex);
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <SettingsCard
        title={<FormattedMessage {...messages.attachedFields} />}
        className="max-w-none"
        collapsible={!!defaultFieldsModule}
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
          <span className="w-24 shrink-0 px-3 text-xs font-semibold text-muted">
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
        {locked && !formOrder && locked.rows.length > 0 && (
          // Two lists in one card, so each says which it is: a reader
          // moving between them hears "always on the form" and the
          // card's own title rather than two anonymous lists.
          <ul aria-label={intl.formatMessage(locked.caption)}>
            {locked.rows.map((basic) => (
              <li
                key={basic.key}
                className="flex min-h-11 items-center border-b border-border-muted py-2 pe-3"
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
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 ps-1">
                  <span className="max-w-full text-base font-medium break-words text-primary">
                    <FormattedMessage {...basic.name} />
                  </span>
                  <span className="min-w-0 text-sm break-words text-muted">
                    <FormattedMessage {...basic.caption} />
                  </span>
                </span>
                <span className="flex w-24 shrink-0 items-center px-3">
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
          {entries.map((entry, index) => {
            if (entry.basic) {
              const basic = entry.basic;
              return (
                <li
                  key={entry.key}
                  draggable
                  onDragStart={() => {
                    dragFrom.current = index;
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => drop(event, index)}
                  className="flex min-h-11 items-center border-b border-border-muted py-2 pe-3"
                >
                  {renderGrip(entry.name, index)}
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 ps-1">
                    <span className="text-base font-medium text-primary">{entry.name}</span>
                    <span className="text-sm text-muted">
                      <FormattedMessage {...basic.caption} />
                    </span>
                  </span>
                  <span className="flex w-24 shrink-0 items-center px-3">
                    <Checkbox
                      checked={basic.isRequired}
                      disabled
                      aria-label={intl.formatMessage(messages.requiredFor, { name: entry.name })}
                    />
                  </span>
                  <span className="flex w-8 shrink-0 justify-center">
                    <Lock size={16} aria-hidden="true" className="text-muted" />
                    <span className="sr-only">
                      <FormattedMessage {...basics!.locked} values={{ name: entry.name }} />
                    </span>
                  </span>
                </li>
              );
            }
            const row = entry.row!;
            return (
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
                {renderGrip(row.displayName, index)}
                <span className="flex min-w-0 flex-1 items-center gap-2 ps-1">
                  <span className="truncate text-base font-medium text-primary">
                    {row.displayName}
                  </span>
                  <span className="text-sm whitespace-nowrap text-muted">
                    {row.builtInKey && (
                      <FormattedMessage
                        id="settings.typeEditor.defaultFieldPrefix"
                        defaultMessage="Default · "
                      />
                    )}
                    {fieldCaption(row)}
                  </span>
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
            );
          })}
          {entries.length === 0 && (
            <li className="flex h-11 items-center border-b border-border-muted px-4 text-sm text-muted">
              <FormattedMessage {...messages.empty} />
            </li>
          )}
        </ul>
        <div className="flex items-center gap-2 px-4 py-2.5">
          <DropdownMenu
            open={attachMenuOpen}
            onOpenChange={(open) => {
              setAttachMenuOpen(open);
              if (open) setFieldSearch("");
            }}
          >
            <DropdownMenuTrigger asChild>
              {/* Not disabled when the catalog is exhausted: Radix
                  returns focus here when the menu closes, and a
                  disabled trigger drops it to the body after the
                  last attach (DES-011). The empty state renders
                  inside the menu instead. */}
              <Button
                ref={attachTrigger}
                variant="secondary"
                size="sm"
                disabled={attachStatus === "saving"}
              >
                <Plus size={16} aria-hidden="true" />
                <FormattedMessage {...messages.attach} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="flex max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] flex-col"
              onCloseAutoFocus={(event) => {
                if (addingField) event.preventDefault();
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "ArrowUp" &&
                  event.target === event.currentTarget.querySelector('[role="menuitem"]')
                ) {
                  event.preventDefault();
                  searchInput.current?.focus();
                }
              }}
            >
              <div className="shrink-0 p-1">
                <Input
                  ref={searchInput}
                  value={fieldSearch}
                  placeholder={intl.formatMessage({
                    id: "settings.typeEditor.searchFields",
                    defaultMessage: "Search fields…",
                  })}
                  aria-label={intl.formatMessage({
                    id: "settings.typeEditor.searchFieldsLabel",
                    defaultMessage: "Search fields",
                  })}
                  onChange={(event) => setFieldSearch(event.target.value)}
                  onKeyDown={(event) => {
                    // Keep typing, spaces and caret movement out of menu typeahead.
                    if (event.key !== "Escape") event.stopPropagation();
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      event.preventDefault();
                      const menu = event.currentTarget.closest('[role="menu"]');
                      const fields = menu?.querySelectorAll<HTMLElement>(
                        '[role="menuitem"][data-field-option]',
                      );
                      const items = fields?.length
                        ? fields
                        : menu?.querySelectorAll<HTMLElement>('[role="menuitem"]');
                      const item =
                        event.key === "ArrowDown" ? items?.[0] : items?.[items.length - 1];
                      item?.focus();
                    }
                    if (event.key === "Enter") event.preventDefault();
                  }}
                />
              </div>
              {createFieldModule && (
                <>
                  <DropdownMenuItem className="shrink-0" onSelect={() => setAddingField(true)}>
                    <Plus size={16} aria-hidden="true" />
                    <FormattedMessage
                      id="settings.typeEditor.addNewField"
                      defaultMessage="Add new field"
                    />
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="shrink-0" />
                </>
              )}
              <div className="min-h-0 overflow-y-auto">
                {matchingFields.map((field) => (
                  <DropdownMenuItem
                    key={field.id}
                    data-field-option
                    onSelect={() => void attach(field)}
                  >
                    <span className="text-base text-primary">{field.displayName}</span>
                    <span className="text-sm text-muted">
                      {field.builtInKey && (
                        <FormattedMessage
                          id="settings.typeEditor.defaultFieldPrefix"
                          defaultMessage="Default · "
                        />
                      )}
                      {fieldCaption(field)}
                    </span>
                  </DropdownMenuItem>
                ))}
                {matchingFields.length === 0 && (
                  <div role="status" className="px-3 py-2 text-sm text-muted">
                    {attachable.length === 0 ? (
                      <FormattedMessage {...messages.allAttached} />
                    ) : (
                      <FormattedMessage
                        id="settings.typeEditor.noMatchingFields"
                        defaultMessage="No matching fields."
                      />
                    )}
                  </div>
                )}
              </div>
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
      {addingField && createFieldModule && (
        <FieldEditorDialog
          target={null}
          module={createFieldModule === "choose" ? "contract" : createFieldModule}
          allowModuleSelection={createFieldModule === "choose"}
          onOpenChange={setAddingField}
          onRowChanged={() => {}}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            attachTrigger.current?.focus();
          }}
          onCreated={async (field) => {
            setCreatedFields((current) => [...current, field]);
            if (!(await attach(field))) {
              setAttachError((detail) =>
                intl.formatMessage(
                  {
                    id: "settings.typeEditor.createdNotAttached",
                    defaultMessage:
                      "{name} was created but could not be attached. Select it from Attach field to try again. {detail}",
                  },
                  { name: field.displayName, detail: detail ?? "" },
                ),
              );
            }
          }}
        />
      )}
      {pendingOffer && targetOffer && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (open) return;
            pendingOffer.answer("cancel");
            setPendingOffer(null);
          }}
        >
          <DialogContent
            width="md"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              attachTrigger.current?.focus();
            }}
          >
            <DialogTitle>
              <FormattedMessage
                {...targetOffer.title}
                values={{
                  name: pendingOffer.field.displayName,
                  target: pendingOffer.offer.typeDisplayName,
                }}
              />
            </DialogTitle>
            <p className="mt-2 text-sm text-secondary">
              <FormattedMessage
                {...targetOffer.body}
                values={{
                  name: pendingOffer.field.displayName,
                  target: pendingOffer.offer.typeDisplayName,
                  module: pendingOffer.offer.module,
                }}
              />
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  pendingOffer.answer("form");
                  setPendingOffer(null);
                }}
              >
                <FormattedMessage {...targetOffer.decline} />
              </Button>
              <Button
                onClick={() => {
                  pendingOffer.answer("both");
                  setPendingOffer(null);
                }}
              >
                <FormattedMessage {...targetOffer.accept} />
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {messages.help && (
        <p className="text-sm text-muted">
          <FormattedMessage {...messages.help} />
        </p>
      )}
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
  extraCards,
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
   * One more control on the details card, below the description (ST14's Target
   * select and its help line). It owns its own save, because what it
   * writes is the mount's column and not the shared identity — see the
   * request-type editor, the only mount that passes one.
   */
  identityExtra?: ReactNode;
  extraCards?: ReactNode;
  /** The fields card; omit for a mount that has no attachment surface. */
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
      .catch(async () => ({ data: undefined, ...(await problem(undefined)) }));
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
      <div className="@container/type-editor flex w-full max-w-270 flex-col gap-4">
        {tabs}
        <Link
          to={backPath}
          className="flex w-fit items-center gap-1.5 rounded-chip text-sm font-medium text-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          <FormattedMessage {...messages.allTypes} />
        </Link>
        <div
          className={
            attachments
              ? "grid min-w-0 grid-cols-1 items-start gap-4 @3xl/type-editor:grid-cols-[minmax(0,1fr)_20rem]"
              : "grid min-w-0 grid-cols-1 items-start gap-4"
          }
        >
          {attachments && (
            <div className="flex min-w-0 flex-col gap-4">
              {attachments.defaultFieldsModule && (
                <DefaultFields module={attachments.defaultFieldsModule} />
              )}
              <AttachedFieldsCard typeId={saved.id} {...attachments} />
            </div>
          )}
          <div className="flex min-w-0 flex-col gap-4">
            <SettingsCard title={saved.displayName}>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="type-display-name">
                  <FormattedMessage {...messages.displayName} />
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="type-display-name"
                    className="w-80 min-w-0 max-w-full"
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

              {identityExtra}

              {inUse && (
                <p className="text-sm text-muted">
                  <FormattedMessage {...inUse} values={{ count: saved.inUseCount }} />
                </p>
              )}
            </SettingsCard>
            {extraCards}
          </div>
        </div>
      </div>
    </>
  );
}
