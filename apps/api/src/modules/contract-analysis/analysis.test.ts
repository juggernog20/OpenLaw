// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  and,
  contractAnalysisRuns,
  contractCounterparties,
  contracts,
  contractTeam,
  contractTypeFields,
  counterparties,
  documentVersions,
  documentVersionText,
  documents,
  eq,
  fields,
  users,
} from "@openlaw/db";
import { AI_ANALYSIS_CHARACTER_BUDGET } from "@openlaw/shared";
import { provisionUser } from "../../auth/instance.js";
import {
  AiConfigError,
  AiUnavailableError,
  type AiExtractionTarget,
} from "../../lib/ai/provider.js";
import { FAKE_VALID_AI_KEY, FakeAiProvider } from "../../lib/ai/fake.js";
import { handleContractAnalysis } from "../../pipeline/contract-analysis.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "analysis-member@example.com",
  displayName: "Ari Counsel",
  password: "analysis-member-password",
} as const;
const CONTRIBUTOR = {
  email: "analysis-contributor@example.com",
  displayName: "Casey Contributor",
  password: "analysis-contributor-password",
} as const;

type Answer = { value: unknown; evidence?: string };
const answers: Record<string, Answer> = {};

class ScriptedProvider extends FakeAiProvider {
  failure: "none" | "config" | "transport" = "none";

  constructor() {
    super({ answers, model: "analysis-test-model" });
  }

  override async extract(text: string, targets: readonly AiExtractionTarget[]) {
    if (this.failure === "config") throw new AiConfigError("The scripted key was refused.");
    if (this.failure === "transport") throw new AiUnavailableError("The scripted host is down.");
    return super.extract(text, targets);
  }
}

let harness: TestHarness;
let provider: ScriptedProvider;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let memberId = "";
let contributorId = "";
let ndaTypeId = "";

beforeAll(async () => {
  harness = await startHarness({
    aiDriverFactory: () => {
      provider = new ScriptedProvider();
      return provider;
    },
  });
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: TEST_ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  adminCookies = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);

  const member = await provisionUser(harness.app.auth, MEMBER);
  memberId = member.id;
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, member.id));
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
  const contributor = await provisionUser(harness.app.auth, CONTRIBUTOR);
  contributorId = contributor.id;
  await harness.db.update(users).set({ role: "contributor" }).where(eq(users.id, contributor.id));
  contributorCookies = await signInCookies(harness.app, CONTRIBUTOR.email, CONTRIBUTOR.password);

  const options = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: memberCookies,
  });
  ndaTypeId = (options.json().contractTypes as { id: string; slug: string }[]).find(
    (type) => type.slug === "nda",
  )!.id;
  const catalog = await harness.db.select({ id: fields.id, slug: fields.slug }).from(fields);
  for (const [index, slug] of ["governing_law", "jurisdiction", "our_position"].entries()) {
    const field = catalog.find((candidate) => candidate.slug === slug)!;
    await harness.db
      .insert(contractTypeFields)
      .values({ typeId: ndaTypeId, fieldId: field.id, displayOrder: index + 1 })
      .onConflictDoNothing();
  }
});

afterAll(async () => {
  await harness.stop();
});

async function newContract(title: string) {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: memberCookies,
    payload: { title, contractTypeId: ndaTypeId },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().contract as { id: string; number: number };
}

