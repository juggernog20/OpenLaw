// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A contract's signing envelopes (M15/2) — CTR-013's send, made on the
 * record instead of on another company's website.
 *
 * A Member+ user with reach to a contract picks a version of its
 * **primary document**, names the people who have to sign it, and sends
 * it through the install's configured connector. The record then holds
 * the envelope: what went out, who was asked, and where it stands.
 *
 * **What goes out is the primary document's chain, and nothing else**
 * (CTR-013, CTR-014). The dialog defaults to the current version and
 * offers the earlier ones; loose attachments are not sendable in v1,
 * because the executed copy comes back to the chain the send left from.
 *
 * **Every signer is asked in parallel.** A signer is a name and an
 * email — the person on the other side of a deal has no account here,
 * and the envelope has to reach them anyway. There is no routing order
 * in v1: the stored order is the order they were typed, so the record
 * draws them back as they were entered.
 *
 * **At most one live envelope per contract.** Checked under the
 * contract's row lock and backed by a partial unique index, so two
 * sends racing on one record cannot both land. A declined or voided
 * envelope blocks nothing — the next round is a new row, and the
 * earlier one stays on the record.
 *
 * **The provider is called first, and the row commits once it accepts.**
 * The two systems cannot be written atomically, so the order is chosen
 * to make the survivable failure the likely one: an accepted envelope
 * whose row would not commit is **voided at the provider** before the
 * refusal is raised, and a provider that refuses leaves no row behind.
 * The row lock is taken after the call rather than held across it — a
 * lock held over somebody else's network is a pooled connection parked
 * on a stranger's latency — and the live-envelope rule is re-asked
 * under it, so a race loses cleanly instead of quietly.
 *
 * **Two refusals carry RFC 9457 types** (TECH-020): no connector
 * configured, and an envelope already live. They are the two the record
 * branches on to decide whether to draw the send control at all, and a
 * client that told them apart by reading the sentence would break the
 * first time the sentence was reworded. Every other refusal here is one
 * a client prints.
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
 * transaction as the write — so a failed log write rolls the send's row
 * back rather than leaving an unrecorded envelope.
 *
 * **The status comes back on its own** (M15/3). The provider's Connect
 * webhook reports what happened to an envelope, through the one status
 * funnel in `lib/signing/transitions.ts`.
 *
 * **A live envelope is withdrawn where it was sent** (M15/4). The
 * sender, the contract's Owner, or an Administrator voids it — the
 * approvals-cancellation audience, for its reason: a mistaken or
 * superseded send should not sit open, and it should not need the
 * person who made it. The void tells the **provider first** and then
 * applies the `voided` transition through that same funnel, with the
 * voider's reason stored and narrated. The order is the send's order
 * inverted for the send's reason: a record that says "voided" while the
 * envelope is still collecting signatures is the failure that matters,
 * and telling the provider first cannot produce it.
 *
 * **Nothing here moves an envelope by hand.** Every status change on
 * this module's rows goes through `applyEnvelopeStatus`, which owns its
 * own transaction, locks the row, and refuses to move an envelope that
 * has already ended. A void racing a decline therefore loses cleanly.
 *
 * **After an ending, the record sends again** (CTR-013). The partial
 * unique index holds only while an envelope is `sent`, so a voided or
 * declined round blocks nothing: the next send is a new row and the
 * earlier one stays on the record.
 *
 * The reconciliation sweep and the executed-copy fetch are the later
 * slices, and nothing here moves a contract's status.
 */

import type { Readable } from "node:stream";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  asc,
  contractEnvelopes,
  contractEnvelopeSigners,
  contracts,
  desc,
  documents,
  documentVersions,
  eq,
  ENVELOPE_STATUSES,
  inArray,
  users,
  type Db,
  type EnvelopeStatus,
  type SigningProviderKey,
} from "@openlaw/db";
import {
  ENVELOPE_LIVE_PROBLEM_TYPE,
  MAX_ENVELOPE_REASON_LENGTH,
  MAX_ENVELOPE_SIGNERS,
  MAX_ENVELOPE_SUBJECT_LENGTH,
  SIGNING_NOT_CONFIGURED_PROBLEM_TYPE,
} from "@openlaw/shared";
import { requireRole, type AuthenticatedUser } from "../../auth/guards.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import {
  contractTeamScope,
  documentAudienceScope,
  type ContractAccessReader,
} from "../../lib/contract-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import {
  EnvelopeNotFoundError,
  SigningConfigError,
  SigningRefusedError,
  SigningTimeoutError,
  SigningUnavailableError,
  type SigningProvider,
} from "../../lib/signing/provider.js";
import { applyEnvelopeStatus } from "../../lib/signing/transitions.js";

