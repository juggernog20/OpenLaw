// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Who reaches a contract, and how much of its conversation they hear.
 *
 * Two questions live here, and they are one answer in two halves. The
 * first is reach (CTR-021): Member+ read every contract, a Contributor
 * reads exactly the contracts they hold a `contract_team` row on, and
 * everyone else reads none. The second is the DD-016 tier predicate: of
 * the comments and activity entries on a contract they can reach, which
 * tiers is this viewer in the room for.
 *
 * Both halves are here because they are the same fact about a person and
 * a record, and two copies of it would drift. The contract routes take
 * the reach half; the comment routes take both.
 *
 * A third question joins them in M10: who may decide the audience — set
 * the Confidential flag or clear it (DD-014, CTR-022). It is here
 * because its refusal is built out of reach: a viewer who does not reach
 * the record is answered as if the record were not there, and only a
 * viewer who does reach it is told plainly that this is not theirs to
 * change. Answering that from anywhere else would mean a second copy of
 * the reach rule.
 *
 * The mutation paths ask reach here too, on the contract row they have
 * already locked. Until M10 they asked nothing: Member+ was a sufficient
 * grant, so the locked read that starts every contract mutation carried
 * no row scope. It is not sufficient now, and a write must leak no more
 * than a read — so the write path and the read path answer out of one
 * rule rather than two that could drift.
 *
 * The mention candidates (CMT-007) are the same predicate turned around
 * — run over the people on this record rather than over its rows — so
 * the answer to "who can the typeahead offer" cannot disagree with the
 * answer to "who is refused a mention at this tier".
 *
 * **Filtering happens at query time, never at display time** (DD-016,
 * DD-017). A tier the viewer is not in never leaves the database, so no
 * total, badge, or page count can reveal that it exists.
 *
 * M10's confidentiality gate (DD-014) composes **in front** of this
 * rather than replacing it: `is_confidential` narrows who reaches the
 * record, and the tiers below then answer for whoever is left.
 *
 * M11 adds a fourth question, one level down: who reaches one
 * **document** on a record they already reach (DD-014, DOC-008). It
 * composes in front of the record's gate the same way — a viewer must
 * pass both — and it is answered out of the same audience rule, because
 * "the named team, the Owner, and Administrators" is one sentence and
 * two copies of it would drift. There is no document team: the flag
 * narrows what the contract already allows and never widens it.
 */

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
  isNull,
  or,
  sql,
  users,
  type CommentVisibility,
  type Executor,
  type SQL,
  type Transaction,
  type UserRole,
} from "@openlaw/db";
import type { AuthenticatedUser } from "../auth/user.js";

/**
 * The `contract_team` role that records who made the contract (CTR-004).
 * It is provenance rather than membership — the server writes it once at
 * creation and nothing after that adds or drops it — and it is the row
 * DD-014 means by "the creator". It lives here because two rules read
 * it: the routes write it, and the flag's actor set below asks for it.
 */
export const CREATOR_TEAM_ROLE = "creator";

/** Every tier a Member+ hears — DD-016's three, widest last. */
const ALL_TIERS: readonly CommentVisibility[] = COMMENT_VISIBILITIES;

/**
 * What a Contributor hears: the working group's conversation and the
 * one the requester is in, and nothing said in front of lawyers only.
 */
const WORKING_TIERS: readonly CommentVisibility[] = ["working_team", "full_thread"];

/** The contracts one person holds a `contract_team` row on, whatever
 * role that row carries. Both halves of the reach rule ask this — the
 * CTR-021 Contributor grant, and DD-014's named team — so they ask it
 * once. */
function contractsTheyAreOn(db: Executor, user: AuthenticatedUser): SQL {
  return inArray(
    contracts.id,
    db
      .select({ contractId: contractTeam.contractId })
      .from(contractTeam)
      .where(eq(contractTeam.userId, user.id)),
  );
}

