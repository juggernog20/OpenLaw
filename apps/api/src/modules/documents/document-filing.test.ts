// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Filing a document into a folder (M13/3) at the HTTP seam: a document
 * moves into a folder and back out to the record root, a folder's
 * documents are read through the list route filtered to it, and every
 * folder answers how much is filed in it.
 *
 * The whole path runs through injected requests against real Postgres,
 * the committed migrations, and the real local storage driver — nothing
 * is mocked, and nothing here reads a table to find out what happened.
 * Every assertion is what the routes answered.
 *
 * **Silent omission is the subject that carries a promise** (DD-014). A
 * confidential document a viewer is outside the audience of is left out
 * of the folder's listing *and* out of the folder's count, by the same
 * predicate every document read already passes through. The consequence
 * is asserted deliberately: the folder the outsider reads is
 * indistinguishable from one that is genuinely empty.
 *
 * **The shared-owner invariant is the second** (DOC-008). A document's
 * folder must belong to the document's own record, and a folder on
 * another contract is answered exactly as one that was never created —
 * a folder's id says nothing about which record it is on, so any other
 * refusal would be the leak the 404 prevents.
 *
 * Access is written the M10 way: each refusal is asserted twice, once at
 * a walled record and once at an address nothing was ever made under,
 * and the two answers must be one answer.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

/** A Legal Team Member on the contract's team: the included viewer a
 * walled-off record is compared against. */
const MEMBER = {
  email: "filing-member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;
/** A Legal Team Member with no team row: they read every open contract,
 * and nothing a confidential document holds (DD-014). */
const OUTSIDER = {
  email: "filing-outsider@example.com",
  displayName: "Otto Outsider",
  password: "correct-horse-battery",
} as const;
/** A Contributor on the team: reads the tree and the paper in it, and
 * files nothing until M23. */
const CONTRIBUTOR = {
  email: "filing-contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery",
} as const;
/** A Contributor on no team: as invisible as the record is to them. */
const STRANGER = {
  email: "filing-stranger@example.com",
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

interface FolderRow {
  id: string;
  name: string;
  parentId: string | null;
  documentCount: number;
}

interface DocumentRow {
  id: string;
  title: string;
  folderId: string | null;
  archivedAt: string | null;
  versions: { id: string }[];
}

/** A number nothing was ever created under — the control every refusal
 * is compared against. */
const NEVER_CREATED = 999_999;

/** A well-formed id no folder was ever created under, for the same job
 * one level down. */
const NO_SUCH_FOLDER = "01920000-0000-7000-8000-0000000000fc";

/** And a well-formed id no document was ever created under. */
const NO_SUCH_DOCUMENT = "01920000-0000-7000-8000-0000000000fd";

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
});

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

/** Freezes a record (SET-003, CTR-021), through the route that does it. */
async function archiveContract(number: number): Promise<void> {
  const res = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/archive`,
    cookies: adminCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
}

const BOUNDARY = "openlaw-test-boundary-66696c65";

/**
 * A one-file `multipart/form-data` body, built by hand.
 *
 * Filing is not about what the upload carries, so this is the smallest
 * form the route accepts: one file part and nothing else.
 */
function uploadForm(filename: string): {
  payload: Buffer;
  headers: Record<string, string>;
} {
  const payload = Buffer.concat([
    Buffer.from(`--${BOUNDARY}\r\n`),
    Buffer.from(
      `content-disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `content-type: application/pdf\r\n\r\n`,
    ),
    Buffer.from(`the bytes of ${filename}`),
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);
  return {
    payload,
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

/** Uploads one file to a record, requiring success. The form carries no
 * folder, so every document here starts at the record root — which is
 * what this suite wants, because it exercises filing as the edit it is
 * rather than as the destination an upload can now carry itself. */
async function uploaded(
  number: number,
  filename: string,
  cookies = adminCookies,
): Promise<DocumentRow> {
  const { payload, headers } = uploadForm(filename);
  const res = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/documents`,
    cookies,
    headers,
    payload,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().document as DocumentRow;
}

const createFolder = (number: number, body: Record<string, unknown>, cookies = adminCookies) =>
  harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/folders`,
    cookies,
    payload: body,
  });

