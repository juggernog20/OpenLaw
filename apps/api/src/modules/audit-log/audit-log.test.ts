// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Administrator's audit log at the HTTP seam (M9/7, DD-017).
 *
 * Five things carry this suite, and each is a promise no other surface
 * in the system keeps.
 *
 * **It is the single answer to "who did that."** One Administrator's
 * afternoon writes entries of four entity types at four tiers, and the
 * log carries all of them — including the `admin_only` user
 * administration and settings entries that no record feed can reach.
 *
 * **The filters compose.** Actor, action, entity type, and date range
 * each narrow the set on their own, and every pair of them narrows it
 * further. Search finds the entry a reader cannot name a filter for.
 *
 * **The export streams the filtered set, and nothing else.** That is
 * asserted against the whole table rather than against a number: an
 * unfiltered export carries an entry that a filtered one must not.
 *
 * **The export is itself a security event.** Taking one appends
 * `export.performed` at `admin_only`, read straight back out of the
 * table, and the export never contains the record of itself.
 *
 * **A failure to emit does not fail the mutation.** Structured emission
 * is a copy for somebody else's system (DD-017's SIEM clause). The
 * mutation, its in-app entry, and the request all stand when the sink
 * throws.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { activityLog, asc, eq, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  clearActivityEmitter,
  setActivityEmitter,
  type ActivityEvent,
} from "../../lib/activity-emitter.js";
import { recordActivity } from "../../lib/activity.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "audit-member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;
const CONTRIBUTOR = {
  email: "audit-contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery",
} as const;
const BUSINESS = {
  email: "audit-business@example.com",
  displayName: "Bao Business",
  password: "correct-horse-battery",
} as const;
/** Somebody to administer, so the `user.*` entries have a subject that
 * is not one of the readers. */
const SUBJECT = {
  email: "audit-subject@example.com",
  displayName: "Sam Subject",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let businessCookies: Record<string, string>;
const userIds = new Map<string, string>();

interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  visibility: string;
  actor: { id: string; displayName: string; image: string | null; archived: boolean } | null;
  createdAt: string;
  payload: Record<string, unknown>;
}

interface AuditPage {
  entries: AuditEntry[];
  nextCursor: string | null;
}

type Query = Record<string, string>;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  const [admin] = await harness.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, ADMIN.email));
  userIds.set(ADMIN.email, admin!.id);

  for (const [fixture, role] of [
    [MEMBER, "legal_team_member"],
    [CONTRIBUTOR, "contributor"],
    [BUSINESS, "business_user"],
    [SUBJECT, "contributor"],
  ] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, user.id));
    userIds.set(fixture.email, user.id);
  }
  adminCookies = await signInCookies(harness.app, ADMIN.email, ADMIN.password);
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
  contributorCookies = await signInCookies(harness.app, CONTRIBUTOR.email, CONTRIBUTOR.password);
  businessCookies = await signInCookies(harness.app, BUSINESS.email, BUSINESS.password);

  await anAfternoonOfWork();
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

const read = (cookies: Record<string, string>, query: Query = {}) =>
  harness.app.inject({ method: "GET", url: "/api/v1/audit-log", cookies, query });

/** One page, requiring success. */
async function page(query: Query = {}, cookies = adminCookies): Promise<AuditPage> {
  const res = await read(cookies, query);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as AuditPage;
}

/** Every page under one filter, followed to the end — what a reader who
 * keeps pressing "show older" ends up holding. */
async function everyPage(query: Query = {}): Promise<{ entries: AuditEntry[]; pages: number }> {
  const entries: AuditEntry[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const answered = await page({ ...query, ...(cursor ? { cursor } : {}) });
    entries.push(...answered.entries);
    cursor = answered.nextCursor ?? undefined;
    pages += 1;
    // A log that never ends is a bug this loop must not hang on.
    expect(pages).toBeLessThan(60);
  } while (cursor);
  return { entries, pages };
}

async function exportCsv(query: Query = {}, cookies = adminCookies) {
  return harness.app.inject({ method: "GET", url: "/api/v1/audit-log/export", cookies, query });
}

/**
 * The CSV's data rows, split on the record separator. Fields are quoted
 * and can carry a newline (a payload can), so this splits on the CRLF
 * that ends a record rather than on every line break.
 */
function csvRows(body: string): string[] {
  return body
    .split("\r\n")
    .slice(1)
    .filter((row) => row.length > 0);
}

