// SPDX-License-Identifier: AGPL-3.0-only

/**
 * M8 milestone acceptance (#114): the demo, end to end, in one browser
 * session. A Legal Team Member opens the new Contracts destination,
 * creates a contract, sets its Owner and its team, picks which of our
 * Entities signs and the two Counterparties on the other side, fills the
 * custom field its type demands, and finds the record again in the list.
 *
 * It also carries the assertion the M7 spec deferred: a registered
 * Entity is selectable as the signing entity on a contract. M7 had no
 * contract to select it on; M8 does, so the seam between the registry
 * and the record is proved here.
 *
 * A second journey proves the two access floors (CTR-021): a
 * Contributor's nav carries the Contracts item, their list holds only
 * the contract they are on the team of, the record opens read-only, a
 * contract they are not on answers 404 as one that does not exist, and
 * every write and both Member+ picker reads answer 403.
 *
 * The seed and migration checks at the top are the `docker compose up`
 * acceptance, asserted from inside the demo: the M8 migrations
 * (0016–0022) landed on the running stack, the CTR-001 draft seed is
 * there to be born on, and the M6 field catalog answers.
 *
 * The never-reset instance (TECH-018) is left as the run found it. Two
 * kinds of row need two answers:
 *
 * - Per-run rows carry a prefix, are swept before the journey starts,
 *   and end archived — the resting state contracts and entities share,
 *   because neither has a hard delete.
 * - Rows that cannot be swept at all are stable instead of per-run, so
 *   the suite owns one of each forever rather than one more every run.
 *   The demo contract type is one: a contract cannot be moved off the
 *   type it was born on, and an archived contract still holds it, so a
 *   per-run type could never be deleted. The two counterparties are the
 *   other: M8 ships no route that archives or deletes one.
 */

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { z } from "zod";
import {
  ADMIN,
  ensureAdminExists,
  ensureMemberInert,
  onboardActivatedMember,
  signInAs,
  type OnboardedMember,
} from "./helpers.js";

/** Per-run rows carry these prefixes so a crashed earlier run's
 * leftovers can be swept before the journey starts. The entity prefix is
 * deliberately not M7's — the two specs sweep their own rows and must
 * not reach into each other's. */
const CONTRACT_PREFIX = "E2E Helix master services";
const ENTITY_PREFIX = "E2E M8 Holdings";

/** The demo's contract type, owned by the suite and reused every run. */
const TYPE_NAME = "E2E M8 demo type";

/** The two M6 seed fields the demo type attaches, and how each is
 * attached. The required one is filled in the create dialog, which is
 * where CTR-016 hard-enforcement is met; the optional one is committed
 * inline on the record, which is where DES-017 lives. */
const REQUIRED_FIELD = { slug: "governing_law", label: "Governing law" } as const;
const OPTIONAL_FIELD = { slug: "our_position", label: "Our position" } as const;
const GOVERNING_LAW = "England & Wales";
/** One of the `our_position` seed's own options (migration 0010). */
const OUR_POSITION = "Provider";

/** The two counterparties the demo names, primary first. The first run
 * creates them from the typeahead, name alone (CTR-011); every later run
 * finds the same two and picks them. */
const COUNTERPARTIES = ["E2E Helix Group", "E2E Northwind Partners"] as const;

/** The Owner the demo hands the contract to — a Legal Team Member, so
 * the pick also proves the picker's Member+ floor is not just the
 * Administrator (CTR-004). */
const OWNER_NAME = "Priya Counsel";

const ContractRows = z.object({
  contracts: z.array(
    z.object({
      number: z.number().int(),
      title: z.string(),
      archivedAt: z.string().nullable(),
    }),
  ),
});

const ContractRecord = z.object({
  contract: z.object({
    number: z.number().int(),
    title: z.string(),
    statusName: z.string(),
    stage: z.string(),
    manager: z.object({ displayName: z.string() }).nullable(),
    entity: z.object({ legalName: z.string() }).nullable(),
    primaryCounterparty: z.object({ name: z.string() }).nullable(),
    customFields: z.record(z.string(), z.unknown()),
  }),
  team: z.array(z.object({ displayName: z.string(), role: z.string() })),
  counterparties: z.array(z.object({ name: z.string(), isPrimary: z.boolean() })),
});

