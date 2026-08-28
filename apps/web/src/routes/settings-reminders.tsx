// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Organization · Notifications (#322, NOT-004): the one reminder-offset
 * list, in the DES-020 list-editor's value-list variant (DES-052).
 *
 * **One list, for every tracked date.** Key dates, notice deadlines, and
 * expiries all fire on these numbers — NOT-004 declined per-date
 * schedules and per-user ones, so a long notice window is tuned here
 * rather than in code.
 *
 * **A row is a value, not a named thing.** Nothing points at "7 days
 * before", so it is removed rather than archived and there is no name to
 * rename: the list is edited by adding, removing, and rearranging.
 *
 * **Every one of those three is the same write** — the whole list, sent
 * the moment the change is made (SET-003 immediate apply). The morning
 * round reads the column live, so a save applies to the next round with
 * nothing else touched.
 *
 * **The list can never be emptied.** No lead times means no reminders,
 * and silence is chosen per event group on the Personal pane rather than
 * falling out of an empty settings row — so the last remaining row wears
 * DES-020's lock instead of a remove action, and the API refuses an
 * empty list regardless of what this pane draws.
 *
 * The loader is the client half of SET-002's gate; the API's 403 is the
 * real refusal.
 */

import { useRef, useState } from "react";
import { redirect, useLoaderData } from "react-router";
import { FormattedMessage, useIntl, type IntlShape } from "react-intl";
import { api } from "../lib/api";
import { problemDetail } from "../lib/messages";
import { requireUser } from "../lib/session";
import { ListEditor, type ListEditorRow } from "../components/list-editor";
import { PageTitle } from "../components/page-title";
import { StatusNote, type FieldStatus } from "../components/status-note";
import { Input } from "../components/ui/input";

export async function settingsRemindersLoader() {
  const user = await requireUser();
  if (user.role !== "administrator") return redirect("/settings/profile");
  const { data } = await api.GET("/api/v1/org/reminder-offsets");
  // A failed read must fail the pane: drawing a guessed list would show
  // an Administrator lead times the round is not firing on.
  if (!data) throw new Error("The reminder lead times could not be read.");
  return { offsets: data.offsets };
}

/** The furthest ahead one lead time may look, as the API bounds it
 * (NOT-004): two years, which covers a long notice window and stops a
 * mistyped number becoming a schedule. */
const MAX_OFFSET_DAYS = 730;

/** How many lead times one list holds, as the API bounds it: far past
 * any real ladder, and stated here so the draft row refuses before a
 * request rather than after one. */
const MAX_OFFSETS = 20;

/** How one lead time reads. Day-of is a phrase rather than "0 days",
 * because nobody says nought days before. */
const offsetLabel = (intl: IntlShape, days: number): string =>
  intl.formatMessage(
    {
      id: "settings.reminders.offset",
      defaultMessage: "{days, plural, =0 {On the day} one {# day before} other {# days before}}",
    },
    { days },
  );

