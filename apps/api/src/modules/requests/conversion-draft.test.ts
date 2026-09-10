// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
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
  harness = await startHarness({ aiDriverFactory: () => provider });
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
  await handleConversionDraft({ db: harness.db, resolveAiProvider: harness.resolveAiProvider }, id);
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
  await handleConversionDraft({ db: harness.db, resolveAiProvider: harness.resolveAiProvider }, id);
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
  await handleConversionDraft({ db: harness.db, resolveAiProvider: harness.resolveAiProvider }, id);
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
    { db: harness.db, resolveAiProvider: harness.resolveAiProvider },
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
  const row = await ask();
  const made = await prepare(row.number);
  await harness.db.update(aiConnector).set({ matterPreparation: false });
  const count = provider.extractions.length;
  await handleConversionDraft(
    { db: harness.db, resolveAiProvider: harness.resolveAiProvider },
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
