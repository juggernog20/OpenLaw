// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The on-demand morning round (#323, TECH-018): the one seam the M18
 * browser demo needed, and the three things that have to be true of it.
 *
 * **It does not exist unless the overlay says so.** A second app is
 * built over this harness's own dependencies with the flag left off —
 * which is every deployment — and the route answers the same 404 an
 * unknown path does.
 *
 * **It is Administrator-only where it does exist** (SET-002). A round
 * sends other people's briefings.
 *
 * **It runs the real round, on the real clock.** The route takes no
 * parameters at all, so the only way to make a round fire is to arrange
 * the world the round reads: a reader whose own morning has arrived, and
 * a deadline exactly one offset away. That is what this suite does, and
 * it then reads the outcome the way a person would — the bell over HTTP
 * and the briefing out of the capturing mailer.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, users } from "@openlaw/db";
import { buildApp } from "../../app.js";
import { provisionUser } from "../../auth/instance.js";
import { DIGEST_LOCAL_HOUR, localMoment } from "../../lib/notifications/local-day.js";
import { SEEDED_REMINDER_OFFSETS } from "../../lib/notifications/offsets.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  TEST_AUTH_CONFIG,
  type TestHarness,
} from "../../testing/harness.js";
import { testDeps } from "../../testing/deps.js";

const ROUND_URL = "/api/v1/notifications/morning-round";

/** The person the demo's shape is acted out with: they own the record,
 * so every date on it is about them. */
const OWNER = {
  email: "round-trigger-owner@example.com",
  displayName: "Priya Raman",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;

/**
 * Zones dense enough that one of them always reads a workable hour.
 *
 * The round serves a person once their own clock has reached 08:00
 * (NOT-003), and this suite runs at whatever time of day CI happens to
 * be. Rather than move the clock — the route deliberately has no way to
 * — the fixture is put in a zone where the morning has already arrived
 * at this very instant. The offsets below span more than a day in steps
 * of an hour or two, so some zone always lands inside the window.
 */
const CANDIDATE_ZONES = [
  "Pacific/Kiritimati",
  "Pacific/Auckland",
  "Australia/Brisbane",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Bangkok",
  "Asia/Dhaka",
  "Asia/Karachi",
  "Asia/Dubai",
  "Europe/Moscow",
  "Europe/Athens",
  "Europe/Berlin",
  "UTC",
  "Atlantic/Azores",
  "America/Sao_Paulo",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Pacific/Pago_Pago",
] as const;

/**
 * The latest local hour the fixture is allowed to sit at.
 *
 * The morning has arrived from 08:00 onward, and the ceiling keeps the
 * fixture's own civil date from rolling over while the suite runs — the
 * dates are computed against that date, so a midnight in the middle of
 * a case would be a different day's round.
 */
const LATEST_LOCAL_HOUR = 20;

/** A zone whose clock reads between the morning gate and the ceiling
 * right now, with the civil date it is on. */
function zoneInTheMorning(now: Date): { zone: string; today: string } {
  for (const zone of CANDIDATE_ZONES) {
    const moment = localMoment(now, zone);
    if (moment.hour >= DIGEST_LOCAL_HOUR && moment.hour <= LATEST_LOCAL_HOUR) {
      return { zone, today: moment.date };
    }
  }
  throw new Error("no candidate zone reads a workable hour, which the offsets make impossible");
}

/** One civil date, so many days on. Arithmetic in UTC because a civil
 * date is a day and not a moment. */
function daysOn(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

let harness: TestHarness;
const cookies = new Map<string, Record<string, string>>();

beforeAll(async () => {
  harness = await startHarness({ morningRoundTrigger: true });
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  cookies.set(ADMIN.email, await signInCookies(harness.app, ADMIN.email, ADMIN.password));

  const owner = await provisionUser(harness.app.auth, OWNER);
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, owner.id));
  cookies.set(OWNER.email, await signInCookies(harness.app, OWNER.email, OWNER.password));
});

afterAll(async () => {
  await harness.stop();
});

const as = (fixture: { email: string }): Record<string, string> => {
  const jar = cookies.get(fixture.email);
  expect(jar, fixture.email).toBeDefined();
  return jar!;
};

