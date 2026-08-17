// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The relations read (M17/2, CTR-015), at the HTTP seam through the
 * real-Postgres harness.
 *
 * **One read answers all of it**: the parent chain root-first, the
 * children, and both directions of every typed link — the successor's
 * panel says it renews the predecessor, the predecessor's says it is
 * renewed by the successor, from the same single row, on which nothing
 * was ever written at the predecessor's end.
 *
 * **The reach filter sits in the read, not the render** (CTR-018,
 * DD-014). A relative the viewer cannot reach comes back as
 * `{ restricted: true }` and nothing else: the named leak test asserts
 * on the raw body that no number and no title of a walled relative ever
 * leaves the server — the placeholder is the server's answer, not the
 * client's redaction.
 *
 * **The contract itself is reached first** (CTR-021). A viewer who
 * cannot reach the record is answered exactly as for a contract that was
 * never created — the same sentence, the same 404 — and a Contributor
 * reads the graph for the record they hold a `contract_team` row on,
 * with their own reach deciding each relative.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, contractRelations, eq, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN as ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

/** The person who makes every record and link. */
const MEMBER = {
  email: "relations-member@example.com",
  displayName: "Nadia Counsel",
  password: "correct-horse-battery",
} as const;

/** A Legal Team Member with no team row anywhere — reaches every open
 * record, and must see a walled relative as the placeholder alone. */
const VIEWER = {
  email: "relations-viewer@example.com",
  displayName: "Vera Viewer",
  password: "correct-horse-battery",
} as const;

/** A Contributor — reach is exactly the records they hold a row on. */
const CONTRIBUTOR = {
  email: "relations-contributor@example.com",
  displayName: "Casey Contributor",
  password: "correct-horse-battery",
} as const;

let harness: TestHarness;
let memberCookies: Record<string, string>;
let viewerCookies: Record<string, string>;
let contributorCookies: Record<string, string>;
let contributorId = "";
let ndaTypeId = "";

interface ContractRow {
  id: string;
  number: number;
  title: string;
}

type Relative =
  | { restricted: true }
  | { restricted: false; number: number; title: string; statusName: string; stage: string };

interface LinkEntry {
  relationType: string;
  direction: string;
  contract: Relative;
}

interface Relations {
  parentChain: Relative[];
  children: Relative[];
  links: LinkEntry[];
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

  const viewer = await provisionUser(harness.app.auth, VIEWER);
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, viewer.id));
  viewerCookies = await signInCookies(harness.app, VIEWER.email, VIEWER.password);

  const contributor = await provisionUser(harness.app.auth, CONTRIBUTOR);
  contributorId = contributor.id;
  await harness.db.update(users).set({ role: "contributor" }).where(eq(users.id, contributor.id));
  contributorCookies = await signInCookies(harness.app, CONTRIBUTOR.email, CONTRIBUTOR.password);

  const res = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies: memberCookies,
  });
  expect(res.statusCode, res.body).toBe(200);
  const types = res.json().contractTypes as { id: string; slug: string }[];
  ndaTypeId = types.find((row) => row.slug === "nda")!.id;
}, 120_000);

afterAll(async () => {
  await harness.stop();
});

/** One contract through the create seam — plain, walled, or routed. */
async function create(payload: Record<string, unknown>): Promise<ContractRow> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies: memberCookies,
    payload: { contractTypeId: ndaTypeId, ...payload },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().contract as ContractRow;
}

const readRaw = (number: number, cookies = memberCookies) =>
  harness.app.inject({
    method: "GET",
    url: `/api/v1/contracts/${number}/relations`,
    cookies,
  });

async function read(number: number, cookies = memberCookies): Promise<Relations> {
  const res = await readRaw(number, cookies);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Relations;
}

