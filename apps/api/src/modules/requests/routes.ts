// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Request record (INT-001, INT-002, #378): submission, and the
 * validation that stands between an open form and a row.
 *
 * **Its own module rather than the portal's.** `portal/routes.ts` is
 * the requester-facing *read* of the Administrator's intake
 * configuration; this is the record the configuration exists to
 * produce, and M21's Inbox reads it from the staff side. One module
 * owns the Request whichever surface asks.
 *
 * **The gate is a session and nothing else** — the portal's own rule
 * (the INT-001 M20/2 addendum). Member+ staff submit Requests too, and
 * on this surface they are a Requester like anybody else.
 *
 * **The Requester is the session, never a body field.** A Business User
 * creates Requests as themselves (DD-013), so there is nothing to send
 * and nothing to forge.
 *
 * The form definition is read, not restated. What a form collects is
 * the four fixed basics — Summary, Description, Attachments, Urgency,
 * fixed by the INT-002 M19/4 addendum and therefore stated in code
 * here, because a fixed set is a fact about the form rather than a
 * configuration of it — plus the type's attached catalog fields, which
 * come from `selectAttachedFields` over `request_type_fields`. That is
 * the same read the portal's form route draws from, so the form and the
 * refusal cannot disagree about what the form is.
 *
 * Three things are checked, in the order the route runs them:
 *
 * 1. **The type must be live.** An archived form takes no submissions
 *    (the INT-004 addendum), and the picker hiding it is not enough: a
 *    form opened before the archive is still on somebody's screen.
 * 2. **Values are accepted for exactly the attached fields**, and each
 *    is checked against its field's type. A slug the type does not
 *    attach is refused, because a value stored under it is one no
 *    surface could ever show. An attachment whose scope no longer
 *    matches the type's target is *not* refused: the INT-002 M19/7
 *    addendum makes that a state that exists, and M20's job is to meet
 *    it — it renders and collects like any other field, and what an
 *    out-of-scope collected value means is conversion's question (M21).
 *    This runs before the required check because the required check
 *    reads the *collected* values, and a value is not collected until
 *    it has been coerced.
 * 3. **The required fields must be answered** — the three required
 *    basics and every attachment the Administrator marked required
 *    (INT-002). One refusal names all of them, because a person who
 *    has to fill something in needs to know which something.
 *
 * Attachments, the fourth basic, are ticket 6's; nothing here reads or
 * writes `request_attachments`.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  entities,
  eq,
  requestTypeFields,
  requestTypes,
  requests,
  SEVERITY_LEVELS,
  users,
  type CustomFieldValue,
  type Transaction,
} from "@openlaw/db";
import { requireAuth } from "../../auth/guards.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import {
  coerceCustomFieldValue,
  CustomFieldsInput,
  CustomFieldsSchema,
  hasCustomFieldValue,
  listNames,
  selectAttachedFields,
  type AttachedCustomField,
} from "../../lib/custom-fields.js";
import { httpError, problemResponse } from "../../lib/problem.js";

/** The Request as its creator is answered. Narrow on purpose: the
 * confirmation needs the number to quote and the status to state, and
 * the rest of the envelope is the detail view's (ticket 7). */
const RequestSchema = z.object({
  id: z.string(),
  /** INT-002's global reference; the portal renders it R-###. */
  number: z.number().int(),
  requestTypeId: z.string(),
  status: z.literal("new"),
  summary: z.string(),
  description: z.string().nullable(),
  urgency: z.enum(SEVERITY_LEVELS),
  /** What the form collected, keyed by field slug (INT-002). */
  customFields: CustomFieldsSchema,
  createdAt: z.string(),
});

