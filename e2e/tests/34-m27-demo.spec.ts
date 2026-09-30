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
const ShareClasses = z.object({
  classes: z.array(z.object({ id: z.string(), name: z.string() })),
});
const RegisterEntries = z.object({ entries: z.array(z.object({ id: z.string() })) });

type CreatedEntity = z.infer<typeof CreatedEntity>["entity"];

function nextMonthDay(): string {
  const today = new Date();
  const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 15));
  return day.toISOString().slice(0, 10);
}

async function registerEntity(page: Page, legalName: string, jurisdiction: string) {
  await page.getByRole("button", { name: "Add entity" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add entity" });
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
    let entryId: string | undefined;

    const cleanup = async () => {
      const failures: unknown[] = [];
      const settle = async (step: () => Promise<void>) =>
        step().catch((error: unknown) => failures.push(error));
      const subsidiaryId = subsidiary?.id;
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
      if (entryId && subsidiaryId) {
        await settle(() =>
          deleteChild(page.request, `/api/v1/entities/${subsidiaryId}/share-entries/${entryId}`),
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

      // A Holding comes only from a share register (ENT-012). The register's
      // own screens are journey 58; here the subsidiary allots every share
      // to the parent through the API, and the parent's tab shows the result.
      const parentId = parent.id;
      const shareClass = await page.request.post(`/api/v1/entities/${subsidiaryId}/share-classes`, {
        data: { name: "Ordinary" },
      });
      expect(shareClass.status(), await shareClass.text()).toBe(201);
      const shareClassId = ShareClasses.parse(await shareClass.json()).classes.find(
        (row) => row.name === "Ordinary",
      )?.id;
      expect(shareClassId).toBeDefined();
      const allotted = await page.request.post(`/api/v1/entities/${subsidiaryId}/share-entries`, {
        data: {
          kind: "allotment",
          effectiveOn: "2026-08-01",
          shareClassId,
          quantity: 100,
          to: { kind: "entity", entityId: parentId },
        },
      });
      expect(allotted.status(), await allotted.text()).toBe(201);
      entryId = RegisterEntries.parse(await allotted.json()).entries[0]?.id;

      await page.goto(`/entities/${parentId}/ownership`);
      const holdings = main(page).getByRole("region", { name: "Holdings in other Entities" });
      await expect(
        holdings.getByRole("link", { name: SUBSIDIARY_NAME, exact: true }),
      ).toBeVisible();
      await expect(holdings.getByLabel(`${SUBSIDIARY_NAME} ownership percent`)).toHaveText("100%");
      await expect(main(page).getByRole("button", { name: "Add Holding" })).toHaveCount(0);

      await page.goto(`/entities/${subsidiaryId}`);
      const officers = main(page).getByRole("region", { name: "Directors & Officers" });
      await officers.getByRole("button", { name: "Add director or officer" }).click();
      await officers.getByLabel("Director or officer name").fill(DIRECTOR_NAME);
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
        officers.getByRole("combobox", { name: `${DIRECTOR_NAME} Director or officer name` }),
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
      const obligationRow = main(page).getByRole("row").filter({ hasText: OBLIGATION_LABEL });
      await expect(
        obligationRow.getByRole("cell", { name: OBLIGATION_LABEL, exact: true }),
      ).toBeVisible();
      await expect(obligationRow.getByRole("cell", { name: "12", exact: true })).toBeVisible();

      await page.goto("/entities?view=list");
      const subsidiaryRow = page.getByRole("row").filter({ hasText: SUBSIDIARY_NAME });
      await expect(subsidiaryRow).toBeVisible();
      await subsidiaryRow.click();
      await expect(page).toHaveURL(`/entities/${subsidiaryId}`);
      await expect(
        main(page).getByRole("combobox", { name: `${DIRECTOR_NAME} Director or officer name` }),
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
