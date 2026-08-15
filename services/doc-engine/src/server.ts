// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The thin HTTP wrapper around the three operations (TECH-010).
 *
 * Three routes, one operation each, plus a readiness probe:
 *
 * - `POST /convert?format=docx` — the source bytes in, a PDF out.
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
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import {
  CONVERTIBLE_FORMATS,
  convertToPdf,
  extractPdfText,
  isConvertibleFormat,
  ocrPdf,
} from "./operations.js";
import {
  OperationError,
  PROBLEM_CONTENT_TYPE,
  bodyTooLarge,
  problemBody,
  sourceUnreadable,
} from "./problem.js";

export interface DocEngineServerOptions {
  /** Bound on one tool's lifetime, in milliseconds. */
  operationTimeoutMs: number;
  /** The largest request body the sidecar accepts, in bytes. */
  maxBodyBytes: number;
}

/** A format token has to be a filename extension, not a path fragment. */
const FORMAT_PATTERN = /^[a-z0-9]{1,16}$/;

/** Writes a problem body for a failure. */
function sendProblem(
  response: ServerResponse,
  status: number,
  title: string,
  detail: string,
): void {
  const body = problemBody(status, title, detail);
  response.writeHead(status, {
    "content-type": PROBLEM_CONTENT_TYPE,
    "content-length": body.byteLength,
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
    sendProblem(response, error.status, error.title, error.message);
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

    if (path !== "/convert" && path !== "/ocr" && path !== "/extract") {
      sendProblem(response, 404, "Not found", `The doc engine has no ${path} route.`);
      return;
    }

    if (request.method !== "POST") {
      sendProblem(response, 405, "Method not allowed", `${path} answers POST.`);
      return;
    }

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
      );
      return;
    }

    const text = await withBody(request, "pdf", options.maxBodyBytes, (source) =>
      path === "/ocr" ? ocrPdf(source, timeouts) : extractPdfText(source, timeouts),
    );
    sendText(response, text);
  }
}
