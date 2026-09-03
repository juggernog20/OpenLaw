// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The doc-engine sidecar's entry point (TECH-010).
 *
 * Reads its bounds from the environment, starts the HTTP wrapper, and
 * shuts down cleanly when Compose stops the container. Everything the
 * service does lives in `server.ts` and `operations.ts`; this file only
 * wires it to a port.
 */

import { createDocEngineServer } from "./server.js";

const DEFAULT_PORT = 8080;

/**
 * How long one tool may run before it is killed. Generous: a hundred-
 * page scan is minutes of Tesseract, and the caller's job retries a
 * timeout anyway.
 */
const DEFAULT_OPERATION_TIMEOUT_MS = 300_000;

/** Compare reads two Word files and has its own, longer tool bound. */
const DEFAULT_COMPARE_TIMEOUT_MS = 600_000;

/**
 * The largest request body the sidecar accepts. Above the API's own
 * 100 MB upload ceiling, so the sidecar is never the thing that refuses
 * a file the API accepted.
 */
const DEFAULT_MAX_BODY_BYTES = 256 * 1024 * 1024;

/**
 * How long a client may take to finish sending its request.
 *
 * This bounds the upload alone — Node stops the clock once the request
 * has arrived — so it never limits how long a conversion may run.
 */
const REQUEST_TIMEOUT_MS = 300_000;

const SHUTDOWN_DEADLINE_MS = 10_000;

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const server = createDocEngineServer({
  operationTimeoutMs: positiveInteger(
    process.env.DOC_ENGINE_OPERATION_TIMEOUT_MS,
    DEFAULT_OPERATION_TIMEOUT_MS,
  ),
  compareTimeoutMs: positiveInteger(
    process.env.DOC_ENGINE_COMPARE_TIMEOUT_MS,
    DEFAULT_COMPARE_TIMEOUT_MS,
  ),
  maxBodyBytes: positiveInteger(process.env.DOC_ENGINE_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES),
});

// A conversion is minutes long, and the socket sits idle for all of it
// while a tool runs. The socket bound has to be off, or the connection
// would be cut before the answer; the operation's own bound is what
// stops a hung tool. Receiving the request is a different phase and
// keeps a bound of its own, so a client that opens a connection and then
// dribbles bytes cannot hold one forever.
server.timeout = 0;
server.requestTimeout = REQUEST_TIMEOUT_MS;
server.headersTimeout = 60_000;

const port = positiveInteger(process.env.PORT, DEFAULT_PORT);
const host = process.env.HOST ?? "0.0.0.0";

server.listen(port, host, () => {
  process.stdout.write(`doc-engine listening on ${host}:${port}\n`);
});

/**
 * Stops answering, lets what is in flight finish, and gives up after a
 * deadline.
 *
 * Compose sends SIGTERM and kills the container ten seconds later, so a
 * shutdown that waited on a five-minute OCR pass would simply be killed
 * mid-way with nothing said. Giving up first is the same outcome,
 * announced — and the job that asked for the work retries it.
 */
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => {
      process.stderr.write("doc-engine: shutdown deadline reached; dropping connections\n");
      server.closeAllConnections();
      process.exit(0);
    }, SHUTDOWN_DEADLINE_MS);
    deadline.unref();
    // Idle keep-alive sockets go at once. `server.close()` waits for
    // every open connection, and the API holds its sockets open between
    // calls — so with nothing in flight the shutdown would still sit
    // here for the whole deadline, and Compose's own grace period is the
    // same ten seconds. The deadline is for work that is genuinely
    // running, not for a socket nobody is using.
    server.closeIdleConnections();
    server.close(() => process.exit(0));
  });
}