describe("one relations read (CTR-015)", () => {
  it("answers the parent chain root-first, the children by number, and the typed links", async () => {
    // A three-deep chain, two children, a successor, and a related side
    // letter — every shape the read has to answer, on one record.
    const root = await create({ title: "Relations framework agreement" });
    const mid = await create({
      title: "Relations first statement of work",
      renewalOf: { number: root.number, vehicle: "child" },
    });
    const subject = await create({
      title: "Relations change order",
      renewalOf: { number: mid.number, vehicle: "child" },
    });
    const childA = await create({
      title: "Relations first amendment record",
      renewalOf: { number: subject.number, vehicle: "child" },
    });
    const childB = await create({
      title: "Relations second amendment record",
      renewalOf: { number: subject.number, vehicle: "child" },
    });
    const successor = await create({
      title: "Relations successor order",
      renewalOf: { number: subject.number, vehicle: "successor" },
    });
    const sideLetter = await create({ title: "Relations side letter" });
    // `related` has no write seam until M17's manual linking, so the
    // row is arranged directly — the renewal-routing suite's precedent
    // for rules that no route can yet reach.
    await harness.db.insert(contractRelations).values({
      fromContractId: subject.id,
      toContractId: sideLetter.id,
      relationType: "related",
    });

    const relations = await read(subject.number);

    // The chain is root-first: the walk collects leaf-to-root and the
    // route reverses it, so the breadcrumb reads top-down.
    expect(relations.parentChain).toEqual([
      expect.objectContaining({ restricted: false, number: root.number, title: root.title }),
      expect.objectContaining({ restricted: false, number: mid.number, title: mid.title }),
    ]);
    // A reachable relative carries exactly what one card needs.
    expect(relations.parentChain[0]).toMatchObject({ stage: "draft" });
    expect(typeof (relations.parentChain[0] as { statusName: string }).statusName).toBe("string");

    // The children, by number — deterministic between two reads.
    expect(relations.children).toEqual([
      expect.objectContaining({ restricted: false, number: childA.number }),
      expect.objectContaining({ restricted: false, number: childB.number }),
    ]);

    // Both link shapes: the successor's renews row read from this end
    // is incoming, and the symmetric related row is always outgoing.
    expect(relations.links).toHaveLength(2);
    const renews = relations.links.find((link) => link.relationType === "renews")!;
    expect(renews.direction).toBe("incoming");
    expect(renews.contract).toMatchObject({ restricted: false, number: successor.number });
    const related = relations.links.find((link) => link.relationType === "related")!;
    expect(related.direction).toBe("outgoing");
    expect(related.contract).toMatchObject({ restricted: false, number: sideLetter.number });

    // The symmetric row from the far end: still one row, still outgoing.
    const fromSideLetter = await read(sideLetter.number);
    expect(fromSideLetter.links).toEqual([
      expect.objectContaining({
        relationType: "related",
        direction: "outgoing",
        contract: expect.objectContaining({ number: subject.number }),
      }),
    ]);
  });

  it("answers both directions of one renews row, on which the predecessor holds nothing", async () => {
    const predecessor = await create({ title: "Relations old master agreement" });
    const successor = await create({
      title: "Relations new master agreement",
      renewalOf: { number: predecessor.number, vehicle: "successor" },
    });

    // One row, written at the successor's end and never mirrored.
    const rows = await harness.db
      .select()
      .from(contractRelations)
      .where(
        and(
          eq(contractRelations.fromContractId, successor.id),
          eq(contractRelations.toContractId, predecessor.id),
        ),
      );
    expect(rows).toHaveLength(1);
    const mirrors = await harness.db
      .select()
      .from(contractRelations)
      .where(eq(contractRelations.fromContractId, predecessor.id));
    expect(mirrors).toHaveLength(0);

    // The successor's panel says it renews the predecessor…
    const fromSuccessor = await read(successor.number);
    expect(fromSuccessor.links).toEqual([
      expect.objectContaining({
        relationType: "renews",
        direction: "outgoing",
        contract: expect.objectContaining({ number: predecessor.number }),
      }),
    ]);

    // …and the predecessor's says it is renewed by the successor.
    const fromPredecessor = await read(predecessor.number);
    expect(fromPredecessor.links).toEqual([
      expect.objectContaining({
        relationType: "renews",
        direction: "incoming",
        contract: expect.objectContaining({ number: successor.number }),
      }),
    ]);
  });

  it("keeps an archived child off the list, and an archived ancestor in the chain", async () => {
    const top = await create({ title: "Relations archive frame" });
    const middle = await create({
      title: "Relations archive middle",
      renewalOf: { number: top.number, vehicle: "child" },
    });
    const kid = await create({
      title: "Relations archive kid",
      renewalOf: { number: middle.number, vehicle: "child" },
    });

    const freeze = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${kid.number}/archive`,
      cookies: memberCookies,
    });
    expect(freeze.statusCode, freeze.body).toBe(200);

    const relations = await read(middle.number);
    // The archived child leaves the list the way it leaves the registers.
    expect(relations.children).toEqual([]);

    // An archived ancestor stays: a chain with a hole in it would say
    // this record sits somewhere it does not.
    const freezeTop = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${top.number}/archive`,
      cookies: memberCookies,
    });
    expect(freezeTop.statusCode, freezeTop.body).toBe(200);
    const after = await read(middle.number);
    expect(after.parentChain).toEqual([
      expect.objectContaining({ restricted: false, number: top.number }),
    ]);
  });
});

