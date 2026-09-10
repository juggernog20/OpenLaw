// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type Locator } from "@playwright/test";
import { z } from "zod";
import { ADMIN, ensureAdminExists, signInAs } from "./helpers.js";

test.setTimeout(120_000);

async function expectInside(inner: Locator, outer: Locator) {
  await expect
    .poll(async () => {
      const item = await inner.boundingBox();
      const menu = await outer.boundingBox();
      return !!item && !!menu && item.y >= menu.y && item.y + item.height <= menu.y + menu.height;
    })
    .toBe(true);
}

test("every Contract Status stays reachable in crowded menus at viewport edges (#768)", async ({
  page,
  request,
}) => {
  await ensureAdminExists(request);
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  const createdStatuses: string[] = [];
  let contractNumber: number | undefined;
  let savedStatus: string | undefined;
  const stamp = Date.now();
  try {
    const stages = ["draft", "review", "approval", "signature", "active", "ended"] as const;
    for (let index = 0; index < 20; index++) {
      const response = await page.request.post("/api/v1/contract-statuses", {
        data: { displayName: `E2E menu ${stamp} ${index}`, stage: stages[index % stages.length] },
      });
      expect(response.status(), await response.text()).toBe(201);
      createdStatuses.push(
        z.object({ contractStatus: z.object({ id: z.string() }) }).parse(await response.json())
          .contractStatus.id,
      );
    }
    const options = await page.request.get("/api/v1/contracts/options");
    expect(options.ok()).toBe(true);
    const types = z
      .object({ contractTypes: z.array(z.object({ id: z.string(), slug: z.string() })) })
      .parse(await options.json()).contractTypes;
    const type = types.find((candidate) => candidate.slug === "other");
    expect(type).toBeDefined();
    const created = await page.request.post("/api/v1/contracts", {
      data: { title: `E2E crowded Status menu ${stamp}`, contractTypeId: type!.id },
    });
    expect(created.status(), await created.text()).toBe(201);
    contractNumber = z
      .object({ contract: z.object({ number: z.number() }) })
      .parse(await created.json()).contract.number;
    savedStatus = z
      .object({ contract: z.object({ statusId: z.string() }) })
      .parse(await created.json()).contract.statusId;
    const selectedId = createdStatuses[18]!;
    const selected = await page.request.patch(`/api/v1/contracts/${contractNumber}`, {
      data: { statusId: selectedId },
    });
    expect(selected.ok(), await selected.text()).toBe(true);
    await page.goto(`/contracts/${contractNumber}`);

    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 390, height: 720 },
      { width: 1280, height: 240 },
      { width: 390, height: 360 },
    ]) {
      await test.step(`${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        const trigger = page.getByRole("button", { name: /move contract$/ });
        await expect(trigger).toBeVisible();
        await trigger.click();
        const menu = page.getByRole("menu");
        await expect(menu).toBeVisible();
        await expect
          .poll(async () => {
            const box = await menu.boundingBox();
            return !!box && box.y >= 0 && box.y + box.height <= viewport.height;
          })
          .toBe(true);
        const scrollBefore = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
        const items = menu.getByRole("menuitemradio");
        expect(await items.count()).toBeGreaterThanOrEqual(20);
        await expectInside(menu.getByRole("menuitemradio", { checked: true }), menu);

        await menu.press("End");
        await expect(items.last()).toBeFocused();
        await expectInside(items.last(), menu);
        await menu.press("Home");
        await expect(items.first()).toBeFocused();
        await expectInside(items.first(), menu);

        // Pointer actionability must work for every row without changing Status.
        for (const item of await items.all()) {
          await item.click({ trial: true, timeout: 5000 });
          await expectInside(item, menu);
        }
        expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(scrollBefore);
        await page.keyboard.press("Escape");
        await expect(menu).toBeHidden();
        await expect(trigger).toBeFocused();
      });
    }
  } finally {
    test.setTimeout(test.info().timeout + 30_000);
    const failures: string[] = [];
    if (contractNumber !== undefined) {
      if (savedStatus !== undefined) {
        const restored = await page.request.patch(`/api/v1/contracts/${contractNumber}`, {
          data: { statusId: savedStatus },
        });
        if (!restored.ok()) failures.push(`Status reset: ${restored.status()}`);
      }
      const response = await page.request.post(`/api/v1/contracts/${contractNumber}/archive`);
      if (!response.ok()) failures.push(`Contract cleanup: ${response.status()}`);
    }
    for (const id of createdStatuses) {
      const response = await page.request.post(`/api/v1/contract-statuses/${id}/archive`);
      if (!response.ok()) failures.push(`Status cleanup: ${response.status()}`);
    }
    expect(failures).toEqual([]);
  }
});
