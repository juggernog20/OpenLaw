// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  contracts,
  counterparties,
  contractCounterparties,
  contractTeam,
  contractTypes,
  contractStatuses,
  matters,
  matterTeam,
  matterTypes,
  matterStatuses,
  users,
  eq,
} from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  startHarness,
  signInCookies,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

let harness: TestHarness;
let business: Record<string, string>;
let businessId: string;
let legalId: string;
const records: Record<"contracts" | "matters", { id: string; number: number; title: string }[]> = {
  contracts: [],
  matters: [],
};
const hidden: Record<string, number> = {};
const typeIds: Record<string, string> = {};

beforeAll(async () => {
  harness = await startHarness();
  await harness.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  const [admin] = await harness.db.select().from(users).where(eq(users.email, TEST_ADMIN.email));
  legalId = admin!.id;
  const fixture = {
    email: "portal-list-business@example.com",
    displayName: "Portfolio reader",
    password: "correct-horse-battery",
  };
  const person = await provisionUser(harness.app.auth, fixture);
  businessId = person.id;
  await harness.db.update(users).set({ role: "business_user" }).where(eq(users.id, person.id));
  business = await signInCookies(harness.app, fixture.email, fixture.password);
  const [contractType] = await harness.db.select().from(contractTypes);
  const [matterType] = await harness.db.select().from(matterTypes);
  const [contractStatus] = await harness.db.select().from(contractStatuses);
  const [matterStatus] = await harness.db.select().from(matterStatuses);
  const [privateContractType] = await harness.db
    .insert(contractTypes)
    .values({ slug: "private-portfolio", displayName: "Hidden Contract type", displayOrder: 99 })
    .returning();
  const [privateMatterType] = await harness.db
    .insert(matterTypes)
    .values({ slug: "private-portfolio", displayName: "Hidden Matter type", displayOrder: 99 })
    .returning();
  typeIds.contracts = contractType!.id;
  typeIds.matters = matterType!.id;
  for (let i = 0; i < 31; i++) {
    const title = i === 30 ? "100%_Exact" : `Portfolio ${["Alpha", "beta", "Zulu"][i % 3]}`;
    const [contract] = await harness.db
      .insert(contracts)
      .values({
        title,
        contractTypeId: contractType!.id,
        statusId: contractStatus!.id,
        managerId: i < 20 ? legalId : null,
        expiryDate: i < 20 ? "2026-12-31" : null,
      })
      .returning();
    const [matter] = await harness.db
      .insert(matters)
      .values({
        createdBy: legalId,
        title,
        matterTypeId: matterType!.id,
        statusId: matterStatus!.id,
        managerId: i < 20 ? legalId : null,
      })
      .returning();
    records.contracts.push(contract!);
    records.matters.push(matter!);
  }
  await harness.db
    .insert(contractTeam)
    .values(records.contracts.map((row) => ({ contractId: row.id, userId: businessId })));
  await harness.db
    .insert(matterTeam)
    .values(records.matters.map((row) => ({ matterId: row.id, userId: businessId })));
  const [hiddenContract] = await harness.db
    .insert(contracts)
    .values({
      title: "Portfolio hidden",
      contractTypeId: privateContractType!.id,
      statusId: contractStatus!.id,
      managerId: businessId,
      isConfidential: true,
    })
    .returning();
  const [hiddenMatter] = await harness.db
    .insert(matters)
    .values({
      createdBy: legalId,
      title: "Portfolio hidden",
      matterTypeId: privateMatterType!.id,
      statusId: matterStatus!.id,
      managerId: businessId,
      isConfidential: true,
    })
    .returning();
  hidden.contracts = hiddenContract!.number;
  hidden.matters = hiddenMatter!.number;
  const [archivedContract] = await harness.db
    .insert(contracts)
    .values({
      title: "Portfolio archived",
      contractTypeId: privateContractType!.id,
      statusId: contractStatus!.id,
      archivedAt: new Date(),
    })
    .returning();
  const [archivedMatter] = await harness.db
    .insert(matters)
    .values({
      createdBy: legalId,
      title: "Portfolio archived",
      matterTypeId: privateMatterType!.id,
      statusId: matterStatus!.id,
      archivedAt: new Date(),
    })
    .returning();
  await harness.db
    .insert(contractTeam)
    .values({ contractId: archivedContract!.id, userId: businessId });
  await harness.db.insert(matterTeam).values({ matterId: archivedMatter!.id, userId: businessId });
});
afterAll(async () => harness?.stop());

