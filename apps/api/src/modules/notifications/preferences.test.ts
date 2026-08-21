// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Personal → Notifications preferences (#320, M18/5) at the HTTP
 * seam, over the real-Postgres harness and the real pg-boss queue.
 *
 * **Nothing here reaches into the Notifier.** A case saves a toggle the
 * way the pane saves it, performs a real mutation over HTTP, and then
 * asserts what a person can observe: the bell list from the API, and the
 * mail the harness's `CapturingMailer` caught.
 *
 * The one thing read outside the seam is `notifications.email_owed`,
 * for `record-activity.test.ts`'s reason: "no email was owed" and "an
 * email was owed and the queue has not run yet" look identical from the
 * mailer's side, and the whole promise of an opt-out is the first one.
 *
 * **Every claim about a channel is made in both directions.** A test
 * that only asserts silence would pass against a fan-out that had
 * stopped sending altogether, so each opt-out case is paired with the
 * opted-in traffic that proves the channel still works.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  and,
  desc,
  eq,
  notificationPreferences,
  notifications,
  users,
  type Notification,
} from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

/** The person who acts: they make every record here, so they hold its
 * `creator` row and are on its team. */
const ACTOR = {
  email: "prefs-actor@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;
/** The person whose preferences every case tunes. */
const TARGET = {
  email: "prefs-target@example.com",
  displayName: "Sarah Chen",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;
/** Somebody else entirely, to pin that a preference is one person's. */
const BYSTANDER = {
  email: "prefs-bystander@example.com",
  displayName: "Otto Bystander",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;

let harness: TestHarness;
const cookies = new Map<string, Record<string, string>>();
const userIds = new Map<string, string>();

const idOf = (fixture: { email: string }): string => {
  const id = userIds.get(fixture.email);
  expect(id, fixture.email).toBeDefined();
  return id!;
};
const as = (fixture: { email: string }): Record<string, string> => {
  const jar = cookies.get(fixture.email);
  expect(jar, fixture.email).toBeDefined();
  return jar!;
};

interface ContractRow {
  id: string;
  number: number;
  title: string;
}

/** One bell item, as the API answers it. */
interface BellItem {
  id: string;
  eventType: string;
  entityId: string;
  payload: Record<string, unknown>;
  readAt: string | null;
}

/** One group's answer, as the preferences routes send it. */
interface GroupPreference {
  eventGroup: string;
  inApp: boolean;
  email: boolean;
}

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
  cookies.set(ADMIN.email, await signInCookies(harness.app, ADMIN.email, ADMIN.password));

  for (const fixture of [ACTOR, TARGET, BYSTANDER] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, user.id));
    userIds.set(fixture.email, user.id);
    cookies.set(fixture.email, await signInCookies(harness.app, fixture.email, fixture.password));
  }
}, 120_000);

afterAll(async () => {
  await harness.stop();
});

// ---------------------------------------------------------------------
// The pane's own two calls
// ---------------------------------------------------------------------

/** The whole grid, as the pane reads it. */
async function preferences(fixture: { email: string }): Promise<GroupPreference[]> {
  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/me/notification-preferences",
    cookies: as(fixture),
  });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { groups: GroupPreference[] }).groups;
}

/** One group's answer out of a grid. */
const groupIn = (groups: GroupPreference[], group: string): GroupPreference => {
  const row = groups.find((entry) => entry.eventGroup === group);
  expect(row, `${group} in ${JSON.stringify(groups)}`).toBeDefined();
  return row!;
};

/** Flips one toggle, the way the pane flips it. */
function saveToggle(
  fixture: { email: string },
  eventGroup: string,
  channel: "in_app" | "email",
  enabled: boolean,
) {
  return harness.app.inject({
    method: "PATCH",
    url: "/api/v1/me/notification-preferences",
    cookies: as(fixture),
    payload: { eventGroup, channel, enabled },
  });
}

/** Flips one toggle, requiring success, and answers the grid it left. */
async function toggle(
  fixture: { email: string },
  eventGroup: string,
  channel: "in_app" | "email",
  enabled: boolean,
): Promise<GroupPreference[]> {
  const res = await saveToggle(fixture, eventGroup, channel, enabled);
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { groups: GroupPreference[] }).groups;
}

// ---------------------------------------------------------------------
// The records and the events fired on them
// ---------------------------------------------------------------------

