// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { BodyTooLargeError, boundedReadable, readBoundedBody } from "./bounded-body.js";

/** A web stream that yields the given chunks and reports a cancel. */
function source(chunks: Uint8Array[]): { body: ReadableStream<Uint8Array>; cancelled: boolean } {
  const state = { body: null as unknown as ReadableStream<Uint8Array>, cancelled: false };
  let index = 0;
  state.body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks[index++];
      if (next) controller.enqueue(next);
      else controller.close();
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return state;
}

/** A web stream that never ends, so a byte ceiling is the only way out. */
function endless(chunkBytes: number): { body: ReadableStream<Uint8Array>; cancelled: boolean } {
  const state = { body: null as unknown as ReadableStream<Uint8Array>, cancelled: false };
  state.body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(chunkBytes));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return state;
}

async function drain(stream: AsyncIterable<Buffer>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

describe("readBoundedBody", () => {
  it("reads a body under the ceiling whole and reports each chunk", async () => {
    let chunks = 0;
    const bytes = await readBoundedBody(source([Buffer.from("ab"), Buffer.from("cd")]).body, {
      maxBytes: 4,
      onChunk: () => chunks++,
    });
    expect(bytes.toString("utf8")).toBe("abcd");
    expect(chunks).toBe(2);
  });

  it("reads an absent body as empty", async () => {
    expect((await readBoundedBody(null, { maxBytes: 1 })).length).toBe(0);
  });

  it("stops and cancels the source one byte past the ceiling", async () => {
    const stream = endless(1_000);
    await expect(readBoundedBody(stream.body, { maxBytes: 2_500 })).rejects.toBeInstanceOf(
      BodyTooLargeError,
    );
    expect(stream.cancelled).toBe(true);
  });
});

describe("boundedReadable", () => {
  it("passes the bytes through under the ceiling", async () => {
    const readable = boundedReadable(source([Buffer.from("%PDF"), Buffer.from("-1.7")]).body, {
      maxBytes: 8,
    });
    expect((await drain(readable)).toString("utf8")).toBe("%PDF-1.7");
  });

  it("fails the stream with the mapped error past the ceiling", async () => {
    const stream = endless(100);
    const readable = boundedReadable(stream.body, {
      maxBytes: 250,
      mapError: (error) =>
        error instanceof BodyTooLargeError ? new Error("mapped ceiling") : new Error("other"),
    });
    await expect(drain(readable)).rejects.toThrow("mapped ceiling");
    expect(stream.cancelled).toBe(true);
  });

  it("cancels the source when the consumer destroys the stream early", async () => {
    const stream = endless(100);
    const readable = boundedReadable(stream.body, { maxBytes: Number.MAX_SAFE_INTEGER });
    const first = await new Promise<Buffer>((resolve) => readable.once("data", resolve));
    expect(first.length).toBe(100);
    readable.destroy();
    await new Promise<void>((resolve) => readable.once("close", () => resolve()));
    // The generator's cleanup runs on the next turn after close.
    await new Promise((resolve) => setImmediate(resolve));
    expect(stream.cancelled).toBe(true);
  });

  it("maps a failure of the source too", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new DOMException("stalled", "TimeoutError"));
      },
    });
    const readable = boundedReadable(body, {
      maxBytes: 10,
      mapError: (error) =>
        error instanceof DOMException && error.name === "TimeoutError"
          ? new Error("mapped stall")
          : new Error("other"),
    });
    await expect(drain(readable)).rejects.toThrow("mapped stall");
  });
});
