// SPDX-License-Identifier: AGPL-3.0-only

/** DD-014's matter reach and confidentiality-write rules, stated once. */
import {
  and,
  asc,
  COMMENT_VISIBILITIES,
  eq,
  inArray,
  isNull,
  matters,
  matterTeam,
  or,
  sql,
  users,
  type CommentVisibility,
  type Executor,
  type Matter,
  type SQL,
  type Transaction,
} from "@openlaw/db";
import type { AuthenticatedUser } from "../auth/user.js";

export const MATTER_CREATOR_ROLE = "creator";
export const MATTER_MANAGER_ROLES = new Set<string>(["administrator", "legal_team_member"]);
export const MATTER_MANAGER_REFUSAL =
  "The Matter Manager must be a live Legal Team Member or Administrator.";
export const NO_MATTER = "No matter exists with this number.";

const MEMBER_PLUS = new Set(["administrator", "legal_team_member"]);
const WORKING_TIERS: readonly CommentVisibility[] = ["working_team", "full_thread"];

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

export interface MatterAudience {
  entityType: "matter";
  matterId: string;
  tiers: readonly CommentVisibility[];
  seesConfidentialDocuments: boolean;
}

export interface MatterMentionCandidate {
  id: string;
  displayName: string;
  image: string | null;
  tiers: readonly CommentVisibility[];
}

/** The matter reach rule and DD-016 rooms, keyed by the internal id used by generic surfaces. */
export async function matterAudience(
  db: Executor,
  user: AuthenticatedUser,
  matterId: string,
): Promise<MatterAudience | null> {
  const [row] = await db
    .select({
      id: matters.id,
      managerId: matters.managerId,
      onTeam: sql<boolean>`exists (
        select 1 from ${matterTeam}
        where ${matterTeam.matterId} = ${matters.id}
          and ${matterTeam.userId} = ${user.id}
      )`,
    })
    .from(matters)
    .where(and(eq(matters.id, matterId), matterTeamScope(db, user)))
    .limit(1);
  if (!row) return null;
  const tiers = MEMBER_PLUS.has(user.role)
    ? COMMENT_VISIBILITIES
    : user.role === "contributor"
      ? WORKING_TIERS
      : [];
  return tiers.length > 0
    ? {
        entityType: "matter",
        matterId: row.id,
        tiers,
        seesConfidentialDocuments:
          user.role === "administrator" || row.onTeam || row.managerId === user.id,
      }
    : null;
}

/** Everyone the matter reaches, said over people for mentions and notification fan-out. */
export async function matterMentionCandidates(
  db: Executor,
  matterId: string,
  only?: readonly string[],
): Promise<MatterMentionCandidate[]> {
  const [matter] = await db
    .select({ managerId: matters.managerId, isConfidential: matters.isConfidential })
    .from(matters)
    .where(eq(matters.id, matterId))
    .limit(1);
  if (!matter) return [];
  const onTeam = inArray(
    users.id,
    db
      .select({ userId: matterTeam.userId })
      .from(matterTeam)
      .where(eq(matterTeam.matterId, matterId)),
  );
  const memberReach = matter.isConfidential
    ? or(onTeam, matter.managerId ? eq(users.id, matter.managerId) : undefined)
    : undefined;
  const rows = await db
    .select({ id: users.id, displayName: users.displayName, image: users.image, role: users.role })
    .from(users)
    .where(
      and(
        isNull(users.archivedAt),
        or(
          eq(users.role, "administrator"),
          and(eq(users.role, "legal_team_member"), memberReach),
          and(eq(users.role, "contributor"), onTeam),
        ),
        only ? inArray(users.id, [...only]) : undefined,
      ),
    )
    .orderBy(asc(sql`lower(${users.displayName})`), asc(users.id));
  return rows.map((row) => ({
    id: row.id,
    displayName: row.displayName,
    image: row.image,
    tiers: MEMBER_PLUS.has(row.role) ? COMMENT_VISIBILITIES : WORKING_TIERS,
  }));
}
