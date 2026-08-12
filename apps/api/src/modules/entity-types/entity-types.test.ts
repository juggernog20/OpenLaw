// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Entities · Types (#97): the ENT-001 taxonomy on the shared machinery —
 * the five seeds, add / rename / reorder / archive / restore, the
 * protected `other` row, and the SET-003 guard semantics — behind
 * SET-002's one role gate, with every mutation appending to the
 * activity log (DD-017) under the `entity_type` namespace. The matrix
 * mirrors the matter-types suite on purpose: one machinery, proven
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

/** The ENT-001 seed slugs, in seeded display order. */
const SEED_SLUGS = ["corporation", "llc", "partnership", "branch", "other"] as const;

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
    url: `/api/v1/entity-types${includeArchived ? "?includeArchived=true" : ""}`,
    cookies: adminCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().entityTypes;
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
        "entity_type.created",
        "entity_type.renamed",
        "entity_type.updated",
        "entity_type.reordered",
        "entity_type.archived",
        "entity_type.restored",
        "entity_type.deleted",
      ]),
    )
    .orderBy(asc(activityLog.createdAt));

describe("the SET-002 role gate", () => {
  it("refuses an unauthenticated request as 401", async () => {
    const res = await harness.app.inject({ method: "GET", url: "/api/v1/entity-types" });
    expect(res.statusCode).toBe(401);
  });

  it("refuses a Legal Team Member as 403 problem+json, on read and every write", async () => {
    const cookies = await harnessSignInCookies(harness.app, MEMBER.email, MEMBER.password);
    const partnership = await typeBySlug("partnership");
    const attempts = [
      harness.app.inject({ method: "GET", url: "/api/v1/entity-types", cookies }),
      harness.app.inject({
        method: "POST",
        url: "/api/v1/entity-types",
        cookies,
        payload: { displayName: "Sneaky" },
      }),
      harness.app.inject({
        method: "PATCH",
        url: `/api/v1/entity-types/${partnership.id}`,
        cookies,
        payload: { displayName: "Sneaky" },
      }),
      harness.app.inject({
        method: "PUT",
        url: "/api/v1/entity-types/order",
        cookies,
        payload: { ids: [partnership.id] },
      }),
      harness.app.inject({
        method: "POST",
        url: `/api/v1/entity-types/${partnership.id}/archive`,
        cookies,
        payload: {},
      }),
      harness.app.inject({
        method: "POST",
        url: `/api/v1/entity-types/${partnership.id}/restore`,
        cookies,
      }),
      harness.app.inject({
        method: "DELETE",
        url: `/api/v1/entity-types/${partnership.id}`,
        cookies,
      }),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.statusCode, res.body).toBe(403);
      expect(res.headers["content-type"]).toContain("application/problem+json");
    }
    // None of the refused writes landed.
    expect(await typeBySlug("partnership")).toEqual(partnership);
    expect((await listTypes(true)).some((row) => row.displayName === "Sneaky")).toBe(false);
  });
});

describe("GET /entity-types", () => {
  it("lists the five ENT-001 seeds in display order", async () => {
    const rows = await listTypes();
    expect(rows.map((row) => row.slug)).toEqual([...SEED_SLUGS]);
    expect(rows.map((row) => row.displayOrder)).toEqual([1, 2, 3, 4, 5]);
    for (const row of rows) {
      expect(row.isSystemDefault).toBe(true);
      expect(row.archivedAt).toBeNull();
      // No entities exist until #98, so the live-usage count is zero.
      expect(row.inUseCount).toBe(0);
    }
    expect(rows.find((row) => row.slug === "llc")!.displayName).toBe("LLC");
    expect(rows.find((row) => row.slug === "other")!.displayName).toBe("Other");
  });
});

describe("POST /entity-types", () => {
  it("creates a type with a derived slug, appended to the display order", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/entity-types",
      cookies: adminCookies,
      payload: { displayName: "Holding Company" },
    });
    expect(res.statusCode, res.body).toBe(201);
    const created = res.json().entityType;
    expect(created.slug).toBe("holding_company");
    expect(created.displayName).toBe("Holding Company");
    expect(created.isSystemDefault).toBe(false);
    expect(created.displayOrder).toBe(6);

    const rows = await listTypes();
    expect(rows.at(-1)!.slug).toBe("holding_company");
  });

  it("suffixes the slug when the derived slug is taken", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/entity-types",
      cookies: adminCookies,
      payload: { displayName: "Branch" },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().entityType.slug).toBe("branch_2");
    expect(res.json().entityType.displayName).toBe("Branch");
  });

  it("rejects a blank name", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/entity-types",
      cookies: adminCookies,
      payload: { displayName: "   " },
    });
    expect(res.statusCode, res.body).toBe(400);
  });
});

