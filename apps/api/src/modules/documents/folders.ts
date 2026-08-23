// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A contract's folders (M13/2) — the optional grouping DOC-006 puts
 * inside a record and nowhere else. A Legal Team Member creates one,
 * renames it, moves it under a different parent, and deletes it, and the
 * whole set is read in one go so the Documents section can draw the tree
 * from a single answer.
 *
 * **Folders live on the record and only on the record** (DOC-006). There
 * is no global tree: the repository view stays flat and folder becomes a
 * filter facet there (M26). So the routes are a sub-resource of the
 * contract, and a folder's id is only ever meaningful beside the record
 * that owns it.
 *
 * **Deleting a folder dissolves it; it destroys nothing.** Its child
 * folders and the documents filed in it are re-filed into the deleted
 * folder's parent — the record root when it had none — and the row goes.
 * Destroying a document is DOC-010's job and is reached from that
 * document.
 *
 * **Three invariants, enforced here rather than by the database**
 * (DOC-008's pattern):
 *
 * 1. A folder and its parent share one owning record. A parent on
 *    another contract is answered exactly as a parent that was never
 *    created, because a folder's id says nothing about which record it
 *    is on.
 * 2. The parent chain never cycles. A move that would put a folder
 *    inside itself, or inside one of its own descendants, is refused.
 * 3. Sibling names are unique within their parent, compared without
 *    case. That is the one that makes a folder drop's find-or-create
 *    deterministic (DOC-011, M13/4): two drops racing on one path have
 *    to converge on one folder rather than manufacture two.
 *
 * All three are decided from **one read of the record's whole folder
 * set, taken under the owning contract's row lock** — the same lock a
 * version number is assigned under. A record's folder set is small, so
 * the tree is built in memory and every question is asked of it there:
 * one read answers reach, the parent, the cycle, the sibling names, and
 * the depth together, and nothing can change underneath between the
 * question and the write. The two partial unique indexes on the table
 * stand behind invariant 3 as the database's own last word.
 *
 * **Access is inherited and nothing is held here** (DOC-008, DD-014).
 * Every route answers the owning contract's reach question first, with
 * `contractTeamScope` — the same predicate the record, its paper, its
 * comments, and its feed are read through — so a viewer who cannot
 * reach the contract is answered exactly as for a contract that was
 * never created, on the list and on every write alike. Writes are
 * Member+: a Contributor reads the tree and is refused plainly, because
 * they can already see the record and a 404 would make a real boundary
 * read as a bug. An archived contract refuses folder writes as it
 * refuses new paper — organization is part of what a frozen record
 * freezes.
 *
 * **A folder carries no confidentiality flag of its own** (DES-033). Its
 * name is visible to everyone who reaches the record; what DD-014
 * narrows is the documents filed in it. So every folder answers a
 * `documentCount`, and that count is **scoped to the viewer asking**,
 * taken through `documentAudienceScope` — the one predicate every
 * document read already passes through. A confidential document a viewer
 * is outside the audience of is left out of the folder's listing and out
 * of its count together, which is what makes the omission silent rather
 * than announced: an "empty" folder may be a folder whose contents this
 * viewer cannot see, and nothing here distinguishes the two.
 *
 * **A dissolved folder's documents move with its child folders** (M13/3).
 * The re-file is a fact about the record's organization rather than a
 * read, so it is **not** viewer-scoped: every document in the folder
 * moves, the archived ones and the ones the deleter is outside the
 * audience of included. Leaving one behind would orphan a row against a
 * folder that no longer exists.
 *
 * **Manual folder work is narrated** (DD-017). Create, rename, move, and
 * delete each append one record-tier entry on the owning contract, and
 * each payload carries the folder's name — so the entry still says what
 * happened after a later rename or delete has taken the row's name away.
 * A folder that a bulk drop find-or-creates writes none: the drop's
 * story is its uploads, not its traversal.
 *
 * **A folder drop addresses a chain by path** (M13/5, DOC-011).
 * {@link findOrCreateFolderPath} walks a relative path segment by
 * segment and creates what is missing, and it is the same act whether an
 * upload carries the path or a create route is asked for an empty
 * directory. It runs **under the owning contract's row lock**, on the
 * same one-read tree the invariants above are decided from, which is
 * what makes N uploads racing on one path converge on one folder rather
 * than manufacture N of them: the second request waits at the lock and
 * then reads the folder the first one wrote.
 *
 * Its sibling comparison is {@link assertNameFree}'s own, because it has
 * to be — a path segment that differed only in case from a folder
 * already there would otherwise either duplicate the folder or hit the
 * partial unique index behind it.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  asc,
  contracts,
  count,
  documentFolders,
  documents,
  eq,
  isNotNull,
  isNull,
  matters,
  or,
  MAX_FOLDER_NAME_LENGTH,
  sql,
  type Executor,
  type Matter,
  type Transaction,
} from "@openlaw/db";
import { requireRole, type AuthenticatedUser } from "../../auth/guards.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import {
  contractTeamScope,
  documentAudienceScope,
  NO_CONTRACT,
  reachedContract,
  type LockedContract,
  type ReachedContract,
} from "../../lib/contract-access.js";
import {
  matterTeamScope,
  NO_MATTER,
  reachedMatter,
  type LockedMatter,
} from "../../lib/matter-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";

/** The contract read floor (CTR-021), which is the folder read floor
 * too: a Contributor on the team sees the tree the record's paper is
 * filed in. The role alone opens nothing — the reach predicate narrows
 * it to the records they hold a `contract_team` row on. */
const requireFolderReader = requireRole("administrator", "legal_team_member", "contributor");

/** Organizing a record's paper is Member+ in M13, as putting paper on it
 * is: a Contributor reads the tree, and their write grid arrives with
 * M23 (DD-015). */
const requireMember = requireRole("administrator", "legal_team_member");

/**
 * A folder on a contract this viewer cannot reach answers exactly as
 * `NO_CONTRACT` has the record itself answer. Its own id says nothing
 * about which record it belongs to, so a refusal here would be the leak
 * the 404 exists to prevent.
 *
 * Exported because the document routes refuse a folder too — a filing
 * into another record's folder, and a folder-filtered read of one
 * (M13/3). The two refusals have to be one refusal, so they share the
 * sentence rather than each holding a copy of it.
 */
