// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The three operations the sidecar performs, each one a tool in the
 * image driven over a temporary directory (TECH-010).
 *
 * - **convert** — headless LibreOffice renders DOCX/PPTX and their
 *   relatives to PDF. That PDF is the display rendition the doc panel
 *   shows, so the Writer export asks for comments in the margin and
 *   leaves tracked changes displayed: DOC-004 promises both are visible
 *   in the conversion, and a conversion that silently drops them looks
 *   correct while hiding the counterparty's edits.
 * - **ocr** — OCRmyPDF drives Tesseract over an image-only PDF and
 *   answers the text it read (DOC-005). The OCR'd PDF it produces is
 *   thrown away: the stored original is always what renders.
 * - **extract** — `pdftotext` reads a PDF's native text layer. An
 *   image-only PDF answers nothing, which is the signal the caller
 *   branches to OCR on.
 *
 * Every operation is stateless. It writes its input under a temporary
 * directory it owns, runs one tool with a bounded lifetime, and removes
 * the directory before it answers. Nothing survives a request.
 */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { operationTimedOut, sourceUnreadable, unsupportedFormat } from "./problem.js";

/**
 * The source formats LibreOffice converts for us, each mapped to the
 * export filter its family needs.
 *
 * The filter is chosen by family and never left to LibreOffice to guess:
 * asked for a bare `pdf`, it picks a filter from the input document, and
 * a Writer document exported through the Impress filter loses its
 * layout. Naming the filter is also what lets the Writer side pass
 * export options at all.
 *
 * `ExportNotesInMargin` puts Word comments in the page margin, where a
 * reader sees them beside the text they annotate. Tracked changes need
 * no option: LibreOffice displays them, so they render.
 */
const WRITER_PDF_EXPORT =
  'pdf:writer_pdf_Export:{"ExportNotesInMargin":{"type":"boolean","value":"true"}}';
const IMPRESS_PDF_EXPORT = "pdf:impress_pdf_Export";

/**
 * Source format → export filter. The key is the lowercase filename
 * extension, which is also what the caller declares.
 */
const CONVERT_FILTERS: Readonly<Record<string, string>> = {
  doc: WRITER_PDF_EXPORT,
  docx: WRITER_PDF_EXPORT,
  odt: WRITER_PDF_EXPORT,
  rtf: WRITER_PDF_EXPORT,
  odp: IMPRESS_PDF_EXPORT,
  ppt: IMPRESS_PDF_EXPORT,
  pptx: IMPRESS_PDF_EXPORT,
};

/** The formats `convert` accepts, in the order they are documented. */
export const CONVERTIBLE_FORMATS = Object.keys(CONVERT_FILTERS).sort();

/** Whether `format` is one this engine converts. */
export function isConvertibleFormat(format: string): boolean {
  return Object.hasOwn(CONVERT_FILTERS, format);
}

/** How long one tool may run before it is killed, and what it is called. */
export interface OperationOptions {
  /** Bound on one tool's lifetime. A tool that outlives it is killed. */
  timeoutMs: number;
}

/** A tool that failed, as `execFile` reports it. */
interface ExecFailure {
  /**
   * A number when the tool ran and exited, and a string when it never
   * ran at all — `ENOENT` for a tool that is not in the image,
   * `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` for one that outran the buffer.
   * The two mean opposite things about whose fault the failure is, so
   * the type says both rather than only the ordinary one.
   */
  code?: number | string | null;
  signal?: NodeJS.Signals | null;
  killed?: boolean;
  stderr?: string;
}

/**
 * Runs one tool to completion under `timeoutMs`, answering its stderr on
 * failure so the caller can say what went wrong.
 *
 * A tool killed by the bound is reported as a timeout — the one
 * transient failure the sidecar has, and the one worth retrying. Any
 * other non-zero exit is the source's fault as far as the sidecar can
 * tell, so it is reported as unreadable.
 */
async function run(command: string, args: string[], options: OperationOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        timeout: options.timeoutMs,
        // SIGTERM leaves a wedged LibreOffice running, and the bound
        // exists precisely for the wedged case.
        killSignal: "SIGKILL",
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout);
          return;
        }
        const failure = error as unknown as ExecFailure;
        if (failure.killed === true || failure.signal === "SIGKILL") {
          reject(operationTimedOut(`${command} ran past ${options.timeoutMs}ms and was killed.`));
          return;
        }
        if (typeof failure.code !== "number") {
          // The tool is not in the image, or could not be started at
          // all, or wrote more than the buffer would hold. That is the
          // sidecar's own fault, not the source's, so it must not be
          // reported as an unreadable file — an unreadable file is
          // terminal, and a missing tool would fail every derivation on
          // the install for good. Only an exit code says the tool ran
          // and refused these bytes.
          reject(error);
          return;
        }
        reject(
          sourceUnreadable(firstLine(stderr) || `${command} exited with code ${failure.code}.`),
        );
      },
    );
  });
}

