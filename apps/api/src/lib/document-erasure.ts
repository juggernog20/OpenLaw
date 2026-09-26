// SPDX-License-Identifier: AGPL-3.0-only

/** DOC-010 and ADO-012: lock derivation inputs before collecting every blob the erasure must remove. */
import {
  asc,
  and,
  or,
  documentComparisons,
  documentVersionRenditions,
  documentVersions,
  eq,
  type Transaction,
} from "@openlaw/db";

/** The caller holds the owning record lock until the rows and stored files have been erased. */
export async function documentErasureBlobs(tx: Transaction, documentId: string) {
  const versions = await tx
    .select({ fileRef: documentVersions.fileRef })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(asc(documentVersions.id))
    .for("update");
  const renditions = await tx
    .select({ fileRef: documentVersionRenditions.fileRef })
    .from(documentVersionRenditions)
    .innerJoin(documentVersions, eq(documentVersions.id, documentVersionRenditions.versionId))
    .where(eq(documentVersions.documentId, documentId));
  const comparisons = await tx
    .select({ fileRef: documentComparisons.redlineFileRef })
    .from(documentComparisons)
    .where(eq(documentComparisons.documentId, documentId))
    .orderBy(asc(documentComparisons.id))
    .for("update");
  return {
    versionCount: versions.length,
    blobs: [
      ...renditions.flatMap((row) => (row.fileRef ? [row.fileRef] : [])),
      ...comparisons.flatMap((row) => (row.fileRef ? [row.fileRef] : [])),
      ...versions.map((row) => row.fileRef),
    ],
  };
}

/** Collect only one Version's files and comparisons. Other Versions stay intact. */
export async function versionErasureBlobs(tx: Transaction, documentId: string, versionId: string) {
  const [version] = await tx
    .select()
    .from(documentVersions)
    .where(and(eq(documentVersions.documentId, documentId), eq(documentVersions.id, versionId)))
    .for("update");
  if (!version) return null;
  const renditions = await tx
    .select({ fileRef: documentVersionRenditions.fileRef })
    .from(documentVersionRenditions)
    .where(eq(documentVersionRenditions.versionId, versionId));
  const comparisons = await tx
    .select({ id: documentComparisons.id, fileRef: documentComparisons.redlineFileRef })
    .from(documentComparisons)
    .where(
      and(
        eq(documentComparisons.documentId, documentId),
        or(
          eq(documentComparisons.fromVersionId, versionId),
          eq(documentComparisons.toVersionId, versionId),
        ),
      ),
    )
    .orderBy(asc(documentComparisons.id))
    .for("update");
  return {
    version,
    comparisonIds: comparisons.map((row) => row.id),
    blobs: [
      ...renditions.flatMap((row) => (row.fileRef ? [row.fileRef] : [])),
      ...comparisons.flatMap((row) => (row.fileRef ? [row.fileRef] : [])),
      version.fileRef,
    ],
  };
}
