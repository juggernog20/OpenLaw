// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The thin HTTP wrapper around the four operations (TECH-010).
 *
 * Four routes, one operation each, plus a readiness probe:
 *
 * - `POST /convert?format=docx` — the source bytes in, a PDF out.
 * - `POST /compare?olderFormat=docx&newerFormat=odt` — two Word files
 *   in, one tracked-changes DOCX out.
 * - `POST /ocr` — a PDF in, the text OCR read out.
 * - `POST /extract` — a PDF in, its native text layer out.
 * - `GET /healthz` — for Compose.
 *
 * The service is stateless and carries **no authentication**. That is a
 * deployment property, not an oversight: like Postgres, it is reachable
 * only on the compose network and is never published to a host port
 * (TECH-017). Nothing about a request identifies a user, an org, or a
 * document, so the sidecar has nothing to authorise — the API decided
 * who may read the file before it ever sent the bytes.
 *
 * A request streams in to a temporary file, because every tool in the
 * image reads a file rather than a pipe, and the answer streams back out
 * of the buffer or file the tool produced. Nothing is kept between
 * requests.
 */

import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import {
  CONVERTIBLE_FORMATS,
  COMPARABLE_FORMATS,
  compareDocuments,
  convertToPdf,
  extractPdfText,
  isConvertibleFormat,
  isComparableFormat,
  ocrPdf,
} from "./operations.js";
import {
  OperationError,
  PROBLEM_CONTENT_TYPE,
  bodyTooLarge,
  engineBusy,
  problemBody,
  sourceUnreadable,
} from "./problem.js";

/** How many tools may run at once unless the deployment says otherwise. */
export const DEFAULT_MAX_CONCURRENT = 2;

/** How many requests may wait for a slot before the sidecar answers 503. */
export const DEFAULT_MAX_QUEUED = 8;

/** What the 503 tells a caller to wait, in seconds. */
const BUSY_RETRY_AFTER_SECONDS = 5;

export interface DocEngineServerOptions {
  /** Bound on one tool's lifetime, in milliseconds. */
  operationTimeoutMs: number;
  /** Bound on LibreOffice comparison, in milliseconds. */
  compareTimeoutMs: number;
  /** The largest request body the sidecar accepts, in bytes. */
  maxBodyBytes: number;
  /** How many tools may run at once. Defaults to {@link DEFAULT_MAX_CONCURRENT}. */
  maxConcurrent?: number;
  /** How many requests may wait for a slot. Defaults to {@link DEFAULT_MAX_QUEUED}. */
  maxQueued?: number;
}

/**
 * Admission control for the tools.
 *
 * Every route spawns LibreOffice, OCRmyPDF or poppler over a file a
 * counterparty sent, and each of those is a few hundred megabytes and a
 * core for as long as it runs. Without a bound, one person holding
 * refresh on a preview is one LibreOffice per keypress, and the host
 * goes with it. The gate lets a fixed number run, holds a fixed number
 * waiting, and refuses the rest with a 503 the API client treats as
 * transient.
 */
class ToolGate {
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxQueued: number,
  ) {}

  /** Whether a new request would be refused rather than queued. */
  get full(): boolean {
    return this.running >= this.maxConcurrent && this.waiting.length >= this.maxQueued;
  }

  /**
   * Runs `work` once a slot is free. A caller that goes away while it
   * waits gives up its place in the queue rather than running a tool
   * for nobody.
   */
  async run<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    await this.acquire(signal);
    try {
      return await work();
    } finally {
      this.release();
    }
  }

  private acquire(signal: AbortSignal): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running += 1;
      return Promise.resolve();
    }
    if (this.waiting.length >= this.maxQueued) {
      return Promise.reject(engineBusy(BUSY_RETRY_AFTER_SECONDS));
    }
    if (signal.aborted) {
      return Promise.reject(new Error("The request was abandoned before its tool could run."));
    }
    return new Promise<void>((resolve, reject) => {
      const grant = (): void => {
        signal.removeEventListener("abort", leave);
        resolve();
      };
      const leave = (): void => {
        const index = this.waiting.indexOf(grant);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(new Error("The request was abandoned before its tool could run."));
      };
      signal.addEventListener("abort", leave, { once: true });
      this.waiting.push(grant);
    });
  }

  private release(): void {
    // The slot is handed straight to the next waiter. Counting it free
    // first would let a request that arrives in between take it, and
    // then the waiter would run as one too many.
    const next = this.waiting.shift();
    if (next) next();
    else this.running -= 1;
  }
}

