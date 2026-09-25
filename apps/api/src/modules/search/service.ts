// SPDX-License-Identifier: AGPL-3.0-only

/** M25's ranked cross-module search and M44's versioned questions, with
 * every reach rule inside SQL. */
import { z } from "zod";
import {
  and,
  asc,
  contracts,
  contractCounterparties,
  contractStatuses,
  contractTypes,
  counterparties,
  documents,
  documentVersions,
  documentVersionText,
  entities,
  entityTypes,
  eq,
  fields,
  isNull,
  autoDocs,
  knowledgeItems,
  knowledgeTypes,
  matters,
  matterStatuses,
  matterTypes,
  requests,
  requestTypes,
  sql,
  users,
  type Db,
  type SQL,
} from "@openlaw/db";
import {
  DOCUMENT_OWNER_KINDS,
  SEARCH_KINDS,
  SearchQuestionSchema,
  conditionProblem,
  type DocumentOwner,
  type SearchField,
  type SearchQuestion,
} from "@openlaw/shared";
import type { AuthenticatedUser } from "../../auth/guards.js";
import { contractTeamScope } from "../../lib/contract-access.js";
import { documentRepositoryScope } from "../../lib/document-access.js";
import { entityReachScope } from "../../lib/entity-access.js";
import { matterTeamScope } from "../../lib/matter-access.js";
import { httpError } from "../../lib/problem.js";
import { TimezoneSchema } from "../../lib/timezones.js";
import { documentOwnerCase } from "../documents/owner.js";
import { conditionScope } from "./conditions.js";
import { questionSort, readQuestionCursor, writeQuestionCursor } from "./sort.js";

export { SEARCH_KINDS };
export type SearchKind = (typeof SEARCH_KINDS)[number];

const GROUPED_LIMIT = 10;
const FLAT_LIMIT = 25;
const MAX_LIMIT = 100;
const EXACT_NUMBER_RANK = 1000;

export const QuerySchema = z.object({
  q: z.string().trim().min(1).max(200, "Search queries must be 200 characters or fewer."),
  kind: z.enum(SEARCH_KINDS).optional(),
  cursor: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
});

/** The POST /search/query body: the question plus its paging and zone. */
export const QuestionQuerySchema = SearchQuestionSchema.safeExtend({
  timeZone: TimezoneSchema.optional(),
  cursor: z.string().min(1).max(16_384).optional(),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(FLAT_LIMIT),
});

const SearchRowFields = {
  id: z.string(),
  /** C-, M-, and R-number without its display prefix. Registry rows
   * have no number and answer NULL. */
  number: z.number().int().nullable(),
  title: z.string(),
  isConfidential: z.boolean(),
  rank: z.number().nonnegative(),
};

export const SearchRowSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(["contract", "matter", "entity", "counterparty", "request"]),
    ...SearchRowFields,
  }),
  z.object({
    kind: z.literal("knowledge_item"),
    ...SearchRowFields,
    state: z.enum(["draft", "published"]),
  }),
  z.object({
    kind: z.literal("document"),
    ...SearchRowFields,
    ownerKind: z.enum(DOCUMENT_OWNER_KINDS),
    ownerId: z.string(),
    ownerNumber: z.number().int().positive().nullable(),
    ownerTitle: z.string(),
    versionId: z.string(),
    versionNumber: z.number().int().positive(),
    snippet: z.string(),
  }),
]);

interface SearchDbRow extends Record<string, unknown> {
  kind: SearchKind;
  id: string;
  number: number | null;
  title: string;
  is_confidential: boolean;
  rank: number;
  kind_order: number;
  owner_kind: DocumentOwner | null;
  owner_id: string | null;
  owner_number: number | null;
  owner_title: string | null;
  version_id: string | null;
  version_number: number | null;
  snippet: string | null;
  state: "draft" | "published" | null;
}

interface QuestionSearchDbRow extends SearchDbRow {
  created_at: string;
  expiry_date: string | null;
  sort_title: string;
}

interface ExactNumber {
  number: number;
  kinds: ReadonlySet<"contract" | "matter" | "request">;
}

