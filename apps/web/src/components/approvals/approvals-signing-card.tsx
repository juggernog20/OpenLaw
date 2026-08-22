// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The "Approvals & signing" section of the contract record (M14/3,
 * M15/2), drawn from the C5 and C12 mocks: who was asked to sign the
 * record off, what they decided — and the paper this record has sent
 * out for signature.
 *
 * **The card takes its two-part name now that it holds both kinds of
 * row** (DES-035 clause 3, DES-036). Until M15 it held approval rows
 * alone and was called "Approvals", because a heading naming two things
 * while showing one reads as broken. Envelope rows are the second kind;
 * confirmed-renewal rows are the third, and they arrived with M16/4.
 *
 * **The renewal history is the third family, and it is drawn last**
 * (M16/4, CTR-006, DES-043). The first two say where the contract is
 * going — who still has to sign it off, and what paper is out — and
 * this one says where it has been. Every row is one
 * `contract.renewal_confirmed` entry read back out of the activity log,
 * because nothing stores a renewal; a record with no confirmed roll
 * draws no block at all rather than an empty line for a history most
 * contracts never have.
 *
 * **Renewing is the card's third act, and it is the whole reason a
 * fourth control is in the head.** A roll writes a renewal row, so the
 * control that raises it sits where those rows land, exactly as the
 * send sits beside the envelopes it makes. The dialog itself lives on
 * the record rather than in this card, because the pending banner
 * raises the same dialog from the page's chrome where every section can
 * reach it — the move `SoftGateDialog` already makes.
 *
 * **The roster is a set, not a queue** (CTR-012). Every request runs in
 * parallel, so nothing here draws an order of play — the rows are the
 * asks in the order they were made, oldest first, which is what makes a
 * re-request read underneath the rejection it answers rather than
 * beside it.
 *
 * **Rows are auto-derived and nothing here authors an event**
 * (grill-plan H.H4). The section shows `contract_approvals` and
 * `contract_envelopes`, and nothing else.
 *
 * **The signing block is drawn only when there is an envelope** (grill
 * row E.5's conditional, applied to the row as well as to the chip). A
 * record signed by hand holds no envelope, and the card then reads
 * exactly as it did before M15: one table, no sub-headings. The
 * sub-headings appear only when both blocks are on screen, for the
 * reason the card's own name waited for its second row family.
 *
 * **Sending is absent, never disabled** (DES-035's absence rule). The
 * control is drawn when this install has a connector, the record has a
 * primary document, and no envelope is out. Any of those missing and
 * there is no control at all: a greyed-out send on an install that
 * cannot sign advertises a feature the deployment does not have, and
 * the manual hand-off is not a lesser path that needs explaining
 * (CTR-013).
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
 *
 * **Applying a group is one more write through the same door** (M14/4,
 * CTR-012). The apply dialog picks one live template and says who it
 * would ask before it asks them, because applying a group asks several
 * people at once and the reader should see the set before it becomes
 * requests. The dialog **describes** the skip rule and refuses nothing
 * itself: whether a group has anybody left to ask is the seam's
 * decision, and printing its sentence is what keeps the rule in one
 * place (DES-035).
 *
 * **A signer is a name and an email, typed** (CTR-013). The people who
 * sign a contract are on the other side of a deal: they have no account
 * here, so there is no picker to offer them from. Every one of them is
 * asked at once — the send dialog collects a list, not an order.
 *
 * **Voiding is the envelope row's one action, and its audience is the
 * cancel's** (M15/4, CTR-013). The person who sent it, the contract's
 * Owner, and an Administrator withdraw a live round; everybody else
 * gets no menu on that row at all, which is the absence rule again. The
 * act opens a dialog because it collects the reason the provider and
 * the row both keep — and because a round already out to signers is not
 * a thing to end by reflex.
 */

import { useRef, useState } from "react";
import { FormattedMessage, useIntl, defineMessage, type IntlShape } from "react-intl";
import {
  Check,
  Download,
  MoreHorizontal,
  Plus,
  RotateCw,
  Send,
  Undo2,
  Users,
  X,
} from "lucide-react";
import {
  MAX_APPROVAL_NOTE_LENGTH,
  MAX_ENVELOPE_REASON_LENGTH,
  MAX_ENVELOPE_SIGNERS,
  MAX_ENVELOPE_SUBJECT_LENGTH,
} from "@openlaw/shared";
import {
  APPROVAL_PILL,
  applyApproverGroup,
  cancelContractApproval,
  decideContractApproval,
  requestContractApprovals,
  type ApprovalDecision,
  type ApprovalStatus,
  type ContractApproval,
} from "../../lib/approvals";
import {
  ENVELOPE_PILL,
  liveEnvelope,
  sendContractEnvelope,
  voidContractEnvelope,
  type ContractEnvelope,
  type EnvelopeSigner,
  type EnvelopeStatus,
  type SendableDocument,
  type SigningOutcome,
  type SigningState,
} from "../../lib/envelopes";
import type { ConfirmedRenewal } from "../../lib/renewals";
import type { ApproverGroupOption, ContractTeamMember, UserOption } from "../../lib/contracts";
import type { Role } from "../../lib/roles";
import { documentDownloadHref } from "../../lib/documents";
import { formatShortDate } from "../../lib/format";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "../../lib/form-controls";
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

const ENVELOPE_STATUS_LABEL = {
  sent: defineMessage({ id: "signing.status.sent", defaultMessage: "Out for signature" }),
  signed: defineMessage({ id: "signing.status.signed", defaultMessage: "Signed" }),
  declined: defineMessage({ id: "signing.status.declined", defaultMessage: "Declined" }),
  voided: defineMessage({ id: "signing.status.voided", defaultMessage: "Voided" }),
} as const satisfies Record<EnvelopeStatus, { id: string; defaultMessage: string }>;

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

export function ApprovalsSigningCard({
  contractNumber,
  approvals,
  signing,
  renewals,
  canRenew,
  onRenew,
  users,
  approverGroups,
  team,
  viewerId,
  viewerRole,
  ownerId,
  isConfidential,
  frozen,
  onApprovals,
  onSigning,
}: Readonly<{
  contractNumber: number;
  approvals: readonly ContractApproval[];
  /** The record's signing state (CTR-013): its envelopes, whether this
   * install has a connector at all, and the primary document a send
   * would offer. All three decide whether the send control is drawn. */
  signing: SigningState;
  /** Every confirmed roll on this record, most recent first (M16/4,
   * CTR-006). Read back out of the activity log — nothing stores a
   * renewal — so an empty list means no roll has been confirmed, which
   * is the standing state of most records. */
  renewals: readonly ConfirmedRenewal[];
  /** Whether this record can roll at all: it auto-renews, it records an
   * expiry, and this viewer may write it. False and the head draws no
   * Renew control — absent, never disabled (DES-035 clause 9). */
  canRenew: boolean;
  /** Opens the Renew dialog. It lives on the record rather than in this
   * card because the pending banner raises the same dialog from the
   * page's chrome, where every section can reach it — the move
   * `SoftGateDialog` already makes. */
  onRenew: () => void;
  /** The people the record's pickers read, Member+ and otherwise. */
  users: readonly UserOption[];
  /** The live approver-group templates (CTR-012). Empty when an
   * Administrator has configured none, and the apply control is then
   * absent rather than opening a dialog that can only say no. */
  approverGroups: readonly ApproverGroupOption[];
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
  onSigning: (signing: SigningState) => void;
}>) {
  const intl = useIntl();
  const [status, setStatus] = useState<FieldStatus>("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [sending, setSending] = useState(false);
  const [applying, setApplying] = useState(false);
  const [voiding, setVoiding] = useState<ContractEnvelope | null>(null);
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
   * Every live person this page holds, by id — what the apply dialog
   * turns a group's member ids into.
   *
   * Unfiltered on purpose. A member outside a confidential record's
   * audience is refused **by the seam, by name**, so the preview has to
   * be able to name them; leaving them out would draw an apply that
   * looks smaller than the one that is about to be refused. Archived
   * people are absent from this list already, which is exactly the
   * member the apply itself skips — so the preview and the seam agree
   * without either of them saying so.
   */
  const peopleById = new Map(users.map((person) => [person.id, person]));

  /**
   * Whether a send is offered at all (DES-035's absence rule, DES-036).
   *
   * Three facts, all of them the seam's: an install with no connector
   * cannot send, a record with no primary document has nothing to send,
   * and a record with an envelope already out is refused a second one.
   * Each of them makes the control **absent** rather than disabled, so
   * the card never advertises an act the seam would refuse — and never
   * has to explain the manual hand-off, which is the whole path on an
   * install that has no connector (CTR-013).
   */
  const live = liveEnvelope(signing.envelopes);
  const canSend =
    !frozen && signing.signingConfigured && signing.primaryDocument !== null && live === null;

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

  /**
   * The same shape for the signing half (CTR-013).
   *
   * It is its own function rather than a generic one over both, because
   * what a write answers with is what tells them apart: an approval
   * write answers the roster, and a send answers the record's whole
   * signing state — the envelopes, whether a connector is configured,
   * and the chain a next send would offer. Collapsing the two would
   * mean a caller unpacking a union at every call site.
   */
  async function runSend(
    write: () => Promise<SigningOutcome>,
    /** What to print when the seam refused without a sentence of its
     * own. It is the caller's, because a send and a void fail at
     * different things and one message could only describe one of
     * them. */
    fallback: string,
  ): Promise<string | null> {
    setStatus("saving");
    setDetail(null);
    const outcome = await write();
    if (!outcome.ok) {
      // Reported in the dialog, where the reader's attention already is
      // (DES-035 clause 12). The header keeps the same sentence off
      // screen rather than printing it a second time behind a modal.
      setStatus("idle");
      setDetail(null);
      return outcome.detail ?? fallback;
    }
    onSigning({
      envelopes: outcome.envelopes,
      signingConfigured: outcome.signingConfigured,
      primaryDocument: outcome.primaryDocument,
    });
    setStatus("saved");
    setDetail(null);
    return null;
  }

  /**
   * Whether more than one row family is on screen. The sub-headings
   * appear only then: a card drawing one kind of row needs no label
   * saying which kind it is, and a heading over the only table on a
   * card would label an absence.
   *
   * The roster is always drawn — as a table or as its empty line — so
   * either of the two conditional families turns the headings on.
   */
  const manyBlocks = signing.envelopes.length > 0 || renewals.length > 0;

  return (
    <section
      id="contract-approvals"
      aria-labelledby="contract-approvals-heading"
      className="w-full overflow-hidden rounded-card border border-border-default bg-raised"
    >
      <header className="flex h-section-header items-center justify-between gap-2 rounded-t-card border-b border-border-default bg-section-header px-4">
        <div className="flex min-w-0 items-center gap-2">
          <h2 id="contract-approvals-heading" className="text-base font-semibold">
            <FormattedMessage id="approvals.sectionSigning" defaultMessage="Approvals & signing" />
          </h2>
          {/* The neutral counter badge (grill-plan H.H3), drawn the way
              the Documents section draws its own: a bare number on
              screen, and a whole phrase for a screen reader, because a
              lone "3" after a heading says nothing.

              It counts the asks, not the sends. The badge sits beside
              the tally, and the tally answers "where does sign-off
              stand" — one question, one number. Where the signature
              stands is answered by the envelope row itself and by the
              chip in the record's sub-bar. */}
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
            {/* Sending comes first, because it is the act the card's
                second half exists for. Absent — never disabled — on an
                install with no connector, on a record with no primary
                document, and while an envelope is already out
                (DES-035's absence rule). */}
            {canSend && (
              <Button variant="secondary" disabled={busy} onClick={() => setSending(true)}>
                <Send size={16} aria-hidden="true" />
                <FormattedMessage id="signing.send" defaultMessage="Send for signature" />
              </Button>
            )}
            {/* The Renew act (M16/4, CTR-007). It lives on this card
                because this is where the rows it writes land, exactly
                as "Send for signature" lives beside the envelope rows
                it makes. Absent — never disabled — on a record that
                cannot roll: a contract that does not auto-renew or
                records no expiry has no term for a roll to advance, and
                a greyed-out control would be an invitation to work out
                why (DES-035 clause 9). The pending banner's own call to
                action opens the same dialog from the page's chrome. */}
            {canRenew && (
              <Button variant="secondary" disabled={busy} onClick={onRenew}>
                <RotateCw size={16} aria-hidden="true" />
                <FormattedMessage id="renewal.renew" defaultMessage="Renew" />
              </Button>
            )}
            {/* The C5 mock's pair, in its order. Absent rather than
                disabled when no Administrator has set a template up:
                a control whose dialog could only say "there are none"
                is not a control. */}
            {approverGroups.length > 0 && (
              <Button variant="secondary" disabled={busy} onClick={() => setApplying(true)}>
                <Users size={16} aria-hidden="true" />
                <FormattedMessage id="approvals.applyGroup" defaultMessage="Apply group" />
              </Button>
            )}
            <Button variant="secondary" disabled={busy} onClick={() => setAsking(true)}>
              <Plus size={16} aria-hidden="true" />
              <FormattedMessage id="approvals.add" defaultMessage="Add approver" />
            </Button>
          </div>
        )}
      </header>
      {/* The signing block, drawn only when this record has sent paper
          out (grill row E.5's conditional). A contract signed by hand
          holds no envelope, and the card then reads exactly as it did
          before M15. */}
      {signing.envelopes.length > 0 && (
        <>
          <h3
            id="contract-signing-heading"
            className="border-b border-border-muted px-4 py-2 text-sm font-medium text-muted"
          >
            <FormattedMessage id="signing.block" defaultMessage="Signing" />
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full" aria-labelledby="contract-signing-heading">
              <thead>
                <tr className="text-start text-sm font-medium text-muted">
                  <th scope="col" className="px-4 py-2 text-start font-medium">
                    <FormattedMessage id="signing.column.signers" defaultMessage="Signers" />
                  </th>
                  <th scope="col" className="w-64 px-4 py-2 text-start font-medium">
                    <FormattedMessage id="signing.column.document" defaultMessage="Document" />
                  </th>
                  <th scope="col" className="w-40 px-4 py-2 text-start font-medium">
                    <FormattedMessage id="signing.column.status" defaultMessage="Status" />
                  </th>
                  <th scope="col" className="w-32 px-4 py-2 text-start font-medium">
                    <FormattedMessage id="signing.column.sent" defaultMessage="Sent" />
                  </th>
                  {/* The ending's own date, the Decided column's shape.
                      A live envelope prints the em dash here, exactly
                      as an undecided approval does. */}
                  <th scope="col" className="w-28 px-4 py-2 text-start font-medium">
                    <FormattedMessage id="signing.column.completed" defaultMessage="Completed" />
                  </th>
                  {!frozen && (
                    <th scope="col" className="w-16 px-4 py-2 text-end font-medium">
                      <span className="sr-only">
                        <FormattedMessage id="signing.column.actions" defaultMessage="Actions" />
                      </span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {signing.envelopes.map((envelope) => (
                  <EnvelopeRow
                    key={envelope.id}
                    envelope={envelope}
                    intl={intl}
                    busy={busy}
                    frozen={frozen}
                    // The approvals-cancellation audience, said over the
                    // facts this page already holds (CTR-013). It is the
                    // seam's rule mirrored, not a second rule: the void
                    // is refused by name either way, and this is only
                    // what keeps the record from drawing a control that
                    // could not be used.
                    canVoid={
                      envelope.status === "sent" &&
                      (viewerRole === "administrator" ||
                        envelope.sentBy.id === viewerId ||
                        ownerId === viewerId)
                    }
                    onVoid={() => setVoiding(envelope)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {/* The C20 mock's webhook note, drawn now that the behaviour
              it describes exists (DES-036 clause 9, DES-037). Only
              while an envelope is out: it answers "do I have to come
              back and update this by hand", which is a question only a
              live row raises. */}
          {live !== null && (
            <p className="px-4 pb-3 text-xs text-muted">
              <FormattedMessage
                id="signing.statusArrives"
                defaultMessage="Signed, declined, and voided status arrives by webhook. The executed file auto-files and the stage advances to Active."
              />
            </p>
          )}
        </>
      )}
      {/* The roster's own sub-heading, drawn whenever the card holds a
          second family — an envelope block above it, a renewal block
          below it, or both. It carries the block above's closing rule
          as well as its own, which is why it takes `border-y` where the
          other two take `border-b`. */}
      {manyBlocks && (
        <h3
          id="contract-approvals-block-heading"
          className="border-y border-border-muted px-4 py-2 text-sm font-medium text-muted"
        >
          <FormattedMessage id="approvals.block" defaultMessage="Approvals" />
        </h3>
      )}
      {approvals.length === 0 ? (
        <p className="px-4 py-3 text-base text-muted">
          <FormattedMessage
            id="approvals.empty"
            defaultMessage="No approvals requested on this contract yet."
          />
        </p>
      ) : (
        <div className="overflow-x-auto">
          {/* Named only when the signing block is above it, because
              that is when the card holds two tables and a reader has
              to be told which one they are in. */}
          <table
            className="w-full"
            aria-labelledby={manyBlocks ? "contract-approvals-block-heading" : undefined}
          >
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
      {/* The record's renewal history (M16/4, CTR-006, grill rows G.R5
          and I.B3), drawn only when a roll has been confirmed. It is
          last because the card's first two families say where the
          contract is going — who still has to sign it off, and what
          paper is out — and this one says where it has been. A record
          with no confirmed roll draws nothing at all rather than an
          empty line: the roster's own empty line already tells the
          reader this card holds nothing, and a second one under it
          would announce the absence of a history most contracts never
          have. */}
      {renewals.length > 0 && (
        <>
          <h3
            id="contract-renewals-heading"
            className="border-y border-border-muted px-4 py-2 text-sm font-medium text-muted"
          >
            <FormattedMessage id="renewal.block" defaultMessage="Renewals" />
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full" aria-labelledby="contract-renewals-heading">
              <thead>
                <tr className="text-start text-sm font-medium text-muted">
                  <th scope="col" className="px-4 py-2 text-start font-medium">
                    <FormattedMessage id="renewal.column.renewal" defaultMessage="Renewal" />
                  </th>
                  <th scope="col" className="w-64 px-4 py-2 text-start font-medium">
                    <FormattedMessage
                      id="renewal.column.confirmedBy"
                      defaultMessage="Confirmed by"
                    />
                  </th>
                  <th scope="col" className="w-28 px-4 py-2 text-start font-medium">
                    <FormattedMessage id="renewal.column.confirmed" defaultMessage="Confirmed" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {renewals.map((renewal) => (
                  <RenewalRow key={renewal.id} renewal={renewal} intl={intl} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {sending && signing.primaryDocument !== null && (
        <SendEnvelopeDialog
          document={signing.primaryDocument}
          busy={busy}
          onClose={() => setSending(false)}
          onConfirm={async (input) => {
            const refusal = await runSend(
              () => sendContractEnvelope(contractNumber, input),
              intl.formatMessage({
                id: "signing.sendFailed",
                defaultMessage: "The envelope could not be sent. Try again.",
              }),
            );
            if (refusal === null) setSending(false);
            return refusal;
          }}
        />
      )}
      {voiding !== null && (
        <VoidEnvelopeDialog
          busy={busy}
          onClose={() => setVoiding(null)}
          onConfirm={async (reason) => {
            const refusal = await runSend(
              () => voidContractEnvelope(voiding.id, reason),
              intl.formatMessage({
                id: "signing.voidFailed",
                defaultMessage: "The envelope could not be voided. Try again.",
              }),
            );
            if (refusal === null) setVoiding(null);
            return refusal;
          }}
        />
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
      {applying && (
        <ApplyGroupDialog
          groups={approverGroups}
          peopleById={peopleById}
          pendingApprovers={pendingApprovers}
          busy={busy}
          onClose={() => setApplying(false)}
          onConfirm={async (groupId) => {
            const refusal = await run(() => applyApproverGroup(contractNumber, groupId), true);
            if (refusal === null) setApplying(false);
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
 * The executed copy on a signed row, or the honest reason it is not
 * there (M15/5, CTR-014, grill row H.C6).
 *
 * Three states, and each one is drawn only where it means something. A
 * copy that landed is a **download**, because "shows the executed file"
 * means a reader can open it. A signed round whose fetch is still
 * running says so, so a reader who refreshes twice knows the record is
 * working rather than broken. A fetch that gave up says that too, and
 * points at the path that still works — CTR-013's manual hand-off,
 * which needs no connector at all.
 *
 * A live, declined, or voided round draws nothing: no executed copy was
 * ever owed, and a line about one would be an answer to a question
 * nobody asked. Nor does a round whose copy landed and was later erased
 * (DOC-010) — the fetch is settled, so "filing" would be a lie, and the
 * lawful erasure of a file is not a failure to report.
 */
function ExecutedFile({ envelope }: Readonly<{ envelope: ContractEnvelope }>) {
  if (envelope.status !== "signed") return null;
  if (envelope.executedCopy !== null) {
    return (
      <a
        href={documentDownloadHref(
          envelope.executedCopy.documentId,
          envelope.executedCopy.versionId,
        )}
        download={envelope.executedCopy.originalFilename}
        className="flex min-w-0 items-center gap-1 rounded-button text-xs text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
      >
        <Download size={16} aria-hidden="true" className="shrink-0" />
        <span className="truncate">
          <FormattedMessage id="signing.executedFile" defaultMessage="Executed copy" />
        </span>
      </a>
    );
  }
  if (envelope.executedFetch === "ready") return null;
  return (
    <span className="text-xs break-words text-muted">
      {envelope.executedFetch === "failed" ? (
        <FormattedMessage
          id="signing.executedFailed"
          defaultMessage="The executed copy could not be filed. Upload it to the record instead."
        />
      ) : (
        <FormattedMessage id="signing.executedFiling" defaultMessage="Filing the executed copy…" />
      )}
    </span>
  );
}

/**
 * One round of signature, as the C20 mock's envelope row draws it —
 * moved into this card, where the spec puts the signers' home (DES-036).
 *
 * Five cells, and each one a fact the seam answers. The signers come
 * first because "who was asked to sign this" is the question the row
 * exists for, and each of them takes the two-line anatomy the Approver
 * cell already uses: the name, and under it the address the invitation
 * went to.
 *
 * The Status cell carries the reason under its pill, and the Completed
 * cell carries the date the envelope ended on (DES-037): both arrive
 * from the provider's own feed, and a live envelope prints the em dash
 * for the second exactly as an undecided approval does.
 *
 * There are no per-signer statuses and no reminder, which the mock
 * draws: the envelope carries one status, and who has signed so far is
 * provider-side detail v1 does not surface (CTR-013).
 */
function EnvelopeRow({
  envelope,
  intl,
  busy,
  frozen,
  canVoid,
  onVoid,
}: Readonly<{
  envelope: ContractEnvelope;
  intl: IntlShape;
  busy: boolean;
  frozen: boolean;
  canVoid: boolean;
  onVoid: () => void;
}>) {
  const dash = intl.formatMessage(NOT_YET);
  return (
    <tr className="border-t border-border-muted">
      <td className="px-4 py-2.5">
        <ul className="flex flex-col gap-1.5">
          {envelope.signers.map((signer, index) => (
            // Keyed by position: the list is read-only, nothing
            // reorders it, and two signers may share one address —
            // the seam refuses that on a new send, but a row written
            // before that rule, or by another adapter, may hold it.
            <li key={index} className="flex min-w-0 flex-col">
              <span className="truncate text-base font-medium text-primary">{signer.name}</span>
              <span className="truncate text-xs text-muted">{signer.email}</span>
            </li>
          ))}
        </ul>
      </td>
      <td className="px-4 py-2.5">
        {/* What went out. Both halves go to an em dash together once
            that version has been erased (DOC-010) — the row still says
            an envelope was sent, which is the fact it is here for. */}
        {envelope.documentTitle === null ? (
          <span className="text-sm text-muted">{dash}</span>
        ) : (
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm text-primary">{envelope.documentTitle}</span>
            {envelope.documentVersionNumber !== null && (
              <span className="truncate text-xs text-muted">
                <FormattedMessage
                  id="signing.version"
                  defaultMessage="Version {number}"
                  values={{ number: envelope.documentVersionNumber }}
                />
              </span>
            )}
          </div>
        )}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex min-w-0 flex-col items-start gap-1">
          <span
            className={`inline-flex rounded-pill px-2 py-0.5 text-xs font-medium ${ENVELOPE_PILL[envelope.status]}`}
          >
            <FormattedMessage {...ENVELOPE_STATUS_LABEL[envelope.status]} />
          </span>
          {/* Why it ended, under the pill that says it did. The seam
              keeps a reason only for a decline or a void, so nothing
              here has to ask which status it belongs to — a reason is
              there or it is not, and the row is silent when it is not
              rather than printing an apology for the provider. */}
          {envelope.reason !== null && (
            <span className="text-xs break-words text-muted">{envelope.reason}</span>
          )}
        </div>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex min-w-0 flex-col">
          <span className="text-sm text-muted">{formatShortDate(envelope.sentAt)}</span>
          <span className="truncate text-xs text-muted">
            <FormattedMessage
              id="signing.sentBy"
              defaultMessage="by {name}"
              values={{ name: envelope.sentBy.displayName }}
            />
          </span>
        </div>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex min-w-0 flex-col items-start gap-1">
          <span className="text-sm text-muted">
            {envelope.completedAt === null ? dash : formatShortDate(envelope.completedAt)}
          </span>
          {/* What the ending produced (grill row H.C6). The signed copy
              is the one file every downstream feature cares about, so
              the row that says the round ended is the row that hands it
              over — and the two states where it is not there yet, or
              never will be, say so rather than leaving a reader waiting
              for a link that is not coming. */}
          <ExecutedFile envelope={envelope} />
        </div>
      </td>
      {!frozen && (
        <td className="px-4 py-2.5 text-end">
          {/* The row's one act, in the menu the card's other rows put
              their acts in (DES-035 clause 9). Absent — never disabled
              — for a round this reader may not withdraw and for one
              that has already ended: a greyed-out "Void envelope" on
              somebody else's send is an invitation to ask why, and the
              answer is not a permissions lesson. */}
          {canVoid && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={busy}
                  aria-label={intl.formatMessage(
                    {
                      id: "signing.actionsFor",
                      defaultMessage: "Actions for the envelope sent on {date}",
                    },
                    { date: formatShortDate(envelope.sentAt) },
                  )}
                >
                  <MoreHorizontal size={16} aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onVoid}>
                  <Undo2 size={16} aria-hidden="true" />
                  <FormattedMessage id="signing.void" defaultMessage="Void envelope" />
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </td>
      )}
    </tr>
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
 * One confirmed roll (M16/4, CTR-006, CTR-007's first vehicle).
 *
 * Three cells, and no action cell at all. **A confirmed roll is a fact,
 * not a thing to change**: nothing undoes an assertion that a term
 * renewed, and the way to correct a date somebody typed wrong is to
 * edit the expiry on the record's own Contract card, which narrates as
 * the edit it is. DES-035 clause 9's rule holds — a control for an act
 * that does not exist is not drawn as a disabled one.
 *
 * The first cell takes the two-line anatomy the Approver and Signers
 * cells already use: the expiry the term now runs to, and under it the
 * date it advanced from. The two dates **are** the roll, and putting
 * the second on the row's own secondary line costs no width on a card
 * that has none to spare (DES-035 clause 5's move).
 */
function RenewalRow({ renewal, intl }: Readonly<{ renewal: ConfirmedRenewal; intl: IntlShape }>) {
  return (
    <tr className="border-t border-border-muted">
      <td className="px-4 py-2.5">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-base font-medium text-primary">
            <FormattedMessage
              id="renewal.row.advancedTo"
              defaultMessage="Term advanced to {date}"
              values={{ date: formatShortDate(renewal.to, { locale: intl.locale }) }}
            />
          </span>
          <span className="truncate text-xs text-muted">
            <FormattedMessage
              id="renewal.row.advancedFrom"
              defaultMessage="From {date}"
              values={{ date: formatShortDate(renewal.from, { locale: intl.locale }) }}
            />
          </span>
        </div>
      </td>
      <td className="px-4 py-2.5">
        {/* Nothing in this build writes a roll with no actor, so the em
            dash here is the answer for a log row that predates a
            person rather than a case anybody reaches. The row still
            reads: a renewal the record cannot attribute is still a
            renewal the record made. */}
        {renewal.confirmedBy === null ? (
          <span className="text-sm text-muted">{intl.formatMessage(NOT_YET)}</span>
        ) : (
          <div className="flex items-center gap-2">
            <Avatar
              name={renewal.confirmedBy.displayName}
              image={renewal.confirmedBy.image}
              className="size-6"
            />
            <span className="truncate text-base text-primary">
              {renewal.confirmedBy.displayName}
            </span>
          </div>
        )}
      </td>
      <td className="px-4 py-2.5 text-sm text-muted">
        {formatShortDate(renewal.confirmedAt, { locale: intl.locale })}
      </td>
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
 * Which template to apply (CTR-012, DES-035).
 *
 * One group, so one select rather than a list of checkboxes: a group is
 * already a set, and picking two of them is two acts through two
 * writes. Under the select the dialog **says who it would ask**, by
 * name — applying a group turns one press into several requests, and a
 * reader should see the set before it becomes rows on the record.
 *
 * The preview mirrors the seam's two silent filters, and nothing else.
 * A member the page holds no live person for is archived and is left
 * out, exactly as the apply leaves them out; a member who already has a
 * request open is counted as skipped, exactly as the apply skips them.
 * Whether what remains is empty — and therefore refused — is the
 * **seam's** call: the dialog states the case and lets the press carry
 * it, so the rule lives in one place and its sentence is printed once
 * (DES-035 clause 12).
 */
function ApplyGroupDialog({
  groups,
  peopleById,
  pendingApprovers,
  busy,
  onClose,
  onConfirm,
}: Readonly<{
  groups: readonly ApproverGroupOption[];
  peopleById: ReadonlyMap<string, UserOption>;
  pendingApprovers: ReadonlySet<string>;
  busy: boolean;
  onClose: () => void;
  /** Answers with the refusal to show, or `null` when the apply
   * landed. */
  onConfirm: (groupId: string) => Promise<string | null>;
}>) {
  const intl = useIntl();
  const [groupId, setGroupId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const picked = groups.find((group) => group.id === groupId) ?? null;
  // The live members of the picked template, split into the people this
  // apply would ask and the ones it would skip.
  const live = (picked?.memberIds ?? []).flatMap((id) => {
    const person = peopleById.get(id);
    return person ? [person] : [];
  });
  const toAsk = live.filter((person) => !pendingApprovers.has(person.id));
  const skipped = live.length - toAsk.length;

  async function submit() {
    if (busy) return;
    if (picked === null) {
      setError(
        intl.formatMessage({
          id: "approvals.pickGroup",
          defaultMessage: "Pick an approver group.",
        }),
      );
      return;
    }
    setError(await onConfirm(picked.id));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage id="approvals.applyGroupTitle" defaultMessage="Apply approver group" />
        </DialogTitle>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="approver-group">
              <FormattedMessage id="approvals.group" defaultMessage="Approver group" />
            </Label>
            <select
              id="approver-group"
              value={groupId}
              autoFocus
              className={CONTROL_CLASS}
              onChange={(event) => {
                setGroupId(event.target.value);
                setError(null);
              }}
            >
              <option value="">
                {intl.formatMessage({
                  id: "approvals.pickGroupOption",
                  defaultMessage: "Pick a group",
                })}
              </option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </div>
          {picked !== null && (
            <div className="flex flex-col gap-1 text-sm">
              {toAsk.length > 0 ? (
                <p className="text-primary">
                  <FormattedMessage
                    id="approvals.groupAsks"
                    defaultMessage="Asks {names}."
                    values={{
                      names: intl.formatList(
                        toAsk.map((person) => person.displayName),
                        { type: "conjunction" },
                      ),
                    }}
                  />
                </p>
              ) : (
                <p className="text-muted">
                  {live.length === 0 ? (
                    <FormattedMessage
                      id="approvals.groupEmpty"
                      defaultMessage="This group has nobody to ask."
                    />
                  ) : (
                    <FormattedMessage
                      id="approvals.groupAllAsked"
                      defaultMessage="Everybody in this group already has a request open."
                    />
                  )}
                </p>
              )}
              {toAsk.length > 0 && skipped > 0 && (
                <p className="text-muted">
                  <FormattedMessage
                    id="approvals.groupSkips"
                    defaultMessage="{count, plural, one {Skips # person who already has a request open.} other {Skips # people who already have a request open.}}"
                    values={{ count: skipped }}
                  />
                </p>
              )}
            </div>
          )}
          {/* The C5 mock's own note about the apply, said where the
              apply happens rather than under the roster it produces. */}
          <p className="text-xs text-muted">
            <FormattedMessage
              id="approvals.groupSnapshot"
              defaultMessage="Applying a group asks the people it names now. A later edit to the group leaves these requests as they are."
            />
          </p>
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
              <FormattedMessage id="approvals.applyGroup" defaultMessage="Apply group" />
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
              maxLength={MAX_APPROVAL_NOTE_LENGTH}
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

/**
 * Why a live round is being withdrawn (CTR-013, M15/4).
 *
 * A dialog rather than a one-click act, which is where this parts
 * company with the roster's cancel: cancelling an ask destroys nothing
 * that matters, while voiding ends a round that is already out with
 * people who are not on this install. The reason is **required**,
 * because the provider records it with the withdrawal and the row draws
 * it under the status pill — a void with no words leaves the record
 * unable to say why the round ended.
 *
 * The confirm is the mock's own verb, and it is the primary button
 * rather than the `danger` one: withdrawing a send is a normal act on
 * the way to a better one, which is the same reading DES-036 clause 5
 * gives the `voided` pill its neutral family for.
 *
 * **The dialog says what the send leads to.** C12's own note —
 * the executed file filing itself and the stage advancing — is drawn
 * now that both are true (M15/5), where the act is taken.
 *
 * The refusal is printed here rather than in the card head, because
 * this is where the reader's attention already is (DES-035 clause 12).
 */
function VoidEnvelopeDialog({
  busy,
  onClose,
  onConfirm,
}: Readonly<{
  busy: boolean;
  onClose: () => void;
  /** Answers with the refusal to show, or `null` when the void
   * landed. */
  onConfirm: (reason: string) => Promise<string | null>;
}>) {
  const intl = useIntl();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** `busy` alone is not a gate: it is state, and state has not
   * re-rendered while the click that set it is still on the stack, so
   * two submits in one tick both find it false. The two dialogs that
   * write to the provider hold the ref `TeamCard` and
   * `CounterpartiesField` hold on the record page. Here the second act
   * would be a second withdrawal of one envelope; in the send dialog it
   * would be a second envelope out for signature. */
  const inFlight = useRef(false);

  async function submit() {
    if (busy || inFlight.current) return;
    const words = reason.trim();
    if (words === "") {
      setError(
        intl.formatMessage({
          id: "signing.needReason",
          defaultMessage: "Say why this envelope is being voided.",
        }),
      );
      return;
    }
    inFlight.current = true;
    setError(
      await onConfirm(words).finally(() => {
        inFlight.current = false;
      }),
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage id="signing.voidTitle" defaultMessage="Void envelope" />
        </DialogTitle>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {/* Said where the act is taken, as every other note on this
              card is (DES-035 clauses 17 and 18). Two facts, and both
              of them the reason somebody hesitates: the signers lose
              the round, and the record is free to send another. */}
          <p className="text-sm text-muted">
            <FormattedMessage
              id="signing.voidExplains"
              defaultMessage="The signers can no longer sign this round. The contract can be sent again straight after."
            />
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="envelope-void-reason">
              <FormattedMessage id="signing.reason" defaultMessage="Reason" />
            </Label>
            <textarea
              id="envelope-void-reason"
              value={reason}
              rows={3}
              autoFocus
              maxLength={MAX_ENVELOPE_REASON_LENGTH}
              className={TEXTAREA_CLASS}
              onChange={(event) => {
                setReason(event.target.value);
                setError(null);
              }}
            />
            <p className="text-xs text-muted">
              <FormattedMessage
                id="signing.reasonHelp"
                defaultMessage="The provider records this with the withdrawal, and the record keeps it on the row."
              />
            </p>
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
              <Undo2 size={16} aria-hidden="true" />
              <FormattedMessage id="signing.void" defaultMessage="Void envelope" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** One signer row in the send dialog, with the key React needs to keep
 * two half-typed rows apart. */
interface DraftSigner extends EnvelopeSigner {
  key: string;
}

/** A fresh, empty signer row. */
function blankSigner(): DraftSigner {
  return { key: crypto.randomUUID(), name: "", email: "" };
}

/**
 * What goes out, and who signs it (CTR-013, DES-036) — the C12 mock's
 * "Send for signature" modal.
 *
 * **The version is picked, and it defaults to the current round.** The
 * chain arrives newest first, so the top option is the draft the team
 * is on and the older rounds are under it. A send is consequential
 * enough to name what it is sending rather than to imply it.
 *
 * **A signer is two text boxes.** The mock draws a list of people with
 * avatars and ordinals, which is a picker over an install's own users
 * — and the people who sign a contract are on the other side of a deal.
 * They have no account here, so there is nothing to pick them from, and
 * the ordinals go with the routing order v1 does not have (CTR-013).
 *
 * **The mock's "Message" block is a Subject field.** The signing seam
 * carries a subject and no body in v1, so a box labelled "Message"
 * would promise a letter the envelope cannot carry. The field collects
 * the one line a signer actually sees. Left blank, the record names
 * itself.
 *
 * **The dialog says what the send leads to.** C12's own note —
 * the executed file filing itself and the stage advancing — is drawn
 * now that both are true (M15/5), where the act is taken.
 *
 * The refusal is printed here rather than in the card head, because
 * this is where the reader's attention already is (DES-035 clause 12).
 */
function SendEnvelopeDialog({
  document,
  busy,
  onClose,
  onConfirm,
}: Readonly<{
  document: SendableDocument;
  busy: boolean;
  onClose: () => void;
  /** Answers with the refusal to show, or `null` when the send
   * landed. */
  onConfirm: (input: {
    documentVersionId: string;
    signers: EnvelopeSigner[];
    subject?: string;
  }) => Promise<string | null>;
}>) {
  const intl = useIntl();
  // The current round is the first one the seam answers, and it is the
  // default for the reason the mock's own dialog implies: the version
  // being negotiated is the version being sent, nearly every time.
  const [versionId, setVersionId] = useState(document.versions[0]?.id ?? "");
  // Each row carries a key of its own. A signer being typed into has
  // no identity yet — two empty rows are indistinguishable — so keying
  // on the array index would make React reuse the wrong input when a
  // middle row is removed.
  const [signers, setSigners] = useState<DraftSigner[]>([blankSigner()]);
  /** Where focus goes when a signer row is removed. The control that
   * was pressed goes with the row, and focus would otherwise fall to
   * the document body (DES-010's restore rule, wired by hand because
   * the row is not a dialog). */
  const addSigner = useRef<HTMLButtonElement>(null);
  const [subject, setSubject] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** The send's own gate, for the reason the void dialog gives: `busy`
   * is state and two submits in one tick both find it false. A send is
   * the worse of the two to lose — the second envelope is a real one,
   * out for signature, that somebody has to go and void by hand. */
  const inFlight = useRef(false);

  function editSigner(key: string, patch: Partial<EnvelopeSigner>) {
    setSigners((held) =>
      held.map((signer) => (signer.key === key ? { ...signer, ...patch } : signer)),
    );
    setError(null);
  }

  async function submit() {
    if (busy || inFlight.current) return;
    const named = signers
      .map((signer) => ({ name: signer.name.trim(), email: signer.email.trim() }))
      .filter((signer) => signer.name !== "" || signer.email !== "");
    if (named.length === 0 || named.some((signer) => signer.name === "" || signer.email === "")) {
      // One sentence for both, because they are one mistake: a signer
      // the envelope could not reach is not a signer.
      setError(
        intl.formatMessage({
          id: "signing.needSigners",
          defaultMessage: "Give every signer a name and an email address.",
        }),
      );
      return;
    }
    inFlight.current = true;
    setError(
      await onConfirm({
        documentVersionId: versionId,
        signers: named,
        ...(subject.trim() ? { subject: subject.trim() } : {}),
      }).finally(() => {
        inFlight.current = false;
      }),
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage id="signing.sendTitle" defaultMessage="Send for signature" />
        </DialogTitle>
        {/* The C12 mock's note, drawn now that the behaviour it
            describes exists (DES-036 clause 9). It says what the act
            does before it is taken, where it is taken — the shape
            DES-038 clause 6 gave the void dialog. The stage is named
            rather than a status label, because a team renames its
            statuses and the stage behind them is fixed (CTR-001). */}
        <p className="mt-2 text-sm text-muted">
          <FormattedMessage
            id="signing.sendNote"
            defaultMessage="When everyone signs, the executed file lands on this contract and the stage advances to Active."
          />
        </p>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="envelope-version">
              <FormattedMessage id="signing.versionLabel" defaultMessage="Version" />
            </Label>
            <select
              id="envelope-version"
              value={versionId}
              autoFocus
              className={CONTROL_CLASS}
              onChange={(event) => {
                setVersionId(event.target.value);
                setError(null);
              }}
            >
              {document.versions.map((version, index) => (
                <option key={version.id} value={version.id}>
                  {index === 0
                    ? intl.formatMessage(
                        {
                          id: "signing.versionCurrent",
                          defaultMessage: "Version {number} — {filename} (current)",
                        },
                        { number: version.versionNumber, filename: version.originalFilename },
                      )
                    : intl.formatMessage(
                        {
                          id: "signing.versionOption",
                          defaultMessage: "Version {number} — {filename}",
                        },
                        { number: version.versionNumber, filename: version.originalFilename },
                      )}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted">
              <FormattedMessage
                id="signing.versionHelp"
                defaultMessage="Only the primary document goes out. Attachments are not sent."
              />
            </p>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-base font-medium">
              <FormattedMessage id="signing.signers" defaultMessage="Signers" />
            </legend>
            {signers.map((signer, index) => (
              <div key={signer.key} className="flex items-center gap-2">
                <input
                  className={CONTROL_CLASS}
                  value={signer.name}
                  aria-label={intl.formatMessage(
                    { id: "signing.signerName", defaultMessage: "Signer {number} name" },
                    { number: index + 1 },
                  )}
                  onChange={(event) => editSigner(signer.key, { name: event.target.value })}
                />
                <input
                  type="email"
                  className={CONTROL_CLASS}
                  value={signer.email}
                  aria-label={intl.formatMessage(
                    { id: "signing.signerEmail", defaultMessage: "Signer {number} email" },
                    { number: index + 1 },
                  )}
                  onChange={(event) => editSigner(signer.key, { email: event.target.value })}
                />
                {/* Absent on the only row, the convention the rest of
                    the record follows: removing the last signer would
                    leave an envelope nobody signs. */}
                {signers.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={intl.formatMessage(
                      { id: "signing.removeSigner", defaultMessage: "Remove signer {number}" },
                      { number: index + 1 },
                    )}
                    onClick={() => {
                      setSigners((held) => held.filter((row) => row.key !== signer.key));
                      setError(null);
                      // After the re-render, not before it: on a full
                      // list the "Add signer" button is not mounted
                      // until this removal brings the count back under
                      // the cap, and focusing synchronously would find
                      // nothing and drop focus on the document body.
                      requestAnimationFrame(() => addSigner.current?.focus());
                    }}
                  >
                    <X size={16} aria-hidden="true" />
                  </Button>
                )}
              </div>
            ))}
            {signers.length < MAX_ENVELOPE_SIGNERS && (
              <div>
                <Button
                  ref={addSigner}
                  type="button"
                  variant="secondary"
                  onClick={() => setSigners((held) => [...held, blankSigner()])}
                >
                  <Plus size={16} aria-hidden="true" />
                  <FormattedMessage id="signing.addSigner" defaultMessage="Add signer" />
                </Button>
              </div>
            )}
            <p className="text-xs text-muted">
              <FormattedMessage
                id="signing.signersHelp"
                defaultMessage="Everyone you name is asked at once. They sign in any order."
              />
            </p>
          </fieldset>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="envelope-subject">
              <FormattedMessage id="signing.subject" defaultMessage="Subject (optional)" />
            </Label>
            <input
              id="envelope-subject"
              className={CONTROL_CLASS}
              value={subject}
              maxLength={MAX_ENVELOPE_SUBJECT_LENGTH}
              onChange={(event) => {
                setSubject(event.target.value);
                setError(null);
              }}
            />
            <p className="text-xs text-muted">
              <FormattedMessage
                id="signing.subjectHelp"
                defaultMessage="Signers see this on the invitation. Left blank, it names this contract."
              />
            </p>
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
            <Button type="submit" disabled={busy || document.versions.length === 0}>
              <Send size={16} aria-hidden="true" />
              <FormattedMessage id="signing.sendEnvelope" defaultMessage="Send envelope" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
