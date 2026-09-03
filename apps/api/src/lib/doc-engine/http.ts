// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The real doc engine: an HTTP client for the sidecar (TECH-010).
 *
 * The sidecar is one container on the compose network holding headless
 * LibreOffice, OCRmyPDF/Tesseract, and poppler. It is stateless, carries
 * no authentication, and is never published to a host port — so this
 * client sends no credential and there is none to configure. Everything
 * it knows about the service is one base URL.
 *
 * The whole error contract is the status code the sidecar answers.
 * Nothing here reads a message to decide what went wrong; the mapping
 * from status to the errors {@link DocEngine} defines is the seam, and
 * it is the one thing a replacement service would have to honour.
 */

import { Readable, Transform, pipeline as pipeStreams } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import {
  DocEngineTimeoutError,
  DocEngineUnavailableError,
  SourceUnreadableError,
  UnsupportedFormatError,
  isComparableFormat,
  isConvertibleFormat,
  unsupportedCompareFormat,
  unsupportedFormat,
  type DocEngine,
} from "./engine.js";

/** Where the sidecar answers inside the compose network. */
export const DEFAULT_DOC_ENGINE_URL = "http://doc-engine:8080";

/**
 * How long one call may take before it is abandoned.
 *
 * Generous, because the work is genuinely long: a hundred-page scan is
 * minutes of Tesseract. The sidecar bounds each tool as well, so this is
 * the outer bound for the case where the sidecar itself stops answering.
 */
export const DEFAULT_DOC_ENGINE_TIMEOUT_MS = 300_000;

/**
 * How long a compare may run before the client gives up.
 *
 * Compare reads two complete Word files and is the sidecar's slowest
 * operation, so it has its own bound rather than inheriting conversion's.
 * This is an application default, not a new deployment variable.
 */
export const DEFAULT_DOC_ENGINE_COMPARE_TIMEOUT_MS = 600_000;

/**
 * The highest bound an install may set, and why there is one.
 *
 * A derivation job is given fifteen minutes by the queue
 * (`TEXT_EXTRACTION_QUEUE_OPTIONS` and `DISPLAY_CONVERSION_QUEUE_OPTIONS`
 * in `pipeline/pg-boss.ts`, TECH-007) and the worst job makes **two**
 * sequential engine calls — convert a source to a PDF, then read that
 * PDF's text. So two bounds plus a minute for the reads and the writes
 * around them have to fit inside the queue's budget, or a job that is
 * still working can have its lease expire underneath it: pg-boss hands
 * the version to another worker while the first is mid-conversion, and
 * one version gets two derivations at once.
 *
 * Seven minutes is what that arithmetic leaves. The alternative was to
 * raise the queue's budget from the configured bound, which puts a
 * per-install value into a queue option pg-boss reads once at startup
 * and makes the two drift silently when only one is changed. Refusing
 * the bound says the same thing at boot, in a message.
 */
export const MAX_DOC_ENGINE_TIMEOUT_MS = 420_000;

export interface HttpDocEngineOptions {
  /** The sidecar's base URL, e.g. `http://doc-engine:8080`. */
  baseUrl: string;
  /** Bound on one call. Defaults to {@link DEFAULT_DOC_ENGINE_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Bound on one compare call. Defaults to {@link DEFAULT_DOC_ENGINE_COMPARE_TIMEOUT_MS}. */
  compareTimeoutMs?: number;
}

const PAIR_MAGIC = Buffer.from("OPENLAW1", "ascii");
const PAIR_CONTENT_TYPE = "application/vnd.openlaw.document-pair";

/**
 * Streams two files in one request without buffering either one.
 *
 * Each file is a series of uint32-length-prefixed chunks followed by a
 * zero length. The fixed magic comes first. The sidecar is the only
 * reader of this private wire format.
 */
function framedPair(older: Readable, newer: Readable): Readable {
  return Readable.from(
    (async function* () {
      const length = Buffer.alloc(4);
      try {
        yield PAIR_MAGIC;
        for (const source of [older, newer]) {
          for await (const raw of source) {
            const chunk = Buffer.from(raw);
            if (chunk.byteLength === 0) continue;
            length.writeUInt32BE(chunk.byteLength);
            yield Buffer.from(length);
            yield chunk;
          }
          length.writeUInt32BE(0);
          yield Buffer.from(length);
        }
      } finally {
        older.destroy();
        newer.destroy();
      }
    })(),
  );
}

