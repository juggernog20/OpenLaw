// SPDX-License-Identifier: AGPL-3.0-only

/**
 * M16 milestone acceptance (#288): the demo, end to end.
 *
 * Set a contract's term and notice period; the notice deadline derives
 * itself, and choosing to renew routes to the vehicle you picked.
 *
 * The journey is one Legal Team Member, one record, and the record its
 * second renewal gives birth to. They type a term on the record — the
 * kind of commitment, when it starts, when it ends, how far a roll goes,
 * and how long the notice period is — and the notice deadline appears
 * among the record's dates without anybody writing it down. They put a
 * key date beside it and the surface names the next one. They correct
 * the expiry to a date that has already gone by, and the record says
 * "renewal pending confirmation" and then waits. They confirm the roll,
 * and the term advances by their say-so. Then they renew a second time
 * by a different vehicle, and a successor is born prefilled and linked
 * back to the record it renews.
 *
 * Each leg is proved twice, on the M9 to M15 specs' rule: once on what
 * the screen draws, and once on what the seam answers. The two halves
 * catch different lies here.
 *
 * - A notice deadline the record had quietly stored would draw exactly
 *   like a derived one. So it is read at the seam as a row of the CTR-009
 *   union **with no key-date id behind it**, and then the notice period
 *   is changed and the deadline is read again: it moved, no key-date row
 *   was written, and the record narrates one field edit and no key-date
 *   act.
 * - A "next deadline" the surface picked for itself would agree with the
 *   seam on a list this short and disagree on a real one. So the mark is
 *   read at the seam — exactly one entry carries it — and on the row the
 *   screen prints it on.
 * - A pending banner drawn off a status would look identical (CTR-006's
 *   own warning). So the status id and the stage are read before and
 *   after the expiry moves and again after the roll: the record's
 *   lifecycle is untouched by all three.
 * - A successor that copied the whole predecessor would pass every
 *   assertion about a prefill and be the wrong record. So the four
 *   absences are read too — the status, the audience, the Owner, and the
 *   team — and the predecessor is read again afterwards to prove nothing
 *   was written on the far end of the link.
 *
 * **The quiet half of this demo is the half that has to be looked for.**
 * CTR-006's engine is notify-only, and in M16 that ships as structure:
 * nothing advances a date, nothing fires, and nothing runs on a
 * schedule. Three assertions carry it. The expiry is read at every leg
 * and only ever holds what a person last put there. Every activity entry
 * on both records names an **actor** — where M15's integration wrote
 * entries that name nobody, everything here traces to the person who
 * asserted it. And the mailbox of the one person the record is about
 * holds exactly what it held before the walk began: their invitation,
 * and nothing since.
 *
 * What that does **not** prove is that no scheduler exists — a walk
 * cannot outwait a job it does not know the cadence of, and a test that
 * tried would be a stopwatch pretending to be an assertion. It proves
 * the observable half: across every leg of this journey, on a stack
 * running the real worker, no date moved that a person did not move and
 * no message left the building.
 *
 * No clock is injected and none exists to inject. The derived states are
 * functions of stored dates and today, so the walk controls them by
 * writing dates on either side of now — which is also how a person
 * reaches them.
 *
 * The instance is left as the run found it, on the earlier demo specs'
 * convention: per-run rows carry this spec's own prefix and are swept
 * before the journey starts and after it ends. Nothing here has a hard
 * delete, so archived is every row's resting state.
 */

import { test, expect, type Locator, type Page } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { z } from "zod";
import {
  ADMIN,
  ensureAdminExists,
  ensureMemberInert,
  onboardActivatedMember,
  reportAxeViolations,
  signInAs,
  sweepOrSay,
  type OnboardedMember,
} from "./helpers.js";
import { mailCountTo } from "./mailpit.js";

/**
 * The walk onboards a person through the real invite flow, types five
 * term fields one commit at a time, adds a key date, confirms a roll,
 * and routes a second renewal into a record of its own. Generous rather
 * than tight: what is proved is that the sentence holds, and a test
 * timeout that fired first would take the sentence away and leave a
 * stopwatch in its place.
 */
test.setTimeout(300_000);

/** Per-run contracts carry this prefix, so a crashed earlier run's
 * leftovers can be swept before the journey starts. It is this spec's
 * own: the demo specs sweep their own rows and must not reach into each
 * other's. The successor this walk gives birth to carries it too. */
const CONTRACT_PREFIX = "E2E M16 Meridian facilities agreement";

/** Every per-run person's address starts here, so a run that died
 * before its own sweep leaves nothing live behind two people of the
 * same name. */
const MEMBER_EMAIL_PREFIX = "e2e-m16-";

/** The Legal Team Member the milestone is written for. Every write in
 * this walk is theirs, which is what makes "nothing acted on its own"
 * an assertion rather than a hope: the Administrator signs in to keep
 * the instance tidy and touches no term. */
const MEMBER_NAME = "Dana Whitfield";

/** The free-form date the team puts on the record beside its term
 * (CTR-009). A whole phrase, so a search for it on a row cannot match
 * anything else. */
const KEY_DATE_LABEL = "Price review window opens";
const KEY_DATE_NOTE = "Meridian re-prices the estate every spring.";

/** How far one confirmed roll advances the term, and how long before
 * the expiry somebody must act. The notice period is typed twice — the
 * second time to prove the deadline derives rather than sits in a
 * column. */
const RENEWAL_PERIOD_MONTHS = 12;
const FIRST_NOTICE_DAYS = 90;
const SECOND_NOTICE_DAYS = 60;

