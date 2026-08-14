// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A contract's paper (M11/2, M11/3) at the HTTP seam: upload a draft,
 * append the rounds that follow, read the chain, and get any round's
 * bytes back.
 *
 * The whole path is exercised through injected requests against real
 * Postgres and the committed migrations, with the production local
 * filesystem driver over a throwaway root — nothing here is a mock, and
 * the round trip is the assertion that the blob really went through the
 * adapter: the file that comes back is byte-for-byte the file that went
 * in, and its SHA-256 is the one the row recorded.
 *
 * The chain is the second subject. Numbers run 1..n with the highest one
 * current; four appends fired at once still produce consecutive numbers,
 * because the number is assigned under the owning contract's row lock;
 * every version stays downloadable, superseded ones included; and no
 * route edits or deletes one, which is asserted against the route table
 * rather than trusted.
 *
 * Access is the third subject, and it is written the M10 way. A viewer
 * who cannot reach the owning contract must get, for the list, the
 * download, the upload, the append, and the metadata edit alike, exactly
 * the answer a contract that was never created gives. Each refusal is
 * therefore asserted twice — once at a walled record and once at an
 * address nothing was ever made under — and the two answers must be one
 * answer.
 *
 * The two CTR-014 designations are the fourth subject. Exactly one
 * document on a contract is the instrument, the first upload takes the
 * designation, and it moves from there — so the assertions count the
 * marked documents rather than looking one up. The executed pin is
 * explicit: an upload tagged `executed` pins nothing, a version of
 * another document is refused at write time (DOC-001), and clearing the
 * pin leaves the chain byte for byte as it was.
 *
 * The fifth subject is the ceiling (story 24). An oversized upload is
 * refused with a problem response that names the limit, and nothing is
 * left on the record. It runs against a second app over the same
 * database with a small ceiling, because the refusal is worth testing
 * with a handful of bytes rather than with a hundred megabytes of them.
 */

import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { documents, documentVersions, eq, sql, users } from "@openlaw/db";
import { buildApp } from "../../app.js";
import { provisionUser } from "../../auth/instance.js";
import {
  CapturingMailer,
  fixedMailerResolver,
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  TEST_AUTH_CONFIG,
  type TestHarness,
} from "../../testing/harness.js";

/** A Legal Team Member on the contract's team: the included viewer a
 * walled-off record is compared against. */
const MEMBER = {
  email: "docs-member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;
/** A Legal Team Member with no team row: they read every open contract,
 * and nothing of a confidential one (DD-014). */
const OUTSIDER = {
  email: "docs-outsider@example.com",
  displayName: "Otto Outsider",
  password: "correct-horse-battery",
} as const;
/** A Contributor on the team: reads and downloads (DD-015, CTR-021),
 * and does not upload until M23. */
const CONTRIBUTOR = {
  email: "docs-contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery",
} as const;
/** A Contributor on no team: as invisible as the record is to them. */
const STRANGER = {
  email: "docs-stranger@example.com",
  displayName: "Sam Stranger",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let outsiderCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let strangerCookies: Record<string, string>;
const userIds = new Map<string, string>();

const idOf = (fixture: { email: string }): string => {
  const id = userIds.get(fixture.email);
  expect(id, fixture.email).toBeDefined();
  return id!;
};

interface ContractRow {
  id: string;
  number: number;
}

interface VersionRow {
  id: string;
  versionNumber: number;
  kind: string;
  note: string | null;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  checksumSha256: string;
  uploadedBy: { id: string; displayName: string; archived: boolean };
  createdAt: string;
  isCurrent: boolean;
  isExecuted: boolean;
}

interface DocumentRow {
  id: string;
  title: string;
  description: string | null;
  isPrimary: boolean;
  versions: VersionRow[];
  archivedAt: string | null;
  createdBy: { id: string; displayName: string };
  createdAt: string;
  updatedAt: string;
}

/** The version the chain pins, as every assertion about "which file
 * matters now" reads it. Required rather than found-if-present: a
 * document with no current version is a broken record, not a state a
 * test should tolerate quietly. */
function currentOf(document: DocumentRow): VersionRow {
  const current = document.versions.filter((version) => version.isCurrent);
  expect(current.length, "exactly one current version").toBe(1);
  return current[0]!;
}

/** A number nothing was ever created under — the control every refusal
 * is compared against. */
const NEVER_CREATED = 999_999;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  const [admin] = await harness.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, ADMIN.email));
  userIds.set(ADMIN.email, admin!.id);

  for (const [fixture, role] of [
    [MEMBER, "legal_team_member"],
    [OUTSIDER, "legal_team_member"],
    [CONTRIBUTOR, "contributor"],
    [STRANGER, "contributor"],
  ] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, user.id));
    userIds.set(fixture.email, user.id);
  }
  adminCookies = await signInCookies(harness.app, ADMIN.email, ADMIN.password);
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
  outsiderCookies = await signInCookies(harness.app, OUTSIDER.email, OUTSIDER.password);
  contributorCookies = await signInCookies(harness.app, CONTRIBUTOR.email, CONTRIBUTOR.password);
  strangerCookies = await signInCookies(harness.app, STRANGER.email, STRANGER.password);
}, 120_000);

afterAll(async () => {
  await harness.stop();
});

/** The `nda` seed type, which every contract here is created as. */
async function ndaTypeId(): Promise<string> {
  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: adminCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  const nda = (res.json().contractTypes as { id: string; slug: string }[]).find(
    (row) => row.slug === "nda",
  );
  expect(nda, "the nda seed type").toBeDefined();
  return nda!.id;
}

/** A contract, made by the Administrator, requiring success. */
async function newContract(title: string): Promise<ContractRow> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: adminCookies,
    payload: { title, contractTypeId: await ndaTypeId() },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().contract as ContractRow;
}

/** Puts somebody on a contract's team, requiring success. */
async function putOnTeam(number: number, userId: string, role: string): Promise<void> {
  const res = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/team`,
    cookies: adminCookies,
    payload: { userId, role },
  });
  expect(res.statusCode, res.body).toBe(201);
}

/** Walls a contract off (DD-014), through the route that does it. */
async function markConfidential(number: number): Promise<void> {
  const res = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/contracts/${number}`,
    cookies: adminCookies,
    payload: { isConfidential: true },
  });
  expect(res.statusCode, res.body).toBe(200);
}

const BOUNDARY = "openlaw-test-boundary-4d6f636b";

/** One part of a multipart form, in the order it is written. */
type Part =
  | { field: string; value: string }
  | { file: string; filename: string; contentType: string; content: Buffer };

/**
 * A `multipart/form-data` body, built by hand.
 *
 * By hand on purpose: the upload route reads its `kind` and `note`
 * fields out of what the parser has already seen, so the order the
 * parts are written in is part of what these tests are asserting.
 */
function multipartForm(parts: readonly Part[]): {
  payload: Buffer;
  headers: Record<string, string>;
} {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${BOUNDARY}\r\n`));
    if ("field" in part) {
      chunks.push(
        Buffer.from(`content-disposition: form-data; name="${part.field}"\r\n\r\n`),
        Buffer.from(part.value),
        Buffer.from("\r\n"),
      );
    } else {
      chunks.push(
        Buffer.from(
          `content-disposition: form-data; name="${part.file}"; filename="${part.filename}"\r\n` +
            `content-type: ${part.contentType}\r\n\r\n`,
        ),
        part.content,
        Buffer.from("\r\n"),
      );
    }
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

interface UploadOptions {
  filename?: string;
  contentType?: string;
  content?: Buffer;
  kind?: string;
  note?: string;
}

/** The parts of one upload, in the order the seam reads them: the kind
 * and the note first, the file last. */
function uploadParts(options: UploadOptions): {
  payload: Buffer;
  headers: Record<string, string>;
} {
  const parts: Part[] = [];
  if (options.kind !== undefined) parts.push({ field: "kind", value: options.kind });
  if (options.note !== undefined) parts.push({ field: "note", value: options.note });
  parts.push({
    file: "file",
    filename: options.filename ?? "draft.docx",
    contentType:
      options.contentType ??
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    content: options.content ?? Buffer.from("the first draft"),
  });
  return multipartForm(parts);
}

/** The raw upload answer — the refusals are as much the subject as the
 * successes, so nothing here requires a status. */
function upload(
  cookies: Record<string, string>,
  number: number,
  options: UploadOptions = {},
  app = harness.app,
) {
  const { payload, headers } = uploadParts(options);
  return app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/documents`,
    cookies,
    headers,
    payload,
  });
}

/** Uploads, requiring success, and answers the created document. */
async function uploaded(
  cookies: Record<string, string>,
  number: number,
  options: UploadOptions = {},
): Promise<DocumentRow> {
  const res = await upload(cookies, number, options);
  expect(res.statusCode, res.body).toBe(201);
  return res.json().document as DocumentRow;
}

/** The raw answer to appending the next version to a document. */
function addVersion(
  cookies: Record<string, string>,
  documentId: string,
  options: UploadOptions = {},
) {
  const { payload, headers } = uploadParts(options);
  return harness.app.inject({
    method: "POST",
    url: `/api/v1/documents/${documentId}/versions`,
    cookies,
    headers,
    payload,
  });
}

/** Appends a version, requiring success, and answers the document with
 * its whole chain. */
async function versionAdded(
  cookies: Record<string, string>,
  documentId: string,
  options: UploadOptions = {},
): Promise<DocumentRow> {
  const res = await addVersion(cookies, documentId, options);
  expect(res.statusCode, res.body).toBe(201);
  return res.json().document as DocumentRow;
}

/** The raw answer to a metadata edit (DOC-007). */
const patchDocument = (
  cookies: Record<string, string>,
  documentId: string,
  payload: Record<string, unknown>,
) =>
  harness.app.inject({
    method: "PATCH",
    url: `/api/v1/documents/${documentId}`,
    cookies,
    payload,
  });

