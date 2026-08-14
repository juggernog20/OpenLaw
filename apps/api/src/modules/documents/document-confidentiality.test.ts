// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The per-document Confidential flag (M11/6, DD-014, DOC-008) at the
 * HTTP seam.
 *
 * The viewer this suite is about is new again. M10's was a Legal Team
 * Member outside a walled-off **contract**. This one reaches the
 * contract perfectly well — it is open, and they read every other thing
 * on it — and is outside the audience of **one file** on it. Everything
 * below is about what that person is answered.
 *
 * **The answer is always "there is no such document."** Not a refusal,
 * not a placeholder, not a gap in a count. The suite asserts that the
 * M10 way: every refusal is sent twice, once at the confidential
 * document and once at an id nothing was ever created under, and the two
 * problem bodies must be one body. A test that only asserted "404" would
 * pass on a 404 that said the wrong thing.
 *
 * **The two gates compose, and neither replaces the other.** A viewer
 * must pass the owning contract's gate and then the document's. The
 * suite sends the same viewer at both failures — a confidential document
 * on an open contract, and an open document on a confidential contract —
 * and requires the same answer from each.
 *
 * **The audience is the contract's, because a document has no team.**
 * The contract's named team, the contract's Owner, and Administrators —
 * and nobody else, whatever their role. An Administrator sees every
 * document on every contract, DD-014's rule with no exception, one level
 * down.
 *
 * **The actor set is narrower than the audience.** An Administrator, the
 * person who uploaded the document, and the contract's Owner may set the
 * flag and clear it. A team Member who is none of the three reads the
 * file and is refused the flag with a plain 403: they can already see
 * it, so a 404 would hide nothing and would read as a bug.
 *
 * The feed is the last subject. Every documents entry carries the
 * document's title, so that the record still says what was erased after
 * the rows are gone — which means an entry naming a confidential
 * document would say the file is there. Those entries are left out of
 * the page, at query time, for anybody outside the audience.
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

/** On the contract's team, and the person who uploads every document
 * here: DD-014's "creator", one level down. */
const UPLOADER = {
  email: "docconfi-uploader@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;
/** On the team, and neither the uploader nor the Owner. They read a
 * confidential document like everyone else the contract names, and they
 * may not decide who else does. */
const TEAMMATE = {
  email: "docconfi-teammate@example.com",
  displayName: "Tomas Teammate",
  password: "correct-horse-battery",
} as const;
/** The contract's Owner (CTR-004) with no team row. The flag must never
 * take a file away from the person accountable for the record. */
const OWNER = {
  email: "docconfi-owner@example.com",
  displayName: "Priya Owner",
  password: "correct-horse-battery",
} as const;
/** The viewer M11/6 is about: a Legal Team Member who reaches the open
 * contract and is outside one document's audience. */
const OUTSIDER = {
  email: "docconfi-outsider@example.com",
  displayName: "Otto Outsider",
  password: "correct-horse-battery",
} as const;
/** A Contributor on the team. They are named by the contract, so they
 * are inside a confidential document's audience — the flag never
 * narrows below the team row that is their whole grant. */
const CONTRIBUTOR = {
  email: "docconfi-contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;
let uploaderCookies: Record<string, string>;
let teammateCookies: Record<string, string>;
let ownerCookies: Record<string, string>;
let outsiderCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
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
  isCurrent: boolean;
}

interface DocumentRow {
  id: string;
  title: string;
  isPrimary: boolean;
  isConfidential: boolean;
  archivedAt: string | null;
  versions: VersionRow[];
}

interface FeedEntry {
  action: string;
  payload: Record<string, unknown>;
}

/** An id nothing was ever created under — the control every refusal is
 * compared against. Well-formed and opaque, because the routes assert no
 * UUID pattern and a document a viewer cannot reach must answer exactly
 * as this does. */
const NEVER_CREATED = "0198f2ab-0000-7000-8000-00000000dead";

/** A contract number nothing was ever created under. */
const NEVER_CREATED_NUMBER = 999_999;

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
    [UPLOADER, "legal_team_member"],
    [TEAMMATE, "legal_team_member"],
    [OWNER, "legal_team_member"],
    [OUTSIDER, "legal_team_member"],
    [CONTRIBUTOR, "contributor"],
  ] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, user.id));
    userIds.set(fixture.email, user.id);
  }
  adminCookies = await signInCookies(harness.app, ADMIN.email, ADMIN.password);
  uploaderCookies = await signInCookies(harness.app, UPLOADER.email, UPLOADER.password);
  teammateCookies = await signInCookies(harness.app, TEAMMATE.email, TEAMMATE.password);
  ownerCookies = await signInCookies(harness.app, OWNER.email, OWNER.password);
  outsiderCookies = await signInCookies(harness.app, OUTSIDER.email, OUTSIDER.password);
  contributorCookies = await signInCookies(harness.app, CONTRIBUTOR.email, CONTRIBUTOR.password);
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

