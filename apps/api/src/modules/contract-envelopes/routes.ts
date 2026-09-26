// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A contract's signing envelopes (M15/2) — CTR-013's send, made on the
 * record instead of on another company's website — and, from #1171, the
 * durable preparation that later slices open in the provider's editor.
 *
 * A Member+ user with reach to a contract picks a version of its
 * **primary document**, names the people who have to sign it, and either
 * sends it through the install's configured connector or prepares it as
 * an unsent draft. The record then holds the envelope: what went out or
 * is about to, who was asked, and where it stands.
 *
 * **What goes out is the primary document's chain, and nothing else**
 * (CTR-013, CTR-014). The dialog defaults to the current version and
 * offers the earlier ones; loose attachments are not sendable in v1,
 * because the executed copy comes back to the chain the send left from.
 *
 * **Every signer is asked in parallel.** A signer is a user of this
 * install, named by id, or somebody outside it, named by name and
 * address (the CTR-013 September 25 addendum). There is no routing
 * order in v1: the stored order is the order they were entered.
 *
 * **One local live reservation per Contract.** Live means `preparing`,
 * `draft`, or `sent` (`LIVE_ENVELOPE_STATUSES`). The route checks it
 * under the contract's row lock, and a partial unique index on the same
 * statuses backs it, so a preparation and a direct send racing on one
 * record cannot both land. A declined, voided, or failed round blocks
 * nothing: the next round is a new row, and the earlier one stays.
 *
 * **The intent is reserved first, and the provider is called after.**
 * Both operations commit a `preparing` row, with its signers, subject,
 * source version, preparer, provider account, and a provider
 * transaction id, before anything is dialled. No transaction is held
 * across the provider call: a lock held over somebody else's network is
 * a pooled connection parked on a stranger's latency. Then:
 *
 * - A preparation that the provider accepts becomes `draft`, with the
 *   provider's id, records confirmation Activity and moves no Stage. One the
 *   provider refuses becomes `preparation_failed`.
 * - A direct send that the provider accepts becomes `sent` in one
 *   transaction with its `envelope.sent` entry and the Stage move. One
 *   the provider refuses leaves no row, because no envelope exists.
 * - Either operation that never hears a clear answer stays `preparing`
 *   with an `uncertain` creation, and keeps the reservation (#1170
 *   section 2). A matching retry answers with that round rather than
 *   creating another, and every other send or preparation is refused
 *   until the recovery slice settles it.
 * - An envelope the provider took but the record could not keep is
 *   **voided at the provider** before the refusal is raised. Its
 *   provider id is kept first. Only a void the provider confirms ends
 *   the round, as `voided`; an unconfirmed void leaves it reserved and
 *   uncertain, with that id, for recovery.
 *
 * **An idempotency key names one request.** A preparation requires one;
 * a direct send may carry one. A matching retry answers with the round
 * it already made, and the same key with changed inputs is a typed
 * conflict.
 *
 * **Three refusals carry RFC 9457 types** (TECH-020): no connector
 * configured, an envelope already live, and an idempotency conflict.
 * The record branches on the first two to decide whether to draw the
 * send control at all, and a client that told them apart by reading the
 * sentence would break the first time the sentence was reworded. Every
 * other refusal here is one a client prints.
 *
 * **Access is inherited and nothing is held here** (DD-014, CTR-021).
 * Every route answers the owning contract's reach question first, with
 * `contractTeamScope` — the same predicate the record, its paper, its
 * comments, and its feed are read through — so a viewer who cannot
 * reach the contract is answered exactly as for a contract that was
 * never created. Confidentiality therefore inherits for free: the
 * envelopes of a walled-off record are invisible to everybody outside
 * its audience, and no rule here had to say so. The primary document is
 * asked a second question, `documentAudienceScope`, because DD-014's
 * per-document flag narrows again: a record whose instrument this
 * viewer may not see has nothing for them to send.
 *
 * **The send is narrated** (DD-017). One `envelope.sent` entry on the
 * owning contract at the standing record tier, inside the same
 * transaction as the write — so a failed log write rolls the send back
 * rather than leaving an unrecorded envelope. A preparation is not a
 * send. Reservation, confirmation and launch have separate Activity.
 *
 * **The status comes back on its own** (M15/3). The provider's Connect
 * webhook reports what happened to a sent envelope, through the one
 * status funnel in `lib/signing/transitions.ts`.
 *
 * **A live envelope is withdrawn where it was sent** (M15/4). The
 * sender, the contract's Owner, or an Administrator voids it — the
 * approvals-cancellation audience, for its reason: a mistaken or
 * superseded send should not sit open, and it should not need the
 * person who made it. For a preparation, `sent_by` holds the preparer,
 * so the preparer is the "sender" here. The void tells the **provider
 * first** and then applies the `voided` transition through that same
 * funnel, with the voider's reason stored and narrated. Only a `sent`
 * envelope is voided here; a draft uses native Discard and provider
 * confirmation.
 *
 * **Nothing here moves a sent envelope by hand.** Every status change
 * after the send goes through `applyEnvelopeStatus`, which owns its own
 * transaction, locks the row, and refuses to move an envelope that has
 * already ended. A void racing a decline therefore loses cleanly.
 *
 * **The executed copy comes back on its own** (M15/5). A signed
 * envelope's PDF is fetched by the pipeline, appended to the primary
 * document's chain as a round of kind `executed`, and pinned — so the
 * row here answers `executedFetch` and, once it lands, the file itself.
 * That copy is **this round's**, not the document's pin, and its author
 * is `sent_by`. None of that work is done here; the row only reports it.
 */

import { EnvelopeIdentityError, requireEnvelopeIdentity } from "../../lib/signing/identity.js";
import { contractStatusRevision } from "../../lib/signing/recovery-stage.js";
import { createHash, randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  alias,
  and,
  asc,
  contractEnvelopes,
  contractEnvelopeSigners,
  contracts,
  contractStatuses,
  signingConnectors,
  sql,
  desc,
  documents,
  documentVersions,
  eq,
  ENVELOPE_STATUSES,
  EXECUTED_FETCH_STATES,
  inArray,
  isNull,
  users,
  type EnvelopeStatus,
  type Executor,
  type SigningProviderKey,
} from "@openlaw/db";
import {
  ENVELOPE_LIVE_PROBLEM_TYPE,
  ENVELOPE_IDEMPOTENCY_CONFLICT_PROBLEM_TYPE,
  LIVE_ENVELOPE_STATUSES,
  MAX_ENVELOPE_REASON_LENGTH,
  MAX_ENVELOPE_SIGNERS,
  MAX_ENVELOPE_SUBJECT_LENGTH,
  SIGNING_NOT_CONFIGURED_PROBLEM_TYPE,
} from "@openlaw/shared";
import { requireRole, type AuthenticatedUser } from "../../auth/guards.js";
import { ERASED } from "../../lib/signer-erasure.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import {
  contractTeamScope,
  documentAudienceScope,
  NO_CONTRACT,
  reachedContract,
} from "../../lib/contract-access.js";
import { httpError, problemResponse, problemTypeResponse } from "../../lib/problem.js";
import {
  EnvelopeAccessError,
  EnvelopeNotFoundError,
  SigningConfigError,
  SigningNotSubmittedError,
  SigningRefusedError,
  SigningTimeoutError,
  SigningUnavailableError,
} from "../../lib/signing/provider.js";
import { applyEnvelopeStatus } from "../../lib/signing/transitions.js";

/** The contract read floor (CTR-021), which is the envelope read floor
 * too: a Contributor on the team sees whether the record's paper is out
 * for signature. The role alone opens nothing — the reach predicate
 * narrows it to the records they hold a `contract_team` row on. */
