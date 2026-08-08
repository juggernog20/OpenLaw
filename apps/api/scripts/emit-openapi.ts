// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Emits the generated OpenAPI 3.1 document to apps/api/openapi.json —
 * the committed artifact the typed client (@openlaw/api-client) is
 * generated from. Run via `pnpm openapi` at the repo root.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app.js";

const app = await buildApp({ logger: false });
await app.ready();

const document = app.swagger();
const target = fileURLToPath(new URL("../openapi.json", import.meta.url));
writeFileSync(target, JSON.stringify(document, null, 2) + "\n");

await app.close();
console.log(`Wrote ${target}`);
