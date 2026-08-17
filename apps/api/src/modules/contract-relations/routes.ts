// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A contract's relations graph (M17/1, CTR-015): the parent chain, the
 * children, and the typed links — in one read so a reader asking "what
 * is this contract connected to" asks one question.
 *
 * **Each relative is either reachable or restricted.** A reachable
 * relative carries its number, title, status name, and stage — everything
 * the relations panel needs to draw one card. A restricted relative
 * carries only `{ restricted: true }`, because a contract the viewer
 * cannot reach must be indistinguishable from one that was never created
 * except for the fact that it exists (CTR-015, DD-014): the link itself
 * is visible, but the thing it points at is not.
 *
 * **Reach is decided in bulk, not per row.** The viewer's
 * `contractTeamScope` predicate runs once over the union of every
 * contract that appears as a relative, and the result set says which of
 * them this viewer may see. That is one round trip, not N+1.
 *
 * **Access is inherited and nothing is held here** (DD-014, CTR-021).
 * The route answers the owning contract's reach question first, with the
 * same `reachedContract` the record, its paper, its approvals, its key
 * dates, and its feed are read through — so a viewer who cannot reach the
 * contract is answered exactly as for a contract that was never created.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  asc,
  contracts,
  contractRelations,
  contractStatuses,
  CONTRACT_RELATION_TYPES,
  CONTRACT_STAGES,
  type ContractStage,
  eq,
  inArray,
  isNull,
  or,
  type Executor,
} from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { contractTeamScope, NO_CONTRACT, reachedContract } from "../../lib/contract-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";

/** The contract read floor (CTR-021): a Contributor on the team reads the
 * relations panel. The role alone opens nothing — the reach predicate
 * narrows it to the records they hold a `contract_team` row on. */
const requireRelationsReader = requireRole("administrator", "legal_team_member", "contributor");

const NumberParams = z.object({ number: z.coerce.number().int().positive() });

const RestrictedRelativeSchema = z.object({ restricted: z.literal(true) });

const ReachableRelativeSchema = z.object({
  restricted: z.literal(false),
  number: z.number().int(),
  title: z.string(),
  statusName: z.string(),
  stage: z.enum(CONTRACT_STAGES),
});

const RelativeSchema = z.union([RestrictedRelativeSchema, ReachableRelativeSchema]);

const LinkSchema = z.object({
  relationType: z.enum(CONTRACT_RELATION_TYPES),
  direction: z.enum(["outgoing", "incoming"]),
  contract: RelativeSchema,
});

const RelationsEnvelope = z.object({
  parentChain: z.array(RelativeSchema),
  children: z.array(RelativeSchema),
  links: z.array(LinkSchema),
});

/** The columns a reachable relative carries in the response. */
interface ReachableRow {
  id: string;
  number: number;
  title: string;
  statusName: string;
  stage: ContractStage;
}

/**
 * All contracts the viewer can reach from a given set of ids, with the
 * columns the response needs. One round trip for every relative on the
 * graph rather than one per row.
 */
async function reachableRelatives(
  db: Executor,
  user: Parameters<typeof contractTeamScope>[1],
  ids: readonly string[],
): Promise<Map<string, ReachableRow>> {
  if (ids.length === 0) return new Map();

  const rows = await db
    .select({
      id: contracts.id,
      number: contracts.number,
      title: contracts.title,
      statusName: contractStatuses.displayName,
      stage: contractStatuses.stage,
    })
    .from(contracts)
    .innerJoin(contractStatuses, eq(contracts.statusId, contractStatuses.id))
    .where(and(inArray(contracts.id, [...ids]), contractTeamScope(db, user)));

  return new Map(rows.map((row) => [row.id, row]));
}

/** Turn an id into a reachable or restricted relative. */
function toRelative(
  reachable: Map<string, ReachableRow>,
  id: string,
): z.infer<typeof RelativeSchema> {
  const row = reachable.get(id);
  if (!row) return { restricted: true };
  return {
    restricted: false,
    number: row.number,
    title: row.title,
    statusName: row.statusName,
    stage: row.stage,
  };
}

