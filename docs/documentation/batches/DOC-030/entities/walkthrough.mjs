// DOC-030 independent walkthrough, group "entities".
// Written by the DOC-030 independent walkthrough agent (entities) from the article
// text of entities-and-counterparties, entity-records, entity-obligations and
// entity-structure-and-access at app commit 067c1646. It follows the DOC-029
// entities walkthrough-r1.mjs pattern and drives the real controls in headless
// Chromium on the shared work2 lab, one browser context per identity.
// API calls only prepare fixtures, make a second actor's competing write, or read
// back a result that the browser step already showed.
//
// Run from the worktree root:
//   LAB_PASSWORD=... node docs/documentation/batches/DOC-030/entities/walkthrough.mjs
// Optional: PHASES=c31,c32,c52,c53 ROLES=legal_team_member,administrator OUT=<file>
//           PORTAL_STATE=<file outside docs/> keeps the Business User session between runs.
// The seed password comes only from the environment. Cookies, magic links and mail
// bodies are never written to the log.
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  here,
  BASE,
  MAIL,
  lab,
  articleHash,
  launch,
  closeBrowser,
  passwordSession,
  portalSession,
} from "./api.mjs";

const PHASES = (process.env.PHASES ?? "c31,c32,c52,c53").split(",");
const ROLES = (process.env.ROLES ?? "legal_team_member,administrator").split(",");
const OUT = process.env.OUT ?? path.join(here, "walkthrough.json");
const SHOTS = process.env.SHOTS ?? here;
const now = new Date();
const TAG = `${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}-${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}`;
const ARTICLES = [
  "entities-and-counterparties",
  "entity-records",
  "entity-obligations",
  "entity-structure-and-access",
];
const REL = "docs/documentation/batches/DOC-030/entities";

const running = Object.fromEntries(
  ["app", "doc-engine", "worker"].map((service) => [
    service,
    execFileSync("docker", ["inspect", "--format", "{{.Image}}", `${lab.project}-${service}-1`])
      .toString()
      .trim(),
  ]),
);

const PEOPLE = {
  administrator: { email: "daniel.okafor@helix.example", name: "Daniel Okafor" },
  legal_team_member: { email: "nadia.haddad@helix.example", name: "Nadia Haddad" },
  comparison_legal: { email: "priya.raman@helix.example", name: "Priya Raman" },
  business_user: { email: "diego.salas@helix.example", name: "Diego Salas" },
};