/** Creates a folder, requiring success, and answers the row it made. */
async function made(number: number, name: string, parentId?: string): Promise<FolderRow> {
  const res = await createFolder(number, { name, ...(parentId ? { parentId } : {}) });
  expect(res.statusCode, res.body).toBe(201);
  const folder = (res.json().folders as FolderRow[]).find(
    (row) => row.name === name && row.parentId === (parentId ?? null),
  );
  expect(folder, `the folder named ${name}`).toBeDefined();
  return folder!;
}

/** The record's folders as the list route answers them, counts and all. */
async function folders(cookies: Record<string, string>, number: number): Promise<FolderRow[]> {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/contracts/${number}/folders`,
    cookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().folders as FolderRow[];
}

/** How much one folder says is filed in it, for the viewer asking. */
async function countOf(
  cookies: Record<string, string>,
  number: number,
  folderId: string,
): Promise<number> {
  const folder = (await folders(cookies, number)).find((row) => row.id === folderId);
  expect(folder, "the folder").toBeDefined();
  return folder!.documentCount;
}

/** The paper on a record, as the list route answers it. `folder` is the
 * listing context: omitted for the whole record, `root` for the
 * documents filed nowhere, or a folder's own id. */
const listDocuments = (
  cookies: Record<string, string>,
  number: number,
  query: Readonly<{ folder?: string; cursor?: string; includeArchived?: boolean }> = {},
) => {
  const search = new URLSearchParams();
  if (query.folder !== undefined) search.set("folder", query.folder);
  if (query.cursor !== undefined) search.set("cursor", query.cursor);
  if (query.includeArchived) search.set("includeArchived", "true");
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  return harness.app.inject({
    method: "GET",
    url: `/api/v1/contracts/${number}/documents${suffix}`,
    cookies,
  });
};

/** The titles one listing context answers, in the order it answered
 * them. */
async function titlesIn(
  cookies: Record<string, string>,
  number: number,
  folder?: string,
): Promise<string[]> {
  const res = await listDocuments(cookies, number, folder === undefined ? {} : { folder });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json().documents as DocumentRow[]).map((row) => row.title);
}

/** Files a document, or moves it back to the record root — the raw
 * answer, because the refusals are as much the subject as the moves. */
const fileInto = (cookies: Record<string, string>, documentId: string, folderId: string | null) =>
  harness.app.inject({
    method: "PATCH",
    url: `/api/v1/documents/${documentId}`,
    cookies,
    payload: { folderId },
  });

/** Files a document, requiring success. */
async function filed(documentId: string, folderId: string | null): Promise<DocumentRow> {
  const res = await fileInto(adminCookies, documentId, folderId);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().document as DocumentRow;
}

const deleteFolder = (cookies: Record<string, string>, folderId: string) =>
  harness.app.inject({ method: "DELETE", url: `/api/v1/folders/${folderId}`, cookies });

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

/** `instance` is the URL the client itself asked for, so it is the one
 * field two refusals at two addresses cannot share. Everything else in
 * the problem body must be identical. */
const withoutInstance = (body: Record<string, unknown>) => ({ ...body, instance: undefined });

describe("filing a document into a folder", () => {
  it("files a document into a folder and answers the row filed there", async () => {
    const contract = await newContract("Orion Cloud — the first filing");
    const folder = await made(contract.number, "Executed");
    const document = await uploaded(contract.number, "signed.pdf");
    expect(document.folderId).toBeNull();

    const moved = await filed(document.id, folder.id);

    expect(moved.folderId).toBe(folder.id);
    // What the write answered is what the next load draws.
    expect(await titlesIn(adminCookies, contract.number, folder.id)).toEqual(["signed.pdf"]);
  });

  it("moves a filed document back out to the record root", async () => {
    const contract = await newContract("Orion Cloud — the unfiling");
    const folder = await made(contract.number, "Executed");
    const document = await uploaded(contract.number, "signed.pdf");
    await filed(document.id, folder.id);

    const moved = await filed(document.id, null);

    expect(moved.folderId).toBeNull();
    expect(await titlesIn(adminCookies, contract.number, folder.id)).toEqual([]);
    expect(await titlesIn(adminCookies, contract.number, "root")).toEqual(["signed.pdf"]);
  });

  it("leaves the folder alone when the body names no folder at all", async () => {
    const contract = await newContract("Orion Cloud — the untouched filing");
    const folder = await made(contract.number, "Executed");
    const document = await uploaded(contract.number, "signed.pdf");
    await filed(document.id, folder.id);

    // Omitting the field is a different request from sending null: one
    // moves nothing, the other moves the document to the record root.
    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/documents/${document.id}`,
      cookies: adminCookies,
      payload: { title: "The signed copy" },
    });

    expect(res.statusCode, res.body).toBe(200);
    expect((res.json().document as DocumentRow).folderId).toBe(folder.id);
  });

  it("refuses a folder on another contract exactly as one that was never created", async () => {
    const here = await newContract("Orion Cloud — the filing contract");
    const elsewhere = await newContract("Orion Cloud — the other contract");
    const theirs = await made(elsewhere.number, "Executed");
    const document = await uploaded(here.number, "signed.pdf");

    const crossRecord = await fileInto(adminCookies, document.id, theirs.id);
    const neverCreated = await fileInto(adminCookies, document.id, NO_SUCH_FOLDER);

    expect(crossRecord.statusCode, crossRecord.body).toBe(404);
    expect(neverCreated.statusCode, neverCreated.body).toBe(404);
    // A folder's id says nothing about which record it is on, so the two
    // answers must be one answer.
    expect(withoutInstance(crossRecord.json())).toEqual(withoutInstance(neverCreated.json()));
    // And nothing moved.
    expect(await titlesIn(adminCookies, elsewhere.number, theirs.id)).toEqual([]);
  });

  it("refuses filing on an archived contract", async () => {
    const contract = await newContract("Orion Cloud — the frozen filing");
    const folder = await made(contract.number, "Executed");
    const document = await uploaded(contract.number, "signed.pdf");
    await archiveContract(contract.number);

    const res = await fileInto(adminCookies, document.id, folder.id);

    expect(res.statusCode, res.body).toBe(409);
    expect(await titlesIn(adminCookies, contract.number, folder.id)).toEqual([]);
  });

  it("refuses a Contributor plainly, because they can already see the row", async () => {
    const contract = await newContract("Orion Cloud — the contributor's filing");
    await putOnTeam(contract.number, idOf(CONTRIBUTOR), "contributor");
    const folder = await made(contract.number, "Executed");
    const document = await uploaded(contract.number, "signed.pdf");

    const res = await fileInto(contributorCookies, document.id, folder.id);

    expect(res.statusCode, res.body).toBe(403);
  });

  it("writes one record-tier entry naming the folder it went into", async () => {
    const contract = await newContract("Orion Cloud — the narrated filing");
    const folder = await made(contract.number, "Executed");
    const document = await uploaded(contract.number, "signed.pdf");

    await filed(document.id, folder.id);

    const entries = await feed(adminCookies, contract.id);
    const filings = entries.filter((entry) => entry.action === "document.filed");
    expect(filings).toHaveLength(1);
    // The name rather than the id, so the entry still says what happened
    // after a rename or a delete has taken the folder's name away.
    expect(filings[0]!.payload.folderName).toBe("Executed");
    expect(filings[0]!.payload.title).toBe("signed.pdf");
    expect(filings[0]!.payload.previousFolderName).toBeNull();
  });

  it("narrates the move back out to the record root as its own entry", async () => {
    const contract = await newContract("Orion Cloud — the narrated unfiling");
    const folder = await made(contract.number, "Executed");
    const document = await uploaded(contract.number, "signed.pdf");
    await filed(document.id, folder.id);

    await filed(document.id, null);

    const filings = (await feed(adminCookies, contract.id)).filter(
      (entry) => entry.action === "document.filed",
    );
    expect(filings).toHaveLength(2);
    // Newest first, as the feed reads.
    expect(filings[0]!.payload.folderName).toBeNull();
    expect(filings[0]!.payload.previousFolderName).toBe("Executed");
  });

  it("writes nothing when the document is already in the folder it was sent to", async () => {
    const contract = await newContract("Orion Cloud — the filing that changed nothing");
    const folder = await made(contract.number, "Executed");
    const document = await uploaded(contract.number, "signed.pdf");
    await filed(document.id, folder.id);

    await filed(document.id, folder.id);

    const filings = (await feed(adminCookies, contract.id)).filter(
      (entry) => entry.action === "document.filed",
    );
    expect(filings).toHaveLength(1);
  });
});

