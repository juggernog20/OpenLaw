// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Contracts · Types (#81), the DES-020 list-editor's reference pane,
 * from the ST6 frame of settings.pen: the CTR-002 taxonomy with the
 * `other` row locked, drag or arrow-key reorder, an inline draft row
 * for add, and the SET-003 archive-guard modal (ST8) with its
 * reassignment select. Every mutation applies immediately on save. The
 * shared anatomy lives in the ListEditor component (extracted with
 * #83); this pane owns the CTR-002 vocabulary, the API calls, and the
 * guard dialog. The loader is the client half of SET-002's gate; the
 * API's 403 is the real refusal.
 */

import { useRef, useState, type SubmitEvent as FormSubmitEvent } from "react";
import { redirect, useLoaderData, useNavigate } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { History, Pencil, TriangleAlert } from "lucide-react";
import { api } from "../lib/api";
import { field } from "../lib/forms";
import { problemDetail } from "../lib/messages";
import { currentUser, needsSetup } from "../lib/session";
import { ContractsSettingsTabs } from "../components/contracts-settings-tabs";
import { ListEditor } from "../components/list-editor";
import { PageTitle } from "../components/page-title";
import { StatusNote, type FieldStatus } from "../components/status-note";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

/** The section URL forwards to its first pane (SET-001 deep links). */
export function settingsContractsIndexLoader() {
  return redirect("/settings/contracts/types");
}

export async function settingsContractTypesLoader() {
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  if (user.role !== "administrator") return redirect("/settings/profile");
  const { data } = await api.GET("/api/v1/contract-types", {
    params: { query: { includeArchived: "true" } },
  });
  if (!data) throw new Error("The contract types could not be read.");
  return { contractTypes: data.contractTypes };
}

/** One row of GET /contract-types, as the client sees it. */
interface TypeRow {
  id: string;
  slug: string;
  displayName: string;
  displayOrder: number;
  isSystemDefault: boolean;
  archivedAt: string | null;
  inUseCount: number;
}

const byDisplayOrder = (a: TypeRow, b: TypeRow) => a.displayOrder - b.displayOrder;

function ArchiveTypeDialog({
  target,
  liveTypes,
  onOpenChange,
  onArchived,
  onArchivedCloseFocus,
}: Readonly<{
  target: TypeRow;
  /** Reassignment candidates: every live type but the target. */
  liveTypes: TypeRow[];
  onOpenChange: (open: boolean) => void;
  onArchived: (row: TypeRow) => void;
  /** Where focus lands after a successful archive — the row's archive
   * button unmounts with the row, so the default restore has no home. */
  onArchivedCloseFocus: () => void;
}>) {
  const intl = useIntl();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const archived = useRef(false);
  const candidates = liveTypes.filter((row) => row.id !== target.id);

  async function submit(event: FormSubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const reassignToId = field(new FormData(event.currentTarget), "reassignToId");
    setBusy(true);
    setError(null);
    try {
      const { data, error: problem } = await api.POST("/api/v1/contract-types/{id}/archive", {
        params: { path: { id: target.id } },
        body: reassignToId ? { reassignToId } : {},
      });
      if (data) {
        archived.current = true;
        onArchived(data.contractType);
        onOpenChange(false);
      } else {
        // The API's own refusal (the protected row, a stale target) is
        // more actionable than any generic line.
        setError(
          problemDetail(problem) ??
            intl.formatMessage({
              id: "settings.contractTypes.archiveError",
              defaultMessage: "The type could not be archived.",
            }),
        );
      }
    } catch {
      // A network-level failure never produces a problem envelope.
      setError(
        intl.formatMessage({
          id: "settings.contractTypes.archiveError",
          defaultMessage: "The type could not be archived.",
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
            id="settings.contractTypes.archiveTitle"
            defaultMessage="Archive {name}"
            values={{ name: target.displayName }}
          />
        </DialogTitle>
        <form className="mt-4 flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
          <div className="flex items-start gap-2 rounded-card bg-status-warning-bg p-3 text-sm text-status-warning-fg">
            <TriangleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            <p>
              <FormattedMessage
                id="settings.contractTypes.archiveWarning"
                defaultMessage={
                  "{count, plural, =0 {{name} is not used by any contracts — it can be " +
                  "archived without reassignment.} one {{name} is used by # contract. Pick a " +
                  "replacement type — that contract moves to it when the type is archived.} " +
                  "other {{name} is used by # contracts. Pick a replacement type — those " +
                  "contracts move to it when the type is archived.}}"
                }
                values={{ name: target.displayName, count: target.inUseCount }}
              />
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reassignToId">
              <FormattedMessage
                id="settings.contractTypes.reassignLabel"
                defaultMessage="Reassign {count, plural, =0 {contracts} one {# contract} other {# contracts}} to"
                values={{ count: target.inUseCount }}
              />
            </Label>
            {/* The affordance is always drawn (ST8); with nothing to
                move it waits disabled, and the SET-003 requirement arms
                once contracts exist (M8). */}
            <select
              id="reassignToId"
              name="reassignToId"
              defaultValue=""
              disabled={target.inUseCount === 0}
              required={target.inUseCount > 0}
              className="h-8 w-full rounded-button border border-border-default bg-raised px-2 text-sm text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link disabled:pointer-events-none disabled:opacity-50"
            >
              <option value="">
                {intl.formatMessage({
                  id: "settings.contractTypes.reassignNone",
                  defaultMessage: "No reassignment",
                })}
              </option>
              {candidates.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.displayName}
                </option>
              ))}
            </select>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <History size={16} aria-hidden="true" />
            <FormattedMessage
              id="settings.contractTypes.auditNote"
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
            <Button type="submit" variant="danger" disabled={busy}>
              <FormattedMessage
                id="settings.contractTypes.archiveSubmit"
                defaultMessage="Archive type"
              />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SettingsContractTypesPage() {
  const { contractTypes } = useLoaderData<typeof settingsContractTypesLoader>();
  const intl = useIntl();
  const navigate = useNavigate();

  const [rows, setRows] = useState<TypeRow[]>(contractTypes);
  const [rowStatus, setRowStatus] = useState<Record<string, FieldStatus>>({});
  const [rowError, setRowError] = useState<Record<string, string | undefined>>({});
  const [orderStatus, setOrderStatus] = useState<FieldStatus>("idle");
  const [orderError, setOrderError] = useState<string | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const [addStatus, setAddStatus] = useState<FieldStatus>("idle");
  const [addError, setAddError] = useState<string | undefined>(undefined);
  const [archiveTarget, setArchiveTarget] = useState<TypeRow | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  const createInFlight = useRef(false);

  const live = rows.filter((row) => !row.archivedAt).sort(byDisplayOrder);
  const archived = rows.filter((row) => row.archivedAt).sort(byDisplayOrder);

  function noteRow(id: string, status: FieldStatus, detail?: string) {
    setRowStatus((current) => ({ ...current, [id]: status }));
    setRowError((current) => ({ ...current, [id]: detail }));
  }

  function replaceRow(row: TypeRow) {
    setRows((current) => current.map((existing) => (existing.id === row.id ? row : existing)));
  }

  async function rename(row: TypeRow, displayName: string) {
    noteRow(row.id, "saving");
    const { data, error } = await api
      .PATCH("/api/v1/contract-types/{id}", {
        params: { path: { id: row.id } },
        body: { displayName },
      })
      .catch(() => ({ data: null, error: undefined }));
    if (data) {
      replaceRow(data.contractType);
      noteRow(row.id, "saved");
    } else {
      noteRow(row.id, "error", problemDetail(error));
    }
  }

  async function create(draft: string) {
    // Enter commits and the input then blurs — a ref, set synchronously,
    // keeps the pair from posting the same draft twice.
    if (createInFlight.current) return;
    const displayName = draft.trim();
    if (displayName === "") {
      setAdding(false);
      return;
    }
    createInFlight.current = true;
    setAddStatus("saving");
    setAddError(undefined);
    try {
      const { data, error } = await api
        .POST("/api/v1/contract-types", { body: { displayName } })
        .catch(() => ({ data: null, error: undefined }));
      if (data) {
        setRows((current) => [...current, data.contractType]);
        setAdding(false);
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
      .PUT("/api/v1/contract-types/order", { body: { ids: orderedIds } })
      .catch(() => ({ data: null, error: undefined }));
    if (data) {
      const reordered: TypeRow[] = data.contractTypes;
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
            id: "settings.contractTypes.moved",
            defaultMessage: "{name} moved to position {position} of {total}.",
          },
          { name: row.displayName, position: toIndex + 1, total: live.length },
        ),
      );
    }
  }

  async function restore(row: TypeRow) {
    noteRow(row.id, "saving");
    const { data, error } = await api
      .POST("/api/v1/contract-types/{id}/restore", { params: { path: { id: row.id } } })
      .catch(() => ({ data: null, error: undefined }));
    if (data) {
      replaceRow(data.contractType);
      noteRow(row.id, "saved");
    } else {
      noteRow(row.id, "error", problemDetail(error));
    }
  }

  return (
    <>
      <PageTitle
        title={intl.formatMessage({
          id: "settings.contractTypes.pageTitle",
          defaultMessage: "Contract types",
        })}
      />
      <div className="flex w-full max-w-(--width-settings-card) flex-col gap-4">
        <ContractsSettingsTabs />
        <ListEditor
          rows={live}
          archivedRows={archived}
          title={
            <FormattedMessage id="settings.contractTypes.title" defaultMessage="Contract types" />
          }
          count={
            <FormattedMessage
              id="settings.contractTypes.count"
              defaultMessage="{count, plural, one {# type} other {# types}}"
              values={{ count: live.length }}
            />
          }
          addLabel={<FormattedMessage id="settings.contractTypes.add" defaultMessage="Add type" />}
          onAdd={() => {
            setAdding(true);
            setAddStatus("idle");
            setAddError(undefined);
          }}
          help={
            <FormattedMessage
              id="settings.contractTypes.help"
              defaultMessage="Drag to reorder. Archiving a type in use asks for a replacement; Other can't be archived."
            />
          }
          rowStatus={rowStatus}
          rowError={rowError}
          renameLabel={(row) =>
            intl.formatMessage(
              { id: "settings.contractTypes.renameLabel", defaultMessage: "Rename {name}" },
              { name: row.displayName },
            )
          }
          onRename={(row, displayName) => void rename(row, displayName)}
          rowMeta={(row) => (
            <FormattedMessage
              id="settings.contractTypes.inUse"
              defaultMessage="{count, plural, one {# contract} other {# contracts}}"
              values={{ count: row.inUseCount }}
            />
          )}
          rowActions={(row) => (
            // #84: the row's own editor screen (ST16) — fields attach
            // there, and the description lives there, not in the list.
            <Button
              variant="ghost"
              size="sm"
              className="px-1.5"
              aria-label={intl.formatMessage(
                { id: "settings.contractTypes.edit", defaultMessage: "Edit {name}" },
                { name: row.displayName },
              )}
              onClick={() => void navigate(`/settings/contracts/types/${row.id}`)}
            >
              <Pencil size={16} aria-hidden="true" className="text-muted" />
            </Button>
          )}
          protectedLabel={(row) =>
            row.slug === "other"
              ? intl.formatMessage(
                  {
                    id: "settings.contractTypes.locked",
                    defaultMessage: "{name} is system-protected and can't be archived",
                  },
                  { name: row.displayName },
                )
              : null
          }
          archiveLabel={(row) =>
            intl.formatMessage(
              { id: "settings.contractTypes.archive", defaultMessage: "Archive {name}" },
              { name: row.displayName },
            )
          }
          onArchive={setArchiveTarget}
          restoreLabel={(row) =>
            intl.formatMessage(
              { id: "settings.contractTypes.restore", defaultMessage: "Restore {name}" },
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
                  id: "settings.contractTypes.reorder",
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
                aria-label={intl.formatMessage({
                  id: "settings.contractTypes.addName",
                  defaultMessage: "New type name",
                })}
                className="h-7 w-64 max-w-full"
                onBlur={(event) => void create(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void create(event.currentTarget.value);
                  if (event.key === "Escape") setAdding(false);
                }}
              />
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
        <ArchiveTypeDialog
          target={archiveTarget}
          liveTypes={live}
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
