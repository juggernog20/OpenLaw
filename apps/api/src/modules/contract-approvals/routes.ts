// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A contract's approvals (M14/3) — CTR-012's manual sign-off, asked and
 * answered on the record.
 *
 * A Member+ user with reach to a contract asks named colleagues to sign
 * it off; each of them approves or rejects with an optional note; and
 * the requester, the Owner, or an Administrator withdraws an ask that
 * should not have been made. The roster answers all of it in one read,
 * which is what the record's Approvals section draws.
 *
 * **Every request runs in parallel** (CTR-012). There are no chains and
 * no order: three approvers asked together answer in whatever order
 * they get to it, and nothing waits on anything.
 *
 * **An approver is a live Member+ user, and on a confidential contract
 * they must already be inside its audience.** The first half is
 * {@link eligibleApprovers}, the same rule an approver group's member
 * list is held to — a template must never hold somebody the record then
 * refuses. The second half is asked of
 * {@link contractMentionCandidates}, which is the reach rule said over
 * **people** rather than over rows: exactly the set that can open the
 * record. Asking it there rather than restating it here is what keeps
 * "who can be asked" from drifting away from "who can see it", and the
 * refusal is the point of the rule — a request its approver could not
 * open would be an ask nobody could answer.
 *
 * **At most one pending request per approver per contract.** Checked
 * under the contract's row lock and backed by a partial unique index,
 * so two requests racing on one person cannot both land. A **decided**
 * row does not block anything: re-asking after a rejection writes a new
 * row, and the earlier ask stays on the record.
 *
 * **Only the named approver decides their own request, and a decision
 * is final.** There is no un-approve and no re-decide; a request that
 * has been answered is answered. Self-approval is allowed — CTR-012
 * says there is no rule engine to say otherwise.
 *
 * **Cancelling deletes the pending row, and the activity entry is the
 * durable record** (CTR-012, the activity-log-is-source-of-truth
 * precedent). Three actors may: the person who asked, the contract's
 * Owner, and an Administrator. A decided row is never deleted.
 *
 * **Access is inherited and nothing is held here** (DD-014, CTR-021).
 * Every route answers the owning contract's reach question first, with
 * `contractTeamScope` — the same predicate the record, its paper, its
 * comments, and its feed are read through — so a viewer who cannot
 * reach the contract is answered exactly as for a contract that was
 * never created, on the roster and on every write alike. Confidentiality
 * therefore inherits for free: the roster of a walled-off record is
 * invisible to everybody outside its audience, and no rule here had to
 * say so. Reads are the contract read floor, so a Contributor on the
 * team sees who was asked; writes are Member+, and their write grid
 * arrives with M23 (DD-015).
 *
 * **Every act is narrated** (DD-017). Request, approve, reject, and
 * cancel each append one entry on the owning contract at the standing
 * record tier, inside the same transaction as the write — so a failed
 * log write rolls the mutation back rather than leaving an unrecorded
 * change.
 *
 * **Applying an approver group asks its whole membership at once, and
 * the ask is a snapshot** (CTR-012, #234). One row per current
 * unarchived member, each stamped `source = group` with the template it
 * came from, and nothing about the template is read again afterwards:
 * renaming it, editing its members, or archiving it leaves every
 * request it already made exactly as it was. Somebody who already holds
 * a pending request on the record is **skipped** rather than refused —
 * applying a group is one act about a set, and a set that overlaps what
 * has already been asked is normal. A group with nobody left to ask is
 * refused as the no-op it would be. Everything else — Member+, live,
 * and inside a confidential record's audience — is the same rule the
 * manual ask applies, asked by the same code.
 *
 * The soft gate is the next ticket (#235) — nothing here branches on
 * stage.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  APPROVAL_STATUSES,
  approverGroupMembers,
  approverGroups,
  asc,
  contractApprovals,
  contracts,
  eq,
  inArray,
  isNull,
  users,
  type ApprovalStatus,
  type Executor,
} from "@openlaw/db";
import { MAX_APPROVAL_NOTE_LENGTH } from "@openlaw/shared";
import { requireRole, type AuthenticatedUser } from "../../auth/guards.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import { eligibleApprovers, type ApproverRow } from "../../lib/approvers.js";
import {
  contractMentionCandidates,
  contractTeamScope,
  NO_CONTRACT,
  reachedContract,
  type ReachedContract,
} from "../../lib/contract-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";

/** The contract read floor (CTR-021), which is the roster read floor
 * too: a Contributor on the team sees who has been asked to sign the
 * record off. The role alone opens nothing — the reach predicate
 * narrows it to the records they hold a `contract_team` row on. */
const requireApprovalReader = requireRole("administrator", "legal_team_member", "contributor");

/** Asking, deciding, and cancelling are Member+ in M14, as putting
 * paper on a record is. A Contributor reads the roster; their write
 * grid arrives with M23 (DD-015). Deciding is narrowed further by the
 * route itself — only the approver named on a request decides it. */
const requireMember = requireRole("administrator", "legal_team_member");

/**
 * An approval on a contract this viewer cannot reach answers exactly as
 * `NO_CONTRACT` has the record itself answer. Its own id says nothing
 * about which record it belongs to, so refusing it any other way would
 * be the leak the 404 exists to prevent.
 */
const NO_APPROVAL = "No approval request exists with this id.";

/** The sentence every write on a frozen record answers with (CTR-021):
 * an archived contract reads as facts until it is restored, and its
 * sign-off is part of the record rather than a conversation about it. */
const FROZEN = "This contract is archived. Restore it before changing its approvals.";

/** How many approvers one **named** request may list at once. A bound
 * rather than a preference, because the whole set is checked in memory
 * under a row lock; generous rather than tight, because naming a dozen
 * people by hand is a real ask. A group apply carries no second bound —
 * a template's own member ceiling is already the answer, and refusing
 * to apply a group an Administrator was allowed to configure would be a
 * dead end the person applying it cannot clear. */
const MAX_APPROVERS_PER_REQUEST = 50;

const RecordIdSchema = z.string().min(1).max(64);

const PersonSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  image: z.string().nullable(),
});

