// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The one write path that puts a round on a document's chain (DOC-001).
 *
 * It started as a closure inside the documents module, because an
 * upload was the only act that ever appended a version. M15/5 gives it
 * a second caller: the executed copy the signing integration fetches
 * back is a round on the same chain, written the same way (CTR-014). So
 * the write moved here, and both callers use it — a second append path
 * would be a second answer to "what does a version row look like", and
 * the two would drift.
 *
 * Three rules travel with it.
 *
 * **The number is assigned under the owning contract's row lock.** The
 * chain runs 1..n with no gaps, so the next number is a step up from a
 * number that is really there rather than a count of rows — and two
 * writers reading the high-water mark at the same moment would both
 * read the same one. {@link nextVersionNumber} therefore says in its
 * own name what its caller has to be holding. The unique index on
 * (`document_id`, `version_number`) is the database's own last word
 * behind it.
 *
 * **What the pipeline owes the round is written in the same
 * transaction.** A rolled-back append asks for nothing; a committed one
 * always leaves the request on the record. The queue send that follows
 * the commit only wakes a worker, and a lost send leaves a `pending`
 * row for the M12/6 sweep rather than a version nobody will ever read.
 *
 * **Only the type is correctable.** There is one INSERT into
 * `document_versions` and one UPDATE that sets only the type and the
 * kind that follows it. Both live here. There is no DELETE (DOC-001,
 * CTR-014, DOC-015).
 *
 * **The kind follows the type (DOC-015).** A Version of a fixed type
 * stores that type's system kind; any other Version stores `general`,
 * unless it was generated, in which case its kind records how it was
 * made. {@link resolveDocumentType} is the one place that rule lives.
 */

import {
  and,
  activityLog,
  sql,
  desc,
  documents,
  documentTypes,
  documentVersions,
  eq,
  isNull,
  type DocumentTypeModule,
  type DocumentVersionKind,
  type DocumentVersionSource,
  type Executor,
} from "@openlaw/db";
import { needsDisplayRendition, recordRenditionOwed } from "../pipeline/display-conversion.js";
import { boundedQueueAsk, type JobQueue } from "../pipeline/jobs.js";
import { extractsText, recordTextOwed } from "../pipeline/text-extraction.js";
import { httpError } from "./problem.js";

/** Somewhere to say that a queue could not be reached. The pipeline's
 * own logger shape, so a route's Fastify log and the worker's console
 * logger both fit without an adapter. */
export interface QueueLogger {
  error(fields: Record<string, unknown>, message: string): void;
}

/** Where one version's blob lives (DOC-012): minted from the two ids,
 * never from a filename, so no name a person chose can shape a storage
 * key. */
export function versionStorageKey(documentId: string, versionId: string): string {
  return `documents/${documentId}/${versionId}`;
}

/**
 * The number the next round on this chain takes.
 *
 * **Call it under the owning contract's row lock.** Without one, two
 * writers read the same high-water mark and the second INSERT is
 * refused by the unique index — which is the right failure, but it is a
 * failure the lock makes impossible rather than one worth recovering
 * from.
 */
export async function nextVersionNumber(tx: Executor, documentId: string): Promise<number> {
  const [high] = await tx
    .select({ versionNumber: documentVersions.versionNumber })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(desc(documentVersions.versionNumber))
    .limit(1);
  const [deleted] = await tx
    .select({
      number: sql<number>`coalesce(max((${activityLog.payload}->>'versionNumber')::integer), 0)`,
    })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.action, "document.version_deleted"),
        sql`${activityLog.payload}->>'documentId' = ${documentId}`,
      ),
    );
  return Math.max(high?.versionNumber ?? 0, deleted?.number ?? 0) + 1;
}

