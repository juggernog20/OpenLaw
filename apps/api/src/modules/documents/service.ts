// SPDX-License-Identifier: AGPL-3.0-only
import { portalKnowledgeScope } from "../knowledge/service.js";

/**
 * Per-record Document lists and Version text reads enforce owning-record reach and the
 * Document audience (DOC-008, DD-014). Staff lists also enforce their role floor.
 */

import { NO_PERMISSION, type AuthenticatedUser } from "../../auth/guards.js";
import { z } from "zod";
import {
  and,
  asc,
  contracts,
  desc,
  documents,
  documentVersions,
  documentVersionText,
  eq,
  entities,
  inArray,
  isNotNull,
  isNull,
  autoDocs,
  knowledgeItems,
  matters,
  or,
  sql,
  users,
  type Executor,
  type SQL,
} from "@openlaw/db";
import { DOCUMENT_OWNER_KINDS, type DocumentOwner } from "@openlaw/shared";
import {
  contractTeamScope,
  documentAudienceScope,
  NO_CONTRACT,
  reachedContract,
} from "../../lib/contract-access.js";
import { matterTeamScope, NO_MATTER, reachedMatter } from "../../lib/matter-access.js";
import { entityReachScope, NO_ENTITY, reachedEntity } from "../../lib/entity-access.js";
import { httpError } from "../../lib/problem.js";
import { renderFamilyOf } from "../../lib/render-family.js";
import { folderOnRecord } from "./folders.js";
import { extractsText } from "../../pipeline/text-extraction.js";
import type { Db } from "@openlaw/db";

function assertReader(user: AuthenticatedUser): void {
  if (user.role !== "administrator" && user.role !== "legal_team_member")
    throw httpError(403, NO_PERMISSION);
}

/**
 * How many documents one read answers (CTR-024).
 *
 * Server-fixed, matching the contract list. It counts **documents**, not
 * versions: a document's chain rides with it whole, because a chain
 * split across two pages is not a negotiation history. A chain long
 * enough to matter on its own is a bound of its own, and this is not it.
 */
const PAGE_SIZE = 50;
/**
 * The listing context the record root is asked for by name (M13/3).
 *
 * A folder filter has three answers — every document on the record, the
 * documents in one folder, and the documents filed nowhere — and the
 * third has no id to be addressed by. So it is addressed by a word, and
 * the word is safe to reserve: every id in this API is a uuidv7, so no
 * folder can ever be called this.
 */

export const ROOT_FOLDER = "root";
/** A document on a contract this viewer cannot reach answers exactly as
 * `NO_CONTRACT` has the record itself answer. Its own id says nothing
 * about which record it belongs to, so a refusal here would be the leak
 * the 404 exists to prevent. */

