// SPDX-License-Identifier: AGPL-3.0-only

/** M29's upcoming Contract and Matter dates on records personal to the viewer. */
import { z } from "zod";
import {
  and,
  contractKeyDates,
  contracts,
  contractStatuses,
  contractTeam,
  eq,
  inArray,
  isNotNull,
  isNull,
  matters,
  matterKeyDates,
  matterStatuses,
  matterTeam,
  ne,
  or,
  sql,
  type AnyPgColumn,
  type Executor,
  type SQL,
} from "@openlaw/db";
import type { AuthenticatedUser } from "../../../auth/user.js";
import { contractTeamScope } from "../../../lib/contract-access.js";
import { matterTeamScope } from "../../../lib/matter-access.js";
import { HOME_SECTION_LIMIT } from "./approvals.js";

const DATE_SOURCES = ["key_date", "expiry", "notice_deadline"] as const;

export const DateHomeRowSchema = z.object({
  source: z.enum(DATE_SOURCES),
  keyDateId: z.string().nullable(),
  date: z.iso.date(),
  label: z.string().nullable(),
  noticePeriodDays: z.number().int().nonnegative().nullable(),
  unverified: z.boolean(),
  record: z.object({
    kind: z.enum(["contract", "matter"]),
    id: z.string(),
    number: z.number().int().positive(),
    title: z.string(),
    isConfidential: z.boolean(),
  }),
});

export const DatesHomeSectionSchema = z.object({
  type: z.literal("dates"),
  total: z.number().int().positive(),
  rows: z.array(DateHomeRowSchema).max(HOME_SECTION_LIMIT),
});

export type DatesHomeSection = z.infer<typeof DatesHomeSectionSchema>;

export const PersonalDatesSchema = z.object({
  total: z.number().int().nonnegative(),
  rows: z.array(DateHomeRowSchema),
});

interface DateDbRow extends Record<string, unknown> {
  source: (typeof DATE_SOURCES)[number];
  key_date_id: string | null;
  date: string;
  label: string | null;
  notice_period_days: number | null;
  unverified: boolean;
  record_kind: "contract" | "matter";
  record_id: string;
  record_number: number;
  record_title: string;
  record_is_confidential: boolean;
  total: number;
}

/**
 * The next thirty civil days of CTR-009 dates across records this viewer
 * manages or has a team row on. The personal predicate is narrower than
 * ordinary record reach and composes with it, so even an Administrator's
 * Home is their own work and a walled record contributes no row or total.
 *
 * The notice deadline is subtracted inside this query and stored nowhere,
 * exactly as the morning round reads it. Lifecycle predicates are the
 * round's too, with CTR-019's legacy-stage guard added for Contracts:
 * ended_at, stage, and archived_at for Contracts, and the joined status
 * category plus archived_at for Matters.
 */
export async function readDatesHomeSection(
  db: Executor,
  user: AuthenticatedUser,
): Promise<DatesHomeSection | null> {
  const dates = await readPersonalDates(db, user, { limit: HOME_SECTION_LIMIT });
  return dates.total === 0 ? null : { type: "dates", ...dates };
}

