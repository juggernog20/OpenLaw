// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Two CTR-008 rules about the `ai_unverified` map that more than one
 * module needs. A human write: the slot it lands on is verified by
 * definition, so the slot's entry goes in the same transaction. The
 * Contract PATCH clears its slugs from the row it holds; `clearAiUnverified`
 * is for write paths that never load the map. A derived date: the
 * deadline readers ask which flags mark it, and `derivedDateUnverified`
 * is the one answer.
 */

import { and, contracts, eq, sql, type Executor } from "@openlaw/db";
import type { AiUnverifiedMap } from "@openlaw/shared";

export function keyDateUnverified(
  flags: AiUnverifiedMap | null | undefined,
  keyDateId: string,
): boolean {
  return Object.values(flags ?? {}).some((entry) => entry.keyDateId === keyDateId);
}

/** Editing the event or removing it records the review decision for future analysis runs. */
export async function reviewKeyDate(
  db: Executor,
  contract: { id: string; aiUnverified: AiUnverifiedMap | null },
  keyDateId: string,
): Promise<void> {
  const slugs = Object.entries(contract.aiUnverified ?? {})
    .filter(([, entry]) => entry.keyDateId === keyDateId)
    .map(([slug]) => slug);
  if (!slugs.length) return;
  const flags = { ...contract.aiUnverified };
  for (const slug of slugs) delete flags[slug];
  contract.aiUnverified = Object.keys(flags).length ? flags : null;
  await db
    .update(contracts)
    .set({
      aiUnverified: contract.aiUnverified,
      analysisHumanFields: sql`${contracts.analysisHumanFields} || ${JSON.stringify(slugs)}::jsonb`,
    })
    .where(eq(contracts.id, contract.id));
}

/** The two dates the term derives (CTR-006). A key date is never marked,
 * because a person typed it. */
export type DerivedDateSource = "expiry" | "notice_deadline";

/**
 * CTR-008's surface rule for a derived date: the expiry reads one source
 * field, and the notice deadline reads that field and the notice period,
 * so a flag on either marks it. Every deadline reader asks this one
 * question, so the answer lives here and not in three copies.
 */
export function derivedDateUnverified(
  flags: AiUnverifiedMap | null | undefined,
  source: DerivedDateSource,
): boolean {
  if (!flags) return false;
  if ("expiry_date" in flags) return true;
  return source === "notice_deadline" && "notice_period_days" in flags;
}

/**
 * Removes one slug's entry from a Contract's `ai_unverified` map. The
 * UPDATE runs only when the entry exists, so a record with nothing to
 * clear is not rewritten, and an emptied map is stored as null.
 */
export async function clearAiUnverified(
  db: Executor,
  contractId: string,
  slug: string,
): Promise<void> {
  await db
    .update(contracts)
    .set({ aiUnverified: sql`nullif(${contracts.aiUnverified} - ${slug}, '{}'::jsonb)` })
    .where(and(eq(contracts.id, contractId), sql`${contracts.aiUnverified} ? ${slug}`));
}
