// SPDX-License-Identifier: AGPL-3.0-only

/**
 * M36 close (#935): the share register on fresh Compose images. Filter
 * the Entities list through the shared bar, open an Entity, add a class,
 * build a register, record a buyback in the dialog, scrub the register
 * to a date between the transfer and the buyback, reset to today, see
 * the projected Holding on the owner Entity, and download both CSVs
 * from the tab's own export controls.
 */

import { readFile } from "node:fs/promises";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { z } from "zod";
import { ADMIN, ensureAdminExists, signInAs } from "./helpers.js";

test.setTimeout(240_000);

const RUN = Date.now();
const ISSUER_NAME = `E2E M36 Issuer ${RUN}`;
const OWNER_NAME = `E2E M36 Owner ${RUN}`;
const INDIVIDUAL_NAME = `E2E M36 Founder ${RUN}`;

const EntityTypes = z.object({
  entityTypes: z.array(z.object({ id: z.string(), slug: z.string() })),
});
const CreatedEntity = z.object({ entity: z.object({ id: z.string(), legalName: z.string() }) });
const HolderRef = z.union([
  z.object({ restricted: z.literal(false), id: z.string(), name: z.string() }),
  z.object({ restricted: z.literal(true), id: z.string() }),
]);
const Register = z.object({
  classes: z.array(z.object({ id: z.string(), name: z.string() })),
  holders: z.array(z.object({ holder: HolderRef })),
  entries: z.array(z.object({ id: z.string() })),
});

async function createEntity(request: APIRequestContext, legalName: string, jurisdiction: string) {
  const types = await request.get("/api/v1/entities/types");
  expect(types.status(), await types.text()).toBe(200);
  const corporation = EntityTypes.parse(await types.json()).entityTypes.find(
    (row) => row.slug === "corporation",
  );
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

/** Clicks an export control and answers the downloaded file's name and text. */
async function download(page: Page, control: Locator) {
  const [file] = await Promise.all([page.waitForEvent("download"), control.click()]);
  const path = await file.path();
  return { name: file.suggestedFilename(), text: await readFile(path, "utf8") };
}

test.describe.serial("M36 deployer journey", () => {
  test.beforeAll(async ({ request }) => ensureAdminExists(request));

  test("filters Entities, derives a register from entries, reads it as of a date, projects the Holding, and exports both CSVs", async ({
    page,
  }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
    // The page's own context, so the API calls below carry its session.
    const api = page.context().request;
    const owner = await createEntity(api, OWNER_NAME, "Jersey");
    const issuer = await createEntity(api, ISSUER_NAME, "Cayman Islands");
    const registerPath = `/api/v1/entities/${issuer.id}/share-register`;
    const readRegister = async () => {
      const read = await api.get(registerPath);
      expect(read.status(), await read.text()).toBe(200);
      return Register.parse(await read.json());
    };

    const cleanup = async () => {
      const failures: unknown[] = [];
      const settle = async (step: () => Promise<void>) =>
        step().catch((error: unknown) => failures.push(error));
      await settle(async () => {
        // Newest first: a later entry can pin the certificates of an earlier one.
        for (const entry of (await readRegister()).entries.reverse()) {
          const removed = await api.delete(
            `/api/v1/entities/${issuer.id}/share-entries/${entry.id}`,
          );
          expect(removed.status(), await removed.text()).toBe(204);
        }
      });
      for (const entity of [issuer, owner]) {
        await settle(async () => {
          const archived = await api.post(`/api/v1/entities/${entity.id}/archive`);
          expect(archived.status(), await archived.text()).toBe(200);
        });
      }
      expect(failures, failures.map(String).join("\n")).toEqual([]);
    };

    try {
      // The Entities list filters through the shared bar.
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

      // The empty register, then a class. There is no way to add a holder by hand.
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
      const classId = (await readRegister()).classes[0]!.id;
      const post = async (body: Record<string, unknown>) => {
        const response = await api.post(`/api/v1/entities/${issuer.id}/share-entries`, {
          data: { shareClassId: classId, ...body },
        });
        expect(response.status(), await response.text()).toBe(201);
        return Register.parse(await response.json());
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
      const founder = afterFounder.holders
        .map((row) => row.holder)
        .find((holder) => !holder.restricted && holder.name === INDIVIDUAL_NAME);
      expect(founder).toBeDefined();
      await post({
        kind: "transfer",
        effectiveOn: "2024-06-01",
        quantity: 100,
        from: { kind: "holder", holderId: founder!.id },
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
      const members = main(page).getByRole("region", { name: "Register of members" });
      await expect(members.getByText(/derived from 4 register entries/)).toBeVisible();
      const row = (name: string | RegExp) => members.getByRole("row").filter({ hasText: name });
      await expect(row(OWNER_NAME)).toContainText("700");
      await expect(row(INDIVIDUAL_NAME)).toContainText("250");
      // Case-sensitive: the class total row says "in treasury" too.
      await expect(row(/^Treasury/)).toContainText("50");
      await expect(members.getByText("Total Ordinary")).toBeVisible();

      // Both exports, through the tab's own controls.
      const membersCsv = await download(
        page,
        members.getByRole("link", { name: "Export register" }),
      );
      expect(membersCsv.name).toContain(`${ISSUER_NAME} register of members`);
      expect(membersCsv.text).toContain('"Holder","Holder kind","Jurisdiction","Class","Shares"');
      expect(membersCsv.text).toContain(`"${OWNER_NAME}","entity","Jersey","Ordinary","700"`);
      expect(membersCsv.text).toContain(`"${INDIVIDUAL_NAME}","individual","","Ordinary","250"`);
      const entries = main(page).getByRole("region", {
        name: "Register of allotments and transfers",
      });
      const entriesCsv = await download(page, entries.getByRole("link", { name: "Export" }));
      expect(entriesCsv.name).toBe(`${ISSUER_NAME} register of entries.csv`);
      expect(entriesCsv.text).toContain('"1","2024-01-10","allotment",');
      expect(entriesCsv.text).toContain('"buyback"');

      // Between the transfer and the buyback: the founder still held 300.
      await page.goto(`/entities/${issuer.id}/ownership?asOf=2024-07-01`);
      const historic = main(page).getByRole("region", {
        name: "Register of members at Jul 1, 2024",
      });
      await expect(historic).toBeVisible();
      const historicRow = historic.getByRole("row").filter({ hasText: INDIVIDUAL_NAME });
      await expect(historicRow).toContainText("300");
      await expect(historicRow).toContainText("−50");
      await expect(main(page).getByText("Entries after Jul 1, 2024 are dimmed")).toBeVisible();
      await main(page).getByRole("button", { name: "Reset to today" }).click();
      await expect(page).toHaveURL(new RegExp(`/entities/${issuer.id}/ownership$`));
      await expect(members).toBeVisible();

      // The owner Entity's Holdings card shows the projected share, read-only:
      // 700 of the 950 outstanding (the 50 in treasury do not count).
      await page.goto(`/entities/${owner.id}/ownership`);
      const holdings = main(page).getByRole("region", { name: "Holdings in other Entities" });
      await expect(holdings.getByRole("link", { name: ISSUER_NAME })).toBeVisible();
      await expect(holdings.getByRole("link", { name: "From register" })).toBeVisible();
      const percent = holdings.getByLabel(`${ISSUER_NAME} ownership percent`);
      await expect(percent).toHaveValue("73.68");
      await expect(percent).toBeDisabled();
    } finally {
      await cleanup();
    }
  });
});