/**
 * How far one viewer sees across the contract table (CTR-021, DD-014).
 *
 * An Administrator sees every contract, confidential or not, so nothing
 * narrows and this answers `undefined` — which drops out of the
 * `and(...)` it is composed into. DD-014 states that as a rule with no
 * exception: an Administrator who must be walled off from a record needs
 * a role change, not a per-record carve-out.
 *
 * A Contributor sees exactly the contracts they hold a `contract_team`
 * row on, whichever role that row carries: DD-015 makes the Contributor
 * grant per-record, and adding someone to the team is the act that
 * grants it. Confidentiality adds nothing to their answer — the row it
 * would ask for is the row they already had to have — so the flag never
 * widens anybody's access.
 *
 * A Legal Team Member read every contract until M10, and the flag is the
 * one thing that takes one away. They reach a confidential contract when
 * they hold a team row on it or are its Owner (`manager_id`), and reach
 * every contract that is not confidential as before. The Owner clause is
 * what stops a contract vanishing from the one person accountable for
 * it.
 *
 * A Business User reaches no contract at all until intake links a
 * requester to a record (M19–M21). Every contract surface refuses them
 * at the guard, and this says the same thing again where no future route
 * can get past it — each role is answered here on purpose, so a role
 * added later cannot fall through into somebody else's grant.
 *
 * The same predicate serves every reader. The contract list filters on
 * it, so a Contributor's list is their work and not the whole company's;
 * the record read applies it beside the number, so a contract they
 * cannot reach 404s exactly as a contract that does not exist; the
 * comment and activity routes apply it beside the id. One predicate is
 * what keeps those answers from drifting apart — and it is read live on
 * every request, so taking somebody's last team row off ends their reach
 * on the next one.
 */
export function contractTeamScope(db: Executor, user: AuthenticatedUser): SQL | undefined {
  switch (user.role) {
    case "administrator":
      return undefined;
    case "legal_team_member":
      return or(
        eq(contracts.isConfidential, false),
        contractsTheyAreOn(db, user),
        eq(contracts.managerId, user.id),
      );
    case "contributor":
      return contractsTheyAreOn(db, user);
    case "business_user":
      return sql`false`;
    default: {
      // A role with no case would fall off the end and answer
      // `undefined` — the Administrator's whole-table grant. This makes
      // the compiler refuse that instead: a role added to the union
      // must be answered here before the build passes.
      const unanswered: never = user.role;
      throw new Error(`No contract reach rule for role: ${unanswered}`);
    }
  }
}

/**
 * **The one sentence a contract out of reach is refused in** (DD-014).
 *
 * It is defined once, here beside the rule that decides reach, because
 * it is part of the security interface rather than copy: a contract this
 * viewer may not see has to read exactly as one that was never created,
 * so every surface that refuses one — the record, its paper, its
 * folders, its approvals, its envelopes — must answer in the same words
 * as well as with the same status. A second copy anywhere is a second
 * sentence somebody can reword, and the reword is the leak.
 */
export const NO_CONTRACT = "No contract exists with this number.";

/**
 * One contract this viewer reaches, in the columns the routes ask it
 * for.
 *
 * It is the union of what the modules each used to select for
 * themselves. They are all columns of `contracts` and no join carries
 * them, so answering the whole set costs one row either way — and one
 * shape is what lets the reach read be written once.
 */
export interface ReachedContract {
  id: string;
  /** CTR-003's reference, the number the caller asked by. */
  number: number;
  title: string;
  /** SET-003's soft delete: a time freezes the record (CTR-021). */
  archivedAt: Date | null;
  /** CTR-004's Owner. */
  managerId: string | null;
  /** CTR-014's instrument, or NULL on a record with no paper yet. */
  primaryDocumentId: string | null;
  /** DD-014's flag, as it stands on this row. */
  isConfidential: boolean;
  /** CTR-006's end of term, or NULL where none is recorded — and always
   * NULL on an evergreen contract, which has no end. Two of the three
   * dates the CTR-009 deadline union is built from are this column and
   * the one below it, so the reach read carries them for the reason it
   * carries the rest: they are columns of `contracts`, no join brings
   * them, and one shape is what keeps the reach read written once. */
  expiryDate: string | null;
  /** CTR-006's action window before expiry, in days. The union's third
   * date — the notice deadline — is this subtracted from the expiry, and
   * it is stored nowhere. */
  noticePeriodDays: number | null;
}

