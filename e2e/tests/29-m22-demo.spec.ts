// SPDX-License-Identifier: AGPL-3.0-only

/**
 * M22 milestone acceptance (#474): the milestone sentence, through the
 * real staff and portal screens.
 *
 * Legal creates one Matter from scratch. A Business User submits a
 * matter-targeting Request through the portal, Legal converts it, and
 * the Matters destination shows both records together.
 */

import {
  test,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { z } from "zod";
import { ADMIN, ensureAdminExists, ensureMemberInert, signInAs } from "./helpers.js";
import { extractLink, waitForMailTo } from "./mailpit.js";

test.setTimeout(180_000);

const RUN_DOMAIN = `e2e-${Date.now()}.example`;
const REQUESTER = `requester@${RUN_DOMAIN}`;
const DIRECT_TITLE = `E2E M22 direct advice ${Date.now()}`;
const CONVERTED_TITLE = `E2E M22 portal advice ${Date.now()}`;
const REQUEST_TYPE_SLUG = "legal_question";
const REQUEST_TYPE_NAME = "Legal question";
const MATTER_TYPE_SLUG = "advisory";

const DomainsEnvelope = z.object({ domains: z.array(z.string()) });
const RequestTypesEnvelope = z.object({
  requestTypes: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      targetModule: z.enum(["matter", "contract"]).nullable(),
      targetTypeId: z.string().nullable(),
    }),
  ),
});
const MatterTypesEnvelope = z.object({
  matterTypes: z.array(z.object({ id: z.string(), slug: z.string() })),
});
const MatterRowsEnvelope = z.object({
  matters: z.array(
    z.object({ number: z.number().int(), title: z.string(), archivedAt: z.string().nullable() }),
  ),
});