/** What the record is worth, so the prefill has a business fact to
 * carry across that is not one of the term's own (CTR-010: amount in
 * minor units, currency, cadence). */
const CONTRACT_VALUE = { amount: 4_800_000, currency: "USD", cadence: "annually" } as const;

/** Only what the sweep reads. */
const ContractRows = z.object({
  contracts: z.array(z.object({ number: z.number().int(), title: z.string() })),
});

/** One contract as the seam answers it — the term's five stored columns
 * and the four answers CTR-006 derives from them and stores nowhere. */
const ContractSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  title: z.string(),
  contractTypeId: z.string(),
  statusId: z.string(),
  statusName: z.string(),
  stage: z.string(),
  manager: z.object({ displayName: z.string() }).nullable(),
  value: z.object({ amount: z.int(), currency: z.string(), cadence: z.string() }).nullable(),
  termType: z.string(),
  effectiveDate: z.iso.date().nullable(),
  expiryDate: z.iso.date().nullable(),
  renewalPeriodMonths: z.int().nullable(),
  noticePeriodDays: z.int().nullable(),
  noticeDeadline: z.iso.date().nullable(),
  daysRemaining: z.int().nullable(),
  renewalPendingConfirmation: z.boolean(),
  proposedRenewalExpiry: z.iso.date().nullable(),
  isConfidential: z.boolean(),
});

type Contract = z.infer<typeof ContractSchema>;

/** One confirmed roll, as the record's renewal history answers it.
 * Nothing stores a renewal — this is the activity entry read back. */
const ConfirmedRenewalSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  confirmedAt: z.iso.datetime(),
  confirmedBy: z.object({ displayName: z.string() }).nullable(),
});

const ContractRecord = z.object({
  contract: ContractSchema,
  team: z.array(z.object({ displayName: z.string(), role: z.string() })),
  renewals: z.array(ConfirmedRenewalSchema),
});

/** The record's pickers: the type a contract is born on and the
 * statuses it moves through. */
const ContractOptions = z.object({
  contractTypes: z.array(
    z.object({
      displayName: z.string(),
      fields: z.array(z.object({ isRequired: z.boolean() })),
    }),
  ),
  contractStatuses: z.array(
    z.object({ id: z.string(), displayName: z.string(), stage: z.string() }),
  ),
});

type StatusOption = z.infer<typeof ContractOptions>["contractStatuses"][number];

/** CTR-009's deadline union: the key dates the team wrote down, the
 * contract's expiry, and the notice deadline the record derives — one
 * ordered list, with the earliest still ahead marked. */
const DeadlinesEnvelope = z.object({
  deadlines: z.array(
    z.object({
      source: z.enum(["notice_deadline", "expiry", "key_date"]),
      /** The row's own id on a key date, and null on the two the term
       * derives — which is the seam saying no row backs them. */
      keyDateId: z.string().nullable(),
      date: z.iso.date(),
      label: z.string().nullable(),
      note: z.string().nullable(),
      daysAway: z.int(),
      isNext: z.boolean(),
    }),
  ),
});

type Deadline = z.infer<typeof DeadlinesEnvelope>["deadlines"][number];

/** The record's own feed (DD-017), read at the seam beside the panel
 * that draws it. */
const ActivityEntries = z.object({
  entries: z.array(
    z.object({
      action: z.string(),
      visibility: z.string(),
      actor: z.object({ displayName: z.string() }).nullable(),
      payload: z.record(z.string(), z.unknown()),
    }),
  ),
});

type ActivityEntry = z.infer<typeof ActivityEntries>["entries"][number];

const DAY_MS = 86_400_000;

/**
 * The day this run counts from, fixed once when the file loads.
 *
 * UTC, because that is the zone CTR-006's arithmetic is done in: the
 * seam has no viewer to take a timezone from, so a walk that measured
 * "today" in the runner's own zone could write a date the record reads
 * as one day off.
 *
 * Fixed rather than read per call, because every date in the walk is
 * written relative to it and several are read back long after they were
 * written. A run that crossed UTC midnight between two calls would
 * measure the same day two ways, and the record would be right while
 * the expectation moved.
 */
const TODAY_UTC = (() => {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
})();

/** A civil date this many days from the run's own today. */
function dayFromToday(offset: number): string {
  return new Date(TODAY_UTC + offset * DAY_MS).toISOString().slice(0, 10);
}

/** One civil date minus a count of days, which is the notice deadline's
 * whole definition (CTR-006) — written out here so the assertion below
 * is the subtraction and not a second call to the code under test. */
function minusDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
}

/** The same civil date shifted by whole months, which is how far a
 * confirmed roll moves the term. Clamped to the target month's last day,
 * which is CTR-006's own rule for the shift — so a Feb 29 expiry plus a
 * year is Feb 28 here too, rather than a March 1 the record would
 * rightly refuse to agree with once every leap cycle. */
function plusMonths(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1 + months, day!));
  // A spill leaves the day-of-month different; day zero backs up onto
  // the target month's last day.
  if (shifted.getUTCDate() !== day) shifted.setUTCDate(0);
  return shifted.toISOString().slice(0, 10);
}

/**
 * A civil date as every surface in the app draws it (DES-014's short
 * form, through the standing `Intl` formatters): the month and the day,
 * plus the year only when it is not the one the reader is in.
 *
 * The date itself formats in UTC, because a date-only value is a day
 * rather than a moment; the "current year" comes from the runner's own
 * zone, which is the browser's, because both run on this host — and it
 * is taken once, for the reason `TODAY_UTC` is.
 */
const RUN_YEAR = new Date().getFullYear();

