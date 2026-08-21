// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Organization · Notifications — the reminder-offset list (#322,
 * NOT-004), at the HTTP seam.
 *
 * The pane behind these routes edits one global list of lead times,
 * applied to every tracked date. Adding, removing, and rearranging are
 * all the same write — the whole list, sent at the moment the change is
 * made (SET-003) — so this suite asserts the list the routes keep, the
 * role gate in front of them, and the audit entry each write leaves.
 *
 * **The last block is the one that matters.** A settings pane that
 * changed a stored number and nothing else would be a pane nobody could
 * trust, so the change is followed all the way to its effect: an
 * Administrator saves a new list over HTTP, the morning round is
 * invoked in process at a controlled instant, and the reminder that
 * arrives is the one the new list names. The round is the real handler
 * over the real queue and the real notification seam — the arrangement
 * `date-reminders.test.ts` established (#321).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, asc, eq, orgSettings, users, type ActivityLogEntry } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import { runMorningRound } from "../../pipeline/morning-round.js";
import type { PipelineLogger } from "../../pipeline/logger.js";
import {
  signInCookies as harnessSignInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type JobLogLine,
  type TestHarness,
} from "../../testing/harness.js";

/** A Legal Team Member: reads every open record, administers nothing. */
const MEMBER = {
  email: "offsets-member@example.com",
  displayName: "Casey Counsel",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);

  const member = await provisionUser(harness.app.auth, MEMBER);
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, member.id));

  adminCookies = await harnessSignInCookies(harness.app, ADMIN.email, ADMIN.password);
  memberCookies = await harnessSignInCookies(harness.app, MEMBER.email, MEMBER.password);
});

afterAll(async () => {
  await harness.stop();
});

const OFFSETS_URL = "/api/v1/org/reminder-offsets";

const getOffsets = (cookies: Record<string, string>) =>
  harness.app.inject({ method: "GET", url: OFFSETS_URL, cookies });

const putOffsets = (offsets: unknown, cookies = adminCookies) =>
  harness.app.inject({ method: "PUT", url: OFFSETS_URL, cookies, payload: { offsets } });

/** Saves a list and requires it to have been accepted. */
async function setOffsets(offsets: number[]): Promise<number[]> {
  const res = await putOffsets(offsets);
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { offsets: number[] }).offsets;
}

/** The settings entries this pane writes, oldest first. */
const settingsRows = (): Promise<ActivityLogEntry[]> =>
  harness.db
    .select()
    .from(activityLog)
    .where(eq(activityLog.action, "org_settings.updated"))
    .orderBy(asc(activityLog.createdAt), asc(activityLog.id));

// -------------------------------------------------------------------

describe("the SET-002 role gate", () => {
  it("refuses an unauthenticated request as 401, on read and write", async () => {
    const read = await harness.app.inject({ method: "GET", url: OFFSETS_URL });
    const write = await harness.app.inject({
      method: "PUT",
      url: OFFSETS_URL,
      payload: { offsets: [30] },
    });
    expect(read.statusCode).toBe(401);
    expect(write.statusCode).toBe(401);
  });

  it("refuses a Legal Team Member as 403 problem+json, on read and write", async () => {
    await setOffsets([7, 1, 0]);
    const read = await getOffsets(memberCookies);
    const write = await putOffsets([90], memberCookies);

    expect(read.statusCode).toBe(403);
    expect(write.statusCode).toBe(403);
    expect(write.headers["content-type"]).toContain("application/problem+json");
    expect(write.json()).toMatchObject({ status: 403 });

    // The refused write must not have landed. Read as the Administrator,
    // because the Member cannot read it either.
    expect((await getOffsets(adminCookies)).json()).toEqual({ offsets: [7, 1, 0] });
  });
});

