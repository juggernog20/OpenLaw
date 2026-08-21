// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Matters · Types (#85): the MTR-001 taxonomy on the shared machinery —
 * the nine seeds, add / rename / reorder / archive / restore, the
 * protected `other` row, and the SET-003 guard semantics — behind
 * SET-002's one role gate, with every mutation appending to the
 * activity log (DD-017) under the `matter_type` namespace. The matrix
 * mirrors the contract-types suite on purpose: one machinery, proven
 * per mount. Asserted at the HTTP seam plus direct activity_log reads —
 * the log has no read routes until M9.
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

/** The MTR-001 seed slugs, in seeded display order. */
const SEED_SLUGS = [
  "employment",
  "litigation",
  "regulatory",
  "commercial",
  "corporate",
  "ip",
  "privacy",
  "advisory",
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
});

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
    url: `/api/v1/matter-types${includeArchived ? "?includeArchived=true" : ""}`,
    cookies: adminCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().matterTypes;
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
        "matter_type.created",
        "matter_type.renamed",
        "matter_type.reordered",
        "matter_type.archived",
        "matter_type.restored",
        "matter_type.deleted",
      ]),
    )
    .orderBy(asc(activityLog.createdAt));

describe("the SET-002 role gate", () => {
  it("refuses an unauthenticated request as 401", async () => {
    const res = await harness.app.inject({ method: "GET", url: "/api/v1/matter-types" });
    expect(res.statusCode).toBe(401);
  });

  it("refuses a Legal Team Member as 403 problem+json, on read and every write", async () => {
    const cookies = await harnessSignInCookies(harness.app, MEMBER.email, MEMBER.password);
    const litigation = await typeBySlug("litigation");
    const attempts = [
      harness.app.inject({ method: "GET", url: "/api/v1/matter-types", cookies }),
      harness.app.inject({
        method: "POST",
        url: "/api/v1/matter-types",
        cookies,
        payload: { displayName: "Sneaky" },
      }),
      harness.app.inject({
        method: "PATCH",
        url: `/api/v1/matter-types/${litigation.id}`,
        cookies,
        payload: { displayName: "Sneaky" },
      }),
      harness.app.inject({
        method: "PUT",
        url: "/api/v1/matter-types/order",
        cookies,
        payload: { ids: [litigation.id] },
      }),
      harness.app.inject({
        method: "POST",
        url: `/api/v1/matter-types/${litigation.id}/archive`,
        cookies,
        payload: {},
      }),
      harness.app.inject({
        method: "POST",
        url: `/api/v1/matter-types/${litigation.id}/restore`,
        cookies,
      }),
      harness.app.inject({
        method: "DELETE",
        url: `/api/v1/matter-types/${litigation.id}`,
        cookies,
      }),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.statusCode, res.body).toBe(403);
      expect(res.headers["content-type"]).toContain("application/problem+json");
    }
    // None of the refused writes landed.
    expect(await typeBySlug("litigation")).toEqual(litigation);
    expect((await listTypes(true)).some((row) => row.displayName === "Sneaky")).toBe(false);
  });
});

describe("GET /matter-types", () => {
  it("lists the nine MTR-001 seeds in display order", async () => {
    const rows = await listTypes();
    expect(rows.map((row) => row.slug)).toEqual([...SEED_SLUGS]);
    expect(rows.map((row) => row.displayOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const row of rows) {
      expect(row.isSystemDefault).toBe(true);
      expect(row.archivedAt).toBeNull();
      // No matters exist until M22, so the live-usage count is zero.
      expect(row.inUseCount).toBe(0);
    }
    expect(rows.find((row) => row.slug === "ip")!.displayName).toBe("IP");
    expect(rows.find((row) => row.slug === "other")!.displayName).toBe("Other");
  });
});

describe("POST /matter-types", () => {
  it("creates a type with a derived slug, appended to the display order", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/matter-types",
      cookies: adminCookies,
      payload: { displayName: "Data Governance" },
    });
    expect(res.statusCode, res.body).toBe(201);
    const created = res.json().matterType;
    expect(created.slug).toBe("data_governance");
    expect(created.displayName).toBe("Data Governance");
    expect(created.isSystemDefault).toBe(false);
    expect(created.displayOrder).toBe(10);

    const rows = await listTypes();
    expect(rows.at(-1)!.slug).toBe("data_governance");
  });

  it("suffixes the slug when the derived slug is taken", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/matter-types",
      cookies: adminCookies,
      payload: { displayName: "Litigation" },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().matterType.slug).toBe("litigation_2");
    expect(res.json().matterType.displayName).toBe("Litigation");
  });

  it("rejects a blank name", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/matter-types",
      cookies: adminCookies,
      payload: { displayName: "   " },
    });
    expect(res.statusCode, res.body).toBe(400);
  });
});

