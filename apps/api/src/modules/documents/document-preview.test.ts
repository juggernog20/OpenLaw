// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The per-version preview read (M12/2, DOC-004) at the HTTP seam — the
 * bytes the doc panel draws.
 *
 * **The preview is the download's twin, and the two differ in exactly
 * two headers.** The suite asserts both sides of that: the preview goes
 * out inline under a type this server chose, and the download still goes
 * out as an attachment under the type the upload declared, unchanged
 * from M11. A change that improved one and forgot the other is what
 * these paired assertions are for.
 *
 * **The declared type reaches the routing and never the header.** An
 * upload that calls itself `text/html` gets no preview at all, and an
 * upload that calls itself `application/pdf` gets `application/pdf`
 * because the table says so, not because the row does. So the suite
 * uploads files that lie about themselves and reads the answer.
 *
 * **Rendering opens no side door past the contract gate** (DOC-008,
 * DD-014). The refusals are written the M10 way: every one is sent
 * twice, once at the real address and once at an id nothing was ever
 * created under, and the two problem bodies must be one body. A viewer
 * who cannot reach the contract, and a viewer outside a confidential
 * document's audience, are each answered exactly as for a document that
 * was never uploaded — on the preview as on every other read.
 *
 * **Any version in the chain previews.** Round three of a negotiation is
 * not more readable than round one, so the suite previews a superseded
 * round and requires its own bytes back.
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

/** A Legal Team Member on the contract's team, who uploads everything
 * here and previews it. */
