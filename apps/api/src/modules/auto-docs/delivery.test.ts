// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-007: ready downloads and captured mail follow the Generation's accepted formats. */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { autoDocGenerations, eq, orgSettings, sql } from "@openlaw/db";
import { PgBoss } from "pg-boss";
import { JOB_QUEUES } from "../../pipeline/jobs.js";
import { sweepGenerationDeliveries } from "../../pipeline/generation-delivery.js";
import { startPipeline, type Pipeline } from "../../pipeline/pg-boss.js";
import {
  startHarness,
  signInCookies,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";
import { SourceUnreadableError } from "../../lib/doc-engine/engine.js";
import { AutoDocFillError } from "../../lib/auto-doc-fill/engine.js";

let h: TestHarness;
let cookies: Record<string, string>;
let worker: Pipeline | undefined;
beforeAll(async () => {
  h = await startHarness({ runPipelineWorkers: false });
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  cookies = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  await h.db.update(orgSettings).set({ name: "Acme Legal" });
});
afterAll(async () => {
  await worker?.stop();
  await h.stop();
});
async function prepare(
  formats: "docx" | "pdf" | "both" = "both",
  coverNote: string | null = null,
  holdDelivery = false,
) {
  if (holdDelivery) {
    await worker?.stop();
    worker = undefined;
  }
  const made = await h.app.inject({
    method: "POST",
    url: "/api/v1/auto-docs",
    cookies,
    payload: { name: "Delivery NDA" },
  });
  expect(made.statusCode, made.body).toBe(201);
  expect(made.json().autoDoc.formats).toBe("both");
  const id = made.json().autoDoc.id as string;
  const settings = await h.app.inject({
    method: "PATCH",
    url: `/api/v1/auto-docs/${id}`,
    cookies,
    payload: { formats, coverNote },
  });
  expect(settings.statusCode, settings.body).toBe(200);
  const template = await readFile(
    new URL("../../testing/fixtures/auto-docs/plain.docx", import.meta.url),
  );
  const upload = await h.app.inject({
    method: "POST",
    url: `/api/v1/auto-docs/${id}/template`,
    cookies,
    headers: { "content-type": "multipart/form-data; boundary=delivery" },
    payload: Buffer.concat([
      Buffer.from(
        '--delivery\r\nContent-Disposition: form-data; name="file"; filename="NDA.docx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n',
      ),
      template,
      Buffer.from("\r\n--delivery--\r\n"),
    ]),
  });
  expect(upload.statusCode, upload.body).toBe(201);
  const read = await h.app.inject({ url: `/api/v1/auto-docs/${id}`, cookies });
  const pair = {
    documentVersionId: read.json().template.versions[0].id as string,
    formVersionId: read.json().formVersion.id as string,
  };
  expect(
    (
      await h.app.inject({
        method: "POST",
        url: `/api/v1/auto-docs/${id}/publish`,
        cookies,
        payload: pair,
      })
    ).statusCode,
  ).toBe(200);
  if (!holdDelivery) await startWorker();
  return { id, pair };
}
async function generate(id: string, pair: { documentVersionId: string; formVersionId: string }) {
  const made = await h.app.inject({
    method: "POST",
    url: `/api/v1/auto-docs/${id}/generations`,
    cookies,
    payload: { ...pair, answers: { counterparty_name: "Acme & Sons", signing_date: "2026-09-14" } },
  });
  expect(made.statusCode, made.body).toBe(201);
  return made.json().generation;
}
const read = (id: string, generationId: string, suffix = "") =>
  h.app.inject({ url: `/api/v1/auto-docs/${id}/generations/${generationId}${suffix}`, cookies });
async function startWorker() {
  if (worker) return;
  worker = await startPipeline({
    connectionString: h.databaseUrl,
    handlers: {
      db: h.db,
      storage: h.storage,
      docEngine: h.docEngine,
      resolveMailer: h.resolveMailer,
      resolveSigningProvider: h.resolveSigningProvider,
      resolveAiProvider: h.resolveAiProvider,
      baseUrl: "http://localhost:3345",
      log: { info() {}, warn() {}, error() {} },
    },
  });
}
/** DOC-012 mints a fresh key for each attempt, so what a retry left
 * behind is read from the Generation's directory rather than one key. */
async function storedBlobs(generationId: string) {
  return readdir(join(h.storageRoot, "auto-doc-generations", generationId)).catch(() => []);
}
async function delivered(id: string, generationId: string, emailState = "sent") {
  await startWorker();
  await expect
    .poll(async () => (await read(id, generationId)).json().generation.emailState, {
      timeout: 15_000,
    })
    .toBe(emailState);
  return (await read(id, generationId)).json().generation;
}

it("shows Word before PDF, freezes delivery settings, then mails both files with a safe branded cover note", async () => {
  const { id, pair } = await prepare(
    "both",
    "Please **review** this.\n\n[OpenLaw](https://example.com)\n\n<script>alert(1)</script>",
    true,
  );
  const enqueue = h.pipeline.requestGenerationDelivery.bind(h.pipeline);
  h.pipeline.requestGenerationDelivery = async () => {
    throw new Error("Queue is unavailable");
  };
  let generation: { id: string; state: string; answers: Record<string, unknown> };
  try {
    generation = await generate(id, pair);
  } finally {
    h.pipeline.requestGenerationDelivery = enqueue;
  }

  expect(generation).toMatchObject({
    state: "pending",
    hasDocx: true,
    hasPdf: false,
    formats: "both",
    emailState: "pending",
  });
  const word = await read(id, generation.id, "/docx");
  expect(word.statusCode).toBe(200);
  expect((await read(id, generation.id, "/pdf")).statusCode).toBe(409);
  expect(h.mailer.messagesTo(TEST_ADMIN.email)).toHaveLength(0);
  const settings = await h.app.inject({
    method: "PATCH",
    url: `/api/v1/auto-docs/${id}`,
    cookies,
    payload: { formats: "pdf", coverNote: "Later cover note" },
  });
  expect(settings.statusCode).toBe(200);
  const activity = await h.app.inject({
    url: `/api/v1/activity?entityType=auto_doc&entityId=${id}`,
    cookies,
  });
  expect(activity.json().entries).toContainEqual(
    expect.objectContaining({
      action: "auto_doc.updated",
      payload: expect.objectContaining({
        changed: expect.objectContaining({
          formats: { from: "both", to: "pdf" },
          coverNote: expect.objectContaining({ to: "Later cover note" }),
        }),
      }),
    }),
  );
  await startWorker();
  const ready = await delivered(id, generation.id);
  expect(ready).toMatchObject({ state: "ready", hasDocx: true, hasPdf: true, formats: "both" });
  expect(ready.emailSentAt).toEqual(expect.any(String));
  const pdf = await read(id, generation.id, "/pdf");
  expect(pdf.statusCode).toBe(200);
  expect(pdf.headers["content-type"]).toContain("application/pdf");
  expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  expect((await read(id, generation.id, "/docx")).statusCode).toBe(200);
  const mail = h.mailer.messagesTo(TEST_ADMIN.email).at(-1)!;
  expect(mail.subject).toContain("Delivery NDA");
  expect(mail.text).toContain(TEST_ADMIN.displayName);
  expect(mail.text).toContain("Please review this.");
  expect(mail.html).toContain("Acme Legal");
  expect(mail.html).toContain("<strong>review</strong>");
  expect(mail.html).not.toContain("<script>");
  expect(mail.html).not.toContain("Later cover note");
  expect(mail.attachments).toEqual([
    expect.objectContaining({ filename: "Delivery NDA.docx", content: word.rawPayload }),
    expect.objectContaining({ filename: "Delivery NDA.pdf", content: pdf.rawPayload }),
  ]);
});

it.each(["docx", "pdf"] as const)(
  "allows only %s downloads and attaches only that format",
  async (formats) => {
    const { id, pair } = await prepare(formats);
    const generation = await generate(id, pair);
    await delivered(id, generation.id);
    const allowed = await read(id, generation.id, `/${formats}`);
    expect(allowed.statusCode).toBe(200);
    expect((await read(id, generation.id, formats === "docx" ? "/pdf" : "/docx")).statusCode).toBe(
      403,
    );
    const [stored] = await h.db
      .select()
      .from(autoDocGenerations)
      .where(eq(autoDocGenerations.id, generation.id));
    expect(stored!.docxFileRef).toEqual(expect.any(String));
    const mail = h.mailer.messagesTo(TEST_ADMIN.email).at(-1)!;
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments![0]).toMatchObject({
      filename: `Delivery NDA.${formats}`,
      content: allowed.rawPayload,
    });
  },
);