const TaxonomyRow = z.object({
  id: z.string(),
  displayName: z.string(),
  archivedAt: z.string().nullable(),
});
const TaxonomyRows = z.object({ contractTypes: z.array(TaxonomyRow) });

const AttachedFields = z.object({
  attachedFields: z.array(z.object({ slug: z.string(), isRequired: z.boolean() })),
});

const CatalogFields = z.object({ fields: z.array(z.object({ id: z.string(), slug: z.string() })) });

const EntityRows = z.object({
  entities: z.array(z.object({ id: z.string(), legalName: z.string() })),
});

/** One contract PATCH — the per-field commit every inline edit makes
 * (DES-017). Await the returned promise after the gesture that fires it. */
function contractPatched(page: Page) {
  return page.waitForResponse(
    (response) =>
      /\/api\/v1\/contracts\/\d+$/.test(response.url()) && response.request().method() === "PATCH",
  );
}

async function listContracts(request: APIRequestContext) {
  const listed = await request.get("/api/v1/contracts");
  expect(listed.ok()).toBe(true);
  return ContractRows.parse(await listed.json()).contracts;
}

/** Archives every live per-run contract — the soft-delete resting state
 * (TECH-018 cleanup; a contract has no hard delete). The default list
 * leaves archived rows out, so nothing here is archived twice. */
async function ensureDemoContractsInert(request: APIRequestContext) {
  for (const row of (await listContracts(request)).filter((contract) =>
    contract.title.startsWith(CONTRACT_PREFIX),
  )) {
    const archived = await request.post(`/api/v1/contracts/${row.number}/archive`);
    expect(archived.ok()).toBe(true);
  }
}

async function listEntities(request: APIRequestContext) {
  const listed = await request.get("/api/v1/entities");
  expect(listed.ok()).toBe(true);
  return EntityRows.parse(await listed.json()).entities;
}

/** Archives every live per-run entity, as M7's own spec does. An entity
 * a contract already names stays on that record untouched — archiving
 * takes it out of the picker, not off the paper (CTR-011). */
async function ensureDemoEntitiesInert(request: APIRequestContext) {
  for (const row of (await listEntities(request)).filter((entity) =>
    entity.legalName.startsWith(ENTITY_PREFIX),
  )) {
    const archived = await request.post(`/api/v1/entities/${row.id}/archive`);
    expect(archived.ok()).toBe(true);
  }
}

/**
 * The demo's contract type, with the two seed fields attached as the
 * demo needs them. Everything here is idempotent: the type is created on
 * the first run and found on every later one, restored if a crashed run
 * left it archived, and each attachment is added or corrected in place.
 */
async function ensureDemoType(request: APIRequestContext): Promise<void> {
  const listed = await request.get("/api/v1/contract-types?includeArchived=true");
  expect(listed.ok()).toBe(true);
  const existing = TaxonomyRows.parse(await listed.json()).contractTypes.find(
    (row) => row.displayName === TYPE_NAME,
  );

  let typeId: string;
  if (!existing) {
    const created = await request.post("/api/v1/contract-types", {
      data: { displayName: TYPE_NAME },
    });
    expect(created.status(), await created.text()).toBe(201);
    typeId = z.object({ contractType: TaxonomyRow }).parse(await created.json()).contractType.id;
  } else {
    typeId = existing.id;
    if (existing.archivedAt !== null) {
      const restored = await request.post(`/api/v1/contract-types/${typeId}/restore`);
      expect(restored.ok()).toBe(true);
    }
  }

  // The M6 catalog, live: this read leaves archived fields out, so
  // finding both slugs also proves both seeds are still attachable.
  const catalog = await request.get("/api/v1/fields");
  expect(catalog.ok()).toBe(true);
  const seeds = CatalogFields.parse(await catalog.json()).fields;
  const attachedNow = await request.get(`/api/v1/contract-types/${typeId}/fields`);
  expect(attachedNow.ok()).toBe(true);
  const attached = AttachedFields.parse(await attachedNow.json()).attachedFields;

  for (const [field, isRequired] of [
    [REQUIRED_FIELD, true],
    [OPTIONAL_FIELD, false],
  ] as const) {
    const seed = seeds.find((row) => row.slug === field.slug);
    expect(seed, `the ${field.slug} seed field is missing from the catalog`).toBeDefined();
    const held = attached.find((row) => row.slug === field.slug);
    if (!held) {
      const attachedField = await request.post(`/api/v1/contract-types/${typeId}/fields`, {
        data: { fieldId: seed!.id, isRequired },
      });
      expect(attachedField.status(), await attachedField.text()).toBe(201);
    } else if (held.isRequired !== isRequired) {
      const corrected = await request.patch(`/api/v1/contract-types/${typeId}/fields/${seed!.id}`, {
        data: { isRequired },
      });
      expect(corrected.ok()).toBe(true);
    }
  }
}

