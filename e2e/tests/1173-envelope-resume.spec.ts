// SPDX-License-Identifier: AGPL-3.0-only
import { generateKeyPairSync } from "node:crypto";
import { expect, test } from "@playwright/test";
import { ADMIN, ensureAdminExists, signInAs } from "./helpers.js";
import { SigningStub } from "./docusign.js";

// Run on an isolated Compose stack with SIGNING_PREPARATION_ENABLED=true.
for (const scenario of ["resume", "discard"] as const)
  test(`saved preparation ${scenario} through the restricted editor stand-in`, async ({ page }) => {
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
      const { contract } = (await created.json()) as {
        contract: { number: number; stage: string };
      };
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
      const providerId = stub.launches[0]!.envelopeId;
      const firstUrl = page.url();
      const signatures = `/contracts/${contract.number}/signatures`;
      if (scenario === "discard") {
        await page.getByRole("link", { name: "Discard", exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`${signatures}$`));
        await expect(page.getByText("Discarded", { exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Resume in DocuSign" })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Prepare Envelope" })).toBeVisible();
        const state = await (
          await page.request.get(`/api/v1/contracts/${contract.number}/envelopes`)
        ).json();
        expect(state.envelopes).toHaveLength(1);
        expect(state.envelopes[0]).toMatchObject({ status: "discarded", sentAt: null });
      } else {
        await page.getByLabel("Saved text field").fill("Approved on page two");
        await page.getByRole("button", { name: "Save fields and close" }).click();
        await expect(page.getByText("Draft — not sent", { exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Resume in DocuSign" }).click();
        await expect(page.getByLabel("Saved text field")).toHaveValue("Approved on page two");
        expect(page.url()).not.toBe(firstUrl);
        await page.getByRole("link", { name: "Cancel", exact: true }).click();
        await expect(page.getByRole("button", { name: "Resume in DocuSign" })).toBeVisible();
        await page.getByRole("button", { name: "Resume in DocuSign" }).click();
        await expect(page.getByRole("heading", { name: "Place fields" })).toBeVisible();
        // Leave the browser session without its return. The same draft remains resumable.
        await page.goto(signatures);
        stub.lockEnvelope(providerId, true);
        await page.getByRole("button", { name: "Resume in DocuSign" }).click();
        await expect(page.getByRole("alert")).toContainText("another editing session");
        stub.lockEnvelope(providerId, false);
        await page.getByRole("button", { name: "Resume in DocuSign" }).click();
        await expect(page.getByRole("heading", { name: "Place fields" })).toBeVisible();
        stub.expireLatestLink();
        await page.reload();
        await expect(page.getByRole("heading", { name: "Launch link expired" })).toBeVisible();
        await page.getByRole("link", { name: "Back to Signatures and Resume" }).click();
        await page.getByRole("button", { name: "Resume in DocuSign" }).click();
        await expect(page.getByLabel("Saved text field")).toHaveValue("Approved on page two");
        expect(stub.fieldsOf(providerId)).toBe("Approved on page two");
        expect(new Set(stub.launches.map((item) => item.envelopeId))).toEqual(
          new Set([providerId]),
        );
        expect(stub.sentEnvelopeIds()).toHaveLength(1);
      }
    } finally {
      await stub.close();
    }
  });
