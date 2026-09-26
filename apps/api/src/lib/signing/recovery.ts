// SPDX-License-Identifier: AGPL-3.0-only

import { and, contractEnvelopes, eq, isNull, or, sql } from "@openlaw/db";
import type { ReconciliationDeps } from "../../pipeline/reconciliation.js";
import type { JobQueue } from "../../pipeline/jobs.js";
import { requestExecutedCopy } from "./completion.js";
import { applyEnvelopeStatus } from "./transitions.js";

export const RECOVERY_ATTEMPT_LIMIT = 32;
export const TRANSACTION_LOOKUP_DAYS = 7;
export const recoveryDue = () =>
  and(
    eq(contractEnvelopes.status, "preparing"),
    isNull(contractEnvelopes.recoveryStopped),
    or(
      sql`${contractEnvelopes.nextRecoveryAt} <= clock_timestamp()`,
      and(
        isNull(contractEnvelopes.nextRecoveryAt),
        sql`${contractEnvelopes.createdAt} <= clock_timestamp() - interval '15 minutes'`,
      ),
    ),
  );

/** Claims commit before any network work. Attempts fence late worker writes;
 * a stopped process leaves the next worker a durable allowance and identity. */
export async function recoverEnvelope(
  deps: ReconciliationDeps,
  jobs: JobQueue,
  id: string,
): Promise<void> {
  const [row] = await deps.db
    .update(contractEnvelopes)
    .set({
      recoveryAttempts: sql`${contractEnvelopes.recoveryAttempts} + 1`,
      nextRecoveryAt: sql`clock_timestamp() + interval '20 minutes'`,
      preparationState: "uncertain",
    })
    .where(and(eq(contractEnvelopes.id, id), recoveryDue()))
    .returning();
  if (!row) return;
  const owned = () =>
    and(
      eq(contractEnvelopes.id, id),
      eq(contractEnvelopes.status, "preparing"),
      eq(contractEnvelopes.recoveryAttempts, row.recoveryAttempts),
    );
  const context = {
    envelopeId: id,
    provider: row.provider,
    providerAccountId: row.providerAccountId,
    providerEnvironment: row.providerEnvironment,
    providerTransactionId: row.providerTransactionId,
    providerEnvelopeId: row.providerEnvelopeId,
    attempt: row.recoveryAttempts,
  };
  let stopped: typeof row.recoveryStopped = null;
  let outcome = "unavailable";
  try {
    if (
      !row.providerAccountId ||
      !row.providerEnvironment ||
      (!row.providerEnvelopeId && !row.providerTransactionId)
    ) {
      stopped = "identity_missing";
      return;
    }
    if (
      !row.providerEnvelopeId &&
      Date.now() - row.createdAt.getTime() >= TRANSACTION_LOOKUP_DAYS * 86_400_000
    ) {
      stopped = "lookup_expired";
      return;
    }
    if (row.recoveryAttempts > RECOVERY_ATTEMPT_LIMIT) {
      stopped = "attempts_exhausted";
      return;
    }
    const signing = await deps.resolveSigningProvider();
    if (!signing) return;
    if (
      signing.provider !== row.provider ||
      signing.environment !== row.providerEnvironment ||
      (await signing.testConnection()).accountId !== row.providerAccountId
    ) {
      outcome = "identity_mismatch";
      return;
    }
    let providerEnvelopeId = row.providerEnvelopeId;
    if (!providerEnvelopeId) {
      const found = await signing.findEnvelope(row.providerTransactionId!);
      if (!found) {
        outcome = "lookup_empty";
        return;
      }
      providerEnvelopeId = found.providerEnvelopeId;
      // Keep the id before reading status, including if that read fails or the
      // process stops. Known ids remain useful after transaction lookup expires.
      const attached = await deps.db
        .update(contractEnvelopes)
        .set({ providerEnvelopeId })
        .where(owned())
        .returning({ id: contractEnvelopes.id });
      if (!attached.length) return;
    }
    const state = await signing.readEnvelope(providerEnvelopeId);
    const applied = await applyEnvelopeStatus(deps.notifier, {
      provider: row.provider,
      providerEnvelopeId,
      ...state,
      recoveryAttempt: row.recoveryAttempts,
    });
    await requestExecutedCopy(jobs, deps.log, applied);
    outcome = applied.outcome;
  } catch {
    // Neither a refusal to read nor a missing result proves noncreation.
    // Provider errors may contain payloads; diagnostics keep only local context.
    outcome = "unavailable";
  } finally {
    if (!stopped && row.recoveryAttempts >= RECOVERY_ATTEMPT_LIMIT) stopped = "attempts_exhausted";
    const minutes = Math.min(360, 15 * 2 ** Math.min(row.recoveryAttempts - 1, 5));
    await deps.db
      .update(contractEnvelopes)
      .set({
        recoveryStopped: stopped,
        nextRecoveryAt: stopped ? null : sql`clock_timestamp() + make_interval(mins => ${minutes})`,
        nextReconcileAt: sql`clock_timestamp() + interval '15 minutes'`,
      })
      .where(owned());
    deps.log.info({ ...context, outcome: stopped ?? outcome }, "signing creation recovery");
  }
}
