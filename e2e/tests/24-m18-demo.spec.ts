// SPDX-License-Identifier: AGPL-3.0-only

/**
 * M18 milestone acceptance (#323): the demo, end to end.
 *
 * An approaching notice deadline produces a bell item and a morning
 * digest email, while an approval request emails the approver
 * immediately.
 *
 * Two people and one portfolio. A Legal Team Member makes a contract and
 * gives it a term whose **notice deadline lands exactly one NOT-004
 * offset away**, names one key date on the same day, and holds nine more
 * records expiring on it. A second Legal Team Member is asked to approve
 * the first one. Then a morning round runs on the real stack, and both
 * halves of the milestone are read the way a person reads them: the bell
 * in the browser, and the mail in Mailpit.
 *
 * **The deadline path.** The round writes the Owner's bell items and
 * sends them one briefing — not one message per date, which is NOT-003's
 * whole argument. The briefing names the notice deadline, the record,
 * and the section to act in; the bell says the same thing and links to
 * the same place.
 *
 * **The immediate path.** The approval request reaches the approver's
 * inbox on its own, within seconds, and sits on their bell as well —
 * NOT-002's group 1, where a direct ask interrupts.
 *
 * **The badge.** Eleven date reminders plus the daily briefing summary
 * give the Owner more unread items than the badge will draw, so it reads
 * "9+" (NOT-005) while its accessible name still says the whole number.
 * Opening the centre reads the page it draws, and the badge goes.
 *
 * **How the round is made to run.** The morning round is a pg-boss cron
 * on the hour, and a browser suite has neither a way to reach a
 * scheduled handler nor an hour to wait for the next tick. The dev/E2E
 * overlay therefore mounts `POST /api/v1/notifications/morning-round`
 * (`MORNING_ROUND_TRIGGER=on`, the `AUTH_RATE_LIMIT=off` shape), which
 * runs **the same round, on the real clock, with no parameters at all**.
 * Every gate the round has still decides for itself — so this spec makes
 * the round fire by arranging the world it reads: the Owner is put in a
 * timezone whose morning has already arrived, and the dates are set
 * against that person's own civil date. Nothing about the round is
 * weakened to make the demo pass.
 *
 * The instance is left as the run found it, on the earlier demo specs'
 * convention: per-run rows carry this spec's own prefix and are swept
 * before the journey starts and after it ends. The install's reminder
 * offsets are put back too — they are shared state, not per-run state.
 */

import { test, expect, type Locator, type Page } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { z } from "zod";
import {
  ADMIN,
  ensureAdminExists,
  ensureMemberInert,
  onboardActivatedMember,
  signInAs,
  startsWithName,
  sweepOrSay,
  type OnboardedMember,
} from "./helpers.js";
import { waitForMailTo } from "./mailpit.js";

/**
 * Generous timeout: two people onboarded through the real invite flow, a
 * contract with a term and a dozen key dates, an approval request, a
 * morning round over the real pipeline, and two inboxes polled.
 */
test.setTimeout(420_000);

/** Per-run contracts carry this prefix, so a crashed earlier run's
 * leftovers can be swept before the journey starts. */
const CONTRACT_PREFIX = "E2E M18 Brightwater services agreement";

/** Every per-run person's address starts here. */
const MEMBER_EMAIL_PREFIX = "e2e-m18-";

/** The Owner: the record is theirs, so its dates are about them. */
const OWNER_NAME = "Sasha Brightwater";

/** The approver: on no team, asked by name. */
const APPROVER_NAME = "Rowan Aldridge";

/**
 * The offsets this run fires on (NOT-004's seed).
 *
 * Written through the Administrator's own route rather than assumed: the
 * list is install-wide and another suite may have left it elsewhere on
 * the never-reset instance (TECH-018). Whatever was there is put back.
 */
const DEMO_OFFSETS = [7, 1, 0];

/** How many days a notice window runs for on this record. Chosen so the
 * expiry itself — a notice period beyond the deadline — sits at no
 * offset at all, and fires nothing of its own. */
const NOTICE_PERIOD_DAYS = 30;

/** The one named date on the subject record (CTR-009), so all three
 * sources of the deadline union reach the briefing: a key date, a notice
 * deadline, and the expiries on the records beside it. */
const KEY_DATE_LABEL = "Board sign-off";

