// SPDX-License-Identifier: AGPL-3.0-only

/** M32/5: a real mixed-format Comparison reaches the text-only screen. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { z } from "zod";
import { ADMIN, ensureAdminExists, signInAs } from "./helpers.js";

test.setTimeout(300_000);

const ContractOptions = z.object({
  contractTypes: z.array(
    z.object({
      id: z.string(),
      fields: z.array(z.object({ isRequired: z.boolean() })),
    }),
  ),
});

const Contract = z.object({
  contract: z.object({ id: z.string(), number: z.number().int(), title: z.string() }),
});

const Document = z.object({
  document: z.object({
    id: z.string(),
    title: z.string(),
    versions: z.array(z.object({ id: z.string(), versionNumber: z.number().int() })),
  }),
});

const TextState = z.object({ text: z.object({ state: z.string() }) });
const Comparison = z.object({
  comparison: z.object({
    id: z.string(),
    mode: z.enum(["word", "text"]),
    state: z.enum(["pending", "ready", "failed"]),
    changeCount: z.number().int().nullable(),
    failure: z.string().nullable(),
  }),
});

function fixture(name: string): Buffer {
  return readFileSync(
    fileURLToPath(
      new URL(`../../apps/api/src/testing/fixtures/doc-engine/${name}`, import.meta.url),
    ),
  );
}

async function waitForText(
  request: APIRequestContext,
  documentId: string,
  versionId: string,
): Promise<void> {
  // `expect.poll` retries a thrown error, so a terminal state inside the
  // callback would be swallowed and reported as a timeout on the last
  // value seen. A state that will never become `ready` is failed now,
  // while the reason is still in hand.
  const deadline = Date.now() + 180_000;
  for (;;) {
    const response = await request.get(
      `/api/v1/documents/${documentId}/versions/${versionId}/text`,
    );
    expect(response.status(), await response.text()).toBe(200);
    const { state } = TextState.parse(await response.json()).text;
    if (state === "ready") return;
    if (state !== "pending") {
      throw new Error(`Version ${versionId} text ended ${state}, so it will never be ready.`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`Version ${versionId} text was still pending after 180s.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

test.describe.serial("M32 text comparison", () => {
  test.beforeAll(async ({ request }) => ensureAdminExists(request));

  test("draws its extracted-text notice and refuses Word export", async ({ page }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
    const optionsResponse = await page.request.get("/api/v1/contracts/options");
    expect(optionsResponse.status(), await optionsResponse.text()).toBe(200);
    const type = ContractOptions.parse(await optionsResponse.json()).contractTypes.find(
      (candidate) => candidate.fields.every((field) => !field.isRequired),
    );
    expect(type).toBeDefined();

    const title = `E2E M32 text comparison ${Date.now()}`;
    const contractResponse = await page.request.post("/api/v1/contracts", {
      data: { title, contractTypeId: type!.id },
    });
    expect(contractResponse.status(), await contractResponse.text()).toBe(201);
    const contract = Contract.parse(await contractResponse.json()).contract;
    let document: z.infer<typeof Document>["document"] | undefined;

    try {
      const firstResponse = await page.request.post(
        `/api/v1/contracts/${contract.number}/documents`,
        {
          multipart: {
            kind: "draft_ours",
            file: {
              name: "m32-older.docx",
              mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              buffer: fixture("plain.docx"),
            },
          },
        },
      );
      expect(firstResponse.status(), await firstResponse.text()).toBe(201);
      document = Document.parse(await firstResponse.json()).document;

      const secondResponse = await page.request.post(`/api/v1/documents/${document.id}/versions`, {
        multipart: {
          kind: "draft_theirs",
          file: {
            name: "m32-newer.pdf",
            mimeType: "application/pdf",
            buffer: fixture("native-text.pdf"),
          },
        },
      });
      expect(secondResponse.status(), await secondResponse.text()).toBe(201);
      document = Document.parse(await secondResponse.json()).document;
      const [from, to] = document.versions;
      expect(from).toBeDefined();
      expect(to).toBeDefined();
      await Promise.all([
        waitForText(page.request, document.id, from!.id),
        waitForText(page.request, document.id, to!.id),
      ]);

      const requested = await page.request.post(`/api/v1/documents/${document.id}/comparisons`, {
        data: { fromVersionId: from!.id, toVersionId: to!.id },
      });
      expect(requested.status(), await requested.text()).toBe(202);
      const pending = Comparison.parse(await requested.json()).comparison;
      expect(pending.mode).toBe("text");
      let ready = pending;
      // Same reason as `waitForText`: a failed comparison is reported
      // now, carrying the reason the worker recorded, rather than after
      // a full minute of retries that could only report the state.
      const comparisonDeadline = Date.now() + 60_000;
      for (;;) {
        const response = await page.request.get(
          `/api/v1/documents/${document!.id}/comparisons/${pending.id}`,
        );
        expect(response.status(), await response.text()).toBe(200);
        ready = Comparison.parse(await response.json()).comparison;
        if (ready.state === "ready") break;
        if (ready.state !== "pending") {
          throw new Error(`The comparison ended ${ready.state}: ${ready.failure ?? "no reason"}`);
        }
        if (Date.now() >= comparisonDeadline) {
          throw new Error("The comparison was still pending after 60s.");
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      expect(ready.failure).toBeNull();
      expect(ready.changeCount).toBeGreaterThan(0);

      const exported = await page.request.post(
        `/api/v1/documents/${document.id}/comparisons/${ready.id}/export`,
      );
      expect(exported.status(), await exported.text()).toBe(409);
      expect(z.object({ detail: z.string() }).parse(await exported.json()).detail).toBe(
        "Export needs two Word files.",
      );

      await page.goto(`/documents/${document.id}/compare?from=${from!.id}&to=${to!.id}`);
      await expect(
        page.getByText(
          "This comparison was built from extracted text, so formatting is not shown.",
        ),
      ).toBeVisible();
      await expect(page.getByText("Export needs two Word files.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Export track changes" })).toHaveCount(0);
    } finally {
      if (document) {
        const erased = await page.request.delete(`/api/v1/documents/${document.id}`, {
          data: { confirmTitle: document.title },
        });
        expect.soft(erased.status(), await erased.text()).toBe(200);
      }
      const archived = await page.request.post(`/api/v1/contracts/${contract.number}/archive`);
      expect.soft(archived.status(), await archived.text()).toBe(200);
    }
  });
});
