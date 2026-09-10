// SPDX-License-Identifier: AGPL-3.0-only

/** Key dates add lead times to NOT-004's global ladder and may select a team subset. */
import { z } from "zod";
import {
  and,
  contractKeyDates,
  matterKeyDates,
  inArray,
  isNull,
  ne,
  users,
  type Executor,
} from "@openlaw/db";
import { contractRecordAudience, matterRecordAudience } from "./notifications/audience.js";
import { isUsableOffset, reminderOffsets } from "./notifications/offsets.js";
import { httpError } from "./problem.js";

export const KeyDateOffsetsSchema = z
  .array(z.number().int().min(0).max(730))
  .max(20)
  .transform((values) => [...new Set(values)]);
export const KeyDateRecipientsSchema = z
  .array(z.string().min(1).max(64))
  .max(200)
  .transform((values) => [...new Set(values)]);
export const KeyDateReminderOptionsSchema = z.object({
  globalOffsetDays: z.array(z.int()),
  recipients: z.array(z.object({ id: z.string(), displayName: z.string() })),
});

export function ownReminderOffsets(stored: unknown): number[] {
  return Array.isArray(stored) ? [...new Set(stored.filter(isUsableOffset))] : [];
}

export function ownReminderRecipients(stored: unknown): string[] {
  return Array.isArray(stored)
    ? [...new Set(stored.filter((id): id is string => typeof id === "string" && id.length > 0))]
    : [];
}

export async function keyDateReminderOptions(
  db: Executor,
  kind: "contract" | "matter",
  id: string,
) {
  const audience =
    kind === "contract" ? await contractRecordAudience(db, id) : await matterRecordAudience(db, id);
  const recipients = audience?.userIds.length
    ? await db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(
          and(
            inArray(users.id, [...audience.userIds]),
            isNull(users.archivedAt),
            // A Business User may hold a team row as a watcher, and the
            // morning round serves nobody with that role. Offering one
            // here would let a person pick the one audience the system
            // can never remind. An explicit selection does not fall
            // back, so that Key date would go quiet for good.
            ne(users.role, "business_user"),
          ),
        )
        .orderBy(users.displayName, users.id)
    : [];
  return { globalOffsetDays: await reminderOffsets(db), recipients };
}

/** The route holds the record lock, shared by roster writes. */
export async function validateKeyDateRecipients(
  db: Executor,
  kind: "contract" | "matter",
  id: string,
  selected: readonly string[],
) {
  if (selected.length === 0) return;
  const options = await keyDateReminderOptions(db, kind, id);
  const allowed = new Set(options.recipients.map((person) => person.id));
  if (selected.some((person) => !allowed.has(person))) {
    throw httpError(
      400,
      "Choose reminder recipients from the record's current team. " +
        "Business Users receive no reminders and cannot be chosen.",
    );
  }
}

/** A saved subset never falls back merely because its members left the current audience. */
export function selectedKeyDateRecipients(audience: readonly string[], stored: unknown): string[] {
  const selected = ownReminderRecipients(stored);
  return selected.length > 0 ? audience.filter((id) => selected.includes(id)) : [...audience];
}

/** One pending Key-date row, as the briefing holds it before it asks who it is for. */
export interface PendingKeyDate {
  kind: "contract" | "matter";
  recordId: string;
  keyDateId: string;
}

/** The key a {@link currentKeyDateRecipients} answer is filed under. */
export function pendingKeyDateKey(pending: PendingKeyDate): string {
  return `${pending.kind}:${pending.recordId}:${pending.keyDateId}`;
}

/**
 * Who each pending Key-date row is for **now**, not who it was raised
 * for.
 *
 * A briefing carries a person's owed rows, and several of them are
 * routinely the same record and even the same Key date at two lead
 * times. So the rows are answered together: one read per table and one
 * audience read per record, the way the briefing already deduplicates
 * its reach question by record. A Key date that has since been deleted
 * is in nobody's briefing and is simply absent from the answer.
 */
export async function currentKeyDateRecipients(
  db: Executor,
  pending: readonly PendingKeyDate[],
): Promise<Map<string, string[]>> {
  const answers = new Map<string, string[]>();
  if (pending.length === 0) return answers;

  const asked = new Set(pending.map(pendingKeyDateKey));
  const idsOf = (kind: "contract" | "matter") => [
    ...new Set(pending.filter((row) => row.kind === kind).map((row) => row.keyDateId)),
  ];
  const contractIds = idsOf("contract");
  const matterIds = idsOf("matter");
  const [contractRows, matterRows] = await Promise.all([
    contractIds.length
      ? db
          .select({
            keyDateId: contractKeyDates.id,
            recordId: contractKeyDates.contractId,
            selected: contractKeyDates.reminderRecipientIds,
          })
          .from(contractKeyDates)
          .where(inArray(contractKeyDates.id, contractIds))
      : [],
    matterIds.length
      ? db
          .select({
            keyDateId: matterKeyDates.id,
            recordId: matterKeyDates.matterId,
            selected: matterKeyDates.reminderRecipientIds,
          })
          .from(matterKeyDates)
          .where(inArray(matterKeyDates.id, matterIds))
      : [],
  ]);

  // A Key date the caller's record does not own is a different Key date,
  // so a row only answers the key it was asked under.
  const found = [
    ...contractRows.map((row) => ({ ...row, kind: "contract" as const })),
    ...matterRows.map((row) => ({ ...row, kind: "matter" as const })),
  ].filter((row) => asked.has(pendingKeyDateKey(row)));

  const recordKey = (row: { kind: "contract" | "matter"; recordId: string }) =>
    `${row.kind}:${row.recordId}`;
  const audiences = new Map<string, readonly string[]>();
  for (const row of found) {
    if (audiences.has(recordKey(row))) continue;
    const audience =
      row.kind === "contract"
        ? await contractRecordAudience(db, row.recordId)
        : await matterRecordAudience(db, row.recordId);
    audiences.set(recordKey(row), audience?.userIds ?? []);
  }

  for (const row of found) {
    answers.set(
      pendingKeyDateKey(row),
      selectedKeyDateRecipients(audiences.get(recordKey(row)) ?? [], row.selected),
    );
  }
  return answers;
}

/**
 * What a PATCH means for one saved reminder list.
 *
 * Both lists are sets: a lead time is in the ladder or it is not, and a
 * person is a chosen recipient or is not. Ticking somebody off and back
 * on rearranges the list without changing the choice, and the module's
 * rule is that a re-sent identical row writes nothing and narrates
 * nothing. So a sent list holding the saved members leaves the saved
 * list standing, and only a real change replaces it.
 */
export function chosenList<T extends string | number>(sent: T[] | undefined, saved: T[]): T[] {
  if (sent === undefined) return saved;
  const held = new Set<T>(saved);
  // Both sides are deduplicated, so equal size and no stranger means equal sets.
  return sent.length === held.size && sent.every((value) => held.has(value)) ? saved : sent;
}
