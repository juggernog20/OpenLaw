// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The local filesystem driver (DOC-009, TECH-014) — the default, and the
 * reason a self-hoster can store files with no extra service to run. It
 * roots at a configured directory; in the blessed Compose stack that
 * directory is a named volume, so files survive container restarts
 * (TECH-005).
 *
 * The driver name is `local`, so every reference it writes reads
 * `local:<key>`.
 */

import { createWriteStream } from "node:fs";
import { link, mkdir, open, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import {
  BlobExistsError,
  BlobNotFoundError,
  InvalidBlobRefError,
  assertValidBlobKey,
  formatBlobRef,
  parseBlobRef,
  type StorageAdapter,
} from "./adapter.js";

/** The driver name this module registers under, and its reference prefix. */
export const LOCAL_DRIVER = "local";

/**
 * Where blobs live when `STORAGE_PATH` is unset. The blessed Compose
 * stack mounts the `openlaw-files` named volume here (TECH-005); a
 * bare-process deployment sets `STORAGE_PATH` to somewhere its own user
 * can write.
 */
export const DEFAULT_STORAGE_PATH = "/var/lib/openlaw/files";

/** The error code of a Node filesystem rejection, when it carries one. */
function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

export interface LocalStorageOptions {
  /** The directory every blob is stored under. */
  root: string;
}

/**
 * Builds the local filesystem driver over `root`.
 *
 * The root is not created here. Startup only reads configuration; the
 * directory appears with the first write, so an install that never
 * uploads a file never makes one.
 */
export function createLocalStorage({ root }: LocalStorageOptions): StorageAdapter {
  const rootPath = resolve(root);
  // Every path this driver touches must sit under the root. The key
  // rules already forbid `..` and absolute keys, so this is the second
  // lock on the same door — cheap, and it keeps the guarantee true even
  // if the key rules ever widen.
  const rootPrefix = rootPath.endsWith(sep) ? rootPath : rootPath + sep;

  function pathOf(key: string): string {
    const path = resolve(join(rootPath, ...key.split("/")));
    if (!path.startsWith(rootPrefix)) {
      throw new InvalidBlobRefError(`${JSON.stringify(key)} resolves outside the storage root.`);
    }
    return path;
  }

  return {
    driver: LOCAL_DRIVER,

    async put(key, body) {
      assertValidBlobKey(key);
      const path = pathOf(key);
      const directory = dirname(path);
      await mkdir(directory, { recursive: true });

      // A blob becomes visible in one step: written to a temporary name
      // beside it, then linked into place. A write that fails part way
      // — a cut-off upload, a full disk — therefore leaves nothing at
      // the key, and no reader ever sees half a file.
      const temporary = join(directory, `.partial-${randomUUID()}`);
      try {
        // `wx` — a temporary name that already exists is a bug, not a
        // file to overwrite.
        await pipeline(body, createWriteStream(temporary, { flags: "wx" }));
        // `link`, not `rename`: rename replaces whatever is at the
        // destination, and blobs are immutable. link refuses an
        // existing destination in one atomic step, so two writers of
        // one key cannot both believe they won.
        try {
          await link(temporary, path);
        } catch (error) {
          if (errorCode(error) === "EEXIST") {
            throw new BlobExistsError(formatBlobRef(LOCAL_DRIVER, key));
          }
          throw error;
        }
      } finally {
        await rm(temporary, { force: true });
      }

      return formatBlobRef(LOCAL_DRIVER, key);
    },

    async get(ref): Promise<Readable> {
      const path = pathOf(parseBlobRef(ref, LOCAL_DRIVER));
      // Opened before the stream is built, so a missing blob rejects
      // the call instead of emitting an error at a caller that has
      // already started piping.
      let handle;
      try {
        handle = await open(path, "r");
      } catch (error) {
        const code = errorCode(error);
        if (code === "ENOENT" || code === "EISDIR") throw new BlobNotFoundError(ref);
        throw error;
      }
      try {
        // A directory opens without complaint on Linux and only fails
        // on the first read. A key whose path is a directory — the
        // prefix of some nested key — holds no blob, so it answers the
        // same way a key that was never written does.
        if ((await handle.stat()).isDirectory()) throw new BlobNotFoundError(ref);
      } catch (error) {
        await handle.close();
        throw error;
      }
      return handle.createReadStream({ autoClose: true });
    },

    async delete(ref) {
      const path = pathOf(parseBlobRef(ref, LOCAL_DRIVER));
      try {
        // `force` makes a missing blob a no-op, which is the contract:
        // hard deletion must be repeatable after a partial failure.
        await rm(path, { force: true });
      } catch (error) {
        // A key whose path is a directory — the prefix of some nested
        // key — holds no blob, so deleting it is the same no-op that
        // deleting a key never written is. `rm` without `recursive`
        // refuses a directory, and refusing to remove what was never a
        // blob is the right thing; only the error is wrong.
        if (errorCode(error) === "ERR_FS_EISDIR" || errorCode(error) === "EISDIR") return;
        throw error;
      }
    },
  };
}
