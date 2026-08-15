// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A contract's folders (M13/2) at the HTTP seam: create one, create one
 * inside another, rename it, move it under a different parent, and
 * dissolve it.
 *
 * The whole path runs through injected requests against real Postgres
 * and the committed migrations — nothing is mocked, and nothing here
 * reads a table to find out what happened. Every assertion is what the
 * routes answered, because how the tree is stored is not what M13
 * promises: the promise is that the record's folders come back as one
 * set, in one order, with one row per folder.
 *
 * The three invariants are the second subject, and each is asserted at
 * the seam rather than trusted (DOC-008's pattern): a parent on another
 * contract, a move that would put a folder inside itself, and a sibling
 * name already taken are each refused. The name rules and the depth
 * ceiling are refused beside them. The sibling rule is the one that
 * matters furthest downstream — it is what makes a folder drop's
 * find-or-create deterministic (DOC-011) — so it is asserted with case
 * as well, because that is the reading the sort already takes.
 *
 * Access is the third subject, and it is written the M10 way. A viewer
 * who cannot reach the owning contract must get, on the list and on
 * every write alike, exactly the answer a contract that was never
 * created gives. Each refusal is therefore asserted twice — once at a
 * walled record and once at an address nothing was ever made under — and
 * the two answers must be one answer.
 *
 * Narration is the fourth (DD-017). Each of the four manual acts writes
 * one record-tier entry, and each payload carries the folder's name, so
 * the entry still says what happened after a rename or a delete has
 * taken the name off the row.
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
  email: "folders-member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;
/** A Legal Team Member with no team row: they read every open contract,
 * and nothing of a confidential one (DD-014). */
const OUTSIDER = {
  email: "folders-outsider@example.com",
  displayName: "Otto Outsider",
  password: "correct-horse-battery",
} as const;
/** A Contributor on the team: reads the tree (DD-015, CTR-021), and
 * does not organize it until M23. */
const CONTRIBUTOR = {
  email: "folders-contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery",
} as const;
/** A Contributor on no team: as invisible as the record is to them. */
const STRANGER = {
  email: "folders-stranger@example.com",
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
  createdAt: string;
  updatedAt: string;
}

/** A number nothing was ever created under — the control every refusal
 * is compared against. */
const NEVER_CREATED = 999_999;

/** A well-formed id no folder was ever created under, for the same
 * job one level down. */
const NO_SUCH_FOLDER = "01920000-0000-7000-8000-0000000000fb";

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

/** Freezes a record (SET-003, CTR-021), through the route that does it. */
async function archiveContract(number: number): Promise<void> {
  const res = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/archive`,
    cookies: adminCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
}

const listFolders = (cookies: Record<string, string>, number: number) =>
  harness.app.inject({
    method: "GET",
    url: `/api/v1/contracts/${number}/folders`,
    cookies,
  });

const createFolder = (
  cookies: Record<string, string>,
  number: number,
  body: Record<string, unknown>,
) =>
  harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/folders`,
    cookies,
    payload: body,
  });

const patchFolder = (
  cookies: Record<string, string>,
  folderId: string,
  body: Record<string, unknown>,
) =>
  harness.app.inject({
    method: "PATCH",
    url: `/api/v1/folders/${folderId}`,
    cookies,
    payload: body,
  });

const deleteFolder = (cookies: Record<string, string>, folderId: string) =>
  harness.app.inject({ method: "DELETE", url: `/api/v1/folders/${folderId}`, cookies });

/** Creates a folder, requiring success, and answers the row it made. */
async function made(
  number: number,
  name: string,
  parentId?: string,
  cookies = adminCookies,
): Promise<FolderRow> {
  const res = await createFolder(cookies, number, {
    name,
    ...(parentId ? { parentId } : {}),
  });
  expect(res.statusCode, res.body).toBe(201);
  const folder = (res.json().folders as FolderRow[]).find(
    (row) => row.name === name && row.parentId === (parentId ?? null),
  );
  expect(folder, `the folder named ${name}`).toBeDefined();
  return folder!;
}

