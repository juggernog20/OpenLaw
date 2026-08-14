// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A contract's paper (M11/2, M11/3) — the first path in the codebase
 * that puts a file anywhere: upload a draft, append the next revision,
 * read the chain, download any version of it, and keep the record's
 * metadata legible without touching the files.
 *
 * **Two tables, one logical record** (DOC-001). A `documents` row is the
 * thing the contract links to; the bytes live in `document_versions`,
 * numbered 1..n and immutable.
 *
 * **There is no route here that edits or deletes a version, and that
 * absence is the decision.** A correction appends a new version, which
 * is what makes the chain dependable as negotiation history — so the
 * suite asserts the absence rather than trusting it, by asking the route
 * table whether such a route exists. Metadata edits reach the
 * `documents` row and never a version row.
 *
 * **The next version number is assigned under the owning contract's row
 * lock.** Two people uploading a revision at the same moment serialize
 * behind that lock and take consecutive numbers, so the chain has
 * neither a collision nor a gap. The unique index on (document,
 * number) stands behind it as the database's own last word.
 *
 * **Access is inherited, never held here** (DOC-008, DD-014). There is
 * no document team. Every read and every write first answers the owning
 * contract's reach question with `contractTeamScope`, the same predicate
 * the contract record, its comments, and its feed are read through, so
 * a viewer who cannot reach the contract is answered exactly as they are
 * for a contract that does not exist — on the list, on the download, and
 * on the upload alike. One predicate is what keeps those four answers
 * from drifting apart.
 *
 * **A Contributor on the team reads and downloads** (DD-015, CTR-021).
 * Their write grid arrives with M23, so uploading is Member+ here: a
 * Contributor who reaches the record is refused plainly, because they
 * can already see it and a 404 would only make a real permission
 * boundary read as a bug.
 *
 * **The blob is written before the row commits** (DOC-012). The upload
 * streams straight through the storage adapter — never buffered whole in
 * memory, never staged on disk — while the same pass counts the bytes
 * and computes the SHA-256. A transaction that then fails leaves an
 * orphaned blob, which is harmless and accepted in v1: keys are minted
 * from ids and never reused, so nothing later can collide with it.
 *
 * **Any file type is accepted** (DOC-004). The declared MIME type is
 * recorded as a hint for M12's rendering and is never a decision: the
 * download always goes out as an attachment, with sniffing turned off.
 *
 * **Downloads stream through the API** behind the session and the same
 * access predicate. There are no presigned URLs — one authentication
 * path, and the local filesystem driver has no other way anyway.
 *
 * **Every mutation writes its own activity action** on the owning
 * contract (DD-017): creating a document, adding a version to one, and
 * editing what the record says are three different things that happened,
 * so the feed narrates three different sentences rather than one generic
 * edit.
 */

import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import {
  and,
  asc,
  contracts,
  desc,
  documents,
  documentVersions,
  DOCUMENT_VERSION_KINDS,
  eq,
  inArray,
  users,
  type DocumentVersionKind,
} from "@openlaw/db";
import { requireRole, type AuthenticatedUser } from "../../auth/guards.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import { contractTeamScope, type ContractAccessReader } from "../../lib/contract-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { attachmentDisposition, MEGABYTE } from "../../lib/uploads.js";

/** The contract read floor (CTR-021), which is the document floor too:
 * a Contributor reads and downloads the paper on a contract they are
 * on. The role alone opens nothing — the reach predicate narrows it to
 * the records they hold a `contract_team` row on. */
const requireDocumentReader = requireRole("administrator", "legal_team_member", "contributor");

/** Uploading is Member+ in M11: Contributors read and download, and
 * their write grid arrives with M23 (DD-015). */
const requireMember = requireRole("administrator", "legal_team_member");

/** A contract a viewer cannot reach reads exactly as one that does not
 * exist — for the list, the upload, and the download alike (DD-014). */
const NO_CONTRACT = "No contract exists with this number.";

/** And a document on such a contract answers the same way. Its own id
 * says nothing about which record it belongs to, so a refusal here
 * would be the leak the 404 exists to prevent. */
const NO_DOCUMENT = "No document exists with this reference.";

/** CTR-003's reference, as every contract route takes it. */
const NumberParams = z.object({ number: z.coerce.number().int().positive() });

/** An opaque text primary key, bounded rather than shaped — no route in
 * this API asserts a UUID pattern, and a well-formed id for a record the
 * viewer cannot reach answers 404 anyway. */
const RecordIdSchema = z.string().min(1).max(64);

const DocumentParams = z.object({ documentId: RecordIdSchema });

