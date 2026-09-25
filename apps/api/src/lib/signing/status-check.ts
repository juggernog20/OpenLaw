// SPDX-License-Identifier: AGPL-3.0-only
import { and, contractEnvelopes, eq, inArray, isNull, or, sql, type Db } from "@openlaw/db";
import { SigningRefusedError, type SigningProvider } from "./provider.js";

/** How long a browser return correlation stays valid after launch. */
export const LAUNCH_LIFETIME_MINUTES = 120;
/**
 * How long after a launch the sweep leaves a draft to the browser return.
 * One read interval: the return usually arrives inside it and then spends
 * the first eligible read itself. It is a grace, not a lock — a sender who
 * sends and closes the browser is polled at the first tick after it, on
 * the ordinary cadence, however long the correlation stays valid.
 */
export const LAUNCH_RETURN_GRACE_MINUTES = 15;

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
      // Terminal for this one Envelope, not for the round: the rows beside
      // it may belong to the current account.
      throw new SigningRefusedError("The Envelope belongs to a different Signing account.");
    }
    return await signing.readEnvelope(claimed.providerEnvelopeId);
  } finally {
    await db
      .update(contractEnvelopes)
      .set({ nextReconcileAt: sql`clock_timestamp() + interval '15 minutes'` })
      .where(eq(contractEnvelopes.id, envelopeId));
  }
}
