// SPDX-License-Identifier: AGPL-3.0-only

import { saveFieldRow } from "../../testing/form-fixtures.js";

import { regions } from "@openlaw/db";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  and,
  contractTeam,
  contractTypeFields,
  matterTypeFields,
  matterTeam,
  sql,
  contracts,
  departments,
  documents,
  eq,
  matters,
  notifications,
  requests,
  requestTypes,
  users,
} from "@openlaw/db";
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
  await harness.db.insert(regions).values([
    { slug: "emea", displayName: "EMEA", displayOrder: 1 },
    { slug: "americas", displayName: "Americas", displayOrder: 2 },
  ]);
  await harness.db.insert(departments).values({
    id: "dept-procurement",
    slug: "procurement",
    displayName: "Procurement",
    displayOrder: 1,
  });
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

function upload(url: string, cookies = business, portal = false) {
  const boundary = "portal-work-upload";
  return harness.app.inject({
    method: "POST",
    url,
    cookies,
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      ...(portal ? { "x-openlaw-surface": "portal" } : {}),
    },
    payload: Buffer.from(
      `--${boundary}\r\ncontent-disposition: form-data; name="kind"\r\n\r\ngeneral\r\n--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="support.txt"\r\ncontent-type: text/plain\r\n\r\nBusiness support\r\n--${boundary}--\r\n`,
    ),
  });
}