/** One round, as the chain stores it. */
export interface AppendedVersion {
  documentId: string;
  versionId: string;
  versionNumber: number;
  fileRef: string;
  kind: DocumentVersionKind;
  /**
   * DOC-015's type, when the caller has already resolved it with
   * {@link resolveDocumentType}. Omitted, the type is read off `kind`:
   * the owner list's fixed row for that kind, or none.
   */
  documentTypeId?: string | null;
  /**
   * How the file was made, and which two rounds it compares.
   *
   * A generated redline names both comparison operands. An Auto-Doc's
   * original primary Version is generated, draft_ours, and names its
   * Generation. Other Versions are uploaded. Database constraints
   * enforce these combinations and the Generation's ownership links.
   */
  source: DocumentVersionSource;
  generatedFromGenerationId?: string | null;
  comparedFromVersionId: string | null;
  comparedToVersionId: string | null;
  /** What changed in this round, or NULL when nobody wrote one. */
  note: string | null;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  checksumSha256: string;
  /** Who the round is recorded against. The integration has no account
   * of its own, so a round it files is recorded against the person who
   * sent the envelope — the nearest human act behind the file. */
  createdBy: string;
}

/**
 * Writes one round onto a chain, and records what the pipeline owes it.
 *
 * Runs inside the caller's transaction, under the owning contract's row
 * lock — see the module note for why both.
 */
export async function insertDocumentVersion(
  tx: Executor,
  row: Readonly<AppendedVersion>,
): Promise<void> {
  const typed =
    row.documentTypeId === undefined
      ? await resolveDocumentType(tx, row.documentId, { kind: row.kind }, row.source)
      : { kind: row.kind, documentTypeId: row.documentTypeId };
  await tx.insert(documentVersions).values({
    id: row.versionId,
    documentId: row.documentId,
    versionNumber: row.versionNumber,
    fileRef: row.fileRef,
    kind: typed.kind,
    documentTypeId: typed.documentTypeId,
    source: row.source,
    generatedFromGenerationId: row.generatedFromGenerationId ?? null,
    comparedFromVersionId: row.comparedFromVersionId,
    comparedToVersionId: row.comparedToVersionId,
    note: row.note,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    checksumSha256: row.checksumSha256,
    createdBy: row.createdBy,
  });
  // Only a file that has text to read gets a row. An image or a
  // spreadsheet gets none, and the text read says so plainly rather
  // than leaving a caller polling for an answer that is not coming.
  if (extractsText(row.mimeType, row.originalFilename)) {
    await recordTextOwed(tx, row.versionId);
  }
  // And a display rendition for a file a browser cannot draw (DOC-004).
  if (needsDisplayRendition(row.mimeType, row.originalFilename)) {
    await recordRenditionOwed(tx, row.versionId);
  }
}

/**
 * Corrects the judgement attached to one round without moving any fact
 * about the round. The caller checks access, rejects generated
 * provenance, and resolves the type before this write runs (CTR-014,
 * DOC-015).
 */
export async function updateDocumentVersionType(
  tx: Executor,
  documentId: string,
  versionId: string,
  typed: ResolvedDocumentType,
): Promise<void> {
  await tx
    .update(documentVersions)
    .set({ kind: typed.kind, documentTypeId: typed.documentTypeId })
    .where(and(eq(documentVersions.id, versionId), eq(documentVersions.documentId, documentId)));
}

/** What a Version stores for its type (DOC-015). */
export interface ResolvedDocumentType {
  kind: DocumentVersionKind;
  documentTypeId: string | null;
  /** The type's name, for activity entries; null when there is none. */
  displayName: string | null;
}

/**
 * What somebody asked a round to be called: a type from the owner's
 * list by id, null for no type, or a Version kind from a caller that
 * speaks kinds (the portal, the signing integration, Auto-Docs).
 */
export type DocumentTypeChoice = { documentTypeId: string | null } | { kind: DocumentVersionKind };

/** The list a Document's types come from, or null for a Knowledge
 * Item's files, which show the item's Knowledge type, and for an
 * Auto-Doc template, which has none. */
export async function documentTypeModuleOf(
  tx: Executor,
  documentId: string,
): Promise<DocumentTypeModule | null> {
  const [owner] = await tx
    .select({
      contractId: documents.contractId,
      matterId: documents.matterId,
      entityId: documents.entityId,
    })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  if (!owner) return null;
  if (owner.contractId) return "contract";
  if (owner.matterId) return "matter";
  if (owner.entityId) return "entity";
  return null;
}