describe("GET /org/reminder-offsets", () => {
  it("answers NOT-004's seeded list on a fresh install", async () => {
    // The column's own default, untouched by any of this suite's writes
    // until the block below moves it.
    await harness.db.update(orgSettings).set({ reminderOffsetDays: [7, 1, 0] });
    expect((await getOffsets(adminCookies)).json()).toEqual({ offsets: [7, 1, 0] });
  });

  it("answers the saved order, not a sorted one", async () => {
    await setOffsets([0, 1, 30]);
    expect((await getOffsets(adminCookies)).json()).toEqual({ offsets: [0, 1, 30] });
  });

  it("drops a stored value no round could fire on", async () => {
    // A hand-edited row or a restored backup. The pane must never draw a
    // lead time that will not arrive.
    // Cast because the column's declared type is the shape the
    // application keeps; the point of this case is a row that escaped it.
    await harness.db
      .update(orgSettings)
      .set({ reminderOffsetDays: [14, -3, 1.5, "soon", null, 5] as unknown as number[] });
    expect((await getOffsets(adminCookies)).json()).toEqual({ offsets: [14, 5] });
  });

  it("falls back to the seeded list when nothing stored can be read", async () => {
    await harness.db
      .update(orgSettings)
      .set({ reminderOffsetDays: { seven: 7 } as unknown as number[] });
    expect((await getOffsets(adminCookies)).json()).toEqual({ offsets: [7, 1, 0] });
  });
});

describe("PUT /org/reminder-offsets", () => {
  it("adds a lead time and answers the list back", async () => {
    await setOffsets([7, 1, 0]);
    expect(await setOffsets([30, 7, 1, 0])).toEqual([30, 7, 1, 0]);
    expect((await getOffsets(adminCookies)).json()).toEqual({ offsets: [30, 7, 1, 0] });
  });

  it("removes a lead time", async () => {
    await setOffsets([30, 7, 1, 0]);
    expect(await setOffsets([30, 7, 0])).toEqual([30, 7, 0]);
  });

  it("keeps a rearranged list in the order it was sent", async () => {
    await setOffsets([30, 7, 0]);
    expect(await setOffsets([0, 30, 7])).toEqual([0, 30, 7]);
    expect((await getOffsets(adminCookies)).json()).toEqual({ offsets: [0, 30, 7] });
  });

  it("collapses a duplicate to its first position", async () => {
    expect(await setOffsets([7, 1, 7, 0])).toEqual([7, 1, 0]);
  });

  it("refuses an empty list and leaves the stored one standing", async () => {
    await setOffsets([7, 1, 0]);
    const res = await putOffsets([]);
    expect(res.statusCode, res.body).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect((await getOffsets(adminCookies)).json()).toEqual({ offsets: [7, 1, 0] });
  });

  it.each([
    ["a lead time counting backwards", [-1]],
    ["part of a day", [1.5]],
    ["further ahead than two years", [731]],
    ["something that is not a number", ["7"]],
    ["more lead times than a schedule", Array.from({ length: 21 }, (_, index) => index)],
  ])("refuses %s and leaves the stored list standing", async (_shape, invalid) => {
    await setOffsets([7, 1, 0]);
    const res = await putOffsets(invalid);
    expect(res.statusCode, res.body).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect((await getOffsets(adminCookies)).json()).toEqual({ offsets: [7, 1, 0] });
  });

  it("refuses a body that is not a list", async () => {
    const res = await putOffsets(7);
    expect(res.statusCode, res.body).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
  });
});

describe("the DD-017 audit trail", () => {
  it("narrates a save with the old and the new list", async () => {
    await setOffsets([7, 1, 0]);
    const before = (await settingsRows()).length;
    await setOffsets([60, 14, 1]);

    const rows = (await settingsRows()).slice(before);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entityType: "system",
      entityId: null,
      visibility: "admin_only",
      payload: { field: "reminderOffsetDays", old: [7, 1, 0], new: [60, 14, 1] },
    });
    expect(rows[0]!.actorId).not.toBeNull();
  });

  it("narrates a rearrangement, because the stored order is the saved one", async () => {
    await setOffsets([60, 14, 1]);
    const before = (await settingsRows()).length;
    await setOffsets([1, 14, 60]);

    const rows = (await settingsRows()).slice(before);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({ old: [60, 14, 1], new: [1, 14, 60] });
  });

  it("does not narrate a save that changes nothing", async () => {
    await setOffsets([7, 1, 0]);
    const before = (await settingsRows()).length;
    await setOffsets([7, 1, 0]);
    expect(await settingsRows()).toHaveLength(before);
  });
});

// -------------------------------------------------------------------

/** Somewhere for one round's own lines to go. */
function recordingLog(): { lines: JobLogLine[]; log: PipelineLogger } {
  const lines: JobLogLine[] = [];
  return {
    lines,
    log: {
      info: (fields, message) => lines.push({ level: "info", message, fields }),
      warn: (fields, message) => lines.push({ level: "warn", message, fields }),
      error: (fields, message) => lines.push({ level: "error", message, fields }),
    },
  };
}

