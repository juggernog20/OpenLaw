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
 *
 * **It takes two variables to move an install off DocuSign, and they
 * have to agree.** `compose.yml` passes `.env` to both processes, so one
 * line in the wrong `.env` would otherwise send a real install's paper
 * to whatever host it named, with a warning in the boot log as the only
 * sign. `SIGNING_STANDIN` is the second fact: it carries no address and
 * says only "this install is deliberately not talking to DocuSign".
 * Either one without the other stops the boot.
 *
 * The pairing is checked **here** rather than at each entrypoint, and
 * that is the point. The API and the worker each read this, and one
 * guarded without the other would be worse than neither — a send that
 * goes to the stand-in and an executed copy fetched from DocuSign, or
 * the reverse. One function, two callers, nothing to forget.
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
 * The one value {@link SIGNING_STANDIN_VARIABLE} accepts.
 *
 * Exactly this, case-insensitively, and nothing else — not `1`, not
 * `yes`, not `on`. A declaration that this install is deliberately not
 * talking to DocuSign should be written out, and a near miss is an
 * operator who meant something we should not guess at.
 */
export const SIGNING_STANDIN_VALUE = "true";

/** The second fact, so that one mistyped line cannot move an install. */
export const SIGNING_STANDIN_VARIABLE = "SIGNING_STANDIN";

/**
 * Whether this deployment has declared itself a stand-in deployment.
 *
 * Empty is unset, as it is for every other Compose variable. Anything
 * else that is not {@link SIGNING_STANDIN_VALUE} stops the boot: the
 * variable's whole job is to be unambiguous, and a value we shrugged at
 * would be one an operator believed had taken effect.
 */
function readStandInFlag(env: SigningHostEnvironment): boolean {
  const value = env[SIGNING_STANDIN_VARIABLE]?.trim();
  if (!value) return false;
  if (value.toLowerCase() !== SIGNING_STANDIN_VALUE) {
    throw new SigningHostConfigError(
      `${SIGNING_STANDIN_VARIABLE} must be "${SIGNING_STANDIN_VALUE}" or unset.`,
    );
  }
  return true;
}

/**
 * The stand-in's origin, or undefined on every install that has none.
 *
 * Empty is unset, as it is for every other Compose variable: the
 * overlay always declares the name, and an empty value means the
 * deployment said nothing about it.
 *
 * Throws {@link SigningHostConfigError} when the value is not an
 * absolute http or https origin, and when the two variables disagree.
 */
export function readDocuSignBaseUrl(env: SigningHostEnvironment): string | undefined {
  const standIn = readStandInFlag(env);
  const value = env.DOCUSIGN_BASE_URL?.trim();
  if (!value) {
    // The flag alone. Refused rather than ignored, because the honest
    // reading is that the address was meant to be there and was lost —
    // a typo in the name, a line dropped from the overlay — and this
    // install would then dial DocuSign while its operator believed it
    // could not.
    if (standIn) {
      throw new SigningHostConfigError(
        `${SIGNING_STANDIN_VARIABLE} is set but DOCUSIGN_BASE_URL names no stand-in. ` +
          "Set both, or neither.",
      );
    }
    return undefined;
  }
  // The address alone. This is the mistake the second variable exists
  // for: one line in the wrong .env would otherwise send this install's
  // paper to whatever host it names.
  if (!standIn) {
    throw new SigningHostConfigError(
      `DOCUSIGN_BASE_URL moves every signing call off DocuSign, so it is refused without ` +
        `${SIGNING_STANDIN_VARIABLE}=${SIGNING_STANDIN_VALUE}. Set both on a dev or E2E ` +
        "stack; a real install sets neither.",
    );
  }
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
  // Credentials in the URL would be dropped with the rest of the
  // non-origin parts, and the driver carries its own — refused for the
  // same reason as a path.
  if (parsed.username !== "" || parsed.password !== "") {
    throw new SigningHostConfigError(
      "DOCUSIGN_BASE_URL must name an origin only — no credentials.",
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
