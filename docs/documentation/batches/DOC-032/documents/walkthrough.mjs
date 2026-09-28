// DOC-032 independent browser walkthrough, documents group: document-versions (V-C26).
// Written by the DOC-032 independent walkthrough agent (documents) from the article text,
// on the DOC-032 documents V-C26 walkthrough.mjs pattern. New in DOC-032: the Administrator-only
// Delete version action, Document type colours and the seventh fixed type, Partially signed.
//
// Run from the worktree root against the shared work lab:
//   LAB_PASSWORD=... node docs/documentation/batches/DOC-032/documents/walkthrough.mjs
// Optional: ROLES=administrator,legal_team_member  OUT=<path> (default walkthrough.json here).
//
// API calls only prepare fictional records ("fixture"), make a second actor's attempt, or
// read results back ("read-back"). Every guide step runs in the browser as the named role.
// The Administrator adds one Matter, one Entity and one Contract Document type in the browser,
// named for this run, and archives them at the end (the lab is shared). A fixed type's colour
// is changed and put back at once.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  PEOPLE,
  staffContext,
  portalContext,
  api,
  close,
  BASE,
  MAIL,
  here,
  root,
  sleep,
} from "./lib.mjs";

const OUT = process.env.OUT ?? path.join(here, "walkthrough.json");
const ROLES = (process.env.ROLES ?? "administrator,legal_team_member").split(",");
const FIX = path.join(root, "docs/documentation/batches/DOC-029/documents/fixtures");
const REL = "docs/documentation/batches/DOC-032/documents";
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(4, 12);
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const fixture = (name) => path.join(FIX, name);
const fixtureHash = (name) => sha(fs.readFileSync(fixture(name)));
const A = "document-versions";
const S = "V-C26";
const lab = JSON.parse(
  fs.readFileSync(path.join(root, ".documentation-labs/work/lab.json"), "utf8"),
);
const FIXED = [
  "Draft · ours",
  "Draft · theirs",
  "Redline · theirs",
  "Redline · ours",
  "Partially signed",
  "Executed",
  "Amendment",
];
const MATTER_TYPE = `DOC-032 documents V-C26 Matter type ${stamp}`;
const ENTITY_TYPE = `DOC-032 documents V-C26 Entity type ${stamp}`;
const CONTRACT_TYPE = `DOC-032 documents V-C26 Contract type ${stamp}`;
// The pill class for the Purple colour (apps/web/src/lib/documents.ts DOCUMENT_TYPE_COLOR_PILL).
const PURPLE = "bg-status-assigned-bg";
const COLOURS = ["Automatic", "Grey", "Blue", "Amber", "Green", "Red", "Orange", "Purple"];
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const colourDocs = [];

const results = {
  kind: "independent-article-walkthrough",
  task: "DOC-032",
  group: "documents",
  walkthroughReviewer: "DOC-032 independent walkthrough agent (documents)",
  reviewerKind: "agent",
  appCommit: lab.sourceCommit,
  lab: {
    name: lab.name,
    project: lab.project,
    appImageId: lab.appImageId,
    engineImageId: lab.engineImageId,
    seed: lab.seed,
  },
  appUrl: BASE,
  mailUrl: MAIL,
  browser: "Playwright 1.63.0 Chromium, headless, one browser context per identity",
  articleHashes: { [A]: sha(fs.readFileSync(path.join(root, "docs/user-guides", `${A}.md`))) },
  fixtures: [
    "doc029-draft-v1.docx",
    "doc029-draft-v2.docx",
    "doc029-bulk-a.txt",
    "doc029-bulk-b.txt",
    "doc029-services-text.pdf",
  ].map((f) => ({
    path: `docs/documentation/batches/DOC-029/documents/fixtures/${f}`,
    sha256: fixtureHash(f),
  })),
  roles: ROLES,
  stamp,
  addedDocumentTypes: [],
  startedAt: new Date().toISOString(),
  finishedAt: null,
  records: [],
  productBugs: [],
  limitations: [],
  steps: [],
};
function save() {
  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2) + "\n");
}
function record(role, kind, name, ref) {
  results.records.push({ role, kind, name, ref });
}

let currentPage = null;
async function step(role, action, expected, fn, method = "browser-walkthrough") {
  const entry = {
    article: A,
    scenario: S,
    role,
    method,
    page: null,
    action,
    expected,
    actual: null,
    result: "not-run",
    startedAt: new Date().toISOString(),
    at: null,
  };
  results.steps.push(entry);
  try {
    entry.actual = await fn();
    entry.result = "pass";
  } catch (error) {
    entry.actual = `Check did not pass: ${error instanceof Error ? error.message.split("\n").slice(0, 4).join(" ") : String(error)}`;
    entry.result = "fail";
    if (currentPage) {
      const name = `fail-${results.steps.length}.png`;
      await currentPage.screenshot({ path: path.join(here, name) }).catch(() => {});
      entry.screenshot = `${REL}/${name}`;
    }
  }
  entry.page = currentPage ? new URL(currentPage.url()).pathname : null;
  entry.at = new Date().toISOString();
  console.log(
    `[${role}] ${entry.result.toUpperCase()}: ${action}${entry.result === "fail" ? `\n    ${entry.actual}` : ""}`,
  );
  save();
  return entry;
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}
const tidy = (s) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
async function until(fn, message, timeout = 15000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(300);
  }
  throw new Error(`timed out: ${message}`);
}

// ---------- fixture and read-back helpers (API) ----------
let userIds = null;
let contractTypeId = null;
async function loadFixtureIds() {
  const { context, page } = await staffContext(PEOPLE.daniel);
  const r = await api(page, "GET", "/users?limit=200");
  userIds = Object.fromEntries((r.body.users ?? []).map((u) => [u.email, u.id]));
  const o = await api(page, "GET", "/contracts/options");
  contractTypeId = o.body.contractTypes.find((t) => (t.name ?? t.displayName) === "NDA")?.id;
  await context.close();
}
async function addTeam(page, number, email) {
  const r = await api(page, "POST", `/contracts/${number}/team`, { userId: userIds[email] });
  expect([200, 201, 409].includes(r.status), `fixture team add ${r.status}`);
}
async function createContract(page, role, title) {
  const r = await api(page, "POST", "/contracts", { title, contractTypeId });
  expect(
    r.status === 201,
    `fixture contract refused ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`,
  );
  record(role, "contract", title, `C-${r.body.contract.number}`);
  return r.body.contract;
}
let matterTypeId = null;
async function createMatter(page, role, title) {
  if (!matterTypeId) {
    const o = await api(page, "GET", "/matters/options");
    matterTypeId = o.body.matterTypes.find((t) => !t.fields?.some((f) => f.isRequired))?.id;
  }
  const r = await api(page, "POST", "/matters", { title, matterTypeId });
  expect(
    r.status === 201,
    `fixture matter refused ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`,
  );
  record(role, "matter", title, `M-${r.body.matter.number}`);
  return r.body.matter;
}
async function createEntity(page, role, legalName) {
  const types = (await api(page, "GET", "/entities/types")).body.entityTypes;
  const r = await api(page, "POST", "/entities", { legalName, entityTypeId: types[0].id });
  expect(r.status === 201, `fixture entity ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  record(role, "entity", legalName, r.body.entity.id);
  return r.body.entity;
}
async function createKnowledge(page, role, title) {
  const kType = (await api(page, "GET", "/knowledge?limit=1")).body.knowledgeItems?.[0];
  const r = await api(page, "POST", "/knowledge", {
    title,
    knowledgeTypeId: kType.knowledgeTypeId,
  });
  expect(r.status === 201, `fixture knowledge ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  record(role, "knowledge_item", title, r.body.knowledgeItem.id);
  return { item: r.body.knowledgeItem, typeName: kType.knowledgeTypeName };
}
const MIME = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
};
function part(name, as = name) {
  return {
    name: as,
    mimeType: MIME[path.extname(name)] ?? "application/octet-stream",
    buffer: fs.readFileSync(fixture(name)),
  };
}
async function uploadApi(page, url, name, { as, documentTypeId } = {}) {
  const multipart = {};
  if (documentTypeId) multipart.documentTypeId = documentTypeId;
  multipart.file = part(name, as ?? name);
  const r = await api(page, "POST", url, undefined, multipart);
  expect(
    r.status === 201,
    `fixture upload refused ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`,
  );
  return r.body.document;
}
async function recordDocs(page, recordUrl, archived = false) {
  const docs = [];
  let cursor = null;
  do {
    const q = new URLSearchParams();
    if (cursor) q.set("cursor", cursor);
    if (archived) q.set("includeArchived", "true");
    const r = await api(page, "GET", `${recordUrl}/documents?${q}`);
    expect(r.status === 200, `read-back documents ${r.status}`);
    docs.push(...r.body.documents);
    cursor = r.body.nextCursor;
  } while (cursor);
  return docs;
}
async function getDoc(page, recordUrl, id) {
  return (await recordDocs(page, recordUrl, true)).find((d) => d.id === id) ?? null;
}
const vOf = (doc, n) => doc.versions.find((v) => v.versionNumber === n);
const snap = (v) => ({
  id: v.id,
  n: v.versionNumber,
  type: v.documentType?.displayName ?? null,
  kind: v.kind,
  note: v.note,
  file: v.originalFilename,
  by: v.uploadedBy?.id ?? v.uploadedBy?.displayName ?? null,
  sha: v.sha256 ?? null,
  executed: v.isExecuted,
});
async function download(page, trigger) {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), trigger()]);
  const file = await dl.path();
  return { name: dl.suggestedFilename(), sha256: sha(fs.readFileSync(file)) };
}
// Read-back of a type list. The list route answers Administrators only, so it always reads
// with a separate Administrator session, whatever role the walkthrough page belongs to.
let adminReader = null;
async function listTypes(_page, module) {
  adminReader ??= await staffContext(PEOPLE.daniel);
  const r = await api(adminReader.page, "GET", `/documents/types/${module}`);
  expect(r.status === 200, `read-back type list ${r.status}`);
  return (r.body.documentTypes ?? []).filter((t) => !t.archivedAt);
}

