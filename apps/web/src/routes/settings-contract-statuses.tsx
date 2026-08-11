// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Contracts · Statuses (#82), the DES-020 list-editor extended per the
 * ST10 frame of settings.pen: the CTR-001 taxonomy as 44px rows — grip,
 * in-place rename, the stage badge in the qualifier-pill slot, usage
 * count, archive — with `draft`, `active`, and `expired` locked, drag
 * or arrow-key reorder, and an inline draft row whose stage is picked
 * at creation and immutable after. The archive guard blocks at the
 * CTR-001 floor (every stage keeps one unarchived status) instead of
 * offering reassignment — SET-003's structural-minimum rule. Every
 * mutation applies immediately on save. The loader is the client half
 * of SET-002's gate; the API's 403 is the real refusal.
 */

import { useRef, useState, type DragEvent } from "react";
import { redirect, useLoaderData } from "react-router";
import { FormattedMessage, useIntl, type IntlShape } from "react-intl";
import {
  Archive,
  ArchiveRestore,
  GripVertical,
  History,
  Lock,
  Plus,
  TriangleAlert,
} from "lucide-react";
import { api } from "../lib/api";
import { problemDetail } from "../lib/messages";
import { currentUser, needsSetup } from "../lib/session";
import { ContractsSettingsTabs } from "../components/contracts-settings-tabs";
import { PageTitle } from "../components/page-title";
import { SettingsCard } from "../components/settings-card";
import { StatusNote, type FieldStatus } from "../components/status-note";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";

export async function settingsContractStatusesLoader() {
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  if (user.role !== "administrator") return redirect("/settings/profile");
  const { data } = await api.GET("/api/v1/contract-statuses", {
    params: { query: { includeArchived: "true" } },
  });
  if (!data) throw new Error("The contract statuses could not be read.");
  return { contractStatuses: data.contractStatuses };
}

/** The fixed six-stage backbone (CTR-001), in canonical forward order. */
const STAGES = ["draft", "review", "approval", "signature", "active", "ended"] as const;
type Stage = (typeof STAGES)[number];

/** The CTR-001 system-protected seeds: no archive, no hard delete. */
const PROTECTED_SLUGS = new Set(["draft", "active", "expired"]);

/** One row of GET /contract-statuses, as the client sees it. */
interface StatusRow {
  id: string;
  slug: string;
  displayName: string;
  stage: Stage;
  displayOrder: number;
  isSystemDefault: boolean;
  archivedAt: string | null;
  inUseCount: number;
}

const byDisplayOrder = (a: StatusRow, b: StatusRow) => a.displayOrder - b.displayOrder;

/** The fixed stage names — never sourced from a status label (CTR-001). */
function stageLabel(intl: IntlShape, stage: Stage): string {
  return intl.formatMessage(
    {
      id: "settings.contractStatuses.stageLabel",
      defaultMessage:
        "{stage, select, draft {Draft} review {Review} approval {Approval} " +
        "signature {Signature} active {Active} ended {Ended} other {Unknown}}",
    },
    { stage },
  );
}

