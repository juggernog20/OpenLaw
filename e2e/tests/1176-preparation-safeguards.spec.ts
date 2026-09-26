// SPDX-License-Identifier: AGPL-3.0-only
import { generateKeyPairSync } from "node:crypto";
import { expect, test } from "@playwright/test";
import { ADMIN, ensureAdminExists, signInAs } from "./helpers.js";
import { SigningStub } from "./docusign.js";

interface EnvelopeResponse {
  envelopes: {
    id: string;
    status: string;
    executedFetch: string;
    confirmationPending: boolean;
    documentVersionId: string | null;
  }[];
}
interface DocumentResponse {
  document: { id: string; title: string };
}

// Run on an isolated Compose stack with SIGNING_PREPARATION_ENABLED=true.
test("preserves preparation through source, archive and connector changes", async ({ page }) => {
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
  let contractNumber: number | undefined;
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
    contractNumber = contract.number;
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
    const { envelopes } = (await preparation.json()) as EnvelopeResponse;
    const launch = await page.request.post(`/api/v1/envelopes/${envelopes[0]!.id}/launch`);
    expect(launch.status()).toBe(200);
    await page.goto(((await launch.json()) as { url: string }).url);
    await expect(page.getByRole("heading", { name: "Place fields" })).toBeVisible();
    const envelope = envelopes[0]!;
    const signatures = `/contracts/${contract.number}/signatures`;
    const source = ((await uploaded.json()) as DocumentResponse).document;
    await page.getByLabel("Saved text field").fill("Preserved draft fields");
    await page.getByRole("button", { name: "Save fields and close" }).click();
    await expect(page).toHaveURL(new RegExp(`${signatures}$`));
    await expect(page.getByRole("button", { name: "Resume in DocuSign" })).toBeVisible();
    const round = await page.request.post(`/api/v1/documents/${source.id}/versions`, {
      multipart: {
        kind: "redline_theirs",
        file: {
          name: "newer.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from("%PDF-1.7\n% newer paper\n%%EOF\n"),
        },
      },
    });
    expect(round.status(), await round.text()).toBe(201);
    await page.reload();
    await page.getByRole("button", { name: "Resume in DocuSign" }).click();
    await expect(page.getByLabel("Saved text field")).toHaveValue("Preserved draft fields");
    await page.goto(signatures);
    const replacement = await page.request.post(`/api/v1/contracts/${contract.number}/documents`, {
      multipart: {
        kind: "draft_ours",
        file: {
          name: "replacement.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from("%PDF-1.7\n% replacement paper\n%%EOF\n"),
        },
      },
    });
    expect(replacement.status()).toBe(201);
    expect(
      (
        await page.request.post(
          `/api/v1/documents/${((await replacement.json()) as DocumentResponse).document.id}/primary`,
        )
      ).status(),
    ).toBe(200);
    await page.reload();
    await expect(page.getByText(/The primary Document changed/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Resume in DocuSign" })).toHaveCount(0);
    expect((await page.request.post(`/api/v1/envelopes/${envelope.id}/launch`)).status()).toBe(409);
    expect((await page.request.post(`/api/v1/documents/${source.id}/primary`)).status()).toBe(200);
    expect((await page.request.post(`/api/v1/contracts/${contract.number}/archive`)).status()).toBe(
      200,
    );
    expect((await page.request.post(`/api/v1/envelopes/${envelope.id}/launch`)).status()).toBe(409);
    expect((await page.request.post(`/api/v1/contracts/${contract.number}/restore`)).status()).toBe(
      200,
    );
    const url = "/api/v1/signing-connectors/docusign";
    const config = {
      environment: "demo",
      updateMode: "webhook",
      webhookSecret: "preparation-e2e-webhook",
      integrationKey,
      apiUserId: "99999999-8888-7777-6666-555555555555",
      privateKey,
    };
    expect(
      (
        await page.request.put(url, { data: { ...config, apiUserId: "same-account-user" } })
      ).status(),
    ).toBe(200);
    expect(
      (await page.request.put(url, { data: { ...config, environment: "production" } })).status(),
    ).toBe(409);
    expect((await page.request.delete(url)).status()).toBe(409);
    expect((await page.request.post(`${url}/disable`)).status()).toBe(200);
    await page.reload();
    await expect(page.getByText(/Signing connector is disabled or unavailable/)).toBeVisible();
    await expect(page.getByText(/does not close a session already issued/)).toBeVisible();
    expect((await page.request.post(`/api/v1/envelopes/${envelope.id}/launch`)).status()).toBe(409);
    expect((await page.request.post(`${url}/enable`)).status()).toBe(200);
    expect((await page.request.post(`/api/v1/envelopes/${envelope.id}/launch`)).status()).toBe(200);
    const erased = await page.request.delete(`/api/v1/documents/${source.id}`, {
      data: { confirmTitle: source.title },
    });
    expect(erased.status(), await erased.text()).toBe(200);
    await page.reload();
    await expect(page.getByText(/The original source Version is unavailable/)).toBeVisible();
    expect((await page.request.post(`/api/v1/envelopes/${envelope.id}/launch`)).status()).toBe(409);
    const after = (await (
      await page.request.get(`/api/v1/contracts/${contract.number}/envelopes`)
    ).json()) as EnvelopeResponse;
    expect(after.envelopes).toHaveLength(1);
    expect(after.envelopes[0]).toMatchObject({
      id: envelope.id,
      status: "draft",
      documentVersionId: null,
    });
  } finally {
    try {
      await page.request.post("/api/v1/signing-connectors/docusign/enable");
      if (contractNumber !== undefined)
        await page.request.post(`/api/v1/contracts/${contractNumber}/restore`);
    } finally {
      await stub.close();
    }
  }
});

test("files a real provider outcome while the connector and Contract refuse new launches", async ({
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
  let contractNumber: number | undefined;
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
    contractNumber = contract.number;
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
    const { envelopes } = (await preparation.json()) as EnvelopeResponse;
    const launch = await page.request.post(`/api/v1/envelopes/${envelopes[0]!.id}/launch`);
    expect(launch.status()).toBe(200);
    await page.goto(((await launch.json()) as { url: string }).url);
    await expect(page.getByRole("heading", { name: "Place fields" })).toBeVisible();
    // Leaving the editor never visits the provider return URL.
    await page.goto(`/contracts/${contract.number}/signatures`);
    await expect(page.getByText("Waiting for confirmation", { exact: true })).toBeVisible();
    const providerEnvelopeId = stub.sentEnvelopeIds()[0]!;
    expect((await page.request.post("/api/v1/signing-connectors/docusign/disable")).status()).toBe(
      200,
    );
    expect((await page.request.post(`/api/v1/contracts/${contract.number}/archive`)).status()).toBe(
      200,
    );
    expect((await page.request.post(`/api/v1/envelopes/${envelopes[0]!.id}/launch`)).status()).toBe(
      409,
    );
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
    ).json()) as EnvelopeResponse;
    expect(after.envelopes).toHaveLength(1);
    expect(after.envelopes[0]).toMatchObject({
      status: "signed",
      executedFetch: "ready",
      confirmationPending: false,
    });
    expect((await page.request.post("/api/v1/signing-connectors/docusign/enable")).status()).toBe(
      200,
    );
    expect((await page.request.post(`/api/v1/contracts/${contract.number}/restore`)).status()).toBe(
      200,
    );
  } finally {
    try {
      await page.request.post("/api/v1/signing-connectors/docusign/enable");
      if (contractNumber !== undefined)
        await page.request.post(`/api/v1/contracts/${contractNumber}/restore`);
    } finally {
      await stub.close();
    }
  }
});