function shortDate(date: string): string {
  const sameYear = Number(date.slice(0, 4)) === RUN_YEAR;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

async function listContracts(request: APIRequestContext) {
  const listed = await request.get("/api/v1/contracts");
  expect(listed.status(), await listed.text()).toBe(200);
  return ContractRows.parse(await listed.json()).contracts;
}

/**
 * Leaves every per-run contract of this spec inert (TECH-018 cleanup).
 *
 * A contract has no hard delete, so archived is its resting state, and
 * its key dates and its links go inert with it. This walk puts no paper
 * on a record, so nothing here costs the volume a blob.
 */
async function ensureDemoContractsInert(request: APIRequestContext) {
  for (const row of (await listContracts(request)).filter((contract) =>
    contract.title.startsWith(CONTRACT_PREFIX),
  )) {
    const archived = await request.post(`/api/v1/contracts/${row.number}/archive`);
    expect(archived.status(), await archived.text()).toBe(200);
  }
}

/**
 * Leaves every per-run person of this spec inert, whatever run made
 * them. Wider than the address this run creates on purpose: the journey
 * names the member on screen, and two live people of one name would make
 * the record unreadable.
 */
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

/**
 * The live status this demo moves the contract to for one stage.
 *
 * Picked by **stage** rather than by name, because the name is the one
 * thing an Administrator may change (CTR-001) — and because picking it
 * by stage is what lets the assertions say the roll left the record's
 * lifecycle alone rather than that it left one label alone.
 */
function statusAt(options: z.infer<typeof ContractOptions>, stage: string): StatusOption {
  const found = options.contractStatuses.find((status) => status.stage === stage);
  expect(found, `no live contract status sits at the ${stage} stage`).toBeDefined();
  return found!;
}

/** A seed contract type that demands no field, named as the create
 * dialog names it. The demo is about the term, not about the field
 * catalog. */
function bareContractTypeName(options: z.infer<typeof ContractOptions>): string {
  const bare = options.contractTypes.find((type) =>
    type.fields.every((field) => !field.isRequired),
  );
  expect(bare, "no contract type without a hard-required field is configured").toBeDefined();
  return bare!.displayName;
}

/** One contract and its renewal history, by its CTR-003 number. */
async function readRecord(request: APIRequestContext, number: number) {
  const read = await request.get(`/api/v1/contracts/${number}`);
  expect(read.status(), await read.text()).toBe(200);
  return ContractRecord.parse(await read.json());
}

/** One contract as the seam answers it. */
async function readContract(request: APIRequestContext, number: number): Promise<Contract> {
  return (await readRecord(request, number)).contract;
}

/** One contract's whole deadline surface (CTR-009). */
async function readDeadlines(
  request: APIRequestContext,
  number: number,
): Promise<readonly Deadline[]> {
  const read = await request.get(`/api/v1/contracts/${number}/key-dates`);
  expect(read.status(), await read.text()).toBe(200);
  return DeadlinesEnvelope.parse(await read.json()).deadlines;
}

/** One record's own feed (DD-017). */
async function readFeed(
  request: APIRequestContext,
  contractId: string,
): Promise<readonly ActivityEntry[]> {
  const read = await request.get(`/api/v1/activity?entityType=contract&entityId=${contractId}`);
  expect(read.status(), await read.text()).toBe(200);
  return ActivityEntries.parse(await read.json()).entries;
}

/** Makes a contract through the create dialog and answers its reference
 * (CTR-003). */
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

/**
 * Crosses from one record section to another, the way a reader does it
 * (DES-032). The strip is a nav of routed links, so the move is a click
 * and the address is the proof it landed.
 */
async function openSection(page: Page, number: number, name: string, path: string): Promise<void> {
  await page
    .getByRole("navigation", { name: "Contract sections" })
    .getByRole("link", { name, exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/contracts/${number}${path}$`));
}

/** The record's own Status control — the renameable label, beside the
 * fixed stage the pipeline marks (CTR-001: one datum at two zooms). */
async function pickStatus(page: Page, number: number, status: StatusOption): Promise<void> {
  const answered = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/contracts/${number}`) &&
      response.request().method() === "PATCH",
  );
  await page.getByLabel("Status", { exact: true }).selectOption(status.id);
  const settled = await answered;
  expect(settled.status(), await settled.text()).toBe(200);
}

/**
 * Commits one term field on the Contract card, the way a person does it:
 * type, then leave the box (DES-017's per-field commit — Enter is the
 * keyboard's way of leaving it).
 *
 * The PATCH is waited for rather than assumed, so the next leg cannot
 * read the record before the write it depends on has landed.
 */
async function commitTerm(
  page: Page,
  number: number,
  label: string,
  value: string,
): Promise<Contract> {
  const box = page.getByLabel(label, { exact: true });
  await box.fill(value);
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/contracts/${number}`) &&
      response.request().method() === "PATCH",
  );
  await box.press("Enter");
  const answered = await saved;
  expect(answered.status(), await answered.text()).toBe(200);
  return z.object({ contract: ContractSchema }).parse(await answered.json()).contract;
}

/** The record's Term type picker, which decides which of the other four
 * term fields the record may hold at all (CTR-006). */
async function pickTermType(page: Page, number: number, termType: string): Promise<void> {
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/contracts/${number}`) &&
      response.request().method() === "PATCH",
  );
  await page.getByLabel("Term type", { exact: true }).selectOption(termType);
  const answered = await saved;
  expect(answered.status(), await answered.text()).toBe(200);
}

/** The record's Key dates section (M16/3, CTR-009). */
function keyDatesCard(page: Page): Locator {
  return page.getByRole("region", { name: "Key dates" });
}