describe("DD-023 record membership", () => {
  it.each(["contract", "matter"] as const)(
    "adds the Business Owner to the %s team and keeps membership until explicitly removed",
    async (module) => {
      const record = await create(module);
      const path = `/api/v1/${module}s/${record.number}`;
      const portal = () =>
        harness.app.inject({
          method: "GET",
          url: `/api/v1/portal/${module}s/${record.number}`,
          cookies: business,
        });
      expect((await portal()).statusCode).toBe(404);
      const assign = () =>
        harness.app.inject({
          method: "PATCH",
          url: path,
          cookies: admin,
          payload: { businessOwnerId: businessId },
        });
      const assigned = await assign();
      expect(assigned.statusCode, assigned.body).toBe(200);
      const detail = await harness.app.inject({ method: "GET", url: path, cookies: admin });
      expect(detail.statusCode, detail.body).toBe(200);
      expect(
        detail.json().team.filter((person: { id: string }) => person.id === businessId),
      ).toHaveLength(1);
      expect((await portal()).statusCode).toBe(200);
      expect((await assign()).statusCode).toBe(200);
      const additions = await harness.db
        .select()
        .from(activityLog)
        .where(
          and(eq(activityLog.entityId, record.id), eq(activityLog.action, `${module}.team_added`)),
        );
      expect(additions).toHaveLength(1);
      const remove = () =>
        harness.app.inject({
          method: "DELETE",
          url: `${path}/team/${businessId}`,
          cookies: admin,
        });
      expect((await remove()).statusCode).toBe(409);
      expect((await portal()).statusCode).toBe(200);
      const cleared = await harness.app.inject({
        method: "PATCH",
        url: path,
        cookies: admin,
        payload: { businessOwnerId: null },
      });
      expect(cleared.statusCode, cleared.body).toBe(200);
      expect((await portal()).statusCode).toBe(200);
      expect((await remove()).statusCode).toBe(200);
      expect((await portal()).statusCode).toBe(404);
    },
  );

  it.each(["contract", "matter"] as const)(
    "requires Confidential audience permission when assigning the %s Business Owner",
    async (module) => {
      const fixture = {
        email: `owner-writer-${module}@example.com`,
        displayName: "Legal colleague",
        password: "correct-horse-battery",
      };
      const person = await provisionUser(harness.app.auth, fixture);
      await harness.db
        .update(users)
        .set({ role: "legal_team_member" })
        .where(eq(users.id, person.id));
      const colleague = await signInCookies(harness.app, fixture.email, fixture.password);
      const record = await create(module);
      const path = `/api/v1/${module}s/${record.number}`;
      expect(
        (
          await harness.app.inject({
            method: "PATCH",
            url: path,
            cookies: admin,
            payload: { isConfidential: true },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await harness.app.inject({
            method: "POST",
            url: `${path}/team`,
            cookies: admin,
            payload: { userId: person.id },
          })
        ).statusCode,
      ).toBe(201);
      const refused = await harness.app.inject({
        method: "PATCH",
        url: path,
        cookies: colleague,
        payload: { businessOwnerId: businessId },
      });
      expect(refused.statusCode, refused.body).toBe(403);
      const portal = () =>
        harness.app.inject({
          method: "GET",
          url: `/api/v1/portal/${module}s/${record.number}`,
          cookies: business,
        });
      expect((await portal()).statusCode).toBe(404);
      const assigned = await harness.app.inject({
        method: "PATCH",
        url: path,
        cookies: admin,
        payload: { businessOwnerId: businessId },
      });
      expect(assigned.statusCode, assigned.body).toBe(200);
      expect((await portal()).statusCode).toBe(200);
    },
  );

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
  it("reads Legal's record values and refuses all Portal Field writes", async () => {
    const record = await create(module);
    const staff = `/api/v1/${module}s/${record.number}`;
    const path = `/api/v1/portal/${module}s/${record.number}/work`;
    const slugs: string[] = [];
    for (const visibleOnPortal of [true, false]) {
      const field = await harness.app.inject({
        method: "POST",
        url: "/api/v1/fields",
        cookies: admin,
        payload: {
          displayName: `${module} ${visibleOnPortal ? "visible" : "hidden"} value`,
          moduleScope: module,
          fieldType: "number",
        },
      });
      expect(field.statusCode, field.body).toBe(201);
      slugs.push(field.json().field.slug);
      const attach = await saveFieldRow(harness, {
        typeUrl: `/api/v1/${module}-types/${module === "contract" ? contractTypeId : matterTypeId}`,
        cookies: admin,
        payload: { fieldId: field.json().field.id },
      });
      expect(attach.statusCode, attach.body).toBe(200);
      const join = module === "contract" ? contractTypeFields : matterTypeFields;
      await harness.db
        .update(join)
        .set({ visibleOnPortal })
        .where(eq(join.fieldId, field.json().field.id));
    }
    const edit = await harness.app.inject({
      method: "PATCH",
      url: staff,
      cookies: admin,
      payload: {
        description: "Legal's current context",
        customFields: { [slugs[0]!]: 42, [slugs[1]!]: 998 },
        ...(module === "contract"
          ? {
              owningDepartmentId: "dept-procurement",
              region: "EMEA",
              effectiveDate: "2026-09-01",
              value: { amount: 10000, currency: "USD", cadence: "one_time" },
            }
          : {}),
      },
    });
    expect(edit.statusCode, edit.body).toBe(200);
    await harness.app.inject({
      method: "POST",
      url: `${staff}/team`,
      cookies: admin,
      payload: { userId: businessId },
    });
    const read = await harness.app.inject({ method: "GET", url: path, cookies: business });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json().work).toMatchObject({
      description: "Legal's current context",
      customFields: { [slugs[0]!]: 42 },
    });
    expect(read.body).not.toContain(slugs[1]!);
    if (module === "contract")
      expect(read.json().work).toMatchObject({ owningDepartment: "Procurement", region: "EMEA" });
    const table = module === "contract" ? contracts : matters;
    const [before] = await harness.db.select().from(table).where(eq(table.id, record.id));
    for (const payload of [
      { description: "Changed" },
      { customFields: { [slugs[0]!]: 7 } },
      { customFields: { [slugs[1]!]: 7 } },
      { owningDepartment: "Changed" },
      { region: "Changed" },
      { effectiveDate: "2027-01-01" },
      { value: { amount: 1, currency: "USD", cadence: "one_time" } },
      { title: "Changed" },
    ]) {
      for (const cookies of [business, admin]) {
        const refused = await harness.app.inject({ method: "PATCH", url: path, cookies, payload });
        expect(refused.statusCode, refused.body).toBe(404);
      }
      const refused = await harness.app.inject({
        method: "PATCH",
        url: staff,
        cookies: business,
        payload,
      });
      expect([400, 403], refused.body).toContain(refused.statusCode);
    }
    const [after] = await harness.db.select().from(table).where(eq(table.id, record.id));
    expect(after).toEqual(before);
    await harness.app.inject({
      method: "PATCH",
      url: staff,
      cookies: admin,
      payload: {
        description: "Updated by Legal",
        ...(module === "contract" ? { owningDepartmentId: null, region: "Americas" } : {}),
      },
    });
    const updated = await harness.app.inject({ method: "GET", url: path, cookies: business });
    expect(updated.json().work.description).toBe("Updated by Legal");
    if (module === "contract")
      expect(updated.json().work).toMatchObject({ owningDepartment: null, region: "Americas" });
    await harness.app.inject({
      method: "DELETE",
      url: `${staff}/team/${businessId}`,
      cookies: admin,
    });
    expect(
      (await harness.app.inject({ method: "GET", url: path, cookies: business })).statusCode,
    ).toBe(404);
  });

  it("uploads Documents and versions without gaining primary designation or the repository", async () => {
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
      url: `/api/v1/portal/${module}s/${record.number}/documents`,
      cookies: business,
    });
    expect(listed.statusCode, listed.body).toBe(200);
    const document = listed.json().documents[0];
    expect(document.versions[0].versionNumber).toBe(2);
    const bytes = `/api/v1/documents/${document.id}/versions/${document.versions[0].id}/download`;
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
      expect((await upload(`/api/v1/documents/${documentId}/versions`)).statusCode).toBe(201);
      expect(
        (await harness.app.inject({ method: "GET", url: bytes, cookies: business })).statusCode,
      ).toBe(200);
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

  it("lists one document with its complete version history and withdraws it with record access", async () => {
    const record = await create(module);
    const staff = `/api/v1/${module}s/${record.number}`;
    await harness.app.inject({
      method: "POST",
      url: `${staff}/team`,
      cookies: admin,
      payload: { userId: businessId },
    });
    const first = await upload(`${staff}/documents`, admin);
    expect(first.statusCode, first.body).toBe(201);
    const document = first.json().document;
    expect((await upload(`/api/v1/documents/${document.id}/versions`)).statusCode).toBe(201);
    const path = `/api/v1/portal/${module}s/${record.number}/documents`;
    const listed = await harness.app.inject({ method: "GET", url: path, cookies: business });
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.headers["cache-control"]).toBe("private, no-store");
    expect(listed.json().documents).toHaveLength(1);
    expect(listed.json().documents[0]).toMatchObject({
      id: document.id,
      isPrimary: module === "contract",
      versions: [
        { versionNumber: 2, isCurrent: true, uploadedBy: { displayName: "Business colleague" } },
        { versionNumber: 1, isCurrent: false },
      ],
    });
    expect(JSON.stringify(listed.json())).not.toContain("fileRef");
    expect(JSON.stringify(listed.json())).not.toContain("email");
    const absent = await harness.app.inject({
      method: "GET",
      url: `${path}?q=absent`,
      cookies: business,
    });
    expect(absent.json().documents).toEqual([]);
    const other = await create(module);
    const otherFile = await upload(`/api/v1/${module}s/${other.number}/documents`, admin);
    const forged = await harness.app.inject({
      method: "GET",
      url: `${path}?cursor=${otherFile.json().document.id}`,
      cookies: business,
    });
    expect(forged.json()).toEqual({ documents: [], nextCursor: null });
    await harness.app.inject({
      method: "DELETE",
      url: `${staff}/team/${businessId}`,
      cookies: admin,
    });
    expect(
      (await harness.app.inject({ method: "GET", url: path, cookies: business })).statusCode,
    ).toBe(404);
    expect((await upload(`/api/v1/documents/${document.id}/versions`)).statusCode).toBe(404);
  });

  it("keeps staff uploads in the Portal inside the Business User permission grid", async () => {
    const record = await create(module);
    const path = `/api/v1/${module}s/${record.number}/documents`;
    const added = await upload(path, admin, true);
    expect(added.statusCode, added.body).toBe(201);
    expect(added.json().document.isPrimary).toBe(false);
    const me = await harness.app.inject({ method: "GET", url: "/api/v1/me", cookies: admin });
    await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/${module}s/${record.number}/team/${me.json().user.id}`,
      cookies: admin,
    });
    expect((await upload(path, admin, true)).statusCode).toBe(404);
  });

  it("pages after the primary Document and searches historical filenames", async () => {
    const record = await create(module);
    const staff = `/api/v1/${module}s/${record.number}`;
    await harness.app.inject({
      method: "POST",
      url: `${staff}/team`,
      cookies: admin,
      payload: { userId: businessId },
    });
    const first = (await upload(`${staff}/documents`, admin)).json().document;
    await harness.db
      .update(documents)
      .set({ title: "Agreement" })
      .where(eq(documents.id, first.id));
    for (let i = 0; i < 50; i++) {
      const added = await upload(`${staff}/documents`);
      expect(added.statusCode, added.body).toBe(201);
    }
    const path = `/api/v1/portal/${module}s/${record.number}/documents`;
    const head = await harness.app.inject({ method: "GET", url: path, cookies: business });
    expect(head.json().documents).toHaveLength(50);
    if (module === "contract") expect(head.json().documents[0].id).toBe(first.id);
    const next = await harness.app.inject({
      method: "GET",
      url: `${path}?cursor=${head.json().nextCursor}`,
      cookies: business,
    });
    expect(next.json().documents).toHaveLength(1);
    expect(next.json().nextCursor).toBeNull();
    expect(
      new Set([...head.json().documents, ...next.json().documents].map((row) => row.id)).size,
    ).toBe(51);
    const named = await harness.app.inject({
      method: "GET",
      url: `${path}?q=AGREEMENT`,
      cookies: business,
    });
    expect(named.json().documents.map((row: { id: string }) => row.id)).toEqual([first.id]);
    const filename = await harness.app.inject({
      method: "GET",
      url: `${path}?q=support.txt`,
      cookies: business,
    });
    expect(filename.json().documents).toHaveLength(50);
    expect(
      (await harness.app.inject({ method: "GET", url: `${path}?q=%25`, cookies: business })).json()
        .documents,
    ).toEqual([]);
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
        title: "Original ask",
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
        title: "Original business ask",
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
        title: "Original business ask",
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

describe.each(["contract", "matter"] as const)("Portal %s applets", (module) => {
  it("adds members through the shared roster while preserving confidentiality and current reach", async () => {
    const record = await create(module);
    const staff = `/api/v1/${module}s/${record.number}`;
    const path = `/api/v1/portal/${module}s/${record.number}/team`;
    const person = await provisionUser(harness.app.auth, {
      email: `portal-added-${module}@example.com`,
      displayName: "Added colleague",
      password: "correct-horse-battery",
    });
    await harness.db.update(users).set({ role: "business_user" }).where(eq(users.id, person.id));
    const addedCookies = await signInCookies(
      harness.app,
      `portal-added-${module}@example.com`,
      "correct-horse-battery",
    );
    const add = (userId = person.id, cookies = business) =>
      harness.app.inject({ method: "POST", url: path, cookies, payload: { userId } });
    expect((await add()).statusCode).toBe(404);
    await harness.app.inject({
      method: "POST",
      url: `${staff}/team`,
      cookies: admin,
      payload: { userId: businessId },
    });
    const eligible = await harness.app.inject({ method: "GET", url: path, cookies: business });
    expect(eligible.json().canAdd).toBe(true);
    expect(eligible.json().people).toContainEqual(expect.objectContaining({ id: person.id }));
    expect(eligible.json().people).not.toContainEqual(expect.objectContaining({ id: businessId }));
    expect(eligible.body).not.toContain("email");
    expect((await add("missing-user")).statusCode).toBe(400);
    await harness.db.update(users).set({ archivedAt: new Date() }).where(eq(users.id, person.id));
    expect((await add()).statusCode).toBe(400);
    await harness.db.update(users).set({ archivedAt: null }).where(eq(users.id, person.id));
    const joined = await add();
    expect(joined.statusCode, joined.body).toBe(201);
    expect(joined.json().team.filter((row: { id: string }) => row.id === person.id)).toHaveLength(
      1,
    );
    expect((await add()).statusCode).toBe(409);
    const reached = await harness.app.inject({
      method: "GET",
      url: `/api/v1/portal/${module}s/${record.number}/work`,
      cookies: addedCookies,
    });
    expect(reached.statusCode, reached.body).toBe(200);
    const log = await harness.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.entityId, record.id));
    expect(log).toContainEqual(
      expect.objectContaining({
        actorId: businessId,
        action: `${module}.team_added`,
        payload: expect.objectContaining({ member: "Added colleague" }),
      }),
    );
    expect(
      (
        await harness.app.inject({
          method: "DELETE",
          url: `${staff}/team/${person.id}`,
          cookies: business,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await harness.app.inject({
          method: "DELETE",
          url: `${path}/${person.id}`,
          cookies: business,
        })
      ).statusCode,
    ).toBe(404);
    const confidential = await harness.app.inject({
      method: "PATCH",
      url: staff,
      cookies: admin,
      payload: { isConfidential: true },
    });
    expect(confidential.statusCode, confidential.body).toBe(200);
    const locked = await harness.app.inject({ method: "GET", url: path, cookies: business });
    expect(locked.json()).toMatchObject({ canAdd: false, people: [] });
    expect((await add("missing-user")).statusCode).toBe(403);
    expect((await add("missing-user", admin)).statusCode).toBe(403);
    await harness.app.inject({
      method: "PATCH",
      url: staff,
      cookies: admin,
      payload: { isConfidential: false },
    });
    await harness.app.inject({
      method: "DELETE",
      url: `${staff}/team/${businessId}`,
      cookies: admin,
    });
    expect((await add()).statusCode).toBe(404);
    const table = module === "contract" ? contracts : matters;
    await harness.db.update(table).set({ archivedAt: new Date() }).where(eq(table.id, record.id));
    expect((await add("missing-user", addedCookies)).statusCode).toBe(404);
  });

  it.each(["membership", "confidentiality", "archive"] as const)(
    "rechecks %s after waiting for a concurrent record change",
    async (change) => {
      const record = await create(module);
      await harness.app.inject({
        method: "POST",
        url: `/api/v1/${module}s/${record.number}/team`,
        cookies: admin,
        payload: { userId: businessId },
      });
      const table = module === "contract" ? contracts : matters;
      let pending: Promise<{ statusCode: number; body: string }> | undefined;
      await harness.db.transaction(async (tx) => {
        const result = await tx.execute(sql`select pg_backend_pid()::int as pid`);
        const holder = Number(result.rows[0]?.pid);
        await tx.select({ id: table.id }).from(table).where(eq(table.id, record.id)).for("update");
        if (change === "membership") {
          if (module === "contract")
            await tx
              .delete(contractTeam)
              .where(
                and(eq(contractTeam.contractId, record.id), eq(contractTeam.userId, businessId)),
              );
          else
            await tx
              .delete(matterTeam)
              .where(and(eq(matterTeam.matterId, record.id), eq(matterTeam.userId, businessId)));
        } else
          await tx
            .update(table)
            .set(change === "archive" ? { archivedAt: new Date() } : { isConfidential: true })
            .where(eq(table.id, record.id));
        pending = harness.app.inject({
          method: "POST",
          url: `/api/v1/portal/${module}s/${record.number}/team`,
          cookies: business,
          payload: { userId: "unreached-target" },
        });
        for (let attempt = 0; attempt < 400; attempt++) {
          const waiting = await harness.db.execute(
            sql`select count(*)::int as waiting from pg_stat_activity where ${holder} = any(pg_blocking_pids(pid))`,
          );
          if (Number(waiting.rows[0]?.waiting) > 0) return;
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        throw new Error("Portal add did not wait for the record lock");
      });
      const response = await pending!;
      expect(response.statusCode, response.body).toBe(change === "confidentiality" ? 403 : 404);
    },
  );

  it("filters history in the store before paging, including staff Portal previews, and revokes applet reads", async () => {
    const record = await create(module);
    const other = await create(module);
    const staff = `/api/v1/${module}s/${record.number}`;
    const teamUrl = `/api/v1/portal/${module}s/${record.number}/team`;
    const historyUrl = `/api/v1/portal/activity?entityType=${module}&entityId=${record.id}`;
    const read = (url: string, cookies = business) =>
      harness.app.inject({ method: "GET", url, cookies });
    expect((await read(teamUrl)).statusCode).toBe(404);
    expect((await read(historyUrl)).statusCode).toBe(404);
    await harness.app.inject({
      method: "POST",
      url: `${staff}/team`,
      cookies: admin,
      payload: { userId: businessId },
    });
    const roster = await read(teamUrl);
    expect(roster.statusCode, roster.body).toBe(200);
    expect(roster.json().team).toContainEqual(
      expect.objectContaining({ id: businessId, displayName: "Business colleague" }),
    );
    expect(roster.body).not.toContain("email");
    expect(roster.body).not.toContain("role");
    expect(roster.headers["cache-control"]).toBe("private, no-store");

    const privateIds: string[] = [];
    for (const visibility of ["legal_only", "working_team", "full_thread"] as const) {
      const posted = await harness.app.inject({
        method: "POST",
        url: "/api/v1/comments",
        cookies: admin,
        payload: {
          entityType: module,
          entityId: record.id,
          visibility,
          body: `${visibility} comment`,
        },
      });
      expect(posted.statusCode, posted.body).toBe(201);
      if (visibility !== "full_thread") privateIds.push(posted.json().comment.id);
    }
    const hidden = await harness.db
      .insert(activityLog)
      .values([
        {
          entityType: module,
          entityId: record.id,
          action: "comment.edited",
          visibility: "legal_only",
          payload: { commentId: "secret-comment" },
        },
        {
          entityType: module,
          entityId: record.id,
          action: `${module}.updated`,
          visibility: "full_thread",
          payload: { changed: { "field.private": { from: null, to: "legal-field-secret" } } },
        },
        {
          entityType: module,
          entityId: record.id,
          action: "document.created",
          visibility: "full_thread",
          payload: { title: "restricted-document" },
        },
        {
          entityType: module,
          entityId: record.id,
          action: "future.private_action",
          visibility: "full_thread",
          payload: { secret: "unknown-private-payload" },
        },
        {
          entityType: module,
          entityId: other.id,
          action: "comment.posted",
          visibility: "full_thread",
          payload: { commentId: "other-record-comment" },
        },
      ])
      .returning({ id: activityLog.id });
    await harness.db.insert(activityLog).values(
      Array.from({ length: 26 }, (_, index) => ({
        entityType: module,
        entityId: record.id,
        action: `${module}.updated`,
        visibility: "full_thread" as const,
        payload: {
          changed: {
            description: { from: null, to: `Shared edit ${index}` },
            "field.private": { from: null, to: "legal-field-secret" },
          },
          internal: "extra-secret",
        },
      })),
    );
    const first = await read(historyUrl);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().entries).toHaveLength(25);
    expect(first.json().nextCursor).toBeTruthy();
    const second = await read(`${historyUrl}&cursor=${first.json().nextCursor}`);
    expect(second.json().entries).toHaveLength(2);
    expect(second.json().nextCursor).toBeNull();
    const all = first.body + second.body;
    for (const secret of [
      ...privateIds,
      "secret-comment",
      "legal-field-secret",
      "restricted-document",
      "unknown-private-payload",
      "other-record-comment",
      "extra-secret",
      "field.private",
    ])
      expect(all).not.toContain(secret);
    expect(first.json()).not.toHaveProperty("total");
    expect(
      first
        .json()
        .entries.every((entry: { visibility: string }) => entry.visibility === "full_thread"),
    ).toBe(true);
    expect(first.headers["cache-control"]).toBe("private, no-store");
    for (const entry of hidden)
      expect((await read(`${historyUrl}&cursor=${entry.id}`)).json()).toEqual({
        entries: [],
        nextCursor: null,
      });
    const staffPreview = await read(historyUrl, admin);
    expect(staffPreview.statusCode, staffPreview.body).toBe(200);
    expect(staffPreview.json()).toEqual(first.json());
    expect(
      (await read(`/api/v1/activity?entityType=${module}&entityId=${record.id}`)).statusCode,
    ).toBe(403);
    await harness.app.inject({
      method: "DELETE",
      url: `${staff}/team/${businessId}`,
      cookies: admin,
    });
    expect((await read(teamUrl)).statusCode).toBe(404);
    expect((await read(historyUrl)).statusCode).toBe(404);
  });

  it("narrates the progress the Portal record shows, and nothing beside it", async () => {
    const record = await create(module);
    const historyUrl = `/api/v1/portal/activity?entityType=${module}&entityId=${record.id}`;
    await harness.app.inject({
      method: "POST",
      url: `/api/v1/${module}s/${record.number}/team`,
      cookies: admin,
      payload: { userId: businessId },
    });
    await harness.db.insert(activityLog).values([
      {
        entityType: module,
        entityId: record.id,
        action: `${module}.status_changed`,
        visibility: "working_team",
        payload:
          module === "contract"
            ? {
                from: "Internal review",
                to: "With counterparty",
                fromStage: "draft",
                toStage: "review",
              }
            : { from: "Open", to: "Closed", closingNote: "Client dropped the claim." },
      },
      {
        entityType: module,
        entityId: record.id,
        action: "task.added",
        visibility: "working_team",
        payload: { taskId: "t1", title: "Send the signature pack", dueDate: "2026-10-01" },
      },
      {
        entityType: module,
        entityId: record.id,
        action: "task.completed",
        visibility: "working_team",
        payload: { taskId: "t1", title: "Send the signature pack" },
      },
      // Not progress the Portal draws: an internal checklist edit, an
      // internal triage change, and a Task that was taken back.
      {
        entityType: module,
        entityId: record.id,
        action: "task.edited",
        visibility: "working_team",
        payload: { taskId: "t2", title: "Check the counterparty story", changed: {} },
      },
      {
        entityType: module,
        entityId: record.id,
        action: "task.removed",
        visibility: "working_team",
        payload: { taskId: "t2", title: "Check the counterparty story" },
      },
      {
        entityType: module,
        entityId: record.id,
        action: `${module}.updated`,
        visibility: "working_team",
        payload: { changed: { risk: { from: "low", to: "high" } } },
      },
    ]);
    const answered = await harness.app.inject({
      method: "GET",
      url: historyUrl,
      cookies: business,
    });
    expect(answered.statusCode, answered.body).toBe(200);
    const entries = answered.json().entries as { action: string; payload: unknown }[];
    expect(entries.map((entry) => entry.action)).toEqual([
      "task.completed",
      "task.added",
      module === "contract" ? "contract.stage_changed" : "matter.status_changed",
    ]);
    // Priority and Risk are the team's own triage and are drawn nowhere
    // on the Portal, so an edit to them narrates nothing.
    expect(answered.body).not.toContain("risk");
    expect(entries.find((entry) => entry.action === "task.added")?.payload).toEqual({
      title: "Send the signature pack",
      dueDate: "2026-10-01",
    });
    // A Task carries its title and nothing else: no id to ask the seam
    // with, and no assignee.
    expect(answered.body).not.toContain("t1");
    expect(entries.find((entry) => entry.action === "task.completed")?.payload).toEqual({
      title: "Send the signature pack",
    });
    // The Stage is what a Portal reader is shown, so a Contract's entry
    // carries the Stage and never the Status name the team moves
    // through. A Matter's Status is on its Portal card, so it stays —
    // but the closing note is the team's own.
    expect(entries.at(-1)?.payload).toEqual(
      module === "contract" ? { from: "draft", to: "review" } : { from: "Open", to: "Closed" },
    );
    expect(answered.body).not.toContain("Internal review");
    expect(answered.body).not.toContain("Client dropped the claim");
    expect(answered.body).not.toContain("Check the counterparty story");
  });
});

it("keeps Portal comment reads, mentions and unread markers within the shared audience", async () => {
  const record = await create();
  const legal = {
    email: "applet-legal@example.com",
    displayName: "Legal writer",
    password: "correct-horse-battery",
  };
  const writer = await provisionUser(harness.app.auth, legal);
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, writer.id));
  const legalCookies = await signInCookies(harness.app, legal.email, legal.password);
  await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${record.number}/team`,
    cookies: admin,
    payload: { userId: businessId },
  });
  const ref = { entityType: "contract", entityId: record.id };
  const query = `entityType=contract&entityId=${record.id}`;
  const headers = { "x-openlaw-surface": "portal" };
  for (const visibility of ["legal_only", "working_team", "full_thread"]) {
    const posted = await harness.app.inject({
      method: "POST",
      url: "/api/v1/comments",
      cookies: legalCookies,
      payload: { ...ref, visibility, body: `${visibility} from Legal` },
    });
    expect(posted.statusCode, posted.body).toBe(201);
  }
  const read = (path: string, portal = true) =>
    harness.app.inject({
      method: "GET",
      url: `/api/v1/comments${path}?${query}`,
      cookies: admin,
      headers: portal ? headers : {},
    });
  const thread = await read("");
  expect(thread.statusCode, thread.body).toBe(200);
  expect(thread.json().comments).toHaveLength(1);
  expect(thread.body).not.toContain("legal_only");
  expect(thread.body).not.toContain("working_team");
  expect((await read("/unread")).json()).toEqual({ unread: 1 });
  expect((await read("/unread", false)).json()).toEqual({ unread: 3 });
  const marked = await harness.app.inject({
    method: "POST",
    url: "/api/v1/comments/read",
    cookies: admin,
    headers,
    payload: ref,
  });
  expect(marked.statusCode, marked.body).toBe(200);
  expect(marked.json()).toEqual({ unread: 0 });
  expect((await read("/unread", false)).json()).toEqual({ unread: 2 });
  const candidates = await read("/mention-candidates");
  expect(candidates.json().candidates.length).toBeGreaterThan(0);
  expect(
    candidates
      .json()
      .candidates.every(
        (person: { tiers: string[] }) =>
          person.tiers.length === 1 && person.tiers[0] === "full_thread",
      ),
  ).toBe(true);
  const privatePost = await harness.app.inject({
    method: "POST",
    url: "/api/v1/comments",
    cookies: admin,
    headers,
    payload: { ...ref, visibility: "legal_only", body: "Not allowed from Portal" },
  });
  expect(privatePost.statusCode).toBe(403);
  const posted = await harness.app.inject({
    method: "POST",
    url: "/api/v1/comments",
    cookies: business,
    headers,
    payload: {
      ...ref,
      visibility: "full_thread",
      body: "@Legal writer please check",
      mentions: [writer.id],
    },
  });
  expect(posted.statusCode, posted.body).toBe(201);
  const id = posted.json().comment.id;
  const edited = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/comments/${id}`,
    cookies: business,
    headers,
    payload: { body: "My correction" },
  });
  expect(edited.statusCode, edited.body).toBe(200);
  expect(edited.json().comment.body).toBe("My correction");
  const redacted = await harness.app.inject({
    method: "POST",
    url: `/api/v1/comments/${id}/redact`,
    cookies: admin,
    headers,
  });
  expect(redacted.statusCode).toBe(403);
  expect(
    (
      await harness.app.inject({
        method: "DELETE",
        url: `/api/v1/comments/${id}`,
        cookies: business,
        headers,
      })
    ).statusCode,
  ).toBe(200);
});

it("removes historical Field edits when its Row is hidden on the Portal", async () => {
  const record = await create();
  await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${record.number}/team`,
    cookies: admin,
    payload: { userId: businessId },
  });
  const field = await harness.app.inject({
    method: "POST",
    url: "/api/v1/fields",
    cookies: admin,
    payload: {
      displayName: "History projection",
      moduleScope: "contract",
      fieldType: "text",
    },
  });
  expect(field.statusCode, field.body).toBe(201);
  const { id, slug } = field.json().field;
  await saveFieldRow(harness, {
    typeUrl: `/api/v1/contract-types/${contractTypeId}`,
    cookies: admin,
    payload: { fieldId: id },
  });
  await harness.db.insert(activityLog).values({
    entityType: "contract",
    entityId: record.id,
    actorId: businessId,
    action: "contract.updated",
    visibility: "full_thread",
    payload: { changed: { [`field.${slug}`]: { from: null, to: "A previously shared value" } } },
  });
  const history = () =>
    harness.app.inject({
      method: "GET",
      url: `/api/v1/portal/activity?entityType=contract&entityId=${record.id}`,
      cookies: business,
    });
  expect((await history()).body).toContain("A previously shared value");
  const form = await harness.app.inject({
    method: "GET",
    url: `/api/v1/contract-types/${contractTypeId}/form`,
    cookies: admin,
  });
  const tree = form.json().form;
  tree.find((node: { id: string }) => node.id === id).visibleOnPortal = false;
  const hidden = await harness.app.inject({
    method: "PUT",
    url: `/api/v1/contract-types/${contractTypeId}/form`,
    cookies: admin,
    payload: { form: tree },
  });
  expect(hidden.statusCode, hidden.body).toBe(200);
  expect((await history()).json()).toEqual({ entries: [], nextCursor: null });
});

