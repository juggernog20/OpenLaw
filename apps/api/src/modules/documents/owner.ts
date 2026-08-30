// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The one definition of a Document owner in SQL: which column holds it,
 * which record it joins, and how its reference reads. Every owner-aware
 * query in the repository composes these arms instead of repeating the
 * `case` by hand, so a fourth owner is one switch arm here (DOC-008).
 *
 * The queries lean on the table check `documents_owner_check`: exactly
 * one of `contract_id`, `matter_id`, and `entity_id` is present on a row.
 * That is what lets `documentOwnerCase` read the first non-null column as
 * the owner and never fall through. Drizzle's `sql` template keeps the
 * arms typed (TECH-006).
 */
import { contracts, documents, entities, matters, sql, type SQL } from "@openlaw/db";
import { DOCUMENT_OWNER_KINDS, type DocumentOwner } from "@openlaw/shared";

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
        number: sql<number | null>`${contracts.number}`,
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
        number: sql<number | null>`${matters.number}`,
        title: matters.title,
      } as const;
    case "entity":
      return {
        kind: owner,
        prefix: null,
        kindSql: sql<DocumentOwner>`'entity'::text`,
        prefixSql: sql<string>`''::text`,
        documentOwnerId: documents.entityId,
        recordId: entities.id,
        number: sql<number | null>`null::integer`,
        title: entities.legalName,
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
  return documentOwnerCase((owner) => {
    if (owner.kind === "entity") return sql<string>`${owner.title}`;
    return padded
      ? sql<string>`concat(${owner.prefixSql}, '-', lpad(${owner.number}::text, 10, '0'))`
      : sql<string>`concat(${owner.prefixSql}, '-', ${owner.number}::text)`;
  });
}

/** The query value that identifies one owning record in the repository. */
export function documentOwnerFilterValueSql(): SQL<string> {
  return documentOwnerCase((owner) =>
    owner.kind === "entity"
      ? sql<string>`${owner.recordId}`
      : sql<string>`concat(${owner.prefixSql}, '-', ${owner.number}::text)`,
  );
}

/**
 * Parses a repository record filter through the same owner definition its
 * sort key uses. A C- or M- reference names a numbered record; anything
 * else is an Entity id. The route schema has already checked that a value
 * with a numbered prefix carries a valid number.
 */
export function parseDocumentOwnerReference(
  reference: string,
):
  | { owner: ReturnType<typeof documentOwnerSql>; number: number; id?: never }
  | { owner: ReturnType<typeof documentOwnerSql>; id: string; number?: never } {
  const match = /^([CM])-([1-9]\d*)$/.exec(reference);
  const owner = match
    ? DOCUMENT_OWNER_KINDS.map(documentOwnerSql).find((o) => o.prefix === match[1])
    : undefined;
  if (!owner) return { owner: documentOwnerSql("entity"), id: reference };
  return { owner, number: Number(match![2]) };
}