export async function readPersonalDates(
  db: Executor,
  user: AuthenticatedUser,
  options: { from?: string; to?: string; limit?: number },
): Promise<z.infer<typeof PersonalDatesSchema>> {
  const personalContracts = or(
    eq(contracts.managerId, user.id),
    inArray(
      contracts.id,
      db
        .select({ contractId: contractTeam.contractId })
        .from(contractTeam)
        .where(eq(contractTeam.userId, user.id)),
    ),
  );
  const personalMatters = or(
    eq(matters.managerId, user.id),
    inArray(
      matters.id,
      db
        .select({ matterId: matterTeam.matterId })
        .from(matterTeam)
        .where(eq(matterTeam.userId, user.id)),
    ),
  );
  const liveContracts = and(
    isNull(contracts.endedAt),
    isNull(contracts.archivedAt),
    ne(contractStatuses.stage, "ended"),
    personalContracts,
    contractTeamScope(db, user),
  );
  const liveMatters = and(
    eq(matterStatuses.category, "open"),
    isNull(matters.archivedAt),
    personalMatters,
    matterTeamScope(db, user),
  );
  const inWindow = (date: AnyPgColumn | SQL) =>
    options.from && options.to
      ? sql`${date} between ${options.from}::date and ${options.to}::date`
      : sql`${date} between current_date and current_date + 30`;
  const noticeDeadline = sql<string>`${contracts.expiryDate} - ${contracts.noticePeriodDays}`;

  const result = await db.execute<DateDbRow>(sql`
    with home_dates as (
      select
        'key_date'::text as source,
        ${contractKeyDates.id} as key_date_id,
        ${contractKeyDates.date} as date,
        ${contractKeyDates.label} as label,
        null::integer as notice_period_days,
        false as unverified,
        'contract'::text as record_kind,
        ${contracts.id} as record_id,
        ${contracts.number} as record_number,
        ${contracts.title} as record_title,
        ${contracts.isConfidential} as record_is_confidential,
        2 as source_rank
      from ${contractKeyDates}
      inner join ${contracts} on ${contracts.id} = ${contractKeyDates.contractId}
      inner join ${contractStatuses} on ${contractStatuses.id} = ${contracts.statusId}
      where ${and(liveContracts, inWindow(contractKeyDates.date))}

      union all

      select
        'expiry'::text as source,
        null::text as key_date_id,
        ${contracts.expiryDate} as date,
        null::text as label,
        null::integer as notice_period_days,
        coalesce(${contracts.aiUnverified} ? 'expiry_date', false) as unverified,
        'contract'::text as record_kind,
        ${contracts.id} as record_id,
        ${contracts.number} as record_number,
        ${contracts.title} as record_title,
        ${contracts.isConfidential} as record_is_confidential,
        1 as source_rank
      from ${contracts}
      inner join ${contractStatuses} on ${contractStatuses.id} = ${contracts.statusId}
      where ${and(liveContracts, isNotNull(contracts.expiryDate), inWindow(contracts.expiryDate))}

      union all

      select
        'notice_deadline'::text as source,
        null::text as key_date_id,
        ${noticeDeadline} as date,
        null::text as label,
        ${contracts.noticePeriodDays} as notice_period_days,
        coalesce(
          (${contracts.aiUnverified} ? 'expiry_date') or
          (${contracts.aiUnverified} ? 'notice_period_days'),
          false
        ) as unverified,
        'contract'::text as record_kind,
        ${contracts.id} as record_id,
        ${contracts.number} as record_number,
        ${contracts.title} as record_title,
        ${contracts.isConfidential} as record_is_confidential,
        0 as source_rank
      from ${contracts}
      inner join ${contractStatuses} on ${contractStatuses.id} = ${contracts.statusId}
      where ${and(
        liveContracts,
        isNotNull(contracts.expiryDate),
        isNotNull(contracts.noticePeriodDays),
        inWindow(noticeDeadline),
      )}

      union all

      select
        'key_date'::text as source,
        ${matterKeyDates.id} as key_date_id,
        ${matterKeyDates.date} as date,
        ${matterKeyDates.label} as label,
        null::integer as notice_period_days,
        false as unverified,
        'matter'::text as record_kind,
        ${matters.id} as record_id,
        ${matters.number} as record_number,
        ${matters.title} as record_title,
        ${matters.isConfidential} as record_is_confidential,
        2 as source_rank
      from ${matterKeyDates}
      inner join ${matters} on ${matters.id} = ${matterKeyDates.matterId}
      inner join ${matterStatuses} on ${matterStatuses.id} = ${matters.statusId}
      where ${and(liveMatters, inWindow(matterKeyDates.date))}
    )
    select
      source,
      key_date_id,
      date,
      label,
      notice_period_days,
      unverified,
      record_kind,
      record_id,
      record_number,
      record_title,
      record_is_confidential,
      count(*) over()::integer as total
    from home_dates
    order by date asc, source_rank asc, record_kind asc, record_id asc, key_date_id asc nulls first
    ${options.limit ? sql`limit ${options.limit}` : sql``}
  `);

  const first = result.rows[0];
  return {
    total: first?.total ?? 0,
    rows: result.rows.map((row) => ({
      source: row.source,
      keyDateId: row.key_date_id,
      date: row.date,
      label: row.label,
      noticePeriodDays: row.notice_period_days,
      unverified: row.unverified,
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
