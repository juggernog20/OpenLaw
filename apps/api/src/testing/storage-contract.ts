// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The shared storage-driver contract suite (DOC-009, TECH-014).
 *
 * There is one suite, and every driver behind {@link StorageAdapter}
 * must pass it: the local filesystem driver against a temporary
 * directory, and the S3-compatible driver against a MinIO container.
 * A behaviour that only one driver has is not in here. This file is
 * the definition of what "a storage driver" means in OpenLaw, so
 * application code can hold one mental model of storage and be right on
 * every deployment.
 *
 * The suite writes only keys it mints itself, so a driver may share one
 * live backing store across the whole run.
 */

import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BlobExistsError,
  BlobNotFoundError,
  InvalidBlobRefError,
  // Imported, never restated: the boundary tests below must measure the
  // bound the adapter enforces, not a copy of it that can drift.
  MAX_KEY_LENGTH,
  type StorageAdapter,
} from "../lib/storage/adapter.js";

export interface StorageContractHarness {
  adapter: StorageAdapter;
  /** Tears the backing store down: a temporary directory, a container. */
  stop?: () => Promise<void>;
}

export interface StorageContractOptions {
  /**
   * Bound for `start`, for a driver that needs more than the package's
   * own `hookTimeout`. Unset means the bound in `vitest.config.ts`.
   */
  startTimeoutMs?: number;
}

/** A readable over fixed bytes, as an upload handler would hand over. */
function bytes(source: Buffer | string): Readable {
  return Readable.from([Buffer.from(source)]);
}

/** Everything a stream yields, as one buffer. */
async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** Keys are never reused, so every test mints its own. */
function newKey(prefix = "contract"): string {
  return `${prefix}-${randomUUID()}`;
}

/** Keys no driver may accept. Each one either escapes a root or breaks a reference. */
const MALFORMED_KEYS = [
  "", // empty
  "/leading-slash",
  "trailing-slash/",
  "double//slash",
  "..",
  "../escapes-the-root",
  "inside/../../escapes-the-root",
  "/absolute/path",
  "back\\slash",
  "holds:the-separator",
  "holds space",
  ".hidden",
  "holds-a-tab\tcharacter",
  "unicode-é",
] as const;

/**
 * A key of exactly `length` characters, in segments short enough that no
 * filesystem's own per-component limit is what the test measures.
 */
function keyOfLength(length: number): string {
  let key = "";
  while (key.length < length) {
    if (key.length > 0) key += "/";
    key += "k".repeat(Math.min(64, length - key.length));
  }
  return key;
}

/**
 * Runs the contract against one driver. `start` builds the adapter over
 * a throwaway backing store; its `stop` tears that store down.
 */
