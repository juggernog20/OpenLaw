// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Word and PowerPoint previews, converted for display (M12/4, DOC-004)
 * at the HTTP seam.
 *
 * **Nothing here reaches into the pipeline.** A suite uploads a Word
 * draft over HTTP and then polls the same rendition read the doc panel
 * polls, until the conversion lands — then opens the same preview
 * address the panel opens. The real pg-boss queue and the real handlers
 * run in this process against the harness's Postgres; only the doc
 * engine is faked, and it is faked deterministically, so the suite
 * states the bytes and the text it expects rather than reading back
 * whatever appeared.
 *
 * **The rendition is what previews; the original is what downloads.**
 * Every case that reads a preview also reads the download, because the
 * whole promise is that a machine's conversion never becomes the record
 * (DOC-001, DOC-005).
 *
 * **Text comes out of the rendition** — one extraction path, over PDF.
 * A converted Word document's text read answers `rendition`, not
 * `native_layer`, because the two are not equally trustworthy and the
 * read says which it holds.
 *
 * **A terminal failure says so plainly and offers the download.** The
 * upload is never blocked or failed by its pipeline, and neither the
 * preview nor the text is left pending for ever.
 *
 * **The new reads open no side door past the contract gate** (DOC-008,
 * DD-014). Refusals are written the M10 way: every one is sent twice,
 * once at the real address and once at an id nothing was ever created
 * under, and the two problem bodies must be one body.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { documentVersionRenditions, eq, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import { fakeConversionText } from "../../lib/doc-engine/fake.js";
import { DOCX_MIME_TYPE, PPTX_MIME_TYPE, officePackage } from "../../testing/fixtures/office.js";
import { testDeps } from "../../testing/deps.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";
import { buildApp } from "../../app.js";
import { createUnconfiguredJobQueue } from "../../pipeline/jobs.js";

/** A Legal Team Member on the contract's team, who uploads everything
 * here and reads it back. */
const MEMBER = {
  email: "docrend-member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;
/** A Contributor on the team: read access means reading, on every
 * surface (DD-015, CTR-021). */
const CONTRIBUTOR = {
  email: "docrend-contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;
/** A Legal Team Member with no team row. They read every open contract,
 * and nothing of a confidential one — nor of a confidential document on
 * an open one. */
const OUTSIDER = {
  email: "docrend-outsider@example.com",
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

/** What the display-rendition read answers. */
interface RenditionRow {
  state: "pending" | "ready" | "failed" | "unsupported";
  updatedAt: string | null;
}

/** What the extracted-text read answers. */
interface TextRow {
  state: "pending" | "ready" | "failed" | "unsupported";
  source: "native_layer" | "ocr" | "rendition" | null;
  text: string | null;
  updatedAt: string | null;
}

/** An id nothing was ever created under — the control every refusal is
 * compared against. */
const NEVER_CREATED = "0198f2ab-0000-7000-8000-0000000034cd";

/** The declared type a browser sends for a .docx, and for a .pptx. */
const DOCX = DOCX_MIME_TYPE;
const PPTX = PPTX_MIME_TYPE;

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

const BOUNDARY = "openlaw-test-boundary-72656e64";

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

const currentOf = (document: DocumentRow): VersionRow => {
  const current = document.versions.filter((version) => version.isCurrent);
  expect(current.length, "exactly one current version").toBe(1);
  return current[0]!;
};

/** `instance` is the URL the client itself asked for, so it is the one
 * field two refusals at two addresses are allowed to differ in. */
const withoutInstance = (body: Record<string, unknown>) => ({ ...body, instance: undefined });

const readRendition = (cookies: Record<string, string>, documentId: string, versionId: string) =>
  harness.app.inject({
    method: "GET",
    url: `/api/v1/documents/${documentId}/versions/${versionId}/rendition`,
    cookies,
  });

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

/** How long a conversion is given before the suite calls it stuck. The
 * fake engine is a memcpy, so this is slack for the queue, not for the
 * work. */
const SETTLE_TIMEOUT_MS = 20_000;

/**
 * Polls the rendition read the way the doc panel does, until the
 * conversion stops being owed.
 *
 * This is the whole shape of an M12 assertion: nothing looks inside the
 * queue, nothing waits on a handler's promise, and nothing reads the
 * table. The suite asks the same question a client asks, as often as a
 * client would, and states what the answer must become.
 */
async function settledRendition(documentId: string, versionId: string): Promise<RenditionRow> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let last: RenditionRow | undefined;
  while (Date.now() < deadline) {
    const res = await readRendition(memberCookies, documentId, versionId);
    expect(res.statusCode, res.body).toBe(200);
    last = res.json().rendition as RenditionRow;
    if (last.state !== "pending") return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `the conversion for version ${versionId} was still pending after ${SETTLE_TIMEOUT_MS}ms: ` +
      `${JSON.stringify(last)}\n${JSON.stringify(harness.jobLog, null, 2)}`,
  );
}

/** The same, for the text the conversion job reads out of the
 * rendition. */
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
    `the text for version ${versionId} was still pending after ${SETTLE_TIMEOUT_MS}ms: ` +
      `${JSON.stringify(last)}\n${JSON.stringify(harness.jobLog, null, 2)}`,
  );
}

/** Whether a blob is still in the store. The stream is closed straight
 * away: this asks a question about the store, and a handle left open
 * outlives the assertion that opened it. */
async function isStored(fileRef: string): Promise<boolean> {
  try {
    (await harness.storage.get(fileRef)).destroy();
    return true;
  } catch {
    return false;
  }
}

/** A one-document contract whose only file is `file`. */
async function contractWithFile(title: string, file: FileSpec) {
  const contract = await newContract(title);
  const document = await uploaded(contract.number, file);
  return { contract, document, version: currentOf(document) };
}

describe("previewing a Word draft in the app", () => {
  it("converts it to a PDF the preview streams, tracked changes and all", async () => {
    // The milestone's demo sentence. The fake engine cannot read a Word
    // document, so what stands in for fidelity here is the round trip:
    // the conversion carries a text the suite can name, and the same
    // text comes back out of the rendition. The tracked-changes fidelity
    // itself is proved against the real image, in the doc-engine
    // contract suite.
    const bytes = officePackage("a counterparty's redline of the NDA");
    const { document, version } = await contractWithFile("Rendition · word", {
      filename: "nda-redline.docx",
      contentType: DOCX,
      content: bytes,
    });

    // The panel is told which surface to open before anything is drawn.
    expect(version.renderFamily).toBe("word");

    const rendition = await settledRendition(document.id, version.id);
    expect(rendition.state).toBe("ready");
    expect(rendition.updatedAt).not.toBeNull();

    // The preview streams the conversion, under the type this server
    // chose, inline, and with sniffing off.
    const previewed = await preview(memberCookies, document.id, version.id);
    expect(previewed.statusCode, previewed.body).toBe(200);
    expect(previewed.headers["content-type"]).toBe("application/pdf");
    expect(previewed.headers["content-disposition"]).toContain("inline");
    expect(previewed.headers["x-content-type-options"]).toBe("nosniff");
    expect(previewed.headers["content-length"]).toBe(String(previewed.rawPayload.byteLength));
    // It is a PDF, and it is not the uploaded file.
    expect(previewed.rawPayload.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(previewed.rawPayload.equals(bytes)).toBe(false);

    // And the download is untouched: it still answers the very bytes
    // that were uploaded (DOC-001). A machine's conversion never becomes
    // the record.
    const downloaded = await download(memberCookies, document.id, version.id);
    expect(downloaded.statusCode, downloaded.body).toBe(200);
    expect(downloaded.rawPayload.equals(bytes)).toBe(true);
    expect(downloaded.headers["content-disposition"]).toContain("attachment");
  });

  it("reads the converted rendition's text, and says that is where it came from", async () => {
    // One extraction path, over PDF (DOC-005). A Word document's words
    // are read out of the PDF it was converted to, and the read names
    // that source — a conversion's text is not the same fact as a PDF's
    // own text layer.
    const bytes = officePackage("a master services agreement, in Word");
    const { document, version } = await contractWithFile("Rendition · word text", {
      filename: "msa.docx",
      contentType: DOCX,
      content: bytes,
    });

    const text = await settledText(document.id, version.id);
    expect(text.state).toBe("ready");
    expect(text.source).toBe("rendition");
    expect(text.text).toBe(fakeConversionText("docx", bytes));
  });

  it("says its text is coming, from the moment it is uploaded", async () => {
    const { document, version } = await contractWithFile("Rendition · word pending", {
      filename: "draft.docx",
      contentType: DOCX,
      content: officePackage("a draft whose text is owed"),
    });

    // Never `unsupported`, which is what M12/3 answered: a Word document
    // does have text, so a caller polls rather than stopping. Asserted
    // as "not that" rather than as "pending", because the conversion is
    // allowed to have landed already and a suite that raced it would be
    // flaky about the wrong thing.
    const first = await readText(memberCookies, document.id, version.id);
    expect(first.statusCode, first.body).toBe(200);
    expect((first.json().text as TextRow).state).not.toBe("unsupported");

    expect((await settledText(document.id, version.id)).state).toBe("ready");
  });
});

describe("previewing a PowerPoint deck in the app", () => {
  it("rides the same path as Word", async () => {
    const bytes = officePackage("board materials for the December meeting");
    const { document, version } = await contractWithFile("Rendition · deck", {
      filename: "board-pack.pptx",
      contentType: PPTX,
      content: bytes,
    });
    expect(version.renderFamily).toBe("presentation");

    expect((await settledRendition(document.id, version.id)).state).toBe("ready");
    const previewed = await preview(memberCookies, document.id, version.id);
    expect(previewed.statusCode, previewed.body).toBe(200);
    expect(previewed.headers["content-type"]).toBe("application/pdf");

    const text = await settledText(document.id, version.id);
    expect(text.source).toBe("rendition");
    expect(text.text).toBe(fakeConversionText("pptx", bytes));
  });
});

describe("a file that needs no conversion", () => {
  it("says so plainly rather than leaving a caller polling", async () => {
    const { document, version } = await contractWithFile("Rendition · pdf", {
      filename: "msa.pdf",
      contentType: "application/pdf",
      content: Buffer.from("%PDF-1.7 a born-digital agreement"),
    });

    const res = await readRendition(memberCookies, document.id, version.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().rendition).toEqual({ state: "unsupported", updatedAt: null });

    // And its preview is still its own bytes, under its own type.
    const previewed = await preview(memberCookies, document.id, version.id);
    expect(previewed.statusCode, previewed.body).toBe(200);
    expect(previewed.headers["content-type"]).toBe("application/pdf");
  });

  it("says the same of a spreadsheet, which never previews at all", async () => {
    const { document, version } = await contractWithFile("Rendition · sheet", {
      filename: "fees.xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const res = await readRendition(memberCookies, document.id, version.id);
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json().rendition as RenditionRow).state).toBe("unsupported");
    const previewed = await preview(memberCookies, document.id, version.id);
    expect(previewed.statusCode).toBe(415);
  });
});

describe("when a conversion fails terminally", () => {
  it("says so plainly, offers the download, and leaves the upload alone", async () => {
    // A file that calls itself a Word document and is not one. The
    // engine refuses it terminally: no retry reads the same bytes
    // differently.
    const bytes = Buffer.from("Dear Nadia, the agreement is attached. Kind regards.");
    const { document, version } = await contractWithFile("Rendition · not a docx", {
      filename: "agreement.docx",
      contentType: DOCX,
      content: bytes,
    });

    const rendition = await settledRendition(document.id, version.id);
    expect(rendition.state).toBe("failed");

    // The preview says so with the download offered beside it, rather
    // than drawing a broken surface or answering 404.
    const previewed = await preview(memberCookies, document.id, version.id);
    expect(previewed.statusCode).toBe(415);
    expect(previewed.json().detail).toMatch(/download/i);

    // The text is closed too. It was only ever going to come out of that
    // rendition, so leaving it pending would have a caller poll for
    // something nobody is bringing.
    const text = await settledText(document.id, version.id);
    expect(text.state).toBe("failed");
    expect(text.text).toBeNull();

    // The upload is untouched: the chain still holds the version, and
    // its bytes still come back. A failed conversion is a version with
    // no preview, never a broken upload.
    const downloaded = await download(memberCookies, document.id, version.id);
    expect(downloaded.statusCode, downloaded.body).toBe(200);
    expect(downloaded.rawPayload.equals(bytes)).toBe(true);

    // Why it failed is in the pipeline's log, where an operator reads
    // it. It is not an activity entry: conversion is a system act, and
    // the feed narrates people (DD-017).
    expect(
      harness.jobLog
        .filter((line) => line.message === "display conversion failed")
        .some((line) => line.fields.versionId === version.id && line.fields.terminal === true),
    ).toBe(true);
  });
});

describe("when the queue cannot be reached", () => {
  it("still completes the upload, and still records the conversion as owed", async () => {
    // The same database and the same storage, behind a queue that
    // rejects everything — a pipeline that is down. An upload must not
    // notice (story 11), and the request must not be lost: the rendition
    // row is written in the upload's own transaction, so it survives a
    // send that never happened and M12/6's sweep is what picks it up.
    const detached = await buildApp({
      ...testDeps({
        db: harness.db,
        storage: harness.storage,
        docEngine: harness.docEngine,
        // Named rather than left to the default: the queue that rejects
        // everything is what this test is about.
        jobs: createUnconfiguredJobQueue(),
      }),
    });
    await detached.ready();
    try {
      const contract = await newContract("Rendition · no queue");
      const bytes = officePackage("uploaded while the worker was down");
      const document = await uploaded(
        contract.number,
        { filename: "draft.docx", contentType: DOCX, content: bytes },
        detached,
      );
      const version = currentOf(document);

      // The file is there and readable, exactly as in M11.
      const downloaded = await download(memberCookies, document.id, version.id);
      expect(downloaded.statusCode, downloaded.body).toBe(200);
      expect(downloaded.rawPayload.equals(bytes)).toBe(true);

      // And the conversion is owed, not lost.
      const res = await readRendition(memberCookies, document.id, version.id);
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json().rendition as RenditionRow).state).toBe("pending");
      const [row] = await harness.db
        .select({ state: documentVersionRenditions.state })
        .from(documentVersionRenditions)
        .where(eq(documentVersionRenditions.versionId, version.id));
      expect(row?.state).toBe("pending");

      // A preview asked for while it is still coming is told that, and
      // not told the file does not preview — the two are different facts
      // and only one of them is worth asking about again.
      const previewed = await preview(memberCookies, document.id, version.id);
      expect(previewed.statusCode).toBe(409);
    } finally {
      await detached.close();
    }
  });
});

