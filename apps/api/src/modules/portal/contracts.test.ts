// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contracts, documents, eq, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

let harness: TestHarness;
let admin: Record<string, string>;
let typeId: string;
const people = new Map<string, { id: string; cookies: Record<string, string> }>();
const person = (name: string) => people.get(name)!;

beforeAll(async () => {
  harness = await startHarness();
  await harness.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  admin = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
  for (const [name, role] of [
    ["member", "legal_team_member"],
    ["first", "business_user"],
    ["second", "business_user"],
    ["outsider", "business_user"],
    ["business_user", "business_user"],
  ] as const) {
    const fixture = {
      email: `portal-contract-${name}@example.com`,
      displayName: name,
      password: "correct-horse-battery",
    };
    const created = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, created.id));
    people.set(name, {
      id: created.id,
      cookies: await signInCookies(harness.app, fixture.email, fixture.password),
    });
  }
  const options = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: admin,
  });
  typeId = options.json().contractTypes[0].id;
});
afterAll(async () => harness?.stop());

async function create(title: string) {
  const result = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: admin,
    payload: { title, contractTypeId: typeId },
  });
  expect(result.statusCode, result.body).toBe(201);
  return result.json().contract as { id: string; number: number };
}
const patch = (number: number, payload: Record<string, unknown>, cookies = admin) =>
  harness.app.inject({ method: "PATCH", url: `/api/v1/contracts/${number}`, cookies, payload });
const read = (number: number, name = "first") =>
  harness.app.inject({
    method: "GET",
    url: `/api/v1/portal/contracts/${number}`,
    cookies: person(name).cookies,
  });
const add = (number: number, name: string, cookies = admin) =>
  harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/team`,
    cookies,
    payload: { userId: person(name).id },
  });

describe("Portal Contract access", () => {
  it("keeps Business Owner responsibility independent of the team grant", async () => {
    const contract = await create("Portal ownership");
    expect((await patch(contract.number, { businessOwnerId: person("first").id })).statusCode).toBe(
      200,
    );
    expect((await read(contract.number)).statusCode).toBe(404);
    expect((await add(contract.number, "first", person("member").cookies)).statusCode).toBe(201);
    expect(
      (await patch(contract.number, { businessOwnerId: person("second").id })).statusCode,
    ).toBe(200);
    expect((await read(contract.number)).statusCode).toBe(200);
    expect((await read(contract.number, "second")).statusCode).toBe(404);
    expect(
      (
        await harness.app.inject({
          method: "DELETE",
          url: `/api/v1/contracts/${contract.number}/team/${person("first").id}`,
          cookies: admin,
        })
      ).statusCode,
    ).toBe(200);
    expect((await read(contract.number)).statusCode).toBe(404);
  });

  it("requires Member+ to manage access and refuses invalid or archived people", async () => {
    const contract = await create("Access writers");
    await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/team`,
      cookies: admin,
      payload: { userId: person("business_user").id },
    });
    for (const name of ["first", "business_user"]) {
      expect(
        (
          await patch(
            contract.number,
            { businessOwnerId: person("second").id },
            person(name).cookies,
          )
        ).statusCode,
      ).toBe(403);
      expect((await add(contract.number, "second", person(name).cookies)).statusCode).toBe(403);
    }
    expect((await patch(contract.number, { businessOwnerId: "missing-user" })).statusCode).toBe(
      400,
    );
    await harness.db
      .update(users)
      .set({ archivedAt: new Date() })
      .where(eq(users.id, person("outsider").id));
    try {
      expect(
        (await patch(contract.number, { businessOwnerId: person("outsider").id })).statusCode,
      ).toBe(400);
      expect((await add(contract.number, "outsider")).statusCode).toBe(400);
    } finally {
      await harness.db
        .update(users)
        .set({ archivedAt: null })
        .where(eq(users.id, person("outsider").id));
    }
  });

  it("requires the named team for Confidential Contracts even when someone owns the business relationship", async () => {
    const contract = await create("Confidential Portal ownership");
    expect(
      (await patch(contract.number, { businessOwnerId: person("first").id, isConfidential: true }))
        .statusCode,
    ).toBe(200);
    expect((await read(contract.number)).statusCode).toBe(404);
    expect((await add(contract.number, "second", person("member").cookies)).statusCode).toBe(404);
    const grant = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/team`,
      cookies: admin,
      payload: { userId: person("first").id },
    });
    expect(grant.statusCode, grant.body).toBe(201);
    expect((await read(contract.number)).statusCode).toBe(200);
    await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/contracts/${contract.number}/team/${person("first").id}`,
      cookies: admin,
    });
    expect((await read(contract.number)).statusCode).toBe(404);
  });

  it("returns only allowed record data and omits archived and unrelated Contracts before pagination", async () => {
    const contract = await create("Allowed Portal facts");
    await patch(contract.number, {
      businessOwnerId: person("first").id,
      description: "Legal-only narrative",
    });
    await harness.db
      .update(contracts)
      .set({
        aiUnverified: {
          expiry_date: {
            runId: "internal-run",
            evidence: "internal legal evidence",
            writtenAt: new Date().toISOString(),
          },
        },
      })
      .where(eq(contracts.id, contract.id));
    await add(contract.number, "first");
    const detail = await read(contract.number);
    expect(detail.json().contract.unverifiedFields).toEqual(["expiryDate"]);
    expect(detail.body).not.toContain("internal legal evidence");
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.body).not.toContain("Legal-only narrative");
    expect(Object.keys(detail.json().contract)).not.toEqual(
      expect.arrayContaining(["customFields", "team", "tasks", "history"]),
    );
    expect(detail.json().contract).not.toHaveProperty("customFields");
    expect(detail.json().contract).not.toHaveProperty("description");
    const list = await harness.app.inject({
      method: "GET",
      url: "/api/v1/portal/contracts",
      cookies: person("first").cookies,
    });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().contracts).toContainEqual(
      expect.objectContaining({ number: contract.number }),
    );
    await harness.db
      .update(contracts)
      .set({ archivedAt: new Date() })
      .where(eq(contracts.id, contract.id));
    expect((await read(contract.number)).statusCode).toBe(404);
    const archived = await harness.app.inject({
      method: "GET",
      url: "/api/v1/portal/contracts",
      cookies: person("first").cookies,
    });
    expect(archived.json().contracts).not.toContainEqual(
      expect.objectContaining({ number: contract.number }),
    );
    const staff = await harness.app.inject({
      method: "GET",
      url: `/api/v1/contracts/${contract.number}`,
      cookies: person("first").cookies,
    });
    expect(staff.statusCode).toBe(403);
  });
});

