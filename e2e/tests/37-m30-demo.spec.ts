// SPDX-License-Identifier: AGPL-3.0-only

/**
 * M30 milestone acceptance (#649): the two-browser demo on built images.
 *
 * Two signed-in browser contexts open one Contract. The Administrator
 * posts a comment in one context and a Legal Team Member sees it in the
 * other without a reload. The same observer then watches the Envelope
 * row while the signing stand-in sends a signed DocuSign Connect
 * delivery. The row changes from Out for signature to Declined without
 * a reload.
 *
 * The signing stand-in points the Compose stack's real DocuSign driver
 * at a local provider counterpart. The send, HMAC check, webhook, event
 * publication, SSE connection, and browser re-read are production code.
 */

import { generateKeyPairSync } from "node:crypto";
import {
  expect,
  request as apiRequest,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { z } from "zod";
import {
  ADMIN,
  BASE_URL,
  ensureAdminExists,
  ensureMemberInert,
  onboardActivatedMember,
  signInAs,
  startsWithName,
  sweepOrSay,
  type OnboardedMember,
} from "./helpers.js";
import { SigningStub } from "./docusign.js";

test.setTimeout(300_000);

const CONTRACT_PREFIX = "E2E M30 two-browser services agreement";
const MEMBER_EMAIL_PREFIX = "e2e-m30-observer-";
const OBSERVER_NAME = "Nadia Okafor";
const PROVIDER = "docusign";
const COMMENT = "The counterparty confirmed the revised liability language.";
const DECLINE_REASON = "The signer asked Legal to correct the company name.";

const ContractRows = z.object({
  contracts: z.array(z.object({ number: z.number().int(), title: z.string() })),
});

const ContractOptions = z.object({
  contractTypes: z.array(
    z.object({
      displayName: z.string(),
      fields: z.array(z.object({ isRequired: z.boolean() })),
    }),
  ),
  contractStatuses: z.array(
    z.object({ id: z.string(), displayName: z.string(), stage: z.string() }),
  ),
});

const DocumentRows = z.object({
  documents: z.array(z.object({ id: z.string(), title: z.string() })),
});

const SigningState = z.object({
  envelopes: z.array(
    z.object({
      status: z.enum(["sent", "signed", "declined", "voided"]),
      reason: z.string().nullable(),
    }),
  ),
});

type ContractOptionsValue = z.infer<typeof ContractOptions>;
type StatusOption = ContractOptionsValue["contractStatuses"][number];

async function readOptions(request: APIRequestContext): Promise<ContractOptionsValue> {
  const response = await request.get("/api/v1/contracts/options");
  expect(response.status(), await response.text()).toBe(200);
  return ContractOptions.parse(await response.json());
}

async function listContracts(request: APIRequestContext) {
  const response = await request.get("/api/v1/contracts");
  expect(response.status(), await response.text()).toBe(200);
  return ContractRows.parse(await response.json()).contracts;
}

async function ensureContractsInert(request: APIRequestContext): Promise<void> {
  for (const contract of (await listContracts(request)).filter((row) =>
    row.title.startsWith(CONTRACT_PREFIX),
  )) {
    const paper = await request.get(
      `/api/v1/contracts/${contract.number}/documents?includeArchived=true`,
    );
    expect(paper.status(), await paper.text()).toBe(200);
    for (const document of DocumentRows.parse(await paper.json()).documents) {
      const erased = await request.delete(`/api/v1/documents/${document.id}`, {
        data: { confirmTitle: document.title },
      });
      expect(erased.status(), await erased.text()).toBe(200);
    }
    const archived = await request.post(`/api/v1/contracts/${contract.number}/archive`);
    expect(archived.status(), await archived.text()).toBe(200);
  }
}

async function ensureObserversInert(request: APIRequestContext): Promise<void> {
  const response = await request.get("/api/v1/users");
  expect(response.status(), await response.text()).toBe(200);
  const users = z
    .object({ users: z.array(z.object({ email: z.string(), status: z.string() })) })
    .parse(await response.json()).users;
  for (const user of users.filter(
    (row) => row.email.startsWith(MEMBER_EMAIL_PREFIX) && row.status !== "archived",
  )) {
    await ensureMemberInert(request, user.email);
  }
}

function bareContractType(options: ContractOptionsValue): string {
  const type = options.contractTypes.find((candidate) =>
    candidate.fields.every((field) => !field.isRequired),
  );
  expect(type, "no Contract Type without a required Field is configured").toBeDefined();
  return type!.displayName;
}

function statusAt(options: ContractOptionsValue, stage: string): StatusOption {
  const status = options.contractStatuses.find((candidate) => candidate.stage === stage);
  expect(status, `no live Contract Status maps to ${stage}`).toBeDefined();
  return status!;
}

async function createContract(page: Page, title: string, typeName: string): Promise<number> {
  await page.goto("/contracts");
  await page.getByRole("button", { name: "Create contract" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Contract type").selectOption({ label: typeName });
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/contracts") && response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  const response = await created;
  expect(response.status(), await response.text()).toBe(201);
  const number = z
    .object({ contract: z.object({ number: z.number().int() }) })
    .parse(await response.json()).contract.number;
  await expect(dialog).toBeHidden();
  return number;
}

function comments(page: Page): Locator {
  return page.getByRole("complementary", { name: "Comments" });
}

async function openComments(page: Page): Promise<Locator> {
  await page
    .getByRole("toolbar", { name: "Applets" })
    .getByRole("button", { name: /^Comments/ })
    .click();
  await expect(comments(page)).toBeVisible();
  return comments(page);
}

async function postWorkingTeamComment(page: Page, body: string): Promise<void> {
  const panel = comments(page);
  await panel.getByRole("group", { name: "Audience" }).getByText("Working Team").click();
  await panel.getByLabel("New comment").fill(body);
  const posted = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/comments") && response.request().method() === "POST",
  );
  await panel.getByRole("button", { name: "Comment", exact: true }).click();
  const response = await posted;
  expect(response.status(), await response.text()).toBe(201);
}

async function uploadPrimaryDocument(page: Page, stamp: number): Promise<void> {
  const section = page.getByRole("region", { name: "Documents" });
  await section.getByRole("button", { name: "Upload" }).click();
  const dialog = page.getByRole("dialog");
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "File Choose file" }).click();
  await (
    await chooser
  ).setFiles({
    name: `m30-services-${stamp}.txt`,
    mimeType: "text/plain",
    buffer: Buffer.from("M30 services agreement ready for signature.\n", "utf8"),
  });
  await dialog.getByLabel("Kind").selectOption("draft_ours");
  const uploaded = page.waitForResponse(
    (response) =>
      /\/api\/v1\/contracts\/\d+\/documents$/.test(response.url()) &&
      response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  const response = await uploaded;
  expect(response.status(), await response.text()).toBe(201);
  await expect(dialog).toBeHidden();
}

async function moveToStatus(page: Page, number: number, status: StatusOption): Promise<void> {
  const moved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/contracts/${number}`) &&
      response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: /move contract$/ }).click();
  await page
    .getByRole("menuitemradio")
    .filter({ hasText: startsWithName(status.displayName) })
    .first()
    .click();
  const response = await moved;
  expect(response.status(), await response.text()).toBe(200);
}

async function saveConnector(
  request: APIRequestContext,
  config: {
    integrationKey: string;
    apiUserId: string;
    privateKey: string;
    webhookSecret: string;
  },
): Promise<void> {
  const saved = await request.put(`/api/v1/signing-connectors/${PROVIDER}`, {
    data: { environment: "demo", ...config },
  });
  expect(saved.status(), await saved.text()).toBe(200);
  const connector = z
    .object({ connector: z.object({ enabled: z.boolean() }) })
    .parse(await saved.json()).connector;
  if (!connector.enabled) {
    const enabled = await request.post(`/api/v1/signing-connectors/${PROVIDER}/enable`);
    expect(enabled.status(), await enabled.text()).toBe(200);
  }
}

function signingCard(page: Page): Locator {
  return page.getByRole("region", { name: "Approvals & signing" });
}

async function sendEnvelope(page: Page, number: number): Promise<void> {
  await signingCard(page).getByRole("button", { name: "Send for signature" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Signer 1 name").fill("Evan Cho");
  await dialog.getByLabel("Signer 1 email").fill("evan.cho@counterparty.example");
  const sent = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/contracts/${number}/envelopes`) &&
      response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Send envelope" }).click();
  const response = await sent;
  expect(response.status(), await response.text()).toBe(201);
  await expect(dialog).toBeHidden();
}

