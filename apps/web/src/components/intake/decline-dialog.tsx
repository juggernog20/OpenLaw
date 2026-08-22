// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DES-058: the Decline dialog, drawn from the `Overlay` of the I4 frame
 * in `designs/intake.pen` — the first of INT-007's three dispositions,
 * and the shape the other two follow.
 *
 * **The reason is required, and the box says so before the seam does.**
 * INT-006 makes "no" always arrive with a why. An empty box is refused
 * here so nobody presses a button to learn that. The seam refuses it
 * again, because a rule only a browser holds is not a rule.
 *
 * **The dialog says who reads the reason.** I4's note under the box is
 * kept whole: the requester is mailed it and sees it on their own page.
 * That is the fact somebody hesitating over the wording wants, and it is
 * said where the act is taken (DES-035 clause 17).
 *
 * **Cancelling leaves the Request untouched.** Nothing is written when
 * this opens — INT-007 has no claim step and no parked state, so the
 * Inbox row's Assign button is an entry to the choice rather than a
 * write, and closing this puts the Request back in the queue exactly as
 * it was.
 *
 * **A lost race ends the dialog in a statement, not an error.** With no
 * claim, two triagers open one Request and both press. The seam answers
 * the loser the outcome that was recorded (INT-007, TECH-020), and this
 * says what that outcome was and offers one way out. It does not offer
 * the button again: there is nothing left to decide, and a form that
 * stayed pressable would invite somebody to try to overwrite a decision
 * that is already made.
 */

import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Ban, Mail } from "lucide-react";
import { MAX_DECLINE_REASON_LENGTH, type RequestOutcome } from "@openlaw/shared";
import { TEXTAREA_CLASS } from "../../lib/form-controls";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Label } from "../ui/label";

/** The error line's id, named on the box the message is about so a
 * screen reader reads the two together (DES-011). */
const ERROR_ID = "decline-reason-error";

/**
 * What the dialog answers back to the page that opened it.
 *
 * Narrower than `DispositionOutcome` on purpose: the page's write answers
 * the whole envelope, and the dialog reads none of it. What it acts on is
 * whether the decline landed, whether somebody else decided first, and
 * the sentence to print when neither.
 */
export type DeclineResult =
  /** It landed. The page repaints from the envelope the write answered. */
  | { ok: true }
  /** Somebody else decided first, and this is what they decided. */
  | { ok: false; alreadyDecided: RequestOutcome }
  /** Any other refusal, in the seam's own words where it gave any. */
  | { ok: false; alreadyDecided?: undefined; detail?: string };

