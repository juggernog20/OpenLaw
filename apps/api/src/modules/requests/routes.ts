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
 *
 * ## The requester's reads (#379)
 *
 * `GET /portal/requests` and `GET /portal/requests/{number}` answer the
 * my-requests list and the request detail. They sit on the **portal
 * mount** and in **this module**, and the two halves say different
 * things: the mount names the audience, the module names the record.
 * The INT-001 M20/3 addendum settled the mount — a requester-facing
 * read is its own route rather than a loosened gate on a staff one — and
 * the INT-002 M20/4 addendum settled the module, because one module
 * owns the Request whichever surface asks. M21's Inbox reads the same
 * rows through routes of its own, at a different address, with a
 * different projection.
 *
 * **Both reads scope to the session and nothing else** (DD-013). There
 * is no `requesterId` filter on the wire and no way to ask for somebody
 * else's list. A Request that is not the caller's is answered 404 rather
 * than 403: to a requester, another person's Request does not exist, and
 * a refusal that distinguished the two would confirm the row is there.
 * Member+ staff get the same rule applied to themselves — on this
 * surface they are a Requester like anybody else.
 *
 * **A converted Request keeps answering** (INT-001, DD-018). Conversion
 * writes a status and a link to what the Request became; it does not
 * archive the row and it does not close this window. What the Request
 * became is *not* answered here — a Business User cannot open a Contract
 * or a Matter, so a reference they could not follow would be a dead end
 * dressed as a fact.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  desc,
  entities,
  eq,
  inArray,
  isNull,
  REQUEST_STATUSES,
  requestTypeFields,
  requestTypes,
  requests,
  SEVERITY_LEVELS,
  users,
  type CustomFieldValue,
  type Executor,
  type Transaction,
} from "@openlaw/db";
import { requireAuth } from "../../auth/guards.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import {
  AttachedCustomFieldSchema,
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

/** The request type as a requester reads it on their own Request: the
 * name they picked at the door, and the slug that addresses its form.
 * Narrower than the picker's projection for that read's reason — the
 * target and the archive stamp administer the taxonomy. */
const RequestTypeRefSchema = z.object({
  id: z.string(),
  slug: z.string(),
  displayName: z.string(),
});

/** One row of my-requests. Five facts, because that is what the I5
 * block draws: the reference, the one-line ask, the front door it came
 * through, where it got to, and how old it is. */
const MyRequestRowSchema = z.object({
  id: z.string(),
  /** Rendered R-###; it is also what the detail is addressed by. */
  number: z.number().int(),
  status: z.enum(REQUEST_STATUSES),
  summary: z.string(),
  requestType: RequestTypeRefSchema,
  /** The age the list states, computed by the reader. */
  createdAt: z.string(),
});

/** The people and Entities a stored value names, resolved so the detail
 * can render a name where the row holds an id. The portal's own narrow
 * shape — a name and nothing else — because a requester reads neither
 * the staff directory nor the Entity registry, and one name they
 * themselves recorded is the whole of what this answers. */
const RequestCustomFieldRefsSchema = z.object({
  users: z.array(z.object({ id: z.string(), displayName: z.string() })),
  entities: z.array(z.object({ id: z.string(), legalName: z.string() })),
});

/** The Request detail's envelope: the I7 head block, the "What you
 * submitted" card, and the disposition. */
