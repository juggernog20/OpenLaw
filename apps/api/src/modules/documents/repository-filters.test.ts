// SPDX-License-Identifier: AGPL-3.0-only

/** M26/3's fixed repository filters and reproducible sorted cursors. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  counterparties,
  contracts,
  contractCounterparties,
  contractStatuses,
  contractTypes,
  documentFolders,
  documents,
  documentVersions,
  documentVersionText,
  eq,
  matters,
  matterStatuses,
  matterTypes,
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
  email: "repository-filter-member@example.com",
  displayName: "Alex Filter",
  password: "correct-horse-battery",
} as const;

const OTHER_UPLOADER = {
  email: "repository-other-uploader@example.com",
  displayName: "Blair Uploader",
  password: "correct-horse-battery",
} as const;

interface Row {
  id: string;
  title: string;
  owner: { kind: "contract" | "matter"; number: number; title: string };
  folder: { id: string; name: string } | null;
  currentVersion: {
    kind: string;
    originalFilename: string;
    mimeType: string;
    byteSize: number;
    uploadedBy: { displayName: string };
    createdAt: string;
  };
}

interface Answer {
  documents: Row[];
  nextCursor: string | null;
}

let harness: TestHarness;
let cookies: Record<string, string>;
let memberId = "";
let otherUploaderId = "";
let contractA = { id: "", number: 0 };
let contractB = { id: "", number: 0 };
let matterA = { id: "", number: 0 };
let contractFolderId = "";
let matterFolderId = "";
let counterpartyAId = "";
let counterpartyBId = "";
const ids = new Map<string, string>();
const tieTitles = ["Tie on A", "Tie on B", "Tie on C", "Tie on D"];

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  const member = await provisionUser(harness.app.auth, MEMBER);
  memberId = member.id;
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, member.id));
  const otherUploader = await provisionUser(harness.app.auth, OTHER_UPLOADER);
  otherUploaderId = otherUploader.id;
  await harness.db
    .update(users)
    .set({ role: "legal_team_member" })
    .where(eq(users.id, otherUploader.id));
  cookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
  const adminId = (
    await harness.db.select({ id: users.id }).from(users).where(eq(users.email, ADMIN.email))
  )[0]!.id;

  const contractTypeId = (await harness.db.select({ id: contractTypes.id }).from(contractTypes))[0]!
    .id;
  const contractStatusId = (
    await harness.db.select({ id: contractStatuses.id }).from(contractStatuses)
  )[0]!.id;
  const matterTypeId = (await harness.db.select({ id: matterTypes.id }).from(matterTypes))[0]!.id;
  const matterStatusId = (
    await harness.db.select({ id: matterStatuses.id }).from(matterStatuses)
  )[0]!.id;

  const insertedContracts = await harness.db
    .insert(contracts)
    .values([
      { title: "Alpha owner", contractTypeId, statusId: contractStatusId },
      { title: "Beta owner", contractTypeId, statusId: contractStatusId },
      { title: "Archived document owner", contractTypeId, statusId: contractStatusId },
      {
        title: "Archived owner",
        contractTypeId,
        statusId: contractStatusId,
        archivedAt: new Date("2026-08-01T00:00:00.000Z"),
      },
    ])
    .returning({ id: contracts.id, number: contracts.number });
  contractA = insertedContracts[0]!;
  contractB = insertedContracts[1]!;
  const insertedCounterparties = await harness.db
    .insert(counterparties)
    .values([
      { name: "Northwind" },
      { name: "Contoso" },
      { name: "Archived Document Party" },
      { name: "Archived Owner Party" },
    ])
    .returning({ id: counterparties.id });
  counterpartyAId = insertedCounterparties[0]!.id;
  counterpartyBId = insertedCounterparties[1]!.id;
  await harness.db.insert(contractCounterparties).values([
    { contractId: contractA.id, counterpartyId: counterpartyAId, isPrimary: true },
    { contractId: contractB.id, counterpartyId: counterpartyBId, isPrimary: true },
    {
      contractId: insertedContracts[2]!.id,
      counterpartyId: insertedCounterparties[2]!.id,
      isPrimary: true,
    },
    {
      contractId: insertedContracts[3]!.id,
      counterpartyId: insertedCounterparties[3]!.id,
      isPrimary: true,
    },
  ]);
  const insertedMatters = await harness.db
    .insert(matters)
    .values({
      title: "Matter owner",
      matterTypeId,
      statusId: matterStatusId,
      createdBy: memberId,
    })
    .returning({ id: matters.id, number: matters.number });
  matterA = insertedMatters[0]!;

  const [contractFolder] = await harness.db
    .insert(documentFolders)
    .values({ contractId: contractA.id, name: "Executed" })
    .returning({ id: documentFolders.id });
  contractFolderId = contractFolder!.id;
  const [matterFolder] = await harness.db
    .insert(documentFolders)
    .values({ matterId: matterA.id, name: "Correspondence" })
    .returning({ id: documentFolders.id });
  matterFolderId = matterFolder!.id;

  const rows = [
    doc("Alpha PDF", { contractId: contractA.id, folderId: contractFolderId }),
    doc("Beta Word", { contractId: contractB.id }),
    doc("Gamma Deck", { matterId: matterA.id, folderId: matterFolderId }),
    doc("Delta Image", { contractId: contractA.id }),
    doc("Epsilon Email", { matterId: matterA.id }),
    doc("Zeta Other", { contractId: contractB.id }),
    doc(tieTitles[0]!, { contractId: contractA.id }),
    doc(tieTitles[1]!, { contractId: contractB.id }),
    doc(tieTitles[2]!, { matterId: matterA.id }),
    doc(tieTitles[3]!, { contractId: contractA.id }),
    {
      ...doc("Archived document only", { contractId: insertedContracts[2]!.id }),
      archivedAt: new Date("2026-08-01T00:00:00.000Z"),
    },
    doc("Archived owner only", { contractId: insertedContracts[3]!.id }),
  ];
  const inserted = await harness.db
    .insert(documents)
    .values(rows)
    .returning({ id: documents.id, title: documents.title });
  for (const row of inserted) ids.set(row.title, row.id);

  const insertedVersions = await harness.db
    .insert(documentVersions)
    .values([
      version(
        "Alpha PDF",
        // No extension and a tab before the parameter: only the MIME arm can
        // classify this, and only if the SQL trims the same whitespace
        // {@link mediaType} does.
        "alpha",
        "application/pdf\t; charset=binary",
        "executed",
        1_000,
        "2026-06-15T10:00:00.000Z",
      ),
      version(
        "Beta Word",
        "beta.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "draft_ours",
        2_000,
        "2026-06-20T23:59:59.999Z",
        otherUploaderId,
      ),
      version(
        "Gamma Deck",
        "gamma.pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "amendment",
        3_000,
        "2026-07-01T09:00:00.000Z",
      ),
      version(
        "Delta Image",
        "delta.png",
        "image/png",
        "draft_theirs",
        4_000,
        "2026-07-02T09:00:00.000Z",
      ),
      version(
        "Epsilon Email",
        "epsilon.eml",
        "message/rfc822",
        "redline_theirs",
        5_000,
        "2026-07-03T09:00:00.000Z",
      ),
      version(
        "Zeta Other",
        "zeta.zip",
        "application/zip",
        "redline_ours",
        6_000,
        "2026-07-04T09:00:00.000Z",
      ),
      ...tieTitles.map((title) =>
        version(
          title,
          "same.pdf",
          "application/pdf",
          "draft_ours",
          7_000,
          "2026-08-01T12:00:00.000Z",
        ),
      ),
      version(
        "Archived document only",
        "archived-document.pdf",
        "application/pdf",
        "executed",
        8_000,
        "2026-08-02T12:00:00.000Z",
        adminId,
      ),
      version(
        "Archived owner only",
        "archived-owner.pdf",
        "application/pdf",
        "executed",
        9_000,
        "2026-08-03T12:00:00.000Z",
        adminId,
      ),
    ])
    .returning({ id: documentVersions.id, documentId: documentVersions.documentId });
  await harness.db.insert(documentVersionText).values(
    insertedVersions
      .filter((row) => tieTitles.some((title) => ids.get(title) === row.documentId))
      .map((row) => ({
        versionId: row.id,
        state: "ready" as const,
        source: "email_body" as const,
        emailSubject: "Same title",
        text: "Tie fixture",
      })),
  );

  function doc(
    title: string,
    owner: { contractId: string; folderId?: string } | { matterId: string; folderId?: string },
  ) {
    return { title, createdBy: memberId, ...owner };
  }

  function version(
    title: string,
    originalFilename: string,
    mimeType: string,
    kind:
      "draft_ours" | "draft_theirs" | "redline_theirs" | "redline_ours" | "executed" | "amendment",
    byteSize: number,
    createdAt: string,
    createdBy = memberId,
  ) {
    return {
      documentId: ids.get(title)!,
      versionNumber: 1,
      fileRef: `local:repository-filters/${ids.get(title)!}/1`,
      originalFilename,
      mimeType,
      kind,
      byteSize,
      checksumSha256: String(byteSize % 10).repeat(64),
      createdBy,
      createdAt: new Date(createdAt),
    };
  }
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

async function request(query: Record<string, string> = {}) {
  const params = new URLSearchParams(query);
  return harness.app.inject({
    method: "GET",
    url: `/api/v1/documents${params.size ? `?${params.toString()}` : ""}`,
    cookies,
  });
}

async function list(query: Record<string, string> = {}): Promise<Answer> {
  const response = await request(query);
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as Answer;
}

const titles = (answer: Answer) => answer.documents.map((row) => row.title);
const reference = (row: Row) => `${row.owner.kind === "contract" ? "C" : "M"}-${row.owner.number}`;

describe("the fixed Document repository filters", () => {
  it("filters each fixed dimension on its own", async () => {
    expect(titles(await list({ owner: "matter" }))).toEqual(
      expect.arrayContaining(["Gamma Deck", "Epsilon Email"]),
    );
    expect(titles(await list({ record: `C-${contractA.number}` }))).toEqual(
      expect.arrayContaining(["Alpha PDF", "Delta Image"]),
    );
    expect(
      titles(await list({ record: `C-${contractA.number}`, folder: contractFolderId })),
    ).toEqual(["Alpha PDF"]);
    expect(titles(await list({ record: `M-${matterA.number}`, folder: matterFolderId }))).toEqual([
      "Gamma Deck",
    ]);
    const contractRoot = titles(await list({ record: `C-${contractA.number}`, folder: "root" }));
    expect(contractRoot).toHaveLength(3);
    expect(contractRoot).toContain("Delta Image");
    expect(contractRoot.filter((title) => title === "Same title")).toHaveLength(2);
    expect(titles(await list({ format: "word" }))).toEqual(["Beta Word"]);
    expect(titles(await list({ kind: "executed" }))).toEqual(["Alpha PDF"]);
    const uploadedSince = titles(await list({ uploadedFrom: "2026-07-03" }));
    expect(uploadedSince).toHaveLength(6);
    expect(uploadedSince).toEqual(expect.arrayContaining(["Epsilon Email", "Zeta Other"]));
    expect(uploadedSince.filter((title) => title === "Same title")).toHaveLength(4);
    expect(titles(await list({ uploadedTo: "2026-06-20" }))).toEqual(["Beta Word", "Alpha PDF"]);
  });

  it("composes filters with AND", async () => {
    expect(
      titles(
        await list({
          owner: "contract",
          record: `C-${contractB.number}`,
          folder: "root",
          format: "word",
          kind: "draft_ours",
          uploadedFrom: "2026-06-20",
          uploadedTo: "2026-06-20",
        }),
      ),
    ).toEqual(["Beta Word"]);
  });

  it("filters by a Contract Counterparty and never matches Matter-owned Documents", async () => {
    const answer = await list({ counterparty: counterpartyAId });
    expect(titles(answer)).toEqual(
      expect.arrayContaining(["Alpha PDF", "Delta Image", "Same title"]),
    );
    expect(answer.documents.every((row) => row.owner.kind === "contract")).toBe(true);
    expect(answer.documents.every((row) => row.owner.number === contractA.number)).toBe(true);
  });

  it("filters by the current Version uploader", async () => {
    expect(titles(await list({ uploader: otherUploaderId }))).toEqual(["Beta Word"]);
  });

  it("composes Counterparty and uploader with the fixed filters", async () => {
    expect(
      titles(
        await list({
          owner: "contract",
          record: `C-${contractB.number}`,
          folder: "root",
          format: "word",
          kind: "draft_ours",
          uploadedFrom: "2026-06-20",
          uploadedTo: "2026-06-20",
          counterparty: counterpartyBId,
          uploader: otherUploaderId,
        }),
      ),
    ).toEqual(["Beta Word"]);
    expect(
      titles(
        await list({
          record: `C-${contractB.number}`,
          counterparty: counterpartyAId,
          uploader: otherUploaderId,
        }),
      ),
    ).toEqual([]);
  });

  it("answers the records, Counterparties, and uploaders carried by live Documents", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/api/v1/documents/options",
      cookies,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({
      counterparties: [
        { id: counterpartyBId, name: "Contoso" },
        { id: counterpartyAId, name: "Northwind" },
      ],
      uploaders: [
        {
          id: memberId,
          displayName: MEMBER.displayName,
          image: null,
          archived: false,
        },
        {
          id: otherUploaderId,
          displayName: OTHER_UPLOADER.displayName,
          image: null,
          archived: false,
        },
      ],
      records: [
        {
          reference: `C-${contractA.number}`,
          kind: "contract",
          number: contractA.number,
          title: "Alpha owner",
        },
        {
          reference: `C-${contractB.number}`,
          kind: "contract",
          number: contractB.number,
          title: "Beta owner",
        },
        {
          reference: `M-${matterA.number}`,
          kind: "matter",
          number: matterA.number,
          title: "Matter owner",
        },
      ],
    });
  });

  it("uses the doc-panel render family for every MIME family", async () => {
    const expected = {
      pdf: "Alpha PDF",
      word: "Beta Word",
      powerpoint: "Gamma Deck",
      image: "Delta Image",
      email: "Epsilon Email",
      other: "Zeta Other",
    } as const;
    for (const [format, title] of Object.entries(expected)) {
      expect(titles(await list({ format, uploadedTo: "2026-07-31" })), format).toEqual([title]);
    }
  });

  it("refuses folder without record and every unknown enum value", async () => {
    const refused = await request({ folder: "root" });
    expect(refused.statusCode, refused.body).toBe(400);
    expect(refused.headers["content-type"]).toContain("application/problem+json");
    expect(refused.json()).toMatchObject({ status: 400 });
    const invalidQueries: Record<string, string>[] = [
      { record: "M-abc" },
      { record: "C-99999999999" },
      { format: "spreadsheet" },
      { kind: "final" },
      { sort: "versions" },
      { sort: "title", dir: "sideways" },
    ];
    for (const query of invalidQueries) {
      const response = await request(query);
      expect(response.statusCode, JSON.stringify(query)).toBe(400);
      expect(response.headers["content-type"]).toContain("application/problem+json");
      expect(response.json()).toMatchObject({ status: 400 });
    }
  });
});

describe("the sorted Document repository cursor", () => {
  const tiedQuery = { uploadedFrom: "2026-08-01", uploadedTo: "2026-08-01" };

  it.each(["title", "kind", "format", "size", "uploader", "uploaded"])(
    "breaks %s ties by owning-record reference and then Document id",
    async (sort) => {
      const rows = (await list({ ...tiedQuery, sort, dir: "asc" })).documents;
      expect(rows.map(reference)).toEqual([
        `M-${matterA.number}`,
        `C-${contractB.number}`,
        `C-${contractA.number}`,
        `C-${contractA.number}`,
      ]);
      const sameOwner = rows.filter((row) => reference(row) === `C-${contractA.number}`);
      expect(sameOwner.map((row) => row.id)).toEqual(
        sameOwner
          .map((row) => row.id)
          .sort()
          .reverse(),
      );
    },
  );

  it("sorts by owner in either direction and keeps same-owner rows reproducible", async () => {
    const ascending = (await list({ ...tiedQuery, sort: "owner", dir: "asc" })).documents;
    const descending = (await list({ ...tiedQuery, sort: "owner", dir: "desc" })).documents;
    expect(ascending.map(reference)).toEqual([
      `C-${contractA.number}`,
      `C-${contractA.number}`,
      `C-${contractB.number}`,
      `M-${matterA.number}`,
    ]);
    expect(descending.map(reference)).toEqual([
      `M-${matterA.number}`,
      `C-${contractB.number}`,
      `C-${contractA.number}`,
      `C-${contractA.number}`,
    ]);
    for (const rows of [ascending, descending]) {
      const sameOwner = rows.filter((row) => reference(row) === `C-${contractA.number}`);
      expect(sameOwner.map((row) => row.id)).toEqual(
        sameOwner
          .map((row) => row.id)
          .sort()
          .reverse(),
      );
    }
  });

  it("pages through a sorted tie without skipping or repeating a Document", async () => {
    const seen: Row[] = [];
    let cursor: string | null = null;
    do {
      const page = await list({
        ...tiedQuery,
        sort: "title",
        dir: "asc",
        limit: "2",
        ...(cursor ? { cursor } : {}),
      });
      seen.push(...page.documents);
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(seen).toHaveLength(tieTitles.length);
    expect(new Set(seen.map((row) => row.id))).toHaveLength(tieTitles.length);
    expect(seen.map((row) => row.id)).toEqual(
      (await list({ ...tiedQuery, sort: "title", dir: "asc" })).documents.map((row) => row.id),
    );
  });
});
