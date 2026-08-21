// SPDX-License-Identifier: AGPL-3.0-only

/**
 * M14 milestone acceptance (#236): the demo, end to end.
 *
 * Move a contract from draft through review into approval, request two
 * approvals in parallel, and watch the soft gate.
 *
 * The journey is one contract and three people. An Administrator
 * configures an approver group in Settings, makes the contract, and
 * walks it through real statuses — draft, then review, then approval —
 * with the stage pipeline's marker following every move. On the record
 * they ask two colleagues to sign it off at the same time: one named by
 * hand, one asked by applying the group. One of the two answers, from
 * their own session, and the other does not. Then the Administrator
 * sends the contract for signature, meets CTR-012's soft gate, confirms
 * it anyway, and the override lands in the record's activity feed.
 *
 * Each leg is proved twice, on the M9 to M13 specs' rule: once on what
 * the screen draws, and once on what the seam answers. The two halves
 * catch different lies here.
 *
 * - A pipeline drawn from the **status label** would follow the demo's
 *   moves perfectly and still be wrong, because a label is renameable
 *   and a stage is not (CTR-001). So the marker is read on the screen
 *   and the stage is read at the seam, and the demo deliberately walks
 *   statuses whose labels are not their stage names — "Internal review"
 *   at `review`, "Awaiting approval" at `approval`, "Out for signature"
 *   at `signature`.
 * - A client-side gate would raise the same dialog and prove nothing,
 *   because the refusal has to be the server's for every API client
 *   (CTR-012). So the 409 is caught on the wire, its RFC 9457 `type` is
 *   asserted, and the retry is asserted to carry `overrideSoftGate`.
 * - A roster drawn from what the browser just sent would draw two rows
 *   and know nothing, so the roster is read back from the seam and the
 *   sources on it — one `manual`, one `group` — are what say the two
 *   asks came through two different doors.
 *
 * **Why the soft gate's problem type is written out here.** TECH-020
 * makes `urn:openlaw:problem:approval-soft-gate` a wire contract, and
 * both ends already import it from `@openlaw/shared`. A spec that
 * imported the same constant would agree with itself whatever the
 * string became; written out, it is the third party that notices —
 * which is the whole point when TECH-020 calls changing a type a
 * breaking change. This is the general rule now, not a local licence:
 * a test that **reads** the type off the wire writes it out, and a
 * test that **authors** the value imports it (TECH-020's #391
 * addendum).
 *
 * **The cast, and why it is three people.** The Administrator asks, and
 * neither approver is the Administrator: with one approver the person
 * who overrides the gate would be the person whose sign-off it went
 * past, and the feed's own sentence would name the actor twice.
 * CTR-012 allows exactly that in a small team, but it makes a poor
 * proof — "went past X" is only readable as an assertion when X is
 * somebody else. So the demo onboards two Legal Team Members through
 * the invite flow: one is asked by hand and never answers, and one is
 * asked by the applied group and approves from their own browser
 * session. That second session is also what proves the decision rule on
 * screen: an approver is offered a menu on their own ask and none on
 * anybody else's.
 *
 * **What this does not prove**, because it has API coverage of its own
 * and no screen of its own: the group snapshot surviving a later edit
 * (#234), the refusals around who may be asked (#233), and the four
 * moves that do **not** cross the approval line (#235). The demo walks
 * the sentence the milestone is written about.
 *
 * The never-reset instance (TECH-018) is left as the run found it, on
 * the earlier demo specs' convention: per-run rows carry this spec's own
 * prefixes and are swept before the journey starts. A contract has no
 * hard delete and neither does an approver group, so archived is the
 * resting state of both; a decided approval is never deleted either,
 * and it goes inert with the contract that owns it.
 */

