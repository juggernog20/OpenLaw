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
 * A folder that a bulk drop find-or-creates will write none: the drop's
 * story is its uploads, not its traversal.
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
  MAX_FOLDER_NAME_LENGTH,
  sql,
} from "@openlaw/db";
import { requireRole, type AuthenticatedUser } from "../../auth/guards.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import {
  contractTeamScope,
  documentAudienceScope,
  type ContractAccessReader,
} from "../../lib/contract-access.js";
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

/** A contract a viewer cannot reach reads exactly as one that does not
 * exist — on the folder routes as on every document route (DD-014). */
const NO_CONTRACT = "No contract exists with this number.";

/**
 * And a folder on such a contract answers the same way. Its own id says
 * nothing about which record it belongs to, so a refusal here would be
 * the leak the 404 exists to prevent.
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

const CreateFolderBody = z.object({
  name: RawNameSchema,
  /** The folder to create this one inside, or omitted for the record
   * root. */
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
  type Tx = Parameters<Parameters<typeof app.db.transaction>[0]>[0];
  type Executor = typeof app.db | Tx;

  /** One contract this viewer reaches, as the routes here need it. */
  interface ReachedContract {
    id: string;
    /** SET-003's soft delete: a time freezes the record (CTR-021). */
    archivedAt: Date | null;
  }

  /**
   * One contract this viewer reaches, by its CTR-003 number, or `null`.
   *
   * The scope rides beside the number rather than being asked after it,
   * so a contract the viewer cannot reach is not distinguishable from
   * one that was never created — the M10 rule, applied to folders as it
   * is to paper. It is read live on every request, so taking somebody's
   * last team row off ends their reach on the next one.
   *
   * `lock` holds the row for the write that follows. That lock is what
   * makes the whole-set read below a decision rather than a guess: every
   * folder write on one contract serializes behind it, so the tree
   * cannot change between the checks and the insert.
   */
  async function reachedContract(
    db: ContractAccessReader,
    user: AuthenticatedUser,
    number: number,
    lock = false,
  ): Promise<ReachedContract | null> {
    const query = db
      .select({ id: contracts.id, archivedAt: contracts.archivedAt })
      .from(contracts)
      .where(and(eq(contracts.number, number), contractTeamScope(db, user)))
      .limit(1);
    const [row] = await (lock ? query.for("update", { of: contracts }) : query);
    return row ?? null;
  }

  /** One folder this viewer reaches, with the freeze state of the record
   * that owns it. */
  interface ReachedFolder {
    id: string;
    name: string;
    parentId: string | null;
    contractId: string;
    /** The owning contract's SET-003 soft delete (CTR-021). */
    contractArchivedAt: Date | null;
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
    db: ContractAccessReader & Executor,
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
        contractArchivedAt: contracts.archivedAt,
      })
      .from(documentFolders)
      .innerJoin(contracts, eq(documentFolders.contractId, contracts.id))
      .where(and(eq(documentFolders.id, folderId), contractTeamScope(db, user)))
      .limit(1);
    const [row] = await (lock ? query.for("update", { of: contracts }) : query);
    return row ?? null;
  }

  /** One folder as the tree is drawn from it. */
  interface FolderRow {
    id: string;
    name: string;
    parentId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }

  /**
   * Every folder on one contract, siblings in the order they are drawn.
   *
   * Ordered by name without case, which is how a file manager lists a
   * directory and what DES-033 draws: `display_order` is deferred with
   * the reorder surface that would read it. The id breaks a tie between
   * two names that differ only in case, so the order is total and the
   * same answer comes back twice.
   *
   * The whole set, never one level: the section draws the tree from one
   * read, and every invariant below is asked of the same set.
   */
  async function foldersOf(db: Executor, contractId: string): Promise<FolderRow[]> {
    return db
      .select({
        id: documentFolders.id,
        name: documentFolders.name,
        parentId: documentFolders.parentId,
        createdAt: documentFolders.createdAt,
        updatedAt: documentFolders.updatedAt,
      })
      .from(documentFolders)
      .where(eq(documentFolders.contractId, contractId))
      .orderBy(asc(sql`lower(${documentFolders.name})`), asc(documentFolders.id));
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
    db: ContractAccessReader & Executor,
    user: AuthenticatedUser,
    contractId: string,
  ): Promise<Map<string, number>> {
    const rows = await db
      .select({ folderId: documents.folderId, filed: count() })
      .from(documents)
      .where(
        and(
          eq(documents.contractId, contractId),
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
    db: ContractAccessReader & Executor,
    user: AuthenticatedUser,
    contractId: string,
  ) {
    // One after the other, never in parallel: this runs inside a
    // transaction as often as not, and a transaction is one connection —
    // two statements racing down it is not a speed-up.
    const rows = await foldersOf(db, contractId);
    const counts = await countsOf(db, user, contractId);
    return { folders: rows.map((row) => toFolder(row, counts.get(row.id) ?? 0)) };
  }

  /**
   * A name, checked once and refused one rule at a time.
   *
   * Trimmed, because a name with an edge space sorts and compares as a
   * name nobody typed. Non-empty, because a folder with no name cannot
   * be pointed at. Bounded at the filesystem's own ceiling, because a
   * folder is created from a directory name as often as it is typed
   * (DOC-011). And free of the path separator, because a folder drop
   * addresses a chain by path and a name holding a separator could not
   * be one segment of one.
   */
  function folderName(raw: string): string {
    const name = raw.trim();
    if (name.length === 0) throw httpError(400, "Give the folder a name.");
    if (name.length > MAX_FOLDER_NAME_LENGTH) {
      throw httpError(400, `A folder name can be at most ${MAX_FOLDER_NAME_LENGTH} characters.`);
    }
    if (name.includes("/") || name.includes("\\")) {
      throw httpError(400, "A folder name cannot contain a slash. Make a folder inside instead.");
    }
    return name;
  }

  /** How the tree is read: every folder by its id, and every folder's
   * children by their parent's. Built once per write from the one read
   * the lock protects. */
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

  /**
   * The parent a write named, as a row of this contract's own tree.
   *
   * Invariant 1 (DOC-008): a folder and its parent share one owning
   * record. It holds because the tree was read for **this** contract —
   * so a parent on another record is simply not in it, and is answered
   * exactly as a parent that was never created. A folder's id says
   * nothing about which record it belongs to, so any other refusal would
   * say that the folder is there.
   */
  function parentIn(tree: Tree, parentId: string | null): FolderRow | null {
    if (parentId === null) return null;
    const parent = tree.byId.get(parentId);
    if (!parent) throw httpError(404, NO_FOLDER);
    return parent;
  }

  /** How deep a folder sits, counting the record root's own folders as
   * level 1. The walk is bounded by the tree's size, so a chain the
   * write path somehow let cycle cannot spin here. */
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
   * write path refuses a cycle, and code that trusted that without a
   * bound would answer a stack overflow rather than a refusal if a row
   * ever got past it.
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
   * Invariant 3: sibling names are unique within their parent, compared
   * without case.
   *
   * Without case, because that is the same reading the sort already
   * takes (DES-033): two siblings that sort as equal and read as the
   * same word may not both exist. `except` is the row being renamed or
   * moved, which must not collide with itself.
   */
  function assertNameFree(
    tree: Tree,
    parentId: string | null,
    name: string,
    except?: string,
  ): void {
    const taken = (tree.children.get(parentId) ?? []).some(
      (sibling) => sibling.id !== except && sibling.name.toLowerCase() === name.toLowerCase(),
    );
    if (taken) throw httpError(409, `A folder named ${name} is already here.`);
  }

  /** Invariant 2: the parent chain never cycles. A folder may not be
   * moved inside itself, nor inside anything already under it — the walk
   * up from the new parent must never meet the folder being moved. */
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

  /** The depth ceiling, asked of where the folder lands and of
   * everything it brings with it. */
  function assertDepth(tree: Tree, parent: FolderRow | null, subtreeHeight: number): void {
    if (depthOf(tree, parent) + 1 + subtreeHeight > MAX_FOLDER_DEPTH) {
      throw httpError(
        409,
        `Folders can be nested ${MAX_FOLDER_DEPTH} deep. Put this one higher up.`,
      );
    }
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
  function assertOpen(contract: ReachedContract | null): asserts contract is ReachedContract {
    if (!contract) throw httpError(404, NO_CONTRACT);
    if (contract.archivedAt) {
      throw httpError(409, "This contract is archived. Restore it before changing its folders.");
    }
  }

  /** The same two refusals for a write addressed at a folder rather than
   * at the record. */
  function assertOpenFolder(folder: ReachedFolder | null): asserts folder is ReachedFolder {
    if (!folder) throw httpError(404, NO_FOLDER);
    if (folder.contractArchivedAt) {
      throw httpError(409, "This contract is archived. Restore it before changing its folders.");
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
          "empty, is bounded at the filesystem's own ceiling, and may " +
          "not hold a slash — a folder drop addresses a chain by path, " +
          "and a name with a separator in it could not be one segment " +
          "of one. Three invariants are refused here rather than left " +
          "to the database: a parent on another contract is answered " +
          "exactly as a parent that was never created, a sibling name " +
          "already taken under the same parent is refused 409, and a " +
          "folder deeper than the tree's ceiling is refused 409. " +
          "Appends folder.created on the owning contract (DD-017), " +
          "carrying the name so the entry outlives a later rename. " +
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
      const { name: rawName, parentId } = request.body;
      const folders = await app.db.transaction(async (tx) => {
        const contract = await reachedContract(tx, request.user, request.params.number, true);
        assertOpen(contract);

        const name = folderName(rawName);
        // One read of the record's whole set, under the lock above, and
        // every question below is asked of it: the parent, the sibling
        // names, and the depth. Nothing can change underneath between
        // the checks and the insert.
        const tree = treeOf(await foldersOf(tx, contract.id));
        const parent = parentIn(tree, parentId ?? null);
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

  app.patch(
    "/folders/:folderId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "updateContractFolder",
        summary:
          "Rename a folder, move it under a different parent, or both " +
          "(DOC-006). parentId null moves it to the record root, and " +
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
        const tree = treeOf(await foldersOf(tx, target.contractId));
        // The move is asked of the parent the body named; a request that
        // named none leaves the folder where it is.
        const moving = body.parentId !== undefined;
        const parent = moving
          ? parentIn(tree, body.parentId ?? null)
          : parentIn(tree, target.parentId);

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
            entityType: "contract",
            entityId: target.contractId,
            actorId: request.user.id,
            action: "folder.renamed",
            visibility: RECORD_ACTIVITY_TIER,
            payload: { folderId: target.id, name, previousName: target.name },
          });
        }
        if (moved) {
          await recordActivity(tx, {
            entityType: "contract",
            entityId: target.contractId,
            actorId: request.user.id,
            action: "folder.moved",
            visibility: RECORD_ACTIVITY_TIER,
            // The destination by name rather than by id, for the reason
            // every payload here carries a name: the id will not draw a
            // sentence once the row is gone.
            payload: { folderId: target.id, name, parentName: parent?.name ?? null },
          });
        }

        return foldersEnvelope(tx, request.user, target.contractId);
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

        const tree = treeOf(await foldersOf(tx, target.contractId));
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
          entityType: "contract",
          entityId: target.contractId,
          actorId: request.user.id,
          action: "folder.deleted",
          visibility: RECORD_ACTIVITY_TIER,
          payload: { folderId: target.id, name: target.name },
        });

        return foldersEnvelope(tx, request.user, target.contractId);
      });
    },
  );
};
