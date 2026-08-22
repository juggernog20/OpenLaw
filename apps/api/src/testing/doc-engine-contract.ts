// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The shared doc-engine contract suite (TECH-010).
 *
 * This file is the definition of what "a doc engine" means in OpenLaw,
 * so application code can hold one mental model of conversion, OCR, and
 * extraction and be right whichever engine is behind the interface. It
 * comes in two tiers, and the split is deliberate:
 *
 * - **{@link describeDocEngineContract} — the shape.** What every
 *   implementation must do: which formats it converts, which failure
 *   each bad input produces, that a conversion answers a PDF, that what
 *   the engine converts it can read back, and that nothing one call does
 *   is visible to the next. The real sidecar and the deterministic fake
 *   both run it.
 * - **{@link describeDocEngineFidelity} — the reading.** What the
 *   fixtures actually say once the engine has been through them: a
 *   Word document's words, a deck's slide, a scan's text, and the
 *   tracked changes and comments DOC-004 promises are visible. Only a
 *   real engine can run this, and only the real image does.
 *
 * The fake is not held to the second tier because it cannot read a Word
 * document, and a fake that pretended to would be a fake that passes
 * while the thing it stands in for fails. Everything a suite may assume
 * about the engine without booting a container is in the first tier;
 * everything else is proved against the image a deployment runs.
 */

import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  // Imported, never restated: a format this list declares convertible
  // must convert, and a suite holding a copy of the list would stay
  // green while the two drifted apart.
  CONVERTIBLE_FORMATS,
  SourceUnreadableError,
  UnsupportedFormatError,
  type DocEngine,
} from "../lib/doc-engine/engine.js";

function fixture(name: string): Buffer {
  return readFileSync(fileURLToPath(new URL(`./fixtures/doc-engine/${name}`, import.meta.url)));
}

/**
 * The five files the contract is stated over.
 *
 * They are small on purpose. A contract suite that takes a minute per
 * case stops being run, and none of what is asserted here needs a long
 * document to be true.
 */
export const DOC_ENGINE_FIXTURES = {
  /** An ordinary Word document. */
  plainDocx: fixture("plain.docx"),
  /** A Word document with a tracked insertion, a tracked deletion, and a comment. */
  trackedChangesDocx: fixture("tracked-changes.docx"),
  /** A one-slide PowerPoint deck. */
  deckPptx: fixture("deck.pptx"),
  /** A PDF carrying a real text layer. */
  nativeTextPdf: fixture("native-text.pdf"),
  /** The same page as a picture of itself — an image-only scan. */
  scanPdf: fixture("scan.pdf"),
} as const;

export interface DocEngineContractHarness {
  engine: DocEngine;
  /** Tears the engine down — a container, a server. */
  stop?: () => Promise<void>;
}

export interface DocEngineContractOptions {
  /**
   * Bound for `start`, for an engine that needs more than the package's
   * own `hookTimeout` — building an image rather than pulling one.
   * Unset means the bound in `vitest.config.ts`, which is what a
   * container-backed engine and a fake both want.
   */
  startTimeoutMs?: number;
}

function bytes(source: Buffer | string): Readable {
  return Readable.from([Buffer.from(source)]);
}

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/**
 * Text with its line breaks flattened.
 *
 * A conversion wraps lines where the page ends, so a phrase in the
 * source can arrive split across two. Every assertion about what a
 * document says is made against this form, never against the raw text.
 */
function flat(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim();
}

