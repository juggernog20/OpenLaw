// SPDX-License-Identifier: AGPL-3.0-only

/**
 * M31 milestone acceptance (#661): AI analysis on the built Compose stack.
 *
 * An Administrator stores a custom connector through Settings and uploads
 * a PDF to a new Contract. The worker calls the host-side stand-in through
 * the stored base URL. A second browser watches the automatic run fill the
 * term, value, and notice period without a reload, then confirms one value.
 */

import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { z } from "zod";
import { ADMIN, ensureAdminExists, reportAxeViolations, signInAs, sweepOrSay } from "./helpers.js";
import { demoContractPdf, OpenAiStub } from "./openai.js";

test.setTimeout(360_000);

const RUN = Date.now();
const CONTRACT_PREFIX = "E2E M31 analyzed services agreement";
const CONTRACT_TITLE = `${CONTRACT_PREFIX} ${RUN}`;
const PDF_NAME = `m31-services-${RUN}.pdf`;
const API_KEY = `openlaw-m31-${RUN}`;
const MODEL = "openlaw-m31-canned-extraction";

const ContractRows = z.object({
  contracts: z.array(z.object({ number: z.number().int(), title: z.string() })),
  nextCursor: z.string().nullable(),
});

const ContractOptions = z.object({
  contractTypes: z.array(
    z.object({
      id: z.string(),
      displayName: z.string(),
      fields: z.array(z.object({ isRequired: z.boolean() })),
    }),
  ),
});

const CreatedContract = z.object({
  contract: z.object({ id: z.string(), number: z.number().int(), title: z.string() }),
});

const CreatedDocument = z.object({
  document: z.object({
    id: z.string(),
    title: z.string(),
    versions: z.array(z.object({ id: z.string(), versionNumber: z.number().int() })),
  }),
});

const ConnectorState = z.object({
  connector: z.object({ configured: z.boolean(), enabled: z.boolean() }),
});

async function readConnector(request: APIRequestContext) {
  const response = await request.get("/api/v1/ai-connector");
  expect(response.status(), await response.text()).toBe(200);
  return ConnectorState.parse(await response.json()).connector;
}

async function removeConnector(request: APIRequestContext): Promise<void> {
  if (!(await readConnector(request)).configured) return;
  const removed = await request.delete("/api/v1/ai-connector");
  expect(removed.status(), await removed.text()).toBe(200);
}

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

async function ensureDemoContractsInert(request: APIRequestContext): Promise<void> {
  for (const contract of (await listContracts(request)).filter((row) =>
    row.title.startsWith(CONTRACT_PREFIX),
  )) {
    const paper = await request.get(
      `/api/v1/contracts/${contract.number}/documents?includeArchived=true`,
    );
    expect(paper.status(), await paper.text()).toBe(200);
    const documents = z
      .object({ documents: z.array(z.object({ id: z.string(), title: z.string() })) })
      .parse(await paper.json()).documents;
    for (const document of documents) {
      const erased = await request.delete(`/api/v1/documents/${document.id}`, {
        data: { confirmTitle: document.title },
      });
      expect(erased.status(), await erased.text()).toBe(200);
    }
    const archived = await request.post(`/api/v1/contracts/${contract.number}/archive`);
    expect(archived.status(), await archived.text()).toBe(200);
  }
}

async function bareContractType(request: APIRequestContext): Promise<string> {
  const response = await request.get("/api/v1/contracts/options");
  expect(response.status(), await response.text()).toBe(200);
  const type = ContractOptions.parse(await response.json()).contractTypes.find((candidate) =>
    candidate.fields.every((field) => !field.isRequired),
  );
  expect(type, "the install has no Contract Type without a hard-required Field").toBeDefined();
  return type!.displayName;
}

