// SPDX-License-Identifier: AGPL-3.0-only
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
import { CORE_ANALYSIS_SLUGS } from "@openlaw/shared";

export async function requestAnalysisEvidence(
  db: Executor,
  user: AuthenticatedUser,
  run: ContractAnalysisRun,
  slug: string,
): Promise<Evidence> {
  const context = run.sourceContext;
  const unavailable = { available: false, citations: [] };
  if (!context) return unavailable;
  const [contract] = await db
    .select({ typeId: contracts.contractTypeId })
    .from(contracts)
    .where(eq(contracts.id, run.contractId));
  if (!contract) return unavailable;
  if (!(CORE_ANALYSIS_SLUGS as string[]).includes(slug)) {
    const fields = await selectAttachedFields(db, contractTypeFields, contract.typeId);
    const field = fields.find((field) => field.slug === slug);
    if (
      !field ||
      (field.fieldTag === "legal" && !["administrator", "legal_team_member"].includes(user.role))
    )
      return unavailable;
  }
  const source = await conversionSources(db, context.requestId).catch(() => null);
  if (!source || source.row.convertedContractId !== run.contractId) return unavailable;
  return conversionEvidence(
    db,
    user,
    source,
    {
      id: run.id,
      attachmentReads: context.attachmentReads,
      originalCommentAttachments: true,
    },
    context.suggestions[slug],
  );
}