/** The raw answer to naming a document the contract's instrument
 * (CTR-014). */
const makePrimary = (cookies: Record<string, string>, documentId: string) =>
  harness.app.inject({
    method: "POST",
    url: `/api/v1/documents/${documentId}/primary`,
    cookies,
  });

/** The raw answer to pinning one version as the signed copy (CTR-014). */
const pinExecuted = (cookies: Record<string, string>, documentId: string, versionId: string) =>
  harness.app.inject({
    method: "POST",
    url: `/api/v1/documents/${documentId}/executed-version`,
    cookies,
    payload: { versionId },
  });

/** The raw answer to taking the executed pin off a document. */
const clearExecuted = (cookies: Record<string, string>, documentId: string) =>
  harness.app.inject({
    method: "DELETE",
    url: `/api/v1/documents/${documentId}/executed-version`,
    cookies,
  });

/** The versions of one document that carry the executed pin. Plural on
 * purpose: "at most one" is the claim, so the assertion counts rather
 * than finds. */
const executedOf = (document: DocumentRow): VersionRow[] =>
  document.versions.filter((version) => version.isExecuted);

/** The raw answer to archiving a document (DOC-010's soft delete). */
const archiveDocument = (cookies: Record<string, string>, documentId: string) =>
  harness.app.inject({ method: "POST", url: `/api/v1/documents/${documentId}/archive`, cookies });

/** The raw answer to restoring an archived document. */
const restoreDocument = (cookies: Record<string, string>, documentId: string) =>
  harness.app.inject({ method: "POST", url: `/api/v1/documents/${documentId}/restore`, cookies });

/** The raw answer to the Administrator's hard delete, with whatever was
 * typed into the confirmation. */
const hardDelete = (cookies: Record<string, string>, documentId: string, confirmTitle: string) =>
  harness.app.inject({
    method: "DELETE",
    url: `/api/v1/documents/${documentId}`,
    cookies,
    payload: { confirmTitle },
  });

/** Archives a document, requiring success. */
async function archived(cookies: Record<string, string>, documentId: string): Promise<DocumentRow> {
  const res = await archiveDocument(cookies, documentId);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().document as DocumentRow;
}

/** Every stored reference under one document, read from the table. The
 * blobs are what an erasure has to remove, and no response ever names
 * them — so the only place to take them from is the rows, before they
 * are gone. */
const fileRefsOf = (documentId: string): Promise<string[]> =>
  harness.db
    .select({ fileRef: documentVersions.fileRef })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))
    .then((rows) => rows.map((row) => row.fileRef));

/** Whether a stored blob is still readable. The adapter answers
 * not-found for a reference it never wrote (DOC-012), which is the same
 * answer it gives for one that has been erased. */
async function blobExists(fileRef: string): Promise<boolean> {
  try {
    const body = await harness.storage.get(fileRef);
    body.destroy();
    return true;
  } catch {
    return false;
  }
}

const listDocuments = (cookies: Record<string, string>, number: number, includeArchived = false) =>
  harness.app.inject({
    method: "GET",
    url: `/api/v1/contracts/${number}/documents${includeArchived ? "?includeArchived=true" : ""}`,
    cookies,
  });

/** The record's paper as the section draws it, requiring success. */
async function paper(
  cookies: Record<string, string>,
  number: number,
  includeArchived = false,
): Promise<DocumentRow[]> {
  const res = await listDocuments(cookies, number, includeArchived);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().documents as DocumentRow[];
}

const download = (cookies: Record<string, string>, documentId: string, versionId: string) =>
  harness.app.inject({
    method: "GET",
    url: `/api/v1/documents/${documentId}/versions/${versionId}/download`,
    cookies,
  });

/** One record's feed, as the activity bar reads it. */
async function feed(
  cookies: Record<string, string>,
  contractId: string,
): Promise<{ action: string; payload: Record<string, unknown> }[]> {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/activity?entityType=contract&entityId=${contractId}`,
    cookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().entries;
}

const sha256 = (content: Buffer) => createHash("sha256").update(content).digest("hex");

/** `instance` is the URL the client itself asked for, so it is the one
 * field two refusals at two addresses cannot share. Everything else in
 * the problem body must be identical. */
const withoutInstance = (body: Record<string, unknown>) => ({ ...body, instance: undefined });

describe("uploading a draft", () => {
  it("creates a document with version 1 and records what arrived", async () => {
    const contract = await newContract("Orion Cloud — MSA");
    const content = Buffer.from("the first draft of the master services agreement");

    const document = await uploaded(adminCookies, contract.number, {
      filename: "Orion_MSA_2026_draft.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      content,
    });

    expect(document.title).toBe("Orion_MSA_2026_draft.docx");
    expect(document.createdBy.id).toBe(idOf(ADMIN));
    expect(currentOf(document).versionNumber).toBe(1);
    expect(currentOf(document).originalFilename).toBe("Orion_MSA_2026_draft.docx");
    expect(currentOf(document).mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(currentOf(document).byteSize).toBe(content.byteLength);
    expect(currentOf(document).checksumSha256).toBe(sha256(content));
    expect(currentOf(document).uploadedBy.id).toBe(idOf(ADMIN));
    // The default kind, and no note: the M11/2 control sends neither.
    expect(currentOf(document).kind).toBe("draft_ours");
    expect(currentOf(document).note).toBeNull();
  });

  it("takes the kind and the note when the form sends them before the file", async () => {
    const contract = await newContract("Orion Cloud — kinds");

    const document = await uploaded(adminCookies, contract.number, {
      kind: "redline_theirs",
      note: "Their first pass. Clause 8 is the fight.",
    });

    expect(currentOf(document).kind).toBe("redline_theirs");
    expect(currentOf(document).note).toBe("Their first pass. Clause 8 is the fight.");
  });

  it("refuses a kind that is not one of the five", async () => {
    const contract = await newContract("Orion Cloud — bad kind");

    const res = await upload(adminCookies, contract.number, { kind: "generated_redline" });

    expect(res.statusCode, res.body).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
  });

  it("refuses a note longer than the field holds, rather than shortening it", async () => {
    const contract = await newContract("Orion Cloud — a long note");

    const res = await upload(adminCookies, contract.number, { note: "x".repeat(2001) });

    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().detail).toContain("2000");
    // Nothing landed: a refusal is the whole outcome, so nobody has to
    // wonder whether their words were kept in part.
    const list = await listDocuments(adminCookies, contract.number);
    expect(list.json().documents).toEqual([]);
  });

  it("refuses a filename longer than the field holds", async () => {
    const contract = await newContract("Orion Cloud — a long name");

    // Long enough to be refused, and with the extension at the end that
    // shortening would have thrown away.
    const res = await upload(adminCookies, contract.number, {
      filename: `${"n".repeat(260)}.docx`,
    });

    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().detail).toContain("255");
  });

  it("refuses a request that carries no file", async () => {
    const contract = await newContract("Orion Cloud — no file");
    const { payload, headers } = multipartForm([{ field: "kind", value: "draft_ours" }]);

    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/documents`,
      cookies: adminCookies,
      headers,
      payload,
    });

    expect(res.statusCode, res.body).toBe(400);
  });

  it("accepts any file type (DOC-004), not only the ones M12 will render", async () => {
    const contract = await newContract("Orion Cloud — every type");

    for (const [filename, contentType] of [
      [
        "board_pack.pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ],
      ["schedules.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
      ["signature_thread.eml", "message/rfc822"],
      ["bundle.zip", "application/zip"],
      ["notes.txt", "text/plain"],
      ["unknown.bin", "application/octet-stream"],
    ] as const) {
      const document = await uploaded(adminCookies, contract.number, {
        filename,
        contentType,
        content: Buffer.from(`bytes of ${filename}`),
      });
      expect(currentOf(document).originalFilename).toBe(filename);
      // Recorded as declared, whatever it is: the type is a rendering
      // hint for M12 and never a gate on what may be stored.
      expect(currentOf(document).mimeType).toBe(contentType);
    }

    const res = await listDocuments(adminCookies, contract.number);
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json().documents as DocumentRow[]).length).toBe(6);
  });

  it("appends document.created on the owning contract", async () => {
    const contract = await newContract("Orion Cloud — the feed");

    const document = await uploaded(adminCookies, contract.number, { filename: "draft_v1.pdf" });

    const entries = await feed(adminCookies, contract.id);
    const entry = entries.find((row) => row.action === "document.created");
    expect(entry, "a document.created entry on the contract").toBeDefined();
    expect(entry!.payload.documentId).toBe(document.id);
    expect(entry!.payload.versionId).toBe(currentOf(document).id);
    // The title survives the rows, because hard deletion (DOC-010)
    // will not.
    expect(entry!.payload.title).toBe("draft_v1.pdf");
  });
});

