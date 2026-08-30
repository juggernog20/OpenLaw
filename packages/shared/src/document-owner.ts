// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The record kinds that may own a Document (DOC-008).
 *
 * Every consumer switches on this union. Adding another owner here makes
 * each owner-specific read and write name its new arm before the build can
 * pass.
 */
export const DOCUMENT_OWNER_KINDS = ["contract", "matter", "entity"] as const;
export type DocumentOwner = (typeof DOCUMENT_OWNER_KINDS)[number];

export interface ResolvedDocumentOwner<T> {
  kind: DocumentOwner;
  value: T;
}

/**
 * Resolves DOC-008's exactly-one-owner columns into one owning-record kind.
 *
 * The database CHECK is the final guard. This helper gives every application
 * path the same answer and turns a broken zero-owner or multi-owner row into a
 * clear failure at the point where code asks who owns it.
 */
export function resolveDocumentOwner<T>(
  references: Readonly<Record<DocumentOwner, T | null | undefined>>,
): ResolvedDocumentOwner<T> {
  let resolved: ResolvedDocumentOwner<T> | null = null;
  for (const kind of DOCUMENT_OWNER_KINDS) {
    const value = references[kind];
    if (value === null || value === undefined) continue;
    if (resolved !== null) {
      throw new Error("A Document must have exactly one owning record.");
    }
    resolved = { kind, value };
  }
  if (resolved === null) {
    throw new Error("A Document must have exactly one owning record.");
  }
  return resolved;
}
