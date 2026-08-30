// SPDX-License-Identifier: AGPL-3.0-only

/** M27 close (#582): the complete Entities demo on fresh Compose images. */

import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { z } from "zod";
import { ADMIN, ensureAdminExists, signInAs } from "./helpers.js";

test.setTimeout(240_000);

const RUN = Date.now();
const PARENT_NAME = `E2E M27 Parent ${RUN}`;
const SUBSIDIARY_NAME = `E2E M27 Subsidiary ${RUN}`;
const DIRECTOR_NAME = `E2E M27 Director ${RUN}`;
const OBLIGATION_LABEL = `E2E M27 Annual return ${RUN}`;

const CreatedEntity = z.object({
  entity: z.object({ id: z.string(), legalName: z.string() }),
});
const CreatedOfficer = z.object({ officer: z.object({ id: z.string() }) });
const CreatedObligation = z.object({ obligation: z.object({ id: z.string() }) });

type CreatedEntity = z.infer<typeof CreatedEntity>["entity"];

function nextMonthDay(): string {
  const today = new Date();
  const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 15));
  return day.toISOString().slice(0, 10);
}

async function registerEntity(page: Page, legalName: string, jurisdiction: string) {
  await page.getByRole("button", { name: "Register entity" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Register entity" });
  await dialog.getByLabel("Legal name").fill(legalName);
  await dialog.getByLabel("Entity type").selectOption({ label: "Corporation" });
  await dialog.getByLabel("Formation jurisdiction").fill(jurisdiction);
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/entities") && response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Register", exact: true }).click();
  const response = await created;
  expect(response.status(), await response.text()).toBe(201);
  await expect(dialog).toBeHidden();
  return CreatedEntity.parse(await response.json()).entity;
}

async function deleteChild(request: APIRequestContext, path: string) {
  const response = await request.delete(path);
  expect(response.status(), await response.text()).toBe(204);
}

function main(page: Page): Locator {
  return page.getByRole("main");
}

