// SPDX-License-Identifier: AGPL-3.0-only

/** Request submission evaluates the destination Intake Form under the destination
type lock. Only visible Rows accept answers or enforce Required. Attachments
follow the accepted Request in separate uploads. */

import {
  and,
  contracts,
  count,
  eq,
  gte,
  isNull,
  matters,
  REQUEST_STATUSES,
  requestAttachments,
  requests,
  requestTypes,
  SEVERITY_LEVELS,
  sql,
  type Executor,
} from "@openlaw/db";
import {
  isOpenRequestStatus,
  REQUEST_DISPOSITIONED_PROBLEM_TYPE,
  REQUEST_OUTCOMES,
} from "@openlaw/shared";
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { PassThrough } from "node:stream";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import type { AuthenticatedUser } from "../../auth/guards.js";
import { requireAuth } from "../../auth/guards.js";
import { AttachedCustomFieldSchema, CustomFieldsSchema } from "../../lib/custom-fields.js";
import { readIntakeForm } from "../../lib/intake-form.js";
import { portalRecordScope } from "../../lib/portal-record-access.js";
import { httpError, problemResponse, problemTypeResponse } from "../../lib/problem.js";
import {
  asUploadRefusal,
  MEGABYTE,
  refuseOversize,
  uploadFilename,
  withStoredBlob,
} from "../../lib/uploads.js";
import { departmentName } from "../departments/references.js";
import {
  attachmentOn,
  DownloadSchema,
  NO_ATTACHMENT,
  NO_REQUEST,
  requestAssignees,
  RequestAttachmentSchema,
  RequestCustomFieldRefsSchema,
  resolveRefs,
  selectAttachments,
  selectConvertedRecords,
  sendAttachment,
  toAttachment,
} from "./projection.js";
import { convertedContractOf, convertedRecordOf } from "./record-reference.js";
import {
  listMyRequests,
  lockPerson,
  submitRequest,
  SubmitRequestBody,
  toPortalRequestRow,
} from "./service.js";

/** The Request as its creator is answered. Narrow on purpose: the
 * confirmation needs the number to quote and the status to state, and
 * the rest of the envelope is the detail view's (ticket 7). */
const RequestSchema = z.object({
  id: z.string(),
  /** INT-002's global reference; the portal renders it R-###. */
  number: z.number().int(),
  requestTypeId: z.string(),
  status: z.literal("new"),
  title: z.string(),
  description: z.string().nullable(),
  departmentId: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
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
  owner: z.object({ displayName: z.string() }).nullable(),
  id: z.string(),
  /** Rendered R-###; it is also what the detail is addressed by. */
  number: z.number().int(),
  status: z.enum(REQUEST_STATUSES),
  title: z.string(),
  requestType: RequestTypeRefSchema,
  /** The age the list states, computed by the reader. */
  createdAt: z.string(),
});

/** The Request detail's envelope: the I7 head block, the "What you
 * submitted" card, and the disposition. */
