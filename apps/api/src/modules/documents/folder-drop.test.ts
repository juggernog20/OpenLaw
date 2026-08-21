// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Folder drop (M13/5, DOC-011) at the HTTP seam: the demo sentence, made
 * to work.
 *
 * A drop is not a new endpoint. It is N ordinary uploads, each carrying
 * where it goes, plus a create per empty directory of the dropped tree.
 * So everything below is asserted against the two routes that already
 * existed, and what is under test is the destination they now take.
 *
 * **Convergence is the subject.** The whole promise of a folder drop is
 * that a legacy book arrives filed the way it was organized — and a
 * client uploading with bounded concurrency really does send several
 * files carrying one path at the same moment. If find-or-create raced,
 * that book would arrive in two folders of one name. So the central test
 * here fires genuinely concurrent uploads on one path, in M11's
 * concurrent-append pattern, and asserts the record ends with exactly
 * one folder per segment.
 *
 * **A refusal is per file.** A path that misuses the separator, or that
 * would nest past the tree's ceiling, costs that one file. The rest of
 * the batch lands, filed where it was dropped.
 *
 * **Traversal is not narrated** (DD-017). A folder a drop find-or-creates
 * writes no activity entry of its own; the drop's story is its
 * `document.created` entries, each of which now names the folder its
 * file landed in.
 *
 * Everything runs through injected requests against real Postgres, the
 * committed migrations, and the real local storage driver. Nothing is
 * mocked, and nothing here reads a table to find out what happened.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

/** A Legal Team Member on the contract's team — the person a tree is
 * dropped by. Bulk intake is a Member+ act, as every upload is. */
const MEMBER = {
  email: "folder-drop-member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let memberId: string;

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
  versions: { versionNumber: number }[];
}

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

/** A contract with the Member on its team, so the drop has somebody to
 * be made by. */
async function newContract(title: string): Promise<ContractRow> {
  const created = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: adminCookies,
    payload: { title, contractTypeId: await ndaTypeId() },
  });
  expect(created.statusCode, created.body).toBe(201);
  const contract = created.json().contract as ContractRow;
  const team = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${contract.number}/team`,
    cookies: adminCookies,
    payload: { userId: memberId, role: "member" },
  });
  expect(team.statusCode, team.body).toBe(201);
  return contract;
}

const BOUNDARY = "openlaw-test-boundary-64726f70";

/**
 * One file of a drop, as the client sends it: the batch's one kind, the
 * destination the traversal worked out, then the file (DOC-011).
 *
 * Built by hand, because the order the parts arrive in is part of what
 * the route reads — every field is taken off what the parser has already
 * seen when the file part ends.
 */
function dropForm(
  filename: string,
  destination: Readonly<{ folderId?: string; folderPath?: string }>,
): { payload: Buffer; headers: Record<string, string> } {
  const field = (name: string, value: string) =>
    Buffer.from(
      `--${BOUNDARY}\r\ncontent-disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    );
  const payload = Buffer.concat([
    field("kind", "executed"),
    ...(destination.folderId === undefined ? [] : [field("folderId", destination.folderId)]),
    ...(destination.folderPath === undefined ? [] : [field("folderPath", destination.folderPath)]),
    Buffer.from(
      `--${BOUNDARY}\r\n` +
        `content-disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `content-type: application/pdf\r\n\r\n`,
    ),
    Buffer.from(`%PDF-1.7 ${filename}`),
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);
  return {
    payload,
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

/** One file of a drop, sent. The raw answer, because the refusals are as
 * much the subject as the successes. */
function dropFile(
  number: number,
  filename: string,
  destination: Readonly<{ folderId?: string; folderPath?: string }> = {},
  cookies = memberCookies,
) {
  const { payload, headers } = dropForm(filename, destination);
  return harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/documents`,
    cookies,
    headers,
    payload,
  });
}

/** An empty directory of a dropped tree, recreated on its own (DOC-011).
 * The same find-or-create the uploads use, addressed without a file. */
const dropFolder = (number: number, path: string, parentId?: string) =>
  harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/folders`,
    cookies: memberCookies,
    payload: { path, ...(parentId ? { parentId } : {}) },
  });

/** The record's folders as the tree is drawn from them. */
async function foldersOf(number: number): Promise<FolderRow[]> {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/contracts/${number}/folders`,
    cookies: memberCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().folders as FolderRow[];
}