test.describe.serial("M27 deployer journey", () => {
  test.beforeAll(async ({ request }) => ensureAdminExists(request));

  test("registers a group, records its people and filing, then finds both in context", async ({
    page,
  }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
    await page.goto("/entities?view=list");

    // Every per-run row is tracked from the moment it exists, so the
    // cleanup below can remove it even when a later step fails.
    let parent: CreatedEntity | undefined;
    let subsidiary: CreatedEntity | undefined;
    let officerId: string | undefined;
    let obligationId: string | undefined;
    let holdingCreated = false;

    const cleanup = async () => {
      const failures: unknown[] = [];
      const settle = async (step: () => Promise<void>) =>
        step().catch((error: unknown) => failures.push(error));
      const subsidiaryId = subsidiary?.id;
      const parentId = parent?.id;
      if (obligationId && subsidiaryId) {
        await settle(() =>
          deleteChild(page.request, `/api/v1/entities/${subsidiaryId}/obligations/${obligationId}`),
        );
      }
      if (officerId && subsidiaryId) {
        await settle(() =>
          deleteChild(page.request, `/api/v1/entities/${subsidiaryId}/officers/${officerId}`),
        );
      }
      if (holdingCreated && subsidiaryId && parentId) {
        await settle(() =>
          deleteChild(page.request, `/api/v1/entities/${subsidiaryId}/holdings/${parentId}`),
        );
      }
      for (const entity of [subsidiary, parent].filter(
        (row): row is CreatedEntity => row !== undefined,
      )) {
        await settle(async () => {
          const archived = await page.request.post(`/api/v1/entities/${entity.id}/archive`);
          expect(archived.status(), await archived.text()).toBe(200);
        });
      }
      if (failures.length > 0) throw new AggregateError(failures, "M27 demo cleanup failed");
    };

    try {
      parent = await registerEntity(page, PARENT_NAME, "Delaware");
      subsidiary = await registerEntity(page, SUBSIDIARY_NAME, "England & Wales");
      const subsidiaryId = subsidiary.id;

      await page.goto(`/entities/${subsidiaryId}/ownership`);
      await main(page).getByRole("button", { name: "Add Holding" }).click();
      const holding = page.getByRole("dialog", { name: "Add Holding" });
      await holding.getByRole("combobox", { name: "Entity" }).fill(PARENT_NAME);
      await holding.getByRole("option", { name: PARENT_NAME, exact: true }).click();
      await holding.getByLabel("Ownership percent").fill("100");
      const holdingResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/entities/${subsidiaryId}/holdings`) &&
          response.request().method() === "POST",
      );
      await holding.getByRole("button", { name: "Add", exact: true }).click();
      const held = await holdingResponse;
      expect(held.status(), await held.text()).toBe(201);
      holdingCreated = true;
      await expect(main(page).getByRole("link", { name: PARENT_NAME, exact: true })).toBeVisible();
      await expect(main(page).getByLabel(`${PARENT_NAME} ownership percent`)).toHaveValue("100");

      await page.goto(`/entities/${subsidiaryId}`);
      const officers = main(page).getByRole("region", { name: "Officers" });
      await officers.getByRole("button", { name: "Add officer" }).click();
      await officers.getByLabel("Officer name").fill(DIRECTOR_NAME);
      await officers.getByLabel("Role").selectOption({ label: "Director" });
      await officers.getByLabel("Appointed on").fill("2026-08-01");
      const officerResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/entities/${subsidiaryId}/officers`) &&
          response.request().method() === "POST",
      );
      await officers.getByRole("button", { name: "Add", exact: true }).click();
      const addedOfficer = await officerResponse;
      expect(addedOfficer.status(), await addedOfficer.text()).toBe(201);
      officerId = CreatedOfficer.parse(await addedOfficer.json()).officer.id;
      await expect(
        officers.getByRole("textbox", { name: `${DIRECTOR_NAME} Officer name` }),
      ).toHaveValue(DIRECTOR_NAME);

      const dueOn = nextMonthDay();
      await page.goto(`/entities/${subsidiaryId}/obligations`);
      await main(page).getByRole("button", { name: "Add obligation" }).click();
      const obligation = page.getByRole("dialog", { name: "Add obligation" });
      await obligation.getByLabel("Label").fill(OBLIGATION_LABEL);
      await obligation.getByLabel("Due date").fill(dueOn);
      await obligation.getByLabel("Repeat every (months)").fill("12");
      const obligationResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/entities/${subsidiaryId}/obligations`) &&
          response.request().method() === "POST",
      );
      await obligation.getByRole("button", { name: "Add obligation" }).click();
      const addedObligation = await obligationResponse;
      expect(addedObligation.status(), await addedObligation.text()).toBe(201);
      obligationId = CreatedObligation.parse(await addedObligation.json()).obligation.id;
      await expect(
        main(page).getByRole("textbox", { name: `${OBLIGATION_LABEL} label` }),
      ).toHaveValue(OBLIGATION_LABEL);

      await page.goto("/entities?view=list");
      const subsidiaryRow = page.getByRole("row").filter({ hasText: SUBSIDIARY_NAME });
      await expect(subsidiaryRow).toBeVisible();
      await subsidiaryRow.click();
      await expect(page).toHaveURL(`/entities/${subsidiaryId}`);
      await expect(
        main(page).getByRole("textbox", { name: `${DIRECTOR_NAME} Officer name` }),
      ).toHaveValue(DIRECTOR_NAME);

      await page.goto("/entities?view=chart");
      const chart = page.getByRole("region", { name: "Entity ownership chart" });
      await expect(chart.getByRole("link", { name: `Open ${PARENT_NAME}` })).toBeVisible();
      await expect(chart.getByRole("link", { name: `Open ${SUBSIDIARY_NAME}` })).toBeVisible();
      await expect(chart.getByText("100%").first()).toBeVisible();

      await page.goto("/entities");
      await expect(page.getByRole("heading", { name: "Compliance calendar" })).toBeVisible();
      const filing = page.getByRole("row").filter({ hasText: OBLIGATION_LABEL });
      await expect(filing).toContainText(SUBSIDIARY_NAME);
      await expect(filing).toContainText("Every 12 months");
    } finally {
      await cleanup();
    }
  });
});
