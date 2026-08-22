// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The paper follows a conversion (#421), at the HTTP seam both sides of
 * it read.
 *
 * The subject is what happens to the files a requester attached when
 * their ask becomes a record. Each one becomes an ordinary document at
 * version 1 at the record root, with its bytes intact, its facts read
 * off the blob, its own `document.created`, and the derivations any
 * upload is owed. Promotion **copies**: the requester's portal list and
 * the downloads behind it answer exactly as they did before, because the
 * Request is still their window onto the ask.
 *
 * Two edges are as much the subject as the successes. A Request that
 * carried no paper converts with no document and no sentence about
 * having promoted nothing. A conversion that fails once the copying has
 * started leaves nothing at all — no contract, no documents, and no blob
 * for a row that never committed (DOC-012).
 */

import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  and,
  contracts,
  documentVersions,
  eq,
  requestAttachments,
  requests,
  requestTypes,
  users,
} from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import { fakeExtractedText } from "../../lib/doc-engine/fake.js";
import {
  signInCookies as harnessSignInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const REQUESTER = {
  email: "tom.iwu@acme.com",
  displayName: "Tom Iwu",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;

const MEMBER = {
  email: "member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;

/** One document, as the record's own list answers it. */
interface DocumentRow {
  id: string;
  title: string;
  isPrimary: boolean;
  folderId: string | null;
  versions: {
    id: string;
    versionNumber: number;
    kind: string;
    originalFilename: string;
    mimeType: string;
    renderFamily: string;
    byteSize: number;
    checksumSha256: string;
  }[];
}

/** One attachment, as both request details answer it. */
interface AttachmentRow {
  id: string;
  filename: string;
  createdAt: string;
}

let harness: TestHarness;
let memberCookies: Record<string, string>;
let requesterCookies: Record<string, string>;
let memberId: string;
/** The seeded request type that targets the NDA contract type. */
let ndaRequestTypeId: string;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);

  for (const [fixture, role] of [
    [REQUESTER, "business_user"],
    [MEMBER, "legal_team_member"],
  ] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, user.id));
    if (fixture === MEMBER) memberId = user.id;
  }

  memberCookies = await harnessSignInCookies(harness.app, MEMBER.email, MEMBER.password);
  requesterCookies = await harnessSignInCookies(harness.app, REQUESTER.email, REQUESTER.password);

  const [type] = await harness.db
    .select({ id: requestTypes.id })
    .from(requestTypes)
    .where(eq(requestTypes.slug, "nda_request"))
    .limit(1);
  ndaRequestTypeId = type!.id;
});

afterAll(async () => {
  await harness.stop();
});

const BOUNDARY = "openlaw-test-boundary-4174746368";

/**
 * One `multipart/form-data` body carrying a single file part.
 *
 * The part declares `application/pdf` whatever is in it, exactly as the
 * portal form does. Nothing stores that declaration — `request_attachments`
 * holds no media type — so a promotion has no claim to trust and every
 * fact it writes has to come off the bytes.
 */
