// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The local filesystem driver against a temporary directory: the shared
 * contract suite every driver must pass, plus the few facts that are
 * only true of this driver (where the bytes land, what the root looks
 * like afterwards).
 */

import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeStorageAdapterContract } from "../../testing/storage-contract.js";
import { BlobExistsError, BlobNotFoundError, InvalidBlobRefError } from "./adapter.js";
import { LOCAL_DRIVER, createLocalStorage } from "./local.js";

async function makeRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "openlaw-storage-"));
}

describeStorageAdapterContract(LOCAL_DRIVER, async () => {
  const root = await makeRoot();
  return {
    adapter: createLocalStorage({ root }),
    stop: () => rm(root, { recursive: true, force: true }),
  };
});

describe("local filesystem driver", () => {
  let root: string;

  beforeEach(async () => {
    root = await makeRoot();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("stores the blob at its key under the configured root", async () => {
    const storage = createLocalStorage({ root });

    await storage.put("nested/key-1", Readable.from(["the executed copy"]));

    expect(await readFile(join(root, "nested", "key-1"), "utf8")).toBe("the executed copy");
  });

  it("does not create the root until the first write", async () => {
    const unused = join(root, "not-yet");
    createLocalStorage({ root: unused });

    await expect(stat(unused)).rejects.toThrow();
  });

  it("creates the root on the first write", async () => {
    const late = join(root, "made-on-demand");
    const storage = createLocalStorage({ root: late });

    await storage.put("key-1", Readable.from(["bytes"]));

    expect(await readFile(join(late, "key-1"), "utf8")).toBe("bytes");
  });

  it("leaves no partial file behind when the source stream fails", async () => {
    const storage = createLocalStorage({ root });
    const failing = new Readable({
      read() {
        this.push(Buffer.from("half a"));
        this.destroy(new Error("the upload was cut off"));
      },
    });

    await expect(storage.put("key-1", failing)).rejects.toThrow("the upload was cut off");

    expect(await readdir(root)).toEqual([]);
  });

  it("leaves no partial file behind when the key is already written", async () => {
    const storage = createLocalStorage({ root });
    await storage.put("key-1", Readable.from(["round one"]));

    await expect(storage.put("key-1", Readable.from(["round two"]))).rejects.toThrow();

    expect(await readdir(root)).toEqual(["key-1"]);
  });

  it("lets exactly one of two writers of the same key win", async () => {
    const storage = createLocalStorage({ root });

    const results = await Promise.allSettled([
      storage.put("key-1", Readable.from(["round one"])),
      storage.put("key-1", Readable.from(["round two"])),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(BlobExistsError);
    // The winner's bytes are what is stored, whole — never a mix.
    expect(["round one", "round two"]).toContain(await readFile(join(root, "key-1"), "utf8"));
  });

  it("accepts a delete for a key that is a directory of nested blobs", async () => {
    const storage = createLocalStorage({ root });
    await storage.put("key-1/child", Readable.from(["a nested blob"]));

    await expect(storage.delete(`${LOCAL_DRIVER}:key-1`)).resolves.toBeUndefined();

    expect(await readFile(join(root, "key-1", "child"), "utf8")).toBe("a nested blob");
  });

  it("refuses a reference that escapes the root", async () => {
    const storage = createLocalStorage({ root });

    await expect(storage.get(`${LOCAL_DRIVER}:../outside`)).rejects.toBeInstanceOf(
      InvalidBlobRefError,
    );
  });

  it("reports a directory in the way of a key as a missing blob", async () => {
    const storage = createLocalStorage({ root });
    await storage.put("key-1/child", Readable.from(["a nested blob"]));

    await expect(storage.get(`${LOCAL_DRIVER}:key-1`)).rejects.toBeInstanceOf(BlobNotFoundError);
  });
});
