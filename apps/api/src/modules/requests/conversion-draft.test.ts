// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
  aiConnector,
  comments,
  conversionDrafts,
  eq,
  fields,
  requestTypeFields,
  matters,
  matterTypes,
  matterTypeFields,
  requestTypes,
  requests,
} from "@openlaw/db";
import { FakeAiProvider, FAKE_VALID_AI_KEY } from "../../lib/ai/fake.js";
import type { AiExtraction } from "../../lib/ai/provider.js";
import { startHarness, TEST_ADMIN, type TestHarness } from "../../testing/harness.js";
import { dispositionScaffold, type DispositionScaffold } from "../../testing/disposition.js";
import { handleConversionDraft } from "../../pipeline/conversion-draft.js";

let harness: TestHarness;
let cast: DispositionScaffold;
let typeId: string;
let requestTypeId: string;
const answers: Record<string, Omit<AiExtraction, "slug">> = {};
const provider = new FakeAiProvider({ answers });
beforeAll(async () => {
  // These cases control the boundary between scheduling and execution.
  // Live consumers would race the explicit handler calls for the same lease.
  harness = await startHarness({ aiDriverFactory: () => provider, runPipelineWorkers: false });
  await harness.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  cast = await dispositionScaffold(harness);
  const [type] = await harness.db.select().from(matterTypes).limit(1);
  typeId = type!.id;
  const [rt] = await harness.db
    .insert(requestTypes)
    .values({
      slug: "ai_matter",
      displayOrder: 100,
      displayName: "AI Matter",
      targetModule: "matter",
      targetMatterTypeId: typeId,
    })
    .returning();
  requestTypeId = rt!.id;
  await harness.app.inject({
    method: "PUT",
    url: "/api/v1/ai-connector",
    cookies: cast.adminCookies,
    payload: { preset: "openai", model: "fake", apiKey: FAKE_VALID_AI_KEY },
  });
});
beforeEach(() => {
  for (const slug of Object.keys(answers)) delete answers[slug];
});
afterAll(async () => {
  await harness?.stop();
});
async function ask() {
  const [row] = await harness.db
    .insert(requests)
    .values({
      requestTypeId,
      requesterId: cast.requesterId,
      summary: "Original ask",
      description: "Respond by October 1",
      urgency: "medium",
    })
    .returning();
  return row!;
}
async function prepare(number: number, cookies = cast.memberCookies) {
  return harness.app.inject({
    method: "POST",
    url: `/api/v1/requests/${number}/conversion-drafts`,
    cookies,
    payload: { targetModule: "matter", targetTypeId: typeId },
  });
}
it("keeps the workflow off by default and refuses unauthorized setting writes", async () => {
  const row = await ask();
  expect((await prepare(row.number)).statusCode).toBe(409);
  expect(provider.extractions).toHaveLength(0);
  expect(
    (
      await harness.app.inject({
        method: "PATCH",
        url: "/api/v1/ai-connector/workflows",
        cookies: cast.memberCookies,
        payload: { matterPreparation: true },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await harness.app.inject({
        method: "PATCH",
        url: "/api/v1/ai-connector/workflows",
        cookies: cast.adminCookies,
        payload: { matterPreparation: true },
      })
    ).statusCode,
  ).toBe(200);
});
it("prepares actual current messages, binds quotes and provenance, and preserves the original Request", async () => {
  const row = await ask();
  const [message] = await harness.db
    .insert(comments)
    .values({
      entityType: "request",
      entityId: row.id,
      authorId: cast.requesterId,
      body: "Correction: respond by October 2, 2026.",
      visibility: "full_thread",
    })
    .returning();
  await harness.db.insert(comments).values({
    entityType: "request",
    entityId: row.id,
    authorId: cast.memberId,
    body: "Secret strategy",
    visibility: "legal_only",
  });
  answers.title = {
    value: "Response preparation",
    sourceId: `request:${row.id}:description`,
    evidence: "Respond by October 1",
  };
  answers.needed_by = {
    value: "2026-10-02",
    sourceId: `message:${message!.id}`,
    evidence: "respond by October 2, 2026",
  };
  answers.description = {
    value: "Forged source",
    sourceId: "missing",
    evidence: "Respond by October 1",
  };
  const made = await prepare(row.number);
  expect(made.statusCode, made.body).toBe(202);
  const id = made.json().draft.id;
  await handleConversionDraft(
    {
      db: harness.db,
      storage: harness.storage,
      docEngine: harness.docEngine,
      resolveAiProvider: harness.resolveAiProvider,
    },
    id,
  );
  const read = await harness.app.inject({
    url: `/api/v1/requests/${row.number}/conversion-drafts/${id}`,
    cookies: cast.memberCookies,
  });
  expect(read.json().draft.state).toBe("ready");
  expect(read.json().draft.suggestions.title.value).toBe("Response preparation");
  expect(read.json().draft.suggestions.description).toBeUndefined();
  expect(read.json().draft.warnings).toContain("restricted_sources");
  const sent = provider.extractions.at(-1)!;
  expect(
    sent.sources.some((s) => s.id === `message:${message!.id}` && s.author && s.createdAt),
  ).toBe(true);
  expect(sent.text).not.toContain("Secret strategy");
  expect(
    (
      await harness.app.inject({
        url: `/api/v1/requests/${row.number}/conversion-drafts/${id}`,
        cookies: cast.otherMemberCookies,
      })
    ).statusCode,
  ).toBe(404);
  const converted = await harness.app.inject({
    method: "POST",
    url: `/api/v1/requests/${row.number}/convert`,
    cookies: cast.memberCookies,
    payload: {
      title: "Response preparation",
      matterTypeId: typeId,
      neededBy: "2026-10-02",
      conversionDraftId: id,
      aiAccepted: ["title", "needed_by"],
    },
  });
  expect(converted.statusCode, converted.body).toBe(200);
  const [original] = await harness.db.select().from(requests).where(eq(requests.id, row.id));
  expect(original!.description).toBe("Respond by October 1");
  const [matter] = await harness.db
    .select()
    .from(matters)
    .where(eq(matters.id, original!.convertedMatterId!));
  expect(matter!.aiUnverified?.title?.draftId).toBe(id);
  expect(matter!.aiUnverified?.needed_by?.draftId).toBe(id);
  const evidence = () =>
    harness.app.inject({
      url: `/api/v1/matters/${matter!.number}/conversion-evidence/needed_by`,
      cookies: cast.memberCookies,
    });
  expect((await evidence()).json().available).toBe(true);
  await harness.db
    .update(comments)
    .set({ body: "Removed the date", editedAt: new Date() })
    .where(eq(comments.id, message!.id));
  expect((await evidence()).json()).toEqual({ available: false, citations: [] });
  const confirmed = await harness.app.inject({
    method: "POST",
    url: `/api/v1/matters/${matter!.number}/conversion-confirm/title`,
    cookies: cast.memberCookies,
  });
  expect(confirmed.statusCode, confirmed.body).toBe(200);
  const [after] = await harness.db.select().from(matters).where(eq(matters.id, matter!.id));
  expect(after!.aiUnverified?.title).toBeUndefined();
  expect(after!.aiUnverified?.needed_by).toBeDefined();
});
it("rejects stale sources and forged acceptance, while edited values remain human", async () => {
  const row = await ask();
  answers.title = {
    value: "Suggested title",
    sourceId: `request:${row.id}:summary`,
    evidence: "Original ask",
  };
  const made = await prepare(row.number);
  const id = made.json().draft.id;
  await handleConversionDraft(
    {
      db: harness.db,
      storage: harness.storage,
      docEngine: harness.docEngine,
      resolveAiProvider: harness.resolveAiProvider,
    },
    id,
  );
  await harness.db
    .update(requests)
    .set({ description: "Changed input" })
    .where(eq(requests.id, row.id));
  const stale = await harness.app.inject({
    url: `/api/v1/requests/${row.number}/conversion-drafts/${id}`,
    cookies: cast.memberCookies,
  });
  expect(stale.json().draft.state).toBe("failed");
  expect(stale.json().draft.suggestions).toEqual({});
  const submit = (payload: object) =>
    harness.app.inject({
      method: "POST",
      url: `/api/v1/requests/${row.number}/convert`,
      cookies: cast.memberCookies,
      payload: {
        title: "Suggested title",
        matterTypeId: typeId,
        conversionDraftId: id,
        ...payload,
      },
    });
  expect((await submit({ aiAccepted: ["title"] })).statusCode).toBe(409);
  expect(
    (await submit({ title: "Human edit", description: null, aiAccepted: [] })).statusCode,
  ).toBe(200);
  const [original] = await harness.db.select().from(requests).where(eq(requests.id, row.id));
  const [matter] = await harness.db
    .select()
    .from(matters)
    .where(eq(matters.id, original!.convertedMatterId!));
  expect(matter!.aiUnverified).toBeNull();
  expect(matter!.description).toBeNull();
});
it("flags unresolved contradictions and rejects a quote assigned to the wrong source", async () => {
  const row = await ask();
  answers.title = {
    value: "Invented",
    sourceId: `request:${row.id}:summary`,
    evidence: "Respond by October 1",
  };
  answers.needed_by = {
    value: "2026-10-01",
    conflict: true,
    citations: [{ sourceId: `request:${row.id}:description`, quote: "Respond by October 1" }],
  };
  const made = await prepare(row.number);
  const id = made.json().draft.id;
  await handleConversionDraft(
    {
      db: harness.db,
      storage: harness.storage,
      docEngine: harness.docEngine,
      resolveAiProvider: harness.resolveAiProvider,
    },
    id,
  );
  const read = await harness.app.inject({
    url: `/api/v1/requests/${row.number}/conversion-drafts/${id}`,
    cookies: cast.memberCookies,
  });
  expect(read.json().draft.suggestions.title).toBeUndefined();
  expect(read.json().draft.suggestions.needed_by).toBeUndefined();
  expect(read.json().draft.conflicts.needed_by).toBeDefined();
});
it("blocks narrowing a cited source until its unverified derivative is reviewed", async () => {
  const [field] = await harness.db
    .insert(fields)
    .values({
      slug: "conversion_context",
      displayName: "Business context",
      fieldType: "text",
      moduleScope: "global",
      fieldTag: "business",
    })
    .returning();
  await harness.db
    .insert(requestTypeFields)
    .values({ typeId: requestTypeId, fieldId: field!.id, displayOrder: 1, isRequired: false });
  const row = await ask();
  await harness.db
    .update(requests)
    .set({ customFields: { conversion_context: "Supplier dispute" } })
    .where(eq(requests.id, row.id));
  answers.title = {
    value: "Supplier dispute",
    sourceId: `field:${row.id}:conversion_context`,
    evidence: "Supplier dispute",
  };
  const made = await prepare(row.number);
  await handleConversionDraft(
    {
      db: harness.db,
      storage: harness.storage,
      docEngine: harness.docEngine,
      resolveAiProvider: harness.resolveAiProvider,
    },
    made.json().draft.id,
  );
  const converted = await harness.app.inject({
    method: "POST",
    url: `/api/v1/requests/${row.number}/convert`,
    cookies: cast.memberCookies,
    payload: {
      title: "Supplier dispute",
      matterTypeId: typeId,
      conversionDraftId: made.json().draft.id,
      aiAccepted: ["title"],
    },
  });
  expect(converted.statusCode, converted.body).toBe(200);
  const retag = () =>
    harness.app.inject({
      method: "PATCH",
      url: `/api/v1/fields/${field!.id}`,
      cookies: cast.adminCookies,
      payload: { fieldTag: "legal" },
    });
  const refused = await retag();
  expect(refused.statusCode, refused.body).toBe(409);
  expect(refused.body).not.toContain("Supplier dispute");
  const [request] = await harness.db.select().from(requests).where(eq(requests.id, row.id));
  const [matter] = await harness.db
    .select()
    .from(matters)
    .where(eq(matters.id, request!.convertedMatterId!));
  expect(
    (
      await harness.app.inject({
        method: "POST",
        url: `/api/v1/matters/${matter!.number}/conversion-confirm/title`,
        cookies: cast.memberCookies,
      })
    ).statusCode,
  ).toBe(200);
  expect((await retag()).statusCode).toBe(200);
});
it("checks disablement again at execution without calling AI", async () => {
  await harness.db.update(aiConnector).set({ matterPreparation: true });
  const row = await ask();
  const made = await prepare(row.number);
  expect(made.statusCode, made.body).toBe(202);
  const [scheduled] = await harness.db
    .select()
    .from(conversionDrafts)
    .where(eq(conversionDrafts.id, made.json().draft.id));
  expect(scheduled).toMatchObject({ state: "pending", startedAt: null });
  await harness.db.update(aiConnector).set({ matterPreparation: false });
  const count = provider.extractions.length;
  await handleConversionDraft(
    {
      db: harness.db,
      storage: harness.storage,
      docEngine: harness.docEngine,
      resolveAiProvider: harness.resolveAiProvider,
    },
    made.json().draft.id,
  );
  expect(provider.extractions).toHaveLength(count);
  const [draft] = await harness.db
    .select()
    .from(conversionDrafts)
    .where(eq(conversionDrafts.id, made.json().draft.id));
  expect(draft!.state).toBe("failed");
});

it("preserves provenance on no-op Matter resends and clears only edited values", async () => {
  const [field] = await harness.db
    .insert(fields)
    .values({
      slug: "review_context",
      displayName: "Review context",
      moduleScope: "matter",
      fieldType: "text",
      fieldTag: "business",
    })
    .returning();
  await harness.db
    .insert(matterTypeFields)
    .values({ typeId, fieldId: field!.id, displayOrder: 999, isRequired: false });
  const row = await ask();
  const converted = await harness.app.inject({
    method: "POST",
    url: `/api/v1/requests/${row.number}/convert`,
    cookies: cast.memberCookies,
    payload: {
      title: "Prepared title",
      matterTypeId: typeId,
      customFields: { review_context: "Prepared context" },
    },
  });
  expect(converted.statusCode, converted.body).toBe(200);
  const [request] = await harness.db.select().from(requests).where(eq(requests.id, row.id));
  const marker = {
    draftId: "test-provenance",
    writtenAt: new Date().toISOString(),
    targetTypeId: typeId,
  };
  const flags = {
    title: marker,
    description: marker,
    priority: marker,
    matter_type: marker,
    "field:review_context": marker,
  };
  const [matter] = await harness.db
    .update(matters)
    .set({ aiUnverified: flags })
    .where(eq(matters.id, request!.convertedMatterId!))
    .returning();
  const resend = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/matters/${matter!.number}`,
    cookies: cast.memberCookies,
    payload: {
      title: matter!.title,
      description: matter!.description,
      priority: matter!.priority,
      matterTypeId: typeId,
      customFields: { review_context: "Prepared context" },
    },
  });
  expect(resend.statusCode, resend.body).toBe(200);
  const [unchanged] = await harness.db.select().from(matters).where(eq(matters.id, matter!.id));
  expect(unchanged!.aiUnverified).toEqual(flags);
  expect(unchanged!.updatedAt).toEqual(matter!.updatedAt);
  const edited = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/matters/${matter!.number}`,
    cookies: cast.memberCookies,
    payload: { title: "Human title", customFields: { review_context: "Human context" } },
  });
  expect(edited.statusCode, edited.body).toBe(200);
  const [after] = await harness.db.select().from(matters).where(eq(matters.id, matter!.id));
  expect(after!.aiUnverified).toEqual({
    description: marker,
    priority: marker,
    matter_type: marker,
  });
});