export function describeStorageAdapterContract(
  driverName: string,
  start: () => Promise<StorageContractHarness>,
  options: StorageContractOptions = {},
): void {
  describe(`storage adapter contract: ${driverName}`, () => {
    let harness: StorageContractHarness;
    let adapter: StorageAdapter;

    beforeAll(async () => {
      harness = await start();
      adapter = harness.adapter;
    }, options.startTimeoutMs);

    afterAll(async () => {
      // Optional on the harness too, not only on `stop`. If `start`
      // rejected, `harness` was never assigned, and reaching through it
      // here would make a TypeError the thing the run reports, burying
      // the container or directory failure that happened.
      await harness?.stop?.();
    });

    describe("put", () => {
      it("answers the driver-prefixed reference of the key it wrote", async () => {
        const key = newKey();
        const ref = await adapter.put(key, bytes("a draft"));
        expect(ref).toBe(`${adapter.driver}:${key}`);
      });

      it("names the driver it was built as", () => {
        expect(adapter.driver).toBe(driverName);
      });

      it("refuses a second write at the same key and leaves the first blob intact", async () => {
        const key = newKey();
        const ref = await adapter.put(key, bytes("round one"));

        await expect(adapter.put(key, bytes("round two"))).rejects.toBeInstanceOf(BlobExistsError);

        expect((await collect(await adapter.get(ref))).toString()).toBe("round one");
      });

      it.each(MALFORMED_KEYS)("refuses the malformed key %j", async (key) => {
        await expect(adapter.put(key, bytes("nowhere"))).rejects.toBeInstanceOf(
          InvalidBlobRefError,
        );
      });

      it(`accepts a key of the full ${MAX_KEY_LENGTH} characters`, async () => {
        const key = keyOfLength(MAX_KEY_LENGTH);
        const ref = await adapter.put(key, bytes("as long as a key goes"));
        expect((await collect(await adapter.get(ref))).toString()).toBe("as long as a key goes");
      });

      it(`refuses a key one character over ${MAX_KEY_LENGTH}`, async () => {
        await expect(
          adapter.put(keyOfLength(MAX_KEY_LENGTH + 1), bytes("nowhere")),
        ).rejects.toBeInstanceOf(InvalidBlobRefError);
      });

      it("leaves no blob behind when the source stream fails", async () => {
        const key = newKey();
        // Bytes first, then the failure. A stream that dies before it
        // yields anything would not prove that a half-written blob is
        // cleaned up.
        const failing = Readable.from(
          (async function* () {
            yield Buffer.from("the first half of a draft");
            throw new Error("the upload was cut off");
          })(),
        );

        await expect(adapter.put(key, failing)).rejects.toThrow();

        await expect(adapter.get(`${adapter.driver}:${key}`)).rejects.toBeInstanceOf(
          BlobNotFoundError,
        );
      });
    });

    describe("get", () => {
      it("streams back exactly the bytes that were put", async () => {
        const ref = await adapter.put(newKey(), bytes("the counterparty's redline"));
        expect((await collect(await adapter.get(ref))).toString()).toBe(
          "the counterparty's redline",
        );
      });

      it("round-trips a blob with no bytes", async () => {
        const ref = await adapter.put(newKey(), bytes(""));
        expect((await collect(await adapter.get(ref))).byteLength).toBe(0);
      });

      it("round-trips binary bytes unchanged", async () => {
        const binary = Buffer.from(Array.from({ length: 256 }, (_value, index) => index));
        const ref = await adapter.put(newKey(), bytes(binary));
        expect((await collect(await adapter.get(ref))).equals(binary)).toBe(true);
      });

      it("round-trips a blob larger than a single stream chunk", async () => {
        const large = Buffer.alloc(1024 * 1024, "x");
        const ref = await adapter.put(newKey(), bytes(large));
        const read = await collect(await adapter.get(ref));
        expect(read.byteLength).toBe(large.byteLength);
        expect(read.equals(large)).toBe(true);
      });

      it("round-trips a key of slash-separated segments", async () => {
        const key = `${newKey("documents")}/versions/${newKey("v1")}`;
        const ref = await adapter.put(key, bytes("nested"));
        expect((await collect(await adapter.get(ref))).toString()).toBe("nested");
      });

      it("keeps separate keys separate", async () => {
        const first = await adapter.put(newKey(), bytes("our draft"));
        const second = await adapter.put(newKey(), bytes("their redline"));
        expect((await collect(await adapter.get(first))).toString()).toBe("our draft");
        expect((await collect(await adapter.get(second))).toString()).toBe("their redline");
      });

      it("refuses a key that was never written", async () => {
        await expect(adapter.get(`${adapter.driver}:${newKey()}`)).rejects.toBeInstanceOf(
          BlobNotFoundError,
        );
      });

      it("refuses a reference that names another driver", async () => {
        await expect(adapter.get(`not-${adapter.driver}:${newKey()}`)).rejects.toBeInstanceOf(
          InvalidBlobRefError,
        );
      });

      it("refuses a reference with no driver prefix", async () => {
        await expect(adapter.get(newKey())).rejects.toBeInstanceOf(InvalidBlobRefError);
      });

      it.each(MALFORMED_KEYS)("refuses a reference holding the malformed key %j", async (key) => {
        await expect(adapter.get(`${adapter.driver}:${key}`)).rejects.toBeInstanceOf(
          InvalidBlobRefError,
        );
      });
    });

    describe("delete", () => {
      it("removes the blob, after which a get refuses the reference", async () => {
        const ref = await adapter.put(newKey(), bytes("uploaded by mistake"));

        await adapter.delete(ref);

        await expect(adapter.get(ref)).rejects.toBeInstanceOf(BlobNotFoundError);
      });

      it("accepts a key that was never written", async () => {
        await expect(adapter.delete(`${adapter.driver}:${newKey()}`)).resolves.toBeUndefined();
      });

      it("accepts the same reference twice", async () => {
        const ref = await adapter.put(newKey(), bytes("gone soon"));
        await adapter.delete(ref);
        await expect(adapter.delete(ref)).resolves.toBeUndefined();
      });

      it("leaves other blobs alone", async () => {
        const doomed = await adapter.put(newKey(), bytes("doomed"));
        const kept = await adapter.put(newKey(), bytes("kept"));

        await adapter.delete(doomed);

        expect((await collect(await adapter.get(kept))).toString()).toBe("kept");
      });

      it("refuses a reference that names another driver", async () => {
        await expect(adapter.delete(`not-${adapter.driver}:${newKey()}`)).rejects.toBeInstanceOf(
          InvalidBlobRefError,
        );
      });

      it("refuses a reference with no driver prefix", async () => {
        await expect(adapter.delete(newKey())).rejects.toBeInstanceOf(InvalidBlobRefError);
      });

      it.each(MALFORMED_KEYS)("refuses a reference holding the malformed key %j", async (key) => {
        await expect(adapter.delete(`${adapter.driver}:${key}`)).rejects.toBeInstanceOf(
          InvalidBlobRefError,
        );
      });
    });
  });
}
