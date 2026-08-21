// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Renewal routing to the other three vehicles (M16/5), at the HTTP seam
 * through the real-Postgres harness — CTR-007's routing and the write
 * side of CTR-015 that carries it.
 *
 * **Three vehicles and two of them make a record.** A renewal papered as
 * an **amendment** is a version on the primary document's chain and
 * nothing else: no new contract, no link, and the M11 write path
 * unchanged. A **child contract** is born under its predecessor on
 * `contracts.parent_id`. A **standalone successor** is born beside it
 * holding a CTR-015 `renews` row. The record says which happened because
 * of the link and the log, never because of the shape of the record —
 * CTR-007's own words.
 *
 * **The prefill is a list and the list is the decision.** The business
 * facts of the deal are copied — our entity, the value, the term shape,
 * and the counterparties — and the facts about the *record* are not: the
 * status, the team, and the Confidential flag never cross, which is
 * CTR-015's no-inheritance stance applied at birth. These tests assert
 * both halves at the seam, because the seam is where the copying
 * happens; a dialog that prefilled the right boxes over a seam that
 * copied the wrong ones would still be wrong.
 *
 * **The relation writes narrate themselves.** Two closed-union verbs,
 * read straight out of `activity_log` — the approvals precedent — so a
 * reader of the feed can tell "this record was parented" from "somebody
 * changed a date on it" without opening a payload.
 *
 * **The guards are the write path's and are asserted where they can be
 * reached.** A newborn contract has no descendants to loop through and
 * no links to duplicate, so routing cannot itself produce either
 * refusal; what these tests prove is that the rules hold at the row —
 * one link per pair per type, and no contract under itself — whichever
 * code arrives next.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  asc,
  contractRelations,
  contracts,
  contractTeam,
  counterparties,
  entities,
  eq,
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

/** The person who routes the renewals. */
const MEMBER = {
  email: "routing-member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;

/** A Legal Team Member with no team row — the viewer a confidential
 * predecessor has to be invisible to. */
const OUTSIDER = {
  email: "routing-outsider@example.com",
  displayName: "Outside Counsel",
  password: "correct-horse-battery",
} as const;

/** A colleague, so a predecessor can carry a team that must not be
 * copied onto its successor. */
const COLLEAGUE = {
  email: "routing-colleague@example.com",
  displayName: "Sam Colleague",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let memberCookies: Record<string, string>;
let outsiderCookies: Record<string, string>;
let colleagueId = "";
let ndaTypeId = "";
let msaTypeId = "";
let activeStatusId = "";
let corporationTypeId = "";

/** One contract as the record read answers it. */
interface ContractRow {
  id: string;
  number: number;
  title: string;
  contractTypeId: string;
  contractTypeName: string;
  statusId: string;
  statusName: string;
  stage: string;
  manager: { id: string } | null;
  entity: { id: string; legalName: string } | null;
  primaryCounterparty: { id: string; name: string } | null;
  priority: string;
  risk: string | null;
  value: { amount: number; currency: string; cadence: string } | null;
  termType: string;
  effectiveDate: string | null;
  expiryDate: string | null;
  renewalPeriodMonths: number | null;
  noticePeriodDays: number | null;
  isConfidential: boolean;
}

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);

  const member = await provisionUser(harness.app.auth, MEMBER);
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, member.id));
  memberCookies = await signInCookies(harness.app, MEMBER.email, MEMBER.password);

  const outsider = await provisionUser(harness.app.auth, OUTSIDER);
  await harness.db
    .update(users)
    .set({ role: "legal_team_member" })
    .where(eq(users.id, outsider.id));
  outsiderCookies = await signInCookies(harness.app, OUTSIDER.email, OUTSIDER.password);

  const colleague = await provisionUser(harness.app.auth, COLLEAGUE);
  colleagueId = colleague.id;
  await harness.db
    .update(users)
    .set({ role: "legal_team_member" })
    .where(eq(users.id, colleague.id));

  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: memberCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  const body = res.json() as {
    contractTypes: { id: string; slug: string }[];
    contractStatuses: { id: string; slug: string }[];
  };
  ndaTypeId = body.contractTypes.find((row) => row.slug === "nda")!.id;
  msaTypeId = body.contractTypes.find((row) => row.slug === "msa")!.id;
  activeStatusId = body.contractStatuses.find((row) => row.slug === "active")!.id;

  const entityTypes = await harness.app.inject({
    method: "GET",
    url: "/api/v1/entities/types",
    cookies: memberCookies,
  });
  expect(entityTypes.statusCode, entityTypes.body).toBe(200);
  corporationTypeId = (entityTypes.json().entityTypes as { id: string; slug: string }[]).find(
    (row) => row.slug === "corporation",
  )!.id;
});

