// SPDX-License-Identifier: AGPL-3.0-only

/**
 * M32 milestone acceptance (#684): compare two Word rounds on the built
 * Compose stack, then export and read the generated redline.
 *
 * The committed office fixtures are a real edit pair. The worker sends
 * them to the real doc-engine image, so the preparing card, change model,
 * tracked-changes export, and exported Version rendition all come from
 * LibreOffice rather than the deterministic test engine.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { z } from "zod";
import {
  ADMIN,
  ensureAdminExists,
  reportAxeViolations,
  signInAs,
  sweepOrSay,
  switchTheme,
} from "./helpers.js";

test.setTimeout(480_000);

const CONTRACT_PREFIX = "E2E M32 redline compare";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const FIRST_NOTE = "Our first Word round for the M32 demo.";
const SECOND_NOTE = "Their edited Word round for the M32 demo.";

function fixture(name: string): Buffer {
  return readFileSync(
    fileURLToPath(
      new URL(`../../apps/api/src/testing/fixtures/doc-engine/${name}`, import.meta.url),
    ),
  );
}

const OLDER_DOCX = fixture("compare-older.docx");
const NEWER_DOCX = fixture("compare-newer.docx");

const ContractRows = z.object({
  contracts: z.array(z.object({ number: z.number().int(), title: z.string() })),
  nextCursor: z.string().nullable(),
});

const ContractOptions = z.object({
  contractTypes: z.array(
    z.object({
      displayName: z.string(),
      fields: z.array(z.object({ isRequired: z.boolean() })),
    }),
  ),
});

const CreatedContract = z.object({
  contract: z.object({ number: z.number().int(), title: z.string() }),
});

const Version = z.object({
  id: z.string(),
  versionNumber: z.number().int(),
  originalFilename: z.string(),
});

const Document = z.object({
  id: z.string(),
  title: z.string(),
  versions: z.array(Version),
});

const DocumentEnvelope = z.object({ document: Document });
const DocumentRows = z.object({ documents: z.array(Document) });
const RenditionEnvelope = z.object({ rendition: z.object({ state: z.string() }) });

type DocumentRow = z.infer<typeof Document>;

async function listContracts(request: APIRequestContext) {
  const rows: z.infer<typeof ContractRows>["contracts"] = [];
  let cursor: string | undefined;
  do {
    const response = await request.get("/api/v1/contracts", {
      params: cursor ? { cursor } : undefined,
    });
    expect(response.status(), await response.text()).toBe(200);
    const page = ContractRows.parse(await response.json());
    rows.push(...page.contracts);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return rows;
}

async function readPaper(request: APIRequestContext, number: number): Promise<DocumentRow[]> {
  const response = await request.get(`/api/v1/contracts/${number}/documents?includeArchived=true`);
  expect(response.status(), await response.text()).toBe(200);
  return DocumentRows.parse(await response.json()).documents;
}

async function ensureDemoContractsInert(request: APIRequestContext): Promise<void> {
  for (const contract of (await listContracts(request)).filter((row) =>
    row.title.startsWith(CONTRACT_PREFIX),
  )) {
    for (const document of await readPaper(request, contract.number)) {
      const erased = await request.delete(`/api/v1/documents/${document.id}`, {
        data: { confirmTitle: document.title },
      });
      expect(erased.status(), await erased.text()).toBe(200);
    }
    const archived = await request.post(`/api/v1/contracts/${contract.number}/archive`);
    expect(archived.status(), await archived.text()).toBe(200);
  }
}

async function bareContractTypeName(request: APIRequestContext): Promise<string> {
  const response = await request.get("/api/v1/contracts/options");
  expect(response.status(), await response.text()).toBe(200);
  const type = ContractOptions.parse(await response.json()).contractTypes.find((candidate) =>
    candidate.fields.every((field) => !field.isRequired),
  );
  expect(type, "the install has no Contract Type without a hard-required Field").toBeDefined();
  return type!.displayName;
}

function documentsSection(page: Page): Locator {
  return page.getByRole("region", { name: "Documents" });
}

async function createContract(page: Page, title: string, typeName: string) {
  await page.goto("/contracts");
  await page.getByRole("button", { name: "Create contract" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Contract type").selectOption({ label: typeName });
  const creating = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/contracts") && response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  const created = await creating;
  expect(created.status(), await created.text()).toBe(201);
  await expect(dialog).toBeHidden();
  return CreatedContract.parse(await created.json()).contract;
}

async function uploadRound(
  page: Page,
  open: () => Promise<void>,
  file: { name: string; body: Buffer; kind: string; note: string },
): Promise<DocumentRow> {
  await open();
  const dialog = page.getByRole("dialog");
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "File Choose file" }).click();
  await (await chooser).setFiles({ name: file.name, mimeType: DOCX_MIME, buffer: file.body });
  await expect(dialog.getByText(file.name)).toBeVisible();
  await dialog.getByLabel("Kind").selectOption(file.kind);
  await dialog.getByLabel("Note").fill(file.note);
  const uploading = page.waitForResponse(
    (response) =>
      /\/api\/v1\/(contracts\/\d+\/documents|documents\/[^/]+\/versions)$/.test(response.url()) &&
      response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  const uploaded = await uploading;
  expect(uploaded.status(), await uploaded.text()).toBe(201);
  await expect(dialog).toBeHidden();
  return DocumentEnvelope.parse(await uploaded.json()).document;
}

async function waitForRendition(
  request: APIRequestContext,
  documentId: string,
  versionId: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await request.get(
          `/api/v1/documents/${documentId}/versions/${versionId}/rendition`,
        );
        expect(response.status(), await response.text()).toBe(200);
        return RenditionEnvelope.parse(await response.json()).rendition.state;
      },
      { timeout: 180_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe("ready");
}

test.describe.serial("M32 deployer journey", () => {
  test.beforeAll(async ({ request }) => ensureAdminExists(request));

  test("compares two Word rounds, exports the redline, and reads its rendition", async ({
    page,
  }, testInfo) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
    await ensureDemoContractsInert(page.request);
    await switchTheme(page, ADMIN.displayName, "Light");

    const stamp = Date.now();
    const title = `${CONTRACT_PREFIX} ${stamp}`;
    const olderName = `m32-services-v1-${stamp}.docx`;
    const newerName = `m32-services-v2-${stamp}.docx`;
    let contract: z.infer<typeof CreatedContract>["contract"] | undefined;
    let document: DocumentRow | undefined;

    const cleanup = async () => {
      const failures: unknown[] = [];
      const settle = async (step: () => Promise<void>) => {
        await step().catch((error: unknown) => failures.push(error));
      };
      await settle(async () => {
        if (document) {
          const erased = await page.request.delete(`/api/v1/documents/${document.id}`, {
            data: { confirmTitle: document.title },
          });
          expect(erased.status(), await erased.text()).toBe(200);
        }
      });
      await settle(async () => {
        if (contract) {
          const archived = await page.request.post(`/api/v1/contracts/${contract.number}/archive`);
          expect(archived.status(), await archived.text()).toBe(200);
        }
      });
      await settle(() => switchTheme(page, ADMIN.displayName, "Light"));
      if (failures.length > 0) throw new AggregateError(failures, "M32 demo cleanup failed");
    };

    try {
      contract = await createContract(page, title, await bareContractTypeName(page.request));
      await page.goto(`/contracts/${contract.number}/documents`);

      document = await uploadRound(
        page,
        () => documentsSection(page).getByRole("button", { name: "Upload" }).click(),
        { name: olderName, body: OLDER_DOCX, kind: "draft_ours", note: FIRST_NOTE },
      );
      expect(document.versions.map((version) => version.versionNumber)).toEqual([1]);

      const documentActions = documentsSection(page).getByRole("button", {
        name: `Actions for ${document.title}`,
      });
      document = await uploadRound(
        page,
        async () => {
          await documentActions.click();
          await page.getByRole("menuitem", { name: "Add version" }).click();
        },
        { name: newerName, body: NEWER_DOCX, kind: "draft_theirs", note: SECOND_NOTE },
      );
      expect(document.versions.map((version) => version.versionNumber)).toEqual([1, 2]);

      const currentRow = documentsSection(page).getByRole("row").filter({ hasText: SECOND_NOTE });
      await currentRow.getByRole("button", { name: `Actions for ${document.title}` }).click();
      await page.getByRole("menuitem", { name: "Compare with previous" }).click();
      await expect(page).toHaveURL(/\/documents\/[^/]+\/compare\?from=[^&]+&to=[^&]+$/);
      const compareUrl = page.url();

      await expect(page.getByRole("status")).toContainText("Preparing comparison");
      const changes = page.getByRole("complementary", { name: "Changes" });
      const count = changes.getByLabel(/^\d+ changes?$/);
      await expect(count, "the real sidecar comparison never became ready").toBeVisible({
        timeout: 180_000,
      });
      expect(Number(await count.textContent())).toBeGreaterThan(0);

      const change = changes.getByRole("button", {
        name: /, (Inserted|Deleted|Replaced)$/,
      });
      await change.last().click();
      await expect(change.last()).toHaveAttribute("aria-current", "true");

      expect(await reportAxeViolations(page, testInfo, "M32 compare screen, Light")).toEqual([]);
      await switchTheme(page, ADMIN.displayName, "Dark");
      await page.goto(compareUrl);
      await expect(page.getByRole("complementary", { name: "Changes" })).toBeVisible();
      expect(await reportAxeViolations(page, testInfo, "M32 compare screen, Dark")).toEqual([]);

      const exporting = page.waitForResponse(
        (response) =>
          /\/api\/v1\/documents\/[^/]+\/comparisons\/[^/]+\/export$/.test(response.url()) &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Export track changes" }).click();
      const exported = await exporting;
      expect(exported.status(), await exported.text()).toBe(201);
      const generated = z.object({ version: Version }).parse(await exported.json()).version;

      await page.getByRole("link", { name: "Close comparison" }).click();
      await expect(page).toHaveURL(`/contracts/${contract.number}/documents`);
      const generatedRow = documentsSection(page)
        .getByRole("row")
        .filter({ hasText: "Compares v1 and v2" });
      await expect(generatedRow.getByText("Generated redline", { exact: true })).toBeVisible();
      await expect(generatedRow.getByText("Compares v1 and v2", { exact: true })).toBeVisible();
      await generatedRow.getByRole("button", { name: document.title, exact: true }).click();

      const panel = page.getByRole("complementary", {
        name: `${document.title}, version ${generated.versionNumber}`,
      });
      await expect(panel).toBeVisible();
      await waitForRendition(page.request, document.id, generated.id);
      await expect(
        panel.locator(".textLayer").first(),
        "the generated redline has no rendition",
      ).toBeAttached({
        timeout: 30_000,
      });
    } catch (error) {
      await sweepOrSay("the M32 demo", cleanup);
      throw error;
    }
    await cleanup();
  });
});
