// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Emits the generated OpenAPI 3.1 document to apps/api/openapi.json —
 * the committed artifact the typed client (@openlaw/api-client) is
 * generated from. Run via `pnpm openapi` at the repo root.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDb } from "@openlaw/db";
import { buildApp } from "../src/app.js";
import { createUnconfiguredMailer } from "../src/lib/mailer.js";

// Rendering the document only registers routes; nothing connects to the
// database or sends mail, so inert stand-in dependencies suffice.
const app = await buildApp(
  {
    db: createDb("postgres://emit:emit@localhost:5432/never-connected"),
    config: { secret: "openapi-emit-only-never-a-real-secret-00", baseUrl: "http://localhost" },
    resolveMailer: () =>
      Promise.resolve({ source: "unset", from: null, mailer: createUnconfiguredMailer() }),
  },
  { logger: false },
);
await app.ready();

const document = app.swagger();
const target = fileURLToPath(new URL("../openapi.json", import.meta.url));
writeFileSync(target, JSON.stringify(document, null, 2) + "\n");

await app.close();
console.log(`Wrote ${target}`);
