// SPDX-License-Identifier: AGPL-3.0-only

/** Automatic CTR-008 runs from ready text and the executed pin (#664). */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  contractAnalysisRuns,
  contracts,
  documentVersions,
  documentVersionText,
  documents,
  entities,
  entityTypes,
  eq,
  knowledgeItems,
  knowledgeTypes,
  matters,
  matterStatuses,
  matterTypes,
  users,
} from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import { fakeExtractedText } from "../../lib/doc-engine/fake.js";
import { FakeAiProvider, FAKE_VALID_AI_KEY } from "../../lib/ai/fake.js";
import type { AiExtractionTarget } from "../../lib/ai/provider.js";
import { requestAutomaticContractAnalysis } from "../../pipeline/automatic-contract-analysis.js";
import { handleContractAnalysis } from "../../pipeline/contract-analysis.js";
import type { JobQueue } from "../../pipeline/jobs.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "automatic-analysis-member@example.com",
  displayName: "Ari Counsel",
  password: "automatic-analysis-password",
} as const;

type Answer = { value: unknown; evidence?: string };
const answers: Record<string, Answer> = {};

class BlockingProvider extends FakeAiProvider {
  private entered: (() => void) | null = null;
  private held: Promise<void> | null = null;
  private releaseHeld: (() => void) | null = null;

  constructor() {
    super({ answers, model: "automatic-analysis-model" });
  }

  holdNext(): { entered: Promise<void>; release: () => void } {
    let markEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    this.entered = markEntered;
    this.held = new Promise<void>((resolve) => {
      this.releaseHeld = resolve;
    });
    return {
      entered,
      release: () => {
        this.releaseHeld?.();
        this.releaseHeld = null;
      },
    };
  }

  override async extract(text: string, targets: readonly AiExtractionTarget[]) {
    const held = this.held;
    this.held = null;
    this.entered?.();
    this.entered = null;
    if (held) await held;
    return super.extract(text, targets);
  }
}

let harness: TestHarness;
let provider: BlockingProvider;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let memberId = "";
let contractTypeId = "";

beforeAll(async () => {
  harness = await startHarness({
    aiDriverFactory: () => {
      provider = new BlockingProvider();
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
  const options = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: memberCookies,
  });
  contractTypeId = (options.json().contractTypes as { id: string; slug: string }[]).find(
    (type) => type.slug === "nda",
  )!.id;
});

afterAll(async () => {
  await harness.stop();
});

async function newContract(title: string) {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: memberCookies,
    payload: { title, contractTypeId },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().contract as { id: string; number: number };
}

const BOUNDARY = "openlaw-automatic-analysis-boundary";

function uploadBody(filename: string, contentType: string, content: Buffer) {
  return {
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
    payload: Buffer.concat([
      Buffer.from(`--${BOUNDARY}\r\ncontent-disposition: form-data; name="kind"\r\n\r\n`),
      Buffer.from("draft_ours"),
      Buffer.from(`\r\n--${BOUNDARY}\r\n`),
      Buffer.from(
        `content-disposition: form-data; name="file"; filename="${filename}"\r\n` +
          `content-type: ${contentType}\r\n\r\n`,
      ),
      content,
      Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
    ]),
  };
}

async function upload(number: number, filename: string, contentType: string, content: Buffer) {
  const body = uploadBody(filename, contentType, content);
  const response = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${String(number)}/documents`,
    cookies: memberCookies,
    ...body,
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().document as {
    id: string;
    versions: { id: string; isCurrent: boolean }[];
  };
}

async function configureConnector() {
  const response = await harness.app.inject({
    method: "PUT",
    url: "/api/v1/ai-connector",
    cookies: adminCookies,
    payload: {
      preset: "custom",
      protocol: "openai_chat_completions",
      baseUrl: "https://automatic-analysis.invalid/v1",
      apiKey: FAKE_VALID_AI_KEY,
      model: "automatic-analysis-model",
    },
  });
  expect(response.statusCode, response.body).toBe(200);
}

async function waitForText(versionId: string) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const [row] = await harness.db
      .select()
      .from(documentVersionText)
      .where(eq(documentVersionText.versionId, versionId));
    if (row?.state === "ready") return row;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`text for ${versionId} did not become ready`);
}

async function waitForRuns(contractId: string, count: number, state?: "pending" | "ready") {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const rows = await harness.db
      .select()
      .from(contractAnalysisRuns)
      .where(eq(contractAnalysisRuns.contractId, contractId));
    if (rows.length === count && (!state || rows.every((row) => row.state === state))) return rows;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Contract ${contractId} did not reach ${String(count)} ${state ?? ""} runs`);
}

