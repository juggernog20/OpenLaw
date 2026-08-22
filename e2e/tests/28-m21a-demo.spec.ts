// SPDX-License-Identifier: AGPL-3.0-only

/**
 * M21A milestone acceptance (#448): paper follows the conversation all
 * the way onto the record, in three real browser sessions.
 *
 * Legal uploads a draft on a Contract born by conversion, the
 * Requester posts the counterparty's markup on the portal thread, a
 * Legal Team Member files it as the next Version with a kind, and the
 * chain shows round two.
 */

import {
  test,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { z } from "zod";
import {
  ADMIN,
  ensureAdminExists,
  ensureMemberInert,
  onboardActivatedMember,
  signInAs,
  sweepOrSay,
  uniqueEmail,
} from "./helpers.js";
import { extractLink, waitForMailTo } from "./mailpit.js";

test.setTimeout(240_000);

const RUN_DOMAIN = `e2e-${Date.now()}.example`;
const REQUESTER = `requester@${RUN_DOMAIN}`;
const MEMBER = {
  email: uniqueEmail("m21a-filer"),
  displayName: "M21A Filing Counsel",
  role: "legal_team_member",
  password: "correct-horse-battery",
} as const;
const SUMMARY = `E2E M21A Northwind NDA ${Date.now()}`;
const REQUEST_TYPE_NAME = "NDA request";
const DRAFT_FILE = "northwind-draft.txt";
const DRAFT_NOTE = "Round one — Legal draft.";
const MARKUP_FILE = "northwind-counterparty-markup.txt";
const MARKUP_NOTE = "Round two — counterparty markup.";

const DomainsEnvelope = z.object({ domains: z.array(z.string()) });
const RequestEnvelope = z.object({
  request: z.object({ id: z.string(), number: z.number().int() }),
});
const ConversionEnvelope = z.object({
  request: z.object({ convertedContract: z.object({ number: z.number().int() }) }),
});
const DocumentRows = z.object({
  documents: z.array(
    z.object({
      title: z.string(),
      versions: z.array(
        z.object({
          versionNumber: z.number().int(),
          kind: z.string(),
          note: z.string().nullable(),
          originalFilename: z.string(),
        }),
      ),
    }),
  ),
});

/** Signs a fresh Business User in through the portal's magic-link door. */
async function enterPortal(
  context: BrowserContext,
  adminRequest: APIRequestContext,
): Promise<Page> {
  const page = await context.newPage();
  await page.goto("/portal/enter");
  await page.getByLabel("Email").fill(REQUESTER);
  await page.getByRole("button", { name: "Send link" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();
  const mail = await waitForMailTo(adminRequest, REQUESTER, /^Sign in to OpenLaw$/);
  await page.goto(extractLink(mail.text, "/api/auth/magic-link/verify"));
  await expect(page).toHaveURL(/\/portal$/);
  return page;
}

/** The one Comments applet every Contract section carries. */
async function openComments(page: Page): Promise<Locator> {
  await page
    .getByRole("toolbar", { name: "Applets" })
    .getByRole("button", { name: /^Comments/ })
    .click();
  const panel = page.getByRole("complementary", { name: "Comments" });
  await expect(panel).toBeVisible();
  return panel;
}

/** Puts Legal's first round through the Contract document composer. */
async function uploadDraft(page: Page): Promise<void> {
  const section = page.getByRole("region", { name: "Documents" });
  await section.getByRole("button", { name: "Upload" }).click();
  const dialog = page.getByRole("dialog");
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "File Choose file" }).click();
  await (
    await chooser
  ).setFiles({
    name: DRAFT_FILE,
    mimeType: "text/plain",
    buffer: Buffer.from("Northwind NDA — Legal draft, round one.\n"),
  });
  await dialog.getByLabel("Kind").selectOption("draft_ours");
  await dialog.getByLabel("Note").fill(DRAFT_NOTE);
  const uploaded = page.waitForResponse(
    (response) =>
      /\/api\/v1\/contracts\/\d+\/documents$/.test(response.url()) &&
      response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  expect((await uploaded).status(), await (await uploaded).text()).toBe(201);
  await expect(dialog).toBeHidden();
}

test.describe.serial("M21A demo path", () => {
  test.beforeAll(async ({ request }) => {
    await ensureAdminExists(request);
  });

  test("Legal uploads a draft on a Contract born by conversion, the Requester posts the counterparty's markup on the portal thread, a Legal Team Member files it as the next Version with a kind, and the chain shows round two", async ({
    page,
    browser,
  }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    const allowed = await page.request.get("/api/v1/auth/allowed-domains");
    expect(allowed.status(), await allowed.text()).toBe(200);
    const existingDomains = DomainsEnvelope.parse(await allowed.json()).domains;
    const requesterContext = await browser.newContext();
    let memberContext: BrowserContext | null = null;
    let contractNumber: number | null = null;

    const leaveInert = async () => {
      const failures: unknown[] = [];
      const settle = async (step: () => Promise<void>) => {
        await step().catch((error: unknown) => failures.push(error));
      };
      await settle(() => requesterContext.close());
      const filingContext = memberContext;
      if (filingContext !== null) await settle(() => filingContext.close());
      if (contractNumber !== null) {
        await settle(async () => {
          const archived = await page.request.post(
            `/api/v1/contracts/${String(contractNumber)}/archive`,
          );
          expect(archived.status(), await archived.text()).toBe(200);
        });
      }
      await settle(() => ensureMemberInert(page.request, REQUESTER));
      await settle(() => ensureMemberInert(page.request, MEMBER.email));
      await settle(async () => {
        const restored = await page.request.put("/api/v1/auth/allowed-domains", {
          data: { domains: existingDomains },
        });
        expect(restored.status(), await restored.text()).toBe(200);
      });
      if (failures.length > 0) throw new AggregateError(failures, "M21A demo cleanup failed");
    };

    try {
      const allowRun = await page.request.put("/api/v1/auth/allowed-domains", {
        data: {
          domains: [
            ...existingDomains.filter((domain) => !/^e2e-\d+\.example$/.test(domain)),
            RUN_DOMAIN,
          ],
        },
      });
      expect(allowRun.status(), await allowRun.text()).toBe(200);

      const member = await onboardActivatedMember(page.request, browser, MEMBER);
      memberContext = member.context;

      // The Contract is born through the ordinary Request conversion.
      const portal = await enterPortal(requesterContext, page.request);
      await portal
        .getByRole("list", { name: "Request types" })
        .getByRole("link", { name: new RegExp(REQUEST_TYPE_NAME) })
        .click();
      await portal.getByLabel("Summary").fill(SUMMARY);
      await portal.getByLabel("Description").fill("Please review the Northwind NDA.");
      const created = portal.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/requests") && response.request().method() === "POST",
      );
      await portal.getByRole("button", { name: "Submit request" }).click();
      const createdResponse = await created;
      expect(createdResponse.status(), await createdResponse.text()).toBe(201);
      const requestNumber = RequestEnvelope.parse(await createdResponse.json()).request.number;

      await page.goto(`/inbox/${String(requestNumber)}`);
      await page.getByRole("button", { name: "Convert to contract" }).click();
      const conversion = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/requests/${String(requestNumber)}/convert`) &&
          response.request().method() === "POST",
      );
      await page.getByRole("dialog").getByRole("button", { name: "Convert" }).click();
      const conversionResponse = await conversion;
      expect(conversionResponse.status(), await conversionResponse.text()).toBe(200);
      contractNumber = ConversionEnvelope.parse(await conversionResponse.json()).request
        .convertedContract.number;

      // Legal sends round one from the Contract's Documents section.
      await page.goto(`/contracts/${String(contractNumber)}/documents`);
      await uploadDraft(page);
      const firstRound = page
        .getByRole("region", { name: "Documents" })
        .getByRole("row")
        .filter({ hasText: DRAFT_NOTE });
      await expect(firstRound).toContainText("v1");
      await expect(firstRound).toContainText("Draft · ours");

      // The Requester returns the counterparty's markup on the thread
      // that survived conversion, not through the Request upload route.
      await portal.goto(`/portal/requests/${String(requestNumber)}`);
      const conversation = portal.getByRole("region", { name: "Conversation" });
      await conversation.getByLabel("Choose files for this comment").setInputFiles({
        name: MARKUP_FILE,
        mimeType: "text/plain",
        buffer: Buffer.from("Northwind NDA — counterparty markup, round two.\n"),
      });
      await conversation.getByLabel("Reply to Legal").fill("The counterparty sent its markup.");
      const posted = portal.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/comments") && response.request().method() === "POST",
      );
      await conversation.getByRole("button", { name: "Send" }).click();
      expect((await posted).status(), await (await posted).text()).toBe(201);
      await expect(conversation.getByRole("link", { name: MARKUP_FILE })).toBeVisible();

      // A Legal Team Member files that exact thread attachment as the
      // next Version and names what the round is.
      const filer = member.page;
      await filer.goto(`/contracts/${String(contractNumber)}`);
      const comments = await openComments(filer);
      const markupComment = comments
        .getByRole("list", { name: "Comments" })
        .getByRole("listitem")
        .filter({ hasText: "The counterparty sent its markup." });
      await expect(markupComment).toContainText("The counterparty sent its markup.");
      await markupComment.getByRole("button", { name: "File" }).click();
      const filing = filer.getByRole("dialog", { name: "File attachment" });
      await filing.getByLabel("Destination").selectOption("new_version");
      await filing.getByLabel("Kind").selectOption("redline_theirs");
      await filing.getByLabel("Note").fill(MARKUP_NOTE);
      const filed = filer.waitForResponse(
        (response) =>
          /\/api\/v1\/comments\/[^/]+\/attachments\/[^/]+\/file$/.test(
            new URL(response.url()).pathname,
          ) && response.request().method() === "POST",
      );
      await filing.getByRole("button", { name: "File" }).click();
      expect((await filed).status(), await (await filed).text()).toBe(201);
      await expect(filing).toBeHidden();
      await expect(
        markupComment.getByRole("link", { name: `${DRAFT_FILE}, version 2` }),
      ).toBeVisible();

      // The record's chain shows round two and keeps round one behind it.
      await filer.goto(`/contracts/${String(contractNumber)}/documents`);
      const secondRound = filer
        .getByRole("region", { name: "Documents" })
        .getByRole("row")
        .filter({ hasText: MARKUP_NOTE });
      await expect(secondRound).toContainText("v2");
      await expect(secondRound).toContainText("Redline · theirs");
      await expect(secondRound).toContainText(DRAFT_FILE);

      const paper = await filer.request.get(
        `/api/v1/contracts/${String(contractNumber)}/documents`,
      );
      expect(paper.status(), await paper.text()).toBe(200);
      const document = DocumentRows.parse(await paper.json()).documents.find(
        (row) => row.title === DRAFT_FILE,
      );
      expect(document).toBeDefined();
      const rounds = [...document!.versions].sort(
        (left, right) => left.versionNumber - right.versionNumber,
      );
      expect(rounds).toEqual([
        expect.objectContaining({
          versionNumber: 1,
          kind: "draft_ours",
          note: DRAFT_NOTE,
          originalFilename: DRAFT_FILE,
        }),
        expect.objectContaining({
          versionNumber: 2,
          kind: "redline_theirs",
          note: MARKUP_NOTE,
          originalFilename: MARKUP_FILE,
        }),
      ]);
    } catch (error) {
      await sweepOrSay("M21A demo", leaveInert);
      throw error;
    }
    await leaveInert();
  });
});
