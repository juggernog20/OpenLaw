// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Contracts · Statuses (#82), the DES-020 list-editor extended per the
 * ST10 frame of settings.pen: the CTR-001 taxonomy with the stage badge
 * in the qualifier-pill slot, `draft`, `active`, and `expired` locked,
 * drag or arrow-key reorder, and an inline draft row whose stage is
 * picked at creation and immutable after. The archive guard blocks
 * instead of offering reassignment — SET-003's structural-minimum rule,
 * recorded for statuses as CTR-020. It blocks on two things: the CTR-001
 * floor (every stage keeps one unarchived status), and contracts that
 * still hold the status, which the Administrator moves. Every
 * mutation applies immediately on save. The shared anatomy lives in the
 * ListEditor component (extracted with #83); this pane owns the CTR-001
 * vocabulary, the API calls, and the guard dialog. The loader is the
 * client half of SET-002's gate; the API's 403 is the real refusal.
 */

import { useRef, useState } from "react";
import { redirect, useLoaderData } from "react-router";
import { FormattedMessage, useIntl, type IntlShape } from "react-intl";
import { History, TriangleAlert } from "lucide-react";
import { api } from "../lib/api";
import { problemDetail } from "../lib/messages";
import { currentUser, needsSetup } from "../lib/session";
import { ContractsSettingsTabs } from "../components/contracts-settings-tabs";
import { ListEditor } from "../components/list-editor";
import { PageTitle } from "../components/page-title";
import { StatusNote, type FieldStatus } from "../components/status-note";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";

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
  /** The CTR-001 floor: the target is its stage's last unarchived
   * status. The other block — contracts still on the status — rides
   * `target.inUseCount`, so the dialog reads it from the row. */
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
                reassignment (SET-003, CTR-020) — no select here, ever.
                The floor reads first, in the order the API checks. */}
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
                    "one {{name} is the status of # contract. Move it to another status " +
                    "first.} other {{name} is the status of # contracts. Move them to " +
                    "another status first.}}"
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
              disabled={blocked || target.inUseCount > 0 || busy}
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
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<{ name: string; stage: Stage | "" }>({
    name: "",
    stage: "",
  });
  const [addStatus, setAddStatus] = useState<FieldStatus>("idle");
  const [addError, setAddError] = useState<string | undefined>(undefined);
  const [archiveTarget, setArchiveTarget] = useState<StatusRow | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  const createInFlight = useRef(false);

  const live = rows.filter((row) => !row.archivedAt).sort(byDisplayOrder);
  const archived = rows.filter((row) => row.archivedAt).sort(byDisplayOrder);

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

  async function rename(row: StatusRow, displayName: string) {
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

  /** One validated move from the grip (arrow key or drop) — commit the
   * permutation and announce the landing position (DES-020). */
  async function move(fromIndex: number, toIndex: number) {
    const row = live[fromIndex]!;
    const ids = live.map(({ id }) => id);
    ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, row.id);
    if (await commitOrder(ids)) {
      setAnnouncement(
        intl.formatMessage(
          {
            id: "settings.contractStatuses.moved",
            defaultMessage: "{name} moved to position {position} of {total}.",
          },
          { name: row.displayName, position: toIndex + 1, total: live.length },
        ),
      );
    }
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

  /** The ST10 stage badge, in DES-020's qualifier-pill slot. The
   * sr-only prefix keeps a row like Draft/Draft unambiguous to a
   * reader: the name is the label, the badge is "Stage: Draft". */
  function stageBadge(row: StatusRow) {
    return (
      <span className="inline-flex rounded-chip bg-control px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-muted">
        <span className="sr-only">
          <FormattedMessage
            id="settings.contractStatuses.stageBadgePrefix"
            defaultMessage="Stage:"
          />{" "}
        </span>
        {stageLabel(intl, row.stage)}
      </span>
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
        <ListEditor
          rows={live}
          archivedRows={archived}
          title={
            <FormattedMessage
              id="settings.contractStatuses.title"
              defaultMessage="Contract statuses"
            />
          }
          count={
            <FormattedMessage
              id="settings.contractStatuses.count"
              defaultMessage="{count, plural, one {# status} other {# statuses}}"
              values={{ count: live.length }}
            />
          }
          addLabel={
            <FormattedMessage id="settings.contractStatuses.add" defaultMessage="Add status" />
          }
          onAdd={() => {
            setAdding(true);
            setAddDraft({ name: "", stage: "" });
            setAddStatus("idle");
            setAddError(undefined);
          }}
          help={
            <FormattedMessage
              id="settings.contractStatuses.help"
              defaultMessage={
                "Drag to reorder. Statuses map to a fixed stage picked at creation; every " +
                "stage keeps at least one unarchived status."
              }
            />
          }
          rowStatus={rowStatus}
          rowError={rowError}
          renameLabel={(row) =>
            intl.formatMessage(
              { id: "settings.contractStatuses.renameLabel", defaultMessage: "Rename {name}" },
              { name: row.displayName },
            )
          }
          onRename={(row, displayName) => void rename(row, displayName)}
          rowDetails={stageBadge}
          rowMeta={(row) => (
            <FormattedMessage
              id="settings.contractStatuses.inUse"
              defaultMessage="{count, plural, one {# contract} other {# contracts}}"
              values={{ count: row.inUseCount }}
            />
          )}
          protectedLabel={(row) =>
            PROTECTED_SLUGS.has(row.slug)
              ? intl.formatMessage(
                  {
                    id: "settings.contractStatuses.locked",
                    defaultMessage: "{name} is system-protected and can't be archived",
                  },
                  { name: row.displayName },
                )
              : null
          }
          archiveLabel={(row) =>
            intl.formatMessage(
              { id: "settings.contractStatuses.archive", defaultMessage: "Archive {name}" },
              { name: row.displayName },
            )
          }
          onArchive={setArchiveTarget}
          restoreLabel={(row) =>
            intl.formatMessage(
              { id: "settings.contractStatuses.restore", defaultMessage: "Restore {name}" },
              { name: row.displayName },
            )
          }
          onRestore={(row) => void restore(row)}
          reorder={{
            status: orderStatus,
            detail: orderError,
            gripLabel: (row, position, total) =>
              intl.formatMessage(
                {
                  id: "settings.contractStatuses.reorder",
                  defaultMessage:
                    "Reorder {name}, position {position} of {total}. " +
                    "Use the arrow keys to move it.",
                },
                { name: row.displayName, position, total },
              ),
            onMove: (fromIndex, toIndex) => void move(fromIndex, toIndex),
          }}
          adding={adding}
          addRow={
            <>
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
                onChange={(event) => {
                  const stage = event.target.value as Stage | "";
                  setAddDraft((current) => ({ ...current, stage }));
                  // Picking a stage answers the "pick a stage"
                  // refusal — don't leave it standing.
                  if (stage !== "" && addStatus === "error") {
                    setAddStatus("idle");
                    setAddError(undefined);
                  }
                }}
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
            </>
          }
          announcement={announcement}
          listRef={listRef}
        />
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
