// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contracts, eq, matters, notifications, requests, requestTypes, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

let harness: TestHarness;
let admin: Record<string, string>;
let business: Record<string, string>;
let businessId: string;
let contractTypeId: string;
let matterTypeId: string;

beforeAll(async () => {
  harness = await startHarness();
  await harness.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  admin = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
  const fixture = {
    email: "record-team@example.com",
    displayName: "Business colleague",
    password: "correct-horse-battery",
  };
  const person = await provisionUser(harness.app.auth, fixture);
  businessId = person.id;
  await harness.db.update(users).set({ role: "business_user" }).where(eq(users.id, businessId));
  business = await signInCookies(harness.app, fixture.email, fixture.password);
  const options = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: admin,
  });
  contractTypeId = options.json().contractTypes[0].id;
  const matterOptions = await harness.app.inject({
    method: "GET",
    url: "/api/v1/matters/options",
    cookies: admin,
  });
  matterTypeId = matterOptions.json().matterTypes[0].id;
});
afterAll(async () => harness?.stop());

async function create(module: "contract" | "matter" = "contract") {
  const response = await harness.app.inject({
    method: "POST",
    url: `/api/v1/${module}s`,
    cookies: admin,
    payload: {
      title: "Team work",
      ...(module === "contract" ? { contractTypeId } : { matterTypeId }),
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json()[module] as { id: string; number: number };
}

function upload(url: string, cookies = business) {
  const boundary = "portal-work-upload";
  return harness.app.inject({
    method: "POST",
    url,
    cookies,
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.from(
      `--${boundary}\r\ncontent-disposition: form-data; name="kind"\r\n\r\ngeneral\r\n--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="support.txt"\r\ncontent-type: text/plain\r\n\r\nBusiness support\r\n--${boundary}--\r\n`,
    ),
  });
}

describe("DD-023 record membership", () => {
  it("uses one row as the Portal grant, independently of Business Owner assignment", async () => {
    const record = await create();
    const path = `/api/v1/contracts/${record.number}`;
    const portal = () =>
      harness.app.inject({
        method: "GET",
        url: `/api/v1/portal/contracts/${record.number}`,
        cookies: business,
      });
    await harness.app.inject({
      method: "PATCH",
      url: path,
      cookies: admin,
      payload: { businessOwnerId: businessId },
    });
    expect((await portal()).statusCode).toBe(404);
    const added = await harness.app.inject({
      method: "POST",
      url: `${path}/team`,
      cookies: admin,
      payload: { userId: businessId },
    });
    expect(added.statusCode, added.body).toBe(201);
    expect(
      added.json().team.filter((person: { id: string }) => person.id === businessId),
    ).toHaveLength(1);
    expect(added.json().team.every((person: object) => !("role" in person))).toBe(true);
    expect((await portal()).statusCode).toBe(200);
    const duplicate = await harness.app.inject({
      method: "POST",
      url: `${path}/team`,
      cookies: admin,
      payload: { userId: businessId },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(
      (await harness.app.inject({ method: "GET", url: path, cookies: business })).statusCode,
    ).toBe(403);
    const removed = await harness.app.inject({
      method: "DELETE",
      url: `${path}/team/${businessId}`,
      cookies: admin,
    });
    expect(removed.statusCode, removed.body).toBe(200);
    expect((await portal()).statusCode).toBe(404);
  });

  it("admits team Business Users to Full Thread and revokes the whole thread with membership", async () => {
    const record = await create();
    await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${record.number}/team`,
      cookies: admin,
      payload: { userId: businessId },
    });
    for (const visibility of ["legal_only", "working_team", "full_thread"]) {
      const response = await harness.app.inject({
        method: "POST",
        url: "/api/v1/comments",
        cookies: admin,
        payload: {
          entityType: "contract",
          entityId: record.id,
          visibility,
          body: `${visibility} discussion`,
        },
      });
      expect(response.statusCode, response.body).toBe(201);
    }
    const read = () =>
      harness.app.inject({
        method: "GET",
        url: `/api/v1/comments?entityType=contract&entityId=${record.id}`,
        cookies: business,
      });
    const visible = await read();
    expect(visible.statusCode, visible.body).toBe(200);
    expect(visible.body).toContain("full_thread discussion");
    expect(visible.body).not.toContain("working_team discussion");
    expect(visible.body).not.toContain("legal_only discussion");
    for (const visibility of ["legal_only", "working_team", "full_thread"]) {
      const response = await harness.app.inject({
        method: "POST",
        url: "/api/v1/comments",
        cookies: business,
        payload: {
          entityType: "contract",
          entityId: record.id,
          visibility,
          body: "Business reply",
        },
      });
      expect(response.statusCode, response.body).toBe(visibility === "full_thread" ? 201 : 403);
    }
    await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/contracts/${record.number}/team/${businessId}`,
      cookies: admin,
    });
    expect((await read()).statusCode).toBe(404);
  });
});

describe.each(["contract", "matter"] as const)("DD-023 Portal %s work", (module) => {
  it("projects business Fields, validates writes, and revokes every write with membership", async () => {
    const record = await create(module);
    const staff = `/api/v1/${module}s/${record.number}`;
    const path = `/api/v1/portal/${module}s/${record.number}/work`;
    const slugs: string[] = [];
    for (const fieldTag of ["business", "legal"]) {
      const field = await harness.app.inject({
        method: "POST",
        url: "/api/v1/fields",
        cookies: admin,
        payload: {
          displayName: `${module} ${fieldTag} value`,
          moduleScope: module,
          fieldTag,
          fieldType: "number",
        },
      });
      expect(field.statusCode, field.body).toBe(201);
      slugs.push(field.json().field.slug);
      const attach = await harness.app.inject({
        method: "POST",
        url: `/api/v1/${module}-types/${module === "contract" ? contractTypeId : matterTypeId}/fields`,
        cookies: admin,
        payload: { fieldId: field.json().field.id },
      });
      expect(attach.statusCode, attach.body).toBe(201);
    }
    await harness.app.inject({
      method: "PATCH",
      url: staff,
      cookies: admin,
      payload: { customFields: { [slugs[1]!]: 998 } },
    });
    await harness.app.inject({
      method: "POST",
      url: `${staff}/team`,
      cookies: admin,
      payload: { userId: businessId },
    });
    const read = await harness.app.inject({ method: "GET", url: path, cookies: business });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.body).not.toContain(slugs[1]!);
    const saved = await harness.app.inject({
      method: "PATCH",
      url: path,
      cookies: business,
      payload: { description: "Updated business context", customFields: { [slugs[0]!]: 42 } },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({
      description: "Updated business context",
      customFields: { [slugs[0]!]: 42 },
    });
    for (const payload of [
      { customFields: { [slugs[1]!]: 7 } },
      { statusId: "legal-change" },
      { customFields: { [slugs[0]!]: "wrong" } },
    ]) {
      const refused = await harness.app.inject({
        method: "PATCH",
        url: path,
        cookies: business,
        payload,
      });
      expect([400, 403]).toContain(refused.statusCode);
    }
    const stored = await harness.app.inject({ method: "GET", url: staff, cookies: admin });
    expect(stored.json()[module].customFields[slugs[1]!]).toBe(998);
    await harness.app.inject({
      method: "DELETE",
      url: `${staff}/team/${businessId}`,
      cookies: admin,
    });
    expect(
      (
        await harness.app.inject({
          method: "PATCH",
          url: path,
          cookies: business,
          payload: { description: "Revoked" },
        })
      ).statusCode,
    ).toBe(404);
  });

  it("uploads supporting Documents and versions without gaining the primary or repository", async () => {
    const record = await create(module);
    const staff = `/api/v1/${module}s/${record.number}`;
    await harness.app.inject({
      method: "POST",
      url: `${staff}/team`,
      cookies: admin,
      payload: { userId: businessId },
    });
    const added = await upload(`${staff}/documents`);
    expect(added.statusCode, added.body).toBe(201);
    const documentId = added.json().document.id;
    const version = await upload(`/api/v1/documents/${documentId}/versions`);
    expect(version.statusCode, version.body).toBe(201);
    const listed = await harness.app.inject({
      method: "GET",
      url: `/api/v1/portal/${module}s/${record.number}/supporting-documents`,
      cookies: business,
    });
    expect(listed.statusCode, listed.body).toBe(200);
    const document = listed.json().documents[0];
    expect(document.version.versionNumber).toBe(2);
    const bytes = `/api/v1/documents/${document.id}/versions/${document.version.id}/download`;
    expect(
      (await harness.app.inject({ method: "GET", url: bytes, cookies: business })).statusCode,
    ).toBe(200);
    expect(
      (await harness.app.inject({ method: "GET", url: "/api/v1/documents", cookies: business }))
        .statusCode,
    ).toBe(403);
    if (module === "contract") {
      const [stored] = await harness.db.select().from(contracts).where(eq(contracts.id, record.id));
      expect(stored!.primaryDocumentId).toBeNull();
      await harness.db
        .update(contracts)
        .set({ primaryDocumentId: documentId })
        .where(eq(contracts.id, record.id));
      expect((await upload(`/api/v1/documents/${documentId}/versions`)).statusCode).toBe(403);
      expect(
        (await harness.app.inject({ method: "GET", url: bytes, cookies: business })).statusCode,
      ).toBe(404);
    }
    await harness.app.inject({
      method: "DELETE",
      url: `${staff}/team/${businessId}`,
      cookies: admin,
    });
    expect((await upload(`${staff}/documents`)).statusCode).toBe(404);
    expect(
      (await harness.app.inject({ method: "GET", url: bytes, cookies: business })).statusCode,
    ).toBe(404);
  });

  it("removes record news and old Request notifications from both the bell and count after revocation", async () => {
    const record = await create(module);
    const staff = `/api/v1/${module}s/${record.number}`;
    await harness.app.inject({
      method: "POST",
      url: `${staff}/team`,
      cookies: admin,
      payload: { userId: businessId },
    });
    const posted = await harness.app.inject({
      method: "POST",
      url: "/api/v1/comments",
      cookies: admin,
      payload: {
        entityType: module,
        entityId: record.id,
        body: "Business update",
        visibility: "full_thread",
      },
    });
    expect(posted.statusCode, posted.body).toBe(201);
    const [type] = await harness.db.select().from(requestTypes).limit(1);
    const [original] = await harness.db
      .insert(requests)
      .values({
        requesterId: businessId,
        requestTypeId: type!.id,
        summary: "Original ask",
        urgency: "medium",
        status: "converted",
        ...(module === "contract"
          ? { convertedContractId: record.id }
          : { convertedMatterId: record.id }),
      })
      .returning();
    const [old] = await harness.db
      .insert(notifications)
      .values({
        userId: businessId,
        entityType: "request",
        entityId: original!.id,
        eventType: "request.status_changed",
        payload: { requestNumber: original!.number },
      })
      .returning();
    const [legalTask] = await harness.db
      .insert(notifications)
      .values({
        userId: businessId,
        entityType: module,
        entityId: record.id,
        eventType: `${module}.task_assigned`,
        payload: { taskTitle: "Legacy legal task" },
      })
      .returning();
    const bell = async () => {
      const response = await harness.app.inject({
        method: "GET",
        url: "/api/v1/portal/notifications",
        cookies: business,
      });
      expect(response.statusCode, response.body).toBe(200);
      return response.json().notifications as { id: string; entityId: string }[];
    };
    const count = async () =>
      (
        await harness.app.inject({
          method: "GET",
          url: "/api/v1/portal/notifications/unread-count",
          cookies: business,
        })
      ).json().unread as number;
    const staffBell = await harness.app.inject({
      method: "GET",
      url: "/api/v1/notifications",
      cookies: business,
    });
    expect(staffBell.statusCode, staffBell.body).toBe(403);
    const before = await bell();
    expect(before.map((row) => row.id)).toContain(old!.id);
    expect(before.map((row) => row.id)).not.toContain(legalTask!.id);
    expect(before.some((row) => row.entityId === record.id)).toBe(true);
    const unreadBefore = await count();
    const removedCount = before.filter((row) =>
      [record.id, original!.id].includes(row.entityId),
    ).length;
    await harness.app.inject({
      method: "DELETE",
      url: `${staff}/team/${businessId}`,
      cookies: admin,
    });
    const after = await bell();
    expect(after.some((row) => [record.id, original!.id].includes(row.entityId))).toBe(false);
    expect(await count()).toBe(unreadBefore - removedCount);
  });

  it("redirects converted Requests through the team grant and keeps only the original ask after archival", async () => {
    const record = await create(module);
    const staff = `/api/v1/${module}s/${record.number}`;
    const [type] = await harness.db.select().from(requestTypes).limit(1);
    const [request] = await harness.db
      .insert(requests)
      .values({
        requesterId: businessId,
        requestTypeId: type!.id,
        summary: "Original business ask",
        description: "Submission remains unchanged",
        urgency: "medium",
        status: "converted",
        ...(module === "contract"
          ? { convertedContractId: record.id }
          : { convertedMatterId: record.id }),
      })
      .returning();
    await harness.app.inject({
      method: "POST",
      url: `${staff}/team`,
      cookies: admin,
      payload: { userId: businessId },
    });
    const requestPath = `/api/v1/portal/requests/${request!.number}`;
    const read = await harness.app.inject({ method: "GET", url: requestPath, cookies: business });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json().redirectTo).toEqual({ module, number: record.number });
    const work = await harness.app.inject({
      method: "GET",
      url: `/api/v1/portal/${module}s/${record.number}/work`,
      cookies: business,
    });
    expect(work.json().work.originalRequests).toEqual([
      expect.objectContaining({
        summary: "Original business ask",
        description: "Submission remains unchanged",
      }),
    ]);
    const list = await harness.app.inject({
      method: "GET",
      url: "/api/v1/portal/requests",
      cookies: business,
    });
    expect(list.json().requests.some((row: { id: string }) => row.id === request!.id)).toBe(false);
    await harness.app.inject({
      method: "DELETE",
      url: `${staff}/team/${businessId}`,
      cookies: admin,
    });
    expect(
      (await harness.app.inject({ method: "GET", url: requestPath, cookies: business })).statusCode,
    ).toBe(404);
    expect(
      (
        await harness.app.inject({
          method: "GET",
          url: `/api/v1/comments?entityType=request&entityId=${request!.id}`,
          cookies: business,
        })
      ).statusCode,
    ).toBe(404);
    const table = module === "contract" ? contracts : matters;
    await harness.db.update(table).set({ archivedAt: new Date() }).where(eq(table.id, record.id));
    const archived = await harness.app.inject({
      method: "GET",
      url: requestPath,
      cookies: business,
    });
    expect(archived.statusCode, archived.body).toBe(200);
    expect(archived.json()).toMatchObject({
      redirectTo: null,
      recordArchived: true,
      attachments: [],
    });
    expect(
      (
        await harness.app.inject({
          method: "GET",
          url: `/api/v1/portal/${module}s/${record.number}/work`,
          cookies: business,
        })
      ).statusCode,
    ).toBe(404);
  });
});