/** The record's paper, whole. */
async function paperOf(number: number): Promise<DocumentRow[]> {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/contracts/${number}/documents`,
    cookies: memberCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().documents as DocumentRow[];
}

/**
 * Every blob the storage driver is holding, by its key.
 *
 * Read off the temporary root the harness gives the real local driver:
 * nothing is mocked, so "did that upload leave anything behind" is a
 * question about files on a disk rather than about a spy.
 */
async function storedBlobs(): Promise<string[]> {
  const root = harness.storageRoot;
  const walk = async (at: string): Promise<string[]> => {
    const found: string[] = [];
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const here = join(at, entry.name);
      if (entry.isDirectory()) found.push(...(await walk(here)));
      else found.push(here);
    }
    return found;
  };
  return (await walk(root)).toSorted();
}

/** One record's feed, as the activity bar reads it. */
async function feedOf(contractId: string): Promise<
  {
    action: string;
    payload: Record<string, unknown>;
  }[]
> {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/activity?entityType=contract&entityId=${contractId}`,
    cookies: memberCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().entries;
}

/**
 * The path from the record root down to one folder, read back out of the
 * whole set.
 *
 * The tree is asserted this way rather than by walking parent ids in
 * each test, because what the drop promises is a shape and not a set of
 * rows: "Legacy/Executed" is one sentence about where a document ended
 * up.
 */
function pathOf(folders: readonly FolderRow[], folder: FolderRow): string {
  const names: string[] = [];
  let at: FolderRow | undefined = folder;
  for (let step = 0; at && step <= folders.length; step += 1) {
    names.unshift(at.name);
    const parentId: string | null = at.parentId;
    at = parentId === null ? undefined : folders.find((row) => row.id === parentId);
  }
  return names.join("/");
}

/** Every folder of a record, by the path it sits at. */
async function treeOf(number: number): Promise<string[]> {
  const folders = await foldersOf(number);
  return folders.map((folder) => pathOf(folders, folder)).toSorted();
}

/** Where one document is filed, as a path, or the record root. */
async function filedAt(number: number, title: string): Promise<string | null> {
  const folders = await foldersOf(number);
  const document = (await paperOf(number)).find((row) => row.title === title);
  expect(document, `the document named ${title}`).toBeDefined();
  if (document!.folderId === null) return null;
  const folder = folders.find((row) => row.id === document!.folderId);
  expect(folder, `the folder ${title} is filed in`).toBeDefined();
  return pathOf(folders, folder!);
}

