// SPDX-License-Identifier: AGPL-3.0-only

/**
 * M36 close (#935): the share register on fresh Compose images. Filter
 * the Entities list through the shared bar, open an Entity, add a class,
 * record an allotment, a transfer and a buyback, scrub the register to a
 * date between the transfer and the buyback, reset to today, see the
 * projected Holding on the owner Entity, and download the members CSV.
 */

import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { z } from "zod";
import { ADMIN, ensureAdminExists, signInAs } from "./helpers.js";

test.setTimeout(240_000);

const RUN = Date.now();
const ISSUER_NAME = `E2E M36 Issuer ${RUN}`;
const OWNER_NAME = `E2E M36 Owner ${RUN}`;
const INDIVIDUAL_NAME = `E2E M36 Founder ${RUN}`;

const CreatedEntity = z.object({ entity: z.object({ id: z.string(), legalName: z.string() }) });
const Register = z.object({ entries: z.array(z.object({ id: z.string() })) });

async function createEntity(request: APIRequestContext, legalName: string, jurisdiction: string) {
  const types = await request.get("/api/v1/entities/types");
  expect(types.status(), await types.text()).toBe(200);
  const corporation = (
    (await types.json()) as { entityTypes: { id: string; slug: string }[] }
  ).entityTypes.find((row) => row.slug === "corporation");
  expect(corporation).toBeDefined();
  const created = await request.post("/api/v1/entities", {
    data: { legalName, entityTypeId: corporation!.id, status: "active", jurisdiction },
  });
  expect(created.status(), await created.text()).toBe(201);
  return CreatedEntity.parse(await created.json()).entity;
}

function main(page: Page): Locator {
  return page.getByRole("main");
}

