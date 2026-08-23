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
 * ## The paper that travels with the ask (#380)
 *
 * Attachments are the fourth basic, and they are optional: a submission
 * with none is complete. `POST /requests/{number}/attachments` takes one
 * file per call through the storage seam documents already upload
 * through, and writes a `request_attachments` row while the Request is
 * `new`. After a disposition it refuses with the stable Request thread
 * named, because paper now arrives on a comment (CMT-011). **Nothing
 * enters `documents`** — a Request is not a document owner (DOC-008),
 * and promotion into the record a Request becomes is conversion's job
 * (M21).
 *
 * **The upload is a write on the Request, so it sits at `/requests` like
 * the submission it belongs to.** The reads split by audience — the
 * requester's own download is on the portal mount beside the detail that
 * lists it — because a read's projection is what differs between a
 * requester and M21's Inbox. A write of the record does not differ; it
 * is the same act whoever makes it.
 *
 * A Request the caller did not submit answers 404 on both, exactly as
 * the detail read does: to a requester another person's Request does not
 * exist, and neither does its paper.
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
import type { FastifyRequest } from "fastify";
import type { AuthenticatedUser } from "../../auth/guards.js";
import { z } from "zod";
import { uuidv7 } from "uuidv7";
import {
  and,
  count,
  desc,
  entities,
  eq,
  isNull,
  REQUEST_STATUSES,
  requestAttachments,
  requestTypeFields,
  requestTypes,
  requests,
  SEVERITY_LEVELS,
  users,
  type CustomFieldValue,
  type Executor,
  type Transaction,
} from "@openlaw/db";
import { REQUEST_DISPOSITIONED_PROBLEM_TYPE, REQUEST_OUTCOMES } from "@openlaw/shared";
import { requireAuth } from "../../auth/guards.js";
import {
  asUploadRefusal,
  refuseOversize,
  uploadFilename,
  withStoredBlob,
} from "../../lib/uploads.js";
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
import { httpError, problemResponse, problemTypeResponse } from "../../lib/problem.js";
import {
  attachmentOn,
  DownloadSchema,
  NO_ATTACHMENT,
  NO_REQUEST,
  RequestAttachmentSchema,
  RequestCustomFieldRefsSchema,
  resolveRefs,
  selectConvertedRecords,
  selectAttachments,
  sendAttachment,
  toAttachment,
} from "./projection.js";
import { convertedContractOf } from "./record-reference.js";

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
      // The seam's transaction rather than the database's: the receipt
      // is written inside the same commit as the Request it is about
      // (NOT-001), so a submission that rolls back leaves no receipt for
      // an ask nobody made — and the email leaves only after it commits.
      const created = await app.notifier.notifying(async (tx) => {
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
        // The receipt (INT-001, NOT-002 group 5), and the one event in
        // the catalog addressed to the person who caused it: proof that
        // an ask arrived is the whole content of the message, and a
        // receipt addressed to nobody is not a receipt. The exception
        // lives behind the seam — this route names what happened and
        // nothing else.
        await app.notifier.requestCreated(tx, {
          requestId: row!.id,
          actorId: request.user.id,
          actorName: request.user.displayName,
        });
        // The arrival (INT-006, NOT-002 group 4), which is the same act
        // told to the other side: every live Member+ hears that
        // something is waiting, bell on and email opt-in. Two events
        // rather than one, because the staff side and the requester side
        // are two sentences to two audiences with two defaults — and the
        // audience, the actor exclusion, the preferences, and the
        // after-commit wake-up are all the seam's, so this route still
        // names what happened and nothing else.
        await app.notifier.requestSubmitted(tx, {
          requestId: row!.id,
          actorId: request.user.id,
          actorName: request.user.displayName,
          requestType: requestType.displayName,
          urgency: row!.urgency,
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
          "the fields that name them, the files that travelled with " +
          "the ask, and the decline reason when it was declined " +
          "(INT-006). Another requester's Request answers 404",
        tags: ["requests"],
        params: NumberParams,
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
            /** The paper, oldest first — the order it was attached in,
             * which is the order the requester picked the files in.
             * Empty is an answer: a Request with no attachments is a
             * complete one (INT-002). */
            attachments: z.array(RequestAttachmentSchema),
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

      const [attached, attachments] = await Promise.all([
        selectAttachedFields(app.db, requestTypeFields, row.typeId),
        selectAttachments(app.db, row.id),
      ]);
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
        attachments,
      };
    },
  );

  app.post(
    "/requests/:number/attachments",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "attachToRequest",
        summary:
          "Attach one file to the caller's own Request (INT-002). The " +
          "bytes ride the storage seam documents upload through and the " +
          "row is a `request_attachments` row — nothing enters " +
          "`documents`, because a Request is not a document owner " +
          "(DOC-008) and promotion is conversion's (M21). One file per " +
          "call, sent as multipart/form-data under `file`. A Request " +
          "the caller did not submit answers 404; a dispositioned " +
          "Request refuses 409 and names its thread; and a file past " +
          `the ${MAX_REQUEST_ATTACHMENTS}-attachment bound is refused`,
        tags: ["requests"],
        consumes: ["multipart/form-data"],
        params: NumberParams,
        body: AttachmentUploadForm,
        response: {
          201: z.object({ attachment: RequestAttachmentSchema }),
          409: problemTypeResponse(
            "A Request that is no longer new takes paper on its thread, not as another " +
              "Request attachment (INT-002, CMT-011). The named refusal carries " +
              "`request`, the R-### whose portal detail owns that thread; `outcome`, " +
              "the disposition already recorded; and `convertedContract`, the record " +
              "a conversion made when the caller may reach it (DD-014), else `null`.",
            [REQUEST_DISPOSITIONED_PROBLEM_TYPE],
            {
              request: z.object({ number: z.number().int() }).optional(),
              outcome: z.enum(REQUEST_OUTCOMES).optional(),
              convertedContract: z.object({ number: z.number().int() }).nullable().optional(),
            },
          ),
          default: problemResponse,
        },
      },
    },
    async (request, reply) => {
      // Asked before a single byte is read: storing a file for somebody
      // who may not put one there is the thing this order avoids. It is
      // asked again below, under the row lock the insert runs in.
      const seen = await reachedRequest(app.db, request.user.id, request.params.number);
      await refuseDispositioned(app.db, request.user, seen);

      // Minted here, because the storage key is built from it and the
      // blob is written before the row exists (DOC-012). The key is
      // made of ids and never of the filename, so no name a person
      // chose can shape where the bytes live.
      const attachmentId = uuidv7();
      const file = await receiveAttachment(request, attachmentStorageKey(attachmentId));

      // The blob is written before the row (DOC-012), so a transaction
      // that refuses leaves it behind. The shared wrapper takes it away
      // and rethrows the refusal untouched — what the caller is owed is
      // the reason, not the cleanup.
      const created = await withStoredBlob(app.storage, request.log, file.fileRef, () =>
        app.db.transaction(async (tx) => {
          // The Request is held for the write, and reach is asked again
          // on the same snapshot. Status, reach, and the count meet
          // under this one lock: a disposition wins before the cap is
          // read, and two uploads racing on the last free slot cannot
          // both read the same count and insert.
          const held = await reachedRequest(tx, request.user.id, request.params.number, {
            lock: true,
          });
          await refuseDispositioned(tx, request.user, held);
          const [existing] = await tx
            .select({ attachments: count() })
            .from(requestAttachments)
            .where(eq(requestAttachments.requestId, held.id));
          if ((existing?.attachments ?? 0) >= MAX_REQUEST_ATTACHMENTS) {
            throw httpError(
              409,
              `A request carries at most ${MAX_REQUEST_ATTACHMENTS} attachments.`,
            );
          }
          const [row] = await tx
            .insert(requestAttachments)
            .values({
              id: attachmentId,
              requestId: held.id,
              fileRef: file.fileRef,
              filename: file.filename,
              uploadedBy: request.user.id,
            })
            .returning();
          return row!;
        }),
      );

      reply.code(201);
      return { attachment: toAttachment(created) };
    },
  );

  app.get(
    "/portal/requests/:number/attachments/:attachmentId",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "downloadMyRequestAttachment",
        summary:
          "Stream one attachment on the caller's own Request back, as a " +
          "download (DD-013). The bytes come through the API behind the " +
          "session; there are no presigned URLs. The type is always " +
          "`application/octet-stream`: a Request's attachment stores no " +
          "declared type, and a download never echoes one a client sent. " +
          "Another requester's Request — and an attachment on another " +
          "Request — answers 404",
        tags: ["requests"],
        produces: ["application/octet-stream"],
        params: NumberParams.extend({ attachmentId: z.string() }),
        response: { 200: DownloadSchema, default: problemResponse },
      },
    },
    async (request, reply) => {
      const held = await reachedRequest(app.db, request.user.id, request.params.number);
      const row = await attachmentOn(app.db, held.id, request.params.attachmentId);
      if (!row) throw httpError(404, NO_ATTACHMENT);
      // One answer for both mounts, so the staff download and this one
      // cannot drift into two readings of the same bytes.
      return sendAttachment(reply, await app.storage.get(row.fileRef), row.filename);
    },
  );

  /**
   * One Request the caller submitted, or the one refusal (DD-013).
   *
   * The scoping is part of the lookup, as it is on the detail read, so
   * there is no branch where the row was read and then refused. `lock`
   * holds the row for a write: an upload checks the status, counts what
   * is already attached, and then inserts. One lock keeps a disposition
   * from crossing the write and keeps two uploads racing on the last
   * free slot from both reading the same count.
   */
  async function reachedRequest(
    db: Executor,
    userId: string,
    number: number,
    options: { lock?: boolean } = {},
  ): Promise<{
    id: string;
    number: number;
    status: (typeof REQUEST_STATUSES)[number];
  }> {
    const query = db
      .select({
        id: requests.id,
        number: requests.number,
        status: requests.status,
      })
      .from(requests)
      .where(
        and(
          eq(requests.number, number),
          eq(requests.requesterId, userId),
          isNull(requests.archivedAt),
        ),
      )
      .limit(1);
    const [row] = await (options.lock ? query.for("update") : query);
    if (!row) throw httpError(404, NO_REQUEST);
    return row;
  }

  /**
   * The refusal a dispositioned Request answers an upload with (INT-002,
   * CMT-011). Asked twice: once on a plain read before any byte is
   * stored, so a Requester who keeps posting to a closed Request does
   * not write and delete a blob per attempt, and once more under the
   * row lock, for the disposition that lands between the two.
   *
   * The record a conversion made is named under the caller's own
   * contract reach (DD-014) and never an archived one. The route is the
   * Requester's, and a Business User reaches no Contract at all, so for
   * them this is `null` — the same answer the portal read and the staff
   * disposition refusal give. A refusal must not hand out a reference
   * the read would withhold.
   */
  async function refuseDispositioned(
    db: Executor,
    user: AuthenticatedUser,
    held: Awaited<ReturnType<typeof reachedRequest>>,
  ): Promise<void> {
    if (held.status === "new") return;
    const convertedRecords = await selectConvertedRecords(db, user, [held.id]);
    throw httpError(
      409,
      "This Request has already been dispositioned. Attach new paper to a reply in its thread.",
      {
        type: REQUEST_DISPOSITIONED_PROBLEM_TYPE,
        extensions: {
          request: { number: held.number },
          outcome: held.status,
          convertedContract: convertedContractOf(convertedRecords.get(held.id) ?? null),
        },
      },
    );
  }

  /**
   * Takes one file off a multipart upload and stores its bytes through
   * the adapter.
   *
   * Streamed straight through: never buffered whole in memory and never
   * staged on disk. Nothing is derived from the bytes on the way past —
   * an attachment stores no size, no checksum, and no declared type
   * (INT-002's "lightweight"), and a conversion that needs any of them
   * reads them off the blob.
   */
  async function receiveAttachment(
    request: FastifyRequest,
    key: string,
  ): Promise<{ filename: string; fileRef: string }> {
    const part = await request.file().catch((error: unknown) => {
      throw asUploadRefusal(error, app.maxUploadBytes);
    });
    if (!part) throw httpError(400, "Attach a file to upload.");
    const filename = uploadFilename(part.filename);

    let fileRef: string;
    try {
      // The parser's own stream, straight to the driver: nothing here
      // reads the bytes on the way past, so there is nothing to wrap
      // them in.
      fileRef = await app.storage.put(key, part.file);
    } catch (error) {
      throw asUploadRefusal(error, app.maxUploadBytes);
    }
    // The ceiling, enforced. The parser stops the stream at the limit
    // and marks it truncated rather than throwing at whoever is reading
    // it, so what reached the driver is the first N bytes of a longer
    // file — a silent corruption if it were kept. This is the one case
    // where the writer knows the blob is worthless, so it is removed
    // here rather than left as an orphan.
    if (part.file.truncated) {
      await app.storage.delete(fileRef).catch((error: unknown) => {
        request.log.warn({ err: error, fileRef }, "could not remove a truncated upload");
      });
      throw refuseOversize(app.maxUploadBytes);
    }
    return { filename, fileRef };
  }
};