function filePart(filename: string, content: Buffer) {
  const head = Buffer.from(
    `--${BOUNDARY}\r\n` +
      `content-disposition: form-data; name="file"; filename="${filename}"\r\n` +
      "content-type: application/pdf\r\n\r\n",
  );
  return {
    payload: Buffer.concat([head, content, Buffer.from(`\r\n--${BOUNDARY}--\r\n`)]),
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

/** Submits one Request as the Business User. */
async function submit(summary: string): Promise<{ id: string; number: number }> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/requests",
    cookies: requesterCookies,
    payload: {
      requestTypeId: ndaRequestTypeId,
      summary,
      description: "For the pilot kicking off next month.",
      urgency: "high",
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().request as { id: string; number: number };
}

/** Attaches one file to a Request, requiring success. */
async function attach(number: number, filename: string, content: Buffer): Promise<AttachmentRow> {
  const { payload, headers } = filePart(filename, content);
  const res = await harness.app.inject({
    method: "POST",
    url: `/api/v1/requests/${number}/attachments`,
    cookies: requesterCookies,
    headers,
    payload,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().attachment as AttachmentRow;
}

/** Presses Convert, requiring success, and answers the C-### it made. */
async function convert(number: number, title: string): Promise<number> {
  const res = await harness.app.inject({
    method: "POST",
    url: `/api/v1/requests/${number}/convert`,
    cookies: memberCookies,
    payload: { title },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().request.convertedContract.number as number;
}

/** The record's paper, as the Documents section draws it — newest
 * first, which is the reverse of the order the files were promoted in. */
async function paperOn(contractNumber: number): Promise<DocumentRow[]> {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/contracts/${contractNumber}/documents`,
    cookies: memberCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().documents as DocumentRow[];
}

/** The promoted paper in the order it was promoted, which is the order
 * the requester attached it. */
async function promotedOn(contractNumber: number): Promise<DocumentRow[]> {
  return (await paperOn(contractNumber)).reverse();
}

/** One promoted version's bytes, straight off the record's download. */
async function downloaded(document: DocumentRow): Promise<Buffer> {
  const version = document.versions[0]!;
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/documents/${document.id}/versions/${version.id}/download`,
    cookies: memberCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.rawPayload;
}

/** The requester's own list of what they submitted. */
async function portalAttachments(number: number): Promise<AttachmentRow[]> {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/portal/requests/${number}`,
    cookies: requesterCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().attachments as AttachmentRow[];
}

/** Every entry on one record, oldest first. */
async function entriesOn(entityType: "request" | "contract", entityId: string) {
  return harness.db
    .select()
    .from(activityLog)
    .where(and(eq(activityLog.entityType, entityType), eq(activityLog.entityId, entityId)))
    .orderBy(activityLog.createdAt, activityLog.id);
}

/** The stored contract a conversion made, by its C-### number. */
async function contractNumbered(number: number) {
  const [row] = await harness.db
    .select()
    .from(contracts)
    .where(eq(contracts.number, number))
    .limit(1);
  return row!;
}

/** How many contracts exist right now — the all-or-nothing check. */
async function contractCount(): Promise<number> {
  return (await harness.db.select({ id: contracts.id }).from(contracts)).length;
}

/**
 * How many version blobs the local driver is holding.
 *
 * Counted off the filesystem rather than asked of the adapter: the seam
 * has no list operation, and what a refused conversion must not leave
 * behind is a file. Every version key is `documents/<id>/<id>`, so one
 * directory per document sits under the root.
 */
async function storedVersionBlobs(): Promise<number> {
  const dir = join(harness.storageRoot, "documents");
  const documentDirectories = await readdir(dir).then(
    (names) => names,
    () => [] as string[],
  );
  let blobs = 0;
  for (const name of documentDirectories) {
    blobs += (await readdir(join(dir, name))).length;
  }
  return blobs;
}

/** How long a derivation is given before the suite calls it stuck. The
 * fake engine is a memcpy, so this is slack for the queue, not for the
 * work. */
const SETTLE_TIMEOUT_MS = 20_000;

/**
 * Polls the extracted-text read the way the doc panel polls it, until
 * the derivation stops being owed.
 *
 * Nothing here looks inside the queue. A promoted version is asked the
 * same question a reader asks of an uploaded one, and the answer has to
 * become the same kind of answer.
 */
async function settledText(document: DocumentRow): Promise<{ state: string; text: string | null }> {
  const version = document.versions[0]!;
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let last: { state: string; text: string | null } | undefined;
  while (Date.now() < deadline) {
    const res = await harness.app.inject({
      method: "GET",
      url: `/api/v1/documents/${document.id}/versions/${version.id}/text`,
      cookies: memberCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    last = res.json().text as { state: string; text: string | null };
    if (last.state !== "pending") return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `the promoted version's text was still pending after ${SETTLE_TIMEOUT_MS}ms: ` +
      JSON.stringify(last),
  );
}

/** Where one attachment's bytes are stored — the reference a promotion
 * must copy from and must never move. */
async function attachmentRef(attachmentId: string): Promise<string> {
  const [row] = await harness.db
    .select({ fileRef: requestAttachments.fileRef })
    .from(requestAttachments)
    .where(eq(requestAttachments.id, attachmentId))
    .limit(1);
  return row!.fileRef;
}

/** The digest the version row has to carry, computed the way the copy
 * computes it. */
function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/** A PDF that carries its own words — what a requester attaches when
 * they attach a draft. */
const pdf = (label: string) => Buffer.from(`%PDF-1.7 ${label}`);

describe("promotion writes one ordinary document per attachment (INT-002, DOC-008)", () => {
  it("files each one at version 1 at the record root, in the order they were attached", async () => {
    const request = await submit("Northwind pilot NDA");
    const files = [
      { filename: "redline.pdf", content: pdf("the redline") },
      { filename: "prior-agreement.pdf", content: pdf("last year's paper") },
      { filename: "term-sheet.pdf", content: pdf("the heads of terms") },
    ];
    for (const file of files) await attach(request.number, file.filename, file.content);

    const contractNumber = await convert(request.number, "Northwind Labs — mutual NDA");
    const promoted = await promotedOn(contractNumber);
    expect(promoted.map((row) => row.title)).toEqual(files.map((file) => file.filename));

    for (const [index, document] of promoted.entries()) {
      const file = files[index]!;
      // The record root: a Request carries no folders, so there is no
      // destination to translate (DOC-011).
      expect(document.folderId).toBeNull();
      // One round, and it is round one. The M13 batch doctrine: a drop
      // is N ordinary documents, never one batch of anything.
      expect(document.versions).toHaveLength(1);
      const version = document.versions[0]!;
      expect(version.versionNumber).toBe(1);
      // A requester is one of our own people, so their paper is our
      // side's (CTR-014) — the upload route's own default.
      expect(version.kind).toBe("draft_ours");
      expect(version.originalFilename).toBe(file.filename);
      expect(version.byteSize).toBe(file.content.byteLength);
    }

    // CTR-014's designation, taken by whatever landed first, exactly as
    // it is on an upload.
    expect(promoted.map((row) => row.isPrimary)).toEqual([true, false, false]);
    expect((await contractNumbered(contractNumber)).primaryDocumentId).toBe(promoted[0]!.id);
  });

  it("copies the bytes to a key minted from the new ids, and never moves the blob", async () => {
    const request = await submit("The bytes have to arrive whole");
    const content = pdf("every byte of the redline");
    const attachment = await attach(request.number, "redline.pdf", content);
    const attachedRef = await attachmentRef(attachment.id);

    const contractNumber = await convert(request.number, "Northwind Labs — mutual NDA");
    const [document] = await promotedOn(contractNumber);
    const version = document!.versions[0]!;
    // Bytes intact, read back through the record's own download.
    expect(await downloaded(document!)).toEqual(content);
    expect(version.byteSize).toBe(content.byteLength);
    expect(version.checksumSha256).toBe(sha256(content));

    // The attachment's own blob is where it was: this is a copy, and the
    // requester's row still points at the bytes it always pointed at.
    expect(await attachmentRef(attachment.id)).toBe(attachedRef);
    // The document's key is minted from the two new ids (DOC-012) — and
    // never from the name the requester's machine chose.
    const [promoted] = await harness.db
      .select({ fileRef: documentVersions.fileRef })
      .from(documentVersions)
      .where(eq(documentVersions.id, version.id))
      .limit(1);
    expect(promoted!.fileRef).not.toBe(attachedRef);
    expect(promoted!.fileRef).toContain(document!.id);
    expect(promoted!.fileRef).toContain(version.id);
    expect(promoted!.fileRef).not.toContain("redline");
  });

  it("reads the media type off the blob rather than off the name", async () => {
    // The attachment stored no declaration and the upload part's own
    // `application/pdf` was never written down, so the bytes are the
    // only thing there is to read (the INT-002 M20/6 addendum).
    const request = await submit("One real PDF and one that only says it is");
    await attach(request.number, "redline.pdf", pdf("a real one"));
    await attach(request.number, "notes.pdf", Buffer.from("plain words, not a PDF"));

    const contractNumber = await convert(request.number, "Northwind Labs — mutual NDA");
    const [real, claimed] = await promotedOn(contractNumber);
    expect(real!.versions[0]!.mimeType).toBe("application/pdf");
    expect(real!.versions[0]!.renderFamily).toBe("pdf");
    // The name says PDF and the bytes do not, so the name loses. What is
    // stored is the widest thing that is always true.
    expect(claimed!.versions[0]!.mimeType).toBe("application/octet-stream");
  });

  it("narrates one document.created per file, naming where it landed", async () => {
    const request = await submit("Two files, two entries");
    await attach(request.number, "redline.pdf", pdf("one"));
    await attach(request.number, "prior-agreement.pdf", pdf("two"));

    const contractNumber = await convert(request.number, "Northwind Labs — mutual NDA");
    const contract = await contractNumbered(contractNumber);
    const entries = await entriesOn("contract", contract.id);
    const created = entries.filter((row) => row.action === "document.created");
    expect(created.map((row) => row.payload.title)).toEqual(["redline.pdf", "prior-agreement.pdf"]);
    for (const entry of created) {
      // The record root, said by name rather than left to be inferred
      // (DD-017) — the upload's own payload.
      expect(entry.payload.folderName).toBeNull();
      expect(entry.actorId).toBe(memberId);
    }
    // Nobody asked for the designation, so it gets its own entry beside
    // the creations, exactly as it does on a first upload.
    expect(entries.filter((row) => row.action === "document.primary_set")).toHaveLength(1);
  });

  it("owes the promoted round the derivations an upload is owed", async () => {
    const request = await submit("The pipeline owes it nothing special");
    const content = pdf("words a reader will search for");
    await attach(request.number, "redline.pdf", content);

    const contractNumber = await convert(request.number, "Northwind Labs — mutual NDA");
    const [document] = await promotedOn(contractNumber);
    const text = await settledText(document!);
    expect(text.state).toBe("ready");
    expect(text.text).toBe(fakeExtractedText(content));
  });
});

describe("promotion copies and never takes away (INT-002, story 28)", () => {
  it("leaves the requester's list and downloads answering exactly as before", async () => {
    const request = await submit("My window has to keep working");
    const content = pdf("the redline");
    const attachment = await attach(request.number, "redline.pdf", content);
    const before = await portalAttachments(request.number);

    await convert(request.number, "Northwind Labs — mutual NDA");

    expect(await portalAttachments(request.number)).toEqual(before);
    const download = await harness.app.inject({
      method: "GET",
      url: `/api/v1/portal/requests/${request.number}/attachments/${attachment.id}`,
      cookies: requesterCookies,
    });
    expect(download.statusCode, download.body).toBe(200);
    expect(download.rawPayload).toEqual(content);
    expect(download.headers["content-disposition"]).toContain("redline.pdf");
  });
});

describe("the two edges of a promotion", () => {
  it("converts a Request with no attachments with no document and no narration", async () => {
    const request = await submit("Nothing was attached to this one");
    const contractNumber = await convert(request.number, "Northwind Labs — mutual NDA");

    expect(await paperOn(contractNumber)).toEqual([]);
    const contract = await contractNumbered(contractNumber);
    expect(contract.primaryDocumentId).toBeNull();
    const actions = (await entriesOn("contract", contract.id)).map((row) => row.action);
    expect(actions).not.toContain("document.created");
    expect(actions).not.toContain("document.primary_set");
  });

  it("rolls a failure mid-promotion back whole, and leaves no blob behind", async () => {
    // The blob under the second attachment is taken away, so the copy of
    // the first has already been written when the second one cannot be
    // read. What must not survive that is anything at all: no contract,
    // no documents, no Request that thinks it was converted, and no
    // orphaned copy of the first file (DOC-012).
    const request = await submit("The second file is not there any more");
    await attach(request.number, "redline.pdf", pdf("the first one, which copies"));
    const missing = await attach(request.number, "prior-agreement.pdf", pdf("the second one"));
    await harness.storage.delete(await attachmentRef(missing.id));

    const contractsBefore = await contractCount();
    const blobsBefore = await storedVersionBlobs();
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/requests/${request.number}/convert`,
      cookies: memberCookies,
      payload: { title: "Northwind Labs — mutual NDA" },
    });
    expect(res.statusCode, res.body).toBe(500);

    expect(await contractCount()).toBe(contractsBefore);
    expect(await storedVersionBlobs()).toBe(blobsBefore);
    const [stored] = await harness.db
      .select({ status: requests.status, convertedContractId: requests.convertedContractId })
      .from(requests)
      .where(eq(requests.id, request.id))
      .limit(1);
    expect(stored!.status).toBe("new");
    expect(stored!.convertedContractId).toBeNull();
    // The paper the requester submitted is still theirs, both rows of
    // it: the one whose blob this suite removed is still listed, because
    // a failed conversion changes nothing on the Request.
    expect((await portalAttachments(request.number)).map((file) => file.filename)).toEqual([
      "redline.pdf",
      "prior-agreement.pdf",
    ]);
  });
});