/** The number syntax that gets an exact-match arm beside FTS. */
function exactNumber(query: string): ExactNumber | null {
  const match = /^(?:([CMR])-)?(\d+)$/i.exec(query);
  if (!match?.[2]) return null;
  const parsed = BigInt(match[2]);
  if (parsed > 2_147_483_647n) return null;
  const prefix = match[1]?.toUpperCase();
  const kinds = new Set<"contract" | "matter" | "request">();
  if (prefix === undefined || prefix === "C") kinds.add("contract");
  if (prefix === undefined || prefix === "M") kinds.add("matter");
  if (prefix === undefined || prefix === "R") kinds.add("request");
  return { number: Number(parsed), kinds };
}

function exactPredicate(exact: ExactNumber | null, kind: "contract" | "matter" | "request"): SQL {
  if (!exact?.kinds.has(kind)) return sql`false`;
  const column =
    kind === "contract" ? contracts.number : kind === "matter" ? matters.number : requests.number;
  return eq(column, exact.number);
}

/** Counterparties, Requests, and Knowledge Items are staff-wide reads.
 * Apply the role floor before LIMIT so hidden rows cannot shorten a page. */
export function memberScope(user: AuthenticatedUser): SQL {
  return user.role === "administrator" || user.role === "legal_team_member"
    ? sql`true`
    : sql`false`;
}

/** Candidate reads shared by header search and versioned questions.
 * Each kind ANDs its condition scope, its reach scope, and its kind
 * choice. Without a question the condition scope is the archive rule
 * alone and every kind is read with all four weights. */
