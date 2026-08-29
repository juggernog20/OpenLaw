// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The folder vocabulary the contract record's Documents section reads
 * (M13/2, DOC-006): the row shape the API answers, the two readings of
 * it the tree needs — a folder's children, and where a folder may be
 * moved to — and the four calls the section makes.
 *
 * **The set is read and answered whole.** A record's folder set is small
 * (DOC-006), so the tree is drawn from one read rather than one read per
 * level, and every write answers the set as it now stands rather than
 * the row it was addressed at. That matters most on delete: dissolving a
 * folder re-files its children into its parent, so more rows move than
 * the one that went. The section replaces what it holds instead of
 * working out for itself which other row moved.
 *
 * **Order is the server's.** Siblings come back sorted by name without
 * case, the way a file manager lists a directory (DES-033) —
 * `display_order` is deferred with the reorder surface that would read
 * it. Grouping by parent preserves that order, so nothing here sorts
 * anything.
 */

import type { paths } from "@openlaw/api-client";
import { api } from "./api";
// The separator the seam splits a folder path on, taken from the module
// that reads a dropped tree: one string, joined and split in one place.
import { PATH_SEPARATOR } from "./batch-upload";
import { problem, type OpenApiResult, type Problem } from "./problem";
import type { DocumentRecord } from "./documents";

/** The API's answer for one contract's folders, aliased to the generated
 * schema so an API change surfaces as a compile error here rather than
 * as a runtime surprise on the record page. */
type ListResponse =
  paths["/api/v1/contracts/{number}/folders"]["get"]["responses"]["200"]["content"]["application/json"];

/** One folder on a record (DOC-006). */
export type ContractFolder = ListResponse["folders"][number];

/** What a read or a write over the record's folders answers: the set as
 * it now stands, or why not. */
export type FoldersOutcome = { ok: true; folders: ContractFolder[] } | ({ ok: false } & Problem);

async function foldersOutcome(
  result: (OpenApiResult & { data?: ListResponse }) | undefined,
): Promise<FoldersOutcome> {
  return result?.data
    ? { ok: true, folders: result.data.folders }
    : { ok: false, ...(await problem(result)) };
}

/**
 * The folders sitting directly inside one folder, or at the record root
 * when `parentId` is null.
 *
 * The server's order is kept, so the caller draws siblings in the order
 * the seam answered them and never re-sorts. Called once per drawn
 * level, which is what makes the tree a walk of the set rather than a
 * scan of it per row.
 */
export function childrenOf(
  folders: readonly ContractFolder[],
  parentId: string | null,
): ContractFolder[] {
  return folders.filter((folder) => folder.parentId === parentId);
}

/**
 * Where one folder may be moved to: every other folder on the record,
 * minus the folder itself and everything already under it.
 *
 * It says exactly what the seam says — a move that would put a folder
 * inside itself or inside one of its own descendants is refused there —
 * out of the set the section already holds. This is only what keeps the
 * picker from offering a dead end; the rule itself lives at the seam,
 * where the tree cannot change underneath it.
 *
 * The record root is not in the answer, because it is not a folder. The
 * picker offers it as its own option.
 */
export function movableInto(
  folders: readonly ContractFolder[],
  folderId: string,
): ContractFolder[] {
  const barred = new Set<string>([folderId]);
  // The set arrives with parents before children only by accident of
  // name order, so the closure is taken by repeated passes rather than
  // by one walk. A record's folder set is small enough that this is
  // cheaper than building an index for it.
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parentId !== null && barred.has(folder.parentId) && !barred.has(folder.id)) {
        barred.add(folder.id);
        grew = true;
      }
    }
  }
  return folders.filter((folder) => !barred.has(folder.id));
}

/**
 * The path from the record root down to one folder, as a person reads
 * it — "Correspondence / 2026 / Q1".
 *
 * The move picker names each destination this way, because a bare "2026"
 * says nothing when two groupings each have one.
 *
 * The separator is passed in rather than written here: it is a mark a
 * reader reads, so it is a message the caller formats like every other
 * one (DES-013). This file holds no locale of its own. The spaces
 * around it are put on here, because spacing is layout rather than
 * language — and because the extractor trims a message's edges, so a
 * separator that carried its own would say one thing in the catalog and
 * another on screen.
 */
export function pathOf(
  folders: readonly ContractFolder[],
  folder: ContractFolder,
  separator: string,
): string {
  const names: string[] = [];
  let at: ContractFolder | undefined = folder;
  // Bounded by the set's own size: the seam refuses a cycle, and a
  // client that trusted that without a bound would hang rather than
  // draw a wrong name.
  for (let step = 0; at && step <= folders.length; step += 1) {
    names.unshift(at.name);
    const parentId: string | null = at.parentId;
    at = parentId === null ? undefined : folders.find((row) => row.id === parentId);
  }
  return names.join(` ${separator} `);
}

