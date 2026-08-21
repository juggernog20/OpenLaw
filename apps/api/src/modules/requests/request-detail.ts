// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The staff request detail (INT-006, INT-007, #414): one Request as
 * triage reads it, and the paper that travelled with it.
 *
 * **A staff address beside the Inbox's, with its own projection** (the
 * M20/5 rule). `GET /portal/requests/{number}` answers a requester
 * their own ask and is untouched; this answers a Legal Team Member any
 * Request, whatever its status and whoever raised it. Same rows, two
 * projections, two gates — which is what keeps either route from
 * meaning two things.
 *
 * **Member+ only, and 403 below it** (INT-006, DD-013). A Contributor
 * and a Business User are refused rather than answered an empty
 * envelope: triage is legal's, and this is the screen it happens on.
 *
 * **Every status opens.** The Inbox is the undecided queue, but the
 * detail is the Request — a converted, resolved, or declined one still
 * has an envelope, values, paper, and a thread, and the triaged toggle
 * exists so yesterday's decisions stay findable (INT-007). Only an
 * archived Request is absent, by the house rule that NULL means live.
 *
 * **The values are labelled through the type's live attached fields**,
 * read by the same `selectAttachedFields` the form drew its boxes from
 * and the submission route checked against — so a value is named
 * exactly as the box that collected it was. A value whose field the
 * Administrator has since detached or archived stays on the row and is
 * not drawn: the label that would name it is no longer on this form,
 * which is the rule every record surface already applies. The `user`
 * and `entity` values are resolved into names, archived rows included,
 * and an id that resolves to nothing at all is answered as it is stored
 * — the caller renders it raw (the INT-001 M20/10 addendum), because
 * the Request does hold a value and a dash would say it holds none.
 *
 * **The requester is named with their address.** The Inbox row states
 * the person; the detail is where a triager decides whether to answer
 * in the thread or pick up the phone, so the email that raised the ask
 * rides on it. It is one Request's requester and never a directory
 * read.
 *
 * **A converted Request carries the record it became, or carries
 * nothing** — the Inbox row's rule, for the Inbox row's reason. The
 * contract is joined under this viewer's own reach (DD-014, CTR-021),
 * so a confidential record they are not on resolves to no row and the
 * answer says `null` rather than refusing the Request. The withholding
 * is the server's decision, in the CTR-018 posture. The matter arm is
 * not drawn: `converted_matter_id` carries no foreign key yet and
 * `matters` lands in M22.
 *
 * **The paper downloads through this mount too**, with the portal's own
 * answer — `application/octet-stream`, the same disposition, the same
 * cache rule — because the bytes do not change with the reader
 * (`projection.ts` owns that answer so the two mounts cannot drift). An
 * attachment id belonging to another Request is a miss rather than a
 * refusal.
 *
 * The thread is not here. It is one machinery keyed by an entity pair
 * (CMT-001), the `request` arm already puts Member+ in every room
 * (CMT-010), and the screen reads it through `/comments` exactly as the
 * contract record does.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  contracts,
  contractTypes,
  eq,
  isNull,
  matterTypes,
  REQUEST_STATUSES,
  requestTypeFields,
  requestTypes,
  requests,
  SEVERITY_LEVELS,
  users,
  type Executor,
} from "@openlaw/db";
import { requireRole, type AuthenticatedUser } from "../../auth/guards.js";
import { contractTeamScope } from "../../lib/contract-access.js";
import {
  AttachedCustomFieldSchema,
  CustomFieldsSchema,
  selectAttachedFields,
} from "../../lib/custom-fields.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import {
  attachmentOn,
  DownloadSchema,
  NO_ATTACHMENT,
  NO_REQUEST,
  RequestAttachmentSchema,
  RequestCustomFieldRefsSchema,
  resolveRefs,
  selectAttachments,
  sendAttachment,
  StaffRequestTypeSchema,
  targetModuleOf,
} from "./projection.js";

