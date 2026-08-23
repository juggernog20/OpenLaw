// SPDX-License-Identifier: AGPL-3.0-only

/** MTR-007's one navigational Contract-to-Matter link, read from both records. */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  asc,
  contracts,
  contractStatuses,
  CONTRACT_STAGES,
  eq,
  ilike,
  inArray,
  isNull,
  matters,
  matterStatuses,
  or,
  type Executor,
  type Transaction,
} from "@openlaw/db";
import { requireRole, type AuthenticatedUser } from "../../auth/guards.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import { contractTeamScope, NO_CONTRACT, reachedContract } from "../../lib/contract-access.js";
import { escapeLikePattern } from "../../lib/like.js";
import { matterTeamScope, NO_MATTER, reachedMatter } from "../../lib/matter-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";

const requireReader = requireRole("administrator", "legal_team_member", "contributor");
const requireMember = requireRole("administrator", "legal_team_member");
const NumberParams = z.object({ number: z.coerce.number().int().positive() });
const CANDIDATE_PAGE = 20;
const ALREADY_LINKED =
  "This contract already belongs to a matter. Unlink it before linking it elsewhere.";

const RestrictedMatterSchema = z.strictObject({ restricted: z.literal(true) });
const ReachableMatterSchema = z.strictObject({
  restricted: z.literal(false),
  number: z.number().int(),
  title: z.string(),
  statusName: z.string(),
  statusCategory: z.enum(["open", "closed"]),
  isConfidential: z.boolean(),
  archived: z.boolean(),
});
const LinkedMatterSchema = z.union([RestrictedMatterSchema, ReachableMatterSchema]);
const MatterEnvelope = z.strictObject({ matter: LinkedMatterSchema.nullable() });
const LinkEnvelope = MatterEnvelope.extend({ confidentialityMismatch: z.boolean() });

const RestrictedContractSchema = z.strictObject({ restricted: z.literal(true) });
const ReachableContractSchema = z.strictObject({
  restricted: z.literal(false),
  number: z.number().int(),
  title: z.string(),
  statusName: z.string(),
  stage: z.enum(CONTRACT_STAGES),
  isConfidential: z.boolean(),
  archived: z.boolean(),
});
const LinkedContractSchema = z.union([RestrictedContractSchema, ReachableContractSchema]);
const ContractsEnvelope = z.strictObject({ contracts: z.array(LinkedContractSchema) });
const MatterCandidatesEnvelope = z.strictObject({
  candidates: z.array(ReachableMatterSchema.omit({ archived: true })),
});

/**
 * A linked record the viewer cannot independently reach remains present
 * as the title-free `{ restricted: true }` placeholder. Candidate
 * envelopes make the opposite projection: inaccessible and otherwise
 * ineligible records are silently omitted.
 */
async function linkedMatterEnvelope(
  db: Executor,
  user: AuthenticatedUser,
  matterId: string | null,
): Promise<z.infer<typeof MatterEnvelope>> {
  if (!matterId) return { matter: null };
  const [row] = await db
    .select({
      number: matters.number,
      title: matters.title,
      statusName: matterStatuses.displayName,
      statusCategory: matterStatuses.category,
      isConfidential: matters.isConfidential,
      archivedAt: matters.archivedAt,
    })
    .from(matters)
    .innerJoin(matterStatuses, eq(matters.statusId, matterStatuses.id))
    .where(and(eq(matters.id, matterId), matterTeamScope(db, user)))
    .limit(1);
  return row
    ? {
        matter: {
          restricted: false,
          number: row.number,
          title: row.title,
          statusName: row.statusName,
          statusCategory: row.statusCategory,
          isConfidential: row.isConfidential,
          archived: row.archivedAt !== null,
        },
      }
    : { matter: { restricted: true } };
}

async function linkedContractsEnvelope(
  db: Executor,
  user: AuthenticatedUser,
  matterId: string,
): Promise<z.infer<typeof ContractsEnvelope>> {
  const links = await db
    .select({ id: contracts.id })
    .from(contracts)
    .where(eq(contracts.matterId, matterId))
    .orderBy(asc(contracts.number));
  if (links.length === 0) return { contracts: [] };
  const reachable = await db
    .select({
      id: contracts.id,
      number: contracts.number,
      title: contracts.title,
      statusName: contractStatuses.displayName,
      stage: contractStatuses.stage,
      isConfidential: contracts.isConfidential,
      archivedAt: contracts.archivedAt,
    })
    .from(contracts)
    .innerJoin(contractStatuses, eq(contracts.statusId, contractStatuses.id))
    .where(
      and(
        inArray(
          contracts.id,
          links.map((row) => row.id),
        ),
        contractTeamScope(db, user),
      ),
    );
  const byId = new Map(reachable.map((row) => [row.id, row]));
  return {
    contracts: links.map(({ id }) => {
      const row = byId.get(id);
      return row
        ? {
            restricted: false as const,
            number: row.number,
            title: row.title,
            statusName: row.statusName,
            stage: row.stage,
            isConfidential: row.isConfidential,
            archived: row.archivedAt !== null,
          }
        : { restricted: true as const };
    }),
  };
}