// ---------- UI helpers ----------
const docsSection = (page) => page.getByRole("region", { name: "Documents", exact: true });
async function openDocuments(page, url) {
  await page.goto(`${BASE}${url}`);
  const heading = docsSection(page).getByRole("heading", { name: "Documents" });
  const broken = page.getByText("Something went wrong.");
  await heading.or(broken).first().waitFor({ timeout: 30000 });
  if (await broken.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "Reload" }).click();
    await heading.waitFor({ timeout: 30000 });
  }
  await page.waitForLoadState("networkidle").catch(() => {});
}
async function rowMenu(page, title) {
  await page.getByRole("button", { name: `Actions for ${title}`, exact: true }).click();
  const menu = page.getByRole("menu");
  await menu.waitFor();
  return menu;
}
async function menuItems(page, title) {
  const menu = await rowMenu(page, title);
  const items = (await menu.getByRole("menuitem").allInnerTexts()).map((t) => t.trim());
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  return items;
}
async function chooseMenu(page, title, item) {
  const menu = await rowMenu(page, title);
  await menu.getByRole("menuitem", { name: item, exact: true }).click();
}
async function chooseFiles(page, button, files) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), button.click()]);
  await chooser.setFiles(files);
}
const rowOf = (page, title) =>
  page
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: `Actions for ${title}`, exact: true }) });
const typeSelect = (page, n, title) =>
  page.getByLabel(`Type of version ${n} of ${title}`, { exact: true });
async function optionTexts(select) {
  return (await select.locator("option").allInnerTexts()).map((t) => t.trim());
}
async function selectedText(select) {
  return (await select.locator("option:checked").innerText()).trim();
}
async function uploadDialog(page) {
  await docsSection(page).getByRole("button", { name: "Upload", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Upload document" });
  await dialog.waitFor();
  return dialog;
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(here, name) }).catch(() => {});
  results.screenshots ??= [];
  results.screenshots.push(`${REL}/${name}`);
}

// =====================================================================
// Settings: the type lists (Before you start)
// =====================================================================
async function settingsAdmin() {
  const role = "administrator";
  const { context, page } = await staffContext(PEOPLE.daniel);
  currentPage = page;
  let entityListWasEmpty = false;

  await step(
    role,
    "Before you start: open the profile menu, select Settings, then Documents; read the three type lists",
    "Documents shows Matters, Contracts and Entities tabs; the Contract list starts with the seven fixed types, Partially signed among them",
    async () => {
      await page.goto(`${BASE}/`);
      await page.getByRole("button", { name: PEOPLE.daniel.name, exact: true }).click();
      await page.getByRole("menuitem", { name: "Settings" }).click();
      await page.waitForURL((u) => u.pathname.startsWith("/settings"));
      const rail = page.getByRole("navigation", { name: "Settings sections" });
      await rail.getByRole("link", { name: "Documents", exact: true }).click();
      await page.waitForURL((u) => u.pathname === "/settings/documents/matters");
      const tabs = page.getByRole("navigation", { name: "Document type lists" });
      const tabNames = (await tabs.getByRole("link").allInnerTexts()).map(tidy);
      await tabs.getByRole("link", { name: "Contracts", exact: true }).click();
      await page.waitForURL((u) => u.pathname === "/settings/documents/contracts");
      await page.getByText("Draft · ours", { exact: true }).first().waitFor();
      const main = tidy(await page.getByRole("main").innerText());
      const fixedShown = FIXED.filter((n) => main.includes(n));
      const locks = await page.getByLabel(/has a fixed name\. Its colour can be changed\./).count();
      await tabs.getByRole("link", { name: "Entities", exact: true }).click();
      await page.waitForURL((u) => u.pathname === "/settings/documents/entities");
      await page.getByRole("button", { name: "Add type" }).waitFor();
      const entityTypes = await listTypes(page, "entity");
      entityListWasEmpty = entityTypes.length === 0;
      expect(tabNames.join(",") === "Matters,Contracts,Entities", `tabs ${tabNames}`);
      expect(fixedShown.length === 7, `fixed ${fixedShown}`);
      return `Profile menu (${PEOPLE.daniel.name}) -> Settings -> Documents opened /settings/documents/matters with tabs ${tabNames.join(", ")}. The Contracts tab listed ${fixedShown.join(", ")} (${locks} fixed-row lock labels) plus types other agents added. The Entities tab held ${entityTypes.length} active types at this moment (read-back).`;
    },
  );

  // An empty Entity list: no Type in the upload dialog and a dash in the Type column.
  const ent = await createEntity(
    page,
    role,
    `DOC-032 documents V-C26 empty-list Entity ${stamp} Ltd`,
  );
  await step(
    role,
    "Before you start and the Type column: with the Entity list empty, an Entity upload has no Type and the column shows a dash with no choice",
    "No Type control in Upload document; the new Version's Type cell reads a dash and offers no select",
    async () => {
      const now = await listTypes(page, "entity");
      if (now.length > 0) {
        results.limitations.push(
          `Entity type list was not empty when the empty-list check ran (${now.length} active types added by other agents on the shared lab).`,
        );
      }
      expect(
        now.length === 0,
        `entity list not empty (${now.map((t) => t.displayName)}); check needs an empty list`,
      );
      await openDocuments(page, `/entities/${ent.id}/documents`);
      const dialog = await uploadDialog(page);
      await chooseFiles(
        page,
        dialog.getByRole("button", { name: /Choose files$/ }),
        fixture("doc029-bulk-a.txt"),
      );
      const typeCount = await dialog.getByLabel("Type", { exact: true }).count();
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      const [doc] = await recordDocs(page, `/entities/${ent.id}`);
      const row = rowOf(page, doc.title);
      await row.waitFor();
      const selects = await typeSelect(page, 1, doc.title).count();
      const cells = (await row.getByRole("cell").allInnerTexts()).map(tidy);
      expect(
        typeCount === 0 && selects === 0 && cells.includes("—"),
        `type ${typeCount} selects ${selects} cells ${cells}`,
      );
      return `Entity "${ent.legalName}": Upload document showed Choose files and Note but no Type (count ${typeCount}). After Upload the row "${doc.title}" v1 had cells ${JSON.stringify(cells)}; the Type cell read "—" with no select (0 "Type of version 1" controls).`;
    },
  );

  for (const [module, tab, name] of [
    ["matter", "Matters", MATTER_TYPE],
    ["entity", "Entities", ENTITY_TYPE],
    ["contract", "Contracts", CONTRACT_TYPE],
  ]) {
    await step(
      role,
      `Setup as Administrator in the browser: Settings, Documents, ${tab} tab, Add type "${name}"`,
      "The new type appears in the list",
      async () => {
        await page.goto(`${BASE}/settings/documents/${tab.toLowerCase()}`);
        await page.getByRole("button", { name: "Add type" }).click();
        await page.getByLabel("New type name").fill(name);
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await page.getByText(name, { exact: true }).first().waitFor({ timeout: 15000 });
        const t = (await listTypes(page, module)).find((x) => x.displayName === name);
        expect(t, "type not read back");
        results.addedDocumentTypes.push({ module, name, id: t.id, leftInPlace: true });
        record(role, `document_type:${module}`, name, t.id);
        return `Add type, New type name "${name}", Save added the row on the ${tab} tab (read-back active in the ${module} list). The run archives it after the last role (see addedDocumentTypes).`;
      },
    );
  }

  const colourOf = async (name) =>
    (await listTypes(page, "contract")).find((t) => t.displayName === name) ?? null;
  async function pickColour(name, colour) {
    const swatch = page.getByRole("button", { name: `Colour for ${name}`, exact: true });
    await swatch.click();
    const pop = page.getByRole("dialog", { name: `Colour for ${name}` });
    await pop.waitFor();
    const offered = (await pop.getByRole("button").allInnerTexts()).map(tidy);
    await pop.getByRole("button", { name: colour, exact: true }).click();
    await pop.waitFor({ state: "hidden", timeout: 15000 });
    return { offered, title: await swatch.getAttribute("title") };
  }

  await step(
    role,
    "Configure Document type colours: Settings, Documents, Contracts, select the colour swatch beside the run's Contract type; choose Purple, then Automatic, then Purple again",
    "The swatch offers Automatic and seven colours; each choice saves at once without a Save button; Automatic restores the default",
    async () => {
      await page.goto(`${BASE}/settings/documents/contracts`);
      await page.getByText(CONTRACT_TYPE, { exact: true }).first().waitFor();
      const first = await pickColour(CONTRACT_TYPE, "Purple");
      const afterPurple = (await colourOf(CONTRACT_TYPE))?.color;
      const auto = await pickColour(CONTRACT_TYPE, "Automatic");
      const afterAuto = (await colourOf(CONTRACT_TYPE))?.color;
      const again = await pickColour(CONTRACT_TYPE, "Purple");
      const afterAgain = (await colourOf(CONTRACT_TYPE))?.color;
      expect(
        COLOURS.every((c) => first.offered.includes(c)) && first.offered.length === 8,
        `offered ${first.offered}`,
      );
      expect(
        afterPurple === "purple" && afterAuto === null && afterAgain === "purple",
        `read-back ${afterPurple}/${afterAuto}/${afterAgain}`,
      );
      return `Contracts tab: the button "Colour for ${CONTRACT_TYPE}" opened a popover "Colour for ${CONTRACT_TYPE}" offering ${first.offered.join(", ")}. Choosing Purple closed it and saved at once (read-back color ${afterPurple}; swatch title "${first.title}"). Automatic saved null (swatch title "${auto.title}"). Purple again read back ${afterAgain} (swatch title "${again.title}").`;
    },
  );

  await step(
    role,
    "Configure Document type colours: a fixed Contract type keeps its name but takes a colour (Partially signed, changed and put back at once)",
    "The fixed row has no rename control and says its colour can be changed; a colour choice saves; the name stays; the prior colour is restored",
    async () => {
      const name = "Partially signed";
      await page.goto(`${BASE}/settings/documents/contracts`);
      await page.getByText(name, { exact: true }).first().waitFor();
      const prior = await colourOf(name);
      expect(prior && prior.systemKind === "partially_signed", `prior ${JSON.stringify(prior)}`);
      const lock = await page
        .getByLabel(`${name} has a fixed name. Its colour can be changed.`)
        .count();
      const lockText = lock
        ? `${name} has a fixed name. Its colour can be changed.`
        : tidy(
            await page
              .getByTitle(/has a fixed name/)
              .first()
              .getAttribute("title")
              .catch(() => ""),
          );
      const rename = await page.getByRole("button", { name: `Rename ${name}` }).count();
      const target = prior.color === "red" ? "Green" : "Red";
      const set = await pickColour(name, target);
      const during = await colourOf(name);
      const priorLabel = prior.color
        ? prior.color[0].toUpperCase() + prior.color.slice(1)
        : "Automatic";
      await pickColour(name, priorLabel);
      const restored = await colourOf(name);
      expect(rename === 0 && lockText, `rename ${rename} lock ${lockText}`);
      expect(
        during.color === target.toLowerCase() && during.displayName === name,
        `during ${JSON.stringify(during)}`,
      );
      expect(restored.color === prior.color, `restored ${restored.color} prior ${prior.color}`);
      return `The fixed row "${name}" (systemKind partially_signed) had no "Rename ${name}" control and carried "${lockText}". Its colour read back ${prior.color ?? "null (Automatic)"}. Choosing ${target} saved at once (read-back color ${during.color}, name still "${during.displayName}"; swatch title "${set.title}"). Choosing ${priorLabel} put it back (read-back ${restored.color ?? "null"}) within the same step.`;
    },
  );
  await context.close();
}

