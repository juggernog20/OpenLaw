// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The "Key dates" section of the contract record (M16/3), drawn from the
 * C6 mock: every date this contract has, in one list, with the next one
 * at the top.
 *
 * **The section draws the union, not a table of rows** (CTR-009). Three
 * sources land in one list — the free-form key dates the team adds, the
 * contract's expiry, and the derived notice deadline — because the
 * question the surface answers is "what is the next date on this
 * contract", and that question does not care which column a date came
 * out of. The Source chip is what tells them apart.
 *
 * **Only a key date has controls.** The expiry and the notice deadline
 * are the term, and the term is edited on the Overview's Contract card
 * (DES-040); a row the record derives carries no menu at all, which is
 * the absence rule the Approvals section already follows. The notice
 * deadline is not editable anywhere, because it is a subtraction rather
 * than a field.
 *
 * **The order is the seam's, and the order is the answer.** Nothing here
 * sorts: the union arrives with what is ahead nearest-first and what has
 * gone by after it, for DES-040 clause 4's reason — a second copy on this
 * page would drift the first time a date moved. The card draws what it
 * was handed, in the order it was handed.
 *
 * **There is no Due column** (DES-042 amended). It held a distance and
 * the word "Past", and both are the Date cell restated: a reader who can
 * see the date can see how far off it is, and the sorted list puts the
 * nearest one on top. The seam still answers `daysAway`, which is what
 * the head's "3 upcoming · 1 past" tally counts.
 *
 * **Adding and editing are dialogs; removing is one click.** A key date
 * is a date, a label, and a note that commit together — the compound
 * edit DES-017 carves out of the inline rule — so both writes collect
 * all three in a form. Removing collects nothing and destroys nothing
 * that matters: the row goes, the activity entry keeps it (DD-017), and
 * putting the date back is one dialog away. That is the same reasoning
 * that leaves an approval's cancel unconfirmed (DES-035 clause 10).
 *
 * **No owner column and no reminder column** (CTR-009, NOT-004). The
 * mock draws both. Neither has a datum behind it: key dates are
 * deliberately flat, and one global offset list already governs every
 * tracked date, so a per-row reminder cell would describe a rule the
 * product does not have. The mock's note row goes with them — it
 * describes M18's delivery, and a surface that explains a rule it does
 * not yet apply is a surface that is wrong (DES-035 clause 13).
 */

import { useState } from "react";
import { useRecord } from "../record-context";
import { FormattedMessage, useIntl, defineMessage, type IntlShape } from "react-intl";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { MAX_KEY_DATE_LABEL_LENGTH, MAX_KEY_DATE_NOTE_LENGTH } from "@openlaw/shared";
import {
  addContractKeyDate,
  isKeyDate,
  removeContractKeyDate,
  updateContractKeyDate,
  type ContractDeadline,
  type KeyDateInput,
} from "../../lib/key-dates";
import { formatShortDate } from "../../lib/format";
import { TEXTAREA_CLASS } from "../../lib/form-controls";
import { StatusNote, type FieldStatus } from "../status-note";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

/** The head's tally, one message per state so a zero is left out rather
 * than printed — the shape the Approvals head's tally already takes. */
const COUNT_LABEL = {
  upcoming: defineMessage({
    id: "keyDates.count.upcoming",
    defaultMessage: "{count} upcoming",
  }),
  past: defineMessage({ id: "keyDates.count.past", defaultMessage: "{count} past" }),
} as const;

/** What the Source chip says (C6's own two readings). The expiry and
 * the notice deadline share one word, because what the chip answers is
 * "did the team write this down, or did the term produce it" — and the
 * Event cell beside it is where the two derived rows are told apart. */
