// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contractTypes, entityTypes, eq, matterTypes, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const COUNSEL = {
  email: "private-counsel@example.com",
  displayName: "Private Counsel",
  password: "correct-horse-battery",
};
let harness: TestHarness;
let admin: Record<string, string>;
let counsel: Record<string, string>;
let adminId: string;

beforeAll(async () => {
  harness = await startHarness();
  expect(
    (await harness.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN }))
      .statusCode,
  ).toBe(201);
  admin = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
  adminId = (await harness.db.select().from(users).where(eq(users.email, TEST_ADMIN.email)))[0]!.id;
  const person = await provisionUser(harness.app.auth, COUNSEL);
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, person.id));
  counsel = await signInCookies(harness.app, COUNSEL.email, COUNSEL.password);
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

type Kind = "contract" | "matter" | "entity";
async function create(kind: Kind, title: string) {
  const types =
    kind === "contract"
      ? await harness.db.select().from(contractTypes)
      : kind === "matter"
        ? await harness.db.select().from(matterTypes)
        : await harness.db.select().from(entityTypes);
  const payload =
    kind === "entity"
      ? { legalName: title, entityTypeId: types[0]!.id }
      : { title, [`${kind}TypeId`]: types[0]!.id };
  const response = await harness.app.inject({
    method: "POST",
    url: `/api/v1/${kind === "entity" ? "entities" : `${kind}s`}`,
    cookies: counsel,
    payload,
  });
  expect(response.statusCode, response.body).toBe(201);
  const record = response.json()[kind] as { id: string; number?: number };
  const path = `/api/v1/${kind === "entity" ? "entities" : `${kind}s`}/${record.number ?? record.id}`;
  return { ...record, path };
}