export function searchCtes(
  db: Db,
  user: AuthenticatedUser,
  query: string,
  scopes: Record<SearchKind, SQL | undefined> = searchScopes(db, user),
  question?: SearchQuestion,
  timeZone?: string,
  catalog: readonly SearchField[] = [],
): SQL {
  const now = new Date();
  const exact = question && !question.scope.titles ? null : exactNumber(query);
  const kindScope = (kind: SearchKind) => {
    if (!question) return sql`true`;
    const selected = question.kinds.length === 0 || question.kinds.includes(kind);
    const scopeApplies =
      !query || question.scope.titles || question.scope.text || kind === "document";
    return sql`${selected && scopeApplies}`;
  };
  const weights = question
    ? [
        question.scope.titles ? "A" : "",
        question.scope.text ? "BC" : "",
        question.scope.contents ? "D" : "",
      ]
        .join("")
        .split("")
    : ["A", "B", "C", "D"];
  const matchingDocument = question
    ? sql`ts_filter(document, array[${sql.join(
        weights.map((weight) => sql`${weight}`),
        sql`, `,
      )}]::"char"[])`
    : sql`document`;
  const noWords = question !== undefined && query === "";
  // A row made entirely of stop words must not silently widen the other rows.
  const meaningfulRows = question
    ? sql.join(
        Object.values(question.words)
          .filter(Boolean)
          .map((row) => sql`numnode(websearch_to_tsquery('english', ${row})) > 0`),
        sql` and `,
      )
    : sql`true`;
  const matches = sql`(${noWords} or (${Object.values(question?.words ?? {}).some(Boolean) ? meaningfulRows : sql`true`} and ${matchingDocument} @@ search_query.value))`;
  const contractExact = exactPredicate(exact, "contract");
  const matterExact = exactPredicate(exact, "matter");
  const requestExact = exactPredicate(exact, "request");
  const where = (kind: SearchKind) =>
    and(
      conditionScope(kind, question, user, timeZone, now, catalog),
      scopes[kind],
      kindScope(kind),
    );

  return sql`
    search_query as (
      select websearch_to_tsquery('english', ${query}) as value
    ),
    contract_candidates as (
      select
        'contract'::text as kind,
        ${contracts.id} as id,
        ${contracts.createdAt} as created_at,
        ${contracts.expiryDate} as expiry_date,
        ${contracts.number} as number,
        ${contracts.title} as title,
        ${contracts.isConfidential} as is_confidential,
        0::integer as kind_order,
        ${contractExact} as exact_number,
        ${contracts.searchVector}
          || setweight(to_tsvector('english', coalesce(${contractTypes.displayName}, '')), 'C')
          || setweight(to_tsvector('english', coalesce(${contractStatuses.displayName}, '')), 'C')
          || setweight(to_tsvector('english', coalesce((
            select string_agg(${counterparties.name}, ' ' order by ${counterparties.name})
            from ${contractCounterparties}
            inner join ${counterparties}
              on ${counterparties.id} = ${contractCounterparties.counterpartyId}
            where ${contractCounterparties.contractId} = ${contracts.id}
          ), '')), 'C') as document
      from ${contracts}
      inner join ${contractTypes} on ${contractTypes.id} = ${contracts.contractTypeId}
      inner join ${contractStatuses} on ${contractStatuses.id} = ${contracts.statusId}
      where ${where("contract")}
    ),
    contract_hits as (
      select
        kind, id, number, title, is_confidential, kind_order, created_at, expiry_date,
        null::text as owner_kind, null::text as owner_id, null::integer as owner_number, null::text as owner_title,
        null::text as version_id, null::integer as version_number,
        null::text as snippet, null::text as state,
        case when exact_number
          then ${EXACT_NUMBER_RANK}::real
          else ts_rank_cd(array[0.05, 0.1, 0.5, 1.0]::real[], ${matchingDocument}, search_query.value)
        end as rank
      from contract_candidates
      cross join search_query
      where ${matches} or exact_number
    ),
    matter_candidates as (
      select
        'matter'::text as kind,
        ${matters.id} as id,
        ${matters.createdAt} as created_at,
        null::date as expiry_date,
        ${matters.number} as number,
        ${matters.title} as title,
        ${matters.isConfidential} as is_confidential,
        1::integer as kind_order,
        ${matterExact} as exact_number,
        ${matters.searchVector}
          || setweight(to_tsvector('english', coalesce(${matterTypes.displayName}, '')), 'C')
          || setweight(to_tsvector('english', coalesce(${matterStatuses.displayName}, '')), 'C')
          || setweight(to_tsvector('english', coalesce(${users.displayName}, '')), 'C') as document
      from ${matters}
      inner join ${matterTypes} on ${matterTypes.id} = ${matters.matterTypeId}
      inner join ${matterStatuses} on ${matterStatuses.id} = ${matters.statusId}
      left join ${users} on ${users.id} = ${matters.managerId}
      where ${where("matter")}
    ),
    matter_hits as (
      select
        kind, id, number, title, is_confidential, kind_order, created_at, expiry_date,
        null::text as owner_kind, null::text as owner_id, null::integer as owner_number, null::text as owner_title,
        null::text as version_id, null::integer as version_number,
        null::text as snippet, null::text as state,
        case when exact_number
          then ${EXACT_NUMBER_RANK}::real
          else ts_rank_cd(array[0.05, 0.1, 0.5, 1.0]::real[], ${matchingDocument}, search_query.value)
        end as rank
      from matter_candidates
      cross join search_query
      where ${matches} or exact_number
    ),
    document_version_candidates as (
      select
        'document'::text as kind,
        ${documents.id} as id,
        ${documentVersions.createdAt} as created_at,
        null::date as expiry_date,
        null::integer as number,
        coalesce(${documentVersionText.emailSubject}, ${documents.title}) as title,
        ${documents.isConfidential} as is_confidential,
        2::integer as kind_order,
        ${documentOwnerCase((owner) => owner.kindSql)} as owner_kind,
        ${documentOwnerCase((owner) => sql<string>`${owner.recordId}`)} as owner_id,
        ${documentOwnerCase((owner) => sql<number>`${owner.number}`)} as owner_number,
        ${documentOwnerCase((owner) => sql<string>`${owner.title}`)} as owner_title,
        ${documentVersions.id} as version_id,
        ${documentVersions.versionNumber} as version_number,
        null::text as state,
        ${documents.searchVector}
          || setweight(to_tsvector('english', coalesce(${documentVersions.originalFilename}, '')), 'B')
          || setweight(to_tsvector('english', regexp_replace(
            coalesce(${documentVersions.originalFilename}, ''), '[^[:alnum:]]+', ' ', 'g'
          )), 'B')
          || setweight(to_tsvector('english', coalesce(${documentVersionText.emailSubject}, '')), 'A')
          || coalesce(${documentVersionText.searchVector}, ''::tsvector) as document,
        ${documents.title} as document_title,
        ${documents.description} as document_description,
        ${documentVersions.originalFilename} as original_filename,
        ${documentVersionText.emailSubject} as email_subject,
        ${documentVersionText.text} as extracted_text,
        ${documentVersionText.searchVector} as extracted_vector
      from ${documents}
      inner join ${documentVersions} on ${documentVersions.documentId} = ${documents.id}
        and ${documentVersions.versionNumber} = (
          select max(current_version.version_number)
          from ${documentVersions} current_version
          where current_version.document_id = ${documents.id}
        )
      left join ${documentVersionText} on ${documentVersionText.versionId} = ${documentVersions.id}
      left join ${contracts} on ${contracts.id} = ${documents.contractId}
      left join ${matters} on ${matters.id} = ${documents.matterId}
      left join ${entities} on ${entities.id} = ${documents.entityId}
      left join ${knowledgeItems} on ${knowledgeItems.id} = ${documents.knowledgeItemId}
    left join ${autoDocs} on ${autoDocs.id} = ${documents.autoDocId}
      where ${where("document")}
    ),
    document_version_hits as (
      select
        kind, id, number, title, is_confidential, kind_order, created_at, expiry_date,
        owner_kind, owner_id, owner_number, owner_title, version_id, version_number,
        document_title, document_description, original_filename,
        email_subject, extracted_text, extracted_vector, state,
        ts_rank_cd(array[0.05, 0.1, 0.5, 1.0]::real[], ${matchingDocument}, search_query.value) as rank
      from document_version_candidates
      cross join search_query
      where ${matches}
    ),
    document_hits as (
      select
        kind, id, number, title, is_confidential, kind_order, created_at, expiry_date,
        owner_kind, owner_id, owner_number, owner_title, version_id, version_number,
        ts_headline(
          'english',
          case
            when ${question?.scope.contents ?? true} and coalesce(extracted_vector, ''::tsvector) @@ search_query.value
              then coalesce(extracted_text, '')
            when ${question?.scope.titles ?? true} and to_tsvector('english', coalesce(email_subject, '')) @@ search_query.value
              then coalesce(email_subject, '')
            when ${question?.scope.text ?? true} and (
              to_tsvector('english', coalesce(original_filename, ''))
              || to_tsvector('english', regexp_replace(
                coalesce(original_filename, ''), '[^[:alnum:]]+', ' ', 'g'
              ))
            ) @@ search_query.value
              then original_filename
            else concat_ws(' ', document_title, document_description)
          end,
          search_query.value,
          'StartSel=<mark>, StopSel=</mark>, MaxWords=24, MinWords=8, ShortWord=2'
        ) as snippet,
        state, rank
      from document_version_hits
      cross join search_query
    ),
    entity_candidates as (
      select
        'entity'::text as kind,
        ${entities.id} as id,
        ${entities.createdAt} as created_at,
        null::date as expiry_date,
        null::integer as number,
        ${entities.legalName} as title,
        ${entities.isConfidential} as is_confidential,
        3::integer as kind_order,
        ${entities.searchVector}
          || setweight(to_tsvector('english', coalesce(${entityTypes.displayName}, '')), 'C') as document
      from ${entities}
      inner join ${entityTypes} on ${entityTypes.id} = ${entities.entityTypeId}
      where ${where("entity")}
    ),
    entity_hits as (
      select
        kind, id, number, title, is_confidential, kind_order, created_at, expiry_date,
        null::text as owner_kind, null::text as owner_id, null::integer as owner_number, null::text as owner_title,
        null::text as version_id, null::integer as version_number,
        null::text as snippet, null::text as state,
        ts_rank_cd(array[0.05, 0.1, 0.5, 1.0]::real[], ${matchingDocument}, search_query.value) as rank
      from entity_candidates
      cross join search_query
      where ${matches}
    ),
    counterparty_candidates as (
      select
        'counterparty'::text as kind,
        ${counterparties.id} as id,
        ${counterparties.createdAt} as created_at,
        null::date as expiry_date,
        null::integer as number,
        ${counterparties.name} as title,
        false as is_confidential,
        4::integer as kind_order,
        ${counterparties.searchVector} as document
      from ${counterparties}
      where ${where("counterparty")}
    ),
    counterparty_hits as (
      select
        kind, id, number, title, is_confidential, kind_order, created_at, expiry_date,
        null::text as owner_kind, null::text as owner_id, null::integer as owner_number, null::text as owner_title,
        null::text as version_id, null::integer as version_number,
        null::text as snippet, null::text as state,
        ts_rank_cd(array[0.05, 0.1, 0.5, 1.0]::real[], ${matchingDocument}, search_query.value) as rank
      from counterparty_candidates
      cross join search_query
      where ${matches}
    ),
    request_candidates as (
      select
        'request'::text as kind,
        ${requests.id} as id,
        ${requests.createdAt} as created_at,
        null::date as expiry_date,
        ${requests.number} as number,
        ${requests.title} as title,
        false as is_confidential,
        5::integer as kind_order,
        ${requestExact} as exact_number,
        ${requests.searchVector}
          || setweight(to_tsvector('english', coalesce(${requestTypes.displayName}, '')), 'C')
          || setweight(to_tsvector('english', coalesce(${users.displayName}, '')), 'C') as document
      from ${requests}
      inner join ${requestTypes} on ${requestTypes.id} = ${requests.requestTypeId}
      inner join ${users} on ${users.id} = ${requests.requesterId}
      where ${where("request")}
    ),
    request_hits as (
      select
        kind, id, number, title, is_confidential, kind_order, created_at, expiry_date,
        null::text as owner_kind, null::text as owner_id, null::integer as owner_number, null::text as owner_title,
        null::text as version_id, null::integer as version_number,
        null::text as snippet, null::text as state,
        case when exact_number
          then ${EXACT_NUMBER_RANK}::real
          else ts_rank_cd(array[0.05, 0.1, 0.5, 1.0]::real[], ${matchingDocument}, search_query.value)
        end as rank
      from request_candidates
      cross join search_query
      where ${matches} or exact_number
    ),
    knowledge_item_candidates as (
      select
        'knowledge_item'::text as kind,
        ${knowledgeItems.id} as id,
        ${knowledgeItems.createdAt} as created_at,
        null::date as expiry_date,
        null::integer as number,
        ${knowledgeItems.title} as title,
        false as is_confidential,
        6::integer as kind_order,
        ${knowledgeItems.state} as state,
        ${knowledgeItems.searchVector}
          || setweight(to_tsvector('english', coalesce(${knowledgeTypes.displayName}, '')), 'C')
          as document
      from ${knowledgeItems}
      inner join ${knowledgeTypes} on ${knowledgeTypes.id} = ${knowledgeItems.knowledgeTypeId}
      where ${where("knowledge_item")}
    ),
    knowledge_item_hits as (
      select
        kind, id, number, title, is_confidential, kind_order, created_at, expiry_date,
        null::text as owner_kind, null::text as owner_id, null::integer as owner_number, null::text as owner_title,
        null::text as version_id, null::integer as version_number,
        null::text as snippet, state,
        ts_rank_cd(array[0.05, 0.1, 0.5, 1.0]::real[], ${matchingDocument}, search_query.value) as rank
      from knowledge_item_candidates
      cross join search_query
      where ${matches}
    ),
    all_hits as (
      select * from contract_hits
      union all select * from matter_hits
      union all select * from document_hits
      union all select * from entity_hits
      union all select * from counterparty_hits
      union all select * from request_hits
      union all select * from knowledge_item_hits
    )
  `;
}