describe("reading a folder's documents", () => {
  it("answers only what is filed in the folder that was named", async () => {
    const contract = await newContract("Orion Cloud — the folder listing");
    const executed = await made(contract.number, "Executed");
    const schedules = await made(contract.number, "Schedules");
    const signed = await uploaded(contract.number, "signed.pdf");
    const schedule = await uploaded(contract.number, "schedule-a.pdf");
    await uploaded(contract.number, "loose.pdf");
    await filed(signed.id, executed.id);
    await filed(schedule.id, schedules.id);

    expect(await titlesIn(adminCookies, contract.number, executed.id)).toEqual(["signed.pdf"]);
    expect(await titlesIn(adminCookies, contract.number, schedules.id)).toEqual(["schedule-a.pdf"]);
    // The record root is the documents filed nowhere, and nothing else.
    expect(await titlesIn(adminCookies, contract.number, "root")).toEqual(["loose.pdf"]);
  });

  it("still answers the record's whole paper when no folder is named", async () => {
    const contract = await newContract("Orion Cloud — the unfiltered listing");
    const folder = await made(contract.number, "Executed");
    const signed = await uploaded(contract.number, "signed.pdf");
    await uploaded(contract.number, "loose.pdf");
    await filed(signed.id, folder.id);

    // Newest document first, as the record's section reads.
    expect(await titlesIn(adminCookies, contract.number)).toEqual(["loose.pdf", "signed.pdf"]);
  });

  it("pages within the folder it was asked about", async () => {
    const contract = await newContract("Orion Cloud — the folder page");
    const folder = await made(contract.number, "Executed");
    for (let index = 0; index < 3; index += 1) {
      const document = await uploaded(contract.number, `filed-${index}.pdf`);
      await filed(document.id, folder.id);
    }
    await uploaded(contract.number, "loose.pdf");

    const first = await listDocuments(adminCookies, contract.number, { folder: folder.id });
    expect(first.statusCode, first.body).toBe(200);
    const page = first.json() as { documents: DocumentRow[]; nextCursor: string | null };
    // Three documents fit one page, so the foot has nothing to offer —
    // the cursor is the position in *this* listing, not in the record.
    expect(page.documents.map((row) => row.title)).toEqual([
      "filed-2.pdf",
      "filed-1.pdf",
      "filed-0.pdf",
    ]);
    expect(page.nextCursor).toBeNull();

    // A cursor from the folder's own listing stays inside it.
    const next = await listDocuments(adminCookies, contract.number, {
      folder: folder.id,
      cursor: page.documents[0]!.id,
    });
    expect(next.statusCode, next.body).toBe(200);
    expect((next.json().documents as DocumentRow[]).map((row) => row.title)).toEqual([
      "filed-1.pdf",
      "filed-0.pdf",
    ]);
  });

  it("leaves an archived document out of a folder's listing until it is asked for", async () => {
    const contract = await newContract("Orion Cloud — the archived filing");
    const folder = await made(contract.number, "Executed");
    const document = await uploaded(contract.number, "signed.pdf");
    await filed(document.id, folder.id);
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/documents/${document.id}/archive`,
      cookies: adminCookies,
    });
    expect(archived.statusCode, archived.body).toBe(200);

    expect(await titlesIn(adminCookies, contract.number, folder.id)).toEqual([]);
    const withArchived = await listDocuments(adminCookies, contract.number, {
      folder: folder.id,
      includeArchived: true,
    });
    expect(withArchived.statusCode, withArchived.body).toBe(200);
    expect((withArchived.json().documents as DocumentRow[]).map((row) => row.title)).toEqual([
      "signed.pdf",
    ]);
  });

  it("refuses a folder on another contract exactly as one that was never created", async () => {
    const here = await newContract("Orion Cloud — the listing contract");
    const elsewhere = await newContract("Orion Cloud — the other listing contract");
    const theirs = await made(elsewhere.number, "Executed");

    const crossRecord = await listDocuments(adminCookies, here.number, { folder: theirs.id });
    const neverCreated = await listDocuments(adminCookies, here.number, {
      folder: NO_SUCH_FOLDER,
    });

    expect(crossRecord.statusCode, crossRecord.body).toBe(404);
    expect(neverCreated.statusCode, neverCreated.body).toBe(404);
    expect(withoutInstance(crossRecord.json())).toEqual(withoutInstance(neverCreated.json()));
  });
});

describe("a folder's count", () => {
  it("counts what is filed directly in it and nothing else", async () => {
    const contract = await newContract("Orion Cloud — the counted folder");
    const parent = await made(contract.number, "Correspondence");
    const child = await made(contract.number, "2026", parent.id);
    const letter = await uploaded(contract.number, "letter.pdf");
    const reply = await uploaded(contract.number, "reply.pdf");
    await uploaded(contract.number, "loose.pdf");
    await filed(letter.id, parent.id);
    await filed(reply.id, child.id);

    // The count states what the listing will show, so a document filed
    // one level down is that folder's, not this one's.
    expect(await countOf(adminCookies, contract.number, parent.id)).toBe(1);
    expect(await countOf(adminCookies, contract.number, child.id)).toBe(1);
  });

  it("reads zero on a folder nothing is filed in", async () => {
    const contract = await newContract("Orion Cloud — the empty folder");
    const folder = await made(contract.number, "Signature packets");

    expect(await countOf(adminCookies, contract.number, folder.id)).toBe(0);
  });

  it("moves as documents are filed and archived", async () => {
    const contract = await newContract("Orion Cloud — the live count");
    const folder = await made(contract.number, "Executed");
    const document = await uploaded(contract.number, "signed.pdf");

    await filed(document.id, folder.id);
    expect(await countOf(adminCookies, contract.number, folder.id)).toBe(1);

    // Off the list and out of the count is what archiving means
    // (DOC-010), inside a folder as on the record.
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/documents/${document.id}/archive`,
      cookies: adminCookies,
    });
    expect(archived.statusCode, archived.body).toBe(200);
    expect(await countOf(adminCookies, contract.number, folder.id)).toBe(0);
  });
});

