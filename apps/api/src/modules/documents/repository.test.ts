// SPDX-License-Identifier: AGPL-3.0-only

/** M26's flat Document repository at the HTTP seam, against real Postgres. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  contracts,
  contractStatuses,
  contractTeam,
  contractTypes,
  documentFolders,
  documents,
  documentVersions,
  documentVersionText,
  eq,
  matters,
  matterStatuses,
  matterTypes,
  sql,
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
  email: "repository-member@example.com",
  displayName: "Morgan Repository",
  password: "correct-horse-battery",
} as const;

interface RepositoryRow {
  id: string;
  title: string;
  description: string | null;
  isConfidential: boolean;
  archivedAt: string | null;
  owner: { kind: "contract" | "matter"; number: number; title: string };
  folder: { id: string; name: string } | null;
  currentVersion: {
    id: string;
    versionNumber: number;
    kind: string;
    originalFilename: string;
    mimeType: string;
    byteSize: number;
    uploadedBy: { id: string; displayName: string; image: string | null; archived: boolean };
    createdAt: string;
  };
  versionCount: number;
}

interface RepositoryAnswer {
  documents: RepositoryRow[];
  nextCursor: string | null;
}

let harness: TestHarness;
let cookies: Record<string, string>;
let memberId = "";
const ids = new Map<string, string>();

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
  cookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);

  const contractTypeId = (await harness.db.select({ id: contractTypes.id }).from(contractTypes))[0]!
    .id;
  const openContractStatusId = (
    await harness.db.select({ id: contractStatuses.id }).from(contractStatuses)
  )[0]!.id;
  const [endedContractStatus] = await harness.db
    .insert(contractStatuses)
    .values({
      slug: "repository-ended",
      displayName: "Repository ended",
      stage: "ended",
      displayOrder: 981,
    })
    .returning({ id: contractStatuses.id });
  const matterTypeId = (await harness.db.select({ id: matterTypes.id }).from(matterTypes))[0]!.id;
  const openMatterStatusId = (
    await harness.db.select({ id: matterStatuses.id }).from(matterStatuses)
  )[0]!.id;
  const [closedMatterStatus] = await harness.db
    .insert(matterStatuses)
    .values({
      slug: "repository-closed",
      displayName: "Repository closed",
      category: "closed",
      displayOrder: 981,
    })
    .returning({ id: matterStatuses.id });

  const [contract, endedContract, archivedContract] = await harness.db
    .insert(contracts)
    .values([
      { title: "Meridian services", contractTypeId, statusId: openContractStatusId },
      {
        title: "Ended lease",
        contractTypeId,
        statusId: endedContractStatus!.id,
        endedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
      {
        title: "Archived contract",
        contractTypeId,
        statusId: openContractStatusId,
        archivedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ])
    .returning({ id: contracts.id, number: contracts.number, title: contracts.title });
  const [matter, closedMatter, archivedMatter] = await harness.db
    .insert(matters)
    .values([
      {
        title: "Delivery dispute",
        matterTypeId,
        statusId: openMatterStatusId,
        createdBy: memberId,
      },
      {
        title: "Closed investigation",
        matterTypeId,
        statusId: closedMatterStatus!.id,
        createdBy: memberId,
        closedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
      {
        title: "Archived matter",
        matterTypeId,
        statusId: openMatterStatusId,
        createdBy: memberId,
        archivedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ])
    .returning({ id: matters.id, number: matters.number, title: matters.title });

  const [folder] = await harness.db
    .insert(documentFolders)
    .values({ contractId: contract!.id, name: "Executed" })
    .returning({ id: documentFolders.id, name: documentFolders.name });
  await harness.db.insert(contractTeam).values({
    contractId: contract!.id,
    userId: memberId,
    role: "member",
  });

  const seeded = await harness.db
    .insert(documents)
    .values([
      {
        contractId: contract!.id,
        folderId: folder!.id,
        title: "Master services agreement",
        description: "The signed services terms.",
        createdBy: memberId,
        isConfidential: true,
      },
      { matterId: matter!.id, title: "Delivery timeline", createdBy: memberId },
      { contractId: contract!.id, title: "Filed email.eml", createdBy: memberId },
      { contractId: endedContract!.id, title: "Ended paper", createdBy: memberId },
      { matterId: closedMatter!.id, title: "Closed paper", createdBy: memberId },
      {
        contractId: contract!.id,
        title: "Archived document",
        createdBy: memberId,
        archivedAt: new Date("2026-08-20T00:00:00.000Z"),
      },
      {
        contractId: archivedContract!.id,
        title: "Paper on archived contract",
        createdBy: memberId,
      },
      { matterId: archivedMatter!.id, title: "Paper on archived matter", createdBy: memberId },
    ])
    .returning({ id: documents.id, title: documents.title });
  for (const row of seeded) ids.set(row.title, row.id);

  const versions = await harness.db
    .insert(documentVersions)
    .values([
      version(
        "Master services agreement",
        1,
        "2026-08-01T09:00:00.000Z",
        "msa-v1.docx",
        "draft_ours",
      ),
      version(
        "Master services agreement",
        2,
        "2026-08-05T09:00:00.000Z",
        "msa-signed.pdf",
        "executed",
      ),
      version("Delivery timeline", 1, "2026-08-04T09:00:00.000Z", "timeline.pdf", "draft_theirs"),
      version(
        "Filed email.eml",
        1,
        "2026-08-06T09:00:00.000Z",
        "reply.eml",
        "draft_theirs",
        "message/rfc822",
      ),
      version("Ended paper", 1, "2026-08-08T09:00:00.000Z", "ended.pdf", "executed"),
      version("Closed paper", 1, "2026-08-07T09:00:00.000Z", "closed.pdf", "draft_ours"),
      version("Archived document", 1, "2026-08-20T09:00:00.000Z", "archived.pdf", "draft_ours"),
      version(
        "Paper on archived contract",
        1,
        "2026-08-19T09:00:00.000Z",
        "hidden-c.pdf",
        "draft_ours",
      ),
      version(
        "Paper on archived matter",
        1,
        "2026-08-18T09:00:00.000Z",
        "hidden-m.pdf",
        "draft_ours",
      ),
    ])
    .returning({ id: documentVersions.id, documentId: documentVersions.documentId });
  const emailVersion = versions.find((row) => row.documentId === ids.get("Filed email.eml"))!;
  await harness.db.insert(documentVersionText).values({
    versionId: emailVersion.id,
    state: "ready",
    source: "email_body",
    emailSubject: "RE: delivery dispute — late shipment",
    text: "Please see the attached response.",
  });

  function version(
    title: string,
    versionNumber: number,
    createdAt: string,
    originalFilename: string,
    kind: "draft_ours" | "draft_theirs" | "executed",
    mimeType = "application/pdf",
  ) {
    const documentId = ids.get(title)!;
    return {
      documentId,
      versionNumber,
      fileRef: `local:repository/${documentId}/${String(versionNumber)}`,
      kind,
      originalFilename,
      mimeType,
      byteSize: versionNumber * 1_024,
      checksumSha256: String(versionNumber).repeat(64),
      createdBy: memberId,
      createdAt: new Date(createdAt),
    };
  }
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

async function list(query = ""): Promise<RepositoryAnswer> {
  const response = await harness.app.inject({
    method: "GET",
    url: `/api/v1/documents${query}`,
    cookies,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}

describe("the Document repository", () => {
  it("returns the full row projection in newest-current-Version order", async () => {
    const answer = await list();
    expect(answer.documents.map((row) => row.title)).toEqual([
      "Ended paper",
      "Closed paper",
      "RE: delivery dispute — late shipment",
      "Master services agreement",
      "Delivery timeline",
    ]);
    expect(answer.nextCursor).toBeNull();
    const row = answer.documents.find(
      (candidate) => candidate.id === ids.get("Master services agreement"),
    );
    expect(row).toEqual({
      id: ids.get("Master services agreement"),
      title: "Master services agreement",
      description: "The signed services terms.",
      isConfidential: true,
      archivedAt: null,
      owner: expect.objectContaining({ kind: "contract", title: "Meridian services" }),
      folder: expect.objectContaining({ name: "Executed" }),
      currentVersion: expect.objectContaining({
        versionNumber: 2,
        kind: "executed",
        originalFilename: "msa-signed.pdf",
        mimeType: "application/pdf",
        byteSize: 2_048,
        uploadedBy: {
          id: memberId,
          displayName: MEMBER.displayName,
          image: null,
          archived: false,
        },
        createdAt: "2026-08-05T09:00:00.000Z",
      }),
      versionCount: 2,
    });
  });

  it("pages on current-Version upload time and Document id", async () => {
    const first = await list("?limit=2");
    expect(first.documents.map((row) => row.title)).toEqual(["Ended paper", "Closed paper"]);
    expect(first.nextCursor).toBe(first.documents[1]!.id);
    const second = await list(`?limit=2&cursor=${first.nextCursor!}`);
    expect(second.documents.map((row) => row.title)).toEqual([
      "RE: delivery dispute — late shipment",
      "Master services agreement",
    ]);
    expect(second.nextCursor).toBe(second.documents[1]!.id);
  });

  it("includes ended Contracts and closed Matters, and excludes archived rows and owners", async () => {
    const titles = (await list()).documents.map((row) => row.title);
    expect(titles).toContain("Ended paper");
    expect(titles).toContain("Closed paper");
    expect(titles).not.toContain("Archived document");
    expect(titles).not.toContain("Paper on archived contract");
    expect(titles).not.toContain("Paper on archived matter");
  });

  it("draws archived Documents beside live ones only when includeArchived is true", async () => {
    const defaultTitles = (await list()).documents.map((row) => row.title);
    const withArchived = await list("?includeArchived=true");
    const archived = withArchived.documents.find((row) => row.title === "Archived document");

    expect(defaultTitles).not.toContain("Archived document");
    expect(archived).toEqual(
      expect.objectContaining({
        id: ids.get("Archived document"),
        archivedAt: "2026-08-20T00:00:00.000Z",
      }),
    );
    expect(withArchived.documents.map((row) => row.title)).not.toContain(
      "Paper on archived contract",
    );
    expect(withArchived.documents.map((row) => row.title)).not.toContain(
      "Paper on archived matter",
    );
  });

  it("rejects a limit above 100", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/api/v1/documents?limit=101",
      cookies,
    });
    expect(response.statusCode, response.body).toBe(400);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toMatchObject({ status: 400 });
  });
});

describe("the cursor against Postgres microsecond stamps", () => {
  /** Uploads through the API take `now()`, which keeps microseconds. A
   * boundary read back through the driver would keep milliseconds and
   * sit a fraction before the real stamp. These three sit older than
   * every row above: two share one stamp and one sits inside the
   * fraction a millisecond boundary would drop. */
  const seededTitles = ["Tie A", "Tie B", "Between"];

  beforeAll(async () => {
    const contractId = (
      await harness.db
        .select({ id: contracts.id })
        .from(contracts)
        .where(eq(contracts.title, "Meridian services"))
    )[0]!.id;
    const seeded = await harness.db
      .insert(documents)
      .values(seededTitles.map((title) => ({ contractId, title, createdBy: memberId })))
      .returning({ id: documents.id, title: documents.title });
    for (const row of seeded) ids.set(row.title, row.id);
    const at = (stamp: string) => sql`${stamp}::timestamptz`;
    await harness.db.insert(documentVersions).values(
      [
        ["Tie A", "2026-08-03T09:00:00.000500Z"],
        ["Tie B", "2026-08-03T09:00:00.000500Z"],
        ["Between", "2026-08-03T09:00:00.000200Z"],
      ].map(([title, stamp]) => ({
        documentId: ids.get(title!)!,
        versionNumber: 1,
        fileRef: `local:repository/${ids.get(title!)!}/1`,
        kind: "draft_ours" as const,
        originalFilename: `${title!}.pdf`,
        mimeType: "application/pdf",
        byteSize: 1_024,
        checksumSha256: "3".repeat(64),
        createdBy: memberId,
        createdAt: at(stamp!),
      })),
    );
  });

  it("walks a shared stamp and the fraction under a millisecond without a gap", async () => {
    const whole = (await list()).documents.map((row) => row.title);
    expect(whole.slice(-3).sort()).toEqual([...seededTitles].sort());

    const paged: string[] = [];
    let cursor: string | null = null;
    do {
      const page: RepositoryAnswer = await list(`?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      paged.push(...page.documents.map((row) => row.title));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(paged).toEqual(whole);
  });
});
