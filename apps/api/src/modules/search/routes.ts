// SPDX-License-Identifier: AGPL-3.0-only

/** M25's ranked cross-module search, with every reach rule inside SQL. */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  contracts,
  contractCounterparties,
  contractStatuses,
  contractTypes,
  counterparties,
  entities,
  entityTypes,
  eq,
  isNull,
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
import { requireAuth, type AuthenticatedUser } from "../../auth/guards.js";
import { contractTeamScope } from "../../lib/contract-access.js";
import { matterTeamScope } from "../../lib/matter-access.js";
import { problemResponse } from "../../lib/problem.js";

const SEARCH_KINDS = [
  "contract",
  "matter",
  "document",
  "entity",
  "counterparty",
  "request",
] as const;
type SearchKind = (typeof SEARCH_KINDS)[number];

const GROUPED_LIMIT = 10;
const FLAT_LIMIT = 25;
const MAX_LIMIT = 100;
const EXACT_NUMBER_RANK = 1000;

const QuerySchema = z.object({
  q: z.string().trim().min(1).max(200, "Search queries must be 200 characters or fewer."),
  kind: z.enum(SEARCH_KINDS).optional(),
  cursor: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
});

const SearchRowSchema = z.object({
  kind: z.enum(SEARCH_KINDS),
  id: z.string(),
  /** C-, M-, and R-number without its display prefix. Registry rows
   * have no number and answer NULL. */
  number: z.number().int().nullable(),
  title: z.string(),
  isConfidential: z.boolean(),
  rank: z.number().nonnegative(),
});

