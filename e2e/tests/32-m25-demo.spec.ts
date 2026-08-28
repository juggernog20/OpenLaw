// SPDX-License-Identifier: AGPL-3.0-only

/** M25 close (#539): find a Contract by words that exist only in its PDF. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { z } from "zod";
import { ADMIN, ensureAdminExists, signInAs } from "./helpers.js";

test.setTimeout(240_000);

const RUN = Date.now();
const CONTRACT_TITLE = `E2E M25 document search ${RUN}`;
const PDF_NAME = `assignment-${RUN}.pdf`;
const SEARCH_PHRASE = "assignor transfers the whole of the rights";
const DERIVATION_TIMEOUT_MS = 180_000;

const PDF = readFileSync(
  fileURLToPath(
    new URL("../../apps/api/src/testing/fixtures/doc-engine/native-text.pdf", import.meta.url),
  ),
);

const CreatedContract = z.object({
  contract: z.object({ id: z.string(), number: z.number().int() }),
});

const Document = z.object({
  id: z.string(),
  title: z.string(),
  versions: z.array(
    z.object({
      id: z.string(),
      versionNumber: z.number().int(),
    }),
  ),
});

const CreatedDocument = z.object({ document: Document });

const TextEnvelope = z.object({
  text: z.object({
    state: z.enum(["pending", "ready", "failed", "unsupported"]),
    source: z.string().nullable(),
    text: z.string().nullable(),
  }),
});

async function createContract(request: APIRequestContext) {
  const options = await request.get("/api/v1/contracts/options");
  expect(options.status(), await options.text()).toBe(200);
  const contractType = z
    .object({
      contractTypes: z.array(
        z.object({ id: z.string(), fields: z.array(z.object({ isRequired: z.boolean() })) }),
      ),
    })
    .parse(await options.json())
    .contractTypes.find((row) => row.fields.every((field) => !field.isRequired));
  expect(
    contractType,
    "the install has no Contract Type without a hard-required Field",
  ).toBeDefined();

  const created = await request.post("/api/v1/contracts", {
    data: { title: CONTRACT_TITLE, contractTypeId: contractType!.id },
  });
  expect(created.status(), await created.text()).toBe(201);
  return CreatedContract.parse(await created.json()).contract;
}

function documentsSection(page: Page): Locator {
  return page.getByRole("region", { name: "Documents" });
}

async function uploadPdf(page: Page) {
  await documentsSection(page).getByRole("button", { name: "Upload" }).click();
  const dialog = page.getByRole("dialog");
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "File Choose file" }).click();
  await (await chooser).setFiles({ name: PDF_NAME, mimeType: "application/pdf", buffer: PDF });
  await expect(dialog.getByText(PDF_NAME)).toBeVisible();
  await dialog.getByLabel("Kind").selectOption("draft_ours");
  await dialog.getByLabel("Note").fill("The source paper for the M25 search journey.");

  const uploaded = page.waitForResponse(
    (response) =>
      /\/api\/v1\/contracts\/\d+\/documents$/.test(response.url()) &&
      response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  const response = await uploaded;
  expect(response.status(), await response.text()).toBe(201);
  return CreatedDocument.parse(await response.json()).document;
}

async function waitForText(page: Page, documentId: string, versionId: string): Promise<void> {
  const address = `/api/v1/documents/${documentId}/versions/${versionId}/text`;
  await expect
    .poll(
      async () => {
        const response = await page.request.get(address);
        if (response.status() !== 200) return `HTTP ${response.status()}`;
        const text = TextEnvelope.parse(await response.json()).text;
        if (text.state === "failed" || text.state === "unsupported") {
          throw new Error(`the extraction at ${address} settled as ${text.state}`);
        }
        if (text.state === "ready") {
          expect(text.source).toBe("native_layer");
          expect(text.text?.toLowerCase()).toContain(SEARCH_PHRASE);
        }
        return text.state;
      },
      {
        message: `the extracted text at ${address} never became ready`,
        timeout: DERIVATION_TIMEOUT_MS,
        intervals: [1_000],
      },
    )
    .toBe("ready");
}

test.describe.serial("M25 deployer journey", () => {
  test.beforeAll(async ({ request }) => ensureAdminExists(request));

  test("presses /, searches PDF-only words, and opens that version with find pre-filled", async ({
    page,
  }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
    const contract = await createContract(page.request);
    let document: z.infer<typeof Document> | undefined;

    const cleanup = async () => {
      const failures: unknown[] = [];
      if (document) {
        await page.request
          .delete(`/api/v1/documents/${document.id}`, {
            data: { confirmTitle: document.title },
          })
          .then(async (response) => {
            expect(response.status(), await response.text()).toBe(200);
          })
          .catch((error: unknown) => failures.push(error));
      }
      await page.request
        .post(`/api/v1/contracts/${contract.number}/archive`)
        .then(async (response) => {
          expect(response.status(), await response.text()).toBe(200);
        })
        .catch((error: unknown) => failures.push(error));
      if (failures.length > 0) throw new AggregateError(failures, "M25 demo cleanup failed");
    };

    try {
      await page.goto(`/contracts/${contract.number}/documents`);
      document = await uploadPdf(page);
      const version = document.versions[0]!;
      expect(version.versionNumber).toBe(1);
      await waitForText(page, document.id, version.id);

      // Home has no page-level search input, so DES-010 sends `/` to
      // the global header box rather than to a list's local filter.
      await page.goto("/");
      const search = page.getByRole("banner").getByRole("combobox", { name: "Search" });
      // The `/` binding is attached in a React effect after hydration.
      // Wait for the header box to render before pressing the key, or
      // the keystroke can land before anything listens for it.
      await expect(search).toBeVisible();
      await page.keyboard.press("/");
      await expect(search).toBeFocused();
      await page.keyboard.type(SEARCH_PHRASE);

      const answer = page.getByRole("listbox", { name: "Search results" });
      const hit = answer.getByRole("option").filter({ hasText: document.title });
      await expect(hit).toContainText(SEARCH_PHRASE, { ignoreCase: true });
      await hit.click();

      await expect(page).toHaveURL(new RegExp(`/contracts/${contract.number}/documents\\?`));
      const landed = new URL(page.url());
      expect(landed.searchParams.get("doc")).toBe(document.id);
      expect(landed.searchParams.get("version")).toBe(version.id);
      expect(landed.searchParams.get("find")).toBe(SEARCH_PHRASE);

      const panel = page.getByRole("complementary", {
        name: `${document.title}, version ${version.versionNumber}`,
      });
      await expect(panel).toBeVisible();
      await expect(panel.getByRole("searchbox", { name: "Find in document" })).toHaveValue(
        SEARCH_PHRASE,
      );
    } finally {
      await cleanup();
    }
  });
});