async function configureConnector(page: Page, stub: OpenAiStub, testInfo: TestInfo): Promise<void> {
  // AI analysis is an Organization section of its own (SET-008, #675).
  await page.goto("/settings/ai-analysis");
  await expect(
    page
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("link", { name: "AI analysis" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { level: 2, name: "Provider" })).toBeVisible();

  const provider = page.getByRole("button", { name: "Provider", exact: true });
  if ((await provider.getAttribute("aria-expanded")) === "false") await provider.click();
  await page.getByLabel("Provider").selectOption({ label: "Custom endpoint" });
  await page.getByLabel("Protocol").selectOption({ label: "OpenAI-compatible chat completions" });
  await page.getByLabel("Base URL").fill(stub.baseUrl);
  await page.getByLabel("API key").fill(API_KEY);
  await page.getByLabel("Model").fill(MODEL);

  const saving = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/ai-connector") && response.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "Save connector" }).click();
  const saved = await saving;
  expect(saved.status(), await saved.text()).toBe(200);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  if (!(await readConnector(page.request)).enabled) {
    const enabling = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/ai-connector/enable") &&
        response.request().method() === "POST",
    );
    await page.getByRole("switch", { name: "Use AI analysis" }).click();
    const enabled = await enabling;
    expect(enabled.status(), await enabled.text()).toBe(200);
  }

  const testing = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/ai-connector/test") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Test connection" }).click();
  const tested = await testing;
  expect(tested.status(), await tested.text()).toBe(200);
  await expect(page.getByText("Connection successful.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Field prompts" })).toBeVisible();
  expect(await reportAxeViolations(page, testInfo, "M31 AI analysis settings")).toEqual([]);
}