export function SettingsRemindersPage() {
  const intl = useIntl();
  const loaded = useLoaderData<typeof settingsRemindersLoader>();
  const [offsets, setOffsets] = useState<number[]>(loaded.offsets);
  const [status, setStatus] = useState<FieldStatus>("idle");
  const [detail, setDetail] = useState<string | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [addStatus, setAddStatus] = useState<FieldStatus>("idle");
  const [addError, setAddError] = useState<string | undefined>(undefined);
  const [announcement, setAnnouncement] = useState("");
  const listRef = useRef<HTMLUListElement>(null);

  /**
   * Whether a save is in the air.
   *
   * Every write here sends the **whole** list, so two of them at once
   * would let the slower reply land last and undo the faster one. One at
   * a time is the DES-020 rule the grip already follows — `moveBy`
   * refuses to move a row while the order is saving — and this ref
   * extends it to the add and the remove. A ref rather than the state,
   * because a second press can arrive before React has re-rendered.
   */
  const saving = useRef(false);

  /**
   * Sends a list and answers whether it landed.
   *
   * The pane shows the new list at once (SET-003) and puts back the one
   * the server last confirmed if the save is refused — the whole list,
   * because the whole list is what was sent.
   */
  async function save(next: number[]): Promise<boolean> {
    if (saving.current) return false;
    saving.current = true;
    const previous = offsets;
    setOffsets(next);
    setStatus("saving");
    setDetail(undefined);
    try {
      const { data, error } = await api
        .PUT("/api/v1/org/reminder-offsets", { body: { offsets: next } })
        .catch(() => ({ data: null, error: undefined }));
      if (!data) {
        setOffsets(previous);
        setStatus("error");
        setDetail(problemDetail(error));
        return false;
      }
      // The server's own list, not the sent one: it collapses duplicates,
      // and the pane must draw what the round will fire on.
      setOffsets(data.offsets);
      setStatus("saved");
      return true;
    } finally {
      saving.current = false;
    }
  }

  /**
   * Closes the draft row and parks focus on the list.
   *
   * Every way out of the Add row unmounts the input that holds focus —
   * Escape, Enter on an empty draft, and a saved addition alike — so
   * without this a keyboard reader is dropped on the document body and
   * loses their place in the pane. The list is the same parking place
   * {@link remove} uses (DES-020's `listRef`).
   *
   * Focus moves before the state change is drawn, so the input is still
   * mounted when it hands focus over and its unmount takes nothing.
   */
  function closeAdd() {
    listRef.current?.focus();
    setAdding(false);
  }

  /** Adds the drafted lead time, keeping the list's own order: a new one
   * joins at the end, where the Add row drew it. */
  async function add() {
    const typed = draft.trim();
    if (typed === "") {
      closeAdd();
      return;
    }
    const days = Number(typed);
    if (!Number.isSafeInteger(days) || days < 0 || days > MAX_OFFSET_DAYS) {
      setAddStatus("error");
      setAddError(
        intl.formatMessage(
          {
            id: "settings.reminders.addInvalid",
            defaultMessage: "Enter a whole number of days between 0 and {max}.",
          },
          { max: MAX_OFFSET_DAYS },
        ),
      );
      return;
    }
    if (offsets.includes(days)) {
      setAddStatus("error");
      setAddError(
        intl.formatMessage(
          {
            id: "settings.reminders.addDuplicate",
            defaultMessage: "{label} is already on the list.",
          },
          { label: offsetLabel(intl, days) },
        ),
      );
      return;
    }
    if (offsets.length >= MAX_OFFSETS) {
      setAddStatus("error");
      setAddError(
        intl.formatMessage(
          {
            id: "settings.reminders.addFull",
            defaultMessage: "The list holds at most {max} lead times. Remove one first.",
          },
          { max: MAX_OFFSETS },
        ),
      );
      return;
    }
    setAddStatus("saving");
    setAddError(undefined);
    if (await save([...offsets, days])) {
      closeAdd();
      setDraft("");
      setAddStatus("saved");
    } else {
      // Keep the draft row open so the typed number is not lost to a
      // refusal.
      setAddStatus("idle");
    }
  }

  /**
   * Takes one lead time off the list.
   *
   * The pressed button goes with the row, so focus would land on nothing
   * — the list takes it instead (DES-020's `listRef`, the same parking
   * place the taxonomy panes' guard dialogs use). Focus moves only when
   * the row actually left; a refused removal leaves the button standing
   * and keeps it.
   */
  async function remove(id: string) {
    if (await save(offsets.filter((days) => String(days) !== id))) {
      listRef.current?.focus();
    }
  }

  /** One validated move from the grip (arrow key or drop): commit the
   * whole list in its new order and announce where the row landed. */
  async function move(fromIndex: number, toIndex: number) {
    const moved = offsets[fromIndex]!;
    const next = [...offsets];
    next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    if (await save(next)) {
      setAnnouncement(
        intl.formatMessage(
          {
            id: "settings.reminders.moved",
            defaultMessage: "{label} moved to position {position} of {total}.",
          },
          { label: offsetLabel(intl, moved), position: toIndex + 1, total: next.length },
        ),
      );
    }
  }

  /** The list as the editor's rows. The value is the identity: two
   * copies of one lead time are one lead time. */
  const rows: ListEditorRow[] = offsets.map((days) => ({
    id: String(days),
    displayName: offsetLabel(intl, days),
    archivedAt: null,
  }));

  return (
    <>
      {/* The rail entry is called Notifications; the screen title says
          what the pane holds, because DES-011 asks every screen for a
          title of its own and the Personal pane is already Notifications. */}
      <PageTitle
        title={intl.formatMessage({
          id: "settings.reminders.pageTitle",
          defaultMessage: "Reminder lead times",
        })}
      />
      <div className="flex w-full max-w-(--width-settings-card) flex-col gap-4">
        <ListEditor
          rows={rows}
          title={
            <FormattedMessage id="settings.reminders.title" defaultMessage="Reminder lead times" />
          }
          count={
            <FormattedMessage
              id="settings.reminders.count"
              defaultMessage="{count, plural, one {# lead time} other {# lead times}}"
              values={{ count: rows.length }}
            />
          }
          addLabel={<FormattedMessage id="settings.reminders.add" defaultMessage="Add lead time" />}
          onAdd={() => {
            setAdding(true);
            setDraft("");
            setAddStatus("idle");
            setAddError(undefined);
          }}
          help={
            <FormattedMessage
              id="settings.reminders.help"
              defaultMessage={
                "Drag a row, or focus its handle and use the arrow keys, to reorder. One list " +
                "covers every tracked date — key dates, notice deadlines, and expiries — and " +
                "the reminders arrive in the daily digest. Keep at least one lead time."
              }
            />
          }
          // Every write sends the whole list, so the save state belongs
          // to the card rather than to any one row — and the card's
          // controls stand down while one is in the air.
          rowStatus={{}}
          rowError={{}}
          busy={status === "saving"}
          removeLabel={(row) =>
            intl.formatMessage(
              { id: "settings.reminders.remove", defaultMessage: "Remove {label}" },
              { label: row.displayName },
            )
          }
          listRef={listRef}
          onRemove={(row) => void remove(row.id)}
          protectedLabel={(row) =>
            rows.length > 1
              ? null
              : intl.formatMessage(
                  {
                    id: "settings.reminders.lastOne",
                    defaultMessage: "{label} is the only lead time and can't be removed",
                  },
                  { label: row.displayName },
                )
          }
          reorder={{
            status,
            detail,
            gripLabel: (row, position, total) =>
              intl.formatMessage(
                {
                  id: "settings.reminders.reorder",
                  defaultMessage:
                    "Reorder {label}, position {position} of {total}. " +
                    "Use the arrow keys to move it.",
                },
                { label: row.displayName, position, total },
              ),
            onMove: (fromIndex, toIndex) => void move(fromIndex, toIndex),
          }}
          adding={adding}
          addRow={
            <>
              <Input
                autoFocus
                type="number"
                min={0}
                max={MAX_OFFSET_DAYS}
                value={draft}
                aria-labelledby="reminder-add-unit"
                className="h-7 w-24"
                onChange={(event) => {
                  setDraft(event.target.value);
                  // Typing answers the refusal the last press left.
                  if (addStatus === "error") {
                    setAddStatus("idle");
                    setAddError(undefined);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void add();
                  if (event.key === "Escape") closeAdd();
                }}
              />
              {/* The unit names the input, so a reader hears "days before
                  the date, spin button" rather than a bare number box. */}
              <span id="reminder-add-unit" className="text-sm text-muted">
                <FormattedMessage
                  id="settings.reminders.addUnit"
                  defaultMessage="days before the date"
                />
              </span>
              <span className="ps-1">
                <StatusNote status={addStatus} detail={addError} />
              </span>
            </>
          }
          announcement={announcement}
        />
      </div>
    </>
  );
}