async function reachedMatterById(tx: Transaction, user: AuthenticatedUser, id: string) {
  const [row] = await tx
    .select({
      number: matters.number,
      title: matters.title,
      archivedAt: matters.archivedAt,
    })
    .from(matters)
    .where(and(eq(matters.id, id), matterTeamScope(tx, user)))
    .limit(1)
    .for("update", { of: matters });
  return row ?? null;
}

async function matterCandidates(db: Executor, user: AuthenticatedUser, q: string) {
  const number = /^\d+$/.test(q) && Number(q) <= 2_147_483_647 ? Number(q) : null;
  const rows = await db
    .select({
      number: matters.number,
      title: matters.title,
      statusName: matterStatuses.displayName,
      statusCategory: matterStatuses.category,
      isConfidential: matters.isConfidential,
    })
    .from(matters)
    .innerJoin(matterStatuses, eq(matters.statusId, matterStatuses.id))
    .where(
      and(
        isNull(matters.archivedAt),
        matterTeamScope(db, user),
        number === null
          ? ilike(matters.title, `%${escapeLikePattern(q)}%`)
          : or(eq(matters.number, number), ilike(matters.title, `%${escapeLikePattern(q)}%`)),
      ),
    )
    .orderBy(asc(matters.number))
    .limit(CANDIDATE_PAGE);
  return { candidates: rows.map((row) => ({ restricted: false as const, ...row })) };
}

function assertLive(record: { archivedAt: Date | null }, noun: "contract" | "matter") {
  if (record.archivedAt) {
    throw httpError(409, `This ${noun} is archived. Restore it before editing.`);
  }
}

