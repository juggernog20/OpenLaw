// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { entities, entityTypes, eq, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "entity-paper@example.com",
  displayName: "Entity Paper",
  password: "correct-horse-battery",
} as const;
const BOUNDARY = "entity-paper-boundary";
let harness: TestHarness;
let cookies: Record<string, string>;
let adminCookies: Record<string, string>;
let memberId: string;
let entityId: string;

function form(filename: string, folderPath?: string) {
  const field = (name: string, value: string) =>
    Buffer.from(
      `--${BOUNDARY}\r\ncontent-disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    );
  return {
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
    payload: Buffer.concat([
      field("kind", "executed"),
      ...(folderPath ? [field("folderPath", folderPath)] : []),
      Buffer.from(
        `--${BOUNDARY}\r\ncontent-disposition: form-data; name="file"; filename="${filename}"\r\ncontent-type: application/pdf\r\n\r\n%PDF entity paper\r\n--${BOUNDARY}--\r\n`,
      ),
    ]),
  };
}

beforeAll(async () => {
  harness = await startHarness();
  await harness.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  const member = await provisionUser(harness.app.auth, MEMBER);
  memberId = member.id;
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, member.id));
  cookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
  adminCookies = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
  const [type] = await harness.db.select({ id: entityTypes.id }).from(entityTypes).limit(1);
  const [entity] = await harness.db
    .insert(entities)
    .values({ legalName: "Entity Paper Ltd", entityTypeId: type!.id })
    .returning({ id: entities.id });
  entityId = entity!.id;
});

afterAll(async () => harness.stop());

describe("Entity-owned Documents", () => {
  it("files a dropped folder path, appends a version, and answers the Entity owner in the repository and in search", async () => {
    const created = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entities/${entityId}/documents`,
      cookies,
      ...form("annual-return.pdf", "Filings/2026"),
    });
    expect(created.statusCode, created.body).toBe(201);
    const document = created.json().document as { id: string; versions: unknown[] };
    expect(document.versions).toHaveLength(1);

    const version = await harness.app.inject({
      method: "POST",
      url: `/api/v1/documents/${document.id}/versions`,
      cookies,
      ...form("annual-return-v2.pdf"),
    });
    expect(version.statusCode, version.body).toBe(201);
    expect(version.json().document.versions).toHaveLength(2);

    const folders = await harness.app.inject({
      method: "GET",
      url: `/api/v1/entities/${entityId}/folders`,
      cookies,
    });
    expect(folders.json().folders.map((row: { name: string }) => row.name)).toEqual([
      "2026",
      "Filings",
    ]);

    const repository = await harness.app.inject({
      method: "GET",
      url: `/api/v1/documents?owner=entity&record=${entityId}`,
      cookies,
    });
    expect(repository.statusCode, repository.body).toBe(200);
    expect(repository.json().documents[0].owner).toMatchObject({
      kind: "entity",
      id: entityId,
      reference: "Entity Paper Ltd",
    });

    const search = await harness.app.inject({
      method: "GET",
      url: "/api/v1/search?q=annual",
      cookies,
    });
    const hit = search.json().results.find((row: { kind: string }) => row.kind === "document");
    expect(hit).toMatchObject({ kind: "document", ownerKind: "entity", ownerId: entityId });
  });

  it("hides a confidential Entity's paper from the repository and the owner options", async () => {
    const sealed = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/entities/${entityId}`,
      cookies: adminCookies,
      payload: { isConfidential: true },
    });
    expect(sealed.statusCode, sealed.body).toBe(200);
    const walledRepository = await harness.app.inject({
      method: "GET",
      url: "/api/v1/documents",
      cookies,
    });
    expect(walledRepository.body).not.toContain("Entity Paper Ltd");
    expect(walledRepository.json().documents).toEqual([]);
    const walledOptions = await harness.app.inject({
      method: "GET",
      url: "/api/v1/documents/options",
      cookies,
    });
    expect(walledOptions.body).not.toContain("Entity Paper Ltd");
    expect(walledOptions.json().records).toEqual([]);
  });

  it("restores a granted reader's access to a confidential Entity's paper", async () => {
    const granted = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entities/${entityId}/grants`,
      cookies: adminCookies,
      payload: { userId: memberId },
    });
    expect(granted.statusCode, granted.body).toBe(201);
    const reachedAgain = await harness.app.inject({
      method: "GET",
      url: "/api/v1/documents",
      cookies,
    });
    expect(reachedAgain.json().documents[0].owner.reference).toBe("Entity Paper Ltd");
  });
});