async function enterPortal(context: BrowserContext, api: APIRequestContext): Promise<Page> {
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

test.describe.serial("M22 demo path", () => {
  test.beforeAll(async ({ request }) => {
    await ensureAdminExists(request);
  });

  test("create a matter from scratch, submit a matter-targeting Request through the portal, convert it, and see both in the list", async ({
    page,
    browser,
  }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    const domainsRead = await page.request.get("/api/v1/auth/allowed-domains");
    expect(domainsRead.status(), await domainsRead.text()).toBe(200);
    const existingDomains = DomainsEnvelope.parse(await domainsRead.json()).domains;

    const requestTypesRead = await page.request.get("/api/v1/request-types?includeArchived=true");
    expect(requestTypesRead.status(), await requestTypesRead.text()).toBe(200);
    const requestType = RequestTypesEnvelope.parse(await requestTypesRead.json()).requestTypes.find(
      (row) => row.slug === REQUEST_TYPE_SLUG,
    );
    expect(requestType, `the ${REQUEST_TYPE_SLUG} request-type seed is missing`).toBeDefined();

    const matterTypesRead = await page.request.get("/api/v1/matter-types?includeArchived=true");
    expect(matterTypesRead.status(), await matterTypesRead.text()).toBe(200);
    const matterType = MatterTypesEnvelope.parse(await matterTypesRead.json()).matterTypes.find(
      (row) => row.slug === MATTER_TYPE_SLUG,
    );
    expect(matterType, `the ${MATTER_TYPE_SLUG} matter-type seed is missing`).toBeDefined();

    const portalContext = await browser.newContext();
    const matterNumbers: number[] = [];
    const leaveInert = async () => {
      const failures: unknown[] = [];
      const settle = async (step: () => Promise<void>) => {
        await step().catch((error: unknown) => failures.push(error));
      };
      await settle(() => portalContext.close());
      await settle(async () => {
        const listed = await page.request.get(
          "/api/v1/matters?includeClosed=true&includeArchived=true",
        );
        expect(listed.status(), await listed.text()).toBe(200);
        const owned = MatterRowsEnvelope.parse(await listed.json()).matters.filter(
          (row) =>
            row.archivedAt === null &&
            (matterNumbers.includes(row.number) || row.title.startsWith("E2E M22 ")),
        );
        for (const row of owned) {
          const archived = await page.request.post(`/api/v1/matters/${String(row.number)}/archive`);
          expect(archived.status(), await archived.text()).toBe(200);
        }
      });
      await settle(async () => {
        const restored = await page.request.patch(`/api/v1/request-types/${requestType!.id}`, {
          data: {
            targetModule: requestType!.targetModule,
            targetTypeId: requestType!.targetTypeId,
          },
        });
        expect(restored.status(), await restored.text()).toBe(200);
      });
      await settle(() => ensureMemberInert(page.request, REQUESTER));
      await settle(async () => {
        const restored = await page.request.put("/api/v1/auth/allowed-domains", {
          data: { domains: existingDomains },
        });
        expect(restored.status(), await restored.text()).toBe(200);
      });
      if (failures.length > 0) throw new AggregateError(failures, "M22 demo cleanup failed");
    };

    try {
      const allowed = await page.request.put("/api/v1/auth/allowed-domains", {
        data: {
          domains: [
            ...existingDomains.filter((domain) => !/^e2e-\d+\.example$/.test(domain)),
            RUN_DOMAIN,
          ],
        },
      });
      expect(allowed.status(), await allowed.text()).toBe(200);

      // First record: the ordinary New matter door.
      await page.goto("/matters");
      await page.getByLabel("Matters").getByRole("button", { name: "New matter" }).click();
      const create = page.getByRole("dialog", { name: "Create matter" });
      await create.getByLabel("Title").fill(DIRECT_TITLE);
      await create.getByLabel("Matter type").selectOption(matterType!.id);
      const created = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/matters") && response.request().method() === "POST",
      );
      await create.getByRole("button", { name: "Create" }).click();
      expect((await created).status(), await (await created).text()).toBe(201);
      await expect(page).toHaveURL(/\/matters\/\d+$/);
      const directNumber = Number(/\/matters\/(\d+)$/.exec(new URL(page.url()).pathname)![1]);
      matterNumbers.push(directNumber);
      await expect(page.getByRole("region", { name: DIRECT_TITLE })).toBeVisible();

      // Give the seeded Legal question form a matter target for this run,
      // preserving and restoring whatever routing the instance had.
      const targeted = await page.request.patch(`/api/v1/request-types/${requestType!.id}`, {
        data: { targetModule: "matter", targetTypeId: matterType!.id },
      });
      expect(targeted.status(), await targeted.text()).toBe(200);

      const portal = await enterPortal(portalContext, page.request);
      await portal
        .getByRole("list", { name: "Request types" })
        .getByRole("link", { name: new RegExp(REQUEST_TYPE_NAME) })
        .click();
      await portal.getByLabel("Summary").fill(CONVERTED_TITLE);
      await portal.getByLabel("Description").fill("Please advise on the proposed launch.");
      const submitted = portal.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/requests") && response.request().method() === "POST",
      );
      await portal.getByRole("button", { name: "Submit request" }).click();
      const submittedResponse = await submitted;
      expect(submittedResponse.status(), await submittedResponse.text()).toBe(201);
      const submittedBody = z
        .object({ request: z.object({ number: z.number().int() }) })
        .parse(await submittedResponse.json());

      await page.goto(`/inbox/${String(submittedBody.request.number)}`);
      await page.getByRole("button", { name: "Convert to matter" }).click();
      const convert = page.getByRole("dialog", {
        name: `Convert R-${String(submittedBody.request.number)} to a matter`,
      });
      await expect(convert.getByText("Advisory", { exact: true })).toBeVisible();
      const converted = page.waitForResponse(
        (response) =>
          response
            .url()
            .endsWith(`/api/v1/requests/${String(submittedBody.request.number)}/convert`) &&
          response.request().method() === "POST",
      );
      await convert.getByRole("button", { name: "Convert to matter", exact: true }).click();
      const convertedResponse = await converted;
      expect(convertedResponse.status(), await convertedResponse.text()).toBe(200);
      const convertedBody = z
        .object({
          request: z.object({
            convertedRecord: z.object({
              module: z.literal("matter"),
              number: z.number().int(),
            }),
          }),
        })
        .parse(await convertedResponse.json());
      matterNumbers.push(convertedBody.request.convertedRecord.number);

      // The demo sentence ends on the one list, with both births visible.
      await page.goto("/matters");
      const directRow = page.getByRole("row").filter({ hasText: DIRECT_TITLE });
      const convertedRow = page.getByRole("row").filter({ hasText: CONVERTED_TITLE });
      await expect(directRow).toContainText(`M-${String(directNumber)}`);
      await expect(convertedRow).toContainText(
        `M-${String(convertedBody.request.convertedRecord.number)}`,
      );
    } finally {
      await leaveInert();
    }
  });
});
