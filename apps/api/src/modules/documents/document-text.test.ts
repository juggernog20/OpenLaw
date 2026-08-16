// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The background pipeline and one version's extracted text (M12/3,
 * DOC-005, TECH-007) at the HTTP seam.
 *
 * **Nothing here reaches into the pipeline.** A suite uploads a file over
 * HTTP and then polls the same read the doc panel polls, until the
 * derivation lands. The real pg-boss queue and the real handlers run in
 * this process against the harness's Postgres — only the doc engine is
 * faked, and it is faked deterministically, so the suite states the text
 * it expects rather than reading back whatever appeared.
 *
 * **The route is decided by what the file answers.** A PDF that carries
 * its words keeps them. A PDF that is pictures of pages answers
 * extraction with nothing, and that nothing is what sends it to OCR — so
 * the suite uploads one of each and requires two different sources on
 * the answer.
 *
 * **The original is what renders.** After a scan has been OCR'd, its
 * preview and its download still stream back the very bytes that were
 * uploaded. Extracted text is an index, never a displayed conversion,
 * and no OCR'd PDF is stored.
 *
 * **An upload is never blocked or failed by its pipeline.** One case
 * uploads through an app whose queue cannot be reached at all and
 * requires the 201, the file, and a derivation still recorded as owed —
 * because the row is written in the upload's own transaction and the
 * queue send only wakes a worker.
 *
 * **The text read opens no side door past the contract gate** (DOC-008,
 * DD-014). Its refusals are written the M10 way: every one is sent
 * twice, once at the real address and once at an id nothing was ever
 * created under, and the two problem bodies must be one body.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { documentVersionText, eq, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import { buildApp } from "../../app.js";
import { fakeExtractedText, fakeImageOnlyPdf, fakeOcrText } from "../../lib/doc-engine/fake.js";
import { createUnconfiguredJobQueue } from "../../pipeline/jobs.js";
import { testDeps } from "../../testing/deps.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

/** A Legal Team Member on the contract's team, who uploads everything
 * here and reads its text back. */
const MEMBER = {
  email: "doctext-member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;
/** A Contributor on the team: read access means reading, on every
 * surface (DD-015, CTR-021). */
const CONTRIBUTOR = {
  email: "doctext-contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;
/** A Legal Team Member with no team row. They read every open contract,
 * and nothing of a confidential one — nor of a confidential document on
 * an open one. */
const OUTSIDER = {
  email: "doctext-outsider@example.com",
  displayName: "Otto Outsider",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let outsiderCookies: Record<string, string>;
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
  originalFilename: string;
  renderFamily: string;
  isCurrent: boolean;
}

interface DocumentRow {
  id: string;
  title: string;
  versions: VersionRow[];
}

/** What the extracted-text read answers. */
interface TextRow {
  state: "pending" | "ready" | "failed" | "unsupported";
  source: "native_layer" | "ocr" | null;
  text: string | null;
  updatedAt: string | null;
}

/** An id nothing was ever created under — the control every refusal is
 * compared against. */
const NEVER_CREATED = "0198f2ab-0000-7000-8000-0000000012ab";

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
  ] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, user.id));
    userIds.set(fixture.email, user.id);
  }
  adminCookies = await signInCookies(harness.app, ADMIN.email, ADMIN.password);
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
  contributorCookies = await signInCookies(harness.app, CONTRIBUTOR.email, CONTRIBUTOR.password);
  outsiderCookies = await signInCookies(harness.app, OUTSIDER.email, OUTSIDER.password);
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

/** A contract with the Member and the Contributor on its team. */
async function newContract(title: string): Promise<ContractRow> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: adminCookies,
    payload: { title, contractTypeId: await ndaTypeId() },
  });
  expect(res.statusCode, res.body).toBe(201);
  const contract = res.json().contract as ContractRow;
  await putOnTeam(contract.number, idOf(MEMBER), "member");
  await putOnTeam(contract.number, idOf(CONTRIBUTOR), "contributor");
  return contract;
}