export const contractMattersRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/contracts/matter-candidates",
    {
      preHandler: requireMember,
      schema: {
        operationId: "listCreateContractMatterCandidates",
        summary:
          "Reachable live Matters eligible for optional Contract creation. Unreachable and archived Matters are silently omitted.",
        tags: ["contracts", "matters"],
        querystring: z.object({ q: z.string().trim().min(1).max(200) }),
        response: { 200: MatterCandidatesEnvelope, default: problemResponse },
      },
    },
    async (request) => matterCandidates(app.db, request.user, request.query.q),
  );

  app.get(
    "/contracts/:number/matter",
    {
      preHandler: requireReader,
      schema: {
        operationId: "getContractMatter",
        summary:
          "The one Matter this Contract belongs to, or null while it stands alone. A Matter the viewer cannot independently reach is { restricted: true } with no number or title.",
        tags: ["contracts", "matters"],
        params: NumberParams,
        response: { 200: MatterEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const contract = await reachedContract(app.db, request.user, request.params.number);
      if (!contract) throw httpError(404, NO_CONTRACT);
      return linkedMatterEnvelope(app.db, request.user, contract.matterId);
    },
  );

  app.get(
    "/matters/:number/contracts",
    {
      preHandler: requireReader,
      schema: {
        operationId: "listMatterContracts",
        summary:
          "Contracts whose one canonical matter_id names this Matter. Any Contract the viewer cannot independently reach is { restricted: true } with no number or title.",
        tags: ["contracts", "matters"],
        params: NumberParams,
        response: { 200: ContractsEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const matter = await reachedMatter(app.db, request.user, request.params.number);
      if (!matter) throw httpError(404, NO_MATTER);
      return linkedContractsEnvelope(app.db, request.user, matter.id);
    },
  );

  app.get(
    "/contracts/:number/matter-candidates",
    {
      preHandler: requireMember,
      schema: {
        operationId: "listContractMatterCandidates",
        summary:
          "Live Matters this Member+ viewer independently reaches and may link to a standalone Contract. Unreachable and archived Matters are silently omitted.",
        tags: ["contracts", "matters"],
        params: NumberParams,
        querystring: z.object({ q: z.string().trim().min(1).max(200) }),
        response: {
          200: MatterCandidatesEnvelope,
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const contract = await reachedContract(app.db, request.user, request.params.number);
      if (!contract) throw httpError(404, NO_CONTRACT);
      if (contract.archivedAt || contract.matterId) return { candidates: [] };
      return matterCandidates(app.db, request.user, request.query.q);
    },
  );

  app.get(
    "/matters/:number/contract-candidates",
    {
      preHandler: requireMember,
      schema: {
        operationId: "listMatterContractCandidates",
        summary:
          "Reachable live standalone Contracts eligible for this Matter's link flow. Linked, unreachable, and archived Contracts are silently omitted.",
        tags: ["contracts", "matters"],
        params: NumberParams,
        querystring: z.object({ q: z.string().trim().min(1).max(200) }),
        response: {
          200: z.strictObject({
            candidates: z.array(ReachableContractSchema.omit({ archived: true })),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const matter = await reachedMatter(app.db, request.user, request.params.number);
      if (!matter) throw httpError(404, NO_MATTER);
      if (matter.archivedAt) return { candidates: [] };
      const q = request.query.q;
      const number = /^\d+$/.test(q) && Number(q) <= 2_147_483_647 ? Number(q) : null;
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
            isNull(contracts.archivedAt),
            isNull(contracts.matterId),
            contractTeamScope(app.db, request.user),
            number === null
              ? ilike(contracts.title, `%${escapeLikePattern(q)}%`)
              : or(
                  eq(contracts.number, number),
                  ilike(contracts.title, `%${escapeLikePattern(q)}%`),
                ),
          ),
        )
        .orderBy(asc(contracts.number))
        .limit(CANDIDATE_PAGE);
      return { candidates: rows.map((row) => ({ restricted: false as const, ...row })) };
    },
  );

  app.post(
    "/contracts/:number/matter",
    {
      preHandler: requireMember,
      schema: {
        operationId: "linkContractMatter",
        summary:
          "Link one standalone Contract to one reachable live Matter. A Contract already linked anywhere must be explicitly unlinked first. Returns a one-time informational Confidentiality-mismatch signal and changes neither flag.",
        tags: ["contracts", "matters"],
        params: NumberParams,
        body: z.strictObject({ matterNumber: z.coerce.number().int().positive() }),
        response: { 201: LinkEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const result = await app.db.transaction(async (tx) => {
        const contract = await reachedContract(tx, request.user, request.params.number, {
          lock: true,
        });
        if (!contract) throw httpError(404, NO_CONTRACT);
        assertLive(contract, "contract");
        if (contract.matterId) throw httpError(409, ALREADY_LINKED);
        const matter = await reachedMatter(tx, request.user, request.body.matterNumber, {
          lock: true,
        });
        if (!matter) throw httpError(404, NO_MATTER);
        assertLive(matter, "matter");
        const [linked] = await tx
          .update(contracts)
          .set({ matterId: matter.id })
          .where(and(eq(contracts.id, contract.id), isNull(contracts.matterId)))
          .returning({ id: contracts.id });
        if (!linked) throw httpError(409, ALREADY_LINKED);
        await recordActivity(tx, {
          entityType: "contract",
          entityId: contract.id,
          actorId: request.user.id,
          action: "contract.matter_linked",
          visibility: RECORD_ACTIVITY_TIER,
          payload: {
            number: contract.number,
            title: contract.title,
            matterNumber: matter.number,
            matterTitle: matter.title,
          },
        });
        return { matterId: matter.id, mismatch: contract.isConfidential !== matter.isConfidential };
      });
      const envelope = await linkedMatterEnvelope(app.db, request.user, result.matterId);
      return reply.status(201).send({ ...envelope, confidentialityMismatch: result.mismatch });
    },
  );

  app.delete(
    "/contracts/:number/matter",
    {
      preHandler: requireMember,
      schema: {
        operationId: "unlinkContractMatter",
        summary:
          "Make a linked Contract standalone again. Requires Member+ reach to both records and writes one canonical Activity narration on the Contract.",
        tags: ["contracts", "matters"],
        params: NumberParams,
        response: { 200: MatterEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      await app.db.transaction(async (tx) => {
        const contract = await reachedContract(tx, request.user, request.params.number, {
          lock: true,
        });
        if (!contract) throw httpError(404, NO_CONTRACT);
        assertLive(contract, "contract");
        if (!contract.matterId) throw httpError(409, "This contract is already standalone.");
        const matter = await reachedMatterById(tx, request.user, contract.matterId);
        if (!matter) throw httpError(404, NO_MATTER);
        await tx.update(contracts).set({ matterId: null }).where(eq(contracts.id, contract.id));
        await recordActivity(tx, {
          entityType: "contract",
          entityId: contract.id,
          actorId: request.user.id,
          action: "contract.matter_unlinked",
          visibility: RECORD_ACTIVITY_TIER,
          payload: {
            number: contract.number,
            title: contract.title,
            matterNumber: matter.number,
            matterTitle: matter.title,
          },
        });
      });
      return { matter: null };
    },
  );
};
