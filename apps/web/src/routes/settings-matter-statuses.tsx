// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Matters · Statuses (#82): the DES-020 list editor on the ST10 frame of
 * settings.pen. The MTR-002 taxonomy shows its category badge in the
 * qualifier-pill slot, the `open` and `closed` seeds are locked, rows
 * reorder by drag or arrow key, and the inline draft row picks a
 * category at creation that is immutable after. The archive guard
 * enforces the MTR-002 category floor and requires a same-category
 * replacement when Matters still hold the status. Every mutation
 * applies on save. The shared anatomy lives in ListEditor (extracted
 * with #83); this pane owns the MTR-002 vocabulary, the API calls, and
 * the guard dialog. The loader is the client half of SET-002's gate;
 * the API's 403 is the real refusal.
 */

import { useRef, useState } from "react";
import type { paths } from "@openlaw/api-client";
import { redirect, useLoaderData } from "react-router";
import { FormattedMessage, useIntl, type IntlShape } from "react-intl";
import { History, TriangleAlert } from "lucide-react";
import { api } from "../lib/api";
import { problem as readProblem } from "../lib/problem";
import { requireUser } from "../lib/session";
import { MattersSettingsTabs } from "../components/matters-settings-tabs";
import { ListEditor } from "../components/list-editor";
import { PageTitle } from "../components/page-title";
import { StatusNote, type FieldStatus } from "../components/status-note";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";

export async function settingsMatterStatusesLoader() {
  const user = await requireUser();
  if (user.role !== "administrator") return redirect("/settings/profile");
  const { data } = await api.GET("/api/v1/matter-statuses", {
    params: { query: { includeArchived: "true" } },
  });
  if (!data) throw new Error("The matter statuses could not be read.");
  return { matterStatuses: data.matterStatuses };
}

/** The fixed two-category backbone (MTR-002), in canonical order. */
const CATEGORIES = ["open", "closed"] as const;
type Category = (typeof CATEGORIES)[number];

/** The MTR-002 system-protected seeds: no archive, no hard delete. */
const PROTECTED_SLUGS = new Set(["open", "closed"]);

/** One row of GET /matter-statuses, derived from the generated seam. */
type StatusRow =
  paths["/api/v1/matter-statuses"]["get"]["responses"]["200"]["content"]["application/json"]["matterStatuses"][number];

const byDisplayOrder = (a: StatusRow, b: StatusRow) => a.displayOrder - b.displayOrder;

/** The fixed category names. Never sourced from a status label (MTR-002). */
function categoryLabel(intl: IntlShape, category: Category): string {
  return intl.formatMessage(
    {
      id: "settings.matterStatuses.categoryLabel",
      defaultMessage: "{category, select, open {Open} closed {Closed} other {Unknown}}",
    },
    { category },
  );
}

function ArchiveStatusDialog({
  target,
  blocked,
  candidates,
  onOpenChange,
  onArchived,
  onArchivedCloseFocus,
}: Readonly<{
  target: StatusRow;
  /** The MTR-002 floor: the target is its category's last unarchived
   * status. The other block, Matters still on the status, rides
   * `target.inUseCount`, so the dialog reads it from the row. */
  blocked: boolean;
  candidates: StatusRow[];
  onOpenChange: (open: boolean) => void;
  onArchived: (row: StatusRow) => void;
  /** Where focus lands after a successful archive. The row's archive
   * button unmounts with the row, so the default restore has no home. */
  onArchivedCloseFocus: () => void;
}>) {
  const intl = useIntl();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reassignToId, setReassignToId] = useState("");
  const archived = useRef(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.POST("/api/v1/matter-statuses/{id}/archive", {
        params: { path: { id: target.id } },
        body: reassignToId ? { reassignToId } : {},
      });
      const { data } = result;
      if (data) {
        archived.current = true;
        onArchived(data.matterStatus);
        onOpenChange(false);
      } else {
        // The API's own refusal (a protected row, the floor, a stale
        // list) is more actionable than any generic line.
        setError(
          (await readProblem(result)).detail ??
            intl.formatMessage({
              id: "settings.matterStatuses.archiveError",
              defaultMessage: "The status could not be archived.",
            }),
        );
      }
    } catch {
      // A network-level failure never produces a problem envelope.
      setError(
        intl.formatMessage({
          id: "settings.matterStatuses.archiveError",
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
        aria-describedby={blocked || target.inUseCount > 0 ? "archive-status-warning" : undefined}
        onCloseAutoFocus={(event) => {
          if (!archived.current) return;
          event.preventDefault();
          onArchivedCloseFocus();
        }}
      >
        <DialogTitle>
          <FormattedMessage
            id="settings.matterStatuses.archiveTitle"
            defaultMessage="Archive {name}"
            values={{ name: target.displayName }}
          />
        </DialogTitle>
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex items-start gap-2 rounded-card bg-status-warning-bg p-3 text-sm text-status-warning-fg">
            <TriangleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            <p id="archive-status-warning">
              {blocked ? (
                <FormattedMessage
                  id="settings.matterStatuses.archiveBlocked"
                  defaultMessage={
                    "{name} is the last unarchived status in its category — every category keeps " +
                    "at least one. Add another status to the category first."
                  }
                  values={{ name: target.displayName }}
                />
              ) : (
                <FormattedMessage
                  id="settings.matterStatuses.archiveWarning"
                  defaultMessage={
                    "{count, plural, =0 {{name} is not used by any matters.} " +
                    "one {{name} is the status of # matter. Pick its replacement below.} " +
                    "other {{name} is the status of # matters. Pick their replacement below.}}"
                  }
                  values={{ name: target.displayName, count: target.inUseCount }}
                />
              )}
            </p>
          </div>
          {target.inUseCount > 0 && !blocked && (
            <label className="flex flex-col gap-1.5 text-sm text-primary">
              <FormattedMessage
                id="settings.matterStatuses.reassignLabel"
                defaultMessage="Reassign {count, plural, one {# matter} other {# matters}} to"
                values={{ count: target.inUseCount }}
              />
              <select
                value={reassignToId}
                aria-label={intl.formatMessage(
                  {
                    id: "settings.matterStatuses.reassignLabel",
                    defaultMessage: "Reassign {count, plural, one {# matter} other {# matters}} to",
                  },
                  { count: target.inUseCount },
                )}
                className="h-8 rounded-button border border-border-default bg-raised px-2 text-sm text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link"
                onChange={(event) => setReassignToId(event.target.value)}
              >
                <option value="">
                  {intl.formatMessage({
                    id: "settings.matterStatuses.reassignNone",
                    defaultMessage: "Choose a status…",
                  })}
                </option>
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.displayName}
                  </option>
                ))}
              </select>
              {candidates.length === 0 && (
                <span className="text-xs text-status-danger-fg">
                  <FormattedMessage
                    id="settings.matterStatuses.noCandidates"
                    defaultMessage="Add or restore another status in this category first."
                  />
                </span>
              )}
            </label>
          )}
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <History size={16} aria-hidden="true" />
            <FormattedMessage
              id="settings.matterStatuses.auditNote"
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
              disabled={blocked || (target.inUseCount > 0 && !reassignToId) || busy}
              onClick={() => void submit()}
            >
              <FormattedMessage
                id="settings.matterStatuses.archiveSubmit"
                defaultMessage="Archive status"
              />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SettingsMatterStatusesPage() {
  const { matterStatuses } = useLoaderData<typeof settingsMatterStatusesLoader>();
  const intl = useIntl();

  const [rows, setRows] = useState<StatusRow[]>(matterStatuses);
  const [rowStatus, setRowStatus] = useState<Record<string, FieldStatus>>({});
  const [rowError, setRowError] = useState<Record<string, string | undefined>>({});
  const [orderStatus, setOrderStatus] = useState<FieldStatus>("idle");
  const [orderError, setOrderError] = useState<string | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<{ name: string; category: Category | "" }>({
    name: "",
    category: "",
  });
  const [addStatus, setAddStatus] = useState<FieldStatus>("idle");
  const [addError, setAddError] = useState<string | undefined>(undefined);
  const [archiveTarget, setArchiveTarget] = useState<StatusRow | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  const createInFlight = useRef(false);

  const live = rows.filter((row) => !row.archivedAt).sort(byDisplayOrder);
  const archived = rows.filter((row) => row.archivedAt).sort(byDisplayOrder);

  /** The MTR-002 floor, client-side: is this row its category's last live one? */
  const lastLiveInCategory = (row: StatusRow) =>
    !live.some((candidate) => candidate.category === row.category && candidate.id !== row.id);

  function noteRow(id: string, status: FieldStatus, detail?: string) {
    setRowStatus((current) => ({ ...current, [id]: status }));
    setRowError((current) => ({ ...current, [id]: detail }));
  }

  function replaceRow(row: StatusRow) {
    setRows((current) => current.map((existing) => (existing.id === row.id ? row : existing)));
  }

  async function rename(row: StatusRow, displayName: string) {
    noteRow(row.id, "saving");
    const result = await api
      .PATCH("/api/v1/matter-statuses/{id}", {
        params: { path: { id: row.id } },
        body: { displayName },
      })
      .catch(() => undefined);
    const { data } = result ?? {};
    if (data) {
      replaceRow(data.matterStatus);
      noteRow(row.id, "saved");
    } else {
      noteRow(row.id, "error", (await readProblem(result)).detail);
    }
  }

  async function create() {
    // Enter can land while a create is already posting. A ref, set
    // synchronously, keeps a double-tap from posting the draft twice.
    if (createInFlight.current) return;
    const displayName = addDraft.name.trim();
    if (displayName === "") {
      setAdding(false);
      return;
    }
    // The category is the creation-time immutable dimension (MTR-002):
    // there is no create without one.
    if (addDraft.category === "") {
      setAddStatus("error");
      setAddError(
        intl.formatMessage({
          id: "settings.matterStatuses.categoryMissing",
          defaultMessage: "Pick a category for the new status.",
        }),
      );
      return;
    }
    createInFlight.current = true;
    setAddStatus("saving");
    setAddError(undefined);
    try {
      const result = await api
        .POST("/api/v1/matter-statuses", {
          body: { displayName, category: addDraft.category },
        })
        .catch(() => undefined);
      const { data } = result ?? {};
      if (data) {
        setRows((current) => [...current, data.matterStatus]);
        setAdding(false);
        setAddDraft({ name: "", category: "" });
        setAddStatus("saved");
      } else {
        // Keep the draft row open so the name is not lost to a refusal.
        setAddStatus("error");
        setAddError((await readProblem(result)).detail);
      }
    } finally {
      createInFlight.current = false;
    }
  }

  /** Commits a full permutation of the live rows (SET-003: immediately). */
  async function commitOrder(orderedIds: string[]) {
    setOrderStatus("saving");
    setOrderError(undefined);
    const result = await api
      .PUT("/api/v1/matter-statuses/order", { body: { ids: orderedIds } })
      .catch(() => undefined);
    const { data } = result ?? {};
    if (data) {
      const reordered: StatusRow[] = data.matterStatuses;
      setRows((current) => [
        ...reordered,
        ...current.filter((row) => !reordered.some((moved) => moved.id === row.id)),
      ]);
      setOrderStatus("saved");
      return true;
    }
    setOrderStatus("error");
    setOrderError((await readProblem(result)).detail);
    return false;
  }

  /** One validated move from the grip (arrow key or drop): commit the
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
            id: "settings.matterStatuses.moved",
            defaultMessage: "{name} moved to position {position} of {total}.",
          },
          { name: row.displayName, position: toIndex + 1, total: live.length },
        ),
      );
    }
  }

  async function restore(row: StatusRow) {
    noteRow(row.id, "saving");
    const result = await api
      .POST("/api/v1/matter-statuses/{id}/restore", { params: { path: { id: row.id } } })
      .catch(() => undefined);
    const { data } = result ?? {};
    if (data) {
      replaceRow(data.matterStatus);
      noteRow(row.id, "saved");
    } else {
      noteRow(row.id, "error", (await readProblem(result)).detail);
    }
  }

  /** The ST10 category badge, in DES-020's qualifier-pill slot. The
   * sr-only prefix keeps a row like Draft/Draft unambiguous to a
   * reader: the name is the label, the badge is "Category: Draft". */
  function categoryBadge(row: StatusRow) {
    return (
      <span className="inline-flex rounded-chip bg-control px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-muted">
        <span className="sr-only">
          <FormattedMessage
            id="settings.matterStatuses.categoryBadgePrefix"
            defaultMessage="Category:"
          />{" "}
        </span>
        {categoryLabel(intl, row.category)}
      </span>
    );
  }

  return (
    <>
      <PageTitle
        title={intl.formatMessage({
          id: "settings.matterStatuses.pageTitle",
          defaultMessage: "Matter statuses",
        })}
      />
      <div className="flex w-full max-w-(--width-settings-card) flex-col gap-4">
        <MattersSettingsTabs />
        <ListEditor
          rows={live}
          archivedRows={archived}
          title={
            <FormattedMessage id="settings.matterStatuses.title" defaultMessage="Matter statuses" />
          }
          count={
            <FormattedMessage
              id="settings.matterStatuses.count"
              defaultMessage="{count, plural, one {# status} other {# statuses}}"
              values={{ count: live.length }}
            />
          }
          addLabel={
            <FormattedMessage id="settings.matterStatuses.add" defaultMessage="Add status" />
          }
          onAdd={() => {
            setAdding(true);
            setAddDraft({ name: "", category: "" });
            setAddStatus("idle");
            setAddError(undefined);
          }}
          help={
            <FormattedMessage
              id="settings.matterStatuses.help"
              defaultMessage={
                "Drag to reorder. Statuses map to a fixed category picked at creation; every " +
                "category keeps at least one unarchived status."
              }
            />
          }
          rowStatus={rowStatus}
          rowError={rowError}
          renameLabel={(row) =>
            intl.formatMessage(
              { id: "settings.matterStatuses.renameLabel", defaultMessage: "Rename {name}" },
              { name: row.displayName },
            )
          }
          onRename={(row, displayName) => void rename(row, displayName)}
          rowDetails={categoryBadge}
          rowMeta={(row) => (
            <FormattedMessage
              id="settings.matterStatuses.inUse"
              defaultMessage="{count, plural, one {# matter} other {# matters}}"
              values={{ count: row.inUseCount }}
            />
          )}
          protectedLabel={(row) =>
            PROTECTED_SLUGS.has(row.slug)
              ? intl.formatMessage(
                  {
                    id: "settings.matterStatuses.locked",
                    defaultMessage: "{name} is system-protected and can't be archived",
                  },
                  { name: row.displayName },
                )
              : null
          }
          archiveLabel={(row) =>
            intl.formatMessage(
              { id: "settings.matterStatuses.archive", defaultMessage: "Archive {name}" },
              { name: row.displayName },
            )
          }
          onArchive={setArchiveTarget}
          restoreLabel={(row) =>
            intl.formatMessage(
              { id: "settings.matterStatuses.restore", defaultMessage: "Restore {name}" },
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
                  id: "settings.matterStatuses.reorder",
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
                  id: "settings.matterStatuses.addName",
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
              {/* The creation-time immutable dimension (MTR-002): the
                  category is picked here, once. */}
              <select
                value={addDraft.category}
                aria-label={intl.formatMessage({
                  id: "settings.matterStatuses.addCategory",
                  defaultMessage: "New status category",
                })}
                className="h-7 rounded-button border border-border-default bg-raised px-2 text-sm text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link"
                onChange={(event) => {
                  const category = event.target.value as Category | "";
                  setAddDraft((current) => ({ ...current, category }));
                  // Picking a category answers the "pick a category"
                  // refusal, so clear it.
                  if (category !== "" && addStatus === "error") {
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
                    id: "settings.matterStatuses.categoryPlaceholder",
                    defaultMessage: "Category…",
                  })}
                </option>
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {categoryLabel(intl, category)}
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
          blocked={lastLiveInCategory(archiveTarget)}
          candidates={live.filter(
            (row) => row.id !== archiveTarget.id && row.category === archiveTarget.category,
          )}
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
