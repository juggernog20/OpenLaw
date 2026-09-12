// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
  aiConnector,
  aiFieldPrompts,
  comments,
  contractTypeFields,
  fields,
  contractAnalysisRuns,
  contracts,
  contractTypes,
  contractTeam,
  users,
  sql,
  eq,
  requests,
  requestTypes,
} from "@openlaw/db";
import { FakeAiProvider, FAKE_VALID_AI_KEY } from "../../lib/ai/fake.js";
import type { AiExtraction } from "../../lib/ai/provider.js";
import { startHarness, TEST_ADMIN, type TestHarness } from "../../testing/harness.js";
import { dispositionScaffold, type DispositionScaffold } from "../../testing/disposition.js";
import { handleContractAnalysis } from "../../pipeline/contract-analysis.js";
let harness: TestHarness;
let cast: DispositionScaffold;
let typeId: string;
let requestTypeId: string;
const answers: Record<string, Omit<AiExtraction, "slug">> = {};
const provider = new FakeAiProvider({ answers });
beforeAll(async () => {
  harness = await startHarness({ aiDriverFactory: () => provider, runPipelineWorkers: false });
  await harness.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  cast = await dispositionScaffold(harness);
  const [type] = await harness.db.select().from(contractTypes).limit(1);
  typeId = type!.id;
  const [rt] = await harness.db
    .insert(requestTypes)
    .values({
      slug: "post_analysis",
      displayOrder: 100,
      displayName: "Post analysis",
      targetModule: "contract",
      targetContractTypeId: typeId,
    })
    .returning();
  requestTypeId = rt!.id;
  const [field] = await harness.db
    .insert(fields)
    .values({
      slug: "post_clear",
      displayName: "Post clear",
      moduleScope: "contract",
      fieldType: "text",
      fieldTag: "business",
      aiPrompt: "Extract the effective date wording.",
    })
    .returning();
  await harness.db
    .insert(contractTypeFields)
    .values({ typeId, fieldId: field!.id, displayOrder: 999, isRequired: false });

  await harness.app.inject({
    method: "PUT",
    url: "/api/v1/ai-connector",
    cookies: cast.adminCookies,
    payload: { preset: "openai", model: "fake", apiKey: FAKE_VALID_AI_KEY },
  });
  const [connector] = await harness.db.select().from(aiConnector);
  expect(connector!.contractConversionAnalysis).toBe(false);
});
beforeEach(async () => {
  for (const slug of Object.keys(answers)) delete answers[slug];
  await harness.db.update(aiConnector).set({ contractConversionAnalysis: true, disabledAt: null });
});
afterAll(async () => {
  await harness?.stop();
});
async function convert(
  payload: Record<string, unknown> = {},
  before?: (id: string) => Promise<void>,
) {
  const [request] = await harness.db
    .insert(requests)
    .values({
      requestTypeId,
      requesterId: cast.requesterId,
      summary: "Agreement",
      description: "Effective October 1, 2026. Notice is 30 days.",
      urgency: "medium",
    })
    .returning();
  answers.effective_date = {
    value: "2026-10-01",
    sourceId: `request:${request!.id}:description`,
    evidence: "Effective October 1, 2026",
  };
  answers.notice_period_days = {
    value: 30,
    sourceId: `request:${request!.id}:description`,
    evidence: "Notice is 30 days",
  };
  await before?.(request!.id);
  const response = await harness.app.inject({
    method: "POST",
    url: `/api/v1/requests/${request!.number}/convert`,
    cookies: cast.memberCookies,
    payload: { title: "Agreement", contractTypeId: typeId, ...payload },
  });
  expect(response.statusCode, response.body).toBe(200);
  const [converted] = await harness.db.select().from(requests).where(eq(requests.id, request!.id));
  const [contract] = await harness.db
    .select()
    .from(contracts)
    .where(eq(contracts.id, converted!.convertedContractId!));
  const runs = await harness.db
    .select()
    .from(contractAnalysisRuns)
    .where(eq(contractAnalysisRuns.contractId, contract!.id));
  return { request: request!, contract: contract!, runs };
}
async function execute(runId: string) {
  await handleContractAnalysis(
    {
      db: harness.db,
      resolveAiProvider: harness.app.resolveAiProvider,
      storage: harness.storage,
      docEngine: harness.app.docEngine,
      log: harness.app.log,
    },
    { runId, retryCount: 0, retryLimit: 0 },
  );
}
it("defaults off, refuses Member settings writes, and works independently of Convert dialog preparation", async () => {
  await harness.db.update(aiConnector).set({ contractConversionAnalysis: false });
  expect((await convert()).runs).toHaveLength(0);
  const patch = (cookies: Record<string, string>) =>
    harness.app.inject({
      method: "PATCH",
      url: "/api/v1/ai-connector/workflows",
      cookies,
      payload: { contractConversionAnalysis: true },
    });
  expect((await patch(cast.memberCookies)).statusCode).toBe(403);
  const saved = await patch(cast.adminCookies);
  expect(saved.statusCode, saved.body).toBe(200);
  expect(saved.json().connector).toMatchObject({
    contractConversionAnalysis: true,
    contractPreparation: false,
  });
  const { contract, runs } = await convert();
  expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({ state: "pending", trigger: "conversion", versionId: null });
  await execute(runs[0]!.id);
  const [row] = await harness.db.select().from(contracts).where(eq(contracts.id, contract.id));
  expect(row).toMatchObject({ effectiveDate: "2026-10-01", noticePeriodDays: 30 });
  expect(row!.aiUnverified?.effective_date?.runId).toBe(runs[0]!.id);
});
it("keeps conversion committed when settings change before execution", async () => {
  const { contract, runs } = await convert();
  await harness.db.update(aiConnector).set({ contractConversionAnalysis: false });
  await execute(runs[0]!.id);
  const [run] = await harness.db
    .select()
    .from(contractAnalysisRuns)
    .where(eq(contractAnalysisRuns.id, runs[0]!.id));
  expect(run!.state).toBe("failed");
  const [row] = await harness.db.select().from(contracts).where(eq(contracts.id, contract.id));
  expect(row!.effectiveDate).toBeNull();
});