/** The record's folders as the list route answers them. */
async function folders(cookies: Record<string, string>, number: number): Promise<FolderRow[]> {
  const res = await listFolders(cookies, number);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().folders as FolderRow[];
}

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

describe("creating a folder", () => {
  it("puts a folder at the record root and answers the record's whole set", async () => {
    const contract = await newContract("Orion Cloud — the first folder");

    const res = await createFolder(adminCookies, contract.number, { name: "Executed" });

    expect(res.statusCode, res.body).toBe(201);
    const created = res.json().folders as FolderRow[];
    expect(created).toHaveLength(1);
    expect(created[0]!.name).toBe("Executed");
    expect(created[0]!.parentId).toBeNull();
    // What the write answered is what the next load draws.
    expect(await folders(adminCookies, contract.number)).toEqual(created);
  });

  it("puts a folder inside another one", async () => {
    const contract = await newContract("Orion Cloud — the nested folder");
    const parent = await made(contract.number, "Correspondence");

    const child = await made(contract.number, "2026", parent.id);

    expect(child.parentId).toBe(parent.id);
  });

  it("trims the name before it stores it", async () => {
    const contract = await newContract("Orion Cloud — the padded name");

    const res = await createFolder(adminCookies, contract.number, { name: "  Schedules  " });

    expect(res.statusCode, res.body).toBe(201);
    // An edge space would sort and compare as a name nobody typed, so
    // the seam takes it off rather than storing it.
    expect((res.json().folders as FolderRow[])[0]!.name).toBe("Schedules");
  });

  it("orders siblings by name without case, the way a file manager lists a directory", async () => {
    const contract = await newContract("Orion Cloud — the sorted tree");
    for (const name of ["Executed", "Amendments", "correspondence"]) {
      await made(contract.number, name);
    }

    // "correspondence" is deliberately lower case and belongs between
    // the two capitalized names — a case-sensitive sort would put it
    // last (DES-033).
    expect((await folders(adminCookies, contract.number)).map((row) => row.name)).toEqual([
      "Amendments",
      "correspondence",
      "Executed",
    ]);
  });

  it("refuses a blank name, an over-long one, and one holding a separator", async () => {
    const contract = await newContract("Orion Cloud — the bad names");

    for (const name of ["", "   ", "a".repeat(256), "2026/Executed", "2026\\Executed"]) {
      const res = await createFolder(adminCookies, contract.number, { name });
      expect(res.statusCode, name).toBe(400);
    }
    expect(await folders(adminCookies, contract.number)).toEqual([]);
  });

  it("refuses a sibling name already taken, whatever its case", async () => {
    const contract = await newContract("Orion Cloud — the twin folders");
    await made(contract.number, "Executed");

    const res = await createFolder(adminCookies, contract.number, { name: "executed" });

    // 409, and the answer names what is in the way — the sibling rule is
    // what makes a folder drop's find-or-create deterministic (DOC-011),
    // so it holds without regard to case.
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().detail).toContain("executed");
    expect(await folders(adminCookies, contract.number)).toHaveLength(1);
  });

  it("takes the same name in two different parents", async () => {
    const contract = await newContract("Orion Cloud — the two 2026s");
    const first = await made(contract.number, "Correspondence");
    const second = await made(contract.number, "Amendments");

    await made(contract.number, "2026", first.id);
    await made(contract.number, "2026", second.id);

    // Uniqueness is per parent, not per record: a year folder under
    // each of two groupings is exactly what folders are for.
    expect(
      (await folders(adminCookies, contract.number)).filter((row) => row.name === "2026"),
    ).toHaveLength(2);
  });

  it("refuses a parent on another contract exactly as one that was never created", async () => {
    const mine = await newContract("Orion Cloud — my tree");
    const theirs = await newContract("Vega Systems — their tree");
    const elsewhere = await made(theirs.number, "Executed");

    const crossRecord = await createFolder(adminCookies, mine.number, {
      name: "2026",
      parentId: elsewhere.id,
    });
    const nowhere = await createFolder(adminCookies, mine.number, {
      name: "2026",
      parentId: NO_SUCH_FOLDER,
    });

    // A folder's id says nothing about which record it is on, so a
    // parent from another contract answers exactly as a parent that
    // does not exist — any other refusal would say the folder is there.
    expect(crossRecord.statusCode).toBe(404);
    expect(withoutInstance(crossRecord.json())).toEqual(withoutInstance(nowhere.json()));
    expect(await folders(adminCookies, mine.number)).toEqual([]);
  });

  it("refuses a folder deeper than the tree's ceiling", async () => {
    const contract = await newContract("Orion Cloud — the deep tree");
    let parent: FolderRow | undefined;
    // Ten levels is the ceiling, so ten are made and the eleventh is
    // refused.
    for (let level = 1; level <= 10; level += 1) {
      parent = await made(contract.number, `level-${level}`, parent?.id);
    }

    const res = await createFolder(adminCookies, contract.number, {
      name: "level-11",
      parentId: parent!.id,
    });

    expect(res.statusCode, res.body).toBe(409);
    expect(await folders(adminCookies, contract.number)).toHaveLength(10);
  });
});

