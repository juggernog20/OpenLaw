// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Inbox (INT-006, INT-007, #413): the staff read of the Requests
 * whose fate is undecided.
 *
 * **A staff address in the Request's own module.** The portal mount
 * answers a requester their own asks; this answers triage the whole
 * queue. Same rows, two projections, two gates — the M20/5 rule, which
 * is what keeps either route from meaning two things. The submission
 * route sits at this same address under `POST`, because a write of the
 * record does not differ by audience and a read does.
 *
 * The default answer includes New and Read Requests. Explicit status choices or
 * includeTriaged widen it; quick filters combine across the whole Inbox.
 *
 * **Default order: urgency rank, then age** (INT-006). Critical first, and inside one
 * urgency the oldest first, so the hottest and the longest-waiting ask
 * surface together at the top. Urgency is `NOT NULL` on the table, so
 * the ordering has no unknown group to file last — every Request
 * claims a level, because every form collects one. A column sort replaces
 * this order and uses the reference to break ties.
 *
 * **Paged by the house keyset pattern** (CTR-024's rule, this list's
 * ordering). The cursor is a Request id, and the boundary reads that
 * Request's own position out of the table rather than taking a
 * position off the wire. There is no per-row scope to defend here —
 * Member+ read every Request — so the boundary needs no scope of its
 * own; what it needs is the reference as its last term, which is
 * unique and monotonic and therefore breaks every tie the urgency and
 * the age leave.
 *
 * **A converted row carries the record it became, or carries nothing.**
 * The link is drawn from a join taken under the viewer's own contract
 * reach (DD-014, CTR-021): a confidential contract this Member+ is not
 * on resolves to no row, and the answer says `null` rather than
 * refusing the Request. The withholding is the server's decision, in
 * the CTR-018 posture — the client is never handed a reference it must
 * decide not to render. The Request itself stays in the list either
 * way: it is still triage's business, and an absence in the queue would
 * be the existence leak DD-014 exists to close.
 *
 * Converted-record resolution lives in `projection.ts`, where one
 * module-aware reference supplies this read and the staff detail. A
 * second record module extends that resolver rather than adding another
 * join here.
 */

import {
  asc,
  eq,
  isNull,
  REQUEST_STATUSES,
  requests,
  requestTypes,
  SEVERITY_LEVELS,
  users,
} from "@openlaw/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireRole } from "../../auth/guards.js";
import { problemResponse } from "../../lib/problem.js";
import { listRequests, RequestListQuery } from "./list.js";
import {
  ConvertedContractSchema,
  ConvertedRecordSchema,
  RequestAssigneeSchema,
  StaffRequestTypeSchema,
} from "./projection.js";

/** INT-006: Member+ triages, and there are no routing rules to narrow
 * that further. A Contributor and a Business User are refused rather
 * than answered an empty queue — the Inbox is not theirs to read. */
const requireMember = requireRole("administrator", "legal_team_member");

/** Who asked. A name and an id: the Inbox states the person, and the
 * staff detail is where anything more about them belongs. */
const InboxRequesterSchema = z.object({ id: z.string(), displayName: z.string() });

/**
 * One row of the Inbox — I1's columns, as INT-007 revised them.
 *
 * The triage assignee is separate from the status: assigning a person
 * leaves the Request open until it is converted or resolved.
 *
 * The age is the stamp rather than a duration: how "3 days ago" reads
 * is the reader's locale's business, and a server that computed it
 * would have to guess the reader's clock.
 */
export const InboxRowSchema = z.object({
  id: z.string(),
  /** INT-002's global reference; the Inbox renders it R-###. */
  number: z.number().int(),
  status: z.enum(REQUEST_STATUSES),
  title: z.string(),
  /** DES-018's severity ramp, as the requester claimed it. */
  urgency: z.enum(SEVERITY_LEVELS),
  /** The target rides on the row because triage reads it before
   * opening anything. A module with no type name is the module-only
   * state — either it was never given a type, or the type it named was
   * hard-deleted and the FK demoted the row rather than stranding it. */
  requestType: StaffRequestTypeSchema,
  requester: InboxRequesterSchema,
  assignee: RequestAssigneeSchema.nullable(),
  createdAt: z.string(),
  /** The record a conversion made, when this viewer reaches it, and
   * `null` in every other case — never converted, converted into a
   * record they may not see, or converted into another module. */
  convertedContract: ConvertedContractSchema.nullable(),
  convertedRecord: ConvertedRecordSchema.nullable(),
});

export const requestInboxRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/requests",
    {
      preHandler: requireMember,
      schema: {
        operationId: "listInbox",
        summary:
          "The Inbox (INT-006, INT-007): the Requests whose fate is " +
          "undecided, ordered by urgency rank — critical first — then " +
          "age, oldest first, unless sort names a column, and paged by cursor. The answer is " +
          "the `new` and `read` Requests by default; status choices or includeTriaged=true widen it " +
          "to the converted, resolved, and declined ones with their " +
          "outcomes. A converted row carries the contract or matter it became " +
          "only when the caller reaches that record, and carries " +
          "null otherwise (DD-014). Member+ only: a Contributor and a " +
          "Business User are refused",
        tags: ["requests"],
        querystring: RequestListQuery,
        response: {
          200: z.object({
            requests: z.array(InboxRowSchema),
            total: z.int(),
            /** Pass back as `cursor` for the next page. NULL when this
             * page is the end of the queue. */
            nextCursor: z.string().nullable(),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      return listRequests(app.db, request.user, request.query);
    },
  );

  app.get(
    "/requests/filter-options",
    {
      preHandler: requireMember,
      schema: {
        operationId: "inboxFilterOptions",
        summary: "Request types and requesters across the live Inbox, including triaged requests",
        tags: ["requests"],
        response: {
          200: z.object({
            types: z.array(z.object({ id: z.string(), displayName: z.string() })),
            people: z.array(InboxRequesterSchema),
          }),
          default: problemResponse,
        },
      },
    },
    async () => {
      const [types, people] = await Promise.all([
        app.db
          .selectDistinct({ id: requestTypes.id, displayName: requestTypes.displayName })
          .from(requests)
          .innerJoin(requestTypes, eq(requests.requestTypeId, requestTypes.id))
          .where(isNull(requests.archivedAt))
          .orderBy(asc(requestTypes.displayName), asc(requestTypes.id)),
        app.db
          .selectDistinct({ id: users.id, displayName: users.displayName })
          .from(requests)
          .innerJoin(users, eq(requests.requesterId, users.id))
          .where(isNull(requests.archivedAt))
          .orderBy(asc(users.displayName), asc(users.id)),
      ]);
      return { types, people };
    },
  );
};
