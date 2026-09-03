// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Document comparison at its public seam (M32/2, DOC-003).
 *
 * The successful path uses the real route, Postgres-backed pg-boss queue,
 * production handler, local derived store, fake engine, and real tracked-
 * changes parser. The suite polls only the resource a client polls. Direct
 * handler calls are reserved for retry counters that would otherwise make a
 * test wait through production backoff delays.
 */

import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, documentComparisons, documentVersions, eq, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import { buildApp } from "../../app.js";
import { DocEngineUnavailableError, type DocEngine } from "../../lib/doc-engine/engine.js";
import { BlobNotFoundError } from "../../lib/storage/adapter.js";
import { DOCX_MIME_TYPE, officePackage } from "../../testing/fixtures/office.js";
import { testDeps } from "../../testing/deps.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";
import {
  handleDocumentComparison,
  TEXT_COMPARISON_UNAVAILABLE,
} from "../../pipeline/document-comparison.js";
import type { JobQueue } from "../../pipeline/jobs.js";
import { DOCUMENT_COMPARISON_QUEUE_OPTIONS } from "../../pipeline/pg-boss.js";

const MEMBER = {
  email: "compare-member@example.com",
  displayName: "Morgan Member",
  password: "correct-horse-battery", // NOSONAR — throwaway fixture
} as const;
const CONTRIBUTOR = {
  email: "compare-contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery", // NOSONAR — throwaway fixture
} as const;
const OUTSIDER = {
  email: "compare-outsider@example.com",
  displayName: "Omar Outsider",
  password: "correct-horse-battery", // NOSONAR — throwaway fixture
} as const;
const PORTAL = {
  email: "compare-portal@example.com",
  displayName: "Pat Portal",
  password: "correct-horse-battery", // NOSONAR — throwaway fixture
} as const;

interface VersionRow {
  id: string;
  versionNumber: number;
  kind: string;
  originalFilename: string;
  isCurrent: boolean;
}

interface DocumentRow {
  id: string;
  title: string;
  versions: VersionRow[];
}

interface ComparisonRow {
  id: string;
  documentId: string;
  mode: "word" | "text";
  state: "pending" | "ready" | "failed";
  fromVersion: VersionRow;
  toVersion: VersionRow;
  changeModel: {
    paragraphs: unknown[];
    changes: { kind: string; excerpt: string }[];
  } | null;
  changeCount: number | null;
  failure: string | null;
  exportedVersionId: null;
}

interface ComparisonEnvelope {
  comparison: ComparisonRow;
}

interface DocumentEnvelope {
  document: DocumentRow;
}

interface ProblemEnvelope {
  detail: string;
}

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let outsiderCookies: Record<string, string>;
let portalCookies: Record<string, string>;
const userIds = new Map<string, string>();

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
    [CONTRIBUTOR, "contributor"],
    [OUTSIDER, "legal_team_member"],
    [PORTAL, "business_user"],
  ] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, user.id));
    userIds.set(fixture.email, user.id);
  }
  adminCookies = await signInCookies(harness.app, ADMIN.email, ADMIN.password);
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
  contributorCookies = await signInCookies(harness.app, CONTRIBUTOR.email, CONTRIBUTOR.password);
  outsiderCookies = await signInCookies(harness.app, OUTSIDER.email, OUTSIDER.password);
  portalCookies = await signInCookies(harness.app, PORTAL.email, PORTAL.password);
});

afterAll(async () => {
  await harness.stop();
});

const idOf = (fixture: { email: string }): string => {
  const id = userIds.get(fixture.email);
  expect(id).toBeDefined();
  return id!;
};

async function ndaTypeId(): Promise<string> {
  const response = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: adminCookies,
  });
  expect(response.statusCode, response.body).toBe(200);
  const row = response
    .json<{ contractTypes: { id: string; slug: string }[] }>()
    .contractTypes.find((type) => type.slug === "nda");
  return row!.id;
}

async function newContract(title: string): Promise<{ id: string; number: number }> {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: adminCookies,
    payload: { title, contractTypeId: await ndaTypeId() },
  });
  expect(response.statusCode, response.body).toBe(201);
  const contract = response.json<{ contract: { id: string; number: number } }>().contract;
  for (const [fixture, role] of [
    [MEMBER, "member"],
    [CONTRIBUTOR, "contributor"],
  ] as const) {
    const team = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/team`,
      cookies: adminCookies,
      payload: { userId: idOf(fixture), role },
    });
    expect(team.statusCode, team.body).toBe(201);
  }
  return contract;
}

const BOUNDARY = "openlaw-comparison-test-boundary";

function uploadBody(file: { filename: string; type: string; bytes: Buffer }) {
  return {
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
    payload: Buffer.concat([
      Buffer.from(`--${BOUNDARY}\r\n`),
      Buffer.from('content-disposition: form-data; name="kind"\r\n\r\ndraft_ours\r\n'),
      Buffer.from(`--${BOUNDARY}\r\n`),
      Buffer.from(
        `content-disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
          `content-type: ${file.type}\r\n\r\n`,
      ),
      file.bytes,
      Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
    ]),
  };
}