describe("hard delete takes the rendition too", () => {
  it("removes the rendition's rows and its stored blob", async () => {
    const { document, version } = await contractWithFile("Rendition · erasure", {
      filename: "to-erase.docx",
      contentType: DOCX,
      content: officePackage("a Word draft somebody asked us to erase"),
    });
    expect((await settledRendition(document.id, version.id)).state).toBe("ready");

    const [before] = await harness.db
      .select({ fileRef: documentVersionRenditions.fileRef })
      .from(documentVersionRenditions)
      .where(eq(documentVersionRenditions.versionId, version.id));
    expect(before?.fileRef, "the rendition's stored reference").toBeTruthy();
    // The blob is really there before the erasure, or the assertion
    // below would pass against a rendition that was never written.
    expect(await isStored(before!.fileRef!)).toBe(true);

    const erased = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/documents/${document.id}`,
      cookies: adminCookies,
      payload: { confirmTitle: document.title },
    });
    expect(erased.statusCode, erased.body).toBe(200);

    // Lawful erasure erases everything, including what the machine made
    // (DOC-010).
    const remaining = await harness.db
      .select({ versionId: documentVersionRenditions.versionId })
      .from(documentVersionRenditions)
      .where(eq(documentVersionRenditions.versionId, version.id));
    expect(remaining).toEqual([]);
    expect(await isStored(before!.fileRef!)).toBe(false);
  });
});

describe("the rendition read is behind both gates", () => {
  it("lets a Contributor on the team read what they may download", async () => {
    const { document, version } = await contractWithFile("Rendition · contributor", {
      filename: "draft.docx",
      contentType: DOCX,
      content: officePackage("a draft the Contributor is on"),
    });
    expect((await settledRendition(document.id, version.id)).state).toBe("ready");

    const res = await readRendition(contributorCookies, document.id, version.id);
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json().rendition as RenditionRow).state).toBe("ready");
    // And reading means reading: the preview opens for them too.
    const previewed = await preview(contributorCookies, document.id, version.id);
    expect(previewed.statusCode, previewed.body).toBe(200);
  });

  it("answers a contract the reader cannot reach as one that does not exist", async () => {
    const { contract, document, version } = await contractWithFile("Rendition · walled contract", {
      filename: "confidential.docx",
      contentType: DOCX,
      content: officePackage("a walled contract"),
    });
    await markContractConfidential(contract.number);

    const refused = await readRendition(outsiderCookies, document.id, version.id);
    const control = await readRendition(outsiderCookies, NEVER_CREATED, NEVER_CREATED);
    expect(refused.statusCode).toBe(404);
    expect(control.statusCode).toBe(404);
    expect(withoutInstance(refused.json())).toEqual(withoutInstance(control.json()));

    // And the bytes, at the address the rendition would be streamed
    // from. Rendering opens no side door past the contract gate.
    const previewed = await preview(outsiderCookies, document.id, version.id);
    expect(previewed.statusCode).toBe(404);
  });

  it("answers a confidential document as one that was never uploaded", async () => {
    // DD-014's silent omission, on the new surface. The outsider reaches
    // the contract and is told nothing at all about this file — not that
    // it is walled, and not that its conversion is pending.
    const { document, version } = await contractWithFile("Rendition · walled document", {
      filename: "board-pack.pptx",
      contentType: PPTX,
      content: officePackage("a walled deck on an open contract"),
    });
    await markDocumentConfidential(document.id);

    const refused = await readRendition(outsiderCookies, document.id, version.id);
    const control = await readRendition(outsiderCookies, document.id, NEVER_CREATED);
    expect(refused.statusCode).toBe(404);
    expect(control.statusCode).toBe(404);
    expect(withoutInstance(refused.json())).toEqual(withoutInstance(control.json()));
  });

  it("refuses a Business User the whole surface, as every document read does", async () => {
    const { document, version } = await contractWithFile("Rendition · business user", {
      filename: "msa.docx",
      contentType: DOCX,
      content: officePackage("a contract a Business User has no business in"),
    });
    const businessUser = {
      email: "docrend-business@example.com",
      displayName: "Bea Business",
      password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
    } as const;
    const user = await provisionUser(harness.app.auth, businessUser);
    await harness.db.update(users).set({ role: "business_user" }).where(eq(users.id, user.id));
    const cookies = await signInCookies(harness.app, businessUser.email, businessUser.password);

    expect((await readRendition(cookies, document.id, version.id)).statusCode).toBe(403);
  });

  it("refuses a stranger, before anything is said about a conversion", async () => {
    const { document, version } = await contractWithFile("Rendition · signed out", {
      filename: "msa.docx",
      contentType: DOCX,
      content: officePackage("nobody signed in reads this"),
    });

    const res = await harness.app.inject({
      method: "GET",
      url: `/api/v1/documents/${document.id}/versions/${version.id}/rendition`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("answers a version of another document as one that does not exist", async () => {
    // A version's id says nothing about which document it belongs to, so
    // the read asks for both and refuses a mismatched pair the same way
    // the download, the preview, and the text read do.
    const first = await contractWithFile("Rendition · pair a", {
      filename: "a.docx",
      contentType: DOCX,
      content: officePackage("document a"),
    });
    const second = await contractWithFile("Rendition · pair b", {
      filename: "b.docx",
      contentType: DOCX,
      content: officePackage("document b"),
    });

    const refused = await readRendition(memberCookies, first.document.id, second.version.id);
    const control = await readRendition(memberCookies, first.document.id, NEVER_CREATED);
    expect(refused.statusCode).toBe(404);
    expect(withoutInstance(refused.json())).toEqual(withoutInstance(control.json()));
  });
});