async function addPaper(contract: { id: string }, texts: string[], executed = -1) {
  const [document] = await harness.db
    .insert(documents)
    .values({ title: "Agreement", contractId: contract.id, createdBy: memberId })
    .returning();
  const versions = [];
  for (const [index, text] of texts.entries()) {
    const [version] = await harness.db
      .insert(documentVersions)
      .values({
        documentId: document!.id,
        versionNumber: index + 1,
        fileRef: `local:analysis-${document!.id}-${String(index + 1)}`,
        kind: "draft_ours",
        originalFilename: `agreement-${String(index + 1)}.pdf`,
        mimeType: "application/pdf",
        byteSize: text.length,
        checksumSha256: "0".repeat(64),
        createdBy: memberId,
      })
      .returning();
    await harness.db.insert(documentVersionText).values({
      versionId: version!.id,
      state: "ready",
      source: "native_layer",
      text,
    });
    versions.push(version!);
  }
  if (executed >= 0) {
    await harness.db
      .update(documents)
      .set({ executedVersionId: versions[executed]!.id })
      .where(eq(documents.id, document!.id));
  }
  await harness.db
    .update(contracts)
    .set({ primaryDocumentId: document!.id })
    .where(eq(contracts.id, contract.id));
  return { document: document!, versions };
}

async function configureConnector() {
  const response = await harness.app.inject({
    method: "PUT",
    url: "/api/v1/ai-connector",
    cookies: adminCookies,
    payload: {
      preset: "custom",
      protocol: "openai_chat_completions",
      baseUrl: "https://analysis.invalid/v1",
      apiKey: FAKE_VALID_AI_KEY,
      model: "analysis-test-model",
    },
  });
  expect(response.statusCode, response.body).toBe(200);
}