/** INT-006: Member+ triages, and there are no routing rules to narrow
 * that further. The Inbox's own gate, on the screen the Inbox opens. */
const requireMember = requireRole("administrator", "legal_team_member");

/** The R-### a Request is addressed by, on both routes here. */
const NumberParams = z.object({ number: z.coerce.number().int().positive() });

/** Who asked, as the hero and the Requester card draw them: the name,
 * the avatar, and the address a triager answers out of band on. */
const StaffRequesterSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  email: z.string(),
  image: z.string().nullable(),
});

/** The envelope, as I2's sub-bar, hero, and cards draw it. */
const StaffRequestSchema = z.object({
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

export const requestDetailRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/requests/:number",
    {
      preHandler: requireMember,
      schema: {
        operationId: "readRequest",
        summary:
          "One Request as triage reads it (INT-006), by its R-### " +
          "number: the envelope, the values the form collected with the " +
          "fields that name them, the `user` and `entity` rows those " +
          "values point at, and the paper that travelled with the ask. " +
          "Every status opens — the Inbox is the undecided queue, the " +
          "detail is the Request. A converted Request carries the " +
          "contract it became only when the caller reaches that " +
          "contract (DD-014). Member+ only: a Contributor and a " +
          "Business User are refused",
        tags: ["requests"],
        params: NumberParams,
        response: {
          200: z.object({
            request: StaffRequestSchema,
            /** The type's attached fields, in the order the form drew
             * them. A value whose field has since been detached or
             * archived is not among them and is therefore not drawn. */
            fields: z.array(AttachedCustomFieldSchema),
            customFieldRefs: RequestCustomFieldRefsSchema,
            /** The paper, oldest first. Empty is an answer: a Request
             * with no attachments is a complete one (INT-002). */
            attachments: z.array(RequestAttachmentSchema),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const row = await reachedRequest(app.db, request.user, request.params.number);
      const [attached, attachments] = await Promise.all([
        selectAttachedFields(app.db, requestTypeFields, row.typeId),
        selectAttachments(app.db, row.id),
      ]);
      return {
        request: {
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
        },
        fields: attached,
        customFieldRefs: await resolveRefs(app.db, attached, row.customFields),
        attachments,
      };
    },
  );

  app.get(
    "/requests/:number/attachments/:attachmentId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "downloadRequestAttachment",
        summary:
          "Stream one attachment on a Request back, as a download " +
          "(INT-006). The staff mount's own address, with the portal " +
          "download's answer: the bytes come through the API behind the " +
          "session, there are no presigned URLs, and the type is always " +
          "`application/octet-stream` — a Request's attachment stores no " +
          "declared type, and a download never echoes one a client sent. " +
          "An attachment id belonging to another Request answers 404. " +
          "Member+ only",
        tags: ["requests"],
        produces: ["application/octet-stream"],
        params: NumberParams.extend({ attachmentId: z.string() }),
        response: { 200: DownloadSchema, default: problemResponse },
      },
    },
    async (request, reply) => {
      const held = await reachedRequest(app.db, request.user, request.params.number);
      const row = await attachmentOn(app.db, held.id, request.params.attachmentId);
      if (!row) throw httpError(404, NO_ATTACHMENT);
      return sendAttachment(reply, await app.storage.get(row.fileRef), row.filename);
    },
  );

  /**
   * One Request by its reference, with everything the envelope states
   * joined onto it, or the one refusal.
   *
   * There is no per-row scope to defend — Member+ read every Request
   * (INT-006) — so the only miss is a reference nobody has, or one that
   * has been archived. The contract join is the one that carries a
   * rule: it is taken under this viewer's own reach, so a record they
   * may not see contributes no row and the left join answers NULL.
   * That is the whole of the DD-014 omission — there is no branch after
   * the read that decides whether to keep the number.
   */
  async function reachedRequest(db: Executor, user: AuthenticatedUser, number: number) {
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
          // envelope carries no link and the Request still carries
          // itself (DD-014, CTR-021).
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
};
