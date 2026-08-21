// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Contracts · Statuses (#82): the CTR-001 taxonomy behind the second
 * list-editor pane — add with a stage picked at creation, rename,
 * reorder, archive, restore — with the stage immutable after creation,
 * the per-stage floor (every stage keeps ≥1 unarchived status), and the
 * system-protected `draft` / `active` / `expired` rows. No reassignment
 * anywhere: structural minimums block instead (SET-003, CTR-020).
 * Behind SET-002's one role gate, every mutation appending to the
 * activity log (DD-017). Asserted at the HTTP seam plus direct
 * activity_log reads — the log has no read routes until M9.
 *
 * From #113 the in-use count is real, and it blocks: a status contracts
 * still hold refuses to archive, and refuses to delete, with the count
 * in the problem detail. The Administrator moves the contracts.
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

/** The CTR-001 seeds: slug → stage, in seeded display order. */
const SEEDS = [
  ["draft", "draft"],
  ["internal_review", "review"],
  ["redlining", "review"],
  ["awaiting_approval", "approval"],
  ["out_for_signature", "signature"],
  ["active", "active"],
  ["expired", "ended"],
  ["terminated", "ended"],
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

interface StatusRow {
  id: string;
  slug: string;
  displayName: string;
  stage: string;
  displayOrder: number;
  isSystemDefault: boolean;
  archivedAt: string | null;
  inUseCount: number;
}

const listStatuses = async (includeArchived = false): Promise<StatusRow[]> => {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/contract-statuses${includeArchived ? "?includeArchived=true" : ""}`,
    cookies: adminCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().contractStatuses;
};

const statusBySlug = async (slug: string): Promise<StatusRow> => {
  const rows = await listStatuses(true);
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
        "contract_status.created",
        "contract_status.renamed",
        "contract_status.reordered",
        "contract_status.archived",
        "contract_status.restored",
        "contract_status.deleted",
      ]),
    )
    .orderBy(asc(activityLog.createdAt));

describe("the SET-002 role gate", () => {
  it("refuses an unauthenticated request as 401", async () => {
    const res = await harness.app.inject({ method: "GET", url: "/api/v1/contract-statuses" });
    expect(res.statusCode).toBe(401);
  });

  it("refuses a Legal Team Member as 403 problem+json, on read and every write", async () => {
    const cookies = await harnessSignInCookies(harness.app, MEMBER.email, MEMBER.password);
    const draft = await statusBySlug("draft");
    const attempts = [
      harness.app.inject({ method: "GET", url: "/api/v1/contract-statuses", cookies }),
      harness.app.inject({
        method: "POST",
        url: "/api/v1/contract-statuses",
        cookies,
        payload: { displayName: "Sneaky", stage: "review" },
      }),
      harness.app.inject({
        method: "PATCH",
        url: `/api/v1/contract-statuses/${draft.id}`,
        cookies,
        payload: { displayName: "Sneaky" },
      }),
      harness.app.inject({
        method: "PUT",
        url: "/api/v1/contract-statuses/order",
        cookies,
        payload: { ids: [draft.id] },
      }),
      harness.app.inject({
        method: "POST",
        url: `/api/v1/contract-statuses/${draft.id}/archive`,
        cookies,
      }),
      harness.app.inject({
        method: "POST",
        url: `/api/v1/contract-statuses/${draft.id}/restore`,
        cookies,
      }),
      harness.app.inject({
        method: "DELETE",
        url: `/api/v1/contract-statuses/${draft.id}`,
        cookies,
      }),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.statusCode, res.body).toBe(403);
      expect(res.headers["content-type"]).toContain("application/problem+json");
    }
    // None of the refused writes landed.
    expect(await statusBySlug("draft")).toEqual(draft);
    expect((await listStatuses(true)).some((row) => row.displayName === "Sneaky")).toBe(false);
  });
});

describe("GET /contract-statuses", () => {
  it("lists the eight CTR-001 seeds with their stages, in display order", async () => {
    const rows = await listStatuses();
    expect(rows.map((row) => [row.slug, row.stage])).toEqual(SEEDS.map((seed) => [...seed]));
    expect(rows.map((row) => row.displayOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const row of rows) {
      expect(row.isSystemDefault).toBe(true);
      expect(row.archivedAt).toBeNull();
      // Nothing has been created on these seeds yet, so the SET-003
      // count is zero — a real query since #113, not a placeholder.
      expect(row.inUseCount).toBe(0);
    }
    expect(rows.find((row) => row.slug === "redlining")!.displayName).toBe("With counterparty");
  });
});

describe("POST /contract-statuses", () => {
  it("creates a status with the picked stage and a derived slug, appended to the order", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/contract-statuses",
      cookies: adminCookies,
      payload: { displayName: "On hold", stage: "review" },
    });
    expect(res.statusCode, res.body).toBe(201);
    const created = res.json().contractStatus;
    expect(created.slug).toBe("on_hold");
    expect(created.displayName).toBe("On hold");
    expect(created.stage).toBe("review");
    expect(created.isSystemDefault).toBe(false);
    expect(created.displayOrder).toBe(9);

    const rows = await listStatuses();
    expect(rows.at(-1)!.slug).toBe("on_hold");
  });

  it("suffixes the slug when the derived slug is taken", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/contract-statuses",
      cookies: adminCookies,
      payload: { displayName: "Draft", stage: "draft" },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().contractStatus.slug).toBe("draft_2");
    expect(res.json().contractStatus.stage).toBe("draft");
  });

  it("requires one of the six stages", async () => {
    const missing = await harness.app.inject({
      method: "POST",
      url: "/api/v1/contract-statuses",
      cookies: adminCookies,
      payload: { displayName: "Stageless" },
    });
    expect(missing.statusCode, missing.body).toBe(400);
    const unknown = await harness.app.inject({
      method: "POST",
      url: "/api/v1/contract-statuses",
      cookies: adminCookies,
      payload: { displayName: "Nowhere", stage: "limbo" },
    });
    expect(unknown.statusCode, unknown.body).toBe(400);
    const rows = await listStatuses(true);
    expect(rows.some((row) => ["Stageless", "Nowhere"].includes(row.displayName))).toBe(false);
  });

  it("rejects a blank name", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/contract-statuses",
      cookies: adminCookies,
      payload: { displayName: "   ", stage: "review" },
    });
    expect(res.statusCode, res.body).toBe(400);
  });
});

describe("PATCH /contract-statuses/:id (rename) and stage immutability", () => {
  it("changes the display name and never the slug or the stage", async () => {
    const terminated = await statusBySlug("terminated");
    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contract-statuses/${terminated.id}`,
      cookies: adminCookies,
      payload: { displayName: "Ended early" },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().contractStatus.displayName).toBe("Ended early");
    expect(res.json().contractStatus.slug).toBe("terminated");
    expect(res.json().contractStatus.stage).toBe("ended");
  });

  it("renames the protected rows — protection covers archive and delete only", async () => {
    const draft = await statusBySlug("draft");
    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contract-statuses/${draft.id}`,
      cookies: adminCookies,
      payload: { displayName: "Drafting" },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().contractStatus.slug).toBe("draft");
    expect(res.json().contractStatus.stage).toBe("draft");
    // Put the seeded name back for the tests that follow.
    await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contract-statuses/${draft.id}`,
      cookies: adminCookies,
      payload: { displayName: "Draft" },
    });
  });

  it("refuses a rename that carries a stage — the stage is immutable after creation", async () => {
    const onHold = await statusBySlug("on_hold");
    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contract-statuses/${onHold.id}`,
      cookies: adminCookies,
      payload: { displayName: "On hold", stage: "ended" },
    });
    expect(res.statusCode, res.body).toBe(400);
    expect((await statusBySlug("on_hold")).stage).toBe("review");
  });

  it("rejects a blank name and an unknown id", async () => {
    const onHold = await statusBySlug("on_hold");
    const blank = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contract-statuses/${onHold.id}`,
      cookies: adminCookies,
      payload: { displayName: "" },
    });
    expect(blank.statusCode, blank.body).toBe(400);
    const missing = await harness.app.inject({
      method: "PATCH",
      url: "/api/v1/contract-statuses/no-such-id",
      cookies: adminCookies,
      payload: { displayName: "Ghost" },
    });
    expect(missing.statusCode, missing.body).toBe(404);
  });
});