async function upload(
  number: number,
  filename = "agreement.pdf",
  mime = "application/pdf",
  bytes = "%PDF-1.4\ncurrent agreement",
  documentId?: string,
) {
  const boundary = "portal-contract-upload";
  const result = await harness.app.inject({
    method: "POST",
    cookies: admin,
    url: documentId
      ? `/api/v1/documents/${documentId}/versions`
      : `/api/v1/contracts/${number}/documents`,
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.from(
      `--${boundary}\r\ncontent-disposition: form-data; name="kind"\r\n\r\ndraft_ours\r\n--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${filename}"\r\ncontent-type: ${mime}\r\n\r\n${bytes}\r\n--${boundary}--\r\n`,
    ),
  });
  expect(result.statusCode, result.body).toBe(201);
  return result.json();
}
const suffixes = [
  "download",
  "preview",
  "rendition",
  "email",
  "attachments/0/download",
  "attachments/0/preview",
];
const documentRead = (
  number: number,
  documentId: string,
  versionId: string,
  suffix: string,
  name = "first",
) =>
  harness.app.inject({
    method: "GET",
    cookies: person(name).cookies,
    url: `/api/v1/portal/contracts/${number}/documents/${documentId}/versions/${versionId}/${suffix}`,
  });

it("gates every Document endpoint on current ownership, current primary Version, and named Confidential audience", async () => {
  const contract = await create("Portal paper");
  await patch(contract.number, { businessOwnerId: person("first").id });
  await add(contract.number, "first");
  const first = (await upload(contract.number)).document;
  const detail = (await read(contract.number)).json().contract.primaryDocument;
  expect(detail.id).toBe(first.id);
  expect(detail.version).not.toHaveProperty("uploadedBy");
  expect(detail.version).not.toHaveProperty("notes");
  for (const suffix of suffixes) {
    expect(
      (await documentRead(contract.number, first.id, detail.version.id, suffix, "outsider"))
        .statusCode,
    ).toBe(404);
  }
  const preview = await documentRead(contract.number, first.id, detail.version.id, "preview");
  expect(preview.statusCode, preview.body).toBe(200);
  expect(preview.headers["content-type"]).toBe("application/pdf");
  expect(preview.headers["cache-control"]).toBe("private, no-store");
  expect(preview.body).toContain("current agreement");
  expect(
    (await documentRead(contract.number, first.id, detail.version.id, "download")).statusCode,
  ).toBe(200);
  await upload(
    contract.number,
    "revised.pdf",
    "application/pdf",
    "%PDF-1.4\nrevised agreement",
    first.id,
  );
  const latest = (await read(contract.number)).json().contract.primaryDocument.version;
  for (const suffix of suffixes)
    expect(
      (await documentRead(contract.number, first.id, detail.version.id, suffix)).statusCode,
    ).toBe(404);
  expect((await documentRead(contract.number, first.id, latest.id, "preview")).statusCode).toBe(
    200,
  );
  const other = (await upload(contract.number, "other.pdf")).document;
  for (const suffix of suffixes)
    expect(
      (await documentRead(contract.number, other.id, other.versions[0].id, suffix)).statusCode,
    ).toBe(404);
  await harness.db
    .update(documents)
    .set({ isConfidential: true })
    .where(eq(documents.id, first.id));
  expect((await read(contract.number)).json().contract.primaryDocument.id).toBe(first.id);
  expect((await documentRead(contract.number, first.id, latest.id, "preview")).statusCode).toBe(
    200,
  );
  expect((await patch(contract.number, { businessOwnerId: null })).statusCode).toBe(200);
  expect((await documentRead(contract.number, first.id, latest.id, "preview")).statusCode).toBe(
    200,
  );
  await harness.app.inject({
    method: "DELETE",
    url: `/api/v1/contracts/${contract.number}/team/${person("first").id}`,
    cookies: admin,
  });
  for (const suffix of suffixes)
    expect((await documentRead(contract.number, first.id, latest.id, suffix)).statusCode).toBe(404);
});

