// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Contracts · Types (#81): the CTR-002 taxonomy behind the first
 * list-editor pane — add / rename / reorder / archive / restore, the
 * protected `other` row, and the SET-003 guard semantics — behind
 * SET-002's one role gate, with every mutation appending to the
 * activity log (DD-017). Asserted at the HTTP seam plus direct
 * activity_log reads — the log has no read routes until M9.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, asc, eq, inArray, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies as harnessSignInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "member@example.com",
  displayName: "Legal Member",
  password: "correct-horse-battery",
} as const;

/** The CTR-002 seed slugs, in seeded display order. */
const SEED_SLUGS = [
  "nda",
  "msa",
  "sow",
  "sales",
  "vendor",
  "employment",
  "license",
  "other",
] as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;

beforeAll(async () => {
  harness = await startHarness();
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(res.statusCode, res.body).toBe(201);

  const member = await provisionUser(harness.app.auth, MEMBER);
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, member.id));
  adminCookies = await harnessSignInCookies(harness.app, ADMIN.email, ADMIN.password);
}, 120_000);

afterAll(async () => {
  await harness.stop();
});

interface TypeRow {
  id: string;
  slug: string;
  displayName: string;
  displayOrder: number;
  isSystemDefault: boolean;
  archivedAt: string | null;
  inUseCount: number;
}