/** The witness a {@link LockedContract} carries. It is `declare`d and
 * never assigned, so nothing outside this module can write the property
 * and no value can claim the lock without having taken it. */
declare const contractRowLockHeld: unique symbol;

/**
 * A contract this viewer reaches **and** whose row this caller holds the
 * `FOR UPDATE` lock on.
 *
 * The brand carries no data. It exists so that "the caller must already
 * hold the owning contract's row lock" can be a parameter type instead
 * of a comment: {@link findOrCreateFolderPath} asks for one, and a
 * caller that skipped the lock has nothing to hand it. Only
 * {@link reachedContract} with `lock: true` mints one, and that is the
 * call that takes the lock — so the type cannot be true and the lock
 * absent.
 */
export type LockedContract = ReachedContract & { readonly [contractRowLockHeld]: true };

/**
 * One contract this viewer reaches, by its CTR-003 number, or `null` —
 * **the one read every contract-shaped route starts from**.
 *
 * The scope rides beside the number rather than being asked after it, so
 * a contract the viewer cannot reach is not distinguishable from one
 * that was never created: the same row count, the same query, and — when
 * the caller turns `null` into a refusal — the same {@link NO_CONTRACT}
 * sentence. It is read live on every request, so taking somebody's last
 * team row off ends their reach on the next one.
 *
 * `lock` holds the row for the write that follows, and that lock is the
 * convergence mechanism every mutation on a record's paper, folders,
 * approvals, and envelopes serializes behind: the checks and the write
 * cannot be split by another writer. It is only offered on a
 * {@link Transaction}, because `FOR UPDATE` taken on a pooled handle is
 * released by its own statement's commit — a lock in name only. What
 * comes back is branded {@link LockedContract}, so a helper that needs
 * the lock can ask for the proof rather than trust a comment.
 *
 * Whether an archived record is refused is the caller's to say and not
 * asked here (CTR-021): a frozen contract still reads, and each write
 * that refuses one names the act it is refusing in its own words.
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
      expiryDate: contracts.expiryDate,
      noticePeriodDays: contracts.noticePeriodDays,
    })
    .from(contracts)
    .where(and(eq(contracts.number, number), contractTeamScope(db, user)))
    .limit(1);
  const [row] = await (options.lock ? query.for("update", { of: contracts }) : query);
  return row ?? null;
}

/**
 * The documents whose owning contract names this person — either by a
 * `contract_team` row or as its Owner (CTR-004).
 *
 * DD-014's audience, said over the `documents` table. It is a subquery
 * on `documents.contract_id` rather than a join, so that every read of a
 * document can compose it without changing its own `FROM` clause: the
 * record's list joins the uploader, the download joins the version
 * chain, and neither has to take the contract table along to ask this.
 */
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

