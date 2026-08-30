// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract record core (M8/1) at the HTTP seam. Creation takes a
 * title and a type and assigns the CTR-003 global number — immutable,
 * monotonic, and the key every other route is addressed by. The list
 * shows the reference, title, type, and status, newest first, and hides
 * archived contracts unless asked. The record read, the DES-017
 * per-field PATCH, archive, and restore all address a contract by its
 * number. Status changes are unrestricted (CTR-001) and the stage rides
 * along derived, never stored. The CTR-010 value is the one field that
 * is not a scalar: amount, currency, and cadence commit as a group,
 * clear as a group, and are refused in part.
 *
 * Access has two floors (M9/1). Every write is Member+ (Administrators
 * and Legal Team Members), and so is the picker read behind the create
 * dialog. The list and the record read take a Contributor as well, and
 * answer them exactly the contracts they hold a `contract_team` row on
 * — a contract they are not on reads as one that does not exist.
 * Business Users are refused on every route.
 *
 * Every mutation lands in the activity log inside the same transaction
 * (DD-017), asserted by reading the table — the log has no read routes
 * until M9.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  asc,
  contractCounterparties,
  contracts,
  counterparties,
  eq,
  inArray,
  sql,
  users,
} from "@openlaw/db";
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
/** A second Contributor, deliberately left off every team: their list
 * is what an empty team list answers with (M9/1). */
const OUTSIDER = {
  email: "outsider@example.com",
  displayName: "Ola Outsider",
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
let contributorCookies: Record<string, string>;
let outsiderCookies: Record<string, string>;
/** Fixture email → user id, for the owner and team routes. */
const userIds = new Map<string, string>();
const idOf = (fixture: { email: string }): string => {
  const id = userIds.get(fixture.email);
  expect(id, fixture.email).toBeDefined();
  return id!;
};

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
    [OUTSIDER, "contributor"],
    [BUSINESS, "business_user"],
  ] as const) {
    const user = await provisionUser(harness.app.auth, fixture);
    await harness.db.update(users).set({ role }).where(eq(users.id, user.id));
    userIds.set(fixture.email, user.id);
  }
  const [admin] = await harness.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, ADMIN.email))
    .limit(1);
  userIds.set(ADMIN.email, admin!.id);
  adminCookies = await signInCookies(harness.app, ADMIN.email, ADMIN.password);
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
  contributorCookies = await signInCookies(harness.app, CONTRIBUTOR.email, CONTRIBUTOR.password);
  outsiderCookies = await signInCookies(harness.app, OUTSIDER.email, OUTSIDER.password);
});

afterAll(async () => {
  await harness.stop();
});

/** A person as every contract surface renders them (CTR-004). */
interface Person {
  id: string;
  displayName: string;
  image: string | null;
  archived: boolean;
}

interface ContractRow {
  id: string;
  number: number;
  title: string;
  contractTypeId: string;
  contractTypeName: string;
  statusId: string;
  statusName: string;
  stage: string;
  /** The Owner (CTR-004); null = unassigned, which reads as triage. */
  manager: Person | null;
  /** Our side (CTR-011); null = which of ours signs is not known yet. */
  entity: { id: string; legalName: string } | null;
  /** Their side, reduced to the one name a list row shows (CTR-011);
   * null = nobody is recorded on the other side yet. */
  primaryCounterparty: { id: string; name: string } | null;
  priority: string;
  risk: string | null;
  /** CTR-010's amount, currency, and cadence as one field; null = no
   * value is recorded, which is what an NDA looks like. */
  value: { amount: number; currency: string; cadence: string } | null;
  description: string | null;
  archivedAt: string | null;
}

interface TeamMember extends Person {
  role: string;
}

/** One party on the other side, as the record read answers it. */
interface RecordCounterparty {
  id: string;
  name: string;
  jurisdiction: string | null;
  isPrimary: boolean;
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

/**
 * Every contract this viewer reaches, walked page by page (CTR-024).
 *
 * The list is bounded, so a test that needs the whole of it has to say
 * so — `listContracts` answers a page, and a page is not the table.
 */
const everyContract = async (
  cookies: Record<string, string>,
  includeArchived = false,
): Promise<ContractRow[]> => {
  const all: ContractRow[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({
      ...(includeArchived ? { includeArchived: "true" } : {}),
      ...(cursor === null ? {} : { cursor }),
    });
    const res = await harness.app.inject({
      method: "GET",
      url: `/api/v1/contracts?${query.toString()}`,
      cookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    all.push(...(res.json().contracts as ContractRow[]));
    cursor = res.json().nextCursor as string | null;
  } while (cursor !== null);
  return all;
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

/** Registers one of our entities, requiring success — the M7 registry
 * is where the signing-entity picker reads from (CTR-011). */
const newEntity = async (legalName: string): Promise<{ id: string; legalName: string }> => {
  const types = await harness.app.inject({
    method: "GET",
    url: "/api/v1/entities/types",
    cookies: memberCookies,
  });
  expect(types.statusCode, types.body).toBe(200);
  const corporation = (types.json().entityTypes as Option[]).find(
    (row) => row.slug === "corporation",
  );
  expect(corporation).toBeDefined();
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/entities",
    cookies: adminCookies,
    payload: { legalName, entityTypeId: corporation!.id },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().entity;
};

const getContract = (cookies: Record<string, string>, number: number | string) =>
  harness.app.inject({ method: "GET", url: `/api/v1/contracts/${number}`, cookies });

/** The record read's team roster, requiring success. */
const teamOf = async (number: number): Promise<TeamMember[]> => {
  const res = await getContract(adminCookies, number);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().team;
};

const addTeamMember = (
  cookies: Record<string, string>,
  number: number,
  payload: Record<string, unknown>,
) =>
  harness.app.inject({ method: "POST", url: `/api/v1/contracts/${number}/team`, cookies, payload });

const removeTeamMember = (
  cookies: Record<string, string>,
  number: number,
  userId: string,
  role: string,
) =>
  harness.app.inject({
    method: "DELETE",
    url: `/api/v1/contracts/${number}/team/${userId}/${role}`,
    cookies,
  });

const addCounterparty = (
  cookies: Record<string, string>,
  number: number,
  payload: Record<string, unknown>,
) =>
  harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/counterparties`,
    cookies,
    payload,
  });

const removeCounterparty = (
  cookies: Record<string, string>,
  number: number,
  counterpartyId: string,
) =>
  harness.app.inject({
    method: "DELETE",
    url: `/api/v1/contracts/${number}/counterparties/${counterpartyId}`,
    cookies,
  });

const setPrimaryCounterparty = (
  cookies: Record<string, string>,
  number: number,
  counterpartyId: string,
) =>
  harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${number}/counterparties/${counterpartyId}/primary`,
    cookies,
  });

/** The record read's party list, requiring success. */
const counterpartiesOf = async (number: number): Promise<RecordCounterparty[]> => {
  const res = await getContract(adminCookies, number);
  expect(res.statusCode, res.body).toBe(200);
  return res.json().counterparties;
};

/** Puts a named counterparty on a contract, requiring success. */
const putCounterpartyOn = async (number: number, name: string): Promise<RecordCounterparty> => {
  const res = await addCounterparty(adminCookies, number, { name });
  expect(res.statusCode, res.body).toBe(201);
  const parties = res.json().counterparties as RecordCounterparty[];
  const party = parties.find((row) => row.name === name);
  expect(party, name).toBeDefined();
  return party!;
};

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
        "contract.team_added",
        "contract.team_removed",
        "contract.counterparty_added",
        "contract.counterparty_removed",
        "contract.counterparty_primary_changed",
        "contract.archived",
        "contract.restored",
      ]),
    )
    // The id breaks a same-instant tie, and the ties are real: two
    // entries written in one transaction share `now()`, so removing the
    // primary counterparty and the promotion it causes land on the same
    // timestamp. uuidv7 is time-ordered, so the id is still the order
    // they happened in.
    .orderBy(asc(activityLog.createdAt), asc(activityLog.id));

