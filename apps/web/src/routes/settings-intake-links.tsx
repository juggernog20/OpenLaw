// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Intake · Deflection links (#356), from the ST13 frame of settings.pen:
 * the INT-004 "Before you submit…" panel's configuration, on the DES-020
 * list-editor in its value-list variant (DES-052).
 *
 * **A link is a value, not a named thing.** Nothing points at a link and
 * there is no history to keep, so it is removed outright rather than
 * archived — which is why the pane passes the remove pair and no archive
 * pair, and why there is no Show-archived toggle to draw.
 *
 * **Three fields is more than an inline row carries**, so Add opens the
 * DES-021 editor dialog rather than DES-020's one-field draft row: a
 * label, a URL, and the placement that decides who sees the link. The
 * same dialog edits a row, from the trailing pencil.
 *
 * **The chip is the placement.** A link with no request type sits on the
 * portal home panel, so everybody sees it whatever they came to ask; a
 * link naming a request type sits on that form instead. The chip says
 * which, and the dialog moves a link between the two.
 *
 * The URL renders without its scheme, as ST13 draws it; what is stored
 * and what a requester follows still has one.
 *
 * Nothing here renders outside Settings — the portal panel that reads
 * these links is M20's. The loader is the client half of SET-002's gate;
 * the API's 403 is the real refusal.
 *
 * ### Recorded normalization points (ST13 deviations accepted)
 *
 * 1. ST13 draws `trash-2` in the trailing slot. It renders as the
 *    shipped ListEditor's remove action — a 16px `x` — because DES-052
 *    settled that glyph for the value-list variant and this is its
 *    second mount, not a new one.
 * 2. ST13 draws no edit affordance. The trailing pencil is this pane's
 *    addition, for DES-021's reason at ST11: a row with three editable
 *    dimensions and no way into them is a dead end, and the #86
 *    trailing-action amendment made the slot a cluster for exactly this.
 * 3. ST13's placement chip is drawn on `$control`; it renders through
 *    the `status-neutral` pair, the chip token pairing DES-021's first
 *    normalization point fixed.
 * 4. ST13 draws the URL in `$status-info-fg` — the Light value of
 *    `--text-link`, which is what a web address wears here, and the one
 *    of the two the DES-011 contrast gate holds against every surface.
 * 5. ST13 sets its description line inside the card above the rows; it
 *    renders as DES-020's help caption below the card, where every other
 *    list-editor pane puts the same kind of sentence.
 */

import { useRef, useState } from "react";
import { redirect, useLoaderData } from "react-router";
import { FormattedMessage, useIntl, type IntlShape } from "react-intl";
import { Pencil } from "lucide-react";
import { api } from "../lib/api";
import { CONTROL_CLASS } from "../lib/form-controls";
import { networkError, problemDetail } from "../lib/messages";
import { requireUser } from "../lib/session";
import { IntakeSettingsTabs } from "../components/intake-settings-tabs";
import { ListEditor, type ListEditorRow } from "../components/list-editor";
import { PageTitle } from "../components/page-title";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import type { FieldStatus } from "../components/status-note";

/** One row of GET /intake-links, as the client sees it. */
interface LinkRow {
  id: string;
  label: string;
  url: string;
  /** NULL = the portal home panel (INT-004). */
  requestTypeId: string | null;
  displayOrder: number;
}

/** One link as the list editor draws it: the shared row anatomy over
 * the API row, the label standing in as the display name. */
type LinkListRow = ListEditorRow & LinkRow;

/** What the placement picker needs of a request type — structural, so
 * the loader hands its own rows straight over without a cast. */
interface PlacementType {
  id: string;
  displayName: string;
  archivedAt: string | null;
}

export async function settingsIntakeLinksLoader() {
  const user = await requireUser();
  if (user.role !== "administrator") return redirect("/settings/profile");
  const [linksRes, typesRes] = await Promise.all([
    api.GET("/api/v1/intake-links"),
    // Archived types ride along: a link assigned to a type archived
    // after it was picked still has to read as itself in the chip.
    api.GET("/api/v1/request-types", { params: { query: { includeArchived: "true" } } }),
  ]);
  if (!linksRes.data || !typesRes.data) {
    throw new Error("The deflection links could not be read.");
  }
  return { links: linksRes.data.intakeLinks, requestTypes: typesRes.data.requestTypes };
}

/**
 * The address as ST13 draws it: no scheme.
 *
 * A scheme is machinery — it tells a browser how to fetch, not a person
 * where they are going — and every row would carry the same one. What is
 * stored and what a requester follows keeps it.
 */