function toSearchRow(row: SearchDbRow): z.infer<typeof SearchRowSchema> {
  const common = {
    id: row.id,
    number: row.number,
    title: row.title,
    isConfidential: row.is_confidential,
    rank: row.rank,
  };
  if (row.kind === "knowledge_item") {
    if (row.state === null) throw new Error("Knowledge search hit is missing its state");
    return { ...common, kind: row.kind, state: row.state };
  }
  if (row.kind !== "document") return { ...common, kind: row.kind };
  if (
    row.owner_kind === null ||
    row.owner_id === null ||
    row.owner_title === null ||
    row.version_id === null ||
    row.version_number === null ||
    row.snippet === null
  ) {
    throw new Error("Document search hit is missing its owning record or matched version");
  }
  let ownerKind: DocumentOwner;
  switch (row.owner_kind) {
    case "contract":
      ownerKind = "contract";
      break;
    case "matter":
      ownerKind = "matter";
      break;
    case "entity":
      ownerKind = "entity";
      break;
    case "auto_doc":
      ownerKind = "auto_doc";
      break;
    case "knowledge_item":
      ownerKind = "knowledge_item";
      break;
  }
  return {
    ...common,
    kind: "document" as const,
    ownerKind,
    ownerId: row.owner_id,
    ownerNumber: row.owner_number,
    ownerTitle: row.owner_title,
    versionId: row.version_id,
    versionNumber: row.version_number,
    snippet: row.snippet,
  };
}