describe("the on-demand morning round", () => {
  it("does not exist on an app the overlay never enabled", async () => {
    // The same dependencies this harness's own app holds, with the one
    // flag left off — which is what every deployment builds.
    const plain = await buildApp(
      testDeps({
        db: harness.db,
        config: TEST_AUTH_CONFIG,
        resolveMailer: harness.resolveMailer,
        storage: harness.storage,
        docEngine: harness.docEngine,
        jobs: harness.pipeline,
        resolveSigningProvider: harness.resolveSigningProvider,
        notifier: harness.notifier,
      }),
    );
    try {
      await plain.ready();
      const res = await plain.inject({ method: "POST", url: ROUND_URL, cookies: as(ADMIN) });
      // The ordinary unknown-path 404, not a refusal — an install that
      // never set the variable must not admit there is anything here.
      expect(res.statusCode, res.body).toBe(404);
    } finally {
      await plain.close();
    }
  });

  it("refuses anybody who is not an Administrator", async () => {
    const res = await harness.app.inject({ method: "POST", url: ROUND_URL, cookies: as(OWNER) });
    expect(res.statusCode, res.body).toBe(403);
  });

  it("runs the real round, so a deadline one offset away reaches its reader", async () => {
    const now = new Date();
    const { zone, today } = zoneInTheMorning(now);
    await harness.db.update(users).set({ timezone: zone }).where(eq(users.email, OWNER.email));

    // The furthest seeded lead time, so the expiry itself — which sits a
    // notice period beyond the deadline — is nowhere near an offset and
    // fires nothing of its own.
    const offset = Math.max(...SEEDED_REMINDER_OFFSETS);
    const noticePeriodDays = 30;
    const deadline = daysOn(today, offset);

    const options = await harness.app.inject({
      method: "GET",
      url: "/api/v1/contracts/options",
      cookies: as(ADMIN),
    });
    expect(options.statusCode, options.body).toBe(200);
    const nda = (options.json().contractTypes as { id: string; slug: string }[]).find(
      (row) => row.slug === "nda",
    );
    expect(nda, "the nda seed type").toBeDefined();

    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      cookies: as(OWNER),
      payload: { title: "Brightwater services agreement", contractTypeId: nda!.id },
    });
    expect(created.statusCode, created.body).toBe(201);
    const contract = created.json().contract as { id: string; number: number; title: string };

    const termed = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${contract.number}`,
      cookies: as(OWNER),
      payload: { expiryDate: daysOn(deadline, noticePeriodDays), noticePeriodDays },
    });
    expect(termed.statusCode, termed.body).toBe(200);

    const before = harness.mailer.messagesTo(OWNER.email).length;

    const ran = await harness.app.inject({ method: "POST", url: ROUND_URL, cookies: as(ADMIN) });
    expect(ran.statusCode, ran.body).toBe(200);
    const summary = ran.json() as { served: number; reminders: number; digests: number };
    // Somebody's morning had arrived — the fixture's, by construction.
    expect(summary.served).toBeGreaterThan(0);
    expect(summary.reminders).toBeGreaterThan(0);
    expect(summary.digests).toBeGreaterThan(0);

    // What the reader can see: the deadline on their bell…
    const bell = await harness.app.inject({
      method: "GET",
      url: "/api/v1/notifications",
      cookies: as(OWNER),
    });
    expect(bell.statusCode, bell.body).toBe(200);
    const items = (
      bell.json() as { notifications: { eventType: string; entityId: string }[] }
    ).notifications.filter((row) => row.entityId === contract.id);
    expect(items.map((row) => row.eventType)).toContain("date.notice_deadline_approaching");

    // …and the briefing in their post.
    const briefings = harness.mailer.messagesTo(OWNER.email).slice(before);
    expect(briefings).toHaveLength(1);
    expect(briefings[0]!.subject).toBe("1 date on your contracts");
    expect(briefings[0]!.text).toContain(contract.title);
    expect(briefings[0]!.text).toContain("Notice deadline");

    // A second round on the same day writes nothing and sends nothing:
    // the dedup identity and the once-a-day rule are the round's, and
    // the trigger did not weaken either of them.
    const again = await harness.app.inject({ method: "POST", url: ROUND_URL, cookies: as(ADMIN) });
    expect(again.statusCode, again.body).toBe(200);
    const second = again.json() as { reminders: number; digests: number };
    expect(second.reminders).toBe(0);
    expect(second.digests).toBe(0);
    expect(harness.mailer.messagesTo(OWNER.email).slice(before)).toHaveLength(1);
  });
});
