// V-C53 steps for "Manage Entity structure and access" (docs/user-guides/entity-structure-and-access.md), DOC-032.
// Written by the DOC-032 independent walkthrough agent (records). Ported from the DOC-030 entities
// walkthrough.mjs c53 function. New in DOC-032: the Entity's Contracts and Matters tabs are managed
// tables (main-list columns, count beside the heading, sorting, Columns, Show more after 50 rows,
// archived/ended/closed records included), and individual owners carry a person icon on the chart.
// Fixture Entities, Contracts, Matters, a Matter Field and a Matter type are named
// "DOC-032 records V-C53 ... <stamp>". The Field and type are archived after the last role.
// One fixture (a par value stored before par values had a currency) has no API; as in DOC-030 it
// is set with one SQL update on this run's own fixture Entity through docker exec.
import { execFileSync } from "node:child_process";
import { lab, until } from "./lib.mjs";
import {
  expect,
  q,
  tidy,
  wait,
  sessionFor,
  go,
  settle,
  reload,
  blurTo,
  sectionText,
  section,
  typeInto,
  plain,
  req,
  applyFilter,
  pickDate,
  fixtureEntity,
  fixtureContract,
  addHolding,
  addIndividual,
  errorScreens,
} from "./entities-lib.mjs";

const ROLES = (process.env.ROLES ?? "administrator,legal_team_member").split(",");

function psql(sql) {
  return execFileSync("docker", [
    "exec",
    `${lab.project}-postgres-1`,
    "psql",
    "-U",
    "openlaw",
    "-d",
    "openlaw",
    "-tAc",
    sql,
  ])
    .toString()
    .trim();
}

let bulkPromise = null;
/** Linked-work fixtures shared by both roles: one Entity with 53 reachable linked Contracts
 * (one archived, one Expired) plus one Confidential Contract, and three Matters that name it
 * through a fixture Entity Field (one closed, one Confidential). Created once per process by
 * the Administrator. */
function bulkFixtures(ctx) {
  bulkPromise ??= (async () => {
    const a = await sessionFor(ctx, "administrator");
    const N = (what) => `DOC-032 records V-C53 ${what} ${ctx.stamp}`;
    const entity = await fixtureEntity(ctx, a, N("linked work"));
    const statuses = (await a.api("GET", "/contract-statuses")).json.contractStatuses;
    const expired = statuses.find((x) => x.slug === "expired");
    const contracts = [];
    const link = async (c) => {
      const r = await a.api("PATCH", `/contracts/${c.number}`, { entityId: entity.id });
      expect(r.status === 200, `Our entity ${r.status} ${q(r.json)}`);
    };
    for (let i = 1; i <= 51; i++) {
      const c = await fixtureContract(ctx, a, N(`linked contract ${String(i).padStart(2, "0")}`), {
        quiet: true,
      });
      await link(c);
      contracts.push(c);
    }
    const archived = await fixtureContract(ctx, a, N("linked contract archived"), { quiet: true });
    await link(archived);
    const ar = await a.api("POST", `/contracts/${archived.number}/archive`, {});
    expect(ar.status === 200, `archive ${ar.status} ${q(ar.json)}`);
    contracts.push(archived);
    const ended = await fixtureContract(ctx, a, N("linked contract expired"), { quiet: true });
    await link(ended);
    const er = await a.api("PATCH", `/contracts/${ended.number}`, {
      statusId: expired.id,
      overrideSoftGate: true,
    });
    expect(er.status === 200, `expire ${er.status} ${q(er.json)}`);
    contracts.push(ended);
    const confidential = await fixtureContract(ctx, a, N("linked contract confidential"), {
      isConfidential: true,
      quiet: true,
    });
    await link(confidential);
    const field = (
      await a.api("POST", "/fields", {
        displayName: N("Entity field"),
        moduleScope: "matter",
        fieldType: "entity",
      })
    ).json.field;
    const type = (await a.api("POST", "/matter-types", { displayName: N("linked type") })).json
      .matterType;
    const form = (await a.api("GET", `/matter-types/${type.id}/form`)).json.form;
    const put = await a.api("PUT", `/matter-types/${type.id}/form`, {
      form: [
        ...form,
        {
          kind: "row",
          id: field.id,
          rowRef: field.slug,
          fieldType: "entity",
          onIntakeForm: false,
          isRequired: false,
          visibleOnPortal: false,
        },
      ],
    });
    expect(put.status === 200, `form ${put.status} ${q(put.json)}`);
    const matter = async (what, extra = {}) => {
      const r = await a.api("POST", "/matters", {
        title: N(what),
        matterTypeId: type.id,
        managerId: null,
        customFields: { [field.slug]: entity.id },
        ...extra,
      });
      expect(r.status === 201, `matter ${r.status} ${q(r.json)}`);
      return r.json.matter;
    };
    const openMatter = await matter("linked matter open");
    const closedMatter = await matter("linked matter closed");
    const closedStatus = (await a.api("GET", "/matter-statuses")).json.matterStatuses.find(
      (x) => x.category === "closed" && !x.archivedAt,
    );
    const cl = await a.api("PATCH", `/matters/${closedMatter.number}`, {
      statusId: closedStatus.id,
      closingNote: "DOC-032 fictional closing note.",
    });
    expect(cl.status === 200, `close ${cl.status} ${q(cl.json)}`);
    const confidentialMatter = await matter("linked matter confidential", { isConfidential: true });
    await ctx.record({
      what: "V-C53 linked-work fixtures",
      how: "Administrator API as Daniel Okafor",
      entity: entity.legalName,
      contracts: `${contracts.length} reachable Contracts with Our entity set (C-${contracts[0].number} to C-${ended.number}; C-${archived.number} archived, C-${ended.number} moved to ${expired.displayName}) and Confidential C-${confidential.number}`,
      matters: `M-${openMatter.number} open, M-${closedMatter.number} ${closedStatus.displayName}, Confidential M-${confidentialMatter.number}, all naming the Entity in ${field.displayName} on type ${type.displayName}`,
      cleanup:
        "Contracts and Matters kept, named for the run; the Field and type archived after the last role",
    });
    return {
      entity,
      contracts,
      archived,
      ended,
      confidential,
      field,
      type,
      openMatter,
      closedMatter,
      confidentialMatter,
    };
  })();
  return bulkPromise;
}

async function cleanupBulk(ctx) {
  if (!bulkPromise) return;
  const bulk = await bulkPromise;
  const a = await sessionFor(ctx, "administrator");
  let t = await a.api("POST", `/matter-types/${bulk.type.id}/archive`, {});
  let moved = "";
  if (t.status === 409) {
    // The fixture Matters use the type: move them to the Default type, as the dialog asks.
    const fallback = (await a.api("GET", "/matters/options")).json.matterTypes.find(
      (x) => x.isDefault,
    );
    t = await a.api("POST", `/matter-types/${bulk.type.id}/archive`, { reassignToId: fallback.id });
    moved = `, its Matters moved to ${fallback.displayName}`;
  }
  const f = await a.api("POST", `/fields/${bulk.field.id}/archive`);
  await ctx.record({
    what: "V-C53 fixture cleanup",
    cleanup: `Archived ${bulk.type.displayName} (${t.status}${moved}) and ${bulk.field.displayName} (${f.status})`,
  });
}

