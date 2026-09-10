// SPDX-License-Identifier: AGPL-3.0-only

import { expect, test, type APIRequestContext } from "@playwright/test";
import { z } from "zod";
import { ADMIN, ensureAdminExists, ensureMemberInert, signInAs } from "./helpers.js";
import { extractLink, waitForMailTo } from "./mailpit.js";

/**
 * The title every contract this file creates carries, so the sweep below
 * can find them again. The instance is never reset (TECH-018), so a run
 * that leaves a live contract behind leaves it on somebody's list for
 * good — and this one grants Portal reach, which is the whole point of
 * the record. It is swept twice: once before the run, to clear whatever
 * an earlier failure stranded, and once after, whether the body passed
 * or threw.
 */
const CONTRACT_PREFIX = "E2E DD-021 Portal Contract";
const PRIMARY_FILENAME = "portal-contract.png";
const PRIMARY_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
  "base64",
);

const ContractRows = z.object({
  contracts: z.array(z.object({ number: z.number().int(), title: z.string() })),
  nextCursor: z.string().nullable(),
});

test.beforeAll(async ({ request }) => ensureAdminExists(request));

test("Business Owner and Legal Owner share a row, and ownership grants revocable Portal reading", async ({
  page,
  browser,
}) => {
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  await ensureContractsInert(page.request);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const runDomain = `e2e-dd021-${Date.now()}.example`;
  const ownerEmail = `owner@${runDomain}`;
  const allowed = await page.request.get("/api/v1/auth/allowed-domains");
  expect(allowed.status()).toBe(200);
  const { domains } = z.object({ domains: z.array(z.string()) }).parse(await allowed.json());
  const ownerContext = await browser.newContext();
  try {
    const allowRun = await page.request.put("/api/v1/auth/allowed-domains", {
      data: { domains: [...domains, runDomain] },
    });
    expect(allowRun.status()).toBe(200);
    const portal = await ownerContext.newPage();
    await portal.goto("/portal/enter");
    await portal.getByLabel("Email").fill(ownerEmail);
    await portal.getByRole("button", { name: "Send link" }).click();
    await expect(portal.getByText("Check your email")).toBeVisible();
    const mail = await waitForMailTo(page.request, ownerEmail, /^Sign in to OpenLaw$/);
    await portal.goto(extractLink(mail.text, "/api/auth/magic-link/verify"));
    await expect(portal).toHaveURL(/\/portal$/);
    const me = await portal.request.get("/api/v1/me");
    expect(me.status()).toBe(200);
    const { user: owner } = z
      .object({ user: z.object({ id: z.string(), email: z.string(), role: z.string() }) })
      .parse(await me.json());
    expect(owner.email).toBe(ownerEmail);
    expect(owner.role).toBe("business_user");

    const optionsResponse = await page.request.get("/api/v1/contracts/options");
    expect(optionsResponse.ok()).toBe(true);
    const options = await optionsResponse.json();
    const created = await page.request.post("/api/v1/contracts", {
      data: {
        title: `${CONTRACT_PREFIX} ${Date.now()}`,
        contractTypeId: options.contractTypes[0].id,
      },
    });
    expect(created.status()).toBe(201);
    const contract = (await created.json()).contract;
    const portalPath = `/api/v1/portal/contracts/${contract.number}`;
    expect((await portal.request.get(portalPath)).status()).toBe(404);
    const uploaded = await page.request.post(`/api/v1/contracts/${contract.number}/documents`, {
      multipart: {
        kind: "draft_ours",
        file: { name: PRIMARY_FILENAME, mimeType: "image/png", buffer: PRIMARY_BYTES },
      },
    });
    expect(uploaded.status(), await uploaded.text()).toBe(201);

    await page.goto(`/contracts/${contract.number}`);
    const businessOwner = page.getByLabel("Business Owner", { exact: true });
    const legalOwner = page.getByLabel("Legal Owner", { exact: true });
    await businessOwner.selectOption(owner.id);
    await expect(businessOwner).toHaveValue(owner.id);
    await expect(legalOwner).toHaveValue("");
    await expect.poll(async () => (await portal.request.get(portalPath)).status()).toBe(200);
    const businessBox = await businessOwner.boundingBox();
    const legalBox = await legalOwner.boundingBox();
    const entityBox = await page.getByLabel("Our entity", { exact: true }).boundingBox();
    expect(Math.abs(businessBox!.y - legalBox!.y)).toBeLessThan(2);
    expect(entityBox!.y).toBeGreaterThan(businessBox!.y + businessBox!.height);
    expect(entityBox!.width).toBeGreaterThan(businessBox!.width * 1.5);
    expect((await portal.request.get(`/api/v1/contracts/${contract.number}`)).status()).toBe(403);
    const detail = await portal.request.get(portalPath);
    expect(detail.status()).toBe(200);
    const { primaryDocument } = (await detail.json()).contract;
    expect(primaryDocument.version.originalFilename).toBe(PRIMARY_FILENAME);
    const documentPath = `${portalPath}/documents/${primaryDocument.id}/versions/${primaryDocument.version.id}`;
    await portal.goto("/portal/contracts");
    await portal.getByRole("link", { name: contract.title }).click();
    await expect(portal.getByRole("heading", { name: contract.title })).toBeVisible();
    await expect(portal.getByRole("textbox")).toHaveCount(0);
    await portal.getByRole("button", { name: "Read Document" }).click();
    const reader = portal.getByRole("complementary", { name: PRIMARY_FILENAME });
    const preview = reader.getByRole("img", { name: PRIMARY_FILENAME });
    await expect(preview).toHaveAttribute("src", `${documentPath}/preview`);
    await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
    await expect(reader.getByRole("link", { name: "Download", exact: true })).toHaveAttribute(
      "href",
      `${documentPath}/download`,
    );
    for (const route of ["preview", "download"]) {
      const response = await portal.request.get(`${documentPath}/${route}`);
      expect(response.status()).toBe(200);
      expect(await response.body()).toEqual(PRIMARY_BYTES);
    }
    const cleared = await page.request.patch(`/api/v1/contracts/${contract.number}`, {
      data: { businessOwnerId: null },
    });
    expect(cleared.ok()).toBe(true);
    for (const path of [portalPath, `${documentPath}/preview`, `${documentPath}/download`]) {
      expect((await portal.request.get(path)).status()).toBe(404);
    }
    await portal.reload();
    await expect(portal.getByRole("heading", { name: "Contract not found" })).toBeVisible();
    await portal.goto("/portal/contracts");
    await expect(portal.getByRole("link", { name: contract.title })).toHaveCount(0);
  } finally {
    await completeCleanup([
      ownerContext.close(),
      ensureContractsInert(page.request),
      ensureMemberInert(page.request, ownerEmail),
      (async () => {
        const restored = await page.request.put("/api/v1/auth/allowed-domains", {
          data: { domains },
        });
        expect(restored.status(), await restored.text()).toBe(200);
      })(),
    ]);
  }
});

async function completeCleanup(steps: Promise<void>[]): Promise<void> {
  const results = await Promise.allSettled(steps);
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) {
    throw new AggregateError(
      failures.map((result) => result.reason),
      "Portal Contract cleanup failed",
    );
  }
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
