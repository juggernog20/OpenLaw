// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A contract's paper (M11/2) at the HTTP seam: upload a draft, see it on
 * the record, and get the same bytes back.
 *
 * The whole path is exercised through injected requests against real
 * Postgres and the committed migrations, with the production local
 * filesystem driver over a throwaway root — nothing here is a mock, and
 * the round trip is the assertion that the blob really went through the
 * adapter: the file that comes back is byte-for-byte the file that went
 * in, and its SHA-256 is the one the row recorded.
 *
 * Access is the second subject, and it is written the M10 way. A viewer
 * who cannot reach the owning contract must get, for the list, the
 * download, and the upload alike, exactly the answer a contract that was
 * never created gives. Each refusal is therefore asserted twice — once
 * at a walled record and once at a number nothing was ever made under —
 * and the two answers must be one answer.
 *
 * The third subject is the ceiling (story 24). An oversized upload is
 * refused with a problem response that names the limit, and nothing is
 * left on the record. It runs against a second app over the same
 * database with a small ceiling, because the refusal is worth testing
 * with a handful of bytes rather than with a hundred megabytes of them.
 */

import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql, users } from "@openlaw/db";
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
}

interface DocumentRow {
  id: string;
  title: string;
  currentVersion: VersionRow;
  createdBy: { id: string; displayName: string };
  createdAt: string;
  updatedAt: string;
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

/** The raw upload answer — the refusals are as much the subject as the
 * successes, so nothing here requires a status. */
function upload(
  cookies: Record<string, string>,
  number: number,
  options: UploadOptions = {},
  app = harness.app,
) {
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
  const { payload, headers } = multipartForm(parts);
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

const listDocuments = (cookies: Record<string, string>, number: number) =>
  harness.app.inject({ method: "GET", url: `/api/v1/contracts/${number}/documents`, cookies });

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
    expect(document.currentVersion.versionNumber).toBe(1);
    expect(document.currentVersion.originalFilename).toBe("Orion_MSA_2026_draft.docx");
    expect(document.currentVersion.mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(document.currentVersion.byteSize).toBe(content.byteLength);
    expect(document.currentVersion.checksumSha256).toBe(sha256(content));
    expect(document.currentVersion.uploadedBy.id).toBe(idOf(ADMIN));
    // The default kind, and no note: the M11/2 control sends neither.
    expect(document.currentVersion.kind).toBe("draft_ours");
    expect(document.currentVersion.note).toBeNull();
  });

  it("takes the kind and the note when the form sends them before the file", async () => {
    const contract = await newContract("Orion Cloud — kinds");

    const document = await uploaded(adminCookies, contract.number, {
      kind: "redline_theirs",
      note: "Their first pass. Clause 8 is the fight.",
    });

    expect(document.currentVersion.kind).toBe("redline_theirs");
    expect(document.currentVersion.note).toBe("Their first pass. Clause 8 is the fight.");
  });

  it("refuses a kind that is not one of the five", async () => {
    const contract = await newContract("Orion Cloud — bad kind");

    const res = await upload(adminCookies, contract.number, { kind: "generated_redline" });

    expect(res.statusCode, res.body).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
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
      expect(document.currentVersion.originalFilename).toBe(filename);
      // Recorded as declared, whatever it is: the type is a rendering
      // hint for M12 and never a gate on what may be stored.
      expect(document.currentVersion.mimeType).toBe(contentType);
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
    expect(entry!.payload.versionId).toBe(document.currentVersion.id);
    // The title survives the rows, because hard deletion (DOC-010)
    // will not.
    expect(entry!.payload.title).toBe("draft_v1.pdf");
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
    expect(rows.every((row) => row.currentVersion.versionNumber === 1)).toBe(true);
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

    const res = await download(adminCookies, document.id, document.currentVersion.id);

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

    const res = await download(adminCookies, document.id, document.currentVersion.id);

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

    const res = await download(adminCookies, one.id, two.currentVersion.id);

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

    const file = await download(contributorCookies, document.id, document.currentVersion.id);
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

    const file = await download(strangerCookies, document.id, document.currentVersion.id);
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

    const file = await download(outsiderCookies, document.id, document.currentVersion.id);
    expect(file.statusCode).toBe(404);
    expect(file.json().detail).not.toContain("nightingale");

    const write = await upload(outsiderCookies, contract.number);
    const missingWrite = await upload(outsiderCookies, NEVER_CREATED);
    expect(write.statusCode).toBe(missingWrite.statusCode);
    expect(withoutInstance(write.json())).toEqual(withoutInstance(missingWrite.json()));
    expect(write.statusCode).toBe(404);
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
    const file = await download(adminCookies, document.id, document.currentVersion.id);
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
    expect(res.json().document.currentVersion.byteSize).toBe(LIMIT - 1);
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
