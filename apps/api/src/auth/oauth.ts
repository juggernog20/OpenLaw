// SPDX-License-Identifier: AGPL-3.0-only

import { mcp } from "@better-auth/mcp";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { jwt } from "better-auth/plugins";
import { MCP_TOOLSETS } from "@openlaw/shared";

export const MCP_SCOPES = [...MCP_TOOLSETS.map((id) => `toolset:${id}`), "write", "offline_access"];
export const mcpResource = (baseUrl: string) => `${baseUrl.replace(/\/$/, "")}/mcp`;

/**
 * Matches validateMcpResource in @better-auth/mcp 1.7.5 before its throwing
 * factory runs. The plugin ships its own loopback test, narrower than the one
 * in @better-auth/core. It accepts `localhost` itself, `[::1]` and 127.0.0.0/8
 * and refuses a `.localhost` subdomain. oauth-resource.test.ts pins the agreement.
 */
export function authorizationServerAvailable(baseUrl: string): boolean {
  const resource = mcpResource(baseUrl);
  let url: URL;
  try {
    url = new URL(resource);
  } catch {
    return false;
  }
  if (url.username || url.password || resource.includes("?") || resource.includes("#"))
    return false;
  const octets = url.hostname.split(".");
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "[::1]" ||
    (octets.length === 4 &&
      octets[0] === "127" &&
      octets.every((o) => /^\d+$/.test(o) && Number(o) <= 255));
  return url.protocol === "https:" || (url.protocol === "http:" && loopback);
}

export function oauthPlugins(baseUrl: string, grantLifetimeDays = 90) {
  if (!authorizationServerAvailable(baseUrl)) return [];
  const provider = mcp({
    resource: mcpResource(baseUrl),
    refreshTokenExpiresIn: grantLifetimeDays * 86_400,
    loginPage: "/auth/login",
    consentPage: "/auth/consent",
    scopes: MCP_SCOPES,
    grantTypes: ["authorization_code", "refresh_token"],
    allowDynamicClientRegistration: false,
    allowUnauthenticatedClientRegistration: false,
    // M41/3 owns Client management. Only the server API can create Clients for now.
    clientPrivileges: ({ user }) => user?.role === "administrator",
    resourcePrivileges: () => false,
  });
  const serveDiscovery = provider.onRequest;
  provider.onRequest = (request, ctx) => {
    const url = new URL(request.url);
    // 1.7.5 serves resource metadata only at the root. Give it the auth-prefix alias.
    if (url.pathname === "/api/auth/.well-known/oauth-protected-resource") {
      url.pathname = "/.well-known/oauth-protected-resource";
    }
    // OpenLaw has no OIDC identity scopes. Both discovery names describe its OAuth server.
    if (url.pathname === "/api/auth/.well-known/openid-configuration") {
      url.pathname = "/api/auth/.well-known/oauth-authorization-server";
    }
    return serveDiscovery?.(url.href === request.url ? request : new Request(url, request), ctx);
  };
  return [
    // The adapter pluralizes model names; the physical key table is jwks.
    jwt({ schema: { jwks: { modelName: "jwk" } } }),
    provider,
    cimd({
      fetchClientMetadataResource,
      metadataProfile: "mcp-2026-07-28",
      // M41/3 supplies the Allowed Clients gate. Refuse before transport or DNS work.
      isMetadataDocumentUrlAllowed: () => false,
    }),
  ];
}
