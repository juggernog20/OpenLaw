// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-005 and DOC-012: copy generated paper into its own Document and record its creation. */
import { contracts, documents, eq } from "@openlaw/db";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import { insertDocumentVersion, type AppendedVersion } from "../../lib/document-versions.js";
import type { NotifyingTransaction, Notifier } from "../../lib/notifications/notifier.js";

/** Automatic destinations and later Filings create the same ordinary Document and Activity. */
export async function addGeneratedDocument(
  tx: NotifyingTransaction,
  notifier: Notifier,
  input: {
    target: { kind: "matter" | "contract"; id: string };
    version: AppendedVersion;
    title: string;
    actor: { id: string; displayName: string; role?: string };
    takePrimary: boolean;
  },
) {
  const { target, version, title, actor } = input;
  await tx.insert(documents).values({
    id: version.documentId,
    ...(target.kind === "contract" ? { contractId: target.id } : { matterId: target.id }),
    title,
    createdBy: actor.id,
  });
  await insertDocumentVersion(tx, version);
  await recordActivity(tx, {
    entityType: target.kind,
    entityId: target.id,
    actorId: actor.id,
    action: "document.created",
    visibility: RECORD_ACTIVITY_TIER,
    payload: {
      documentId: version.documentId,
      versionId: version.versionId,
      title,
      folderName: null,
      generatedFromGenerationId: version.generatedFromGenerationId!,
      ...(actor.role === "business_user" ? { actorRole: "business_user" as const } : {}),
    },
  });
  if (target.kind === "contract") {
    if (input.takePrimary) {
      await tx
        .update(contracts)
        .set({ primaryDocumentId: version.documentId })
        .where(eq(contracts.id, target.id));
      await recordActivity(tx, {
        entityType: "contract",
        entityId: target.id,
        actorId: actor.id,
        action: "document.primary_set",
        visibility: RECORD_ACTIVITY_TIER,
        payload: {
          documentId: version.documentId,
          title,
          fromDocumentId: null,
          from: null,
          to: title,
        },
      });
    }
    await notifier.documentAdded(tx, {
      contractId: target.id,
      actorId: actor.id,
      actorName: actor.displayName,
      documentId: version.documentId,
      documentTitle: title,
      isConfidential: false,
    });
  }
}