/** The contract read floor (CTR-021), which is the envelope read floor
 * too: a Contributor on the team sees whether the record's paper is out
 * for signature. The role alone opens nothing — the reach predicate
 * narrows it to the records they hold a `contract_team` row on. */
const requireEnvelopeReader = requireRole("administrator", "legal_team_member", "contributor");

/** Sending is Member+, the same audience approvals use (CTR-013). A
 * Contributor reads; their write grid arrives with M23 (DD-015). */
const requireMember = requireRole("administrator", "legal_team_member");

/** A contract a viewer cannot reach reads exactly as one that does not
 * exist — on the envelope routes as on every document route (DD-014). */
const NO_CONTRACT = "No contract exists with this number.";

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
  sentAt: z.iso.datetime(),
  /** When it reached a terminal status; NULL while it is out. */
  completedAt: z.iso.datetime().nullable(),
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
  /** The primary document this viewer may send, or NULL when the record
   * has none — or when DD-014 walls the one it has off from them. */
  primaryDocument: SendableDocumentSchema.nullable(),
});

const NumberParams = z.object({ number: z.coerce.number().int().positive() });
/** One envelope, addressed by its own id — as an approval's own writes
 * are addressed (CTR-012's precedent). A void is about the round, not
 * about the record, and the record it belongs to is read from it. */
const EnvelopeParams = z.object({ envelopeId: RecordIdSchema });

