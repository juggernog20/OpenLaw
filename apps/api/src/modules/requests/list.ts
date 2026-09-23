// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Staff Inbox listing (INT-006, INT-007). Filters and cursors apply before
 * paging; converted record references use the caller's reach (DD-014).
 */

import type { Db } from "@openlaw/db";
import {
  and,
  asc,
  contractTypes,
  desc,
  eq,
  inArray,
  isNull,
  matterTypes,
  REQUEST_STATUSES,
  requests,
  requestTypes,
  SEVERITY_LEVELS,
  sql,
  users,
  type AnyPgColumn,
  type SQL,
} from "@openlaw/db";
import {
  INBOX_SORT_KEYS,
  SORT_DIRECTIONS,
  type InboxSortKey,
  type SortDirection,
} from "@openlaw/shared";
import { z } from "zod";
import { NO_PERMISSION, type AuthenticatedUser } from "../../auth/guards.js";
import { httpError } from "../../lib/problem.js";
import {
  choiceFilter,
  dateFilter,
  FilterChoices,
  validDateRanges,
} from "../../lib/record-filters.js";
import { TimezoneSchema } from "../../lib/timezones.js";
import { REQUIRE_TRIAGER } from "./disposition.js";
import {
  liveTargetContractType,
  liveTargetMatterType,
  requestAssignees,
  RequestAssigneeSchema,
  requestAssigneeSelection,
  selectConvertedRecords,
  toStaffRequestType,
} from "./projection.js";
import {
  convertedContractOf,
  convertedRecordOf,
  type ConversionRecordReference,
} from "./record-reference.js";
import { requestUrgencyRank } from "./urgency-order.js";
/** The Inbox is a triager's read (INT-006): the same roles `disposition.ts` and
 * `assignRequest` require, read from one list so the three cannot drift. */
function assertMember(user: AuthenticatedUser): void {
  if (!REQUIRE_TRIAGER.some((role) => role === user.role)) throw httpError(403, NO_PERMISSION);
}
const PAGE_SIZE = 50;
const CursorSchema = z.string().min(1).max(64);
export const RequestListQuery = z
  .object({
    status: FilterChoices.optional(),
    type: FilterChoices.optional(),
    urgency: FilterChoices.optional(),
    requester: FilterChoices.optional(),
    receivedFrom: z.iso.date().optional(),
    receivedTo: z.iso.date().optional(),
    timeZone: TimezoneSchema.optional(),
    sort: z.enum(INBOX_SORT_KEYS).optional(),
    dir: z.enum(SORT_DIRECTIONS).optional(),
    /** INT-007's toggle. Omitted is the Inbox itself. */
    includeTriaged: z.enum(["true", "false"]).optional(),
    /** The previous page's `nextCursor`. Omit for the first page. */
    cursor: CursorSchema.optional(),
  })
  .refine(validDateRanges, "The end date must not precede the start date.");
export async function listRequests(
  db: Db,
  user: AuthenticatedUser,
  input: z.input<typeof RequestListQuery> = {},
) {
  assertMember(user);
  const query = RequestListQuery.parse(input);
  const sort = query.sort ? { key: query.sort, dir: query.dir ?? "asc" } : null;
  const scope = and(
    isNull(requests.archivedAt),
    query.status
      ? choiceFilter(requests.status, query.status)
      : query.includeTriaged === "true"
        ? undefined
        : inArray(requests.status, ["new", "read"]),
    choiceFilter(requests.requestTypeId, query.type),
    choiceFilter(requests.urgency, query.urgency),
    choiceFilter(requests.requesterId, query.requester, user.id),
    dateFilter(
      sql`(${requests.createdAt} at time zone ${query.timeZone ?? user.timezone ?? "UTC"})::date`,
      query.receivedFrom,
      query.receivedTo,
    ),
  );
  const [count] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(requests)
    .where(scope);
  const rows = await selectInbox(db)
    .where(and(scope, query.cursor === undefined ? undefined : furtherDownThan(query.cursor, sort)))
    .orderBy(...listOrder(sort))
    // One past the page, which is how the answer knows whether
    // there is another page.
    .limit(PAGE_SIZE + 1);
  const page = rows.slice(0, PAGE_SIZE);
  const convertedRecords = await selectConvertedRecords(
    db,
    user,
    page.map((row) => row.id),
  );
  return {
    total: count?.total ?? 0,
    requests: page.map((row) => toRow(row, convertedRecords.get(row.id) ?? null)),
    // Only when a further row was actually read. A cursor on the
    // last page would send the client for an empty one.
    nextCursor: rows.length > PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
  };
}
/**
 * The queue's read, with everything a row states joined onto it.
 *
 * Converted records are resolved for the finished page through the
 * shared projection helper under this viewer's own reach. A record
 * they may not see contributes no reference; that is the whole of the
 * DD-014 omission, with no branch here deciding whether to keep its
 * number.
 */
