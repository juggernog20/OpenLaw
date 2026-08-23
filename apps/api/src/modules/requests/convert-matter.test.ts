// SPDX-License-Identifier: AGPL-3.0-only

/** M22/8–9: Matter conversion and everything that follows it, at the HTTP seam. */
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  and,
  comments,
  commentLastRead,
  contracts,
  contractTypes,
  documents,
  documentVersions,
  eq,
  matters,
  matterStatuses,
  matterTeam,
  matterTypes,
  notifications,
  requestAttachments,
  requestTypes,
  users,
  type CommentVisibility,
} from "@openlaw/db";
import { REQUEST_DISPOSITIONED_PROBLEM_TYPE } from "@openlaw/shared";
import { fakeExtractedText } from "../../lib/doc-engine/fake.js";
import {
  dispositionScaffold,
  REQUESTER,
  settles,
  type DispositionScaffold,
} from "../../testing/disposition.js";
import { startHarness, TEST_ADMIN as ADMIN, type TestHarness } from "../../testing/harness.js";

let harness: TestHarness;
let cast: DispositionScaffold;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let otherMemberCookies: Record<string, string>;
let requesterCookies: Record<string, string>;
let requesterId: string;
let memberId: string;

let ordinaryMatterTypeId: string;
let requiredMatterTypeId: string;
let boundRequestTypeId: string;
let moduleOnlyRequestTypeId: string;
let retiredRequestTypeId: string;
let noTargetRequestTypeId: string;
let contractTargetRequestTypeId: string;
let carrySlug: string;
let staysSlug: string;
let requiredSlug: string;
let ownerSlug: string;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  cast = await dispositionScaffold(harness);
  ({ adminCookies, memberCookies, otherMemberCookies, requesterCookies, requesterId, memberId } =
    cast);
  ordinaryMatterTypeId = await createMatterType("Conversion dispute");
  requiredMatterTypeId = await createMatterType("Conversion investigation");

  const carry = await createField("Opposing party", "global", "text");
  carrySlug = carry.slug;
  const stays = await createField("Deal desk only", "global", "text");
  staysSlug = stays.slug;
  const required = await createField("Forum", "matter", "text");
  requiredSlug = required.slug;
  const owner = await createField("Business owner", "global", "user");
  ownerSlug = owner.slug;

  boundRequestTypeId = await createRequestType("Dispute intake", {
    targetModule: "matter",
    targetTypeId: ordinaryMatterTypeId,
  });
  moduleOnlyRequestTypeId = await createRequestType("Matter intake", { targetModule: "matter" });
  noTargetRequestTypeId = await createRequestType("Legal question", null);

  const [nda] = await harness.db
    .select({ id: requestTypes.id })
    .from(requestTypes)
    .where(eq(requestTypes.slug, "nda_request"));
  contractTargetRequestTypeId = nda!.id;

  const retiredMatterTypeId = await createMatterType("Retired conversion matter");
  retiredRequestTypeId = await createRequestType("Retired matter intake", {
    targetModule: "matter",
    targetTypeId: retiredMatterTypeId,
  });
  await harness.db
    .update(matterTypes)
    .set({ archivedAt: new Date() })
    .where(eq(matterTypes.id, retiredMatterTypeId));

  for (const fieldId of [carry.id, stays.id, owner.id]) {
    await attach("request-types", boundRequestTypeId, fieldId, false);
  }
  await attach("matter-types", ordinaryMatterTypeId, carry.id, false);
  await attach("matter-types", ordinaryMatterTypeId, owner.id, false);
  await attach("matter-types", requiredMatterTypeId, required.id, true);
});

afterAll(async () => harness.stop());

async function createMatterType(displayName: string): Promise<string> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/matter-types",
    cookies: adminCookies,
    payload: { displayName },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().matterType.id as string;
}

async function createField(displayName: string, moduleScope: string, fieldType: string) {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/fields",
    cookies: adminCookies,
    payload: { displayName, moduleScope, fieldType, fieldTag: "legal" },
  });
  expect(res.statusCode, res.body).toBe(201);
  return { id: res.json().field.id as string, slug: res.json().field.slug as string };
}