/** A format token has to be a filename extension, not a path fragment. */
const FORMAT_PATTERN = /^[a-z0-9]{1,16}$/;
const PAIR_MAGIC = Buffer.from("OPENLAW1", "ascii");

async function writeAll(file: Awaited<ReturnType<typeof open>>, body: Buffer): Promise<void> {
  let offset = 0;
  while (offset < body.byteLength) {
    const { bytesWritten } = await file.write(body, offset, body.byteLength - offset, null);
    if (bytesWritten === 0) throw new Error("The doc engine could not write a compare operand.");
    offset += bytesWritten;
  }
}

/** Writes a problem body for a failure. */
function sendProblem(
  response: ServerResponse,
  status: number,
  title: string,
  detail: string,
  retryAfterSeconds?: number,
): void {
  const body = problemBody(status, title, detail);
  response.writeHead(status, {
    "content-type": PROBLEM_CONTENT_TYPE,
    "content-length": body.byteLength,
    ...(retryAfterSeconds === undefined ? {} : { "retry-after": String(retryAfterSeconds) }),
  });
  response.end(body);
}

/**
 * Refuses a request before its body has been read.
 *
 * The body is drained first, then the problem is written. Answering
 * while the client is still uploading works on a good day and resets the
 * connection on a bad one, and a refusal the caller never gets to read
 * is worse than a wasted read of bytes we were going to throw away.
 */
async function refuse(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  title: string,
  detail: string,
): Promise<void> {
  request.resume();
  await once(request, "end").catch(() => undefined);
  sendProblem(response, status, title, detail);
}

/** Writes whatever an operation threw as the problem it maps to. */
function sendFailure(response: ServerResponse, error: unknown): void {
  if (error instanceof OperationError) {
    sendProblem(response, error.status, error.title, error.message, error.retryAfterSeconds);
    return;
  }
  // Anything else is the sidecar's own fault — a missing tool, a full
  // disk. The message is not echoed: an unexpected error's text is not
  // written for a caller, exactly as the API scrubs its own 5xx bodies.
  process.stderr.write(`doc-engine: ${String(error)}\n`);
  sendProblem(response, 500, "Internal server error", "The doc engine failed to answer.");
}

/**
 * Streams the request body to `path`, refusing anything over the
 * ceiling and anything with no bytes at all.
 *
 * A zero-byte source is refused rather than run: LibreOffice would read
 * it as an empty document and answer a blank PDF, and a blank rendition
 * of a truncated upload reads as a document with nothing in it, which is
 * worse than a failure that says so.
 */
async function receive(
  request: IncomingMessage,
  path: string,
  maxBodyBytes: number,
): Promise<void> {
  let received = 0;
  let over = false;
  const ceiling = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      received += chunk.byteLength;
      if (received > maxBodyBytes) {
        // Past the ceiling nothing more is written, and the upload is
        // still read to its end.
        //
        // Erroring here instead would be the obvious thing and it is
        // wrong: `pipeline` destroys every stream it was given when one
        // of them fails, and destroying the request resets the
        // connection mid-upload. The caller then reads a broken socket
        // rather than the 413 — an engine that could not be reached,
        // which is transient, so it spends its whole retry budget
        // re-sending a file that will never fit. Draining first costs a
        // few seconds of discarded bytes and buys a refusal the caller
        // can act on.
        over = true;
        // And a hard stop behind it, because a drain with no bound is a
        // way to make the sidecar read for ever. Twice the ceiling is
        // generous for an honest client that simply sent one large file.
        if (received > maxBodyBytes * 2) {
          done(bodyTooLarge(maxBodyBytes));
          return;
        }
        done(null);
        return;
      }
      done(null, chunk);
    },
  });
  await pipeline(request, ceiling, createWriteStream(path));
  if (over) throw bodyTooLarge(maxBodyBytes);
  if (received === 0) throw sourceUnreadable("The request body has no bytes.");
}

/**
 * Runs one operation over the request body.
 *
 * The body lands in a temporary directory this function owns and that it
 * removes however the request ends — answered, refused, or killed part
 * way through.
 */
