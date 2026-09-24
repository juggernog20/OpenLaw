// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Completes an upload on each owning record: the reached owner is checked, the
 * stored bytes become a Document or a Version on its chain (DOC-001), and the
 * activity row is written in the same transaction. Bulk drops call this once per
 * file (DOC-011); the bytes arrive through the storage adapter's `file_ref`
 * (DOC-012). Routes and the MCP register share these functions.
 */

import {
  and,
  autoDocs,
  contracts,
  documentFolders,
  documents,
  entities,
  eq,
  isNotNull,
  knowledgeItems,
  matters,
  or,
  type Executor,
  type Transaction,
} from "@openlaw/db";
import {
  DOCUMENT_OWNER_KINDS,
  resolveDocumentOwner,
  type DocumentOwner,
  type ResolvedDocumentOwner,
} from "@openlaw/shared";
import type { AppDeps } from "../../app.js";
import { type AuthenticatedUser } from "../../auth/guards.js";
import { RECORD_ACTIVITY_TIER, recordActivity } from "../../lib/activity.js";
import {
  documentAudienceScope,
  NO_CONTRACT,
  reachedContract,
  type ReachedContract,
} from "../../lib/contract-access.js";
import {
  insertDocumentVersion,
  nextVersionNumber,
  resolveDocumentType,
  type DocumentTypeChoice,
} from "../../lib/document-versions.js";
import { NO_ENTITY, reachedEntity } from "../../lib/entity-access.js";
import { NO_MATTER, reachedMatter } from "../../lib/matter-access.js";
import { httpError } from "../../lib/problem.js";
import { applyTemplateVersion, detectStoredTemplate } from "../auto-docs/forms.js";
import { findOrCreateFolderPath, type FolderDestination } from "./folders.js";
import { documentWithChain, NO_DOCUMENT, ownerReachScope } from "./service.js";
type UploadDeps = Pick<AppDeps, "db" | "notifier" | "storage"> & { maxUploadBytes: number };
export function ownerValues(owner: ResolvedDocumentOwner<string>) {
  switch (owner.kind) {
    case "contract":
      return { contractId: owner.value } as const;
    case "matter":
      return { matterId: owner.value } as const;
    case "entity":
      return { entityId: owner.value } as const;
    case "auto_doc":
      return { autoDocId: owner.value } as const;
    case "knowledge_item":
      return { knowledgeItemId: owner.value } as const;
  }
}
export interface ReachedDocument {
  id: string;
  title: string;
  description: string | null;
  contractId: string | null;
  matterId: string | null;
  entityId: string | null;
  autoDocId: string | null;
  knowledgeItemId: string | null;
  owner: ResolvedDocumentOwner<string>;
  /** The owning contract's SET-003 soft delete (CTR-021). */
  ownerArchivedAt: Date | null;
  /** This document's own DOC-010 soft delete, which is a different
   * fact from the contract's above: one hides a file, the other
   * freezes the whole record. */
  archivedAt: Date | null;
  /** Which version of *this* document is pinned as signed, or NULL
   * (CTR-014). */
  executedVersionId: string | null;
  /** Which document the owning contract calls its instrument, which
   * may be this one or another (CTR-014). */
  primaryDocumentId: string | null;
  /** DD-014's per-document flag, as it stands on this row. */
  isConfidential: boolean;
  /** Which folder on the owning record this document is filed in, or
   * NULL at the record root (DOC-006). */
  folderId: string | null;
  /** That folder's name, or NULL when the document sits at the record
   * root. Read here so a filing's activity entry can name the folder
   * the document came out of — an id would not draw a sentence once
   * the folder is renamed or gone. */
  folderName: string | null;
  /** Who uploaded it — one of the three actors who may decide its
   * audience (DD-014, CTR-022). */
  createdBy: string;
  /** The owning contract's Owner (CTR-004), who is another. */
  ownerManagerId: string | null;
  /** The owning record's own identity, carried by the comparison read
   * so its full-page breadcrumb and close control need no polymorphic
   * follow-up request. */
  ownerNumber: number | null;
  ownerTitle: string;
}
export async function reachedDocument(
  db: Executor,
  user: AuthenticatedUser,
  documentId: string,
  lock = false,
): Promise<ReachedDocument | null> {
  if (user.role === "business_user") {
    const [knowledgeOwned] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, documentId), isNotNull(documents.knowledgeItemId)))
      .limit(1);
    if (knowledgeOwned) throw httpError(403, "Knowledge Documents require a Legal Team Member.");
  }
  const query = db
    .select({
      id: documents.id,
      title: documents.title,
      description: documents.description,
      contractId: documents.contractId,
      matterId: documents.matterId,
      entityId: documents.entityId,
      autoDocId: documents.autoDocId,
      knowledgeItemId: documents.knowledgeItemId,
      contractArchivedAt: contracts.archivedAt,
      matterArchivedAt: matters.archivedAt,
      entityArchivedAt: entities.archivedAt,
      autoDocArchivedAt: autoDocs.archivedAt,
      knowledgeItemArchivedAt: knowledgeItems.archivedAt,
      archivedAt: documents.archivedAt,
      executedVersionId: documents.executedVersionId,
      contractPrimaryDocumentId: contracts.primaryDocumentId,
      knowledgePrimaryDocumentId: knowledgeItems.primaryDocumentId,
      isConfidential: documents.isConfidential,
      folderId: documents.folderId,
      folderName: documentFolders.name,
      createdBy: documents.createdBy,
      contractManagerId: contracts.managerId,
      matterManagerId: matters.managerId,
      contractNumber: contracts.number,
      contractTitle: contracts.title,
      matterNumber: matters.number,
      matterTitle: matters.title,
      entityTitle: entities.legalName,
      autoDocTitle: autoDocs.name,
      knowledgeItemTitle: knowledgeItems.title,
    })
    .from(documents)
    .leftJoin(contracts, eq(documents.contractId, contracts.id))
    .leftJoin(matters, eq(documents.matterId, matters.id))
    .leftJoin(entities, eq(documents.entityId, entities.id))
    .leftJoin(knowledgeItems, eq(documents.knowledgeItemId, knowledgeItems.id))
    .leftJoin(autoDocs, eq(documents.autoDocId, autoDocs.id))
    // Left, because most documents sit at the record root and an inner
    // join would answer none of them.
    .leftJoin(documentFolders, eq(documents.folderId, documentFolders.id))
    .where(
      and(
        eq(documents.id, documentId),
        or(...DOCUMENT_OWNER_KINDS.map((owner) => ownerReachScope(owner, db, user))),
        documentAudienceScope(db, user),
      ),
    )
    .limit(1);
  let [row] = await query;
  if (!row) return null;
  if (lock) {
    const owner = resolveDocumentOwner({
      contract: row.contractId,
      matter: row.matterId,
      entity: row.entityId,
      auto_doc: row.autoDocId,
      knowledge_item: row.knowledgeItemId,
    });
    switch (owner.kind) {
      case "contract":
        await db
          .select({ id: contracts.id })
          .from(contracts)
          .where(eq(contracts.id, owner.value))
          .for("update", { of: contracts });
        break;
      case "matter":
        await db
          .select({ id: matters.id })
          .from(matters)
          .where(eq(matters.id, owner.value))
          .for("update", { of: matters });
        break;
      case "entity":
        await db
          .select({ id: entities.id })
          .from(entities)
          .where(eq(entities.id, owner.value))
          .for("update", { of: entities });
        break;
      case "auto_doc":
        await db
          .select({ id: autoDocs.id })
          .from(autoDocs)
          .where(eq(autoDocs.id, owner.value))
          .for("update", { of: autoDocs });
        break;
      case "knowledge_item":
        await db
          .select({ id: knowledgeItems.id })
          .from(knowledgeItems)
          .where(eq(knowledgeItems.id, owner.value))
          .for("update", { of: knowledgeItems });
        break;
    }
    [row] = await query;
    if (!row) return null;
  }
  const owner = resolveDocumentOwner({
    contract: row.contractId,
    matter: row.matterId,
    entity: row.entityId,
    auto_doc: row.autoDocId,
    knowledge_item: row.knowledgeItemId,
  });
  let ownerArchivedAt: Date | null;
  let primaryDocumentId: string | null;
  let ownerManagerId: string | null;
  let ownerNumber: number | null;
  let ownerTitle: string;
  switch (owner.kind) {
    case "contract":
      ownerArchivedAt = row.contractArchivedAt;
      primaryDocumentId = row.contractPrimaryDocumentId;
      ownerManagerId = row.contractManagerId;
      ownerNumber = row.contractNumber;
      ownerTitle = row.contractTitle!;
      break;
    case "matter":
      ownerArchivedAt = row.matterArchivedAt;
      primaryDocumentId = null;
      ownerManagerId = row.matterManagerId;
      ownerNumber = row.matterNumber;
      ownerTitle = row.matterTitle!;
      break;
    case "entity":
      ownerArchivedAt = row.entityArchivedAt;
      primaryDocumentId = null;
      ownerManagerId = null;
      ownerNumber = null;
      ownerTitle = row.entityTitle!;
      break;
    case "auto_doc":
      ownerArchivedAt = row.autoDocArchivedAt;
      primaryDocumentId = null;
      ownerManagerId = null;
      ownerNumber = null;
      ownerTitle = row.autoDocTitle!;
      break;
    case "knowledge_item":
      ownerArchivedAt = row.knowledgeItemArchivedAt;
      primaryDocumentId = row.knowledgePrimaryDocumentId;
      ownerManagerId = null;
      ownerNumber = null;
      ownerTitle = row.knowledgeItemTitle!;
      break;
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    contractId: row.contractId,
    matterId: row.matterId,
    entityId: row.entityId,
    autoDocId: row.autoDocId,
    knowledgeItemId: row.knowledgeItemId,
    owner,
    ownerArchivedAt,
    archivedAt: row.archivedAt,
    executedVersionId: row.executedVersionId,
    primaryDocumentId,
    isConfidential: row.isConfidential,
    folderId: row.folderId,
    folderName: row.folderName,
    createdBy: row.createdBy,
    ownerManagerId,
    ownerNumber,
    ownerTitle,
  };
}
export interface StoredUpload {
  filename: string;
  mimeType: string;
  /** What the uploader called the round (DOC-015), resolved against
   * the owner's list when the row is written. */
  typeChoice: DocumentTypeChoice;
  note: string | null;
  /**
   * Where the file is to be filed (DOC-006, DOC-011), or null for the
   * record root.
   *
   * Read off the form and checked for shape here, before a byte is
   * stored; the folder itself is resolved under the contract's row
   * lock in the handler, because that is where it can be created
   * without two racing uploads making two of it.
   */
  destination: FolderDestination | null;
  fileRef: string;
  byteSize: number;
  checksumSha256: string;
}
/** One row in the chain, written from what arrived. The write itself
 * is `lib/document-versions.ts` — shared with the signing
 * integration's executed-copy append (M15/5), because a round filed
 * by a person and a round filed by the integration are the same row
 * (DOC-001). This is only the upload's half of the translation. Answers
 * the resolved type (DOC-015) so the caller can name the kind it wrote. */
