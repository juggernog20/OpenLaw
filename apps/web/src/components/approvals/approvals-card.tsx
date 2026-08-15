// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Approvals section of the contract record (M14/3), drawn from the
 * C5 mock's roster: who was asked, where the ask came from, what they
 * decided, what they said about it, and when.
 *
 * **The roster is a set, not a queue** (CTR-012). Every request runs in
 * parallel, so nothing here draws an order of play — the rows are the
 * asks in the order they were made, oldest first, which is what makes a
 * re-request read underneath the rejection it answers rather than
 * beside it.
 *
 * **Rows are auto-derived and nothing here authors an event**
 * (grill-plan H.H4). The section shows `contract_approvals` and nothing
 * else. Envelope rows arrive with M15 and renewal rows with M16, which
 * is why the heading is "Approvals" today rather than the mock's
 * "Approvals & signing": a card named for two things that only holds
 * one of them is a card that reads as broken.
 *
 * **Deciding is a form; cancelling is one click** (DES-017). An
 * approver answers with a decision **and** an optional note, and those
 * two commit together — the compound edit DES-017 carves out of the
 * inline rule — so approve and reject each open a dialog with the note
 * in it. Cancelling collects nothing and destroys nothing that matters:
 * the ask goes, the activity entry keeps it (CTR-012), and asking again
 * is one dialog away.
 *
 * **Controls are absent rather than disabled**, the convention the
 * documents row and the comment row already follow. Only the named
 * approver decides their own request, and only the requester, the
 * Owner, or an Administrator cancels one — everybody else gets no menu
 * at all, because a greyed-out control on somebody else's sign-off is
 * an invitation to ask why.
 *
 * **The picker offers people who can actually be asked.** Member+ only
 * (CTR-012, DD-013), nobody who already has a pending request on this
 * contract, and — on a confidential record — nobody outside its
 * audience. That last rule mirrors the seam's `inNamedAudience` exactly
 * rather than approximating it, for the reason the record's own
 * confidentiality control gives: the API is the authority, and a second
 * rule would drift. The seam refuses either way, by name; this is only
 * what keeps a stale list from being the normal case.
 */

import { useState } from "react";
import { FormattedMessage, useIntl, defineMessage, type IntlShape } from "react-intl";
import { Check, MoreHorizontal, Plus, X } from "lucide-react";
import {
  APPROVAL_PILL,
  cancelContractApproval,
  decideContractApproval,
  requestContractApprovals,
  type ApprovalDecision,
  type ApprovalStatus,
  type ContractApproval,
} from "../../lib/approvals";
import type { ContractTeamMember, UserOption } from "../../lib/contracts";
import type { Role } from "../../lib/roles";
import { formatShortDate } from "../../lib/format";
import { TEXTAREA_CLASS } from "../../lib/form-controls";
import { Avatar } from "../avatar";
import { StatusNote, type FieldStatus } from "../status-note";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Label } from "../ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

/** The seam's own ceiling on a decision note, so the box refuses a
 * longer one rather than the request doing it after the fact. */
const MAX_NOTE_LENGTH = 1000;

/** The roles that may approve a contract (CTR-012, DD-013). Said here
 * so the picker offers nobody the seam would refuse by name. */
const APPROVER_ROLES = new Set(["administrator", "legal_team_member"]);

/** The em dash the roster prints where a pending row has no answer and
 * no date. One string, so the two cells cannot disagree. */
const NOT_YET = defineMessage({ id: "approvals.notYet", defaultMessage: "—" });

const STATUS_LABEL = {
  pending: defineMessage({ id: "approvals.status.pending", defaultMessage: "Pending" }),
  approved: defineMessage({ id: "approvals.status.approved", defaultMessage: "Approved" }),
  rejected: defineMessage({ id: "approvals.status.rejected", defaultMessage: "Rejected" }),
} as const satisfies Record<ApprovalStatus, { id: string; defaultMessage: string }>;

/** The header's tally, one message per state so a zero is left out
 * rather than printed. */
