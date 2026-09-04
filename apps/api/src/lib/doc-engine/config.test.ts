// SPDX-License-Identifier: AGPL-3.0-only

/**
 * What the environment is allowed to say about the doc engine.
 *
 * The rule this file is really pinning is the zero-configuration one: a
 * deployer who follows the README sets nothing for the engine, and the
 * install still finds it. Everything else here is about failing loudly
 * when an operator has said something they did not mean.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOC_ENGINE_URL,
  DocEngineConfigError,
  createDocEngineFromEnv,
  readDocEngineConfig,
} from "./config.js";
import {
  DEFAULT_DOC_ENGINE_COMPARE_TIMEOUT_MS,
  DEFAULT_DOC_ENGINE_TIMEOUT_MS,
  MAX_DOC_ENGINE_TIMEOUT_MS,
  MAX_DOC_ENGINE_COMPARE_TIMEOUT_MS,
} from "./http.js";
import {
  DOCUMENT_COMPARISON_QUEUE_OPTIONS,
  DISPLAY_CONVERSION_QUEUE_OPTIONS,
  TEXT_EXTRACTION_QUEUE_OPTIONS,
} from "../../pipeline/pg-boss.js";

describe("doc engine configuration", () => {
  it("finds the sidecar on the compose network with nothing configured", () => {
    // The blessed stack's promise (TECH-017): `docker compose up` and
    // the engine is there, with no variable set for it.
    expect(readDocEngineConfig({})).toEqual({ baseUrl: DEFAULT_DOC_ENGINE_URL });
  });

  it("treats an empty variable as unset", () => {
    // Under Compose every declared variable exists and is empty when
    // .env leaves it out.
    expect(readDocEngineConfig({ DOC_ENGINE_URL: "  " })).toEqual({
      baseUrl: DEFAULT_DOC_ENGINE_URL,
    });
  });

  it("takes the URL an operator sets", () => {
    expect(readDocEngineConfig({ DOC_ENGINE_URL: "https://engine.example.com" })).toEqual({
      baseUrl: "https://engine.example.com",
    });
  });

  it("takes a bound an operator sets", () => {
    expect(readDocEngineConfig({ DOC_ENGINE_TIMEOUT_MS: "60000" })).toEqual({
      baseUrl: DEFAULT_DOC_ENGINE_URL,
      timeoutMs: 60_000,
    });
  });

  it("leaves the default bound alone when none is set", () => {
    expect(readDocEngineConfig({})).not.toHaveProperty("timeoutMs");
    expect(DEFAULT_DOC_ENGINE_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it("takes a compare bound of its own, on the same shape as conversion's", () => {
    // Compare is the slowest operation and is bounded separately, so an
    // install can lengthen it without lengthening every other call.
    expect(readDocEngineConfig({ DOC_ENGINE_COMPARE_TIMEOUT_MS: "800000" })).toEqual({
      baseUrl: DEFAULT_DOC_ENGINE_URL,
      compareTimeoutMs: 800_000,
    });
    expect(readDocEngineConfig({})).not.toHaveProperty("compareTimeoutMs");
    expect(readDocEngineConfig({ DOC_ENGINE_COMPARE_TIMEOUT_MS: "" })).not.toHaveProperty(
      "compareTimeoutMs",
    );
    expect(DEFAULT_DOC_ENGINE_COMPARE_TIMEOUT_MS).toBeGreaterThan(DEFAULT_DOC_ENGINE_TIMEOUT_MS);
  });

  it.each(["not a url", "doc-engine:8080", "/convert", "ftp://engine", "ws://engine"])(
    "refuses the URL %j",
    (url) => {
      expect(() => readDocEngineConfig({ DOC_ENGINE_URL: url })).toThrow(DocEngineConfigError);
    },
  );

  it.each(["0", "-1", "soon", "1.5"])("refuses the bound %j", (timeout) => {
    expect(() => readDocEngineConfig({ DOC_ENGINE_TIMEOUT_MS: timeout })).toThrow(
      DocEngineConfigError,
    );
    expect(() => readDocEngineConfig({ DOC_ENGINE_COMPARE_TIMEOUT_MS: timeout })).toThrow(
      "DOC_ENGINE_COMPARE_TIMEOUT_MS must be a whole number of milliseconds.",
    );
  });

  it("refuses a bound the queue could not hold, and says why", () => {
    // An install that raised the bound past this would have a job's
    // lease expire while its second engine call was still running, and
    // pg-boss would hand the same version to a second worker.
    expect(() =>
      readDocEngineConfig({ DOC_ENGINE_TIMEOUT_MS: String(MAX_DOC_ENGINE_TIMEOUT_MS + 1) }),
    ).toThrow(DocEngineConfigError);
    expect(
      readDocEngineConfig({ DOC_ENGINE_TIMEOUT_MS: String(MAX_DOC_ENGINE_TIMEOUT_MS) }),
    ).toEqual({ baseUrl: DEFAULT_DOC_ENGINE_URL, timeoutMs: MAX_DOC_ENGINE_TIMEOUT_MS });
    expect(() =>
      readDocEngineConfig({
        DOC_ENGINE_COMPARE_TIMEOUT_MS: String(MAX_DOC_ENGINE_COMPARE_TIMEOUT_MS + 1),
      }),
    ).toThrow(DocEngineConfigError);
    expect(
      readDocEngineConfig({
        DOC_ENGINE_COMPARE_TIMEOUT_MS: String(MAX_DOC_ENGINE_COMPARE_TIMEOUT_MS),
      }),
    ).toEqual({
      baseUrl: DEFAULT_DOC_ENGINE_URL,
      compareTimeoutMs: MAX_DOC_ENGINE_COMPARE_TIMEOUT_MS,
    });
  });

  it("keeps the ceiling and the queue's budget in step", () => {
    // The arithmetic the ceiling exists for, asserted rather than
    // written in a comment: the worst job makes two sequential engine
    // calls, and both plus a minute of reads and writes have to fit
    // inside the queue's expiry. Changing one of the three without the
    // others fails here.
    const margin = 60_000;
    for (const queue of [TEXT_EXTRACTION_QUEUE_OPTIONS, DISPLAY_CONVERSION_QUEUE_OPTIONS]) {
      expect(MAX_DOC_ENGINE_TIMEOUT_MS * 2 + margin).toBeLessThanOrEqual(
        queue.expireInSeconds * 1000,
      );
    }
    expect(DEFAULT_DOC_ENGINE_TIMEOUT_MS).toBeLessThanOrEqual(MAX_DOC_ENGINE_TIMEOUT_MS);
    expect(MAX_DOC_ENGINE_COMPARE_TIMEOUT_MS + margin).toBeLessThanOrEqual(
      DOCUMENT_COMPARISON_QUEUE_OPTIONS.expireInSeconds * 1000,
    );
    expect(DEFAULT_DOC_ENGINE_COMPARE_TIMEOUT_MS).toBeLessThanOrEqual(
      MAX_DOC_ENGINE_COMPARE_TIMEOUT_MS,
    );
  });

  it("takes an empty bound as unset rather than as a fault", () => {
    // Under Compose a variable that .env leaves out still arrives, as
    // the empty string. That is "not configured", not a bad value.
    expect(readDocEngineConfig({ DOC_ENGINE_TIMEOUT_MS: "" })).toEqual({
      baseUrl: DEFAULT_DOC_ENGINE_URL,
    });
  });

  it("never names the value it refused", () => {
    // The message reaches stderr at boot. A URL read out of the
    // environment can carry a credential in its userinfo, and a value an
    // operator set is not ours to print back at them. The message names
    // the variable and what it accepts, and nothing else.
    expect(() =>
      readDocEngineConfig({ DOC_ENGINE_URL: "https://engine.example.com:not-a-port" }),
    ).toThrow(/^DOC_ENGINE_URL must be an absolute http or https URL\.$/);
  });

  it("builds an engine from a configured environment", () => {
    const engine = createDocEngineFromEnv({ DOC_ENGINE_URL: "http://engine.example.com:8080" });
    expect(typeof engine.convertToPdf).toBe("function");
    expect(typeof engine.compare).toBe("function");
    expect(typeof engine.ocrPdf).toBe("function");
    expect(typeof engine.extractPdfText).toBe("function");
  });
});
