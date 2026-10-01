// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from "@playwright/test";
import { z } from "zod";
import { ADMIN, ensureAdminExists, reportAxeViolations, signInAs } from "./helpers.js";

test("Partnership register and dialogs are axe clean in Light and Dark", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  await ensureAdminExists(request);
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  const types = await page.request.get("/api/v1/entities/types");
  expect(types.status(), await types.text()).toBe(200);
  const type = z
    .object({ entityTypes: z.array(z.object({ id: z.string(), slug: z.string() })) })
    .parse(await types.json())
    .entityTypes.find((t) => t.slug === "partnership")!;
  const created = await page.request.post("/api/v1/entities", {
    data: {
      legalName: `Axe Partnership ${Date.now()}`,
      jurisdiction: "Jersey",
      entityTypeId: type.id,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const id = z.object({ entity: z.object({ id: z.string() }) }).parse(await created.json())
    .entity.id;
  let theme: "light" | "dark" = "light";
  await page.route("**/api/v1/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { user: Record<string, unknown> };
    await route.fulfill({ response, json: { ...body, user: { ...body.user, theme } } });
  });
  const scan = async (state: string, include = '[aria-label="Partnership register"]') => {
    expect(
      await reportAxeViolations(page, testInfo, `partnership-register-${theme}-${state}`, {
        include,
      }),
    ).toEqual([]);
  };
  try {
    for (theme of ["light", "dark"] as const) {
      await page.goto(`/entities/${id}/ownership`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(
        page.getByRole("heading", { name: "No partnership register yet" }),
      ).toBeVisible();
      await scan("empty");
    }
    const admitted = await page.request.post(`/api/v1/entities/${id}/partnership-entries`, {
      data: {
        kind: "admission",
        effectiveOn: "2020-01-01",
        party: { kind: "individual", name: "Axe Partner" },
        capacity: "general",
        units: 100,
        statedPercent: 80,
      },
    });
    expect(admitted.status(), await admitted.text()).toBe(201);
    const partyId = z
      .object({ partners: z.array(z.object({ party: z.object({ id: z.string() }) })) })
      .parse(await admitted.json()).partners[0]!.party.id;
    for (const data of [
      {
        kind: "contribution",
        effectiveOn: "2020-01-01",
        party: { kind: "party", partyId },
        amount: 100000,
        currency: "AED",
      },
      {
        kind: "transfer",
        effectiveOn: "2023-01-01",
        fromParty: { kind: "party", partyId },
        toParty: { kind: "individual", name: "Axe Assignee" },
        transfereeStatus: "assignee",
        units: 10,
      },
      {
        kind: "admission",
        effectiveOn: "2099-01-01",
        party: { kind: "individual", name: "Future Partner" },
        capacity: "limited",
      },
    ]) {
      const response = await page.request.post(`/api/v1/entities/${id}/partnership-entries`, {
        data,
      });
      expect(response.status(), await response.text()).toBe(201);
    }
    const changed = await page.request.patch(`/api/v1/entities/${id}`, {
      data: { partnershipBasis: "stated" },
    });
    expect(changed.status(), await changed.text()).toBe(200);
    for (theme of ["light", "dark"] as const) {
      await page.goto(`/entities/${id}/ownership?asOf=2022-01-01`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(
        page.getByRole("heading", { name: /Register of partners(?: at|$)/ }),
      ).toBeVisible();
      await expect(page.locator('tr[data-applied="false"]')).toHaveCount(2);
      await scan("historic");
      await page.getByRole("button", { name: "Reset to today" }).click();
      await expect(
        page.getByRole("heading", { name: "Register of partners", exact: true }),
      ).toBeVisible();
      await scan("today");
      await page.getByRole("button", { name: "Change basis" }).click();
      await scan("basis", '[role="dialog"]');
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("button", { name: "Record entry", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Record entry", exact: true });
      for (const kind of [
        "admission",
        "commitment",
        "contribution",
        "return",
        "transfer",
        "capacity_change",
        "withdrawal",
      ]) {
        await dialog.getByLabel("Entry", { exact: false }).selectOption(kind);
        await scan(kind, '[role="dialog"]');
        if (kind === "transfer") {
          await dialog.getByLabel("Transferee status", { exact: false }).selectOption("assignee");
          await scan("assignee", '[role="dialog"]');
        }
      }
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    }
  } finally {
    const archived = await page.request.post(`/api/v1/entities/${id}/archive`);
    expect(archived.status(), await archived.text()).toBe(200);
  }
});
