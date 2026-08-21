// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Request attachments (#380): the paper that travels with the ask, at
 * the seam the portal form actually posts it to.
 *
 * Three things are the subject. **The upload**: one file per call
 * through the storage seam, a `request_attachments` row, and no
 * `documents` row — a Request is not a document owner (DOC-008).
 * **The scoping**: another requester can neither list the paper nor
 * download it, and cannot put any there (DD-013). **The download**: the
 * bytes come back behind the session, under the name the file arrived
 * with.
 *
 * How the storage adapter itself behaves is the driver contract suite's
 * subject and is not re-asserted here.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, documents, eq, requestAttachments, requests, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies as harnessSignInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const REQUESTER = {
  email: "tom.iwu@acme.com",
  displayName: "Tom Iwu",
  password: "correct-horse-battery",
} as const;

const OTHER_REQUESTER = {
  email: "dana.okafor@acme.com",
  displayName: "Dana Okafor",
  password: "correct-horse-battery",
} as const;

/** What the detail read answers about one attachment. */
interface AttachmentRow {
  id: string;
  filename: string;
  createdAt: string;
}

let harness: TestHarness;
let adminCookies: Record<string, string>;
let requesterCookies: Record<string, string>;
let otherCookies: Record<string, string>;
let requesterId: string;
/** The INT-002 seed this suite submits against. */
let contractReviewId: string;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);

  for (const fixture of [REQUESTER, OTHER_REQUESTER]) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role: "business_user" }).where(eq(users.id, user.id));
    if (fixture === REQUESTER) requesterId = user.id;
  }

  adminCookies = await harnessSignInCookies(harness.app, ADMIN.email, ADMIN.password);
  requesterCookies = await harnessSignInCookies(harness.app, REQUESTER.email, REQUESTER.password);
  otherCookies = await harnessSignInCookies(
    harness.app,
    OTHER_REQUESTER.email,
    OTHER_REQUESTER.password,
  );

  const types = await harness.app.inject({
    method: "GET",
    url: "/api/v1/request-types",
    cookies: adminCookies,
  });
  expect(types.statusCode, types.body).toBe(200);
  contractReviewId = (types.json().requestTypes as { slug: string; id: string }[]).find(
    (row) => row.slug === "contract_review",
  )!.id;
}, 120_000);

afterAll(async () => {
  await harness.stop();
});

const BOUNDARY = "openlaw-test-boundary-4174746368";