export function DeclineDialog({
  reference,
  busy,
  onClose,
  onDecline,
}: Readonly<{
  /** The Request's R-### reference, which the title quotes. */
  reference: string;
  busy: boolean;
  onClose: () => void;
  onDecline: (reason: string) => Promise<DeclineResult>;
}>) {
  const intl = useIntl();
  const [reason, setReason] = useState("");
  /** What is wrong, and whether it is about the box. A refusal the seam
   * gave belongs to no control — it is about the write — so only the one
   * the form itself checks marks the box, which is the shape the key-date
   * and renewal dialogs already use. */
  const [error, setError] = useState<{ onBox: boolean; message: string } | null>(null);
  /** The decision somebody else recorded first, once the seam has said
   * so. Set, the dialog stops being a form and becomes a statement. */
  const [alreadyDecided, setAlreadyDecided] = useState<RequestOutcome | null>(null);

  async function submit() {
    if (busy) return;
    // The one refusal the seam gives that the reader can answer without
    // pressing anything: the box is empty. Everything else is the seam's
    // to refuse — one copy of a rule (DES-035 clause 12).
    if (reason.trim() === "") {
      setError({
        onBox: true,
        message: intl.formatMessage({
          id: "decline.needReason",
          defaultMessage: "Write why. The requester is sent this.",
        }),
      });
      return;
    }
    const result = await onDecline(reason.trim());
    if (result.ok) return;
    if (result.alreadyDecided) {
      setAlreadyDecided(result.alreadyDecided);
      setError(null);
      return;
    }
    setError({
      onBox: false,
      message:
        result.detail ??
        intl.formatMessage({
          id: "decline.failed",
          defaultMessage: "The request could not be declined. Try again.",
        }),
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage
            id="decline.title"
            defaultMessage="Decline {reference}"
            values={{ reference }}
          />
        </DialogTitle>
        {alreadyDecided ? (
          <div className="mt-4 flex flex-col gap-4">
            {/* The whole content of a lost race, in the two sentences a
                triager acts on: what was recorded, and where to read it.
                No form, because there is nothing left to decide. */}
            <p className="text-sm text-muted">
              <FormattedMessage
                id="decline.alreadyDecided"
                defaultMessage="{outcome, select, converted {Somebody else already converted this request.} resolved {Somebody else already resolved this request.} declined {Somebody else already declined this request.} other {Somebody else already decided this request.}}"
                values={{ outcome: alreadyDecided }}
              />
            </p>
            <p className="text-sm text-muted">
              <FormattedMessage
                id="decline.alreadyDecidedRead"
                defaultMessage="Close this to read what they recorded."
              />
            </p>
            <div className="flex justify-end">
              {/* Focus follows the content: the box and the submit that
                  held it have just unmounted, and focus left on nothing
                  would drop a keyboard reader to the top of the document
                  (DES-011). The one control left is the one that takes
                  it. */}
              <Button type="button" autoFocus onClick={onClose}>
                <FormattedMessage id="action.close" defaultMessage="Close" />
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="mt-4 flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {/* I4's opening sentence, whole: what declining does to the
                Request, and that the reason is not optional and not
                private. */}
            <p className="text-sm text-muted">
              <FormattedMessage
                id="decline.explains"
                defaultMessage="Declining closes the request without converting it. The reason is required and is shared with the requester."
              />
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="decline-reason">
                <FormattedMessage id="decline.reason" defaultMessage="Reason" />
                {/* I4's required marker, in the house pattern: the
                    asterisk for the eye, the word for the screen
                    reader. */}
                <span aria-hidden="true" className="ms-0.5 text-status-danger-fg">
                  *
                </span>
                <span className="sr-only">
                  <FormattedMessage id="intake.field.requiredMark" defaultMessage="(required)" />
                </span>
              </Label>
              <textarea
                id="decline-reason"
                value={reason}
                rows={4}
                autoFocus
                // No `required` attribute: the label already says the
                // box is required, and the browser's native refusal
                // would speak over the sentence this dialog writes.
                maxLength={MAX_DECLINE_REASON_LENGTH}
                className={TEXTAREA_CLASS}
                {...(error?.onBox ? { "aria-invalid": true, "aria-describedby": ERROR_ID } : {})}
                onChange={(event) => {
                  setReason(event.target.value);
                  setError(null);
                }}
              />
              {/* I4's note, which names the two places the words land. */}
              <p className="flex items-start gap-1.5 text-xs text-muted">
                <Mail size={16} aria-hidden="true" className="mt-px shrink-0" />
                <FormattedMessage
                  id="decline.notifyNote"
                  defaultMessage="The requester is emailed this and sees it on their request."
                />
              </p>
            </div>
            {error !== null && (
              <p id={ERROR_ID} role="alert" className="text-xs text-status-danger-fg">
                {error.message}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
              </Button>
              {/* The danger button, and I4's own verb. Declining is the
                  one disposition that ends an ask with a no, and it is
                  the only act on this page that cannot be taken back. */}
              <Button type="submit" variant="danger" disabled={busy}>
                <Ban size={16} aria-hidden="true" />
                <FormattedMessage id="decline.submit" defaultMessage="Decline request" />
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