type App = TestHarness["app"];

async function uploaded(
  contractNumber: number,
  file: { filename: string; type: string; bytes: Buffer },
  app: App = harness.app,
): Promise<DocumentRow> {
  const form = uploadBody(file);
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/contracts/${contractNumber}/documents`,
    cookies: memberCookies,
    ...form,
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<DocumentEnvelope>().document;
}

async function appended(
  documentId: string,
  file: { filename: string; type: string; bytes: Buffer },
  app: App = harness.app,
): Promise<DocumentRow> {
  const form = uploadBody(file);
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/documents/${documentId}/versions`,
    cookies: memberCookies,
    ...form,
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<DocumentEnvelope>().document;
}

async function twoRounds(
  title: string,
  first = { filename: "first.docx", type: DOCX_MIME_TYPE, bytes: officePackage("first") },
  second = { filename: "second.docx", type: DOCX_MIME_TYPE, bytes: officePackage("second") },
) {
  const contract = await newContract(title);
  const firstDocument = await uploaded(contract.number, first);
  const document = await appended(firstDocument.id, second);
  return { contract, document, from: document.versions[0]!, to: document.versions[1]! };
}

function requestComparison(
  cookies: Record<string, string>,
  documentId: string,
  fromVersionId: string,
  toVersionId: string,
  app: App = harness.app,
) {
  return app.inject({
    method: "POST",
    url: `/api/v1/documents/${documentId}/comparisons`,
    cookies,
    payload: { fromVersionId, toVersionId },
  });
}

function readComparison(cookies: Record<string, string>, documentId: string, comparisonId: string) {
  return harness.app.inject({
    method: "GET",
    url: `/api/v1/documents/${documentId}/comparisons/${comparisonId}`,
    cookies,
  });
}

async function settled(documentId: string, comparisonId: string): Promise<ComparisonRow> {
  const deadline = Date.now() + 20_000;
  let last: ComparisonRow | undefined;
  while (Date.now() < deadline) {
    const response = await readComparison(memberCookies, documentId, comparisonId);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, max-age=0, must-revalidate");
    last = response.json<ComparisonEnvelope>().comparison;
    if (last.state !== "pending") return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `comparison did not settle: ${JSON.stringify(last)}\n${JSON.stringify(harness.jobLog)}`,
  );
}

async function isStored(fileRef: string): Promise<boolean> {
  try {
    (await harness.storage.get(fileRef)).destroy();
    return true;
  } catch (error) {
    if (error instanceof BlobNotFoundError) return false;
    throw error;
  }
}