it("leaves an active lease to its owner and resolves connector disablement live", async () => {
  await harness.db.update(aiConnector).set({ matterPreparation: true });
  const row = await ask();
  const made = await prepare(row.number);
  expect(made.statusCode, made.body).toBe(202);
  const id = made.json().draft.id;
  let markEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve;
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let resolutions = 0;
  const deps = {
    db: harness.db,
    storage: harness.storage,
    docEngine: harness.docEngine,
    resolveAiProvider: async () => {
      resolutions += 1;
      markEntered();
      await held;
      return harness.resolveAiProvider();
    },
  };
  const count = provider.extractions.length;
  const owner = handleConversionDraft(deps, id);
  try {
    await entered;
    await handleConversionDraft(deps, id);
    const [held] = await harness.db
      .select()
      .from(conversionDrafts)
      .where(eq(conversionDrafts.id, id));
    expect(held!.state).toBe("pending");
    expect(held!.startedAt).not.toBeNull();
    expect(resolutions).toBe(1);
    await harness.db.update(aiConnector).set({ disabledAt: new Date() });
  } finally {
    release();
    await owner;
  }
  const [finished] = await harness.db
    .select()
    .from(conversionDrafts)
    .where(eq(conversionDrafts.id, id));
  expect(finished!.state).toBe("failed");
  expect(provider.extractions).toHaveLength(count);
});

