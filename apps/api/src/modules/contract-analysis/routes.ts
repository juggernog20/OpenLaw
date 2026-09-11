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
  documents,
  documentVersions,
  eq,
  isNull,
  or,
  type ContractAnalysisRun,
  type Executor,
} from "@openlaw/db";
import { CONTRACT_ANALYSIS_RESULT_OUTCOMES } from "@openlaw/shared";
import { requireRole, type AuthenticatedUser } from "../../auth/guards.js";
import { documentAudienceScope, NO_CONTRACT, reachedContract } from "../../lib/contract-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import {
  reserveConversionAnalysis,
  conversionAnalysisEnabled,
} from "../../pipeline/conversion-analysis.js";
import { requestAnalysisEvidence, requestAnalysisEvidenceReader } from "./request-evidence.js";
import { EvidenceSchema } from "../requests/conversion-evidence.js";
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
  trigger: z.enum(["automatic", "manual", "conversion"]),
  requestedBy: z.string().nullable(),
  preset: z.enum(AI_PRESETS),
  model: z.string(),
  truncated: z.boolean(),
  outcome: AnalysisOutcomeSchema.nullable(),
  warnings: z.array(z.string()).optional(),
  failure: z.string().nullable(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
});

export function toAnalysisRun(run: ContractAnalysisRun, versionNumber: number | null = null) {
  return {
    ...run,
    versionNumber,
    warnings: run.sourceContext?.warnings ?? [],
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

export async function latestAnalysisRun(db: Executor, contractId: string, user: AuthenticatedUser) {
  const [row] = await db
    .select({ run: contractAnalysisRuns, versionNumber: documentVersions.versionNumber })
    .from(contractAnalysisRuns)
    .leftJoin(documentVersions, eq(contractAnalysisRuns.versionId, documentVersions.id))
    .where(eq(contractAnalysisRuns.contractId, contractId))
    .orderBy(desc(contractAnalysisRuns.id))
    .limit(1);
  if (!row) return null;

  const [reachableVersion] = row.run.versionId
    ? await db
        .select({ id: documentVersions.id })
        .from(documentVersions)
        .innerJoin(documents, eq(documentVersions.documentId, documents.id))
        .where(and(eq(documentVersions.id, row.run.versionId), documentAudienceScope(db, user)))
        .limit(1)
    : [];
  if (row.run.sourceContext && row.run.outcome?.results) {
    const results = [];
    const readEvidence = await requestAnalysisEvidenceReader(db, user, row.run);
    for (const result of row.run.outcome.results) {
      const evidence = await readEvidence(result.slug);
      results.push(evidence.available ? result : { ...result, value: null, evidence: null });
    }
    return {
      ...toAnalysisRun(row.run, row.versionNumber),
      outcome: { ...row.run.outcome, unmatched: undefined, results },
    };
  }
  if (!reachableVersion && row.run.outcome?.results) {
    const visibleOutcome = {
      written: row.run.outcome.written,
      kept: row.run.outcome.kept,
      unsupported: row.run.outcome.unsupported,
      invalid: row.run.outcome.invalid,
      ...(!row.run.sourceContext && row.run.outcome.unmatched !== undefined
        ? { unmatched: row.run.outcome.unmatched }
        : {}),
    };
    return { ...toAnalysisRun(row.run, row.versionNumber), outcome: visibleOutcome };
  }
  return toAnalysisRun(row.run, row.versionNumber);
}

const requireMember = requireRole("administrator", "legal_team_member");

export const contractAnalysisRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/contracts/:number/analysis/:runId/evidence/:slug",
    {
      preHandler: requireRole("administrator", "legal_team_member", "contributor"),
      schema: {
        operationId: "getRequestAnalysisEvidence",
        tags: ["contracts"],
        params: NumberParams.extend({ runId: z.string(), slug: z.string() }),
        response: { 200: EvidenceSchema, default: problemResponse },
      },
    },
    async (request) => {
      const contract = await reachedContract(app.db, request.user, request.params.number);
      if (!contract) throw httpError(404, NO_CONTRACT);
      const [run] = await app.db
        .select()
        .from(contractAnalysisRuns)
        .where(
          and(
            eq(contractAnalysisRuns.id, request.params.runId),
            eq(contractAnalysisRuns.contractId, contract.id),
          ),
        );
      if (!run) throw httpError(404, "Analysis evidence is unavailable.");
      return requestAnalysisEvidence(app.db, request.user, run, request.params.slug);
    },
  );
  app.post(
    "/contracts/:number/analysis/:runId/retry",
    {
      preHandler: requireMember,
      schema: {
        operationId: "retryRequestAnalysis",
        tags: ["contracts"],
        params: NumberParams.extend({ runId: z.string() }),
        response: { 202: z.object({ run: AnalysisRunSchema }), default: problemResponse },
      },
    },
    async (request, reply) => {
      const run = await app.db.transaction(async (tx) => {
        const contract = await reachedContract(tx, request.user, request.params.number, {
          lock: true,
        });
        if (!contract) throw httpError(404, NO_CONTRACT);
        const [state] = await tx
          .select({ endedAt: contracts.endedAt })
          .from(contracts)
          .where(eq(contracts.id, contract.id));
        if (contract.archivedAt || state?.endedAt || !(await conversionAnalysisEnabled(tx, true)))
          throw httpError(
            409,
            "Request-context Analysis is unavailable. Check the AI settings and Contract.",
          );
        const [previous] = await tx
          .select()
          .from(contractAnalysisRuns)
          .where(
            and(
              eq(contractAnalysisRuns.id, request.params.runId),
              eq(contractAnalysisRuns.contractId, contract.id),
            ),
          );
        if (!previous?.sourceContext || previous.state !== "failed")
          throw httpError(409, "Only a failed Request-context Analysis run can be retried.");
        const [pending] = await tx
          .select()
          .from(contractAnalysisRuns)
          .where(
            and(
              eq(contractAnalysisRuns.contractId, contract.id),
              eq(contractAnalysisRuns.state, "pending"),
            ),
          );
        // A second retry joins the run the first one reserved. A pending
        // Document run is somebody else's work: queueing this retry behind it
        // would report a run that never reads the Request.
        if (pending?.trigger === "conversion") return pending;
        if (pending)
          throw httpError(409, "Another Analysis run is already pending on this Contract.");
        return (await reserveConversionAnalysis(tx, {
          contractId: contract.id,
          requestId: previous.sourceContext.requestId,
          targetTypeId: contract.contractTypeId,
          actorId: request.user.id,
        }))!;
      });
      void app.jobs.requestContractAnalysis(run.contractId, run.id).catch(() => false);
      return reply.status(202).send({ run: toAnalysisRun(run) });
    },
  );
  app.get(
    "/contracts/:number/analysis/:runId",
    {
      preHandler: requireRole("administrator", "legal_team_member", "contributor"),
      schema: {
        operationId: "getContractAnalysisRun",
        summary: "Read an analysis run and its evidence when its source Document is accessible",
        tags: ["contracts"],
        params: NumberParams.extend({ runId: z.string().min(1).max(200) }),
        response: {
          200: z.object({ run: AnalysisRunSchema, documentId: z.string() }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const reached = await reachedContract(app.db, request.user, request.params.number);
      if (!reached) throw httpError(404, NO_CONTRACT);
      const [row] = await app.db
        .select({
          run: contractAnalysisRuns,
          versionNumber: documentVersions.versionNumber,
          documentId: documents.id,
        })
        .from(contractAnalysisRuns)
        .innerJoin(documentVersions, eq(contractAnalysisRuns.versionId, documentVersions.id))
        .innerJoin(documents, eq(documentVersions.documentId, documents.id))
        .where(
          and(
            eq(contractAnalysisRuns.id, request.params.runId),
            eq(contractAnalysisRuns.contractId, reached.id),
            documentAudienceScope(app.db, request.user),
          ),
        )
        .limit(1);
      if (!row) throw httpError(404, "Analysis evidence is not available.");
      return { run: toAnalysisRun(row.run, row.versionNumber), documentId: row.documentId };
    },
  );

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
              or(
                isNull(contractAnalysisRuns.startedAt),
                eq(contractAnalysisRuns.trigger, "conversion"),
              ),
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
        throw httpError(503, "The analysis run could not be queued. Try again.", { expose: true });
      }
      if (!queued) {
        await app.db.delete(contractAnalysisRuns).where(eq(contractAnalysisRuns.id, run.id));
        throw httpError(409, "An analysis run is already pending for this Contract.");
      }
      return reply.status(202).send({ run: toAnalysisRun(run) });
    },
  );
};