const requireEnvelopeReader = requireRole("administrator", "legal_team_member");

/** Sending is Member+, the same audience approvals use (CTR-013). A
 * Contributor reads but DD-015 gives them no envelope write. */
const requireMember = requireRole("administrator", "legal_team_member");

/** The sentence every write on a frozen record answers with (CTR-021):
 * an archived contract reads as facts until it is restored, and sending
 * its paper out is a change to the record, not a reading of it. */
const FROZEN = "This contract is archived. Restore it before sending it for signature.";

/** An envelope on a contract this viewer cannot reach reads exactly as
 * one that does not exist, for the reason `NO_CONTRACT` gives. */
const NO_ENVELOPE = "No envelope exists with that id.";

/** CTR-021 again, said for the act being refused: a frozen record takes
 * no writes, and withdrawing a send is a write. */
const FROZEN_VOID = "This contract is archived. Restore it before voiding its envelope.";

const RecordIdSchema = z.string().min(1).max(64);

const PersonSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  image: z.string().nullable(),
});

/** One person the envelope was sent to. Name and email, because that is
 * all a signer is (CTR-013). */
const SignerSchema = z.object({
  name: z.string(),
  email: z.string(),
});

/** The executed copy one round filed back onto the chain (CTR-014,
 * M15/5). NULL until the fetch lands — and NULL again once that version
 * has been erased (DOC-010), which is the one thing that takes it
 * away. */
const ExecutedCopySchema = z.object({
  /** The document whose chain it landed on, so a reader can open it
   * from the row. */
  documentId: z.string(),
  versionId: z.string(),
  versionNumber: z.int(),
  originalFilename: z.string(),
});

const EnvelopeSchema = z.object({
  id: z.string(),
  /** The adapter that carried it. Recorded on the row, so a record sent
   * through one provider is never voided through another. */
  provider: z.string(),
  status: z.enum(ENVELOPE_STATUSES),
  /** Who was asked, in the order they were entered. Every one of them
   * is asked at once — this is not a routing order. */
  signers: z.array(SignerSchema),
  /** What went out: the primary document as it was called then, and
   * which round of it. Both NULL once that version has been erased
   * (DOC-010), which is the one thing that can take them away. */
  documentTitle: z.string().nullable(),
  documentVersionNumber: z.int().nullable(),
  /** Why it was declined or voided, in the signer's or the voider's own
   * words. NULL for every other status, and NULL for a decline whose
   * reporter gave no words — the record does not invent one. */
  reason: z.string().nullable(),
  sentBy: PersonSchema,
  sentAt: z.iso.datetime().nullable(),
  confirmationPending: z.boolean(),
  scheduled: z.boolean(),
  externallyRestored: z.boolean(),
  preparationState: z.enum(["pending", "uncertain", "created", "failed"]).nullable(),
  recoveryAttempts: z.number().int(),
  nextRecoveryAt: z.iso.datetime().nullable(),
  recoveryStopped: z.enum(["lookup_expired", "attempts_exhausted", "identity_missing"]).nullable(),
  subject: z.string().nullable(),
  documentVersionId: z.string().nullable(),
  documentId: z.string().nullable(),
  sourceState: z.enum(["available", "changed", "unavailable"]),
  /** When it reached a terminal status; NULL while it is out. */
  completedAt: z.iso.datetime().nullable(),
  /**
   * Where this round's executed copy has got to (CTR-014, M15/5) — the
   * M12 derived-artifact states.
   *
   * `pending` on every live envelope, because nothing is owed until one
   * completes; `ready` once the signed PDF is on the chain; `failed`
   * when the fetch gave up, which is what tells the record to say so
   * rather than leave a reader waiting. A declined or voided round
   * stays `pending` for good, and that is the honest answer: no
   * executed copy was ever owed.
   */
  executedFetch: z.enum(EXECUTED_FETCH_STATES),
  /** The file this round filed back, or NULL when none has. It is
   * **this** envelope's copy, not the document's pin: a chain can hold
   * two rounds both of kind `executed`, and the row draws the one it
   * produced. */
  executedCopy: ExecutedCopySchema.nullable(),
});

/** One version the send dialog may offer. */
const SendableVersionSchema = z.object({
  id: z.string(),
  versionNumber: z.int(),
  kind: z.string(),
  originalFilename: z.string(),
  createdAt: z.iso.datetime(),
});

/** The contract's instrument (CTR-014), as the send dialog needs it. */
const SendableDocumentSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** Newest round first, so the dialog's default is the first entry and
   * the list reads current-then-older, the order somebody picking a
   * version thinks in. */
  versions: z.array(SendableVersionSchema),
});

/**
 * One contract's whole signing state, in one read.
 *
 * The two facts beside the rows are what decide whether the send
 * control is drawn at all (DES-035's absence rule): an install with no
 * connector cannot send, and a record with no primary document has
 * nothing to send. Answering them here rather than making the record
 * ask three seams is what keeps the card's absence rule one condition
 * over one response.
 */
const EnvelopesEnvelope = z.object({
  envelopes: z.array(EnvelopeSchema),
  /** Whether this install has an e-signature connector at all
   * (CTR-013). False is the zero-config manual hand-off, and it is not
   * an error. */
  signingConfigured: z.boolean(),
  updateMode: z.enum(["polling", "webhook"]).nullable(),
  preparationEnabled: z.boolean().optional(),
  /** The primary document this viewer may send, or NULL when the record
   * has none — or when DD-014 walls the one it has off from them. */
  primaryDocument: SendableDocumentSchema.nullable(),
});

const NumberParams = z.object({ number: z.coerce.number().int().positive() });

/**
 * The send's signers as the provider takes them: a name and an address
 * each. A user of this install is read from `users`, so the address is
 * the one they sign in with. An archived user is refused rather than
 * sent to, for the reason every other picker leaves them out: they
 * have left, and an invitation to sign should not follow them.
 */
async function namedSigners(
  db: Executor,
  signers: readonly ({ personId: string } | { name: string; email: string })[],
): Promise<{ name: string; email: string }[]> {
  const ids = signers.flatMap((signer) => ("personId" in signer ? [signer.personId] : []));
  const people =
    ids.length === 0
      ? []
      : await db
          .select({ id: users.id, name: users.displayName, email: users.email })
          .from(users)
          .where(and(inArray(users.id, ids), isNull(users.archivedAt)));
  const byId = new Map(people.map((person) => [person.id, person]));
  return signers.map((signer) => {
    if (!("personId" in signer)) return signer;
    const person = byId.get(signer.personId);
    if (!person) {
      throw httpError(
        422,
        "One of the people picked to sign is not an active user of this install. " +
          "Pick someone else, or enter their name and email address.",
      );
    }
    return { name: person.name, email: person.email };
  });
}

/** One envelope, addressed by its own id — as an approval's own writes
 * are addressed (CTR-012's precedent). A void is about the round, not
 * about the record, and the record it belongs to is read from it. */
const EnvelopeParams = z.object({ envelopeId: RecordIdSchema });

