// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The two automatic entry points for a CTR-008 analysis run (#664).
 *
 * A caller names the Version whose text became ready or whose executed
 * pin was set. This module decides whether that Version is the Contract's
 * analysis target now. It then writes the same run row and asks the same
 * Contract-keyed queue as the manual route.
 */

import {
  and,
  contractAnalysisRuns,
  contracts,
  documentVersions,
  documents,
  eq,
  isNotNull,
  isNull,
  type Db,
} from "@openlaw/db";
import type { AiResolver } from "../lib/ai/resolver.js";
import { analysisTargetText } from "./contract-analysis.js";
import { boundedQueueAsk, type JobQueue } from "./jobs.js";
import type { PipelineLogger } from "./logger.js";

export interface AutomaticContractAnalysisDeps {
  db: Db;
  jobs: JobQueue;
  resolveAiProvider: AiResolver;
  log: PipelineLogger;
}

/**
 * Queues one automatic run when `versionId` is the ready analysis target.
 *
 * Every ordinary skip is silent. The joined read excludes supporting
 * Documents and every non-Contract owner. The Contract lock then makes
 * target selection, frozen-record checks, and waiting-run collapse one
 * decision with the manual route. An active run has `started_at`; it does
 * not block one waiting follow-up.
 */
export async function requestAutomaticContractAnalysis(
  deps: AutomaticContractAnalysisDeps,
  versionId: string,
): Promise<void> {
  let createdRunId: string | null = null;
  try {
    const run = await deps.db.transaction(async (tx) => {
      const [candidate] = await tx
        .select({ contractId: contracts.id })
        .from(documentVersions)
        .innerJoin(documents, eq(documentVersions.documentId, documents.id))
        .innerJoin(
          contracts,
          and(
            eq(documents.contractId, contracts.id),
            eq(documents.id, contracts.primaryDocumentId),
          ),
        )
        .where(eq(documentVersions.id, versionId))
        .limit(1);
      if (!candidate) return null;

      const [contract] = await tx
        .select({ id: contracts.id, archivedAt: contracts.archivedAt, endedAt: contracts.endedAt })
        .from(contracts)
        .where(eq(contracts.id, candidate.contractId))
        .limit(1)
        .for("update");
      if (!contract || contract.archivedAt || contract.endedAt) return null;

      // Resolve while holding the same Contract lock that worker start
      // takes. The worker therefore cannot finish this target in the
      // gap between connector lookup and the coverage checks below.
      const provider = await deps.resolveAiProvider();
      if (!provider) return null;

      const target = await analysisTargetText(tx, contract.id);
      if (!target || target.versionId !== versionId) return null;

      const [waiting] = await tx
        .select({ id: contractAnalysisRuns.id })
        .from(contractAnalysisRuns)
        .where(
          and(
            eq(contractAnalysisRuns.contractId, contract.id),
            eq(contractAnalysisRuns.state, "pending"),
            isNull(contractAnalysisRuns.startedAt),
          ),
        )
        .limit(1);
      if (waiting) return null;

      // The text write and this callback commit before this lock is
      // taken. A waiting worker can therefore win the lock first and
      // snapshot this very Version. Its `started_at` and `version_id`
      // say that the new target is already covered; do not put an
      // identical successor behind it. An active run on an older
      // Version does need the successor below.
      const [coveringActiveRun] = await tx
        .select({ id: contractAnalysisRuns.id })
        .from(contractAnalysisRuns)
        .where(
          and(
            eq(contractAnalysisRuns.contractId, contract.id),
            eq(contractAnalysisRuns.state, "pending"),
            isNotNull(contractAnalysisRuns.startedAt),
            eq(contractAnalysisRuns.versionId, target.versionId),
          ),
        )
        .limit(1);
      if (coveringActiveRun) return null;

      const [created] = await tx
        .insert(contractAnalysisRuns)
        .values({
          contractId: contract.id,
          versionId: target.versionId,
          state: "pending",
          trigger: "automatic",
          requestedBy: null,
          preset: provider.preset,
          model: provider.model,
        })
        .returning();
      return created!;
    });
    if (!run) return;
    createdRunId = run.id;

    const queued = await boundedQueueAsk(deps.jobs.requestContractAnalysis(run.contractId, run.id));
    if (queued) return;
    await deps.db.delete(contractAnalysisRuns).where(eq(contractAnalysisRuns.id, run.id));
  } catch (error) {
    if (createdRunId) {
      try {
        await deps.db.delete(contractAnalysisRuns).where(eq(contractAnalysisRuns.id, createdRunId));
      } catch (cleanupError) {
        deps.log.error(
          { err: cleanupError, runId: createdRunId },
          "could not remove an unqueued automatic analysis run",
        );
      }
    }
    deps.log.error({ err: error, versionId }, "could not queue automatic contract analysis");
  }
}