describe("PUT /contract-statuses/order (reorder)", () => {
  it("applies a permutation of the live rows and renumbers from 1", async () => {
    const before = await listStatuses();
    const reversed = [...before].reverse();
    const res = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/contract-statuses/order",
      cookies: adminCookies,
      payload: { ids: reversed.map((row) => row.id) },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().contractStatuses.map((row: StatusRow) => row.id)).toEqual(
      reversed.map((row) => row.id),
    );

    const after = await listStatuses();
    expect(after.map((row) => row.id)).toEqual(reversed.map((row) => row.id));
    expect(after.map((row) => row.displayOrder)).toEqual(after.map((_, index) => index + 1));

    // Put the seeded order back for the tests that follow.
    const restore = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/contract-statuses/order",
      cookies: adminCookies,
      payload: { ids: before.map((row) => row.id) },
    });
    expect(restore.statusCode, restore.body).toBe(200);
  });

  it("rejects a list that is not exactly the live rows", async () => {
    const rows = await listStatuses();
    const partial = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/contract-statuses/order",
      cookies: adminCookies,
      payload: { ids: rows.slice(1).map((row) => row.id) },
    });
    expect(partial.statusCode, partial.body).toBe(400);
    const unknown = await harness.app.inject({
      method: "PUT",
      url: "/api/v1/contract-statuses/order",
      cookies: adminCookies,
      payload: { ids: [...rows.slice(1).map((row) => row.id), "no-such-id"] },
    });
    expect(unknown.statusCode, unknown.body).toBe(400);
  });
});

