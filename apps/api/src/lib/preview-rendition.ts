// SPDX-License-Identifier: AGPL-3.0-only

/**
 * One stored PDF preview per attachment (DOC-012).
 *
 * A preview of a Word or RTF attachment is a LibreOffice run in the
 * doc engine. Without a store, every GET was one run, so one person
 * holding refresh was one run per keypress and a whole team on the
 * same file was a queue. The first GET pays for the conversion and
 * stores the answer under a key the caller chooses; every GET after
 * it streams the stored rendition. A parallel first GET that loses
 * the write reads the winner's copy: the same bytes always convert
 * the same way.
 *
 * The caller maps doc engine errors to its own HTTP answers. This
 * helper stores nothing when the conversion fails, so the next GET
 * tries again.
 */

import type { Readable } from "node:stream";
import type { ConvertibleFormat, DocEngine } from "./doc-engine/engine.js";
import {
  BlobExistsError,
  BlobNotFoundError,
  formatBlobRef,
  type StorageAdapter,
} from "./storage/adapter.js";

export async function cachedPdfRendition(input: {
  storage: StorageAdapter;
  docEngine: DocEngine;
  /** The storage key the rendition lives under. */
  key: string;
  format: ConvertibleFormat;
  /** Opens the original bytes. Called only when nothing is stored yet. */
  readSource: () => Promise<Readable>;
}): Promise<Readable> {
  const { storage, docEngine, key, format, readSource } = input;
  const ref = formatBlobRef(storage.driver, key);
  const stored = async (): Promise<Readable | null> => {
    try {
      return await storage.get(ref);
    } catch (error) {
      if (error instanceof BlobNotFoundError) return null;
      throw error;
    }
  };
  const existing = await stored();
  if (existing) return existing;

  const source = await readSource();
  let pdf: Readable;
  try {
    pdf = await docEngine.convertToPdf(source, format);
  } catch (error) {
    source.destroy();
    throw error;
  }
  try {
    await storage.put(key, pdf);
  } catch (error) {
    pdf.destroy();
    // A parallel GET stored it first. Its bytes are as good as ours.
    if (!(error instanceof BlobExistsError)) throw error;
  }
  const rendition = await stored();
  if (!rendition) throw new Error("The stored preview could not be read back.");
  return rendition;
}
