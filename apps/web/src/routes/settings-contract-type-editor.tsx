// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract type editor (#84), from the ST16 frame of settings.pen:
 * one CTR-002 type's own screen, reached from its row on the Types
 * pane. The left card edits identity — display name and description on
 * DES-017 commit-on-confirm inputs, the immutable slug as a fact — and
 * the right card is the CTR-016 attachment surface: catalog fields in
 * per-type order with drag or arrow-key reorder, a per-attachment
 * required checkbox, detach, and an Attach menu over the catalog's
 * unattached contract and global fields. Every change applies
 * immediately on save (SET-003). The loader is the client half of
 * SET-002's gate; the API's 403 is the real refusal.
 */

import { useRef, useState, type DragEvent } from "react";
import { Link, redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { FormattedMessage, useIntl, type IntlShape } from "react-intl";
import { ArrowLeft, GripVertical, Plus, X } from "lucide-react";
import { api } from "../lib/api";
import { problemDetail } from "../lib/messages";
import { currentUser, needsSetup } from "../lib/session";
import { ContractsSettingsTabs } from "../components/contracts-settings-tabs";
import { PageTitle } from "../components/page-title";
import { SettingsCard } from "../components/settings-card";
import { StatusNote, type FieldStatus } from "../components/status-note";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export async function settingsContractTypeEditorLoader({ params }: LoaderFunctionArgs) {
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  if (user.role !== "administrator") return redirect("/settings/profile");
  const id = params.typeId!;
  const [typeRes, attachedRes, catalogRes] = await Promise.all([
    api.GET("/api/v1/contract-types/{id}", { params: { path: { id } } }),
    api.GET("/api/v1/contract-types/{id}/fields", { params: { path: { id } } }),
    api.GET("/api/v1/fields", {}),
  ]);
  if (!typeRes.data || !attachedRes.data || !catalogRes.data) {
    throw new Error("The contract type could not be read.");
  }
  return {
    contractType: typeRes.data.contractType,
    attachedFields: attachedRes.data.attachedFields,
    catalog: catalogRes.data.fields,
  };
}

/** GET /contract-types/:id's payload, as the client sees it. */
interface TypeRow {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  archivedAt: string | null;
  inUseCount: number;
}

type FieldType =
  | "text"
  | "long_text"
  | "number"
  | "date"
  | "boolean"
  | "single_select"
  | "multi_select"
  | "user"
  | "entity";

/** One row of GET /contract-types/:id/fields, as the client sees it. */
interface AttachedRow {
  fieldId: string;
  slug: string;
  displayName: string;
  fieldType: FieldType;
  moduleScope: "contract" | "global";
  displayOrder: number;
  isRequired: boolean;
}

/** One catalog row the Attach menu offers (GET /fields, live only). */
interface CatalogRow {
  id: string;
  displayName: string;
  moduleScope: "contract" | "global";
  fieldType: FieldType;
}

/** The Fields pane's vocabulary, reused verbatim (one id, one label). */
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

/** The ST16 field caption: the type, with the scope riding along only
 * when it is global — "Single select · global". */
function fieldCaption(intl: IntlShape, row: { fieldType: FieldType; moduleScope: string }) {
  const label = typeLabel(intl, row.fieldType);
  return row.moduleScope === "global"
    ? intl.formatMessage(
        {
          id: "settings.contractTypeEditor.globalCaption",
          defaultMessage: "{type} · global",
        },
        { type: label },
      )
    : label;
}

export function SettingsContractTypeEditorPage() {
  const { contractType, attachedFields, catalog } =
    useLoaderData<typeof settingsContractTypeEditorLoader>();
  const intl = useIntl();

  const [saved, setSaved] = useState<TypeRow>(contractType);
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

  const [rows, setRows] = useState<AttachedRow[]>(attachedFields);
  const [rowStatus, setRowStatus] = useState<Record<string, FieldStatus>>({});
  const [rowError, setRowError] = useState<Record<string, string | undefined>>({});
  const [orderStatus, setOrderStatus] = useState<FieldStatus>("idle");
  const [orderError, setOrderError] = useState<string | undefined>(undefined);
  const [attachStatus, setAttachStatus] = useState<FieldStatus>("idle");
  const [attachError, setAttachError] = useState<string | undefined>(undefined);
  const [announcement, setAnnouncement] = useState("");
  const dragFrom = useRef<number | null>(null);

  const attachable: CatalogRow[] = catalog.filter(
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
    const { data, error } = await api
      .PATCH("/api/v1/contract-types/{id}", {
        params: { path: { id: saved.id } },
        body,
      })
      .catch(() => ({ data: null, error: undefined }));
    if (data) {
      setSaved(data.contractType);
      setNameDraft(data.contractType.displayName);
      setDescriptionDraft(data.contractType.description ?? "");
      setTypeStatus((current) => ({ ...current, [key]: "saved" }));
      setTypeError((current) => ({ ...current, [key]: undefined }));
    } else {
      setTypeStatus((current) => ({ ...current, [key]: "error" }));
      setTypeError((current) => ({ ...current, [key]: problemDetail(error) }));
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

  async function attach(field: CatalogRow) {
    setAttachStatus("saving");
    setAttachError(undefined);
    const { data, error } = await api
      .POST("/api/v1/contract-types/{id}/fields", {
        params: { path: { id: saved.id } },
        body: { fieldId: field.id },
      })
      .catch(() => ({ data: null, error: undefined }));
    if (data) {
      setRows((current) => [...current, data.attachedField]);
      setAttachStatus("saved");
    } else {
      setAttachStatus("error");
      setAttachError(problemDetail(error));
    }
  }

  async function detach(row: AttachedRow) {
    noteRow(row.fieldId, "saving");
    const { error, response } = await api
      .DELETE("/api/v1/contract-types/{id}/fields/{fieldId}", {
        params: { path: { id: saved.id, fieldId: row.fieldId } },
      })
      .catch(() => ({ error: {}, response: null }));
    if (response?.ok) {
      setRows((current) => current.filter((existing) => existing.fieldId !== row.fieldId));
      noteRow(row.fieldId, "idle");
      setAnnouncement(
        intl.formatMessage(
          {
            id: "settings.contractTypeEditor.detached",
            defaultMessage: "{name} detached.",
          },
          { name: row.displayName },
        ),
      );
    } else {
      noteRow(row.fieldId, "error", problemDetail(error));
    }
  }

  async function toggleRequired(row: AttachedRow, isRequired: boolean) {
    noteRow(row.fieldId, "saving");
    const { data, error } = await api
      .PATCH("/api/v1/contract-types/{id}/fields/{fieldId}", {
        params: { path: { id: saved.id, fieldId: row.fieldId } },
        body: { isRequired },
      })
      .catch(() => ({ data: null, error: undefined }));
    if (data) {
      setRows((current) =>
        current.map((existing) =>
          existing.fieldId === row.fieldId ? data.attachedField : existing,
        ),
      );
      noteRow(row.fieldId, "saved");
    } else {
      noteRow(row.fieldId, "error", problemDetail(error));
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
    const { data, error } = await api
      .PUT("/api/v1/contract-types/{id}/fields/order", {
        params: { path: { id: saved.id } },
        body: { fieldIds },
      })
      .catch(() => ({ data: null, error: undefined }));
    if (data) {
      setRows(data.attachedFields);
      setOrderStatus("saved");
      setAnnouncement(
        intl.formatMessage(
          {
            id: "settings.contractTypeEditor.moved",
            defaultMessage: "{name} moved to position {position} of {total}.",
          },
          { name: row.displayName, position: toIndex + 1, total: rows.length },
        ),
      );
    } else {
      setOrderStatus("error");
      setOrderError(problemDetail(error));
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
        <ContractsSettingsTabs />
        <Link
          to="/settings/contracts/types"
          className="flex w-fit items-center gap-1.5 rounded-chip text-sm font-medium text-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          <FormattedMessage id="settings.contractTypeEditor.allTypes" defaultMessage="All types" />
        </Link>
        <div className="flex flex-wrap items-start gap-4">
          <SettingsCard title={saved.displayName} className="w-140 shrink-0 grow-0">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="type-display-name">
                <FormattedMessage
                  id="settings.contractTypeEditor.displayName"
                  defaultMessage="Display name"
                />
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
                <FormattedMessage
                  id="settings.contractTypeEditor.description"
                  defaultMessage="Description"
                />
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
                <FormattedMessage id="settings.contractTypeEditor.slug" defaultMessage="Slug" />
              </Label>
              <Input
                id="type-slug"
                className="w-80 text-muted"
                value={saved.slug}
                readOnly
                aria-describedby="type-slug-note"
              />
              <p id="type-slug-note" className="text-xs text-muted">
                <FormattedMessage
                  id="settings.contractTypeEditor.slugNote"
                  defaultMessage="Slug is immutable — it keys templates, approval rules, and the API."
                />
              </p>
            </div>

            <p className="text-sm text-muted">
              <FormattedMessage
                id="settings.contractTypeEditor.inUse"
                defaultMessage="{count, plural, one {# contract uses this type.} other {# contracts use this type.}}"
                values={{ count: saved.inUseCount }}
              />
            </p>
          </SettingsCard>

          <div className="flex min-w-80 flex-1 flex-col gap-2">
            <SettingsCard
              title={
                <FormattedMessage
                  id="settings.contractTypeEditor.attachedFields"
                  defaultMessage="Attached fields"
                />
              }
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
                  <FormattedMessage
                    id="settings.contractTypeEditor.fieldColumn"
                    defaultMessage="Field"
                  />
                </span>
                <span className="w-24 px-3 text-xs font-semibold text-muted">
                  <FormattedMessage
                    id="settings.contractTypeEditor.requiredColumn"
                    defaultMessage="Required"
                  />
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
                        disabled={orderStatus === "saving"}
                        aria-label={intl.formatMessage(
                          {
                            id: "settings.contractTypeEditor.reorder",
                            defaultMessage:
                              "Reorder {name}, position {position} of {total}. " +
                              "Use the arrow keys to move it.",
                          },
                          { name: row.displayName, position: index + 1, total: rows.length },
                        )}
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
                        {fieldCaption(intl, row)}
                      </span>
                    </span>
                    <span className="flex w-24 items-center px-3">
                      <Checkbox
                        checked={row.isRequired}
                        disabled={rowStatus[row.fieldId] === "saving"}
                        aria-label={intl.formatMessage(
                          {
                            id: "settings.contractTypeEditor.requiredFor",
                            defaultMessage: "{name} required",
                          },
                          { name: row.displayName },
                        )}
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
                        aria-label={intl.formatMessage(
                          {
                            id: "settings.contractTypeEditor.detach",
                            defaultMessage: "Detach {name}",
                          },
                          { name: row.displayName },
                        )}
                        onClick={() => void detach(row)}
                      >
                        <X size={16} aria-hidden="true" className="text-muted" />
                      </Button>
                    </span>
                  </li>
                ))}
                {rows.length === 0 && (
                  <li className="flex h-11 items-center border-b border-border-muted px-4 text-sm text-muted">
                    <FormattedMessage
                      id="settings.contractTypeEditor.empty"
                      defaultMessage="No fields are attached to this type."
                    />
                  </li>
                )}
              </ul>
              <div className="flex items-center gap-2 px-4 py-2.5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary" size="sm" disabled={attachable.length === 0}>
                      <Plus size={16} aria-hidden="true" />
                      <FormattedMessage
                        id="settings.contractTypeEditor.attach"
                        defaultMessage="Attach field"
                      />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {attachable.map((field) => (
                      <DropdownMenuItem key={field.id} onSelect={() => void attach(field)}>
                        <span className="text-base text-primary">{field.displayName}</span>
                        <span className="text-sm text-muted">{fieldCaption(intl, field)}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <StatusNote status={attachStatus} detail={attachError} />
                {attachable.length === 0 && (
                  <span className="text-sm text-muted">
                    <FormattedMessage
                      id="settings.contractTypeEditor.allAttached"
                      defaultMessage="Every catalog field is attached."
                    />
                  </span>
                )}
              </div>
            </SettingsCard>
            <p className="text-sm text-muted">
              <FormattedMessage
                id="settings.contractTypeEditor.help"
                defaultMessage="Drag to reorder. Required fields are enforced at creation and re-type; detaching a field keeps stored values."
              />
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
