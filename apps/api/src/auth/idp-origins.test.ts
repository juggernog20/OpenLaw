// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Resolver } from "../pipeline/push-endpoint.js";
import {
  storedProviderOrigins,
  trustableEndpointOrigins,
  withTrustedIdpOrigins,
} from "./idp-origins.js";

const ADDRESSES: Record<string, string[]> = {
  "login.microsoftonline.com": ["20.190.160.1"],
  "graph.microsoft.com": ["20.190.128.1", "2603:1026::1"],
  "internal.corp": ["10.0.0.5"],
  "mixed.example": ["20.1.1.1", "192.168.1.1"],
  "keycloak.lan": ["192.168.1.20"],
  "auth.lan": ["192.168.1.21"],
};

/** Answers from the table above; any other name does not resolve. */
const resolve: Resolver = async (hostname) => {
  const answers = ADDRESSES[hostname];
  if (!answers) throw new Error(`ENOTFOUND ${hostname}`);
  return answers.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
};

const ENTRA_ISSUER = "https://login.microsoftonline.com/tenant-id/v2.0";

const entraDocument = (overrides: Record<string, unknown> = {}) => ({
  issuer: ENTRA_ISSUER,
  authorization_endpoint: "https://login.microsoftonline.com/tenant-id/oauth2/v2.0/authorize",
  token_endpoint: "https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token",
  jwks_uri: "https://login.microsoftonline.com/tenant-id/discovery/v2.0/keys",
  userinfo_endpoint: "https://graph.microsoft.com/oidc/userinfo",
  end_session_endpoint: "https://login.microsoftonline.com/tenant-id/oauth2/v2.0/logout",
  ...overrides,
});

describe("trustableEndpointOrigins", () => {
  it("trusts Entra ID's userinfo origin, which is public", async () => {
    expect(await trustableEndpointOrigins(ENTRA_ISSUER, entraDocument(), resolve)).toEqual([
      "https://graph.microsoft.com",
    ]);
  });

  it("refuses private endpoints named by a public issuer", async () => {
    const document = entraDocument({
      userinfo_endpoint: "https://internal.corp/userinfo",
      jwks_uri: "http://169.254.169.254/latest/meta-data",
      revocation_endpoint: "https://mixed.example/revoke",
      introspection_endpoint: "https://nowhere.example/introspect",
    });
    expect(await trustableEndpointOrigins(ENTRA_ISSUER, document, resolve)).toEqual([]);
  });

  it("trusts every endpoint origin of an issuer that is itself private", async () => {
    const document = {
      token_endpoint: "https://auth.lan/token",
      userinfo_endpoint: "http://127.0.0.1:8080/userinfo",
    };
    expect(
      await trustableEndpointOrigins("https://keycloak.lan/realms/org", document, resolve),
    ).toEqual(["https://auth.lan", "http://127.0.0.1:8080"]);
  });

  it("adds nothing for same-origin, relative or non-http endpoints", async () => {
    const document = entraDocument({
      userinfo_endpoint: "/oidc/userinfo",
      revocation_endpoint: "javascript:alert(1)",
      introspection_endpoint: 42,
    });
    expect(await trustableEndpointOrigins(ENTRA_ISSUER, document, resolve)).toEqual([]);
    expect(await trustableEndpointOrigins(ENTRA_ISSUER, null, resolve)).toEqual([]);
    expect(await trustableEndpointOrigins(ENTRA_ISSUER, "not a document", resolve)).toEqual([]);
  });
});

describe("withTrustedIdpOrigins", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("trusts the issuer and its discovered origins only while fn runs", async () => {
    vi.stubGlobal("fetch", async () => Response.json(entraDocument()));
    const ctx = { trustedOrigins: ["https://graph.microsoft.com", "http://localhost:5173"] };
    const auth = { $context: Promise.resolve(ctx) };
    let during: string[] = [];
    await expect(
      withTrustedIdpOrigins(
        auth,
        ENTRA_ISSUER,
        async () => {
          during = [...ctx.trustedOrigins];
          throw new Error("registration failed");
        },
        resolve,
      ),
    ).rejects.toThrow("registration failed");
    expect(during).toContain("https://login.microsoftonline.com");
    expect(during.filter((origin) => origin === "https://graph.microsoft.com")).toHaveLength(2);
    // An origin that was trusted before the call stays trusted after it.
    expect(ctx.trustedOrigins).toEqual(["https://graph.microsoft.com", "http://localhost:5173"]);
  });

  it("falls back to the issuer's origin when discovery cannot be read", async () => {
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 500 }));
    const ctx = { trustedOrigins: [] as string[] };
    const seen = await withTrustedIdpOrigins(
      { $context: Promise.resolve(ctx) },
      ENTRA_ISSUER,
      async () => [...ctx.trustedOrigins],
      resolve,
    );
    expect(seen).toEqual(["https://login.microsoftonline.com"]);
    expect(ctx.trustedOrigins).toEqual([]);
  });
});

describe("storedProviderOrigins", () => {
  it("trusts the issuer and every stored endpoint's origin", () => {
    const oidcConfig = JSON.stringify({
      clientId: "openlaw",
      authorizationEndpoint: "https://login.microsoftonline.com/t/oauth2/v2.0/authorize",
      tokenEndpoint: "https://login.microsoftonline.com/t/oauth2/v2.0/token",
      userInfoEndpoint: "https://graph.microsoft.com/oidc/userinfo",
    });
    expect(storedProviderOrigins({ issuer: ENTRA_ISSUER, oidcConfig })).toEqual([
      "https://login.microsoftonline.com",
      "https://graph.microsoft.com",
    ]);
  });

  it("keeps the issuer when the config cannot be read, and nothing for a bad issuer", () => {
    expect(storedProviderOrigins({ issuer: ENTRA_ISSUER, oidcConfig: "{not json" })).toEqual([
      "https://login.microsoftonline.com",
    ]);
    expect(storedProviderOrigins({ issuer: ENTRA_ISSUER, oidcConfig: null })).toEqual([
      "https://login.microsoftonline.com",
    ]);
    expect(storedProviderOrigins({ issuer: "not a url", oidcConfig: null })).toEqual([]);
  });
});