describe("a Word comparison", () => {
  it("runs through the pipeline once and keeps the parsed model and redline", async () => {
    const { document, from, to } = await twoRounds("Comparison · ready");
    const requested = await requestComparison(contributorCookies, document.id, from.id, to.id);
    expect(requested.statusCode, requested.body).toBe(202);
    const pending = requested.json<ComparisonEnvelope>().comparison;
    expect(pending).toMatchObject({
      documentId: document.id,
      mode: "word",
      state: "pending",
      exportedVersionId: null,
    });
    expect(pending.fromVersion.id).toBe(from.id);
    expect(pending.toVersion.id).toBe(to.id);

    const ready = await settled(document.id, pending.id);
    expect(ready.state).toBe("ready");
    expect(ready.changeCount).toBe(1);
    expect(ready.changeModel?.changes).toEqual([
      expect.objectContaining({ kind: "replaced", excerpt: "thirty days → sixty days" }),
    ]);
    expect(ready.failure).toBeNull();

    const [stored] = await harness.db
      .select({ fileRef: documentComparisons.redlineFileRef })
      .from(documentComparisons)
      .where(eq(documentComparisons.id, ready.id));
    expect(stored?.fileRef).toContain(`comparisons/${ready.id}/`);
    expect(await isStored(stored!.fileRef!)).toBe(true);

    const repeated = await requestComparison(memberCookies, document.id, from.id, to.id);
    expect(repeated.statusCode, repeated.body).toBe(200);
    expect(repeated.json<ComparisonEnvelope>().comparison.id).toBe(ready.id);
  });

  it("answers every invalid pair as an ordinary problem", async () => {
    const first = await twoRounds("Comparison · pair one");
    const second = await twoRounds("Comparison · pair two");
    const cases = [
      [first.from.id, first.from.id],
      [first.to.id, first.from.id],
      [first.from.id, second.to.id],
    ];
    for (const [fromVersionId, toVersionId] of cases) {
      const response = await requestComparison(
        memberCookies,
        first.document.id,
        fromVersionId!,
        toVersionId!,
      );
      expect(response.statusCode, response.body).toBe(400);
      expect(response.headers["content-type"]).toContain("application/problem+json");
    }

    await harness.db
      .update(documentVersions)
      .set({ kind: "generated_redline" })
      .where(eq(documentVersions.id, first.to.id));
    const generated = await requestComparison(
      memberCookies,
      first.document.id,
      first.from.id,
      first.to.id,
    );
    expect(generated.statusCode, generated.body).toBe(400);
    expect(generated.json<ProblemEnvelope>().detail).toMatch(/generated redline/i);
  });

  it("does not queue an existing pending pair again", async () => {
    const asks: string[] = [];
    const jobs: JobQueue = {
      requestTextExtraction: async () => {},
      requestDisplayConversion: async () => {},
      requestDocumentComparison: async (comparisonId) => {
        asks.push(comparisonId);
      },
      requestExecutedCopyFetch: async () => {},
      requestNotificationEmail: async () => {},
      requestContractAnalysis: async () => false,
    };
    const detached = await buildApp(
      testDeps({
        db: harness.db,
        storage: harness.storage,
        docEngine: harness.docEngine,
        jobs,
      }),
    );
    await detached.ready();
    try {
      const contract = await newContract("Comparison · pending singleton");
      const first = await uploaded(
        contract.number,
        { filename: "one.docx", type: DOCX_MIME_TYPE, bytes: officePackage("one") },
        detached,
      );
      const document = await appended(
        first.id,
        { filename: "two.docx", type: DOCX_MIME_TYPE, bytes: officePackage("two") },
        detached,
      );
      const [from, to] = document.versions;
      const created = await requestComparison(
        memberCookies,
        document.id,
        from!.id,
        to!.id,
        detached,
      );
      expect(created.statusCode, created.body).toBe(202);
      const repeated = await requestComparison(
        memberCookies,
        document.id,
        from!.id,
        to!.id,
        detached,
      );
      expect(repeated.statusCode, repeated.body).toBe(200);
      expect(repeated.json<ComparisonEnvelope>().comparison.id).toBe(
        created.json<ComparisonEnvelope>().comparison.id,
      );
      expect(asks).toEqual([created.json<ComparisonEnvelope>().comparison.id]);
    } finally {
      await detached.close();
    }
  });
});