function schemeless(url: string): string {
  return url.replace(/^https?:\/\//i, "");
}

/** The one refusal an Administrator typing a URL will hit, said before
 * the round trip as well as after it. The API is the real check. */
function urlRefusal(intl: IntlShape): string {
  return intl.formatMessage({
    id: "settings.intakeLinks.urlInvalid",
    defaultMessage: "Enter a full web address that starts with http:// or https://.",
  });
}

/** Whether the typed address is the absolute http(s) URL INT-004 asks
 * for — the same rule the API applies, checked here for the message. */
function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** What the editor dialog collects. */
interface EditorDraft {
  label: string;
  url: string;
  /** "" = the portal home panel; otherwise a request type id. */
  requestTypeId: string;
}

function draftOf(target: LinkRow | null): EditorDraft {
  return {
    label: target?.label ?? "",
    url: target?.url ?? "",
    requestTypeId: target?.requestTypeId ?? "",
  };
}

function LinkEditorDialog({
  target,
  requestTypes,
  onOpenChange,
  onCreated,
  onSaved,
}: Readonly<{
  /** The link being edited, or null for create mode. */
  target: LinkRow | null;
  requestTypes: readonly PlacementType[];
  onOpenChange: (open: boolean) => void;
  onCreated: (row: LinkRow) => void;
  onSaved: (row: LinkRow) => void;
}>) {
  const intl = useIntl();
  const [draft, setDraft] = useState<EditorDraft>(() => draftOf(target));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof EditorDraft>(key: K, value: EditorDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  /** Live types, plus the archived one this link already sits on: an
   * edit of the label must not silently move the link (the rule the
   * ST14 target picker follows). */
  const placements = requestTypes.filter(
    (row) => row.archivedAt === null || row.id === target?.requestTypeId,
  );

  function refuse(message: string) {
    setError(message);
    setBusy(false);
  }

  async function create(label: string, url: string) {
    const { data, error: problem } = await api
      .POST("/api/v1/intake-links", {
        body: { label, url, requestTypeId: draft.requestTypeId || null },
      })
      .catch(() => ({ data: null, error: undefined }));
    if (!data) {
      refuse(
        problemDetail(problem) ??
          intl.formatMessage({
            id: "settings.intakeLinks.createError",
            defaultMessage: "The link could not be added.",
          }),
      );
      return false;
    }
    onCreated(data.intakeLink);
    return true;
  }

  async function edit(existing: LinkRow, label: string, url: string) {
    const requestTypeId = draft.requestTypeId || null;
    const body: { label?: string; url?: string; requestTypeId?: string | null } = {};
    if (label !== existing.label) body.label = label;
    if (url !== existing.url) body.url = url;
    if (requestTypeId !== existing.requestTypeId) body.requestTypeId = requestTypeId;
    // Nothing changed: the API refuses an empty body, and rightly — so
    // the dialog just closes rather than asking it to.
    if (Object.keys(body).length === 0) return true;

    const { data, error: problem } = await api
      .PATCH("/api/v1/intake-links/{id}", { params: { path: { id: existing.id } }, body })
      .catch(() => ({ data: null, error: undefined }));
    if (!data) {
      refuse(
        problemDetail(problem) ??
          intl.formatMessage({
            id: "settings.intakeLinks.editError",
            defaultMessage: "The link could not be saved.",
          }),
      );
      return false;
    }
    onSaved(data.intakeLink);
    return true;
  }

  async function submit() {
    if (busy) return;
    setError(null);
    const label = draft.label.trim();
    const url = draft.url.trim();
    if (label === "") {
      refuse(
        intl.formatMessage({
          id: "settings.intakeLinks.labelMissing",
          defaultMessage: "Name the link.",
        }),
      );
      return;
    }
    if (!isWebUrl(url)) {
      refuse(urlRefusal(intl));
      return;
    }
    setBusy(true);
    const done = target === null ? await create(label, url) : await edit(target, label, url);
    setBusy(false);
    if (done) onOpenChange(false);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          {target === null ? (
            <FormattedMessage id="settings.intakeLinks.addTitle" defaultMessage="Add link" />
          ) : (
            <FormattedMessage
              id="settings.intakeLinks.editTitle"
              defaultMessage="Edit {name}"
              values={{ name: target.label }}
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
            <Label htmlFor="intake-link-label">
              <FormattedMessage id="settings.intakeLinks.labelLabel" defaultMessage="Label" />
            </Label>
            <Input
              id="intake-link-label"
              autoFocus
              value={draft.label}
              onChange={(event) => set("label", event.target.value)}
            />
            <p className="text-xs text-muted">
              <FormattedMessage
                id="settings.intakeLinks.labelHelp"
                defaultMessage="What the panel reads as — an answer, not an address."
              />
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="intake-link-url">
              <FormattedMessage id="settings.intakeLinks.urlLabel" defaultMessage="Address" />
            </Label>
            <Input
              id="intake-link-url"
              // Not `type="url"`: the browser's own constraint check
              // would block the submit with a native bubble, and the
              // refusal an Administrator reads has to be ours (DES-015).
              inputMode="url"
              value={draft.url}
              onChange={(event) => {
                set("url", event.target.value);
                // Typing answers the refusal the last press left.
                if (error !== null) setError(null);
              }}
            />
            <p className="text-xs text-muted">
              <FormattedMessage
                id="settings.intakeLinks.urlHelp"
                defaultMessage="A full web address, starting with http:// or https://."
              />
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="intake-link-placement">
              <FormattedMessage
                id="settings.intakeLinks.placementLabel"
                defaultMessage="Placement"
              />
            </Label>
            <select
              id="intake-link-placement"
              className={CONTROL_CLASS}
              value={draft.requestTypeId}
              onChange={(event) => set("requestTypeId", event.target.value)}
            >
              <option value="">
                {intl.formatMessage({
                  id: "settings.intakeLinks.portalHome",
                  defaultMessage: "Portal home",
                })}
              </option>
              {placements.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.archivedAt === null
                    ? row.displayName
                    : intl.formatMessage(
                        {
                          id: "settings.intakeLinks.archivedOption",
                          defaultMessage: "{name} (archived)",
                        },
                        { name: row.displayName },
                      )}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted">
              <FormattedMessage
                id="settings.intakeLinks.placementHelp"
                defaultMessage={
                  "The portal home shows the link to everybody. A request type shows it on " +
                  "that form only."
                }
              />
            </p>
          </div>
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
                  id="settings.intakeLinks.createSubmit"
                  defaultMessage="Add link"
                />
              ) : (
                <FormattedMessage id="settings.intakeLinks.editSubmit" defaultMessage="Save" />
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SettingsIntakeLinksPage() {
  const loaded = useLoaderData<typeof settingsIntakeLinksLoader>();
  const intl = useIntl();

  const [links, setLinks] = useState<LinkRow[]>(loaded.links);
  const [rowStatus, setRowStatus] = useState<Record<string, FieldStatus>>({});
  const [rowError, setRowError] = useState<Record<string, string | undefined>>({});
  const [orderStatus, setOrderStatus] = useState<FieldStatus>("idle");
  const [orderError, setOrderError] = useState<string | undefined>(undefined);
  const [announcement, setAnnouncement] = useState("");
  /** The editor dialog: closed, create mode, or an edit target. */
  const [editor, setEditor] = useState<{ target: LinkRow | null } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const typeNames = new Map(loaded.requestTypes.map((row) => [row.id, row.displayName]));

  function noteRow(id: string, status: FieldStatus, detail?: string) {
    setRowStatus((current) => ({ ...current, [id]: status }));
    setRowError((current) => ({ ...current, [id]: detail }));
  }

  /**
   * Takes one link off the panel.
   *
   * The pressed button goes with the row, so focus would land on
   * nothing — the list takes it instead (DES-020's `listRef`). Focus
   * moves only when the row actually left; a refused removal leaves the
   * button standing and keeps it.
   */
  async function remove(row: LinkRow) {
    noteRow(row.id, "saving");
    // The 204 carries no body, so `response.ok` is what says it landed
    // — the house reading for a bodyless delete. A rejected promise is
    // a request that never got an answer, and drops through the same
    // arm rather than looking like a success.
    const { error, response } = await api
      .DELETE("/api/v1/intake-links/{id}", { params: { path: { id: row.id } } })
      .catch(() => ({ error: undefined, response: undefined }));
    if (response?.ok !== true) {
      noteRow(row.id, "error", problemDetail(error) ?? networkError(intl));
      return;
    }
    setLinks((current) => current.filter((candidate) => candidate.id !== row.id));
    listRef.current?.focus();
  }

  /** One validated move from the grip (arrow key or drop): commit the
   * whole order and announce where the row landed. */
  async function move(fromIndex: number, toIndex: number) {
    // One move at a time. A second move started while the first is in
    // flight would take the first move's optimistic order as its
    // rollback target, so a refusal would restore an order the server
    // never held. The type editor's grip guards the same way.
    if (orderStatus === "saving") return;
    const moved = links[fromIndex]!;
    const next = [...links];
    next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    const previous = links;
    // SET-003 immediate apply: the pane draws the new order at once and
    // puts back the confirmed one if the save is refused.
    setLinks(next);
    setOrderStatus("saving");
    setOrderError(undefined);
    const { data, error } = await api
      .PUT("/api/v1/intake-links/order", { body: { ids: next.map((row) => row.id) } })
      .catch(() => ({ data: null, error: undefined }));
    if (!data) {
      setLinks(previous);
      setOrderStatus("error");
      setOrderError(problemDetail(error));
      return;
    }
    setLinks(data.intakeLinks);
    setOrderStatus("saved");
    setAnnouncement(
      intl.formatMessage(
        {
          id: "settings.intakeLinks.moved",
          defaultMessage: "{name} moved to position {position} of {total}.",
        },
        { name: moved.label, position: toIndex + 1, total: next.length },
      ),
    );
  }

  /** What a row's chip says: the request type it sits on, or the portal
   * home panel when it sits on none. A type name the loader never saw
   * falls back to the home reading, which is what the row would be. */
  function placementLabel(row: LinkRow): string {
    const name = row.requestTypeId === null ? undefined : typeNames.get(row.requestTypeId);
    return (
      name ??
      intl.formatMessage({
        id: "settings.intakeLinks.portalHome",
        defaultMessage: "Portal home",
      })
    );
  }

  /** The list editor's rows. The label is the row's name; the URL is
   * its second line (ST13's 52px two-line row). */
  const rows: LinkListRow[] = links.map((row) => ({
    ...row,
    displayName: row.label,
    archivedAt: null,
  }));

  return (
    <>
      <PageTitle
        title={intl.formatMessage({
          id: "settings.intakeLinks.pageTitle",
          defaultMessage: "Deflection links",
        })}
      />
      <div className="flex w-full max-w-(--width-settings-card) flex-col gap-4">
        <IntakeSettingsTabs />
        <ListEditor<LinkListRow>
          rows={rows}
          title={
            <FormattedMessage id="settings.intakeLinks.title" defaultMessage="Deflection links" />
          }
          count={
            <FormattedMessage
              id="settings.intakeLinks.count"
              defaultMessage="{count, plural, one {# link} other {# links}}"
              values={{ count: rows.length }}
            />
          }
          addLabel={<FormattedMessage id="settings.intakeLinks.add" defaultMessage="Add link" />}
          onAdd={() => setEditor({ target: null })}
          help={
            <FormattedMessage
              id="settings.intakeLinks.help"
              defaultMessage={
                'Shown under "Before you submit…" on the portal home. Links assigned to a ' +
                "request type show on that form instead. Drag a row, or focus its handle and " +
                "use the arrow keys, to reorder. Removing a link deletes it — there is no archive."
              }
            />
          }
          rowStatus={rowStatus}
          rowError={rowError}
          nameSlotClassName="min-w-0 flex-1"
          // The second line is the address, without the scheme every row
          // would otherwise repeat (ST13).
          rowCaption={(row) => <span className="text-link">{schemeless(row.url)}</span>}
          rowDetails={(row) => (
            <span className="w-40 shrink-0">
              <span className="inline-flex max-w-full rounded-chip bg-status-neutral-bg px-2 py-0.5 text-xs font-semibold text-status-neutral-fg">
                {/* A row labelled "Portal home" whose chip reads
                    "Portal home" is two different facts (DES-021). */}
                <span className="sr-only">
                  <FormattedMessage
                    id="settings.intakeLinks.placementPrefix"
                    defaultMessage="Placement:"
                  />{" "}
                </span>
                <span className="truncate">{placementLabel(row)}</span>
              </span>
            </span>
          )}
          rowActions={(row) => (
            <Button
              variant="ghost"
              size="sm"
              className="px-1.5"
              disabled={rowStatus[row.id] === "saving"}
              aria-label={intl.formatMessage(
                { id: "settings.intakeLinks.edit", defaultMessage: "Edit {name}" },
                { name: row.displayName },
              )}
              onClick={() => setEditor({ target: row })}
            >
              <Pencil size={16} aria-hidden="true" className="text-muted" />
            </Button>
          )}
          removeLabel={(row) =>
            intl.formatMessage(
              { id: "settings.intakeLinks.remove", defaultMessage: "Remove {name}" },
              { name: row.displayName },
            )
          }
          onRemove={(row) => void remove(row)}
          reorder={{
            status: orderStatus,
            detail: orderError,
            gripLabel: (row, position, total) =>
              intl.formatMessage(
                {
                  id: "settings.intakeLinks.reorder",
                  defaultMessage:
                    "Reorder {name}, position {position} of {total}. " +
                    "Use the arrow keys to move it.",
                },
                { name: row.displayName, position, total },
              ),
            onMove: (fromIndex, toIndex) => void move(fromIndex, toIndex),
          }}
          announcement={announcement}
          listRef={listRef}
        />
      </div>
      {editor && (
        <LinkEditorDialog
          target={editor.target}
          requestTypes={loaded.requestTypes}
          onOpenChange={(open) => {
            if (!open) setEditor(null);
          }}
          onCreated={(row) => setLinks((current) => [...current, row])}
          onSaved={(row) =>
            setLinks((current) =>
              current.map((candidate) => (candidate.id === row.id ? row : candidate)),
            )
          }
        />
      )}
    </>
  );
}
