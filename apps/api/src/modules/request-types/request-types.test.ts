// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Intake · Request types (#85, INT-002): the fourth mount of the shared
 * taxonomy machinery — the three seeds, add / rename / describe /
 * reorder / archive / restore / delete — behind SET-002's one role
 * gate, with every mutation appending to the activity log (DD-017)
 * under the `request_type` namespace. The matrix mirrors the
 * matter-types suite on purpose: one machinery, proven per mount.
 *
 * Two things are this mount's own, and both are absences.
 *
 * **No protected row.** There is no fallback request type, so a row an
 * Administrator names "Other" archives and deletes like any other.
 *
 * **In-use counts read zero.** `requests` lands in M20, so the SET-003
 * guard reads zero on every row and archive needs no reassignment —
 * exactly where matter types sit until M22.
 *
 * **The target rides the extras hook (#354).** The module and the one
 * type id join the row projection and the strict PATCH body, and the
 * validator holds the three-state invariant over HTTP. The check
 * constraint holds the same invariant at the table, which the last
 * describe asserts directly — a refusal a route could never reach is
 * still the one that has to hold.
 *
 * Asserted at the HTTP seam plus direct table reads.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  asc,
  contractTypes,
  eq,
  inArray,
  matterTypes,
  requestTypes,
  users,
} from "@openlaw/db";
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

/** The INT-002 seed slugs, in seeded display order. */
const SEED_SLUGS = ["nda_request", "contract_review", "legal_question"] as const;

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
  description: string | null;
  displayOrder: number;
  isSystemDefault: boolean;
  archivedAt: string | null;
  inUseCount: number;
  targetModule: "matter" | "contract" | null;
  targetTypeId: string | null;
}

