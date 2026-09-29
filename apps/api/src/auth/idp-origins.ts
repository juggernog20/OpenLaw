// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Which origins the sso plugin may reach for a runtime-registered IdP
 * (TECH-008, #1229).
 *
 * The plugin refuses discovery unless every endpoint the discovery
 * document names sits on a trusted origin. An IdP does not always keep
 * its endpoints on the issuer's origin. Entra ID's issuer is on
 * login.microsoftonline.com, but its userinfo endpoint is on
 * graph.microsoft.com. Google splits its endpoints across four hosts.
 * So trusting the issuer's origin alone is not enough.
 *
 * Trust in an origin also switches off the plugin's private-address
 * check for it. The rule below keeps that check in force. An endpoint
 * on a public address is trusted. An endpoint on a private address is
 * trusted only when the issuer is private too: the Administrator has
 * already pointed OpenLaw at an internal IdP, and its endpoints share
 * that decision. A public IdP cannot steer the server into the
 * install's own network through its discovery document.
 */

import net from "node:net";
import dns from "node:dns";
import { isPublicAddress, type Resolver } from "../pipeline/push-endpoint.js";

/** The discovery fields the plugin checks against the trusted origins. */
const DISCOVERY_ENDPOINTS = [
  "authorization_endpoint",
  "token_endpoint",
  "jwks_uri",
  "userinfo_endpoint",
  "revocation_endpoint",
  "end_session_endpoint",
  "introspection_endpoint",
] as const;

/** The endpoint fields the plugin stores in a provider's OIDC config. */
const STORED_ENDPOINTS = [
  "discoveryEndpoint",
  "authorizationEndpoint",
  "tokenEndpoint",
  "jwksEndpoint",
  "userInfoEndpoint",
] as const;

const DISCOVERY_TIMEOUT_MS = 10_000;

const systemResolver: Resolver = (hostname) => dns.promises.lookup(hostname, { all: true });

/** An http(s) URL's origin, or null for anything else. */
function httpOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Whether every address the origin's host has is public. A host that
 * does not resolve counts as private, so it gains no trust.
 */
async function isPublicOrigin(origin: string, resolve: Resolver): Promise<boolean> {
  const hostname = new URL(origin).hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(hostname) !== 0) return isPublicAddress(hostname);
  try {
    const answers = await resolve(hostname);
    return answers.length > 0 && answers.every((answer) => isPublicAddress(answer.address));
  } catch {
    return false;
  }
}

/**
 * The origins, other than the issuer's own, that a discovery document
 * names and that may be trusted under the rule at the top of this file.
 * Relative endpoints resolve onto the issuer's origin, so they add
 * nothing. Exported for tests.
 */
export async function trustableEndpointOrigins(
  issuer: string,
  document: unknown,
  resolve: Resolver = systemResolver,
): Promise<string[]> {
  if (typeof document !== "object" || document === null) return [];
  const issuerOrigin = new URL(issuer).origin;
  const declared = new Set<string>();
  for (const field of DISCOVERY_ENDPOINTS) {
    const origin = httpOrigin((document as Record<string, unknown>)[field]);
    if (origin && origin !== issuerOrigin) declared.add(origin);
  }
  if (declared.size === 0) return [];
  if (!(await isPublicOrigin(issuerOrigin, resolve))) return [...declared];
  const trusted: string[] = [];
  for (const origin of declared) if (await isPublicOrigin(origin, resolve)) trusted.push(origin);
  return trusted;
}

/**
 * Reads the issuer's discovery document from the same URL the plugin
 * uses. Any failure answers null: the plugin then makes the same
 * request and reports the failure in its own words.
 */
async function fetchDiscoveryDocument(issuer: string): Promise<unknown> {
  const base = issuer.endsWith("/") ? issuer.slice(0, -1) : issuer;
  try {
    const response = await fetch(`${base}/.well-known/openid-configuration`, {
      redirect: "manual",
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/**
 * Runs `fn` with the issuer's origin, and the endpoint origins its
 * discovery document names, temporarily added to better-auth's trusted
 * origins. Registration-time discovery from a runtime-supplied issuer
 * then passes the sso plugin's SSRF guard. TECH-008 configures IdPs at
 * runtime, so there is no boot-time list to put them on.
 *
 * Direct `auth.api` calls run against the boot context. The per-request
 * `trustedOrigins` function in instance.ts runs only on the HTTP
 * handler path. So the boot context's live array is what must gain the
 * origins. They are removed again even when `fn` throws. Concurrent
 * requests during the window can see them. That is accepted: they are
 * origins an Administrator is in the act of asserting as the org's IdP,
 * and the public API gives no per-call context. After registration the
 * provider row carries the trust (see {@link storedProviderOrigins}).
 */
export async function withTrustedIdpOrigins<T>(
  auth: { $context: Promise<{ trustedOrigins: string[] }> },
  issuer: string,
  fn: () => Promise<T>,
  resolve: Resolver = systemResolver,
): Promise<T> {
  const origins = [
    new URL(issuer).origin,
    ...(await trustableEndpointOrigins(issuer, await fetchDiscoveryDocument(issuer), resolve)),
  ];
  const ctx = await auth.$context;
  ctx.trustedOrigins.push(...origins);
  try {
    return await fn();
  } finally {
    for (const origin of origins) {
      const index = ctx.trustedOrigins.lastIndexOf(origin);
      if (index >= 0) ctx.trustedOrigins.splice(index, 1);
    }
  }
}

/**
 * The origins a registered provider row trusts: its issuer's, and those
 * of the endpoints discovery stored for it. Registration accepted each
 * endpoint under the rule at the top of this file. A malformed issuer or
 * an unreadable config trusts nothing beyond what still parses.
 */
export function storedProviderOrigins(row: {
  issuer: string;
  oidcConfig: string | null;
}): string[] {
  const origins = new Set<string>();
  const issuerOrigin = httpOrigin(row.issuer);
  if (issuerOrigin) origins.add(issuerOrigin);
  let config: unknown = null;
  try {
    config = row.oidcConfig ? JSON.parse(row.oidcConfig) : null;
  } catch {
    // An unreadable config adds no endpoint origins.
  }
  if (typeof config === "object" && config !== null) {
    for (const field of STORED_ENDPOINTS) {
      const origin = httpOrigin((config as Record<string, unknown>)[field]);
      if (origin) origins.add(origin);
    }
  }
  return [...origins];
}
