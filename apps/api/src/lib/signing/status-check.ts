// SPDX-License-Identifier: AGPL-3.0-only
import { and, contractEnvelopes, eq, inArray, isNull, or, sql, type Db } from "@openlaw/db";
import type { SigningProvider } from "./provider.js";

export const reconciliationDue = () =>
  or(
    isNull(contractEnvelopes.nextReconcileAt),
    sql`${contractEnvelopes.nextReconcileAt} <= clock_timestamp()`,
  );

/** The worker and browser returns spend the same durable resource-read allowance. */
export async function checkEnvelopeStatus(db: Db, signing: SigningProvider, envelopeId: string) {
  const [claimed] = await db
    .update(contractEnvelopes)
    .set({ nextReconcileAt: sql`clock_timestamp() + interval '20 minutes'` })
    .where(
      and(
        eq(contractEnvelopes.id, envelopeId),
        inArray(contractEnvelopes.status, ["draft", "sent"]),
        reconciliationDue(),
      ),
    )
    .returning();
  if (!claimed?.providerEnvelopeId) return null;
  try {
    if (
      claimed.provider !== signing.provider ||
      (claimed.providerEnvironment !== null &&
        claimed.providerEnvironment !== signing.environment) ||
      (claimed.providerAccountId !== null &&
        claimed.providerAccountId !== (await signing.testConnection()).accountId)
    ) {
      throw new Error("The Envelope belongs to a different Signing account.");
    }
    return await signing.readEnvelope(claimed.providerEnvelopeId);
  } finally {
    await db
      .update(contractEnvelopes)
      .set({ nextReconcileAt: sql`clock_timestamp() + interval '15 minutes'` })
      .where(eq(contractEnvelopes.id, envelopeId));
  }
}