describe("appending the next version", () => {
  it("numbers the next version and leaves the chain before it untouched", async () => {
    const contract = await newContract("Orion Cloud — round two");
    const first = Buffer.from("our first draft");
    const second = Buffer.from("their redline of our first draft");
    const document = await uploaded(adminCookies, contract.number, {
      filename: "Orion_MSA_draft.docx",
      content: first,
    });
    const v1 = currentOf(document);

    const updated = await versionAdded(adminCookies, document.id, {
      filename: "Orion_MSA_redline.docx",
      content: second,
      kind: "redline_theirs",
    });

    expect(updated.versions.map((version) => version.versionNumber)).toEqual([1, 2]);
    const v2 = currentOf(updated);
    expect(v2.versionNumber).toBe(2);
    expect(v2.kind).toBe("redline_theirs");
    expect(v2.byteSize).toBe(second.byteLength);
    expect(v2.checksumSha256).toBe(sha256(second));
    // The row that was current a moment ago is the same row it was:
    // versions are immutable (DOC-001), so nothing about version 1 moved
    // except that it is no longer the one that matters now.
    const stillV1 = updated.versions[0]!;
    expect(stillV1.id).toBe(v1.id);
    expect(stillV1.kind).toBe(v1.kind);
    expect(stillV1.originalFilename).toBe("Orion_MSA_draft.docx");
    expect(stillV1.checksumSha256).toBe(sha256(first));
    expect(stillV1.isCurrent).toBe(false);
    // The record's own name does not follow the newest file: the
    // document is renamed deliberately or not at all.
    expect(updated.title).toBe("Orion_MSA_draft.docx");
  });

  it("runs the chain 1..n with the highest number current", async () => {
    const contract = await newContract("Orion Cloud — five rounds");
    const document = await uploaded(adminCookies, contract.number, { filename: "v1.docx" });
    for (const kind of ["redline_theirs", "redline_ours", "amendment", "executed"] as const) {
      await versionAdded(adminCookies, document.id, { kind });
    }

    const res = await listDocuments(adminCookies, contract.number);

    expect(res.statusCode, res.body).toBe(200);
    const [row] = res.json().documents as DocumentRow[];
    expect(row!.versions.map((version) => version.versionNumber)).toEqual([1, 2, 3, 4, 5]);
    // The five CTR-014 kinds, each on the round it belongs to.
    expect(row!.versions.map((version) => version.kind)).toEqual([
      "draft_ours",
      "redline_theirs",
      "redline_ours",
      "amendment",
      "executed",
    ]);
    expect(currentOf(row!).versionNumber).toBe(5);
    expect(row!.versions.filter((version) => version.isCurrent).length).toBe(1);
  });

  it("takes a note on the round, and keeps it beside the file", async () => {
    const contract = await newContract("Orion Cloud — what changed");
    const document = await uploaded(adminCookies, contract.number);

    const updated = await versionAdded(adminCookies, document.id, {
      kind: "redline_ours",
      note: "Accepted their cap, held the indemnity. Clause 8 still open.",
    });

    expect(currentOf(updated).note).toBe(
      "Accepted their cap, held the indemnity. Clause 8 still open.",
    );
    // And it survives the read, not only the write.
    const res = await listDocuments(adminCookies, contract.number);
    const [row] = res.json().documents as DocumentRow[];
    expect(currentOf(row!).note).toBe(
      "Accepted their cap, held the indemnity. Clause 8 still open.",
    );
  });

  it("refuses a kind that is not one of the five", async () => {
    const contract = await newContract("Orion Cloud — round two, bad kind");
    const document = await uploaded(adminCookies, contract.number);

    const res = await addVersion(adminCookies, document.id, { kind: "generated_redline" });

    expect(res.statusCode, res.body).toBe(400);
    // And the chain is as it was.
    const list = await listDocuments(adminCookies, contract.number);
    const [row] = list.json().documents as DocumentRow[];
    expect(row!.versions.length).toBe(1);
  });

  it("gives concurrent uploads consecutive numbers, with no collision and no gap", async () => {
    const contract = await newContract("Orion Cloud — two at once");
    const document = await uploaded(adminCookies, contract.number, { filename: "v1.docx" });

    // Four appends in flight at the same moment. The number is assigned
    // under the owning contract's row lock, so they serialize there:
    // every one lands, and no two land on the same number.
    const answers = await Promise.all(
      [1, 2, 3, 4].map((round) =>
        addVersion(adminCookies, document.id, {
          filename: `round_${round}.docx`,
          content: Buffer.from(`round ${round}`),
        }),
      ),
    );

    for (const res of answers) expect(res.statusCode, res.body).toBe(201);
    const list = await listDocuments(adminCookies, contract.number);
    const [row] = list.json().documents as DocumentRow[];
    expect(row!.versions.map((version) => version.versionNumber)).toEqual([1, 2, 3, 4, 5]);
    // Five files, five different blobs: nobody overwrote anybody.
    const contents = new Set(row!.versions.map((version) => version.checksumSha256));
    expect(contents.size).toBe(5);
  });

  it("keeps every version downloadable, superseded ones included", async () => {
    const contract = await newContract("Orion Cloud — the whole history");
    const rounds = [
      Buffer.from("what we sent them"),
      Buffer.from("what they sent back"),
      Buffer.from("what we signed"),
    ];
    const document = await uploaded(adminCookies, contract.number, {
      filename: "round_1.docx",
      content: rounds[0],
    });
    await versionAdded(adminCookies, document.id, {
      filename: "round_2.docx",
      content: rounds[1],
      kind: "redline_theirs",
    });
    const final = await versionAdded(adminCookies, document.id, {
      filename: "round_3.pdf",
      content: rounds[2],
      kind: "executed",
    });

    // Every round comes back as itself, which is what "reconstruct what
    // was on the table" means.
    for (const [index, version] of final.versions.entries()) {
      const res = await download(adminCookies, document.id, version.id);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.rawPayload.equals(rounds[index]!)).toBe(true);
      expect(res.headers["content-disposition"]).toContain(
        `filename="${version.originalFilename}"`,
      );
    }
  });

  it("gives each document on a contract its own chain", async () => {
    const contract = await newContract("Orion Cloud — the main paper and the schedules");
    const instrument = await uploaded(adminCookies, contract.number, { filename: "msa.docx" });
    // A loose attachment beside it (CTR-014): supporting papers do not
    // pollute the negotiation.
    const certificate = await uploaded(adminCookies, contract.number, {
      filename: "insurance_cert.pdf",
    });
    await versionAdded(adminCookies, instrument.id, { kind: "redline_theirs" });
    await versionAdded(adminCookies, instrument.id, { kind: "redline_ours" });

    const res = await listDocuments(adminCookies, contract.number);

    const rows = res.json().documents as DocumentRow[];
    const chains = new Map(rows.map((row) => [row.id, row.versions.length]));
    expect(chains.get(instrument.id)).toBe(3);
    expect(chains.get(certificate.id)).toBe(1);
  });

  it("appends document.version_added on the owning contract", async () => {
    const contract = await newContract("Orion Cloud — the feed, round two");
    const document = await uploaded(adminCookies, contract.number, { filename: "draft_v1.pdf" });

    const updated = await versionAdded(adminCookies, document.id, { kind: "redline_theirs" });

    const entries = await feed(adminCookies, contract.id);
    const entry = entries.find((row) => row.action === "document.version_added");
    expect(entry, "a document.version_added entry on the contract").toBeDefined();
    expect(entry!.payload.documentId).toBe(document.id);
    expect(entry!.payload.versionId).toBe(currentOf(updated).id);
    expect(entry!.payload.versionNumber).toBe(2);
    expect(entry!.payload.kind).toBe("redline_theirs");
    // Its own verb, not a second document.created: putting the first
    // file on a record and adding a round to it are different events.
    expect(entries.filter((row) => row.action === "document.created").length).toBe(1);
  });

  it("refuses an append onto an archived contract", async () => {
    const contract = await newContract("Orion Cloud — frozen, round two");
    const document = await uploaded(adminCookies, contract.number);
    const archive = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/archive`,
      cookies: adminCookies,
    });
    expect(archive.statusCode, archive.body).toBe(200);

    const res = await addVersion(adminCookies, document.id);

    expect(res.statusCode, res.body).toBe(409);
  });

  it("answers 404 for a document that does not exist", async () => {
    const res = await addVersion(adminCookies, "01920000-0000-7000-8000-000000000000");

    expect(res.statusCode, res.body).toBe(404);
  });
});

/**
 * Immutability, asserted rather than intended (DOC-001).
 *
 * The claim is about what the API does *not* offer, so the assertion is
 * about the route table itself. Injecting the verbs proves what happens
 * when somebody tries them; asking the route table proves that no such
 * route was declared at all, which is the sentence the decision makes —
 * and it fails the day somebody adds one, which is the point.
 */
describe("a version is never edited and never deleted", () => {
  const VERSION_URL = "/api/v1/documents/:documentId/versions/:versionId";

  it("declares no route that edits or deletes one version", () => {
    for (const method of ["PATCH", "PUT", "DELETE"] as const) {
      expect(harness.app.hasRoute({ method, url: VERSION_URL }), `${method} ${VERSION_URL}`).toBe(
        false,
      );
      // The document's own address is where metadata is edited, and
      // that is a different row: no verb there reaches a version.
      expect(
        harness.app.hasRoute({ method, url: `${VERSION_URL}/download` }),
        `${method} ${VERSION_URL}/download`,
      ).toBe(false);
    }
    // DELETE at the document's own address is DOC-010's hard delete, and
    // it is whole-document by design: the erasure exists, and there is
    // still no way to cut one round out of a chain.
    expect(harness.app.hasRoute({ method: "DELETE", url: "/api/v1/documents/:documentId" })).toBe(
      true,
    );
  });

  it("answers a request that tries anyway as a route that is not there", async () => {
    const contract = await newContract("Orion Cloud — nothing to edit");
    const document = await uploaded(adminCookies, contract.number);
    const version = currentOf(document);

    for (const method of ["PATCH", "PUT", "DELETE"] as const) {
      const res = await harness.app.inject({
        method,
        url: `/api/v1/documents/${document.id}/versions/${version.id}`,
        cookies: adminCookies,
        payload: method === "DELETE" ? undefined : { kind: "executed", note: "changed my mind" },
      });
      expect(res.statusCode, `${method}: ${res.body}`).toBe(404);
    }

    // And the version is as it was.
    const list = await listDocuments(adminCookies, contract.number);
    const [row] = list.json().documents as DocumentRow[];
    expect(currentOf(row!).id).toBe(version.id);
    expect(currentOf(row!).kind).toBe("draft_ours");
    expect(currentOf(row!).note).toBeNull();
  });
});

describe("a document's own metadata", () => {
  it("renames a document and leaves the stored files alone", async () => {
    const contract = await newContract("Orion Cloud — the rename");
    const content = Buffer.from("the bytes nobody touched");
    const document = await uploaded(adminCookies, contract.number, {
      filename: "Orion_MSA_2026_draft_FINAL_v3.docx",
      content,
    });

    const res = await patchDocument(adminCookies, document.id, {
      title: "Orion Cloud — master services agreement",
    });

    expect(res.statusCode, res.body).toBe(200);
    const renamed = res.json().document as DocumentRow;
    expect(renamed.title).toBe("Orion Cloud — master services agreement");
    // The version's own filename is what it arrived as, and a download
    // still offers it back under that name with those bytes.
    const version = currentOf(renamed);
    expect(version.originalFilename).toBe("Orion_MSA_2026_draft_FINAL_v3.docx");
    expect(version.checksumSha256).toBe(sha256(content));
    const file = await download(adminCookies, document.id, version.id);
    expect(file.rawPayload.equals(content)).toBe(true);
    expect(file.headers["content-disposition"]).toContain(
      'filename="Orion_MSA_2026_draft_FINAL_v3.docx"',
    );
  });

  it("edits the description and clears it again", async () => {
    const contract = await newContract("Orion Cloud — the description");
    const document = await uploaded(adminCookies, contract.number);
    expect(document.description).toBeNull();

    const set = await patchDocument(adminCookies, document.id, {
      description: "Signed copy lives with the schedules; clause 8 was the fight.",
    });
    expect(set.statusCode, set.body).toBe(200);
    expect((set.json().document as DocumentRow).description).toBe(
      "Signed copy lives with the schedules; clause 8 was the fight.",
    );

    const cleared = await patchDocument(adminCookies, document.id, { description: null });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect((cleared.json().document as DocumentRow).description).toBeNull();
  });

  it("refuses a title that says nothing", async () => {
    const contract = await newContract("Orion Cloud — the empty name");
    const document = await uploaded(adminCookies, contract.number, { filename: "named.docx" });

    const res = await patchDocument(adminCookies, document.id, { title: "   " });

    expect(res.statusCode, res.body).toBe(400);
    const list = await listDocuments(adminCookies, contract.number);
    const [row] = list.json().documents as DocumentRow[];
    expect(row!.title).toBe("named.docx");
  });

  it("appends document.updated naming what changed", async () => {
    const contract = await newContract("Orion Cloud — the feed, renamed");
    const document = await uploaded(adminCookies, contract.number, { filename: "draft.docx" });

    await patchDocument(adminCookies, document.id, {
      title: "Master services agreement",
      description: "The main instrument.",
    });

    const entries = await feed(adminCookies, contract.id);
    const entry = entries.find((row) => row.action === "document.updated");
    expect(entry, "a document.updated entry on the contract").toBeDefined();
    expect(entry!.payload.documentId).toBe(document.id);
    expect(entry!.payload.title).toBe("Master services agreement");
    expect(entry!.payload.changed).toEqual({
      title: { from: "draft.docx", to: "Master services agreement" },
      description: { from: null, to: "The main instrument." },
    });
  });

  it("writes no entry for an edit that changes nothing", async () => {
    const contract = await newContract("Orion Cloud — the no-op");
    const document = await uploaded(adminCookies, contract.number, { filename: "draft.docx" });

    const res = await patchDocument(adminCookies, document.id, { title: "draft.docx" });

    expect(res.statusCode, res.body).toBe(200);
    const entries = await feed(adminCookies, contract.id);
    expect(entries.filter((row) => row.action === "document.updated")).toEqual([]);
  });

  it("refuses an edit on an archived contract", async () => {
    const contract = await newContract("Orion Cloud — frozen, renamed");
    const document = await uploaded(adminCookies, contract.number);
    const archive = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/archive`,
      cookies: adminCookies,
    });
    expect(archive.statusCode, archive.body).toBe(200);

    const res = await patchDocument(adminCookies, document.id, { title: "Renamed while frozen" });

    expect(res.statusCode, res.body).toBe(409);
  });
});