it("reads all eligible paper once, preserves named evidence, and maps promotion without filing message paper", async () => {
  await harness.db.update(aiConnector).set({ matterPreparation: true, disabledAt: null });
  const { Readable } = await import("node:stream");
  const { requestAttachments, commentAttachments, documents, documentVersions } =
    await import("@openlaw/db");
  const {
    fakeComparisonDocx,
    fakeImageOnlyPdf,
    fakeConversionText,
    fakeExtractedText,
    fakeOcrText,
  } = await import("../../lib/doc-engine/fake.js");
  const row = await ask();
  const native = Buffer.from("%PDF-1.4\nShared supporting agreement");
  const word = fakeComparisonDocx();
  const scan = fakeImageOnlyPdf("Scanned supporting paper");
  const paper = [];
  for (const [index, filename, bytes] of [
    [0, "first.pdf", native],
    [1, "second.pdf", native],
    [2, "terms.docx", word],
    [3, "scan.pdf", scan],
    [4, "sheet.xlsx", Buffer.from("PK\x03\x04")],
    [5, "broken.pdf", Buffer.from("broken")],
  ] as const) {
    const fileRef = await harness.storage.put(`test/${row.id}/${index}`, Readable.from([bytes]));
    const [file] = await harness.db
      .insert(requestAttachments)
      .values({ requestId: row.id, fileRef, filename, uploadedBy: cast.requesterId })
      .returning();
    paper.push(file!);
  }
  const [message] = await harness.db
    .insert(comments)
    .values({
      entityType: "request",
      entityId: row.id,
      authorId: cast.requesterId,
      visibility: "full_thread",
      body: "Supporting correspondence",
    })
    .returning();
  const fileRef = await harness.storage.put(`test/${row.id}/message`, Readable.from([native]));
  const [messagePaper] = await harness.db
    .insert(commentAttachments)
    .values({
      commentId: message!.id,
      fileRef,
      filename: "message.pdf",
      uploadedBy: cast.requesterId,
    })
    .returning();
  answers.title = {
    value: "Prepared from second paper",
    sourceId: `attachment:${paper[1]!.id}`,
    evidence: fakeExtractedText(native),
  };
  answers.description = {
    value: "Prepared from all the supporting paper",
    citations: [
      { sourceId: `attachment:${paper[2]!.id}`, quote: fakeConversionText("docx", word) },
      { sourceId: `attachment:${paper[3]!.id}`, quote: fakeOcrText(scan) },
      { sourceId: `message-attachment:${messagePaper!.id}`, quote: fakeExtractedText(native) },
    ],
  };
  answers.priority = {
    value: "high",
    sourceId: `attachment:${paper[4]!.id}`,
    evidence: fakeExtractedText(native),
  };
  const made = await prepare(row.number);
  const id = made.json().draft.id;
  await handleConversionDraft(
    {
      db: harness.db,
      storage: harness.storage,
      docEngine: harness.docEngine,
      resolveAiProvider: harness.resolveAiProvider,
    },
    id,
  );
  const extractionSpy = vi.spyOn(harness.docEngine, "extractPdfText");
  const draft = await harness.app.inject({
    url: `/api/v1/requests/${row.number}/conversion-drafts/${id}`,
    cookies: cast.memberCookies,
  });
  expect(draft.json().draft.state, draft.body).toBe("ready");
  expect(extractionSpy).not.toHaveBeenCalled();
  extractionSpy.mockRestore();
  expect(draft.json().draft.attachmentReads.map((r: { status: string }) => r.status)).toEqual([
    "readable",
    "readable",
    "readable",
    "readable",
    "unsupported",
    "unreadable",
    "readable",
  ]);
  expect(draft.json().draft.suggestions.description).toBeDefined();
  expect(draft.json().draft.suggestions.priority).toBeUndefined();
  expect(draft.json().draft.warnings).toContain("attachment_omissions");
  expect(draft.body).not.toContain(fileRef);
  expect(provider.extractions.at(-1)!.sources.filter((s) => s.kind === "document")).toHaveLength(5);
  const [stillNew] = await harness.db.select().from(requests).where(eq(requests.id, row.id));
  expect(stillNew!.convertedMatterId).toBeNull();
  expect(
    (
      await harness.db
        .select()
        .from(requestAttachments)
        .where(eq(requestAttachments.requestId, row.id))
    ).every((a) => a.promotedVersionId === null),
  ).toBe(true);
  const evidencePath = `/api/v1/requests/${row.number}/conversion-drafts/${id}/evidence/title`;
  const evidence = await harness.app.inject({ url: evidencePath, cookies: cast.memberCookies });
  expect(evidence.json().citations[0].sourceId).toBe(`attachment:${paper[1]!.id}`);
  const previewPath = evidence.json().citations[0].attachment.previewHref;
  const preview = await harness.app.inject({ url: previewPath, cookies: cast.memberCookies });
  expect(preview.rawPayload).toEqual(native);
  expect(preview.headers["content-length"]).toBe(String(native.length));
  expect(preview.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
  expect(preview.headers["content-type"]).toBe("application/pdf");
  expect(
    (await harness.app.inject({ url: previewPath, cookies: cast.otherMemberCookies })).statusCode,
  ).toBe(404);
  const converted = await harness.app.inject({
    method: "POST",
    url: `/api/v1/requests/${row.number}/convert`,
    cookies: cast.memberCookies,
    payload: {
      title: "Prepared from second paper",
      description: "Prepared from all the supporting paper",
      matterTypeId: typeId,
      conversionDraftId: id,
      aiAccepted: ["title", "description"],
    },
  });
  expect(converted.statusCode, converted.body).toBe(200);
  const [request] = await harness.db.select().from(requests).where(eq(requests.id, row.id));
  const [matter] = await harness.db
    .select()
    .from(matters)
    .where(eq(matters.id, request!.convertedMatterId!));
  const [promoted] = await harness.db
    .select()
    .from(requestAttachments)
    .where(eq(requestAttachments.id, paper[1]!.id));
  const [version] = await harness.db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.id, promoted!.promotedVersionId!));
  const after = () =>
    harness.app.inject({
      url: `/api/v1/matters/${matter!.number}/conversion-evidence/title`,
      cookies: cast.otherMemberCookies,
    });
  expect((await after()).json().citations[0].attachment).toMatchObject({
    documentId: version!.documentId,
    versionId: version!.id,
  });
  expect(
    (await harness.app.inject({ url: previewPath, cookies: cast.memberCookies })).statusCode,
  ).toBe(404);
  const [moved] = await harness.db
    .select()
    .from(commentAttachments)
    .where(eq(commentAttachments.id, messagePaper!.id));
  expect(moved!.filedVersionId).toBeNull();
  const description = await harness.app.inject({
    url: `/api/v1/matters/${matter!.number}/conversion-evidence/description`,
    cookies: cast.memberCookies,
  });
  expect(description.json().available).toBe(true);
  const messagePreview = description.json().citations[2].attachment.previewHref;
  expect(
    (await harness.app.inject({ url: messagePreview, cookies: cast.memberCookies })).statusCode,
  ).toBe(200);
  await harness.db
    .update(comments)
    .set({ deletedAt: new Date() })
    .where(eq(comments.id, message!.id));
  expect(
    (await harness.app.inject({ url: messagePreview, cookies: cast.memberCookies })).statusCode,
  ).toBe(404);
  const narrowing = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/documents/${version!.documentId}`,
    cookies: cast.memberCookies,
    payload: { isConfidential: true },
  });
  expect(narrowing.statusCode, narrowing.body).toBe(409);
  await harness.db
    .update(documents)
    .set({ isConfidential: true })
    .where(eq(documents.id, version!.documentId));
  expect((await after()).json()).toEqual({ available: false, citations: [] });
  const [newOwner] = await harness.db
    .insert(matters)
    .values({
      title: "Confidential new owner",
      matterTypeId: typeId,
      statusId: matter!.statusId,
      createdBy: cast.memberId,
      managerId: cast.memberId,
      isConfidential: true,
    })
    .returning();
  await harness.db
    .update(documents)
    .set({ isConfidential: false, matterId: newOwner!.id })
    .where(eq(documents.id, version!.documentId));
  expect((await after()).json()).toEqual({ available: false, citations: [] });
  await harness.db
    .update(documents)
    .set({ matterId: matter!.id })
    .where(eq(documents.id, version!.documentId));
  expect((await after()).json().available).toBe(true);
  await harness.db
    .update(documents)
    .set({ archivedAt: new Date() })
    .where(eq(documents.id, version!.documentId));
  expect((await after()).json()).toEqual({ available: false, citations: [] });
  // An archived Document gives its own reason rather than the narrowing
  // refusal: its citations already read as unavailable, so there is no
  // unreviewed derivative for a person to go and confirm.
  const archivedNarrowing = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/documents/${version!.documentId}`,
    cookies: cast.memberCookies,
    payload: { isConfidential: true },
  });
  expect(archivedNarrowing.statusCode).toBe(409);
  expect(archivedNarrowing.json().detail).toContain("archived");
});