afterAll(async () => {
  await harness.stop();
});

/** A create that must land, answering the row it made. */
async function create(
  payload: Record<string, unknown>,
  cookies = memberCookies,
): Promise<ContractRow> {
  const res = await createRaw(payload, cookies);
  expect(res.statusCode, res.body).toBe(201);
  return res.json().contract as ContractRow;
}

const createRaw = (payload: Record<string, unknown>, cookies = memberCookies) =>
  harness.app.inject({ method: "POST", url: "/api/v1/contracts", cookies, payload });

/** A field commit that must land. */
async function patch(number: number, payload: Record<string, unknown>): Promise<ContractRow> {
  const res = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/contracts/${number}`,
    cookies: memberCookies,
    payload,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().contract as ContractRow;
}

/** The record read's own copy of the row. */
async function read(number: number, cookies = memberCookies): Promise<ContractRow> {
  const res = await harness.app.inject({
    method: "GET",
    url: `/api/v1/contracts/${number}`,
    cookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().contract as ContractRow;
}

/** Every entry written on one contract, oldest first. */
const entriesOn = (contractId: string) =>
  harness.db
    .select()
    .from(activityLog)
    .where(eq(activityLog.entityId, contractId))
    .orderBy(asc(activityLog.createdAt), asc(activityLog.id));

/** The stored parent of one contract — the column, not a projection of
 * it, because no read surface draws it until M17. */
async function parentOf(contractId: string): Promise<string | null> {
  const [row] = await harness.db
    .select({ parentId: contracts.parentId })
    .from(contracts)
    .where(eq(contracts.id, contractId))
    .limit(1);
  return row!.parentId;
}

/** Every link one contract makes, read from the table for the same
 * reason: M16 writes these rows and draws none of them. */
const linksFrom = (contractId: string) =>
  harness.db
    .select()
    .from(contractRelations)
    .where(eq(contractRelations.fromContractId, contractId));

/**
 * The predecessor every routing test starts from: an auto-renewing MSA
 * with our side, its value, its whole term, two counterparties, a team
 * beyond its creator, a status that is not the draft seed, and the
 * Confidential flag set. Everything a copy could get wrong is on it.
 */
async function predecessor(title: string, options: { confidential?: boolean } = {}) {
  const row = await create({
    title,
    contractTypeId: msaTypeId,
    isConfidential: options.confidential ?? false,
  });
  const entityRes = await harness.app.inject({
    method: "POST",
    url: "/api/v1/entities",
    cookies: memberCookies,
    payload: { legalName: `${title} Holdings`, entityTypeId: corporationTypeId },
  });
  expect(entityRes.statusCode, entityRes.body).toBe(201);
  const entityId = (entityRes.json().entity as { id: string }).id;

  await patch(row.number, { entityId });
  await patch(row.number, { value: { amount: 48_000_00, currency: "USD", cadence: "annually" } });
  await patch(row.number, { termType: "auto_renew" });
  await patch(row.number, {
    effectiveDate: "2025-07-01",
    expiryDate: "2026-06-30",
    renewalPeriodMonths: 12,
    noticePeriodDays: 90,
  });
  await patch(row.number, { priority: "high", risk: "critical" });
  await patch(row.number, { statusId: activeStatusId });

  for (const name of [`${title} Counterparty A`, `${title} Counterparty B`]) {
    const res = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${row.number}/counterparties`,
      cookies: memberCookies,
      payload: { name },
    });
    expect(res.statusCode, res.body).toBe(201);
  }
  const teamRes = await harness.app.inject({
    method: "POST",
    url: `/api/v1/contracts/${row.number}/team`,
    cookies: memberCookies,
    payload: { userId: colleagueId, role: "member" },
  });
  expect(teamRes.statusCode, teamRes.body).toBe(201);

  return await read(row.number);
}