async function attach(registry: string, typeId: string, fieldId: string, isRequired: boolean) {
  const res = await harness.app.inject({
    method: "POST",
    url: `/api/v1/${registry}/${typeId}/fields`,
    cookies: adminCookies,
    payload: { fieldId, isRequired },
  });
  expect(res.statusCode, res.body).toBe(201);
}

async function createRequestType(
  displayName: string,
  target: { targetModule: "contract" | "matter"; targetTypeId?: string } | null,
): Promise<string> {
  const created = await harness.app.inject({
    method: "POST",
    url: "/api/v1/request-types",
    cookies: adminCookies,
    payload: { displayName },
  });
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json().requestType.id as string;
  if (target) {
    const pointed = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/request-types/${id}`,
      cookies: adminCookies,
      payload: { targetModule: target.targetModule, targetTypeId: target.targetTypeId ?? null },
    });
    expect(pointed.statusCode, pointed.body).toBe(200);
  }
  return id;
}

async function submit(
  summary: string,
  typeId = boundRequestTypeId,
  customFields: Record<string, unknown> = {},
  urgency = "high",
) {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/requests",
    cookies: requesterCookies,
    payload: {
      requestTypeId: typeId,
      summary,
      description: "Please open this as legal work.",
      urgency,
      customFields,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().request as { id: string; number: number };
}

function convert(number: number, body: Record<string, unknown>, cookies = memberCookies) {
  return harness.app.inject({
    method: "POST",
    url: `/api/v1/requests/${number}/convert`,
    cookies,
    payload: body,
  });
}

async function matterNumbered(number: number) {
  const [row] = await harness.db.select().from(matters).where(eq(matters.number, number));
  return row!;
}

async function matterCount() {
  return (await harness.db.select({ id: matters.id }).from(matters)).length;
}

const BOUNDARY = "openlaw-matter-conversion-boundary";

interface AttachmentRow {
  id: string;
  filename: string;
}

interface DocumentRow {
  id: string;
  title: string;
  isPrimary: boolean;
  folderId: string | null;
  versions: {
    id: string;
    versionNumber: number;
    originalFilename: string;
    byteSize: number;
    checksumSha256: string;
  }[];
}

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

async function attachFile(
  number: number,
  filename: string,
  content: Buffer,
): Promise<AttachmentRow> {
  const form = filePart(filename, content);
  const res = await harness.app.inject({
    method: "POST",
    url: `/api/v1/requests/${number}/attachments`,
    cookies: requesterCookies,
    headers: form.headers,
    payload: form.payload,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().attachment as AttachmentRow;
}

async function matterPaper(number: number): Promise<DocumentRow[]> {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/matters/${number}/documents`,
    cookies: memberCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json().documents as DocumentRow[]).reverse();
}

async function attachmentRef(id: string): Promise<string> {
  const [row] = await harness.db
    .select({ fileRef: requestAttachments.fileRef })
    .from(requestAttachments)
    .where(eq(requestAttachments.id, id));
  return row!.fileRef;
}

async function storedVersionBlobs(): Promise<number> {
  const root = join(harness.storageRoot, "documents");
  const directories = await readdir(root).catch(() => [] as string[]);
  let count = 0;
  for (const directory of directories) count += (await readdir(join(root, directory))).length;
  return count;
}

type ThreadRef = { entityType: "request" | "matter"; entityId: string };

async function say(
  cookies: Record<string, string>,
  ref: ThreadRef,
  body: string,
  visibility: CommentVisibility = "full_thread",
): Promise<string> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/comments",
    cookies,
    payload: { ...ref, body, visibility },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().comment.id as string;
}

async function read(cookies: Record<string, string>, ref: ThreadRef) {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/comments?entityType=${ref.entityType}&entityId=${ref.entityId}`,
    cookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().comments as {
    id: string;
    entityType: string;
    entityId: string;
    body: string;
    visibility: CommentVisibility;
  }[];
}

async function unread(cookies: Record<string, string>, ref: ThreadRef): Promise<number> {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/comments/unread?entityType=${ref.entityType}&entityId=${ref.entityId}`,
    cookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().unread as number;
}

async function markRead(cookies: Record<string, string>, ref: ThreadRef): Promise<void> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/comments/read",
    cookies,
    payload: ref,
  });
  expect(res.statusCode, res.body).toBe(200);
}