async function groupedRows(db: Db, ctes: SQL): Promise<SearchDbRow[]> {
  const result = await db.execute<SearchDbRow>(sql`
    with ${ctes},
    ranked_hits as (
      select *, row_number() over (
        partition by kind_order order by rank desc, id desc
      ) as kind_position
      from all_hits
    )
    select kind, id, number, title, is_confidential, rank, kind_order,
      owner_kind, owner_id, owner_number, owner_title, version_id, version_number, snippet, state
    from ranked_hits
    where kind_position <= ${GROUPED_LIMIT}
    order by kind_order, rank desc, id desc
  `);
  return result.rows;
}

async function flatRows(
  db: Db,
  ctes: SQL,
  options: { kind?: SearchKind; cursor?: string; limit: number },
): Promise<SearchDbRow[]> {
  const kindScope = options.kind === undefined ? sql`true` : sql`kind = ${options.kind}`;
  const cursorScope =
    options.cursor === undefined
      ? sql`true`
      : sql`
          exists (select 1 from cursor_boundary)
          and (
            rank < (select rank from cursor_boundary)
            or (
              rank = (select rank from cursor_boundary)
              and id < (select id from cursor_boundary)
            )
          )
        `;
  const result = await db.execute<SearchDbRow>(sql`
    with ${ctes},
    cursor_boundary as (
      select rank, id
      from all_hits
      where ${kindScope}
        and id = ${options.cursor ?? ""}
      limit 1
    )
    select kind, id, number, title, is_confidential, rank, kind_order,
      owner_kind, owner_id, owner_number, owner_title, version_id, version_number, snippet, state
    from all_hits
    where ${kindScope} and ${cursorScope}
    order by rank desc, id desc
    limit ${options.limit + 1}
  `);
  return result.rows;
}

