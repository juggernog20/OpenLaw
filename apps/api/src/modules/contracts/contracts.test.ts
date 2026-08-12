// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract record core (M8/1) at the HTTP seam. Creation takes a
 * title and a type and assigns the CTR-003 global number — immutable,
 * monotonic, and the key every other route is addressed by. The list
 * shows the reference, title, type, and status, newest first, and hides
 * archived contracts unless asked. The record read, the DES-017
 * per-field PATCH, archive, and restore all address a contract by its
 * number. Status changes are unrestricted (CTR-001) and the stage rides
 * along derived, never stored. Everything is Member+ (Administrators
 * and Legal Team Members); Contributors and Business Users are refused
 * on every route. Every mutation lands in the activity log inside the
 * same transaction (DD-017), asserted by reading the table — the log
 * has no read routes until M9.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, asc, eq, inArray, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

const MEMBER = {
  email: "member@example.com",
  displayName: "Legal Member",
  password: "correct-horse-battery",
} as const;
const CONTRIBUTOR = {
  email: "contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery",
} as const;
const BUSINESS = {
  email: "business@example.com",
  displayName: "Bao Business",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let adminCookies: Record<string, string>;
let memberCookies: Record<string, string>;

beforeAll(async () => {
  harness = await startHarness();
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(res.statusCode, res.body).toBe(201);

  for (const [fixture, role] of [
    [MEMBER, "legal_team_member"],
    [CONTRIBUTOR, "contributor"],
    [BUSINESS, "business_user"],
  ] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, user.id));
  }
  adminCookies = await signInCookies(harness.app, ADMIN.email, ADMIN.password);
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
}, 120_000);

afterAll(async () => {
  await harness.stop();
});

interface ContractRow {
  id: string;
  number: number;
  title: string;
  contractTypeId: string;
  contractTypeName: string;
  statusId: string;
  statusName: string;
  stage: string;
  priority: string;
  risk: string | null;
  description: string | null;
  archivedAt: string | null;
}

interface Option {
  id: string;
  slug: string;
  displayName: string;
}

const options = async () => {
  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: memberCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as {
    contractTypes: Option[];
    contractStatuses: (Option & { stage: string })[];
  };
};

const typeBySlug = async (slug: string): Promise<Option> => {
  const option = (await options()).contractTypes.find((row) => row.slug === slug);
  expect(option, slug).toBeDefined();
  return option!;
};

const statusBySlug = async (slug: string): Promise<Option & { stage: string }> => {
  const option = (await options()).contractStatuses.find((row) => row.slug === slug);
  expect(option, slug).toBeDefined();
  return option!;
};

