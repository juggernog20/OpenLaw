// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Test harness: real Postgres via testcontainers (TECH-014 — never mocks,
 * never SQLite), committed migrations applied, app built through the same
 * factory production uses. Tests assert only at the HTTP seam.
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, runMigrations, type Db } from "@openlaw/db";
import { buildApp } from "../app.js";
import type { AuthConfig } from "../auth/instance.js";

/** Shared by every test app so session cookies verify across instances. */
export const TEST_AUTH_CONFIG: AuthConfig = {
  secret: "openlaw-test-secret-with-enough-entropy-000",
  baseUrl: "http://localhost",
};

export interface TestHarness {
  app: Awaited<ReturnType<typeof buildApp>>;
  db: Db;
  stop: () => Promise<void>;
}

export async function startHarness(): Promise<TestHarness> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    "postgres:16-alpine",
  ).start();
  const db = createDb(container.getConnectionUri());
  await runMigrations(db);
  const app = await buildApp({ db, config: TEST_AUTH_CONFIG });
  await app.ready();
  return {
    app,
    db,
    stop: async () => {
      await app.close();
      await db.$client.end();
      await container.stop();
    },
  };
}