function hasWords(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/** The formats no doc engine converts, each for its own reason. */
const UNCONVERTIBLE_FORMATS = [
  "xlsx", // in the repository, download-only per DOC-004
  "zip",
  "pdf", // already a PDF; converting one to itself is not an operation
  "png",
  "",
  "DOCX", // the interface takes a lowercase extension, not a guess at one
] as const;

/**
 * Runs the shape contract against one engine. `start` builds it; its
 * `stop` tears down whatever `start` brought up.
 */
export function describeDocEngineContract(
  engineName: string,
  start: () => Promise<DocEngineContractHarness>,
  options: DocEngineContractOptions = {},
): void {
  describe(`doc engine contract: ${engineName}`, () => {
    let harness: DocEngineContractHarness;
    let engine: DocEngine;

    beforeAll(async () => {
      harness = await start();
      engine = harness.engine;
    }, options.startTimeoutMs);

    afterAll(async () => {
      // Optional on the harness too, not only on `stop`: if `start`
      // rejected, `harness` was never assigned, and reaching through it
      // here would make a TypeError the thing the run reports — burying
      // the container failure that actually happened.
      await harness?.stop?.();
    });

    describe("convertToPdf", () => {
      it("answers a PDF for a Word document", async () => {
        const pdf = await collect(
          await engine.convertToPdf(bytes(DOC_ENGINE_FIXTURES.plainDocx), "docx"),
        );
        expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      });

      it("answers a PDF for a PowerPoint deck", async () => {
        const pdf = await collect(
          await engine.convertToPdf(bytes(DOC_ENGINE_FIXTURES.deckPptx), "pptx"),
        );
        expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      });

      it.each(CONVERTIBLE_FORMATS)(
        "accepts %s, which the interface declares convertible",
        async (format) => {
          // Every format the interface offers has to be one the engine
          // behind it actually takes. The bytes are a Word document
          // whatever the declared format says, because the point of the
          // case is the format list, not the fixture: what must not
          // happen is a refusal that names the format.
          const pdf = await collect(
            await engine.convertToPdf(bytes(DOC_ENGINE_FIXTURES.plainDocx), format),
          );
          expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
        },
      );

      it.each(UNCONVERTIBLE_FORMATS)("refuses the format %j, naming it", async (format) => {
        const error = await engine.convertToPdf(bytes(DOC_ENGINE_FIXTURES.plainDocx), format).then(
          () => undefined,
          (raised: unknown) => raised,
        );
        expect(error).toBeInstanceOf(UnsupportedFormatError);
        // The refusal names the format it refused. The message is what a
        // failed derivation shows an operator, and "does not convert" with
        // no subject leaves them grepping.
        expect((error as Error).message).toContain(JSON.stringify(format));
      });

      it("refuses a package that was cut off before it was whole", async () => {
        const truncated = DOC_ENGINE_FIXTURES.plainDocx.subarray(0, 200);
        await expect(engine.convertToPdf(bytes(truncated), "docx")).rejects.toBeInstanceOf(
          SourceUnreadableError,
        );
      });

      it("refuses a source with no bytes", async () => {
        await expect(engine.convertToPdf(bytes(""), "docx")).rejects.toBeInstanceOf(
          SourceUnreadableError,
        );
      });

      it("fails when the source stream fails part way through", async () => {
        // Bytes first, then the failure: a stream that dies before it
        // yields anything would not prove the engine notices.
        const failing = Readable.from(
          (async function* () {
            yield DOC_ENGINE_FIXTURES.plainDocx.subarray(0, 100);
            throw new Error("the upload was cut off");
          })(),
        );
        await expect(engine.convertToPdf(failing, "docx")).rejects.toThrow();
      });

      it("converts the same source again, whatever ran in between", async () => {
        // The engine is stateless: nothing one call does is visible to
        // the next, and no call leaves a profile or a lock behind that
        // the one after it trips over.
        // Each answer is drained, not merely awaited: an engine that
        // answers over HTTP holds the connection until its body is
        // read, and a suite that walked away from one would be
        // measuring the connection pool rather than the engine.
        const first = await collect(
          await engine.convertToPdf(bytes(DOC_ENGINE_FIXTURES.plainDocx), "docx"),
        );
        await collect(await engine.convertToPdf(bytes(DOC_ENGINE_FIXTURES.deckPptx), "pptx"));
        const again = await collect(
          await engine.convertToPdf(bytes(DOC_ENGINE_FIXTURES.plainDocx), "docx"),
        );
        expect(first.subarray(0, 5).toString()).toBe("%PDF-");
        expect(again.subarray(0, 5).toString()).toBe("%PDF-");
      });

      it("converts two sources at once", async () => {
        // Two conversions in flight together must not fight over a
        // shared working directory or user profile — the pipeline runs
        // more than one job.
        const [word, deck] = await Promise.all([
          engine.convertToPdf(bytes(DOC_ENGINE_FIXTURES.plainDocx), "docx"),
          engine.convertToPdf(bytes(DOC_ENGINE_FIXTURES.deckPptx), "pptx"),
        ]);
        expect((await collect(word)).subarray(0, 5).toString()).toBe("%PDF-");
        expect((await collect(deck)).subarray(0, 5).toString()).toBe("%PDF-");
      });
    });

    describe("ocrPdf", () => {
      it("answers text for a scanned PDF", async () => {
        const text = await engine.ocrPdf(bytes(DOC_ENGINE_FIXTURES.scanPdf));
        expect(hasWords(text)).toBe(true);
      });

      it("refuses bytes that are not a PDF", async () => {
        await expect(engine.ocrPdf(bytes(DOC_ENGINE_FIXTURES.plainDocx))).rejects.toBeInstanceOf(
          SourceUnreadableError,
        );
      });

      it("refuses a source with no bytes", async () => {
        await expect(engine.ocrPdf(bytes(""))).rejects.toBeInstanceOf(SourceUnreadableError);
      });
    });

    describe("extractPdfText", () => {
      it("answers the text of a PDF that carries a text layer", async () => {
        const text = await engine.extractPdfText(bytes(DOC_ENGINE_FIXTURES.nativeTextPdf));
        expect(hasWords(text)).toBe(true);
      });

      it("answers the same text for the same PDF twice", async () => {
        const first = await engine.extractPdfText(bytes(DOC_ENGINE_FIXTURES.nativeTextPdf));
        const second = await engine.extractPdfText(bytes(DOC_ENGINE_FIXTURES.nativeTextPdf));
        expect(second).toBe(first);
      });

      it("reads back the text of a document this engine converted", async () => {
        // The pipeline's one real round trip: a Word document becomes
        // a PDF rendition, and the rendition is what the text comes
        // out of. Whatever an engine writes, the same engine reads.
        const rendition = await collect(
          await engine.convertToPdf(bytes(DOC_ENGINE_FIXTURES.plainDocx), "docx"),
        );
        expect(hasWords(await engine.extractPdfText(bytes(rendition)))).toBe(true);
      });

      it("refuses bytes that are not a PDF", async () => {
        await expect(
          engine.extractPdfText(bytes(DOC_ENGINE_FIXTURES.plainDocx)),
        ).rejects.toBeInstanceOf(SourceUnreadableError);
      });

      it("refuses a source with no bytes", async () => {
        await expect(engine.extractPdfText(bytes(""))).rejects.toBeInstanceOf(
          SourceUnreadableError,
        );
      });
    });
  });
}

/**
 * Runs the fidelity contract against a real engine: what the fixtures
 * say, once the engine has read them.
 *
 * Only an engine that genuinely converts and reads documents can pass
 * this. The deterministic fake does not run it — see the note at the top
 * of this file.
 */
export function describeDocEngineFidelity(
  engineName: string,
  start: () => Promise<DocEngineContractHarness>,
  options: DocEngineContractOptions = {},
): void {
  describe(`doc engine fidelity: ${engineName}`, () => {
    let harness: DocEngineContractHarness;
    let engine: DocEngine;

    beforeAll(async () => {
      harness = await start();
      engine = harness.engine;
    }, options.startTimeoutMs);

    afterAll(async () => {
      await harness?.stop?.();
    });

    /** Converts a fixture and answers what the conversion says. */
    async function textOfConversion(source: Buffer, format: string): Promise<string> {
      const rendition = await collect(await engine.convertToPdf(bytes(source), format));
      return flat(await engine.extractPdfText(bytes(rendition)));
    }

    it("renders a Word document's words into the PDF it converts", async () => {
      const text = await textOfConversion(DOC_ENGINE_FIXTURES.plainDocx, "docx");
      expect(text).toContain("Mutual Non-Disclosure Agreement");
      expect(text).toContain("Confidential Information");
    });

    it("renders a PowerPoint slide's words into the PDF it converts", async () => {
      const text = await textOfConversion(DOC_ENGINE_FIXTURES.deckPptx, "pptx");
      expect(text).toContain("Board approval of the acquisition");
      expect(text).toContain("regulatory clearance");
    });

    it("renders a Word document's tracked changes and its comment", async () => {
      // The fidelity case TECH-010 flags as the risk to validate
      // early, and the promise DOC-004 makes to a reader: the
      // counterparty's deletion, their insertion, and the comment they
      // left are all in the conversion. A conversion that quietly
      // dropped any of them would look correct and hide the
      // negotiation.
      const text = await textOfConversion(DOC_ENGINE_FIXTURES.trackedChangesDocx, "docx");
      expect(text).toContain("England and Wales");
      expect(text).toContain("Dubai International Financial Centre");
      expect(text).toContain("DIFC Courts have exclusive jurisdiction");
    });

    it("reads a native text layer without OCR", async () => {
      const text = flat(await engine.extractPdfText(bytes(DOC_ENGINE_FIXTURES.nativeTextPdf)));
      expect(text).toContain("DEED OF ASSIGNMENT");
      expect(text).toContain("The assignor transfers the whole of the rights.");
    });

    it("finds no words in an image-only PDF, which is the signal to OCR it", async () => {
      // DOC-005's branch, stated as behaviour: extraction answers a
      // scan with nothing, and that nothing is what sends the pipeline
      // to OCR rather than a guess about the file's MIME type.
      const text = await engine.extractPdfText(bytes(DOC_ENGINE_FIXTURES.scanPdf));
      expect(hasWords(text)).toBe(false);
    });

    it("reads a scanned page with OCR", async () => {
      const text = flat(await engine.ocrPdf(bytes(DOC_ENGINE_FIXTURES.scanPdf)));
      expect(text).toContain("DEED OF ASSIGNMENT");
      expect(text).toContain("This deed is dated the first of March.");
      expect(text).toContain("The assignor transfers the whole of the rights.");
    });
  });
}
