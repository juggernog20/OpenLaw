// SPDX-License-Identifier: AGPL-3.0-only

/** DD-014's matter reach and confidentiality-write rules, stated once. */
import {
  and,
  eq,
  inArray,
  matters,
  matterTeam,
  or,
  sql,
  type Executor,
  type Matter,
  type SQL,
  type Transaction,
} from "@openlaw/db";
import type { AuthenticatedUser } from "../auth/user.js";

export const MATTER_CREATOR_ROLE = "creator";
export const NO_MATTER = "No matter exists with this number.";

function mattersTheyAreOn(db: Executor, user: AuthenticatedUser): SQL {
  return inArray(
    matters.id,
    db
      .select({ matterId: matterTeam.matterId })
      .from(matterTeam)
      .where(eq(matterTeam.userId, user.id)),
  );
}

export function matterTeamScope(db: Executor, user: AuthenticatedUser): SQL | undefined {
  switch (user.role) {
    case "administrator":
      return undefined;
    case "legal_team_member":
      return or(
        eq(matters.isConfidential, false),
        mattersTheyAreOn(db, user),
        eq(matters.managerId, user.id),
      );
    case "contributor":
      return mattersTheyAreOn(db, user);
    case "business_user":
      return sql`false`;
    default: {
      const unanswered: never = user.role;
      throw new Error(`No matter reach rule for role: ${unanswered}`);
    }
  }
}

declare const matterRowLockHeld: unique symbol;
export type LockedMatter = Matter & { readonly [matterRowLockHeld]: true };

export async function reachedMatter(
  db: Transaction,
  user: AuthenticatedUser,
  number: number,
  options: { lock: true },
): Promise<LockedMatter | null>;
export async function reachedMatter(
  db: Executor,
  user: AuthenticatedUser,
  number: number,
  options?: { lock?: false },
): Promise<Matter | null>;
export async function reachedMatter(
  db: Executor,
  user: AuthenticatedUser,
  number: number,
  options: { lock?: boolean } = {},
): Promise<Matter | null> {
  const query = db
    .select()
    .from(matters)
    .where(and(eq(matters.number, number), matterTeamScope(db, user)))
    .limit(1);
  const [row] = await (options.lock ? query.for("update", { of: matters }) : query);
  return row ?? null;
}

export type MatterConfidentialityWrite = "allowed" | "refused" | "unreachable";

export async function matterConfidentialityWrite(
  db: Executor,
  user: AuthenticatedUser,
  matter: Pick<Matter, "id" | "managerId" | "isConfidential">,
): Promise<MatterConfidentialityWrite> {
  if (user.role === "administrator") return "allowed";
  const held = await db
    .select({ role: matterTeam.role })
    .from(matterTeam)
    .where(and(eq(matterTeam.matterId, matter.id), eq(matterTeam.userId, user.id)));
  const onTeam = held.length > 0;
  const isManager = matter.managerId === user.id;
  const reaches =
    user.role === "contributor"
      ? onTeam
      : user.role === "legal_team_member" && (!matter.isConfidential || onTeam || isManager);
  if (!reaches) return "unreachable";
  return isManager || held.some((row) => row.role === MATTER_CREATOR_ROLE) ? "allowed" : "refused";
}