const ApprovalSchema = z.object({
  id: z.string(),
  /** Who was asked. */
  approver: PersonSchema,
  /** Who asked — the roster names them, so nobody has to hunt the feed. */
  requestedBy: PersonSchema,
  source: z.enum(["manual", "group"]),
  /** The template a group request was snapshotted from, by name as it
   * stands now; NULL on a manual request. */
  groupName: z.string().nullable(),
  status: z.enum(APPROVAL_STATUSES),
  note: z.string().nullable(),
  requestedAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
});

const ApprovalsEnvelope = z.object({ approvals: z.array(ApprovalSchema) });

const NumberParams = z.object({ number: z.coerce.number().int().positive() });
const ApprovalParams = z.object({ approvalId: RecordIdSchema });

export const contractApprovalsRoutes: FastifyPluginAsyncZod = async (app) => {
  /** One approval this viewer reaches, with the state of the record
   * that owns it. */
  interface ReachedApproval {
    id: string;
    contractId: string;
    approverId: string;
    approverName: string;
    requestedBy: string;
    status: ApprovalStatus;
    /** The owning contract's SET-003 soft delete (CTR-021). */
    contractArchivedAt: Date | null;
    /** The owning contract's Owner (CTR-004). */
    contractManagerId: string | null;
  }

  /**
   * One approval this viewer reaches, by its own id, or `null`.
   *
   * The owning contract is joined in and the reach predicate rides
   * beside the id, so an approval on a contract the viewer cannot reach
   * is indistinguishable from one that was never created. `lock` holds
   * the **contract** row — not the approval row — because that is the
   * lock every approval write on a record serializes behind.
   */
  async function reachedApproval(
    db: Executor,
    user: AuthenticatedUser,
    approvalId: string,
    lock = false,
  ): Promise<ReachedApproval | null> {
    const query = db
      .select({
        id: contractApprovals.id,
        contractId: contractApprovals.contractId,
        approverId: contractApprovals.approverId,
        approverName: users.displayName,
        requestedBy: contractApprovals.requestedBy,
        status: contractApprovals.status,
        contractArchivedAt: contracts.archivedAt,
        contractManagerId: contracts.managerId,
      })
      .from(contractApprovals)
      .innerJoin(contracts, eq(contractApprovals.contractId, contracts.id))
      .innerJoin(users, eq(contractApprovals.approverId, users.id))
      .where(and(eq(contractApprovals.id, approvalId), contractTeamScope(db, user)))
      .limit(1);
    const [row] = await (lock ? query.for("update", { of: contracts }) : query);
    return row ?? null;
  }

  /**
   * One contract's whole roster, oldest ask first.
   *
   * Oldest first because the roster is a history of asks as much as a
   * state: a re-request after a rejection writes a new row, and reading
   * it under the rejection it answers is what makes the story legible.
   * The id breaks a tie between two rows written in the same
   * transaction, so the order is total.
   */
  async function rosterOf(db: Executor, contractId: string) {
    const rows = await db
      .select({
        id: contractApprovals.id,
        approverId: contractApprovals.approverId,
        approverName: users.displayName,
        approverImage: users.image,
        requestedById: contractApprovals.requestedBy,
        source: contractApprovals.source,
        groupName: approverGroups.name,
        status: contractApprovals.status,
        note: contractApprovals.note,
        createdAt: contractApprovals.createdAt,
        decidedAt: contractApprovals.decidedAt,
      })
      .from(contractApprovals)
      .innerJoin(users, eq(contractApprovals.approverId, users.id))
      // The group is optional: a manual request has none, and a left
      // join is what keeps it on the roster rather than off it.
      .leftJoin(approverGroups, eq(contractApprovals.groupId, approverGroups.id))
      .where(eq(contractApprovals.contractId, contractId))
      .orderBy(asc(contractApprovals.createdAt), asc(contractApprovals.id));

    // The requesters, read in one go rather than joined a second time
    // onto the same table: the set is a handful of people, and a second
    // self-join buys nothing at this size.
    const requesterIds = [...new Set(rows.map((row) => row.requestedById))];
    const people = new Map<string, { id: string; displayName: string; image: string | null }>();
    if (requesterIds.length > 0) {
      const found = await db
        .select({ id: users.id, displayName: users.displayName, image: users.image })
        .from(users)
        .where(inArray(users.id, requesterIds));
      for (const person of found) people.set(person.id, person);
    }

    return {
      approvals: rows.map((row) => ({
        id: row.id,
        approver: {
          id: row.approverId,
          displayName: row.approverName,
          image: row.approverImage,
        },
        // The FK is not null and users are archived rather than deleted
        // (SET-005), so the row is always there; the fallback keeps the
        // roster drawable rather than throwing if it ever is not.
        requestedBy: people.get(row.requestedById) ?? {
          id: row.requestedById,
          displayName: row.requestedById,
          image: null,
        },
        source: row.source,
        groupName: row.groupName,
        status: row.status,
        note: row.note,
        requestedAt: row.createdAt.toISOString(),
        decidedAt: row.decidedAt?.toISOString() ?? null,
      })),
    };
  }

  /**
   * The two refusals every approval write shares, in the order they
   * have to be asked in.
   *
   * Reach first: a 409 on a record the writer cannot reach would tell
   * them it is there. Then the freeze.
   *
   * Generic so that a locked read keeps its `LockedContract` brand
   * across the assertion: narrowing to the base type here would throw
   * away the proof the caller just paid for.
   */
  function assertOpen<T extends ReachedContract>(contract: T | null): asserts contract is T {
    if (!contract) throw httpError(404, NO_CONTRACT);
    if (contract.archivedAt) throw httpError(409, FROZEN);
  }

  /**
   * The record's own audience, asked over the people about to be asked
   * (DD-014).
   *
   * The reach rule said over **people** rather than over rows, so what
   * may be asked here can never disagree with what the record itself
   * would answer. Shared by the manual ask and the group apply, because
   * a group-sourced request is a request: a walled-off record refuses an
   * outsider whichever door the ask came through.
   */
  async function assertInAudience(
    tx: Executor,
    contractId: string,
    approvers: readonly ApproverRow[],
  ): Promise<void> {
    const reachable = new Set(
      (
        await contractMentionCandidates(
          tx,
          contractId,
          approvers.map((person) => person.id),
        )
      ).map((person) => person.id),
    );
    for (const approver of approvers) {
      if (!reachable.has(approver.id)) {
        throw httpError(
          422,
          `${approver.displayName} can't see this contract, so they can't be asked to approve it.`,
        );
      }
    }
  }

  /** Who already holds a pending ask on this record. Read under the
   * contract's row lock, which is what makes it a decision rather than a
   * guess: the manual ask refuses these people, and the group apply
   * skips them. */
  async function pendingApproverIds(tx: Executor, contractId: string): Promise<Set<string>> {
    const rows = await tx
      .select({ approverId: contractApprovals.approverId })
      .from(contractApprovals)
      .where(
        and(eq(contractApprovals.contractId, contractId), eq(contractApprovals.status, "pending")),
      );
    return new Set(rows.map((row) => row.approverId));
  }

  /** Where a set of requests came from (CTR-012): a person picking names
   * by hand, or a template being applied. */
  type RequestOrigin =
    { source: "manual" } | { source: "group"; group: { id: string; name: string } };

  /**
   * Writes one pending request per person named, and narrates one entry
   * per person (DD-017).
   *
   * One entry per person asked, not one per act: being asked to sign a
   * contract off is a fact about that person, and a reader of the feed
   * has to be able to see who was asked without opening a payload of
   * names. A group apply says which template it came from in the same
   * entry, so the feed reads "asked X, from the Commercial sign-off
   * group" rather than making the reader join it up.
   */
  async function createRequests(
    tx: Executor,
    contractId: string,
    actorId: string,
    approvers: readonly ApproverRow[],
    origin: RequestOrigin,
  ): Promise<void> {
    const groupId = origin.source === "group" ? origin.group.id : null;
    const created = await tx
      .insert(contractApprovals)
      .values(
        approvers.map((approver) => ({
          contractId,
          approverId: approver.id,
          source: origin.source,
          groupId,
          requestedBy: actorId,
        })),
      )
      .returning({ id: contractApprovals.id, approverId: contractApprovals.approverId });
    const idByApprover = new Map(created.map((row) => [row.approverId, row.id]));

    await recordActivity(
      tx,
      approvers.map((approver) => ({
        entityType: "contract" as const,
        entityId: contractId,
        actorId,
        action: "approval.requested" as const,
        visibility: RECORD_ACTIVITY_TIER,
        payload: {
          approvalId: idByApprover.get(approver.id) ?? null,
          approverId: approver.id,
          approverName: approver.displayName,
          source: origin.source,
          ...(origin.source === "group"
            ? { groupId: origin.group.id, groupName: origin.group.name }
            : {}),
        },
      })),
    );
  }

  app.get(
    "/contracts/:number/approvals",
    {
      preHandler: requireApprovalReader,
      schema: {
        operationId: "listContractApprovals",
        summary:
          "The approval requests on one contract, oldest ask first " +
          "(CTR-012) — who was asked, who asked them, where the request " +
          "came from, the decision, the approver's note, and when it " +
          "landed. Requests run in parallel, so the roster is a set " +
          "rather than a queue, and a re-request after a rejection is a " +
          "new row beneath the one it answers rather than an overwrite " +
          "of it. Access is inherited from the contract and nothing " +
          "else: a Contributor on the team reads the roster, and anyone " +
          "who cannot reach the contract — a Contributor who is not on " +
          "it, a Legal Team Member outside a confidential record's " +
          "audience — is answered 404, exactly as for a contract that " +
          "does not exist. An archived contract still reads: archiving " +
          "freezes a record, it does not hide it",
        tags: ["approvals"],
        params: NumberParams,
        response: { 200: ApprovalsEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const contract = await reachedContract(app.db, request.user, request.params.number);
      if (!contract) throw httpError(404, NO_CONTRACT);
      return await rosterOf(app.db, contract.id);
    },
  );

  app.post(
    "/contracts/:number/approvals",
    {
      preHandler: requireMember,
      schema: {
        operationId: "requestContractApprovals",
        summary:
          "Ask one or more named colleagues to sign a contract off " +
          "(CTR-012). Every request is created at once and every one of " +
          "them runs in parallel — there are no chains and no order. An " +
          "approver must be a live Member+ user: a Contributor, a " +
          "Business User, and an archived person are each refused by " +
          "name, because a request nobody can act on is worse than no " +
          "request. On a confidential contract the approver must " +
          "already be inside the record's audience, so no request is " +
          "created that its approver could not open. At most one " +
          "pending request per approver per contract — a second is " +
          "refused rather than silently collapsed — but a decided one " +
          "blocks nothing, so a re-request after a rejection writes a " +
          "new row and the earlier ask stays on the record. Every " +
          "request made here carries source manual; applying an " +
          "approver group is its own act. Appends one " +
          "approval.requested entry per approver on the owning contract " +
          "at the working-team tier (DD-017). Member+: a Contributor " +
          "who reaches the record is refused 403 rather than 404, " +
          "because they can already see it. An archived contract takes " +
          "no new request until it is restored",
        tags: ["approvals"],
        params: NumberParams,
        body: z.object({
          approverIds: z.array(RecordIdSchema).min(1).max(MAX_APPROVERS_PER_REQUEST),
        }),
        response: { 201: ApprovalsEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      // Duplicates in one body are one ask, collapsed before anything
      // is read: naming somebody twice is a client that built the list
      // badly, not two requests.
      const approverIds = [...new Set(request.body.approverIds)];

      const roster = await app.db.transaction(async (tx) => {
        const contract = await reachedContract(tx, request.user, request.params.number, {
          lock: true,
        });
        assertOpen(contract);

        // The standing rule first — live Member+ — so somebody who
        // could never approve anything is told that rather than being
        // told they are outside an audience.
        const approvers = await eligibleApprovers(
          tx,
          approverIds,
          (displayName) => `${displayName} is archived and can't be asked to approve.`,
        );

        // Then the record's own audience (DD-014).
        await assertInAudience(tx, contract.id, approvers);

        // One pending ask per person, decided under the lock above. The
        // partial unique index stands behind this as the database's own
        // last word; this is what turns a constraint violation into a
        // sentence the caller can act on.
        //
        // A named ask is **refused** where a group apply skips: naming
        // somebody by hand says the caller believes they have not been
        // asked, and swallowing that would leave them believing it.
        const alreadyAsked = await pendingApproverIds(tx, contract.id);
        for (const approver of approvers) {
          if (alreadyAsked.has(approver.id)) {
            throw httpError(
              409,
              `${approver.displayName} already has a pending approval request on this contract.`,
            );
          }
        }

        await createRequests(tx, contract.id, request.user.id, approvers, { source: "manual" });

        return rosterOf(tx, contract.id);
      });
      return reply.status(201).send(roster);
    },
  );

  app.post(
    "/contracts/:number/approvals/group",
    {
      preHandler: requireMember,
      schema: {
        operationId: "applyApproverGroup",
        summary:
          "Apply an approver group to a contract (CTR-012): every " +
          "current member of the template is asked to sign the record " +
          "off, in one act and in parallel. The ask is a **snapshot** — " +
          "each request records the group it came from, and renaming " +
          "the template, editing its members, or archiving it never " +
          "touches a request that already exists. A member who already " +
          "holds a pending request on this contract is skipped rather " +
          "than refused, because applying a group is one act about a " +
          "set. An archived member is skipped too: they have left, so " +
          "the ask would reach nobody. A group with nobody left to ask " +
          "— no members, or every member already asked — is refused as " +
          "the no-op it would be, and an archived group is refused " +
          "because it has left the picker. Every other rule is the " +
          "named ask's, applied by the same code: a member who is no " +
          "longer Member+ is refused by name, and on a confidential " +
          "contract a member outside the record's audience is refused " +
          "by name too. Appends one approval.requested entry per person " +
          "asked, naming the group, at the working-team tier (DD-017). " +
          "Member+; an archived contract takes no request until it is " +
          "restored",
        tags: ["approvals"],
        params: NumberParams,
        body: z.object({ groupId: RecordIdSchema }),
        response: { 201: ApprovalsEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const roster = await app.db.transaction(async (tx) => {
        const contract = await reachedContract(tx, request.user, request.params.number, {
          lock: true,
        });
        assertOpen(contract);

        const [group] = await tx
          .select({
            id: approverGroups.id,
            name: approverGroups.name,
            archivedAt: approverGroups.archivedAt,
          })
          .from(approverGroups)
          .where(eq(approverGroups.id, request.body.groupId))
          .limit(1);
        if (!group) throw httpError(404, "No approver group exists with this id.");
        // An archived template has left the apply picker (SET-003), so
        // a call naming one is a client holding a stale list.
        if (group.archivedAt) {
          throw httpError(409, `${group.name} is archived, so it can't be applied.`);
        }

        // The snapshot's raw material: the template's members as they
        // stand right now. Archived people are left out here rather
        // than refused — they have left (SET-005), and a template that
        // outlives somebody should still be appliable by the person who
        // did not archive them.
        const members = await tx
          .select({ id: users.id })
          .from(approverGroupMembers)
          .innerJoin(users, eq(users.id, approverGroupMembers.userId))
          .where(and(eq(approverGroupMembers.groupId, group.id), isNull(users.archivedAt)))
          .orderBy(asc(users.displayName), asc(users.id));

        // Then the people this record has already asked, who are
        // skipped. Both filters run before any refusal is raised, so a
        // group is never refused on account of somebody it would not
        // have asked anyway.
        const alreadyAsked = await pendingApproverIds(tx, contract.id);
        const wanted = members.map((row) => row.id).filter((id) => !alreadyAsked.has(id));
        if (wanted.length === 0) {
          throw httpError(
            422,
            members.length === 0
              ? `${group.name} has no members to ask.`
              : `Everybody in ${group.name} already has a pending approval request on this contract.`,
          );
        }

        // What is left is asked exactly as a named ask is: Member+ and
        // live, then inside a confidential record's audience. A member
        // who has since lost their standing is refused by name rather
        // than dropped — the record must not quietly ask fewer people
        // than the template says.
        const approvers = await eligibleApprovers(
          tx,
          wanted,
          (displayName) => `${displayName} is archived and can't be asked to approve.`,
        );
        await assertInAudience(tx, contract.id, approvers);

        await createRequests(tx, contract.id, request.user.id, approvers, {
          source: "group",
          group: { id: group.id, name: group.name },
        });

        return rosterOf(tx, contract.id);
      });
      return reply.status(201).send(roster);
    },
  );

  app.post(
    "/approvals/:approvalId/decision",
    {
      preHandler: requireMember,
      schema: {
        operationId: "decideContractApproval",
        summary:
          "Approve or reject one request, with an optional note " +
          "(CTR-012). Only the approver named on the request decides it " +
          "— not the requester, not the Owner, and not an " +
          "Administrator, because a sign-off somebody else recorded is " +
          "not a sign-off. The decision is final: a request that has " +
          "been answered is answered, and a fixed draft goes back to " +
          "the same person as a new request rather than by reopening " +
          "this one. Self-approval is allowed. Appends " +
          "approval.approved or approval.rejected on the owning " +
          "contract at the working-team tier (DD-017). A request on a " +
          "contract this viewer cannot reach answers 404, exactly as " +
          "for one that does not exist; an archived contract takes no " +
          "decision until it is restored",
        tags: ["approvals"],
        params: ApprovalParams,
        body: z.object({
          decision: z.enum(["approved", "rejected"]),
          note: z.string().trim().max(MAX_APPROVAL_NOTE_LENGTH).optional(),
        }),
        response: { 200: ApprovalsEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const decision = request.body.decision;
      const note = request.body.note?.trim() || null;

      return await app.db.transaction(async (tx) => {
        const approval = await reachedApproval(tx, request.user, request.params.approvalId, true);
        if (!approval) throw httpError(404, NO_APPROVAL);
        if (approval.contractArchivedAt) throw httpError(409, FROZEN);
        // A plain 403, not a 404: this viewer can already read the
        // roster, so telling them the request is there tells them
        // nothing, and a 404 would make a real boundary read as a bug.
        if (approval.approverId !== request.user.id) {
          throw httpError(403, "Only the approver named on this request can decide it.");
        }
        if (approval.status !== "pending") {
          throw httpError(
            409,
            "This approval request has already been decided. Ask for a new one instead.",
          );
        }

        await tx
          .update(contractApprovals)
          .set({ status: decision, note, decidedAt: new Date() })
          .where(eq(contractApprovals.id, approval.id));

        await recordActivity(tx, {
          entityType: "contract",
          entityId: approval.contractId,
          actorId: request.user.id,
          action: decision === "approved" ? "approval.approved" : "approval.rejected",
          visibility: RECORD_ACTIVITY_TIER,
          // Whether a note was given, never the note itself: DD-017
          // forbids UPDATE and DELETE on the log, and the note lives on
          // a row that a cancellation may take away.
          payload: {
            approvalId: approval.id,
            approverId: approval.approverId,
            approverName: approval.approverName,
            hasNote: note !== null,
          },
        });

        return rosterOf(tx, approval.contractId);
      });
    },
  );

  app.delete(
    "/approvals/:approvalId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "cancelContractApproval",
        summary:
          "Withdraw a pending approval request (CTR-012). Three actors " +
          "may: the person who asked, the contract's Owner, and an " +
          "Administrator — a mistaken or obsolete ask should not sit " +
          "open, and stale requests should not outlive the people or " +
          "deals they were about. The row is deleted and the " +
          "approval.cancelled activity entry is the durable record of " +
          "it, which is why that entry names the approver. A decided " +
          "request is never cancelled: it is part of the record. A " +
          "request on a contract this viewer cannot reach answers 404, " +
          "exactly as for one that does not exist; an archived contract " +
          "takes no cancellation until it is restored",
        tags: ["approvals"],
        params: ApprovalParams,
        response: { 200: ApprovalsEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      return await app.db.transaction(async (tx) => {
        const approval = await reachedApproval(tx, request.user, request.params.approvalId, true);
        if (!approval) throw httpError(404, NO_APPROVAL);
        if (approval.contractArchivedAt) throw httpError(409, FROZEN);

        const mayCancel =
          request.user.role === "administrator" ||
          approval.requestedBy === request.user.id ||
          approval.contractManagerId === request.user.id;
        // A 403 for the same reason the decision route gives one: the
        // viewer can already read the roster.
        if (!mayCancel) {
          throw httpError(
            403,
            "Only the person who asked, the contract's Owner, or an Administrator " +
              "can cancel this request.",
          );
        }
        if (approval.status !== "pending") {
          throw httpError(409, "This approval request has been decided. It cannot be cancelled.");
        }

        await tx.delete(contractApprovals).where(eq(contractApprovals.id, approval.id));

        // The row is gone, so this entry is the only thing left that
        // says the ask was ever made — which is why it carries the
        // approver's name and not only their id.
        await recordActivity(tx, {
          entityType: "contract",
          entityId: approval.contractId,
          actorId: request.user.id,
          action: "approval.cancelled",
          visibility: RECORD_ACTIVITY_TIER,
          payload: {
            approvalId: approval.id,
            approverId: approval.approverId,
            approverName: approval.approverName,
          },
        });

        return rosterOf(tx, approval.contractId);
      });
    },
  );
};
