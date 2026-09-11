// SPDX-License-Identifier: AGPL-3.0-only

/** DD-023 record membership, DD-014 confidentiality, and comment audiences. */

import {
  activityLog,
  and,
  asc,
  contracts,
  contractTeam,
  COMMENT_VISIBILITIES,
  documents,
  eq,
  inArray,
  isNotNull,
  isNull,
  matters,
  matterTeam,
  or,
  sql,
  users,
  type CommentVisibility,
  type Executor,
  type SQL,
  type Transaction,
  type UserRole,
} from "@openlaw/db";
import type { AiUnverifiedMap } from "@openlaw/shared";
import type { AuthenticatedUser } from "../auth/user.js";

export const OWNER_ROLES: readonly string[] = ["administrator", "legal_team_member"];
export const OWNER_REFUSAL = "The Owner must be a live Administrator or Legal Team Member.";

const ALL_TIERS: readonly CommentVisibility[] = COMMENT_VISIBILITIES;

const PORTAL_TIERS: readonly CommentVisibility[] = ["full_thread"];

function contractsTheyAreOn(db: Executor, user: AuthenticatedUser): SQL {
  return inArray(
    contracts.id,
    db
      .select({ contractId: contractTeam.contractId })
      .from(contractTeam)
      .where(eq(contractTeam.userId, user.id)),
  );
}

export function contractNamedAudienceScope(db: Executor, user: AuthenticatedUser): SQL {
  return or(contractsTheyAreOn(db, user), eq(contracts.managerId, user.id))!;
}

export function contractTeamScope(db: Executor, user: AuthenticatedUser): SQL | undefined {
  switch (user.role) {
    case "administrator":
    case "legal_team_member":
      return or(eq(contracts.isConfidential, false), contractNamedAudienceScope(db, user));
    case "business_user":
      return and(isNull(contracts.archivedAt), contractsTheyAreOn(db, user));
    default: {
      // A role with no case would fall off the end and answer
      // `undefined` — an unrestricted grant. This makes
      // the compiler refuse that instead: a role added to the union
      // must be answered here before the build passes.
      const unanswered: never = user.role;
      throw new Error(`No contract reach rule for role: ${unanswered}`);
    }
  }
}

export const NO_CONTRACT = "No contract exists with this number.";

/** One contract this viewer reaches, in the columns the routes ask for.
 * They are all columns of `contracts`, so one row answers every module. */
export interface ReachedContract {
  id: string;
  /** CTR-003's reference, the number the caller asked by. */
  number: number;
  title: string;
  /** SET-003's soft delete: a time freezes the record (CTR-021). */
  archivedAt: Date | null;
  /** CTR-004's Legal Owner. */
  managerId: string | null;
  /** CTR-014's instrument, or NULL on a record with no paper yet. */
  primaryDocumentId: string | null;
  /** DD-014's flag, as it stands on this row. */
  isConfidential: boolean;
  /** MTR-007's broader-work container, or NULL while standalone. */
  matterId: string | null;
  /** CTR-006's end of term; always NULL on an evergreen contract. */
  expiryDate: string | null;
  /** CTR-006's action window before expiry, in days. */
  noticePeriodDays: number | null;
  /** CTR-008's source flags for the term-derived dates. */
  aiUnverified: AiUnverifiedMap | null;
  contractTypeId: string;
}

/** The witness a {@link LockedContract} carries. It is `declare`d and
 * never assigned, so no value can claim the lock without taking it. */
declare const contractRowLockHeld: unique symbol;

/** A contract this viewer reaches whose row the caller holds `FOR UPDATE`.
 * Only {@link reachedContract} with `lock: true` mints one. */
export type LockedContract = ReachedContract & { readonly [contractRowLockHeld]: true };

/**
 * One contract this viewer reaches, by number, or `null`. The scope rides
 * beside the number, so a contract out of reach reads exactly as one that
 * was never created. `lock` holds the row for the write that follows and
 * is only offered on a transaction, because `FOR UPDATE` on a pooled
 * handle is released by its own statement.
 */
