// SPDX-License-Identifier: AGPL-3.0-only

/**
 * M17 milestone acceptance (#304): the demo, end to end.
 *
 * Check off a task, link an amendment to its parent contract, then end
 * the contract and confirm the record is still writable.
 *
 * The journey creates two contracts under one Legal Team Member. The
 * first is the parent; the second is linked to it as an amendment. A
 * task is added to the parent and checked off (CTR-017). A typed link
 * is created between the two (CTR-015). The parent is ended (CTR-019)
 * and then written to again — editing its description — to prove the
 * record stays writable after ending. Each leg is proved twice: on
 * what the screen draws and on what the seam answers.
 *
 * The quiet half: a task toggle on the record is narrated with the
 * person who toggled it, and ending the contract is a status change
 * logged with the same actor. Nothing on the record changes without a
 * person changing it.
 *
 * The instance is left as the run found it, on the earlier demo specs'
 * convention: per-run rows carry this spec's own prefix and are swept
 * before the journey starts and after it ends.
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

/**
 * Generous timeout for the full journey: onboarding a member, creating
 * two contracts, adding and toggling a task, linking them, ending one,
 * and writing to it afterward.
 */
test.setTimeout(300_000);

/** Per-run contracts carry this prefix, so a crashed earlier run's
 * leftovers can be swept before the journey starts. */
const CONTRACT_PREFIX = "E2E M17 Highland facilities agreement";

const MEMBER_EMAIL_PREFIX = "e2e-m17-";

const MEMBER_NAME = "Jordan Fairweather";

const TASK_TITLE = "Confirm governing law clause with external counsel";

const ContractRows = z.object({
  contracts: z.array(z.object({ number: z.number().int(), title: z.string() })),
});

const ContractSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  title: z.string(),
  contractTypeId: z.string(),
  statusId: z.string(),
  statusName: z.string(),
  stage: z.string(),
  description: z.string().nullable(),
  endedAt: z.iso.datetime().nullable(),
});

type Contract = z.infer<typeof ContractSchema>;

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

const RelativeSchema = z.union([
  z.object({ restricted: z.literal(true) }),
  z.object({
    restricted: z.literal(false),
    number: z.number().int(),
    title: z.string(),
    statusName: z.string(),
    stage: z.string(),
  }),
]);

const LinkSchema = z.object({
  relationType: z.string(),
  direction: z.string(),
  contract: RelativeSchema,
});

const RelationsEnvelope = z.object({
  parentChain: z.array(RelativeSchema),
  children: z.array(RelativeSchema),
  links: z.array(LinkSchema),
});

const TasksEnvelope = z.object({
  tasks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      isDone: z.boolean(),
    }),
  ),
  doneCount: z.number().int(),
  totalCount: z.number().int(),
});

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

async function listContracts(request: APIRequestContext) {
  const listed = await request.get("/api/v1/contracts?includeEnded=true");
  expect(listed.status(), await listed.text()).toBe(200);
  return ContractRows.parse(await listed.json()).contracts;
}