const listTypes = async (includeArchived = false): Promise<TypeRow[]> => {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/request-types${includeArchived ? "?includeArchived=true" : ""}`,
    cookies: adminCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().requestTypes;
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
        "request_type.created",
        "request_type.renamed",
        "request_type.updated",
        "request_type.reordered",
        "request_type.archived",
        "request_type.restored",
        "request_type.deleted",
      ]),
    )
    .orderBy(asc(activityLog.createdAt));

describe("the SET-002 role gate", () => {
  it("refuses an unauthenticated request as 401", async () => {
    const res = await harness.app.inject({ method: "GET", url: "/api/v1/request-types" });
    expect(res.statusCode).toBe(401);
  });

  it("refuses a Legal Team Member as 403 problem+json, on read and every write", async () => {
    const cookies = await harnessSignInCookies(harness.app, MEMBER.email, MEMBER.password);
    const review = await typeBySlug("contract_review");
    const attempts = [
      harness.app.inject({ method: "GET", url: "/api/v1/request-types", cookies }),
      harness.app.inject({
        method: "POST",
        url: "/api/v1/request-types",
        cookies,
        payload: { displayName: "Sneaky" },
      }),
      harness.app.inject({
        method: "PATCH",
        url: `/api/v1/request-types/${review.id}`,
        cookies,
        payload: { displayName: "Sneaky" },
      }),
      harness.app.inject({
        method: "PUT",
        url: "/api/v1/request-types/order",
        cookies,
        payload: { ids: [review.id] },
      }),
      harness.app.inject({
        method: "POST",
        url: `/api/v1/request-types/${review.id}/archive`,
        cookies,
        payload: {},
      }),
      harness.app.inject({
        method: "POST",
        url: `/api/v1/request-types/${review.id}/restore`,
        cookies,
      }),
      harness.app.inject({
        method: "DELETE",
        url: `/api/v1/request-types/${review.id}`,
        cookies,
      }),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.statusCode, res.body).toBe(403);
      expect(res.headers["content-type"]).toContain("application/problem+json");
    }
    expect(await typeBySlug("contract_review")).toEqual(review);
    expect((await listTypes(true)).some((row) => row.displayName === "Sneaky")).toBe(false);
  });
});

describe("GET /request-types", () => {
  it("lists the three INT-002 seeds in display order, with their descriptions", async () => {
    const rows = await listTypes();
    expect(rows.map((row) => row.slug)).toEqual([...SEED_SLUGS]);
    expect(rows.map((row) => row.displayOrder)).toEqual([1, 2, 3]);
    expect(rows.map((row) => row.displayName)).toEqual([
      "NDA request",
      "Contract review",
      "Legal question",
    ]);
    for (const row of rows) {
      expect(row.isSystemDefault).toBe(true);
      expect(row.archivedAt).toBeNull();
      // No requests exist until M20, so the live-usage count is zero.
      expect(row.inUseCount).toBe(0);
      expect(row.description).not.toBeNull();
    }
  });

  it("seeds the three targets: the NDA contract type, the Contract module, and nothing", async () => {
    const seeded = await harness.db
      .select()
      .from(requestTypes)
      .orderBy(asc(requestTypes.displayOrder));
    const [nda] = await harness.db
      .select()
      .from(contractTypes)
      .where(eq(contractTypes.slug, "nda"))
      .limit(1);

    const bySlug = new Map(seeded.map((row) => [row.slug, row]));
    expect(bySlug.get("nda_request")).toMatchObject({
      targetModule: "contract",
      targetContractTypeId: nda!.id,
      targetMatterTypeId: null,
    });
    expect(bySlug.get("contract_review")).toMatchObject({
      targetModule: "contract",
      targetContractTypeId: null,
      targetMatterTypeId: null,
    });
    expect(bySlug.get("legal_question")).toMatchObject({
      targetModule: null,
      targetContractTypeId: null,
      targetMatterTypeId: null,
    });
  });

  it("projects the target as the module and the one type id (#354)", async () => {
    const [nda] = await harness.db
      .select()
      .from(contractTypes)
      .where(eq(contractTypes.slug, "nda"))
      .limit(1);
    const rows = await listTypes();
    const bySlug = new Map(rows.map((row) => [row.slug, row]));
    // The two type columns collapse to one on the wire: the check
    // constraint already says at most one is set, and which table it
    // names is the module's to say.
    expect(bySlug.get("nda_request")).toMatchObject({
      targetModule: "contract",
      targetTypeId: nda!.id,
    });
    expect(bySlug.get("contract_review")).toMatchObject({
      targetModule: "contract",
      targetTypeId: null,
    });
    expect(bySlug.get("legal_question")).toMatchObject({
      targetModule: null,
      targetTypeId: null,
    });
    for (const row of rows) {
      // The columns themselves stay behind the projection.
      expect(row).not.toHaveProperty("targetContractTypeId");
      expect(row).not.toHaveProperty("targetMatterTypeId");
    }
  });
});

describe("POST /request-types", () => {
  it("creates a type with a derived slug, appended to the display order", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/request-types",
      cookies: adminCookies,
      payload: { displayName: "Vendor onboarding" },
    });
    expect(res.statusCode, res.body).toBe(201);
    const created = res.json().requestType;
    expect(created.slug).toBe("vendor_onboarding");
    expect(created.displayName).toBe("Vendor onboarding");
    expect(created.isSystemDefault).toBe(false);
    expect(created.description).toBeNull();
    expect(created.displayOrder).toBe(4);

    const rows = await listTypes();
    expect(rows.at(-1)!.slug).toBe("vendor_onboarding");
  });

  it("suffixes the slug when the derived slug is taken", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/request-types",
      cookies: adminCookies,
      payload: { displayName: "Legal question" },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().requestType.slug).toBe("legal_question_2");
  });

  it("rejects a blank name", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/request-types",
      cookies: adminCookies,
      payload: { displayName: "   " },
    });
    expect(res.statusCode, res.body).toBe(400);
  });
});

describe("PATCH /request-types/:id (rename and describe)", () => {
  it("changes the display name and never the slug", async () => {
    const question = await typeBySlug("legal_question");
    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/request-types/${question.id}`,
      cookies: adminCookies,
      payload: { displayName: "Quick question" },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().requestType.displayName).toBe("Quick question");
    expect(res.json().requestType.slug).toBe("legal_question");
  });

  it("edits the description, and clears it with an empty string", async () => {
    const review = await typeBySlug("contract_review");
    const set = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/request-types/${review.id}`,
      cookies: adminCookies,
      payload: { description: "Anything a counterparty sent us." },
    });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json().requestType.description).toBe("Anything a counterparty sent us.");

    const cleared = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/request-types/${review.id}`,
      cookies: adminCookies,
      payload: { description: "  " },
    });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(cleared.json().requestType.description).toBeNull();
  });

  it("refuses a key no mount declared, the slug above all", async () => {
    const question = await typeBySlug("legal_question");
    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/request-types/${question.id}`,
      cookies: adminCookies,
      payload: { slug: "renamed" },
    });
    expect(res.statusCode, res.body).toBe(400);
    expect((await typeBySlug("legal_question")).slug).toBe("legal_question");
  });

  it("rejects a blank name and an unknown id", async () => {
    const question = await typeBySlug("legal_question");
    const blank = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/request-types/${question.id}`,
      cookies: adminCookies,
      payload: { displayName: "" },
    });
    expect(blank.statusCode, blank.body).toBe(400);
    const missing = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/request-types/no-such-id",
      cookies: adminCookies,
      payload: { displayName: "Ghost" },
    });
    expect(missing.statusCode, missing.body).toBe(404);
  });
});