describe("PATCH /matter-types/:id (rename)", () => {
  it("changes the display name and never the slug", async () => {
    const advisory = await typeBySlug("advisory");
    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/matter-types/${advisory.id}`,
      cookies: adminCookies,
      payload: { displayName: "Quick questions" },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().matterType.displayName).toBe("Quick questions");
    expect(res.json().matterType.slug).toBe("advisory");
  });

  it("renames the protected `other` row — protection covers archive and delete only", async () => {
    const other = await typeBySlug("other");
    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/matter-types/${other.id}`,
      cookies: adminCookies,
      payload: { displayName: "Miscellaneous" },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().matterType.slug).toBe("other");
    // Put the seeded name back for the tests that follow.
    await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/matter-types/${other.id}`,
      cookies: adminCookies,
      payload: { displayName: "Other" },
    });
  });

  it("rejects a blank name and an unknown id", async () => {
    const advisory = await typeBySlug("advisory");
    const blank = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/matter-types/${advisory.id}`,
      cookies: adminCookies,
      payload: { displayName: "" },
    });
    expect(blank.statusCode, blank.body).toBe(400);
    const missing = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/matter-types/no-such-id",
      cookies: adminCookies,
      payload: { displayName: "Ghost" },
    });
    expect(missing.statusCode, missing.body).toBe(404);
  });
});

describe("PUT /matter-types/order (reorder)", () => {
  it("applies a permutation of the live rows and renumbers from 1", async () => {
    const before = await listTypes();
    const reversed = [...before].reverse();
    const res = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/matter-types/order",
      cookies: adminCookies,
      payload: { ids: reversed.map((row) => row.id) },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().matterTypes.map((row: TypeRow) => row.id)).toEqual(
      reversed.map((row) => row.id),
    );

    const after = await listTypes();
    expect(after.map((row) => row.id)).toEqual(reversed.map((row) => row.id));
    expect(after.map((row) => row.displayOrder)).toEqual(after.map((_, index) => index + 1));

    // Put the seeded order back for the tests that follow.
    const restore = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/matter-types/order",
      cookies: adminCookies,
      payload: { ids: before.map((row) => row.id) },
    });
    expect(restore.statusCode, restore.body).toBe(200);
  });

  it("rejects a list that is not exactly the live rows", async () => {
    const rows = await listTypes();
    const partial = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/matter-types/order",
      cookies: adminCookies,
      payload: { ids: rows.slice(1).map((row) => row.id) },
    });
    expect(partial.statusCode, partial.body).toBe(400);
    const unknown = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/matter-types/order",
      cookies: adminCookies,
      payload: { ids: [...rows.slice(1).map((row) => row.id), "no-such-id"] },
    });
    expect(unknown.statusCode, unknown.body).toBe(400);
  });
});

