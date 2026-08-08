// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Mounts better-auth's own handler at /api/auth/* (TECH-008). Browser
 * auth flows (sign-in, sign-out, OAuth callbacks) go through here; the
 * routes are deliberately absent from our OpenAPI document — better-auth
 * publishes its own reference. Encapsulated so the raw-body content-type
 * parsers below never leak into the zod-validated /api/v1 routes.
 */

import type { FastifyPluginAsync } from "fastify";
import { fromNodeHeaders } from "better-auth/node";

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
    schema: { hide: true },
    handler: async (request, reply) => {
      const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
      const body = request.body as Buffer | undefined;
      const response = await app.auth.handler(
        new Request(url, {
          method: request.method,
          headers: fromNodeHeaders(request.headers),
          body: body && body.length > 0 ? new Uint8Array(body) : undefined,
        }),
      );

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
