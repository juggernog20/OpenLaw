// SPDX-License-Identifier: AGPL-3.0-only

/** M29's merged Contract and Matter Tasks section contract. */
import { z } from "zod";
import {
  and,
  contractStatuses,
  contracts,
  contractTasks,
  eq,
  isNull,
  lte,
  matters,
  matterStatuses,
  matterTasks,
  ne,
  sql,
  type Executor,
} from "@openlaw/db";
import type { AuthenticatedUser } from "../../../auth/user.js";
import { contractTeamScope } from "../../../lib/contract-access.js";
import { matterTeamScope } from "../../../lib/matter-access.js";
import { HOME_SECTION_LIMIT } from "./approvals.js";

export const TaskHomeRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  dueDate: z.iso.date().nullable(),
  isOverdue: z.boolean(),
  record: z.object({
    kind: z.enum(["contract", "matter"]),
    id: z.string(),
    number: z.number().int().positive(),
    title: z.string(),
    isConfidential: z.boolean(),
  }),
});

export const TasksHomeSectionSchema = z.object({
  type: z.literal("tasks"),
  total: z.number().int().positive(),
  rows: z.array(TaskHomeRowSchema).max(HOME_SECTION_LIMIT),
});

export type TasksHomeSection = z.infer<typeof TasksHomeSectionSchema>;

export const AssignedTasksCursorSchema = z.string().refine((value) => {
  const parts = value.split(":");
  return z
    .tuple([
      z.union([z.iso.date(), z.literal("undated")]),
      z.enum(["contract", "matter"]),
      z.uuid(),
    ])
    .safeParse(parts).success;
}, "Invalid Tasks cursor");

export const AssignedTasksPageSchema = z.object({
  total: z.number().int().nonnegative(),
  rows: z.array(TaskHomeRowSchema),
  nextCursor: z.string().nullable(),
});

interface TaskDbRow extends Record<string, unknown> {
  id: string;
  title: string;
  due_date: string | null;
  is_overdue: boolean;
  record_kind: "contract" | "matter";
  record_id: string;
  record_number: number;
  record_title: string;
  record_is_confidential: boolean;
  total: number;
}

/**
 * Every unfinished Task assigned to the viewer across both workspaces.
 *
 * Each arm applies the owning record's ordinary reach and lifecycle
 * predicates before the union. The total and cap therefore see
 * only reachable work: a walled record leaves no row, count, or gap.
 * Civil due dates sort overdue first, then forward, with NULL last.
 */
export async function readTasksHomeSection(
  db: Executor,
  user: AuthenticatedUser,
  /**
   * The latest due date to answer. When present it is also the overdue
   * baseline, and undated Tasks fall out because they are not yet due.
   * Without it, Home keeps every open Task and uses `current_date`.
   */
  dueThrough?: string,
): Promise<TasksHomeSection | null> {
  const page = await readAssignedTasks(db, user, { limit: HOME_SECTION_LIMIT, dueThrough });
  return page.total === 0 ? null : { type: "tasks", total: page.total, rows: page.rows };
}

export async function readAssignedTasks(
  db: Executor,
  user: AuthenticatedUser,
  { limit, cursor, dueThrough }: { limit: number; cursor?: string; dueThrough?: string },
): Promise<z.infer<typeof AssignedTasksPageSchema>> {
  const today = dueThrough ? sql`${dueThrough}::date` : sql`current_date`;
  const [cursorDate, cursorKind, cursorId] = cursor?.split(":") ?? [];
  const after = cursor
    ? sql`where (coalesce(due_date, 'infinity'::date), record_kind, id) > (
        coalesce(${cursorDate === "undated" ? null : cursorDate}::date, 'infinity'::date),
        ${cursorKind}::text, ${cursorId}::text
      )`
    : sql``;
  const result = await db.execute<TaskDbRow | { id: null; total: number }>(sql`
    with home_tasks as (
      select
        ${contractTasks.id} as id,
        ${contractTasks.title} as title,
        ${contractTasks.dueDate} as due_date,
        (${contractTasks.dueDate} < ${today}) as is_overdue,
        'contract'::text as record_kind,
        ${contracts.id} as record_id,
        ${contracts.number} as record_number,
        ${contracts.title} as record_title,
        ${contracts.isConfidential} as record_is_confidential
      from ${contractTasks}
      inner join ${contracts} on ${contracts.id} = ${contractTasks.contractId}
      inner join ${contractStatuses} on ${contractStatuses.id} = ${contracts.statusId}
      where ${and(
        eq(contractTasks.assigneeId, user.id),
        eq(contractTasks.isDone, false),
        dueThrough ? lte(contractTasks.dueDate, dueThrough) : undefined,
        isNull(contracts.archivedAt),
        ne(contractStatuses.stage, "ended"),
        contractTeamScope(db, user),
      )}

      union all

      select
        ${matterTasks.id} as id,
        ${matterTasks.title} as title,
        ${matterTasks.dueDate} as due_date,
        (${matterTasks.dueDate} < ${today}) as is_overdue,
        'matter'::text as record_kind,
        ${matters.id} as record_id,
        ${matters.number} as record_number,
        ${matters.title} as record_title,
        ${matters.isConfidential} as record_is_confidential
      from ${matterTasks}
      inner join ${matters} on ${matters.id} = ${matterTasks.matterId}
      inner join ${matterStatuses} on ${matterStatuses.id} = ${matters.statusId}
      where ${and(
        eq(matterTasks.assigneeId, user.id),
        eq(matterTasks.isDone, false),
        dueThrough ? lte(matterTasks.dueDate, dueThrough) : undefined,
        isNull(matters.archivedAt),
        eq(matterStatuses.category, "open"),
        matterTeamScope(db, user),
      )}
    ), page_tasks as (
    select
      id,
      title,
      due_date,
      coalesce(is_overdue, false) as is_overdue,
      record_kind,
      record_id,
      record_number,
      record_title,
      record_is_confidential
    from home_tasks
    ${after}
    order by due_date asc nulls last, record_kind asc, id asc
    limit ${limit + 1}
    )
    select page_tasks.*, totals.total
    from (select count(*)::integer as total from home_tasks) totals
    left join page_tasks on true
    order by page_tasks.due_date asc nulls last, page_tasks.record_kind asc, page_tasks.id asc
  `);

  const pageRows = result.rows.filter((row): row is TaskDbRow => row.id !== null);
  const rows = pageRows.slice(0, limit);
  const last = rows.at(-1);
  return {
    total: result.rows[0]?.total ?? 0,
    nextCursor:
      pageRows.length > limit && last
        ? `${last.due_date ?? "undated"}:${last.record_kind}:${last.id}`
        : null,
    rows: rows.map((row) => ({
      id: row.id,
      title: row.title,
      dueDate: row.due_date,
      isOverdue: row.is_overdue,
      record: {
        kind: row.record_kind,
        id: row.record_id,
        number: row.record_number,
        title: row.record_title,
        isConfidential: row.record_is_confidential,
      },
    })),
  };
}
