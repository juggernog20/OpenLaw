// SPDX-License-Identifier: AGPL-3.0-only
/** CTR-008: reauthorize saved Request citations against the current Contract Type and source access. */
import {
  contracts,
  eq,
  contractTypeFields,
  type ContractAnalysisRun,
  type Executor,
} from "@openlaw/db";
import type { AuthenticatedUser } from "../../auth/guards.js";
import { selectAttachedFields } from "../../lib/custom-fields.js";
import { conversionSources } from "../../lib/conversion-draft.js";
import { conversionEvidence, type Evidence } from "../requests/conversion-evidence.js";
import { HttpError } from "../../lib/problem.js";
import { CORE_ANALYSIS_SLUGS } from "@openlaw/shared";

export async function requestAnalysisEvidence(
  db: Executor,
  user: AuthenticatedUser,
  run: ContractAnalysisRun,
  slug: string,
): Promise<Evidence> {
  return (await requestAnalysisEvidenceReader(db, user, run))(slug);
}

/** Load shared authorization inputs once for all results in a run. */
export async function requestAnalysisEvidenceReader(
  db: Executor,
  user: AuthenticatedUser,
  run: ContractAnalysisRun,
): Promise<(slug: string) => Promise<Evidence & { authorized: boolean }>> {
  const context = run.sourceContext;
  const unavailable = { authorized: true, available: false, citations: [] };
  if (!context) return async () => unavailable;
  const [contract] = await db
    .select({ typeId: contracts.contractTypeId })
    .from(contracts)
    .where(eq(contracts.id, run.contractId));
  if (!contract) return async () => unavailable;
  const fields = await selectAttachedFields(db, contractTypeFields, contract.typeId);
  const source = await conversionSources(db, context.requestId).catch((error: unknown) => {
    if (error instanceof HttpError && error.statusCode === 404) return null;
    throw error;
  });
  return async (slug) => {
    if (!(CORE_ANALYSIS_SLUGS as readonly string[]).includes(slug)) {
      const field = fields.find((field) => field.slug === slug);
      if (
        !field ||
        (field.fieldTag === "legal" && !["administrator", "legal_team_member"].includes(user.role))
      )
        return { ...unavailable, authorized: false };
    }
    if (!source || source.row.convertedContractId !== run.contractId) return unavailable;
    return {
      authorized: true,
      ...(await conversionEvidence(
        db,
        user,
        source,
        {
          id: run.id,
          attachmentReads: context.attachmentReads,
          originalCommentAttachments: true,
        },
        context.suggestions[slug],
      )),
    };
  };
}
