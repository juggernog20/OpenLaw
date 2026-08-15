// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The bulk intake batch (M13/4, M13/5, DOC-011, DES-033).
 *
 * **A batch is N ordinary uploads, never one bulk call.** Every file
 * becomes a new document at version 1 through the upload route a single
 * file already goes through, so the primary designation (CTR-014), the
 * activity entry (DD-017), and the derivations (DOC-005) are the same
 * facts a single upload leaves behind. A folder drop adds one field to
 * each of those calls — where the file goes — and nothing else: there is
 * still one upload path to keep correct.
 *
 * **The batch is driven by the client, bounded, and honest about
 * failure.** A pool of a few workers takes files off the front of the
 * list, each file carries its own state, and a refusal costs that file
 * and nothing else. A file that already landed is never sent again, so
 * a retry cannot put the same document on the record twice.
 *
 * **The structure a drop carries is read here, in the drop handler's own
 * seam.** A dropped directory is walked with the browser's
 * directory-entry API, and each file comes out of the walk carrying the
 * folder path it sat at. The server find-or-creates that chain under the
 * owning contract's row lock, so two files racing on one path converge
 * on one folder — nothing here has to co-ordinate anything, and nothing
 * here decides what a folder is.
 *
 * This module holds the pieces that are not React: what a drop carries,
 * how a dropped tree is read, and how many uploads run at once.
 */

/**
 * How many uploads run at once.
 *
 * Three, because the point of a bound is that a 200-file import does
 * not open 200 connections at the browser's mercy, and the number that
 * saturates a link is small. It is a constant rather than a setting:
 * nobody has asked to tune it, and a tuned batch is a batch whose
 * failures depend on a number nobody remembers choosing.
 */
export const BATCH_CONCURRENCY = 3;

/** Where one file is in the batch (DES-033 §11). */
export type BatchState = "queued" | "uploading" | "done" | "failed";

/**
 * The separator a folder path is written with, on the wire (DOC-011).
 *
 * The seam splits on it and refuses a segment that holds one, so it is
 * a piece of protocol rather than a mark a reader reads — the dialog
 * formats the path it draws through its own message (DES-013).
 */
export const PATH_SEPARATOR = "/";

/**
 * One file a gesture carried, and where in the dropped tree it sat.
 *
 * The path is the chain of folder names between the drop target and the
 * file, root-first and never including the file itself. Empty is the
 * drop target itself, which is what a plain multi-file drop or a
 * multi-select pick carries.
 */
export interface DroppedFile {
  file: File;
  path: readonly string[];
}

/**
 * Everything one gesture carried: its files, and the directories that
 * held none.
 *
 * The empty directories are here because the structure that arrives has
 * to be the structure that was dropped (DOC-011). They carry no file, so
 * no upload would recreate them — they are asked for on their own.
 */
export interface DroppedTree {
  files: DroppedFile[];
  /** The path of each directory the walk found nothing in, root-first.
   * A directory whose only contents are other empty directories is not
   * in here: its deepest leaf is, and recreating that leaf recreates
   * every level above it. */
  emptyFolders: (readonly string[])[];
  /**
   * The path of each directory the walk could not read to the end.
   *
   * A browser that refuses a directory hands back nothing rather than an
   * error, so the walk cannot tell that from an empty one — and treating
   * the two the same would mean a drop of a legacy book silently
   * arriving short. It is separated out and said, because the batch's
   * whole claim is that it is honest about what it is doing.
   */
  unreadable: (readonly string[])[];
}

/**
 * One file of a batch, as the dialog draws it and the pool sends it.
 *
 * The row is the unit of everything: one upload, one state, one failure,
 * one retry — and one destination, because the folder a dropped file
 * belongs in is a fact about that file rather than about the batch
 * (M13/5). The pool already carries a row per file, so the destination
 * is a field on it and the only other change is the form the send
 * builds.
 */
export interface BatchRow {
  /** Stable within one batch: the row's key, and the handle a retry is
   * addressed to. */
  id: string;
  file: File;
  /** The folder chain this file sat at in the dropped tree, relative to
   * what it was dropped on. Empty at the drop target itself. */
  path: readonly string[];
  state: BatchState;
  /** Why it failed, in the seam's own words when the seam sent any. */
  reason: string | null;
  /** Whether a retry could change the answer (DES-033 §11). A file over
   * the deployment's size ceiling is refused again by the same seam, so
   * it is offered none. */
  retryable: boolean;
}

/** The batch a set of chosen or dropped files starts as: every file
 * queued, nothing sent. */