describe("the CTR-001 per-stage floor", () => {
  it("refuses to archive the only status of a stage as 409 with the reason", async () => {
    // `awaiting_approval` is approval's only status, and it is not a
    // protected row — this is the floor speaking, not protection.
    const awaiting = await statusBySlug("awaiting_approval");
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-statuses/${awaiting.id}/archive`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json().detail).toContain("last unarchived status");
    expect((await statusBySlug("awaiting_approval")).archivedAt).toBeNull();
  });

  it("archives down to one status per stage, then blocks the last", async () => {
    // review holds internal_review, redlining, and on_hold: the first
    // two archive freely, the survivor refuses.
    const internalReview = await statusBySlug("internal_review");
    const redlining = await statusBySlug("redlining");
    for (const row of [internalReview, redlining]) {
      const res = await harness.app.inject({
        method: "POST",
        url: `/api/v1/contract-statuses/${row.id}/archive`,
        cookies: adminCookies,
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().contractStatus.archivedAt).not.toBeNull();
    }
    const onHold = await statusBySlug("on_hold");
    const blocked = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-statuses/${onHold.id}/archive`,
      cookies: adminCookies,
    });
    expect(blocked.statusCode, blocked.body).toBe(409);

    // A stage-mate un-blocks it: restore one review status and the
    // previously refused archive goes through.
    const restored = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-statuses/${internalReview.id}/restore`,
      cookies: adminCookies,
    });
    expect(restored.statusCode, restored.body).toBe(200);
    const unblocked = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-statuses/${onHold.id}/archive`,
      cookies: adminCookies,
    });
    expect(unblocked.statusCode, unblocked.body).toBe(200);

    // Put review back for the tests that follow.
    for (const row of [redlining, onHold]) {
      const res = await harness.app.inject({
        method: "POST",
        url: `/api/v1/contract-statuses/${row.id}/restore`,
        cookies: adminCookies,
      });
      expect(res.statusCode, res.body).toBe(200);
    }
  });

  it("archives a non-protected stage-mate of a protected row", async () => {
    // draft_2 shares the draft stage with the protected `draft` row, so
    // the floor holds without it.
    const draft2 = await statusBySlug("draft_2");
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-statuses/${draft2.id}/archive`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
  });

  it("refuses to archive an already-archived status as 409", async () => {
    const draft2 = await statusBySlug("draft_2");
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-statuses/${draft2.id}/archive`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(409);
  });
});

describe("POST /contract-statuses/:id/restore", () => {
  it("restores an archived status to the end of the display order, stage unchanged", async () => {
    const draft2 = await statusBySlug("draft_2");
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-statuses/${draft2.id}/restore`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().contractStatus.archivedAt).toBeNull();
    expect(res.json().contractStatus.stage).toBe("draft");

    const live = await listStatuses();
    expect(live.at(-1)!.slug).toBe("draft_2");
  });

  it("refuses to restore a status that is not archived as 409", async () => {
    const active = await statusBySlug("active");
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-statuses/${active.id}/restore`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(409);
  });
});

