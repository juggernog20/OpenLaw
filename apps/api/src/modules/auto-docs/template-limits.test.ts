// SPDX-License-Identifier: AGPL-3.0-only

/** Stored Auto-Doc files are read under the upload ceiling at every seam, never buffered whole. */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { autoDocGenerations, documentVersions, eq } from "@openlaw/db";
import { handleGenerationDelivery } from "../../pipeline/generation-delivery.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";
import { buildWordPackage, forgeDeclaredSize } from "../../testing/word-package.js";

/** Small enough that a test can pass it with a hundred kilobytes. */
const CEILING = 64 * 1024;
let h: TestHarness;
let cookies: Record<string, string>;
beforeAll(async () => {
  h = await startHarness({ maxUploadBytes: CEILING, runPipelineWorkers: false });
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  cookies = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
});
afterAll(async () => {
  await h.stop();
});

function upload(id: string, bytes: Buffer) {
  return h.app.inject({
    method: "POST",
    url: `/api/v1/auto-docs/${id}/template`,
    cookies,
    headers: { "content-type": "multipart/form-data; boundary=limits" },
    payload: Buffer.concat([
      Buffer.from(
        '--limits\r\nContent-Disposition: form-data; name="file"; filename="NDA.docx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n',
      ),
      bytes,
      Buffer.from("\r\n--limits--\r\n"),
    ]),
  });
}
async function createAutoDoc() {
  const made = await h.app.inject({
    method: "POST",
    url: "/api/v1/auto-docs",
    cookies,
    payload: { name: "Limits NDA" },
  });
  expect(made.statusCode, made.body).toBe(201);
  const id = made.json().autoDoc.id as string;
  const settings = await h.app.inject({
    method: "PATCH",
    url: `/api/v1/auto-docs/${id}`,
    cookies,
    payload: { formats: "docx" },
  });
  expect(settings.statusCode, settings.body).toBe(200);
  return id;
}
async function prepare() {
  const id = await createAutoDoc();
  const uploaded = await upload(
    id,
    await readFile(new URL("../../testing/fixtures/auto-docs/plain.docx", import.meta.url)),
  );
  expect(uploaded.statusCode, uploaded.body).toBe(201);
  const form = await h.app.inject({
    method: "POST",
    url: `/api/v1/auto-docs/${id}/form-versions`,
    cookies,
    payload: {
      fields: [
        { slug: "counterparty_name", label: "Counterparty", fieldType: "text" },
        { slug: "signing_date", label: "Signing date", fieldType: "date" },
      ],
    },
  });
  expect(form.statusCode, form.body).toBe(201);
  const pair = {
    documentVersionId: uploaded.json().template.versions[0].id as string,
    formVersionId: form.json().formVersion.id as string,
  };
  const published = await h.app.inject({
    method: "POST",
    url: `/api/v1/auto-docs/${id}/publish`,
    cookies,
    payload: pair,
  });
  expect(published.statusCode, published.body).toBe(200);
  return { id, pair };
}
async function generate(id: string, pair: { documentVersionId: string; formVersionId: string }) {
  const made = await h.app.inject({
    method: "POST",
    url: `/api/v1/auto-docs/${id}/generations`,
    cookies,
    payload: { ...pair, answers: { counterparty_name: "Acme" } },
  });
  expect(made.statusCode, made.body).toBe(201);
  return made.json().generation as { id: string; state: string; failure: unknown };
}
/** The local driver keeps a key as a path under the root. */
async function overwriteBlob(fileRef: string, bytes: Buffer) {
  const key = fileRef.slice(fileRef.indexOf(":") + 1);
  await writeFile(join(h.storageRoot, ...key.split("/")), bytes);
}

it("refuses at upload a package whose entries inflate past the fill ceiling whatever the directory claims", async () => {
  const id = await createAutoDoc();
  const honest = buildWordPackage({ "word/media/pad.bin": Buffer.alloc(33 * 1024 * 1024) });
  const bomb = forgeDeclaredSize(honest, "word/media/pad.bin", 16);
  expect(bomb.byteLength).toBeLessThan(CEILING);
  const refused = await upload(id, bomb);
  expect(refused.statusCode, refused.body).toBe(422);
  expect(refused.json().detail).toMatch(/inflates past/);
});

it("fails a Generation whose stored template is over the ceiling instead of buffering it", async () => {
  const { id, pair } = await prepare();
  const [version] = await h.db
    .select({ fileRef: documentVersions.fileRef })
    .from(documentVersions)
    .where(eq(documentVersions.id, pair.documentVersionId));
  await overwriteBlob(version!.fileRef, Buffer.alloc(CEILING + 40 * 1024, 0x20));
  const generation = await generate(id, pair);
  expect(generation).toMatchObject({
    state: "failed",
    failure: { code: "fill_failed", detail: "The Word template exceeds the upload limit." },
  });
});

it("fails delivery when a stored output is over the ceiling instead of attaching it", async () => {
  const { id, pair } = await prepare();
  const generation = await generate(id, pair);
  expect(generation.state).toBe("ready");
  const [row] = await h.db
    .select()
    .from(autoDocGenerations)
    .where(eq(autoDocGenerations.id, generation.id));
  await overwriteBlob(row!.docxFileRef!, Buffer.alloc(CEILING + 40 * 1024, 0x20));
  await handleGenerationDelivery(
    {
      db: h.db,
      storage: h.storage,
      docEngine: h.docEngine,
      resolveMailer: h.resolveMailer,
      baseUrl: "http://localhost:3345",
      log: { info() {}, warn() {}, error() {} },
      jobs: h.pipeline,
      maxUploadBytes: CEILING,
    },
    { generationId: generation.id, attempt: row!.attempt, retryCount: 0, retryLimit: 3 },
  );
  const [after] = await h.db
    .select()
    .from(autoDocGenerations)
    .where(eq(autoDocGenerations.id, generation.id));
  expect(after).toMatchObject({
    state: "failed",
    emailState: "failed",
    failure: { code: "email_failed" },
  });
  expect(h.mailer.messagesTo(TEST_ADMIN.email)).toHaveLength(0);
});