export function batchOf(dropped: readonly DroppedFile[]): BatchRow[] {
  return dropped.map((item, index) => ({
    id: `batch-${index}`,
    file: item.file,
    path: item.path,
    state: "queued",
    reason: null,
    retryable: true,
  }));
}

/**
 * How many times a directory's reader is asked for more entries before
 * this gives up on it.
 *
 * `readEntries` answers a page at a time and signals the end with an
 * empty page, so it has to be called in a loop — and a loop over a
 * browser API needs a bound, or a reader that never empties hangs the
 * tab. High enough that no real directory reaches it: a page is 100
 * entries in every browser that implements this.
 */
const MAX_DIRECTORY_PAGES = 1000;

/**
 * How deep the walk descends before it stops.
 *
 * Not the seam's ceiling and not a rule about folders — the seam refuses
 * a path past its own bound, per file, and a second opinion here in
 * different words is how a client comes to disagree with the server. It
 * is the bound {@link MAX_DIRECTORY_PAGES} is, for the same reason: a
 * recursion over a browser API needs one, or a directory that somehow
 * contains itself ends the tab rather than the walk. Far past any tree
 * the seam would accept.
 */
const MAX_DIRECTORY_DEPTH = 64;

/**
 * Everything a drop carries: its files with the folder each one sat in,
 * and the directories that held nothing (M13/5, DOC-011).
 *
 * **This is the seam M13/4 left for the directory walk**, and the walk
 * lives here rather than in the drop handler for the reason it was left
 * here: the handler is a React event, and the reading of a
 * `DataTransfer` is neither React's nor the dialog's business.
 *
 * `items` is preferred over `files` because it is the only list that can
 * answer what an entry *is*: a dropped directory appears there as an
 * entry the walk descends into, and `dataTransfer.files` would hand back
 * a flat list with the structure already destroyed — which is the exact
 * loss DOC-011 exists to prevent.
 *
 * Everything is optional-guarded because a drop event is shaped by the
 * browser, not by us: a `DataTransfer` without `items`, and an item
 * without `webkitGetAsEntry`, are real shapes rather than broken ones,
 * and both fall back to the flat reading M13/4 shipped.
 */
export async function filesFromDrop(
  transfer: DataTransfer | null | undefined,
): Promise<DroppedTree> {
  const tree: DroppedTree = { files: [], emptyFolders: [], unreadable: [] };
  if (!transfer) return tree;
  const items = transfer.items ? [...transfer.items] : [];
  if (items.length === 0) {
    for (const file of transfer.files ? [...transfer.files] : []) {
      tree.files.push({ file, path: [] });
    }
    return tree;
  }
  // The entries are taken off the items **before** anything is awaited.
  // A `DataTransfer` is emptied when the drop event's handler returns,
  // so an item read after the first await is an item with nothing left
  // on it.
  const entries: (FileSystemEntry | null)[] = [];
  const plain: File[] = [];
  for (const item of items) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.() ?? null;
    if (entry) entries.push(entry);
    else {
      // A browser that cannot say what the item is can still hand over
      // the file, and a file with no structure lands at the drop target.
      const file = item.getAsFile();
      if (file) plain.push(file);
    }
  }
  for (const file of plain) tree.files.push({ file, path: [] });
  for (const entry of entries) {
    if (entry) await walkEntry(entry, [], tree);
  }
  return tree;
}

/**
 * One dropped entry, and everything under it.
 *
 * A file is recorded at the path it was reached by. A directory is
 * descended into, and one that turned out to hold nothing is recorded as
 * an empty folder — the structure that arrives has to be the structure
 * that was dropped, and an empty directory is part of that structure. A
 * directory the browser would not read to the end is recorded as
 * unreadable instead, so a drop that arrived short says so.
 *
 * Nothing is refused here. A path too deep or a name that breaks the
 * folder rules is the seam's to answer, per file, and refusing it twice
 * — once here in different words — is how a client comes to disagree
 * with the server about what is allowed.
 */
async function walkEntry(
  entry: FileSystemEntry,
  path: readonly string[],
  tree: DroppedTree,
): Promise<void> {
  if (entry.isFile) {
    const file = await fileOf(entry as FileSystemFileEntry);
    // A file the browser could not hand over is left out rather than
    // reported: there is nothing to upload and nothing to say about it.
    if (file) tree.files.push({ file, path });
    return;
  }
  if (!entry.isDirectory) return;
  const here = [...path, entry.name];
  if (here.length > MAX_DIRECTORY_DEPTH) {
    tree.unreadable.push(here);
    return;
  }
  const read = await entriesOf(entry as FileSystemDirectoryEntry);
  if (!read.whole) tree.unreadable.push(here);
  if (read.entries.length === 0) {
    // Only a directory that was read to the end and held nothing is an
    // empty one. One that could not be read is not known to be empty,
    // and recreating it would say it was.
    if (read.whole) tree.emptyFolders.push(here);
    return;
  }
  for (const child of read.entries) await walkEntry(child, here, tree);
}

