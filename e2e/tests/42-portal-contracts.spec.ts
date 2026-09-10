// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type APIRequestContext } from "@playwright/test";
import { z } from "zod";
import { ADMIN, ensureAdminExists, signInAs } from "./helpers.js";

/**
 * The title every contract this file creates carries, so the sweep below
 * can find them again. The instance is never reset (TECH-018), so a run
 * that leaves a live contract behind leaves it on somebody's list for
 * good — and this one grants Portal reach, which is the whole point of
 * the record. It is swept twice: once before the run, to clear whatever
 * an earlier failure stranded, and once after, whether the body passed
 * or threw.
 */
const CONTRACT_PREFIX = "E2E DD-021 portal agreement";

const ContractRows = z.object({
  contracts: z.array(z.object({ number: z.number().int(), title: z.string() })),
  nextCursor: z.string().nullable(),
});

test.beforeAll(async ({ request }) => ensureAdminExists(request));

test("Business Owner and Legal Owner share a row, and ownership grants revocable Portal reading", async ({
  page,
}) => {
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  await ensureContractsInert(page.request);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const optionsResponse = await page.request.get("/api/v1/contracts/options");
  expect(optionsResponse.ok()).toBe(true);
  const options = await optionsResponse.json();
  const owner = options.users.find(
    (person: { displayName: string }) => person.displayName === ADMIN.displayName,
  );
  const created = await page.request.post("/api/v1/contracts", {
    data: {
      title: `${CONTRACT_PREFIX} ${Date.now()}`,
      contractTypeId: options.contractTypes[0].id,
    },
  });
  expect(created.status()).toBe(201);
  const contract = (await created.json()).contract;
  try {
    await page.goto(`/contracts/${contract.number}`);
    const businessOwner = page.getByLabel("Business Owner", { exact: true });
    const legalOwner = page.getByLabel("Legal Owner", { exact: true });
    await businessOwner.selectOption(owner.id);
    await expect(businessOwner).toHaveValue(owner.id);
    await expect(legalOwner).toHaveValue("");
    await expect
      .poll(async () =>
        (await page.request.get(`/api/v1/portal/contracts/${contract.number}`)).status(),
      )
      .toBe(200);
    const businessBox = await businessOwner.boundingBox();
    const legalBox = await legalOwner.boundingBox();
    const entityBox = await page.getByLabel("Our entity", { exact: true }).boundingBox();
    expect(Math.abs(businessBox!.y - legalBox!.y)).toBeLessThan(2);
    expect(entityBox!.y).toBeGreaterThan(businessBox!.y + businessBox!.height);
    expect(entityBox!.width).toBeGreaterThan(businessBox!.width * 1.5);
    await page.goto("/portal/contracts");
    await page.getByRole("link", { name: new RegExp(contract.title) }).click();
    await expect(page.getByRole("heading", { name: contract.title })).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveCount(0);
    const cleared = await page.request.patch(`/api/v1/contracts/${contract.number}`, {
      data: { businessOwnerId: null },
    });
    expect(cleared.ok()).toBe(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Contract not found" })).toBeVisible();
  } finally {
    await ensureContractsInert(page.request);
  }
});

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

/** Archived is a contract's resting state: there is no hard delete, and
 * an archived record is out of the Portal scope as well as the list. */
async function ensureContractsInert(request: APIRequestContext): Promise<void> {
  for (const contract of (await listContracts(request)).filter((row) =>
    row.title.startsWith(CONTRACT_PREFIX),
  )) {
    const archived = await request.post(`/api/v1/contracts/${contract.number}/archive`);
    expect(archived.status(), await archived.text()).toBe(200);
  }
}
