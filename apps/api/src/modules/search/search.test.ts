// SPDX-License-Identifier: AGPL-3.0-only

/** The M25 search contract at the HTTP seam, against real Postgres. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  contractCounterparties,
  contracts,
  contractStatuses,
  contractTypes,
  counterparties,
  documents,
  documentVersions,
  documentVersionText,
  entities,
  entityTypes,
  eq,
  matters,
  matterStatuses,
  matterTypes,
  requests,
  requestTypes,
  users,
} from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  fakeConversionText,
  fakeExtractedText,
  fakeImageOnlyPdf,
  fakeOcrText,
} from "../../lib/doc-engine/fake.js";
import { emlFixture } from "../../testing/fixtures/email.js";
import { DOCX_MIME_TYPE, officePackage } from "../../testing/fixtures/office.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "search-member@example.com",
  displayName: "Morgan Search Manager",
  password: "correct-horse-battery",
} as const;

interface SearchRow {
  kind: "contract" | "matter" | "document" | "entity" | "counterparty" | "request";
  id: string;
  number: number | null;
  title: string;
  isConfidential: boolean;
  rank: number;
  ownerKind?: "contract" | "matter";
  ownerNumber?: number;
  versionId?: string;
  versionNumber?: number;
  snippet?: string;
}

interface SearchAnswer {
  results: SearchRow[];
  nextCursor: string | null;
}

let harness: TestHarness;
let cookies: Record<string, string>;
let adminId = "";
let memberId = "";
let contractId = "";
let contractNumber = 0;
let matterId = "";
let matterNumber = 0;
let entityId = "";
let counterpartyId = "";
let requestId = "";
let requestNumber = 0;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);

  const member = await provisionUser(harness.app.auth, MEMBER);
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, member.id));
  memberId = member.id;
  adminId = (
    await harness.db.select({ id: users.id }).from(users).where(eq(users.email, ADMIN.email))
  )[0]!.id;
  cookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);

  const [contractType] = await harness.db
    .insert(contractTypes)
    .values({
      slug: "search-flatneedle-contract",
      displayName: "Flatneedle Falcon Contract Type",
      displayOrder: 900,
    })
    .returning();
  const [contractStatus] = await harness.db
    .insert(contractStatuses)
    .values({
      slug: "search-ended",
      displayName: "Sunset Property",
      stage: "ended",
      displayOrder: 900,
    })
    .returning();
  const [matterType] = await harness.db
    .insert(matterTypes)
    .values({
      slug: "search-regulatory-cedar",
      displayName: "Regulatory Cedar Property",
      displayOrder: 900,
    })
    .returning();
  const [matterStatus] = await harness.db
    .insert(matterStatuses)
    .values({
      slug: "search-closed",
      displayName: "Closed Property",
      category: "closed",
      displayOrder: 900,
    })
    .returning();
  const [entityType] = await harness.db
    .insert(entityTypes)
    .values({
      slug: "search-holding-orchid",
      displayName: "Holding Orchid Property",
      displayOrder: 900,
    })
    .returning();
  const [requestType] = await harness.db
    .insert(requestTypes)
    .values({
      slug: "search-privacy-maple",
      displayName: "Privacy Maple Property",
      displayOrder: 900,
    })
    .returning();

  const [contract] = await harness.db
    .insert(contracts)
    .values({
      title: "Aurora Licensing Contract",
      description: "Crossmodule warranty clause was carefully terminated",
      contractTypeId: contractType!.id,
      statusId: contractStatus!.id,
      endedAt: new Date(),
    })
    .returning({ id: contracts.id, number: contracts.number });
  contractId = contract!.id;
  contractNumber = contract!.number;

  const [matter] = await harness.db
    .insert(matters)
    .values({
      title: "Flatneedle Nimbus Matter",
      description: "Crossmodule investigation description",
      matterTypeId: matterType!.id,
      statusId: matterStatus!.id,
      managerId: memberId,
      createdBy: adminId,
      closedAt: new Date(),
    })
    .returning({ id: matters.id, number: matters.number });
  matterId = matter!.id;
  matterNumber = matter!.number;

  const [entity] = await harness.db
    .insert(entities)
    .values({
      legalName: "Quasar Holdings Ltd",
      entityTypeId: entityType!.id,
      jurisdiction: "Crossmodule Cayman Islands",
      registrationNumber: "REG-ORBIT-778",
      status: "dormant",
    })
    .returning({ id: entities.id });
  entityId = entity!.id;

  const [counterparty] = await harness.db
    .insert(counterparties)
    .values({
      name: "Crossmodule Zephyr Context GmbH",
      jurisdiction: "Luxembourg Juniper Property",
    })
    .returning({ id: counterparties.id });
  counterpartyId = counterparty!.id;
  await harness.db.insert(contractCounterparties).values({
    contractId,
    counterpartyId,
    isPrimary: true,
  });

  const [request] = await harness.db
    .insert(requests)
    .values({
      requestTypeId: requestType!.id,
      requesterId: memberId,
      summary: "Harbor Privacy Request",
      description: "Crossmodule intake description",
      urgency: "medium",
    })
    .returning({ id: requests.id, number: requests.number });
  requestId = request!.id;
  requestNumber = request!.number;

  await seedArchivedRows({
    contractTypeId: contractType!.id,
    contractStatusId: contractStatus!.id,
    matterTypeId: matterType!.id,
    matterStatusId: matterStatus!.id,
    entityTypeId: entityType!.id,
    requestTypeId: requestType!.id,
  });
  await harness.db
    .insert(counterparties)
    .values([
      { name: "Pageword Alpha" },
      { name: "Pageword Beta" },
      { name: "Pageword Gamma" },
      { name: String(contractNumber) },
    ]);
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

async function seedArchivedRows(ids: {
  contractTypeId: string;
  contractStatusId: string;
  matterTypeId: string;
  matterStatusId: string;
  entityTypeId: string;
  requestTypeId: string;
}) {
  const archivedAt = new Date();
  await harness.db.insert(contracts).values({
    title: "Archivedneedle Contract",
    contractTypeId: ids.contractTypeId,
    statusId: ids.contractStatusId,
    archivedAt,
  });
  await harness.db.insert(matters).values({
    title: "Archivedneedle Matter",
    matterTypeId: ids.matterTypeId,
    statusId: ids.matterStatusId,
    createdBy: adminId,
    archivedAt,
  });
  await harness.db.insert(entities).values({
    legalName: "Archivedneedle Entity",
    entityTypeId: ids.entityTypeId,
    archivedAt,
  });
  await harness.db.insert(counterparties).values({
    name: "Archivedneedle Counterparty",
    archivedAt,
  });
  await harness.db.insert(requests).values({
    requestTypeId: ids.requestTypeId,
    requesterId: memberId,
    summary: "Archivedneedle Request",
    urgency: "low",
    archivedAt,
  });
}

async function search(query: string): Promise<SearchAnswer> {
  const response = await harness.app.inject({
    method: "GET",
    url: `/api/v1/search?${query}`,
    cookies,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as SearchAnswer;
}

async function oneKind(q: string, kind: SearchRow["kind"]): Promise<SearchRow[]> {
  return (await search(`q=${encodeURIComponent(q)}&kind=${kind}`)).results;
}

const UPLOAD_BOUNDARY = "openlaw-search-document-boundary";

function uploadBody(file: { filename: string; contentType: string; content: Buffer }) {
  return {
    payload: Buffer.concat([
      Buffer.from(`--${UPLOAD_BOUNDARY}\r\n`),
      Buffer.from('content-disposition: form-data; name="kind"\r\n\r\ndraft_ours\r\n'),
      Buffer.from(`--${UPLOAD_BOUNDARY}\r\n`),
      Buffer.from(
        `content-disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
          `content-type: ${file.contentType}\r\n\r\n`,
      ),
      file.content,
      Buffer.from("\r\n"),
      Buffer.from(`--${UPLOAD_BOUNDARY}--\r\n`),
    ]),
    headers: { "content-type": `multipart/form-data; boundary=${UPLOAD_BOUNDARY}` },
  };
}

interface SearchDocument {
  id: string;
  title: string;
  versions: { id: string; versionNumber: number; isCurrent: boolean }[];
}

async function uploadDocument(file: {
  filename: string;
  contentType: string;
  content: Buffer;
}): Promise<SearchDocument> {
  const body = uploadBody(file);
  const response = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${contractNumber}/documents`,
    cookies,
    ...body,
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().document as SearchDocument;
}

async function appendVersion(
  documentId: string,
  file: { filename: string; contentType: string; content: Buffer },
): Promise<SearchDocument> {
  const body = uploadBody(file);
  const response = await harness.app.inject({
    method: "POST",
    url: `/api/v1/documents/${documentId}/versions`,
    cookies,
    ...body,
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().document as SearchDocument;
}

async function settledText(documentId: string, versionId: string) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const response = await harness.app.inject({
      method: "GET",
      url: `/api/v1/documents/${documentId}/versions/${versionId}/text`,
      cookies,
    });
    expect(response.statusCode, response.body).toBe(200);
    const row = response.json().text as { state: string; source: string | null };
    if (row.state !== "pending") return row;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`the text for ${versionId} did not settle`);
}

const currentVersion = (document: SearchDocument) =>
  document.versions.find((version) => version.isCurrent)!;

describe("GET /search across the indexed records", () => {
  it("matches each kind by its own title", async () => {
    for (const [query, kind, id] of [
      ["aurora", "contract", contractId],
      ["nimbus", "matter", matterId],
      ["quasar", "entity", entityId],
      ["zephyr", "counterparty", counterpartyId],
      ["harbor", "request", requestId],
    ] as const) {
      expect((await oneKind(query, kind)).map((row) => row.id)).toContain(id);
    }
  });

  it("matches descriptions and standard properties for every applicable kind", async () => {
    for (const [query, kind, id] of [
      ["warranty", "contract", contractId],
      ["investigation", "matter", matterId],
      ["intake", "request", requestId],
      ["falcon", "contract", contractId],
      ["cedar", "matter", matterId],
      ["orbit", "entity", entityId],
      ["juniper", "counterparty", counterpartyId],
      ["maple", "request", requestId],
    ] as const) {
      expect((await oneKind(query, kind)).map((row) => row.id)).toContain(id);
    }
  });

  it("joins Contract Counterparty names and the Matter Manager at query time", async () => {
    expect((await oneKind("zephyr", "contract")).map((row) => row.id)).toEqual([contractId]);
    expect((await oneKind("morgan", "matter")).map((row) => row.id)).toEqual([matterId]);
  });

  it("joins the Entity type, Request type, and Requester properties at query time", async () => {
    expect((await oneKind("orchid", "entity")).map((row) => row.id)).toEqual([entityId]);
    expect((await oneKind("maple", "request")).map((row) => row.id)).toEqual([requestId]);
    expect((await oneKind("morgan", "request")).map((row) => row.id)).toEqual([requestId]);
  });

  it("matches exact prefixed numbers and bare numbers above text hits", async () => {
    expect((await oneKind(`C-${contractNumber}`, "contract"))[0]).toMatchObject({
      id: contractId,
      number: contractNumber,
      rank: 1000,
    });
    expect((await oneKind(`M-${matterNumber}`, "matter"))[0]).toMatchObject({
      id: matterId,
      number: matterNumber,
      rank: 1000,
    });
    expect((await oneKind(`R-${requestNumber}`, "request"))[0]).toMatchObject({
      id: requestId,
      number: requestNumber,
      rank: 1000,
    });

    // The three kinds share the same first value only because each
    // sequence starts fresh in this database: contract, matter, and
    // request numbers all read the same digits here.
    const bare = await search(`q=${contractNumber}`);
    const exact = bare.results.filter((row) => row.rank === 1000);
    expect(new Set(exact.map((row) => row.kind))).toEqual(
      new Set(["contract", "matter", "request"]),
    );
    expect(bare.results.find((row) => row.kind === "counterparty")!.rank).toBeLessThan(1000);
  });

  it("uses English stemming, all-word, phrase, and exclusion parsing", async () => {
    expect((await oneKind("termination", "contract")).map((row) => row.id)).toEqual([contractId]);
    expect((await oneKind("aurora clause", "contract")).map((row) => row.id)).toEqual([contractId]);
    expect(await oneKind("aurora missingword", "contract")).toEqual([]);
    expect((await oneKind('"warranty clause"', "contract")).map((row) => row.id)).toEqual([
      contractId,
    ]);
    expect(await oneKind('"clause warranty"', "contract")).toEqual([]);
    expect(await oneKind("aurora -clause", "contract")).toEqual([]);
    expect((await oneKind("aurora -missingword", "contract")).map((row) => row.id)).toEqual([
      contractId,
    ]);
  });

  it("returns an empty answer for punctuation and stop-word-only queries", async () => {
    for (const query of ["...!!!", "the and or"]) {
      expect(await search(`q=${encodeURIComponent(query)}`)).toEqual({
        results: [],
        nextCursor: null,
      });
    }
  });

  it("trims q, requires a non-empty value, and clearly refuses more than 200 characters", async () => {
    expect((await search("q=%20%20aurora%20%20")).results[0]?.id).toBe(contractId);
    expect((await search(`q=${"x".repeat(200)}`)).results).toEqual([]);

    for (const q of ["%20%20%20", "x".repeat(201)]) {
      const response = await harness.app.inject({
        method: "GET",
        url: `/api/v1/search?q=${q}`,
        cookies,
      });
      expect(response.statusCode, response.body).toBe(400);
      if (q.length > 200) {
        expect(response.json().errors).toContainEqual({
          path: "q",
          message: "Search queries must be 200 characters or fewer.",
        });
      }
    }
  });
});

describe("search ordering and bounds", () => {
  it("groups the header answer by the fixed kind order", async () => {
    const answer = await search("q=crossmodule");
    expect(answer.results.map((row) => row.kind)).toEqual([
      "contract",
      "matter",
      "entity",
      "counterparty",
      "request",
    ]);
    expect(answer.nextCursor).toBeNull();
  });

  it("uses a supplied limit for the flat results-page order", async () => {
    const answer = await search("q=flatneedle&limit=25");
    expect(answer.results.map((row) => row.id)).toEqual([matterId, contractId]);
    expect(answer.results[0]!.rank).toBeGreaterThan(answer.results[1]!.rank);
  });

  it("pages the flat answer by rank and id without gaps or repeats", async () => {
    const first = await search("q=pageword&kind=counterparty&limit=2");
    expect(first.results).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await search(
      `q=pageword&kind=counterparty&limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`,
    );
    expect(second.results).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.results, ...second.results].map((row) => row.id)).size).toBe(3);
  });

  it("excludes archived rows but includes ended Contracts and closed Matters", async () => {
    expect((await search("q=archivedneedle")).results).toEqual([]);
    expect((await oneKind("aurora", "contract")).map((row) => row.id)).toContain(contractId);
    expect((await oneKind("nimbus", "matter")).map((row) => row.id)).toContain(matterId);
  });
});

describe("Document search", () => {
  it("finds text produced by every extraction source and reports the owning Contract", async () => {
    const nativeBytes = Buffer.from("%PDF-1.7\nsearch native fixture");
    const scanBytes = fakeImageOnlyPdf("search OCR fixture");
    const wordBytes = officePackage("search rendition fixture");
    const emailBody = "emailbodyneedle appears only in this message body";
    const cases = [
      {
        file: { filename: "native.pdf", contentType: "application/pdf", content: nativeBytes },
        source: "native_layer",
        query: fakeExtractedText(nativeBytes).split(" ").at(-1)!,
      },
      {
        file: { filename: "scan.pdf", contentType: "application/pdf", content: scanBytes },
        source: "ocr",
        query: fakeOcrText(scanBytes).split(" ").at(-1)!,
      },
      {
        file: { filename: "draft.docx", contentType: DOCX_MIME_TYPE, content: wordBytes },
        source: "rendition",
        query: fakeConversionText("docx", wordBytes).split(" ").at(-1)!,
      },
      {
        file: {
          filename: "thread.eml",
          contentType: "message/rfc822",
          content: emlFixture({ subject: "Recognisable email subject", text: emailBody }),
        },
        source: "email_body",
        query: "emailbodyneedle",
      },
    ] as const;

    for (const testCase of cases) {
      const document = await uploadDocument(testCase.file);
      const version = currentVersion(document);
      expect(await settledText(document.id, version.id)).toMatchObject({
        state: "ready",
        source: testCase.source,
      });

      const [row] = await oneKind(testCase.query, "document");
      expect(row).toMatchObject({
        kind: "document",
        id: document.id,
        ownerKind: "contract",
        ownerNumber: contractNumber,
        versionId: version.id,
        versionNumber: version.versionNumber,
      });
      expect(row!.snippet).toContain("<mark>");
      if (testCase.source === "email_body") expect(row!.title).toBe("Recognisable email subject");
    }
  });

  it("reports a Matter as the owning record", async () => {
    const [document] = await harness.db
      .insert(documents)
      .values({
        matterId,
        createdBy: memberId,
        title: "Matterowningneedle Exhibit",
      })
      .returning({ id: documents.id });
    const [version] = await harness.db
      .insert(documentVersions)
      .values({
        documentId: document!.id,
        versionNumber: 1,
        fileRef: "local:search/matter-owner",
        kind: "draft_ours",
        originalFilename: "matter-exhibit.pdf",
        mimeType: "application/pdf",
        byteSize: 1,
        checksumSha256: "a".repeat(64),
        createdBy: memberId,
      })
      .returning({ id: documentVersions.id });

    expect(await oneKind("matterowningneedle", "document")).toEqual([
      expect.objectContaining({
        id: document!.id,
        ownerKind: "matter",
        ownerNumber: matterNumber,
        versionId: version!.id,
        versionNumber: 1,
      }),
    ]);
  });

  it("matches title, filename, and description while text is unavailable", async () => {
    const states = ["pending", "failed", "unsupported"] as const;
    for (const [index, state] of states.entries()) {
      const [document] = await harness.db
        .insert(documents)
        .values({
          contractId,
          createdBy: memberId,
          title: `${state}titleneedle Document`,
          description: index === 0 ? "pendingdescriptionneedle" : null,
        })
        .returning({ id: documents.id });
      const [version] = await harness.db
        .insert(documentVersions)
        .values({
          documentId: document!.id,
          versionNumber: 1,
          fileRef: `local:search/${state}`,
          kind: "draft_ours",
          originalFilename: `${state}filenameneedle.bin`,
          mimeType: "application/octet-stream",
          byteSize: 1,
          checksumSha256: String(index + 1).repeat(64),
          createdBy: memberId,
        })
        .returning({ id: documentVersions.id });
      if (state !== "unsupported") {
        await harness.db.insert(documentVersionText).values({
          versionId: version!.id,
          state,
        });
      }

      for (const query of [`${state}titleneedle`, `${state}filenameneedle`]) {
        expect((await oneKind(query, "document"))[0], query).toMatchObject({ id: document!.id });
      }
    }
    expect((await oneKind("pendingdescriptionneedle", "document"))[0]?.title).toBe(
      "pendingtitleneedle Document",
    );
  });

  it("rolls version hits up to one Document, preferring the latest matching version", async () => {
    const firstBytes = Buffer.from("%PDF-1.7\nfirst search version");
    const secondBytes = Buffer.from("%PDF-1.7\nsecond search version");
    const first = await uploadDocument({
      filename: "round-one.pdf",
      contentType: "application/pdf",
      content: firstBytes,
    });
    const firstVersion = currentVersion(first);
    expect((await settledText(first.id, firstVersion.id)).state).toBe("ready");
    const second = await appendVersion(first.id, {
      filename: "round-two.pdf",
      contentType: "application/pdf",
      content: secondBytes,
    });
    const secondVersion = currentVersion(second);
    expect((await settledText(second.id, secondVersion.id)).state).toBe("ready");

    await harness.db
      .update(documentVersionText)
      .set({ text: "sharedversionneedle oldversiononlyneedle" })
      .where(eq(documentVersionText.versionId, firstVersion.id));
    await harness.db
      .update(documentVersionText)
      .set({ text: "sharedversionneedle latest words" })
      .where(eq(documentVersionText.versionId, secondVersion.id));

    expect(await oneKind("sharedversionneedle", "document")).toEqual([
      expect.objectContaining({
        id: first.id,
        versionId: secondVersion.id,
        versionNumber: 2,
      }),
    ]);
    expect(await oneKind("oldversiononlyneedle", "document")).toEqual([
      expect.objectContaining({
        id: first.id,
        versionId: firstVersion.id,
        versionNumber: 1,
      }),
    ]);
  });
});
