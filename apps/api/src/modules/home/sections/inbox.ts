// SPDX-License-Identifier: AGPL-3.0-only

/** M29's Member+ Inbox pressure section contract. */
import { z } from "zod";
import {
  and,
  asc,
  desc,
  eq,
  isNull,
  requestTypes,
  requests,
  SEVERITY_LEVELS,
  sql,
  users,
  type Executor,
} from "@openlaw/db";
import type { AuthenticatedUser } from "../../../auth/user.js";
import { requestUrgencyRank } from "../../requests/urgency-order.js";
import { HOME_SECTION_LIMIT } from "./approvals.js";

export const InboxHomeRowSchema = z.object({
  id: z.string(),
  number: z.number().int().positive(),
  summary: z.string(),
  urgency: z.enum(SEVERITY_LEVELS),
  requestType: z.object({ id: z.string(), displayName: z.string() }),
  requester: z.object({ id: z.string(), displayName: z.string() }),
  createdAt: z.iso.datetime(),
});

export const InboxHomeSectionSchema = z.object({
  type: z.literal("inbox"),
  total: z.number().int().positive(),
  rows: z.array(InboxHomeRowSchema).max(HOME_SECTION_LIMIT),
});

export type InboxHomeSection = z.infer<typeof InboxHomeSectionSchema>;

/** Open Requests in the Inbox's own urgency-rank, age, reference order. */
export async function readInboxHomeSection(
  db: Executor,
  user: AuthenticatedUser,
): Promise<InboxHomeSection | null> {
  if (user.role !== "administrator" && user.role !== "legal_team_member") return null;

  const urgencyRank = requestUrgencyRank(requests.urgency);
  const rows = await db
    .select({
      id: requests.id,
      number: requests.number,
      summary: requests.summary,
      urgency: requests.urgency,
      requestTypeId: requestTypes.id,
      requestTypeDisplayName: requestTypes.displayName,
      requesterId: users.id,
      requesterDisplayName: users.displayName,
      createdAt: requests.createdAt,
      total: sql<number>`count(*) over()::integer`,
    })
    .from(requests)
    .innerJoin(requestTypes, eq(requests.requestTypeId, requestTypes.id))
    .innerJoin(users, eq(requests.requesterId, users.id))
    .where(and(isNull(requests.archivedAt), eq(requests.status, "new")))
    .orderBy(desc(urgencyRank), asc(requests.createdAt), asc(requests.number))
    .limit(HOME_SECTION_LIMIT);

  const first = rows[0];
  if (!first) return null;
  return {
    type: "inbox",
    total: first.total,
    rows: rows.map((row) => ({
      id: row.id,
      number: row.number,
      summary: row.summary,
      urgency: row.urgency,
      requestType: { id: row.requestTypeId, displayName: row.requestTypeDisplayName },
      requester: { id: row.requesterId, displayName: row.requesterDisplayName },
      createdAt: row.createdAt.toISOString(),
    })),
  };
}
