// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The default test double for every {@link AppDeps} member (#255).
 *
 * Most suites go through `startHarness`, which builds the app for them.
 * A handful build it themselves — because they need a second app beside
 * the harness's (a smaller upload ceiling, no queue behind it), or
 * because they assert wiring and want no container at all. Those suites
 * had to name all nine dependencies, so every dependency the app grew
 * was edited into all of them, in eight files that were about something
 * else entirely.
 *
 * This is the one place that answers "what does a suite that does not
 * care get?". A suite spreads it and names only what it does care
 * about:
 *
 * ```ts
 * const app = await buildApp(testDeps({ db: harness.db, jobs: harness.pipeline }));
 * ```
 *
 * **`db` and `jobs` go in the argument, never in a spread over the
 * result.** Two members are built from them — the notifier is one — so a
 * spread that replaced the database left a notifier still pointed at the
 * one nobody listens on. Everything else spreads freely.
 *
 * **A new dependency is one edit here.** The return type is `AppDeps`,
 * so a member added to the app factory stops compiling in this file and
 * nowhere else.
 *
 * **The defaults are inert, and loudly so.** Nothing here reaches a
 * network, a container, or a disk, and the stand-ins that cannot do
 * their work refuse rather than succeed quietly — the
 * `createUnconfiguredMailer` pattern. A suite that starts asking for a
 * derivation, or for a signature, gets a failure that names the missing
 * wiring instead of a green run over work that never happened.
 *
 * `startHarness` does not use any of this: it wires real Postgres, real
 * migrations, real pg-boss, and the real local storage driver
 * (TECH-014), and this module must never become the shortcut that
 * waters that down.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "@openlaw/db";
import type { AppDeps } from "../app.js";
import { createFakeDocEngine } from "../lib/doc-engine/fake.js";
import { createLocalStorage } from "../lib/storage/local.js";
import { createUnconfiguredSigningResolver } from "../lib/signing/resolver.js";
import { createNotifier } from "../lib/notifications/notifier.js";
import { createUnconfiguredJobQueue } from "../pipeline/jobs.js";
import { CapturingMailer, fixedMailerResolver, TEST_AUTH_CONFIG } from "./harness.js";

/**
 * A database nobody listens on.
 *
 * `db` is defaulted rather than demanded as an argument so that the one
 * rule here holds for every member without an exception: a dependency
 * added to the app is one edit in this file. A suite that reads or
 * writes anything passes its own — the harness's, or a pool it opened
 * itself — and a suite that forgets says so in its first query, because
 * a connection to a port nothing answers on fails rather than reads
 * empty.
 *
 * pg connects lazily, so the default opens no socket and holds nothing
 * open. A suite that never touches it never has to close it.
 */
export const UNUSED_DATABASE_URL = "postgresql://unused:unused@localhost:5432/unused";

/**
 * A storage root that is never written. The local driver creates its
 * root on the first write and not before (see `createLocalStorage`), so
 * a suite that stores nothing leaves nothing to clean up — and a suite
 * that does store something wants the harness's storage anyway, which is
 * the real driver over a temporary root it can read back.
 */
const UNWRITTEN_STORAGE_ROOT = join(tmpdir(), "openlaw-test-deps-never-written");

/**
 * Every {@link AppDeps} member, defaulted. Call it once per app; each
 * call builds its own doubles, so two apps never share a mailer.
 *
 * The two optional members — `maxUploadBytes` and `webDist` — are left
 * unset on purpose. Unset is what the app factory itself defaults, and
 * restating either here would be a second place to keep in step with it.
 *
 * **Pass what you care about as `overrides` rather than spreading over
 * the result**, where the thing you are overriding is `db` or `jobs`.
 * Two members are *built from* those two — the notifier is one of them
 * — so a spread that replaced the database left a notifier still
 * pointed at the one nobody listens on. Handing them in here is what
 * keeps the assembled app internally consistent; a spread is still
 * fine for everything else.
 */
export function testDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  const db = overrides.db ?? createDb(UNUSED_DATABASE_URL);
  const jobs = overrides.jobs ?? createUnconfiguredJobQueue();
  return {
    db,
    config: TEST_AUTH_CONFIG,
    resolveMailer: fixedMailerResolver(new CapturingMailer()),
    storage: createLocalStorage({ root: UNWRITTEN_STORAGE_ROOT }),
    docEngine: createFakeDocEngine(),
    jobs,
    resolveSigningProvider: createUnconfiguredSigningResolver(),
    // The real seam over whatever database and queue this app ended up
    // with, rather than a fake of its own: everything it does is a
    // query and a queue ask. On the defaults both refuse loudly, so a
    // suite that starts notifying fails on the wiring it forgot rather
    // than passing over a fan-out that never happened.
    notifier: createNotifier({
      db,
      jobs,
      log: {
        error: (fields, message) => console.error(message, fields),
      },
    }),
    ...overrides,
  };
}
