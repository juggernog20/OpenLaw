// SPDX-License-Identifier: AGPL-3.0-only

/** Resolving requires a note, posted to the requester-visible thread with the closure. */

import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Check, MessageSquare } from "lucide-react";
import { MAX_COMMENT_BODY_LENGTH, type RequestOutcome } from "@openlaw/shared";
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
  | { ok: true }
  | { ok: false; alreadyDecided: RequestOutcome }
  | { ok: false; alreadyDecided?: undefined; detail?: string };

export function ResolveDialog({
  reference,
  busy,
  onClose,
  onResolve,
}: Readonly<{
  reference: string;
  busy: boolean;
  onClose: () => void;
  onResolve: (reply: string) => Promise<ResolveResult>;
}>) {
  const intl = useIntl();
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** The decision somebody else recorded first, once the seam has said
   * so. Set, the dialog stops being a form and becomes a statement. */
  const [alreadyDecided, setAlreadyDecided] = useState<RequestOutcome | null>(null);

  async function submit() {
    if (busy) return;
    const trimmed = reply.trim();
    if (!trimmed) {
      setError(
        intl.formatMessage({
          id: "resolve.noteRequired",
          defaultMessage: "Explain why this request is being resolved without converting.",
        }),
      );
      document.getElementById("resolve-reply")?.focus();
      return;
    }
    const result = await onResolve(trimmed);
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
            defaultMessage="Resolve {reference} without converting"
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
                id="disposition.alreadyDecided"
                defaultMessage="{outcome, select, converted {Somebody else already converted this request.} resolved {Somebody else already resolved this request.} declined {Somebody else already declined this request.} other {Somebody else already decided this request.}}"
                values={{ outcome: alreadyDecided }}
              />
            </p>
            <p className="text-sm text-muted">
              <FormattedMessage
                id="disposition.alreadyDecidedRead"
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
            <p className="text-sm text-muted">
              <FormattedMessage
                id="resolve.explains"
                defaultMessage="Explain why this request can be closed without creating a contract or matter."
              />
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="resolve-reply">
                <FormattedMessage id="resolve.reply" defaultMessage="Resolution note (required)" />
              </Label>
              <textarea
                id="resolve-reply"
                aria-required="true"
                aria-invalid={error !== null && !reply.trim() ? true : undefined}
                aria-describedby={
                  error !== null ? "resolve-error resolve-note-help" : "resolve-note-help"
                }
                value={reply}
                rows={4}
                autoFocus
                // The seam's own bound on a comment body, restated on the
                // box (DES-058 normalization point 2's rule). Without it
                // the dialog takes a reply the resolve route refuses,
                // and the writer learns it only after pressing.
                maxLength={MAX_COMMENT_BODY_LENGTH}
                className={TEXTAREA_CLASS}
                onChange={(event) => {
                  setReply(event.target.value);
                  setError(null);
                }}
              />
              {/* Which of the two boxes on this page's dialogs this is:
                  a reply goes on the conversation, where the requester
                  can answer it. */}
              <p id="resolve-note-help" className="flex items-start gap-1.5 text-xs text-muted">
                <MessageSquare size={16} aria-hidden="true" className="mt-px shrink-0" />
                <FormattedMessage
                  id="resolve.notifyNote"
                  defaultMessage="This goes on the request's thread, and to the requester by email."
                />
              </p>
            </div>
            {error !== null && (
              <p id="resolve-error" role="alert" className="text-xs text-status-danger-fg">
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
