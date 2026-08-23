// SPDX-License-Identifier: AGPL-3.0-only

/** The Matter record's named Key dates (MTR-004). */
import { useState } from "react";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { MAX_KEY_DATE_LABEL_LENGTH, MAX_KEY_DATE_NOTE_LENGTH } from "@openlaw/shared";
import { formatDeadline } from "../../lib/format";
import { TEXTAREA_CLASS } from "../../lib/form-controls";
import {
  addMatterKeyDate,
  removeMatterKeyDate,
  updateMatterKeyDate,
  type MatterDeadline,
  type MatterKeyDateInput,
} from "../../lib/matter-key-dates";
import { StatusNote, type FieldStatus } from "../status-note";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

type Editing = MatterDeadline | "new" | null;

export function MatterKeyDatesCard({
  matterNumber,
  deadlines,
  frozen,
  onDeadlines,
}: Readonly<{
  matterNumber: number;
  deadlines: readonly MatterDeadline[];
  frozen: boolean;
  onDeadlines: (deadlines: MatterDeadline[]) => void;
}>) {
  const intl = useIntl();
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<MatterDeadline | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [status, setStatus] = useState<FieldStatus>("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const busy = status === "saving";
  const upcoming = deadlines.filter((row) => !row.overdue).length;
  const overdue = deadlines.length - upcoming;

  async function write(
    action: () => Promise<
      { ok: true; deadlines: MatterDeadline[] } | { ok: false; detail?: string }
    >,
    dialog = false,
  ): Promise<string | null> {
    setStatus("saving");
    setDetail(null);
    const result = await action();
    if (!result.ok) {
      const message =
        result.detail ??
        intl.formatMessage({
          id: "matterKeyDates.writeFailed",
          defaultMessage: "The change could not be saved. Try again.",
        });
      setStatus(dialog ? "idle" : "error");
      setDetail(dialog ? null : message);
      return message;
    }
    onDeadlines(result.deadlines);
    setStatus("saved");
    return null;
  }

  return (
    <section
      id="matter-key-dates"
      aria-labelledby="matter-key-dates-heading"
      className="w-full overflow-hidden rounded-card border border-border-default bg-raised"
    >
      <header className="flex h-section-header items-center justify-between gap-2 border-b border-border-default bg-section-header px-4">
        <div className="flex items-center gap-2">
          <h2 id="matter-key-dates-heading" className="text-base font-semibold">
            <FormattedMessage id="matterKeyDates.heading" defaultMessage="Key dates" />
          </h2>
          <span
            role="img"
            aria-label={intl.formatMessage(
              {
                id: "matterKeyDates.count",
                defaultMessage: "{count, plural, one {# date} other {# dates}}",
              },
              { count: deadlines.length },
            )}
            className="rounded-chip bg-badge-count-bg px-1.5 py-px text-xs font-medium text-badge-count-fg"
          >
            {deadlines.length}
          </span>
          {deadlines.length > 0 && (
            <span className="text-sm text-muted">
              <FormattedMessage
                id="matterKeyDates.tally"
                defaultMessage="{upcoming} upcoming · {overdue} overdue"
                values={{ upcoming, overdue }}
              />
            </span>
          )}
        </div>
        {!frozen && (
          <div className="flex items-center gap-2">
            <StatusNote status={status} detail={detail} />
            <Button variant="secondary" disabled={busy} onClick={() => setEditing("new")}>
              <Plus size={16} aria-hidden="true" />
              <FormattedMessage id="matterKeyDates.add" defaultMessage="Add date" />
            </Button>
          </div>
        )}
      </header>
      {deadlines.length === 0 ? (
        <p className="px-4 py-3 text-base text-muted">
          <FormattedMessage
            id="matterKeyDates.empty"
            defaultMessage="No Key dates on this Matter yet."
          />
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-sm text-muted">
                <th scope="col" className="w-48 px-4 py-2 text-start font-medium">
                  <FormattedMessage id="matterKeyDates.date" defaultMessage="Date" />
                </th>
                <th scope="col" className="px-4 py-2 text-start font-medium">
                  <FormattedMessage id="matterKeyDates.event" defaultMessage="Event" />
                </th>
                <th scope="col" className="w-28 px-4 py-2 text-start font-medium">
                  <FormattedMessage id="matterKeyDates.state" defaultMessage="State" />
                </th>
                {!frozen && (
                  <th scope="col" className="w-16 px-4 py-2">
                    <span className="sr-only">
                      <FormattedMessage id="matterKeyDates.actions" defaultMessage="Actions" />
                    </span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {deadlines.map((row) => (
                <tr key={row.keyDateId} className="border-t border-border-muted">
                  <td className="px-4 py-2.5 font-medium">{formatDeadline(row.date)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-col">
                      <span>{row.label}</span>
                      {row.note && <span className="text-xs text-muted">{row.note}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-flex rounded-pill px-2 py-0.5 text-xs font-medium ${row.overdue ? "bg-status-danger-bg text-status-danger-fg" : row.isNext ? "bg-status-warning-bg text-status-warning-fg" : "bg-status-neutral-bg text-status-neutral-fg"}`}
                    >
                      {row.overdue ? (
                        <FormattedMessage id="matterKeyDates.overdue" defaultMessage="Overdue" />
                      ) : row.isNext ? (
                        <FormattedMessage id="matterKeyDates.next" defaultMessage="Next" />
                      ) : (
                        <FormattedMessage id="matterKeyDates.upcoming" defaultMessage="Upcoming" />
                      )}
                    </span>
                  </td>
                  {!frozen && (
                    <td className="px-4 py-2.5 text-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={busy}
                            aria-label={intl.formatMessage(
                              {
                                id: "matterKeyDates.actionsFor",
                                defaultMessage: "Actions for {label}",
                              },
                              { label: row.label },
                            )}
                          >
                            <MoreHorizontal size={16} aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditing(row)}>
                            <Pencil size={16} aria-hidden="true" />
                            <FormattedMessage id="matterKeyDates.edit" defaultMessage="Edit date" />
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => {
                              setRemoveError(null);
                              setRemoving(row);
                            }}
                          >
                            <Trash2 size={16} aria-hidden="true" />
                            <FormattedMessage
                              id="matterKeyDates.remove"
                              defaultMessage="Remove date"
                            />
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <MatterKeyDateDialog
          row={editing === "new" ? null : editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onConfirm={async (input) => {
            const refusal = await write(
              () =>
                editing === "new"
                  ? addMatterKeyDate(matterNumber, input)
                  : updateMatterKeyDate(editing.keyDateId, input),
              true,
            );
            if (refusal === null) setEditing(null);
            return refusal;
          }}
        />
      )}
      {removing && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setRemoving(null);
          }}
        >
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>
              <FormattedMessage id="matterKeyDates.removeTitle" defaultMessage="Remove Key date?" />
            </DialogTitle>
            <p className="mt-3 text-sm text-muted">
              <FormattedMessage
                id="matterKeyDates.removePrompt"
                defaultMessage="Remove {label} on {date}? This cannot be undone."
                values={{ label: removing.label, date: formatDeadline(removing.date) }}
              />
            </p>
            {removeError && (
              <p role="alert" className="mt-3 text-xs text-status-danger-fg">
                {removeError}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setRemoving(null)}
              >
                <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={async () => {
                  const refusal = await write(() => removeMatterKeyDate(removing.keyDateId), true);
                  if (refusal === null) setRemoving(null);
                  else setRemoveError(refusal);
                }}
              >
                <FormattedMessage id="matterKeyDates.remove" defaultMessage="Remove date" />
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}

function MatterKeyDateDialog({
  row,
  busy,
  onClose,
  onConfirm,
}: Readonly<{
  row: MatterDeadline | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (input: MatterKeyDateInput) => Promise<string | null>;
}>) {
  const intl = useIntl();
  const [date, setDate] = useState(row?.date ?? "");
  const [label, setLabel] = useState(row?.label ?? "");
  const [note, setNote] = useState(row?.note ?? "");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!date)
      return setError(
        intl.formatMessage({ id: "matterKeyDates.needDate", defaultMessage: "Pick a date." }),
      );
    if (!label.trim())
      return setError(
        intl.formatMessage({
          id: "matterKeyDates.needLabel",
          defaultMessage: "Name what the date is.",
        }),
      );
    setError(await onConfirm({ date, label: label.trim(), note: note.trim() || null }));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          {row ? (
            <FormattedMessage id="matterKeyDates.editTitle" defaultMessage="Edit Key date" />
          ) : (
            <FormattedMessage id="matterKeyDates.addTitle" defaultMessage="Add a Key date" />
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
            <Label htmlFor="matter-key-date-date">
              <FormattedMessage id="matterKeyDates.date" defaultMessage="Date" />
            </Label>
            <Input
              id="matter-key-date-date"
              type="date"
              value={date}
              autoFocus
              onChange={(event) => {
                setDate(event.target.value);
                setError(null);
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="matter-key-date-label">
              <FormattedMessage id="matterKeyDates.event" defaultMessage="Event" />
            </Label>
            <Input
              id="matter-key-date-label"
              value={label}
              maxLength={MAX_KEY_DATE_LABEL_LENGTH}
              onChange={(event) => {
                setLabel(event.target.value);
                setError(null);
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="matter-key-date-note">
              <FormattedMessage id="matterKeyDates.note" defaultMessage="Note (optional)" />
            </Label>
            <textarea
              id="matter-key-date-note"
              value={note}
              rows={3}
              maxLength={MAX_KEY_DATE_NOTE_LENGTH}
              className={TEXTAREA_CLASS}
              onChange={(event) => {
                setNote(event.target.value);
                setError(null);
              }}
            />
          </div>
          {error && (
            <p role="alert" className="text-xs text-status-danger-fg">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="submit" disabled={busy}>
              {row ? (
                <FormattedMessage id="action.save" defaultMessage="Save" />
              ) : (
                <FormattedMessage id="matterKeyDates.add" defaultMessage="Add date" />
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