it("reuses cached attachment reads when preparation retries a provider failure", async () => {
  await harness.db.update(aiConnector).set({ matterPreparation: true, disabledAt: null });
  const { Readable } = await import("node:stream");
  const { requestAttachments } = await import("@openlaw/db");
  const row = await ask();
  const fileRef = await harness.storage.put(
    `test/${row.id}/retry`,
    Readable.from([Buffer.from("%PDF-1.4 Supporting agreement")]),
  );
  await harness.db
    .insert(requestAttachments)
    .values({ requestId: row.id, fileRef, filename: "retry.pdf", uploadedBy: cast.requesterId });
  const made = await prepare(row.number);
  const id = made.json().draft.id;
  const deps = {
    db: harness.db,
    storage: harness.storage,
    docEngine: harness.docEngine,
    resolveAiProvider: harness.resolveAiProvider,
  };
  const extraction = vi.spyOn(harness.docEngine, "extractPdfText");
  provider.outage();
  try {
    await handleConversionDraft(deps, id);
    const [failed] = await harness.db
      .select()
      .from(conversionDrafts)
      .where(eq(conversionDrafts.id, id));
    expect(failed!.state).toBe("failed");
    expect(failed!.attachmentReads).toMatchObject([{ status: "readable" }]);
    expect(extraction).toHaveBeenCalledOnce();
    provider.outage(false);
    const retry = await harness.app.inject({
      method: "POST",
      url: `/api/v1/requests/${row.number}/conversion-drafts`,
      cookies: cast.memberCookies,
      payload: { targetModule: "matter", targetTypeId: typeId, retry: true },
    });
    expect(retry.json().draft.id).toBe(id);
    expect(retry.json().draft.state).toBe("pending");
    await handleConversionDraft(deps, id);
    const [ready] = await harness.db
      .select()
      .from(conversionDrafts)
      .where(eq(conversionDrafts.id, id));
    expect(ready!.state).toBe("ready");
    expect(extraction).toHaveBeenCalledOnce();
  } finally {
    provider.outage(false);
    extraction.mockRestore();
  }
});