describe("renaming and moving a folder", () => {
  it("renames a folder in place", async () => {
    const contract = await newContract("Orion Cloud — the rename");
    const folder = await made(contract.number, "Corespondence");

    const res = await patchFolder(adminCookies, folder.id, { name: "Correspondence" });

    expect(res.statusCode, res.body).toBe(200);
    const [renamed] = res.json().folders as FolderRow[];
    expect(renamed!.id).toBe(folder.id);
    expect(renamed!.name).toBe("Correspondence");
    expect(renamed!.parentId).toBeNull();
  });

  it("moves a folder under a different parent", async () => {
    const contract = await newContract("Orion Cloud — the move");
    const amendments = await made(contract.number, "Amendments");
    const misfiled = await made(contract.number, "2026");

    const res = await patchFolder(adminCookies, misfiled.id, { parentId: amendments.id });

    expect(res.statusCode, res.body).toBe(200);
    const moved = (res.json().folders as FolderRow[]).find((row) => row.id === misfiled.id);
    expect(moved!.parentId).toBe(amendments.id);
  });

  it("moves a folder back out to the record root", async () => {
    const contract = await newContract("Orion Cloud — the promotion");
    const amendments = await made(contract.number, "Amendments");
    const child = await made(contract.number, "2026", amendments.id);

    const res = await patchFolder(adminCookies, child.id, { parentId: null });

    expect(res.statusCode, res.body).toBe(200);
    const moved = (res.json().folders as FolderRow[]).find((row) => row.id === child.id);
    // Null is the move to the root, and it is a different request from
    // omitting the field, which moves nothing at all.
    expect(moved!.parentId).toBeNull();
  });

  it("leaves the parent alone when the request names only a name", async () => {
    const contract = await newContract("Orion Cloud — the rename in place");
    const amendments = await made(contract.number, "Amendments");
    const child = await made(contract.number, "2025", amendments.id);

    const res = await patchFolder(adminCookies, child.id, { name: "2026" });

    expect(res.statusCode, res.body).toBe(200);
    const renamed = (res.json().folders as FolderRow[]).find((row) => row.id === child.id);
    expect(renamed!.name).toBe("2026");
    expect(renamed!.parentId).toBe(amendments.id);
  });

  it("refuses a move that would put a folder inside itself", async () => {
    const contract = await newContract("Orion Cloud — the self-move");
    const folder = await made(contract.number, "Executed");

    const res = await patchFolder(adminCookies, folder.id, { parentId: folder.id });

    expect(res.statusCode, res.body).toBe(409);
    expect((await folders(adminCookies, contract.number))[0]!.parentId).toBeNull();
  });

  it("refuses a move that would put a folder inside its own descendant", async () => {
    const contract = await newContract("Orion Cloud — the cycle");
    const grandparent = await made(contract.number, "Correspondence");
    const parent = await made(contract.number, "2026", grandparent.id);
    const child = await made(contract.number, "Q1", parent.id);

    const res = await patchFolder(adminCookies, grandparent.id, { parentId: child.id });

    // The chain would have closed on itself, and the whole subtree would
    // have left the tree with it.
    expect(res.statusCode, res.body).toBe(409);
    const after = await folders(adminCookies, contract.number);
    expect(after.find((row) => row.id === grandparent.id)!.parentId).toBeNull();
  });

  it("refuses a move onto a sibling name already taken", async () => {
    const contract = await newContract("Orion Cloud — the crowded destination");
    const amendments = await made(contract.number, "Amendments");
    await made(contract.number, "2026", amendments.id);
    const loose = await made(contract.number, "2026");

    const res = await patchFolder(adminCookies, loose.id, { parentId: amendments.id });

    expect(res.statusCode, res.body).toBe(409);
    expect(
      (await folders(adminCookies, contract.number)).find((row) => row.id === loose.id)!.parentId,
    ).toBeNull();
  });

  it("lets a folder keep its own name when nothing else changes", async () => {
    const contract = await newContract("Orion Cloud — the no-op rename");
    const folder = await made(contract.number, "Executed");

    // The row must not collide with itself, which is the whole reason
    // the sibling check excludes the row being written.
    const res = await patchFolder(adminCookies, folder.id, { name: "Executed" });

    expect(res.statusCode, res.body).toBe(200);
  });

  it("refuses a move that would push the subtree past the ceiling", async () => {
    const contract = await newContract("Orion Cloud — the deep move");
    // A chain of nine at the root, and a chain of two beside it. Moving
    // the two under the ninth would make eleven.
    let deep: FolderRow | undefined;
    for (let level = 1; level <= 9; level += 1) {
      deep = await made(contract.number, `level-${level}`, deep?.id);
    }
    const top = await made(contract.number, "loose");
    await made(contract.number, "under-loose", top.id);

    const res = await patchFolder(adminCookies, top.id, { parentId: deep!.id });

    // The move carries the whole subtree, so the ceiling is asked about
    // the deepest folder underneath rather than about the moved row.
    expect(res.statusCode, res.body).toBe(409);
    expect(
      (await folders(adminCookies, contract.number)).find((row) => row.id === top.id)!.parentId,
    ).toBeNull();
  });

  it("refuses a parent on another contract exactly as one that was never created", async () => {
    const mine = await newContract("Orion Cloud — my move");
    const theirs = await newContract("Vega Systems — their destination");
    const folder = await made(mine.number, "Executed");
    const elsewhere = await made(theirs.number, "Executed");

    const crossRecord = await patchFolder(adminCookies, folder.id, { parentId: elsewhere.id });
    const nowhere = await patchFolder(adminCookies, folder.id, { parentId: NO_SUCH_FOLDER });

    expect(crossRecord.statusCode).toBe(404);
    expect(withoutInstance(crossRecord.json())).toEqual(withoutInstance(nowhere.json()));
  });

  it("refuses a request that names neither a name nor a parent", async () => {
    const contract = await newContract("Orion Cloud — the empty patch");
    const folder = await made(contract.number, "Executed");

    expect((await patchFolder(adminCookies, folder.id, {})).statusCode).toBe(400);
  });
});

