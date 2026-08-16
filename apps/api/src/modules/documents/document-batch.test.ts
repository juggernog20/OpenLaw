// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The multi-file batch (M13/4, DOC-011) at the HTTP seam.
 *
 * **The server is unchanged, and that is the subject.** A batch is N
 * calls to the upload route a single file already goes through, so
 * nothing here tests a bulk endpoint — there is none. What is asserted
 * is that the facts the batch relies on still hold when N files arrive
 * on one record: each is a new document at version 1, exactly one of
 * them takes the primary designation (CTR-014), each enqueues its own
 * derivations (DOC-005), and one file's refusal costs that file and
 * nothing else.
 *
 * **The primary rule is asserted under real concurrency**, not only
 * file after file. The client sends with bounded concurrency, so two
 * uploads really can read a contract with no primary at the same
 * moment; the contract's row lock is what makes the second one see the
 * first. A record with two instruments is a record that cannot say what
 * it is.
 *
 * Everything runs through injected requests against real Postgres, the
 * committed migrations, the real local storage driver, and the real
 * background pipeline. Nothing is mocked, and nothing here reads a
 * table to find out what happened.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, users } from "@openlaw/db";
import { buildApp } from "../../app.js";
import { createUnconfiguredSigningResolver } from "../../lib/signing/resolver.js";
import { fakeExtractedText } from "../../lib/doc-engine/fake.js";
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

/** A Legal Team Member on the contract's team — the person a batch is
 * dropped by. Bulk intake is a Member+ act, as every upload is. */
const MEMBER = {
  email: "batch-member@example.com",
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
  primaryDocumentId: string | null;
}

interface VersionRow {
  id: string;
  versionNumber: number;
  kind: string;
  note: string | null;
  originalFilename: string;
  isCurrent: boolean;
}

interface DocumentRow {
  id: string;
  title: string;
  isPrimary: boolean;
  versions: VersionRow[];
}