const DERIVED_SOURCE = defineMessage({
  id: "keyDates.source.derived",
  defaultMessage: "Derived",
});
const SOURCE_LABEL = {
  key_date: defineMessage({ id: "keyDates.source.keyDate", defaultMessage: "Key date" }),
  expiry: DERIVED_SOURCE,
  notice_deadline: DERIVED_SOURCE,
} as const satisfies Record<ContractDeadline["source"], { id: string; defaultMessage: string }>;

/** The Source chip's two treatments. A derived row takes the neutral
 * status family; a key date takes the record's own control surface with
 * a hairline, exactly as the C6 mock draws the pair. */
const SOURCE_CHIP = {
  key_date: "border border-border-muted bg-control text-muted",
  expiry: "bg-status-neutral-bg text-status-neutral-fg",
  notice_deadline: "bg-status-neutral-bg text-status-neutral-fg",
} as const satisfies Record<ContractDeadline["source"], string>;

/** One key date as the dialog collects it, before it is a write. */
type DraftInput = { date: string; label: string; note: string };

/** What the add and edit dialogs are opened for: a blank form, or the
 * row being changed. */
type Editing = { row: null } | { row: ContractDeadline & { keyDateId: string } };

export function KeyDatesCard({
  deadlines,
  noticePeriodDays,
  onDeadlines,
}: Readonly<{
  /** The CTR-009 union as the seam answered it — ordered, counted, and
   * with the next deadline already marked. */
  deadlines: readonly ContractDeadline[];
  /** CTR-006's notice period, which is the only part of the derived
   * deadline's own sentence the union does not carry: the row says how
   * long before the expiry it falls. Null when none is recorded, in
   * which case no notice-deadline row exists to say it. */
  noticePeriodDays: number | null;
  /** An archived record, or a read-only viewer: no control is drawn. */
  onDeadlines: (deadlines: ContractDeadline[]) => void;
}>) {
  const { record, frozen } = useRecord();
  const contractNumber = record.number;
  const intl = useIntl();
  const [status, setStatus] = useState<FieldStatus>("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const busy = status === "saving";

  const counts = {
    upcoming: deadlines.filter((row) => row.daysAway >= 0).length,
    past: deadlines.filter((row) => row.daysAway < 0).length,
  };
  const tally = (["upcoming", "past"] as const).filter((key) => counts[key] > 0);

  /**
   * Every write says saving, then saved or why not, and replaces the
   * union it is given — because a write moves more rows than the one it
   * was addressed at (DES-017): adding, moving, or removing a date can
   * change which date the list calls next.
   *
   * A refusal is reported **once** (DES-035 clause 12). A write raised
   * from a dialog says it in that dialog's own form, where the reader's
   * attention already is; a write with no dialog — the row's remove —
   * has only the header, so that is where it lands.
   */
  async function run(
    write: () => Promise<
      { ok: true; deadlines: ContractDeadline[] } | { ok: false; detail?: string }
    >,
    reportedInDialog = false,
  ): Promise<string | null> {
    setStatus("saving");
    setDetail(null);
    const outcome = await write();
    if (!outcome.ok) {
      setStatus(reportedInDialog ? "idle" : "error");
      setDetail(reportedInDialog ? null : (outcome.detail ?? null));
      return (
        outcome.detail ??
        intl.formatMessage({
          id: "keyDates.writeFailed",
          defaultMessage: "The change could not be saved. Try again.",
        })
      );
    }
    onDeadlines(outcome.deadlines);
    setStatus("saved");
    setDetail(null);
    return null;
  }

  return (
    <section
      id="contract-key-dates"
      aria-labelledby="contract-key-dates-heading"
      className="w-full overflow-hidden rounded-card border border-border-default bg-raised"
    >
      <header className="flex h-section-header items-center justify-between gap-2 rounded-t-card border-b border-border-default bg-section-header px-4">
        <div className="flex min-w-0 items-center gap-2">
          <h2 id="contract-key-dates-heading" className="text-base font-semibold">
            <FormattedMessage id="keyDates.section" defaultMessage="Key dates" />
          </h2>
          {/* The neutral counter badge, drawn the way the Documents and
              Approvals sections draw theirs: a bare number on screen,
              and a whole phrase for a screen reader, because a lone "5"
              after a heading says nothing.

              It counts the whole union rather than only the rows the
              record holds, because the union is what the section draws
              — a reader counting the lines below gets this number. */}
          <span
            role="img"
            aria-label={intl.formatMessage(
              {
                id: "keyDates.countLabel",
                defaultMessage: "{count, plural, one {# date} other {# dates}}",
              },
              { count: deadlines.length },
            )}
            className="rounded-chip bg-badge-count-bg px-1.5 py-px text-xs font-medium text-badge-count-fg"
          >
            {intl.formatNumber(deadlines.length)}
          </span>
          {/* The C6 mock's toolbar tally — "4 upcoming · 1 past". A
              state nobody is in is left out rather than printed as a
              zero, which is what keeps the line short enough to read
              beside a heading. */}
          {tally.length > 0 && (
            <span className="truncate text-sm text-muted">
              {tally.map((key, index) => (
                <span key={key}>
                  {index > 0 && <span aria-hidden="true"> · </span>}
                  <FormattedMessage {...COUNT_LABEL[key]} values={{ count: counts[key] }} />
                </span>
              ))}
            </span>
          )}
        </div>
        {!frozen && (
          <div className="flex shrink-0 items-center gap-2">
            <StatusNote status={status} detail={detail} />
            <Button variant="secondary" disabled={busy} onClick={() => setEditing({ row: null })}>
              <Plus size={16} aria-hidden="true" />
              <FormattedMessage id="keyDates.add" defaultMessage="Add date" />
            </Button>
          </div>
        )}
      </header>
      {deadlines.length === 0 ? (
        <p className="px-4 py-3 text-base text-muted">
          <FormattedMessage
            id="keyDates.empty"
            defaultMessage="No key dates on this contract yet, and no term dates to show beside them."
          />
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-start text-sm font-medium text-muted">
                <th scope="col" className="w-32 px-4 py-2 text-start font-medium">
                  <FormattedMessage id="keyDates.column.date" defaultMessage="Date" />
                </th>
                <th scope="col" className="px-4 py-2 text-start font-medium">
                  <FormattedMessage id="keyDates.column.event" defaultMessage="Event" />
                </th>
                <th scope="col" className="w-32 px-4 py-2 text-start font-medium">
                  <FormattedMessage id="keyDates.column.source" defaultMessage="Source" />
                </th>
                {!frozen && (
                  <th scope="col" className="w-16 px-4 py-2 text-end font-medium">
                    <span className="sr-only">
                      <FormattedMessage id="keyDates.column.actions" defaultMessage="Actions" />
                    </span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {deadlines.map((row) => (
                <DeadlineRow
                  // The key date's own id where there is one; the source
                  // otherwise, because at most one expiry and one notice
                  // deadline can ever be in the list.
                  key={row.keyDateId ?? row.source}
                  row={row}
                  intl={intl}
                  noticePeriodDays={noticePeriodDays}
                  busy={busy}
                  frozen={frozen}
                  onEdit={() => isKeyDate(row) && setEditing({ row })}
                  onRemove={() => {
                    if (isKeyDate(row)) void run(() => removeContractKeyDate(row.keyDateId));
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <KeyDateDialog
          row={editing.row}
          busy={busy}
          onClose={() => setEditing(null)}
          onConfirm={async (input) => {
            const refusal = await run(
              () =>
                editing.row
                  ? updateContractKeyDate(editing.row.keyDateId, input)
                  : addContractKeyDate(contractNumber, input),
              true,
            );
            if (refusal === null) setEditing(null);
            return refusal;
          }}
        />
      )}
    </section>
  );
}

/**
 * One date on the surface, whichever source it came from.
 *
 * The Event cell names it: a key date says what the team called it, and
 * the two derived rows are named here in the record's own copy, because
 * the seam holds no label for a date it did not store (DES-013).
 */
function DeadlineRow({
  row,
  intl,
  noticePeriodDays,
  busy,
  frozen,
  onEdit,
  onRemove,
}: Readonly<{
  row: ContractDeadline;
  intl: IntlShape;
  noticePeriodDays: number | null;
  busy: boolean;
  frozen: boolean;
  onEdit: () => void;
  onRemove: () => void;
}>) {
  const editable = isKeyDate(row);
  return (
    <tr className="border-t border-border-muted">
      <td className="px-4 py-2.5">
        <span className="text-base font-medium text-primary">{formatShortDate(row.date)}</span>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex min-w-0 flex-col">
          <span className="text-base text-primary">
            <EventName row={row} noticePeriodDays={noticePeriodDays} />
          </span>
          {/* The note, under the name it belongs to. The C6 mock has no
              column for it and the table has no width for a sixth, so it
              takes the secondary line DES-035 clause 5 already spends on
              "a fact about this row". */}
          {row.note !== null && <span className="text-xs break-words text-muted">{row.note}</span>}
        </div>
      </td>
      <td className="px-4 py-2.5">
        <span
          className={`inline-flex rounded-chip px-1.5 py-0.5 text-xs font-medium ${SOURCE_CHIP[row.source]}`}
        >
          <FormattedMessage {...SOURCE_LABEL[row.source]} />
        </span>
      </td>
      {!frozen && (
        <td className="px-4 py-2.5 text-end">
          {/* The row's two acts, in the menu the record's other rows put
              their acts in (DES-035 clause 9). Absent — never disabled —
              on the two derived rows: the expiry is edited on the
              Contract card and the notice deadline is a subtraction, so
              a greyed-out "Edit" here would invite somebody to work out
              why it is greyed out. */}
          {editable && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={busy}
                  aria-label={intl.formatMessage(
                    { id: "keyDates.actionsFor", defaultMessage: "Actions for {label}" },
                    { label: row.label },
                  )}
                >
                  <MoreHorizontal size={16} aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onEdit}>
                  <Pencil size={16} aria-hidden="true" />
                  <FormattedMessage id="keyDates.edit" defaultMessage="Edit date" />
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onRemove}>
                  <Trash2 size={16} aria-hidden="true" />
                  <FormattedMessage id="keyDates.remove" defaultMessage="Remove date" />
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </td>
      )}
    </tr>
  );
}

/** What one row is called. The record's own dates carry their label; the
 * two the term derives are named here, and the notice deadline says how
 * far before the expiry it falls, exactly as the C6 mock does. */
function EventName({
  row,
  noticePeriodDays,
}: Readonly<{ row: ContractDeadline; noticePeriodDays: number | null }>) {
  if (row.label !== null) return <>{row.label}</>;
  if (row.source === "expiry") {
    return <FormattedMessage id="keyDates.event.expiry" defaultMessage="Current term expires" />;
  }
  // A notice deadline exists only where a notice period does, so the
  // count is always there to print; the bare sentence is the fallback a
  // reader would otherwise never see.
  return noticePeriodDays === null ? (
    <FormattedMessage id="keyDates.event.notice" defaultMessage="Renewal notice deadline" />
  ) : (
    <FormattedMessage
      id="keyDates.event.noticeWithPeriod"
      defaultMessage="Renewal notice deadline — {days, plural, one {# day} other {# days}} before expiry"
      values={{ days: noticePeriodDays }}
    />
  );
}

/**
 * One key date, collected whole (CTR-009).
 *
 * A dialog rather than three inline commits, because the three are one
 * act: a date without a label is a date nobody can act on, so they land
 * together or not at all — the compound edit DES-017 carves out of the
 * inline rule. The same form adds and edits: the fields are the same
 * three, and a second component for one different title would be a
 * second place for the bounds to drift.
 */
function KeyDateDialog({
  row,
  busy,
  onClose,
  onConfirm,
}: Readonly<{
  /** The row being changed, or `null` when a date is being added. */
  row: (ContractDeadline & { keyDateId: string }) | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (input: KeyDateInput) => Promise<string | null>;
}>) {
  const intl = useIntl();
  const [draft, setDraft] = useState<DraftInput>({
    date: row?.date ?? "",
    label: row?.label ?? "",
    note: row?.note ?? "",
  });
  /** What is wrong, and which box it is about. A refusal the seam gave
   * belongs to no box — it is about the write — so it names none, and
   * only the two the form itself checks point at a control. */
  const [error, setError] = useState<{ field: "date" | "label" | null; message: string } | null>(
    null,
  );

  async function submit() {
    if (busy) return;
    // The two refusals the seam gives, said here first so the reader is
    // not asked to press a button to find out that a required box is
    // empty. Everything else is the seam's to refuse (DES-035's rule
    // about one copy of a rule).
    if (draft.date === "") {
      setError({
        field: "date",
        message: intl.formatMessage({ id: "keyDates.needDate", defaultMessage: "Pick a date." }),
      });
      return;
    }
    if (draft.label.trim() === "") {
      setError({
        field: "label",
        message: intl.formatMessage({
          id: "keyDates.needLabel",
          defaultMessage: "Name what the date is.",
        }),
      });
      return;
    }
    const refusal = await onConfirm({
      date: draft.date,
      label: draft.label.trim(),
      note: draft.note.trim() || null,
    });
    setError(refusal === null ? null : { field: null, message: refusal });
  }

  const change = (next: Partial<DraftInput>) => {
    setDraft((current) => ({ ...current, ...next }));
    setError(null);
  };

  /** The error line's id, named on the box the message is about so a
   * screen reader reads the two together (DES-011). */
  const ERROR_ID = "key-date-error";
  const invalid = (field: "date" | "label") =>
    error?.field === field ? ({ "aria-invalid": true, "aria-describedby": ERROR_ID } as const) : {};

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          {row ? (
            <FormattedMessage id="keyDates.editTitle" defaultMessage="Edit key date" />
          ) : (
            <FormattedMessage id="keyDates.addTitle" defaultMessage="Add a key date" />
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
            <Label htmlFor="key-date-date">
              <FormattedMessage id="keyDates.field.date" defaultMessage="Date" />
            </Label>
            <Input
              id="key-date-date"
              type="date"
              value={draft.date}
              autoFocus
              {...invalid("date")}
              onChange={(event) => change({ date: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="key-date-label">
              <FormattedMessage id="keyDates.field.label" defaultMessage="Event" />
            </Label>
            <Input
              id="key-date-label"
              value={draft.label}
              maxLength={MAX_KEY_DATE_LABEL_LENGTH}
              {...invalid("label")}
              onChange={(event) => change({ label: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="key-date-note">
              <FormattedMessage id="keyDates.field.note" defaultMessage="Note (optional)" />
            </Label>
            <textarea
              id="key-date-note"
              value={draft.note}
              rows={3}
              maxLength={MAX_KEY_DATE_NOTE_LENGTH}
              className={TEXTAREA_CLASS}
              onChange={(event) => change({ note: event.target.value })}
            />
          </div>
          {/* No reminder note here. NOT-004's one global offset list is
              what this surface will not do per date, but nothing in this
              build reminds anybody of anything and there is no Settings
              control to point at — so the note would send a reader to a
              screen that does not exist. It arrives with the delivery
              that makes it true (M18), the rule DES-035 clause 13 sets
              and this milestone already followed twice. */}
          {error && (
            <p id={ERROR_ID} role="alert" className="text-xs text-status-danger-fg">
              {error.message}
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
                <FormattedMessage id="keyDates.add" defaultMessage="Add date" />
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
