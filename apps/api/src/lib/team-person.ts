// SPDX-License-Identifier: AGPL-3.0-only

/** DD-029 Tools name a person by id or email; the routes pass the id through. */
import { eq, sql, users, type Transaction } from "@openlaw/db";
import { httpError } from "./problem.js";

export type TeamPerson = string | { userId: string } | { email: string };

/**
 * Resolves the reference to a user id and nothing more. An add checks the
 * person is live through its own lookup; a remove takes any id so a
 * deactivated person can still leave the team, the same as over HTTP.
 */
export async function teamPersonId(tx: Transaction, target: TeamPerson): Promise<string> {
  if (typeof target === "string") return target;
  if ("userId" in target) return target.userId;
  const [person] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, target.email.toLowerCase()))
    .limit(1);
  if (!person) throw httpError(400, "No person has that email address.");
  return person.id;
}