async function createContract(page: Page, typeName: string) {
  await page.goto("/contracts");
  await page.getByRole("button", { name: "Create contract" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill(CONTRACT_TITLE);
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

function documentsSection(page: Page): Locator {
  return page.getByRole("region", { name: "Documents" });
}

async function uploadDemoPdf(page: Page) {
  await documentsSection(page).getByRole("button", { name: "Upload" }).click();
  const dialog = page.getByRole("dialog");
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "File Choose file" }).click();
  await (
    await chooser
  ).setFiles({
    name: PDF_NAME,
    mimeType: "application/pdf",
    buffer: demoContractPdf(),
  });
  await expect(dialog.getByText(PDF_NAME)).toBeVisible();
  await dialog.getByLabel("Kind").selectOption("executed");
  await dialog.getByLabel("Note").fill("The M31 built-stack analysis demo Contract.");
  const uploading = page.waitForResponse(
    (response) =>
      /\/api\/v1\/contracts\/\d+\/documents$/.test(response.url()) &&
      response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  const uploaded = await uploading;
  expect(uploaded.status(), await uploaded.text()).toBe(201);
  await expect(dialog).toBeHidden();
  return CreatedDocument.parse(await uploaded.json()).document;
}

function markerBeside(page: Page, label: string): Locator {
  return page
    .getByRole("heading", { level: 2, name: "Contract" })
    .locator("xpath=ancestor::section[1]")
    .getByText(label, { exact: true })
    .locator("..")
    .getByText("Unverified", { exact: true });
}

function analysisCard(page: Page): Locator {
  return page
    .getByRole("heading", { level: 2, name: "AI analysis" })
    .locator("xpath=ancestor::section[1]");
}

test.describe.serial("M31 deployer journey", () => {
  test.beforeAll(async ({ request }) => ensureAdminExists(request));

  test("configures, extracts, confirms, and updates a second browser live", async ({
    page,
    browser,
  }, testInfo) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
    await ensureDemoContractsInert(page.request);

    let stub: OpenAiStub | undefined;
    let observerContext: BrowserContext | undefined;
    let contract: z.infer<typeof CreatedContract>["contract"] | undefined;
    let document: z.infer<typeof CreatedDocument>["document"] | undefined;

    const cleanup = async () => {
      stub?.releaseExtraction();
      const failures: unknown[] = [];
      const settle = async (step: () => Promise<void>) => {
        await step().catch((error: unknown) => failures.push(error));
      };
      if (observerContext) await settle(() => observerContext!.close());
      if (document) {
        await settle(async () => {
          const erased = await page.request.delete(`/api/v1/documents/${document!.id}`, {
            data: { confirmTitle: document!.title },
          });
          expect(erased.status(), await erased.text()).toBe(200);
        });
      }
      if (contract) {
        await settle(async () => {
          const archived = await page.request.post(`/api/v1/contracts/${contract!.number}/archive`);
          expect(archived.status(), await archived.text()).toBe(200);
        });
      }
      await settle(() => removeConnector(page.request));
      if (stub) await settle(() => stub!.close());
      if (failures.length > 0) throw new AggregateError(failures, "M31 demo cleanup failed");
    };

    try {
      stub = await OpenAiStub.start({ apiKey: API_KEY });
      await configureConnector(page, stub, testInfo);
      contract = await createContract(page, await bareContractType(page.request));

      await page.goto(`/contracts/${contract.number}/documents`);
      document = await uploadDemoPdf(page);
      expect(document.versions[0]?.versionNumber).toBe(1);
      await stub.waitForExtraction();

      observerContext = await browser.newContext();
      const observer = await observerContext.newPage();
      await signInAs(observer, ADMIN.email, ADMIN.password, ADMIN.displayName);
      const eventStream = observer.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === "/api/events" && url.searchParams.has("entityId");
      });
      await observer.goto(`/contracts/${contract.number}`);
      expect((await eventStream).status()).toBe(200);
      await expect(analysisCard(observer).getByText("Running…")).toBeVisible();

      let observerReloads = 0;
      observer.on("load", () => {
        observerReloads += 1;
      });
      const refreshed = observer.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/contracts/${contract!.number}`) &&
          response.request().method() === "GET",
      );
      stub.releaseExtraction();
      const recordRead = await refreshed;
      expect(recordRead.status(), await recordRead.text()).toBe(200);

      await expect(observer.getByLabel("Term type")).toHaveValue("auto_renew");
      await expect(observer.getByLabel("Amount")).toHaveValue("125000");
      await expect(observer.getByLabel("Currency")).toHaveValue("USD");
      await expect(observer.getByLabel("Cadence")).toHaveValue("annually");
      await expect(observer.getByLabel("Notice period (days)")).toHaveValue("90");
      await expect(markerBeside(observer, "Term type")).toBeVisible();
      await expect(markerBeside(observer, "Value")).toBeVisible();
      await expect(markerBeside(observer, "Notice period (days)")).toBeVisible();
      expect(observerReloads).toBe(0);
      expect(stub.extractionCount).toBe(1);

      const valueResult = analysisCard(observer)
        .getByRole("listitem")
        .filter({ hasText: "The annual Contract value is USD 125,000." });
      await expect(valueResult.getByText("Unverified", { exact: true })).toBeVisible();
      const confirming = observer.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/contracts/${contract!.number}/analysis/confirm`) &&
          response.request().method() === "POST",
      );
      await valueResult.getByRole("button", { name: "Confirm" }).click();
      const confirmed = await confirming;
      expect(confirmed.status(), await confirmed.text()).toBe(200);
      await expect(valueResult.getByText("Unverified", { exact: true })).toHaveCount(0);
      await expect(markerBeside(observer, "Value")).toHaveCount(0);
      await expect(markerBeside(observer, "Term type")).toBeVisible();
      await expect(markerBeside(observer, "Notice period (days)")).toBeVisible();
      expect(observerReloads).toBe(0);

      expect(await reportAxeViolations(observer, testInfo, "M31 Contract record")).toEqual([]);
    } catch (error) {
      await sweepOrSay("the M31 demo", cleanup);
      throw error;
    }
    await cleanup();
  });
});
