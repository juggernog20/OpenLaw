// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Where the doc engine is, read from the environment (TECH-010).
 *
 * The choice is made once, at startup, and the engine is injected. No
 * module below this one reads the environment for it, and no module
 * below this one knows there is a sidecar at all.
 *
 * The default is the sidecar's name on the compose network, so the
 * blessed stack needs no configuration for it: `docker compose up` and
 * the engine is there. `DOC_ENGINE_URL` exists for the deployment that
 * runs the sidecar somewhere else.
 */

import {
  DEFAULT_DOC_ENGINE_COMPARE_TIMEOUT_MS,
  DEFAULT_DOC_ENGINE_TIMEOUT_MS,
  DEFAULT_DOC_ENGINE_URL,
  MAX_DOC_ENGINE_TIMEOUT_MS,
  MAX_DOC_ENGINE_COMPARE_TIMEOUT_MS,
  createHttpDocEngine,
  type HttpDocEngineOptions,
} from "./http.js";
import type { DocEngine } from "./engine.js";

/** The process environment, or a stand-in for it in a test. */
export type DocEngineEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * A configuration fault the operator has to fix. Thrown rather than
 * defaulted around: an install told to reach the engine somewhere
 * specific must stop rather than quietly call the compose default,
 * which on that deployment is nothing at all.
 */
export class DocEngineConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocEngineConfigError";
  }
}

/**
 * Reads one variable, treating empty as unset.
 *
 * Under Compose every declared variable exists and is empty when the
 * `.env` file leaves it out, so empty has to mean "not configured" here
 * as it does for `SMTP_URL` and `STORAGE_PATH`.
 */
function read(env: DocEngineEnvironment, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

/**
 * Reads one bound, in whole milliseconds, or nothing when it is unset.
 *
 * Throws {@link DocEngineConfigError} for anything that is not a
 * positive whole number. The message names the variable and what it
 * accepts, never the value.
 */
function readBound(env: DocEngineEnvironment, name: string): number | undefined {
  const raw = read(env, name);
  if (raw === undefined) return undefined;
  const bound = Number(raw);
  if (!Number.isSafeInteger(bound) || bound <= 0) {
    throw new DocEngineConfigError(`${name} must be a whole number of milliseconds.`);
  }
  return bound;
}

/**
 * Reads the doc-engine configuration out of the environment, without
 * building anything from it.
 *
 * Throws {@link DocEngineConfigError} when the URL is malformed or names
 * a scheme the client cannot speak, or when a bound is not a positive
 * whole number of milliseconds.
 */
export function readDocEngineConfig(env: DocEngineEnvironment): HttpDocEngineOptions {
  const baseUrl = read(env, "DOC_ENGINE_URL") ?? DEFAULT_DOC_ENGINE_URL;
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    // The name and what it accepts, never what it was given: this
    // message reaches stderr at boot, and the operator knows what they
    // set.
    throw new DocEngineConfigError("DOC_ENGINE_URL must be an absolute http or https URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new DocEngineConfigError("DOC_ENGINE_URL must be an absolute http or https URL.");
  }

  const options: HttpDocEngineOptions = { baseUrl };

  const timeoutMs = readBound(env, "DOC_ENGINE_TIMEOUT_MS");
  // A bound the queue cannot hold is refused rather than accepted and
  // then broken. See MAX_DOC_ENGINE_TIMEOUT_MS for the arithmetic. An
  // install that took it would have jobs expire mid-conversion and get
  // handed to a second worker.
  if (timeoutMs !== undefined && timeoutMs > MAX_DOC_ENGINE_TIMEOUT_MS) {
    throw new DocEngineConfigError(
      `DOC_ENGINE_TIMEOUT_MS must be at most ${MAX_DOC_ENGINE_TIMEOUT_MS} milliseconds, ` +
        "so two engine calls still fit inside a derivation job's queue budget.",
    );
  }
  if (timeoutMs !== undefined) options.timeoutMs = timeoutMs;

  const compareTimeoutMs = readBound(env, "DOC_ENGINE_COMPARE_TIMEOUT_MS");
  if (compareTimeoutMs !== undefined && compareTimeoutMs > MAX_DOC_ENGINE_COMPARE_TIMEOUT_MS) {
    throw new DocEngineConfigError(
      `DOC_ENGINE_COMPARE_TIMEOUT_MS must be at most ${MAX_DOC_ENGINE_COMPARE_TIMEOUT_MS} milliseconds, ` +
        "so one engine call still fits inside a comparison job's queue budget.",
    );
  }
  if (compareTimeoutMs !== undefined) options.compareTimeoutMs = compareTimeoutMs;

  return options;
}

/** The default bounds, for the deployment that sets none of its own,
 * and the ceiling the queue's budget puts on the one it may set. */
export {
  DEFAULT_DOC_ENGINE_COMPARE_TIMEOUT_MS,
  DEFAULT_DOC_ENGINE_TIMEOUT_MS,
  DEFAULT_DOC_ENGINE_URL,
  MAX_DOC_ENGINE_TIMEOUT_MS,
  MAX_DOC_ENGINE_COMPARE_TIMEOUT_MS,
};

/** Builds the doc engine this install is configured for. */
export function createDocEngineFromEnv(env: DocEngineEnvironment): DocEngine {
  return createHttpDocEngine(readDocEngineConfig(env));
}