async function pushDecline(stub: SigningStub, providerEnvelopeId: string): Promise<void> {
  stub.decline(providerEnvelopeId, DECLINE_REASON);
  const signed = stub.signedDelivery({
    providerEnvelopeId,
    status: "declined",
    reason: DECLINE_REASON,
    completedAt: new Date().toISOString(),
  });
  const anonymous = await apiRequest.newContext({ baseURL: BASE_URL });
  try {
    const delivered = await anonymous.post(`/api/v1/signing/${PROVIDER}/webhook`, {
      headers: signed.headers,
      data: signed.body,
    });
    expect(delivered.status(), await delivered.text()).toBe(204);
  } finally {
    await anonymous.dispose();
  }
}

test.describe("M30 demo path", () => {
  test.beforeAll(async ({ request }) => {
    await ensureAdminExists(request);
  });

  test("keeps a comment thread and an Envelope row live across two browsers", async ({
    page,
    browser,
  }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
    await ensureContractsInert(page.request);
    await ensureObserversInert(page.request);

    const stamp = Date.now();
    const observerEmail = `${MEMBER_EMAIL_PREFIX}${stamp}@e2e.example`;
    const integrationKey = `e2e-m30-integration-${stamp}`;
    const webhookSecret = `e2e-m30-connect-${stamp}`;
    const privateKey = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    }).privateKey;
    let observer: OnboardedMember | undefined;
    let stub: SigningStub | undefined;

    const leaveInert = async () => {
      await observer?.context.close();
      await stub?.close();
      await ensureContractsInert(page.request);
      await ensureMemberInert(page.request, observerEmail);
    };

    try {
      stub = await SigningStub.start({ integrationKey, webhookSecret });
      await saveConnector(page.request, {
        integrationKey,
        apiUserId: `e2e-m30-user-${stamp}`,
        privateKey,
        webhookSecret,
      });

      observer = await onboardActivatedMember(page.request, browser, {
        email: observerEmail,
        displayName: OBSERVER_NAME,
        role: "legal_team_member",
        password: "m30-observer-password",
      });

      const options = await readOptions(page.request);
      const number = await createContract(
        page,
        `${CONTRACT_PREFIX} ${stamp}`,
        bareContractType(options),
      );

      const observerStream = observer.page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === "/api/events" && url.searchParams.has("entityId");
      });
      await observer.page.goto(`/contracts/${number}`);
      expect((await observerStream).status()).toBe(200);
      await page.goto(`/contracts/${number}`);
      await openComments(observer.page);
      await openComments(page);

      let observerReloads = 0;
      observer.page.on("load", () => {
        observerReloads += 1;
      });

      await expect(comments(observer.page).getByText(COMMENT)).toHaveCount(0);
      await postWorkingTeamComment(page, COMMENT);
      await expect(comments(observer.page).getByText(COMMENT)).toBeVisible();
      expect(observerReloads).toBe(0);

      await page.goto(`/contracts/${number}/documents`);
      await uploadPrimaryDocument(page, stamp);
      await page.goto(`/contracts/${number}`);
      await moveToStatus(page, number, statusAt(options, "signature"));
      await page.goto(`/contracts/${number}/approvals`);
      await sendEnvelope(page, number);

      await observer.page.goto(`/contracts/${number}/approvals`);
      const sentRow = signingCard(observer.page).getByRole("row").filter({
        hasText: "Out for signature",
      });
      await expect(sentRow).toHaveCount(1);
      observerReloads = 0;

      const providerEnvelopeId = stub.sentEnvelopeIds().at(-1);
      expect(providerEnvelopeId).toBeDefined();
      await pushDecline(stub, providerEnvelopeId!);

      const declinedRow = signingCard(observer.page).getByRole("row").filter({
        hasText: "Declined",
      });
      await expect(declinedRow).toHaveCount(1);
      await expect(declinedRow).toContainText(DECLINE_REASON);
      expect(observerReloads).toBe(0);

      const signing = await observer.page.request.get(`/api/v1/contracts/${number}/envelopes`);
      expect(signing.status(), await signing.text()).toBe(200);
      expect(SigningState.parse(await signing.json()).envelopes[0]).toMatchObject({
        status: "declined",
        reason: DECLINE_REASON,
      });
    } catch (error) {
      await sweepOrSay("M30 demo", leaveInert);
      throw error;
    }
    await leaveInert();
  });
});