async function putOnTeam(number: number, userId: string, role: string): Promise<void> {
  const res = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/team`,
    cookies: adminCookies,
    payload: { userId, role },
  });
  expect(res.statusCode, res.body).toBe(201);
}

/** Walls the whole contract off (M10's flag). */
async function markContractConfidential(number: number): Promise<void> {
  const res = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/contracts/${number}`,
    cookies: adminCookies,
    payload: { isConfidential: true },
  });
  expect(res.statusCode, res.body).toBe(200);
}

/** Walls one document off (DD-014's per-document flag). */
async function markDocumentConfidential(documentId: string): Promise<void> {
  const res = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/documents/${documentId}`,
    cookies: adminCookies,
    payload: { isConfidential: true },
  });
  expect(res.statusCode, res.body).toBe(200);
}

const BOUNDARY = "openlaw-test-boundary-4d6f636b";

/** What one upload declares about itself: a name, a type, and bytes.
 * All three are the uploader's, and none of them is verified. */
interface FileSpec {
  filename: string;
  contentType: string;
  content?: Buffer;
}

function uploadBody(file: FileSpec): { payload: Buffer; headers: Record<string, string> } {
  const payload = Buffer.concat([
    Buffer.from(`--${BOUNDARY}\r\n`),
    Buffer.from('content-disposition: form-data; name="kind"\r\n\r\ndraft_ours\r\n'),
    Buffer.from(`--${BOUNDARY}\r\n`),
    Buffer.from(
      `content-disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
        `content-type: ${file.contentType}\r\n\r\n`,
    ),
    file.content ?? Buffer.from(`the bytes of ${file.filename}`),
    Buffer.from("\r\n"),
    Buffer.from(`--${BOUNDARY}--\r\n`),
  ]);
  return { payload, headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` } };
}

type App = TestHarness["app"];

/** Uploads one document to a contract, requiring success. */
async function uploaded(number: number, file: FileSpec, app: App = harness.app) {
  const { payload, headers } = uploadBody(file);
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/documents`,
    cookies: memberCookies,
    headers,
    payload,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().document as DocumentRow;
}