export default async function entityStructureAndAccess(ctx) {
  const R = ctx.role;
  const TAG = ctx.stamp;
  const step = (role, pg, action, expected, fn, opts = {}) =>
    ctx.step(action, expected, fn, {
      page: pg,
      ...opts,
      actor:
        opts.actor ??
        (role !== R
          ? ({
              administrator: "Daniel Okafor",
              legal_team_member: "Nadia Haddad",
              priya: "Priya Raman",
            }[role] ?? role)
          : undefined),
    });
  const fixture = (what, how) => ctx.record({ what, how });
  const guideFailure = (role, stepName, expected, observed) =>
    ctx.guideFailure({ step: stepName, expected, observed });
  const observation = (id, summary, reproduction, observed) =>
    ctx.record({ what: `Observation ${id}`, summary, reproduction, observed });
  const productBug = (id, summary, reproduction, observed) =>
    ctx.productBug({ id, summary, reproduction, observed });
  const shot = (p, name) => ctx.shot(p, name.replace(/^c53-/, "entity-structure-and-access-"));
  const s = await sessionFor(ctx, R);
  ctx.setPage(s.page);
  const { page } = s;
  const who = R === "administrator" ? "A" : "L";
  const otherKey = R === "administrator" ? "legal_team_member" : "administrator";
  const o = await sessionFor(ctx, otherKey);
  const reader = await sessionFor(ctx, "priya");
  const prefix = `DOC-032 records V-C53 ${who} ${TAG}`;
  const P = await fixtureEntity(ctx, s, `${prefix} parent`);
  const S = await fixtureEntity(ctx, s, `${prefix} secret sub`);
  const M = await fixtureEntity(ctx, s, `${prefix} minor owner`);
  const S2 = await fixtureEntity(ctx, s, `${prefix} plural sub`);
  const U = await fixtureEntity(ctx, s, `${prefix} lone`);
  const Rg = await fixtureEntity(ctx, s, `${prefix} register co`);
  const L = await fixtureEntity(ctx, s, `${prefix} legacy par`);
  const AR = await fixtureEntity(ctx, s, `${prefix} archived candidate`);
  await s.api("POST", `/entities/${AR.id}/archive`, {});
  fixture(`${AR.legalName} archived`, `POST /entities/:id/archive as ${s.person.name}`);
  psql(`update entities set par_value = 125, par_value_currency = null where id = '${L.id}'`);
  fixture(
    `${L.legalName} par value 125 minor units with no currency (a value saved before par values had a currency)`,
    "SQL update through docker exec on the lab database, this fixture only",
  );
  const ada = `Ada Quill ${who} ${TAG}`;
  const hold = async (owned, owner, pct) => {
    const r = await s.api("POST", `/entities/${owned.id}/holdings`, {
      direction: "owner",
      relatedEntityId: owner.id,
      ownershipPercent: pct,
    });
    expect(r.status === 201, `holding fixture ${r.status} ${q(r.json)}`);
  };
  await hold(S, P, 75);
  await hold(S, M, 25);
  await hold(S2, P, 40);
  await hold(S2, M, 35);
  fixture(
    "Holdings P→S 75, M→S 25, P→S2 40, M→S2 35",
    `POST /entities/:id/holdings as ${s.person.name}`,
  );
  const c1 = await fixtureContract(ctx, s, `${prefix} open contract`);
  const c2 = await fixtureContract(ctx, s, `${prefix} confidential contract`, {
    isConfidential: true,
  });
  const c3 = await fixtureContract(ctx, s, `${prefix} signed by secret sub`);
  for (const [c, e] of [
    [c1, P],
    [c2, P],
    [c3, S],
  ]) {
    const r = await s.api("PATCH", `/contracts/${c.number}`, { entityId: e.id });
    expect(r.status === 200, `Our entity fixture ${r.status} ${q(r.json)}`);
  }
  const body = page.getByRole("main");
  const register = async (ent = Rg, who = s) =>
    (await who.api("GET", `/entities/${ent.id}/share-register`)).json;

  // ---------------- share capital ----------------
  await step(
    R,
    page,
    "Share capital steps 1-2, 4: Authorized shares saves on focus change, Issued shares on Enter; both survive reload",
    "1000 and 1000 persist.",
    async () => {
      await go(page, `/entities/${Rg.id}`);
      await typeInto(body.getByLabel("Authorized shares", { exact: true }), "1000");
      await blurTo(page, "Share capital");
      await typeInto(body.getByLabel("Issued shares", { exact: true }), "1000");
      await body.getByLabel("Issued shares", { exact: true }).press("Enter");
      await settle(page);
      await reload(page);
      const a = await body.getByLabel("Authorized shares", { exact: true }).inputValue();
      const i = await body.getByLabel("Issued shares", { exact: true }).inputValue();
      expect(plain(a) === "1000" && plain(i) === "1000", `${a} ${i}`);
      return `After a reload Authorized shares read ${a} (saved on focus change) and Issued shares read ${i} (saved with Enter).`;
    },
  );

  await step(
    R,
    page,
    "Share capital step 4: Escape abandons an unsaved edit",
    "Typing 999 then Escape restores 1,000 and nothing is saved.",
    async () => {
      const issued = body.getByLabel("Issued shares", { exact: true });
      await typeInto(issued, "999");
      await issued.press("Escape");
      const shown = plain(await issued.inputValue());
      await blurTo(page, "Share capital");
      await reload(page);
      const stored = plain(await body.getByLabel("Issued shares", { exact: true }).inputValue());
      expect(shown === "1000" && stored === "1000", `${shown} ${stored}`);
      return `Escape returned the control to ${shown}; after a reload it read ${stored}.`;
    },
  );

  await step(
    R,
    page,
    "Share capital note: negative and fractional share counts are refused without replacing the saved value",
    "-5 and 12.5 show 'Enter a whole number of zero or more.'; 1000 stays.",
    async () => {
      const seen = [];
      for (const bad of ["-5", "12.5"]) {
        const field = body.getByLabel("Authorized shares", { exact: true });
        await typeInto(field, bad);
        await blurTo(page, "Share capital");
        seen.push({
          bad,
          typed: plain(await field.inputValue()),
          message: await page.getByText("Enter a whole number of zero or more.").isVisible(),
        });
        await reload(page);
      }
      const stored = plain(
        await body.getByLabel("Authorized shares", { exact: true }).inputValue(),
      );
      expect(seen.every((x) => x.message) && stored === "1000", q({ seen, stored }));
      return `Attempts ${q(seen)}. After each reload Authorized shares read ${stored}.`;
    },
  );

  await step(
    R,
    page,
    "Share capital step 2: leave a value blank when it is unknown",
    "Clearing Issued shares saves a blank value.",
    async () => {
      await typeInto(body.getByLabel("Issued shares", { exact: true }), "");
      await blurTo(page, "Share capital");
      await reload(page);
      const blank = await body.getByLabel("Issued shares", { exact: true }).inputValue();
      const api = (await s.api("GET", `/entities/${Rg.id}`)).json.entity.sharesIssued;
      await typeInto(body.getByLabel("Issued shares", { exact: true }), "1000");
      await blurTo(page, "Share capital");
      expect(blank === "" && api === null, q({ blank, api }));
      return `Clearing Issued shares saved a blank value (read ${q(blank)} after a reload; stored ${api}). It was then set back to 1000.`;
    },
  );

  await step(
    R,
    page,
    "Share capital step 3 and note: Par value unavailable until Currency; amount within the currency's decimals; too many decimals refused; changing Currency keeps the amount",
    "Par value disabled with no Currency; GBP 1.25 saves; 1.255 refused; EUR keeps 1.25.",
    async () => {
      const par = body.getByLabel("Par value", { exact: true });
      const disabledBefore = await par.isDisabled();
      const currency = body.getByLabel("Currency", { exact: true });
      await currency.selectOption({ label: "GBP — British Pound" });
      await settle(page);
      const enabledAfter = await par.isEnabled();
      await typeInto(par, "1.25");
      await blurTo(page, "Share capital");
      await reload(page);
      const saved = await body.getByLabel("Par value", { exact: true }).inputValue();
      await typeInto(body.getByLabel("Par value", { exact: true }), "1.255");
      await blurTo(page, "Share capital");
      const refusal = await page
        .getByText("Enter a non-negative amount with up to 2 decimal places.")
        .isVisible();
      await reload(page);
      const afterRefusal = await body.getByLabel("Par value", { exact: true }).inputValue();
      await body.getByLabel("Currency", { exact: true }).selectOption({ label: "EUR — Euro" });
      await settle(page);
      await reload(page);
      const afterEuro = await body.getByLabel("Par value", { exact: true }).inputValue();
      const currencyNow = tidy(
        await body.getByLabel("Currency", { exact: true }).locator("option:checked").innerText(),
      );
      expect(
        disabledBefore &&
          enabledAfter &&
          saved === "1.25" &&
          refusal &&
          afterRefusal === "1.25" &&
          afterEuro === "1.25" &&
          /EUR/.test(currencyNow),
        q({ disabledBefore, enabledAfter, saved, refusal, afterRefusal, afterEuro, currencyNow }),
      );
      return `Par value was disabled before a Currency and enabled after GBP. 1.25 saved (${saved} after reload). 1.255 showed "Enter a non-negative amount with up to 2 decimal places." and ${afterRefusal} stayed stored. Changing Currency to ${currencyNow} kept ${afterEuro}.`;
    },
  );

  await step(
    R,
    page,
    "Share capital: a par value saved before par values had a currency shows its stored minor units and a note; choose a Currency, Confirm par value currency, Confirm amount and currency",
    "The note shows; the confirmation names the amount; confirming saves 1.25 GBP.",
    async () => {
      await go(page, `/entities/${L.id}`);
      const shown = await body.getByLabel("Par value", { exact: true }).inputValue();
      const note = tidy(
        await page.getByText(/Stored minor units; the original currency is unknown/).innerText(),
      );
      await body
        .getByLabel("Currency", { exact: true })
        .selectOption({ label: "GBP — British Pound" });
      const dialog = page.getByRole("dialog", { name: "Confirm par value currency" });
      await dialog.waitFor();
      const text = tidy(await dialog.innerText());
      await dialog.getByRole("button", { name: "Confirm amount and currency" }).click();
      await dialog.waitFor({ state: "hidden" });
      await settle(page);
      await reload(page);
      const after = await body.getByLabel("Par value", { exact: true }).inputValue();
      const api = (await s.api("GET", `/entities/${L.id}`)).json.entity;
      expect(
        /Choose a currency and confirm the amount/.test(note) &&
          /125/.test(text) &&
          /1\.25/.test(text) &&
          after === "1.25" &&
          api.parValueCurrency === "GBP",
        q({ shown, note, text, after, api: [api.parValue, api.parValueCurrency] }),
      );
      return `The Par value field showed ${q(shown)} with the note ${q(note)}. Choosing GBP opened "Confirm par value currency": ${q(text)}. Confirm amount and currency saved Par value ${after} ${api.parValueCurrency}.`;
    },
  );

  await step(
    R,
    page,
    "Share capital closing note: the three values are declared totals; the Ownership tab holds share classes, Holders and certificates",
    "The Ownership tab opens with the share register (No share register yet).",
    async () => {
      await go(page, `/entities/${Rg.id}/ownership`);
      const empty = await page.getByRole("heading", { name: "No share register yet" }).isVisible();
      const hint = tidy(await page.getByText(/Holders come from the entries/).innerText());
      const record = await page.getByRole("button", { name: "Record entry" }).isDisabled();
      expect(empty && record, q({ empty, record }));
      return `The Ownership tab showed "No share register yet" with ${q(hint)}; Record entry was unavailable until a live share class exists.`;
    },
  );

  // Hand-typed owners before the register exists, to see what the register does to them.
  await step(
    R,
    page,
    "Holdings (entity-records): hand-typed owners on an Entity before its register — an owner Entity and an individual",
    "Both appear under Declared owners not in the register.",
    async () => {
      await addHolding(page, {
        relationship: "Owns this Entity",
        entity: M.legalName,
        percent: "25",
      });
      await addIndividual(page, ada, "10");
      await reload(page);
      const declared = await sectionText(page, "Declared owners not in the register");
      expect(declared.includes(M.legalName) && declared.includes(ada), declared);
      return `Declared owners not in the register read ${q(declared)}.`;
    },
  );

  // ---------------- share register ----------------
  await step(
    R,
    page,
    "Set up share classes steps 1-4: New share class, Name, Authorized shares, Votes per share (starts at 1), Par value with Currency, Rights summary, Save",
    "The class lists its authorized count, votes per share and entry count.",
    async () => {
      await page.getByRole("button", { name: "New share class" }).click();
      const dialog = page.getByRole("dialog", { name: "Share classes" });
      await dialog.waitFor();
      const votesDefault = await dialog.getByLabel("Votes per share").inputValue();
      await dialog.getByLabel(req("Name")).fill("Ordinary");
      await dialog.getByLabel("Authorized shares").fill("1000");
      await dialog.getByLabel("Par value").fill("0.01");
      await dialog.getByLabel("Currency").selectOption({ label: "GBP — British Pound" });
      await dialog.getByLabel("Rights summary").fill("1 vote per share");
      await dialog.getByRole("button", { name: "Save" }).click();
      await dialog.getByText("Ordinary", { exact: true }).waitFor();
      await settle(page);
      const summary = tidy(await dialog.locator("li", { hasText: "Ordinary" }).innerText());
      // A second class with no cap, for the no-cap reading and the archive control.
      await dialog.getByRole("button", { name: "New share class" }).click();
      await dialog.getByLabel(req("Name")).fill("Preference");
      await dialog.getByRole("button", { name: "Save" }).click();
      await dialog.getByText("Preference", { exact: true }).waitFor();
      const second = tidy(await dialog.locator("li", { hasText: "Preference" }).innerText());
      expect(
        votesDefault === "1" &&
          /1,000 authorized · 1 vote per share · 0 entries/.test(summary) &&
          /no cap authorized/.test(second),
        q({ votesDefault, summary, second }),
      );
      return `Votes per share started at ${votesDefault}. Save listed ${q(summary)}. A second class with Authorized shares blank listed ${q(second)}.`;
    },
  );

  await step(
    R,
    page,
    "Share classes note: a class name must be unique on the Entity",
    "A second Ordinary is refused in the dialog.",
    async () => {
      const dialog = page.getByRole("dialog", { name: "Share classes" });
      await dialog.getByRole("button", { name: "New share class" }).click();
      await dialog.getByLabel(req("Name")).fill("Ordinary");
      await dialog.getByRole("button", { name: "Save" }).click();
      const alert = tidy(await dialog.getByRole("alert").innerText());
      await dialog.getByRole("button", { name: "Cancel" }).click();
      const classes = (await register()).classes.map((c) => c.name);
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      expect(
        /already exists/.test(alert) && classes.filter((n) => n === "Ordinary").length === 1,
        q({ alert, classes }),
      );
      return `A second class named Ordinary was refused with ${q(alert)}; the register kept ${q(classes)}.`;
    },
  );

  const entryDialog = () => page.getByRole("dialog", { name: /^(Record entry|Edit entry \d+)$/ });
  async function chooseHolder(dialog, side, choice) {
    const select = dialog.getByLabel(req(side));
    if (choice.entity) {
      await select.selectOption({ label: "Entity from the registry…" });
      await dialog
        .getByRole("combobox", { name: "Entity", exact: true })
        .selectOption({ label: choice.entity });
    } else if (choice.individual) {
      await select.selectOption({ label: "New individual…" });
      await dialog.getByLabel("Full name").fill(choice.individual);
    } else await select.selectOption({ label: choice.holder });
  }
  async function issueCertificate(dialog, number, holder, shares) {
    await dialog.getByRole("button", { name: "Issue certificate" }).click();
    const n = (await dialog.getByLabel("Certificate number").count()) - 1;
    await dialog.getByLabel("Certificate number").nth(n).fill(number);
    await dialog.getByLabel("Certificate holder").nth(n).selectOption({ label: holder });
    await dialog.getByLabel("Certificate shares").nth(n).fill(shares);
  }
  async function recordEntry({
    kind,
    date,
    from,
    to,
    shares,
    klass = "Ordinary",
    extra,
    certificates,
    cancel,
  }) {
    await page.getByRole("button", { name: "Record entry" }).first().click();
    const dialog = entryDialog();
    await dialog.waitFor();
    await dialog.getByLabel(req("Entry")).selectOption({ label: kind });
    if (date) await pickDate(page, dialog.locator("#share-entry-date"), date);
    if (from) await chooseHolder(dialog, "From", from);
    if (to) await chooseHolder(dialog, "To", to);
    await dialog.getByLabel(req("Class")).selectOption({ label: klass });
    await dialog.getByLabel(req("Shares")).fill(shares);
    if (extra) await extra(dialog);
    for (const c of cancel ?? []) await dialog.getByRole("checkbox", { name: c }).check();
    for (const c of certificates ?? []) await issueCertificate(dialog, ...c);
    await dialog.getByRole("button", { name: "Enter in register" }).click();
    return dialog;
  }
  const entriesText = async () =>
    (await page.getByRole("heading", { name: "Register of allotments and transfers" }).count())
      ? (
          await section(page, "Register of allotments and transfers")
            .locator("tbody tr")
            .allInnerTexts()
        ).map(tidy)
      : [];
  const membersText = async () =>
    (await section(page, "Register of members").locator("tbody tr").allInnerTexts()).map(tidy);

  await step(
    R,
    page,
    "Record an entry steps 1-7: Allotment To an Entity from the registry, Class, Shares, Price per share and Currency, Consideration, Distinctive numbers, Resolution reference, Note, Issue certificate, Enter in register",
    "Effective date starts at today; the registry list leaves out this Entity and archived Entities; entry 001 lists; Register of members shows the Holder's 600.",
    async () => {
      await page.getByRole("button", { name: "Record entry" }).first().click();
      const dialog = entryDialog();
      await dialog.waitFor();
      const kinds = (await dialog.getByLabel(req("Entry")).locator("option").allInnerTexts()).map(
        tidy,
      );
      const dateShown = tidy(await dialog.locator("#share-entry-date").innerText());
      const today = await page.evaluate(() =>
        new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      );
      await dialog.getByLabel(req("To")).selectOption({ label: "Entity from the registry…" });
      const registry = (
        await dialog
          .getByRole("combobox", { name: "Entity", exact: true })
          .locator("option")
          .allInnerTexts()
      ).map(tidy);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      const d = await recordEntry({
        kind: "Allotment",
        date: "2024-01-15",
        to: { entity: M.legalName },
        shares: "600",
        extra: async (x) => {
          await x.getByLabel("Price per share").fill("1.00");
          await x.locator("#share-entry-currency").selectOption({ label: "GBP — British Pound" });
          await x.getByLabel("Consideration").fill("Cash, fully paid");
          await x.locator("#share-entry-distinctive").fill("1-600");
          await x.getByLabel("Resolution reference").fill("BR-2024-01");
          await x.getByLabel("Note", { exact: true }).fill("Fictional first allotment.");
        },
        certificates: [["C-001", "To", "600"]],
      });
      await d.waitFor({ state: "hidden", timeout: 15000 });
      await settle(page);
      const entries = await entriesText();
      const members = await membersText();
      expect(
        q(kinds) === q(["Allotment", "Transfer", "Buyback", "Cancellation", "Conversion"]) &&
          (dateShown.includes(today) || dateShown === today) &&
          !registry.includes(Rg.legalName) &&
          !registry.includes(AR.legalName) &&
          registry.includes(M.legalName) &&
          entries.length === 1 &&
          /^001/.test(entries[0]) &&
          /Allotment/.test(entries[0]) &&
          /C-001/.test(entries[0]) &&
          members.some((r) => r.includes(M.legalName) && /600/.test(r)),
        q({
          kinds,
          dateShown,
          today,
          registryHasSelf: registry.includes(Rg.legalName),
          registryHasArchived: registry.includes(AR.legalName),
          entries,
          members,
        }),
      );
      return `Entry offered ${q(kinds)}; Effective date started at ${q(dateShown)}. Entity from the registry… listed ${registry.length - 1} Entities, not ${Rg.legalName} itself and not the archived ${AR.legalName}. Enter in register listed ${q(entries[0])}; Register of members read ${q(members)}.`;
    },
  );

  await step(
    R,
    page,
    "Record an entry: Allotment To a New individual with Full name",
    "Entry 002 lists; the individual Holder shows 400.",
    async () => {
      const d = await recordEntry({
        kind: "Allotment",
        date: "2024-06-01",
        to: { individual: ada },
        shares: "400",
      });
      await d.waitFor({ state: "hidden", timeout: 15000 });
      await settle(page);
      const members = await membersText();
      expect(
        members.some((r) => r.includes(ada) && /400/.test(r) && /Individual/.test(r)),
        q(members),
      );
      return `Register of members read ${q(members)}.`;
    },
  );

  await step(
    R,
    page,
    "Record an entry: Transfer From an existing Holder To an Entity from the registry; Certificates cancel the live certificate and issue new ones",
    "Entry 003 cancels C-001 and issues C-002 and C-003; balances 500 and 100.",
    async () => {
      const d = await recordEntry({
        kind: "Transfer",
        date: "2025-03-01",
        from: { holder: M.legalName },
        to: { entity: P.legalName },
        shares: "100",
        cancel: ["C-001"],
        certificates: [
          ["C-002", "To", "100"],
          ["C-003", "From", "500"],
        ],
      });
      await d.waitFor({ state: "hidden", timeout: 15000 });
      await settle(page);
      const entries = await entriesText();
      const members = await membersText();
      expect(
        entries.some((e) => /^003/.test(e) && /Transfer/.test(e) && /C-001/.test(e)) &&
          members.some((r) => r.includes(M.legalName) && /500/.test(r)) &&
          members.some((r) => r.includes(P.legalName) && /100/.test(r)),
        q({ entries, members }),
      );
      return `Entry 003 read ${q(entries.find((e) => /^003/.test(e)))}. Register of members read ${q(members)}.`;
    },
  );

  await step(
    R,
    page,
    "Record an entry: a second Transfer names an Entity Holder (used later for the restricted-Holder check)",
    "Entry 004 moves 50 from the parent to the secret sub.",
    async () => {
      const d = await recordEntry({
        kind: "Transfer",
        date: "2025-06-01",
        from: { holder: P.legalName },
        to: { entity: S.legalName },
        shares: "50",
        cancel: ["C-002"],
        certificates: [["C-004", "From", "50"]],
      });
      await d.waitFor({ state: "hidden", timeout: 15000 });
      await settle(page);
      const members = await membersText();
      expect(
        members.some((r) => r.includes(S.legalName) && /50/.test(r)),
        q(members),
      );
      return `Register of members read ${q(members)}.`;
    },
  );

  await step(
    R,
    page,
    "Register rule: an entry that would take a balance below zero is refused in the dialog and the register keeps its saved entries",
    "Transferring 1,000 from the individual is refused; four entries remain.",
    async () => {
      const d = await recordEntry({
        kind: "Transfer",
        date: "2025-07-01",
        from: { holder: ada },
        to: { holder: M.legalName },
        shares: "1000",
      });
      const alert = tidy(await d.getByRole("alert").innerText());
      await d.getByRole("button", { name: "Cancel" }).click();
      await d.waitFor({ state: "hidden" });
      const count = (await register()).entries.length;
      expect(/below zero/.test(alert) && count === 4, q({ alert, count }));
      return `The dialog showed ${q(alert)}; the register kept ${count} entries.`;
    },
  );

  await step(
    R,
    page,
    "Register rule: allotting more than a class authorizes is not refused; the warning shows above the register",
    "'1,300 Ordinary shares are issued against 1,000 authorized.' shows.",
    async () => {
      const d = await recordEntry({
        kind: "Allotment",
        date: "2025-08-01",
        to: { holder: ada },
        shares: "300",
      });
      await d.waitFor({ state: "hidden", timeout: 15000 });
      await settle(page);
      const warning = tidy(await page.getByText(/shares are issued against/).innerText());
      expect(warning === "1,300 Ordinary shares are issued against 1,000 authorized.", warning);
      return `The allotment saved and the page showed ${q(warning)}.`;
    },
  );

  await step(
    R,
    page,
    "Record an entry, delete: use Remove entry 5 in the row (number without leading zeros); the confirmation asks Remove entry 005 from the register?; select Remove; the register replays and the warning clears",
    "The row control Remove entry 5 opens 'Remove entry 005 from the register?'; Remove deletes the entry and clears the over-authorized warning.",
    async () => {
      const control = page.getByRole("button", { name: "Remove entry 5", exact: true });
      const found = await control.count();
      const names = await section(page, "Register of allotments and transfers")
        .locator("tbody tr")
        .last()
        .getByRole("button")
        .evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label")));
      if (!found)
        guideFailure(
          R,
          "entity-structure-and-access, Record an entry: Remove entry 3",
          "A row control labelled Remove entry 5",
          `Row controls ${q(names)}.`,
        );
      await control.click();
      const dialog = page.getByRole("dialog", { name: "Remove entry 005 from the register?" });
      await dialog.waitFor();
      const text = tidy(await dialog.innerText());
      await dialog
        .getByRole("button")
        .filter({ hasText: /^Remove$/ })
        .click();
      await dialog.waitFor({ state: "hidden" });
      await settle(page);
      const warning = await page.getByText(/shares are issued against/).count();
      const entries = (await register()).entries.map((e) => e.entryNo);
      expect(
        found === 1 && warning === 0 && q(entries) === q([1, 2, 3, 4]),
        q({ found, names, text, warning, entries }),
      );
      return `The last row's controls were ${q(names)}. Remove entry 5 opened ${q(text)}; Remove replayed the register (entries ${q(entries)}) and cleared the warning.`;
    },
  );

  await step(
    R,
    page,
    "Record an entry: Buyback From a Holder puts shares into treasury; Cancellation from Treasury (shares the company holds); numbers are not reused",
    "Entries 006 and 007; a Treasury row shows after the buyback; issued becomes 900.",
    async () => {
      let d = await recordEntry({
        kind: "Buyback",
        date: "2025-09-01",
        from: { holder: ada },
        shares: "100",
      });
      await d.waitFor({ state: "hidden", timeout: 15000 });
      await settle(page);
      const treasury = (await membersText()).find((r) => /Treasury/.test(r));
      await page.getByRole("button", { name: "Record entry" }).first().click();
      d = entryDialog();
      await d.getByLabel(req("Entry")).selectOption({ label: "Cancellation" });
      const fromDefault = tidy(
        await d.getByLabel(req("From")).locator("option:checked").innerText(),
      );
      await pickDate(page, d.locator("#share-entry-date"), "2025-09-15");
      await d.getByLabel(req("Class")).selectOption({ label: "Ordinary" });
      await d.getByLabel(req("Shares")).fill("100");
      await d.getByRole("button", { name: "Enter in register" }).click();
      await d.waitFor({ state: "hidden", timeout: 15000 });
      await settle(page);
      const reg = await register();
      const numbers = reg.entries.map((e) => e.entryNo);
      expect(
        treasury &&
          fromDefault === "Treasury (shares the company holds)" &&
          q(numbers) === q([1, 2, 3, 4, 6, 7]) &&
          reg.reconciliation.registerIssued === 900,
        q({ treasury, fromDefault, numbers, rec: reg.reconciliation }),
      );
      return `After the Buyback the members table showed ${q(treasury)}. Cancellation's From started at ${q(fromDefault)}. The entries are numbered ${q(numbers)} (005 not reused) and the register issues ${reg.reconciliation.registerIssued}.`;
    },
  );

  await step(
    R,
    page,
    "Record an entry, correct: use Edit entry 2 in the row; the dialog title shows Edit entry 002; change a value; Save",
    "The row control Edit entry 2 opens 'Edit entry 002'; Save stores the change.",
    async () => {
      const control = page.getByRole("button", { name: "Edit entry 2", exact: true });
      const found = await control.count();
      if (!found)
        guideFailure(
          R,
          "entity-structure-and-access, Record an entry: Edit entry 3",
          "A row control labelled Edit entry 2",
          "No such control.",
        );
      await control.click();
      const d = page.getByRole("dialog", { name: "Edit entry 002" });
      await d.waitFor();
      await d.getByLabel("Resolution reference").fill("BR-2024-06");
      await d.getByRole("button", { name: "Save" }).click();
      await d.waitFor({ state: "hidden", timeout: 15000 });
      await settle(page);
      const row = (await entriesText()).find((e) => /^002/.test(e));
      expect(found === 1 && /BR-2024-06/.test(row), q({ found, row }));
      return `Edit entry 2 opened the dialog titled "Edit entry 002"; Save stored Resolution reference BR-2024-06 and the row read ${q(row)}.`;
    },
  );

  await step(
    R,
    page,
    "Bug check (DES-088): entry row actions are two icon buttons, not the shared row menu",
    "Observation of the row actions.",
    async () => {
      const rows = section(page, "Register of allotments and transfers").locator("tbody tr");
      const labels = await rows
        .first()
        .getByRole("button")
        .evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label") ?? b.textContent.trim()));
      const menus = await rows.getByRole("button", { name: /^Actions for/ }).count();
      if (labels.length === 2 && menus === 0)
        observation(
          "register-row-actions",
          "Share register entries draw Edit and Remove as two icon buttons per row, not the shared row menu DES-088 names.",
          "Open an Entity with register entries, Ownership tab, Register of allotments and transfers: each row ends with a pencil and a trash icon button.",
          `Row buttons ${q(labels)}; ${menus} row menus.`,
        );
      return `The first entry row's controls were ${q(labels)} and the table had ${menus} row menus. Author's suspected defect 3 confirmed: Edit and Remove are icon buttons.`;
    },
  );

  await step(
    R,
    page,
    "Read the register at a date: Register as of, Change to today, dimmed later entries, the issued total on that date; Previous entry date, Next entry date, Reset to today",
    "At 1 Mar 2024 the members show the owner Entity's 600 and a Change to today column; later entries are dimmed; Reset returns to today.",
    async () => {
      await pickDate(page, page.locator("#register-as-of"), "2024-03-01");
      await settle(page);
      const title = tidy(
        await page.getByRole("heading", { name: /^Register of members at / }).innerText(),
      );
      const head = tidy(await section(page, title).locator("thead").innerText());
      const members = (await section(page, title).locator("tbody tr").allInnerTexts()).map(tidy);
      const dimmed = tidy(await page.getByText(/^Entries after .* are dimmed$/).innerText());
      const line = tidy(await page.getByText(/^At .* the register showed/).innerText());
      await page.getByRole("button", { name: "Next entry date" }).click();
      await settle(page);
      const next = new URL(page.url()).searchParams.get("asOf");
      await page.getByRole("button", { name: "Previous entry date" }).click();
      await settle(page);
      const prev = new URL(page.url()).searchParams.get("asOf");
      await page.getByRole("button", { name: "Reset to today" }).click();
      await settle(page);
      const reset = new URL(page.url()).searchParams.get("asOf");
      const plainTitle = await page
        .getByRole("heading", { name: "Register of members", exact: true })
        .count();
      expect(
        /Change to today/.test(head) &&
          members.some((r) => r.includes(M.legalName) && /600/.test(r)) &&
          !members.some((r) => r.includes(ada)) &&
          /600 Ordinary issued, from 1 entry of 6/.test(line) &&
          next === "2024-06-01" &&
          prev === "2024-01-15" &&
          reset === null &&
          plainTitle === 1,
        q({ title, head, members, dimmed, line, next, prev, reset }),
      );
      return `Register as of 1 March 2024 showed ${q(title)} with headers ${q(head)} and rows ${q(members)}. ${q(dimmed)}. The line read ${q(line)}. Next entry date went to ${next}, Previous entry date to ${prev}, and Reset to today cleared the date.`;
    },
  );

  await step(
    R,
    page,
    "Read the register: Filter the entries list by Entry; each class has one row per Holder, a Treasury row when the company holds shares, and a total row",
    "Filter Entry Transfer leaves the two transfers; the members table has a Total Ordinary row.",
    async () => {
      const scope = section(page, "Register of allotments and transfers");
      await applyFilter(page, scope, "Entry", "Transfer");
      const rows = (await scope.locator("tbody tr").allInnerTexts()).map(tidy);
      await scope.getByRole("button", { name: "Clear all" }).click();
      await settle(page);
      const members = await membersText();
      const total = members.find((r) => /^Total Ordinary/.test(r));
      expect(
        rows.length === 2 && rows.every((r) => /Transfer/.test(r)) && total,
        q({ rows, members }),
      );
      return `Filter, Entry, Transfer, Apply left ${q(rows)}. The members table ended with ${q(total)}.`;
    },
  );

  await step(
    R,
    page,
    "Read the register: Export register downloads the Register of members as CSV; Export downloads every entry",
    "Two CSV downloads; the members file names the Holders; the entries file has every entry.",
    async () => {
      const [m] = await Promise.all([
        page.waitForEvent("download"),
        page
          .getByRole("link", { name: "Export register" })
          .or(page.getByRole("button", { name: "Export register" }))
          .first()
          .click(),
      ]);
      const mText = await (await import("node:fs/promises")).readFile(await m.path(), "utf8");
      const scope = section(page, "Register of allotments and transfers");
      await applyFilter(page, scope, "Entry", "Transfer");
      const [e] = await Promise.all([
        page.waitForEvent("download"),
        scope
          .getByRole("link", { name: "Export", exact: true })
          .or(scope.getByRole("button", { name: "Export", exact: true }))
          .first()
          .click(),
      ]);
      const eText = await (await import("node:fs/promises")).readFile(await e.path(), "utf8");
      await scope.getByRole("button", { name: "Clear all" }).click();
      await settle(page);
      const eLines = eText.trim().split(/\r?\n/);
      expect(
        /\.csv$/.test(m.suggestedFilename()) &&
          mText.includes(M.legalName) &&
          mText.includes(ada) &&
          eLines.length === 7,
        q({
          m: m.suggestedFilename(),
          e: e.suggestedFilename(),
          mHead: mText.split(/\r?\n/)[0],
          eLines: eLines.length,
        }),
      );
      return `Export register saved ${m.suggestedFilename()} (header ${q(mText.split(/\r?\n/)[0])}) naming the Holders. With an Entry filter set, Export saved ${e.suggestedFilename()} with ${eLines.length - 1} entry lines, all six entries.`;
    },
  );

  await step(
    R,
    page,
    "Check the register against Share capital: disagreement names both figures; matching reads agreement",
    "Declared 1,000 vs register 900 shows the disagreement line; declaring 900 shows agreement.",
    async () => {
      await reload(page);
      const differs = tidy(
        await page.getByText(/^Today the register (does not agree|agrees)/).innerText(),
      );
      await go(page, `/entities/${Rg.id}`);
      await typeInto(body.getByLabel("Issued shares", { exact: true }), "900");
      await blurTo(page, "Share capital");
      await go(page, `/entities/${Rg.id}/ownership`);
      const agrees = tidy(
        await page.getByText(/^Today the register (does not agree|agrees)/).innerText(),
      );
      expect(
        differs ===
          "Today the register does not agree with Share capital. The Overview declares 1,000 issued; the register sums to 900." &&
          agrees === "Today the register agrees with Share capital: 900 issued.",
        q({ differs, agrees }),
      );
      return `With Issued shares 1,000 the line read ${q(differs)}. After setting Issued shares to 900 on Overview it read ${q(agrees)}.`;
    },
  );

  await step(
    R,
    page,
    "Check the register: when Issued shares is blank the line still reports agreement (guide warns; author's suspected defect 2)",
    "With Issued shares blank the line reads agreement.",
    async () => {
      await go(page, `/entities/${Rg.id}`);
      await typeInto(body.getByLabel("Issued shares", { exact: true }), "");
      await blurTo(page, "Share capital");
      await go(page, `/entities/${Rg.id}/ownership`);
      const line = tidy(
        await page.getByText(/^Today the register (does not agree|agrees)/).innerText(),
      );
      await go(page, `/entities/${Rg.id}`);
      await typeInto(body.getByLabel("Issued shares", { exact: true }), "900");
      await blurTo(page, "Share capital");
      expect(line === "Today the register agrees with Share capital: 900 issued.", line);
      observation(
        "register-blank-issued-agrees",
        "The share register's reconciliation line reports agreement when Issued shares on Overview is blank.",
        "Entity with register entries summing to 900; clear Issued shares on Overview; open Ownership.",
        `The line read ${q(line)} with no declared value.`,
      );
      return `With Issued shares blank the line read ${q(line)}. Author's suspected defect 2 confirmed. Issued shares was set back to 900.`;
    },
  );

  await step(
    R,
    page,
    "How the register writes Holdings: owner Holdings from today's register, percentages over outstanding shares to two decimals; a register entry replaces a hand-typed Entity owner; a hand-typed individual stays beside the register Holder",
    "M 55.56, Ada 33.33, P 5.56, S 5.56 from register; M's hand-typed row gone from Declared owners; the hand-typed Ada remains until removed.",
    async () => {
      await go(page, `/entities/${Rg.id}/ownership`);
      const declared = await sectionText(page, "Declared owners not in the register");
      const holdings = (await s.api("GET", `/entities/${Rg.id}/holdings`)).json;
      const owners = (holdings.owners ?? []).map((h) => ({
        name: h.owner.legalName,
        pct: h.ownershipPercent,
        source: h.source,
      }));
      const hasMHand = declared?.includes(M.legalName);
      const hasAdaHand = declared?.includes(ada);
      await page.getByRole("button", { name: `Remove ${ada}` }).click();
      await settle(page);
      await reload(page);
      const after = await sectionText(page, "Declared owners not in the register");
      const want = { [M.legalName]: 55.56, [ada]: 33.33, [P.legalName]: 5.56, [S.legalName]: 5.56 };
      const reg = owners.filter((x) => x.source === "register");
      expect(
        !hasMHand &&
          hasAdaHand &&
          reg.length === 4 &&
          reg.every((x) => want[x.name] === x.pct) &&
          !after,
        q({ declared, owners, after }),
      );
      return `Declared owners not in the register read ${q(declared)}: the hand-typed ${M.legalName} row was gone, the hand-typed ${ada} remained. Owner Holdings: ${q(owners)}. Removing the hand-typed ${ada} left ${q(after ?? "no Declared owners card")}.`;
    },
  );

  await step(
    R,
    page,
    "Register Holdings on the owner: From register on Holdings in other Entities; percentage and remove unavailable; From register opens the register",
    "M's Holdings in other Entities shows the register Entity From register with disabled controls; the pill opens the register.",
    async () => {
      await go(page, `/entities/${M.id}/ownership`);
      const card = await sectionText(page, "Holdings in other Entities");
      const pct = page.getByLabel(`${Rg.legalName} ownership percent`);
      const pctValue = await pct.inputValue();
      const pctDisabled = await pct.isDisabled();
      const removeDisabled = await page
        .getByRole("button", { name: `Remove ${Rg.legalName}` })
        .isDisabled();
      await page.getByRole("link", { name: "From register" }).first().click();
      await settle(page);
      const landed = new URL(page.url()).pathname;
      expect(
        /From register/.test(card) &&
          pctValue === "55.56" &&
          pctDisabled &&
          removeDisabled &&
          landed === `/entities/${Rg.id}/ownership`,
        q({ card, pctValue, pctDisabled, removeDisabled, landed }),
      );
      return `${M.legalName}'s Holdings in other Entities read ${q(card)}; the percent (${pctValue}) and Remove ${Rg.legalName} were disabled. From register opened ${landed}.`;
    },
  );

  await step(
    R,
    page,
    "Holdings (entity-records) note and author's suspected defect 1: OpenLaw still accepts a hand-typed owner on an Entity that keeps a share register",
    "A hand-typed individual is accepted, lists under Declared owners not in the register and counts toward the total.",
    async () => {
      const zed = `Zed Example ${who} ${TAG}`;
      await addIndividual(page, zed, "5");
      await reload(page);
      const declared = await sectionText(page, "Declared owners not in the register");
      const warning = tidy(
        await page
          .getByText(/Ownership totals/)
          .first()
          .innerText()
          .catch(() => ""),
      );
      await page.getByRole("button", { name: `Remove ${zed}` }).click();
      await settle(page);
      expect(declared?.includes(zed), q({ declared, warning }));
      observation(
        "register-hand-typed-owner",
        "An Entity that keeps a share register still accepts a new hand-typed owner Holding (Add Holding, Owner type Individual or Owns this Entity), which counts toward its ownership total.",
        "Entity with register entries; Ownership tab; Add Holding; Individual; Full name; 5; Add.",
        `Declared owners not in the register read ${q(declared)}; total warning ${q(warning)}.`,
      );
      return `Add Holding with Individual ${q(zed)} at 5% was accepted: Declared owners not in the register read ${q(declared)} and the page showed ${q(warning)}. Author's suspected defect 1 confirmed; the guide describes this behaviour. The row was then removed.`;
    },
  );

  await step(
    R,
    page,
    "Share classes note: a class's archive control is available only while no entry uses it; each entry change appears in the History of this Entity and each Entity Holder",
    "Archive Ordinary is disabled; Archive Preference works; History on the register Entity and on the Holder names the entries.",
    async () => {
      await page.getByRole("button", { name: "Share classes" }).click();
      const dialog = page.getByRole("dialog", { name: "Share classes" });
      const ordinaryDisabled = await dialog
        .getByRole("button", { name: "Archive Ordinary" })
        .isDisabled();
      const prefEnabled = await dialog
        .getByRole("button", { name: "Archive Preference" })
        .isEnabled();
      await dialog.getByRole("button", { name: "Archive Preference" }).click();
      await settle(page);
      const left = (await dialog.locator("li").allInnerTexts()).map(tidy);
      await page.keyboard.press("Escape");
      await page
        .getByRole("toolbar", { name: "Applets" })
        .getByRole("button", { name: "History" })
        .click();
      await settle(page);
      const rHistory = tidy(
        await page
          .getByRole("complementary")
          .or(page.getByRole("region", { name: "History" }))
          .first()
          .innerText()
          .catch(async () => await page.locator("body").innerText()),
      );
      await page.keyboard.press("Escape");
      await go(page, `/entities/${M.id}`);
      await page
        .getByRole("toolbar", { name: "Applets" })
        .getByRole("button", { name: "History" })
        .click();
      await settle(page);
      const mHistory = tidy(
        await page
          .getByRole("complementary")
          .or(page.getByRole("region", { name: "History" }))
          .first()
          .innerText()
          .catch(async () => await page.locator("body").innerText()),
      );
      await page.keyboard.press("Escape");
      const someone = [rHistory, mHistory].join(" ").match(/[^.]{0,80}someone[^.]{0,60}/g) ?? [];
      if (someone.length)
        productBug(
          "history-someone-holding",
          'History entries for Holdings that the share register writes, and for a removed hand-typed individual Holding, print "someone" and "someone%" instead of the owner\'s name and percentage.',
          "Record register entries on an Entity whose owners had hand-typed Holdings; open History on that Entity and on an Entity Holder.",
          q(someone.slice(0, 4)),
        );
      const rEntry = /entr|allot|transfer|register/i.test(rHistory);
      const mEntry = /entr|allot|transfer|register/i.test(mHistory);
      expect(
        ordinaryDisabled && prefEnabled && left.length === 1 && rEntry && mEntry,
        q({
          ordinaryDisabled,
          prefEnabled,
          left,
          rHistory: rHistory.slice(0, 300),
          mHistory: mHistory.slice(0, 300),
        }),
      );
      return `Archive Ordinary was disabled; Archive Preference archived that class, leaving ${q(left)}. History on ${Rg.legalName} began ${q(rHistory.slice(0, 500))}; History on ${M.legalName} began ${q(mHistory.slice(0, 500))}.`;
    },
  );

  // ---------------- chart ----------------
  const chart = page.getByRole("region", { name: "Entity ownership chart" });
  const readChart = async (p = page) =>
    p.evaluate(() => {
      const region = document.querySelector('[role="region"][aria-label="Entity ownership chart"]');
      const nodes = [...region.querySelectorAll("svg g")].filter((g) =>
        g.querySelector(":scope > a > rect, :scope > rect"),
      );
      const out = nodes.map((g) => {
        const rect = g.querySelector("rect");
        const a = g.querySelector(":scope > a");
        return {
          name: a
            ? a.getAttribute("aria-label").replace(/^Open /, "")
            : g.getAttribute("aria-label"),
          type: a ? (a.querySelector("foreignObject p.text-xs")?.textContent ?? null) : null,
          icon: a ? Boolean(a.querySelector("foreignObject svg")) : false,
          restricted: g.getAttribute("data-restricted") === "true",
          unconnected: g.getAttribute("data-unconnected") === "true",
          highlighted: g.getAttribute("data-highlighted"),
          x: +rect.getAttribute("x"),
          y: +rect.getAttribute("y"),
          w: +rect.getAttribute("width"),
          h: +rect.getAttribute("height"),
          href: a ? a.getAttribute("href") : null,
        };
      });
      const unique = [];
      for (const n of out) if (!unique.some((u) => u.x === n.x && u.y === n.y)) unique.push(n);
      const edges = [...region.querySelectorAll("path[data-edge-kind]")].map((path) => {
        const nums = path
          .getAttribute("d")
          .match(/-?\d+(\.\d+)?/g)
          .map(Number);
        const [x1, y1, , x2, y2] = nums;
        const owner = unique.find(
          (n) => x1 >= n.x && x1 <= n.x + n.w && Math.abs(y1 - (n.y + n.h)) < 1,
        );
        const owned = unique.find((n) => x2 >= n.x && x2 <= n.x + n.w && Math.abs(y2 - n.y) < 1);
        return {
          owner: owner?.name,
          owned: owned?.name,
          kind: path.getAttribute("data-edge-kind"),
          dashed: Boolean(path.getAttribute("stroke-dasharray")),
          percent: path.parentElement.querySelector("text")?.textContent,
        };
      });
      return {
        nodes: unique,
        edges,
        pan: [region.dataset.panX, region.dataset.panY],
        zoom: region.dataset.zoom,
      };
    });
  const openChart = async (p, query) => {
    await go(p, "/entities?view=chart");
    await p.getByRole("searchbox", { name: "Search entities by name" }).fill(query);
    await settle(p);
    await p.getByRole("region", { name: "Entity ownership chart" }).waitFor();
    await wait(500);
  };

  await step(
    R,
    page,
    "Chart steps 1-2: Chart draws Holdings, including register Holdings and individual owners with a person icon and the label Individual; primary owner solid, others dashed; highest percentage is primary even below 50%; an Entity with no Holdings sits in a separate row",
    "P→S 75% solid, M→S 25% dashed, P→S2 40% solid, M→S2 35% dashed; register edges into the register Entity; the individual labelled Individual; the lone Entity unconnected below.",
    async () => {
      await openChart(page, prefix);
      const view = await readChart();
      const edge = (owner, owned) => view.edges.find((e) => e.owner === owner && e.owned === owned);
      const e1 = edge(P.legalName, S.legalName),
        e2 = edge(M.legalName, S.legalName),
        e3 = edge(P.legalName, S2.legalName),
        e4 = edge(M.legalName, S2.legalName);
      const r1 = edge(M.legalName, Rg.legalName),
        r2 = edge(ada, Rg.legalName);
      const adaNode = view.nodes.find((n) => n.name === ada);
      const lone = view.nodes.find((n) => n.name === U.legalName);
      const maxOther = Math.max(...view.nodes.filter((n) => !n.unconnected).map((n) => n.y));
      expect(
        e1?.kind === "primary" &&
          !e1.dashed &&
          e1.percent === "75%" &&
          e2?.kind === "secondary" &&
          e2.dashed &&
          e2.percent === "25%" &&
          e3?.kind === "primary" &&
          e3.percent === "40%" &&
          e4?.kind === "secondary" &&
          e4.percent === "35%" &&
          r1?.kind === "primary" &&
          r1.percent === "55.56%" &&
          r2?.percent === "33.33%" &&
          adaNode?.type === "Individual" &&
          adaNode?.icon === true &&
          view.nodes.filter((n) => n.name?.startsWith(prefix)).every((n) => !n.icon) &&
          adaNode.href === `/entities/${Rg.id}/ownership` &&
          lone?.unconnected &&
          lone.y > maxOther,
        q({ e1, e2, e3, e4, r1, r2, adaNode, lone, maxOther }),
      );
      return `Chart search ${q(prefix)} drew ${view.nodes.length} nodes. Edges: ${q([e1, e2, e3, e4, r1, r2])}. ${ada} was a node labelled ${q(adaNode.type)} with a person icon (${adaNode.icon}; no Entity node has one) linking to ${adaNode.href}. ${U.legalName} was unconnected at y=${lone.y}, below every connected node (max y=${maxOther}).`;
    },
  );

  await step(
    R,
    page,
    "Chart step 3: drag pans, wheel zooms; with the chart focused arrows pan, plus zooms, zero fits; Fit to window resets",
    "Each input changes the view; zero and Fit to window return to the fitted view.",
    async () => {
      const start = await readChart();
      const box = await chart.boundingBox();
      await page.mouse.move(box.x + 20, box.y + box.height - 20);
      await page.mouse.down();
      await page.mouse.move(box.x + 120, box.y + box.height - 60, { steps: 5 });
      await page.mouse.up();
      const dragged = await readChart();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -300);
      await wait(300);
      const wheeled = await readChart();
      await page.getByRole("button", { name: "Fit to window" }).click();
      const fitted = await readChart();
      await chart.focus();
      await page.keyboard.press("ArrowRight");
      const arrowed = await readChart();
      await page.keyboard.press("+");
      const zoomed = await readChart();
      await page.keyboard.press("0");
      const zeroed = await readChart();
      await page.keyboard.press("ArrowDown");
      await page.getByRole("button", { name: "Fit to window" }).click();
      const refitted = await readChart();
      const same = (a, b) => a.pan[0] === b.pan[0] && a.pan[1] === b.pan[1] && a.zoom === b.zoom;
      expect(
        !same(start, dragged) &&
          wheeled.zoom !== dragged.zoom &&
          +arrowed.pan[0] !== +fitted.pan[0] &&
          +zoomed.zoom > +arrowed.zoom &&
          same(zeroed, fitted) &&
          same(refitted, fitted),
        q({
          start: [start.pan, start.zoom],
          dragged: dragged.pan,
          wheeled: wheeled.zoom,
          fitted: [fitted.pan, fitted.zoom],
          arrowed: arrowed.pan,
          zoomed: zoomed.zoom,
          zeroed: [zeroed.pan, zeroed.zoom],
          refitted: [refitted.pan, refitted.zoom],
        }),
      );
      return `Drag moved the pan from ${q(start.pan)} to ${q(dragged.pan)}; the wheel changed zoom ${dragged.zoom} to ${wheeled.zoom}. From the fitted view ${q([fitted.pan, fitted.zoom])}, ArrowRight panned to ${q(arrowed.pan)}, plus zoomed to ${zoomed.zoom}, zero returned ${q([zeroed.pan, zeroed.zoom])}, and Fit to window returned ${q([refitted.pan, refitted.zoom])}.`;
    },
  );

  await step(
    R,
    page,
    "Chart step 4 and note: click or Space highlights the chain; Clear highlight or Escape removes it; double-click or Enter opens; opening an individual goes to the associated Entity's Ownership tab",
    "Click highlights S's chain; Space and Escape; double-click opens P; Enter opens U; double-click on the individual opens the register Entity's Ownership tab.",
    async () => {
      const node = (name) => chart.getByRole("link", { name: `Open ${name}` });
      await node(S.legalName).click();
      await wait(300);
      const chain = (await readChart()).nodes
        .filter((n) => n.highlighted === "true")
        .map((n) => n.name)
        .sort();
      const clearVisible = await page.getByRole("button", { name: "Clear highlight" }).isVisible();
      await page.getByRole("button", { name: "Clear highlight" }).click();
      const cleared = (await readChart()).nodes.every((n) => n.highlighted === null);
      await node(M.legalName).focus();
      await page.keyboard.press(" ");
      await wait(300);
      const spaced = (await readChart()).nodes
        .filter((n) => n.highlighted === "true")
        .map((n) => n.name);
      await page.keyboard.press("Escape");
      await wait(300);
      const escaped = (await readChart()).nodes.every((n) => n.highlighted === null);
      await node(P.legalName).dblclick();
      await page.waitForURL(`**/entities/${P.id}`, { timeout: 10000 });
      const dbl = new URL(page.url()).pathname;
      await openChart(page, prefix);
      await node(U.legalName).focus();
      await page.keyboard.press("Enter");
      await page.waitForURL(`**/entities/${U.id}`, { timeout: 10000 });
      const entered = new URL(page.url()).pathname;
      await openChart(page, prefix);
      await node(ada).dblclick();
      await page.waitForURL(`**/entities/${Rg.id}/ownership`, { timeout: 10000 });
      const individual = new URL(page.url()).pathname;
      // S holds register shares in Rg, so Rg is in S's chain as an owned Entity.
      const expectedChain = [P.legalName, M.legalName, S.legalName, Rg.legalName].sort();
      expect(
        q(chain) === q(expectedChain) &&
          clearVisible &&
          cleared &&
          spaced.includes(M.legalName) &&
          escaped &&
          dbl === `/entities/${P.id}` &&
          entered === `/entities/${U.id}` &&
          individual === `/entities/${Rg.id}/ownership`,
        q({ chain, clearVisible, cleared, spaced, escaped, dbl, entered, individual }),
      );
      return `A single click on ${S.legalName} highlighted ${q(chain)}; Clear highlight cleared it. Space on ${M.legalName} highlighted ${spaced.length} nodes and Escape cleared them. Double-click on ${P.legalName} opened ${dbl}; Enter on ${U.legalName} opened ${entered}; double-click on the individual ${ada} opened ${individual}.`;
    },
  );

  // ---------------- linked work ----------------
  const bulk = await bulkFixtures(ctx);
  const tableState = async (p) =>
    p.evaluate(() => {
      const sec = [...document.querySelectorAll("main section[aria-label]")].find((x) =>
        ["Contracts", "Matters"].includes(x.getAttribute("aria-label")),
      );
      if (!sec) return null;
      const heading = sec.querySelector("h2")?.textContent?.trim() ?? null;
      const count = sec.querySelector("header h2 + span")?.textContent?.trim() ?? null;
      const headers = [...sec.querySelectorAll("thead th")].map((th) => ({
        label: th.getAttribute("aria-label"),
        sort: th.getAttribute("aria-sort"),
      }));
      const rows = [...sec.querySelectorAll("tbody tr")].map((tr) =>
        tr.innerText.replace(/\s+/g, " ").trim(),
      );
      const empty = sec.innerText.includes("No linked records.");
      const more = [...sec.querySelectorAll("button")].some(
        (b) => b.textContent.trim() === "Show more",
      );
      return { heading, count, headers, rows, empty, more };
    });
  const tabCount = async (p, name) =>
    p
      .getByRole("navigation", { name: "Entity sections" })
      .getByRole("link", { name: new RegExp(`^${name}`) })
      .getByRole("img")
      .getAttribute("aria-label")
      .catch(() => null);
  /** The column names a Columns menu offers: the catalogue behind a table. */
  const columnMenu = async (p, scope) => {
    await scope.getByRole("button", { name: "Columns", exact: true }).first().click();
    const menu = p.getByRole("menu");
    await menu.waitFor();
    const items = (await menu.getByRole("menuitemcheckbox").allInnerTexts()).map(tidy);
    await p.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" }).catch(() => {});
    return items;
  };
  // The main list shows the reader's own saved layout, so "the same columns" is checked on the
  // Columns catalogue; the shown headers of both tables are recorded too.
  let listCatalogue = null;
  const mainHeaders = async (p, url) => {
    await go(p, url);
    await p.locator("main table thead th").first().waitFor({ timeout: 20000 });
    listCatalogue = await columnMenu(p, p);
    return p
      .locator("main table thead th")
      .evaluateAll((ths) => ths.map((t) => t.getAttribute("aria-label")).filter(Boolean));
  };

  await step(
    R,
    page,
    "Read linked Contracts and Matters: the Contracts tab shows a table with the main Contracts list's columns and the number of linked records beside its heading; archived and ended records are included; 50 rows at a time with Show more",
    "Heading Contracts with the total beside it; the same columns as the main Contracts list; 50 rows, then Show more adds the rest, including the archived and the Expired fixture Contracts; the Confidential Contract counts only for a reader on its team.",
    async () => {
      const listHeaders = await mainHeaders(page, "/contracts");
      await go(page, `/entities/${bulk.entity.id}/contracts`);
      await page
        .getByRole("region", { name: "Contracts" })
        .or(page.locator('main section[aria-label="Contracts"]'))
        .first()
        .waitFor();
      await until(async () => (await tableState(page))?.rows?.length > 0, "linked Contracts rows");
      const first = await tableState(page);
      const tabCatalogue = await columnMenu(
        page,
        page.locator('main section[aria-label="Contracts"]'),
      );
      const tab = await tabCount(page, "Contracts");
      await page.getByRole("button", { name: "Show more", exact: true }).click();
      await until(
        async () => (await tableState(page)).rows.length > first.rows.length,
        "Show more rows",
      );
      await settle(page);
      const all = await tableState(page);
      const has = (title) => all.rows.some((r) => r.includes(title));
      const reach = R === "administrator" ? bulk.contracts.length + 1 : bulk.contracts.length;
      expect(
        first.heading === "Contracts" &&
          first.rows.length === 50 &&
          first.more &&
          Number(first.count) === reach &&
          all.rows.length === reach &&
          !all.more &&
          has(bulk.archived.title) &&
          has(bulk.ended.title) &&
          has(bulk.confidential.title) === (R === "administrator") &&
          q([...tabCatalogue].sort()) === q([...listCatalogue].sort()),
        q({
          first: { ...first, rows: first.rows.length },
          all: all.rows.length,
          reach,
          listHeaders,
          listCatalogue,
          tabCatalogue,
          tab,
        }),
      );
      return `The main Contracts list shows ${q(listHeaders)} for this reader and its Columns menu offers ${q(listCatalogue)}. ${bulk.entity.legalName}'s Contracts tab showed the heading "Contracts" with ${q(first.count)} beside it, a table with the columns ${q(first.headers.map((h) => h.label).filter(Boolean))} and a Columns menu offering the same ${tabCatalogue.length} columns as the main list (shown columns listed first), ${first.rows.length} rows and Show more; the nav tab reads ${q(tab)}. Show more brought the table to ${all.rows.length} rows and left no Show more. The archived ${q(bulk.archived.title)} and the Expired ${q(bulk.ended.title)} are listed; the Confidential ${q(bulk.confidential.title)} (created by the Administrator, ${s.person.name} ${R === "administrator" ? "is its creator" : "is not on its team"}) is ${has(bulk.confidential.title) ? "listed" : "not listed and not counted"}.`;
    },
  );

  await step(
    R,
    page,
    "Read linked Contracts: select a column heading to sort; Columns shows, hides or reorders columns for this visit",
    "A heading click sorts the rows and marks the column sorted; Columns hides a column and moves another; a reload restores the default layout.",
    async () => {
      await go(page, `/entities/${bulk.entity.id}/contracts`);
      await until(async () => (await tableState(page))?.rows?.length > 0, "rows");
      const before = await tableState(page);
      const sec = page.locator('main section[aria-label="Contracts"]');
      await sec
        .locator("thead th", { has: page.locator("button") })
        .filter({ hasText: "Title" })
        .getByRole("button")
        .first()
        .click();
      await settle(page);
      const asc = await tableState(page);
      await sec
        .locator("thead th")
        .filter({ hasText: "Title" })
        .getByRole("button")
        .first()
        .click();
      await settle(page);
      const desc = await tableState(page);
      const sortOf = (st) => st.headers.find((h) => h.label === "Title")?.sort;
      await sec.getByRole("button", { name: "Columns", exact: true }).click();
      const menu = page.getByRole("menu");
      await menu.waitFor();
      const items = (await menu.getByRole("menuitemcheckbox").allInnerTexts()).map(tidy);
      const hideable = [];
      for (const it of await menu.getByRole("menuitemcheckbox").all()) {
        if ((await it.getAttribute("aria-checked")) === "true" && !(await it.isDisabled()))
          hideable.push(tidy(await it.innerText()));
      }
      const hide = hideable[hideable.length - 1];
      await menu.getByRole("menuitemcheckbox", { name: hide }).click();
      const shownLabels = before.headers.map((h) => h.label).filter(Boolean);
      const moveTarget =
        shownLabels[shownLabels.length - 1] === hide
          ? shownLabels[shownLabels.length - 2]
          : shownLabels[shownLabels.length - 1];
      await menu.getByRole("button", { name: `Move ${moveTarget} earlier` }).click();
      await page.keyboard.press("Escape");
      await settle(page);
      const changed = await tableState(page);
      await reload(page);
      await until(async () => (await tableState(page))?.rows?.length > 0, "rows after reload");
      const reloaded = await tableState(page);
      const labels = (st) => st.headers.map((h) => h.label).filter(Boolean);
      const titles = (st) => st.rows.slice(0, 5);
      expect(
        sortOf(asc) === "ascending" &&
          sortOf(desc) === "descending" &&
          q(titles(asc)) !== q(titles(desc)) &&
          !labels(changed).includes(hide) &&
          labels(changed).indexOf(moveTarget) < labels(before).indexOf(moveTarget) &&
          q(labels(reloaded)) === q(labels(before)),
        q({
          before: labels(before),
          changed: labels(changed),
          reloaded: labels(reloaded),
          hide,
          moveTarget,
          asc: sortOf(asc),
          desc: sortOf(desc),
        }),
      );
      return `Selecting the Title heading sorted the table (aria-sort ${sortOf(asc)}, first row ${q(asc.rows[0]?.slice(0, 80))}); selecting it again gave ${sortOf(desc)} (first row ${q(desc.rows[0]?.slice(0, 80))}). Columns listed ${q(items)}; unticking ${q(hide)} removed it and "Move ${moveTarget} earlier" moved ${q(moveTarget)} left: ${q(labels(changed))}. After a reload the tab showed the default columns again ${q(labels(reloaded))}, so the layout lasts for this visit only (the author's limitation is confirmed).`;
    },
  );

  await step(
    R,
    page,
    "Read linked Contracts and Matters: Matters appear through saved Entity-valued Fields; closed Matters are included; No linked records. when none is reachable",
    "The Matters tab lists the open and the closed fixture Matter that name the Entity in an Entity Field, with the main Matters list's columns; the Confidential Matter counts only for a reader on its team; an Entity with no linked work reads No linked records.",
    async () => {
      const listHeaders = await mainHeaders(page, "/matters");
      await go(page, `/entities/${bulk.entity.id}/matters`);
      await until(async () => (await tableState(page))?.rows?.length > 0, "linked Matters rows");
      const m = await tableState(page);
      const mCatalogue = await columnMenu(page, page.locator('main section[aria-label="Matters"]'));
      const tab = await tabCount(page, "Matters");
      const has = (title) => m.rows.some((r) => r.includes(title));
      const reach = R === "administrator" ? 3 : 2;
      await go(page, `/entities/${U.id}/matters`);
      await until(
        async () => (await tableState(page))?.empty,
        "No linked records. on the lone Entity",
      );
      const emptyM = await tableState(page);
      await go(page, `/entities/${U.id}/contracts`);
      await until(
        async () => (await tableState(page))?.empty,
        "No linked records. on the lone Entity contracts",
      );
      expect(
        m.heading === "Matters" &&
          Number(m.count) === reach &&
          m.rows.length === reach &&
          has(bulk.openMatter.title) &&
          has(bulk.closedMatter.title) &&
          has(bulk.confidentialMatter.title) === (R === "administrator") &&
          q([...mCatalogue].sort()) === q([...listCatalogue].sort()) &&
          emptyM.empty,
        q({ m, listHeaders, listCatalogue, mCatalogue, tab, reach }),
      );
      return `The main Matters list shows ${q(listHeaders)} for this reader and its Columns menu offers ${q(listCatalogue)}. The Matters tab of ${bulk.entity.legalName} showed "Matters" ${q(m.count)} with the columns ${q(m.headers.map((h) => h.label).filter(Boolean))}, a Columns menu offering the same ${mCatalogue.length} columns, and rows ${q(m.rows.map((r) => r.slice(0, 90)))}; the nav tab reads ${q(tab)}. The open ${q(bulk.openMatter.title)} and the closed ${q(bulk.closedMatter.title)} name the Entity in the Entity Field ${q(bulk.field.displayName)}; the Confidential ${q(bulk.confidentialMatter.title)} is ${has(bulk.confidentialMatter.title) ? "listed (creator)" : "neither listed nor counted"}. ${U.legalName}'s Matters and Contracts tabs read "No linked records.".`;
    },
  );

  await step(
    reader.key,
    reader.page,
    "Negative: rows, totals and tab counts follow the reader's access; a Confidential Contract or Matter outside it contributes neither a row nor a count",
    "Priya Raman (Legal Team Member, not on the Confidential records' teams) sees the open records only; totals and tab counts leave the Confidential ones out, and reading them directly is refused.",
    async () => {
      const rp = reader.page;
      await go(rp, `/entities/${bulk.entity.id}/contracts`);
      await until(async () => (await tableState(rp))?.rows?.length > 0, "reader rows");
      const c = await tableState(rp);
      const cTab = await tabCount(rp, "Contracts");
      await go(rp, `/entities/${bulk.entity.id}/matters`);
      await until(async () => (await tableState(rp))?.rows?.length > 0, "reader matter rows");
      const m = await tableState(rp);
      const mTab = await tabCount(rp, "Matters");
      const directC = (await reader.api("GET", `/contracts/${bulk.confidential.number}`)).status;
      const directM = (await reader.api("GET", `/matters/${bulk.confidentialMatter.number}`))
        .status;
      expect(
        Number(c.count) === bulk.contracts.length &&
          !c.rows.some((r) => r.includes(bulk.confidential.title)) &&
          Number(m.count) === 2 &&
          !m.rows.some((r) => r.includes(bulk.confidentialMatter.title)) &&
          directC >= 400 &&
          directM >= 400,
        q({ c: c.count, cTab, m: m.count, mTab, directC, directM }),
      );
      return `Priya Raman saw Contracts ${q(c.count)} (nav ${q(cTab)}) and Matters ${q(m.count)} (nav ${q(mTab)}) on ${bulk.entity.legalName}; neither table lists the Confidential Contract or Matter. Reading them directly answered ${directC} and ${directM}.`;
    },
    { actor: "Priya Raman" },
  );

  if (R === ROLES[ROLES.length - 1])
    await step(
      R,
      page,
      "Read linked Matters: if the Entity Field is later detached from the Matter type, its saved value keeps the link until that value is cleared",
      "After the fixture Field is detached from the fixture Matter type, the open Matter still appears on the Entity's Matters tab; clearing the value removes it.",
      async () => {
        const admin = await sessionFor(ctx, "administrator");
        const form = (await admin.api("GET", `/matter-types/${bulk.type.id}/form`)).json.form;
        const without = form.filter((n) => n.rowRef !== bulk.field.slug);
        const put = await admin.api("PUT", `/matter-types/${bulk.type.id}/form`, { form: without });
        expect(put.status === 200, `detach ${put.status} ${q(put.json)}`);
        await ctx.record({
          what: `Detached ${bulk.field.displayName} from ${bulk.type.displayName}`,
          how: "PUT /matter-types/:id/form as Daniel Okafor",
        });
        await go(page, `/entities/${bulk.entity.id}/matters`);
        await until(async () => (await tableState(page))?.rows?.length > 0, "rows after detach");
        const after = await tableState(page);
        // A detached Field has no control on the Matter, and the API refuses a write to it, so the
        // value is cleared the way it can be: attach the Field again and clear it.
        const whileDetached = await s.api("PATCH", `/matters/${bulk.openMatter.number}`, {
          customFields: { [bulk.field.slug]: null },
        });
        const reattach = await admin.api("PUT", `/matter-types/${bulk.type.id}/form`, { form });
        const cleared = await s.api("PATCH", `/matters/${bulk.openMatter.number}`, {
          customFields: { [bulk.field.slug]: null },
        });
        await reload(page);
        await until(async () => (await tableState(page)) !== null, "rows after clear");
        const afterClear = await tableState(page);
        expect(
          after.rows.some((r) => r.includes(bulk.openMatter.title)) &&
            !afterClear.rows.some((r) => r.includes(bulk.openMatter.title)),
          q({
            after: after.rows,
            whileDetached: whileDetached.status,
            cleared: cleared.status,
            afterClear: afterClear.rows,
          }),
        );
        return `With ${q(bulk.field.displayName)} detached from ${q(bulk.type.displayName)}, the Matters tab still listed ${q(bulk.openMatter.title)} (${after.count} linked). While detached, a write clearing the value was refused (${whileDetached.status} ${q(whileDetached.json?.detail)}); after the Field was attached again (${reattach.status}), clearing the value (${cleared.status}) removed the Matter from the tab: ${afterClear.count ?? 0} linked.`;
      },
    );

  // ---------------- access ----------------
  const grantsDialog = page.getByRole("dialog", { name: "Confidential access" });
  await step(
    otherKey,
    o.page,
    `Before Grants: ${otherKey === "administrator" ? "an Administrator can manage access while the Entity is not Confidential" : "a Legal Team Member without a Grant sees the switch unavailable and no Manage access"}`,
    otherKey === "administrator"
      ? "Manage access is offered on the open Entity the Legal Team Member added."
      : "Switch disabled; no Manage access on the open Entity the Administrator added.",
    async () => {
      await go(o.page, `/entities/${S.id}`);
      const sw = o.page.getByRole("switch", { name: "Confidential — restrict to the access list" });
      const disabled = await sw.isDisabled();
      const manage = await o.page.getByRole("button", { name: "Manage access" }).count();
      if (otherKey === "administrator") expect(!disabled && manage === 1, q({ disabled, manage }));
      else expect(disabled && manage === 0, q({ disabled, manage }));
      return `${o.person.name} on ${S.legalName} (open, no Grant): switch disabled=${disabled}, Manage access buttons=${manage}.`;
    },
  );

  await step(
    R,
    page,
    "Grant steps 1-3: Confidentiality, Manage access, Confidential access, Person, Grant access; the list includes the person and you; only live Legal Team Members and Administrators are offered",
    "Priya Raman appears in the list with the actor; Business Users are not offered.",
    async () => {
      await go(page, `/entities/${S.id}`);
      await section(page, "Confidentiality").getByRole("button", { name: "Manage access" }).click();
      await grantsDialog.waitFor();
      const options = (
        await grantsDialog.getByLabel("Person").locator("option").allInnerTexts()
      ).map(tidy);
      await grantsDialog.getByLabel("Person").selectOption({ label: "Priya Raman" });
      await grantsDialog.getByRole("button", { name: "Grant access" }).click();
      await grantsDialog.getByRole("button", { name: "Remove Priya Raman" }).waitFor();
      const listed = await grantsDialog
        .getByRole("button", { name: /^Remove / })
        .evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label").replace(/^Remove /, "")));
      if (R === "legal_team_member")
        await shot(
          page,
          "c53-confidential-access-dialog.png",
          "V-C53: Confidential access after Nadia Haddad grants Priya Raman",
        );
      const business = options.filter((n) =>
        ["Diego Salas", "Jonas Weber", "Amara Nwosu", "Lena Vogel", "Ade Balogun"].includes(n),
      );
      await page.keyboard.press("Escape");
      await grantsDialog.waitFor({ state: "hidden" });
      expect(
        listed.includes("Priya Raman") && listed.includes(s.person.name) && business.length === 0,
        q({ listed, business }),
      );
      return `Confidential access listed ${q(listed)} after Grant access. Person offered ${options.length - 1} people, no Business Users.`;
    },
  );

  await step(
    R,
    page,
    "Grant step 4: turn on Confidential — restrict to the access list and check the saved result",
    "The switch is on after reload.",
    async () => {
      await page
        .getByRole("switch", { name: "Confidential — restrict to the access list" })
        .click();
      await settle(page);
      await reload(page);
      const on = await page
        .getByRole("switch", { name: "Confidential — restrict to the access list" })
        .isChecked();
      expect(on, "switch off after reload");
      return `After a reload the switch was on.`;
    },
  );

  await step(
    "legal_team_member (Priya Raman, comparison reader with a Grant)",
    reader.page,
    `V-C53 ${who}: a Grant gives the named person access`,
    "Priya opens the Confidential Entity.",
    async () => {
      await go(reader.page, `/entities/${S.id}`);
      const opens = await reader.page
        .getByRole("heading", { level: 1, name: S.legalName })
        .isVisible();
      expect(opens, "Priya could not open the Entity");
      return `Priya Raman opened ${S.legalName}.`;
    },
  );

  await step(
    otherKey,
    o.page,
    `V-C53 ${who}: without a Grant the other role cannot reach the Confidential Entity; Holdings and register Holders show Restricted Entity; chart shows Confidential Entity; no self-grant`,
    "Direct open fails; Restricted Entity without a link on the parent's Holdings and in the register; chart node reads Confidential Entity with no link; self-grant refused.",
    async () => {
      const op = o.page;
      await go(op, `/entities/${S.id}`);
      const opens = await op
        .getByRole("heading", { level: 1, name: S.legalName })
        .isVisible()
        .catch(() => false);
      const direct = await o.api("GET", `/entities/${S.id}`);
      await go(op, `/entities/${P.id}/ownership`);
      const owned = await sectionText(op, "Holdings in other Entities");
      await go(op, `/entities/${Rg.id}/ownership`);
      const regMembers = (
        await section(op, "Register of members").locator("tbody tr").allInnerTexts()
      ).map(tidy);
      const secretLinks = await op.getByRole("link", { name: S.legalName }).count();
      await openChart(op, prefix);
      const view = await readChart(op);
      const restrictedNodes = view.nodes.filter((n) => n.restricted);
      if (R === "legal_team_member") {
        await op.getByRole("button", { name: "Fit to window" }).click();
        await wait(400);
        await shot(
          op,
          "c53-admin-without-grant-chart.png",
          `V-C53: ${o.person.name} (Administrator, no Grant) searches the chart; the Confidential sub-Entity is a Confidential Entity box`,
        );
      }
      const named = view.nodes.some((n) => n.name === S.legalName);
      await go(op, "/entities?view=list");
      await op.getByRole("searchbox", { name: "Search entities by name" }).fill(S.legalName);
      await settle(op);
      const listed = await op
        .locator("main table tbody")
        .getByRole("link", { name: S.legalName })
        .count();
      const me = await o.api("GET", "/me");
      const self = await o.api("POST", `/entities/${S.id}/grants`, {
        userId: me.json?.user?.id ?? me.json?.id,
      });
      expect(
        !opens &&
          direct.status === 404 &&
          /Restricted Entity/.test(owned) &&
          regMembers.some((r) => /Restricted Entity/.test(r)) &&
          secretLinks === 0 &&
          restrictedNodes.length >= 1 &&
          restrictedNodes.every((n) => n.name === "Confidential Entity" && !n.href) &&
          !named &&
          listed === 0 &&
          self.status >= 400,
        q({
          opens,
          direct: direct.status,
          owned,
          regMembers,
          secretLinks,
          restrictedNodes,
          named,
          listed,
          self: self.status,
        }),
      );
      return `${o.person.name}: opening ${S.legalName} showed no record (API ${direct.status}). ${P.legalName}'s Holdings in other Entities read ${q(owned)}. ${Rg.legalName}'s Register of members read ${q(regMembers)}. The chart drew ${restrictedNodes.length} "Confidential Entity" node(s) with no link or name. A List search found ${listed} rows. A self-grant returned ${self.status} ${q(self.json?.detail)}.`;
    },
  );

  await step(
    otherKey,
    o.page,
    `V-C53 ${who}: a register entry naming a Holder you cannot see can be edited, but that Holder cannot be replaced`,
    "Changing the To Holder on entry 004 is refused with the guide's message; the entry keeps its Holder.",
    async () => {
      const op = o.page;
      await go(op, `/entities/${Rg.id}/ownership`);
      const label = "Edit entry 4";
      await op.getByRole("button", { name: label, exact: true }).click();
      const d = op.getByRole("dialog", { name: "Edit entry 004" });
      await d.waitFor();
      const toShown = tidy(await d.getByLabel(req("To")).locator("option:checked").innerText());
      await d.getByLabel(req("To")).selectOption({ label: "Entity from the registry…" });
      await d
        .getByRole("combobox", { name: "Entity", exact: true })
        .selectOption({ label: U.legalName });
      await d.getByRole("button", { name: "Save" }).click();
      const alert = tidy(await d.getByRole("alert").innerText());
      await d.getByRole("button", { name: "Cancel" }).click();
      const entry = (await register(Rg, s)).entries.find((e) => e.entryNo === 4);
      expect(
        toShown === "Restricted Entity" &&
          alert ===
            "This entry names an Entity you cannot see. That holder stays until someone who can see the Entity changes it." &&
          entry.to?.id &&
          !/lone/.test(q(entry.to)),
        q({ toShown, alert, to: entry.to }),
      );
      return `${o.person.name} opened ${q(label)}: To showed ${q(toShown)}. Replacing it with ${U.legalName} was refused with ${q(alert)}; the entry kept its Holder.`;
    },
  );

  await step(
    otherKey,
    o.page,
    `V-C53 ${who}: an Officer user link, a linked Contract, a Holding and a register entry do not grant access`,
    "After being linked as an Officer, the user still cannot open the Entity; a reachable Contract signed by it shows Restricted Entity.",
    async () => {
      await go(page, `/entities/${S.id}`);
      const card = section(page, "Directors & Officers");
      await card.getByRole("button", { name: "Add director or officer" }).click();
      // The name combobox links a user when one is selected from the People list.
      const box = card.getByRole("combobox", { name: "Director or officer name", exact: true });
      await box.click();
      await box.pressSequentially(o.person.name.split(" ")[0]);
      await page
        .getByRole("listbox", { name: "People" })
        .getByRole("option", { name: o.person.name, exact: true })
        .click();
      await card.getByRole("button", { name: "Add", exact: true }).click();
      await settle(page);
      const linked = (await s.api("GET", `/entities/${S.id}/officers`)).json.officers.find(
        (x) => x.user?.displayName === o.person.name,
      );
      expect(linked, `no Officer linked to ${o.person.name}`);
      const direct = await o.api("GET", `/entities/${S.id}`);
      await go(o.page, `/contracts/${c3.number}`);
      const pageHasRestricted = await o.page.getByText("Restricted Entity").count();
      const leaks = await o.page.getByText(S.legalName).count();
      expect(
        direct.status === 404 && pageHasRestricted > 0 && leaks === 0,
        q({ direct: direct.status, pageHasRestricted, leaks }),
      );
      return `With ${o.person.name} linked as an Officer on ${S.legalName} (which also holds register shares and Holdings), reading it still returned ${direct.status}. On C-${c3.number}, whose Our entity is ${S.legalName}, ${o.person.name} saw "Restricted Entity" and the legal name appeared ${leaks} times.`;
    },
  );

  await step(
    R,
    page,
    "Grant step 5: Remove <name> withdraws access; the recorded relationship is kept",
    "Priya leaves the list, cannot open the Entity, and sees Restricted Entity for the Holding; the actor still sees it.",
    async () => {
      await page.getByRole("button", { name: "Manage access" }).click();
      await grantsDialog.getByRole("button", { name: "Remove Priya Raman" }).click();
      await grantsDialog
        .getByRole("button", { name: "Remove Priya Raman" })
        .waitFor({ state: "detached" });
      const listed = await grantsDialog
        .getByRole("button", { name: /^Remove / })
        .evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label").replace(/^Remove /, "")));
      await page.keyboard.press("Escape");
      const direct = await reader.api("GET", `/entities/${S.id}`);
      await go(reader.page, `/entities/${P.id}/ownership`);
      const readerOwned = await sectionText(reader.page, "Holdings in other Entities");
      await go(page, `/entities/${P.id}/ownership`);
      const actorOwned = await sectionText(page, "Holdings in other Entities");
      expect(
        !listed.includes("Priya Raman") &&
          direct.status === 404 &&
          /Restricted Entity/.test(readerOwned) &&
          actorOwned.includes(S.legalName),
        q({ listed, direct: direct.status, readerOwned, actorOwned }),
      );
      return `After Remove Priya Raman the list read ${q(listed)}. Priya's read of ${S.legalName} returned ${direct.status}, and ${P.legalName}'s Holdings in other Entities showed her ${q(readerOwned)}. ${s.person.name} still saw ${q(actorOwned)}.`;
    },
  );

  await step(
    R,
    page,
    "Negative: removing the last live person from a Confidential Entity is refused",
    "Removing yourself as the only grantee shows the refusal and keeps the Grant.",
    async () => {
      await go(page, `/entities/${S.id}`);
      await page.getByRole("button", { name: "Manage access" }).click();
      await grantsDialog.getByRole("button", { name: `Remove ${s.person.name}` }).click();
      const alert = grantsDialog.getByRole("alert");
      await alert.waitFor({ timeout: 8000 });
      const message = tidy(await alert.innerText());
      const still = await grantsDialog
        .getByRole("button", { name: `Remove ${s.person.name}` })
        .count();
      await page.keyboard.press("Escape");
      expect(message && still === 1, q({ message, still }));
      return `Removing ${s.person.name}, the only person in the list, showed ${q(message)} and the Grant stayed.`;
    },
  );

  await step(
    R,
    page,
    "Turning the Confidential switch off makes the Entity available to all Legal Team Members and Administrators without Grants",
    "The other role and Priya can open the Entity again.",
    async () => {
      await page
        .getByRole("switch", { name: "Confidential — restrict to the access list" })
        .click();
      await settle(page);
      await reload(page);
      const off = !(await page
        .getByRole("switch", { name: "Confidential — restrict to the access list" })
        .isChecked());
      const other = await o.api("GET", `/entities/${S.id}`);
      const priya = await reader.api("GET", `/entities/${S.id}`);
      await go(o.page, `/entities/${S.id}`);
      const opens = await o.page.getByRole("heading", { level: 1, name: S.legalName }).isVisible();
      expect(
        off && other.status === 200 && priya.status === 200 && opens,
        q({ off, other: other.status, priya: priya.status, opens }),
      );
      return `With the switch off after a reload, ${o.person.name} opened ${S.legalName} in the browser; reads returned ${other.status} for ${o.person.name} and ${priya.status} for Priya Raman, neither holding a Grant.`;
    },
  );

  if (R === "administrator") {
    await step(
      R,
      page,
      "Negative: turning on Confidential with no live person in the list is refused",
      "After the Administrator removes the only Grant on an open Entity, the switch refuses with a message.",
      async () => {
        await go(page, `/entities/${U.id}`);
        await page.getByRole("button", { name: "Manage access" }).click();
        await grantsDialog.getByRole("button", { name: `Remove ${s.person.name}` }).click();
        await grantsDialog.getByText("No grants yet.").waitFor();
        await page.keyboard.press("Escape");
        await page
          .getByRole("switch", { name: "Confidential — restrict to the access list" })
          .click();
        await settle(page);
        const message = tidy(
          await page
            .getByText(/before making this entity confidential/)
            .innerText()
            .catch(() => ""),
        );
        await reload(page);
        const on = await page
          .getByRole("switch", { name: "Confidential — restrict to the access list" })
          .isChecked();
        expect(message && !on, q({ message, on }));
        return `With "No grants yet." in Confidential access, turning on the switch showed ${q(message)}; after a reload the Entity was still open.`;
      },
    );
  } else {
    await step(
      R,
      page,
      "Grant note: a Grant lets its holder change the flag and Grants; a Legal Team Member who removes their own Grant on an open Entity loses that control",
      "After removing the own Grant, the switch is unavailable and Manage access is gone.",
      async () => {
        await go(page, `/entities/${U.id}`);
        await page.getByRole("button", { name: "Manage access" }).click();
        await grantsDialog.getByRole("button", { name: `Remove ${s.person.name}` }).click();
        await grantsDialog.getByText("No grants yet.").waitFor();
        await page.keyboard.press("Escape");
        await reload(page);
        const disabled = await page
          .getByRole("switch", { name: "Confidential — restrict to the access list" })
          .isDisabled();
        const manage = await page.getByRole("button", { name: "Manage access" }).count();
        expect(disabled && manage === 0, q({ disabled, manage }));
        return `After ${s.person.name} removed their own Grant on the open ${U.legalName}, the switch was disabled and Manage access was absent after a reload.`;
      },
    );
  }
  if (R === ROLES[ROLES.length - 1]) await cleanupBulk(ctx);
  if (errorScreens.length)
    await ctx.record({
      what: "Transient error screens on the shared lab (each cleared on reload)",
      screens: errorScreens.splice(0),
    });
}
