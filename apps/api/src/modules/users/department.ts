// SPDX-License-Identifier: AGPL-3.0-only

/** SET-010 shares the audited Department write between an Administrator and the Portal first run. */

import { eq, users, type Executor } from "@openlaw/db";
import { recordActivity } from "../../lib/activity.js";
import { departmentName, lockedDepartment } from "../departments/references.js";

/** The caller holds the user row lock and has checked permission to change it. */
export async function setUserDepartment(
  tx: Executor,
  target: { id: string; email: string; departmentId: string | null },
  departmentId: string | null,
  actorId: string,
) {
  if (departmentId === target.departmentId) return;
  const next = departmentId ? await lockedDepartment(tx, departmentId) : null;
  const before = await departmentName(tx, target.departmentId);
  await tx
    .update(users)
    .set({ departmentId, updatedAt: new Date() })
    .where(eq(users.id, target.id));
  await recordActivity(tx, {
    entityType: "user",
    entityId: target.id,
    actorId,
    action: "user.department_set",
    visibility: "admin_only",
    payload: {
      email: target.email,
      from: before,
      to: next?.displayName ?? null,
      fromId: target.departmentId,
      toId: departmentId,
    },
  });
}
