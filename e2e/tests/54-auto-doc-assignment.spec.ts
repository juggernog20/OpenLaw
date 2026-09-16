// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-006: Legal configures Assignment and assigns a generated Contract in the browser. */
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  ADMIN,
  chooseAssignee,
  ensureAdminExists,
  reportAxeViolations,
  signInAs,
} from "./helpers.js";

test.setTimeout(120_000);
test.beforeAll(async ({ request }) => ensureAdminExists(request));

test("Legal edits Assignment rules and assigns an unassigned generated Contract from the Inbox", async ({
  page,
}, testInfo) => {
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  const name = `Assignment NDA ${Date.now()}`;
  const typeReply = await page.request.post("/api/v1/contract-types", {
    data: { displayName: name },
  });
  expect(typeReply.status()).toBe(201);
  const created = await page.request.post("/api/v1/auto-docs", { data: { name } });
  expect(created.status()).toBe(201);
  const id = (await created.json()).autoDoc.id;
  const configured = await page.request.patch(`/api/v1/auto-docs/${id}`, {
    data: { targetContractTypeId: (await typeReply.json()).contractType.id, formats: "docx" },
  });
  expect(configured.status()).toBe(200);
  const upload = await page.request.post(`/api/v1/auto-docs/${id}/template`, {
    multipart: {
      file: {
        name: "NDA.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer: await readFile(
          new URL("../../apps/api/src/testing/fixtures/auto-docs/plain.docx", import.meta.url),
        ),
      },
    },
  });
  expect(upload.status()).toBe(201);
  await page.goto(`/auto-docs/${id}/settings`);
  const assignment = page.getByRole("region", { name: "Assignment rules", exact: true });
  await assignment.getByRole("button", { name: "Add rule", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Operator", exact: true }).selectOption("is_set");
  await dialog
    .getByRole("combobox", { name: "Legal Owner", exact: true })
    .selectOption({ label: ADMIN.displayName });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(assignment.getByText("Counterparty name is set", { exact: true })).toBeVisible();
  expect(await reportAxeViolations(page, testInfo, "Auto-Doc-assignment-editor")).toEqual([]);
  await testInfo.attach("m35-853-assignment-editor", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  await assignment.getByRole("button", { name: "Remove rule 1", exact: true }).click();
  await expect(assignment.getByText("Counterparty name is set", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("link", { name: "Generate", exact: true }).click();
  await page.getByLabel("Counterparty name", { exact: true }).fill("Inbox supplier");
  await page.getByLabel("Signing date", { exact: true }).fill("2026-10-01");
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Generation", exact: true })).toBeVisible();
  // The sub-bar's breadcrumb also carries the name; the Contract link is in the body.
  const contractPath = (await page
    .getByRole("main")
    .getByRole("link", { name, exact: true })
    .getAttribute("href"))!;
  await page.goto("/inbox?tab=unassigned-contracts");
  const row = page.getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });
  await expect(row).toBeVisible();
  expect(await reportAxeViolations(page, testInfo, "Inbox-unassigned-Contracts")).toEqual([]);
  await testInfo.attach("m35-853-inbox", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  await row.getByRole("button", { name: /^Assign / }).click();
  await chooseAssignee(page.getByRole("dialog"), ADMIN.displayName);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save assignment", exact: true })
    .click();
  // A modal hides background rows from role locators before the save finishes.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row).toHaveCount(0);
  const queue = await page.request.get("/api/v1/inbox/unassigned-contracts");
  expect(
    (await queue.json()).contracts.some(
      (contract: { number: number }) => contractPath === `/contracts/${contract.number}`,
    ),
  ).toBe(false);
});