/** The `nda` seed type, which every contract here is created as. */
async function ndaTypeId(): Promise<string> {
  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: as(ADMIN),
  });
  expect(res.statusCode, res.body).toBe(200);
  const nda = (res.json().contractTypes as { id: string; slug: string }[]).find(
    (row) => row.slug === "nda",
  );
  expect(nda, "the nda seed type").toBeDefined();
  return nda!.id;
}

/** A contract the acting Member made, so they hold its `creator` row. */
async function newContract(title: string): Promise<ContractRow> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: as(ACTOR),
    payload: { title, contractTypeId: await ndaTypeId() },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().contract as ContractRow;
}

/** Puts somebody on a contract's team, which is what puts them in
 * group 2's audience (NOT-002). */
async function addToTeam(number: number, userId: string): Promise<void> {
  const res = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${String(number)}/team`,
    cookies: as(ACTOR),
    payload: { userId, role: "member" },
  });
  expect(res.statusCode, res.body).toBe(201);
}

/** Asks somebody to approve a contract (CTR-012) — a group-1 event. */
async function askToApprove(number: number, approverId: string): Promise<void> {
  const res = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${String(number)}/approvals`,
    cookies: as(ACTOR),
    payload: { approverIds: [approverId] },
  });
  expect(res.statusCode, res.body).toBe(201);
}

/** Says something on a record (DD-016) — a group-2 event. */
async function comment(contract: ContractRow, body: string): Promise<void> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/comments",
    cookies: as(ACTOR),
    payload: {
      entityType: "contract",
      entityId: contract.id,
      body,
      visibility: "working_team",
    },
  });
  expect(res.statusCode, res.body).toBe(201);
}

/** One page of somebody's bell, as they would read it. */
async function bell(fixture: { email: string }): Promise<BellItem[]> {
  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/notifications",
    cookies: as(fixture),
  });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { notifications: BellItem[] }).notifications;
}

/** The items on one person's bell about one record. */
const bellFor = async (fixture: { email: string }, contract: ContractRow): Promise<BellItem[]> =>
  (await bell(fixture)).filter((row) => row.entityId === contract.id);

/**
 * The rows one person holds about one record.
 *
 * Read straight from the table because `email_owed` is a fact no
 * endpoint exposes, and it is the one that separates "no email was
 * owed" from "an email is owed and the queue has not run yet".
 */
const rowsFor = async (
  fixture: { email: string },
  contract: ContractRow,
): Promise<Notification[]> =>
  (
    await harness.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, idOf(fixture)))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
  ).filter((row) => row.entityId === contract.id);

/** How long the email is given before the suite calls the queue stuck.
 * The mailer is a capture, so this is slack for pg-boss, not for SMTP. */
const SETTLE_TIMEOUT_MS = 20_000;

/** Waits for a condition the pipeline is expected to bring about. */
async function settles(what: string, ready: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `${what} did not settle within ${String(SETTLE_TIMEOUT_MS)}ms\n` +
      JSON.stringify(harness.jobLog, null, 2),
  );
}

/** The mail one person has been sent about one record. */
const mailAbout = (fixture: { email: string }, contract: ContractRow) =>
  harness.mailer.messagesTo(fixture.email).filter((m) => m.text.includes(contract.title));

/** Waits for the queue to deliver the message this event owed. */
async function mailArrives(fixture: { email: string }, contract: ContractRow) {
  await settles(`the email to ${fixture.email} about ${contract.title}`, () =>
    Promise.resolve(mailAbout(fixture, contract).length > 0),
  );
  return mailAbout(fixture, contract)[0]!;
}

// ---------------------------------------------------------------------