/**
 * Turns a choice into the two columns a Version stores (DOC-015).
 *
 * A type id must name a live row on the owner's own list; anything else
 * is refused, so a Matter round cannot borrow a Contract type. The row
 * is read `for share`, so an archive that races the write waits for it.
 *
 * A kind maps to the owner list's fixed row for it. With no such row,
 * an uploaded round becomes `general` with no type, which is how a
 * Matter upload from an older client stays neutral. A generated round
 * keeps its kind, because the kind records how it was made.
 */
export async function resolveDocumentType(
  tx: Executor,
  documentId: string,
  choice: DocumentTypeChoice,
  source: DocumentVersionSource = "uploaded",
): Promise<ResolvedDocumentType> {
  const module = await documentTypeModuleOf(tx, documentId);
  if ("documentTypeId" in choice) {
    if (choice.documentTypeId === null) {
      return { kind: "general", documentTypeId: null, displayName: null };
    }
    const [row] = module
      ? await tx
          .select({
            id: documentTypes.id,
            displayName: documentTypes.displayName,
            systemKind: documentTypes.systemKind,
          })
          .from(documentTypes)
          .where(
            and(
              eq(documentTypes.id, choice.documentTypeId),
              eq(documentTypes.module, module),
              isNull(documentTypes.archivedAt),
            ),
          )
          .limit(1)
          .for("share")
      : [];
    if (!row) throw httpError(400, "Pick a document type from this record's list.");
    return {
      kind: row.systemKind ?? "general",
      documentTypeId: row.id,
      displayName: row.displayName,
    };
  }
  const [row] =
    module && choice.kind !== "generated_redline" && choice.kind !== "general"
      ? await tx
          .select({ id: documentTypes.id, displayName: documentTypes.displayName })
          .from(documentTypes)
          .where(
            and(
              eq(documentTypes.module, module),
              eq(documentTypes.systemKind, choice.kind),
              isNull(documentTypes.archivedAt),
            ),
          )
          .limit(1)
      : [];
  if (row) return { kind: choice.kind, documentTypeId: row.id, displayName: row.displayName };
  return {
    kind: source === "uploaded" && choice.kind !== "generated_redline" ? "general" : choice.kind,
    documentTypeId: null,
    displayName: null,
  };
}

/**
 * Wakes the pipeline for whatever a freshly appended round is owed —
 * its text (DOC-005), or its display rendition (DOC-004).
 *
 * **One job per version, chosen by family.** A PDF's text is read
 * straight off the file, so it asks for extraction. A Word document and
 * a PowerPoint deck have to be converted before anything can read them,
 * so they ask for conversion — and the conversion job reads the
 * rendition's text at the end of its own work, which is why nothing
 * asks for both. Everything else asks for nothing.
 *
 * **Call it after the transaction has committed, never inside it.** A
 * rolled-back append asks for nothing, because there was no commit to
 * ask after; and a queue that cannot be reached — or one that hangs —
 * never fails the write and never holds it up, which is what
 * `boundedQueueAsk` is for. The refusal is logged, the `pending` rows
 * are already committed, and M12/6's sweep is what picks it up.
 */
export async function requestDerivations(
  jobs: JobQueue,
  log: QueueLogger,
  version: Readonly<{ versionId: string; mimeType: string; originalFilename: string }>,
): Promise<void> {
  const converts = needsDisplayRendition(version.mimeType, version.originalFilename);
  if (!converts && !extractsText(version.mimeType, version.originalFilename)) return;
  try {
    await boundedQueueAsk(
      converts
        ? jobs.requestDisplayConversion(version.versionId)
        : jobs.requestTextExtraction(version.versionId),
    );
  } catch (error) {
    log.error(
      { err: error, versionId: version.versionId },
      "could not ask the pipeline for a version's derivations",
    );
  }
}
