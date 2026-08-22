// SPDX-License-Identifier: AGPL-3.0-only

/** Comment paper (CMT-011) at the HTTP and storage seams. */

import { readdir } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  commentAttachments,
  comments,
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