import { test, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { z } from "zod";
import {
  ADMIN,
  ensureAdminExists,
  ensureMemberInert,
  onboardActivatedMember,
  reportAxeViolations,
  signInAs,
  startsWithName,
  sweepOrSay,
  type OnboardedMember,
} from "./helpers.js";

/**
 * The journey onboards two people through the real invite flow, walks
 * one contract through four statuses, and drives three dialogs across
 * two browser contexts. Generous rather than tight: what is proved is
 * that the sentence holds, and a test timeout that fired first would
 * take the sentence away and leave a stopwatch in its place.
 */
test.setTimeout(300_000);

/** Per-run contracts carry this prefix, so a crashed earlier run's
 * leftovers can be swept before the journey starts. It is this spec's
 * own: the demo specs sweep their own rows and must not reach into each
 * other's. */
const CONTRACT_PREFIX = "E2E M14 Northwind renewal";

/** And per-run approver groups carry this one. The name is stamped per
 * run as well, because a group name is a name and an earlier run's
 * archived template still holds the one it was created with. */
const GROUP_PREFIX = "E2E M14 Commercial sign-off";

/** Every per-run person's address starts here, so a run that died
 * before its own sweep leaves nothing live behind two people of the
 * same name — which is the one leftover this journey could not read
 * past, since it names both of them on screen. */
const MEMBER_EMAIL_PREFIX = "e2e-m14-";

/** The colleague asked by hand. They never answer, so they are the
 * person the gate names and the person the override entry records
 * being gone past. */
const ASKED_NAME = "Marcus Webb";

/** The colleague the applied group asks. They approve, from their own
 * session, so their ask is the one the gate must **not** name. */
const DECIDER_NAME = "Sarah Chen";

/** What the approver says about their decision (CTR-012's optional
 * note). Written as a whole sentence so a substring search for it
 * cannot match anything else on the page. */
const DECISION_NOTE = "The cap and the indemnity read fine to me.";

/**
 * The RFC 9457 problem type CTR-012's soft gate refuses with (TECH-020),
 * written out rather than imported. See the file header.
 */
const SOFT_GATE_PROBLEM_TYPE = "urn:openlaw:problem:approval-soft-gate";

/** CTR-001's six fixed stages, as the pipeline names them on screen and
 * in canonical order. The stage's name is not the status's label: an
 * Administrator renames the second and nobody renames the first. */
const STAGE_NAMES = ["Draft", "Review", "Approval", "Signature", "Active", "Ended"] as const;

type StageName = (typeof STAGE_NAMES)[number];

/** Only what the sweep reads: the title it matches on and the reference
 * it archives by. */
const ContractRows = z.object({
  contracts: z.array(z.object({ number: z.number().int(), title: z.string() })),
});

/** One contract as the seam answers it — the two fields this demo is
 * about. `stage` is derived from the status and stored nowhere
 * (CTR-001), and it is the whole question the pipeline draws. */
const ContractEnvelope = z.object({
  contract: z.object({
    id: z.string(),
    number: z.number().int(),
    statusId: z.string(),
    statusName: z.string(),
    stage: z.string(),
  }),
});

/** What the record's pickers read: the type the contract is born on,
 * the statuses it moves through, and the live approver groups the apply
 * affordance offers (CTR-012). */
const ContractOptions = z.object({
  contractTypes: z.array(
    z.object({
      displayName: z.string(),
      fields: z.array(z.object({ isRequired: z.boolean() })),
    }),
  ),
  contractStatuses: z.array(
    z.object({ id: z.string(), slug: z.string(), displayName: z.string(), stage: z.string() }),
  ),
  approverGroups: z.array(
    z.object({ id: z.string(), name: z.string(), memberIds: z.array(z.string()) }),
  ),
});

type StatusOption = z.infer<typeof ContractOptions>["contractStatuses"][number];

/** One ask on a record, as the roster route answers it. */
const ApprovalRows = z.object({
  approvals: z.array(
    z.object({
      id: z.string(),
      approver: z.object({ id: z.string(), displayName: z.string() }),
      requestedBy: z.object({ id: z.string(), displayName: z.string() }),
      source: z.enum(["manual", "group"]),
      groupName: z.string().nullable(),
      status: z.enum(["pending", "approved", "rejected"]),
      note: z.string().nullable(),
      requestedAt: z.string(),
      decidedAt: z.string().nullable(),
    }),
  ),
});

type ApprovalRow = z.infer<typeof ApprovalRows>["approvals"][number];

/** The Administrator-only template list, as the sweep and the group leg
 * read it. */
const ApproverGroupRows = z.object({
  approverGroups: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      archivedAt: z.string().nullable(),
      members: z.array(z.object({ id: z.string(), displayName: z.string() })),
      memberCount: z.number().int(),
    }),
  ),
});

/** The record's own feed (DD-017), read at the seam beside the panel
 * that draws it. */
const ActivityEntries = z.object({
  entries: z.array(
    z.object({
      action: z.string(),
      visibility: z.string(),
      payload: z.record(z.string(), z.unknown()),
    }),
  ),
});