async function withBody<T>(
  request: IncomingMessage,
  extension: string,
  maxBodyBytes: number,
  work: (source: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "doc-engine-body-"));
  try {
    const source = join(dir, `source.${extension}`);
    await receive(request, source, maxBodyBytes);
    return await work(source);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Splits the private two-stream compare body into two files. */
async function receivePair(
  request: IncomingMessage,
  olderPath: string,
  newerPath: string,
  maxBodyBytes: number,
): Promise<void> {
  const files: Array<Awaited<ReturnType<typeof open>>> = [];
  const written = [0, 0];
  let received = 0;
  let over = false;
  let pending = Buffer.alloc(0);
  let magicRead = false;
  let fileIndex = 0;
  let chunkBytes: number | undefined;

  try {
    files.push(await open(olderPath, "wx"));
    files.push(await open(newerPath, "wx"));
    for await (const raw of request) {
      const incoming = Buffer.from(raw);
      received += incoming.byteLength;
      if (received > maxBodyBytes) {
        over = true;
        if (received > maxBodyBytes * 2) throw bodyTooLarge(maxBodyBytes);
        continue;
      }
      pending = pending.byteLength === 0 ? incoming : Buffer.concat([pending, incoming]);

      while (pending.byteLength > 0) {
        if (!magicRead) {
          if (pending.byteLength < PAIR_MAGIC.byteLength) break;
          if (!pending.subarray(0, PAIR_MAGIC.byteLength).equals(PAIR_MAGIC)) {
            throw sourceUnreadable("The compare request body has an invalid header.");
          }
          pending = pending.subarray(PAIR_MAGIC.byteLength);
          magicRead = true;
          continue;
        }
        if (fileIndex >= files.length) {
          throw sourceUnreadable("The compare request body has bytes after the newer file.");
        }
        if (chunkBytes === undefined) {
          if (pending.byteLength < 4) break;
          chunkBytes = pending.readUInt32BE(0);
          pending = pending.subarray(4);
          if (chunkBytes === 0) {
            fileIndex += 1;
            chunkBytes = undefined;
          }
          continue;
        }
        if (pending.byteLength === 0) break;
        const size = Math.min(chunkBytes, pending.byteLength);
        const body = pending.subarray(0, size);
        const file = files[fileIndex];
        if (!file) throw sourceUnreadable("The compare request body has too many files.");
        await writeAll(file, body);
        written[fileIndex] = (written[fileIndex] ?? 0) + size;
        pending = pending.subarray(size);
        chunkBytes -= size;
        if (chunkBytes === 0) chunkBytes = undefined;
      }
    }
  } finally {
    await Promise.all(files.map((file) => file.close()));
  }

  if (over) throw bodyTooLarge(maxBodyBytes);
  if (!magicRead || fileIndex !== 2 || chunkBytes !== undefined || pending.byteLength > 0) {
    throw sourceUnreadable("The compare request body ended before both files were whole.");
  }
  if (written[0] === 0 || written[1] === 0) {
    throw sourceUnreadable("Both compare operands must have bytes.");
  }
}

/** Runs one compare request under the body directory it owns. */
async function withPairBody<T>(
  request: IncomingMessage,
  olderFormat: string,
  newerFormat: string,
  maxBodyBytes: number,
  work: (older: string, newer: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "doc-engine-pair-"));
  try {
    const older = join(dir, `older.${olderFormat}`);
    const newer = join(dir, `newer.${newerFormat}`);
    await receivePair(request, older, newer, maxBodyBytes);
    return await work(older, newer);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Writes text as the answer to an OCR or extraction request. */
function sendText(response: ServerResponse, text: string): void {
  const body = Buffer.from(text, "utf8");
  response.writeHead(200, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": body.byteLength,
  });
  response.end(body);
}

/** Builds the sidecar's HTTP server. Call `listen` on what it answers. */
export function createDocEngineServer(options: DocEngineServerOptions): Server {
  const timeouts = { timeoutMs: options.operationTimeoutMs };
  const compareTimeout = { timeoutMs: options.compareTimeoutMs };
  const gate = new ToolGate(
    options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
    options.maxQueued ?? DEFAULT_MAX_QUEUED,
  );

  return createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      sendFailure(response, error);
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // A relative-form request target is what a client sends; the base is
    // only here to give `URL` an origin to parse against.
    const url = new URL(request.url ?? "/", "http://doc-engine.invalid");
    const path = url.pathname;

    if (path === "/healthz") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendProblem(response, 405, "Method not allowed", `${path} answers GET.`);
        return;
      }
      const body = Buffer.from(JSON.stringify({ status: "ok" }));
      response.writeHead(200, {
        "content-type": "application/json",
        "content-length": body.byteLength,
      });
      response.end(request.method === "HEAD" ? undefined : body);
      return;
    }

    if (path !== "/convert" && path !== "/compare" && path !== "/ocr" && path !== "/extract") {
      sendProblem(response, 404, "Not found", `The doc engine has no ${path} route.`);
      return;
    }

    if (request.method !== "POST") {
      sendProblem(response, 405, "Method not allowed", `${path} answers POST.`);
      return;
    }

    // Refused before the body is read when there is no room. The body is
    // received first otherwise, so a queued request holds a file on
    // disk and not an open upload: Node's request timeout would cut an
    // upload that waited for a slot.
    if (gate.full) {
      const busy = engineBusy(BUSY_RETRY_AFTER_SECONDS);
      request.resume();
      await once(request, "end").catch(() => undefined);
      sendProblem(response, busy.status, busy.title, busy.message, busy.retryAfterSeconds);
      return;
    }

    // A caller that hangs up while its request waits for a slot leaves
    // the queue. Once the tool runs the operation's own bound applies.
    const gone = new AbortController();
    const leaveQueue = (): void => {
      if (!response.writableEnded) gone.abort();
    };
    response.once("close", leaveQueue);
    try {
      await runTool(request, response, url, path, gone.signal);
    } finally {
      response.off("close", leaveQueue);
    }
  }

  async function runTool(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    path: string,
    gone: AbortSignal,
  ): Promise<void> {
    if (path === "/convert") {
      const format = (url.searchParams.get("format") ?? "").toLowerCase();
      // Both checks happen before a single byte is written to disk. The
      // first is a safety rule — the source is written as
      // `source.<format>`, so anything but a bare extension is refused
      // before it can reach the filesystem. The second is the answer a
      // caller wants early: a format this engine does not convert costs
      // no upload and no temporary file.
      if (!FORMAT_PATTERN.test(format) || !isConvertibleFormat(format)) {
        await refuse(
          request,
          response,
          415,
          "Unsupported source format",
          `The format query parameter must name a format the doc engine converts: ${CONVERTIBLE_FORMATS.join(", ")}.`,
        );
        return;
      }
      await withBody(request, format, options.maxBodyBytes, (source) =>
        gate.run(gone, () =>
          convertToPdf(source, format, timeouts, async (pdf) => {
            // Streamed straight off the disk the tool wrote it to. A
            // converted deck is tens of megabytes, and the sidecar answers
            // more than one at a time.
            const { size } = await stat(pdf);
            response.writeHead(200, {
              "content-type": "application/pdf",
              "content-length": size,
            });
            await pipeline(createReadStream(pdf), response);
          }),
        ),
      );
      return;
    }

    if (path === "/compare") {
      const olderFormat = (url.searchParams.get("olderFormat") ?? "").toLowerCase();
      const newerFormat = (url.searchParams.get("newerFormat") ?? "").toLowerCase();
      const invalid = [olderFormat, newerFormat].find(
        (format) => !FORMAT_PATTERN.test(format) || !isComparableFormat(format),
      );
      if (invalid !== undefined) {
        await refuse(
          request,
          response,
          415,
          "Unsupported source format",
          `Both format query parameters must name Word formats the doc engine compares: ${COMPARABLE_FORMATS.join(", ")}. Refused ${JSON.stringify(invalid)}.`,
        );
        return;
      }
      const abandoned = new AbortController();
      const stopAbandonedWork = (): void => {
        if (!response.writableEnded) abandoned.abort();
      };
      response.once("close", stopAbandonedWork);
      try {
        await withPairBody(
          request,
          olderFormat,
          newerFormat,
          options.maxBodyBytes,
          (older, newer) =>
            gate.run(gone, () =>
              compareDocuments(
                older,
                olderFormat,
                newer,
                newerFormat,
                { ...compareTimeout, signal: abandoned.signal },
                async (docx) => {
                  const { size } = await stat(docx);
                  response.writeHead(200, {
                    "content-type":
                      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "content-length": size,
                  });
                  await pipeline(createReadStream(docx), response);
                },
              ),
            ),
        );
      } finally {
        response.off("close", stopAbandonedWork);
      }
      return;
    }

    const text = await withBody(request, "pdf", options.maxBodyBytes, (source) =>
      gate.run(gone, () =>
        path === "/ocr" ? ocrPdf(source, timeouts) : extractPdfText(source, timeouts),
      ),
    );
    sendText(response, text);
  }
}
