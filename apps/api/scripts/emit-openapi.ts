// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Emits the generated OpenAPI 3.1 document to apps/api/openapi.json —
 * the committed artifact the typed client (@openlaw/api-client) is
 * generated from. Run via `pnpm openapi` at the repo root.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDb } from "@openlaw/db";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.js";
import { createUnconfiguredMailer } from "../src/lib/mailer.js";
import { createLocalStorage } from "../src/lib/storage/local.js";
import { createFakeDocEngine } from "../src/lib/doc-engine/fake.js";
import { createNotifier } from "../src/lib/notifications/notifier.js";
import { createTestingEventHub } from "../src/lib/event-hub.js";
import { createUnconfiguredJobQueue } from "../src/pipeline/jobs.js";
import { createUnconfiguredSigningResolver } from "../src/lib/signing/resolver.js";
import { createUnconfiguredAiResolver } from "../src/lib/ai/resolver.js";

// Rendering the document only registers routes; nothing connects to the
// database, sends mail, or stores a file, so inert stand-in dependencies
// suffice. The local driver creates nothing until something writes.
const db = createDb("postgres://emit:emit@localhost:5432/never-connected");
const jobs = createUnconfiguredJobQueue();

const app = await buildApp(
  {
    db,
    config: { secret: "openapi-emit-only-never-a-real-secret-00", baseUrl: "http://localhost" },
    resolveMailer: () =>
      Promise.resolve({ source: "unset", from: null, mailer: createUnconfiguredMailer() }),
    storage: createLocalStorage({ root: join(tmpdir(), "openlaw-openapi-emit-never-written") }),
    docEngine: createFakeDocEngine(),
    jobs,
    resolveSigningProvider: createUnconfiguredSigningResolver(),
    resolveAiProvider: createUnconfiguredAiResolver(),
    notifier: createNotifier({ db, jobs, log: { error: () => {} } }),
    eventHub: createTestingEventHub(),
  },
  { logger: false },
);
await app.ready();

const document = app.swagger();
const target = fileURLToPath(new URL("../openapi.json", import.meta.url));
writeFileSync(target, JSON.stringify(document, null, 2) + "\n");

await app.close();
console.log(`Wrote ${target}`);
