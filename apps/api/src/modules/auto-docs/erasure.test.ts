// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-012 and DOC-010: permanent erasure through the Administrator route. */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { eq, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

let h: TestHarness;
let admin: Record<string, string>;
let member: Record<string, string>;
let business: Record<string, string>;
beforeAll(async () => {
  h = await startHarness();
  expect(
    (await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN }))
      .statusCode,
  ).toBe(201);
  admin = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  for (const role of ["legal_team_member", "business_user"] as const) {
    const email = `erasure-${role}@example.com`;
    const person = await provisionUser(h.app.auth, {
      email,
      displayName: role,
      password: "correct-horse-battery",
    });
    await h.db.update(users).set({ role }).where(eq(users.id, person.id));
    const cookies = await signInCookies(h.app, email, "correct-horse-battery");
    if (role === "legal_team_member") member = cookies;
    else business = cookies;
  }
});
afterAll(async () => {
  await h.stop();
});

async function prepare(targeted = false) {
  const name = "Erasure NDA";
  const made = await h.app.inject({
    method: "POST",
    url: "/api/v1/auto-docs",
    cookies: admin,
    payload: { name },
  });
  expect(made.statusCode, made.body).toBe(201);
  const id: string = made.json().autoDoc.id;
  let targetContractTypeId: string | undefined;
  if (targeted) {
    const type = await h.app.inject({
      method: "POST",
      url: "/api/v1/contract-types",
      cookies: admin,
      payload: { displayName: `Erasure Type ${id}` },
    });
    expect(type.statusCode, type.body).toBe(201);
    targetContractTypeId = type.json().contractType.id;
  }
  const settings = await h.app.inject({
    method: "PATCH",
    url: `/api/v1/auto-docs/${id}`,
    cookies: admin,
    payload: {
      formats: "docx",
      audience: "everyone",
      acknowledgementFrequency: "none",
      ...(targeted ? { targetContractTypeId, titlePattern: "Retained generated Contract" } : {}),
    },
  });
  expect(settings.statusCode, settings.body).toBe(200);
  const bytes = await readFile(
    new URL("../../testing/fixtures/auto-docs/plain.docx", import.meta.url),
  );
  const uploaded = await h.app.inject({
    method: "POST",
    url: `/api/v1/auto-docs/${id}/template`,
    cookies: admin,
    headers: { "content-type": "multipart/form-data; boundary=erasure" },
    payload: Buffer.concat([
      Buffer.from(
        '--erasure\r\nContent-Disposition: form-data; name="file"; filename="NDA.docx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n',
      ),
      bytes,
      Buffer.from("\r\n--erasure--\r\n"),
    ]),
  });
  expect(uploaded.statusCode, uploaded.body).toBe(201);
  const record = (await h.app.inject({ url: `/api/v1/auto-docs/${id}`, cookies: admin })).json();
  const pair = {
    documentVersionId: record.template.versions[0].id as string,
    formVersionId: record.formVersion.id as string,
  };
  const published = await h.app.inject({
    method: "POST",
    url: `/api/v1/auto-docs/${id}/publish`,
    cookies: admin,
    payload: pair,
  });
  expect(published.statusCode, published.body).toBe(200);
  return { id, name, pair, documentId: record.template.id as string };
}
async function generate(source: Awaited<ReturnType<typeof prepare>>) {
  const response = await h.app.inject({
    method: "POST",
    url: `/api/v1/portal/auto-docs/${source.id}/generations`,
    cookies: business,
    payload: { ...source.pair, answers: { counterparty_name: "Private supplier" } },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().generation;
}
async function remove(source: { id: string; name: string }, cookies = admin, confirm = "delete") {
  return h.app.inject({
    method: "DELETE",
    url: `/api/v1/auto-docs/${source.id}`,
    cookies,
    payload: { confirm, confirmName: source.name },
  });
}
async function files() {
  return (await readdir(h.storageRoot, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

it("requires an Administrator, the typed word, and the current Auto-Doc name", async () => {
  const source = await prepare();
  for (const cookies of [member, business])
    expect((await remove(source, cookies)).statusCode).toBe(403);
  for (const confirm of ["", "yes", source.name])
    expect((await remove(source, admin, confirm)).statusCode).toBe(400);
  expect((await remove({ ...source, name: "An earlier name" })).statusCode).toBe(409);
  expect(
    (await h.app.inject({ url: `/api/v1/auto-docs/${source.id}`, cookies: admin })).statusCode,
  ).toBe(200);
  expect((await remove(source)).statusCode).toBe(204);
  expect((await remove(source)).statusCode).toBe(404);
});

it.each([false, true])(
  "erases source files, form snapshots and Generation answers (archived: %s)",
  async (archived) => {
    const before = await files();
    const source = await prepare();
    const generation = await generate(source);
    expect(generation.state).toBe("ready");
    if (archived)
      expect(
        (
          await h.app.inject({
            method: "POST",
            url: `/api/v1/auto-docs/${source.id}/archive`,
            cookies: admin,
            payload: {},
          })
        ).statusCode,
      ).toBe(200);
    const erased = await remove(source);
    expect(erased.statusCode, erased.body).toBe(204);
    for (const [url, cookies] of [
      [`/api/v1/auto-docs/${source.id}`, admin],
      [`/api/v1/auto-docs/${source.id}/generations/${generation.id}`, admin],
      [`/api/v1/portal/auto-docs/${source.id}/generations/${generation.id}`, business],
      [`/api/v1/auto-docs/${source.id}/generations/${generation.id}/docx`, admin],
      [
        `/api/v1/documents/${source.documentId}/versions/${source.pair.documentVersionId}/download`,
        admin,
      ],
    ] as const)
      expect((await h.app.inject({ url, cookies })).statusCode).toBe(404);
    const list = await h.app.inject({ url: "/api/v1/auto-docs", cookies: admin });
    expect(list.json().autoDocs.map((row: { id: string }) => row.id)).not.toContain(source.id);
    expect(await files()).toEqual(before);
  },
);

it("leaves the record available for retry when blob erasure fails", async () => {
  const before = await files();
  const source = await prepare();
  await generate(source);
  const original = h.app.storage.delete.bind(h.app.storage);
  let calls = 0;
  const failure = vi.spyOn(h.app.storage, "delete").mockImplementation(async (ref) => {
    if (++calls === 2) throw new Error("Storage temporarily unavailable");
    await original(ref);
  });
  try {
    expect((await remove(source)).statusCode).toBe(500);
  } finally {
    failure.mockRestore();
  }
  expect(
    (await h.app.inject({ url: `/api/v1/auto-docs/${source.id}`, cookies: admin })).statusCode,
  ).toBe(200);
  expect((await remove(source)).statusCode).toBe(204);
  expect(await files()).toEqual(before);
});
