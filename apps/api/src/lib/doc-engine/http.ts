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

import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import {
  DocEngineTimeoutError,
  DocEngineUnavailableError,
  SourceUnreadableError,
  UnsupportedFormatError,
  isConvertibleFormat,
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

export interface HttpDocEngineOptions {
  /** The sidecar's base URL, e.g. `http://doc-engine:8080`. */
  baseUrl: string;
  /** Bound on one call. Defaults to {@link DEFAULT_DOC_ENGINE_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/**
 * `fetch`'s options do not declare `duplex`, which every runtime
 * nonetheless requires when the body is a stream.
 */
type StreamingRequestInit = RequestInit & { duplex: "half" };

/** One call in flight, under the bound that abandons it. */
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

  /** Stops the bound. Safe to call more than once. */
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

/** The `detail` of a problem body, when the answer carries one. */
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

/** Builds the HTTP client for a running sidecar. */
export function createHttpDocEngine(options: HttpDocEngineOptions): DocEngine {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DOC_ENGINE_TIMEOUT_MS;
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
  ): Promise<{ response: Response; call: Attempt }> {
    const url = new URL(path, base);
    if (search) url.search = search.toString();
    const call = new Attempt(path, timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        body: Readable.toWeb(body) as ReadableStream,
        // Required whenever the body is a stream: the request starts
        // before the body has finished being written.
        duplex: "half",
        headers: { "content-type": "application/octet-stream" },
        signal: call.signal,
      } satisfies StreamingRequestInit);
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
        throw new UnsupportedFormatError(format);
      }
      const { response, call } = await post("convert", source, new URLSearchParams({ format }));
      // The bound is released once the answer's headers are in hand. The
      // PDF may be tens of megabytes and the caller drains it at its own
      // pace — a bound still running would cut the stream part way
      // through a rendition that had already been produced. A stalled
      // body is bounded by the HTTP client's own idle timeout.
      call.settle();
      if (!response.body) {
        throw new DocEngineUnavailableError("The doc engine answered /convert with no body.");
      }
      return Readable.fromWeb(response.body as WebReadableStream<Uint8Array>);
    },

    ocrPdf(pdf) {
      return textOf("ocr", pdf);
    },

    extractPdfText(pdf) {
      return textOf("extract", pdf);
    },
  };
}