const listTypes = async (includeArchived = false): Promise<TypeRow[]> => {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/contract-types${includeArchived ? "?includeArchived=true" : ""}`,
    cookies: adminCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().contractTypes;
};

const typeBySlug = async (slug: string): Promise<TypeRow> => {
  const rows = await listTypes(true);
  const row = rows.find((candidate) => candidate.slug === slug);
  expect(row, slug).toBeDefined();
  return row!;
};

const auditRows = () =>
  harness.db
    .select()
    .from(activityLog)
    .where(
      inArray(activityLog.action, [
        "contract_type.created",
        "contract_type.renamed",
        "contract_type.reordered",
        "contract_type.archived",
        "contract_type.restored",
        "contract_type.deleted",
      ]),
    )
    .orderBy(asc(activityLog.createdAt), asc(activityLog.id));

describe("the SET-002 role gate", () => {
  it("refuses an unauthenticated request as 401", async () => {
    const res = await harness.app.inject({ method: "GET", url: "/api/v1/contract-types" });
    expect(res.statusCode).toBe(401);
  });

  it("refuses a Legal Team Member as 403 problem+json, on read and every write", async () => {
    const cookies = await harnessSignInCookies(harness.app, MEMBER.email, MEMBER.password);
    const nda = await typeBySlug("nda");
    const attempts = [
      harness.app.inject({ method: "GET", url: "/api/v1/contract-types", cookies }),
      harness.app.inject({
        method: "POST",
        url: "/api/v1/contract-types",
        cookies,
        payload: { displayName: "Sneaky" },
      }),
      harness.app.inject({
        method: "PATCH",
        url: `/api/v1/contract-types/${nda.id}`,
        cookies,
        payload: { displayName: "Sneaky" },
      }),
      harness.app.inject({
        method: "PUT",
        url: "/api/v1/contract-types/order",
        cookies,
        payload: { ids: [nda.id] },
      }),
      harness.app.inject({
        method: "POST",
        url: `/api/v1/contract-types/${nda.id}/archive`,
        cookies,
        payload: {},
      }),
      harness.app.inject({
        method: "POST",
        url: `/api/v1/contract-types/${nda.id}/restore`,
        cookies,
      }),
      harness.app.inject({
        method: "DELETE",
        url: `/api/v1/contract-types/${nda.id}`,
        cookies,
      }),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.statusCode, res.body).toBe(403);
      expect(res.headers["content-type"]).toContain("application/problem+json");
    }
    // None of the refused writes landed.
    expect(await typeBySlug("nda")).toEqual(nda);
    expect((await listTypes(true)).some((row) => row.displayName === "Sneaky")).toBe(false);
  });
});

describe("GET /contract-types", () => {
  it("lists the eight CTR-002 seeds in display order", async () => {
    const rows = await listTypes();
    expect(rows.map((row) => row.slug)).toEqual([...SEED_SLUGS]);
    expect(rows.map((row) => row.displayOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const row of rows) {
      expect(row.isSystemDefault).toBe(true);
      expect(row.archivedAt).toBeNull();
      // No contracts exist until M8, so the live-usage count is zero.
      expect(row.inUseCount).toBe(0);
    }
    expect(rows.find((row) => row.slug === "nda")!.displayName).toBe("NDA");
    expect(rows.find((row) => row.slug === "other")!.displayName).toBe("Other");
  });
});

describe("POST /contract-types", () => {
  it("creates a type with a derived slug, appended to the display order", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/contract-types",
      cookies: adminCookies,
      payload: { displayName: "Real Estate" },
    });
    expect(res.statusCode, res.body).toBe(201);
    const created = res.json().contractType;
    expect(created.slug).toBe("real_estate");
    expect(created.displayName).toBe("Real Estate");
    expect(created.isSystemDefault).toBe(false);
    expect(created.displayOrder).toBe(9);

    const rows = await listTypes();
    expect(rows.at(-1)!.slug).toBe("real_estate");
  });

  it("suffixes the slug when the derived slug is taken", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/contract-types",
      cookies: adminCookies,
      payload: { displayName: "NDA" },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().contractType.slug).toBe("nda_2");
    expect(res.json().contractType.displayName).toBe("NDA");
  });

  it("rejects a blank name", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/contract-types",
      cookies: adminCookies,
      payload: { displayName: "   " },
    });
    expect(res.statusCode, res.body).toBe(400);
  });
});

describe("PATCH /contract-types/:id (rename)", () => {
  it("changes the display name and never the slug", async () => {
    const sales = await typeBySlug("sales");
    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contract-types/${sales.id}`,
      cookies: adminCookies,
      payload: { displayName: "Sales agreements" },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().contractType.displayName).toBe("Sales agreements");
    expect(res.json().contractType.slug).toBe("sales");
  });

  it("renames the protected `other` row — protection covers archive and delete only", async () => {
    const other = await typeBySlug("other");
    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contract-types/${other.id}`,
      cookies: adminCookies,
      payload: { displayName: "Miscellaneous" },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().contractType.slug).toBe("other");
    // Put the seeded name back for the tests that follow.
    await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contract-types/${other.id}`,
      cookies: adminCookies,
      payload: { displayName: "Other" },
    });
  });

  it("rejects a blank name and an unknown id", async () => {
    const sales = await typeBySlug("sales");
    const blank = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contract-types/${sales.id}`,
      cookies: adminCookies,
      payload: { displayName: "" },
    });
    expect(blank.statusCode, blank.body).toBe(400);
    const missing = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/contract-types/no-such-id",
      cookies: adminCookies,
      payload: { displayName: "Ghost" },
    });
    expect(missing.statusCode, missing.body).toBe(404);
  });
});

describe("PUT /contract-types/order (reorder)", () => {
  it("applies a permutation of the live rows and renumbers from 1", async () => {
    const before = await listTypes();
    const reversed = [...before].reverse();
    const res = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/contract-types/order",
      cookies: adminCookies,
      payload: { ids: reversed.map((row) => row.id) },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().contractTypes.map((row: TypeRow) => row.id)).toEqual(
      reversed.map((row) => row.id),
    );

    const after = await listTypes();
    expect(after.map((row) => row.id)).toEqual(reversed.map((row) => row.id));
    expect(after.map((row) => row.displayOrder)).toEqual(after.map((_, index) => index + 1));

    // Put the seeded order back for the tests that follow.
    const restore = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/contract-types/order",
      cookies: adminCookies,
      payload: { ids: before.map((row) => row.id) },
    });
    expect(restore.statusCode, restore.body).toBe(200);
  });

  it("rejects a list that is not exactly the live rows", async () => {
    const rows = await listTypes();
    const partial = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/contract-types/order",
      cookies: adminCookies,
      payload: { ids: rows.slice(1).map((row) => row.id) },
    });
    expect(partial.statusCode, partial.body).toBe(400);
    const unknown = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/contract-types/order",
      cookies: adminCookies,
      payload: { ids: [...rows.slice(1).map((row) => row.id), "no-such-id"] },
    });
    expect(unknown.statusCode, unknown.body).toBe(400);
  });
});

describe("POST /contract-types/:id/archive and /restore", () => {
  it("archives a type out of the default list; nothing is deleted", async () => {
    const vendor = await typeBySlug("vendor");
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-types/${vendor.id}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().contractType.archivedAt).not.toBeNull();

    const live = await listTypes();
    expect(live.some((row) => row.slug === "vendor")).toBe(false);
    const all = await listTypes(true);
    expect(all.some((row) => row.slug === "vendor")).toBe(true);
  });

  it("refuses to archive an already-archived type as 409", async () => {
    const vendor = await typeBySlug("vendor");
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-types/${vendor.id}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(409);
  });

  it("accepts a reassignment target and refuses an archived or self target", async () => {
    const sow = await typeBySlug("sow");
    const msa = await typeBySlug("msa");
    const vendor = await typeBySlug("vendor"); // archived above
    const self = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-types/${sow.id}/archive`,
      cookies: adminCookies,
      payload: { reassignToId: sow.id },
    });
    expect(self.statusCode, self.body).toBe(400);
    const toArchived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-types/${sow.id}/archive`,
      cookies: adminCookies,
      payload: { reassignToId: vendor.id },
    });
    expect(toArchived.statusCode, toArchived.body).toBe(400);
    const ok = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-types/${sow.id}/archive`,
      cookies: adminCookies,
      payload: { reassignToId: msa.id },
    });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it("restores an archived type to the end of the display order", async () => {
    const vendor = await typeBySlug("vendor");
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-types/${vendor.id}/restore`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().contractType.archivedAt).toBeNull();

    const live = await listTypes();
    expect(live.at(-1)!.slug).toBe("vendor");

    const sow = await typeBySlug("sow");
    const again = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-types/${sow.id}/restore`,
      cookies: adminCookies,
    });
    expect(again.statusCode, again.body).toBe(200);
  });

  it("refuses to restore a type that is not archived as 409", async () => {
    const nda = await typeBySlug("nda");
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-types/${nda.id}/restore`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(409);
  });
});

describe("the protected `other` row (CTR-002)", () => {
  it("refuses archive as 409 problem+json", async () => {
    const other = await typeBySlug("other");
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-types/${other.id}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect((await typeBySlug("other")).archivedAt).toBeNull();
  });

  it("refuses hard delete as 409", async () => {
    const other = await typeBySlug("other");
    const res = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/contract-types/${other.id}`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(409);
    expect((await listTypes(true)).some((row) => row.slug === "other")).toBe(true);
  });
});