const listContracts = async (
  cookies: Record<string, string>,
  includeArchived = false,
): Promise<ContractRow[]> => {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/contracts${includeArchived ? "?includeArchived=true" : ""}`,
    cookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().contracts;
};

const createContract = (cookies: Record<string, string>, payload: Record<string, unknown>) =>
  harness.app.inject({ method: "POST", url: "/api/v1/contracts", cookies, payload });

/** Creates a contract of the given type, requiring success. */
const newContract = async (title: string, typeSlug = "nda"): Promise<ContractRow> => {
  const type = await typeBySlug(typeSlug);
  const res = await createContract(adminCookies, { title, contractTypeId: type.id });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().contract;
};

const getContract = (cookies: Record<string, string>, number: number | string) =>
  harness.app.inject({ method: "GET", url: `/api/v1/contracts/${number}`, cookies });

const patchContract = (
  cookies: Record<string, string>,
  number: number,
  payload: Record<string, unknown>,
) => harness.app.inject({ method: "PATCH", url: `/api/v1/contracts/${number}`, cookies, payload });

const archiveContract = (cookies: Record<string, string>, number: number) =>
  harness.app.inject({ method: "POST", url: `/api/v1/contracts/${number}/archive`, cookies });

const restoreContract = (cookies: Record<string, string>, number: number) =>
  harness.app.inject({ method: "POST", url: `/api/v1/contracts/${number}/restore`, cookies });

const contractAuditRows = () =>
  harness.db
    .select()
    .from(activityLog)
    .where(
      inArray(activityLog.action, [
        "contract.created",
        "contract.updated",
        "contract.status_changed",
        "contract.archived",
        "contract.restored",
      ]),
    )
    .orderBy(asc(activityLog.createdAt));

const auditRowsFor = async (id: string) =>
  (await contractAuditRows()).filter((row) => row.entityId === id);

describe("the Member+ access floor on contract surfaces", () => {
  it("refuses an unauthenticated request as 401 on every route", async () => {
    const attempts = [
      harness.app.inject({ method: "GET", url: "/api/v1/contracts" }),
      harness.app.inject({ method: "GET", url: "/api/v1/contracts/options" }),
      harness.app.inject({
        method: "POST",
        url: "/api/v1/contracts",
        payload: { title: "Ghost NDA", contractTypeId: "any" },
      }),
      harness.app.inject({ method: "GET", url: "/api/v1/contracts/99999" }),
      harness.app.inject({
        method: "PATCH",
        url: "/api/v1/contracts/99999",
        payload: { title: "Ghost NDA" },
      }),
      harness.app.inject({ method: "POST", url: "/api/v1/contracts/99999/archive" }),
      harness.app.inject({ method: "POST", url: "/api/v1/contracts/99999/restore" }),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.statusCode, res.body).toBe(401);
    }
  });

  it("refuses a Contributor and a Business User as 403 problem+json, read and write", async () => {
    for (const fixture of [CONTRIBUTOR, BUSINESS]) {
      const cookies = await signInCookies(harness.app, fixture.email, fixture.password);
      const attempts = [
        harness.app.inject({ method: "GET", url: "/api/v1/contracts", cookies }),
        harness.app.inject({ method: "GET", url: "/api/v1/contracts/options", cookies }),
        harness.app.inject({
          method: "POST",
          url: "/api/v1/contracts",
          cookies,
          payload: { title: "Sneaky NDA", contractTypeId: "any" },
        }),
        harness.app.inject({ method: "GET", url: "/api/v1/contracts/99999", cookies }),
        harness.app.inject({
          method: "PATCH",
          url: "/api/v1/contracts/99999",
          cookies,
          payload: { title: "Sneaky rename" },
        }),
        harness.app.inject({ method: "POST", url: "/api/v1/contracts/99999/archive", cookies }),
        harness.app.inject({ method: "POST", url: "/api/v1/contracts/99999/restore", cookies }),
      ];
      for (const res of await Promise.all(attempts)) {
        expect(res.statusCode, `${fixture.email}: ${res.body}`).toBe(403);
        expect(res.headers["content-type"]).toContain("application/problem+json");
      }
    }
    // None of the refused writes landed.
    expect(
      (await listContracts(adminCookies, true)).some((row) => row.title === "Sneaky NDA"),
    ).toBe(false);
  });

  it("admits a Legal Team Member to read and write", async () => {
    const type = await typeBySlug("msa");
    const created = await createContract(memberCookies, {
      title: "Member created MSA",
      contractTypeId: type.id,
    });
    expect(created.statusCode, created.body).toBe(201);
    const read = await getContract(memberCookies, created.json().contract.number);
    expect(read.statusCode, read.body).toBe(200);
  });
});

describe("GET /contracts/options — the create dialog's picker source", () => {
  it("answers a Legal Team Member with the live types and statuses in display order", async () => {
    const { contractTypes, contractStatuses } = await options();
    expect(contractTypes.map((row) => row.slug)).toEqual([
      "nda",
      "msa",
      "sow",
      "sales",
      "vendor",
      "employment",
      "license",
      "other",
    ]);
    expect(contractStatuses.map((row) => row.slug)).toEqual([
      "draft",
      "internal_review",
      "redlining",
      "awaiting_approval",
      "out_for_signature",
      "active",
      "expired",
      "terminated",
    ]);
    // Each status carries its fixed stage — the picker never has to
    // guess what a renamed label means (CTR-001).
    expect(contractStatuses.find((row) => row.slug === "redlining")?.stage).toBe("review");

    // The same member is still refused on the settings surfaces
    // (SET-002): this picker read exists because those are closed.
    for (const url of ["/api/v1/contract-types", "/api/v1/contract-statuses"]) {
      const settings = await harness.app.inject({ method: "GET", url, cookies: memberCookies });
      expect(settings.statusCode, settings.body).toBe(403);
    }
  });

  it("leaves out archived types and archived statuses", async () => {
    const license = await typeBySlug("license");
    const terminated = await statusBySlug("terminated");
    const archivedType = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-types/${license.id}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(archivedType.statusCode, archivedType.body).toBe(200);
    const archivedStatus = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-statuses/${terminated.id}/archive`,
      cookies: adminCookies,
    });
    expect(archivedStatus.statusCode, archivedStatus.body).toBe(200);
    try {
      const live = await options();
      expect(live.contractTypes.some((row) => row.slug === "license")).toBe(false);
      expect(live.contractStatuses.some((row) => row.slug === "terminated")).toBe(false);
    } finally {
      for (const url of [
        `/api/v1/contract-types/${license.id}/restore`,
        `/api/v1/contract-statuses/${terminated.id}/restore`,
      ]) {
        const restored = await harness.app.inject({ method: "POST", url, cookies: adminCookies });
        expect(restored.statusCode, restored.body).toBe(200);
      }
    }
  });
});

