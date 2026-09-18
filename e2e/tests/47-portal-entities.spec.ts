// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test } from "@playwright/test";
import { z } from "zod";
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

test("an Administrator lists an Entity and a Business User picks it on a required Portal form", async ({
  page,
  browser,
}, testInfo) => {
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  const suffix = Date.now();
  const email = `entity-picker-${suffix}@example.com`;
  const entityIds: string[] = [];
  let typeId: string | undefined;
  let fieldId: string | undefined;
  let colleague: Awaited<ReturnType<typeof onboardActivatedMember>> | undefined;
  try {
    const options = await page.request.get("/api/v1/entities/types");
    expect(options.status(), await options.text()).toBe(200);
    const { entityTypes } = z
      .object({ entityTypes: z.array(z.object({ id: z.string() })) })
      .parse(await options.json());
    for (const label of ["Operating", "Holding"]) {
      const made = await page.request.post("/api/v1/entities", {
        data: { legalName: `${label} Entity ${suffix}`, entityTypeId: entityTypes[0]!.id },
      });
      expect(made.status(), await made.text()).toBe(201);
      entityIds.push(
        z.object({ entity: z.object({ id: z.string() }) }).parse(await made.json()).entity.id,
      );
    }
    await page.goto(`/entities/${entityIds[0]}`);
    const listed = page.getByRole("switch", { name: "Portal-listed" });
    await expect(listed).not.toBeChecked();
    const changed = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().endsWith(`/entities/${entityIds[0]}`),
    );
    await listed.click();
    expect((await changed).status()).toBe(200);
    await expect(listed).toBeChecked();
    expect(await reportAxeViolations(page, testInfo, "Entity-Portal-listed")).toEqual([]);

    const type = await page.request.post("/api/v1/request-types", {
      data: { displayName: `Entity selection ${suffix}` },
    });
    expect(type.status(), await type.text()).toBe(201);
    const requestType = z
      .object({ requestType: z.object({ id: z.string(), slug: z.string() }) })
      .parse(await type.json()).requestType;
    typeId = requestType.id;
    const field = await page.request.post("/api/v1/fields", {
      data: {
        displayName: `Signing Entity ${suffix}`,
        moduleScope: "contract",
        fieldType: "entity",
        fieldTag: "business",
      },
    });
    expect(field.status(), await field.text()).toBe(201);
    fieldId = z.object({ field: z.object({ id: z.string() }) }).parse(await field.json()).field.id;
    const attached = await page.request.post(`/api/v1/request-types/${typeId}/fields`, {
      data: { fieldId, isRequired: true },
    });
    expect(attached.status(), await attached.text()).toBe(201);
    colleague = await onboardActivatedMember(page.request, browser, {
      email,
      displayName: "Entity picker colleague",
      password: "correct-horse-battery",
      role: "business_user",
    });
    const portal = colleague.page;
    await portal.setViewportSize({ width: 390, height: 844 });
    await portal.goto(`/portal/new/${requestType.slug}`);
    const picker = portal.getByRole("combobox", { name: new RegExp(`Signing Entity ${suffix}`) });
    await expect(picker).toHaveAttribute("aria-required", "true");
    await expect(picker.getByRole("option", { name: `Operating Entity ${suffix}` })).toHaveCount(1);
    await expect(picker.getByRole("option", { name: `Holding Entity ${suffix}` })).toHaveCount(0);
    await picker.selectOption(entityIds[0]!);
    await portal.getByLabel(/^Title/).fill("A new supplier NDA");
    await portal.getByLabel(/^Description/).fill("Please prepare an NDA for the supplier review.");
    expect(await reportAxeViolations(portal, testInfo, "Portal-required-Entity")).toEqual([]);
    await portal.getByRole("button", { name: "Submit request" }).click();
    await expect(
      portal.getByRole("heading", { name: "Thanks! Your request has been submitted to legal." }),
    ).toBeVisible();
  } finally {
    await colleague?.context.close();
    await ensureMemberInert(page.request, email);
    if (typeId) {
      const listed = await page.request.get("/api/v1/request-types");
      expect(listed.status(), await listed.text()).toBe(200);
      const { requestTypes } = z
        .object({ requestTypes: z.array(z.object({ id: z.string() })) })
        .parse(await listed.json());
      const replacement = requestTypes.find((type) => type.id !== typeId);
      expect(replacement).toBeDefined();
      const archived = await page.request.post(`/api/v1/request-types/${typeId}/archive`, {
        data: { reassignToId: replacement!.id },
      });
      expect(archived.status(), await archived.text()).toBe(200);
    }
    for (const path of [
      ...entityIds.map((id) => `/api/v1/entities/${id}/archive`),
      ...(fieldId ? [`/api/v1/fields/${fieldId}/archive`] : []),
    ]) {
      const archived = await page.request.post(path, { data: {} });
      expect(archived.status(), await archived.text()).toBe(200);
    }
  }
});