async function threadRows(entityType: "request" | "matter", entityId: string) {
  return harness.db
    .select({ id: comments.id, body: comments.body, visibility: comments.visibility })
    .from(comments)
    .where(and(eq(comments.entityType, entityType), eq(comments.entityId, entityId)))
    .orderBy(comments.createdAt, comments.id);
}

async function rowsAboutComment(userId: string, commentId: string) {
  return (
    await harness.db.select().from(notifications).where(eq(notifications.userId, userId))
  ).filter((row) => row.payload.commentId === commentId);
}

describe("the matter target", () => {
  it("confirms a bound matter type and creates an ordinary M-number", async () => {
    const request = await submit(
      "Meridian injunction threat",
      boundRequestTypeId,
      { [carrySlug]: "Meridian Logistics", [staysSlug]: "EMEA" },
      "critical",
    );
    const res = await convert(request.number, { title: "Meridian injunction threat" });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().request.convertedRecord).toEqual({
      module: "matter",
      number: expect.any(Number),
    });
    expect(res.json().request.convertedContract).toBeNull();

    const matter = await matterNumbered(res.json().request.convertedRecord.number as number);
    expect(matter).toMatchObject({
      title: "Meridian injunction threat",
      matterTypeId: ordinaryMatterTypeId,
      priority: "critical",
      risk: null,
      managerId: null,
      isConfidential: false,
      createdBy: memberId,
    });
    expect(matter.customFields).toEqual({ [carrySlug]: "Meridian Logistics" });
    expect((await cast.stored(request.id)).customFields[staysSlug]).toBe("EMEA");
    const [status] = await harness.db
      .select({ category: matterStatuses.category })
      .from(matterStatuses)
      .where(eq(matterStatuses.id, matter.statusId));
    expect(status!.category).toBe("open");
    expect(
      await harness.db
        .select({ userId: matterTeam.userId, role: matterTeam.role })
        .from(matterTeam)
        .where(eq(matterTeam.matterId, matter.id)),
    ).toEqual([{ userId: memberId, role: "creator" }]);
  });

  it("uses the matter title ceiling rather than the contract ceiling", async () => {
    const longMatterTitle = "M".repeat(201);
    const accepted = await submit("A matter with a deliberately long title");
    const converted = await convert(accepted.number, { title: longMatterTitle });
    expect(converted.statusCode, converted.body).toBe(200);
    expect(
      (await matterNumbered(converted.json().request.convertedRecord.number as number)).title,
    ).toBe(longMatterTitle);

    const tooLong = await submit("A matter title beyond its own ceiling");
    const before = await matterCount();
    const refused = await convert(tooLong.number, { title: "M".repeat(501) });
    expect(refused.statusCode, refused.body).toBe(400);
    expect(refused.json().detail).toContain("matter's title to 500 characters or fewer");
    expect(await matterCount()).toBe(before);
    expect((await cast.stored(tooLong.id)).status).toBe("new");
  });

  it("asks a module-only or archived target for a live matter type", async () => {
    for (const typeId of [moduleOnlyRequestTypeId, retiredRequestTypeId]) {
      const request = await submit(`Needs a live matter type ${typeId}`, typeId);
      const before = await matterCount();
      const refused = await convert(request.number, { title: "Still untyped" });
      expect(refused.statusCode, refused.body).toBe(400);
      expect(refused.json().detail).toContain("Pick a matter type");
      expect(await matterCount()).toBe(before);
      const accepted = await convert(request.number, {
        title: "Now typed",
        matterTypeId: ordinaryMatterTypeId,
      });
      expect(accepted.statusCode, accepted.body).toBe(200);
    }
  });

  it("refuses a contradicted bound type and a body naming both modules", async () => {
    const contradicted = await submit("The bound type wins");
    expect(
      (
        await convert(contradicted.number, {
          title: "Wrong type",
          matterTypeId: requiredMatterTypeId,
        })
      ).statusCode,
    ).toBe(400);
    const both = await submit("One module only");
    const before = await matterCount();
    const res = await convert(both.number, {
      title: "Two targets",
      matterTypeId: ordinaryMatterTypeId,
      contractTypeId: "not-even-read",
    });
    expect(res.statusCode, res.body).toBe(400);
    expect(await matterCount()).toBe(before);
    expect((await cast.stored(both.id)).status).toBe("new");
  });
});

