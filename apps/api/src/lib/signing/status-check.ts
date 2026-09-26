// SPDX-License-Identifier: AGPL-3.0-only

/** Durable provider read claims shared by reconciliation and browser returns (TECH-007, CTR-013). */
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
/**
 * How long after its creation the sweep leaves a new draft alone. The
 * creation response already established that it is a draft, and the first
 * launch usually follows within moments, so a read in this window would
 * learn nothing while spending the allowance the first return needs
 * (#1170 §7). Bounded on purpose: a draft nobody ever launches can still
 * be sent through the provider account, and in Polling mode only this
 * sweep would learn it. After the grace it is polled like any other.
 */
export const CREATION_READ_GRACE_MINUTES = 15;
/**
 * How long after a confirmed discard the sweep keeps asking about the row.
 * A discarded preparation can be restored in the provider's console, so it
 * stays observable for this window, measured from the discard's
 * `completed_at`. The bound keeps the install's discard history from
 * becoming a permanent per-round provider bill: without it every
 * preparation ever discarded would be read every fifteen minutes for the
 * life of the install, against the endpoint the provider rate-limits
 * hardest. A verified Connect delivery restores a discarded row at any age;
 * only the polling stops.
 */
export const DISCARD_OBSERVATION_DAYS = 30;

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
        inArray(contractEnvelopes.status, ["draft", "sent", "discarded"]),
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