export const contractEnvelopesRoutes: FastifyPluginAsyncZod = async (app) => {
  type Tx = Parameters<Parameters<typeof app.db.transaction>[0]>[0];
  type Executor = Db | Tx;

  /** One contract this viewer reaches, as the routes here need it. */
  interface ReachedContract {
    id: string;
    number: number;
    title: string;
    /** SET-003's soft delete: a time freezes the record (CTR-021). */
    archivedAt: Date | null;
    /** CTR-014's instrument, or NULL on a record with no paper yet. */
    primaryDocumentId: string | null;
  }

  /**
   * One contract this viewer reaches, by its CTR-003 number, or `null`.
   *
   * The scope rides beside the number rather than being asked after it,
   * so a contract the viewer cannot reach is not distinguishable from
   * one that was never created. It is read live on every request, so
   * taking somebody's last team row off ends their reach on the next
   * one.
   *
   * `lock` holds the row for the write that follows. That lock is what
   * makes the live-envelope check a decision rather than a guess: every
   * write on one contract serializes behind it.
   */
  async function reachedContract(
    db: ContractAccessReader,
    user: AuthenticatedUser,
    number: number,
    lock = false,
  ): Promise<ReachedContract | null> {
    const query = db
      .select({
        id: contracts.id,
        number: contracts.number,
        title: contracts.title,
        archivedAt: contracts.archivedAt,
        primaryDocumentId: contracts.primaryDocumentId,
      })
      .from(contracts)
      .where(and(eq(contracts.number, number), contractTeamScope(db, user)))
      .limit(1);
    const [row] = await (lock ? query.for("update", { of: contracts }) : query);
    return row ?? null;
  }

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
    db: ContractAccessReader & Executor,
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
  async function envelopesOf(db: Executor, contractId: string) {
    const rows = await db
      .select({
        id: contractEnvelopes.id,
        provider: contractEnvelopes.provider,
        status: contractEnvelopes.status,
        documentTitle: documents.title,
        documentVersionNumber: documentVersions.versionNumber,
        reason: contractEnvelopes.reason,
        sentById: contractEnvelopes.sentBy,
        sentByName: users.displayName,
        sentByImage: users.image,
        sentAt: contractEnvelopes.sentAt,
        completedAt: contractEnvelopes.completedAt,
      })
      .from(contractEnvelopes)
      .innerJoin(users, eq(contractEnvelopes.sentBy, users.id))
      // Left on both: the version an envelope names is set to NULL when
      // it is erased (DOC-010), and an inner join would then take the
      // envelope off the record along with it.
      .leftJoin(documentVersions, eq(contractEnvelopes.documentVersionId, documentVersions.id))
      .leftJoin(documents, eq(documentVersions.documentId, documents.id))
      .where(eq(contractEnvelopes.contractId, contractId))
      .orderBy(desc(contractEnvelopes.sentAt), desc(contractEnvelopes.id));

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
      signers: signersByEnvelope.get(row.id) ?? [],
      documentTitle: row.documentTitle,
      documentVersionNumber: row.documentVersionNumber,
      reason: row.reason,
      sentBy: { id: row.sentById, displayName: row.sentByName, image: row.sentByImage },
      sentAt: row.sentAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
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
        and(eq(contractEnvelopes.contractId, contractId), eq(contractEnvelopes.status, "sent")),
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
    providerEnvelopeId: string;
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
    db: ContractAccessReader,
    user: AuthenticatedUser,
    envelopeId: string,
  ): Promise<ReachedEnvelope | null> {
    const [row] = await db
      .select({
        id: contractEnvelopes.id,
        contractId: contractEnvelopes.contractId,
        provider: contractEnvelopes.provider,
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

  /** The record's whole signing state, as every route here answers it.
   * The connector is known to be resolvable by the time a write answers,
   * which is why that fact is passed in rather than asked again. */
  async function signingStateOf(
    user: AuthenticatedUser,
    contract: { id: string; primaryDocumentId: string | null },
    signingConfigured: boolean,
  ): Promise<z.infer<typeof EnvelopesEnvelope>> {
    const [envelopes, primaryDocument] = await Promise.all([
      envelopesOf(app.db, contract.id),
      sendableDocument(app.db, user, contract.primaryDocumentId),
    ]);
    return { envelopes, signingConfigured, primaryDocument };
  }

  /** The typed refusal a second send answers with (TECH-020). One
   * function, because the route raises it twice — once before dialling
   * the provider, and once under the lock for the send that raced it. */
  function liveEnvelopeRefusal() {
    return httpError(
      409,
      "This contract already has an envelope out for signature. " +
        "Void it before sending another.",
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
  function sendFailure(error: unknown): unknown {
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
    if (error instanceof SigningTimeoutError) {
      return httpError(502, "The provider did not answer in time. Try again.", { expose: true });
    }
    if (error instanceof SigningUnavailableError) {
      return httpError(502, "The provider could not be reached. Try again.", { expose: true });
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

  /**
   * Opens the stored bytes and hands them to the provider.
   *
   * The stream is opened here rather than by the caller so that a
   * storage failure is a failure to send — nothing has been dialled
   * yet — and so that the provider's own failures are the only ones the
   * caller has to compensate for.
   */
  async function sendThroughProvider(
    signing: SigningProvider,
    input: {
      fileRef: string;
      fileName: string;
      subject: string;
      signers: readonly { name: string; email: string }[];
    },
  ) {
    let document: Readable;
    try {
      document = await app.storage.get(input.fileRef);
    } catch (error) {
      app.log.error({ err: error, fileRef: input.fileRef }, "signing: stored version unreadable");
      throw httpError(500, "That version's file could not be read. Try again.");
    }
    try {
      return await signing.sendEnvelope({
        document,
        fileName: input.fileName,
        subject: input.subject,
        signers: input.signers.map((signer) => ({ name: signer.name, email: signer.email })),
      });
    } catch (error) {
      // A provider that gave up part-way through reading leaves the
      // stream open, and with it the file handle behind it. Closing it
      // here is what keeps a run of refused sends from exhausting them.
      document.destroy();
      throw sendFailure(error);
    }
  }

  app.get(
    "/contracts/:number/envelopes",
    {
      preHandler: requireEnvelopeReader,
      schema: {
        operationId: "listContractEnvelopes",
        summary:
          "One contract's signing envelopes, newest send first " +
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
        envelopesOf(app.db, contract.id),
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
      return { envelopes, signingConfigured: signing !== null, primaryDocument };
    },
  );

  app.post(
    "/contracts/:number/envelopes",
    {
      preHandler: requireMember,
      schema: {
        operationId: "sendContractEnvelope",
        summary:
          "Send a version of the contract's primary document out for " +
          "signature (CTR-013). The version must be a round of that " +
          "document's own chain — loose attachments are not sendable in " +
          "v1, because the executed copy comes back to the chain the " +
          "send left from. Signers are name-and-email pairs and every " +
          "one of them is asked at once: there is no routing order. " +
          "Sending is legal at any stage; CTR-001's transitions stay " +
          "unrestricted. Refused with a typed problem when this install " +
          "has no e-signature connector, and with another when the " +
          "contract already has an envelope out — two envelopes must " +
          "never race for one signature. The provider is called first " +
          "and the row commits once it accepts; an envelope the " +
          "provider took but the record could not keep is voided again " +
          "before the refusal is raised, so the two systems do not " +
          "drift apart silently. Appends one envelope.sent entry on the " +
          "contract at the working-team tier (DD-017). Member+: a " +
          "Contributor who reaches the record is refused 403 rather " +
          "than 404, because they can already see it. An archived " +
          "contract sends nothing until it is restored",
        tags: ["envelopes"],
        params: NumberParams,
        body: z.object({
          /** Which round of the primary document goes out. Named
           * explicitly rather than defaulted to the current one: the
           * dialog defaults, and a send is too consequential for the
           * seam to guess what the caller meant. */
          documentVersionId: RecordIdSchema,
          signers: z
            .array(
              z.object({
                name: z.string().trim().min(1).max(200),
                // Checked as an address, because it is one: an envelope
                // that cannot be delivered is worse than a refused send.
                email: z.email().max(320),
              }),
            )
            .min(1)
            .max(MAX_ENVELOPE_SIGNERS),
          /** The subject line of the provider's own invitation. The
           * seam carries a subject and no body in v1; omitted, the
           * record names itself. */
          subject: z.string().trim().max(MAX_ENVELOPE_SUBJECT_LENGTH).optional(),
        }),
        response: { 201: EnvelopesEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const { documentVersionId, signers } = request.body;

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

      // One address, one signer. Naming somebody twice is a client that
      // built the list badly, and it is refused here rather than left
      // to the provider — a 502 quoting somebody else's validator is a
      // worse answer than a sentence the sender can act on.
      const addresses = signers.map((signer) => signer.email.toLowerCase());
      if (new Set(addresses).size !== addresses.length) {
        throw httpError(422, "Each signer needs their own email address.");
      }

      if (await hasLiveEnvelope(app.db, contract.id)) throw liveEnvelopeRefusal();

      const fileRef = await versionFileRef(version.id);
      // `||`, not `??`: the schema trims the subject, so a blank one
      // arrives as an empty string, and an empty subject line forwarded
      // to the provider is refused there with a sentence about signers
      // and versions. Blank means what omitted means — the record names
      // itself — which is the promise the dialog's help text makes.
      const subject =
        request.body.subject || `C-${String(contract.number)} ${contract.title}`.trim();

      const sent = await sendThroughProvider(signing, {
        fileRef,
        fileName: version.originalFilename,
        subject,
        signers,
      });

      // From here on an envelope exists at the provider. Anything that
      // goes wrong takes it back rather than leaving it out there.
      let answer: z.infer<typeof EnvelopesEnvelope>;
      try {
        answer = await app.db.transaction(async (tx) => {
          // The lock, and the two questions asked again under it: a
          // send that raced this one may have archived the record or
          // put an envelope out since the checks above.
          const locked = await reachedContract(tx, request.user, request.params.number, true);
          if (!locked) throw httpError(404, NO_CONTRACT);
          if (locked.archivedAt) throw httpError(409, FROZEN);
          if (await hasLiveEnvelope(tx, locked.id)) throw liveEnvelopeRefusal();

          const [envelope] = await tx
            .insert(contractEnvelopes)
            .values({
              contractId: locked.id,
              provider: signing.provider,
              providerEnvelopeId: sent.providerEnvelopeId,
              documentVersionId: version.id,
              sentBy: request.user.id,
            })
            .returning({ id: contractEnvelopes.id });
          if (!envelope) throw httpError(500, "The envelope could not be recorded.");

          await tx.insert(contractEnvelopeSigners).values(
            signers.map((signer, index) => ({
              envelopeId: envelope.id,
              name: signer.name,
              email: signer.email,
              signingOrder: index + 1,
            })),
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
              signers: signers.map((signer) => ({ name: signer.name, email: signer.email })),
            },
          });

          return {
            envelopes: await envelopesOf(tx, locked.id),
            signingConfigured: true,
            primaryDocument,
          };
        });
      } catch (error) {
        // The compensating void. It is attempted, not guaranteed: the
        // provider may be exactly what has just gone away. A failure to
        // take the envelope back is logged and swallowed, because the
        // caller's refusal is the more useful answer and re-throwing
        // this one would replace a sentence they can act on with one
        // they cannot.
        await signing
          .voidEnvelope(sent.providerEnvelopeId, "OpenLaw could not record this send.")
          .catch((voidError: unknown) => {
            request.log.error(
              { err: voidError, providerEnvelopeId: sent.providerEnvelopeId },
              "signing: could not void an envelope whose record failed to commit",
            );
          });
        throw error;
      }

      return reply.status(201).send(answer);
    },
  );

  app.post(
    "/envelopes/:envelopeId/void",
    {
      preHandler: requireMember,
      schema: {
        operationId: "voidContractEnvelope",
        summary:
          "Withdraw a live envelope (CTR-013). Three actors may: the " +
          "person who sent it, the contract's Owner, and an " +
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
        response: { 200: EnvelopesEnvelope, default: problemResponse },
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
          "Only the person who sent it, the contract's Owner, or an Administrator " +
            "can void this envelope.",
        );
      }
      if (envelope.status !== "sent") {
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
      const applied = await applyEnvelopeStatus(app.db, {
        provider: envelope.provider,
        providerEnvelopeId: envelope.providerEnvelopeId,
        status: "voided",
        reason,
        // A person took this act, which is what tells the feed to
        // narrate it as theirs rather than as the integration's.
        actorId: request.user.id,
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