/** Names the Owner (CTR-004). Assigning the Owner writes no team row,
 * which is exactly why the Owner needs a clause of their own. */
async function setOwner(number: number, userId: string): Promise<void> {
  const res = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/contracts/${number}`,
    cookies: adminCookies,
    payload: { managerId: userId },
  });
  expect(res.statusCode, res.body).toBe(200);
}

/** Walls the whole contract off (M10's flag), requiring success. */
async function markContractConfidential(number: number): Promise<void> {
  const res = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/contracts/${number}`,
    cookies: adminCookies,
    payload: { isConfidential: true },
  });
  expect(res.statusCode, res.body).toBe(200);
}

const BOUNDARY = "openlaw-test-boundary-4d6f636b";

/** One multipart upload, built by hand: the seam reads `kind` out of
 * the fields the parser has already seen, so the order is part of what
 * the upload is. */
function uploadBody(filename: string): { payload: Buffer; headers: Record<string, string> } {
  const payload = Buffer.concat([
    Buffer.from(`--${BOUNDARY}\r\n`),
    Buffer.from('content-disposition: form-data; name="kind"\r\n\r\ndraft_ours\r\n'),
    Buffer.from(`--${BOUNDARY}\r\n`),
    Buffer.from(
      `content-disposition: form-data; name="file"; filename="${filename}"\r\n` +
        "content-type: text/plain\r\n\r\n",
    ),
    Buffer.from(`the bytes of ${filename}`),
    Buffer.from("\r\n"),
    Buffer.from(`--${BOUNDARY}--\r\n`),
  ]);
  return { payload, headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` } };
}

/** Uploads one document to a contract, requiring success. */
async function uploaded(
  cookies: Record<string, string>,
  number: number,
  filename: string,
): Promise<DocumentRow> {
  const { payload, headers } = uploadBody(filename);
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

/** The raw answer to a document patch — the refusals are as much the
 * subject here as the successes. */
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

/** Sets or clears the flag, requiring success and the answered state. */
async function setFlag(
  cookies: Record<string, string>,
  documentId: string,
  isConfidential: boolean,
): Promise<DocumentRow> {
  const res = await patchDocument(cookies, documentId, { isConfidential });
  expect(res.statusCode, res.body).toBe(200);
  const document = res.json().document as DocumentRow;
  expect(document.isConfidential).toBe(isConfidential);
  return document;
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
async function feed(cookies: Record<string, string>, contractId: string): Promise<FeedEntry[]> {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/activity?entityType=contract&entityId=${contractId}`,
    cookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().entries as FeedEntry[];
}

/** The flag's entries in the Administrator's audit log, oldest first. It
 * reads every tier with no record scope, so it is where DD-014's
 * accountability requirement is checked. The route takes no record
 * filter, so the record is picked out of the page here. */
async function flagEntriesInAuditLog(
  contractId: string,
): Promise<{ action: string; actor: { id: string } | null; createdAt: string }[]> {
  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/audit-log?entityType=contract",
    cookies: adminCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  const entries = res.json().entries as {
    action: string;
    entityId: string | null;
    actor: { id: string } | null;
    createdAt: string;
  }[];
  return entries
    .filter((entry) => entry.entityId === contractId)
    .filter((entry) => entry.action.startsWith("document.confidentiality"))
    .reverse();
}

/** The version the chain pins. Required rather than found-if-present: a
 * document with no current version is a broken record. */
function currentOf(document: DocumentRow): VersionRow {
  const current = document.versions.filter((version) => version.isCurrent);
  expect(current.length, "exactly one current version").toBe(1);
  return current[0]!;
}

/** `instance` is the URL the client itself asked for, so it is the one
 * field two refusals at two addresses cannot share. Everything else in
 * the problem body must be identical. */
const withoutInstance = (body: Record<string, unknown>) => ({ ...body, instance: undefined });

/** One mutation seam, as a name and a call that can be aimed at any
 * document id — so the same write can be sent at the confidential
 * document and at an id nothing was ever created under, and the two
 * answers compared. */
type Mutation = readonly [what: string, against: (documentId: string) => Promise<InjectedAnswer>];

/** What `app.inject` answers, as this suite reads it. */
interface InjectedAnswer {
  statusCode: number;
  body: string;
  headers: Record<string, unknown>;
  json: () => Record<string, unknown>;
}

/**
 * Every mutation a document has, aimed at whoever holds these cookies:
 * the metadata patch (each field it commits, the flag itself, and an
 * empty body), the next version, the two CTR-014 designations and the
 * pin's clear, and DOC-010's archive and restore.
 *
 * The ids and values are real. Past the reach question every one of them
 * would be answered on the document's own terms — most would land, and
 * the rest would carry the document's own refusal, which is a different
 * answer from the missing-document 404 this matrix requires. So a wrong
 * refusal cannot pass as the right one.
 *
 * DOC-010's hard delete is not here, and its absence is the decision: it
 * is Administrator-only, and an Administrator is never outside a
 * document's audience (DD-014). There is nobody to aim it with.
 */
function everyMutation(cookies: Record<string, string>, versionId: string): Mutation[] {
  return [
    ["the metadata patch: the title", (id) => patchDocument(cookies, id, { title: "Renamed" })],
    [
      "the metadata patch: the description",
      (id) => patchDocument(cookies, id, { description: "Written from outside" }),
    ],
    ["the metadata patch: nothing at all", (id) => patchDocument(cookies, id, {})],
    ["the flag itself", (id) => patchDocument(cookies, id, { isConfidential: false })],
    [
      "the next version",
      (id) => {
        const { payload, headers } = uploadBody("outside.txt");
        return harness.app.inject({
          method: "POST",
          url: `/api/v1/documents/${id}/versions`,
          cookies,
          headers,
          payload,
        });
      },
    ],
    [
      "the primary designation",
      (id) =>
        harness.app.inject({ method: "POST", url: `/api/v1/documents/${id}/primary`, cookies }),
    ],
    [
      "the executed pin",
      (id) =>
        harness.app.inject({
          method: "POST",
          url: `/api/v1/documents/${id}/executed-version`,
          cookies,
          payload: { versionId },
        }),
    ],
    [
      "the executed pin's clear",
      (id) =>
        harness.app.inject({
          method: "DELETE",
          url: `/api/v1/documents/${id}/executed-version`,
          cookies,
        }),
    ],
    [
      "the archive",
      (id) =>
        harness.app.inject({ method: "POST", url: `/api/v1/documents/${id}/archive`, cookies }),
    ],
    [
      "the restore",
      (id) =>
        harness.app.inject({ method: "POST", url: `/api/v1/documents/${id}/restore`, cookies }),
    ],
  ];
}

/**
 * One open contract with a confidential document on it, and a second
 * document left open beside it.
 *
 * The open contract is the point. M10 already covers a walled-off
 * record; the file M11/6 adds is one that is narrowed **inside** a
 * record everybody can open, so the outsider here reaches the contract,
 * reads the second document, and must be answered as though the first
 * had never been uploaded.
 */
async function recordWithAWalledFile(title: string): Promise<{
  contract: ContractRow;
  walled: DocumentRow;
  open: DocumentRow;
}> {
  const contract = await newContract(title);
  await putOnTeam(contract.number, idOf(UPLOADER), "member");
  await putOnTeam(contract.number, idOf(TEAMMATE), "member");
  await putOnTeam(contract.number, idOf(CONTRIBUTOR), "contributor");
  await setOwner(contract.number, idOf(OWNER));
  const open = await uploaded(uploaderCookies, contract.number, "open-schedule.txt");
  const walled = await uploaded(uploaderCookies, contract.number, "board-memo.txt");
  await setFlag(uploaderCookies, walled.id, true);
  return { contract, walled, open };
}

describe("marking one document confidential (M11/6, DD-014)", () => {
  it("sets the flag and clears it again, leaving the file itself untouched", async () => {
    const contract = await newContract("Doc confi: set and clear");
    const document = await uploaded(adminCookies, contract.number, "memo.txt");
    expect(document.isConfidential).toBe(false);

    const walled = await setFlag(adminCookies, document.id, true);
    // The flag is a fact about who may read the record, and about
    // nothing else: the chain, the designation, and the bytes are
    // exactly where they were.
    expect(walled.versions.map((version) => version.id)).toEqual(
      document.versions.map((version) => version.id),
    );
    expect(walled.isPrimary).toBe(document.isPrimary);
    const opened = await setFlag(adminCookies, document.id, false);
    expect(opened.versions.map((version) => version.id)).toEqual(
      document.versions.map((version) => version.id),
    );
  });

  it("rides every answer a document comes back on, and is false until somebody sets it", async () => {
    const contract = await newContract("Doc confi: the column on every answer");
    const document = await uploaded(adminCookies, contract.number, "plain.txt");

    expect(document.isConfidential).toBe(false);
    const [listed] = await paper(adminCookies, contract.number);
    expect(listed?.isConfidential).toBe(false);
  });

  it("writes nothing when the flag is re-sent unchanged", async () => {
    const contract = await newContract("Doc confi: nothing changed");
    const document = await uploaded(adminCookies, contract.number, "unchanged.txt");

    await setFlag(adminCookies, document.id, false);
    expect(
      (await feed(adminCookies, contract.id)).filter((entry) =>
        entry.action.startsWith("document.confidentiality"),
      ),
    ).toEqual([]);
  });
});

describe("who may set and clear one document's flag (M11/6, CTR-022)", () => {
  it("lets the Administrator, the uploader, and the contract's Owner each set it and clear it", async () => {
    const contract = await newContract("Doc confi actors: the three who may");
    await putOnTeam(contract.number, idOf(UPLOADER), "member");
    await setOwner(contract.number, idOf(OWNER));
    const document = await uploaded(uploaderCookies, contract.number, "actors.txt");

    for (const [who, cookies] of [
      ["the Administrator", adminCookies],
      ["the uploader", uploaderCookies],
      ["the contract's Owner", ownerCookies],
    ] as const) {
      const set = await patchDocument(cookies, document.id, { isConfidential: true });
      expect(set.statusCode, `${who} set: ${set.body}`).toBe(200);
      const cleared = await patchDocument(cookies, document.id, { isConfidential: false });
      expect(cleared.statusCode, `${who} clear: ${cleared.body}`).toBe(200);
    }
  });

  it("refuses a team Member who is none of the three with a plain 403 — their sight of the file is not a secret", async () => {
    const { contract, walled } = await recordWithAWalledFile(
      "Doc confi actors: on the team, not an actor",
    );

    const refused = await patchDocument(teammateCookies, walled.id, { isConfidential: false });
    expect(refused.statusCode, refused.body).toBe(403);
    expect(refused.headers["content-type"]).toContain("application/problem+json");
    // The refusal says who may, so the reader knows where to go — and
    // says nothing about the document, which they can already see.
    expect(refused.json()).toMatchObject({
      status: 403,
      detail:
        "Only an Administrator, the person who uploaded this document, or " +
        "the contract's Owner can change this.",
    });
    // They still read the document they were refused the flag on, and
    // the flag is still set.
    const theirs = await paper(teammateCookies, contract.number);
    expect(theirs.find((row) => row.id === walled.id)?.isConfidential).toBe(true);
  });

  it("keeps a Contributor refused at the Member+ floor, flag or no flag", async () => {
    const { walled, contract } = await recordWithAWalledFile("Doc confi actors: below the floor");

    // The metadata patch is Member+ (DD-015), so a Contributor is
    // refused at the guard even though the contract names them and they
    // read the file. The flag widens nobody's reach and narrows nobody's
    // floor.
    const refused = await patchDocument(contributorCookies, walled.id, { isConfidential: false });
    expect(refused.statusCode, refused.body).toBe(403);
    expect(refused.body).not.toContain("board-memo.txt");
    expect((await paper(contributorCookies, contract.number)).map((row) => row.id)).toContain(
      walled.id,
    );
  });

  it("answers a viewer outside the document's audience with the missing-document 404, body for body", async () => {
    const { contract, walled } = await recordWithAWalledFile(
      "Doc confi actors: out of reach entirely",
    );

    const refused = await patchDocument(outsiderCookies, walled.id, { isConfidential: false });
    const absent = await patchDocument(outsiderCookies, NEVER_CREATED, { isConfidential: false });
    expect(refused.statusCode, refused.body).toBe(404);
    expect(refused.headers["content-type"]).toContain("application/problem+json");
    expect(withoutInstance(refused.json())).toEqual(withoutInstance(absent.json()));
    // The title is the thing that would leak. The id is not asserted
    // against: it is in the address the client itself asked for, so
    // `instance` echoes it back for a document that was never created
    // just the same — which is the whole reason `instance` is the one
    // field the two bodies are allowed to differ on.
    expect(refused.body).not.toContain("board-memo.txt");
    // And the flag they tried to clear is still set.
    const after = await paper(adminCookies, contract.number);
    expect(after.find((row) => row.id === walled.id)?.isConfidential).toBe(true);
  });

  it("refuses the flag on an archived contract, like every other edit", async () => {
    const contract = await newContract("Doc confi actors: archived and inert");
    const document = await uploaded(adminCookies, contract.number, "frozen.txt");
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/archive`,
      cookies: adminCookies,
    });
    expect(archived.statusCode, archived.body).toBe(200);

    const refused = await patchDocument(adminCookies, document.id, { isConfidential: true });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toMatchObject({
      status: 409,
      detail: "This contract is archived. Restore it before changing its paper.",
    });
  });
});

describe("who still reaches a confidential document (M11/6, DD-014)", () => {
  it("leaves the named team, the contract's Owner, and Administrators reading it as before", async () => {
    const { contract, walled, open } = await recordWithAWalledFile("Doc confi audience: who stays");

    for (const [who, cookies] of [
      ["the Administrator", adminCookies],
      ["the uploader", uploaderCookies],
      ["a team Member", teammateCookies],
      ["a Contributor on the team", contributorCookies],
      ["the Owner with no team row", ownerCookies],
    ] as const) {
      const theirs = await paper(cookies, contract.number);
      expect(theirs.map((row) => row.id).sort(), who).toEqual([open.id, walled.id].sort());
      const bytes = await download(cookies, walled.id, currentOf(walled).id);
      expect(bytes.statusCode, `${who}: ${bytes.body}`).toBe(200);
    }
  });

  it("gives an Administrator every document on every contract, walled record or walled file", async () => {
    const { contract, walled, open } = await recordWithAWalledFile("Doc confi audience: the Admin");
    // Both flags at once: the record walled off and the file inside it
    // walled off again. DD-014's Administrator rule has no exception at
    // either level.
    await markContractConfidential(contract.number);

    expect((await paper(adminCookies, contract.number)).map((row) => row.id).sort()).toEqual(
      [open.id, walled.id].sort(),
    );
    expect((await download(adminCookies, walled.id, currentOf(walled).id)).statusCode).toBe(200);
  });

  it("lets an uploader who is on no team wall themselves out of their own file", async () => {
    const contract = await newContract("Doc confi audience: walled out of their own upload");
    // No team row and not the Owner: this Legal Team Member reaches the
    // open contract by their role alone (CTR-021), and uploading grants
    // them nothing further — there is no document team (DOC-008).
    const theirs = await uploaded(outsiderCookies, contract.number, "self-sealed.txt");

    // They are the uploader, so the flag is theirs to set (CTR-022) —
    // and setting it puts the file outside their own audience. The
    // write answers with the row, because it is their own write and a
    // 404 on a successful one would read as a failure.
    const set = await patchDocument(outsiderCookies, theirs.id, { isConfidential: true });
    expect(set.statusCode, set.body).toBe(200);
    expect((set.json().document as DocumentRow).isConfidential).toBe(true);

    // From the next request on, it is gone for them — and there is no
    // way back to it, because clearing the flag needs the document they
    // can no longer reach. An Administrator or the record's Owner is
    // who opens it again, which is DD-014's answer by design.
    expect(await paper(outsiderCookies, contract.number)).toEqual([]);
    const refused = await patchDocument(outsiderCookies, theirs.id, { isConfidential: false });
    expect(refused.statusCode, refused.body).toBe(404);
    // The Administrator sees it exactly as before.
    expect((await paper(adminCookies, contract.number)).map((row) => row.id)).toEqual([theirs.id]);
  });

  it("takes the file away the moment the viewer's last team row comes off", async () => {
    const contract = await newContract("Doc confi audience: the row that was taken back");
    await putOnTeam(contract.number, idOf(TEAMMATE), "member");
    const walled = await uploaded(adminCookies, contract.number, "revoked.txt");
    await setFlag(adminCookies, walled.id, true);

    expect((await paper(teammateCookies, contract.number)).map((row) => row.id)).toEqual([
      walled.id,
    ]);

    const removed = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/contracts/${contract.number}/team/${idOf(TEAMMATE)}/member`,
      cookies: adminCookies,
    });
    expect(removed.statusCode, removed.body).toBe(200);

    // The predicate reads the rows live, so the next request is already
    // answered without the file — and the contract is still open, so
    // they still read the record itself.
    expect(await paper(teammateCookies, contract.number)).toEqual([]);
    expect((await download(teammateCookies, walled.id, currentOf(walled).id)).statusCode).toBe(404);
  });
});