describe("silent omission inside a folder", () => {
  it("leaves a confidential document out of the listing and out of the count", async () => {
    const contract = await newContract("Orion Cloud — the walled filing");
    await putOnTeam(contract.number, idOf(MEMBER), "member");
    const folder = await made(contract.number, "Executed");
    const walled = await uploaded(contract.number, "walled.pdf");
    const open = await uploaded(contract.number, "open.pdf");
    await filed(walled.id, folder.id);
    await filed(open.id, folder.id);
    const flagged = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/documents/${walled.id}`,
      cookies: adminCookies,
      payload: { isConfidential: true },
    });
    expect(flagged.statusCode, flagged.body).toBe(200);

    // Inside the audience: both documents, and a count that says two.
    expect(await titlesIn(memberCookies, contract.number, folder.id)).toEqual([
      "open.pdf",
      "walled.pdf",
    ]);
    expect(await countOf(memberCookies, contract.number, folder.id)).toBe(2);

    // Outside it: one document, and a count that says one. The count is
    // taken through the same predicate the listing is, so it cannot
    // announce what the listing left out.
    expect(await titlesIn(outsiderCookies, contract.number, folder.id)).toEqual(["open.pdf"]);
    expect(await countOf(outsiderCookies, contract.number, folder.id)).toBe(1);
  });

  it("makes a folder whose contents are hidden read exactly as an empty one", async () => {
    const contract = await newContract("Orion Cloud — the indistinguishable folders");
    const hidden = await made(contract.number, "Walled");
    const empty = await made(contract.number, "Empty");
    const walled = await uploaded(contract.number, "walled.pdf");
    await filed(walled.id, hidden.id);
    const flagged = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/documents/${walled.id}`,
      cookies: adminCookies,
      payload: { isConfidential: true },
    });
    expect(flagged.statusCode, flagged.body).toBe(200);

    const seen = await folders(outsiderCookies, contract.number);
    const hiddenRow = seen.find((row) => row.id === hidden.id);
    const emptyRow = seen.find((row) => row.id === empty.id);

    // DD-014's promise, held at the folder row: the one holding a
    // document this viewer may not see must be indistinguishable from
    // the one holding nothing at all.
    expect(hiddenRow?.documentCount).toBe(0);
    expect(emptyRow?.documentCount).toBe(0);
    expect(await titlesIn(outsiderCookies, contract.number, hidden.id)).toEqual([]);
    expect(await titlesIn(outsiderCookies, contract.number, empty.id)).toEqual([]);
  });
});