describe("deleting a folder", () => {
  it("dissolves a folder and re-files its children into its parent", async () => {
    const contract = await newContract("Orion Cloud — the dissolve");
    const correspondence = await made(contract.number, "Correspondence");
    const year = await made(contract.number, "2026", correspondence.id);
    const quarter = await made(contract.number, "Q1", year.id);

    const res = await deleteFolder(adminCookies, year.id);

    expect(res.statusCode, res.body).toBe(200);
    const after = res.json().folders as FolderRow[];
    expect(after.map((row) => row.id)).not.toContain(year.id);
    // Q1 moved up into what held its own parent — nothing was
    // destroyed, and the grandchild kept its place in the tree.
    expect(after.find((row) => row.id === quarter.id)!.parentId).toBe(correspondence.id);
  });

  it("re-files a root folder's children to the record root", async () => {
    const contract = await newContract("Orion Cloud — the root dissolve");
    const correspondence = await made(contract.number, "Correspondence");
    const year = await made(contract.number, "2026", correspondence.id);

    expect((await deleteFolder(adminCookies, correspondence.id)).statusCode).toBe(200);

    const after = await folders(adminCookies, contract.number);
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(year.id);
    expect(after[0]!.parentId).toBeNull();
  });

  it("refuses a delete that would put two folders of one name in one place", async () => {
    const contract = await newContract("Orion Cloud — the collision");
    const amendments = await made(contract.number, "Amendments");
    await made(contract.number, "2026");
    await made(contract.number, "2026", amendments.id);

    const res = await deleteFolder(adminCookies, amendments.id);

    // Re-filing is the only thing a delete does to the children, and it
    // cannot break the sibling rule. Refused rather than resolved by
    // inventing a name nobody chose.
    expect(res.statusCode, res.body).toBe(409);
    expect(await folders(adminCookies, contract.number)).toHaveLength(3);
  });

  it("deletes an empty folder", async () => {
    const contract = await newContract("Orion Cloud — the empty dissolve");
    const folder = await made(contract.number, "Executed");

    expect((await deleteFolder(adminCookies, folder.id)).statusCode).toBe(200);
    expect(await folders(adminCookies, contract.number)).toEqual([]);
  });
});