/**
 * `fetch`'s options do not declare `duplex`, which every runtime
 * nonetheless requires when the body is a stream.
 *
 * The init is built as a named value rather than an inline literal on
 * purpose. `lib.dom` joins this program through `@better-auth/sso` (its
 * types reach samlify, and `@xmldom/xmldom` references the lib), so the
 * global `RequestInit` is the DOM one, which has no `duplex` at all. An
 * object literal passed straight to `fetch` is excess-property checked
 * against it and refused; a value of this type is not. The runtime is
 * unaffected either way — undici is what actually serves the call, and
 * it requires the flag.
 */
type StreamingRequestInit = RequestInit & { duplex: "half" };

class Attempt {
  private readonly controller = new AbortController();
  private readonly timer: NodeJS.Timeout;
  private expired = false;

  constructor(
    private readonly path: string,
    timeoutMs: number,
  ) {
    this.timer = setTimeout(() => {
      this.expired = true;
      this.controller.abort();
    }, timeoutMs);
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  settle(): void {
    clearTimeout(this.timer);
  }

  /**
   * The transient error for a call that never produced an answer.
   *
   * A cut-off request body lands here too, not only a refused
   * connection. Both are reported as transient, and the original is
   * carried as the cause so a log line still names what happened.
   */
  failed(error: unknown): Error {
    return this.expired
      ? new DocEngineTimeoutError(`The doc engine did not answer ${this.path} in time.`)
      : new DocEngineUnavailableError(`The doc engine could not be reached at ${this.path}.`, {
          cause: error,
        });
  }
}

async function detailOf(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "detail" in body) {
      const detail = (body as { detail: unknown }).detail;
      if (typeof detail === "string" && detail.length > 0) return detail;
    }
  } catch {
    // A failure answered without a problem body still has to be
    // reported; the status is what the mapping below reads anyway.
  }
  return fallback;
}

/**
 * Turns a refused answer into the error its status names.
 *
 * A 413 is grouped with the unreadable cases rather than given its own:
 * from a caller's side, a file the engine will not accept is terminal in
 * exactly the way a file it cannot read is, and both end the same — the
 * derivation is marked failed and the version falls back to download.
 */
async function refusal(response: Response, path: string): Promise<Error> {
  const detail = await detailOf(
    response,
    `The doc engine answered ${response.status} for ${path}.`,
  );
  switch (response.status) {
    case 415:
      return new UnsupportedFormatError(detail);
    case 413:
    case 422:
      return new SourceUnreadableError(detail);
    case 504:
      return new DocEngineTimeoutError(detail);
    default:
      return new DocEngineUnavailableError(detail);
  }
}

/**
 * Bounds the **gaps** in an answer that is still arriving.
 *
 * The call's own bound has to be released once the headers are in hand:
 * a rendition may be tens of megabytes and the caller drains it at its
 * own pace, so a bound still running would cut a PDF that had already
 * been produced. What that leaves unbounded is a sidecar that sends
 * headers, sends part of a file, and then stops — the socket stays open
 * and the caller waits on a stream nothing is feeding.
 *
 * So the clock restarts on every chunk instead. A stream that keeps
 * arriving may take as long as it takes; one that stops for longer than
 * the configured bound is a stalled call, and it fails as one rather
 * than as a truncated PDF or an open handle. The HTTP client has an idle
 * default of its own underneath this, but it is the runtime's and not
 * ours: an install that sets `DOC_ENGINE_TIMEOUT_MS` means this.
 */
function withIdleBound(source: Readable, path: string, timeoutMs: number): Readable {
  let timer: NodeJS.Timeout | undefined;

  const bounded = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      arm();
      done(null, chunk);
    },
  });

  function stop(): void {
    if (timer) clearTimeout(timer);
    timer = undefined;
  }

  function arm(): void {
    stop();
    timer = setTimeout(() => {
      bounded.destroy(
        new DocEngineTimeoutError(`The doc engine stopped sending ${path} part way through.`),
      );
    }, timeoutMs);
  }

  bounded.once("close", stop);
  arm();
  // `pipeline` rather than `pipe`, so the source's own failure reaches
  // the caller and so destroying either end tears down the other — the
  // stalled case has to close the socket, not only stop the reader.
  pipeStreams(source, bounded, () => {
    stop();
  });
  return bounded;
}