/**
 * The one assertion in this suite that reads the database catalogue
 * rather than the HTTP seam, deliberately.
 *
 * "Version rows carry no update timestamp" is a fact about the table,
 * not about a response. An HTTP assertion could only say the projection
 * leaves the field out, which it would do whether the column existed or
 * not — so it would pass on exactly the shape it is meant to refuse. The
 * catalogue is the only place the claim is true or false. Prior art for
 * reading the database in a suite: the settings audit rows.
 */
describe("the version chain's shape", () => {
  it("gives a version row no update timestamp, because it is never updated", async () => {
    const [row] = await harness.db
      .execute<{ column_name: string }>(
        sql`select column_name from information_schema.columns
          where table_name = 'document_versions' and column_name = 'updated_at'`,
      )
      .then((result) => result.rows);

    expect(row, "document_versions.updated_at").toBeUndefined();
  });
});

describe("listing a contract's documents", () => {
  it("returns them newest first, each with the version that is current", async () => {
    const contract = await newContract("Orion Cloud — the list");
    const first = await uploaded(adminCookies, contract.number, { filename: "one.pdf" });
    const second = await uploaded(adminCookies, contract.number, { filename: "two.pdf" });

    const res = await listDocuments(adminCookies, contract.number);

    expect(res.statusCode, res.body).toBe(200);
    const rows = res.json().documents as DocumentRow[];
    expect(rows.map((row) => row.id)).toEqual([second.id, first.id]);
    expect(rows.every((row) => currentOf(row).versionNumber === 1)).toBe(true);
  });

  it("answers an empty list for a contract with no paper on it", async () => {
    const contract = await newContract("Orion Cloud — no paper");

    const res = await listDocuments(adminCookies, contract.number);

    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().documents).toEqual([]);
  });

  it("keeps each contract's documents to itself", async () => {
    const mine = await newContract("Orion Cloud — mine");
    const theirs = await newContract("Orion Cloud — theirs");
    await uploaded(adminCookies, mine.number, { filename: "mine.pdf" });

    const res = await listDocuments(adminCookies, theirs.number);

    expect(res.json().documents).toEqual([]);
  });
});

