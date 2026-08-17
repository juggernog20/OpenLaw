// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DES-043: the Renew dialog, drawn from `S9 Overlay` in the C9 frame of
 * `designs/contracts.pen` — the compound edit DES-017 carves out of the
 * inline-commit rule, because a roll is a date **and** the assertion
 * that the term rolled, and the two commit together.
 *
 * **The mock draws four vehicles and this slice ships one.** CTR-007
 * offers a confirmed roll, an amendment, a child contract, and a
 * standalone successor; the routing that builds the other three is the
 * next slice. So the mock's radio list is not drawn: a group of one
 * radio is a control that decides nothing, and three options that
 * cannot be picked would advertise acts the product does not have yet
 * (DES-035 clauses 9 and 13). What the selected option says — "Same
 * record, the expiry advances" — is drawn instead as the dialog's own
 * statement of what pressing the button does.
 *
 * **The proposal is the seam's and the commitment is the person's.**
 * The record answers where a roll would land (the current expiry plus
 * the renewal period, month arithmetic and all) and the box is seeded
 * with it. The person may put a different date in before pressing,
 * because a roll whose dates shifted in negotiation is recorded as it
 * really landed (CTR-007). Nothing here recomputes the proposal:
 * DES-040 clause 4's rule, applied to a date instead of a count.
 *
 * **The confirm carries the expiry it was raised against.** That is the
 * saved value and never the draft — the seam compares it under the
 * contract's row lock, which is what makes two people confirming one
 * roll advance the term exactly once.
 */

import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { History } from "lucide-react";
import { formatShortDate } from "../../lib/format";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

/** The error line's id, named on the box the message is about so a
 * screen reader reads the two together (DES-011). */
const ERROR_ID = "confirm-renewal-error";

export function ConfirmRenewalDialog({
  reference,
  fromExpiry,
  proposedExpiry,
  renewalPeriodMonths,
  busy,
  onClose,
  onConfirm,
}: Readonly<{
  /** The record's CTR-003 reference, as the mock's own sentence names
   * it — "C-51 auto-renews in 12-month periods". */
  reference: string;
  /** The expiry the record holds now: what the roll advances from, and
   * the precondition the confirm carries. */
  fromExpiry: string;
  /** Where the record says a roll would land, or null when it records
   * no renewal period to add. The box is seeded with it. */
  proposedExpiry: string | null;
  /** How far one roll advances the term, or null when nobody recorded
   * it. Only the dialog's opening sentence reads it. */
  renewalPeriodMonths: number | null;
  busy: boolean;
  onClose: () => void;
  /** Answers the refusal to print, or null when the roll landed. */
  onConfirm: (toExpiry: string) => Promise<string | null>;
}>) {
  const intl = useIntl();
  const [draft, setDraft] = useState(proposedExpiry ?? "");
  /** What is wrong, and whether it is about the box. A refusal the seam
   * gave belongs to no control — it is about the write — so only the
   * two the form itself checks mark the input, which is the shape the
   * key-date dialog already uses. */
  const [error, setError] = useState<{ onBox: boolean; message: string } | null>(null);

  const refuse = (message: string) => setError({ onBox: true, message });

  async function submit() {
    if (busy) return;
    // The two refusals the seam gives, said here first so the reader is
    // not asked to press a button to find out that the box is empty or
    // that the date goes the wrong way. Everything else is the seam's
    // to refuse — one copy of a rule (DES-035 clause 12).
    if (draft === "") {
      refuse(
        intl.formatMessage({
          id: "renewal.needExpiry",
          defaultMessage: "Pick the date the term now runs to.",
        }),
      );
      return;
    }
    if (draft <= fromExpiry) {
      refuse(
        intl.formatMessage({
          id: "renewal.mustAdvance",
          defaultMessage: "A roll moves the term forward. Pick a date after the current expiry.",
        }),
      );
      return;
    }
    const refusal = await onConfirm(draft);
    setError(refusal === null ? null : { onBox: false, message: refusal });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage id="renewal.title" defaultMessage="Confirm renewal" />
        </DialogTitle>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {/* The mock's opening sentence, plus what the one vehicle
              this slice ships actually does. The second half is the
              selected option card's own words: same record, the expiry
              advances. */}
          <p className="text-sm text-muted">
            {renewalPeriodMonths === null ? (
              <FormattedMessage
                id="renewal.introNoPeriod"
                defaultMessage="{reference} auto-renews, and records no renewal period. Confirming the roll advances this record's own expiry date to the date you enter."
                values={{ reference }}
              />
            ) : (
              <FormattedMessage
                id="renewal.intro"
                defaultMessage="{reference} auto-renews in {months, plural, one {#-month} other {#-month}} periods. Confirming the roll advances this record's own expiry date."
                values={{ reference, months: renewalPeriodMonths }}
              />
            )}
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="renewal-expiry">
              <FormattedMessage id="renewal.field.expiry" defaultMessage="New expiry date" />
            </Label>
            <Input
              id="renewal-expiry"
              type="date"
              value={draft}
              autoFocus
              {...(error?.onBox ? { "aria-invalid": true, "aria-describedby": ERROR_ID } : {})}
              onChange={(event) => {
                setDraft(event.target.value);
                setError(null);
              }}
            />
            {/* What the term runs to now, so the person can see what
                they are moving from without leaving the dialog. */}
            <p className="text-xs text-muted">
              <FormattedMessage
                id="renewal.currentExpiry"
                defaultMessage="The term currently runs to {date}."
                values={{ date: formatShortDate(fromExpiry, { locale: intl.locale }) }}
              />
            </p>
          </div>
          {/* What the act does, said where the act is taken (DES-035
              clause 17). Both halves are facts somebody hesitating
              wants: it is on the record for good, and it moves a date
              rather than the contract's lifecycle. The mock's second
              sentence — that reminders stop — describes M18's delivery
              and is withheld until that slice exists. */}
          <p className="flex items-start gap-1.5 text-xs text-muted">
            <History size={16} aria-hidden="true" className="mt-px shrink-0" />
            <FormattedMessage
              id="renewal.recordedNote"
              defaultMessage="Recorded on the record's activity. The contract's status and stage do not change."
            />
          </p>
          {error !== null && (
            <p id={ERROR_ID} role="alert" className="text-xs text-status-danger-fg">
              {error.message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            {/* The verb rather than "Save" (DES-035 clause 10): a roll
                asserts that a term renewed, and an assertion should not
                be pressed by reflex. The primary button rather than the
                danger one — a renewal is a normal act, and red would
                say a mistake was being made. */}
            <Button type="submit" disabled={busy}>
              <FormattedMessage id="renewal.confirm" defaultMessage="Confirm renewal" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
