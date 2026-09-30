// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from "@playwright/test";
import { z } from "zod";
import { ADMIN, ensureAdminExists, reportAxeViolations, signInAs } from "./helpers.js";

test("Trust register tab and entry dialogs are axe clean in Light and Dark", async ({
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
    .entityTypes.find((t) => t.slug === "corporation")!;
  const created = await page.request.post("/api/v1/entities", {
    data: { legalName: `Axe Trust ${Date.now()}`, jurisdiction: "Jersey", entityTypeId: type.id },
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
  const scan = async (state: string, include = '[data-testid="trust-register"]') => {
    expect(
      await reportAxeViolations(page, testInfo, `trust-register-${theme}-${state}`, { include }),
    ).toEqual([]);
  };
  try {
    const changed = await page.request.patch(`/api/v1/entities/${id}`, {
      data: { registerKind: "trust" },
    });
    expect(changed.status(), await changed.text()).toBe(200);
    for (theme of ["light", "dark"] as const) {
      await page.goto(`/entities/${id}/ownership`);
      await expect(page.getByRole("heading", { name: "No trust register yet" })).toBeVisible();
      await scan("empty");
    }
    let beneficiaryId = "";
    for (const data of [
      {
        kind: "settlement",
        effectiveOn: "2020-01-01",
        party: { kind: "individual", name: "Axe Settlor" },
        amount: 100000,
        currency: "USD",
      },
      {
        kind: "appointment",
        effectiveOn: "2020-01-01",
        party: { kind: "class", description: "Children of the Settlor" },
        role: "beneficiary",
        interest: "Discretionary interest",
      },
      {
        kind: "distribution",
        effectiveOn: "2021-01-01",
        party: { kind: "class", description: "Children of the Settlor" },
        amount: 120000,
        currency: "USD",
      },
      {
        kind: "appointment",
        effectiveOn: "2099-01-01",
        party: { kind: "individual", name: "Future Trustee" },
        role: "trustee",
      },
    ]) {
      const response = await page.request.post(`/api/v1/entities/${id}/trust-entries`, {
        data:
          data.kind === "distribution"
            ? { ...data, party: { kind: "party", partyId: beneficiaryId } }
            : data,
      });
      expect(response.status(), await response.text()).toBe(201);
      if (data.kind === "appointment" && data.role === "beneficiary") {
        beneficiaryId = z
          .object({
            parties: z.array(z.object({ role: z.string(), party: z.object({ id: z.string() }) })),
          })
          .parse(await response.json())
          .parties.find((p) => p.role === "beneficiary")!.party.id;
      }
    }
    for (theme of ["light", "dark"] as const) {
      await page.goto(`/entities/${id}/ownership?asOf=2022-01-01`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.getByRole("heading", { name: /Register of trust parties/ })).toBeVisible();
      await expect(page.locator('tr[data-applied="false"]')).toHaveCount(1);
      await scan("historic");
      await page.getByRole("button", { name: "Reset to today" }).click();
      await expect(
        page.getByRole("heading", { name: "Register of trust parties", exact: true }),
      ).toBeVisible();
      await scan("today");
      await page.getByRole("button", { name: "Record entry", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Record entry", exact: true });
      for (const kind of ["appointment", "cessation", "settlement", "distribution"]) {
        await dialog.getByLabel("Entry", { exact: false }).selectOption(kind);
        await scan(kind, '[role="dialog"]');
      }
      await dialog.getByLabel("Entry", { exact: false }).selectOption("appointment");
      await dialog.getByLabel("Role", { exact: false }).selectOption("beneficiary");
      await dialog.getByLabel("Party", { exact: false }).selectOption("class");
      await scan("class", '[role="dialog"]');
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    }
  } finally {
    const archived = await page.request.post(`/api/v1/entities/${id}/archive`);
    expect(archived.status(), await archived.text()).toBe(200);
  }
});