describe("comparison failures", () => {
  it("settles an unreadable operand and the not-yet-available text mode", async () => {
    const unreadable = await twoRounds("Comparison · unreadable", {
      filename: "bad.docx",
      type: DOCX_MIME_TYPE,
      bytes: Buffer.from("not a package"),
    });
    const requested = await requestComparison(
      memberCookies,
      unreadable.document.id,
      unreadable.from.id,
      unreadable.to.id,
    );
    const failed = await settled(
      unreadable.document.id,
      requested.json<ComparisonEnvelope>().comparison.id,
    );
    expect(failed.state).toBe("failed");
    expect(failed.failure).toMatch(/readable|package|zip/i);
    expect(failed.changeModel).toBeNull();

    const text = await twoRounds(
      "Comparison · text",
      { filename: "first.pdf", type: "application/pdf", bytes: Buffer.from("%PDF-1.7 first") },
      { filename: "second.pdf", type: "application/pdf", bytes: Buffer.from("%PDF-1.7 second") },
    );
    const textRequest = await requestComparison(
      memberCookies,
      text.document.id,
      text.from.id,
      text.to.id,
    );
    expect(textRequest.json<ComparisonEnvelope>().comparison.mode).toBe("text");
    const textFailed = await settled(
      text.document.id,
      textRequest.json<ComparisonEnvelope>().comparison.id,
    );
    expect(textFailed).toMatchObject({
      mode: "text",
      state: "failed",
      failure: TEXT_COMPARISON_UNAVAILABLE,
    });
  });

  it("retries an unreachable engine and fails only after the configured attempt bound", async () => {
    const { document, from, to } = await twoRounds("Comparison · retries");
    const comparisonId = "0198f2ab-0000-7000-8000-00000000c001";
    await harness.db.insert(documentComparisons).values({
      id: comparisonId,
      documentId: document.id,
      fromVersionId: from.id,
      toVersionId: to.id,
      mode: "word",
      state: "pending",
      requestedBy: idOf(MEMBER),
    });
    let calls = 0;
    const unavailable: DocEngine = {
      ...harness.docEngine,
      compare: async (): Promise<Readable> => {
        calls += 1;
        throw new DocEngineUnavailableError("The comparison engine is unreachable.");
      },
    };
    const deps = {
      db: harness.db,
      storage: harness.storage,
      docEngine: unavailable,
      log: harness.app.log,
    };
    const retryLimit = DOCUMENT_COMPARISON_QUEUE_OPTIONS.retryLimit;
    for (let retryCount = 0; retryCount < retryLimit; retryCount += 1) {
      await expect(
        handleDocumentComparison(deps, { comparisonId, retryCount, retryLimit }),
      ).rejects.toThrow(/unreachable/);
      const [row] = await harness.db
        .select({ state: documentComparisons.state })
        .from(documentComparisons)
        .where(eq(documentComparisons.id, comparisonId));
      expect(row?.state).toBe("pending");
    }
    await expect(
      handleDocumentComparison(deps, { comparisonId, retryCount: retryLimit, retryLimit }),
    ).rejects.toThrow(/unreachable/);
    const [failed] = await harness.db
      .select({ state: documentComparisons.state, failure: documentComparisons.failure })
      .from(documentComparisons)
      .where(eq(documentComparisons.id, comparisonId));
    expect(calls).toBe(retryLimit + 1);
    expect(failed).toEqual({
      state: "failed",
      failure: "DocEngineUnavailableError: The comparison engine is unreachable.",
    });
  });
});

describe("comparison access and lifecycle", () => {
  it("inherits the Document audience and refuses a portal reader on both routes", async () => {
    const { document, from, to } = await twoRounds("Comparison · audience");
    const created = await requestComparison(memberCookies, document.id, from.id, to.id);
    const comparison = await settled(document.id, created.json<ComparisonEnvelope>().comparison.id);
    const confidential = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/documents/${document.id}`,
      cookies: adminCookies,
      payload: { isConfidential: true },
    });
    expect(confidential.statusCode, confidential.body).toBe(200);

    const deniedRead = await readComparison(outsiderCookies, document.id, comparison.id);
    const deniedRequest = await requestComparison(outsiderCookies, document.id, from.id, to.id);
    const ownRead = await harness.app.inject({
      method: "GET",
      url: `/api/v1/documents/${document.id}/versions/${from.id}/download`,
      cookies: outsiderCookies,
    });
    for (const response of [deniedRead, deniedRequest, ownRead]) {
      expect(response.statusCode, response.body).toBe(404);
      expect(response.json<ProblemEnvelope>().detail).toBe(ownRead.json<ProblemEnvelope>().detail);
    }

    expect((await readComparison(portalCookies, document.id, comparison.id)).statusCode).toBe(403);
    expect((await requestComparison(portalCookies, document.id, from.id, to.id)).statusCode).toBe(
      403,
    );
  });

  it("accepts an archived Document and hard delete takes both row and blob", async () => {
    const { document, from, to } = await twoRounds("Comparison · archived and erased");
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/documents/${document.id}/archive`,
      cookies: memberCookies,
    });
    expect(archived.statusCode, archived.body).toBe(200);
    const requested = await requestComparison(memberCookies, document.id, from.id, to.id);
    expect(requested.statusCode, requested.body).toBe(202);
    const ready = await settled(document.id, requested.json<ComparisonEnvelope>().comparison.id);
    expect(ready.state).toBe("ready");
    const [before] = await harness.db
      .select({ fileRef: documentComparisons.redlineFileRef })
      .from(documentComparisons)
      .where(eq(documentComparisons.id, ready.id));
    expect(await isStored(before!.fileRef!)).toBe(true);

    const erased = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/documents/${document.id}`,
      cookies: adminCookies,
      payload: { confirmTitle: document.title },
    });
    expect(erased.statusCode, erased.body).toBe(200);
    const remaining = await harness.db
      .select({ id: documentComparisons.id })
      .from(documentComparisons)
      .where(
        and(eq(documentComparisons.documentId, document.id), eq(documentComparisons.id, ready.id)),
      );
    expect(remaining).toEqual([]);
    expect(await isStored(before!.fileRef!)).toBe(false);
  });
});
