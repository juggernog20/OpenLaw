// SPDX-License-Identifier: AGPL-3.0-only

/** M29/7's finished briefing over the real round, preferences, mailer, and bell rows. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  contractApprovals,
  contracts,
  contractKeyDates,
  contractStatuses,
  contractTasks,
  contractTeam,
  contractTypes,
  eq,
  notificationPreferences,
  notifications,
  requests,
  requestTypes,
  sql,
  users,
} from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import { runMorningRound, type MorningRoundSummary } from "../../pipeline/morning-round.js";
import type { PipelineLogger } from "../../pipeline/logger.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const DEFAULT_MEMBER = {
  email: "finished-briefing-default@example.com",
  displayName: "Default Briefing",
  password: "correct-horse-battery",
} as const;
const OPTED_MEMBER = {
  email: "finished-briefing-opted@example.com",
  displayName: "Opted Briefing",
  password: "correct-horse-battery",
} as const;
const MUTED_MEMBER = {
  email: "finished-briefing-muted@example.com",
  displayName: "Muted Briefing",
  password: "correct-horse-battery",
} as const;
const EMPTY_CONTRIBUTOR = {
  email: "finished-briefing-empty@example.com",
  displayName: "Empty Contributor",
  password: "correct-horse-battery",
} as const;
const REQUESTER = {
  email: "finished-briefing-requester@example.com",
  displayName: "Priya Requester",
  password: "correct-horse-battery",
} as const;

const quietLog: PipelineLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

let harness: TestHarness;
const ids = new Map<string, string>();
let today: string;
let first: MorningRoundSummary;
let rerun: MorningRoundSummary;
let readyBeforeRerun: number;
let defaultCookies: Record<string, string>;

const idOf = (fixture: { email: string }): string => ids.get(fixture.email)!;

async function round(hour: number): Promise<MorningRoundSummary> {
  return await runMorningRound(
    {
      db: harness.db,
      log: quietLog,
      notifier: harness.notifier,
      resolveMailer: harness.resolveMailer,
      baseUrl: "http://localhost",
    },
    harness.pipeline,
    { now: new Date(`${today}T${String(hour).padStart(2, "0")}:00:00Z`) },
  );
}

async function readyRows(userId: string) {
  return await harness.db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .then((rows) => rows.filter((row) => row.eventType === "briefing.ready"));
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
  ids.set(ADMIN.email, admin!.id);

  for (const [fixture, role] of [
    [DEFAULT_MEMBER, "legal_team_member"],
    [OPTED_MEMBER, "legal_team_member"],
    [MUTED_MEMBER, "legal_team_member"],
    [EMPTY_CONTRIBUTOR, "contributor"],
    [REQUESTER, "business_user"],
  ] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, user.id));
    ids.set(fixture.email, user.id);
  }
  defaultCookies = await signInCookies(harness.app, DEFAULT_MEMBER.email, DEFAULT_MEMBER.password);

  const current = await harness.db.execute<{ today: string }>(
    sql`select current_date::text as today`,
  );
  today = current.rows[0]!.today;

  const [contractType] = await harness.db
    .select({ id: contractTypes.id })
    .from(contractTypes)
    .where(eq(contractTypes.slug, "nda"));
  const [status] = await harness.db
    .select({ id: contractStatuses.id })
    .from(contractStatuses)
    .where(eq(contractStatuses.stage, "draft"))
    .limit(1);
  const [contract] = await harness.db
    .insert(contracts)
    .values({
      title: "Finished briefing contract",
      contractTypeId: contractType!.id,
      statusId: status!.id,
      managerId: idOf(DEFAULT_MEMBER),
      expiryDate: today,
      aiUnverified: {
        expiry_date: {
          evidence: "The term expires today.",
          runId: "finished-briefing-run",
          writtenAt: new Date().toISOString(),
        },
      },
    })
    .returning({ id: contracts.id });
  await harness.db.insert(contractTeam).values([
    { contractId: contract!.id, userId: idOf(DEFAULT_MEMBER), role: "member" },
    { contractId: contract!.id, userId: idOf(OPTED_MEMBER), role: "member" },
  ]);
  await harness.db.insert(contractApprovals).values([
    {
      contractId: contract!.id,
      approverId: idOf(DEFAULT_MEMBER),
      source: "manual",
      requestedBy: idOf(ADMIN),
    },
    {
      contractId: contract!.id,
      approverId: idOf(OPTED_MEMBER),
      source: "manual",
      requestedBy: idOf(ADMIN),
    },
    {
      contractId: contract!.id,
      approverId: idOf(MUTED_MEMBER),
      source: "manual",
      requestedBy: idOf(ADMIN),
    },
  ]);
  await harness.db.insert(contractTasks).values([
    {
      contractId: contract!.id,
      title: "Overdue briefing Task",
      assigneeId: idOf(DEFAULT_MEMBER),
      dueDate: "2000-01-01",
      displayOrder: 0,
    },
    {
      contractId: contract!.id,
      title: "Due today briefing Task",
      assigneeId: idOf(DEFAULT_MEMBER),
      dueDate: today,
      displayOrder: 1,
    },
    {
      contractId: contract!.id,
      title: "Future Home-only Task",
      assigneeId: idOf(DEFAULT_MEMBER),
      dueDate: "2099-01-01",
      displayOrder: 2,
    },
    {
      contractId: contract!.id,
      title: "Opted member due Task",
      assigneeId: idOf(OPTED_MEMBER),
      dueDate: today,
      displayOrder: 3,
    },
  ]);
  await harness.db.insert(contractKeyDates).values({
    contractId: contract!.id,
    date: today,
    label: "Briefing control date",
  });

  const [requestType] = await harness.db
    .select({ id: requestTypes.id })
    .from(requestTypes)
    .limit(1);
  await harness.db.insert(requests).values({
    requestTypeId: requestType!.id,
    requesterId: idOf(REQUESTER),
    summary: "Review the intake redline",
    description: "Please review it.",
    urgency: "high",
  });

  await harness.db.insert(notificationPreferences).values([
    {
      userId: idOf(DEFAULT_MEMBER),
      eventGroup: "briefing.dates",
      channel: "email",
      enabled: false,
    },
    {
      userId: idOf(OPTED_MEMBER),
      eventGroup: "briefing.intake",
      channel: "email",
      enabled: true,
    },
    // Deliberately off: NOT-008 keeps the briefing's section toggles
    // independent of the event-group grid, so the control date must
    // still reach this reader's briefing — the assertion below proves
    // the coupling never comes back.
    {
      userId: idOf(OPTED_MEMBER),
      eventGroup: "dates_approaching",
      channel: "email",
      enabled: false,
    },
    {
      userId: idOf(MUTED_MEMBER),
      eventGroup: "briefing.approvals",
      channel: "email",
      enabled: false,
    },
  ]);

  first = await round(8);
  readyBeforeRerun = (await harness.db.select().from(notifications)).filter(
    (row) => row.eventType === "briefing.ready",
  ).length;
  rerun = await round(9);
}, 180_000);

afterAll(async () => harness?.stop());

describe("the finished daily briefing", () => {
  it("renders approvals and only due-or-overdue Tasks from the Home section contracts", () => {
    const message = harness.mailer.messagesTo(DEFAULT_MEMBER.email).at(-1)!;
    expect(message.text).toContain("Approvals");
    expect(message.text).toContain("Finished briefing contract");
    expect(message.text).toContain("Overdue briefing Task");
    expect(message.text).toContain("Due today briefing Task");
    expect(message.text).not.toContain("Future Home-only Task");
    expect(message.text).not.toContain("Briefing control date");
    expect(message.html).toContain("Overdue briefing Task");
  });

  it("keeps Intake Member+ and opt-in while the other section defaults stay on", () => {
    const defaultMail = harness.mailer.messagesTo(DEFAULT_MEMBER.email).at(-1)!;
    const optedMail = harness.mailer.messagesTo(OPTED_MEMBER.email).at(-1)!;
    expect(defaultMail.text).not.toContain("Intake\n");
    expect(optedMail.text).toContain("Intake");
    expect(optedMail.text).toContain("Review the intake redline");
    expect(optedMail.text).toContain("Briefing control date");
    expect(optedMail.text).toMatch(/unverified — Expiry: Finished briefing contract/);
    expect(optedMail.html).toMatch(/unverified — Expiry: Finished briefing contract/);
    expect(optedMail.text).not.toMatch(/unverified — Briefing control date/);
    expect(optedMail.html).not.toMatch(/unverified — Briefing control date/);
    expect(optedMail.html).toContain("Review the intake redline");
    expect(harness.mailer.messagesTo(EMPTY_CONTRIBUTOR.email)).toEqual([]);
    expect(harness.mailer.messagesTo(REQUESTER.email)).toEqual([]);
  });

  it("honours a section toggle without silencing the Home-linked bell summary", async () => {
    expect(harness.mailer.messagesTo(MUTED_MEMBER.email)).toEqual([]);
    expect(await readyRows(idOf(MUTED_MEMBER))).toHaveLength(1);

    const defaultBell = await harness.app.inject({
      method: "GET",
      url: "/api/v1/notifications",
      cookies: defaultCookies,
    });
    expect(defaultBell.statusCode, defaultBell.body).toBe(200);
    const eventTypes = (
      defaultBell.json() as { notifications: Array<{ eventType: string }> }
    ).notifications.map((row) => row.eventType);
    expect(eventTypes).toContain("briefing.ready");
    expect(eventTypes).toContain("date.key_date_approaching");
  });

  it("writes one Home-linked row per local day with content, none without, and deduplicates a rerun", async () => {
    for (const fixture of [DEFAULT_MEMBER, OPTED_MEMBER, MUTED_MEMBER]) {
      const rows = await readyRows(idOf(fixture));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        eventType: "briefing.ready",
        payload: { localDate: today },
        emailOwed: false,
      });
    }
    expect(await readyRows(idOf(EMPTY_CONTRIBUTOR))).toEqual([]);
    expect(rerun.digests).toBe(0);
    const readyAfterRerun = (await harness.db.select().from(notifications)).filter(
      (row) => row.eventType === "briefing.ready",
    ).length;
    expect(readyAfterRerun).toBe(readyBeforeRerun);
    expect(first.digests).toBe(2);
  });
});
