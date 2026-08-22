// SPDX-License-Identifier: AGPL-3.0-only

/**
 * What both reads of one Request answer about it (INT-001, INT-002).
 *
 * A Request has two audiences and therefore two mounts — the portal's,
 * which answers a requester their own ask, and the staff's, which
 * answers triage any of them (the M20/5 rule). The projections differ,
 * because who is reading decides what is worth saying. Three things do
 * not differ, and they live here so the two mounts cannot drift into
 * two answers about the same row:
 *
 * - **The paper**, as a shape and as a listing. An attachment is an id,
 *   a filename, and a stamp on either mount, because a Request's
 *   attachment stores nothing else (INT-002's "lightweight") and a
 *   staff reader gains nothing from a second spelling of it.
 * - **The download's own answer** — the headers a stored blob is sent
 *   back under. `application/octet-stream` always: the table stores no
 *   declared type, and a download never echoes one a client sent
 *   (DOC-004). One helper, so the staff mount and the portal mount
 *   cannot answer the same bytes two ways.
 * - **The rows a stored value names.** A `user` or an `entity` value
 *   holds an id, and neither surface can render one; both resolve them
 *   into names, and both resolve **archived** rows on purpose — a
 *   Request that already names somebody who has left must go on naming
 *   them, exactly as a contract does. An id that resolves to nothing at
 *   all is left to the caller, which renders it raw (the INT-001 M20/10
 *   addendum).
 *
 * **The staff envelope lives here too, and for the same reason.** The
 * staff detail reads it and every disposition route answers it back
 * (INT-007) — the read that opened the screen and the write that
 * changed it are one sentence about one Request, and two spellings of
 * it would let a decline answer a shape the detail never draws.
 */

import type { FastifyReply } from "fastify";
import { z } from "zod";
import {
  and,
  asc,
  contracts,
  contractTypes,
  entities,
  eq,
  inArray,
  isNull,
  matterTypes,
  REQUEST_STATUSES,
  requestAttachments,
  requestTypes,
  requests,
  SEVERITY_LEVELS,
  users,
  type CustomFieldValue,
  type Executor,
} from "@openlaw/db";
import type { AuthenticatedUser } from "../../auth/guards.js";
import { contractTeamScope } from "../../lib/contract-access.js";
import { CustomFieldsSchema } from "../../lib/custom-fields.js";
import { httpError } from "../../lib/problem.js";
import { attachmentDisposition } from "../../lib/uploads.js";
import type { AttachedCustomField } from "../../lib/custom-fields.js";

/**
 * The front door a Request came through, with the routing the
 * Administrator bound to it (INT-002's three-state target).
 *
 * One shape for both staff reads, so the Inbox row a triager clicked
 * and the detail it opened say the target the same way. "Contract ·
 * NDA" means the conversion is one confirmation, "Contract" means one
 * choice is still owed, and no target means this ask may not become a
 * record at all (DD-018). It is not the portal's projection: a
 * requester reads the door's name and the slug that addresses its form,
 * and the target administers the taxonomy.
 */
export const StaffRequestTypeSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  targetModule: z.enum(["matter", "contract"]).nullable(),
  targetTypeName: z.string().nullable(),
});

/**
 * The target module as the wire carries it.
 *
 * The column is plain text and the table's check constraint is what
 * closes it to two values, so the union is restated on the way out
 * rather than asserted: an install carrying anything else reads as no
 * target, which is the state the model already has.
 */
export function targetModuleOf(stored: string | null): "matter" | "contract" | null {
  if (stored === "matter" || stored === "contract") return stored;
  return null;
}

/**
 * One attachment, as the upload and both detail reads answer it.
 *
 * The stored reference is not on the wire: it names a driver and a key,
 * which is where the bytes live rather than anything a reader can do.
 * The id addresses the download and the filename is what a person
 * recognises.
 */
export const RequestAttachmentSchema = z.object({
  id: z.string(),
  filename: z.string(),
  createdAt: z.string(),
});

/** The people and Entities a stored value names, resolved so a detail
 * can render a name where the row holds an id. One narrow shape for
 * both mounts: a name is the whole of what either surface draws, and a
 * staff reader who wants more opens the directory. */