describe("GET /entity-types/:id", () => {
  it("reads one type by id and answers 404 for an unknown id", async () => {
    const llc = await typeBySlug("llc");
    const res = await harness.app.inject({
      method: "GET",
      url: `/api/v1/entity-types/${llc.id}`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().entityType).toEqual(llc);

    const missing = await harness.app.inject({
      method: "GET",
      url: "/api/v1/entity-types/no-such-id",
      cookies: adminCookies,
    });
    expect(missing.statusCode, missing.body).toBe(404);
  });
});

describe("PATCH /entity-types/:id (rename)", () => {
  it("changes the display name and never the slug", async () => {
    const corporation = await typeBySlug("corporation");
    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/entity-types/${corporation.id}`,
      cookies: adminCookies,
      payload: { displayName: "C corporation" },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().entityType.displayName).toBe("C corporation");
    expect(res.json().entityType.slug).toBe("corporation");
  });

  it("renames the protected `other` row — protection covers archive and delete only", async () => {
    const other = await typeBySlug("other");
    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/entity-types/${other.id}`,
      cookies: adminCookies,
      payload: { displayName: "Miscellaneous" },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().entityType.slug).toBe("other");
    // Put the seeded name back for the tests that follow.
    await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/entity-types/${other.id}`,
      cookies: adminCookies,
      payload: { displayName: "Other" },
    });
  });

  it("sets a description and clears it with null; the slug never changes", async () => {
    const partnership = await typeBySlug("partnership");
    const set = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/entity-types/${partnership.id}`,
      cookies: adminCookies,
      payload: { description: "General or limited partnerships." },
    });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json().entityType.description).toBe("General or limited partnerships.");
    expect(set.json().entityType.slug).toBe("partnership");

    const clear = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/entity-types/${partnership.id}`,
      cookies: adminCookies,
      payload: { description: null },
    });
    expect(clear.statusCode, clear.body).toBe(200);
    expect(clear.json().entityType.description).toBeNull();
  });

  it("rejects a blank name and an unknown id", async () => {
    const corporation = await typeBySlug("corporation");
    const blank = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/entity-types/${corporation.id}`,
      cookies: adminCookies,
      payload: { displayName: "" },
    });
    expect(blank.statusCode, blank.body).toBe(400);
    const missing = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/entity-types/no-such-id",
      cookies: adminCookies,
      payload: { displayName: "Ghost" },
    });
    expect(missing.statusCode, missing.body).toBe(404);
  });
});

describe("PUT /entity-types/order (reorder)", () => {
  it("applies a permutation of the live rows and renumbers from 1", async () => {
    const before = await listTypes();
    const reversed = [...before].reverse();
    const res = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/entity-types/order",
      cookies: adminCookies,
      payload: { ids: reversed.map((row) => row.id) },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().entityTypes.map((row: TypeRow) => row.id)).toEqual(
      reversed.map((row) => row.id),
    );

    const after = await listTypes();
    expect(after.map((row) => row.id)).toEqual(reversed.map((row) => row.id));
    expect(after.map((row) => row.displayOrder)).toEqual(after.map((_, index) => index + 1));

    // Put the seeded order back for the tests that follow.
    const restore = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/entity-types/order",
      cookies: adminCookies,
      payload: { ids: before.map((row) => row.id) },
    });
    expect(restore.statusCode, restore.body).toBe(200);
  });

  it("rejects a list that is not exactly the live rows", async () => {
    const rows = await listTypes();
    const partial = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/entity-types/order",
      cookies: adminCookies,
      payload: { ids: rows.slice(1).map((row) => row.id) },
    });
    expect(partial.statusCode, partial.body).toBe(400);
    const unknown = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/entity-types/order",
      cookies: adminCookies,
      payload: { ids: [...rows.slice(1).map((row) => row.id), "no-such-id"] },
    });
    expect(unknown.statusCode, unknown.body).toBe(400);
  });
});

