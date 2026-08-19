// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The deflection-link routes (INT-004, #356): the "Before you submit…"
 * panel's configuration — list, create, update, reorder, and remove.
 *
 * A small bespoke module rather than a taxonomy mount: a link has no
 * slug, no description, and no archive, so six of the seven taxonomy
 * verbs would be sentences nobody writes. `contract-statuses` is the
 * house prior art for exactly this — an ordered list the taxonomy
 * machinery does not fit — and this file follows its shape: one lock
 * per `:id` mutation, a full-permutation reorder that renumbers from 1,
 * and every mutation appending to the activity log (DD-017) inside the
 * same transaction, behind SET-002's one role gate.
 *
 * **Placement is the assignment, and it can change.** A link with no
 * request type sits on the portal home panel; a link naming one sits on
 * that form instead (INT-004). `PATCH` takes the placement like any
 * other field, so a link moves between the two without being recreated.
 *
 * **The URL is validated and stored as entered.** It has to be an
 * absolute `http`/`https` address — a bare `wiki/legal`, a `mailto:`,
 * and a `javascript:` are all refused — and nothing normalizes it after
 * that. The ST13 row renders it without its scheme; the stored string
 * still has one, because that is what a browser needs to follow it.
 *
 * Nothing here renders outside Settings. The portal panel that reads
 * these links is M20's.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  asc,
  eq,
  intakeLinks,
  requestTypes,
  type Executor,
  type IntakeLink,
  type Transaction,
} from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { httpError, problemResponse } from "../../lib/problem.js";

const IntakeLinkSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** As entered: absolute, http or https, unnormalized. */
  url: z.string(),
  /** NULL = the portal home panel (INT-004). */
  requestTypeId: z.string().nullable(),
  displayOrder: z.number().int(),
});

const IntakeLinkEnvelope = z.object({ intakeLink: IntakeLinkSchema });
const IntakeLinkListEnvelope = z.object({ intakeLinks: z.array(IntakeLinkSchema) });

const LabelSchema = z.string().trim().min(1).max(200);
/** Bounded here, shaped by {@link assertWebUrl} — a refusal a person
 * has to act on gets a sentence rather than a field-path error. */
const UrlSchema = z.string().trim().min(1).max(2048);

function toRow(row: IntakeLink) {
  return {
    id: row.id,
    label: row.label,
    url: row.url,
    requestTypeId: row.requestTypeId,
    displayOrder: row.displayOrder,
  };
}

/**
 * The INT-004 URL rule: an absolute `http` or `https` address.
 *
 * Absolute, because the panel renders on a portal a requester reaches
 * from their own browser — a relative path would resolve against the
 * portal and land nowhere. Refused as a 400 with a sentence, because
 * this is the one refusal an Administrator typing a URL will actually
 * hit, and "One or more request fields are invalid" does not tell them
 * what to type instead.
 */
function assertWebUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw httpError(400, "Enter a full web address that starts with http:// or https://.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw httpError(400, "Enter a full web address that starts with http:// or https://.");
  }
}

