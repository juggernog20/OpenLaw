// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Copy an immutable stored blob while deriving the facts a Version row
 * records, as required by INT-002's M21/10 attachment-promotion addendum.
 */

import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { mediaTypeOfBlob, MEDIA_TYPE_HEAD_BYTES } from "./media-type.js";
import type { StorageAdapter } from "./storage/adapter.js";

export interface CopiedStoredBlob {
  fileRef: string;
  mimeType: string;
  byteSize: number;
  checksumSha256: string;
}

/**
 * Copies one blob in one streaming pass, taking its checksum, size, and
 * byte-sniffed media type on the way through. The filename only
 * distinguishes container formats such as DOCX; it never overrules the
 * bytes.
 */
export async function copyStoredBlob(
  storage: StorageAdapter,
  from: string,
  to: Readonly<{ key: string; filename: string }>,
): Promise<CopiedStoredBlob> {
  const source = await storage.get(from);
  const digest = createHash("sha256");
  let byteSize = 0;
  const head: Buffer[] = [];
  let headBytes = 0;
  async function* metered(stream: AsyncIterable<Buffer>) {
    for await (const chunk of stream) {
      digest.update(chunk);
      byteSize += chunk.length;
      if (headBytes < MEDIA_TYPE_HEAD_BYTES) {
        const wanted = chunk.subarray(0, MEDIA_TYPE_HEAD_BYTES - headBytes);
        head.push(wanted);
        headBytes += wanted.length;
      }
      yield chunk;
    }
  }
  try {
    const fileRef = await storage.put(to.key, Readable.from(metered(source)));
    return {
      fileRef,
      mimeType: mediaTypeOfBlob(Buffer.concat(head), to.filename),
      byteSize,
      checksumSha256: digest.digest("hex"),
    };
  } finally {
    source.destroy();
  }
}
