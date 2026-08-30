// SPDX-License-Identifier: AGPL-3.0-only

/** M28 close (#598): publish file-first Knowledge and open it from the portal. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { z } from "zod";
import { ADMIN, ensureAdminExists, ensureMemberInert, signInAs, sweepOrSay } from "./helpers.js";
import { extractLink, waitForMailTo } from "./mailpit.js";

test.setTimeout(240_000);

const RUN = Date.now();
const RUN_DOMAIN = `m28-${RUN}.example`;
const REQUESTER = `requester@${RUN_DOMAIN}`;
const FILENAME = `nda-playbook-${RUN}.docx`;
const ITEM_TITLE = FILENAME;
const LINK_LABEL = `Read the NDA playbook ${RUN}`;
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOCX = readFileSync(
  fileURLToPath(
    new URL("../../apps/api/src/testing/fixtures/doc-engine/plain.docx", import.meta.url),
  ),
);

const DomainsEnvelope = z.object({ domains: z.array(z.string()) });
const CreatedItems = z.object({
  knowledgeItems: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      primaryDocumentId: z.string(),
    }),
  ),
});
const CreatedLink = z.object({ intakeLink: z.object({ id: z.string() }) });

async function enterPortalByMagicLink(
  context: BrowserContext,
  api: APIRequestContext,
): Promise<Page> {
  const page = await context.newPage();
  await page.goto("/portal/enter");
  await page.getByLabel("Email").fill(REQUESTER);
  await page.getByRole("button", { name: "Send link" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();

  const mail = await waitForMailTo(api, REQUESTER, /^Sign in to OpenLaw$/);
  await page.goto(extractLink(mail.text, "/api/auth/magic-link/verify"));
  await expect(page).toHaveURL(/\/portal$/);
  return page;
}

async function dropFile(page: Page) {
  const dialog = page.getByRole("dialog", { name: "New from files" });
  const dataTransfer = await page.evaluateHandle(
    ({ base64, filename, mimeType }) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], filename, { type: mimeType }));
      return transfer;
    },
    { base64: DOCX.toString("base64"), filename: FILENAME, mimeType: DOCX_MIME },
  );
  try {
    await dialog
      .getByText("Drop files here or choose files")
      .locator("..")
      .dispatchEvent("drop", { dataTransfer });
  } finally {
    await dataTransfer.dispose();
  }
  await expect(dialog.getByText("1 file selected")).toBeVisible();
  return dialog;
}

test.describe.serial("M28 deployer journey", () => {
  test.beforeAll(async ({ request }) => ensureAdminExists(request));

  test("drops a playbook, publishes it to the portal, and opens it from Before you submit", async ({
    page,
    browser,
  }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    const domainsRead = await page.request.get("/api/v1/auth/allowed-domains");
    expect(domainsRead.status(), await domainsRead.text()).toBe(200);
    const domainsBefore = DomainsEnvelope.parse(await domainsRead.json()).domains;
    const domainsWritten = await page.request.put("/api/v1/auth/allowed-domains", {
      data: { domains: [...domainsBefore, RUN_DOMAIN] },
    });
    expect(domainsWritten.status(), await domainsWritten.text()).toBe(200);

    let itemId: string | undefined;
    let linkId: string | undefined;
    let portalContext: BrowserContext | undefined;

    const leaveInert = async () => {
      const failures: unknown[] = [];
      const settle = async (step: () => Promise<void>) => {
        await step().catch((error: unknown) => failures.push(error));
      };
      if (linkId) {
        await settle(async () => {
          const removed = await page.request.delete(`/api/v1/intake-links/${linkId}`);
          expect(removed.status(), await removed.text()).toBe(204);
        });
      }
      if (itemId) {
        await settle(async () => {
          const archived = await page.request.post(`/api/v1/knowledge/${itemId}/archive`, {
            data: {},
          });
          expect(archived.status(), await archived.text()).toBe(200);
        });
      }
      await settle(async () => {
        const restored = await page.request.put("/api/v1/auth/allowed-domains", {
          data: { domains: domainsBefore },
        });
        expect(restored.status(), await restored.text()).toBe(200);
      });
      if (portalContext) await settle(() => portalContext!.close());
      await settle(() => ensureMemberInert(page.request, REQUESTER));
      if (failures.length > 0) throw new AggregateError(failures, "M28 demo cleanup failed");
    };

    try {
      await page.goto("/knowledge");
      await page.getByRole("button", { name: "New" }).first().click();
      await page.getByRole("menuitem", { name: "New from files" }).click();
      const dialog = await dropFile(page);
      await dialog.getByLabel("Type").selectOption({ label: "Playbook" });
      const created = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/knowledge/from-files") &&
          response.request().method() === "POST",
      );
      await dialog.getByRole("button", { name: "Create drafts" }).click();
      const createdResponse = await created;
      expect(createdResponse.status(), await createdResponse.text()).toBe(201);
      const [item] = CreatedItems.parse(await createdResponse.json()).knowledgeItems;
      expect(item).toMatchObject({ title: ITEM_TITLE });
      expect(item?.primaryDocumentId).toBeTruthy();
      itemId = item!.id;
      await expect(page).toHaveURL(`/knowledge/${itemId}`);
      await expect(page.getByText("Primary document")).toBeVisible();
      await expect(page.getByRole("button", { name: "Open preview" })).toContainText(FILENAME);

      await page.getByRole("button", { name: "Knowledge Item actions" }).click();
      const published = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/knowledge/${itemId}/publish`) &&
          response.request().method() === "POST",
      );
      await page.getByRole("menuitem", { name: "Publish" }).click();
      expect((await published).status()).toBe(200);
      await expect(page.getByText("Draft", { exact: true })).toBeHidden();

      const audienceChanged = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/knowledge/${itemId}`) &&
          response.request().method() === "PATCH",
      );
      await page.getByLabel("Audience").selectOption("everyone");
      expect((await audienceChanged).status()).toBe(200);
      await expect(page.getByText("On the portal")).toBeVisible();

      await page.goto("/settings/intake/links");
      await page.getByRole("button", { name: "Add link" }).click();
      const linkDialog = page.getByRole("dialog", { name: "Add link" });
      await linkDialog.getByRole("radio", { name: "Knowledge item" }).click();
      await linkDialog.getByRole("combobox", { name: "Knowledge item" }).selectOption(itemId);
      await linkDialog.getByLabel("Label").fill(LINK_LABEL);
      await linkDialog.getByLabel("Placement").selectOption({ label: "Portal home" });
      const linkCreated = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/intake-links") && response.request().method() === "POST",
      );
      await linkDialog.getByRole("button", { name: "Add link" }).click();
      const linkResponse = await linkCreated;
      expect(linkResponse.status(), await linkResponse.text()).toBe(201);
      linkId = CreatedLink.parse(await linkResponse.json()).intakeLink.id;

      portalContext = await browser.newContext();
      const portal = await enterPortalByMagicLink(portalContext, page.request);
      const panel = portal.getByRole("region", { name: "Before you submit" });
      await panel.getByRole("link", { name: LINK_LABEL }).click();
      await expect(portal).toHaveURL(`/portal/knowledge/${itemId}`);
      await expect(portal.getByRole("heading", { name: ITEM_TITLE })).toBeVisible();
      const files = portal.getByRole("region", { name: "Files" });
      await expect(files.getByText(FILENAME)).toBeVisible();
      await expect(files.getByRole("link", { name: `Download ${FILENAME}` })).toBeVisible();
    } catch (error) {
      await sweepOrSay("the M28 demo", leaveInert);
      throw error;
    }
    await leaveInert();
  });
});