describe("POST /entity-types/:id/archive and /restore", () => {
  it("archives a type out of the default list; nothing is deleted", async () => {
    const branch = await typeBySlug("branch");
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entity-types/${branch.id}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().entityType.archivedAt).not.toBeNull();

    const live = await listTypes();
    expect(live.some((row) => row.slug === "branch")).toBe(false);
    const all = await listTypes(true);
    expect(all.some((row) => row.slug === "branch")).toBe(true);
  });

  it("refuses to archive an already-archived type as 409", async () => {
    const branch = await typeBySlug("branch");
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entity-types/${branch.id}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(409);
  });

  it("accepts a reassignment target and refuses an archived or self target", async () => {
    const partnership = await typeBySlug("partnership");
    const llc = await typeBySlug("llc");
    const branch = await typeBySlug("branch"); // archived above
    const self = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entity-types/${partnership.id}/archive`,
      cookies: adminCookies,
      payload: { reassignToId: partnership.id },
    });
    expect(self.statusCode, self.body).toBe(400);
    const toArchived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entity-types/${partnership.id}/archive`,
      cookies: adminCookies,
      payload: { reassignToId: branch.id },
    });
    expect(toArchived.statusCode, toArchived.body).toBe(400);
    const ok = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entity-types/${partnership.id}/archive`,
      cookies: adminCookies,
      payload: { reassignToId: llc.id },
    });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it("restores an archived type to the end of the display order", async () => {
    const branch = await typeBySlug("branch");
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entity-types/${branch.id}/restore`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().entityType.archivedAt).toBeNull();

    const live = await listTypes();
    expect(live.at(-1)!.slug).toBe("branch");

    const partnership = await typeBySlug("partnership");
    const again = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entity-types/${partnership.id}/restore`,
      cookies: adminCookies,
    });
    expect(again.statusCode, again.body).toBe(200);
  });

  it("refuses to restore a type that is not archived as 409", async () => {
    const corporation = await typeBySlug("corporation");
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entity-types/${corporation.id}/restore`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(409);
  });
});