async function settingsLegal() {
  const role = "legal_team_member";
  const { context, page } = await staffContext(PEOPLE.nadia);
  currentPage = page;
  await step(
    role,
    "Before you start: the Documents type lists are Administrator only",
    "Settings shows no Documents section to a Legal Team Member; the address sends them to their profile",
    async () => {
      await page.goto(`${BASE}/`);
      await page.getByRole("button", { name: PEOPLE.nadia.name, exact: true }).click();
      await page.getByRole("menuitem", { name: "Settings" }).click();
      await page.waitForURL((u) => u.pathname.startsWith("/settings"));
      const rail = page.getByRole("navigation", { name: "Settings sections" });
      await rail.waitFor();
      const links = (await rail.getByRole("link").allInnerTexts()).map(tidy);
      await page.goto(`${BASE}/settings/documents/matters`);
      await page.waitForURL((u) => u.pathname === "/settings/profile", { timeout: 15000 });
      expect(!links.includes("Documents"), `links ${links}`);
      return `Nadia's Settings rail listed ${links.join(", ")} with no Documents. Opening /settings/documents/matters landed on /settings/profile.`;
    },
  );
  await context.close();
}

// =====================================================================
// document-versions (V-C26), per staff role
// =====================================================================
let portal = null;
async function versions(role, person) {
  const label = role === "administrator" ? "Admin" : "Legal";
  const { context, page } = await staffContext(person);
  currentPage = page;
  const contract = await createContract(
    page,
    role,
    `DOC-032 documents V-C26 ${label} versions Contract ${stamp}`,
  );
  await addTeam(page, contract.number, PEOPLE.amara.email);
  const matter = await createMatter(
    page,
    role,
    `DOC-032 documents V-C26 ${label} versions Matter ${stamp}`,
  );
  const recUrl = `/contracts/${contract.number}`;
  let first;
  let second;
  const contractTypes = await listTypes(page, "contract");

  await step(
    role,
    "Upload a new Document steps 1-4 on a Contract: Documents tab, Upload, Upload document dialog, Choose files (one file), Type (starts on No type), Note, Upload",
    "One Document named from its filename at v1 with the chosen type; Type offers No type plus the Contract list and no Generated redline; the first upload takes Primary",
    async () => {
      await openDocuments(page, `${recUrl}/documents`);
      const dialog = await uploadDialog(page);
      const choose = dialog.getByRole("button", { name: /Choose files$/ });
      await chooseFiles(page, choose, fixture("doc029-draft-v1.docx"));
      const type = dialog.getByLabel("Type", { exact: true });
      const start = await selectedText(type);
      const options = await optionTexts(type);
      expect(start === "No type", `Type started on ${start}`);
      expect(
        options[0] === "No type" && FIXED.every((k) => options.includes(k)),
        `options ${options}`,
      );
      expect(!options.includes("Generated redline"), `options ${options}`);
      expect(
        options.length === contractTypes.length + 1,
        `options ${options.length} list ${contractTypes.length}`,
      );
      await type.selectOption({ label: "Draft · ours" });
      await dialog.getByLabel("Note").fill("DOC-032 round one note");
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      const docs = await recordDocs(page, recUrl);
      expect(docs.length === 1, `expected one Document, read ${docs.length}`);
      first = docs[0];
      const row = rowOf(page, first.title);
      await row.waitFor();
      const text = tidy(await row.innerText());
      const shown = await selectedText(typeSelect(page, 1, first.title));
      expect(/v1/.test(text) && shown === "Draft · ours", `row ${text} type ${shown}`);
      expect(
        first.title.startsWith("doc029-draft-v1") && first.isPrimary,
        `title ${first.title} primary ${first.isPrimary}`,
      );
      expect(/Primary/.test(text), `no Primary mark: ${text}`);
      return `Upload document had Choose files, Type and Note. Type started on "No type" and offered ${options.length} options: ${options.join(", ")}; no Generated redline. After Upload one row "${first.title}" (from the filename) showed v1, the Primary mark and Type "Draft · ours"; read-back isPrimary true, note "DOC-032 round one note".`;
    },
  );

  await step(
    role,
    "Upload step 2 variant: choosing several files opens the bulk import dialog instead",
    "An Import dialog replaces the one-file composer; Cancel creates nothing",
    async () => {
      const dialog = await uploadDialog(page);
      await chooseFiles(page, dialog.getByRole("button", { name: /Choose files$/ }), [
        fixture("doc029-bulk-a.txt"),
        fixture("doc029-bulk-b.txt"),
      ]);
      const batch = page.getByRole("dialog", { name: /Import 2 files/ });
      await batch.waitFor();
      const title = tidy(await batch.getByRole("heading").first().innerText());
      await batch.getByRole("button", { name: "Cancel" }).click();
      await batch.waitFor({ state: "hidden" });
      const docs = await recordDocs(page, recUrl);
      expect(docs.length === 1, `count ${docs.length}`);
      return `Two chosen files opened the "${title}" dialog instead of the composer. Cancel closed it; the Contract still held one Document.`;
    },
  );

  const newName = `DOC-032 documents V-C26 ${label} supply draft ${stamp}`;
  await step(
    role,
    "Upload step 4: Actions, Edit details, Save changes the name and description",
    "Name and description change; the Version chain is untouched",
    async () => {
      await chooseMenu(page, first.title, "Edit details");
      const dialog = page.getByRole("dialog", { name: "Edit details" });
      await dialog.getByLabel("Name").fill(newName);
      await dialog.getByLabel("Description").fill("DOC-032 fictional description");
      await dialog.getByRole("button", { name: "Save" }).click();
      await dialog.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: `Actions for ${newName}`, exact: true }).waitFor();
      const doc = await getDoc(page, recUrl, first.id);
      expect(
        doc.title === newName &&
          doc.description === "DOC-032 fictional description" &&
          doc.versions.length === 1,
        JSON.stringify(doc).slice(0, 200),
      );
      first = doc;
      return `Actions -> Edit details -> Save stored the name "${newName}" and a description. Read-back: still one Version, v1, Type Draft · ours.`;
    },
  );

  const v1Hash = fixtureHash("doc029-draft-v1.docx");
  let v1Before;
  await step(
    role,
    "Add another Version steps 1-3: Actions, Add version, Choose file, Type (starts on No type), Note, Upload; the arrow beside the name shows earlier Versions; read v1",
    "Version number rises to v2 without copying v1's type; the arrow sits after the name; v1 opens in the reader and downloads its original bytes",
    async () => {
      v1Before = snap(vOf(first, 1));
      await chooseMenu(page, newName, "Add version");
      const dialog = page.getByRole("dialog", { name: "Add version" });
      await dialog.waitFor();
      await chooseFiles(
        page,
        dialog.getByRole("button", { name: /Choose file$/ }),
        fixture("doc029-draft-v2.docx"),
      );
      const start = await selectedText(dialog.getByLabel("Type", { exact: true }));
      expect(start === "No type", `Add version Type started on ${start}`);
      await dialog.getByLabel("Note").fill("DOC-032 round two note");
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      const row = rowOf(page, newName);
      await row.getByText("v2", { exact: true }).waitFor();
      const v2Type = await selectedText(typeSelect(page, 2, newName));
      const toggle = page.getByRole("button", {
        name: `Show the 1 earlier version of ${newName}`,
        exact: true,
      });
      const nameBox = await row.getByText(newName, { exact: true }).first().boundingBox();
      const toggleBox = await toggle.boundingBox();
      expect(
        nameBox && toggleBox && toggleBox.x > nameBox.x,
        `arrow ${JSON.stringify(toggleBox)} name ${JSON.stringify(nameBox)}`,
      );
      await toggle.click();
      await page.getByRole("button", { name: "doc029-draft-v1.docx", exact: true }).click();
      const panel = page.getByRole("complementary", { name: `${newName}, version 1` });
      await panel.waitFor({ timeout: 30000 });
      const chip = await panel.getByText("v1", { exact: true }).first().isVisible();
      const dl = await download(page, () => panel.getByRole("link", { name: "Download" }).click());
      await panel.getByRole("button", { name: "Close the document" }).click();
      const doc = await getDoc(page, recUrl, first.id);
      const v1 = snap(vOf(doc, 1));
      expect(dl.sha256 === v1Hash, `v1 download hash ${dl.sha256}`);
      expect(
        doc.versions.length === 2 && JSON.stringify(v1) === JSON.stringify(v1Before),
        `v1 changed ${JSON.stringify(v1)}`,
      );
      expect(v2Type === "No type" && vOf(doc, 2).documentType === null, `v2 type ${v2Type}`);
      first = doc;
      return `Add version showed Choose file, Type (started on "No type") and Note. After Upload the row read v2 and v2's Type read "${v2Type}" (v1 was Draft · ours; not copied). The arrow "Show the 1 earlier version of ${newName}" sits to the right of the name (x ${Math.round(toggleBox.x)} > ${Math.round(nameBox.x)}). It listed doc029-draft-v1.docx; selecting it opened the reader "${newName}, version 1" (v1 chip ${chip ? "visible" : "absent"}); Download returned the original v1 bytes (SHA-256 match). v1 kept its note, type, filename and uploader.`;
    },
  );

  await step(
    role,
    "History: uploading the same paper as a new Document creates a separate chain",
    "A second Document at v1; the first chain is not merged or changed",
    async () => {
      const dialog = await uploadDialog(page);
      await chooseFiles(
        page,
        dialog.getByRole("button", { name: /Choose files$/ }),
        fixture("doc029-draft-v1.docx"),
      );
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      const docs = await recordDocs(page, recUrl);
      const again = docs.find((d) => d.id !== first.id);
      second = again;
      expect(
        docs.length === 2 && again && (await getDoc(page, recUrl, first.id)).versions.length === 2,
        `docs ${docs.length}`,
      );
      return `The same file uploaded again made a second Document "${again.title}" at v1 (not Primary: ${!again.isPrimary}); "${newName}" still had two Versions.`;
    },
  );

  await step(
    role,
    "Type column: correct v2's type from the column to the fixed type Partially signed, then back to No type",
    "Only the type changes; bytes, note, author, number and Executed pin stay",
    async () => {
      const select = typeSelect(page, 2, newName);
      const options = await optionTexts(select);
      const before = snap(vOf(await getDoc(page, recUrl, first.id), 2));
      await select.selectOption({ label: "Partially signed" });
      let doc = await until(async () => {
        const d = await getDoc(page, recUrl, first.id);
        return vOf(d, 2).documentType?.displayName === "Partially signed" ? d : null;
      }, "type change read-back");
      const mid = snap(vOf(doc, 2));
      const bytes = await api(page, "GET", `/documents/${first.id}/versions/${mid.id}/download`);
      const same = ["id", "n", "note", "file", "by", "sha", "executed"].every(
        (k) => mid[k] === before[k],
      );
      await typeSelect(page, 2, newName).selectOption({ label: "No type" });
      doc = await until(async () => {
        const d = await getDoc(page, recUrl, first.id);
        return vOf(d, 2).documentType === null ? d : null;
      }, "no type read-back");
      expect(
        same && !options.includes("Generated redline") && doc.versions.length === 2,
        `before ${JSON.stringify(before)} mid ${JSON.stringify(mid)}`,
      );
      return `"Type of version 2 of ${newName}" offered ${options.join(", ")} (no Generated redline). Choosing Partially signed saved (read-back type Partially signed, kind ${mid.kind}); id, number, note, filename, uploader and pin were unchanged and the download answered ${bytes.status}. Choosing No type cleared it (read-back null). Still two Versions.`;
    },
  );

  await step(
    role,
    "Configure Document type colours, where the colour shows: give a Version the run's Purple Contract type; its pill carries the colour in record Documents, the Documents repository and the Business Portal, and follows the theme",
    "The Type pill uses the Purple classes in all three places; its computed background differs between the Light and Dark themes",
    async () => {
      const sel = typeSelect(page, 1, second.title);
      const opts = await optionTexts(sel);
      expect(opts.includes(CONTRACT_TYPE), `options ${opts}`);
      await sel.selectOption({ label: CONTRACT_TYPE });
      await until(
        async () =>
          (await getDoc(page, recUrl, second.id)).versions[0].documentType?.displayName ===
          CONTRACT_TYPE,
        "coloured type set",
      );
      await until(
        async () => ((await sel.getAttribute("class")) ?? "").includes(PURPLE),
        "record pill class",
      );
      const recordClass = await sel.getAttribute("class");
      const bg = (loc) => loc.evaluate((el) => getComputedStyle(el).backgroundColor);
      const theme = await page.evaluate(() => document.documentElement.dataset.theme);
      const lightBg = await bg(sel);
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "dark";
      });
      const darkBg = await bg(sel);
      await page.evaluate((t) => {
        document.documentElement.dataset.theme = t;
      }, theme);
      await page.goto(`${BASE}/documents?owner=contract&record=C-${contract.number}`);
      const repoPill = page.getByRole("main").getByText(CONTRACT_TYPE, { exact: true }).first();
      await repoPill.waitFor({ timeout: 30000 });
      const repoClass = await repoPill.getAttribute("class");
      portal ??= await portalContext(PEOPLE.amara);
      const p = portal.page;
      currentPage = p;
      await p.goto(`${BASE}/portal/contracts/${contract.number}`);
      const section = p.getByRole("region", { name: "Documents" });
      const portalPill = section.getByText(CONTRACT_TYPE, { exact: true }).first();
      await portalPill.waitFor({ timeout: 30000 });
      const portalClass = await portalPill.getAttribute("class");
      currentPage = page;
      await openDocuments(page, `${recUrl}/documents`);
      colourDocs.push({
        role,
        recUrl,
        id: second.id,
        title: second.title,
        contract: contract.number,
      });
      expect(
        [recordClass, repoClass, portalClass].every((c) => (c ?? "").includes(PURPLE)),
        `classes ${recordClass} | ${repoClass} | ${portalClass}`,
      );
      expect(lightBg !== darkBg, `light ${lightBg} dark ${darkBg}`);
      return `"Type of version 1 of ${second.title}" offered ${CONTRACT_TYPE}; choosing it saved (read-back). Record Documents: the Type pill carried ${PURPLE} (background ${lightBg} under the "${theme}" theme attribute, ${darkBg} with the attribute set to dark, then put back). Documents repository /documents?owner=contract&record=C-${contract.number}: the Type pill "${CONTRACT_TYPE}" carried ${PURPLE}. Business Portal as Amara Nwosu, /portal/contracts/${contract.number}: the Version pill "${CONTRACT_TYPE}" carried ${PURPLE}.`;
    },
  );

  await step(
    role,
    "Executed pin: Mark as executed copy on v1; choosing the Executed type on v2 does not set the pin; correcting v1's type does not move it; a later upload does not move it; Unmark clears it",
    "The pin stays on v1 throughout until Unmark",
    async () => {
      const earlierMenu = page.getByRole("button", {
        name: `Actions for version 1 of ${newName}`,
        exact: true,
      });
      if (!(await earlierMenu.isVisible()))
        await page
          .getByRole("button", { name: `Show the 1 earlier version of ${newName}` })
          .click();
      await earlierMenu.click();
      await page.getByRole("menuitem", { name: "Mark as executed copy" }).click();
      let doc = await until(async () => {
        const d = await getDoc(page, recUrl, first.id);
        return d.versions.some((v) => v.isExecuted) ? d : null;
      }, "pin set");
      expect(doc.versions.find((v) => v.isExecuted).versionNumber === 1, "pin not on v1");
      await typeSelect(page, 2, newName).selectOption({ label: "Executed" });
      doc = await until(async () => {
        const d = await getDoc(page, recUrl, first.id);
        return vOf(d, 2).documentType?.displayName === "Executed" ? d : null;
      }, "v2 Executed type");
      const afterType = doc.versions.filter((v) => v.isExecuted).map((v) => v.versionNumber);
      await typeSelect(page, 1, newName).selectOption({ label: "Draft · theirs" });
      doc = await until(async () => {
        const d = await getDoc(page, recUrl, first.id);
        return vOf(d, 1).documentType?.displayName === "Draft · theirs" ? d : null;
      }, "v1 type correction");
      const afterCorrect = doc.versions.filter((v) => v.isExecuted).map((v) => v.versionNumber);
      await chooseMenu(page, newName, "Add version");
      const dialog = page.getByRole("dialog", { name: "Add version" });
      await chooseFiles(
        page,
        dialog.getByRole("button", { name: /Choose file$/ }),
        fixture("doc029-draft-v2.docx"),
      );
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      doc = await getDoc(page, recUrl, first.id);
      const afterUpload = doc.versions.filter((v) => v.isExecuted).map((v) => v.versionNumber);
      const toggle = page.getByRole("button", {
        name: `Show the 2 earlier versions of ${newName}`,
      });
      if (await toggle.isVisible().catch(() => false)) await toggle.click();
      const pinnedText = tidy(
        await page
          .getByRole("row")
          .filter({
            has: page.getByRole("button", {
              name: `Actions for version 1 of ${newName}`,
              exact: true,
            }),
          })
          .innerText(),
      );
      await page
        .getByRole("button", { name: `Actions for version 1 of ${newName}`, exact: true })
        .click();
      await page.getByRole("menuitem", { name: "Unmark as executed copy" }).click();
      doc = await until(async () => {
        const d = await getDoc(page, recUrl, first.id);
        return !d.versions.some((v) => v.isExecuted) ? d : null;
      }, "unmark");
      expect(
        afterType.join() === "1" &&
          afterCorrect.join() === "1" &&
          afterUpload.join() === "1" &&
          doc.versions.length === 3,
        `afterType ${afterType} afterCorrect ${afterCorrect} afterUpload ${afterUpload}`,
      );
      first = doc;
      return `Actions for version 1 -> Mark as executed copy set the pin on v1 (earlier row read "${pinnedText}"). Choosing Executed in v2's Type column left the pin on v${afterType}. Correcting v1's type to Draft · theirs left it on v${afterCorrect}. A v3 upload left it on v${afterUpload}. Unmark as executed copy on v1 cleared it (read-back no pinned Version).`;
    },
  );

  await step(
    role,
    "Primary Document: the Primary mark and Make primary move the designation",
    "Primary moves to the other Document and back",
    async () => {
      const docs = await recordDocs(page, recUrl);
      const primary = docs.find((d) => d.isPrimary);
      const other = docs.find((d) => !d.isPrimary);
      await rowOf(page, primary.title).getByText("Primary", { exact: true }).waitFor();
      const primaryItems = await menuItems(page, primary.title);
      expect(!primaryItems.includes("Make primary"), `primary row items ${primaryItems}`);
      await chooseMenu(page, other.title, "Make primary");
      const moved = await until(
        async () => (await recordDocs(page, recUrl)).find((d) => d.isPrimary && d.id === other.id),
        "primary move",
      );
      await rowOf(page, other.title).getByText("Primary", { exact: true }).waitFor();
      await chooseMenu(page, primary.title, "Make primary");
      await until(
        async () =>
          (await recordDocs(page, recUrl)).find((d) => d.isPrimary && d.id === primary.id),
        "primary back",
      );
      return `"${primary.title}" carried the Primary mark and its Actions had no Make primary (${primaryItems.join(", ")}). Make primary on "${moved.title}" moved the mark there; Make primary on "${primary.title}" moved it back.`;
    },
  );

  await step(
    role,
    "Generated redline: a Version exported from a Word Comparison shows Generated redline in the Type column, read-only; a correction attempt is refused",
    "No Type select on the generated Version; the API answers 409 and the Version keeps its label",
    async () => {
      // Fixture: request a Word Comparison of v1 -> v2 and export it (API, Member+).
      const doc0 = await getDoc(page, recUrl, first.id);
      const c = await api(page, "POST", `/documents/${first.id}/comparisons`, {
        fromVersionId: vOf(doc0, 1).id,
        toVersionId: vOf(doc0, 2).id,
      });
      expect(
        [200, 202].includes(c.status),
        `comparison ${c.status} ${JSON.stringify(c.body).slice(0, 200)}`,
      );
      const ready = await until(
        async () => {
          const r = await api(
            page,
            "GET",
            `/documents/${first.id}/comparisons/${c.body.comparison.id}`,
          );
          if (r.body.comparison?.state === "failed")
            throw new Error(`comparison failed ${JSON.stringify(r.body).slice(0, 200)}`);
          return r.body.comparison?.state === "ready" ? r.body.comparison : null;
        },
        "comparison ready",
        240000,
      );
      expect(ready.mode === "word", `mode ${ready.mode}`);
      const ex = await api(page, "POST", `/documents/${first.id}/comparisons/${ready.id}/export`);
      expect(
        [200, 201].includes(ex.status),
        `export ${ex.status} ${JSON.stringify(ex.body).slice(0, 200)}`,
      );
      const gen = ex.body.version;
      await openDocuments(page, `${recUrl}/documents`);
      const row = rowOf(page, newName);
      await row.getByText(`v${gen.versionNumber}`, { exact: true }).waitFor({ timeout: 20000 });
      const cells = (await row.getByRole("cell").allInnerTexts()).map(tidy);
      const selects = await typeSelect(page, gen.versionNumber, newName).count();
      const before = snap(vOf(await getDoc(page, recUrl, first.id), gen.versionNumber));
      const refusal = await api(page, "PATCH", `/documents/${first.id}/versions/${gen.id}`, {
        documentTypeId: null,
      });
      const after = snap(vOf(await getDoc(page, recUrl, first.id), gen.versionNumber));
      expect(
        selects === 0 && cells.includes("Generated redline"),
        `selects ${selects} cells ${cells}`,
      );
      expect(
        refusal.status === 409 && JSON.stringify(before) === JSON.stringify(after),
        `refusal ${refusal.status}`,
      );
      await shot(page, `${role}-generated-redline-type.png`);
      return `Fixture: Word Comparison v1 -> v2 (mode ${ready.mode}) exported as v${gen.versionNumber} (kind ${gen.kind}). The Documents row for "${newName}" now reads ${JSON.stringify(cells)}: Type "Generated redline" as a plain label with no "Type of version ${gen.versionNumber}" select. A direct correction attempt answered ${refusal.status} ("${refusal.body?.detail}"); the Version read back unchanged (type ${after.type}, kind ${after.kind}).`;
    },
  );

  await step(
    role,
    "Matter upload with a type list: Upload document shows Type with the Matter list; the Type column corrects a Matter Version; no Primary mark or Executed pin",
    "Type starts on No type and lists the Administrator-added Matter type; the correction saves; the menu has no Make primary or Mark as executed copy",
    async () => {
      const matterTypes = await listTypes(page, "matter");
      await openDocuments(page, `/matters/${matter.number}/documents`);
      const dialog = await uploadDialog(page);
      await chooseFiles(
        page,
        dialog.getByRole("button", { name: /Choose files$/ }),
        fixture("doc029-draft-v1.docx"),
      );
      const type = dialog.getByLabel("Type", { exact: true });
      const start = await selectedText(type);
      const options = await optionTexts(type);
      expect(
        start === "No type" &&
          options.includes(MATTER_TYPE) &&
          !FIXED.some((k) => options.includes(k)),
        `start ${start} options ${options}`,
      );
      expect(
        options.length === matterTypes.length + 1,
        `options ${options.length} list ${matterTypes.length}`,
      );
      await type.selectOption({ label: MATTER_TYPE });
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      const [doc] = await recordDocs(page, `/matters/${matter.number}`);
      await rowOf(page, doc.title).waitFor();
      const header = (await docsSection(page).getByRole("columnheader").allInnerTexts()).map(tidy);
      const shown = await selectedText(typeSelect(page, 1, doc.title));
      await typeSelect(page, 1, doc.title).selectOption({ label: "No type" });
      await until(
        async () =>
          (await getDoc(page, `/matters/${matter.number}`, doc.id)).versions[0].documentType ===
          null,
        "matter correction",
      );
      const items = await menuItems(page, doc.title);
      const primaryMarks = await rowOf(page, doc.title)
        .getByText("Primary", { exact: true })
        .count();
      expect(header.includes("Type") && shown === MATTER_TYPE, `header ${header} shown ${shown}`);
      expect(
        !items.includes("Make primary") &&
          !items.includes("Mark as executed copy") &&
          primaryMarks === 0,
        `items ${items}`,
      );
      return `Matter M-${matter.number}: Upload document showed Type starting on "No type" with ${options.length} options (${options.join(", ")}), none of the Contract types. Uploaded with "${MATTER_TYPE}"; the column headers read ${header.join(", ")} and v1's Type read "${shown}". Choosing No type in the column saved (read-back null). No Primary mark; Actions offered ${items.join(", ")}.`;
    },
  );

  await step(
    role,
    "Entity upload with a type list: Upload document shows Type with the Entity list; no Primary mark or Executed pin",
    "Type starts on No type and lists the Administrator-added Entity type; the row menu has no Make primary or Mark as executed copy",
    async () => {
      const ent = await createEntity(
        page,
        role,
        `DOC-032 documents V-C26 ${label} versions Entity ${stamp} Ltd`,
      );
      await openDocuments(page, `/entities/${ent.id}/documents`);
      const dialog = await uploadDialog(page);
      await chooseFiles(
        page,
        dialog.getByRole("button", { name: /Choose files$/ }),
        fixture("doc029-bulk-b.txt"),
      );
      const type = dialog.getByLabel("Type", { exact: true });
      const start = await selectedText(type);
      const options = await optionTexts(type);
      expect(
        start === "No type" && options.includes(ENTITY_TYPE),
        `start ${start} options ${options}`,
      );
      await type.selectOption({ label: ENTITY_TYPE });
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      const [doc] = await recordDocs(page, `/entities/${ent.id}`);
      await rowOf(page, doc.title).waitFor();
      const shown = await selectedText(typeSelect(page, 1, doc.title));
      const items = await menuItems(page, doc.title);
      const primaryMarks = await rowOf(page, doc.title)
        .getByText("Primary", { exact: true })
        .count();
      expect(
        shown === ENTITY_TYPE && doc.versions[0].documentType?.displayName === ENTITY_TYPE,
        `shown ${shown}`,
      );
      expect(
        !items.includes("Make primary") &&
          !items.includes("Mark as executed copy") &&
          primaryMarks === 0,
        `items ${items}`,
      );
      return `Entity "${ent.legalName}": Upload document showed Type starting on "No type" with ${options.join(", ")}. The upload read back with "${ENTITY_TYPE}" and the column showed it. No Primary mark; Actions offered ${items.join(", ")}.`;
    },
  );

  await step(
    role,
    "Knowledge Item: Upload in its Documents section has no Type; the first Document becomes primary paper; the Type column shows the Knowledge type, offers a choice, and OpenLaw refuses the change",
    "No Type in Upload document; isPrimary on the first upload; a change in the Type column shows a refusal and the label stays",
    async () => {
      const { item, typeName } = await createKnowledge(
        page,
        role,
        `DOC-032 documents V-C26 ${label} Knowledge ${stamp}`,
      );
      await page.goto(`${BASE}/knowledge/${item.id}`);
      await docsSection(page)
        .getByRole("heading", { name: "Documents" })
        .waitFor({ timeout: 30000 });
      await page.waitForLoadState("networkidle").catch(() => {});
      const dialog = await uploadDialog(page);
      await chooseFiles(
        page,
        dialog.getByRole("button", { name: /Choose files$/ }),
        fixture("doc029-services-text.pdf"),
      );
      const typeCount = await dialog.getByLabel("Type", { exact: true }).count();
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      const [doc] = await recordDocs(page, `/knowledge/${item.id}`);
      await rowOf(page, doc.title).waitFor();
      const select = typeSelect(page, 1, doc.title);
      const selectCount = await select.count();
      const options = selectCount ? await optionTexts(select) : [];
      const shown = selectCount
        ? await selectedText(select)
        : tidy(await rowOf(page, doc.title).innerText());
      const before = snap(doc.versions[0]);
      let message = null;
      if (selectCount) {
        await select.selectOption({ label: "No type" });
        message = tidy(
          await until(async () => {
            const t = tidy(await docsSection(page).innerText());
            const m = t.match(
              /That version already has this type\.|Pick a document type from this record's list\.|[^.]*could not[^.]*\./,
            );
            return m?.[0] ?? null;
          }, "refusal message"),
        );
      }
      await shot(page, `${role}-knowledge-type-refused.png`);
      const probe = await api(
        page,
        "PATCH",
        `/documents/${doc.id}/versions/${doc.versions[0].id}`,
        {
          documentTypeId: doc.versions[0].documentType?.id ?? null,
        },
      );
      const after = snap((await getDoc(page, `/knowledge/${item.id}`, doc.id)).versions[0]);
      const afterShown = selectCount ? await selectedText(typeSelect(page, 1, doc.title)) : null;
      expect(typeCount === 0, `Type control count ${typeCount}`);
      expect(doc.isPrimary, "first Knowledge Document is not primary");
      expect(
        before.type === typeName && JSON.stringify(before) === JSON.stringify(after),
        `before ${JSON.stringify(before)} after ${JSON.stringify(after)}`,
      );
      expect(selectCount === 1 && message, `select ${selectCount} message ${message}`);
      if (!results.productBugs.some((b) => b.id === "knowledge-type-picker-refuses"))
        results.productBugs.push({
          id: "knowledge-type-picker-refuses",
          confirmsAuthorSuspicion: true,
          summary:
            "On a Knowledge Item the Documents Type column renders an editable select (No type plus the item's Knowledge type), but every choice is refused. DOC-015's Knowledge addendum says the label is derived from the item, so the cell should be read-only.",
          reproduction: `As ${role}, create a Knowledge Item, upload a file in its Documents section, then choose No type in "Type of version 1 of <title>". Observed: the section shows "${message}" and the Version keeps "${typeName}". Choosing the Knowledge type itself is a no-op in the browser; the same id sent to PATCH /documents/:id/versions/:versionId answers ${probe.status} "${probe.body?.detail}".`,
          source:
            "apps/web/src/components/documents/documents-card.tsx TypeCell (options include the derived Knowledge type, so readOnly is false)",
        });
      return `Knowledge Item "${item.title}" (Knowledge type ${typeName}): Upload document had no Type (count ${typeCount}). The first upload read back isPrimary true. The Type column rendered a select "Type of version 1 of ${doc.title}" showing "${shown}" with options ${JSON.stringify(options)}. Choosing No type showed "${message}" and the Version kept "${afterShown}" (read-back type ${after.type}, unchanged). Sending the Knowledge type id directly answered ${probe.status} ("${probe.body?.detail}"). Matches the guide ("offers a choice, but OpenLaw refuses the change"); recorded as a product bug.`;
    },
  );

  await step(
    role,
    "Before you start and the Type column: an archived Document or owning record freezes the Type column; an archived record hides Upload and refuses uploads until restored",
    "No Type select while archived; Upload hidden; a direct upload is refused with a restore message; after restore the controls return",
    async () => {
      const frozen = await createContract(
        page,
        role,
        `DOC-032 documents V-C26 ${label} archived owner ${stamp}`,
      );
      const fUrl = `/contracts/${frozen.number}`;
      const d = await uploadApi(page, `${fUrl}/documents`, "doc029-bulk-a.txt", {
        documentTypeId: contractTypes.find((t) => t.displayName === "Draft · ours").id,
      });
      await openDocuments(page, `${fUrl}/documents`);
      const liveSelect = await typeSelect(page, 1, d.title).count();
      // Archived Document (fixture archive, then Show archived in the browser).
      expect(
        (await api(page, "POST", `/documents/${d.id}/archive`, {})).status === 200,
        "fixture doc archive",
      );
      await openDocuments(page, `${fUrl}/documents`);
      await docsSection(page).getByRole("switch", { name: "Show archived" }).click();
      await rowOf(page, d.title).waitFor();
      const archivedDocSelect = await typeSelect(page, 1, d.title).count();
      const archivedDocCells = (await rowOf(page, d.title).getByRole("cell").allInnerTexts()).map(
        tidy,
      );
      expect(
        (await api(page, "POST", `/documents/${d.id}/restore`, {})).status === 200,
        "fixture doc restore",
      );
      // Archived owning record.
      expect((await api(page, "POST", `${fUrl}/archive`, {})).status === 200, "fixture archive");
      await openDocuments(page, `${fUrl}/documents`);
      const uploadWhileArchived = await docsSection(page)
        .getByRole("button", { name: "Upload", exact: true })
        .count();
      const frozenSelect = await typeSelect(page, 1, d.title).count();
      const refused = await api(page, "POST", `${fUrl}/documents`, undefined, {
        file: part("doc029-bulk-b.txt"),
      });
      const refusedType = await api(
        page,
        "PATCH",
        `/documents/${d.id}/versions/${d.versions[0].id}`,
        { documentTypeId: null },
      );
      expect((await api(page, "POST", `${fUrl}/restore`, {})).status === 200, "fixture restore");
      await openDocuments(page, `${fUrl}/documents`);
      const uploadAfter = await docsSection(page)
        .getByRole("button", { name: "Upload", exact: true })
        .count();
      const selectAfter = await typeSelect(page, 1, d.title).count();
      const docs = await recordDocs(page, fUrl);
      expect(
        liveSelect === 1 && archivedDocSelect === 0 && frozenSelect === 0 && selectAfter === 1,
        `selects ${liveSelect}/${archivedDocSelect}/${frozenSelect}/${selectAfter}`,
      );
      expect(
        uploadWhileArchived === 0 &&
          uploadAfter === 1 &&
          refused.status === 409 &&
          refusedType.status >= 400,
        `upload ${uploadWhileArchived}/${uploadAfter} api ${refused.status} type ${refusedType.status}`,
      );
      expect(
        docs.length === 1 &&
          docs[0].versions.length === 1 &&
          docs[0].versions[0].documentType?.displayName === "Draft · ours",
        "chain changed",
      );
      return `C-${frozen.number}: live, v1's Type was a select. With the Document archived (Show archived on) its Type cell was a plain label (${JSON.stringify(archivedDocCells)}), no select. With the Contract archived the section had no Upload button and no Type select; a direct upload answered ${refused.status} ("${refused.body?.detail}") and a direct type correction answered ${refusedType.status}. After restore, Upload and the Type select returned; the chain still had one Version typed Draft · ours.`;
    },
  );

  await step(
    role,
    "Recover from a refusal: a failed upload shows its message and does not alter the chain",
    "The Add version dialog shows the upload message; the Version count stays the same",
    async () => {
      await openDocuments(page, `${recUrl}/documents`);
      const before = (await getDoc(page, recUrl, first.id)).versions.map(snap);
      await page.route("**/api/v1/documents/*/versions", (route) =>
        route.request().method() === "POST"
          ? route.fulfill({
              status: 413,
              contentType: "application/problem+json",
              body: JSON.stringify({
                type: "about:blank",
                title: "Payload Too Large",
                status: 413,
                detail: "DOC-032 fixture: this file is larger than the upload limit.",
              }),
            })
          : route.continue(),
      );
      await chooseMenu(page, newName, "Add version");
      const dialog = page.getByRole("dialog", { name: "Add version" });
      await chooseFiles(
        page,
        dialog.getByRole("button", { name: /Choose file$/ }),
        fixture("doc029-draft-v2.docx"),
      );
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      const alert = tidy(await dialog.getByRole("alert").innerText());
      await page.unroute("**/api/v1/documents/*/versions");
      await dialog.getByRole("button", { name: "Cancel" }).click();
      const after = (await getDoc(page, recUrl, first.id)).versions.map(snap);
      expect(
        JSON.stringify(after) === JSON.stringify(before) &&
          /larger than the upload limit/.test(alert),
        `alert ${alert}`,
      );
      return `With a browser-network fixture answering 413 for the Version upload, Add version stayed open with "${alert}". The chain still had ${after.length} Versions with identical ids, numbers, types, notes and pin.`;
    },
  );

  // Conversation filing fixtures (API): two Contract comments with attachments.
  const contractRow = (await api(page, "GET", recUrl)).body.contract;
  const legalOnly = await api(page, "POST", "/comments", undefined, {
    entityType: "contract",
    entityId: contractRow.id,
    body: `DOC-032 documents V-C26 ${label} Legal only attachment`,
    visibility: "legal_only",
    file: part("doc029-services-text.pdf", `doc032-${label.toLowerCase()}-legal-only-${stamp}.pdf`),
  });
  const teamNote = await api(page, "POST", "/comments", undefined, {
    entityType: "contract",
    entityId: contractRow.id,
    body: `DOC-032 documents V-C26 ${label} team attachment`,
    visibility: "full_thread",
    file: part("doc029-draft-v2.docx", `doc032-${label.toLowerCase()}-round-${stamp}.docx`),
  });
  expect(
    legalOnly.status === 201 && teamNote.status === 201,
    `fixture comments ${legalOnly.status} ${teamNote.status}`,
  );

  async function openComments() {
    await page
      .getByRole("toolbar", { name: "Applets" })
      .getByRole("button", { name: "Comments" })
      .click();
  }
  const attachmentItem = (name) =>
    page
      .getByRole("list", { name: "Comment attachments" })
      .getByRole("listitem")
      .filter({ hasText: name });

  const filedTitle = `DOC-032 documents V-C26 ${label} filed paper ${stamp}`;
  await step(
    role,
    "File a Contract conversation attachment steps 1-4: File to Contract, File attachment, Destination New Document, Document name, Type, Confidential switch preselected for Legal Only, File",
    "A Legal Only attachment files as a new Confidential Document with the chosen type; the comment reads Filed to",
    async () => {
      await openDocuments(page, `${recUrl}/documents`);
      await openComments();
      const name = `doc032-${label.toLowerCase()}-legal-only-${stamp}.pdf`;
      const item = attachmentItem(name);
      await item.waitFor({ timeout: 20000 });
      await item.getByRole("button", { name: "File to Contract" }).click();
      const dialog = page.getByRole("dialog", { name: "File attachment" });
      await dialog.waitFor();
      const destOptions = await optionTexts(dialog.getByLabel("Destination"));
      const dest = await selectedText(dialog.getByLabel("Destination"));
      const toggle = dialog.getByRole("switch", {
        name: "Confidential — restrict to the contract team",
      });
      const on = await toggle.getAttribute("aria-checked");
      const type = dialog.getByLabel("Type", { exact: true });
      const start = await selectedText(type);
      const typeOptions = await optionTexts(type);
      await dialog.getByLabel("Document name").fill(filedTitle);
      await type.selectOption({ label: "Draft · theirs" });
      await dialog.getByRole("button", { name: "File", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 20000 });
      await item.getByText(/Filed to/).waitFor();
      const filedText = tidy(await item.innerText());
      const doc = (await recordDocs(page, recUrl)).find((d) => d.title === filedTitle);
      expect(
        dest === "New Document" && destOptions.includes("New Version on an existing Document"),
        `dest ${dest} ${destOptions}`,
      );
      expect(
        on === "true" && start === "No type" && FIXED.every((k) => typeOptions.includes(k)),
        `on ${on} start ${start}`,
      );
      expect(
        doc?.isConfidential &&
          doc.versions.length === 1 &&
          doc.versions[0].documentType?.displayName === "Draft · theirs",
        `doc ${JSON.stringify(doc).slice(0, 200)}`,
      );
      return `The attachment offered File to Contract. File attachment opened with Destination "${dest}" (options ${destOptions.join(" / ")}), the switch "Confidential — restrict to the contract team" already on, and Type starting on "No type" with the Contract list. File created "${filedTitle}" (Confidential, one Version, Type Draft · theirs) and the comment read "${filedText.match(/Filed to.*$/)?.[0]}".`;
    },
  );

  await step(
    role,
    "File a Contract conversation attachment from the preview: File to Contract, New Version on an existing Document, Document, Note, File",
    "The preview offers the same action; the Version is appended with its note",
    async () => {
      const name = `doc032-${label.toLowerCase()}-round-${stamp}.docx`;
      const item = attachmentItem(name);
      await item.getByRole("button", { name, exact: true }).click();
      const preview = page.getByRole("dialog", { name });
      await preview.waitFor();
      await preview.getByRole("button", { name: "File to Contract" }).click();
      const dialog = page.getByRole("dialog", { name: "File attachment" });
      await dialog
        .getByLabel("Destination")
        .selectOption({ label: "New Version on an existing Document" });
      await dialog.getByLabel("Document", { exact: true }).selectOption({ label: newName });
      await dialog.getByLabel("Note").fill("DOC-032 filed round note");
      await dialog.getByRole("button", { name: "File", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 20000 });
      await item.getByText(/Filed to/).waitFor();
      const doc = await getDoc(page, recUrl, first.id);
      const last = doc.versions.reduce((a, b) => (a.versionNumber > b.versionNumber ? a : b));
      expect(
        last.note === "DOC-032 filed round note" && last.originalFilename === name,
        `last ${JSON.stringify(last).slice(0, 150)}`,
      );
      const filedText = tidy(await item.innerText());
      return `Selecting the attachment name opened its preview with File to Contract. New Version on an existing Document, Document "${newName}" and a Note appended v${last.versionNumber} with that note; the comment read "${filedText.match(/Filed to.*$/)?.[0]}".`;
    },
  );

  await step(
    role,
    "File a Matter conversation attachment: File to Matter, Type from the Matter list, switch names the matter team",
    "File attachment shows Type with the Matter list and Confidential — restrict to the matter team; filing creates a Matter Document",
    async () => {
      const m = (await api(page, "GET", `/matters/${matter.number}`)).body.matter;
      const name = `doc032-${label.toLowerCase()}-matter-${stamp}.pdf`;
      const c = await api(page, "POST", "/comments", undefined, {
        entityType: "matter",
        entityId: m.id,
        body: `DOC-032 documents V-C26 ${label} matter attachment`,
        visibility: "working_team",
        file: part("doc029-services-text.pdf", name),
      });
      expect(c.status === 201, `fixture matter comment ${c.status}`);
      await openDocuments(page, `/matters/${matter.number}/documents`);
      await openComments();
      const item = attachmentItem(name);
      await item.getByRole("button", { name: "File to Matter" }).click();
      const dialog = page.getByRole("dialog", { name: "File attachment" });
      await dialog.waitFor();
      const type = dialog.getByLabel("Type", { exact: true });
      const start = await selectedText(type);
      const typeOptions = await optionTexts(type);
      const switchName = await dialog
        .getByRole("switch", { name: "Confidential — restrict to the matter team" })
        .count();
      const title = `DOC-032 documents V-C26 ${label} matter filed ${stamp}`;
      await dialog.getByLabel("Document name").fill(title);
      await type.selectOption({ label: MATTER_TYPE });
      await dialog.getByRole("button", { name: "File", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 20000 });
      await item.getByText(/Filed to/).waitFor();
      const doc = (await recordDocs(page, `/matters/${matter.number}`)).find(
        (d) => d.title === title,
      );
      expect(
        start === "No type" && typeOptions.includes(MATTER_TYPE) && switchName === 1,
        `start ${start} options ${typeOptions} switch ${switchName}`,
      );
      expect(doc?.versions[0].documentType?.displayName === MATTER_TYPE, "filed type");
      return `The Matter attachment offered File to Matter. File attachment showed Type starting on "No type" with ${typeOptions.join(", ")}, and the switch "Confidential — restrict to the matter team". File created "${title}" typed "${MATTER_TYPE}".`;
    },
  );

  if (role === "legal_team_member") {
    await step(
      role,
      "Delete version (negative): a Legal Team Member gets no Delete version in the Document's Actions menu or in an earlier Version's Actions for version menu; a direct delete is refused",
      "No Delete version item in either menu; the API answers 403; the chain is unchanged",
      async () => {
        await openDocuments(page, `${recUrl}/documents`);
        const before = (await getDoc(page, recUrl, first.id)).versions.map(snap);
        const items = await menuItems(page, newName);
        await page
          .getByRole("button", {
            name: new RegExp(`^Show the \\d+ earlier versions? of ${esc(newName)}$`),
          })
          .click();
        await page
          .getByRole("button", { name: `Actions for version 1 of ${newName}`, exact: true })
          .click();
        const vMenu = page.getByRole("menu");
        await vMenu.waitFor();
        const vItems = (await vMenu.getByRole("menuitem").allInnerTexts()).map((t) => t.trim());
        await page.keyboard.press("Escape");
        const v1 = before.find((v) => v.n === 1);
        const attempt = await api(page, "DELETE", `/documents/${first.id}/versions/${v1.id}`, {
          confirmTitle: newName,
        });
        const after = (await getDoc(page, recUrl, first.id)).versions.map(snap);
        expect(
          !items.includes("Delete version") && !vItems.includes("Delete version"),
          `items ${items} / ${vItems}`,
        );
        expect(
          attempt.status === 403 && JSON.stringify(after) === JSON.stringify(before),
          `attempt ${attempt.status}`,
        );
        return `Nadia's Actions menu for "${newName}" offered ${items.join(", ")}; "Actions for version 1 of ${newName}" offered ${vItems.join(", ")}. Neither had Delete version. A direct DELETE of v1 answered ${attempt.status} ("${attempt.body?.detail}"); the chain still had ${after.length} Versions with identical ids, numbers, types and notes.`;
      },
    );
  }

  if (role === "administrator") {
    const delDialog = () => page.getByRole("dialog", { name: /^Delete version \d+\?$/ });
    async function confirmDelete(dialog, { tryWrong = false } = {}) {
      const button = dialog.getByRole("button").filter({ hasText: /^Delete version$/ });
      const disabledAtOpen = await button.isDisabled();
      let disabledWrong = null;
      if (tryWrong) {
        await dialog.getByLabel('Type "delete" to confirm').fill("remove");
        disabledWrong = await button.isDisabled();
      }
      await dialog.getByLabel('Type "delete" to confirm').fill("delete");
      const enabled = await button.isEnabled();
      const accessibleName = await button.getAttribute("aria-label");
      await button.click();
      return { disabledAtOpen, disabledWrong, enabled, accessibleName };
    }
    const showEarlier = async (title) => {
      const t = page.getByRole("button", {
        name: new RegExp(`^Show the \\d+ earlier versions? of ${esc(title)}$`),
      });
      if (await t.isVisible().catch(() => false)) await t.click();
    };

    await step(
      role,
      "Delete version refused while a Generated redline uses the Version: Actions for version 1 (compared in the exported redline), Delete version, type delete, Delete version",
      "OpenLaw refuses with a message; the chain is unchanged",
      async () => {
        await openDocuments(page, `${recUrl}/documents`);
        const before = (await getDoc(page, recUrl, first.id)).versions.map(snap);
        await showEarlier(newName);
        await page
          .getByRole("button", { name: `Actions for version 1 of ${newName}`, exact: true })
          .click();
        await page.getByRole("menuitem", { name: "Delete version", exact: true }).click();
        const dialog = delDialog();
        await dialog.waitFor();
        const title = tidy(await dialog.getByRole("heading").first().innerText());
        await confirmDelete(dialog);
        const alert = tidy(await dialog.getByRole("alert").innerText({ timeout: 15000 }));
        await dialog.getByRole("button", { name: "Cancel" }).click();
        await dialog.waitFor({ state: "hidden" });
        const after = (await getDoc(page, recUrl, first.id)).versions.map(snap);
        expect(title === "Delete version 1?", `title ${title}`);
        expect(JSON.stringify(after) === JSON.stringify(before), "chain changed");
        return `"Actions for version 1 of ${newName}" -> Delete version opened "${title}". After typing delete and selecting Delete version the dialog stayed open with "${alert}". Cancel closed it; the chain still had ${after.length} Versions (${after.map((v) => `v${v.n}`).join(", ")}) with identical ids, types, notes and files.`;
      },
    );

    // Fixture: a Document for the delete steps, three Versions uploaded through the API.
    const delName = `doc032-delete-chain-${stamp}.docx`;
    const delDoc = await uploadApi(page, `${recUrl}/documents`, "doc029-draft-v1.docx", {
      as: delName,
    });
    for (const f of ["doc029-draft-v2.docx", "doc029-draft-v1.docx"]) {
      const r = await api(page, "POST", `/documents/${delDoc.id}/versions`, undefined, {
        file: part(f, delName),
      });
      expect(r.status === 201, `fixture version ${r.status}`);
    }
    const delTitle = (await getDoc(page, recUrl, delDoc.id)).title;
    record(role, "document", delTitle, delDoc.id);
    let comparisonId = null;

    await step(
      role,
      'Delete version, current Version: set the Executed pin on v2 and prepare a Comparison of v2 to v3; then the Document\'s Actions menu, Delete version, the dialog names v3, type delete in Type "delete" to confirm, Delete version',
      "Delete version is disabled until delete is typed; v3, its stored file and the Comparison that names it are removed; v1 and v2 stay; the pin stays on v2",
      async () => {
        await openDocuments(page, `${recUrl}/documents`);
        await showEarlier(delTitle);
        await page
          .getByRole("button", { name: `Actions for version 2 of ${delTitle}`, exact: true })
          .click();
        await page.getByRole("menuitem", { name: "Mark as executed copy" }).click();
        let doc = await until(async () => {
          const d = await getDoc(page, recUrl, delDoc.id);
          return vOf(d, 2)?.isExecuted ? d : null;
        }, "pin on v2");
        const c = await api(page, "POST", `/documents/${delDoc.id}/comparisons`, {
          fromVersionId: vOf(doc, 2).id,
          toVersionId: vOf(doc, 3).id,
        });
        expect([200, 202].includes(c.status), `fixture comparison ${c.status}`);
        comparisonId = c.body.comparison.id;
        await until(
          async () => {
            const r = await api(page, "GET", `/documents/${delDoc.id}/comparisons/${comparisonId}`);
            return ["ready", "failed"].includes(r.body.comparison?.state);
          },
          "comparison settled",
          240000,
        );
        const cmpBefore = await api(
          page,
          "GET",
          `/documents/${delDoc.id}/comparisons/${comparisonId}`,
        );
        const v3 = vOf(doc, 3);
        const keep = doc.versions.filter((v) => v.versionNumber !== 3).map(snap);
        await openDocuments(page, `${recUrl}/documents`);
        const items = await menuItems(page, delTitle);
        await chooseMenu(page, delTitle, "Delete version");
        const dialog = delDialog();
        await dialog.waitFor();
        const title = tidy(await dialog.getByRole("heading").first().innerText());
        const body = tidy(await dialog.innerText());
        const c1 = await confirmDelete(dialog, { tryWrong: true });
        await dialog.waitFor({ state: "hidden", timeout: 30000 });
        doc = await getDoc(page, recUrl, delDoc.id);
        const gone = await api(page, "GET", `/documents/${delDoc.id}/versions/${v3.id}/download`);
        const cmpAfter = await api(
          page,
          "GET",
          `/documents/${delDoc.id}/comparisons/${comparisonId}`,
        );
        const row = rowOf(page, delTitle);
        await row.getByText("v2", { exact: true }).waitFor({ timeout: 15000 });
        expect(items.includes("Delete version"), `items ${items}`);
        expect(title === "Delete version 3?", `title ${title}`);
        expect(
          body.includes(`Version 3 of ${delTitle} and its stored file will be removed.`) &&
            body.includes("All other versions will remain."),
          `body ${body}`,
        );
        expect(c1.disabledAtOpen && c1.disabledWrong && c1.enabled, `button ${JSON.stringify(c1)}`);
        expect(
          doc.versions.map((v) => v.versionNumber).join() === "1,2" &&
            JSON.stringify(doc.versions.map(snap)) === JSON.stringify(keep) &&
            vOf(doc, 2).isExecuted,
          `after ${JSON.stringify(doc.versions.map(snap))}`,
        );
        expect(gone.status === 404, `download of the deleted Version ${gone.status}`);
        expect(
          cmpBefore.status === 200 && cmpAfter.status === 404,
          `comparison ${cmpBefore.status}/${cmpAfter.status}`,
        );
        return `Fixture "${delTitle}" had v1-v3; "Actions for version 2" -> Mark as executed copy set the pin on v2, and a Comparison of v2 to v3 was prepared (API). The row's Actions menu offered ${items.join(", ")}. Delete version opened "${title}" reading "${body.slice(0, 220)}". The Delete version button (accessible name "${c1.accessibleName}") was disabled at open and with "remove" typed, enabled with "delete". After it, the row read v2; read-back Versions ${doc.versions.map((v) => `v${v.versionNumber}`).join(", ")} with v1 and v2 unchanged and the pin still on v2. The deleted Version's download answered ${gone.status}. The Comparison of v2 to v3 answered ${cmpBefore.status} before and ${cmpAfter.status} after.`;
      },
    );

    await step(
      role,
      "Delete version: the number is not reused (Add version after the delete)",
      "The next upload is v4, not v3",
      async () => {
        await chooseMenu(page, delTitle, "Add version");
        const dialog = page.getByRole("dialog", { name: "Add version" });
        await chooseFiles(
          page,
          dialog.getByRole("button", { name: /Choose file$/ }),
          fixture("doc029-draft-v2.docx"),
        );
        await dialog.getByRole("button", { name: "Upload", exact: true }).click();
        await dialog.waitFor({ state: "hidden", timeout: 30000 });
        await rowOf(page, delTitle).getByText("v4", { exact: true }).waitFor({ timeout: 15000 });
        const doc = await getDoc(page, recUrl, delDoc.id);
        expect(doc.versions.map((v) => v.versionNumber).join() === "1,2,4", "numbers");
        return `Add version -> Choose file -> Upload made v4; the row read v4 and read-back numbers were ${doc.versions.map((v) => `v${v.versionNumber}`).join(", ")}. v3 was not reused.`;
      },
    );

    await step(
      role,
      "Delete version, earlier Version: prepare a Comparison of v2 to v4; show earlier Versions, Actions for version 2 (the pinned Version), Delete version, type delete, Delete version",
      "v2 is removed; the Executed pin is cleared; the Comparison that names v2 is removed; v1 and v4 stay",
      async () => {
        const before = await getDoc(page, recUrl, delDoc.id);
        const keep = before.versions.filter((v) => v.versionNumber !== 2).map(snap);
        const c = await api(page, "POST", `/documents/${delDoc.id}/comparisons`, {
          fromVersionId: vOf(before, 2).id,
          toVersionId: vOf(before, 4).id,
        });
        expect([200, 202].includes(c.status), `fixture comparison ${c.status}`);
        comparisonId = c.body.comparison.id;
        await until(
          async () => {
            const r = await api(page, "GET", `/documents/${delDoc.id}/comparisons/${comparisonId}`);
            return ["ready", "failed"].includes(r.body.comparison?.state);
          },
          "comparison settled",
          240000,
        );
        const cmpBefore = await api(
          page,
          "GET",
          `/documents/${delDoc.id}/comparisons/${comparisonId}`,
        );
        await showEarlier(delTitle);
        await page
          .getByRole("button", { name: `Actions for version 2 of ${delTitle}`, exact: true })
          .click();
        const vItems = (await page.getByRole("menu").getByRole("menuitem").allInnerTexts()).map(
          (t) => t.trim(),
        );
        await page.getByRole("menuitem", { name: "Delete version", exact: true }).click();
        const dialog = delDialog();
        await dialog.waitFor();
        const title = tidy(await dialog.getByRole("heading").first().innerText());
        await confirmDelete(dialog);
        await dialog.waitFor({ state: "hidden", timeout: 30000 });
        const doc = await getDoc(page, recUrl, delDoc.id);
        const cmpAfter = await api(
          page,
          "GET",
          `/documents/${delDoc.id}/comparisons/${comparisonId}`,
        );
        expect(title === "Delete version 2?", `title ${title}`);
        expect(
          doc.versions.map((v) => v.versionNumber).join() === "1,4" &&
            !doc.versions.some((v) => v.isExecuted),
          `after ${JSON.stringify(doc.versions.map(snap))}`,
        );
        expect(
          JSON.stringify(doc.versions.map((v) => ({ ...snap(v), executed: false }))) ===
            JSON.stringify(keep.map((v) => ({ ...v, executed: false }))),
          "other Versions changed",
        );
        expect(
          cmpBefore.status === 200 && cmpAfter.status === 404,
          `comparison ${cmpBefore.status}/${cmpAfter.status}`,
        );
        return `"Actions for version 2 of ${delTitle}" offered ${vItems.join(", ")}. Delete version opened "${title}"; after typing delete and Delete version, read-back Versions were ${doc.versions.map((v) => `v${v.versionNumber}`).join(", ")}, none pinned (the pin on v2 was cleared). A Comparison of v2 to v4 prepared before the delete (API) answered ${cmpBefore.status} before and ${cmpAfter.status} after. v1 and v4 kept their ids, notes and files.`;
      },
    );

    await step(
      role,
      "Delete version, last Version: a one-Version Document's Actions, Delete version; the dialog says the Document will also be removed",
      "The Document is removed with its last Version",
      async () => {
        const oneName = `doc032-delete-last-${stamp}.txt`;
        const one = await uploadApi(page, `${recUrl}/documents`, "doc029-bulk-a.txt", {
          as: oneName,
        });
        record(role, "document", one.title, one.id);
        await openDocuments(page, `${recUrl}/documents`);
        await chooseMenu(page, one.title, "Delete version");
        const dialog = delDialog();
        await dialog.waitFor();
        const title = tidy(await dialog.getByRole("heading").first().innerText());
        const body = tidy(await dialog.innerText());
        await confirmDelete(dialog);
        await dialog.waitFor({ state: "hidden", timeout: 30000 });
        await page
          .getByRole("button", { name: `Actions for ${one.title}`, exact: true })
          .waitFor({ state: "detached", timeout: 15000 });
        const after = await getDoc(page, recUrl, one.id);
        expect(
          title === "Delete version 1?" &&
            body.includes("This is the last version, so the document will also be removed."),
          `title ${title} body ${body}`,
        );
        expect(after === null, "Document still listed");
        return `Fixture "${one.title}" (one Version). Actions -> Delete version opened "${title}" reading "${body.slice(0, 200)}". After typing delete and Delete version the row left the list and read-back (including archived) no longer had the Document.`;
      },
    );
  }

  await step(
    role,
    "Insufficient access: a Business User on the Contract team sees no Type correction control in the Portal and cannot correct a type",
    "No Type select in the Portal Documents section; a direct correction answers 403; the Version keeps its type",
    async () => {
      portal ??= await portalContext(PEOPLE.amara);
      const p = portal.page;
      currentPage = p;
      await p.goto(`${BASE}/portal/contracts/${contract.number}`);
      const section = p.getByRole("region", { name: "Documents" });
      await section.getByRole("heading", { name: "Documents" }).waitFor({ timeout: 30000 });
      await section.getByText(newName).first().waitFor({ timeout: 20000 });
      const selects = await section.locator("select").count();
      const typeLabels = await p.getByLabel(/^Type of version/).count();
      const doc = await getDoc(page, recUrl, first.id);
      const target = vOf(doc, 1);
      const attempt = await api(p, "PATCH", `/documents/${first.id}/versions/${target.id}`, {
        documentTypeId: null,
      });
      const after = vOf(await getDoc(page, recUrl, first.id), 1);
      expect(
        selects === 0 && typeLabels === 0 && attempt.status === 403,
        `selects ${selects} labels ${typeLabels} attempt ${attempt.status}`,
      );
      expect(after.documentType?.displayName === target.documentType?.displayName, "type changed");
      await p.waitForLoadState("networkidle").catch(() => {});
      const portalPath = new URL(p.url()).pathname;
      currentPage = page;
      expect(portalPath === `/portal/contracts/${contract.number}`, `portal path ${portalPath}`);
      return `Amara Nwosu (Business User, on the C-${contract.number} team) opened /portal/contracts/${contract.number}: the Documents section listed "${newName}" with no select and no "Type of version" control. A direct correction of v1 answered ${attempt.status}; v1 kept "${after.documentType?.displayName}".`;
    },
  );

  await context.close();
}

