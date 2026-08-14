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
import { DEFAULT_DOC_ENGINE_TIMEOUT_MS } from "./http.js";

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

  it.each(["not a url", "doc-engine:8080", "/convert", "ftp://engine", "ws://engine"])(
    "refuses the URL %j",
    (url) => {
      expect(() => readDocEngineConfig({ DOC_ENGINE_URL: url })).toThrow(DocEngineConfigError);
    },
  );

  it.each(["0", "-1", "soon", "1.5", ""])("refuses the bound %j", (timeout) => {
    // Empty is the one exception: it means unset, so it is the default
    // rather than a fault.
    if (timeout === "") {
      expect(readDocEngineConfig({ DOC_ENGINE_TIMEOUT_MS: timeout })).toEqual({
        baseUrl: DEFAULT_DOC_ENGINE_URL,
      });
      return;
    }
    expect(() => readDocEngineConfig({ DOC_ENGINE_TIMEOUT_MS: timeout })).toThrow(
      DocEngineConfigError,
    );
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
    expect(typeof engine.ocrPdf).toBe("function");
    expect(typeof engine.extractPdfText).toBe("function");
  });
});