/** The record's Term timeline card (M16/2, DES-041). */
function timelineCard(page: Page): Locator {
  return page.getByRole("region", { name: "Term timeline" });
}

/** The record's "Approvals & signing" card, which is where the Renew
 * act and the renewal history both live. */
function approvalsCard(page: Page): Locator {
  return page.getByRole("region", { name: "Approvals & signing" });
}

/** One row of the deadline surface, found by the words the surface
 * prints on it. */
function deadlineRow(page: Page, text: string | RegExp): Locator {
  return keyDatesCard(page).getByRole("row").filter({ hasText: text });
}

/**
 * The "Last renewal" fact on the Contract card (grill row G.R5), which
 * is the record's renewal history read back rather than a column.
 *
 * Found by structure rather than by role, because DES-040 clause 5 draws
 * a read-only fact as a label and a value side by side: there is no
 * control, so there is no role to ask for and no accessible name to ask
 * by. The value is the label's own next sibling — the same reach the
 * card's component tests make — and the alternative, giving the value an
 * accessible name it does not need, would be a design change made to
 * suit a selector.
 */
function lastRenewalFact(page: Page): Locator {
  return page.getByText("Last renewal", { exact: true }).locator("xpath=following-sibling::p");
}

/** One contract's entry in the record's own feed, by the verb it was
 * written under. */
function entriesOf(feed: readonly ActivityEntry[], action: string): readonly ActivityEntry[] {
  return feed.filter((entry) => entry.action === action);
}