describe("matter field carry and repair", () => {
  it("requires a missing matter field by name and lands the supplied answer", async () => {
    const request = await submit("An investigation", moduleOnlyRequestTypeId);
    const before = await matterCount();
    const refused = await convert(request.number, {
      title: "An investigation",
      matterTypeId: requiredMatterTypeId,
    });
    expect(refused.statusCode, refused.body).toBe(400);
    expect(refused.json().detail).toContain("Forum");
    expect(await matterCount()).toBe(before);

    const accepted = await convert(request.number, {
      title: "An investigation",
      matterTypeId: requiredMatterTypeId,
      customFields: { [requiredSlug]: "DIFC Courts" },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(
      (await matterNumbered(accepted.json().request.convertedRecord.number as number)).customFields,
    ).toEqual({ [requiredSlug]: "DIFC Courts" });
  });

  it("refuses a dead carried reference and accepts its live override", async () => {
    const request = await submit("Owner left", boundRequestTypeId, { [ownerSlug]: requesterId });
    await harness.db.update(users).set({ archivedAt: new Date() }).where(eq(users.id, requesterId));
    try {
      const refused = await convert(request.number, { title: "Owner left" });
      expect(refused.statusCode, refused.body).toBe(400);
      expect(refused.json().detail).toContain("Business owner: pick a live person");
      const accepted = await convert(request.number, {
        title: "Owner repaired",
        customFields: { [ownerSlug]: memberId },
      });
      expect(accepted.statusCode, accepted.body).toBe(200);
      expect(
        (await matterNumbered(accepted.json().request.convertedRecord.number as number))
          .customFields,
      ).toMatchObject({ [ownerSlug]: memberId });
    } finally {
      await harness.db.update(users).set({ archivedAt: null }).where(eq(users.id, requesterId));
    }
  });
});

describe("Re-target, reach, narration, and the race", () => {
  it("re-targets a contract-targeting and a no-target Request into matters", async () => {
    for (const typeId of [contractTargetRequestTypeId, noTargetRequestTypeId]) {
      const request = await submit(`Re-target ${typeId}`, typeId);
      const res = await convert(request.number, {
        title: "Re-targeted matter",
        matterTypeId: ordinaryMatterTypeId,
      });
      expect(res.statusCode, res.body).toBe(200);
      const stored = await cast.stored(request.id);
      expect(stored.convertedMatterId).not.toBeNull();
      expect(stored.convertedContractId).toBeNull();
    }
  });

  it("re-targets a matter-bound Request into a contract and leaves the matter id null", async () => {
    const [nda] = await harness.db
      .select({ id: contractTypes.id })
      .from(contractTypes)
      .where(eq(contractTypes.slug, "nda"));
    const request = await submit("This dispute is really paper");
    const before = await matterCount();
    const res = await convert(request.number, {
      title: "Re-targeted contract",
      contractTypeId: nda!.id,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().request.convertedRecord).toEqual({
      module: "contract",
      number: expect.any(Number),
    });
    expect(res.json().request.convertedContract).toEqual({ number: expect.any(Number) });
    const stored = await cast.stored(request.id);
    expect(stored.status).toBe("converted");
    expect(stored.convertedContractId).not.toBeNull();
    expect(stored.convertedMatterId).toBeNull();
    const [born] = await harness.db
      .select({ contractTypeId: contracts.contractTypeId })
      .from(contracts)
      .where(eq(contracts.id, stored.convertedContractId!));
    expect(born!.contractTypeId).toBe(nda!.id);
    expect(await matterCount()).toBe(before);
  });

  it("links Inbox and detail under matter reach, and withholds a confidential outsider", async () => {
    const request = await submit("Reach follows the matter");
    const converted = await convert(request.number, { title: "Reach follows the matter" });
    const number = converted.json().request.convertedRecord.number as number;
    const matter = await matterNumbered(number);

    const reached = await harness.app.inject({
      method: "GET",
      url: `/api/v1/requests/${request.number}`,
      cookies: otherMemberCookies,
    });
    expect(reached.json().request.convertedRecord).toEqual({ module: "matter", number });
    await harness.db.update(matters).set({ isConfidential: true }).where(eq(matters.id, matter.id));
    const hidden = await harness.app.inject({
      method: "GET",
      url: `/api/v1/requests/${request.number}`,
      cookies: otherMemberCookies,
    });
    expect(hidden.json().request.convertedRecord).toBeNull();
    const inbox = await harness.app.inject({
      method: "GET",
      url: "/api/v1/requests?includeTriaged=true",
      cookies: otherMemberCookies,
    });
    expect(
      inbox.json().requests.find((row: { number: number }) => row.number === request.number)
        .convertedRecord,
    ).toBeNull();
  });

  it("writes both narrations and sends the requester one status-change bell and email", async () => {
    const request = await submit("Narrated matter conversion");
    const res = await convert(request.number, { title: "Narrated matter conversion" });
    const matter = await matterNumbered(res.json().request.convertedRecord.number as number);
    const requestEntries = await harness.db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityType, "request"), eq(activityLog.entityId, request.id)));
    expect(requestEntries.find((row) => row.action === "request.converted")?.payload).toEqual({
      number: request.number,
      matterNumber: matter.number,
    });
    const matterEntries = await harness.db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityType, "matter"), eq(activityLog.entityId, matter.id)));
    expect(matterEntries.map((row) => row.action)).toContain("matter.created_from_request");

    const bells = await cast.bellRowsOn(requesterId, request.id);
    expect(bells.filter((row) => row.eventType === "request.status_changed")).toHaveLength(1);
    await settles(`matter conversion mail about R-${request.number}`, () =>
      cast
        .mailAbout(REQUESTER.email, request.number)
        .some((mail) => mail.subject.includes("Your request is in progress")),
    );
  });

  it("lets one racing triager win and names the matter on the 409", async () => {
    const request = await submit("One Request, one matter");
    const before = await matterCount();
    const [first, second] = await Promise.all([
      convert(request.number, { title: "First matter" }, memberCookies),
      convert(request.number, { title: "Second matter" }, otherMemberCookies),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    expect(await matterCount()).toBe(before + 1);
    const winner = first.statusCode === 200 ? first : second;
    const loser = first.statusCode === 409 ? first : second;
    expect(loser.json()).toMatchObject({
      type: REQUEST_DISPOSITIONED_PROBLEM_TYPE,
      outcome: "converted",
      convertedRecord: {
        module: "matter",
        number: winner.json().request.convertedRecord.number,
      },
    });
  });
});

