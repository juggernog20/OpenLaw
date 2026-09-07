// SPDX-License-Identifier: AGPL-3.0-only

/** Derives Next deadline from Tasks and dates under the MTR-016 and CTR-005 UX addenda. */

import { z } from "zod";
import {
  contracts,
  contractStatuses,
  contractKeyDates,
  contractTasks,
  matters,
  matterStatuses,
  matterKeyDates,
  matterTasks,
  sql,
} from "@openlaw/db";
import { civilToday } from "./contract-term.js";

export const NextDeadlineSchema = z
  .object({
    date: z.iso.date(),
    label: z.string(),
    source: z.enum(["task", "key_date"]),
    unverified: z.boolean().optional(),
  })
  .nullable();

/** Upcoming calendar milestones and unfinished Tasks, including overdue Tasks. */
export function nextDeadline(module: "matter" | "contract", today = civilToday()) {
  const record = module === "matter" ? matters : contracts;
  const dates = module === "matter" ? matterKeyDates : contractKeyDates;
  const tasks = module === "matter" ? matterTasks : contractTasks;
  const dateOwner = module === "matter" ? matterKeyDates.matterId : contractKeyDates.contractId;
  const taskOwner = module === "matter" ? matterTasks.matterId : contractTasks.contractId;
  const active =
    module === "matter"
      ? sql`${matterStatuses.category} = 'open'`
      : sql`${contractStatuses.stage} <> 'ended'`;
  const termDates =
    module === "contract"
      ? sql`
    union all
    select ${contracts.expiryDate}, 'Expiry date', 'key_date', 'expiry',
      ${contracts.aiUnverified} ? 'expiry_date'
    where ${contracts.expiryDate} >= ${today}::date
    union all
    select ${contracts.expiryDate} - ${contracts.noticePeriodDays}, 'Notice deadline', 'key_date', 'notice',
      ${contracts.aiUnverified} ?| array['expiry_date', 'notice_period_days']
    where ${contracts.expiryDate} - ${contracts.noticePeriodDays} >= ${today}::date
  `
      : sql``;
  return sql<z.infer<typeof NextDeadlineSchema>>`case
    when ${active} and ${record.archivedAt} is null then (
      select json_strip_nulls(json_build_object(
        'date', deadline.date, 'label', deadline.label, 'source', deadline.source,
        'unverified', nullif(deadline.unverified, false)))
      from (
        select ${dates.date} as date, ${dates.label} as label, 'key_date' as source, ${dates.id} as id,
          false as unverified
        from ${dates}
        where ${dateOwner} = ${record.id} and ${dates.date} >= ${today}::date
        union all
        select ${tasks.dueDate}, ${tasks.title}, 'task', ${tasks.id}, false
        from ${tasks}
        where ${taskOwner} = ${record.id} and not ${tasks.isDone} and ${tasks.dueDate} is not null
        ${termDates}
      ) deadline
      order by deadline.date, deadline.source, deadline.id
      limit 1
    ) else null end`;
}