function selectInbox(db: Db) {
  return db
    .select({
      id: requests.id,
      number: requests.number,
      status: requests.status,
      title: requests.title,
      urgency: requests.urgency,
      createdAt: requests.createdAt,
      typeId: requestTypes.id,
      typeDisplayName: requestTypes.displayName,
      targetModule: requestTypes.targetModule,
      targetContractTypeId: contractTypes.id,
      targetContractTypeName: contractTypes.displayName,
      targetMatterTypeId: matterTypes.id,
      targetMatterTypeName: matterTypes.displayName,
      assignee: requestAssigneeSelection,
      requesterId: users.id,
      requesterDisplayName: users.displayName,
    })
    .from(requests)
    .innerJoin(requestTypes, eq(requests.requestTypeId, requestTypes.id))
    .innerJoin(users, eq(requests.requesterId, users.id))
    .leftJoin(requestAssignees, eq(requests.assigneeId, requestAssignees.id))
    .leftJoin(contractTypes, liveTargetContractType())
    .leftJoin(matterTypes, liveTargetMatterType());
}
/** The one ordering expression, shared by the page and its boundary —
 * a keyset cursor over an ordering the boundary reproduces only
 * approximately is one that skips and repeats rows. */
const urgencyRank = requestUrgencyRank(requests.urgency);

type SortRequest = { key: InboxSortKey; dir: SortDirection };

const SORTS: Record<InboxSortKey, SQL> = {
  number: sql`${requests.number}`,
  title: sql`lower(${requests.title})`,
  type: sql`lower(${requestTypes.displayName})`,
  requester: sql`lower(${users.displayName})`,
  urgency: urgencyRank,
  createdAt: sql`${requests.createdAt}`,
  status: sql`case ${requests.status} ${sql.join(
    REQUEST_STATUSES.map((status, index) => sql`when ${status} then ${sql.raw(String(index))}`),
    sql` `,
  )} end`,
};

function listOrder(sort: SortRequest | null): SQL[] {
  if (!sort) return [desc(urgencyRank), asc(requests.createdAt), asc(requests.number)];
  return [sort.dir === "asc" ? asc(SORTS[sort.key]) : desc(SORTS[sort.key]), asc(requests.number)];
}

/**
 * The keyset boundary: every Request strictly further down the queue
 * than one of them, in the order the queue reads.
 *
 * The default position is a **triple** — urgency rank, then the stamp, then the
 * reference — so "further down" is three ways of being after the
 * boundary row: a lower rank, the same rank and a later stamp, or both
 * the same and a higher reference. The reference is unique and
 * monotonic, so the last term breaks every tie the first two leave.
 * A selected column instead compares its value, then the reference.
 *
 * The boundary's own position is read from the table rather than taken
 * from the client, so nobody can page from a reference that was never
 * written and no ordering value ever rides a URL. A cursor naming a
 * Request that is gone resolves to NULL, every comparison answers
 * nothing, and the caller gets an empty page.
 */
function furtherDownThan(cursor: string, sort: SortRequest | null): SQL {
  const at = (column: SQL | AnyPgColumn) => sql`(
    select ${column} from ${requests} where ${eq(requests.id, cursor)}
  )`;
  const rank = at(urgencyRank);
  const createdAt = at(requests.createdAt);
  const number = at(requests.number);
  if (sort) {
    const expr = SORTS[sort.key];
    const value = sql`(
      select ${expr} from ${requests}
      inner join ${requestTypes} on ${eq(requests.requestTypeId, requestTypes.id)}
      inner join ${users} on ${eq(requests.requesterId, users.id)}
      where ${eq(requests.id, cursor)}
    )`;
    const later = sql.raw(sort.dir === "asc" ? ">" : "<");
    return sql`(${expr} ${later} ${value} or (${expr} = ${value} and ${requests.number} > ${number}))`;
  }
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
function toRow(
  row: {
    id: string;
    number: number;
    status: (typeof REQUEST_STATUSES)[number];
    title: string;
    urgency: (typeof SEVERITY_LEVELS)[number];
    createdAt: Date;
    typeId: string;
    typeDisplayName: string;
    targetModule: string | null;
    targetContractTypeId: string | null;
    targetContractTypeName: string | null;
    targetMatterTypeId: string | null;
    targetMatterTypeName: string | null;
    assignee: z.infer<typeof RequestAssigneeSchema> | null;
    requesterId: string;
    requesterDisplayName: string;
  },
  convertedRecord: ConversionRecordReference | null,
) {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    assignee: row.assignee,
    title: row.title,
    urgency: row.urgency,
    requestType: toStaffRequestType(row),
    requester: { id: row.requesterId, displayName: row.requesterDisplayName },
    createdAt: row.createdAt.toISOString(),
    convertedContract: convertedContractOf(convertedRecord),
    convertedRecord: convertedRecordOf(convertedRecord),
  };
}
