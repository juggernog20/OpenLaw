// SPDX-License-Identifier: AGPL-3.0-only

/** M24 close (#518): create a Matter from a template and find its checklist ready. */

import { expect, test } from "@playwright/test";
import { z } from "zod";
import { ADMIN, ensureAdminExists, signInAs } from "./helpers.js";

test.setTimeout(180_000);

const RUN = Date.now();
const TYPE_NAME = `Employment ${RUN}`;
const TEMPLATE_NAME = `Employment onboarding ${RUN}`;
const TITLE_PREFIX = "Employment —";
const MATTER_TITLE = `${TITLE_PREFIX} E2E hire ${RUN}`;
const FIRST_TASK = `Review employment terms ${RUN}`;
const SECOND_TASK = `Confirm onboarding owner ${RUN}`;
const KEY_DATE = `Probation checkpoint ${RUN}`;

const MatterTypes = z.object({
  matterTypes: z.array(z.object({ id: z.string(), archivedAt: z.string().nullable() })),
});
const CreatedType = z.object({ matterType: z.object({ id: z.string() }) });
const CreatedTemplate = z.object({ matterTemplate: z.object({ id: z.string() }) });
const CreatedMatter = z.object({
  matter: z.object({
    number: z.number().int(),
    createdAt: z.iso.datetime(),
  }),
});
const Tasks = z.object({
  tasks: z.array(
    z.object({
      title: z.string(),
      dueDate: z.iso.date().nullable(),
      displayOrder: z.number().int(),
    }),
  ),
});
const KeyDates = z.object({
  deadlines: z.array(
    z.object({
      label: z.string(),
      date: z.iso.date(),
    }),
  ),
});

function relativeDate(createdAt: string, offsetDays: number): string {
  const created = new Date(createdAt);
  const date = new Date(
    Date.UTC(created.getUTCFullYear(), created.getUTCMonth(), created.getUTCDate()),
  );
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function shortDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  const currentYear = new Date().getFullYear();
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(parsed.getUTCFullYear() === currentYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).format(parsed);
}

