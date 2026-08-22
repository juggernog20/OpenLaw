// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The scaffold the three disposition suites ride (INT-007).
 *
 * Decline, Resolve, and Convert are three outcomes of one act, and the
 * cast they need is the same cast: a Requester who submits, two Legal
 * Team Members so a race has two triagers, and a Contributor for the
 * refusal. So are the reads that follow one — the stored row, the
 * entries, the bell rows, the messages, and the wait for the queue to
 * settle.
 *
 * Held here rather than copied three times, because a copy is a place a
 * change can be forgotten. A change to `provisionUser`, to
 * `signInCookies`, or to the subject-line format would otherwise need
 * three edits, and the copies drift between them.
 *
 * What is **not** here is each disposition's own press and its own
 * reads. `decline`, `resolve`, `convert`, `commentsOn`,
 * `contractNumbered`, and `contractCount` belong to the suite whose
 * subject they are.
 */

import { expect } from "vitest";
import { activityLog, and, eq, notifications, requests, users } from "@openlaw/db";
import { provisionUser } from "../auth/instance.js";
import {
  signInCookies as harnessSignInCookies,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "./harness.js";

export const REQUESTER = {
  email: "tom.iwu@acme.com",
  displayName: "Tom Iwu",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;

export const MEMBER = {
  email: "member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;

/** The second triager, so a race has somebody to lose it to. */
export const OTHER_MEMBER = {
  email: "other.member@example.com",
  displayName: "Priya Rao",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;

/** The reader triage is not, for the refusal. */
export const CONTRIBUTOR = {
  email: "contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;

/** How long the email is given before a suite calls the queue stuck.
 * The mailer is a capture, so this is slack for pg-boss, not for SMTP. */
export const SETTLE_TIMEOUT_MS = 20_000;

export async function settles(what: string, ready: () => boolean): Promise<void> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (ready()) return;
    await new Promise((wait) => setTimeout(wait, 50));
  }
  throw new Error(`${what} did not settle within ${SETTLE_TIMEOUT_MS}ms`);
}

export interface DispositionScaffold {
  adminCookies: Record<string, string>;
  memberCookies: Record<string, string>;
  otherMemberCookies: Record<string, string>;
  contributorCookies: Record<string, string>;
  requesterCookies: Record<string, string>;
  requesterId: string;
  memberId: string;
  stored: (id: string) => Promise<typeof requests.$inferSelect>;
  /** Every entry on one record, oldest first. A Request unless a suite
   * asks for the contract a conversion made. */
  entriesOn: (
    entityId: string,
    entityType?: "request" | "contract",
  ) => Promise<(typeof activityLog.$inferSelect)[]>;
  bellRowsOn: (userId: string, requestId: string) => Promise<(typeof notifications.$inferSelect)[]>;
  /**
   * The messages one person has been sent about one Request, by its
   * R-### reference — which every group-5 subject line carries as
   * `R-### · summary`. The separator is part of the match, because
   * `R-1` is a prefix of `R-10`.
   */
  mailAbout: (email: string, number: number) => ReturnType<TestHarness["mailer"]["messagesTo"]>;
}

/**
 * Installs the cast on a started harness and answers the reads that go
 * with it.
 *
 * Called from a suite's own `beforeAll`, after the setup call that makes
 * the first Administrator. Everything it does is what a disposition
 * suite did for itself before: provision the four fixtures at their
 * roles, sign each of them in, and hand back the cookies.
 */
export async function dispositionScaffold(harness: TestHarness): Promise<DispositionScaffold> {
  let requesterId = "";
  let memberId = "";
  for (const [fixture, role] of [
    [REQUESTER, "business_user"],
    [MEMBER, "legal_team_member"],
    [OTHER_MEMBER, "legal_team_member"],
    [CONTRIBUTOR, "contributor"],
  ] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, user.id));
    if (fixture === REQUESTER) requesterId = user.id;
    if (fixture === MEMBER) memberId = user.id;
  }
  expect(requesterId, "the Requester was not provisioned").not.toBe("");
  expect(memberId, "the Member was not provisioned").not.toBe("");

  const [adminCookies, memberCookies, otherMemberCookies, contributorCookies, requesterCookies] =
    await Promise.all(
      [ADMIN, MEMBER, OTHER_MEMBER, CONTRIBUTOR, REQUESTER].map((fixture) =>
        harnessSignInCookies(harness.app, fixture.email, fixture.password),
      ),
    );

  return {
    adminCookies: adminCookies!,
    memberCookies: memberCookies!,
    otherMemberCookies: otherMemberCookies!,
    contributorCookies: contributorCookies!,
    requesterCookies: requesterCookies!,
    requesterId,
    memberId,
    stored: async (id) => {
      const [row] = await harness.db.select().from(requests).where(eq(requests.id, id)).limit(1);
      return row!;
    },
    entriesOn: (entityId, entityType = "request") =>
      harness.db
        .select()
        .from(activityLog)
        .where(and(eq(activityLog.entityType, entityType), eq(activityLog.entityId, entityId)))
        .orderBy(activityLog.createdAt, activityLog.id),
    bellRowsOn: (userId, requestId) =>
      harness.db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, userId),
            eq(notifications.entityType, "request"),
            eq(notifications.entityId, requestId),
          ),
        ),
    mailAbout: (email, number) =>
      harness.mailer.messagesTo(email).filter((m) => m.subject.includes(`R-${number} ·`)),
  };
}
