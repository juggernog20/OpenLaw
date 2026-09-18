// SPDX-License-Identifier: AGPL-3.0-only

/** Storage reads stop at the ceiling instead of holding whatever arrives. */
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { expect, it } from "vitest";
import { BlobTooLargeError, boundedBlobStream, readBoundedBlob } from "./bounded-blob.js";

const chunks = (...sizes: number[]) => Readable.from(sizes.map((size) => Buffer.alloc(size, 1)));

it("returns the whole blob when it fits under the ceiling", async () => {
  expect((await readBoundedBlob(chunks(10, 10), 20)).byteLength).toBe(20);
});
it("rejects and stops reading once the bytes pass the ceiling", async () => {
  const source = chunks(10, 11, 1000);
  await expect(readBoundedBlob(source, 20)).rejects.toBeInstanceOf(BlobTooLargeError);
  expect(source.destroyed).toBe(true);
});
it("fails a streaming consumer past the ceiling and passes one under it", async () => {
  expect((await buffer(boundedBlobStream(chunks(10, 10), 20))).byteLength).toBe(20);
  const source = chunks(10, 11, 1000);
  await expect(buffer(boundedBlobStream(source, 20))).rejects.toBeInstanceOf(BlobTooLargeError);
  expect(source.destroyed).toBe(true);
});