export const RequestCustomFieldRefsSchema = z.object({
  users: z.array(z.object({ id: z.string(), displayName: z.string() })),
  entities: z.array(z.object({ id: z.string(), legalName: z.string() })),
});

/**
 * One refusal for both misses. A number nobody has and a number
 * somebody else has read the same on the portal, because to a requester
 * another person's Request does not exist — a message that told the two
 * apart would confirm the row is there (DD-013). The staff mount reaches
 * every Request, so the only miss it can meet is a number nobody has,
 * and it says the same sentence for it.
 */
export const NO_REQUEST = "No request exists with this reference.";

/**
 * One refusal for both misses on an attachment. An id nobody has and an
 * id on another Request read the same, for the reason {@link NO_REQUEST}
 * reads the same for two numbers.
 */
export const NO_ATTACHMENT = "No attachment exists with this reference.";

/** A stored blob, as a download route needs it described. */
export const DownloadSchema = z.any().meta({ type: "string", format: "binary" });

/** The stored row, as the wire answers it. */
export function toAttachment(row: { id: string; filename: string; createdAt: Date }) {
  return { id: row.id, filename: row.filename, createdAt: row.createdAt.toISOString() };
}

/**
 * Every attachment on one Request, oldest first — the order it was
 * attached in, which is the order the requester picked the files in.
 * Empty is an answer: a Request with no attachments is a complete one
 * (INT-002).
 */
export async function selectAttachments(db: Executor, requestId: string) {
  const rows = await db
    .select({
      id: requestAttachments.id,
      filename: requestAttachments.filename,
      createdAt: requestAttachments.createdAt,
    })
    .from(requestAttachments)
    .where(eq(requestAttachments.requestId, requestId))
    .orderBy(asc(requestAttachments.createdAt), asc(requestAttachments.id));
  return rows.map(toAttachment);
}

/**
 * One attachment on one Request, or the one refusal.
 *
 * The Request is part of the lookup rather than a check after it, so an
 * attachment id from another Request is a miss and not a row that was
 * read and then refused.
 */
export async function attachmentOn(
  db: Executor,
  requestId: string,
  attachmentId: string,
): Promise<{ fileRef: string; filename: string } | null> {
  const [row] = await db
    .select({ fileRef: requestAttachments.fileRef, filename: requestAttachments.filename })
    .from(requestAttachments)
    .where(
      and(eq(requestAttachments.id, attachmentId), eq(requestAttachments.requestId, requestId)),
    )
    .limit(1);
  return row ?? null;
}

/**
 * The one answer a Request's attachment is downloaded under, whichever
 * mount asked.
 *
 * The bytes come through the API behind the session; there are no
 * presigned URLs. The type is never one a client declared — the table
 * stores none, on purpose, and an email document's download already
 * answers the widest thing that is always true (DOC-004). A stored blob
 * never changes (DOC-012), but who may read it does, so the response is
 * private to the browser that asked.
 */
export function sendAttachment(reply: FastifyReply, body: unknown, filename: string): FastifyReply {
  return reply
    .header("content-type", "application/octet-stream")
    .header("content-disposition", attachmentDisposition(filename))
    .header("x-content-type-options", "nosniff")
    .header("cache-control", "private, max-age=0, must-revalidate")
    .send(body);
}

/**
 * The rows the stored values name, resolved so a detail renders a name
 * where the jsonb holds an id — the contract record's rule, in the
 * Request's narrower shape.
 *
 * Archived rows are resolved on purpose, as they are on a contract: the
 * pickers stop offering a person who has left, and a Request that
 * already names one must go on naming them.
 */
export async function resolveRefs(
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

/** Who asked, as the hero and the Requester card draw them: the name,
 * the avatar, and the address a triager answers out of band on. */
const StaffRequesterSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  email: z.string(),
  image: z.string().nullable(),
});

/**
 * The envelope, as I2's sub-bar, hero, and cards draw it.
 *
 * The staff detail answers it on the way in and every disposition route
 * answers it on the way out (INT-007), so the read that opens the screen
 * and the write that changes it say one sentence about one Request.
 */
