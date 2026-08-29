// SPDX-License-Identifier: AGPL-3.0-only

/**
 * How the sidecar reports a failure.
 *
 * The wrapper answers RFC 9457 problem details, the same shape the API
 * answers its own callers, so one reader has one mental model of an
 * OpenLaw error body. The status code is what the `DocEngine` HTTP
 * client reads, and it is the whole contract: each code below maps to
 * exactly one error the interface defines.
 */

/** The RFC 9457 media type. */
export const PROBLEM_CONTENT_TYPE = "application/problem+json";

/**
 * A failure the wrapper answers, with the status that names it.
 *
 * The status is the contract, so the four kinds are kept apart:
 *
 * - 415: the engine does not convert that source format. Terminal,
 *   a retry converts the same format again.
 * - 413: the request body is over the ceiling. Terminal too.
 * - 422: the bytes are not readable as the format they claim.
 *   Terminal, the file is what it is.
 * - 504: the tool ran past its bound and was killed. Transient, a
 *   hung LibreOffice is exactly the case a retry heals.
 */
export class OperationError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    message: string,
  ) {
    super(message);
    this.name = "OperationError";
  }
}

/** The engine does not convert this source format. */
export function unsupportedFormat(format: string): OperationError {
  return new OperationError(
    415,
    "Unsupported source format",
    `The doc engine does not convert ${JSON.stringify(format)} to PDF.`,
  );
}

/** The bytes are not readable as the format they were declared to be. */
export function sourceUnreadable(detail: string): OperationError {
  return new OperationError(422, "Source unreadable", detail);
}

/** The tool ran past its bound and was killed. */
export function operationTimedOut(detail: string): OperationError {
  return new OperationError(504, "Operation timed out", detail);
}

/** The request body is larger than the ceiling. */
export function bodyTooLarge(maxBytes: number): OperationError {
  return new OperationError(
    413,
    "Request body too large",
    `The doc engine accepts at most ${maxBytes} bytes in one request.`,
  );
}

/** The problem body for a failure, as bytes ready to write. */
export function problemBody(status: number, title: string, detail: string): Buffer {
  return Buffer.from(JSON.stringify({ type: "about:blank", title, status, detail }));
}