describe("downloading a version", () => {
  it("streams the same bytes back as an attachment", async () => {
    const contract = await newContract("Orion Cloud — the round trip");
    const content = Buffer.from("the bytes that went in, exactly");
    const document = await uploaded(adminCookies, contract.number, {
      filename: "round_trip.pdf",
      contentType: "application/pdf",
      content,
    });

    const res = await download(adminCookies, document.id, currentOf(document).id);

    expect(res.statusCode, res.body).toBe(200);
    expect(res.rawPayload.equals(content)).toBe(true);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-length"]).toBe(String(content.byteLength));
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["content-disposition"]).toContain('filename="round_trip.pdf"');
    // The declared type was never verified, so the browser must not go
    // looking for a better one.
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("offers a non-ASCII filename in both header forms", async () => {
    const contract = await newContract("Orion Cloud — the accented name");
    const document = await uploaded(adminCookies, contract.number, {
      filename: "Résumé — Ørsted.pdf",
    });

    const res = await download(adminCookies, document.id, currentOf(document).id);

    const disposition = String(res.headers["content-disposition"]);
    // The plain form is printable ASCII and carries no quote that would
    // end it early; the RFC 5987 form carries the real name.
    expect(disposition).toMatch(/filename="[ -~]+"/);
    expect(disposition).toContain(
      `filename*=UTF-8''${encodeURIComponent("Résumé — Ørsted.pdf").replaceAll("'", "%27")}`,
    );
  });

  it("answers 404 for a version that belongs to another document", async () => {
    const contract = await newContract("Orion Cloud — crossed ids");
    const one = await uploaded(adminCookies, contract.number, { filename: "one.pdf" });
    const two = await uploaded(adminCookies, contract.number, { filename: "two.pdf" });

    const res = await download(adminCookies, one.id, currentOf(two).id);

    expect(res.statusCode).toBe(404);
  });
});

describe("who reaches a contract's paper", () => {
  it("lets a Contributor on the team list and download", async () => {
    const contract = await newContract("Orion Cloud — the Contributor");
    await putOnTeam(contract.number, idOf(CONTRIBUTOR), "contributor");
    const content = Buffer.from("what the Contributor was added to work on");
    const document = await uploaded(adminCookies, contract.number, { content });

    const list = await listDocuments(contributorCookies, contract.number);
    expect(list.statusCode, list.body).toBe(200);
    expect((list.json().documents as DocumentRow[]).map((row) => row.id)).toEqual([document.id]);

    const file = await download(contributorCookies, document.id, currentOf(document).id);
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.equals(content)).toBe(true);
  });

  it("refuses a Contributor's upload without hiding the record from them", async () => {
    const contract = await newContract("Orion Cloud — the Contributor's pen");
    await putOnTeam(contract.number, idOf(CONTRIBUTOR), "contributor");

    const res = await upload(contributorCookies, contract.number);

    // 403, not 404: they can already see the record, so a missing-record
    // answer would only make a real boundary read as a bug. Their write
    // grid arrives with M23 (DD-015).
    expect(res.statusCode, res.body).toBe(403);
  });

  it("answers a Contributor who is not on the contract as it answers for one that does not exist", async () => {
    const contract = await newContract("Orion Cloud — the stranger");
    const document = await uploaded(adminCookies, contract.number);

    const walled = await listDocuments(strangerCookies, contract.number);
    const missing = await listDocuments(strangerCookies, NEVER_CREATED);
    expect(walled.statusCode).toBe(missing.statusCode);
    expect(withoutInstance(walled.json())).toEqual(withoutInstance(missing.json()));

    const file = await download(strangerCookies, document.id, currentOf(document).id);
    expect(file.statusCode).toBe(404);
  });

  it("hides a confidential contract's paper from a Legal Team Member outside its team", async () => {
    const contract = await newContract("Project Nightingale");
    await putOnTeam(contract.number, idOf(MEMBER), "member");
    const document = await uploaded(adminCookies, contract.number, {
      filename: "nightingale_draft.docx",
    });
    await markConfidential(contract.number);

    // The included side still sees it whole.
    const included = await listDocuments(memberCookies, contract.number);
    expect(included.statusCode, included.body).toBe(200);
    expect((included.json().documents as DocumentRow[]).map((row) => row.id)).toEqual([
      document.id,
    ]);

    // The excluded side gets the answer a contract that does not exist
    // gives — on the list, on the download, and on the upload alike.
    const list = await listDocuments(outsiderCookies, contract.number);
    const missingList = await listDocuments(outsiderCookies, NEVER_CREATED);
    expect(list.statusCode).toBe(missingList.statusCode);
    expect(withoutInstance(list.json())).toEqual(withoutInstance(missingList.json()));

    const file = await download(outsiderCookies, document.id, currentOf(document).id);
    expect(file.statusCode).toBe(404);
    expect(file.json().detail).not.toContain("nightingale");

    const write = await upload(outsiderCookies, contract.number);
    const missingWrite = await upload(outsiderCookies, NEVER_CREATED);
    expect(write.statusCode).toBe(missingWrite.statusCode);
    expect(withoutInstance(write.json())).toEqual(withoutInstance(missingWrite.json()));
    expect(write.statusCode).toBe(404);
  });

  it("refuses a Contributor's version upload and metadata edit without hiding the record", async () => {
    const contract = await newContract("Orion Cloud — the Contributor's revision");
    await putOnTeam(contract.number, idOf(CONTRIBUTOR), "contributor");
    const document = await uploaded(adminCookies, contract.number);

    // 403 on both, for the reason the first upload gives: they can
    // already see the record, so a missing-record answer would make a
    // real boundary read as a bug. Their write grid arrives with M23.
    const version = await addVersion(contributorCookies, document.id);
    expect(version.statusCode, version.body).toBe(403);
    const rename = await patchDocument(contributorCookies, document.id, { title: "Mine now" });
    expect(rename.statusCode, rename.body).toBe(403);
  });

  it("hides a confidential contract's chain and metadata from a Member outside its team", async () => {
    const contract = await newContract("Project Nightingale — the chain");
    const document = await uploaded(adminCookies, contract.number, {
      filename: "nightingale_draft.docx",
    });
    await versionAdded(adminCookies, document.id, { kind: "redline_theirs" });
    await markConfidential(contract.number);

    // A document id nobody outside the audience should be able to do
    // anything with, and a well-formed id nothing was ever created
    // under. The two answers must be one answer.
    const missing = "01920000-0000-7000-8000-0000000000ff";
    const walledVersion = await addVersion(outsiderCookies, document.id);
    const missingVersion = await addVersion(outsiderCookies, missing);
    expect(walledVersion.statusCode).toBe(404);
    expect(withoutInstance(walledVersion.json())).toEqual(withoutInstance(missingVersion.json()));

    const walledEdit = await patchDocument(outsiderCookies, document.id, { title: "Seen it" });
    const missingEdit = await patchDocument(outsiderCookies, missing, { title: "Seen it" });
    expect(walledEdit.statusCode).toBe(404);
    expect(withoutInstance(walledEdit.json())).toEqual(withoutInstance(missingEdit.json()));

    // And the record is as it was: nothing landed, nothing was renamed.
    const list = await listDocuments(adminCookies, contract.number);
    const [row] = list.json().documents as DocumentRow[];
    expect(row!.versions.length).toBe(2);
    expect(row!.title).toBe("nightingale_draft.docx");
  });

  it("lets a Member on the team append and rename", async () => {
    const contract = await newContract("Project Nightingale — the included Member");
    await putOnTeam(contract.number, idOf(MEMBER), "member");
    const document = await uploaded(adminCookies, contract.number);
    await markConfidential(contract.number);

    const appended = await versionAdded(memberCookies, document.id, { kind: "redline_ours" });
    expect(currentOf(appended).versionNumber).toBe(2);
    expect(currentOf(appended).uploadedBy.id).toBe(idOf(MEMBER));

    const renamed = await patchDocument(memberCookies, document.id, { title: "Nightingale MSA" });
    expect(renamed.statusCode, renamed.body).toBe(200);
  });

  it("refuses an upload onto an archived contract, and still answers its list", async () => {
    const contract = await newContract("Orion Cloud — archived");
    const document = await uploaded(adminCookies, contract.number, { filename: "before.pdf" });
    const archive = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/archive`,
      cookies: adminCookies,
    });
    expect(archive.statusCode, archive.body).toBe(200);

    // A frozen record takes no new paper: putting a file on it is a
    // change to the record, not a conversation about it.
    const res = await upload(adminCookies, contract.number, { filename: "after.pdf" });
    expect(res.statusCode, res.body).toBe(409);

    // It still reads, because restore has to be reachable.
    const list = await listDocuments(adminCookies, contract.number);
    expect(list.statusCode, list.body).toBe(200);
    expect((list.json().documents as DocumentRow[]).map((row) => row.id)).toEqual([document.id]);
    const file = await download(adminCookies, document.id, currentOf(document).id);
    expect(file.statusCode).toBe(200);
  });

  it("leaves nothing on the record when the upload was refused", async () => {
    const contract = await newContract("Project Nightingale — nothing landed");
    await markConfidential(contract.number);

    await upload(outsiderCookies, contract.number, { filename: "should_not_land.docx" });

    const res = await listDocuments(adminCookies, contract.number);
    expect(res.json().documents).toEqual([]);
  });
});

/**
 * The primary document (CTR-014, M11/4): which document *is* the
 * contract.
 *
 * The claim under test is "exactly one at a time", so every assertion
 * counts the marked documents rather than looking one up — a suite that
 * only checked the document it just named would pass on a record with
 * two primaries in it.
 */
describe("the primary document", () => {
  it("gives the designation to the first document uploaded", async () => {
    const contract = await newContract("Orion Cloud — the first file");

    const document = await uploaded(adminCookies, contract.number, { filename: "msa.docx" });

    expect(document.isPrimary).toBe(true);
  });

  it("leaves every document after the first a loose attachment", async () => {
    const contract = await newContract("Orion Cloud — the attachments");
    const instrument = await uploaded(adminCookies, contract.number, { filename: "msa.docx" });
    await uploaded(adminCookies, contract.number, { filename: "insurance_cert.pdf" });
    await uploaded(adminCookies, contract.number, { filename: "parent_guarantee.pdf" });

    const rows = (await listDocuments(adminCookies, contract.number)).json()
      .documents as DocumentRow[];

    expect(rows.filter((row) => row.isPrimary).map((row) => row.id)).toEqual([instrument.id]);
  });

  it("moves the designation to another document on the same contract", async () => {
    const contract = await newContract("Orion Cloud — the reassignment");
    const first = await uploaded(adminCookies, contract.number, { filename: "wrong_file.pdf" });
    const second = await uploaded(adminCookies, contract.number, { filename: "the_msa.docx" });

    const res = await makePrimary(adminCookies, second.id);

    expect(res.statusCode, res.body).toBe(200);
    // The whole record's paper comes back, because two documents
    // changed: the one that took the designation and the one that lost
    // it.
    const answered = res.json().documents as DocumentRow[];
    expect(answered.filter((row) => row.isPrimary).map((row) => row.id)).toEqual([second.id]);

    const rows = (await listDocuments(adminCookies, contract.number)).json()
      .documents as DocumentRow[];
    expect(rows.filter((row) => row.isPrimary).map((row) => row.id)).toEqual([second.id]);
    expect(rows.find((row) => row.id === first.id)!.isPrimary).toBe(false);
  });

  it("refuses naming the document that already holds it", async () => {
    const contract = await newContract("Orion Cloud — already the primary");
    const document = await uploaded(adminCookies, contract.number);

    const res = await makePrimary(adminCookies, document.id);

    expect(res.statusCode, res.body).toBe(409);
  });

  it("keeps each contract's designation to itself", async () => {
    const mine = await newContract("Orion Cloud — my instrument");
    const theirs = await newContract("Orion Cloud — their instrument");
    const ours = await uploaded(adminCookies, mine.number, { filename: "ours.docx" });
    await uploaded(adminCookies, theirs.number, { filename: "theirs.docx" });

    const rows = (await listDocuments(adminCookies, theirs.number)).json()
      .documents as DocumentRow[];

    expect(rows.some((row) => row.id === ours.id)).toBe(false);
    expect(rows.filter((row) => row.isPrimary).length).toBe(1);
  });

  it("records the first upload's designation as its own action", async () => {
    const contract = await newContract("Orion Cloud — the first designation");
    const document = await uploaded(adminCookies, contract.number, { filename: "msa.docx" });

    const entries = await feed(adminCookies, contract.id);
    const entry = entries.find((row) => row.action === "document.primary_set");
    expect(entry, "a document.primary_set entry on the contract").toBeDefined();
    expect(entry!.payload.documentId).toBe(document.id);
    expect(entry!.payload.title).toBe("msa.docx");
    // Nobody asked for it, so the entry says it happened rather than
    // leaving it implied by the upload beside it.
    expect(entry!.payload.from).toBeNull();
  });

  it("names both documents when the designation moves", async () => {
    const contract = await newContract("Orion Cloud — the moved designation");
    const first = await uploaded(adminCookies, contract.number, { filename: "wrong_file.pdf" });
    const second = await uploaded(adminCookies, contract.number, { filename: "the_msa.docx" });

    const res = await makePrimary(adminCookies, second.id);
    expect(res.statusCode, res.body).toBe(200);

    const entries = await feed(adminCookies, contract.id);
    const moved = entries.filter((row) => row.action === "document.primary_set");
    // Two: the one the first upload took, and this one.
    expect(moved.length).toBe(2);
    const latest = moved.find((row) => row.payload.documentId === second.id);
    expect(latest, "the reassignment entry").toBeDefined();
    expect(latest!.payload.title).toBe("the_msa.docx");
    expect(latest!.payload.fromDocumentId).toBe(first.id);
    expect(latest!.payload.from).toBe("wrong_file.pdf");
  });

  it("refuses the reassignment on an archived contract", async () => {
    const contract = await newContract("Orion Cloud — frozen designation");
    await uploaded(adminCookies, contract.number, { filename: "one.pdf" });
    const second = await uploaded(adminCookies, contract.number, { filename: "two.pdf" });
    const archive = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/archive`,
      cookies: adminCookies,
    });
    expect(archive.statusCode, archive.body).toBe(200);

    const res = await makePrimary(adminCookies, second.id);

    expect(res.statusCode, res.body).toBe(409);
  });

  it("refuses a Contributor without hiding the record from them", async () => {
    const contract = await newContract("Orion Cloud — the Contributor's designation");
    await putOnTeam(contract.number, idOf(CONTRIBUTOR), "contributor");
    await uploaded(adminCookies, contract.number, { filename: "one.pdf" });
    const second = await uploaded(adminCookies, contract.number, { filename: "two.pdf" });

    const res = await makePrimary(contributorCookies, second.id);

    expect(res.statusCode, res.body).toBe(403);
  });

  it("answers a walled-off viewer exactly as it answers for a document that was never created", async () => {
    const contract = await newContract("Project Nightingale — the designation");
    await uploaded(adminCookies, contract.number, { filename: "one.pdf" });
    const second = await uploaded(adminCookies, contract.number, { filename: "two.pdf" });
    await markConfidential(contract.number);

    const missing = "01920000-0000-7000-8000-0000000000aa";
    const walled = await makePrimary(outsiderCookies, second.id);
    const absent = await makePrimary(outsiderCookies, missing);

    expect(walled.statusCode).toBe(404);
    expect(withoutInstance(walled.json())).toEqual(withoutInstance(absent.json()));

    // And the record is as it was.
    const rows = (await listDocuments(adminCookies, contract.number)).json()
      .documents as DocumentRow[];
    expect(rows.filter((row) => row.isPrimary).map((row) => row.id)).not.toEqual([second.id]);
  });
});

