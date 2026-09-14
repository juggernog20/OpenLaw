// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-001–004 at the Auto-Doc routes and their real Document chain. */
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { AUTO_DOC_FIELD_TYPES, documents, documentVersions, eq, users } from "@openlaw/db";
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
let autoDocId: string;
beforeAll(async () => {
  h = await startHarness();
  expect(
    (await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN }))
      .statusCode,
  ).toBe(201);
  admin = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  for (const role of ["legal_team_member", "business_user"] as const) {
    const email = `auto-doc-${role}@example.com`;
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

async function upload(name: string, url = `/api/v1/auto-docs/${autoDocId}/template`) {
  const bytes = await readFile(
    new URL(`../../testing/fixtures/auto-docs/${name}.docx`, import.meta.url),
  );
  const boundary = "auto-doc-boundary";
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}.docx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return h.app.inject({
    method: "POST",
    url,
    cookies: member,
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload,
  });
}
async function record() {
  const res = await h.app.inject({
    method: "GET",
    url: `/api/v1/auto-docs/${autoDocId}`,
    cookies: member,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

it("lets Member+ create a draft and list it, while refusing Business Users", async () => {
  for (const method of ["GET", "POST"] as const) {
    const res = await h.app.inject({
      method,
      url: "/api/v1/auto-docs",
      cookies: business,
      ...(method === "POST" ? { payload: { name: "Refused" } } : {}),
    });
    expect(res.statusCode, res.body).toBe(403);
  }
  const made = await h.app.inject({
    method: "POST",
    url: "/api/v1/auto-docs",
    cookies: member,
    payload: { name: "Supplier NDA", description: "Our NDA for suppliers." },
  });
  expect(made.statusCode, made.body).toBe(201);
  expect(made.json().autoDoc.state).toBe("draft");
  autoDocId = made.json().autoDoc.id;
  const list = await h.app.inject({ method: "GET", url: "/api/v1/auto-docs", cookies: admin });
  expect(list.statusCode, list.body).toBe(200);
  expect(list.json().autoDocs.map((d: { id: string }) => d.id)).toContain(autoDocId);
  expect(
    (
      await h.app.inject({
        method: "GET",
        url: `/api/v1/auto-docs/${autoDocId}`,
        cookies: business,
      })
    ).statusCode,
  ).toBe(403);
});

it("stores one template Document, appends Versions, and reconciles its immutable form snapshots", async () => {
  const first = await upload("plain");
  expect(first.statusCode, first.body).toBe(201);
  const before = await record();
  expect(before.template.versions.map((v: { versionNumber: number }) => v.versionNumber)).toEqual([
    1,
  ]);
  expect(before.formVersion.definition.fields.map((f: { slug: string }) => f.slug)).toEqual([
    "counterparty_name",
    "signing_date",
  ]);
  expect(
    before.formVersion.definition.fields.every(
      (f: { fieldType: string }) => f.fieldType === "text",
    ),
  ).toBe(true);
  const saved = await h.app.inject({
    method: "POST",
    url: `/api/v1/auto-docs/${autoDocId}/form-versions`,
    cookies: member,
    payload: {
      fields: [
        {
          slug: "signing_date",
          label: "Signing date",
          help: "Use the date agreed with Legal.",
          fieldType: "date",
          options: null,
          required: true,
        },
        {
          slug: "counterparty_name",
          label: "Counterparty",
          help: null,
          fieldType: "text",
          options: null,
          required: true,
        },
        {
          slug: "review_path",
          label: "Review path",
          help: null,
          fieldType: "single_select",
          options: ["Standard", "Legal"],
          required: false,
        },
      ],
    },
  });
  expect(saved.statusCode, saved.body).toBe(201);
  const edited = await record();
  expect(edited.formVersions).toHaveLength(2);
  expect(
    edited.formVersions.find((v: { versionNumber: number }) => v.versionNumber === 1).definition,
  ).toEqual(before.formVersion.definition);
  const second = await upload("formatting");
  expect(second.statusCode, second.body).toBe(201);
  const after = await record();
  expect(after.template.id).toBe(before.template.id);
  expect(after.template.versions.map((v: { versionNumber: number }) => v.versionNumber)).toEqual([
    2, 1,
  ]);
  expect(after.formVersion.definition.fields.map((f: { slug: string }) => f.slug)).toEqual([
    "signing_date",
    "counterparty_name",
    "review_path",
    "amount",
  ]);
  expect(after.orphanedFields).toEqual(["signing_date"]);
  const direct = await upload("split", `/api/v1/documents/${after.template.id}/versions`);
  expect(direct.statusCode, direct.body).toBe(201);
  const latest = await record();
  expect(latest.template.versions[0].versionNumber).toBe(3);
  expect(latest.orphanedFields).toEqual(["signing_date", "amount"]);
});

it("refuses malformed templates without appending a Version, including ordinary Document uploads", async () => {
  const before = await record();
  for (const url of [
    `/api/v1/auto-docs/${autoDocId}/template`,
    `/api/v1/documents/${before.template.id}/versions`,
  ]) {
    const refused = await upload("unclosed-brace", url);
    expect(refused.statusCode, refused.body).toBe(400);
    expect(refused.json().detail).toContain('"{{counterparty_name"');
  }
  const after = await record();
  expect(after.template.versions).toHaveLength(before.template.versions.length);
  expect(after.formVersions).toHaveLength(before.formVersions.length);
  const [doc] = await h.db.select().from(documents).where(eq(documents.id, after.template.id));
  expect(doc).toMatchObject({
    autoDocId,
    contractId: null,
    matterId: null,
    entityId: null,
    knowledgeItemId: null,
  });
  expect(
    await h.db.select().from(documentVersions).where(eq(documentVersions.documentId, doc!.id)),
  ).toHaveLength(3);
});

it("refuses user fields and invalid options without saving a form version", async () => {
  const before = await record();
  for (const field of [
    { slug: "person", label: "Person", fieldType: "user", options: null },
    { slug: "choice", label: "Choice", fieldType: "single_select", options: [] },
  ]) {
    const res = await h.app.inject({
      method: "POST",
      url: `/api/v1/auto-docs/${autoDocId}/form-versions`,
      cookies: member,
      payload: { fields: [{ ...field, help: null, required: false }] },
    });
    expect(res.statusCode, res.body).toBe(400);
  }
  expect((await record()).formVersions).toHaveLength(before.formVersions.length);
});

it("keeps templates and their activity Legal-only across direct reads, search, and the repository", async () => {
  const current = await record();
  const doc = current.template;
  const paths = [
    `/api/v1/documents/${doc.id}/versions/${doc.versions[0].id}/download`,
    `/api/v1/activity?entityType=auto_doc&entityId=${autoDocId}`,
  ];
  for (const url of paths) {
    const no = await h.app.inject({ method: "GET", url, cookies: business });
    expect(no.statusCode, no.body).toBe(url.startsWith("/api/v1/activity") ? 403 : 404);
    const yes = await h.app.inject({ method: "GET", url, cookies: member });
    expect(yes.statusCode, yes.body).toBe(200);
  }
  const feed = await h.app.inject({ method: "GET", url: paths[1]!, cookies: member });
  expect(feed.json().entries.map((entry: { action: string }) => entry.action)).toEqual(
    expect.arrayContaining([
      "auto_doc.created",
      "auto_doc.template_uploaded",
      "auto_doc.form_saved",
    ]),
  );
  const list = await h.app.inject({
    method: "GET",
    url: `/api/v1/documents?owner=auto_doc&record=${autoDocId}`,
    cookies: member,
  });
  expect(list.statusCode, list.body).toBe(200);
  expect(list.json().documents.map((row: { id: string }) => row.id)).toEqual([doc.id]);
  expect(list.json().documents[0].owner).toMatchObject({ kind: "auto_doc", title: "Supplier NDA" });
  const unhinted = await h.app.inject({
    url: `/api/v1/documents?record=${autoDocId}`,
    cookies: admin,
  });
  expect(unhinted.statusCode, unhinted.body).toBe(200);
  expect(unhinted.json().documents.map((document: { id: string }) => document.id)).toContain(
    doc.id,
  );

  const options = await h.app.inject({
    method: "GET",
    url: "/api/v1/documents/options",
    cookies: member,
  });
  expect(options.statusCode, options.body).toBe(200);
  const search = await h.app.inject({
    method: "GET",
    url: "/api/v1/search?q=Supplier",
    cookies: member,
  });
  expect(search.statusCode, search.body).toBe(200);
  for (const request of [
    { method: "POST" as const, url: `/api/v1/documents/${doc.id}/archive` },
    {
      method: "DELETE" as const,
      url: `/api/v1/documents/${doc.id}`,
      payload: { confirmTitle: doc.title },
    },
  ]) {
    const refused = await h.app.inject({ ...request, cookies: admin });
    expect(refused.statusCode, refused.body).toBe(409);
  }
});

it("accepts all nine field types and serializes concurrent form saves into separate snapshots", async () => {
  const fields = AUTO_DOC_FIELD_TYPES.map((type) => ({
    slug: `field_${type}`,
    label: type,
    fieldType: type,
    options: type === "single_select" || type === "multi_select" ? ["A", "B"] : null,
    required: false,
    help: null,
  }));
  const before = await record();
  const answers = await Promise.all(
    [1, 2].map(() =>
      h.app.inject({
        method: "POST",
        url: `/api/v1/auto-docs/${autoDocId}/form-versions`,
        cookies: member,
        payload: { fields },
      }),
    ),
  );
  for (const answer of answers) expect(answer.statusCode, answer.body).toBe(201);
  const after = await record();
  expect(after.formVersions).toHaveLength(before.formVersions.length + 2);
  expect(
    after.formVersions.slice(0, 2).map((row: { versionNumber: number }) => row.versionNumber),
  ).toEqual([before.formVersion.versionNumber + 2, before.formVersion.versionNumber + 1]);
  expect(
    after.formVersion.definition.fields.map((field: { fieldType: string }) => field.fieldType),
  ).toEqual(AUTO_DOC_FIELD_TYPES);
  expect(
    after.formVersions.find((row: { id: string }) => row.id === before.formVersion.id).definition,
  ).toEqual(before.formVersion.definition);
});

it("keeps concurrent first uploads on one Document chain", async () => {
  const created = await h.app.inject({
    method: "POST",
    url: "/api/v1/auto-docs",
    cookies: member,
    payload: { name: "Concurrent template" },
  });
  const id = created.json().autoDoc.id;
  const uploads = await Promise.all(
    ["plain", "formatting"].map((name) => upload(name, `/api/v1/auto-docs/${id}/template`)),
  );
  for (const response of uploads) expect(response.statusCode, response.body).toBe(201);
  const response = await h.app.inject({
    method: "GET",
    url: `/api/v1/auto-docs/${id}`,
    cookies: member,
  });
  expect(response.statusCode, response.body).toBe(200);
  const current = response.json();
  expect(
    current.template.versions.map((version: { versionNumber: number }) => version.versionNumber),
  ).toEqual([2, 1]);
  expect(
    current.formVersions.map((version: { versionNumber: number }) => version.versionNumber),
  ).toEqual([2, 1]);
  expect(await h.db.select().from(documents).where(eq(documents.autoDocId, id))).toHaveLength(1);
  for (const version of current.template.versions) {
    const downloaded = await h.app.inject({
      method: "GET",
      url: `/api/v1/documents/${current.template.id}/versions/${version.id}/download`,
      cookies: member,
    });
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.rawPayload.subarray(0, 2).toString()).toBe("PK");
  }
});

it("carries detected Blocks and Placeholders through the stored scan", async () => {
  const created = await h.app.inject({
    method: "POST",
    url: "/api/v1/auto-docs",
    cookies: member,
    payload: { name: "Blocks template" },
  });
  const id = created.json().autoDoc.id;
  expect((await upload("blocks", `/api/v1/auto-docs/${id}/template`)).statusCode).toBe(201);
  const response = await h.app.inject({
    method: "GET",
    url: `/api/v1/auto-docs/${id}`,
    cookies: member,
  });
  expect(response.statusCode, response.body).toBe(200);
  const current = response.json();
  expect(current.detection).toEqual({
    placeholders: ["seat", "address"],
    blocks: ["arbitration", "notice"],
  });
  // A Block is not a form field: only the Placeholders become rows.
  expect(current.formVersion.definition.fields.map((f: { slug: string }) => f.slug)).toEqual([
    "seat",
    "address",
  ]);
  expect(current.orphanedFields).toEqual([]);
});
