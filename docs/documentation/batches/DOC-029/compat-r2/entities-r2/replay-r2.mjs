// DOC-029 round 2 compatibility replay, group entities. Adapted from entities/walkthrough-r1.mjs:
// only the lab (entities2), output paths, reviewer label, and record names (DOC-029r2) changed.
// Original header follows.
// DOC-029 independent walkthrough, group "entities", round 1.
// Written by the DOC-029 independent walkthrough agent (entities, round 1) from the
// article text of entities-and-counterparties, entity-records, entity-obligations,
// and entity-structure-and-access. It drives the real controls in headless Chromium.
// API calls only prepare fixtures (Contracts, a Matter, comparison checks) or read
// back a result that the browser step already showed.
//
// Run from the repository root:
//   LAB_PASSWORD=... mise exec -- node docs/documentation/batches/DOC-029/compat-r2/entities-r2/replay-r2.mjs
// Optional: PHASES=c31,c32,c52,c53 ROLES=legal_team_member,administrator OUT=<file>
// The seed password comes only from the environment. Cookies, magic links, and mail
// bodies are never written to the log.
import { chromium } from "../../../../../../node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs";
import { writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.LAB_APP_URL ?? "http://127.0.0.1:23302";
const MAIL = process.env.LAB_MAIL_URL ?? "http://127.0.0.1:23402";
const PASSWORD = process.env.LAB_PASSWORD;
if (!PASSWORD) throw new Error("LAB_PASSWORD is required");
const PHASES = (process.env.PHASES ?? "c31,c32,c52,c53").split(",");
const ROLES = (process.env.ROLES ?? "legal_team_member,administrator").split(",");
const OUT = process.env.OUT ?? path.join(here, "replay-r2.json");
const SHOTS = process.env.SHOTS ?? "/tmp/claude-1000/doc029r2-entities-shots";
const TAG = Date.now().toString(36).slice(-5).toUpperCase();
const ROOT = path.resolve(here, "../../../../../..");
const ARTICLES = [
  "entities-and-counterparties",
  "entity-records",
  "entity-obligations",
  "entity-structure-and-access",
];
const articleHashes = Object.fromEntries(
  ARTICLES.map((id) => [
    id,
    createHash("sha256")
      .update(readFileSync(path.join(ROOT, "docs/user-guides", `${id}.md`)))
      .digest("hex"),
  ]),
);
// Lab identity from the helper's manifest; only non-secret identity fields are copied.
const manifest = JSON.parse(
  readFileSync(path.join(ROOT, ".documentation-labs/entities2/lab.json"), "utf8"),
);
const running = Object.fromEntries(
  ["app", "doc-engine", "worker"].map((service) => [
    service,
    execFileSync("docker", [
      "inspect",
      "--format",
      "{{.Image}}",
      `${manifest.project}-${service}-1`,
    ])
      .toString()
      .trim(),
  ]),
);

const PEOPLE = {
  administrator: { email: "daniel.okafor@helix.example", name: "Daniel Okafor" },
  legal_team_member: { email: "nadia.haddad@helix.example", name: "Nadia Haddad" },
  comparison_legal: { email: "priya.raman@helix.example", name: "Priya Raman" },
  business_user_ravi: { email: "ravi.menon@helix.example", name: "Ravi Menon" },
  business_user_magic: { email: "jonas.weber@helix.example", name: "Jonas Weber" },
};

const log = {
  kind: "independent-article-walkthrough",
  batch: "DOC-029",
  group: "entities",
  round: 2,
  walkthroughReviewer: "DOC-029r2 compatibility reviewer (entities)",
  reviewerKind: "agent",
  appCommit: manifest.sourceCommit,
  environment: manifest.project,
  buildId: `app ${manifest.appImageId}; engine ${manifest.engineImageId}`,
  containerImages: manifest.containerImages,
  runningImageCheck: running,
  seed: {
    scale: manifest.seed?.scale,
    randomSeed: manifest.seed?.randomSeed,
    completedAt: manifest.seed?.completedAt,
    ai: manifest.seed?.ai,
    signing: manifest.seed?.signing,
  },
  articleHashes,
  browser: "Playwright 1.63.0 Chromium, headless, 1440x1000, one browser context per identity",
  appUrl: BASE,
  mailUrl: MAIL,
  tag: TAG,
  phases: PHASES,
  roles: ROLES,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  steps: [],
  // Page loads that showed the app's "Something went wrong." screen. Each is
  // recorded with the failing responses seen for that load, then reloaded once.
  errorScreens: [],
  shots: [],
};
async function shot(page, name, list, purpose) {
  await page.screenshot({ path: path.join(SHOTS, name) });
  list.push({
    path: `scratch (not kept): ${name}`,
    purpose,
    url: new URL(page.url()).pathname,
    at: new Date().toISOString(),
    theme: "light (default)",
    viewport: "1440x1000",
  });
}
function save() {
  log.finishedAt = new Date().toISOString();
  writeFileSync(OUT, JSON.stringify(log, null, 2) + "\n");
}

let current = { article: null, scenario: null };
async function step(role, action, expected, fn) {
  const entry = {
    article: current.article,
    scenario: current.scenario,
    role,
    method: "browser-walkthrough",
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
      .slice(0, 5)
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- sessions ----------
const browser = await chromium.launch();
const contexts = {};
async function session(key) {
  if (contexts[key]) return contexts[key];
  const person = PEOPLE[key];
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  watch(page);
  await page.goto(`${BASE}/auth/login`);
  await page.getByLabel("Email").fill(person.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 });
  contexts[key] = { context, page, person, key };
  return contexts[key];
}
async function magicSession(key) {
  if (contexts[key]) return contexts[key];
  const person = PEOPLE[key];
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  watch(page);
  const since = Date.now();
  await page.goto(`${BASE}/auth/login`);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.getByRole("heading", { name: "Get a sign-in link" }).waitFor();
  await page.getByLabel("Email").fill(person.email);
  await page.getByRole("button", { name: "Send link" }).click();
  await page.getByRole("heading", { name: "Check your email" }).waitFor({ timeout: 15000 });
  let href = null;
  for (let i = 0; i < 40 && !href; i++) {
    const found = await fetch(
      `${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${person.email}"`)}`,
    ).then((r) => r.json());
    const fresh = (found.messages ?? []).find((m) => Date.parse(m.Created) >= since - 2000);
    if (fresh) {
      const message = await fetch(`${MAIL}/api/v1/message/${fresh.ID}`).then((r) => r.json());
      const match = message.Text.match(/https?:\/\/\S+/g)?.find((u) =>
        /auth|magic|verify|token/i.test(u),
      );
      if (match) {
        const url = new URL(match.replace(/[)>\].,]+$/, ""));
        const lab = new URL(BASE);
        url.protocol = lab.protocol;
        url.host = lab.host;
        href = url.toString();
      }
    }
    if (!href) await wait(750);
  }
  expect(href, "no fresh sign-in link arrived in this lab's Mailpit");
  await page.goto(href);
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 });
  contexts[key] = { context, page, person, key };
  return contexts[key];
}
async function api(s, method, url, body) {
  const response = await s.context.request.fetch(`${BASE}${url}`, {
    method,
    data: body,
    headers: { origin: BASE },
  });
  let json = null;
  try {
    json = await response.json();
  } catch {}
  return { status: response.status(), json };
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
async function blurTo(page, heading) {
  await page.getByRole("heading", { name: heading, exact: true }).first().click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await wait(600);
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
  await checkErrorScreen(page, new URL(page.url()).pathname);
}

// ---------- shared fixtures ----------
// Entity and Contract type lists are Administrator-only reads, so the type IDs come
// from rows every legal role can read.
let typeIds = null;
async function typeId(s, name) {
  if (!typeIds) {
    const r = await api(s, "GET", "/api/v1/entities");
    typeIds = Object.fromEntries(
      (r.json.entities ?? []).map((e) => [e.entityTypeName, e.entityTypeId]),
    );
  }
  expect(typeIds[name], `no Entity type ${name} in readable rows`);
  return typeIds[name];
}
async function fixtureEntity(s, legalName, extra = {}) {
  const r = await api(s, "POST", "/api/v1/entities", {
    legalName,
    entityTypeId: await typeId(s, "Corporation"),
    ...extra,
  });
  expect(r.status === 201, `fixture Entity ${legalName} refused ${r.status}`);
  return r.json.entity;
}
let ndaTypeId = null;
async function fixtureContract(s, title, extra = {}) {
  if (!ndaTypeId) {
    const list = await api(s, "GET", "/api/v1/contracts?limit=100");
    ndaTypeId = (list.json.contracts ?? []).find(
      (c) => c.contractTypeName === "NDA",
    )?.contractTypeId;
  }
  const r = await api(s, "POST", "/api/v1/contracts", {
    title,
    contractTypeId: ndaTypeId,
    ...extra,
  });
  expect(r.status === 201, `fixture Contract ${title} refused ${r.status} ${q(r.json)}`);
  return r.json.contract;
}
async function registryRows(page) {
  return page.locator("main table tbody tr");
}

// =====================================================================
// V-C31 entities-and-counterparties
// =====================================================================
async function c31(roleKey) {
  current = { article: "entities-and-counterparties", scenario: "V-C31" };
  const s = await session(roleKey);
  const { page } = s;
  const R = roleKey;
  const who = R === "administrator" ? "A" : "L";
  const legalName = `DOC-029r2 entities C31 ${who} Aldoria Holdings ${TAG}`;
  let entityId = null;

  await step(
    R,
    "Register step 1: open Entities; first view is Calendar; select List",
    "Entities opens on Calendar; List shows the registry table.",
    async () => {
      await page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("link", { name: "Entities" })
        .click();
      await settle(page);
      const heading = await page.getByRole("heading", { name: "Compliance calendar" }).isVisible();
      const calendarUrl = new URL(page.url());
      expect(heading && !calendarUrl.searchParams.get("view"), "first view was not the Calendar");
      await page
        .getByRole("navigation", { name: "Registry view" })
        .getByRole("link", { name: "List" })
        .click();
      await settle(page);
      const header = await page.locator("main table thead").innerText();
      expect(/Legal name/.test(header), "List has no registry table");
      return `Entities opened at ${calendarUrl.pathname} with the Compliance calendar heading. List moved to ${new URL(page.url()).search} and showed a table headed ${q(header.replace(/\s+/g, " ").trim())}.`;
    },
  );

  await step(
    R,
    "Register step 2: Search entities by name, then Type/Status/Jurisdiction/Majority owner filters and Clear all",
    "Search narrows by legal name; each filter exists and narrows; Clear all removes filters.",
    async () => {
      const search = page.getByRole("searchbox", { name: "Search entities by name" });
      await search.fill("Helix Software GmbH");
      await settle(page);
      const names = await page.locator("main table tbody tr td:first-child").allInnerTexts();
      expect(
        names.length >= 1 && names.every((n) => /Helix Software GmbH/.test(n)),
        `search rows ${q(names)}`,
      );
      await search.fill("");
      await settle(page);
      const total = await page.locator("main table tbody tr").count();
      for (const label of ["Type", "Status", "Jurisdiction", "Majority owner"]) {
        expect(
          await page.getByRole("combobox", { name: label, exact: true }).isVisible(),
          `no ${label} filter`,
        );
      }
      await page
        .getByRole("combobox", { name: "Status", exact: true })
        .selectOption({ label: "Active" });
      await page
        .getByRole("combobox", { name: "Type", exact: true })
        .selectOption({ label: "LLC" });
      await settle(page);
      const filtered = await page.locator("main table tbody tr").allInnerTexts();
      expect(
        filtered.length > 0 &&
          filtered.length < total &&
          filtered.every((r) => /LLC/.test(r) && /Active/.test(r)),
        `filtered rows ${filtered.length}/${total}`,
      );
      await page
        .getByRole("button", { name: /^Clear all/ })
        .first()
        .click();
      await settle(page);
      const cleared = await page.locator("main table tbody tr").count();
      const typeValue = await page
        .getByRole("combobox", { name: "Type", exact: true })
        .inputValue();
      expect(cleared >= total && !typeValue, `after Clear all ${cleared} rows, Type=${typeValue}`);
      return `Search "Helix Software GmbH" left ${names.length} row(s), all with that name. Type LLC plus Status Active left ${filtered.length} of ${total} rows, each LLC and Active. Clear all returned ${cleared} rows and reset Type. Jurisdiction and Majority owner filters were present.`;
    },
  );

  await step(
    R,
    "Register steps 3-5: Add entity with identity details, Status default Active, Register, open the new Entity; creator Grant",
    "Dialog titled Add entity; Status defaults to Active; Register saves the details; the adder holds a Grant.",
    async () => {
      await page.getByRole("button", { name: "Add entity" }).click();
      const dialog = page.getByRole("dialog", { name: "Add entity" });
      await dialog.waitFor();
      const statusDefault = await dialog.getByLabel("Status").locator("option:checked").innerText();
      await dialog.getByLabel("Legal name").fill(legalName);
      const typeControl = dialog.getByLabel("Entity type");
      if ((await typeControl.evaluate((e) => e.tagName)) === "SELECT")
        await typeControl.selectOption({ label: "Corporation" });
      else {
        await typeControl.click();
        await page.getByRole("option", { name: "Corporation" }).click();
      }
      await dialog.getByLabel("Formation jurisdiction").fill("Republic of Aldoria");
      await dialog.getByLabel("Formed on").fill("2019-03-14");
      await dialog.getByLabel("Registration no.").fill(`ALD-${TAG}`);
      await dialog.getByLabel("Tax ID").fill(`TX-${TAG}`);
      await dialog.getByLabel("Registered agent").fill("Aldoria Corporate Agents");
      await dialog.getByLabel("Registered address").fill("1 Harbour Row, Port Aldo");
      await dialog.getByRole("button", { name: "Register" }).click();
      await dialog.waitFor({ state: "hidden", timeout: 15000 });
      await settle(page);
      // Open the new Entity from the registry.
      if (!/\/entities\/[^/?]+/.test(page.url())) {
        await page.getByRole("searchbox", { name: "Search entities by name" }).fill(legalName);
        await settle(page);
        await page.getByRole("link", { name: legalName }).first().click();
        await settle(page);
      }
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
      ]) {
        values[label] = await page
          .getByRole("main")
          .getByLabel(label, { exact: true })
          .inputValue();
      }
      expect(
        values["Registration no."] === `ALD-${TAG}` && values["Formed on"] === "2019-03-14",
        `saved ${q(values)}`,
      );
      const statusSaved = await page
        .getByRole("main")
        .getByLabel("Status", { exact: true })
        .locator("option:checked")
        .innerText();
      expect(
        statusDefault === "Active" && statusSaved === "Active",
        `Status default ${statusDefault}, saved ${statusSaved}`,
      );
      const manage = await page.getByRole("button", { name: "Manage access" }).isVisible();
      const grants = await api(s, "GET", `/api/v1/entities/${entityId}/grants`);
      const names = (grants.json?.grants ?? []).map((g) => g.displayName);
      expect(
        manage && names.includes(s.person.name),
        `Manage access ${manage}; grants ${q(names)}`,
      );
      return `The Add entity dialog opened with Status ${statusDefault}. Register saved ${q(legalName)} and the record opened with ${q(values)} and Status ${statusSaved}. The record offered Manage access, and its access list named ${s.person.name} (${q(names)}).`;
    },
  );

  await step(
    R,
    "Register step 5: change one field and move focus away; a selection saves when chosen; both survive reload; Status Dormant does not archive",
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
      const statusAfter = await page
        .getByRole("main")
        .getByLabel("Status", { exact: true })
        .locator("option:checked")
        .innerText();
      const archiveOffered = await page
        .getByRole("button", { name: "Archive", exact: true })
        .isVisible();
      const restoreOffered = await page
        .getByRole("button", { name: "Restore", exact: true })
        .isVisible();
      expect(
        agentAfter === "Aldoria Registered Agents Ltd" && statusAfter === "Dormant",
        `after reload agent=${agentAfter} status=${statusAfter}`,
      );
      expect(archiveOffered && !restoreOffered, "Dormant changed archive state");
      return `After a reload Registered agent read ${q(agentAfter)} and Status read ${statusAfter}. The record still offered Archive and no Restore, so the Dormant Status did not archive it.`;
    },
  );

  await step(
    R,
    "Names are not unique: registering the same legal name again creates another Entity",
    "A second Register with the same name creates a distinct record; the first is not changed.",
    async () => {
      await go(page, "/entities?view=list");
      await page.getByRole("button", { name: "Add entity" }).click();
      const dialog = page.getByRole("dialog", { name: "Add entity" });
      await dialog.getByLabel("Legal name").fill(legalName);
      const typeControl = dialog.getByLabel("Entity type");
      if ((await typeControl.evaluate((e) => e.tagName)) === "SELECT")
        await typeControl.selectOption({ label: "LLC" });
      await dialog.getByLabel("Formation jurisdiction").fill("Duchy of Kessel");
      await dialog.getByRole("button", { name: "Register" }).click();
      await dialog.waitFor({ state: "hidden", timeout: 15000 });
      await go(page, "/entities?view=list");
      await page.getByRole("searchbox", { name: "Search entities by name" }).fill(legalName);
      await settle(page);
      const rows = await page.locator("main table tbody tr").allInnerTexts();
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
      return `Searching the name listed 2 rows linking to 2 different records: ${q(rows.map((r) => r.replace(/\s+/g, " ").trim()))}. The first kept Republic of Aldoria and Dormant.`;
    },
  );

  await step(
    R,
    "Negative: blank Legal name has a clear outcome",
    "Register with no Legal name keeps the dialog open with the refusal message and creates nothing.",
    async () => {
      const probe = `/api/v1/entities?q=${encodeURIComponent("DOC-029r2 entities")}`;
      const before = await api(s, "GET", probe);
      await page.getByRole("button", { name: "Add entity" }).click();
      const dialog = page.getByRole("dialog", { name: "Add entity" });
      await dialog.getByRole("button", { name: "Register" }).click();
      const message = dialog.getByText("Name the entity — its registered legal name.");
      await message.waitFor({ timeout: 5000 });
      const stillOpen = await dialog.isVisible();
      await dialog
        .getByRole("button", { name: "Cancel" })
        .click()
        .catch(() => page.keyboard.press("Escape"));
      const after = await api(s, "GET", probe);
      const count = (r) => (r.json?.entities ?? []).length;
      expect(
        stillOpen && count(before) === count(after),
        `open=${stillOpen} before=${count(before)} after=${count(after)}`,
      );
      return `Register with an empty Legal name kept the dialog open and showed "Name the entity — its registered legal name.". The registry size stayed ${count(after)}.`;
    },
  );

  // Contract parties
  const contract = await fixtureContract(
    s,
    `DOC-029r2 entities C31 ${who} parties contract ${TAG}`,
  );
  const cedar = `DOC-029r2 entities Cedar Supply ${who} ${TAG}`;
  const birch = `DOC-029r2 entities Birch Logistics ${who} ${TAG}`;
  const counterparties = page.getByRole("combobox", { name: "Counterparties" });

  await step(
    R,
    "Parties step 1: choose Our entity on a Contract; it survives reload",
    "Our entity saves the chosen Entity.",
    async () => {
      await go(page, `/contracts/${contract.number}`);
      const our = page.getByRole("combobox", { name: "Our entity" });
      const option = our
        .locator("option", { hasText: "DOC-029r2 entities C31" })
        .filter({ hasText: legalName })
        .first();
      const value = await option.getAttribute("value");
      await our.selectOption(value);
      await settle(page);
      await reload(page);
      const shown = await page
        .getByRole("combobox", { name: "Our entity" })
        .locator("option:checked")
        .innerText();
      expect(shown === legalName, `Our entity after reload ${shown}`);
      return `C-${contract.number} Our entity read ${q(shown)} after a reload.`;
    },
  );

  await step(
    R,
    "Parties steps 2-3: type a new name and Create; the first Counterparty is Primary",
    "Create adds the new Counterparty to the Contract with the Primary mark.",
    async () => {
      await counterparties.fill(cedar);
      const create = page.getByRole("option", { name: `Create "${cedar}"` });
      await create.waitFor({ timeout: 10000 });
      await create.click();
      await settle(page);
      await reload(page);
      const shownPrimary = await page.getByText("Primary", { exact: true }).count();
      const detail = await contractPrimary(s, contract.number);
      expect(
        detail.names.length === 1 && detail.primary === cedar && shownPrimary === 1,
        `parties ${q(detail)} primary marks ${shownPrimary}`,
      );
      return `Create "${cedar}" added it. After a reload the Contract showed ${shownPrimary} Primary mark and its parties were ${q(detail.names)} with ${q(detail.primary)} primary.`;
    },
  );

  await step(
    R,
    "Parties step 4: add another Counterparty and Make primary",
    "Make primary moves the Primary mark to the chosen Counterparty.",
    async () => {
      await counterparties.fill(birch);
      await page.getByRole("option", { name: `Create "${birch}"` }).click();
      await settle(page);
      const make = page.getByRole("button", { name: "Make primary" });
      expect((await make.count()) === 1, `Make primary buttons ${await make.count()}`);
      await make.click();
      await settle(page);
      await reload(page);
      const detail = await contractPrimary(s, contract.number);
      expect(detail.primary === birch, `primary ${q(detail)}`);
      return `After Make primary and a reload the Contract's primary Counterparty was ${q(detail.primary)}; parties ${q(detail.names)}.`;
    },
  );

  await step(
    R,
    "Picker negatives: an exact existing name in another case offers no Create; a Counterparty on the Contract is not offered again",
    "No Create row for a case variant; the attached party is not listed.",
    async () => {
      await counterparties.fill(cedar.toUpperCase());
      await wait(1500);
      const options = await page.getByRole("listbox").getByRole("option").allInnerTexts();
      const create = options.some((o) => /^Create/.test(o.trim()));
      const offered = options.some((o) => o.includes(cedar));
      expect(!create && !offered, `options ${q(options)}`);
      await counterparties.fill("");
      return `Typing ${q(cedar.toUpperCase())} listed ${q(options)}: no Create row, and ${cedar} (already on the Contract) was not offered.`;
    },
  );

  await step(
    R,
    "Parties step 5: Take name off the contract; next remaining takes Primary; shared record remains; final removal leaves none",
    "Removing the Primary passes the mark; removal does not delete the shared Counterparty; removing the last leaves no Counterparties.",
    async () => {
      await page.getByRole("button", { name: `Take ${birch} off the contract` }).click();
      await settle(page);
      await reload(page);
      const afterFirst = await contractPrimary(s, contract.number);
      expect(
        afterFirst.primary === cedar && !afterFirst.names.includes(birch),
        `after removing primary ${q(afterFirst)}`,
      );
      const found = await api(s, "GET", `/api/v1/counterparties?q=${encodeURIComponent(birch)}`);
      const stillExists = JSON.stringify(found.json ?? {}).includes(birch);
      // Typing the removed name in another case offers the shared record, not a new one.
      await counterparties.fill(birch.toUpperCase());
      await wait(1500);
      const offered = await page.getByRole("listbox").getByRole("option").allInnerTexts();
      await counterparties.fill("");
      expect(
        offered.some((o) => o.includes(birch)) && !offered.some((o) => /^\s*Create/.test(o)),
        `shared record not offered or Create shown ${q(offered)} (search API found it: ${stillExists})`,
      );
      await page.getByRole("button", { name: `Take ${cedar} off the contract` }).click();
      await settle(page);
      await reload(page);
      const empty = await page.getByText("Nobody is recorded on the other side yet.").isVisible();
      expect(empty, "final removal did not leave an empty party list");
      return `Taking ${birch} off left ${q(afterFirst.names)} with ${cedar} Primary. Typing ${q(birch.toUpperCase())} offered the shared record and no Create row (${q(offered)}). Taking ${cedar} off showed "Nobody is recorded on the other side yet.".`;
    },
  );

  await step(
    R,
    "Recovery: an archived Entity is not offered for a new selection; the existing Contract keeps its reference",
    "Archive the chosen Entity; Our entity keeps showing it on C-n; another Contract does not offer it.",
    async () => {
      await go(page, `/entities/${entityId}`);
      await page.getByRole("button", { name: "Archive", exact: true }).click();
      await settle(page);
      const other = await fixtureContract(
        s,
        `DOC-029r2 entities C31 ${who} second contract ${TAG}`,
      );
      await go(page, `/contracts/${contract.number}`);
      const kept = await page
        .getByRole("combobox", { name: "Our entity" })
        .locator("option:checked")
        .innerText();
      await go(page, `/contracts/${other.number}`);
      const options = await page
        .getByRole("combobox", { name: "Our entity" })
        .locator("option")
        .allInnerTexts();
      const offered = options.filter((o) => o.includes(legalName));
      const values = await page
        .getByRole("combobox", { name: "Our entity" })
        .locator("option")
        .evaluateAll((os) => os.map((o) => o.value));
      expect(
        kept.includes(legalName) && offered.length === 1 && !values.includes(entityId),
        `kept ${q(kept)} offered ${q(offered)} archived id offered ${values.includes(entityId)}`,
      );
      // Only the second, live Entity with the same name remains available.
      await go(page, `/entities/${entityId}`);
      await page.getByRole("button", { name: "Restore", exact: true }).click();
      await settle(page);
      return `With the first ${q(legalName)} archived, C-${contract.number} still showed ${q(kept)} as Our entity. On C-${other.number} Our entity offered ${offered.length} option with that name; its value was the live duplicate's ID, not the archived record's. The Entity was then restored.`;
    },
  );
}
async function partiesText(page) {
  const label = page.getByText("Counterparties", { exact: true }).first();
  const box = label.locator("xpath=..");
  return (await box.innerText()).replace(/\s+/g, " ").trim();
}
async function contractPrimary(s, number) {
  const r = await api(s, "GET", `/api/v1/contracts/${number}`);
  const parties = r.json?.counterparties ?? [];
  const names = parties.map((p) => p.name);
  const primary = parties.find((p) => p.isPrimary)?.name ?? null;
  return { names, primary };
}