export const NO_FOLDER = "No folder exists with this reference.";

/**
 * How deep the tree may go, counting the record root's own folders as
 * level 1.
 *
 * Generous rather than tight: a legacy book arrives as somebody's drive
 * folder, and refusing a drop for a structure a filesystem was happy
 * with helps nobody. It is a bound and not a preference — the tree is
 * walked in memory on every write, and a tree with no ceiling is a tree
 * one bad import can make unreadable. Widening it later is safe;
 * narrowing it later would strand folders the rule no longer allows.
 */
const MAX_FOLDER_DEPTH = 10;

/**
 * The one separator a folder path is written with (DOC-011).
 *
 * One rather than two: a folder name may hold neither slash
 * ({@link folderName}), so a Windows-shaped path arrives as a name that
 * breaks the rules and is refused as one, rather than being guessed at.
 */
const PATH_SEPARATOR = "/";

/**
 * The longest a folder path may be as a string, before it is a path.
 *
 * A body and a form field are both text before anything reads them, so
 * the bound is stated once and applied to both. It is the deepest chain
 * the tree allows, each segment at a folder name's own ceiling, plus its
 * separators — so no path the rules would accept can hit it.
 */
export const MAX_FOLDER_PATH_LENGTH = MAX_FOLDER_DEPTH * (MAX_FOLDER_NAME_LENGTH + 1);

