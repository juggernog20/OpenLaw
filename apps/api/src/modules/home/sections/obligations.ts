// SPDX-License-Identifier: AGPL-3.0-only

/** M29's Entity obligations section contract. */
import { z } from "zod";
import {
  and,
  asc,
  entities,
  entityGrants,
  entityObligations,
  eq,
  isNull,
  or,
  sql,
  users,
  type Executor,
} from "@openlaw/db";
import type { AuthenticatedUser } from "../../../auth/user.js";
import { entityReachScope } from "../../../lib/entity-access.js";
import { localMoment } from "../../../lib/notifications/local-day.js";
import { HOME_SECTION_LIMIT } from "./approvals.js";

export const ObligationHomeRowSchema = z.object({
  id: z.string(),
  label: z.string(),
  dueDate: z.iso.date(),
  isOverdue: z.boolean(),
  isUnassigned: z.boolean(),
  entity: z.object({ id: z.string(), legalName: z.string() }),
});

export const ObligationsHomeSectionSchema = z.object({
  type: z.literal("obligations"),
  total: z.number().int().positive(),
  rows: z.array(ObligationHomeRowSchema).max(HOME_SECTION_LIMIT),
});

export type ObligationsHomeSection = z.infer<typeof ObligationsHomeSectionSchema>;

/**
 * The viewer's open Entity Obligations, with the Administrator fallback.
 *
 * The calendar's open-state, reach, and overdue ordering are composed
 * before the window total and cap. Administrators additionally carry
 * unassigned rows and rows whose named assignee cannot reach the Entity,
 * matching ENT-006's morning-round audience fallback.
 */
export async function readObligationsHomeSection(
  db: Executor,
  user: AuthenticatedUser,
  now = new Date(),
): Promise<ObligationsHomeSection | null> {
  if (user.role === "contributor" || user.role === "business_user") return null;

  const today = localMoment(now, user.timezone).date;
  const isOverdue = sql<boolean>`${entityObligations.nextDueOn} < ${today}`;
  const assigneeCanReachEntity = sql<boolean>`exists (
    select 1
    from ${users}
    left join ${entityGrants}
      on ${entityGrants.entityId} = ${entities.id}
      and ${entityGrants.userId} = ${users.id}
    where ${users.id} = ${entityObligations.assigneeId}
      and ${users.archivedAt} is null
      and (
        ${users.role} = 'administrator'
        or (
          ${users.role} = 'legal_team_member'
          and (
            ${entities.isConfidential} = false
            or ${entityGrants.userId} is not null
          )
        )
      )
  )`;
  const rows = await db
    .select({
      id: entityObligations.id,
      label: entityObligations.label,
      dueDate: entityObligations.nextDueOn,
      assigneeId: entityObligations.assigneeId,
      entityId: entities.id,
      entityLegalName: entities.legalName,
      isOverdue,
      total: sql<number>`count(*) over()::integer`,
    })
    .from(entityObligations)
    .innerJoin(entities, eq(entityObligations.entityId, entities.id))
    .where(
      and(
        isNull(entityObligations.completedOn),
        isNull(entities.archivedAt),
        entityReachScope(db, user),
        user.role === "administrator"
          ? or(
              eq(entityObligations.assigneeId, user.id),
              isNull(entityObligations.assigneeId),
              sql`not ${assigneeCanReachEntity}`,
            )
          : eq(entityObligations.assigneeId, user.id),
      ),
    )
    .orderBy(sql`${isOverdue} desc`, asc(entityObligations.nextDueOn), asc(entityObligations.id))
    .limit(HOME_SECTION_LIMIT);

  const first = rows[0];
  if (!first) return null;
  return {
    type: "obligations",
    total: first.total,
    rows: rows.map((row) => ({
      id: row.id,
      label: row.label,
      dueDate: row.dueDate,
      isOverdue: row.isOverdue,
      isUnassigned: row.assigneeId === null,
      entity: { id: row.entityId, legalName: row.entityLegalName },
    })),
  };
}
