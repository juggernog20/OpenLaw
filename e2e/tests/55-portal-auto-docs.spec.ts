// SPDX-License-Identifier: AGPL-3.0-only

/** DES-085: a Business User acknowledges, generates, and receives the approved files. */
import { readFile } from "node:fs/promises";
import { expect, test, request as playwrightRequest } from "@playwright/test";
import {
  ADMIN,
  ensureAdminExists,
  ensureMemberInert,
  onboardActivatedMember,
  reportAxeViolations,
  signInAs,
} from "./helpers.js";
import { waitForMailDetails } from "./mailpit.js";

test.setTimeout(120_000);
test.beforeAll(async ({ request }) => ensureAdminExists(request));

test("the four Portal Auto-Doc screens are accessible and deliver Word and PDF", async ({
  page,
  browser,
}, testInfo) => {
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  const name = `Portal NDA ${Date.now()}`;
  const email = `portal-auto-doc-${Date.now()}@example.com`;
  const created = await page.request.post("/api/v1/auto-docs", { data: { name } });
  expect(created.status()).toBe(201);
  const id = (await created.json()).autoDoc.id;
  const configured = await page.request.patch(`/api/v1/auto-docs/${id}`, {
    data: {
      audience: "everyone",
      formats: "both",
      acknowledgementFrequency: "every_use",
      acknowledgementText: "Do not edit the generated NDA. Ask Legal for changes.",
    },
  });
  expect(configured.status()).toBe(200);
  const uploaded = await page.request.post(`/api/v1/auto-docs/${id}/template`, {
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
  expect(uploaded.status()).toBe(201);
  const template = await uploaded.json();
  const savedForm = await page.request.post(`/api/v1/auto-docs/${id}/form-versions`, {
    data: {
      fields: [
        {
          slug: "counterparty_name",
          label: "Counterparty name",
          fieldType: "text",
          required: true,
        },
        { slug: "signing_date", label: "Signing date", fieldType: "date", required: true },
      ],
    },
  });
  expect(savedForm.status()).toBe(201);
  const published = await page.request.post(`/api/v1/auto-docs/${id}/publish`, {
    data: {
      documentVersionId: template.template.versions[0].id,
      formVersionId: (await savedForm.json()).formVersion.id,
    },
  });
  expect(published.status()).toBe(200);
  await page.goto("/settings/auto-docs");
  await expect(page.getByRole("textbox", { name: "Default acknowledgement text" })).toBeVisible();
  expect(await reportAxeViolations(page, testInfo, "Auto-Docs-settings")).toEqual([]);
  const cleanup = await playwrightRequest.newContext({
    baseURL: testInfo.project.use.baseURL,
    storageState: await page.context().storageState(),
  });
  let colleague: Awaited<ReturnType<typeof onboardActivatedMember>> | undefined;
  try {
    colleague = await onboardActivatedMember(page.request, browser, {
      email,
      displayName: "Auto-Doc colleague",
      password: "correct-horse-battery",
      role: "business_user",
    });
    const portal = colleague.page;
    await portal.goto("/portal/auto-docs");
    await expect(portal.getByRole("heading", { name: "Auto-Docs", level: 1 })).toBeVisible();
    expect(await reportAxeViolations(portal, testInfo, "Portal-Auto-Docs-list")).toEqual([]);
    await testInfo.attach("m35-854-portal-list", {
      body: await portal.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await portal.getByRole("link", { name: `Generate ${name}`, exact: true }).click();
    await expect(
      portal.getByRole("heading", { name: "Before you generate", level: 1 }),
    ).toBeVisible();
    expect(await reportAxeViolations(portal, testInfo, "Portal-Auto-Doc-acknowledgement")).toEqual(
      [],
    );
    await testInfo.attach("m35-854-portal-acknowledgement", {
      body: await portal.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await portal.getByRole("checkbox", { name: "I acknowledge this statement." }).check();
    await portal.getByRole("button", { name: "Acknowledge and continue", exact: true }).click();
    await expect(portal.getByRole("heading", { name: `Generate ${name}`, level: 1 })).toBeVisible();
    await portal
      .getByRole("textbox", { name: "Counterparty name", exact: true })
      .fill("Portal supplier");
    await expect(
      portal.getByRole("button", { name: "Signing date", exact: true }),
    ).toHaveAccessibleDescription("Required");
    await portal.getByRole("button", { name: "Signing date", exact: true }).click();
    const calendar = portal.getByRole("dialog", { name: "Choose a date" });
    await calendar.getByRole("combobox", { name: "Year", exact: true }).selectOption("2026");
    await calendar.getByRole("combobox", { name: "Month", exact: true }).selectOption("9");
    await calendar.getByRole("button", { name: /October 1st, 2026/ }).click();
    expect(await reportAxeViolations(portal, testInfo, "Portal-Auto-Doc-form")).toEqual([]);
    await testInfo.attach("m35-854-portal-form", {
      body: await portal.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await portal.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(
      portal.getByRole("heading", { name: "Your generated document", level: 1 }),
    ).toBeVisible();
    await expect(portal.getByRole("link", { name: "Download Word", exact: true })).toBeVisible();
    await expect(portal.getByRole("link", { name: "Download PDF", exact: true })).toBeVisible({
      timeout: 30_000,
    });
    expect(await reportAxeViolations(portal, testInfo, "Portal-Auto-Doc-confirmation")).toEqual([]);
    await testInfo.attach("m35-854-portal-confirmation", {
      body: await portal.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    const mail = await waitForMailDetails(page.request, email, new RegExp(name));
    expect(mail.attachments.map((attachment) => attachment.filename).sort()).toEqual([
      `${name}.docx`,
      `${name}.pdf`,
    ]);
    await portal.getByRole("link", { name: "Generate again", exact: true }).click();
    await expect(
      portal.getByRole("heading", { name: "Before you generate", level: 1 }),
    ).toBeVisible();
    await portal.getByRole("checkbox", { name: "I acknowledge this statement." }).check();
    await portal.getByRole("button", { name: "Acknowledge and continue", exact: true }).click();
    await expect(
      portal.getByRole("textbox", { name: "Counterparty name", exact: true }),
    ).toHaveValue("Portal supplier");
    expect(
      (await page.request.post(`/api/v1/auto-docs/${id}/unpublish`, { data: {} })).status(),
    ).toBe(200);
    await portal.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(portal.getByRole("alert")).toContainText(name);
    await expect(
      portal.getByRole("textbox", { name: "Counterparty name", exact: true }),
    ).toHaveValue("Portal supplier");
  } finally {
    await colleague?.context.close().catch(() => undefined);
    try {
      await ensureMemberInert(cleanup, email);
    } finally {
      await cleanup.dispose();
    }
  }
});
