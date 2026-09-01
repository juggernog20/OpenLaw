// SPDX-License-Identifier: AGPL-3.0-only

/** DES-069's Matter portfolio, keyed on the viewer as MTR-003 Matter Manager. */
import { z } from "zod";
import {
  and,
  desc,
  eq,
  isNull,
  matters,
  matterKeyDates,
  matterStatuses,
  sql,
  type Executor,
} from "@openlaw/db";
import type { AuthenticatedUser } from "../../../auth/user.js";
import { matterTeamScope } from "../../../lib/matter-access.js";
import { HOME_SECTION_LIMIT } from "./approvals.js";

export const MatterHomeRowSchema = z.object({
  id: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
  isConfidential: z.boolean(),
  status: z.object({ id: z.string(), displayName: z.string() }),
  nextDeadline: z.object({ date: z.iso.date(), label: z.string() }).nullable(),
});

export const MattersHomeSectionSchema = z.object({
  type: z.literal("matters"),
  total: z.number().int().positive(),
  rows: z.array(MatterHomeRowSchema).max(HOME_SECTION_LIMIT),
});

export type MattersHomeSection = z.infer<typeof MattersHomeSectionSchema>;

/** Open, live Matters managed by this viewer, nearest deadline first. */
export async function readMattersHomeSection(
  db: Executor,
  user: AuthenticatedUser,
): Promise<MattersHomeSection | null> {
  const nextDeadline = db
    .select({ date: matterKeyDates.date, label: matterKeyDates.label })
    .from(matterKeyDates)
    .where(
      and(eq(matterKeyDates.matterId, matters.id), sql`${matterKeyDates.date} >= current_date`),
    )
    .orderBy(matterKeyDates.date, matterKeyDates.id)
    .limit(1)
    .as("home_matter_next_deadline");

  const rows = await db
    .select({
      id: matters.id,
      number: matters.number,
      title: matters.title,
      isConfidential: matters.isConfidential,
      statusId: matterStatuses.id,
      statusDisplayName: matterStatuses.displayName,
      nextDeadlineDate: nextDeadline.date,
      nextDeadlineLabel: nextDeadline.label,
      total: sql<number>`count(*) over()::integer`,
    })
    .from(matters)
    .innerJoin(matterStatuses, eq(matters.statusId, matterStatuses.id))
    .leftJoinLateral(nextDeadline, sql`true`)
    .where(
      and(
        eq(matters.managerId, user.id),
        eq(matterStatuses.category, "open"),
        isNull(matters.archivedAt),
        matterTeamScope(db, user),
      ),
    )
    .orderBy(sql`${nextDeadline.date} asc nulls last`, desc(matters.number))
    .limit(HOME_SECTION_LIMIT);

  const first = rows[0];
  if (!first) return null;
  return {
    type: "matters",
    total: first.total,
    rows: rows.map((row) => ({
      id: row.id,
      number: row.number,
      title: row.title,
      isConfidential: row.isConfidential,
      status: { id: row.statusId, displayName: row.statusDisplayName },
      nextDeadline:
        row.nextDeadlineDate === null || row.nextDeadlineLabel === null
          ? null
          : { date: row.nextDeadlineDate, label: row.nextDeadlineLabel },
    })),
  };
}
