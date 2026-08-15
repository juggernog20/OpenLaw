// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The real doc engine against the real sidecar: the image is built from
 * this repository, started as a container, and held to both tiers of the
 * shared contract — the shape every engine must have, and the fidelity
 * only a real one can show.
 *
 * The sidecar is run the way TECH-014 runs Postgres and MinIO — a
 * container, never a mock — so the LibreOffice under test is the one a
 * deployment gets and the fidelity risk TECH-010 flags is measured
 * rather than assumed.
 *
 * The status mapping at the bottom is the exception, and deliberately
 * so: it is held against a stub server rather than the sidecar, because
 * a client's job is to turn a status into the right error and there is
 * no reliable way to make a healthy sidecar answer a 500.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DOC_ENGINE_FIXTURES,
  describeDocEngineContract,
  describeDocEngineFidelity,
  type DocEngineContractHarness,
} from "../../testing/doc-engine-contract.js";
import {
  DocEngineTimeoutError,
  DocEngineUnavailableError,
  SourceUnreadableError,
  UnsupportedFormatError,
} from "./engine.js";
import { createHttpDocEngine } from "./http.js";

/** The port the sidecar listens on inside its container. */
const SIDECAR_PORT = 8080;

/** The tag the built image is kept under, so a rerun reuses it. */
const IMAGE_TAG = "openlaw-doc-engine:test";

/** Building an 800 MB image on a cold cache is minutes, not seconds. */
const START_TIMEOUT_MS = 900_000;

/** A conversion or an OCR pass is seconds; a cold LibreOffice is more. */
const TEST_TIMEOUT_MS = 120_000;

const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));

/**
 * Builds the sidecar image once per test file.
 *
 * BuildKit, because the Dockerfile uses a cache mount and the classic
 * builder would refuse it. The tag is kept rather than reaped, so the
 * second run in a working session starts a container instead of
 * rebuilding Debian.
 */
let built: Promise<GenericContainer> | undefined;
function image(): Promise<GenericContainer> {
  built ??= GenericContainer.fromDockerfile(repoRoot, "services/doc-engine/Dockerfile")
    .withBuildkit()
    .build(IMAGE_TAG, { deleteOnExit: false });
  return built;
}

/** Boots one sidecar and answers the container running it. */
async function bootSidecar(): Promise<StartedTestContainer> {
  return (
    (await image())
      .withExposedPorts(SIDECAR_PORT)
      .withWaitStrategy(Wait.forHttp("/healthz", SIDECAR_PORT))
      // Testcontainers has its own sixty-second default and does not
      // read the hook's budget. A cold LibreOffice on a loaded machine
      // takes longer than that, and the failure would name the wait
      // strategy rather than the machine.
      .withStartupTimeout(START_TIMEOUT_MS)
      .start()
  );
}

/**
 * The one sidecar this file uses.
 *
 * Three suites want an engine, and the engine is stateless — nothing one
 * suite does is visible to another — so they share a container rather
 * than paying to start three. The shared harness carries no `stop`: a
 * suite that tore the container down would take it away from the suites
 * still to run. The file-level hook below is what stops it, once.
 */
let running: Promise<StartedTestContainer> | undefined;
async function startSidecar(): Promise<DocEngineContractHarness> {
  running ??= bootSidecar();
  const container = await running;
  return {
    engine: createHttpDocEngine({
      baseUrl: `http://${container.getHost()}:${container.getMappedPort(SIDECAR_PORT)}`,
    }),
  };
}

afterAll(async () => {
  const container = await running;
  await container?.stop();
});

describeDocEngineContract("doc-engine sidecar", startSidecar, {
  startTimeoutMs: START_TIMEOUT_MS,
  testTimeoutMs: TEST_TIMEOUT_MS,
});

describeDocEngineFidelity("doc-engine sidecar", startSidecar, {
  startTimeoutMs: START_TIMEOUT_MS,
  testTimeoutMs: TEST_TIMEOUT_MS,
});

