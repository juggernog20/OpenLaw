// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from "@playwright/test";
import { ADMIN, ensureAdminExists, signInAs } from "./helpers.js";

test.beforeAll(async ({ request }) => ensureAdminExists(request));

test("Business Owner and Legal Owner share a row, and ownership grants revocable Portal reading", async ({
  page,
}) => {
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const optionsResponse = await page.request.get("/api/v1/contracts/options");
  expect(optionsResponse.ok()).toBe(true);
  const options = await optionsResponse.json();
  const owner = options.users.find(
    (person: { displayName: string }) => person.displayName === ADMIN.displayName,
  );
  const created = await page.request.post("/api/v1/contracts", {
    data: { title: `Portal agreement ${Date.now()}`, contractTypeId: options.contractTypes[0].id },
  });
  expect(created.status()).toBe(201);
  const contract = (await created.json()).contract;
  await page.goto(`/contracts/${contract.number}`);
  const businessOwner = page.getByLabel("Business Owner", { exact: true });
  const legalOwner = page.getByLabel("Legal Owner", { exact: true });
  await businessOwner.selectOption(owner.id);
  await expect(businessOwner).toHaveValue(owner.id);
  await expect(legalOwner).toHaveValue("");
  await expect
    .poll(async () =>
      (await page.request.get(`/api/v1/portal/contracts/${contract.number}`)).status(),
    )
    .toBe(200);
  const businessBox = await businessOwner.boundingBox();
  const legalBox = await legalOwner.boundingBox();
  const entityBox = await page.getByLabel("Our entity", { exact: true }).boundingBox();
  expect(Math.abs(businessBox!.y - legalBox!.y)).toBeLessThan(2);
  expect(entityBox!.y).toBeGreaterThan(businessBox!.y + businessBox!.height);
  expect(entityBox!.width).toBeGreaterThan(businessBox!.width * 1.5);
  await page.goto("/portal/contracts");
  await page.getByRole("link", { name: new RegExp(contract.title) }).click();
  await expect(page.getByRole("heading", { name: contract.title })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  const cleared = await page.request.patch(`/api/v1/contracts/${contract.number}`, {
    data: { businessOwnerId: null },
  });
  expect(cleared.ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Contract not found" })).toBeVisible();
});
