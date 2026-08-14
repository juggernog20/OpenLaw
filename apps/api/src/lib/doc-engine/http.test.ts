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

/** Boots one sidecar and answers the engine that talks to it. */
async function bootSidecar(): Promise<StartedTestContainer> {
  return (await image())
    .withExposedPorts(SIDECAR_PORT)
    .withWaitStrategy(Wait.forHttp("/healthz", SIDECAR_PORT))
    .start();
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
      expect(await errorFor(415)).toBeInstanceOf(UnsupportedFormatError);
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
});