/** One folder as the tree is drawn from it. */
interface FolderRow {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FolderOwner {
  type: "contract" | "matter";
  id: string;
}

function folderOwner(owner: string | FolderOwner): FolderOwner {
  return typeof owner === "string" ? { type: "contract", id: owner } : owner;
}

/**
 * Every folder on one contract, siblings in the order they are drawn.
 *
 * Ordered by name without case, which is how a file manager lists a
 * directory and what DES-033 draws: `display_order` is deferred with the
 * reorder surface that would read it. The id breaks a tie between two
 * names that differ only in case, so the order is total and the same
 * answer comes back twice.
 *
 * The whole set, never one level: the section draws the tree from one
 * read, and every invariant below is asked of the same set.
 */
async function foldersOf(db: Executor, owner: string | FolderOwner): Promise<FolderRow[]> {
  const record = folderOwner(owner);
  return db
    .select({
      id: documentFolders.id,
      name: documentFolders.name,
      parentId: documentFolders.parentId,
      createdAt: documentFolders.createdAt,
      updatedAt: documentFolders.updatedAt,
    })
    .from(documentFolders)
    .where(
      record.type === "contract"
        ? eq(documentFolders.contractId, record.id)
        : eq(documentFolders.matterId, record.id),
    )
    .orderBy(asc(sql`lower(${documentFolders.name})`), asc(documentFolders.id));
}

/**
 * A name, checked once and refused one rule at a time.
 *
 * Trimmed, because a name with an edge space sorts and compares as a
 * name nobody typed. Non-empty, because a folder with no name cannot be
 * pointed at. Bounded at the filesystem's own ceiling, because a folder
 * is created from a directory name as often as it is typed (DOC-011).
 * Free of the path separator, because a folder drop addresses a chain by
 * path and a name holding a separator could not be one segment of one.
 * And never `.` or `..`, for the same reason one step further on: those
 * two are the names a path is written with rather than names a path can
 * carry, so a folder called `..` is a folder no `folderPath` could ever
 * address (#227).
 *
 * That last rule is refused **here** and not beside the path parser, and
 * that is the whole point of it. It used to live only in
 * {@link folderPathSegments}, so a name the drop route refused was a
 * name the create route took — and what a person typed could be a folder
 * no drop could ever file into. The set of legal folder names has to be
 * one set, or the two routes describe two different trees.
 *
 * They are refused rather than resolved. Nothing here touches a
 * filesystem — a storage key is minted from two ids and never from a
 * name — so they were never an escape, and resolving them would invent
 * navigation a record's folder set does not have.
 *
 * Exported because a dropped path's segments are folder names and are
 * held to exactly these rules (M13/5). One copy of them, so a directory
 * a drop creates could equally have been typed.
 */
export function folderName(raw: string): string {
  const name = raw.trim();
  if (name.length === 0) throw httpError(400, "Give the folder a name.");
  if (name.length > MAX_FOLDER_NAME_LENGTH) {
    throw httpError(400, `A folder name can be at most ${MAX_FOLDER_NAME_LENGTH} characters.`);
  }
  if (name.includes("/") || name.includes("\\")) {
    throw httpError(400, "A folder name cannot contain a slash. Make a folder inside instead.");
  }
  // After the trim, so padding walks around this rule no more than it
  // walks around the empty-name rule above it. The two exact names and
  // nothing wider: `...` and `.hidden` are names somebody meant.
  if (name === "." || name === "..") {
    throw httpError(400, "A folder cannot be named . or .. — those address a path, not a folder.");
  }
  return name;
}

/**
 * A relative folder path, as its segments (M13/5, DOC-011).
 *
 * The shape is deliberately strict, because the only thing that sends
 * one is a client walking a dropped directory tree and it can send a
 * clean path. A path that starts or ends with a separator, or holds an
 * empty segment, is a client that built the string badly rather than a
 * person who typed something — so it is refused plainly for that one
 * file, and the rest of the batch carries on.
 *
 * `.` and `..` are refused rather than resolved, and that rule now lives
 * in {@link folderName} where every route reaches it (#227). What stays
 * here is only the **sentence**: a client walking a dropped directory
 * tree is told which segment of its path is wrong, which is what it can
 * act on, rather than being told about a folder name it never typed. So
 * the check below is deliberately redundant with the shared rule, and
 * the shared rule is the one that decides.
 *
 * Every segment is a folder name and goes through {@link folderName}, so
 * a drop can create nothing that could not have been typed — and, since
 * #227, nothing that could be typed is refused only here.
 */
export function folderPathSegments(raw: string): string[] {
  const path = raw.trim();
  if (path.length === 0) return [];
  if (path.startsWith(PATH_SEPARATOR) || path.endsWith(PATH_SEPARATOR)) {
    throw httpError(400, "A folder path cannot start or end with a slash.");
  }
  const parts = path.split(PATH_SEPARATOR);
  // The count first, before a single segment is looked at, and before a
  // byte of the file has been read: a path this deep is refused on its
  // own shape whatever it is dropped onto, and refusing it here means a
  // thousand-segment path costs a split rather than a thousand checks.
  // The chain is asked about again under the lock, where where it lands
  // is known.
  assertDepthWithin(parts.length);
  return parts.map((segment) => {
    if (segment.trim().length === 0) {
      throw httpError(400, "A folder path cannot have an empty segment.");
    }
    if (segment.trim() === "." || segment.trim() === "..") {
      throw httpError(400, "A folder path cannot contain a . or .. segment.");
    }
    return folderName(segment);
  });
}

/** How the tree is read: every folder by its id, and every folder's
 * children by their parent's. Built once per write from the one read the
 * lock protects. */
interface Tree {
  byId: Map<string, FolderRow>;
  children: Map<string | null, FolderRow[]>;
}

function treeOf(rows: readonly FolderRow[]): Tree {
  const byId = new Map<string, FolderRow>();
  const children = new Map<string | null, FolderRow[]>();
  for (const row of rows) {
    byId.set(row.id, row);
    const siblings = children.get(row.parentId);
    if (siblings) siblings.push(row);
    else children.set(row.parentId, [row]);
  }
  return { byId, children };
}

/** One row put into a tree already built, so a chain being created
 * segment by segment sees what the segment before it made. */
function addToTree(tree: Tree, row: FolderRow): void {
  tree.byId.set(row.id, row);
  const siblings = tree.children.get(row.parentId);
  if (siblings) siblings.push(row);
  else tree.children.set(row.parentId, [row]);
}

/**
 * **The one answer to "is this folder on this record"** (DOC-008), as a
 * row of the contract's own tree.
 *
 * Invariant 1: a folder and its parent share one owning record. It holds
 * because the tree was read for **this** contract — so a folder on
 * another record is simply not in it, and is answered exactly as one
 * that was never created. A folder's id says nothing about which record
 * it belongs to, so any other refusal would say that the folder is
 * there.
 *
 * Every question of that shape is asked here: the parent a folder write
 * names, the base a drop's path hangs from, the folder a document is
 * filed into, and the folder a listing is narrowed to. They were two
 * implementations until #254 — this one over the tree the caller read
 * under the contract's row lock, and a second one that went straight to
 * the table — and two implementations of one refusal are two chances for
 * the answers to differ.
 *
 * `null` in is the record root, which is not a folder and is answered as
 * itself rather than refused.
 */
function folderIn(tree: Tree, folderId: string | null): FolderRow | null {
  if (folderId === null) return null;
  const folder = tree.byId.get(folderId);
  if (!folder) throw httpError(404, NO_FOLDER);
  return folder;
}

/**
 * {@link folderIn} for a caller that holds no tree — the document
 * routes, which reach a folder by id and never draw the whole thing.
 *
 * It reads the record's folders and asks the same question of them, so
 * the filing path and the folder routes refuse an outsider's folder in
 * one place and one sentence. The read is the whole set because that is
 * what the tree is built from; a record's tree is bounded by
 * {@link MAX_FOLDER_DEPTH} and by what a person will make by hand, so
 * the cost is one small query either way it is called — under the
 * filing path's lock or on the list's plain read.
 *
 * Answers the folder's name as well as its id, because every activity
 * payload that mentions a folder carries the name rather than the id:
 * the entry has to still say what happened after a rename or a delete.
 */
export async function folderOnRecord(
  db: Executor,
  owner: string | FolderOwner,
  folderId: string,
): Promise<{ id: string; name: string }> {
  // Never `null`: `folderId` is a real id, so `folderIn` either answers
  // a row of this record's tree or refuses.
  const folder = folderIn(treeOf(await foldersOf(db, owner)), folderId)!;
  return { id: folder.id, name: folder.name };
}

/** How deep a folder sits, counting the record root's own folders as
 * level 1. The walk is bounded by the tree's size, so a chain the write
 * path somehow let cycle cannot spin here. */
function depthOf(tree: Tree, folder: FolderRow | null): number {
  let depth = 0;
  let at = folder;
  while (at && depth <= tree.byId.size) {
    depth += 1;
    at = at.parentId === null ? null : (tree.byId.get(at.parentId) ?? null);
  }
  return depth;
}

/**
 * How many levels hang below a folder — 0 for one with no children.
 *
 * A move carries its whole subtree, so this is what the depth ceiling
 * has to be asked about rather than the moved row alone.
 *
 * Bounded by the tree's own size, as the two walks above it are: the
 * write path refuses a cycle, and code that trusted that without a bound
 * would answer a stack overflow rather than a refusal if a row ever got
 * past it.
 */
function heightBelow(tree: Tree, folderId: string, remaining = tree.byId.size): number {
  if (remaining <= 0) return 0;
  const children = tree.children.get(folderId) ?? [];
  let height = 0;
  for (const child of children) {
    height = Math.max(height, 1 + heightBelow(tree, child.id, remaining - 1));
  }
  return height;
}

/**
 * The sibling of one parent that reads as this name, or nothing.
 *
 * **The one comparison** invariant 3 and find-or-create both ask, so
 * they cannot drift: a path segment that differs only in case from a
 * folder already there finds that folder rather than trying to make a
 * second one. Without case, because that is the same reading the sort
 * takes (DES-033) — two siblings that read as the same word may not both
 * exist.
 */
function siblingNamed(tree: Tree, parentId: string | null, name: string): FolderRow | undefined {
  const wanted = name.toLowerCase();
  return (tree.children.get(parentId) ?? []).find(
    (sibling) => sibling.name.toLowerCase() === wanted,
  );
}

/**
 * Invariant 3: sibling names are unique within their parent, compared
 * without case.
 *
 * `except` is the row being renamed or moved, which must not collide
 * with itself.
 */
function assertNameFree(tree: Tree, parentId: string | null, name: string, except?: string): void {
  const taken = siblingNamed(tree, parentId, name);
  if (taken && taken.id !== except) throw httpError(409, `A folder named ${name} is already here.`);
}

/** Invariant 2: the parent chain never cycles. A folder may not be moved
 * inside itself, nor inside anything already under it — the walk up from
 * the new parent must never meet the folder being moved. */
function assertNoCycle(tree: Tree, folderId: string, parent: FolderRow | null): void {
  let at = parent;
  let steps = 0;
  while (at && steps <= tree.byId.size) {
    if (at.id === folderId) {
      throw httpError(409, "A folder cannot be moved inside itself.");
    }
    at = at.parentId === null ? null : (tree.byId.get(at.parentId) ?? null);
    steps += 1;
  }
}

/** The ceiling, in one sentence — said the same way whether a move, a
 * create, or a dropped path is what would break it. */
function assertDepthWithin(depth: number): void {
  if (depth > MAX_FOLDER_DEPTH) {
    throw httpError(409, `Folders can be nested ${MAX_FOLDER_DEPTH} deep. Put this one higher up.`);
  }
}

/** The depth ceiling, asked of where the folder lands and of everything
 * it brings with it. */
function assertDepth(tree: Tree, parent: FolderRow | null, subtreeHeight: number): void {
  assertDepthWithin(depthOf(tree, parent) + 1 + subtreeHeight);
}

/** One folder, as everything outside this module needs it: what to file
 * a document into, and what to call it in an activity payload. */
export interface ResolvedFolder {
  id: string;
  name: string;
}

/**
 * Where a dropped file lands: a folder already on the record, a relative
 * path beneath it, or both (M13/5, DOC-011).
 *
 * The two compose rather than exclude each other, because the drop can
 * carry both: dropping a tree onto a folder row files the tree **inside
 * that row**. `folderId` is the base the gesture landed on — the record
 * root when there is none — and `path` is the chain to find-or-create
 * beneath it.
 */
export interface FolderDestination {
  /** A folder already on this record, or null for the record root. */
  folderId: string | null;
  /** The chain beneath it, already checked segment by segment. Empty
   * means the base itself. */
  path: readonly string[];
}

/**
 * Find-or-creates a folder chain under one record, and answers the
 * folder the file lands in (M13/5, DOC-011).
 *
 * **The caller must already hold the owning contract's row lock**, and
 * the {@link LockedContract} it asks for is the proof. That lock is the
 * whole mechanism: every folder write on one record serializes behind
 * it, so N uploads racing on one path converge on one folder — the
 * second reads the tree the first has committed and finds the segment
 * already there. Without it two of them would both find nothing and both
 * insert, and a legacy book would arrive filed into two folders of one
 * name.
 *
 * That was a sentence in this comment until #254, and a contract id is
 * indistinguishable from an unlocked one — so a third caller could
 * forget the lock and still compile. The brand is minted only by
 * `reachedContract(..., { lock: true })`, which is the call that takes
 * the lock, so the obligation is now the compiler's to enforce.
 *
 * **It writes no activity** (DD-017). A folder a drop creates on its way
 * past is traversal, not an act somebody performed; the drop's story is
 * the `document.created` entries its files leave behind, and each of
 * those names the folder it landed in. A folder created from a control
 * still narrates itself, in the route that offers that control.
 *
 * The invariants are the module's own: the base must be a folder of this
 * record (a folder on another one is not in this tree and is answered
 * exactly as one that never existed), the chain may not pass the depth
 * ceiling, and each segment is matched against its siblings by the same
 * case-insensitive comparison that refuses a duplicate.
 */
export async function findOrCreateFolderPath(
  // A `Transaction`, not any executor: the brand proves the lock was
  // taken, and this parameter is what keeps the tree read and the
  // inserts on the connection that holds it. On a pooled handle they
  // would run outside the lock the brand vouches for.
  tx: Transaction,
  contract: LockedContract | LockedMatter,
  destination: FolderDestination,
): Promise<ResolvedFolder | null> {
  const owner: FolderOwner =
    "matterTypeId" in contract
      ? { type: "matter", id: contract.id }
      : { type: "contract", id: contract.id };
  const tree = treeOf(await foldersOf(tx, owner));
  let at = folderIn(tree, destination.folderId);
  // Asked once, of the whole chain, before anything is written: a path
  // that would end up too deep creates none of its shallower folders
  // either. Half a chain is worse than no chain.
  assertDepthWithin(depthOf(tree, at) + destination.path.length);

  for (const segment of destination.path) {
    const existing = siblingNamed(tree, at?.id ?? null, segment);
    if (existing) {
      // The folder already there wins, name and all: a segment that
      // differs only in case is the same folder, not a second one.
      at = existing;
      continue;
    }
    const [created] = await tx
      .insert(documentFolders)
      .values({
        ...(owner.type === "contract" ? { contractId: owner.id } : { matterId: owner.id }),
        parentId: at?.id ?? null,
        name: segment,
      })
      .returning({
        id: documentFolders.id,
        name: documentFolders.name,
        parentId: documentFolders.parentId,
        createdAt: documentFolders.createdAt,
        updatedAt: documentFolders.updatedAt,
      });
    // Into the in-memory tree as well, so the next segment down sees
    // the folder this one just made.
    addToTree(tree, created!);
    at = created!;
  }
  return at === null ? null : { id: at.id, name: at.name };
}

/** CTR-003's reference, as every contract route takes it. */
const NumberParams = z.object({ number: z.coerce.number().int().positive() });

/** An opaque text primary key, bounded rather than shaped — no route in
 * this API asserts a UUID pattern, and a well-formed id for a record the
 * viewer cannot reach answers 404 anyway. */
const RecordIdSchema = z.string().min(1).max(64);

const FolderParams = z.object({ folderId: RecordIdSchema });

/**
 * A name, as the request carries it and before this module has anything
 * to say about it.
 *
 * Deliberately loose here and strict in {@link folderName}. A schema
 * refusal answers one generic sentence for every field it covers, and
 * the section that draws this tree shows the server's own words — so the
 * rules that a person can do something about are refused one at a time,
 * in copy they can act on.
 */
const RawNameSchema = z.string();

const FolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** The folder this one sits inside, or null at the record root. */
  parentId: z.string().nullable(),
  /**
   * How many live documents are filed **directly** in this folder, for
   * the viewer asking (M13/3, DES-033).
   *
   * Directly, because the count states what opening the folder will
   * show: a document filed one level down belongs to that folder's own
   * count, and a number that summed a subtree would disagree with the
   * listing under it.
   *
   * Scoped to the viewer, and that is the part that carries a promise.
   * An archived document is out of it (DOC-010) and so is a confidential
   * document this viewer is outside the audience of (DD-014) — left out
   * by the same predicate that leaves it out of the listing. So a zero
   * here reads "Empty" and says nothing about whether there is anything
   * to be empty of.
   */
  documentCount: z.int().nonnegative(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

/**
 * The record's folders, whole.
 *
 * Every read and every write answers the same envelope, because every
 * one of them can move more than the row it was addressed at: a delete
 * re-files the children it had, and the tree is drawn from the set
 * rather than assembled from deltas. A record's folder set is small
 * (DOC-006), so answering it whole costs one query and saves the client
 * from working out for itself which other row moved.
 */
const FoldersEnvelope = z.object({ folders: z.array(FolderSchema) });

/**
 * A create, in one of its two shapes.
 *
 * `name` is a person making a folder: one folder, refused if a sibling
 * already reads the same, and narrated (DD-017).
 *
 * `path` is a drop recreating an empty directory of a dropped tree
 * (M13/5, DOC-011): the chain is find-or-created segment by segment, a
 * segment already there is used rather than refused, and nothing is
 * narrated — a folder a drop passed through is traversal, not an act.
 *
 * Exactly one of the two, checked in the handler rather than by a
 * cross-field rule here, for {@link RawNameSchema}'s reason: a schema
 * refusal answers one generic sentence for the whole body, and this is a
 * sentence the caller can act on.
 */
const CreateFolderBody = z.object({
  name: RawNameSchema.optional(),
  /**
   * A relative folder path, `/` separated, to find-or-create beneath
   * the parent.
   *
   * Bounded here as well as segment by segment below, because a body is
   * a string before it is a path.
   */
  path: z.string().max(MAX_FOLDER_PATH_LENGTH).optional(),
  /** The folder to create this one inside, or omitted for the record
   * root. A `path` is relative to it. */
  parentId: RecordIdSchema.optional(),
});

/**
 * A rename, a move, or both — one field per request as DES-017 commits
 * them.
 *
 * `parentId: null` is the move to the record root and is a different
 * request from omitting it, which changes no parent at all.
 *
 * That one of the two must be there is checked in the handler rather
 * than by a cross-field rule here, for {@link RawNameSchema}'s reason: a
 * schema refusal answers one generic sentence for the whole body, and
 * this is a sentence the caller can act on.
 */
const UpdateFolderBody = z.object({
  name: RawNameSchema.optional(),
  parentId: RecordIdSchema.nullable().optional(),
});

export const documentFoldersRoutes: FastifyPluginAsyncZod = async (app) => {
  /** One folder this viewer reaches, with the freeze state of the record
   * that owns it. */
  interface ReachedFolder {
    id: string;
    name: string;
    parentId: string | null;
    owner: FolderOwner;
    ownerArchivedAt: Date | null;
  }

  /**
   * One folder this viewer reaches, by its own id, or `null`.
   *
   * The owning contract is joined in and the reach predicate rides
   * beside the id, so a folder on a contract the viewer cannot reach is
   * indistinguishable from one that was never created (DOC-008). A
   * folder's id says nothing about which record it is on, so refusing it
   * any other way would be the leak the 404 prevents.
   *
   * `lock` holds the **contract** row — not the folder row. That is the
   * lock every write on a record's organization serializes behind, and
   * it is the folder row's own parent chain that has to be stable, not
   * just the row itself.
   */
  async function reachedFolder(
    db: Executor,
    user: AuthenticatedUser,
    folderId: string,
    lock = false,
  ): Promise<ReachedFolder | null> {
    const query = db
      .select({
        id: documentFolders.id,
        name: documentFolders.name,
        parentId: documentFolders.parentId,
        contractId: documentFolders.contractId,
        matterId: documentFolders.matterId,
        contractArchivedAt: contracts.archivedAt,
        matterArchivedAt: matters.archivedAt,
      })
      .from(documentFolders)
      .leftJoin(contracts, eq(documentFolders.contractId, contracts.id))
      .leftJoin(matters, eq(documentFolders.matterId, matters.id))
      .where(
        and(
          eq(documentFolders.id, folderId),
          or(
            and(isNotNull(documentFolders.contractId), contractTeamScope(db, user)),
            and(isNotNull(documentFolders.matterId), matterTeamScope(db, user)),
          ),
        ),
      )
      .limit(1);
    let [row] = await query;
    if (!row) return null;
    if (lock) {
      if (row.contractId) {
        await db
          .select({ id: contracts.id })
          .from(contracts)
          .where(eq(contracts.id, row.contractId))
          .for("update", { of: contracts });
      } else if (row.matterId) {
        await db
          .select({ id: matters.id })
          .from(matters)
          .where(eq(matters.id, row.matterId))
          .for("update", { of: matters });
      }
      [row] = await query;
      if (!row) return null;
    }
    const contractOwned = row.contractId !== null;
    return {
      id: row.id,
      name: row.name,
      parentId: row.parentId,
      owner: {
        type: contractOwned ? "contract" : "matter",
        id: (row.contractId ?? row.matterId)!,
      },
      ownerArchivedAt: contractOwned ? row.contractArchivedAt : row.matterArchivedAt,
    };
  }

  /**
   * How much is filed in each of one record's folders, for one viewer.
   *
   * One grouped read for the whole tree rather than one per folder: the
   * section draws every count at once, and a query per row is how a
   * record with twelve folders becomes twelve round trips.
   *
   * **The scope is the one every document read already passes through**
   * (DD-014). `documentAudienceScope` decides it, exactly as the list,
   * the download, and the record's own section count do — there is no
   * second predicate here, because a second one is how a count and a
   * listing come to disagree, and a count that disagreed with its
   * listing would announce the very rows DD-014 leaves out. Archived
   * documents are out of it too (DOC-010): being off the list and out of
   * the count is what archiving one means.
   *
   * A folder nothing is filed in is simply absent from the answer, and
   * the caller reads that as zero.
   */
  async function countsOf(
    db: Executor,
    user: AuthenticatedUser,
    owner: string | FolderOwner,
  ): Promise<Map<string, number>> {
    const record = folderOwner(owner);
    const rows = await db
      .select({ folderId: documents.folderId, filed: count() })
      .from(documents)
      .where(
        and(
          record.type === "contract"
            ? eq(documents.contractId, record.id)
            : eq(documents.matterId, record.id),
          isNotNull(documents.folderId),
          isNull(documents.archivedAt),
          documentAudienceScope(db, user),
        ),
      )
      .groupBy(documents.folderId);
    return new Map(rows.map((row) => [row.folderId!, row.filed]));
  }

  function toFolder(row: FolderRow, filed: number) {
    return {
      id: row.id,
      name: row.name,
      parentId: row.parentId,
      documentCount: filed,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** The record's folders as the routes answer them, read back through
   * the same projection the list uses — so what a write returns is what
   * the next load will draw. */
  async function foldersEnvelope(
    db: Executor,
    user: AuthenticatedUser,
    owner: string | FolderOwner,
  ) {
    // One after the other, never in parallel: this runs inside a
    // transaction as often as not, and a transaction is one connection —
    // two statements racing down it is not a speed-up.
    const rows = await foldersOf(db, owner);
    const counts = await countsOf(db, user, owner);
    return { folders: rows.map((row) => toFolder(row, counts.get(row.id) ?? 0)) };
  }

  /**
   * The two refusals every folder write shares, in the order they have
   * to be asked in.
   *
   * Reach first: a 409 on a record the writer cannot reach would tell
   * them it is there. Then the freeze — an archived contract reads as
   * facts until it is restored (CTR-021), and how its paper is filed is
   * part of the record rather than a conversation about it.
   */
  function assertOpen<T extends ReachedContract>(contract: T | null): asserts contract is T {
    if (!contract) throw httpError(404, NO_CONTRACT);
    if (contract.archivedAt) {
      throw httpError(409, "This contract is archived. Restore it before changing its folders.");
    }
  }

  function assertOpenMatter<T extends Pick<Matter, "archivedAt">>(
    matter: T | null,
  ): asserts matter is T {
    if (!matter) throw httpError(404, NO_MATTER);
    if (matter.archivedAt) {
      throw httpError(409, "This matter is archived. Restore it before changing its folders.");
    }
  }

  /** The same two refusals for a write addressed at a folder rather than
   * at the record. */
  function assertOpenFolder(folder: ReachedFolder | null): asserts folder is ReachedFolder {
    if (!folder) throw httpError(404, NO_FOLDER);
    if (folder.ownerArchivedAt) {
      throw httpError(
        409,
        `This ${folder.owner.type} is archived. Restore it before changing its folders.`,
      );
    }
  }

  app.get(
    "/contracts/:number/folders",
    {
      preHandler: requireFolderReader,
      schema: {
        operationId: "listContractFolders",
        summary:
          "The folders on one contract, whole (DOC-006). Folders are " +
          "scoped inside the record and nowhere else — there is no " +
          "global tree, and the repository view stays flat with folder " +
          "as a facet there. The set comes back in one answer rather " +
          "than one level at a time, because a record's folder set is " +
          "small and the Documents section draws the whole tree from it. " +
          "Siblings are ordered by name without case, the way a file " +
          "manager lists a directory. Each folder carries how many live " +
          "documents are filed directly in it, counted for the viewer " +
          "asking: an archived document is out of the count (DOC-010), " +
          "and so is a confidential document this viewer is outside the " +
          "audience of (DD-014) — left out by the same predicate that " +
          "leaves it out of the folder's listing, so a count can never " +
          "announce a document the listing hid. A zero therefore reads " +
          "as an empty folder whether it is empty or its contents are " +
          "not this viewer's to see. Access is inherited from the " +
          "contract and nothing else: a Contributor on the team reads " +
          "the tree, and anyone who cannot reach the contract — a " +
          "Contributor who is not on it, a Legal Team Member outside a " +
          "confidential record's audience — is answered 404, exactly as " +
          "for a contract that does not exist. An archived contract " +
          "still reads: archiving freezes a record, it does not hide it",
        tags: ["documents"],
        params: NumberParams,
        response: { 200: FoldersEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const contract = await reachedContract(app.db, request.user, request.params.number);
      if (!contract) throw httpError(404, NO_CONTRACT);
      // An archived record still reads: archiving is a soft delete for
      // mistakes and imports, and restore has to be reachable.
      return await foldersEnvelope(app.db, request.user, contract.id);
    },
  );

  app.post(
    "/contracts/:number/folders",
    {
      preHandler: requireMember,
      schema: {
        operationId: "createContractFolder",
        summary:
          "Create a folder on a contract, at the record root or inside " +
          "another folder (DOC-006). The name is trimmed, must not be " +
          "empty, is bounded at the filesystem's own ceiling, may " +
          "not hold a slash, and may not be . or .. — a folder drop " +
          "addresses a chain by path, and neither a name with a " +
          "separator in it nor one of the two names a path is written " +
          "with could be one segment of one. Those are the same rules " +
          "every segment of a dropped path is held to, so a folder that " +
          "can be typed can always be addressed by path and the reverse. " +
          "Three invariants are refused here rather than left " +
          "to the database: a parent on another contract is answered " +
          "exactly as a parent that was never created, a sibling name " +
          "already taken under the same parent is refused 409, and a " +
          "folder deeper than the tree's ceiling is refused 409. " +
          "Appends folder.created on the owning contract (DD-017), " +
          "carrying the name so the entry outlives a later rename. " +
          "Send path instead of name to recreate an empty directory of " +
          "a dropped tree (DOC-011): the relative chain is " +
          "find-or-created segment by segment beneath parentId, under " +
          "the owning contract's row lock, so a segment already there " +
          "is used rather than refused and two drops racing on one path " +
          "converge on one folder. That form writes no activity — a " +
          "folder a drop passed through is traversal rather than an act " +
          "somebody performed, and the drop's story is its uploads " +
          "(DD-017). Exactly one of name and path. " +
          "Answers the record's whole folder set, because that is what " +
          "the tree is drawn from. Member+: a Contributor who reaches " +
          "the record is refused 403 rather than 404, because they can " +
          "already see it. An archived contract takes no new folder " +
          "until it is restored",
        tags: ["documents"],
        params: NumberParams,
        body: CreateFolderBody,
        response: { 201: FoldersEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const { name: rawName, path: rawPath, parentId } = request.body;
      // One act or the other, never both and never neither. Asked before
      // the transaction opens: a request that names nothing to make has
      // nothing to lock a row for.
      if ((rawName === undefined) === (rawPath === undefined)) {
        throw httpError(400, "Give the folder a name, or a path to recreate.");
      }

      // The drop's shape (M13/5): the chain is find-or-created under the
      // contract's row lock and nothing is narrated, because a folder a
      // drop passed through is traversal rather than an act.
      if (rawPath !== undefined) {
        const path = folderPathSegments(rawPath);
        if (path.length === 0) throw httpError(400, "Give the folder a path to recreate.");
        const recreated = await app.db.transaction(async (tx) => {
          const contract = await reachedContract(tx, request.user, request.params.number, {
            lock: true,
          });
          assertOpen(contract);
          await findOrCreateFolderPath(tx, contract, {
            folderId: parentId ?? null,
            path,
          });
          return foldersEnvelope(tx, request.user, contract.id);
        });
        return reply.status(201).send(recreated);
      }

      const folders = await app.db.transaction(async (tx) => {
        const contract = await reachedContract(tx, request.user, request.params.number, {
          lock: true,
        });
        assertOpen(contract);

        const name = folderName(rawName!);
        // One read of the record's whole set, under the lock above, and
        // every question below is asked of it: the parent, the sibling
        // names, and the depth. Nothing can change underneath between
        // the checks and the insert.
        const tree = treeOf(await foldersOf(tx, contract.id));
        const parent = folderIn(tree, parentId ?? null);
        assertNameFree(tree, parent?.id ?? null, name);
        // A new folder brings nothing with it, so the ceiling is asked
        // about where it lands and nothing else.
        assertDepth(tree, parent, 0);

        const [created] = await tx
          .insert(documentFolders)
          .values({ contractId: contract.id, parentId: parent?.id ?? null, name })
          .returning({ id: documentFolders.id });
        await recordActivity(tx, {
          entityType: "contract",
          entityId: contract.id,
          actorId: request.user.id,
          action: "folder.created",
          visibility: RECORD_ACTIVITY_TIER,
          // The name, and what it was made inside, as they stand now —
          // so the entry still says what happened after a rename or a
          // delete has taken either of them away.
          payload: { folderId: created!.id, name, parentName: parent?.name ?? null },
        });

        return foldersEnvelope(tx, request.user, contract.id);
      });
      return reply.status(201).send(folders);
    },
  );

  app.get(
    "/matters/:number/folders",
    {
      preHandler: requireFolderReader,
      schema: {
        operationId: "listMatterFolders",
        summary:
          "The complete folder tree on one matter. Counts include only live documents the viewer reaches.",
        tags: ["documents"],
        params: NumberParams,
        response: { 200: FoldersEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const matter = await reachedMatter(app.db, request.user, request.params.number);
      if (!matter) throw httpError(404, NO_MATTER);
      return foldersEnvelope(app.db, request.user, { type: "matter", id: matter.id });
    },
  );

  app.post(
    "/matters/:number/folders",
    {
      preHandler: requireMember,
      schema: {
        operationId: "createMatterFolder",
        summary:
          "Create a folder on a matter, or recreate a dropped folder path beneath an optional parent.",
        tags: ["documents"],
        params: NumberParams,
        body: CreateFolderBody,
        response: { 201: FoldersEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const { name: rawName, path: rawPath, parentId } = request.body;
      if ((rawName === undefined) === (rawPath === undefined)) {
        throw httpError(400, "Give the folder a name, or a path to recreate.");
      }
      if (rawPath !== undefined) {
        const path = folderPathSegments(rawPath);
        if (path.length === 0) throw httpError(400, "Give the folder a path to recreate.");
        const recreated = await app.db.transaction(async (tx) => {
          const matter = await reachedMatter(tx, request.user, request.params.number, {
            lock: true,
          });
          assertOpenMatter(matter);
          await findOrCreateFolderPath(tx, matter, { folderId: parentId ?? null, path });
          return foldersEnvelope(tx, request.user, { type: "matter", id: matter.id });
        });
        return reply.status(201).send(recreated);
      }

      const folders = await app.db.transaction(async (tx) => {
        const matter = await reachedMatter(tx, request.user, request.params.number, { lock: true });
        assertOpenMatter(matter);
        const name = folderName(rawName!);
        const owner = { type: "matter", id: matter.id } as const;
        const tree = treeOf(await foldersOf(tx, owner));
        const parent = folderIn(tree, parentId ?? null);
        assertNameFree(tree, parent?.id ?? null, name);
        assertDepth(tree, parent, 0);
        const [created] = await tx
          .insert(documentFolders)
          .values({ matterId: matter.id, parentId: parent?.id ?? null, name })
          .returning({ id: documentFolders.id });
        await recordActivity(tx, {
          entityType: "matter",
          entityId: matter.id,
          actorId: request.user.id,
          action: "folder.created",
          visibility: RECORD_ACTIVITY_TIER,
          payload: { folderId: created!.id, name, parentName: parent?.name ?? null },
        });
        return foldersEnvelope(tx, request.user, owner);
      });
      return reply.status(201).send(folders);
    },
  );

  app.patch(
    "/folders/:folderId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "updateContractFolder",
        summary:
          "Rename a folder, move it under a different parent, or both " +
          "(DOC-006). A new name is held to exactly the rules a created " +
          "one is, . and .. among them; a request that names no name " +
          "leaves the folder's own name unjudged, so a folder that " +
          "predates a narrowing of those rules can still be moved and " +
          "still be renamed out. parentId null moves it to the record root, and " +
          "omitting parentId moves nothing — they are two different " +
          "requests. A move carries the whole subtree, so the tree's " +
          "depth ceiling is asked about the deepest folder underneath " +
          "rather than about the moved row alone. The parent chain " +
          "never cycles: a move that would put a folder inside itself, " +
          "or inside one of its own descendants, is refused 409. A " +
          "parent on another contract is answered exactly as a parent " +
          "that was never created, and a sibling name already taken " +
          "under the destination is refused 409. Appends " +
          "folder.renamed and folder.moved on the owning contract " +
          "(DD-017) — one entry per thing that happened, each carrying " +
          "the folder's name. Answers the record's whole folder set. A " +
          "folder on a contract the editor cannot reach answers 404, " +
          "exactly as one that does not exist; an archived contract " +
          "takes no edit until it is restored",
        tags: ["documents"],
        params: FolderParams,
        body: UpdateFolderBody,
        response: { 200: FoldersEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const { folderId } = request.params;
      const body = request.body;
      // Asked before the transaction opens: a request that names
      // nothing to change has nothing to lock a row for.
      if (body.name === undefined && body.parentId === undefined) {
        throw httpError(400, "Give a name to rename to, or a parent to move under.");
      }

      return await app.db.transaction(async (tx) => {
        const target = await reachedFolder(tx, request.user, folderId, true);
        assertOpenFolder(target);

        const name = body.name === undefined ? target.name : folderName(body.name);
        const tree = treeOf(await foldersOf(tx, target.owner));
        // The move is asked of the parent the body named; a request that
        // named none leaves the folder where it is.
        const moving = body.parentId !== undefined;
        const parent = moving
          ? folderIn(tree, body.parentId ?? null)
          : folderIn(tree, target.parentId);

        if (moving) {
          assertNoCycle(tree, target.id, parent);
          // The subtree comes too, so the ceiling is asked about the
          // deepest folder under this one and not about this one.
          assertDepth(tree, parent, heightBelow(tree, target.id));
        }
        assertNameFree(tree, parent?.id ?? null, name, target.id);

        const renamed = name !== target.name;
        const moved = moving && (parent?.id ?? null) !== target.parentId;
        if (renamed || moved) {
          await tx
            .update(documentFolders)
            .set({
              ...(renamed ? { name } : {}),
              ...(moved ? { parentId: parent?.id ?? null } : {}),
            })
            .where(eq(documentFolders.id, target.id));
        }

        // One entry per thing that happened, never one generic edit: a
        // rename and a move are two different acts, and an
        // Administrator has to be able to filter the audit log on the
        // one they are looking for. A request that changed nothing
        // writes no misleading from==to entry.
        if (renamed) {
          await recordActivity(tx, {
            entityType: target.owner.type,
            entityId: target.owner.id,
            actorId: request.user.id,
            action: "folder.renamed",
            visibility: RECORD_ACTIVITY_TIER,
            payload: { folderId: target.id, name, previousName: target.name },
          });
        }
        if (moved) {
          await recordActivity(tx, {
            entityType: target.owner.type,
            entityId: target.owner.id,
            actorId: request.user.id,
            action: "folder.moved",
            visibility: RECORD_ACTIVITY_TIER,
            // The destination by name rather than by id, for the reason
            // every payload here carries a name: the id will not draw a
            // sentence once the row is gone.
            payload: { folderId: target.id, name, parentName: parent?.name ?? null },
          });
        }

        return foldersEnvelope(tx, request.user, target.owner);
      });
    },
  );

  app.delete(
    "/folders/:folderId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "deleteContractFolder",
        summary:
          "Dissolve a folder (DOC-006). Its child folders and the " +
          "documents filed in it are re-filed " +
          "into its parent — the record root when it had none — and " +
          "nothing is destroyed: this route deletes no document, and " +
          "erasing one stays DOC-010's separate Administrator-only " +
          "path. Every document in the folder moves, the archived ones " +
          "and the confidential ones the caller cannot see included: " +
          "the re-file is a fact about the record's organization, not a " +
          "read, and a row left behind would point at a folder that no " +
          "longer exists. Because the children are re-filed rather than removed, " +
          "a delete that would put two folders of the same name in one " +
          "place is refused 409 rather than resolved by inventing a " +
          "name. Appends folder.deleted on the owning contract " +
          "(DD-017), carrying the folder's name — the entry outlives " +
          "the row, so it is the only thing left that says what was " +
          "dissolved. Answers the record's whole folder set, because " +
          "every re-filed child moved. A folder on a contract the " +
          "viewer cannot reach answers 404, exactly as one that does " +
          "not exist; an archived contract takes no delete until it is " +
          "restored",
        tags: ["documents"],
        params: FolderParams,
        response: { 200: FoldersEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const { folderId } = request.params;

      return await app.db.transaction(async (tx) => {
        const target = await reachedFolder(tx, request.user, folderId, true);
        assertOpenFolder(target);

        const tree = treeOf(await foldersOf(tx, target.owner));
        const children = tree.children.get(target.id) ?? [];

        // Re-filing can only break one invariant, and it is the sibling
        // names: a child called Executed moving up into a parent that
        // already has an Executed would be two of them in one place.
        // Refused rather than resolved — inventing "Executed (2)" would
        // name a folder something nobody chose, and the person asking
        // for this can rename either one first. The children were
        // siblings, so they cannot collide with each other.
        for (const child of children) {
          assertNameFree(tree, target.parentId, child.name, target.id);
        }

        if (children.length > 0) {
          await tx
            .update(documentFolders)
            .set({ parentId: target.parentId })
            .where(eq(documentFolders.parentId, target.id));
        }
        // And the paper filed here goes where the child folders go
        // (M13/3). No audience scope and no archived filter on this one:
        // it is the record's organization being rewritten, not read, and
        // a document left pointing at a folder about to be deleted would
        // be an orphan the foreign key then refuses. Nothing is lost —
        // the documents move up one level, exactly as the folders do.
        await tx
          .update(documents)
          .set({ folderId: target.parentId })
          .where(eq(documents.folderId, target.id));
        await tx.delete(documentFolders).where(eq(documentFolders.id, target.id));
        await recordActivity(tx, {
          entityType: target.owner.type,
          entityId: target.owner.id,
          actorId: request.user.id,
          action: "folder.deleted",
          visibility: RECORD_ACTIVITY_TIER,
          payload: { folderId: target.id, name: target.name },
        });

        return foldersEnvelope(tx, request.user, target.owner);
      });
    },
  );
};
