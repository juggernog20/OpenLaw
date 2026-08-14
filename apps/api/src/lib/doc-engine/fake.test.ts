// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The deterministic fake against the shared contract, plus the two facts
 * that are only true of a fake: that the same bytes always answer with
 * the same bytes, and that a suite can state what it will answer without
 * running it first.
 *
 * The fidelity tier is deliberately absent — see the note at the top of
 * testing/doc-engine-contract.ts.
 */

import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  DOC_ENGINE_FIXTURES,
  describeDocEngineContract,
} from "../../testing/doc-engine-contract.js";
import { createFakeDocEngine, fakeConversionText, fakeOcrText } from "./fake.js";

describeDocEngineContract("deterministic fake", () =>
  Promise.resolve({ engine: createFakeDocEngine() }),
);

/** Everything a stream yields, as one buffer. */
async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

describe("deterministic fake", () => {
  const engine = createFakeDocEngine();

  it("converts the same source to the very same bytes", async () => {
    // Determinism is the whole reason the fake exists: a suite asserts
    // what a rendition is, not merely that one appeared.
    const first = await collect(
      await engine.convertToPdf(Readable.from([DOC_ENGINE_FIXTURES.plainDocx]), "docx"),
    );
    const second = await collect(
      await engine.convertToPdf(Readable.from([DOC_ENGINE_FIXTURES.plainDocx]), "docx"),
    );
    expect(second.equals(first)).toBe(true);
  });

  it("answers different sources differently", async () => {
    const word = await collect(
      await engine.convertToPdf(Readable.from([DOC_ENGINE_FIXTURES.plainDocx]), "docx"),
    );
    const deck = await collect(
      await engine.convertToPdf(Readable.from([DOC_ENGINE_FIXTURES.deckPptx]), "pptx"),
    );
    expect(deck.equals(word)).toBe(false);
  });

  it("answers the text a suite can state in advance", async () => {
    // The exported text builders are what lets an API suite name the
    // extracted text it expects, rather than reading back whatever came
    // out and asserting that it equals itself.
    const rendition = await collect(
      await engine.convertToPdf(Readable.from([DOC_ENGINE_FIXTURES.plainDocx]), "docx"),
    );
    expect(await engine.extractPdfText(Readable.from([rendition]))).toBe(
      fakeConversionText("docx", DOC_ENGINE_FIXTURES.plainDocx),
    );
    expect(await engine.ocrPdf(Readable.from([DOC_ENGINE_FIXTURES.scanPdf]))).toBe(
      fakeOcrText(DOC_ENGINE_FIXTURES.scanPdf),
    );
  });

  it("produces a PDF a reader would accept", async () => {
    const pdf = await collect(
      await engine.convertToPdf(Readable.from([DOC_ENGINE_FIXTURES.plainDocx]), "docx"),
    );
    // Header, trailer, and a cross-reference table that points at the
    // objects: a rendition is stored and served like any other blob, so
    // the fake's one must be a real file, not a label saying "PDF".
    expect(pdf.subarray(0, 8).toString()).toBe("%PDF-1.7");
    expect(pdf.subarray(-6).toString().trim()).toBe("%%EOF");
    const startxref = /startxref\n(\d+)\n/.exec(pdf.toString("latin1"));
    expect(startxref).not.toBeNull();
    expect(pdf.subarray(Number(startxref?.[1]), Number(startxref?.[1]) + 4).toString()).toBe(
      "xref",
    );
  });
});