// =====================================================================
async function c31BusinessUsers() {
  current = { article: "entities-and-counterparties", scenario: "V-C31" };
  // Business Users have no password in the seed, so both sign in with a fresh magic link.
  for (const key of ["business_user_ravi", "business_user_magic"]) {
    const label =
      key === "business_user_magic"
        ? "business_user (Jonas Weber, magic link)"
        : "business_user (Ravi Menon, magic link)";
    await step(
      label,
      "Negative: a Business User cannot use the Member+ Entities destination",
      "No Entities navigation item; /entities sends the reader away; the Entities API refuses.",
      async () => {
        const s = await magicSession(key);
        const { page } = s;
        await go(page, "/");
        const nav = await page.getByRole("link", { name: "Entities", exact: true }).count();
        await go(page, "/entities");
        const landed = new URL(page.url()).pathname;
        const r = await api(s, "GET", "/api/v1/entities");
        expect(
          nav === 0 && !landed.startsWith("/entities") && r.status === 403,
          `nav=${nav} landed=${landed} api=${r.status}`,
        );
        return `Signed in as ${s.person.name}: ${nav} Entities links, /entities landed on ${landed}, and GET /api/v1/entities returned ${r.status}.`;
      },
    );
  }
}

// =====================================================================
// V-C32 entity-records
// =====================================================================
async function c32(roleKey) {
  current = { article: "entity-records", scenario: "V-C32" };
  const s = await session(roleKey);
  const { page } = s;
  const R = roleKey;
  const who = R === "administrator" ? "A" : "L";
  const main = await fixtureEntity(s, `DOC-029r2 entities C32 ${who} main ${TAG}`, {
    jurisdiction: "Republic of Aldoria",
  });
  const owned = await fixtureEntity(s, `DOC-029r2 entities C32 ${who} owned ${TAG}`);
  const third = await fixtureEntity(s, `DOC-029r2 entities C32 ${who} third ${TAG}`);
  const coOwner = await fixtureEntity(s, `DOC-029r2 entities C32 ${who} co-owner ${TAG}`);
  const officer = `Ines Castell ${who} ${TAG}`;
  const other = R === "administrator" ? "Nadia Haddad" : "Daniel Okafor";
  const body = page.getByRole("main");

  await step(
    R,
    "Officers steps 1-3: Directors & Officers, Add director or officer, name, Role, Appointed on, Linked user, Add",
    "The Officer row saves name, role, date and linked user.",
    async () => {
      await go(page, `/entities/${main.id}`);
      const card = page.getByRole("region", { name: "Directors & Officers" });
      await card.getByRole("button", { name: "Add director or officer" }).click();
      await card.getByLabel("Director or officer name", { exact: true }).fill(officer);
      await card.getByLabel("Role", { exact: true }).selectOption({ label: "Director" });
      await card.getByLabel("Appointed on", { exact: true }).fill("2022-05-09");
      await card.getByLabel("Linked user", { exact: true }).selectOption({ label: other });
      await card.getByRole("button", { name: "Add", exact: true }).click();
      await settle(page);
      await reload(page);
      const row = {
        name: await card.getByLabel(`${officer} Director or officer name`).inputValue(),
        role: await card.getByLabel(`${officer} Role`).locator("option:checked").innerText(),
        appointed: await card.getByLabel(`${officer} Appointed on`).inputValue(),
        user: await card.getByLabel(`${officer} Linked user`).locator("option:checked").innerText(),
      };
      expect(
        row.name === officer &&
          row.role === "Director" &&
          row.appointed === "2022-05-09" &&
          row.user === other,
        q(row),
      );
      return `After Add and a reload the row read ${q(row)}.`;
    },
  );

  await step(
    R,
    "Officers step 4: correct text and move focus away; choose another role saves",
    "Name edit saves on blur; Role selection saves at once.",
    async () => {
      const card = page.getByRole("region", { name: "Directors & Officers" });
      await card.getByLabel(`${officer} Director or officer name`).fill(`${officer} Jr`);
      await blurTo(page, "Directors & Officers");
      await reload(page);
      const renamed = await card.getByLabel(`${officer} Jr Director or officer name`).inputValue();
      await card.getByLabel(`${officer} Jr Director or officer name`).fill(officer);
      await blurTo(page, "Directors & Officers");
      await card.getByLabel(`${officer} Role`).selectOption({ label: "Secretary" });
      await settle(page);
      await reload(page);
      const role = await card.getByLabel(`${officer} Role`).locator("option:checked").innerText();
      expect(
        renamed === `${officer} Jr` && role === "Secretary",
        `renamed=${renamed} role=${role}`,
      );
      return `The name saved as ${q(renamed)} on blur and was set back; Role Secretary saved on selection and read ${role} after a reload.`;
    },
  );

  await step(
    R,
    "Negative: a resignation date before the appointment date is refused",
    "Refusal message; the appointment date is unchanged and no resignation is stored.",
    async () => {
      const card = page.getByRole("region", { name: "Directors & Officers" });
      await card.getByLabel(`${officer} Resigned on`).fill("2021-01-01");
      await blurTo(page, "Directors & Officers");
      const message = await page
        .getByText("The resignation date cannot be before the appointment date.")
        .first()
        .isVisible();
      await reload(page);
      const appointed = await card.getByLabel(`${officer} Appointed on`).inputValue();
      const resigned = await card.getByLabel(`${officer} Resigned on`).inputValue();
      expect(
        message && appointed === "2022-05-09" && resigned === "",
        `message=${message} appointed=${appointed} resigned=${resigned}`,
      );
      return `Resigned on 2021-01-01 showed "The resignation date cannot be before the appointment date.". After a reload Appointed on was ${appointed} and Resigned on was empty.`;
    },
  );

  await step(
    R,
    "Officers step 5: Resigned on retains a resignation; Show former reads former Officers; clearing the date returns the Officer",
    "The resigned Officer leaves the current list, returns with Show former, and clearing the date restores it as current.",
    async () => {
      const card = page.getByRole("region", { name: "Directors & Officers" });
      await card.getByLabel(`${officer} Resigned on`).fill("2024-08-31");
      await blurTo(page, "Directors & Officers");
      await reload(page);
      const currentCount = await card.getByLabel(`${officer} Director or officer name`).count();
      await card.getByLabel("Show former").check();
      await settle(page);
      const former = await card.getByLabel(`${officer} Resigned on`).inputValue();
      await card.getByLabel(`${officer} Resigned on`).fill("");
      await blurTo(page, "Directors & Officers");
      await reload(page);
      const back = await card.getByLabel(`${officer} Director or officer name`).count();
      expect(
        currentCount === 0 && former === "2024-08-31" && back === 1,
        `current=${currentCount} former=${former} back=${back}`,
      );
      return `With Resigned on 2024-08-31 the Officer left the current list (${currentCount} rows). Show former showed it with ${former}. Clearing the date and reloading returned it to the current list (${back} row).`;
    },
  );

  await step(
    R,
    "Officer note: Linking a user does not grant that person Entity access",
    "The linked user gains no Grant on the Entity.",
    async () => {
      const grants = await api(s, "GET", `/api/v1/entities/${main.id}/grants`);
      const names = (grants.json?.grants ?? []).map((g) => g.displayName);
      expect(!names.includes(other), `grants ${q(names)}`);
      return `The access list for the Entity named ${q(names)}; the linked user ${other} held no Grant. (Access effect on a Confidential Entity is exercised in V-C53.)`;
    },
  );

  await step(
    R,
    "Officer note: Remove name deletes the Officer entry",
    "The Officer is absent even with Show former.",
    async () => {
      const card = page.getByRole("region", { name: "Directors & Officers" });
      await card.getByRole("button", { name: `Remove ${officer}` }).click();
      await settle(page);
      await reload(page);
      await card.getByLabel("Show former").check();
      await settle(page);
      const count = await card.getByLabel(`${officer} Director or officer name`).count();
      expect(count === 0, `still ${count}`);
      return `After Remove ${officer} and a reload, Show former listed no row for it.`;
    },
  );

  const jur = `Nordvik ${who} ${TAG}`;
  const obligationLabel = `DOC-029r2 entities C32 ${who} licence renewal ${TAG}`;
  await step(
    R,
    "Registrations steps 1-3: Add registration with Jurisdiction, Registration number, Registered agent, Status Lapsed; Formation jurisdiction unchanged",
    "The row saves; the Entity's Formation jurisdiction stays the same.",
    async () => {
      const card = page.getByRole("region", { name: "Registrations" });
      await card.getByRole("button", { name: "Add registration" }).click();
      await card.getByLabel("Jurisdiction", { exact: true }).fill(jur);
      await card.getByLabel("Registration number", { exact: true }).fill(`NV-${TAG}`);
      await card.getByLabel("Registered agent", { exact: true }).fill("Nordvik Agents AS");
      await card.getByLabel("Status", { exact: true }).selectOption({ label: "Lapsed" });
      await card.getByRole("button", { name: "Add", exact: true }).click();
      await settle(page);
      await reload(page);
      const row = {
        number: await card.getByLabel(`${jur} Registration number`).inputValue(),
        agent: await card.getByLabel(`${jur} Registered agent`).inputValue(),
        status: await card.getByLabel(`${jur} Status`).locator("option:checked").innerText(),
      };
      const formation = await body
        .getByLabel("Formation jurisdiction", { exact: true })
        .inputValue();
      expect(
        row.number === `NV-${TAG}` &&
          row.status === "Lapsed" &&
          formation === "Republic of Aldoria",
        `${q(row)} formation=${formation}`,
      );
      return `The Registration ${jur} saved ${q(row)}. Formation jurisdiction still read ${q(formation)}.`;
    },
  );

  await step(
    R,
    "Registrations step 3: edit text and move focus away; a Status selection saves immediately",
    "Agent saves on blur; Withdrawn saves on selection.",
    async () => {
      const card = page.getByRole("region", { name: "Registrations" });
      await card.getByLabel(`${jur} Registered agent`).fill("Nordvik Corporate Agents AS");
      await blurTo(page, "Registrations");
      await card.getByLabel(`${jur} Status`).selectOption({ label: "Withdrawn" });
      await settle(page);
      await reload(page);
      const agent = await card.getByLabel(`${jur} Registered agent`).inputValue();
      const status = await card.getByLabel(`${jur} Status`).locator("option:checked").innerText();
      expect(
        agent === "Nordvik Corporate Agents AS" && status === "Withdrawn",
        `${agent} ${status}`,
      );
      return `After a reload Registered agent read ${q(agent)} and Status read ${status}.`;
    },
  );

  await step(
    R,
    "Registrations step 4 and note: Remove jurisdiction registration detaches linked Obligations and keeps them",
    "The Obligation linked to the Registration remains with no Registration link.",
    async () => {
      await go(page, `/entities/${main.id}/obligations`);
      await page.getByRole("button", { name: "Add obligation" }).click();
      const dialog = page.getByRole("dialog", { name: "Add obligation" });
      await dialog.getByLabel("Label", { exact: true }).fill(obligationLabel);
      await dialog.getByLabel("Due date", { exact: true }).fill("2027-03-31");
      await dialog
        .getByLabel("Registration", { exact: true })
        .selectOption({ label: `${jur} · NV-${TAG}` });
      await dialog.getByRole("button", { name: "Add obligation" }).click();
      await dialog.waitFor({ state: "hidden" });
      await go(page, `/entities/${main.id}`);
      const card = page.getByRole("region", { name: "Registrations" });
      await card.getByRole("button", { name: `Remove ${jur} registration` }).click();
      await settle(page);
      await reload(page);
      const gone = (await card.getByLabel(`${jur} Registration number`).count()) === 0;
      await go(page, `/entities/${main.id}/obligations`);
      const kept = await page.getByLabel(`${obligationLabel} label`).count();
      const registration = kept
        ? await page
            .getByLabel(`${obligationLabel} registration`)
            .locator("option:checked")
            .innerText()
        : null;
      expect(
        gone && kept === 1 && registration === "None",
        `gone=${gone} kept=${kept} registration=${registration}`,
      );
      return `An Obligation ${q(obligationLabel)} was linked to ${jur}. Remove ${jur} registration deleted the row; the Obligation stayed on the Entity with Registration ${q(registration)}.`;
    },
  );

  await step(
    R,
    "Holdings steps 1-4: Ownership tab, Add Holding, This Entity owns, Entity, Ownership percent, Add; Owners and Owned Entities on both records",
    "Holding appears under Owned Entities on the owner and under Owners on the owned Entity.",
    async () => {
      await go(page, `/entities/${main.id}/ownership`);
      await addHolding(page, "This Entity owns", owned.legalName, "60");
      await reload(page);
      const ownedList = await sectionText(page, "Owned Entities");
      await go(page, `/entities/${owned.id}/ownership`);
      const owners = await sectionText(page, "Owners");
      const pct = await page.getByLabel(`${main.legalName} ownership percent`).inputValue();
      expect(
        ownedList.includes(owned.legalName) && owners.includes(main.legalName) && pct === "60",
        `owned=${q(ownedList)} owners=${q(owners)} pct=${pct}`,
      );
      return `${main.legalName} listed ${owned.legalName} under Owned Entities; ${owned.legalName} listed ${main.legalName} under Owners at ${pct}%.`;
    },
  );

  await step(
    R,
    "Holdings: Owns this Entity direction; over-100 total warns but saves; correcting the row on blur clears it",
    "Second owner at 60% saves with 'Ownership totals 120% for name.'; changing a row to 40 saves and clears the warning.",
    async () => {
      await addHolding(page, "Owns this Entity", coOwner.legalName, "60");
      await settle(page);
      const warning = `Ownership totals 120% for ${owned.legalName}.`;
      const warned = await page.getByText(warning).isVisible();
      await reload(page);
      const saved = await page.getByLabel(`${coOwner.legalName} ownership percent`).inputValue();
      await page.getByLabel(`${coOwner.legalName} ownership percent`).fill("40");
      await blurTo(page, "Owners");
      await reload(page);
      const corrected = await page
        .getByLabel(`${coOwner.legalName} ownership percent`)
        .inputValue();
      const still = await page.getByText(/Ownership totals/).count();
      expect(
        warned && saved === "60" && corrected === "40" && still === 0,
        `warned=${warned} saved=${saved} corrected=${corrected} warnings=${still}`,
      );
      return `Adding ${coOwner.legalName} as owner at 60% showed ${q(warning)} and saved (${saved} after reload). Changing that row to 40 and moving focus saved ${corrected} and no total warning remained.`;
    },
  );

  await step(
    R,
    "Negative: an out-of-range row percentage is refused without changing the saved value",
    "150 is refused; the row still reads 40 after reload.",
    async () => {
      await page.getByLabel(`${coOwner.legalName} ownership percent`).fill("150");
      await blurTo(page, "Owners");
      const alerts = (await page.getByRole("alert").allInnerTexts()).join(" | ");
      await reload(page);
      const value = await page.getByLabel(`${coOwner.legalName} ownership percent`).inputValue();
      const other = await page.getByLabel(`${main.legalName} ownership percent`).inputValue();
      expect(
        value === "40" && other === "60" && alerts.length > 0,
        `value=${value} other=${other} alerts=${q(alerts)}`,
      );
      return `Entering 150 showed ${q(alerts)}. After a reload the row still read ${value} and the other Holding still read ${other}.`;
    },
  );

  await step(
    R,
    "Holdings note: the Entity cannot own itself, duplicate a directional Holding, or create a loop",
    "Self and existing related Entities are not offered; a loop is refused with a message.",
    async () => {
      await go(page, `/entities/${owned.id}/ownership`);
      await page.getByRole("button", { name: "Add Holding" }).click();
      const dialog = page.getByRole("dialog", { name: "Add Holding" });
      const combo = dialog.getByRole("combobox", { name: "Entity" });
      await combo.fill(`DOC-029r2 entities C32 ${who}`);
      const options = await dialog
        .getByRole("listbox", { name: "Entity matches" })
        .getByRole("option")
        .allInnerTexts();
      expect(
        !options.includes(owned.legalName) &&
          !options.includes(main.legalName) &&
          options.includes(third.legalName),
        `options ${q(options)}`,
      );
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      // owned owns third; then third owns main would close main -> owned -> third -> main.
      await addHolding(page, "This Entity owns", third.legalName, "100");
      await go(page, `/entities/${main.id}/ownership`);
      await page.getByRole("button", { name: "Add Holding" }).click();
      const loopDialog = page.getByRole("dialog", { name: "Add Holding" });
      await loopDialog.getByLabel("Relationship").selectOption({ label: "Owns this Entity" });
      await loopDialog.getByRole("combobox", { name: "Entity" }).fill(third.legalName);
      await loopDialog.getByRole("option", { name: third.legalName }).click();
      await loopDialog.getByLabel("Ownership percent").fill("10");
      await loopDialog.getByRole("button", { name: "Add", exact: true }).click();
      const alert = loopDialog.getByRole("alert");
      await alert.waitFor({ timeout: 8000 });
      const message = await alert.innerText();
      await page.keyboard.press("Escape");
      await reload(page);
      const owners = await sectionText(page, "Owners");
      expect(!owners.includes(third.legalName), `loop saved ${owners}`);
      return `On ${owned.legalName} the picker for "DOC-029r2 entities C32 ${who}" offered ${q(options)}: not itself and not ${main.legalName}, which already holds it. Adding ${third.legalName} as owner of ${main.legalName} (closing a loop through ${owned.legalName}) was refused with ${q(message)} and no Owner row was added.`;
    },
  );

  await step(
    R,
    "Holdings step 5: Remove name removes the Holding; neither Entity is deleted",
    "The Holding leaves both records; both Entities still open.",
    async () => {
      await go(page, `/entities/${owned.id}/ownership`);
      await page.getByRole("button", { name: `Remove ${coOwner.legalName}` }).click();
      await settle(page);
      await reload(page);
      const owners = await sectionText(page, "Owners");
      await go(page, `/entities/${coOwner.id}`);
      const opens = await page
        .getByRole("heading", { level: 1, name: coOwner.legalName })
        .isVisible();
      expect(!owners.includes(coOwner.legalName) && opens, `owners=${q(owners)} opens=${opens}`);
      return `After Remove ${coOwner.legalName}, Owners on ${owned.legalName} read ${q(owners)}; ${coOwner.legalName} still opened.`;
    },
  );

  let documentName = null;
  await step(
    R,
    "Documents: a new Entity has no pre-created folders; Upload, Choose files, Kind Executed, Upload gives a v1 row",
    "Empty Documents tab; the upload lands as v1 on this Entity only.",
    async () => {
      await go(page, `/entities/${main.id}/documents`);
      const empty = await page.getByText("No documents on this Entity yet.").isVisible();
      await page.getByRole("button", { name: "Upload", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Upload document" });
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        dialog.getByRole("button", { name: /Choose files/ }).click(),
      ]);
      await chooser.setFiles(
        path.join(here, "../../entities/fixtures", "doc029-entities-certificate.txt"),
      );
      await dialog.getByLabel("Kind").selectOption({ label: "Executed" });
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 20000 });
      await reload(page);
      const rowLocator = page
        .locator("main table tbody tr", { hasText: "doc029-entities-certificate" })
        .first();
      const kind = await rowLocator
        .locator("select")
        .first()
        .locator("option:checked")
        .innerText()
        .catch(() => null);
      const row = `${(await rowLocator.innerText()).split("\n")[0]} kind ${kind} ${/\bv1\b/.test(await rowLocator.innerText()) ? "v1" : "no v1"}`;
      documentName = "doc029-entities-certificate";
      await go(page, `/entities/${owned.id}/documents`);
      const sibling = await page.getByText("doc029-entities-certificate").count();
      expect(
        empty && / v1$/.test(row) && kind === "Executed" && sibling === 0,
        `empty=${empty} row=${q(row)} sibling=${sibling}`,
      );
      return `The Documents tab first showed "No documents on this Entity yet." with no folders. The upload produced the row ${q(row.replace(/\s+/g, " ").trim())}. ${owned.legalName} did not list it.`;
    },
  );

  await step(
    R,
    "Archive step 1: Archive saves immediately; Archived mark; editable controls unavailable",
    "Archived mark and restore note; Legal name disabled; add buttons absent.",
    async () => {
      await go(page, `/entities/${main.id}`);
      await page.getByRole("button", { name: "Archive", exact: true }).click();
      await settle(page);
      await reload(page);
      const mark = await page.getByText("Archived", { exact: true }).first().isVisible();
      const note = await page.getByText("This entity is archived. Restore it to edit.").isVisible();
      const nameDisabled = await body.getByLabel("Legal name", { exact: true }).isDisabled();
      const addOfficer = await page
        .getByRole("button", { name: "Add director or officer" })
        .count();
      const addRegistration = await page.getByRole("button", { name: "Add registration" }).count();
      await go(page, `/entities/${main.id}/obligations`);
      const addObligation = await page.getByRole("button", { name: "Add obligation" }).count();
      expect(
        mark &&
          note &&
          nameDisabled &&
          addOfficer === 0 &&
          addRegistration === 0 &&
          addObligation === 0,
        q({ mark, note, nameDisabled, addOfficer, addRegistration, addObligation }),
      );
      return `After Archive and a reload the record showed the Archived mark and "This entity is archived. Restore it to edit.". Legal name was disabled; Add director or officer, Add registration and Add obligation were absent.`;
    },
  );

  await step(
    R,
    "Archive: the archived Entity leaves ordinary registry and Holding picker results",
    "Not in List search without Show archived; not offered in Add Holding.",
    async () => {
      await go(page, "/entities?view=list");
      await page.getByRole("searchbox", { name: "Search entities by name" }).fill(main.legalName);
      await settle(page);
      const hidden = await page
        .locator("main table tbody")
        .getByRole("link", { name: main.legalName })
        .count();
      await go(page, `/entities/${coOwner.id}/ownership`);
      await page.getByRole("button", { name: "Add Holding" }).click();
      const dialog = page.getByRole("dialog", { name: "Add Holding" });
      await dialog.getByRole("combobox", { name: "Entity" }).fill(`DOC-029r2 entities C32 ${who}`);
      const options = await dialog
        .getByRole("listbox", { name: "Entity matches" })
        .getByRole("option")
        .allInnerTexts();
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      expect(
        hidden === 0 && !options.includes(main.legalName),
        `hidden=${hidden} options=${q(options)}`,
      );
      return `The List search found ${hidden} rows for the archived Entity, and Add Holding on ${coOwner.legalName} offered ${q(options)}, without it.`;
    },
  );

  await step(
    R,
    "Archive steps 2-3: List, Show archived, open the Entity, Restore; facts, relationships, Documents and Obligation remain; editing returns",
    "Show archived lists it; Restore brings back editing with data intact.",
    async () => {
      await go(page, "/entities?view=list");
      await page.getByRole("switch", { name: "Show archived" }).click();
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
      const addOfficer = await page
        .getByRole("button", { name: "Add director or officer" })
        .count();
      const formation = await body
        .getByLabel("Formation jurisdiction", { exact: true })
        .inputValue();
      await go(page, `/entities/${main.id}/ownership`);
      const ownedList = await sectionText(page, "Owned Entities");
      await go(page, `/entities/${main.id}/documents`);
      const doc = await page.getByText(documentName).count();
      await go(page, `/entities/${main.id}/obligations`);
      const obligation = await page.getByLabel(`${obligationLabel} label`).count();
      expect(
        listed === 1 &&
          editable &&
          addOfficer === 1 &&
          formation === "Republic of Aldoria" &&
          ownedList.includes(owned.legalName) &&
          doc > 0 &&
          obligation === 1,
        q({ listed, editable, addOfficer, formation, ownedList, doc, obligation }),
      );
      return `With Show archived on, the List showed ${listed} row for it. Restore returned an editable Legal name and Add director or officer. Formation jurisdiction ${q(formation)}, the Holding of ${owned.legalName}, the uploaded Document, and the Obligation all remained.`;
    },
  );
}
async function addHolding(page, relationship, entityName, percent) {
  await page.getByRole("button", { name: "Add Holding" }).click();
  const dialog = page.getByRole("dialog", { name: "Add Holding" });
  await dialog.getByLabel("Relationship").selectOption({ label: relationship });
  await dialog.getByRole("combobox", { name: "Entity" }).fill(entityName);
  await dialog.getByRole("option", { name: entityName, exact: true }).click();
  await dialog.getByLabel("Ownership percent").fill(percent);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await dialog.waitFor({ state: "hidden", timeout: 10000 });
  await settle(page);
}
async function sectionText(page, heading) {
  const h = page.getByRole("heading", { level: 2, name: heading, exact: true });
  return (await h.locator("xpath=ancestor::section[1]").innerText()).replace(/\s+/g, " ").trim();
}

