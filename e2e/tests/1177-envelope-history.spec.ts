// SPDX-License-Identifier: AGPL-3.0-only
import { generateKeyPairSync } from "node:crypto";
import { expect, test } from "@playwright/test";
import { ADMIN, ensureAdminExists, signInAs } from "./helpers.js";
import { SigningStub } from "./docusign.js";

interface Envelope {
  id: string;
  status: string;
  sentAt: string | null;
  subject: string | null;
  signers: { name: string; email: string }[];
  executedCopy: { documentId: string; versionId: string } | null;
}
interface HistoryEntry {
  action: string;
  actor: { displayName: string } | null;
  payload: { envelopeId?: string; signerCount?: number };
}

test("shows distinct preparation history, provider attribution and erased Signers beside direct-send history", async ({
  page,
}) => {
  test.skip(process.env.SIGNING_PREPARATION_ENABLED !== "true", "Preparation remains gated.");
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
    const configured = await page.request.put("/api/v1/signing-connectors/docusign", {
      data: {
        environment: "demo",
        updateMode: "webhook",
        integrationKey,
        apiUserId: "99999999-8888-7777-6666-555555555555",
        privateKey,
        webhookSecret: "preparation-e2e-webhook",
      },
    });
    expect(configured.status(), await configured.text()).toBe(200);
    const options = (await (await page.request.get("/api/v1/contracts/options")).json()) as {
      contractTypes: { id: string; slug: string }[];
    };
    const created = await page.request.post("/api/v1/contracts", {
      data: {
        title: `Envelope history ${Date.now()}`,
        contractTypeId: options.contractTypes.find((type) => type.slug === "other")!.id,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const { contract } = (await created.json()) as { contract: { id: string; number: number } };
    const uploaded = await page.request.post(`/api/v1/contracts/${contract.number}/documents`, {
      multipart: {
        kind: "draft_ours",
        file: {
          name: "agreement.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from("%PDF-1.7\n% history source\n%%EOF\n"),
        },
      },
    });
    expect(uploaded.status(), await uploaded.text()).toBe(201);
    const url = `/api/v1/contracts/${contract.number}/envelopes`;
    const read = async () =>
      (await (await page.request.get(url)).json()) as {
        envelopes: Envelope[];
        primaryDocument: { id: string; versions: { id: string }[] };
      };
    const source = (await read()).primaryDocument;
    const leaving = {
      name: "History External Signer",
      email: `history-${Date.now()}@example.test`,
    };
    const input = {
      documentVersionId: source.versions[0]!.id,
      signers: [leaving],
      subject: leaving.email,
    };
    const direct = await page.request.post(url, { data: input });
    expect(direct.status(), await direct.text()).toBe(201);
    const first = ((await direct.json()) as { envelopes: Envelope[] }).envelopes[0]!;
    expect(first.status).toBe("sent");
    const withdrawn = await page.request.post(`/api/v1/envelopes/${first.id}/void`, {
      data: { reason: "New preparation" },
    });
    expect(withdrawn.status(), await withdrawn.text()).toBe(200);
    const prepare = async () => {
      const response = await page.request.post(`${url}/prepare`, {
        data: { ...input, idempotencyKey: crypto.randomUUID() },
      });
      expect(response.status(), await response.text()).toBe(201);
      return ((await response.json()) as { envelopes: Envelope[] }).envelopes[0]!;
    };
    const draft = await prepare();
    const signatures = `/contracts/${contract.number}/signatures`;
    await page.goto(signatures);
    await expect(page.getByText("Draft — not sent", { exact: true })).toBeVisible();
    await expect(page.getByText("Not sent", { exact: true })).toBeVisible();
    await expect(
      page.getByText(`Prepared by ${ADMIN.displayName}`, { exact: true }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Resume in DocuSign" }).click();
    await expect(page.getByRole("heading", { name: "Place fields" })).toBeVisible();
    await page.getByRole("link", { name: "Discard", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${signatures}$`));
    await expect(page.getByText("Discarded", { exact: true })).toBeVisible();
    expect((await read()).envelopes.find((row) => row.id === draft.id)).toMatchObject({
      status: "discarded",
      sentAt: null,
    });

    const completing = await prepare();
    await page.reload();
    await page.getByRole("button", { name: "Resume in DocuSign" }).click();
    await expect(page.getByRole("heading", { name: "Place fields" })).toBeVisible();
    const editorUrl = page.url();
    await page.goto(signatures);
    const erased = await page.request.post("/api/v1/signer-erasures", {
      data: { email: leaving.email },
    });
    expect(erased.status(), await erased.text()).toBe(200);
    expect(await erased.json()).toEqual({ erasure: { entriesRedacted: 1, signerRowsDeleted: 3 } });
    await page.reload();
    await expect(page.getByText(leaving.name, { exact: true })).toHaveCount(0);
    await expect(page.getByText(leaving.email, { exact: true })).toHaveCount(0);
    const providerEnvelopeId = stub.sentEnvelopeIds().at(-1)!;
    // The provider sends while OpenLaw's browser stays on Signatures.
    const remoteSend = await page.request.get(new URL("?action=send", editorUrl).href, {
      maxRedirects: 0,
    });
    expect(remoteSend.status()).toBe(302);
    const sent = stub.signedDelivery({ providerEnvelopeId, status: "sent" });
    expect(
      (
        await page.request.post("/api/v1/signing/docusign/webhook", {
          data: sent.body,
          headers: sent.headers,
        })
      ).status(),
    ).toBe(204);
    await expect(page.getByText("Out for signature", { exact: true })).toBeVisible();
    stub.complete(providerEnvelopeId);
    for (const status of ["completed", "sent", "completed"] as const) {
      const delivery = stub.signedDelivery({ providerEnvelopeId, status });
      expect(
        (
          await page.request.post("/api/v1/signing/docusign/webhook", {
            data: delivery.body,
            headers: delivery.headers,
          })
        ).status(),
      ).toBe(204);
    }
    await expect(page.getByText("Signed", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Executed/ })).toBeVisible({ timeout: 30000 });
    const completed = (await read()).envelopes.find((row) => row.id === completing.id)!;
    expect(completed).toMatchObject({
      status: "signed",
      subject: null,
      signers: [],
      executedCopy: { documentId: source.id },
    });
    await page.getByRole("button", { name: "History", exact: true }).click();
    await expect(
      page.getByText(`${ADMIN.displayName} started preparing this contract's envelope`, {
        exact: true,
      }),
    ).toHaveCount(2);
    await expect(
      page.getByText(
        `${ADMIN.displayName} requested an editing session for this contract's envelope`,
        { exact: true },
      ),
    ).toHaveCount(2);
    await expect(
      page.getByText("This contract's envelope was discarded", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("This contract's envelope was signed", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(`${ADMIN.displayName} sent this contract for signature`, { exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByText("This contract was sent for signature", { exact: true }),
    ).toHaveCount(1);
    const history = (await (
      await page.request.get(`/api/v1/activity?entityType=contract&entityId=${contract.id}`)
    ).json()) as { entries: HistoryEntry[] };
    expect(history.entries.filter((entry) => entry.action === "envelope.signed")).toMatchObject([
      { actor: null },
    ]);
    expect(history.entries.filter((entry) => entry.action === "envelope.sent")).toHaveLength(2);
    expect(
      history.entries.find(
        (entry) => entry.action === "envelope.sent" && entry.payload.envelopeId === completing.id,
      ),
    ).toMatchObject({ actor: null });
    expect(
      history.entries
        .filter((entry) => entry.action === "envelope.preparation_started")
        .map((entry) => entry.payload.signerCount),
    ).toEqual([1, 1]);
    expect(JSON.stringify(history)).not.toContain(leaving.email);
    expect(JSON.stringify(history)).not.toContain(leaving.name);
    expect((await read()).envelopes).toHaveLength(3);
  } finally {
    await stub.close();
  }
});