// =====================================================================
// main
// =====================================================================
const STAFF = { administrator: PEOPLE.daniel, legal_team_member: PEOPLE.nadia };
try {
  await loadFixtureIds();
  if (ROLES.includes("administrator")) await settingsAdmin();
  if (ROLES.includes("legal_team_member")) await settingsLegal();
  if (!results.addedDocumentTypes.length) {
    // A legal-only rerun reuses the newest matching types added by an earlier admin run.
    throw new Error("Run with the administrator role first so the Matter and Entity types exist");
  }
  for (const role of ROLES) await versions(role, STAFF[role]);
  if (ROLES.includes("administrator")) {
    const { context, page } = await staffContext(PEOPLE.daniel);
    currentPage = page;
    await step(
      "administrator",
      "Configure Document type colours: after the run's Purple Contract type is archived, existing Versions keep its label and colour in record Documents and the Documents repository",
      "The archived type's pill still carries the Purple classes",
      async () => {
        const t = results.addedDocumentTypes.find((x) => x.name === CONTRACT_TYPE);
        const r = await api(page, "POST", `/documents/types/contract/${t.id}/archive`, {});
        expect(r.status === 200, `fixture archive ${r.status}`);
        t.archivedAfterRun = true;
        t.leftInPlace = false;
        const out = [];
        for (const d of colourDocs) {
          await openDocuments(page, `${d.recUrl}/documents`);
          const row = rowOf(page, d.title);
          await row.waitFor();
          const pill = row.getByText(CONTRACT_TYPE, { exact: true }).first();
          const sel = typeSelect(page, 1, d.title);
          const cls = (await sel.count())
            ? await sel.getAttribute("class")
            : await pill.getAttribute("class");
          await page.goto(`${BASE}/documents?owner=contract&record=C-${d.contract}`);
          const repo = page.getByRole("main").getByText(CONTRACT_TYPE, { exact: true }).first();
          await repo.waitFor({ timeout: 30000 });
          const repoCls = await repo.getAttribute("class");
          expect(
            (cls ?? "").includes(PURPLE) && (repoCls ?? "").includes(PURPLE),
            `${cls} | ${repoCls}`,
          );
          out.push(
            `C-${d.contract} "${d.title}" (${d.role}) record pill and repository pill both carried ${PURPLE}`,
          );
        }
        return `Archived "${CONTRACT_TYPE}" (fixture API; archive is the run's cleanup). ${out.join("; ")}.`;
      },
    );
    await context.close();
  }
} finally {
  // Put the shared lab back: archive this run's own Matter and Entity types. Archive keeps
  // the label on the Versions that carry it (DOC-015) and only removes it from pickers.
  if (results.addedDocumentTypes.length) {
    const { context, page } = await staffContext(PEOPLE.daniel).catch(() => ({}));
    for (const t of results.addedDocumentTypes) {
      if (t.archivedAfterRun) continue;
      const r = page
        ? await api(page, "POST", `/documents/types/${t.module}/${t.id}/archive`, {})
        : { status: 0 };
      t.leftInPlace = false;
      t.archivedAfterRun = r.status === 200;
    }
    await context?.close().catch(() => {});
  }
  save();
  await portal?.context.close().catch(() => {});
  await adminReader?.context.close().catch(() => {});
  await close();
}
const failed = results.steps.filter((s) => s.result !== "pass");
console.log(`\n${results.steps.length - failed.length}/${results.steps.length} steps passed`);