/** Builds the HTTP client for a running sidecar. */
export function createHttpDocEngine(options: HttpDocEngineOptions): DocEngine {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DOC_ENGINE_TIMEOUT_MS;
  const compareTimeoutMs = options.compareTimeoutMs ?? DEFAULT_DOC_ENGINE_COMPARE_TIMEOUT_MS;
  // Parsed once, at construction: a malformed base URL is a
  // configuration fault, and it must not wait for the first upload to
  // show itself. The trailing slash keeps a base URL that carries a path
  // prefix from having its last segment replaced.
  const base = new URL(options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`);

  /** Sends the body and answers the response, or throws the mapped failure. */
  async function post(
    path: string,
    body: Readable,
    search?: URLSearchParams,
    attemptTimeoutMs = timeoutMs,
    contentType = "application/octet-stream",
  ): Promise<{ response: Response; call: Attempt }> {
    const url = new URL(path, base);
    if (search) url.search = search.toString();
    const call = new Attempt(path, attemptTimeoutMs);
    let response: Response;
    const init: StreamingRequestInit = {
      method: "POST",
      body: Readable.toWeb(body) as ReadableStream,
      // Required whenever the body is a stream: the request starts
      // before the body has finished being written.
      duplex: "half",
      headers: { "content-type": contentType },
      signal: call.signal,
    };
    try {
      response = await fetch(url, init);
    } catch (error) {
      call.settle();
      throw call.failed(error);
    }
    if (!response.ok) {
      const error = await refusal(response, path);
      call.settle();
      throw error;
    }
    return { response, call };
  }

  /** The whole answer as text, under the same bound the request ran under. */
  async function textOf(path: string, body: Readable): Promise<string> {
    const { response, call } = await post(path, body);
    try {
      return await response.text();
    } catch (error) {
      throw call.failed(error);
    } finally {
      call.settle();
    }
  }

  return {
    async convertToPdf(source, format) {
      // Refused here rather than at the sidecar, so a format this
      // interface does not offer costs no round trip and no upload of
      // the bytes. The source is closed on the way out: nothing will
      // read it, and a stream nobody closes holds its file handle until
      // the process notices.
      if (!isConvertibleFormat(format)) {
        source.destroy();
        throw unsupportedFormat(format);
      }
      const { response, call } = await post("convert", source, new URLSearchParams({ format }));
      // The bound is released once the answer's headers are in hand. The
      // PDF may be tens of megabytes and the caller drains it at its own
      // pace — a bound still running would cut the stream part way
      // through a rendition that had already been produced. The same
      // bound is then applied to the gaps between chunks instead, so a
      // sidecar that sends half a file and stops is still a timeout.
      call.settle();
      if (!response.body) {
        throw new DocEngineUnavailableError("The doc engine answered /convert with no body.");
      }
      return withIdleBound(
        Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
        "convert",
        timeoutMs,
      );
    },

    async compare(older, olderFormat, newer, newerFormat) {
      if (!isComparableFormat(olderFormat)) {
        older.destroy();
        newer.destroy();
        throw unsupportedCompareFormat(olderFormat);
      }
      if (!isComparableFormat(newerFormat)) {
        older.destroy();
        newer.destroy();
        throw unsupportedCompareFormat(newerFormat);
      }
      const { response, call } = await post(
        "compare",
        framedPair(older, newer),
        new URLSearchParams({ olderFormat, newerFormat }),
        compareTimeoutMs,
        PAIR_CONTENT_TYPE,
      );
      call.settle();
      if (!response.body) {
        throw new DocEngineUnavailableError("The doc engine answered /compare with no body.");
      }
      return withIdleBound(
        Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
        "compare",
        compareTimeoutMs,
      );
    },

    ocrPdf(pdf) {
      return textOf("ocr", pdf);
    },

    extractPdfText(pdf) {
      return textOf("extract", pdf);
    },
  };
}