export const NO_DOCUMENT = "No document exists with this reference.";
export function ownerReachScope(
  owner: DocumentOwner,
  db: Executor,
  user: AuthenticatedUser,
): SQL | undefined {
  switch (owner) {
    case "contract":
      return and(isNotNull(documents.contractId), contractTeamScope(db, user));
    case "matter":
      return and(isNotNull(documents.matterId), matterTeamScope(db, user));
    case "entity":
      return and(isNotNull(documents.entityId), entityReachScope(db, user));
    case "auto_doc":
      return and(
        isNotNull(documents.autoDocId),
        user.role === "administrator" || user.role === "legal_team_member" ? undefined : sql`false`,
      );
    case "knowledge_item":
      // No archived filter: archiving freezes a record, it does not
      // hide it. `assertLiveOwner` answers writes on an archived
      // item's paper with the 409 that names the cause, and reads
      // stay reachable — the same shape as the other three arms.
      return and(
        isNotNull(documents.knowledgeItemId),
        user.role === "administrator" || user.role === "legal_team_member" ? undefined : sql`false`,
      );
  }
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
      matterId: documents.matterId,
      entityId: documents.entityId,
      autoDocId: documents.autoDocId,
      knowledgeItemId: documents.knowledgeItemId,
      /** CTR-014's pin, read here so the chain below can mark the row
       * it names without a second query. */
      executedVersionId: documents.executedVersionId,
      /** DOC-010's soft delete, so the archived view can mark the rows
       * that are off the record's list rather than guess at them. */
      archivedAt: documents.archivedAt,
      /** DD-014's per-document flag, so a reader who is inside the
       * audience can see which file is narrowed. Only rows this
       * viewer already reaches get here. */
      isConfidential: documents.isConfidential,
      /** DOC-006's grouping, so the row says where it is filed rather
       * than leaving it to be inferred from which listing answered
       * it (M13/3). */
      folderId: documents.folderId,
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
  source: documentVersions.source,
  comparedFromVersionId: documentVersions.comparedFromVersionId,
  comparedToVersionId: documentVersions.comparedToVersionId,
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
export const selectVersions = (db: Executor) =>
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

function comparedVersionNumber(
  id: string | null,
  numbers: ReadonlyMap<string, number>,
): number | null {
  if (id === null) return null;
  const number = numbers.get(id);
  if (number === undefined) {
    throw new Error("A generated redline names an operand outside its document chain.");
  }
  return number;
}

export function toVersion(
  row: VersionRow,
  isCurrent: boolean,
  isExecuted: boolean,
  numbers: ReadonlyMap<string, number>,
) {
  return {
    id: row.id,
    versionNumber: row.versionNumber,
    kind: row.kind,
    source: row.source,
    comparedFromVersionNumber: comparedVersionNumber(row.comparedFromVersionId, numbers),
    comparedToVersionNumber: comparedVersionNumber(row.comparedToVersionId, numbers),
    note: row.note,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    renderFamily: renderFamilyOf(row.mimeType, row.originalFilename),
    byteSize: row.byteSize,
    checksumSha256: row.checksumSha256,
    uploadedBy: toPerson(row.uploadedBy),
    createdAt: row.createdAt.toISOString(),
    isCurrent,
    isExecuted,
  };
}

/**
 * One document with its chain, ordered 1..n, and both CTR-014
 * designations stated on it.
 *
 * The chain arrives in version order, so the current version is its
 * last row — that is what "current is the highest version number"
 * means (DOC-001). Current and executed are two different marks and
 * are computed from two different facts: the first from the ordering,
 * the second from the document's own `executed_version_id`. A chain
 * may carry both on one row, on two rows, or on neither.
 *
 * `primaryDocumentId` is the owning contract's column, passed in
 * rather than read here: it is one fact about the record, and reading
 * it once per document would ask the same question as many times as
 * the record has paper.
 */
function toDocument(
  row: DocumentRow,
  chain: readonly VersionRow[],
  primaryDocumentId: string | null,
) {
  const last = chain.length - 1;
  const numbers = new Map(chain.map((version) => [version.id, version.versionNumber]));
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    isPrimary: row.id === primaryDocumentId,
    versions: chain.map((version, index) =>
      toVersion(version, index === last, version.id === row.executedVersionId, numbers),
    ),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    isConfidential: row.isConfidential,
    folderId: row.folderId,
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
export async function documentWithChain(
  db: Executor,
  documentId: string,
  primaryDocumentId: string | null,
) {
  const [row] = await selectDocuments(db).where(eq(documents.id, documentId));
  const chain = (await chainsOf(db, [documentId])).get(documentId);
  // Both are written in one transaction, so neither can be missing
  // for a document this code just wrote or edited.
  return toDocument(row!, chain!, primaryDocumentId);
}

/**
 * All the paper on one contract, newest first, each document with its
 * whole chain.
 *
 * Shared by the list read, by the primary designation, and by the hard
 * delete — the three answers that are about the record's paper as a
 * whole rather than about one document. The designation changes two
 * rows at once, and an erasure can leave the record without an
 * instrument, so both answer the whole list and the caller replaces
 * what it holds rather than working out for itself which other row
 * moved.
 *
 * **Archived documents are left out unless they are asked for**
 * (DOC-010). That is the soft delete: the row is still there, the
 * chain is still there, and the blobs are still there — it is off the
 * list and out of the count until somebody restores it.
 *
 * **A confidential document this viewer is outside the audience of is
 * left out of every one of those answers** (DD-014), and there is no
 * query parameter that asks for it. The record's section count is
 * taken from this list, so a document left out here is out of the
 * count too — which is the whole of what "silently omitted, not shown
 * as a placeholder" means for a number.
 */
export async function paperOf(
  db: Executor,
  user: AuthenticatedUser,
  // The two facts a listing turns on, and no more: a caller that has
  // just written a document holds them without re-reading the record.
  owner: { id: string; primaryDocumentId: string | null },
  ownerType: DocumentOwner,
  includeArchived = false,
  cursor?: string,
  folder?: string,
) {
  let owningRecord: SQL;
  switch (ownerType) {
    case "contract":
      owningRecord = eq(documents.contractId, owner.id);
      break;
    case "matter":
      owningRecord = eq(documents.matterId, owner.id);
      break;
    case "entity":
      owningRecord = eq(documents.entityId, owner.id);
      break;
    case "auto_doc":
      owningRecord = eq(documents.autoDocId, owner.id);
      break;
    case "knowledge_item":
      owningRecord = eq(documents.knowledgeItemId, owner.id);
      break;
  }
  const scope = and(
    owningRecord,
    includeArchived ? undefined : isNull(documents.archivedAt),
    // The listing context (M13/3). Omitted is the record's whole
    // paper. It sits in the same WHERE clause as the audience scope
    // and for the same reason: the limit below has to cut rows that
    // are already in this listing, or a folder's page would be as
    // short as the documents from elsewhere that fell in the window.
    folder === undefined
      ? undefined
      : folder === ROOT_FOLDER
        ? isNull(documents.folderId)
        : eq(documents.folderId, folder),
    // The per-document audience is in the WHERE clause, so the limit
    // below cuts rows this viewer can already see. A read that limited
    // first and filtered after would answer pages that shrink by
    // however many walled documents sat in the window, and a page
    // length that varies with what is hidden is the existence leak
    // DD-014 exists to close (CTR-024).
    documentAudienceScope(db, user),
  );
  const rows = await selectDocuments(db)
    .where(and(scope, cursor === undefined ? undefined : olderThan(cursor, scope)))
    // Newest first, as the record's Documents section reads. The id
    // breaks a same-instant tie: uuidv7 is time-ordered, so that
    // order is still the upload order.
    .orderBy(desc(documents.createdAt), desc(documents.id))
    // One past the page, which is how the answer knows whether there
    // is more without counting anything.
    .limit(PAGE_SIZE + 1);
  const page = rows.slice(0, PAGE_SIZE);
  const chains = await chainsOf(
    db,
    page.map((row) => row.id),
  );
  return {
    documents: page.flatMap((row) => {
      const chain = chains.get(row.id);
      return chain ? [toDocument(row, chain, owner.primaryDocumentId)] : [];
    }),
    // Only when a further row was actually read. A cursor on the last
    // page would send the client for an empty one.
    nextCursor: rows.length > PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
  };
}

/**
 * The keyset boundary: every document strictly older than one of them,
 * in the order the section reads (CTR-024).
 *
 * The boundary's own position is read from the table rather than taken
 * from the client, and it is read **under the same scope the page is
 * read under** — the contract, the archived filter, and DD-014's
 * per-document audience. A cursor naming a walled document this viewer
 * is outside resolves to NULL and answers an empty page, so a cursor
 * cannot confirm that a document they were told nothing about is
 * there.
 */
function olderThan(documentId: string, scope: SQL | undefined): SQL {
  return sql`(${documents.createdAt}, ${documents.id}) < (
    select ${documents.createdAt}, ${documents.id}
    from ${documents}
    where ${and(eq(documents.id, documentId), scope)}
  )`;
}

/** One stored version, as the two byte reads need it described. */
export interface ReachedVersion {
  fileRef: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
}

/**
 * One version this viewer reaches, by its own id and its document's,
 * or a 404.
 *
 * Shared by the download, the preview, and the extracted-text read,
 * because they ask one question and must not drift into three
 * answers. Document, owning
 * contract, and both scopes ride in one read: a version on a contract
 * the viewer cannot reach, and a version of a confidential document
 * they are outside the audience of, are each answered exactly as one
 * that was never uploaded (DOC-008, DD-014). Rendering opens no side
 * door past the contract gate.
 */
export async function reachedVersion(
  db: Executor,
  user: AuthenticatedUser,
  params: Readonly<{ documentId: string; versionId: string }>,
): Promise<ReachedVersion> {
  if (user.role === "business_user") {
    const [knowledgeOwned] = await db
      .select({ id: documentVersions.id })
      .from(documentVersions)
      .innerJoin(documents, eq(documentVersions.documentId, documents.id))
      .where(
        and(
          eq(documentVersions.id, params.versionId),
          eq(documentVersions.documentId, params.documentId),
          isNotNull(documents.knowledgeItemId),
        ),
      )
      .limit(1);
    if (knowledgeOwned) throw httpError(403, "Knowledge Documents require a Legal Team Member.");
  }
  const [row] = await db
    .select({
      fileRef: documentVersions.fileRef,
      originalFilename: documentVersions.originalFilename,
      mimeType: documentVersions.mimeType,
      byteSize: documentVersions.byteSize,
    })
    .from(documentVersions)
    .innerJoin(documents, eq(documentVersions.documentId, documents.id))
    .leftJoin(contracts, eq(documents.contractId, contracts.id))
    .leftJoin(matters, eq(documents.matterId, matters.id))
    .leftJoin(entities, eq(documents.entityId, entities.id))
    .leftJoin(knowledgeItems, eq(documents.knowledgeItemId, knowledgeItems.id))
    .leftJoin(autoDocs, eq(documents.autoDocId, autoDocs.id))
    .where(
      and(
        eq(documentVersions.id, params.versionId),
        eq(documentVersions.documentId, params.documentId),
        or(...DOCUMENT_OWNER_KINDS.map((owner) => ownerReachScope(owner, db, user))),
        documentAudienceScope(db, user),
        user.role === "business_user"
          ? and(
              isNull(documents.archivedAt),
              or(isNotNull(documents.contractId), isNotNull(documents.matterId)),
            )
          : undefined,
      ),
    )
    .limit(1);
  if (!row) throw httpError(404, NO_DOCUMENT);
  return row;
}

export const DocumentListQuery = z.object({
  includeArchived: z.enum(["true", "false"]).optional(),
  cursor: z.string().min(1).max(64).optional(),
  folder: z.string().min(1).max(64).optional(),
});
export async function listAutoDocDocuments(
  db: Db,
  user: AuthenticatedUser,
  id: string,
  query: { cursor?: string } = {},
) {
  assertReader(user);
  const [row] = await db.select({ id: autoDocs.id }).from(autoDocs).where(eq(autoDocs.id, id));
  if (!row) throw httpError(404, "No Auto-Doc exists with this id.");
  return paperOf(
    db,
    user,
    { id: row.id, primaryDocumentId: null },
    "auto_doc",
    false,
    query.cursor,
  );
}
/** A Knowledge Item's paper has no folder listing, so the read takes
 * none: a caller that passed one would otherwise have it dropped
 * without a word. */
const KnowledgeDocumentListQuery = DocumentListQuery.omit({ folder: true });
export async function listKnowledgeItemDocuments(
  db: Db,
  user: AuthenticatedUser,
  id: string,
  input: z.input<typeof KnowledgeDocumentListQuery> = {},
) {
  assertReader(user);
  const query = KnowledgeDocumentListQuery.parse(input);
  const [item] = await db
    .select({
      id: knowledgeItems.id,
      primaryDocumentId: knowledgeItems.primaryDocumentId,
    })
    .from(knowledgeItems)
    .where(eq(knowledgeItems.id, id))
    .limit(1);
  // An archived item still reads, as an archived contract does
  // (#776). Archiving is a soft delete, the record read already
  // answers an archived item, and restore is offered on the page
  // this list feeds, so a 404 here only broke the way back. Writes
  // stay frozen, because every document write asserts a live
  // owner, and the portal gate is untouched.
  if (!item) throw httpError(404, "No Knowledge Item exists with this id.");
  return paperOf(db, user, item, "knowledge_item", query.includeArchived === "true", query.cursor);
}
export async function listContractDocuments(
  db: Db,
  user: AuthenticatedUser,
  number: number,
  input: z.input<typeof DocumentListQuery> = {},
) {
  assertReader(user);
  const query = DocumentListQuery.parse(input);
  const contract = await reachedContract(db, user, number);
  if (!contract) throw httpError(404, NO_CONTRACT);
  const { folder } = query;
  // A folder is addressed by its own id, which says nothing about
  // which record it is on — so it is checked against this contract
  // before it is filtered on. Skipping the check would make the
  // list route a way to ask whether a folder id exists somewhere.
  if (folder !== undefined && folder !== ROOT_FOLDER) {
    await folderOnRecord(db, contract.id, folder);
  }
  // An archived record still reads: archiving is a soft delete for
  // mistakes and imports, and restore has to be reachable.
  return await paperOf(
    db,
    user,
    contract,
    "contract",
    query.includeArchived === "true",
    query.cursor,
    folder,
  );
}
export async function listMatterDocuments(
  db: Db,
  user: AuthenticatedUser,
  number: number,
  input: z.input<typeof DocumentListQuery> = {},
) {
  assertReader(user);
  const query = DocumentListQuery.parse(input);
  const matter = await reachedMatter(db, user, number);
  if (!matter) throw httpError(404, NO_MATTER);
  const { folder } = query;
  if (folder !== undefined && folder !== ROOT_FOLDER) {
    await folderOnRecord(db, { kind: "matter", value: matter.id }, folder);
  }
  return paperOf(
    db,
    user,
    { id: matter.id, primaryDocumentId: null },
    "matter",
    query.includeArchived === "true",
    query.cursor,
    folder,
  );
}
export async function listEntityDocuments(
  db: Db,
  user: AuthenticatedUser,
  id: string,
  input: z.input<typeof DocumentListQuery> = {},
) {
  assertReader(user);
  const query = DocumentListQuery.parse(input);
  const entity = await reachedEntity(db, user, id);
  if (!entity) throw httpError(404, NO_ENTITY);
  const { folder } = query;
  const owner = { kind: "entity", value: entity.id } as const;
  if (folder !== undefined && folder !== ROOT_FOLDER) {
    await folderOnRecord(db, owner, folder);
  }
  return paperOf(
    db,
    user,
    { id: entity.id, primaryDocumentId: null },
    "entity",
    query.includeArchived === "true",
    query.cursor,
    folder,
  );
}
export async function readDocumentVersionText(
  db: Db,
  user: AuthenticatedUser,
  params: Readonly<{ documentId: string; versionId: string }>,
) {
  // The same read the preview and the download make, so the three
  // cannot drift into three answers. A version this viewer cannot
  // reach is a 404 from here, before anything is said about text.
  const version = await reachedVersion(db, user, params);

  return storedVersionText(db, params.versionId, version);
}

async function storedVersionText(db: Db, versionId: string, version: ReachedVersion) {
  const [row] = await db
    .select({
      state: documentVersionText.state,
      source: documentVersionText.source,
      text: documentVersionText.text,
      updatedAt: documentVersionText.updatedAt,
    })
    .from(documentVersionText)
    .where(eq(documentVersionText.versionId, versionId))
    .limit(1);

  if (!row) {
    // No derivation, for one of two reasons. Either this file has no
    // text to read — an image, a spreadsheet — or it predates the
    // pipeline and M12/6's sweep has not reached it yet. The first
    // is the honest answer for a reader; the second reads as pending
    // because that is what it is.
    return {
      text: {
        state: extractsText(version.mimeType, version.originalFilename)
          ? ("pending" as const)
          : ("unsupported" as const),
        source: null,
        text: null,
        updatedAt: null,
      },
    };
  }

  return {
    text: {
      state: row.state,
      source: row.source,
      text: row.text,
      updatedAt: row.updatedAt.toISOString(),
    },
  };
}

/** The Portal article exposes only the current Version of its readable Documents. */
export async function readPortalKnowledgeVersionText(
  db: Db,
  user: AuthenticatedUser,
  params: { documentId: string; versionId: string },
) {
  const [version] = await db
    .select({
      fileRef: documentVersions.fileRef,
      originalFilename: documentVersions.originalFilename,
      mimeType: documentVersions.mimeType,
      byteSize: documentVersions.byteSize,
    })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .innerJoin(knowledgeItems, eq(knowledgeItems.id, documents.knowledgeItemId))
    .where(
      and(
        eq(documents.id, params.documentId),
        eq(documentVersions.id, params.versionId),
        isNull(documents.archivedAt),
        documentAudienceScope(db, user),
        portalKnowledgeScope(db, user),
        sql`${documentVersions.versionNumber} = (select max(v.version_number) from document_versions v where v.document_id = ${documents.id})`,
      ),
    )
    .limit(1);
  if (!version) throw httpError(404, NO_DOCUMENT);
  return storedVersionText(db, params.versionId, version);
}