describe("POST /contracts — creation and the CTR-003 number", () => {
  it("takes a title and a type, and defaults every other field", async () => {
    const nda = await typeBySlug("nda");
    const res = await createContract(adminCookies, {
      title: "Acme mutual NDA",
      contractTypeId: nda.id,
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().contract).toMatchObject({
      title: "Acme mutual NDA",
      contractTypeId: nda.id,
      contractTypeName: "NDA",
      // The protected draft seed, picked by the server (CTR-001).
      statusName: "Draft",
      stage: "draft",
      priority: "medium",
      // Not yet assessed, which is not the same as low (CTR-005).
      risk: null,
      description: null,
      archivedAt: null,
    });
    expect(res.json().contract.number).toBeGreaterThan(0);
  });

  it("assigns a monotonic global number and renders it in the record's own address", async () => {
    const first = await newContract("Numbering first");
    const second = await newContract("Numbering second");
    expect(second.number).toBeGreaterThan(first.number);

    const read = await getContract(memberCookies, second.number);
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json().contract.title).toBe("Numbering second");
  });

  it("refuses to let a client set or correct the number", async () => {
    const nda = await typeBySlug("nda");
    // Strict bodies everywhere: an unknown key is a client bug, not a
    // silently stripped field that looks like it worked.
    const seeded = await createContract(adminCookies, {
      title: "Numbered by hand",
      contractTypeId: nda.id,
      number: 4242,
    });
    expect(seeded.statusCode, seeded.body).toBe(400);

    const existing = await newContract("Number is immutable");
    const patched = await patchContract(adminCookies, existing.number, { number: 4242 });
    expect(patched.statusCode, patched.body).toBe(400);
    const read = await getContract(adminCookies, existing.number);
    expect(read.json().contract.number).toBe(existing.number);
  });

  it("rejects a blank title, a missing type, an unknown type, and an archived type as 400", async () => {
    const nda = await typeBySlug("nda");
    const blank = await createContract(adminCookies, {
      title: "   ",
      contractTypeId: nda.id,
    });
    expect(blank.statusCode, blank.body).toBe(400);
    expect(blank.headers["content-type"]).toContain("application/problem+json");

    const noType = await createContract(adminCookies, { title: "No type" });
    expect(noType.statusCode, noType.body).toBe(400);

    const unknown = await createContract(adminCookies, {
      title: "Unknown type",
      contractTypeId: "no-such-id",
    });
    expect(unknown.statusCode, unknown.body).toBe(400);

    const sow = await typeBySlug("sow");
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-types/${sow.id}/archive`,
      cookies: adminCookies,
      payload: {},
    });
    expect(archived.statusCode, archived.body).toBe(200);
    try {
      const toArchived = await createContract(adminCookies, {
        title: "Archived type",
        contractTypeId: sow.id,
      });
      expect(toArchived.statusCode, toArchived.body).toBe(400);
      expect(
        (await listContracts(adminCookies, true)).some((row) => row.title === "Archived type"),
      ).toBe(false);
    } finally {
      const restored = await harness.app.inject({
        method: "POST",
        url: `/api/v1/contract-types/${sow.id}/restore`,
        cookies: adminCookies,
      });
      expect(restored.statusCode, restored.body).toBe(200);
    }
  });

  it("writes contract.created with the reference, type, and status, Legal Only", async () => {
    const created = await newContract("Audited creation", "vendor");
    const rows = await auditRowsFor(created.id);
    expect(rows.map((row) => row.action)).toEqual(["contract.created"]);
    expect(rows[0]?.entityType).toBe("contract");
    expect(rows[0]?.visibility).toBe("legal_only");
    expect(rows[0]?.actorId).not.toBeNull();
    expect(rows[0]?.payload).toMatchObject({
      number: created.number,
      title: "Audited creation",
      contractType: "Vendor",
      status: "Draft",
    });
  });
});

describe("GET /contracts — the list", () => {
  it("carries the reference, title, type, and status, newest first", async () => {
    const older = await newContract("List order older");
    const newer = await newContract("List order newer");
    const rows = await listContracts(memberCookies);
    const numbers = rows.map((row) => row.number);
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
    expect(numbers.indexOf(newer.number)).toBeLessThan(numbers.indexOf(older.number));

    const row = rows.find((candidate) => candidate.id === newer.id);
    expect(row).toMatchObject({
      number: newer.number,
      title: "List order newer",
      contractTypeName: "NDA",
      statusName: "Draft",
      stage: "draft",
    });
  });

  it("excludes archived contracts by default and includes them on request", async () => {
    const contract = await newContract("Soon archived");
    const archived = await archiveContract(memberCookies, contract.number);
    expect(archived.statusCode, archived.body).toBe(200);
    expect(archived.json().contract.archivedAt).not.toBeNull();

    expect((await listContracts(memberCookies)).some((row) => row.id === contract.id)).toBe(false);
    expect((await listContracts(memberCookies, true)).some((row) => row.id === contract.id)).toBe(
      true,
    );
  });
});

describe("GET /contracts/:number — the record read", () => {
  it("answers an archived contract too — the restore surface needs to see it", async () => {
    const contract = await newContract("Archived readable");
    const archived = await archiveContract(adminCookies, contract.number);
    expect(archived.statusCode, archived.body).toBe(200);

    const res = await getContract(memberCookies, contract.number);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().contract.archivedAt).not.toBeNull();
  });

  it("404s an unknown number and 400s a number that is not one", async () => {
    const missing = await getContract(memberCookies, 999_999);
    expect(missing.statusCode, missing.body).toBe(404);
    expect(missing.headers["content-type"]).toContain("application/problem+json");

    const nonsense = await getContract(memberCookies, "not-a-number");
    expect(nonsense.statusCode, nonsense.body).toBe(400);
  });
});

describe("PATCH /contracts/:number — the DES-017 per-field commits", () => {
  it("commits title, description, priority, and risk, each on its own", async () => {
    const contract = await newContract("Per-field edits");

    const title = await patchContract(memberCookies, contract.number, { title: "Renamed MSA" });
    expect(title.statusCode, title.body).toBe(200);
    expect(title.json().contract.title).toBe("Renamed MSA");

    const description = await patchContract(memberCookies, contract.number, {
      description: "Three-year platform engagement.",
    });
    expect(description.json().contract.description).toBe("Three-year platform engagement.");

    const priority = await patchContract(memberCookies, contract.number, { priority: "high" });
    expect(priority.json().contract.priority).toBe("high");

    const risk = await patchContract(memberCookies, contract.number, { risk: "critical" });
    expect(risk.json().contract.risk).toBe("critical");

    // The corrections survive the round trip.
    const read = await getContract(memberCookies, contract.number);
    expect(read.json().contract).toMatchObject({
      title: "Renamed MSA",
      description: "Three-year platform engagement.",
      priority: "high",
      risk: "critical",
    });
  });

  it("clears the description and returns risk to not-yet-assessed with null", async () => {
    const contract = await newContract("Clearable fields");
    const set = await patchContract(adminCookies, contract.number, {
      description: "Context.",
      risk: "low",
    });
    expect(set.statusCode, set.body).toBe(200);

    const cleared = await patchContract(adminCookies, contract.number, {
      description: "   ",
      risk: null,
    });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(cleared.json().contract).toMatchObject({ description: null, risk: null });
  });

  it("rejects a blank title, an unknown key, and a level outside the severity ramp", async () => {
    const contract = await newContract("Refusals leave no mark");

    for (const payload of [
      { title: "   " },
      { priority: "urgent" },
      { risk: "unknown" },
      { priority: null },
      { manager_id: "someone" },
    ]) {
      const res = await patchContract(adminCookies, contract.number, payload);
      expect(res.statusCode, `${JSON.stringify(payload)}: ${res.body}`).toBe(400);
    }
    const read = await getContract(adminCookies, contract.number);
    expect(read.json().contract).toMatchObject({
      title: "Refusals leave no mark",
      priority: "medium",
      risk: null,
    });
  });

  it("refuses to edit an archived contract as 409 — restore first", async () => {
    const contract = await newContract("Frozen while archived");
    const archived = await archiveContract(adminCookies, contract.number);
    expect(archived.statusCode, archived.body).toBe(200);

    const res = await patchContract(adminCookies, contract.number, { title: "Thawed" });
    expect(res.statusCode, res.body).toBe(409);
    const read = await getContract(adminCookies, contract.number);
    expect(read.json().contract.title).toBe("Frozen while archived");
  });

  it("404s an unknown number", async () => {
    const res = await patchContract(adminCookies, 999_999, { title: "Nobody" });
    expect(res.statusCode, res.body).toBe(404);
  });

  it("writes contract.updated with the before/after values, and none when nothing changed", async () => {
    const contract = await newContract("Audited edits");
    const res = await patchContract(memberCookies, contract.number, {
      title: "Audited edits, renamed",
      priority: "critical",
    });
    expect(res.statusCode, res.body).toBe(200);

    const updated = (await auditRowsFor(contract.id)).find(
      (row) => row.action === "contract.updated",
    );
    expect(updated?.visibility).toBe("legal_only");
    expect(updated?.payload).toMatchObject({
      number: contract.number,
      title: "Audited edits, renamed",
      changed: {
        title: { from: "Audited edits", to: "Audited edits, renamed" },
        priority: { from: "medium", to: "critical" },
      },
    });

    // A repeat of the same values changes nothing, so it writes no
    // misleading from==to entry.
    const again = await patchContract(memberCookies, contract.number, {
      title: "Audited edits, renamed",
      priority: "critical",
    });
    expect(again.statusCode, again.body).toBe(200);
    expect(
      (await auditRowsFor(contract.id)).filter((row) => row.action === "contract.updated"),
    ).toHaveLength(1);
  });
});

describe("the CTR-001 status change", () => {
  it("moves to any status, forwards and backwards, and derives the stage", async () => {
    const contract = await newContract("Deals collapse and reopen");
    const active = await statusBySlug("active");
    const redlining = await statusBySlug("redlining");

    const forward = await patchContract(memberCookies, contract.number, { statusId: active.id });
    expect(forward.statusCode, forward.body).toBe(200);
    expect(forward.json().contract).toMatchObject({
      statusId: active.id,
      statusName: "Active",
      stage: "active",
    });

    // Stage regression is allowed — a signed deal can reopen (CTR-001).
    const back = await patchContract(memberCookies, contract.number, { statusId: redlining.id });
    expect(back.statusCode, back.body).toBe(200);
    expect(back.json().contract).toMatchObject({
      statusName: "Redlining with counterparty",
      stage: "review",
    });
  });

  it("refuses an unknown status and an archived one as 400", async () => {
    const contract = await newContract("Status refusals");
    const unknown = await patchContract(adminCookies, contract.number, { statusId: "no-such-id" });
    expect(unknown.statusCode, unknown.body).toBe(400);

    const terminated = await statusBySlug("terminated");
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contract-statuses/${terminated.id}/archive`,
      cookies: adminCookies,
    });
    expect(archived.statusCode, archived.body).toBe(200);
    try {
      const toArchived = await patchContract(adminCookies, contract.number, {
        statusId: terminated.id,
      });
      expect(toArchived.statusCode, toArchived.body).toBe(400);
    } finally {
      const restored = await harness.app.inject({
        method: "POST",
        url: `/api/v1/contract-statuses/${terminated.id}/restore`,
        cookies: adminCookies,
      });
      expect(restored.statusCode, restored.body).toBe(200);
    }
    const read = await getContract(adminCookies, contract.number);
    expect(read.json().contract.stage).toBe("draft");
  });

  it("writes contract.status_changed with its own verb, carrying both stages", async () => {
    const contract = await newContract("Audited status change");
    const outForSignature = await statusBySlug("out_for_signature");
    const res = await patchContract(memberCookies, contract.number, {
      statusId: outForSignature.id,
      priority: "high",
    });
    expect(res.statusCode, res.body).toBe(200);

    const rows = await auditRowsFor(contract.id);
    const statusChanged = rows.find((row) => row.action === "contract.status_changed");
    expect(statusChanged?.visibility).toBe("legal_only");
    expect(statusChanged?.payload).toMatchObject({
      number: contract.number,
      from: "Draft",
      to: "Out for signature",
      fromStage: "draft",
      toStage: "signature",
    });
    // The status keeps its own verb; the ordinary field edit rides the
    // generic one, in the same transaction.
    const updated = rows.find((row) => row.action === "contract.updated");
    expect(updated?.payload).toMatchObject({
      changed: { priority: { from: "medium", to: "high" } },
    });
  });
});

