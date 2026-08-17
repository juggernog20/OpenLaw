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
  ilike,
  inArray,
  isNull,
  or,
  sql,
  type Executor,
  type Transaction,
} from "@openlaw/db";
import {
  CONTRACT_PARENT_CYCLE_PROBLEM_TYPE,
  CONTRACT_RELATION_EXISTS_PROBLEM_TYPE,
  CONTRACT_SELF_LINK_PROBLEM_TYPE,
} from "@openlaw/shared";
import { requireRole, type AuthenticatedUser } from "../../auth/guards.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import {
  contractTeamScope,
  NO_CONTRACT,
  reachedContract,
  reachesLockedContract,
} from "../../lib/contract-access.js";
import {
  linkContracts,
  removeContractParent,
  setContractParent,
  unlinkContracts,
} from "../../lib/contract-relations.js";
import { escapeLikePattern } from "../../lib/like.js";
import { httpError, problemResponse, problemTypeResponse } from "../../lib/problem.js";

/** The contract read floor (CTR-021): a Contributor on the team reads the
 * relations panel. The role alone opens nothing — the reach predicate
 * narrows it to the records they hold a `contract_team` row on. */
const requireRelationsReader = requireRole("administrator", "legal_team_member", "contributor");

/** Every write — link, unlink, set-parent, unparent — is Member+. */
const requireMember = requireRole("administrator", "legal_team_member");

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

/**
 * The full relations graph for one contract, in the shape the routes
 * answer with. The GET reads it, and every write re-reads it after the
 * transaction commits — one builder, so the answer after a write cannot
 * drift from the answer a plain read gives.
 */