async function expectNoRuns(contractId: string) {
  await new Promise((resolve) => setTimeout(resolve, 300));
  const rows = await harness.db
    .select()
    .from(contractAnalysisRuns)
    .where(eq(contractAnalysisRuns.contractId, contractId));
  expect(rows).toEqual([]);
}

function setAnswers(next: Record<string, Answer>) {
  for (const slug of Object.keys(answers)) delete answers[slug];
  Object.assign(answers, next);
}

function storedPaper(contractId: string, texts: string[]) {
  return harness.db.transaction(async (tx) => {
    const [document] = await tx
      .insert(documents)
      .values({ title: "Agreement", contractId, createdBy: memberId })
      .returning();
    const versions = [];
    for (const [index, text] of texts.entries()) {
      const [version] = await tx
        .insert(documentVersions)
        .values({
          documentId: document!.id,
          versionNumber: index + 1,
          fileRef: `local:automatic-${document!.id}-${String(index + 1)}`,
          kind: "draft_ours",
          originalFilename: `agreement-${String(index + 1)}.pdf`,
          mimeType: "application/pdf",
          byteSize: text.length,
          checksumSha256: "0".repeat(64),
          createdBy: memberId,
        })
        .returning();
      await tx.insert(documentVersionText).values({
        versionId: version!.id,
        state: "ready",
        source: "native_layer",
        text,
      });
      versions.push(version!);
    }
    await tx
      .update(contracts)
      .set({ primaryDocumentId: document!.id })
      .where(eq(contracts.id, contractId));
    return { document: document!, versions };
  });
}

async function appendStoredVersion(documentId: string, versionNumber: number, text: string) {
  const [version] = await harness.db
    .insert(documentVersions)
    .values({
      documentId,
      versionNumber,
      fileRef: `local:automatic-${documentId}-${String(versionNumber)}`,
      kind: "draft_ours",
      originalFilename: `agreement-${String(versionNumber)}.pdf`,
      mimeType: "application/pdf",
      byteSize: text.length,
      checksumSha256: String(versionNumber).repeat(64).slice(0, 64),
      createdBy: memberId,
    })
    .returning();
  await harness.db.insert(documentVersionText).values({
    versionId: version!.id,
    state: "ready",
    source: "native_layer",
    text,
  });
  return version!;
}

const quietLog = { info: () => {}, warn: () => {}, error: () => {} };

