// SPDX-License-Identifier: AGPL-3.0-only

import { test, expect } from "@playwright/test";
import {
  ADMIN,
  ensureAdminExists,
  ensureMemberInert,
  onboardActivatedMember,
  signInAs,
  reportAxeViolations,
} from "./helpers.js";

test.setTimeout(120_000);
test.beforeAll(async ({ request }) => ensureAdminExists(request));
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aTmUAAAAASUVORK5CYII=",
  "base64",
);

test("Portal Documents keep one current row, read earlier versions and accept revisions and file drops", async ({
  page,
  browser,
}, testInfo) => {
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  const email = `portal-documents-${Date.now()}@example.com`;
  const colleague = await onboardActivatedMember(page.request, browser, {
    email,
    displayName: "Portal document colleague",
    role: "business_user",
    password: "correct-horse-battery",
  });
  const portal = colleague.page;
  const userId = (await (await portal.request.get("/api/v1/me")).json()).user.id;
  const records: { module: "contract" | "matter"; number: number }[] = [];
  try {
    for (const module of ["contract", "matter"] as const) {
      const options = await (await page.request.get(`/api/v1/${module}s/options`)).json();
      const type = options[`${module}Types`].find(
        (row: { fields: { isRequired: boolean }[] }) =>
          !row.fields.some((field) => field.isRequired),
      );
      const created = await page.request.post(`/api/v1/${module}s`, {
        data: {
          title: `Portal document ${module}`,
          [`${module}TypeId`]: type.id,
          ...(module === "contract" ? { owningDepartment: "Sales", region: "EMEA" } : {}),
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      const record = (await created.json())[module];
      records.push({ module, number: record.number });
      expect(
        (
          await page.request.post(`/api/v1/${module}s/${record.number}/team`, { data: { userId } })
        ).status(),
      ).toBe(201);
      const upload = await page.request.post(`/api/v1/${module}s/${record.number}/documents`, {
        multipart: {
          kind: "draft_theirs",
          note: "Initial proposal",
          file: { name: "proposal.png", mimeType: "image/png", buffer: PNG },
        },
      });
      expect(upload.status(), await upload.text()).toBe(201);
      const paper = (await upload.json()).document;
      await portal.setViewportSize({ width: 1440, height: 1000 });
      await portal.goto(`/portal/${module}s/${record.number}`);
      if (module === "contract") {
        const overview = portal.getByRole("region", { name: "Overview", exact: true });
        await expect(overview.getByRole("textbox", { name: "Owning department" })).toHaveValue(
          "Sales",
        );
        await expect(overview.getByRole("textbox", { name: "Region" })).toHaveValue("EMEA");
        await overview.getByRole("textbox", { name: "Owning department" }).fill("Procurement");
        await overview.getByRole("textbox", { name: "Region" }).focus();
        await expect
          .poll(
            async () =>
              (await (await page.request.get(`/api/v1/contracts/${record.number}`)).json()).contract
                .owningDepartment,
          )
          .toBe("Procurement");
        await expect(
          portal
            .getByRole("region", { name: "Fields", exact: true })
            .getByRole("textbox", { name: "Region" }),
        ).toHaveCount(0);
      }
      const section = portal.getByRole("region", { name: "Documents", exact: true });
      await expect(section.getByText("Version 1", { exact: true })).toHaveCount(1);
      await expect(section.getByRole("button", { name: /earlier version/ })).toHaveCount(0);
      if (module === "contract")
        await expect(section.getByText("Primary Document", { exact: true })).toBeVisible();
      await section.getByRole("button", { name: "Add version", exact: true }).click();
      const dialog = portal.getByRole("dialog", { name: "Upload documents" });
      await dialog
        .getByLabel("Files to upload")
        .setInputFiles({ name: "proposal-revised.png", mimeType: "image/png", buffer: PNG });
      await dialog.getByLabel("Kind", { exact: true }).selectOption("redline_theirs");
      await dialog.getByLabel("Note (optional)").fill("Updated delivery scope");
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(section.getByText("Version 2", { exact: true })).toHaveCount(1);
      await section.getByRole("button", { name: "1 earlier version" }).click();
      await expect(section.getByText("Version 2", { exact: true })).toHaveCount(1);
      await expect(section.getByText("Version 1", { exact: true })).toHaveCount(1);
      await section
        .locator("ol")
        .getByRole("button", { name: "proposal.png", exact: true })
        .click();
      const reader = portal.getByRole("complementary", { name: /proposal.png/ });
      await expect(reader.getByRole("img", { name: "proposal.png" })).toBeVisible();
      await portal.keyboard.press("Escape");
      await expect(reader).toBeHidden();
      await section.evaluate((node) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(["Supporting context"], "context.txt", { type: "text/plain" }));
        node.dispatchEvent(
          new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
        );
      });
      await expect(dialog.getByText("context.txt", { exact: true })).toBeVisible();
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(section.getByRole("button", { name: "context.txt", exact: true })).toBeVisible();
      await section.getByRole("textbox", { name: "Search Documents" }).fill("proposal-revised");
      await section.getByRole("button", { name: "Search", exact: true }).click();
      await expect(section.getByRole("button", { name: "context.txt", exact: true })).toBeHidden();
      await expect(
        section.getByRole("button", { name: "proposal.png", exact: true }).first(),
      ).toBeVisible();
      await section.getByRole("button", { name: "Clear", exact: true }).click();
      await expect(section.getByRole("button", { name: "context.txt", exact: true })).toBeVisible();
      const all = await portal.request.get(`/api/v1/portal/${module}s/${record.number}/documents`);
      expect(all.status()).toBe(200);
      expect(
        (await all.json()).documents.find((document: { id: string }) => document.id === paper.id)
          .isPrimary,
      ).toBe(module === "contract");
      await section.scrollIntoViewIfNeeded();
      await reportAxeViolations(portal, testInfo, `portal-${module}-documents`);
      await portal.screenshot({ path: `/tmp/openlaw-portal-${module}-documents.png` });
      await portal.setViewportSize({ width: 390, height: 844 });
      await section.scrollIntoViewIfNeeded();
      expect(await section.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await section.getByRole("button", { name: "Upload documents", exact: true }).click();
      await expect(dialog).toBeVisible();
      await reportAxeViolations(portal, testInfo, `portal-${module}-upload-mobile`);
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    }
  } finally {
    for (const record of records)
      await page.request.delete(`/api/v1/${record.module}s/${record.number}`);
    await ensureMemberInert(page.request, email);
    await colleague.context.close();
  }
});
