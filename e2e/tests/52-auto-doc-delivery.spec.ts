// SPDX-License-Identifier: AGPL-3.0-only

import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { ADMIN, ensureAdminExists, reportAxeViolations, signInAs } from "./helpers.js";
import { waitForMailDetails } from "./mailpit.js";

test.setTimeout(150_000);
test.beforeAll(async ({ request }) => ensureAdminExists(request));

test("Legal configures a cover note and receives matching Word and PDF downloads and email attachments", async ({
  page,
}, testInfo) => {
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  await page.goto("/auto-docs");
  const name = `Delivery NDA ${Date.now()}`;
  await page.getByRole("button", { name: "Create Auto-Doc", exact: true }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page
    .getByLabel("Word template", { exact: true })
    .setInputFiles(
      fileURLToPath(
        new URL("../../apps/api/src/testing/fixtures/auto-docs/directives.docx", import.meta.url),
      ),
    );
  await page.getByRole("button", { name: "Upload template", exact: true }).click();
  await expect(
    page
      .getByRole("group", { name: "signing_date", exact: true })
      .getByRole("combobox", { name: "Type", exact: true }),
  ).toHaveValue("date");
  await expect(
    page
      .getByRole("group", { name: "amount", exact: true })
      .getByRole("combobox", { name: "Type", exact: true }),
  ).toHaveValue("currency");
  const settings = page.getByRole("region", { name: "Settings", exact: true });
  await expect(settings).toBeVisible({ timeout: 10_000 });
  await settings.getByRole("combobox", { name: "Formats", exact: true }).selectOption("both");
  await settings
    .getByLabel("Cover note", { exact: true })
    .fill("Please **review** the attached NDA before signing.");
  await expect(settings.getByText("review", { exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(settings.getByText("Settings saved.", { exact: true })).toBeVisible();
  expect(await reportAxeViolations(page, testInfo, "Auto-Doc-delivery-settings")).toEqual([]);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("link", { name: "Generate", exact: true }).click();
  await page.getByLabel("Counterparty name", { exact: true }).fill("Acme & Sons");
  await page.getByLabel("Amount", { exact: true }).fill("12345.67");
  await page.getByLabel("Signing date", { exact: true }).click();
  const calendar = page.getByRole("dialog", { name: "Choose a date" });
  await calendar.getByRole("combobox", { name: "Year", exact: true }).selectOption("2026");
  await calendar.getByRole("combobox", { name: "Month", exact: true }).selectOption("8");
  await calendar.getByRole("button", { name: /September 14th, 2026/ }).click();
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Generation", exact: true })).toBeVisible();
  const word = page.getByRole("link", { name: "Download Word", exact: true });
  await expect(word).toBeVisible();
  const pdf = page.getByRole("link", { name: "Download PDF", exact: true });
  await expect(pdf).toBeVisible({ timeout: 90_000 });
  const files = new Map<string, Buffer>();
  for (const [format, link] of [
    ["docx", word],
    ["pdf", pdf],
  ] as const) {
    const file = await page.request.get((await link.getAttribute("href"))!);
    expect(file.status()).toBe(200);
    files.set(`${name}.${format}`, await file.body());
  }
  await expect(page.getByText(/^Email sent ·/)).toBeVisible({ timeout: 30_000 });
  const mail = await waitForMailDetails(
    page.request,
    ADMIN.email,
    new RegExp(`^${name} is ready$`),
  );
  expect(mail.text).toContain("Please review the attached NDA before signing.");
  expect(mail.html).toContain("<strong>review</strong>");
  expect(mail.html).toContain("OpenLaw");
  expect(mail.attachments.map((attachment) => attachment.filename).sort()).toEqual(
    [...files.keys()].sort(),
  );
  for (const attachment of mail.attachments) {
    const bytes = await page.request.get(attachment.url);
    expect(bytes.status()).toBe(200);
    expect(await bytes.body()).toEqual(files.get(attachment.filename));
  }
  expect(await reportAxeViolations(page, testInfo, "Auto-Doc-delivery-confirmation")).toEqual([]);
});
