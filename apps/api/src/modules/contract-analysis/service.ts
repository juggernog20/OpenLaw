// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared manual Analysis entry point for the HTTP route and MCP Tool (CTR-008).
 * Authorize and snapshot the selected Version before queuing the existing worker.
 */
import {
  and,
  contractAnalysisRuns,
  contracts,
  documentVersions,
  documents,
  eq,
  isNull,
  or,
  type Db,
} from "@openlaw/db";
import { NO_PERMISSION, type AuthenticatedUser } from "../../auth/guards.js";
import type { AiResolver } from "../../lib/ai/resolver.js";
import { documentAudienceScope, NO_CONTRACT, reachedContract } from "../../lib/contract-access.js";
import { httpError } from "../../lib/problem.js";
import { analysisTargetText, snapshottedTargetText } from "../../pipeline/contract-analysis.js";
import type { JobQueue } from "../../pipeline/jobs.js";

/** Manual runs keep the selected Version through queueing and retries. */
export async function runContractAnalysis(
  db: Db,
  user: AuthenticatedUser,
  number: number,
  resolveAiProvider: AiResolver,
  jobs: JobQueue,
  versionId?: string,
) {
  if (user.role !== "administrator" && user.role !== "legal_team_member")
    throw httpError(403, NO_PERMISSION);
  const run = await db.transaction(async (tx) => {
    const reached = await reachedContract(tx, user, number, { lock: true });
    if (!reached) throw httpError(404, NO_CONTRACT);
    const [record] = await tx
      .select({ endedAt: contracts.endedAt })
      .from(contracts)
      .where(eq(contracts.id, reached.id));
    if (reached.archivedAt || record?.endedAt)
      throw httpError(409, "This Contract is frozen and cannot be analyzed.");
    const provider = await resolveAiProvider();
    if (!provider) throw httpError(409, "No enabled AI connector is configured.");
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
    let target;
    if (versionId) {
      const [version] = await tx
        .select({ id: documentVersions.id })
        .from(documentVersions)
        .innerJoin(documents, eq(documentVersions.documentId, documents.id))
        .where(
          and(
            eq(documentVersions.id, versionId),
            eq(documents.contractId, reached.id),
            isNull(documents.archivedAt),
            documentAudienceScope(tx, user),
          ),
        )
        .limit(1);
      if (!version)
        throw httpError(404, "No readable Version exists on this Contract with that id.");
      target = await snapshottedTargetText(tx, reached.id, reached.contractTypeId, versionId);
    } else {
      if (!reached.primaryDocumentId)
        throw httpError(409, "This Contract has no primary Document to analyze.");
      const [paper] = await tx
        .select({ id: documents.id })
        .from(documents)
        .where(
          and(
            eq(documents.id, reached.primaryDocumentId),
            isNull(documents.archivedAt),
            documentAudienceScope(tx, user),
          ),
        )
        .limit(1);
      if (!paper) throw httpError(404, "No readable primary Document exists on this Contract.");
      target = await analysisTargetText(tx, reached.id);
    }
    if (!target) throw httpError(409, "The analysis target has no ready, non-empty text.");
    const [created] = await tx
      .insert(contractAnalysisRuns)
      .values({
        contractId: reached.id,
        versionId: target.versionId,
        state: "pending",
        trigger: "manual",
        requestedBy: user.id,
        preset: provider.preset,
        model: provider.model,
      })
      .returning();
    return created!;
  });
  let queued: boolean;
  try {
    queued = await jobs.requestContractAnalysis(run.contractId, run.id);
  } catch {
    await db.delete(contractAnalysisRuns).where(eq(contractAnalysisRuns.id, run.id));
    throw httpError(503, "The analysis run could not be queued. Try again.", { expose: true });
  }
  if (!queued) {
    await db.delete(contractAnalysisRuns).where(eq(contractAnalysisRuns.id, run.id));
    throw httpError(409, "An analysis run is already pending for this Contract.");
  }
  return run;
}
