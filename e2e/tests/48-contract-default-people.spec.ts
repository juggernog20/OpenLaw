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

test("a default person receives a new Confidential Contract in the Portal", async ({
  page,
  browser,
}, testInfo) => {
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  const suffix = Date.now();
  const email = `default-person-${suffix}@example.com`;
  const name = `Procurement ${suffix}`;
  let colleague: Awaited<ReturnType<typeof onboardActivatedMember>> | undefined;
  let typeId: string | undefined;
  let contractNumber: number | undefined;
  try {
    colleague = await onboardActivatedMember(page.request, browser, {
      email,
      displayName: name,
      password: "correct-horse-battery",
      role: "business_user",
    });
    const madeType = await page.request.post("/api/v1/contract-types", {
      data: { displayName: `Procurement NDA ${suffix}` },
    });
    expect(madeType.status(), await madeType.text()).toBe(201);
    typeId = z.object({ contractType: z.object({ id: z.string() }) }).parse(await madeType.json())
      .contractType.id;
    await page.goto(`/settings/contracts/types/${typeId}`);
    await page.getByRole("link", { name: "People", exact: true }).click();
    await expect(page.getByRole("heading", { name: "People", exact: true })).toBeVisible();
    await page
      .getByRole("combobox", { name: "Default person", exact: true })
      .selectOption({ label: name });
    await page.getByRole("button", { name: "Add person", exact: true }).click();
    await expect(page.getByRole("button", { name: `Remove ${name}`, exact: true })).toBeVisible();
    expect(await reportAxeViolations(page, testInfo, "Contract-Type-People")).toEqual([]);
    const title = `Procurement contract ${suffix}`;
    const madeContract = await page.request.post("/api/v1/contracts", {
      data: { title, contractTypeId: typeId, isConfidential: true },
    });
    expect(madeContract.status(), await madeContract.text()).toBe(201);
    contractNumber = z
      .object({ contract: z.object({ number: z.number() }) })
      .parse(await madeContract.json()).contract.number;
    await colleague.page.goto(`/portal/contracts/${contractNumber}`);
    await expect(colleague.page.getByRole("heading", { name: title })).toBeVisible();
    const bell = await colleague.page.request.get("/api/v1/portal/notifications");
    expect(bell.status(), await bell.text()).toBe(200);
    expect(await bell.text()).toContain("contract.team_added");
    expect(
      await reportAxeViolations(colleague.page, testInfo, "Default-person-Portal-Contract"),
    ).toEqual([]);
  } finally {
    await colleague?.context.close();
    await ensureMemberInert(page.request, email);
    if (contractNumber)
      expect(
        (
          await page.request.post(`/api/v1/contracts/${contractNumber}/archive`, { data: {} })
        ).status(),
      ).toBe(200);
    if (typeId) {
      const options = await page.request.get("/api/v1/contracts/options");
      const types = z
        .object({ contractTypes: z.array(z.object({ id: z.string(), slug: z.string() })) })
        .parse(await options.json()).contractTypes;
      const other = types.find((type) => type.slug === "other")!;
      const archived = await page.request.post(`/api/v1/contract-types/${typeId}/archive`, {
        data: { reassignToId: other.id },
      });
      expect(archived.status(), await archived.text()).toBe(200);
    }
  }
});