/**
 * Leaves every per-run contract of this spec inert (TECH-018 cleanup).
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
 * Leaves every per-run person of this spec inert.
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

async function readOptions(request: APIRequestContext) {
  const options = await request.get("/api/v1/contracts/options");
  expect(options.status(), await options.text()).toBe(200);
  return ContractOptions.parse(await options.json());
}

function statusAt(options: z.infer<typeof ContractOptions>, stage: string): StatusOption {
  const found = options.contractStatuses.find((status) => status.stage === stage);
  expect(found, `no live contract status sits at the ${stage} stage`).toBeDefined();
  return found!;
}

function bareContractTypeName(options: z.infer<typeof ContractOptions>): string {
  const bare = options.contractTypes.find((type) =>
    type.fields.every((field) => !field.isRequired),
  );
  expect(bare, "no contract type without a hard-required field is configured").toBeDefined();
  return bare!.displayName;
}

async function readContract(request: APIRequestContext, number: number): Promise<Contract> {
  const read = await request.get(`/api/v1/contracts/${number}`);
  expect(read.status(), await read.text()).toBe(200);
  return z.object({ contract: ContractSchema }).parse(await read.json()).contract;
}

async function readRelations(request: APIRequestContext, number: number) {
  const read = await request.get(`/api/v1/contracts/${number}/relations`);
  expect(read.status(), await read.text()).toBe(200);
  return RelationsEnvelope.parse(await read.json());
}

async function readTasks(request: APIRequestContext, number: number) {
  const read = await request.get(`/api/v1/contracts/${number}/tasks`);
  expect(read.status(), await read.text()).toBe(200);
  return TasksEnvelope.parse(await read.json());
}

async function readFeed(
  request: APIRequestContext,
  contractId: string,
): Promise<readonly ActivityEntry[]> {
  const read = await request.get(`/api/v1/activity?entityType=contract&entityId=${contractId}`);
  expect(read.status(), await read.text()).toBe(200);
  return ActivityEntries.parse(await read.json()).entries;
}

function entriesOf(feed: readonly ActivityEntry[], action: string): readonly ActivityEntry[] {
  return feed.filter((entry) => entry.action === action);
}

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

async function pickFrom(page: Page, status: StatusOption): Promise<void> {
  await moveControl(page).click();
  await page
    .getByRole("menuitemradio")
    .filter({ hasText: startsWithName(status.displayName) })
    .first()
    .click();
}

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

/**
 * Crosses from one record section to another.
 */
