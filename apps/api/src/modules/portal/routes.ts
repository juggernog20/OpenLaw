// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The requester-facing reads of the Administrator's intake
 * configuration (INT-001, #377): what the portal home draws.
 *
 * The Administrator built the front door in M19 behind
 * `requireRole("administrator")`, which is right for the routes that
 * *write* it and wrong for the person it was built for. A Business User
 * has to read the same two lists to pick a request type, and this
 * module is that read — a separate mount rather than a loosened gate,
 * so the Administrator-facing routes keep saying exactly what they said
 * before.
 *
 * **The gate is a session and nothing else** — the portal's own rule
 * (the INT-001 M20/2 addendum). Member+ staff submit Requests too, and
 * on this surface they are a Requester like anybody else.
 *
 * **The projection is narrower than the Administrator's**, on purpose.
 * A requester is shown the display name, the requester-facing
 * description, and the slug that addresses the form; the archive stamp,
 * the conversion target, the in-use count, and the form-field count are
 * all facts about administering the taxonomy, and none of them belong
 * in front of the person filling the form in.
 *
 * **Archived request types are absent**, with no `includeArchived`
 * escape: an archived form takes no submissions (the INT-004 addendum),
 * so offering one would be offering a dead end.
 *
 * **The deflection links are placed, and the placement is the
 * audience.** A link with no request type sits on the portal home; a
 * link naming one sits on that type's form instead (INT-004). Each of
 * the two reads below answers its own panel and never the other's. The
 * URL is answered exactly as it is stored — absolute, unnormalized —
 * because that is the address the Administrator pasted from somewhere
 * that works.
 *
 * **The form definition is a read, not a second copy of the rule
 * (#378).** One request type's form is the four fixed basics — which
 * the portal draws, because INT-002 makes them a fact about every form
 * rather than a configuration of one — plus that type's attached
 * catalog fields in display order. Only the second half is answered
 * here, through the same `selectAttachedFields` the contract record
 * reads its own fields with, so the portal and the submission route
 * agree about what the form collects by asking the same question.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, asc, eq, intakeLinks, isNull, requestTypeFields, requestTypes } from "@openlaw/db";
import { requireAuth } from "../../auth/guards.js";
import { AttachedCustomFieldSchema, selectAttachedFields } from "../../lib/custom-fields.js";
import { httpError, problemResponse } from "../../lib/problem.js";

const PortalRequestTypeSchema = z.object({
  id: z.string(),
  /** Addresses the type's form; the picker links on it. */
  slug: z.string(),
  displayName: z.string(),
  /** The requester-facing line under the name; NULL = none. */
  description: z.string().nullable(),
  displayOrder: z.number().int(),
});

const PortalIntakeLinkSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** Absolute http/https, exactly as stored (INT-004). */
  url: z.string(),
  displayOrder: z.number().int(),
});

export const portalRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/portal/request-types",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "listPortalRequestTypes",
        summary:
          "The live request types the portal picker offers, in the " +
          "Administrator's display order (INT-002); archived types are " +
          "absent, because an archived form takes no submissions",
        tags: ["portal"],
        response: {
          200: z.object({ requestTypes: z.array(PortalRequestTypeSchema) }),
          default: problemResponse,
        },
      },
    },
    async () => {
      const rows = await app.db
        .select({
          id: requestTypes.id,
          slug: requestTypes.slug,
          displayName: requestTypes.displayName,
          description: requestTypes.description,
          displayOrder: requestTypes.displayOrder,
        })
        .from(requestTypes)
        .where(isNull(requestTypes.archivedAt))
        // The same tiebreak the taxonomy list uses, so two types an
        // Administrator has never reordered read in the order they
        // were created rather than an arbitrary one.
        .orderBy(asc(requestTypes.displayOrder), asc(requestTypes.createdAt));
      return { requestTypes: rows };
    },
  );

  app.get(
    "/portal/intake-links",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "listPortalIntakeLinks",
        summary:
          'The "Before you submit…" links placed on the portal home ' +
          "(INT-004), in panel order; per-request-type links belong to " +
          "that type's form and are not answered here",
        tags: ["portal"],
        response: {
          200: z.object({ intakeLinks: z.array(PortalIntakeLinkSchema) }),
          default: problemResponse,
        },
      },
    },
    async () => {
      const rows = await app.db
        .select({
          id: intakeLinks.id,
          label: intakeLinks.label,
          url: intakeLinks.url,
          displayOrder: intakeLinks.displayOrder,
        })
        .from(intakeLinks)
        .where(and(isNull(intakeLinks.requestTypeId), isNull(intakeLinks.knowledgeItemId)))
        .orderBy(asc(intakeLinks.displayOrder), asc(intakeLinks.createdAt));
      return { intakeLinks: rows.map((row) => ({ ...row, url: row.url! })) };
    },
  );

  app.get(
    "/portal/request-types/:slug",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "readPortalRequestForm",
        summary:
          "One request type's form definition (INT-002): the type, its " +
          "attached catalog fields in display order, and the deflection " +
          "links placed on this form. The four basics — Summary, " +
          "Description, Attachments, Urgency — are fixed on every form " +
          "and are drawn by the portal, so they are not answered here",
        tags: ["portal"],
        params: z.object({ slug: z.string() }),
        response: {
          200: z.object({
            requestType: PortalRequestTypeSchema,
            /** The attached fields, in the order the form draws them.
             * An attachment whose scope no longer matches the type's
             * target is among them: the INT-002 M19/7 addendum makes
             * that a state that exists, and the portal meets it rather
             * than hiding it. */
            fields: z.array(AttachedCustomFieldSchema),
            intakeLinks: z.array(PortalIntakeLinkSchema),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      // Addressed by slug, because that is what the picker's link
      // carries and what a requester sees in the address bar. Archived
      // types are absent for the picker's reason — an archived form
      // takes no submissions (the INT-004 addendum) — and 404 rather
      // than a refusal, because to a requester the form is simply not
      // there.
      const [type] = await app.db
        .select({
          id: requestTypes.id,
          slug: requestTypes.slug,
          displayName: requestTypes.displayName,
          description: requestTypes.description,
          displayOrder: requestTypes.displayOrder,
        })
        .from(requestTypes)
        .where(and(eq(requestTypes.slug, request.params.slug), isNull(requestTypes.archivedAt)))
        .limit(1);
      if (!type) throw httpError(404, "That request type is not taking submissions.");

      const [fields, links] = await Promise.all([
        selectAttachedFields(app.db, requestTypeFields, type.id),
        app.db
          .select({
            id: intakeLinks.id,
            label: intakeLinks.label,
            url: intakeLinks.url,
            displayOrder: intakeLinks.displayOrder,
          })
          .from(intakeLinks)
          .where(and(eq(intakeLinks.requestTypeId, type.id), isNull(intakeLinks.knowledgeItemId)))
          .orderBy(asc(intakeLinks.displayOrder), asc(intakeLinks.createdAt)),
      ]);
      return {
        requestType: type,
        fields,
        intakeLinks: links.map((link) => ({ ...link, url: link.url! })),
      };
    },
  );
};
