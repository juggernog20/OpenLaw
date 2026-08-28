// SPDX-License-Identifier: AGPL-3.0-only

/** M23 close (#496): one real Matter, worked through every M23 surface. */

import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { z } from "zod";
import {
  ADMIN,
  ensureAdminExists,
  ensureMemberInert,
  onboardActivatedMember,
  signInAs,
  sweepOrSay,
} from "./helpers.js";

test.setTimeout(240_000);

const RUN = Date.now();
const MATTER_TITLE = `E2E M23 acquisition ${RUN}`;
const CHILD_TITLE = `E2E M23 diligence ${RUN}`;
const CONTRACT_TITLE = `E2E M23 services agreement ${RUN}`;
const FIELD_NAME = `Business context ${RUN}`;
const FIELD_VALUE = "External counsel supplied the diligence context.";
const KEY_DATE = `E2E M23 filing ${RUN}`;
const TASK = `E2E M23 review disclosure ${RUN}`;
const DOCUMENT = `e2e-m23-support-${RUN}.txt`;
const POST_CLOSE_COMMENT = `E2E M23 post-close note ${RUN}`;
const COUNSEL = {
  email: `external-counsel-${RUN}@example.com`,
  displayName: `External Counsel ${RUN}`,
  role: "contributor",
  password: "correct-horse-battery",
};

const TypeRows = z.object({
  contractTypes: z.array(z.object({ id: z.string(), archivedAt: z.string().nullable() })),
});
const CreatedType = z.object({ matterType: z.object({ id: z.string() }) });
const MatterTypeRows = z.object({
  matterTypes: z.array(z.object({ id: z.string(), archivedAt: z.string().nullable() })),
});
const CreatedField = z.object({ field: z.object({ id: z.string(), slug: z.string() }) });
const CreatedContract = z.object({ contract: z.object({ number: z.number().int() }) });
const CreatedMatter = z.object({ matter: z.object({ id: z.string(), number: z.number().int() }) });
const MatterRows = z.object({
  matters: z.array(
    z.object({ number: z.number().int(), title: z.string(), archivedAt: z.string().nullable() }),
  ),
});

async function openComments(page: Page): Promise<Locator> {
  await page
    .getByRole("toolbar", { name: "Applets" })
    .getByRole("button", { name: /^Comments/ })
    .click();
  const panel = page.getByRole("complementary", { name: "Comments" });
  await expect(panel).toBeVisible();
  return panel;
}

