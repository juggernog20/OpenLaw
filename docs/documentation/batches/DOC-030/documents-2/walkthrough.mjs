// DOC-030 independent browser walkthrough, documents-2 group:
// document-folders (V-C27), document-repository (V-C30), create-knowledge (V-C33).
// Written by the DOC-030 independent walkthrough agent (documents-2) from the article text,
// on the DOC-029 walkthrough-r1.mjs pattern (documents and knowledge groups).
//
// Run from the worktree root against the shared work2 lab:
//   LAB_PASSWORD=... node docs/documentation/batches/DOC-030/documents-2/walkthrough.mjs
// Optional: SECTIONS=setup,folders,repository,knowledge,business,teardown
//           ROLES=administrator,legal_team_member  OUT=<path> (default walkthrough.json here).
//
// API calls only prepare fictional records ("fixture"), make a second actor's attempt, or
// read results back ("read-back"). Every guide step runs in the browser as the named role.
// Organization settings this run changes are put back at the end: the Matter Document type
// it adds is archived, and the archived Knowledge type fixture is deleted.
import fs from "node:fs";
import os from "node:os";
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
const SECTIONS = (
  process.env.SECTIONS ?? "setup,folders,repository,knowledge,business,teardown"
).split(",");
const ROLES = (process.env.ROLES ?? "administrator,legal_team_member").split(",");
const DFIX = path.join(root, "docs/documentation/batches/DOC-029/documents/fixtures");
const KFIX = path.join(root, "docs/documentation/batches/DOC-029/knowledge/fixtures");
const REL = "docs/documentation/batches/DOC-030/documents-2";
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(4, 12);
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const dfix = (name) => path.join(DFIX, name);
const kfix = (name) => path.join(KFIX, name);
const WORK = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), "doc030-documents-2-"));
const lab = JSON.parse(
  fs.readFileSync(path.join(root, ".documentation-labs/work2/lab.json"), "utf8"),
);
const ARTICLES = {
  "document-folders": "V-C27",
  "document-repository": "V-C30",
  "create-knowledge": "V-C33",
};
const MATTER_TYPE = `DOC-030 documents-2 Matter type ${stamp}`;
const SIZE_LIMIT_MB = 100; // MAX_UPLOAD_MB is unset on the lab, so the default ceiling applies.

