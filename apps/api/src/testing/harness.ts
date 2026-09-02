// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Test harness: real Postgres via testcontainers (TECH-014 — never mocks,
 * never SQLite), committed migrations applied, app built through the same
 * factory production uses. Tests assert only at the HTTP seam.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import {
  activityLog,
  asc,
  createDb,
  eq,
  orgSettings,
  readSecretKeys,
  runMigrations,
  SECRET_KEY_VARIABLE,
  useSecretKeys,
  type Db,
} from "@openlaw/db";
import { buildApp } from "../app.js";
import type { AuthConfig } from "../auth/instance.js";
import {
  createUnconfiguredMailer,
  type Mailer,
  type MailerResolver,
  type MailMessage,
} from "../lib/mailer.js";
import type { StorageAdapter } from "../lib/storage/adapter.js";
import { createLocalStorage } from "../lib/storage/local.js";
import type { DocEngine } from "../lib/doc-engine/engine.js";
import { createFakeDocEngine } from "../lib/doc-engine/fake.js";
import { createFakeSigningProvider, type FakeSigningProvider } from "../lib/signing/fake.js";
import { createSigningResolver, type SigningResolver } from "../lib/signing/resolver.js";
import { createFakeAiProvider, type FakeAiProvider } from "../lib/ai/fake.js";
import { createAiResolver, type AiResolver } from "../lib/ai/resolver.js";
import type { AiDriverFactory } from "../lib/ai/resolver.js";
import { createNotifier, type Notifier } from "../lib/notifications/notifier.js";
import { createPostgresEventHub } from "../lib/event-hub.js";
import { startPipeline, type Pipeline } from "../pipeline/pg-boss.js";
import type { PipelineLogger } from "../pipeline/logger.js";

/** Shared by every test app so session cookies verify across instances. */
export const TEST_AUTH_CONFIG: AuthConfig = {
  secret: "openlaw-test-secret-with-enough-entropy-000",
  baseUrl: "http://localhost",
};

/**
 * The credential-sealing key every suite runs with (TECH-022). Fixed
 * rather than random so two harnesses in one process — a suite that
 * starts a second pipeline against the same database — read each
 * other's rows.
 */
export const TEST_SECRET_KEY = "openlaw-test-secret-key-with-enough-entropy-0"; // NOSONAR — inert fixture, not a credential

/** The initial Administrator most suites create via first-run setup. */
export const TEST_ADMIN = {
  email: "blair@example.com",
  displayName: "Blair Wentworth",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
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

/** The set-password token a recipient would click, from a captured email. */
export function tokenFrom(text: string): string {
  const match = /\/auth\/set-password\?token=([A-Za-z0-9._~-]+)/.exec(text);
  if (!match?.[1]) throw new Error(`no set-password link in:\n${text}`);
  return match[1];
}

/** The magic-link verify URL a recipient would click, from a captured email. */
export function linkFrom(text: string): string {
  const match = /(https?:\/\/\S*\/api\/auth\/magic-link\/verify\?\S+)/.exec(text);
  if (!match?.[1]) throw new Error(`no magic-link verify URL in:\n${text}`);
  return match[1];
}

/**
 * TECH-011 fake: captures outbound mail so tests can extract invite and
 * magic-link tokens from what a real recipient would have received.
 */
export class CapturingMailer implements Mailer {
  // Configured by default: most suites exercise flows that send. Flip to
  // false to act out a deployment with no SMTP wired.
  configured = true;
  readonly messages: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    // An unconfigured mailer fails loudly in production
    // (`createUnconfiguredMailer`), so the fake must too — otherwise a
    // suite that flips `configured` off still silently "sends", and the
    // surfaces that must not promise undeliverable mail look correct
    // when they are not.
    if (!this.configured) {
      return Promise.reject(new Error("SMTP is not configured."));
    }
    this.messages.push(message);
    return Promise.resolve();
  }

  /** Captured messages addressed to one recipient, oldest first. */
  messagesTo(email: string): MailMessage[] {
    return this.messages.filter((m) => m.to === email);
  }
}

/** The org_settings audit rows, oldest first — the DD-017 assertion
 * every settings-pane suite makes. */
export function settingsAuditRows(db: Db) {
  return db
    .select()
    .from(activityLog)
    .where(eq(activityLog.action, "org_settings.updated"))
    .orderBy(asc(activityLog.createdAt));
}

/** The from-address the harness's env-pinned default reports. */
export const TEST_SMTP_ENV = {
  url: "smtp://capture.invalid:1025",
  from: "OpenLaw test <openlaw@example.com>",
} as const;

