// SPDX-License-Identifier: AGPL-3.0-only

/** DD-014 repository reach, compared across five viewers of one install. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  counterparties,
  contracts,
  contractCounterparties,
  contractStatuses,
  contractTeam,
  contractTypes,
  documents,
  documentVersions,
  eq,
  matters,
  matterStatuses,
  matterTeam,
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

const PEOPLE = {
  onTeam: {
    email: "repository-on-team@example.com",
    displayName: "On Team Member",
    password: "correct-horse-battery",
    role: "legal_team_member",
  },
  offTeam: {
    email: "repository-off-team@example.com",
    displayName: "Off Team Member",
    password: "correct-horse-battery",
    role: "legal_team_member",
  },
  contributor: {
    email: "repository-contributor@example.com",
    displayName: "Repository Contributor",
    password: "correct-horse-battery",
    role: "contributor",
  },
  business: {
    email: "repository-business@example.com",
    displayName: "Repository Business User",
    password: "correct-horse-battery",
    role: "business_user",
  },
} as const;

let harness: TestHarness;
const cookies = new Map<string, Record<string, string>>();
const hiddenIds: string[] = [];
let publicId = "";
let confidentialCounterpartyId = "";
let publicCounterpartyId = "";
let confidentialContractNumber = 0;
let publicContractNumber = 0;
let confidentialMatterNumber = 0;
let walledUploaderId = "";
let publicUploaderId = "";

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  cookies.set("administrator", await signInCookies(harness.app, ADMIN.email, ADMIN.password));
  const adminId = (
    await harness.db.select({ id: users.id }).from(users).where(eq(users.email, ADMIN.email))
  )[0]!.id;
  const peopleIds = new Map<string, string>();
  for (const person of Object.values(PEOPLE)) {
    const user = await provisionUser(harness.app.auth, person);
    await harness.db.update(users).set({ role: person.role }).where(eq(users.id, user.id));
    peopleIds.set(person.email, user.id);
    cookies.set(person.email, await signInCookies(harness.app, person.email, person.password));
  }
  walledUploaderId = peopleIds.get(PEOPLE.onTeam.email)!;
  publicUploaderId = peopleIds.get(PEOPLE.offTeam.email)!;

  const contractTypeId = (await harness.db.select({ id: contractTypes.id }).from(contractTypes))[0]!
    .id;
  const contractStatusId = (
    await harness.db.select({ id: contractStatuses.id }).from(contractStatuses)
  )[0]!.id;
  const matterTypeId = (await harness.db.select({ id: matterTypes.id }).from(matterTypes))[0]!.id;
  const matterStatusId = (
    await harness.db.select({ id: matterStatuses.id }).from(matterStatuses)
  )[0]!.id;
  const [confidentialContract, publicContract] = await harness.db
    .insert(contracts)
    .values([
      {
        title: "Confidential Contract",
        contractTypeId,
        statusId: contractStatusId,
        isConfidential: true,
      },
      { title: "Public Contract", contractTypeId, statusId: contractStatusId },
    ])
    .returning({ id: contracts.id, number: contracts.number });
  confidentialContractNumber = confidentialContract!.number;
  publicContractNumber = publicContract!.number;
  const [confidentialCounterparty, publicCounterparty] = await harness.db
    .insert(counterparties)
    .values([{ name: "Walled Counterparty" }, { name: "Public Counterparty" }])
    .returning({ id: counterparties.id });
  confidentialCounterpartyId = confidentialCounterparty!.id;
  publicCounterpartyId = publicCounterparty!.id;
  await harness.db.insert(contractCounterparties).values([
    {
      contractId: confidentialContract!.id,
      counterpartyId: confidentialCounterpartyId,
      isPrimary: true,
    },
    {
      contractId: publicContract!.id,
      counterpartyId: publicCounterpartyId,
      isPrimary: true,
    },
  ]);
  const [confidentialMatter] = await harness.db
    .insert(matters)
    .values({
      title: "Confidential Matter",
      matterTypeId,
      statusId: matterStatusId,
      createdBy: adminId,
      isConfidential: true,
    })
    .returning({ id: matters.id, number: matters.number });
  confidentialMatterNumber = confidentialMatter!.number;
  const documentRows = await harness.db
    .insert(documents)
    .values([
      { contractId: confidentialContract!.id, title: "Contract wall paper", createdBy: adminId },
      { matterId: confidentialMatter!.id, title: "Matter wall paper", createdBy: adminId },
      {
        contractId: publicContract!.id,
        title: "Document wall paper",
        createdBy: adminId,
        isConfidential: true,
      },
      { contractId: publicContract!.id, title: "Public paper", createdBy: adminId },
    ])
    .returning({ id: documents.id, title: documents.title });
  hiddenIds.push(
    ...documentRows.filter((row) => row.title !== "Public paper").map((row) => row.id),
  );
  publicId = documentRows.find((row) => row.title === "Public paper")!.id;
  await harness.db.insert(documentVersions).values(
    documentRows.map((document, index) => ({
      documentId: document.id,
      versionNumber: 1,
      fileRef: `local:repository-confidentiality/${String(index)}`,
      kind: "draft_ours" as const,
      originalFilename: `paper-${String(index)}.pdf`,
      mimeType: "application/pdf",
      byteSize: 1,
      checksumSha256: String(index + 1).repeat(64),
      createdBy: document.title === "Public paper" ? publicUploaderId : walledUploaderId,
      createdAt: new Date(`2026-08-${String(20 - index).padStart(2, "0")}T09:00:00.000Z`),
    })),
  );

  for (const userId of [
    peopleIds.get(PEOPLE.onTeam.email)!,
    peopleIds.get(PEOPLE.contributor.email)!,
  ]) {
    const role = userId === peopleIds.get(PEOPLE.contributor.email) ? "contributor" : "member";
    await harness.db.insert(contractTeam).values([
      { contractId: confidentialContract!.id, userId, role },
      { contractId: publicContract!.id, userId, role },
    ]);
    await harness.db.insert(matterTeam).values({ matterId: confidentialMatter!.id, userId, role });
  }
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

async function list(as: string, query = "") {
  return harness.app.inject({
    method: "GET",
    url: `/api/v1/documents${query}`,
    cookies: cookies.get(as)!,
  });
}

async function options(as: string) {
  return harness.app.inject({
    method: "GET",
    url: "/api/v1/documents/options",
    cookies: cookies.get(as)!,
  });
}

describe("the DD-014 gate in the Document repository", () => {
  it("answers Administrators, on-team Members, and Contributors from their reach", async () => {
    for (const viewer of ["administrator", PEOPLE.onTeam.email, PEOPLE.contributor.email]) {
      const response = await list(viewer);
      expect(response.statusCode, response.body).toBe(200);
      const rows = response.json().documents as { id: string }[];
      expect(rows.map((row) => row.id)).toEqual(expect.arrayContaining([...hiddenIds, publicId]));
    }
  });

  it("omits every wall before the limit, with no row and no gap", async () => {
    const response = await list(PEOPLE.offTeam.email, "?limit=1");
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({
      documents: [expect.objectContaining({ id: publicId })],
      nextCursor: null,
    });
  });

  it("uses the same reached answer for the Recent strip's limit=5 read", async () => {
    const response = await list(PEOPLE.offTeam.email, "?limit=5");
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({
      documents: [expect.objectContaining({ id: publicId })],
      nextCursor: null,
    });
  });

  it("answers an empty page when the cursor names a walled Document", async () => {
    const response = await list(PEOPLE.offTeam.email, `?cursor=${hiddenIds[0]!}`);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ documents: [], nextCursor: null });
  });

  it("refuses a Business User at requireDocumentReader", async () => {
    const response = await list(PEOPLE.business.email);
    expect(response.statusCode).toBe(403);
  });

  it("scopes every option to the same live Documents for all five viewers", async () => {
    for (const viewer of ["administrator", PEOPLE.onTeam.email, PEOPLE.contributor.email]) {
      const response = await options(viewer);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual({
        counterparties: [
          { id: publicCounterpartyId, name: "Public Counterparty" },
          { id: confidentialCounterpartyId, name: "Walled Counterparty" },
        ],
        uploaders: [
          {
            id: publicUploaderId,
            displayName: PEOPLE.offTeam.displayName,
            image: null,
            archived: false,
          },
          {
            id: walledUploaderId,
            displayName: PEOPLE.onTeam.displayName,
            image: null,
            archived: false,
          },
        ],
        records: [
          {
            reference: `C-${confidentialContractNumber}`,
            kind: "contract",
            number: confidentialContractNumber,
            title: "Confidential Contract",
          },
          {
            reference: `C-${publicContractNumber}`,
            kind: "contract",
            number: publicContractNumber,
            title: "Public Contract",
          },
          {
            reference: `M-${confidentialMatterNumber}`,
            kind: "matter",
            number: confidentialMatterNumber,
            title: "Confidential Matter",
          },
        ],
      });
    }

    const outside = await options(PEOPLE.offTeam.email);
    expect(outside.statusCode, outside.body).toBe(200);
    expect(outside.json()).toEqual({
      counterparties: [{ id: publicCounterpartyId, name: "Public Counterparty" }],
      uploaders: [
        {
          id: publicUploaderId,
          displayName: PEOPLE.offTeam.displayName,
          image: null,
          archived: false,
        },
      ],
      records: [
        {
          reference: `C-${publicContractNumber}`,
          kind: "contract",
          number: publicContractNumber,
          title: "Public Contract",
        },
      ],
    });

    expect((await options(PEOPLE.business.email)).statusCode).toBe(403);
  });
});