/** Registers the per-run Entity the contract will be signed by. M7's own
 * spec proves the registration screen; this one needs the row to exist
 * so the signing-entity picker has something of ours to offer. */
async function registerDemoEntity(request: APIRequestContext): Promise<string> {
  const types = await request.get("/api/v1/entities/types");
  expect(types.ok()).toBe(true);
  const corporation = z
    .object({ entityTypes: z.array(z.object({ id: z.string(), slug: z.string() })) })
    .parse(await types.json())
    .entityTypes.find((row) => row.slug === "corporation");
  expect(corporation, "the corporation entity type seed is missing").toBeDefined();

  const legalName = `${ENTITY_PREFIX} UK Ltd ${Date.now()}`;
  const created = await request.post("/api/v1/entities", {
    data: {
      legalName,
      entityTypeId: corporation!.id,
      jurisdiction: "England & Wales",
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  return legalName;
}

/** One person's id by email, read from the Administrator-only user
 * list — the id every team route is addressed by. */
async function userIdOf(request: APIRequestContext, email: string): Promise<string> {
  const listed = await request.get("/api/v1/users");
  expect(listed.ok()).toBe(true);
  const found = z
    .object({ users: z.array(z.object({ id: z.string(), email: z.string() })) })
    .parse(await listed.json())
    .users.find((user) => user.email === email);
  expect(found, `no user is registered under ${email}`).toBeDefined();
  return found!.id;
}

/**
 * Creates a per-run contract on a seed type that demands no fields, and
 * answers its CTR-003 number. The Contributor journey needs two records
 * to tell apart, and neither of them needs the demo type's attachments.
 */
async function createBareContract(request: APIRequestContext, title: string): Promise<number> {
  const options = await request.get("/api/v1/contracts/options");
  expect(options.ok()).toBe(true);
  const bare = z
    .object({
      contractTypes: z.array(
        z.object({
          id: z.string(),
          fields: z.array(z.object({ isRequired: z.boolean() })),
        }),
      ),
    })
    .parse(await options.json())
    .contractTypes.find((type) => type.fields.every((field) => !field.isRequired));
  expect(bare, "no contract type without a hard-required field is configured").toBeDefined();

  const created = await request.post("/api/v1/contracts", {
    data: { title, contractTypeId: bare!.id },
  });
  expect(created.status(), await created.text()).toBe(201);
  return z.object({ contract: z.object({ number: z.number().int() }) }).parse(await created.json())
    .contract.number;
}

/**
 * Names one counterparty through the shared typeahead (CTR-011). The row
 * to click is whichever the picker offers: the organization we already
 * hold, or the offer to create the name that matched nothing. Both put
 * the same one counterparty on the contract, and the read-back at the
 * end proves exactly one record stands under each name either way.
 */
async function addCounterparty(page: Page, name: string) {
  const picker = page.getByRole("combobox", { name: "Counterparties" });
  await picker.fill(name);
  const matches = page.getByRole("listbox", { name: "Counterparty matches" });
  const row = matches
    .getByRole("option", { name, exact: true })
    .or(matches.getByRole("option", { name: `Create "${name}"`, exact: true }));
  await expect(row).toBeVisible();
  const added = page.waitForResponse(
    (response) =>
      /\/api\/v1\/contracts\/\d+\/counterparties$/.test(response.url()) &&
      response.request().method() === "POST",
  );
  await row.click();
  expect((await added).ok()).toBe(true);
}

test.describe.serial("M8 demo path", () => {
  test.beforeAll(async ({ request }) => {
    await ensureAdminExists(request);
  });

  test("create a contract, set its people and both sides, fill a field, and find it in the list", async ({
    page,
    browser,
  }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);

    // Known starting state on the never-reset instance (TECH-018): a
    // crashed earlier run may have left per-run rows behind.
    await ensureDemoContractsInert(page.request);
    await ensureDemoEntitiesInert(page.request);

    // The compose-up acceptance from inside the demo: the M8 migrations
    // landed, the record's own picker read answers, and the CTR-001
    // draft seed every contract is born on is there.
    const options = await page.request.get("/api/v1/contracts/options");
    expect(options.ok()).toBe(true);
    const statusSlugs = z
      .object({ contractStatuses: z.array(z.object({ slug: z.string() })) })
      .parse(await options.json())
      .contractStatuses.map((row) => row.slug);
    expect(statusSlugs, "the draft contract status seed is missing").toContain("draft");

    await ensureDemoType(page.request);
    const legalName = await registerDemoEntity(page.request);

    const ownerEmail = `e2e-m8-owner-${Date.now()}@e2e.example`;
    const title = `${CONTRACT_PREFIX} ${Date.now()}`;
    let owner: OnboardedMember | undefined;
    try {
      owner = await onboardActivatedMember(page.request, browser, {
        email: ownerEmail,
        displayName: OWNER_NAME,
        role: "legal_team_member",
        password: "their-own-e2e-password",
      });

      // The new Contracts destination, from the nav.
      await page.goto("/");
      await page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("link", { name: "Contracts" })
        .click();
      await expect(page).toHaveURL(/\/contracts$/);
      await expect(page.getByRole("heading", { level: 1, name: "Contracts" })).toBeVisible();

      // Create the contract. The dialog takes a title and a type, and
      // grows the fields that type hard-requires the moment the type is
      // picked (CTR-016/MTR-014) — so the demo's custom field is
      // answered before the record exists.
      await page.getByRole("button", { name: "Create contract" }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Title").fill(title);
      await dialog.getByLabel("Contract type").selectOption({ label: TYPE_NAME });
      await dialog.getByLabel(REQUIRED_FIELD.label).fill(GOVERNING_LAW);
      const created = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/contracts") && response.request().method() === "POST",
      );
      await dialog.getByRole("button", { name: "Create", exact: true }).click();
      const number = z
        .object({ contract: z.object({ number: z.number().int() }) })
        .parse(await (await created).json()).contract.number;
      await expect(dialog).toBeHidden();

      // It took a reference from the CTR-003 sequence, and the row
      // opens the record at that reference (`/contracts/42`).
      const listRow = page.getByRole("row").filter({ hasText: title });
      await expect(listRow).toContainText(`C-${number}`);
      await listRow.getByRole("link", { name: title }).click();
      await expect(page).toHaveURL(new RegExp(`/contracts/${number}$`));
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();

      // The Owner: one accountable person, set from the picker and
      // committed on its own (CTR-004, DES-017).
      const ownerSaved = contractPatched(page);
      await page.getByLabel("Owner").selectOption({ label: OWNER_NAME });
      expect((await ownerSaved).ok()).toBe(true);
      // The DES-017 micro-state, beside the one field that has
      // committed so far — this is the whole page's only "Saved".
      await expect(page.getByText("Saved", { exact: true })).toHaveCount(1);
      const teamCard = page.getByRole("region", { name: "Team" });
      await expect(teamCard).toContainText(OWNER_NAME);
      await expect(teamCard).toContainText("Owner");
      // Provenance, written at creation and never again (CTR-004).
      await expect(teamCard).toContainText("Creator");

      // The team: who else is on this, and in which role. Naming two
      // things at once is the compound edit DES-017 gives a dialog.
      await page.getByRole("button", { name: "Add team member" }).click();
      const teamDialog = page.getByRole("dialog");
      await teamDialog.getByLabel("Person").selectOption({ label: ADMIN.displayName });
      await teamDialog.getByLabel("Role").selectOption({ label: "Watcher" });
      const teamAdded = page.waitForResponse(
        (response) =>
          /\/api\/v1\/contracts\/\d+\/team$/.test(response.url()) &&
          response.request().method() === "POST",
      );
      await teamDialog.getByRole("button", { name: "Add", exact: true }).click();
      expect((await teamAdded).ok()).toBe(true);
      await expect(teamDialog).toBeHidden();
      await expect(teamCard).toContainText("Watcher");

      // Our side (CTR-011) — and the assertion M7 deferred to this
      // spec: an Entity registered in the M7 registry is offered by the
      // signing-entity picker, and committing it puts it on the record.
      const entityPicker = page.getByLabel("Our entity");
      await expect(entityPicker.getByRole("option", { name: legalName, exact: true })).toHaveCount(
        1,
      );
      const entitySaved = contractPatched(page);
      await entityPicker.selectOption({ label: legalName });
      expect((await entitySaved).ok()).toBe(true);

      // Their side: two counterparties, exactly one of them primary.
      for (const name of COUNTERPARTIES) await addCounterparty(page, name);
      for (const name of COUNTERPARTIES) {
        await expect(page.getByRole("listitem").filter({ hasText: name })).toBeVisible();
      }
      // The pill, matched case-sensitively so the other row's "Make
      // primary" control cannot pass for it. The first party to join
      // takes the flag, and only one party ever holds it (CTR-011).
      const primary = page.getByRole("listitem").filter({ hasText: /Primary/ });
      await expect(primary).toHaveCount(1);
      await expect(primary).toContainText(COUNTERPARTIES[0]);

      // The custom field the type attaches but does not demand, filled
      // where every field on this record is filled — in place, on its
      // own (CTR-016, DES-017). A select is a decision, so it commits
      // the moment it changes.
      const fieldSaved = contractPatched(page);
      await page.getByLabel(OPTIONAL_FIELD.label).selectOption(OUR_POSITION);
      expect((await fieldSaved).ok()).toBe(true);

      // And find it again in the list, reading as the C1 mock draws it:
      // the reference, the title, the primary counterparty, the type,
      // the status label, and the Owner.
      await page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("link", { name: "Contracts" })
        .click();
      await expect(page).toHaveURL(/\/contracts$/);
      const found = page.getByRole("row").filter({ hasText: title });
      await expect(found).toBeVisible();
      await expect(found).toContainText(`C-${number}`);
      await expect(found).toContainText(COUNTERPARTIES[0]);
      await expect(found).toContainText(TYPE_NAME);
      await expect(found).toContainText("Draft");
      await expect(found).toContainText(OWNER_NAME);

      // Behind the screen: the record holds everything the journey put
      // on it, and holds it once.
      const read = await page.request.get(`/api/v1/contracts/${number}`);
      expect(read.ok()).toBe(true);
      const record = ContractRecord.parse(await read.json());
      expect(record.contract.stage).toBe("draft");
      expect(record.contract.manager?.displayName).toBe(OWNER_NAME);
      expect(record.contract.entity?.legalName).toBe(legalName);
      expect(record.contract.customFields[REQUIRED_FIELD.slug]).toBe(GOVERNING_LAW);
      expect(record.contract.customFields[OPTIONAL_FIELD.slug]).toBe(OUR_POSITION);
      expect(record.counterparties.map((party) => party.name)).toEqual([...COUNTERPARTIES]);
      expect(record.counterparties.filter((party) => party.isPrimary).length).toBe(1);
      expect(record.contract.primaryCounterparty?.name).toBe(COUNTERPARTIES[0]);
      // The same person under two roles is membership, not a duplicate
      // (CTR-004's compound key).
      expect(record.team.map((member) => `${member.displayName} ${member.role}`).sort()).toEqual([
        `${ADMIN.displayName} creator`,
        `${ADMIN.displayName} watcher`,
      ]);
    } finally {
      // Leave the shared instance as the run found it (TECH-018): the
      // per-run contract and entity archived, the per-run Owner archived
      // (an activated user has no hard delete). Archiving a person named
      // on a record never touches the record.
      await ensureDemoContractsInert(page.request);
      await ensureDemoEntitiesInert(page.request);
      await owner?.context.close();
      await ensureMemberInert(page.request, ownerEmail);
    }
  });

  test("a Contributor reads the contracts they are on, and nothing else (CTR-021)", async ({
    page,
    browser,
  }) => {
    await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
    await ensureDemoContractsInert(page.request);

    const email = `e2e-m8-contributor-${Date.now()}@e2e.example`;
    let member: OnboardedMember | undefined;
    try {
      member = await onboardActivatedMember(page.request, browser, {
        email,
        displayName: "Rowan Contributor",
        role: "contributor",
        password: "their-own-e2e-password",
      });
      const contributorPage = member.page;
      const contributorId = await userIdOf(page.request, email);

      // Two contracts, titled per run so two runs in flight at once
      // never read each other's rows. The Contributor goes on the first
      // team and nowhere near the second.
      const stamp = Date.now();
      const theirsTitle = `${CONTRACT_PREFIX} theirs ${stamp}`;
      const notTheirsTitle = `${CONTRACT_PREFIX} not theirs ${stamp}`;
      const theirs = await createBareContract(page.request, theirsTitle);
      const notTheirs = await createBareContract(page.request, notTheirsTitle);
      const joined = await page.request.post(`/api/v1/contracts/${theirs}/team`, {
        data: { userId: contributorId, role: "contributor" },
      });
      expect(joined.status(), await joined.text()).toBe(201);

      // The Contracts destination is drawn for them now — they have
      // contracts to see. Entities stays Member+ (ENT-004).
      await contributorPage.goto("/");
      const nav = contributorPage.getByRole("navigation", { name: "Primary" });
      await expect(nav.getByRole("link", { name: "Contracts" })).toBeVisible();
      await expect(nav.getByRole("link", { name: "Entities" })).toHaveCount(0);

      // Their list is their work: the contract they are on is there,
      // the one they are not is not, and no create action is offered.
      await contributorPage.goto("/contracts");
      await expect(contributorPage.getByRole("link", { name: theirsTitle })).toBeVisible();
      await expect(contributorPage.getByRole("link", { name: notTheirsTitle })).toHaveCount(0);
      await expect(contributorPage.getByRole("button", { name: "Create contract" })).toHaveCount(0);

      // The record opens read-only: the inputs are inert and neither
      // archive nor restore is offered.
      await contributorPage.goto(`/contracts/${theirs}`);
      await expect(
        contributorPage.getByRole("heading", { level: 1, name: theirsTitle }),
      ).toBeVisible();
      await expect(contributorPage.getByLabel("Title")).toBeDisabled();
      await expect(contributorPage.getByLabel("Status")).toBeDisabled();
      await expect(contributorPage.getByRole("button", { name: "Archive" })).toHaveCount(0);
      await expect(contributorPage.getByRole("button", { name: "Restore" })).toHaveCount(0);

      // The client is convenience; the API is the gate. The read they
      // hold answers; the one they do not is 404, exactly as a contract
      // that does not exist. Every write and the Member+ picker reads
      // are 403. The writes carry shape-valid bodies: validation
      // answers before the role guard, and the refusal under test is
      // the guard's.
      const listed = await contributorPage.request.get("/api/v1/contracts");
      expect(listed.ok()).toBe(true);
      const numbers = ContractRows.parse(await listed.json()).contracts.map((row) => row.number);
      expect(numbers).toContain(theirs);
      expect(numbers).not.toContain(notTheirs);

      const held = await contributorPage.request.get(`/api/v1/contracts/${theirs}`);
      expect(held.status(), await held.text()).toBe(200);
      const withheld = await contributorPage.request.get(`/api/v1/contracts/${notTheirs}`);
      expect(withheld.status(), "a contract they are not on must read as absent").toBe(404);

      const refusals = [
        contributorPage.request.get("/api/v1/contracts/options"),
        contributorPage.request.get("/api/v1/counterparties"),
        contributorPage.request.post("/api/v1/contracts", {
          data: { title: "Sneaky contract", contractTypeId: "any" },
        }),
        contributorPage.request.patch(`/api/v1/contracts/${theirs}`, {
          data: { title: "Renamed by a Contributor" },
        }),
        contributorPage.request.post(`/api/v1/contracts/${theirs}/archive`),
        contributorPage.request.post(`/api/v1/contracts/${theirs}/counterparties`, {
          data: { name: "Sneaky counterparty" },
        }),
      ];
      for (const refused of await Promise.all(refusals)) {
        expect(refused.status(), "the contract write seams must refuse a Contributor").toBe(403);
      }
    } finally {
      await ensureDemoContractsInert(page.request);
      await member?.context.close();
      await ensureMemberInert(page.request, email);
    }
  });
});
