// SPDX-License-Identifier: AGPL-3.0-only

/** M29's Contract portfolio, keyed on the viewer as Owner. */
import { z } from "zod";
import {
  and,
  contractKeyDates,
  contracts,
  contractStatuses,
  CONTRACT_STAGES,
  desc,
  eq,
  isNull,
  sql,
  type Executor,
} from "@openlaw/db";
import type { AuthenticatedUser } from "../../../auth/user.js";
import { contractTeamScope } from "../../../lib/contract-access.js";
import { renewalPending } from "../../../lib/contract-term.js";
import { HOME_SECTION_LIMIT } from "./approvals.js";

export const ContractHomeRowSchema = z.object({
  id: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
  isConfidential: z.boolean(),
  stage: z.enum(CONTRACT_STAGES),
  nextDate: z.iso.date().nullable(),
  renewalPendingConfirmation: z.boolean(),
});

export const ContractsHomeSectionSchema = z.object({
  type: z.literal("contracts"),
  total: z.number().int().positive(),
  rows: z.array(ContractHomeRowSchema).max(HOME_SECTION_LIMIT),
});

export type ContractsHomeSection = z.infer<typeof ContractsHomeSectionSchema>;

/**
 * Live Contracts whose Owner is this viewer, nearest next date first.
 *
 * The correlated date expression is CTR-009's complete union: named
 * Key dates, the current expiry, and CTR-006's derived notice deadline.
 * Dates before today cannot be the next deadline. Contracts with no
 * upcoming date remain in the portfolio and sort after dated records.
 */
export async function readContractsHomeSection(
  db: Executor,
  user: AuthenticatedUser,
): Promise<ContractsHomeSection | null> {
  const nextDate = sql<string | null>`(
    select min(home_contract_dates.date)::text
    from (
      select ${contractKeyDates.date} as date
      from ${contractKeyDates}
      where ${contractKeyDates.contractId} = ${contracts.id}
        and ${contractKeyDates.date} >= current_date

      union all

      select ${contracts.expiryDate} as date
      where ${contracts.expiryDate} >= current_date

      union all

      select (${contracts.expiryDate} - ${contracts.noticePeriodDays}) as date
      where ${contracts.expiryDate} is not null
        and ${contracts.noticePeriodDays} is not null
        and (${contracts.expiryDate} - ${contracts.noticePeriodDays}) >= current_date
    ) home_contract_dates
  )`;

  const rows = await db
    .select({
      id: contracts.id,
      number: contracts.number,
      title: contracts.title,
      isConfidential: contracts.isConfidential,
      stage: contractStatuses.stage,
      nextDate,
      termType: contracts.termType,
      expiryDate: contracts.expiryDate,
      renewalPeriodMonths: contracts.renewalPeriodMonths,
      archivedAt: contracts.archivedAt,
      endedAt: contracts.endedAt,
      total: sql<number>`count(*) over()::integer`,
    })
    .from(contracts)
    .innerJoin(contractStatuses, eq(contracts.statusId, contractStatuses.id))
    .where(
      and(
        eq(contracts.managerId, user.id),
        isNull(contracts.archivedAt),
        isNull(contracts.endedAt),
        contractTeamScope(db, user),
      ),
    )
    .orderBy(sql`${nextDate} asc nulls last`, desc(contracts.number))
    .limit(HOME_SECTION_LIMIT);

  const first = rows[0];
  if (!first) return null;
  return {
    type: "contracts",
    total: first.total,
    rows: rows.map((row) => ({
      id: row.id,
      number: row.number,
      title: row.title,
      isConfidential: row.isConfidential,
      stage: row.stage,
      nextDate: row.nextDate,
      renewalPendingConfirmation: renewalPending(row),
    })),
  };
}