async function startRun(number: number) {
  return harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${String(number)}/analysis`,
    cookies: memberCookies,
  });
}

async function waitForRun(id: string) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const [run] = await harness.db
      .select()
      .from(contractAnalysisRuns)
      .where(eq(contractAnalysisRuns.id, id));
    if (run?.state !== "pending") return run!;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`analysis run ${id} did not settle`);
}

function setAnswers(next: Record<string, Answer>) {
  for (const slug of Object.keys(answers)) delete answers[slug];
  Object.assign(answers, next);
}

describe("the manual Contract analysis run", () => {
  it("refuses missing configuration and Contributors", async () => {
    const contract = await newContract("Analysis role floor");
    await harness.db.insert(contractTeam).values({
      contractId: contract.id,
      userId: contributorId,
      role: "contributor",
    });
    const noConnector = await startRun(contract.number);
    expect(noConnector.statusCode).toBe(409);
    expect(noConnector.json().title).toBe("No enabled AI connector is configured.");
    const contributor = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${String(contract.number)}/analysis`,
      cookies: contributorCookies,
    });
    expect(contributor.statusCode).toBe(403);
    await configureConnector();
  });

  it("refuses a missing primary Document, missing ready text, and a pending run", async () => {
    const contract = await newContract("Analysis refusals");
    expect((await startRun(contract.number)).statusCode).toBe(409);
    const paper = await addPaper(contract, ["Some ready words"]);
    await harness.db
      .update(documentVersionText)
      .set({ state: "failed", source: null, text: null })
      .where(eq(documentVersionText.versionId, paper.versions[0]!.id));
    expect((await startRun(contract.number)).statusCode).toBe(409);
    await harness.db
      .update(documentVersionText)
      .set({ state: "ready", source: "native_layer", text: "Some ready words" })
      .where(eq(documentVersionText.versionId, paper.versions[0]!.id));
    await harness.db.insert(contractAnalysisRuns).values({
      contractId: contract.id,
      versionId: paper.versions[0]!.id,
      state: "pending",
      trigger: "manual",
      requestedBy: memberId,
      preset: "custom",
      model: "analysis-test-model",
    });
    expect((await startRun(contract.number)).statusCode).toBe(409);
  });

  it("refuses ended and archived Contracts", async () => {
    const ended = await newContract("Analysis ended refusal");
    await addPaper(ended, ["Ended paper"]);
    await harness.db
      .update(contracts)
      .set({ endedAt: new Date() })
      .where(eq(contracts.id, ended.id));
    expect((await startRun(ended.number)).statusCode).toBe(409);

    const archived = await newContract("Analysis archived refusal");
    await addPaper(archived, ["Archived paper"]);
    await harness.db
      .update(contracts)
      .set({ archivedAt: new Date() })
      .where(eq(contracts.id, archived.id));
    expect((await startRun(archived.number)).statusCode).toBe(409);
  });

  it("runs through the real queue, applies valid answers once, and reads the flags and run", async () => {
    const contract = await newContract("The analyzed agreement");
    const text = [
      "This agreement automatically renews every twelve months.",
      "It is effective on 2026-01-15 and expires on 2027-01-14.",
      "Either party must give 60 days notice.",
      "Fees are USD 1200 every month.",
      "The primary party is ACME   LLC.",
      "The governing law is England and Wales.",
      "The customer receives services. A later effective date is 2026-02-01.",
    ].join("\n");
    const paper = await addPaper(contract, [text]);
    const [party] = await harness.db
      .insert(counterparties)
      .values({ name: "Acme LLC" })
      .returning();
    const prompt = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/ai-field-prompts",
      cookies: adminCookies,
      payload: { slug: "effective_date", prompt: "Use the first effective date." },
    });
    expect(prompt.statusCode, prompt.body).toBe(200);
    setAnswers({
      term_type: { value: "AUTO RENEW", evidence: "automatically renews" },
      effective_date: { value: "2026-01-15", evidence: "effective on 2026-01-15" },
      expiry_date: { value: "2027-01-14", evidence: "expires on 2027-01-14" },
      renewal_period_months: { value: "12", evidence: "every twelve months" },
      notice_period_days: { value: 60, evidence: "60 days notice" },
      value: {
        value: { amount: 120000, currency: "usd", cadence: "monthly" },
        evidence: "USD 1200 every month",
      },
      counterparty: { value: "acme llc", evidence: "acme llc" },
      governing_law: { value: "England and Wales", evidence: "governing law is England and Wales" },
      jurisdiction: { value: "Dubai", evidence: "courts of Dubai" },
      our_position: { value: "Buyer", evidence: "customer receives services" },
    });

    const response = await startRun(contract.number);
    expect(response.statusCode, response.body).toBe(202);
    expect(response.json().run).toMatchObject({
      versionId: paper.versions[0]!.id,
      state: "pending",
      trigger: "manual",
      requestedBy: memberId,
    });
    const run = await waitForRun(response.json().run.id as string);
    expect(run.state).toBe("ready");
    expect(run.outcome).toEqual({
      written: [
        "term_type",
        "effective_date",
        "expiry_date",
        "renewal_period_months",
        "notice_period_days",
        "value",
        "counterparty",
        "governing_law",
      ],
      kept: [],
      unsupported: ["jurisdiction"],
      invalid: ["our_position"],
      results: expect.any(Array),
    });
    expect(run.outcome!.results).toEqual(
      expect.arrayContaining([
        {
          slug: "effective_date",
          value: "2026-01-15",
          evidence: "effective on 2026-01-15",
          outcome: "written",
        },
        {
          slug: "jurisdiction",
          value: "Dubai",
          evidence: "courts of Dubai",
          outcome: "unsupported",
        },
        {
          slug: "our_position",
          value: "Buyer",
          evidence: "customer receives services",
          outcome: "invalid",
        },
      ]),
    );
    expect(
      provider.extractions.at(-1)?.targets.find((target) => target.slug === "effective_date"),
    ).toMatchObject({ prompt: "Use the first effective date." });

    const read = await harness.app.inject({
      method: "GET",
      url: `/api/v1/contracts/${String(contract.number)}`,
      cookies: memberCookies,
    });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json().contract).toMatchObject({
      termType: "auto_renew",
      effectiveDate: "2026-01-15",
      expiryDate: "2027-01-14",
      renewalPeriodMonths: 12,
      noticePeriodDays: 60,
      value: { amount: 120000, currency: "USD", cadence: "monthly" },
      customFields: { governing_law: "England and Wales" },
    });
    expect(Object.keys(read.json().contract.aiUnverified).toSorted()).toEqual(
      run.outcome!.written.toSorted(),
    );
    expect(read.json().analysis).toMatchObject({
      available: true,
      latestRun: { id: run.id, state: "ready", versionNumber: 1 },
    });
    const links = await harness.db
      .select()
      .from(contractCounterparties)
      .where(eq(contractCounterparties.contractId, contract.id));
    expect(links).toEqual([
      expect.objectContaining({ counterpartyId: party!.id, isPrimary: true }),
    ]);
    const entries = await harness.db
      .select()
      .from(activityLog)
      .where(
        and(
          eq(activityLog.entityId, contract.id),
          eq(activityLog.action, "contract.analysis_completed"),
        ),
      );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.payload).toMatchObject({ runId: run.id, versionId: paper.versions[0]!.id });

    const patched = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${String(contract.number)}`,
      cookies: memberCookies,
      payload: { effectiveDate: "2026-01-15" },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json().contract.aiUnverified).not.toHaveProperty("effective_date");

    // A second party beside the AI-linked primary leaves its marker alone.
    const added = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${String(contract.number)}/counterparties`,
      cookies: memberCookies,
      payload: { name: "Beta GmbH" },
    });
    expect(added.statusCode, added.body).toBe(201);
    const [beforeRemoval] = await harness.db
      .select({ aiUnverified: contracts.aiUnverified })
      .from(contracts)
      .where(eq(contracts.id, contract.id));
    expect(beforeRemoval!.aiUnverified).toHaveProperty("counterparty");

    // A person taking the AI-linked primary off verifies that slot.
    const removed = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/contracts/${String(contract.number)}/counterparties/${party!.id}`,
      cookies: memberCookies,
    });
    expect(removed.statusCode, removed.body).toBe(200);
    const [afterRemoval] = await harness.db
      .select({ aiUnverified: contracts.aiUnverified })
      .from(contracts)
      .where(eq(contracts.id, contract.id));
    expect(afterRemoval!.aiUnverified).not.toHaveProperty("counterparty");
    expect(afterRemoval!.aiUnverified).toHaveProperty("governing_law");
  });

  it("clears the counterparty marker when a person names another primary", async () => {
    const contract = await newContract("Analysis primary handover");
    const [acme] = await harness.db
      .select({ id: counterparties.id })
      .from(counterparties)
      .where(eq(counterparties.name, "Acme LLC"));
    const [beta] = await harness.db
      .insert(counterparties)
      .values({ name: "Handover Beta Ltd" })
      .returning();
    await harness.db.insert(contractCounterparties).values([
      { contractId: contract.id, counterpartyId: acme!.id, isPrimary: true },
      { contractId: contract.id, counterpartyId: beta!.id, isPrimary: false },
    ]);
    await harness.db
      .update(contracts)
      .set({
        aiUnverified: {
          counterparty: {
            evidence: "Acme LLC",
            runId: "older",
            writtenAt: new Date().toISOString(),
          },
        },
      })
      .where(eq(contracts.id, contract.id));
    const promoted = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${String(contract.number)}/counterparties/${beta!.id}/primary`,
      cookies: memberCookies,
    });
    expect(promoted.statusCode, promoted.body).toBe(200);
    const [row] = await harness.db
      .select({ aiUnverified: contracts.aiUnverified })
      .from(contracts)
      .where(eq(contracts.id, contract.id));
    expect(row!.aiUnverified).toBeNull();
  });

  it("withholds detailed results outside the analyzed Document's audience", async () => {
    const contract = await newContract("Confidential analysis result");
    const paper = await addPaper(contract, ["A private effective date is 2027-02-03."]);
    await harness.db
      .update(documents)
      .set({ isConfidential: true })
      .where(eq(documents.id, paper.document.id));
    await harness.db
      .delete(contractTeam)
      .where(and(eq(contractTeam.contractId, contract.id), eq(contractTeam.userId, memberId)));
    const [run] = await harness.db
      .insert(contractAnalysisRuns)
      .values({
        contractId: contract.id,
        versionId: paper.versions[0]!.id,
        state: "ready",
        trigger: "manual",
        requestedBy: memberId,
        preset: "custom",
        model: "analysis-test-model",
        outcome: {
          written: ["effective_date"],
          kept: [],
          unsupported: [],
          invalid: [],
          results: [
            {
              slug: "effective_date",
              value: "2027-02-03",
              evidence: "private effective date is 2027-02-03",
              outcome: "written",
            },
          ],
        },
        finishedAt: new Date(),
      })
      .returning();

    const restricted = await harness.app.inject({
      method: "GET",
      url: `/api/v1/contracts/${String(contract.number)}`,
      cookies: memberCookies,
    });
    expect(restricted.statusCode, restricted.body).toBe(200);
    expect(restricted.json().analysis.latestRun).toMatchObject({ id: run!.id, state: "ready" });
    expect(restricted.json().analysis.latestRun.outcome).not.toHaveProperty("results");

    const administrator = await harness.app.inject({
      method: "GET",
      url: `/api/v1/contracts/${String(contract.number)}`,
      cookies: adminCookies,
    });
    expect(administrator.statusCode, administrator.body).toBe(200);
    expect(administrator.json().analysis.latestRun.outcome.results).toEqual([
      expect.objectContaining({ slug: "effective_date", value: "2027-02-03" }),
    ]);
  });

  it("keeps human and confirmed values, replaces earlier AI evidence, and reports an occupied Counterparty", async () => {
    const contract = await newContract("Analysis overwrite rules");
    await addPaper(contract, [
      "Effective on 2026-01-01. Revised effective on 2026-02-01. Notice is 45 days. Notice is 60 days. Fees are USD 500 once. Acme LLC. We are the Customer.",
    ]);
    const [party] = await harness.db
      .select({ id: counterparties.id })
      .from(counterparties)
      .where(eq(counterparties.name, "Acme LLC"));
    await harness.db.insert(contractCounterparties).values({
      contractId: contract.id,
      counterpartyId: party!.id,
      isPrimary: true,
    });
    await harness.db
      .update(contracts)
      .set({
        effectiveDate: "2026-01-01",
        noticePeriodDays: 45,
        valueAmount: 50000,
        valueCurrency: "USD",
        valueCadence: "one_time",
        aiUnverified: {
          effective_date: {
            evidence: "Effective on 2026-01-01",
            runId: "older",
            writtenAt: new Date().toISOString(),
          },
        },
      })
      .where(eq(contracts.id, contract.id));
    setAnswers({
      effective_date: { value: "2026-02-01", evidence: "Revised effective on 2026-02-01" },
      notice_period_days: { value: 60, evidence: "Notice is 60 days" },
      value: {
        value: { amount: 60000, currency: "USD", cadence: "monthly" },
        evidence: "Fees are USD 500 once",
      },
      counterparty: { value: "Acme LLC", evidence: "Acme LLC" },
      our_position: { value: "customer", evidence: "We are the Customer" },
    });
    const response = await startRun(contract.number);
    const run = await waitForRun(response.json().run.id as string);
    expect(run.outcome).toMatchObject({
      written: expect.arrayContaining(["effective_date"]),
      kept: expect.arrayContaining(["notice_period_days", "value"]),
      unmatched: "Acme LLC",
    });
    expect(run.outcome!.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: "notice_period_days", outcome: "kept" }),
        expect.objectContaining({ slug: "value", outcome: "kept" }),
        expect.objectContaining({ slug: "counterparty", outcome: "unmatched" }),
      ]),
    );
    const [row] = await harness.db.select().from(contracts).where(eq(contracts.id, contract.id));
    expect(row).toMatchObject({
      effectiveDate: "2026-02-01",
      noticePeriodDays: 45,
      valueAmount: 50000,
      valueCadence: "one_time",
      customFields: { our_position: "Customer" },
    });
    expect(row!.customFields).not.toHaveProperty("notice_period_days");
    expect(row!.customFields).not.toHaveProperty("value");
    expect(row!.aiUnverified?.effective_date).toMatchObject({
      evidence: "Revised effective on 2026-02-01",
      runId: run.id,
    });
  });

  it("rejects contradictory term dependents and writes no partial value", async () => {
    const contract = await newContract("Analysis invalid groups");
    await addPaper(contract, [
      "This agreement is evergreen. It expires 2030-01-01. It renews every 12 months. Value is ZZQ 10 each century.",
    ]);
    await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${String(contract.number)}`,
      cookies: memberCookies,
      payload: { termType: "evergreen" },
    });
    setAnswers({
      term_type: { value: "evergreen", evidence: "agreement is evergreen" },
      expiry_date: { value: "2030-01-01", evidence: "expires 2030-01-01" },
      renewal_period_months: { value: 12, evidence: "renews every 12 months" },
      value: {
        value: { amount: 1000, currency: "ZZQ", cadence: "century" },
        evidence: "Value is ZZQ 10 each century",
      },
    });
    const response = await startRun(contract.number);
    const run = await waitForRun(response.json().run.id as string);
    expect(run.outcome).toMatchObject({
      kept: expect.arrayContaining(["term_type"]),
      invalid: expect.arrayContaining(["expiry_date", "renewal_period_months", "value"]),
    });
    const [row] = await harness.db.select().from(contracts).where(eq(contracts.id, contract.id));
    expect(row).toMatchObject({
      expiryDate: null,
      renewalPeriodMonths: null,
      valueAmount: null,
      valueCurrency: null,
      valueCadence: null,
    });
    expect(row!.customFields).not.toHaveProperty("expiry_date");
    expect(row!.customFields).not.toHaveProperty("renewal_period_months");
  });

  it("analyzes the executed pin instead of the current Version", async () => {
    const contract = await newContract("Analysis executed pin");
    const paper = await addPaper(contract, ["Executed words", "Current draft words"], 0);
    setAnswers({});
    const response = await startRun(contract.number);
    const run = await waitForRun(response.json().run.id as string);
    expect(run.versionId).toBe(paper.versions[0]!.id);
    expect(provider.extractions.at(-1)?.text).toBe("Executed words");
  });

  it("cuts oversized text to the source budget and records the truncation", async () => {
    const contract = await newContract("Analysis source budget");
    await addPaper(contract, ["Opening words " + "x".repeat(AI_ANALYSIS_CHARACTER_BUDGET)]);
    setAnswers({});
    const response = await startRun(contract.number);
    const run = await waitForRun(response.json().run.id as string);
    expect(run).toMatchObject({ state: "ready", truncated: true });
    expect(provider.extractions.at(-1)?.text).toHaveLength(AI_ANALYSIS_CHARACTER_BUDGET);
  });

  it("records terminal failures and lets transport failures escape for retry", async () => {
    const terminal = await newContract("Analysis terminal failure");
    const paper = await addPaper(terminal, ["Terminal provider words"]);
    provider.failure = "config";
    const response = await startRun(terminal.number);
    const failed = await waitForRun(response.json().run.id as string);
    expect(failed).toMatchObject({ state: "failed", failure: "The scripted key was refused." });
    const failures = await harness.db
      .select()
      .from(activityLog)
      .where(
        and(
          eq(activityLog.entityId, terminal.id),
          eq(activityLog.action, "contract.analysis_failed"),
        ),
      );
    expect(failures).toHaveLength(1);

    const [retrying] = await harness.db
      .insert(contractAnalysisRuns)
      .values({
        contractId: terminal.id,
        versionId: paper.versions[0]!.id,
        state: "pending",
        trigger: "manual",
        requestedBy: memberId,
        preset: "custom",
        model: "analysis-test-model",
      })
      .returning();
    provider.failure = "transport";
    await expect(
      handleContractAnalysis(
        {
          db: harness.db,
          resolveAiProvider: () => Promise.resolve(provider),
          log: { info: () => {}, warn: () => {}, error: () => {} },
        },
        { runId: retrying!.id, retryCount: 0, retryLimit: 2 },
      ),
    ).rejects.toBeInstanceOf(AiUnavailableError);
    const [stillPending] = await harness.db
      .select()
      .from(contractAnalysisRuns)
      .where(eq(contractAnalysisRuns.id, retrying!.id));
    expect(stillPending!.state).toBe("pending");
    provider.failure = "none";
  });
});

describe("confirming AI-written Contract values", () => {
  async function flaggedContract(title: string, slugs = ["effective_date", "notice_period_days"]) {
    const contract = await newContract(title);
    const writtenAt = new Date().toISOString();
    await harness.db
      .update(contracts)
      .set({
        effectiveDate: "2026-01-15",
        noticePeriodDays: 60,
        aiUnverified: Object.fromEntries(
          slugs.map((slug) => [
            slug,
            { evidence: `Evidence for ${slug}`, runId: "confirm-run", writtenAt },
          ]),
        ),
      })
      .where(eq(contracts.id, contract.id));
    return contract;
  }

  it("confirms one flagged slug and answers the fresh Contract record", async () => {
    const contract = await flaggedContract("Confirm one analysis value");
    const response = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${String(contract.number)}/analysis/confirm`,
      cookies: memberCookies,
      payload: { slug: "effective_date" },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().contract.aiUnverified).not.toHaveProperty("effective_date");
    expect(response.json().contract.aiUnverified).toHaveProperty("notice_period_days");
    const entries = await harness.db
      .select({ action: activityLog.action, payload: activityLog.payload })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.entityId, contract.id),
          eq(activityLog.action, "contract.field_confirmed"),
        ),
      );
    expect(entries).toEqual([
      {
        action: "contract.field_confirmed",
        payload: expect.objectContaining({ slug: "effective_date" }),
      },
    ]);
  });

  it("confirms every flagged slug in one transaction and writes one entry per slug", async () => {
    const contract = await flaggedContract("Confirm all analysis values", [
      "effective_date",
      "notice_period_days",
      "governing_law",
    ]);
    const response = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${String(contract.number)}/analysis/confirm-all`,
      cookies: memberCookies,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().contract.aiUnverified).toBeNull();
    const entries = await harness.db
      .select({ action: activityLog.action, payload: activityLog.payload })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.entityId, contract.id),
          eq(activityLog.action, "contract.field_confirmed"),
        ),
      );
    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.payload.slug).toSorted()).toEqual([
      "effective_date",
      "governing_law",
      "notice_period_days",
    ]);
  });

  it("refuses Contributors, frozen Contracts, and unknown or unflagged slugs", async () => {
    const contract = await flaggedContract("Confirm analysis refusals");
    await harness.db.insert(contractTeam).values({
      contractId: contract.id,
      userId: contributorId,
      role: "contributor",
    });

    const contributor = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${String(contract.number)}/analysis/confirm`,
      cookies: contributorCookies,
      payload: { slug: "effective_date" },
    });
    expect(contributor.statusCode).toBe(403);

    const unknown = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${String(contract.number)}/analysis/confirm`,
      cookies: memberCookies,
      payload: { slug: "not_a_target" },
    });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().type).toBe("about:blank");

    const unflagged = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${String(contract.number)}/analysis/confirm`,
      cookies: memberCookies,
      payload: { slug: "expiry_date" },
    });
    expect(unflagged.statusCode).toBe(400);
    expect(unflagged.json().type).toBe("about:blank");

    await harness.db
      .update(contracts)
      .set({ archivedAt: new Date() })
      .where(eq(contracts.id, contract.id));
    const frozen = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${String(contract.number)}/analysis/confirm-all`,
      cookies: memberCookies,
    });
    expect(frozen.statusCode).toBe(409);
  });
});