/**
 * The executed pin (CTR-014, DOC-001, M11/4): which version of a
 * document is the signed one.
 *
 * Two claims are load-bearing here and are asserted rather than assumed.
 * The pin is **explicit** — no upload sets it, whatever kind the
 * uploader tagged the round with. And the pinned row must be a version
 * of **this** document, refused at write time.
 */
describe("the executed pin", () => {
  it("pins nothing until somebody says which version, even for a round tagged executed", async () => {
    const contract = await newContract("Orion Cloud — nothing pinned");
    const document = await uploaded(adminCookies, contract.number, { filename: "msa.docx" });
    const signed = await versionAdded(adminCookies, document.id, {
      kind: "executed",
      filename: "msa_signed.pdf",
    });

    // The kind is what the uploader called this round. The pin is what
    // the team decided, and nobody has decided yet.
    expect(currentOf(signed).kind).toBe("executed");
    expect(executedOf(signed)).toEqual([]);
  });

  it("pins the version the team chose", async () => {
    const contract = await newContract("Orion Cloud — the signed copy");
    const document = await uploaded(adminCookies, contract.number, { filename: "msa.docx" });
    const withSigned = await versionAdded(adminCookies, document.id, {
      kind: "executed",
      filename: "msa_signed.pdf",
    });
    const signed = currentOf(withSigned);

    const res = await pinExecuted(adminCookies, document.id, signed.id);

    expect(res.statusCode, res.body).toBe(200);
    expect(executedOf(res.json().document as DocumentRow).map((row) => row.id)).toEqual([
      signed.id,
    ]);
    const rows = (await listDocuments(adminCookies, contract.number)).json()
      .documents as DocumentRow[];
    expect(executedOf(rows[0]!).map((row) => row.id)).toEqual([signed.id]);
  });

  it("pins a superseded version, because the pin is not the current one", async () => {
    const contract = await newContract("Orion Cloud — signed then amended");
    const document = await uploaded(adminCookies, contract.number, { filename: "msa.docx" });
    const withSigned = await versionAdded(adminCookies, document.id, { kind: "executed" });
    const signed = currentOf(withSigned);
    const withAmendment = await versionAdded(adminCookies, document.id, { kind: "amendment" });
    expect(currentOf(withAmendment).versionNumber).toBe(3);

    const res = await pinExecuted(adminCookies, document.id, signed.id);

    expect(res.statusCode, res.body).toBe(200);
    const answered = res.json().document as DocumentRow;
    expect(executedOf(answered).map((row) => row.versionNumber)).toEqual([2]);
    // Two different marks on two different rows: the chain's own head,
    // and the file that was signed.
    expect(currentOf(answered).versionNumber).toBe(3);
    expect(currentOf(answered).isExecuted).toBe(false);
  });

  it("moves the pin rather than holding two", async () => {
    const contract = await newContract("Orion Cloud — the corrected pin");
    const document = await uploaded(adminCookies, contract.number, { filename: "msa.docx" });
    const first = currentOf(document);
    const withSecond = await versionAdded(adminCookies, document.id, { kind: "executed" });
    const second = currentOf(withSecond);

    await pinExecuted(adminCookies, document.id, first.id);
    const res = await pinExecuted(adminCookies, document.id, second.id);

    expect(res.statusCode, res.body).toBe(200);
    expect(executedOf(res.json().document as DocumentRow).map((row) => row.id)).toEqual([
      second.id,
    ]);
  });

  it("refuses a version that belongs to another document, and pins nothing", async () => {
    const contract = await newContract("Orion Cloud — crossed pin");
    const one = await uploaded(adminCookies, contract.number, { filename: "one.pdf" });
    const two = await uploaded(adminCookies, contract.number, { filename: "two.pdf" });

    const res = await pinExecuted(adminCookies, one.id, currentOf(two).id);

    // DOC-001's same-document invariant, refused at write time.
    expect(res.statusCode, res.body).toBe(404);
    const rows = (await listDocuments(adminCookies, contract.number)).json()
      .documents as DocumentRow[];
    expect(rows.flatMap(executedOf)).toEqual([]);
  });

  it("refuses pinning the version that already holds the pin", async () => {
    const contract = await newContract("Orion Cloud — pinned twice");
    const document = await uploaded(adminCookies, contract.number);
    const version = currentOf(document);
    expect((await pinExecuted(adminCookies, document.id, version.id)).statusCode).toBe(200);

    const res = await pinExecuted(adminCookies, document.id, version.id);

    expect(res.statusCode, res.body).toBe(409);
  });

  it("clears the pin and leaves every version exactly as it was", async () => {
    const contract = await newContract("Orion Cloud — unpinned");
    const content = Buffer.from("the signed copy, byte for byte");
    const document = await uploaded(adminCookies, contract.number, { filename: "msa.docx" });
    const withSigned = await versionAdded(adminCookies, document.id, {
      kind: "executed",
      note: "counter-signed and returned",
      filename: "msa_signed.pdf",
      content,
    });
    const signed = currentOf(withSigned);
    expect((await pinExecuted(adminCookies, document.id, signed.id)).statusCode).toBe(200);

    const res = await clearExecuted(adminCookies, document.id);

    expect(res.statusCode, res.body).toBe(200);
    const answered = res.json().document as DocumentRow;
    expect(executedOf(answered)).toEqual([]);
    // The chain is untouched: same rows, same numbers, same kinds, same
    // notes, same files. Only the one column on the document moved.
    expect(answered.versions.map((row) => ({ ...row, isExecuted: undefined }))).toEqual(
      withSigned.versions.map((row) => ({ ...row, isExecuted: undefined })),
    );
    const file = await download(adminCookies, document.id, signed.id);
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.equals(content)).toBe(true);
  });

  it("refuses a clear when no version is pinned", async () => {
    const contract = await newContract("Orion Cloud — nothing to clear");
    const document = await uploaded(adminCookies, contract.number);

    const res = await clearExecuted(adminCookies, document.id);

    expect(res.statusCode, res.body).toBe(409);
  });

  it("leaves the pin where it is when the next round is appended", async () => {
    const contract = await newContract("Orion Cloud — a round after the signature");
    const document = await uploaded(adminCookies, contract.number, { kind: "executed" });
    const signed = currentOf(document);
    expect((await pinExecuted(adminCookies, document.id, signed.id)).statusCode).toBe(200);

    const appended = await versionAdded(adminCookies, document.id, { kind: "amendment" });

    expect(executedOf(appended).map((row) => row.id)).toEqual([signed.id]);
  });

  it("records the set and the clear as two different actions", async () => {
    const contract = await newContract("Orion Cloud — the pin's narrative");
    const document = await uploaded(adminCookies, contract.number, { filename: "msa.docx" });
    const withSigned = await versionAdded(adminCookies, document.id, { kind: "executed" });
    const signed = currentOf(withSigned);
    expect((await pinExecuted(adminCookies, document.id, signed.id)).statusCode).toBe(200);
    expect((await clearExecuted(adminCookies, document.id)).statusCode).toBe(200);

    const entries = await feed(adminCookies, contract.id);
    const set = entries.find((row) => row.action === "document.executed_set");
    expect(set, "a document.executed_set entry on the contract").toBeDefined();
    expect(set!.payload.documentId).toBe(document.id);
    expect(set!.payload.title).toBe("msa.docx");
    expect(set!.payload.versionId).toBe(signed.id);
    expect(set!.payload.versionNumber).toBe(2);

    const cleared = entries.find((row) => row.action === "document.executed_cleared");
    expect(cleared, "a document.executed_cleared entry on the contract").toBeDefined();
    expect(cleared!.payload.documentId).toBe(document.id);
    expect(cleared!.payload.versionId).toBe(signed.id);
    expect(cleared!.payload.versionNumber).toBe(2);
  });

  it("refuses the pin and the clear on an archived contract", async () => {
    const contract = await newContract("Orion Cloud — frozen pin");
    const document = await uploaded(adminCookies, contract.number);
    const version = currentOf(document);
    expect((await pinExecuted(adminCookies, document.id, version.id)).statusCode).toBe(200);
    const archive = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/archive`,
      cookies: adminCookies,
    });
    expect(archive.statusCode, archive.body).toBe(200);

    expect((await clearExecuted(adminCookies, document.id)).statusCode).toBe(409);
    expect((await pinExecuted(adminCookies, document.id, version.id)).statusCode).toBe(409);
  });

  it("refuses a Contributor without hiding the record from them", async () => {
    const contract = await newContract("Orion Cloud — the Contributor's pin");
    await putOnTeam(contract.number, idOf(CONTRIBUTOR), "contributor");
    const document = await uploaded(adminCookies, contract.number);

    const res = await pinExecuted(contributorCookies, document.id, currentOf(document).id);

    expect(res.statusCode, res.body).toBe(403);
    expect((await clearExecuted(contributorCookies, document.id)).statusCode).toBe(403);
  });

  it("answers a walled-off viewer exactly as it answers for a document that was never created", async () => {
    const contract = await newContract("Project Nightingale — the pin");
    const document = await uploaded(adminCookies, contract.number, { filename: "one.pdf" });
    const version = currentOf(document);
    await markConfidential(contract.number);

    const missing = "01920000-0000-7000-8000-0000000000bb";
    const walledSet = await pinExecuted(outsiderCookies, document.id, version.id);
    const absentSet = await pinExecuted(outsiderCookies, missing, version.id);
    expect(walledSet.statusCode).toBe(404);
    expect(withoutInstance(walledSet.json())).toEqual(withoutInstance(absentSet.json()));

    const walledClear = await clearExecuted(outsiderCookies, document.id);
    const absentClear = await clearExecuted(outsiderCookies, missing);
    expect(walledClear.statusCode).toBe(404);
    expect(withoutInstance(walledClear.json())).toEqual(withoutInstance(absentClear.json()));

    // And nothing was pinned.
    const rows = (await listDocuments(adminCookies, contract.number)).json()
      .documents as DocumentRow[];
    expect(rows.flatMap(executedOf)).toEqual([]);
  });
});

/**
 * Archive and restore (DOC-010, M11/5): the soft delete, and its undo.
 *
 * The claim is that archiving destroys nothing. So the assertions here
 * are not only that the row left the list — they are that everything it
 * held is still there and comes back untouched: the whole chain, byte
 * for byte, with its notes and both CTR-014 designations still on it.
 */
describe("archiving a document", () => {
  it("takes it off the list and out of the count, and keeps it whole", async () => {
    const contract = await newContract("Orion Cloud — the wrong upload");
    const keep = await uploaded(adminCookies, contract.number, { filename: "keep.pdf" });
    const wrong = await uploaded(adminCookies, contract.number, {
      filename: "wrong_contract.pdf",
      note: "Uploaded to the wrong record.",
    });

    const row = await archived(adminCookies, wrong.id);
    expect(row.archivedAt).not.toBeNull();

    // Off the list, which is what the section counts.
    expect((await paper(adminCookies, contract.number)).map((each) => each.id)).toEqual([keep.id]);
    // And still there in full, for whoever comes to restore it.
    const shown = await paper(adminCookies, contract.number, true);
    expect(shown.map((each) => each.id).sort()).toEqual([keep.id, wrong.id].sort());
    const stored = shown.find((each) => each.id === wrong.id)!;
    expect(stored.versions).toEqual(wrong.versions);
    expect(stored.archivedAt).toBe(row.archivedAt);
  });

  it("keeps every version downloadable, because nothing was destroyed", async () => {
    const contract = await newContract("Orion Cloud — archived and still readable");
    const content = Buffer.from("the draft that was archived by mistake");
    const document = await uploaded(adminCookies, contract.number, { content });

    await archived(adminCookies, document.id);

    const file = await download(adminCookies, document.id, currentOf(document).id);
    expect(file.statusCode, file.body).toBe(200);
    expect(file.rawPayload.equals(content)).toBe(true);
  });

  it("puts it back on the list, whole, when it is restored", async () => {
    const contract = await newContract("Orion Cloud — the two-second fix");
    const document = await uploaded(adminCookies, contract.number, { filename: "draft.docx" });
    const revised = await versionAdded(adminCookies, document.id, {
      kind: "redline_theirs",
      note: "Their pass.",
    });
    const pinned = await pinExecuted(adminCookies, document.id, revised.versions[0]!.id);
    expect(pinned.statusCode, pinned.body).toBe(200);
    const before = pinned.json().document as DocumentRow;

    await archived(adminCookies, document.id);
    const res = await restoreDocument(adminCookies, document.id);

    expect(res.statusCode, res.body).toBe(200);
    const after = res.json().document as DocumentRow;
    expect(after.archivedAt).toBeNull();
    // Nothing had to be rebuilt: the chain, the notes, and both
    // designations are exactly what they were.
    expect(after.versions).toEqual(before.versions);
    expect(after.isPrimary).toBe(before.isPrimary);
    expect((await paper(adminCookies, contract.number)).map((each) => each.id)).toEqual([
      document.id,
    ]);
  });

  it("refuses a second archive and a restore of a document that is on the list", async () => {
    const contract = await newContract("Orion Cloud — twice over");
    const document = await uploaded(adminCookies, contract.number);

    const early = await restoreDocument(adminCookies, document.id);
    expect(early.statusCode, early.body).toBe(409);

    await archived(adminCookies, document.id);
    const again = await archiveDocument(adminCookies, document.id);
    expect(again.statusCode, again.body).toBe(409);
  });

  it("refuses every edit to an archived document until it is restored", async () => {
    const contract = await newContract("Orion Cloud — hidden and frozen");
    const document = await uploaded(adminCookies, contract.number);
    const other = await uploaded(adminCookies, contract.number, { filename: "other.pdf" });
    await archived(adminCookies, document.id);

    // A round added to a document nobody can see is work that goes
    // nowhere, and so is a rename.
    expect((await addVersion(adminCookies, document.id)).statusCode).toBe(409);
    expect((await patchDocument(adminCookies, document.id, { title: "New" })).statusCode).toBe(409);
    expect((await makePrimary(adminCookies, document.id)).statusCode).toBe(409);
    expect((await pinExecuted(adminCookies, document.id, currentOf(document).id)).statusCode).toBe(
      409,
    );

    // The document beside it is untouched by any of that.
    expect((await addVersion(adminCookies, other.id)).statusCode).toBe(201);
  });

  it("lets a Member on the team archive and restore, and refuses a Contributor", async () => {
    const contract = await newContract("Orion Cloud — who may archive");
    await putOnTeam(contract.number, idOf(MEMBER), "member");
    await putOnTeam(contract.number, idOf(CONTRIBUTOR), "contributor");
    const document = await uploaded(adminCookies, contract.number);

    // 403, not 404: a Contributor already reads the record, so hiding
    // it would make a real boundary read as a bug (DD-015).
    expect((await archiveDocument(contributorCookies, document.id)).statusCode).toBe(403);

    expect((await archiveDocument(memberCookies, document.id)).statusCode).toBe(200);
    expect((await restoreDocument(memberCookies, document.id)).statusCode).toBe(200);
  });

  it("refuses both on an archived contract, because a frozen record takes no change", async () => {
    const contract = await newContract("Orion Cloud — frozen record");
    const document = await uploaded(adminCookies, contract.number);
    const freeze = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/archive`,
      cookies: adminCookies,
    });
    expect(freeze.statusCode, freeze.body).toBe(200);

    expect((await archiveDocument(adminCookies, document.id)).statusCode).toBe(409);
    expect((await restoreDocument(adminCookies, document.id)).statusCode).toBe(409);
  });

  it("writes its own activity action for each of the two", async () => {
    const contract = await newContract("Orion Cloud — the archive's narration");
    const document = await uploaded(adminCookies, contract.number, { filename: "misfiled.pdf" });

    await archived(adminCookies, document.id);
    expect((await restoreDocument(adminCookies, document.id)).statusCode).toBe(200);

    const entries = await feed(adminCookies, contract.id);
    const archiveEntry = entries.find((entry) => entry.action === "document.archived");
    const restoreEntry = entries.find((entry) => entry.action === "document.restored");
    expect(archiveEntry?.payload.title).toBe("misfiled.pdf");
    expect(restoreEntry?.payload.title).toBe("misfiled.pdf");
    expect(archiveEntry?.payload.documentId).toBe(document.id);
  });

  it("answers a viewer who cannot reach the contract as it answers for a document that does not exist", async () => {
    const contract = await newContract("Project Nightingale — archiving");
    const document = await uploaded(adminCookies, contract.number, {
      filename: "nightingale.docx",
    });
    await markConfidential(contract.number);
    const missing = "01920000-0000-7000-8000-0000000000fa";

    for (const call of [archiveDocument, restoreDocument]) {
      const walled = await call(outsiderCookies, document.id);
      const nowhere = await call(outsiderCookies, missing);
      expect(walled.statusCode).toBe(404);
      expect(withoutInstance(walled.json())).toEqual(withoutInstance(nowhere.json()));
      expect(walled.body).not.toContain("nightingale");
    }

    // And nothing happened to the record.
    expect((await paper(adminCookies, contract.number)).map((each) => each.id)).toEqual([
      document.id,
    ]);
  });
});

