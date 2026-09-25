// SPDX-License-Identifier: AGPL-3.0-only
import { generateKeyPairSync } from "node:crypto";
import { expect, test } from "@playwright/test";
import { ADMIN, ensureAdminExists, signInAs } from "./helpers.js";
import { SigningStub } from "./docusign.js";

// Run on an isolated Compose stack with SIGNING_PREPARATION_ENABLED=true.
test("sends in DocuSign and confirms through sign-in; forged returns reveal no Contract", async ({
  page,
}) => {
  test.skip(
    process.env.SIGNING_PREPARATION_ENABLED !== "true",
    "Preparation is off until final cutover.",
  );
  const returnPage = await page.request.get("/signing/return");
  expect(returnPage.headers()["cache-control"]).toBe("no-store");
  expect(returnPage.headers()["referrer-policy"]).toBe("no-referrer");
  await ensureAdminExists(page.request);
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  const integrationKey = "preparation-e2e-integration";
  const stub = await SigningStub.start({
    integrationKey,
    webhookSecret: "preparation-e2e-webhook",
  });
  try {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const connector = await page.request.put("/api/v1/signing-connectors/docusign", {
      data: {
        environment: "demo",
        updateMode: "polling",
        integrationKey,
        apiUserId: "99999999-8888-7777-6666-555555555555",
        privateKey,
      },
    });
    expect(connector.status(), await connector.text()).toBe(200);
    const options = (await (await page.request.get("/api/v1/contracts/options")).json()) as {
      contractTypes: { id: string; slug: string }[];
    };
    const created = await page.request.post("/api/v1/contracts", {
      data: {
        title: `Draft preparation ${Date.now()}`,
        contractTypeId: options.contractTypes.find((type) => type.slug === "other")!.id,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const { contract } = (await created.json()) as { contract: { number: number; stage: string } };
    const uploaded = await page.request.post(`/api/v1/contracts/${contract.number}/documents`, {
      multipart: {
        kind: "draft_ours",
        file: {
          name: "agreement.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from("%PDF-1.7\n% preparation source\n%%EOF\n"),
        },
      },
    });
    expect(uploaded.status(), await uploaded.text()).toBe(201);
    const before = (await (
      await page.request.get(`/api/v1/contracts/${contract.number}/envelopes`)
    ).json()) as { primaryDocument: { versions: { id: string }[] } };
    await page.goto(`/contracts/${contract.number}/signatures`);
    await page.getByRole("button", { name: "Prepare Envelope", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Version", { exact: true })
      .selectOption(before.primaryDocument.versions[0]!.id);
    await dialog.getByLabel("Signer 1 name").fill("Dana Signer");
    await dialog.getByLabel("Signer 1 email").fill("dana@example.test");
    await dialog.getByLabel("Subject", { exact: true }).fill("Review this agreement");
    const preparation = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/contracts/${contract.number}/envelopes/prepare`) &&
        response.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "Continue to DocuSign", exact: true }).click();
    const prepared = await preparation;
    expect(prepared.status(), await prepared.text()).toBe(201);
    await expect(page.getByRole("heading", { name: "Place fields" })).toBeVisible();
    expect(stub.launches).toHaveLength(1);
    expect(stub.launches[0]!.request).toMatchObject({
      viewAccess: "envelope",
      settings: {
        startingScreen: "Tagger",
        sendButtonAction: "send",
        showHeaderActions: "false",
        recipientSettings: { showEditRecipients: "false" },
        documentSettings: {
          showEditDocuments: "false",
          showEditDocumentVisibility: "false",
          showEditPages: "false",
        },
      },
    });
    await page.context().clearCookies();
    await page.getByRole("link", { name: "Send", exact: true }).click();
    await expect(page).toHaveURL(/auth\/login\?signing_return=1$/);
    await page.getByLabel("Email").fill(ADMIN.email);
    await page.getByLabel("Password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(new RegExp(`/contracts/${contract.number}/signatures$`));
    await expect(page.getByText("Out for signature", { exact: true })).toBeVisible();
    const confirmed = await (
      await page.request.get(`/api/v1/contracts/${contract.number}/envelopes`)
    ).json();
    expect(confirmed.envelopes).toHaveLength(1);
    expect(confirmed.envelopes[0]).toMatchObject({ status: "sent", confirmationPending: false });
    expect(confirmed.envelopes[0].sentAt).toBeTruthy();
    const forged = new URL(stub.launches[0]!.returnUrl);
    forged.searchParams.set("state", "A".repeat(43));
    forged.searchParams.set("event", "send");
    await page.goto(forged.href);
    await expect(
      page.getByRole("heading", { name: "This signing return is unavailable" }),
    ).toBeVisible();
    expect(stub.sentEnvelopeIds()).toHaveLength(1);
  } finally {
    await stub.close();
  }
});