test.describe.serial("M23 deployer journey", () => {
  test.beforeAll(async ({ request }) => ensureAdminExists(request));

  test("links, collaborates, closes, and keeps working on one coherent Matter", async ({
    page,
    browser,
  }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    const contractTypesRead = await page.request.get("/api/v1/contract-types?includeArchived=true");
    expect(contractTypesRead.status(), await contractTypesRead.text()).toBe(200);
    const contractType = TypeRows.parse(await contractTypesRead.json()).contractTypes.find(
      (row) => row.archivedAt === null,
    );
    expect(contractType, "the install has no live Contract Type").toBeDefined();

    const matterTypesRead = await page.request.get("/api/v1/matter-types?includeArchived=true");
    expect(matterTypesRead.status(), await matterTypesRead.text()).toBe(200);
    const replacementMatterType = MatterTypeRows.parse(
      await matterTypesRead.json(),
    ).matterTypes.find((row) => row.archivedAt === null);
    expect(replacementMatterType, "the install has no live Matter Type").toBeDefined();

    const matterTypeResponse = await page.request.post("/api/v1/matter-types", {
      data: { displayName: `E2E M23 work ${RUN}` },
    });
    expect(matterTypeResponse.status(), await matterTypeResponse.text()).toBe(201);
    const matterTypeId = CreatedType.parse(await matterTypeResponse.json()).matterType.id;

    const fieldResponse = await page.request.post("/api/v1/fields", {
      data: {
        displayName: FIELD_NAME,
        moduleScope: "matter",
        fieldType: "text",
        fieldTag: "business",
      },
    });
    expect(fieldResponse.status(), await fieldResponse.text()).toBe(201);
    const field = CreatedField.parse(await fieldResponse.json()).field;
    const attached = await page.request.post(`/api/v1/matter-types/${matterTypeId}/fields`, {
      data: { fieldId: field.id, isRequired: false },
    });
    expect(attached.status(), await attached.text()).toBe(201);

    const contractResponse = await page.request.post("/api/v1/contracts", {
      data: { title: CONTRACT_TITLE, contractTypeId: contractType!.id },
    });
    expect(contractResponse.status(), await contractResponse.text()).toBe(201);
    const contractNumber = CreatedContract.parse(await contractResponse.json()).contract.number;

    const matterResponse = await page.request.post("/api/v1/matters", {
      data: { title: MATTER_TITLE, matterTypeId },
    });
    expect(matterResponse.status(), await matterResponse.text()).toBe(201);
    const matter = CreatedMatter.parse(await matterResponse.json()).matter;

    let counselContext: BrowserContext | undefined;
    let childNumber: number | undefined;
    const cleanup = async () => {
      const failures: unknown[] = [];
      const settle = async (step: () => Promise<void>) =>
        step().catch((error) => failures.push(error));
      await settle(async () => counselContext?.close());
      await settle(async () => {
        const listed = await page.request.get(
          "/api/v1/matters?includeClosed=true&includeArchived=true",
        );
        expect(listed.status(), await listed.text()).toBe(200);
        const owned = MatterRows.parse(await listed.json()).matters.filter(
          (row) =>
            row.archivedAt === null && (row.number === matter.number || row.number === childNumber),
        );
        for (const row of owned) {
          const archived = await page.request.post(`/api/v1/matters/${row.number}/archive`);
          expect(archived.status(), await archived.text()).toBe(200);
        }
      });
      await settle(async () => {
        const archived = await page.request.post(`/api/v1/contracts/${contractNumber}/archive`);
        expect([200, 409]).toContain(archived.status());
      });
      await settle(() => ensureMemberInert(page.request, COUNSEL.email));
      await settle(async () => {
        const archived = await page.request.post(`/api/v1/fields/${field.id}/archive`);
        expect(archived.status(), await archived.text()).toBe(200);
      });
      await settle(async () => {
        const archived = await page.request.post(`/api/v1/matter-types/${matterTypeId}/archive`, {
          data: { reassignToId: replacementMatterType!.id },
        });
        expect(archived.status(), await archived.text()).toBe(200);
      });
      if (failures.length > 0) throw new AggregateError(failures, "M23 demo cleanup failed");
    };

    let journeyError: unknown;
    try {
      const main = page.locator("main");
      await page.goto(`/matters/${matter.number}`);
      await expect(page.getByRole("region", { name: MATTER_TITLE })).toBeVisible();

      await main.getByRole("button", { name: "Link Contract" }).click();
      const link = page.getByRole("dialog", { name: "Link Contract" });
      await link.getByLabel("Search by number or title").fill(CONTRACT_TITLE);
      await link.getByRole("button", { name: new RegExp(CONTRACT_TITLE) }).click();
      const linked = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/contracts/${contractNumber}/matter`) &&
          response.request().method() === "POST",
      );
      await link.getByRole("button", { name: "Link", exact: true }).click();
      expect((await linked).status()).toBe(201);
      await expect(main.getByRole("link", { name: new RegExp(CONTRACT_TITLE) })).toBeVisible();

      await main.getByRole("button", { name: "New sub-Matter" }).click({ timeout: 5_000 });
      const child = page.getByRole("dialog");
      await child.getByLabel("Title").fill(CHILD_TITLE);
      await child.getByLabel("Matter type").selectOption(matterTypeId);
      const childCreated = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/matters") && response.request().method() === "POST",
      );
      await child.getByRole("button", { name: "Create" }).click();
      const childResponse = await childCreated;
      expect(childResponse.status()).toBe(201);
      childNumber = CreatedMatter.parse(await childResponse.json()).matter.number;
      await expect(page).toHaveURL(new RegExp(`/matters/${childNumber}$`));
      await expect(page.getByRole("region", { name: CHILD_TITLE })).toBeVisible();
      await page.goto(`/matters/${matter.number}`);
      await expect(
        main.getByRole("link", { name: `M-${childNumber} ${CHILD_TITLE}` }),
      ).toBeVisible();

      await page
        .getByRole("navigation", { name: "Matter sections" })
        .getByRole("link", { name: "Key dates" })
        .click();
      await main.getByRole("button", { name: "Add date" }).click();
      const dateDialog = page.getByRole("dialog", { name: "Add a Key date" });
      const date = new Date();
      date.setUTCDate(date.getUTCDate() + 30);
      await dateDialog.getByLabel("Date").fill(date.toISOString().slice(0, 10));
      await dateDialog.getByLabel("Event").fill(KEY_DATE);
      await dateDialog.getByRole("button", { name: "Add date" }).click();
      await expect(main.getByText(KEY_DATE)).toBeVisible();

      await page
        .getByRole("navigation", { name: "Matter sections" })
        .getByRole("link", { name: "Tasks" })
        .click();
      await main.getByRole("button", { name: "Add Task" }).click();
      const taskDialog = page.getByRole("dialog", { name: "Add a Task" });
      await taskDialog.getByLabel("Title").fill(TASK);
      await taskDialog.getByRole("button", { name: "Add Task" }).click();
      await expect(main.getByText(TASK)).toBeVisible();

      const counsel = await onboardActivatedMember(page.request, browser, COUNSEL);
      counselContext = counsel.context;
      await page.goto(`/matters/${matter.number}`);
      await main.getByRole("button", { name: "Add team member" }).click();
      const team = page.getByRole("dialog", { name: "Add team member" });
      await team.getByLabel("Person").selectOption({ label: COUNSEL.displayName });
      await team.getByLabel("Role").selectOption("contributor");
      await team.getByRole("button", { name: "Add to team" }).click();
      await expect(main.getByText(COUNSEL.displayName)).toBeVisible();

      const contributor = counsel.page;
      await contributor.goto(`/matters/${matter.number}`);
      const businessField = contributor.getByLabel(new RegExp(FIELD_NAME));
      await businessField.fill(FIELD_VALUE);
      const fieldSaved = contributor.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/matters/${matter.number}`) &&
          response.request().method() === "PATCH",
      );
      await businessField.press("Tab");
      expect((await fieldSaved).status()).toBe(200);

      await contributor
        .getByRole("navigation", { name: "Matter sections" })
        .getByRole("link", { name: "Documents" })
        .click();
      await contributor.getByRole("button", { name: "Upload" }).click();
      const upload = contributor.getByRole("dialog", { name: "Upload document" });
      await upload.getByRole("button", { name: "File", exact: true }).setInputFiles({
        name: DOCUMENT,
        mimeType: "text/plain",
        buffer: Buffer.from("Supporting diligence supplied by external counsel.\n"),
      });
      const uploaded = contributor.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/matters/${matter.number}/documents`) &&
          response.request().method() === "POST",
      );
      await upload.getByRole("button", { name: "Upload", exact: true }).click();
      expect((await uploaded).status()).toBe(201);
      await expect(contributor.getByText(DOCUMENT)).toBeVisible();

      await contributor.goto(`/matters/${matter.number}`);
      // Anchor on the rendered record first: the absence assertions
      // below would pass vacuously against a page that has not painted.
      await expect(contributor.getByRole("region", { name: MATTER_TITLE })).toBeVisible();
      await expect(contributor.getByRole("button", { name: "Close matter" })).toHaveCount(0);
      await expect(contributor.getByRole("button", { name: "New sub-Matter" })).toHaveCount(0);
      await expect(contributor.getByRole("button", { name: "Link Contract" })).toHaveCount(0);
      const forbiddenDate = await contributor.request.post(
        `/api/v1/matters/${matter.number}/key-dates`,
        { data: { date: date.toISOString().slice(0, 10), label: "Forbidden" } },
      );
      expect(forbiddenDate.status(), await forbiddenDate.text()).toBe(403);
      const forbiddenClose = await contributor.request.patch(`/api/v1/matters/${matter.number}`, {
        data: { statusId: "not-a-contributor-action" },
      });
      expect(forbiddenClose.status(), await forbiddenClose.text()).toBe(403);

      await page.goto(`/matters/${matter.number}`);
      await page
        .getByRole("region", { name: MATTER_TITLE })
        .getByRole("button", { name: "Close matter" })
        .click();
      const close = page.getByRole("dialog", { name: `Close ${MATTER_TITLE}?` });
      await expect(close.getByText(`M-${childNumber} ${CHILD_TITLE}`)).toBeVisible();
      await expect(close.getByLabel(/Resolution/i)).toHaveCount(0);
      const closed = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/matters/${matter.number}`) &&
          response.request().method() === "PATCH",
      );
      await close.getByRole("button", { name: "Close matter" }).click();
      expect((await closed).status()).toBe(200);
      await expect(
        page.getByRole("region", { name: MATTER_TITLE }).getByRole("button", {
          name: "Reopen matter",
        }),
      ).toBeVisible();

      const comments = await openComments(page);
      await comments.getByLabel("New comment").fill(POST_CLOSE_COMMENT);
      const commented = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/comments") && response.request().method() === "POST",
      );
      await comments.getByRole("button", { name: "Comment", exact: true }).click();
      expect((await commented).status()).toBe(201);
      await expect(comments.getByText(POST_CLOSE_COMMENT)).toBeVisible();

      await contributor.reload();
      await expect(contributor.getByLabel(new RegExp(FIELD_NAME))).toHaveValue(FIELD_VALUE);
    } catch (error) {
      journeyError = error;
      throw error;
    } finally {
      if (journeyError) await sweepOrSay("M23 demo", cleanup);
      else await cleanup();
    }
  });
});