const MyRequestSchema = MyRequestRowSchema.extend({
  description: z.string().nullable(),
  departmentId: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
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
          "Submit the destination type's Intake Form. The session is the Requester. Required applies to visible Rows, and answers outside that set are refused.",
        tags: ["requests"],
        body: SubmitRequestBody,
        response: { 201: z.object({ request: RequestSchema }), default: problemResponse },
      },
    },
    async (request, reply) => {
      const answer = await submitRequest(app.db, request.user, request.body, app.notifier);
      return reply.code(201).send(answer);
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
      return listMyRequests(app.db, request.user);
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
            redirectTo: z
              .object({ module: z.enum(["contract", "matter"]), number: z.number().int() })
              .nullable(),
            recordArchived: z.boolean(),
            /** Current Intake Row labels. Detached or archived Rows retain their answers but are not drawn. */
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
          convertedContractId: requests.convertedContractId,
          convertedMatterId: requests.convertedMatterId,
          title: requests.title,
          description: requests.description,
          departmentId: requests.departmentId,
          urgency: requests.urgency,
          customFields: requests.customFields,
          declinedReason: requests.declinedReason,
          createdAt: requests.createdAt,
          typeId: requestTypes.id,
          typeSlug: requestTypes.slug,
          typeDisplayName: requestTypes.displayName,
          owner: { displayName: requestAssignees.displayName },
        })
        .from(requests)
        .innerJoin(requestTypes, eq(requests.requestTypeId, requestTypes.id))
        .leftJoin(requestAssignees, eq(requests.assigneeId, requestAssignees.id))
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

      let redirectTo: { module: "contract" | "matter"; number: number } | null = null;
      let recordArchived = false;
      if (row.status === "converted") {
        const module = row.convertedMatterId ? "matter" : "contract";
        const targetId = row.convertedMatterId ?? row.convertedContractId;
        const target = module === "contract" ? contracts : matters;
        if (!targetId) throw httpError(404, NO_REQUEST);
        const [destination] = await app.db
          .select({ number: target.number, archivedAt: target.archivedAt })
          .from(target)
          .where(eq(target.id, targetId))
          .limit(1);
        if (!destination) throw httpError(404, NO_REQUEST);
        recordArchived = destination.archivedAt !== null;
        if (!recordArchived) {
          const [allowed] = await app.db
            .select({ id: target.id })
            .from(target)
            .where(and(eq(target.id, targetId), portalRecordScope(app.db, request.user, module)))
            .limit(1);
          if (!allowed) throw httpError(404, NO_REQUEST);
          redirectTo = { module, number: destination.number };
        }
      }

      const [attached, attachments] = await Promise.all([
        readIntakeForm(app.db, row.typeId, { includeArchived: true }),
        row.status === "converted" ? [] : selectAttachments(app.db, row.id),
      ]);
      const readableFields = attached.fields;
      return {
        redirectTo,
        recordArchived,
        request: {
          ...toPortalRequestRow(row),
          description: row.description,
          departmentId: row.departmentId,
          department: await departmentName(app.db, row.departmentId),
          urgency: row.urgency,
          customFields: row.customFields,
          declinedReason: row.declinedReason,
        },
        fields: readableFields,
        customFieldRefs: await resolveRefs(app.db, readableFields, row.customFields),
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
            "A triaged Request takes paper on its thread, not as another " +
              "Request attachment (INT-002, CMT-011). The named refusal carries " +
              "`request`, the R-### whose portal detail owns that thread; `outcome`, " +
              "the disposition already recorded; and `convertedRecord`, the record " +
              "a conversion made when the caller may reach it (DD-014), else `null`.",
            [REQUEST_DISPOSITIONED_PROBLEM_TYPE],
            {
              request: z.object({ number: z.number().int() }).optional(),
              outcome: z.enum(REQUEST_OUTCOMES).optional(),
              convertedContract: z.object({ number: z.number().int() }).nullable().optional(),
              convertedRecord: z
                .discriminatedUnion("module", [
                  z.object({ module: z.literal("contract"), number: z.number().int() }),
                  z.object({ module: z.literal("matter"), number: z.number().int() }),
                ])
                .nullable()
                .optional(),
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
      // Asked before a single byte is read too: a person already at the
      // hourly byte quota is told so without uploading anything first.
      await refuseAttachmentQuota(app.db, request.user.id, 0);

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
          // The quota is per person across every Request, so the person is
          // locked rather than the Request: two uploads on two Requests
          // cannot both read the same total and pass.
          await lockPerson(tx, request.user.id);
          await refuseAttachmentQuota(tx, request.user.id, file.byteSize);
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
              byteSize: file.byteSize,
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
      if (held.status === "converted") throw httpError(404, NO_ATTACHMENT);
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
   * record's own reach (DD-014) and never an archived one. The route is the
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
    if (isOpenRequestStatus(held.status)) return;
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
          convertedRecord: convertedRecordOf(convertedRecords.get(held.id) ?? null),
        },
      },
    );
  }

  /**
   * Takes one file off a multipart upload and stores its bytes through
   * the adapter.
   *
   * Streamed straight through: never buffered whole in memory and never
   * staged on disk. The only thing counted on the way past is the byte
   * size, which the route persists for the per-person quota (ADO-013).
   * An attachment stores no checksum and no declared type (INT-002's
   * "lightweight"), and a conversion that needs either reads it off the
   * blob.
   */
  async function receiveAttachment(
    request: FastifyRequest,
    key: string,
  ): Promise<{ filename: string; fileRef: string; byteSize: number }> {
    const part = await request.file().catch((error: unknown) => {
      throw asUploadRefusal(error, app.maxUploadBytes);
    });
    if (!part) throw httpError(400, "Attach a file to upload.");
    const filename = uploadFilename(part.filename);

    let fileRef: string;
    let byteSize = 0;
    try {
      // The parser's stream goes to the driver through one counter, so
      // the hourly byte quota can be kept from the database (M12).
      const counting = new PassThrough({
        transform(chunk: Buffer, _encoding, callback) {
          byteSize += chunk.length;
          callback(null, chunk);
        },
      });
      part.file.on("error", (error) => counting.destroy(error));
      fileRef = await app.storage.put(key, part.file.pipe(counting));
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
    return { filename, fileRef, byteSize };
  }

  /** Refuses with 429 when `incoming` more bytes would pass the hourly attachment quota. */
  async function refuseAttachmentQuota(db: Executor, userId: string, incoming: number) {
    const used = await recentAttachmentBytes(db, userId);
    if (
      used + incoming > MAX_REQUEST_ATTACHMENT_BYTES_PER_HOUR ||
      used >= MAX_REQUEST_ATTACHMENT_BYTES_PER_HOUR
    )
      throw httpError(
        429,
        `Your attachments in the last hour have reached the ${Math.round(MAX_REQUEST_ATTACHMENT_BYTES_PER_HOUR / MEGABYTE)} MB limit. Wait before attaching more.`,
      );
  }
};

/**
 * The per-person quotas on the Portal's write paths (M12). Each Request
 * fans out to every Member and each attachment is disk, and the proxy
 * cannot key a limit on the account, so the API keeps these from the
 * database. Both count a sliding hour.
 */
const MAX_REQUEST_ATTACHMENT_BYTES_PER_HOUR = 256 * MEGABYTE;
const QUOTA_WINDOW_MS = 60 * 60_000;
function quotaWindowStart(): Date {
  return new Date(Date.now() - QUOTA_WINDOW_MS);
}

/** How many attachment bytes this person uploaded in the last hour. */
async function recentAttachmentBytes(db: Executor, userId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${requestAttachments.byteSize}), 0)` })
    .from(requestAttachments)
    .where(
      and(
        eq(requestAttachments.uploadedBy, userId),
        gte(requestAttachments.createdAt, quotaWindowStart()),
      ),
    );
  return Number(row?.total ?? 0);
}

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
