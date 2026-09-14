// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-005: write the generated Contract and primary Document in the Generation transaction. */
import {
  entities,
  eq,
  users,
  type AutoDocGeneration,
  type AutoDocContractSnapshot,
} from "@openlaw/db";
import { linkPrimaryCounterparty } from "../../lib/counterparty-link.js";
import { type AppendedVersion } from "../../lib/document-versions.js";
import type { Notifier, NotifyingTransaction } from "../../lib/notifications/notifier.js";
import { httpError } from "../../lib/problem.js";
import { addGeneratedDocument } from "./filed-document.js";
import { createContract } from "../contracts/create.js";

/** The caller owns the Generation transaction and the stored Word copy. */
export async function createGeneratedContract(
  tx: NotifyingTransaction,
  notifier: Notifier,
  generation: AutoDocGeneration,
  version: AppendedVersion,
  destination?: { facts: AutoDocContractSnapshot; actorId: string },
) {
  const facts = destination?.facts ?? generation.contractSnapshot!;
  const actorId = destination?.actorId ?? generation.generatedBy;
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
    actorId,
    title: facts.title,
    contractTypeId: facts.contractTypeId,
    businessOwnerId: facts.businessOwnerId,
    managerId: facts.legalOwnerId ?? null,
    owningDepartmentId: facts.owningDepartmentId,
    region: facts.region,
    customFields: facts.customFields,
    autoDoc: { id: generation.autoDocId, generationId: generation.id, facts },
  });
  const [person] = await tx
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, actorId));
  await addGeneratedDocument(tx, notifier, {
    target: { kind: "contract", id: born.row.id },
    version,
    title: facts.autoDocName,
    actor: { id: actorId, displayName: person!.displayName },
    takePrimary: true,
  });
  if (facts.primaryCounterpartyName)
    await linkPrimaryCounterparty(tx, {
      contract: born.row,
      name: facts.primaryCounterpartyName,
      actorId,
    });
  await notifier.contractGenerated(tx, {
    contractId: born.row.id,
    contractNumber: born.row.number,
    contractTitle: born.row.title,
    ownerId: born.row.managerId,
    actorId,
    actorName: person!.displayName,
    autoDocId: generation.autoDocId,
    autoDocName: facts.autoDocName,
    generationId: generation.id,
  });
  return { createdContractId: born.row.id, createdDocumentId: version.documentId };
}