describe("DELETE /contract-types/:id", () => {
  it("hard-deletes an unused, unprotected type as 204", async () => {
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/contract-types",
      cookies: adminCookies,
      payload: { displayName: "Disposable" },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().contractType.id;

    const res = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/contract-types/${id}`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(204);
    expect((await listTypes(true)).some((row) => row.id === id)).toBe(false);
  });

  it("answers 404 for an unknown id", async () => {
    const res = await harness.app.inject({
      method: "DELETE",
      url: "/api/v1/contract-types/no-such-id",
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(404);
  });
});

describe("the DD-017 audit trail", () => {
  it("records every mutation kind with the acting Administrator", async () => {
    const me = await harness.app.inject({
      method: "GET",
      url: "/api/v1/me",
      cookies: adminCookies,
    });
    const actorId = me.json().user.id;
    const rows = await auditRows();
    const actions = new Set(rows.map((row) => row.action));
    for (const action of [
      "contract_type.created",
      "contract_type.renamed",
      "contract_type.reordered",
      "contract_type.archived",
      "contract_type.restored",
      "contract_type.deleted",
    ]) {
      expect(actions.has(action), action).toBe(true);
    }
    for (const row of rows) {
      expect(row.entityType).toBe("system");
      expect(row.visibility).toBe("admin_only");
      expect(row.actorId).toBe(actorId);
    }
  });

  it("carries old and new names on a rename, and the count on an archive", async () => {
    const rows = await auditRows();
    const rename = rows.find(
      (row) =>
        row.action === "contract_type.renamed" &&
        (row.payload as { slug?: string }).slug === "sales",
    );
    expect(rename?.payload).toMatchObject({
      slug: "sales",
      from: "Sales",
      to: "Sales agreements",
    });
    const archive = rows.find(
      (row) =>
        row.action === "contract_type.archived" &&
        (row.payload as { slug?: string }).slug === "vendor",
    );
    expect(archive?.payload).toMatchObject({ slug: "vendor", inUseCount: 0 });
  });

  it("does not log a rename to the current name", async () => {
    const before = (await auditRows()).length;
    const nda = await typeBySlug("nda");
    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contract-types/${nda.id}`,
      cookies: adminCookies,
      payload: { displayName: nda.displayName },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await auditRows()).toHaveLength(before);
  });
});