describe("automatic Contract analysis", () => {
  it("does nothing when text lands without an enabled connector", async () => {
    const contract = await newContract("No connector automatic analysis");
    const bytes = Buffer.from("%PDF-1.7 no connector", "utf8");
    const document = await upload(contract.number, "agreement.pdf", "application/pdf", bytes);
    await waitForText(document.versions[0]!.id);
    await expectNoRuns(contract.id);
    const entries = await harness.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.entityId, contract.id));
    expect(entries.some((entry) => entry.action.startsWith("contract.analysis_"))).toBe(false);
    await configureConnector();
  });

  it("runs when a primary Version's text becomes ready and flags written values", async () => {
    const contract = await newContract("Text ready automatic analysis");
    const bytes = Buffer.from("%PDF-1.7 automatic primary", "utf8");
    const evidence = fakeExtractedText(bytes);
    setAnswers({ effective_date: { value: "2026-09-03", evidence } });
    const document = await upload(contract.number, "agreement.pdf", "application/pdf", bytes);
    const [run] = await waitForRuns(contract.id, 1, "ready");
    expect(run).toMatchObject({
      trigger: "automatic",
      requestedBy: null,
      versionId: document.versions[0]!.id,
    });
    const [record] = await harness.db.select().from(contracts).where(eq(contracts.id, contract.id));
    expect(record).toMatchObject({ effectiveDate: "2026-09-03" });
    expect(record!.aiUnverified?.effective_date).toMatchObject({
      evidence,
      runId: run!.id,
    });
  });

  it("runs when a ready Version receives the executed pin", async () => {
    const contract = await newContract("Executed pin automatic analysis");
    const paper = await storedPaper(contract.id, ["Old ready text", "Pinned ready text"]);
    setAnswers({});
    const response = await harness.app.inject({
      method: "POST",
      url: `/api/v1/documents/${paper.document.id}/executed-version`,
      cookies: memberCookies,
      payload: { versionId: paper.versions[0]!.id },
    });
    expect(response.statusCode, response.body).toBe(200);
    const [run] = await waitForRuns(contract.id, 1, "ready");
    expect(run).toMatchObject({
      trigger: "automatic",
      requestedBy: null,
      versionId: paper.versions[0]!.id,
    });
    expect(provider.extractions.at(-1)?.text).toBe("Old ready text");
  });

  it("ignores ready text on a supporting Document", async () => {
    const contract = await newContract("Supporting Document exclusion");
    const primary = await upload(
      contract.number,
      "primary.png",
      "image/png",
      Buffer.from("not analyzed"),
    );
    expect(primary).toBeDefined();
    const supportingBytes = Buffer.from("%PDF-1.7 supporting", "utf8");
    const supporting = await upload(
      contract.number,
      "supporting.pdf",
      "application/pdf",
      supportingBytes,
    );
    await waitForText(supporting.versions[0]!.id);
    await expectNoRuns(contract.id);
  });

  it("ignores Versions on Matter, Entity, and Knowledge Item Documents", async () => {
    const [matterType] = await harness.db.select({ id: matterTypes.id }).from(matterTypes).limit(1);
    const [matterStatus] = await harness.db
      .select({ id: matterStatuses.id })
      .from(matterStatuses)
      .limit(1);
    const [entityType] = await harness.db.select({ id: entityTypes.id }).from(entityTypes).limit(1);
    const [knowledgeType] = await harness.db
      .select({ id: knowledgeTypes.id })
      .from(knowledgeTypes)
      .limit(1);
    const [matter] = await harness.db
      .insert(matters)
      .values({
        title: "Automatic exclusion Matter",
        matterTypeId: matterType!.id,
        statusId: matterStatus!.id,
        createdBy: memberId,
      })
      .returning();
    const [entity] = await harness.db
      .insert(entities)
      .values({ legalName: "Automatic Exclusion Ltd", entityTypeId: entityType!.id })
      .returning();
    const [knowledge] = await harness.db
      .insert(knowledgeItems)
      .values({
        title: "Automatic exclusion Knowledge",
        knowledgeTypeId: knowledgeType!.id,
        createdBy: memberId,
        updatedBy: memberId,
      })
      .returning();
    const ownerValues = [
      { title: "Matter paper", matterId: matter!.id },
      { title: "Entity paper", entityId: entity!.id },
      { title: "Knowledge paper", knowledgeItemId: knowledge!.id },
    ];
    const before = await harness.db.select().from(contractAnalysisRuns);
    for (const owner of ownerValues) {
      const [document] = await harness.db
        .insert(documents)
        .values({ ...owner, createdBy: memberId })
        .returning();
      const version = await appendStoredVersion(document!.id, 1, `${owner.title} ready text`);
      await requestAutomaticContractAnalysis(
        {
          db: harness.db,
          jobs: harness.pipeline,
          resolveAiProvider: harness.resolveAiProvider,
          log: quietLog,
        },
        version.id,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await harness.db.select().from(contractAnalysisRuns)).toHaveLength(before.length);
  });

  it("collapses three waiting asks and reads the target when the run starts", async () => {
    const contract = await newContract("Waiting singleton target");
    const paper = await storedPaper(contract.id, ["First"]);
    const queued: { contractId: string; runId: string }[] = [];
    const jobs: JobQueue = {
      requestTextExtraction: async () => {},
      requestDisplayConversion: async () => {},
      requestExecutedCopyFetch: async () => {},
      requestNotificationEmail: async () => {},
      requestContractAnalysis: async (contractId, runId) => {
        queued.push({ contractId, runId });
        return true;
      },
    };
    const deps = {
      db: harness.db,
      jobs,
      resolveAiProvider: harness.resolveAiProvider,
      log: quietLog,
    };
    await requestAutomaticContractAnalysis(deps, paper.versions[0]!.id);
    const second = await appendStoredVersion(paper.document.id, 2, "Second");
    await requestAutomaticContractAnalysis(deps, second.id);
    const third = await appendStoredVersion(paper.document.id, 3, "Third");
    await requestAutomaticContractAnalysis(deps, third.id);
    const [run] = await waitForRuns(contract.id, 1, "pending");
    expect(queued).toEqual([{ contractId: contract.id, runId: run!.id }]);
    setAnswers({});
    await handleContractAnalysis(
      {
        db: harness.db,
        resolveAiProvider: harness.resolveAiProvider,
        log: quietLog,
      },
      { runId: run!.id, retryCount: 0, retryLimit: 2 },
    );
    const [finished] = await waitForRuns(contract.id, 1, "ready");
    expect(finished!.versionId).toBe(third.id);
    expect(provider.extractions.at(-1)?.text).toBe("Third");
  });

  it("does not duplicate a target already snapshotted by an active run", async () => {
    const contract = await newContract("Active target already covered");
    const paper = await storedPaper(contract.id, ["Already covered target"]);
    const [active] = await harness.db
      .insert(contractAnalysisRuns)
      .values({
        contractId: contract.id,
        versionId: paper.versions[0]!.id,
        state: "pending",
        trigger: "automatic",
        requestedBy: null,
        preset: "custom",
        model: "automatic-analysis-model",
        startedAt: new Date(),
      })
      .returning();
    let queueAsks = 0;
    await requestAutomaticContractAnalysis(
      {
        db: harness.db,
        jobs: {
          requestTextExtraction: async () => {},
          requestDisplayConversion: async () => {},
          requestExecutedCopyFetch: async () => {},
          requestNotificationEmail: async () => {},
          requestContractAnalysis: async () => {
            queueAsks += 1;
            return true;
          },
        },
        resolveAiProvider: harness.resolveAiProvider,
        log: quietLog,
      },
      paper.versions[0]!.id,
    );
    expect(await waitForRuns(contract.id, 1, "pending")).toEqual([active]);
    expect(queueAsks).toBe(0);
  });

  it("queues one follow-up when text lands during an active run", async () => {
    const contract = await newContract("Active run follow-up");
    const paper = await storedPaper(contract.id, ["First active target"]);
    setAnswers({});
    const hold = provider.holdNext();
    await requestAutomaticContractAnalysis(
      {
        db: harness.db,
        jobs: harness.pipeline,
        resolveAiProvider: harness.resolveAiProvider,
        log: quietLog,
      },
      paper.versions[0]!.id,
    );
    await hold.entered;
    const second = await appendStoredVersion(paper.document.id, 2, "Second active target");
    const deps = {
      db: harness.db,
      jobs: harness.pipeline,
      resolveAiProvider: harness.resolveAiProvider,
      log: quietLog,
    };
    await requestAutomaticContractAnalysis(deps, second.id);
    await requestAutomaticContractAnalysis(deps, second.id);
    expect(await waitForRuns(contract.id, 2)).toHaveLength(2);
    hold.release();
    const runs = await waitForRuns(contract.id, 2, "ready");
    expect(runs.map((run) => run.versionId)).toEqual([paper.versions[0]!.id, second.id]);
  });

  it("keeps the first run's snapshotted Version when a transient attempt retries", async () => {
    const contract = await newContract("Active run retry target");
    const paper = await storedPaper(contract.id, ["First retry target"]);
    const queued: string[] = [];
    const jobs: JobQueue = {
      requestTextExtraction: async () => {},
      requestDisplayConversion: async () => {},
      requestExecutedCopyFetch: async () => {},
      requestNotificationEmail: async () => {},
      requestContractAnalysis: async (_contractId, runId) => {
        queued.push(runId);
        return true;
      },
    };
    const deps = {
      db: harness.db,
      jobs,
      resolveAiProvider: harness.resolveAiProvider,
      log: quietLog,
    };
    await requestAutomaticContractAnalysis(deps, paper.versions[0]!.id);
    const [first] = await waitForRuns(contract.id, 1, "pending");

    provider.outage();
    try {
      await expect(
        handleContractAnalysis(deps, { runId: first!.id, retryCount: 0, retryLimit: 2 }),
      ).rejects.toThrow("unavailable");
    } finally {
      provider.outage(false);
    }

    const secondVersion = await appendStoredVersion(paper.document.id, 2, "Second retry target");
    await requestAutomaticContractAnalysis(deps, secondVersion.id);
    const runs = await waitForRuns(contract.id, 2, "pending");
    const second = runs.find((run) => run.id !== first!.id)!;
    expect(queued).toEqual([first!.id, second.id]);

    const extractionCount = provider.extractions.length;
    await handleContractAnalysis(deps, { runId: first!.id, retryCount: 1, retryLimit: 2 });
    await handleContractAnalysis(deps, { runId: second.id, retryCount: 0, retryLimit: 2 });
    expect(provider.extractions.slice(extractionCount).map((entry) => entry.text)).toEqual([
      "First retry target",
      "Second retry target",
    ]);
  });

  it("does not replay work skipped while the connector is disabled", async () => {
    const disabled = await harness.app.inject({
      method: "POST",
      url: "/api/v1/ai-connector/disable",
      cookies: adminCookies,
    });
    expect(disabled.statusCode, disabled.body).toBe(200);
    const contract = await newContract("Disabled connector automatic analysis");
    const paper = await storedPaper(contract.id, ["Missed while disabled"]);
    await requestAutomaticContractAnalysis(
      {
        db: harness.db,
        jobs: harness.pipeline,
        resolveAiProvider: harness.resolveAiProvider,
        log: quietLog,
      },
      paper.versions[0]!.id,
    );
    await expectNoRuns(contract.id);
    const enabled = await harness.app.inject({
      method: "POST",
      url: "/api/v1/ai-connector/enable",
      cookies: adminCookies,
    });
    expect(enabled.statusCode, enabled.body).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await expectNoRuns(contract.id);
  });

  it("does nothing and writes no analysis entry for ended or archived Contracts", async () => {
    for (const [label, frozen] of [
      ["Ended", { endedAt: new Date() }],
      ["Archived", { archivedAt: new Date() }],
    ] as const) {
      const contract = await newContract(`${label} automatic analysis`);
      const paper = await storedPaper(contract.id, [`${label} target`]);
      await harness.db.update(contracts).set(frozen).where(eq(contracts.id, contract.id));
      await requestAutomaticContractAnalysis(
        {
          db: harness.db,
          jobs: harness.pipeline,
          resolveAiProvider: harness.resolveAiProvider,
          log: quietLog,
        },
        paper.versions[0]!.id,
      );
      await expectNoRuns(contract.id);
      const entries = await harness.db
        .select()
        .from(activityLog)
        .where(eq(activityLog.entityId, contract.id));
      expect(entries.some((entry) => entry.action.startsWith("contract.analysis_"))).toBe(false);
    }
  });
});