describe("the child-contract vehicle (CTR-007 §3)", () => {
  it("is born under its predecessor, with the parent written and narrated", async () => {
    const parent = await predecessor("Routing child parent");

    const child = await create({
      title: "Routing child parent — 2027 renewal",
      contractTypeId: parent.contractTypeId,
      renewalOf: { number: parent.number, vehicle: "child" },
    });

    expect(await parentOf(child.id)).toBe(parent.id);
    // A child is a hierarchy statement and not a link; nothing goes in
    // the relations table for it (CTR-015).
    expect(await linksFrom(child.id)).toHaveLength(0);

    const entries = await entriesOn(child.id);
    const parented = entries.filter((entry) => entry.action === "contract.parent_set");
    expect(parented).toHaveLength(1);
    expect(parented[0]!.visibility).toBe("working_team");
    expect(parented[0]!.actorId).not.toBeNull();
    expect(parented[0]!.payload).toMatchObject({
      number: child.number,
      title: "Routing child parent — 2027 renewal",
      parentNumber: parent.number,
      parentTitle: parent.title,
    });

    // Nothing is written on the predecessor: CTR-015's no-cascade
    // stance is not only about status and confidentiality, and an entry
    // on a record whose row nobody touched would assert an edit that
    // never happened.
    const onParent = await entriesOn(parent.id);
    expect(onParent.some((entry) => entry.action === "contract.parent_set")).toBe(false);
    expect(onParent.some((entry) => entry.action === "contract.relation_added")).toBe(false);
    expect(await parentOf(parent.id)).toBeNull();
  });

  it("leaves the predecessor's own record untouched", async () => {
    const parent = await predecessor("Routing child untouched");
    const before = await read(parent.number);

    await create({
      title: "Routing child untouched — renewal",
      contractTypeId: parent.contractTypeId,
      renewalOf: { number: parent.number, vehicle: "child" },
    });

    const after = await read(parent.number);
    expect(after.statusId).toBe(before.statusId);
    expect(after.expiryDate).toBe(before.expiryDate);
    expect(after.isConfidential).toBe(before.isConfidential);
  });
});

describe("the successor vehicle (CTR-007 §4)", () => {
  it("is born holding a renews link to its predecessor, and narrates it", async () => {
    const original = await predecessor("Routing successor original");

    const successor = await create({
      title: "Routing successor original — 2027",
      contractTypeId: original.contractTypeId,
      renewalOf: { number: original.number, vehicle: "successor" },
    });

    // A successor stands beside its predecessor, not under it.
    expect(await parentOf(successor.id)).toBeNull();
    const links = await linksFrom(successor.id);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      fromContractId: successor.id,
      toContractId: original.id,
      relationType: "renews",
    });

    const linked = (await entriesOn(successor.id)).filter(
      (entry) => entry.action === "contract.relation_added",
    );
    expect(linked).toHaveLength(1);
    expect(linked[0]!.visibility).toBe("working_team");
    expect(linked[0]!.payload).toMatchObject({
      number: successor.number,
      title: "Routing successor original — 2027",
      relationType: "renews",
      relatedNumber: original.number,
      relatedTitle: original.title,
    });
  });

  it("writes the link in one direction only", async () => {
    const original = await predecessor("Routing successor direction");
    const successor = await create({
      title: "Routing successor direction — next",
      contractTypeId: original.contractTypeId,
      renewalOf: { number: original.number, vehicle: "successor" },
    });

    // The direction is the sentence: the successor renews the
    // predecessor, and there is no mirror row saying the reverse.
    expect(await linksFrom(original.id)).toHaveLength(0);
    expect(await linksFrom(successor.id)).toHaveLength(1);
  });
});

