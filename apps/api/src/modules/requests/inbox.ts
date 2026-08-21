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
 * **The default answer is exactly the `new` Requests** (INT-007). That
 * is not a filter with a default; it is what the Inbox *is* — the
 * queue reads truthfully as "requests whose fate is undecided", and a
 * triaged Request has left it. `includeTriaged=true` widens the answer
 * to the other three arms so yesterday's decisions stay findable, which
 * is the toggle INT-007 asks for and the only control this list has.
 *
 * **Urgency rank, then age** (INT-006). Critical first, and inside one
 * urgency the oldest first, so the hottest and the longest-waiting ask
 * surface together at the top. Urgency is `NOT NULL` on the table, so
 * the ordering has no unknown group to file last — every Request
 * claims a level, because every form collects one.
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
 * The matter arm of the trail is not here. `matters` lands in M22 and
 * `converted_matter_id` carries no foreign key yet, so there is no row
 * to join and nothing honest to answer; the column gains its arm with
 * the table it points at.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  asc,
  contracts,
  contractTypes,
  desc,
  eq,
  isNull,
  matterTypes,
  REQUEST_STATUSES,
  requestTypes,
  requests,
  SEVERITY_LEVELS,
  sql,
  users,
  type AnyPgColumn,
  type SQL,
} from "@openlaw/db";
import { requireRole, type AuthenticatedUser } from "../../auth/guards.js";
import { contractTeamScope } from "../../lib/contract-access.js";
import { problemResponse } from "../../lib/problem.js";
import { StaffRequestTypeSchema, targetModuleOf } from "./projection.js";

/** INT-006: Member+ triages, and there are no routing rules to narrow
 * that further. A Contributor and a Business User are refused rather
 * than answered an empty queue — the Inbox is not theirs to read. */
const requireMember = requireRole("administrator", "legal_team_member");

/**
 * How many Requests one page carries.
 *
 * The contract list's number, for the contract list's reason: it is the
 * house page for an org-wide table whose row count is a fact about the
 * whole instance rather than about one person.
 */
const PAGE_SIZE = 50;

/** A cursor is a Request id, and nothing longer is worth reading. */
const CursorSchema = z.string().min(1).max(64);

/** Who asked. A name and an id: the Inbox states the person, and the
 * staff detail is where anything more about them belongs. */
const InboxRequesterSchema = z.object({ id: z.string(), displayName: z.string() });

/**
 * One row of the Inbox — I1's columns, as INT-007 revised them.
 *
 * No Assignee, because there is no assignment: acting on a Request
 * means choosing its outcome then and there. `status` rides on every
 * row all the same, because the triaged view draws the outcome and a
 * projection that carried it only sometimes would be two shapes.
 *
 * The age is the stamp rather than a duration: how "3 days ago" reads
 * is the reader's locale's business, and a server that computed it
 * would have to guess the reader's clock.
 */