/** What one afternoon in this instance leaves behind: entries of four
 * entity types at three tiers, from two different actors. */
async function anAfternoonOfWork(): Promise<void> {
  const options = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: adminCookies,
  });
  expect(options.statusCode, options.body).toBe(200);
  const nda = (options.json().contractTypes as { id: string; slug: string }[]).find(
    (row) => row.slug === "nda",
  );

  // A contract, edited, with somebody put on its team — `contract`
  // entries at working_team.
  const created = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: adminCookies,
    payload: { title: "The Ashford supply agreement", contractTypeId: nda!.id },
  });
  expect(created.statusCode, created.body).toBe(201);
  const contract = created.json().contract as { id: string; number: number };

  const edited = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/contracts/${contract.number}`,
    cookies: memberCookies,
    payload: { title: "The Ashford supply agreement, restated" },
  });
  expect(edited.statusCode, edited.body).toBe(200);

  const teamed = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${contract.number}/team`,
    cookies: adminCookies,
    payload: { userId: userIds.get(CONTRIBUTOR.email), role: "contributor" },
  });
  expect(teamed.statusCode, teamed.body).toBe(201);

  // A Legal Only comment — an entry no Contributor's feed carries, and
  // one this surface must still show.
  const commented = await harness.app.inject({
    method: "POST",
    url: "/api/v1/comments",
    cookies: memberCookies,
    payload: {
      entityType: "contract",
      entityId: contract.id,
      body: "Ashford's indemnity cap is the thing to watch.",
      visibility: "legal_only",
    },
  });
  expect(commented.statusCode, commented.body).toBe(201);

  // User administration — `user` entries at admin_only.
  const roleChanged = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/users/${userIds.get(SUBJECT.email)}/role`,
    cookies: adminCookies,
    payload: { role: "legal_team_member" },
  });
  expect(roleChanged.statusCode, roleChanged.body).toBe(200);

  const archived = await harness.app.inject({
    method: "POST",
    url: `/api/v1/users/${userIds.get(SUBJECT.email)}/archive`,
    cookies: adminCookies,
  });
  expect(archived.statusCode, archived.body).toBe(200);

  // Settings — a `system` entry at admin_only.
  const renamed = await harness.app.inject({
    method: "PATCH",
    url: "/api/v1/org/general",
    cookies: adminCookies,
    payload: { name: "Ashford Legal" },
  });
  expect(renamed.statusCode, renamed.body).toBe(200);

  // The registry record — an `entity` entry at legal_only.
  const types = await harness.app.inject({
    method: "GET",
    url: "/api/v1/entity-types",
    cookies: adminCookies,
  });
  expect(types.statusCode, types.body).toBe(200);
  const entityType = (types.json().entityTypes as { id: string }[])[0];
  const registered = await harness.app.inject({
    method: "POST",
    url: "/api/v1/entities",
    cookies: memberCookies,
    payload: { legalName: "Ashford Holdings Ltd", entityTypeId: entityType!.id },
  });
  expect(registered.statusCode, registered.body).toBe(201);
}

describe("who may open the audit log", () => {
  it("answers an Administrator", async () => {
    const res = await read(adminCookies);
    expect(res.statusCode, res.body).toBe(200);
  });

  it("refuses every other role, on the log, its vocabulary, and its export", async () => {
    for (const cookies of [memberCookies, contributorCookies, businessCookies]) {
      expect((await read(cookies)).statusCode).toBe(403);
      expect(
        (
          await harness.app.inject({
            method: "GET",
            url: "/api/v1/audit-log/actions",
            cookies,
          })
        ).statusCode,
      ).toBe(403);
      expect((await exportCsv({}, cookies)).statusCode).toBe(403);
    }
  });

  it("refuses a request with no session at all", async () => {
    const res = await harness.app.inject({ method: "GET", url: "/api/v1/audit-log" });
    expect(res.statusCode).toBe(401);
  });
});

describe("what the audit log carries", () => {
  it("shows every entity type and every tier, admin_only included", async () => {
    const { entries } = await everyPage();

    expect(new Set(entries.map((entry) => entry.entityType))).toEqual(
      new Set(["contract", "user", "system", "entity"]),
    );
    expect(new Set(entries.map((entry) => entry.visibility))).toEqual(
      new Set(["admin_only", "working_team", "legal_only"]),
    );
    // The three settings and user-administration entries no record feed
    // can reach are the point of this surface.
    const adminOnly = entries.filter((entry) => entry.visibility === "admin_only");
    expect(adminOnly.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(["user.role_changed", "user.archived", "org_settings.updated"]),
    );
  });

  it("names the actor on each entry, and reads newest first", async () => {
    const { entries } = await everyPage();

    const roleChange = entries.find((entry) => entry.action === "user.role_changed");
    expect(roleChange?.actor?.displayName).toBe(ADMIN.displayName);
    expect(roleChange?.entityId).toBe(userIds.get(SUBJECT.email));
    expect(roleChange?.payload).toMatchObject({ from: "contributor", to: "legal_team_member" });

    const stamps = entries.map((entry) => Date.parse(entry.createdAt));
    expect(stamps).toEqual([...stamps].sort((a, b) => b - a));
  });

  it("offers the action vocabulary the table actually holds", async () => {
    const res = await harness.app.inject({
      method: "GET",
      url: "/api/v1/audit-log/actions",
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    const { actions } = res.json() as { actions: string[] };

    expect(actions).toEqual(expect.arrayContaining(["user.role_changed", "org_settings.updated"]));
    expect(actions).toEqual([...actions].sort());
    expect(new Set(actions).size).toBe(actions.length);
  });
});

describe("the filters", () => {
  it("refuses a filter it cannot parse, rather than ignoring it", async () => {
    // A dropped filter would answer a wider set than the reader asked
    // for, which on this surface is the wrong way to fail.
    const rejected: Query[] = [{ from: "last Tuesday" }, { entityType: "invoice" }, { q: "" }];
    for (const query of rejected) {
      const res = await read(adminCookies, query);
      expect(res.statusCode, res.body).toBe(400);
      expect(res.headers["content-type"]).toContain("application/problem+json");
      expect(res.json().title).toBe("Request validation failed");
    }
  });

  it("narrows by actor", async () => {
    const { entries } = await everyPage({ actorId: userIds.get(MEMBER.email)! });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.actor?.id === userIds.get(MEMBER.email))).toBe(true);
    expect(entries.some((entry) => entry.action === "entity.created")).toBe(true);
  });

  it("narrows by action", async () => {
    const { entries } = await everyPage({ action: "user.role_changed" });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.action === "user.role_changed")).toBe(true);
  });

  it("narrows by entity type", async () => {
    const { entries } = await everyPage({ entityType: "entity" });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.entityType === "entity")).toBe(true);
  });

  it("narrows by date range", async () => {
    const { entries: all } = await everyPage();
    const oldest = all.at(-1)!;

    // A window that ends before the oldest entry was written holds
    // nothing; one that starts at it holds everything.
    const before = new Date(Date.parse(oldest.createdAt) - 1000).toISOString();
    expect((await everyPage({ to: before })).entries).toEqual([]);
    expect((await everyPage({ from: oldest.createdAt })).entries.length).toBe(all.length);

    // And a window strictly after the oldest entry excludes it.
    const after = new Date(Date.parse(oldest.createdAt) + 1).toISOString();
    const later = await everyPage({ from: after });
    expect(later.entries.length).toBeLessThan(all.length);
    expect(later.entries.some((entry) => entry.id === oldest.id)).toBe(false);
  });

  it("composes: each filter narrows what the ones before it left", async () => {
    const admin = userIds.get(ADMIN.email)!;
    const byActor = await everyPage({ actorId: admin });
    const byActorAndType = await everyPage({ actorId: admin, entityType: "user" });
    const byActorTypeAndAction = await everyPage({
      actorId: admin,
      entityType: "user",
      action: "user.archived",
    });

    expect(byActor.entries.length).toBeGreaterThan(byActorAndType.entries.length);
    expect(byActorAndType.entries.length).toBeGreaterThan(byActorTypeAndAction.entries.length);
    expect(byActorTypeAndAction.entries).toHaveLength(1);
    expect(byActorTypeAndAction.entries[0]).toMatchObject({
      action: "user.archived",
      entityType: "user",
    });

    // A pair that cannot both hold answers nothing rather than either
    // half — proof the terms are an AND and not an OR.
    const impossible = await everyPage({
      actorId: userIds.get(MEMBER.email)!,
      action: "user.archived",
    });
    expect(impossible.entries).toEqual([]);

    // The date range composes with the rest, and does not widen it.
    const windowed = await everyPage({
      actorId: admin,
      entityType: "user",
      from: byActorAndType.entries.at(-1)!.createdAt,
    });
    expect(windowed.entries.length).toBe(byActorAndType.entries.length);
  });

  it("searches the fields a reader would search", async () => {
    // The slug of the action.
    expect((await everyPage({ q: "role_changed" })).entries.length).toBeGreaterThan(0);
    // The person who acted.
    const byActor = await everyPage({ q: "Nadia" });
    expect(byActor.entries.length).toBeGreaterThan(0);
    expect(byActor.entries.every((entry) => entry.actor?.displayName === MEMBER.displayName)).toBe(
      true,
    );
    // The record the entry was about, by the name inside its payload.
    const byPayload = await everyPage({ q: "Ashford Holdings" });
    expect(byPayload.entries.map((entry) => entry.action)).toContain("entity.created");
    // Nothing at all, rather than everything.
    expect((await everyPage({ q: "no entry says this" })).entries).toEqual([]);
  });

  it("reads a wildcard character as a character, not as a wildcard", async () => {
    // `%` matches everything to Postgres and nothing to the reader who
    // typed it.
    expect((await everyPage({ q: "%" })).entries).toEqual([]);
    expect((await everyPage({ q: "user_role" })).entries).toEqual([]);
  });

  it("composes search with the filters", async () => {
    const both = await everyPage({ q: "Ashford", entityType: "entity" });
    expect(both.entries.length).toBeGreaterThan(0);
    expect(both.entries.every((entry) => entry.entityType === "entity")).toBe(true);

    const wider = await everyPage({ q: "Ashford" });
    expect(wider.entries.length).toBeGreaterThan(both.entries.length);
  });
});

describe("paging", () => {
  /** Comfortably more than one page, appended through the one door the
   * application writes through. */
  const SEEDED = 60;

  beforeAll(async () => {
    await recordActivity(
      harness.db,
      Array.from({ length: SEEDED }, (_, index) => ({
        entityType: "system" as const,
        actorId: userIds.get(ADMIN.email),
        action: "org_settings.updated" as const,
        visibility: "admin_only" as const,
        payload: { field: "name", old: `Ashford ${index}`, new: `Ashford ${index + 1}` },
      })),
    );
  });

  it("never answers the whole table, and the cursor walks it without gaps", async () => {
    const first = await page();
    expect(first.entries.length).toBeLessThanOrEqual(50);
    expect(first.nextCursor).not.toBeNull();

    const { entries, pages } = await everyPage();
    expect(pages).toBeGreaterThan(1);
    expect(entries.length).toBeGreaterThan(SEEDED);
    // No row read twice, and none skipped: the walk holds every row the
    // table holds.
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
    expect(entries.length).toBe(await harness.db.$count(activityLog));
  });

  it("answers an empty page for a cursor naming no row", async () => {
    const answered = await page({ cursor: "01900000-0000-7000-8000-000000000000" });
    expect(answered.entries).toEqual([]);
    expect(answered.nextCursor).toBeNull();
  });

  it("pages a filtered set without leaving the filter behind", async () => {
    const { entries } = await everyPage({ action: "org_settings.updated" });
    expect(entries.length).toBeGreaterThan(50);
    expect(entries.every((entry) => entry.action === "org_settings.updated")).toBe(true);
  });
});

describe("the CSV export", () => {
  it("streams exactly the filtered set, and not the whole table", async () => {
    const filtered = await exportCsv({ entityType: "entity" });
    expect(filtered.statusCode, filtered.body).toBe(200);
    expect(filtered.headers["content-type"]).toContain("text/csv");
    expect(filtered.headers["content-disposition"]).toContain("attachment");

    const rows = csvRows(filtered.body);
    const { entries } = await everyPage({ entityType: "entity" });
    expect(rows).toHaveLength(entries.length);
    for (const entry of entries) expect(filtered.body).toContain(entry.id);

    // The whole table has entries this export must not carry.
    const whole = await exportCsv();
    expect(whole.statusCode, whole.body).toBe(200);
    expect(csvRows(whole.body).length).toBeGreaterThan(rows.length);
    expect(whole.body).toContain("user.role_changed");
    expect(filtered.body).not.toContain("user.role_changed");
  });

  it("carries the header and one quoted record per entry", async () => {
    const res = await exportCsv({ action: "user.role_changed" });
    expect(res.statusCode, res.body).toBe(200);
    const [header] = res.body.split("\r\n");
    expect(header).toBe(
      '"id","created_at","action","entity_type","entity_id","visibility",' +
        '"actor_id","actor_name","actor_email","payload"',
    );
    const rows = csvRows(res.body);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain(`"${ADMIN.displayName}"`);
    expect(rows[0]).toContain(`"${ADMIN.email}"`);
  });

  it("appends an export.performed entry at admin_only, naming its filters", async () => {
    const before = await exportRows();
    const res = await exportCsv({ entityType: "user", q: "role" });
    expect(res.statusCode, res.body).toBe(200);

    const after = await exportRows();
    expect(after.length).toBe(before.length + 1);
    const written = after.at(-1)!;
    expect(written.action).toBe("export.performed");
    expect(written.visibility).toBe("admin_only");
    expect(written.entityType).toBe("system");
    expect(written.entityId).toBeNull();
    expect(written.actorId).toBe(userIds.get(ADMIN.email));
    expect(written.payload).toMatchObject({
      surface: "audit_log",
      format: "csv",
      filters: { entityType: "user", q: "role" },
    });
  });

  it("never streams the record of itself", async () => {
    const first = await exportCsv();
    expect(first.statusCode, first.body).toBe(200);
    const firstEntry = (await exportRows()).at(-1)!;
    expect(first.body).not.toContain(firstEntry.id);

    // The next export carries the previous one's entry: the boundary is
    // the export's own entry, not the slug.
    const second = await exportCsv();
    expect(second.body).toContain(firstEntry.id);
  });

  it("defuses a value a spreadsheet would read as a formula", async () => {
    // An entity id is free text, so it is the shortest honest way to
    // put a formula where a CSV field starts.
    await recordActivity(harness.db, {
      entityType: "contract",
      entityId: "=1+1",
      actorId: userIds.get(ADMIN.email),
      action: "contract.updated",
      visibility: "working_team",
      payload: { changed: {} },
    });
    const res = await exportCsv({ q: "=1+1" });
    expect(res.statusCode, res.body).toBe(200);
    expect(csvRows(res.body)).toHaveLength(1);
    // Quoted and prefixed: the cell reads as text, and the value it
    // could not carry unchanged is still legible in it.
    expect(res.body).toContain(`"'=1+1"`);
    expect(res.body).not.toContain(`"=1+1"`);
  });
});

/** Every export entry the table holds, oldest first. */
function exportRows() {
  return harness.db
    .select()
    .from(activityLog)
    .where(eq(activityLog.action, "export.performed"))
    .orderBy(asc(activityLog.createdAt), asc(activityLog.id));
}

describe("structured emission", () => {
  afterEach(() => {
    clearActivityEmitter();
  });

  it("emits every appended entry as one structured event", async () => {
    const emitted: ActivityEvent[] = [];
    setActivityEmitter((event) => emitted.push(event));

    const res = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/org/general",
      cookies: adminCookies,
      payload: { name: "Ashford Legal Group" },
    });
    expect(res.statusCode, res.body).toBe(200);

    const event = emitted.find((candidate) => candidate.action === "org_settings.updated");
    expect(event).toBeDefined();
    expect(event).toMatchObject({
      entityType: "system",
      entityId: null,
      actorId: userIds.get(ADMIN.email),
      visibility: "admin_only",
    });
    // The line names the row it is a copy of, so a SIEM and the pane
    // are talking about the same entry.
    const [row] = await harness.db.select().from(activityLog).where(eq(activityLog.id, event!.id));
    expect(row).toBeDefined();
    expect(event!.createdAt).toBe(row!.createdAt.toISOString());
    expect(event!.payload).toEqual(row!.payload);
    // And it survives JSON, which is the whole point of emitting it.
    expect(JSON.parse(JSON.stringify(event))).toEqual(event);
  });

  it("does not fail or roll back the mutation when the sink throws", async () => {
    setActivityEmitter(() => {
      throw new Error("the log volume is full");
    });

    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/users/${userIds.get(SUBJECT.email)}/role`,
      cookies: adminCookies,
      payload: { role: "contributor" },
    });

    // The request stands.
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().user).toMatchObject({ role: "contributor" });
    // The mutation stands.
    const [subject] = await harness.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userIds.get(SUBJECT.email)!));
    expect(subject!.role).toBe("contributor");
    // And so does its in-app entry: the emitted copy failed, the
    // recorded one did not.
    const entries = await harness.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, "user.role_changed"))
      .orderBy(asc(activityLog.createdAt), asc(activityLog.id));
    expect(entries.at(-1)!.payload).toMatchObject({ to: "contributor" });
  });
});
