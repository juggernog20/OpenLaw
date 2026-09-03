// SPDX-License-Identifier: AGPL-3.0-only

/** The Member+ manual entry point for one durable CTR-008 analysis run. */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  AI_PRESETS,
  and,
  contractAnalysisRuns,
  contracts,
  desc,
  documentVersions,
  eq,
  isNull,
  type ContractAnalysisRun,
  type Executor,
} from "@openlaw/db";
import { CONTRACT_ANALYSIS_RESULT_OUTCOMES } from "@openlaw/shared";
import { requireRole } from "../../auth/guards.js";
import { NO_CONTRACT, reachedContract } from "../../lib/contract-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { analysisTargetText } from "../../pipeline/contract-analysis.js";

const NumberParams = z.object({ number: z.coerce.number().int().positive() });

const AnalysisOutcomeSchema = z.object({
  written: z.array(z.string()),
  kept: z.array(z.string()),
  unsupported: z.array(z.string()),
  invalid: z.array(z.string()),
  unmatched: z.string().optional(),
  // Existing run rows predate the review-card detail. They remain
  // readable and simply have no detailed rows to draw.
  results: z
    .array(
      z.object({
        slug: z.string(),
        value: z.unknown(),
        evidence: z.string().nullable(),
        outcome: z.enum(CONTRACT_ANALYSIS_RESULT_OUTCOMES),
      }),
    )
    .optional(),
});

export const AnalysisRunSchema = z.object({
  id: z.string(),
  contractId: z.string(),
  versionId: z.string().nullable(),
  versionNumber: z.number().int().positive().nullable(),
  state: z.enum(["pending", "ready", "failed"]),
  trigger: z.enum(["automatic", "manual"]),
  requestedBy: z.string().nullable(),
  preset: z.enum(AI_PRESETS),
  model: z.string(),
  truncated: z.boolean(),
  outcome: AnalysisOutcomeSchema.nullable(),
  failure: z.string().nullable(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
});

export function toAnalysisRun(run: ContractAnalysisRun, versionNumber: number | null = null) {
  return {
    ...run,
    versionNumber,
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

export async function latestAnalysisRun(db: Executor, contractId: string) {
  const [row] = await db
    .select({ run: contractAnalysisRuns, versionNumber: documentVersions.versionNumber })
    .from(contractAnalysisRuns)
    .leftJoin(documentVersions, eq(contractAnalysisRuns.versionId, documentVersions.id))
    .where(eq(contractAnalysisRuns.contractId, contractId))
    .orderBy(desc(contractAnalysisRuns.id))
    .limit(1);
  return row ? toAnalysisRun(row.run, row.versionNumber) : null;
}

const requireMember = requireRole("administrator", "legal_team_member");

export const contractAnalysisRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/contracts/:number/analysis",
    {
      preHandler: requireMember,
      schema: {
        operationId: "runContractAnalysis",
        summary:
          "Queue one manual CTR-008 analysis of the primary Document's executed pin, or its current Version when no pin exists. One waiting run is allowed per Contract; a run that has already started does not block one follow-up. Member+ only, on a live record with ready text and an enabled AI connector",
        tags: ["contracts"],
        params: NumberParams,
        response: {
          202: z.object({ run: AnalysisRunSchema }),
          default: problemResponse,
        },
      },
    },
    async (request, reply) => {
      const provider = await app.resolveAiProvider();
      if (!provider) throw httpError(409, "No enabled AI connector is configured.");

      const run = await app.db.transaction(async (tx) => {
        const reached = await reachedContract(tx, request.user, request.params.number, {
          lock: true,
        });
        if (!reached) throw httpError(404, NO_CONTRACT);
        const [record] = await tx
          .select({ endedAt: contracts.endedAt })
          .from(contracts)
          .where(eq(contracts.id, reached.id))
          .limit(1);
        if (reached.archivedAt || record?.endedAt) {
          throw httpError(409, "This Contract is frozen and cannot be analyzed.");
        }
        const [pending] = await tx
          .select({ id: contractAnalysisRuns.id })
          .from(contractAnalysisRuns)
          .where(
            and(
              eq(contractAnalysisRuns.contractId, reached.id),
              eq(contractAnalysisRuns.state, "pending"),
              isNull(contractAnalysisRuns.startedAt),
            ),
          )
          .limit(1);
        if (pending) throw httpError(409, "An analysis run is already pending for this Contract.");

        const target = await analysisTargetText(tx, reached.id);
        if (!reached.primaryDocumentId) {
          throw httpError(409, "This Contract has no primary Document to analyze.");
        }
        if (!target) {
          throw httpError(409, "The analysis target has no ready, non-empty text.");
        }
        const [created] = await tx
          .insert(contractAnalysisRuns)
          .values({
            contractId: reached.id,
            versionId: target.versionId,
            state: "pending",
            trigger: "manual",
            requestedBy: request.user.id,
            preset: provider.preset,
            model: provider.model,
          })
          .returning();
        return created!;
      });

      let queued: boolean;
      try {
        queued = await app.jobs.requestContractAnalysis(run.contractId, run.id);
      } catch (error) {
        await app.db.delete(contractAnalysisRuns).where(eq(contractAnalysisRuns.id, run.id));
        request.log.error({ err: error, runId: run.id }, "could not queue contract analysis");
        throw httpError(503, "The analysis run could not be queued. Try again.");
      }
      if (!queued) {
        await app.db.delete(contractAnalysisRuns).where(eq(contractAnalysisRuns.id, run.id));
        throw httpError(409, "An analysis run is already pending for this Contract.");
      }
      return reply.status(202).send({ run: toAnalysisRun(run) });
    },
  );
};
