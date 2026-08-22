// SPDX-License-Identifier: AGPL-3.0-only

/** Comment paper (CMT-011) at the HTTP and storage seams. */

import { readdir } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  commentAttachments,
  comments,
  documentVersionRenditions,
  documents,
  documentVersions,
  documentVersionText,
  count,
  eq,
  requests,
  requestTypes,
  users,
} from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "paper-member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;
const CONTRIBUTOR = {
  email: "paper-contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery",
} as const;
const REQUESTER = {
  email: "paper-requester@example.com",
  displayName: "Tom Iwu",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let requesterCookies: Record<string, string>;
let memberId: string;
let contributorId: string;
let requestTypeId: string;

beforeAll(async () => {
  harness = await startHarness({ maxUploadBytes: 16 });
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);

  for (const [fixture, role] of [
    [MEMBER, "legal_team_member"],
    [CONTRIBUTOR, "contributor"],
    [REQUESTER, "business_user"],
  ] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, user.id));
    if (fixture === MEMBER) memberId = user.id;
    if (fixture === CONTRIBUTOR) contributorId = user.id;
  }
  adminCookies = await signInCookies(harness.app, ADMIN.email, ADMIN.password);
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
  contributorCookies = await signInCookies(harness.app, CONTRIBUTOR.email, CONTRIBUTOR.password);
  requesterCookies = await signInCookies(harness.app, REQUESTER.email, REQUESTER.password);

  const [type] = await harness.db
    .select({ id: requestTypes.id })
    .from(requestTypes)
    .where(eq(requestTypes.slug, "contract_review"));
  requestTypeId = type!.id;
});

afterAll(async () => {
  await harness.stop();
});

const BOUNDARY = "openlaw-comment-paper-boundary";

