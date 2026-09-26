// SPDX-License-Identifier: AGPL-3.0-only
import { generateKeyPairSync } from "node:crypto";
import { expect, test } from "@playwright/test";
import { ADMIN, ensureAdminExists, signInAs } from "./helpers.js";
import { SigningStub } from "./docusign.js";

// Run on an isolated Compose stack with SIGNING_PREPARATION_ENABLED=true.
test("confirms and files completion after the sender leaves DocuSign without returning", async ({
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
        updateMode: "webhook",
        webhookSecret: "preparation-e2e-webhook",
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
    const preparation = await page.request.post(
      `/api/v1/contracts/${contract.number}/envelopes/prepare`,
      {
        data: {
          documentVersionId: before.primaryDocument.versions[0]!.id,
          signers: [{ name: "Dana Signer", email: "dana@example.test" }],
          idempotencyKey: crypto.randomUUID(),
        },
      },
    );
    expect(preparation.status(), await preparation.text()).toBe(201);
    const { envelopes } = (await preparation.json()) as { envelopes: { id: string }[] };
    const launch = await page.request.post(`/api/v1/envelopes/${envelopes[0]!.id}/launch`);
    expect(launch.status()).toBe(200);
    await page.goto(((await launch.json()) as { url: string }).url);
    await expect(page.getByRole("heading", { name: "Place fields" })).toBeVisible();
    // Leaving the editor never visits the provider return URL.
    await page.goto(`/contracts/${contract.number}/signatures`);
    await expect(page.getByText("Waiting for confirmation", { exact: true })).toBeVisible();
    const providerEnvelopeId = stub.sentEnvelopeIds()[0]!;
    stub.complete(providerEnvelopeId);
    const delivery = stub.signedDelivery({ providerEnvelopeId, status: "completed" });
    const post = () =>
      page.request.post("/api/v1/signing/docusign/webhook", {
        data: delivery.body,
        headers: delivery.headers,
      });
    expect((await post()).status()).toBe(204);
    await expect(page.getByText("Signed", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Executed/ })).toBeVisible({ timeout: 30_000 });
    expect((await post()).status()).toBe(204);
    await page.reload();
    await expect(page.getByText("Signed", { exact: true })).toBeVisible();
    const after = (await (
      await page.request.get(`/api/v1/contracts/${contract.number}/envelopes`)
    ).json()) as {
      envelopes: { status: string; executedFetch: string; confirmationPending: boolean }[];
    };
    expect(after.envelopes).toHaveLength(1);
    expect(after.envelopes[0]).toMatchObject({
      status: "signed",
      executedFetch: "ready",
      confirmationPending: false,
    });
  } finally {
    await stub.close();
  }
});