describe("dissolving a folder that holds documents", () => {
  it("re-files its documents into its parent and destroys nothing", async () => {
    const contract = await newContract("Orion Cloud — the dissolved parent");
    const parent = await made(contract.number, "Correspondence");
    const child = await made(contract.number, "2026", parent.id);
    const document = await uploaded(contract.number, "letter.pdf");
    await filed(document.id, child.id);

    const res = await deleteFolder(adminCookies, child.id);

    expect(res.statusCode, res.body).toBe(200);
    // The count comes back on the answer, so the tree redraws from what
    // the delete said rather than from a second read.
    const set = res.json().folders as FolderRow[];
    expect(set.find((row) => row.id === parent.id)?.documentCount).toBe(1);
    expect(await titlesIn(adminCookies, contract.number, parent.id)).toEqual(["letter.pdf"]);
  });

  it("re-files a root folder's documents onto the record itself", async () => {
    const contract = await newContract("Orion Cloud — the dissolved root folder");
    const folder = await made(contract.number, "Executed");
    const document = await uploaded(contract.number, "signed.pdf");
    await filed(document.id, folder.id);

    const res = await deleteFolder(adminCookies, folder.id);

    expect(res.statusCode, res.body).toBe(200);
    expect(await titlesIn(adminCookies, contract.number, "root")).toEqual(["signed.pdf"]);
  });

  it("re-files an archived document too, and one the deleter cannot see", async () => {
    const contract = await newContract("Orion Cloud — the dissolved walled folder");
    await putOnTeam(contract.number, idOf(MEMBER), "member");
    const folder = await made(contract.number, "Executed");
    const walled = await uploaded(contract.number, "walled.pdf");
    const gone = await uploaded(contract.number, "archived.pdf");
    await filed(walled.id, folder.id);
    await filed(gone.id, folder.id);
    for (const [documentId, payload] of [
      [walled.id, { isConfidential: true }],
      [gone.id, null],
    ] as const) {
      const res = payload
        ? await harness.app.inject({
            method: "PATCH",
            url: `/api/v1/documents/${documentId}`,
            cookies: adminCookies,
            payload,
          })
        : await harness.app.inject({
            method: "POST",
            url: `/api/v1/documents/${documentId}/archive`,
            cookies: adminCookies,
          });
      expect(res.statusCode, res.body).toBe(200);
    }

    // Dissolving is a fact about the record's organization, not a read:
    // every document in the folder moves, including the archived one and
    // the one the Member is inside the audience of but an outsider is
    // not. Leaving a row behind would orphan it.
    const res = await deleteFolder(memberCookies, folder.id);

    expect(res.statusCode, res.body).toBe(200);
    const root = await listDocuments(memberCookies, contract.number, {
      folder: "root",
      includeArchived: true,
    });
    expect(root.statusCode, root.body).toBe(200);
    expect((root.json().documents as DocumentRow[]).map((row) => row.title).sort()).toEqual([
      "archived.pdf",
      "walled.pdf",
    ]);
  });
});