it("prepares Contracts independently and accepts only matching reviewed values", async () => {
  const { contractTypes, contracts } = await import("@openlaw/db");
  const [type] = await harness.db.select().from(contractTypes).limit(1);
  const row = await ask();
  const start = () =>
    harness.app.inject({
      method: "POST",
      url: `/api/v1/requests/${row.number}/conversion-drafts`,
      cookies: cast.memberCookies,
      payload: { targetModule: "contract", targetTypeId: type!.id },
    });
  expect((await start()).statusCode).toBe(409);
  expect(
    (
      await harness.app.inject({
        method: "PATCH",
        url: "/api/v1/ai-connector/workflows",
        cookies: cast.memberCookies,
        payload: { contractPreparation: true },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await harness.app.inject({
        method: "PATCH",
        url: "/api/v1/ai-connector/workflows",
        cookies: cast.adminCookies,
        payload: { contractPreparation: true, matterPreparation: false },
      })
    ).statusCode,
  ).toBe(200);
  await harness.db.update(aiConnector).set({ disabledAt: null });
  answers.title = {
    value: "Prepared Contract",
    sourceId: `request:${row.id}:summary`,
    evidence: "Original ask",
  };
  answers.description = {
    value: "Reviewed context",
    sourceId: `request:${row.id}:description`,
    evidence: "Respond by October 1",
  };
  answers.counterparty = {
    value: "Acme",
    sourceId: `request:${row.id}:summary`,
    evidence: "Original ask",
  };
  const prepared = await start();
  expect(prepared.statusCode, prepared.body).toBe(202);
  const id = prepared.json().draft.id;
  await handleConversionDraft(
    {
      db: harness.db,
      storage: harness.storage,
      docEngine: harness.docEngine,
      resolveAiProvider: harness.resolveAiProvider,
    },
    id,
  );
  const read = await harness.app.inject({
    url: `/api/v1/requests/${row.number}/conversion-drafts/${id}`,
    cookies: cast.memberCookies,
  });
  expect(read.json().draft).toMatchObject({
    targetModule: "contract",
    state: "ready",
    suggestions: { title: { value: "Prepared Contract" } },
  });
  const converted = await harness.app.inject({
    method: "POST",
    url: `/api/v1/requests/${row.number}/convert`,
    cookies: cast.memberCookies,
    payload: {
      contractTypeId: type!.id,
      title: "Prepared Contract",
      description: null,
      counterpartyName: "Acme",
      conversionDraftId: id,
      aiAccepted: ["title", "description", "counterparty", "unknown", "toString", "__proto__"],
    },
  });
  expect(converted.statusCode, converted.body).toBe(200);
  const [original] = await harness.db.select().from(requests).where(eq(requests.id, row.id));
  const [contract] = await harness.db
    .select()
    .from(contracts)
    .where(eq(contracts.id, original!.convertedContractId!));
  expect(contract).toMatchObject({
    title: "Prepared Contract",
    description: null,
    managerId: cast.memberId,
  });
  expect(Object.keys(contract!.aiUnverified!)).toEqual(["title", "counterparty"]);
  expect(contract!.aiUnverified!.title).toMatchObject({ draftId: id });
  expect(original!.description).toBe("Respond by October 1");
  const evidence = await harness.app.inject({
    url: `/api/v1/contracts/${contract!.number}/conversion-evidence/title`,
    cookies: cast.memberCookies,
  });
  expect(evidence.json()).toMatchObject({ available: true, citations: [{ text: "Original ask" }] });
});

it("keeps Contract paper and conversation evidence through one concurrent conversion and refuses source narrowing", async () => {
  const { Readable } = await import("node:stream");
  const { contractTypes, contracts, requestAttachments, documentVersions, contractTypeFields } =
    await import("@openlaw/db");
  const { fakeExtractedText } = await import("../../lib/doc-engine/fake.js");
  await harness.db.update(aiConnector).set({ contractPreparation: true, disabledAt: null });
  const [type] = await harness.db.select().from(contractTypes).limit(1);
  const [field] = await harness.db
    .insert(fields)
    .values({
      slug: "contract_opening",
      displayName: "Opening context",
      moduleScope: "contract",
      fieldType: "text",
      fieldTag: "business",
    })
    .returning();
  await harness.db
    .insert(contractTypeFields)
    .values({ typeId: type!.id, fieldId: field!.id, displayOrder: 999, isRequired: false });
  const row = await ask();
  const paper = [];
  for (const index of [1, 2]) {
    const bytes = Buffer.from(`%PDF-1.4\nAgreement ${index}`);
    const fileRef = await harness.storage.put(`test/${row.id}/${index}`, Readable.from([bytes]));
    const [file] = await harness.db
      .insert(requestAttachments)
      .values({
        requestId: row.id,
        fileRef,
        filename: `${index}.pdf`,
        uploadedBy: cast.requesterId,
      })
      .returning();
    paper.push(file!);
    answers[index === 1 ? "title" : "field:contract_opening"] = {
      value: index === 1 ? "Agreement review" : "Supported opening",
      sourceId: `attachment:${file!.id}`,
      evidence: fakeExtractedText(bytes),
    };
  }
  const [message] = await harness.db
    .insert(comments)
    .values({
      entityType: "request",
      entityId: row.id,
      authorId: cast.requesterId,
      visibility: "full_thread",
      body: "Correction: needed by October 2, 2026.",
    })
    .returning();
  await harness.db.insert(comments).values({
    entityType: "request",
    entityId: row.id,
    authorId: cast.memberId,
    visibility: "legal_only",
    body: "Restricted Contract strategy",
  });
  answers.needed_by = {
    value: "2026-10-02",
    sourceId: `message:${message!.id}`,
    evidence: "October 2, 2026",
  };
  const made = await harness.app.inject({
    method: "POST",
    url: `/api/v1/requests/${row.number}/conversion-drafts`,
    cookies: cast.memberCookies,
    payload: { targetModule: "contract", targetTypeId: type!.id },
  });
  const id = made.json().draft.id;
  await handleConversionDraft(
    {
      db: harness.db,
      storage: harness.storage,
      docEngine: harness.docEngine,
      resolveAiProvider: harness.resolveAiProvider,
    },
    id,
  );
  expect(provider.extractions.at(-1)!.text).not.toContain("Restricted Contract strategy");
  const payload = {
    title: "Agreement review",
    contractTypeId: type!.id,
    customFields: { contract_opening: "Supported opening" },
    neededBy: "2026-10-02",
    conversionDraftId: id,
    aiAccepted: ["title", "field:contract_opening", "needed_by"],
  };
  const converted = await Promise.all(
    [1, 2].map(() =>
      harness.app.inject({
        method: "POST",
        url: `/api/v1/requests/${row.number}/convert`,
        cookies: cast.memberCookies,
        payload,
      }),
    ),
  );
  expect(converted.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  const [original] = await harness.db.select().from(requests).where(eq(requests.id, row.id));
  const [contract] = await harness.db
    .select()
    .from(contracts)
    .where(eq(contracts.id, original!.convertedContractId!));
  expect(contract!.aiUnverified!["field:contract_opening"]!.draftId).toBe(id);
  // Detaching hides the marker with its Field but retains both for reattachment.
  await harness.db.delete(contractTypeFields).where(eq(contractTypeFields.fieldId, field!.id));
  const detachedReads = await Promise.all([
    harness.app.inject({
      url: `/api/v1/contracts/${contract!.number}`,
      cookies: cast.memberCookies,
    }),
    harness.app.inject({ url: "/api/v1/contracts", cookies: cast.memberCookies }),
    harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${contract!.number}`,
      cookies: cast.memberCookies,
      payload: { priority: "medium" },
    }),
  ]);
  for (const response of detachedReads) {
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json();
    const row = body.contract ?? body.contracts.find((c: { id: string }) => c.id === contract!.id);
    expect(row.customFields.contract_opening).toBe("Supported opening");
    expect(row.aiUnverified).not.toHaveProperty("field:contract_opening");
    expect(row.aiUnverified.title).toMatchObject({ draftId: id });
  }
  for (const action of ["archive", "restore"]) {
    const response = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract!.number}/${action}`,
      cookies: cast.memberCookies,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().contract.aiUnverified).not.toHaveProperty("field:contract_opening");
  }
  await harness.db
    .insert(contractTypeFields)
    .values({ typeId: type!.id, fieldId: field!.id, displayOrder: 999, isRequired: false });
  const reattached = await harness.app.inject({
    url: `/api/v1/contracts/${contract!.number}`,
    cookies: cast.memberCookies,
  });
  expect(reattached.json().contract.aiUnverified["field:contract_opening"]).toMatchObject({
    draftId: id,
  });
  const read = await harness.app.inject({
    url: `/api/v1/contracts/${contract!.number}/conversion-evidence/field:contract_opening`,
    cookies: cast.otherMemberCookies,
  });
  expect(read.json().available).toBe(true);
  const [promoted] = await harness.db
    .select()
    .from(requestAttachments)
    .where(eq(requestAttachments.id, paper[1]!.id));
  const [version] = await harness.db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.id, promoted!.promotedVersionId!));
  expect(read.json().citations[0].attachment).toMatchObject({
    documentId: version!.documentId,
    versionId: version!.id,
  });
  const narrow = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/documents/${version!.documentId}`,
    cookies: cast.memberCookies,
    payload: { isConfidential: true },
  });
  expect(narrow.statusCode, narrow.body).toBe(409);
  const deadline = await harness.app.inject({
    url: `/api/v1/contracts/${contract!.number}/key-dates`,
    cookies: cast.memberCookies,
  });
  expect(
    deadline.json().deadlines.find((d: { label: string }) => d.label === "Needed by").unverified,
  ).toBe(true);
  const neededDate = deadline
    .json()
    .deadlines.find((d: { label: string }) => d.label === "Needed by");
  // The edit dialog re-sends the date, the label and the note whatever
  // it changed, so a reminder-only edit must leave the marker standing.
  const reminderOnly = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/key-dates/${neededDate.keyDateId}`,
    cookies: cast.memberCookies,
    payload: {
      date: neededDate.date,
      label: neededDate.label,
      note: neededDate.note,
      reminderOffsetDays: [7],
    },
  });
  expect(reminderOnly.statusCode, reminderOnly.body).toBe(200);
  expect(
    reminderOnly.json().deadlines.find((d: { label: string }) => d.label === "Needed by")
      .unverified,
  ).toBe(true);
  const changedDate = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/key-dates/${neededDate.keyDateId}`,
    cookies: cast.memberCookies,
    payload: { date: "2026-10-03" },
  });
  expect(changedDate.statusCode, changedDate.body).toBe(200);
  expect(
    changedDate.json().deadlines.find((d: { label: string }) => d.label === "Needed by").unverified,
  ).toBe(false);
  const edited = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/contracts/${contract!.number}`,
    cookies: cast.memberCookies,
    payload: { customFields: { contract_opening: null } },
  });
  expect(edited.statusCode, edited.body).toBe(200);
  expect(edited.json().contract.aiUnverified).not.toHaveProperty("field:contract_opening");
  expect(edited.json().contract.aiUnverified.title.draftId).toBe(id);
});