const MyRequestSchema = MyRequestRowSchema.extend({
  description: z.string().nullable(),
  urgency: z.enum(SEVERITY_LEVELS),
  customFields: CustomFieldsSchema,
  /** INT-006: "no" always arrives with a why. NULL on every status but
   * `declined`, and M21's decline route is what writes it. */
  declinedReason: z.string().nullable(),
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

  app.get(
    "/portal/requests",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "listMyRequests",
        summary:
          "The session user's own Requests, newest first (DD-013). " +
          "There is no way to ask for anybody else's, and a converted " +
          "Request stays on the list (INT-001). The whole list is " +
          "answered: it is one person's own asks, and a cap would hide " +
          "a Request from the only person who can see it",
        tags: ["requests"],
        response: {
          200: z.object({ requests: z.array(MyRequestRowSchema) }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const rows = await app.db
        .select({
          id: requests.id,
          number: requests.number,
          status: requests.status,
          summary: requests.summary,
          createdAt: requests.createdAt,
          typeId: requestTypes.id,
          typeSlug: requestTypes.slug,
          typeDisplayName: requestTypes.displayName,
        })
        .from(requests)
        .innerJoin(requestTypes, eq(requests.requestTypeId, requestTypes.id))
        // DD-013 as a `where` clause: the Requester is the session, and
        // the route offers no other filter to be widened by a query
        // string. Archived Requests are absent by the house rule that
        // NULL means live; nothing archives one yet, and a rule stated
        // now is a rule the first archiver inherits.
        .where(and(eq(requests.requesterId, request.user.id), isNull(requests.archivedAt)))
        // Newest first — the index the table declares, and the order a
        // person reading their own asks expects.
        //
        // Unpaged, deliberately. The lists that page in this API are
        // org-wide, where the row count is a fact about the whole
        // instance; this one is bounded by what a single person has
        // asked Legal for. A cap would silently drop a requester's own
        // Request from the only list that can show it, and the portal
        // home draws the block whole — there is no "load more" in I5 to
        // recover the tail with.
        .orderBy(desc(requests.createdAt), desc(requests.number));
      return { requests: rows.map(toRow) };
    },
  );

  app.get(
    "/portal/requests/:number",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "readMyRequest",
        summary:
          "One of the session user's own Requests by its R-### number " +
          "(DD-013): the envelope, the values the form collected with " +
          "the fields that name them, and the decline reason when it " +
          "was declined (INT-006). Another requester's Request answers " +
          "404",
        tags: ["requests"],
        params: z.object({ number: z.coerce.number().int().positive() }),
        response: {
          200: z.object({
            request: MyRequestSchema,
            /** The type's attached fields, in the order the form drew
             * them — the same read the form and the submission route
             * make, so the detail labels a value exactly as the box
             * that collected it was labelled. A value whose field has
             * since been detached or archived stays on the row and is
             * not drawn: the label that would name it is no longer on
             * this form, and `selectAttachedFields` already answers
             * that question for every record surface. */
            fields: z.array(AttachedCustomFieldSchema),
            customFieldRefs: RequestCustomFieldRefsSchema,
          }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const [row] = await app.db
        .select({
          id: requests.id,
          number: requests.number,
          status: requests.status,
          summary: requests.summary,
          description: requests.description,
          urgency: requests.urgency,
          customFields: requests.customFields,
          declinedReason: requests.declinedReason,
          createdAt: requests.createdAt,
          typeId: requestTypes.id,
          typeSlug: requestTypes.slug,
          typeDisplayName: requestTypes.displayName,
        })
        .from(requests)
        .innerJoin(requestTypes, eq(requests.requestTypeId, requestTypes.id))
        .where(
          and(
            eq(requests.number, request.params.number),
            // The scoping is part of the lookup rather than a check
            // after it, so there is no branch where the row was read
            // and then refused.
            eq(requests.requesterId, request.user.id),
            isNull(requests.archivedAt),
          ),
        )
        .limit(1);
      if (!row) throw httpError(404, NO_REQUEST);

      const attached = await selectAttachedFields(app.db, requestTypeFields, row.typeId);
      return {
        request: {
          ...toRow(row),
          description: row.description,
          urgency: row.urgency,
          customFields: row.customFields,
          declinedReason: row.declinedReason,
        },
        fields: attached,
        customFieldRefs: await resolveRefs(app.db, attached, row.customFields),
      };
    },
  );
};

/**
 * One refusal for both misses. A number nobody has and a number
 * somebody else has read the same, because to a requester another
 * person's Request does not exist — a message that told the two apart
 * would confirm the row is there (DD-013).
 */
const NO_REQUEST = "No request exists with this reference.";

/** The joined row, reshaped into the answer's nested request type. */
function toRow<T extends RequestRowColumns>(row: T) {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    summary: row.summary,
    createdAt: row.createdAt.toISOString(),
    requestType: { id: row.typeId, slug: row.typeSlug, displayName: row.typeDisplayName },
  };
}

interface RequestRowColumns {
  id: string;
  number: number;
  status: (typeof REQUEST_STATUSES)[number];
  summary: string;
  createdAt: Date;
  typeId: string;
  typeSlug: string;
  typeDisplayName: string;
}

/**
 * The rows the stored values name, resolved so the detail renders a
 * name where the jsonb holds an id — the contract record's rule, in the
 * portal's narrower shape.
 *
 * Archived rows are resolved on purpose, as they are on a contract: the
 * pickers stop offering a person who has left, and a Request that
 * already names one must go on naming them.
 */
async function resolveRefs(
  db: Executor,
  attached: readonly AttachedCustomField[],
  values: Readonly<Record<string, CustomFieldValue>>,
) {
  const idsOfType = (fieldType: "user" | "entity") => [
    ...new Set(
      attached
        .filter((field) => field.fieldType === fieldType)
        .map((field) => values[field.slug])
        .filter((value): value is string => typeof value === "string" && value !== ""),
    ),
  ];
  const userIds = idsOfType("user");
  const entityIds = idsOfType("entity");
  const [people, named] = await Promise.all([
    userIds.length === 0
      ? []
      : db
          .select({ id: users.id, displayName: users.displayName })
          .from(users)
          .where(inArray(users.id, userIds)),
    entityIds.length === 0
      ? []
      : db
          .select({ id: entities.id, legalName: entities.legalName })
          .from(entities)
          .where(inArray(entities.id, entityIds)),
  ]);
  return { users: people, entities: named };
}

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