/** The first non-empty line of a tool's stderr, trimmed for a problem body. */
function firstLine(stderr: string): string {
  for (const line of stderr.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) return trimmed.slice(0, 500);
  }
  return "";
}

/** A temporary directory for one operation, removed however it ends. */
async function inScratch<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "doc-engine-"));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Converts a source file to a PDF and hands the result to `deliver`.
 *
 * The PDF is handed over as a **path**, not as bytes. A converted
 * hundred-page deck is tens of megabytes, and the sidecar converts more
 * than one document at a time — reading each one into memory to write it
 * straight back out would make the service's memory a function of what
 * anyone happens to upload. `deliver` streams the file to its caller
 * while the temporary directory is still alive; the directory goes when
 * `deliver` returns, whether it succeeded or not.
 *
 * Rejects with a 415 problem when the format is not one we convert, and
 * with a 422 problem when LibreOffice cannot read the bytes. LibreOffice
 * reports the second case both ways — a non-zero exit, or a clean exit
 * with no output file — so the missing output is checked for as well.
 */
export async function convertToPdf<T>(
  source: string,
  format: string,
  options: OperationOptions,
  deliver: (pdf: string) => Promise<T>,
): Promise<T> {
  const filter = CONVERT_FILTERS[format];
  if (!filter) throw unsupportedFormat(format);

  return inScratch(async (dir) => {
    const outDir = join(dir, "out");
    // LibreOffice makes the output directory itself, but only on the
    // paths where it gets that far. Making it here means a missing PDF
    // below always means "LibreOffice produced nothing", never "the
    // directory was never there to look in".
    await mkdir(outDir, { recursive: true });
    // A LibreOffice user profile is single-writer: two conversions
    // sharing one would serialise at best and corrupt it at worst. Each
    // conversion gets its own, under the scratch directory that is
    // removed with it, so the sidecar converts concurrently.
    const profile = pathToFileURL(join(dir, "profile")).href;
    await run(
      "soffice",
      [
        `-env:UserInstallation=${profile}`,
        "--headless",
        "--norestore",
        "--nolockcheck",
        "--nodefault",
        "--nofirststartwizard",
        "--convert-to",
        filter,
        "--outdir",
        outDir,
        source,
      ],
      options,
    );

    const produced = (await readdir(outDir)).filter((name) => name.toLowerCase().endsWith(".pdf"));
    const first = produced[0];
    if (!first) {
      throw sourceUnreadable(
        `LibreOffice produced no PDF from the ${JSON.stringify(format)} source.`,
      );
    }
    return deliver(join(outDir, first));
  });
}

/**
 * Reads an image-only PDF with OCR and answers the text.
 *
 * `--force-ocr` rasterises whatever text layer the file already carries
 * and reads the pages as pictures. The caller has already decided this
 * PDF has no usable text layer, and the alternative default fails the
 * whole run when it finds one — a scan with a stray watermark would
 * come back as an error instead of as its text.
 */
export async function ocrPdf(source: string, options: OperationOptions): Promise<string> {
  return inScratch(async (dir) => {
    const text = join(dir, "text.txt");
    await run(
      "ocrmypdf",
      [
        "--force-ocr",
        // The OCR'd PDF is written and then thrown away with the
        // scratch directory: DOC-005 keeps the original scan as the
        // thing that renders, so only the sidecar text file is read.
        "--sidecar",
        text,
        // Skip the optimisation pass. Nothing reads the PDF we produce,
        // so every second spent making it smaller is wasted.
        "--optimize",
        "0",
        "--output-type",
        "pdf",
        "--quiet",
        source,
        join(dir, "ocr.pdf"),
      ],
      options,
    );
    return readFile(text, "utf8");
  });
}

/**
 * Reads a PDF's native text layer.
 *
 * An image-only PDF answers an empty string rather than failing. That is
 * not an error — it is the signal the caller branches to OCR on
 * (DOC-005).
 */
export async function extractPdfText(source: string, options: OperationOptions): Promise<string> {
  return inScratch(async (dir) => {
    const text = join(dir, "text.txt");
    // To a file, not to stdout: a long scanned agreement's text layer
    // can outgrow any stdout buffer we would have to guess at.
    await run("pdftotext", ["-q", "-enc", "UTF-8", source, text], options);
    return readFile(text, "utf8");
  });
}