/** One `multipart/form-data` body carrying a single file part. */
function filePart(filename: string, content: Buffer, field = "file") {
  const head = Buffer.from(
    `--${BOUNDARY}\r\n` +
      `content-disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
      "content-type: application/pdf\r\n\r\n",
  );
  return {
    payload: Buffer.concat([head, content, Buffer.from(`\r\n--${BOUNDARY}--\r\n`)]),
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

/** Submits a Request and answers its R-### number. */
async function submitted(cookies = requesterCookies): Promise<number> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/requests",
    cookies,
    payload: {
      requestTypeId: contractReviewId,
      summary: "MSA renewal with Orion Cloud",
      description: "They sent a redline on the liability cap.",
      urgency: "high",
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().request.number as number;
}

/** The raw upload answer — the refusals are as much the subject as the
 * successes, so nothing here requires a status. */
function attach(
  number: number,
  options: { filename?: string; content?: Buffer; cookies?: Record<string, string> } = {},
) {
  const { payload, headers } = filePart(
    options.filename ?? "orion-msa-redline-v3.pdf",
    options.content ?? Buffer.from("the redline"),
  );
  return harness.app.inject({
    method: "POST",
    url: `/api/v1/requests/${number}/attachments`,
    cookies: options.cookies ?? requesterCookies,
    headers,
    payload,
  });
}

/** Attaches, requiring success, and answers the created row. */
async function attached(
  number: number,
  options: Parameters<typeof attach>[1] = {},
): Promise<AttachmentRow> {
  const res = await attach(number, options);
  expect(res.statusCode, res.body).toBe(201);
  return res.json().attachment as AttachmentRow;
}

/** The detail read a requester's own page draws from. */
async function detail(number: number, cookies = requesterCookies) {
  return await harness.app.inject({
    method: "GET",
    url: `/api/v1/portal/requests/${number}`,
    cookies,
  });
}

async function listed(number: number, cookies = requesterCookies): Promise<AttachmentRow[]> {
  const res = await detail(number, cookies);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().attachments as AttachmentRow[];
}

/**
 * How many attachment blobs the local driver is holding.
 *
 * Counted off the filesystem rather than asked of the adapter: the seam
 * has no list operation, and what a refused upload must not leave behind
 * is a file. The key layout is the driver's — a key is a path under the
 * root — so one directory holds every attachment this suite wrote.
 */
async function storedBlobCount(): Promise<number> {
  const dir = join(harness.storageRoot, "request-attachments");
  return await readdir(dir).then(
    (names) => names.length,
    () => 0,
  );
}

function download(number: number, attachmentId: string, cookies = requesterCookies) {
  return harness.app.inject({
    method: "GET",
    url: `/api/v1/portal/requests/${number}/attachments/${attachmentId}`,
    cookies,
  });
}

describe("attaching paper to a Request", () => {
  it("takes none, one, or several — and none is not an error", async () => {
    const bare = await submitted();
    expect(await listed(bare)).toEqual([]);

    const one = await submitted();
    await attached(one, { filename: "redline.pdf" });
    expect((await listed(one)).map((row) => row.filename)).toEqual(["redline.pdf"]);

    const several = await submitted();
    for (const filename of ["redline.pdf", "prior-agreement.pdf", "term-sheet.pdf"]) {
      await attached(several, { filename });
    }
    // Oldest first: the order the requester picked the files in.
    expect((await listed(several)).map((row) => row.filename)).toEqual([
      "redline.pdf",
      "prior-agreement.pdf",
      "term-sheet.pdf",
    ]);
  });

  it("writes a request_attachments row tied to the Request, and no documents row", async () => {
    const [before] = await harness.db.select({ documents: count() }).from(documents);
    const number = await submitted();
    const created = await attached(number, { filename: "redline.pdf" });

    const [request] = await harness.db
      .select({ id: requests.id })
      .from(requests)
      .where(eq(requests.number, number))
      .limit(1);
    const rows = await harness.db
      .select()
      .from(requestAttachments)
      .where(eq(requestAttachments.id, created.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.requestId).toBe(request!.id);
    expect(rows[0]!.filename).toBe("redline.pdf");
    expect(rows[0]!.uploadedBy).toBe(requesterId);
    // The storage seam's own reference shape (DOC-012), minted from the
    // id rather than from anything the uploader named.
    expect(rows[0]!.fileRef).toContain(created.id);
    expect(rows[0]!.fileRef).not.toContain("redline");

    // DOC-008: a Request is not a document owner, so nothing here
    // becomes a document until conversion promotes it (M21).
    const [after] = await harness.db.select({ documents: count() }).from(documents);
    expect(after!.documents).toBe(before!.documents);
  });

  it("refuses a file part with no name, and a body that is not multipart", async () => {
    const number = await submitted();
    const unnamed = await attach(number, { filename: "" });
    expect(unnamed.statusCode, unnamed.body).toBe(400);

    const notMultipart = await harness.app.inject({
      method: "POST",
      url: `/api/v1/requests/${number}/attachments`,
      cookies: requesterCookies,
      payload: { file: "the redline" },
    });
    expect(notMultipart.statusCode, notMultipart.body).toBe(415);
  });

  it("refuses a caller with no session", async () => {
    const number = await submitted();
    const { payload, headers } = filePart("redline.pdf", Buffer.from("the redline"));
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/requests/${number}/attachments`,
      headers,
      payload,
    });
    expect(res.statusCode, res.body).toBe(401);
  });

  it("bounds how much paper one ask carries", async () => {
    const number = await submitted();
    const [row] = await harness.db
      .select({ id: requests.id })
      .from(requests)
      .where(eq(requests.number, number))
      .limit(1);
    // Filled straight into the table rather than through twenty
    // uploads: what is asserted is the refusal at the bound, not the
    // twenty successes before it.
    await harness.db.insert(requestAttachments).values(
      Array.from({ length: 20 }, (_ignored, index) => ({
        requestId: row!.id,
        fileRef: `local:request-attachments/seeded-${index}`,
        filename: `seeded-${index}.pdf`,
        uploadedBy: requesterId,
      })),
    );
    const before = await storedBlobCount();
    const refused = await attach(number);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().detail).toContain("20");
    // The bytes reached the driver before the row was refused, so the
    // blob is taken away rather than left as an orphan (DOC-012).
    expect(await storedBlobCount()).toBe(before);
  });
});

describe("who reaches a Request's paper", () => {
  it("lets the requester download their own, under the name it arrived with", async () => {
    const number = await submitted();
    const created = await attached(number, {
      filename: "orion redline (v3).pdf",
      content: Buffer.from("the redline itself"),
    });

    const res = await download(number, created.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.rawPayload.toString()).toBe("the redline itself");
    // Never a type a client declared: the row stores none.
    expect(res.headers["content-type"]).toBe("application/octet-stream");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    const disposition = String(res.headers["content-disposition"]);
    expect(disposition).toContain("attachment;");
    expect(disposition).toContain("orion%20redline%20%28v3%29.pdf");
  });

  it("shows another requester neither the list nor the file", async () => {
    const number = await submitted();
    const created = await attached(number);

    // DD-013: to another requester the Request does not exist, so
    // neither does its paper — and both answers are the same 404 a
    // reference nobody has gets.
    const theirDetail = await detail(number, otherCookies);
    expect(theirDetail.statusCode, theirDetail.body).toBe(404);

    const theirDownload = await download(number, created.id, otherCookies);
    expect(theirDownload.statusCode, theirDownload.body).toBe(404);

    const theirUpload = await attach(number, { cookies: otherCookies });
    expect(theirUpload.statusCode, theirUpload.body).toBe(404);
  });

  it("refuses an attachment id that belongs to another Request", async () => {
    const mine = await submitted();
    const other = await submitted();
    const created = await attached(other, { filename: "elsewhere.pdf" });

    const res = await download(mine, created.id, requesterCookies);
    expect(res.statusCode, res.body).toBe(404);

    // And the reference nobody has reads exactly the same.
    const missing = await download(mine, "not-an-attachment", requesterCookies);
    expect(missing.statusCode, missing.body).toBe(404);
    expect(missing.json().detail).toBe(res.json().detail);
  });

  it("refuses a download with no session", async () => {
    const number = await submitted();
    const created = await attached(number);
    const res = await harness.app.inject({
      method: "GET",
      url: `/api/v1/portal/requests/${number}/attachments/${created.id}`,
    });
    expect(res.statusCode, res.body).toBe(401);
  });

  it("refuses paper on a Request nobody has", async () => {
    const res = await attach(999_999);
    expect(res.statusCode, res.body).toBe(404);
  });
});
