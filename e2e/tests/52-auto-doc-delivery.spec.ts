// SPDX-License-Identifier: AGPL-3.0-only

import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { ADMIN, ensureAdminExists, reportAxeViolations, signInAs } from "./helpers.js";
import { rawMail, waitForMailDetails } from "./mailpit.js";

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
  // The record is the DES-087 builder: the file arrives through the
  // upload dialog, and the directives in it decide each field's type.
  await page.getByRole("link", { name: "Form", exact: true }).click();
  await page.getByRole("button", { name: "Upload version", exact: true }).click();
  const upload = page.getByRole("dialog");
  await upload
    .getByLabel("Word template", { exact: true })
    .setInputFiles(
      fileURLToPath(
        new URL("../../apps/api/src/testing/fixtures/auto-docs/directives.docx", import.meta.url),
      ),
    );
  await upload.getByRole("button", { name: "Upload", exact: true }).click();
  await upload.getByRole("button", { name: "Close", exact: true }).click();
  const fields = page.getByRole("region", { name: "Fields", exact: true });
  await expect(
    fields
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: "Edit Signing date", exact: true }) })
      .getByText("Date", { exact: true }),
  ).toBeVisible();
  await expect(
    fields
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: "Edit Amount", exact: true }) })
      .getByText("Currency", { exact: true }),
  ).toBeVisible();

  // Settings live on their own cards now, and each control commits on
  // its own (DES-087): there is no Save button to press.
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const output = page.getByRole("region", { name: "Output", exact: true });
  await expect(output).toBeVisible({ timeout: 10_000 });
  await output.getByRole("combobox", { name: "Formats", exact: true }).selectOption("both");
  await output
    .getByLabel("Cover note", { exact: true })
    .fill(
      "Please **review** the attached NDA before signing.\n\nKeep a copy.\n\n- Sign the NDA\n- Send it to Legal",
    );
  await output.getByLabel("Cover note", { exact: true }).blur();
  await expect(output.getByText("Saved", { exact: true }).last()).toBeVisible();
  await expect(output.getByText("review", { exact: true })).toBeVisible();
  expect(await reportAxeViolations(page, testInfo, "Auto-Doc-delivery-settings")).toEqual([]);
  await page.getByRole("button", { name: "Publish", exact: true }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Publish", exact: true }).click();
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
  expect(mail.html).toMatch(/>[^<]*Auto-Doc<\/p>/);
  expect(mail.html).toMatch(new RegExp(`<h1[^>]*>${name}</h1>`));
  expect(mail.html).toMatch(/Note from [^<]+ Legal/);
  expect(mail.html).toMatch(/<p[^>]*>Keep a copy\.<\/p>/);
  expect(mail.html).toMatch(/<ul[^>]*><li>Sign the NDA<\/li><li>Send it to Legal<\/li><\/ul>/);
  expect(mail.html).toMatch(/width="28" height="28"[^>]*>W<\/td>/);
  expect(mail.html).toMatch(/width="28" height="28"[^>]*>P<\/td>/);
  expect(mail.html.match(/Attached · /g)).toHaveLength(2);
  const button = mail.html.match(/<a href="([^"]+)"[^>]*>Download your files<\/a>/);
  expect(button?.[1]).toBe(page.url());
  const mime = await rawMail(page.request, mail.id);
  expect(mime).toMatch(/Content-Disposition: inline/);
  expect(mime).toMatch(/Content-ID: <(?:openlaw-mark|org-logo)@openlaw>/);
  expect(mail.attachments.map((attachment) => attachment.filename).sort()).toEqual(
    [...files.keys()].sort(),
  );
  for (const attachment of mail.attachments) {
    expect(mail.html).toContain(`${attachment.filename}<br>`);
    const bytes = await page.request.get(attachment.url);
    expect(bytes.status()).toBe(200);
    expect(await bytes.body()).toEqual(files.get(attachment.filename));
  }
  expect(await reportAxeViolations(page, testInfo, "Auto-Doc-delivery-confirmation")).toEqual([]);
});