/**
 * How far one viewer sees across the document table (DD-014, DOC-008) —
 * the per-document flag M10 deferred until `documents` existed.
 *
 * **It composes in front of `contractTeamScope`, and never replaces
 * it.** A viewer must pass both: the contract's gate says whether they
 * reach the record at all, and this says whether they reach one file on
 * a record they already reach. Composing them the other way round would
 * be a widening, and DD-014's flag only ever narrows.
 *
 * An Administrator sees every document on every contract, so nothing
 * narrows and this answers `undefined` — DD-014's no-exception rule, one
 * level down.
 *
 * Everybody else reaches a confidential document when the owning
 * contract names them: a `contract_team` row of any role, or the Owner
 * clause CTR-022 added. A document that is not confidential is reached
 * by whoever reaches its contract, exactly as before. For a Contributor
 * this adds nothing at all — the team row the flag asks for is the row
 * they already had to hold to reach the contract — which is the flag
 * never widening anybody's access, said again where it could go wrong.
 *
 * A Business User reaches no contract, so they reach no document. It is
 * answered here anyway, for the reason the contract scope gives: a role
 * added to the union later must be answered in both scopes before the
 * build passes, rather than falling through into a grant.
 *
 * The same predicate serves every reader — the record's document list,
 * the section count that is taken from it, the download, and every
 * mutation. One predicate is what makes silent omission true rather than
 * intended: a document this viewer may not see never leaves the
 * database, so no list, count, or refusal can say it is there.
 */
export function documentAudienceScope(db: Executor, user: AuthenticatedUser): SQL | undefined {
  switch (user.role) {
    case "administrator":
      return undefined;
    case "legal_team_member":
    case "contributor":
      return or(eq(documents.isConfidential, false), namedOnTheOwningContract(db, user));
    case "business_user":
      return sql`false`;
    default: {
      const unanswered: never = user.role;
      throw new Error(`No document reach rule for role: ${unanswered}`);
    }
  }
}

/**
 * The DD-016 tier predicate, as a pure function of the viewer's role and
 * their standing on the record. Legal Only admits Administrators and
 * Legal Team Members. Working Team adds Contributors on that contract.
 * Full Thread adds the originating Business User, who has no link to a
 * contract until intake lands (M19–M21) — so it has no third audience
 * yet, and a Business User hears nothing here.
 *
 * An empty answer means this viewer is in no room on this record. That
 * is a real state, not an error: it reads as a record with no
 * conversation, which is exactly what it is for them.
 *
 * The same list answers both directions. A viewer posts into the rooms
 * they are in and no others, so read and write share one rule rather
 * than two that could disagree.
 *
 * `onTeam` is not read for Member+ — they hear every tier on every
 * contract they reach. M10's confidentiality gate turns on that same
 * fact, but it does so in `inNamedAudience` below: reach and tier stay
 * two questions, and this one answers only the second.
 */
export function readableTiers(role: UserRole, onTeam: boolean): readonly CommentVisibility[] {
  if (role === "administrator" || role === "legal_team_member") return ALL_TIERS;
  if (role === "contributor" && onTeam) return WORKING_TIERS;
  return [];
}

/** Where one person stands on one contract, as the answer below needs
 * it stated: on its team, named as its Owner, or neither. */
interface Standing {
  role: UserRole;
  onTeam: boolean;
  isOwner: boolean;
}

/**
 * Whether one person is inside a walled-off thing's audience —
 * `contractTeamScope`'s rule said over a person instead of over the
 * rows.
 *
 * The row scope answers "which records does this viewer reach"; this
 * answers "which people does this record reach". They are the same
 * sentence read from either end, and they are written next to each other
 * so that the typeahead can never offer somebody the record itself would
 * answer 404 to.
 *
 * One function serves both levels of DD-014's flag. A confidential
 * contract and a confidential document have the same audience — the
 * contract's named team, the contract's Owner, and Administrators — so
 * they are one rule asked twice rather than two rules that could drift.
 * `isConfidential` is whichever flag is being asked about; `person` is
 * always their standing on the **owning contract**, because a document
 * has no team of its own (DOC-008).
 */