export async function reachedContract(
  db: Transaction,
  user: AuthenticatedUser,
  number: number,
  options: { lock: true },
): Promise<LockedContract | null>;
export async function reachedContract(
  db: Executor,
  user: AuthenticatedUser,
  number: number,
  options?: { lock?: false },
): Promise<ReachedContract | null>;
export async function reachedContract(
  db: Executor,
  user: AuthenticatedUser,
  number: number,
  options: { lock?: boolean } = {},
): Promise<ReachedContract | null> {
  const query = db
    .select({
      id: contracts.id,
      number: contracts.number,
      title: contracts.title,
      archivedAt: contracts.archivedAt,
      managerId: contracts.managerId,
      primaryDocumentId: contracts.primaryDocumentId,
      isConfidential: contracts.isConfidential,
      matterId: contracts.matterId,
      expiryDate: contracts.expiryDate,
      noticePeriodDays: contracts.noticePeriodDays,
      aiUnverified: contracts.aiUnverified,
      contractTypeId: contracts.contractTypeId,
    })
    .from(contracts)
    .where(and(eq(contracts.number, number), contractTeamScope(db, user)))
    .limit(1);
  const [row] = await (options.lock ? query.for("update", { of: contracts }) : query);
  return row ?? null;
}

function namedOnTheOwningContract(db: Executor, user: AuthenticatedUser): SQL {
  return inArray(
    documents.contractId,
    db
      .select({ id: contracts.id })
      .from(contracts)
      .where(
        or(
          eq(contracts.managerId, user.id),
          inArray(
            contracts.id,
            db
              .select({ contractId: contractTeam.contractId })
              .from(contractTeam)
              .where(eq(contractTeam.userId, user.id)),
          ),
        ),
      ),
  );
}

function namedOnTheOwningMatter(db: Executor, user: AuthenticatedUser): SQL {
  return inArray(
    documents.matterId,
    db
      .select({ id: matters.id })
      .from(matters)
      .where(
        or(
          eq(matters.managerId, user.id),
          inArray(
            matters.id,
            db
              .select({ matterId: matterTeam.matterId })
              .from(matterTeam)
              .where(eq(matterTeam.userId, user.id)),
          ),
        ),
      ),
  );
}

export function documentAudienceScope(db: Executor, user: AuthenticatedUser): SQL | undefined {
  switch (user.role) {
    case "administrator":
    case "legal_team_member":
    case "business_user":
      return or(
        eq(documents.isConfidential, false),
        namedOnTheOwningContract(db, user),
        namedOnTheOwningMatter(db, user),
        // Entity paper has no audience narrowing of its own. Reach is a
        // separate required predicate: `entityReachScope` (ENT-004) is
        // applied before every consumer of this scope runs, so a document
        // arriving here already sits on an Entity the viewer reaches.
        isNotNull(documents.entityId),
        user.role === "administrator" ? isNotNull(documents.knowledgeItemId) : undefined,
      );
    default: {
      const unanswered: never = user.role;
      throw new Error(`No document reach rule for role: ${unanswered}`);
    }
  }
}

export function readableTiers(role: UserRole, onTeam: boolean): readonly CommentVisibility[] {
  if (role === "administrator" || role === "legal_team_member") return ALL_TIERS;
  if (role === "business_user" && onTeam) return PORTAL_TIERS;
  return [];
}

interface Standing {
  role: UserRole;
  onTeam: boolean;
  isOwner: boolean;
}

function inNamedAudience(person: Standing, isConfidential: boolean): boolean {
  switch (person.role) {
    case "administrator":
    case "legal_team_member":
      return !isConfidential || person.onTeam || person.isOwner;
    // The team row is the Business User's whole grant (DD-023), and it
    // satisfies the flag too, so confidentiality adds nothing here.
    case "business_user":
      return person.onTeam;
    default: {
      // The same refusal as the row scope's: a role the union grows
      // must be answered in both halves, or the build fails.
      const unanswered: never = person.role;
      throw new Error(`No contract reach rule for role: ${unanswered}`);
    }
  }
}