export const contractRelationsRoutes: FastifyPluginAsyncZod = async (app) => {
  // ------------------------------------------------------------------
  // GET /contracts/:number/relations — the full relations graph
  // ------------------------------------------------------------------

  app.get(
    "/contracts/:number/relations",
    {
      preHandler: requireRelationsReader,
      schema: {
        operationId: "getContractRelations",
        summary:
          "The full relations graph for one contract (CTR-015): the " +
          "parent chain root-first, the children, and the typed links " +
          "in both directions. Each relative is either reachable — " +
          "carrying its number, title, status name, and stage — or " +
          "restricted, carrying only { restricted: true }. Access is " +
          "inherited from the contract: a Contributor on the team " +
          "reads the graph, and anyone who cannot reach the contract " +
          "is answered 404",
        tags: ["relations"],
        params: NumberParams,
        response: { 200: RelationsEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const contract = await reachedContract(app.db, request.user, request.params.number);
      if (!contract) throw httpError(404, NO_CONTRACT);

      // -- 1. Parent chain: walk up parentId --------------------------

      const parentIds: string[] = [];
      let currentId = contract.id;

      // Walk up. The depth is bounded by the cycle check the write path
      // enforces, and by the practical reality that nobody nests twenty
      // contracts. A guard at 100 stops a corrupted row from looping
      // forever.
      for (let depth = 0; depth < 100; depth++) {
        const [row] = await app.db
          .select({ id: contracts.id, parentId: contracts.parentId })
          .from(contracts)
          .where(eq(contracts.id, currentId))
          .limit(1);

        if (!row?.parentId) break;
        parentIds.push(row.parentId);
        currentId = row.parentId;
      }

      // Root-first: the walk collected leaf-to-root, so reverse it.
      parentIds.reverse();

      // -- 2. Children ------------------------------------------------

      const childRows = await app.db
        .select({ id: contracts.id })
        .from(contracts)
        .where(and(eq(contracts.parentId, contract.id), isNull(contracts.archivedAt)))
        // By number, so two reads of one record draw one list. A query
        // with no ORDER BY answers in whatever order the planner walked
        // the rows, and a list that reshuffles between loads reads as a
        // change nobody made.
        .orderBy(asc(contracts.number));

      const childIds = childRows.map((row) => row.id);

      // -- 3. Links ---------------------------------------------------

      const linkRows = await app.db
        .select({
          fromContractId: contractRelations.fromContractId,
          toContractId: contractRelations.toContractId,
          relationType: contractRelations.relationType,
        })
        .from(contractRelations)
        .where(
          or(
            eq(contractRelations.fromContractId, contract.id),
            eq(contractRelations.toContractId, contract.id),
          ),
        )
        // Oldest first, the order the links were made in — deterministic
        // for the same reason the children are.
        .orderBy(asc(contractRelations.createdAt), asc(contractRelations.relationType));

      const linkedIds = linkRows.map((row) =>
        row.fromContractId === contract.id ? row.toContractId : row.fromContractId,
      );

      // -- 4. Reach check in bulk -------------------------------------

      const allIds = [...new Set([...parentIds, ...childIds, ...linkedIds])];
      const reachable = await reachableRelatives(app.db, request.user, allIds);

      // -- 5. Assemble the response -----------------------------------

      const parentChain = parentIds.map((id) => toRelative(reachable, id));

      const children = childIds.map((id) => toRelative(reachable, id));

      const links = linkRows.map((row) => {
        const isOutgoing = row.fromContractId === contract.id;
        const otherId = isOutgoing ? row.toContractId : row.fromContractId;
        // `related` is symmetric — one row says it, read from either
        // end — so direction is always "outgoing" for it.
        return {
          relationType: row.relationType,
          direction:
            row.relationType === "related" || isOutgoing
              ? ("outgoing" as const)
              : ("incoming" as const),
          contract: toRelative(reachable, otherId),
        };
      });

      return { parentChain, children, links };
    },
  );
};
