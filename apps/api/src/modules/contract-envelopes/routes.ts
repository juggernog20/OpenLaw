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
 * The webhook, the reconciliation sweep, the executed-copy fetch, and
 * the void are the later slices. Nothing here reads a status the
 * provider pushed, and nothing here moves a contract's status.
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
} from "@openlaw/db";
import {
  ENVELOPE_LIVE_PROBLEM_TYPE,
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
  SigningConfigError,
  SigningRefusedError,
  SigningTimeoutError,
  SigningUnavailableError,
  type SigningProvider,
} from "../../lib/signing/provider.js";

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
  sentBy: PersonSchema,
  sentAt: z.iso.datetime(),
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
};