// =====================================================================
// V-C52 entity-obligations
// =====================================================================
async function c52(roleKey) {
  current = { article: "entity-obligations", scenario: "V-C52" };
  const s = await session(roleKey);
  const { page } = s;
  const R = roleKey;
  const who = R === "administrator" ? "A" : "L";
  const entity = await fixtureEntity(s, `DOC-029r2 entities C52 ${who} entity ${TAG}`);
  const annual = `DOC-029r2 entities C52 ${who} annual return ${TAG}`;
  const oneOff = `DOC-029r2 entities C52 ${who} one-off licence ${TAG}`;
  const unassigned = `DOC-029r2 entities C52 ${who} unassigned review ${TAG}`;
  const scrap = `DOC-029r2 entities C52 ${who} scrap schedule ${TAG}`;
  const me = s.person.name;
  const jur = `Kessel ${who} ${TAG}`;
  let matterLabel = null;

  // A Registration so that the Registration link can be chosen.
  await api(s, "POST", `/api/v1/entities/${entity.id}/registrations`, {
    jurisdiction: jur,
    registrationNumber: `KS-${TAG}`,
    status: "active",
  });

  async function openAdd() {
    await page.getByRole("button", { name: "Add obligation" }).click();
    const dialog = page.getByRole("dialog", { name: "Add obligation" });
    await dialog.waitFor();
    return dialog;
  }

  await step(
    R,
    "Add steps 1-4: recurring Obligation with Registration, Assignee, Matter and Note",
    "The row shows the due date, recurrence and links.",
    async () => {
      await go(page, `/entities/${entity.id}/obligations`);
      const dialog = await openAdd();
      await dialog.getByLabel("Label", { exact: true }).fill(annual);
      await dialog.getByLabel("Due date", { exact: true }).fill("2025-09-30");
      await dialog.getByLabel("Repeat every (months)", { exact: true }).fill("12");
      await dialog
        .getByLabel("Registration", { exact: true })
        .selectOption({ label: `${jur} · KS-${TAG}` });
      await dialog.getByLabel("Assignee", { exact: true }).selectOption({ label: me });
      const matterOptions = await dialog
        .getByLabel("Matter", { exact: true })
        .locator("option")
        .allInnerTexts();
      matterLabel = matterOptions.find((o) => o !== "None");
      expect(matterLabel, "no reachable Matter offered");
      await dialog.getByLabel("Matter", { exact: true }).selectOption({ label: matterLabel });
      await dialog
        .getByLabel("Note", { exact: true })
        .fill("Fictional annual return for the walkthrough.");
      await dialog.getByRole("button", { name: "Add obligation" }).click();
      await dialog.waitFor({ state: "hidden" });
      await reload(page);
      const row = await obligationRow(page, annual);
      expect(
        row.due === "2025-09-30" &&
          row.repeat === "12" &&
          row.registration.startsWith(jur) &&
          row.assignee === me &&
          row.matter === matterLabel,
        q(row),
      );
      return `After Add obligation and a reload the row read ${q(row)}.`;
    },
  );

  await step(
    R,
    "Add step 2: a blank recurrence makes a one-off",
    "The one-off row has an empty recurrence.",
    async () => {
      const dialog = await openAdd();
      await dialog.getByLabel("Label", { exact: true }).fill(oneOff);
      await dialog.getByLabel("Due date", { exact: true }).fill("2026-11-20");
      await dialog.getByLabel("Assignee", { exact: true }).selectOption({ label: me });
      await dialog.getByRole("button", { name: "Add obligation" }).click();
      await dialog.waitFor({ state: "hidden" });
      await reload(page);
      const row = await obligationRow(page, oneOff);
      expect(row.due === "2026-11-20" && row.repeat === "", q(row));
      return `The one-off saved with due ${row.due} and a blank recurrence (${q(row)}).`;
    },
  );

  await step(
    R,
    "Negative: recurrence outside 1 to 1,200 months and a blank Label are refused",
    "1201 and 0 keep the dialog open with a message; a blank Label does not submit; nothing is created.",
    async () => {
      const outcomes = [];
      for (const months of ["1201", "0"]) {
        const dialog = await openAdd();
        await dialog
          .getByLabel("Label", { exact: true })
          .fill(`DOC-029r2 entities C52 ${who} bad recurrence ${months} ${TAG}`);
        await dialog.getByLabel("Due date", { exact: true }).fill("2027-01-31");
        await dialog.getByLabel("Repeat every (months)", { exact: true }).fill(months);
        await dialog.getByRole("button", { name: "Add obligation" }).click();
        await wait(1500);
        const alert = (await dialog.getByRole("alert").allInnerTexts()).join(" ");
        const invalid = await dialog
          .getByLabel("Repeat every (months)", { exact: true })
          .evaluate((e) => e.validationMessage);
        outcomes.push({ months, open: await dialog.isVisible(), message: alert || invalid });
        await dialog.getByRole("button", { name: "Cancel" }).click();
        await dialog.waitFor({ state: "hidden" });
      }
      const dialog = await openAdd();
      await dialog.getByLabel("Due date", { exact: true }).fill("2027-01-31");
      await dialog.getByRole("button", { name: "Add obligation" }).click();
      await wait(1000);
      const blankOpen = await dialog.isVisible();
      const blankMessage = await dialog
        .getByLabel("Label", { exact: true })
        .evaluate((e) => e.validationMessage);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await reload(page);
      const labels = await page
        .locator("main table tbody tr input[aria-label$=' label']")
        .evaluateAll((els) => els.map((e) => e.value));
      const leaked = labels.filter((l) => /bad recurrence/.test(l));
      expect(
        outcomes.every((o) => o.open && o.message) &&
          blankOpen &&
          blankMessage &&
          leaked.length === 0,
        q({ outcomes, blankOpen, blankMessage, labels }),
      );
      return `Outcomes ${q(outcomes)}. A blank Label kept the dialog open (${q(blankMessage)}). After a reload the Entity listed ${q(labels)}.`;
    },
  );

  await step(
    R,
    "Add step 5: edit an open row; text saves on focus change; a selection saves immediately",
    "Note saves on blur; Assignee Unassigned saves at once; both survive reload.",
    async () => {
      await page.getByLabel(`${oneOff} note`).fill("Renew before the end of November.");
      await blurTo(page, "Obligations");
      await page.getByLabel(`${oneOff} assignee`).selectOption({ label: "Unassigned" });
      await settle(page);
      await reload(page);
      const row = await obligationRow(page, oneOff);
      await page.getByLabel(`${oneOff} assignee`).selectOption({ label: me });
      await settle(page);
      expect(
        row.note === "Renew before the end of November." && row.assignee === "Unassigned",
        q(row),
      );
      return `After a reload the one-off had note ${q(row.note)} and assignee ${row.assignee}; the assignee was then set back to ${me}.`;
    },
  );

  await step(
    R,
    "Calendar steps 1-2: Calendar, Due-date list puts overdue open Obligations first; Entity and Assignee filters with Apply",
    "Overdue rows lead; the filter narrows to this Entity and assignee.",
    async () => {
      await go(page, "/entities");
      const dueTexts = await page.locator("main table tbody tr td:first-child").allInnerTexts();
      const overdueFlags = await page
        .locator("main table tbody tr td:first-child")
        .evaluateAll((tds) => tds.map((td) => /status-severe/.test(td.className)));
      const firstNotOverdue = overdueFlags.indexOf(false);
      const orderOk =
        firstNotOverdue === -1 || overdueFlags.slice(firstNotOverdue).every((f) => !f);
      const ourRow = page.locator("main table tbody tr", { hasText: annual });
      const ourOverdue = await ourRow
        .locator("td")
        .first()
        .evaluate((td) => /status-severe/.test(td.className))
        .catch(() => null);
      await page
        .getByRole("combobox", { name: "Entity", exact: true })
        .selectOption({ label: entity.legalName });
      await page
        .getByRole("combobox", { name: "Assignee", exact: true })
        .selectOption({ label: me });
      await page.getByRole("button", { name: "Apply" }).click();
      await settle(page);
      const rows = await page.locator("main table tbody tr").allInnerTexts();
      expect(
        orderOk &&
          overdueFlags.some(Boolean) &&
          ourOverdue === true &&
          rows.length === 2 &&
          rows.every((r) => r.includes(entity.legalName)) &&
          /2025/.test(rows[0]),
        q({ orderOk, ourOverdue, rows }),
      );
      return `The unfiltered list had ${overdueFlags.filter(Boolean).length} overdue rows, all before the first open future row (of ${dueTexts.length}); ${annual} carried the overdue treatment. Entity and Assignee plus Apply left ${q(rows.map((r) => r.replace(/\s+/g, " ").trim()))}, overdue first.`;
    },
  );

  await step(
    R,
    "Calendar step 3: Month, Previous month, Next month, Today, and Due-date list keep the filters",
    "The Entity and Assignee filter stays in the address across each change.",
    async () => {
      const trail = [];
      const keep = () => {
        const u = new URL(page.url());
        return (
          u.searchParams.get("entity") === entity.id && Boolean(u.searchParams.get("assignee"))
        );
      };
      const nav = page.getByRole("navigation", { name: "Calendar display" });
      await nav.getByRole("link", { name: "Month" }).click();
      await settle(page);
      trail.push(["Month", keep()]);
      for (const name of ["Previous month", "Next month", "Today"]) {
        await page
          .getByRole("link", { name })
          .or(page.getByRole("button", { name }))
          .first()
          .click();
        await settle(page);
        trail.push([name, keep()]);
      }
      await nav.getByRole("link", { name: "Due-date list" }).click();
      await settle(page);
      trail.push(["Due-date list", keep()]);
      const rows = await page.locator("main table tbody tr").count();
      expect(trail.every(([, k]) => k) && rows === 2, q({ trail, rows }));
      return `Each change kept the filter: ${q(trail)}; the list again showed ${rows} rows.`;
    },
  );

  await step(
    R,
    "Calendar step 2: From/To narrow by date; Include completed exists",
    "From 2026-11-01 to 2026-11-30 leaves only the one-off.",
    async () => {
      await page.getByLabel("From", { exact: true }).fill("2026-11-01");
      await page.getByLabel("To", { exact: true }).fill("2026-11-30");
      await page.getByRole("button", { name: "Apply" }).click();
      await settle(page);
      const rows = await page.locator("main table tbody tr").allInnerTexts();
      const include = await page.getByRole("checkbox", { name: "Include completed" }).isVisible();
      expect(rows.length === 1 && rows[0].includes(oneOff) && include, q({ rows, include }));
      return `From 2026-11-01 and To 2026-11-30 left ${q(rows.map((r) => r.replace(/\s+/g, " ").trim()))}. Include completed was available.`;
    },
  );

  await step(
    R,
    "Calendar step 4: no results shows Clear all; opening an Obligation goes to its Entity",
    "An empty window shows 'No obligations match' and Clear all; the row link opens the Entity's Obligations tab.",
    async () => {
      await page.getByLabel("From", { exact: true }).fill("2099-01-01");
      await page.getByLabel("To", { exact: true }).fill("2099-01-31");
      await page.getByRole("button", { name: "Apply" }).click();
      await settle(page);
      const empty = await page.getByText("No obligations match").isVisible();
      await page
        .getByRole("button", { name: "Clear all" })
        .or(page.getByRole("link", { name: "Clear all" }))
        .first()
        .click();
      await settle(page);
      const cleared = new URL(page.url()).search;
      await go(page, `/entities?entity=${entity.id}`);
      await page.getByRole("link", { name: annual }).click();
      await settle(page);
      const landed = new URL(page.url()).pathname;
      expect(
        empty && !/from=|entity=/.test(cleared) && landed === `/entities/${entity.id}/obligations`,
        q({ empty, cleared, landed }),
      );
      return `A 2099 window showed "No obligations match"; Clear all left the address ${q(cleared || "(no filters)")}. Selecting ${annual} opened ${landed}.`;
    },
  );

  await step(
    R,
    "Home: open Obligations assigned to you, subject to access; reading does not file or advance",
    "Home's Entity obligations section lists the overdue item; afterwards it is still due 2025-09-30 and still offers Mark filed.",
    async () => {
      await go(page, "/");
      const section = page.getByRole("region", { name: "Entity obligations" });
      const items = await section.getByRole("listitem").allInnerTexts();
      const found = items.find((i) => i.includes(annual)) ?? null;
      await go(page, `/entities/${entity.id}/obligations`);
      const row = await obligationRow(page, annual);
      const markFiled = await page.getByRole("button", { name: `Mark ${annual} filed` }).count();
      expect(found && row.due === "2025-09-30" && markFiled === 1, q({ items, row, markFiled }));
      return `Home's Entity obligations listed ${q(found.replace(/\s+/g, " ").trim())} (first of ${items.length} rows). After reading the calendar and Home the row was still due ${row.due} and still offered Mark ${annual} filed.`;
    },
  );

  await step(
    R,
    "Home: Administrators also see unassigned Obligations on Entities they can reach; others do not",
    R === "administrator"
      ? "An unassigned overdue Obligation appears on the Administrator's Home."
      : "An unassigned Obligation does not appear on the Legal Team Member's Home.",
    async () => {
      const dialog = await openAdd();
      await dialog.getByLabel("Label", { exact: true }).fill(unassigned);
      await dialog.getByLabel("Due date", { exact: true }).fill("2024-01-15");
      await dialog.getByRole("button", { name: "Add obligation" }).click();
      await dialog.waitFor({ state: "hidden" });
      await go(page, "/");
      const items = await page
        .getByRole("region", { name: "Entity obligations" })
        .getByRole("listitem")
        .allInnerTexts()
        .catch(() => []);
      const shown = items.some((i) => i.includes(unassigned));
      expect(R === "administrator" ? shown : !shown, q({ items: items.slice(0, 5) }));
      await go(page, `/entities/${entity.id}/obligations`);
      await page.getByRole("button", { name: `Delete ${unassigned}` }).click();
      await settle(page);
      return `${me}'s Home ${shown ? "listed" : "did not list"} the unassigned ${q(unassigned)} (first rows ${q(items.slice(0, 4).map((i) => i.replace(/\s+/g, " ").trim()))}). The fixture was then deleted.`;
    },
  );

  await step(
    R,
    "Mark filed steps 1-3: Mark filed dialog explanation and Filed on default; filing 2026-10-05 advances the annual to 2027-09-30; History records it",
    "Explanation names 12 months; Filed on starts at today's local date; the new due date is 2027-09-30; History shows the filing.",
    async () => {
      await page.getByRole("button", { name: `Mark ${annual} filed` }).click();
      const dialog = page.getByRole("dialog", { name: "Mark filed" });
      await dialog.waitFor();
      const explanation = (await dialog.locator("#mark-filed-explanation").innerText()).trim();
      const defaultDate = await dialog.getByLabel("Filed on").inputValue();
      const browserToday = await page.evaluate(() => new Date().toLocaleDateString("en-CA"));
      await dialog.getByLabel("Filed on").fill("2026-10-05");
      await dialog.getByRole("button", { name: "Mark filed" }).click();
      await dialog.waitFor({ state: "hidden" });
      await reload(page);
      const row = await obligationRow(page, annual);
      await page
        .getByRole("toolbar", { name: "Applets" })
        .getByRole("button", { name: "History" })
        .click();
      await settle(page);
      const history = (
        await page.getByText(new RegExp(`filed.*${annual}|${annual}.*filed`)).allInnerTexts()
      ).map((t) => t.replace(/\s+/g, " ").trim());
      await page.keyboard.press("Escape");
      expect(
        /12 months/.test(explanation) &&
          defaultDate === browserToday &&
          row.due === "2027-09-30" &&
          history.length > 0,
        q({ explanation, defaultDate, browserToday, row, history }),
      );
      return `Mark filed explained ${q(explanation)} and Filed on started at ${defaultDate} (the browser's local date ${browserToday}). Filing on 2026-10-05 moved the due date to ${row.due}. History showed ${q(history.slice(0, 2))}.`;
    },
  );

  await step(
    R,
    "One-off filing: keeps its due date, shows Filed, leaves open Obligations, cannot be filed again, row read-only; Include completed finds it",
    "Filed one-off stays 2026-11-20 with Filed; no Mark filed; controls disabled; calendar shows it only with Include completed.",
    async () => {
      await page.getByRole("button", { name: `Mark ${oneOff} filed` }).click();
      const dialog = page.getByRole("dialog", { name: "Mark filed" });
      const explanation = (await dialog.locator("#mark-filed-explanation").innerText()).trim();
      await dialog.getByRole("button", { name: "Mark filed" }).click();
      await dialog.waitFor({ state: "hidden" });
      await reload(page);
      const row = await obligationRow(page, oneOff);
      const filedPill = await page
        .locator("main table tbody tr", { has: page.getByLabel(`${oneOff} label`) })
        .getByText(/^Filed /)
        .innerText();
      const markFiled = await page.getByRole("button", { name: `Mark ${oneOff} filed` }).count();
      const disabled = await page.getByLabel(`${oneOff} due date`).isDisabled();
      await go(page, `/entities?entity=${entity.id}`);
      const open = await page.locator("main table tbody tr", { hasText: oneOff }).count();
      await page.getByRole("checkbox", { name: "Include completed" }).check();
      await page.getByRole("button", { name: "Apply" }).click();
      await settle(page);
      const completedRow = await page
        .locator("main table tbody tr", { hasText: oneOff })
        .allInnerTexts();
      expect(
        row.due === "2026-11-20" &&
          markFiled === 0 &&
          disabled &&
          open === 0 &&
          completedRow.length === 1 &&
          /Filed/.test(completedRow[0]),
        q({ row, filedPill, markFiled, disabled, open, completedRow }),
      );
      return `Mark filed said ${q(explanation)}. The one-off kept due ${row.due}, showed ${q(filedPill)}, offered no Mark filed, and its due date control was disabled. The filtered calendar listed it ${open} times, and with Include completed it showed ${q(completedRow[0].replace(/\s+/g, " ").trim())}.`;
    },
  );

  await step(
    R,
    "Recovery: correct an open recurring row's date; Delete removes the Obligation without filing",
    "The due date correction saves on blur; Delete removes the scrap Obligation.",
    async () => {
      await go(page, `/entities/${entity.id}/obligations`);
      const dialog = await openAdd();
      await dialog.getByLabel("Label", { exact: true }).fill(scrap);
      await dialog.getByLabel("Due date", { exact: true }).fill("2027-06-30");
      await dialog.getByLabel("Repeat every (months)", { exact: true }).fill("6");
      await dialog.getByRole("button", { name: "Add obligation" }).click();
      await dialog.waitFor({ state: "hidden" });
      await page.getByLabel(`${scrap} due date`).fill("2027-07-31");
      await blurTo(page, "Obligations");
      await reload(page);
      const corrected = (await obligationRow(page, scrap)).due;
      await page.getByRole("button", { name: `Delete ${scrap}` }).click();
      await settle(page);
      await reload(page);
      const gone = (await page.getByLabel(`${scrap} label`).count()) === 0;
      const annualKept = (await obligationRow(page, annual)).due;
      expect(
        corrected === "2027-07-31" && gone && annualKept === "2027-09-30",
        q({ corrected, gone, annualKept }),
      );
      return `The scrap schedule's due date saved as ${corrected}. Delete ${scrap} removed it; ${annual} still read ${annualKept}.`;
    },
  );

  await step(
    R,
    "Negative: an invalid due date correction is not saved",
    "Clearing the date box restores the saved date; nothing changes.",
    async () => {
      await page.getByLabel(`${annual} due date`).fill("");
      await blurTo(page, "Obligations");
      await reload(page);
      const due = (await obligationRow(page, annual)).due;
      expect(due === "2027-09-30", due);
      return `Clearing the due date and moving focus left ${due} stored after a reload.`;
    },
  );

  await step(
    R,
    "Archiving the Entity removes its Obligations from the calendar and Home until restored",
    "After Archive the annual Obligation is absent from Home and the calendar; after Restore it returns.",
    async () => {
      // Make the annual overdue again so it leads Home.
      await page.getByLabel(`${annual} due date`).fill("2025-09-30");
      await blurTo(page, "Obligations");
      await go(page, "/");
      const before = (
        await page
          .getByRole("region", { name: "Entity obligations" })
          .getByRole("listitem")
          .allInnerTexts()
      ).some((i) => i.includes(annual));
      await go(page, `/entities/${entity.id}`);
      await page.getByRole("button", { name: "Archive", exact: true }).click();
      await settle(page);
      await go(page, "/");
      const homeAfter = (
        await page
          .getByRole("region", { name: "Entity obligations" })
          .getByRole("listitem")
          .allInnerTexts()
          .catch(() => [])
      ).some((i) => i.includes(annual));
      await go(page, "/entities");
      const calendarAfter = await page.locator("main table tbody tr", { hasText: annual }).count();
      const entityOption = await page
        .getByRole("combobox", { name: "Entity", exact: true })
        .locator("option", { hasText: entity.legalName })
        .count();
      await go(page, `/entities/${entity.id}`);
      await page.getByRole("button", { name: "Restore", exact: true }).click();
      await settle(page);
      await go(page, "/entities");
      const calendarRestored = await page
        .locator("main table tbody tr", { hasText: annual })
        .count();
      expect(
        before && !homeAfter && calendarAfter === 0 && entityOption === 0 && calendarRestored === 1,
        q({ before, homeAfter, calendarAfter, entityOption, calendarRestored }),
      );
      return `Before archive Home listed ${annual}. After Archive, Home did not list it, the calendar had ${calendarAfter} rows for it, and the Entity filter did not offer the Entity. After Restore the calendar listed it again (${calendarRestored} row).`;
    },
  );

  await step(
    R,
    "Negative: a change on an archived Entity is refused (unauthorized/archived outcome)",
    "The row controls are disabled while archived and a direct write is refused with a message.",
    async () => {
      await go(page, `/entities/${entity.id}`);
      await page.getByRole("button", { name: "Archive", exact: true }).click();
      await settle(page);
      await go(page, `/entities/${entity.id}/obligations`);
      const disabled = await page.getByLabel(`${annual} due date`).isDisabled();
      const markFiled = await page.getByRole("button", { name: `Mark ${annual} filed` }).count();
      const list = await api(s, "GET", `/api/v1/entities/${entity.id}/obligations`);
      const id = (list.json?.obligations ?? []).find((o) => o.label === annual)?.id;
      const write = await api(s, "POST", `/api/v1/entities/${entity.id}/obligations/${id}/file`, {
        filedOn: "2026-10-06",
      });
      await go(page, `/entities/${entity.id}`);
      await page.getByRole("button", { name: "Restore", exact: true }).click();
      await settle(page);
      expect(
        disabled && markFiled === 0 && write.status >= 400,
        q({ disabled, markFiled, status: write.status }),
      );
      return `While archived the due date control was disabled and Mark filed was absent; a filing request was refused ${write.status} ${q(write.json?.detail)}. The Entity was restored.`;
    },
  );
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
async function obligationRow(page, label) {
  const read = async (field) => page.getByLabel(`${label} ${field}`).inputValue();
  const selected = async (field) =>
    page.getByLabel(`${label} ${field}`).locator("option:checked").innerText();
  return {
    due: await read("due date"),
    repeat: await read("repeat every (months)"),
    registration: await selected("registration"),
    assignee: await selected("assignee"),
    matter: await selected("matter"),
    note: await read("note"),
  };
}

async function c52BusinessUsers() {
  current = { article: "entity-obligations", scenario: "V-C52" };
  const legal = await session("legal_team_member");
  const entity = await fixtureEntity(legal, `DOC-029r2 entities C52 business refusal ${TAG}`);
  const s = await magicSession("business_user_magic");
  await step(
    "business_user (Jonas Weber, magic link)",
    "Negative: an unauthorized change has a clear outcome",
    "A Business User's Obligation write is refused.",
    async () => {
      const r = await api(s, "POST", `/api/v1/entities/${entity.id}/obligations`, {
        label: "DOC-029r2 entities C52 business refusal",
        nextDueOn: "2027-01-31",
      });
      expect(r.status === 403, `${r.status}`);
      return `POST to the Entity's obligations as Jonas Weber returned ${r.status} ${q(r.json?.detail)}.`;
    },
  );
}

// =====================================================================
// V-C53 entity-structure-and-access
// =====================================================================
async function c53(roleKey) {
  current = { article: "entity-structure-and-access", scenario: "V-C53" };
  const s = await session(roleKey);
  const { page } = s;
  const R = roleKey;
  const who = R === "administrator" ? "A" : "L";
  const otherKey = R === "administrator" ? "legal_team_member" : "administrator";
  const o = await session(otherKey);
  const reader = await session("comparison_legal");
  const prefix = `DOC-029r2 entities C53 ${who}`;
  const P = await fixtureEntity(s, `${prefix} parent ${TAG}`);
  const S = await fixtureEntity(s, `${prefix} secret sub ${TAG}`);
  const M = await fixtureEntity(s, `${prefix} minor owner ${TAG}`);
  const S2 = await fixtureEntity(s, `${prefix} plural sub ${TAG}`);
  const U = await fixtureEntity(s, `${prefix} lone ${TAG}`);
  const hold = async (owned, owner, pct) => {
    const r = await api(s, "POST", `/api/v1/entities/${owned.id}/holdings`, {
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
  const c1 = await fixtureContract(s, `${prefix} open contract ${TAG}`);
  const c2 = await fixtureContract(s, `${prefix} confidential contract ${TAG}`, {
    isConfidential: true,
  });
  const c3 = await fixtureContract(s, `${prefix} signed by secret sub ${TAG}`);
  for (const [c, e] of [
    [c1, P],
    [c2, P],
    [c3, S],
  ]) {
    const r = await api(s, "PATCH", `/api/v1/contracts/${c.number}`, { entityId: e.id });
    expect(r.status === 200, `Our entity fixture ${r.status} ${q(r.json)}`);
  }
  const body = page.getByRole("main");

  // ---------------- share capital ----------------
  await step(
    R,
    "Share capital steps 1-2, 4: Authorized shares saves on focus change, Issued shares on Enter; both survive reload",
    "10000 and 7500 persist.",
    async () => {
      await go(page, `/entities/${P.id}`);
      await typeInto(body.getByLabel("Authorized shares", { exact: true }), "10000");
      await blurTo(page, "Share capital");
      await typeInto(body.getByLabel("Issued shares", { exact: true }), "7500");
      await body.getByLabel("Issued shares", { exact: true }).press("Enter");
      await settle(page);
      await reload(page);
      const a = await body.getByLabel("Authorized shares", { exact: true }).inputValue();
      const i = await body.getByLabel("Issued shares", { exact: true }).inputValue();
      expect(plain(a) === "10000" && plain(i) === "7500", `${a} ${i}`);
      return `After a reload Authorized shares read ${a} (saved on focus change) and Issued shares read ${i} (saved with Enter).`;
    },
  );

  await step(
    R,
    "Share capital step 4: Escape abandons an unsaved edit",
    "Typing 999 then Escape restores 7500 and nothing is saved.",
    async () => {
      const issued = body.getByLabel("Issued shares", { exact: true });
      await typeInto(issued, "999");
      await issued.press("Escape");
      const shown = plain(await issued.inputValue());
      await blurTo(page, "Share capital");
      await reload(page);
      const stored = plain(await body.getByLabel("Issued shares", { exact: true }).inputValue());
      expect(shown === "7500" && stored === "7500", `${shown} ${stored}`);
      return `Escape returned the control to ${shown}; after a reload it read ${stored}.`;
    },
  );

  await step(
    R,
    "Negative: negative and fractional share counts are refused without replacing the saved value",
    "-5 and 12.5 show 'Enter a whole number of zero or more.'; 10000 stays.",
    async () => {
      const seen = [];
      for (const bad of ["-5", "12.5"]) {
        const field = body.getByLabel("Authorized shares", { exact: true });
        await typeInto(field, bad);
        await blurTo(page, "Share capital");
        const typed = plain(await field.inputValue());
        seen.push({
          bad,
          typed,
          message: await page.getByText("Enter a whole number of zero or more.").isVisible(),
        });
        await reload(page);
      }
      const stored = plain(
        await body.getByLabel("Authorized shares", { exact: true }).inputValue(),
      );
      expect(
        seen.every((x) => x.message && x.typed === x.bad) && stored === "10000",
        q({ seen, stored }),
      );
      return `Attempts ${q(seen)}. After each reload Authorized shares read ${stored}.`;
    },
  );

  await step(
    R,
    "Share capital step 2: leave a value blank when unknown",
    "Clearing Issued shares saves a blank value.",
    async () => {
      await typeInto(body.getByLabel("Issued shares", { exact: true }), "");
      await blurTo(page, "Share capital");
      await reload(page);
      const blank = await body.getByLabel("Issued shares", { exact: true }).inputValue();
      await typeInto(body.getByLabel("Issued shares", { exact: true }), "7500");
      await blurTo(page, "Share capital");
      expect(blank === "", blank);
      return `Clearing Issued shares saved a blank value (read ${q(blank)} after a reload); it was then set back to 7500.`;
    },
  );

  await step(
    R,
    "Share capital step 3 and note: Par value unavailable until Currency; amount with the currency's decimals; too many decimals refused; changing Currency keeps the amount",
    "Par value disabled with no Currency; GBP 1.25 saves; 1.255 refused; EUR keeps 1.25.",
    async () => {
      const par = body.getByLabel("Par value", { exact: true });
      const disabledBefore = await par.isDisabled();
      const currency = body.getByLabel("Currency", { exact: true });
      const currencyTag = await currency.evaluate((e) => e.tagName);
      const pick = async (code, label) => {
        if (currencyTag === "SELECT") await currency.selectOption({ label });
        else {
          await currency.click();
          await page.getByRole("option", { name: new RegExp(`^${code}`) }).click();
        }
        await settle(page);
      };
      await pick("GBP", "GBP — British Pound");
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
      await pick("EUR", "EUR — Euro");
      await reload(page);
      const afterEuro = await body.getByLabel("Par value", { exact: true }).inputValue();
      const currencyNow =
        currencyTag === "SELECT"
          ? await body.getByLabel("Currency", { exact: true }).locator("option:checked").innerText()
          : await body.getByLabel("Currency", { exact: true }).innerText();
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
      return `Par value was disabled before a Currency (${disabledBefore}) and enabled after GBP. 1.25 saved (${saved} after reload). 1.255 showed "Enter a non-negative amount with up to 2 decimal places." and ${afterRefusal} stayed stored. Changing Currency to ${currencyNow.trim()} kept ${afterEuro}.`;
    },
  );

  // ---------------- chart ----------------
  const chart = page.getByRole("region", { name: "Entity ownership chart" });
  const readChart = async (p = page) =>
    p.evaluate(() => {
      const region = document.querySelector('[role="region"][aria-label="Entity ownership chart"]');
      const nodes = [...region.querySelectorAll("svg g[data-restricted], svg g")].filter((g) =>
        g.querySelector(":scope > a > rect, :scope > rect"),
      );
      const out = nodes.map((g) => {
        const rect = g.querySelector("rect");
        const a = g.querySelector(":scope > a");
        return {
          name: a
            ? a.getAttribute("aria-label").replace(/^Open /, "")
            : g.getAttribute("aria-label"),
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
    "Chart steps 1-2: Chart draws the Holdings; primary owner solid, others dashed; highest percentage is primary even below 50%; an Entity with no Holdings in a separate row",
    "P→S 75% solid, M→S 25% dashed, P→S2 40% solid, M→S2 35% dashed; lone Entity unconnected on the last row.",
    async () => {
      await openChart(page, prefix);
      const view = await readChart();
      const edge = (owner, owned) => view.edges.find((e) => e.owner === owner && e.owned === owned);
      const e1 = edge(P.legalName, S.legalName);
      const e2 = edge(M.legalName, S.legalName);
      const e3 = edge(P.legalName, S2.legalName);
      const e4 = edge(M.legalName, S2.legalName);
      const lone = view.nodes.find((n) => n.name === U.legalName);
      // Earlier walkthrough runs left other matching Entities; compare with the connected nodes only.
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
          lone?.unconnected &&
          lone.y > maxOther,
        q({ e1, e2, e3, e4, lone, maxOther }),
      );
      return `Chart search ${q(prefix)} drew ${view.nodes.length} nodes. Edges: ${q([e1, e2, e3, e4])}. ${U.legalName} was marked unconnected at y=${lone.y}, a row below every connected node (max y=${maxOther}).`;
    },
  );

  await step(
    R,
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
          +arrowed.pan[0] === +fitted.pan[0] + 40 &&
          +zoomed.zoom > +arrowed.zoom &&
          same(zeroed, fitted) &&
          same(refitted, fitted),
        q({
          start,
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
    "Chart step 4: single click or Space highlights the ownership chain; Clear highlight or Escape removes it; double-click or Enter opens",
    "Click highlights S's chain; Clear highlight clears; Space on a node highlights and Escape clears; double-click and Enter open the Entity.",
    async () => {
      const node = (name) => chart.getByRole("link", { name: `Open ${name}` });
      await node(S.legalName).click();
      await wait(300);
      const clicked = await readChart();
      const chain = clicked.nodes
        .filter((n) => n.highlighted === "true")
        .map((n) => n.name)
        .sort();
      const clearVisible = await page.getByRole("button", { name: "Clear highlight" }).isVisible();
      const urlAfterClick = new URL(page.url()).search;
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
      const expectedChain = [P.legalName, M.legalName, S.legalName].sort();
      expect(
        q(chain) === q(expectedChain) &&
          clearVisible &&
          /view=chart/.test(urlAfterClick) &&
          cleared &&
          spaced.includes(M.legalName) &&
          escaped &&
          dbl === `/entities/${P.id}` &&
          entered === `/entities/${U.id}`,
        q({ chain, clearVisible, urlAfterClick, cleared, spaced, escaped, dbl, entered }),
      );
      return `A single click on ${S.legalName} stayed on the chart and highlighted ${q(chain)}; Clear highlight cleared it. Space on ${M.legalName} highlighted ${q(spaced)} and Escape cleared it. Double-click on ${P.legalName} opened ${dbl}; Enter on ${U.legalName} opened ${entered}.`;
    },
  );

  // ---------------- linked work ----------------
  await step(
    R,
    "Linked Contracts: the Contracts tab lists Contracts through Our entity; rows and counts reflect the reader's reach",
    "The comparison reader sees only the open Contract and a count of 1; the Confidential Contract contributes neither row nor count.",
    async () => {
      await go(page, `/entities/${P.id}/contracts`);
      const actorRows = await page.getByRole("main").getByRole("link").allInnerTexts();
      const actorBadge = await page
        .getByRole("navigation", { name: "Entity sections" })
        .getByRole("link", { name: /^Contracts/ })
        .innerText();
      const rp = reader.page;
      await go(rp, `/entities/${P.id}/contracts`);
      const readerRows = await rp.getByRole("main").getByRole("link").allInnerTexts();
      const readerTab = rp
        .getByRole("navigation", { name: "Entity sections" })
        .getByRole("link", { name: /^Contracts/ });
      const readerBadge =
        (await readerTab.getAttribute("aria-label")) ??
        (await readerTab
          .locator("[role=img]")
          .getAttribute("aria-label")
          .catch(() => null)) ??
        (await readerTab.innerText());
      const readerImg = await readerTab
        .getByRole("img")
        .getAttribute("aria-label")
        .catch(() => null);
      const c2direct = await api(reader, "GET", `/api/v1/contracts/${c2.number}`);
      const joinedReader = readerRows.join(" | ");
      expect(
        joinedReader.includes(c1.title) &&
          !joinedReader.includes(c2.title) &&
          readerImg === "1 linked Contract" &&
          c2direct.status >= 400,
        q({ actorRows, actorBadge, readerRows, readerImg, c2: c2direct.status }),
      );
      return `${s.person.name} saw ${q(actorRows.filter((r) => r.includes(prefix)))} on ${P.legalName}'s Contracts tab. Priya Raman (comparison Legal Team Member, not on the Confidential Contract) saw ${q(readerRows.filter((r) => r.includes(prefix)))} with the tab count ${q(readerImg)}; the Confidential C-${c2.number} was absent, and reading it directly returned ${c2direct.status}.`;
    },
  );

  await step(
    R,
    "Linked Matters tab: shows relationships only through saved Entity-valued Fields",
    "The Matters tab renders its linked-record list (no Entity-valued Matter Field exists in this lab).",
    async () => {
      await go(page, `/entities/${P.id}/matters`);
      const text = (await page.getByRole("main").innerText()).replace(/\s+/g, " ").trim();
      expect(/No linked records\./.test(text), text.slice(0, 200));
      return `The Matters tab for ${P.legalName} read ${q(text.slice(0, 120))}. The lab has no Entity-valued Matter Field, so no Matter could name this Entity; the roll-up rule was checked by source inspection only.`;
    },
  );

  // ---------------- access ----------------
  const grantsDialog = page.getByRole("dialog", { name: "Confidential access" });
  await step(
    otherKey,
    `Before Grants: ${otherKey === "administrator" ? "an Administrator can manage access while the Entity is not Confidential" : "a Legal Team Member without a Grant sees the switch unavailable and no Manage access"}`,
    otherKey === "administrator"
      ? "Manage access is offered on the open Entity added by the Legal Team Member."
      : "Switch disabled; no Manage access button on the open Entity added by the Administrator.",
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
    "Grant steps 1-3: Manage access, Confidential access, Person, Grant access; the list includes the person and you; only live Legal Team Members and Administrators are offered",
    "Priya Raman appears in the list with the actor; Business Users and archived users are not offered.",
    async () => {
      await go(page, `/entities/${S.id}`);
      await page.getByRole("button", { name: "Manage access" }).click();
      await grantsDialog.waitFor();
      const options = await grantsDialog.getByLabel("Person").locator("option").allInnerTexts();
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
          log.shots,
          "V-C53: Confidential access after Nadia Haddad grants Priya Raman",
        );
      const offeredBusiness = options.filter((n) =>
        ["Ravi Menon", "Jonas Weber", "Amara Nwosu", "Ade Balogun", "Gabriel Santos"].includes(n),
      );
      expect(
        listed.includes("Priya Raman") &&
          listed.includes(s.person.name) &&
          offeredBusiness.length === 0,
        q({ listed, offeredBusiness }),
      );
      await page.keyboard.press("Escape");
      await grantsDialog.waitFor({ state: "hidden" });
      return `Confidential access listed ${q(listed)} after Grant access. The Person choices (${options.length - 1} people) did not include Business Users or the archived Gabriel Santos.`;
    },
  );

  await step(
    R,
    "Grant step 4: turn on Confidential — restrict to the access list; check the saved result",
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
      const banner = await page
        .getByText("Confidential entity — only people with an access grant can access this entity.")
        .isVisible()
        .catch(() => false);
      expect(on, "switch off after reload");
      return `After a reload the switch was on${banner ? " and the Confidential entity banner showed" : ""}.`;
    },
  );

  await step(
    "legal_team_member (Priya Raman, comparison reader with a Grant)",
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
    `V-C53 ${who}: without a Grant, ${otherKey === "administrator" ? "an Administrator" : "a Legal Team Member"} cannot reach the Confidential Entity; Holding shows Restricted Entity; chart shows Confidential Entity; no self-grant`,
    "Direct open fails; parent's Owned Entities shows Restricted Entity without a link; chart node reads Confidential Entity with no link; self-grant refused.",
    async () => {
      const op = o.page;
      await go(op, `/entities/${S.id}`);
      const opens = await op
        .getByRole("heading", { level: 1, name: S.legalName })
        .isVisible()
        .catch(() => false);
      const direct = await api(o, "GET", `/api/v1/entities/${S.id}`);
      await go(op, `/entities/${P.id}/ownership`);
      const owned = await sectionText(op, "Owned Entities");
      const secretLinks = await op.getByRole("link", { name: S.legalName }).count();
      await openChart(op, prefix);
      const view = await readChart(op);
      const restrictedNodes = view.nodes.filter((n) => n.restricted);
      if (R === "legal_team_member") {
        await openChart(op, P.legalName);
        await op.getByRole("button", { name: "Fit to window" }).click();
        await wait(400);
        await shot(
          op,
          "c53-admin-without-grant-chart.png",
          log.shots,
          `V-C53: ${o.person.name} (Administrator, no Grant) searches the chart for ${P.legalName}; the Confidential sub-Entity is a Confidential Entity box`,
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
      const self = await api(o, "POST", `/api/v1/entities/${S.id}/grants`, {
        userId:
          (await api(o, "GET", "/api/v1/me")).json?.user?.id ??
          (await api(o, "GET", "/api/v1/me")).json?.id,
      });
      expect(
        !opens &&
          direct.status === 404 &&
          /Restricted Entity/.test(owned) &&
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
          secretLinks,
          restrictedNodes,
          named,
          listed,
          self: self.status,
        }),
      );
      return `${o.person.name}: opening ${S.legalName} showed no record (API ${direct.status}). ${P.legalName}'s Owned Entities read ${q(owned)} with no link to it. The chart drew ${restrictedNodes.length} node(s) labelled "Confidential Entity" with no link and no legal name. A List search for its name found ${listed} rows. A self-grant request returned ${self.status} ${q(self.json?.detail)}.`;
    },
  );

  await step(
    otherKey,
    `V-C53 ${who}: an Officer user link and a linked Contract do not grant access`,
    "After being linked as an Officer, the user still cannot open the Entity; a reachable Contract signed by it shows Restricted Entity.",
    async () => {
      await go(page, `/entities/${S.id}`);
      const card = page.getByRole("region", { name: "Directors & Officers" });
      await card.getByRole("button", { name: "Add director or officer" }).click();
      await card
        .getByLabel("Director or officer name", { exact: true })
        .fill(`Officer link ${who} ${TAG}`);
      await card.getByLabel("Linked user", { exact: true }).selectOption({ label: o.person.name });
      await card.getByRole("button", { name: "Add", exact: true }).click();
      await settle(page);
      const direct = await api(o, "GET", `/api/v1/entities/${S.id}`);
      await go(o.page, `/contracts/${c3.number}`);
      const our = o.page.getByRole("combobox", { name: "Our entity" });
      const ourText = (await our.count())
        ? await our.locator("option:checked").innerText()
        : await o.page
            .getByText("Restricted Entity")
            .first()
            .innerText()
            .catch(() => "");
      const pageHasRestricted = await o.page.getByText("Restricted Entity").count();
      const leaks = await o.page.getByText(S.legalName).count();
      expect(
        direct.status === 404 &&
          (/Restricted Entity/.test(ourText) || pageHasRestricted > 0) &&
          leaks === 0,
        q({ direct: direct.status, ourText, pageHasRestricted, leaks }),
      );
      return `With ${o.person.name} linked as an Officer on ${S.legalName}, reading the Entity still returned ${direct.status}. On C-${c3.number}, whose Our entity is ${S.legalName}, ${o.person.name} saw ${q(ourText || "Restricted Entity")} and the legal name appeared ${leaks} times.`;
    },
  );

  await step(
    R,
    "Grant step 5: Remove name withdraws access; the relationship is preserved",
    "Priya leaves the list, cannot open the Entity, and sees Restricted Entity for the Holding; the actor still sees the Holding.",
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
      const direct = await api(reader, "GET", `/api/v1/entities/${S.id}`);
      await go(reader.page, `/entities/${P.id}/ownership`);
      const readerOwned = await sectionText(reader.page, "Owned Entities");
      await go(page, `/entities/${P.id}/ownership`);
      const actorOwned = await sectionText(page, "Owned Entities");
      expect(
        !listed.includes("Priya Raman") &&
          direct.status === 404 &&
          /Restricted Entity/.test(readerOwned) &&
          actorOwned.includes(S.legalName),
        q({ listed, direct: direct.status, readerOwned, actorOwned }),
      );
      return `After Remove Priya Raman the list read ${q(listed)}. Priya's read of ${S.legalName} returned ${direct.status}, and ${P.legalName}'s Owned Entities showed her ${q(readerOwned)}. ${s.person.name} still saw ${q(actorOwned)}.`;
    },
  );

  await step(
    R,
    "Negative: removing the last live person from a Confidential Entity is refused",
    "Remove self as the only grantee shows the refusal and keeps the Grant.",
    async () => {
      await go(page, `/entities/${S.id}`);
      await page.getByRole("button", { name: "Manage access" }).click();
      await grantsDialog.getByRole("button", { name: `Remove ${s.person.name}` }).click();
      const alert = grantsDialog.getByRole("alert");
      await alert.waitFor({ timeout: 8000 });
      const message = await alert.innerText();
      const still = await grantsDialog
        .getByRole("button", { name: `Remove ${s.person.name}` })
        .count();
      await page.keyboard.press("Escape");
      expect(
        /Grant another person access before removing the last person/.test(message) && still === 1,
        q({ message, still }),
      );
      return `Removing ${s.person.name}, the only person in the list, showed ${q(message)} and the Grant stayed.`;
    },
  );

  await step(
    R,
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
      const other = await api(o, "GET", `/api/v1/entities/${S.id}`);
      const priya = await api(reader, "GET", `/api/v1/entities/${S.id}`);
      await go(o.page, `/entities/${S.id}`);
      const opens = await o.page.getByRole("heading", { level: 1, name: S.legalName }).isVisible();
      expect(
        off && other.status === 200 && priya.status === 200 && opens,
        q({ off, other: other.status, priya: priya.status, opens }),
      );
      return `With the switch off after a reload, ${o.person.name} opened ${S.legalName} in the browser and reads returned ${other.status} for ${o.person.name} and ${priya.status} for Priya Raman, none holding a Grant.`;
    },
  );

  if (R === "administrator") {
    await step(
      R,
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
        const message = await page
          .getByText("Grant at least one person access before making this entity confidential.")
          .isVisible();
        await reload(page);
        const on = await page
          .getByRole("switch", { name: "Confidential — restrict to the access list" })
          .isChecked();
        expect(message && !on, q({ message, on }));
        return `With "No grants yet." in Confidential access, turning on the switch showed "Grant at least one person access before making this entity confidential." and after a reload the Entity was still open.`;
      },
    );
  } else {
    await step(
      R,
      "Grant note: Grants let their holder change the flag and Grants; a Legal Team Member who removes their own Grant on an open Entity loses that control",
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
        return `After Nadia Haddad removed her own Grant on the open ${U.legalName}, the switch was disabled and Manage access was absent after a reload.`;
      },
    );
  }
}

// =====================================================================
// main
// =====================================================================
const phases = { c31, c32, c52, c53 };
try {
  for (const phase of PHASES) {
    if (phase === "c31bu") {
      await c31BusinessUsers();
      continue;
    }
    const fn = phases[phase];
    if (!fn) continue;
    for (const role of ROLES) await fn(role);
    if (phase === "c31") await c31BusinessUsers();
    if (phase === "c52") await c52BusinessUsers();
  }
} finally {
  save();
  await browser.close();
  const failed = log.steps.filter((s) => s.result !== "pass").length;
  console.log(`steps ${log.steps.length}, failed ${failed}, out ${OUT}`);
}
