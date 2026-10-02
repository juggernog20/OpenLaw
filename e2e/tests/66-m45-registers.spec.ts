// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect, type Page, type Locator } from "@playwright/test";
import { z } from "zod";
import { ADMIN, ensureAdminExists, signInAs, switchTheme } from "./helpers.js";

async function entity(page: Page, name: string, slug = "corporation") {
  const types = await page.request.get("/api/v1/entities/types");
  expect(types.status(), await types.text()).toBe(200);
  const type = z
    .object({ entityTypes: z.array(z.object({ id: z.string(), slug: z.string() })) })
    .parse(await types.json())
    .entityTypes.find((row) => row.slug === slug)!;
  const response = await page.request.post("/api/v1/entities", {
    data: { legalName: name, entityTypeId: type.id, jurisdiction: "Jersey" },
  });
  expect(response.status(), await response.text()).toBe(201);
  return z.object({ entity: z.object({ id: z.string() }) }).parse(await response.json()).entity.id;
}

async function openEntry(page: Page, kind: string) {
  await page.getByRole("button", { name: "Record entry", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Record entry", exact: true });
  await dialog.getByLabel(/^Entry/).selectOption(kind);
  return dialog;
}

async function enter(page: Page, dialog: Locator, register: string, status = 201) {
  const response = page.waitForResponse(
    (r) => r.url().includes(`/${register}-entries`) && r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Enter in register" }).click();
  const written = await response;
  expect(written.status(), await written.text()).toBe(status);
  if (status === 201) await expect(dialog).toBeHidden();
}

async function capture(page: Page, name: string) {
  const directory = process.env.M45_SCREENSHOT_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  const dialog = page.getByRole("dialog");
  await ((await dialog.count()) ? dialog : page.getByRole("main")).screenshot({
    path: join(directory, `${name}.png`),
  });
}

async function csv(page: Page, link: Locator) {
  const [file] = await Promise.all([page.waitForEvent("download"), link.click()]);
  return readFile(await file.path(), "utf8");
}

test.beforeEach(async ({ page, request }) => {
  test.setTimeout(120_000);
  await ensureAdminExists(request);
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  await switchTheme(page, ADMIN.displayName, "Light");
  const currency = await page.request.post("/api/v1/org/currencies", { data: { code: "USD" } });
  expect(currency.ok(), await currency.text()).toBe(true);
});

test("M45 trust: empty register, grouped Roles, refused then accepted distribution and fund", async ({
  page,
}) => {
  const createdType = await page.request.post("/api/v1/entity-types", {
    data: { displayName: `M45 Trust ${randomUUID()}` },
  });
  expect(createdType.status(), await createdType.text()).toBe(201);
  const trustType = z
    .object({ entityType: z.object({ id: z.string(), slug: z.string() }) })
    .parse(await createdType.json()).entityType;
  const id = await entity(page, "Helix Family Trust", trustType.slug);
  try {
    await page.goto(`/settings/entities/types/${trustType.id}`);
    const savedKind = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().endsWith(`/entity-types/${trustType.id}`),
    );
    await page.getByRole("combobox", { name: "Register", exact: true }).selectOption("trust");
    const changedKind = await savedKind;
    expect(changedKind.status(), await changedKind.text()).toBe(200);
    await page.goto(`/entities/${id}/ownership`);
    await expect(page.getByRole("heading", { name: "No trust register yet" })).toBeVisible();

    let dialog = await openEntry(page, "settlement");
    await dialog.getByLabel(/^Party/).selectOption("individual");
    await dialog.getByLabel(/^Full name/).fill("Helena Marsh");
    await dialog.getByLabel(/^Amount/).fill("1000");
    await dialog.getByLabel(/^Currency/).selectOption("USD");
    await enter(page, dialog, "trust");

    dialog = await openEntry(page, "distribution");
    await dialog.getByLabel(/^Party/).selectOption({ label: "Helena Marsh" });
    await dialog.getByLabel(/^Amount/).fill("250");
    await dialog.getByLabel(/^Currency/).selectOption("USD");
    await enter(page, dialog, "trust", 409);
    await expect(dialog.getByRole("alert")).toContainText(/beneficiary/i);
    await capture(page, "m45-trust-distribution-refused");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Register of trust entries", exact: true }).getByRole("row"),
    ).toHaveCount(2);

    dialog = await openEntry(page, "appointment");
    await dialog.getByLabel(/^Party/).selectOption({ label: "Helena Marsh" });
    await dialog.getByLabel(/^Role/).selectOption("beneficiary");
    await dialog.getByLabel("Interest or powers").fill("Discretionary interest");
    await enter(page, dialog, "trust");
    dialog = await openEntry(page, "appointment");
    await dialog.getByLabel(/^Role/).selectOption("beneficiary");
    await dialog.getByLabel(/^Party/).selectOption("class");
    await dialog.getByLabel(/^Description/).fill("Children and remoter issue of Helena Marsh");
    await enter(page, dialog, "trust");
    dialog = await openEntry(page, "distribution");
    await dialog.getByLabel(/^Party/).selectOption({ label: "Helena Marsh" });
    await dialog.getByLabel(/^Amount/).fill("250");
    await dialog.getByLabel(/^Currency/).selectOption("USD");
    await enter(page, dialog, "trust");
    const parties = page.getByRole("region", { name: "Register of trust parties", exact: true });
    await expect(parties.getByRole("row").filter({ hasText: "Helena Marsh" })).toHaveCount(3);
    await expect(parties.getByRole("rowheader", { name: "Settlors", exact: true })).toBeVisible();
    await expect(
      parties.getByRole("rowheader", { name: "Beneficiaries", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/Settled 1,000.*Distributed 250.*Fund 750/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Change register" })).toHaveCount(0);
    expect(await csv(page, parties.getByRole("link", { name: "Export register" }))).toContain(
      "Children and remoter issue",
    );
    await capture(page, "m45-trust-register");
    await page.reload();
    await expect(page.getByText(/Fund 750/)).toBeVisible();
  } finally {
    const response = await page.request.post(`/api/v1/entities/${id}/archive`);
    expect(response.status(), await response.text()).toBe(200);
  }
});

test("M45 partnership: admission and capital, basis change, projected Holding and chart", async ({
  page,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const ownerName = `Helix Partnership Holdings Ltd ${suffix}`;
  const partnershipName = `Helix Ventures Partnership ${suffix}`;
  const owner = await entity(page, ownerName);
  const id = await entity(page, partnershipName, "partnership");
  try {
    await page.goto(`/entities/${id}/ownership`);
    await expect(page.getByRole("heading", { name: "No partnership register yet" })).toBeVisible();
    let dialog = await openEntry(page, "admission");
    await dialog.getByLabel(/^Partner/).selectOption("entity");
    await dialog.getByLabel(/^Entity/).selectOption(owner);
    await dialog.getByLabel(/^Capacity/).selectOption("general");
    await dialog.getByLabel("Units", { exact: true }).fill("60");
    await enter(page, dialog, "partnership");
    dialog = await openEntry(page, "admission");
    await dialog.getByLabel(/^Partner/).selectOption("individual");
    await dialog.getByLabel(/^Full name/).fill("Ravi Menon");
    await dialog.getByLabel(/^Capacity/).selectOption("limited");
    await dialog.getByLabel("Units", { exact: true }).fill("40");
    await enter(page, dialog, "partnership");
    for (const [name, amount] of [
      [ownerName, "750"],
      ["Ravi Menon", "250"],
    ]) {
      dialog = await openEntry(page, "contribution");
      await dialog.getByLabel(/^Partner/).selectOption({ label: name! });
      await dialog.getByLabel(/^Amount/).fill(amount!);
      const currency = dialog.getByLabel(/^Currency/);
      if (await currency.isEnabled()) await currency.selectOption("USD");
      else await expect(currency).toHaveValue("USD");
      await enter(page, dialog, "partnership");
      await expect(
        page
          .getByRole("region", { name: "Register of partners", exact: true })
          .getByRole("row")
          .filter({ hasText: name! }),
      ).toContainText(`$${amount}.00`);
    }
    const partners = page.getByRole("region", { name: "Register of partners", exact: true });
    await expect(partners.getByRole("row").filter({ hasText: ownerName })).toContainText("75%");
    await page.getByRole("button", { name: "Change basis" }).click();
    await page.getByRole("radio", { name: "Units", exact: true }).check();
    await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
    await expect(partners.getByRole("row").filter({ hasText: ownerName })).toContainText("60%");
    expect(await csv(page, partners.getByRole("link", { name: "Export register" }))).toContain(
      "Ravi Menon",
    );
    await capture(page, "m45-partnership-register");
    await page.goto(`/entities/${owner}/ownership`);
    const holdings = page.getByRole("region", { name: "Holdings in other Entities" });
    await expect(holdings.getByLabel(`${partnershipName} ownership percent`)).toHaveText("60%");
    await holdings.getByRole("link", { name: "From register" }).click();
    await expect(page).toHaveURL((url) => url.pathname === `/entities/${id}/ownership`);
    const chartResponse = await page.request.get("/api/v1/entities/chart");
    expect(chartResponse.status(), await chartResponse.text()).toBe(200);
    const chartData = z
      .object({
        edges: z.array(
          z.object({
            ownerEntityId: z.string(),
            ownedEntityId: z.string(),
            ownershipPercent: z.number(),
          }),
        ),
      })
      .parse(await chartResponse.json());
    expect(chartData.edges).toContainEqual({
      ownerEntityId: owner,
      ownedEntityId: id,
      ownershipPercent: 60,
    });
    await page.goto("/entities?view=chart");
    const chart = page.getByRole("region", { name: "Entity ownership chart", exact: true });
    await expect(
      chart.getByRole("link", { name: `Open ${partnershipName}`, exact: true }),
    ).toBeVisible();
    const sixtyPercentEdges = chartData.edges.filter((edge) => edge.ownershipPercent === 60);
    // Other Holdings on the chart may also read 60%. Count every one in the chart
    // data, so another edge cannot stand in for the new partnership's edge.
    await expect(chart.getByText("60%", { exact: true })).toHaveCount(sixtyPercentEdges.length);
    await capture(page, "m45-partnership-chart");
  } finally {
    for (const entityId of [id, owner]) {
      const response = await page.request.post(`/api/v1/entities/${entityId}/archive`);
      expect(response.status(), await response.text()).toBe(200);
    }
  }
});