const log = {
  kind: "independent-article-walkthrough",
  batch: "DOC-030",
  group: "entities",
  walkthroughReviewer: "DOC-030 independent walkthrough agent (entities)",
  reviewerKind: "agent",
  appCommit: lab.sourceCommit,
  environment: lab.project,
  lab: lab.name,
  buildId: `app ${lab.appImageId}; engine ${lab.engineImageId}`,
  containerImages: lab.containerImages,
  runningImageCheck: running,
  seed: lab.seed,
  articleHashes: Object.fromEntries(ARTICLES.map((id) => [id, articleHash(id)])),
  browser: "Playwright 1.63.0 Chromium, headless, 1280x900, one browser context per identity",
  appUrl: BASE,
  mailUrl: MAIL,
  tag: TAG,
  phases: PHASES,
  roles: ROLES,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  steps: [],
  errorScreens: [],
  shots: [],
  guideFailures: [],
  productBugs: [],
  fixtures: [],
  notes: [],
};
function save() {
  log.finishedAt = new Date().toISOString();
  writeFileSync(
    OUT,
    JSON.stringify(log, null, 2).replace(/token=[^&\s"\\]+/g, "token=[redacted]") + "\n",
  );
}
async function shot(page, name, purpose) {
  await page.screenshot({ path: path.join(SHOTS, name) });
  log.shots.push({
    path: `${REL}/${name}`,
    purpose,
    url: new URL(page.url()).pathname,
    at: new Date().toISOString(),
    viewport: "1280x900",
  });
}
function fixture(what, how) {
  log.fixtures.push({ at: new Date().toISOString(), scenario: current.scenario, what, how });
}
function guideFailure(role, step, expected, observed) {
  log.guideFailures.push({
    article: current.article,
    scenario: current.scenario,
    role,
    step,
    expected,
    observed,
  });
}
function productBug(id, summary, reproduction, observed) {
  if (log.productBugs.some((b) => b.id === id)) {
    log.productBugs.find((b) => b.id === id).alsoSeen.push({ scenario: current.scenario, observed });
    return;
  }
  log.productBugs.push({ id, summary, reproduction, observed, alsoSeen: [] });
}

let current = { article: null, scenario: null };
const contexts = {};
async function step(role, page, action, expected, fn) {
  const entry = {
    article: current.article,
    scenario: current.scenario,
    role,
    method: "browser-walkthrough",
    page: null,
    action,
    expected,
    actual: null,
    result: "not-run",
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  log.steps.push(entry);
  try {
    entry.actual = await fn();
    entry.result = "pass";
  } catch (error) {
    entry.actual = `Check failed: ${String(error instanceof Error ? error.message : error)
      .split("\n")
      .slice(0, 6)
      .join(" ")}`;
    entry.result = "fail";
    if (process.env.DEBUG_SHOTS) {
      for (const [key, c] of Object.entries(contexts)) {
        console.log(`    ${key} recent: ${(c.page.__bad ?? []).slice(-8).join(" | ")}`);
        await c.page
          .screenshot({
            path: path.join(process.env.DEBUG_SHOTS, `fail-${log.steps.length}-${key}.png`),
            fullPage: true,
          })
          .catch(() => {});
      }
    }
  }
  try {
    const u = new URL(page.url());
    entry.page = u.pathname + u.search;
  } catch {}
  entry.finishedAt = new Date().toISOString();
  console.log(`[${current.scenario}] [${role}] ${entry.result.toUpperCase()} ${action}`);
  if (entry.result === "fail") console.log(`    ${entry.actual}`);
  save();
  return entry;
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}
const q = (s) => JSON.stringify(s);
const tidy = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- sessions ----------
async function session(key) {
  if (contexts[key]) return contexts[key];
  const person = PEOPLE[key];
  const s =
    key === "business_user" ? await portalSession(person) : await passwordSession(person);
  watch(s.page);
  contexts[key] = { ...s, person, key };
  return contexts[key];
}
function watch(page) {
  page.__bad = [];
  page.on("response", (r) => {
    if (r.status() >= 400)
      page.__bad.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
  });
  page.on("console", (m) => {
    if (m.type() === "error") page.__bad.push(`console: ${m.text().slice(0, 200)}`);
  });
}
async function go(page, url) {
  page.__bad = [];
  await page.goto(`${BASE}${url}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await checkErrorScreen(page, url);
}
async function checkErrorScreen(page, url) {
  if (
    await page
      .getByText("Something went wrong.")
      .isVisible()
      .catch(() => false)
  ) {
    log.errorScreens.push({
      at: new Date().toISOString(),
      scenario: current.scenario,
      url: new URL(page.url()).pathname,
      requested: url,
      responses: [...page.__bad],
    });
    console.log(`    error screen on ${url}: ${page.__bad.join(" | ")}`);
    page.__bad = [];
    await page.reload();
    await page.waitForLoadState("networkidle").catch(() => {});
  }
}
async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await wait(700);
  await checkErrorScreen(page, new URL(page.url()).pathname + new URL(page.url()).search);
}
async function reload(page) {
  page.__bad = [];
  await page.reload();
  await settle(page);
}
async function blurTo(page, heading) {
  await page.getByRole("heading", { name: heading, exact: true }).first().click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await wait(700);
}
async function sectionText(page, heading) {
  const h = page.getByRole("heading", { name: heading, exact: true }).first();
  if (!(await h.count())) return null;
  return tidy(await h.locator("xpath=ancestor::section[1]").innerText());
}
function section(page, heading) {
  return page
    .getByRole("heading", { name: heading, exact: true })
    .first()
    .locator("xpath=ancestor::section[1]");
}
// Share-capital inputs show grouped digits until focused, so a person clicks,
// selects the old value, and types. plain() removes the display grouping.
async function typeInto(locator, text) {
  await locator.click();
  await locator.press("Control+A");
  await locator.press("Backspace");
  if (text) await locator.pressSequentially(text);
}
const plain = (v) => v.replace(/,/g, "");
// A required field's label ends in an aria-hidden asterisk that Playwright's label
// text still includes, so required labels match with an optional trailing "*".
const req = (t) => new RegExp(`^${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\*?$`);

/** The shared filter bar: Filter, pick a property, pick one value, Apply. */
async function applyFilter(page, scope, property, choice) {
  await scope.getByRole("button", { name: /^Filter/ }).click();
  const pop = page.getByRole("dialog", { name: "Filter" });
  await pop.waitFor();
  await pop.getByRole("button", { name: new RegExp(`^${property}`) }).click();
  if (choice === undefined) {
    await pop.waitFor({ state: "hidden" }).catch(() => {});
    await settle(page);
    return;
  }
  const search = pop.getByLabel("Search choices");
  if (await search.count()) await search.fill(choice);
  const radio = pop.getByRole("radio", { name: choice, exact: true });
  if (await radio.count()) await radio.check();
  else await pop.getByRole("checkbox", { name: choice, exact: true }).click();
  await pop.getByRole("button", { name: "Apply" }).click();
  await settle(page);
}
async function filterProperties(page, scope) {
  await scope.getByRole("button", { name: /^Filter/ }).click();
  const pop = page.getByRole("dialog", { name: "Filter" });
  await pop.waitFor();
  const names = (await pop.getByRole("button").allInnerTexts()).map(tidy).filter(Boolean);
  await page.keyboard.press("Escape");
  await pop.waitFor({ state: "hidden" }).catch(() => {});
  return names;
}
/** DES-048's date field: open the calendar, pick the year and month, then the day. */
async function pickDate(page, trigger, iso) {
  await trigger.click();
  const pop = page.getByRole("dialog", { name: "Choose a date" });
  await pop.waitFor();
  const [y, m] = iso.split("-").map(Number);
  await pop.getByRole("combobox", { name: "Year" }).selectOption(String(y));
  await pop.getByRole("combobox", { name: "Month" }).selectOption(String(m - 1));
  await pop.locator(`[data-day="${iso}"]:not([data-outside]) button`).click();
  await pop.waitFor({ state: "hidden" }).catch(() => {});
}

// ---------- shared fixtures ----------
let corporationId = null;
async function typeId(s) {
  if (!corporationId) {
    const r = await s.api("GET", "/entities/types");
    corporationId = r.json.entityTypes.find((t) => t.displayName === "Corporation").id;
  }
  return corporationId;
}
async function fixtureEntity(s, legalName, extra = {}) {
  const r = await s.api("POST", "/entities", {
    legalName,
    entityTypeId: await typeId(s),
    ...extra,
  });
  expect(r.status === 201, `fixture Entity ${legalName} refused ${r.status} ${q(r.json)}`);
  fixture(`Entity ${legalName}`, `POST /entities as ${s.person.name}`);
  return r.json.entity;
}
let contractTypeId = null;
async function fixtureContract(s, title, extra = {}) {
  if (!contractTypeId) {
    const admin = await session("administrator");
    const r = await admin.api("GET", "/contract-types");
    contractTypeId = (r.json.contractTypes ?? []).find(
      (t) => t.displayName === "NDA" && !t.archivedAt,
    )?.id;
    expect(contractTypeId, "no NDA contract type");
  }
  const r = await s.api("POST", "/contracts", {
    title,
    contractTypeId,
    customFields: {},
    isConfidential: Boolean(extra.isConfidential),
    managerId: null,
  });
  expect(r.status === 201, `fixture Contract ${title} refused ${r.status} ${q(r.json)}`);
  fixture(`Contract ${title}`, `POST /contracts as ${s.person.name}`);
  return r.json.contract;
}
async function contractParties(s, number) {
  const r = await s.api("GET", `/contracts/${number}`);
  const parties = r.json?.counterparties ?? r.json?.contract?.counterparties ?? [];
  return {
    names: parties.map((p) => p.name),
    primary: parties.find((p) => p.isPrimary)?.name ?? null,
  };
}
async function registryCount(s, text) {
  const r = await s.api("GET", `/entities?q=${encodeURIComponent(text)}&limit=100`);
  return (r.json?.entities ?? []).length;
}

// =====================================================================
// V-C31 entities-and-counterparties
// =====================================================================
let requiredType = null;
async function c31Setup() {
  current = { article: "entities-and-counterparties", scenario: "V-C31" };
  // Guide step 5 needs an Entity type whose Form marks a Field required for
  // creation. No seeded type has one, so an Administrator adds a new type for this
  // walkthrough (no seeded type is changed) and it is archived at the end.
  const admin = await session("administrator");
  const created = await admin.api("POST", "/entity-types", {
    displayName: `DOC-030 entities V-C31 ${TAG} required type`,
  });
  expect(created.status === 201, `entity type fixture ${created.status} ${q(created.json)}`);
  requiredType = created.json.entityType;
  const corp = await admin.api("GET", `/entity-types/${await typeId(admin)}/form`);
  const row = corp.json.form.find((n) => n.kind === "row" && n.rowRef === "local_counsel");
  expect(row, "Corporation Form has no local_counsel Row to reuse");
  const put = await admin.api("PUT", `/entity-types/${requiredType.id}/form`, {
    form: [{ ...row, isRequired: true, visibleOnPortal: false }],
  });
  expect(put.status === 200, `form fixture ${put.status} ${q(put.json)}`);
  fixture(
    `Entity type ${requiredType.displayName} with Local counsel required for creation`,
    "POST /entity-types and PUT /entity-types/:id/form as Daniel Okafor",
  );
}
async function c31Cleanup() {
  if (!requiredType) return;
  const admin = await session("administrator");
  const using = await admin.api("GET", `/entities?limit=100&includeArchived=true&q=${encodeURIComponent(`DOC-030 entities V-C31 ${TAG}`)}`);
  for (const e of using.json?.entities ?? [])
    if (e.entityTypeId === requiredType.id)
      await admin.api("PATCH", `/entities/${e.id}`, { entityTypeId: await typeId(admin) });
  const archived = await admin.api("POST", `/entity-types/${requiredType.id}/archive`, {});
  fixture(
    `Entity type ${requiredType.displayName} archived after reassigning its Entities to Corporation`,
    `POST /entity-types/:id/archive answered ${archived.status}`,
  );
}

async function c31(R) {
  current = { article: "entities-and-counterparties", scenario: "V-C31" };
  const s = await session(R);
  const { page } = s;
  const who = R === "administrator" ? "A" : "L";
  const prefix = `DOC-030 entities V-C31 ${TAG} ${who}`;
  const legalName = `${prefix} Aldoria Holdings`;
  let entityId = null;

  await step(
    R,
    page,
    "Register step 1: open Entities; its first view is Calendar; select List",
    "Entities opens on the Compliance calendar; List shows the registry table.",
    async () => {
      await go(page, "/");
      await page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("link", { name: "Entities" })
        .click();
      await settle(page);
      const heading = await page.getByRole("heading", { name: "Compliance calendar" }).isVisible();
      const calendarUrl = new URL(page.url());
      const current = await page
        .getByRole("navigation", { name: "Registry view" })
        .getByRole("link", { name: "Calendar" })
        .getAttribute("aria-current");
      expect(heading && !calendarUrl.searchParams.get("view"), "first view was not the Calendar");
      await page
        .getByRole("navigation", { name: "Registry view" })
        .getByRole("link", { name: "List" })
        .click();
      await settle(page);
      const header = tidy(await page.locator("main table thead").first().innerText());
      expect(/Legal name/.test(header), "List has no registry table");
      return `Entities opened at ${calendarUrl.pathname} with the Compliance calendar heading (Calendar link aria-current=${current}). List moved to ${new URL(page.url()).search} and showed a table headed ${q(header)}.`;
    },
  );

  await step(
    R,
    page,
    "Register step 2: Search entities by name; Filter with Type, Status, Jurisdiction, Majority owner (one value, Apply, chips); Clear all",
    "Search narrows by name; each filter takes one value and shows a chip; Clear all removes every filter.",
    async () => {
      const firstName = tidy(
        await page.locator("main table tbody tr td:first-child a").first().innerText(),
      );
      const search = page.getByRole("searchbox", { name: "Search entities by name" });
      await search.fill(firstName);
      await settle(page);
      const names = (await page.locator("main table tbody tr td:first-child").allInnerTexts()).map(
        tidy,
      );
      expect(
        names.length >= 1 && names.every((n) => n.toLowerCase().includes(firstName.toLowerCase())),
        `search rows ${q(names)}`,
      );
      await search.fill("");
      await settle(page);
      const total = await page.locator("main table tbody tr").count();
      const bar = page.getByLabel("Record filters");
      const properties = await filterProperties(page, bar);
      for (const label of ["Type", "Status", "Jurisdiction", "Majority owner", "Show archived"])
        expect(
          properties.some((p) => p.startsWith(label)),
          `Filter menu lacks ${label}: ${q(properties)}`,
        );
      await applyFilter(page, bar, "Type", "LLC");
      await applyFilter(page, bar, "Status", "Active");
      const chips = (await bar.getByRole("button").allInnerTexts()).map(tidy);
      const filtered = (await page.locator("main table tbody tr").allInnerTexts()).map(tidy);
      expect(
        filtered.length > 0 &&
          filtered.length < total &&
          filtered.every((r) => /LLC/.test(r) && /Active/.test(r)),
        `filtered rows ${filtered.length}/${total} ${q(filtered.slice(0, 3))}`,
      );
      expect(
        chips.some((c) => /^Type:\s*LLC/.test(c)) && chips.some((c) => /^Status:\s*Active/.test(c)),
        `chips ${q(chips)}`,
      );
      await bar.getByRole("button", { name: "Clear all" }).click();
      await settle(page);
      // Jurisdiction and Majority owner: pick the first offered value.
      await bar.getByRole("button", { name: /^Filter/ }).click();
      let pop = page.getByRole("dialog", { name: "Filter" });
      await pop.getByRole("button", { name: /^Jurisdiction/ }).click();
      const jurisdiction = tidy(await pop.getByRole("radio").first().locator("xpath=..").innerText());
      await pop.getByRole("radio").first().check();
      await pop.getByRole("button", { name: "Apply" }).click();
      await settle(page);
      const byJurisdiction = (await page.locator("main table tbody tr").allInnerTexts()).map(tidy);
      expect(
        byJurisdiction.length > 0 && byJurisdiction.every((r) => r.includes(jurisdiction)),
        `jurisdiction ${jurisdiction} rows ${q(byJurisdiction.slice(0, 3))}`,
      );
      await bar.getByRole("button", { name: "Remove Jurisdiction filter" }).click();
      await settle(page);
      await bar.getByRole("button", { name: /^Filter/ }).click();
      pop = page.getByRole("dialog", { name: "Filter" });
      await pop.getByRole("button", { name: /^Majority owner/ }).click();
      const owner = tidy(await pop.getByRole("radio").first().locator("xpath=..").innerText());
      await pop.getByRole("radio").first().check();
      await pop.getByRole("button", { name: "Apply" }).click();
      await settle(page);
      const byOwner = await page.locator("main table tbody tr").count();
      const ownerChip = (await bar.getByRole("button").allInnerTexts())
        .map(tidy)
        .find((c) => c.startsWith("Majority owner"));
      await bar.getByRole("button", { name: "Clear all" }).click();
      await settle(page);
      const cleared = await page.locator("main table tbody tr").count();
      const chipsAfter = (await bar.getByRole("button").allInnerTexts())
        .map(tidy)
        .filter((c) => c.includes(":"));
      expect(byOwner > 0 && byOwner < total && cleared >= total && chipsAfter.length === 0,
        q({ byOwner, cleared, total, chipsAfter }));
      return `Search ${q(firstName)} left ${names.length} matching row(s). Filter listed ${q(properties)}. Type LLC then Status Active (one radio value each, Apply) showed chips ${q(chips.filter((c) => c.includes(":")))} and left ${filtered.length} of ${total} rows, all LLC and Active. Jurisdiction ${q(jurisdiction)} left ${byJurisdiction.length} rows with that jurisdiction. Majority owner ${q(owner)} showed chip ${q(ownerChip)} and left ${byOwner} rows. Clear all removed every chip and returned ${cleared} rows.`;
    },
  );

  await step(
    R,
    page,
    "Refusals: Register with no Legal name, then no Entity type",
    "The dialog shows 'Name the entity — its registered legal name.' then 'Pick an entity type.'; nothing is created.",
    async () => {
      const before = await registryCount(s, prefix);
      await page.getByRole("button", { name: "Add entity" }).first().click();
      const dialog = page.getByRole("dialog", { name: "Add entity" });
      await dialog.waitFor();
      await dialog.getByRole("button", { name: "Register" }).click();
      const m1 = tidy(await dialog.getByRole("alert").innerText());
      await dialog.getByLabel("Legal name").fill(`${prefix} no type`);
      await dialog.getByRole("button", { name: "Register" }).click();
      await wait(300);
      const m2 = tidy(await dialog.getByRole("alert").innerText());
      const open = await dialog.isVisible();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      const after = await registryCount(s, prefix);
      expect(
        m1 === "Name the entity — its registered legal name." &&
          m2 === "Pick an entity type." &&
          open &&
          before === after,
        q({ m1, m2, open, before, after }),
      );
      return `Register with nothing showed ${q(m1)}; with a name but no type it showed ${q(m2)} and the dialog stayed open. Registry rows for the prefix stayed ${after}.`;
    },
  );

  await step(
    R,
    page,
    "Register step 5: a type whose Form requires a Field for creation shows it after the identity details; blank gives 'Fill {Field}'; filled, it saves",
    "Local counsel appears after Registered address; blank shows 'Fill Local counsel.'; filled, Register saves it on the record.",
    async () => {
      const name = `${prefix} Required Field Ltd`;
      await page.getByRole("button", { name: "Add entity" }).first().click();
      const dialog = page.getByRole("dialog", { name: "Add entity" });
      await dialog.getByLabel("Legal name").fill(name);
      const corporationFields = await dialog.getByLabel("Local counsel").count();
      await dialog.getByLabel("Entity type").selectOption({ label: requiredType.displayName });
      const field = dialog.getByLabel("Local counsel");
      await field.waitFor();
      const order = await dialog.evaluate((d) => {
        const labels = [...d.querySelectorAll("label")].map((l) => l.textContent.trim());
        return labels;
      });
      const after =
        order.findIndex((l) => l.startsWith("Local counsel")) >
        order.findIndex((l) => l.startsWith("Registered address"));
      await dialog.getByRole("button", { name: "Register" }).click();
      const refusal = tidy(await dialog.getByRole("alert").innerText());
      await field.fill("Harbour & Pike LLP (fictional)");
      await dialog.getByRole("button", { name: "Register" }).click();
      await dialog.waitFor({ state: "hidden", timeout: 15000 });
      const r = await s.api("GET", `/entities?q=${encodeURIComponent(name)}`);
      const saved = r.json.entities.find((e) => e.legalName === name);
      expect(
        corporationFields === 0 &&
          after &&
          refusal === "Fill Local counsel." &&
          saved?.customFields?.local_counsel === "Harbour & Pike LLP (fictional)",
        q({ corporationFields, after, refusal, saved: saved?.customFields }),
      );
      return `Before a type was chosen the dialog had no Local counsel control. Choosing ${q(requiredType.displayName)} added Local counsel after Registered address. Register with it blank showed ${q(refusal)}. Filled, Register saved ${q(name)} with Local counsel ${q(saved.customFields.local_counsel)}.`;
    },
  );

  await step(
    R,
    page,
    "Register steps 3-4, 6-8: Add entity with identity details, Status default Active, Portal-listed (Administrators only, off by default), Attach documents with a Document type, Register, open it; creator Grant",
    "Status defaults to Active; Portal-listed shows only to Administrators and is off; the attached file lands on the new Entity; the adder holds a Grant.",
    async () => {
      await page.getByRole("button", { name: "Add entity" }).first().click();
      const dialog = page.getByRole("dialog", { name: "Add entity" });
      await dialog.waitFor();
      const statusDefault = tidy(
        await dialog.getByLabel("Status").locator("option:checked").innerText(),
      );
      await dialog.getByLabel("Legal name").fill(legalName);
      await dialog.getByLabel("Entity type").selectOption({ label: "Corporation" });
      await dialog.getByLabel("Formation jurisdiction").fill("Republic of Aldoria");
      await dialog.getByLabel("Formed on").fill("2019-03-14");
      await dialog.getByLabel("Registration no.").fill(`ALD-${who}-${TAG}`);
      await dialog.getByLabel("Tax ID").fill(`TX-${who}-${TAG}`);
      await dialog.getByLabel("Registered agent").fill("Aldoria Corporate Agents");
      await dialog.getByLabel("Registered address").fill("1 Harbour Row, Port Aldo");
      const portal = dialog.getByRole("switch", { name: "Portal-listed" });
      const portalShown = await portal.count();
      let portalDefault = null;
      if (portalShown) {
        portalDefault = await portal.isChecked();
        await portal.click();
      }
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        dialog.locator("button", { hasText: "Attach documents" }).click(),
      ]);
      await chooser.setFiles(path.join(here, "fixtures", "doc030-entities-certificate.pdf"));
      const typeSelect = dialog.getByLabel("Document type");
      let docType = null;
      if (await typeSelect.count()) {
        const options = (await typeSelect.locator("option").allInnerTexts()).map(tidy);
        docType = options.find((o) => o !== "No type") ?? null;
        if (docType) await typeSelect.selectOption({ label: docType });
      }
      await dialog.getByRole("button", { name: "Register" }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      await settle(page);
      await page.getByRole("searchbox", { name: "Search entities by name" }).fill(legalName);
      await settle(page);
      await page.getByRole("link", { name: legalName, exact: true }).first().click();
      await settle(page);
      entityId = new URL(page.url()).pathname.split("/")[2];
      expect(
        await page.getByRole("heading", { level: 1, name: legalName }).isVisible(),
        "new Entity did not open",
      );
      const values = {};
      for (const label of [
        "Formation jurisdiction",
        "Formed on",
        "Registration no.",
        "Tax ID",
        "Registered agent",
        "Registered address",
      ])
        values[label] = await page.getByRole("main").getByLabel(label, { exact: true }).inputValue();
      const statusSaved = tidy(
        await page
          .getByRole("main")
          .getByLabel("Status", { exact: true })
          .locator("option:checked")
          .innerText(),
      );
      const manage = await page.getByRole("button", { name: "Manage access" }).isVisible();
      const grants = await s.api("GET", `/entities/${entityId}/grants`);
      const grantNames = (grants.json?.grants ?? []).map((g) => g.displayName);
      const portalCard = await sectionText(page, "Portal");
      const portalSwitch = page.getByRole("main").getByRole("switch", { name: "Portal-listed" });
      const portalOn = await portalSwitch.isChecked();
      const portalDisabled = await portalSwitch.isDisabled();
      await go(page, `/entities/${entityId}/documents`);
      const docRow = tidy(
        await page
          .locator("main table tbody tr", { hasText: "doc030-entities-certificate" })
          .first()
          .innerText()
          .catch(() => ""),
      );
      await go(page, `/entities/${entityId}`);
      const portalOk =
        R === "administrator"
          ? portalShown === 1 && portalDefault === false && portalOn && !portalDisabled
          : portalShown === 0 &&
            !portalOn &&
            portalDisabled &&
            /Only an Administrator can change Portal-listed\./.test(portalCard);
      expect(
        statusDefault === "Active" &&
          statusSaved === "Active" &&
          values["Registration no."] === `ALD-${who}-${TAG}` &&
          values["Formed on"] === "2019-03-14" &&
          manage &&
          grantNames.includes(s.person.name) &&
          portalOk &&
          /doc030-entities-certificate/.test(docRow),
        q({ statusDefault, statusSaved, values, manage, grantNames, portalShown, portalDefault, portalOn, portalDisabled, portalCard, docRow }),
      );
      return `Add entity opened with Status ${statusDefault}. Portal-listed in the dialog: ${portalShown ? `shown, off by default (${portalDefault}), turned on` : "not shown"}. Attach documents took doc030-entities-certificate.pdf${docType ? ` with Document type ${q(docType)}` : " (no Document type choice was offered)"}. Register saved ${q(legalName)}; opened from List it read ${q(values)} and Status ${statusSaved}. Manage access was offered and the access list named ${q(grantNames)}. Portal card: ${q(portalCard)} (switch on=${portalOn}, disabled=${portalDisabled}). The Documents tab listed ${q(docRow)}.`;
    },
  );

  await step(
    R,
    page,
    "Register step 8: change a field and move focus away; a selection saves when chosen; Status Dormant does not archive",
    "Registered agent saves on blur; Status Dormant saves on selection; no Archived mark; Archive still offered.",
    async () => {
      const agent = page.getByRole("main").getByLabel("Registered agent", { exact: true });
      await agent.fill("Aldoria Registered Agents Ltd");
      await blurTo(page, "Registry");
      await page
        .getByRole("main")
        .getByLabel("Status", { exact: true })
        .selectOption({ label: "Dormant" });
      await settle(page);
      await reload(page);
      const agentAfter = await page
        .getByRole("main")
        .getByLabel("Registered agent", { exact: true })
        .inputValue();
      const statusAfter = tidy(
        await page
          .getByRole("main")
          .getByLabel("Status", { exact: true })
          .locator("option:checked")
          .innerText(),
      );
      const archiveOffered = await page.getByRole("button", { name: "Archive", exact: true }).isVisible();
      const archivedPill = await page.getByText("Archived", { exact: true }).count();
      expect(
        agentAfter === "Aldoria Registered Agents Ltd" &&
          statusAfter === "Dormant" &&
          archiveOffered &&
          archivedPill === 0,
        q({ agentAfter, statusAfter, archiveOffered, archivedPill }),
      );
      return `After a reload Registered agent read ${q(agentAfter)} and Status read ${statusAfter}. The header still offered Archive and showed no Archived mark.`;
    },
  );

  await step(
    R,
    page,
    "Names are not unique: registering the same legal name again creates another Entity",
    "A second Register with the same name creates a distinct record; the first is unchanged.",
    async () => {
      await go(page, "/entities?view=list");
      await page.getByRole("button", { name: "Add entity" }).first().click();
      const dialog = page.getByRole("dialog", { name: "Add entity" });
      await dialog.getByLabel("Legal name").fill(legalName);
      await dialog.getByLabel("Entity type").selectOption({ label: "LLC" });
      await dialog.getByLabel("Formation jurisdiction").fill("Duchy of Kessel");
      await dialog.getByRole("button", { name: "Register" }).click();
      await dialog.waitFor({ state: "hidden", timeout: 15000 });
      await go(page, "/entities?view=list");
      await page.getByRole("searchbox", { name: "Search entities by name" }).fill(legalName);
      await settle(page);
      const rows = (await page.locator("main table tbody tr").allInnerTexts()).map(tidy);
      const hrefs = await page
        .locator("main table tbody tr")
        .getByRole("link", { name: legalName })
        .evaluateAll((a) => a.map((x) => x.getAttribute("href")));
      expect(rows.length === 2 && new Set(hrefs).size === 2, `rows ${q(rows)}`);
      expect(
        rows.some((r) => /Republic of Aldoria/.test(r) && /Dormant/.test(r)) &&
          rows.some((r) => /Duchy of Kessel/.test(r)),
        "first record changed",
      );
      return `Searching the name listed 2 rows linking to 2 records: ${q(rows)}. The first kept Republic of Aldoria and Dormant.`;
    },
  );

  // Contract parties
  const contract = await fixtureContract(s, `${prefix} parties contract`);
  const cedar = `${prefix} Cedar Supply Ltd`;
  const birch = `${prefix} Birch Logistics`;
  const counterparties = page.getByRole("combobox", { name: "Counterparties" });
  const our = () => page.getByRole("combobox", { name: "Our entity" });

  await step(
    R,
    page,
    "Parties step 1: choose Our entity on a Contract; check the saved name; Not known yet clears it",
    "Our entity saves the chosen Entity; Not known yet clears it; both survive reload.",
    async () => {
      await go(page, `/contracts/${contract.number}`);
      const value = await our()
        .locator("option", { hasText: legalName })
        .evaluateAll((os) => os.map((o) => o.value));
      expect(value.length >= 1, `Our entity does not offer ${legalName}`);
      await our().selectOption(value.find((v) => v === entityId) ?? value[0]);
      await settle(page);
      await reload(page);
      const shown = tidy(await our().locator("option:checked").innerText());
      await our().selectOption({ label: "Not known yet" });
      await settle(page);
      await reload(page);
      const cleared = tidy(await our().locator("option:checked").innerText());
      const api = await s.api("GET", `/contracts/${contract.number}`);
      const apiEntity = api.json?.contract?.entityId ?? api.json?.entityId ?? null;
      await our().selectOption(entityId);
      await settle(page);
      await reload(page);
      const again = tidy(await our().locator("option:checked").innerText());
      expect(shown === legalName && cleared === "Not known yet" && !apiEntity && again === legalName, q({ shown, cleared, apiEntity, again }));
      return `C-${contract.number} Our entity read ${q(shown)} after a reload. Not known yet read ${q(cleared)} after a reload (stored entity ${apiEntity}). It was then set back to ${q(again)}.`;
    },
  );

  await step(
    R,
    page,
    "Parties steps 2-3: type a new name and select Create \"<name>\"; the first Counterparty is Primary",
    "Create adds the new Counterparty with the Primary mark.",
    async () => {
      await counterparties.fill(cedar);
      const create = page.getByRole("option", { name: `Create "${cedar}"` });
      await create.waitFor({ timeout: 10000 });
      await create.click();
      await settle(page);
      await reload(page);
      const primaryMarks = await page.getByText("Primary", { exact: true }).count();
      const detail = await contractParties(s, contract.number);
      expect(
        detail.names.length === 1 && detail.primary === cedar && primaryMarks === 1,
        `parties ${q(detail)} primary marks ${primaryMarks}`,
      );
      return `The picker offered Create "${cedar}" and it added the Counterparty. After a reload the Contract showed ${primaryMarks} Primary mark; parties ${q(detail.names)}, primary ${q(detail.primary)}.`;
    },
  );

  await step(
    R,
    page,
    "Parties step 4: add another Counterparty and Make primary",
    "Make primary moves the Primary mark.",
    async () => {
      await counterparties.fill(birch);
      await page.getByRole("option", { name: `Create "${birch}"` }).click();
      await settle(page);
      const make = page.getByRole("button", { name: "Make primary" });
      expect((await make.count()) === 1, `Make primary buttons ${await make.count()}`);
      await make.click();
      await settle(page);
      await reload(page);
      const detail = await contractParties(s, contract.number);
      expect(detail.primary === birch, `primary ${q(detail)}`);
      return `After Make primary and a reload the primary Counterparty was ${q(detail.primary)}; parties ${q(detail.names)}.`;
    },
  );

  await step(
    R,
    page,
    "Picker rules: an exact existing name in another case offers no creation; a Counterparty on the Contract is not offered again",
    "No Create row for the case variant; the attached party is not listed.",
    async () => {
      await counterparties.fill(cedar.toUpperCase());
      await wait(1500);
      const options = (await page.getByRole("listbox").getByRole("option").allInnerTexts()).map(tidy);
      await counterparties.fill("");
      expect(
        !options.some((o) => /^Create/.test(o)) && !options.some((o) => o.includes(cedar)),
        `options ${q(options)}`,
      );
      return `Typing ${q(cedar.toUpperCase())} listed ${q(options)}: no Create row, and ${cedar} (already on the Contract) was not offered.`;
    },
  );

  await step(
    R,
    page,
    "Parties step 5: Take <name> off the contract; the next remaining takes Primary; the shared record remains; the final removal leaves none",
    "Removing the Primary passes the mark; the shared Counterparty remains; removing the last shows no Counterparties.",
    async () => {
      await page.getByRole("button", { name: `Take ${birch} off the contract` }).click();
      await settle(page);
      await reload(page);
      const afterFirst = await contractParties(s, contract.number);
      expect(afterFirst.primary === cedar && !afterFirst.names.includes(birch), q(afterFirst));
      await counterparties.fill(birch.toUpperCase());
      await wait(1500);
      const offered = (await page.getByRole("listbox").getByRole("option").allInnerTexts()).map(tidy);
      await counterparties.fill("");
      expect(
        offered.some((o) => o.includes(birch)) && !offered.some((o) => /^Create/.test(o)),
        `shared record not offered or Create shown ${q(offered)}`,
      );
      await page.getByRole("button", { name: `Take ${cedar} off the contract` }).click();
      await settle(page);
      await reload(page);
      const empty = await page.getByText("Nobody is recorded on the other side yet.").isVisible();
      const final = await contractParties(s, contract.number);
      expect(empty && final.names.length === 0, q({ empty, final }));
      return `Take ${birch} off the contract left ${q(afterFirst.names)} with ${cedar} Primary. Typing ${q(birch.toUpperCase())} again offered the shared record and no Create row (${q(offered)}). Taking ${cedar} off showed "Nobody is recorded on the other side yet.".`;
    },
  );

  await step(
    R,
    page,
    "Recovery: an archived Entity is not offered for a new selection; an existing Contract keeps its reference",
    "Archive the chosen Entity; Our entity still shows it on the Contract; another Contract does not offer it.",
    async () => {
      await go(page, `/entities/${entityId}`);
      await page.getByRole("button", { name: "Archive", exact: true }).click();
      await settle(page);
      const other = await fixtureContract(s, `${prefix} second contract`);
      await go(page, `/contracts/${contract.number}`);
      const kept = tidy(await our().locator("option:checked").innerText());
      await go(page, `/contracts/${other.number}`);
      const values = await our()
        .locator("option")
        .evaluateAll((os) => os.map((o) => o.value));
      const offered = (await our().locator("option").allInnerTexts()).filter((o) => o.includes(legalName));
      await go(page, `/entities/${entityId}`);
      await page.getByRole("button", { name: "Restore", exact: true }).click();
      await settle(page);
      expect(
        kept.includes(legalName) && offered.length === 1 && !values.includes(entityId),
        q({ kept, offered, archivedOffered: values.includes(entityId) }),
      );
      return `With the first ${q(legalName)} archived, C-${contract.number} still showed ${q(kept)}. On C-${other.number} Our entity offered ${offered.length} option with that name, the live duplicate, not the archived record. The Entity was then restored.`;
    },
  );
}

async function c31BusinessUser() {
  current = { article: "entities-and-counterparties", scenario: "V-C31" };
  let s;
  await step(
    "business_user (Diego Salas, magic link)",
    (contexts.administrator ?? Object.values(contexts)[0]).page,
    "Negative: a Business User cannot open the staff Entities destination; an Entities address returns them to their home page",
    "No Entities navigation; /entities and /entities/<id> land on the home page; the Entities API refuses.",
    async () => {
      s = await session("business_user");
      const { page } = s;
      await go(page, "/");
      const home = new URL(page.url()).pathname;
      const nav = await page.getByRole("link", { name: "Entities", exact: true }).count();
      await go(page, "/entities");
      const landed = new URL(page.url()).pathname;
      const any = (await (await session("administrator")).api("GET", "/entities?limit=1")).json
        .entities[0];
      await go(page, `/entities/${any.id}`);
      const landedRecord = new URL(page.url()).pathname;
      const r = await s.api("GET", "/entities");
      expect(
        nav === 0 && landed === home && landedRecord === home && r.status === 403,
        q({ home, nav, landed, landedRecord, api: r.status }),
      );
      return `Signed in with a fresh magic link as ${s.person.name}. Home was ${home}; no Entities link. /entities landed on ${landed}; an Entity record address landed on ${landedRecord}; GET /api/v1/entities returned ${r.status}.`;
    },
  );
}

// =====================================================================
// V-C32 entity-records
// =====================================================================
async function c32(R) {
  current = { article: "entity-records", scenario: "V-C32" };
  const s = await session(R);
  const { page } = s;
  const who = R === "administrator" ? "A" : "L";
  const prefix = `DOC-030 entities V-C32 ${TAG} ${who}`;
  const main = await fixtureEntity(s, `${prefix} main`, { jurisdiction: "Republic of Aldoria" });
  const owned = await fixtureEntity(s, `${prefix} owned`);
  const third = await fixtureEntity(s, `${prefix} third`);
  const coOwner = await fixtureEntity(s, `${prefix} co-owner`);
  const officer = `Ines Castell ${who} ${TAG}`;
  const person = `Mara Quill ${who} ${TAG}`;
  const other = R === "administrator" ? "Nadia Haddad" : "Daniel Okafor";
  const body = page.getByRole("main");

  await step(
    R,
    page,
    "Officers steps 1-3: Directors & Officers, Add director or officer, name, Role, Appointed on, Linked user, Add",
    "The Officer row saves name, role, date and linked user.",
    async () => {
      await go(page, `/entities/${main.id}`);
      const card = section(page, "Directors & Officers");
      await card.getByRole("button", { name: "Add director or officer" }).click();
      await card.getByLabel("Director or officer name", { exact: true }).fill(officer);
      await card.getByLabel("Role", { exact: true }).selectOption({ label: "Director" });
      await card.getByLabel("Appointed on", { exact: true }).fill("2022-05-09");
      await card.getByLabel("Linked user", { exact: true }).selectOption({ label: other });
      await card.getByRole("button", { name: "Add", exact: true }).click();
      await settle(page);
      await reload(page);
      const c = section(page, "Directors & Officers");
      const row = {
        name: await c.getByLabel(`${officer} Director or officer name`).inputValue(),
        role: tidy(await c.getByLabel(`${officer} Role`).locator("option:checked").innerText()),
        appointed: await c.getByLabel(`${officer} Appointed on`).inputValue(),
        user: tidy(await c.getByLabel(`${officer} Linked user`).locator("option:checked").innerText()),
      };
      expect(
        row.name === officer && row.role === "Director" && row.appointed === "2022-05-09" && row.user === other,
        q(row),
      );
      return `After Add and a reload the row read ${q(row)}.`;
    },
  );

  await step(
    R,
    page,
    "Officers step 4: correct text and move focus away; choosing another role saves",
    "Name edit saves on blur; Role selection saves at once.",
    async () => {
      const card = section(page, "Directors & Officers");
      await card.getByLabel(`${officer} Director or officer name`).fill(`${officer} Jr`);
      await blurTo(page, "Directors & Officers");
      await reload(page);
      const renamed = await section(page, "Directors & Officers")
        .getByLabel(`${officer} Jr Director or officer name`)
        .inputValue();
      await section(page, "Directors & Officers")
        .getByLabel(`${officer} Jr Director or officer name`)
        .fill(officer);
      await blurTo(page, "Directors & Officers");
      await section(page, "Directors & Officers")
        .getByLabel(`${officer} Role`)
        .selectOption({ label: "Secretary" });
      await settle(page);
      await reload(page);
      const role = tidy(
        await section(page, "Directors & Officers")
          .getByLabel(`${officer} Role`)
          .locator("option:checked")
          .innerText(),
      );
      expect(renamed === `${officer} Jr` && role === "Secretary", `renamed=${renamed} role=${role}`);
      return `The name saved as ${q(renamed)} on blur and was set back; Role Secretary saved on selection and read ${role} after a reload.`;
    },
  );

  await step(
    R,
    page,
    "Negative: a resignation date before the appointment date is refused",
    "Refusal message; the appointment date is unchanged and no resignation is stored.",
    async () => {
      const card = section(page, "Directors & Officers");
      await card.getByLabel(`${officer} Resigned on`).fill("2021-01-01");
      await blurTo(page, "Directors & Officers");
      const message = tidy(
        await page
          .getByText(/resignation date cannot be before/i)
          .first()
          .innerText()
          .catch(() => ""),
      );
      await reload(page);
      const c = section(page, "Directors & Officers");
      const appointed = await c.getByLabel(`${officer} Appointed on`).inputValue();
      const resigned = await c.getByLabel(`${officer} Resigned on`).inputValue();
      expect(message && appointed === "2022-05-09" && resigned === "", q({ message, appointed, resigned }));
      return `Resigned on 2021-01-01 showed ${q(message)}. After a reload Appointed on was ${appointed} and Resigned on was empty.`;
    },
  );

  await step(
    R,
    page,
    "Officers step 5: Resigned on keeps a resignation; Show former reads former Officers; clearing the date returns the Officer",
    "The resigned Officer leaves the current list, returns with Show former, and clearing the date restores it.",
    async () => {
      let card = section(page, "Directors & Officers");
      await card.getByLabel(`${officer} Resigned on`).fill("2024-08-31");
      await blurTo(page, "Directors & Officers");
      await reload(page);
      card = section(page, "Directors & Officers");
      const currentCount = await card.getByLabel(`${officer} Director or officer name`).count();
      await card.getByLabel("Show former").check();
      await settle(page);
      const former = await card.getByLabel(`${officer} Resigned on`).inputValue();
      await card.getByLabel(`${officer} Resigned on`).fill("");
      await blurTo(page, "Directors & Officers");
      await reload(page);
      const back = await section(page, "Directors & Officers")
        .getByLabel(`${officer} Director or officer name`)
        .count();
      expect(currentCount === 0 && former === "2024-08-31" && back === 1, q({ currentCount, former, back }));
      return `With Resigned on 2024-08-31 the Officer left the current list (${currentCount} rows). Show former showed it with ${former}. Clearing the date and reloading returned it to the current list (${back} row).`;
    },
  );

  await step(
    R,
    page,
    "Officer note: linking a user does not grant that person Entity access",
    "The linked user gains no Grant on the Entity.",
    async () => {
      const grants = await s.api("GET", `/entities/${main.id}/grants`);
      const names = (grants.json?.grants ?? []).map((g) => g.displayName);
      expect(!names.includes(other), `grants ${q(names)}`);
      return `The Entity's access list named ${q(names)}; the linked user ${other} held no Grant. (The effect on a Confidential Entity is checked in V-C53.)`;
    },
  );

  await step(
    R,
    page,
    "Officer note: the remove control, labelled Remove <name>, deletes the Officer entry",
    "The Officer is absent even with Show former.",
    async () => {
      const card = section(page, "Directors & Officers");
      await card.getByRole("button", { name: `Remove ${officer}` }).click();
      await settle(page);
      await reload(page);
      const c = section(page, "Directors & Officers");
      await c.getByLabel("Show former").check();
      await settle(page);
      const count = await c.getByLabel(`${officer} Director or officer name`).count();
      expect(count === 0, `still ${count}`);
      return `After Remove ${officer} and a reload, Show former listed no row for it.`;
    },
  );

  const jur = `Nordvik ${who} ${TAG}`;
  const obligationLabel = `${prefix} licence renewal`;
  await step(
    R,
    page,
    "Registrations steps 1-3: Add registration with Jurisdiction, Registration number, Registered agent, Status Lapsed; Formation jurisdiction unchanged",
    "The row saves; the Entity's Formation jurisdiction stays the same.",
    async () => {
      const card = section(page, "Registrations");
      await card.getByRole("button", { name: "Add registration" }).click();
      await card.getByLabel("Jurisdiction", { exact: true }).fill(jur);
      await card.getByLabel("Registration number", { exact: true }).fill(`NV-${TAG}`);
      await card.getByLabel("Registered agent", { exact: true }).fill("Nordvik Agents AS");
      await card.getByLabel("Status", { exact: true }).selectOption({ label: "Lapsed" });
      await card.getByRole("button", { name: "Add", exact: true }).click();
      await settle(page);
      await reload(page);
      const c = section(page, "Registrations");
      const row = {
        number: await c.getByLabel(`${jur} Registration number`).inputValue(),
        agent: await c.getByLabel(`${jur} Registered agent`).inputValue(),
        status: tidy(await c.getByLabel(`${jur} Status`).locator("option:checked").innerText()),
      };
      const formation = await body.getByLabel("Formation jurisdiction", { exact: true }).inputValue();
      expect(row.number === `NV-${TAG}` && row.status === "Lapsed" && formation === "Republic of Aldoria", `${q(row)} ${formation}`);
      return `The Registration ${jur} saved ${q(row)}. Formation jurisdiction still read ${q(formation)}.`;
    },
  );

  await step(
    R,
    page,
    "Registrations step 3: edit text and move focus away; a Status selection saves immediately",
    "Agent saves on blur; Withdrawn saves on selection.",
    async () => {
      const card = section(page, "Registrations");
      await card.getByLabel(`${jur} Registered agent`).fill("Nordvik Corporate Agents AS");
      await blurTo(page, "Registrations");
      await section(page, "Registrations").getByLabel(`${jur} Status`).selectOption({ label: "Withdrawn" });
      await settle(page);
      await reload(page);
      const c = section(page, "Registrations");
      const agent = await c.getByLabel(`${jur} Registered agent`).inputValue();
      const status = tidy(await c.getByLabel(`${jur} Status`).locator("option:checked").innerText());
      expect(agent === "Nordvik Corporate Agents AS" && status === "Withdrawn", `${agent} ${status}`);
      return `After a reload Registered agent read ${q(agent)} and Status read ${status}.`;
    },
  );

  await step(
    R,
    page,
    "Registrations step 4 and note: Remove <jurisdiction> registration deletes it and detaches, but keeps, a linked Obligation",
    "The Obligation linked to the Registration remains with no Registration link.",
    async () => {
      await go(page, `/entities/${main.id}/obligations`);
      await page.getByRole("button", { name: "Add obligation" }).click();
      const dialog = page.getByRole("dialog", { name: "Add obligation" });
      await dialog.getByLabel("Label", { exact: true }).fill(obligationLabel);
      await dialog.getByLabel("Due date", { exact: true }).fill("2027-03-31");
      await dialog.getByLabel("Registration", { exact: true }).selectOption({ label: `${jur} · NV-${TAG}` });
      await dialog.getByRole("button", { name: "Add obligation" }).click();
      await dialog.waitFor({ state: "hidden" });
      await go(page, `/entities/${main.id}`);
      await section(page, "Registrations").getByRole("button", { name: `Remove ${jur} registration` }).click();
      await settle(page);
      await reload(page);
      const gone = (await section(page, "Registrations").getByLabel(`${jur} Registration number`).count()) === 0;
      await go(page, `/entities/${main.id}/obligations`);
      const row = tidy(await page.locator("main table tbody tr", { hasText: obligationLabel }).first().innerText());
      const api = await s.api("GET", `/entities/${main.id}/obligations`);
      const kept = (api.json?.obligations ?? []).find((o) => o.label === obligationLabel);
      expect(gone && kept && kept.registration === null, q({ gone, kept }));
      return `An Obligation ${q(obligationLabel)} was linked to ${jur}. Remove ${jur} registration deleted the row; the Obligation stayed on the Entity (${q(row)}) with no Registration link.`;
    },
  );

  await step(
    R,
    page,
    "Holdings intro and step 1: the Ownership tab opens with the share register; Add Holding sits below Holdings in other Entities; Owner type Entity; Ownership percent starts at 100",
    "No share register yet shows first; Add Holding is below Holdings in other Entities; the dialog defaults to Entity and 100.",
    async () => {
      await go(page, `/entities/${main.id}/ownership`);
      const empty = await page.getByRole("heading", { name: "No share register yet" }).isVisible();
      const heading = page.getByRole("heading", { name: "Holdings in other Entities", exact: true });
      const hBox = await heading.boundingBox();
      const add = page.getByRole("button", { name: "Add Holding" });
      const aBox = await add.boundingBox();
      const declaredCard = await page.getByRole("heading", { name: "Declared owners not in the register" }).count();
      await add.click();
      const dialog = page.getByRole("dialog", { name: "Add Holding" });
      await dialog.waitFor();
      const entityChecked = await dialog.getByRole("radio", { name: "Entity" }).isChecked();
      const individualOffered = await dialog.getByRole("radio", { name: "Individual" }).count();
      const percent = await dialog.getByLabel("Ownership percent").inputValue();
      const relationships = (await dialog.getByLabel("Relationship").locator("option").allInnerTexts()).map(tidy);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      expect(
        empty && hBox && aBox && aBox.y > hBox.y && declaredCard === 0 && entityChecked && individualOffered === 1 && percent === "100" &&
          q(relationships) === q(["Owns this Entity", "This Entity owns"]),
        q({ empty, hBox, aBox, declaredCard, entityChecked, percent, relationships }),
      );
      return `The Ownership tab showed "No share register yet" and no Declared owners card. Add Holding sat below the Holdings in other Entities heading (y ${Math.round(aBox.y)} > ${Math.round(hBox.y)}). The dialog opened with Owner type Entity selected, Individual offered, Relationship ${q(relationships)}, and Ownership percent ${percent}.`;
    },
  );

  await step(
    R,
    page,
    "Holdings steps 2-3, 5: This Entity owns another Entity; it appears under Holdings in other Entities; the owned Entity lists the owner under Declared owners not in the register",
    "60% Holding shows on both records.",
    async () => {
      await addHolding(page, { relationship: "This Entity owns", entity: owned.legalName, percent: "60" });
      await reload(page);
      const ownedList = await sectionText(page, "Holdings in other Entities");
      await go(page, `/entities/${owned.id}/ownership`);
      const owners = await sectionText(page, "Declared owners not in the register");
      const pct = await page.getByLabel(`${main.legalName} ownership percent`).inputValue();
      expect(ownedList.includes(owned.legalName) && owners?.includes(main.legalName) && pct === "60", q({ ownedList, owners, pct }));
      return `${main.legalName} listed ${owned.legalName} under Holdings in other Entities. ${owned.legalName} showed the card "Declared owners not in the register" with ${main.legalName} at ${pct}%.`;
    },
  );

  await step(
    R,
    page,
    "Holdings: Owns this Entity direction; a total over 100% warns but saves; correcting the row on blur clears the warning",
    "Second owner at 60% saves with 'Ownership totals 120% for <name>.'; changing it to 30 clears the warning.",
    async () => {
      await addHolding(page, { relationship: "Owns this Entity", entity: coOwner.legalName, percent: "60" });
      const warning = `Ownership totals 120% for ${owned.legalName}.`;
      const warned = await page.getByText(warning).isVisible();
      await reload(page);
      const saved = await page.getByLabel(`${coOwner.legalName} ownership percent`).inputValue();
      await page.getByLabel(`${coOwner.legalName} ownership percent`).fill("30");
      await blurTo(page, "Declared owners not in the register");
      await reload(page);
      const corrected = await page.getByLabel(`${coOwner.legalName} ownership percent`).inputValue();
      const still = await page.getByText(/Ownership totals/).count();
      expect(warned && saved === "60" && corrected === "30" && still === 0, q({ warned, saved, corrected, still }));
      return `Adding ${coOwner.legalName} as owner at 60% showed ${q(warning)} and saved (${saved} after reload). Changing that row to 30 and moving focus saved ${corrected} and no total warning remained.`;
    },
  );

  await step(
    R,
    page,
    "Holdings step 4: Owner type Individual, Full name, Ownership percent, Add; no Entity or account; percent correction saves",
    "The individual appears under Declared owners not in the register with the Individual label; a corrected percent saves on blur.",
    async () => {
      await page.getByRole("button", { name: "Add Holding" }).click();
      const dialog = page.getByRole("dialog", { name: "Add Holding" });
      await dialog.getByRole("radio", { name: "Individual" }).check();
      const relationshipShown = await dialog.getByLabel("Relationship").count();
      await dialog.getByLabel("Full name").fill(person);
      await dialog.getByLabel("Ownership percent").fill("10");
      await dialog.getByRole("button", { name: "Add", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 10000 });
      await settle(page);
      await reload(page);
      const owners = await sectionText(page, "Declared owners not in the register");
      await page.getByLabel(`${person} ownership percent`).fill("12");
      await blurTo(page, "Declared owners not in the register");
      await reload(page);
      const pct = await page.getByLabel(`${person} ownership percent`).inputValue();
      const warn = tidy(await page.getByText(/Ownership totals/).first().innerText().catch(() => ""));
      await page.getByLabel(`${person} ownership percent`).fill("10");
      await blurTo(page, "Declared owners not in the register");
      const found = await s.api("GET", `/entities?q=${encodeURIComponent(person)}`);
      expect(
        relationshipShown === 0 && owners.includes(`${person} Individual`) && pct === "12" &&
          warn === `Ownership totals 102% for ${owned.legalName}.` && (found.json?.entities ?? []).length === 0,
        q({ relationshipShown, owners, pct, warn }),
      );
      return `Choosing Individual hid Relationship; Full name ${q(person)} at 10% was added. Declared owners read ${q(owners)}. Changing it to 12 saved on blur (${pct} after reload, with ${q(warn)}); it was set back to 10. No Entity record was created for the person.`;
    },
  );

  await step(
    R,
    page,
    "Negative: an out-of-range row percentage is refused without changing saved values",
    "150 is refused; the rows keep 30 and 60 after reload.",
    async () => {
      await page.getByLabel(`${coOwner.legalName} ownership percent`).fill("150");
      await blurTo(page, "Declared owners not in the register");
      const alerts = (await page.getByRole("alert").allInnerTexts()).map(tidy).join(" | ");
      await reload(page);
      const value = await page.getByLabel(`${coOwner.legalName} ownership percent`).inputValue();
      const other = await page.getByLabel(`${main.legalName} ownership percent`).inputValue();
      expect(value === "30" && other === "60" && alerts.length > 0, q({ value, other, alerts }));
      return `Entering 150 showed ${q(alerts)}. After a reload the row still read ${value} and the other Holding ${other}.`;
    },
  );

  await step(
    R,
    page,
    "Holdings note: an Entity cannot own itself, duplicate a directional Holding, or create an ownership loop",
    "Self and existing related Entities are not offered; a loop is refused with a message.",
    async () => {
      await page.getByRole("button", { name: "Add Holding" }).click();
      const dialog = page.getByRole("dialog", { name: "Add Holding" });
      await dialog.getByRole("combobox", { name: "Entity" }).fill(prefix);
      const options = (await dialog.getByRole("listbox", { name: "Entity matches" }).getByRole("option").allInnerTexts()).map(tidy);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      expect(!options.includes(owned.legalName) && !options.includes(main.legalName) && options.includes(third.legalName), `options ${q(options)}`);
      // owned owns third; then third owning main closes main -> owned -> third -> main.
      await addHolding(page, { relationship: "This Entity owns", entity: third.legalName, percent: "100" });
      await go(page, `/entities/${main.id}/ownership`);
      await page.getByRole("button", { name: "Add Holding" }).click();
      const loop = page.getByRole("dialog", { name: "Add Holding" });
      await loop.getByLabel("Relationship").selectOption({ label: "Owns this Entity" });
      await loop.getByRole("combobox", { name: "Entity" }).fill(third.legalName);
      await loop.getByRole("option", { name: third.legalName }).click();
      await loop.getByLabel("Ownership percent").fill("10");
      await loop.getByRole("button", { name: "Add", exact: true }).click();
      const alert = loop.getByRole("alert");
      await alert.waitFor({ timeout: 8000 });
      const message = tidy(await alert.innerText());
      await loop.getByRole("button", { name: "Cancel" }).click();
      await reload(page);
      const declared = await sectionText(page, "Declared owners not in the register");
      expect(!declared, `loop saved ${declared}`);
      return `On ${owned.legalName} the picker for ${q(prefix)} offered ${q(options)}: not itself and not ${main.legalName}, which already holds it. Adding ${third.legalName} as owner of ${main.legalName} (closing a loop through ${owned.legalName}) was refused with ${q(message)} and no owner row was added.`;
    },
  );

  await step(
    R,
    page,
    "Holdings step 6: the remove control, labelled Remove <other party>, removes the Holding; neither Entity is deleted",
    "The Holding and the individual leave the list; the co-owner still opens.",
    async () => {
      await go(page, `/entities/${owned.id}/ownership`);
      await page.getByRole("button", { name: `Remove ${coOwner.legalName}` }).click();
      await settle(page);
      await page.getByRole("button", { name: `Remove ${person}` }).click();
      await settle(page);
      await reload(page);
      const owners = await sectionText(page, "Declared owners not in the register");
      await go(page, `/entities/${coOwner.id}`);
      const opens = await page.getByRole("heading", { level: 1, name: coOwner.legalName }).isVisible();
      expect(!owners.includes(coOwner.legalName) && !owners.includes(person) && opens, q({ owners, opens }));
      return `After Remove ${coOwner.legalName} and Remove ${person}, the Declared owners card on ${owned.legalName} read ${q(owners)}; ${coOwner.legalName} still opened.`;
    },
  );

  await step(
    R,
    page,
    "Documents: a new Entity has no pre-created folders; Upload lands a Document on this Entity only",
    "Empty Documents tab; the upload is listed on this Entity and not on another.",
    async () => {
      await go(page, `/entities/${main.id}/documents`);
      const empty = await page.getByText("No documents on this Entity yet.").isVisible();
      const folders = await page.getByRole("button", { name: /^Actions for the .* folder$/ }).count();
      await page.getByRole("button", { name: "Upload", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Upload document" });
      await dialog.waitFor();
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        dialog.getByText("Choose files", { exact: true }).click(),
      ]);
      await chooser.setFiles(path.join(here, "fixtures", "doc030-entities-register-extract.pdf"));
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      await reload(page);
      const row = tidy(await page.locator("main table tbody tr", { hasText: "doc030-entities-register-extract" }).first().innerText());
      await go(page, `/entities/${owned.id}/documents`);
      const sibling = await page.getByText("doc030-entities-register-extract").count();
      expect(empty && folders === 0 && row && sibling === 0, q({ empty, folders, row, sibling }));
      return `The Documents tab first showed "No documents on this Entity yet." and ${folders} folders. Upload produced the row ${q(row)}. ${owned.legalName} did not list it.`;
    },
  );

  await step(
    R,
    page,
    "Archive step 1: Archive saves immediately; Archived mark; editable controls, including the share register and Add Holding, become unavailable",
    "Archived mark and restore note; Legal name disabled; add buttons absent or disabled; a register write is refused.",
    async () => {
      await go(page, `/entities/${main.id}`);
      await page.getByRole("button", { name: "Archive", exact: true }).click();
      await settle(page);
      await reload(page);
      const mark = await page.getByText("Archived", { exact: true }).first().isVisible();
      const note = await page.getByText("This entity is archived. Restore it to edit.").isVisible();
      const nameDisabled = await body.getByLabel("Legal name", { exact: true }).isDisabled();
      const addOfficer = await page.getByRole("button", { name: "Add director or officer" }).count();
      const addRegistration = await page.getByRole("button", { name: "Add registration" }).count();
      await go(page, `/entities/${main.id}/obligations`);
      const addObligation = await page.getByRole("button", { name: "Add obligation" }).count();
      await go(page, `/entities/${main.id}/ownership`);
      const newClass = await page.getByRole("button", { name: "New share class" }).isDisabled();
      const addHoldingDisabled = await page.getByRole("button", { name: "Add Holding" }).isDisabled();
      const write = await s.api("POST", `/entities/${main.id}/share-classes`, { name: "Ordinary", votesPerShare: 1 });
      expect(
        mark && note && nameDisabled && addOfficer === 0 && addRegistration === 0 && addObligation === 0 && newClass && addHoldingDisabled && write.status === 409,
        q({ mark, note, nameDisabled, addOfficer, addRegistration, addObligation, newClass, addHoldingDisabled, write }),
      );
      return `After Archive and a reload the record showed the Archived mark and "This entity is archived. Restore it to edit.". Legal name was disabled; Add director or officer, Add registration and Add obligation were absent. On Ownership, New share class and Add Holding were disabled, and a share-class write was refused ${write.status} ${q(write.json?.detail)}.`;
    },
  );

  await step(
    R,
    page,
    "Archive: the archived Entity leaves ordinary registry and Holding picker results",
    "Not in a List search without Show archived; not offered in Add Holding.",
    async () => {
      await go(page, "/entities?view=list");
      await page.getByRole("searchbox", { name: "Search entities by name" }).fill(main.legalName);
      await settle(page);
      const hidden = await page.locator("main table tbody").getByRole("link", { name: main.legalName }).count();
      await go(page, `/entities/${coOwner.id}/ownership`);
      await page.getByRole("button", { name: "Add Holding" }).click();
      const dialog = page.getByRole("dialog", { name: "Add Holding" });
      await dialog.getByRole("combobox", { name: "Entity" }).fill(prefix);
      const options = (await dialog.getByRole("listbox", { name: "Entity matches" }).getByRole("option").allInnerTexts()).map(tidy);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      expect(hidden === 0 && !options.includes(main.legalName), q({ hidden, options }));
      return `The List search found ${hidden} rows for the archived Entity, and Add Holding on ${coOwner.legalName} offered ${q(options)}, without it.`;
    },
  );

  await step(
    R,
    page,
    "Archive steps 2-3: List, Filter, Show archived, open the Entity, Restore; facts, relationships, Documents and Obligation remain; editing returns",
    "Show archived lists it; Restore brings back editing with data intact.",
    async () => {
      await go(page, "/entities?view=list");
      await applyFilter(page, page.getByLabel("Record filters"), "Show archived");
      const chip = (await page.getByLabel("Record filters").getByRole("button").allInnerTexts()).map(tidy);
      await page.getByRole("searchbox", { name: "Search entities by name" }).fill(main.legalName);
      await settle(page);
      const link = page.locator("main table tbody").getByRole("link", { name: main.legalName });
      const listed = await link.count();
      await link.first().click();
      await settle(page);
      await page.getByRole("button", { name: "Restore", exact: true }).click();
      await settle(page);
      await reload(page);
      const editable = await body.getByLabel("Legal name", { exact: true }).isEnabled();
      const addOfficer = await page.getByRole("button", { name: "Add director or officer" }).count();
      const formation = await body.getByLabel("Formation jurisdiction", { exact: true }).inputValue();
      await go(page, `/entities/${main.id}/ownership`);
      const ownedList = await sectionText(page, "Holdings in other Entities");
      const newClass = await page.getByRole("button", { name: "New share class" }).isEnabled();
      await go(page, `/entities/${main.id}/documents`);
      const doc = await page.getByText("doc030-entities-register-extract").count();
      await go(page, `/entities/${main.id}/obligations`);
      const obligation = await page.locator("main table tbody tr", { hasText: obligationLabel }).count();
      expect(
        listed === 1 && editable && addOfficer === 1 && formation === "Republic of Aldoria" && ownedList.includes(owned.legalName) && newClass && doc > 0 && obligation === 1,
        q({ chip, listed, editable, addOfficer, formation, ownedList, newClass, doc, obligation }),
      );
      return `Filter, then Show archived, added the chip ${q(chip.find((c) => /Show archived/.test(c)))} and the List showed ${listed} row for it. Restore returned an editable Legal name, Add director or officer and New share class. Formation jurisdiction ${q(formation)}, the Holding of ${owned.legalName}, the uploaded Document, and the Obligation all remained.`;
    },
  );
}
async function addHolding(page, { relationship, entity, percent }) {
  await page.getByRole("button", { name: "Add Holding" }).click();
  const dialog = page.getByRole("dialog", { name: "Add Holding" });
  await dialog.getByLabel("Relationship").selectOption({ label: relationship });
  await dialog.getByRole("combobox", { name: "Entity" }).fill(entity);
  await dialog.getByRole("option", { name: entity, exact: true }).click();
  await dialog.getByLabel("Ownership percent").fill(percent);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await dialog.waitFor({ state: "hidden", timeout: 10000 });
  await settle(page);
}
async function addIndividual(page, name, percent) {
  await page.getByRole("button", { name: "Add Holding" }).click();
  const dialog = page.getByRole("dialog", { name: "Add Holding" });
  await dialog.getByRole("radio", { name: "Individual" }).check();
  await dialog.getByLabel("Full name").fill(name);
  await dialog.getByLabel("Ownership percent").fill(percent);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await dialog.waitFor({ state: "hidden", timeout: 10000 });
  await settle(page);
}

// =====================================================================
// V-C52 entity-obligations
// =====================================================================
async function obligationRow(page, label) {
  const table = page.locator("main table").first();
  const headers = (await table.locator("thead th").allInnerTexts()).map(tidy);
  const row = table.locator("tbody tr", { hasText: label }).first();
  const cells = (await row.locator("td").allInnerTexts()).map(tidy);
  const out = {};
  headers.forEach((h, i) => (out[h || `col${i}`] = cells[i]));
  return out;
}
async function apiObligation(s, entityId, label) {
  const r = await s.api("GET", `/entities/${entityId}/obligations`);
  return (r.json?.obligations ?? []).find((o) => o.label === label) ?? null;
}
async function rowMenu(page, label, item) {
  await page.getByRole("button", { name: `Actions for ${label}` }).click();
  await page.getByRole("menuitem", { name: item }).click();
}
async function homeObligations(page) {
  await go(page, "/");
  const sec = page.locator("section", { has: page.locator("#home-obligations-heading") });
  if (!(await sec.count())) return [];
  return (await sec.getByRole("listitem").allInnerTexts()).map(tidy);
}

async function c52(R) {
  current = { article: "entity-obligations", scenario: "V-C52" };
  const s = await session(R);
  const { page } = s;
  const who = R === "administrator" ? "A" : "L";
  const otherKey = R === "administrator" ? "legal_team_member" : "administrator";
  const o = await session(otherKey);
  const prefix = `DOC-030 entities V-C52 ${TAG} ${who}`;
  const entity = await fixtureEntity(s, `${prefix} entity`);
  const second = await fixtureEntity(s, `${prefix} second entity`);
  const annual = `${prefix} annual return`;
  const oneOff = `${prefix} one-off licence`;
  const unassigned = `${prefix} unassigned review`;
  const scrap = `${prefix} scrap schedule`;
  const restricted = `${prefix} restricted link`;
  const me = s.person.name;
  const jur = `Kessel ${who} ${TAG}`;
  let matterLabel = null;

  await s.api("POST", `/entities/${entity.id}/registrations`, { jurisdiction: jur, registrationNumber: `KS-${TAG}`, status: "active" });
  fixture(`Registration ${jur} on ${entity.legalName}`, `POST /entities/:id/registrations as ${me}`);
  await s.api("POST", `/entities/${second.id}/obligations`, { label: `${prefix} second table row`, nextDueOn: "2027-02-28" });
  fixture(`Obligation on ${second.legalName}`, `POST /entities/:id/obligations as ${me}`);
  // A Confidential Matter that only the other role reaches, linked by that role.
  const matterTypes = await o.api("GET", "/matters?limit=1");
  const types = await (await session("administrator")).api("GET", "/matter-types");
  const commercial = types.json.matterTypes.find((t) => t.displayName === "Commercial");
  const created = await o.api("POST", "/matters", {
    title: `${prefix} confidential matter`,
    matterTypeId: commercial.id,
    managerId: null,
    isConfidential: true,
  });
  expect(created.status === 201, `matter fixture ${created.status} ${q(created.json)}`);
  const matter = created.json.matter;
  const linked = await o.api("POST", `/entities/${entity.id}/obligations`, {
    label: restricted,
    nextDueOn: "2027-05-31",
    matterId: matter.id,
  });
  expect(linked.status === 201, `restricted obligation fixture ${linked.status} ${q(linked.json)}`);
  fixture(`Confidential Matter M-${matter.number} and Obligation ${restricted} linked to it`, `POST /matters and POST /entities/:id/obligations as ${o.person.name}`);
  void matterTypes;

  async function openAdd() {
    await page.getByRole("button", { name: "Add obligation" }).click();
    const dialog = page.getByRole("dialog", { name: "Add obligation" });
    await dialog.waitFor();
    return dialog;
  }

  await step(
    R,
    page,
    "Add steps 1-4: recurring Obligation with Registration, Assignee, Matter and Note",
    "The row shows the due date, recurrence and links.",
    async () => {
      await go(page, `/entities/${entity.id}/obligations`);
      const dialog = await openAdd();
      await dialog.getByLabel("Label", { exact: true }).fill(annual);
      await dialog.getByLabel("Due date", { exact: true }).fill("2015-09-30");
      await dialog.getByLabel("Repeat every (months)", { exact: true }).fill("12");
      await dialog.getByLabel("Registration", { exact: true }).selectOption({ label: `${jur} · KS-${TAG}` });
      await dialog.getByLabel("Assignee", { exact: true }).selectOption({ label: me });
      const matterOptions = (await dialog.getByLabel("Matter", { exact: true }).locator("option").allInnerTexts()).map(tidy);
      matterLabel = matterOptions.find((x) => x !== "None");
      expect(matterLabel, "no reachable Matter offered");
      const offersConfidential = matterOptions.some((x) => x.includes(`${prefix} confidential matter`));
      await dialog.getByLabel("Matter", { exact: true }).selectOption({ label: matterLabel });
      await dialog.getByLabel("Note", { exact: true }).fill("Fictional annual return for the walkthrough.");
      await dialog.getByRole("button", { name: "Add obligation" }).click();
      await dialog.waitFor({ state: "hidden" });
      await reload(page);
      const row = await obligationRow(page, annual);
      const api = await apiObligation(s, entity.id, annual);
      expect(
        api.nextDueOn === "2015-09-30" && api.recurrenceMonths === 12 && api.registration?.jurisdiction === jur && api.assignee?.displayName === me && row.Matter === matterLabel && !offersConfidential,
        q({ row, api }),
      );
      return `After Add obligation and a reload the row read ${q(row)}. The Matter list offered ${matterOptions.length - 1} reachable Matters and not the other role's Confidential Matter.`;
    },
  );

  await step(
    R,
    page,
    "Add step 2: a blank recurrence makes a one-off",
    "The one-off row has no recurrence.",
    async () => {
      const dialog = await openAdd();
      await dialog.getByLabel("Label", { exact: true }).fill(oneOff);
      await dialog.getByLabel("Due date", { exact: true }).fill("2026-11-20");
      await dialog.getByLabel("Assignee", { exact: true }).selectOption({ label: me });
      await dialog.getByRole("button", { name: "Add obligation" }).click();
      await dialog.waitFor({ state: "hidden" });
      await reload(page);
      const row = await obligationRow(page, oneOff);
      const api = await apiObligation(s, entity.id, oneOff);
      expect(api.nextDueOn === "2026-11-20" && api.recurrenceMonths === null, q({ row, api }));
      return `The one-off saved with due ${api.nextDueOn} and no recurrence; its row read ${q(row)}.`;
    },
  );

  await step(
    R,
    page,
    "Negative: recurrence outside 1 to 1,200 months and a blank Label are refused",
    "1201 and 0 keep the dialog open with a message; a blank Label does not submit; nothing is created.",
    async () => {
      const outcomes = [];
      for (const months of ["1201", "0"]) {
        const dialog = await openAdd();
        await dialog.getByLabel("Label", { exact: true }).fill(`${prefix} bad recurrence ${months}`);
        await dialog.getByLabel("Due date", { exact: true }).fill("2027-01-31");
        await dialog.getByLabel("Repeat every (months)", { exact: true }).fill(months);
        await dialog.getByRole("button", { name: "Add obligation" }).click();
        await wait(1500);
        const alert = tidy((await dialog.getByRole("alert").allInnerTexts()).join(" "));
        const invalid = await dialog.getByLabel("Repeat every (months)", { exact: true }).evaluate((e) => e.validationMessage);
        outcomes.push({ months, open: await dialog.isVisible(), message: alert || invalid });
        await dialog.getByRole("button", { name: "Cancel" }).click();
        await dialog.waitFor({ state: "hidden" });
      }
      const dialog = await openAdd();
      await dialog.getByLabel("Due date", { exact: true }).fill("2027-01-31");
      await dialog.getByRole("button", { name: "Add obligation" }).click();
      await wait(1000);
      const blankOpen = await dialog.isVisible();
      const blankMessage = await dialog.getByLabel("Label", { exact: true }).evaluate((e) => e.validationMessage);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      const list = await s.api("GET", `/entities/${entity.id}/obligations`);
      const leaked = (list.json.obligations ?? []).filter((x) => /bad recurrence/.test(x.label));
      expect(outcomes.every((x) => x.open && x.message) && blankOpen && blankMessage && leaked.length === 0, q({ outcomes, blankOpen, blankMessage, leaked }));
      return `Outcomes ${q(outcomes)}. A blank Label kept the dialog open (${q(blankMessage)}). No bad-recurrence Obligation was stored.`;
    },
  );

  await step(
    R,
    page,
    "Add step 5: the menu beside Mark complete, Edit, Save changes; Cancel discards",
    "Edit obligation saves the note with Save changes; a Cancelled assignee change is not stored.",
    async () => {
      await rowMenu(page, oneOff, "Edit");
      let dialog = page.getByRole("dialog", { name: "Edit obligation" });
      await dialog.waitFor();
      await dialog.getByLabel("Note", { exact: true }).fill("Renew before the end of November.");
      await dialog.getByRole("button", { name: "Save changes" }).click();
      await dialog.waitFor({ state: "hidden" });
      await rowMenu(page, oneOff, "Edit");
      dialog = page.getByRole("dialog", { name: "Edit obligation" });
      await dialog.getByLabel("Assignee", { exact: true }).selectOption({ label: "Unassigned" });
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      await reload(page);
      const row = await obligationRow(page, oneOff);
      const api = await apiObligation(s, entity.id, oneOff);
      expect(api.note === "Renew before the end of November." && api.assignee?.displayName === me, q({ row, api: { note: api.note, assignee: api.assignee } }));
      return `Edit from the row menu opened "Edit obligation"; Save changes stored the note. A second Edit that chose Unassigned and then Cancel left the assignee ${api.assignee.displayName}. After a reload the row read ${q(row)}.`;
    },
  );

  await step(
    R,
    page,
    "Restricted matter: a linked Matter outside your reach shows Restricted matter; editing keeps the link",
    "The Matter cell reads Restricted matter with no number or title; Save changes keeps the stored link.",
    async () => {
      const row = await obligationRow(page, restricted);
      const leaks = (await page.getByText(`${prefix} confidential matter`).count()) + (await page.getByText(`M-${matter.number}`).count());
      await rowMenu(page, restricted, "Edit");
      const dialog = page.getByRole("dialog", { name: "Edit obligation" });
      const selected = tidy(await dialog.getByLabel("Matter", { exact: true }).locator("option:checked").innerText());
      await dialog.getByLabel("Note", { exact: true }).fill("Edited by the reader who cannot see the Matter.");
      await dialog.getByRole("button", { name: "Save changes" }).click();
      await dialog.waitFor({ state: "hidden" });
      const stored = await apiObligation(o, entity.id, restricted);
      expect(row.Matter === "Restricted matter" && leaks === 0 && selected === "Restricted matter" && stored.matter?.id === matter.id && stored.note?.startsWith("Edited by"), q({ row, leaks, selected, stored: stored.matter }));
      return `The row read ${q(row)}; neither the Matter title nor M-${matter.number} appeared. Edit obligation showed Matter ${q(selected)}. After Save changes, ${o.person.name}'s read still linked M-${matter.number}.`;
    },
  );

  await step(
    R,
    page,
    "Column widths: drag a heading edge or use the arrow keys; the actions stay at the right; widths are remembered across Entity obligation tables in this browser",
    "The Note column narrows by a drag on its edge and by ArrowLeft; the second Entity's table opens with the same width; Home resets it.",
    async () => {
      // At 1280px the flexible Obligation column already sits at its minimum, so
      // the check narrows a column (widening has no room to take from).
      const sep = page.getByRole("separator", { name: "Width of the Note column" });
      const width = async () => Math.round(Number(await sep.getAttribute("aria-valuenow")));
      const start = await width();
      const box = await sep.boundingBox();
      // The next heading cell paints over the right part of the 9px strip, so a
      // press on the visible edge line itself misses (checked with elementFromPoint).
      const hits = await page.evaluate(({ x, y }) => [0, 2, 4, 6, 8].map((dx) => { const el = document.elementFromPoint(x + dx + 0.5, y); return el.getAttribute("role") ?? el.tagName; }), { x: box.x, y: box.y + box.height / 2 });
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 - 30, box.y + box.height / 2, { steps: 5 });
      await page.mouse.up();
      const centreDrag = await width();
      await page.mouse.move(box.x + 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 2 - 30, box.y + box.height / 2, { steps: 5 });
      await page.mouse.up();
      const dragged = await width();
      await sep.focus();
      await page.keyboard.press("ArrowLeft");
      const keyed = await width();
      if (centreDrag === start && dragged < start)
        productBug("resize-strip-covered", "A table column's resize strip takes the pointer only on its left few pixels; the next heading cell paints over the rest, so a drag that starts on the visible edge line does nothing.", "Entity Obligations tab at 1280px; press on the centre of the Note column's heading edge and drag left 30px; then press 2px left of the line and drag again.", `Hit test across the strip ${q(hits)}; a drag from the line left the width at ${centreDrag}px; a drag from 2px left of it changed ${start}px to ${dragged}px.`);
      const table = await page.locator("main table").first().boundingBox();
      const mark = await page.getByRole("button", { name: "Mark complete" }).first().boundingBox();
      await go(page, `/entities/${second.id}/obligations`);
      const elsewhere = Math.round(Number(await page.getByRole("separator", { name: "Width of the Note column" }).getAttribute("aria-valuenow")));
      await page.getByRole("separator", { name: "Width of the Note column" }).focus();
      await page.keyboard.press("Home");
      const reset = Math.round(Number(await page.getByRole("separator", { name: "Width of the Note column" }).getAttribute("aria-valuenow")));
      await go(page, `/entities/${entity.id}/obligations`);
      expect(dragged < start && keyed < dragged && elsewhere === keyed && reset > keyed && mark.x + mark.width > table.x + table.width - 200, q({ start, centreDrag, dragged, keyed, elsewhere, reset, mark, table }));
      return `Note column width ${start}px. A drag that started on the edge line left it at ${centreDrag}px (hit test across the strip ${q(hits)}); a drag that started just left of the line narrowed it to ${dragged}px; ArrowLeft on the focused edge made it ${keyed}px. Mark complete stayed at the right of the table (right edge ${Math.round(mark.x + mark.width)}, table end ${Math.round(table.x + table.width)}). ${second.legalName}'s table opened with the Note column at ${elsewhere}px; Home on the edge reset it to ${reset}px.`;
    },
  );

  await step(
    R,
    page,
    "Calendar steps 1-2: Calendar, Due-date list puts overdue open Obligations first; Filter, Entity and Assignee, Apply",
    "Overdue rows lead; the filter narrows to this Entity and assignee.",
    async () => {
      await go(page, "/entities");
      const flags = await page.locator("main table tbody tr td:first-child").evaluateAll((tds) => tds.map((td) => /status-severe/.test(td.className)));
      const firstOpen = flags.indexOf(false);
      const orderOk = firstOpen === -1 || flags.slice(firstOpen).every((f) => !f);
      const scope = page.locator("main");
      await applyFilter(page, scope, "Entity", entity.legalName);
      await applyFilter(page, scope, "Assignee", me);
      const rows = (await page.locator("main table tbody tr").allInnerTexts()).map(tidy);
      const ourOverdue = await page.locator("main table tbody tr", { hasText: annual }).locator("td").first().evaluate((td) => /status-severe/.test(td.className));
      expect(orderOk && flags.some(Boolean) && ourOverdue && rows.length === 2 && rows[0].includes(annual) && rows.every((r) => r.includes(entity.legalName)), q({ orderOk, ourOverdue, rows }));
      return `The unfiltered list had ${flags.filter(Boolean).length} overdue rows, all before the first open future row (of ${flags.length}). Filter with Entity then Assignee and Apply left ${q(rows)}, overdue first.`;
    },
  );

  await step(
    R,
    page,
    "Calendar step 3: Month, Previous month, Next month, Today, and back to Due-date list keep the filters",
    "The Entity and Assignee filters stay in the address across each change.",
    async () => {
      const trail = [];
      const keep = () => {
        const u = new URL(page.url());
        return u.searchParams.get("entity") === entity.id && Boolean(u.searchParams.get("assignee"));
      };
      const nav = page.getByRole("navigation", { name: "Calendar display" });
      await nav.getByRole("link", { name: "Month" }).click();
      await settle(page);
      trail.push(["Month", keep(), await page.getByRole("grid").count()]);
      for (const name of ["Previous month", "Next month", "Today"]) {
        await page.getByRole("link", { name }).or(page.getByRole("button", { name })).first().click();
        await settle(page);
        trail.push([name, keep(), new URL(page.url()).searchParams.get("month")]);
      }
      await nav.getByRole("link", { name: "Due-date list" }).click();
      await settle(page);
      trail.push(["Due-date list", keep()]);
      const rows = await page.locator("main table tbody tr").count();
      expect(trail.every(([, k]) => k) && rows === 2, q({ trail, rows }));
      return `Each change kept the filters: ${q(trail)}; the list again showed ${rows} rows.`;
    },
  );

  await step(
    R,
    page,
    "Calendar step 2 and recovery: Due date From and To include both dates; an end before the start shows the refusal and Apply stays unavailable",
    "2026-11-01 to 2026-11-20 keeps the one-off due 2026-11-20; a reversed range shows 'End date must be on or after start date.' with Apply disabled.",
    async () => {
      const scope = page.locator("main");
      await scope.getByRole("button", { name: /^Filter/ }).click();
      let pop = page.getByRole("dialog", { name: "Filter" });
      await pop.getByRole("button", { name: /^Due date/ }).click();
      await pop.getByLabel("From", { exact: true }).fill("2026-12-01");
      await pop.getByLabel("To", { exact: true }).fill("2026-11-01");
      const refusal = tidy(await pop.getByRole("alert").innerText());
      const applyDisabled = await pop.getByRole("button", { name: "Apply" }).isDisabled();
      const hint = await pop.getByText("Includes both dates").isVisible();
      await pop.getByLabel("From", { exact: true }).fill("2026-11-01");
      await pop.getByLabel("To", { exact: true }).fill("2026-11-20");
      await pop.getByRole("button", { name: "Apply" }).click();
      await settle(page);
      const rows = (await page.locator("main table tbody tr").allInnerTexts()).map(tidy);
      expect(refusal === "End date must be on or after start date." && applyDisabled && hint && rows.length === 1 && rows[0].includes(oneOff), q({ refusal, applyDisabled, hint, rows }));
      return `From 2026-12-01 and To 2026-11-01 showed ${q(refusal)} and Apply was disabled; the editor said "Includes both dates". From 2026-11-01 to 2026-11-20 left ${q(rows)}.`;
    },
  );

  await step(
    R,
    page,
    "Calendar step 4: no results; Clear all; opening an Obligation goes to its Entity",
    "An empty window shows 'No obligations match' and Clear all; the row link opens the Entity's Obligations tab.",
    async () => {
      const scope = page.locator("main");
      await scope.getByRole("button", { name: /^Due date/ }).first().click();
      const pop = page.getByRole("dialog", { name: "Due date" });
      await pop.getByLabel("From", { exact: true }).fill("2099-01-01");
      await pop.getByLabel("To", { exact: true }).fill("2099-01-31");
      await pop.getByRole("button", { name: "Apply" }).click();
      await settle(page);
      const empty = await page.getByText("No obligations match").isVisible();
      await page.getByRole("button", { name: "Clear all" }).first().click();
      await settle(page);
      const cleared = new URL(page.url()).search;
      await applyFilter(page, scope, "Entity", entity.legalName);
      await page.getByRole("link", { name: annual }).click();
      await settle(page);
      const landed = new URL(page.url()).pathname;
      expect(empty && !/from=|entity=|assignee=/.test(cleared) && landed === `/entities/${entity.id}/obligations`, q({ empty, cleared, landed }));
      return `A 2099 window showed "No obligations match"; Clear all left the address ${q(cleared || "(no filters)")}. Selecting ${annual} opened ${landed}.`;
    },
  );

  await step(
    R,
    page,
    "Home: open Obligations assigned to you; past-due items remain open and are not filed by reading",
    "Home's Entity obligations lists the overdue item; afterwards it is still due 2015-09-30, not completed, and still offers Mark complete.",
    async () => {
      const items = await homeObligations(page);
      const found = items.find((i) => i.includes(annual)) ?? null;
      await go(page, `/entities/${entity.id}/obligations`);
      const api = await apiObligation(s, entity.id, annual);
      const mark = await page.locator("main table tbody tr", { hasText: annual }).getByRole("button", { name: "Mark complete" }).count();
      expect(found && api.nextDueOn === "2015-09-30" && api.completedOn === null && mark === 1, q({ items: items.slice(0, 5), api, mark }));
      return `Home's Entity obligations listed ${q(found)}. After reading the calendar and Home the Obligation was still due ${api.nextDueOn} with completedOn ${api.completedOn}, and its row still offered Mark complete.`;
    },
  );

  await step(
    R,
    page,
    "Home: Administrators also see unassigned Obligations on Entities they reach; others do not",
    R === "administrator" ? "An unassigned overdue Obligation appears on the Administrator's Home." : "An unassigned Obligation does not appear on the Legal Team Member's Home.",
    async () => {
      const dialog = await openAdd();
      await dialog.getByLabel("Label", { exact: true }).fill(unassigned);
      await dialog.getByLabel("Due date", { exact: true }).fill("2014-01-15");
      await dialog.getByRole("button", { name: "Add obligation" }).click();
      await dialog.waitFor({ state: "hidden" });
      const items = await homeObligations(page);
      const shown = items.find((i) => i.includes(unassigned));
      expect(R === "administrator" ? Boolean(shown) : !shown, q({ items: items.slice(0, 5) }));
      await go(page, `/entities/${entity.id}/obligations`);
      await rowMenu(page, unassigned, "Delete");
      await settle(page);
      const gone = (await apiObligation(s, entity.id, unassigned)) === null;
      expect(gone, "Delete did not remove the fixture");
      return `${me}'s Home ${shown ? `listed ${q(shown)}` : "did not list the unassigned Obligation"} (first rows ${q(items.slice(0, 3))}). Delete from the row menu then removed it at once, with no confirmation step.`;
    },
  );

  await step(
    R,
    page,
    "Mark a filing steps 1-3: Mark complete dialog, explanation and Completed on default; filing 2026-10-05 advances the annual to 2027-09-30; History records it",
    "Explanation names 12 months; Completed on starts at the local date; the new due date is 2027-09-30; History shows the filing.",
    async () => {
      await page.locator("main table tbody tr", { hasText: annual }).getByRole("button", { name: "Mark complete" }).click();
      const dialog = page.getByRole("dialog", { name: "Mark complete" });
      await dialog.waitFor();
      const explanation = tidy(await dialog.locator("#mark-filed-explanation").innerText());
      const defaultDate = await dialog.getByLabel("Completed on").inputValue();
      const browserToday = await page.evaluate(() => new Date().toLocaleDateString("en-CA"));
      await dialog.getByLabel("Completed on").fill("2026-10-05");
      await dialog.getByRole("button", { name: "Mark complete" }).click();
      await dialog.waitFor({ state: "hidden" });
      await reload(page);
      const api = await apiObligation(s, entity.id, annual);
      const row = await obligationRow(page, annual);
      await page.getByRole("toolbar", { name: "Applets" }).getByRole("button", { name: "History" }).click();
      await settle(page);
      const history = (await page.getByText(new RegExp(annual.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).allInnerTexts()).map(tidy).filter((t) => /complet|filed/i.test(t));
      await page.keyboard.press("Escape");
      expect(/12 months/.test(explanation) && defaultDate === browserToday && api.nextDueOn === "2027-09-30" && history.length > 0, q({ explanation, defaultDate, browserToday, api: api.nextDueOn, history }));
      return `Mark complete explained ${q(explanation)}; Completed on started at ${defaultDate} (the browser's local date ${browserToday}). Completing on 2026-10-05 moved the due date from 2015-09-30 to ${api.nextDueOn} (row ${q(row)}). History showed ${q(history.slice(0, 2))}.`;
    },
  );

  await step(
    R,
    page,
    "One-off filing: keeps its due date, shows Completed <date>, leaves open Obligations, cannot be filed again, row read-only; Show completed finds it with Filed",
    "The one-off stays 2026-11-20 with Completed; no Mark complete or menu; the calendar shows it only with Show completed, marked Filed; a second filing is refused.",
    async () => {
      await page.locator("main table tbody tr", { hasText: oneOff }).getByRole("button", { name: "Mark complete" }).click();
      const dialog = page.getByRole("dialog", { name: "Mark complete" });
      const explanation = tidy(await dialog.locator("#mark-filed-explanation").innerText());
      await dialog.getByRole("button", { name: "Mark complete" }).click();
      await dialog.waitFor({ state: "hidden" });
      await reload(page);
      const row = await obligationRow(page, oneOff);
      const tr = page.locator("main table tbody tr", { hasText: oneOff });
      const buttons = await tr.getByRole("button").count();
      const api = await apiObligation(s, entity.id, oneOff);
      await go(page, `/entities?entity=${entity.id}`);
      const open = await page.locator("main table tbody tr", { hasText: oneOff }).count();
      await applyFilter(page, page.locator("main"), "Show completed");
      const completedRow = (await page.locator("main table tbody tr", { hasText: oneOff }).allInnerTexts()).map(tidy);
      const again = await s.api("POST", `/entities/${entity.id}/obligations/${api.id}/file`, { filedOn: "2026-10-06" });
      expect(
        api.nextDueOn === "2026-11-20" && api.completedOn && /^Completed /.test(row.Obligation?.replace(oneOff, "").trim() ?? "") && buttons === 0 && open === 0 && completedRow.length === 1 && /Filed/.test(completedRow[0]) && again.status === 409,
        q({ explanation, row, buttons, api: [api.nextDueOn, api.completedOn], open, completedRow, again }),
      );
      return `Mark complete said ${q(explanation)}. The one-off kept due ${api.nextDueOn} and its row read ${q(row)} with ${buttons} buttons (no Mark complete, no menu). The Entity-filtered calendar listed it ${open} times; after Filter, Show completed it read ${q(completedRow[0])}. A second filing request was refused ${again.status} ${q(again.json?.detail)}.`;
    },
  );

  await step(
    R,
    page,
    "Recovery: correct an open recurring row with Edit; Delete in the row menu removes an Obligation at once without filing",
    "The due date correction saves; Delete removes the scrap Obligation; the filed annual is unchanged.",
    async () => {
      await go(page, `/entities/${entity.id}/obligations`);
      const dialog = await openAdd();
      await dialog.getByLabel("Label", { exact: true }).fill(scrap);
      await dialog.getByLabel("Due date", { exact: true }).fill("2027-06-30");
      await dialog.getByLabel("Repeat every (months)", { exact: true }).fill("6");
      await dialog.getByRole("button", { name: "Add obligation" }).click();
      await dialog.waitFor({ state: "hidden" });
      await rowMenu(page, scrap, "Edit");
      const edit = page.getByRole("dialog", { name: "Edit obligation" });
      await edit.getByLabel("Due date", { exact: true }).fill("2027-07-31");
      await edit.getByRole("button", { name: "Save changes" }).click();
      await edit.waitFor({ state: "hidden" });
      const corrected = (await apiObligation(s, entity.id, scrap)).nextDueOn;
      await rowMenu(page, scrap, "Delete");
      await settle(page);
      const confirm = await page.getByRole("dialog").count();
      await reload(page);
      const gone = (await page.locator("main table tbody tr", { hasText: scrap }).count()) === 0;
      const annualKept = (await apiObligation(s, entity.id, annual)).nextDueOn;
      expect(corrected === "2027-07-31" && confirm === 0 && gone && annualKept === "2027-09-30", q({ corrected, confirm, gone, annualKept }));
      return `Edit saved the scrap schedule's due date as ${corrected}. Delete removed it with no confirmation dialog (${confirm} dialogs); ${annual} still read ${annualKept}.`;
    },
  );

  await step(
    R,
    page,
    "Negative: an invalid due date in Edit is not saved",
    "Clearing the due date keeps the dialog from saving; the stored date is unchanged.",
    async () => {
      await rowMenu(page, annual, "Edit");
      const edit = page.getByRole("dialog", { name: "Edit obligation" });
      await edit.getByLabel("Due date", { exact: true }).fill("");
      await edit.getByRole("button", { name: "Save changes" }).click();
      await wait(800);
      const open = await edit.isVisible();
      const message = await edit.getByLabel("Due date", { exact: true }).evaluate((e) => e.validationMessage);
      await edit.getByRole("button", { name: "Cancel" }).click();
      const due = (await apiObligation(s, entity.id, annual)).nextDueOn;
      expect(open && message && due === "2027-09-30", q({ open, message, due }));
      return `Save changes with an empty Due date kept the dialog open (${q(message)}); the stored date stayed ${due}.`;
    },
  );

  await step(
    R,
    page,
    "Archiving the Entity removes its Obligations from the calendar and Home until restored",
    "After Archive the Obligation is absent from Home and the calendar and the Entity filter; after Restore it returns.",
    async () => {
      const patch = await s.api("PATCH", `/entities/${entity.id}/obligations/${(await apiObligation(s, entity.id, annual)).id}`, { nextDueOn: "2015-09-30" });
      expect(patch.status === 200, `reset due ${patch.status}`);
      const before = (await homeObligations(page)).some((i) => i.includes(annual));
      await go(page, `/entities/${entity.id}`);
      await page.getByRole("button", { name: "Archive", exact: true }).click();
      await settle(page);
      const homeAfter = (await homeObligations(page)).some((i) => i.includes(annual));
      await go(page, "/entities");
      const calendarAfter = await page.locator("main table tbody tr", { hasText: annual }).count();
      await page.locator("main").getByRole("button", { name: /^Filter/ }).click();
      const pop = page.getByRole("dialog", { name: "Filter" });
      await pop.getByRole("button", { name: /^Entity/ }).click();
      await pop.getByLabel("Search choices").fill(entity.legalName);
      const offered = await pop.getByRole("radio", { name: entity.legalName, exact: true }).count();
      await page.keyboard.press("Escape");
      await go(page, `/entities/${entity.id}`);
      await page.getByRole("button", { name: "Restore", exact: true }).click();
      await settle(page);
      await go(page, "/entities");
      const restored = await page.locator("main table tbody tr", { hasText: annual }).count();
      expect(before && !homeAfter && calendarAfter === 0 && offered === 0 && restored === 1, q({ before, homeAfter, calendarAfter, offered, restored }));
      return `With the due date reset to 2015-09-30 by a state write, Home listed ${annual}. After Archive, Home did not list it, the calendar had ${calendarAfter} rows for it, and the Entity filter did not offer the Entity. After Restore the calendar listed it again (${restored} row).`;
    },
  );

  await step(
    R,
    page,
    "Negative: changes on an archived Entity are refused with a clear outcome",
    "Add obligation and the row actions are absent while archived; a filing request is refused with the archive message.",
    async () => {
      await go(page, `/entities/${entity.id}`);
      await page.getByRole("button", { name: "Archive", exact: true }).click();
      await settle(page);
      await go(page, `/entities/${entity.id}/obligations`);
      const add = await page.getByRole("button", { name: "Add obligation" }).count();
      const mark = await page.getByRole("button", { name: "Mark complete" }).count();
      const menus = await page.getByRole("button", { name: /^Actions for / }).count();
      const id = (await apiObligation(s, entity.id, annual)).id;
      const write = await s.api("POST", `/entities/${entity.id}/obligations/${id}/file`, { filedOn: "2026-10-06" });
      await go(page, `/entities/${entity.id}`);
      await page.getByRole("button", { name: "Restore", exact: true }).click();
      await settle(page);
      expect(add === 0 && mark === 0 && menus === 0 && write.status === 409, q({ add, mark, menus, write }));
      return `While archived the tab offered ${add} Add obligation, ${mark} Mark complete and ${menus} row menus; a filing request was refused ${write.status} ${q(write.json?.detail)}. The Entity was restored.`;
    },
  );
}

async function c52BusinessUser() {
  current = { article: "entity-obligations", scenario: "V-C52" };
  const legal = await session("legal_team_member");
  const entity = await fixtureEntity(legal, `DOC-030 entities V-C52 ${TAG} business refusal`);
  let s;
  await step(
    "business_user (Diego Salas, magic link)",
    legal.page,
    "Negative: an unauthorized change has a clear outcome",
    "A Business User's Obligation write is refused.",
    async () => {
      s = await session("business_user");
      const r = await s.api("POST", `/entities/${entity.id}/obligations`, { label: "DOC-030 entities V-C52 business refusal", nextDueOn: "2027-01-31" });
      expect(r.status === 403, `${r.status}`);
      return `POST to the Entity's obligations as ${s.person.name} returned ${r.status} ${q(r.json?.detail)}.`;
    },
  );
}

// =====================================================================
// V-C53 entity-structure-and-access
// =====================================================================
function psql(sql) {
  return execFileSync("docker", ["exec", `${lab.project}-postgres-1`, "psql", "-U", "openlaw", "-d", "openlaw", "-tAc", sql]).toString().trim();
}

async function c53(R) {
  current = { article: "entity-structure-and-access", scenario: "V-C53" };
  const s = await session(R);
  const { page } = s;
  const who = R === "administrator" ? "A" : "L";
  const otherKey = R === "administrator" ? "legal_team_member" : "administrator";
  const o = await session(otherKey);
  const reader = await session("comparison_legal");
  const prefix = `DOC-030 entities V-C53 ${TAG} ${who}`;
  const P = await fixtureEntity(s, `${prefix} parent`);
  const S = await fixtureEntity(s, `${prefix} secret sub`);
  const M = await fixtureEntity(s, `${prefix} minor owner`);
  const S2 = await fixtureEntity(s, `${prefix} plural sub`);
  const U = await fixtureEntity(s, `${prefix} lone`);
  const Rg = await fixtureEntity(s, `${prefix} register co`);
  const L = await fixtureEntity(s, `${prefix} legacy par`);
  const AR = await fixtureEntity(s, `${prefix} archived candidate`);
  await s.api("POST", `/entities/${AR.id}/archive`, {});
  fixture(`${AR.legalName} archived`, `POST /entities/:id/archive as ${s.person.name}`);
  psql(`update entities set par_value = 125, par_value_currency = null where id = '${L.id}'`);
  fixture(`${L.legalName} par value 125 minor units with no currency (a value saved before par values had a currency)`, "SQL update through docker exec on the lab database, this fixture only");
  const ada = `Ada Quill ${who} ${TAG}`;
  const hold = async (owned, owner, pct) => {
    const r = await s.api("POST", `/entities/${owned.id}/holdings`, { direction: "owner", relatedEntityId: owner.id, ownershipPercent: pct });
    expect(r.status === 201, `holding fixture ${r.status} ${q(r.json)}`);
  };
  await hold(S, P, 75);
  await hold(S, M, 25);
  await hold(S2, P, 40);
  await hold(S2, M, 35);
  fixture("Holdings P→S 75, M→S 25, P→S2 40, M→S2 35", `POST /entities/:id/holdings as ${s.person.name}`);
  const c1 = await fixtureContract(s, `${prefix} open contract`);
  const c2 = await fixtureContract(s, `${prefix} confidential contract`, { isConfidential: true });
  const c3 = await fixtureContract(s, `${prefix} signed by secret sub`);
  for (const [c, e] of [[c1, P], [c2, P], [c3, S]]) {
    const r = await s.api("PATCH", `/contracts/${c.number}`, { entityId: e.id });
    expect(r.status === 200, `Our entity fixture ${r.status} ${q(r.json)}`);
  }
  const body = page.getByRole("main");
  const register = async (ent = Rg, who = s) => (await who.api("GET", `/entities/${ent.id}/share-register`)).json;

  // ---------------- share capital ----------------
  await step(R, page, "Share capital steps 1-2, 4: Authorized shares saves on focus change, Issued shares on Enter; both survive reload", "1000 and 1000 persist.", async () => {
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
  });

  await step(R, page, "Share capital step 4: Escape abandons an unsaved edit", "Typing 999 then Escape restores 1,000 and nothing is saved.", async () => {
    const issued = body.getByLabel("Issued shares", { exact: true });
    await typeInto(issued, "999");
    await issued.press("Escape");
    const shown = plain(await issued.inputValue());
    await blurTo(page, "Share capital");
    await reload(page);
    const stored = plain(await body.getByLabel("Issued shares", { exact: true }).inputValue());
    expect(shown === "1000" && stored === "1000", `${shown} ${stored}`);
    return `Escape returned the control to ${shown}; after a reload it read ${stored}.`;
  });

  await step(R, page, "Share capital note: negative and fractional share counts are refused without replacing the saved value", "-5 and 12.5 show 'Enter a whole number of zero or more.'; 1000 stays.", async () => {
    const seen = [];
    for (const bad of ["-5", "12.5"]) {
      const field = body.getByLabel("Authorized shares", { exact: true });
      await typeInto(field, bad);
      await blurTo(page, "Share capital");
      seen.push({ bad, typed: plain(await field.inputValue()), message: await page.getByText("Enter a whole number of zero or more.").isVisible() });
      await reload(page);
    }
    const stored = plain(await body.getByLabel("Authorized shares", { exact: true }).inputValue());
    expect(seen.every((x) => x.message) && stored === "1000", q({ seen, stored }));
    return `Attempts ${q(seen)}. After each reload Authorized shares read ${stored}.`;
  });

  await step(R, page, "Share capital step 2: leave a value blank when it is unknown", "Clearing Issued shares saves a blank value.", async () => {
    await typeInto(body.getByLabel("Issued shares", { exact: true }), "");
    await blurTo(page, "Share capital");
    await reload(page);
    const blank = await body.getByLabel("Issued shares", { exact: true }).inputValue();
    const api = (await s.api("GET", `/entities/${Rg.id}`)).json.entity.sharesIssued;
    await typeInto(body.getByLabel("Issued shares", { exact: true }), "1000");
    await blurTo(page, "Share capital");
    expect(blank === "" && api === null, q({ blank, api }));
    return `Clearing Issued shares saved a blank value (read ${q(blank)} after a reload; stored ${api}). It was then set back to 1000.`;
  });

  await step(R, page, "Share capital step 3 and note: Par value unavailable until Currency; amount within the currency's decimals; too many decimals refused; changing Currency keeps the amount", "Par value disabled with no Currency; GBP 1.25 saves; 1.255 refused; EUR keeps 1.25.", async () => {
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
    const refusal = await page.getByText("Enter a non-negative amount with up to 2 decimal places.").isVisible();
    await reload(page);
    const afterRefusal = await body.getByLabel("Par value", { exact: true }).inputValue();
    await body.getByLabel("Currency", { exact: true }).selectOption({ label: "EUR — Euro" });
    await settle(page);
    await reload(page);
    const afterEuro = await body.getByLabel("Par value", { exact: true }).inputValue();
    const currencyNow = tidy(await body.getByLabel("Currency", { exact: true }).locator("option:checked").innerText());
    expect(disabledBefore && enabledAfter && saved === "1.25" && refusal && afterRefusal === "1.25" && afterEuro === "1.25" && /EUR/.test(currencyNow), q({ disabledBefore, enabledAfter, saved, refusal, afterRefusal, afterEuro, currencyNow }));
    return `Par value was disabled before a Currency and enabled after GBP. 1.25 saved (${saved} after reload). 1.255 showed "Enter a non-negative amount with up to 2 decimal places." and ${afterRefusal} stayed stored. Changing Currency to ${currencyNow} kept ${afterEuro}.`;
  });

  await step(R, page, "Share capital: a par value saved before par values had a currency shows its stored minor units and a note; choose a Currency, Confirm par value currency, Confirm amount and currency", "The note shows; the confirmation names the amount; confirming saves 1.25 GBP.", async () => {
    await go(page, `/entities/${L.id}`);
    const shown = await body.getByLabel("Par value", { exact: true }).inputValue();
    const note = tidy(await page.getByText(/Stored minor units; the original currency is unknown/).innerText());
    await body.getByLabel("Currency", { exact: true }).selectOption({ label: "GBP — British Pound" });
    const dialog = page.getByRole("dialog", { name: "Confirm par value currency" });
    await dialog.waitFor();
    const text = tidy(await dialog.innerText());
    await dialog.getByRole("button", { name: "Confirm amount and currency" }).click();
    await dialog.waitFor({ state: "hidden" });
    await settle(page);
    await reload(page);
    const after = await body.getByLabel("Par value", { exact: true }).inputValue();
    const api = (await s.api("GET", `/entities/${L.id}`)).json.entity;
    expect(/Choose a currency and confirm the amount/.test(note) && /125/.test(text) && /1\.25/.test(text) && after === "1.25" && api.parValueCurrency === "GBP", q({ shown, note, text, after, api: [api.parValue, api.parValueCurrency] }));
    return `The Par value field showed ${q(shown)} with the note ${q(note)}. Choosing GBP opened "Confirm par value currency": ${q(text)}. Confirm amount and currency saved Par value ${after} ${api.parValueCurrency}.`;
  });

  await step(R, page, "Share capital closing note: the three values are declared totals; the Ownership tab holds share classes, Holders and certificates", "The Ownership tab opens with the share register (No share register yet).", async () => {
    await go(page, `/entities/${Rg.id}/ownership`);
    const empty = await page.getByRole("heading", { name: "No share register yet" }).isVisible();
    const hint = tidy(await page.getByText(/Holders come from the entries/).innerText());
    const record = await page.getByRole("button", { name: "Record entry" }).isDisabled();
    expect(empty && record, q({ empty, record }));
    return `The Ownership tab showed "No share register yet" with ${q(hint)}; Record entry was unavailable until a live share class exists.`;
  });

  // Hand-typed owners before the register exists, to see what the register does to them.
  await step(R, page, "Holdings (entity-records): hand-typed owners on an Entity before its register — an owner Entity and an individual", "Both appear under Declared owners not in the register.", async () => {
    await addHolding(page, { relationship: "Owns this Entity", entity: M.legalName, percent: "25" });
    await addIndividual(page, ada, "10");
    await reload(page);
    const declared = await sectionText(page, "Declared owners not in the register");
    expect(declared.includes(M.legalName) && declared.includes(ada), declared);
    return `Declared owners not in the register read ${q(declared)}.`;
  });

  // ---------------- share register ----------------
  await step(R, page, "Set up share classes steps 1-4: New share class, Name, Authorized shares, Votes per share (starts at 1), Par value with Currency, Rights summary, Save", "The class lists its authorized count, votes per share and entry count.", async () => {
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
    expect(votesDefault === "1" && /1,000 authorized · 1 vote per share · 0 entries/.test(summary) && /no cap authorized/.test(second), q({ votesDefault, summary, second }));
    return `Votes per share started at ${votesDefault}. Save listed ${q(summary)}. A second class with Authorized shares blank listed ${q(second)}.`;
  });

  await step(R, page, "Share classes note: a class name must be unique on the Entity", "A second Ordinary is refused in the dialog.", async () => {
    const dialog = page.getByRole("dialog", { name: "Share classes" });
    await dialog.getByRole("button", { name: "New share class" }).click();
    await dialog.getByLabel(req("Name")).fill("Ordinary");
    await dialog.getByRole("button", { name: "Save" }).click();
    const alert = tidy(await dialog.getByRole("alert").innerText());
    await dialog.getByRole("button", { name: "Cancel" }).click();
    const classes = (await register()).classes.map((c) => c.name);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    expect(/already exists/.test(alert) && classes.filter((n) => n === "Ordinary").length === 1, q({ alert, classes }));
    return `A second class named Ordinary was refused with ${q(alert)}; the register kept ${q(classes)}.`;
  });

  const entryDialog = () => page.getByRole("dialog", { name: /^(Record entry|Edit entry \d+)$/ });
  async function chooseHolder(dialog, side, choice) {
    const select = dialog.getByLabel(req(side));
    if (choice.entity) {
      await select.selectOption({ label: "Entity from the registry…" });
      await dialog.getByRole("combobox", { name: "Entity", exact: true }).selectOption({ label: choice.entity });
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
  async function recordEntry({ kind, date, from, to, shares, klass = "Ordinary", extra, certificates, cancel }) {
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
  const entriesText = async () => (await page.getByRole("heading", { name: "Register of allotments and transfers" }).count()) ? (await section(page, "Register of allotments and transfers").locator("tbody tr").allInnerTexts()).map(tidy) : [];
  const membersText = async () => (await section(page, "Register of members").locator("tbody tr").allInnerTexts()).map(tidy);

  await step(R, page, "Record an entry steps 1-7: Allotment To an Entity from the registry, Class, Shares, Price per share and Currency, Consideration, Distinctive numbers, Resolution reference, Note, Issue certificate, Enter in register", "Effective date starts at today; the registry list leaves out this Entity and archived Entities; entry 001 lists; Register of members shows the Holder's 600.", async () => {
    await page.getByRole("button", { name: "Record entry" }).first().click();
    const dialog = entryDialog();
    await dialog.waitFor();
    const kinds = (await dialog.getByLabel(req("Entry")).locator("option").allInnerTexts()).map(tidy);
    const dateShown = tidy(await dialog.locator("#share-entry-date").innerText());
    const today = await page.evaluate(() => new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }));
    await dialog.getByLabel(req("To")).selectOption({ label: "Entity from the registry…" });
    const registry = (await dialog.getByRole("combobox", { name: "Entity", exact: true }).locator("option").allInnerTexts()).map(tidy);
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
        !registry.includes(Rg.legalName) && !registry.includes(AR.legalName) && registry.includes(M.legalName) &&
        entries.length === 1 && /^001/.test(entries[0]) && /Allotment/.test(entries[0]) && /C-001/.test(entries[0]) &&
        members.some((r) => r.includes(M.legalName) && /600/.test(r)),
      q({ kinds, dateShown, today, registryHasSelf: registry.includes(Rg.legalName), registryHasArchived: registry.includes(AR.legalName), entries, members }),
    );
    return `Entry offered ${q(kinds)}; Effective date started at ${q(dateShown)}. Entity from the registry… listed ${registry.length - 1} Entities, not ${Rg.legalName} itself and not the archived ${AR.legalName}. Enter in register listed ${q(entries[0])}; Register of members read ${q(members)}.`;
  });

  await step(R, page, "Record an entry: Allotment To a New individual with Full name", "Entry 002 lists; the individual Holder shows 400.", async () => {
    const d = await recordEntry({ kind: "Allotment", date: "2024-06-01", to: { individual: ada }, shares: "400" });
    await d.waitFor({ state: "hidden", timeout: 15000 });
    await settle(page);
    const members = await membersText();
    expect(members.some((r) => r.includes(ada) && /400/.test(r) && /Individual/.test(r)), q(members));
    return `Register of members read ${q(members)}.`;
  });

  await step(R, page, "Record an entry: Transfer From an existing Holder To an Entity from the registry; Certificates cancel the live certificate and issue new ones", "Entry 003 cancels C-001 and issues C-002 and C-003; balances 500 and 100.", async () => {
    const d = await recordEntry({
      kind: "Transfer",
      date: "2025-03-01",
      from: { holder: M.legalName },
      to: { entity: P.legalName },
      shares: "100",
      cancel: ["C-001"],
      certificates: [["C-002", "To", "100"], ["C-003", "From", "500"]],
    });
    await d.waitFor({ state: "hidden", timeout: 15000 });
    await settle(page);
    const entries = await entriesText();
    const members = await membersText();
    expect(entries.some((e) => /^003/.test(e) && /Transfer/.test(e) && /C-001/.test(e)) && members.some((r) => r.includes(M.legalName) && /500/.test(r)) && members.some((r) => r.includes(P.legalName) && /100/.test(r)), q({ entries, members }));
    return `Entry 003 read ${q(entries.find((e) => /^003/.test(e)))}. Register of members read ${q(members)}.`;
  });

  await step(R, page, "Record an entry: a second Transfer names an Entity Holder (used later for the restricted-Holder check)", "Entry 004 moves 50 from the parent to the secret sub.", async () => {
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
    expect(members.some((r) => r.includes(S.legalName) && /50/.test(r)), q(members));
    return `Register of members read ${q(members)}.`;
  });

  await step(R, page, "Register rule: an entry that would take a balance below zero is refused in the dialog and the register keeps its saved entries", "Transferring 1,000 from the individual is refused; four entries remain.", async () => {
    const d = await recordEntry({ kind: "Transfer", date: "2025-07-01", from: { holder: ada }, to: { holder: M.legalName }, shares: "1000" });
    const alert = tidy(await d.getByRole("alert").innerText());
    await d.getByRole("button", { name: "Cancel" }).click();
    await d.waitFor({ state: "hidden" });
    const count = (await register()).entries.length;
    expect(/below zero/.test(alert) && count === 4, q({ alert, count }));
    return `The dialog showed ${q(alert)}; the register kept ${count} entries.`;
  });

  await step(R, page, "Register rule: allotting more than a class authorizes is not refused; the warning shows above the register", "'1,300 Ordinary shares are issued against 1,000 authorized.' shows.", async () => {
    const d = await recordEntry({ kind: "Allotment", date: "2025-08-01", to: { holder: ada }, shares: "300" });
    await d.waitFor({ state: "hidden", timeout: 15000 });
    await settle(page);
    const warning = tidy(await page.getByText(/shares are issued against/).innerText());
    expect(warning === "1,300 Ordinary shares are issued against 1,000 authorized.", warning);
    return `The allotment saved and the page showed ${q(warning)}.`;
  });

  await step(R, page, "Record an entry, delete: use Remove entry 5 in the row (number without leading zeros); the confirmation asks Remove entry 005 from the register?; select Remove; the register replays and the warning clears", "The row control Remove entry 5 opens 'Remove entry 005 from the register?'; Remove deletes the entry and clears the over-authorized warning.", async () => {
    const control = page.getByRole("button", { name: "Remove entry 5", exact: true });
    const found = await control.count();
    const names = await section(page, "Register of allotments and transfers").locator("tbody tr").last().getByRole("button").evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label")));
    if (!found) guideFailure(R, "entity-structure-and-access, Record an entry: Remove entry 3", "A row control labelled Remove entry 5", `Row controls ${q(names)}.`);
    await control.click();
    const dialog = page.getByRole("dialog", { name: "Remove entry 005 from the register?" });
    await dialog.waitFor();
    const text = tidy(await dialog.innerText());
    await dialog.getByRole("button").filter({ hasText: /^Remove$/ }).click();
    await dialog.waitFor({ state: "hidden" });
    await settle(page);
    const warning = await page.getByText(/shares are issued against/).count();
    const entries = (await register()).entries.map((e) => e.entryNo);
    expect(found === 1 && warning === 0 && q(entries) === q([1, 2, 3, 4]), q({ found, names, text, warning, entries }));
    return `The last row's controls were ${q(names)}. Remove entry 5 opened ${q(text)}; Remove replayed the register (entries ${q(entries)}) and cleared the warning.`;
  });

  await step(R, page, "Record an entry: Buyback From a Holder puts shares into treasury; Cancellation from Treasury (shares the company holds); numbers are not reused", "Entries 006 and 007; a Treasury row shows after the buyback; issued becomes 900.", async () => {
    let d = await recordEntry({ kind: "Buyback", date: "2025-09-01", from: { holder: ada }, shares: "100" });
    await d.waitFor({ state: "hidden", timeout: 15000 });
    await settle(page);
    const treasury = (await membersText()).find((r) => /Treasury/.test(r));
    await page.getByRole("button", { name: "Record entry" }).first().click();
    d = entryDialog();
    await d.getByLabel(req("Entry")).selectOption({ label: "Cancellation" });
    const fromDefault = tidy(await d.getByLabel(req("From")).locator("option:checked").innerText());
    await pickDate(page, d.locator("#share-entry-date"), "2025-09-15");
    await d.getByLabel(req("Class")).selectOption({ label: "Ordinary" });
    await d.getByLabel(req("Shares")).fill("100");
    await d.getByRole("button", { name: "Enter in register" }).click();
    await d.waitFor({ state: "hidden", timeout: 15000 });
    await settle(page);
    const reg = await register();
    const numbers = reg.entries.map((e) => e.entryNo);
    expect(treasury && fromDefault === "Treasury (shares the company holds)" && q(numbers) === q([1, 2, 3, 4, 6, 7]) && reg.reconciliation.registerIssued === 900, q({ treasury, fromDefault, numbers, rec: reg.reconciliation }));
    return `After the Buyback the members table showed ${q(treasury)}. Cancellation's From started at ${q(fromDefault)}. The entries are numbered ${q(numbers)} (005 not reused) and the register issues ${reg.reconciliation.registerIssued}.`;
  });

  await step(R, page, "Record an entry, correct: use Edit entry 2 in the row; the dialog title shows Edit entry 002; change a value; Save", "The row control Edit entry 2 opens 'Edit entry 002'; Save stores the change.", async () => {
    const control = page.getByRole("button", { name: "Edit entry 2", exact: true });
    const found = await control.count();
    if (!found) guideFailure(R, "entity-structure-and-access, Record an entry: Edit entry 3", "A row control labelled Edit entry 2", "No such control.");
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
  });

  await step(R, page, "Bug check (DES-088): entry row actions are two icon buttons, not the shared row menu", "Observation of the row actions.", async () => {
    const rows = section(page, "Register of allotments and transfers").locator("tbody tr");
    const labels = await rows.first().getByRole("button").evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label") ?? b.textContent.trim()));
    const menus = await rows.getByRole("button", { name: /^Actions for/ }).count();
    if (labels.length === 2 && menus === 0)
      productBug("register-row-actions", "Share register entries draw Edit and Remove as two icon buttons per row, not the shared row menu DES-088 names.", "Open an Entity with register entries, Ownership tab, Register of allotments and transfers: each row ends with a pencil and a trash icon button.", `Row buttons ${q(labels)}; ${menus} row menus.`);
    return `The first entry row's controls were ${q(labels)} and the table had ${menus} row menus. Author's suspected defect 3 confirmed: Edit and Remove are icon buttons.`;
  });

  await step(R, page, "Read the register at a date: Register as of, Change to today, dimmed later entries, the issued total on that date; Previous entry date, Next entry date, Reset to today", "At 1 Mar 2024 the members show the owner Entity's 600 and a Change to today column; later entries are dimmed; Reset returns to today.", async () => {
    await pickDate(page, page.locator("#register-as-of"), "2024-03-01");
    await settle(page);
    const title = tidy(await page.getByRole("heading", { name: /^Register of members at / }).innerText());
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
    const plainTitle = await page.getByRole("heading", { name: "Register of members", exact: true }).count();
    expect(/Change to today/.test(head) && members.some((r) => r.includes(M.legalName) && /600/.test(r)) && !members.some((r) => r.includes(ada)) && /600 Ordinary issued, from 1 entry of 6/.test(line) && next === "2024-06-01" && prev === "2024-01-15" && reset === null && plainTitle === 1, q({ title, head, members, dimmed, line, next, prev, reset }));
    return `Register as of 1 March 2024 showed ${q(title)} with headers ${q(head)} and rows ${q(members)}. ${q(dimmed)}. The line read ${q(line)}. Next entry date went to ${next}, Previous entry date to ${prev}, and Reset to today cleared the date.`;
  });

  await step(R, page, "Read the register: Filter the entries list by Entry; each class has one row per Holder, a Treasury row when the company holds shares, and a total row", "Filter Entry Transfer leaves the two transfers; the members table has a Total Ordinary row.", async () => {
    const scope = section(page, "Register of allotments and transfers");
    await applyFilter(page, scope, "Entry", "Transfer");
    const rows = (await scope.locator("tbody tr").allInnerTexts()).map(tidy);
    await scope.getByRole("button", { name: "Clear all" }).click();
    await settle(page);
    const members = await membersText();
    const total = members.find((r) => /^Total Ordinary/.test(r));
    expect(rows.length === 2 && rows.every((r) => /Transfer/.test(r)) && total, q({ rows, members }));
    return `Filter, Entry, Transfer, Apply left ${q(rows)}. The members table ended with ${q(total)}.`;
  });

  await step(R, page, "Read the register: Export register downloads the Register of members as CSV; Export downloads every entry", "Two CSV downloads; the members file names the Holders; the entries file has every entry.", async () => {
    const [m] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Export register" }).or(page.getByRole("button", { name: "Export register" })).first().click()]);
    const mText = (await (await import("node:fs/promises")).readFile(await m.path(), "utf8"));
    const scope = section(page, "Register of allotments and transfers");
    await applyFilter(page, scope, "Entry", "Transfer");
    const [e] = await Promise.all([page.waitForEvent("download"), scope.getByRole("link", { name: "Export", exact: true }).or(scope.getByRole("button", { name: "Export", exact: true })).first().click()]);
    const eText = (await (await import("node:fs/promises")).readFile(await e.path(), "utf8"));
    await scope.getByRole("button", { name: "Clear all" }).click();
    await settle(page);
    const eLines = eText.trim().split(/\r?\n/);
    expect(/\.csv$/.test(m.suggestedFilename()) && mText.includes(M.legalName) && mText.includes(ada) && eLines.length === 7, q({ m: m.suggestedFilename(), e: e.suggestedFilename(), mHead: mText.split(/\r?\n/)[0], eLines: eLines.length }));
    return `Export register saved ${m.suggestedFilename()} (header ${q(mText.split(/\r?\n/)[0])}) naming the Holders. With an Entry filter set, Export saved ${e.suggestedFilename()} with ${eLines.length - 1} entry lines, all six entries.`;
  });

  await step(R, page, "Check the register against Share capital: disagreement names both figures; matching reads agreement", "Declared 1,000 vs register 900 shows the disagreement line; declaring 900 shows agreement.", async () => {
    await reload(page);
    const differs = tidy(await page.getByText(/^Today the register (does not agree|agrees)/).innerText());
    await go(page, `/entities/${Rg.id}`);
    await typeInto(body.getByLabel("Issued shares", { exact: true }), "900");
    await blurTo(page, "Share capital");
    await go(page, `/entities/${Rg.id}/ownership`);
    const agrees = tidy(await page.getByText(/^Today the register (does not agree|agrees)/).innerText());
    expect(differs === "Today the register does not agree with Share capital. The Overview declares 1,000 issued; the register sums to 900." && agrees === "Today the register agrees with Share capital: 900 issued.", q({ differs, agrees }));
    return `With Issued shares 1,000 the line read ${q(differs)}. After setting Issued shares to 900 on Overview it read ${q(agrees)}.`;
  });

  await step(R, page, "Check the register: when Issued shares is blank the line still reports agreement (guide warns; author's suspected defect 2)", "With Issued shares blank the line reads agreement.", async () => {
    await go(page, `/entities/${Rg.id}`);
    await typeInto(body.getByLabel("Issued shares", { exact: true }), "");
    await blurTo(page, "Share capital");
    await go(page, `/entities/${Rg.id}/ownership`);
    const line = tidy(await page.getByText(/^Today the register (does not agree|agrees)/).innerText());
    await go(page, `/entities/${Rg.id}`);
    await typeInto(body.getByLabel("Issued shares", { exact: true }), "900");
    await blurTo(page, "Share capital");
    expect(line === "Today the register agrees with Share capital: 900 issued.", line);
    productBug("register-blank-issued-agrees", "The share register's reconciliation line reports agreement when Issued shares on Overview is blank.", "Entity with register entries summing to 900; clear Issued shares on Overview; open Ownership.", `The line read ${q(line)} with no declared value.`);
    return `With Issued shares blank the line read ${q(line)}. Author's suspected defect 2 confirmed. Issued shares was set back to 900.`;
  });

  await step(R, page, "How the register writes Holdings: owner Holdings from today's register, percentages over outstanding shares to two decimals; a register entry replaces a hand-typed Entity owner; a hand-typed individual stays beside the register Holder", "M 55.56, Ada 33.33, P 5.56, S 5.56 from register; M's hand-typed row gone from Declared owners; the hand-typed Ada remains until removed.", async () => {
    await go(page, `/entities/${Rg.id}/ownership`);
    const declared = await sectionText(page, "Declared owners not in the register");
    const holdings = (await s.api("GET", `/entities/${Rg.id}/holdings`)).json;
    const owners = (holdings.owners ?? []).map((h) => ({ name: h.owner.legalName, pct: h.ownershipPercent, source: h.source }));
    const hasMHand = declared?.includes(M.legalName);
    const hasAdaHand = declared?.includes(ada);
    await page.getByRole("button", { name: `Remove ${ada}` }).click();
    await settle(page);
    await reload(page);
    const after = await sectionText(page, "Declared owners not in the register");
    const want = { [M.legalName]: 55.56, [ada]: 33.33, [P.legalName]: 5.56, [S.legalName]: 5.56 };
    const reg = owners.filter((x) => x.source === "register");
    expect(!hasMHand && hasAdaHand && reg.length === 4 && reg.every((x) => want[x.name] === x.pct) && !after, q({ declared, owners, after }));
    return `Declared owners not in the register read ${q(declared)}: the hand-typed ${M.legalName} row was gone, the hand-typed ${ada} remained. Owner Holdings: ${q(owners)}. Removing the hand-typed ${ada} left ${q(after ?? "no Declared owners card")}.`;
  });

  await step(R, page, "Register Holdings on the owner: From register on Holdings in other Entities; percentage and remove unavailable; From register opens the register", "M's Holdings in other Entities shows the register Entity From register with disabled controls; the pill opens the register.", async () => {
    await go(page, `/entities/${M.id}/ownership`);
    const card = await sectionText(page, "Holdings in other Entities");
    const pct = page.getByLabel(`${Rg.legalName} ownership percent`);
    const pctValue = await pct.inputValue();
    const pctDisabled = await pct.isDisabled();
    const removeDisabled = await page.getByRole("button", { name: `Remove ${Rg.legalName}` }).isDisabled();
    await page.getByRole("link", { name: "From register" }).first().click();
    await settle(page);
    const landed = new URL(page.url()).pathname;
    expect(/From register/.test(card) && pctValue === "55.56" && pctDisabled && removeDisabled && landed === `/entities/${Rg.id}/ownership`, q({ card, pctValue, pctDisabled, removeDisabled, landed }));
    return `${M.legalName}'s Holdings in other Entities read ${q(card)}; the percent (${pctValue}) and Remove ${Rg.legalName} were disabled. From register opened ${landed}.`;
  });

  await step(R, page, "Holdings (entity-records) note and author's suspected defect 1: OpenLaw still accepts a hand-typed owner on an Entity that keeps a share register", "A hand-typed individual is accepted, lists under Declared owners not in the register and counts toward the total.", async () => {
    const zed = `Zed Example ${who} ${TAG}`;
    await addIndividual(page, zed, "5");
    await reload(page);
    const declared = await sectionText(page, "Declared owners not in the register");
    const warning = tidy(await page.getByText(/Ownership totals/).first().innerText().catch(() => ""));
    await page.getByRole("button", { name: `Remove ${zed}` }).click();
    await settle(page);
    expect(declared?.includes(zed), q({ declared, warning }));
    productBug("register-hand-typed-owner", "An Entity that keeps a share register still accepts a new hand-typed owner Holding (Add Holding, Owner type Individual or Owns this Entity), which counts toward its ownership total.", "Entity with register entries; Ownership tab; Add Holding; Individual; Full name; 5; Add.", `Declared owners not in the register read ${q(declared)}; total warning ${q(warning)}.`);
    return `Add Holding with Individual ${q(zed)} at 5% was accepted: Declared owners not in the register read ${q(declared)} and the page showed ${q(warning)}. Author's suspected defect 1 confirmed; the guide describes this behaviour. The row was then removed.`;
  });

  await step(R, page, "Share classes note: a class's archive control is available only while no entry uses it; each entry change appears in the History of this Entity and each Entity Holder", "Archive Ordinary is disabled; Archive Preference works; History on the register Entity and on the Holder names the entries.", async () => {
    await page.getByRole("button", { name: "Share classes" }).click();
    const dialog = page.getByRole("dialog", { name: "Share classes" });
    const ordinaryDisabled = await dialog.getByRole("button", { name: "Archive Ordinary" }).isDisabled();
    const prefEnabled = await dialog.getByRole("button", { name: "Archive Preference" }).isEnabled();
    await dialog.getByRole("button", { name: "Archive Preference" }).click();
    await settle(page);
    const left = (await dialog.locator("li").allInnerTexts()).map(tidy);
    await page.keyboard.press("Escape");
    await page.getByRole("toolbar", { name: "Applets" }).getByRole("button", { name: "History" }).click();
    await settle(page);
    const rHistory = tidy(await page.getByRole("complementary").or(page.getByRole("region", { name: "History" })).first().innerText().catch(async () => await page.locator("body").innerText()));
    await page.keyboard.press("Escape");
    await go(page, `/entities/${M.id}`);
    await page.getByRole("toolbar", { name: "Applets" }).getByRole("button", { name: "History" }).click();
    await settle(page);
    const mHistory = tidy(await page.getByRole("complementary").or(page.getByRole("region", { name: "History" })).first().innerText().catch(async () => await page.locator("body").innerText()));
    await page.keyboard.press("Escape");
    const someone = [rHistory, mHistory].join(" ").match(/[^.]{0,80}someone[^.]{0,60}/g) ?? [];
    if (someone.length)
      productBug("history-someone-holding", "History entries for Holdings that the share register writes, and for a removed hand-typed individual Holding, print \"someone\" and \"someone%\" instead of the owner's name and percentage.", "Record register entries on an Entity whose owners had hand-typed Holdings; open History on that Entity and on an Entity Holder.", q(someone.slice(0, 4)));
    const rEntry = /entr|allot|transfer|register/i.test(rHistory);
    const mEntry = /entr|allot|transfer|register/i.test(mHistory);
    expect(ordinaryDisabled && prefEnabled && left.length === 1 && rEntry && mEntry, q({ ordinaryDisabled, prefEnabled, left, rHistory: rHistory.slice(0, 300), mHistory: mHistory.slice(0, 300) }));
    return `Archive Ordinary was disabled; Archive Preference archived that class, leaving ${q(left)}. History on ${Rg.legalName} began ${q(rHistory.slice(0, 500))}; History on ${M.legalName} began ${q(mHistory.slice(0, 500))}.`;
  });

  // ---------------- chart ----------------
  const chart = page.getByRole("region", { name: "Entity ownership chart" });
  const readChart = async (p = page) =>
    p.evaluate(() => {
      const region = document.querySelector('[role="region"][aria-label="Entity ownership chart"]');
      const nodes = [...region.querySelectorAll("svg g")].filter((g) => g.querySelector(":scope > a > rect, :scope > rect"));
      const out = nodes.map((g) => {
        const rect = g.querySelector("rect");
        const a = g.querySelector(":scope > a");
        return {
          name: a ? a.getAttribute("aria-label").replace(/^Open /, "") : g.getAttribute("aria-label"),
          type: a ? (a.querySelector("foreignObject p:nth-child(2)")?.textContent ?? null) : null,
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
        const nums = path.getAttribute("d").match(/-?\d+(\.\d+)?/g).map(Number);
        const [x1, y1, , x2, y2] = nums;
        const owner = unique.find((n) => x1 >= n.x && x1 <= n.x + n.w && Math.abs(y1 - (n.y + n.h)) < 1);
        const owned = unique.find((n) => x2 >= n.x && x2 <= n.x + n.w && Math.abs(y2 - n.y) < 1);
        return { owner: owner?.name, owned: owned?.name, kind: path.getAttribute("data-edge-kind"), dashed: Boolean(path.getAttribute("stroke-dasharray")), percent: path.parentElement.querySelector("text")?.textContent };
      });
      return { nodes: unique, edges, pan: [region.dataset.panX, region.dataset.panY], zoom: region.dataset.zoom };
    });
  const openChart = async (p, query) => {
    await go(p, "/entities?view=chart");
    await p.getByRole("searchbox", { name: "Search entities by name" }).fill(query);
    await settle(p);
    await p.getByRole("region", { name: "Entity ownership chart" }).waitFor();
    await wait(500);
  };

  await step(R, page, "Chart steps 1-2: Chart draws Holdings, including register Holdings and individual owners; primary owner solid, others dashed; highest percentage is primary even below 50%; an Entity with no Holdings sits in a separate row", "P→S 75% solid, M→S 25% dashed, P→S2 40% solid, M→S2 35% dashed; register edges into the register Entity; the individual labelled Individual; the lone Entity unconnected below.", async () => {
    await openChart(page, prefix);
    const view = await readChart();
    const edge = (owner, owned) => view.edges.find((e) => e.owner === owner && e.owned === owned);
    const e1 = edge(P.legalName, S.legalName), e2 = edge(M.legalName, S.legalName), e3 = edge(P.legalName, S2.legalName), e4 = edge(M.legalName, S2.legalName);
    const r1 = edge(M.legalName, Rg.legalName), r2 = edge(ada, Rg.legalName);
    const adaNode = view.nodes.find((n) => n.name === ada);
    const lone = view.nodes.find((n) => n.name === U.legalName);
    const maxOther = Math.max(...view.nodes.filter((n) => !n.unconnected).map((n) => n.y));
    expect(
      e1?.kind === "primary" && !e1.dashed && e1.percent === "75%" && e2?.kind === "secondary" && e2.dashed && e2.percent === "25%" &&
        e3?.kind === "primary" && e3.percent === "40%" && e4?.kind === "secondary" && e4.percent === "35%" &&
        r1?.kind === "primary" && r1.percent === "55.56%" && r2?.percent === "33.33%" && adaNode?.type === "Individual" && adaNode.href === `/entities/${Rg.id}/ownership` &&
        lone?.unconnected && lone.y > maxOther,
      q({ e1, e2, e3, e4, r1, r2, adaNode, lone, maxOther }),
    );
    return `Chart search ${q(prefix)} drew ${view.nodes.length} nodes. Edges: ${q([e1, e2, e3, e4, r1, r2])}. ${ada} was a node labelled ${q(adaNode.type)} linking to ${adaNode.href}. ${U.legalName} was unconnected at y=${lone.y}, below every connected node (max y=${maxOther}).`;
  });

  await step(R, page, "Chart step 3: drag pans, wheel zooms; with the chart focused arrows pan, plus zooms, zero fits; Fit to window resets", "Each input changes the view; zero and Fit to window return to the fitted view.", async () => {
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
    expect(!same(start, dragged) && wheeled.zoom !== dragged.zoom && +arrowed.pan[0] !== +fitted.pan[0] && +zoomed.zoom > +arrowed.zoom && same(zeroed, fitted) && same(refitted, fitted), q({ start: [start.pan, start.zoom], dragged: dragged.pan, wheeled: wheeled.zoom, fitted: [fitted.pan, fitted.zoom], arrowed: arrowed.pan, zoomed: zoomed.zoom, zeroed: [zeroed.pan, zeroed.zoom], refitted: [refitted.pan, refitted.zoom] }));
    return `Drag moved the pan from ${q(start.pan)} to ${q(dragged.pan)}; the wheel changed zoom ${dragged.zoom} to ${wheeled.zoom}. From the fitted view ${q([fitted.pan, fitted.zoom])}, ArrowRight panned to ${q(arrowed.pan)}, plus zoomed to ${zoomed.zoom}, zero returned ${q([zeroed.pan, zeroed.zoom])}, and Fit to window returned ${q([refitted.pan, refitted.zoom])}.`;
  });

  await step(R, page, "Chart step 4 and note: click or Space highlights the chain; Clear highlight or Escape removes it; double-click or Enter opens; opening an individual goes to the associated Entity's Ownership tab", "Click highlights S's chain; Space and Escape; double-click opens P; Enter opens U; double-click on the individual opens the register Entity's Ownership tab.", async () => {
    const node = (name) => chart.getByRole("link", { name: `Open ${name}` });
    await node(S.legalName).click();
    await wait(300);
    const chain = (await readChart()).nodes.filter((n) => n.highlighted === "true").map((n) => n.name).sort();
    const clearVisible = await page.getByRole("button", { name: "Clear highlight" }).isVisible();
    await page.getByRole("button", { name: "Clear highlight" }).click();
    const cleared = (await readChart()).nodes.every((n) => n.highlighted === null);
    await node(M.legalName).focus();
    await page.keyboard.press(" ");
    await wait(300);
    const spaced = (await readChart()).nodes.filter((n) => n.highlighted === "true").map((n) => n.name);
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
    expect(q(chain) === q(expectedChain) && clearVisible && cleared && spaced.includes(M.legalName) && escaped && dbl === `/entities/${P.id}` && entered === `/entities/${U.id}` && individual === `/entities/${Rg.id}/ownership`, q({ chain, clearVisible, cleared, spaced, escaped, dbl, entered, individual }));
    return `A single click on ${S.legalName} highlighted ${q(chain)}; Clear highlight cleared it. Space on ${M.legalName} highlighted ${spaced.length} nodes and Escape cleared them. Double-click on ${P.legalName} opened ${dbl}; Enter on ${U.legalName} opened ${entered}; double-click on the individual ${ada} opened ${individual}.`;
  });

  // ---------------- linked work ----------------
  await step(R, page, "Linked Contracts: the Contracts tab lists Contracts through Our entity; rows and counts follow the reader's reach", "The comparison reader sees only the open Contract and a count of 1; the Confidential Contract adds neither row nor count.", async () => {
    await go(page, `/entities/${P.id}/contracts`);
    const actorRows = (await page.getByRole("main").getByRole("link").allInnerTexts()).map(tidy).filter((r) => r.includes(prefix));
    const rp = reader.page;
    await go(rp, `/entities/${P.id}/contracts`);
    const readerRows = (await rp.getByRole("main").getByRole("link").allInnerTexts()).map(tidy).filter((r) => r.includes(prefix));
    const readerTab = rp.getByRole("navigation", { name: "Entity sections" }).getByRole("link", { name: /^Contracts/ });
    const readerImg = await readerTab.getByRole("img").getAttribute("aria-label").catch(() => null);
    const c2direct = await reader.api("GET", `/contracts/${c2.number}`);
    expect(readerRows.some((r) => r.includes(c1.title)) && !readerRows.some((r) => r.includes(c2.title)) && readerImg === "1 linked Contract" && c2direct.status >= 400, q({ actorRows, readerRows, readerImg, c2: c2direct.status }));
    return `${s.person.name} saw ${q(actorRows)} on ${P.legalName}'s Contracts tab. Priya Raman (not on the Confidential Contract) saw ${q(readerRows)} with the tab count ${q(readerImg)}; reading C-${c2.number} directly returned ${c2direct.status}.`;
  });

  await step(R, page, "Linked Matters tab: Matters appear only through saved Entity-valued Fields", "The Matters tab renders its linked-record list; the lab has no Entity-valued Matter Field.", async () => {
    await go(page, `/entities/${P.id}/matters`);
    const text = tidy(await page.getByRole("main").innerText());
    expect(/No linked records\./.test(text), text.slice(0, 200));
    return `The Matters tab for ${P.legalName} read ${q(text.slice(0, 120))}. No Matter type in this lab has an Entity-valued Field, so no Matter can name the Entity.`;
  });

  // ---------------- access ----------------
  const grantsDialog = page.getByRole("dialog", { name: "Confidential access" });
  await step(otherKey, o.page, `Before Grants: ${otherKey === "administrator" ? "an Administrator can manage access while the Entity is not Confidential" : "a Legal Team Member without a Grant sees the switch unavailable and no Manage access"}`, otherKey === "administrator" ? "Manage access is offered on the open Entity the Legal Team Member added." : "Switch disabled; no Manage access on the open Entity the Administrator added.", async () => {
    await go(o.page, `/entities/${S.id}`);
    const sw = o.page.getByRole("switch", { name: "Confidential — restrict to the access list" });
    const disabled = await sw.isDisabled();
    const manage = await o.page.getByRole("button", { name: "Manage access" }).count();
    if (otherKey === "administrator") expect(!disabled && manage === 1, q({ disabled, manage }));
    else expect(disabled && manage === 0, q({ disabled, manage }));
    return `${o.person.name} on ${S.legalName} (open, no Grant): switch disabled=${disabled}, Manage access buttons=${manage}.`;
  });

  await step(R, page, "Grant steps 1-3: Confidentiality, Manage access, Confidential access, Person, Grant access; the list includes the person and you; only live Legal Team Members and Administrators are offered", "Priya Raman appears in the list with the actor; Business Users are not offered.", async () => {
    await go(page, `/entities/${S.id}`);
    await section(page, "Confidentiality").getByRole("button", { name: "Manage access" }).click();
    await grantsDialog.waitFor();
    const options = (await grantsDialog.getByLabel("Person").locator("option").allInnerTexts()).map(tidy);
    await grantsDialog.getByLabel("Person").selectOption({ label: "Priya Raman" });
    await grantsDialog.getByRole("button", { name: "Grant access" }).click();
    await grantsDialog.getByRole("button", { name: "Remove Priya Raman" }).waitFor();
    const listed = await grantsDialog.getByRole("button", { name: /^Remove / }).evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label").replace(/^Remove /, "")));
    if (R === "legal_team_member") await shot(page, "c53-confidential-access-dialog.png", "V-C53: Confidential access after Nadia Haddad grants Priya Raman");
    const business = options.filter((n) => ["Diego Salas", "Jonas Weber", "Amara Nwosu", "Lena Vogel", "Ade Balogun"].includes(n));
    await page.keyboard.press("Escape");
    await grantsDialog.waitFor({ state: "hidden" });
    expect(listed.includes("Priya Raman") && listed.includes(s.person.name) && business.length === 0, q({ listed, business }));
    return `Confidential access listed ${q(listed)} after Grant access. Person offered ${options.length - 1} people, no Business Users.`;
  });

  await step(R, page, "Grant step 4: turn on Confidential — restrict to the access list and check the saved result", "The switch is on after reload.", async () => {
    await page.getByRole("switch", { name: "Confidential — restrict to the access list" }).click();
    await settle(page);
    await reload(page);
    const on = await page.getByRole("switch", { name: "Confidential — restrict to the access list" }).isChecked();
    expect(on, "switch off after reload");
    return `After a reload the switch was on.`;
  });

  await step("legal_team_member (Priya Raman, comparison reader with a Grant)", reader.page, `V-C53 ${who}: a Grant gives the named person access`, "Priya opens the Confidential Entity.", async () => {
    await go(reader.page, `/entities/${S.id}`);
    const opens = await reader.page.getByRole("heading", { level: 1, name: S.legalName }).isVisible();
    expect(opens, "Priya could not open the Entity");
    return `Priya Raman opened ${S.legalName}.`;
  });

  await step(otherKey, o.page, `V-C53 ${who}: without a Grant the other role cannot reach the Confidential Entity; Holdings and register Holders show Restricted Entity; chart shows Confidential Entity; no self-grant`, "Direct open fails; Restricted Entity without a link on the parent's Holdings and in the register; chart node reads Confidential Entity with no link; self-grant refused.", async () => {
    const op = o.page;
    await go(op, `/entities/${S.id}`);
    const opens = await op.getByRole("heading", { level: 1, name: S.legalName }).isVisible().catch(() => false);
    const direct = await o.api("GET", `/entities/${S.id}`);
    await go(op, `/entities/${P.id}/ownership`);
    const owned = await sectionText(op, "Holdings in other Entities");
    await go(op, `/entities/${Rg.id}/ownership`);
    const regMembers = (await section(op, "Register of members").locator("tbody tr").allInnerTexts()).map(tidy);
    const secretLinks = await op.getByRole("link", { name: S.legalName }).count();
    await openChart(op, prefix);
    const view = await readChart(op);
    const restrictedNodes = view.nodes.filter((n) => n.restricted);
    if (R === "legal_team_member") {
      await op.getByRole("button", { name: "Fit to window" }).click();
      await wait(400);
      await shot(op, "c53-admin-without-grant-chart.png", `V-C53: ${o.person.name} (Administrator, no Grant) searches the chart; the Confidential sub-Entity is a Confidential Entity box`);
    }
    const named = view.nodes.some((n) => n.name === S.legalName);
    await go(op, "/entities?view=list");
    await op.getByRole("searchbox", { name: "Search entities by name" }).fill(S.legalName);
    await settle(op);
    const listed = await op.locator("main table tbody").getByRole("link", { name: S.legalName }).count();
    const me = await o.api("GET", "/me");
    const self = await o.api("POST", `/entities/${S.id}/grants`, { userId: me.json?.user?.id ?? me.json?.id });
    expect(!opens && direct.status === 404 && /Restricted Entity/.test(owned) && regMembers.some((r) => /Restricted Entity/.test(r)) && secretLinks === 0 && restrictedNodes.length >= 1 && restrictedNodes.every((n) => n.name === "Confidential Entity" && !n.href) && !named && listed === 0 && self.status >= 400, q({ opens, direct: direct.status, owned, regMembers, secretLinks, restrictedNodes, named, listed, self: self.status }));
    return `${o.person.name}: opening ${S.legalName} showed no record (API ${direct.status}). ${P.legalName}'s Holdings in other Entities read ${q(owned)}. ${Rg.legalName}'s Register of members read ${q(regMembers)}. The chart drew ${restrictedNodes.length} "Confidential Entity" node(s) with no link or name. A List search found ${listed} rows. A self-grant returned ${self.status} ${q(self.json?.detail)}.`;
  });

  await step(otherKey, o.page, `V-C53 ${who}: a register entry naming a Holder you cannot see can be edited, but that Holder cannot be replaced`, "Changing the To Holder on entry 004 is refused with the guide's message; the entry keeps its Holder.", async () => {
    const op = o.page;
    await go(op, `/entities/${Rg.id}/ownership`);
    const label = "Edit entry 4";
    await op.getByRole("button", { name: label, exact: true }).click();
    const d = op.getByRole("dialog", { name: "Edit entry 004" });
    await d.waitFor();
    const toShown = tidy(await d.getByLabel(req("To")).locator("option:checked").innerText());
    await d.getByLabel(req("To")).selectOption({ label: "Entity from the registry…" });
    await d.getByRole("combobox", { name: "Entity", exact: true }).selectOption({ label: U.legalName });
    await d.getByRole("button", { name: "Save" }).click();
    const alert = tidy(await d.getByRole("alert").innerText());
    await d.getByRole("button", { name: "Cancel" }).click();
    const entry = (await register(Rg, s)).entries.find((e) => e.entryNo === 4);
    expect(toShown === "Restricted Entity" && alert === "This entry names an Entity you cannot see. That holder stays until someone who can see the Entity changes it." && entry.to?.id && !/lone/.test(q(entry.to)), q({ toShown, alert, to: entry.to }));
    return `${o.person.name} opened ${q(label)}: To showed ${q(toShown)}. Replacing it with ${U.legalName} was refused with ${q(alert)}; the entry kept its Holder.`;
  });

  await step(otherKey, o.page, `V-C53 ${who}: an Officer user link, a linked Contract, a Holding and a register entry do not grant access`, "After being linked as an Officer, the user still cannot open the Entity; a reachable Contract signed by it shows Restricted Entity.", async () => {
    await go(page, `/entities/${S.id}`);
    const card = section(page, "Directors & Officers");
    await card.getByRole("button", { name: "Add director or officer" }).click();
    await card.getByLabel("Director or officer name", { exact: true }).fill(`Officer link ${who} ${TAG}`);
    await card.getByLabel("Linked user", { exact: true }).selectOption({ label: o.person.name });
    await card.getByRole("button", { name: "Add", exact: true }).click();
    await settle(page);
    const direct = await o.api("GET", `/entities/${S.id}`);
    await go(o.page, `/contracts/${c3.number}`);
    const pageHasRestricted = await o.page.getByText("Restricted Entity").count();
    const leaks = await o.page.getByText(S.legalName).count();
    expect(direct.status === 404 && pageHasRestricted > 0 && leaks === 0, q({ direct: direct.status, pageHasRestricted, leaks }));
    return `With ${o.person.name} linked as an Officer on ${S.legalName} (which also holds register shares and Holdings), reading it still returned ${direct.status}. On C-${c3.number}, whose Our entity is ${S.legalName}, ${o.person.name} saw "Restricted Entity" and the legal name appeared ${leaks} times.`;
  });

  await step(R, page, "Grant step 5: Remove <name> withdraws access; the recorded relationship is kept", "Priya leaves the list, cannot open the Entity, and sees Restricted Entity for the Holding; the actor still sees it.", async () => {
    await page.getByRole("button", { name: "Manage access" }).click();
    await grantsDialog.getByRole("button", { name: "Remove Priya Raman" }).click();
    await grantsDialog.getByRole("button", { name: "Remove Priya Raman" }).waitFor({ state: "detached" });
    const listed = await grantsDialog.getByRole("button", { name: /^Remove / }).evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label").replace(/^Remove /, "")));
    await page.keyboard.press("Escape");
    const direct = await reader.api("GET", `/entities/${S.id}`);
    await go(reader.page, `/entities/${P.id}/ownership`);
    const readerOwned = await sectionText(reader.page, "Holdings in other Entities");
    await go(page, `/entities/${P.id}/ownership`);
    const actorOwned = await sectionText(page, "Holdings in other Entities");
    expect(!listed.includes("Priya Raman") && direct.status === 404 && /Restricted Entity/.test(readerOwned) && actorOwned.includes(S.legalName), q({ listed, direct: direct.status, readerOwned, actorOwned }));
    return `After Remove Priya Raman the list read ${q(listed)}. Priya's read of ${S.legalName} returned ${direct.status}, and ${P.legalName}'s Holdings in other Entities showed her ${q(readerOwned)}. ${s.person.name} still saw ${q(actorOwned)}.`;
  });

  await step(R, page, "Negative: removing the last live person from a Confidential Entity is refused", "Removing yourself as the only grantee shows the refusal and keeps the Grant.", async () => {
    await go(page, `/entities/${S.id}`);
    await page.getByRole("button", { name: "Manage access" }).click();
    await grantsDialog.getByRole("button", { name: `Remove ${s.person.name}` }).click();
    const alert = grantsDialog.getByRole("alert");
    await alert.waitFor({ timeout: 8000 });
    const message = tidy(await alert.innerText());
    const still = await grantsDialog.getByRole("button", { name: `Remove ${s.person.name}` }).count();
    await page.keyboard.press("Escape");
    expect(message && still === 1, q({ message, still }));
    return `Removing ${s.person.name}, the only person in the list, showed ${q(message)} and the Grant stayed.`;
  });

  await step(R, page, "Turning the Confidential switch off makes the Entity available to all Legal Team Members and Administrators without Grants", "The other role and Priya can open the Entity again.", async () => {
    await page.getByRole("switch", { name: "Confidential — restrict to the access list" }).click();
    await settle(page);
    await reload(page);
    const off = !(await page.getByRole("switch", { name: "Confidential — restrict to the access list" }).isChecked());
    const other = await o.api("GET", `/entities/${S.id}`);
    const priya = await reader.api("GET", `/entities/${S.id}`);
    await go(o.page, `/entities/${S.id}`);
    const opens = await o.page.getByRole("heading", { level: 1, name: S.legalName }).isVisible();
    expect(off && other.status === 200 && priya.status === 200 && opens, q({ off, other: other.status, priya: priya.status, opens }));
    return `With the switch off after a reload, ${o.person.name} opened ${S.legalName} in the browser; reads returned ${other.status} for ${o.person.name} and ${priya.status} for Priya Raman, neither holding a Grant.`;
  });

  if (R === "administrator") {
    await step(R, page, "Negative: turning on Confidential with no live person in the list is refused", "After the Administrator removes the only Grant on an open Entity, the switch refuses with a message.", async () => {
      await go(page, `/entities/${U.id}`);
      await page.getByRole("button", { name: "Manage access" }).click();
      await grantsDialog.getByRole("button", { name: `Remove ${s.person.name}` }).click();
      await grantsDialog.getByText("No grants yet.").waitFor();
      await page.keyboard.press("Escape");
      await page.getByRole("switch", { name: "Confidential — restrict to the access list" }).click();
      await settle(page);
      const message = tidy(await page.getByText(/before making this entity confidential/).innerText().catch(() => ""));
      await reload(page);
      const on = await page.getByRole("switch", { name: "Confidential — restrict to the access list" }).isChecked();
      expect(message && !on, q({ message, on }));
      return `With "No grants yet." in Confidential access, turning on the switch showed ${q(message)}; after a reload the Entity was still open.`;
    });
  } else {
    await step(R, page, "Grant note: a Grant lets its holder change the flag and Grants; a Legal Team Member who removes their own Grant on an open Entity loses that control", "After removing the own Grant, the switch is unavailable and Manage access is gone.", async () => {
      await go(page, `/entities/${U.id}`);
      await page.getByRole("button", { name: "Manage access" }).click();
      await grantsDialog.getByRole("button", { name: `Remove ${s.person.name}` }).click();
      await grantsDialog.getByText("No grants yet.").waitFor();
      await page.keyboard.press("Escape");
      await reload(page);
      const disabled = await page.getByRole("switch", { name: "Confidential — restrict to the access list" }).isDisabled();
      const manage = await page.getByRole("button", { name: "Manage access" }).count();
      expect(disabled && manage === 0, q({ disabled, manage }));
      return `After ${s.person.name} removed their own Grant on the open ${U.legalName}, the switch was disabled and Manage access was absent after a reload.`;
    });
  }
}

// =====================================================================
// main
// =====================================================================
const phases = { c31, c32, c52, c53 };
await launch();
try {
  for (const phase of PHASES) {
    const fn = phases[phase];
    if (!fn) continue;
    if (phase === "c31") {
      try {
        await c31Setup();
      } catch (e) {
        log.notes.push(`c31 setup failed: ${e.message}`);
      }
    }
    for (const role of ROLES) {
      try {
        await fn(role);
      } catch (e) {
        log.steps.push({ article: current.article, scenario: current.scenario, role, method: "browser-walkthrough", action: `${phase} fixture or flow aborted`, expected: "The phase runs to the end.", actual: String(e?.message ?? e).slice(0, 600), result: "fail", startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() });
        console.log(`[${phase}] [${role}] ABORTED ${e.message}`);
        save();
      }
    }
    if (phase === "c31") {
      await c31BusinessUser().catch((e) => log.notes.push(`c31 business user: ${e.message}`));
      await c31Cleanup().catch((e) => log.notes.push(`c31 cleanup: ${e.message}`));
    }
    if (phase === "c52") await c52BusinessUser().catch((e) => log.notes.push(`c52 business user: ${e.message}`));
  }
} finally {
  save();
  await closeBrowser();
  const failed = log.steps.filter((s) => s.result !== "pass").length;
  console.log(`steps ${log.steps.length}, failed ${failed}, out ${OUT}`);
}