function inNamedAudience(person: Standing, isConfidential: boolean): boolean {
  switch (person.role) {
    case "administrator":
      return true;
    case "legal_team_member":
      return !isConfidential || person.onTeam || person.isOwner;
    // The team row is the Contributor's whole grant, and it satisfies
    // the flag too — so confidentiality adds nothing to their answer.
    case "contributor":
      return person.onTeam;
    case "business_user":
      return false;
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
  /** The contract's id, re-read here rather than trusted from the client. */
  contractId: string;
  /** The tiers this viewer hears on it; never empty. */
  tiers: readonly CommentVisibility[];
  /**
   * Whether this viewer is inside the audience of a **confidential
   * document** on this record (DD-014, DOC-008) — an Administrator, or
   * somebody the contract names by a team row or as its Owner.
   *
   * It is one fact about a person and a record, so it is read here with
   * the reach answer rather than asked again per row. The feed is what
   * consumes it: an entry naming a document this viewer may not see must
   * be left out of their page, and a per-entry lookup would be the same
   * question asked twenty-five times with twenty-five chances to differ
   * from the document list's own answer.
   */
  seesConfidentialDocuments: boolean;
}

/**
 * The whole answer in one read: the contract this viewer reaches, and
 * the tiers they hear on it. `null` means there is nothing here for
 * them — the contract does not exist, or it does and they are not on it,
 * or they are on it and in no room. Every one of those answers 404, so
 * a record a viewer cannot reach is indistinguishable from one that was
 * never created.
 */
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
      /** CTR-004's Owner, for the document audience below. */
      managerId: contracts.managerId,
    })
    .from(contracts)
    .where(and(eq(contracts.id, contractId), contractTeamScope(db, user)))
    .limit(1);
  if (!row) return null;
  const tiers = readableTiers(user.role, row.onTeam);
  if (tiers.length === 0) return null;
  return {
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

/**
 * The activity entries a viewer outside a confidential document's
 * audience must not be shown (DD-014, DD-017).
 *
 * An entry that names a document they may not see would leak the
 * document's existence, its title, and often what was just done to it —
 * every payload in the documents module carries the title on purpose, so
 * that the record still says what was erased. So the entry is omitted,
 * not redacted: the feed must read for them exactly as it would if the
 * document had never been uploaded.
 *
 * It filters at query time, like every other tier and reach rule here,
 * so an omitted entry never leaves the database and no page count can
 * announce that something was left out.
 *
 * `undefined` for a viewer already inside the audience — an
 * Administrator, or somebody the contract names — which drops out of the
 * `and(...)` it composes into.
 *
 * The match is on the payload's own document keys — `documentId`, and
 * `fromDocumentId` where a pin move names the document the designation
 * left (CTR-014). **Every document an entry names must pass**, because
 * the entry carries a title for each one it names: a pin move whose new
 * primary is open but whose old primary is walled off would otherwise
 * ride into an outsider's feed with the walled file's title in `from`.
 * An entry that carries neither key is left alone: it is not about a
 * document, so no rule here reaches it.
 *
 * **An entry naming a document that is no longer there is hidden too**,
 * and that is the decision rather than an accident. DOC-010's hard
 * delete removes the row, so after it there is nothing left to ask
 * whether the file was confidential — and every one of those entries
 * still carries its title. A rule that guessed "it must have been open"
 * would hand an outsider the whole story of a walled-off file the moment
 * it was erased, which is the leak the flag exists to prevent, delivered
 * late.
 *
 * The cost is stated plainly: after an erasure, a viewer the contract
 * does not name loses the story of an **open** document too. That is
 * over-hiding rather than leaking, it is bounded to the rarest act in
 * the product, and DOC-010's own accountability surface — the
 * Administrator's audit log, which reads the table with no record scope
 * — is untouched by any of this. The alternative was a marker written
 * into the erasure's payload and read back by a self-join, which is a
 * rule a later writer can forget to keep, and forgetting it would be
 * silent.
 */
export function confidentialDocumentEntryScope(
  audience: ContractAudience,
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

/**
 * What one viewer may do to one contract's Confidential flag.
 *
 * Three answers rather than a boolean, because the two refusals are not
 * the same refusal and the caller must not have to invent the
 * difference. `unreachable` is answered as a missing record — the same
 * 404 the record read gives, so a write leaks no more than a read.
 * `refused` is a plain 403: this viewer can already see the record, so
 * telling them it exists tells them nothing, and a 404 here would only
 * make a real permission boundary look like a bug.
 */
export type ConfidentialityWrite = "allowed" | "refused" | "unreachable";

/** The three facts about a contract the questions below turn on, as
 * every mutation already holds them on the row it locked. A
 * {@link LockedContract} carries all three, so a caller that took the
 * lock through {@link reachedContract} can pass it straight in; a caller
 * that locked the row its own way passes whatever it read. */
export interface LockedContractFacts {
  id: string;
  /** CTR-004's Owner. */
  managerId: string | null;
  isConfidential: boolean;
}

/** Every `contract_team` role one person holds on one contract, read
 * live. Every question below is built on it: reach asks whether there
 * is any row at all, and the contract flag's actor set asks whether one
 * of them is `creator`. The document questions ask it of the **owning**
 * contract, because that is where a document's team is (DOC-008). */
async function standingOn(
  db: Executor,
  user: AuthenticatedUser,
  contractId: string,
  managerId: string | null,
): Promise<{ standing: Standing; held: { role: string }[] }> {
  const held = await db
    .select({ role: contractTeam.role })
    .from(contractTeam)
    .where(and(eq(contractTeam.contractId, contractId), eq(contractTeam.userId, user.id)));
  return {
    standing: {
      role: user.role,
      onTeam: held.length > 0,
      isOwner: managerId === user.id,
    },
    held,
  };
}

/**
 * Whether one viewer reaches one contract the caller already holds
 * locked — the row scope's rule, asked about a row instead of used to
 * choose rows.
 *
 * Every contract mutation asks this (CTR-021, DD-014). Member+ was a
 * sufficient grant until M10, so the locked read that starts each
 * mutation carried no row scope at all; the Confidential flag is the one
 * thing that takes a contract away from a Legal Team Member, and a write
 * must leak no more than a read.
 *
 * It is asked **after** the row lock and inside the same transaction,
 * which is what makes it a decision rather than a guess. The contract
 * row is held, so a concurrent flag change cannot land between this and
 * the write; the team rows are read live under that same lock, and every
 * route that changes them takes the same lock, so a team row removed a
 * moment ago is already gone from this answer.
 *
 * Folding the row scope into the locked `SELECT` instead would read as
 * tidier and would be harder to hold. That `SELECT` is a qualification
 * Postgres re-checks against the row it waited for, under rules subtle
 * enough that a refusal would be hard to tell from a bug; two plain
 * statements under a lock the caller already holds are not.
 */
export async function reachesLockedContract(
  db: Executor,
  user: AuthenticatedUser,
  contract: LockedContractFacts,
): Promise<boolean> {
  const { standing } = await standingOn(db, user, contract.id, contract.managerId);
  return inNamedAudience(standing, contract.isConfidential);
}

/**
 * Who may wall a contract off, and who may open it again (DD-014,
 * extended by CTR-022).
 *
 * Three actors: an Administrator, the person who made the record (its
 * `creator` team row), and its Owner. DD-014 named the first two; CTR-022
 * adds the Owner, on the ground that the person accountable for a
 * contract is the person who should be able to decide its audience —
 * the same extension that keeps a confidential contract visible to its
 * own Owner.
 *
 * Being on the team is not enough. A team Member reads the record, works
 * on it, and comments on it, and none of that is a claim on who else may
 * see it.
 *
 * Reach is asked first, and with the same rule every read uses, so the
 * write path cannot answer a question the read path would have refused
 * to admit was there.
 */
export async function confidentialityWrite(
  db: Executor,
  user: AuthenticatedUser,
  contract: LockedContractFacts,
): Promise<ConfidentialityWrite> {
  const { standing, held } = await standingOn(db, user, contract.id, contract.managerId);
  if (!inNamedAudience(standing, contract.isConfidential)) return "unreachable";
  const isCreator = held.some((row) => row.role === CREATOR_TEAM_ROLE);
  return standing.role === "administrator" || standing.isOwner || isCreator ? "allowed" : "refused";
}

/** The four facts about a document the flag's two questions turn on, as
 * the mutation already holds them on the row it read under the owning
 * contract's lock. */
export interface LockedDocument {
  /** DOC-008's owning record — the only place a document's team is. */
  contractId: string;
  /** The owning contract's Owner (CTR-004). */
  contractManagerId: string | null;
  /** Who uploaded the document. It is DD-014's "the creator", one level
   * down: a document is made by one act with one actor, so it is a
   * column rather than a team row. */
  createdBy: string;
  /** The document's own flag, not the contract's. */
  isConfidential: boolean;
}

/**
 * Who may wall one document off, and who may open it again (DD-014,
 * CTR-022, DOC-008).
 *
 * Three actors, mirroring the contract's: an Administrator, the person
 * who uploaded the document, and the **owning contract's** Owner. The
 * middle one is a column here rather than a `creator` team row, because
 * a document has no team of its own — an upload is one act with one
 * actor, and `created_by` records it.
 *
 * The two refusals are the contract's two refusals, for the contract's
 * reasons. `unreachable` is a viewer outside the document's audience,
 * answered as a document that was never uploaded. `refused` is a viewer
 * who can already see the document but may not decide who else does: a
 * 404 there would hide nothing and would read as a bug.
 *
 * The caller has already answered the **contract's** gate — this is the
 * second question, not a replacement for the first — so what is asked
 * here is only the document's own flag.
 */
export async function documentConfidentialityWrite(
  db: Executor,
  user: AuthenticatedUser,
  document: LockedDocument,
): Promise<ConfidentialityWrite> {
  const { standing } = await standingOn(db, user, document.contractId, document.contractManagerId);
  if (!inNamedAudience(standing, document.isConfidential)) return "unreachable";
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

/**
 * Everyone a comment on one contract can reach (CMT-007) — the
 * typeahead's list, and the set the seam checks a posted mention
 * against.
 *
 * It is the reach rule and the tier predicate run over the people rather
 * than over the rows: a person belongs here when the record reaches them
 * and they hear at least one tier on it. On an open contract that is
 * every Member+, on the team or not — CTR-021 already lets them open it.
 * A Contributor is here only with a `contract_team` row, which is the
 * act that grants their access; mentioning somebody does not grant it,
 * so a Contributor off the team is not offered and a mention of them is
 * refused.
 *
 * On a confidential contract the list narrows to the named team, the
 * Owner, and Administrators — automatically, because it is the same rule
 * the row scope applies, and CMT-007 wanted exactly that set. No
 * endpoint changes, and no confirmation offers to add anybody: DES-009's
 * add-as-watcher clause is superseded here.
 *
 * Anyone who hears nothing is left out rather than offered and refused.
 * A name in a typeahead that no tier can reach is the trap the
 * promotion confirmation exists to avoid.
 *
 * Archived people are out: they have left, and addressing a question to
 * them reaches nobody (SET-005).
 *
 * `only` narrows the read to a handful of ids. The typeahead wants the
 * whole list; a post that names three people wants three rows, not the
 * directory. Both take the same answer, which is the point — one rule
 * decides who the list offers and who a post may name.
 */
export async function contractMentionCandidates(
  db: Executor,
  contractId: string,
  only?: readonly string[],
): Promise<MentionCandidate[]> {
  // The two facts about the record the reach rule turns on. A record
  // that is not there reaches nobody, which is the same answer its own
  // 404 gives.
  const [record] = await db
    .select({ isConfidential: contracts.isConfidential, managerId: contracts.managerId })
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
    const standing = { role: row.role, onTeam: row.onTeam, isOwner: row.id === record.managerId };
    if (!inNamedAudience(standing, record.isConfidential)) return [];
    const tiers = readableTiers(row.role, row.onTeam);
    if (tiers.length === 0) return [];
    return [{ id: row.id, displayName: row.displayName, image: row.image, tiers }];
  });
}