describe("narrating folder work (DD-017)", () => {
  it("writes one entry per act, each carrying the folder's name", async () => {
    const contract = await newContract("Orion Cloud — the narrated tree");
    const amendments = await made(contract.number, "Amendments");
    const folder = await made(contract.number, "Corespondence");
    expect(
      (await patchFolder(adminCookies, folder.id, { name: "Correspondence" })).statusCode,
    ).toBe(200);
    expect(
      (await patchFolder(adminCookies, folder.id, { parentId: amendments.id })).statusCode,
    ).toBe(200);
    expect((await deleteFolder(adminCookies, folder.id)).statusCode).toBe(200);

    const entries = await feed(adminCookies, contract.id);
    const created = entries.find(
      (entry) => entry.action === "folder.created" && entry.payload.folderId === folder.id,
    );
    const renamed = entries.find((entry) => entry.action === "folder.renamed");
    const moved = entries.find((entry) => entry.action === "folder.moved");
    const deleted = entries.find((entry) => entry.action === "folder.deleted");

    expect(created?.payload.name).toBe("Corespondence");
    expect(renamed?.payload.previousName).toBe("Corespondence");
    expect(renamed?.payload.name).toBe("Correspondence");
    expect(moved?.payload.parentName).toBe("Amendments");
    // The row is gone, so the entry is the only thing left that says
    // what was dissolved.
    expect(deleted?.payload.name).toBe("Correspondence");
  });

  it("writes no entry for a request that changed nothing", async () => {
    const contract = await newContract("Orion Cloud — the idle patch");
    const folder = await made(contract.number, "Executed");

    expect((await patchFolder(adminCookies, folder.id, { name: "Executed" })).statusCode).toBe(200);

    const entries = await feed(adminCookies, contract.id);
    expect(entries.filter((entry) => entry.action === "folder.renamed")).toEqual([]);
  });
});

