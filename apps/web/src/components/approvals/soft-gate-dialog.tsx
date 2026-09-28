// SPDX-License-Identifier: AGPL-3.0-only

/** CTR-012's soft gate dialog, shared by the Status picker and the send
 * for signature. */

import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { APPROVAL_PILL, type ContractApproval } from "../../lib/approvals";
import { Avatar } from "../avatar";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";

/**
 * CTR-012's soft gate, raised by the seam's refusal (#235).
 *
 * The record is on its way past the approval stage while somebody's
 * sign-off is still open. That is allowed — CTR-001 restricts no
 * transition and CTR-012 chose a warning over a lock, because in a
 * 2–10 person team the person holding the policy and the person
 * overriding it are often the same human. So this costs one deliberate
 * press, and the press is what the activity feed records.
 *
 * **It names the people, and says what each of them said.** "Approvals
 * are open" is not something anybody can act on; "Sarah Chen is
 * pending, Marcus Webb rejected" is. The state rides in the same
 * DES-005 pill the Approvals roster draws it in, so the dialog and the
 * section behind it say the same thing in the same colour.
 *
 * **It states nothing the seam did not say.** Whether the move crosses
 * the line, and whether anything is unresolved, is the seam's decision
 * and its refusal is what opened this — the same one-rule-one-place
 * shape the apply dialog takes (DES-035 clause 16). What is drawn here
 * is the record's own roster, filtered to the asks an approval has not
 * answered.
 *
 * Two acts raise it: a Status change on the record, and a send for
 * signature, which moves the Contract to its Signature Stage (#1207).
 */
export function SoftGateDialog({
  statusName,
  unresolved,
  onOpenChange,
  onConfirm,
}: Readonly<{
  /** The Status the move goes to. A send for signature names the
   * first live Signature status, because that is where the send moves
   * the Contract. */
  statusName: string;
  unresolved: readonly ContractApproval[];
  onOpenChange: (open: boolean) => void;
  /** Answers `undefined` when the override landed, and the seam's own
   * refusal — or an empty string when it gave none — when it did not. */
  onConfirm: () => Promise<string | undefined>;
}>) {
  const intl = useIntl();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setError(null);
    setBusy(true);
    const refusal = await onConfirm().finally(() => setBusy(false));
    if (refusal !== undefined) {
      setError(
        refusal ||
          intl.formatMessage({
            id: "contracts.softGate.error",
            defaultMessage: "The status could not be changed.",
          }),
      );
    }
  }

  /** A dismissal is ignored while the override is in flight: the
   * commit either lands or is refused, and a dialog that vanished
   * mid-write would leave the reader with neither answer. */
  function close(open: boolean) {
    if (!open && busy) return;
    onOpenChange(open);
  }

  return (
    <Dialog open onOpenChange={close}>
      <DialogContent aria-describedby="contract-soft-gate-note">
        <DialogTitle>
          <FormattedMessage id="contracts.softGate.title" defaultMessage="Move past approval" />
        </DialogTitle>
        <p id="contract-soft-gate-note" className="mt-2 text-base text-muted">
          <FormattedMessage
            id="contracts.softGate.note"
            defaultMessage="{count, plural, one {# approval on this contract is unresolved.} other {# approvals on this contract are unresolved.}} Moving to {status} goes past sign-off."
            values={{ count: unresolved.length, status: statusName }}
          />
        </p>
        <ul className="mt-4 flex flex-col gap-2">
          {unresolved.map((approval) => (
            <li key={approval.id} className="flex items-center gap-2">
              <Avatar
                name={approval.approver.displayName}
                image={approval.approver.image}
                className="size-6"
              />
              <span className="text-base text-primary">{approval.approver.displayName}</span>
              <span
                className={`inline-flex rounded-pill px-2 py-0.5 text-xs font-medium ${APPROVAL_PILL[approval.status]}`}
              >
                {approval.status === "rejected" ? (
                  <FormattedMessage id="approvals.status.rejected" defaultMessage="Rejected" />
                ) : (
                  <FormattedMessage id="approvals.status.pending" defaultMessage="Pending" />
                )}
              </span>
            </li>
          ))}
        </ul>
        {/* The C5 mock's soft-gate note row, said where the act is taken
        rather than under the roster (DES-035 clauses 17 and 18). */}
        <p className="mt-4 text-xs text-muted">
          <FormattedMessage
            id="contracts.softGate.override"
            defaultMessage="This is allowed. It is recorded on the record's activity as an override."
          />
        </p>
        {error && (
          <p role="alert" className="mt-4 text-xs text-status-danger-fg">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={() => close(false)}>
            <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
          </Button>
          <Button type="button" disabled={busy} onClick={() => void submit()}>
            <FormattedMessage id="contracts.softGate.submit" defaultMessage="Move anyway" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
