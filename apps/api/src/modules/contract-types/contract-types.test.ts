// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Contracts · Types (#81): the CTR-002 taxonomy behind the first
 * list-editor pane — add / rename / reorder / archive / restore, the
 * protected `other` row, and the SET-003 guard semantics — behind
 * SET-002's one role gate, with every mutation appending to the
 * activity log (DD-017). Asserted at the HTTP seam plus direct
 * activity_log reads — the log has no read routes until M9.
 *
 * The guard is armed from #113: the counts are real, and archiving an
 * in-use type moves its contracts to a target type. The reassignment is
 * a system move, so it skips the hard-required rule and retains every
 * custom-field value.
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
    .orderBy(asc(activityLog.createdAt));

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
      // Nothing has been created on these seeds yet, so the SET-003
      // count is zero — a real query since #113, not a placeholder.
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

describe("the SET-003 archive guard over the contract record (#113)", () => {
  interface ContractRow {
    id: string;
    number: number;
    title: string;
    contractTypeId: string;
    customFields: Record<string, string | number | boolean | string[]>;
  }

  const createType = async (displayName: string): Promise<TypeRow> => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/contract-types",
      cookies: adminCookies,
      payload: { displayName },
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().contractType;
  };

  const createContract = async (
    title: string,
    contractTypeId: string,
    customFields?: Record<string, unknown>,
  ): Promise<ContractRow> => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      cookies: adminCookies,
      payload: { title, contractTypeId, ...(customFields ? { customFields } : {}) },
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().contract;
  };

  const contractRows = async (): Promise<ContractRow[]> => {
    const res = await harness.app.inject({
      method: "GET",
      url: "/api/v1/contracts?includeArchived=true",
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json().contracts;
  };

  /** Defines a catalog field and attaches it to a type as required. */
  const requireFieldOn = async (typeId: string, displayName: string): Promise<string> => {
    const defined = await harness.app.inject({
      method: "POST",
      url: "/api/v1/fields",
      cookies: adminCookies,
      payload: { moduleScope: "contract", fieldTag: "legal", fieldType: "text", displayName },
    });
    expect(defined.statusCode, defined.body).toBe(201);
    const field = defined.json().field;
    const attached = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-types/${typeId}/fields`,
      cookies: adminCookies,
      payload: { fieldId: field.id, isRequired: true },
    });
    expect(attached.statusCode, attached.body).toBe(201);
    return field.slug;
  };

  let reseller: TypeRow;
  let distribution: TypeRow;
  let apac: ContractRow;
  let emea: ContractRow;
  /** The slug Reseller requires and Distribution does not. */
  let resellerFieldSlug: string;
  /** The slug Distribution requires and no moved contract answers. */
  let distributionFieldSlug: string;

  beforeAll(async () => {
    reseller = await createType("Reseller");
    distribution = await createType("Distribution");
    resellerFieldSlug = await requireFieldOn(reseller.id, "Reseller territory");
    // The target type requires a field the moved contracts have no
    // value for. The move must land anyway: it is a system move, so the
    // hard-required rule (CTR-016/MTR-014) does not run.
    distributionFieldSlug = await requireFieldOn(distribution.id, "Distribution channel");

    apac = await createContract("Reseller APAC", reseller.id, { [resellerFieldSlug]: "APAC" });
    emea = await createContract("Reseller EMEA", reseller.id, { [resellerFieldSlug]: "EMEA" });
    // One of the two is archived: the guard counts and moves it too, so
    // a restore never resurrects a reference to an archived type.
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${emea.number}/archive`,
      cookies: adminCookies,
    });
    expect(archived.statusCode, archived.body).toBe(200);
  });

  it("answers the live usage count in the list read", async () => {
    expect((await typeBySlug("reseller")).inUseCount).toBe(2);
    expect((await typeBySlug("distribution")).inUseCount).toBe(0);
  });

  it("refuses to archive an in-use type without a target, reporting the count", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-types/${reseller.id}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json().detail).toContain("2 contracts");
    expect((await typeBySlug("reseller")).archivedAt).toBeNull();
  });

  it("refuses to hard-delete an in-use type as 409", async () => {
    const res = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/contract-types/${reseller.id}`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(409);
    expect((await listTypes(true)).some((row) => row.slug === "reseller")).toBe(true);
  });

  it("guards a type used only by an archived contract — the reference is still real", async () => {
    const ghost = await createType("Ghost");
    const haunted = await createContract("Ghost deal", ghost.id);
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${haunted.number}/archive`,
      cookies: adminCookies,
    });
    expect(archived.statusCode, archived.body).toBe(200);

    const refuse = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-types/${ghost.id}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(refuse.statusCode, refuse.body).toBe(409);
    expect(refuse.json().detail).toContain("1 contract");
    const noDelete = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/contract-types/${ghost.id}`,
      cookies: adminCookies,
    });
    expect(noDelete.statusCode, noDelete.body).toBe(409);
  });

  it("archives with a target: every contract moves, archived rows included", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-types/${reseller.id}/archive`,
      cookies: adminCookies,
      payload: { reassignToId: distribution.id },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().contractType.archivedAt).not.toBeNull();
    expect(res.json().contractType.inUseCount).toBe(0);

    const rows = await contractRows();
    expect(rows.find((row) => row.id === apac.id)!.contractTypeId).toBe(distribution.id);
    expect(rows.find((row) => row.id === emea.id)!.contractTypeId).toBe(distribution.id);
    expect((await typeBySlug("distribution")).inUseCount).toBe(2);
  });

  it("moves a contract that has no value for the target type's required field", async () => {
    // The move landed above with the gap open — proof the guard never
    // calls the hard-required rule. The gap is real, not papered over.
    const moved = (await contractRows()).find((row) => row.id === apac.id)!;
    expect(moved.customFields[distributionFieldSlug]).toBeUndefined();
  });

  it("retains the values the old type's fields held", async () => {
    const moved = (await contractRows()).find((row) => row.id === apac.id)!;
    expect(moved.customFields[resellerFieldSlug]).toBe("APAC");
  });

  it("still archives an unused type without the guard", async () => {
    const shelf = await createType("Shelf");
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-types/${shelf.id}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().contractType.archivedAt).not.toBeNull();
  });

  it("protects `other` regardless — in use or not", async () => {
    const other = await typeBySlug("other");
    await createContract("Otherwise", other.id);
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-types/${other.id}/archive`,
      cookies: adminCookies,
      payload: { reassignToId: distribution.id },
    });
    expect(res.statusCode, res.body).toBe(409);
    expect((await typeBySlug("other")).archivedAt).toBeNull();
  });

  it("writes the archive payload with a per-contract reassignment row", async () => {
    const rows = await auditRows();
    const archived = rows.find(
      (row) =>
        row.action === "contract_type.archived" &&
        (row.payload as { slug?: string }).slug === "reseller",
    );
    expect(archived?.payload).toMatchObject({
      slug: "reseller",
      inUseCount: 2,
      reassignedTo: "distribution",
    });

    const moves = await harness.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, "contract.type_reassigned"))
      .orderBy(asc(activityLog.createdAt));
    expect(moves.map((row) => row.entityId).sort()).toEqual([apac.id, emea.id].sort());
    for (const move of moves) {
      expect(move.entityType).toBe("contract");
      expect(move.visibility).toBe("working_team");
      expect(move.payload).toMatchObject({ from: "Reseller", to: "Distribution" });
    }
    const numbers = moves.map((row) => (row.payload as { number?: number }).number);
    expect(numbers.sort()).toEqual([apac.number, emea.number].sort());
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