const auditRowsFor = async (id: string) =>
  (await contractAuditRows()).filter((row) => row.entityId === id);

/**
 * Every mutation seam a contract has, aimed at whoever holds these
 * cookies: create, the per-field PATCH, the status change and the value
 * and custom fields that ride it, archive, restore, the team, and the
 * counterparties. Business Users are refused at the role floor; a
 * Contributor reaches PATCH so it can apply DD-015 after record reach.
 */
const refusedWrites = (cookies: Record<string, string>) => [
  harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies,
    payload: { title: "Sneaky NDA", contractTypeId: "any" },
  }),
  harness.app.inject({
    method: "PATCH",
    url: "/api/v1/contracts/99999",
    cookies,
    payload: { title: "Sneaky rename" },
  }),
  harness.app.inject({
    method: "PATCH",
    url: "/api/v1/contracts/99999",
    cookies,
    payload: { statusId: "any" },
  }),
  harness.app.inject({
    method: "PATCH",
    url: "/api/v1/contracts/99999",
    cookies,
    payload: { value: { amount: 100, currency: "USD", cadence: "one_time" } },
  }),
  harness.app.inject({
    method: "PATCH",
    url: "/api/v1/contracts/99999",
    cookies,
    payload: { customFields: { governing_law: "England" } },
  }),
  harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts/99999/team",
    cookies,
    payload: { userId: "any", role: "member" },
  }),
  harness.app.inject({
    method: "DELETE",
    url: "/api/v1/contracts/99999/team/any/member",
    cookies,
  }),
  harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts/99999/counterparties",
    cookies,
    payload: { name: "Sneaky Counterparty Ltd" },
  }),
  harness.app.inject({
    method: "DELETE",
    url: "/api/v1/contracts/99999/counterparties/any",
    cookies,
  }),
  harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts/99999/counterparties/any/primary",
    cookies,
  }),
  harness.app.inject({ method: "POST", url: "/api/v1/contracts/99999/archive", cookies }),
  harness.app.inject({ method: "POST", url: "/api/v1/contracts/99999/restore", cookies }),
];

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
      harness.app.inject({
        method: "POST",
        url: "/api/v1/contracts/99999/counterparties",
        payload: { name: "Ghost Counterparty Ltd" },
      }),
      harness.app.inject({
        method: "DELETE",
        url: "/api/v1/contracts/99999/counterparties/any",
      }),
      harness.app.inject({
        method: "POST",
        url: "/api/v1/contracts/99999/counterparties/any/primary",
      }),
      harness.app.inject({ method: "POST", url: "/api/v1/contracts/99999/archive" }),
      harness.app.inject({ method: "POST", url: "/api/v1/contracts/99999/restore" }),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.statusCode, res.body).toBe(401);
    }
  });

  it("refuses a Business User as 403 problem+json on every route, read and write", async () => {
    const cookies = await signInCookies(harness.app, BUSINESS.email, BUSINESS.password);
    const attempts = [
      harness.app.inject({ method: "GET", url: "/api/v1/contracts", cookies }),
      harness.app.inject({ method: "GET", url: "/api/v1/contracts/options", cookies }),
      harness.app.inject({ method: "GET", url: "/api/v1/contracts/99999", cookies }),
      ...refusedWrites(cookies),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.statusCode, `${BUSINESS.email}: ${res.body}`).toBe(403);
      expect(res.headers["content-type"]).toContain("application/problem+json");
    }
    // None of the refused writes landed.
    expect(
      (await listContracts(adminCookies, true)).some((row) => row.title === "Sneaky NDA"),
    ).toBe(false);
  });

  it("keeps creation, relationship writes, and the picker Member+ while PATCH omits unknown records", async () => {
    const options = await harness.app.inject({
      method: "GET",
      url: "/api/v1/contracts/options",
      cookies: contributorCookies,
    });
    expect(options.statusCode, options.body).toBe(403);

    const attempts = await Promise.all(refusedWrites(contributorCookies));
    // PATCH first performs the same reach check as GET: an absent record
    // and an unreached one are both omitted before field policy runs.
    for (const res of attempts.slice(1, 5)) {
      expect(res.statusCode, `${CONTRIBUTOR.email}: ${res.body}`).toBe(404);
    }
    for (const res of [attempts[0], ...attempts.slice(5)]) {
      expect(res!.statusCode, `${CONTRIBUTOR.email}: ${res!.body}`).toBe(403);
      expect(res!.headers["content-type"]).toContain("application/problem+json");
    }
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

describe("Contributor team access to the contract record (M9/1)", () => {
  /** Puts someone on a contract's team, requiring success. */
  const putOnTeam = async (number: number, userId: string, role = "contributor") => {
    const res = await addTeamMember(adminCookies, number, { userId, role });
    expect(res.statusCode, res.body).toBe(201);
  };

  it("opens a contract they hold a team row on", async () => {
    const contract = await newContract("Contributor reads this one");
    await putOnTeam(contract.number, idOf(CONTRIBUTOR));

    const res = await getContract(contributorCookies, contract.number);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.contract.title).toBe("Contributor reads this one");
    // The whole record read, not a reduced one: the roster and the
    // other side come back as they do for Member+.
    expect(body.team.map((row: TeamMember) => row.id)).toContain(idOf(CONTRIBUTOR));
    expect(body.counterparties).toEqual([]);
  });

  it("is answered 404 on a contract they hold no team row on, exactly as on one that does not exist", async () => {
    const contract = await newContract("Contributor is not on this one");

    const refused = await getContract(contributorCookies, contract.number);
    const absent = await getContract(contributorCookies, 999_999);
    expect(refused.statusCode, refused.body).toBe(404);
    expect(refused.headers["content-type"]).toContain("application/problem+json");
    // Same shape, same words: a contract they are not on must not read
    // any differently from one nobody ever made. `instance` is left out
    // of the comparison because it is the URL each request asked for.
    const withoutInstance = (body: Record<string, unknown>) => ({ ...body, instance: undefined });
    expect(withoutInstance(refused.json())).toEqual(withoutInstance(absent.json()));
  });

  it("takes the access from the team row itself, whatever role that row carries", async () => {
    const contract = await newContract("Contributor watches this one");
    await putOnTeam(contract.number, idOf(CONTRIBUTOR), "watcher");

    const res = await getContract(contributorCookies, contract.number);
    expect(res.statusCode, res.body).toBe(200);
  });

  it("lists exactly the contracts they are on, archived ones behind the same toggle", async () => {
    const live = await newContract("Contributor list: live");
    const archived = await newContract("Contributor list: archived");
    const other = await newContract("Contributor list: not theirs");
    await putOnTeam(live.number, idOf(CONTRIBUTOR));
    await putOnTeam(archived.number, idOf(CONTRIBUTOR));
    const gone = await archiveContract(adminCookies, archived.number);
    expect(gone.statusCode, gone.body).toBe(200);

    const numbers = (await listContracts(contributorCookies)).map((row) => row.number);
    expect(numbers).toContain(live.number);
    expect(numbers).not.toContain(archived.number);
    expect(numbers).not.toContain(other.number);

    const withArchived = (await listContracts(contributorCookies, true)).map((row) => row.number);
    expect(withArchived).toContain(live.number);
    expect(withArchived).toContain(archived.number);
    expect(withArchived).not.toContain(other.number);

    // Member+ still read the whole company's list — the narrowing is
    // the Contributor's alone.
    const memberNumbers = (await listContracts(memberCookies, true)).map((row) => row.number);
    expect(memberNumbers).toEqual(expect.arrayContaining([live.number, other.number]));
  });

  it("answers a Contributor on no team with an empty list, not a refusal", async () => {
    const res = await harness.app.inject({
      method: "GET",
      url: "/api/v1/contracts",
      cookies: outsiderCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().contracts).toEqual([]);
  });

  it("accepts value but refuses every legal-managed write on a contract they are on", async () => {
    const contract = await newContract("Contributor edits business details only");
    await putOnTeam(contract.number, idOf(CONTRIBUTOR));

    const value = await patchContract(contributorCookies, contract.number, {
      value: { amount: 500, currency: "USD", cadence: "one_time" },
    });
    expect(value.statusCode, value.body).toBe(200);

    const attempts = [
      patchContract(contributorCookies, contract.number, { title: "Renamed by a Contributor" }),
      patchContract(contributorCookies, contract.number, { statusId: "any" }),
      patchContract(contributorCookies, contract.number, { managerId: idOf(CONTRIBUTOR) }),
      patchContract(contributorCookies, contract.number, { customFields: { anything: "x" } }),
      addTeamMember(contributorCookies, contract.number, {
        userId: idOf(MEMBER),
        role: "member",
      }),
      removeTeamMember(contributorCookies, contract.number, idOf(CONTRIBUTOR), "contributor"),
      addCounterparty(contributorCookies, contract.number, { name: "Contributor Added Ltd" }),
      archiveContract(contributorCookies, contract.number),
      restoreContract(contributorCookies, contract.number),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.statusCode, res.body).toBe(403);
      expect(res.headers["content-type"]).toContain("application/problem+json");
    }

    const after = await getContract(contributorCookies, contract.number);
    expect(after.statusCode, after.body).toBe(200);
    expect(after.json().contract).toMatchObject({
      title: "Contributor edits business details only",
      value: { amount: 500, currency: "USD", cadence: "one_time" },
      archivedAt: null,
    });
    expect(after.json().team.map((row: TeamMember) => row.id)).toContain(idOf(CONTRIBUTOR));
  });

  it("stops reading a contract the moment their team row is taken off", async () => {
    const contract = await newContract("Contributor loses this one");
    await putOnTeam(contract.number, idOf(CONTRIBUTOR));
    expect((await getContract(contributorCookies, contract.number)).statusCode).toBe(200);

    const removed = await removeTeamMember(
      adminCookies,
      contract.number,
      idOf(CONTRIBUTOR),
      "contributor",
    );
    expect(removed.statusCode, removed.body).toBe(200);

    const res = await getContract(contributorCookies, contract.number);
    expect(res.statusCode, res.body).toBe(404);
    const removedWrite = await patchContract(contributorCookies, contract.number, {
      value: { amount: 100, currency: "USD", cadence: "one_time" },
    });
    const unknownWrite = await patchContract(contributorCookies, 999_999, {
      value: { amount: 100, currency: "USD", cadence: "one_time" },
    });
    expect(removedWrite.statusCode, removedWrite.body).toBe(404);
    const withoutInstance = (body: Record<string, unknown>) => ({ ...body, instance: undefined });
    expect(withoutInstance(removedWrite.json())).toEqual(withoutInstance(unknownWrite.json()));
    expect((await listContracts(contributorCookies)).map((row) => row.number)).not.toContain(
      contract.number,
    );
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

  it("writes contract.created with the reference, type, and status, at Working Team", async () => {
    const created = await newContract("Audited creation", "vendor");
    const rows = await auditRowsFor(created.id);
    expect(rows.map((row) => row.action)).toEqual(["contract.created"]);
    expect(rows[0]?.entityType).toBe("contract");
    expect(rows[0]?.visibility).toBe("working_team");
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
    // The literal, not the NO_CONTRACT constant: the sentence is part of
    // the security interface (DD-014), and since #254 one definition
    // feeds every surface — so a reword there would pass every
    // refused-equals-absent comparison. This is the one line that makes
    // rewording it a deliberate act.
    expect(missing.json().detail).toBe("No contract exists with this number.");

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
    expect(updated?.visibility).toBe("working_team");
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
      statusName: "With counterparty",
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
    expect(statusChanged?.visibility).toBe("working_team");
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

describe("the Owner (CTR-004)", () => {
  it("is born unassigned, which reads as triage rather than missing data", async () => {
    const contract = await newContract("Owner starts empty");
    expect(contract.manager).toBeNull();
    const read = await getContract(memberCookies, contract.number);
    expect(read.json().contract.manager).toBeNull();
  });

  it("takes a Member+ user and clears back to unassigned", async () => {
    const contract = await newContract("Owner round trip");
    const assigned = await patchContract(memberCookies, contract.number, {
      managerId: idOf(MEMBER),
    });
    expect(assigned.statusCode, assigned.body).toBe(200);
    expect(assigned.json().contract.manager).toMatchObject({
      id: idOf(MEMBER),
      displayName: MEMBER.displayName,
      archived: false,
    });

    const cleared = await patchContract(memberCookies, contract.number, { managerId: null });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(cleared.json().contract.manager).toBeNull();
  });

  it("rides the list, so a Legal Team Member can scan who runs what", async () => {
    const contract = await newContract("Owner on the list");
    await patchContract(adminCookies, contract.number, { managerId: idOf(ADMIN) });
    const row = (await listContracts(memberCookies)).find((entry) => entry.id === contract.id);
    expect(row?.manager?.displayName).toBe(ADMIN.displayName);
  });

  it("refuses an unknown user, one who cannot open a contract, and one who left, as 400", async () => {
    const contract = await newContract("Owner refusals");
    const unknown = await patchContract(adminCookies, contract.number, { managerId: "no-such-id" });
    expect(unknown.statusCode, unknown.body).toBe(400);

    // Contract surfaces are Member+ (DD-013): an Owner who cannot open
    // the record cannot run it.
    for (const fixture of [CONTRIBUTOR, BUSINESS]) {
      const refused = await patchContract(adminCookies, contract.number, {
        managerId: idOf(fixture),
      });
      expect(refused.statusCode, refused.body).toBe(400);
    }

    // An archived person has left (SET-005): they may still appear on
    // records they already ran, but nothing new lands on them.
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/users/${idOf(MEMBER)}/archive`,
      cookies: adminCookies,
    });
    expect(archived.statusCode, archived.body).toBe(200);
    try {
      const toDeparted = await patchContract(adminCookies, contract.number, {
        managerId: idOf(MEMBER),
      });
      expect(toDeparted.statusCode, toDeparted.body).toBe(400);
    } finally {
      const restored = await harness.app.inject({
        method: "POST",
        url: `/api/v1/users/${idOf(MEMBER)}/unarchive`,
        cookies: adminCookies,
      });
      expect(restored.statusCode, restored.body).toBe(200);
      // Archiving revoked every session; the suite's member signs back in.
      memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);
    }

    const read = await getContract(adminCookies, contract.number);
    expect(read.json().contract.manager).toBeNull();
  });

  it("writes the change with before and after names, and nothing when it repeats", async () => {
    const contract = await newContract("Owner audit");
    await patchContract(adminCookies, contract.number, { managerId: idOf(MEMBER) });
    await patchContract(adminCookies, contract.number, { managerId: null });

    const changes = (await auditRowsFor(contract.id))
      .filter((row) => row.action === "contract.updated")
      .map((row) => (row.payload as { changed: Record<string, unknown> }).changed.owner);
    expect(changes).toEqual([
      { from: null, to: MEMBER.displayName },
      { from: MEMBER.displayName, to: null },
    ]);

    // Setting the Owner a contract already has changes nothing, so no
    // misleading from==to entry is written.
    await patchContract(adminCookies, contract.number, { managerId: null });
    expect(
      (await auditRowsFor(contract.id)).filter((row) => row.action === "contract.updated"),
    ).toHaveLength(2);
  });
});

describe("the contract team (CTR-004)", () => {
  it("records the creating user with the creator role, so provenance survives", async () => {
    const created = await createContract(memberCookies, {
      title: "Creator recorded",
      contractTypeId: (await typeBySlug("nda")).id,
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(await teamOf(created.json().contract.number)).toEqual([
      expect.objectContaining({
        id: idOf(MEMBER),
        displayName: MEMBER.displayName,
        role: "creator",
      }),
    ]);
  });

  it("adds and removes a member with a role", async () => {
    const contract = await newContract("Team round trip");
    const added = await addTeamMember(memberCookies, contract.number, {
      userId: idOf(MEMBER),
      role: "watcher",
    });
    expect(added.statusCode, added.body).toBe(201);
    expect(added.json().team.map((row: TeamMember) => [row.id, row.role])).toEqual([
      [idOf(ADMIN), "creator"],
      [idOf(MEMBER), "watcher"],
    ]);

    const removed = await removeTeamMember(memberCookies, contract.number, idOf(MEMBER), "watcher");
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json().team.map((row: TeamMember) => row.id)).toEqual([idOf(ADMIN)]);
  });

  it("lets one person hold two roles, and keys removal to the role", async () => {
    const contract = await newContract("Two roles");
    for (const role of ["member", "watcher"]) {
      const added = await addTeamMember(adminCookies, contract.number, {
        userId: idOf(MEMBER),
        role,
      });
      expect(added.statusCode, added.body).toBe(201);
    }
    expect(
      (await teamOf(contract.number))
        .filter((row) => row.id === idOf(MEMBER))
        .map((row) => row.role)
        .sort(),
    ).toEqual(["member", "watcher"]);

    // Removal names the role, not just the person: dropping the watcher
    // leaves the member row standing.
    const removed = await removeTeamMember(adminCookies, contract.number, idOf(MEMBER), "watcher");
    expect(removed.statusCode, removed.body).toBe(200);
    expect(
      (await teamOf(contract.number))
        .filter((row) => row.id === idOf(MEMBER))
        .map((row) => row.role),
    ).toEqual(["member"]);
  });

  it("admits a Contributor as a team member — external counsel are contributors", async () => {
    const contract = await newContract("External counsel");
    const added = await addTeamMember(adminCookies, contract.number, {
      userId: idOf(CONTRIBUTOR),
      role: "contributor",
    });
    expect(added.statusCode, added.body).toBe(201);
    expect((await teamOf(contract.number)).some((row) => row.id === idOf(CONTRIBUTOR))).toBe(true);
  });

  it("refuses a repeat of the same role, an unknown user, an unknown role, and a stray key", async () => {
    const contract = await newContract("Team refusals");
    const first = await addTeamMember(adminCookies, contract.number, {
      userId: idOf(MEMBER),
      role: "member",
    });
    expect(first.statusCode, first.body).toBe(201);
    // The compound key already holds this exact row.
    const repeat = await addTeamMember(adminCookies, contract.number, {
      userId: idOf(MEMBER),
      role: "member",
    });
    expect(repeat.statusCode, repeat.body).toBe(409);

    const unknownUser = await addTeamMember(adminCookies, contract.number, {
      userId: "no-such-id",
      role: "member",
    });
    expect(unknownUser.statusCode, unknownUser.body).toBe(400);

    const unknownRole = await addTeamMember(adminCookies, contract.number, {
      userId: idOf(MEMBER),
      role: "owner",
    });
    expect(unknownRole.statusCode, unknownRole.body).toBe(400);

    // Strict bodies: an unknown key is a client bug, not a silent strip.
    const stray = await addTeamMember(adminCookies, contract.number, {
      userId: idOf(MEMBER),
      role: "member",
      isPrimary: true,
    });
    expect(stray.statusCode, stray.body).toBe(400);
  });

  it("keeps the creator row: it cannot be added by hand or removed", async () => {
    const contract = await newContract("Creator is provenance");
    const byHand = await addTeamMember(adminCookies, contract.number, {
      userId: idOf(MEMBER),
      role: "creator",
    });
    expect(byHand.statusCode, byHand.body).toBe(400);

    const removed = await removeTeamMember(adminCookies, contract.number, idOf(ADMIN), "creator");
    expect(removed.statusCode, removed.body).toBe(409);
    expect((await teamOf(contract.number)).map((row) => row.role)).toEqual(["creator"]);
  });

  it("404s an unknown contract and a role nobody holds", async () => {
    const contract = await newContract("Team 404s");
    expect(
      (await addTeamMember(adminCookies, 999_999, { userId: idOf(MEMBER), role: "member" }))
        .statusCode,
    ).toBe(404);
    expect((await removeTeamMember(adminCookies, 999_999, idOf(MEMBER), "member")).statusCode).toBe(
      404,
    );
    expect(
      (await removeTeamMember(adminCookies, contract.number, idOf(MEMBER), "watcher")).statusCode,
    ).toBe(404);
  });

  it("freezes on an archived contract, like every other write", async () => {
    const contract = await newContract("Frozen team");
    const added = await addTeamMember(adminCookies, contract.number, {
      userId: idOf(MEMBER),
      role: "member",
    });
    expect(added.statusCode, added.body).toBe(201);
    expect((await archiveContract(adminCookies, contract.number)).statusCode).toBe(200);

    const whileArchived = await addTeamMember(adminCookies, contract.number, {
      userId: idOf(MEMBER),
      role: "watcher",
    });
    expect(whileArchived.statusCode, whileArchived.body).toBe(409);
    expect(
      (await removeTeamMember(adminCookies, contract.number, idOf(MEMBER), "member")).statusCode,
    ).toBe(409);
  });

  it("refuses a Contributor and a Business User on the team routes as 403", async () => {
    const contract = await newContract("Team access floor");
    for (const fixture of [CONTRIBUTOR, BUSINESS]) {
      const cookies = await signInCookies(harness.app, fixture.email, fixture.password);
      const attempts = [
        addTeamMember(cookies, contract.number, { userId: idOf(MEMBER), role: "member" }),
        removeTeamMember(cookies, contract.number, idOf(ADMIN), "creator"),
      ];
      for (const res of await Promise.all(attempts)) {
        expect(res.statusCode, `${fixture.email}: ${res.body}`).toBe(403);
      }
    }
    expect((await teamOf(contract.number)).map((row) => row.role)).toEqual(["creator"]);
  });

  it("writes its own activity row per change, naming the person and the role", async () => {
    const contract = await newContract("Team audit");
    await addTeamMember(memberCookies, contract.number, { userId: idOf(MEMBER), role: "watcher" });
    await removeTeamMember(memberCookies, contract.number, idOf(MEMBER), "watcher");

    const rows = await auditRowsFor(contract.id);
    expect(rows.map((row) => row.action)).toEqual([
      "contract.created",
      "contract.team_added",
      "contract.team_removed",
    ]);
    for (const row of rows.slice(1)) {
      expect(row.visibility).toBe("working_team");
      expect(row.payload).toMatchObject({
        number: contract.number,
        member: MEMBER.displayName,
        role: "watcher",
      });
    }
  });
});

describe("the signing entity (CTR-011)", () => {
  it("is born empty, because which of ours signs is often decided later", async () => {
    const contract = await newContract("Entity starts empty");
    expect(contract.entity).toBeNull();
    const read = await getContract(memberCookies, contract.number);
    expect(read.json().contract.entity).toBeNull();
  });

  it("takes a live entity from the registry and clears back to empty", async () => {
    const contract = await newContract("Entity round trip");
    const meridian = await newEntity("Meridian Bio, Inc.");

    const signed = await patchContract(memberCookies, contract.number, { entityId: meridian.id });
    expect(signed.statusCode, signed.body).toBe(200);
    expect(signed.json().contract.entity).toEqual({
      restricted: false,
      id: meridian.id,
      legalName: "Meridian Bio, Inc.",
    });
    // The record read answers with it too, not just the write.
    const read = await getContract(memberCookies, contract.number);
    expect(read.json().contract.entity.id).toBe(meridian.id);

    const cleared = await patchContract(memberCookies, contract.number, { entityId: null });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(cleared.json().contract.entity).toBeNull();
  });

  it("refuses an unknown id and an archived entity as 400", async () => {
    const contract = await newContract("Entity refusals");
    const unknown = await patchContract(adminCookies, contract.number, { entityId: "no-such-id" });
    expect(unknown.statusCode, unknown.body).toBe(400);

    // An archived entity is out of the registry list and out of the
    // picker, so nothing new may be signed by it.
    const dissolved = await newEntity("Dissolved Holdings Ltd");
    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entities/${dissolved.id}/archive`,
      cookies: adminCookies,
    });
    expect(archived.statusCode, archived.body).toBe(200);
    const refused = await patchContract(adminCookies, contract.number, { entityId: dissolved.id });
    expect(refused.statusCode, refused.body).toBe(400);
    expect(refused.json().detail).toBe("The signing entity must be a live entity.");

    const read = await getContract(adminCookies, contract.number);
    expect(read.json().contract.entity).toBeNull();
  });

  it("keeps naming an entity archived after it signed", async () => {
    const contract = await newContract("Entity archived after signing");
    const closing = await newEntity("Closing Branch GmbH");
    const signed = await patchContract(adminCookies, contract.number, { entityId: closing.id });
    expect(signed.statusCode, signed.body).toBe(200);

    const archived = await harness.app.inject({
      method: "POST",
      url: `/api/v1/entities/${closing.id}/archive`,
      cookies: adminCookies,
    });
    expect(archived.statusCode, archived.body).toBe(200);

    // Nothing is rewritten: the record still names who signed. The
    // registry is where an entity's standing is read, not the contract.
    const read = await getContract(adminCookies, contract.number);
    expect(read.json().contract.entity).toEqual({
      restricted: false,
      id: closing.id,
      legalName: "Closing Branch GmbH",
    });
  });

  it("renders Restricted Entity when the contract reader cannot reach its signing Entity", async () => {
    const contract = await newContract("Restricted signing Entity");
    const vehicle = await newEntity("Hidden Signing Vehicle Ltd");
    expect(
      (await patchContract(adminCookies, contract.number, { entityId: vehicle.id })).statusCode,
    ).toBe(200);
    const sealed = await harness.app.inject({
      method: "PATCH",
      url: `/api/v1/entities/${vehicle.id}`,
      cookies: adminCookies,
      payload: { isConfidential: true },
    });
    expect(sealed.statusCode, sealed.body).toBe(200);

    const memberRead = await getContract(memberCookies, contract.number);
    expect(memberRead.statusCode, memberRead.body).toBe(200);
    expect(memberRead.body).not.toContain("Hidden Signing Vehicle Ltd");
    expect(memberRead.json().contract.entity).toEqual({ restricted: true });
    const edited = await patchContract(memberCookies, contract.number, { priority: "high" });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.body).not.toContain("Hidden Signing Vehicle Ltd");
    expect(edited.json().contract.entity).toEqual({ restricted: true });
    expect((await getContract(adminCookies, contract.number)).json().contract.entity).toEqual({
      restricted: false,
      id: vehicle.id,
      legalName: "Hidden Signing Vehicle Ltd",
    });
  });

  it("writes the change with before and after legal names, and nothing when it repeats", async () => {
    const contract = await newContract("Entity audit");
    const parent = await newEntity("Audit Parent Corp");
    await patchContract(adminCookies, contract.number, { entityId: parent.id });
    await patchContract(adminCookies, contract.number, { entityId: null });

    const changes = (await auditRowsFor(contract.id))
      .filter((row) => row.action === "contract.updated")
      .map((row) => (row.payload as { changed: Record<string, unknown> }).changed.entity);
    expect(changes).toEqual([
      { from: null, to: "Audit Parent Corp" },
      { from: "Audit Parent Corp", to: null },
    ]);

    // Setting the entity a contract already has changes nothing, so no
    // misleading from==to entry is written.
    await patchContract(adminCookies, contract.number, { entityId: null });
    expect(
      (await auditRowsFor(contract.id)).filter((row) => row.action === "contract.updated"),
    ).toHaveLength(2);
  });
});

describe("the counterparties (CTR-011)", () => {
  it("puts an unknown name on the contract, creating the record with just that name", async () => {
    const contract = await newContract("Inline counterparty creation");
    const res = await addCounterparty(memberCookies, contract.number, {
      name: "  Helix Labs GmbH  ",
    });
    expect(res.statusCode, res.body).toBe(201);
    // The name is trimmed, and nothing else about the organization is
    // invented — enrichment is later and optional (CTR-011).
    expect(res.json().counterparties).toEqual([
      { id: expect.any(String), name: "Helix Labs GmbH", jurisdiction: null, isPrimary: true },
    ]);
    // The first party on a contract is its primary, and the row the
    // list draws says so without a second read.
    expect(res.json().contract.primaryCounterparty).toEqual({
      id: (res.json().counterparties as RecordCounterparty[])[0]!.id,
      name: "Helix Labs GmbH",
    });
  });

  it("reuses the record it already holds for a name, whatever the casing", async () => {
    const first = await newContract("Reuse by name, first");
    const second = await newContract("Reuse by name, second");
    const original = await putCounterpartyOn(first.number, "Orion Cloud Ltd");

    // The same organization, typed by someone who does not shift-key.
    const again = await addCounterparty(adminCookies, second.number, { name: "orion cloud ltd" });
    expect(again.statusCode, again.body).toBe(201);
    expect((again.json().counterparties as RecordCounterparty[])[0]!.id).toBe(original.id);

    // One row, not two: the typeahead must never end up offering the
    // same organization twice.
    const rows = await harness.db
      .select({ id: counterparties.id })
      .from(counterparties)
      .where(eq(counterparties.name, "Orion Cloud Ltd"));
    expect(rows).toHaveLength(1);
  });

  it("adds a counterparty it already holds by id, and refuses a second copy of it", async () => {
    const contract = await newContract("Add by id");
    const held = await putCounterpartyOn(contract.number, "Northwind Trading BV");
    const other = await newContract("Add by id, elsewhere");

    const picked = await addCounterparty(adminCookies, other.number, { counterpartyId: held.id });
    expect(picked.statusCode, picked.body).toBe(201);

    const twice = await addCounterparty(adminCookies, other.number, { counterpartyId: held.id });
    expect(twice.statusCode, twice.body).toBe(409);
    expect(twice.json().detail).toBe("That counterparty is already on this contract.");
    expect(await counterpartiesOf(other.number)).toHaveLength(1);
  });

  it("holds two or more parties, with exactly one primary at all times", async () => {
    const contract = await newContract("Tripartite novation");
    const first = await putCounterpartyOn(contract.number, "Alpha Assignor SA");
    const second = await putCounterpartyOn(contract.number, "Beta Assignee Oy");
    const third = await putCounterpartyOn(contract.number, "Gamma Guarantor Ltd");

    const parties = await counterpartiesOf(contract.number);
    expect(parties).toHaveLength(3);
    // The primary leads the list, so the record never makes a reader
    // hunt for the name it is filed under.
    expect(parties[0]!.id).toBe(first.id);
    expect(parties.filter((party) => party.isPrimary)).toHaveLength(1);
    // The parties who joined after take no flag with them.
    for (const id of [second.id, third.id]) {
      expect(parties.find((party) => party.id === id)!.isPrimary).toBe(false);
    }
  });

  it("moves the primary to another party, and refuses to move it onto itself", async () => {
    const contract = await newContract("Primary moves");
    const first = await putCounterpartyOn(contract.number, "First Party Ltd");
    const second = await putCounterpartyOn(contract.number, "Second Party Ltd");

    const moved = await setPrimaryCounterparty(memberCookies, contract.number, second.id);
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json().contract.primaryCounterparty).toEqual({
      id: second.id,
      name: "Second Party Ltd",
    });
    const parties = moved.json().counterparties as RecordCounterparty[];
    expect(parties.filter((party) => party.isPrimary).map((party) => party.id)).toEqual([
      second.id,
    ]);

    const again = await setPrimaryCounterparty(memberCookies, contract.number, second.id);
    expect(again.statusCode, again.body).toBe(409);
    expect(again.json().detail).toBe("That counterparty is already the primary.");

    // The one it was taken from is still on the contract, unflagged.
    expect((await counterpartiesOf(contract.number)).find((row) => row.id === first.id)).toEqual(
      expect.objectContaining({ isPrimary: false }),
    );
  });

  it("promotes the next party when the primary is taken off — never zero-primary", async () => {
    const contract = await newContract("Primary leaves");
    const leaving = await putCounterpartyOn(contract.number, "Leaving Party Ltd");
    const staying = await putCounterpartyOn(contract.number, "Staying Party Ltd");
    const third = await putCounterpartyOn(contract.number, "Third Party Ltd");

    const removed = await removeCounterparty(memberCookies, contract.number, leaving.id);
    expect(removed.statusCode, removed.body).toBe(200);
    // The party who joined next takes the flag — the record's own
    // order, not an arbitrary one.
    expect(removed.json().contract.primaryCounterparty).toEqual({
      id: staying.id,
      name: "Staying Party Ltd",
    });
    const parties = removed.json().counterparties as RecordCounterparty[];
    expect(parties.map((party) => party.id).sort()).toEqual([staying.id, third.id].sort());
    expect(parties.filter((party) => party.isPrimary)).toHaveLength(1);
  });

  it("leaves no primary only when no party is left", async () => {
    const contract = await newContract("Last party out");
    const only = await putCounterpartyOn(contract.number, "Only Party Ltd");

    const removed = await removeCounterparty(adminCookies, contract.number, only.id);
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json().counterparties).toEqual([]);
    expect(removed.json().contract.primaryCounterparty).toBeNull();

    // The organization itself survives — it is only off this contract.
    const [record] = await harness.db
      .select({ id: counterparties.id })
      .from(counterparties)
      .where(eq(counterparties.id, only.id));
    expect(record).toBeDefined();
  });

  it("refuses a body naming both an id and a name, or neither, as 400", async () => {
    const contract = await newContract("Counterparty body shapes");
    const held = await putCounterpartyOn(contract.number, "Both Ways Ltd");
    const other = await newContract("Counterparty body shapes, elsewhere");

    for (const payload of [
      { counterpartyId: held.id, name: "Both Ways Ltd" },
      {},
      { name: "   " },
      // Strict bodies: an unknown key is a client bug, not a silent strip.
      { name: "Extra Keys Ltd", jurisdiction: "Delaware" },
    ]) {
      const res = await addCounterparty(adminCookies, other.number, payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect(await counterpartiesOf(other.number)).toEqual([]);
  });

  it("refuses an unknown id, an archived counterparty, and an absent party", async () => {
    const contract = await newContract("Counterparty refusals");
    const unknown = await addCounterparty(adminCookies, contract.number, {
      counterpartyId: "no-such-id",
    });
    expect(unknown.statusCode, unknown.body).toBe(400);

    // A counterparty is soft-deleted, so it leaves the typeahead and
    // nothing new may be signed with it. M8 gives that no screen, so
    // the state is set directly here.
    const gone = await putCounterpartyOn(contract.number, "Dissolved Partner Ltd");
    await harness.db
      .update(counterparties)
      .set({ archivedAt: new Date() })
      .where(eq(counterparties.id, gone.id));
    const other = await newContract("Counterparty refusals, elsewhere");
    const refused = await addCounterparty(adminCookies, other.number, {
      counterpartyId: gone.id,
    });
    expect(refused.statusCode, refused.body).toBe(400);
    expect(refused.json().detail).toBe("The counterparty must be a live counterparty.");

    // It stays on the contract it was already on: leaving the typeahead
    // does not undo a party that signed.
    expect((await counterpartiesOf(contract.number)).map((row) => row.id)).toEqual([gone.id]);

    for (const res of await Promise.all([
      removeCounterparty(adminCookies, other.number, gone.id),
      setPrimaryCounterparty(adminCookies, other.number, gone.id),
    ])) {
      expect(res.statusCode, res.body).toBe(404);
      expect(res.json().detail).toBe("That counterparty is not on this contract.");
    }
  });

  it("refuses every counterparty write on an archived contract as 409", async () => {
    const contract = await newContract("Frozen counterparties");
    const party = await putCounterpartyOn(contract.number, "Frozen Party Ltd");
    const second = await putCounterpartyOn(contract.number, "Frozen Second Ltd");
    expect((await archiveContract(adminCookies, contract.number)).statusCode).toBe(200);

    for (const res of await Promise.all([
      addCounterparty(adminCookies, contract.number, { name: "Too Late Ltd" }),
      removeCounterparty(adminCookies, contract.number, party.id),
      setPrimaryCounterparty(adminCookies, contract.number, second.id),
    ])) {
      expect(res.statusCode, res.body).toBe(409);
    }
    // An archived record reads as facts, so the read still answers.
    expect(await counterpartiesOf(contract.number)).toHaveLength(2);
  });

  it("shows the primary counterparty on the contracts list row", async () => {
    const contract = await newContract("Listed by its counterparty");
    await putCounterpartyOn(contract.number, "Listed Party Ltd");

    const row = (await listContracts(memberCookies)).find((entry) => entry.id === contract.id);
    expect(row!.primaryCounterparty).toEqual({
      id: expect.any(String),
      name: "Listed Party Ltd",
    });
    // A contract with nobody recorded on the other side answers null,
    // not an empty string or a placeholder name.
    const bare = await newContract("Nobody on the other side");
    expect(
      (await listContracts(memberCookies)).find((entry) => entry.id === bare.id)!
        .primaryCounterparty,
    ).toBeNull();
  });

  it("refuses a second primary at the database, whatever the caller believes", async () => {
    const contract = await newContract("Two primaries refused");
    await putCounterpartyOn(contract.number, "Structural First Ltd");
    const second = await putCounterpartyOn(contract.number, "Structural Second Ltd");

    // The routes keep the invariant (CTR-011); the partial unique index
    // is the backstop that makes a broken one unwritable.
    await expect(
      harness.db
        .update(contractCounterparties)
        .set({ isPrimary: true })
        .where(eq(contractCounterparties.counterpartyId, second.id)),
    ).rejects.toThrow();
  });

  it("writes an activity row for the add, the removal, and the promotion", async () => {
    const contract = await newContract("Counterparty audit");
    const first = await putCounterpartyOn(contract.number, "Audit First Ltd");
    const second = await putCounterpartyOn(contract.number, "Audit Second Ltd");
    expect(
      (await setPrimaryCounterparty(adminCookies, contract.number, second.id)).statusCode,
    ).toBe(200);
    expect((await removeCounterparty(adminCookies, contract.number, second.id)).statusCode).toBe(
      200,
    );

    const entries = (await auditRowsFor(contract.id))
      .filter((row) => row.action.startsWith("contract.counterparty"))
      .map((row) => ({ action: row.action, payload: row.payload }));
    expect(entries).toEqual([
      {
        action: "contract.counterparty_added",
        payload: expect.objectContaining({
          counterparty: "Audit First Ltd",
          isPrimary: true,
          // The organization was born with this add, which is what the
          // M9 viewer needs to say "(new)".
          created: true,
        }),
      },
      {
        action: "contract.counterparty_added",
        payload: expect.objectContaining({ counterparty: "Audit Second Ltd", isPrimary: false }),
      },
      {
        action: "contract.counterparty_primary_changed",
        payload: expect.objectContaining({ from: "Audit First Ltd", to: "Audit Second Ltd" }),
      },
      {
        action: "contract.counterparty_removed",
        payload: expect.objectContaining({ counterparty: "Audit Second Ltd", wasPrimary: true }),
      },
      // Removing the primary promotes the next party, and nobody asked
      // for that — so the log says it rather than leave it implied.
      {
        action: "contract.counterparty_primary_changed",
        payload: expect.objectContaining({ from: "Audit Second Ltd", to: "Audit First Ltd" }),
      },
    ]);
    expect(first.isPrimary).toBe(true);
  });

  it("records an existing counterparty as picked, not created", async () => {
    const held = await newContract("Picked, not created");
    const party = await putCounterpartyOn(held.number, "Already Known Ltd");
    const contract = await newContract("Picked, not created — elsewhere");
    expect(
      (await addCounterparty(adminCookies, contract.number, { counterpartyId: party.id }))
        .statusCode,
    ).toBe(201);

    const [entry] = (await auditRowsFor(contract.id)).filter(
      (row) => row.action === "contract.counterparty_added",
    );
    expect(entry!.payload).toMatchObject({ counterparty: "Already Known Ltd", created: false });
  });
});

describe("the contract value (CTR-010)", () => {
  it("is born with no value, because a contract worth nothing is normal", async () => {
    const contract = await newContract("Mutual NDA — no price");
    expect(contract.value).toBeNull();
  });

  it("records the amount, the currency, and the cadence as one field", async () => {
    const contract = await newContract("Orion Cloud — platform 2026");
    const res = await patchContract(memberCookies, contract.number, {
      value: { amount: 48_000_000, currency: "USD", cadence: "annually" },
    });
    expect(res.statusCode, res.body).toBe(200);
    // Integer minor units on the wire and in the column: the amount is
    // 480,000 dollars counted in cents, never a float.
    expect(res.json().contract.value).toEqual({
      amount: 48_000_000,
      currency: "USD",
      cadence: "annually",
    });
    const read = await getContract(memberCookies, contract.number);
    expect(read.json().contract.value).toEqual({
      amount: 48_000_000,
      currency: "USD",
      cadence: "annually",
    });
  });

  it("clears back to no value as one group, not one column at a time", async () => {
    const contract = await newContract("Helix — pilot, later cancelled");
    await patchContract(memberCookies, contract.number, {
      value: { amount: 250_000, currency: "EUR", cadence: "monthly" },
    });
    const res = await patchContract(memberCookies, contract.number, { value: null });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().contract.value).toBeNull();
    // The columns behind the field are empty too, not merely unreported.
    const [row] = await harness.db
      .select({
        amount: contracts.valueAmount,
        currency: contracts.valueCurrency,
        cadence: contracts.valueCadence,
      })
      .from(contracts)
      .where(eq(contracts.id, contract.id));
    expect(row).toEqual({ amount: null, currency: null, cadence: null });
  });

  it("refuses an amount with no currency — a number nobody can read", async () => {
    const contract = await newContract("Value without a currency");
    const res = await patchContract(memberCookies, contract.number, {
      value: { amount: 100_000, cadence: "one_time" },
    });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "value.currency" })]),
    );
    expect((await getContract(memberCookies, contract.number)).json().contract.value).toBeNull();
  });

  it("refuses an amount with no cadence, so every value says what it is per", async () => {
    const contract = await newContract("Value without a cadence");
    const res = await patchContract(memberCookies, contract.number, {
      value: { amount: 100_000, currency: "USD" },
    });
    expect(res.statusCode, res.body).toBe(400);
  });

  it("refuses a code that is not ISO 4217, a cadence outside the set, and a stray key", async () => {
    const contract = await newContract("Value refusals");
    for (const value of [
      { amount: 1000, currency: "XYZ", cadence: "one_time" },
      { amount: 1000, currency: "US", cadence: "one_time" },
      { amount: 1000, currency: "USD", cadence: "weekly" },
      { amount: 1000, currency: "USD", cadence: "one_time", total: 12_000 },
    ]) {
      const res = await patchContract(memberCookies, contract.number, { value });
      expect(res.statusCode, JSON.stringify(value)).toBe(400);
    }
    expect((await getContract(memberCookies, contract.number)).json().contract.value).toBeNull();
  });

  it("refuses a negative amount and a fractional one — minor units are whole", async () => {
    const contract = await newContract("Value arithmetic");
    for (const amount of [-1, 10.5]) {
      const res = await patchContract(memberCookies, contract.number, {
        value: { amount, currency: "USD", cadence: "one_time" },
      });
      expect(res.statusCode, String(amount)).toBe(400);
    }
  });

  it("holds the largest amount a reader can read back, and refuses the next one", async () => {
    const contract = await newContract("Value ceiling");
    // The column is a bigint and holds far more, but every reader of it
    // is a JavaScript runtime — so the ceiling is the largest exact
    // integer one has, stated at the seam and at the database.
    const ceiling = Number.MAX_SAFE_INTEGER;
    const held = await patchContract(memberCookies, contract.number, {
      value: { amount: ceiling, currency: "USD", cadence: "one_time" },
    });
    expect(held.statusCode, held.body).toBe(200);
    expect(held.json().contract.value.amount).toBe(ceiling);

    const refused = await patchContract(memberCookies, contract.number, {
      value: { amount: ceiling + 1, currency: "USD", cadence: "one_time" },
    });
    expect(refused.statusCode, refused.body).toBe(400);
    await expect(
      harness.db
        .update(contracts)
        .set({ valueAmount: ceiling + 1 })
        .where(eq(contracts.id, contract.id)),
    ).rejects.toThrow();
  });

  it("normalizes the code's casing, so one currency never becomes two", async () => {
    const contract = await newContract("Lower-case currency");
    const res = await patchContract(memberCookies, contract.number, {
      value: { amount: 5000, currency: "gbp", cadence: "one_time" },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().contract.value.currency).toBe("GBP");
  });

  it("holds a currency whose smallest unit is the unit itself", async () => {
    const contract = await newContract("Yen contract");
    // JPY has no minor unit: 5,000 yen is stored as 5000, not 500000.
    const res = await patchContract(memberCookies, contract.number, {
      value: { amount: 5000, currency: "JPY", cadence: "one_time" },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().contract.value).toEqual({
      amount: 5000,
      currency: "JPY",
      cadence: "one_time",
    });
  });

  it("rides the list row, so a Legal Team Member can scan what a contract is worth", async () => {
    const contract = await newContract("Listed with a value");
    await patchContract(memberCookies, contract.number, {
      value: { amount: 12_000_000, currency: "USD", cadence: "annually" },
    });
    const listed = (await listContracts(memberCookies)).find((row) => row.id === contract.id);
    expect(listed!.value).toEqual({ amount: 12_000_000, currency: "USD", cadence: "annually" });
  });

  it("refuses a part of a value at the database, whatever the caller believes", async () => {
    const contract = await newContract("Half a value");
    // The seam keeps the group together (CTR-010); the group check is
    // the backstop that makes a half-written value unwritable.
    await expect(
      harness.db.update(contracts).set({ valueAmount: 1000 }).where(eq(contracts.id, contract.id)),
    ).rejects.toThrow();
  });

  it("writes the whole value before and after, and nothing when it repeats", async () => {
    const contract = await newContract("Value audit");
    const value = { amount: 90_000_00, currency: "USD", cadence: "monthly" };
    await patchContract(memberCookies, contract.number, { value });
    // The same value again is not a change: no audit row may claim one.
    await patchContract(memberCookies, contract.number, { value });
    await patchContract(memberCookies, contract.number, { value: null });

    const entries = (await auditRowsFor(contract.id)).filter(
      (row) => row.action === "contract.updated",
    );
    expect(entries).toHaveLength(2);
    expect((entries[0]!.payload as { changed: Record<string, unknown> }).changed).toEqual({
      value: { from: null, to: value },
    });
    expect((entries[1]!.payload as { changed: Record<string, unknown> }).changed).toEqual({
      value: { from: value, to: null },
    });
  });

  it("commits with another field in the same body without either being lost", async () => {
    const contract = await newContract("Value beside risk");
    const res = await patchContract(memberCookies, contract.number, {
      risk: "high",
      value: { amount: 1_000_000, currency: "CHF", cadence: "one_time" },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().contract).toMatchObject({
      risk: "high",
      value: { amount: 1_000_000, currency: "CHF", cadence: "one_time" },
    });
  });

  it("freezes on an archived contract, like every other field", async () => {
    const contract = await newContract("Archived, then priced");
    await archiveContract(adminCookies, contract.number);
    const res = await patchContract(memberCookies, contract.number, {
      value: { amount: 1000, currency: "USD", cadence: "one_time" },
    });
    expect(res.statusCode, res.body).toBe(409);
  });
});

describe("GET /contracts/options — the Owner and team picker source", () => {
  it("answers with the live people a Member+ surface can assign", async () => {
    const res = await harness.app.inject({
      method: "GET",
      url: "/api/v1/contracts/options",
      cookies: memberCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    const people = res.json().users as (Person & { role: string })[];
    // Everyone who can be put on a team is offered — the Owner guard
    // narrows to Member+ on the write, and the client filters the pick.
    expect(people.map((row) => row.id)).toEqual(
      expect.arrayContaining([idOf(ADMIN), idOf(MEMBER), idOf(CONTRIBUTOR)]),
    );
    expect(people.find((row) => row.id === idOf(MEMBER))).toMatchObject({
      displayName: MEMBER.displayName,
      role: "legal_team_member",
      archived: false,
    });
    // Alphabetical by name, so the picker reads the same every visit.
    const names = people.map((row) => row.displayName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

describe("the bounded contract list (CTR-024)", () => {
  /** One page, raw, so the envelope can be read as well as the rows. */
  const page = (cookies: Record<string, string>, cursor?: string) =>
    harness.app.inject({
      method: "GET",
      url: `/api/v1/contracts${cursor === undefined ? "" : `?cursor=${cursor}`}`,
      cookies,
    });

  it("answers at most one page, and says where the next one starts", async () => {
    // Past the page size, so the first read cannot be the whole list
    // however many contracts the rest of the suite left behind.
    for (let made = 0; made < 55; made += 1) {
      await newContract(`Paged contract ${made}`);
    }

    const first = await page(adminCookies);
    expect(first.statusCode, first.body).toBe(200);
    const rows = first.json().contracts as ContractRow[];
    expect(rows).toHaveLength(50);
    // The reference is monotonic, so the page reads newest first with
    // no tie to break.
    expect(rows.map((row) => row.number)).toEqual(
      [...rows.map((row) => row.number)].sort((a, b) => b - a),
    );
    expect(first.json().nextCursor).toBe(rows.at(-1)!.id);
  });

  it("walks the whole list through the cursor, each contract once and in order", async () => {
    const all = await everyContract(adminCookies, true);
    expect(all.length).toBeGreaterThan(50);
    expect(new Set(all.map((row) => row.id)).size).toBe(all.length);
    expect(all.map((row) => row.number)).toEqual(
      [...all.map((row) => row.number)].sort((a, b) => b - a),
    );
  });

  it("ends the walk with a null cursor rather than an empty page", async () => {
    let cursor: string | null = (await page(adminCookies)).json().nextCursor;
    let last = null as null | ReturnType<typeof JSON.parse>;
    while (cursor !== null) {
      const next = await page(adminCookies, cursor);
      expect(next.statusCode, next.body).toBe(200);
      last = next.json();
      cursor = last.nextCursor as string | null;
    }
    // The last page carried rows and then said it was the last. A
    // cursor on it would have sent the client for a page of nothing.
    expect(last!.contracts.length).toBeGreaterThan(0);
    expect(last!.nextCursor).toBeNull();
  });

  it("refuses a cursor that names nothing with an empty page, not an error", async () => {
    const nowhere = await page(adminCookies, "00000000-0000-7000-8000-000000000000");
    expect(nowhere.statusCode, nowhere.body).toBe(200);
    expect(nowhere.json().contracts).toEqual([]);
    expect(nowhere.json().nextCursor).toBeNull();
  });

  it("refuses a cursor outside its own bound before it reaches the database", async () => {
    // A cursor that names nothing is a page of nothing; a cursor that is
    // not a cursor at all is a bad request. The bound is what keeps the
    // second from becoming an unbounded string in a query.
    for (const shape of ["", "x".repeat(65)]) {
      const bad = await page(adminCookies, shape);
      expect(bad.statusCode, bad.body).toBe(400);
      expect(bad.headers["content-type"]).toContain("application/problem+json");
    }
  });
});

describe("the DD-017 activity trail", () => {
  it("keys every contract entry to a listable contract", async () => {
    const rows = await contractAuditRows();
    expect(rows.length).toBeGreaterThan(0);
    // Every page of it: the trail names contracts made across the whole
    // suite, and one page stopped being the whole table at CTR-024.
    const ids = new Set((await everyContract(adminCookies, true)).map((row) => row.id));
    for (const row of rows) {
      expect(row.entityType).toBe("contract");
      expect(row.visibility).toBe("working_team");
      expect(row.actorId).not.toBeNull();
      expect(ids.has(row.entityId!)).toBe(true);
    }
  });
});

describe("the shared locked read under a concurrent writer (#154)", () => {
  /**
   * Waits until a backend is blocked on the transaction that `holder` runs.
   *
   * The mutation under test has to reach the contract row and start
   * waiting on it before the holding transaction commits — otherwise the
   * two never overlap and the test proves nothing. Postgres says so
   * itself, so this asks it rather than sleeping and hoping.
   *
   * It asks who each waiter is blocked *by*, not merely whether anything
   * anywhere waits. A lock taken by an unrelated suite would otherwise
   * end the wait early and let the test pass without the overlap it
   * exists to create.
   */
  const waitForALockWaiter = async (holder: number): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const waiting = await harness.db.execute(
        sql`select count(*)::int as waiting from pg_stat_activity
            where ${holder} = any(pg_blocking_pids(pid))`,
      );
      if (Number(waiting.rows[0]?.waiting ?? 0) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("no statement ever waited on the contract row lock");
  };

  it("answers a viewer who can reach the record, not the missing-record 404", async () => {
    const contract = await newContract("Helix under two writers");
    const redlining = await statusBySlug("redlining");

    // The first writer takes the row and changes its status — the join
    // key the shared locked read carries. The second writer arrives
    // while that is uncommitted, so it blocks on the row.
    let patched: ReturnType<typeof patchContract> | undefined;
    await harness.db.transaction(async (tx) => {
      const holding = await tx.execute(sql`select pg_backend_pid()::int as pid`);
      const holder = Number(holding.rows[0]?.pid);
      await tx
        .update(contracts)
        .set({ statusId: redlining.id })
        .where(eq(contracts.number, contract.number));
      patched = patchContract(adminCookies, contract.number, {
        title: "Renamed by the second writer",
      });
      await waitForALockWaiter(holder);
    });

    // The waiting statement re-checks its qualification against the row
    // it waited for. An Administrator reaches every contract, so the one
    // answer this must never give is the one reserved for a contract
    // that was never made.
    const response = await patched!;
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().contract.title).toBe("Renamed by the second writer");
    expect(response.json().contract.statusName).toBe(redlining.displayName);
  });
});