describe("archive and restore", () => {
  it("archives a mistaken contract and restores it, auditing both", async () => {
    const contract = await newContract("Archive round trip");
    const archived = await archiveContract(memberCookies, contract.number);
    expect(archived.statusCode, archived.body).toBe(200);
    expect(archived.json().contract.archivedAt).not.toBeNull();

    const restored = await restoreContract(memberCookies, contract.number);
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json().contract.archivedAt).toBeNull();
    expect((await listContracts(memberCookies)).some((row) => row.id === contract.id)).toBe(true);

    const actions = (await auditRowsFor(contract.id)).map((row) => row.action);
    expect(actions).toEqual(["contract.created", "contract.archived", "contract.restored"]);
  });

  it("refuses a double archive and a restore of a live contract as 409, and 404s an unknown number", async () => {
    const contract = await newContract("Archive refusals");
    const first = await archiveContract(adminCookies, contract.number);
    expect(first.statusCode, first.body).toBe(200);
    const again = await archiveContract(adminCookies, contract.number);
    expect(again.statusCode, again.body).toBe(409);

    const restored = await restoreContract(adminCookies, contract.number);
    expect(restored.statusCode, restored.body).toBe(200);
    const notArchived = await restoreContract(adminCookies, contract.number);
    expect(notArchived.statusCode, notArchived.body).toBe(409);

    expect((await archiveContract(adminCookies, 999_999)).statusCode).toBe(404);
    expect((await restoreContract(adminCookies, 999_999)).statusCode).toBe(404);
  });
});

describe("the DD-017 activity trail", () => {
  it("keys every contract entry to a listable contract", async () => {
    const rows = await contractAuditRows();
    expect(rows.length).toBeGreaterThan(0);
    const ids = new Set((await listContracts(adminCookies, true)).map((row) => row.id));
    for (const row of rows) {
      expect(row.entityType).toBe("contract");
      expect(row.visibility).toBe("legal_only");
      expect(row.actorId).not.toBeNull();
      expect(ids.has(row.entityId!)).toBe(true);
    }
  });
});