type ActivityEntry = z.infer<typeof ActivityEntries>["entries"][number];

/** The RFC 9457 problem the seam refuses with. `type` is the field
 * TECH-020 added, and the field the web client branches on. */
const Problem = z.object({ type: z.string(), detail: z.string() });

async function listContracts(request: APIRequestContext) {
  const listed = await request.get("/api/v1/contracts");
  expect(listed.ok()).toBe(true);
  return ContractRows.parse(await listed.json()).contracts;
}

/** Archives every live per-run contract — the resting state a contract
 * has (TECH-018 cleanup; there is no hard delete). Its approvals go
 * inert with it: a decided ask is never deleted, and the record it
 * hangs on is out of the list. */
async function ensureDemoContractsInert(request: APIRequestContext) {
  for (const row of (await listContracts(request)).filter((contract) =>
    contract.title.startsWith(CONTRACT_PREFIX),
  )) {
    const archived = await request.post(`/api/v1/contracts/${row.number}/archive`);
    expect(archived.status(), await archived.text()).toBe(200);
  }
}

/** Archives every live per-run approver group. A group has no hard
 * delete either, and archiving is exactly what takes it out of the
 * apply picker without touching a request it already made (CTR-012). */
async function ensureDemoGroupsInert(request: APIRequestContext) {
  const listed = await request.get("/api/v1/approver-groups?includeArchived=true");
  expect(listed.status(), await listed.text()).toBe(200);
  for (const group of ApproverGroupRows.parse(await listed.json()).approverGroups.filter(
    (row) => row.name.startsWith(GROUP_PREFIX) && row.archivedAt === null,
  )) {
    const archived = await request.post(`/api/v1/approver-groups/${group.id}/archive`);
    expect(archived.status(), await archived.text()).toBe(200);
  }
}

/**
 * Leaves every per-run person of this spec inert, whatever run made
 * them.
 *
 * Wider than the two addresses this run creates on purpose. The journey
 * names both approvers on screen, so two live people of one name would
 * make the roster unreadable — and a run that died before its own sweep
 * is exactly how that happens.
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
 * by stage is what lets the assertions below say the marker followed
 * the stage and not the label.
 */
function statusAt(options: z.infer<typeof ContractOptions>, stage: string): StatusOption {
  const found = options.contractStatuses.find((status) => status.stage === stage);
  expect(found, `no live contract status sits at the ${stage} stage`).toBeDefined();
  return found!;
}

/** One person's id by email, read from the Administrator-only user list
 * — the id every approver route is addressed by. */
async function userIdOf(request: APIRequestContext, email: string): Promise<string> {
  const listed = await request.get("/api/v1/users");
  expect(listed.status(), await listed.text()).toBe(200);
  const found = z
    .object({ users: z.array(z.object({ id: z.string(), email: z.string() })) })
    .parse(await listed.json())
    .users.find((user) => user.email === email);
  expect(found, `no user is registered under ${email}`).toBeDefined();
  return found!.id;
}

/** One contract as the seam answers it, by its CTR-003 number. */
async function readContract(request: APIRequestContext, number: number) {
  const read = await request.get(`/api/v1/contracts/${number}`);
  expect(read.status(), await read.text()).toBe(200);
  return ContractEnvelope.parse(await read.json()).contract;
}

/** One contract's whole roster, oldest ask first, as the record's
 * Approvals section draws it. */