describe("the grid the pane draws", () => {
  it("answers all five groups with NOT-002's defaults before anybody has an opinion", async () => {
    const groups = await preferences(BYSTANDER);
    // The table holds overrides, so a person who has never opened the
    // pane has no rows at all — and still gets a complete answer.
    expect(groups.map((row) => row.eventGroup)).toEqual([
      "assigned_to_you",
      "activity_on_your_records",
      "dates_approaching",
      "new_requests",
      "requester_events",
    ]);
    // Defaults follow interruptiveness: things done *to* you interrupt,
    // ambient activity does not, and the bell is on for everything.
    expect(groupIn(groups, "assigned_to_you")).toMatchObject({ inApp: true, email: true });
    expect(groupIn(groups, "activity_on_your_records")).toMatchObject({
      inApp: true,
      email: false,
    });
    expect(groupIn(groups, "dates_approaching")).toMatchObject({ inApp: true, email: true });
    expect(groupIn(groups, "new_requests")).toMatchObject({ inApp: true, email: false });
  });

  it("answers the whole grid back from a save, so the pane cannot drift", async () => {
    const saved = await toggle(BYSTANDER, "dates_approaching", "email", false);
    expect(groupIn(saved, "dates_approaching")).toMatchObject({ inApp: true, email: false });
    // And a fresh read agrees with what the write answered.
    expect(groupIn(await preferences(BYSTANDER), "dates_approaching")).toMatchObject({
      inApp: true,
      email: false,
    });
    // Put it back, so no later case inherits this one's opinion.
    await toggle(BYSTANDER, "dates_approaching", "email", true);
  });

  it("moves one channel of one group and leaves the rest alone", async () => {
    const before = await preferences(BYSTANDER);
    const after = await toggle(BYSTANDER, "activity_on_your_records", "email", true);
    expect(groupIn(after, "activity_on_your_records")).toMatchObject({ inApp: true, email: true });
    // The bell for the same group is untouched — the two channels are
    // separate rows, which is what lets them be tuned independently.
    expect(groupIn(after, "activity_on_your_records").inApp).toBe(
      groupIn(before, "activity_on_your_records").inApp,
    );
    // And so is every other group.
    for (const group of ["assigned_to_you", "dates_approaching", "new_requests"] as const) {
      expect(groupIn(after, group)).toEqual(groupIn(before, group));
    }
    await toggle(BYSTANDER, "activity_on_your_records", "email", false);
  });

  it("stores a disagreement with the default and removes it when the toggle goes back", async () => {
    // The one claim in this suite that cannot be made from outside the
    // seam: "no row" and "a row that agrees with the default" answer
    // identically today and differ only on the day a default moves
    // (M20/9). So the table itself is what is read.
    const rowsFor = () =>
      harness.db
        .select({ enabled: notificationPreferences.enabled })
        .from(notificationPreferences)
        .where(
          and(
            eq(notificationPreferences.userId, idOf(BYSTANDER)),
            eq(notificationPreferences.eventGroup, "dates_approaching"),
            eq(notificationPreferences.channel, "email"),
          ),
        );

    expect(await rowsFor()).toEqual([]);

    // Group 3 emails by default, so switching it off is a real override.
    await toggle(BYSTANDER, "dates_approaching", "email", false);
    expect(await rowsFor()).toEqual([{ enabled: false }]);

    // And switching it back on is not a second opinion — it is the
    // withdrawal of the first. The table holds overrides, so a row that
    // agrees with the default is not one.
    await toggle(BYSTANDER, "dates_approaching", "email", true);
    expect(await rowsFor()).toEqual([]);
    // The effective answer is the same either way, which is why the pane
    // never has to know which of the two states it is looking at.
    expect(groupIn(await preferences(BYSTANDER), "dates_approaching")).toMatchObject({
      inApp: true,
      email: true,
    });
  });

  it("is one person's, and no route names another", async () => {
    await toggle(TARGET, "new_requests", "email", true);
    expect(groupIn(await preferences(BYSTANDER), "new_requests").email).toBe(false);
    await toggle(TARGET, "new_requests", "email", false);
  });

  it("refuses a caller who is not signed in", async () => {
    const read = await harness.app.inject({
      method: "GET",
      url: "/api/v1/me/notification-preferences",
    });
    expect(read.statusCode).toBe(401);
    const write = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/me/notification-preferences",
      payload: { eventGroup: "assigned_to_you", channel: "email", enabled: false },
    });
    expect(write.statusCode).toBe(401);
  });

  it("refuses a group or a channel that is not in the model", async () => {
    for (const payload of [
      { eventGroup: "everything", channel: "email", enabled: false },
      { eventGroup: "assigned_to_you", channel: "sms", enabled: false },
    ]) {
      const res = await harness.app.inject({
        method: "PATCH",
        url: "/api/v1/me/notification-preferences",
        cookies: as(TARGET),
        payload,
      });
      expect(res.statusCode, res.body).toBe(400);
    }
  });
});