export const intakeLinksRoutes: FastifyPluginAsyncZod = async (app) => {
  /** Every link, in panel order. The whole list, both placements: the
   * pane draws one card, and the portal (M20) picks its own panel out
   * of it. */
  async function listAll(db: Executor) {
    const rows = await db
      .select()
      .from(intakeLinks)
      .orderBy(asc(intakeLinks.displayOrder), asc(intakeLinks.createdAt));
    return rows.map(toRow);
  }

  /** Locks and returns one link, or 404s — every `:id` mutation starts
   * here, so two writes to one row serialize. */
  async function lockedLink(tx: Transaction, id: string): Promise<IntakeLink> {
    const [row] = await tx
      .select()
      .from(intakeLinks)
      .where(eq(intakeLinks.id, id))
      .limit(1)
      .for("update");
    if (!row) throw httpError(404, "No deflection link exists with this id.");
    return row;
  }

  /**
   * Resolves a placement to the name the audit log records, refusing a
   * request type that is not there.
   *
   * `null` means the portal home. The row is held under `FOR KEY SHARE`
   * while it is read — the weakest lock that stops the type being
   * hard-deleted between this check and the insert, and the same lock
   * the FK itself takes. A stronger one would queue behind an unrelated
   * rename of the type, which has nothing to do with this link.
   */
  async function placementName(
    tx: Transaction,
    requestTypeId: string | null,
  ): Promise<string | null> {
    if (requestTypeId === null) return null;
    const [row] = await tx
      .select({ displayName: requestTypes.displayName })
      .from(requestTypes)
      .where(eq(requestTypes.id, requestTypeId))
      .limit(1)
      .for("key share");
    if (!row) throw httpError(400, "No request type exists with this id.");
    return row.displayName;
  }

  app.get(
    "/intake-links",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "listIntakeLinks",
        summary:
          "The INT-004 deflection links in panel order; a link with no " +
          "request type belongs to the portal home panel",
        tags: ["intake-links"],
        response: { 200: IntakeLinkListEnvelope, default: problemResponse },
      },
    },
    async () => ({ intakeLinks: await listAll(app.db) }),
  );

  app.post(
    "/intake-links",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "createIntakeLink",
        summary:
          "Add a deflection link: a label over an absolute http/https " +
          "URL, placed on the portal home (no request type) or on one " +
          "request type's form; the row appends to the panel order",
        tags: ["intake-links"],
        body: z.object({
          label: LabelSchema,
          url: UrlSchema,
          /** Omitted or null = the portal home panel. */
          requestTypeId: z.string().nullish(),
        }),
        response: { 201: IntakeLinkEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const label = request.body.label.trim();
      const url = request.body.url.trim();
      assertWebUrl(url);
      const requestTypeId = request.body.requestTypeId ?? null;

      const row = await app.db.transaction(async (tx) => {
        const placement = await placementName(tx, requestTypeId);
        // The order spans both placements, as the pane's one list does.
        const existing = await tx
          .select({ displayOrder: intakeLinks.displayOrder })
          .from(intakeLinks)
          .for("update");
        const displayOrder =
          existing.reduce((top, candidate) => Math.max(top, candidate.displayOrder), 0) + 1;

        const [created] = await tx
          .insert(intakeLinks)
          .values({ label, url, requestTypeId, displayOrder })
          .returning();
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "intake_link.created",
          visibility: "admin_only",
          payload: { label, url, placement },
        });
        return created!;
      });
      return reply.status(201).send({ intakeLink: toRow(row) });
    },
  );

  app.patch(
    "/intake-links/:id",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "updateIntakeLink",
        summary:
          "Edit a deflection link's label, URL, or placement; passing " +
          "`requestTypeId: null` moves it to the portal home panel",
        tags: ["intake-links"],
        params: z.object({ id: z.string() }),
        // Strict: a link has three editable dimensions and no fourth,
        // so a body carrying one is a client bug worth an explicit
        // refusal rather than a silently stripped key.
        body: z
          .strictObject({
            label: LabelSchema.optional(),
            url: UrlSchema.optional(),
            requestTypeId: z.string().nullable().optional(),
          })
          .refine((body) => Object.keys(body).length > 0, {
            error: "Name at least one thing to change.",
          }),
        response: { 200: IntakeLinkEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const label = request.body.label?.trim();
      const url = request.body.url?.trim();
      if (url !== undefined) assertWebUrl(url);
      const movesPlacement = "requestTypeId" in request.body;

      const row = await app.db.transaction(async (tx) => {
        const target = await lockedLink(tx, request.params.id);
        const requestTypeId = movesPlacement
          ? (request.body.requestTypeId ?? null)
          : target.requestTypeId;

        const patch: Partial<typeof intakeLinks.$inferInsert> = {};
        const changed: Record<string, { from: unknown; to: unknown }> = {};
        if (label !== undefined && label !== target.label) {
          patch.label = label;
          changed.label = { from: target.label, to: label };
        }
        if (url !== undefined && url !== target.url) {
          patch.url = url;
          changed.url = { from: target.url, to: url };
        }
        if (requestTypeId !== target.requestTypeId) {
          patch.requestTypeId = requestTypeId;
          changed.placement = {
            from: await placementName(tx, target.requestTypeId),
            to: await placementName(tx, requestTypeId),
          };
        } else if (movesPlacement) {
          // Unchanged, but still worth validating: a request type id
          // that does not exist has to refuse whether or not it is the
          // one the row already holds.
          await placementName(tx, requestTypeId);
        }

        // An edit that changes nothing answers with the row and writes
        // no misleading from==to entry, as the taxonomy rename does.
        if (Object.keys(changed).length === 0) return target;

        const [updated] = await tx
          .update(intakeLinks)
          .set(patch)
          .where(eq(intakeLinks.id, target.id))
          .returning();
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "intake_link.updated",
          visibility: "admin_only",
          payload: { label: updated!.label, changed },
        });
        return updated!;
      });
      return { intakeLink: toRow(row) };
    },
  );

  app.put(
    "/intake-links/order",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "reorderIntakeLinks",
        summary:
          "Apply a full permutation of the deflection links (SET-003 " +
          "immediate apply); display orders renumber from 1",
        tags: ["intake-links"],
        body: z.object({ ids: z.array(z.string()).min(1) }),
        response: { 200: IntakeLinkListEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const { ids } = request.body;
      return app.db.transaction(async (tx) => {
        const current = await tx
          .select()
          .from(intakeLinks)
          .orderBy(asc(intakeLinks.displayOrder), asc(intakeLinks.createdAt))
          .for("update");
        const byId = new Map(current.map((row) => [row.id, row]));
        const isPermutation =
          ids.length === current.length &&
          new Set(ids).size === ids.length &&
          ids.every((id) => byId.has(id));
        if (!isPermutation) {
          throw httpError(400, "The order must list every deflection link exactly once.");
        }
        if (ids.every((id, index) => current[index]!.id === id)) {
          return { intakeLinks: current.map(toRow) };
        }

        const reordered: IntakeLink[] = [];
        for (const [index, id] of ids.entries()) {
          const row = byId.get(id)!;
          if (row.displayOrder === index + 1) {
            reordered.push(row);
            continue;
          }
          const [updated] = await tx
            .update(intakeLinks)
            .set({ displayOrder: index + 1 })
            .where(eq(intakeLinks.id, id))
            .returning();
          reordered.push(updated!);
        }
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "intake_link.reordered",
          visibility: "admin_only",
          payload: { order: reordered.map((row) => row.label) },
        });
        return { intakeLinks: reordered.map(toRow) };
      });
    },
  );

  app.delete(
    "/intake-links/:id",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "deleteIntakeLink",
        summary:
          "Remove a deflection link outright (INT-004): nothing points " +
          "at a link and there is no history to keep, so there is no " +
          "archive and no guard",
        tags: ["intake-links"],
        params: z.object({ id: z.string() }),
        // z.undefined() = a bodyless 204; z.null() would advertise a
        // JSON null payload to OpenAPI clients.
        response: { 204: z.undefined(), default: problemResponse },
      },
    },
    async (request, reply) => {
      await app.db.transaction(async (tx) => {
        const target = await lockedLink(tx, request.params.id);
        const placement = await placementName(tx, target.requestTypeId);
        await tx.delete(intakeLinks).where(eq(intakeLinks.id, target.id));
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "intake_link.deleted",
          visibility: "admin_only",
          payload: { label: target.label, url: target.url, placement },
        });
      });
      return reply.status(204).send();
    },
  );
};