/**
 * How many further records the Owner holds, each expiring on the same
 * lead time.
 *
 * A briefing is a person's whole morning and not one record's, so the
 * Owner is given the portfolio a briefing is written for. Nine of them
 * beside the subject record's two dates is eleven items on one bell —
 * past NOT-005's cap of nine, which is what the badge assertion needs,
 * and still inside one page of the centre (the API pages at 25), which
 * is what makes read-on-open clear the badge in a single write.
 *
 * They are also why the count is made of **separate records**. The
 * date-reminder dedup identity is user, event, entity, date, and offset
 * (M18/1), so two key dates on one record on one day are one reminder by
 * design — a bell item says "a date on this record is coming up", and
 * the record is where the dates are read.
 */
const EXTRA_CONTRACTS = 9;

/** Every date the round is expected to raise for the Owner: the subject
 * record's notice deadline and key date, and one expiry each on the
 * records beside it. */
const EXPECTED_REMINDERS = EXTRA_CONTRACTS + 2;

/** NOT-008 adds one daily summary row beside the date reminders. */
const EXPECTED_BELL_ITEMS = EXPECTED_REMINDERS + 1;

/**
 * Zones dense enough that one of them always reads a workable hour.
 *
 * The round serves a person once their own clock has **reached** 08:00
 * (NOT-003), and this suite runs at whatever time of day CI happens to
 * be. The trigger deliberately has no clock parameter, so the fixture is
 * moved to a zone where the morning has already arrived at this very
 * instant. These offsets span more than a day in steps of an hour or
 * two, so one of them always lands inside the window below.
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

/** The morning gate itself (`DIGEST_LOCAL_HOUR`). */
const MORNING_HOUR = 8;

/**
 * The latest local hour the Owner is allowed to sit at.
 *
 * Every date in this journey is computed against the Owner's own civil
 * date, so a midnight crossing part way through would be a different
 * day's round. Twenty leaves four hours of headroom on a journey that
 * takes minutes.
 */
const LATEST_LOCAL_HOUR = 20;

/** What one person's clock reads at an instant — `localMoment`'s
 * question, asked on this side of the wire. */
function localMoment(now: Date, timeZone: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    hour: Number(part("hour")) % 24,
  };
}

/** A zone whose clock reads between the morning gate and the ceiling
 * right now, with the civil date it is on. */
function zoneInTheMorning(now: Date): { zone: string; today: string } {
  for (const zone of CANDIDATE_ZONES) {
    const moment = localMoment(now, zone);
    if (moment.hour >= MORNING_HOUR && moment.hour <= LATEST_LOCAL_HOUR) {
      return { zone, today: moment.date };
    }
  }
  throw new Error("no candidate zone reads a workable hour, which the offsets make impossible");
}

/** One civil date, so many days on. Arithmetic in UTC, because a civil
 * date is a day and not a moment. */
