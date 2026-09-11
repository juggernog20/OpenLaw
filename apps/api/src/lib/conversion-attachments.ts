// SPDX-License-Identifier: AGPL-3.0-only
/** INT-008 and DOC-005: bounded Request attachment reads through storage and the document engine. */
import { uuidv7 } from "uuidv7";
import { Readable } from "node:stream";
import type { ConversionAttachmentRead } from "@openlaw/shared";
import { UnsupportedFormatError, type DocEngine } from "./doc-engine/engine.js";
import type { StorageAdapter } from "./storage/adapter.js";
import { mediaTypeOfBlob } from "./media-type.js";
import { conversionFormatOf, renderFamilyOf } from "./render-family.js";
import { emailBodyText, parseStoredEmail } from "./email/parse.js";
import { hasUsableTextLayer } from "../pipeline/text-extraction.js";

export const ATTACHMENT_LIMITS = {
  sources: 20,
  bytes: 10 * 1024 * 1024,
  totalBytes: 50 * 1024 * 1024,
  characters: 30_000,
  totalCharacters: 180_000,
  sourceRuntimeMs: 15_000,
  runtimeMs: 45_000,
} as const;
export class AttachmentBudgetError extends Error {
  constructor(readonly reason: "byte_limit" | "runtime_limit") {
    super(reason);
  }
}
export async function boundedBytes(
  stream: Readable,
  max = ATTACHMENT_LIMITS.bytes,
  onBytes?: (size: number) => void,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      onBytes?.(bytes.length);
      if (size > max) throw new AttachmentBudgetError("byte_limit");
      chunks.push(bytes);
    }
    return Buffer.concat(chunks);
  } finally {
    stream.destroy();
  }
}
export async function extractAttachment(
  engine: DocEngine,
  filename: string,
  bytes: Buffer,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const mimeType = mediaTypeOfBlob(bytes, filename);
  const format = conversionFormatOf(mimeType, filename);
  const family = renderFamilyOf(mimeType, filename);
  let text = "";
  let pdf: Buffer | undefined;
  let method: ConversionAttachmentRead["method"];
  if (format) {
    pdf = await boundedBytes(await engine.convertToPdf(Readable.from([bytes]), format));
    signal?.throwIfAborted();
    text = await engine.extractPdfText(Readable.from([pdf]));
    method = "converted";
  } else if (family === "pdf") {
    text = await engine.extractPdfText(Readable.from([bytes]));
    method = "native_layer";
    if (!hasUsableTextLayer(text)) {
      signal?.throwIfAborted();
      text = await engine.ocrPdf(Readable.from([bytes]));
      method = "ocr";
    }
  } else if (family === "email") {
    text = emailBodyText(await parseStoredEmail(Readable.from([bytes]), mimeType, filename));
    method = "email_body";
  } else return { text, mimeType, status: "unsupported" as const };
  signal?.throwIfAborted();
  const status = !text.trim()
    ? "unreadable"
    : text.length > ATTACHMENT_LIMITS.characters
      ? "truncated"
      : "readable";
  return {
    text: text.slice(0, ATTACHMENT_LIMITS.characters),
    mimeType,
    method,
    pdf,
    status,
  } as const;
}

export interface AttachmentSource {
  id: string;
  revision: string;
  label: string;
  fileRef: string;
  restricted: boolean;
  versionId: string | null;
}
/** Sequential ordering fixes which sources survive the shared budgets. No storage key comes from a filename. */
export async function readConversionAttachments(
  deps: { storage: StorageAdapter; docEngine: DocEngine },
  sources: AttachmentSource[],
  draftId: string,
  remainingCharacters: number,
): Promise<ConversionAttachmentRead[]> {
  const reads: ConversionAttachmentRead[] = [];
  const deadline = Date.now() + ATTACHMENT_LIMITS.runtimeMs;
  let bytesLeft = ATTACHMENT_LIMITS.totalBytes as number;
  let count = 0;
  for (const source of sources) {
    const read: ConversionAttachmentRead = {
      sourceId: source.id,
      revision: source.revision,
      label: source.label,
      status: "omitted",
      text: "",
    };
    reads.push(read);
    if (source.restricted) {
      read.reason = "restricted";
      continue;
    }
    if (count++ >= ATTACHMENT_LIMITS.sources) {
      read.reason = "source_limit";
      continue;
    }
    if (remainingCharacters <= 0) {
      read.reason = "character_limit";
      continue;
    }
    if (bytesLeft <= 0) {
      read.reason = "byte_limit";
      continue;
    }
    if (Date.now() >= deadline) {
      read.reason = "runtime_limit";
      continue;
    }
    let timer: NodeJS.Timeout | undefined;
    let stream: Readable | undefined;
    let expired = false;
    const controller = new AbortController();
    try {
      const result = await Promise.race([
        (async () => {
          stream = await deps.storage.get(source.fileRef);
          if (expired) {
            stream.destroy();
            throw new Error("expired");
          }
          const bytes = await boundedBytes(
            stream,
            Math.min(ATTACHMENT_LIMITS.bytes, bytesLeft),
            (size) => {
              controller.signal.throwIfAborted();
              bytesLeft -= size;
            },
          );
          const extracted = await extractAttachment(
            deps.docEngine,
            source.label,
            bytes,
            controller.signal,
          );
          if (expired) throw new Error("expired");
          let previewRef: string | undefined;
          if (extracted.pdf) {
            stream = Readable.from([extracted.pdf]);
            previewRef = await deps.storage.put(
              `conversion-drafts/${draftId}/${uuidv7()}.pdf`,
              stream,
            );
            if (expired) {
              await deps.storage.delete(previewRef);
              throw new Error("expired");
            }
          } else if (extracted.method === "native_layer" || extracted.method === "ocr")
            previewRef = source.fileRef;
          return { ...extracted, previewRef, byteSize: bytes.length };
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => {
              expired = true;
              controller.abort();
              stream?.destroy();
              reject(new AttachmentBudgetError("runtime_limit"));
            },
            Math.min(ATTACHMENT_LIMITS.sourceRuntimeMs, deadline - Date.now()),
          );
        }),
      ]);
      read.status = result.status;
      read.text = result.text.slice(0, remainingCharacters);
      read.mimeType = result.mimeType;
      read.method = result.method;
      read.byteSize = result.byteSize;
      if (read.text.length < result.text.length || result.status === "truncated") {
        read.status = "truncated";
        read.reason = "character_limit";
      }
      remainingCharacters -= read.text.length;
      read.previewRef = result.previewRef;
    } catch (error) {
      read.status =
        error instanceof AttachmentBudgetError
          ? "omitted"
          : error instanceof UnsupportedFormatError
            ? "unsupported"
            : "unreadable";
      if (error instanceof AttachmentBudgetError) read.reason = error.reason;
    } finally {
      clearTimeout(timer);
      stream?.destroy();
    }
  }
  return reads;
}
