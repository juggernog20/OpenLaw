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
import type { Mailer, MailMessage } from "../lib/mailer.js";

/** Shared by every test app so session cookies verify across instances. */
export const TEST_AUTH_CONFIG: AuthConfig = {
  secret: "openlaw-test-secret-with-enough-entropy-000",
  baseUrl: "http://localhost",
};

/** The initial Administrator most suites create via first-run setup. */
export const TEST_ADMIN = {
  email: "blair@example.com",
  displayName: "Blair Wentworth",
  password: "correct-horse-battery",
} as const;

type App = Awaited<ReturnType<typeof buildApp>>;

/** Password sign-in through the mounted better-auth handler. */
export async function signIn(app: App, email: string, password: string) {
  return app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    payload: { email, password },
  });
}

/** Signs in, requiring success, and returns the cookies as a request map. */
export async function signInCookies(
  app: App,
  email: string,
  password: string,
): Promise<Record<string, string>> {
  const res = await signIn(app, email, password);
  if (res.statusCode !== 200) {
    throw new Error(`sign-in as ${email} failed (${res.statusCode}): ${res.body}`);
  }
  const cookies: Record<string, string> = {};
  for (const c of res.cookies) cookies[c.name] = c.value;
  return cookies;
}

/**
 * TECH-011 fake: captures outbound mail so tests can extract invite and
 * magic-link tokens from what a real recipient would have received.
 */
export class CapturingMailer implements Mailer {
  readonly messages: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    this.messages.push(message);
    return Promise.resolve();
  }

  /** Captured messages addressed to one recipient, oldest first. */
  messagesTo(email: string): MailMessage[] {
    return this.messages.filter((m) => m.to === email);
  }
}

export interface TestHarness {
  app: Awaited<ReturnType<typeof buildApp>>;
  db: Db;
  mailer: CapturingMailer;
  stop: () => Promise<void>;
}

export async function startHarness(): Promise<TestHarness> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    "postgres:16-alpine",
  ).start();
  const db = createDb(container.getConnectionUri());
  await runMigrations(db);
  const mailer = new CapturingMailer();
  const app = await buildApp({ db, config: TEST_AUTH_CONFIG, mailer });
  await app.ready();
  return {
    app,
    db,
    mailer,
    stop: async () => {
      await app.close();
      await db.$client.end();
      await container.stop();
    },
  };
}