export const requestsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/requests",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "submitRequest",
        summary:
          "Submit a Request through a request type's portal form " +
          "(INT-001). The Requester is the session; the type must be " +
          "live; Summary, Description, and Urgency are required, as is " +
          "every attached field the type marks required; values are " +
          "accepted for exactly the fields the type attaches, and a " +
          "user or entity field's value must name a live row",
        tags: ["requests"],
        body: z.strictObject({
          requestTypeId: z.string(),
          summary: z.string(),
          description: z.string(),
          /** DES-018's four severity levels and nothing else. */
          urgency: z.enum(SEVERITY_LEVELS),
          customFields: CustomFieldsInput.optional(),
        }),
        response: { 201: z.object({ request: RequestSchema }), default: problemResponse },
      },
    },
    async (request, reply) => {
      const body = request.body;
      const created = await app.db.transaction(async (tx) => {
        // Locked for the reason the contract create locks its type: an
        // unlocked read lets a concurrent archive commit between the
        // check and the insert, and the Request is then born on a form
        // that takes no submissions.
        const [requestType] = await tx
          .select({
            id: requestTypes.id,
            displayName: requestTypes.displayName,
            archivedAt: requestTypes.archivedAt,
          })
          .from(requestTypes)
          .where(eq(requestTypes.id, body.requestTypeId))
          .limit(1)
          .for("update");
        if (!requestType || requestType.archivedAt) {
          throw httpError(400, "That request type is not taking submissions.");
        }

        // The type's attached fields, in the order the form draws them.
        // The portal's form route reads the same thing the same way —
        // that is what makes the refusal and the screen agree.
        const attached = await selectAttachedFields(tx, requestTypeFields, requestType.id);
        const customFields = collectValues(attached, body.customFields ?? {});

        // The two field types that name a row hold an id, and the id
        // must name a live one — the contract record's rule, applied
        // here for the same reason: a value nothing can resolve is a
        // name no surface could ever render. The portal's pickers
        // offer a requester no rows at all, so any id arriving here
        // was sent against the API rather than picked from a list.
        for (const field of attached) {
          const value = customFields[field.slug];
          if (value === undefined) continue;
          if (field.fieldType === "user" || field.fieldType === "entity") {
            await assertLiveReference(tx, field, value as string);
          }
        }

        // The one refusal, over the basics and the attachments
        // together. Two refusals would make a requester press Submit
        // twice to learn two halves of the same answer.
        const summary = body.summary.trim();
        const description = body.description.trim();
        assertAnswered([
          { name: "Summary", answered: summary !== "" },
          { name: "Description", answered: description !== "" },
          ...attached
            .filter((field) => field.isRequired)
            .map((field) => ({
              name: field.displayName,
              answered: hasCustomFieldValue(customFields[field.slug]),
            })),
        ]);

        const [row] = await tx
          .insert(requests)
          .values({
            requestTypeId: requestType.id,
            // DD-013, as a shape: the Requester is the session. There
            // is no body field to forge and no route to create one on
            // somebody else's behalf.
            requesterId: request.user.id,
            summary,
            description,
            urgency: body.urgency,
            customFields,
          })
          .returning();

        // DD-017's narration, in the same transaction as the insert, so
        // no Request can exist without the entry that says who asked.
        // The payload carries no free text — not the summary, and not
        // the collected values, only the slugs that were answered. The
        // log is append-only, so a requester's own words could never
        // leave it again; R-42 is the Request's name, and the number
        // never changes.
        await recordActivity(tx, {
          entityType: "request",
          entityId: row!.id,
          actorId: request.user.id,
          action: "request.created",
          visibility: RECORD_ACTIVITY_TIER,
          payload: {
            number: row!.number,
            requestType: requestType.displayName,
            urgency: row!.urgency,
            customFields: Object.keys(customFields).sort((a, b) => a.localeCompare(b)),
          },
        });
        return row!;
      });

      reply.code(201);
      return {
        request: {
          id: created.id,
          number: created.number,
          requestTypeId: created.requestTypeId,
          status: "new" as const,
          summary: created.summary,
          description: created.description,
          urgency: created.urgency,
          customFields: created.customFields,
          createdAt: created.createdAt.toISOString(),
        },
      };
    },
  );
};

/**
 * The submitted values, checked against the fields the type attaches
 * and reduced to their stored shapes.
 *
 * A slug the type does not attach is refused rather than dropped: a
 * form that sent it is a form out of step with the type, and a value
 * stored under it would sit on the Request where nothing could show it
 * or clear it. An empty answer leaves no key at all, so "nothing
 * recorded" has one shape here as it does on a contract.
 */
function collectValues(
  attached: readonly AttachedCustomField[],
  incoming: Readonly<Record<string, CustomFieldValue | null>>,
): Record<string, CustomFieldValue> {
  const values: Record<string, CustomFieldValue> = {};
  for (const [slug, raw] of Object.entries(incoming)) {
    const field = attached.find((candidate) => candidate.slug === slug);
    if (!field) throw httpError(400, "That field is not on this request type's form.");
    const value = coerceCustomFieldValue(field, raw);
    if (value !== null) values[slug] = value;
  }
  return values;
}

/**
 * The two field types that name a row: `user` and `entity` store an
 * id, so the write checks the id is a live one — the contract
 * record's `lockedReference` rule, restated here because
 * `coerceCustomFieldValue` leaves that question to the record module.
 * Locked, so a concurrent archive cannot slip between the check and
 * the insert. Archived is refused for the reason it is refused there:
 * nothing new gets pointed at someone who has left.
 */
async function assertLiveReference(
  tx: Transaction,
  field: AttachedCustomField,
  id: string,
): Promise<void> {
  if (field.fieldType === "user") {
    // Anyone live: a custom person field carries no role floor.
    const [person] = await tx
      .select({ id: users.id, archivedAt: users.archivedAt })
      .from(users)
      .where(eq(users.id, id))
      .limit(1)
      .for("update");
    if (!person || person.archivedAt) {
      throw httpError(400, `${field.displayName}: pick a live person.`);
    }
    return;
  }
  const [entity] = await tx
    .select({ id: entities.id, archivedAt: entities.archivedAt })
    .from(entities)
    .where(eq(entities.id, id))
    .limit(1)
    .for("update");
  if (!entity || entity.archivedAt) {
    throw httpError(400, `${field.displayName}: pick a live entity.`);
  }
}

/** The required rule for basics and attachments alike: one refusal that
 * names every gap, in the order the form draws them. */
function assertAnswered(checks: readonly { name: string; answered: boolean }[]): void {
  const missing = checks.filter((check) => !check.answered).map((check) => check.name);
  if (missing.length === 0) return;
  throw httpError(
    400,
    `Fill ${listNames(missing)} first — the form requires ${missing.length === 1 ? "it" : "them"}.`,
  );
}
