// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Organization settings routes (SET-001 General pane, #63; the
 * Notifications pane's reminder-offset list, #322). Everything here sits
 * behind SET-002's single role gate — Administrators only — and every
 * write appends to the activity log (SET-003 / DD-017) inside the same
 * transaction, so no change can land unrecorded.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { eq, orgSettings } from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { MAX_REMINDER_OFFSET_DAYS, savedOffsets } from "../../lib/notifications/offsets.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { TimezoneSchema } from "../../lib/timezones.js";

/** Locales the UI actually ships (DES-013: one until a second exists). */
const SHIPPED_LOCALES = ["en-US"] as const;

/**
 * An inline image as a data: URI — the logo has no file store to live in
 * yet (documents arrive in M7), so it rides the org_settings row. The
 * cap bounds the row, not the rendered size: ~256 KB of image.
 */
const LogoSchema = z
  .string()
  .max(360_000)
  .regex(
    /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/,
    "A base64 data: URI of type image/png, image/jpeg, image/webp, or image/svg+xml.",
  );

const GeneralSchema = z.object({
  name: z.string(),
  logo: z.string().nullable(),
  defaultLocale: z.enum(SHIPPED_LOCALES),
  defaultTimezone: z.string(),
});

const GeneralEnvelope = z.object({ general: GeneralSchema });

/** The fields a PATCH may carry; every one is optional (DES-017 commits
 * per field, so a typical request carries exactly one). */
const GeneralPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    logo: LogoSchema.nullable(),
    defaultLocale: z.enum(SHIPPED_LOCALES),
    defaultTimezone: TimezoneSchema,
  })
  .partial();

type GeneralField = keyof z.infer<typeof GeneralPatchSchema>;

/**
 * How many lead times one install may hold (NOT-004).
 *
 * A reminder schedule is a handful of numbers — a week out, the day
 * before, the day itself. Twenty is far past any real ladder and still
 * small enough that the round reads the whole column without thinking
 * about it. The bound exists so a scripted caller cannot turn one
 * settings row into a thousand reminders a day.
 */
const MAX_REMINDER_OFFSETS = 20;

const OffsetsEnvelope = z.object({ offsets: z.array(z.number().int()) });