export async function insertVersion(
  tx: Transaction,
  row: Readonly<{
    documentId: string;
    versionId: string;
    versionNumber: number;
    file: StoredUpload;
    by: AuthenticatedUser;
  }>,
) {
  const typed = await resolveDocumentType(tx, row.documentId, row.file.typeChoice);
  await insertDocumentVersion(tx, {
    documentId: row.documentId,
    versionId: row.versionId,
    versionNumber: row.versionNumber,
    fileRef: row.file.fileRef,
    kind: typed.kind,
    documentTypeId: typed.documentTypeId,
    source: "uploaded",
    comparedFromVersionId: null,
    comparedToVersionId: null,
    note: row.file.note,
    originalFilename: row.file.filename,
    mimeType: row.file.mimeType,
    byteSize: row.file.byteSize,
    checksumSha256: row.file.checksumSha256,
    createdBy: row.by.id,
  });
  return typed;
}
export function assertOpen<T extends ReachedContract>(contract: T | null): asserts contract is T {
  if (!contract) throw httpError(404, NO_CONTRACT);
  if (contract.archivedAt) {
    throw httpError(409, "This contract is archived. Restore it before uploading.");
  }
}
export function assertOpenMatter<T extends Awaited<ReturnType<typeof reachedMatter>>>(
  matter: T | null,
): asserts matter is T {
  if (!matter) throw httpError(404, NO_MATTER);
  if (matter.archivedAt) {
    throw httpError(409, "This matter is archived. Restore it before uploading.");
  }
}
export function assertOpenEntity<T extends Awaited<ReturnType<typeof reachedEntity>>>(
  entity: T | null,
): asserts entity is T {
  if (!entity) throw httpError(404, NO_ENTITY);
  if (entity.archivedAt) {
    throw httpError(409, "This Entity is archived. Restore it before uploading.");
  }
}
export function assertOpenDocument(
  document: ReachedDocument | null,
): asserts document is ReachedDocument {
  assertReachedDocument(document);
  assertLiveOwner(document);
  if (document.archivedAt) {
    throw httpError(409, "This document is archived. Restore it before changing it.");
  }
}
export function ownerCopy(owner: DocumentOwner): { manager: string | null; noun: string } {
  switch (owner) {
    case "contract":
      return { manager: "contract's Owner", noun: "contract" };
    case "matter":
      return { manager: "Matter Manager", noun: "matter" };
    case "entity":
      return { manager: null, noun: "Entity" };
    case "auto_doc":
      return { manager: null, noun: "Auto-Doc" };
    case "knowledge_item":
      return { manager: null, noun: "Knowledge item" };
  }
}
export function assertReachedDocument(
  document: ReachedDocument | null,
): asserts document is ReachedDocument {
  if (!document) throw httpError(404, NO_DOCUMENT);
}
export function assertLiveOwner(document: ReachedDocument): void {
  if (document.ownerArchivedAt) {
    const noun = ownerCopy(document.owner.kind).noun;
    throw httpError(409, `This ${noun} is archived. Restore it before changing its paper.`);
  }
}
export async function completeContractUpload(
  app: UploadDeps,
  user: AuthenticatedUser,
  number: number,
  documentId: string,
  versionId: string,
  file: StoredUpload,
) {
  return app.notifier.notifying(async (tx) => {
    // The contract row is held for the write, and reach is asked
    // again on the same snapshot: a team row dropped between the
    // first check and the insert must not leave a file on a record
    // the uploader no longer reaches.
    const locked = await reachedContract(tx, user, number, {
      lock: true,
    });
    assertOpen(locked);
    const owner = resolveDocumentOwner({
      contract: locked.id,
      matter: null,
      entity: null,
      auto_doc: null,
      knowledge_item: null,
    });

    // Under that same lock, which is what makes a folder drop
    // converge (DOC-011): a chain the form named is found or made
    // segment by segment, and a second upload racing on the same
    // path waits here and then finds what the first one wrote.
    const folder = file.destination
      ? await findOrCreateFolderPath(tx, locked, file.destination)
      : null;

    await tx.insert(documents).values({
      id: documentId,
      folderId: folder?.id ?? null,
      // Seeded from the filename: the record has to be called
      // something, and what the uploader recognises is the name
      // they chose on their own machine. It is renameable from
      // there (DOC-007), and renaming leaves the file's own name
      // alone.
      title: file.filename,
      ...ownerValues(owner),
      createdBy: user.id,
    });
    await insertVersion(tx, {
      documentId,
      versionId,
      versionNumber: 1,
      file,
      by: user,
    });
    // On the owning contract, at the tier every record action rides
    // (DD-017). The title is in the payload on purpose: hard
    // deletion (DOC-010) removes the rows, and the entry has to
    // still name what was deleted.
    await recordActivity(tx, {
      entityType: owner.kind,
      entityId: owner.value,
      actorId: user.id,
      action: "document.created",
      visibility: RECORD_ACTIVITY_TIER,
      // The destination rides in the payload **by name** (DD-017),
      // beside the title and for the same reason: this entry is the
      // drop's whole story — a folder it find-or-created wrote none
      // of its own — and it has to still say where the file landed
      // after that folder is renamed or dissolved.
      payload: {
        documentId,
        versionId,
        title: file.filename,
        folderName: folder?.name ?? null,
        ...(user.role === "business_user" ? { actorRole: "business_user" as const } : {}),
      },
    });

    // The first Member+ upload on a record with no instrument takes
    // the designation (CTR-014). A Contributor's paper is supporting
    // by definition, including when the record has no instrument yet.
    // The next Member+ upload may then take the still-empty pin.
    // The first document on a record is otherwise the instrument.
    // Nobody asked for it, which is exactly why it gets its own
    // entry rather than being left implied by the upload above — the
    // counterparty promotion is logged for the same reason, and a
    // record born confidential is too. The contract row is held, so
    // two first uploads at once cannot both read NULL here.
    const primaryDocumentId =
      locked.primaryDocumentId ?? (user.role === "business_user" ? null : documentId);
    if (locked.primaryDocumentId === null && user.role !== "business_user") {
      await tx
        .update(contracts)
        .set({ primaryDocumentId: documentId })
        .where(eq(contracts.id, locked.id));
      await recordActivity(tx, {
        entityType: "contract",
        entityId: locked.id,
        actorId: user.id,
        action: "document.primary_set",
        visibility: RECORD_ACTIVITY_TIER,
        // `from`/`to` as the counterparty promotion writes them, so
        // the M9 viewer narrates the move with one shared helper. The
        // first upload takes the designation from nobody.
        payload: {
          documentId,
          title: file.filename,
          fromDocumentId: null,
          from: null,
          to: file.filename,
        },
      });
    }

    // The team hears that the paper moved (NOT-002 group 2): bell
    // on, no email owed under the default. A document is born with
    // the flag clear, so this one always goes as far as the record
    // does — the flag is asked anyway, because the rule belongs to
    // the event rather than to what today's write path happens to
    // set.
    await app.notifier.documentAdded(tx, {
      contractId: locked.id,
      actorId: user.id,
      actorName: user.displayName,
      documentId,
      documentTitle: file.filename,
      isConfidential: false,
    });

    // Read back through the list's own projection, so the row the
    // uploader gets is the row the next load will draw.
    return documentWithChain(tx, documentId, primaryDocumentId);
  });
}
export async function completeMatterUpload(
  app: UploadDeps,
  user: AuthenticatedUser,
  number: number,
  documentId: string,
  versionId: string,
  file: StoredUpload,
) {
  return app.db.transaction(async (tx) => {
    const locked = await reachedMatter(tx, user, number, {
      lock: true,
    });
    assertOpenMatter(locked);
    const owner = resolveDocumentOwner({
      contract: null,
      matter: locked.id,
      entity: null,
      auto_doc: null,
      knowledge_item: null,
    });
    const folder = file.destination
      ? await findOrCreateFolderPath(tx, locked, file.destination)
      : null;

    await tx.insert(documents).values({
      id: documentId,
      folderId: folder?.id ?? null,
      title: file.filename,
      ...ownerValues(owner),
      createdBy: user.id,
    });
    await insertVersion(tx, {
      documentId,
      versionId,
      versionNumber: 1,
      file,
      by: user,
    });
    await recordActivity(tx, {
      entityType: owner.kind,
      entityId: owner.value,
      actorId: user.id,
      action: "document.created",
      visibility: RECORD_ACTIVITY_TIER,
      payload: {
        documentId,
        versionId,
        title: file.filename,
        folderName: folder?.name ?? null,
        ...(user.role === "business_user" ? { actorRole: "business_user" as const } : {}),
      },
    });
    return documentWithChain(tx, documentId, null);
  });
}
export async function completeEntityUpload(
  app: UploadDeps,
  user: AuthenticatedUser,
  id: string,
  documentId: string,
  versionId: string,
  file: StoredUpload,
) {
  return app.db.transaction(async (tx) => {
    const locked = await reachedEntity(tx, user, id, { lock: true });
    assertOpenEntity(locked);
    const owner = resolveDocumentOwner({
      contract: null,
      matter: null,
      entity: locked.id,
      auto_doc: null,
      knowledge_item: null,
    });
    const folder = file.destination
      ? await findOrCreateFolderPath(tx, locked, file.destination)
      : null;
    await tx.insert(documents).values({
      id: documentId,
      folderId: folder?.id ?? null,
      title: file.filename,
      ...ownerValues(owner),
      createdBy: user.id,
    });
    await insertVersion(tx, {
      documentId,
      versionId,
      versionNumber: 1,
      file,
      by: user,
    });
    await recordActivity(tx, {
      entityType: "entity",
      entityId: locked.id,
      actorId: user.id,
      action: "document.created",
      visibility: RECORD_ACTIVITY_TIER,
      payload: {
        documentId,
        versionId,
        title: file.filename,
        folderName: folder?.name ?? null,
      },
    });
    return documentWithChain(tx, documentId, null);
  });
}
export async function completeKnowledgeUpload(
  app: UploadDeps,
  user: AuthenticatedUser,
  id: string,
  documentId: string,
  versionId: string,
  file: StoredUpload,
) {
  return app.db.transaction(async (tx) => {
    const [item] = await tx
      .select({
        id: knowledgeItems.id,
        primaryDocumentId: knowledgeItems.primaryDocumentId,
        archivedAt: knowledgeItems.archivedAt,
      })
      .from(knowledgeItems)
      .where(eq(knowledgeItems.id, id))
      .limit(1)
      .for("update");
    if (!item) throw httpError(404, "No Knowledge Item exists with this id.");
    if (item.archivedAt) {
      throw httpError(409, "Restore this Knowledge Item before adding Documents.");
    }
    await tx.insert(documents).values({
      id: documentId,
      knowledgeItemId: item.id,
      title: file.filename,
      createdBy: user.id,
    });
    await insertVersion(tx, {
      documentId,
      versionId,
      versionNumber: 1,
      file,
      by: user,
    });
    await recordActivity(tx, {
      entityType: "knowledge_item",
      entityId: item.id,
      actorId: user.id,
      action: "document.created",
      visibility: RECORD_ACTIVITY_TIER,
      payload: { documentId, versionId, title: file.filename, folderName: null },
    });
    const primaryDocumentId = item.primaryDocumentId ?? documentId;
    if (item.primaryDocumentId === null) {
      await tx
        .update(knowledgeItems)
        .set({ primaryDocumentId: documentId, updatedBy: user.id })
        .where(eq(knowledgeItems.id, item.id));
      await recordActivity(tx, {
        entityType: "knowledge_item",
        entityId: item.id,
        actorId: user.id,
        action: "document.primary_set",
        visibility: RECORD_ACTIVITY_TIER,
        payload: {
          documentId,
          title: file.filename,
          fromDocumentId: null,
          from: null,
          to: file.filename,
        },
      });
    }
    return documentWithChain(tx, documentId, primaryDocumentId);
  });
}
export async function completeVersionUpload(
  app: UploadDeps,
  user: AuthenticatedUser,
  documentId: string,
  versionId: string,
  file: StoredUpload,
) {
  const reached = await reachedDocument(app.db, user, documentId);
  assertOpenDocument(reached);
  const detection = reached.autoDocId
    ? await detectStoredTemplate(app.storage, file.fileRef, file.filename, app.maxUploadBytes)
    : null;
  return app.notifier.notifying(async (tx) => {
    // The owning contract's row is held here, and this is the lock
    // the version number is assigned under: two uploaders reading
    // the chain's high-water mark at the same moment would both see
    // the same number, so the second one waits here until the first
    // has committed its row and then reads the number it wrote.
    const locked = await reachedDocument(tx, user, documentId, true);
    assertOpenDocument(locked);

    const versionNumber = await nextVersionNumber(tx, documentId);

    const typed = await insertVersion(tx, { documentId, versionId, versionNumber, file, by: user });
    // The document's own row is touched so that "when did this
    // document last change" answers with the new round rather than
    // with the day it was created.
    await tx.update(documents).set({ updatedAt: new Date() }).where(eq(documents.id, documentId));
    if (locked.autoDocId && detection) {
      await applyTemplateVersion(tx, {
        autoDocId: locked.autoDocId,
        name: locked.ownerTitle,
        actorId: user.id,
        documentId,
        versionId,
        versionNumber,
        detection,
      });
    } else
      await recordActivity(tx, {
        entityType: locked.owner.kind,
        entityId: locked.owner.value,
        actorId: user.id,
        action: "document.version_added",
        visibility: RECORD_ACTIVITY_TIER,
        payload: {
          documentId,
          versionId,
          title: locked.title,
          versionNumber,
          kind: typed.kind,
          ...(user.role === "business_user" ? { actorRole: "business_user" as const } : {}),
        },
      });
    // The team hears that the paper moved (NOT-002 group 2). This is
    // the door where the document flag bites: a round appended to a
    // confidential document goes exactly as far as that document
    // does (DD-014, DOC-008).
    if (locked.contractId) {
      await app.notifier.documentVersionAdded(tx, {
        contractId: locked.contractId,
        actorId: user.id,
        actorName: user.displayName,
        documentId,
        documentTitle: locked.title,
        isConfidential: locked.isConfidential,
        versionId,
        versionNumber,
      });
    }
    return documentWithChain(tx, documentId, locked.primaryDocumentId);
  });
}
