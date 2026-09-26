// SPDX-License-Identifier: AGPL-3.0-only

/** DOC-015 Document types: three lists in one table, fixed Contract rows,
 * and the type a Version carries through upload and correction. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, documentVersions, eq, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "document-types-member@example.com",
  displayName: "Dana Types",
  password: "correct-horse-battery",
} as const;

const BUSINESS = {
  email: "document-types-business@example.com",
  displayName: "Bo Business",
  password: "correct-horse-battery",
} as const;

interface TypeRow {
  id: string;
  slug: string;
  displayName: string;
  archivedAt: string | null;
  inUseCount: number;
  systemKind: string | null;
  color: string | null;
}

interface VersionRow {
  id: string;
  kind: string;
  documentType: { id: string; displayName: string; archived: boolean } | null;
}

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let memberId: string;
let businessCookies: Record<string, string>;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  const member = await provisionUser(harness.app.auth, MEMBER);
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, member.id));
  memberId = member.id;
  adminCookies = await signInCookies(harness.app, ADMIN.email, ADMIN.password);
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
  // provisionUser leaves the default role, business_user.
  await provisionUser(harness.app.auth, BUSINESS);
  businessCookies = await signInCookies(harness.app, BUSINESS.email, BUSINESS.password);
});

afterAll(async () => harness.stop());

async function listTypes(module: string): Promise<TypeRow[]> {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/documents/types/${module}?includeArchived=true`,
    cookies: adminCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().documentTypes;
}

async function createType(module: string, displayName: string): Promise<TypeRow> {
  const res = await harness.app.inject({
    method: "POST",
    url: `/api/v1/documents/types/${module}`,
    cookies: adminCookies,
    payload: { displayName },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().documentType;
}

async function newContract(title: string) {
  const options = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: adminCookies,
  });
  const [type] = options.json().contractTypes as { id: string }[];
  const created = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: adminCookies,
    payload: { title, contractTypeId: type!.id },
  });
  expect(created.statusCode, created.body).toBe(201);
  return created.json().contract as { id: string; number: number };
}

async function newMatter(title: string) {
  const options = await harness.app.inject({
    method: "GET",
    url: "/api/v1/matters/options",
    cookies: memberCookies,
  });
  const [type] = options.json().matterTypes as { id: string }[];
  const created = await harness.app.inject({
    method: "POST",
    url: "/api/v1/matters",
    cookies: memberCookies,
    payload: { title, matterTypeId: type!.id, managerId: memberId },
  });
  expect(created.statusCode, created.body).toBe(201);
  return created.json().matter as { id: string; number: number };
}

const BOUNDARY = "openlaw-document-types-boundary";

function uploadBody(fields: Record<string, string>) {
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(`--${BOUNDARY}\r\ncontent-disposition: form-data; name="${name}"\r\n\r\n`),
      Buffer.from(value),
      Buffer.from("\r\n"),
    );
  }
  chunks.push(
    Buffer.from(
      `--${BOUNDARY}\r\ncontent-disposition: form-data; name="file"; filename="paper.pdf"\r\n` +
        "content-type: application/pdf\r\n\r\n",
    ),
    Buffer.from("%PDF-1.4 typed paper"),
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  );
  return {
    payload: Buffer.concat(chunks),
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

function upload(url: string, fields: Record<string, string> = {}) {
  const { payload, headers } = uploadBody(fields);
  return harness.app.inject({ method: "POST", url, cookies: memberCookies, headers, payload });
}

function currentOf(document: { versions: VersionRow[] }): VersionRow {
  return document.versions[document.versions.length - 1]!;
}

describe("the Document type lists", () => {
  it("seeds six fixed Contract types, leaves the other lists empty, and has no Knowledge list", async () => {
    const contract = await listTypes("contract");
    expect(contract.map((row) => [row.displayName, row.systemKind])).toEqual([
      ["Draft · ours", "draft_ours"],
      ["Draft · theirs", "draft_theirs"],
      ["Redline · theirs", "redline_theirs"],
      ["Redline · ours", "redline_ours"],
      ["Executed", "executed"],
      ["Amendment", "amendment"],
    ]);
    for (const module of ["matter", "entity"]) {
      expect(await listTypes(module), module).toEqual([]);
    }
    const knowledge = await harness.app.inject({
      method: "GET",
      url: "/api/v1/documents/types/knowledge",
      cookies: adminCookies,
    });
    expect(knowledge.statusCode).toBe(404);
  });

  it("keeps the settings lists Administrator-only and the options open to uploaders", async () => {
    const refused = await harness.app.inject({
      method: "GET",
      url: "/api/v1/documents/types/contract",
      cookies: memberCookies,
    });
    expect(refused.statusCode).toBe(403);
    const options = await harness.app.inject({
      method: "GET",
      url: "/api/v1/documents/type-options?module=contract",
      cookies: memberCookies,
    });
    expect(options.statusCode, options.body).toBe(200);
    expect(options.json().documentTypes).toHaveLength(6);

    // A Business User uploads to Contracts and Matters but reaches no
    // Entity paper (ENT-004), so the Entity list is refused.
    const businessContract = await harness.app.inject({
      method: "GET",
      url: "/api/v1/documents/type-options?module=contract",
      cookies: businessCookies,
    });
    expect(businessContract.statusCode, businessContract.body).toBe(200);
    const businessEntity = await harness.app.inject({
      method: "GET",
      url: "/api/v1/documents/type-options?module=entity",
      cookies: businessCookies,
    });
    expect(businessEntity.statusCode).toBe(403);
  });

  it("refuses to rename, archive, or delete a fixed type", async () => {
    const [executed] = (await listTypes("contract")).filter((row) => row.slug === "executed");
    const base = `/api/v1/documents/types/contract/${executed!.id}`;
    const rename = await harness.app.inject({
      method: "PATCH",
      url: base,
      cookies: adminCookies,
      payload: { displayName: "Signed" },
    });
    expect(rename.statusCode, rename.body).toBe(409);
    const archive = await harness.app.inject({
      method: "POST",
      url: `${base}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(archive.statusCode, archive.body).toBe(409);
    const remove = await harness.app.inject({ method: "DELETE", url: base, cookies: adminCookies });
    expect(remove.statusCode, remove.body).toBe(409);
  });

  it("keeps each list to its own module", async () => {
    const memo = await createType("matter", "Memo");
    expect(memo.systemKind).toBeNull();
    // The same name is free on another list, and one list cannot reach
    // the other's rows.
    await createType("entity", "Memo");
    const crossed = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/documents/types/contract/${memo.id}`,
      cookies: adminCookies,
      payload: { displayName: "Moved" },
    });
    expect(crossed.statusCode, crossed.body).toBe(404);
    expect((await listTypes("matter")).map((row) => row.displayName)).toEqual(["Memo"]);
  });
});

describe("document type colours", () => {
  it.each(["matter", "contract", "entity"])(
    "saves and resets a colour in the %s list",
    async (module) => {
      const row = await createType(module, "Colour test");
      expect(row.color).toBeNull();
      const url = `/api/v1/documents/types/${module}/${row.id}`;
      const changed = await harness.app.inject({
        method: "PATCH",
        url,
        cookies: adminCookies,
        payload: { color: "purple" },
      });
      expect(changed.statusCode, changed.body).toBe(200);
      expect(changed.json().documentType.color).toBe("purple");
      expect((await listTypes(module)).find((type) => type.id === row.id)?.color).toBe("purple");
      const options = await harness.app.inject({
        method: "GET",
        url: `/api/v1/documents/type-options?module=${module}`,
        cookies: memberCookies,
      });
      expect(options.json().documentTypes.find((type: TypeRow) => type.id === row.id).color).toBe(
        "purple",
      );
      const reset = await harness.app.inject({
        method: "PATCH",
        url,
        cookies: adminCookies,
        payload: { color: null },
      });
      expect(reset.statusCode, reset.body).toBe(200);
      expect(reset.json().documentType.color).toBeNull();
    },
  );

  it("allows colours on fixed types while retaining their names and kinds", async () => {
    const fixed = (await listTypes("contract")).find((row) => row.systemKind === "executed")!;
    const url = `/api/v1/documents/types/contract/${fixed.id}`;
    const changed = await harness.app.inject({
      method: "PATCH",
      url,
      cookies: adminCookies,
      payload: { color: "blue" },
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json().documentType).toMatchObject({
      displayName: "Executed",
      systemKind: "executed",
      color: "blue",
    });
    const refused = await harness.app.inject({
      method: "PATCH",
      url,
      cookies: adminCookies,
      payload: { color: "red", displayName: "Renamed" },
    });
    expect(refused.statusCode).toBe(409);
    expect((await listTypes("contract")).find((row) => row.id === fixed.id)?.color).toBe("blue");
    const entries = await harness.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, "document_type.updated"));
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: { slug: fixed.slug, changed: { color: { from: null, to: "blue" } } },
        }),
      ]),
    );
  });

  it("rejects invalid colours, edits by non-admins, and cross-module writes", async () => {
    const row = (await listTypes("contract"))[0]!;
    const url = `/api/v1/documents/types/contract/${row.id}`;
    for (const color of ["not-a-colour", "#ff0000", 123]) {
      const res = await harness.app.inject({
        method: "PATCH",
        url,
        cookies: adminCookies,
        payload: { color },
      });
      expect(res.statusCode, res.body).toBe(400);
    }
    const forbidden = await harness.app.inject({
      method: "PATCH",
      url,
      cookies: memberCookies,
      payload: { color: "red" },
    });
    expect(forbidden.statusCode).toBe(403);
    const crossed = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/documents/types/matter/${row.id}`,
      cookies: adminCookies,
      payload: { color: "red" },
    });
    expect(crossed.statusCode).toBe(404);
  });

  it("updates existing document versions and the repository without changing their kind", async () => {
    const row = await createType("contract", "Coloured attachment");
    const contract = await newContract("Coloured paper");
    const uploadUrl = `/api/v1/contracts/${contract.number}/documents`;
    const uploaded = await upload(uploadUrl, { documentTypeId: row.id });
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const document = uploaded.json().document;
    const changed = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/documents/types/contract/${row.id}`,
      cookies: adminCookies,
      payload: { color: "orange" },
    });
    expect(changed.statusCode).toBe(200);
    const list = await harness.app.inject({
      method: "GET",
      url: uploadUrl,
      cookies: memberCookies,
    });
    expect(
      list.json().documents.find((item: { id: string }) => item.id === document.id).versions[0],
    ).toMatchObject({ kind: "general", documentType: { id: row.id, color: "orange" } });
    const repository = await harness.app.inject({
      method: "GET",
      url: "/api/v1/documents",
      cookies: memberCookies,
    });
    expect(repository.statusCode, repository.body).toBe(200);
    expect(
      repository.json().documents.find((item: { id: string }) => item.id === document.id)
        .currentVersion,
    ).toMatchObject({
      documentType: row.displayName,
      documentTypeColor: "orange",
      kind: "general",
    });
  });
});

describe("a Version's type", () => {
  it("uploads with a type, maps its kind, and corrects it", async () => {
    const sideLetter = await createType("contract", "Side letter");
    const contract = await newContract("Typed paper");
    const url = `/api/v1/contracts/${contract.number}/documents`;

    const typed = await upload(url, { documentTypeId: sideLetter.id });
    expect(typed.statusCode, typed.body).toBe(201);
    const version = currentOf(typed.json().document);
    expect(version.documentType?.displayName).toBe("Side letter");
    expect(version.kind).toBe("general");

    // A client that still speaks kinds lands on the fixed row.
    const byKind = await upload(url, { kind: "redline_theirs" });
    expect(currentOf(byKind.json().document).documentType?.displayName).toBe("Redline · theirs");

    // Blank is no type.
    const blank = await upload(url);
    expect(currentOf(blank.json().document).documentType).toBeNull();

    const [executed] = (await listTypes("contract")).filter((row) => row.slug === "executed");
    const documentId = typed.json().document.id as string;
    const corrected = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/documents/${documentId}/versions/${version.id}`,
      cookies: memberCookies,
      payload: { documentTypeId: executed!.id },
    });
    expect(corrected.statusCode, corrected.body).toBe(200);
    const [row] = await harness.db
      .select({ kind: documentVersions.kind, typeId: documentVersions.documentTypeId })
      .from(documentVersions)
      .where(eq(documentVersions.id, version.id));
    expect(row).toEqual({ kind: "executed", typeId: executed!.id });

    const cleared = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/documents/${documentId}/versions/${version.id}`,
      cookies: memberCookies,
      payload: { documentTypeId: null },
    });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(currentOf(cleared.json().document).documentType).toBeNull();
    expect(currentOf(cleared.json().document).kind).toBe("general");
  });

  it("refuses a type from another module's list or an archived one", async () => {
    const [draft] = await listTypes("contract");
    const matter = await newMatter("Typed matter");
    const url = `/api/v1/matters/${matter.number}/documents`;

    const borrowed = await upload(url, { documentTypeId: draft!.id });
    expect(borrowed.statusCode, borrowed.body).toBe(400);

    const letter = await createType("matter", "Letter");
    const typed = await upload(url, { documentTypeId: letter.id });
    expect(typed.statusCode, typed.body).toBe(201);
    expect(currentOf(typed.json().document).documentType?.displayName).toBe("Letter");

    await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/documents/types/matter/${letter.id}`,
      cookies: adminCookies,
      payload: { color: "green" },
    });
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/documents/types/matter/${letter.id}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(archived.statusCode, archived.body).toBe(200);
    expect(archived.json().documentType.inUseCount).toBe(1);

    // The archived type still labels its Version, and leaves the picker.
    const refused = await upload(url, { documentTypeId: letter.id });
    expect(refused.statusCode, refused.body).toBe(400);
    const list = await harness.app.inject({
      method: "GET",
      url: `/api/v1/matters/${matter.number}/documents`,
      cookies: memberCookies,
    });
    const [kept] = list.json().documents as { versions: VersionRow[] }[];
    expect(currentOf(kept!).documentType).toMatchObject({
      displayName: "Letter",
      archived: true,
      color: "green",
    });

    // A Matter upload that names a negotiation kind stays neutral.
    const byKind = await upload(url, { kind: "executed" });
    expect(currentOf(byKind.json().document)).toMatchObject({
      kind: "general",
      documentType: null,
    });
  });

  it("labels a Knowledge Item's files with the item's Knowledge type", async () => {
    const options = await harness.app.inject({
      method: "GET",
      url: "/api/v1/knowledge/type-options",
      cookies: memberCookies,
    });
    const knowledgeTypes = options.json().knowledgeTypes as { id: string; displayName: string }[];
    const [template, precedent] = knowledgeTypes;
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/knowledge",
      cookies: memberCookies,
      payload: { title: "Typed know-how", knowledgeTypeId: template!.id },
    });
    expect(created.statusCode, created.body).toBe(201);
    const itemId = created.json().knowledgeItem.id as string;
    const url = `/api/v1/knowledge/${itemId}/documents`;

    // The type is the item's, so a Document type is not the uploader's
    // to pick here.
    const [draft] = await listTypes("contract");
    const refused = await upload(url, { documentTypeId: draft!.id });
    expect(refused.statusCode, refused.body).toBe(400);

    const typed = await upload(url);
    expect(typed.statusCode, typed.body).toBe(201);
    expect(currentOf(typed.json().document)).toMatchObject({
      kind: "general",
      documentType: { id: template!.id, displayName: template!.displayName },
    });

    const retyped = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/knowledge/${itemId}`,
      cookies: memberCookies,
      payload: { knowledgeTypeId: precedent!.id },
    });
    expect(retyped.statusCode, retyped.body).toBe(200);
    const list = await harness.app.inject({ method: "GET", url, cookies: memberCookies });
    const [row] = list.json().documents as { versions: VersionRow[] }[];
    expect(currentOf(row!).documentType?.displayName).toBe(precedent!.displayName);
  });
});