it("keeps downloads ready and records unconfigured SMTP without sending", async () => {
  h.smtpEnv = null;
  try {
    const before = h.mailer.messagesTo(TEST_ADMIN.email).length;
    const { id, pair } = await prepare();
    const generation = await generate(id, pair);
    const ready = await delivered(id, generation.id, "unconfigured");
    expect(ready).toMatchObject({
      state: "ready",
      emailSentAt: null,
      emailFailure: expect.objectContaining({ code: "unconfigured" }),
    });
    expect((await read(id, generation.id, "/pdf")).statusCode).toBe(200);
    expect(h.mailer.messagesTo(TEST_ADMIN.email)).toHaveLength(before);
  } finally {
    h.smtpEnv = { url: "smtp://test", from: "OpenLaw <openlaw@example.com>" };
  }
});

it("retries a failed fill with its original pair and answers after Unpublish, and refuses retry when ready", async () => {
  const { id, pair } = await prepare("docx");
  h.fillEngine.failure = new AutoDocFillError("The Word fill timed out. Try again.");
  let generation: { id: string; state: string; answers: Record<string, unknown> };
  try {
    generation = await generate(id, pair);
  } finally {
    h.fillEngine.failure = null;
  }
  expect(generation.state).toBe("failed");
  expect(
    (
      await h.app.inject({
        method: "POST",
        url: `/api/v1/auto-docs/${id}/unpublish`,
        cookies,
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
  const retry = () =>
    h.app.inject({
      method: "POST",
      url: `/api/v1/auto-docs/${id}/generations/${generation.id}/retry`,
      cookies,
      payload: {},
    });
  expect((await retry()).statusCode).toBe(200);
  const ready = await delivered(id, generation.id);
  expect(ready).toMatchObject({ ...pair, state: "ready", answers: generation.answers });
  expect((await retry()).statusCode).toBe(409);
});

it("keeps Word after a terminal PDF failure and retries the same Generation", async () => {
  const { id, pair } = await prepare();
  const convert = h.docEngine.convertToPdf.bind(h.docEngine);
  h.docEngine.convertToPdf = async (source) => {
    source.destroy();
    throw new SourceUnreadableError("PDF conversion refused the file.");
  };
  let generation: { id: string; state: string; answers: Record<string, unknown> };
  try {
    generation = await generate(id, pair);
    await expect
      .poll(async () => (await read(id, generation.id)).json().generation.state, {
        timeout: 15_000,
      })
      .toBe("failed");
    expect((await read(id, generation.id)).json().generation).toMatchObject({
      hasDocx: true,
      hasPdf: false,
      failure: { code: "pdf_failed" },
    });
    expect((await read(id, generation.id, "/docx")).statusCode).toBe(200);
  } finally {
    h.docEngine.convertToPdf = convert;
  }
  const replaced = await storedBlobs(generation.id);
  expect(replaced).toHaveLength(1);
  const retry = await h.app.inject({
    method: "POST",
    url: `/api/v1/auto-docs/${id}/generations/${generation.id}/retry`,
    cookies,
    payload: {},
  });
  expect(retry.statusCode, retry.body).toBe(200);
  expect(await delivered(id, generation.id)).toMatchObject({
    ...pair,
    state: "ready",
    hasPdf: true,
  });
  // The attempt this retry replaced left no blob behind.
  expect(await storedBlobs(generation.id)).toEqual(
    expect.arrayContaining([expect.stringMatching(/\.pdf$/)]),
  );
  expect(await storedBlobs(generation.id)).not.toContain(replaced[0]);
  expect(await storedBlobs(generation.id)).toHaveLength(2);
});

it("records a permanent SMTP refusal and permits a successful retry", async () => {
  const { id, pair } = await prepare("docx");
  const send = h.mailer.send.bind(h.mailer);
  h.mailer.send = async () => {
    throw Object.assign(new Error("SMTP rejected this message"), { responseCode: 550 });
  };
  let generation: { id: string; state: string; answers: Record<string, unknown> };
  try {
    generation = await generate(id, pair);
    const failed = await delivered(id, generation.id, "failed");
    expect(failed).toMatchObject({
      state: "failed",
      hasDocx: true,
      emailSentAt: null,
      emailFailure: { code: "email_failed" },
    });
  } finally {
    h.mailer.send = send;
  }
  const retry = await h.app.inject({
    method: "POST",
    url: `/api/v1/auto-docs/${id}/generations/${generation.id}/retry`,
    cookies,
    payload: {},
  });
  expect(retry.statusCode, retry.body).toBe(200);
  expect(await delivered(id, generation.id)).toMatchObject({ state: "ready", emailFailure: null });
});

it("ignores duplicate and superseded delivery jobs without sending another email", async () => {
  const { id, pair } = await prepare("docx");
  const generation = await generate(id, pair);
  await delivered(id, generation.id);
  const [row] = await h.db
    .select()
    .from(autoDocGenerations)
    .where(eq(autoDocGenerations.id, generation.id));
  const before = h.mailer.messagesTo(TEST_ADMIN.email).length;
  await h.pipeline.requestGenerationDelivery(generation.id, row!.attempt);
  await h.pipeline.requestGenerationDelivery(generation.id, row!.attempt - 1);
  const later = await generate(id, pair);
  await delivered(id, later.id);
  expect(h.mailer.messagesTo(TEST_ADMIN.email)).toHaveLength(before + 1);
});

it("fails a fill that was interrupted, then lets Legal retry it", async () => {
  const { id, pair } = await prepare("docx");
  const generation = await generate(id, pair);
  await delivered(id, generation.id);
  // What a process that stopped mid-fill leaves: a pending row that no
  // queue ask will ever name, because the ask follows the stored output.
  await h.db
    .update(autoDocGenerations)
    .set({
      state: "pending",
      docxFileRef: null,
      emailState: "pending",
      emailSentAt: null,
      updatedAt: new Date(Date.now() - 6 * 60_000),
    })
    .where(eq(autoDocGenerations.id, generation.id));
  await sweepGenerationDeliveries(
    { db: h.db, log: { info() {}, warn() {}, error() {} } },
    h.pipeline,
  );
  expect((await read(id, generation.id)).json().generation).toMatchObject({
    state: "failed",
    hasDocx: false,
    failure: { code: "fill_interrupted" },
  });
  const retry = await h.app.inject({
    method: "POST",
    url: `/api/v1/auto-docs/${id}/generations/${generation.id}/retry`,
    cookies,
    payload: {},
  });
  expect(retry.statusCode, retry.body).toBe(200);
  expect(await delivered(id, generation.id)).toMatchObject({ state: "ready", hasDocx: true });
});

it("requires recorded email failures to have a nonempty code and reason", async () => {
  const { id, pair } = await prepare("docx");
  const generation = await generate(id, pair);
  await delivered(id, generation.id);
  for (const failure of [
    {},
    { code: "", detail: "Reason" },
    { code: "failed", detail: " " },
    { code: 7, detail: "Reason" },
  ]) {
    await expect(
      h.db.execute(
        sql`update auto_doc_generations set state = 'failed', failure = '{"code":"email_failed","detail":"Email failed"}'::jsonb, email_state = 'failed', email_sent_at = null, email_failure = ${JSON.stringify(failure)}::jsonb where id = ${generation.id}`,
      ),
    ).rejects.toThrow();
  }
});

it("recovers a lost delivery job on the minute sweep without restarting the worker", async () => {
  const { id, pair } = await prepare("docx");
  await startWorker();
  const enqueue = h.pipeline.requestGenerationDelivery;
  h.pipeline.requestGenerationDelivery = async () => {
    throw new Error("Queue unavailable");
  };
  let generationId: string;
  try {
    generationId = (await generate(id, pair)).id;
  } finally {
    h.pipeline.requestGenerationDelivery = enqueue;
  }
  const producer = new PgBoss(h.databaseUrl);
  await producer.start();
  try {
    await producer.send(JOB_QUEUES.conversionSweep, {});
    await expect
      .poll(async () => (await read(id, generationId)).json().generation.emailState, {
        timeout: 10_000,
      })
      .toBe("sent");
  } finally {
    await producer.stop();
  }
});
