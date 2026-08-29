// SPDX-License-Identifier: AGPL-3.0-only

import { contracts, documents, matters, sql, type SQL } from "@openlaw/db";
import { DOCUMENT_OWNER_KINDS, resolveDocumentOwner, type DocumentOwner } from "@openlaw/shared";

/**
 * The database columns and record reference carried by one Document owner.
 * The exhaustive switch is the one place a new owner adds its SQL arm.
 */
export function documentOwnerSql(owner: DocumentOwner) {
  switch (owner) {
    case "contract":
      return {
        kind: owner,
        prefix: "C",
        kindSql: sql<DocumentOwner>`'contract'::text`,
        prefixSql: sql<string>`'C'::text`,
        documentOwnerId: documents.contractId,
        recordId: contracts.id,
        number: contracts.number,
        title: contracts.title,
      } as const;
    case "matter":
      return {
        kind: owner,
        prefix: "M",
        kindSql: sql<DocumentOwner>`'matter'::text`,
        prefixSql: sql<string>`'M'::text`,
        documentOwnerId: documents.matterId,
        recordId: matters.id,
        number: matters.number,
        title: matters.title,
      } as const;
  }
}

/** Resolves one owner-specific SQL value from the exactly-one-owner columns. */
export function documentOwnerCase<T>(
  value: (owner: ReturnType<typeof documentOwnerSql>) => SQL<T>,
): SQL<T> {
  const arms = DOCUMENT_OWNER_KINDS.map((kind) => {
    const owner = documentOwnerSql(kind);
    return sql`when ${owner.documentOwnerId} is not null then ${value(owner)}`;
  });
  return sql<T>`case ${sql.join(arms, sql` `)} end`;
}

/** A C- or M- reference, optionally left-padded for lexical sorting. */
export function documentOwnerReferenceSql(padded: boolean): SQL<string> {
  return documentOwnerCase((owner) =>
    padded
      ? sql<string>`concat(${owner.prefixSql}, '-', lpad(${owner.number}::text, 10, '0'))`
      : sql<string>`concat(${owner.prefixSql}, '-', ${owner.number}::text)`,
  );
}

/** Parses a repository record filter through the same owner definition used by its sort key. */
export function parseDocumentOwnerReference(reference: string): {
  owner: ReturnType<typeof documentOwnerSql>;
  number: number;
} {
  const prefix = reference.slice(0, 1);
  const owner = resolveDocumentOwner(
    Object.fromEntries(
      DOCUMENT_OWNER_KINDS.map((kind) => {
        const candidate = documentOwnerSql(kind);
        return [kind, candidate.prefix === prefix ? candidate : null];
      }),
    ) as Record<DocumentOwner, ReturnType<typeof documentOwnerSql> | null>,
  ).value;
  return { owner, number: Number(reference.slice(2)) };
}