describe("POST /matter-types/:id/archive and /restore", () => {
  it("archives a type out of the default list; nothing is deleted", async () => {
    const regulatory = await typeBySlug("regulatory");
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matter-types/${regulatory.id}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().matterType.archivedAt).not.toBeNull();

    const live = await listTypes();
    expect(live.some((row) => row.slug === "regulatory")).toBe(false);
    const all = await listTypes(true);
    expect(all.some((row) => row.slug === "regulatory")).toBe(true);
  });

  it("refuses to archive an already-archived type as 409", async () => {
    const regulatory = await typeBySlug("regulatory");
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matter-types/${regulatory.id}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(409);
  });

  it("accepts a reassignment target and refuses an archived or self target", async () => {
    const privacy = await typeBySlug("privacy");
    const corporate = await typeBySlug("corporate");
    const regulatory = await typeBySlug("regulatory"); // archived above
    const self = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matter-types/${privacy.id}/archive`,
      cookies: adminCookies,
      payload: { reassignToId: privacy.id },
    });
    expect(self.statusCode, self.body).toBe(400);
    const toArchived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matter-types/${privacy.id}/archive`,
      cookies: adminCookies,
      payload: { reassignToId: regulatory.id },
    });
    expect(toArchived.statusCode, toArchived.body).toBe(400);
    const ok = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matter-types/${privacy.id}/archive`,
      cookies: adminCookies,
      payload: { reassignToId: corporate.id },
    });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it("restores an archived type to the end of the display order", async () => {
    const regulatory = await typeBySlug("regulatory");
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matter-types/${regulatory.id}/restore`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().matterType.archivedAt).toBeNull();

    const live = await listTypes();
    expect(live.at(-1)!.slug).toBe("regulatory");

    const privacy = await typeBySlug("privacy");
    const again = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matter-types/${privacy.id}/restore`,
      cookies: adminCookies,
    });
    expect(again.statusCode, again.body).toBe(200);
  });

  it("refuses to restore a type that is not archived as 409", async () => {
    const employment = await typeBySlug("employment");
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matter-types/${employment.id}/restore`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(409);
  });
});

describe("the protected `other` row (MTR-001)", () => {
  it("refuses archive as 409 problem+json", async () => {
    const other = await typeBySlug("other");
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/matter-types/${other.id}/archive`,
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
      url: `/api/v1/matter-types/${other.id}`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(409);
    expect((await listTypes(true)).some((row) => row.slug === "other")).toBe(true);
  });
});

describe("DELETE /matter-types/:id", () => {
  it("hard-deletes an unused, unprotected type as 204", async () => {
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/matter-types",
      cookies: adminCookies,
      payload: { displayName: "Disposable" },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().matterType.id;

    const res = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/matter-types/${id}`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(204);
    expect((await listTypes(true)).some((row) => row.id === id)).toBe(false);
  });

  it("answers 404 for an unknown id", async () => {
    const res = await harness.app.inject({
      method: "DELETE",
      url: "/api/v1/matter-types/no-such-id",
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(404);
  });
});

describe("the DD-017 audit trail", () => {
  it("records every mutation kind under the matter_type namespace", async () => {
    const me = await harness.app.inject({
      method: "GET",
      url: "/api/v1/me",
      cookies: adminCookies,
    });
    const actorId = me.json().user.id;
    const rows = await auditRows();
    const actions = new Set(rows.map((row) => row.action));
    for (const action of [
      "matter_type.created",
      "matter_type.renamed",
      "matter_type.reordered",
      "matter_type.archived",
      "matter_type.restored",
      "matter_type.deleted",
    ]) {
      expect(actions.has(action), action).toBe(true);
    }
    for (const row of rows) {
      expect(row.entityType).toBe("system");
      expect(row.visibility).toBe("admin_only");
      expect(row.actorId).toBe(actorId);
    }
  });

  it("carries old and new names on a rename, and does not log a no-op rename", async () => {
    const rows = await auditRows();
    const rename = rows.find(
      (row) =>
        row.action === "matter_type.renamed" &&
        (row.payload as { slug?: string }).slug === "advisory",
    );
    expect(rename?.payload).toMatchObject({
      slug: "advisory",
      from: "Advisory",
      to: "Quick questions",
    });

    const before = (await auditRows()).length;
    const employment = await typeBySlug("employment");
    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/matter-types/${employment.id}`,
      cookies: adminCookies,
      payload: { displayName: employment.displayName },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await auditRows()).toHaveLength(before);
  });
});