interface SearchDbRow extends Record<string, unknown> {
  kind: SearchKind;
  id: string;
  number: number | null;
  title: string;
  is_confidential: boolean;
  rank: number;
  kind_order: number;
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

/** Entities, Counterparties, and Requests are staff-wide reads. This
 * predicate stays in each candidate WHERE so a Contributor or Business
 * User cannot create a short page by having rows removed after LIMIT. */
function memberScope(user: AuthenticatedUser): SQL {
  return user.role === "administrator" || user.role === "legal_team_member"
    ? sql`true`
    : sql`false`;
}

/** The five M25/3 arms. Documents join this union in M25/4. */
function searchCtes(db: Db, user: AuthenticatedUser, query: string): SQL {
  const exact = exactNumber(query);
  const contractExact = exactPredicate(exact, "contract");
  const matterExact = exactPredicate(exact, "matter");
  const requestExact = exactPredicate(exact, "request");
  const staff = memberScope(user);

  return sql`
    search_query as (
      select websearch_to_tsquery('english', ${query}) as value
    ),
    contract_candidates as (
      select
        'contract'::text as kind,
        ${contracts.id} as id,
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
      where ${and(isNull(contracts.archivedAt), contractTeamScope(db, user))}
    ),
    contract_hits as (
      select
        kind, id, number, title, is_confidential, kind_order,
        case when exact_number
          then ${EXACT_NUMBER_RANK}::real
          else ts_rank_cd(array[0.05, 0.1, 0.5, 1.0]::real[], document, search_query.value)
        end as rank
      from contract_candidates
      cross join search_query
      where document @@ search_query.value or exact_number
    ),
    matter_candidates as (
      select
        'matter'::text as kind,
        ${matters.id} as id,
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
      where ${and(isNull(matters.archivedAt), matterTeamScope(db, user))}
    ),
    matter_hits as (
      select
        kind, id, number, title, is_confidential, kind_order,
        case when exact_number
          then ${EXACT_NUMBER_RANK}::real
          else ts_rank_cd(array[0.05, 0.1, 0.5, 1.0]::real[], document, search_query.value)
        end as rank
      from matter_candidates
      cross join search_query
      where document @@ search_query.value or exact_number
    ),
    entity_candidates as (
      select
        'entity'::text as kind,
        ${entities.id} as id,
        null::integer as number,
        ${entities.legalName} as title,
        false as is_confidential,
        3::integer as kind_order,
        ${entities.searchVector}
          || setweight(to_tsvector('english', coalesce(${entityTypes.displayName}, '')), 'C') as document
      from ${entities}
      inner join ${entityTypes} on ${entityTypes.id} = ${entities.entityTypeId}
      where ${and(isNull(entities.archivedAt), staff)}
    ),
    entity_hits as (
      select
        kind, id, number, title, is_confidential, kind_order,
        ts_rank_cd(array[0.05, 0.1, 0.5, 1.0]::real[], document, search_query.value) as rank
      from entity_candidates
      cross join search_query
      where document @@ search_query.value
    ),
    counterparty_candidates as (
      select
        'counterparty'::text as kind,
        ${counterparties.id} as id,
        null::integer as number,
        ${counterparties.name} as title,
        false as is_confidential,
        4::integer as kind_order,
        ${counterparties.searchVector} as document
      from ${counterparties}
      where ${and(isNull(counterparties.archivedAt), staff)}
    ),
    counterparty_hits as (
      select
        kind, id, number, title, is_confidential, kind_order,
        ts_rank_cd(array[0.05, 0.1, 0.5, 1.0]::real[], document, search_query.value) as rank
      from counterparty_candidates
      cross join search_query
      where document @@ search_query.value
    ),
    request_candidates as (
      select
        'request'::text as kind,
        ${requests.id} as id,
        ${requests.number} as number,
        ${requests.summary} as title,
        false as is_confidential,
        5::integer as kind_order,
        ${requestExact} as exact_number,
        ${requests.searchVector}
          || setweight(to_tsvector('english', coalesce(${requestTypes.displayName}, '')), 'C')
          || setweight(to_tsvector('english', coalesce(${users.displayName}, '')), 'C') as document
      from ${requests}
      inner join ${requestTypes} on ${requestTypes.id} = ${requests.requestTypeId}
      inner join ${users} on ${users.id} = ${requests.requesterId}
      where ${and(isNull(requests.archivedAt), staff)}
    ),
    request_hits as (
      select
        kind, id, number, title, is_confidential, kind_order,
        case when exact_number
          then ${EXACT_NUMBER_RANK}::real
          else ts_rank_cd(array[0.05, 0.1, 0.5, 1.0]::real[], document, search_query.value)
        end as rank
      from request_candidates
      cross join search_query
      where document @@ search_query.value or exact_number
    ),
    all_hits as (
      select * from contract_hits
      union all select * from matter_hits
      union all select * from entity_hits
      union all select * from counterparty_hits
      union all select * from request_hits
    )
  `;
}

function toSearchRow(row: SearchDbRow) {
  return {
    kind: row.kind,
    id: row.id,
    number: row.number,
    title: row.title,
    isConfidential: row.is_confidential,
    rank: row.rank,
  };
}

async function groupedSearch(db: Db, ctes: SQL): Promise<SearchDbRow[]> {
  const result = await db.execute<SearchDbRow>(sql`
    with ${ctes},
    ranked_hits as (
      select *, row_number() over (
        partition by kind_order order by rank desc, id desc
      ) as kind_position
      from all_hits
    )
    select kind, id, number, title, is_confidential, rank, kind_order
    from ranked_hits
    where kind_position <= ${GROUPED_LIMIT}
    order by kind_order, rank desc, id desc
  `);
  return result.rows;
}

async function flatSearch(
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
    select kind, id, number, title, is_confidential, rank, kind_order
    from all_hits
    where ${kindScope} and ${cursorScope}
    order by rank desc, id desc
    limit ${options.limit + 1}
  `);
  return result.rows;
}

export const searchRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/search",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "search",
        summary:
          "Ranked full-text search across Contracts, Matters, Entities, " +
          "Counterparties, and Requests (M25). Omit limit, kind, and cursor " +
          "for the header's grouped answer of ten per kind. Supplying any " +
          "of them selects the flat results-page order, which defaults to 25 " +
          "and pages by rank and id. Document is an accepted empty kind until M25/4",
        tags: ["search"],
        querystring: QuerySchema,
        response: {
          200: z.object({
            results: z.array(SearchRowSchema),
            nextCursor: z.string().nullable(),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const { q, kind, cursor, limit } = request.query;
      const ctes = searchCtes(app.db, request.user, q);
      const flat = kind !== undefined || cursor !== undefined || limit !== undefined;
      if (!flat) {
        const rows = await groupedSearch(app.db, ctes);
        return { results: rows.map(toSearchRow), nextCursor: null };
      }

      const pageSize = limit ?? FLAT_LIMIT;
      const rows = await flatSearch(app.db, ctes, { kind, cursor, limit: pageSize });
      const page = rows.slice(0, pageSize);
      return {
        results: page.map(toSearchRow),
        nextCursor: rows.length > pageSize ? (page.at(-1)?.id ?? null) : null,
      };
    },
  );
};