describe("who may reach a contract's folders", () => {
  it("lets a Contributor on the team read the tree", async () => {
    const contract = await newContract("Orion Cloud — the Contributor's tree");
    await putOnTeam(contract.number, idOf(CONTRIBUTOR), "contributor");
    await made(contract.number, "Executed");

    expect((await folders(contributorCookies, contract.number)).map((row) => row.name)).toEqual([
      "Executed",
    ]);
  });

  it("refuses a Contributor's folder writes without hiding the record from them", async () => {
    const contract = await newContract("Orion Cloud — the Contributor's pen");
    await putOnTeam(contract.number, idOf(CONTRIBUTOR), "contributor");
    const folder = await made(contract.number, "Executed");

    // 403, not 404: they can already see the record, so a
    // missing-record answer would only make a real boundary read as a
    // bug. Their write grid arrives with M23 (DD-015).
    expect(
      (await createFolder(contributorCookies, contract.number, { name: "Drafts" })).statusCode,
    ).toBe(403);
    expect((await patchFolder(contributorCookies, folder.id, { name: "Signed" })).statusCode).toBe(
      403,
    );
    expect((await deleteFolder(contributorCookies, folder.id)).statusCode).toBe(403);
  });

  it("answers a Contributor who is not on the contract as it answers for one that does not exist", async () => {
    const contract = await newContract("Orion Cloud — the stranger's tree");
    await made(contract.number, "Executed");

    const walled = await listFolders(strangerCookies, contract.number);
    const missing = await listFolders(strangerCookies, NEVER_CREATED);

    expect(walled.statusCode).toBe(missing.statusCode);
    expect(withoutInstance(walled.json())).toEqual(withoutInstance(missing.json()));
  });

  it("answers every folder route for a walled record exactly as for one that was never created", async () => {
    const contract = await newContract("Project Nightingale — the tree");
    await putOnTeam(contract.number, idOf(MEMBER), "member");
    const folder = await made(contract.number, "Board papers");
    await markConfidential(contract.number);

    // The included side still sees it whole.
    expect((await folders(memberCookies, contract.number)).map((row) => row.name)).toEqual([
      "Board papers",
    ]);

    // The excluded side gets the answer a contract that does not exist
    // gives — on the list and on the create alike.
    const list = await listFolders(outsiderCookies, contract.number);
    const missingList = await listFolders(outsiderCookies, NEVER_CREATED);
    expect(list.statusCode).toBe(404);
    expect(withoutInstance(list.json())).toEqual(withoutInstance(missingList.json()));

    const create = await createFolder(outsiderCookies, contract.number, { name: "Drafts" });
    const missingCreate = await createFolder(outsiderCookies, NEVER_CREATED, { name: "Drafts" });
    expect(create.statusCode).toBe(404);
    expect(withoutInstance(create.json())).toEqual(withoutInstance(missingCreate.json()));

    // And the same one level down, at the folder's own address: a
    // folder's id says nothing about which record it is on.
    const rename = await patchFolder(outsiderCookies, folder.id, { name: "Seen it" });
    const missingRename = await patchFolder(outsiderCookies, NO_SUCH_FOLDER, { name: "Seen it" });
    expect(rename.statusCode).toBe(404);
    expect(withoutInstance(rename.json())).toEqual(withoutInstance(missingRename.json()));
    expect(rename.json().detail).not.toContain("Board papers");

    const removal = await deleteFolder(outsiderCookies, folder.id);
    const missingRemoval = await deleteFolder(outsiderCookies, NO_SUCH_FOLDER);
    expect(removal.statusCode).toBe(404);
    expect(withoutInstance(removal.json())).toEqual(withoutInstance(missingRemoval.json()));
  });

  it("refuses every folder write on an archived contract and still reads the tree", async () => {
    const contract = await newContract("Orion Cloud — the frozen tree");
    const folder = await made(contract.number, "Executed");
    await archiveContract(contract.number);

    // A frozen record's paper stays frozen, organization included.
    expect((await createFolder(adminCookies, contract.number, { name: "Drafts" })).statusCode).toBe(
      409,
    );
    expect((await patchFolder(adminCookies, folder.id, { name: "Signed" })).statusCode).toBe(409);
    expect((await deleteFolder(adminCookies, folder.id)).statusCode).toBe(409);
    // Archiving freezes a record; it does not hide it.
    expect((await folders(adminCookies, contract.number)).map((row) => row.name)).toEqual([
      "Executed",
    ]);
  });
});