describe("PUT /request-types/order (reorder)", () => {
  it("applies a permutation of the live rows and renumbers from 1", async () => {
    const before = await listTypes();
    const reversed = [...before].reverse();
    const res = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/request-types/order",
      cookies: adminCookies,
      payload: { ids: reversed.map((row) => row.id) },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().requestTypes.map((row: TypeRow) => row.id)).toEqual(
      reversed.map((row) => row.id),
    );

    const after = await listTypes();
    expect(after.map((row) => row.id)).toEqual(reversed.map((row) => row.id));
    expect(after.map((row) => row.displayOrder)).toEqual(after.map((_, index) => index + 1));

    // Put the seeded order back for the tests that follow.
    const restore = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/request-types/order",
      cookies: adminCookies,
      payload: { ids: before.map((row) => row.id) },
    });
    expect(restore.statusCode, restore.body).toBe(200);
  });

  it("rejects a list that is not exactly the live rows", async () => {
    const rows = await listTypes();
    const partial = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/request-types/order",
      cookies: adminCookies,
      payload: { ids: rows.slice(1).map((row) => row.id) },
    });
    expect(partial.statusCode, partial.body).toBe(400);
    const unknown = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/request-types/order",
      cookies: adminCookies,
      payload: { ids: [...rows.slice(1).map((row) => row.id), "no-such-id"] },
    });
    expect(unknown.statusCode, unknown.body).toBe(400);
  });
});

describe("POST /request-types/:id/archive and /restore", () => {
  it("archives with a zero in-use count and no reassignment target (SET-003)", async () => {
    const nda = await typeBySlug("nda_request");
    expect(nda.inUseCount).toBe(0);
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/request-types/${nda.id}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().requestType.archivedAt).not.toBeNull();

    const live = await listTypes();
    expect(live.some((row) => row.slug === "nda_request")).toBe(false);
    const all = await listTypes(true);
    expect(all.some((row) => row.slug === "nda_request")).toBe(true);
  });

  it("refuses to archive an already-archived type as 409", async () => {
    const nda = await typeBySlug("nda_request");
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/request-types/${nda.id}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(409);
  });

  it("restores an archived type to the end of the display order", async () => {
    const nda = await typeBySlug("nda_request");
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/request-types/${nda.id}/restore`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().requestType.archivedAt).toBeNull();
    expect((await listTypes()).at(-1)!.slug).toBe("nda_request");
  });

  it("refuses to restore a type that is not archived as 409", async () => {
    const question = await typeBySlug("legal_question");
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/request-types/${question.id}/restore`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(409);
  });
});