/** Each kind's reach rule alone. A question supplies its own archive
 * rule through its conditions, so Show archived can lift it. */
export function reachScopes(db: Db, user: AuthenticatedUser): Record<SearchKind, SQL | undefined> {
  const staff = memberScope(user);
  return {
    contract: contractTeamScope(db, user),
    matter: matterTeamScope(db, user),
    document: documentRepositoryScope(db, user),
    entity: entityReachScope(db, user),
    counterparty: staff,
    request: staff,
    knowledge_item: staff,
  };
}

/** Header search keeps each kind's access and archive rules ahead of ranking and paging. */
export function searchScopes(db: Db, user: AuthenticatedUser): Record<SearchKind, SQL> {
  const reach = reachScopes(db, user);
  return {
    contract: and(isNull(contracts.archivedAt), reach.contract)!,
    matter: and(isNull(matters.archivedAt), reach.matter)!,
    document: and(isNull(documents.archivedAt), reach.document)!,
    entity: and(isNull(entities.archivedAt), reach.entity)!,
    counterparty: and(isNull(counterparties.archivedAt), reach.counterparty)!,
    request: and(isNull(requests.archivedAt), reach.request)!,
    knowledge_item: and(isNull(knowledgeItems.archivedAt), reach.knowledge_item)!,
  };
}

export async function groupedSearch(db: Db, user: AuthenticatedUser, q: string) {
  const query = QuerySchema.parse({ q });
  const rows = await groupedRows(db, searchCtes(db, user, query.q));
  return { results: rows.map(toSearchRow), nextCursor: null };
}

export async function flatSearch(
  db: Db,
  user: AuthenticatedUser,
  q: string,
  options: { kind?: SearchKind; cursor?: string; limit?: number } = {},
  scopes = searchScopes(db, user),
) {
  const query = QuerySchema.parse({ ...options, q });
  const pageSize = query.limit ?? FLAT_LIMIT;
  const rows = await flatRows(db, searchCtes(db, user, query.q, scopes), {
    ...query,
    limit: pageSize,
  });
  const page = rows.slice(0, pageSize);
  return {
    results: page.map(toSearchRow),
    nextCursor: rows.length > pageSize ? (page.at(-1)?.id ?? null) : null,
  };
}

