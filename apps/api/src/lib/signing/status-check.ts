// SPDX-License-Identifier: AGPL-3.0-only

/** Durable provider read claims shared by reconciliation and browser returns (TECH-007, CTR-013). */
import { and, contractEnvelopes, eq, inArray, isNull, or, sql, type Db } from "@openlaw/db";
import type { SigningProvider } from "./provider.js";
import { requireEnvelopeIdentity } from "./identity.js";

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
    await requireEnvelopeIdentity(signing, claimed);
    return await signing.readEnvelope(claimed.providerEnvelopeId);
  } finally {
    await db
      .update(contractEnvelopes)
      .set({ nextReconcileAt: sql`clock_timestamp() + interval '15 minutes'` })
      .where(eq(contractEnvelopes.id, envelopeId));
  }
}
