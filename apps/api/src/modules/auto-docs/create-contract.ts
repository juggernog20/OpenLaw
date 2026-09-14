// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-005: write the generated Contract and primary Document in the Generation transaction. */
import { contracts, documents, entities, eq, users, type AutoDocGeneration } from "@openlaw/db";
import { linkPrimaryCounterparty } from "../../lib/counterparty-link.js";
import { insertDocumentVersion, type AppendedVersion } from "../../lib/document-versions.js";
import type { Notifier, NotifyingTransaction } from "../../lib/notifications/notifier.js";
import { httpError } from "../../lib/problem.js";
import { createContract } from "../contracts/create.js";

/** The caller owns the Generation transaction and the stored Word copy. */
export async function createGeneratedContract(
  tx: NotifyingTransaction,
  notifier: Notifier,
  generation: AutoDocGeneration,
  version: AppendedVersion,
) {
  const facts = generation.contractSnapshot!;
  for (const id of facts.entityId ? [facts.entityId] : []) {
    const [entity] = await tx
      .select({ archivedAt: entities.archivedAt })
      .from(entities)
      .where(eq(entities.id, id))
      .for("share");
    if (!entity || entity.archivedAt)
      throw httpError(400, "The Contract's Entity is no longer available.");
  }
  if (facts.businessOwnerId) {
    const [owner] = await tx
      .select({ archivedAt: users.archivedAt })
      .from(users)
      .where(eq(users.id, facts.businessOwnerId))
      .for("share");
    if (!owner || owner.archivedAt)
      throw httpError(400, "The Business Owner is no longer available.");
  }
  const born = await createContract(tx, notifier, {
    actorId: generation.generatedBy,
    title: facts.title,
    contractTypeId: facts.contractTypeId,
    businessOwnerId: facts.businessOwnerId,
    owningDepartmentId: facts.owningDepartmentId,
    region: facts.region,
    customFields: facts.customFields,
    autoDoc: { id: generation.autoDocId, generationId: generation.id, facts },
  });
  await tx.insert(documents).values({
    id: version.documentId,
    contractId: born.row.id,
    title: facts.autoDocName,
    createdBy: generation.generatedBy,
  });
  await insertDocumentVersion(tx, version);
  await tx
    .update(contracts)
    .set({ primaryDocumentId: version.documentId })
    .where(eq(contracts.id, born.row.id));
  if (facts.primaryCounterpartyName)
    await linkPrimaryCounterparty(tx, {
      contract: born.row,
      name: facts.primaryCounterpartyName,
      actorId: generation.generatedBy,
    });
  return { createdContractId: born.row.id, createdDocumentId: version.documentId };
}