/**
 * How many files one ask may carry.
 *
 * A bound rather than none, because the portal is open to every Business
 * User and an unbounded upload address is unbounded disk. It is generous
 * for what INT-002 calls lightweight — a redline, the prior agreement, a
 * term sheet, and room to spare — and a Request that needs more paper
 * than this is a matter or a contract, which is what conversion makes it
 * (M21).
 */
const MAX_REQUEST_ATTACHMENTS = 20;

/** Where one attachment's blob lives (DOC-012): minted from its id,
 * never from a filename, so no name a person chose can shape a storage
 * key. */
function attachmentStorageKey(attachmentId: string): string {
  return `request-attachments/${attachmentId}`;
}

/** The R-### a Request is addressed by, on every route that takes one. */
const NumberParams = z.object({ number: z.coerce.number().int().positive() });

/**
 * What an attachment upload carries, described for the OpenAPI document
 * only.
 *
 * The parser hands the request over as a stream rather than as a parsed
 * body, so there is nothing for a validator to run against here and the
 * schema accepts anything. The file part is checked as it arrives, which
 * is the only way to refuse an oversized file without first storing it.
 */
const AttachmentUploadForm = z.any().meta({
  type: "object",
  properties: {
    file: {
      type: "string",
      format: "binary",
      description:
        "The file itself. Any type is accepted; a Request's attachment " +
        "stores no declared type and its download never echoes one.",
    },
  },
  required: ["file"],
});

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