/** Reads one contract's folders, whole. */
export async function readContractFolders(contractNumber: number): Promise<FoldersOutcome> {
  const result = await api
    .GET("/api/v1/contracts/{number}/folders", {
      params: { path: { number: contractNumber } },
    })
    .catch(() => undefined);
  return foldersOutcome(result);
}

export async function readRecordFolders(record: DocumentRecord): Promise<FoldersOutcome> {
  switch (record.entityType) {
    case "contract":
      return readContractFolders(record.number);
    case "matter": {
      const result = await api
        .GET("/api/v1/matters/{number}/folders", {
          params: { path: { number: record.number } },
        })
        .catch(() => undefined);
      return foldersOutcome(result);
    }
  }
}

/** Creates a folder on the record, at the root or inside another one. */
export async function createContractFolder(
  contractNumber: number,
  folder: Readonly<{ name: string; parentId?: string }>,
): Promise<FoldersOutcome> {
  const result = await api
    .POST("/api/v1/contracts/{number}/folders", {
      params: { path: { number: contractNumber } },
      body: folder,
    })
    .catch(() => undefined);
  return foldersOutcome(result);
}

export async function createRecordFolder(
  record: DocumentRecord,
  folder: Readonly<{ name: string; parentId?: string }>,
): Promise<FoldersOutcome> {
  switch (record.entityType) {
    case "contract":
      return createContractFolder(record.number, folder);
    case "matter": {
      const result = await api
        .POST("/api/v1/matters/{number}/folders", {
          params: { path: { number: record.number } },
          body: folder,
        })
        .catch(() => undefined);
      return foldersOutcome(result);
    }
  }
}

/**
 * Recreates one empty directory of a dropped tree (M13/5, DOC-011).
 *
 * A dropped directory that holds files is recreated by those files —
 * each upload carries the path and the seam find-or-creates it. One that
 * holds none has nothing to recreate it, so it is asked for on its own,
 * and it is asked for by **path** rather than by name: every level above
 * it may be missing too, and the seam makes the chain segment by segment
 * under the owning contract's row lock.
 *
 * `parentId` is the folder the tree was dropped on, and the path is
 * relative to it.
 *
 * It writes no activity, unlike {@link createContractFolder} (DD-017): a
 * folder a drop passed through is traversal rather than an act somebody
 * performed. A segment already there is used rather than refused, which
 * is what lets an empty directory sit beside its full siblings.
 */
export async function recreateContractFolderPath(
  contractNumber: number,
  folder: Readonly<{ path: readonly string[]; parentId?: string }>,
): Promise<FoldersOutcome> {
  const result = await api
    .POST("/api/v1/contracts/{number}/folders", {
      params: { path: { number: contractNumber } },
      body: {
        path: folder.path.join(PATH_SEPARATOR),
        ...(folder.parentId ? { parentId: folder.parentId } : {}),
      },
    })
    .catch(() => undefined);
  return foldersOutcome(result);
}

export async function recreateRecordFolderPath(
  record: DocumentRecord,
  folder: Readonly<{ path: readonly string[]; parentId?: string }>,
): Promise<FoldersOutcome> {
  switch (record.entityType) {
    case "contract":
      return recreateContractFolderPath(record.number, folder);
    case "matter": {
      const result = await api
        .POST("/api/v1/matters/{number}/folders", {
          params: { path: { number: record.number } },
          body: {
            path: folder.path.join(PATH_SEPARATOR),
            ...(folder.parentId ? { parentId: folder.parentId } : {}),
          },
        })
        .catch(() => undefined);
      return foldersOutcome(result);
    }
  }
}

/**
 * Renames a folder, moves it under a different parent, or both.
 *
 * `parentId: null` is the move to the record root, and it is a different
 * request from omitting the field — which moves nothing.
 */
export async function updateContractFolder(
  folderId: string,
  patch: Readonly<{ name?: string; parentId?: string | null }>,
): Promise<FoldersOutcome> {
  const result = await api
    .PATCH("/api/v1/folders/{folderId}", {
      params: { path: { folderId } },
      body: patch,
    })
    .catch(() => undefined);
  return foldersOutcome(result);
}

/**
 * Dissolves a folder (DOC-006).
 *
 * It destroys nothing: the child folders are re-filed into its parent —
 * the record root when it had none — so the whole set comes back and the
 * caller replaces what it holds.
 */
export async function deleteContractFolder(folderId: string): Promise<FoldersOutcome> {
  const result = await api
    .DELETE("/api/v1/folders/{folderId}", {
      params: { path: { folderId } },
    })
    .catch(() => undefined);
  return foldersOutcome(result);
}