async function buildRelationsEnvelope(
  db: Executor,
  user: AuthenticatedUser,
  contractId: string,
): Promise<z.infer<typeof RelationsEnvelope>> {
  // -- 1. Parent chain: walk up parentId --------------------------

  const parentIds: string[] = [];
  let currentId = contractId;

  // Walk up. The depth is bounded by the cycle check the write path
  // enforces, and by the practical reality that nobody nests twenty
  // contracts. A guard at 100 stops a corrupted row from looping
  // forever.
  for (let depth = 0; depth < 100; depth++) {
    const [row] = await db
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

  const childRows = await db
    .select({ id: contracts.id })
    .from(contracts)
    .where(and(eq(contracts.parentId, contractId), isNull(contracts.archivedAt)))
    // By number, so two reads of one record draw one list. A query
    // with no ORDER BY answers in whatever order the planner walked
    // the rows, and a list that reshuffles between loads reads as a
    // change nobody made.
    .orderBy(asc(contracts.number));

  const childIds = childRows.map((row) => row.id);

  // -- 3. Links ---------------------------------------------------

  const linkRows = await db
    .select({
      fromContractId: contractRelations.fromContractId,
      toContractId: contractRelations.toContractId,
      relationType: contractRelations.relationType,
    })
    .from(contractRelations)
    .where(
      or(
        eq(contractRelations.fromContractId, contractId),
        eq(contractRelations.toContractId, contractId),
      ),
    )
    // Oldest first, the order the links were made in — deterministic
    // for the same reason the children are.
    .orderBy(asc(contractRelations.createdAt), asc(contractRelations.relationType));

  const linkedIds = linkRows.map((row) =>
    row.fromContractId === contractId ? row.toContractId : row.fromContractId,
  );

  // -- 4. Reach check in bulk -------------------------------------

  const allIds = [...new Set([...parentIds, ...childIds, ...linkedIds])];
  const reachable = await reachableRelatives(db, user, allIds);

  // -- 5. Assemble the response -----------------------------------

  const parentChain = parentIds.map((id) => toRelative(reachable, id));

  const children = childIds.map((id) => toRelative(reachable, id));

  const links = linkRows.map((row) => {
    const isOutgoing = row.fromContractId === contractId;
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
      return buildRelationsEnvelope(app.db, request.user, contract.id);
    },
  );

  // ------------------------------------------------------------------
  // GET /contracts/:number/link-candidates — the scoped picker
  // ------------------------------------------------------------------

  /** How many candidates one read answers. The picker is a typeahead,
   * so the page is short and a second keystroke narrows it. */
  const CANDIDATE_PAGE = 20;

  app.get(
    "/contracts/:number/link-candidates",
    {
      preHandler: requireMember,
      schema: {
        operationId: "listLinkCandidates",
        summary:
          "Contracts this viewer can reach that may be linked to the " +
          "given contract — the mention-candidates precedent applied " +
          "to relations (CTR-015, CTR-018). Found by number or title; " +
          "the contract itself and archived contracts are excluded",
        tags: ["relations"],
        params: NumberParams,
        querystring: z.object({
          q: z.string().trim().min(1).max(200),
        }),
        response: {
          200: z.object({
            candidates: z.array(
              z.object({
                number: z.number().int(),
                title: z.string(),
                statusName: z.string(),
                stage: z.enum(CONTRACT_STAGES),
                isConfidential: z.boolean(),
              }),
            ),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      // The anchor contract must be reachable — a picker behind a record
      // nobody can see must not answer.
      const anchor = await reachedContract(app.db, request.user, request.params.number);
      if (!anchor) throw httpError(404, NO_CONTRACT);

      const { q } = request.query;
      // Match by number when the digits fit CTR-003's integer reference
      // — a longer digit string cannot be a number the column holds, and
      // handing it to Postgres anyway would error the whole read.
      const digits = /^\d+$/.test(q) ? Number(q) : null;
      const numberMatch = digits !== null && digits <= 2_147_483_647 ? digits : null;
      // Wildcards typed into the query match literally, as every
      // typeahead here matches (the counterparty search's rule).
      const titlePattern = `%${escapeLikePattern(q)}%`;

      const rows = await app.db
        .select({
          number: contracts.number,
          title: contracts.title,
          statusName: contractStatuses.displayName,
          stage: contractStatuses.stage,
          isConfidential: contracts.isConfidential,
        })
        .from(contracts)
        .innerJoin(contractStatuses, eq(contracts.statusId, contractStatuses.id))
        .where(
          and(
            // Not itself
            sql`${contracts.id} <> ${anchor.id}`,
            // Not archived
            isNull(contracts.archivedAt),
            // Only reachable contracts
            contractTeamScope(app.db, request.user),
            // Search filter: number or title
            numberMatch !== null
              ? or(eq(contracts.number, numberMatch), ilike(contracts.title, titlePattern))
              : ilike(contracts.title, titlePattern),
          ),
        )
        .orderBy(asc(contracts.number))
        .limit(CANDIDATE_PAGE);

      return {
        candidates: rows.map((row) => ({
          number: row.number,
          title: row.title,
          statusName: row.statusName,
          stage: row.stage,
          isConfidential: row.isConfidential,
        })),
      };
    },
  );

  // ------------------------------------------------------------------
  // Helpers: lock both ends and verify reach
  // ------------------------------------------------------------------

  /**
   * Lock two contracts by number, verify the viewer reaches both, and
   * refuse archived ones. Every relation write needs this.
   */
  async function lockedPair(
    tx: Transaction,
    fromNumber: number,
    toNumber: number,
    user: AuthenticatedUser,
  ) {
    // Lock both in a deterministic order (by number, ascending) to
    // avoid deadlocks when two writers lock the same pair.
    const [firstNum, secondNum] =
      fromNumber < toNumber ? [fromNumber, toNumber] : [toNumber, fromNumber];

    const lockRow = async (number: number) => {
      const [locked] = await tx
        .select({
          id: contracts.id,
          number: contracts.number,
          title: contracts.title,
          archivedAt: contracts.archivedAt,
          managerId: contracts.managerId,
          isConfidential: contracts.isConfidential,
        })
        .from(contracts)
        .where(eq(contracts.number, number))
        .limit(1)
        .for("update");
      if (!locked) throw httpError(404, NO_CONTRACT);
      if (!(await reachesLockedContract(tx, user, locked))) {
        throw httpError(404, NO_CONTRACT);
      }
      if (locked.archivedAt) {
        throw httpError(409, "This contract is archived. Restore it before editing.");
      }
      return locked;
    };

    const first = await lockRow(firstNum);
    const second = await lockRow(secondNum);

    const from = first.number === fromNumber ? first : second;
    const to = first.number === toNumber ? first : second;

    return { from, to };
  }

  // ------------------------------------------------------------------
  // POST /contracts/:number/relations — add a typed link
  // ------------------------------------------------------------------

  app.post(
    "/contracts/:number/relations",
    {
      preHandler: requireMember,
      schema: {
        operationId: "addContractRelation",
        summary:
          "Link this contract to another with a chosen type — " +
          "`related`, `renews`, or `amends` — through CTR-015's " +
          "shared guarded path. Requires Member+ with reach on both " +
          "ends. Narrates with `contract.relation_added` on the " +
          "acted-from record only",
        tags: ["relations"],
        params: NumberParams,
        body: z.strictObject({
          relatedContractNumber: z.coerce.number().int().positive(),
          relationType: z.enum(CONTRACT_RELATION_TYPES),
        }),
        response: {
          201: RelationsEnvelope,
          409: problemTypeResponse(
            "The link already exists, both ends are one contract, or " +
              "the pair is already linked this way. An unnamed 409 is " +
              "an archived record; print it.",
            [CONTRACT_RELATION_EXISTS_PROBLEM_TYPE, CONTRACT_SELF_LINK_PROBLEM_TYPE],
          ),
          default: problemResponse,
        },
      },
    },
    async (request, reply) => {
      const { relatedContractNumber, relationType } = request.body;

      await app.db.transaction(async (tx) => {
        const pair = await lockedPair(
          tx,
          request.params.number,
          relatedContractNumber,
          request.user,
        );

        await linkContracts(tx, {
          fromId: pair.from.id,
          toId: pair.to.id,
          relationType,
        });

        await recordActivity(tx, {
          entityType: "contract",
          entityId: pair.from.id,
          actorId: request.user.id,
          action: "contract.relation_added",
          visibility: RECORD_ACTIVITY_TIER,
          payload: {
            number: pair.from.number,
            title: pair.from.title,
            relationType,
            relatedNumber: pair.to.number,
            relatedTitle: pair.to.title,
          },
        });
      });

      // Re-read the full relations graph, outside the write transaction,
      // exactly as the read route does.
      const contract = await reachedContract(app.db, request.user, request.params.number);
      if (!contract) throw httpError(404, NO_CONTRACT);
      const envelope = await buildRelationsEnvelope(app.db, request.user, contract.id);
      return reply.status(201).send(envelope);
    },
  );

  // ------------------------------------------------------------------
  // DELETE /contracts/:number/relations — remove a typed link
  // ------------------------------------------------------------------

  app.delete(
    "/contracts/:number/relations",
    {
      preHandler: requireMember,
      schema: {
        operationId: "removeContractRelation",
        summary:
          "Unlink this contract from another — the removal sibling of " +
          "addContractRelation. Requires Member+ with reach on both " +
          "ends. Narrates with `contract.relation_removed` on the " +
          "acted-from record only",
        tags: ["relations"],
        params: NumberParams,
        body: z.strictObject({
          relatedContractNumber: z.coerce.number().int().positive(),
          relationType: z.enum(CONTRACT_RELATION_TYPES),
        }),
        response: {
          200: RelationsEnvelope,
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const { relatedContractNumber, relationType } = request.body;

      await app.db.transaction(async (tx) => {
        const pair = await lockedPair(
          tx,
          request.params.number,
          relatedContractNumber,
          request.user,
        );

        await unlinkContracts(tx, {
          fromId: pair.from.id,
          toId: pair.to.id,
          relationType,
        });

        await recordActivity(tx, {
          entityType: "contract",
          entityId: pair.from.id,
          actorId: request.user.id,
          action: "contract.relation_removed",
          visibility: RECORD_ACTIVITY_TIER,
          payload: {
            number: pair.from.number,
            title: pair.from.title,
            relationType,
            relatedNumber: pair.to.number,
            relatedTitle: pair.to.title,
          },
        });
      });

      const contract = await reachedContract(app.db, request.user, request.params.number);
      if (!contract) throw httpError(404, NO_CONTRACT);
      return buildRelationsEnvelope(app.db, request.user, contract.id);
    },
  );

  // ------------------------------------------------------------------
  // POST /contracts/:number/parent — set parent
  // ------------------------------------------------------------------

  app.post(
    "/contracts/:number/parent",
    {
      preHandler: requireMember,
      schema: {
        operationId: "setContractParent",
        summary:
          "Put this contract under another — CTR-015's hierarchy. " +
          "Requires Member+ with reach on both ends. Narrates with " +
          "`contract.parent_set` on the acted-from record only",
        tags: ["relations"],
        params: NumberParams,
        body: z.strictObject({
          parentContractNumber: z.coerce.number().int().positive(),
        }),
        response: {
          201: RelationsEnvelope,
          409: problemTypeResponse(
            "The parent would close a loop. An unnamed 409 is an " + "archived record; print it.",
            [CONTRACT_PARENT_CYCLE_PROBLEM_TYPE],
          ),
          default: problemResponse,
        },
      },
    },
    async (request, reply) => {
      const { parentContractNumber } = request.body;

      await app.db.transaction(async (tx) => {
        const pair = await lockedPair(
          tx,
          request.params.number,
          parentContractNumber,
          request.user,
        );

        await setContractParent(tx, {
          childId: pair.from.id,
          parentId: pair.to.id,
        });

        await recordActivity(tx, {
          entityType: "contract",
          entityId: pair.from.id,
          actorId: request.user.id,
          action: "contract.parent_set",
          visibility: RECORD_ACTIVITY_TIER,
          payload: {
            number: pair.from.number,
            title: pair.from.title,
            parentNumber: pair.to.number,
            parentTitle: pair.to.title,
          },
        });
      });

      const contract = await reachedContract(app.db, request.user, request.params.number);
      if (!contract) throw httpError(404, NO_CONTRACT);
      const envelope = await buildRelationsEnvelope(app.db, request.user, contract.id);
      return reply.status(201).send(envelope);
    },
  );

  // ------------------------------------------------------------------
  // DELETE /contracts/:number/parent — remove parent
  // ------------------------------------------------------------------

  app.delete(
    "/contracts/:number/parent",
    {
      preHandler: requireMember,
      schema: {
        operationId: "removeContractParent",
        summary:
          "Take this contract out from under its parent — the removal " +
          "sibling of setContractParent. Requires Member+ with reach " +
          "on both the child and the parent. Narrates with " +
          "`contract.parent_removed` on the acted-from record only",
        tags: ["relations"],
        params: NumberParams,
        response: {
          200: RelationsEnvelope,
          default: problemResponse,
        },
      },
    },
    async (request) => {
      await app.db.transaction(async (tx) => {
        // Find both ends before taking any row lock, so the two rows
        // can be locked in the same ascending-number order every other
        // pair writer uses (`lockedPair`) — two writers meeting over
        // one pair in opposite orders is a deadlock.
        const [preread] = await tx
          .select({ parentId: contracts.parentId })
          .from(contracts)
          .where(eq(contracts.number, request.params.number))
          .limit(1);
        if (!preread) throw httpError(404, NO_CONTRACT);

        const parentRef = preread.parentId
          ? (
              await tx
                .select({ id: contracts.id, number: contracts.number })
                .from(contracts)
                .where(eq(contracts.id, preread.parentId))
                .limit(1)
            )[0]
          : undefined;

        const lockChild = async () => {
          const [row] = await tx
            .select({
              id: contracts.id,
              number: contracts.number,
              title: contracts.title,
              parentId: contracts.parentId,
              archivedAt: contracts.archivedAt,
              managerId: contracts.managerId,
              isConfidential: contracts.isConfidential,
            })
            .from(contracts)
            .where(eq(contracts.number, request.params.number))
            .limit(1)
            .for("update");
          return row;
        };
        // No archived check on the parent, on purpose: a contract must
        // be removable from under a parent that was archived after the
        // tie was made, or the archive strands it there.
        const lockParent = async () => {
          if (!parentRef) return undefined;
          const [row] = await tx
            .select({
              id: contracts.id,
              number: contracts.number,
              title: contracts.title,
              managerId: contracts.managerId,
              isConfidential: contracts.isConfidential,
            })
            .from(contracts)
            .where(eq(contracts.id, parentRef.id))
            .limit(1)
            .for("update");
          return row;
        };

        let child: Awaited<ReturnType<typeof lockChild>>;
        let parent: Awaited<ReturnType<typeof lockParent>>;
        if (parentRef && parentRef.number < request.params.number) {
          parent = await lockParent();
          child = await lockChild();
        } else {
          child = await lockChild();
          parent = await lockParent();
        }

        if (!child) throw httpError(404, NO_CONTRACT);
        if (!(await reachesLockedContract(tx, request.user, child))) {
          throw httpError(404, NO_CONTRACT);
        }
        if (child.archivedAt) {
          throw httpError(409, "This contract is archived. Restore it before editing.");
        }
        if (!child.parentId) {
          throw httpError(409, "This contract does not have a parent.");
        }
        if (!parent || child.parentId !== parent.id) {
          // The tie moved between the unlocked pre-read and the locks —
          // a concurrent writer re-parented the contract. The remover
          // must not act on a parent it did not verify reach on.
          throw httpError(409, "This contract's parent just changed. Reload and try again.");
        }
        if (!(await reachesLockedContract(tx, request.user, parent))) {
          throw httpError(404, NO_CONTRACT);
        }

        await removeContractParent(tx, child.id);

        await recordActivity(tx, {
          entityType: "contract",
          entityId: child.id,
          actorId: request.user.id,
          action: "contract.parent_removed",
          visibility: RECORD_ACTIVITY_TIER,
          payload: {
            number: child.number,
            title: child.title,
            parentNumber: parent.number,
            parentTitle: parent.title,
          },
        });
      });

      const contract = await reachedContract(app.db, request.user, request.params.number);
      if (!contract) throw httpError(404, NO_CONTRACT);
      return buildRelationsEnvelope(app.db, request.user, contract.id);
    },
  );
};