describe("the prefill (CTR-007, CTR-015's no-inheritance stance)", () => {
  it("copies the business facts of the deal onto both routed vehicles", async () => {
    const original = await predecessor("Routing prefill facts");

    for (const vehicle of ["child", "successor"] as const) {
      const born = await create({
        title: `Routing prefill facts — ${vehicle}`,
        contractTypeId: original.contractTypeId,
        renewalOf: { number: original.number, vehicle },
      });

      // Our side of it, what it is worth, and the shape of its term.
      expect(born.entity?.id).toBe(original.entity!.id);
      expect(born.value).toEqual(original.value);
      expect(born.termType).toBe("auto_renew");
      expect(born.effectiveDate).toBe("2025-07-01");
      expect(born.expiryDate).toBe("2026-06-30");
      expect(born.renewalPeriodMonths).toBe(12);
      expect(born.noticePeriodDays).toBe(90);

      // The other side of it, party for party, with the primary still
      // primary.
      const res = await harness.app.inject({
        method: "GET",
        url: `/api/v1/contracts/${born.number}`,
        cookies: memberCookies,
      });
      const parties = res.json().counterparties as { name: string; isPrimary: boolean }[];
      expect(parties.map((party) => party.name)).toEqual([
        "Routing prefill facts Counterparty A",
        "Routing prefill facts Counterparty B",
      ]);
      expect(parties.filter((party) => party.isPrimary)).toHaveLength(1);
      expect(born.primaryCounterparty?.name).toBe("Routing prefill facts Counterparty A");
    }
  });

  it("never copies the team, the status, or the Confidential flag", async () => {
    const original = await predecessor("Routing prefill absences", { confidential: true });
    expect(original.isConfidential).toBe(true);
    expect(original.statusId).toBe(activeStatusId);

    const successor = await create({
      title: "Routing prefill absences — successor",
      contractTypeId: original.contractTypeId,
      renewalOf: { number: original.number, vehicle: "successor" },
    });

    // The status is the protected draft seed every contract is born on
    // (CTR-001), not the predecessor's.
    expect(successor.statusId).not.toBe(activeStatusId);
    expect(successor.stage).toBe("draft");
    // The audience is decided for this record, by whoever made it.
    expect(successor.isConfidential).toBe(false);
    // The team is the creator's provenance row and nothing else — the
    // colleague on the predecessor did not come with it.
    const team = await harness.db
      .select()
      .from(contractTeam)
      .where(eq(contractTeam.contractId, successor.id));
    expect(team).toHaveLength(1);
    expect(team[0]).toMatchObject({ role: "creator" });
    expect(team.some((row) => row.userId === colleagueId)).toBe(false);
    // And neither is the Owner, the priority, or the risk: all three
    // are facts about a record rather than about the deal.
    expect(successor.manager).toBeNull();
    expect(successor.priority).toBe("medium");
    expect(successor.risk).toBeNull();
  });

  it("takes the title and the type the person pressed Create with, not the predecessor's", async () => {
    const original = await predecessor("Routing prefill editable");
    expect(original.contractTypeId).toBe(msaTypeId);

    const born = await create({
      title: "A title the person typed instead",
      // The dialog seeds the type from the record and the person may
      // change it before pressing; whatever they pressed with is what
      // the record is born as.
      contractTypeId: ndaTypeId,
      renewalOf: { number: original.number, vehicle: "successor" },
    });

    expect(born.title).toBe("A title the person typed instead");
    expect(born.contractTypeId).toBe(ndaTypeId);
    // The business facts still came across: editing the two the dialog
    // draws does not turn off the copy of the ones it does not.
    expect(born.entity?.id).toBe(original.entity!.id);
    expect(born.value).toEqual(original.value);
  });

  it("leaves an archived counterparty behind and re-seats the primary if it was the one that left", async () => {
    const original = await predecessor("Routing archived party");
    const before = await harness.app.inject({
      method: "GET",
      url: `/api/v1/contracts/${original.number}`,
      cookies: memberCookies,
    });
    const held = before.json().counterparties as { id: string; name: string; isPrimary: boolean }[];
    const leaving = held.find((party) => party.isPrimary)!;
    await harness.db
      .update(counterparties)
      .set({ archivedAt: new Date() })
      .where(eq(counterparties.id, leaving.id));

    const born = await create({
      title: "Routing archived party — successor",
      contractTypeId: msaTypeId,
      renewalOf: { number: original.number, vehicle: "successor" },
    });

    const res = await harness.app.inject({
      method: "GET",
      url: `/api/v1/contracts/${born.number}`,
      cookies: memberCookies,
    });
    const parties = res.json().counterparties as { name: string; isPrimary: boolean }[];
    // A party nobody may add by hand today does not arrive on a new
    // record through a copy — routing is not the way around the rule.
    expect(parties.map((party) => party.name)).toEqual(["Routing archived party Counterparty B"]);
    // And the survivor takes the flag, so the one-primary invariant
    // holds from the first moment.
    expect(parties.filter((party) => party.isPrimary)).toHaveLength(1);
    expect(born.primaryCounterparty?.name).toBe("Routing archived party Counterparty B");

    // The predecessor keeps what signed it: archiving a name in the
    // register never edits a contract it was on (CTR-011).
    const after = await harness.app.inject({
      method: "GET",
      url: `/api/v1/contracts/${original.number}`,
      cookies: memberCookies,
    });
    expect((after.json().counterparties as unknown[]).length).toBe(2);
  });

  it("leaves an archived entity behind: our side is copied live or not at all", async () => {
    const original = await predecessor("Routing archived entity");
    await harness.db
      .update(entities)
      .set({ archivedAt: new Date() })
      .where(eq(entities.id, original.entity!.id));

    const born = await create({
      title: "Routing archived entity — successor",
      contractTypeId: msaTypeId,
      renewalOf: { number: original.number, vehicle: "successor" },
    });

    // The field write refuses an archived signatory (CTR-011), so a
    // copy that carried one onto a new record would be the way around
    // that rule — the archived-counterparty stance, applied to our own
    // side of the deal.
    expect(born.entity).toBeNull();
    // The rest of the facts still came across: one dead reference does
    // not turn off the copy.
    expect(born.value).toEqual(original.value);
    expect(born.expiryDate).toBe("2026-06-30");

    // The predecessor keeps what signed it: archiving an entity never
    // edits a contract it was on (CTR-011).
    expect((await read(original.number)).entity?.id).toBe(original.entity!.id);
  });

  it("routes from a predecessor holding none of the facts without inventing any", async () => {
    const bare = await create({ title: "Routing bare predecessor", contractTypeId: ndaTypeId });

    const born = await create({
      title: "Routing bare predecessor — renewal",
      contractTypeId: ndaTypeId,
      renewalOf: { number: bare.number, vehicle: "child" },
    });

    expect(born.entity).toBeNull();
    expect(born.value).toBeNull();
    expect(born.termType).toBe("fixed");
    expect(born.expiryDate).toBeNull();
    expect(born.primaryCounterparty).toBeNull();
    expect(await parentOf(born.id)).toBe(bare.id);
  });
});