/** One entry's file, or nothing when the browser refused to hand it
 * over. Callback-shaped at the seam, awaited here. */
function fileOf(entry: FileSystemFileEntry): Promise<File | null> {
  return new Promise((resolve) => {
    entry.file(
      (file) => resolve(file),
      () => resolve(null),
    );
  });
}

/**
 * Everything directly inside one directory, and whether that is all of
 * it.
 *
 * `readEntries` answers a page at a time and says it is finished by
 * answering an empty page, so it is called until it does — a directory
 * of 300 files is three calls, and reading only the first would drop two
 * hundred of them silently.
 *
 * `whole` is what separates "finished" from "gave up": a read that
 * errored, or one that ran out of pages, has entries and no claim that
 * they are all of them. Without it a refused directory and an empty one
 * are the same answer, and the drop would arrive short in silence.
 */
async function entriesOf(
  directory: FileSystemDirectoryEntry,
): Promise<{ entries: FileSystemEntry[]; whole: boolean }> {
  const reader = directory.createReader();
  const entries: FileSystemEntry[] = [];
  for (let page = 0; page < MAX_DIRECTORY_PAGES; page += 1) {
    const batch = await new Promise<FileSystemEntry[] | null>((resolve) => {
      reader.readEntries(
        (read) => resolve([...read]),
        () => resolve(null),
      );
    });
    if (batch === null) return { entries, whole: false };
    if (batch.length === 0) return { entries, whole: true };
    entries.push(...batch);
  }
  return { entries, whole: false };
}

/**
 * The files a directory picker chose, with the structure they came from
 * (M13/5, DES-033 §7).
 *
 * This is folder drop's pointer-free twin. A `webkitdirectory` input
 * puts the path each file sat at on the file itself, so the structure
 * survives a pick exactly as it survives a drop.
 *
 * **Empty directories cannot survive a pick.** A file input carries
 * files, and a directory holding none produces none — there is nothing
 * for the browser to hand over. That is a limit of the control, not a
 * decision: dropping the same tree recreates them.
 */
export function filesFromDirectoryPicker(files: readonly File[]): DroppedFile[] {
  return files.map((file) => {
    // `webkitRelativePath` is the path inside the chosen directory,
    // including that directory's own name and the file's own. Only the
    // filename comes off, so the chosen directory is recreated at the
    // destination too — picking a folder brings the folder, not just
    // its contents.
    const segments = file.webkitRelativePath
      .split(PATH_SEPARATOR)
      .filter((segment) => segment.length > 0);
    return { file, path: segments.slice(0, -1) };
  });
}

/** Whether a drag is carrying files at all, so the section lights up
 * for a file drag and stays still for a text selection being dragged
 * across it. */
export function dragCarriesFiles(transfer: DataTransfer | null | undefined): boolean {
  return transfer ? [...(transfer.types ?? [])].includes("Files") : false;
}

/**
 * Runs `work` over every job, with at most `limit` of them in flight.
 *
 * A fixed pool of workers pulling off one shared cursor, rather than
 * chunks of `limit` run one after another: a chunk waits for its
 * slowest member before the next one starts, so one 40 MB file in a
 * chunk of three leaves two workers idle. Here a worker that finishes
 * takes the next file immediately.
 *
 * `work` is expected to record its own failures. One that throws anyway
 * costs its own job and nothing else — a rejection let out of a worker
 * would reject the whole pool and strand every job still queued, which
 * is the one thing the pool exists to prevent.
 */
export async function runBounded<T>(
  jobs: readonly T[],
  limit: number,
  work: (job: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, jobs.length)) }, async () => {
    for (;;) {
      const index = next++;
      // The end of the list is the only reason to stop. A job whose
      // value happens to be `undefined` is still a job, and retiring
      // the worker on it would drop everything behind it.
      if (index >= jobs.length) return;
      try {
        await work(jobs[index]!);
      } catch {
        // Recorded by `work`, or not at all. Either way the pool goes
        // on to the next file.
      }
    }
  });
  await Promise.all(workers);
}