async function recordEntry(page: Page, fill: (dialog: Locator) => Promise<void>): Promise<void> {
  await main(page).getByRole("button", { name: "Record entry" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Record entry" });
  await expect(dialog).toBeVisible();
  await fill(dialog);
  const written = page.waitForResponse(
    (response) =>
      response.url().includes("/share-entries") && response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Enter in register" }).click();
  const response = await written;
  expect(response.status(), await response.text()).toBe(201);
  await expect(dialog).toBeHidden();
}

test.describe.serial("M36 deployer journey", () => {
  test.beforeAll(async ({ request }) => ensureAdminExists(request));

  test("keeps a share register and reads it as of a date", async ({ page }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
    // The page's own context, so the API calls below carry its session.
    const api = page.context().request;
    const owner = await createEntity(api, OWNER_NAME, "Jersey");
    const issuer = await createEntity(api, ISSUER_NAME, "Cayman Islands");
    const registerPath = `/api/v1/entities/${issuer.id}/share-register`;

    const cleanup = async () => {
      const failures: unknown[] = [];
      const settle = async (step: () => Promise<void>) =>
        step().catch((error: unknown) => failures.push(error));
      await settle(async () => {
        const read = await api.get(registerPath);
        if (read.status() !== 200) return;
        const entries = Register.parse(await read.json()).entries;
        for (const entry of entries.reverse()) {
          await api.delete(`/api/v1/entities/${issuer.id}/share-entries/${entry.id}`);
        }
      });
      for (const entity of [issuer, owner]) {
        await settle(async () => {
          await api.post(`/api/v1/entities/${entity.id}/archive`);
        });
      }
      expect(failures, failures.map(String).join("\n")).toEqual([]);
    };

    try {
      // Point 1: the Entities list filters through the shared bar.
      await page.goto("/entities?view=list");
      await expect(main(page).getByRole("table")).toBeVisible();
      await page.getByRole("button", { name: /^Filter/ }).click();
      const menu = page.getByRole("dialog", { name: "Filter" });
      await menu.getByRole("button", { name: "Jurisdiction" }).click();
      await page.getByRole("radio", { name: "Cayman Islands" }).click();
      await page.getByRole("button", { name: "Apply" }).click();
      await expect(
        page.getByRole("button", { name: "Jurisdiction: Cayman Islands" }),
      ).toBeVisible();
      await expect(main(page).getByRole("link", { name: ISSUER_NAME })).toBeVisible();
      await expect(main(page).getByRole("link", { name: OWNER_NAME })).toBeHidden();
      await page.getByRole("button", { name: "Remove Jurisdiction filter" }).click();

      // The empty register, then a class.
      await page.goto(`/entities/${issuer.id}/ownership`);
      await expect(
        main(page).getByRole("heading", { name: "No share register yet" }),
      ).toBeVisible();
      await expect(main(page).getByRole("button", { name: /Add holder/ })).toHaveCount(0);
      await main(page).getByRole("button", { name: "New share class" }).click();
      const classes = page.getByRole("dialog", { name: "Share classes" });
      await classes.getByLabel("Name").fill("Ordinary");
      await classes.getByLabel("Authorized shares").fill("1000");
      await classes.getByRole("button", { name: "Save" }).click();
      await expect(classes.getByText("Ordinary")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(classes).toBeHidden();

      // Dated history goes in through the API; the buyback is recorded in the dialog today.
      const classId = (
        (await (await api.get(registerPath)).json()) as { classes: { id: string }[] }
      ).classes[0]!.id;
      const post = async (body: Record<string, unknown>) => {
        const response = await api.post(`/api/v1/entities/${issuer.id}/share-entries`, {
          data: { shareClassId: classId, ...body },
        });
        expect(response.status(), await response.text()).toBe(201);
        return (await response.json()) as {
          holders: { holder: { restricted: boolean; id: string; name?: string } }[];
        };
      };
      await post({
        kind: "allotment",
        effectiveOn: "2024-01-10",
        quantity: 600,
        to: { kind: "entity", entityId: owner.id },
        resolutionRef: "BR-1",
      });
      const afterFounder = await post({
        kind: "allotment",
        effectiveOn: "2024-01-10",
        quantity: 400,
        to: { kind: "individual", name: INDIVIDUAL_NAME },
      });
      const founderId = afterFounder.holders.find(
        (row) => !row.holder.restricted && row.holder.name === INDIVIDUAL_NAME,
      )!.holder.id;
      await post({
        kind: "transfer",
        effectiveOn: "2024-06-01",
        quantity: 100,
        from: { kind: "holder", holderId: founderId },
        to: { kind: "entity", entityId: owner.id },
      });
      await page.reload();
      await recordEntry(page, async (dialog) => {
        await dialog.getByLabel(/^Entry/).selectOption("buyback");
        await dialog.getByLabel(/^From/).selectOption({ label: INDIVIDUAL_NAME });
        await dialog.getByLabel(/^Shares/).fill("50");
        await dialog.getByLabel("Consideration").fill("cash");
      });

      // Today: 700 / 250 / 50 in treasury, derived from four entries.
      const members = main(page)
        .getByRole("heading", { name: "Register of members" })
        .locator("..")
        .locator("..");
      await expect(main(page).getByText(/derived from 4 register entries/)).toBeVisible();
      const row = (name: string) => members.getByRole("row").filter({ hasText: name });
      await expect(row(OWNER_NAME)).toContainText("700");
      await expect(row(INDIVIDUAL_NAME)).toContainText("250");
      await expect(row("Treasury")).toContainText("50");
      await expect(members.getByText("Total Ordinary")).toBeVisible();

      // Between the transfer and the buyback: the founder still held 300.
      await page.goto(`/entities/${issuer.id}/ownership?asOf=2024-07-01`);
      await expect(
        main(page).getByRole("heading", { name: "Register of members at Jul 1, 2024" }),
      ).toBeVisible();
      await expect(row(INDIVIDUAL_NAME)).toContainText("300");
      await expect(row(INDIVIDUAL_NAME)).toContainText("−50");
      await expect(main(page).getByText("Entries after Jul 1, 2024 are dimmed")).toBeVisible();
      await main(page).getByRole("button", { name: "Reset to today" }).click();
      await expect(page).toHaveURL(new RegExp(`/entities/${issuer.id}/ownership$`));
      await expect(
        main(page).getByRole("heading", { name: "Register of members", exact: true }),
      ).toBeVisible();

      // The owner Entity's Holdings card shows the projected 70%, read-only.
      await page.goto(`/entities/${owner.id}/ownership`);
      const holdings = main(page)
        .getByRole("heading", { name: "Holdings in other Entities" })
        .locator("..")
        .locator("..");
      await expect(holdings.getByRole("link", { name: ISSUER_NAME })).toBeVisible();
      await expect(holdings.getByRole("link", { name: "From register" })).toBeVisible();
      await expect(holdings.getByLabel(`${ISSUER_NAME} ownership percent`)).toHaveValue("70");
      await expect(holdings.getByLabel(`${ISSUER_NAME} ownership percent`)).toBeDisabled();

      // The members CSV downloads with the columns the tab shows.
      const download = await api.get(`${registerPath}/export?kind=members`);
      expect(download.status(), await download.text()).toBe(200);
      expect(download.headers()["content-disposition"]).toContain("register of members");
      const body = await download.text();
      expect(body).toContain("Holder,Holder kind,Jurisdiction,Class,Shares");
      expect(body).toContain(`${OWNER_NAME},entity,Jersey,Ordinary,700`);
      expect(body).toContain(`${INDIVIDUAL_NAME},individual,,Ordinary,250`);
      const entriesCsv = await api.get(`${registerPath}/export?kind=entries`);
      expect(entriesCsv.status()).toBe(200);
      expect(await entriesCsv.text()).toContain("1,2024-01-10,allotment,");
      expect(await entriesCsv.text()).toContain(",buyback,");
    } finally {
      await cleanup();
    }
  });
});