async function upload(path: string) {
  const boundary = "private-file-boundary";
  const response = await harness.app.inject({
    method: "POST",
    url: `${path}/documents`,
    cookies: counsel,
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.from(
      `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="private.pdf"\r\ncontent-type: application/pdf\r\n\r\n%PDF-1.7\r\n--${boundary}--\r\n`,
    ),
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().document as { id: string; versions: { id: string }[] };
}

describe("administration does not grant confidential access", () => {
  it.each(["contract", "matter", "entity"] as const)(
    "gates %s reads, writes, discovery and audit; grants and revocation apply immediately",
    async (kind) => {
      const title = `Restricted ${kind} audience`;
      const record = await create(kind, title);
      const document = await upload(record.path);
      const changed = await harness.app.inject({
        method: "PATCH",
        url: record.path,
        cookies: counsel,
        payload: { isConfidential: true },
      });
      expect(changed.statusCode, changed.body).toBe(200);
      if (kind === "entity") {
        const person = (
          await harness.db.select().from(users).where(eq(users.email, COUNSEL.email))
        )[0]!;
        const removal = await harness.app.inject({
          method: "DELETE",
          url: `${record.path}/grants/${person.id}`,
          cookies: counsel,
        });
        expect(removal.statusCode, removal.body).toBe(409);
      }
      const get = (url: string) => harness.app.inject({ method: "GET", url, cookies: admin });
      for (const url of [
        record.path,
        `${record.path}/documents`,
        `/api/v1/activity?entityType=${kind}&entityId=${record.id}`,
        `/api/v1/documents/${document.id}/versions/${document.versions[0]!.id}/download`,
      ]) {
        const response = await get(url);
        expect(response.statusCode, `${url}: ${response.body}`).toBe(404);
      }
      for (const url of [
        `/api/v1/${kind === "entity" ? "entities" : `${kind}s`}`,
        "/api/v1/documents?limit=100",
        `/api/v1/search?q=Restricted`,
        `/api/v1/audit-log?q=${record.id}`,
        `/api/v1/audit-log/export?q=${record.id}`,
      ]) {
        const response = await get(url);
        expect(response.statusCode, response.body).toBe(200);
        expect(response.body).not.toContain(title);
      }
      if (kind !== "entity") {
        for (const suffix of ["", "/unread", "/mention-candidates"]) {
          expect(
            (await get(`/api/v1/comments${suffix}?entityType=${kind}&entityId=${record.id}`))
              .statusCode,
          ).toBe(404);
        }
        const candidates = await harness.app.inject({
          method: "GET",
          url: `/api/v1/comments/mention-candidates?entityType=${kind}&entityId=${record.id}`,
          cookies: counsel,
        });
        expect(candidates.statusCode, candidates.body).toBe(200);
        expect(
          candidates.json().candidates.map((person: { id: string }) => person.id),
        ).not.toContain(adminId);
      }
      const history = await harness.app.inject({
        method: "GET",
        url: `/api/v1/activity?entityType=${kind}&entityId=${record.id}`,
        cookies: counsel,
      });
      expect(history.statusCode, history.body).toBe(200);
      const hiddenCursor = history.json().entries[0].id as string;
      const auditPage = await get(`/api/v1/audit-log?cursor=${hiddenCursor}`);
      expect(auditPage.statusCode, auditPage.body).toBe(200);
      expect(auditPage.json().entries).toEqual([]);
      const patch = await harness.app.inject({
        method: "PATCH",
        url: record.path,
        cookies: admin,
        payload: { isConfidential: false },
      });
      expect(patch.statusCode, patch.body).toBe(404);
      const grantUrl = `${record.path}/${kind === "entity" ? "grants" : "team"}`;
      const payload = kind === "entity" ? { userId: adminId } : { userId: adminId, role: "member" };
      expect(
        (await harness.app.inject({ method: "POST", url: grantUrl, cookies: admin, payload }))
          .statusCode,
      ).toBe(404);
      const granted = await harness.app.inject({
        method: "POST",
        url: grantUrl,
        cookies: counsel,
        payload,
      });
      expect(granted.statusCode, granted.body).toBe(201);
      expect((await get(record.path)).statusCode).toBe(200);
      expect((await get(`/api/v1/audit-log?q=${record.id}`)).body).toContain(title);
      const removed = await harness.app.inject({
        method: "DELETE",
        url: `${grantUrl}/${adminId}${kind === "entity" ? "" : "/member"}`,
        cookies: counsel,
      });
      expect(removed.statusCode, removed.body).toBe(kind === "entity" ? 204 : 200);
      expect((await get(record.path)).statusCode).toBe(404);
      if (kind !== "entity") {
        const managed = await harness.app.inject({
          method: "PATCH",
          url: record.path,
          cookies: counsel,
          payload: { managerId: adminId },
        });
        expect(managed.statusCode, managed.body).toBe(200);
        expect((await get(record.path)).statusCode).toBe(200);
      }
    },
  );

  it.each(["contract", "matter"] as const)(
    "also protects a confidential file on an open %s",
    async (kind) => {
      const record = await create(kind, `Open ${kind} with confidential paper`);
      const document = await upload(record.path);
      const response = await harness.app.inject({
        method: "PATCH",
        url: `/api/v1/documents/${document.id}`,
        cookies: counsel,
        payload: { isConfidential: true },
      });
      expect(response.statusCode, response.body).toBe(200);
      const list = await harness.app.inject({
        method: "GET",
        url: `${record.path}/documents`,
        cookies: admin,
      });
      expect(list.statusCode, list.body).toBe(200);
      expect(list.body).not.toContain(document.id);
      const download = await harness.app.inject({
        method: "GET",
        url: `/api/v1/documents/${document.id}/versions/${document.versions[0]!.id}/download`,
        cookies: admin,
      });
      expect(download.statusCode, download.body).toBe(404);
      const audit = await harness.app.inject({
        method: "GET",
        url: `/api/v1/audit-log?q=${document.id}`,
        cookies: admin,
      });
      expect(audit.statusCode, audit.body).toBe(200);
      expect(audit.json().entries).toEqual([]);
    },
  );
});
