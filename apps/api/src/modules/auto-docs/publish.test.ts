// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-002–004 and ADO-010 through the routes and a real Postgres. */
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { autoDocs, contractTypes, fields, eq, sql, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

let h: TestHarness;
let member: Record<string, string>;
let business: Record<string, string>;
let catalogId: string;
let outsideId: string;
let typeId: string;
let typeName: string;
beforeAll(async () => {
  h = await startHarness();
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  for (const role of ["legal_team_member", "business_user"] as const) {
    const email = `publish-${role}@example.com`;
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
  for (const scope of ["contract", "matter"] as const) {
    const [field] = await h.db
      .insert(fields)
      .values({
        slug: `publish_${scope}`,
        displayName: `Publish ${scope}`,
        moduleScope: scope,
        fieldType: "text",
        fieldTag: "business",
      })
      .returning();
    if (scope === "contract") catalogId = field!.id;
    else outsideId = field!.id;
  }
  const [type] = await h.db.select().from(contractTypes).limit(1);
  typeId = type!.id;
  typeName = type!.displayName;
});
afterAll(async () => {
  await h.stop();
});

function field(slug: string, extra: Record<string, unknown> = {}) {
  return { slug, label: slug, fieldType: "text", ...extra };
}
function rule(
  blockName = "arbitration",
  fieldSlug = "jurisdiction",
  operator = "equals",
  value: unknown = "US",
) {
  return { blockName, fieldSlug, operator, value };
}
async function call(id: string, action = "", payload?: Record<string, unknown>, cookies = member) {
  return h.app.inject({
    method: payload === undefined ? "GET" : "POST",
    url: `/api/v1/auto-docs/${id}${action ? `/${action}` : ""}`,
    cookies,
    ...(payload === undefined ? {} : { payload }),
  });
}
async function upload(id: string, fixture: string) {
  const bytes = await readFile(
    new URL(`../../testing/fixtures/auto-docs/${fixture}.docx`, import.meta.url),
  );
  return h.app.inject({
    method: "POST",
    url: `/api/v1/auto-docs/${id}/template`,
    cookies: member,
    headers: { "content-type": "multipart/form-data; boundary=publish" },
    payload: Buffer.concat([
      Buffer.from(
        `--publish\r\nContent-Disposition: form-data; name="file"; filename="${fixture}.docx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n`,
      ),
      bytes,
      Buffer.from("\r\n--publish--\r\n"),
    ]),
  });
}
async function create(name = "Publish NDA", fixture = "blocks") {
  const made = await h.app.inject({
    method: "POST",
    url: "/api/v1/auto-docs",
    cookies: member,
    payload: { name },
  });
  expect(made.statusCode, made.body).toBe(201);
  const id = made.json().autoDoc.id;
  const uploaded = await upload(id, fixture);
  expect(uploaded.statusCode, uploaded.body).toBe(201);
  return uploaded.json();
}
function pair(record: { template: { versions: { id: string }[] }; formVersion: { id: string } }) {
  return {
    documentVersionId: record.template.versions[0]!.id,
    formVersionId: record.formVersion.id,
  };
}

it("saves all four Clause operators and one map per field, and refuses absent Blocks and out-of-scope catalog Fields", async () => {
  const initial = await create();
  const id = initial.autoDoc.id;
  for (const [operator, value] of [
    ["equals", "US"],
    ["is_one_of", ["US", "UK"]],
    ["is_set", null],
    ["is_not", "UK"],
  ]) {
    const saved = await call(id, "form-versions", {
      fields: [
        field("jurisdiction", {
          fieldType: "single_select",
          options: ["US", "UK"],
          catalogFieldId: catalogId,
        }),
        field("counterparty_name", { contractAttribute: "primary_counterparty_name" }),
      ],
      clauseRules: [rule("arbitration", "jurisdiction", operator as string, value)],
    });
    expect(saved.statusCode, saved.body).toBe(201);
    expect(saved.json().formVersion.definition.clauseRules[0]).toMatchObject({ operator, value });
    expect(saved.json().formVersion.definition.fields[0].catalogFieldId).toBe(catalogId);
    expect(saved.json().formVersion.definition.fields[1].contractAttribute).toBe(
      "primary_counterparty_name",
    );
  }
  for (const payload of [
    { fields: [field("jurisdiction")], clauseRules: [rule("missing")] },
    { fields: [field("jurisdiction", { catalogFieldId: outsideId })] },
    { fields: [field("jurisdiction", { catalogFieldId: catalogId, contractAttribute: "title" })] },
    { fields: [field("jurisdiction")], clauseRules: [rule(), rule()] },
  ])
    expect((await call(id, "form-versions", payload)).statusCode).toBe(400);
  const options = await h.app.inject({
    method: "GET",
    url: "/api/v1/auto-docs/options",
    cookies: member,
  });
  expect(options.statusCode, options.body).toBe(200);
  expect(options.json().catalogFields.map((f: { id: string }) => f.id)).toContain(catalogId);
  expect(options.json().catalogFields.map((f: { id: string }) => f.id)).not.toContain(outsideId);
});

it("pins a selected pair, keeps it through both kinds of edit, and audits every lifecycle act without deleting history", async () => {
  const initial = await create("Lifecycle", "plain");
  const id = initial.autoDoc.id;
  const pinned = pair(initial);
  expect((await call(id, "unpublish", {})).statusCode).toBe(409);
  expect((await call(id, "restore", {})).statusCode).toBe(409);
  const published = await call(id, "publish", pinned);
  expect(published.statusCode, published.body).toBe(200);
  expect(published.json().autoDoc).toMatchObject({
    state: "published",
    publishedDocumentVersionId: pinned.documentVersionId,
    publishedFormVersionId: pinned.formVersionId,
  });
  expect((await call(id, "publish", pinned)).statusCode).toBe(409);
  const saved = await call(id, "form-versions", {
    fields: [field("counterparty_name"), field("signing_date", { fieldType: "date" })],
  });
  expect(saved.statusCode, saved.body).toBe(201);
  expect((await upload(id, "formatting")).statusCode).toBe(201);
  const edited = (await call(id)).json();
  expect(edited.autoDoc.publishedDocumentVersionId).toBe(pinned.documentVersionId);
  expect(edited.autoDoc.publishedFormVersionId).toBe(pinned.formVersionId);
  expect((await call(id, "publish", pair(edited))).statusCode).toBe(200);
  const unpublished = await call(id, "unpublish", {});
  expect(unpublished.json().autoDoc).toMatchObject({
    state: "draft",
    publishedDocumentVersionId: null,
    publishedFormVersionId: null,
    publishedAt: null,
  });
  expect(unpublished.json().formVersions).toHaveLength(3);
  expect(unpublished.json().template.versions).toHaveLength(2);
  expect((await call(id, "publish", pinned)).statusCode).toBe(200);
  const archived = await call(id, "archive", {});
  expect(archived.json().autoDoc).toMatchObject({
    state: "archived",
    publishedDocumentVersionId: null,
    publishedFormVersionId: null,
  });
  expect(archived.json().autoDoc.archivedAt).toBeTruthy();
  for (const action of ["archive", "publish", "unpublish"])
    expect((await call(id, action, action === "publish" ? pinned : {})).statusCode).toBe(409);
  expect((await call(id, "form-versions", { fields: [] })).statusCode).toBe(409);
  expect((await upload(id, "plain")).statusCode).toBe(409);
  const restored = await call(id, "restore", {});
  expect(restored.json().autoDoc).toMatchObject({ state: "draft", archivedAt: null });
  expect(restored.json().formVersions).toHaveLength(3);
  const activity = await h.app.inject({
    method: "GET",
    url: `/api/v1/activity?entityType=auto_doc&entityId=${id}`,
    cookies: member,
  });
  expect(activity.statusCode, activity.body).toBe(200);
  const items = activity.json().entries;
  for (const action of ["published", "unpublished", "archived", "restored"])
    expect(
      items.some(
        (a: {
          action: string;
          payload: {
            documentVersionId?: string;
            formVersionId?: string;
            changed: Record<string, unknown>;
          };
        }) => a.action === `auto_doc.${action}`,
      ),
    ).toBe(true);
  expect(
    items.find(
      (a: {
        action: string;
        payload: {
          documentVersionId?: string;
          formVersionId?: string;
          changed: Record<string, unknown>;
        };
      }) =>
        a.action === "auto_doc.published" &&
        a.payload.documentVersionId === pinned.documentVersionId,
    )?.payload.formVersionId,
  ).toBe(pinned.formVersionId);
});

it("names missing Placeholders, Blocks, fields, and options together when publishing an incompatible pair", async () => {
  const initial = await create("Gaps");
  const id = initial.autoDoc.id;
  const saved = await call(id, "form-versions", {
    fields: [field("jurisdiction", { fieldType: "single_select", options: ["UK"] })],
    clauseRules: [rule("arbitration"), rule("confidentiality", "removed_field", "is_set", null)],
  });
  // The fixture has arbitration only; a second rule becomes stale by editing its field instead.
  expect(saved.statusCode).toBe(400);
  const withRule = await call(id, "form-versions", {
    fields: [field("jurisdiction", { fieldType: "single_select", options: ["UK"] })],
    clauseRules: [rule()],
  });
  expect(withRule.statusCode, withRule.body).toBe(201);
  const plain = await upload(id, "plain");
  expect(plain.statusCode, plain.body).toBe(201);
  const refused = await call(id, "publish", {
    documentVersionId: plain.json().template.versions[0].id,
    formVersionId: withRule.json().formVersion.id,
  });
  expect(refused.statusCode, refused.body).toBe(409);
  for (const name of ["counterparty_name", "signing_date", "arbitration", "US"])
    expect(refused.json().detail).toContain(name);
  const removed = await call(id, "form-versions", { fields: [], clauseRules: [] });
  expect(removed.statusCode).toBe(201);
  const missingField = await call(id, "publish", {
    documentVersionId: initial.template.versions[0].id,
    formVersionId: withRule.json().formVersion.id,
  });
  expect(missingField.statusCode).toBe(409);
  const fresh = await create("Missing rule field");
  const stale = await call(fresh.autoDoc.id, "form-versions", {
    fields: [],
    clauseRules: [rule()],
  });
  expect(stale.statusCode).toBe(201);
  const gap = await call(fresh.autoDoc.id, "publish", pair(stale.json()));
  expect(gap.statusCode).toBe(409);
  expect(gap.json().detail).toContain("jurisdiction");
});

it("compares any two immutable forms by structure and refuses a form from another Auto-Doc", async () => {
  const initial = await create("Diff");
  const id = initial.autoDoc.id;
  const before = await call(id, "form-versions", {
    fields: [field("first"), field("second"), field("removed")],
    clauseRules: [rule("arbitration", "first", "is_set", null)],
  });
  const after = await call(id, "form-versions", {
    fields: [
      field("second", { label: "Second label", fieldType: "number" }),
      field("first", { contractAttribute: "title" }),
      field("added"),
    ],
    clauseRules: [rule("arbitration", "second", "is_set", null)],
  });
  const compared = await call(
    id,
    `form-versions/diff?from=${before.json().formVersion.id}&to=${after.json().formVersion.id}`,
  );
  expect(compared.statusCode, compared.body).toBe(200);
  const kinds = compared.json().changes.map((change: { kind: string }) => change.kind);
  for (const kind of [
    "added",
    "removed",
    "retyped",
    "relabelled",
    "reordered",
    "mapped",
    "rules_changed",
  ])
    expect(kinds).toContain(kind);
  const other = await create("Other");
  expect(
    (
      await call(
        id,
        `form-versions/diff?from=${other.formVersion.id}&to=${after.json().formVersion.id}`,
      )
    ).statusCode,
  ).toBe(404);
  expect((await call(id, "publish", pair(other))).statusCode).toBe(400);
});

it("stores audited audience and target Type settings, searches names literally, and hides archived records by default", async () => {
  const initial = await create("Search 100% NDA", "plain");
  const id = initial.autoDoc.id;
  const changed = await h.app.inject({
    method: "PATCH",
    url: `/api/v1/auto-docs/${id}`,
    cookies: member,
    payload: { audience: "selected", targetContractTypeId: typeId },
  });
  expect(changed.statusCode, changed.body).toBe(200);
  expect(changed.json().autoDoc).toMatchObject({
    audience: "selected",
    targetContractTypeId: typeId,
  });
  async function list(query = "") {
    const res = await h.app.inject({
      method: "GET",
      url: `/api/v1/auto-docs${query}`,
      cookies: member,
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json().autoDocs.map((row: { id: string }) => row.id);
  }
  expect(
    await list(`?q=100%25&audience=selected&targetContractTypeId=${typeId}&state=draft`),
  ).toEqual([id]);
  expect(await list("?audience=everyone")).not.toContain(id);
  await call(id, "archive", {});
  expect(await list()).not.toContain(id);
  expect(await list("?state=archived")).toContain(id);
  expect(await list("?state=all")).toContain(id);
  const log = await h.app.inject({
    method: "GET",
    url: `/api/v1/activity?entityType=auto_doc&entityId=${id}`,
    cookies: member,
  });
  expect(
    log.json().entries.find(
      (a: {
        action: string;
        payload: {
          documentVersionId?: string;
          formVersionId?: string;
          changed: Record<string, unknown>;
        };
      }) => a.action === "auto_doc.updated",
    ).payload.changed.audience,
  ).toEqual({ from: "legal_only", to: "selected" });
  expect(
    log.json().entries.find((entry: { action: string }) => entry.action === "auto_doc.updated")
      .payload.changed.targetContractType,
  ).toEqual({ from: null, to: typeName });
});

it("refuses Business Users on settings, options, diffs, and every lifecycle route", async () => {
  const initial = await create("Reach", "plain");
  const id = initial.autoDoc.id;
  for (const action of ["publish", "unpublish", "archive", "restore"])
    expect(
      (await call(id, action, action === "publish" ? pair(initial) : {}, business)).statusCode,
    ).toBe(403);
  expect(
    (
      await h.app.inject({
        method: "PATCH",
        url: `/api/v1/auto-docs/${id}`,
        cookies: business,
        payload: { audience: "everyone" },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (await h.app.inject({ method: "GET", url: "/api/v1/auto-docs/options", cookies: business }))
      .statusCode,
  ).toBe(403);
  expect(
    (
      await call(
        id,
        `form-versions/diff?from=${initial.formVersion.id}&to=${initial.formVersion.id}`,
        undefined,
        business,
      )
    ).statusCode,
  ).toBe(403);
});

it("keeps the published pair on its own template and Auto-Doc even through direct database writes", async () => {
  const own = await create("Own", "plain");
  const other = await create("Foreign", "plain");
  const ownPair = pair(own);
  expect((await call(own.autoDoc.id, "publish", ownPair)).statusCode).toBe(200);
  await expect(
    h.db.execute(
      sql`update auto_docs set published_form_version_id = ${other.formVersion.id} where id = ${own.autoDoc.id}`,
    ),
  ).rejects.toThrow();
  await expect(
    h.db.execute(
      sql`update auto_docs set published_document_version_id = ${other.template.versions[0].id} where id = ${own.autoDoc.id}`,
    ),
  ).rejects.toThrow();
  await expect(
    h.db.execute(
      sql`update auto_docs set published_form_version_id = null where id = ${own.autoDoc.id}`,
    ),
  ).rejects.toThrow();
  await expect(
    h.db.execute(
      sql`update auto_doc_form_versions set auto_doc_id = ${other.autoDoc.id}, version_number = 100 where id = ${ownPair.formVersionId}`,
    ),
  ).rejects.toThrow();
  await expect(
    h.db.execute(
      sql`update document_versions set document_id = ${other.template.id}, version_number = 100 where id = ${ownPair.documentVersionId}`,
    ),
  ).rejects.toThrow();
  expect(
    (await h.db.select().from(autoDocs).where(eq(autoDocs.id, own.autoDoc.id)))[0]?.state,
  ).toBe("published");
});

it("checks rule values after a field is retyped and accepts numeric and Boolean lists", async () => {
  const initial = await create("Typed rules");
  for (const [fieldType, value, status] of [
    ["number", [1, 2], 200],
    ["number", ["one"], 409],
    ["boolean", [true, false], 200],
  ] as const) {
    const saved = await call(initial.autoDoc.id, "form-versions", {
      fields: [field("seat"), field("address"), field("condition", { fieldType })],
      clauseRules: [rule("arbitration", "condition", "is_one_of", value)],
    });
    expect(saved.statusCode, saved.body).toBe(201);
    const published = await call(initial.autoDoc.id, "publish", pair(saved.json()));
    expect(published.statusCode, published.body).toBe(status);
    if (status === 409) expect(published.json().detail).toContain("number values");
  }
});
