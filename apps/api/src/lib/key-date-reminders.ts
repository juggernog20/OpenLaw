// SPDX-License-Identifier: AGPL-3.0-only

/** Key dates add lead times to NOT-004's global ladder and may select a team subset. */
import { z } from "zod";
import {
  and,
  eq,
  contractKeyDates,
  matterKeyDates,
  inArray,
  isNull,
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
        .where(and(inArray(users.id, [...audience.userIds]), isNull(users.archivedAt)))
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
    throw httpError(400, "Choose reminder recipients from the record's current team.");
  }
}

/** A saved subset never falls back merely because its members left the current audience. */
export function selectedKeyDateRecipients(audience: readonly string[], stored: unknown): string[] {
  const selected = ownReminderRecipients(stored);
  return selected.length > 0 ? audience.filter((id) => selected.includes(id)) : [...audience];
}

/** Pending date mail uses the current selection and roster, not yesterday's recipients. */
export async function currentKeyDateRecipients(
  db: Executor,
  kind: "contract" | "matter",
  recordId: string,
  keyDateId: string,
): Promise<string[]> {
  const row =
    kind === "contract"
      ? (
          await db
            .select({ selected: contractKeyDates.reminderRecipientIds })
            .from(contractKeyDates)
            .where(
              and(eq(contractKeyDates.id, keyDateId), eq(contractKeyDates.contractId, recordId)),
            )
            .limit(1)
        )[0]
      : (
          await db
            .select({ selected: matterKeyDates.reminderRecipientIds })
            .from(matterKeyDates)
            .where(and(eq(matterKeyDates.id, keyDateId), eq(matterKeyDates.matterId, recordId)))
            .limit(1)
        )[0];
  if (!row) return [];
  const audience =
    kind === "contract"
      ? await contractRecordAudience(db, recordId)
      : await matterRecordAudience(db, recordId);
  return selectedKeyDateRecipients(audience?.userIds ?? [], row.selected);
}
