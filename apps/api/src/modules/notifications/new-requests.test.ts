// SPDX-License-Identifier: AGPL-3.0-only

/**
 * NOT-002's group 4 (#415, M21/4) at the HTTP seam, over the real-Postgres
 * harness, the real pg-boss queue, and the harness's capturing mailer.
 *
 * **Nothing here looks at the Notifier.** Each case submits a real Request
 * over HTTP and then asserts what a person can observe: the rows the staff
 * notification centre is backed by, the items that centre answers, and the
 * mail the harness caught. No case asserts that the seam was called or how
 * the fan-out is wired.
 *
 * **The fan-out cases read the rows from the table**, which is the same
 * deliberate exception the group-5 suite takes: reading them directly is
 * what lets a case tell "nothing was written" from "a row was written and
 * something omitted it", and every claim that an event told nobody has to
 * be able to do that.
 *
 * What it pins is one event and the four rules that shape it:
 *
 * - **The audience is every live Member+** (INT-006). Member+ triages, and
 *   there are no routing rules to narrow that further, so a Contributor
 *   and a Business User hear nothing.
 * - **The actor is excluded.** A Member+ who submits a Request of their
 *   own is told about it as a Requester, on the portal, and not told about
 *   it again as a triager.
 * - **Email is opt-in** (group 4's default), and in-app off silences the
 *   group entirely — the engine's shape rather than a rule this slice
 *   invents.
 * - **Both channels deep-link to the staff request detail**, `/inbox/R`,
 *   because the reader is staff and the portal address is the Requester's.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { desc, eq, notifications, users, type Notification } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

/** The Business User who asks. Every Request here is theirs unless a case
 * says otherwise. */
const REQUESTER = {
  email: "priya.raman@acme.com",
  displayName: "Priya Raman",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;

/** A Legal Team Member, who triages. */
const TRIAGER = {
  email: "rita.okonjo@example.com",
  displayName: "Rita Okonjo",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;

/** A second Legal Team Member, who turns group 4 email on. */
const SUBSCRIBER = {
  email: "noor.haddad@example.com",
  displayName: "Noor Haddad",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;

/** A Contributor, who is not Member+ and does not triage (DD-013). */
const CONTRIBUTOR = {
  email: "tomas.vega@example.com",
  displayName: "Tomas Vega",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;

/** A Member+ who has left. Archived people are reached by nothing
 * (SET-005). */
const DEPARTED = {
  email: "hana.mori@example.com",
  displayName: "Hana Mori",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;

let harness: TestHarness;
const cookies = new Map<string, Record<string, string>>();
const userIds = new Map<string, string>();
/** The seeded "Contract review" front door, which every Request here is
 * submitted through. */
let contractReviewTypeId: string;
/** What that type is called, which the arrival carries and the email
 * names. */
let contractReviewName: string;

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

/** One Request, as this suite refers to it afterwards. */
interface RequestRow {
  id: string;
  number: number;
  summary: string;
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

  for (const [fixture, role] of [
    [REQUESTER, "business_user"],
    [TRIAGER, "legal_team_member"],
    [SUBSCRIBER, "legal_team_member"],
    [CONTRIBUTOR, "contributor"],
    [DEPARTED, "legal_team_member"],
  ] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, user.id));
    userIds.set(fixture.email, user.id);
    cookies.set(fixture.email, await signInCookies(harness.app, fixture.email, fixture.password));
  }
  // Archived after the sign-in, so the fixture is a person who has left
  // rather than one who never arrived.
  await harness.db
    .update(users)
    .set({ archivedAt: new Date() })
    .where(eq(users.id, idOf(DEPARTED)));

  const types = await harness.app.inject({
    method: "GET",
    url: "/api/v1/request-types",
    cookies: as(ADMIN),
  });
  expect(types.statusCode, types.body).toBe(200);
  const found = (types.json().requestTypes as { slug: string; id: string; displayName: string }[]).find(
    (row) => row.slug === "contract_review",
  );
  expect(found, "the contract_review seed type").toBeDefined();
  contractReviewTypeId = found!.id;
  contractReviewName = found!.displayName;
});

afterAll(async () => {
  await harness.stop();
});

/** Submits a Request through the portal form, as a requester does. */
async function submit(
  fixture: { email: string },
  summary: string,
  urgency: "low" | "medium" | "high" | "critical" = "high",
): Promise<RequestRow> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/requests",
    cookies: as(fixture),
    payload: {
      requestTypeId: contractReviewTypeId,
      summary,
      description: "They sent a redline on the liability cap.",
      urgency,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  const row = res.json().request as RequestRow;
  return { id: row.id, number: row.number, summary: row.summary };
}

/** Every notification row one person holds, newest first. */
const rowsFor = (fixture: { email: string }): Promise<Notification[]> =>
  harness.db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, idOf(fixture)))
    .orderBy(desc(notifications.createdAt), desc(notifications.id));