/** One viewer's standing on one contract they can reach. */
export interface ContractAudience {
  entityType: "contract";
  /** The contract's id, re-read here rather than trusted from the client. */
  contractId: string;
  /** The tiers this viewer hears on it; never empty. */
  tiers: readonly CommentVisibility[];
  /** Whether this viewer is inside the audience of a confidential
   * document on this record (DD-014, DOC-008): named by a team row or
   * as its Legal Owner. */
  seesConfidentialDocuments: boolean;
}

export async function contractAudience(
  db: Executor,
  user: AuthenticatedUser,
  contractId: string,
): Promise<ContractAudience | null> {
  const [row] = await db
    .select({
      id: contracts.id,
      // Membership rides along with the reach check: the tier answer
      // needs it, and a second round trip would only be a second chance
      // for the two to disagree.
      onTeam: sql<boolean>`exists (
        select 1 from ${contractTeam}
        where ${contractTeam.contractId} = ${contracts.id}
          and ${contractTeam.userId} = ${user.id}
      )`,

      managerId: contracts.managerId,
    })
    .from(contracts)
    .where(and(eq(contracts.id, contractId), contractTeamScope(db, user)))
    .limit(1);
  if (!row) return null;
  const tiers = readableTiers(user.role, row.onTeam);
  if (tiers.length === 0) return null;
  return {
    entityType: "contract",
    contractId: row.id,
    tiers,
    // The same audience the document scope filters rows by, said over
    // this one person. It is `inNamedAudience` asked with the flag
    // already known to be set — the question is only ever put to a
    // viewer about a document that is confidential.
    seesConfidentialDocuments: inNamedAudience(
      { role: user.role, onTeam: row.onTeam, isOwner: row.managerId === user.id },
      true,
    ),
  };
}

export function confidentialDocumentEntryScope(
  audience: Pick<ContractAudience, "seesConfidentialDocuments">,
): SQL<unknown> | undefined {
  if (audience.seesConfidentialDocuments) return undefined;
  // One clause per document key the payloads use. Parenthesised here
  // rather than left to the caller: each is one `or`, and an unbracketed
  // `or` composed into an `and` list would bind the wrong way and admit
  // every entry in the feed.
  const backedByAnOpenRow = (key: string) => sql`(
    ${activityLog.payload} ->> ${key} is null
    or exists (
      select 1 from ${documents}
      where ${documents.id} = ${activityLog.payload} ->> ${key}
        and ${documents.isConfidential} = false
    )
  )`;
  return sql`(${backedByAnOpenRow("documentId")} and ${backedByAnOpenRow("fromDocumentId")})`;
}

/** `unreachable` is answered as a missing record, the same 404 the read
 * gives. `refused` is a plain 403: the viewer already sees the record. */
export type ConfidentialityWrite = "allowed" | "refused" | "unreachable";

/** The facts about a contract the flag questions turn on, as every
 * mutation already holds them on the row it locked. */
export interface LockedContractFacts {
  id: string;
  /** CTR-004's Legal Owner. */
  managerId: string | null;
  isConfidential: boolean;
}

async function standingOn(
  db: Executor,
  user: AuthenticatedUser,
  contractId: string,
  managerId: string | null,
): Promise<{ standing: Standing }> {
  const held = await db
    .select({ userId: contractTeam.userId })
    .from(contractTeam)
    .where(and(eq(contractTeam.contractId, contractId), eq(contractTeam.userId, user.id)));
  return {
    standing: {
      role: user.role,
      onTeam: held.length > 0,
      isOwner: managerId === user.id,
    },
  };
}

export async function reachesLockedContract(
  db: Executor,
  user: AuthenticatedUser,
  contract: LockedContractFacts,
): Promise<boolean> {
  const { standing } = await standingOn(db, user, contract.id, contract.managerId);
  return inNamedAudience(standing, contract.isConfidential);
}

