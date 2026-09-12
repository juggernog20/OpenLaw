// SPDX-License-Identifier: AGPL-3.0-only

import {
  and,
  eq,
  inArray,
  isNull,
  matters,
  matterTeam,
  type Executor,
  type SQL,
} from "@openlaw/db";
import type { AuthenticatedUser } from "../auth/user.js";
import { portalContractScope } from "./portal-contract-access.js";

export function portalRecordScope(
  db: Executor,
  user: AuthenticatedUser,
  module: "contract" | "matter",
): SQL {
  if (module === "contract") return portalContractScope(db, user);
  return and(
    isNull(matters.archivedAt),
    inArray(
      matters.id,
      db.select({ id: matterTeam.matterId }).from(matterTeam).where(eq(matterTeam.userId, user.id)),
    ),
  )!;
}
