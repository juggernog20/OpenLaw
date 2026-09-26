// SPDX-License-Identifier: AGPL-3.0-only
import { generateKeyPairSync } from "node:crypto";
import { expect, test } from "@playwright/test";
import { ADMIN, ensureAdminExists, signInAs } from "./helpers.js";
import { SigningStub } from "./docusign.js";

// Run on an isolated Compose stack with SIGNING_PREPARATION_ENABLED=true.
test("selects an exact Version and Signers in Signatures and retains an unsent draft", async ({
  page,
}) => {
  test.skip(
    process.env.SIGNING_PREPARATION_ENABLED !== "true",
    "Preparation is off until final cutover.",
  );
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
    await page.getByRole("link", { name: "Save and close" }).click();
    await expect(page.getByText("Draft — not sent", { exact: true })).toBeVisible();
    await expect(page.getByText("Not sent", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("Draft — not sent", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send for signature" })).toHaveCount(0);
    const state = (await (
      await page.request.get(`/api/v1/contracts/${contract.number}/envelopes`)
    ).json()) as {
      envelopes: { status: string; sentAt: string | null; documentVersionId: string }[];
    };
    expect(state.envelopes).toHaveLength(1);
    expect(state.envelopes[0]).toMatchObject({
      status: "draft",
      sentAt: null,
      documentVersionId: before.primaryDocument.versions[0]!.id,
    });
    expect(stub.sentEnvelopeIds()).toHaveLength(1);
    expect(stub.statusOf(stub.sentEnvelopeIds()[0]!)).toBe("created");
    await page.getByRole("button", { name: "Resume in DocuSign" }).click();
    await page.getByRole("link", { name: "Send", exact: true }).click();
    await expect(page.getByText("Waiting for confirmation", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Prepare Envelope", exact: true })).toHaveCount(
      0,
    );
    expect(stub.sentEnvelopeIds()).toHaveLength(1);
  } finally {
    await stub.close();
  }
});