/** The rows one person holds about one Request. */
const rowsAbout = async (
  fixture: { email: string },
  request: RequestRow,
): Promise<Notification[]> =>
  (await rowsFor(fixture)).filter(
    (row) => row.entityType === "request" && row.entityId === request.id,
  );

/** How long the email is given before the suite calls the queue stuck.
 * The mailer is a capture, so this is slack for pg-boss, not for SMTP. */
const SETTLE_TIMEOUT_MS = 20_000;

/** Waits for a condition the pipeline is expected to bring about. */
async function settles(what: string, ready: () => boolean): Promise<void> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `${what} did not settle within ${SETTLE_TIMEOUT_MS}ms\n` +
      JSON.stringify(harness.jobLog, null, 2),
  );
}

/** The messages this person has been sent about this Request, by its
 * R-### reference — which the arrival's subject line carries as
 * `R-### · summary`. The separator is part of the match, because `R-1`
 * is a prefix of `R-10` and this suite mints numbers past nine. */
const mailAbout = (fixture: { email: string }, request: RequestRow) =>
  harness.mailer
    .messagesTo(fixture.email)
    .filter((m) => m.subject.includes(`R-${request.number} ·`));

/** The staff address every group-4 message deep-links to (#414). */
const inboxLink = (request: RequestRow) => `http://localhost/inbox/${request.number}`;

describe("a Request arriving in the Inbox (INT-006, NOT-002 group 4)", () => {
  it("writes every live Member+ a bell item naming the Request, its type, and its urgency", async () => {
    const request = await submit(REQUESTER, "Review the Northwind supply redline", "critical");

    // The rows are written inside the submission's own transaction, so
    // they are there the moment the 201 lands — nothing to wait for.
    for (const member of [TRIAGER, SUBSCRIBER, ADMIN]) {
      const rows = await rowsAbout(member, request);
      expect(rows.map((row) => row.eventType), member.email).toEqual(["request.submitted"]);
      expect(rows[0]!.readAt).toBeNull();
      expect(rows[0]!.payload.requestNumber).toBe(request.number);
      expect(rows[0]!.payload.requestSummary).toBe(request.summary);
      expect(rows[0]!.payload.requestType).toBe(contractReviewName);
      expect(rows[0]!.payload.urgency).toBe("critical");
      expect(rows[0]!.payload.actorName).toBe(REQUESTER.displayName);
    }
  });

  it("tells a Contributor, a Business User, and a person who has left nothing", async () => {
    const request = await submit(REQUESTER, "Review the Contoso NDA");
    for (const outsider of [CONTRIBUTOR, REQUESTER, DEPARTED]) {
      expect(
        (await rowsAbout(outsider, request)).map((row) => row.eventType),
        outsider.email,
        // The requester holds their own receipt (group 5) and nothing
        // else; the other two hold nothing at all.
      ).not.toContain("request.submitted");
    }
  });

  it("does not tell a Member+ about the Request they submitted themselves", async () => {
    // The actor exclusion, on group 4. Staff ask legal questions too, and
    // the receipt they get for it is the Requester's own (group 5).
    const request = await submit(TRIAGER, "Review our own vendor paper");
    expect((await rowsAbout(TRIAGER, request)).map((row) => row.eventType)).toEqual([
      "request.created",
    ]);
    // Everybody else on the triage side still hears about it.
    expect((await rowsAbout(SUBSCRIBER, request)).map((row) => row.eventType)).toEqual([
      "request.submitted",
    ]);
  });
});