const InboxRowSchema = z.object({
  id: z.string(),
  /** INT-002's global reference; the Inbox renders it R-###. */
  number: z.number().int(),
  status: z.enum(REQUEST_STATUSES),
  summary: z.string(),
  /** DES-018's severity ramp, as the requester claimed it. */
  urgency: z.enum(SEVERITY_LEVELS),
  /** The target rides on the row because triage reads it before
   * opening anything. A module with no type name is the module-only
   * state — either it was never given a type, or the type it named was
   * hard-deleted and the FK demoted the row rather than stranding it. */
  requestType: StaffRequestTypeSchema,
  requester: InboxRequesterSchema,
  createdAt: z.string(),
  /** The record a conversion made, when this viewer reaches it, and
   * `null` in every other case — never converted, converted into a
   * record they may not see, or converted into a Matter (M22). */
  convertedContract: z.object({ number: z.number().int() }).nullable(),
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
          "age, oldest first, and paged by cursor. The answer is " +
          "exactly the `new` Requests; includeTriaged=true widens it " +
          "to the converted, resolved, and declined ones with their " +
          "outcomes. A converted row carries the contract it became " +
          "only when the caller reaches that contract, and carries " +
          "null otherwise (DD-014). Member+ only: a Contributor and a " +
          "Business User are refused",
        tags: ["requests"],
        querystring: z.object({
          /** INT-007's toggle. Omitted is the Inbox itself. */
          includeTriaged: z.enum(["true", "false"]).optional(),
          /** The previous page's `nextCursor`. Omit for the first page. */
          cursor: CursorSchema.optional(),
        }),
        response: {
          200: z.object({
            requests: z.array(InboxRowSchema),
            /** Pass back as `cursor` for the next page. NULL when this
             * page is the end of the queue. */
            nextCursor: z.string().nullable(),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const rows = await selectInbox(request.user)
        .where(
          and(
            // The house rule that NULL means live. Nothing archives a
            // Request yet, and a rule stated now is one the first
            // archiver inherits.
            isNull(requests.archivedAt),
            request.query.includeTriaged === "true" ? undefined : eq(requests.status, "new"),
            request.query.cursor === undefined ? undefined : furtherDownThan(request.query.cursor),
          ),
        )
        .orderBy(desc(urgencyRank), asc(requests.createdAt), asc(requests.number))
        // One past the page, which is how the answer knows whether
        // there is more without counting anything.
        .limit(PAGE_SIZE + 1);
      const page = rows.slice(0, PAGE_SIZE);
      return {
        requests: page.map(toRow),
        // Only when a further row was actually read. A cursor on the
        // last page would send the client for an empty one.
        nextCursor: rows.length > PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
      };
    },
  );

  /**
   * The queue's read, with everything a row states joined onto it.
   *
   * The contract join is the one that carries a rule: it is taken under
   * this viewer's own reach, so a record they may not see contributes
   * no row and the left join answers NULL. That is the whole of the
   * DD-014 omission — there is no branch after the read that decides
   * whether to keep the number.
   */
  function selectInbox(user: AuthenticatedUser) {
    return app.db
      .select({
        id: requests.id,
        number: requests.number,
        status: requests.status,
        summary: requests.summary,
        urgency: requests.urgency,
        createdAt: requests.createdAt,
        typeId: requestTypes.id,
        typeDisplayName: requestTypes.displayName,
        targetModule: requestTypes.targetModule,
        targetContractTypeName: contractTypes.displayName,
        targetMatterTypeName: matterTypes.displayName,
        requesterId: users.id,
        requesterDisplayName: users.displayName,
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
          // A contract this viewer cannot reach joins to nothing, so
          // the row carries no link and the Request still carries
          // itself (DD-014, CTR-021).
          contractTeamScope(app.db, user),
          // An archived contract is no trail either: the link would
          // open on a record the Contracts destination hides.
          isNull(contracts.archivedAt),
        ),
      );
  }
};

/**
 * DES-018's severity ramp as a number the database can order.
 *
 * `urgency` holds a slug, and ordering slugs sorts them critical, high,
 * low, medium — an alphabet, not a ramp. The `case` restates the
 * sequence DES-018 already fixed, built from `SEVERITY_LEVELS` rather
 * than written out, so a level added to the ramp cannot be left out of
 * the ordering. Descending on this expression is "critical first".
 */
function severityRank(column: AnyPgColumn): SQL {
  const arms = SEVERITY_LEVELS.map(
    (level, index) => sql`when ${level} then ${sql.raw(String(index + 1))}`,
  );
  return sql`case ${column} ${sql.join(arms, sql` `)} end`;
}

/** The one ordering expression, shared by the page and its boundary —
 * a keyset cursor over an ordering the boundary reproduces only
 * approximately is one that skips and repeats rows. */
const urgencyRank = severityRank(requests.urgency);

/**
 * The keyset boundary: every Request strictly further down the queue
 * than one of them, in the order the queue reads.
 *
 * The position is a **triple** — urgency rank, then the stamp, then the
 * reference — so "further down" is three ways of being after the
 * boundary row: a lower rank, the same rank and a later stamp, or both
 * the same and a higher reference. The reference is unique and
 * monotonic, so the last term breaks every tie the first two leave.
 *
 * The boundary's own position is read from the table rather than taken
 * from the client, so nobody can page from a reference that was never
 * written and no ordering value ever rides a URL. A cursor naming a
 * Request that is gone resolves to NULL, every comparison answers
 * nothing, and the caller gets an empty page.
 */
function furtherDownThan(cursor: string): SQL {
  const at = (column: SQL | AnyPgColumn) => sql`(
    select ${column} from ${requests} where ${eq(requests.id, cursor)}
  )`;
  const rank = at(urgencyRank);
  const createdAt = at(requests.createdAt);
  const number = at(requests.number);
  return sql`(
    ${urgencyRank} < ${rank}
    or (${urgencyRank} = ${rank} and ${requests.createdAt} > ${createdAt})
    or (
      ${urgencyRank} = ${rank}
      and ${requests.createdAt} = ${createdAt}
      and ${requests.number} > ${number}
    )
  )`;
}

/** The joined row, reshaped into the answer's nested shape. */
function toRow(row: {
  id: string;
  number: number;
  status: (typeof REQUEST_STATUSES)[number];
  summary: string;
  urgency: (typeof SEVERITY_LEVELS)[number];
  createdAt: Date;
  typeId: string;
  typeDisplayName: string;
  targetModule: string | null;
  targetContractTypeName: string | null;
  targetMatterTypeName: string | null;
  requesterId: string;
  requesterDisplayName: string;
  convertedContractNumber: number | null;
}) {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    summary: row.summary,
    urgency: row.urgency,
    requestType: {
      id: row.typeId,
      displayName: row.typeDisplayName,
      targetModule: targetModuleOf(row.targetModule),
      // Whichever taxonomy the module points at, and null for the
      // module-only and no-target states alike.
      targetTypeName: row.targetContractTypeName ?? row.targetMatterTypeName,
    },
    requester: { id: row.requesterId, displayName: row.requesterDisplayName },
    createdAt: row.createdAt.toISOString(),
    convertedContract:
      row.convertedContractNumber === null ? null : { number: row.convertedContractNumber },
  };
}