async function list(module: "contracts" | "matters", params: Record<string, string> = {}) {
  const response = await harness.app.inject({
    method: "GET",
    url: `/api/v1/portal/${module}?${new URLSearchParams(params)}`,
    cookies: business,
  });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.headers["cache-control"]).toBe("private, no-store");
  return response.json();
}
for (const module of ["contracts", "matters"] as const) {
  describe(`Portal ${module} lists`, () => {
    it("searches the full accessible list and scopes totals and filter choices", async () => {
      const data = await list(module, { q: "Portfolio" });
      expect(data.total).toBe(30);
      expect(data[module]).toHaveLength(25);
      expect(data.filterOptions.types).toEqual([expect.objectContaining({ id: typeIds[module] })]);
      expect(data.filterOptions.owners.map((owner: { id: string }) => owner.id)).toEqual([legalId]);
      expect(JSON.stringify(data)).not.toContain("Hidden");
      expect((await list(module, { q: "hidden" })).total).toBe(0);
      const reference = records[module][0]!;
      expect(
        (await list(module, { q: `${module === "contracts" ? "C" : "M"}-${reference.number}` }))[
          module
        ].map((row: { number: number }) => row.number),
      ).toEqual([reference.number]);
      expect(
        (await list(module, { q: "%_" }))[module].map((row: { title: string }) => row.title),
      ).toEqual(["100%_Exact"]);
    });
    it("combines filters and searches, preserving totals on the next page", async () => {
      const filtered = await list(module, {
        q: "Portfolio",
        typeId: typeIds[module]!,
        ownerId: legalId,
      });
      expect(filtered.total).toBe(20);
      const first = await list(module, { q: "Portfolio", sort: "title", dir: "asc" });
      const second = await list(module, {
        q: "Portfolio",
        sort: "title",
        dir: "asc",
        cursor: String(first.nextCursor),
      });
      expect(second.total).toBe(30);
      expect(second.nextCursor).toBeNull();
      const sorted = [...first[module], ...second[module]];
      expect(sorted.map((row: { number: number }) => row.number)).toEqual(
        [...records[module].slice(0, 30)]
          .sort(
            (a, b) =>
              a.title.toLowerCase().localeCompare(b.title.toLowerCase()) || b.number - a.number,
          )
          .map((row) => row.number),
      );
    });
    it("keeps null owner rows last in both directions without repeating tied rows", async () => {
      for (const dir of ["asc", "desc"]) {
        const first = await list(module, { sort: "owner", dir });
        const second = await list(module, { sort: "owner", dir, cursor: String(first.nextCursor) });
        const actual = [...first[module], ...second[module]].map(
          (row: { number: number }) => row.number,
        );
        const expected = [
          ...records[module].slice(0, 20).reverse(),
          ...records[module].slice(20).reverse(),
        ].map((row) => row.number);
        expect(actual).toEqual(expected);
      }
    });
    it("refuses hidden, nonexistent, and revoked cursors alike", async () => {
      for (const cursor of [hidden[module]!, 99999999])
        expect((await list(module, { cursor: String(cursor), sort: "title" }))[module]).toEqual([]);
      const record = records[module][0]!;
      if (module === "contracts")
        await harness.db.delete(contractTeam).where(eq(contractTeam.contractId, record.id));
      else await harness.db.delete(matterTeam).where(eq(matterTeam.matterId, record.id));
      try {
        const response = await list(module, { cursor: String(record.number) });
        expect(response[module]).toEqual([]);
        expect(response.total).toBe(30);
      } finally {
        if (module === "contracts")
          await harness.db
            .insert(contractTeam)
            .values({ contractId: record.id, userId: businessId });
        else
          await harness.db.insert(matterTeam).values({ matterId: record.id, userId: businessId });
      }
    });
  });
}
it("filters Contract expiry dates and validates ranges and sort keys", async () => {
  const data = await list("contracts", { expiryFrom: "2026-12-01", expiryTo: "2026-12-31" });
  expect(data.total).toBe(20);
  for (const query of [
    "expiryFrom=2027-01-01&expiryTo=2026-01-01",
    "sort=customFields",
    "q=" + "x".repeat(201),
  ]) {
    const response = await harness.app.inject({
      method: "GET",
      url: `/api/v1/portal/contracts?${query}`,
      cookies: business,
    });
    expect(response.statusCode, response.body).toBe(400);
  }
});

it("searches the primary Counterparty and filters Contract stage", async () => {
  const [counterparty] = await harness.db
    .insert(counterparties)
    .values({ name: "Supplier 100%_Group" })
    .returning();
  const record = records.contracts[0]!;
  await harness.db
    .insert(contractCounterparties)
    .values({ contractId: record.id, counterpartyId: counterparty!.id, isPrimary: true });
  const data = await list("contracts", { q: "supplier 100%_" });
  expect(data.contracts.map((row: { number: number }) => row.number)).toEqual([record.number]);
  expect((await list("contracts", { q: "supplier", stage: data.contracts[0].stage })).total).toBe(
    1,
  );
  const otherStage = data.contracts[0].stage === "ended" ? "active" : "ended";
  expect((await list("contracts", { q: "supplier", stage: otherStage })).total).toBe(0);
});

it("filters Matters by Status and open or closed lifecycle", async () => {
  const [closed] = await harness.db
    .select()
    .from(matterStatuses)
    .where(eq(matterStatuses.category, "closed"));
  const record = records.matters[0]!;
  const [before] = await harness.db.select().from(matters).where(eq(matters.id, record.id));
  await harness.db.update(matters).set({ statusId: closed!.id }).where(eq(matters.id, record.id));
  try {
    expect(
      (await list("matters", { category: "closed" })).matters.map(
        (row: { number: number }) => row.number,
      ),
    ).toEqual([record.number]);
    expect((await list("matters", { statusId: closed!.id })).total).toBe(1);
    expect((await list("matters", { category: "open", statusId: closed!.id })).total).toBe(0);
  } finally {
    await harness.db
      .update(matters)
      .set({ statusId: before!.statusId })
      .where(eq(matters.id, record.id));
  }
});