describe("who may route, and from what", () => {
  it("refuses a predecessor the router cannot reach exactly as one that does not exist", async () => {
    const walled = await predecessor("Routing confidential predecessor", { confidential: true });

    const refused = await createRaw(
      {
        title: "Routing confidential predecessor — successor",
        contractTypeId: msaTypeId,
        renewalOf: { number: walled.number, vehicle: "successor" },
      },
      outsiderCookies,
    );
    expect(refused.statusCode, refused.body).toBe(404);

    // A contract number nobody has used answers the same way, to the
    // same viewer, so the seam is no oracle for which records exist.
    const missing = await createRaw(
      {
        title: "Routing missing predecessor",
        contractTypeId: msaTypeId,
        renewalOf: { number: 999_999, vehicle: "successor" },
      },
      outsiderCookies,
    );
    expect(missing.statusCode, missing.body).toBe(404);
    expect(missing.json().detail).toBe(refused.json().detail);
  });

  it("refuses to route from an archived predecessor until it is restored", async () => {
    const original = await predecessor("Routing archived predecessor");
    const froze = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${original.number}/archive`,
      cookies: memberCookies,
    });
    expect(froze.statusCode, froze.body).toBe(200);

    const refused = await createRaw({
      title: "Routing archived predecessor — successor",
      contractTypeId: msaTypeId,
      renewalOf: { number: original.number, vehicle: "successor" },
    });
    expect(refused.statusCode, refused.body).toBe(409);
  });

  it("refuses a vehicle it does not offer", async () => {
    const original = await predecessor("Routing bad vehicle");
    const refused = await createRaw({
      title: "Routing bad vehicle — successor",
      contractTypeId: msaTypeId,
      renewalOf: { number: original.number, vehicle: "amendment" },
    });
    expect(refused.statusCode, refused.body).toBe(400);
  });

  it("writes nothing at all when the create itself is refused", async () => {
    const original = await predecessor("Routing atomic");
    const before = await linksFrom(original.id);

    const refused = await createRaw({
      title: "Routing atomic — successor",
      contractTypeId: "no-such-type",
      renewalOf: { number: original.number, vehicle: "successor" },
    });
    expect(refused.statusCode, refused.body).toBe(400);

    // One transaction: a refused create leaves no half-linked record.
    expect(await linksFrom(original.id)).toHaveLength(before.length);
    const orphans = await harness.db
      .select()
      .from(contractRelations)
      .where(eq(contractRelations.toContractId, original.id));
    expect(orphans).toHaveLength(0);
  });
});

describe("CTR-015's two guards at the row", () => {
  it("refuses a second link for one pair and one type", async () => {
    const original = await predecessor("Routing duplicate guard");
    const successor = await create({
      title: "Routing duplicate guard — successor",
      contractTypeId: msaTypeId,
      renewalOf: { number: original.number, vehicle: "successor" },
    });

    // Routing itself cannot reach this: every routed create makes a new
    // record, so its link is new too. The rule still has to hold, and
    // the compound key is what holds it whichever code arrives next.
    await expect(
      harness.db.insert(contractRelations).values({
        fromContractId: successor.id,
        toContractId: original.id,
        relationType: "renews",
      }),
    ).rejects.toThrow();

    // A second type between the same pair is a different statement and
    // is allowed, which is why the type is part of the key.
    await harness.db.insert(contractRelations).values({
      fromContractId: successor.id,
      toContractId: original.id,
      relationType: "amends",
    });
    expect(await linksFrom(successor.id)).toHaveLength(2);
  });

  it("refuses a contract that is its own parent, and a link to itself", async () => {
    const alone = await create({ title: "Routing self guard", contractTypeId: ndaTypeId });

    await expect(
      harness.db.update(contracts).set({ parentId: alone.id }).where(eq(contracts.id, alone.id)),
    ).rejects.toThrow();
    await expect(
      harness.db.insert(contractRelations).values({
        fromContractId: alone.id,
        toContractId: alone.id,
        relationType: "related",
      }),
    ).rejects.toThrow();
  });

  it("refuses a relation type outside CTR-015's three", async () => {
    const left = await create({ title: "Routing type guard left", contractTypeId: ndaTypeId });
    const right = await create({ title: "Routing type guard right", contractTypeId: ndaTypeId });

    await expect(
      // Written as raw SQL because the typed insert cannot express a
      // value outside the union — which is the point: the row refuses
      // it too, so the union is a rule and not a convention.
      harness.db.execute(sql`
        insert into ${contractRelations}
          (${sql.identifier("from_contract_id")}, ${sql.identifier("to_contract_id")},
           ${sql.identifier("relation_type")})
        values (${left.id}, ${right.id}, 'supersedes')
      `),
    ).rejects.toThrow();
    expect(await linksFrom(left.id)).toHaveLength(0);
  });
});

describe("the amendment vehicle (CTR-007 §2)", () => {
  it("files a version on the primary chain and makes no record and no link", async () => {
    const original = await predecessor("Routing amendment");

    // The record's paper, and the chain the amendment lands on.
    const first = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${original.number}/documents`,
      cookies: memberCookies,
      payload: form({ kind: "draft_ours", filename: "msa.txt", body: "the original" }),
      headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
    });
    expect(first.statusCode, first.body).toBe(201);
    const primary = first.json().document as { id: string; versions: unknown[] };

    const amended = await harness.app.inject({
      method: "POST",
      url: `/api/v1/documents/${primary.id}/versions`,
      cookies: memberCookies,
      payload: form({ kind: "amendment", filename: "amendment-1.txt", body: "the renewal" }),
      headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
    });
    expect(amended.statusCode, amended.body).toBe(201);
    const chain = amended.json().document as {
      versions: { versionNumber: number; kind: string }[];
    };
    expect(chain.versions.map((version) => version.kind)).toContain("amendment");

    // The renewal stayed on the record it amends: no new contract was
    // made, nothing was linked, and the term did not move.
    expect(await linksFrom(original.id)).toHaveLength(0);
    expect(await parentOf(original.id)).toBeNull();
    expect(await read(original.number)).toMatchObject({ expiryDate: original.expiryDate });
  });
});

/** The multipart boundary the upload fixtures use. */
const BOUNDARY = "----openlawrouting";

/**
 * One upload as a multipart body, with the non-file fields first — the
 * order the documents route requires, because its parser only reports
 * the fields it has already seen when the file arrives.
 */
function form(part: Readonly<{ kind: string; filename: string; body: string }>): Buffer {
  const lines = [
    `--${BOUNDARY}`,
    'Content-Disposition: form-data; name="kind"',
    "",
    part.kind,
    `--${BOUNDARY}`,
    `Content-Disposition: form-data; name="file"; filename="${part.filename}"`,
    "Content-Type: text/plain",
    "",
    part.body,
    `--${BOUNDARY}--`,
    "",
  ];
  return Buffer.from(lines.join("\r\n"));
}
