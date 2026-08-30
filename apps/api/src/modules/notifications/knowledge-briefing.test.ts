// SPDX-License-Identifier: AGPL-3.0-only

/** M28/6's Knowledge section over the real morning-round seam. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  contractTypes,
  eq,
  knowledgeItems,
  knowledgeTypes,
  notifications,
  users,
} from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import type { MailMessage } from "../../lib/mailer.js";
import { runMorningRound, type MorningRoundSummary } from "../../pipeline/morning-round.js";
import type { PipelineLogger } from "../../pipeline/logger.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "knowledge-briefing-member@example.com",
  displayName: "Casey Counsel",
  password: "correct-horse-battery",
} as const;
const CONTRIBUTOR = {
  email: "knowledge-briefing-contributor@example.com",
  displayName: "Morgan Procurement",
  password: "correct-horse-battery",
} as const;

const quietLog: PipelineLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

let harness: TestHarness;
let adminId: string;
let memberId: string;
let memberCookies: Record<string, string>;
let knowledgeTypeId: string;
let firstMail: MailMessage;
let secondMemberMail: MailMessage;
let secondAdminMail: MailMessage;
let thirdMemberMail: MailMessage;
let fourthMemberMail: MailMessage;
let rerun: MorningRoundSummary;
let memberMailCountBeforeRerun: number;
let bellCountBeforeKnowledgeRound: number;
let bellCountAfterKnowledgeRound: number;

async function round(at: string): Promise<MorningRoundSummary> {
  return await runMorningRound(
    {
      db: harness.db,
      log: quietLog,
      notifier: harness.notifier,
      resolveMailer: harness.resolveMailer,
      baseUrl: "http://localhost",
    },
    harness.pipeline,
    { now: new Date(at) },
  );
}

async function item(
  title: string,
  authorId: string,
  publishedAt: string,
  options: { state?: "draft" | "published"; archivedAt?: string } = {},
): Promise<void> {
  await harness.db.insert(knowledgeItems).values({
    title,
    knowledgeTypeId,
    state: options.state ?? "published",
    publishedAt: new Date(publishedAt),
    archivedAt: options.archivedAt ? new Date(options.archivedAt) : null,
    createdBy: authorId,
    updatedBy: authorId,
  });
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
  expect(admin).toBeDefined();
  adminId = admin!.id;

  const member = await provisionUser(harness.app.auth, MEMBER);
  memberId = member.id;
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, member.id));
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);

  const contributor = await provisionUser(harness.app.auth, CONTRIBUTOR);
  await harness.db.update(users).set({ role: "contributor" }).where(eq(users.id, contributor.id));

  const [knowledgeType] = await harness.db
    .select({ id: knowledgeTypes.id })
    .from(knowledgeTypes)
    .where(eq(knowledgeTypes.slug, "playbook"));
  expect(knowledgeType).toBeDefined();
  knowledgeTypeId = knowledgeType!.id;

  bellCountBeforeKnowledgeRound = (
    await harness.db.select({ id: notifications.id }).from(notifications)
  ).length;
  // A first briefing has no previous send to start from, so it reaches
  // back one day and no further.
  await item("Stale playbook", adminId, "2027-03-31T07:00:00Z");
  await item("Baseline playbook", adminId, "2027-04-01T07:00:00Z");
  await round("2027-04-01T08:00:00Z");
  firstMail = harness.mailer.messagesTo(MEMBER.email).at(-1)!;
  bellCountAfterKnowledgeRound = (
    await harness.db.select({ id: notifications.id }).from(notifications)
  ).length;

  await item("Backdated note", adminId, "2027-04-01T07:30:00Z");
  await item("Lower-bound note", adminId, "2027-04-01T08:00:00Z");
  await item("Fresh admin playbook", adminId, "2027-04-01T09:00:00Z");
  await item("Member-authored precedent", memberId, "2027-04-01T10:00:00Z");
  await item("Draft guidance", adminId, "2027-04-01T11:00:00Z", { state: "draft" });
  await item("Archived guidance", adminId, "2027-04-01T12:00:00Z", {
    archivedAt: "2027-04-01T13:00:00Z",
  });
  await item("Upper-bound note", adminId, "2027-04-02T08:00:00Z");
  await item("Tomorrow's item", adminId, "2027-04-02T09:00:00Z");
  await round("2027-04-02T08:00:00Z");
  secondMemberMail = harness.mailer.messagesTo(MEMBER.email).at(-1)!;
  secondAdminMail = harness.mailer.messagesTo(ADMIN.email).at(-1)!;

  const toggled = await harness.app.inject({
    method: "PATCH",
    url: "/api/v1/me/notification-preferences",
    cookies: memberCookies,
    payload: { eventGroup: "knowledge", channel: "email", enabled: false },
  });
  expect(toggled.statusCode, toggled.body).toBe(200);
  expect(
    toggled.json().groups.find((group: { eventGroup: string }) => group.eventGroup === "knowledge"),
  ).toMatchObject({ email: false });
  expect(
    toggled
      .json()
      .groups.find((group: { eventGroup: string }) => group.eventGroup === "dates_approaching"),
  ).toMatchObject({ email: true });

  const [contractType] = await harness.db
    .select({ id: contractTypes.id })
    .from(contractTypes)
    .where(eq(contractTypes.slug, "nda"));
  const contract = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: memberCookies,
    payload: { title: "Knowledge toggle control contract", contractTypeId: contractType!.id },
  });
  expect(contract.statusCode, contract.body).toBe(201);
  const keyDate = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${contract.json().contract.number}/key-dates`,
    cookies: memberCookies,
    payload: { date: "2027-04-03", label: "Control date" },
  });
  expect(keyDate.statusCode, keyDate.body).toBe(201);
  await item("Muted Knowledge item", adminId, "2027-04-02T10:00:00Z");
  await round("2027-04-03T08:00:00Z");
  thirdMemberMail = harness.mailer.messagesTo(MEMBER.email).at(-1)!;

  const reenabled = await harness.app.inject({
    method: "PATCH",
    url: "/api/v1/me/notification-preferences",
    cookies: memberCookies,
    payload: { eventGroup: "knowledge", channel: "email", enabled: true },
  });
  expect(reenabled.statusCode, reenabled.body).toBe(200);
  const nextKeyDate = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${contract.json().contract.number}/key-dates`,
    cookies: memberCookies,
    payload: { date: "2027-04-04", label: "Empty section control date" },
  });
  expect(nextKeyDate.statusCode, nextKeyDate.body).toBe(201);
  await round("2027-04-04T08:00:00Z");
  fourthMemberMail = harness.mailer.messagesTo(MEMBER.email).at(-1)!;

  memberMailCountBeforeRerun = harness.mailer.messagesTo(MEMBER.email).length;
  rerun = await round("2027-04-04T09:00:00Z");
});

afterAll(async () => harness.stop());

describe("Knowledge in the morning briefing", () => {
  it("sends a Knowledge-only briefing to Member+ and no Contributor", () => {
    expect(firstMail.text).toContain("Knowledge");
    expect(firstMail.text).toContain("Baseline playbook");
    expect(firstMail.html).toContain("Baseline playbook");
    expect(firstMail.text).not.toContain("Stale playbook");
    expect(harness.mailer.messagesTo(CONTRIBUTOR.email)).toEqual([]);
    expect(bellCountAfterKnowledgeRound).toBe(bellCountBeforeKnowledgeRound);
  });

  it("uses the previous send as an exclusive lower bound and this send as an inclusive upper bound", () => {
    expect(secondMemberMail.text).toContain("Fresh admin playbook");
    // Both were published on or before the first send's instant, so the
    // first briefing was their only chance and a later insert missed it.
    expect(secondMemberMail.text).not.toContain("Backdated note");
    expect(secondMemberMail.text).not.toContain("Lower-bound note");
    // Published on this round's own instant: this briefing, not the next.
    expect(secondMemberMail.text).toContain("Upper-bound note");
    expect(secondMemberMail.text).not.toContain("Tomorrow's item");
    expect(secondMemberMail.text).not.toContain("Draft guidance");
    expect(secondMemberMail.text).not.toContain("Archived guidance");
  });

  it("excludes the reader's own Knowledge items", () => {
    expect(secondMemberMail.text).not.toContain("Member-authored precedent");
    expect(secondAdminMail.text).toContain("Member-authored precedent");
    expect(secondAdminMail.text).not.toContain("Fresh admin playbook");
  });

  it("honours the Knowledge toggle without changing the date section", () => {
    expect(thirdMemberMail.text).toContain("Control date");
    expect(thirdMemberMail.text).not.toContain("Knowledge\n");
    expect(thirdMemberMail.text).not.toContain("Muted Knowledge item");
  });

  it("omits the Knowledge section when its window is empty", () => {
    expect(fourthMemberMail.text).toContain("Empty section control date");
    expect(fourthMemberMail.text).not.toContain("Knowledge\n");
    expect(fourthMemberMail.html).not.toContain("<h2>Knowledge</h2>");
  });

  it("does not send twice when the round is rerun", () => {
    expect(rerun.digests).toBe(0);
    expect(harness.mailer.messagesTo(MEMBER.email)).toHaveLength(memberMailCountBeforeRerun);
  });
});
