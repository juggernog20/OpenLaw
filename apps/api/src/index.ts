// SPDX-License-Identifier: AGPL-3.0-only

/**
 * OpenLaw API server (TECH-003: Fastify + REST/OpenAPI).
 * Placeholder entry — routes, OpenAPI schema, and auth arrive in later steps.
 */

import Fastify from "fastify";

const app = Fastify({ logger: true });

app.get("/healthz", async () => ({ status: "ok" }));

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
