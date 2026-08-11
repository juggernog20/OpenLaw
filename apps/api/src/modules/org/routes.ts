// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Organization settings routes (SET-001 General pane, #63). Everything
 * here sits behind SET-002's single role gate — Administrators only —
 * and every write appends to the activity log (SET-003 / DD-017) inside
 * the same transaction, so no change can land unrecorded.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { eq, orgSettings } from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
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
};
