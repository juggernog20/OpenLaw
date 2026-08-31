// SPDX-License-Identifier: AGPL-3.0-only

/** M29's Approvals section contract, shared by every renderer. */
import { z } from "zod";
import {
  alias,
  and,
  asc,
  contractApprovals,
  contracts,
  eq,
  isNull,
  sql,
  users,
  type Executor,
} from "@openlaw/db";
import type { AuthenticatedUser } from "../../../auth/user.js";
import { contractTeamScope } from "../../../lib/contract-access.js";

/** DES-069's fixed cap. Totals always describe the whole eligible set. */
export const HOME_SECTION_LIMIT = 3;

export const ApprovalHomeRowSchema = z.object({
  id: z.string(),
  contract: z.object({
    id: z.string(),
    number: z.number().int().positive(),
    title: z.string(),
    isConfidential: z.boolean(),
  }),
  requestedBy: z.object({
    id: z.string(),
    displayName: z.string(),
  }),
  requestedAt: z.iso.datetime(),
});

export const ApprovalsHomeSectionSchema = z.object({
  type: z.literal("approvals"),
  total: z.number().int().positive(),
  rows: z.array(ApprovalHomeRowSchema).max(HOME_SECTION_LIMIT),
});

export type ApprovalsHomeSection = z.infer<typeof ApprovalsHomeSectionSchema>;

const requesters = alias(users, "home_approval_requesters");

/**
 * Pending asks addressed to this viewer, oldest first.
 *
 * The owning Contract's existing reach predicate is part of the query,
 * before both the window total and the cap. A walled Contract therefore
 * creates no row, count, or pagination-shaped gap. Contributors are not
 * approvers under CTR-012, so their role projection omits this section.
 */
export async function readApprovalsHomeSection(
  db: Executor,
  user: AuthenticatedUser,
): Promise<ApprovalsHomeSection | null> {
  if (user.role !== "administrator" && user.role !== "legal_team_member") return null;

  const rows = await db
    .select({
      id: contractApprovals.id,
      contractId: contracts.id,
      contractNumber: contracts.number,
      contractTitle: contracts.title,
      contractIsConfidential: contracts.isConfidential,
      requestedById: requesters.id,
      requestedByName: requesters.displayName,
      requestedAt: contractApprovals.createdAt,
      total: sql<number>`count(*) over()::integer`,
    })
    .from(contractApprovals)
    .innerJoin(contracts, eq(contractApprovals.contractId, contracts.id))
    .innerJoin(requesters, eq(contractApprovals.requestedBy, requesters.id))
    .where(
      and(
        eq(contractApprovals.approverId, user.id),
        eq(contractApprovals.status, "pending"),
        isNull(contracts.archivedAt),
        contractTeamScope(db, user),
      ),
    )
    .orderBy(asc(contractApprovals.createdAt), asc(contractApprovals.id))
    .limit(HOME_SECTION_LIMIT);

  const first = rows[0];
  if (!first) return null;
  return {
    type: "approvals",
    total: first.total,
    rows: rows.map((row) => ({
      id: row.id,
      contract: {
        id: row.contractId,
        number: row.contractNumber,
        title: row.contractTitle,
        isConfidential: row.contractIsConfidential,
      },
      requestedBy: {
        id: row.requestedById,
        displayName: row.requestedByName,
      },
      requestedAt: row.requestedAt.toISOString(),
    })),
  };
}