const VersionParams = z.object({
  documentId: RecordIdSchema,
  versionId: RecordIdSchema,
});

/** The longest filename the common filesystems carry. */
const MAX_FILENAME_LENGTH = 255;

/** What changed in this round, in one line — capped where the record's
 * other short free text is. */
const MAX_NOTE_LENGTH = 2000;

const KindSchema = z.enum(DOCUMENT_VERSION_KINDS);

/** The uploader, as every person on a record is drawn (DES-018). */
const PersonSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  image: z.string().nullable(),
  archived: z.boolean(),
});

const VersionSchema = z.object({
  id: z.string(),
  /** 1..n; the highest is the current version (DOC-001). */
  versionNumber: z.int().positive(),
  kind: KindSchema,
  /** What the uploader said about this round; NULL when they said
   * nothing. */
  note: z.string().nullable(),
  /** The name the file arrived under, and the name a download offers
   * back. */
  originalFilename: z.string(),
  /** What the upload declared it was — a rendering hint (DOC-004),
   * never a decision. */
  mimeType: z.string(),
  /** Counted by the server as the bytes streamed past. */
  byteSize: z.int().nonnegative(),
  /** Lowercase hex SHA-256, computed over the same pass. */
  checksumSha256: z.string(),
  uploadedBy: PersonSchema,
  createdAt: z.iso.datetime({ offset: true }),
  /**
   * Which one of the chain is current — the highest version number
   * (DOC-001), and the answer to "which file matters now".
   *
   * Said here rather than left to be inferred from the ordering. A
   * client that read the chain and took the last row would be right
   * only for as long as the order holds, and the pin is the one fact
   * the whole view is built around, so the server states it.
   */
  isCurrent: z.boolean(),
});

const DocumentSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** What the record is, in the team's own words (DOC-007). */
  description: z.string().nullable(),
  /**
   * The whole chain, in order 1..n, exactly one row of it current
   * (DOC-001). Superseded versions stay in it and stay downloadable:
   * the chain is the negotiation history, so reconstructing what was on
   * the table in round two is reading round two's row.
   */
  versions: z.array(VersionSchema),
  createdBy: PersonSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

const DocumentsEnvelope = z.object({ documents: z.array(DocumentSchema) });
const DocumentEnvelope = z.object({ document: DocumentSchema });

/** What the record is called, and what it says about itself (DOC-007).
 * The title is bounded where the contract's own is; the description is
 * the same free text at the same ceiling. */
const TitleSchema = z.string().trim().min(1).max(200);
const DescriptionSchema = z.string().trim().max(10_000);

/**
 * The metadata edit — the two things about a document that are editable
 * at all. Both are optional, because DES-017 commits one field at a
 * time; a body carrying neither changes nothing and is answered with the
 * row as it stands.
 */
const MetadataPatch = z.object({
  title: TitleSchema.optional(),
  description: DescriptionSchema.nullable().optional(),
});

/**
 * The multipart form, described for the OpenAPI document only.
 *
 * The parser hands the request over as a stream rather than as a parsed
 * body, so there is nothing for a validator to run against here and the
 * schema accepts anything. The parts are checked one at a time in the
 * handler, as they arrive — which is the only way to refuse an
 * oversized file without first storing it. The metadata below states
 * what the form carries so the generated client and the API docs are
 * not silent about it.
 */
const UploadForm = z.any().meta({
  type: "object",
  properties: {
    file: {
      type: "string",
      format: "binary",
      description: "The file itself. Any type is accepted (DOC-004).",
    },
    kind: {
      type: "string",
      enum: [...DOCUMENT_VERSION_KINDS],
      description:
        "What this version is in the negotiation (CTR-014). Defaults to " +
        "`draft_ours`. Must be sent before the file part.",
    },
    note: {
      type: "string",
      maxLength: MAX_NOTE_LENGTH,
      description:
        "What changed in this round, kept beside the file. Must be sent " + "before the file part.",
    },
  },
  required: ["file"],
});

/** A stored blob, as the download route needs it described. */
const DownloadSchema = z.any().meta({ type: "string", format: "binary" });

/** One form field the upload accepts, as the parser reports it before
 * the file part arrives. */
function fieldValue(fields: Record<string, unknown>, name: string): string | undefined {
  const entry = fields[name];
  if (!entry || typeof entry !== "object") return undefined;
  const part = entry as { type?: unknown; value?: unknown };
  return part.type === "field" && typeof part.value === "string" ? part.value : undefined;
}

/** The error code a Fastify plugin puts on its own rejections. */
function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

