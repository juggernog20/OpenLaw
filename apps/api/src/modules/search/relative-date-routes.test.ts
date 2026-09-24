// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  contracts,
  contractTypes,
  contractStatuses,
  matters,
  matterTypes,
  matterStatuses,
  users,
  eq,
} from "@openlaw/db";
import { simpleSearchQuestion } from "@openlaw/shared";
import {
  startHarness,
  signInCookies,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

let h: TestHarness;
let cookies: Record<string, string>;
let viewer: string;
const ids = new Map<string, string>();
beforeAll(async () => {
  h = await startHarness();
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  cookies = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  viewer = (await h.db.select().from(users).where(eq(users.email, TEST_ADMIN.email)))[0]!.id;
  const type = (await h.db.select().from(contractTypes).limit(1))[0]!;
  const status = (
    await h.db.select().from(contractStatuses).where(eq(contractStatuses.stage, "active")).limit(1)
  )[0]!;
  for (const date of [
    "2025-10-02",
    "2025-10-03",
    "2025-12-28",
    "2025-12-29",
    "2025-12-31",
    "2026-01-01",
    "2026-01-04",
    "2026-01-05",
    "2026-01-31",
    "2026-02-01",
    "2026-03-31",
    "2026-04-01",
    "2026-04-02",
    "2026-12-31",
    "2027-01-01",
  ]) {
    const [row] = await h.db
      .insert(contracts)
      .values({ title: date, contractTypeId: type.id, statusId: status.id, expiryDate: date })
      .returning();
    ids.set(date, row!.id);
  }
  await h.db
    .insert(contracts)
    .values({ title: "No expiry", contractTypeId: type.id, statusId: status.id });
  const matterType = (await h.db.select().from(matterTypes).limit(1))[0]!;
  const matterStatus = (
    await h.db.select().from(matterStatuses).where(eq(matterStatuses.category, "open")).limit(1)
  )[0]!;
  for (const instant of ["2025-12-31T10:00:00Z", "2025-12-31T22:00:00Z", "2026-01-01T10:00:00Z"]) {
    const [row] = await h.db
      .insert(matters)
      .values({
        title: instant,
        matterTypeId: matterType.id,
        statusId: matterStatus.id,
        createdBy: viewer,
        openedAt: new Date(instant),
      })
      .returning();
    ids.set(instant, row!.id);
  }
});
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  await h?.stop();
});

function read(
  operator: string,
  value: unknown,
  timeZone?: string,
  kind: "contract" | "matter" = "contract",
) {
  return h.app.inject({
    method: "POST",
    url: "/api/v1/search/query",
    cookies,
    payload: {
      ...simpleSearchQuestion("", [kind]),
      conditions: [{ kind, property: kind === "contract" ? "expiry" : "opened", operator, value }],
      timeZone,
    },
  });
}
function fixedClock() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2025-12-31T23:30:00Z"));
}
async function rows(
  operator: string,
  value: unknown,
  timeZone?: string,
  kind: "contract" | "matter" = "contract",
) {
  const response = await read(operator, value, timeZone, kind);
  expect(response.statusCode, response.body).toBe(200);
  return response
    .json<{ results: { id: string }[] }>()
    .results.map((row) => row.id)
    .sort();
}
const expected = (...dates: string[]) => dates.map((date) => ids.get(date)).sort();

describe("relative date query route", () => {
  it.each([
    ["in_last_days", 90, ["2025-10-03", "2025-12-28", "2025-12-29", "2025-12-31", "2026-01-01"]],
    [
      "in_next_days",
      90,
      [
        "2026-01-01",
        "2026-01-04",
        "2026-01-05",
        "2026-01-31",
        "2026-02-01",
        "2026-03-31",
        "2026-04-01",
      ],
    ],
    ["today", null, ["2026-01-01"]],
    ["this_week", null, ["2025-12-29", "2025-12-31", "2026-01-01", "2026-01-04"]],
    ["this_month", null, ["2026-01-01", "2026-01-04", "2026-01-05", "2026-01-31"]],
    [
      "this_quarter",
      null,
      ["2026-01-01", "2026-01-04", "2026-01-05", "2026-01-31", "2026-02-01", "2026-03-31"],
    ],
    [
      "this_year",
      null,
      [
        "2026-01-01",
        "2026-01-04",
        "2026-01-05",
        "2026-01-31",
        "2026-02-01",
        "2026-03-31",
        "2026-04-01",
        "2026-04-02",
        "2026-12-31",
      ],
    ],
  ] as const)(
    "%s includes both endpoints and excludes absent dates",
    async (operator, value, dates) => {
      fixedClock();
      expect(await rows(operator, value, "Asia/Dubai")).toEqual(expected(...dates));
    },
  );

  it("uses request timezone, then profile timezone, then UTC for today's civil dates and timestamps", async () => {
    await h.db.update(users).set({ timezone: "Asia/Dubai" }).where(eq(users.id, viewer));
    fixedClock();
    try {
      expect(await rows("today", null, "America/Los_Angeles")).toEqual(expected("2025-12-31"));
      expect(await rows("today", null, "Asia/Dubai")).toEqual(expected("2026-01-01"));
      expect(await rows("today", null)).toEqual(expected("2026-01-01"));
      expect(await rows("today", null, "America/Los_Angeles", "matter")).toEqual(
        expected("2025-12-31T10:00:00Z", "2025-12-31T22:00:00Z"),
      );
      expect(await rows("today", null, undefined, "matter")).toEqual(
        expected("2025-12-31T22:00:00Z", "2026-01-01T10:00:00Z"),
      );
    } finally {
      await h.db.update(users).set({ timezone: null }).where(eq(users.id, viewer));
    }
    expect(await rows("today", null)).toEqual(expected("2025-12-31"));
    expect(await rows("today", null, undefined, "matter")).toEqual(
      expected("2025-12-31T10:00:00Z", "2025-12-31T22:00:00Z"),
    );
    vi.setSystemTime(new Date("2026-01-01T23:30:00Z"));
    expect(await rows("today", null)).toEqual(expected("2026-01-01"));
  });

  for (const operator of ["in_last_days", "in_next_days"]) {
    it.each([undefined, null, 0, -1, 3651, 1.5, "90"])(
      `${operator} refuses N=%s by name`,
      async (value) => {
        const response = await read(operator, value);
        expect(response.statusCode).toBe(400);
        expect(response.headers["content-type"]).toContain("application/problem+json");
        expect(response.json().errors).toContainEqual(
          expect.objectContaining({ message: expect.stringMatching(/N.*1.*3650/) }),
        );
      },
    );
    it.each([1, 3650])(`${operator} accepts N=%s`, async (value) => {
      fixedClock();
      expect((await read(operator, value)).statusCode).toBe(200);
    });
  }
});