/** One round of the morning job, at a controlled instant — the handler
 * itself, with the dependencies the worker registers it with. */
async function round(now: Date) {
  const { log } = recordingLog();
  return await runMorningRound(
    {
      db: harness.db,
      log,
      notifier: harness.notifier,
      resolveMailer: harness.resolveMailer,
      baseUrl: "http://localhost",
    },
    harness.pipeline,
    { now },
  );
}

/** A civil date shifted by whole days. */
const plusDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The instant one civil date reaches a given UTC hour. */
const at = (date: string, hour: number): Date =>
  new Date(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);

describe("a saved list is the list the next round fires on", () => {
  // A day no other block in this file touches, so the offsets below land
  // on this block's records alone.
  const TODAY = "2026-09-16";
  let near: { id: string; number: number };
  let far: { id: string; number: number };

  /** The lead times one person's bell items about a record were fired
   * at, as they would read the bell. */
  async function firedFor(contract: { id: string }): Promise<unknown[]> {
    const res = await harness.app.inject({
      method: "GET",
      url: "/api/v1/notifications",
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    const items = (
      res.json() as { notifications: { entityId: string; payload: { offsetDays?: number } }[] }
    ).notifications.filter((row) => row.entityId === contract.id);
    return items.map((row) => row.payload.offsetDays).reverse();
  }

  /** A contract the Administrator made, expiring a given number of days
   * from this block's today. Its creator holds the team row that makes
   * every date on it about them. */
  async function newContract(title: string, expiresInDays: number) {
    const options = await harness.app.inject({
      method: "GET",
      url: "/api/v1/contracts/options",
      cookies: adminCookies,
    });
    expect(options.statusCode, options.body).toBe(200);
    const nda = (options.json().contractTypes as { id: string; slug: string }[]).find(
      (row) => row.slug === "nda",
    );
    expect(nda, "the nda seed type").toBeDefined();

    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      cookies: adminCookies,
      payload: { title, contractTypeId: nda!.id },
    });
    expect(created.statusCode, created.body).toBe(201);
    const contract = created.json().contract as { id: string; number: number };

    const dated = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${contract.number}`,
      cookies: adminCookies,
      payload: { expiryDate: plusDays(TODAY, expiresInDays) },
    });
    expect(dated.statusCode, dated.body).toBe(200);
    return contract;
  }

  beforeAll(async () => {
    near = await newContract("Kestrel supply agreement", 45);
    far = await newContract("Halden distribution agreement", 90);
  });

  afterAll(async () => {
    // Every later run of this file starts from the seed.
    await setOffsets([7, 1, 0]);
  });

  it("fires on the lead time an Administrator just saved, and on no other", async () => {
    // A long notice window is tuned here rather than in code (NOT-004):
    // this install works ninety days ahead.
    await setOffsets([90]);

    const first = await round(at(TODAY, 8));
    expect(first.reminders).toBe(1);
    // Ninety days out is the record the saved list names. Forty-five is
    // not on the list, so its expiry says nothing today.
    expect(await firedFor(far)).toEqual([90]);
    expect(await firedFor(near)).toEqual([]);

    // The Administrator changes their mind mid-morning. Nothing is
    // restarted and no cache is cleared — the next round reads the
    // column the save wrote.
    await setOffsets([45]);

    const second = await round(at(TODAY, 10));
    expect(second.reminders).toBe(1);
    expect(await firedFor(near)).toEqual([45]);
    // And nothing further about the far record: ninety is no longer a
    // lead time, and the row it already has stands as history.
    expect(await firedFor(far)).toEqual([90]);
  });

  it("stops reminding once the lead time is removed", async () => {
    // Back to a list that names neither record's expiry.
    await setOffsets([7, 1, 0]);
    const nearBefore = (await firedFor(near)).length;
    const farBefore = (await firedFor(far)).length;

    const summary = await round(at(plusDays(TODAY, 1), 8));

    expect(summary.reminders).toBe(0);
    expect(await firedFor(near)).toHaveLength(nearBefore);
    expect(await firedFor(far)).toHaveLength(farBefore);
  });
});