function ArchiveStatusDialog({
  target,
  blocked,
  onOpenChange,
  onArchived,
  onArchivedCloseFocus,
}: Readonly<{
  target: StatusRow;
  /** The CTR-001 floor: the target is its stage's last unarchived status. */
  blocked: boolean;
  onOpenChange: (open: boolean) => void;
  onArchived: (row: StatusRow) => void;
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
      const { data, error: problem } = await api.POST("/api/v1/contract-statuses/{id}/archive", {
        params: { path: { id: target.id } },
      });
      if (data) {
        archived.current = true;
        onArchived(data.contractStatus);
        onOpenChange(false);
      } else {
        // The API's own refusal (a protected row, the floor, a stale
        // list) is more actionable than any generic line.
        setError(
          problemDetail(problem) ??
            intl.formatMessage({
              id: "settings.contractStatuses.archiveError",
              defaultMessage: "The status could not be archived.",
            }),
        );
      }
    } catch {
      // A network-level failure never produces a problem envelope.
      setError(
        intl.formatMessage({
          id: "settings.contractStatuses.archiveError",
          defaultMessage: "The status could not be archived.",
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
            id="settings.contractStatuses.archiveTitle"
            defaultMessage="Archive {name}"
            values={{ name: target.displayName }}
          />
        </DialogTitle>
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex items-start gap-2 rounded-card bg-status-warning-bg p-3 text-sm text-status-warning-fg">
            <TriangleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            {/* Statuses block at structural minimums instead of offering
                reassignment (SET-003) — no select here, ever. */}
            <p>
              {blocked ? (
                <FormattedMessage
                  id="settings.contractStatuses.archiveBlocked"
                  defaultMessage={
                    "{name} is the last unarchived status in its stage — every stage keeps " +
                    "at least one. Add another status to the stage first."
                  }
                  values={{ name: target.displayName }}
                />
              ) : (
                <FormattedMessage
                  id="settings.contractStatuses.archiveWarning"
                  defaultMessage={
                    "{count, plural, =0 {{name} is not used by any contracts.} " +
                    "one {{name} is used by # contract, which keeps its status until " +
                    "someone moves it.} other {{name} is used by # contracts, which keep " +
                    "their status until someone moves them.}}"
                  }
                  values={{ name: target.displayName, count: target.inUseCount }}
                />
              )}
            </p>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <History size={16} aria-hidden="true" />
            <FormattedMessage
              id="settings.contractStatuses.auditNote"
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
            <Button
              type="button"
              variant="danger"
              disabled={blocked || busy}
              onClick={() => void submit()}
            >
              <FormattedMessage
                id="settings.contractStatuses.archiveSubmit"
                defaultMessage="Archive status"
              />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SettingsContractStatusesPage() {
  const { contractStatuses } = useLoaderData<typeof settingsContractStatusesLoader>();
  const intl = useIntl();

  const [rows, setRows] = useState<StatusRow[]>(contractStatuses);
  const [rowStatus, setRowStatus] = useState<Record<string, FieldStatus>>({});
  const [rowError, setRowError] = useState<Record<string, string | undefined>>({});
  const [orderStatus, setOrderStatus] = useState<FieldStatus>("idle");
  const [orderError, setOrderError] = useState<string | undefined>(undefined);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<{ name: string; stage: Stage | "" }>({
    name: "",
    stage: "",
  });
  const [addStatus, setAddStatus] = useState<FieldStatus>("idle");
  const [addError, setAddError] = useState<string | undefined>(undefined);
  const [archiveTarget, setArchiveTarget] = useState<StatusRow | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const dragFrom = useRef<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const createInFlight = useRef(false);

  const live = rows.filter((row) => !row.archivedAt).sort(byDisplayOrder);
  const archived = rows.filter((row) => row.archivedAt).sort(byDisplayOrder);
  const hasArchived = archived.length > 0;

  /** The CTR-001 floor, client-side: is this row its stage's last live one? */
  const lastLiveInStage = (row: StatusRow) =>
    !live.some((candidate) => candidate.stage === row.stage && candidate.id !== row.id);

  function noteRow(id: string, status: FieldStatus, detail?: string) {
    setRowStatus((current) => ({ ...current, [id]: status }));
    setRowError((current) => ({ ...current, [id]: detail }));
  }

  function replaceRow(row: StatusRow) {
    setRows((current) => current.map((existing) => (existing.id === row.id ? row : existing)));
  }

  async function rename(row: StatusRow, draft: string) {
    setEditing(null);
    const displayName = draft.trim();
    // Nothing to save (or nothing valid): revert per DES-017.
    if (displayName === "" || displayName === row.displayName) return;
    noteRow(row.id, "saving");
    const { data, error } = await api
      .PATCH("/api/v1/contract-statuses/{id}", {
        params: { path: { id: row.id } },
        body: { displayName },
      })
      .catch(() => ({ data: null, error: undefined }));
    if (data) {
      replaceRow(data.contractStatus);
      noteRow(row.id, "saved");
    } else {
      noteRow(row.id, "error", problemDetail(error));
    }
  }

  async function create() {
    // Enter can land while a create is already posting — a ref, set
    // synchronously, keeps a double-tap from posting the draft twice.
    if (createInFlight.current) return;
    const displayName = addDraft.name.trim();
    if (displayName === "") {
      setAdding(false);
      return;
    }
    // The stage is the creation-time immutable dimension (CTR-001):
    // there is no create without one.
    if (addDraft.stage === "") {
      setAddStatus("error");
      setAddError(
        intl.formatMessage({
          id: "settings.contractStatuses.stageMissing",
          defaultMessage: "Pick a stage for the new status.",
        }),
      );
      return;
    }
    createInFlight.current = true;
    setAddStatus("saving");
    setAddError(undefined);
    try {
      const { data, error } = await api
        .POST("/api/v1/contract-statuses", {
          body: { displayName, stage: addDraft.stage },
        })
        .catch(() => ({ data: null, error: undefined }));
      if (data) {
        setRows((current) => [...current, data.contractStatus]);
        setAdding(false);
        setAddDraft({ name: "", stage: "" });
        setAddStatus("saved");
      } else {
        // Keep the draft row open so the name is not lost to a refusal.
        setAddStatus("error");
        setAddError(problemDetail(error));
      }
    } finally {
      createInFlight.current = false;
    }
  }

  /** Commits a full permutation of the live rows (SET-003: immediately). */
  async function commitOrder(orderedIds: string[]) {
    setOrderStatus("saving");
    setOrderError(undefined);
    const { data, error } = await api
      .PUT("/api/v1/contract-statuses/order", { body: { ids: orderedIds } })
      .catch(() => ({ data: null, error: undefined }));
    if (data) {
      const reordered: StatusRow[] = data.contractStatuses;
      setRows((current) => [
        ...reordered,
        ...current.filter((row) => !reordered.some((moved) => moved.id === row.id)),
      ]);
      setOrderStatus("saved");
      return true;
    }
    setOrderStatus("error");
    setOrderError(problemDetail(error));
    return false;
  }

  /** Arrow-key reorder from the grip: one position per press (DES-020). */
  async function moveBy(row: StatusRow, delta: -1 | 1) {
    if (orderStatus === "saving") return;
    const index = live.findIndex(({ id }) => id === row.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= live.length) return;
    const ids = live.map(({ id }) => id);
    ids.splice(index, 1);
    ids.splice(target, 0, row.id);
    if (await commitOrder(ids)) {
      setAnnouncement(
        intl.formatMessage(
          {
            id: "settings.contractStatuses.moved",
            defaultMessage: "{name} moved to position {position} of {total}.",
          },
          { name: row.displayName, position: target + 1, total: live.length },
        ),
      );
    }
  }

  function drop(event: DragEvent, targetIndex: number) {
    event.preventDefault();
    const from = dragFrom.current;
    dragFrom.current = null;
    if (from === null || from === targetIndex || orderStatus === "saving") return;
    const ids = live.map(({ id }) => id);
    const [moved] = ids.splice(from, 1);
    ids.splice(targetIndex, 0, moved!);
    void commitOrder(ids);
  }

  async function restore(row: StatusRow) {
    noteRow(row.id, "saving");
    const { data, error } = await api
      .POST("/api/v1/contract-statuses/{id}/restore", { params: { path: { id: row.id } } })
      .catch(() => ({ data: null, error: undefined }));
    if (data) {
      replaceRow(data.contractStatus);
      noteRow(row.id, "saved");
    } else {
      noteRow(row.id, "error", problemDetail(error));
    }
  }

  /** The ST10 stage badge, in DES-020's qualifier-pill slot. */
  function stageBadge(row: StatusRow) {
    return (
      <span
        data-testid="stage-badge"
        className="inline-flex rounded-chip bg-control px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-muted"
      >
        {stageLabel(intl, row.stage)}
      </span>
    );
  }

  function nameCell(row: StatusRow) {
    if (editing?.id === row.id) {
      return (
        <Input
          autoFocus
          value={editing.draft}
          aria-label={intl.formatMessage(
            { id: "settings.contractStatuses.renameLabel", defaultMessage: "Rename {name}" },
            { name: row.displayName },
          )}
          className="h-7 w-64 max-w-full"
          onChange={(event) => setEditing({ id: row.id, draft: event.target.value })}
          onBlur={() => void rename(row, editing.draft)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void rename(row, editing.draft);
            if (event.key === "Escape") setEditing(null);
          }}
        />
      );
    }
    return (
      <button
        type="button"
        // In-place rename (DES-017/DES-020): the name IS the editor.
        onClick={() => setEditing({ id: row.id, draft: row.displayName })}
        aria-label={intl.formatMessage(
          { id: "settings.contractStatuses.renameLabel", defaultMessage: "Rename {name}" },
          { name: row.displayName },
        )}
        className="rounded-chip text-base font-medium text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
      >
        {row.displayName}
      </button>
    );
  }

  function trailingAction(row: StatusRow) {
    if (row.archivedAt) {
      return (
        <Button
          variant="ghost"
          size="sm"
          className="px-1.5"
          disabled={rowStatus[row.id] === "saving"}
          aria-label={intl.formatMessage(
            { id: "settings.contractStatuses.restore", defaultMessage: "Restore {name}" },
            { name: row.displayName },
          )}
          onClick={() => void restore(row)}
        >
          <ArchiveRestore size={16} aria-hidden="true" className="text-muted" />
        </Button>
      );
    }
    if (PROTECTED_SLUGS.has(row.slug)) {
      // The lock, not a disabled button (DES-020): protection is a fact
      // about the row, and the server refuses regardless.
      return (
        <span className="flex size-7 items-center justify-center">
          <Lock
            size={16}
            role="img"
            aria-label={intl.formatMessage(
              {
                id: "settings.contractStatuses.locked",
                defaultMessage: "{name} is system-protected and can't be archived",
              },
              { name: row.displayName },
            )}
            className="text-muted"
          />
        </span>
      );
    }
    return (
      <Button
        variant="ghost"
        size="sm"
        className="px-1.5"
        disabled={rowStatus[row.id] === "saving"}
        aria-label={intl.formatMessage(
          { id: "settings.contractStatuses.archive", defaultMessage: "Archive {name}" },
          { name: row.displayName },
        )}
        onClick={() => setArchiveTarget(row)}
      >
        <Archive size={16} aria-hidden="true" className="text-muted" />
      </Button>
    );
  }

  return (
    <>
      <PageTitle
        title={intl.formatMessage({
          id: "settings.contractStatuses.pageTitle",
          defaultMessage: "Contract statuses",
        })}
      />
      <div className="flex w-full max-w-(--width-settings-card) flex-col gap-4">
        <ContractsSettingsTabs />
        <div className="flex flex-col gap-2">
          <SettingsCard
            title={
              <FormattedMessage
                id="settings.contractStatuses.title"
                defaultMessage="Contract statuses"
              />
            }
            flush
            actions={
              <div className="flex items-center gap-3">
                {hasArchived && (
                  <span className="flex items-center gap-2 text-sm text-muted">
                    <FormattedMessage
                      id="settings.contractStatuses.showArchived"
                      defaultMessage="Show archived"
                    />
                    <Switch
                      checked={showArchived}
                      onCheckedChange={setShowArchived}
                      aria-label={intl.formatMessage({
                        id: "settings.contractStatuses.showArchived",
                        defaultMessage: "Show archived",
                      })}
                    />
                  </span>
                )}
                <span className="text-sm whitespace-nowrap text-muted">
                  <FormattedMessage
                    id="settings.contractStatuses.count"
                    defaultMessage="{count, plural, one {# status} other {# statuses}}"
                    values={{ count: live.length }}
                  />
                </span>
                <StatusNote status={orderStatus} detail={orderError} />
                <Button
                  size="sm"
                  className="px-3 whitespace-nowrap"
                  onClick={() => {
                    setAdding(true);
                    setAddDraft({ name: "", stage: "" });
                    setAddStatus("idle");
                    setAddError(undefined);
                  }}
                >
                  <Plus size={16} aria-hidden="true" />
                  <FormattedMessage
                    id="settings.contractStatuses.add"
                    defaultMessage="Add status"
                  />
                </Button>
              </div>
            }
          >
            {/* Keyboard moves are announced here; the row order itself is
                silent to a reader (WCAG 4.1.3). */}
            <span aria-live="polite" className="sr-only">
              {announcement}
            </span>
            {/* tabIndex -1: the archive dialog parks focus here when the
                row it was opened from has left the list. */}
            <ul ref={listRef} tabIndex={-1}>
              {live.map((row, index) => (
                <li
                  key={row.id}
                  draggable={editing?.id !== row.id}
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
                          id: "settings.contractStatuses.reorder",
                          defaultMessage:
                            "Reorder {name}, position {position} of {total}. " +
                            "Use the arrow keys to move it.",
                        },
                        { name: row.displayName, position: index + 1, total: live.length },
                      )}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowUp") {
                          event.preventDefault();
                          void moveBy(row, -1);
                        }
                        if (event.key === "ArrowDown") {
                          event.preventDefault();
                          void moveBy(row, 1);
                        }
                      }}
                    >
                      <GripVertical size={16} aria-hidden="true" className="text-muted" />
                    </Button>
                  </span>
                  <span className="flex min-w-0 flex-1 items-center gap-2 ps-1">
                    {nameCell(row)}
                    {stageBadge(row)}
                  </span>
                  <span className="px-3 text-sm whitespace-nowrap text-muted">
                    <FormattedMessage
                      id="settings.contractStatuses.inUse"
                      defaultMessage="{count, plural, one {# contract} other {# contracts}}"
                      values={{ count: row.inUseCount }}
                    />
                  </span>
                  <span className="flex items-center gap-1">
                    <StatusNote status={rowStatus[row.id] ?? "idle"} detail={rowError[row.id]} />
                    {trailingAction(row)}
                  </span>
                </li>
              ))}
              {adding && (
                <li className="flex h-11 items-center gap-2 border-b border-border-muted pe-3 ps-9">
                  <Input
                    autoFocus
                    value={addDraft.name}
                    aria-label={intl.formatMessage({
                      id: "settings.contractStatuses.addName",
                      defaultMessage: "New status name",
                    })}
                    className="h-7 w-52 max-w-full"
                    onChange={(event) =>
                      setAddDraft((current) => ({ ...current, name: event.target.value }))
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void create();
                      if (event.key === "Escape") setAdding(false);
                    }}
                  />
                  {/* The creation-time immutable dimension (CTR-001): the
                      stage is picked here, once. */}
                  <select
                    value={addDraft.stage}
                    aria-label={intl.formatMessage({
                      id: "settings.contractStatuses.addStage",
                      defaultMessage: "New status stage",
                    })}
                    className="h-7 rounded-button border border-border-default bg-raised px-2 text-sm text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link"
                    onChange={(event) =>
                      setAddDraft((current) => ({
                        ...current,
                        stage: event.target.value as Stage | "",
                      }))
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void create();
                      if (event.key === "Escape") setAdding(false);
                    }}
                  >
                    <option value="">
                      {intl.formatMessage({
                        id: "settings.contractStatuses.stagePlaceholder",
                        defaultMessage: "Stage…",
                      })}
                    </option>
                    {STAGES.map((stage) => (
                      <option key={stage} value={stage}>
                        {stageLabel(intl, stage)}
                      </option>
                    ))}
                  </select>
                  <span className="ps-1">
                    <StatusNote status={addStatus} detail={addError} />
                  </span>
                </li>
              )}
              {showArchived &&
                archived.map((row) => (
                  <li
                    key={row.id}
                    className="flex h-11 items-center border-b border-border-muted pe-3"
                  >
                    <span className="w-9 shrink-0" aria-hidden="true" />
                    {/* ST5's archived treatment: identity at half opacity,
                        a neutral pill, restore in the trailing slot. */}
                    <span className="flex min-w-0 flex-1 items-center gap-2 ps-1">
                      <span className="text-base font-medium text-primary opacity-50">
                        {row.displayName}
                      </span>
                      <span className="opacity-50">{stageBadge(row)}</span>
                      <span className="inline-flex rounded-full bg-status-neutral-bg px-2 py-0.5 text-xs font-semibold text-status-neutral-fg">
                        <FormattedMessage
                          id="settings.contractStatuses.archivedPill"
                          defaultMessage="Archived"
                        />
                      </span>
                    </span>
                    <span className="flex items-center gap-1">
                      <StatusNote status={rowStatus[row.id] ?? "idle"} detail={rowError[row.id]} />
                      {trailingAction(row)}
                    </span>
                  </li>
                ))}
            </ul>
          </SettingsCard>
          <p className="text-sm text-muted">
            <FormattedMessage
              id="settings.contractStatuses.help"
              defaultMessage={
                "Drag to reorder. Statuses map to a fixed stage picked at creation; every " +
                "stage keeps at least one unarchived status."
              }
            />
          </p>
        </div>
      </div>
      {archiveTarget && (
        <ArchiveStatusDialog
          target={archiveTarget}
          blocked={lastLiveInStage(archiveTarget)}
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
