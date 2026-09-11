// SPDX-License-Identifier: AGPL-3.0-only
/** CTR-008: durable Analysis runs over the Request that became a Contract. */
import {
  aiConnector,
  aiFieldPrompts,
  comments,
  commentAttachments,
  contractTypes,
  contractTypeFields,
  fields,
  and,
  contractAnalysisRuns,
  contracts,
  documents,
  documentVersions,
  eq,
  isNull,
  lt,
  sql,
  or,
  users,
  type ContractAnalysisRun,
  type Executor,
  type Db,
} from "@openlaw/db";
import { conversionContext, hash } from "../lib/conversion-draft.js";
import { reachedContract } from "../lib/contract-access.js";
import type { JobQueue } from "./jobs.js";

export async function conversionAnalysisEnabled(db: Executor, lock = false) {
  const query = db.select().from(aiConnector).limit(1);
  const [connector] = await (lock ? query.for("share") : query);
  return connector?.disabledAt === null && connector.contractConversionAnalysis ? connector : null;
}

/** Reserve the run before promotion callbacks can request primary-Document analysis. */
export async function reserveConversionAnalysis(
  tx: Executor,
  input: { contractId: string; requestId: string; targetTypeId: string; actorId: string },
) {
  const connector = await conversionAnalysisEnabled(tx, true);
  if (!connector) return null;
  const [run] = await tx
    .insert(contractAnalysisRuns)
    .values({
      contractId: input.contractId,
      requestedBy: input.actorId,
      trigger: "conversion",
      preset: connector.preset,
      model: connector.model,
      sourceContext: {
        requestId: input.requestId,
        targetTypeId: input.targetTypeId,
        attachmentReads: [],
        suggestions: {},
        warnings: [],
      },
    })
    .returning();
  return run!;
}

/** Reconcile committed runs when a queue ask or process failed after conversion. */
export async function sweepConversionAnalysis(db: Db, jobs: JobQueue) {
  const runs = await db
    .select()
    .from(contractAnalysisRuns)
    .where(
      and(
        eq(contractAnalysisRuns.trigger, "conversion"),
        eq(contractAnalysisRuns.state, "pending"),
        or(
          isNull(contractAnalysisRuns.startedAt),
          lt(
            sql`coalesce(${contractAnalysisRuns.leaseAt}, ${contractAnalysisRuns.startedAt})`,
            new Date(Date.now() - 180_000),
          ),
        ),
      ),
    )
    .limit(100);
  for (const run of runs)
    await jobs.requestContractAnalysis(run.contractId, run.id).catch(() => false);
}

export async function requestAnalysisContext(db: Executor, run: ContractAnalysisRun, lock = false) {
  const source = run.sourceContext;
  if (!source || !run.requestedBy || !(await conversionAnalysisEnabled(db, lock)))
    throw new Error("disabled");
  const [actor] = await db.select().from(users).where(eq(users.id, run.requestedBy));
  const [contract] = await db.select().from(contracts).where(eq(contracts.id, run.contractId));
  if (
    !actor ||
    actor.archivedAt ||
    !["administrator", "legal_team_member"].includes(actor.role) ||
    !contract ||
    contract.archivedAt ||
    contract.endedAt ||
    contract.contractTypeId !== source.targetTypeId ||
    !(await reachedContract(db, actor, contract.number))
  )
    throw new Error("changed");
  if (lock) {
    await db
      .select({ id: contractTypes.id })
      .from(contractTypes)
      .where(eq(contractTypes.id, source.targetTypeId))
      .for("share");
    await db
      .select({ id: fields.id })
      .from(fields)
      .innerJoin(contractTypeFields, eq(contractTypeFields.fieldId, fields.id))
      .where(eq(contractTypeFields.typeId, source.targetTypeId))
      .for("share", { of: [fields, contractTypeFields] });
    await db.select().from(aiFieldPrompts).for("share");
    await db
      .select({ id: comments.id })
      .from(comments)
      .where(and(eq(comments.entityType, "contract"), eq(comments.entityId, contract.id)))
      .for("share");
    await db
      .select({ id: commentAttachments.id })
      .from(commentAttachments)
      .innerJoin(comments, eq(comments.id, commentAttachments.commentId))
      .where(and(eq(comments.entityType, "contract"), eq(comments.entityId, contract.id)))
      .for("share", { of: commentAttachments });
  }
  const context = await conversionContext(
    db,
    source.requestId,
    source.targetTypeId,
    lock,
    "contract",
  );
  if (context.row.convertedContractId !== run.contractId) throw new Error("changed");
  // A broadly visible Field cannot derive a fact from Confidential supporting paper.
  for (const attachment of context.attachments) {
    if (!attachment.versionId) {
      if (attachment.id.startsWith("attachment:")) attachment.restricted = true;
      continue;
    }
    const query = db
      .select({ id: documents.id })
      .from(documentVersions)
      .innerJoin(documents, eq(documents.id, documentVersions.documentId))
      .where(
        and(
          eq(documentVersions.id, attachment.versionId),
          eq(documents.contractId, contract.id),
          isNull(documents.archivedAt),
          eq(documents.isConfidential, false),
        ),
      );
    const [document] = await (lock ? query.for("share", { of: documents }) : query);
    if (!document) attachment.restricted = true;
  }
  context.snapshot = hash([context.snapshot, context.attachments]);
  return { context, actor, contract };
}