describe("paper follows onto the matter (INT-002, DOC-008)", () => {
  it("promotes ordinary root documents while the portal keeps its copies", async () => {
    const request = await submit("Matter conversion with evidence");
    const files = [
      { filename: "notice.pdf", content: Buffer.from("%PDF-1.7 notice before action") },
      { filename: "timeline.pdf", content: Buffer.from("%PDF-1.7 events in order") },
    ];
    const attachments = [];
    for (const file of files)
      attachments.push(await attachFile(request.number, file.filename, file.content));

    const converted = await convert(request.number, { title: "Matter conversion with evidence" });
    expect(converted.statusCode, converted.body).toBe(200);
    const matter = await matterNumbered(converted.json().request.convertedRecord.number as number);
    const paper = await matterPaper(matter.number);
    expect(paper.map((row) => row.title)).toEqual(files.map((file) => file.filename));

    for (const [index, document] of paper.entries()) {
      const file = files[index]!;
      expect(document.folderId).toBeNull();
      expect(document.isPrimary).toBe(false);
      expect(document.versions).toHaveLength(1);
      expect(document.versions[0]).toMatchObject({
        versionNumber: 1,
        originalFilename: file.filename,
        byteSize: file.content.byteLength,
        checksumSha256: createHash("sha256").update(file.content).digest("hex"),
      });
      const download = await harness.app.inject({
        method: "GET",
        url: `/api/v1/documents/${document.id}/versions/${document.versions[0]!.id}/download`,
        cookies: memberCookies,
      });
      expect(download.statusCode, download.body).toBe(200);
      expect(download.rawPayload).toEqual(file.content);
    }

    const entries = await harness.db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityType, "matter"), eq(activityLog.entityId, matter.id)))
      .orderBy(activityLog.createdAt, activityLog.id);
    expect(
      entries.filter((row) => row.action === "document.created").map((row) => row.payload.title),
    ).toEqual(files.map((file) => file.filename));
    expect(entries.map((row) => row.action)).not.toContain("document.primary_set");

    const portal = await harness.app.inject({
      method: "GET",
      url: `/api/v1/portal/requests/${request.number}`,
      cookies: requesterCookies,
    });
    expect(portal.statusCode, portal.body).toBe(200);
    expect(portal.json().attachments.map((row: AttachmentRow) => row.filename)).toEqual(
      files.map((file) => file.filename),
    );
    const portalDownload = await harness.app.inject({
      method: "GET",
      url: `/api/v1/portal/requests/${request.number}/attachments/${attachments[0]!.id}`,
      cookies: requesterCookies,
    });
    expect(portalDownload.statusCode, portalDownload.body).toBe(200);
    expect(portalDownload.rawPayload).toEqual(files[0]!.content);

    const firstVersion = paper[0]!.versions[0]!;
    const [storedVersion] = await harness.db
      .select({ fileRef: documentVersions.fileRef })
      .from(documentVersions)
      .where(eq(documentVersions.id, firstVersion.id));
    expect(storedVersion!.fileRef).not.toBe(await attachmentRef(attachments[0]!.id));

    const deadline = Date.now() + 20_000;
    let extracted: { state: string; text: string | null } | undefined;
    while (Date.now() < deadline) {
      const text = await harness.app.inject({
        method: "GET",
        url: `/api/v1/documents/${paper[0]!.id}/versions/${firstVersion.id}/text`,
        cookies: memberCookies,
      });
      expect(text.statusCode, text.body).toBe(200);
      extracted = text.json().text;
      if (extracted?.state !== "pending") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(extracted).toMatchObject({
      state: "ready",
      text: fakeExtractedText(files[0]!.content),
    });
  });

  it("removes the Matter, document rows, and copied blobs when promotion fails", async () => {
    const request = await submit("Matter conversion with a missing attachment");
    await attachFile(request.number, "first.pdf", Buffer.from("%PDF-1.7 copied first"));
    const missing = await attachFile(
      request.number,
      "missing.pdf",
      Buffer.from("%PDF-1.7 removed"),
    );
    await harness.storage.delete(await attachmentRef(missing.id));

    const mattersBefore = await matterCount();
    const documentsBefore = (await harness.db.select({ id: documents.id }).from(documents)).length;
    const blobsBefore = await storedVersionBlobs();
    const res = await convert(request.number, { title: "Matter conversion must roll back" });
    expect(res.statusCode, res.body).toBe(500);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(await matterCount()).toBe(mattersBefore);
    expect(await harness.db.select({ id: documents.id }).from(documents)).toHaveLength(
      documentsBefore,
    );
    expect(await storedVersionBlobs()).toBe(blobsBefore);
    expect(await cast.stored(request.id)).toMatchObject({
      status: "new",
      convertedContractId: null,
      convertedMatterId: null,
    });
  });
});