const results = {
  kind: "independent-article-walkthrough",
  task: "DOC-030",
  group: "documents-2",
  walkthroughReviewer: "DOC-030 independent walkthrough agent (documents-2)",
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
  articleHashes: Object.fromEntries(
    Object.keys(ARTICLES).map((id) => [
      id,
      sha(fs.readFileSync(path.join(root, "docs/user-guides", `${id}.md`))),
    ]),
  ),
  fixtures: [
    ...[
      "doc029-bulk-a.txt",
      "doc029-bulk-b.txt",
      "doc029-bulk-c.txt",
      "doc029-bulk-d.txt",
      "doc029-services-text.pdf",
      "doc029-scan.pdf",
      "doc029-draft-v1.docx",
      "doc029-schedule.csv",
    ].map((f) => ({
      path: `docs/documentation/batches/DOC-029/documents/fixtures/${f}`,
      sha256: sha(fs.readFileSync(dfix(f))),
    })),
    ...[
      "doc029-policy-a.pdf",
      "doc029-policy-b.pdf",
      "doc029-playbook.docx",
      "doc029-playbook-v2.docx",
      "doc029-checklist.pdf",
    ].map((f) => ({
      path: `docs/documentation/batches/DOC-029/knowledge/fixtures/${f}`,
      sha256: sha(fs.readFileSync(kfix(f))),
    })),
    {
      path: "(generated at run time, not kept) repo-search-<role>-<stamp>.pdf and -v2.pdf",
      note: "one-page PDFs with one fictional line each; v1 holds a zulu marker word, v2 a yankee marker word",
    },
    {
      path: "(generated at run time, not kept) doc030-oversize.bin",
      note: `${SIZE_LIMIT_MB + 1} MiB of zero bytes, one MiB over the lab's default upload ceiling: the intentionally failing file`,
    },
  ],
  sections: SECTIONS,
  roles: ROLES,
  stamp,
  settingsChanged: [],
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
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null; // trial runs only
async function step(article, role, action, expected, fn) {
  if (ONLY && !ONLY.test(action)) return null;
  const entry = {
    article,
    scenario: ARTICLES[article],
    role,
    method: "browser-walkthrough",
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
  entry.page = currentPage && !currentPage.isClosed() ? new URL(currentPage.url()).pathname : null;
  entry.at = new Date().toISOString();
  console.log(
    `[${role}] ${entry.result.toUpperCase()} ${article}: ${action}${entry.result === "fail" ? `\n    ${entry.actual}` : ""}`,
  );
  save();
  return entry;
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tidy = (s) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
const q = (v) => JSON.stringify(v);
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
function copyAs(src, name) {
  const dir = fs.mkdtempSync(path.join(WORK, "f-"));
  const dest = path.join(dir, name);
  fs.copyFileSync(src, dest);
  return dest;
}
// A one-page PDF with one line of text, so the lab extracts words from it (plain text files
// are not extracted).
function textPdf(file, line) {
  const esc = line.replace(/[\\()]/g, (c) => `\\${c}`);
  const stream = `BT /F1 14 Tf 72 720 Td (${esc}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  fs.writeFileSync(file, out, "latin1");
  return file;
}
function oversize() {
  const file = path.join(WORK, "doc030-oversize.bin");
  if (!fs.existsSync(file)) {
    const fd = fs.openSync(file, "w");
    fs.ftruncateSync(fd, (SIZE_LIMIT_MB + 1) * 1024 * 1024);
    fs.closeSync(fd);
  }
  return file;
}

// ---------- fixture and read-back helpers (API) ----------
let userIds = null;
let contractTypeId = null;
let adminReader = null;
async function admin() {
  adminReader ??= await staffContext(PEOPLE.daniel);
  return adminReader.page;
}
async function loadFixtureIds() {
  const page = await admin();
  const r = await api(page, "GET", "/users?limit=200");
  userIds = Object.fromEntries((r.body.users ?? []).map((u) => [u.email, u.id]));
  const o = await api(page, "GET", "/contracts/options");
  contractTypeId = o.body.contractTypes.find((t) => (t.name ?? t.displayName) === "NDA")?.id;
}
async function addTeam(page, number, email) {
  const r = await api(page, "POST", `/contracts/${number}/team`, { userId: userIds[email] });
  expect([200, 201, 409].includes(r.status), `fixture team add ${r.status}`);
}
async function createContract(page, role, title, extra = {}) {
  const r = await api(page, "POST", "/contracts", { title, contractTypeId, ...extra });
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
const MIME = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".csv": "text/csv",
};
function part(file, as) {
  return {
    name: as ?? path.basename(file),
    mimeType: MIME[path.extname(file)] ?? "application/octet-stream",
    buffer: fs.readFileSync(file),
  };
}
async function uploadApi(page, url, file, { as, documentTypeId, folderId } = {}) {
  const multipart = {};
  if (documentTypeId) multipart.documentTypeId = documentTypeId;
  if (folderId) multipart.folderId = folderId;
  multipart.file = part(file, as);
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
    const p = new URLSearchParams();
    if (cursor) p.set("cursor", cursor);
    if (archived) p.set("includeArchived", "true");
    const r = await api(page, "GET", `${recordUrl}/documents?${p}`);
    expect(r.status === 200, `read-back documents ${r.status}`);
    docs.push(...r.body.documents);
    cursor = r.body.nextCursor;
  } while (cursor);
  return docs;
}
async function getDoc(page, recordUrl, id) {
  return (await recordDocs(page, recordUrl, true)).find((d) => d.id === id) ?? null;
}
const folderOf = (d) => d.folderId ?? d.folder?.id ?? null;
const typeOf = (v) => v?.documentType?.displayName ?? null;
async function listTypes(module) {
  const r = await api(await admin(), "GET", `/documents/types/${module}`);
  expect(r.status === 200, `read-back type list ${r.status}`);
  return (r.body.documentTypes ?? []).filter((t) => !t.archivedAt);
}
async function folderList(page, recUrl) {
  const r = await api(page, "GET", `${recUrl}/folders`);
  expect(r.status === 200, `read-back folders ${r.status}`);
  return r.body.folders;
}
function folderPath(folders, folder) {
  const names = [];
  let at = folder;
  while (at) {
    names.unshift(at.name);
    at = folders.find((f) => f.id === at.parentId);
  }
  return names.join("/");
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
async function chooseMenu(page, title, item) {
  const menu = await rowMenu(page, title);
  await menu.getByRole("menuitem", { name: item, exact: true }).click();
}
async function chooseFiles(page, trigger, files) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), trigger.click()]);
  await chooser.setFiles(files);
}
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
async function nameDialog(page, title, name) {
  const dialog = page.getByRole("dialog", { name: title });
  await dialog.waitFor();
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Save" }).click();
  return dialog;
}
async function folderMenu(page, name, item) {
  await page.getByRole("button", { name: `Actions for the ${name} folder`, exact: true }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}
async function dragMouse(page, source, target, { revealTarget } = {}) {
  const from = await source.boundingBox();
  await page.mouse.move(from.x + 40, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 60, from.y + from.height / 2 + 10, { steps: 5 });
  if (revealTarget) await revealTarget.waitFor({ timeout: 5000 });
  const to = await target.boundingBox();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(here, name) }).catch(() => {});
  results.screenshots ??= [];
  results.screenshots.push(`${REL}/${name}`);
}

// =====================================================================
// Setup: a Matter Document type for this run (Settings → Documents), as Administrator
// =====================================================================
async function setup() {
  const role = "administrator";
  const { context, page } = await staffContext(PEOPLE.daniel);
  currentPage = page;
  await step(
    "document-folders",
    role,
    `Setup in the browser as Administrator: profile menu, Settings, Documents, Matters tab, Add type "${MATTER_TYPE}"`,
    "The new type is listed on the Matters tab; Matter imports can then show Type",
    async () => {
      await page.goto(`${BASE}/`);
      await page.getByRole("button", { name: PEOPLE.daniel.name, exact: true }).click();
      await page.getByRole("menuitem", { name: "Settings" }).click();
      await page.waitForURL((u) => u.pathname.startsWith("/settings"));
      await page
        .getByRole("navigation", { name: "Settings sections" })
        .getByRole("link", { name: "Documents", exact: true })
        .click();
      await page.waitForURL((u) => u.pathname === "/settings/documents/matters");
      const before = (await listTypes("matter")).map((t) => t.displayName);
      await page.getByRole("button", { name: "Add type" }).click();
      await page.getByLabel("New type name").fill(MATTER_TYPE);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.getByText(MATTER_TYPE, { exact: true }).first().waitFor({ timeout: 15000 });
      const t = (await listTypes("matter")).find((x) => x.displayName === MATTER_TYPE);
      expect(t, "type not read back");
      results.settingsChanged.push({
        setting: "Matter Document type list",
        added: MATTER_TYPE,
        id: t.id,
        restore: "archive at teardown",
      });
      record(role, "document_type:matter", MATTER_TYPE, t.id);
      return `Settings → Documents opened /settings/documents/matters (active Matter types before: ${before.length ? before.join(", ") : "none"}). Add type, New type name, Save listed "${MATTER_TYPE}" (read-back active).`;
    },
  );
  await context.close();
}

async function teardown() {
  // Put the Matter type list back: archive every type this group added (any run), so the
  // lab's list returns to what other agents left in place.
  const page = await admin();
  const r = await api(page, "GET", "/documents/types/matter");
  for (const t of (r.body.documentTypes ?? []).filter(
    (x) => !x.archivedAt && x.displayName.startsWith("DOC-030 documents-2 Matter type"),
  )) {
    const a = await api(page, "POST", `/documents/types/matter/${t.id}/archive`, {});
    const entry = results.settingsChanged.find((s) => s.id === t.id) ?? {
      setting: "Matter Document type list",
      added: t.displayName,
      id: t.id,
    };
    if (!results.settingsChanged.includes(entry)) results.settingsChanged.push(entry);
    entry.restored = `archived at teardown (${a.status})`;
  }
  save();
}

// =====================================================================
// document-folders (V-C27)
// =====================================================================
function makeTree(label) {
  const base = fs.mkdtempSync(path.join(WORK, "tree-"));
  const top = path.join(base, `doc030-tree-${label.toLowerCase()}-${stamp}`);
  fs.mkdirSync(path.join(top, "sub-a"), { recursive: true });
  fs.mkdirSync(path.join(top, "empty-dir"), { recursive: true });
  fs.writeFileSync(path.join(top, "doc030-top.txt"), "Fictional top file.\n");
  fs.writeFileSync(path.join(top, "sub-a", "doc030-nested.txt"), "Fictional nested file.\n");
  return { base, top, name: path.basename(top) };
}

async function folders(role, person) {
  const A = "document-folders";
  const label = role === "administrator" ? "Admin" : "Legal";
  const { context, page } = await staffContext(person);
  currentPage = page;
  const contract = await createContract(
    page,
    role,
    `DOC-030 documents-2 ${label} folders Contract ${stamp}`,
  );
  const recUrl = `/contracts/${contract.number}`;
  const parent = `DOC-030 ${label} Parent`;
  const child = `DOC-030 ${label} Child`;
  const other = `DOC-030 ${label} Other`;
  const loose = await uploadApi(page, `${recUrl}/documents`, dfix("doc029-bulk-a.txt"), {
    as: `doc030-${label.toLowerCase()}-loose-a.txt`,
  });
  const loose2 = await uploadApi(page, `${recUrl}/documents`, dfix("doc029-bulk-b.txt"), {
    as: `doc030-${label.toLowerCase()}-loose-b.txt`,
  });

  await step(
    A,
    role,
    "Create and maintain folders steps 1-2: Documents tab, New folder, Name, Save; an empty folder has no expand control",
    "The folder row appears without an expand control",
    async () => {
      await openDocuments(page, `${recUrl}/documents`);
      await docsSection(page).getByRole("button", { name: "New folder" }).click();
      const dialog = await nameDialog(page, "New folder", parent);
      await dialog.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: `Actions for the ${parent} folder` }).waitFor();
      const expand = await page.getByRole("button", { name: `Expand ${parent}` }).count();
      const rowText = tidy(
        await page
          .getByRole("row")
          .filter({ has: page.getByRole("button", { name: `Actions for the ${parent} folder` }) })
          .innerText(),
      );
      expect(expand === 0, "empty folder shows an expand control");
      return `New folder opened a dialog with Name and Save. The "${parent}" row appeared reading "${rowText}" with no expand control.`;
    },
  );

  await step(
    A,
    role,
    "Create and maintain folders steps 2-3: New subfolder and Rename from Actions for the … folder; a folder with contents gets an expand control",
    "The subfolder is created inside; the parent gains an expand/collapse control; Rename changes the name",
    async () => {
      await folderMenu(page, parent, "New subfolder");
      let dialog = await nameDialog(page, `New folder in ${parent}`, `${child} draft`);
      await dialog.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: `Actions for the ${child} draft folder` }).waitFor();
      const toggle = await page
        .getByRole("button", { name: new RegExp(`^(Collapse|Expand) ${parent}$`) })
        .count();
      await folderMenu(page, `${child} draft`, "Rename");
      dialog = await nameDialog(page, "Rename folder", child);
      await dialog.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: `Actions for the ${child} folder` }).waitFor();
      const list = await folderList(page, recUrl);
      const c = list.find((f) => f.name === child);
      const p = list.find((f) => f.name === parent);
      expect(
        c && p && c.parentId === p.id && toggle === 1,
        `child ${!!c} parent link ${c?.parentId === p?.id} toggle ${toggle}`,
      );
      return `Actions for the ${parent} folder offered New subfolder; its dialog "New folder in ${parent}" created the child, shown under the parent, which now had an expand/collapse control. Rename opened "Rename folder" and changed "${child} draft" to "${child}". Read-back: the child's parent is ${parent}.`;
    },
  );

  await step(
    A,
    role,
    "Folder name rules: a case-only duplicate sibling, a blank name, a slash, '.' and '..' are refused",
    "Each attempt shows a refusal in the dialog and creates nothing",
    async () => {
      const before = (await folderList(page, recUrl)).length;
      const seen = [];
      for (const name of [parent.toUpperCase(), "   ", "DOC-030 a/b", ".", ".."]) {
        await docsSection(page).getByRole("button", { name: "New folder" }).click();
        const dialog = await nameDialog(page, "New folder", name);
        const alert = dialog.getByRole("alert");
        await alert.waitFor({ timeout: 10000 });
        seen.push(`${q(name)}: ${tidy(await alert.innerText())}`);
        await dialog.getByRole("button", { name: "Cancel" }).click();
        await dialog.waitFor({ state: "hidden" });
      }
      const after = (await folderList(page, recUrl)).length;
      expect(after === before, `folders ${before} -> ${after}`);
      return `All five names were refused in the dialog and no folder was created (${before} folders before and after). ${seen.join("; ")}.`;
    },
  );

  await step(
    A,
    role,
    "Create and maintain folders step 3: Move, Move into, None; a folder cannot move into itself or a descendant",
    "Move into omits the folder and its descendant, the server refuses a cycle, and None returns a folder to the top level",
    async () => {
      await docsSection(page).getByRole("button", { name: "New folder" }).click();
      await (await nameDialog(page, "New folder", other)).waitFor({ state: "hidden" });
      await page.getByRole("button", { name: `Actions for the ${other} folder` }).waitFor();
      await folderMenu(page, parent, "Move");
      let dialog = page.getByRole("dialog", { name: `Move ${parent}` });
      const options = await optionTexts(dialog.getByLabel("Move into"));
      await dialog.getByRole("button", { name: "Cancel" }).click();
      expect(
        options.includes("None") &&
          !options.some((o) => o === parent || o.startsWith(`${parent}/`)) &&
          options.includes(other),
        `options ${options}`,
      );
      let list = await folderList(page, recUrl);
      const p = list.find((f) => f.name === parent);
      const c = list.find((f) => f.name === child);
      const cycle = await api(page, "PATCH", `/folders/${p.id}`, { parentId: c.id });
      const self = await api(page, "PATCH", `/folders/${p.id}`, { parentId: p.id });
      expect(
        cycle.status >= 400 && self.status >= 400,
        `cycle ${cycle.status} self ${self.status}`,
      );
      const expandParent = page.getByRole("button", { name: `Expand ${parent}` });
      if (await expandParent.isVisible().catch(() => false)) await expandParent.click();
      await folderMenu(page, child, "Move");
      dialog = page.getByRole("dialog", { name: `Move ${child}` });
      await dialog.getByLabel("Move into").selectOption({ label: other });
      await dialog.getByRole("button", { name: "Move", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      list = await folderList(page, recUrl);
      const underOther =
        folderPath(
          list,
          list.find((f) => f.name === child),
        ) === `${other}/${child}`;
      await page
        .getByRole("button", { name: `Expand ${other}` })
        .click()
        .catch(() => {});
      await folderMenu(page, child, "Move");
      dialog = page.getByRole("dialog", { name: `Move ${child}` });
      await dialog.getByLabel("Move into").selectOption({ label: "None" });
      await dialog.getByRole("button", { name: "Move", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      list = await folderList(page, recUrl);
      const top = list.find((f) => f.name === child).parentId === null;
      expect(underOther && top, `underOther ${underOther} top ${top}`);
      return `Move into for "${parent}" offered ${options.join(", ")}: not the folder itself or its child. A second-actor request to move it into its own child was refused (${cycle.status}: ${tidy(cycle.body?.detail).slice(0, 90)}) and into itself (${self.status}). Moving "${child}" into "${other}" read back as ${other}/${child}; Move into None put it at the top level.`;
    },
  );

  await step(
    A,
    role,
    "Create and maintain folders step 4: Actions, Move to folder, File in, Move; None moves it out",
    "The Document is filed in the folder and then moved back to the record",
    async () => {
      await openDocuments(page, `${recUrl}/documents`);
      await chooseMenu(page, loose.title, "Move to folder");
      let dialog = page.getByRole("dialog", { name: `Move ${loose.title}` });
      await dialog.getByLabel("File in").selectOption({ label: parent });
      await dialog.getByRole("button", { name: "Move", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      const p = (await folderList(page, recUrl)).find((f) => f.name === parent);
      let doc = await getDoc(page, recUrl, loose.id);
      const filed = folderOf(doc) === p.id;
      const expand = page.getByRole("button", { name: `Expand ${parent}` });
      await expand.waitFor();
      await expand.click();
      await page.getByRole("button", { name: `Actions for ${loose.title}`, exact: true }).waitFor();
      await chooseMenu(page, loose.title, "Move to folder");
      dialog = page.getByRole("dialog", { name: `Move ${loose.title}` });
      await dialog.getByLabel("File in").selectOption({ label: "None" });
      await dialog.getByRole("button", { name: "Move", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      doc = await getDoc(page, recUrl, loose.id);
      expect(filed && !folderOf(doc), `filed ${filed} out ${!folderOf(doc)}`);
      return `Move to folder opened "Move ${loose.title}" with File in; choosing "${parent}" filed the Document there, shown after expanding the folder. File in None moved it back onto the record (read-back).`;
    },
  );

  await step(
    A,
    role,
    "Create and maintain folders step 4: drag a Document row onto a folder row, then onto Drop here to move out of folders",
    "Dragging files the Document into the folder and back out",
    async () => {
      await openDocuments(page, `${recUrl}/documents`);
      const row = page.getByRole("row").filter({
        has: page.getByRole("button", { name: `Actions for ${loose2.title}`, exact: true }),
      });
      const folderRow = page
        .getByRole("row")
        .filter({ has: page.getByRole("button", { name: `Actions for the ${other} folder` }) });
      await dragMouse(page, row, folderRow);
      const p = (await folderList(page, recUrl)).find((f) => f.name === other);
      await until(
        async () => folderOf(await getDoc(page, recUrl, loose2.id)) === p.id,
        "drag onto folder row did not file the Document",
        8000,
      );
      await openDocuments(page, `${recUrl}/documents`);
      await page.getByRole("button", { name: `Expand ${other}` }).click();
      const inner = page.getByRole("row").filter({
        has: page.getByRole("button", { name: `Actions for ${loose2.title}`, exact: true }),
      });
      await inner.waitFor();
      const target = page.getByText("Drop here to move out of folders");
      await dragMouse(page, inner, target, { revealTarget: target });
      await until(
        async () => !folderOf(await getDoc(page, recUrl, loose2.id)),
        "drop target did not move the Document out",
        8000,
      );
      return `Dragging the "${loose2.title}" row onto the "${other}" folder row filed it there (read-back). Dragging it from inside the folder showed "Drop here to move out of folders"; dropping on it moved the Document back to the record.`;
    },
  );

  await step(
    A,
    role,
    "Create and maintain folders step 4: select checkboxes and Move in the selection bar",
    "Both selected Documents move into the chosen folder",
    async () => {
      await openDocuments(page, `${recUrl}/documents`);
      await page.getByRole("checkbox", { name: `Select ${loose.title}` }).click();
      await page.getByRole("checkbox", { name: `Select ${loose2.title}` }).click();
      const bar = page.getByText("2 selected", { exact: true }).locator("xpath=../..");
      await bar.getByRole("button", { name: "Move", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Move 2 documents" });
      await dialog.getByLabel("File in").selectOption({ label: parent });
      await dialog.getByRole("button", { name: "Move", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 20000 });
      const p = (await folderList(page, recUrl)).find((f) => f.name === parent);
      const docs = [await getDoc(page, recUrl, loose.id), await getDoc(page, recUrl, loose2.id)];
      expect(
        docs.every((d) => folderOf(d) === p.id),
        "bulk move did not file both",
      );
      return `Selecting both checkboxes showed "2 selected" with Move. The "Move 2 documents" dialog with File in "${parent}" filed both Documents there (read-back).`;
    },
  );

  await step(
    A,
    role,
    "Folder Delete dissolves the folder: contents move to its parent or the record; nothing is deleted",
    "The confirmation says where contents go; the Documents stay live on the record",
    async () => {
      await openDocuments(page, `${recUrl}/documents`);
      await folderMenu(page, parent, "Delete");
      const dialog = page.getByRole("dialog", { name: `Delete the ${parent} folder?` });
      const text = tidy(await dialog.innerText());
      await dialog.getByRole("button", { name: "Delete", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      const list = await folderList(page, recUrl);
      const docs = await recordDocs(page, recUrl);
      const both = [loose.id, loose2.id].every((id) =>
        docs.some((d) => d.id === id && !folderOf(d)),
      );
      expect(
        !list.some((f) => f.name === parent) && both && /Nothing is deleted/.test(text),
        `text ${text}`,
      );
      return `The confirmation read "${text}". After Delete the folder was gone and both Documents were live at the record root (read-back).`;
    },
  );

  await step(
    A,
    role,
    "Import several files step 3: Type starts on No type, or on the type chosen in the upload dialog; a Contract import always shows Type",
    "The Import dialog's Type starts on No type after a plain pick and on the chosen type after one was picked in Upload document",
    async () => {
      await openDocuments(page, `${recUrl}/documents`);
      let composer = await uploadDialog(page);
      await chooseFiles(page, composer.getByRole("button", { name: /Choose files$/ }), [
        dfix("doc029-bulk-a.txt"),
        dfix("doc029-bulk-b.txt"),
      ]);
      let dialog = page.getByRole("dialog", { name: "Import 2 files" });
      await dialog.waitFor();
      const plainStart = await selectedText(dialog.getByLabel("Type", { exact: true }));
      const options = await optionTexts(dialog.getByLabel("Type", { exact: true }));
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      composer = await uploadDialog(page);
      await composer.getByLabel("Type", { exact: true }).selectOption({ label: "Executed" });
      await chooseFiles(page, composer.getByRole("button", { name: /Choose files$/ }), [
        dfix("doc029-bulk-a.txt"),
        dfix("doc029-bulk-b.txt"),
      ]);
      dialog = page.getByRole("dialog", { name: "Import 2 files" });
      await dialog.waitFor();
      const carried = await selectedText(dialog.getByLabel("Type", { exact: true }));
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      expect(
        plainStart === "No type" && options[0] === "No type" && carried === "Executed",
        `plain ${plainStart} carried ${carried} options ${options}`,
      );
      return `Upload, Choose files with two files opened "Import 2 files" with Type on "No type"; its options were ${options.join(", ")}. Choosing Type "Executed" in Upload document first, then two files, opened the Import dialog with Type already on "Executed". Cancel closed both without uploading.`;
    },
  );

  await step(
    A,
    role,
    "Import several files steps 1-5 and Recover a partial import: Destination Record root, Type, a real oversize file and a dropped connection; counts, row Retry, Done",
    "Good files stay as v1 Documents of the chosen type; the oversize row is named without Retry; the dropped row has Retry and a retry sends only it; Done closes",
    async () => {
      await openDocuments(page, `${recUrl}/documents`);
      const big = oversize();
      let dropOnce = true;
      const routeUrl = `**/api/v1/contracts/${contract.number}/documents`;
      await page.route(routeUrl, async (route) => {
        const body = route.request().postDataBuffer();
        const head = body ? body.subarray(0, 4096).toString("latin1") : "";
        if (
          route.request().method() === "POST" &&
          dropOnce &&
          head.includes('filename="doc029-bulk-c.txt"')
        ) {
          dropOnce = false;
          return route.abort("connectionreset");
        }
        return route.continue();
      });
      const beforeDocs = await recordDocs(page, recUrl);
      const before = beforeDocs.length;
      const beforeIds = new Set(beforeDocs.map((d) => d.id));
      const composer = await uploadDialog(page);
      await chooseFiles(page, composer.getByRole("button", { name: /Choose files$/ }), [
        dfix("doc029-bulk-a.txt"),
        dfix("doc029-bulk-b.txt"),
        dfix("doc029-bulk-c.txt"),
        big,
      ]);
      const dialog = page.getByRole("dialog", { name: "Import 4 files" });
      await dialog.getByLabel("Type", { exact: true }).waitFor();
      const confirmText = tidy(await dialog.innerText());
      const typeHelp = await page.evaluate(
        () => document.getElementById("batch-type-help")?.textContent ?? null,
      );
      const typeDescribedBy = await dialog
        .getByLabel("Type", { exact: true })
        .getAttribute("aria-describedby");
      await dialog.getByLabel("Type", { exact: true }).selectOption({ label: "Draft · theirs" });
      await dialog.getByRole("button", { name: "Import 4 files" }).click();
      const settled = page.getByRole("dialog", { name: "Imported 2 of 4 files" });
      await settled.waitFor({ timeout: 120000 });
      const settledText = tidy(await settled.innerText());
      if (role === "legal_team_member") await shot(page, "legal-partial-import.png");
      const retryDropped = await settled
        .getByRole("button", { name: "Retry doc029-bulk-c.txt" })
        .count();
      const retryBig = await settled
        .getByRole("button", { name: "Retry doc030-oversize.bin" })
        .count();
      const retryAll = await settled
        .getByRole("button", { name: /^Retry \d+ files?$/ })
        .allInnerTexts();
      const mid = await recordDocs(page, recUrl);
      const midAdded = mid.length - before;
      await settled.getByRole("button", { name: "Retry doc029-bulk-c.txt" }).click();
      await until(
        async () =>
          /Imported 3 of 4 files/.test(
            tidy(
              await page
                .getByRole("dialog")
                .first()
                .innerText()
                .catch(() => ""),
            ),
          ),
        "retry did not settle at 3 of 4",
        60000,
      );
      const after = page.getByRole("dialog", { name: "Imported 3 of 4 files" });
      const afterText = tidy(await after.innerText());
      await after.getByRole("button", { name: "Done" }).click();
      await after.waitFor({ state: "hidden" });
      await page.unroute(routeUrl);
      const final = await recordDocs(page, recUrl);
      const added = final.filter((d) => !mid.some((m) => m.id === d.id));
      const fresh = final.filter((d) => !beforeIds.has(d.id));
      expect(
        /Destination/.test(confirmText) &&
          /Record root/.test(confirmText) &&
          /Type/.test(confirmText),
        `confirm ${confirmText}`,
      );
      expect(
        midAdded === 2 &&
          retryDropped === 1 &&
          retryBig === 0 &&
          added.length === 1 &&
          fresh.length === 3,
        `mid ${midAdded} retryDropped ${retryDropped} retryBig ${retryBig} added ${added.length} fresh ${fresh.length}`,
      );
      expect(
        fresh.every((d) => d.versions.length === 1 && typeOf(d.versions[0]) === "Draft · theirs"),
        `types ${fresh.map((d) => typeOf(d.versions[0]))}`,
      );
      return `Choose files with three text files and a ${SIZE_LIMIT_MB + 1} MiB file opened "Import 4 files" reading "${confirmText.slice(0, 240)}". The Type control's help (aria-describedby ${typeDescribedBy}) read ${q(typeHelp)}. With Type "Draft · theirs" and the browser dropping the connection once for doc029-bulk-c.txt, the dialog settled as "${settledText.slice(0, 420)}". The oversize row had no Retry (count ${retryBig}); the dropped row had "Retry doc029-bulk-c.txt"; the footer offered ${q(retryAll)}. The two good files were already on the record (+${midAdded}). Row Retry sent only the dropped file: "${afterText.slice(0, 160)}". Done closed it. The record gained exactly 3 Documents, each at Version 1 with Type Draft · theirs (read-back).`;
    },
  );

  await step(
    A,
    role,
    "Import step 5: when every file uploads the dialog closes after the list refreshes",
    "The dialog closes by itself and both files are listed",
    async () => {
      const before = (await recordDocs(page, recUrl)).length;
      const composer = await uploadDialog(page);
      await chooseFiles(page, composer.getByRole("button", { name: /Choose files$/ }), [
        dfix("doc029-bulk-c.txt"),
        dfix("doc029-bulk-d.txt"),
      ]);
      const dialog = page.getByRole("dialog", { name: "Import 2 files" });
      await dialog.getByRole("button", { name: "Import 2 files" }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 30000 });
      const after = await recordDocs(page, recUrl);
      const rows = await docsSection(page)
        .getByRole("button", { name: /^Actions for doc029-bulk-d/ })
        .count();
      expect(
        after.length === before + 2 && rows >= 1,
        `added ${after.length - before} rows ${rows}`,
      );
      return `A two-file import with no failure closed the dialog by itself; the Documents list showed the new rows and the record gained two Documents (read-back).`;
    },
  );

  await step(
    A,
    role,
    "Recover a partial import: Cancel remaining stops queued work; uploaded files remain; final counts are shown",
    "Queued files are cancelled, finished uploads stay on the record, and the dialog shows the final counts",
    async () => {
      const routeUrl = `**/api/v1/contracts/${contract.number}/documents`;
      await page.route(routeUrl, async (route) => {
        if (route.request().method() === "POST") await sleep(4000);
        return route.continue();
      });
      const before = (await recordDocs(page, recUrl)).length;
      const composer = await uploadDialog(page);
      const files = [
        "doc029-bulk-a.txt",
        "doc029-bulk-b.txt",
        "doc029-bulk-c.txt",
        "doc029-bulk-d.txt",
        "doc029-schedule.csv",
      ];
      await chooseFiles(
        page,
        composer.getByRole("button", { name: /Choose files$/ }),
        files.map(dfix),
      );
      await page
        .getByRole("dialog", { name: "Import 5 files" })
        .getByRole("button", { name: "Import 5 files" })
        .click();
      const running = page.getByRole("dialog", { name: "Importing 5 files" });
      await running.waitFor();
      const keepOpen = await running
        .getByText("Keep this dialog open until the import finishes.")
        .count();
      await running.getByRole("button", { name: "Cancel remaining" }).click();
      const settled = page.getByRole("dialog", { name: /^Imported \d of 5 files$/ });
      await settled.waitFor({ timeout: 60000 });
      const text = tidy(await settled.innerText());
      const cancelled = (text.match(/Cancelled before it was uploaded\./g) ?? []).length;
      await settled.getByRole("button", { name: "Done" }).click();
      await page.unroute(routeUrl);
      const after = (await recordDocs(page, recUrl)).length;
      const landed = Number(text.match(/Imported (\d) of 5 files/)?.[1]);
      expect(
        cancelled > 0 && after - before === landed && keepOpen === 1,
        `cancelled ${cancelled} landed ${landed} added ${after - before}`,
      );
      return `With each upload slowed four seconds by the browser, the running dialog said "Keep this dialog open until the import finishes." Cancel remaining settled it at "Imported ${landed} of 5 files": ${cancelled} file(s) read "Cancelled before it was uploaded." and the ${landed} uploaded file(s) were on the record (read-back +${after - before}).`;
    },
  );

  let tree;
  await step(
    A,
    role,
    "Keep a local folder structure: Choose folder keeps nested paths; the folder picker drops empty folders; a matching path is reused",
    "The top-level folder and its nested child are created with their files; the empty folder is not; a second import reuses the path",
    async () => {
      tree = makeTree(label);
      await openDocuments(page, `${recUrl}/documents`);
      let composer = await uploadDialog(page);
      await chooseFiles(page, composer.getByRole("button", { name: /Choose folder/ }), tree.top);
      const dialog = page.getByRole("dialog", { name: "Import 2 files" });
      await dialog.waitFor();
      const text = tidy(await dialog.innerText());
      await dialog.getByRole("button", { name: "Import 2 files" }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 30000 });
      let list = await folderList(page, recUrl);
      const paths = list.map((f) => folderPath(list, f));
      const top = list.filter((f) => f.name === tree.name);
      const nested = paths.includes(`${tree.name}/sub-a`);
      const empty = paths.includes(`${tree.name}/empty-dir`);
      composer = await uploadDialog(page);
      await chooseFiles(page, composer.getByRole("button", { name: /Choose folder/ }), tree.top);
      await page
        .getByRole("dialog", { name: "Import 2 files" })
        .getByRole("button", { name: "Import 2 files" })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 30000 });
      list = await folderList(page, recUrl);
      const topAfter = list.filter((f) => f.name === tree.name).length;
      expect(
        /Folder structure is kept/.test(text) &&
          top.length === 1 &&
          nested &&
          !empty &&
          topAfter === 1,
        `text ${text.slice(0, 120)} top ${top.length} nested ${nested} empty ${empty} again ${topAfter}`,
      );
      return `Choose folder on a local tree (two files, one nested folder, one empty folder) opened "Import 2 files" reading "${text.slice(0, 220)}". The import created ${tree.name} and ${tree.name}/sub-a with the files; the empty folder was not created. Importing the same tree again reused ${tree.name} (still one folder of that name).`;
    },
  );

  await step(
    A,
    role,
    "Import steps 1-2 and Keep structure: drop a local folder on a folder row; Destination is that folder; a dropped tree recreates empty folders",
    "The Import dialog names the folder as Destination and the empty folder is recreated",
    async () => {
      await openDocuments(page, `${recUrl}/documents`);
      const folderRow = page
        .getByRole("row")
        .filter({ has: page.getByRole("button", { name: `Actions for the ${other} folder` }) });
      const box = await folderRow.boundingBox();
      const cdp = await context.newCDPSession(page);
      const data = { items: [], files: [tree.top], dragOperationsMask: 1 };
      const x = box.x + box.width / 3;
      const y = box.y + box.height / 2;
      await cdp.send("Input.dispatchDragEvent", { type: "dragEnter", x, y, data });
      await cdp.send("Input.dispatchDragEvent", { type: "dragOver", x, y, data });
      await cdp.send("Input.dispatchDragEvent", { type: "drop", x, y, data });
      const dialog = page.getByRole("dialog", { name: /^Import/ });
      await dialog.waitFor({ timeout: 15000 });
      const text = tidy(await dialog.innerText());
      await dialog
        .getByRole("button", { name: /^Import/ })
        .last()
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 30000 });
      const list = await folderList(page, recUrl);
      const paths = list.map((f) => folderPath(list, f));
      expect(
        text.includes(other) &&
          paths.includes(`${other}/${tree.name}/empty-dir`) &&
          paths.includes(`${other}/${tree.name}/sub-a`),
        `text ${text.slice(0, 160)} paths ${paths.join("|")}`,
      );
      return `Dropping the local tree on the "${other}" row opened a dialog reading "${text.slice(0, 220)}". The import created ${other}/${tree.name}/sub-a and the empty ${other}/${tree.name}/empty-dir.`;
    },
  );

  await step(
    A,
    role,
    "Import step 3: a Matter import shows Type when the Matter list has a type; the chosen type is applied",
    `Import 2 files on a Matter shows Type with No type and "${MATTER_TYPE}"; both new Versions carry it`,
    async () => {
      const active = (await listTypes("matter")).map((t) => t.displayName);
      expect(active.includes(MATTER_TYPE), `run's Matter type not active: ${active}`);
      const matter = await createMatter(
        page,
        role,
        `DOC-030 documents-2 ${label} folders Matter ${stamp}`,
      );
      await openDocuments(page, `/matters/${matter.number}/documents`);
      const composer = await uploadDialog(page);
      await chooseFiles(page, composer.getByRole("button", { name: /Choose files$/ }), [
        dfix("doc029-bulk-a.txt"),
        dfix("doc029-bulk-b.txt"),
      ]);
      const dialog = page.getByRole("dialog", { name: "Import 2 files" });
      await dialog.waitFor();
      const typeSel = dialog.getByLabel("Type", { exact: true });
      const start = await selectedText(typeSel);
      const opts = await optionTexts(typeSel);
      await typeSel.selectOption({ label: MATTER_TYPE });
      await dialog.getByRole("button", { name: "Import 2 files" }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 30000 });
      const docs = await recordDocs(page, `/matters/${matter.number}`);
      expect(
        start === "No type" &&
          opts.includes(MATTER_TYPE) &&
          docs.length === 2 &&
          docs.every((d) => typeOf(d.versions[0]) === MATTER_TYPE),
        `start ${start} opts ${opts} types ${docs.map((d) => typeOf(d.versions[0]))}`,
      );
      return `The Matter's active type list held ${active.length} type(s). Import 2 files showed Destination and Type (start "No type"; options ${opts.join(", ")}). With "${MATTER_TYPE}" chosen, both new Documents were Version 1 of that type (read-back).`;
    },
  );

  await step(
    A,
    role,
    "Import step 3: an Entity import shows Type only when the Entity list has a type",
    "The Type control is present exactly when the Entity type list is not empty",
    async () => {
      const active = await listTypes("entity");
      const ent = await createEntity(
        page,
        role,
        `DOC-030 documents-2 ${label} folders Entity ${stamp} Ltd`,
      );
      await openDocuments(page, `/entities/${ent.id}/documents`);
      const composer = await uploadDialog(page);
      await chooseFiles(page, composer.getByRole("button", { name: /Choose files$/ }), [
        dfix("doc029-bulk-a.txt"),
        dfix("doc029-bulk-b.txt"),
      ]);
      const dialog = page.getByRole("dialog", { name: "Import 2 files" });
      await dialog.waitFor();
      await dialog
        .getByLabel("Type", { exact: true })
        .waitFor({ timeout: 8000 })
        .catch(() => {});
      await page.waitForLoadState("networkidle").catch(() => {});
      const count = await dialog.getByLabel("Type", { exact: true }).count();
      const dest = await dialog.getByText("Destination").count();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      expect(
        dest === 1 && count === (active.length > 0 ? 1 : 0),
        `type ${count} active ${active.length}`,
      );
      if (active.length > 0)
        results.limitations.push({
          article: A,
          claim:
            "A Matter or Entity import shows Type only when an Administrator has added a type to that module's list.",
          note: `The shared lab's Entity and Matter lists already held types another agent added (Entity: ${active.map((t) => t.displayName).join(", ")}). This run did not archive another agent's types to empty a list, so the empty-list half was not shown on work2. The Entity import showed Type while its list was non-empty, and the run's own Matter type appeared in the Matter import.`,
        });
      return `The Entity type list held ${active.length} active type(s) (${active.map((t) => t.displayName).join(", ") || "none"}). On Entity "${ent.legalName}", Import 2 files showed Destination and ${count ? "a Type control" : "no Type control"}. Cancel closed it.`;
    },
  );

  if (tree) fs.rmSync(tree.base, { recursive: true, force: true });
  await context.close();
}

// =====================================================================
// document-repository (V-C30)
// =====================================================================
let hiddenFixture = null;
async function hiddenPaper() {
  // An Administrator-created Confidential Contract whose team is the Administrator alone,
  // with its own Counterparty, so its name can be checked in the filter choices.
  if (hiddenFixture) return hiddenFixture;
  const page = await admin();
  const title = `DOC-030 documents-2 hidden owner ${stamp}`;
  const c = await createContract(page, "administrator", title, { isConfidential: true });
  const cpName = `DOC-030 Hidden Counterparty ${stamp}`;
  const cp = await api(page, "POST", `/contracts/${c.number}/counterparties`, { name: cpName });
  expect([200, 201].includes(cp.status), `fixture hidden counterparty ${cp.status}`);
  const doc = await uploadApi(
    page,
    `/contracts/${c.number}/documents`,
    dfix("doc029-services-text.pdf"),
    { as: `repo-hidden-${stamp}.pdf` },
  );
  hiddenFixture = { contract: c, doc, title, cpName };
  return hiddenFixture;
}
const repoTable = (page) => page.getByRole("main").getByRole("table");
async function repoRows(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  const empty = page.getByText("No documents match these filters.");
  if (await empty.isVisible().catch(() => false)) return [];
  await repoTable(page).waitFor({ timeout: 20000 });
  return (await repoTable(page).getByRole("row").allInnerTexts()).map(tidy);
}
async function openFilter(page, name) {
  for (let i = 0; i < 3 && (await page.getByRole("dialog").count()) > 0; i++)
    await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: /^Filter/ })
    .first()
    .click();
  const pop = page.getByRole("dialog", { name: "Filter" });
  await pop.waitFor();
  if (name) await pop.getByRole("button", { name: new RegExp(`^${escapeRe(name)}( ✓)?$`) }).click();
  return pop;
}
async function menuNames(page) {
  const pop = await openFilter(page);
  const names = (await pop.getByRole("button").allInnerTexts()).map((t) =>
    tidy(t.replace(/[✓]/g, "")),
  );
  await page.keyboard.press("Escape");
  return names;
}
async function applyChoice(page, filter, choices, search) {
  const pop = await openFilter(page, filter);
  const hint = tidy(await pop.innerText());
  for (const choice of choices) {
    if (search) await pop.getByLabel("Search choices").fill(search);
    await pop.getByText(choice, { exact: true }).click();
  }
  await pop.getByRole("button", { name: "Apply" }).click();
  await pop.waitFor({ state: "hidden" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(700);
  return hint;
}
async function clearAll(page) {
  const clear = page.getByRole("button", { name: "Clear all" });
  if (
    await clear
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    await clear.first().click();
    await page.waitForLoadState("networkidle").catch(() => {});
    await sleep(700);
  }
}
const removeChip = (page, name) => page.getByRole("button", { name: `Remove ${name} filter` });

async function repository(role, person) {
  const A = "document-repository";
  const label = role === "administrator" ? "Admin" : "Legal";
  const hidden = await hiddenPaper();
  const { context, page } = await staffContext(person);
  currentPage = page;
  const me = (await api(page, "GET", "/me")).body.user;
  const contract = await createContract(
    page,
    role,
    `DOC-030 documents-2 ${label} repository Contract ${stamp}`,
  );
  const recUrl = `/contracts/${contract.number}`;
  const cpName = `DOC-030 ${label} Northwind ${stamp}`;
  const cp = await api(page, "POST", `${recUrl}/counterparties`, { name: cpName });
  expect([200, 201].includes(cp.status), `fixture counterparty ${cp.status}`);
  const fname = `DOC-030 ${label} Repo folder`;
  const f = await api(page, "POST", `${recUrl}/folders`, { name: fname });
  expect(f.status === 201, `fixture folder ${f.status}`);
  const folderId = (await folderList(page, recUrl)).find((x) => x.name === fname).id;
  const ctypes = Object.fromEntries(
    (await listTypes("contract")).map((t) => [t.displayName, t.id]),
  );
  const tag = `${label.toLowerCase()}-${stamp}`;
  const rootPdf = await uploadApi(page, `${recUrl}/documents`, dfix("doc029-services-text.pdf"), {
    as: `repo-root-${tag}.pdf`,
    documentTypeId: ctypes["Draft · ours"],
  });
  const v2 = await api(page, "POST", `/documents/${rootPdf.id}/versions`, undefined, {
    documentTypeId: ctypes["Draft · theirs"],
    file: part(dfix("doc029-scan.pdf"), `repo-root-${tag}-v2.pdf`),
  });
  expect(
    v2.status === 201,
    `fixture version ${v2.status} ${JSON.stringify(v2.body).slice(0, 160)}`,
  );
  const filedDocx = await uploadApi(page, `${recUrl}/documents`, dfix("doc029-draft-v1.docx"), {
    as: `repo-folder-${tag}.docx`,
    documentTypeId: ctypes["Executed"],
    folderId,
  });
  const archivable = await uploadApi(page, `${recUrl}/documents`, dfix("doc029-bulk-a.txt"), {
    as: `repo-archive-${tag}.txt`,
  });
  const draggable = await uploadApi(page, `${recUrl}/documents`, dfix("doc029-bulk-b.txt"), {
    as: `repo-drag-${tag}.txt`,
  });
  const matter = await createMatter(
    page,
    role,
    `DOC-030 documents-2 ${label} repository Matter ${stamp}`,
  );
  const matterDoc = await uploadApi(
    page,
    `/matters/${matter.number}/documents`,
    dfix("doc029-services-text.pdf"),
    { as: `repo-matter-${tag}.pdf` },
  );
  const ent = await createEntity(
    page,
    role,
    `DOC-030 documents-2 ${label} repository Entity ${stamp} Ltd`,
  );
  const entityDoc = await uploadApi(
    page,
    `/entities/${ent.id}/documents`,
    dfix("doc029-services-text.pdf"),
    { as: `repo-entity-${tag}.pdf` },
  );
  const kType = (await api(page, "GET", "/knowledge/type-options")).body.knowledgeTypes.find(
    (t) => t.displayName === "Precedent",
  );
  const k = await api(page, "POST", "/knowledge", {
    title: `DOC-030 documents-2 ${label} repository Knowledge ${stamp}`,
    knowledgeTypeId: kType.id,
  });
  expect(k.status === 201, `fixture knowledge ${k.status}`);
  record(role, "knowledge_item", k.body.knowledgeItem.title, k.body.knowledgeItem.id);
  const knowledgeDoc = await uploadApi(
    page,
    `/knowledge/${k.body.knowledgeItem.id}/documents`,
    dfix("doc029-services-text.pdf"),
    { as: `repo-knowledge-${tag}.pdf` },
  );
  const ad = await api(page, "POST", "/auto-docs", {
    name: `DOC-030 documents-2 ${label} repository Auto-Doc ${stamp}`,
  });
  expect(
    ad.status === 201,
    `fixture auto-doc ${ad.status} ${JSON.stringify(ad.body).slice(0, 160)}`,
  );
  const autoDocId = ad.body.autoDoc?.id ?? ad.body.record?.id ?? ad.body.id;
  record(role, "auto_doc", `DOC-030 documents-2 ${label} repository Auto-Doc ${stamp}`, autoDocId);
  const tpl = await api(page, "POST", `/auto-docs/${autoDocId}/template`, undefined, {
    file: part(dfix("doc029-draft-v1.docx"), `repo-autodoc-${tag}.docx`),
  });
  expect(
    [200, 201].includes(tpl.status),
    `fixture template ${tpl.status} ${JSON.stringify(tpl.body).slice(0, 200)}`,
  );
  const autoDocDoc = (
    await api(page, "GET", "/documents?owner=auto_doc&limit=100")
  ).body.documents.find((d) => d.owner.id === autoDocId);
  expect(autoDocDoc, "fixture auto-doc Document not in the repository read");
  const mine = [rootPdf, filedDocx, archivable, draggable].map((d) => d.title);
  const has = (rows, title) => rows.some((r) => r.includes(title));

  await step(
    A,
    role,
    "Search and narrow step 1: Documents from navigation; Recent shows up to five Documents by current-Version upload, not by opening",
    "Recent lists at most five in newest-current-Version order, and opening an older Document does not change it",
    async () => {
      await page.goto(`${BASE}/`);
      await page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("link", { name: "Documents" })
        .click();
      await page.waitForURL(/\/documents/);
      const recent = page.getByRole("region", { name: "Recent documents" });
      await recent.waitFor({ timeout: 30000 });
      const read = async () => {
        let ui, apiTitles;
        for (let i = 0; i < 4; i++) {
          ui = (
            await recent
              .getByRole("link")
              .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))
          ).map((t) => String(t).replace(/^Open recent Document /, ""));
          apiTitles = (await api(page, "GET", "/documents?limit=5")).body.documents.map(
            (d) => d.title,
          );
          if (JSON.stringify(ui) === JSON.stringify(apiTitles)) break;
          await page.reload();
          await recent.waitFor();
        }
        return { ui, apiTitles };
      };
      const first = await read();
      expect(
        first.ui.length <= 5 && JSON.stringify(first.ui) === JSON.stringify(first.apiTitles),
        `ui ${first.ui} api ${first.apiTitles}`,
      );
      await page.goto(
        `${BASE}/contracts/${contract.number}/documents?doc=${filedDocx.id}&version=${filedDocx.versions[0].id}`,
      );
      await page
        .getByRole("complementary", { name: `${filedDocx.title}, version 1` })
        .waitFor({ timeout: 30000 });
      await page.goto(`${BASE}/documents`);
      await recent.waitFor();
      const second = await read();
      expect(
        JSON.stringify(second.ui) === JSON.stringify(second.apiTitles) &&
          (!second.apiTitles.includes(filedDocx.title) ||
            first.apiTitles.includes(filedDocx.title)),
        `after ${second.ui}`,
      );
      return `The Documents navigation link opened the repository. Recent listed ${first.ui.length} Documents in the same order as the newest-current-Version read (${first.ui.slice(0, 2).join(", ")}, …). After opening the older "${filedDocx.title}" and returning, Recent still matched the upload-time order and did not add it.`;
    },
  );

  await step(
    A,
    role,
    "Search and narrow step 2: Filter, Owner, Contracts/Matters/Entities/Auto-Docs/Knowledge, Apply",
    "Owner offers the five kinds and each narrows to paper of that owner kind",
    async () => {
      const pop = await openFilter(page, "Owner");
      const choices = (await pop.locator("label").allInnerTexts()).map((t) => t.trim());
      await page.keyboard.press("Escape");
      expect(
        JSON.stringify(choices) ===
          JSON.stringify(["Contracts", "Matters", "Entities", "Auto-Docs", "Knowledge"]),
        `choices ${choices}`,
      );
      const expectations = [
        ["Contracts", rootPdf.title, [matterDoc.title, entityDoc.title, knowledgeDoc.title]],
        ["Matters", matterDoc.title, [rootPdf.title, entityDoc.title, knowledgeDoc.title]],
        ["Entities", entityDoc.title, [rootPdf.title, matterDoc.title, knowledgeDoc.title]],
        ["Knowledge", knowledgeDoc.title, [rootPdf.title, matterDoc.title, entityDoc.title]],
        [
          "Auto-Docs",
          autoDocDoc.title,
          [rootPdf.title, matterDoc.title, entityDoc.title, knowledgeDoc.title],
        ],
      ];
      const seen = [];
      for (const [choice, present, absent] of expectations) {
        await clearAll(page);
        await applyChoice(page, "Owner", [choice]);
        const rows = await repoRows(page);
        expect(
          has(rows, present) && absent.every((t) => !has(rows, t)),
          `${choice}: ${rows.slice(0, 4)}`,
        );
        seen.push(`${choice}: ${Math.max(0, rows.length - 1)} rows including ${present}`);
      }
      await clearAll(page);
      return `Owner offered ${choices.join(", ")}. ${seen.join("; ")}. Each list left out the fixture paper of the other owner kinds.`;
    },
  );

  await step(
    A,
    role,
    "Search and narrow step 3: Record with Search choices; Folder becomes available for one Contract, with Record root; no Folder for Knowledge or Auto-Docs",
    "Record narrows to one Contract; Folder picks the folder or Record root",
    async () => {
      await applyChoice(
        page,
        "Record",
        [`C-${contract.number} · ${contract.title}`],
        `C-${contract.number}`,
      );
      let rows = await repoRows(page);
      expect(
        mine.every((t) => has(rows, t)) && rows.length - 1 === mine.length,
        `record rows ${rows.length - 1}`,
      );
      const menu = await menuNames(page);
      expect(menu.includes("Folder"), `menu ${menu}`);
      await applyChoice(page, "Folder", [fname]);
      rows = await repoRows(page);
      expect(rows.length - 1 === 1 && has(rows, filedDocx.title), `folder rows ${rows}`);
      await page
        .getByRole("button", { name: /^Folder:/ })
        .first()
        .click();
      const editor = page.getByRole("dialog", { name: "Folder" });
      const editorText = tidy(await editor.innerText());
      await editor.getByText("Record root", { exact: true }).click();
      await editor.getByRole("button", { name: "Apply" }).click();
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(700);
      rows = await repoRows(page);
      expect(!has(rows, filedDocx.title) && has(rows, rootPdf.title), `root rows ${rows}`);
      await clearAll(page);
      await applyChoice(page, "Owner", ["Knowledge"]);
      const kMenu = await menuNames(page);
      await clearAll(page);
      await applyChoice(page, "Owner", ["Auto-Docs"]);
      const aMenu = await menuNames(page);
      await clearAll(page);
      expect(
        !kMenu.includes("Folder") && !aMenu.includes("Folder"),
        `knowledge menu ${kMenu} auto-doc menu ${aMenu}`,
      );
      return `Record with Search choices "C-${contract.number}" narrowed the list to the Contract's ${mine.length} live Documents, and the Filter menu then offered ${menu.join(", ")}. Folder "${fname}" showed only "${filedDocx.title}"; the Folder chip's editor ("${editorText}") switched to Record root showed the Documents outside folders. With Owner Knowledge the menu offered ${kMenu.join(", ")}; with Owner Auto-Docs ${aMenu.join(", ")}: no Folder.`;
    },
  );

  await step(
    A,
    role,
    "Search and narrow steps 4-5: Format and Kind take several values; different filters must all match; Kind describes the current Version; Counterparty, Uploader; Uploaded From/To includes both dates; remove one filter; Clear all; Recent hidden while filtered",
    "Any-of within a filter, all-of across filters, current-Version kind, inclusive dates, and Recent only without filters",
    async () => {
      const today = new Date().toISOString().slice(0, 10);
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      await applyChoice(
        page,
        "Record",
        [`C-${contract.number} · ${contract.title}`],
        `C-${contract.number}`,
      );
      const fmtHint = await applyChoice(page, "Format", ["PDF", "Word"]);
      let rows = await repoRows(page);
      expect(
        has(rows, rootPdf.title) && has(rows, filedDocx.title) && !has(rows, archivable.title),
        `format rows ${rows}`,
      );
      const recentWhileFiltered = await page
        .getByRole("region", { name: "Recent documents" })
        .count();
      const kindPop = await openFilter(page, "Kind");
      const kindChoices = (await kindPop.locator("label").allInnerTexts()).map((t) => t.trim());
      await page.keyboard.press("Escape");
      await applyChoice(page, "Kind", ["Draft · ours"]);
      rows = await repoRows(page);
      const currentKindOnly = !has(rows, rootPdf.title);
      await applyChoice(page, "Kind", ["Draft · theirs"]);
      rows = await repoRows(page);
      const anyOf = has(rows, rootPdf.title) && !has(rows, filedDocx.title);
      await removeChip(page, "Kind").click();
      await sleep(700);
      await applyChoice(page, "Kind", ["Executed"]);
      rows = await repoRows(page);
      const rowText = rows.find((r) => r.includes(filedDocx.title)) ?? "";
      expect(
        currentKindOnly && anyOf && rows.length - 1 === 1 && has(rows, filedDocx.title),
        `kind rows ${rows} currentKindOnly ${currentKindOnly} anyOf ${anyOf}`,
      );
      await applyChoice(page, "Counterparty", [cpName], cpName);
      await applyChoice(page, "Uploader", [me.displayName], me.displayName);
      rows = await repoRows(page);
      expect(rows.length - 1 === 1 && has(rows, filedDocx.title), `cp/uploader rows ${rows}`);
      let pop = await openFilter(page, "Uploaded");
      const dateHint = tidy(await pop.innerText());
      await pop.getByRole("textbox", { name: "From", exact: true }).fill(today);
      await pop.getByRole("textbox", { name: "To", exact: true }).fill(today);
      await pop.getByRole("button", { name: "Apply" }).click();
      await sleep(900);
      rows = await repoRows(page);
      expect(has(rows, filedDocx.title), `same-day rows ${rows}`);
      await page
        .getByRole("button", { name: /^Uploaded:/ })
        .first()
        .click();
      pop = page.getByRole("dialog", { name: "Uploaded" });
      await pop.getByRole("textbox", { name: "To", exact: true }).fill("");
      await pop.getByRole("textbox", { name: "From", exact: true }).fill(tomorrow);
      await pop.getByRole("button", { name: "Apply" }).click();
      await sleep(900);
      await page.getByText("No documents match these filters.").waitFor({ timeout: 15000 });
      await removeChip(page, "Kind").click();
      await sleep(700);
      const stillEmpty = await page.getByText("No documents match these filters.").isVisible();
      await removeChip(page, "Uploaded").click();
      await sleep(900);
      rows = await repoRows(page);
      const widened = has(rows, rootPdf.title) && has(rows, filedDocx.title);
      await clearAll(page);
      const recentAfter = await page.getByRole("region", { name: "Recent documents" }).count();
      expect(
        /Matches any selected value/.test(fmtHint) &&
          /Includes both dates/.test(dateHint) &&
          recentWhileFiltered === 0 &&
          recentAfter === 1 &&
          stillEmpty &&
          widened,
        `hint ${fmtHint.slice(0, 60)} date ${dateHint.slice(0, 60)} recent ${recentWhileFiltered}/${recentAfter} widened ${widened}`,
      );
      return `On C-${contract.number}, Format PDF + Word ("${fmtHint.slice(0, 80)}") kept the PDF and the Word Document and left out the text file. Kind offered ${kindChoices.join(", ")}. Kind Draft · ours left out "${rootPdf.title}", whose v1 is Draft · ours but whose current v2 is Draft · theirs; adding Draft · theirs brought it back (any of the selected values). Kind Executed left only "${filedDocx.title}" (row "${rowText.slice(0, 140)}"); Counterparty ${cpName} and Uploader ${me.displayName} kept it. Uploaded From ${today} To ${today} ("${dateHint.slice(0, 60)}") kept it; From ${tomorrow} showed "No documents match these filters.". Removing the Kind filter left the list empty; removing Uploaded widened it again. Recent was hidden while filters were active and returned after Clear all.`;
    },
  );

  await step(
    A,
    role,
    "Open the matching paper: selecting the name opens the owning record with the current Version; expand the chain for an earlier round",
    "The record opens with the reader on v2 and the chain lists v1",
    async () => {
      await applyChoice(
        page,
        "Record",
        [`C-${contract.number} · ${contract.title}`],
        `C-${contract.number}`,
      );
      const rowText = (await repoRows(page)).find((r) => r.includes(rootPdf.title)) ?? "";
      await repoTable(page).getByRole("link", { name: rootPdf.title, exact: true }).click();
      await page.waitForURL(new RegExp(`/contracts/${contract.number}/documents`), {
        timeout: 30000,
      });
      const panel = page.getByRole("complementary", { name: `${rootPdf.title}, version 2` });
      await panel.waitFor({ timeout: 30000 });
      await page
        .getByRole("button", { name: `Show the 1 earlier version of ${rootPdf.title}` })
        .click();
      await page.getByRole("button", { name: rootPdf.title, exact: true }).last().click();
      await page
        .getByRole("complementary", { name: `${rootPdf.title}, version 1` })
        .waitFor({ timeout: 30000 });
      await page.goto(`${BASE}/documents`);
      return `The repository row read "${rowText.slice(0, 160)}" (owning reference C-${contract.number}). Selecting "${rootPdf.title}" opened C-${contract.number}'s Documents tab with the reader on "${rootPdf.title}, version 2". Expanding the chain and selecting the earlier round opened version 1.`;
    },
  );

  await step(
    A,
    role,
    "Search and narrow closing text: global search reads only the latest Version; an earlier Version is read from the owning record's Documents tab",
    "Header Search finds the Document by a word in its latest Version and not by a word only in the earlier Version; the chain on the record still opens the earlier Version",
    async () => {
      const oldWord = `zulu${label.toLowerCase()}${stamp}`;
      const newWord = `yankee${label.toLowerCase()}${stamp}`;
      const v1File = textPdf(
        path.join(fs.mkdtempSync(path.join(WORK, "s-")), `repo-search-${tag}.pdf`),
        `Fictional supplier note, first round. Marker ${oldWord}.`,
      );
      const v2File = textPdf(
        path.join(fs.mkdtempSync(path.join(WORK, "s-")), `repo-search-${tag}-v2.pdf`),
        `Fictional supplier note, second round. Marker ${newWord}.`,
      );
      const doc = await uploadApi(page, `${recUrl}/documents`, v1File);
      const textDone = async (vid) => {
        const b = (await api(page, "GET", `/documents/${doc.id}/versions/${vid}/text`)).body;
        const st = b?.text?.state ?? b?.state;
        return st && !["pending", "processing", "queued"].includes(st) ? st : null;
      };
      const v1State = await until(
        () => textDone(doc.versions[0].id),
        "v1 text not processed",
        600000,
      );
      expect(v1State === "ready", `v1 text state ${v1State}`);
      const nv = await api(page, "POST", `/documents/${doc.id}/versions`, undefined, {
        file: part(v2File),
      });
      expect(nv.status === 201, `fixture version ${nv.status}`);
      const v2id = (await getDoc(page, recUrl, doc.id)).versions.find(
        (v) => v.versionNumber === 2,
      ).id;
      const v2State = await until(() => textDone(v2id), "v2 text not processed", 600000);
      expect(v2State === "ready", `v2 text state ${v2State}`);
      const search = async (word) => {
        await page.goto(`${BASE}/documents`);
        const box = page.getByRole("banner").getByRole("combobox", { name: "Search", exact: true });
        await box.click();
        await box.fill(word);
        await page.getByText("See all results").first().click();
        await page.waitForURL(/\/search/, { timeout: 15000 });
        await page.waitForLoadState("networkidle").catch(() => {});
        await sleep(1000);
        return tidy(await page.getByRole("main").innerText());
      };
      const newText = await until(
        async () => {
          const t = await search(newWord);
          return t.includes(doc.title) ? t : null;
        },
        "the latest Version's word did not find the Document",
        90000,
      );
      const oldText = await search(oldWord);
      expect(
        !oldText.includes(doc.title),
        `earlier Version word found the Document: ${oldText.slice(0, 200)}`,
      );
      await openDocuments(page, `${recUrl}/documents`);
      await page
        .getByRole("button", { name: `Show the 1 earlier version of ${doc.title}` })
        .click();
      await page.getByRole("button", { name: doc.title, exact: true }).last().click();
      await page
        .getByRole("complementary", { name: `${doc.title}, version 1` })
        .waitFor({ timeout: 30000 });
      await page.goto(`${BASE}/documents`);
      return `A PDF Document "${doc.title}" had "${oldWord}" only in v1 and "${newWord}" only in v2 (text states ${v1State}/${v2State}). Header Search, "${newWord}", See all results listed it ("${newText.slice(0, 160)}"). The same search for "${oldWord}" did not list it ("${oldText.slice(0, 120)}"). On C-${contract.number}'s Documents tab, "Show the 1 earlier version of ${doc.title}" expanded the chain and selecting the earlier round opened "${doc.title}, version 1".`;
    },
  );

  await step(
    A,
    role,
    "Missing or archived: a hidden record's Document does not appear through a filter, the list, or a direct link",
    role === "administrator"
      ? "An Administrator reaches every Contract, so the Confidential Contract's paper is listed"
      : "The Confidential Contract outside this reader's team is absent from Record and Counterparty choices and the list, and its address is refused",
    async () => {
      let pop = await openFilter(page, "Record");
      await pop.getByLabel("Search choices").fill(`C-${hidden.contract.number}`);
      await sleep(800);
      const recordChoices = tidy(await pop.innerText());
      await page.keyboard.press("Escape");
      pop = await openFilter(page, "Counterparty");
      await pop.getByLabel("Search choices").fill(hidden.cpName);
      await sleep(800);
      const cpChoices = tidy(await pop.innerText());
      await page.keyboard.press("Escape");
      const listed = (await api(page, "GET", `/documents?limit=100`)).body.documents.some(
        (d) => d.id === hidden.doc.id,
      );
      const direct = await api(page, "GET", `/contracts/${hidden.contract.number}/documents`);
      await page.goto(`${BASE}/contracts/${hidden.contract.number}/documents`);
      await page.waitForLoadState("networkidle").catch(() => {});
      const pageText = tidy(
        await page
          .getByRole("main")
          .innerText()
          .catch(() => ""),
      ).slice(0, 120);
      await page.goto(`${BASE}/documents`);
      if (role === "administrator") {
        expect(
          recordChoices.includes(hidden.title) && listed && direct.status === 200,
          `admin ${recordChoices.slice(0, 80)} listed ${listed} direct ${direct.status}`,
        );
        return `As Administrator, Record choices for C-${hidden.contract.number} offered "${hidden.title}", the repository read listed its Document, and the record's Documents read answered ${direct.status}. The guide does not claim an Administrator is refused.`;
      }
      expect(
        !recordChoices.includes(hidden.title) &&
          !cpChoices.includes(hidden.cpName) &&
          !listed &&
          direct.status === 404,
        `legal record ${recordChoices.slice(0, 80)} cp ${cpChoices.slice(0, 80)} listed ${listed} direct ${direct.status}`,
      );
      return `As Legal Team Member outside its team, Record choices for C-${hidden.contract.number} read "${recordChoices.slice(0, 80)}", Counterparty choices for "${hidden.cpName}" read "${cpChoices.slice(0, 80)}", the repository read did not include its Document, the direct Documents read answered 404, and the address showed "${pageText}".`;
    },
  );

  await step(
    A,
    role,
    "Missing or archived: Filter, Show archived includes archived Documents; the offered Restore brings one back",
    "The archived row appears marked Archived with Restore; Restore makes it live",
    async () => {
      const arch = await api(page, "POST", `/documents/${archivable.id}/archive`, {});
      expect(arch.status === 200, `fixture archive ${arch.status}`);
      await page.goto(`${BASE}/documents`);
      await applyChoice(
        page,
        "Record",
        [`C-${contract.number} · ${contract.title}`],
        `C-${contract.number}`,
      );
      let rows = await repoRows(page);
      const hiddenBefore = !has(rows, archivable.title);
      const pop = await openFilter(page);
      await pop.getByRole("button", { name: "Show archived", exact: true }).click();
      await sleep(900);
      rows = await repoRows(page);
      const row = rows.find((r) => r.includes(archivable.title)) ?? "";
      await page.getByRole("button", { name: `Restore ${archivable.title}` }).click();
      const live = await until(async () => {
        const d = await getDoc(page, recUrl, archivable.id);
        return d && !d.archivedAt ? d : null;
      }, "restore did not make it live");
      await clearAll(page);
      expect(
        hiddenBefore && /Archived/.test(row) && !live.archivedAt,
        `before ${hiddenBefore} row ${row}`,
      );
      return `After archiving "${archivable.title}" it was absent from the Record-filtered list. Filter, Show archived added its row "${row.slice(0, 140)}" with a Restore action; Restore made it live again (read-back).`;
    },
  );

  await step(
    A,
    role,
    "Missing or archived: an empty result after filters; Clear all widens again",
    "The empty answer is shown and Clear all returns the whole list",
    async () => {
      await applyChoice(
        page,
        "Record",
        [`C-${contract.number} · ${contract.title}`],
        `C-${contract.number}`,
      );
      await applyChoice(page, "Format", ["Email"]);
      let rows = await repoRows(page);
      const emptyText = (tidy(await page.getByRole("main").innerText()).match(
        /No documents match these filters\.( Clear filters to return to the whole list\.)?/,
      ) ?? [""])[0];
      await clearAll(page);
      rows = await repoRows(page);
      const recent = await page.getByRole("region", { name: "Recent documents" }).count();
      expect(
        emptyText && rows.length > 1 && recent === 1,
        `empty ${emptyText} rows ${rows.length} recent ${recent}`,
      );
      return `Record C-${contract.number} with Format Email gave "${emptyText}". Clear all brought back the whole list (${rows.length - 1} rows on the first page) and Recent documents.`;
    },
  );

  await step(
    A,
    role,
    "Before you start: drag a live Contract Document row onto a Move to folder target inside its owning record",
    "The Move to folder panel names the record's folders and the drop files the Document",
    async () => {
      await applyChoice(
        page,
        "Record",
        [`C-${contract.number} · ${contract.title}`],
        `C-${contract.number}`,
      );
      const row = repoTable(page).getByRole("row").filter({ hasText: draggable.title });
      const aside = page.getByRole("complementary", { name: "Move to folder" });
      const target = aside.getByText(fname, { exact: true });
      await dragMouse(page, row, target, { revealTarget: target });
      await until(
        async () => folderOf(await getDoc(page, recUrl, draggable.id)) === folderId,
        "repository drag did not file the Document",
        8000,
      );
      await clearAll(page);
      return `Dragging the "${draggable.title}" row revealed the Move to folder panel with "${fname}" as a target; dropping on "${fname}" filed the Document there (read-back).`;
    },
  );

  await context.close();
}

// =====================================================================
// create-knowledge (V-C33)
// =====================================================================
const itemsRegion = (page) => page.getByRole("region", { name: "Knowledge items" });
const folderTree = (page) => page.getByRole("complementary", { name: "Knowledge folders" });
const folderButton = (page, name) =>
  folderTree(page).getByRole("button", { name: new RegExp(`^${escapeRe(name)}\\s*\\d*$`) });
async function readItem(page, id) {
  const r = await api(page, "GET", `/knowledge/${id}`);
  expect(r.status === 200, `item read answered ${r.status}`);
  return r.body.knowledgeItem;
}
async function readKDocs(page, id, includeArchived = false) {
  const r = await api(
    page,
    "GET",
    `/knowledge/${id}/documents${includeArchived ? "?includeArchived=true" : ""}`,
  );
  expect(r.status === 200, `documents read answered ${r.status}`);
  return r.body.documents;
}
async function readKFolders(page) {
  return (await api(page, "GET", "/knowledge/folders")).body.folders;
}
async function openKnowledge(page) {
  await page.goto(`${BASE}/`);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Knowledge", exact: true })
    .first()
    .click();
  await page.waitForURL(/\/knowledge$/);
  await itemsRegion(page).waitFor();
}
async function selectFolder(page, name) {
  await folderButton(page, name).click();
  await until(
    async () => (await folderButton(page, name).getAttribute("aria-current")) === "page",
    `folder ${name} did not become selected`,
  );
  await sleep(600);
}
async function selectAll(page) {
  await folderTree(page).getByRole("button", { name: "All Knowledge" }).click();
  await sleep(600);
}
async function listTitles(page) {
  await sleep(600);
  const region = itemsRegion(page);
  if (await region.getByText("No Knowledge items match these filters").count()) return [];
  return region
    .locator("tbody tr")
    .evaluateAll((rows) =>
      rows.map((row) => (row.querySelector("td")?.innerText ?? "").split("\n")[0].trim()),
    );
}
async function addKFolder(page, name) {
  await folderTree(page).getByRole("button", { name: "Add folder" }).click();
  const dialog = page.getByRole("dialog", { name: "Add folder" });
  await dialog.getByLabel("Folder name").fill(name);
  await dialog.getByRole("button", { name: "Add folder" }).click();
  await dialog.waitFor({ state: "hidden" });
  const folder = await until(
    async () => (await readKFolders(page)).find((row) => row.name === name),
    `folder ${name} not saved`,
  );
  await folderButton(page, name).waitFor();
  return folder;
}
async function openRecord(page, id) {
  await page.goto(`${BASE}/knowledge/${id}`);
  await page.locator("#knowledge-record-type").waitFor({ timeout: 20000 });
  await page.getByRole("region", { name: "Guidance", exact: true }).waitFor();
}
async function markers(page) {
  const text = await page.locator("section[aria-labelledby='page-title']").innerText();
  return { draft: /\bDraft\b/.test(text), archived: /\bArchived\b/.test(text) };
}
async function waitMarkers(page, wanted, message) {
  return until(async () => {
    const m = await markers(page);
    return Object.entries(wanted).every(([k, v]) => m[k] === v) ? m : null;
  }, message);
}
const rowOfAction = (page, title) =>
  page
    .getByRole("button", { name: `Actions for ${title}`, exact: true })
    .locator("xpath=ancestor::*[self::tr or self::li][1]");

let archivedKType = null;
async function knowledgeFixtureType() {
  if (archivedKType) return archivedKType;
  const page = await admin();
  const name = `DOC-030 documents-2 retired Knowledge type ${stamp}`;
  const made = await api(page, "POST", "/knowledge/types", { displayName: name });
  expect(made.status < 300, `type fixture ${made.status}`);
  const id = made.body.knowledgeType.id;
  const arch = await api(page, "POST", `/knowledge/types/${id}/archive`, {});
  expect(arch.status < 300, `type archive ${arch.status}`);
  archivedKType = { id, name };
  results.settingsChanged.push({
    setting: "Knowledge type list",
    added: name,
    id,
    state: "archived fixture",
    restore: "delete at teardown",
  });
  return archivedKType;
}
async function knowledgeTeardown() {
  if (!archivedKType) return;
  const r = await api(await admin(), "DELETE", `/knowledge/types/${archivedKType.id}`);
  const s = results.settingsChanged.find((x) => x.id === archivedKType.id);
  if (s) s.restored = `delete answered ${r.status}`;
  save();
}

const knowledgeItems = {};
async function knowledge(role, person) {
  const A = "create-knowledge";
  const label = role === "administrator" ? "Admin" : "Legal";
  const base = `DOC-030 documents-2 ${label} ${stamp}`;
  const archivedType = await knowledgeFixtureType();
  const { context, page } = await staffContext(person);
  currentPage = page;
  const ctx = {};

  await step(
    A,
    role,
    "Before you start: open Knowledge from the navigation",
    "Knowledge opens with New, All Knowledge and the Knowledge items list",
    async () => {
      await openKnowledge(page);
      await page.getByRole("button", { name: "New", exact: true }).waitFor();
      await folderTree(page).getByRole("button", { name: "All Knowledge" }).waitFor();
      return `The navigation link Knowledge opened /knowledge with New, the All Knowledge folder entry and the Knowledge items region as ${person.name}.`;
    },
  );

  await step(
    A,
    role,
    "Organize the library step 2: Add folder, Folder name, Add folder at top level; then a child under the selected folder",
    "With All Knowledge selected the folder is top-level; with a folder selected the new folder is its child",
    async () => {
      await selectAll(page);
      ctx.parent = await addKFolder(page, `${base} parent`);
      expect(ctx.parent.parentId === null, "top-level folder has a parent");
      await selectFolder(page, `${base} parent`);
      ctx.child = await addKFolder(page, `${base} child`);
      expect(ctx.child.parentId === ctx.parent.id, "child folder not under the selected folder");
      record(
        role,
        "knowledge_folders",
        `${base} parent, ${base} child`,
        `${ctx.parent.id}, ${ctx.child.id}`,
      );
      return `Add folder with All Knowledge selected saved "${base} parent" with no parent. With that folder selected, Add folder saved "${base} child" under it (read-back).`;
    },
  );

  await step(
    A,
    role,
    "Start with files steps 1-2: New, New from files; Folder starts at the selected folder, or at Library",
    "Folder reads Library with All Knowledge selected and the selected folder otherwise",
    async () => {
      await selectAll(page);
      await page.getByRole("button", { name: "New", exact: true }).click();
      await page.getByRole("menuitem", { name: "New from files" }).click();
      let dialog = page.getByRole("dialog", { name: "New from files" });
      const rootLabel = await selectedText(dialog.getByLabel("Folder", { exact: true }));
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      await selectFolder(page, `${base} parent`);
      await page.getByRole("button", { name: "New", exact: true }).click();
      await page.getByRole("menuitem", { name: "New from files" }).click();
      dialog = page.getByRole("dialog", { name: "New from files" });
      const selLabel = await selectedText(dialog.getByLabel("Folder", { exact: true }));
      expect(
        rootLabel === "Library" && selLabel.includes(`${base} parent`),
        `root ${rootLabel} selected ${selLabel}`,
      );
      return `With All Knowledge selected, New from files showed Folder "Library". With "${base} parent" selected it started at "${selLabel}".`;
    },
  );

  await step(
    A,
    role,
    "Start with files steps 2-3: Drop files here or choose files, two files, a Type, Create drafts",
    "Each file creates a separate draft item named after the file with its own primary Document; the first item opens and the other is in Knowledge",
    async () => {
      const dialog = page.getByRole("dialog", { name: "New from files" });
      const fileA = copyAs(kfix("doc029-policy-a.pdf"), `${base} policy A.pdf`);
      const fileB = copyAs(kfix("doc029-policy-b.pdf"), `${base} policy B.pdf`);
      await chooseFiles(page, dialog.getByText("Drop files here or choose files"), [fileA, fileB]);
      await dialog.getByText("2 files selected").waitFor();
      await dialog.getByLabel(/^Type\*?$/).selectOption({ label: "Precedent" });
      await dialog.getByRole("button", { name: "Create drafts" }).click();
      await page.waitForURL(/\/knowledge\/[0-9a-f-]{36}$/, { timeout: 30000 });
      const firstId = page.url().split("/").pop();
      const heading = await until(async () => {
        const t = tidy(
          await page
            .locator("#page-title")
            .innerText()
            .catch(() => ""),
        );
        return t.startsWith(base) ? t : null;
      }, "record heading did not render");
      const m = await markers(page);
      const first = await readItem(page, firstId);
      expect(
        m.draft &&
          heading === first.title &&
          [`${base} policy A.pdf`, `${base} policy B.pdf`].includes(first.title),
        `draft ${m.draft} heading ${heading} title ${first.title}`,
      );
      expect(
        first.state === "draft" &&
          first.audience === "legal_only" &&
          first.folderId === ctx.parent.id &&
          first.knowledgeTypeName === "Precedent" &&
          first.primaryDocument &&
          first.documentCount === 1,
        `first ${JSON.stringify(first).slice(0, 200)}`,
      );
      const primaryControl = await page
        .getByRole("button", { name: `Open preview of ${first.primaryDocument.title}` })
        .count();
      expect(primaryControl === 1, "Primary document control does not name the file");
      await page
        .locator("section[aria-labelledby='page-title']")
        .getByRole("link", { name: "Knowledge" })
        .click();
      await page.waitForURL(/\/knowledge$/);
      await selectFolder(page, `${base} parent`);
      const titles = await listTitles(page);
      const other = first.title.endsWith("A.pdf") ? `${base} policy B.pdf` : `${base} policy A.pdf`;
      expect(titles.includes(other) && titles.includes(first.title), `list titles ${q(titles)}`);
      const { body } = await api(page, "GET", `/knowledge?folder=${ctx.parent.id}`);
      const otherRow = body.knowledgeItems.find((row) => row.title === other);
      expect(
        otherRow &&
          otherRow.state === "draft" &&
          otherRow.primaryDocument &&
          otherRow.documentCount === 1,
        "second item not a separate draft with its own primary",
      );
      ctx.itemA = first.title.endsWith("A.pdf") ? first : otherRow;
      ctx.itemB = first.title.endsWith("A.pdf") ? otherRow : first;
      record(role, "knowledge_items", `${first.title}; ${other}`, `${first.id}; ${otherRow.id}`);
      return `Create drafts opened ${q(first.title)} with the Draft marker, Audience Legal Only, Type Precedent, the parent folder and its file under Primary document. The Knowledge breadcrumb returned to the list, and the parent folder listed both items. Each was a draft with one Document of its own as primary (read-back).`;
    },
  );

  await step(
    A,
    role,
    "Start with files step 4: Title saves on Enter and on leaving the field; Type and Folder save on change",
    "Each value is saved and survives a reload",
    async () => {
      await openRecord(page, ctx.itemA.id);
      const title = page.locator("#knowledge-record-title");
      await title.fill(`${base} policy A renamed`);
      await title.press("Enter");
      await until(
        async () => (await readItem(page, ctx.itemA.id)).title === `${base} policy A renamed`,
        "Enter did not save the title",
      );
      await title.fill(`${base} policy A reviewed`);
      await page.locator("#knowledge-record-type").focus();
      await until(
        async () => (await readItem(page, ctx.itemA.id)).title === `${base} policy A reviewed`,
        "leaving the field did not save the title",
      );
      await page.locator("#knowledge-record-type").selectOption({ label: "Playbook" });
      await until(
        async () => (await readItem(page, ctx.itemA.id)).knowledgeTypeName === "Playbook",
        "type did not save",
      );
      await page.locator("#knowledge-record-folder").selectOption(ctx.child.id);
      await until(
        async () => (await readItem(page, ctx.itemA.id)).folderId === ctx.child.id,
        "folder did not save",
      );
      await page.reload();
      await page.locator("#knowledge-record-type").waitFor({ timeout: 20000 });
      const after = {
        title: await page.locator("#knowledge-record-title").inputValue(),
        type: await selectedText(page.locator("#knowledge-record-type")),
        folder: await page.locator("#knowledge-record-folder").inputValue(),
      };
      expect(
        after.title === `${base} policy A reviewed` &&
          after.type === "Playbook" &&
          after.folder === ctx.child.id,
        `after ${q(after)}`,
      );
      ctx.itemA.title = after.title;
      return `Enter saved "${base} policy A renamed". Moving focus to Type saved "${after.title}". Type Playbook and Folder "${base} child" saved on change. After a reload Title, Type and Folder showed the saved values.`;
    },
  );

  await step(
    A,
    role,
    "Start with guidance steps 1-2: New, New Knowledge Item, Title, Type, Folder, Attach documents with no type choice for the files; Create item; a failed upload offers Retry failed uploads",
    "No Document type control; the item exists after the failed upload; Retry failed uploads uploads the file; the item is Draft and Legal Only; the file shows the item's Knowledge type",
    async () => {
      await page.goto(`${BASE}/knowledge`);
      await itemsRegion(page).waitFor();
      await page.getByRole("button", { name: "New", exact: true }).click();
      await page.getByRole("menuitem", { name: "New Knowledge Item" }).click();
      const dialog = page.getByRole("dialog", { name: "New Knowledge Item" });
      await dialog.getByLabel(/^Title\*?$/).fill(`${base} guidance`);
      await dialog.getByLabel(/^Type\*?$/).selectOption({ label: "Article" });
      await dialog.getByLabel("Folder", { exact: true }).selectOption(ctx.parent.id);
      const docx = copyAs(kfix("doc029-playbook.docx"), `${base} playbook.docx`);
      await chooseFiles(
        page,
        dialog
          .getByRole("button", { name: "Attach documents", exact: true })
          .and(dialog.locator("button")),
        [docx],
      );
      await dialog.getByText(`${base} playbook.docx`).first().waitFor();
      const typeControls = await dialog.getByLabel("Document type").count();
      const kindControls = await dialog.getByLabel("Document kind").count();
      const dialogText = tidy(await dialog.innerText());
      let failed = 0;
      await page.route("**/api/v1/knowledge/*/documents", async (route) => {
        if (route.request().method() === "POST" && failed === 0) {
          failed++;
          await route.abort("failed");
        } else await route.continue();
      });
      await dialog.getByRole("button", { name: "Create item" }).click();
      await dialog
        .getByText("Record created. Some documents could not be uploaded.")
        .waitFor({ timeout: 20000 });
      const retry = dialog.getByRole("button", { name: "Retry failed uploads" });
      await retry.waitFor();
      await dialog.getByRole("button", { name: "Continue" }).waitFor();
      const { body } = await api(page, "GET", `/knowledge?folder=${ctx.parent.id}`);
      const existing = body.knowledgeItems.find((row) => row.title === `${base} guidance`);
      expect(existing && existing.documentCount === 0, "item missing after the failed upload");
      await page.unroute("**/api/v1/knowledge/*/documents");
      await retry.click();
      await page.waitForURL(new RegExp(`/knowledge/${existing.id}$`), { timeout: 30000 });
      await page.locator("#knowledge-record-type").waitFor({ timeout: 20000 });
      const item = await readItem(page, existing.id);
      const m = await markers(page);
      const audience = await selectedText(page.locator("#knowledge-record-audience"));
      const docs = await readKDocs(page, existing.id);
      const rowType = page.getByLabel(`Type of version 1 of ${docs[0].title}`, { exact: true });
      const rowTypeText = await selectedText(rowType);
      const rowTypeOptions = await optionTexts(rowType);
      expect(typeControls === 0 && kindControls === 0, `type ${typeControls} kind ${kindControls}`);
      expect(
        item.state === "draft" &&
          item.audience === "legal_only" &&
          m.draft &&
          audience === "Legal Only" &&
          item.primaryDocument?.title &&
          item.documentCount === 1,
        `item ${JSON.stringify(item).slice(0, 200)}`,
      );
      expect(
        rowTypeText === "Article" && typeOf(docs[0].versions[0]) === "Article",
        `document row type ${rowTypeText} read-back ${typeOf(docs[0].versions[0])}`,
      );
      ctx.guidance = item;
      ctx.docxTitle = item.primaryDocument.title;
      record(role, "knowledge_item", `${base} guidance`, existing.id);
      return `New Knowledge Item took Title, Type Article, Folder and one file through Attach documents. The dialog offered no Document type or Document kind control (counts ${typeControls}/${kindControls}); it read "${dialogText.slice(0, 200)}". The browser dropped the first upload request: the dialog read "Record created. Some documents could not be uploaded." with Retry failed uploads and Continue, and the item already existed with no Document. Retry failed uploads uploaded the file and opened the item: Draft marker, Audience Legal Only, "${ctx.docxTitle}" under Primary document. Its Document row's "Type of version 1" control showed "${rowTypeText}" (options ${rowTypeOptions.join(", ")}), the item's Knowledge type; read-back type ${typeOf(docs[0].versions[0])}.`;
    },
  );

  await step(
    A,
    role,
    "Start with guidance step 2: Continue after a failed upload keeps the item",
    "Continue opens the created item without the failed file",
    async () => {
      await page.goto(`${BASE}/knowledge`);
      await itemsRegion(page).waitFor();
      await page.getByRole("button", { name: "New", exact: true }).click();
      await page.getByRole("menuitem", { name: "New Knowledge Item" }).click();
      const dialog = page.getByRole("dialog", { name: "New Knowledge Item" });
      await dialog.getByLabel(/^Title\*?$/).fill(`${base} continue`);
      const pdf = copyAs(kfix("doc029-checklist.pdf"), `${base} continue checklist.pdf`);
      await chooseFiles(
        page,
        dialog
          .getByRole("button", { name: "Attach documents", exact: true })
          .and(dialog.locator("button")),
        [pdf],
      );
      await page.route("**/api/v1/knowledge/*/documents", (route) =>
        route.request().method() === "POST" ? route.abort("failed") : route.continue(),
      );
      await dialog.getByRole("button", { name: "Create item" }).click();
      await dialog.getByRole("button", { name: "Continue" }).waitFor({ timeout: 20000 });
      await dialog.getByRole("button", { name: "Continue" }).click();
      await page.waitForURL(/\/knowledge\/[0-9a-f-]{36}$/, { timeout: 20000 });
      await page.unroute("**/api/v1/knowledge/*/documents");
      const id = page.url().split("/").pop();
      const item = await readItem(page, id);
      expect(
        item.title === `${base} continue` && item.documentCount === 0 && !item.primaryDocument,
        "continue item wrong",
      );
      record(role, "knowledge_item", item.title, id);
      return `With the upload request dropped, Continue closed the dialog and opened "${item.title}": a Draft item with no Document (read-back).`;
    },
  );

  await step(
    A,
    role,
    "Start with guidance steps 3-4: Add guidance, Markdown, Preview saves on blur and renders, Edit returns to the source; raw HTML is not rendered",
    "Headings, lists, emphasis, code and links render; raw HTML does not become HTML; the source survives a reload",
    async () => {
      await openRecord(page, ctx.guidance.id);
      const guidance = page.getByRole("region", { name: "Guidance", exact: true });
      await guidance.getByRole("button", { name: "Add guidance" }).click();
      const editor = page.locator("#knowledge-body");
      await editor.waitFor();
      const helpText = tidy(await guidance.innerText());
      const source = [
        `## ${base} supplier checks`,
        "",
        "Use this **fictional** list before *onboarding* a supplier.",
        "",
        "- Check the `vendor-id` field",
        "- Read the [supplier policy](https://example.com/doc030-policy)",
        "",
        "<b>raw-html-doc030</b>",
      ].join("\n");
      await editor.fill(source);
      await guidance.getByRole("button", { name: "Preview" }).click();
      await until(
        async () => (await readItem(page, ctx.guidance.id)).body === source,
        "Preview blur did not save the guidance",
      );
      await guidance.getByRole("heading", { name: `${base} supplier checks` }).waitFor();
      const rendered = await guidance.evaluate((el) => ({
        strong: [...el.querySelectorAll("strong")].map((n) => n.textContent),
        em: [...el.querySelectorAll("em")].map((n) => n.textContent),
        li: el.querySelectorAll("li").length,
        code: [...el.querySelectorAll("code")].map((n) => n.textContent),
        links: [...el.querySelectorAll("a")].map((n) => n.getAttribute("href")),
        rawB: [...el.querySelectorAll("b")].some((n) => n.textContent === "raw-html-doc030"),
      }));
      expect(
        rendered.strong.includes("fictional") &&
          rendered.em.includes("onboarding") &&
          rendered.li === 2 &&
          rendered.code.includes("vendor-id") &&
          rendered.links.includes("https://example.com/doc030-policy") &&
          !rendered.rawB,
        `rendered ${q(rendered)}`,
      );
      expect(!/markdown/i.test(helpText), "the editor names Markdown rules");
      await guidance.getByRole("button", { name: "Edit" }).click();
      expect((await editor.inputValue()) === source, "Edit did not return to the source");
      await page.reload();
      await page.locator("#knowledge-body").waitFor({ timeout: 20000 });
      expect(
        (await page.locator("#knowledge-body").inputValue()) === source,
        "source lost after reload",
      );
      return `Add guidance opened the editor; its help read "${helpText.slice(0, 120)}" and named no Markdown rules. Preview saved the source on blur and rendered the heading, bold and italic text, a two-item list, inline code and the link. The raw <b> tag did not become a bold element. Edit showed the source again; the source was still there after a reload.`;
    },
  );

  await step(
    A,
    role,
    "Add Documents step 1: upload a new Document in the item's Documents section",
    "Upload adds a new v1 Document; the first Document stays primary",
    async () => {
      await docsSection(page).getByRole("button", { name: "Upload", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Upload document" });
      const pdf = copyAs(kfix("doc029-checklist.pdf"), `${base} supporting checklist.pdf`);
      await chooseFiles(page, dialog.getByRole("button", { name: /Choose files$/ }), [pdf]);
      const typeInUpload = await dialog.getByLabel("Type", { exact: true }).count();
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      const docs = await until(async () => {
        const rows = await readKDocs(page, ctx.guidance.id);
        return rows.length === 2 ? rows : null;
      }, "second Document not listed");
      const pdfDoc = docs.find((d) => d.title !== ctx.docxTitle);
      const docxDoc = docs.find((d) => d.title === ctx.docxTitle);
      expect(
        docxDoc.isPrimary && !pdfDoc.isPrimary && pdfDoc.versions.length === 1,
        "first Document is no longer primary",
      );
      ctx.pdfTitle = pdfDoc.title;
      ctx.pdfDocId = pdfDoc.id;
      ctx.docxDocId = docxDoc.id;
      return `Upload, Choose files and Upload added "${ctx.pdfTitle}" as a second Document at v1 (Type controls in Upload document: ${typeInUpload}). "${ctx.docxTitle}", the first Document, kept the primary designation.`;
    },
  );

  await step(
    A,
    role,
    "Add Documents step 2: Actions, Set as primary; check the Primary mark and the Primary document control",
    "The chosen Document shows Primary and is named under Primary document",
    async () => {
      await page.getByRole("button", { name: `Actions for ${ctx.docxTitle}` }).click();
      const noSetOnPrimary = await page.getByRole("menuitem", { name: "Set as primary" }).count();
      await page.keyboard.press("Escape");
      await chooseMenu(page, ctx.pdfTitle, "Set as primary");
      await page
        .getByRole("button", { name: `Open preview of ${ctx.pdfTitle}` })
        .waitFor({ timeout: 15000 });
      const docs = await readKDocs(page, ctx.guidance.id);
      const rowText = tidy(await rowOfAction(page, ctx.pdfTitle).innerText());
      expect(
        docs.find((d) => d.id === ctx.pdfDocId).isPrimary &&
          !docs.find((d) => d.id === ctx.docxDocId).isPrimary &&
          /Primary/.test(rowText) &&
          noSetOnPrimary === 0,
        `row ${rowText} noSet ${noSetOnPrimary}`,
      );
      return `The primary row's Actions menu offered no Set as primary. On "${ctx.pdfTitle}", Actions, Set as primary put the Primary mark on that row ("${rowText.slice(0, 120)}"), and the Primary document control changed to that title.`;
    },
  );

  await step(
    A,
    role,
    "Add Documents step 3: Open preview reads the primary's current Version; the other Document keeps its own Version history",
    "The reader opens on the primary's current Version; a new Version on the supporting Document stays on its own chain",
    async () => {
      await page.getByRole("button", { name: `Open preview of ${ctx.pdfTitle}` }).click();
      const closeBtn = page.getByRole("button", { name: "Close the document" });
      await closeBtn.waitFor({ timeout: 20000 });
      const readerLabel = await page.getByLabel(`${ctx.pdfTitle}, version 1`).count();
      expect(readerLabel > 0, "reader is not labelled with the current Version");
      await closeBtn.click();
      await closeBtn.waitFor({ state: "hidden" });
      await chooseMenu(page, ctx.docxTitle, "Add version");
      const dialog = page.getByRole("dialog", { name: "Add version" });
      const v2 = copyAs(kfix("doc029-playbook-v2.docx"), `${base} playbook v2.docx`);
      await chooseFiles(page, dialog.getByRole("button", { name: /Choose file/ }), [v2]);
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      const docs = await until(async () => {
        const rows = await readKDocs(page, ctx.guidance.id);
        return rows.find((d) => d.id === ctx.docxDocId).versions.length === 2 ? rows : null;
      }, "supporting Document did not get Version 2");
      const pdfDoc = docs.find((d) => d.id === ctx.pdfDocId);
      expect(
        pdfDoc.isPrimary && pdfDoc.versions.length === 1,
        "primary changed by supporting version",
      );
      return `Open preview opened the reader labelled "${ctx.pdfTitle}, version 1", the current Version; Close the document shut it. Add version on the supporting DOCX made Version 2 on that Document only; the primary PDF kept one Version and its designation (read-back).`;
    },
  );

  await step(
    A,
    role,
    "Add Documents closing text: archiving the primary Document preserves Versions and designation and picks no replacement; restore returns it",
    "The archived primary leaves the ordinary list, no other row becomes Primary, and restore returns it with its designation",
    async () => {
      await chooseMenu(page, ctx.pdfTitle, "Archive");
      const confirm = page.getByRole("dialog").or(page.getByRole("alertdialog"));
      if (await confirm.count()) await confirm.getByRole("button", { name: "Archive" }).click();
      await until(
        async () =>
          (await page.getByRole("button", { name: `Actions for ${ctx.pdfTitle}` }).count()) === 0,
        "archived Document still in the ordinary list",
      );
      const docxRow = tidy(await rowOfAction(page, ctx.docxTitle).innerText());
      const archived = (await readKDocs(page, ctx.guidance.id, true)).find(
        (d) => d.id === ctx.pdfDocId,
      );
      expect(
        !/\bPrimary\b/.test(docxRow) &&
          archived.archivedAt &&
          archived.isPrimary &&
          archived.versions.length === 1,
        `docxRow ${docxRow} archived ${!!archived.archivedAt} primary ${archived.isPrimary}`,
      );
      await page.getByLabel("Show archived").click();
      await chooseMenu(page, ctx.pdfTitle, "Restore");
      await until(
        async () => (await readKDocs(page, ctx.guidance.id)).some((d) => d.id === ctx.pdfDocId),
        "restore did not return the Document",
      );
      await page.reload();
      await page.locator("#knowledge-record-type").waitFor({ timeout: 20000 });
      await page.getByRole("button", { name: `Open preview of ${ctx.pdfTitle}` }).waitFor();
      const restoredRow = tidy(await rowOfAction(page, ctx.pdfTitle).innerText());
      expect(/Primary/.test(restoredRow), "restored row lost Primary");
      return `Archive took "${ctx.pdfTitle}" out of the ordinary Documents list; the supporting DOCX did not get the Primary mark. With archived rows included it kept its one Version and primary designation. Show archived and Restore returned it with the Primary mark, and the Primary document control named it after a reload.`;
    },
  );

  await step(
    A,
    role,
    "Add Documents closing text: an item's Documents use a flat list",
    "The Documents section has no New folder control, and a folder pick imports its file at the item root with no Document folder",
    async () => {
      await openRecord(page, ctx.guidance.id);
      const newFolder = await page.getByRole("button", { name: "New folder" }).count();
      const dialog = await uploadDialog(page);
      const dir = path.join(fs.mkdtempSync(path.join(WORK, "kpick-")), "outer");
      fs.mkdirSync(path.join(dir, "inner"), { recursive: true });
      fs.copyFileSync(
        kfix("doc029-checklist.pdf"),
        path.join(dir, "inner", `${base} folder pick.pdf`),
      );
      const chooseFolder = dialog.getByRole("button", { name: /Choose folder/ });
      const hasPicker = await chooseFolder.count();
      if (hasPicker) await chooseFiles(page, chooseFolder, dir);
      else await page.locator("#document-directory").setInputFiles(dir);
      const importButton = page
        .getByRole("dialog")
        .getByRole("button", { name: /^Import 1 file$/ });
      await importButton.waitFor({ timeout: 15000 });
      await importButton.click();
      const docs = await until(async () => {
        const rows = await readKDocs(page, ctx.guidance.id);
        return rows.some((d) => d.title === `${base} folder pick.pdf`) ? rows : null;
      }, "folder pick did not import");
      const folders = (await api(page, "GET", `/knowledge/${ctx.guidance.id}/folders`)).status;
      expect(newFolder === 0 && docs.every((d) => !folderOf(d)), `newFolder ${newFolder}`);
      return `The item's Documents section had no New folder button. Upload, Choose folder on a folder holding one file in a subfolder offered Import 1 file, and the import placed "${base} folder pick.pdf" at the item root with no Document folder, beside the other Documents (${docs.length} in the flat list; a folder read on the item answered ${folders}).`;
    },
  );

  await step(
    A,
    role,
    "Organize the library step 1: All Knowledge, a folder with its descendants, and the Type, State, Audience, Author and Format filters",
    "A folder lists its descendants; each filter narrows the list; clearing restores it",
    async () => {
      await page.goto(`${BASE}/knowledge`);
      await itemsRegion(page).waitFor();
      for (const l of ["Type", "State", "Audience", "Author", "Format"])
        await page.getByRole("combobox", { name: l, exact: true }).first().waitFor();
      await selectFolder(page, `${base} parent`);
      let titles = await listTitles(page);
      expect(
        titles.includes(ctx.itemA.title) &&
          titles.includes(ctx.itemB.title) &&
          titles.includes(`${base} guidance`),
        `parent folder list ${q(titles)}`,
      );
      await selectFolder(page, `${base} child`);
      titles = await listTitles(page);
      expect(
        titles.includes(ctx.itemA.title) && !titles.includes(ctx.itemB.title),
        `child list ${q(titles)}`,
      );
      await selectFolder(page, `${base} parent`);
      await page
        .getByRole("combobox", { name: "Type", exact: true })
        .first()
        .selectOption({ label: "Precedent" });
      await sleep(800);
      titles = await listTitles(page);
      expect(
        titles.includes(ctx.itemB.title) && !titles.includes(ctx.itemA.title),
        `type filter ${q(titles)}`,
      );
      await page
        .getByRole("combobox", { name: "State", exact: true })
        .first()
        .selectOption({ label: "Published" });
      await sleep(800);
      titles = await listTitles(page);
      expect(!titles.includes(ctx.itemB.title), "State Published did not hide the draft");
      await page.getByRole("button", { name: "Clear filters" }).first().click();
      await sleep(800);
      await selectFolder(page, `${base} parent`);
      await page
        .getByRole("combobox", { name: "Author", exact: true })
        .first()
        .selectOption({ label: person.name });
      await sleep(800);
      titles = await listTitles(page);
      expect(titles.includes(ctx.itemB.title), `author ${q(titles)}`);
      await page
        .getByRole("combobox", { name: "Format", exact: true })
        .first()
        .selectOption({ label: "Word" });
      await sleep(800);
      titles = await listTitles(page);
      expect(!titles.includes(ctx.itemB.title), `format Word kept the PDF item ${q(titles)}`);
      await page
        .getByRole("combobox", { name: "Format", exact: true })
        .first()
        .selectOption({ label: "PDF" });
      await sleep(800);
      titles = await listTitles(page);
      expect(titles.includes(ctx.itemB.title), `format PDF ${q(titles)}`);
      await page
        .getByRole("combobox", { name: "Audience", exact: true })
        .first()
        .selectOption({ label: "Everyone" });
      await sleep(800);
      titles = await listTitles(page);
      expect(!titles.includes(ctx.itemB.title), "Audience Everyone kept a Legal Only item");
      await page.getByRole("button", { name: "Clear filters" }).first().click();
      await sleep(800);
      await selectFolder(page, `${base} parent`);
      titles = await listTitles(page);
      expect(
        titles.includes(ctx.itemB.title) && titles.includes(ctx.itemA.title),
        "items did not return after clearing",
      );
      return `Type, State, Audience, Author and Format were each offered. The parent folder listed the item in its child folder as well as its own items; the child folder listed only its item. Type Precedent dropped the Playbook item. State Published hid the drafts. Author ${person.name} kept the PDF item; Format Word dropped it and Format PDF brought it back. Audience Everyone hid that Legal Only item. Clear filters and reselecting the folder brought all items back.`;
    },
  );

  await step(
    A,
    role,
    "Organize the library step 3: Rename or move selected folder excludes the folder and its descendants; Save folder renames or moves",
    "Parent folder omits the folder and its child; Save folder renames or moves it",
    async () => {
      await selectAll(page);
      ctx.target = await addKFolder(page, `${base} target`);
      await selectFolder(page, `${base} parent`);
      await page.getByRole("button", { name: "Rename or move selected folder" }).click();
      let dialog = page.getByRole("dialog", { name: "Rename or move folder" });
      const options = await dialog
        .getByLabel("Parent folder")
        .locator("option")
        .evaluateAll((els) => els.map((e) => e.value));
      expect(
        !options.includes(ctx.parent.id) &&
          !options.includes(ctx.child.id) &&
          options.includes(ctx.target.id),
        "parent choices include the folder or its descendant",
      );
      await dialog.getByLabel("Folder name").fill(`${base} parent renamed`);
      await dialog.getByRole("button", { name: "Save folder" }).click();
      await dialog.waitFor({ state: "hidden" });
      await folderButton(page, `${base} parent renamed`).waitFor();
      await selectFolder(page, `${base} child`);
      await page.getByRole("button", { name: "Rename or move selected folder" }).click();
      dialog = page.getByRole("dialog", { name: "Rename or move folder" });
      await dialog.getByLabel("Parent folder").selectOption(ctx.target.id);
      await dialog.getByRole("button", { name: "Save folder" }).click();
      await dialog.waitFor({ state: "hidden" });
      await until(
        async () =>
          (await readKFolders(page)).find((r) => r.id === ctx.child.id)?.parentId === ctx.target.id,
        "child folder did not move",
      );
      await selectFolder(page, `${base} target`);
      const titles = await listTitles(page);
      expect(
        titles.includes(ctx.itemA.title) &&
          (await readItem(page, ctx.itemA.id)).folderId === ctx.child.id,
        "moved folder's item not listed under the new parent",
      );
      return `In Rename or move folder for the parent folder, Parent folder offered ${options.length} choices including "${base} target" but not the folder itself or its child. Save folder renamed it to "${base} parent renamed". Moving the child folder under "${base} target" kept its item in it, and the target folder listed that item.`;
    },
  );

  await step(
    A,
    role,
    "Organize the library step 4: up/down controls change sibling order; move an item by changing its Folder",
    "Move up then Move down changes the saved order and returns it",
    async () => {
      await selectFolder(page, `${base} target`);
      const orderOf = async () => {
        const siblings = (await readKFolders(page))
          .filter((r) => r.parentId === null)
          .sort((a, b) => a.displayOrder - b.displayOrder);
        return siblings.findIndex((r) => r.id === ctx.target.id);
      };
      const start = await orderOf();
      let clicks = 0;
      const move = async (name, expected) => {
        for (let i = 0; i < 3; i++) {
          clicks++;
          await page.getByRole("button", { name: `Move ${base} target ${name}` }).click();
          try {
            await until(async () => (await orderOf()) === expected, "order unchanged", 4000);
            return;
          } catch {
            /* a click during an in-flight request is ignored; try again */
          }
        }
        throw new Error(`Move ${name} did not change the order`);
      };
      await move("up", start - 1);
      await move("down", start);
      return `The target folder was at sibling position ${start + 1}. Move up saved position ${start}; Move down saved position ${start + 1} again (${clicks} click(s)). Moving an item by its Folder field was shown in the Start with files step 4 check.`;
    },
  );

  await step(
    A,
    role,
    "Organize the library step 5: Delete selected folder, read the confirmation, Delete folder; items and child folders move to its parent",
    "The confirmation says nothing is deleted; the child folder and the item remain with their Documents",
    async () => {
      await selectFolder(page, `${base} target`);
      await page.getByRole("button", { name: "Delete selected folder" }).click();
      const dialog = page.getByRole("dialog", { name: `Delete the ${base} target folder?` });
      const text = tidy(await dialog.innerText());
      await dialog.getByRole("button", { name: "Delete folder" }).click();
      await dialog.waitFor({ state: "hidden" });
      const fl = await readKFolders(page);
      const item = await readItem(page, ctx.itemA.id);
      expect(
        /Nothing is deleted\./.test(text) &&
          !fl.some((r) => r.id === ctx.target.id) &&
          fl.find((r) => r.id === ctx.child.id)?.parentId === null &&
          item.folderId === ctx.child.id &&
          item.documentCount === 1 &&
          !item.archivedAt,
        `text ${text}`,
      );
      return `The dialog read "${text.slice(0, 200)}". Delete folder removed the folder. Its child folder became top-level, and "${item.title}" stayed in that child folder with its one Document (read-back).`;
    },
  );

  await step(
    A,
    role,
    "Recover from an unavailable choice: Manage types… beside Type is for Administrators; archived types are unavailable for new selection",
    "Only the Administrator sees Manage types…; the archived type is absent from the record and both create dialogs",
    async () => {
      await openRecord(page, ctx.itemA.id);
      const manageCount = await page.getByRole("link", { name: "Manage types…" }).count();
      expect(
        manageCount === (role === "administrator" ? 1 : 0),
        `Manage types… count ${manageCount}`,
      );
      const recordOptions = await optionTexts(page.locator("#knowledge-record-type"));
      await page.goto(`${BASE}/knowledge`);
      await itemsRegion(page).waitFor();
      await page.getByRole("button", { name: "New", exact: true }).click();
      await page.getByRole("menuitem", { name: "New Knowledge Item" }).click();
      let dialog = page.getByRole("dialog", { name: "New Knowledge Item" });
      const createOptions = await optionTexts(dialog.getByLabel(/^Type\*?$/));
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await page.getByRole("button", { name: "New", exact: true }).click();
      await page.getByRole("menuitem", { name: "New from files" }).click();
      dialog = page.getByRole("dialog", { name: "New from files" });
      const filesOptions = await optionTexts(dialog.getByLabel(/^Type\*?$/));
      await dialog.getByRole("button", { name: "Cancel" }).click();
      for (const list of [recordOptions, createOptions, filesOptions])
        expect(!list.includes(archivedType.name) && list.includes("Playbook"), `options ${list}`);
      let target = null;
      if (role === "administrator") {
        await openRecord(page, ctx.itemA.id);
        await page.getByRole("link", { name: "Manage types…" }).click();
        await page.waitForURL(/\/settings\/knowledge/);
        target = new URL(page.url()).pathname;
      }
      return `${role === "administrator" ? `Manage types… was beside Type and opened ${target}.` : "No Manage types… link was beside Type for the Legal Team Member."} The archived Knowledge type "${archivedType.name}" was absent from the record Type control, the New Knowledge Item dialog and the New from files dialog; Playbook was offered in all three.`;
    },
  );

  await step(
    A,
    role,
    "Recover from an unavailable choice: an archived Knowledge Item cannot be edited or receive uploads; Restore makes it editable",
    "Archived disables Title, Type, Folder and guidance, hides Upload, and a direct upload is refused; Restore re-enables them",
    async () => {
      await openRecord(page, ctx.guidance.id);
      await page.getByRole("button", { name: "Knowledge Item actions" }).click();
      await page.getByRole("menu").getByRole("menuitem", { name: "Archive" }).click();
      const dialog = page.getByRole("dialog", { name: "Archive Knowledge Item" });
      const dialogText = tidy(await dialog.innerText());
      await dialog.getByRole("button", { name: "Archive", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await waitMarkers(page, { archived: true }, "no Archived marker");
      const disabled = {};
      for (const id of [
        "knowledge-record-title",
        "knowledge-record-type",
        "knowledge-record-folder",
        "knowledge-record-audience",
      ])
        disabled[id] = await page.locator(`#${id}`).isDisabled();
      disabled.guidanceEditor = await page
        .locator("#knowledge-body")
        .isDisabled({ timeout: 3000 })
        .catch(() => null);
      const uploadCount = await page.getByRole("button", { name: "Upload", exact: true }).count();
      const refused = await api(
        page,
        "POST",
        `/knowledge/${ctx.guidance.id}/documents`,
        undefined,
        { file: part(kfix("doc029-checklist.pdf")) },
      );
      expect(
        Object.values(disabled).every((v) => v !== false) &&
          uploadCount === 0 &&
          refused.status >= 400,
        `disabled ${q(disabled)} upload ${uploadCount} direct ${refused.status}`,
      );
      await page.getByRole("button", { name: "Knowledge Item actions" }).click();
      await page.getByRole("menu").getByRole("menuitem", { name: "Restore" }).click();
      await waitMarkers(page, { archived: false }, "Restore did not clear Archived");
      await until(
        async () => !(await page.locator("#knowledge-record-title").isDisabled()),
        "title still disabled after restore",
      );
      await page.getByRole("button", { name: "Upload", exact: true }).waitFor();
      return `Knowledge Item actions, Archive opened "Archive Knowledge Item" ("${dialogText.slice(0, 160)}"); Archive marked the item Archived and disabled Title, Type, Folder, Audience and the guidance editor (${q(disabled)}). Upload disappeared, and a second-actor direct upload answered ${refused.status} (${tidy(refused.body?.detail).slice(0, 100)}). Restore cleared Archived and made the fields and Upload available again.`;
    },
  );

  if (role === ROLES[0]) {
    await step(
      A,
      role,
      "Before you start: OpenLaw Help search does not search Knowledge Items",
      "Help finds this guide by its title but not a Knowledge Item by its title",
      async () => {
        await page.goto(`${BASE}/help`);
        const box = page
          .getByRole("searchbox", { name: "Search documentation" })
          .or(page.getByLabel("Search documentation"))
          .first();
        await box.fill("Create and organize Knowledge Items");
        await box.press("Enter");
        await page
          .getByRole("link", { name: "Create and organize Knowledge Items" })
          .first()
          .waitFor({ timeout: 15000 });
        await box.fill(`${base} guidance`);
        await box.press("Enter");
        await page.getByText(/No matching articles/).waitFor({ timeout: 15000 });
        return `Help search found "Create and organize Knowledge Items" by its title. A search for the Knowledge Item title "${base} guidance" answered "No matching articles".`;
      },
    );
  }
  knowledgeItems[role] = ctx;
  await context.close();
}

// =====================================================================
// Business User negative checks (all three articles), one fresh magic link
// =====================================================================
async function business() {
  const role = "business_user";
  const staff = (await staffContext(PEOPLE.nadia)).page;
  const contract = await createContract(
    staff,
    "legal_team_member",
    `DOC-030 documents-2 Portal Contract ${stamp}`,
  );
  const recUrl = `/contracts/${contract.number}`;
  await addTeam(staff, contract.number, PEOPLE.jonas.email);
  const seedDoc = await uploadApi(staff, `${recUrl}/documents`, dfix("doc029-bulk-a.txt"), {
    as: `doc030-portal-seed-${stamp}.txt`,
  });
  const tf = await api(staff, "POST", `${recUrl}/folders`, {
    name: `DOC-030 portal target ${stamp}`,
  });
  expect(tf.status === 201, `fixture folder ${tf.status}`);
  const targetId = (await folderList(staff, recUrl)).find(
    (f) => f.name === `DOC-030 portal target ${stamp}`,
  ).id;
  const kItem =
    knowledgeItems.legal_team_member?.itemA?.id ??
    knowledgeItems.administrator?.itemA?.id ??
    (await api(staff, "GET", "/knowledge?limit=1")).body.knowledgeItems[0].id;
  const { page } = await portalContext(PEOPLE.jonas);
  currentPage = page;
  const section = () => page.getByRole("region", { name: "Documents", exact: true });

  await step(
    "document-folders",
    role,
    "Before you start: Business Users upload several files at the record root in the Portal, but cannot create folders, move Documents or import a folder structure",
    "Upload documents takes two files to the record root; no Choose folder or New folder; the folder and move requests are refused",
    async () => {
      await page.goto(`${BASE}/portal/contracts/${contract.number}`);
      await section().getByRole("heading", { name: "Documents" }).waitFor({ timeout: 30000 });
      await section().getByRole("button", { name: "Upload documents" }).click();
      const dialog = page.getByRole("dialog", { name: "Upload documents" });
      const dialogText = tidy(await dialog.innerText());
      const folderPicker = await dialog.getByRole("button", { name: /Choose folder/ }).count();
      await chooseFiles(page, dialog.getByRole("button", { name: "Drop files or choose files" }), [
        dfix("doc029-bulk-c.txt"),
        dfix("doc029-bulk-d.txt"),
      ]);
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      const docs = await recordDocs(staff, recUrl);
      const added = docs.filter((d) =>
        /doc029-bulk-[cd]/.test(d.versions[0]?.originalFilename ?? ""),
      );
      const sectionText = tidy(await section().innerText());
      const create = await api(page, "POST", `${recUrl}/folders`, {
        name: "DOC-030 portal attempt",
      });
      const move = await api(page, "PATCH", `/documents/${seedDoc.id}`, { folderId: targetId });
      const after = await getDoc(staff, recUrl, seedDoc.id);
      expect(
        folderPicker === 0 &&
          !/Choose folder|New folder/.test(dialogText + sectionText) &&
          added.length === 2 &&
          added.every((d) => !folderOf(d)) &&
          create.status >= 400 &&
          move.status >= 400 &&
          !folderOf(after),
        `picker ${folderPicker} added ${added.length} create ${create.status} move ${move.status}`,
      );
      return `Jonas Weber signed in to the Portal with a fresh magic link. On C-${contract.number}, Upload documents ("${dialogText.slice(0, 140)}") had no Choose folder; the Documents section had no New folder or Move to folder. Two files uploaded together became two Documents at the record root (read-back by Legal). A folder create request answered ${create.status} and moving a Document into a folder answered ${move.status}; the Document stayed at the root.`;
    },
  );

  await step(
    "document-repository",
    role,
    "Before you start and Missing: Business Users read paper through the Portal, not the staff repository",
    "The staff /documents address does not open the repository, and the repository read is refused",
    async () => {
      await page.goto(`${BASE}/documents`);
      await sleep(2000);
      const landed = new URL(page.url()).pathname;
      const read = await api(page, "GET", "/documents?limit=5");
      expect(
        !landed.startsWith("/documents") && read.status >= 400,
        `landed ${landed} read ${read.status}`,
      );
      return `Jonas's Portal session asking for /documents ended on ${landed}; the staff repository read answered ${read.status}.`;
    },
  );

  await step(
    "create-knowledge",
    role,
    "Before you start: Business Users cannot author or browse the staff Knowledge library",
    "The staff /knowledge and record addresses do not open; the staff Knowledge list, record and create requests are refused",
    async () => {
      await page.goto(`${BASE}/knowledge`);
      await sleep(1500);
      const listPath = new URL(page.url()).pathname;
      await page.goto(`${BASE}/knowledge/${kItem}`);
      await sleep(1500);
      const recordPath = new URL(page.url()).pathname;
      const typeId = (await api(staff, "GET", "/knowledge/type-options")).body.knowledgeTypes[0].id;
      const statuses = [
        (await api(page, "GET", "/knowledge")).status,
        (await api(page, "GET", `/knowledge/${kItem}`)).status,
        (
          await api(page, "POST", "/knowledge", {
            title: "DOC-030 documents-2 refused",
            knowledgeTypeId: typeId,
          })
        ).status,
      ];
      expect(
        !listPath.startsWith("/knowledge") &&
          !recordPath.startsWith("/knowledge") &&
          statuses.every((s) => s === 403 || s === 404),
        `list ${listPath} record ${recordPath} api ${statuses}`,
      );
      return `/knowledge sent Jonas to ${listPath}; a staff Knowledge record address sent him to ${recordPath}. The staff Knowledge list, record and create requests answered ${q(statuses)}.`;
    },
  );
}

// ---------- main ----------
try {
  await loadFixtureIds();
  if (SECTIONS.includes("setup")) await setup();
  for (const role of ROLES) {
    const person = role === "administrator" ? PEOPLE.daniel : PEOPLE.nadia;
    if (SECTIONS.includes("folders")) await folders(role, person);
    if (SECTIONS.includes("repository")) await repository(role, person);
    if (SECTIONS.includes("knowledge")) await knowledge(role, person);
  }
  if (SECTIONS.includes("business")) await business();
} catch (error) {
  results.fatal = String(error?.stack ?? error).slice(0, 600);
  console.error(error);
} finally {
  if (SECTIONS.includes("teardown")) {
    await teardown().catch((e) => (results.teardownError = String(e)));
    await knowledgeTeardown().catch((e) => (results.teardownError = String(e)));
  }
  save();
  fs.rmSync(WORK, { recursive: true, force: true });
  await close();
}
const passed = results.steps.filter((s) => s.result === "pass").length;
console.log(
  `steps ${results.steps.length}, passed ${passed}, failed ${results.steps.length - passed}`,
);