async function readApprovals(
  request: APIRequestContext,
  number: number,
): Promise<readonly ApprovalRow[]> {
  const listed = await request.get(`/api/v1/contracts/${number}/approvals`);
  expect(listed.status(), await listed.text()).toBe(200);
  return ApprovalRows.parse(await listed.json()).approvals;
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

/** A seed contract type that demands no field, named as the create
 * dialog names it. The demo is about stages and sign-off, not about the
 * field catalog. */
function bareContractTypeName(options: z.infer<typeof ContractOptions>): string {
  const bare = options.contractTypes.find((type) =>
    type.fields.every((field) => !field.isRequired),
  );
  expect(bare, "no contract type without a hard-required field is configured").toBeDefined();
  return bare!.displayName;
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

/** CTR-001's six-stage backbone on the record's sub-bar (DES-034). */
function pipeline(page: Page): Locator {
  return page.getByRole("list", { name: "Stage" });
}

/** One stage's place in the strip. Matched on the name it starts with,
 * because a stage behind the marker carries a screen-reader "done"
 * after it. */
function stageStep(page: Page, stage: StageName): Locator {
  return pipeline(page)
    .getByRole("listitem")
    .filter({ hasText: new RegExp(`^${stage}\\b`) });
}

/**
 * The whole pipeline, read as one statement: the marker on the stage
 * the contract sits at, a "done" on every stage behind it, and neither
 * on any stage ahead.
 *
 * Read whole rather than one step at a time because the property is
 * about the strip and not about a step. It renders **position, not
 * progress** (CTR-001, DES-034): a stage carries its check because it
 * is behind the marker now, so a regression would have to take those
 * checks away again — and only an assertion over all six stages would
 * notice if it did not.
 */
async function expectPipelineAt(page: Page, stage: StageName): Promise<void> {
  const position = STAGE_NAMES.indexOf(stage);
  for (const [index, step] of STAGE_NAMES.entries()) {
    const item = stageStep(page, step);
    // The step is there before anything is said about it. Every
    // statement below is a negative for five stages out of six, and a
    // negative about an element that is not on the page is a statement
    // that passes without meaning anything.
    await expect(item, `the pipeline draws no ${step} step`).toHaveCount(1);
    if (index === position) {
      await expect(item, `the marker is not on ${step}`).toHaveAttribute("aria-current", "step");
      await expect(item).not.toContainText("done");
    } else {
      await expect(item, `${step} is marked as the current stage`).not.toHaveAttribute(
        "aria-current",
        "step",
      );
      if (index < position) {
        await expect(item, `${step} is behind the marker and is not marked done`).toContainText(
          "done",
        );
      } else {
        await expect(item, `${step} is ahead of the marker and is marked done`).not.toContainText(
          "done",
        );
      }
    }
  }
}

/**
 * The record's own move control (DES-053) — the current stage's pill in
 * the strip, which is the one item of the six that can be pressed.
 */
function moveControl(page: Page): Locator {
  return page.getByRole("button", { name: /move contract$/ });
}

/**
 * Which status the record holds, read from the menu rather than from
 * the sub-bar's pill.
 *
 * The pill carries no accessible name of its own, and a status label
 * and a stage name are often the same word — on a contract at `draft`
 * they always are — so the pill can only be told from the strip's own
 * current-stage pill structurally. The menu's checked row says which
 * status the record holds without that ambiguity, and the pill's own
 * following of the label has web coverage of its own.
 */
/**
 * Which stage the strip is on, read while a dialog is open over it.
 *
 * An open dialog takes the page behind it out of the accessibility
 * tree, so no role query reaches the strip and the menu cannot be
 * opened at all. The trigger still carries its stage in its own label,
 * though, and a CSS locator is not filtered by `aria-hidden` — so the
 * one thing that can still be read behind a dialog is read that way.
 */
async function expectStageBehindDialog(page: Page, stage: StageName): Promise<void> {
  await expect(page.locator('button[aria-label$="move contract"]')).toHaveAttribute(
    "aria-label",
    `${stage} — move contract`,
  );
}

async function expectStatus(page: Page, status: StatusOption): Promise<void> {
  await moveControl(page).click();
  await expect(
    page
      .getByRole("menuitemradio")
      .filter({ hasText: startsWithName(status.displayName) })
      .first(),
  ).toBeChecked();
  // Back to where the leg found the page: a menu left open would sit
  // over whatever the next step reads.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
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

/**
 * Crosses from one record section to another, the way a reader does it
 * (DES-032). The strip is a nav of routed links, so the move is a click
 * and the address is the proof it landed.
 */
async function openSection(page: Page, number: number, name: string, path = ""): Promise<void> {
  await page
    .getByRole("navigation", { name: "Contract sections" })
    .getByRole("link", { name, exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/contracts/${number}${path}$`));
}

/** The Approvals section of the record (M14/3). */
function approvalsSection(page: Page): Locator {
  return page.getByRole("region", { name: "Approvals" });
}

/** One ask's row on the roster, found by the person it names. */
function approvalRow(page: Page, name: string): Locator {
  return approvalsSection(page).getByRole("row").filter({ hasText: name });
}

/**
 * Moves the contract to one status through the record's own select, and
 * answers what the seam said about it.
 *
 * The commit is caught on the wire rather than inferred from the screen,
 * because half of this demo's legs are about **what the seam answered**
 * — a 200 that moved the record, or the 409 the soft gate refuses with.
 */
async function pickStatus(page: Page, number: number, status: StatusOption) {
  const answered = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/contracts/${number}`) &&
      response.request().method() === "PATCH",
  );
  await pickFrom(page, status);
  return await answered;
}

test.describe.serial("M14 demo path", () => {
  test.beforeAll(async ({ request }) => {
    await ensureAdminExists(request);
  });

  test("walk a contract into approval, ask two people at once, and push past the soft gate", async ({
    page,
    browser,
  }, testInfo) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    // Known starting state on the never-reset instance (TECH-018): a
    // crashed earlier run may have left per-run rows behind.
    await ensureDemoContractsInert(page.request);
    await ensureDemoGroupsInert(page.request);
    await ensureDemoMembersInert(page.request);

    const stamp = Date.now();
    const title = `${CONTRACT_PREFIX} ${stamp}`;
    const groupName = `${GROUP_PREFIX} ${stamp}`;
    const askedEmail = `${MEMBER_EMAIL_PREFIX}asked-${stamp}@e2e.example`;
    const deciderEmail = `${MEMBER_EMAIL_PREFIX}decider-${stamp}@e2e.example`;
    let asked: OnboardedMember | undefined;
    let decider: OnboardedMember | undefined;

    /** Leaves the shared instance as the run found it (TECH-018): the
     * per-run contract archived, the per-run template archived, and both
     * per-run people archived. */
    const leaveInert = async () => {
      await asked?.context.close();
      await decider?.context.close();
      await ensureDemoContractsInert(page.request);
      await ensureDemoGroupsInert(page.request);
      await ensureMemberInert(page.request, askedEmail);
      await ensureMemberInert(page.request, deciderEmail);
    };

    try {
      // ---- The cast (stories 1, 6 and 8) ----

      asked = await onboardActivatedMember(page.request, browser, {
        email: askedEmail,
        displayName: ASKED_NAME,
        role: "legal_team_member",
        password: "their-own-e2e-password",
      });
      decider = await onboardActivatedMember(page.request, browser, {
        email: deciderEmail,
        displayName: DECIDER_NAME,
        role: "legal_team_member",
        password: "her-own-e2e-password",
      });
      const deciderPage = decider.page;
      const askedId = await userIdOf(page.request, askedEmail);
      const deciderId = await userIdOf(page.request, deciderEmail);

      // ---- Story 3: an Administrator configures the group, once ----
      //
      // The demo needs a template to apply, and the only place one is
      // made is Settings → Contracts → Approver groups (SET-002,
      // Admin-only). The group holds one person, because a group of one
      // is still a template: applying it is what makes the request, and
      // that is the act this leg exists to set up.

      await page.goto("/settings/contracts/approver-groups");
      await expect(
        page
          .getByRole("navigation", { name: "Contracts panes" })
          .getByRole("link", { name: "Approver groups" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Add group" }).first().click();
      const groupEditor = page.getByRole("dialog");
      await expect(
        groupEditor.getByRole("heading", { level: 2, name: "Add approver group" }),
      ).toBeVisible();
      await groupEditor.getByRole("textbox", { name: "Name" }).fill(groupName);
      await groupEditor
        .getByRole("textbox", { name: "Description" })
        .fill("Sign-off for commercial renewals.");
      await groupEditor.getByRole("checkbox", { name: new RegExp(DECIDER_NAME) }).click();
      await groupEditor.getByRole("button", { name: "Add group" }).click();
      await expect(groupEditor).toBeHidden();

      // The screen half: the template is a row with its member count.
      const groupRow = page.getByRole("button", { name: `Rename ${groupName}` });
      await expect(groupRow).toBeVisible();
      await expect(page.getByRole("listitem").filter({ has: groupRow })).toContainText("1 member");

      // The seam half: the record's own picker read answers it, live,
      // with the member it would ask. This is the read the apply dialog
      // is drawn from — the Administrator-only list is a different door.
      const withGroup = await readOptions(page.request);
      const template = withGroup.approverGroups.find((group) => group.name === groupName);
      expect(template, "the new approver group is not offered to the record").toBeDefined();
      expect(template!.memberIds).toEqual([deciderId]);

      // ---- Story 15: a contract is born at the first stage ----

      const typeName = bareContractTypeName(withGroup);
      const number = await createContract(page, title, typeName);
      await page.goto(`/contracts/${number}`);
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();

      // The screen half: six stages in canonical order, the marker on
      // the first, and nothing behind it.
      await expect(pipeline(page).getByRole("listitem")).toHaveCount(STAGE_NAMES.length);
      await expectPipelineAt(page, "Draft");
      // The one surface a stage has of its own, scanned rather than
      // reported: it is this milestone's, so a finding in it is this
      // milestone's to fix (#48, DES-011).
      expect(
        await reportAxeViolations(page, testInfo, "m14-stage-pipeline", {
          include: 'ol[aria-label="Stage"]',
        }),
      ).toEqual([]);

      // The seam half: the stage is derived and stored nowhere, and this
      // is where it is derived (CTR-001).
      const born = await readContract(page.request, number);
      expect(born.stage).toBe("draft");

      // ---- Draft → review → approval, through real statuses ----
      //
      // Each move is a status, and each status carries a stage the label
      // does not say. "Internal review" is not "Review" and "Awaiting
      // approval" is not "Approval" — so a marker that followed the
      // label beside it would land on nothing at all.

      const review = statusAt(withGroup, "review");
      const approval = statusAt(withGroup, "approval");
      const signature = statusAt(withGroup, "signature");

      const toReview = await pickStatus(page, number, review);
      expect(toReview.status(), await toReview.text()).toBe(200);
      await expectStatus(page, review);
      await expectPipelineAt(page, "Review");
      expect((await readContract(page.request, number)).stage).toBe("review");

      const toApproval = await pickStatus(page, number, approval);
      expect(toApproval.status(), await toApproval.text()).toBe(200);
      await expectStatus(page, approval);
      await expectPipelineAt(page, "Approval");
      const atApproval = await readContract(page.request, number);
      expect(atApproval.stage).toBe("approval");
      // Said out loud, because it is what makes the marker above worth
      // asserting: the label the record holds is not the name of the
      // stage the marker landed on, so nothing here followed a word.
      expect(atApproval.statusName).not.toBe("Approval");

      // ---- Stories 1, 2 and 6: two asks, in parallel, two doors ----

      await openSection(page, number, "Approvals", "/approvals");
      const section = approvalsSection(page);
      await expect(section).toContainText("No approvals requested on this contract yet.");
      expect(await readApprovals(page.request, number)).toEqual([]);

      // The named ask (story 1). Nothing about this person is on the
      // record — they are picked because somebody picked them.
      await section.getByRole("button", { name: "Add approver" }).click();
      const addDialog = page.getByRole("dialog");
      await expect(addDialog.getByText("Add approver")).toBeVisible();
      await addDialog.getByRole("checkbox", { name: ASKED_NAME }).click();
      await addDialog.getByRole("button", { name: "Request approvals" }).click();
      await expect(addDialog).toBeHidden();

      // The screen half: a row that says who was asked, who asked, and
      // where the ask came from.
      const askedRow = approvalRow(page, ASKED_NAME);
      await expect(askedRow).toContainText("Pending");
      await expect(askedRow).toContainText("Added manually");
      await expect(askedRow).toContainText(`Requested by ${ADMIN.displayName}`);

      // The applied group (stories 6 and 7). One press, and everybody
      // the template names is asked.
      await section.getByRole("button", { name: "Apply group" }).click();
      const applyDialog = page.getByRole("dialog");
      await expect(applyDialog.getByText("Apply approver group")).toBeVisible();
      await applyDialog.getByLabel("Approver group").selectOption({ label: groupName });
      // The dialog says who it would ask before it asks them, which is
      // what makes applying a set a decision rather than a surprise.
      await expect(applyDialog).toContainText(`Asks ${DECIDER_NAME}.`);
      await applyDialog.getByRole("button", { name: "Apply group" }).click();
      await expect(applyDialog).toBeHidden();

      const deciderRow = approvalRow(page, DECIDER_NAME);
      await expect(deciderRow).toContainText("Pending");
      // The Source cell names the template, which is the one thing that
      // tells the two asks apart on screen.
      await expect(deciderRow).toContainText(groupName);
      // Two open asks and no order between them (CTR-012): the header
      // counts them as one set, and nothing on the roster says who is
      // first.
      await expect(section).toContainText("2 pending");
      await expect(section.getByRole("img", { name: "2 approvals" })).toBeVisible();

      // The seam half: two rows, two sources, both pending at once and
      // neither waiting on the other. A queue would show as a second row
      // that does not exist yet.
      const bothAsked = await readApprovals(page.request, number);
      expect(bothAsked).toHaveLength(2);
      expect(
        bothAsked.map((row) => ({
          approver: row.approver.id,
          source: row.source,
          group: row.groupName,
          status: row.status,
          decided: row.decidedAt,
        })),
      ).toEqual([
        { approver: askedId, source: "manual", group: null, status: "pending", decided: null },
        {
          approver: deciderId,
          source: "group",
          group: groupName,
          status: "pending",
          decided: null,
        },
      ]);
      for (const row of bothAsked) {
        expect(row.requestedBy.displayName).toBe(ADMIN.displayName);
      }

      // The section is this milestone's own surface, so it is scanned
      // and asserted rather than reported (#48, DES-011).
      expect(
        await reportAxeViolations(page, testInfo, "m14-approvals-section", {
          include: 'section[aria-labelledby="contract-approvals-heading"]',
        }),
      ).toEqual([]);

      // ---- Stories 8 and 10: one of the two answers, from her own seat ----

      await deciderPage.goto(`/contracts/${number}/approvals`);
      await expect(approvalsSection(deciderPage)).toContainText("2 pending");
      // Only the named approver decides their own ask (CTR-012), and the
      // control is **absent** rather than disabled on anybody else's.
      await expect(
        approvalsSection(deciderPage).getByRole("button", { name: `Actions for ${ASKED_NAME}` }),
      ).toHaveCount(0);
      await approvalsSection(deciderPage)
        .getByRole("button", { name: `Actions for ${DECIDER_NAME}` })
        .click();
      await deciderPage.getByRole("menuitem", { name: "Approve" }).click();
      const decisionDialog = deciderPage.getByRole("dialog");
      await expect(decisionDialog.getByText("Approve this contract")).toBeVisible();
      // A decision is final, and the dialog says so before it is taken.
      await expect(decisionDialog).toContainText("A decision is final.");
      await decisionDialog.getByLabel("Note (optional)").fill(DECISION_NOTE);
      await decisionDialog.getByRole("button", { name: "Approve" }).click();
      await expect(decisionDialog).toBeHidden();

      // The screen half, on her own record: her ask is answered, her
      // words are on it, and the other ask is untouched.
      await expect(approvalRow(deciderPage, DECIDER_NAME)).toContainText("Approved");
      await expect(approvalRow(deciderPage, DECIDER_NAME)).toContainText(DECISION_NOTE);
      await expect(approvalRow(deciderPage, ASKED_NAME)).toContainText("Pending");
      await expect(approvalsSection(deciderPage)).toContainText("1 approved");
      await expect(approvalsSection(deciderPage)).toContainText("1 pending");

      // The seam half: one decided row with a time on it, one still
      // open, and the note stored as she wrote it.
      const afterDecision = await readApprovals(page.request, number);
      const decided = afterDecision.find((row) => row.approver.id === deciderId)!;
      expect(decided.status).toBe("approved");
      expect(decided.note).toBe(DECISION_NOTE);
      expect(decided.decidedAt).not.toBeNull();
      expect(afterDecision.find((row) => row.approver.id === askedId)!.status).toBe("pending");

      // ---- Stories 16 and 17: the soft gate ----
      //
      // The contract is sent for signature with one ask still open. The
      // gate is the seam's, and the seam is where it is proved: the
      // record's own commit is refused, and the refusal is what raises
      // the dialog.

      await page.goto(`/contracts/${number}`);
      const refused = await pickStatus(page, number, signature);
      expect(refused.status(), await refused.text()).toBe(409);
      const problem = Problem.parse(await refused.json());
      // The type is what the client branches on (TECH-020). Branching on
      // the sentence would break at the first rewording, and this
      // contract's other 409 — an archived record — reads identically to
      // anything that only looked at the status code.
      expect(problem.type).toBe(SOFT_GATE_PROBLEM_TYPE);
      // The refusal names who is unresolved and what state they are in,
      // and names nobody who answered.
      expect(problem.detail).toContain(`${ASKED_NAME} (pending)`);
      expect(problem.detail).not.toContain(DECIDER_NAME);

      // The screen half: the warning, with the same person on it and the
      // same pill the roster draws them in.
      const gate = page.getByRole("dialog");
      await expect(
        gate.getByRole("heading", { level: 2, name: "Move past approval" }),
      ).toBeVisible();
      await expect(gate).toContainText(
        `1 approval on this contract is unresolved. Moving to ${signature.displayName} goes past sign-off.`,
      );
      await expect(gate.getByRole("listitem").filter({ hasText: ASKED_NAME })).toContainText(
        "Pending",
      );
      await expect(gate.getByText(DECIDER_NAME)).toHaveCount(0);
      await expect(gate).toContainText("It is recorded on the record's activity as an override.");
      expect(
        await reportAxeViolations(page, testInfo, "m14-soft-gate-dialog", {
          include: '[role="dialog"]',
        }),
      ).toEqual([]);

      // And nothing moved. The gate warns before the fact rather than
      // after it, so the record is exactly where it was — on the screen
      // behind the dialog and at the seam.
      await expectStageBehindDialog(page, "Approval");
      expect((await readContract(page.request, number)).stage).toBe("approval");

      // The confirmation. It never blocks (CTR-012): one deliberate
      // press, and the press is what the feed records.
      const overridden = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/contracts/${number}`) &&
          response.request().method() === "PATCH",
      );
      await gate.getByRole("button", { name: "Move anyway" }).click();
      const override = await overridden;
      expect(override.status(), await override.text()).toBe(200);
      // The same commit, re-sent with the flag — which is the whole of
      // the client's part in the two-step (TECH-020).
      expect(override.request().postDataJSON()).toEqual({
        statusId: signature.id,
        overrideSoftGate: true,
      });
      await expect(gate).toBeHidden();

      // The screen half: the marker moved past approval, and approval
      // now carries its check.
      await expectStatus(page, signature);
      await expectPipelineAt(page, "Signature");
      // The seam half: the contract is at the signature stage, and the
      // ask it went past is still open — the gate skipped sign-off, it
      // did not resolve it.
      expect((await readContract(page.request, number)).stage).toBe("signature");
      expect(
        (await readApprovals(page.request, number)).find((row) => row.approver.id === askedId)!
          .status,
      ).toBe("pending");

      // ---- Stories 18 and 19: the story, in order, on the record ----

      await page
        .getByRole("toolbar", { name: "Applets" })
        .getByRole("button", { name: /^History/ })
        .click();
      const feedPanel = page.getByRole("complementary", { name: "History" });
      await expect(feedPanel).toBeVisible();
      // The screen half: the override is its own entry, and it names the
      // person it went past rather than saying only that something was
      // overridden.
      await expect(feedPanel).toContainText(
        `${ADMIN.displayName} moved this contract past approval, overriding ${ASKED_NAME}`,
      );
      // And the asks and the answer around it, each narrated as itself —
      // including which of the two came from the template.
      await expect(feedPanel).toContainText(
        `${ADMIN.displayName} asked ${ASKED_NAME} to approve this contract`,
      );
      await expect(feedPanel).toContainText(
        `${ADMIN.displayName} asked ${DECIDER_NAME} to approve this contract, from the ${groupName} group`,
      );
      await expect(feedPanel).toContainText(`${DECIDER_NAME} approved this contract`);

      // The seam half: one override entry, at the record tier, carrying
      // the stages it crossed and the person it went past.
      const feed = await readFeed(page.request, born.id);
      const overrides = feed.filter((entry) => entry.action === "contract.stage_gate_overridden");
      expect(overrides).toHaveLength(1);
      expect(overrides[0]!.visibility).toBe("working_team");
      expect(overrides[0]!.payload.fromStage).toBe("approval");
      expect(overrides[0]!.payload.toStage).toBe("signature");
      expect(overrides[0]!.payload.approvers).toEqual([
        expect.objectContaining({
          approverId: askedId,
          approverName: ASKED_NAME,
          status: "pending",
        }),
      ]);
      // The approval story is three entries of its own beside it — two
      // asks and the answer — and the override is not one of them:
      // pushing past sign-off is a different act from asking for it.
      expect(
        feed
          .filter((entry) => entry.action.startsWith("approval."))
          .map((entry) => entry.action)
          .sort(),
      ).toEqual(["approval.approved", "approval.requested", "approval.requested"]);
    } catch (error) {
      // A cleanup that throws here would replace the failure that caused
      // it, and the failure is the one worth reading. It says so out
      // loud instead.
      await sweepOrSay("M14 demo", leaveInert);
      throw error;
    }
    // The journey passed, so a cleanup that fails is a failure of its
    // own: it leaves the shared instance dirty for the next run.
    await leaveInert();
  });
});