/**
 * Fixed env-pinned resolver over one mailer — the #37 test double for
 * suites that call buildApp directly instead of through startHarness.
 */
export function fixedMailerResolver(mailer: Mailer): MailerResolver {
  return () => Promise.resolve({ source: "env", from: TEST_SMTP_ENV.from, mailer });
}

export interface TestStorage {
  storage: StorageAdapter;
  /** The throwaway directory the driver writes into. Exposed so a suite
   * can ask what is on the disk — "did that refusal leave a blob
   * behind" is a question about files, not about a spy. */
  root: string;
  /** Removes the temporary root. Safe to call more than once. */
  cleanup: () => Promise<void>;
}

/**
 * The storage double is the real local filesystem driver over a
 * temporary directory (DOC-009): the TECH-014 rule that tests run
 * production code, applied to files as it is to Postgres. Nothing here
 * is a mock — only the root is throwaway.
 */
export async function createTestStorage(): Promise<TestStorage> {
  const root = await mkdtemp(join(tmpdir(), "openlaw-test-files-"));
  return {
    storage: createLocalStorage({ root }),
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

export interface TestHarness {
  app: Awaited<ReturnType<typeof buildApp>>;
  db: Db;
  mailer: CapturingMailer;
  /**
   * The env half of the injected mailer-resolver double (#37). Non-null
   * acts out an env-pinned deployment — the default, since most suites
   * just need mail to flow into the capturing mailer. Set to null to act
   * out an operator with no SMTP env: resolution then reads org_settings
   * like production, with sends still captured when configured.
   */
  smtpEnv: { url: string; from: string } | null;
  /**
   * The production mailer resolver over that capturing mailer — the same
   * value the app and the pipeline are built with (#37, TECH-011).
   *
   * A suite needs it to run the morning round (M18/6) in process, which
   * the worker starts with exactly this dependency. Handing over the
   * resolver rather than the mailer is the point: resolution is
   * env-else-database and happens per send, so a suite that clears
   * `smtpEnv` changes what the next briefing resolves.
   */
  resolveMailer: MailerResolver;
  /** The injected storage adapter — the local driver over a temporary root. */
  storage: StorageAdapter;
  /** That temporary root, so a suite can read what the driver is
   * actually holding. */
  storageRoot: string;
  /**
   * The injected doc engine (TECH-010): the deterministic fake, not the
   * sidecar. The rule that tests run production code stops at the
   * engine binaries — booting LibreOffice for every API suite would buy
   * nothing an API test can assert. The real image has its own contract
   * suite, and the fake satisfies the same shape.
   */
  docEngine: DocEngine;
  /**
   * The real background pipeline (TECH-007), running in this process
   * against this container's Postgres: the real pg-boss queue, and the
   * real handlers the worker registers.
   *
   * It is not a double. A suite uploads over HTTP and then polls the
   * same reads the panel polls until the derivation lands, which is the
   * only way to assert the pipeline at the highest seam — the M12
   * testing decision, and the reason the queue is on Postgres in the
   * first place: there is nothing extra to stand up.
   *
   * Only the doc engine is faked, and only because booting LibreOffice
   * for every API suite would buy nothing an API test can assert.
   */
  pipeline: Pipeline;
  /**
   * The real notification seam (NOT-001), over this harness's database
   * and this harness's queue — the same object the app is built with.
   *
   * It is not a double, for the pipeline's reason: everything behind it
   * is a query and a queue ask, and both of those are real here. A
   * suite asserts what a person can observe — the bell reads and the
   * captured mail — and never that this was called.
   */
  notifier: Notifier;
  /** Lines the pipeline wrote, oldest first. A failed derivation says
   * so in its own row; why it failed is here. */
  jobLog: JobLogLine[];
  /**
   * The deterministic signing provider (CTR-013) the app resolves to
   * once a connector row exists — the fake, not DocuSign, for the
   * reason the doc engine is faked: no API test can assert anything
   * about a real provider that a deterministic one does not already
   * say, and no test may call DocuSign.
   *
   * It is null until the resolver has run at least once over a stored
   * connector row. The production resolver reads that row live and
   * builds the driver only when something asks for one, so saving the
   * connector is not on its own enough: the first request that resolves
   * the provider is what fills this in. From then on it is the instance
   * every request resolves, so a suite scripts the envelopes it sent.
   */
  readonly signing: FakeSigningProvider | null;
  /**
   * The production signing resolver over that fake — the same value the
   * app and the pipeline are built with.
   *
   * A suite needs it to run the reconciliation sweep (M15/6), which the
   * worker starts with exactly this dependency. Handing over the
   * resolver rather than the provider is the point: the sweep reads the
   * stored row live, so a suite that saves or clears a connector row
   * changes what the next round resolves.
   */
  resolveSigningProvider: SigningResolver;
  /** The deterministic AI provider built from the live connector row. */
  readonly ai: FakeAiProvider | null;
  resolveAiProvider: AiResolver;
  /**
   * This container's Postgres, as a connection string.
   *
   * Exposed for the one thing a suite cannot do through `pipeline`: act
   * out a **second** process against the same database. The pipeline is
   * a seam over pg-boss and deliberately says nothing about queues or
   * schedules, so a suite asserting that two workers produce one
   * scheduled round starts a second pipeline here rather than reaching
   * inside this one.
   */
  databaseUrl: string;
  stop: () => Promise<void>;
}

/** One line the pipeline logged. */
export interface JobLogLine {
  level: "info" | "warn" | "error";
  message: string;
  fields: Readonly<Record<string, unknown>>;
}

/** Captures the pipeline's own lines, so a suite can read why a
 * derivation failed without a worker process to tail. */
function capturingLogger(lines: JobLogLine[]): PipelineLogger {
  return {
    info: (fields, message) => lines.push({ level: "info", message, fields }),
    warn: (fields, message) => lines.push({ level: "warn", message, fields }),
    error: (fields, message) => lines.push({ level: "error", message, fields }),
  };
}

/** What a suite may vary about the app the harness builds. */
export interface HarnessOptions {
  /**
   * The upload ceiling in bytes. Left unset, the production default
   * applies. A suite that has to see an oversized upload refused sets a
   * small one, so the refusal is tested with a handful of bytes rather
   * than with a hundred megabytes of them.
   */
  maxUploadBytes?: number;
  /**
   * Mounts the dev/E2E overlay's on-demand morning round (TECH-018).
   * Off by default, exactly as every deployment has it, so a suite that
   * does not ask for it sees the route the way a real install does —
   * absent.
   */
  morningRoundTrigger?: boolean;
  /** Shortened only by the SSE suite; production sends every 15 seconds. */
  eventHeartbeatMs?: number;
  /** Uses the deterministic fake unless a provider integration suite supplies a real factory. */
  aiDriverFactory?: AiDriverFactory;
}

export async function startHarness(options: HarnessOptions = {}): Promise<TestHarness> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    "postgres:16-alpine",
  ).start();
  // The container and the temporary storage root must come down on every
  // path: a leak masks the original failure in the suite output and
  // outlives the test run.
  let cleanupStorage: (() => Promise<void>) | undefined;
  let pipeline: Pipeline | undefined;
  try {
    // What the API's entry point does at boot (TECH-022), so a suite
    // exercises the sealed columns rather than a plaintext variant of
    // them. Installed before the first query for the same reason.
    useSecretKeys(readSecretKeys({ [SECRET_KEY_VARIABLE]: TEST_SECRET_KEY }));
    const db = createDb(container.getConnectionUri());
    await runMigrations(db);
    const mailer = new CapturingMailer();
    // The TECH-011 double moved up one level (#37): the same env-else-
    // database resolution production runs, with the SMTP transport
    // swapped for the capturing mailer. `smtpEnv` below is the mutable
    // stand-in for the process environment.
    let smtpEnv: TestHarness["smtpEnv"] = TEST_SMTP_ENV;
    const resolveMailer: MailerResolver = async () => {
      if (smtpEnv) return { source: "env", from: smtpEnv.from, mailer };
      const [row] = await db
        .select({ smtpUrl: orgSettings.smtpUrl, smtpFrom: orgSettings.smtpFrom })
        .from(orgSettings)
        .limit(1);
      return row?.smtpUrl && row.smtpFrom
        ? { source: "app", from: row.smtpFrom, mailer }
        : { source: "unset", from: null, mailer: createUnconfiguredMailer() };
    };
    const { storage, root: storageRoot, cleanup } = await createTestStorage();
    cleanupStorage = cleanup;
    const docEngine = createFakeDocEngine();
    const jobLog: JobLogLine[] = [];
    // The production resolver over the fake driver: the stored row and
    // the "is anything configured" decision are production code, and
    // only the driver behind them is the deterministic stand-in. One
    // instance per connector, held so a suite can script its envelopes
    // — a second resolution of the same row answers the same provider.
    let signing: FakeSigningProvider | null = null;
    // One fake per set of stored credentials. The same connector always
    // resolves the same instance, so a suite that sent an envelope can
    // still script it on the next request; a rotated credential builds
    // a new one, which is honest — a different connector is a different
    // account, and it holds none of the old one's envelopes.
    //
    // The resolver has a cache of its own now (#278) and this one stays,
    // because the two key on different things for a stated reason. The
    // resolver keys on the row's `updatedAt`, so **any** save builds a
    // new driver; this keys on the three fields the fake can observe, so
    // a rotated RSA key — which changes nothing a fake provider does —
    // keeps the envelopes a suite already sent. A suite that asserts the
    // resolver's own caching builds its own resolver rather than reading
    // this one (see `signing/resolver.test.ts`).
    let signingKey: string | null = null;
    const resolveSigningProvider = createSigningResolver(db, (config) => {
      // Only the fields the fake is built from. A rotated RSA key
      // changes nothing this provider can observe, so it must not
      // throw away the envelopes a suite already sent.
      const key = JSON.stringify([config.environment, config.integrationKey, config.webhookSecret]);
      if (!signing || signingKey !== key) {
        signing = createFakeSigningProvider({
          environment: config.environment,
          integrationKey: config.integrationKey,
          webhookSecret: config.webhookSecret,
        });
        signingKey = key;
      }
      return signing;
    });
    let ai: FakeAiProvider | null = null;
    let aiKey: string | null = null;
    const fakeAiDriver: AiDriverFactory = (config) => {
      const key = JSON.stringify([
        config.preset,
        config.protocol,
        config.baseUrl,
        config.apiKey,
        config.model,
      ]);
      if (!ai || aiKey !== key) {
        ai = createFakeAiProvider({
          preset: config.preset,
          protocol: config.protocol,
          apiKey: config.apiKey,
          model: config.model,
        });
        aiKey = key;
      }
      return ai;
    };
    const liveAiResolver = createAiResolver(db, options.aiDriverFactory ?? fakeAiDriver);
    const resolveAiProvider: AiResolver = async () => {
      const resolved = await liveAiResolver();
      if (!resolved) {
        ai = null;
        aiKey = null;
      }
      return resolved;
    };
    // The real queue and the real handlers, on this container's
    // Postgres. pg-boss installs its schema in about a tenth of a
    // second, so every suite runs the production pipeline rather than a
    // double it would have to be kept in step with.
    //
    // The resolver is built first because the worker half needs it: the
    // executed-copy job (M15/5) reaches the provider the same way every
    // request does, through the stored connector row.
    pipeline = await startPipeline({
      connectionString: container.getConnectionUri(),
      handlers: {
        db,
        storage,
        docEngine,
        resolveSigningProvider,
        resolveAiProvider,
        resolveMailer,
        baseUrl: TEST_AUTH_CONFIG.baseUrl,
        log: capturingLogger(jobLog),
      },
      log: capturingLogger(jobLog),
    });
    // The seam's own lines join the pipeline's, so a suite reads why a
    // wake-up was never sent in the same place it reads why a job
    // failed.
    const notifier = createNotifier({
      db,
      jobs: pipeline,
      log: { error: (fields, message) => jobLog.push({ level: "error", message, fields }) },
    });
    const eventHub = createPostgresEventHub({
      db,
      heartbeatMs: options.eventHeartbeatMs,
      log: { error: (fields, message) => jobLog.push({ level: "error", message, fields }) },
    });
    const app = await buildApp({
      db,
      config: TEST_AUTH_CONFIG,
      resolveMailer,
      storage,
      docEngine,
      jobs: pipeline,
      resolveSigningProvider,
      resolveAiProvider,
      notifier,
      eventHub,
      maxUploadBytes: options.maxUploadBytes,
      morningRoundTrigger: options.morningRoundTrigger,
    });
    await app.ready();
    const runningPipeline = pipeline;
    return {
      app,
      db,
      mailer,
      resolveMailer,
      storage,
      storageRoot,
      docEngine,
      pipeline: runningPipeline,
      notifier,
      jobLog,
      resolveSigningProvider,
      resolveAiProvider,
      databaseUrl: container.getConnectionUri(),
      get signing() {
        return signing;
      },
      get ai() {
        return ai;
      },
      get smtpEnv() {
        return smtpEnv;
      },
      set smtpEnv(value) {
        smtpEnv = value;
      },
      stop: async () => {
        try {
          // The pipeline first, and waiting: a handler still running
          // when the pool closes fails on a connection that has gone,
          // and that failure would be what the suite reports instead of
          // whatever really went wrong.
          await runningPipeline.stop();
          await app.close();
          await db.$client.end();
        } finally {
          try {
            await cleanup();
          } finally {
            await container.stop();
          }
        }
      },
    };
  } catch (error) {
    try {
      await pipeline?.stop();
    } finally {
      try {
        await cleanupStorage?.();
      } finally {
        await container.stop();
      }
    }
    throw error;
  }
}