const MEMBER = {
  email: "docprev-member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;
/** A Contributor on the team: they preview what they may download
 * (DD-015, CTR-021), because read access means reading on every
 * surface. */
const CONTRIBUTOR = {
  email: "docprev-contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;
/** A Legal Team Member with no team row. They read every open contract,
 * and nothing of a confidential one — nor of a confidential document on
 * an open one. */
const OUTSIDER = {
  email: "docprev-outsider@example.com",
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
  mimeType: string;
  renderFamily: string;
  isCurrent: boolean;
}

interface DocumentRow {
  id: string;
  title: string;
  versions: VersionRow[];
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

/** Uploads one document to a contract, requiring success. */
async function uploaded(number: number, file: FileSpec): Promise<DocumentRow> {
  const { payload, headers } = uploadBody(file);
  const res = await harness.app.inject({
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

/** A one-document contract whose only file is `file`. */
async function contractWithFile(title: string, file: FileSpec) {
  const contract = await newContract(title);
  const document = await uploaded(contract.number, file);
  return { contract, document, version: currentOf(document) };
}

describe("document preview", () => {
  it("streams a PDF inline, under the server's own type", async () => {
    const bytes = Buffer.from("%PDF-1.7 the signed original");
    const { document, version } = await contractWithFile("Preview · pdf", {
      filename: "msa.pdf",
      contentType: "application/pdf",
      content: bytes,
    });

    const res = await preview(memberCookies, document.id, version.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toContain("inline");
    expect(res.headers["content-disposition"]).toContain('filename="msa.pdf"');
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-length"]).toBe(String(bytes.length));
    // The bytes are the stored original, unchanged: the preview reads
    // what was uploaded and never a re-rendering of it (DOC-005).
    expect(res.rawPayload.equals(bytes)).toBe(true);
  });

  it("renders a raster image inline under its own exact type", async () => {
    const { document, version } = await contractWithFile("Preview · png", {
      filename: "signature-page.png",
      contentType: "image/png",
    });

    const res = await preview(memberCookies, document.id, version.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["content-disposition"]).toContain("inline");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("makes a preview response inert if a browser is navigated at it", async () => {
    const { document, version } = await contractWithFile("Preview · csp", {
      filename: "scan.jpg",
      contentType: "image/jpeg",
    });

    const res = await preview(memberCookies, document.id, version.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
    expect(res.headers["cache-control"]).toBe("private, max-age=0, must-revalidate");
  });

  it("refuses SVG plainly, because an inline SVG is a script", async () => {
    const { document, version } = await contractWithFile("Preview · svg", {
      filename: "seal.svg",
      contentType: "image/svg+xml",
    });

    // Routed as download-only, so the panel draws a card rather than a
    // broken preview.
    expect(version.renderFamily).toBe("other");
    const res = await preview(memberCookies, document.id, version.id);
    expect(res.statusCode, res.body).toBe(415);
    // And the download still works: refusing to render is not refusing
    // to hand over the file.
    const saved = await download(memberCookies, document.id, version.id);
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.headers["content-disposition"]).toContain("attachment");
  });

  it("refuses every family outside the render set, and offers the download instead", async () => {
    const { document, version } = await contractWithFile("Preview · xlsx", {
      filename: "fee-schedule.xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    expect(version.renderFamily).toBe("other");
    const res = await preview(memberCookies, document.id, version.id);
    expect(res.statusCode, res.body).toBe(415);
    expect(res.json().detail).toMatch(/download/i);
  });

  it("names the family the panel routes each of the other three on", async () => {
    // The family is what the web reads to decide which surface a version
    // opens on, and it is named from the moment of upload for every
    // family — not only the two this address streams itself. What the
    // preview then answers for a Word document or a deck is the
    // conversion's business, and `document-rendition.test.ts` owns it:
    // 409 while the job runs, the rendition's bytes once it lands, 415
    // with the download when it fails.
    const contract = await newContract("Preview · families");
    const word = await uploaded(contract.number, {
      filename: "draft.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const deck = await uploaded(contract.number, {
      filename: "board.pptx",
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    const mail = await uploaded(contract.number, {
      filename: "dispute.eml",
      contentType: "message/rfc822",
    });

    expect(currentOf(word).renderFamily).toBe("word");
    expect(currentOf(deck).renderFamily).toBe("presentation");
    expect(currentOf(mail).renderFamily).toBe("email");
  });

  it("refuses an email here, because a message is read at its own address", async () => {
    // The one family with no bytes to draw. It is not "not yet" and it
    // is not a conversion that might arrive: an email is answered as a
    // parsed message at the email read, so this address has nothing to
    // stream and says so instead of leaving a caller polling.
    const { document, version } = await contractWithFile("Preview · email", {
      filename: "dispute.eml",
      contentType: "message/rfc822",
    });

    const res = await preview(memberCookies, document.id, version.id);
    expect(res.statusCode, res.body).toBe(415);
    expect(res.json().detail).toMatch(/download/i);
  });

  it("never echoes the type the upload declared", async () => {
    // A file that calls itself HTML gets no preview, whatever it is
    // named — the declaration is a hint into the routing table and is
    // never a header the server writes back.
    const { document, version } = await contractWithFile("Preview · html", {
      filename: "invoice.html",
      contentType: "text/html",
    });

    const res = await preview(memberCookies, document.id, version.id);
    expect(res.statusCode, res.body).toBe(415);
    expect(res.headers["content-type"]).not.toContain("text/html");
  });

  it("routes on the filename when the upload declared nothing", async () => {
    const { document, version } = await contractWithFile("Preview · octet", {
      filename: "scan.JPG",
      contentType: "application/octet-stream",
    });

    expect(version.mimeType).toBe("application/octet-stream");
    expect(version.renderFamily).toBe("image");
    const res = await preview(memberCookies, document.id, version.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
  });

  it("previews any version in the chain, superseded rounds included", async () => {
    const contract = await newContract("Preview · chain");
    const first = await uploaded(contract.number, {
      filename: "round-one.pdf",
      contentType: "application/pdf",
      content: Buffer.from("%PDF round one"),
    });
    const after = await appended(first.id, {
      filename: "round-two.pdf",
      contentType: "application/pdf",
      content: Buffer.from("%PDF round two"),
    });

    const superseded = after.versions.find((version) => !version.isCurrent);
    expect(superseded, "the first round").toBeDefined();
    const res = await preview(memberCookies, after.id, superseded!.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.rawPayload.toString()).toBe("%PDF round one");
    expect(res.headers["content-disposition"]).toContain('filename="round-one.pdf"');
  });

  it("leaves the download exactly as M11 shipped it", async () => {
    const { document, version } = await contractWithFile("Preview · download", {
      filename: "msa.pdf",
      contentType: "application/pdf",
    });

    const res = await download(memberCookies, document.id, version.id);
    expect(res.statusCode, res.body).toBe(200);
    // The declared type, not the routed one, and an attachment: the
    // preview's arrival changed nothing about saving a file.
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toBeUndefined();
  });

  it("lets a Contributor on the team preview what they may download", async () => {
    const { document, version } = await contractWithFile("Preview · contributor", {
      filename: "msa.pdf",
      contentType: "application/pdf",
    });

    const res = await preview(contributorCookies, document.id, version.id);
    expect(res.statusCode, res.body).toBe(200);
  });

  it("answers a viewer who cannot reach the contract exactly as for a document that was never uploaded", async () => {
    const contract = await newContract("Preview · walled contract");
    const { id: documentId, versions } = await uploaded(contract.number, {
      filename: "msa.pdf",
      contentType: "application/pdf",
    });
    const versionId = versions[0]!.id;
    await markContractConfidential(contract.number);

    const walled = await preview(outsiderCookies, documentId, versionId);
    const absent = await preview(outsiderCookies, NEVER_CREATED, NEVER_CREATED);
    expect(walled.statusCode).toBe(404);
    // One answer, not two that happen to share a status code.
    expect(withoutInstance(walled.json())).toStrictEqual(withoutInstance(absent.json()));
  });

  it("answers a viewer outside a confidential document's audience the same way", async () => {
    // The contract itself is open, and the outsider reads everything
    // else on it. One file is walled off, and the preview must be as
    // silent as the list is (DD-014, DOC-008).
    const contract = await newContract("Preview · walled document");
    const open = await uploaded(contract.number, {
      filename: "open.pdf",
      contentType: "application/pdf",
    });
    const secret = await uploaded(contract.number, {
      filename: "secret.pdf",
      contentType: "application/pdf",
    });
    await markDocumentConfidential(secret.id);

    const reachable = await preview(outsiderCookies, open.id, currentOf(open).id);
    expect(reachable.statusCode, reachable.body).toBe(200);

    const walled = await preview(outsiderCookies, secret.id, currentOf(secret).id);
    const absent = await preview(outsiderCookies, NEVER_CREATED, NEVER_CREATED);
    expect(walled.statusCode).toBe(404);
    expect(withoutInstance(walled.json())).toStrictEqual(withoutInstance(absent.json()));
  });

  it("refuses a version of another document", async () => {
    const contract = await newContract("Preview · crossed ids");
    const one = await uploaded(contract.number, {
      filename: "one.pdf",
      contentType: "application/pdf",
    });
    const two = await uploaded(contract.number, {
      filename: "two.pdf",
      contentType: "application/pdf",
    });

    const crossed = await preview(memberCookies, one.id, currentOf(two).id);
    const absent = await preview(memberCookies, NEVER_CREATED, NEVER_CREATED);
    expect(crossed.statusCode).toBe(404);
    expect(withoutInstance(crossed.json())).toStrictEqual(withoutInstance(absent.json()));
  });

  it("turns nobody away who is not signed in with a refusal that says anything else", async () => {
    const { document, version } = await contractWithFile("Preview · anonymous", {
      filename: "msa.pdf",
      contentType: "application/pdf",
    });

    const res = await harness.app.inject({
      method: "GET",
      url: `/api/v1/documents/${document.id}/versions/${version.id}/preview`,
    });
    expect(res.statusCode).toBe(401);
  });
});