describe("the Request thread follows onto the matter (CMT-001, NOT-002)", () => {
  it("keeps one tiered thread, truthful watermarks, and both notification audiences", async () => {
    const request = await submit("Matter conversion with a live thread");
    const requestRef = { entityType: "request", entityId: request.id } as const;
    const first = await say(requesterCookies, requestRef, "The first requester message.");
    const legal = await say(memberCookies, requestRef, "Legal analysis.", "legal_only");
    const working = await say(memberCookies, requestRef, "Working note.", "working_team");
    await markRead(memberCookies, requestRef);
    const second = await say(requesterCookies, requestRef, "The second requester message.");
    expect(await unread(memberCookies, requestRef)).toBe(1);

    const converted = await convert(request.number, {
      title: "Matter conversion with a live thread",
    });
    expect(converted.statusCode, converted.body).toBe(200);
    const matter = await matterNumbered(converted.json().request.convertedRecord.number as number);
    const matterRef = { entityType: "matter", entityId: matter.id } as const;

    expect(await threadRows("request", request.id)).toEqual([]);
    expect(await threadRows("matter", matter.id)).toEqual([
      { id: first, body: "The first requester message.", visibility: "full_thread" },
      { id: legal, body: "Legal analysis.", visibility: "legal_only" },
      { id: working, body: "Working note.", visibility: "working_team" },
      { id: second, body: "The second requester message.", visibility: "full_thread" },
    ]);

    const staffAtMatter = await read(memberCookies, matterRef);
    const staffAtRequest = await read(memberCookies, requestRef);
    expect(staffAtRequest).toEqual(staffAtMatter);
    expect(new Set(staffAtMatter.map((row) => row.entityType))).toEqual(new Set(["matter"]));
    expect(new Set(staffAtMatter.map((row) => row.entityId))).toEqual(new Set([matter.id]));
    expect((await read(requesterCookies, requestRef)).map((row) => row.id)).toEqual([
      first,
      second,
    ]);
    const directRequester = await harness.app.inject({
      method: "GET",
      url: `/api/v1/comments?entityType=matter&entityId=${matter.id}`,
      cookies: requesterCookies,
    });
    expect(directRequester.statusCode, directRequester.body).toBe(403);

    expect(await unread(memberCookies, matterRef)).toBe(1);
    expect(await unread(memberCookies, requestRef)).toBe(1);
    expect(
      await harness.db
        .select({ userId: commentLastRead.userId })
        .from(commentLastRead)
        .where(
          and(eq(commentLastRead.entityType, "request"), eq(commentLastRead.entityId, request.id)),
        ),
    ).toEqual([]);
    expect(
      await harness.db
        .select({ userId: commentLastRead.userId })
        .from(commentLastRead)
        .where(
          and(eq(commentLastRead.entityType, "matter"), eq(commentLastRead.entityId, matter.id)),
        ),
    ).toContainEqual({ userId: memberId });

    const move = (
      await harness.db
        .select()
        .from(activityLog)
        .where(and(eq(activityLog.entityType, "request"), eq(activityLog.entityId, request.id)))
    ).find((row) => row.action === "request.thread_moved");
    expect(move?.payload).toEqual({ number: request.number, matterNumber: matter.number });

    const requesterReply = await say(
      requesterCookies,
      requestRef,
      "More facts from the requester.",
    );
    expect((await threadRows("matter", matter.id)).map((row) => row.id)).toContain(requesterReply);
    expect((await rowsAboutComment(memberId, requesterReply)).map((row) => row.eventType)).toEqual([
      "comment.posted",
    ]);
    expect(await rowsAboutComment(requesterId, requesterReply)).toEqual([]);

    const internalAfter = await say(
      memberCookies,
      matterRef,
      "Internal after conversion.",
      "legal_only",
    );
    expect(await rowsAboutComment(requesterId, internalAfter)).toEqual([]);
    const answer = await say(memberCookies, matterRef, "An answer on the matter.");
    expect((await rowsAboutComment(requesterId, answer)).map((row) => row.eventType)).toEqual([
      "request.replied",
    ]);
    expect(await rowsAboutComment(memberId, answer)).toEqual([]);
    await settles(`matter reply mail about R-${request.number}`, () =>
      cast
        .mailAbout(REQUESTER.email, request.number)
        .some((mail) => mail.subject.includes("Legal replied")),
    );
  });

  it("tells a staff Requester on the matter roster exactly once", async () => {
    const request = await submit("Requester belongs on both sides");
    const converted = await convert(request.number, { title: "Requester belongs on both sides" });
    expect(converted.statusCode, converted.body).toBe(200);
    const matter = await matterNumbered(converted.json().request.convertedRecord.number as number);

    await harness.db
      .update(users)
      .set({ role: "legal_team_member" })
      .where(eq(users.id, requesterId));
    try {
      const joined = await harness.app.inject({
        method: "POST",
        url: `/api/v1/matters/${matter.number}/team`,
        cookies: memberCookies,
        payload: { userId: requesterId, role: "member" },
      });
      expect(joined.statusCode, joined.body).toBe(201);

      const reply = await say(
        memberCookies,
        { entityType: "matter", entityId: matter.id },
        "One answer for one person.",
      );
      expect((await rowsAboutComment(requesterId, reply)).map((row) => row.eventType)).toEqual([
        "request.replied",
      ]);
      expect(await rowsAboutComment(memberId, reply)).toEqual([]);
    } finally {
      await harness.db
        .update(users)
        .set({ role: "business_user" })
        .where(eq(users.id, requesterId));
    }
  });
});