export async function confidentialityWrite(
  db: Executor,
  user: AuthenticatedUser,
  contract: LockedContractFacts,
): Promise<ConfidentialityWrite> {
  const { standing } = await standingOn(db, user, contract.id, contract.managerId);
  if (!inNamedAudience(standing, contract.isConfidential)) return "unreachable";
  if (!OWNER_ROLES.includes(user.role)) return "refused";
  const [record] = await db
    .select({ createdBy: contracts.createdBy })
    .from(contracts)
    .where(eq(contracts.id, contract.id))
    .limit(1);
  const isCreator = record?.createdBy === user.id;
  return standing.role === "administrator" || standing.isOwner || isCreator ? "allowed" : "refused";
}

/** The facts about a document the flag questions turn on, read under
 * the owning contract's lock. */
export interface LockedDocument {
  /** DOC-008's owning record, the only place a document's team is. */
  contractId: string;
  /** The owning contract's Legal Owner (CTR-004). */
  contractManagerId: string | null;
  /** Who uploaded the document: DD-014's creator, one level down. */
  createdBy: string;
  /** The document's own flag, not the contract's. */
  isConfidential: boolean;
}

export async function documentConfidentialityWrite(
  db: Executor,
  user: AuthenticatedUser,
  document: LockedDocument,
): Promise<ConfidentialityWrite> {
  const { standing } = await standingOn(db, user, document.contractId, document.contractManagerId);
  if (!inNamedAudience(standing, document.isConfidential)) return "unreachable";
  if (!OWNER_ROLES.includes(user.role)) return "refused";
  return standing.role === "administrator" || standing.isOwner || document.createdBy === user.id
    ? "allowed"
    : "refused";
}

/** One person a comment on this record can address, and the tiers they
 * would hear it at. */
export interface MentionCandidate {
  id: string;
  displayName: string;
  image: string | null;
  /** The DD-016 tiers this person hears on this contract; never empty. */
  tiers: readonly CommentVisibility[];
}

export async function contractMentionCandidates(
  db: Executor,
  contractId: string,
  only?: readonly string[],
  options: { confidentialDocument?: boolean } = {},
): Promise<MentionCandidate[]> {
  // The two facts about the record the reach rule turns on. A record
  // that is not there reaches nobody, which is the same answer its own
  // 404 gives.
  const [record] = await db
    .select({
      archivedAt: contracts.archivedAt,
      isConfidential: contracts.isConfidential,
      managerId: contracts.managerId,
    })
    .from(contracts)
    .where(eq(contracts.id, contractId))
    .limit(1);
  if (!record) return [];

  const rows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      image: users.image,
      role: users.role,
      onTeam: sql<boolean>`exists (
        select 1 from ${contractTeam}
        where ${contractTeam.contractId} = ${contractId}
          and ${contractTeam.userId} = ${users.id}
      )`,
    })
    .from(users)
    .where(and(isNull(users.archivedAt), only ? inArray(users.id, [...only]) : undefined))
    // Alphabetical, as every people picker in the product is ordered.
    .orderBy(asc(sql`lower(${users.displayName})`), asc(users.id));
  return rows.flatMap((row) => {
    if (row.role === "business_user" && record.archivedAt) return [];
    const standing = { role: row.role, onTeam: row.onTeam, isOwner: row.id === record.managerId };
    if (!inNamedAudience(standing, record.isConfidential)) return [];
    // The second level of the flag, when the caller is asking about one
    // (DOC-008). It narrows and never widens: a document has no team of
    // its own, so this is the record's own audience read with the flag
    // set rather than a different set of people.
    if (options.confidentialDocument && !inNamedAudience(standing, true)) return [];
    const tiers = readableTiers(row.role, row.onTeam);
    if (tiers.length === 0) return [];
    return [{ id: row.id, displayName: row.displayName, image: row.image, tiers }];
  });
}
