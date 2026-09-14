// SPDX-License-Identifier: AGPL-3.0-only

/** DES-087: the template reading route over real Postgres and storage. */
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

let h: TestHarness;
let cookies: Record<string, string>;
let autoDocId: string;

async function upload(name: string, id = autoDocId) {
  const bytes = await readFile(
    new URL(`../../testing/fixtures/auto-docs/${name}.docx`, import.meta.url),
  );
  const boundary = "auto-doc-reading-boundary";
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}.docx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return h.app.inject({
    method: "POST",
    url: `/api/v1/auto-docs/${id}/template`,
    cookies,
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload,
  });
}

beforeAll(async () => {
  h = await startHarness({ runPipelineWorkers: false });
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  cookies = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  const created = await h.app.inject({
    method: "POST",
    url: "/api/v1/auto-docs",
    cookies,
    payload: { name: "Reading NDA", description: null },
  });
  autoDocId = created.json().autoDoc.id;
});

afterAll(async () => {
  await h.stop();
});

it("reads a file version as typed paragraphs and says which Placeholders have a field", async () => {
  const uploaded = await upload("blocks");
  expect(uploaded.statusCode).toBe(201);
  const versionId = uploaded.json().template.versions[0].id as string;
  const read = await h.app.inject({
    method: "GET",
    url: `/api/v1/auto-docs/${autoDocId}/template/${versionId}/reading`,
    cookies,
  });
  expect(read.statusCode).toBe(200);
  const reading = read.json();
  expect(reading.versionNumber).toBe(1);
  expect(reading.parts[0].kind).toBe("body");
  const segments = reading.parts.flatMap((part: { paragraphs: unknown[][] }) =>
    part.paragraphs.flat(),
  ) as Array<{ kind: string; name?: string; hasField?: boolean }>;
  const placeholders = segments.filter((segment) => segment.kind === "placeholder");
  expect(placeholders.length).toBeGreaterThan(0);
  // Detection created one field per Placeholder, so every one is filled.
  expect(placeholders.every((segment) => segment.hasField)).toBe(true);
  expect(segments.some((segment) => segment.kind === "block_open")).toBe(true);
});

it("refuses a version that belongs to another Auto-Doc", async () => {
  const other = await h.app.inject({
    method: "POST",
    url: "/api/v1/auto-docs",
    cookies,
    payload: { name: "Other NDA", description: null },
  });
  const otherId = other.json().autoDoc.id as string;
  const uploaded = await upload("plain", otherId);
  const foreignVersion = uploaded.json().template.versions[0].id as string;
  const read = await h.app.inject({
    method: "GET",
    url: `/api/v1/auto-docs/${autoDocId}/template/${foreignVersion}/reading`,
    cookies,
  });
  expect(read.statusCode).toBe(404);
});