describe("the reach filter sits in the read (CTR-018, DD-014)", () => {
  it("leaks neither the number nor the title of a relative the viewer cannot reach", async () => {
    // A walled parent, a walled child, and a walled successor around
    // one open record. The member on every wall sees all three; the
    // viewer outside them must get the placeholder alone.
    const walledParent = await create({
      title: "Walled framework agreement",
      isConfidential: true,
    });
    const open = await create({
      title: "Open order under the wall",
      renewalOf: { number: walledParent.number, vehicle: "child" },
    });
    const walledChild = await create({
      title: "Walled child order",
      renewalOf: { number: open.number, vehicle: "child" },
      isConfidential: true,
    });
    const walledSuccessor = await create({
      title: "Walled successor order",
      renewalOf: { number: open.number, vehicle: "successor" },
      isConfidential: true,
    });

    // Sanity: the member, inside every wall, reads all three summaries.
    const fromInside = await read(open.number);
    expect(fromInside.parentChain).toEqual([
      expect.objectContaining({ restricted: false, number: walledParent.number }),
    ]);
    expect(fromInside.children).toEqual([
      expect.objectContaining({ restricted: false, number: walledChild.number }),
    ]);

    // The viewer reaches the open record but none of its relatives.
    const res = await readRaw(open.number, viewerCookies);
    expect(res.statusCode, res.body).toBe(200);
    const relations = res.json() as Relations;

    expect(relations.parentChain).toEqual([{ restricted: true }]);
    expect(relations.children).toEqual([{ restricted: true }]);
    expect(relations.links).toEqual([
      { relationType: "renews", direction: "incoming", contract: { restricted: true } },
    ]);

    // The raw body is the leak surface (the CTR-024 stance: what never
    // leaves the server cannot be redacted wrong). No walled title, no
    // walled number, nothing beside the placeholder key.
    expect(res.body).not.toContain("Walled");
    expect(res.body).not.toContain(String(walledParent.number));
    expect(res.body).not.toContain(String(walledChild.number));
    expect(res.body).not.toContain(String(walledSuccessor.number));
    for (const entry of [relations.parentChain[0]!, relations.children[0]!]) {
      expect(Object.keys(entry)).toEqual(["restricted"]);
    }
  });

  it("answers a contract out of reach exactly as one that was never created", async () => {
    const walled = await create({ title: "Walled record itself", isConfidential: true });

    const refused = await readRaw(walled.number, viewerCookies);
    const absent = await readRaw(999_999, viewerCookies);
    expect(refused.statusCode).toBe(404);
    expect(absent.statusCode).toBe(404);
    expect(refused.body).not.toContain("Walled");
    expect(refused.json().detail).toBe(absent.json().detail);
  });

  it("lets a Contributor on the team read the graph, with their own reach deciding each relative", async () => {
    const frame = await create({ title: "Contributor open frame" });
    const anchor = await create({
      title: "Contributor anchor order",
      renewalOf: { number: frame.number, vehicle: "child" },
    });
    const joined = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${anchor.number}/team`,
      cookies: memberCookies,
      payload: { userId: contributorId, role: "contributor" },
    });
    expect(joined.statusCode, joined.body).toBe(201);

    // On the record they hold a row on, the read answers…
    const relations = await read(anchor.number, contributorCookies);
    // …but the parent is not theirs to see: Contributor reach is the
    // team row, not the record's openness, so even an open ancestor is
    // the placeholder (CTR-021).
    expect(relations.parentChain).toEqual([{ restricted: true }]);

    // And off the team, the record itself never existed.
    expect((await readRaw(frame.number, contributorCookies)).statusCode).toBe(404);
  });
});
