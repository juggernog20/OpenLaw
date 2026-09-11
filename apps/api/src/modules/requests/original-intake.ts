// SPDX-License-Identifier: AGPL-3.0-only

import { and, eq, isNull, requests, type Executor } from "@openlaw/db";
import { z } from "zod";
import type { AuthenticatedUser } from "../../auth/guards.js";

export const OriginalIntakeSchema = z.object({
  number: z.number().int(),
  description: z.string().nullable(),
});

/** Call after checking record access; the original Request keeps its own audience. */
export async function originalIntake(
  db: Executor,
  user: AuthenticatedUser,
  module: "contract" | "matter",
  recordId: string,
) {
  const member = user.role === "administrator" || user.role === "legal_team_member";
  const [row] = await db
    .select({ number: requests.number, description: requests.description })
    .from(requests)
    .where(
      and(
        eq(
          module === "contract" ? requests.convertedContractId : requests.convertedMatterId,
          recordId,
        ),
        eq(requests.status, "converted"),
        isNull(requests.archivedAt),
        member ? undefined : eq(requests.requesterId, user.id),
      ),
    )
    .limit(1);
  return row ?? null;
}
