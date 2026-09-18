// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Storage reads that stop at a ceiling. A stored blob is as long as the
 * driver says it is, so a read that buffers it must count as it goes and
 * abort past the limit rather than hold whatever arrives.
 */
import { PassThrough, type Readable } from "node:stream";

/** The blob is longer than the ceiling the reader was given. */
export class BlobTooLargeError extends Error {
  constructor(readonly ceiling: number) {
    super(`The stored file is over the ${ceiling} byte limit.`);
    this.name = "BlobTooLargeError";
  }
}

/** Buffers `stream` and rejects with {@link BlobTooLargeError} once more than `ceiling` bytes arrive. */
export async function readBoundedBlob(stream: Readable, ceiling: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of stream) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.length;
    if (size > ceiling) {
      stream.destroy();
      throw new BlobTooLargeError(ceiling);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Passes `source` through and destroys both ends with
 * {@link BlobTooLargeError} once more than `ceiling` bytes have gone by.
 * For a consumer that streams rather than buffers.
 */
export function boundedBlobStream(source: Readable, ceiling: number): Readable {
  let size = 0;
  const guarded = new PassThrough({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > ceiling) {
        const error = new BlobTooLargeError(ceiling);
        source.destroy(error);
        callback(error);
        return;
      }
      callback(null, chunk);
    },
  });
  source.on("error", (error) => guarded.destroy(error));
  return source.pipe(guarded);
}