export const StaffRequestSchema = z.object({
  id: z.string(),
  /** INT-002's global reference; the screen renders it R-###. */
  number: z.number().int(),
  status: z.enum(REQUEST_STATUSES),
  summary: z.string(),
  description: z.string().nullable(),
  /** DES-018's severity ramp, as the requester claimed it. */
  urgency: z.enum(SEVERITY_LEVELS),
  /** What the form collected, keyed by field slug (INT-002). */
  customFields: CustomFieldsSchema,
  /** INT-006: "no" always arrives with a why. NULL on every status but
   * `declined`. */
  declinedReason: z.string().nullable(),
  createdAt: z.string(),
  requestType: StaffRequestTypeSchema,
  requester: StaffRequesterSchema,
  /** The record a conversion made, when this viewer reaches it, and
   * `null` in every other case — never converted, converted into a
   * record they may not see, or converted into a Matter (M22). */
  convertedContract: z.object({ number: z.number().int() }).nullable(),
});

/**
 * One Request by its reference, with everything the envelope states
 * joined onto it, or the one refusal.
 *
 * There is no per-row scope to defend — Member+ read every Request
 * (INT-006) — so the only miss is a reference nobody has, or one that
 * has been archived. The contract join is the one that carries a rule:
 * it is taken under this viewer's own reach, so a record they may not
 * see contributes no row and the left join answers NULL. That is the
 * whole of the DD-014 omission — there is no branch after the read that
 * decides whether to keep the number.
 *
 * It takes an `Executor` rather than the app's `db`, so a disposition
 * reads the envelope back **inside its own transaction** and answers
 * what it just wrote rather than what a concurrent write left behind.
 */
export async function staffRequestRow(db: Executor, user: AuthenticatedUser, number: number) {
  const [row] = await db
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
      typeDisplayName: requestTypes.displayName,
      targetModule: requestTypes.targetModule,
      targetContractTypeName: contractTypes.displayName,
      targetMatterTypeName: matterTypes.displayName,
      requesterId: users.id,
      requesterDisplayName: users.displayName,
      requesterEmail: users.email,
      requesterImage: users.image,
      convertedContractNumber: contracts.number,
    })
    .from(requests)
    .innerJoin(requestTypes, eq(requests.requestTypeId, requestTypes.id))
    .innerJoin(users, eq(requests.requesterId, users.id))
    .leftJoin(contractTypes, eq(requestTypes.targetContractTypeId, contractTypes.id))
    .leftJoin(matterTypes, eq(requestTypes.targetMatterTypeId, matterTypes.id))
    .leftJoin(
      contracts,
      and(
        eq(requests.convertedContractId, contracts.id),
        // A contract this viewer cannot reach joins to nothing, so the
        // envelope carries no link and the Request still carries itself
        // (DD-014, CTR-021).
        contractTeamScope(db, user),
        // An archived contract is no trail either: the link would open
        // on a record the Contracts destination hides.
        isNull(contracts.archivedAt),
      ),
    )
    .where(and(eq(requests.number, number), isNull(requests.archivedAt)))
    .limit(1);
  if (!row) throw httpError(404, NO_REQUEST);
  return row;
}

/** The joined row, as {@link StaffRequestSchema} puts it on the wire. */
export function toStaffRequest(row: Awaited<ReturnType<typeof staffRequestRow>>) {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    summary: row.summary,
    description: row.description,
    urgency: row.urgency,
    customFields: row.customFields,
    declinedReason: row.declinedReason,
    createdAt: row.createdAt.toISOString(),
    requestType: {
      id: row.typeId,
      displayName: row.typeDisplayName,
      targetModule: targetModuleOf(row.targetModule),
      // Whichever taxonomy the module points at, and null for the
      // module-only and no-target states alike.
      targetTypeName: row.targetContractTypeName ?? row.targetMatterTypeName,
    },
    requester: {
      id: row.requesterId,
      displayName: row.requesterDisplayName,
      email: row.requesterEmail,
      image: row.requesterImage,
    },
    convertedContract:
      row.convertedContractNumber === null ? null : { number: row.convertedContractNumber },
  };
}