export const documentsRoutes: FastifyPluginAsyncZod = async (app) => {
  type Tx = Parameters<Parameters<typeof app.db.transaction>[0]>[0];
  type Executor = typeof app.db | Tx;

  /** One contract this viewer reaches, as the routes here need it. */
  interface ReachedContract {
    id: string;
    /** SET-003's soft delete: a time freezes the record (CTR-021). */
    archivedAt: Date | null;
  }

  /**
   * One contract this viewer reaches, by its CTR-003 number, or `null`.
   *
   * The scope rides beside the number rather than being asked after it,
   * so a contract the viewer cannot reach is not distinguishable from
   * one that was never created — the M10 rule, extended to files. It is
   * read live on every request, so taking somebody's last team row off
   * ends their reach on the next one.
   *
   * `lock` holds the row for the write that follows, so the reach answer
   * cannot go stale between the check and the insert.
   */
  async function reachedContract(
    db: ContractAccessReader,
    user: AuthenticatedUser,
    number: number,
    lock = false,
  ): Promise<ReachedContract | null> {
    const query = db
      .select({ id: contracts.id, archivedAt: contracts.archivedAt })
      .from(contracts)
      .where(and(eq(contracts.number, number), contractTeamScope(db, user)))
      .limit(1);
    const [row] = await (lock ? query.for("update", { of: contracts }) : query);
    return row ?? null;
  }

  /** One document this viewer reaches, as the routes here need it. */
  interface ReachedDocument {
    id: string;
    title: string;
    description: string | null;
    contractId: string;
    /** The owning contract's SET-003 soft delete (CTR-021). */
    archivedAt: Date | null;
  }

  /**
   * One document this viewer reaches, by its own id, or `null`.
   *
   * The owning contract is joined in and the scope rides beside the id,
   * so a document on a contract the viewer cannot reach is not
   * distinguishable from one that was never created (DOC-008, DD-014).
   * A document's id says nothing about which record it is on, so
   * refusing it any other way would be the leak the 404 prevents.
   *
   * `lock` holds the **contract** row — not the document row. That is
   * the lock every write on a contract's paper serializes behind, so a
   * version number assigned under it cannot be assigned twice.
   */
  async function reachedDocument(
    db: ContractAccessReader & Executor,
    user: AuthenticatedUser,
    documentId: string,
    lock = false,
  ): Promise<ReachedDocument | null> {
    const query = db
      .select({
        id: documents.id,
        title: documents.title,
        description: documents.description,
        contractId: documents.contractId,
        archivedAt: contracts.archivedAt,
      })
      .from(documents)
      .innerJoin(contracts, eq(documents.contractId, contracts.id))
      .where(and(eq(documents.id, documentId), contractTeamScope(db, user)))
      .limit(1);
    const [row] = await (lock ? query.for("update", { of: contracts }) : query);
    return row ?? null;
  }

  /** The one document projection, joined to its creator. The chain is
   * read beside it. Callers add the scope. */
  const selectDocuments = (db: Executor) =>
    db
      .select({
        id: documents.id,
        title: documents.title,
        description: documents.description,
        contractId: documents.contractId,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
        createdBy: {
          id: users.id,
          displayName: users.displayName,
          image: users.image,
          archivedAt: users.archivedAt,
        },
      })
      .from(documents)
      .innerJoin(users, eq(documents.createdBy, users.id));

  /** One version row's columns, named once so the plain read and the
   * current-version read cannot answer two different shapes. */
  const versionColumns = {
    id: documentVersions.id,
    documentId: documentVersions.documentId,
    versionNumber: documentVersions.versionNumber,
    kind: documentVersions.kind,
    note: documentVersions.note,
    originalFilename: documentVersions.originalFilename,
    mimeType: documentVersions.mimeType,
    byteSize: documentVersions.byteSize,
    checksumSha256: documentVersions.checksumSha256,
    createdAt: documentVersions.createdAt,
    uploadedBy: {
      id: users.id,
      displayName: users.displayName,
      image: users.image,
      archivedAt: users.archivedAt,
    },
  };

  /** One version row with the person who uploaded it. */
  const selectVersions = (db: Executor) =>
    db
      .select(versionColumns)
      .from(documentVersions)
      .innerJoin(users, eq(documentVersions.createdBy, users.id));

  type DocumentRow = Awaited<ReturnType<typeof selectDocuments>>[number];
  type VersionRow = Awaited<ReturnType<typeof selectVersions>>[number];

  function toPerson(person: DocumentRow["createdBy"]) {
    return {
      id: person.id,
      displayName: person.displayName,
      image: person.image,
      archived: person.archivedAt !== null,
    };
  }

  function toVersion(row: VersionRow, isCurrent: boolean) {
    return {
      id: row.id,
      versionNumber: row.versionNumber,
      kind: row.kind,
      note: row.note,
      originalFilename: row.originalFilename,
      mimeType: row.mimeType,
      byteSize: row.byteSize,
      checksumSha256: row.checksumSha256,
      uploadedBy: toPerson(row.uploadedBy),
      createdAt: row.createdAt.toISOString(),
      isCurrent,
    };
  }

  /**
   * One document with its chain, ordered 1..n and pinned.
   *
   * The chain arrives in version order, so the current version is its
   * last row — that is what "current is the highest version number"
   * means (DOC-001). The pin is computed once, here, so no surface has
   * to work it out again.
   */
  function toDocument(row: DocumentRow, chain: readonly VersionRow[]) {
    const last = chain.length - 1;
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      versions: chain.map((version, index) => toVersion(version, index === last)),
      createdBy: toPerson(row.createdBy),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * The whole chain of each of these documents, in one read, each in
   * version order.
   *
   * One read for every document on the record rather than one per
   * document: the record page draws them all, and a query per row is
   * how a section with six documents on it becomes seven round trips.
   *
   * A document always has at least one version — the upload writes both
   * rows in one transaction — so a document with no rows here would be a
   * broken record, and it is left out of the answer rather than drawn
   * without a file.
   */
  async function chainsOf(
    db: Executor,
    documentIds: readonly string[],
  ): Promise<Map<string, VersionRow[]>> {
    if (documentIds.length === 0) return new Map();
    const rows = await selectVersions(db)
      .where(inArray(documentVersions.documentId, [...documentIds]))
      // 1..n within each document, which is the order the chain reads
      // in and the order the pin is taken from.
      .orderBy(asc(documentVersions.documentId), asc(documentVersions.versionNumber));
    const chains = new Map<string, VersionRow[]>();
    for (const row of rows) {
      const chain = chains.get(row.documentId);
      if (chain) chain.push(row);
      else chains.set(row.documentId, [row]);
    }
    return chains;
  }

  /** One document with its chain, read back through the projection the
   * list answers with, so what a write returns is what the next load
   * will draw. */
  async function documentWithChain(db: Executor, documentId: string) {
    const [row] = await selectDocuments(db).where(eq(documents.id, documentId));
    const chain = (await chainsOf(db, [documentId])).get(documentId);
    // Both are written in one transaction, so neither can be missing
    // for a document this code just wrote or edited.
    return toDocument(row!, chain!);
  }

  app.get(
    "/contracts/:number/documents",
    {
      preHandler: requireDocumentReader,
      schema: {
        operationId: "listContractDocuments",
        summary:
          "The paper on one contract (DOC-008), newest first, each with " +
          "its whole version chain in order 1..n and one version of it " +
          "marked current. A contract holds as many documents as it " +
          "needs: a loose attachment such as a schedule or a " +
          "certificate is its own document with its own chain, beside " +
          "the main instrument rather than inside its history " +
          "(CTR-014). Access is inherited from the " +
          "contract and nothing else: a Contributor on the team reads " +
          "the list, and anyone who cannot reach the contract — a " +
          "Contributor who is not on it, a Legal Team Member outside a " +
          "confidential record's audience — is answered 404, exactly as " +
          "for a contract that does not exist",
        tags: ["documents"],
        params: NumberParams,
        response: { 200: DocumentsEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const contract = await reachedContract(app.db, request.user, request.params.number);
      if (!contract) throw httpError(404, NO_CONTRACT);
      // An archived record still reads: archiving is a soft delete for
      // mistakes and imports, and restore has to be reachable.
      const rows = await selectDocuments(app.db)
        .where(eq(documents.contractId, contract.id))
        // Newest first, as the record's Documents section reads. The id
        // breaks a same-instant tie: uuidv7 is time-ordered, so that
        // order is still the upload order.
        .orderBy(desc(documents.createdAt), desc(documents.id));
      const chains = await chainsOf(
        app.db,
        rows.map((row) => row.id),
      );
      return {
        documents: rows.flatMap((row) => {
          const chain = chains.get(row.id);
          return chain ? [toDocument(row, chain)] : [];
        }),
      };
    },
  );

  app.post(
    "/contracts/:number/documents",
    {
      preHandler: requireMember,
      schema: {
        operationId: "uploadContractDocument",
        summary:
          "Upload a file to a contract, creating a document with version " +
          "1 (DOC-001). Any file type is accepted (DOC-004); the ceiling " +
          "is the deployment's MAX_UPLOAD_MB, and a file over it is " +
          "refused rather than stored. The version row records the " +
          "original filename, the declared MIME type, the byte size the " +
          "server counted, and the SHA-256 it computed while streaming. " +
          "The blob is written through the storage adapter before the " +
          "rows commit (DOC-012). Appends document.created on the owning " +
          "contract (DD-017). The kind and note fields must be sent " +
          "before the file part. An archived contract takes no new " +
          "paper until it is restored. A contract the uploader cannot " +
          "reach answers 404, exactly as one that does not exist",
        tags: ["documents"],
        consumes: ["multipart/form-data"],
        params: NumberParams,
        body: UploadForm,
        response: { 201: DocumentEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      // Asked before a single byte is read: refusing after the upload
      // has been stored would mean storing a file for somebody who may
      // not put one there. Both refusals are made again below, on the
      // snapshot the rows are written on — the reach answer is the one
      // that must not go stale, and the frozen answer rides with it.
      assertOpen(await reachedContract(app.db, request.user, request.params.number));

      // Both ids are minted here, because the storage key is built from
      // them and the blob is written before the rows exist (DOC-012).
      const documentId = uuidv7();
      const versionId = uuidv7();
      const file = await receiveUpload(request, storageKey(documentId, versionId));

      const created = await app.db.transaction(async (tx) => {
        // The contract row is held for the write, and reach is asked
        // again on the same snapshot: a team row dropped between the
        // first check and the insert must not leave a file on a record
        // the uploader no longer reaches.
        const locked = await reachedContract(tx, request.user, request.params.number, true);
        assertOpen(locked);

        await tx.insert(documents).values({
          id: documentId,
          // Seeded from the filename: the record has to be called
          // something, and what the uploader recognises is the name
          // they chose on their own machine. It is renameable from
          // there (DOC-007), and renaming leaves the file's own name
          // alone.
          title: file.filename,
          contractId: locked.id,
          createdBy: request.user.id,
        });
        await insertVersion(tx, {
          documentId,
          versionId,
          versionNumber: 1,
          file,
          by: request.user,
        });
        // On the owning contract, at the tier every record action rides
        // (DD-017). The title is in the payload on purpose: hard
        // deletion (DOC-010) removes the rows, and the entry has to
        // still name what was deleted.
        await recordActivity(tx, {
          entityType: "contract",
          entityId: locked.id,
          actorId: request.user.id,
          action: "document.created",
          visibility: RECORD_ACTIVITY_TIER,
          payload: { documentId, versionId, title: file.filename },
        });

        // Read back through the list's own projection, so the row the
        // uploader gets is the row the next load will draw.
        return documentWithChain(tx, documentId);
      });

      return reply.status(201).send({ document: created });
    },
  );

  app.post(
    "/documents/:documentId/versions",
    {
      preHandler: requireMember,
      schema: {
        operationId: "uploadDocumentVersion",
        summary:
          "Append the next version to an existing document (DOC-001). " +
          "The number is assigned under the owning contract's row lock, " +
          "so two revisions uploaded at the same moment take consecutive " +
          "numbers rather than colliding, and the chain runs 1..n with " +
          "no gaps. The version carries one of the five CTR-014 kinds " +
          "and, when the uploader wrote one, a short note saying what " +
          "changed in this round. Nothing about the versions already in " +
          "the chain is touched: they are immutable, and a correction is " +
          "another version. Appends document.version_added on the owning " +
          "contract (DD-017). The kind and note fields must be sent " +
          "before the file part. An archived contract takes no new paper " +
          "until it is restored. A document on a contract the uploader " +
          "cannot reach answers 404, exactly as one that does not exist",
        tags: ["documents"],
        consumes: ["multipart/form-data"],
        params: DocumentParams,
        body: UploadForm,
        response: { 201: DocumentEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const { documentId } = request.params;
      // Before a byte is read, for the reason the create path gives.
      assertOpenDocument(await reachedDocument(app.db, request.user, documentId));

      const versionId = uuidv7();
      const file = await receiveUpload(request, storageKey(documentId, versionId));

      const updated = await app.db.transaction(async (tx) => {
        // The owning contract's row is held here, and this is the lock
        // the version number is assigned under: two uploaders reading
        // the chain's high-water mark at the same moment would both see
        // the same number, so the second one waits here until the first
        // has committed its row and then reads the number it wrote.
        const locked = await reachedDocument(tx, request.user, documentId, true);
        assertOpenDocument(locked);

        const [high] = await tx
          .select({ versionNumber: documentVersions.versionNumber })
          .from(documentVersions)
          .where(eq(documentVersions.documentId, documentId))
          .orderBy(desc(documentVersions.versionNumber))
          .limit(1);
        // A document always has version 1, so this is a step up from a
        // number that is really there rather than a count of rows.
        const versionNumber = (high?.versionNumber ?? 0) + 1;

        await insertVersion(tx, { documentId, versionId, versionNumber, file, by: request.user });
        // The document's own row is touched so that "when did this
        // document last change" answers with the new round rather than
        // with the day it was created.
        await tx
          .update(documents)
          .set({ updatedAt: new Date() })
          .where(eq(documents.id, documentId));
        await recordActivity(tx, {
          entityType: "contract",
          entityId: locked.contractId,
          actorId: request.user.id,
          action: "document.version_added",
          visibility: RECORD_ACTIVITY_TIER,
          payload: {
            documentId,
            versionId,
            title: locked.title,
            versionNumber,
            kind: file.kind,
          },
        });
        return documentWithChain(tx, documentId);
      });

      return reply.status(201).send({ document: updated });
    },
  );

  app.patch(
    "/documents/:documentId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "updateDocument",
        summary:
          "Rename a document or edit its description (DOC-007), one " +
          "field per request as DES-017 commits them. The stored files " +
          "are untouched by either: a version's own filename is what it " +
          "arrived as and stays that, and a download still offers it " +
          "back. Appends document.updated on the owning contract " +
          "(DD-017), naming what changed. An archived contract takes no " +
          "edit until it is restored. A document on a contract the " +
          "editor cannot reach answers 404, exactly as one that does not " +
          "exist",
        tags: ["documents"],
        params: DocumentParams,
        body: MetadataPatch,
        response: { 200: DocumentEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const { documentId } = request.params;
      const body = request.body;

      return {
        document: await app.db.transaction(async (tx) => {
          const target = await reachedDocument(tx, request.user, documentId, true);
          assertOpenDocument(target);

          const patch: { title?: string; description?: string | null } = {};
          /** The DD-017 changed map — old and new per edited field,
           * feeding the M9 viewer's narration. */
          const changed: Record<string, { from: unknown; to: unknown }> = {};

          if (body.title !== undefined && body.title !== target.title) {
            patch.title = body.title;
            changed.title = { from: target.title, to: body.title };
          }
          if (body.description !== undefined) {
            // Blank normalizes to NULL; null clears deliberately.
            const next = body.description || null;
            if (next !== target.description) {
              patch.description = next;
              changed.description = { from: target.description, to: next };
            }
          }

          // Nothing changed: answer with the row and write no
          // misleading from==to entry.
          if (Object.keys(changed).length > 0) {
            await tx.update(documents).set(patch).where(eq(documents.id, documentId));
            await recordActivity(tx, {
              entityType: "contract",
              entityId: target.contractId,
              actorId: request.user.id,
              action: "document.updated",
              visibility: RECORD_ACTIVITY_TIER,
              // The title as it stands after the edit, so the entry
              // still names the document after DOC-010's hard delete
              // has taken the row.
              payload: { documentId, title: patch.title ?? target.title, changed },
            });
          }

          return documentWithChain(tx, documentId);
        }),
      };
    },
  );

  app.get(
    "/documents/:documentId/versions/:versionId/download",
    {
      preHandler: requireDocumentReader,
      schema: {
        operationId: "downloadDocumentVersion",
        summary:
          "Stream one version's file back, as an attachment. Every open " +
          "is a download in M11 — in-app rendering is M12 — and there " +
          "are no presigned URLs: the bytes come through the API behind " +
          "the session and the owning contract's access predicate. A " +
          "Contributor on the team downloads; anyone who cannot reach " +
          "the contract is answered 404, exactly as for a document that " +
          "does not exist",
        tags: ["documents"],
        // The bytes go out under the type the upload declared, so the
        // document says the widest thing that is always true rather
        // than a type it would sometimes be wrong about.
        produces: ["application/octet-stream"],
        params: VersionParams,
        response: {
          200: DownloadSchema,
          default: problemResponse,
        },
      },
    },
    async (request, reply) => {
      const { documentId, versionId } = request.params;
      // Document, owning contract, and reach in one read: the scope
      // rides beside the ids, so a version on a contract this viewer
      // cannot reach is not distinguishable from one that is not there.
      const [row] = await app.db
        .select({
          fileRef: documentVersions.fileRef,
          originalFilename: documentVersions.originalFilename,
          mimeType: documentVersions.mimeType,
          byteSize: documentVersions.byteSize,
        })
        .from(documentVersions)
        .innerJoin(documents, eq(documentVersions.documentId, documents.id))
        .innerJoin(contracts, eq(documents.contractId, contracts.id))
        .where(
          and(
            eq(documentVersions.id, versionId),
            eq(documentVersions.documentId, documentId),
            contractTeamScope(app.db, request.user),
          ),
        )
        .limit(1);
      if (!row) throw httpError(404, NO_DOCUMENT);

      const body = await app.storage.get(row.fileRef);
      return (
        reply
          // The declared type, which the upload did not verify — so the
          // response also says the browser must not go looking for a
          // better one, and must not render this in place.
          .header("content-type", row.mimeType)
          .header("content-length", String(row.byteSize))
          .header("content-disposition", attachmentDisposition(row.originalFilename))
          .header("x-content-type-options", "nosniff")
          // A stored blob never changes (DOC-012), and its reference is
          // minted once — but who may read it does change, so this is
          // private to the browser that asked.
          .header("cache-control", "private, max-age=0, must-revalidate")
          .send(body)
      );
    },
  );

  /** Where one version's blob lives (DOC-012): minted from the two ids,
   * never from the uploaded filename, so no name a person chose can
   * shape a storage key. */
  function storageKey(documentId: string, versionId: string): string {
    return `documents/${documentId}/${versionId}`;
  }

  /** One uploaded file, once its bytes are stored and described. */
  interface StoredUpload {
    filename: string;
    mimeType: string;
    kind: DocumentVersionKind;
    note: string | null;
    fileRef: string;
    byteSize: number;
    checksumSha256: string;
  }

  /**
   * Takes one multipart upload off the request, stores its bytes through
   * the adapter, and answers what arrived.
   *
   * Shared by the two upload paths — creating a document and appending
   * to one — because the file half of both is the same act, and the
   * refusals have to be too: a person who is told a 300-character name
   * is too long on their first upload must be told the same thing on
   * their fourth.
   *
   * The bytes are streamed straight through: never buffered whole in
   * memory, never staged on disk, hashed and counted on the same pass.
   */
  async function receiveUpload(request: FastifyRequest, key: string): Promise<StoredUpload> {
    const part = await request.file().catch((error: unknown) => {
      throw asUploadRefusal(error);
    });
    if (!part) throw httpError(400, "Attach a file to upload.");

    // Read before the file is consumed. The parser reports the fields
    // it has already seen, and the file part ends the ones it can
    // report — which is why the form has to put them first.
    const rawKind = fieldValue(part.fields, "kind");
    const rawNote = fieldValue(part.fields, "note");
    const kind: DocumentVersionKind = rawKind
      ? (KindSchema.safeParse(rawKind).data ?? refuseKind())
      : "draft_ours";
    // Refused rather than shortened. A note is what the uploader wrote
    // about this round, and silently keeping the first 2000 characters
    // of it would put words on the record that nobody chose to stop
    // at — the composer bounds its own control, so a note this long is
    // a client that ignored the bound and is told so.
    const trimmedNote = rawNote?.trim() ?? "";
    if (trimmedNote.length > MAX_NOTE_LENGTH) {
      throw httpError(400, `Shorten the note to ${MAX_NOTE_LENGTH} characters or fewer.`);
    }
    const note = trimmedNote || null;

    // A part with no `filename` at all is still a file part when it
    // declares `application/octet-stream`, so the name has to be
    // treated as absent rather than assumed present — an unnamed
    // upload is refused, not crashed on.
    const filename = (part.filename ?? "").trim();
    if (filename.length === 0) throw httpError(400, "The uploaded file has no name.");
    // Refused rather than shortened, for the note's reason and one of
    // its own: cutting the end off a filename takes its extension with
    // it, which is the part a later download and M12's rendering both
    // read.
    if (filename.length > MAX_FILENAME_LENGTH) {
      throw httpError(
        400,
        `Rename the file to ${MAX_FILENAME_LENGTH} characters or fewer before uploading it.`,
      );
    }
    // Client-supplied and unverified, so it is stored as a hint and
    // never acted on. An upload that declares nothing is stored as
    // the type that means "bytes".
    const mimeType = part.mimetype.trim() || "application/octet-stream";

    const digest = createHash("sha256");
    let byteSize = 0;
    // One pass: the bytes are hashed and counted on their way to the
    // driver, so nothing is read twice and nothing is held whole in
    // memory. An error on the source — a cut-off upload, the size
    // limit tripping — is thrown out of the iterator, so `put`
    // rejects and the driver leaves nothing at the key.
    async function* metered(source: AsyncIterable<Buffer>) {
      for await (const chunk of source) {
        digest.update(chunk);
        byteSize += chunk.length;
        yield chunk;
      }
    }

    let fileRef: string;
    try {
      fileRef = await app.storage.put(key, Readable.from(metered(part.file)));
    } catch (error) {
      throw asUploadRefusal(error);
    }
    // The ceiling, enforced. The parser stops the stream at the limit
    // and marks it truncated rather than throwing at whoever is
    // reading it, so what reached the driver is the first N bytes of a
    // longer file — a silent corruption if it were kept. It is deleted
    // here rather than left as an orphan, because this is the one case
    // where the writer knows the blob is worthless. The key is not
    // written again (DOC-012): the retry mints its own.
    if (part.file.truncated) {
      await app.storage.delete(fileRef).catch((error: unknown) => {
        request.log.warn({ err: error, fileRef }, "could not remove a truncated upload");
      });
      throw refuseOversize();
    }

    return {
      filename,
      mimeType,
      kind,
      note,
      fileRef,
      byteSize,
      checksumSha256: digest.digest("hex"),
    };
  }

  /** One row in the chain, written from what arrived. The only INSERT
   * into `document_versions` there is, and there is no UPDATE and no
   * DELETE anywhere beside it (DOC-001). */
  function insertVersion(
    tx: Tx,
    row: Readonly<{
      documentId: string;
      versionId: string;
      versionNumber: number;
      file: StoredUpload;
      by: AuthenticatedUser;
    }>,
  ) {
    return tx.insert(documentVersions).values({
      id: row.versionId,
      documentId: row.documentId,
      versionNumber: row.versionNumber,
      fileRef: row.file.fileRef,
      kind: row.file.kind,
      note: row.file.note,
      originalFilename: row.file.filename,
      mimeType: row.file.mimeType,
      byteSize: row.file.byteSize,
      checksumSha256: row.file.checksumSha256,
      createdBy: row.by.id,
    });
  }

  /** The one refusal a bad `kind` earns, thrown rather than returned so
   * the expression above stays one line. */
  function refuseKind(): never {
    throw httpError(400, "That is not a version kind this record accepts.");
  }

  /**
   * The two refusals every upload shares, in the order they have to be
   * asked in.
   *
   * Reach first: a 409 on a record the uploader cannot reach would tell
   * them it is there. Then the freeze — an archived contract reads as
   * facts until it is restored (CTR-021), and putting new paper on it is
   * a change to the record, not a conversation about it.
   */
  function assertOpen(contract: ReachedContract | null): asserts contract is ReachedContract {
    if (!contract) throw httpError(404, NO_CONTRACT);
    if (contract.archivedAt) {
      throw httpError(409, "This contract is archived. Restore it before uploading.");
    }
  }

  /** The same two refusals, in the same order, for a write addressed at
   * a document rather than at its contract. */
  function assertOpenDocument(
    document: ReachedDocument | null,
  ): asserts document is ReachedDocument {
    if (!document) throw httpError(404, NO_DOCUMENT);
    if (document.archivedAt) {
      throw httpError(409, "This contract is archived. Restore it before changing its paper.");
    }
  }

  /**
   * The parser's own rejections, turned into copy a person can act on.
   *
   * The size ceiling is the one that matters: story 24 asks for a clear
   * message rather than a mystery timeout, so the limit is named in the
   * refusal. Anything else is passed through as it came.
   */
  function refuseOversize() {
    const limitMb = Math.round(app.maxUploadBytes / MEGABYTE);
    return httpError(
      413,
      limitMb >= 1
        ? `That file is over the ${limitMb} MB upload limit.`
        : `That file is over the ${app.maxUploadBytes} byte upload limit.`,
    );
  }

  function asUploadRefusal(error: unknown): unknown {
    switch (errorCode(error)) {
      case "FST_REQ_FILE_TOO_LARGE":
        return refuseOversize();
      case "FST_FILES_LIMIT":
        return httpError(413, "Upload one file at a time.");
      case "FST_FIELDS_LIMIT":
      case "FST_PARTS_LIMIT":
        return httpError(413, "That upload carries more form fields than this endpoint accepts.");
      case "FST_INVALID_MULTIPART_CONTENT_TYPE":
        return httpError(415, "Send the file as multipart/form-data.");
      case "FST_MP_PREMATURE_CLOSE":
        return httpError(400, "The upload ended before the file was complete. Try again.");
      default:
        return error;
    }
  }
};