it("reads an email and its safe attachment through Portal endpoints and revokes them when primary changes", async () => {
  const contract = await create("Portal email");
  await add(contract.number, "first");
  const eml = [
    "From: Legal <legal@example.com>",
    "To: Business <business@example.com>",
    "Subject: Agreement",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="mail-boundary"',
    "",
    "--mail-boundary",
    "Content-Type: text/plain",
    "",
    "Agreed terms attached.",
    "--mail-boundary",
    'Content-Type: text/plain; name="terms.txt"',
    'Content-Disposition: attachment; filename="terms.txt"',
    "",
    "Payment in thirty days.",
    "--mail-boundary--",
    "",
  ].join("\r\n");
  const doc = (await upload(contract.number, "agreement.eml", "message/rfc822", eml)).document;
  const versionId = doc.versions[0].id;
  const email = await documentRead(contract.number, doc.id, versionId, "email");
  expect(email.statusCode, email.body).toBe(200);
  expect(email.json().email.subject).toBe("Agreement");
  expect(email.json().email.attachments[0].filename).toBe("terms.txt");
  expect(email.json().email.attachments[0]).not.toHaveProperty("content");
  expect(
    (await documentRead(contract.number, doc.id, versionId, "attachments/0/download")).body,
  ).toContain("Payment in thirty days.");
  expect(
    (await documentRead(contract.number, doc.id, versionId, "attachments/0/preview")).statusCode,
  ).toBe(415);
  const next = (await upload(contract.number)).document;
  const primary = await harness.app.inject({
    method: "POST",
    url: `/api/v1/documents/${next.id}/primary`,
    cookies: admin,
  });
  expect(primary.statusCode, primary.body).toBe(200);
  for (const suffix of suffixes)
    expect((await documentRead(contract.number, doc.id, versionId, suffix)).statusCode).toBe(404);
});

it("paginates only eligible Contracts with no repeated rows or hidden record cursor", async () => {
  const seed = await create("Pagination seed");
  const [row] = await harness.db.select().from(contracts).where(eq(contracts.id, seed.id));
  const ids: number[] = [];
  for (let index = 0; index < 27; index++) {
    const [inserted] = await harness.db
      .insert(contracts)
      .values({
        title: `Page contract ${index}`,
        contractTypeId: row!.contractTypeId,
        statusId: row!.statusId,
        businessOwnerId: person("outsider").id,
      })
      .returning({ number: contracts.number });
    ids.push(inserted!.number);
    await add(inserted!.number, "outsider");
  }
  await create("Hidden newest Contract");
  const first = await harness.app.inject({
    method: "GET",
    url: "/api/v1/portal/contracts",
    cookies: person("outsider").cookies,
  });
  expect(first.json().contracts).toHaveLength(25);
  const next = await harness.app.inject({
    method: "GET",
    url: `/api/v1/portal/contracts?cursor=${first.json().nextCursor}`,
    cookies: person("outsider").cookies,
  });
  expect(next.json().contracts).toHaveLength(2);
  expect(next.json().nextCursor).toBeNull();
  expect(
    [...first.json().contracts, ...next.json().contracts].map(
      (row: { number: number }) => row.number,
    ),
  ).toEqual(ids.reverse());
});