describe("a filed document behaves exactly as an unfiled one", () => {
  it("hard-deletes from inside a folder and leaves the folder standing", async () => {
    const contract = await newContract("Orion Cloud — the erased filing");
    const folder = await made(contract.number, "Executed");
    const document = await uploaded(contract.number, "signed.pdf");
    await filed(document.id, folder.id);

    const res = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/documents/${document.id}`,
      cookies: adminCookies,
      payload: { confirmTitle: "signed.pdf" },
    });

    expect(res.statusCode, res.body).toBe(200);
    // DOC-010 destroys the document, never the grouping it sat in.
    expect(await titlesIn(adminCookies, contract.number, folder.id)).toEqual([]);
    expect(await countOf(adminCookies, contract.number, folder.id)).toBe(0);
  });

  it("downloads from inside a folder exactly as from the record root", async () => {
    const contract = await newContract("Orion Cloud — the filed download");
    const folder = await made(contract.number, "Executed");
    const document = await uploaded(contract.number, "signed.pdf");
    const versionId = document.versions[0]!.id;
    const download = () =>
      harness.app.inject({
        method: "GET",
        url: `/api/v1/documents/${document.id}/versions/${versionId}/download`,
        cookies: adminCookies,
      });
    const before = await download();
    expect(before.statusCode, before.body).toBe(200);

    await filed(document.id, folder.id);

    const after = await download();
    expect(after.statusCode, after.body).toBe(200);
    // The same bytes, from the same address: filing is a fact about
    // where a document sits, and nothing about the files behind it.
    expect(after.rawPayload.equals(before.rawPayload)).toBe(true);
  });
});

describe("a record this viewer cannot reach", () => {
  it("answers a folder-filtered read as one that was never created", async () => {
    const walled = await newContract("Orion Cloud — the walled folder read");
    await markConfidential(walled.number);
    const folder = await made(walled.number, "Executed");

    const outside = await listDocuments(outsiderCookies, walled.number, { folder: folder.id });
    const nowhere = await listDocuments(outsiderCookies, NEVER_CREATED, { folder: folder.id });

    expect(outside.statusCode, outside.body).toBe(404);
    expect(nowhere.statusCode, nowhere.body).toBe(404);
    expect(withoutInstance(outside.json())).toEqual(withoutInstance(nowhere.json()));
  });

  it("answers a folder-filtered read to a Contributor off the team the same way", async () => {
    const contract = await newContract("Orion Cloud — the stranger's folder read");
    const folder = await made(contract.number, "Executed");

    const outside = await listDocuments(strangerCookies, contract.number, { folder: folder.id });
    const nowhere = await listDocuments(strangerCookies, NEVER_CREATED, { folder: folder.id });

    // A Contributor reads the records they are on and nothing else. The
    // read floor lets them in, so reach is what refuses them — and it
    // has to refuse identically at both addresses.
    expect(outside.statusCode, outside.body).toBe(404);
    expect(nowhere.statusCode, nowhere.body).toBe(404);
    expect(withoutInstance(outside.json())).toEqual(withoutInstance(nowhere.json()));
  });

  it("answers a filing as one that was never created", async () => {
    const walled = await newContract("Orion Cloud — the walled filing write");
    const folder = await made(walled.number, "Executed");
    const document = await uploaded(walled.number, "signed.pdf");
    await markConfidential(walled.number);

    // A Legal Team Member with no team row: the role would let them
    // file, so the only thing refusing them is reach — which is what
    // this asserts. A Contributor is refused 403 before reach is ever
    // asked, because writing is Member+ and they can already see the
    // records they are on.
    const outside = await fileInto(outsiderCookies, document.id, folder.id);
    const nowhere = await fileInto(outsiderCookies, NO_SUCH_DOCUMENT, folder.id);

    expect(outside.statusCode, outside.body).toBe(404);
    expect(nowhere.statusCode, nowhere.body).toBe(404);
    expect(withoutInstance(outside.json())).toEqual(withoutInstance(nowhere.json()));
  });
});
