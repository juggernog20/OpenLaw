// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Mounts better-auth's own handler at /api/auth/* (TECH-008). Browser
 * auth flows (sign-in, sign-out, OAuth callbacks) go through here; the
 * routes are deliberately absent from our OpenAPI document — better-auth
 * publishes its own reference. Encapsulated so the raw-body content-type
 * parsers below never leak into the zod-validated /api/v1 routes.
 */

import type { FastifyPluginAsync } from "fastify";
import { httpError } from "../lib/problem.js";
import { dynamicRegistrationEnabled } from "./allowed-clients.js";
import { transactionalOAuth } from "./oauth-management.js";
import { fromNodeHeaders } from "better-auth/node";

function normalizedAuthPath(pathname: string): string {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // A malformed escape cannot spell the plugin's path; better-auth answers it.
  }
  return decoded.replace(/\/+/g, "/");
}

export const authHandler: FastifyPluginAsync = async (app) => {
  // better-auth parses its own bodies (JSON, and form-urlencoded per
  // RFC 6749 for OIDC callbacks) — hand it the raw payload untouched.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, payload, done) => {
    done(null, payload);
  });

  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    // A 1 MB avatar expands to roughly 1.4 MB in base64; allow JSON overhead too.
    bodyLimit: 4 * Math.ceil((1024 * 1024) / 3) + 16 * 1024,
    schema: { hide: true },
    handler: async (request, reply) => {
      const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
      const path = normalizedAuthPath(url.pathname);
      const endpoint = path.replace(/\/$/, "");
      if (endpoint === "/api/auth/oauth2/consent")
        throw httpError(403, "Complete consent through the OpenLaw consent page.");
      if (endpoint === "/api/auth/oauth2/create-client")
        throw httpError(403, "Client registration requires the Allowed Clients list.");
      if (
        [
          "/api/auth/oauth2/update-client",
          "/api/auth/oauth2/delete-client",
          "/api/auth/oauth2/client/rotate-secret",
        ].includes(endpoint)
      )
        throw httpError(403, "Manage Clients through the Allowed Clients list.");
      if (endpoint === "/api/auth/oauth2/register" && !(await dynamicRegistrationEnabled(app.db)))
        throw httpError(403, "Dynamic Client registration is disabled.");
      // DD-029: keys are minted by an approved request, never by the plugin's own endpoints.
      if (path.startsWith("/api/auth/api-key/"))
        throw httpError(403, "API keys require an approved API key request.");
      const body = request.body as Buffer | undefined;
      const headers = fromNodeHeaders(request.headers);
      // better-auth keys its sign-in rate limiter on `X-Forwarded-For`
      // and cannot see the socket, so on its own it believes whatever
      // the client wrote there. Fastify has already resolved the client
      // address against `TRUSTED_PROXIES` (TECH-032); hand that address
      // over as the one value of the header, and the spoofable one
      // never reaches the library.
      headers.set("x-forwarded-for", request.ip);
      const authRequest = new Request(url, {
        method: request.method,
        headers,
        body: body && body.length > 0 ? new Uint8Array(body) : undefined,
      });
      const response =
        endpoint === "/api/auth/oauth2/register"
          ? await app.db
              .transaction(async (tx) => {
                const response = await transactionalOAuth(app.auth, tx).handler(authRequest);
                if (!response.ok) throw response;
                return response;
              })
              .catch((error: unknown) => {
                if (error instanceof Response) return error;
                throw error;
              })
          : await app.auth.handler(authRequest);

      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key !== "set-cookie") void reply.header(key, value);
      });
      const setCookies = response.headers.getSetCookie();
      if (setCookies.length > 0) void reply.header("set-cookie", setCookies);
      return reply.send(response.body ? Buffer.from(await response.arrayBuffer()) : null);
    },
  });
};
