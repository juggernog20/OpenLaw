// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Resolve dialog (INT-006, INT-007, DES-058, #419) — the second of
 * INT-007's three dispositions, and the one that says "answered".
 *
 * **`designs/intake.pen` draws no Resolve dialog.** I4 is Decline's and
 * I3 is Convert's; the sub-bar's Resolve button opens nothing in the
 * mocks. So this is I4's anatomy with Resolve's own content, which is
 * what DES-058 clause 3 set up: the house dialog, the reference in the
 * title, one sentence saying what the act does, one box, the note that
 * names who reads it, and Cancel beside the verb.
 *
 * **The box is optional, and it says so where the box is.** INT-006's
 * trivial question is answered in the conversation, so by the time
 * somebody presses Resolve the answer is often already on the thread.
 * The label says `(optional)` where Decline's says required, and there
 * is no refusal to write: pressing the button with an empty box is
 * a resolution with no closing reply, which is a thing somebody means to
 * do.
 *
 * **What the box writes is a comment, and the note says so.** The reply
 * lands on the thread the requester is already reading, and the seam
 * mails it to them as a reply. The decline reason goes somewhere else —
 * onto the Request itself — and somebody about to type into one of the
 * two boxes needs to know which they are doing.
 *
 * **Cancelling leaves the Request untouched**, and **a lost race ends
 * the dialog in a statement** — both the scaffold's, unchanged from
 * Decline (DES-058 clause 5). With no claim step two triagers open one
 * Request and both press, and the loser is told what was recorded rather
 * than being offered the button again.
 */

import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Check, MessageSquare } from "lucide-react";
import type { RequestOutcome } from "@openlaw/shared";
import { TEXTAREA_CLASS } from "../../lib/form-controls";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Label } from "../ui/label";

/**
 * What the dialog answers back to the page that opened it.
 *
 * The same three arms Decline's result has, for the same reason: the
 * page's write answers the whole envelope and the dialog reads none of
 * it, so what it acts on is whether the resolution landed, whether
 * somebody else decided first, and the sentence to print when neither.
 */
export type ResolveResult =
  /** It landed. The page repaints from the envelope the write answered. */
  | { ok: true }
  /** Somebody else decided first, and this is what they decided. */
  | { ok: false; alreadyDecided: RequestOutcome }
  /** Any other refusal, in the seam's own words where it gave any. */
  | { ok: false; alreadyDecided?: undefined; detail?: string };

export function ResolveDialog({
  reference,
  busy,
  onClose,
  onResolve,
}: Readonly<{
  /** The Request's R-### reference, which the title quotes. */
  reference: string;
  busy: boolean;
  onClose: () => void;
  /** Takes the closing reply, or nothing where the box was left empty. */
  onResolve: (reply?: string) => Promise<ResolveResult>;
}>) {
  const intl = useIntl();
  const [reply, setReply] = useState("");
  /** The seam's own refusal, where it gave one. There is no refusal of
   * this dialog's own to hold: the one box on it is optional, so there
   * is nothing it can check before asking. */
  const [error, setError] = useState<string | null>(null);
  /** The decision somebody else recorded first, once the seam has said
   * so. Set, the dialog stops being a form and becomes a statement. */
  const [alreadyDecided, setAlreadyDecided] = useState<RequestOutcome | null>(null);

  async function submit() {
    if (busy) return;
    // Trimmed here, and an empty box is genuinely no reply rather than
    // an empty one. The seam refuses a blank reply, so a box of spaces
    // must not be sent as one.
    const trimmed = reply.trim();
    const result = await onResolve(trimmed === "" ? undefined : trimmed);
    if (result.ok) return;
    if (result.alreadyDecided) {
      setAlreadyDecided(result.alreadyDecided);
      setError(null);
      return;
    }
    setError(
      result.detail ??
        intl.formatMessage({
          id: "resolve.failed",
          defaultMessage: "The request could not be resolved. Try again.",
        }),
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage
            id="resolve.title"
            defaultMessage="Resolve {reference}"
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
                  (DES-011). */}
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
            {/* What the act does, and why the box below it is optional:
                a request answered on the thread is honestly done. */}
            <p className="text-sm text-muted">
              <FormattedMessage
                id="resolve.explains"
                defaultMessage="Resolving closes the request as answered. Add a closing reply if the answer is not already on the thread."
              />
            </p>
            <div className="flex flex-col gap-1.5">
              {/* The word rather than Decline's asterisk, and inside the
                  label the way every other optional box in the product
                  says it — "optional" is the fact that changes what
                  somebody does next, so every reader gets it. */}
              <Label htmlFor="resolve-reply">
                <FormattedMessage id="resolve.reply" defaultMessage="Closing reply (optional)" />
              </Label>
              <textarea
                id="resolve-reply"
                value={reply}
                rows={4}
                autoFocus
                className={TEXTAREA_CLASS}
                onChange={(event) => {
                  setReply(event.target.value);
                  setError(null);
                }}
              />
              {/* Which of the two boxes on this page's dialogs this is:
                  a reply goes on the conversation, where the requester
                  can answer it. */}
              <p className="flex items-start gap-1.5 text-xs text-muted">
                <MessageSquare size={16} aria-hidden="true" className="mt-px shrink-0" />
                <FormattedMessage
                  id="resolve.notifyNote"
                  defaultMessage="This goes on the request's thread, and to the requester by email."
                />
              </p>
            </div>
            {error !== null && (
              <p role="alert" className="text-xs text-status-danger-fg">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
              </Button>
              {/* I2's own glyph for Resolve, and the verb in the imperative
                  the house register asks for (DES-015). */}
              <Button type="submit" disabled={busy}>
                <Check size={16} aria-hidden="true" />
                <FormattedMessage id="resolve.submit" defaultMessage="Resolve request" />
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