export const orgRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/org/general",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "getOrgGeneral",
        summary: "The organization's identity (SET-001 General pane)",
        tags: ["org"],
        response: { 200: GeneralEnvelope, default: problemResponse },
      },
    },
    async () => {
      const [row] = await app.db.select().from(orgSettings).limit(1);
      if (!row) throw httpError(500, "org_settings has no row to read.");
      return {
        general: {
          name: row.name,
          logo: row.logo,
          // A parse, not a cast: a stored locale outside the shipped set
          // fails loudly here instead of inside the response serializer.
          defaultLocale: GeneralSchema.shape.defaultLocale.parse(row.defaultLocale),
          defaultTimezone: row.defaultTimezone,
        },
      };
    },
  );

  app.patch(
    "/org/general",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "updateOrgGeneral",
        summary:
          "Update the organization's identity; applies immediately " +
          "(SET-003) and appends one audit entry per changed field",
        tags: ["org"],
        body: GeneralPatchSchema,
        response: { 200: GeneralEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const patch = request.body;
      // The mutation and its audit entries commit or roll back together;
      // the row lock keeps a concurrent PATCH from reading a stale "old"
      // into its audit payload.
      const updated = await app.db.transaction(async (tx) => {
        const [current] = await tx.select().from(orgSettings).limit(1).for("update");
        if (!current) throw httpError(500, "org_settings has no row to update.");

        const changed = (Object.keys(patch) as GeneralField[]).filter(
          (field) => patch[field] !== undefined && patch[field] !== current[field],
        );
        if (changed.length === 0) return current;

        // Spreading the typed patch keeps the payload checked (a field
        // equal to its current value rewrites itself, which is harmless);
        // the WHERE binds the write to the row the lock-read locked.
        const [row] = await tx
          .update(orgSettings)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(orgSettings.id, current.id))
          .returning();
        if (!row) throw httpError(500, "org_settings has no row to update.");

        for (const field of changed) {
          await recordActivity(tx, {
            entityType: "system",
            actorId: request.user.id,
            action: "org_settings.updated",
            visibility: "admin_only",
            // The logo is presence-only: a data: URI in the payload would
            // bloat every later audit query with the encoded image.
            payload:
              field === "logo"
                ? {
                    field,
                    old: current.logo === null ? null : "[image]",
                    new: row.logo === null ? null : "[image]",
                  }
                : { field, old: current[field], new: row[field] },
          });
        }
        return row;
      });

      return {
        general: {
          name: updated.name,
          logo: updated.logo,
          defaultLocale: GeneralSchema.shape.defaultLocale.parse(updated.defaultLocale),
          defaultTimezone: updated.defaultTimezone,
        },
      };
    },
  );

  app.get(
    "/org/reminder-offsets",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "getReminderOffsets",
        summary:
          "The install's reminder lead times in days (NOT-004): one " +
          "list, applied to every tracked date — key dates, notice " +
          "deadlines, and expiries alike. Answered in the order it was " +
          "saved, which is the order the pane draws. A stored value the " +
          "round could not fire on is dropped rather than answered, so " +
          "the pane can never draw a lead time that will not arrive",
        tags: ["org"],
        response: { 200: OffsetsEnvelope, default: problemResponse },
      },
    },
    async () => {
      const [row] = await app.db
        .select({ offsets: orgSettings.reminderOffsetDays })
        .from(orgSettings)
        .limit(1);
      if (!row) throw httpError(500, "org_settings has no row to read.");
      return { offsets: savedOffsets(row.offsets) };
    },
  );

  app.put(
    "/org/reminder-offsets",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "setReminderOffsets",
        summary:
          "Replace the reminder lead times (NOT-004). The whole list " +
          "goes in one request, because adding, removing, and " +
          "rearranging are all the same write and each of them applies " +
          "the moment it is made (SET-003). The morning round reads the " +
          "column live, so the next round uses the new list with " +
          "nothing else touched. The list can never be emptied: no " +
          "lead times means no reminders, and silence has to be chosen " +
          "per event group rather than fall out of an empty settings " +
          "row",
        tags: ["org"],
        body: z.object({
          offsets: z
            .array(z.number().int().min(0).max(MAX_REMINDER_OFFSET_DAYS))
            .min(1)
            .max(MAX_REMINDER_OFFSETS),
        }),
        response: { 200: OffsetsEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      // Duplicates collapse to their first position: two copies of `7`
      // are one lead time, and the round would dedup them anyway.
      const offsets = [...new Set(request.body.offsets)];
      const stored = await app.db.transaction(async (tx) => {
        const [current] = await tx
          .select({ id: orgSettings.id, offsets: orgSettings.reminderOffsetDays })
          .from(orgSettings)
          .limit(1)
          .for("update");
        if (!current) throw httpError(500, "org_settings has no row to update.");
        const before = savedOffsets(current.offsets);
        // Order counts as change: the stored list is the canonical one,
        // and rearranging it is a save like any other.
        if (JSON.stringify(before) === JSON.stringify(offsets)) return before;
        const [row] = await tx
          .update(orgSettings)
          .set({ reminderOffsetDays: offsets, updatedAt: new Date() })
          .where(eq(orgSettings.id, current.id))
          .returning({ offsets: orgSettings.reminderOffsetDays });
        if (!row) throw httpError(500, "org_settings has no row to update.");
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "org_settings.updated",
          visibility: "admin_only",
          // The old list is the one the round was firing on, not the raw
          // column: an unreadable value was never a lead time, so
          // narrating it as one lost would be a false record.
          payload: { field: "reminderOffsetDays", old: before, new: savedOffsets(row.offsets) },
        });
        return savedOffsets(row.offsets);
      });
      return { offsets: stored };
    },
  );
};