test.describe("M16 demo path", () => {
  test.beforeAll(async ({ request }) => {
    await ensureAdminExists(request);
  });

  test("set the term, watch the notice deadline derive, confirm the roll, and route the next renewal", async ({
    page,
    browser,
  }, testInfo) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    // Known starting state on the never-reset instance (TECH-018).
    await ensureDemoContractsInert(page.request);
    await ensureDemoMembersInert(page.request);

    const stamp = Date.now();
    const title = `${CONTRACT_PREFIX} ${stamp}`;
    const successorTitle = `${CONTRACT_PREFIX} ${stamp} — 2027 renewal`;
    const memberEmail = `${MEMBER_EMAIL_PREFIX}member-${stamp}@e2e.example`;

    // The term this record is about to hold. Every date is written
    // relative to today, because the three derived states are functions
    // of the stored dates and the calendar: the walk reaches them by
    // writing dates on either side of now, which is also the only way a
    // person reaches them.
    const effective = dayFromToday(-240);
    const expiry = dayFromToday(120);
    const lapsedExpiry = dayFromToday(-10);
    const keyDate = dayFromToday(10);
    const rolledExpiry = plusMonths(lapsedExpiry, RENEWAL_PERIOD_MONTHS);

    let member: OnboardedMember | undefined;

    const leaveInert = async () => {
      await member?.context.close();
      await ensureDemoContractsInert(page.request);
      await ensureMemberInert(page.request, memberEmail);
    };

    try {
      member = await onboardActivatedMember(page.request, browser, {
        email: memberEmail,
        displayName: MEMBER_NAME,
        role: "legal_team_member",
        password: "their-own-e2e-password",
      });
      const memberPage = member.page;

      // The mailbox as the walk starts: one invitation, and nothing
      // else. M16 ships no notifier, so this number must not move again
      // however many deadlines the record grows (CTR-006, NOT-004).
      const inboxAtStart = await mailCountTo(page.request, memberEmail);
      expect(inboxAtStart).toBeGreaterThan(0);

      const options = await readOptions(page.request);
      const active = statusAt(options, "active");

      // ---- A record, live, with a value and no term at all ----

      const number = await createContract(memberPage, title, bareContractTypeName(options));
      await memberPage.goto(`/contracts/${number}`);
      await expect(memberPage.getByRole("heading", { level: 1, name: title })).toBeVisible();
      await pickStatus(memberPage, number, active);

      // What the record is worth, so the prefill at the end of the walk
      // has a business fact to carry that is not one of the term's own.
      // Set at the seam rather than through its three controls: CTR-010's
      // value is M9's surface, not this milestone's, and it is here as a
      // fact for the prefill to carry rather than as a leg of the walk.
      // What is proved about it below is what the copy did with it.
      const priced = await memberPage.request.patch(`/api/v1/contracts/${number}`, {
        data: { value: CONTRACT_VALUE },
      });
      expect(priced.status(), await priced.text()).toBe(200);

      // Story 1: a contract starts `fixed`, which is the least-asserting
      // of the three kinds and not a statement anybody made.
      const bare = await readContract(memberPage.request, number);
      expect(bare.termType).toBe("fixed");
      expect(bare.expiryDate).toBeNull();
      expect(bare.noticeDeadline).toBeNull();
      expect(bare.renewalPendingConfirmation).toBe(false);
      // A record with no term has no deadline surface either — no rows,
      // and nothing derived out of columns that hold nothing.
      expect(await readDeadlines(memberPage.request, number)).toEqual([]);

      // ---- Stories 1 to 6: the term, typed field by field ----

      await pickTermType(memberPage, number, "auto_renew");
      await commitTerm(memberPage, number, "Effective date", effective);
      await commitTerm(memberPage, number, "Expiry date", expiry);
      await commitTerm(
        memberPage,
        number,
        "Renewal period (months)",
        String(RENEWAL_PERIOD_MONTHS),
      );
      const termed = await commitTerm(
        memberPage,
        number,
        "Notice period (days)",
        String(FIRST_NOTICE_DAYS),
      );

      // The seam half: five columns hold what was typed, and the notice
      // deadline is the subtraction — computed on this read, and on
      // every read, out of two of them.
      expect(termed.termType).toBe("auto_renew");
      expect(termed.effectiveDate).toBe(effective);
      expect(termed.expiryDate).toBe(expiry);
      expect(termed.renewalPeriodMonths).toBe(RENEWAL_PERIOD_MONTHS);
      expect(termed.noticePeriodDays).toBe(FIRST_NOTICE_DAYS);
      expect(termed.noticeDeadline).toBe(minusDays(expiry, FIRST_NOTICE_DAYS));
      expect(termed.renewalPendingConfirmation).toBe(false);

      // The screen half: the same five boxes hold it after a reload —
      // which is the only way to tell a committed field from a draft the
      // page is still holding — and the two facts the card derives read
      // beside them.
      await memberPage.reload();
      await expect(memberPage.getByLabel("Effective date", { exact: true })).toHaveValue(effective);
      await expect(memberPage.getByLabel("Expiry date", { exact: true })).toHaveValue(expiry);
      await expect(memberPage.getByLabel("Renewal period (months)", { exact: true })).toHaveValue(
        String(RENEWAL_PERIOD_MONTHS),
      );
      await expect(memberPage.getByLabel("Notice period (days)", { exact: true })).toHaveValue(
        String(FIRST_NOTICE_DAYS),
      );
      // Story 7: days remaining. The count is the seam's and the card
      // draws its copy of it, so the expectation is built from the
      // answer rather than from a second subtraction the surface could
      // disagree with — and the surface would be the one that drifted.
      expect(termed.daysRemaining).toBeGreaterThan(0);
      await expect(memberPage.getByText(`${termed.daysRemaining} days left`)).toBeVisible();
      // Nothing has rolled, so the record says so with the same em dash
      // every other absence on this card prints.
      await expect(lastRenewalFact(memberPage)).toHaveText("—");

      // Story 8: the term as a picture — the periods, the today line,
      // and the derived notice-deadline marker (DES-041).
      const timeline = timelineCard(memberPage);
      await expect(timeline.getByRole("list", { name: "Term periods" })).toBeVisible();
      await expect(timeline.getByText("Today")).toBeVisible();
      await expect(
        timeline.getByText(`Notice deadline ${shortDate(termed.noticeDeadline!)}`),
      ).toBeVisible();

      // ---- Story 6: the deadline joins the record's dates ----
      //
      // The screen half: the notice deadline is drawn as a row of the
      // deadline surface, named by the record in its own copy, and it is
      // the next date on this contract.
      await openSection(memberPage, number, "Key dates", "/key-dates");
      const noticeRow = deadlineRow(memberPage, "Renewal notice deadline");
      await expect(noticeRow).toHaveCount(1);
      await expect(noticeRow).toContainText(
        `Renewal notice deadline — ${FIRST_NOTICE_DAYS} days before expiry`,
      );
      await expect(noticeRow).toContainText(shortDate(termed.noticeDeadline!));
      await expect(noticeRow).toContainText("Derived");
      await expect(noticeRow).toContainText("Next deadline");
      await expect(deadlineRow(memberPage, "Current term expires")).toHaveCount(1);
      // The surface is this milestone's own, so it is scanned and
      // asserted rather than reported (#48, DES-011).
      expect(
        await reportAxeViolations(memberPage, testInfo, "m16-key-dates", {
          include: 'section[aria-labelledby="contract-key-dates-heading"]',
        }),
      ).toEqual([]);

      // The seam half: two entries, both from the term, and **neither
      // has a row behind it**. A stored deadline would carry a key-date
      // id here, and the surface would look exactly the same.
      const derived = await readDeadlines(memberPage.request, number);
      expect(derived.map((entry) => entry.source)).toEqual(["notice_deadline", "expiry"]);
      expect(derived.every((entry) => entry.keyDateId === null)).toBe(true);
      expect(derived[0]!.date).toBe(minusDays(expiry, FIRST_NOTICE_DAYS));
      expect(derived[0]!.isNext).toBe(true);
      expect(derived[1]!.date).toBe(expiry);

      // ---- "Never stored", proved by moving the thing it derives from ----
      //
      // One field edit, and the deadline is somewhere else. Nothing was
      // written that names it: the union still holds no key-date row,
      // and the record narrates the notice period changing and no
      // key-date act at all.
      await openSection(memberPage, number, "Overview", "");
      const renoticed = await commitTerm(
        memberPage,
        number,
        "Notice period (days)",
        String(SECOND_NOTICE_DAYS),
      );
      expect(renoticed.noticeDeadline).toBe(minusDays(expiry, SECOND_NOTICE_DAYS));
      const moved = await readDeadlines(memberPage.request, number);
      expect(moved.find((entry) => entry.source === "notice_deadline")!.date).toBe(
        minusDays(expiry, SECOND_NOTICE_DAYS),
      );
      expect(moved.some((entry) => entry.keyDateId !== null)).toBe(false);
      const afterTerm = await readFeed(memberPage.request, termed.id);
      expect(afterTerm.some((entry) => entry.action.startsWith("key_date."))).toBe(false);

      // And on screen, where the deadline's own sentence now counts the
      // days it was just given.
      await openSection(memberPage, number, "Key dates", "/key-dates");
      await expect(deadlineRow(memberPage, "Renewal notice deadline")).toContainText(
        `Renewal notice deadline — ${SECOND_NOTICE_DAYS} days before expiry`,
      );
      await expect(deadlineRow(memberPage, "Renewal notice deadline")).toContainText(
        shortDate(renoticed.noticeDeadline!),
      );

      // ---- Stories 9 and 11: a key date joins the union ----

      await keyDatesCard(memberPage).getByRole("button", { name: "Add date" }).click();
      const addDialog = memberPage.getByRole("dialog");
      await addDialog.getByLabel("Date").fill(keyDate);
      await addDialog.getByLabel("Event").fill(KEY_DATE_LABEL);
      await addDialog.getByLabel("Note (optional)").fill(KEY_DATE_NOTE);
      const added = memberPage.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/contracts/${number}/key-dates`) &&
          response.request().method() === "POST",
      );
      await addDialog.getByRole("button", { name: "Add date" }).click();
      expect((await added).status(), await (await added).text()).toBe(201);
      await expect(addDialog).toBeHidden();

      // The screen half: three dates in one list, the team's own row
      // told from the term's by the Source chip, and the next deadline
      // named in words rather than only in colour.
      const keyRow = deadlineRow(memberPage, KEY_DATE_LABEL);
      await expect(keyRow).toHaveCount(1);
      await expect(keyRow).toContainText(KEY_DATE_NOTE);
      await expect(keyRow).toContainText("Key date");
      await expect(keyRow).toContainText("Next deadline");
      await expect(keyDatesCard(memberPage).getByText("Next deadline")).toHaveCount(1);
      await expect(keyDatesCard(memberPage).getByRole("img", { name: "3 dates" })).toBeVisible();

      // The seam half: one union, ordered nearest-first, and exactly one
      // entry marked — and the mark moved to the date that is now
      // earliest, which is the answer the surface drew.
      const union = await readDeadlines(memberPage.request, number);
      expect(union.map((entry) => entry.source)).toEqual(["key_date", "notice_deadline", "expiry"]);
      expect(union.map((entry) => entry.date)).toEqual([
        keyDate,
        minusDays(expiry, SECOND_NOTICE_DAYS),
        expiry,
      ]);
      expect(union.filter((entry) => entry.isNext)).toHaveLength(1);
      expect(union[0]!.isNext).toBe(true);
      expect(union[0]!.label).toBe(KEY_DATE_LABEL);
      expect(union[0]!.keyDateId).not.toBeNull();
      // The gaps rather than the counts, because every count in one
      // answer is measured from one reading of the seam's own today: the
      // distance between two of them is the distance between the dates,
      // however the walk straddles UTC midnight. 50 is the key date to
      // the notice deadline, 110 is the key date to the expiry.
      expect(union[1]!.daysAway - union[0]!.daysAway).toBe(50);
      expect(union[2]!.daysAway - union[0]!.daysAway).toBe(110);
      // The count itself is the ten days the key date was written at,
      // one fewer if the run has crossed midnight since it wrote them.
      expect([9, 10]).toContain(union[0]!.daysAway);

      // ---- Story 12: the expiry that has gone by ----
      //
      // The record's real expiry was ten days ago; the person corrects
      // it, which is an ordinary field edit. What follows is not: the
      // record says the renewal is pending and then does nothing.
      await openSection(memberPage, number, "Overview", "");
      const beforeLapse = await readContract(memberPage.request, number);
      const lapsed = await commitTerm(memberPage, number, "Expiry date", lapsedExpiry);

      // The screen half: the banner appears the moment the date commits,
      // with nobody reloading and nothing else on the record moving. It
      // is chrome, so it carries no dismiss and no pill.
      const banner = memberPage.getByRole("region", { name: "Renewal pending confirmation" });
      await expect(banner).toBeVisible();
      await expect(banner).toContainText(
        "Renewal date passed — pending confirmation. The term does not advance until a human confirms.",
      );
      await expect(banner.getByRole("button", { name: "Review renewal" })).toBeVisible();
      // The count the card draws goes negative rather than blank: a
      // record whose term ran out has to be able to say so.
      expect(lapsed.daysRemaining).toBeLessThan(0);
      await expect(
        memberPage.getByText(`${-lapsed.daysRemaining!} days past expiry`),
      ).toBeVisible();

      // The seam half: a predicate over the record's own dates, and the
      // record's lifecycle untouched by it. The status is the one it was
      // put on by hand, and the stage under it has not moved either.
      expect(lapsed.renewalPendingConfirmation).toBe(true);
      expect(lapsed.statusId).toBe(beforeLapse.statusId);
      expect(lapsed.stage).toBe(beforeLapse.stage);
      expect(lapsed.expiryDate).toBe(lapsedExpiry);
      // The proposal the dialog will be seeded with, answered by the
      // record rather than worked out by the surface (DES-040 clause 4).
      expect(lapsed.proposedRenewalExpiry).toBe(rolledExpiry);

      // Nothing has advanced while all of that was read, and nothing
      // will: a second read, after the walk has been elsewhere, finds
      // the record exactly where the person left it.
      await openSection(memberPage, number, "Key dates", "/key-dates");
      await expect(deadlineRow(memberPage, "Current term expires")).toContainText("Past");
      const stillPending = await readContract(memberPage.request, number);
      expect(stillPending.expiryDate).toBe(lapsedExpiry);
      expect(stillPending.renewalPendingConfirmation).toBe(true);
      expect(stillPending.statusId).toBe(beforeLapse.statusId);

      // ---- Stories 13 and 19: the roll, confirmed by a person ----

      await memberPage.goto(`/contracts/${number}`);
      await memberPage.getByRole("button", { name: "Review renewal" }).click();
      const renewDialog = memberPage.getByRole("dialog");
      await expect(
        renewDialog.getByText(
          `C-${number} auto-renews in ${RENEWAL_PERIOD_MONTHS}-month periods. Choose how to record the new term.`,
        ),
      ).toBeVisible();
      // CTR-007's vehicles, as far as this record can take them. The
      // amendment is **absent** rather than disabled: the record has no
      // instrument, and a chain that does not exist has nothing to
      // append (DES-035 clause 9).
      await expect(renewDialog.getByRole("radio")).toHaveCount(3);
      await expect(renewDialog.getByRole("radio", { name: /Confirm the roll/ })).toBeChecked();
      await expect(renewDialog.getByRole("radio", { name: /Paper as amendment/ })).toHaveCount(0);
      // The proposal is the seam's, seeded in the box, and the person
      // may put another date in before pressing.
      await expect(renewDialog.getByLabel("New expiry date")).toHaveValue(rolledExpiry);
      await expect(
        renewDialog.getByText(`The term currently runs to ${shortDate(lapsedExpiry)}.`),
      ).toBeVisible();

      const rolled = memberPage.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/contracts/${number}/renewal`) &&
          response.request().method() === "POST",
      );
      await renewDialog.getByRole("button", { name: "Confirm renewal" }).click();
      expect((await rolled).status(), await (await rolled).text()).toBe(200);
      await expect(renewDialog).toBeHidden();

      // The screen half: the banner is gone because the record no longer
      // reads as pending, and the term the card draws is the new one.
      await expect(
        memberPage.getByRole("region", { name: "Renewal pending confirmation" }),
      ).toHaveCount(0);
      await expect(memberPage.getByLabel("Expiry date", { exact: true })).toHaveValue(rolledExpiry);

      // The seam half: one date moved, and only that one. The status and
      // the stage are where the person put them, because a roll is a
      // move of one date rather than a move through the lifecycle.
      const advanced = await readRecord(memberPage.request, number);
      expect(advanced.contract.expiryDate).toBe(rolledExpiry);
      expect(advanced.contract.renewalPendingConfirmation).toBe(false);
      expect(advanced.contract.statusId).toBe(beforeLapse.statusId);
      expect(advanced.contract.stage).toBe(beforeLapse.stage);
      expect(advanced.contract.noticeDeadline).toBe(minusDays(rolledExpiry, SECOND_NOTICE_DAYS));
      // The history is the log read back, and it is the only record that
      // a renewal happened at all.
      expect(advanced.renewals).toHaveLength(1);
      expect(advanced.renewals[0]!.from).toBe(lapsedExpiry);
      expect(advanced.renewals[0]!.to).toBe(rolledExpiry);
      expect(advanced.renewals[0]!.confirmedBy?.displayName).toBe(MEMBER_NAME);

      // "Last renewal" reads out of the history rather than out of a
      // column, because nothing stores a renewal — so the day it draws
      // is checked against the day the entry itself carries, not against
      // the day this file thought it was when it loaded.
      await expect(lastRenewalFact(memberPage)).toHaveText(
        shortDate(advanced.renewals[0]!.confirmedAt.slice(0, 10)),
      );

      const confirmedEntries = entriesOf(
        await readFeed(memberPage.request, termed.id),
        "contract.renewal_confirmed",
      );
      expect(confirmedEntries).toHaveLength(1);
      expect(confirmedEntries[0]!.actor?.displayName).toBe(MEMBER_NAME);
      expect(confirmedEntries[0]!.payload.from).toBe(lapsedExpiry);
      expect(confirmedEntries[0]!.payload.to).toBe(rolledExpiry);

      // Story 19: the roll drawn as a row where the record keeps what
      // was decided about it.
      await openSection(memberPage, number, "Approvals", "/approvals");
      const renewalTable = approvalsCard(memberPage).getByRole("table", { name: "Renewals" });
      await expect(renewalTable.getByRole("row")).toHaveCount(2);
      await expect(renewalTable).toContainText(`Term advanced to ${shortDate(rolledExpiry)}`);
      await expect(renewalTable).toContainText(`From ${shortDate(lapsedExpiry)}`);
      await expect(renewalTable).toContainText(MEMBER_NAME);

      // ---- Stories 17 and 18: the second renewal, by another vehicle ----
      //
      // The Renew act is not the banner's alone: the record still
      // auto-renews and still records an expiry, so the card offers it
      // whether or not the term has lapsed.
      await approvalsCard(memberPage).getByRole("button", { name: "Renew", exact: true }).click();
      const routeDialog = memberPage.getByRole("dialog");
      await routeDialog.getByText("New successor contract").click();
      await expect(
        routeDialog.getByRole("radio", { name: /New successor contract/ }),
      ).toBeChecked();
      // The roll's own box goes with the roll: the other vehicles record
      // their new term on the record they are about to open.
      await expect(routeDialog.getByLabel("New expiry date")).toHaveCount(0);
      await routeDialog.getByRole("button", { name: "Open the successor" }).click();

      // The screen half: the create dialog, opened from the record the
      // renewal is a renewal of, saying what came across and what did
      // not before the reader can discover it on the record afterwards.
      const createDialog = memberPage.getByRole("dialog");
      await expect(
        createDialog.getByRole("heading", { name: "Create successor contract" }),
      ).toBeVisible();
      await expect(createDialog.getByText(`Prefilled from C-${number}`)).toBeVisible();
      await expect(
        createDialog.getByText(/the team, the status, and the Confidential flag/),
      ).toBeVisible();
      // The two fields the dialog draws are seeded and still editable —
      // the successor is a new deal and it gets its own name.
      await expect(createDialog.getByLabel("Title")).toHaveValue(title);
      await createDialog.getByLabel("Title").fill(successorTitle);
      const born = memberPage.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/contracts") && response.request().method() === "POST",
      );
      await createDialog.getByRole("button", { name: "Create", exact: true }).click();
      const successorNumber = z
        .object({ contract: z.object({ number: z.number().int() }) })
        .parse(await (await born).json()).contract.number;
      await expect(memberPage).toHaveURL(new RegExp(`/contracts/${successorNumber}$`));
      await expect(
        memberPage.getByRole("heading", { level: 1, name: successorTitle }),
      ).toBeVisible();

      // The screen half, on the record that was just born: it holds the
      // predecessor's term, which is what "prefilled" means here.
      await expect(memberPage.getByLabel("Effective date", { exact: true })).toHaveValue(effective);
      await expect(memberPage.getByLabel("Expiry date", { exact: true })).toHaveValue(rolledExpiry);
      await expect(memberPage.getByLabel("Renewal period (months)", { exact: true })).toHaveValue(
        String(RENEWAL_PERIOD_MONTHS),
      );
      await expect(memberPage.getByLabel("Notice period (days)", { exact: true })).toHaveValue(
        String(SECOND_NOTICE_DAYS),
      );

      // The seam half: the deal came across and the record did not.
      const successor = await readRecord(memberPage.request, successorNumber);
      expect(successor.contract.termType).toBe("auto_renew");
      expect(successor.contract.effectiveDate).toBe(effective);
      expect(successor.contract.expiryDate).toBe(rolledExpiry);
      expect(successor.contract.renewalPeriodMonths).toBe(RENEWAL_PERIOD_MONTHS);
      expect(successor.contract.noticePeriodDays).toBe(SECOND_NOTICE_DAYS);
      expect(successor.contract.noticeDeadline).toBe(minusDays(rolledExpiry, SECOND_NOTICE_DAYS));
      expect(successor.contract.value).toEqual({ ...CONTRACT_VALUE });
      expect(successor.contract.contractTypeId).toBe(advanced.contract.contractTypeId);
      // The four absences, which are the point of the list: a successor
      // is born a draft, unassigned, unwalled, and on nobody's team but
      // its creator's (CTR-015's no-inheritance stance, applied at
      // birth).
      expect(successor.contract.statusId).not.toBe(advanced.contract.statusId);
      expect(successor.contract.stage).toBe("draft");
      expect(successor.contract.manager).toBeNull();
      expect(successor.contract.isConfidential).toBe(false);
      expect(successor.team).toHaveLength(1);
      expect(successor.team[0]!.displayName).toBe(MEMBER_NAME);
      // And it has renewed nothing itself: the history it draws is its
      // own, and it is empty.
      expect(successor.renewals).toEqual([]);

      // The link, at the seam that answers for it in M16: the write is
      // narrated on the record that changed, and the far end says which
      // record it points at. The relations panel is M17's.
      const successorFeed = await readFeed(memberPage.request, successor.contract.id);
      const linked = entriesOf(successorFeed, "contract.relation_added");
      expect(linked).toHaveLength(1);
      expect(linked[0]!.payload.relationType).toBe("renews");
      expect(linked[0]!.payload.relatedNumber).toBe(number);
      expect(linked[0]!.actor?.displayName).toBe(MEMBER_NAME);
      expect(entriesOf(successorFeed, "contract.parent_set")).toHaveLength(0);

      // Nothing was written on the predecessor: no-cascade is not only
      // about status and confidentiality, and a feed entry on a record
      // nobody touched would be the log asserting an edit that never
      // happened.
      const predecessorFeed = await readFeed(memberPage.request, termed.id);
      expect(entriesOf(predecessorFeed, "contract.relation_added")).toHaveLength(0);
      expect(entriesOf(predecessorFeed, "contract.parent_set")).toHaveLength(0);
      expect((await readContract(memberPage.request, number)).expiryDate).toBe(rolledExpiry);

      // The screen half of the link: the record tells its own story, in
      // order, in the panel that draws the feed.
      await memberPage
        .getByRole("toolbar", { name: "Applets" })
        .getByRole("button", { name: /^History/ })
        .click();
      const feedPanel = memberPage.getByRole("complementary", { name: "History" });
      await expect(feedPanel).toBeVisible();
      await expect(feedPanel).toContainText(
        `${MEMBER_NAME} linked this contract — it renews C-${number} (${title})`,
      );

      // ---- The quiet half: nothing fired, and nothing acted ----
      //
      // The engine is notify-only, and M16 ships no notifier: the person
      // the record is about has had nothing but their invitation for the
      // whole walk, however many deadlines the record grew.
      expect(await mailCountTo(page.request, memberEmail)).toBe(inboxAtStart);

      // And every entry on both records names the person who wrote it.
      // M15's integration filed paper and moved a status under entries
      // that name nobody; nothing in this milestone's surface may. An
      // entry with no actor here would be software having asserted a
      // legal-state fact (story 22).
      for (const [label, feed] of [
        ["the predecessor", predecessorFeed],
        ["the successor", successorFeed],
      ] as const) {
        expect(feed.length, `${label} narrates nothing`).toBeGreaterThan(0);
        for (const entry of feed) {
          expect(
            entry.actor,
            `${label} holds a ${entry.action} entry that names nobody`,
          ).not.toBeNull();
          expect(entry.visibility).toBe("working_team");
        }
      }
    } catch (error) {
      // A cleanup that throws here would replace the failure that caused
      // it, and the failure is the one worth reading.
      await sweepOrSay("M16 demo", leaveInert);
      throw error;
    }
    await leaveInert();
  });
});