describe("dropping a folder tree onto a contract (DOC-011)", () => {
  it("recreates the dropped structure and files every file into place", async () => {
    const contract = await newContract("Drop · the legacy book");
    const dropped: [string, string][] = [
      ["MSA_2019_signed.pdf", "Legacy/Executed"],
      ["SOW1_2020_signed.pdf", "Legacy/Executed"],
      ["Amendment_1_2021.docx", "Legacy/Redlines"],
      ["2019-11-04_notice.pdf", "Legacy/Correspondence/2019"],
      ["cover_letter.pdf", "Legacy"],
    ];

    for (const [name, folderPath] of dropped) {
      const res = await dropFile(contract.number, name, { folderPath });
      expect(res.statusCode, res.body).toBe(201);
    }

    // The structure that arrived is the structure that was dropped:
    // every level of it, created once, with nothing invented in between.
    expect(await treeOf(contract.number)).toEqual([
      "Legacy",
      "Legacy/Correspondence",
      "Legacy/Correspondence/2019",
      "Legacy/Executed",
      "Legacy/Redlines",
    ]);
    for (const [name, folderPath] of dropped) {
      expect(await filedAt(contract.number, name), name).toBe(folderPath);
    }
  });

  it("lands a dropped file as a new document at version 1, never as a version of one already there", async () => {
    const contract = await newContract("Drop · never appends");
    expect((await dropFile(contract.number, "MSA.pdf", { folderPath: "Legacy" })).statusCode).toBe(
      201,
    );
    expect((await dropFile(contract.number, "MSA.pdf", { folderPath: "Legacy" })).statusCode).toBe(
      201,
    );

    // Two files of one name are two documents, each at version 1.
    // Matching a dropped file to a document already on the record by its
    // name would be guessing, and a guessed version is a round of a
    // negotiation nobody had.
    const paper = await paperOf(contract.number);
    expect(paper.filter((row) => row.title === "MSA.pdf")).toHaveLength(2);
    for (const document of paper) {
      expect(document.versions.map((version) => version.versionNumber)).toEqual([1]);
    }
  });

  it("files a drop onto a folder row into that folder, and a tree dropped there beneath it", async () => {
    const contract = await newContract("Drop · onto a folder row");
    const created = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/folders`,
      cookies: memberCookies,
      payload: { name: "Executed" },
    });
    expect(created.statusCode, created.body).toBe(201);
    const executed = (created.json().folders as FolderRow[])[0]!;

    // A file straight into the row it was dropped on.
    expect(
      (await dropFile(contract.number, "signed.pdf", { folderId: executed.id })).statusCode,
    ).toBe(201);
    // And a tree dropped on that same row is recreated inside it, which
    // is what makes the two fields compose rather than exclude each
    // other.
    expect(
      (
        await dropFile(contract.number, "2019_notice.pdf", {
          folderId: executed.id,
          folderPath: "2019/Notices",
        })
      ).statusCode,
    ).toBe(201);

    expect(await treeOf(contract.number)).toEqual([
      "Executed",
      "Executed/2019",
      "Executed/2019/Notices",
    ]);
    expect(await filedAt(contract.number, "signed.pdf")).toBe("Executed");
    expect(await filedAt(contract.number, "2019_notice.pdf")).toBe("Executed/2019/Notices");
  });

  it("files a file carrying no destination at the record root, exactly as before", async () => {
    const contract = await newContract("Drop · plain files still land flat");
    expect((await dropFile(contract.number, "loose.pdf")).statusCode).toBe(201);

    expect(await foldersOf(contract.number)).toEqual([]);
    expect(await filedAt(contract.number, "loose.pdf")).toBeNull();
  });

  it("counts a dropped file in its folder's own count", async () => {
    const contract = await newContract("Drop · the counts move");
    expect(
      (await dropFile(contract.number, "a.pdf", { folderPath: "Legacy/Executed" })).statusCode,
    ).toBe(201);
    expect(
      (await dropFile(contract.number, "b.pdf", { folderPath: "Legacy/Executed" })).statusCode,
    ).toBe(201);

    const folders = await foldersOf(contract.number);
    const byPath = new Map(folders.map((folder) => [pathOf(folders, folder), folder]));
    // The count says what opening the folder will show, so a document
    // one level down belongs to its own folder's count and not to its
    // parent's.
    expect(byPath.get("Legacy")!.documentCount).toBe(0);
    expect(byPath.get("Legacy/Executed")!.documentCount).toBe(2);
  });
});

describe("two drops racing on one path (DOC-011)", () => {
  it("converges on one folder per segment when uploads are genuinely concurrent", async () => {
    const contract = await newContract("Drop · the race");

    // Genuinely at once, not one after another: the client uploads with
    // bounded concurrency, so several files carrying one path really do
    // reach the route in the same moment. The owning contract's row lock
    // is what makes the second one see the folder the first one wrote —
    // without it a legacy book would arrive in two folders of one name,
    // which is the failure a bulk import can least afford.
    const answers = await Promise.all(
      ["a.pdf", "b.pdf", "c.pdf", "d.pdf", "e.pdf", "f.pdf"].map((name) =>
        dropFile(contract.number, name, { folderPath: "Legacy/Executed" }),
      ),
    );
    for (const res of answers) expect(res.statusCode, res.body).toBe(201);

    expect(await treeOf(contract.number)).toEqual(["Legacy", "Legacy/Executed"]);
    const folders = await foldersOf(contract.number);
    const executed = folders.find((folder) => folder.name === "Executed")!;
    expect(executed.documentCount).toBe(6);
    // Every file in the one folder, not four in one and two in another.
    const paper = await paperOf(contract.number);
    expect(
      paper.every((row) => row.folderId === executed.id),
      "all six filed together",
    ).toBe(true);
  });

  it("converges when racing drops differ only in the case of a segment", async () => {
    const contract = await newContract("Drop · the race, mixed case");

    // The sibling rule is case-insensitive (M13/2), and find-or-create
    // reads it the same way — so "executed" finds "Executed" rather than
    // making a second folder beside it or hitting the unique index
    // behind it.
    const answers = await Promise.all([
      dropFile(contract.number, "a.pdf", { folderPath: "Legacy/Executed" }),
      dropFile(contract.number, "b.pdf", { folderPath: "legacy/executed" }),
      dropFile(contract.number, "c.pdf", { folderPath: "LEGACY/EXECUTED" }),
    ]);
    for (const res of answers) expect(res.statusCode, res.body).toBe(201);

    const folders = await foldersOf(contract.number);
    expect(folders).toHaveLength(2);
    // The name the first one wrote is the name that stands, whichever of
    // the three won the race. A later spelling finds that folder rather
    // than renaming it underneath somebody or making a second one.
    const root = folders.find((folder) => folder.parentId === null)!;
    const leaf = folders.find((folder) => folder.parentId !== null)!;
    expect(["Legacy", "legacy", "LEGACY"]).toContain(root.name);
    expect(["Executed", "executed", "EXECUTED"]).toContain(leaf.name);
    expect(pathOf(folders, leaf)).toBe(`${root.name}/${leaf.name}`);
    expect(leaf.documentCount).toBe(3);
  });

  it("converges when an empty directory and an upload race on one path", async () => {
    const contract = await newContract("Drop · the empty directory races");

    const answers = await Promise.all([
      dropFolder(contract.number, "Legacy/Signature packets"),
      dropFile(contract.number, "a.pdf", { folderPath: "Legacy/Signature packets" }),
    ]);
    for (const res of answers) expect(res.statusCode, res.body).toBe(201);

    expect(await treeOf(contract.number)).toEqual(["Legacy", "Legacy/Signature packets"]);
  });
});

describe("an empty directory of a dropped tree (DOC-011)", () => {
  it("is recreated by its path, with every level above it", async () => {
    const contract = await newContract("Drop · the empty directory");
    const res = await dropFolder(contract.number, "Legacy/Correspondence/2019");
    expect(res.statusCode, res.body).toBe(201);

    expect(await treeOf(contract.number)).toEqual([
      "Legacy",
      "Legacy/Correspondence",
      "Legacy/Correspondence/2019",
    ]);
    // Empty is what it is: the directory arrived because it was dropped,
    // not because anything is in it.
    for (const folder of await foldersOf(contract.number)) {
      expect(folder.documentCount, folder.name).toBe(0);
    }
  });

  it("uses the folders a sibling upload already made rather than refusing them", async () => {
    const contract = await newContract("Drop · the directory beside a file");
    expect(
      (await dropFile(contract.number, "a.pdf", { folderPath: "Legacy/Executed" })).statusCode,
    ).toBe(201);

    // A duplicate sibling name is refused on the manual create (M13/2);
    // the drop's own shape finds it instead, because a dropped tree
    // names every directory it carries and half of them are already
    // there by the time the empty ones are asked for.
    expect((await dropFolder(contract.number, "Legacy/Executed")).statusCode).toBe(201);
    expect(await treeOf(contract.number)).toEqual(["Legacy", "Legacy/Executed"]);
  });

  it("is recreated beneath the folder the tree was dropped on", async () => {
    const contract = await newContract("Drop · the directory under a row");
    const created = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/folders`,
      cookies: memberCookies,
      payload: { name: "Executed" },
    });
    expect(created.statusCode, created.body).toBe(201);
    const executed = (created.json().folders as FolderRow[])[0]!;

    const res = await dropFolder(contract.number, "2019/Notices", executed.id);
    expect(res.statusCode, res.body).toBe(201);
    expect(await treeOf(contract.number)).toEqual([
      "Executed",
      "Executed/2019",
      "Executed/2019/Notices",
    ]);
  });

  it("refuses a create that names both a name and a path, and one that names neither", async () => {
    const contract = await newContract("Drop · one act or the other");
    const both = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/folders`,
      cookies: memberCookies,
      payload: { name: "Executed", path: "Legacy/Executed" },
    });
    expect(both.statusCode, both.body).toBe(400);
    const neither = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/folders`,
      cookies: memberCookies,
      payload: {},
    });
    expect(neither.statusCode, neither.body).toBe(400);
    expect(await foldersOf(contract.number)).toEqual([]);
  });
});