export async function search(db: Db, user: AuthenticatedUser, input: z.input<typeof QuerySchema>) {
  const { q, kind, cursor, limit } = QuerySchema.parse(input);
  return kind !== undefined || cursor !== undefined || limit !== undefined
    ? flatSearch(db, user, q, { kind, cursor, limit })
    : groupedSearch(db, user, q);
}

/**
 * Each words row is a list of words, not websearch syntax. A word is
 * quoted so that `or` and a leading `-` typed into a row stay words:
 * unquoted, "terms or conditions" in the all row becomes an OR, "-draft"
 * becomes an exclusion, and "-draft" in the none row becomes `--draft`,
 * which websearch reads as a double negation that requires the word.
 * A record number such as C-123 stays bare so the exact-number arm still
 * reads it; websearch parses it the same way either way.
 */
function terms(row: string): string[] {
  return row
    .split(/\s+/)
    .map((word) => word.replaceAll('"', "").replace(/^-+/, ""))
    .filter(Boolean)
    .map((word) => (exactNumber(word) ? word : `"${word}"`));
}

function compileWords(words: SearchQuestion["words"]): string {
  const all = terms(words.all).join(" ");
  const phrase = words.phrase ? `"${words.phrase.replaceAll('"', " ")}"` : "";
  const none = terms(words.none)
    .map((word) => `-${word}`)
    .join(" ");
  const required = [all, phrase, none].filter(Boolean).join(" ");
  const any = terms(words.any);
  // websearch does not group parentheses. Repeat the required rows in each OR arm.
  return any.length
    ? any.map((word) => [required, word].filter(Boolean).join(" ")).join(" OR ")
    : required;
}

const fieldProjection = {
  slug: fields.slug,
  displayName: fields.displayName,
  moduleScope: fields.moduleScope,
  fieldType: fields.fieldType,
  options: fields.options,
};

/** Live Fields and reachable reference choices for search conditions. */
export async function searchFields(db: Db, user: AuthenticatedUser) {
  const [catalog, people, companies] = await Promise.all([
    db
      .select(fieldProjection)
      .from(fields)
      .where(isNull(fields.archivedAt))
      .orderBy(asc(fields.displayName)),
    db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(isNull(users.archivedAt))
      .orderBy(asc(users.displayName)),
    db
      .select({ id: entities.id, displayName: entities.legalName })
      .from(entities)
      .where(and(isNull(entities.archivedAt), entityReachScope(db, user)))
      .orderBy(asc(entities.legalName)),
  ]);
  return { fields: catalog, people, entities: companies };
}

/** Run a versioned search question with an exact reachable match total. */
export async function querySearch(
  db: Db,
  user: AuthenticatedUser,
  input: z.input<typeof QuestionQuerySchema>,
) {
  const { cursor, limit, ...question } = QuestionQuerySchema.parse(input);
  const hasFields = question.conditions.some((condition) =>
    condition.property.startsWith("field:"),
  );
  if (hasFields && user.role === "business_user")
    throw httpError(403, "Field search is available to staff only.");
  const catalog = hasFields
    ? await db.select(fieldProjection).from(fields).where(isNull(fields.archivedAt))
    : [];
  for (const condition of question.conditions) {
    const problem = conditionProblem(condition, catalog);
    if (problem) throw httpError(400, `${condition.property}: ${problem}`);
  }
  const boundary = cursor ? readQuestionCursor(cursor, question.sort) : undefined;
  const { after, order } = questionSort(question.sort, boundary);
  const ctes = searchCtes(
    db,
    user,
    compileWords(question.words),
    reachScopes(db, user),
    question,
    question.timeZone,
    catalog,
  );
  const answer = await db.execute<{ total: number; page: QuestionSearchDbRow[] }>(sql`
    with ${ctes}, sortable_hits as (
      select *, lower(title) as sort_title from all_hits
    ), page as (
      select * from sortable_hits where ${after}
      order by ${order} limit ${limit + 1}
    )
    select (select count(*)::integer from all_hits) as total,
      coalesce((select json_agg(page order by ${order}) from page), '[]'::json) as page
  `);
  const { total, page: rows } = answer.rows[0]!;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    results: page.map(toSearchRow),
    total,
    nextCursor: rows.length > limit && last ? writeQuestionCursor(question.sort, last) : null,
  };
}
