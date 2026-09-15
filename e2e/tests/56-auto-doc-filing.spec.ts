// SPDX-License-Identifier: AGPL-3.0-only

/** DES-086: File from the Member form and both Generation shells, then reuse changed answers. */
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

test.setTimeout(120_000);
test.beforeAll(async ({ request }) => ensureAdminExists(request));
let previousFrequency: string | undefined;
test.afterEach(async ({ page }) => {
  if (previousFrequency === undefined) return;
  const restored = await page.request.put("/api/v1/auto-docs/settings", {
    data: { acknowledgementFrequency: previousFrequency },
  });
  expect(restored.status()).toBe(200);
  previousFrequency = undefined;
});
test("Filing keeps the generated copy and follows the destination rules in both shells", async ({
  page,
  browser,
}, testInfo) => {
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  const settings = await page.request.get("/api/v1/auto-docs/settings");
  expect(settings.status()).toBe(200);
  previousFrequency = (await settings.json()).acknowledgementFrequency;
  const policy = await page.request.put("/api/v1/auto-docs/settings", {
    data: { acknowledgementFrequency: "none" },
  });
  expect(policy.status()).toBe(200);
  const name = `Filed NDA ${Date.now()}`;
  const email = `filing-${Date.now()}@example.com`;
  const created = await page.request.post("/api/v1/auto-docs", { data: { name } });
  expect(created.status()).toBe(201);
  const id = (await created.json()).autoDoc.id;
  expect(
    (
      await page.request.patch(`/api/v1/auto-docs/${id}`, {
        data: { audience: "everyone", formats: "both" },
      })
    ).status(),
  ).toBe(200);
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
  const documentVersionId = (await uploaded.json()).template.versions[0].id;
  const fields = [
    { slug: "counterparty_name", label: "Counterparty name", fieldType: "text", required: true },
    { slug: "signing_date", label: "Signing date", fieldType: "text" },
    { slug: "purpose", label: "Purpose", fieldType: "text" },
  ];
  const saved = await page.request.post(`/api/v1/auto-docs/${id}/form-versions`, {
    data: { fields },
  });
  expect(saved.status()).toBe(201);
  expect(
    (
      await page.request.post(`/api/v1/auto-docs/${id}/publish`, {
        data: { documentVersionId, formVersionId: (await saved.json()).formVersion.id },
      })
    ).status(),
  ).toBe(200);
  const types = await (await page.request.get("/api/v1/matters/options")).json();
  const madeMatter = await page.request.post("/api/v1/matters", {
    data: { title: `${name} Board meeting`, matterTypeId: types.matterTypes[0].id },
  });
  expect(madeMatter.status()).toBe(201);
  const matter = (await madeMatter.json()).matter;
  const contractOptions = await (await page.request.get("/api/v1/contracts/options")).json();
  const contractTypeId = contractOptions.contractTypes[0].id;
  const cleanup = await playwrightRequest.newContext({
    baseURL: testInfo.project.use.baseURL,
    storageState: await page.context().storageState(),
  });
  let colleague: Awaited<ReturnType<typeof onboardActivatedMember>> | undefined;
  try {
    await page.goto(`/auto-docs/${id}/generate`);
    await page
      .getByRole("textbox", { name: "Counterparty name", exact: true })
      .fill("Staff supplier");
    await page.getByRole("checkbox", { name: "File to a record", exact: true }).check();
    await page
      .getByRole("textbox", { name: "Search Matters and Contracts", exact: true })
      .fill(name);
    await page
      .getByRole("combobox", { name: "Filing destination", exact: true })
      .selectOption(`matter:${matter.number}`);
    expect(
      await reportAxeViolations(page, testInfo, "Member-generation-Filing-destination"),
    ).toEqual([]);
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Generation", level: 1 })).toBeVisible();
    await expect(
      page.getByRole("link", { name: `Matter #${matter.number}: ${matter.title}`, exact: true }),
    ).toBeVisible();
    const memberGenerationId = page.url().split("/").at(-1)!;
    await page.getByRole("button", { name: "File", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: `File ${name}`, exact: true });
    await dialog
      .getByRole("combobox", { name: "Filing destination", exact: true })
      .selectOption("new_contract");
    await dialog
      .getByRole("combobox", { name: "Contract Type", exact: true })
      .selectOption(contractTypeId);
    expect(await reportAxeViolations(page, testInfo, "Member-File-new-Contract-dialog")).toEqual(
      [],
    );
    await dialog.getByRole("button", { name: "File", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const history = await (
      await page.request.get(`/api/v1/auto-docs/${id}/generations/${memberGenerationId}/filings`)
    ).json();
    expect(history.filings).toHaveLength(2);
    const contract = history.filings.find(
      (filing: { createdContract: boolean }) => filing.createdContract,
    )?.target;
    expect(contract, "the new Contract Filing is recorded").toBeDefined();
    expect(
      (
        await page.request.get(`/api/v1/auto-docs/${id}/generations/${memberGenerationId}/docx`)
      ).status(),
    ).toBe(200);

    colleague = await onboardActivatedMember(page.request, browser, {
      email,
      displayName: "Filing colleague",
      password: "correct-horse-battery",
      role: "business_user",
    });
    const people = await (await page.request.get("/api/v1/users")).json();
    const person = people.users.find((user: { email: string }) => user.email === email);
    expect(
      (
        await page.request.post(`/api/v1/matters/${matter.number}/team`, {
          data: { userId: person.id },
        })
      ).status(),
    ).toBe(201);
    const portal = colleague.page;
    await portal.goto(`/portal/auto-docs/${id}/generate`);
    await portal
      .getByRole("textbox", { name: "Counterparty name", exact: true })
      .fill("Portal supplier");
    await portal.getByRole("textbox", { name: "Purpose", exact: true }).fill("Board approval");
    await portal.getByRole("button", { name: "Generate", exact: true }).click();
    await expect(
      portal.getByRole("heading", { name: "Your generated document", level: 1 }),
    ).toBeVisible();
    await expect(portal.getByRole("link", { name: "Download PDF", exact: true })).toBeVisible({
      timeout: 30_000,
    });
    const portalGenerationId = portal.url().split("/").at(-1)!;
    await portal.getByRole("button", { name: "File", exact: true }).click();
    const portalDialog = portal.getByRole("dialog", { name: `File ${name}`, exact: true });
    await portalDialog
      .getByRole("combobox", { name: "Filing destination", exact: true })
      .selectOption(`matter:${matter.number}`);
    await expect(
      portalDialog.getByRole("option", { name: "New Contract", exact: true }),
    ).toHaveCount(0);
    await portalDialog
      .getByRole("combobox", { name: "File format", exact: true })
      .selectOption("pdf");
    expect(await reportAxeViolations(portal, testInfo, "Portal-File-dialog")).toEqual([]);
    await portalDialog.getByRole("button", { name: "File", exact: true }).click();
    await expect(portalDialog).not.toBeVisible();
    await expect(
      portal.getByRole("link", { name: `Matter #${matter.number}: ${matter.title}`, exact: true }),
    ).toBeVisible();
    expect(
      (
        await portal.request.post(
          `/api/v1/portal/auto-docs/${id}/generations/${portalGenerationId}/filings`,
          { data: { destination: { kind: "contract", number: contract.number } } },
        )
      ).status(),
    ).toBe(404);
    const nextForm = await page.request.post(`/api/v1/auto-docs/${id}/form-versions`, {
      data: { fields: fields.filter((field) => field.slug !== "purpose") },
    });
    expect(nextForm.status()).toBe(201);
    expect(
      (
        await page.request.post(`/api/v1/auto-docs/${id}/publish`, {
          data: { documentVersionId, formVersionId: (await nextForm.json()).formVersion.id },
        })
      ).status(),
    ).toBe(200);
    await portal.getByRole("link", { name: "Generate again", exact: true }).click();
    await expect(
      portal.getByRole("textbox", { name: "Counterparty name", exact: true }),
    ).toHaveValue("Portal supplier");
    await expect(
      portal.getByRole("heading", { name: "Previous answers", exact: true }),
    ).toBeVisible();
    await expect(portal.getByText("Purpose", { exact: true })).toBeVisible();
    await expect(portal.getByText("Board approval", { exact: true })).toBeVisible();
    expect(await reportAxeViolations(portal, testInfo, "Generate-again-dropped-answers")).toEqual(
      [],
    );
    await testInfo.attach("Generate again with dropped answers", {
      body: await portal.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    expect(
      (await page.request.post(`/api/v1/auto-docs/${id}/unpublish`, { data: {} })).status(),
    ).toBe(200);
    expect(
      (
        await portal.request.get(
          `/api/v1/portal/auto-docs/${id}/generations/${portalGenerationId}/pdf`,
        )
      ).status(),
    ).toBe(200);
  } finally {
    await colleague?.context.close().catch(() => undefined);
    try {
      await ensureMemberInert(cleanup, email);
    } finally {
      await cleanup.dispose();
    }
  }
});