interface TextRow {
  state: string;
  source: string | null;
  text: string | null;
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

/** A contract with the Member on its team, so the batch has somebody to
 * be dropped by. */
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

const BOUNDARY = "openlaw-test-boundary-6261746368";

/**
 * One file of a batch, as the client sends it: the batch's one kind
 * first, then the file, and no note at all (DOC-011).
 *
 * Built by hand, because the order the parts arrive in is part of what
 * the route reads — the kind is taken off what the parser has already
 * seen when the file part ends.
 */
function batchForm(
  filename: string,
  kind: string,
  content: Buffer,
): { payload: Buffer; headers: Record<string, string> } {
  const payload = Buffer.concat([
    Buffer.from(`--${BOUNDARY}\r\n`),
    Buffer.from(`content-disposition: form-data; name="kind"\r\n\r\n`),
    Buffer.from(kind),
    Buffer.from(`\r\n--${BOUNDARY}\r\n`),
    Buffer.from(
      `content-disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `content-type: application/pdf\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);
  return {
    payload,
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

/** A PDF carrying its own words, which is what a born-digital contract
 * is and what the extraction path reads. */
const nativeTextPdf = (label: string) => Buffer.from(`%PDF-1.7 ${label}`);

/** One file of a batch, sent. The raw answer, because the refusals are
 * as much the subject as the successes. */
function sendFile(
  number: number,
  filename: string,
  options: { kind?: string; content?: Buffer } = {},
  app = harness.app,
) {
  const { payload, headers } = batchForm(
    filename,
    options.kind ?? "draft_ours",
    options.content ?? nativeTextPdf(filename),
  );
  return app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/documents`,
    cookies: memberCookies,
    headers,
    payload,
  });
}

/** The record's paper as the list route answers it. */
async function paperOf(number: number): Promise<DocumentRow[]> {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/contracts/${number}/documents`,
    cookies: memberCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().documents as DocumentRow[];
}

/** The version that matters now on one document. */
const currentOf = (document: DocumentRow): VersionRow => {
  const current = document.versions.filter((version) => version.isCurrent);
  expect(current.length, "exactly one current version").toBe(1);
  return current[0]!;
};

/** How long a derivation is given before the suite calls it stuck. The
 * fake engine is a memcpy, so this is slack for the queue, not for the
 * work. */
const SETTLE_TIMEOUT_MS = 20_000;

/**
 * Polls the extracted-text read the way the doc panel does, until the
 * derivation stops being owed.
 *
 * The same shape M12's own suite uses: nothing looks inside the queue,
 * nothing waits on a handler's promise, and nothing reads the table.
 */
async function settledText(documentId: string, versionId: string): Promise<TextRow> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let last: TextRow | undefined;
  while (Date.now() < deadline) {
    const res = await harness.app.inject({
      method: "GET",
      url: `/api/v1/documents/${documentId}/versions/${versionId}/text`,
      cookies: memberCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    last = res.json().text as TextRow;
    if (last.state !== "pending") return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `the derivation for version ${versionId} was still pending after ${SETTLE_TIMEOUT_MS}ms: ` +
      `${JSON.stringify(last)}\n${JSON.stringify(harness.jobLog, null, 2)}`,
  );
}

describe("a batch of files on one contract (M13/4, DOC-011)", () => {
  it("lands every file as its own document at version 1, under the batch's one kind", async () => {
    const contract = await newContract("Batch · the legacy book");
    const names = ["msa_2019.pdf", "sow1_2020.pdf", "amendment_1.pdf"];

    for (const name of names) {
      const res = await sendFile(contract.number, name, { kind: "executed" });
      expect(res.statusCode, res.body).toBe(201);
    }

    const paper = await paperOf(contract.number);
    expect(paper.map((row) => row.title).toSorted()).toEqual(names.toSorted());
    for (const document of paper) {
      // A dropped file is always a new document at version 1. A batch
      // never appends to an existing chain — matching dropped files to
      // existing documents by name would be guessing.
      expect(document.versions).toHaveLength(1);
      const version = currentOf(document);
      expect(version.versionNumber).toBe(1);
      // One batch, one kind, and no note (DOC-011).
      expect(version.kind).toBe("executed");
      expect(version.note).toBeNull();
    }
  }, 60_000);

  it("leaves exactly one primary when a batch lands on a record with no paper", async () => {
    const contract = await newContract("Batch · the first instrument");

    for (const name of ["first.pdf", "second.pdf", "third.pdf"]) {
      expect((await sendFile(contract.number, name)).statusCode).toBe(201);
    }

    // The designation is taken by whichever file landed first, exactly
    // as any first upload takes it (CTR-014). What matters is that it
    // is taken once: a record with two instruments cannot say what it
    // is.
    const paper = await paperOf(contract.number);
    expect(paper.filter((row) => row.isPrimary)).toHaveLength(1);
  }, 60_000);

  it("leaves exactly one primary when the batch's files race each other", async () => {
    const contract = await newContract("Batch · the race");

    // Genuinely at once, not one after another: the client sends with
    // bounded concurrency, so two uploads really can read a contract
    // with no primary in the same moment. The contract's row lock is
    // what makes the second one see the first.
    const answers = await Promise.all(
      ["a.pdf", "b.pdf", "c.pdf", "d.pdf"].map((name) => sendFile(contract.number, name)),
    );
    for (const res of answers) expect(res.statusCode, res.body).toBe(201);

    const paper = await paperOf(contract.number);
    expect(paper).toHaveLength(4);
    expect(paper.filter((row) => row.isPrimary)).toHaveLength(1);
  }, 60_000);

  it("gives every file of a batch its extracted text, exactly as a single upload does", async () => {
    const contract = await newContract("Batch · the queue drains");
    const bytes = new Map(
      ["scan_a.pdf", "scan_b.pdf", "scan_c.pdf"].map((name) => [name, nativeTextPdf(name)]),
    );

    for (const [name, content] of bytes) {
      expect((await sendFile(contract.number, name, { content })).statusCode).toBe(201);
    }

    // Nothing new was built for the batch: each landed file asked the
    // pipeline for its own derivations at the moment it committed, the
    // way one upload does (DOC-005). The demo's promise is that the
    // queue drains over a bulk import, so every file is asked for.
    const paper = await paperOf(contract.number);
    for (const document of paper) {
      const text = await settledText(document.id, currentOf(document).id);
      expect(text.state, document.title).toBe("ready");
      expect(text.source).toBe("native_layer");
      expect(text.text).toBe(fakeExtractedText(bytes.get(document.title)!));
    }
  }, 120_000);

  it("takes no file of a batch on an archived contract", async () => {
    const contract = await newContract("Batch · frozen");
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/archive`,
      cookies: adminCookies,
    });
    expect(archived.statusCode, archived.body).toBe(200);

    const res = await sendFile(contract.number, "too_late.pdf");

    // A frozen record takes no new paper, and a batch is new paper N
    // times over.
    expect(res.statusCode, res.body).toBe(409);
    expect(await paperOf(contract.number)).toEqual([]);
  }, 60_000);
});

describe("the per-file ceiling inside a batch", () => {
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
      docEngine: harness.docEngine,
      resolveSigningProvider: createUnconfiguredSigningResolver(),
      jobs: harness.pipeline,
      maxUploadBytes: LIMIT,
    });
    await small.ready();
  }, 60_000);

  afterAll(async () => {
    await small.close();
  });

  it("refuses the one file over the limit by name and lands the rest of the batch", async () => {
    const contract = await newContract("Batch · one file too big");

    const under = await sendFile(
      contract.number,
      "small_a.pdf",
      { content: Buffer.alloc(LIMIT - 1, 0x61) },
      small,
    );
    const over = await sendFile(
      contract.number,
      "enormous.pdf",
      { content: Buffer.alloc(LIMIT * 4, 0x61) },
      small,
    );
    const after = await sendFile(
      contract.number,
      "small_b.pdf",
      { content: Buffer.alloc(LIMIT - 1, 0x61) },
      small,
    );

    expect(under.statusCode, under.body).toBe(201);
    expect(over.statusCode, over.body).toBe(413);
    // The limit is named, so the client can say why without inventing a
    // number of its own — and can tell this refusal from one a retry
    // could get past (DES-033 §11).
    expect(over.json().detail).toContain("upload limit");
    // The ceiling is per file, not per drop: the file after the refused
    // one lands.
    expect(after.statusCode, after.body).toBe(201);

    const paper = await paperOf(contract.number);
    expect(paper.map((row) => row.title).toSorted()).toEqual(["small_a.pdf", "small_b.pdf"]);
    // And the refused file left no row behind: two documents, one
    // version each, and the designation taken exactly once.
    for (const document of paper) expect(document.versions).toHaveLength(1);
    expect(paper.filter((row) => row.isPrimary)).toHaveLength(1);
  }, 60_000);

  it("leaves exactly one primary when a refused file races the rest of the batch", async () => {
    const contract = await newContract("Batch · the race with a casualty");

    // The two rules this file has asserted apart, now at once: the
    // refusal is isolated, and the designation is taken once. Sent one
    // after another, the refused file never overlaps a survivor. Sent
    // together, it does — and the survivors are racing for the primary
    // designation at the same moment, on a record that has no paper
    // yet.
    const answers = await Promise.all([
      sendFile(contract.number, "a.pdf", { content: Buffer.alloc(LIMIT - 1, 0x61) }, small),
      sendFile(contract.number, "enormous.pdf", { content: Buffer.alloc(LIMIT * 4, 0x61) }, small),
      sendFile(contract.number, "b.pdf", { content: Buffer.alloc(LIMIT - 1, 0x61) }, small),
    ]);

    expect(answers.map((res) => res.statusCode)).toEqual([201, 413, 201]);

    const paper = await paperOf(contract.number);
    // The refused file left no row, and the two that landed did not
    // both take the designation.
    expect(paper.map((row) => row.title).toSorted()).toEqual(["a.pdf", "b.pdf"]);
    expect(paper.filter((row) => row.isPrimary)).toHaveLength(1);
  }, 60_000);
});