describe("group 4's email (NOT-002)", () => {
  it("is opt-in: nothing leaves for a Member+ who has not asked for it", async () => {
    const request = await submit(REQUESTER, "Review the Initech order form");
    const rows = await rowsAbout(TRIAGER, request);
    expect(rows[0]!.eventType).toBe("request.submitted");
    // Never owed, rather than owed and unsent: the difference is what
    // lets the morning round re-ask for lost mail without writing to
    // everybody who never opted in.
    expect(rows[0]!.emailOwed).toBe(false);
    expect(rows[0]!.emailedAt).toBeNull();
    expect(mailAbout(TRIAGER, request)).toEqual([]);
  });

  it("reaches a Member+ who switched it on, and deep-links to the staff detail", async () => {
    const saved = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/me/notification-preferences",
      cookies: as(SUBSCRIBER),
      payload: { eventGroup: "new_requests", channel: "email", enabled: true },
    });
    expect(saved.statusCode, saved.body).toBe(200);

    const request = await submit(REQUESTER, "Review the Aperture MSA", "medium");
    const rows = await rowsAbout(SUBSCRIBER, request);
    expect(rows[0]!.eventType).toBe("request.submitted");
    expect(rows[0]!.emailOwed).toBe(true);

    await settles(`the arrival email to ${SUBSCRIBER.email}`, () =>
      mailAbout(SUBSCRIBER, request).length > 0,
    );
    const message = mailAbout(SUBSCRIBER, request)[0]!;
    expect(message.subject).toContain("New request");
    expect(message.text).toContain(inboxLink(request));
    expect(message.text).toContain(request.summary);
    expect(message.text).toContain(REQUESTER.displayName);
    expect(message.text).toContain(contractReviewName);

    // The person who never opted in is still owed nothing on the same
    // arrival: a preference is one person's.
    expect(mailAbout(TRIAGER, request)).toEqual([]);
  });

  it("is silenced entirely when in-app is switched off", async () => {
    const saved = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/me/notification-preferences",
      cookies: as(TRIAGER),
      payload: { eventGroup: "new_requests", channel: "in_app", enabled: false },
    });
    expect(saved.statusCode, saved.body).toBe(200);

    const request = await submit(REQUESTER, "Review the Umbrella DPA");
    // The bell row is what the email hangs off (NOT-001's M18/5
    // addendum), so no row is no message — the engine's shape rather
    // than a rule this slice invents.
    expect(await rowsAbout(TRIAGER, request)).toEqual([]);
    expect(mailAbout(TRIAGER, request)).toEqual([]);

    const restored = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/me/notification-preferences",
      cookies: as(TRIAGER),
      payload: { eventGroup: "new_requests", channel: "in_app", enabled: true },
    });
    expect(restored.statusCode, restored.body).toBe(200);
  });
});

describe("the staff notification centre (NOT-001, M20/9)", () => {
  /** One item, as the staff bell answers it. */
  interface BellItem {
    id: string;
    eventType: string;
    entityType: string;
    entityId: string;
    payload: Record<string, unknown>;
    readAt: string | null;
  }

  const staffItems = async (fixture: { email: string }): Promise<BellItem[]> => {
    const res = await harness.app.inject({
      method: "GET",
      url: "/api/v1/notifications",
      cookies: as(fixture),
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { notifications: BellItem[] }).notifications;
  };

  it("answers the arrival, with the number the staff detail is addressed by", async () => {
    const request = await submit(REQUESTER, "Review the Tyrell maintenance schedule");
    const items = await staffItems(TRIAGER);
    const arrival = items.find((item) => item.entityId === request.id);
    expect(arrival, JSON.stringify(items)).toBeDefined();
    expect(arrival!.eventType).toBe("request.submitted");
    expect(arrival!.entityType).toBe("request");
    expect(arrival!.payload.requestNumber).toBe(request.number);
  });

  it("keeps a Member+'s own group-5 receipt off it", async () => {
    // The split is by surface, not by role (M20/9). A Member+ who
    // submits a Request is a Requester on the portal and a triager in
    // the application, and the same act writes them one row on each — so
    // the staff centre must answer the arrival and never the receipt.
    const request = await submit(SUBSCRIBER, "Our own renewal, self-served");
    const items = await staffItems(SUBSCRIBER);
    expect(items.some((item) => item.entityId === request.id)).toBe(false);

    const heard = await staffItems(TRIAGER);
    expect(heard.find((item) => item.entityId === request.id)?.eventType).toBe("request.submitted");
  });

  it("refuses the Inbox's items to a Contributor's bell", async () => {
    const request = await submit(REQUESTER, "Review the Wayne services agreement");
    const items = await staffItems(CONTRIBUTOR);
    expect(items.some((item) => item.entityId === request.id)).toBe(false);
  });
});