export const contractEnvelopesRoutes: FastifyPluginAsyncZod = async (app) => {
  /**
   * The contract's primary document, if this viewer may see it, with its
   * chain newest round first (CTR-014).
   *
   * Two questions, not one: the caller has already proved they reach the
   * contract, and DD-014's per-document flag narrows again. A record
   * whose instrument is walled off from this viewer answers `null` —
   * exactly as for a record that has no instrument — because that is
   * what silent omission means, and because the send they cannot make
   * and the send there is nothing to make are the same answer to them.
   */
  async function sendableDocument(
    db: Executor,
    user: AuthenticatedUser,
    primaryDocumentId: string | null,
  ): Promise<z.infer<typeof SendableDocumentSchema> | null> {
    if (!primaryDocumentId) return null;
    const [document] = await db
      .select({ id: documents.id, title: documents.title })
      .from(documents)
      .where(
        and(
          eq(documents.id, primaryDocumentId),
          // An archived document (DOC-010) is still the record's
          // instrument and is still sendable: archiving hides a wrong
          // upload from the listing, and the designation is a separate
          // decision that the archive never took away.
          documentAudienceScope(db, user),
        ),
      )
      .limit(1);
    if (!document) return null;
    const chain = await db
      .select({
        id: documentVersions.id,
        versionNumber: documentVersions.versionNumber,
        kind: documentVersions.kind,
        originalFilename: documentVersions.originalFilename,
        createdAt: documentVersions.createdAt,
      })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, document.id))
      .orderBy(desc(documentVersions.versionNumber));
    return {
      id: document.id,
      title: document.title,
      versions: chain.map((version) => ({
        ...version,
        createdAt: version.createdAt.toISOString(),
      })),
    };
  }

  /**
   * One contract's envelopes, newest send first.
   *
   * Newest first because an envelope is a round and the live one is the
   * one being asked about: a reader opening the record wants "where is
   * the signature" answered on the first row. The id breaks a tie
   * between two rows written in the same second, so the order is total.
   */
  async function envelopesOf(db: Executor, contractId: string, user: AuthenticatedUser) {
    // The round that came back, joined beside the round that went out.
    // Both are `document_versions`, so the second join needs a name of
    // its own — and the two are different facts: what was sent, and
    // what was signed (CTR-014).
    const executedVersions = alias(documentVersions, "executed_versions");
    const rows = await db
      .select({
        id: contractEnvelopes.id,
        provider: contractEnvelopes.provider,
        status: contractEnvelopes.status,
        preparationState: contractEnvelopes.preparationState,
        recoveryAttempts: contractEnvelopes.recoveryAttempts,
        nextRecoveryAt: contractEnvelopes.nextRecoveryAt,
        recoveryStopped: contractEnvelopes.recoveryStopped,
        confirmationPending: contractEnvelopes.confirmationPending,
        scheduled: contractEnvelopes.scheduled,
        externallyRestored: contractEnvelopes.externallyRestored,
        subject: contractEnvelopes.subject,
        documentVersionId: contractEnvelopes.documentVersionId,
        documentId: contractEnvelopes.documentId,
        documentTitle: documents.title,
        sourceReadable: sql<boolean>`coalesce(${documentAudienceScope(db, user)}, false)`,
        sourceArchivedAt: documents.archivedAt,
        primaryDocumentId: contracts.primaryDocumentId,
        documentVersionNumber: documentVersions.versionNumber,
        reason: contractEnvelopes.reason,
        sentById: contractEnvelopes.sentBy,
        sentByName: users.displayName,
        sentByImage: users.image,
        sentAt: contractEnvelopes.sentAt,
        completedAt: contractEnvelopes.completedAt,
        executedFetch: contractEnvelopes.executedFetch,
        executedDocumentId: executedVersions.documentId,
        executedVersionId: executedVersions.id,
        executedVersionNumber: executedVersions.versionNumber,
        executedFilename: executedVersions.originalFilename,
      })
      .from(contractEnvelopes)
      .innerJoin(users, eq(contractEnvelopes.sentBy, users.id))
      .innerJoin(contracts, eq(contractEnvelopes.contractId, contracts.id))
      // Left on all three: the versions an envelope names are set to
      // NULL when they are erased (DOC-010), and an inner join would
      // then take the envelope off the record along with them.
      .leftJoin(documentVersions, eq(contractEnvelopes.documentVersionId, documentVersions.id))
      .leftJoin(documents, eq(documentVersions.documentId, documents.id))
      .leftJoin(executedVersions, eq(contractEnvelopes.executedVersionId, executedVersions.id))
      .where(eq(contractEnvelopes.contractId, contractId))
      .orderBy(
        // Historical rounds were ordered by Sent. New preparations keep their
        // creation position even when an older discarded round is restored.
        desc(sql`case when ${contractEnvelopes.preparationState} is null
          then ${contractEnvelopes.sentAt} else ${contractEnvelopes.createdAt} end`),
        desc(contractEnvelopes.id),
      );

    // The signers, read in one go rather than joined onto the rows
    // above: a join would multiply every envelope by its signers and
    // leave this function stitching them back apart.
    const signersByEnvelope = new Map<string, { name: string; email: string }[]>();
    if (rows.length > 0) {
      const signers = await db
        .select({
          envelopeId: contractEnvelopeSigners.envelopeId,
          name: contractEnvelopeSigners.name,
          email: contractEnvelopeSigners.email,
        })
        .from(contractEnvelopeSigners)
        .where(
          inArray(
            contractEnvelopeSigners.envelopeId,
            rows.map((row) => row.id),
          ),
        )
        .orderBy(asc(contractEnvelopeSigners.signingOrder));
      for (const signer of signers) {
        const held = signersByEnvelope.get(signer.envelopeId) ?? [];
        held.push({ name: signer.name, email: signer.email });
        signersByEnvelope.set(signer.envelopeId, held);
      }
    }

    return rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      status: row.status,
      preparationState: row.preparationState,
      recoveryAttempts: row.recoveryAttempts,
      nextRecoveryAt:
        row.status === "preparing" ? (row.nextRecoveryAt?.toISOString() ?? null) : null,
      recoveryStopped: row.recoveryStopped,
      confirmationPending: row.confirmationPending,
      scheduled: row.scheduled,
      externallyRestored: row.externallyRestored,
      subject: row.subject,
      documentId: row.sourceReadable ? row.documentId : null,
      documentVersionId: row.sourceReadable ? row.documentVersionId : null,
      sourceState:
        !row.sourceReadable || !row.documentVersionId || row.sourceArchivedAt
          ? ("unavailable" as const)
          : row.documentId !== row.primaryDocumentId
            ? ("changed" as const)
            : ("available" as const),
      signers: signersByEnvelope.get(row.id) ?? [],
      documentTitle: row.sourceReadable ? row.documentTitle : null,
      documentVersionNumber: row.sourceReadable ? row.documentVersionNumber : null,
      reason: row.reason,
      sentBy: { id: row.sentById, displayName: row.sentByName, image: row.sentByImage },
      sentAt: row.sentAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      executedFetch: row.executedFetch,
      // All four halves arrive together or not at all: the join is on
      // one nullable column, so a row with an id has the rest of it.
      executedCopy:
        row.executedVersionId === null ||
        row.executedDocumentId === null ||
        row.executedVersionNumber === null ||
        row.executedFilename === null
          ? null
          : {
              documentId: row.executedDocumentId,
              versionId: row.executedVersionId,
              versionNumber: row.executedVersionNumber,
              originalFilename: row.executedFilename,
            },
    }));
  }

  /** Whether this contract already has an envelope out. Asked under the
   * contract's row lock on the write path, which is what makes it a
   * decision rather than a guess; the partial unique index stands behind
   * it as the database's own last word. */
  async function hasLiveEnvelope(db: Executor, contractId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: contractEnvelopes.id })
      .from(contractEnvelopes)
      .where(
        and(
          eq(contractEnvelopes.contractId, contractId),
          inArray(contractEnvelopes.status, [...LIVE_ENVELOPE_STATUSES]),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /** One envelope this viewer reaches, with the state of the record
   * that owns it. */
  interface ReachedEnvelope {
    id: string;
    contractId: string;
    provider: SigningProviderKey;
    providerAccountId: string | null;
    providerEnvironment: string | null;
    providerTransactionId: string | null;
    creationKind: string | null;
    providerEnvelopeId: string | null;
    status: EnvelopeStatus;
    /** Who sent it — one of the void's three actors (CTR-013). */
    sentBy: string;
    /** The owning contract's SET-003 soft delete (CTR-021). */
    contractArchivedAt: Date | null;
    /** The owning contract's Owner (CTR-004) — the second actor. */
    contractManagerId: string | null;
    /** CTR-014's instrument, so the answer can be built without a
     * second read of the record. */
    contractPrimaryDocumentId: string | null;
  }

  /**
   * One envelope this viewer reaches, by its own id, or `null`.
   *
   * The owning contract is joined in and the reach predicate rides
   * beside the id, so an envelope on a contract the viewer cannot reach
   * is indistinguishable from one that was never sent. Confidentiality
   * therefore inherits here exactly as it does on the read.
   */
  async function reachedEnvelope(
    db: Executor,
    user: AuthenticatedUser,
    envelopeId: string,
  ): Promise<ReachedEnvelope | null> {
    const [row] = await db
      .select({
        id: contractEnvelopes.id,
        contractId: contractEnvelopes.contractId,
        provider: contractEnvelopes.provider,
        providerAccountId: contractEnvelopes.providerAccountId,
        providerEnvironment: contractEnvelopes.providerEnvironment,
        providerTransactionId: contractEnvelopes.providerTransactionId,
        creationKind: contractEnvelopes.creationKind,
        providerEnvelopeId: contractEnvelopes.providerEnvelopeId,
        status: contractEnvelopes.status,
        sentBy: contractEnvelopes.sentBy,
        contractArchivedAt: contracts.archivedAt,
        contractManagerId: contracts.managerId,
        contractPrimaryDocumentId: contracts.primaryDocumentId,
      })
      .from(contractEnvelopes)
      .innerJoin(contracts, eq(contractEnvelopes.contractId, contracts.id))
      .where(and(eq(contractEnvelopes.id, envelopeId), contractTeamScope(db, user)))
      .limit(1);
    return row ?? null;
  }

  async function signingUpdateMode(db: Executor = app.db) {
    const [connector] = await db
      .select({ mode: signingConnectors.updateMode })
      .from(signingConnectors)
      .where(and(eq(signingConnectors.provider, "docusign"), isNull(signingConnectors.disabledAt)))
      .limit(1);
    return connector?.mode ?? null;
  }

  /** The record's whole signing state, as every route here answers it.
   * The connector is known to be resolvable by the time a write answers,
   * which is why that fact is passed in rather than asked again. */
  async function signingStateOf(
    user: AuthenticatedUser,
    contract: { id: string; primaryDocumentId: string | null },
    signingConfigured: boolean,
  ): Promise<z.infer<typeof EnvelopesEnvelope>> {
    const [envelopes, primaryDocument] = await Promise.all([
      envelopesOf(app.db, contract.id, user),
      sendableDocument(app.db, user, contract.primaryDocumentId),
    ]);
    return {
      envelopes,
      signingConfigured,
      primaryDocument,
      preparationEnabled: app.signingPreparationEnabled,
      updateMode: await signingUpdateMode(),
    };
  }

  /** The reason a compensating void gives the provider and the record. */
  const UNRECORDED_SEND_REASON = "OpenLaw could not record this send.";

  /** The typed refusal a second send answers with (TECH-020). One
   * function, because the route raises it twice — once before dialling
   * the provider, and once under the lock for the send that raced it. */
  function liveEnvelopeRefusal() {
    return httpError(
      409,
      "This contract already has a live envelope. Another cannot be sent or prepared " +
        "until it ends.",
      { type: ENVELOPE_LIVE_PROBLEM_TYPE },
    );
  }

  /**
   * The provider's own failures, as the sender reads them.
   *
   * 502 for every one of them: the provider failed us, not the request.
   * The detail is ours rather than the provider's response text, which
   * can quote back what it was just handed — the connector pane's test
   * button makes the same call for the same reason.
   */
  function sendFailure(
    error: unknown,
    unanswered: "unverified" | "reserved" = "unverified",
  ): unknown {
    if (error instanceof SigningRefusedError) {
      // The provider's own words stay in the log. A driver builds this
      // message from a response that can quote back what it was just
      // handed, and `problem.ts` forbids exposing text relayed from
      // another component for exactly that reason.
      app.log.error({ err: error }, "signing: the provider refused an envelope");
      return httpError(
        502,
        "The provider would not take the envelope. Check the signers' email addresses " +
          "and the version you picked, then try again.",
        { expose: true },
      );
    }
    if (error instanceof SigningConfigError) {
      return httpError(
        502,
        "The provider refused this install's credentials. An Administrator has to " +
          "check the e-signature connector before anything can be sent.",
        { expose: true },
      );
    }
    // The two ambiguous ones. A refusal means the provider said no and
    // no envelope exists; these two mean we never heard back. Before
    // anything was created (the account check) that is harmless. After
    // the create call, the provider may hold the envelope, so the round
    // stays reserved until its outcome is known, for a send and a
    // preparation alike.
    if (error instanceof SigningTimeoutError || error instanceof SigningUnavailableError) {
      return httpError(
        502,
        unanswered === "unverified"
          ? "The provider account could not be verified. No envelope was created. Try again."
          : "The provider did not confirm the envelope. It stays reserved on this contract " +
              "until its outcome is known.",
        { expose: true },
      );
    }
    // Any other failure of the create call is just as unclear about what
    // the provider holds, so it answers the same way. Its own words go
    // to the log.
    if (unanswered === "reserved") {
      app.log.error({ err: error }, "signing: envelope creation ended without an answer");
      return httpError(
        502,
        "The provider did not confirm the envelope. It stays reserved on this contract " +
          "until its outcome is known.",
        { expose: true },
      );
    }
    return error;
  }

  /**
   * The provider's own failures, as the voider reads them.
   *
   * Its own function rather than `sendFailure`'s second caller, because
   * the one refusal that matters means something different here: a
   * provider that will not take a withdrawal is telling us the envelope
   * has already ended on its side, and the sentence a sender gets about
   * signers and versions would be nonsense to a voider. The transient
   * failures are the send's, said again, because they are the same
   * failures.
   */
  function voidFailure(error: unknown): unknown {
    if (error instanceof EnvelopeIdentityError) return httpError(409, error.message);
    if (error instanceof SigningRefusedError) {
      // The provider's own words stay in the log, for the reason
      // `sendFailure` gives: a driver builds this message from a
      // response that can quote back what it was just handed.
      app.log.error({ err: error }, "signing: the provider refused a void");
      return httpError(
        409,
        "The provider says this envelope is no longer live. Its ending arrives on the " +
          "record from the provider's own feed.",
        { expose: true },
      );
    }
    if (error instanceof SigningConfigError) {
      return httpError(
        502,
        "The provider refused this install's credentials. An Administrator has to " +
          "check the e-signature connector before anything can be withdrawn.",
        { expose: true },
      );
    }
    // The credentials work but this one envelope is off limits to the
    // connector's user. The row stays live: the provider still holds
    // the round, so ending it here would be a guess.
    if (error instanceof EnvelopeAccessError) {
      app.log.error({ err: error }, "signing: the provider denied access to a void");
      return httpError(
        502,
        "The provider's signing user cannot access this envelope. An Administrator has to " +
          "check its permissions in the provider account before it can be withdrawn.",
        { expose: true },
      );
    }
    if (error instanceof SigningTimeoutError) {
      return httpError(502, "The provider did not answer in time. Try again.", { expose: true });
    }
    if (error instanceof SigningUnavailableError) {
      return httpError(502, "The provider could not be reached. Try again.", { expose: true });
    }
    return error;
  }

  /** Where one version's bytes are stored. Read on its own rather than
   * carried down from the chain read, because the chain the dialog
   * offers is a list of rounds and a storage reference is not something
   * a client is ever told. */
  async function versionFileRef(versionId: string): Promise<string> {
    const [row] = await app.db
      .select({ fileRef: documentVersions.fileRef })
      .from(documentVersions)
      .where(eq(documentVersions.id, versionId))
      .limit(1);
    if (!row) throw httpError(422, "That version is no longer on this contract's chain.");
    return row.fileRef;
  }

  app.get(
    "/contracts/:number/envelopes",
    {
      preHandler: requireEnvelopeReader,
      schema: {
        operationId: "listContractEnvelopes",
        summary:
          "One contract's signing envelopes, newest preparation first with historical Sent ordering " +
          "(CTR-013) — the adapter that carried each one, where it " +
          "stands, who was asked to sign it, what went out, and when. " +
          "A declined or voided envelope carries the reason it ended " +
          "with, and a finished one carries the moment it ended. Both " +
          "arrive from the provider's own feed, so the record answers " +
          "them without anybody typing them in. " +
          "Answers two facts beside the rows: whether this install has " +
          "an e-signature connector at all, and the primary document " +
          "this viewer may send, with its version chain newest round " +
          "first. Both are what decide whether the record draws a send " +
          "control, so an install with no connector and a record with " +
          "no paper each answer plainly rather than by omission. A " +
          "contract that has only ever been signed by hand holds no " +
          "envelopes, which is the zero-config manual hand-off and not " +
          "an error. Access is inherited from the contract and nothing " +
          "else: a Contributor on the team reads it, and anyone who " +
          "cannot reach the contract is answered 404, exactly as for a " +
          "contract that does not exist. An archived contract still " +
          "reads: archiving freezes a record, it does not hide it",
        tags: ["envelopes"],
        params: NumberParams,
        response: { 200: EnvelopesEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const contract = await reachedContract(app.db, request.user, request.params.number);
      if (!contract) throw httpError(404, NO_CONTRACT);
      const [envelopes, primaryDocument, signing] = await Promise.all([
        envelopesOf(app.db, contract.id, request.user),
        sendableDocument(app.db, request.user, contract.primaryDocumentId),
        // A stored connector that cannot be built into a driver — an
        // unreadable RSA key, a row a later adapter wrote — answers as
        // no connector rather than failing the whole read. The record
        // has to open either way, and an install whose credentials
        // cannot be used cannot send: the two are the same answer to
        // the reader, and the send refuses it again by name.
        app.resolveSigningProvider().catch((error: unknown) => {
          request.log.error({ err: error }, "signing: the connector could not be resolved");
          return null;
        }),
      ]);
      return {
        envelopes,
        signingConfigured: signing !== null,
        preparationEnabled: app.signingPreparationEnabled,
        primaryDocument,
        updateMode: await signingUpdateMode(),
      };
    },
  );

  for (const preparing of [false, true]) {
    app.post(
      preparing ? "/contracts/:number/envelopes/prepare" : "/contracts/:number/envelopes",
      {
        preHandler: requireMember,
        schema: {
          operationId: preparing ? "prepareContractEnvelope" : "sendContractEnvelope",
          summary: preparing
            ? "Prepare one durable, unsent Envelope for an exact primary Document Version and resolved Signers. Gated off by default pending live acceptance. Requires a stable idempotency key; matching retries reuse the preparation. Uncertain creation stays reserved. Does not send invitations or advance the Contract Stage."
            : "Legacy explicit direct-send API. Send a version of the contract's primary document out for " +
              "signature (CTR-013). The version must be a round of that " +
              "document's own chain — loose attachments are not sendable in " +
              "v1, because the executed copy comes back to the chain the " +
              "send left from. Signers are users of this install, by id, or " +
              "name-and-email pairs, and every one of them is asked at once: " +
              "there is no routing order. A successful send moves the " +
              "contract to its first live Signature status. Sending is legal " +
              "at any stage. Refused with a typed problem when this install " +
              "has no e-signature connector, and with another when the " +
              "contract already has a live envelope (preparing, draft, or " +
              "sent) — two envelopes must never race for one signature. The " +
              "live envelope is reserved before the provider is called. A " +
              "send the provider refuses leaves no row. A send with no clear " +
              "answer stays reserved as an uncertain preparing envelope, and " +
              "a matching idempotent retry answers with it rather than " +
              "sending again. An envelope the provider took but the record " +
              "could not keep is voided again before the refusal is raised; " +
              "if the provider does not confirm that void, the envelope stays " +
              "reserved with its provider id. Appends one " +
              "envelope.sent entry on the contract at the working-team tier " +
              "(DD-017). Member+: a Contributor who reaches the record is " +
              "refused 403 rather than 404, because they can already see it. " +
              "An archived contract sends nothing until it is restored",
          tags: ["envelopes"],
          params: NumberParams,
          body: z.object({
            idempotencyKey: preparing
              ? z.string().min(1).max(128)
              : z.string().min(1).max(128).optional(),
            /** Which round of the primary document goes out. Named
             * explicitly rather than defaulted to the current one: the
             * dialog defaults, and a send is too consequential for the
             * seam to guess what the caller meant. */
            documentVersionId: RecordIdSchema,
            /** A signer is a user of this install, named by id, or
             * somebody outside it, named by name and address. A user's
             * name and address are read here, so the sender never types
             * a colleague's address and cannot get it wrong. */
            signers: z
              .array(
                z.union([
                  z.object({ personId: RecordIdSchema }),
                  z.object({
                    name: z.string().trim().min(1).max(200),
                    // Checked as an address, because it is one: an envelope
                    // that cannot be delivered is worse than a refused send.
                    email: z.email().max(320),
                  }),
                ]),
              )
              .min(1)
              .max(MAX_ENVELOPE_SIGNERS),
            /** The subject line of the provider's own invitation. The
             * seam carries a subject and no body in v1; omitted, the
             * record names itself. */
            subject: z.string().trim().max(MAX_ENVELOPE_SUBJECT_LENGTH).optional(),
          }),
          response: {
            201: EnvelopesEnvelope,
            // The two refusals the record branches on. It draws the send
            // control from the first and offers a void from the second,
            // so a client that could not tell them apart would have to
            // read `detail` — and `detail` is copy.
            409: problemTypeResponse(
              "Refused: this install has no e-signature connector, the contract " +
                "already has a live envelope, or the idempotency key names a different " +
                "request. An archived contract is refused here too, without naming a type.",
              [
                SIGNING_NOT_CONFIGURED_PROBLEM_TYPE,
                ENVELOPE_LIVE_PROBLEM_TYPE,
                ENVELOPE_IDEMPOTENCY_CONFLICT_PROBLEM_TYPE,
              ],
            ),
            default: problemResponse,
          },
        },
      },
      async (request, reply) => {
        if (preparing && !app.signingPreparationEnabled)
          throw httpError(404, "Envelope preparation is not enabled.");
        const { documentVersionId } = request.body;

        // Everything that can be refused without dialling anybody is
        // refused first. A send that was never going to work must not
        // reach the provider, because an envelope it accepted is a thing
        // in somebody else's inbox that we would then have to take back.
        const contract = await reachedContract(app.db, request.user, request.params.number);
        if (!contract) throw httpError(404, NO_CONTRACT);
        if (contract.archivedAt) throw httpError(409, FROZEN);

        const signing = await app.resolveSigningProvider();
        if (!signing) {
          throw httpError(
            409,
            "This install has no e-signature connector. An Administrator configures one " +
              "in Settings, or the executed copy is uploaded onto the record by hand.",
            { type: SIGNING_NOT_CONFIGURED_PROBLEM_TYPE },
          );
        }

        // `||`, not `??`: the schema trims the subject, so a blank one
        // arrives as an empty string, and an empty subject line forwarded
        // to the provider is refused there with a sentence about signers
        // and versions. Blank means what omitted means — the record names
        // itself — which is the promise the dialog's help text makes.
        const subject =
          request.body.subject || `C-${String(contract.number)} ${contract.title}`.trim();

        // The request as the idempotency key promised it. A retry that
        // matches reuses the round; one that differs is a typed conflict.
        const fingerprint = createHash("sha256")
          .update(
            JSON.stringify({
              documentVersionId,
              signers: request.body.signers,
              subject: request.body.subject || null,
              preparer: request.user.id,
              preparing,
            }),
          )
          .digest("hex");
        const key = request.body.idempotencyKey ?? randomUUID();
        const [held] = await app.db
          .select()
          .from(contractEnvelopes)
          .where(
            and(
              eq(contractEnvelopes.contractId, contract.id),
              eq(contractEnvelopes.idempotencyKey, key),
            ),
          );
        if (held) {
          if (held.requestFingerprint !== fingerprint)
            throw httpError(409, "This idempotency key names a different Envelope preparation.", {
              type: ENVELOPE_IDEMPOTENCY_CONFLICT_PROBLEM_TYPE,
            });
          return reply.status(201).send(await signingStateOf(request.user, contract, true));
        }

        const primaryDocument = await sendableDocument(
          app.db,
          request.user,
          contract.primaryDocumentId,
        );
        if (!primaryDocument) {
          throw httpError(
            422,
            "This contract has no primary document to send. Upload one, or make one of " +
              "its documents the primary document first.",
          );
        }
        // The version has to be a round of *this* document. A version of
        // another document is answered as one that is not in the chain
        // rather than as one that does not exist: the caller is holding a
        // list of this chain's rounds, and any other answer would be
        // about a document they never named.
        const version = primaryDocument.versions.find((round) => round.id === documentVersionId);
        if (!version) {
          throw httpError(
            422,
            "That version is not a round of this contract's primary document. " +
              "Pick one from its chain.",
          );
        }

        const signers = await namedSigners(app.db, request.body.signers);

        // One address, one signer. Naming somebody twice is a client that
        // built the list badly, and it is refused here rather than left
        // to the provider — a 502 quoting somebody else's validator is a
        // worse answer than a sentence the sender can act on.
        const addresses = signers.map((signer) => signer.email.toLowerCase());
        if (new Set(addresses).size !== addresses.length) {
          throw httpError(422, "Each signer needs their own email address.");
        }

        const fileRef = await versionFileRef(version.id);
        if (await hasLiveEnvelope(app.db, contract.id)) throw liveEnvelopeRefusal();
        // Authentication creates nothing; persist its identity before creation.
        const account = await signing.testConnection().catch((error: unknown) => {
          throw sendFailure(error);
        });
        const reservation = await app.db.transaction(async (tx) => {
          const locked = await reachedContract(tx, request.user, request.params.number, {
            lock: true,
          });
          if (!locked) throw httpError(404, NO_CONTRACT);
          if (locked.archivedAt) throw httpError(409, FROZEN);
          const [connector] = await tx
            .select()
            .from(signingConnectors)
            .where(
              and(
                eq(signingConnectors.provider, signing.provider),
                isNull(signingConnectors.disabledAt),
              ),
            )
            .for("share");
          if (!connector || (await app.resolveSigningProvider()) !== signing)
            throw httpError(409, "The Signing connector is unavailable.", {
              type: SIGNING_NOT_CONFIGURED_PROBLEM_TYPE,
            });
          const [existing] = await tx
            .select()
            .from(contractEnvelopes)
            .where(
              and(
                eq(contractEnvelopes.contractId, locked.id),
                eq(contractEnvelopes.idempotencyKey, key),
              ),
            );
          if (existing) {
            if (existing.requestFingerprint !== fingerprint)
              throw httpError(409, "This idempotency key names a different Envelope preparation.", {
                type: ENVELOPE_IDEMPOTENCY_CONFLICT_PROBLEM_TYPE,
              });
            return { envelope: existing, reused: true };
          }
          if (await hasLiveEnvelope(tx, locked.id)) throw liveEnvelopeRefusal();
          if (locked.primaryDocumentId !== primaryDocument.id)
            throw httpError(409, "The primary Document changed. Select its Version again.");
          const [creationStatus] = await tx
            .select({ id: contracts.statusId })
            .from(contracts)
            .where(eq(contracts.id, locked.id));
          const [envelope] = await tx
            .insert(contractEnvelopes)
            .values({
              contractId: locked.id,
              provider: signing.provider,
              status: "preparing",
              sentAt: null,
              documentId: primaryDocument.id,
              documentVersionId: version.id,
              sentBy: request.user.id,
              subject,
              idempotencyKey: key,
              requestFingerprint: fingerprint,
              providerTransactionId: randomUUID(),
              providerAccountId: account.accountId,
              providerEnvironment: signing.environment,
              preparationState: "pending",
              creationKind: preparing ? "draft" : "send",
              creationStatusId: creationStatus!.id,
              creationStatusRevision: await contractStatusRevision(tx, locked.id),
            })
            .returning();
          if (!envelope) throw httpError(500, "The Envelope could not be reserved.");
          await tx.insert(contractEnvelopeSigners).values(
            signers.map((signer, index) => ({
              envelopeId: envelope.id,
              name: signer.name,
              email: signer.email,
              signingOrder: index + 1,
            })),
          );
          if (preparing)
            await recordActivity(tx, {
              entityType: "contract",
              entityId: locked.id,
              actorId: request.user.id,
              action: "envelope.preparation_started",
              visibility: RECORD_ACTIVITY_TIER,
              payload: {
                envelopeId: envelope.id,
                provider: signing.provider,
                documentId: primaryDocument.id,
                documentVersionId: version.id,
                signerCount: signers.length,
              },
            });
          return { envelope, reused: false };
        });
        if (reservation.reused)
          return reply.status(201).send(await signingStateOf(request.user, contract, true));
        const envelopeId = reservation.envelope.id;
        const transactionId = reservation.envelope.providerTransactionId!;

        // Confirmed noncreation: nothing reached the provider, or the
        // provider said no. Only this releases a reservation before its
        // outcome is terminal. A preparation keeps the round on the record
        // as a confirmed failure. A direct send leaves no row, because no
        // envelope exists and the sender asked for a send, not a draft.
        const failCreation = () =>
          preparing
            ? app.db
                .update(contractEnvelopes)
                .set({
                  status: "preparation_failed",
                  preparationState: "failed",
                  completedAt: new Date(),
                })
                .where(
                  and(
                    eq(contractEnvelopes.id, envelopeId),
                    eq(contractEnvelopes.status, "preparing"),
                  ),
                )
            : app.db
                .delete(contractEnvelopes)
                .where(
                  and(
                    eq(contractEnvelopes.id, envelopeId),
                    eq(contractEnvelopes.status, "preparing"),
                  ),
                );

        // The stream is opened before the provider is dialled, so a
        // storage failure is confirmed noncreation and nothing else.
        let document: Readable;
        try {
          document = await app.storage.get(fileRef);
        } catch (error) {
          app.log.error({ err: error, fileRef }, "signing: stored version unreadable");
          await failCreation();
          throw httpError(500, "That version's file could not be read. Try again.");
        }

        let sent: { providerEnvelopeId: string };
        try {
          const input = {
            document,
            fileName: version.originalFilename,
            subject,
            signers,
            transactionId,
          };
          sent = preparing
            ? await signing.prepareEnvelope(input)
            : await signing.sendEnvelope(input);
        } catch (error) {
          // A provider that gave up part-way through reading leaves the
          // stream open, and with it the file handle behind it. Closing it
          // here is what keeps a run of refused sends from exhausting them.
          document.destroy();
          if (error instanceof SigningNotSubmittedError) {
            await failCreation();
            throw sendFailure(error.cause);
          }
          if (error instanceof SigningRefusedError) {
            await failCreation();
            throw sendFailure(error);
          }
          // Anything else means we never heard a clear answer, so the
          // provider may hold the envelope. Both operations keep the
          // reservation, with its transaction id, account, source, and
          // signers, as recoverable uncertainty (#1170 section 2). Releasing
          // it would let a second round go out beside one that may exist.
          await app.db
            .update(contractEnvelopes)
            .set({ preparationState: "uncertain" })
            .where(
              and(eq(contractEnvelopes.id, envelopeId), eq(contractEnvelopes.status, "preparing")),
            );
          throw sendFailure(error, "reserved");
        }

        // Keep correlation before finalization so verified callbacks can settle it.
        await app.db
          .update(contractEnvelopes)
          .set({ providerEnvelopeId: sent.providerEnvelopeId })
          .where(
            and(eq(contractEnvelopes.id, envelopeId), eq(contractEnvelopes.status, "preparing")),
          );

        if (preparing) {
          // The provider id is kept before the route answers, so no later
          // browser launch can be issued for a draft the record cannot name.
          await app.db.transaction(async (tx) => {
            const [prepared] = await tx
              .update(contractEnvelopes)
              .set({
                status: "draft",
                providerEnvelopeId: sent.providerEnvelopeId,
                preparationState: "created",
              })
              .where(
                and(
                  eq(contractEnvelopes.id, envelopeId),
                  eq(contractEnvelopes.status, "preparing"),
                ),
              )
              .returning({ id: contractEnvelopes.id });
            if (prepared)
              await recordActivity(tx, {
                entityType: "contract",
                entityId: contract.id,
                action: "envelope.confirmed",
                visibility: RECORD_ACTIVITY_TIER,
                payload: {
                  envelopeId: prepared.id,
                  provider: signing.provider,
                  providerEnvelopeId: sent.providerEnvelopeId,
                  status: "draft",
                },
              });
          });
          return reply.status(201).send(await signingStateOf(request.user, contract, true));
        }

        // From here on an envelope exists at the provider. Anything that
        // goes wrong takes it back rather than leaving it out there.
        let answer: z.infer<typeof EnvelopesEnvelope>;
        try {
          answer = await app.notifier.notifying(async (tx) => {
            // The lock, and the archive asked again under it. The
            // reservation already holds the live-envelope rule, but the
            // record may have been archived while the provider answered.
            const locked = await reachedContract(tx, request.user, request.params.number, {
              lock: true,
            });
            if (!locked) throw httpError(404, NO_CONTRACT);
            if (locked.archivedAt) throw httpError(409, FROZEN);
            const [envelope] = await tx
              .update(contractEnvelopes)
              .set({
                status: "sent",
                sentAt: new Date(),
                providerEnvelopeId: sent.providerEnvelopeId,
                preparationState: "created",
              })
              .where(
                and(
                  eq(contractEnvelopes.id, envelopeId),
                  eq(contractEnvelopes.status, "preparing"),
                ),
              )
              .returning({ id: contractEnvelopes.id });
            if (!envelope)
              return {
                envelopes: await envelopesOf(tx, locked.id, request.user),
                signingConfigured: true,
                updateMode: await signingUpdateMode(tx),
                primaryDocument,
              };

            // An erasure may have removed a Signer while the provider was
            // answering. Read under the Envelope lock and keep erased slots.
            const retainedSigners = await tx
              .select()
              .from(contractEnvelopeSigners)
              .where(eq(contractEnvelopeSigners.envelopeId, envelope.id));
            const retainedByOrder = new Map(
              retainedSigners.map((signer) => [signer.signingOrder, signer]),
            );
            await recordActivity(tx, {
              entityType: "contract",
              entityId: locked.id,
              actorId: request.user.id,
              action: "envelope.sent",
              visibility: RECORD_ACTIVITY_TIER,
              // The signers by name and address, because the envelope's
              // own signer rows go when the record does and this entry is
              // then the only thing left that says who was asked. The
              // document is named for the same reason the document verbs
              // name theirs: the entry outlives an erasure.
              payload: {
                envelopeId: envelope.id,
                provider: signing.provider,
                providerEnvelopeId: sent.providerEnvelopeId,
                documentId: primaryDocument.id,
                documentTitle: primaryDocument.title,
                documentVersionId: version.id,
                documentVersionNumber: version.versionNumber,
                signers: signers.map((_signer, index) => {
                  const retained = retainedByOrder.get(index + 1);
                  return retained
                    ? { name: retained.name, email: retained.email }
                    : { name: ERASED, email: ERASED };
                }),
              },
            });

            const [currentStatus] = await tx
              .select({
                id: contractStatuses.id,
                displayName: contractStatuses.displayName,
                stage: contractStatuses.stage,
              })
              .from(contracts)
              .innerJoin(contractStatuses, eq(contracts.statusId, contractStatuses.id))
              .where(eq(contracts.id, locked.id));
            const [signatureStatus] = await tx
              .select()
              .from(contractStatuses)
              .where(
                and(eq(contractStatuses.stage, "signature"), isNull(contractStatuses.archivedAt)),
              )
              .orderBy(asc(contractStatuses.displayOrder), asc(contractStatuses.createdAt))
              .limit(1)
              .for("share");
            if (!currentStatus || !signatureStatus) {
              throw httpError(
                409,
                "Configure a live Signature status before sending for signature.",
              );
            }
            if (currentStatus.id !== signatureStatus.id) {
              await tx
                .update(contracts)
                .set({ statusId: signatureStatus.id, endedAt: null })
                .where(eq(contracts.id, locked.id));
              const change = {
                from: currentStatus.displayName,
                to: signatureStatus.displayName,
                fromStage: currentStatus.stage,
                toStage: signatureStatus.stage,
              };
              await recordActivity(tx, {
                entityType: "contract",
                entityId: locked.id,
                actorId: request.user.id,
                action: "contract.status_changed",
                visibility: RECORD_ACTIVITY_TIER,
                payload: { number: locked.number, title: locked.title, ...change },
              });
              await app.notifier.statusChanged(tx, {
                contractId: locked.id,
                actorId: request.user.id,
                actorName: request.user.displayName,
                ...change,
              });
            }

            return {
              envelopes: await envelopesOf(tx, locked.id, request.user),
              signingConfigured: true,
              updateMode: await signingUpdateMode(tx),
              primaryDocument,
            };
          });
        } catch (error) {
          // The provider holds a sent envelope, and the record could not
          // say so. Its id is kept on the reservation first, so a crash
          // from here on still leaves the record able to name it.
          const kept = await app.db
            .update(contractEnvelopes)
            .set({ providerEnvelopeId: sent.providerEnvelopeId, preparationState: "uncertain" })
            .where(
              and(eq(contractEnvelopes.id, envelopeId), eq(contractEnvelopes.status, "preparing")),
            )
            .returning({ id: contractEnvelopes.id })
            .catch((keepError: unknown) => {
              request.log.error(
                { err: keepError, envelopeId, providerEnvelopeId: sent.providerEnvelopeId },
                "signing: could not keep the provider id of a send whose record failed",
              );
            });
          if (kept && kept.length === 0) throw error;
          // The compensating void. It is attempted, not guaranteed: the
          // provider may be exactly what has just gone away. Only a void
          // the provider confirms is a terminal outcome, and only that
          // releases the reservation, as a voided round. Otherwise the
          // round stays reserved and uncertain, with its provider id, for
          // recovery. Either way the caller gets the original failure,
          // which is the sentence they can act on.
          const voided = await signing
            .voidEnvelope(sent.providerEnvelopeId, UNRECORDED_SEND_REASON)
            .then(
              () => true,
              (voidError: unknown) => {
                request.log.error(
                  { err: voidError, providerEnvelopeId: sent.providerEnvelopeId },
                  "signing: could not void an envelope whose record failed to commit",
                );
                return false;
              },
            );
          if (voided) {
            const now = new Date();
            await app.db
              .update(contractEnvelopes)
              .set({
                status: "voided",
                providerEnvelopeId: sent.providerEnvelopeId,
                preparationState: "created",
                reason: UNRECORDED_SEND_REASON,
                sentAt: now,
                completedAt: now,
              })
              .where(
                and(
                  eq(contractEnvelopes.id, envelopeId),
                  eq(contractEnvelopes.status, "preparing"),
                ),
              )
              .catch((endError: unknown) => {
                request.log.error(
                  { err: endError, envelopeId },
                  "signing: could not record the compensating void of a failed send",
                );
              });
          }
          throw error;
        }

        return reply.status(201).send(answer);
      },
    );
  }

  app.post(
    "/envelopes/:envelopeId/void",
    {
      preHandler: requireMember,
      schema: {
        operationId: "voidContractEnvelope",
        summary:
          "Withdraw a live envelope (CTR-013). Three actors may: the " +
          "preparer or direct sender, the contract's Owner, and an " +
          "Administrator — a mistaken or superseded send should not sit " +
          "open, and it should not wait on the one person who made it. " +
          "The reason is required, because the provider records it with " +
          "the withdrawal and the record draws it on the row. The " +
          "provider is told first and the voided transition is applied " +
          "after it accepts, so the record never says withdrawn while " +
          "the envelope is still collecting signatures. An envelope " +
          "that has already ended — signed, declined, or voided — is " +
          "refused: an ending is part of the record. Appends one " +
          "envelope.voided entry on the contract at the working-team " +
          "tier, attributed to the voider (DD-017). Once it is voided " +
          "the contract sends again, because the one-live-envelope rule " +
          "holds only while an envelope is out. An envelope on a " +
          "contract this viewer cannot reach answers 404, exactly as " +
          "for one that was never sent; an archived contract takes no " +
          "void until it is restored",
        tags: ["envelopes"],
        params: EnvelopeParams,
        body: z.object({
          /** Why it is being withdrawn, in the voider's own words. The
           * provider keeps it with the withdrawal and the row keeps it
           * for the record, bounded exactly as a decline's reason is. */
          reason: z.string().trim().min(1).max(MAX_ENVELOPE_REASON_LENGTH),
        }),
        response: {
          200: EnvelopesEnvelope,
          // A void needs the connector the send used, so an install
          // that removed it is refused with the same named type the
          // send gives — the record then says the same thing about
          // both controls rather than guessing from two sentences.
          409: problemTypeResponse(
            "The void was refused: this install has no e-signature connector. An " +
              "envelope that has already ended, and an archived contract, are refused " +
              "here too, without naming a type.",
            [SIGNING_NOT_CONFIGURED_PROBLEM_TYPE],
          ),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const { reason } = request.body;

      // Everything that can be refused without dialling anybody is
      // refused first, for the send's reason: a void that was never
      // going to be recorded must not withdraw an envelope somebody is
      // in the middle of signing.
      const envelope = await reachedEnvelope(app.db, request.user, request.params.envelopeId);
      if (!envelope) throw httpError(404, NO_ENVELOPE);
      if (envelope.contractArchivedAt) throw httpError(409, FROZEN_VOID);

      // The approvals-cancellation audience (CTR-012's shape, CTR-013's
      // rule). A 403 rather than a 404 for the same reason the cancel
      // route gives one: the viewer can already read the row.
      const mayVoid =
        request.user.role === "administrator" ||
        envelope.sentBy === request.user.id ||
        envelope.contractManagerId === request.user.id;
      if (!mayVoid) {
        throw httpError(
          403,
          "Only the preparer or direct sender, the contract's Owner, or an Administrator " +
            "can void this envelope.",
        );
      }
      if (envelope.status === "preparing" || envelope.status === "draft") {
        throw httpError(409, "This envelope has not been sent. There is nothing to void yet.");
      }
      if (envelope.status !== "sent" || !envelope.providerEnvelopeId) {
        throw httpError(409, "This envelope has already ended. It cannot be voided.");
      }

      const signing = await app.resolveSigningProvider();
      if (!signing) {
        throw httpError(
          409,
          "This install has no e-signature connector. An Administrator configures one " +
            "in Settings before an envelope can be withdrawn.",
          { type: SIGNING_NOT_CONFIGURED_PROBLEM_TYPE },
        );
      }
      // A record sent through one provider is never voided through
      // another: the row keeps the adapter that carried it precisely so
      // a connector swapped since the send cannot withdraw somebody
      // else's envelope by id collision.
      //
      // Unreachable while `docusign` is the only adapter — the column's
      // own check constraint allows no other value, so no row can
      // disagree with the resolver. It is written as a refusal rather
      // than left out so that the second adapter cannot arrive and
      // quietly make one connector able to withdraw another's envelope.
      if (signing.provider !== envelope.provider) {
        throw httpError(
          409,
          "This envelope was sent through a different e-signature connector. " +
            "It can only be voided through the one that sent it.",
        );
      }

      // The provider first. A withdrawal it refuses leaves the row
      // exactly as it was, which is the state a reader can act on.
      try {
        await requireEnvelopeIdentity(signing, envelope);
        await signing.voidEnvelope(envelope.providerEnvelopeId, reason);
      } catch (error) {
        // The provider does not hold this envelope at all. It cannot
        // then be signed, and refusing the void would leave the record
        // holding a live round forever — the one-live-envelope rule
        // would block every later send over a thing that does not
        // exist. So the record's own row is ended, and the reason the
        // voider gave stands.
        if (error instanceof EnvelopeNotFoundError) {
          request.log.warn(
            { err: error, providerEnvelopeId: envelope.providerEnvelopeId },
            "signing: voided an envelope the provider does not hold",
          );
        } else {
          throw voidFailure(error);
        }
      }

      // One funnel, its own transaction, and no wrapper around it: the
      // lock, the move, and the narration are one act. `unchanged` is
      // not a failure — a decline that landed while the provider was
      // being dialled is an ending, and the first ending stands.
      //
      // The archive check is deliberately **not** asked again here, and
      // this is the one place where the send's pattern is inverted on
      // purpose. The send re-asks under the lock because a refusal
      // there leaves nothing behind. Here the envelope is already
      // withdrawn at the provider, so a refusal would leave the record
      // showing a live round that no signer can sign — a record
      // somebody archived mid-request is still better served by the
      // truth than by a frozen lie.
      const applied = await applyEnvelopeStatus(app.notifier, {
        provider: envelope.provider,
        providerEnvelopeId: envelope.providerEnvelopeId,
        status: "voided",
        reason,
        // A person took this act, which is what tells the feed to
        // narrate it as theirs rather than as the integration's — and
        // what keeps them off their own bell item (NOT-002).
        actorId: request.user.id,
        actorName: request.user.displayName,
      });
      // The row went between the read and the move — the record was
      // deleted under this request. It reads as one that never existed.
      if (applied.outcome === "unknown") throw httpError(404, NO_ENVELOPE);

      return await signingStateOf(
        request.user,
        { id: envelope.contractId, primaryDocumentId: envelope.contractPrimaryDocumentId },
        true,
      );
    },
  );
};