it("rejects Contract claims from another module or Type, and late results after disabling", async () => {
  const { contractTypes } = await import("@openlaw/db");
  await harness.db
    .update(aiConnector)
    .set({ matterPreparation: true, contractPreparation: true, disabledAt: null });
  const row = await ask();
  const types = await harness.db.select().from(contractTypes).limit(2);
  answers.title = {
    value: "Supported title",
    sourceId: `request:${row.id}:summary`,
    evidence: "Original ask",
  };
  const make = (targetModule: "matter" | "contract", targetTypeId: string) =>
    harness.app.inject({
      method: "POST",
      url: `/api/v1/requests/${row.number}/conversion-drafts`,
      cookies: cast.memberCookies,
      payload: { targetModule, targetTypeId },
    });
  const deps = {
    db: harness.db,
    storage: harness.storage,
    docEngine: harness.docEngine,
    resolveAiProvider: harness.resolveAiProvider,
  };
  const matter = await make("matter", typeId);
  await handleConversionDraft(deps, matter.json().draft.id);
  const claim = (id: string, contractTypeId: string) =>
    harness.app.inject({
      method: "POST",
      url: `/api/v1/requests/${row.number}/convert`,
      cookies: cast.memberCookies,
      payload: {
        title: "Supported title",
        contractTypeId,
        conversionDraftId: id,
        aiAccepted: ["title"],
      },
    });
  expect((await claim(matter.json().draft.id, types[0]!.id)).statusCode).toBe(409);
  const contract = await make("contract", types[0]!.id);
  await handleConversionDraft(deps, contract.json().draft.id);
  if (types[1]) {
    const wrong = await claim(contract.json().draft.id, types[1].id);
    // No suggestion from a different Type can be labelled AI-generated.
    expect(wrong.statusCode, wrong.body).toBe(409);
  }
  const second = await ask();
  const pending = await harness.app.inject({
    method: "POST",
    url: `/api/v1/requests/${second.number}/conversion-drafts`,
    cookies: cast.memberCookies,
    payload: { targetModule: "contract", targetTypeId: types[0]!.id },
  });
  const extraction = vi.spyOn(provider, "extract").mockImplementationOnce(async () => {
    await harness.db.update(aiConnector).set({ contractPreparation: false });
    return [
      {
        slug: "title",
        value: "Late title",
        sourceId: `request:${second.id}:summary`,
        evidence: "Original ask",
      },
    ];
  });
  await handleConversionDraft(deps, pending.json().draft.id);
  extraction.mockRestore();
  const [late] = await harness.db
    .select()
    .from(conversionDrafts)
    .where(eq(conversionDrafts.id, pending.json().draft.id));
  expect(late).toMatchObject({ state: "failed", suggestions: {} });
});