/**
 * The Administrator's hard delete (DOC-010, M11/5): the lawful-erasure
 * answer.
 *
 * Two claims are the subject. The first is that the erasure is complete:
 * the document row, every version row under it, and every stored blob
 * those versions named are gone, and the blobs are checked through the
 * adapter rather than inferred from a 404. The second is that the
 * erasure stays accountable: the entries written before it are still
 * readable afterwards and still name what was destroyed, which is the
 * only thing left that can.
 */
describe("the Administrator's hard delete", () => {
  it("removes the document row, its version rows, and its stored blobs", async () => {
    const contract = await newContract("Orion Cloud — the erasure");
    const document = await uploaded(adminCookies, contract.number, { filename: "personal.pdf" });
    await versionAdded(adminCookies, document.id, { kind: "redline_theirs" });
    const refs = await fileRefsOf(document.id);
    expect(refs.length).toBe(2);
    for (const ref of refs) expect(await blobExists(ref)).toBe(true);

    const res = await hardDelete(adminCookies, document.id, "personal.pdf");

    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().documents).toEqual([]);
    // The rows, both tables.
    expect(
      await harness.db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.id, document.id)),
    ).toEqual([]);
    expect(await fileRefsOf(document.id)).toEqual([]);
    // The blobs, asked of the adapter itself.
    for (const ref of refs) expect(await blobExists(ref)).toBe(false);
    // And nothing answers at the old address.
    expect((await download(adminCookies, document.id, currentOf(document).id)).statusCode).toBe(
      404,
    );
  });

  it("takes an archived document too, and leaves the rest of the record alone", async () => {
    const contract = await newContract("Orion Cloud — erasing the archived");
    const keep = await uploaded(adminCookies, contract.number, { filename: "keep.pdf" });
    const keepRefs = await fileRefsOf(keep.id);
    const gone = await uploaded(adminCookies, contract.number, { filename: "gone.pdf" });
    await archived(adminCookies, gone.id);

    const res = await hardDelete(adminCookies, gone.id, "gone.pdf");

    expect(res.statusCode, res.body).toBe(200);
    expect((res.json().documents as DocumentRow[]).map((row) => row.id)).toEqual([keep.id]);
    expect(await paper(adminCookies, contract.number, true)).toHaveLength(1);
    for (const ref of keepRefs) expect(await blobExists(ref)).toBe(true);
  });

  it("reaches a document on an archived contract, because erasure is compelled from outside", async () => {
    const contract = await newContract("Orion Cloud — frozen and still erasable");
    const document = await uploaded(adminCookies, contract.number, { filename: "personal.pdf" });
    const refs = await fileRefsOf(document.id);
    const freeze = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/archive`,
      cookies: adminCookies,
    });
    expect(freeze.statusCode, freeze.body).toBe(200);

    const res = await hardDelete(adminCookies, document.id, "personal.pdf");

    // A frozen record refuses every other write on its paper. It is not
    // a place to hide from a lawful erasure.
    expect(res.statusCode, res.body).toBe(200);
    for (const ref of refs) expect(await blobExists(ref)).toBe(false);
  });

  it("refuses a confirmation that is not the document's own name, and destroys nothing", async () => {
    const contract = await newContract("Orion Cloud — a near miss");
    const document = await uploaded(adminCookies, contract.number, { filename: "personal.pdf" });
    const refs = await fileRefsOf(document.id);

    const res = await hardDelete(adminCookies, document.id, "personal.pd");

    expect(res.statusCode, res.body).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    // The whole outcome is the refusal: the row, the chain, and the
    // files are exactly as they were.
    expect((await paper(adminCookies, contract.number)).map((row) => row.id)).toEqual([
      document.id,
    ]);
    for (const ref of refs) expect(await blobExists(ref)).toBe(true);
  });

  it("takes the confirmation with surrounding whitespace, because that is not a different name", async () => {
    const contract = await newContract("Orion Cloud — a trailing space");
    const document = await uploaded(adminCookies, contract.number, { filename: "personal.pdf" });

    const res = await hardDelete(adminCookies, document.id, "  personal.pdf  ");

    expect(res.statusCode, res.body).toBe(200);
    expect(await paper(adminCookies, contract.number, true)).toEqual([]);
  });

  it("is refused for every role except Administrator", async () => {
    const contract = await newContract("Orion Cloud — not yours to destroy");
    await putOnTeam(contract.number, idOf(MEMBER), "member");
    await putOnTeam(contract.number, idOf(CONTRIBUTOR), "contributor");
    const document = await uploaded(adminCookies, contract.number, { filename: "personal.pdf" });

    // A Legal Team Member on the team archives all day and destroys
    // nothing: 403, not 404, because they can see the record and the
    // boundary is a real one (DOC-010).
    expect((await hardDelete(memberCookies, document.id, "personal.pdf")).statusCode).toBe(403);
    expect((await hardDelete(contributorCookies, document.id, "personal.pdf")).statusCode).toBe(
      403,
    );
    expect((await paper(adminCookies, contract.number)).map((row) => row.id)).toEqual([
      document.id,
    ]);
  });

  it("leaves the contract without an instrument when the primary document was the one erased", async () => {
    const contract = await newContract("Orion Cloud — the instrument erased");
    const instrument = await uploaded(adminCookies, contract.number, { filename: "msa.pdf" });
    const schedule = await uploaded(adminCookies, contract.number, { filename: "schedule.pdf" });
    expect(instrument.isPrimary).toBe(true);

    const res = await hardDelete(adminCookies, instrument.id, "msa.pdf");

    expect(res.statusCode, res.body).toBe(200);
    const rows = res.json().documents as DocumentRow[];
    expect(rows.map((row) => row.id)).toEqual([schedule.id]);
    // No dangling designation, and no row that quietly inherited it.
    expect(rows.filter((row) => row.isPrimary)).toEqual([]);
    expect((await paper(adminCookies, contract.number)).filter((row) => row.isPrimary)).toEqual([]);
  });

  it("keeps the activity and audit entries written before it, still naming what was deleted", async () => {
    const contract = await newContract("Orion Cloud — accountable after the files");
    const document = await uploaded(adminCookies, contract.number, { filename: "erased.pdf" });
    await versionAdded(adminCookies, document.id, { kind: "redline_theirs" });
    const rename = await patchDocument(adminCookies, document.id, { title: "Erased instrument" });
    expect(rename.statusCode, rename.body).toBe(200);

    const res = await hardDelete(adminCookies, document.id, "Erased instrument");
    expect(res.statusCode, res.body).toBe(200);

    const entries = await feed(adminCookies, contract.id);
    const mine = entries.filter((entry) => entry.payload.documentId === document.id);
    // Everything that happened to it is still readable, and each entry
    // still says which document it was about.
    expect(mine.map((entry) => entry.action).sort()).toEqual(
      [
        "document.created",
        "document.hard_deleted",
        "document.primary_set",
        "document.updated",
        "document.version_added",
      ].sort(),
    );
    expect(entries.find((entry) => entry.action === "document.created")?.payload.title).toBe(
      "erased.pdf",
    );
    const erasure = entries.find((entry) => entry.action === "document.hard_deleted");
    expect(erasure?.payload.title).toBe("Erased instrument");
    expect(erasure?.payload.versionCount).toBe(2);

    // The Administrator's audit log holds the same entry, filterable by
    // its own verb.
    const audit = await harness.app.inject({
      method: "GET",
      url: "/api/v1/audit-log?action=document.hard_deleted",
      cookies: adminCookies,
    });
    expect(audit.statusCode, audit.body).toBe(200);
    const logged = (audit.json().entries as { payload: Record<string, unknown> }[]).filter(
      (entry) => entry.payload.documentId === document.id,
    );
    expect(logged).toHaveLength(1);
    expect(logged[0]!.payload.title).toBe("Erased instrument");
  });

  it("answers an Administrator who cannot reach the contract as it answers for a document that does not exist", async () => {
    // Administrators reach every contract (DD-014), so the walled case
    // here is the id nothing was created under — the one address an
    // Administrator is refused at, and the refusal must name nothing.
    const missing = "01920000-0000-7000-8000-0000000000fb";

    const res = await hardDelete(adminCookies, missing, "anything");

    expect(res.statusCode, res.body).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
  });
});

describe("the upload ceiling", () => {
  /** A second app over the same database, with a ceiling small enough
   * to trip with a few kilobytes. The auth config is the harness's, so
   * the cookies already signed in verify here too. */
  let small: Awaited<ReturnType<typeof buildApp>>;
  const LIMIT = 4 * 1024;

  beforeAll(async () => {
    small = await buildApp({
      db: harness.db,
      config: TEST_AUTH_CONFIG,
      resolveMailer: fixedMailerResolver(new CapturingMailer()),
      storage: harness.storage,
      maxUploadBytes: LIMIT,
    });
    await small.ready();
  });

  afterAll(async () => {
    await small.close();
  });

  it("takes a file under the limit", async () => {
    const contract = await newContract("Orion Cloud — just under");

    const res = await upload(
      adminCookies,
      contract.number,
      { content: Buffer.alloc(LIMIT - 1, 0x61) },
      small,
    );

    expect(res.statusCode, res.body).toBe(201);
    expect(currentOf(res.json().document as DocumentRow).byteSize).toBe(LIMIT - 1);
  });

  it("refuses a file over the limit with a problem response that names it", async () => {
    const contract = await newContract("Orion Cloud — well over");

    const res = await upload(
      adminCookies,
      contract.number,
      { content: Buffer.alloc(LIMIT * 4, 0x61) },
      small,
    );

    expect(res.statusCode, res.body).toBe(413);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    // A clear message, not a mystery timeout (story 24).
    expect(res.json().detail).toContain("upload limit");

    // And nothing landed: the refusal is the whole outcome.
    const list = await listDocuments(adminCookies, contract.number);
    expect(list.json().documents).toEqual([]);
  });
});