it("keeps Request History with its Requester and closes it after conversion", async () => {
  const [type] = await harness.db.select().from(requestTypes).limit(1);
  const [request] = await harness.db
    .insert(requests)
    .values({
      requesterId: businessId,
      requestTypeId: type!.id,
      title: "History request",
      urgency: "medium",
    })
    .returning();
  for (const visibility of ["legal_only", "full_thread"] as const) {
    await harness.db.insert(activityLog).values({
      entityType: "request",
      entityId: request!.id,
      action: "comment.posted",
      visibility,
      payload: { commentId: visibility },
    });
  }
  const url = `/api/v1/portal/activity?entityType=request&entityId=${request!.id}`;
  const visible = await harness.app.inject({ method: "GET", url, cookies: business });
  expect(visible.statusCode, visible.body).toBe(200);
  expect(visible.json().entries).toHaveLength(1);
  expect(visible.body).not.toContain("legal_only");
  expect((await harness.app.inject({ method: "GET", url, cookies: admin })).statusCode).toBe(404);
  const record = await create();
  await harness.db
    .update(requests)
    .set({ status: "converted", convertedContractId: record.id })
    .where(eq(requests.id, request!.id));
  expect((await harness.app.inject({ method: "GET", url, cookies: business })).statusCode).toBe(
    404,
  );
});