it("uses live prompts and original messages, rejects wrong-source quotes, and serves saved evidence with AI disabled", async () => {
  await harness.db.update(aiConnector).set({ contractConversionAnalysis: true });
  await harness.db
    .insert(aiFieldPrompts)
    .values({ slug: "notice_period_days", prompt: "Use the correcting notice period." })
    .onConflictDoUpdate({
      target: aiFieldPrompts.slug,
      set: { prompt: "Use the correcting notice period." },
    });
  let messageId = "";
  const { contract, runs } = await convert({}, async (id) => {
    const [message] = await harness.db
      .insert(comments)
      .values({
        entityType: "request",
        entityId: id,
        authorId: cast.memberId,
        visibility: "full_thread",
        body: "Correction: notice is 45 days.",
      })
      .returning();
    messageId = message!.id;
    await harness.db.insert(comments).values({
      entityType: "request",
      entityId: id,
      authorId: cast.memberId,
      visibility: "legal_only",
      body: "Private strategy: 999 days.",
    });
    answers.notice_period_days = {
      value: 45,
      sourceId: `message:${messageId}`,
      evidence: "notice is 45 days",
    };
    answers.effective_date = {
      value: "2026-10-01",
      sourceId: `message:${messageId}`,
      evidence: "Effective October 1, 2026",
    };
  });
  await execute(runs[0]!.id);
  const [stored] = await harness.db.select().from(contracts).where(eq(contracts.id, contract.id));
  expect(stored!.noticePeriodDays).toBe(45);
  expect(stored!.effectiveDate).toBeNull();
  const call = provider.extractions.at(-1)!;
  expect(JSON.stringify(call)).not.toContain("999 days");
  expect(JSON.stringify(call)).toContain("Use the correcting notice period.");
  await harness.db.update(aiConnector).set({ disabledAt: new Date() });
  const evidence = () =>
    harness.app.inject({
      method: "GET",
      url: `/api/v1/contracts/${contract.number}/analysis/${runs[0]!.id}/evidence/notice_period_days`,
      cookies: cast.memberCookies,
    });
  expect((await evidence()).json()).toMatchObject({
    available: true,
    citations: [{ sourceId: `message:${messageId}`, quote: "notice is 45 days" }],
  });
  await harness.db
    .update(comments)
    .set({ body: "Edited away", editedAt: new Date() })
    .where(eq(comments.id, messageId));
  expect((await evidence()).json()).toEqual({ available: false, citations: [] });
  await harness.db.update(aiConnector).set({ disabledAt: null });
});
it("keeps manual null clears made while extraction is running and fills unrelated Fields", async () => {
  const { contract, runs } = await convert();
  const extract = provider.extract.bind(provider);
  const spy = vi.spyOn(provider, "extract").mockImplementationOnce(async (...args) => {
    const changed = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${contract.number}`,
      cookies: cast.memberCookies,
      payload: { effectiveDate: null },
    });
    expect(changed.statusCode, changed.body).toBe(200);
    return extract(...args);
  });
  await execute(runs[0]!.id);
  spy.mockRestore();
  const [stored] = await harness.db.select().from(contracts).where(eq(contracts.id, contract.id));
  expect(stored!.effectiveDate).toBeNull();
  expect(stored!.noticePeriodDays).toBe(30);
});
it("preserves explicitly cleared Convert dialog Fields and retries failures safely", async () => {
  const { contract, runs } = await convert({ customFields: { post_clear: null } }, async (id) => {
    answers.post_clear = {
      value: "October 1",
      sourceId: `request:${id}:description`,
      evidence: "October 1",
    };
  });
  const spy = vi
    .spyOn(provider, "extract")
    .mockRejectedValueOnce(new Error("Provider secret must not be exposed"));
  await execute(runs[0]!.id);
  spy.mockRestore();
  const [failed] = await harness.db
    .select()
    .from(contractAnalysisRuns)
    .where(eq(contractAnalysisRuns.id, runs[0]!.id));
  expect(failed!.state).toBe("failed");
  expect(failed!.failure).not.toContain("Provider secret");
  const retry = () =>
    harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/analysis/${runs[0]!.id}/retry`,
      cookies: cast.memberCookies,
    });
  const retried = await retry();
  expect(retried.statusCode, retried.body).toBe(202);
  expect((await retry()).json().run.id).toBe(retried.json().run.id);
  await execute(retried.json().run.id);
  const [stored] = await harness.db.select().from(contracts).where(eq(contracts.id, contract.id));
  expect(stored!.customFields.post_clear).toBeUndefined();
  expect(stored!.noticePeriodDays).toBe(30);
});
it("refuses a retry while an ordinary Analysis run is still pending", async () => {
  const { contract, runs } = await convert();
  const spy = vi.spyOn(provider, "extract").mockRejectedValueOnce(new Error("provider down"));
  await execute(runs[0]!.id);
  spy.mockRestore();
  await harness.db.insert(contractAnalysisRuns).values({
    contractId: contract.id,
    requestedBy: cast.memberId,
    trigger: "manual",
    preset: "openai",
    model: "fake",
  });
  const refused = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${contract.number}/analysis/${runs[0]!.id}/retry`,
    cookies: cast.memberCookies,
  });
  expect(refused.statusCode).toBe(409);
  expect(refused.json().detail).toContain("Another Analysis run is already pending");
  const all = await harness.db
    .select()
    .from(contractAnalysisRuns)
    .where(eq(contractAnalysisRuns.contractId, contract.id));
  expect(all.filter((run) => run.trigger === "conversion")).toHaveLength(1);
});
it("refuses late replies after a Type or source changes", async () => {
  for (const change of ["type", "source", "settings"] as const) {
    const { request, contract, runs } = await convert();
    const extract = provider.extract.bind(provider);
    const spy = vi.spyOn(provider, "extract").mockImplementationOnce(async (...args) => {
      if (change === "type") {
        const [other] = await harness.db
          .insert(contractTypes)
          .values({
            slug: `changed_${contract.number}`,
            displayName: "Changed Type",
            displayOrder: 999,
          })
          .returning();
        await harness.db
          .update(contracts)
          .set({ contractTypeId: other!.id })
          .where(eq(contracts.id, contract.id));
      } else if (change === "settings") {
        await harness.db.update(aiConnector).set({ contractConversionAnalysis: false });
      } else
        await harness.db
          .update(requests)
          .set({ description: "Changed original" })
          .where(eq(requests.id, request.id));
      return extract(...args);
    });
    await execute(runs[0]!.id);
    spy.mockRestore();
    const [run] = await harness.db
      .select()
      .from(contractAnalysisRuns)
      .where(eq(contractAnalysisRuns.id, runs[0]!.id));
    expect(run!.state).toBe("failed");
    expect(run!.sourceContext!.suggestions).toEqual({});
    const [stored] = await harness.db.select().from(contracts).where(eq(contracts.id, contract.id));
    expect(stored!.noticePeriodDays).toBeNull();
    await harness.db.update(aiConnector).set({ contractConversionAnalysis: true });
  }
});
it("reads multiple original attachments, reports omissions and suppresses competing primary-Document runs", async () => {
  const { Readable } = await import("node:stream");
  const { requestAttachments, documentVersionText } = await import("@openlaw/db");
  const { fakeExtractedText } = await import("../../lib/doc-engine/fake.js");
  const { requestAutomaticContractAnalysis } =
    await import("../../pipeline/automatic-contract-analysis.js");
  const attachmentIds: string[] = [];
  const { contract, runs } = await convert({}, async (id) => {
    for (const index of [1, 2, 3]) {
      const bytes = Buffer.from(index === 3 ? "unreadable" : `%PDF-1.4\nAgreement ${index}`);
      const fileRef = await harness.storage.put(`analysis/${id}/${index}`, Readable.from([bytes]));
      const [file] = await harness.db
        .insert(requestAttachments)
        .values({
          requestId: id,
          fileRef,
          filename: index === 3 ? "omitted.bin" : `${index}.pdf`,
          uploadedBy: cast.requesterId,
        })
        .returning();
      attachmentIds.push(file!.id);
      if (index < 3)
        answers[index === 1 ? "effective_date" : "notice_period_days"] = {
          value: index === 1 ? "2026-10-01" : 30,
          sourceId: `attachment:${file!.id}`,
          evidence: fakeExtractedText(bytes),
        };
    }
  });
  const [primary] = await harness.db
    .select()
    .from(requestAttachments)
    .where(eq(requestAttachments.id, attachmentIds[0]!));
  await harness.db
    .insert(documentVersionText)
    .values({
      versionId: primary!.promotedVersionId!,
      state: "ready",
      text: "Ready primary paper",
      source: "native_layer",
    })
    .onConflictDoNothing();
  const automatic = () =>
    requestAutomaticContractAnalysis(
      {
        db: harness.db,
        jobs: harness.app.jobs,
        resolveAiProvider: harness.app.resolveAiProvider,
        log: harness.app.log,
      },
      primary!.promotedVersionId!,
    );
  await automatic();
  await execute(runs[0]!.id);
  await automatic();
  const all = await harness.db
    .select()
    .from(contractAnalysisRuns)
    .where(eq(contractAnalysisRuns.contractId, contract.id));
  expect(all).toHaveLength(1);
  expect(all[0]!.state).toBe("ready");
  expect(all[0]!.sourceContext!.warnings).toContain("attachment_omissions");
  const evidence = await harness.app.inject({
    method: "GET",
    url: `/api/v1/contracts/${contract.number}/analysis/${runs[0]!.id}/evidence/effective_date`,
    cookies: cast.memberCookies,
  });
  expect(evidence.json()).toMatchObject({
    available: true,
    citations: [
      {
        sourceId: `attachment:${attachmentIds[0]}`,
        attachment: { versionId: primary!.promotedVersionId },
      },
    ],
  });
});

it("keeps an explicitly cleared Counterparty empty after conversion", async () => {
  const { counterparties, contractCounterparties } = await import("@openlaw/db");
  await harness.db.insert(counterparties).values({ name: "Post analysis counterparty" });
  const { contract, runs } = await convert({ counterpartyCleared: true }, async (id) => {
    answers.counterparty = {
      value: "Post analysis counterparty",
      sourceId: `request:${id}:summary`,
      evidence: "Agreement",
    };
  });
  await execute(runs[0]!.id);
  const linked = await harness.db
    .select()
    .from(contractCounterparties)
    .where(eq(contractCounterparties.contractId, contract.id));
  expect(linked).toEqual([]);
});

it("preserves an explicit clear carried from saved Request answers", async () => {
  const { contract, runs } = await convert({}, async (id) => {
    await harness.db
      .update(requests)
      .set({ customFields: { post_clear: "" } })
      .where(eq(requests.id, id));
    answers.post_clear = {
      value: "October 1",
      sourceId: `request:${id}:description`,
      evidence: "October 1",
    };
  });
  expect(contract.analysisHumanFields).toContain("post_clear");
  await execute(runs[0]!.id);
  const [stored] = await harness.db.select().from(contracts).where(eq(contracts.id, contract.id));
  expect(stored!.customFields.post_clear).toBeUndefined();
});

it("renews an active worker lease before a sweep can dispatch a competing extraction", async () => {
  const { sweepConversionAnalysis } = await import("../../pipeline/conversion-analysis.js");
  const { runs } = await convert();
  const run = runs[0]!;
  const extract = provider.extract.bind(provider);
  let release!: () => void;
  let started!: () => void;
  const begun = new Promise<void>((resolve) => {
    started = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const spy = vi.spyOn(provider, "extract").mockImplementationOnce(async (...args) => {
    started();
    await hold;
    return extract(...args);
  });
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const executing = execute(run.id);
  try {
    await begun;
    const old = new Date(Date.now() - 240_000);
    await harness.db
      .update(contractAnalysisRuns)
      .set({ leaseAt: old })
      .where(eq(contractAnalysisRuns.id, run.id));
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.waitFor(async () => {
      const [held] = await harness.db
        .select()
        .from(contractAnalysisRuns)
        .where(eq(contractAnalysisRuns.id, run.id));
      expect(held!.leaseAt!.valueOf()).toBeGreaterThan(old.valueOf());
    });
    const dispatch = vi.spyOn(harness.app.jobs, "requestContractAnalysis");
    await sweepConversionAnalysis(harness.db, harness.app.jobs);
    expect(dispatch.mock.calls.some(([, id]) => id === run.id)).toBe(false);
    await execute(run.id);
    expect(spy).toHaveBeenCalledTimes(1);
    dispatch.mockRestore();
  } finally {
    release();
    await executing;
    vi.useRealTimers();
    spy.mockRestore();
  }
  const [ready] = await harness.db
    .select()
    .from(contractAnalysisRuns)
    .where(eq(contractAnalysisRuns.id, run.id));
  expect(ready!.state).toBe("ready");
});

it("omits Legal Field names and Analysis outcomes from Portal work", async () => {
  const slug = "private_strategy";
  const [field] = await harness.db
    .insert(fields)
    .values({
      slug,
      displayName: "Private strategy",
      moduleScope: "contract",
      fieldType: "text",
      fieldTag: "legal",
      aiPrompt: "Extract the effective date wording.",
    })
    .returning();
  await harness.db
    .insert(contractTypeFields)
    .values({ typeId, fieldId: field!.id, displayOrder: 1001, isRequired: false });
  const { contract, runs } = await convert({}, async (id) => {
    answers[slug] = {
      value: "October 1",
      sourceId: `request:${id}:description`,
      evidence: "October 1",
    };
  });
  await execute(runs[0]!.id);
  const get = (cookies: Record<string, string>) =>
    harness.app.inject({ method: "GET", url: `/api/v1/contracts/${contract.number}`, cookies });
  const member = await get(cast.memberCookies);
  expect(member.statusCode, member.body).toBe(200);
  expect(member.json().analysis.latestRun.outcome.written).toContain(slug);
  const [viewer] = await harness.db
    .select()
    .from(users)
    .where(eq(users.email, "contributor@example.com"));
  await harness.db.insert(contractTeam).values({ contractId: contract.id, userId: viewer!.id });
  const portal = () =>
    harness.app.inject({
      method: "GET",
      url: `/api/v1/portal/contracts/${contract.number}/work`,
      cookies: cast.contributorCookies,
    });
  const contributor = await portal();
  expect(contributor.statusCode, contributor.body).toBe(200);
  expect(contributor.body).not.toContain(slug);
  expect(contributor.json().work.customFields).not.toHaveProperty(slug);
  // Older summaries may retain classification lists without per-target results.
  await harness.db
    .update(contractAnalysisRuns)
    .set({ outcome: sql`${contractAnalysisRuns.outcome} - 'results'` })
    .where(eq(contractAnalysisRuns.id, runs[0]!.id));
  const legacy = await portal();
  expect(legacy.statusCode, legacy.body).toBe(200);
  expect(legacy.body).not.toContain(slug);
  expect(legacy.json()).not.toHaveProperty("analysis");
});

it("keeps the core Value marker when a legacy custom Field named value is edited", async () => {
  const { contract } = await convert();
  const [field] = await harness.db
    .insert(fields)
    .values({
      slug: "value",
      displayName: "Legacy value",
      moduleScope: "contract",
      fieldType: "text",
      fieldTag: "business",
    })
    .returning();
  await harness.db
    .insert(contractTypeFields)
    .values({ typeId, fieldId: field!.id, displayOrder: 1002, isRequired: false });
  const marker = {
    runId: contract.id,
    writtenAt: new Date().toISOString(),
    evidence: "Original value",
  };
  await harness.db
    .update(contracts)
    .set({ aiUnverified: { value: marker, "field:value": marker } })
    .where(eq(contracts.id, contract.id));
  const patch = () =>
    harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${contract.number}`,
      cookies: cast.memberCookies,
      payload: { customFields: { value: "Human custom value" } },
    });
  const edited = await patch();
  expect(edited.statusCode, edited.body).toBe(200);
  expect(edited.json().contract.aiUnverified.value).toMatchObject({ runId: contract.id });
  expect(edited.json().contract.aiUnverified).not.toHaveProperty("field:value");
  const repeated = await patch();
  expect(repeated.statusCode, repeated.body).toBe(200);
  expect(repeated.json().contract.updatedAt).toBe(edited.json().contract.updatedAt);
});
