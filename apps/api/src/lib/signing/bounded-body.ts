// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Bounded reads of a connector's response body.
 *
 * A provider answer is untrusted input like any other. `response.json()`
 * and `response.text()` buffer whatever arrives, and a `Readable` handed
 * to a job keeps flowing for as long as the socket stays open. Both
 * helpers here count bytes as they arrive and stop past a ceiling, and
 * both call back on every chunk so the caller can keep an idle deadline
 * running across the whole transfer rather than only until the headers.
 */

import { Readable } from "node:stream";

/** The body ran past the ceiling. The read is already cancelled. */
export class BodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`The response body is larger than ${String(maxBytes)} bytes.`);
    this.name = "BodyTooLargeError";
  }
}

export interface BoundedReadOptions {
  /** The most bytes the body may carry. One more is a {@link BodyTooLargeError}. */
  maxBytes: number;
  /** Called once per chunk received. A caller restarts its idle timer here. */
  onChunk?: () => void;
}

/**
 * Reads a whole body into memory, or throws once it runs past
 * `maxBytes`. An absent body reads as empty.
 */
export async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  options: BoundedReadOptions,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of boundedChunks(body, options)) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/**
 * A Node `Readable` over a web stream that counts bytes and reports each
 * chunk. Past `maxBytes` the stream fails with a {@link BodyTooLargeError}
 * and the source is cancelled. Destroying the readable early cancels the
 * source too. `mapError` turns a failure, from the source or from the
 * ceiling, into the error the consumer should see.
 */
export function boundedReadable(
  body: ReadableStream<Uint8Array> | null,
  options: BoundedReadOptions & { mapError?: (error: unknown) => Error },
): Readable {
  const map = options.mapError ?? ((error: unknown) => asError(error));
  async function* mapped(): AsyncGenerator<Buffer> {
    try {
      yield* boundedChunks(body, options);
    } catch (error) {
      throw map(error);
    }
  }
  return Readable.from(mapped());
}

async function* boundedChunks(
  body: ReadableStream<Uint8Array> | null,
  options: BoundedReadOptions,
): AsyncGenerator<Buffer> {
  if (!body) return;
  const reader = body.getReader();
  let readBytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) return;
      options.onChunk?.();
      readBytes += part.value.byteLength;
      if (readBytes > options.maxBytes) throw new BodyTooLargeError(options.maxBytes);
      yield Buffer.from(part.value.buffer, part.value.byteOffset, part.value.byteLength);
    }
  } finally {
    // Reached on the ceiling, on a source failure, and when the consumer
    // stops early. The cancel tells the socket to stop sending.
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