function multipart(
  fields: Record<string, string>,
  files: readonly { filename: string; content?: string; field?: string }[],
) {
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${BOUNDARY}\r\ncontent-disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  for (const file of files) {
    chunks.push(
      Buffer.from(
        `--${BOUNDARY}\r\n` +
          `content-disposition: form-data; name="${file.field ?? "file"}"; filename="${file.filename}"\r\n` +
          "content-type: application/pdf\r\n\r\n" +
          `${file.content ?? "paper"}\r\n`,
      ),
    );
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

async function contractWithContributor(title: string) {
  const options = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: adminCookies,
  });
  const type = (options.json().contractTypes as { id: string; slug: string }[]).find(
    (row) => row.slug === "nda",
  )!;
  const created = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: adminCookies,
    payload: { title, contractTypeId: type.id },
  });
  expect(created.statusCode, created.body).toBe(201);
  const contract = created.json().contract as { id: string; number: number };
  const added = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${contract.number}/team`,
    cookies: adminCookies,
    payload: { userId: contributorId, role: "contributor" },
  });
  expect(added.statusCode, added.body).toBe(201);
  return contract;
}

async function submittedRequest(summary: string): Promise<string> {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/requests",
    cookies: requesterCookies,
    payload: {
      requestTypeId,
      summary,
      description: "The counterparty returned its markup.",
      urgency: "high",
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().request.id as string;
}

function postMultipart(
  cookies: Record<string, string>,
  entityType: "contract" | "request",
  entityId: string,
  body: string,
  visibility: "legal_only" | "working_team" | "full_thread",
  files: readonly { filename: string; content?: string; field?: string }[],
  mentions: readonly string[] = [],
) {
  const form = multipart(
    {
      entityType,
      entityId,
      body,
      visibility,
      ...(mentions.length > 0 ? { mentions: JSON.stringify(mentions) } : {}),
    },
    files,
  );
  return harness.app.inject({
    method: "POST",
    url: "/api/v1/comments",
    cookies,
    ...form,
  });
}

function readThread(
  cookies: Record<string, string>,
  entityType: "contract" | "request",
  entityId: string,
) {
  return harness.app.inject({
    method: "GET",
    url: `/api/v1/comments?entityType=${entityType}&entityId=${entityId}`,
    cookies,
  });
}

function download(
  cookies: Record<string, string>,
  entityType: "contract" | "request",
  entityId: string,
  commentId: string,
  attachmentId: string,
) {
  return harness.app.inject({
    method: "GET",
    url:
      `/api/v1/comments/${commentId}/attachments/${attachmentId}` +
      `?entityType=${entityType}&entityId=${entityId}`,
    cookies,
  });
}

function fileAttachment(
  cookies: Record<string, string>,
  entityType: "contract" | "request",
  entityId: string,
  commentId: string,
  attachmentId: string,
  payload:
    | {
        destination: "new_document";
        kind:
          | "draft_ours"
          | "draft_theirs"
          | "redline_theirs"
          | "redline_ours"
          | "executed"
          | "amendment";
        name: string;
        isConfidential: boolean;
      }
    | {
        destination: "new_version";
        documentId: string;
        kind:
          | "draft_ours"
          | "draft_theirs"
          | "redline_theirs"
          | "redline_ours"
          | "executed"
          | "amendment";
        note?: string;
      },
) {
  return harness.app.inject({
    method: "POST",
    url:
      `/api/v1/comments/${commentId}/attachments/${attachmentId}/file` +
      `?entityType=${entityType}&entityId=${entityId}`,
    cookies,
    payload,
  });
}

async function blobCount(): Promise<number> {
  async function beneath(path: string): Promise<number> {
    const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
    let total = 0;
    for (const entry of entries) {
      total += entry.isDirectory() ? await beneath(`${path}/${entry.name}`) : 1;
    }
    return total;
  }
  return beneath(harness.storageRoot);
}

describe("posting comment attachments", () => {
  it("takes five file parts on a Contract and stores lightweight rows under id-only keys", async () => {
    const contract = await contractWithContributor("Five pieces of paper");
    const response = await postMultipart(
      memberCookies,
      "contract",
      contract.id,
      "Here are the rounds.",
      "working_team",
      Array.from({ length: 5 }, (_, index) => ({ filename: `round-${index + 1}.pdf` })),
      [contributorId],
    );
    expect(response.statusCode, response.body).toBe(201);
    const comment = response.json().comment as {
      id: string;
      attachments: { id: string; filename: string }[];
    };
    expect(comment.attachments.map((row) => row.filename)).toEqual([
      "round-1.pdf",
      "round-2.pdf",
      "round-3.pdf",
      "round-4.pdf",
      "round-5.pdf",
    ]);
    expect((response.json().comment as { mentions: { id: string }[] }).mentions).toEqual([
      expect.objectContaining({ id: contributorId }),
    ]);

    const rows = await harness.db
      .select()
      .from(commentAttachments)
      .where(eq(commentAttachments.commentId, comment.id));
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.uploadedBy === memberId)).toBe(true);
    for (const row of rows) {
      expect(row.fileRef).toContain(`${comment.id}/${row.id}`);
      expect(row.fileRef).not.toContain(row.filename);
      expect(row.filedDocumentId).toBeNull();
      expect(row.filedVersionId).toBeNull();
    }
  });

  it("takes multipart on a Request and preserves the paperless JSON response shape", async () => {
    const requestId = await submittedRequest("Paper on the request thread");
    const paper = await postMultipart(
      requesterCookies,
      "request",
      requestId,
      "The markup is attached.",
      "full_thread",
      [{ filename: "counterparty-markup.pdf", content: "markup" }],
    );
    expect(paper.statusCode, paper.body).toBe(201);
    expect(paper.json().comment.attachments).toHaveLength(1);

    const paperless = await harness.app.inject({
      method: "POST",
      url: "/api/v1/comments",
      cookies: requesterCookies,
      payload: {
        entityType: "request",
        entityId: requestId,
        body: "And one clarification.",
        visibility: "full_thread",
      },
    });
    expect(paperless.statusCode, paperless.body).toBe(201);
    expect(paperless.json().comment).not.toHaveProperty("attachments");

    const invalid = await harness.app.inject({
      method: "POST",
      url: "/api/v1/comments",
      cookies: requesterCookies,
      payload: {
        entityType: "request",
        entityId: requestId,
        body: "",
        visibility: "full_thread",
      },
    });
    expect(invalid.statusCode, invalid.body).toBe(400);
    expect(invalid.json().detail).toBe("That comment body is invalid. Invalid fields: body.");
  });

  it("refuses a sixth file and removes all blobs and rows from the attempted post", async () => {
    const contract = await contractWithContributor("Six is too many");
    const [commentsBefore] = await harness.db.select({ value: count() }).from(comments);
    const [rowsBefore] = await harness.db.select({ value: count() }).from(commentAttachments);
    const blobsBefore = await blobCount();
    const response = await postMultipart(
      memberCookies,
      "contract",
      contract.id,
      "Too much paper.",
      "working_team",
      Array.from({ length: 6 }, (_, index) => ({ filename: `extra-${index}.pdf` })),
    );
    expect(response.statusCode, response.body).toBe(413);
    expect(response.json().detail).toContain("5");
    const [commentsAfter] = await harness.db.select({ value: count() }).from(comments);
    const [rowsAfter] = await harness.db.select({ value: count() }).from(commentAttachments);
    expect(commentsAfter!.value).toBe(commentsBefore!.value);
    expect(rowsAfter!.value).toBe(rowsBefore!.value);
    expect(await blobCount()).toBe(blobsBefore);
  });

  it("uses the shared filename and size refusals without leaving a row or blob", async () => {
    const contract = await contractWithContributor("Refused paper");
    for (const [file, sentence] of [
      [
        { filename: `${"a".repeat(256)}.pdf`, content: "small" },
        "Rename the file to 255 characters or fewer before uploading it.",
      ],
      [{ filename: "large.pdf", content: "seventeen-bytes!!!" }, "16 byte upload limit"],
    ] as const) {
      const [rowsBefore] = await harness.db.select({ value: count() }).from(commentAttachments);
      const blobsBefore = await blobCount();
      const response = await postMultipart(
        memberCookies,
        "contract",
        contract.id,
        "This does not land.",
        "working_team",
        [file],
      );
      expect(response.statusCode, response.body).toBe(file.filename === "large.pdf" ? 413 : 400);
      expect(response.json().detail).toContain(sentence);
      const [rowsAfter] = await harness.db.select({ value: count() }).from(commentAttachments);
      expect(rowsAfter!.value).toBe(rowsBefore!.value);
      expect(await blobCount()).toBe(blobsBefore);
    }
  });
});

describe("the attachment inherits the comment's audience", () => {
  it("projects and downloads only paper in the reader's tier", async () => {
    const contract = await contractWithContributor("Tiered paper");
    const legal = await postMultipart(
      memberCookies,
      "contract",
      contract.id,
      "Legal strategy.",
      "legal_only",
      [{ filename: "strategy.pdf", content: "strategy" }],
    );
    const full = await postMultipart(
      memberCookies,
      "contract",
      contract.id,
      "Shared markup.",
      "full_thread",
      [{ filename: "shared markup.pdf", content: "shared" }],
    );
    const legalComment = legal.json().comment as {
      id: string;
      attachments: { id: string }[];
    };
    const fullComment = full.json().comment as {
      id: string;
      attachments: { id: string }[];
    };

    const memberThread = await readThread(memberCookies, "contract", contract.id);
    const contributorThread = await readThread(contributorCookies, "contract", contract.id);
    expect(memberThread.json().comments).toHaveLength(2);
    expect(contributorThread.json().comments).toHaveLength(1);
    expect(contributorThread.body).not.toContain("strategy.pdf");

    const hidden = await download(
      contributorCookies,
      "contract",
      contract.id,
      legalComment.id,
      legalComment.attachments[0]!.id,
    );
    expect(hidden.statusCode, hidden.body).toBe(404);
    const reached = await download(
      contributorCookies,
      "contract",
      contract.id,
      fullComment.id,
      fullComment.attachments[0]!.id,
    );
    expect(reached.statusCode, reached.body).toBe(200);
    expect(reached.rawPayload.toString()).toBe("shared");
    expect(String(reached.headers["content-disposition"])).toContain("shared%20markup.pdf");
    expect(reached.headers["cache-control"]).toBe("private, max-age=0, must-revalidate");
  });

  it("lets the portal Requester read and download Full Thread paper", async () => {
    const requestId = await submittedRequest("Portal paper");
    const posted = await postMultipart(
      memberCookies,
      "request",
      requestId,
      "Please review this.",
      "full_thread",
      [{ filename: "draft for requester.pdf", content: "draft" }],
    );
    const comment = posted.json().comment as { id: string; attachments: { id: string }[] };
    const thread = await readThread(requesterCookies, "request", requestId);
    expect(thread.statusCode, thread.body).toBe(200);
    expect(thread.body).toContain("draft for requester.pdf");
    const file = await download(
      requesterCookies,
      "request",
      requestId,
      comment.id,
      comment.attachments[0]!.id,
    );
    expect(file.statusCode, file.body).toBe(200);
    expect(file.rawPayload.toString()).toBe("draft");
  });

  it("keeps the portal download open after the Request thread follows its Contract", async () => {
    const requestId = await submittedRequest("Converted portal paper");
    const contract = await contractWithContributor("Converted request record");
    await harness.db
      .update(requests)
      .set({ status: "converted", convertedContractId: contract.id })
      .where(eq(requests.id, requestId));

    const posted = await postMultipart(
      requesterCookies,
      "request",
      requestId,
      "The counterparty sent this back.",
      "full_thread",
      [{ filename: "post-conversion-markup.pdf", content: "markup" }],
    );
    expect(posted.statusCode, posted.body).toBe(201);
    const comment = posted.json().comment as {
      id: string;
      entityType: string;
      entityId: string;
      attachments: { id: string }[];
    };
    expect(comment.entityType).toBe("contract");
    expect(comment.entityId).toBe(contract.id);

    const file = await download(
      requesterCookies,
      "request",
      requestId,
      comment.id,
      comment.attachments[0]!.id,
    );
    expect(file.statusCode, file.body).toBe(200);
    expect(file.rawPayload.toString()).toBe("markup");
  });
});

describe("corrections", () => {
  it("leaves attachments fixed on edit and hides them with a soft delete", async () => {
    const contract = await contractWithContributor("Fixed paper");
    const posted = await postMultipart(
      memberCookies,
      "contract",
      contract.id,
      "Original words.",
      "working_team",
      [{ filename: "fixed.pdf", content: "fixed" }],
    );
    const comment = posted.json().comment as { id: string; attachments: { id: string }[] };
    const attachmentId = comment.attachments[0]!.id;
    const edited = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/comments/${comment.id}`,
      cookies: memberCookies,
      payload: { body: "Changed words." },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json().comment.attachments).toEqual(comment.attachments);

    const removed = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/comments/${comment.id}`,
      cookies: memberCookies,
    });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json().comment).not.toHaveProperty("attachments");
    const [row] = await harness.db
      .select()
      .from(commentAttachments)
      .where(eq(commentAttachments.id, attachmentId));
    expect(row).toBeDefined();
    const hidden = await download(memberCookies, "contract", contract.id, comment.id, attachmentId);
    expect(hidden.statusCode, hidden.body).toBe(404);
  });

  it("redact deletes attachment blobs and rows with the body", async () => {
    const contract = await contractWithContributor("Redacted paper");
    const posted = await postMultipart(
      memberCookies,
      "contract",
      contract.id,
      "Wrong record.",
      "legal_only",
      [{ filename: "wrong.pdf", content: "wrong" }],
    );
    const comment = posted.json().comment as { id: string; attachments: { id: string }[] };
    const before = await blobCount();
    const redacted = await harness.app.inject({
      method: "POST",
      url: `/api/v1/comments/${comment.id}/redact`,
      cookies: adminCookies,
    });
    expect(redacted.statusCode, redacted.body).toBe(200);
    expect(redacted.json().comment).not.toHaveProperty("attachments");
    const rows = await harness.db
      .select()
      .from(commentAttachments)
      .where(eq(commentAttachments.commentId, comment.id));
    expect(rows).toEqual([]);
    expect(await blobCount()).toBe(before - 1);
  });
});

describe("filing comment attachments", () => {
  it("files a new root Document, narrates the source, marks the thread, and survives redaction", async () => {
    const contract = await contractWithContributor("Filed comment paper");
    const posted = await postMultipart(
      memberCookies,
      "contract",
      contract.id,
      "This is the first draft.",
      "legal_only",
      [{ filename: "first-draft.pdf", content: "%PDF-paper" }],
    );
    expect(posted.statusCode, posted.body).toBe(201);
    const source = posted.json().comment as {
      id: string;
      attachments: { id: string; filename: string }[];
    };
    const attachment = source.attachments[0]!;

    // Legal Only is a dialog default, not an API mandate: the filer may
    // deliberately clear it, and this write preserves that choice.
    const filed = await fileAttachment(
      memberCookies,
      "contract",
      contract.id,
      source.id,
      attachment.id,
      {
        destination: "new_document",
        kind: "draft_theirs",
        name: "Counterparty paper",
        isConfidential: false,
      },
    );
    expect(filed.statusCode, filed.body).toBe(201);
    const marker = filed.json().comment.attachments[0].filed;
    expect(marker).toMatchObject({
      documentTitle: "Counterparty paper",
      versionNumber: 1,
    });

    const [document] = await harness.db
      .select()
      .from(documents)
      .where(eq(documents.id, marker.documentId));
    const [version] = await harness.db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.id, marker.versionId));
    expect(document).toMatchObject({
      title: "Counterparty paper",
      contractId: contract.id,
      isConfidential: false,
      createdBy: memberId,
      folderId: null,
    });
    expect(version).toMatchObject({
      documentId: document!.id,
      versionNumber: 1,
      kind: "draft_theirs",
      note: null,
      originalFilename: "first-draft.pdf",
      mimeType: "application/pdf",
      createdBy: memberId,
    });

    const downloaded = await harness.app.inject({
      method: "GET",
      url: `/api/v1/documents/${document!.id}/versions/${version!.id}/download`,
      cookies: memberCookies,
    });
    expect(downloaded.statusCode, downloaded.body).toBe(200);
    expect(downloaded.rawPayload.toString()).toBe("%PDF-paper");

    const [activity] = await harness.db
      .select({ actorId: activityLog.actorId, payload: activityLog.payload })
      .from(activityLog)
      .where(eq(activityLog.action, "document.created"));
    expect(activity).toMatchObject({ actorId: memberId });
    expect(activity!.payload).toMatchObject({
      documentId: document!.id,
      versionId: version!.id,
      sourceCommentId: source.id,
    });

    const textOwed = await harness.db
      .select({ state: documentVersionText.state })
      .from(documentVersionText)
      .where(eq(documentVersionText.versionId, version!.id));
    expect(textOwed).toHaveLength(1);
    expect(["pending", "ready"]).toContain(textOwed[0]!.state);

    const redacted = await harness.app.inject({
      method: "POST",
      url: `/api/v1/comments/${source.id}/redact`,
      cookies: adminCookies,
    });
    expect(redacted.statusCode, redacted.body).toBe(200);
    expect(
      await harness.db.select().from(documents).where(eq(documents.id, document!.id)),
    ).toHaveLength(1);
    const stillDownloadable = await harness.app.inject({
      method: "GET",
      url: `/api/v1/documents/${document!.id}/versions/${version!.id}/download`,
      cookies: memberCookies,
    });
    expect(stillDownloadable.rawPayload.toString()).toBe("%PDF-paper");
  });

  it("appends the next numbered Version with its kind and note through the derivation path", async () => {
    const contract = await contractWithContributor("Filed revision");
    const first = await postMultipart(
      memberCookies,
      "contract",
      contract.id,
      "Original.",
      "working_team",
      [{ filename: "original.pdf", content: "%PDF-first" }],
    );
    const firstComment = first.json().comment as {
      id: string;
      attachments: { id: string }[];
    };
    const created = await fileAttachment(
      memberCookies,
      "contract",
      contract.id,
      firstComment.id,
      firstComment.attachments[0]!.id,
      {
        destination: "new_document",
        kind: "draft_ours",
        name: "Services agreement",
        isConfidential: false,
      },
    );
    const documentId = created.json().comment.attachments[0].filed.documentId as string;

    const second = await postMultipart(
      memberCookies,
      "contract",
      contract.id,
      "Our counter.",
      "working_team",
      [{ filename: "counter.docx", content: "PK\u0003\u0004counter" }],
    );
    const secondComment = second.json().comment as {
      id: string;
      attachments: { id: string }[];
    };
    const appended = await fileAttachment(
      memberCookies,
      "contract",
      contract.id,
      secondComment.id,
      secondComment.attachments[0]!.id,
      {
        destination: "new_version",
        documentId,
        kind: "redline_ours",
        note: "Held the liability cap.",
      },
    );
    expect(appended.statusCode, appended.body).toBe(201);
    const marker = appended.json().comment.attachments[0].filed;
    expect(marker).toMatchObject({
      documentId,
      documentTitle: "Services agreement",
      versionNumber: 2,
    });
    const [version] = await harness.db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.id, marker.versionId));
    expect(version).toMatchObject({
      documentId,
      versionNumber: 2,
      kind: "redline_ours",
      note: "Held the liability cap.",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      createdBy: memberId,
    });
    expect(
      await harness.db
        .select({ state: documentVersionRenditions.state })
        .from(documentVersionRenditions)
        .where(eq(documentVersionRenditions.versionId, version!.id)),
    ).toEqual([{ state: "pending" }]);

    const [activity] = await harness.db
      .select({ actorId: activityLog.actorId, payload: activityLog.payload })
      .from(activityLog)
      .where(eq(activityLog.action, "document.version_added"));
    expect(activity).toMatchObject({ actorId: memberId });
    expect(activity!.payload).toMatchObject({
      documentId,
      versionId: version!.id,
      versionNumber: 2,
      sourceCommentId: secondComment.id,
    });
  });

  it("carries the filed marker on reads and refuses a second filing with its destination", async () => {
    const contract = await contractWithContributor("One filing only");
    const posted = await postMultipart(
      memberCookies,
      "contract",
      contract.id,
      "File once.",
      "full_thread",
      [{ filename: "once.pdf", content: "%PDF-once" }],
    );
    const comment = posted.json().comment as { id: string; attachments: { id: string }[] };
    const first = await fileAttachment(
      memberCookies,
      "contract",
      contract.id,
      comment.id,
      comment.attachments[0]!.id,
      {
        destination: "new_document",
        kind: "draft_ours",
        name: "The only chain",
        isConfidential: false,
      },
    );
    const destination = first.json().comment.attachments[0].filed;

    const thread = await readThread(memberCookies, "contract", contract.id);
    expect(thread.json().comments[0].attachments[0].filed).toEqual(destination);

    const again = await fileAttachment(
      memberCookies,
      "contract",
      contract.id,
      comment.id,
      comment.attachments[0]!.id,
      {
        destination: "new_version",
        documentId: destination.documentId,
        kind: "redline_ours",
      },
    );
    expect(again.statusCode, again.body).toBe(409);
    expect(again.json()).toMatchObject({
      type: "urn:openlaw:problem:comment-attachment-already-filed",
      filedDocumentId: destination.documentId,
      filedVersionId: destination.versionId,
    });
    expect(again.json().detail).toContain("The only chain");
    expect(again.json().detail).toContain("version 1");
    expect(
      await harness.db
        .select()
        .from(documentVersions)
        .where(eq(documentVersions.documentId, destination.documentId)),
    ).toHaveLength(1);

    // DOC-010 may erase a whole chain. The composite filing FK clears
    // both marker columns together, so the database's paired invariant
    // cannot turn that lawful delete into a constraint failure.
    const erased = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/documents/${destination.documentId}`,
      cookies: adminCookies,
      payload: { confirmTitle: "The only chain" },
    });
    expect(erased.statusCode, erased.body).toBe(200);
    const afterErasure = await readThread(memberCookies, "contract", contract.id);
    expect(afterErasure.json().comments[0].attachments[0]).not.toHaveProperty("filed");
  });

  it("refuses non-Member roles and a Member filing from a never-converted Request", async () => {
    const contract = await contractWithContributor("Filing roles");
    const onContract = await postMultipart(
      memberCookies,
      "contract",
      contract.id,
      "Members only.",
      "full_thread",
      [{ filename: "roles.pdf", content: "%PDF-roles" }],
    );
    const contractComment = onContract.json().comment as {
      id: string;
      attachments: { id: string }[];
    };
    const body = {
      destination: "new_document" as const,
      kind: "draft_ours" as const,
      name: "Roles",
      isConfidential: false,
    };
    const contributor = await fileAttachment(
      contributorCookies,
      "contract",
      contract.id,
      contractComment.id,
      contractComment.attachments[0]!.id,
      body,
    );
    expect(contributor.statusCode, contributor.body).toBe(403);

    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/archive`,
      cookies: adminCookies,
    });
    expect(archived.statusCode, archived.body).toBe(200);
    const frozen = await fileAttachment(
      memberCookies,
      "contract",
      contract.id,
      contractComment.id,
      contractComment.attachments[0]!.id,
      body,
    );
    expect(frozen.statusCode, frozen.body).toBe(409);
    expect(frozen.json().detail).toContain("archived");

    const requestId = await submittedRequest("A Request owns no Documents");
    const onRequest = await postMultipart(
      requesterCookies,
      "request",
      requestId,
      "Portal paper.",
      "full_thread",
      [{ filename: "request.pdf", content: "%PDF-ask" }],
    );
    const requestComment = onRequest.json().comment as {
      id: string;
      attachments: { id: string }[];
    };
    const businessUser = await fileAttachment(
      requesterCookies,
      "request",
      requestId,
      requestComment.id,
      requestComment.attachments[0]!.id,
      body,
    );
    expect(businessUser.statusCode, businessUser.body).toBe(403);

    const memberOnRequest = await fileAttachment(
      memberCookies,
      "request",
      requestId,
      requestComment.id,
      requestComment.attachments[0]!.id,
      body,
    );
    expect(memberOnRequest.statusCode, memberOnRequest.body).toBe(409);
    expect(memberOnRequest.json().detail).toContain("does not own Documents");
  });

  it("keeps Confidential filing and its marker inside the Document's audience", async () => {
    const contract = await contractWithContributor("Confidential filing audience");
    const posted = await postMultipart(
      memberCookies,
      "contract",
      contract.id,
      "Legal eyes only.",
      "legal_only",
      [{ filename: "secret.pdf", content: "%PDF-secret" }],
    );
    const comment = posted.json().comment as { id: string; attachments: { id: string }[] };
    const attachmentId = comment.attachments[0]!.id;
    const body = {
      destination: "new_document" as const,
      kind: "draft_ours" as const,
      name: "Confidential paper",
      isConfidential: true,
    };

    // The contract names nobody yet, so a Member is outside DD-014's
    // audience for a Confidential Document and cannot file one.
    const unnamed = await fileAttachment(
      memberCookies,
      "contract",
      contract.id,
      comment.id,
      attachmentId,
      body,
    );
    expect(unnamed.statusCode, unnamed.body).toBe(403);
    expect(unnamed.json().detail).toContain("Confidential");

    const filed = await fileAttachment(
      adminCookies,
      "contract",
      contract.id,
      comment.id,
      attachmentId,
      body,
    );
    expect(filed.statusCode, filed.body).toBe(201);
    const marker = filed.json().comment.attachments[0].filed as { documentId: string };
    expect(marker.documentId).toBeTruthy();

    // The same Member hears the Legal Only comment but does not reach the
    // Document, so the thread shows plain paper and a retry is refused
    // without naming where it went.
    const unnamedRead = await readThread(memberCookies, "contract", contract.id);
    expect(unnamedRead.statusCode, unnamedRead.body).toBe(200);
    expect(unnamedRead.json().comments[0].attachments[0]).not.toHaveProperty("filed");
    const retry = await fileAttachment(
      memberCookies,
      "contract",
      contract.id,
      comment.id,
      attachmentId,
      body,
    );
    expect(retry.statusCode, retry.body).toBe(409);
    expect(retry.json().detail).not.toContain("Confidential paper");
    expect(retry.json()).not.toHaveProperty("filedDocumentId");

    const named = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/team`,
      cookies: adminCookies,
      payload: { userId: memberId, role: "member" },
    });
    expect(named.statusCode, named.body).toBe(201);
    const namedRead = await readThread(memberCookies, "contract", contract.id);
    expect(namedRead.json().comments[0].attachments[0].filed).toMatchObject({
      documentId: marker.documentId,
      documentTitle: "Confidential paper",
      versionNumber: 1,
    });
  });
});
