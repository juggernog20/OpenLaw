// SPDX-License-Identifier: AGPL-3.0-only

/** M26 close (#560): find a Document without knowing its owning record. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { z } from "zod";
import { ADMIN, ensureAdminExists, signInAs } from "./helpers.js";

test.setTimeout(240_000);

const RUN = Date.now();
const CONTRACT_TITLE = `E2E M26 filtered contract ${RUN}`;
const MATTER_TITLE = `E2E M26 filter decoy ${RUN}`;
const COUNTERPARTY_NAME = `E2E M26 Northwind ${RUN}`;
const CONTRACT_PDF_NAME = `m26-contract-${RUN}.pdf`;
const MATTER_PDF_NAME = `m26-matter-${RUN}.pdf`;

const PDF = readFileSync(
  fileURLToPath(
    new URL("../../apps/api/src/testing/fixtures/doc-engine/native-text.pdf", import.meta.url),
  ),
);

const CreatedContract = z.object({
  contract: z.object({ id: z.string(), number: z.number().int() }),
});

const CreatedMatter = z.object({
  matter: z.object({ id: z.string(), number: z.number().int() }),
});

const CreatedDocument = z.object({
  document: z.object({
    id: z.string(),
    title: z.string(),
    versions: z.array(
      z.object({
        id: z.string(),
        versionNumber: z.number().int(),
      }),
    ),
  }),
});

type Document = z.infer<typeof CreatedDocument>["document"];

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
  const contract = CreatedContract.parse(await created.json()).contract;

  const counterparty = await request.post(
    `/api/v1/contracts/${String(contract.number)}/counterparties`,
    { data: { name: COUNTERPARTY_NAME } },
  );
  expect(counterparty.status(), await counterparty.text()).toBe(201);
  expect(
    z
      .object({ counterparties: z.array(z.object({ name: z.string() })) })
      .parse(await counterparty.json())
      .counterparties.some((row) => row.name === COUNTERPARTY_NAME),
  ).toBe(true);

  return contract;
}

async function createMatter(request: APIRequestContext) {
  const options = await request.get("/api/v1/matters/options");
  expect(options.status(), await options.text()).toBe(200);
  const matterType = z
    .object({
      matterTypes: z.array(
        z.object({ id: z.string(), fields: z.array(z.object({ isRequired: z.boolean() })) }),
      ),
    })
    .parse(await options.json())
    .matterTypes.find((row) => row.fields.every((field) => !field.isRequired));
  expect(matterType, "the install has no Matter Type without a hard-required Field").toBeDefined();

  const created = await request.post("/api/v1/matters", {
    data: { title: MATTER_TITLE, matterTypeId: matterType!.id },
  });
  expect(created.status(), await created.text()).toBe(201);
  return CreatedMatter.parse(await created.json()).matter;
}

function documentsSection(page: Page): Locator {
  return page.getByRole("region", { name: "Documents" });
}

async function uploadPdf(
  page: Page,
  owner: { kind: "contracts" | "matters"; number: number },
  filename: string,
) {
  await page.goto(`/${owner.kind}/${String(owner.number)}/documents`);
  await documentsSection(page).getByRole("button", { name: "Upload" }).click();
  const dialog = page.getByRole("dialog");
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "File Choose file" }).click();
  await (await chooser).setFiles({ name: filename, mimeType: "application/pdf", buffer: PDF });
  await expect(dialog.getByText(filename)).toBeVisible();
  await dialog.getByLabel("Kind").selectOption("draft_ours");

  const uploaded = page.waitForResponse(
    (response) =>
      new RegExp(`/api/v1/${owner.kind}/\\d+/documents$`).test(response.url()) &&
      response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  const response = await uploaded;
  expect(response.status(), await response.text()).toBe(201);
  return CreatedDocument.parse(await response.json()).document;
}

test.describe.serial("M26 deployer journey", () => {
  test.beforeAll(async ({ request }) => ensureAdminExists(request));

  test("filters by Counterparty and format, then opens the matching Contract Document", async ({
    page,
  }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
    const contract = await createContract(page.request);
    const matter = await createMatter(page.request);
    let contractDocument: Document | undefined;
    let matterDocument: Document | undefined;

    const cleanup = async () => {
      const failures: unknown[] = [];
      const settle = async (step: () => Promise<void>) => {
        await step().catch((error: unknown) => failures.push(error));
      };
      for (const document of [contractDocument, matterDocument]) {
        if (!document) continue;
        await settle(async () => {
          const deleted = await page.request.delete(`/api/v1/documents/${document.id}`, {
            data: { confirmTitle: document.title },
          });
          expect(deleted.status(), await deleted.text()).toBe(200);
        });
      }
      await settle(async () => {
        const archived = await page.request.post(
          `/api/v1/contracts/${String(contract.number)}/archive`,
        );
        expect(archived.status(), await archived.text()).toBe(200);
      });
      await settle(async () => {
        const archived = await page.request.post(
          `/api/v1/matters/${String(matter.number)}/archive`,
        );
        expect(archived.status(), await archived.text()).toBe(200);
      });
      if (failures.length > 0) throw new AggregateError(failures, "M26 demo cleanup failed");
    };

    try {
      contractDocument = await uploadPdf(
        page,
        { kind: "contracts", number: contract.number },
        CONTRACT_PDF_NAME,
      );
      matterDocument = await uploadPdf(
        page,
        { kind: "matters", number: matter.number },
        MATTER_PDF_NAME,
      );

      await page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("link", { name: "Documents", exact: true })
        .click();
      await expect(page).toHaveURL(/\/documents$/);

      await page
        .getByRole("combobox", { name: "Counterparty" })
        .selectOption({ label: COUNTERPARTY_NAME });
      await page.getByRole("combobox", { name: "Format" }).selectOption("pdf");
      await expect(page).toHaveURL(/counterparty=/);
      await expect(page).toHaveURL(/format=pdf/);

      const matchingRow = page.getByRole("row").filter({ hasText: contractDocument.title });
      await expect(matchingRow).toContainText(`C-${String(contract.number)} · ${CONTRACT_TITLE}`);
      await expect(page.getByText(matterDocument.title, { exact: true })).not.toBeVisible();
      await matchingRow.getByRole("link", { name: contractDocument.title }).click();

      const version = contractDocument.versions[0]!;
      await expect(page).toHaveURL(
        new RegExp(`/contracts/${String(contract.number)}/documents\\?`),
      );
      const landed = new URL(page.url());
      expect(landed.searchParams.get("doc")).toBe(contractDocument.id);
      expect(landed.searchParams.get("version")).toBe(version.id);
      await expect(
        page.getByRole("complementary", {
          name: `${contractDocument.title}, version ${String(version.versionNumber)}`,
        }),
      ).toBeVisible();
    } finally {
      await cleanup();
    }
  });
});