describe("the protected `draft` / `active` / `expired` rows (CTR-001)", () => {
  it("refuses archive as 409 problem+json — even with a live stage-mate", async () => {
    // `draft` has draft_2 beside it, so the floor alone would allow
    // this: the refusal below is protection, distinct from the floor.
    for (const slug of ["draft", "active", "expired"]) {
      const row = await statusBySlug(slug);
      const res = await harness.app.inject({
        method: "POST",
        url: `/api/v1/contract-statuses/${row.id}/archive`,
        cookies: adminCookies,
      });
      expect(res.statusCode, `${slug}: ${res.body}`).toBe(409);
      expect(res.headers["content-type"]).toContain("application/problem+json");
      expect(res.json().detail).toContain("system-protected");
      expect((await statusBySlug(slug)).archivedAt).toBeNull();
    }
  });

  it("refuses hard delete as 409", async () => {
    for (const slug of ["draft", "active", "expired"]) {
      const row = await statusBySlug(slug);
      const res = await harness.app.inject({
        method: "DELETE",
        url: `/api/v1/contract-statuses/${row.id}`,
        cookies: adminCookies,
      });
      expect(res.statusCode, `${slug}: ${res.body}`).toBe(409);
      expect((await listStatuses(true)).some((candidate) => candidate.slug === slug)).toBe(true);
    }
  });
});

