// SPDX-License-Identifier: AGPL-3.0-only
import { eq, sql, users, USER_ROLES, type Transaction } from "@openlaw/db";
import { lockedUser } from "../modules/contracts/record.js";
import { httpError } from "./problem.js";

export type TeamPerson = string | { userId: string } | { email: string };

/** HTTP ids keep their existing semantics; Tool references require a live person. */
export async function teamPersonId(tx: Transaction, target: TeamPerson): Promise<string> {
  if (typeof target === "string") return target;
  let userId: string;
  if ("userId" in target) userId = target.userId;
  else {
    const [person] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(sql`lower(${users.email})`, target.email.toLowerCase()))
      .limit(1)
      .for("update");
    if (!person) throw httpError(400, "That is not a person we can add.");
    userId = person.id;
  }
  return (await lockedUser(tx, userId, USER_ROLES, "That is not a person we can add.")).id;
}