async function openSection(page: Page, number: number, name: string, path: string): Promise<void> {
  await page
    .getByRole("navigation", { name: "Contract sections" })
    .getByRole("link", { name, exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/contracts/${number}${path}$`));
}

function tasksCard(page: Page) {
  return page.getByRole("region", { name: "Tasks" });
}

function relationsCard(page: Page) {
  return page.getByRole("region", { name: "Related contracts" });
}

test.describe("M17 demo path", () => {
  test.beforeAll(async ({ request }) => {
    await ensureAdminExists(request);
  });

  test("check off a task, link an amendment, end the contract, and write to it afterward", async ({
    page,
    browser,
  }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    // Known starting state on the never-reset instance (TECH-018).
    await ensureDemoContractsInert(page.request);
    await ensureDemoMembersInert(page.request);

    const stamp = Date.now();
    const parentTitle = `${CONTRACT_PREFIX} — parent ${stamp}`;
    const childTitle = `${CONTRACT_PREFIX} — amendment ${stamp}`;
    const memberEmail = `${MEMBER_EMAIL_PREFIX}member-${stamp}@e2e.example`;

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

      const options = await readOptions(page.request);
      const active = statusAt(options, "active");
      const ended = statusAt(options, "ended");

      // ---- Create two contracts ----

      const parentNumber = await createContract(
        memberPage,
        parentTitle,
        bareContractTypeName(options),
      );
      await memberPage.goto(`/contracts/${parentNumber}`);
      await expect(memberPage.getByRole("heading", { level: 1, name: parentTitle })).toBeVisible();
      await pickStatus(memberPage, parentNumber, active);

      const childNumber = await createContract(
        memberPage,
        childTitle,
        bareContractTypeName(options),
      );
      await memberPage.goto(`/contracts/${childNumber}`);
      await expect(memberPage.getByRole("heading", { level: 1, name: childTitle })).toBeVisible();
      await pickStatus(memberPage, childNumber, active);

      // ---- Leg 1: add a task and check it off (CTR-017) ----

      await memberPage.goto(`/contracts/${parentNumber}`);
      await openSection(memberPage, parentNumber, "Tasks", "/tasks");

      await expect(tasksCard(memberPage)).toContainText("No tasks on this contract yet.");

      const emptyTasks = await readTasks(memberPage.request, parentNumber);
      expect(emptyTasks.totalCount).toBe(0);
      expect(emptyTasks.doneCount).toBe(0);

      await tasksCard(memberPage).getByRole("button", { name: "Add task" }).click();
      const taskDialog = memberPage.getByRole("dialog");
      await taskDialog.getByLabel("Title").fill(TASK_TITLE);
      const taskAdded = memberPage.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/contracts/${parentNumber}/tasks`) &&
          response.request().method() === "POST",
      );
      await taskDialog.getByRole("button", { name: "Add task" }).click();
      expect((await taskAdded).status()).toBe(201);
      await expect(taskDialog).toBeHidden();

      await expect(tasksCard(memberPage).getByText(TASK_TITLE)).toBeVisible();
      await expect(tasksCard(memberPage).getByText("0 of 1 done")).toBeVisible();

      const withTask = await readTasks(memberPage.request, parentNumber);
      expect(withTask.totalCount).toBe(1);
      expect(withTask.doneCount).toBe(0);
      expect(withTask.tasks[0]!.title).toBe(TASK_TITLE);
      expect(withTask.tasks[0]!.isDone).toBe(false);

      const toggleCheckbox = tasksCard(memberPage).getByRole("checkbox", {
        name: new RegExp(`Complete task: ${TASK_TITLE}`),
      });
      const toggled = memberPage.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/tasks/") &&
          response.url().endsWith("/toggle") &&
          response.request().method() === "POST",
      );
      await toggleCheckbox.click();
      expect((await toggled).status()).toBe(200);

      await expect(tasksCard(memberPage).getByText("1 of 1 done")).toBeVisible();

      const completedTasks = await readTasks(memberPage.request, parentNumber);
      expect(completedTasks.doneCount).toBe(1);
      expect(completedTasks.tasks[0]!.isDone).toBe(true);

      const parentContract = await readContract(memberPage.request, parentNumber);
      const taskFeed = await readFeed(memberPage.request, parentContract.id);
      const taskCompleted = entriesOf(taskFeed, "task.completed");
      expect(taskCompleted).toHaveLength(1);
      expect(taskCompleted[0]!.actor?.displayName).toBe(MEMBER_NAME);
      expect(taskCompleted[0]!.payload.title).toBe(TASK_TITLE);

      // ---- Leg 2: link the amendment to the parent (CTR-015) ----

      await memberPage.goto(`/contracts/${childNumber}`);

      await expect(relationsCard(memberPage)).toContainText("No related contracts.");

      const emptyRelations = await readRelations(memberPage.request, childNumber);
      expect(emptyRelations.parentChain).toHaveLength(0);
      expect(emptyRelations.children).toHaveLength(0);
      expect(emptyRelations.links).toHaveLength(0);

      await relationsCard(memberPage).getByRole("button", { name: "Add link" }).click();
      const linkDialog = memberPage.getByRole("dialog");
      await expect(linkDialog).toBeVisible();
      await linkDialog.getByLabel("Link type").selectOption("amends");
      // Search for the parent by its per-run title, which names exactly
      // one live contract on the never-reset instance — a digit query
      // would title-match any leftover row whose stamp carries the same
      // digits, and the picker pages at twenty.
      await linkDialog.getByLabel("Search by number or title…").fill(parentTitle);
      const parentOption = linkDialog.getByRole("option").filter({ hasText: parentTitle });
      await expect(parentOption).toBeVisible();
      await parentOption.click();

      const linked = memberPage.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/contracts/${childNumber}/relations`) &&
          response.request().method() === "POST",
      );
      await linkDialog.getByRole("button", { name: "Link contract" }).click();
      expect((await linked).status()).toBe(201);
      await expect(linkDialog).toBeHidden();

      await expect(relationsCard(memberPage)).toContainText("Amends");
      await expect(relationsCard(memberPage)).toContainText(`C-${parentNumber}`);

      const childRelations = await readRelations(memberPage.request, childNumber);
      expect(childRelations.links).toHaveLength(1);
      expect(childRelations.links[0]!.relationType).toBe("amends");
      expect(childRelations.links[0]!.direction).toBe("outgoing");
      const linkedContract = childRelations.links[0]!.contract;
      expect(linkedContract.restricted).toBe(false);
      if (!linkedContract.restricted) {
        expect(linkedContract.number).toBe(parentNumber);
      }

      const parentRelations = await readRelations(memberPage.request, parentNumber);
      expect(parentRelations.links).toHaveLength(1);
      expect(parentRelations.links[0]!.relationType).toBe("amends");
      expect(parentRelations.links[0]!.direction).toBe("incoming");

      // The feed records the link on the child only — nothing on the
      // parent, because nothing on that record changed (CTR-015).
      const childContract = await readContract(memberPage.request, childNumber);
      const linkFeed = await readFeed(memberPage.request, childContract.id);
      const linkEntries = entriesOf(linkFeed, "contract.relation_added");
      expect(linkEntries).toHaveLength(1);
      expect(linkEntries[0]!.actor?.displayName).toBe(MEMBER_NAME);
      expect(linkEntries[0]!.payload.relationType).toBe("amends");
      expect(linkEntries[0]!.payload.relatedNumber).toBe(parentNumber);

      const parentFeedAfterLink = await readFeed(memberPage.request, parentContract.id);
      expect(entriesOf(parentFeedAfterLink, "contract.relation_added")).toHaveLength(0);

      // ---- Leg 3: end the contract (CTR-019) ----

      await memberPage.goto(`/contracts/${parentNumber}`);

      const beforeEnd = await readContract(memberPage.request, parentNumber);
      expect(beforeEnd.stage).toBe("active");
      expect(beforeEnd.endedAt).toBeNull();

      await pickStatus(memberPage, parentNumber, ended);

      const afterEnd = await readContract(memberPage.request, parentNumber);
      expect(afterEnd.stage).toBe("ended");
      expect(afterEnd.endedAt).not.toBeNull();
      expect(afterEnd.statusId).toBe(ended.id);

      // The feed records the status change with the actor. A status
      // move is narrated under its own verb (DD-017), so it is read
      // there rather than in the field-edit entries.
      const endFeed = await readFeed(memberPage.request, parentContract.id);
      const statusEntries = entriesOf(endFeed, "contract.status_changed");
      const endEntry = statusEntries.find((entry) => entry.payload.toStage === "ended");
      expect(endEntry).toBeDefined();
      expect(endEntry!.actor?.displayName).toBe(MEMBER_NAME);

      // ---- Leg 4: the record is still writable (CTR-019) ----

      await expect(memberPage.getByRole("heading", { level: 1, name: parentTitle })).toBeVisible();

      // Write to the description at the seam to prove the record accepts
      // edits after ending. CTR-019: ended is a signal, not a lock.
      const description = "Post-termination notes — record stays writable after ending.";
      const patched = await memberPage.request.patch(`/api/v1/contracts/${parentNumber}`, {
        data: { description },
      });
      expect(patched.status(), await patched.text()).toBe(200);

      const afterWrite = await readContract(memberPage.request, parentNumber);
      expect(afterWrite.description).toBe(description);
      expect(afterWrite.stage).toBe("ended");
      expect(afterWrite.endedAt).not.toBeNull();

      // The screen half: reload, and the Description card's textarea
      // holds what the seam stored — a textbox carries its value, not
      // text content, so it is read by its label.
      await memberPage.reload();
      await expect(memberPage.getByLabel("Description", { exact: true })).toHaveValue(description);

      // ---- Reopening is an ordinary status change ----

      await pickStatus(memberPage, parentNumber, active);
      const reopened = await readContract(memberPage.request, parentNumber);
      expect(reopened.stage).toBe("active");
      expect(reopened.endedAt).toBeNull();

      // ---- The quiet half: every entry names an actor ----
      //
      // Every activity entry on both records names the person who wrote
      // it. An entry with no actor would be the system asserting a
      // legal-state fact nobody asked for.
      for (const [label, id] of [
        ["the parent", parentContract.id],
        ["the child", childContract.id],
      ] as const) {
        const feed = await readFeed(memberPage.request, id);
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
      await sweepOrSay("M17 demo", leaveInert);
      throw error;
    }
    await leaveInert();
  });
});
