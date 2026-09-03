// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The four operations the sidecar performs, each one a tool in the
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
 * - **compare** — Writer compares an older Word file with a newer one
 *   and exports their difference as tracked changes in a DOCX.
 *
 * Every operation is stateless. It writes its input under a temporary
 * directory it owns, runs one tool with a bounded lifetime, and removes
 * the directory before it answers. Nothing survives a request.
 */

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, open, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  operationTimedOut,
  sourceUnreadable,
  unsupportedCompareFormat,
  unsupportedFormat,
} from "./problem.js";

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

export const CONVERTIBLE_FORMATS = Object.keys(CONVERT_FILTERS).sort((a, b) => a.localeCompare(b));

export function isConvertibleFormat(format: string): boolean {
  return Object.hasOwn(CONVERT_FILTERS, format);
}

/** Word formats accepted on either side of a comparison. */
export const COMPARABLE_FORMATS = ["doc", "docx", "odt", "rtf"] as const;

export function isComparableFormat(format: string): boolean {
  return (COMPARABLE_FORMATS as readonly string[]).includes(format);
}

const ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const ZIP_END = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const OLE_HEADER = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const RTF_HEADER = Buffer.from("{\\rtf", "ascii");

/** Refuses bytes that cannot be the Word container their format names. */
async function assertWordSource(path: string, format: string): Promise<void> {
  const { size } = await stat(path);
  if (size === 0) throw sourceUnreadable(`The ${JSON.stringify(format)} source has no bytes.`);
  const file = await open(path, "r");
  try {
    const first = Buffer.alloc(Math.max(OLE_HEADER.byteLength, RTF_HEADER.byteLength));
    await file.read(first, 0, first.byteLength, 0);
    if (format === "docx" || format === "odt") {
      const tailSize = Math.min(size, 65_557);
      const tail = Buffer.alloc(tailSize);
      await file.read(tail, 0, tailSize, size - tailSize);
      if (
        !first.subarray(0, ZIP_HEADER.byteLength).equals(ZIP_HEADER) ||
        tail.lastIndexOf(ZIP_END) < 0
      ) {
        throw sourceUnreadable(`The ${JSON.stringify(format)} source is not a whole ZIP package.`);
      }
      return;
    }
    if (format === "doc" && !first.subarray(0, OLE_HEADER.byteLength).equals(OLE_HEADER)) {
      throw sourceUnreadable('The "doc" source is not an OLE compound file.');
    }
    if (format === "rtf" && !first.subarray(0, RTF_HEADER.byteLength).equals(RTF_HEADER)) {
      throw sourceUnreadable('The "rtf" source has no RTF header.');
    }
  } finally {
    await file.close();
  }
}

/** How long one tool may run before it is killed, and what it is called. */
export interface OperationOptions {
  /** Bound on one tool's lifetime. A tool that outlives it is killed. */
  timeoutMs: number;
  /** Stops work whose caller has disconnected. */
  signal?: AbortSignal;
}

/**
 * Runs one tool to completion under `timeoutMs`, answering its stderr on
 * failure so the caller can say what went wrong.
 *
 * A tool killed by the bound is reported as a timeout. A tool abandoned
 * by its caller, or one that failed for its own reasons, reaches the
 * sidecar's retryable 5xx path. `terminalExitCodes` distinguishes tools
 * that use a particular exit status to say their source was unreadable.
 */
async function run(
  command: string,
  args: string[],
  options: OperationOptions,
  terminalExitCodes: "all" | readonly number[] = "all",
): Promise<string> {
  return new Promise((resolve, reject) => {
    const maxBuffer = 4 * 1024 * 1024;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let timedOut = false;
    let abandoned = false;
    let bufferExceeded = false;
    let launchError: Error | undefined;
    const child = spawn(command, args, {
      // Linux gives every tool invocation its own process group. That
      // is the only reliable unit to kill when a wrapper has children.
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    function killGroup(): void {
      const pid = child.pid;
      if (!pid) return;
      try {
        // The detached child is the leader of a process group.
        // A comparison is Python → soffice → soffice.bin; killing only
        // Python strands the office process and its profile.
        process.kill(-pid, "SIGKILL");
      } catch {
        // ESRCH means the process finished between the callback and the
        // signal. The callback remains the one place that settles this.
      }
    }

    function settle(): void {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }

    function abort(): void {
      abandoned = true;
      killGroup();
    }

    function collect(chunks: Buffer[], chunk: Buffer): void {
      if (bufferExceeded) return;
      outputBytes += chunk.byteLength;
      if (outputBytes > maxBuffer) {
        bufferExceeded = true;
        killGroup();
        return;
      }
      chunks.push(chunk);
    }

    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.once("error", (error) => {
      launchError = error;
    });
    child.once("close", (code, signal) => {
      settle();
      const stderrText = Buffer.concat(stderr).toString("utf8");
      if (timedOut) {
        reject(operationTimedOut(`${command} ran past ${options.timeoutMs}ms and was killed.`));
        return;
      }
      if (abandoned) {
        reject(
          new Error(`${command} was abandoned when its caller disconnected.`, {
            cause: launchError,
          }),
        );
        return;
      }
      if (bufferExceeded) {
        reject(new Error(`${command} wrote more than ${maxBuffer} bytes to stdout and stderr.`));
        return;
      }
      if (launchError) {
        // The tool is not in the image, or could not be started at all.
        // That is the sidecar's fault, not a terminal source refusal.
        reject(launchError);
        return;
      }
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8"));
        return;
      }
      if (
        typeof code === "number" &&
        (terminalExitCodes === "all" || terminalExitCodes.includes(code))
      ) {
        reject(sourceUnreadable(firstLine(stderrText) || `${command} exited with code ${code}.`));
        return;
      }
      reject(
        new Error(
          firstLine(stderrText) ||
            `${command} ${signal ? `was killed by ${signal}` : `exited with code ${String(code)}`}.`,
        ),
      );
    });
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, options.timeoutMs);
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
  });
}

function firstLine(stderr: string): string {
  for (const line of stderr.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) return trimmed.slice(0, 500);
  }
  return "";
}

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
 * Compares two Word files and hands a tracked-changes DOCX to `deliver`.
 *
 * The Python bridge starts one LibreOffice process over a uniquely named
 * UNO pipe. Its profile sits inside this call's scratch directory, so two
 * comparisons neither serialize nor share Writer state.
 */
export async function compareDocuments<T>(
  older: string,
  olderFormat: string,
  newer: string,
  newerFormat: string,
  options: OperationOptions,
  deliver: (docx: string) => Promise<T>,
): Promise<T> {
  if (!isComparableFormat(olderFormat)) throw unsupportedCompareFormat(olderFormat);
  if (!isComparableFormat(newerFormat)) throw unsupportedCompareFormat(newerFormat);
  await Promise.all([assertWordSource(older, olderFormat), assertWordSource(newer, newerFormat)]);

  return inScratch(async (dir) => {
    const output = join(dir, "comparison.docx");
    const profile = join(dir, "profile");
    // Exit 2 is the bridge's explicit "one operand could not be opened";
    // any other failure belongs to the engine and is therefore retryable.
    await run("python3", ["/app/compare.py", older, newer, output, profile], options, [2]);
    let size: number;
    try {
      size = (await stat(output)).size;
    } catch {
      throw new Error("LibreOffice produced no tracked-changes Word file.");
    }
    if (size === 0) throw new Error("LibreOffice produced an empty comparison.");
    return deliver(output);
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