describe("doc-engine sidecar", () => {
  let harness: DocEngineContractHarness;

  beforeAll(async () => {
    harness = await startSidecar();
  }, START_TIMEOUT_MS);

  it(
    "answers a scan's text without ever asking the caller to keep the OCR'd PDF",
    async () => {
      // DOC-005 stated as an interface property: the operation answers
      // text and nothing else, so there is no second file for a caller
      // to store by mistake and no way for a machine's re-rendering to
      // become what a reader sees.
      const text = await harness.engine.ocrPdf(Readable.from([DOC_ENGINE_FIXTURES.scanPdf]));
      expect(text).toMatch(/[\p{L}\p{N}]/u);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses a source format the interface does not offer without sending the bytes",
    async () => {
      // The client refuses locally, so a spreadsheet costs no upload and
      // no round trip to a service that would only refuse it too.
      await expect(
        harness.engine.convertToPdf(Readable.from([DOC_ENGINE_FIXTURES.plainDocx]), "xlsx"),
      ).rejects.toBeInstanceOf(UnsupportedFormatError);
    },
    TEST_TIMEOUT_MS,
  );
});

describe("doc-engine HTTP client", () => {
  it("reports a sidecar that is not there as transient", async () => {
    // Port 1 refuses rather than hangs, so this measures the mapping and
    // not a timeout.
    const engine = createHttpDocEngine({ baseUrl: "http://127.0.0.1:1" });
    await expect(
      engine.extractPdfText(Readable.from([DOC_ENGINE_FIXTURES.nativeTextPdf])),
    ).rejects.toBeInstanceOf(DocEngineUnavailableError);
  });

  describe("against a stub that answers a fixed status", () => {
    let server: Server;
    let status = 500;
    let baseUrl = "";

    beforeAll(async () => {
      server = createServer((request, response) => {
        request.resume();
        request.on("end", () => {
          response.writeHead(status, { "content-type": "application/problem+json" });
          response.end(
            JSON.stringify({ type: "about:blank", title: "Refused", status, detail: "no" }),
          );
        });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    });

    /** The error the client raises when the sidecar answers `answered`. */
    async function errorFor(answered: number): Promise<unknown> {
      status = answered;
      const engine = createHttpDocEngine({ baseUrl });
      return engine
        .extractPdfText(Readable.from([DOC_ENGINE_FIXTURES.nativeTextPdf]))
        .then(() => undefined)
        .catch((error: unknown) => error);
    }

    it("reads 415 as a format it does not convert", async () => {
      const error = await errorFor(415);
      expect(error).toBeInstanceOf(UnsupportedFormatError);
      // The sidecar's own sentence, verbatim — not wrapped inside a
      // second sentence that reads it as a format name.
      expect((error as Error).message).toBe("no");
    });

    it("reads 422 as a source it cannot read", async () => {
      expect(await errorFor(422)).toBeInstanceOf(SourceUnreadableError);
    });

    it("reads 413 as a source it cannot read", async () => {
      // A file the engine will not take is terminal in the same way a
      // file it cannot read is; both end as a failed derivation.
      expect(await errorFor(413)).toBeInstanceOf(SourceUnreadableError);
    });

    it("reads 504 as a timeout, which is worth retrying", async () => {
      expect(await errorFor(504)).toBeInstanceOf(DocEngineTimeoutError);
    });

    it("reads any other failure as the engine being unavailable", async () => {
      expect(await errorFor(500)).toBeInstanceOf(DocEngineUnavailableError);
      expect(await errorFor(503)).toBeInstanceOf(DocEngineUnavailableError);
    });

    it("carries the sidecar's explanation into the error it raises", async () => {
      status = 422;
      const engine = createHttpDocEngine({ baseUrl });
      await expect(
        engine.extractPdfText(Readable.from([DOC_ENGINE_FIXTURES.nativeTextPdf])),
      ).rejects.toThrow("no");
    });
  });

  describe("against a stub that never answers", () => {
    let server: Server;
    let baseUrl = "";

    beforeAll(async () => {
      server = createServer((request) => request.resume());
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    });

    it("abandons a call that runs past its bound", async () => {
      const engine = createHttpDocEngine({ baseUrl, timeoutMs: 200 });
      await expect(
        engine.extractPdfText(Readable.from([DOC_ENGINE_FIXTURES.nativeTextPdf])),
      ).rejects.toBeInstanceOf(DocEngineTimeoutError);
    });
  });

  describe("against a stub that stops part way through its answer", () => {
    let server: Server;
    let baseUrl = "";

    beforeAll(async () => {
      // Headers, one chunk, and then silence for ever. This is the shape
      // the call's own bound cannot catch: the bound is released the
      // moment the headers arrive, because a rendition is drained at the
      // caller's pace and a bound still running would cut a PDF that had
      // already been produced.
      server = createServer((request, response) => {
        request.resume();
        response.writeHead(200, { "content-type": "application/pdf" });
        response.write("%PDF-1.7 ");
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    });

    it("gives up on a rendition that stops arriving", async () => {
      // The gaps are bounded even though the whole read is not, so a
      // sidecar that sends half a file and stops is a timeout — worth
      // retrying — rather than a reader waiting on a stream nothing is
      // feeding, and rather than a truncated PDF stored as a rendition.
      const engine = createHttpDocEngine({ baseUrl, timeoutMs: 200 });
      const rendition = await engine.convertToPdf(
        Readable.from([DOC_ENGINE_FIXTURES.plainDocx]),
        "docx",
      );
      await expect(buffer(rendition)).rejects.toBeInstanceOf(DocEngineTimeoutError);
    });
  });
});

/**
 * The body ceiling, against a sidecar started with a small one.
 *
 * Its own container, because the ceiling is read from the environment at
 * startup and the shared sidecar's is the production default — a quarter
 * of a gigabyte, which is not a thing to upload in a test.
 */
describe("a sidecar with a small body ceiling", () => {
  /** Small enough to cross in a moment, large enough that the upload is
   * genuinely still being written when it is crossed. */
  const CEILING_BYTES = 1024 * 1024;

  let container: StartedTestContainer | undefined;
  let baseUrl = "";

  beforeAll(async () => {
    container = await (
      await image()
    )
      .withExposedPorts(SIDECAR_PORT)
      .withEnvironment({ DOC_ENGINE_MAX_BODY_BYTES: String(CEILING_BYTES) })
      .withWaitStrategy(Wait.forHttp("/healthz", SIDECAR_PORT))
      .withStartupTimeout(START_TIMEOUT_MS)
      .start();
    baseUrl = `http://${container.getHost()}:${container.getMappedPort(SIDECAR_PORT)}`;
  }, START_TIMEOUT_MS);

  afterAll(async () => {
    await container?.stop();
  });

  it(
    "refuses an upload over it as terminal, not as an engine it could not reach",
    async () => {
      // The refusal has to arrive as a refusal. A sidecar that cut the
      // connection the moment the ceiling was crossed would leave the
      // client reading a broken socket — unavailable, which is
      // transient — and the derivation would spend its whole retry
      // budget re-sending a file that will never fit. So the upload is
      // read to its end and the 413 is answered, which is terminal.
      const engine = createHttpDocEngine({ baseUrl });
      const chunk = Buffer.alloc(64 * 1024);
      // Paced, and half again over the ceiling, so the client still has
      // bytes to write when the sidecar decides. An upload that fits in
      // the socket buffers is over before the answer comes back and
      // would not tell these two failures apart.
      const oversize = Readable.from(
        (async function* () {
          for (let sent = 0; sent < CEILING_BYTES * 1.5; sent += chunk.byteLength) {
            await delay(2);
            yield chunk;
          }
        })(),
      );

      const error = await engine.extractPdfText(oversize).then(
        () => undefined,
        (raised: unknown) => raised,
      );
      expect(error).toBeInstanceOf(SourceUnreadableError);
      // The ceiling's own sentence, so this cannot pass because poppler
      // refused a megabyte of zeros for some other reason.
      expect((error as Error).message).toContain(String(CEILING_BYTES));
    },
    TEST_TIMEOUT_MS,
  );
});
