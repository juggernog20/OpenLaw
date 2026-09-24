// SPDX-License-Identifier: AGPL-3.0-only

import type { FastifyPluginAsync } from "fastify";
import { authorizationServerAvailable } from "./oauth.js";
import { httpError } from "../lib/problem.js";

/** Root discovery aliases stay ahead of the SPA fallback and outside the OpenAPI contract. */
export const oauthDiscoveryRoutes: FastifyPluginAsync = async (app) => {
  for (const [name, suffixes] of [
    ["oauth-authorization-server", ["", "/api/auth"]],
    ["openid-configuration", ["", "/api/auth"]],
    ["oauth-protected-resource", ["", "/mcp"]],
  ] as const) {
    for (const suffix of suffixes) {
      app.get(
        `/.well-known/${name}${suffix}`,
        { schema: { hide: true } },
        async (request, reply) => {
          if (!authorizationServerAvailable(app.baseUrl)) throw httpError(404, "Not found.");
          const response = await app.auth.handler(
            new Request(new URL(`/api/auth/.well-known/${name}`, app.baseUrl), {
              method: request.method,
            }),
          );
          reply.status(response.status);
          response.headers.forEach((value, key) => reply.header(key, value));
          return reply.send(response.body ? Buffer.from(await response.arrayBuffer()) : null);
        },
      );
    }
  }
};