describe("the protected `other` row (ENT-001)", () => {
  it("refuses archive as 409 problem+json", async () => {
    const other = await typeBySlug("other");
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entity-types/${other.id}/archive`,
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
      url: `/api/v1/entity-types/${other.id}`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(409);
    expect((await listTypes(true)).some((row) => row.slug === "other")).toBe(true);
  });
});

describe("DELETE /entity-types/:id", () => {
  it("hard-deletes an unused, unprotected type as 204", async () => {
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/entity-types",
      cookies: adminCookies,
      payload: { displayName: "Disposable" },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().entityType.id;

    const res = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/entity-types/${id}`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(204);
    expect((await listTypes(true)).some((row) => row.id === id)).toBe(false);
  });

  it("answers 404 for an unknown id", async () => {
    const res = await harness.app.inject({
      method: "DELETE",
      url: "/api/v1/entity-types/no-such-id",
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(404);
  });
});

describe("the SET-003 archive guard over the registry (#100)", () => {
  interface EntityRow {
    id: string;
    legalName: string;
    entityTypeId: string;
  }

  const createType = async (displayName: string): Promise<TypeRow> => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/entity-types",
      cookies: adminCookies,
      payload: { displayName },
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().entityType;
  };

  const registerEntity = async (legalName: string, entityTypeId: string): Promise<EntityRow> => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/entities",
      cookies: adminCookies,
      payload: { legalName, entityTypeId },
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().entity;
  };

  const registryRows = async (): Promise<EntityRow[]> => {
    const res = await harness.app.inject({
      method: "GET",
      url: "/api/v1/entities?includeArchived=true",
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json().entities;
  };

  let trust: TypeRow;
  let foundation: TypeRow;
  let acme: EntityRow;
  let globex: EntityRow;

  beforeAll(async () => {
    trust = await createType("Trust");
    foundation = await createType("Foundation");
    acme = await registerEntity("Acme Trust", trust.id);
    globex = await registerEntity("Globex Trust", trust.id);
    // One of the two is archived: the guard must count and move it too —
    // restore must never resurrect a reference to an archived type.
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entities/${globex.id}/archive`,
      cookies: adminCookies,
    });
    expect(archived.statusCode, archived.body).toBe(200);
  });

  it("answers the live usage count in the list read", async () => {
    expect((await typeBySlug("trust")).inUseCount).toBe(2);
    expect((await typeBySlug("foundation")).inUseCount).toBe(0);
  });

  it("refuses to archive an in-use type without a target, reporting the count", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entity-types/${trust.id}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json().detail).toContain("2 entities");
    expect((await typeBySlug("trust")).archivedAt).toBeNull();
  });

  it("refuses to hard-delete an in-use type as 409", async () => {
    const res = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/entity-types/${trust.id}`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(409);
    expect((await listTypes(true)).some((row) => row.slug === "trust")).toBe(true);
  });

  it("guards a type used only by an archived entity — the reference is still real", async () => {
    const ghost = await createType("Ghost");
    const haunted = await registerEntity("Haunted Holdings", ghost.id);
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entities/${haunted.id}/archive`,
      cookies: adminCookies,
    });
    expect(archived.statusCode, archived.body).toBe(200);

    const refuse = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entity-types/${ghost.id}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(refuse.statusCode, refuse.body).toBe(409);
    expect(refuse.json().detail).toContain("1 entity");
    const noDelete = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/entity-types/${ghost.id}`,
      cookies: adminCookies,
    });
    expect(noDelete.statusCode, noDelete.body).toBe(409);
  });

  it("archives with a target: every referencing entity moves, archived rows included", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entity-types/${trust.id}/archive`,
      cookies: adminCookies,
      payload: { reassignToId: foundation.id },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().entityType.archivedAt).not.toBeNull();
    expect(res.json().entityType.inUseCount).toBe(0);

    const rows = await registryRows();
    expect(rows.find((row) => row.id === acme.id)!.entityTypeId).toBe(foundation.id);
    expect(rows.find((row) => row.id === globex.id)!.entityTypeId).toBe(foundation.id);
    expect((await typeBySlug("foundation")).inUseCount).toBe(2);
  });

  it("still archives an unused type without the guard", async () => {
    const shelf = await createType("Shelf");
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entity-types/${shelf.id}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().entityType.archivedAt).not.toBeNull();
  });

  it("protects `other` regardless — in use or not", async () => {
    const other = await typeBySlug("other");
    await registerEntity("Otherwise Ltd", other.id);
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entity-types/${other.id}/archive`,
      cookies: adminCookies,
      payload: { reassignToId: foundation.id },
    });
    expect(res.statusCode, res.body).toBe(409);
    expect((await typeBySlug("other")).archivedAt).toBeNull();
  });

  it("writes the reassignment and the archive to the activity log in one transaction", async () => {
    const rows = await auditRows();
    const archivedTrust = rows.find(
      (row) =>
        row.action === "entity_type.archived" &&
        (row.payload as { slug?: string }).slug === "trust",
    );
    expect(archivedTrust?.payload).toMatchObject({
      slug: "trust",
      inUseCount: 2,
      reassignedTo: "foundation",
    });

    const moves = await harness.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, "entity.type_reassigned"))
      .orderBy(asc(activityLog.createdAt));
    expect(moves.map((row) => row.entityId).sort()).toEqual([acme.id, globex.id].sort());
    for (const move of moves) {
      expect(move.visibility).toBe("legal_only");
      expect(move.payload).toMatchObject({ from: "Trust", to: "Foundation" });
    }
    const legalNames = moves.map((row) => (row.payload as { legalName?: string }).legalName);
    expect(legalNames.sort()).toEqual(["Acme Trust", "Globex Trust"].sort());
  });
});

describe("the DD-017 audit trail", () => {
  it("records every mutation kind under the entity_type namespace", async () => {
    const me = await harness.app.inject({
      method: "GET",
      url: "/api/v1/me",
      cookies: adminCookies,
    });
    const actorId = me.json().user.id;
    const rows = await auditRows();
    const actions = new Set(rows.map((row) => row.action));
    for (const action of [
      "entity_type.created",
      "entity_type.renamed",
      // The description PATCH branch logs the generic `updated` verb.
      "entity_type.updated",
      "entity_type.reordered",
      "entity_type.archived",
      "entity_type.restored",
      "entity_type.deleted",
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
        row.action === "entity_type.renamed" &&
        (row.payload as { slug?: string }).slug === "corporation",
    );
    expect(rename?.payload).toMatchObject({
      slug: "corporation",
      from: "Corporation",
      to: "C corporation",
    });

    const before = (await auditRows()).length;
    const llc = await typeBySlug("llc");
    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/entity-types/${llc.id}`,
      cookies: adminCookies,
      payload: { displayName: llc.displayName },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await auditRows()).toHaveLength(before);
  });
});