describe("DELETE /contract-statuses/:id", () => {
  it("hard-deletes an unprotected status with a live stage-mate as 204", async () => {
    const draft2 = await statusBySlug("draft_2");
    const res = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/contract-statuses/${draft2.id}`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(204);
    expect((await listStatuses(true)).some((row) => row.id === draft2.id)).toBe(false);
  });

  it("refuses to delete the last live status of a stage as 409", async () => {
    const awaiting = await statusBySlug("awaiting_approval");
    const res = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/contract-statuses/${awaiting.id}`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().detail).toContain("last unarchived status");
  });

  it("deletes an archived row freely — it is already outside the live set", async () => {
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/contract-statuses",
      cookies: adminCookies,
      payload: { displayName: "Disposable", stage: "review" },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().contractStatus.id;
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-statuses/${id}/archive`,
      cookies: adminCookies,
    });
    expect(archived.statusCode, archived.body).toBe(200);
    const res = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/contract-statuses/${id}`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(204);
    expect((await listStatuses(true)).some((row) => row.id === id)).toBe(false);
  });

  it("answers 404 for an unknown id", async () => {
    const res = await harness.app.inject({
      method: "DELETE",
      url: "/api/v1/contract-statuses/no-such-id",
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(404);
  });
});

describe("the SET-003 in-use guard over the contract record (#113)", () => {
  const createStatus = async (displayName: string, stage: string): Promise<StatusRow> => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/contract-statuses",
      cookies: adminCookies,
      payload: { displayName, stage },
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().contractStatus;
  };

  /** A contract, born on the protected draft seed (CTR-001). */
  const createContract = async (title: string): Promise<{ number: number }> => {
    const types = await harness.app.inject({
      method: "GET",
      url: "/api/v1/contract-types",
      cookies: adminCookies,
    });
    expect(types.statusCode, types.body).toBe(200);
    const nda = types
      .json()
      .contractTypes.find((row: { id: string; slug: string }) => row.slug === "nda");
    expect(nda, "NDA seed type must exist").toBeDefined();
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      cookies: adminCookies,
      payload: { title, contractTypeId: nda.id },
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().contract;
  };

  const setStatus = async (number: number, statusId: string) => {
    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${number}`,
      cookies: adminCookies,
      payload: { statusId },
    });
    expect(res.statusCode, res.body).toBe(200);
  };

  const setContractArchived = async (number: number, archived: boolean) => {
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${number}/${archived ? "archive" : "restore"}`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
  };

  let awaiting: StatusRow;
  let stalled: StatusRow;
  let parked: StatusRow;
  let paused: { number: number };
  let dropped: { number: number };

  beforeAll(async () => {
    awaiting = await createStatus("Awaiting counsel", "review");
    stalled = await createStatus("Stalled", "review");
    parked = await createStatus("Parked", "review");
    paused = await createContract("Paused deal");
    dropped = await createContract("Dropped deal");
    await setStatus(paused.number, awaiting.id);
    await setStatus(dropped.number, awaiting.id);
    // One of the two is archived: the count and the FK cover the same
    // set, so an archived contract's status reference is as real as a
    // live one — a restore must never resurrect an archived status.
    await setContractArchived(dropped.number, true);
  });

  it("answers the live usage count in the list read", async () => {
    expect((await statusBySlug(awaiting.slug)).inUseCount).toBe(2);
    expect((await statusBySlug(stalled.slug)).inUseCount).toBe(0);
  });

  it("refuses to archive an in-use status as 409, reporting the count", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-statuses/${awaiting.id}/archive`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json().detail).toContain("2 contracts");
    expect((await statusBySlug(awaiting.slug)).archivedAt).toBeNull();
  });

  it("blocks rather than reassigns — a target in the body changes nothing", async () => {
    // Statuses never take a reassignment (CTR-020): which status a
    // contract belongs on is a judgement no bulk move can make.
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-statuses/${awaiting.id}/archive`,
      cookies: adminCookies,
      payload: { reassignToId: stalled.id },
    });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().detail).toContain("2 contracts");
    expect((await statusBySlug(stalled.slug)).inUseCount).toBe(0);
  });

  it("refuses to hard-delete an in-use status as 409", async () => {
    const res = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/contract-statuses/${awaiting.id}`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().detail).toContain("2 contracts");
    expect((await listStatuses(true)).some((row) => row.slug === awaiting.slug)).toBe(true);
  });

  it("archives once the Administrator has moved the contracts off", async () => {
    await setStatus(paused.number, stalled.id);
    // The archived contract holds its status as firmly as a live one,
    // and an archived record refuses edits — so clearing it takes a
    // restore, a move, and an archive again. That is the price of one
    // counting rule, and it is the honest one: a restore must never
    // bring back a reference to an archived status.
    await setContractArchived(dropped.number, false);
    await setStatus(dropped.number, stalled.id);
    await setContractArchived(dropped.number, true);
    expect((await statusBySlug(awaiting.slug)).inUseCount).toBe(0);

    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-statuses/${awaiting.id}/archive`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().contractStatus.archivedAt).not.toBeNull();
  });

  it("guards a status held only by an archived contract", async () => {
    // `stalled` now holds one live contract and one archived one; move
    // the live one away and the archived reference alone still blocks.
    await setStatus(paused.number, parked.id);
    expect((await statusBySlug(stalled.slug)).inUseCount).toBe(1);

    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-statuses/${stalled.id}/archive`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().detail).toContain("1 contract");
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
      "contract_status.created",
      "contract_status.renamed",
      "contract_status.reordered",
      "contract_status.archived",
      "contract_status.restored",
      "contract_status.deleted",
    ]) {
      expect(actions.has(action), action).toBe(true);
    }
    for (const row of rows) {
      expect(row.entityType).toBe("system");
      expect(row.visibility).toBe("admin_only");
      expect(row.actorId).toBe(actorId);
    }
  });

  it("carries the stage on a create and an archive, and old/new names on a rename", async () => {
    const rows = await auditRows();
    const create = rows.find(
      (row) =>
        row.action === "contract_status.created" &&
        (row.payload as { slug?: string }).slug === "on_hold",
    );
    expect(create?.payload).toMatchObject({
      slug: "on_hold",
      displayName: "On hold",
      stage: "review",
    });
    const rename = rows.find(
      (row) =>
        row.action === "contract_status.renamed" &&
        (row.payload as { slug?: string }).slug === "terminated",
    );
    expect(rename?.payload).toMatchObject({
      slug: "terminated",
      from: "Terminated",
      to: "Ended early",
    });
    const archive = rows.find(
      (row) =>
        row.action === "contract_status.archived" &&
        (row.payload as { slug?: string }).slug === "internal_review",
    );
    expect(archive?.payload).toMatchObject({
      slug: "internal_review",
      stage: "review",
      inUseCount: 0,
    });
  });

  it("does not log a rename to the current name", async () => {
    const before = (await auditRows()).length;
    const active = await statusBySlug("active");
    const res = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/contract-statuses/${active.id}`,
      cookies: adminCookies,
      payload: { displayName: active.displayName },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await auditRows()).toHaveLength(before);
  });
});