describe("no system-protected row (INT-002)", () => {
  it("archives and deletes a type named Other like any other row", async () => {
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/request-types",
      cookies: adminCookies,
      payload: { displayName: "Other" },
    });
    expect(created.statusCode, created.body).toBe(201);
    const other = created.json().requestType;
    // The name an Administrator typed, not a fallback the machinery owns.
    expect(other.slug).toBe("other");

    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/request-types/${other.id}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(archived.statusCode, archived.body).toBe(200);

    const deleted = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/request-types/${other.id}`,
      cookies: adminCookies,
    });
    expect(deleted.statusCode, deleted.body).toBe(204);
    expect((await listTypes(true)).some((row) => row.id === other.id)).toBe(false);
  });
});

describe("DELETE /request-types/:id", () => {
  it("hard-deletes an unused type as 204", async () => {
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/request-types",
      cookies: adminCookies,
      payload: { displayName: "Disposable" },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().requestType.id;

    const res = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/request-types/${id}`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(204);
    expect((await listTypes(true)).some((row) => row.id === id)).toBe(false);
  });

  it("answers 404 for an unknown id", async () => {
    const res = await harness.app.inject({
      method: "DELETE",
      url: "/api/v1/request-types/no-such-id",
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(404);
  });
});

describe("the DD-017 audit trail", () => {
  it("records every mutation kind under the request_type namespace", async () => {
    const me = await harness.app.inject({
      method: "GET",
      url: "/api/v1/me",
      cookies: adminCookies,
    });
    const actorId = me.json().user.id;
    const rows = await auditRows();
    const actions = new Set(rows.map((row) => row.action));
    for (const action of [
      "request_type.created",
      "request_type.renamed",
      "request_type.updated",
      "request_type.reordered",
      "request_type.archived",
      "request_type.restored",
      "request_type.deleted",
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
        row.action === "request_type.renamed" &&
        (row.payload as { slug?: string }).slug === "legal_question",
    );
    expect(rename?.payload).toMatchObject({
      slug: "legal_question",
      from: "Legal question",
      to: "Quick question",
    });

    const before = (await auditRows()).length;
    const question = await typeBySlug("legal_question");
    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/request-types/${question.id}`,
      cookies: adminCookies,
      payload: { displayName: question.displayName },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await auditRows()).toHaveLength(before);
  });

  it("narrates a description edit in the `updated` payload's changed map", async () => {
    const rows = await auditRows();
    const updated = rows.find(
      (row) =>
        row.action === "request_type.updated" &&
        (row.payload as { slug?: string }).slug === "contract_review",
    );
    expect(updated?.payload).toMatchObject({
      slug: "contract_review",
      changed: {
        description: {
          from: "Review of a counterparty contract or redline.",
          to: "Anything a counterparty sent us.",
        },
      },
    });
  });

  it("names the archived row and its zero in-use count", async () => {
    const rows = await auditRows();
    const archived = rows.find(
      (row) =>
        row.action === "request_type.archived" &&
        (row.payload as { slug?: string }).slug === "nda_request",
    );
    expect(archived?.payload).toMatchObject({
      slug: "nda_request",
      displayName: "NDA request",
      inUseCount: 0,
      reassignedTo: null,
    });
  });
});

describe("PATCH /request-types/:id — the three-state target (INT-002)", () => {
  const patch = (id: string, payload: Record<string, unknown>) =>
    harness.app.inject({
      method: "PATCH",
      url: `/api/v1/request-types/${id}`,
      cookies: adminCookies,
      payload,
    });

  async function addType(displayName: string): Promise<TypeRow> {
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/request-types",
      cookies: adminCookies,
      payload: { displayName },
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().requestType;
  }

  const contractTypeBySlug = async (slug: string) => {
    const [row] = await harness.db
      .select()
      .from(contractTypes)
      .where(eq(contractTypes.slug, slug))
      .limit(1);
    expect(row, slug).toBeDefined();
    return row!;
  };

  it("takes all three states, and the module alone clears a named type", async () => {
    const nda = await contractTypeBySlug("nda");
    const row = await addType("Target walk");

    const toType = await patch(row.id, { targetModule: "contract", targetTypeId: nda.id });
    expect(toType.statusCode, toType.body).toBe(200);
    expect(toType.json().requestType).toMatchObject({
      targetModule: "contract",
      targetTypeId: nda.id,
    });

    // The module and the type id are one value: naming the module alone
    // rewrites the target whole, so the NDA type does not survive it.
    const toModule = await patch(row.id, { targetModule: "contract" });
    expect(toModule.statusCode, toModule.body).toBe(200);
    expect(toModule.json().requestType).toMatchObject({
      targetModule: "contract",
      targetTypeId: null,
    });

    const toNothing = await patch(row.id, { targetModule: null });
    expect(toNothing.statusCode, toNothing.body).toBe(200);
    expect(toNothing.json().requestType).toMatchObject({
      targetModule: null,
      targetTypeId: null,
    });
  });

  it("re-points a contract target at a matter type in one PATCH", async () => {
    const [litigation] = await harness.db
      .select()
      .from(matterTypes)
      .where(eq(matterTypes.slug, "litigation"))
      .limit(1);
    expect(litigation, "litigation").toBeDefined();
    const nda = await contractTypeBySlug("nda");
    const row = await addType("Re-point");
    await patch(row.id, { targetModule: "contract", targetTypeId: nda.id });

    const res = await patch(row.id, {
      targetModule: "matter",
      targetTypeId: litigation!.id,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().requestType).toMatchObject({
      targetModule: "matter",
      targetTypeId: litigation!.id,
    });
    // The other module's column is cleared, not left dangling.
    const [stored] = await harness.db
      .select()
      .from(requestTypes)
      .where(eq(requestTypes.id, row.id))
      .limit(1);
    expect(stored).toMatchObject({
      targetModule: "matter",
      targetMatterTypeId: litigation!.id,
      targetContractTypeId: null,
    });
  });

  it("refuses a type id under the wrong module as an RFC 9457 problem", async () => {
    const nda = await contractTypeBySlug("nda");
    const row = await addType("Wrong module");
    const res = await patch(row.id, { targetModule: "matter", targetTypeId: nda.id });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json().detail).toContain("matter type");
  });

  it("refuses a type id with no module at all", async () => {
    const nda = await contractTypeBySlug("nda");
    const row = await addType("No module");
    const res = await patch(row.id, { targetModule: null, targetTypeId: nda.id });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().detail).toContain("module");
  });

  it("refuses a type id that names no row at all", async () => {
    const row = await addType("Dead id");
    const res = await patch(row.id, {
      targetModule: "contract",
      targetTypeId: "00000000-0000-4000-8000-000000000000",
    });
    expect(res.statusCode, res.body).toBe(400);
  });

  it("refuses an archived type: the picker offers live types only", async () => {
    const row = await addType("Archived target");
    const [archived] = await harness.db
      .insert(contractTypes)
      .values({
        slug: "target_archived",
        displayName: "Target archived",
        displayOrder: 98,
        archivedAt: new Date(),
      })
      .returning();

    const res = await patch(row.id, { targetModule: "contract", targetTypeId: archived!.id });
    expect(res.statusCode, res.body).toBe(400);

    await harness.db.delete(contractTypes).where(eq(contractTypes.id, archived!.id));
  });

  it("refuses a module that is neither matter nor contract", async () => {
    const row = await addType("Bad module");
    const res = await patch(row.id, { targetModule: "knowledge" });
    expect(res.statusCode, res.body).toBe(400);
  });

  it("narrates a target change in the activity log, both halves by name", async () => {
    const nda = await contractTypeBySlug("nda");
    const row = await addType("Narrated target");
    await patch(row.id, { targetModule: "contract", targetTypeId: nda.id });
    await patch(row.id, { targetModule: null });

    const rows = await auditRows();
    const updates = rows.filter(
      (entry) =>
        entry.action === "request_type.updated" &&
        (entry.payload as { slug?: string }).slug === row.slug,
    );
    expect(updates).toHaveLength(2);
    expect((updates[0]!.payload as { changed: unknown }).changed).toMatchObject({
      targetModule: { from: null, to: "contract" },
      targetType: { from: null, to: nda.displayName },
    });
    expect((updates[1]!.payload as { changed: unknown }).changed).toMatchObject({
      targetModule: { from: "contract", to: null },
      targetType: { from: nda.displayName, to: null },
    });
  });

  it("writes nothing and narrates nothing when the target is re-sent unchanged", async () => {
    const nda = await contractTypeBySlug("nda");
    const row = await addType("Unchanged target");
    await patch(row.id, { targetModule: "contract", targetTypeId: nda.id });
    const before = (await auditRows()).length;

    const res = await patch(row.id, { targetModule: "contract", targetTypeId: nda.id });
    expect(res.statusCode, res.body).toBe(200);
    expect((await auditRows()).length).toBe(before);
  });

  it("leaves the target alone when a PATCH names neither key", async () => {
    const nda = await contractTypeBySlug("nda");
    const row = await addType("Rename only");
    await patch(row.id, { targetModule: "contract", targetTypeId: nda.id });

    const res = await patch(row.id, { displayName: "Rename only, renamed" });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().requestType).toMatchObject({
      targetModule: "contract",
      targetTypeId: nda.id,
    });
  });

  it("demotes to the module alone over HTTP when the targeted type is deleted", async () => {
    const [created] = await harness.db
      .insert(contractTypes)
      .values({ slug: "demote_http", displayName: "Demote over HTTP", displayOrder: 97 })
      .returning();
    const row = await addType("Demoted");
    await patch(row.id, { targetModule: "contract", targetTypeId: created!.id });

    await harness.db.delete(contractTypes).where(eq(contractTypes.id, created!.id));

    const after = await typeBySlug(row.slug);
    // "Contract · Demote over HTTP" reads "Contract" — never a dangling id.
    expect(after).toMatchObject({ targetModule: "contract", targetTypeId: null });
  });
});

describe("the three-state target at the database (INT-002)", () => {
  /**
   * Asserts the write was refused by the target check itself. Drizzle
   * wraps the driver error, so the constraint name lives on the cause —
   * matching the wrapper's text would pass for any failed write.
   */
  async function refusedByTargetCheck(write: Promise<unknown>) {
    const error: unknown = await write.then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error, "the database accepted the write").toBeDefined();
    expect((error as { cause?: { constraint?: string } }).cause?.constraint).toBe(
      "request_types_target_check",
    );
  }

  it("refuses a type id under the wrong module", async () => {
    const [nda] = await harness.db
      .select()
      .from(contractTypes)
      .where(eq(contractTypes.slug, "nda"))
      .limit(1);
    const question = await typeBySlug("legal_question");
    await refusedByTargetCheck(
      harness.db
        .update(requestTypes)
        .set({ targetModule: "matter", targetContractTypeId: nda!.id })
        .where(eq(requestTypes.id, question.id)),
    );
  });

  it("refuses a type id with no module at all", async () => {
    const [nda] = await harness.db
      .select()
      .from(contractTypes)
      .where(eq(contractTypes.slug, "nda"))
      .limit(1);
    const question = await typeBySlug("legal_question");
    await refusedByTargetCheck(
      harness.db
        .update(requestTypes)
        .set({ targetModule: null, targetContractTypeId: nda!.id })
        .where(eq(requestTypes.id, question.id)),
    );
  });

  it("refuses a module that is neither matter nor contract", async () => {
    const question = await typeBySlug("legal_question");
    await refusedByTargetCheck(
      harness.db
        .update(requestTypes)
        .set({ targetModule: "knowledge" })
        .where(eq(requestTypes.id, question.id)),
    );
  });

  it("demotes to the module alone when the targeted contract type is deleted", async () => {
    const [created] = await harness.db
      .insert(contractTypes)
      .values({ slug: "demo_only", displayName: "Demo only", displayOrder: 99 })
      .returning();
    const [target] = await harness.db
      .insert(requestTypes)
      .values({
        slug: "demo_request",
        displayName: "Demo request",
        displayOrder: 99,
        targetModule: "contract",
        targetContractTypeId: created!.id,
      })
      .returning();

    await harness.db.delete(contractTypes).where(eq(contractTypes.id, created!.id));

    const [after] = await harness.db
      .select()
      .from(requestTypes)
      .where(eq(requestTypes.id, target!.id))
      .limit(1);
    // "Contract · Demo only" becomes "Contract" — never a dangling id.
    expect(after).toMatchObject({ targetModule: "contract", targetContractTypeId: null });

    await harness.db.delete(requestTypes).where(eq(requestTypes.id, target!.id));
  });
});