function daysOn(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** Only what the sweep reads. */
const ContractRows = z.object({
  contracts: z.array(z.object({ number: z.number().int(), title: z.string() })),
});

/** The record's pickers. */
const ContractOptions = z.object({
  contractTypes: z.array(
    z.object({
      id: z.string(),
      displayName: z.string(),
      fields: z.array(z.object({ isRequired: z.boolean() })),
    }),
  ),
  contractStatuses: z.array(
    z.object({ id: z.string(), displayName: z.string(), stage: z.string() }),
  ),
});

type StatusOption = z.infer<typeof ContractOptions>["contractStatuses"][number];

/** The install's reminder lead times (NOT-004). */
const OffsetsEnvelope = z.object({ offsets: z.array(z.number().int()) });

/** What one round did (`MorningRoundSummary`). */
const RoundSummary = z.object({
  served: z.number().int(),
  reminders: z.number().int(),
  digests: z.number().int(),
  skipped: z.number().int(),
  reasked: z.number().int(),
  stopped: z.boolean(),
});

/** One bell item, as the API answers it. */
const BellEnvelope = z.object({
  notifications: z.array(
    z.object({
      id: z.string(),
      eventType: z.string(),
      entityId: z.string(),
      payload: z.record(z.string(), z.unknown()),
      readAt: z.string().nullable(),
    }),
  ),
});

const UnreadEnvelope = z.object({ unread: z.number().int() });

async function listContracts(request: APIRequestContext) {
  const listed = await request.get("/api/v1/contracts?includeEnded=true");
  expect(listed.status(), await listed.text()).toBe(200);
  return ContractRows.parse(await listed.json()).contracts;
}

/** Leaves every per-run contract of this spec inert (TECH-018 cleanup). */
async function ensureDemoContractsInert(request: APIRequestContext) {
  for (const row of (await listContracts(request)).filter((contract) =>
    contract.title.startsWith(CONTRACT_PREFIX),
  )) {
    const archived = await request.post(`/api/v1/contracts/${row.number}/archive`);
    expect(archived.status(), await archived.text()).toBe(200);
  }
}

/** Leaves every per-run person of this spec inert. */
async function ensureDemoMembersInert(request: APIRequestContext) {
  const listed = await request.get("/api/v1/users");
  expect(listed.status(), await listed.text()).toBe(200);
  const { users } = z
    .object({ users: z.array(z.object({ email: z.string(), status: z.string() })) })
    .parse(await listed.json());
  for (const user of users.filter(
    (row) => row.email.startsWith(MEMBER_EMAIL_PREFIX) && row.status !== "archived",
  )) {
    await ensureMemberInert(request, user.email);
  }
}

/** The record's pickers, as the seam answers them. */
async function readOptions(request: APIRequestContext) {
  const options = await request.get("/api/v1/contracts/options");
  expect(options.status(), await options.text()).toBe(200);
  return ContractOptions.parse(await options.json());
}

/** A status at a given stage. */
function statusAt(options: z.infer<typeof ContractOptions>, stage: string): StatusOption {
  const found = options.contractStatuses.find((status) => status.stage === stage);
  expect(found, `no live contract status sits at the ${stage} stage`).toBeDefined();
  return found!;
}

/** A seed contract type that demands no field. */
function bareContractType(
  options: z.infer<typeof ContractOptions>,
): z.infer<typeof ContractOptions>["contractTypes"][number] {
  const bare = options.contractTypes.find((type) =>
    type.fields.every((field) => !field.isRequired),
  );
  expect(bare, "no contract type without a hard-required field is configured").toBeDefined();
  return bare!;
}

/** The install's reminder lead times, as the Administrator reads them. */
async function readOffsets(request: APIRequestContext): Promise<number[]> {
  const read = await request.get("/api/v1/org/reminder-offsets");
  expect(read.status(), await read.text()).toBe(200);
  return OffsetsEnvelope.parse(await read.json()).offsets;
}

/** Replaces the install's reminder lead times (NOT-004's one write). */
async function saveOffsets(request: APIRequestContext, offsets: number[]): Promise<void> {
  const saved = await request.put("/api/v1/org/reminder-offsets", { data: { offsets } });
  expect(saved.status(), await saved.text()).toBe(200);
}

/** Makes a contract through the create dialog and answers its number. */
async function createContract(page: Page, title: string, typeName: string): Promise<number> {
  await page.goto("/contracts");
  await page.getByRole("button", { name: "Create contract" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Contract type").selectOption({ label: typeName });
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/contracts") && response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  const contract = z
    .object({ contract: z.object({ number: z.number().int() }) })
    .parse(await (await created).json()).contract;
  await expect(dialog).toBeHidden();
  return contract.number;
}

/** The strip's move control (DES-053): the current stage's pill, which
 * is the one item of the six that can be pressed. */
function moveControl(page: Page): Locator {
  return page.getByRole("button", { name: /move contract$/ });
}

/** Opens the move menu and picks one status by the label it wears. */
async function pickFrom(page: Page, status: StatusOption): Promise<void> {
  await moveControl(page).click();
  await page
    .getByRole("menuitemradio")
    .filter({ hasText: startsWithName(status.displayName) })
    .first()
    .click();
}

/** Sets the contract's status through the strip's own move menu. */
async function pickStatus(page: Page, number: number, status: StatusOption): Promise<void> {
  const answered = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/contracts/${number}`) &&
      response.request().method() === "PATCH",
  );
  await pickFrom(page, status);
  const settled = await answered;
  expect(settled.status(), await settled.text()).toBe(200);
}

/** The bell in the shell header (NOT-005, DES-049). */
function bellTrigger(page: Page): Locator {
  return page.getByRole("banner").getByRole("button", { name: /^Notifications,/ });
}

/** The notification centre behind it. */
function notificationCentre(page: Page): Locator {
  return page.getByRole("dialog", { name: "Notifications" });
}

/** One person's bell, as the seam answers it. */
async function readBell(request: APIRequestContext) {
  const read = await request.get("/api/v1/notifications");
  expect(read.status(), await read.text()).toBe(200);
  return BellEnvelope.parse(await read.json()).notifications;
}

/** One person's unread count, uncapped. */
async function readUnread(request: APIRequestContext): Promise<number> {
  const read = await request.get("/api/v1/notifications/unread-count");
  expect(read.status(), await read.text()).toBe(200);
  return UnreadEnvelope.parse(await read.json()).unread;
}

test.describe("M18 demo path", () => {
  test.beforeAll(async ({ request }) => {
    await ensureAdminExists(request);
  });

  test("an approaching notice deadline rings the bell and briefs by email, while an approval request mails at once", async ({
    page,
    browser,
  }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    // Known starting state on the never-reset instance (TECH-018).
    await ensureDemoContractsInert(page.request);
    await ensureDemoMembersInert(page.request);

    const stamp = Date.now();
    const title = `${CONTRACT_PREFIX} ${stamp}`;
    const ownerEmail = `${MEMBER_EMAIL_PREFIX}owner-${stamp}@e2e.example`;
    const approverEmail = `${MEMBER_EMAIL_PREFIX}approver-${stamp}@e2e.example`;

    let owner: OnboardedMember | undefined;
    let approver: OnboardedMember | undefined;
    // The install's own list, restored whatever happens: it is shared
    // state and not this run's to keep.
    const offsetsBefore = await readOffsets(page.request);

    const leaveInert = async () => {
      await owner?.context.close();
      await approver?.context.close();
      await ensureDemoContractsInert(page.request);
      await ensureMemberInert(page.request, ownerEmail);
      await ensureMemberInert(page.request, approverEmail);
      await saveOffsets(page.request, offsetsBefore);
    };

    try {
      await saveOffsets(page.request, DEMO_OFFSETS);

      owner = await onboardActivatedMember(page.request, browser, {
        email: ownerEmail,
        displayName: OWNER_NAME,
        role: "legal_team_member",
        password: "their-own-e2e-password",
      });
      approver = await onboardActivatedMember(page.request, browser, {
        email: approverEmail,
        displayName: APPROVER_NAME,
        role: "legal_team_member",
        password: "their-own-e2e-password",
      });
      const ownerPage = owner.page;
      const approverPage = approver.page;

      // ---- The Owner's own morning (NOT-003, SET-006) ----
      //
      // The round serves 08:00 **where the reader is**, so the Owner is
      // put somewhere it already is. Their profile zone is a real
      // setting a person saves, and everything below is dated against
      // the civil date it puts them on.
      const { zone, today } = zoneInTheMorning(new Date());
      const zoned = await ownerPage.request.patch("/api/v1/me/preferences", {
        data: { timezone: zone },
      });
      expect(zoned.status(), await zoned.text()).toBe(200);

      // ---- A record with a deadline exactly one offset away ----

      const options = await readOptions(page.request);
      const contractType = bareContractType(options);
      const number = await createContract(ownerPage, title, contractType.displayName);
      await ownerPage.goto(`/contracts/${number}`);
      await expect(ownerPage.getByRole("heading", { level: 1, name: title })).toBeVisible();
      await pickStatus(ownerPage, number, statusAt(options, "active"));

      // The deadline is `expiry − notice period` (CTR-006), derived and
      // stored nowhere. Working backwards: put the deadline on the
      // furthest lead time, and the expiry a notice period beyond it —
      // where no offset can reach it, so exactly one of the two fires.
      const offset = Math.max(...DEMO_OFFSETS);
      const deadline = daysOn(today, offset);
      const expiry = daysOn(deadline, NOTICE_PERIOD_DAYS);
      const termed = await ownerPage.request.patch(`/api/v1/contracts/${number}`, {
        data: { expiryDate: expiry, noticePeriodDays: NOTICE_PERIOD_DAYS },
      });
      expect(termed.status(), await termed.text()).toBe(200);

      // The screen half: the record itself says the deadline is what the
      // arithmetic above intended, so the reminder below is about a date
      // a reader can see.
      await ownerPage.goto(`/contracts/${number}/key-dates`);
      const keyDates = ownerPage.getByRole("region", { name: "Key dates" });
      await expect(keyDates).toContainText("Renewal notice deadline");

      // One named date on the same day, so the briefing carries all
      // three sources of CTR-009's union. Written at the seam because
      // the add dialog is M16's own demo.
      const namedDate = await ownerPage.request.post(`/api/v1/contracts/${number}/key-dates`, {
        data: { date: deadline, label: KEY_DATE_LABEL },
      });
      expect(namedDate.status(), await namedDate.text()).toBe(201);

      // ---- The rest of the Owner's morning ----
      //
      // A briefing is about a person's whole day, so the Owner is given
      // the portfolio one is written for: nine more records, each
      // expiring on the same lead time. It is also what puts more items
      // on their bell than the badge will draw.
      const others: { number: number; title: string }[] = [];
      for (let index = 1; index <= EXTRA_CONTRACTS; index += 1) {
        const otherTitle = `${CONTRACT_PREFIX} ${stamp} — renewal ${index}`;
        const made = await ownerPage.request.post("/api/v1/contracts", {
          data: { title: otherTitle, contractTypeId: contractType.id },
        });
        expect(made.status(), await made.text()).toBe(201);
        const otherNumber = z
          .object({ contract: z.object({ number: z.number().int() }) })
          .parse(await made.json()).contract.number;
        const dated = await ownerPage.request.patch(`/api/v1/contracts/${otherNumber}`, {
          data: { expiryDate: deadline },
        });
        expect(dated.status(), await dated.text()).toBe(200);
        others.push({ number: otherNumber, title: otherTitle });
      }

      // ---- The immediate path: an approval request (NOT-002 group 1) ----

      await ownerPage.goto(`/contracts/${number}/approvals`);
      const approvals = ownerPage.getByRole("region", { name: "Approvals" });
      await expect(approvals).toContainText("No approvals requested on this contract yet.");
      await approvals.getByRole("button", { name: "Add approver" }).click();
      const askDialog = ownerPage.getByRole("dialog");
      await expect(askDialog.getByText("Add approver")).toBeVisible();
      await askDialog.getByRole("checkbox", { name: APPROVER_NAME }).click();
      const asked = ownerPage.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/contracts/${number}/approvals`) &&
          response.request().method() === "POST",
      );
      await askDialog.getByRole("button", { name: "Request approvals" }).click();
      expect((await asked).status()).toBe(201);
      await expect(askDialog).toBeHidden();
      await expect(approvals.getByRole("row").filter({ hasText: APPROVER_NAME })).toContainText(
        "Pending",
      );

      // Mailpit's half: the approver hears about it on their own,
      // without the app open, and the message says where to act.
      const askMail = await waitForMailTo(page.request, approverEmail, /^Approval requested:/);
      expect(askMail.subject).toBe(`Approval requested: ${title}`);
      expect(askMail.text).toContain(`${OWNER_NAME} has asked you to approve ${title}.`);
      expect(askMail.text).toContain(`/contracts/${number}`);

      // The bell's half, in the approver's own browser: the same ask,
      // waiting for them at their next sign-in (story 2).
      await approverPage.goto("/");
      const approverBell = bellTrigger(approverPage);
      await expect(approverBell).toHaveAccessibleName("Notifications, 1 unread");
      await approverBell.click();
      const approverCentre = notificationCentre(approverPage);
      await expect(approverCentre).toBeVisible();
      await expect(
        approverCentre.getByRole("link", { name: `${OWNER_NAME} asked you to approve ${title}` }),
      ).toBeVisible();

      // Read-on-open, on the smaller of the two bells: the page it drew
      // is read, so the badge goes (NOT-005).
      await expect(bellTrigger(approverPage)).toHaveAccessibleName("Notifications, none unread", {
        timeout: 15_000,
      });

      // ---- The deadline path: one morning round ----
      //
      // The same round the cron runs, asked for now (TECH-018's harness
      // seam). It takes no clock and no person: the Owner is served
      // because their own morning has arrived, and the dates fire
      // because they sit exactly one lead time away.
      const ran = await page.request.post("/api/v1/notifications/morning-round");
      expect(ran.status(), await ran.text()).toBe(200);
      const summary = RoundSummary.parse(await ran.json());
      expect(summary.served, "nobody's morning had arrived").toBeGreaterThan(0);

      // Mailpit's half: **one** briefing for eleven dates, not eleven
      // reminder emails (NOT-003). It names every date, points at the
      // section to act in, and carries the way to turn it down.
      const digest = await waitForMailTo(page.request, ownerEmail, /dates on your contracts$/);
      expect(digest.subject).toBe(`${EXPECTED_REMINDERS} dates on your contracts`);
      expect(digest.text).toContain(`Hello ${OWNER_NAME},`);
      expect(digest.text).toContain(`Notice deadline: ${title} (#${number})`);
      expect(digest.text).toContain(`${KEY_DATE_LABEL}: ${title} (#${number})`);
      expect(digest.text).toContain(`Expiry: ${others[0]!.title} (#${others[0]!.number})`);
      expect(digest.text).toContain(`/contracts/${number}/key-dates`);
      expect(digest.text).toContain("/settings/notifications");

      // The seam half: eleven date reminders plus one NOT-008 briefing
      // summary, none of them read yet, and the subject record carrying
      // its two reminders.
      const items = await readBell(ownerPage.request);
      expect(items).toHaveLength(EXPECTED_BELL_ITEMS);
      const reminders = items.filter((item) => item.eventType.startsWith("date."));
      expect(reminders).toHaveLength(EXPECTED_REMINDERS);
      const briefingItems = items.filter((item) => item.eventType === "briefing.ready");
      expect(briefingItems).toHaveLength(1);
      const onSubject = reminders.filter((item) => item.payload.contractNumber === number);
      expect(
        onSubject.filter((item) => item.eventType === "date.notice_deadline_approaching"),
      ).toHaveLength(1);
      expect(
        onSubject.filter((item) => item.eventType === "date.key_date_approaching"),
      ).toHaveLength(1);
      expect(reminders.filter((item) => item.eventType === "date.expiry_approaching")).toHaveLength(
        EXTRA_CONTRACTS,
      );
      expect(items.every((item) => item.readAt === null)).toBe(true);
      expect(await readUnread(ownerPage.request)).toBe(EXPECTED_BELL_ITEMS);

      // ---- The badge: capped for the eye, whole for a reader ----

      await ownerPage.goto("/");
      const ownerBell = bellTrigger(ownerPage);
      // Drawn capped (NOT-005) …
      await expect(ownerBell.getByText("9+")).toBeVisible();
      // … and named uncapped, because hiding the number from a screen
      // reader would make the cap cost information rather than noise.
      await expect(ownerBell).toHaveAccessibleName(`Notifications, ${EXPECTED_BELL_ITEMS} unread`);

      // ---- Opening the centre reads what it draws ----

      await ownerBell.click();
      const centre = notificationCentre(ownerPage);
      await expect(centre).toBeVisible();
      const briefingRow = centre.getByRole("link", {
        name: /^Your daily briefing is ready/,
      });
      await expect(briefingRow).toHaveAttribute("href", "/");
      const deadlineRow = centre.getByRole("link", {
        name: `The notice deadline on ${title} is coming up`,
      });
      await expect(deadlineRow).toBeVisible();
      // One page holds all eleven, so the list is complete and DES-026's
      // foot is absent rather than disabled.
      await expect(centre.getByRole("button", { name: "Show older" })).toHaveCount(0);

      // The badge takes the server's answer, so it goes when the page is
      // read — not because the surface decremented anything.
      await expect(bellTrigger(ownerPage)).toHaveAccessibleName("Notifications, none unread", {
        timeout: 15_000,
      });
      await expect(ownerBell.getByText("9+")).toHaveCount(0);
      expect(await readUnread(ownerPage.request)).toBe(0);

      // ---- Every item is one click from the thing it is about ----

      await deadlineRow.click();
      await expect(ownerPage).toHaveURL(new RegExp(`/contracts/${number}/key-dates$`));
      await expect(ownerPage.getByRole("region", { name: "Key dates" })).toContainText(
        "Renewal notice deadline",
      );

      // ---- A second round the same morning tells nobody twice ----
      //
      // The dedup identity and the once-a-day rule are the round's own
      // (NOT-003, NOT-004), and the trigger did not weaken either.
      const twice = await page.request.post("/api/v1/notifications/morning-round");
      expect(twice.status(), await twice.text()).toBe(200);
      const second = RoundSummary.parse(await twice.json());
      expect(second.reminders).toBe(0);
      expect(second.digests).toBe(0);
      expect(await readUnread(ownerPage.request)).toBe(0);
      expect(await readBell(ownerPage.request)).toHaveLength(EXPECTED_BELL_ITEMS);
    } catch (error) {
      await sweepOrSay("M18 demo", leaveInert);
      throw error;
    }
    await leaveInert();
  });
});
