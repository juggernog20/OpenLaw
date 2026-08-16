// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Where DocuSign is, read from the environment (TECH-013, TECH-018).
 *
 * The connector's **credentials** are org data and are never read here
 * (CTR-013): an Administrator saves them in Settings and the resolver
 * reads the row live. What this file answers is a different question —
 * which host those credentials are presented to.
 *
 * The answer is DocuSign's own estate, always, on every deployment. The
 * one exception is the dev/E2E overlay, which points the driver at a
 * stand-in on the host so a test send can never reach a real DocuSign
 * account. That is the Mailpit rule applied to signing: the overlay
 * pins the outbound side to a local catcher, because a suite that
 * replays a send hundreds of times must not be able to post paper to
 * somebody's account.
 *
 * `DOCUSIGN_BASE_URL` is therefore an overlay switch and not a
 * deployment setting. Unset — which is every real install — the driver
 * uses the hosts the stored connector's environment names, and nothing
 * in this file is reachable from a production stack.
 */

import { createDocuSignProvider } from "./docusign.js";
import type { SigningDriverFactory } from "./resolver.js";

/** The process environment, or a stand-in for it in a test. */
export type SigningHostEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * A configuration fault the operator has to fix. Thrown rather than
 * defaulted around, for `DocEngineConfigError`'s reason: an install
 * told to reach the provider somewhere specific must stop rather than
 * quietly call DocuSign, which is the one call this switch exists to
 * prevent.
 */
export class SigningHostConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SigningHostConfigError";
  }
}

/**
 * The stand-in's origin, or undefined on every install that has none.
 *
 * Empty is unset, as it is for every other Compose variable: the
 * overlay always declares the name, and an empty value means the
 * deployment said nothing about it.
 *
 * Throws {@link SigningHostConfigError} when the value is not an
 * absolute http or https origin.
 */
export function readDocuSignBaseUrl(env: SigningHostEnvironment): string | undefined {
  const value = env.DOCUSIGN_BASE_URL?.trim();
  if (!value) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    // The name and what it accepts, never what it was given: this
    // message reaches stderr at boot, and the operator knows what they
    // set.
    throw new SigningHostConfigError("DOCUSIGN_BASE_URL must be an absolute http or https URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SigningHostConfigError("DOCUSIGN_BASE_URL must be an absolute http or https URL.");
  }
  // An origin, and only an origin. The driver appends DocuSign's own
  // paths to this value, so anything else here would be dropped rather
  // than honoured — and a switch that quietly ignores half of what it
  // was given is the failure this whole file exists to prevent.
  if (parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
    throw new SigningHostConfigError(
      "DOCUSIGN_BASE_URL must name an origin only — no path, query, or fragment.",
    );
  }
  return parsed.origin;
}

/**
 * The driver factory the signing resolver builds each provider with.
 *
 * With no override this is `createDocuSignProvider` itself, so a real
 * install carries no indirection and no environment-shaped behaviour at
 * all. With one, every driver the resolver builds talks to the
 * stand-in instead — both the token exchange and the account discovery
 * that names the REST base after it.
 */
export function createDocuSignDriverFactory(baseUrl?: string): SigningDriverFactory {
  if (baseUrl === undefined) return createDocuSignProvider;
  return (config) => createDocuSignProvider(config, { hosts: { auth: baseUrl, api: baseUrl } });
}