/** Appends the next round to a document, requiring success. */
async function appended(documentId: string, file: FileSpec): Promise<DocumentRow> {
  const { payload, headers } = uploadBody(file);
  const res = await harness.app.inject({
    method: "POST",
    url: `/api/v1/documents/${documentId}/versions`,
    cookies: memberCookies,
    headers,
    payload,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().document as DocumentRow;
}

const currentOf = (document: DocumentRow): VersionRow => {
  const current = document.versions.filter((version) => version.isCurrent);
  expect(current.length, "exactly one current version").toBe(1);
  return current[0]!;
};

/** `instance` is the URL the client itself asked for, so it is the one
 * field two refusals at two addresses are allowed to differ in. */
const withoutInstance = (body: Record<string, unknown>) => ({ ...body, instance: undefined });

const readText = (cookies: Record<string, string>, documentId: string, versionId: string) =>
  harness.app.inject({
    method: "GET",
    url: `/api/v1/documents/${documentId}/versions/${versionId}/text`,
    cookies,
  });

const preview = (cookies: Record<string, string>, documentId: string, versionId: string) =>
  harness.app.inject({
    method: "GET",
    url: `/api/v1/documents/${documentId}/versions/${versionId}/preview`,
    cookies,
  });

const download = (cookies: Record<string, string>, documentId: string, versionId: string) =>
  harness.app.inject({
    method: "GET",
    url: `/api/v1/documents/${documentId}/versions/${versionId}/download`,
    cookies,
  });

/** How long a derivation is given before the suite calls it stuck. The
 * fake engine is a memcpy, so this is slack for the queue, not for the
 * work. */
const SETTLE_TIMEOUT_MS = 20_000;

/**
 * Polls the extracted-text read the way the doc panel does, until the
 * derivation stops being owed.
 *
 * This is the whole shape of an M12 assertion: nothing looks inside the
 * queue, nothing waits on a handler's promise, and nothing reads the
 * table. The suite asks the same question a client asks, as often as a
 * client would, and states what the answer must become.
 */
async function settledText(documentId: string, versionId: string): Promise<TextRow> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let last: TextRow | undefined;
  while (Date.now() < deadline) {
    const res = await readText(memberCookies, documentId, versionId);
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

/** A PDF that carries its own words — a born-digital contract. */
const nativeTextPdf = (label: string) => Buffer.from(`%PDF-1.7 ${label}`);

/** A one-document contract whose only file is `file`. */
async function contractWithFile(title: string, file: FileSpec) {
  const contract = await newContract(title);
  const document = await uploaded(contract.number, file);
  return { contract, document, version: currentOf(document) };
}

describe("extracting a version's text", () => {
  it("reads a native text layer, without OCR", async () => {
    const bytes = nativeTextPdf("a born-digital master services agreement");
    const { document, version } = await contractWithFile("Text · native", {
      filename: "msa.pdf",
      contentType: "application/pdf",
      content: bytes,
    });

    const text = await settledText(document.id, version.id);
    expect(text.state).toBe("ready");
    // Named, not merely different from OCR: the two are not equally
    // trustworthy, and a surface that quotes the text should be able to
    // say which it holds.
    expect(text.source).toBe("native_layer");
    expect(text.text).toBe(fakeExtractedText(bytes));
    expect(text.updatedAt).not.toBeNull();
  }, 60_000);

  it("reads an image-only scan with OCR, because extraction found nothing", async () => {
    // DOC-005's whole branch, and the milestone's demo sentence: upload
    // a scan, do nothing else, and its text becomes available.
    const scan = fakeImageOnlyPdf("a countersigned NDA, photographed");
    const { document, version } = await contractWithFile("Text · scan", {
      filename: "signed-nda-scan.pdf",
      contentType: "application/pdf",
      content: scan,
    });

    const text = await settledText(document.id, version.id);
    expect(text.state).toBe("ready");
    expect(text.source).toBe("ocr");
    expect(text.text).toBe(fakeOcrText(scan));
  }, 60_000);

  it("keeps the original scan as what renders, and stores no OCR'd PDF", async () => {
    const scan = fakeImageOnlyPdf("the signed page, as it was scanned");
    const { document, version } = await contractWithFile("Text · original stands", {
      filename: "executed.pdf",
      contentType: "application/pdf",
      content: scan,
    });
    expect((await settledText(document.id, version.id)).source).toBe("ocr");

    // After OCR has run, both byte reads still answer the very bytes
    // that were uploaded. Extracted text is an index, never a displayed
    // conversion (DOC-005).
    const previewed = await preview(memberCookies, document.id, version.id);
    expect(previewed.statusCode, previewed.body).toBe(200);
    expect(previewed.rawPayload.equals(scan)).toBe(true);
    const downloaded = await download(memberCookies, document.id, version.id);
    expect(downloaded.statusCode, downloaded.body).toBe(200);
    expect(downloaded.rawPayload.equals(scan)).toBe(true);
  }, 60_000);

  it("extracts every round in the chain, not only the current one", async () => {
    const first = nativeTextPdf("round one, our draft");
    const second = fakeImageOnlyPdf("round two, their signed counterpart");
    const contract = await newContract("Text · chain");
    const document = await uploaded(contract.number, {
      filename: "round-1.pdf",
      contentType: "application/pdf",
      content: first,
    });
    const updated = await appended(document.id, {
      filename: "round-2.pdf",
      contentType: "application/pdf",
      content: second,
    });

    const [one, two] = updated.versions;
    expect(one?.versionNumber).toBe(1);
    expect(two?.versionNumber).toBe(2);
    const textOne = await settledText(document.id, one!.id);
    const textTwo = await settledText(document.id, two!.id);
    expect(textOne.source).toBe("native_layer");
    expect(textOne.text).toBe(fakeExtractedText(first));
    expect(textTwo.source).toBe("ocr");
    expect(textTwo.text).toBe(fakeOcrText(second));
  }, 60_000);

  it("says plainly that a file with no text will never have any", async () => {
    // An image renders and yields no text in v1 (DOC-005 is image-only
    // PDFs, not photographs). The read says so rather than leaving a
    // client polling for an answer that is not coming.
    const { document, version } = await contractWithFile("Text · image", {
      filename: "signature-page.png",
      contentType: "image/png",
    });

    const res = await readText(memberCookies, document.id, version.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().text).toEqual({
      state: "unsupported",
      source: null,
      text: null,
      updatedAt: null,
    });
  });

  // Three families are deliberately absent from this list, and each has
  // its own suite. Word and PowerPoint are read from the PDF rendition
  // M12/4 converts them to, so their text is owed from the moment they
  // are uploaded and the read says `pending` — asserted whole in
  // document-rendition.test.ts. An email's body is its text, parsed in
  // process (M12/5), and that path is asserted whole in
  // document-email.test.ts.
});

describe("when a derivation fails", () => {
  it("records the failure and leaves the version and its download alone", async () => {
    // A file that calls itself a PDF and is not one. The engine refuses
    // it terminally: no retry reads the same bytes differently.
    const bytes = Buffer.from("Dear Nadia, please find the agreement attached.");
    const { document, version } = await contractWithFile("Text · not a pdf", {
      filename: "agreement.pdf",
      contentType: "application/pdf",
      content: bytes,
    });

    const text = await settledText(document.id, version.id);
    expect(text.state).toBe("failed");
    expect(text.source).toBeNull();
    expect(text.text).toBeNull();

    // The upload is untouched: the chain still holds the version, and
    // its bytes still come back. A failed derivation is a version with
    // no text, never a broken upload.
    const record = await harness.app.inject({
      method: "GET",
      url: `/api/v1/documents/${document.id}/versions/${version.id}/download`,
      cookies: memberCookies,
    });
    expect(record.statusCode, record.body).toBe(200);
    expect(record.rawPayload.equals(bytes)).toBe(true);

    // Why it failed is in the pipeline's log, where an operator reads
    // it. It is not an activity entry: rendering and OCR are system
    // acts, and the feed narrates people (DD-017).
    const failures = harness.jobLog.filter((line) => line.message === "text extraction failed");
    // One line saying both things. Two lines each saying one of them
    // would pass a check written as two `some` calls and would not be
    // the fact this case is about.
    expect(
      failures.some(
        (line) => line.fields.versionId === version.id && line.fields.terminal === true,
      ),
    ).toBe(true);
  }, 60_000);
});

describe("when the queue cannot be reached", () => {
  it("still completes the upload, and still records the text as owed", async () => {
    // The same database and the same storage, behind a queue that
    // rejects everything — a pipeline that is down. An upload must not
    // notice (story 11), and the request must not be lost: the
    // derivation row is written in the upload's own transaction, so it
    // survives a send that never happened and M12/6's sweep is what
    // picks it up.
    const detached = await buildApp({
      ...testDeps(),
      db: harness.db,
      storage: harness.storage,
      docEngine: harness.docEngine,
      // Named rather than left to the default: the queue that rejects
      // everything is what this test is about.
      jobs: createUnconfiguredJobQueue(),
    });
    await detached.ready();
    try {
      const contract = await newContract("Text · no queue");
      const bytes = nativeTextPdf("uploaded while the worker was down");
      const document = await uploaded(
        contract.number,
        { filename: "msa.pdf", contentType: "application/pdf", content: bytes },
        detached,
      );
      const version = currentOf(document);

      // The file is there and readable, exactly as in M11.
      const downloaded = await download(memberCookies, document.id, version.id);
      expect(downloaded.statusCode, downloaded.body).toBe(200);
      expect(downloaded.rawPayload.equals(bytes)).toBe(true);

      // And the derivation is owed, not lost.
      const res = await readText(memberCookies, document.id, version.id);
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json().text as TextRow).state).toBe("pending");
      const [row] = await harness.db
        .select({ state: documentVersionText.state })
        .from(documentVersionText)
        .where(eq(documentVersionText.versionId, version.id));
      expect(row?.state).toBe("pending");
    } finally {
      await detached.close();
    }
  }, 60_000);
});

describe("hard delete takes what the machine derived", () => {
  it("removes the extracted text with the version rows", async () => {
    const bytes = nativeTextPdf("a contract somebody asked us to erase");
    const { document, version } = await contractWithFile("Text · erasure", {
      filename: "to-erase.pdf",
      contentType: "application/pdf",
      content: bytes,
    });
    expect((await settledText(document.id, version.id)).state).toBe("ready");

    const erased = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/documents/${document.id}`,
      cookies: adminCookies,
      payload: { confirmTitle: document.title },
    });
    expect(erased.statusCode, erased.body).toBe(200);

    // Lawful erasure erases everything, including what the machine read
    // (DOC-010).
    const remaining = await harness.db
      .select({ versionId: documentVersionText.versionId })
      .from(documentVersionText)
      .where(eq(documentVersionText.versionId, version.id));
    expect(remaining).toEqual([]);
  }, 60_000);
});

describe("the text read is behind both gates", () => {
  it("lets a Contributor on the team read what they may download", async () => {
    const bytes = nativeTextPdf("a draft the Contributor is on");
    const { document, version } = await contractWithFile("Text · contributor", {
      filename: "draft.pdf",
      contentType: "application/pdf",
      content: bytes,
    });
    expect((await settledText(document.id, version.id)).state).toBe("ready");

    const res = await readText(contributorCookies, document.id, version.id);
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json().text as TextRow).text).toBe(fakeExtractedText(bytes));
  }, 60_000);

  it("answers a contract the reader cannot reach as one that does not exist", async () => {
    const { contract, document, version } = await contractWithFile("Text · walled contract", {
      filename: "confidential.pdf",
      contentType: "application/pdf",
      content: nativeTextPdf("a walled contract"),
    });
    await markContractConfidential(contract.number);

    const refused = await readText(outsiderCookies, document.id, version.id);
    const control = await readText(outsiderCookies, NEVER_CREATED, NEVER_CREATED);
    expect(refused.statusCode).toBe(404);
    expect(control.statusCode).toBe(404);
    expect(withoutInstance(refused.json())).toEqual(withoutInstance(control.json()));
  }, 60_000);

  it("answers a confidential document as one that was never uploaded", async () => {
    // DD-014's silent omission, on the new surface. The outsider reaches
    // the contract and is told nothing at all about this file — not that
    // it is walled, and not that its text is pending.
    const { document, version } = await contractWithFile("Text · walled document", {
      filename: "board-pack.pdf",
      contentType: "application/pdf",
      content: nativeTextPdf("a walled document on an open contract"),
    });
    await markDocumentConfidential(document.id);

    const refused = await readText(outsiderCookies, document.id, version.id);
    const control = await readText(outsiderCookies, document.id, NEVER_CREATED);
    expect(refused.statusCode).toBe(404);
    expect(control.statusCode).toBe(404);
    expect(withoutInstance(refused.json())).toEqual(withoutInstance(control.json()));
  }, 60_000);

  it("refuses a Business User the whole surface, as every document read does", async () => {
    const { document, version } = await contractWithFile("Text · business user", {
      filename: "msa.pdf",
      contentType: "application/pdf",
      content: nativeTextPdf("a contract a Business User has no business in"),
    });
    const businessUser = {
      email: "doctext-business@example.com",
      displayName: "Bea Business",
      password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
    } as const;
    const user = await provisionUser(harness.app.auth, businessUser);
    await harness.db.update(users).set({ role: "business_user" }).where(eq(users.id, user.id));
    const cookies = await signInCookies(harness.app, businessUser.email, businessUser.password);

    const res = await readText(cookies, document.id, version.id);
    expect(res.statusCode).toBe(403);
  }, 60_000);

  it("refuses a stranger, before anything is said about text", async () => {
    const { document, version } = await contractWithFile("Text · signed out", {
      filename: "msa.pdf",
      contentType: "application/pdf",
      content: nativeTextPdf("nobody signed in reads this"),
    });

    const res = await harness.app.inject({
      method: "GET",
      url: `/api/v1/documents/${document.id}/versions/${version.id}/text`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("answers a version of another document as one that does not exist", async () => {
    // A version's id says nothing about which document it belongs to, so
    // the read asks for both and refuses a mismatched pair the same way
    // the download and the preview do.
    const first = await contractWithFile("Text · pair a", {
      filename: "a.pdf",
      contentType: "application/pdf",
      content: nativeTextPdf("document a"),
    });
    const second = await contractWithFile("Text · pair b", {
      filename: "b.pdf",
      contentType: "application/pdf",
      content: nativeTextPdf("document b"),
    });

    const refused = await readText(memberCookies, first.document.id, second.version.id);
    const control = await readText(memberCookies, first.document.id, NEVER_CREATED);
    expect(refused.statusCode).toBe(404);
    expect(withoutInstance(refused.json())).toEqual(withoutInstance(control.json()));
  }, 60_000);
});