describe("the access matrix for a viewer outside one document's audience (M11/6)", () => {
  it("leaves the document out of the list, and out of the count taken from it", async () => {
    const { contract, walled, open } = await recordWithAWalledFile("Doc confi matrix: the list");

    const theirs = await paper(outsiderCookies, contract.number);
    // Not the row, not the id, not a gap. The section's count is
    // `documents.length`, so a row left out here is out of the count by
    // construction — there is no separate number to scrub.
    expect(theirs.map((row) => row.id)).toEqual([open.id]);
    expect(theirs.length).toBe(1);
    expect((await paper(uploaderCookies, contract.number)).length).toBe(2);
    // And not in the archived view either, which is the other list.
    expect((await paper(outsiderCookies, contract.number, true)).map((row) => row.id)).toEqual([
      open.id,
    ]);

    const raw = await listDocuments(outsiderCookies, contract.number);
    expect(raw.body).not.toContain(walled.id);
    expect(raw.body).not.toContain("board-memo.txt");
  });

  it("answers the download exactly as it answers for a version that was never uploaded", async () => {
    const { walled } = await recordWithAWalledFile("Doc confi matrix: the download");
    const versionId = currentOf(walled).id;

    const refused = await download(outsiderCookies, walled.id, versionId);
    const absent = await download(outsiderCookies, NEVER_CREATED, versionId);
    expect(refused.statusCode, refused.body).toBe(404);
    expect(refused.headers["content-type"]).toContain("application/problem+json");
    expect(withoutInstance(refused.json())).toEqual(withoutInstance(absent.json()));
    expect(refused.body).not.toContain("board-memo.txt");
  });

  it("answers every mutation exactly as it answers for a document that was never created", async () => {
    const { contract, walled, open } = await recordWithAWalledFile("Doc confi matrix: the writes");

    for (const [what, against] of everyMutation(outsiderCookies, currentOf(walled).id)) {
      const refused = await against(walled.id);
      const absent = await against(NEVER_CREATED);
      expect(refused.statusCode, `${what}: ${refused.body}`).toBe(404);
      expect(refused.headers["content-type"], what).toContain("application/problem+json");
      expect(withoutInstance(refused.json()), what).toEqual(withoutInstance(absent.json()));
      // The title, not the id: the id is in the address the client
      // asked for, and `instance` echoes it either way.
      expect(refused.body, what).not.toContain("board-memo.txt");
    }

    // Nothing landed. The record is as the uploader left it, down to
    // the flag, the instrument, and the chain.
    const after = await paper(adminCookies, contract.number, true);
    expect(after.map((row) => row.id).sort()).toEqual([open.id, walled.id].sort());
    const still = after.find((row) => row.id === walled.id)!;
    expect(still).toMatchObject({
      title: "board-memo.txt",
      isConfidential: true,
      archivedAt: null,
      isPrimary: false,
    });
    expect(still.versions.length).toBe(1);
  });

  it("refuses reach before it refuses the archived document, so a 409 never says the file is there", async () => {
    const { walled } = await recordWithAWalledFile("Doc confi matrix: archived and out of reach");
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/documents/${walled.id}/archive`,
      cookies: adminCookies,
    });
    expect(archived.statusCode, archived.body).toBe(200);

    // An archived document answers 409 to everybody who reaches it.
    // This viewer must never get that far.
    const refused = await patchDocument(outsiderCookies, walled.id, { title: "Renamed" });
    expect(refused.statusCode, refused.body).toBe(404);
    expect(refused.body).not.toContain("archived");
  });
});

describe("the two gates compose (M11/6, DOC-008)", () => {
  it("refuses a viewer who fails either one, in the same words", async () => {
    // The document's gate, on a contract everybody can open.
    const inside = await recordWithAWalledFile("Doc confi compose: the walled file");
    // The contract's gate, on a document nobody flagged.
    const outside = await newContract("Doc confi compose: the walled record");
    const openFile = await uploaded(adminCookies, outside.number, "on-a-walled-record.txt");
    await markContractConfidential(outside.number);

    const byDocument = await download(
      outsiderCookies,
      inside.walled.id,
      currentOf(inside.walled).id,
    );
    const byContract = await download(outsiderCookies, openFile.id, currentOf(openFile).id);
    const absent = await download(outsiderCookies, NEVER_CREATED, currentOf(openFile).id);

    for (const [what, refused] of [
      ["the document's gate", byDocument],
      ["the contract's gate", byContract],
    ] as const) {
      expect(refused.statusCode, `${what}: ${refused.body}`).toBe(404);
      expect(withoutInstance(refused.json()), what).toEqual(withoutInstance(absent.json()));
    }

    // And the list says the same thing from both sides: the open
    // contract answers the one file they may see, and the walled
    // contract answers as a contract that does not exist.
    expect((await paper(outsiderCookies, inside.contract.number)).map((row) => row.id)).toEqual([
      inside.open.id,
    ]);
    const walledList = await listDocuments(outsiderCookies, outside.number);
    const absentList = await listDocuments(outsiderCookies, NEVER_CREATED_NUMBER);
    expect(walledList.statusCode).toBe(404);
    expect(withoutInstance(walledList.json())).toEqual(withoutInstance(absentList.json()));
  });

  it("keeps a Contributor's grant to the team row, so the flag widens nothing", async () => {
    const contract = await newContract("Doc confi compose: the Contributor's own");
    const walled = await uploaded(adminCookies, contract.number, "not-theirs.txt");
    await setFlag(adminCookies, walled.id, false);

    // No team row: the contract is out of reach, so the document is
    // too, flag or no flag.
    const refused = await listDocuments(contributorCookies, contract.number);
    const absent = await listDocuments(contributorCookies, NEVER_CREATED_NUMBER);
    expect(refused.statusCode, refused.body).toBe(404);
    expect(withoutInstance(refused.json())).toEqual(withoutInstance(absent.json()));
  });
});

describe("what a set and a clear leave behind (M11/6, DD-017)", () => {
  it("writes its own action for each, in the record's feed and in the audit log", async () => {
    const contract = await newContract("Doc confi log: set then cleared");
    await putOnTeam(contract.number, idOf(UPLOADER), "member");
    const document = await uploaded(uploaderCookies, contract.number, "logged.txt");

    await setFlag(uploaderCookies, document.id, true);
    await setFlag(uploaderCookies, document.id, false);

    const entries = (await feed(uploaderCookies, contract.id)).filter((entry) =>
      entry.action.startsWith("document.confidentiality"),
    );
    // Newest first, as the feed reads.
    expect(entries.map((entry) => entry.action)).toEqual([
      "document.confidentiality_cleared",
      "document.confidentiality_set",
    ]);
    // Each names the document, because DOC-010's erasure takes the row
    // and the entry still has to say which file it was about.
    for (const entry of entries) {
      expect(entry.payload).toMatchObject({ documentId: document.id, title: "logged.txt" });
    }

    const audited = await flagEntriesInAuditLog(contract.id);
    expect(audited.map((entry) => entry.action)).toEqual([
      "document.confidentiality_set",
      "document.confidentiality_cleared",
    ]);
    for (const entry of audited) {
      expect(entry.actor?.id).toBe(idOf(UPLOADER));
      expect(Date.parse(entry.createdAt)).not.toBeNaN();
    }
  });

  it("keeps the flag out of the changed map, so it is a slug to filter on and not a key to hunt through", async () => {
    const contract = await newContract("Doc confi log: not an edit");
    const document = await uploaded(adminCookies, contract.number, "not-an-edit.txt");

    await setFlag(adminCookies, document.id, true);

    const edits = (await feed(adminCookies, contract.id)).filter(
      (entry) => entry.action === "document.updated",
    );
    expect(edits).toEqual([]);
  });
});

describe("the feed omits the entries that name a confidential document (M11/6, DD-017)", () => {
  it("leaves an outside viewer the record's other narrative and nothing about the walled file", async () => {
    const contract = await newContract("Doc confi feed: two documents, one walled");
    await putOnTeam(contract.number, idOf(UPLOADER), "member");
    const open = await uploaded(uploaderCookies, contract.number, "open-annex.txt");
    const walled = await uploaded(uploaderCookies, contract.number, "sealed-memo.txt");
    // A round on each, so the walled one has more than one entry to
    // leave out.
    const { payload, headers } = uploadBody("sealed-memo-v2.txt");
    const appended = await harness.app.inject({
      method: "POST",
      url: `/api/v1/documents/${walled.id}/versions`,
      cookies: uploaderCookies,
      headers,
      payload,
    });
    expect(appended.statusCode, appended.body).toBe(201);
    await setFlag(uploaderCookies, walled.id, true);

    const theirs = await feed(outsiderCookies, contract.id);
    // Not the upload, not the round, not the walling-off itself — that
    // last one is the entry that would say the loudest that a file is
    // there.
    expect(theirs.some((entry) => entry.payload.documentId === walled.id)).toBe(false);
    expect(JSON.stringify(theirs)).not.toContain("sealed-memo");
    // And the rest of the record's narrative is untouched: they still
    // read the open document's own entries.
    expect(theirs.some((entry) => entry.payload.documentId === open.id)).toBe(true);

    // The uploader, who is inside the audience, reads every one of them.
    const inside = await feed(uploaderCookies, contract.id);
    expect(inside.filter((entry) => entry.payload.documentId === walled.id).length).toBe(3);
  });

  it("keeps them hidden after the Administrator erases the document (DOC-010)", async () => {
    const contract = await newContract("Doc confi feed: erased and still sealed");
    await putOnTeam(contract.number, idOf(UPLOADER), "member");
    const walled = await uploaded(uploaderCookies, contract.number, "erased-memo.txt");
    await setFlag(uploaderCookies, walled.id, true);

    const erased = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/documents/${walled.id}`,
      cookies: adminCookies,
      payload: { confirmTitle: "erased-memo.txt" },
    });
    expect(erased.statusCode, erased.body).toBe(200);

    // The row is gone, so there is nothing left to ask whether the file
    // was confidential — and the entries all still carry its title. An
    // erasure must not be the moment a walled-off file's whole story
    // arrives in an outsider's feed.
    const theirs = await feed(outsiderCookies, contract.id);
    expect(theirs.some((entry) => entry.payload.documentId === walled.id)).toBe(false);
    expect(JSON.stringify(theirs)).not.toContain("erased-memo");

    // The named team still reads it, and so does the Administrator's
    // audit log — DOC-010's accountability is where it was.
    const inside = await feed(uploaderCookies, contract.id);
    expect(inside.some((entry) => entry.action === "document.hard_deleted")).toBe(true);
    const audit = await harness.app.inject({
      method: "GET",
      url: "/api/v1/audit-log?action=document.hard_deleted",
      cookies: adminCookies,
    });
    expect(audit.statusCode, audit.body).toBe(200);
    expect(
      (audit.json().entries as FeedEntry[]).some((entry) => entry.payload.documentId === walled.id),
    ).toBe(true);
  });

  it("omits a pin move whose old primary is the walled file — the entry names both documents", async () => {
    const contract = await newContract("Doc confi feed: the instrument moved off a walled file");
    await putOnTeam(contract.number, idOf(UPLOADER), "member");
    // The first upload takes the primary designation (CTR-014), so the
    // walled file is the instrument the move below leaves.
    const walled = await uploaded(uploaderCookies, contract.number, "sealed-instrument.txt");
    const open = await uploaded(uploaderCookies, contract.number, "open-successor.txt");
    await setFlag(uploaderCookies, walled.id, true);

    const pinned = await harness.app.inject({
      method: "POST",
      url: `/api/v1/documents/${open.id}/primary`,
      cookies: uploaderCookies,
    });
    expect(pinned.statusCode, pinned.body).toBe(200);

    // The move's entry says which document the designation left, title
    // and all — `fromDocumentId` and `from` — while its own documentId
    // is the open successor. The scope must ask about every document an
    // entry names, or this one entry hands an outsider the walled
    // file's title.
    const theirs = await feed(outsiderCookies, contract.id);
    expect(theirs.some((entry) => entry.action === "document.primary_set")).toBe(false);
    expect(JSON.stringify(theirs)).not.toContain("sealed-instrument");
    // The open successor's own story is still theirs to read.
    expect(theirs.some((entry) => entry.payload.documentId === open.id)).toBe(true);

    // The named team reads the move as it was written.
    const inside = await feed(uploaderCookies, contract.id);
    expect(
      inside.some(
        (entry) =>
          entry.action === "document.primary_set" && entry.payload.fromDocumentId === walled.id,
      ),
    ).toBe(true);
  });

  it("hides the entries the moment the flag is set, and shows them again when it is cleared", async () => {
    const contract = await newContract("Doc confi feed: set then cleared again");
    const document = await uploaded(adminCookies, contract.number, "toggled.txt");

    const named = async () =>
      (await feed(outsiderCookies, contract.id)).filter(
        (entry) => entry.payload.documentId === document.id,
      ).length;

    expect(await named()).toBeGreaterThan(0);
    await setFlag(adminCookies, document.id, true);
    expect(await named()).toBe(0);
    await setFlag(adminCookies, document.id, false);
    // Everything comes back, the two flag entries included: clearing
    // the flag puts the file back inside the contract's own audience.
    expect(await named()).toBeGreaterThan(0);
  });

  it("leaves every entry that is not about a document exactly where it was", async () => {
    const contract = await newContract("Doc confi feed: the record's own entries");
    const document = await uploaded(adminCookies, contract.number, "beside-the-record.txt");
    await setFlag(adminCookies, document.id, true);
    const renamed = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${contract.number}`,
      cookies: adminCookies,
      payload: { title: "Doc confi feed: renamed" },
    });
    expect(renamed.statusCode, renamed.body).toBe(200);

    const theirs = await feed(outsiderCookies, contract.id);
    // The record's own history is untouched by a document-level flag.
    // An entry with no documentId in its payload compares against NULL,
    // which no row equals.
    expect(theirs.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(["contract.created", "contract.updated"]),
    );
  });
});