describe("a path a drop cannot use", () => {
  it("refuses the file that carried it and leaves the rest of the batch alone", async () => {
    const contract = await newContract("Drop · one bad path");

    const good = await dropFile(contract.number, "good.pdf", { folderPath: "Legacy/Executed" });
    expect(good.statusCode, good.body).toBe(201);
    const bad = await dropFile(contract.number, "bad.pdf", { folderPath: "Legacy//Executed" });
    expect(bad.statusCode, bad.body).toBe(400);
    const after = await dropFile(contract.number, "after.pdf", { folderPath: "Legacy/Redlines" });
    expect(after.statusCode, after.body).toBe(201);

    // The refused file cost itself and nothing else: no document, no
    // folder, and the two files either side of it landed where they
    // were dropped.
    expect((await paperOf(contract.number)).map((row) => row.title).toSorted()).toEqual([
      "after.pdf",
      "good.pdf",
    ]);
    expect(await treeOf(contract.number)).toEqual(["Legacy", "Legacy/Executed", "Legacy/Redlines"]);
  });

  it("refuses a path that starts or ends with the separator", async () => {
    const contract = await newContract("Drop · separator misuse");
    expect((await dropFile(contract.number, "a.pdf", { folderPath: "/Legacy" })).statusCode).toBe(
      400,
    );
    expect((await dropFile(contract.number, "b.pdf", { folderPath: "Legacy/" })).statusCode).toBe(
      400,
    );
    expect(await foldersOf(contract.number)).toEqual([]);
    expect(await paperOf(contract.number)).toEqual([]);
  });

  it("refuses a segment that breaks a folder name's own rules", async () => {
    const contract = await newContract("Drop · a segment that is not a name");
    // A backslash is not a second separator: it is a character a folder
    // name may not hold (M13/2), so a Windows-shaped path is refused as
    // a bad name rather than guessed at.
    expect(
      (await dropFile(contract.number, "a.pdf", { folderPath: "Legacy\\Executed" })).statusCode,
    ).toBe(400);
    expect(
      (await dropFile(contract.number, "b.pdf", { folderPath: `Legacy/${"x".repeat(256)}` }))
        .statusCode,
    ).toBe(400);
    // `..` is a folder nobody meant to make, not an escape: no name here
    // ever reaches a filesystem, because a storage key is minted from
    // two ids.
    expect(
      (await dropFile(contract.number, "c.pdf", { folderPath: "Legacy/../Executed" })).statusCode,
    ).toBe(400);
    expect(await foldersOf(contract.number)).toEqual([]);
  });

  it("refuses a path deeper than the tree's ceiling, before anything is created", async () => {
    const contract = await newContract("Drop · too deep");
    const deep = Array.from({ length: 11 }, (_, level) => `L${level + 1}`).join("/");
    const res = await dropFile(contract.number, "deep.pdf", { folderPath: deep });
    expect(res.statusCode, res.body).toBe(409);

    // Not one level of it: half a chain is worse than no chain, because
    // it leaves a tree nobody dropped.
    expect(await foldersOf(contract.number)).toEqual([]);
    expect(await paperOf(contract.number)).toEqual([]);
  });

  it("refuses a chain that would pass the ceiling only because of where it was dropped", async () => {
    const contract = await newContract("Drop · deep enough already");
    // Eight levels made by hand, then a two-level tree dropped on the
    // deepest of them: nine and ten are fine, eleven is not.
    let parentId: string | undefined;
    for (let level = 1; level <= 8; level += 1) {
      const res = await harness.app.inject({
        method: "POST",
        url: `/api/v1/contracts/${contract.number}/folders`,
        cookies: memberCookies,
        payload: { name: `L${level}`, ...(parentId ? { parentId } : {}) },
      });
      expect(res.statusCode, res.body).toBe(201);
      const folders = res.json().folders as FolderRow[];
      parentId = folders.find((folder) => folder.name === `L${level}`)!.id;
    }

    const fits = await dropFile(contract.number, "fits.pdf", {
      folderId: parentId,
      folderPath: "L9/L10",
    });
    expect(fits.statusCode, fits.body).toBe(201);
    const over = await dropFile(contract.number, "over.pdf", {
      folderId: parentId,
      folderPath: "M9/M10/M11",
    });
    expect(over.statusCode, over.body).toBe(409);
    expect((await paperOf(contract.number)).map((row) => row.title)).toEqual(["fits.pdf"]);
    expect((await foldersOf(contract.number)).some((folder) => folder.name === "M9")).toBe(false);
  });

  it("leaves no stored blob behind when the destination is refused under the lock", async () => {
    const contract = await newContract("Drop · nothing left at the key");

    // A path's own shape is refused before a byte is read. A
    // **destination** is not: whether the folder is on this record, and
    // whether the chain fits under the ceiling once it is placed, are
    // decided under the row lock — which is after the bytes have reached
    // the driver (DOC-012). Without a cleanup a drop refused a file at a
    // time would leave one orphan blob per refused file, so the store is
    // asserted to be exactly as it was found.
    const before = await storedBlobs();
    const refused = await dropFile(contract.number, "elsewhere.pdf", {
      folderId: "01920000-0000-7000-8000-0000000000fb",
    });
    expect(refused.statusCode, refused.body).toBe(404);
    expect(await storedBlobs()).toEqual(before);
  });

  it("answers a folder on another record exactly as one that was never created", async () => {
    const mine = await newContract("Drop · my record");
    const theirs = await newContract("Drop · another record");
    const created = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${theirs.number}/folders`,
      cookies: memberCookies,
      payload: { name: "Executed" },
    });
    expect(created.statusCode, created.body).toBe(201);
    const elsewhere = (created.json().folders as FolderRow[])[0]!;

    // A folder id says nothing about which record it belongs to, so the
    // shared-owner invariant is asked at the seam and answered as a 404
    // — the same answer an id nothing was ever made under earns.
    const crossRecord = await dropFile(mine.number, "a.pdf", { folderId: elsewhere.id });
    expect(crossRecord.statusCode, crossRecord.body).toBe(404);
    const neverCreated = await dropFile(mine.number, "b.pdf", {
      folderId: "01920000-0000-7000-8000-0000000000fb",
    });
    expect(neverCreated.statusCode, neverCreated.body).toBe(404);
    expect(crossRecord.json().detail).toBe(neverCreated.json().detail);
    expect(await paperOf(mine.number)).toEqual([]);
  });
});

describe("what a drop narrates (DD-017)", () => {
  it("writes no activity for the folders it created, and names the destination on each upload", async () => {
    const contract = await newContract("Drop · the feed stays a story about people");
    expect(
      (await dropFile(contract.number, "MSA.pdf", { folderPath: "Legacy/Executed" })).statusCode,
    ).toBe(201);

    const entries = await feedOf(contract.id);
    // Traversal is not an act somebody performed. Two folders were made
    // on the way to this file, and neither of them is in the feed.
    expect(entries.filter((entry) => entry.action.startsWith("folder."))).toEqual([]);

    const created = entries.find((entry) => entry.action === "document.created");
    expect(created, "the upload's own entry").toBeDefined();
    // By name rather than by id, so the entry still says where the file
    // landed after that folder is renamed or dissolved.
    expect(created!.payload.folderName).toBe("Executed");
    expect(created!.payload.title).toBe("MSA.pdf");
  });

  it("leaves the destination null on a file that landed at the record root", async () => {
    const contract = await newContract("Drop · a file with nowhere to be filed");
    expect((await dropFile(contract.number, "loose.pdf")).statusCode).toBe(201);

    const created = (await feedOf(contract.id)).find(
      (entry) => entry.action === "document.created",
    );
    expect(created!.payload.folderName).toBeNull();
  });

  it("narrates an empty directory of a drop not at all", async () => {
    const contract = await newContract("Drop · a directory nobody made by hand");
    expect((await dropFolder(contract.number, "Signature packets")).statusCode).toBe(201);

    expect(
      (await feedOf(contract.id)).filter((entry) => entry.action.startsWith("folder.")),
    ).toEqual([]);
  });
});

describe("who may drop a tree onto a record", () => {
  it("refuses a drop on an archived contract, folders and files alike", async () => {
    const contract = await newContract("Drop · a frozen record");
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/archive`,
      cookies: adminCookies,
    });
    expect(archived.statusCode, archived.body).toBe(200);

    expect((await dropFile(contract.number, "a.pdf", { folderPath: "Legacy" })).statusCode).toBe(
      409,
    );
    expect((await dropFolder(contract.number, "Legacy")).statusCode).toBe(409);
    expect(await foldersOf(contract.number)).toEqual([]);
  });
});