test.describe.serial("M24 deployer journey", () => {
  test.beforeAll(async ({ request }) => ensureAdminExists(request));

  test("creates an employment matter from a template with its relative checklist ready", async ({
    page,
  }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    const typesRead = await page.request.get("/api/v1/matter-types?includeArchived=true");
    expect(typesRead.status(), await typesRead.text()).toBe(200);
    const replacementType = MatterTypes.parse(await typesRead.json()).matterTypes.find(
      (row) => row.archivedAt === null,
    );
    expect(replacementType, "the install has no live Matter Type").toBeDefined();

    const typeResponse = await page.request.post("/api/v1/matter-types", {
      data: { displayName: TYPE_NAME },
    });
    expect(typeResponse.status(), await typeResponse.text()).toBe(201);
    const matterTypeId = CreatedType.parse(await typeResponse.json()).matterType.id;

    const templateResponse = await page.request.post("/api/v1/matter-templates", {
      data: {
        matterTypeId,
        name: TEMPLATE_NAME,
        description: "A fresh-image proof of the M24 demo sentence.",
        defaultPriority: "high",
        defaultRisk: "medium",
        titlePrefix: TITLE_PREFIX,
      },
    });
    expect(templateResponse.status(), await templateResponse.text()).toBe(201);
    const templateId = CreatedTemplate.parse(await templateResponse.json()).matterTemplate.id;

    const tasksResponse = await page.request.put(`/api/v1/matter-templates/${templateId}/tasks`, {
      data: {
        tasks: [
          { title: FIRST_TASK, dueOffsetDays: 3, assigneeRole: "none" },
          { title: SECOND_TASK, dueOffsetDays: null, assigneeRole: "none" },
        ],
      },
    });
    expect(tasksResponse.status(), await tasksResponse.text()).toBe(200);

    const datesResponse = await page.request.put(
      `/api/v1/matter-templates/${templateId}/key-dates`,
      {
        data: {
          keyDates: [
            {
              label: KEY_DATE,
              offsetDays: 7,
              note: "Seeded by the M24 close journey.",
            },
          ],
        },
      },
    );
    expect(datesResponse.status(), await datesResponse.text()).toBe(200);

    let matterNumber: number | undefined;
    const cleanup = async () => {
      const failures: unknown[] = [];
      const settle = async (step: () => Promise<void>) => {
        await step().catch((error: unknown) => failures.push(error));
      };
      if (matterNumber !== undefined) {
        await settle(async () => {
          const archived = await page.request.post(`/api/v1/matters/${matterNumber}/archive`);
          expect(archived.status(), await archived.text()).toBe(200);
        });
      }
      await settle(async () => {
        const archived = await page.request.post(`/api/v1/matter-templates/${templateId}/archive`);
        expect(archived.status(), await archived.text()).toBe(200);
      });
      await settle(async () => {
        const archived = await page.request.post(`/api/v1/matter-types/${matterTypeId}/archive`, {
          data: { reassignToId: replacementType!.id },
        });
        expect(archived.status(), await archived.text()).toBe(200);
      });
      if (failures.length > 0) throw new AggregateError(failures, "M24 demo cleanup failed");
    };

    try {
      await page.goto("/matters");
      await page.getByLabel("Matters").getByRole("button", { name: "New matter" }).click();
      const create = page.getByRole("dialog", { name: "Create matter" });
      await create.getByLabel("Matter type").selectOption(matterTypeId);

      await expect(create.getByLabel("Template (optional)")).toHaveValue(templateId);
      await expect(create.getByText("Template adds 2 tasks and 1 key date.")).toBeVisible();
      await expect(create.getByLabel("Title")).toHaveValue(TITLE_PREFIX);
      await expect(create.getByLabel("Priority")).toHaveValue("high");
      await expect(create.getByLabel("Risk")).toHaveValue("medium");
      await create.getByLabel("Title").fill(MATTER_TITLE);

      const created = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/matters") && response.request().method() === "POST",
      );
      await create.getByRole("button", { name: "Create", exact: true }).click();
      const createdResponse = await created;
      expect(createdResponse.status(), await createdResponse.text()).toBe(201);
      const matter = CreatedMatter.parse(await createdResponse.json()).matter;
      matterNumber = matter.number;
      await expect(page).toHaveURL(new RegExp(`/matters/${matter.number}$`));
      await expect(page.getByRole("region", { name: MATTER_TITLE })).toBeVisible();

      const expectedTaskDate = relativeDate(matter.createdAt, 3);
      const taskRead = await page.request.get(`/api/v1/matters/${matter.number}/tasks`);
      expect(taskRead.status(), await taskRead.text()).toBe(200);
      expect(Tasks.parse(await taskRead.json()).tasks).toEqual([
        { title: FIRST_TASK, dueDate: expectedTaskDate, displayOrder: 0 },
        { title: SECOND_TASK, dueDate: null, displayOrder: 1 },
      ]);

      const keyDateRead = await page.request.get(`/api/v1/matters/${matter.number}/key-dates`);
      expect(keyDateRead.status(), await keyDateRead.text()).toBe(200);
      expect(KeyDates.parse(await keyDateRead.json()).deadlines).toEqual([
        { label: KEY_DATE, date: relativeDate(matter.createdAt, 7) },
      ]);

      await page.goto(`/matters/${matter.number}/tasks`);
      const main = page.locator("main");
      await expect(main.getByText(FIRST_TASK)).toBeVisible();
      await expect(main.getByText(`Due ${shortDate(expectedTaskDate)}`)).toBeVisible();
      await expect(main.getByText(SECOND_TASK)).toBeVisible();
    } finally {
      await cleanup();
    }
  });
});