describe("a saved toggle changes the very next event", () => {
  it("keeps the bell items and stops the email when email goes off for group 1", async () => {
    await toggle(TARGET, "assigned_to_you", "email", false);

    const quiet = await newContract("Prefs · asked with email off");
    await askToApprove(quiet.number, idOf(TARGET));

    // The bell still rings: opting out of interruption is not opting
    // out of information.
    const items = await bellFor(TARGET, quiet);
    expect(items.map((row) => row.eventType)).toEqual(["approval.requested"]);
    expect(items[0]!.readAt).toBeNull();

    // And the row itself says no email was ever owed, which is the half
    // an empty inbox cannot prove on its own.
    const rows = await rowsFor(TARGET, quiet);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.emailOwed).toBe(false);
    expect(rows[0]!.emailedAt).toBeNull();

    // The other direction, so the silence above is an opt-out and not a
    // broken channel: with email back on, the next ask mails.
    await toggle(TARGET, "assigned_to_you", "email", true);
    const loud = await newContract("Prefs · asked with email on");
    await askToApprove(loud.number, idOf(TARGET));
    const message = await mailArrives(TARGET, loud);
    expect(message.subject).toContain(loud.title);

    // And once the queue has demonstrably run, the opted-out record is
    // still not in the inbox.
    expect(mailAbout(TARGET, quiet)).toEqual([]);
  });

  it("silences a group entirely when the bell goes off", async () => {
    // In-app off is the whole row: the email hangs off the bell row, so
    // there is nothing left for either channel to carry.
    await toggle(TARGET, "assigned_to_you", "in_app", false);
    const contract = await newContract("Prefs · asked with the bell off");
    await askToApprove(contract.number, idOf(TARGET));

    expect(await bellFor(TARGET, contract)).toEqual([]);
    expect(await rowsFor(TARGET, contract)).toEqual([]);
    expect(mailAbout(TARGET, contract)).toEqual([]);

    await toggle(TARGET, "assigned_to_you", "in_app", true);
  });
});

describe("group 2's email opt-in (NOT-002)", () => {
  it("sends nothing to somebody who has not asked for it", async () => {
    const contract = await newContract("Prefs · ambient, not asked for");
    await addToTeam(contract.number, idOf(TARGET));
    await comment(contract, "Clause 7 needs another look.");

    const items = await bellFor(TARGET, contract);
    expect(items.map((row) => row.eventType)).toContain("comment.posted");
    const said = (await rowsFor(TARGET, contract)).filter(
      (row) => row.eventType === "comment.posted",
    );
    expect(said).toHaveLength(1);
    expect(said[0]!.emailOwed).toBe(false);
    expect(mailAbout(TARGET, contract)).toEqual([]);
  });

  it("mails the person who opted in", async () => {
    await toggle(TARGET, "activity_on_your_records", "email", true);
    const contract = await newContract("Prefs · ambient, asked for");
    await addToTeam(contract.number, idOf(TARGET));
    await comment(contract, "Second look done, ready for signature.");

    const items = await bellFor(TARGET, contract);
    expect(items.map((row) => row.eventType)).toContain("comment.posted");
    const message = await mailArrives(TARGET, contract);
    expect(message.subject).toContain(contract.title);
    // The deep link is the whole point of the channel (NOT-005).
    expect(message.text).toContain(`http://localhost/contracts/${String(contract.number)}`);
    // The words themselves stay on the thread: DD-016 is enforced there,
    // and a redact (CMT-006) cannot reach a message that has left.
    expect(message.text).not.toContain("Second look done");

    await toggle(TARGET, "activity_on_your_records", "email", false);
  });
});

describe("the activity log (DD-017)", () => {
  it("narrates every preference write", async () => {
    const rowsOf = () =>
      harness.db
        .select()
        .from(activityLog)
        .where(
          and(
            eq(activityLog.action, "user.notification_preference_changed"),
            eq(activityLog.actorId, idOf(BYSTANDER)),
          ),
        )
        .orderBy(desc(activityLog.createdAt), desc(activityLog.id));

    const before = (await rowsOf()).length;
    await toggle(BYSTANDER, "activity_on_your_records", "email", true);
    const after = await rowsOf();
    expect(after).toHaveLength(before + 1);
    expect(after[0]!.entityType).toBe("user");
    expect(after[0]!.entityId).toBe(idOf(BYSTANDER));
    // `admin_only`, like every other settings and profile entry: no
    // record feed carries it, and the audit log is where it is read.
    expect(after[0]!.visibility).toBe("admin_only");
    expect(after[0]!.payload).toMatchObject({
      eventGroup: "activity_on_your_records",
      channel: "email",
      enabled: true,
    });

    // And an Administrator reads it back through the audit log, which is
    // the surface the entry exists for.
    const audit = await harness.app.inject({
      method: "GET",
      url: "/api/v1/audit-log?action=user.notification_preference_changed",
      cookies: as(ADMIN),
    });
    expect(audit.statusCode, audit.body).toBe(200);
    const entries = (audit.json() as { entries: { action: string }[] }).entries;
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.action).toBe("user.notification_preference_changed");
    }

    await toggle(BYSTANDER, "activity_on_your_records", "email", false);
  });
});
