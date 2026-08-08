// SPDX-License-Identifier: AGPL-3.0-only

/**
 * OpenLaw API server entry — builds the app (see app.ts) and listens.
 */

import { buildApp } from "./app.js";

const app = await buildApp({ logger: true });

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