const COUNT_LABEL = {
  approved: defineMessage({ id: "approvals.count.approved", defaultMessage: "{count} approved" }),
  rejected: defineMessage({ id: "approvals.count.rejected", defaultMessage: "{count} rejected" }),
  pending: defineMessage({ id: "approvals.count.pending", defaultMessage: "{count} pending" }),
} as const;

/** One person the picker may offer. */
interface Candidate {
  id: string;
  displayName: string;
  image: string | null;
}

export function ApprovalsCard({
  contractNumber,
  approvals,
  users,
  team,
  viewerId,
  viewerRole,
  ownerId,
  isConfidential,
  frozen,
  onApprovals,
}: Readonly<{
  contractNumber: number;
  approvals: readonly ContractApproval[];
  /** The people the record's pickers read, Member+ and otherwise. */
  users: readonly UserOption[];
  /** The contract's working group (CTR-004) — half of a confidential
   * record's audience, and the Owner is the other half. */
  team: readonly ContractTeamMember[];
  viewerId: string;
  viewerRole: Role;
  ownerId: string | null;
  isConfidential: boolean;
  /** An archived record, or a read-only viewer: no control is drawn. */
  frozen: boolean;
  onApprovals: (approvals: ContractApproval[]) => void;
}>) {
  const intl = useIntl();
  const [status, setStatus] = useState<FieldStatus>("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [deciding, setDeciding] = useState<{
    approval: ContractApproval;
    decision: ApprovalDecision;
  } | null>(null);
  const busy = status === "saving";

  const counts = {
    approved: approvals.filter((row) => row.status === "approved").length,
    rejected: approvals.filter((row) => row.status === "rejected").length,
    pending: approvals.filter((row) => row.status === "pending").length,
  };
  const tally = (["approved", "rejected", "pending"] as const).filter((key) => counts[key] > 0);

  /**
   * Who the "Add approver" dialog offers.
   *
   * Member+, because nobody else can approve anything (CTR-012,
   * DD-013). Nobody with a pending ask already, because the seam
   * refuses a second one. And, on a confidential record, nobody outside
   * the audience — an Administrator, somebody on the team, or the Owner
   * — which is `inNamedAudience` said over the people this page already
   * holds.
   *
   * Archived people are not filtered here, and that is not an omission:
   * the picker read leaves them out at the seam, exactly as the Owner
   * select relies on. A second filter would be a rule with nothing to
   * catch, and a rule with nothing to catch is a rule nobody maintains.
   */
  const pendingApprovers = new Set(
    approvals.filter((row) => row.status === "pending").map((row) => row.approver.id),
  );
  const onTeam = new Set(team.map((member) => member.id));
  const candidates: Candidate[] = users
    .filter((person) => APPROVER_ROLES.has(person.role) && !pendingApprovers.has(person.id))
    .filter(
      (person) =>
        !isConfidential ||
        person.role === "administrator" ||
        onTeam.has(person.id) ||
        person.id === ownerId,
    )
    .map((person) => ({ id: person.id, displayName: person.displayName, image: person.image }));

  /**
   * Every write says saving, then saved or why not, and replaces the
   * roster it is given — because a write moves more rows than the one
   * it was addressed at (DES-017).
   *
   * A refusal is reported **once**. A write raised from a dialog says
   * it in that dialog's own form, where the reader's attention already
   * is; the header keeps the same sentence off screen rather than
   * printing it a second time behind a modal, which would read as two
   * failures. A write with no dialog — the row's cancel — has only the
   * header, so that is where it lands.
   */
  async function run(
    write: () => Promise<
      { ok: true; approvals: ContractApproval[] } | { ok: false; detail?: string }
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
          id: "approvals.writeFailed",
          defaultMessage: "The change could not be saved. Try again.",
        })
      );
    }
    onApprovals(outcome.approvals);
    setStatus("saved");
    setDetail(null);
    return null;
  }

  return (
    <section
      id="contract-approvals"
      aria-labelledby="contract-approvals-heading"
      className="w-full overflow-hidden rounded-card border border-border-default bg-raised"
    >
      <header className="flex h-section-header items-center justify-between gap-2 rounded-t-card border-b border-border-default bg-section-header px-4">
        <div className="flex min-w-0 items-center gap-2">
          <h2 id="contract-approvals-heading" className="text-base font-semibold">
            <FormattedMessage id="approvals.section" defaultMessage="Approvals" />
          </h2>
          {/* The neutral counter badge (grill-plan H.H3), drawn the way
              the Documents section draws its own: a bare number on
              screen, and a whole phrase for a screen reader, because a
              lone "3" after a heading says nothing. */}
          <span
            role="img"
            aria-label={intl.formatMessage(
              {
                id: "approvals.countLabel",
                defaultMessage: "{count, plural, one {# approval} other {# approvals}}",
              },
              { count: approvals.length },
            )}
            className="rounded-chip bg-badge-count-bg px-1.5 py-px text-xs font-medium text-badge-count-fg"
          >
            {intl.formatNumber(approvals.length)}
          </span>
          {/* The mock's toolbar tally — "2 approved · 1 pending". A
              state nobody is in is left out rather than printed as a
              zero, which is what keeps the line short enough to read
              beside the heading. */}
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
            <Button variant="secondary" disabled={busy} onClick={() => setAsking(true)}>
              <Plus size={16} aria-hidden="true" />
              <FormattedMessage id="approvals.add" defaultMessage="Add approver" />
            </Button>
          </div>
        )}
      </header>
      {approvals.length === 0 ? (
        <p className="px-4 py-3 text-base text-muted">
          <FormattedMessage
            id="approvals.empty"
            defaultMessage="No approvals requested on this contract yet."
          />
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-start text-sm font-medium text-muted">
                <th scope="col" className="px-4 py-2 text-start font-medium">
                  <FormattedMessage id="approvals.column.approver" defaultMessage="Approver" />
                </th>
                <th scope="col" className="w-44 px-4 py-2 text-start font-medium">
                  <FormattedMessage id="approvals.column.source" defaultMessage="Source" />
                </th>
                <th scope="col" className="w-32 px-4 py-2 text-start font-medium">
                  <FormattedMessage id="approvals.column.decision" defaultMessage="Decision" />
                </th>
                <th scope="col" className="w-80 px-4 py-2 text-start font-medium">
                  <FormattedMessage id="approvals.column.note" defaultMessage="Note" />
                </th>
                <th scope="col" className="w-28 px-4 py-2 text-start font-medium">
                  <FormattedMessage id="approvals.column.decided" defaultMessage="Decided" />
                </th>
                {!frozen && (
                  <th scope="col" className="w-16 px-4 py-2 text-end font-medium">
                    <span className="sr-only">
                      <FormattedMessage id="approvals.column.actions" defaultMessage="Actions" />
                    </span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {approvals.map((approval) => (
                <ApprovalRow
                  key={approval.id}
                  approval={approval}
                  intl={intl}
                  busy={busy}
                  frozen={frozen}
                  canDecide={approval.status === "pending" && approval.approver.id === viewerId}
                  canCancel={
                    approval.status === "pending" &&
                    (viewerRole === "administrator" ||
                      approval.requestedBy.id === viewerId ||
                      ownerId === viewerId)
                  }
                  onDecide={(decision) => setDeciding({ approval, decision })}
                  onCancel={() => void run(() => cancelContractApproval(approval.id))}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {asking && (
        <AddApproverDialog
          candidates={candidates}
          busy={busy}
          onClose={() => setAsking(false)}
          onConfirm={async (approverIds) => {
            const refusal = await run(
              () => requestContractApprovals(contractNumber, approverIds),
              true,
            );
            if (refusal === null) setAsking(false);
            return refusal;
          }}
        />
      )}
      {deciding && (
        <DecisionDialog
          decision={deciding.decision}
          busy={busy}
          onClose={() => setDeciding(null)}
          onConfirm={async (note) => {
            const refusal = await run(
              () => decideContractApproval(deciding.approval.id, deciding.decision, note),
              true,
            );
            if (refusal === null) setDeciding(null);
            return refusal;
          }}
        />
      )}
    </section>
  );
}

/**
 * One ask, as the C5 mock draws it.
 *
 * The line under the approver's name is **who asked**, where the mock
 * drew a job title. OpenLaw records no job title, and the requester is
 * a datum the roster has to carry — so the drawn anatomy keeps its
 * shape and the secondary line says the thing the record actually knows
 * (DES-035).
 */
function ApprovalRow({
  approval,
  intl,
  busy,
  frozen,
  canDecide,
  canCancel,
  onDecide,
  onCancel,
}: Readonly<{
  approval: ContractApproval;
  intl: IntlShape;
  busy: boolean;
  frozen: boolean;
  canDecide: boolean;
  canCancel: boolean;
  onDecide: (decision: ApprovalDecision) => void;
  onCancel: () => void;
}>) {
  const dash = intl.formatMessage(NOT_YET);
  return (
    <tr className="border-t border-border-muted">
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Avatar
            name={approval.approver.displayName}
            image={approval.approver.image}
            className="size-6"
          />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-base font-medium text-primary">
              {approval.approver.displayName}
            </span>
            <span className="truncate text-xs text-muted">
              <FormattedMessage
                id="approvals.requestedBy"
                defaultMessage="Requested by {name}"
                values={{ name: approval.requestedBy.displayName }}
              />
            </span>
          </div>
        </div>
      </td>
      <td className="px-4 py-2.5 text-sm text-muted">
        {approval.groupName ?? (
          <FormattedMessage id="approvals.source.manual" defaultMessage="Added manually" />
        )}
      </td>
      <td className="px-4 py-2.5">
        <span
          className={`inline-flex rounded-pill px-2 py-0.5 text-xs font-medium ${APPROVAL_PILL[approval.status]}`}
        >
          <FormattedMessage {...STATUS_LABEL[approval.status]} />
        </span>
      </td>
      <td className="px-4 py-2.5 text-sm text-primary">
        {approval.note ?? <span className="text-muted">{dash}</span>}
      </td>
      <td className="px-4 py-2.5 text-sm text-muted">
        {approval.decidedAt ? formatShortDate(approval.decidedAt) : dash}
      </td>
      {!frozen && (
        <td className="px-4 py-2.5 text-end">
          {(canDecide || canCancel) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={busy}
                  aria-label={intl.formatMessage(
                    {
                      id: "approvals.actionsFor",
                      defaultMessage: "Actions for {name}",
                    },
                    { name: approval.approver.displayName },
                  )}
                >
                  <MoreHorizontal size={16} aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canDecide && (
                  <>
                    <DropdownMenuItem onSelect={() => onDecide("approved")}>
                      <Check size={16} aria-hidden="true" />
                      <FormattedMessage id="approvals.approve" defaultMessage="Approve" />
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onDecide("rejected")}>
                      <X size={16} aria-hidden="true" />
                      <FormattedMessage id="approvals.reject" defaultMessage="Reject" />
                    </DropdownMenuItem>
                  </>
                )}
                {canCancel && (
                  <DropdownMenuItem onSelect={onCancel}>
                    <X size={16} aria-hidden="true" />
                    <FormattedMessage id="approvals.cancel" defaultMessage="Cancel request" />
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </td>
      )}
    </tr>
  );
}

/**
 * Who to ask (CTR-012).
 *
 * A multi-select, because asking three people is one act and three
 * requests: they are created together and they run in parallel, so
 * collecting them one at a time would be three dialogs for one
 * decision.
 */
function AddApproverDialog({
  candidates,
  busy,
  onClose,
  onConfirm,
}: Readonly<{
  candidates: readonly Candidate[];
  busy: boolean;
  onClose: () => void;
  /** Answers with the refusal to show, or `null` when the write
   * landed. */
  onConfirm: (approverIds: string[]) => Promise<string | null>;
}>) {
  const intl = useIntl();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string, on: boolean) {
    setPicked((held) => {
      const next = new Set(held);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
    setError(null);
  }

  async function submit() {
    if (busy) return;
    if (picked.size === 0) {
      setError(
        intl.formatMessage({
          id: "approvals.pickSomebody",
          defaultMessage: "Pick at least one approver.",
        }),
      );
      return;
    }
    setError(await onConfirm([...picked]));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage id="approvals.addTitle" defaultMessage="Add approver" />
        </DialogTitle>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-base font-medium">
              <FormattedMessage id="approvals.approvers" defaultMessage="Approvers" />
            </legend>
            {candidates.length === 0 ? (
              <p className="text-sm text-muted">
                <FormattedMessage
                  id="approvals.noCandidates"
                  defaultMessage="Everybody who can approve this contract already has a request open."
                />
              </p>
            ) : (
              <ul className="max-h-56 overflow-y-auto rounded-button border border-border-default">
                {candidates.map((person) => (
                  <li
                    key={person.id}
                    className="flex h-11 items-center gap-3 border-b border-border-muted px-3 last:border-b-0"
                  >
                    <Checkbox
                      id={`approver-${person.id}`}
                      checked={picked.has(person.id)}
                      onCheckedChange={(state) => toggle(person.id, state === true)}
                    />
                    <Label
                      htmlFor={`approver-${person.id}`}
                      className="flex min-w-0 flex-1 items-center gap-2 font-normal"
                    >
                      <Avatar name={person.displayName} image={person.image} className="size-6" />
                      <span className="truncate text-base text-primary">{person.displayName}</span>
                    </Label>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted">
              <FormattedMessage
                id="approvals.approversHelp"
                defaultMessage="Everyone you pick is asked at once. They answer in any order."
              />
            </p>
          </fieldset>
          {error && (
            <p role="alert" className="text-xs text-status-danger-fg">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="submit" disabled={busy || candidates.length === 0}>
              <FormattedMessage id="approvals.request" defaultMessage="Request approvals" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * An approver's answer and the words they want on it (CTR-012).
 *
 * A dialog rather than an inline commit, because the two are one act:
 * the note explains the decision, and DES-017 carves a compound edit
 * out of the inline rule for exactly this. The note is optional, and
 * the dialog says so rather than making the approver find out by
 * pressing the button.
 *
 * The button says what it does — "Approve" or "Reject" — because a
 * generic "Save" on a decision that cannot be taken back is not a verb
 * anybody should press by reflex.
 */
function DecisionDialog({
  decision,
  busy,
  onClose,
  onConfirm,
}: Readonly<{
  decision: ApprovalDecision;
  busy: boolean;
  onClose: () => void;
  onConfirm: (note: string | undefined) => Promise<string | null>;
}>) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setError(await onConfirm(note.trim() || undefined));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          {decision === "approved" ? (
            <FormattedMessage id="approvals.approveTitle" defaultMessage="Approve this contract" />
          ) : (
            <FormattedMessage id="approvals.rejectTitle" defaultMessage="Reject this contract" />
          )}
        </DialogTitle>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <p className="text-sm text-muted">
            <FormattedMessage
              id="approvals.decisionFinal"
              defaultMessage="A decision is final. To change it, ask for a new approval."
            />
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="approval-note">
              <FormattedMessage id="approvals.note" defaultMessage="Note (optional)" />
            </Label>
            <textarea
              id="approval-note"
              value={note}
              rows={3}
              autoFocus
              maxLength={MAX_NOTE_LENGTH}
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
            <Button
              type="submit"
              variant={decision === "approved" ? "primary" : "danger"}
              disabled={busy}
            >
              {decision === "approved" ? (
                <FormattedMessage id="approvals.approve" defaultMessage="Approve" />
              ) : (
                <FormattedMessage id="approvals.reject" defaultMessage="Reject" />
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
