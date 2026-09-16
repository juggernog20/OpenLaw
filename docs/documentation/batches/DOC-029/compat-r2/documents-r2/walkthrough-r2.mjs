// DOC-029 round 2 compatibility replay, documents group. Adapted copy of documents/walkthrough-r1.mjs.
// Changes from round 1: lab name work2, record names DOC-029r2, output and screenshot paths, round metadata.
// Articles: document-versions (V-C26), document-folders (V-C27), document-previews (V-C28),
// document-repository (V-C30), archive-and-delete-documents (V-C54).
//
// Run from the worktree root:
//   LAB_PASSWORD=... mise exec -- node docs/documentation/batches/DOC-029/documents/walkthrough-r1.mjs
// Optional: SECTIONS=versions,folders,previews,portal,repository,archive  ROLES=administrator,legal_team_member
// OUT=<path> (default walkthrough-r1.json next to this script).
// API calls prepare fictional records ("fixture") or read back results ("read-back"); every
// credited reader action operates the browser controls the article names.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
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
} from "../../documents/lib-r1.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = process.env.OUT ?? path.join(HERE, "walkthrough-r2.json");
const SECTIONS = (
  process.env.SECTIONS ?? "versions,folders,previews,portal,repository,archive"
).split(",");
const ROLES = (process.env.ROLES ?? "administrator,legal_team_member").split(",");
const FIX = path.join(here, "fixtures"); // here is the round 1 documents folder (from lib-r1.mjs)
const stamp = Date.now().toString().slice(-6);
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const fixture = (name) => path.join(FIX, name);
const fixtureHash = (name) => sha(fs.readFileSync(fixture(name)));
const ARTICLES = [
  "document-versions",
  "document-folders",
  "document-previews",
  "document-repository",
  "archive-and-delete-documents",
];

function labStatus() {
  try {
    const text = execFileSync(
      "mise",
      ["exec", "--", "node", "scripts/documentation/lab.mjs", "status", "work2"],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    const project = text.match(/(openlaw-docs-[a-z0-9]+-work2)-app-1/)?.[1] ?? null;
    const image = (container) =>
      execFileSync("docker", ["inspect", "--format", "{{.Image}}", container], {
        encoding: "utf8",
      }).trim();
    return {
      summary: text.split("\n")[0],
      project,
      images: project
        ? {
            app: image(`${project}-app-1`),
            worker: image(`${project}-worker-1`),
            "doc-engine": image(`${project}-doc-engine-1`),
          }
        : null,
    };
  } catch (error) {
    return {
      summary: `status unavailable: ${String(error).slice(0, 200)}`,
      project: null,
      images: null,
    };
  }
}

const results = {
  kind: "independent-article-walkthrough",
  task: "DOC-029",
  group: "documents",
  round: 2,
  replayOf: "docs/documentation/batches/DOC-029/documents/walkthrough-r1.mjs",
  walkthroughReviewer: "DOC-029r2 compatibility reviewer (documents)",
  reviewerKind: "agent",
  appCommit: "57e77e386be31b2a319f7143dd54d00123e65efe",
  lab: labStatus(),
  appUrl: BASE,
  mailUrl: MAIL,
  browser: "Playwright 1.63.0 Chromium, headless, one browser context per identity",
  articleHashes: Object.fromEntries(
    ARTICLES.map((id) => [
      id,
      sha(fs.readFileSync(path.join(root, "docs/user-guides", `${id}.md`))),
    ]),
  ),
  fixtures: fs
    .readdirSync(FIX)
    .filter((f) => f.startsWith("doc029-"))
    .map((f) => ({
      path: `docs/documentation/batches/DOC-029/documents/fixtures/${f}`,
      sha256: fixtureHash(f),
    })),
  sections: SECTIONS,
  roles: ROLES,
  stamp,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  records: [],
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
const SHOT_DIR = process.env.SHOT_DIR ?? null;
async function step(article, scenario, role, action, expected, fn) {
  const entry = {
    article,
    scenario,
    role,
    method: "browser-walkthrough",
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
    entry.actual = `Check did not pass: ${error instanceof Error ? error.message.split("\n").slice(0, 3).join(" ") : String(error)}`;
    entry.result = "fail";
    if (SHOT_DIR && currentPage)
      await currentPage
        .screenshot({ path: path.join(SHOT_DIR, `fail-${results.steps.length}.png`) })
        .catch(() => {});
  }
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

// ---------- fixture and read-back helpers (API) ----------
const CONTRACT_TYPE = "019ff1f5-301d-7795-a5af-e4339c76d4ce"; // NDA
let userIds = null;
async function loadUserIds() {
  // Fixture lookup with the Administrator session: the user list is Administrator-only.
  const { context, page } = await staffContext(PEOPLE.daniel);
  const r = await api(page, "GET", "/users?limit=200");
  userIds = Object.fromEntries((r.body.users ?? []).map((u) => [u.email, u.id]));
  await context.close();
}
async function userId(_page, email) {
  const id = userIds?.[email];
  if (!id) throw new Error(`no user id for ${email}`);
  return id;
}
async function addTeam(page, number, email) {
  const r = await api(page, "POST", `/contracts/${number}/team`, {
    userId: await userId(page, email),
  });
  expect(
    r.status === 201 || r.status === 200 || r.status === 409,
    `fixture team add ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`,
  );
}
async function createContract(page, role, title, extra = {}) {
  const r = await api(page, "POST", "/contracts", {
    title,
    contractTypeId: CONTRACT_TYPE,
    ...extra,
  });
  expect(
    r.status === 201,
    `fixture contract refused ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`,
  );
  record(role, "contract", title, `C-${r.body.contract.number}`);
  return r.body.contract;
}
let matterType = null;
async function createMatter(page, role, title, extra = {}) {
  if (!matterType) {
    const o = await api(page, "GET", "/matters/options");
    matterType = o.body.matterTypes.find((t) => !t.fields.some((f) => f.isRequired))?.id;
  }
  const r = await api(page, "POST", "/matters", { title, matterTypeId: matterType, ...extra });
  expect(
    r.status === 201,
    `fixture matter refused ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`,
  );
  record(role, "matter", title, `M-${r.body.matter.number}`);
  return r.body.matter;
}
const MIME = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".png": "image/png",
  ".eml": "message/rfc822",
  ".csv": "text/csv",
  ".zip": "application/zip",
  ".txt": "text/plain",
};
function part(name, as = name) {
  return {
    name: as,
    mimeType: MIME[path.extname(name)] ?? "application/octet-stream",
    buffer: fs.readFileSync(fixture(name)),
  };
}
async function uploadApi(page, url, name, { kind = "draft_ours", note, folderId, as } = {}) {
  const multipart = { kind };
  if (note) multipart.note = note;
  if (folderId) multipart.folderId = folderId;
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
async function download(page, trigger) {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), trigger()]);
  const file = await dl.path();
  return { name: dl.suggestedFilename(), sha256: sha(fs.readFileSync(file)) };
}

// ---------- UI helpers ----------
const docsSection = (page) => page.getByRole("region", { name: "Documents", exact: true });
const failingResponses = new WeakMap();
function watchResponses(page) {
  if (failingResponses.has(page)) return;
  const seen = [];
  failingResponses.set(page, seen);
  page.on("response", (r) => {
    if (r.url().includes("/api/") && r.status() >= 500)
      seen.push({
        status: r.status(),
        method: r.request().method(),
        path: new URL(r.url()).pathname,
        at: new Date().toISOString(),
      });
  });
}
async function openDocumentsTab(page, url) {
  watchResponses(page);
  await page.goto(`${BASE}${url}`);
  const heading = docsSection(page).getByRole("heading", { name: "Documents" });
  const broken = page.getByText("Something went wrong.");
  await heading.or(broken).first().waitFor({ timeout: 30000 });
  if (await broken.isVisible().catch(() => false)) {
    results.pageLoadErrors ??= [];
    results.pageLoadErrors.push({
      path: url,
      at: new Date().toISOString(),
      serverErrors: (failingResponses.get(page) ?? []).slice(-5),
    });
    await page.getByRole("button", { name: "Reload" }).click();
    await heading.waitFor({ timeout: 30000 });
  }
  await page.waitForLoadState("networkidle").catch(() => {});
}
async function rowMenu(page, title) {
  const trigger = page.getByRole("button", { name: `Actions for ${title}`, exact: true });
  await trigger.click();
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
function reader(page) {
  return page
    .getByRole("complementary")
    .filter({ has: page.getByRole("button", { name: "Close the document" }) });
}
const rowOf = (page, title) =>
  page
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: `Actions for ${title}`, exact: true }) });
async function shot(page, name) {
  await page
    .screenshot({ path: path.join(process.env.SHOT_DIR ?? "/tmp/claude-1000", name) })
    .catch(() => {});
  results.screenshots ??= [];
  results.screenshots.push(`scratch (not committed): ${name}`);
}
const HAND_SET_KINDS = [
  "Draft · ours",
  "Draft · theirs",
  "Redline · theirs",
  "Redline · ours",
  "Executed",
  "Amendment",
];

// =====================================================================
// document-versions (V-C26)
// =====================================================================
async function versions(role, person) {
  const A = "document-versions";
  const S = "V-C26";
  const label = role === "administrator" ? "Admin" : "Legal";
  const { context, page } = await staffContext(person);
  currentPage = page;
  const contract = await createContract(
    page,
    role,
    `DOC-029r2 documents ${label} versions Contract ${stamp}`,
  );
  await addTeam(page, contract.number, PEOPLE.jonas.email);
  const matter = await createMatter(
    page,
    role,
    `DOC-029r2 documents ${label} versions Matter ${stamp}`,
  );
  const recUrl = `/contracts/${contract.number}`;
  let first;

  await step(
    A,
    S,
    role,
    "Upload a new Document steps 1-4: Documents tab, Upload, Choose files with one file, Kind, Note, Upload",
    "One file creates a Document named from its filename with a v1 row; Kind offers the six hand-set kinds",
    async () => {
      await openDocumentsTab(page, `${recUrl}/documents`);
      await docsSection(page).getByRole("button", { name: "Upload", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Upload document" });
      await dialog.waitFor();
      await chooseFiles(
        page,
        dialog.getByRole("button", { name: /Choose files/ }),
        fixture("doc029-draft-v1.docx"),
      );
      const kinds = (
        await dialog.getByLabel("Kind", { exact: true }).locator("option").allInnerTexts()
      ).map((t) => t.trim());
      expect(
        HAND_SET_KINDS.every((k) => kinds.includes(k)) && !kinds.includes("Generated redline"),
        `Kind options ${kinds}`,
      );
      await dialog.getByLabel("Kind", { exact: true }).selectOption({ label: "Draft · ours" });
      await dialog.getByLabel("Note").fill("DOC-029 round one note");
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      const docs = await recordDocs(page, recUrl);
      expect(docs.length === 1, `expected one Document, read ${docs.length}`);
      first = docs[0];
      const row = page.getByRole("row").filter({
        has: page.getByRole("button", { name: `Actions for ${first.title}`, exact: true }),
      });
      await row.waitFor();
      const text = await row.innerText();
      expect(/v1/.test(text), `row text lacks v1: ${text}`);
      expect(first.title.startsWith("doc029-draft-v1"), `title ${first.title}`);
      return `Upload document dialog opened with Choose files, Kind and Note. Kind offered ${kinds.join(", ")}; no Generated redline. After Upload the list held one row "${first.title}" (from the filename) showing v1, Draft · ours and the note.`;
    },
  );

  await step(
    A,
    S,
    role,
    "Upload step 2 variant: choosing several files opens the bulk import dialog",
    "The Import dialog replaces the one-file composer; Cancel creates nothing",
    async () => {
      await docsSection(page).getByRole("button", { name: "Upload", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Upload document" });
      await chooseFiles(page, dialog.getByRole("button", { name: /Choose files/ }), [
        fixture("doc029-bulk-a.txt"),
        fixture("doc029-bulk-b.txt"),
      ]);
      const batch = page.getByRole("dialog", { name: "Import 2 files" });
      await batch.waitFor();
      await batch.getByRole("button", { name: "Cancel" }).click();
      await batch.waitFor({ state: "hidden" });
      const docs = await recordDocs(page, recUrl);
      expect(docs.length === 1, `count ${docs.length}`);
      return "Two chosen files opened the Import 2 files dialog instead of the composer. Cancel closed it and the record still held one Document.";
    },
  );

  const newName = `DOC-029r2 ${label} supply draft ${stamp}`;
  await step(
    A,
    S,
    role,
    "Upload step 4: Actions menu, Edit details, Save changes the name and description",
    "Name and description change; the Version chain is untouched",
    async () => {
      await chooseMenu(page, first.title, "Edit details");
      const dialog = page.getByRole("dialog", { name: "Edit details" });
      await dialog.getByLabel("Name").fill(newName);
      await dialog.getByLabel("Description").fill("DOC-029 fictional description");
      await dialog.getByRole("button", { name: "Save" }).click();
      await dialog.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: `Actions for ${newName}`, exact: true }).waitFor();
      const doc = await getDoc(page, recUrl, first.id);
      expect(
        doc.title === newName &&
          doc.description === "DOC-029 fictional description" &&
          doc.versions.length === 1,
        JSON.stringify(doc).slice(0, 200),
      );
      first = doc;
      return `Edit details saved the name "${newName}" and a description. Read-back: still one Version, v1.`;
    },
  );

  const v1Hash = fixtureHash("doc029-draft-v1.docx");
  await step(
    A,
    S,
    role,
    "Add another Version steps 1-3: Add version, Choose file, Kind, Note, Upload; expand and read the earlier Version",
    "The Version number increases; the earlier Version stays readable with its note, author and bytes",
    async () => {
      await chooseMenu(page, newName, "Add version");
      const dialog = page.getByRole("dialog", { name: "Add version" });
      await dialog.waitFor();
      await chooseFiles(
        page,
        dialog.getByRole("button", { name: /Choose file/ }),
        fixture("doc029-draft-v2.docx"),
      );
      await dialog.getByLabel("Kind", { exact: true }).selectOption({ label: "Draft · theirs" });
      await dialog.getByLabel("Note").fill("DOC-029 round two note");
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      const row = page
        .getByRole("row")
        .filter({ has: page.getByRole("button", { name: `Actions for ${newName}`, exact: true }) });
      await row.getByText("v2", { exact: true }).waitFor();
      await page.getByRole("button", { name: `Show the 1 earlier version of ${newName}` }).click();
      await page.getByRole("button", { name: "doc029-draft-v1.docx", exact: true }).click();
      const panel = page.getByRole("complementary", { name: `${newName}, version 1` });
      await panel.waitFor({ timeout: 30000 });
      const chip = await panel.getByText("v1", { exact: true }).isVisible();
      const dl = await download(page, () => panel.getByRole("link", { name: "Download" }).click());
      expect(dl.sha256 === v1Hash, `v1 download hash ${dl.sha256}`);
      const doc = await getDoc(page, recUrl, first.id);
      const v1 = doc.versions.find((v) => v.versionNumber === 1);
      expect(
        doc.versions.length === 2 &&
          v1.note === "DOC-029 round one note" &&
          v1.kind === "draft_ours" &&
          v1.originalFilename === "doc029-draft-v1.docx",
        "v1 changed",
      );
      await panel.getByRole("button", { name: "Close the document" }).click();
      first = doc;
      return `Add version dialog showed Choose file, Kind and Note; after Upload the row read v2. Expanding the chain listed doc029-draft-v1.docx; selecting it opened the reader "${newName}, version 1" with the v1 chip ${chip ? "visible" : "absent"}. Download returned the original v1 bytes (SHA-256 match). v1 kept its note, kind, filename and uploader.`;
    },
  );

  await step(
    A,
    S,
    role,
    "History note: uploading the same paper as a new Document creates a separate chain",
    "A second Document appears; the first chain is not merged or changed",
    async () => {
      await docsSection(page).getByRole("button", { name: "Upload", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Upload document" });
      await chooseFiles(
        page,
        dialog.getByRole("button", { name: /Choose files/ }),
        fixture("doc029-draft-v1.docx"),
      );
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      const docs = await recordDocs(page, recUrl);
      const again = docs.find((d) => d.id !== first.id);
      expect(
        docs.length === 2 && again && (await getDoc(page, recUrl, first.id)).versions.length === 2,
        `docs ${docs.length}`,
      );
      return `The same file uploaded again made a second Document "${again.title}" at v1; the first Document still had two Versions.`;
    },
  );

  await step(
    A,
    S,
    role,
    "Correct the Kind control on an existing hand-set Version",
    "The kind changes; bytes and Executed pin do not; Generated redline is not offered",
    async () => {
      const select = page.getByLabel(`Kind of version 2 of ${newName}`, { exact: true });
      const options = (await select.locator("option").allInnerTexts()).map((t) => t.trim());
      expect(!options.includes("Generated redline"), `options ${options}`);
      await select.selectOption({ label: "Redline · theirs" });
      let doc;
      for (let i = 0; i < 20; i++) {
        doc = await getDoc(page, recUrl, first.id);
        if (doc.versions.find((v) => v.versionNumber === 2).kind === "redline_theirs") break;
        await sleep(250);
      }
      const v2 = doc.versions.find((v) => v.versionNumber === 2);
      expect(
        v2.kind === "redline_theirs" && !doc.versions.some((v) => v.isExecuted),
        `v2 ${JSON.stringify(v2).slice(0, 120)}`,
      );
      const bytes = await api(page, "GET", `/documents/${first.id}/versions/${v2.id}/download`);
      return `The Kind control on v2 offered ${options.join(", ")}. Choosing Redline · theirs saved (read-back kind redline_theirs); no Executed pin was set by the change; the v2 download still answered ${bytes.status}.`;
    },
  );

  let pinnedVersion;
  await step(
    A,
    S,
    role,
    "Executed pin: Mark as executed copy on an earlier Version; a later upload does not move it; Unmark clears it",
    "The pin stays on the earlier Version after a newer Version arrives",
    async () => {
      const earlier = page.getByRole("button", {
        name: `Actions for version 1 of ${newName}`,
        exact: true,
      });
      if (!(await earlier.isVisible()))
        await page
          .getByRole("button", { name: `Show the 1 earlier version of ${newName}` })
          .click();
      await earlier.click();
      await page.getByRole("menuitem", { name: "Mark as executed copy" }).click();
      let doc;
      for (let i = 0; i < 20; i++) {
        doc = await getDoc(page, recUrl, first.id);
        if (doc.versions.some((v) => v.isExecuted)) break;
        await sleep(250);
      }
      pinnedVersion = doc.versions.find((v) => v.isExecuted);
      expect(pinnedVersion?.versionNumber === 1, "pin not on v1");
      await chooseMenu(page, newName, "Add version");
      const dialog = page.getByRole("dialog", { name: "Add version" });
      await chooseFiles(
        page,
        dialog.getByRole("button", { name: /Choose file/ }),
        fixture("doc029-draft-v2.docx"),
      );
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      doc = await getDoc(page, recUrl, first.id);
      const stillOnV1 =
        doc.versions.find((v) => v.isExecuted)?.versionNumber === 1 && doc.versions.length === 3;
      expect(stillOnV1, "pin moved after v3");
      const toggle = page.getByRole("button", {
        name: `Show the 2 earlier versions of ${newName}`,
      });
      if (await toggle.isVisible().catch(() => false)) await toggle.click();
      await page
        .getByRole("button", { name: `Actions for version 1 of ${newName}`, exact: true })
        .click();
      await page.getByRole("menuitem", { name: "Unmark as executed copy" }).click();
      for (let i = 0; i < 20; i++) {
        doc = await getDoc(page, recUrl, first.id);
        if (!doc.versions.some((v) => v.isExecuted)) break;
        await sleep(250);
      }
      expect(!doc.versions.some((v) => v.isExecuted), "unmark did not clear");
      first = doc;
      return "Mark as executed copy on version 1 set the pin there. A v3 upload left the pin on v1. Unmark as executed copy on v1 cleared the pin.";
    },
  );

  await step(
    A,
    S,
    role,
    "Primary Document: the Primary mark and Make primary move the designation",
    "Primary moves to the other Document",
    async () => {
      const docs = await recordDocs(page, recUrl);
      const primary = docs.find((d) => d.isPrimary);
      const other = docs.find((d) => !d.isPrimary);
      expect(primary && other, `primary ${!!primary} other ${!!other}`);
      const primaryRow = page.getByRole("row").filter({
        has: page.getByRole("button", { name: `Actions for ${primary.title}`, exact: true }),
      });
      await primaryRow.getByText("Primary", { exact: true }).waitFor();
      const primaryItems = await menuItems(page, primary.title);
      expect(!primaryItems.includes("Make primary"), `primary row items ${primaryItems}`);
      await chooseMenu(page, other.title, "Make primary");
      let moved;
      for (let i = 0; i < 20; i++) {
        moved = (await recordDocs(page, recUrl)).find((d) => d.isPrimary);
        if (moved?.id === other.id) break;
        await sleep(250);
      }
      expect(moved?.id === other.id, "designation did not move");
      await page
        .getByRole("row")
        .filter({
          has: page.getByRole("button", { name: `Actions for ${other.title}`, exact: true }),
        })
        .getByText("Primary", { exact: true })
        .waitFor();
      await chooseMenu(page, primary.title, "Make primary");
      await sleep(800);
      return `"${primary.title}" carried the Primary mark and its menu had no Make primary. Make primary on "${other.title}" moved the mark there (read-back isPrimary). The designation was then moved back for the next checks.`;
    },
  );

  await step(
    A,
    S,
    role,
    "A Matter upload has no Kind control, and a Matter has no Primary mark or Executed pin",
    "No Kind column or composer Kind, no Make primary or Mark as executed copy",
    async () => {
      await openDocumentsTab(page, `/matters/${matter.number}/documents`);
      await docsSection(page).getByRole("button", { name: "Upload", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Upload document" });
      await chooseFiles(
        page,
        dialog.getByRole("button", { name: /Choose files/ }),
        fixture("doc029-draft-v1.docx"),
      );
      const kindCount = await dialog.getByLabel("Kind", { exact: true }).count();
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      const [doc] = await recordDocs(page, `/matters/${matter.number}`);
      const header = await docsSection(page).getByRole("columnheader").allInnerTexts();
      const items = await menuItems(page, doc.title);
      expect(
        kindCount === 0 && !header.some((h) => h.trim() === "Kind"),
        `kind ${kindCount} headers ${header}`,
      );
      expect(
        !items.includes("Make primary") && !items.includes("Mark as executed copy"),
        `items ${items}`,
      );
      expect(
        (await docsSection(page)
          .getByLabel(/^Kind of version/)
          .count()) === 0,
        "kind correction on matter",
      );
      const types = (await api(page, "GET", "/entities/types")).body.entityTypes;
      const ent = await api(page, "POST", "/entities", {
        legalName: `DOC-029r2 documents ${label} versions Entity ${stamp} Ltd`,
        entityTypeId: types[0].id,
      });
      expect(ent.status === 201, `fixture entity ${ent.status}`);
      record(role, "entity", ent.body.entity.legalName, ent.body.entity.id);
      const entDoc = await uploadApi(
        page,
        `/entities/${ent.body.entity.id}/documents`,
        "doc029-draft-v1.docx",
        { as: `versions-entity-${label.toLowerCase()}-${stamp}.docx` },
      );
      await openDocumentsTab(page, `/entities/${ent.body.entity.id}/documents`);
      const entItems = await menuItems(page, entDoc.title);
      const entPrimary = await rowOf(page, entDoc.title)
        .getByText("Primary", { exact: true })
        .count();
      expect(
        !entItems.includes("Make primary") &&
          !entItems.includes("Mark as executed copy") &&
          entPrimary === 0,
        `entity items ${entItems}`,
      );
      return `The Matter Upload document dialog had no Kind control and the list had no Kind column or Kind correction. The row menu offered ${items.join(", ")}: no Make primary and no Mark as executed copy. On an Entity the Document row had no Primary mark and its menu offered ${entItems.join(", ")}.`;
    },
  );

  await step(
    A,
    S,
    role,
    "Before you start: an archived owning record must be restored before uploading",
    "The archived record offers no Upload; restoring brings it back; the seam refuses an upload meanwhile",
    async () => {
      const frozen = await createContract(
        page,
        role,
        `DOC-029r2 documents ${label} archived owner ${stamp}`,
      );
      const a = await api(page, "POST", `/contracts/${frozen.number}/archive`, {});
      expect(a.status === 200, `fixture archive ${a.status}`);
      await openDocumentsTab(page, `/contracts/${frozen.number}/documents`);
      const uploadWhileArchived = await docsSection(page)
        .getByRole("button", { name: "Upload", exact: true })
        .count();
      const refused = await api(page, "POST", `/contracts/${frozen.number}/documents`, undefined, {
        kind: "draft_ours",
        file: part("doc029-bulk-a.txt"),
      });
      const r = await api(page, "POST", `/contracts/${frozen.number}/restore`, {});
      expect(r.status === 200, `fixture restore ${r.status}`);
      await openDocumentsTab(page, `/contracts/${frozen.number}/documents`);
      const uploadAfter = await docsSection(page)
        .getByRole("button", { name: "Upload", exact: true })
        .count();
      expect(
        uploadWhileArchived === 0 && uploadAfter === 1 && refused.status >= 400,
        `archived ${uploadWhileArchived} after ${uploadAfter} api ${refused.status}`,
      );
      return `While the Contract was archived its Documents section showed no Upload button and a direct upload answered ${refused.status} (${String(refused.body?.detail ?? "").slice(0, 90)}). After restoring the Contract the Upload button returned.`;
    },
  );

  await step(
    A,
    S,
    role,
    "Recover from a refusal: a failed upload shows a message and does not alter the chain",
    "An upload message appears; the Version count stays the same",
    async () => {
      await openDocumentsTab(page, `${recUrl}/documents`);
      const before = (await getDoc(page, recUrl, first.id)).versions.length;
      await page.route("**/api/v1/documents/*/versions", (route) =>
        route.request().method() === "POST"
          ? route.fulfill({
              status: 413,
              contentType: "application/problem+json",
              body: JSON.stringify({
                type: "about:blank",
                title: "Payload Too Large",
                status: 413,
                detail: "DOC-029 fixture: this file is larger than the upload limit.",
              }),
            })
          : route.continue(),
      );
      await chooseMenu(page, newName, "Add version");
      const dialog = page.getByRole("dialog", { name: "Add version" });
      await chooseFiles(
        page,
        dialog.getByRole("button", { name: /Choose file/ }),
        fixture("doc029-draft-v2.docx"),
      );
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      const alert = await dialog.getByRole("alert").innerText();
      await page.unroute("**/api/v1/documents/*/versions");
      await dialog.getByRole("button", { name: "Cancel" }).click();
      const after = (await getDoc(page, recUrl, first.id)).versions.length;
      expect(
        after === before && /larger than the upload limit/.test(alert),
        `before ${before} after ${after} alert ${alert}`,
      );
      return `With a browser-network fixture answering 413 for the Version upload, the Add version dialog stayed open with the message "${alert}". The Document still had ${after} Versions.`;
    },
  );

  // Conversation filing
  const contractRow = (await api(page, "GET", recUrl)).body.contract;
  const legalOnly = await api(page, "POST", "/comments", undefined, {
    entityType: "contract",
    entityId: contractRow.id,
    body: `DOC-029r2 ${label} Legal only attachment`,
    visibility: "legal_only",
    file: part("doc029-services-text.pdf", `doc029-${label.toLowerCase()}-legal-only.pdf`),
  });
  const teamNote = await api(page, "POST", "/comments", undefined, {
    entityType: "contract",
    entityId: contractRow.id,
    body: `DOC-029r2 ${label} team attachment`,
    visibility: "full_thread",
    file: part("doc029-draft-v2.docx", `doc029-${label.toLowerCase()}-round.docx`),
  });
  expect(legalOnly.status === 201 && teamNote.status === 201, "fixture comments");

  async function openComments() {
    await page
      .getByRole("toolbar", { name: "Applets" })
      .getByRole("button", { name: "Comments" })
      .click();
  }
  let filedTitle = `DOC-029r2 ${label} filed paper ${stamp}`;
  await step(
    A,
    S,
    role,
    "File a Contract conversation attachment steps 1-4: File to Contract, New Document, Confidential preselected for Legal Only",
    "A Legal Only attachment files as a new Confidential Document and the comment reads Filed to",
    async () => {
      await openDocumentsTab(page, `${recUrl}/documents`);
      await openComments();
      const name = `doc029-${label.toLowerCase()}-legal-only.pdf`;
      const item = page
        .getByRole("list", { name: "Comment attachments" })
        .getByRole("listitem")
        .filter({ hasText: name });
      await item.waitFor({ timeout: 20000 });
      await item.getByRole("button", { name: "File to Contract" }).click();
      const dialog = page.getByRole("dialog", { name: "File attachment" });
      await dialog.waitFor();
      const dest = await dialog.getByLabel("Destination").inputValue();
      const toggle = dialog.getByRole("switch", {
        name: "Confidential — restrict to the contract team",
      });
      const on = await toggle.getAttribute("aria-checked");
      const kinds = await dialog.getByLabel("Kind", { exact: true }).count();
      await dialog.getByLabel("Document name").fill(filedTitle);
      await dialog.getByLabel("Kind", { exact: true }).selectOption({ label: "Draft · theirs" });
      await dialog.getByRole("button", { name: "File", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 20000 });
      await item.getByText(/Filed to/).waitFor();
      const filedText = (await item.innerText()).replace(/\s+/g, " ");
      const doc = (await recordDocs(page, recUrl)).find((d) => d.title === filedTitle);
      expect(
        dest === "new_document" &&
          on === "true" &&
          kinds === 1 &&
          doc?.isConfidential &&
          doc.versions.length === 1,
        `dest ${dest} on ${on} doc ${!!doc}`,
      );
      return `The attachment offered File to Contract. File attachment opened with Destination New Document and "Confidential — restrict to the contract team" already on, plus Document name and Kind. File created "${filedTitle}" (Confidential, one Version) and the comment read "${filedText.match(/Filed to[^]*$/)?.[0]}".`;
    },
  );

  await step(
    A,
    S,
    role,
    "File a Contract conversation attachment: open the preview, File to Contract, New Version on an existing Document with a Note",
    "The preview offers the same action; the Version is appended with its note",
    async () => {
      const name = `doc029-${label.toLowerCase()}-round.docx`;
      const item = page
        .getByRole("list", { name: "Comment attachments" })
        .getByRole("listitem")
        .filter({ hasText: name });
      await item.getByRole("button", { name, exact: true }).click();
      const preview = page.getByRole("dialog", { name });
      await preview.waitFor();
      await preview.getByRole("button", { name: "File to Contract" }).click();
      const dialog = page.getByRole("dialog", { name: "File attachment" });
      await dialog
        .getByLabel("Destination")
        .selectOption({ label: "New Version on an existing Document" });
      await dialog.getByLabel("Document", { exact: true }).selectOption({ label: newName });
      await dialog.getByLabel("Note").fill("DOC-029 filed round note");
      await dialog.getByRole("button", { name: "File", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 20000 });
      await item.getByText(/Filed to/).waitFor();
      const doc = await getDoc(page, recUrl, first.id);
      const last = doc.versions.reduce((a, b) => (a.versionNumber > b.versionNumber ? a : b));
      expect(
        last.note === "DOC-029 filed round note" && last.originalFilename === name,
        `last ${JSON.stringify(last).slice(0, 150)}`,
      );
      const filedText = (await item.innerText()).replace(/\s+/g, " ");
      return `Selecting the attachment name opened its preview with Download and File to Contract. Choosing New Version on an existing Document, Document "${newName}" and a Note appended v${last.versionNumber} with that note; the comment read "${filedText.match(/Filed to[^]*$/)?.[0]}".`;
    },
  );

  await step(
    A,
    S,
    role,
    "File a Matter conversation attachment: File to Matter, no Kind, same Confidential switch label",
    "The Matter offers File to Matter without Kind; filing creates a Matter Document",
    async () => {
      const m = (await api(page, "GET", `/matters/${matter.number}`)).body.matter;
      const c = await api(page, "POST", "/comments", undefined, {
        entityType: "matter",
        entityId: m.id,
        body: `DOC-029r2 ${label} matter attachment`,
        visibility: "working_team",
        file: part("doc029-services-text.pdf", `doc029-${label.toLowerCase()}-matter.pdf`),
      });
      expect(c.status === 201, `fixture matter comment ${c.status}`);
      await openDocumentsTab(page, `/matters/${matter.number}/documents`);
      await openComments();
      const name = `doc029-${label.toLowerCase()}-matter.pdf`;
      const item = page
        .getByRole("list", { name: "Comment attachments" })
        .getByRole("listitem")
        .filter({ hasText: name });
      await item.getByRole("button", { name: "File to Matter" }).click();
      const dialog = page.getByRole("dialog", { name: "File attachment" });
      const kinds = await dialog.getByLabel("Kind", { exact: true }).count();
      const switchLabel = await dialog
        .getByRole("switch")
        .getAttribute("aria-label")
        .catch(() => null);
      const labelText = (await dialog.innerText()).match(
        /Confidential — restrict to the [a-z ]+team/,
      )?.[0];
      await dialog.getByLabel("Document name").fill(`DOC-029r2 ${label} matter filed ${stamp}`);
      await dialog.getByRole("button", { name: "File", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 20000 });
      const docs = await recordDocs(page, `/matters/${matter.number}`);
      expect(
        kinds === 0 && docs.some((d) => d.title === `DOC-029r2 ${label} matter filed ${stamp}`),
        `kinds ${kinds}`,
      );
      expect(
        labelText === "Confidential — restrict to the contract team",
        `switch label "${labelText ?? switchLabel}"`,
      );
      return `The Matter attachment offered File to Matter. File attachment had no Kind control and the switch read "${labelText}". File created the Matter Document.`;
    },
  );

  await close_(context);
  return { contract, matter, newName };
}

// =====================================================================
// document-folders (V-C27)
// =====================================================================
function makeTree() {
  const base = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "doc029-tree-"));
  const top = path.join(base, `doc029-tree-${stamp}`);
  fs.mkdirSync(path.join(top, "sub-a"), { recursive: true });
  fs.mkdirSync(path.join(top, "empty-dir"), { recursive: true });
  fs.writeFileSync(path.join(top, "doc029-top.txt"), "Fictional top file.\n");
  fs.writeFileSync(path.join(top, "sub-a", "doc029-nested.txt"), "Fictional nested file.\n");
  return { base, top, name: path.basename(top) };
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

async function folders(role, person) {
  const A = "document-folders";
  const S = "V-C27";
  const label = role === "administrator" ? "Admin" : "Legal";
  const { context, page } = await staffContext(person);
  currentPage = page;
  const contract = await createContract(
    page,
    role,
    `DOC-029r2 documents ${label} folders Contract ${stamp}`,
  );
  const recUrl = `/contracts/${contract.number}`;
  const parent = `DOC-029r2 ${label} Parent`;
  const child = `DOC-029r2 ${label} Child`;
  const other = `DOC-029r2 ${label} Other`;
  const loose = await uploadApi(page, `${recUrl}/documents`, "doc029-bulk-a.txt", {
    as: `doc029-${label.toLowerCase()}-loose-a.txt`,
  });
  const loose2 = await uploadApi(page, `${recUrl}/documents`, "doc029-bulk-b.txt", {
    as: `doc029-${label.toLowerCase()}-loose-b.txt`,
  });

  await step(
    A,
    S,
    role,
    "Create and maintain folders steps 1-2: New folder, Name, Save; an empty folder has no expand control",
    "The folder row appears without an expand control",
    async () => {
      await openDocumentsTab(page, `${recUrl}/documents`);
      await docsSection(page).getByRole("button", { name: "New folder" }).click();
      const dialog = await nameDialog(page, "New folder", parent);
      await dialog.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: `Actions for the ${parent} folder` }).waitFor();
      const expand = await page.getByRole("button", { name: `Expand ${parent}` }).count();
      const rowText = await page
        .getByRole("row")
        .filter({ has: page.getByRole("button", { name: `Actions for the ${parent} folder` }) })
        .innerText();
      expect(expand === 0, "empty folder shows an expand control");
      return `New folder opened a dialog with Name and Save. The "${parent}" row appeared reading "${rowText.replace(/\s+/g, " ").trim()}" with no expand control.`;
    },
  );

  await step(
    A,
    S,
    role,
    "Create and maintain folders step 3: New subfolder and Rename from Actions for the … folder",
    "The subfolder is created inside; the parent gains an expand control; Rename changes the name",
    async () => {
      await folderMenu(page, parent, "New subfolder");
      let dialog = await nameDialog(page, `New folder in ${parent}`, `${child} draft`);
      await dialog.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: `Actions for the ${child} draft folder` }).waitFor();
      const collapse = await page.getByRole("button", { name: `Collapse ${parent}` }).count();
      await folderMenu(page, `${child} draft`, "Rename");
      dialog = await nameDialog(page, "Rename folder", child);
      await dialog.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: `Actions for the ${child} folder` }).waitFor();
      const list = await folderList(page, recUrl);
      const c = list.find((f) => f.name === child);
      const p = list.find((f) => f.name === parent);
      expect(
        c && p && c.parentId === p.id && collapse === 1,
        `child ${!!c} parent link ${c?.parentId === p?.id} collapse ${collapse}`,
      );
      return `New subfolder opened "New folder in ${parent}"; the child appeared under the now-open parent (Collapse ${parent} control present). Rename folder changed "${child} draft" to "${child}". Read-back: the child's parent is ${parent}.`;
    },
  );

  await step(
    A,
    S,
    role,
    "Folder name rules: case-only duplicate sibling, blank name, slash, '.' and '..' are refused",
    "Each attempt shows a refusal and creates nothing",
    async () => {
      const before = (await folderList(page, recUrl)).length;
      const seen = [];
      for (const name of [parent.toUpperCase(), "   ", "DOC-029 a/b", ".", ".."]) {
        await docsSection(page).getByRole("button", { name: "New folder" }).click();
        const dialog = await nameDialog(page, "New folder", name);
        const alert = dialog.getByRole("alert");
        await alert.waitFor({ timeout: 10000 });
        seen.push(`${JSON.stringify(name)}: ${(await alert.innerText()).trim()}`);
        await dialog.getByRole("button", { name: "Cancel" }).click();
        await dialog.waitFor({ state: "hidden" });
      }
      const after = (await folderList(page, recUrl)).length;
      expect(after === before, `folders ${before} -> ${after}`);
      return `All five names were refused in the dialog and no folder was created. ${seen.join("; ")}.`;
    },
  );

  await step(
    A,
    S,
    role,
    "Create and maintain folders step 3: Move, Move into, None; a folder cannot move into itself or a descendant",
    "Move into omits the folder and its descendant, the seam refuses a cycle, and None returns a folder to the top level",
    async () => {
      await docsSection(page).getByRole("button", { name: "New folder" }).click();
      (await nameDialog(page, "New folder", other)).waitFor({ state: "hidden" });
      await page.getByRole("button", { name: `Actions for the ${other} folder` }).waitFor();
      await folderMenu(page, parent, "Move");
      let dialog = page.getByRole("dialog", { name: `Move ${parent}` });
      const options = (await dialog.getByLabel("Move into").locator("option").allInnerTexts()).map(
        (t) => t.trim(),
      );
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
      const moved = list.find((f) => f.name === child);
      const underOther = folderPath(list, moved) === `${other}/${child}`;
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
      return `Move into for "${parent}" offered ${options.join(", ")}: not the folder itself or its child. The seam refused a move into its own child (${cycle.status}: ${String(cycle.body?.detail ?? "").slice(0, 80)}) and into itself (${self.status}). Moving "${child}" into "${other}" read back as ${other}/${child}; Move into None put it at the top level.`;
    },
  );

  await step(
    A,
    S,
    role,
    "Create and maintain folders step 4: Move to folder, File in, Move; None moves it out",
    "The Document is filed in the folder and then moved back to the record",
    async () => {
      await openDocumentsTab(page, `${recUrl}/documents`);
      await chooseMenu(page, loose.title, "Move to folder");
      let dialog = page.getByRole("dialog", { name: `Move ${loose.title}` });
      await dialog.getByLabel("File in").selectOption({ label: parent });
      await dialog.getByRole("button", { name: "Move", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      let list = await folderList(page, recUrl);
      const p = list.find((f) => f.name === parent);
      let doc = await getDoc(page, recUrl, loose.id);
      const filed = doc.folderId === p.id || doc.folder?.id === p.id;
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
      const out = !(doc.folderId ?? doc.folder?.id);
      expect(filed && out, `filed ${filed} out ${out} ${JSON.stringify(doc).slice(0, 160)}`);
      return `Move to folder opened "Move ${loose.title}" with File in; choosing "${parent}" filed the Document there and the folder gained an expand control showing it. File in None moved it back onto the record.`;
    },
  );

  await step(
    A,
    S,
    role,
    "Create and maintain folders step 4: drag a Document row onto a folder row, then onto Drop here to move out of folders",
    "Dragging files the Document into the folder and back out",
    async () => {
      await openDocumentsTab(page, `${recUrl}/documents`);
      const row = page.getByRole("row").filter({
        has: page.getByRole("button", { name: `Actions for ${loose2.title}`, exact: true }),
      });
      const folderRow = page
        .getByRole("row")
        .filter({ has: page.getByRole("button", { name: `Actions for the ${other} folder` }) });
      await dragMouse(page, row, folderRow);
      const p = (await folderList(page, recUrl)).find((f) => f.name === other);
      let doc;
      for (let i = 0; i < 20; i++) {
        doc = await getDoc(page, recUrl, loose2.id);
        if ((doc.folderId ?? doc.folder?.id) === p.id) break;
        await sleep(250);
      }
      const inFolder = (doc.folderId ?? doc.folder?.id) === p.id;
      expect(inFolder, "drag onto folder row did not file the Document");
      await openDocumentsTab(page, `${recUrl}/documents`);
      await page.getByRole("button", { name: `Expand ${other}` }).click();
      const inner = page.getByRole("row").filter({
        has: page.getByRole("button", { name: `Actions for ${loose2.title}`, exact: true }),
      });
      await inner.waitFor();
      const target = page.getByText("Drop here to move out of folders");
      await dragMouse(page, inner, target, { revealTarget: target });
      for (let i = 0; i < 20; i++) {
        doc = await getDoc(page, recUrl, loose2.id);
        if (!(doc.folderId ?? doc.folder?.id)) break;
        await sleep(250);
      }
      expect(!(doc.folderId ?? doc.folder?.id), "drop target did not move the Document out");
      return `Dragging the "${loose2.title}" row onto the "${other}" folder row filed it there (read-back). Dragging it from inside the folder showed "Drop here to move out of folders"; dropping on it moved the Document back to the record.`;
    },
  );

  await step(
    A,
    S,
    role,
    "Create and maintain folders step 4: select checkboxes and Move in the selection bar",
    "Both selected Documents move into the chosen folder",
    async () => {
      await openDocumentsTab(page, `${recUrl}/documents`);
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
        docs.every((d) => (d.folderId ?? d.folder?.id) === p.id),
        "bulk move did not file both",
      );
      return `Selecting both checkboxes showed "2 selected" with Move. The Move 2 documents dialog with File in "${parent}" filed both Documents there (read-back).`;
    },
  );

  await step(
    A,
    S,
    role,
    "Folder Delete dissolves the folder: contents move to its parent or the record, nothing is deleted",
    "The confirmation says where contents go; the Documents stay live on the record",
    async () => {
      await openDocumentsTab(page, `${recUrl}/documents`);
      await folderMenu(page, parent, "Delete");
      const dialog = page.getByRole("dialog", { name: `Delete the ${parent} folder?` });
      const text = (await dialog.innerText()).replace(/\s+/g, " ");
      await dialog.getByRole("button", { name: "Delete", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      const list = await folderList(page, recUrl);
      const docs = await recordDocs(page, recUrl);
      const both = [loose.id, loose2.id].every((id) =>
        docs.some((d) => d.id === id && !(d.folderId ?? d.folder?.id)),
      );
      expect(
        !list.some((f) => f.name === parent) && both && /Nothing is deleted/.test(text),
        `text ${text}`,
      );
      return `The confirmation read "${text.trim()}". After Delete the folder was gone and both Documents were live at the record root.`;
    },
  );

  await step(
    A,
    S,
    role,
    "Import several files steps 1-5 with a partial failure: Destination Record root, Version kind, counts, Retry",
    "The good files stay as v1 Documents, the failed row is named with Retry, and Retry sends only the failed file",
    async () => {
      await openDocumentsTab(page, `${recUrl}/documents`);
      const names = ["doc029-bulk-a.txt", "doc029-bulk-b.txt", "doc029-bulk-c.txt"];
      let failOnce = true;
      await page.route(`**/api/v1/contracts/${contract.number}/documents`, async (route) => {
        const body = route.request().postDataBuffer()?.toString("latin1") ?? "";
        if (
          route.request().method() === "POST" &&
          failOnce &&
          body.includes('filename="doc029-bulk-c.txt"')
        ) {
          failOnce = false;
          return route.fulfill({
            status: 503,
            contentType: "application/problem+json",
            body: JSON.stringify({
              type: "about:blank",
              title: "Service Unavailable",
              status: 503,
              detail: "DOC-029 fixture: the upload service is unavailable.",
            }),
          });
        }
        return route.continue();
      });
      const before = (await recordDocs(page, recUrl)).length;
      await docsSection(page).getByRole("button", { name: "Upload", exact: true }).click();
      const composer = page.getByRole("dialog", { name: "Upload document" });
      await chooseFiles(
        page,
        composer.getByRole("button", { name: /Choose files/ }),
        names.map(fixture),
      );
      const dialog = page.getByRole("dialog", { name: "Import 3 files" });
      await dialog.waitFor();
      const confirmText = (await dialog.innerText()).replace(/\s+/g, " ");
      await dialog.getByLabel("Version kind").selectOption({ label: "Draft · theirs" });
      await dialog.getByRole("button", { name: "Import 3 files" }).click();
      const settled = page.getByRole("dialog", { name: "Imported 2 of 3 files" });
      await settled.waitFor({ timeout: 30000 });
      const settledText = (await settled.innerText()).replace(/\s+/g, " ");
      if (role === "legal_team_member") await shot(page, "r1-legal-partial-import.png");
      const retryRow = await settled
        .getByRole("button", { name: "Retry doc029-bulk-c.txt" })
        .count();
      const retryAll = await settled.getByRole("button", { name: "Retry 1 file" }).count();
      const mid = await recordDocs(page, recUrl);
      const landed = mid.filter(
        (d) =>
          d.versions[0]?.originalFilename?.startsWith("doc029-bulk-") &&
          (d.title.includes("bulk-a") || d.title.includes("bulk-b")),
      );
      await settled.getByRole("button", { name: "Retry doc029-bulk-c.txt" }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 30000 });
      await page.unroute(`**/api/v1/contracts/${contract.number}/documents`);
      const after = await recordDocs(page, recUrl);
      const added = after.length - before;
      expect(
        /Destination/.test(confirmText) &&
          /Record root/.test(confirmText) &&
          /Applied to every file in this import\. Notes are not collected in bulk\./.test(
            confirmText,
          ),
        `confirm ${confirmText}`,
      );
      expect(
        retryRow === 1 &&
          retryAll === 1 &&
          added === 3 &&
          landed.every((d) => d.versions.length === 1 && d.versions[0].kind === "draft_theirs"),
        `retry ${retryRow}/${retryAll} added ${added}`,
      );
      return `Choose files with three files opened "Import 3 files" showing Destination Record root and Version kind ("Applied to every file in this import. Notes are not collected in bulk."). With a browser-network fixture answering 503 once for one file, the dialog read "${settledText.slice(0, 260)}" with a row Retry and Retry 1 file. The two good files were already v1 Documents (Draft · theirs). Row Retry sent only the failed file and the dialog closed; the record gained exactly 3 Documents.`;
    },
  );

  await step(
    A,
    S,
    role,
    "Recover a partial import: a size refusal is not offered a retry; Done closes",
    "The failed row has no Retry, and the good file remains",
    async () => {
      await page.route(`**/api/v1/contracts/${contract.number}/documents`, async (route) => {
        const body = route.request().postDataBuffer()?.toString("latin1") ?? "";
        if (route.request().method() === "POST" && body.includes('filename="doc029-bulk-d.txt"')) {
          return route.fulfill({
            status: 413,
            contentType: "application/problem+json",
            body: JSON.stringify({
              type: "about:blank",
              title: "Payload Too Large",
              status: 413,
              detail: "DOC-029 fixture: this file is larger than the upload limit.",
            }),
          });
        }
        return route.continue();
      });
      const before = (await recordDocs(page, recUrl)).length;
      await docsSection(page).getByRole("button", { name: "Upload", exact: true }).click();
      const composer = page.getByRole("dialog", { name: "Upload document" });
      await chooseFiles(page, composer.getByRole("button", { name: /Choose files/ }), [
        fixture("doc029-bulk-a.txt"),
        fixture("doc029-bulk-d.txt"),
      ]);
      await page
        .getByRole("dialog", { name: "Import 2 files" })
        .getByRole("button", { name: "Import 2 files" })
        .click();
      const settled = page.getByRole("dialog", { name: "Imported 1 of 2 files" });
      await settled.waitFor({ timeout: 30000 });
      const retry = await settled.getByRole("button", { name: /^Retry/ }).count();
      const text = (await settled.innerText()).replace(/\s+/g, " ");
      await settled.getByRole("button", { name: "Done" }).click();
      await settled.waitFor({ state: "hidden" });
      await page.unroute(`**/api/v1/contracts/${contract.number}/documents`);
      const after = (await recordDocs(page, recUrl)).length;
      expect(retry === 0 && after === before + 1, `retry ${retry} added ${after - before}`);
      return `With a fixture answering 413 for one file, the dialog read "${text.slice(0, 220)}" and offered no Retry control. Done closed it; the other file was on the record.`;
    },
  );

  await step(
    A,
    S,
    role,
    "Import step 5: when every file uploads the dialog closes after the list refreshes",
    "The dialog closes by itself and both files are listed",
    async () => {
      const before = (await recordDocs(page, recUrl)).length;
      await docsSection(page).getByRole("button", { name: "Upload", exact: true }).click();
      const composer = page.getByRole("dialog", { name: "Upload document" });
      await chooseFiles(page, composer.getByRole("button", { name: /Choose files/ }), [
        fixture("doc029-bulk-c.txt"),
        fixture("doc029-bulk-d.txt"),
      ]);
      const dialog = page.getByRole("dialog", { name: "Import 2 files" });
      await dialog.getByRole("button", { name: "Import 2 files" }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 30000 });
      const after = (await recordDocs(page, recUrl)).length;
      expect(after === before + 2, `added ${after - before}`);
      return "A two-file import with no failure closed the dialog by itself; the record gained two Documents.";
    },
  );

  await step(
    A,
    S,
    role,
    "Recover a partial import: Cancel remaining stops queued work and uploaded files remain",
    "Queued files are cancelled; the finished uploads stay on the record; final counts are shown",
    async () => {
      await page.route(`**/api/v1/contracts/${contract.number}/documents`, async (route) => {
        if (route.request().method() === "POST") await sleep(4000);
        return route.continue();
      });
      const before = (await recordDocs(page, recUrl)).length;
      await docsSection(page).getByRole("button", { name: "Upload", exact: true }).click();
      const composer = page.getByRole("dialog", { name: "Upload document" });
      const files = [
        "doc029-bulk-a.txt",
        "doc029-bulk-b.txt",
        "doc029-bulk-c.txt",
        "doc029-bulk-d.txt",
        "doc029-schedule.csv",
      ];
      await chooseFiles(
        page,
        composer.getByRole("button", { name: /Choose files/ }),
        files.map(fixture),
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
      const title = await settled
        .getByRole("heading")
        .first()
        .innerText()
        .catch(async () => (await settled.innerText()).split("\n")[0]);
      const text = (await settled.innerText()).replace(/\s+/g, " ");
      const cancelled = (text.match(/Cancelled before it was uploaded\./g) ?? []).length;
      await settled.getByRole("button", { name: "Done" }).click();
      await page.unroute(`**/api/v1/contracts/${contract.number}/documents`);
      const after = (await recordDocs(page, recUrl)).length;
      const landed = Number(text.match(/Imported (\d) of 5 files/)?.[1]);
      expect(
        cancelled > 0 && after - before === landed && keepOpen === 1,
        `cancelled ${cancelled} landed ${landed} added ${after - before}`,
      );
      return `With uploads slowed by a fixture, the running dialog said "Keep this dialog open until the import finishes." Cancel remaining settled it at "${title.trim()}": ${cancelled} file(s) read "Cancelled before it was uploaded." and the ${landed} uploaded file(s) were on the record (read-back +${after - before}).`;
    },
  );

  let tree;
  await step(
    A,
    S,
    role,
    "Keep a local folder structure: Choose folder keeps nested paths; the folder picker drops empty folders; a matching path is reused",
    "The top-level folder and its nested child are created with their files; the empty folder is not; a second import reuses the path",
    async () => {
      tree = makeTree();
      await openDocumentsTab(page, `${recUrl}/documents`);
      await docsSection(page).getByRole("button", { name: "Upload", exact: true }).click();
      const composer = page.getByRole("dialog", { name: "Upload document" });
      await chooseFiles(page, composer.getByRole("button", { name: /Choose folder/ }), tree.top);
      const dialog = page.getByRole("dialog", { name: "Import 2 files" });
      await dialog.waitFor();
      const text = (await dialog.innerText()).replace(/\s+/g, " ");
      await dialog.getByRole("button", { name: "Import 2 files" }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 30000 });
      let list = await folderList(page, recUrl);
      const paths = list.map((f) => folderPath(list, f));
      const top = list.filter((f) => f.name === tree.name);
      const nested = paths.includes(`${tree.name}/sub-a`);
      const empty = paths.includes(`${tree.name}/empty-dir`);
      await docsSection(page).getByRole("button", { name: "Upload", exact: true }).click();
      await chooseFiles(
        page,
        page
          .getByRole("dialog", { name: "Upload document" })
          .getByRole("button", { name: /Choose folder/ }),
        tree.top,
      );
      const again = page.getByRole("dialog", { name: "Import 2 files" });
      await again.getByRole("button", { name: "Import 2 files" }).click();
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
      return `Choose folder on a local tree (two files, one nested folder, one empty folder) opened "Import 2 files" reading "${text.slice(0, 200)}". The import created ${tree.name} and ${tree.name}/sub-a with the files; the empty folder was not created. Importing the same tree again reused the existing ${tree.name} folder (still one).`;
    },
  );

  await step(
    A,
    S,
    role,
    "Import step 1-2 and Keep structure: drop files and a local folder on a folder row; the Destination is that folder; a dropped tree recreates empty folders",
    "The Import dialog names the folder as Destination and the empty folder is recreated",
    async () => {
      await openDocumentsTab(page, `${recUrl}/documents`);
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
      const text = (await dialog.innerText()).replace(/\s+/g, " ");
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
      return `Dropping the local tree on the "${other}" row opened a dialog reading "${text.slice(0, 200)}". The import created ${other}/${tree.name}/sub-a and the empty ${other}/${tree.name}/empty-dir.`;
    },
  );

  await step(
    A,
    S,
    role,
    "Import step 3: a Matter import has no Version kind control",
    "The Matter batch dialog shows Destination but no Version kind",
    async () => {
      const matter = await createMatter(
        page,
        role,
        `DOC-029r2 documents ${label} folders Matter ${stamp}`,
      );
      await openDocumentsTab(page, `/matters/${matter.number}/documents`);
      await docsSection(page).getByRole("button", { name: "Upload", exact: true }).click();
      await chooseFiles(
        page,
        page
          .getByRole("dialog", { name: "Upload document" })
          .getByRole("button", { name: /Choose files/ }),
        [fixture("doc029-bulk-a.txt"), fixture("doc029-bulk-b.txt")],
      );
      const dialog = page.getByRole("dialog", { name: "Import 2 files" });
      await dialog.waitFor();
      const kind = await dialog.getByLabel("Version kind").count();
      const dest = await dialog.getByText("Destination").count();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      expect(kind === 0 && dest === 1, `kind ${kind}`);
      return "On a Matter, Choose files with two files opened Import 2 files with Destination Record root and no Version kind control.";
    },
  );

  if (tree) fs.rmSync(tree.base, { recursive: true, force: true });
  await close_(context);
}

// =====================================================================
// document-previews (V-C28), staff roles
// =====================================================================
async function waitText(page, docId, versionId, want, timeoutMs = 240000) {
  const until = Date.now() + timeoutMs;
  let last;
  while (Date.now() < until) {
    last = await api(page, "GET", `/documents/${docId}/versions/${versionId}/text`);
    const state = last.body?.text?.state ?? last.body?.state;
    if (state && state !== "pending" && (!want || state === want)) return last.body;
    await sleep(3000);
  }
  return last?.body;
}
async function waitRendition(page, docId, versionId, timeoutMs = 240000) {
  const until = Date.now() + timeoutMs;
  let state;
  while (Date.now() < until) {
    const r = await api(page, "GET", `/documents/${docId}/versions/${versionId}/rendition`);
    state = r.body?.rendition?.state;
    if (state && state !== "pending") return state;
    await sleep(3000);
  }
  return state;
}
async function openReader(page, title, version) {
  await page.getByRole("button", { name: title, exact: true }).first().click();
  const panel = page.getByRole("complementary", { name: `${title}, version ${version}` });
  await panel.waitFor({ timeout: 30000 });
  return panel;
}

async function previews(role, person) {
  const A = "document-previews";
  const S = "V-C28";
  const label = role === "administrator" ? "Admin" : "Legal";
  const { context, page } = await staffContext(person);
  const remote = [];
  page.on("request", (req) => {
    if (req.url().includes("remote-images.invalid")) remote.push(req.url());
  });
  const contract = await createContract(
    page,
    role,
    `DOC-029r2 documents ${label} previews Contract ${stamp}`,
  );
  const recUrl = `/contracts/${contract.number}`;
  const up = (name, kind = "draft_ours") =>
    uploadApi(page, `${recUrl}/documents`, name, { kind, as: `${label.toLowerCase()}-${name}` });
  const pdf = await up("doc029-services-text.pdf");
  const docx = await up("doc029-draft-v1.docx");
  const pptx = await up("doc029-deck.pptx");
  const scan = await up("doc029-scan.pdf");
  const png = await up("doc029-stamp.png");
  const eml = await up("doc029-message.eml");
  const csv = await up("doc029-schedule.csv");
  const zip = await up("doc029-bundle.zip");
  const broken = await up("doc029-broken.docx");
  const current = (d) => d.versions.find((v) => v.isCurrent) ?? d.versions.at(-1);

  await step(
    A,
    S,
    role,
    "Read a managed Document steps 1-4 (PDF): name opens the reader; v… indicator; Previous page, Next page, Zoom out, Zoom in, Find in document; Download; Close the document",
    "The reader shows the title and v1, the PDF controls work, Download returns the original bytes, and Close returns to the record",
    async () => {
      await openDocumentsTab(page, `${recUrl}/documents`);
      const panel = await openReader(page, pdf.title, 1);
      await panel.getByText("v1", { exact: true }).waitFor();
      await panel.getByText("Page 1 of 2").waitFor({ timeout: 30000 });
      for (const name of [
        "Previous page",
        "Next page",
        "Zoom out",
        "Zoom in",
        "Find in document",
      ]) {
        await panel.getByRole("button", { name, exact: true }).waitFor();
      }
      await panel.getByRole("button", { name: "Next page", exact: true }).click();
      await panel.getByText("Page 2 of 2").waitFor();
      await panel.getByRole("button", { name: "Previous page", exact: true }).click();
      await panel.getByText("Page 1 of 2").waitFor();
      await panel.getByRole("button", { name: "Zoom in", exact: true }).click();
      await panel.getByRole("button", { name: "Zoom out", exact: true }).click();
      await panel.getByRole("button", { name: "Find in document", exact: true }).click();
      await panel.locator('input[aria-label="Find in document"]').fill("Quillfeather");
      const count = panel.getByText(/^[1-9]\d* of [1-9]\d*$/);
      await count.waitFor({ timeout: 15000 });
      const found = await count.innerText();
      await page.keyboard.press("Escape").catch(() => {});
      const dl = await download(page, () => panel.getByRole("link", { name: "Download" }).click());
      expect(dl.sha256 === fixtureHash("doc029-services-text.pdf"), "pdf bytes differ");
      const stillOpen = await panel.isVisible();
      if (!stillOpen) await openReader(page, pdf.title, 1);
      await page.getByRole("button", { name: "Close the document" }).click();
      await page
        .getByRole("complementary", { name: `${pdf.title}, version 1` })
        .waitFor({ state: "hidden" });
      return `Selecting "${pdf.title}" opened the reader "${pdf.title}, version 1" with the v1 chip and Page 1 of 2. Previous page, Next page, Zoom out, Zoom in and Find in document were present; Next page reached Page 2 of 2 and Previous page returned. Find for a word in the text layer read "${found}". Download returned the uploaded bytes (SHA-256 match). Close the document closed the reader.`;
    },
  );

  await step(
    A,
    S,
    role,
    "Supported reading surfaces: Word and PowerPoint render as a PDF rendition; Download stays the uploaded file; a preview is not a new Version",
    "Both open in the PDF reader after preparation and download the original bytes; the chain stays at one Version",
    async () => {
      const out = [];
      for (const [doc, name] of [
        [docx, "doc029-draft-v1.docx"],
        [pptx, "doc029-deck.pptx"],
      ]) {
        const state = await waitRendition(page, doc.id, current(doc).id);
        await openDocumentsTab(page, `${recUrl}/documents`);
        const panel = await openReader(page, doc.title, 1);
        await panel.getByText(/^Page 1 of \d+$/).waitFor({ timeout: 60000 });
        const dl = await download(page, () =>
          panel.getByRole("link", { name: "Download" }).click(),
        );
        expect(dl.sha256 === fixtureHash(name), `${name} bytes differ`);
        const fresh = await getDoc(page, recUrl, doc.id);
        expect(fresh.versions.length === 1, "preview added a Version");
        await panel.getByRole("button", { name: "Close the document" }).click();
        out.push(
          `${doc.title}: rendition ${state}, PDF reader pages shown, download matched the uploaded file`,
        );
      }
      return `${out.join("; ")}. Each chain still had one Version.`;
    },
  );

  await step(
    A,
    S,
    role,
    "Processing, scans: an image-only PDF stays a scan; Find has no match; OCR text arrives in the background; global search finds it",
    "Reader Find reports no match, text read-back source is OCR, and global search lists the Document",
    async () => {
      const text = await waitText(page, scan.id, current(scan).id, "ready");
      const words = JSON.stringify(text);
      expect(/Marrowbridge/i.test(words) && /ocr/i.test(words), `text ${words.slice(0, 200)}`);
      await openDocumentsTab(page, `${recUrl}/documents`);
      const panel = await openReader(page, scan.title, 1);
      await panel.getByText("Page 1 of 1").waitFor({ timeout: 30000 });
      await panel.getByRole("button", { name: "Find in document", exact: true }).click();
      await panel.locator('input[aria-label="Find in document"]').fill("Marrowbridge");
      await panel.getByText("No matches").waitFor({ timeout: 15000 });
      await panel.getByRole("button", { name: "Close the document" }).click();
      await page.goto(`${BASE}/search?q=Marrowbridge`);
      const hit = page.getByRole("main").getByText(scan.title);
      await hit.first().waitFor({ timeout: 60000 });
      return `The scan opened as Page 1 of 1 in the reader and Find in document for "Marrowbridge" read "No matches". The text read-back became ready from source ocr and contained the word. Global search for "Marrowbridge" listed "${scan.title}".`;
    },
  );

  await step(
    A,
    S,
    role,
    "Supported reading surfaces: PNG shows inline; EML shows headers, body and attachment list without remote images; a PDF attachment previews; a Word attachment downloads",
    "Image inline; email headers and 2 attachments; no remote image request; PDF attachment opens; DOCX attachment is a download",
    async () => {
      await openDocumentsTab(page, `${recUrl}/documents`);
      let panel = await openReader(page, png.title, 1);
      await panel.locator("img").first().waitFor({ timeout: 30000 });
      await panel.getByRole("button", { name: "Close the document" }).click();
      panel = await openReader(page, eml.title, 1);
      await panel
        .getByText("DOC-029 fictional counterparty email")
        .first()
        .waitFor({ timeout: 30000 });
      const body = (await panel.innerText()).replace(/\s+/g, " ");
      const frame = panel.frameLocator('iframe[title="Message body"]');
      await frame
        .getByText("Please find the fictional drafts attached.")
        .waitFor({ timeout: 15000 });
      const remoteImg = await frame
        .locator("img")
        .evaluateAll((els) => els.map((e) => e.getAttribute("src") ?? "").join(","));
      expect(
        /From/.test(body) && /To/.test(body) && /Subject/.test(body) && /2 attachments/.test(body),
        `email ${body.slice(0, 300)}`,
      );
      const docxChip = panel.getByRole("link", { name: /doc029-attached\.docx/ });
      const docxDownload = await download(page, () => docxChip.click());
      await panel.getByRole("button", { name: /doc029-attached\.pdf/ }).click();
      await panel.getByRole("button", { name: "Back to the message" }).waitFor({ timeout: 30000 });
      await panel.getByText(/^Page 1 of \d+$/).waitFor({ timeout: 30000 });
      await panel.getByRole("button", { name: "Back to the message" }).click();
      await panel.getByRole("button", { name: "Close the document" }).click();
      expect(
        remote.length === 0 && docxDownload.sha256 === fixtureHash("doc029-draft-v1.docx"),
        `remote ${remote.length}`,
      );
      return `The PNG drew as an inline image. The EML reader showed From, To, Subject, Date, the sandboxed "Message body" text and "2 attachments"; the body's remote image (src "${remoteImg.slice(0, 60)}") made no request to the remote host. The PDF attachment opened in a preview with "Back to the message"; the Word attachment was a download link and returned its bytes. Reading the email created no new Documents.`;
    },
  );

  await step(
    A,
    S,
    role,
    "Supported reading surfaces: other formats download from the name; a reader link shows the download-only card",
    "CSV and ZIP names download directly; a reader link to one shows the card",
    async () => {
      await openDocumentsTab(page, `${recUrl}/documents`);
      const before = await page.getByRole("complementary").count();
      const a = await download(page, () =>
        page.getByRole("link", { name: csv.title, exact: true }).click(),
      );
      const b = await download(page, () =>
        page.getByRole("link", { name: zip.title, exact: true }).click(),
      );
      expect(
        a.sha256 === fixtureHash("doc029-schedule.csv") &&
          b.sha256 === fixtureHash("doc029-bundle.zip"),
        "download-only bytes differ",
      );
      const after = await page.getByRole("complementary").count();
      await page.goto(`${BASE}${recUrl}/documents?doc=${csv.id}&version=${current(csv).id}`);
      const card = page.getByText("This file type does not open here. Download it to read it.");
      await card.waitFor({ timeout: 30000 });
      return `Selecting "${csv.title}" and "${zip.title}" downloaded the original files (SHA-256 match) without opening a reader (${before} -> ${after} panels). Opening the CSV through a reader link showed "This file type does not open here. Download it to read it." with Download.`;
    },
  );

  await step(
    A,
    S,
    role,
    "Processing: Preparing this document for reading… while conversion is pending; the stored original is already downloadable",
    "The pending message shows and Download returns the uploaded file",
    async () => {
      const fresh = await up("doc029-draft-v2.docx");
      await page.route("**/api/v1/documents/*/versions/*/rendition", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ rendition: { state: "pending" } }),
        }),
      );
      await openDocumentsTab(page, `${recUrl}/documents`);
      const panel = await openReader(page, fresh.title, 1);
      await panel.getByText("Preparing this document for reading…").waitFor({ timeout: 20000 });
      const dl = await download(page, () => panel.getByRole("link", { name: "Download" }).click());
      await page.unroute("**/api/v1/documents/*/versions/*/rendition");
      await panel.getByRole("button", { name: "Close the document" }).click();
      expect(dl.sha256 === fixtureHash("doc029-draft-v2.docx"), "pending download bytes differ");
      return `With a browser-network fixture holding the rendition read at pending, the reader showed "Preparing this document for reading…" and Download returned the uploaded Word file (SHA-256 match).`;
    },
  );

  await step(
    A,
    S,
    role,
    "Failed previews: the failure message, Download of the original, and recovery by adding a readable Version",
    "A damaged Word file shows the failure card and downloads; a new Version renders while the failed Version stays in the chain",
    async () => {
      const state = await waitRendition(page, broken.id, current(broken).id);
      expect(state === "failed", `broken rendition state ${state}`);
      await openDocumentsTab(page, `${recUrl}/documents`);
      let panel = await openReader(page, broken.title, 1);
      await panel
        .getByText("This file could not be prepared for reading here. Download it to read it.")
        .waitFor({ timeout: 30000 });
      if (role === "legal_team_member") await shot(page, "r1-legal-failed-preview.png");
      const dl = await download(page, () =>
        panel.getByRole("link", { name: "Download" }).first().click(),
      );
      expect(dl.sha256 === fixtureHash("doc029-broken.docx"), "broken bytes differ");
      await panel.getByRole("button", { name: "Close the document" }).click();
      await chooseMenu(page, broken.title, "Add version");
      const dialog = page.getByRole("dialog", { name: "Add version" });
      await chooseFiles(
        page,
        dialog.getByRole("button", { name: /Choose file/ }),
        fixture("doc029-draft-v2.docx"),
      );
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      const doc = await getDoc(page, recUrl, broken.id);
      const v2 = doc.versions.find((v) => v.versionNumber === 2);
      const s2 = await waitRendition(page, broken.id, v2.id);
      await openDocumentsTab(page, `${recUrl}/documents`);
      panel = await openReader(page, broken.title, 2);
      await panel.getByText(/^Page 1 of \d+$/).waitFor({ timeout: 60000 });
      await page
        .getByRole("button", { name: `Show the 1 earlier version of ${broken.title}` })
        .click();
      await page
        .getByRole("button", { name: `${label.toLowerCase()}-doc029-broken.docx`, exact: true })
        .last()
        .click();
      const v1Panel = page.getByRole("complementary", { name: `${broken.title}, version 1` });
      await v1Panel
        .getByText("This file could not be prepared for reading here. Download it to read it.")
        .waitFor({ timeout: 30000 });
      await v1Panel.getByRole("button", { name: "Close the document" }).click();
      expect(s2 === "ready" && doc.versions.length === 2, `v2 ${s2}`);
      return `The malformed Word container reached rendition state failed. The reader showed "This file could not be prepared for reading here. Download it to read it." and Download returned the original bytes. Add version with a readable Word file made v2 (rendition ready), which opened in the PDF reader; expanding the chain and selecting the v1 filename still showed the failure card for v1.`;
    },
  );

  await close_(context);
  return { contract };
}

// =====================================================================
// document-previews (V-C28) Business User, plus Portal claims in the other articles
// =====================================================================
async function portal() {
  const role = "business_user";
  const A = "document-previews";
  const S = "V-C28";
  const { context: sc, page: staff } = await staffContext(PEOPLE.nadia);
  // Fixtures prepared by the Legal Team Member.
  const contract = await createContract(
    staff,
    "legal_team_member",
    `DOC-029r2 documents Portal Contract ${stamp}`,
  );
  const recUrl = `/contracts/${contract.number}`;
  await addTeam(staff, contract.number, PEOPLE.jonas.email);
  const chain = await uploadApi(staff, `${recUrl}/documents`, "doc029-services-text.pdf", {
    as: "portal-chain-v1.pdf",
    note: "Portal round one",
  });
  const chainV2 = await api(staff, "POST", `/documents/${chain.id}/versions`, undefined, {
    kind: "draft_theirs",
    file: part("doc029-draft-v2.docx", "portal-chain-v2.docx"),
  });
  expect(chainV2.status === 201, `fixture version ${chainV2.status}`);
  const gone = await uploadApi(staff, `${recUrl}/documents`, "doc029-bulk-a.txt", {
    as: "portal-archived.txt",
  });
  expect(
    (await api(staff, "POST", `/documents/${gone.id}/archive`, {})).status === 200,
    "fixture archive",
  );
  const contractId = (await api(staff, "GET", recUrl)).body.contract.id;
  for (const [name, as] of [
    ["doc029-services-text.pdf", "portal-thread.pdf"],
    ["doc029-draft-v1.docx", "portal-thread.docx"],
    ["doc029-bundle.zip", "portal-thread.zip"],
  ]) {
    const thread = await api(staff, "POST", "/comments", undefined, {
      entityType: "contract",
      entityId: contractId,
      body: `DOC-029r2 Portal thread file ${as}`,
      visibility: "full_thread",
      file: part(name, as),
    });
    expect(
      thread.status === 201,
      `fixture thread ${thread.status} ${JSON.stringify(thread.body).slice(0, 160)}`,
    );
  }
  const hidden = await createContract(
    staff,
    "legal_team_member",
    `DOC-029r2 documents Portal not on team ${stamp}`,
  );
  // Knowledge shared with the business.
  const kType = (await api(staff, "GET", "/knowledge?limit=1")).body.knowledgeItems?.[0]
    ?.knowledgeTypeId;
  const item = await api(staff, "POST", "/knowledge", {
    title: `DOC-029r2 documents Portal Knowledge ${stamp}`,
    knowledgeTypeId: kType,
  });
  expect(item.status === 201, `fixture knowledge ${item.status}`);
  const kid = item.body.knowledgeItem.id;
  record(
    "legal_team_member",
    "knowledge_item",
    `DOC-029r2 documents Portal Knowledge ${stamp}`,
    kid,
  );
  const kFirst = await uploadApi(staff, `/knowledge/${kid}/documents`, "doc029-bulk-b.txt", {
    as: "portal-knowledge-first.txt",
  });
  const kPrimary = await uploadApi(
    staff,
    `/knowledge/${kid}/documents`,
    "doc029-services-text.pdf",
    { as: "portal-knowledge-primary.pdf" },
  );
  const patch = await api(staff, "PATCH", `/knowledge/${kid}`, {
    audience: "everyone",
    primaryDocumentId: kPrimary.id,
    body: "DOC-029 fictional guidance.",
  });
  const pub = await api(staff, "POST", `/knowledge/${kid}/publish`, {});
  expect(
    patch.status === 200 && pub.status === 200,
    `fixture knowledge patch ${patch.status} publish ${pub.status}`,
  );

  const { context, page } = await portalContext(PEOPLE.jonas);
  currentPage = page;
  // The Business User's own Request with an attachment.
  const types = await api(page, "GET", "/portal/request-types");
  const legalQuestion =
    types.body.requestTypes.find((t) => t.slug === "legal_question") ?? types.body.requestTypes[0];
  const me = (await api(page, "GET", "/me")).body.user;
  const req = await api(page, "POST", "/requests", {
    requestTypeId: legalQuestion.id,
    departmentId: me.departmentId,
    title: `DOC-029r2 documents Portal request ${stamp}`,
    description: "DOC-029 fictional request.",
    urgency: "low",
  });
  expect(
    req.status === 201,
    `fixture request ${req.status} ${JSON.stringify(req.body).slice(0, 200)}`,
  );
  const reqNumber = req.body.request.number;
  record(role, "request", `DOC-029r2 documents Portal request ${stamp}`, `R-${reqNumber}`);
  const att = await api(page, "POST", `/requests/${reqNumber}/attachments`, undefined, {
    file: part("doc029-schedule.csv", "portal-request-attachment.csv"),
  });
  expect(att.status === 201, `fixture attachment ${att.status}`);

  const docs = (await api(page, "GET", `/portal/contracts/${contract.number}`)).body;
  const section = () => page.getByRole("region", { name: "Documents" });

  await step(
    A,
    S,
    role,
    "Read files in the Business Portal: Documents section, select a name to read the current Version, download beside it",
    "The reader opens the current Version and the download returns its bytes",
    async () => {
      await page.goto(`${BASE}/portal/contracts/${contract.number}`);
      await section(page).getByRole("heading", { name: "Documents" }).waitFor({ timeout: 30000 });
      await section().getByRole("button", { name: chain.title, exact: true }).click();
      const panel = page.getByRole("complementary", { name: `${chain.title}, version 2` });
      await panel.waitFor({ timeout: 30000 });
      await panel.getByText("v2", { exact: true }).waitFor();
      await panel.getByText(/^Page 1 of \d+$/).waitFor({ timeout: 90000 });
      await panel.getByRole("button", { name: "Close the document" }).click();
      const dl = await download(page, () =>
        section()
          .getByRole("link", { name: `Download ${chain.title}, version 2` })
          .click(),
      );
      expect(dl.sha256 === fixtureHash("doc029-draft-v2.docx"), "portal current download differs");
      return `On the Portal Contract, selecting "${chain.title}" opened the reader "${chain.title}, version 2" with the v2 chip and the converted pages. The download button beside it ("Download ${chain.title}, version 2") returned the uploaded Word bytes.`;
    },
  );

  await step(
    A,
    S,
    role,
    "Read files in the Business Portal: … earlier versions lists earlier Versions; a filename reads that Version",
    "The earlier Version opens in the reader and downloads",
    async () => {
      await section().getByRole("button", { name: "1 earlier version" }).click();
      await section()
        .locator("ol")
        .getByRole("button", { name: "portal-chain-v1.pdf", exact: true })
        .click();
      const panel = page.getByRole("complementary", { name: `${chain.title}, version 1` });
      await panel.waitFor({ timeout: 30000 });
      await panel.getByText(/^Page 1 of \d+$/).waitFor({ timeout: 30000 });
      await panel.getByRole("button", { name: "Close the document" }).click();
      const dl = await download(page, () =>
        section()
          .getByRole("link", { name: `Download ${chain.title}, version 1` })
          .click(),
      );
      expect(dl.sha256 === fixtureHash("doc029-services-text.pdf"), "portal v1 download differs");
      return `"1 earlier version" listed portal-chain-v1.pdf; selecting it opened "${chain.title}, version 1" in the reader, and its download returned the v1 bytes.`;
    },
  );

  await step(
    A,
    S,
    role,
    "Read files in the Business Portal: archived Documents and records outside your audience are not listed",
    "The archived Document is absent; a Contract without team membership is not found",
    async () => {
      const names = await section().getByRole("listitem").allInnerTexts();
      const archivedListed = names.some((t) => t.includes("portal-archived"));
      await page.goto(`${BASE}/portal/contracts/${hidden.number}`);
      await page.getByRole("heading", { name: "Contract not found" }).waitFor({ timeout: 20000 });
      const direct = await api(page, "GET", `/portal/contracts/${hidden.number}`);
      expect(
        !archivedListed && direct.status === 404,
        `archived listed ${archivedListed} direct ${direct.status}`,
      );
      return `The archived "${gone.title}" was not in the Portal Documents list. A Contract without the Business User on its team showed "Contract not found" (read ${direct.status}).`;
    },
  );

  await step(
    A,
    S,
    role,
    "Read files in the Business Portal: on your own Request, select a file under Attachments to download it",
    "The Request attachment downloads with its original bytes",
    async () => {
      await page.goto(`${BASE}/portal/requests/${reqNumber}`);
      const link = page.getByRole("link", { name: /portal-request-attachment\.csv/ });
      await link.first().waitFor({ timeout: 30000 });
      const dl = await download(page, () => link.first().click());
      expect(dl.sha256 === fixtureHash("doc029-schedule.csv"), "request attachment bytes differ");
      const reader = await page.getByRole("button", { name: "Close the document" }).count();
      return `On R-${reqNumber}, the Attachments file portal-request-attachment.csv downloaded with its original bytes; no Document reader opened (${reader} reader controls).`;
    },
  );

  await step(
    A,
    S,
    role,
    "Read files in the Business Portal: a comment attachment name opens its preview with Download; Preview unavailable appears for a file with no preview",
    "The PDF previews and downloads; a ZIP shows the unavailable message with Download; no filing action",
    async () => {
      await page.goto(`${BASE}/portal/contracts/${contract.number}`);
      await page
        .getByRole("toolbar", { name: "Applets" })
        .getByRole("button", { name: /^Comments/ })
        .click();
      const attachments = page.getByRole("list", { name: "Comment attachments" });
      await attachments.first().waitFor({ timeout: 20000 });
      const open = async (name) => {
        await page.getByRole("button", { name, exact: true }).click();
        const dialog = page.getByRole("dialog", { name });
        await dialog.waitFor();
        return dialog;
      };
      let dialog = await open("portal-thread.pdf");
      await dialog.getByText(/^Page 1 of \d+$/).waitFor({ timeout: 30000 });
      const pdfDl = await download(page, () =>
        dialog.getByRole("link", { name: "Download" }).click(),
      );
      const fileAction = await dialog.getByRole("button", { name: /^File to/ }).count();
      await dialog.getByRole("button", { name: "Close attachment preview" }).click();
      dialog = await open("portal-thread.docx");
      await dialog.getByText(/^Page 1 of \d+$/).waitFor({ timeout: 60000 });
      const docxDl = await download(page, () =>
        dialog.getByRole("link", { name: "Download" }).click(),
      );
      await dialog.getByRole("button", { name: "Close attachment preview" }).click();
      dialog = await open("portal-thread.zip");
      await dialog
        .getByText("Preview unavailable. You can download the original file.")
        .waitFor({ timeout: 30000 });
      await shot(page, "r1-business-portal-preview-unavailable.png");
      const zipDl = await download(page, () =>
        dialog.getByRole("link", { name: "Download" }).click(),
      );
      await dialog.getByRole("button", { name: "Close attachment preview" }).click();
      const listFile = await page.getByRole("button", { name: /^File to/ }).count();
      expect(
        pdfDl.sha256 === fixtureHash("doc029-services-text.pdf") &&
          docxDl.sha256 === fixtureHash("doc029-draft-v1.docx") &&
          zipDl.sha256 === fixtureHash("doc029-bundle.zip") &&
          fileAction === 0 &&
          listFile === 0,
        `file actions ${fileAction}/${listFile}`,
      );
      return `In Comments, selecting portal-thread.pdf opened its preview (PDF pages) and Download returned the bytes. portal-thread.docx also opened as a converted preview and Download returned the original Word bytes. portal-thread.zip showed "Preview unavailable. You can download the original file." and Download returned the ZIP bytes. No File to Contract action was offered to the Business User.`;
    },
  );

  await step(
    A,
    S,
    role,
    "Read files in the Business Portal: Knowledge lists the primary Document first with Download beside each file and no preview or Version picker; an archived item is no longer available",
    "Primary first; downloads return bytes; no reader; archived item unavailable",
    async () => {
      await page.goto(`${BASE}/portal/knowledge/${kid}`);
      const files = page.getByRole("region", { name: "Documents" });
      await files.waitFor({ timeout: 30000 });
      const rows = (await files.getByRole("listitem").allInnerTexts()).map((t) =>
        t.replace(/\s+/g, " ").trim(),
      );
      expect(
        rows[0]?.startsWith("portal-knowledge-primary.pdf") &&
          rows[1]?.startsWith("portal-knowledge-first.txt"),
        `order ${rows}`,
      );
      const dl = await download(page, () =>
        files.getByRole("link", { name: "Download portal-knowledge-primary.pdf" }).click(),
      );
      const readerButtons = await page.getByRole("button", { name: /portal-knowledge/ }).count();
      expect(
        dl.sha256 === fixtureHash("doc029-services-text.pdf") && readerButtons === 0,
        "knowledge download or reader",
      );
      const arch = await api(staff, "POST", `/knowledge/${kid}/archive`, {});
      expect(arch.status === 200, `fixture knowledge archive ${arch.status}`);
      await page.goto(`${BASE}/portal/knowledge/${kid}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      const afterUrl = new URL(page.url()).pathname;
      const afterText = (await page.getByRole("main").innerText()).replace(/\s+/g, " ");
      const stillListed = await page
        .getByRole("link", { name: "Download portal-knowledge-primary.pdf" })
        .count();
      expect(stillListed === 0, "archived knowledge still downloadable");
      return `The Portal Knowledge page listed ${rows.join(" | ")}: the primary Document first although it was uploaded second. Download returned its bytes; file names were plain text, not reader buttons. After Legal archived the item, the same address landed on ${afterUrl} ("${afterText.slice(0, 60)}…") with no files.`;
    },
  );

  await step(
    A,
    S,
    role,
    "Before you start: the Portal does not grant access to the staff Documents repository",
    "The staff repository address and its read are refused",
    async () => {
      await page.goto(`${BASE}/documents`);
      await page.waitForLoadState("networkidle").catch(() => {});
      const url = page.url();
      const read = await api(page, "GET", "/documents?limit=1");
      expect(
        !/\/documents$/.test(new URL(url).pathname) || read.status >= 400,
        `url ${url} read ${read.status}`,
      );
      expect(
        read.status === 403 || read.status === 404 || read.status === 401,
        `read ${read.status}`,
      );
      return `Opening /documents as the Business User landed on ${new URL(url).pathname}; the repository read answered ${read.status}.`;
    },
  );

  // Portal claims made by document-versions, document-folders and archive-and-delete-documents.
  await step(
    "document-versions",
    "V-C26",
    role,
    "Before you start: Business Users on the team upload Documents and add Versions in the Portal, including a new Version of the primary Document",
    "Upload documents creates a Document; Add version appends to the primary Document",
    async () => {
      const primaryBefore = (await recordDocs(staff, recUrl)).find((d) => d.isPrimary);
      await page.goto(`${BASE}/portal/contracts/${contract.number}`);
      await section().getByRole("heading", { name: "Documents" }).waitFor({ timeout: 30000 });
      const row = section()
        .getByRole("listitem")
        .filter({ has: page.getByRole("button", { name: primaryBefore.title, exact: true }) });
      await row.getByRole("button", { name: "Add version" }).click();
      let dialog = page.getByRole("dialog", { name: "Upload documents" });
      await dialog.waitFor();
      const addAs = await dialog.getByLabel("Add as").inputValue();
      await chooseFiles(
        page,
        dialog.getByRole("button", { name: "Drop files or choose files" }),
        fixture("doc029-draft-v1.docx"),
      );
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      await section().getByRole("heading", { name: "Documents" }).click();
      await section().getByRole("button", { name: "Upload documents" }).click();
      dialog = page.getByRole("dialog", { name: "Upload documents" });
      await chooseFiles(page, dialog.getByRole("button", { name: "Drop files or choose files" }), [
        fixture("doc029-bulk-c.txt"),
        fixture("doc029-bulk-d.txt"),
      ]);
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      const after = await recordDocs(staff, recUrl);
      const primaryAfter = after.find((d) => d.id === primaryBefore.id);
      const added = after.filter((d) => /doc029-bulk-[cd]/.test(d.title));
      expect(
        primaryAfter.versions.length === primaryBefore.versions.length + 1 &&
          primaryAfter.isPrimary &&
          added.length === 2 &&
          added.every((d) => !d.folderId && !d.folder),
        `primary ${primaryBefore.versions.length}->${primaryAfter.versions.length} added ${added.length}`,
      );
      return `Add version on the Primary Document "${primaryBefore.title}" opened Upload documents with Add as preset to that Document (${addAs === primaryBefore.id ? "New version of it" : addAs}); the upload appended v${primaryAfter.versions.length}. Upload documents with two files created two Documents at the record root (read-back by Legal).`;
    },
  );

  await step(
    "document-versions",
    "V-C26",
    role,
    "Before you start and Recover: Business Users cannot change designations, kinds or folders, archive or delete, and get no filing action",
    "The Portal shows no such controls and the staff seams refuse them",
    async () => {
      const d = (await recordDocs(staff, recUrl)).find((x) => x.isPrimary);
      const other = (await recordDocs(staff, recUrl)).find((x) => !x.isPrimary);
      const v = d.versions.at(-1);
      const texts = (await section().innerText()).replace(/\s+/g, " ");
      const controls = [
        "Make primary",
        "Mark as executed copy",
        "Move to folder",
        "Archive",
        "Delete",
        "New folder",
        "Edit details",
      ].filter((n) => texts.includes(n));
      const attempts = {
        primary: (await api(page, "POST", `/documents/${other.id}/primary`, {})).status,
        kind: (
          await api(page, "PATCH", `/documents/${d.id}/versions/${v.id}`, { kind: "executed" })
        ).status,
        executed: (
          await api(page, "POST", `/documents/${d.id}/executed-version`, { versionId: v.id })
        ).status,
        folder: (await api(page, "POST", `${recUrl}/folders`, { name: "DOC-029r2 portal folder" }))
          .status,
        archive: (await api(page, "POST", `/documents/${d.id}/archive`, {})).status,
        delete: (await api(page, "DELETE", `/documents/${d.id}`, { confirmTitle: d.title })).status,
      };
      const still = (await recordDocs(staff, recUrl)).find((x) => x.id === d.id);
      expect(
        controls.length === 0 &&
          Object.values(attempts).every((s) => s >= 400) &&
          still?.isPrimary &&
          !still.archivedAt,
        `controls ${controls} attempts ${JSON.stringify(attempts)}`,
      );
      return `The Portal Documents section offered none of Make primary, Mark as executed copy, Move to folder, Archive, Delete, New folder or Edit details. Direct attempts were refused: ${JSON.stringify(attempts)}. The Document stayed live and Primary.`;
    },
  );

  await step(
    "document-folders",
    "V-C27",
    role,
    "Before you start: Business Users upload several files at the record root but cannot create folders, move Documents or import a folder structure",
    "No folder controls or folder picker in the Portal; folder and move seams refuse",
    async () => {
      await section().getByRole("button", { name: "Upload documents" }).click();
      const dialog = page.getByRole("dialog", { name: "Upload documents" });
      const dialogText = (await dialog.innerText()).replace(/\s+/g, " ");
      const folderPicker = await dialog.getByRole("button", { name: "Choose folder" }).count();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      const d = (await recordDocs(staff, recUrl))[0];
      const staffFolder = await api(staff, "POST", `${recUrl}/folders`, {
        name: `DOC-029r2 portal target ${stamp}`,
      });
      const targetId = (await folderList(staff, recUrl)).find(
        (f) => f.name === `DOC-029r2 portal target ${stamp}`,
      )?.id;
      expect(staffFolder.status === 201 && targetId, `fixture folder ${staffFolder.status}`);
      const move = await api(page, "PATCH", `/documents/${d.id}`, { folderId: targetId });
      const create = await api(page, "POST", `${recUrl}/folders`, {
        name: "DOC-029r2 portal attempt",
      });
      const staffRoute = await api(page, "GET", `${recUrl}/folders`);
      expect(
        folderPicker === 0 &&
          !/Choose folder|New folder/.test(dialogText) &&
          move.status >= 400 &&
          create.status >= 400,
        `picker ${folderPicker} move ${move.status} create ${create.status}`,
      );
      return `Upload documents in the Portal offered Add as, a file drop zone, Kind and Note but no Choose folder or New folder. The folder create seam answered ${create.status} and moving a Document into a folder answered ${move.status}; the staff folder read answered ${staffRoute.status}. The two-file Portal upload in the previous step landed at the record root.`;
    },
  );

  await step(
    "archive-and-delete-documents",
    "V-C54",
    role,
    "Before you start: Business Users cannot archive, restore or delete; they have no managed-Document deletion controls",
    "No archive, restore or delete controls; the seams refuse",
    async () => {
      await page.goto(`${BASE}/portal/contracts/${contract.number}`);
      await section().getByRole("heading", { name: "Documents" }).waitFor({ timeout: 30000 });
      const text = (await section().innerText()).replace(/\s+/g, " ");
      const restore = await api(page, "POST", `/documents/${gone.id}/restore`, {});
      const d = (await recordDocs(staff, recUrl))[0];
      const archive = await api(page, "POST", `/documents/${d.id}/archive`, {});
      const del = await api(page, "DELETE", `/documents/${d.id}`, { confirmTitle: d.title });
      const stillArchived = (await getDoc(staff, recUrl, gone.id))?.archivedAt;
      expect(
        !/Archive|Restore|Delete|Show archived/.test(text) &&
          restore.status >= 400 &&
          archive.status >= 400 &&
          del.status >= 400 &&
          stillArchived,
        `restore ${restore.status} archive ${archive.status} delete ${del.status}`,
      );
      return `The Portal Documents section had no Archive, Restore, Delete or Show archived control. Restore answered ${restore.status}, archive ${archive.status}, delete ${del.status}; the archived Document stayed archived.`;
    },
  );

  await close_(context);
  await close_(sc);
}

// =====================================================================
// document-repository (V-C30)
// =====================================================================
let hiddenFixture = null;
async function hiddenPaper() {
  // An Administrator-only Confidential Contract whose team is the Administrator alone.
  if (hiddenFixture) return hiddenFixture;
  const { context, page } = await staffContext(PEOPLE.daniel);
  const title = `DOC-029r2 documents hidden owner ${stamp}`;
  const c = await createContract(page, "administrator", title, { isConfidential: true });
  const doc = await uploadApi(
    page,
    `/contracts/${c.number}/documents`,
    "doc029-services-text.pdf",
    { as: `repo-hidden-${stamp}.pdf` },
  );
  hiddenFixture = { contract: c, doc, title };
  await context.close();
  return hiddenFixture;
}
const repoTable = (page) => page.getByRole("main").getByRole("table");
async function repoTitles(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  const empty = page.getByText("No documents match these filters.");
  if (await empty.isVisible().catch(() => false)) return [];
  await repoTable(page).waitFor({ timeout: 20000 });
  return (await repoTable(page).getByRole("row").allInnerTexts()).map((t) =>
    t.replace(/\s+/g, " ").trim(),
  );
}
async function openFilter(page, name) {
  for (let i = 0; i < 3 && (await page.getByRole("dialog").count()) > 0; i++)
    await page.keyboard.press("Escape");
  const bar = page.getByLabel("Record filters");
  await bar.getByRole("button", { name: /^Filter/ }).click();
  const pop = page.getByRole("dialog", { name: "Filter" });
  await pop.waitFor();
  if (name) await pop.getByRole("button", { name, exact: true }).click();
  return pop;
}
async function applyChoice(page, filter, choices, search) {
  const pop = await openFilter(page, filter);
  const hint = (await pop.innerText()).replace(/\s+/g, " ");
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
  const clear = page.getByLabel("Record filters").getByRole("button", { name: "Clear all" });
  if (await clear.isVisible().catch(() => false)) {
    await clear.click();
    await page.waitForLoadState("networkidle").catch(() => {});
    await sleep(700);
  }
}

async function repository(role, person) {
  const A = "document-repository";
  const S = "V-C30";
  const label = role === "administrator" ? "Admin" : "Legal";
  const hidden = await hiddenPaper();
  const { context, page } = await staffContext(person);
  currentPage = page;
  const me = (await api(page, "GET", "/me")).body.user;
  const contract = await createContract(
    page,
    role,
    `DOC-029r2 documents ${label} repository Contract ${stamp}`,
  );
  const recUrl = `/contracts/${contract.number}`;
  const cpName = `DOC-029r2 ${label} Northwind ${stamp}`;
  const cp = await api(page, "POST", `${recUrl}/counterparties`, { name: cpName });
  expect(cp.status === 201 || cp.status === 200, `fixture counterparty ${cp.status}`);
  const folder = await api(page, "POST", `${recUrl}/folders`, {
    name: `DOC-029r2 ${label} Repo folder`,
  });
  expect(folder.status === 201, `fixture folder ${folder.status}`);
  const folderId = (await folderList(page, recUrl)).find(
    (f) => f.name === `DOC-029r2 ${label} Repo folder`,
  ).id;
  const tag = `${label.toLowerCase()}-${stamp}`;
  const rootPdf = await uploadApi(page, `${recUrl}/documents`, "doc029-services-text.pdf", {
    as: `repo-root-${tag}.pdf`,
    kind: "draft_ours",
  });
  await api(page, "POST", `/documents/${rootPdf.id}/versions`, undefined, {
    kind: "draft_theirs",
    file: part("doc029-scan.pdf", `repo-root-${tag}-v2.pdf`),
  });
  const filedDocx = await uploadApi(page, `${recUrl}/documents`, "doc029-draft-v1.docx", {
    as: `repo-folder-${tag}.docx`,
    kind: "executed",
    folderId,
  });
  const archivable = await uploadApi(page, `${recUrl}/documents`, "doc029-bulk-a.txt", {
    as: `repo-archive-${tag}.txt`,
  });
  const draggable = await uploadApi(page, `${recUrl}/documents`, "doc029-bulk-b.txt", {
    as: `repo-drag-${tag}.txt`,
  });
  const matter = await createMatter(
    page,
    role,
    `DOC-029r2 documents ${label} repository Matter ${stamp}`,
  );
  const matterDoc = await uploadApi(
    page,
    `/matters/${matter.number}/documents`,
    "doc029-services-text.pdf",
    { as: `repo-matter-${tag}.pdf` },
  );
  const types = (await api(page, "GET", "/entities/types")).body.entityTypes;
  const ent = await api(page, "POST", "/entities", {
    legalName: `DOC-029r2 documents ${label} repository Entity ${stamp} Ltd`,
    entityTypeId: types[0].id,
  });
  expect(ent.status === 201, `fixture entity ${ent.status}`);
  record(role, "entity", ent.body.entity.legalName, ent.body.entity.id);
  const entityDoc = await uploadApi(
    page,
    `/entities/${ent.body.entity.id}/documents`,
    "doc029-services-text.pdf",
    { as: `repo-entity-${tag}.pdf` },
  );
  const kType = (await api(page, "GET", "/knowledge?limit=1")).body.knowledgeItems?.[0]
    ?.knowledgeTypeId;
  const k = await api(page, "POST", "/knowledge", {
    title: `DOC-029r2 documents ${label} repository Knowledge ${stamp}`,
    knowledgeTypeId: kType,
  });
  expect(k.status === 201, `fixture knowledge ${k.status}`);
  record(role, "knowledge_item", k.body.knowledgeItem.title, k.body.knowledgeItem.id);
  const knowledgeDoc = await uploadApi(
    page,
    `/knowledge/${k.body.knowledgeItem.id}/documents`,
    "doc029-services-text.pdf",
    { as: `repo-knowledge-${tag}.pdf` },
  );
  const ad = await api(page, "POST", "/auto-docs", {
    name: `DOC-029r2 documents ${label} repository Auto-Doc ${stamp}`,
  });
  expect(
    ad.status === 201,
    `fixture auto-doc ${ad.status} ${JSON.stringify(ad.body).slice(0, 160)}`,
  );
  const autoDocId = ad.body.autoDoc?.id ?? ad.body.record?.id ?? ad.body.id;
  record(role, "auto_doc", `DOC-029r2 documents ${label} repository Auto-Doc ${stamp}`, autoDocId);
  const tpl = await api(page, "POST", `/auto-docs/${autoDocId}/template`, undefined, {
    file: part("doc029-draft-v1.docx", `repo-autodoc-${tag}.docx`),
  });
  expect(
    tpl.status === 201 || tpl.status === 200,
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
    S,
    role,
    "Search and narrow step 1: Documents from navigation; Recent shows up to five Documents by current-Version upload, not by opening",
    "Recent lists at most five, in the order of the newest current Versions, and opening an older Document does not change it",
    async () => {
      await page.goto(`${BASE}/`);
      await page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("link", { name: "Documents" })
        .click();
      await page.waitForURL(/\/documents/);
      const recent = page.getByRole("region", { name: "Recent documents" });
      await recent.waitFor({ timeout: 30000 });
      let ui, apiTitles;
      for (let i = 0; i < 4; i++) {
        ui = (
          await recent
            .getByRole("link")
            .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))
        ).map((t) => t.replace(/^Open recent Document /, ""));
        apiTitles = (await api(page, "GET", "/documents?limit=5")).body.documents.map(
          (d) => d.title,
        );
        if (JSON.stringify(ui) === JSON.stringify(apiTitles)) break;
        await page.reload();
        await recent.waitFor();
      }
      expect(
        ui.length <= 5 && JSON.stringify(ui) === JSON.stringify(apiTitles),
        `ui ${ui} api ${apiTitles}`,
      );
      await page.goto(
        `${BASE}/contracts/${contract.number}/documents?doc=${filedDocx.id}&version=${filedDocx.versions[0].id}`,
      );
      await page
        .getByRole("complementary", { name: `${filedDocx.title}, version 1` })
        .waitFor({ timeout: 30000 });
      await page.goto(`${BASE}/documents`);
      await recent.waitFor();
      let after, apiAfter;
      for (let i = 0; i < 4; i++) {
        after = (
          await recent
            .getByRole("link")
            .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))
        ).map((t) => t.replace(/^Open recent Document /, ""));
        apiAfter = (await api(page, "GET", "/documents?limit=5")).body.documents.map(
          (d) => d.title,
        );
        if (JSON.stringify(after) === JSON.stringify(apiAfter)) break;
        await page.reload();
        await recent.waitFor();
      }
      expect(
        JSON.stringify(after) === JSON.stringify(apiAfter) &&
          (!apiAfter.includes(filedDocx.title) || apiTitles.includes(filedDocx.title)),
        `after ${after}`,
      );
      return `The Documents navigation link opened the repository. Recent listed ${ui.length} Documents in the same order as the newest-current-Version read (${ui.slice(0, 2).join(", ")}, …). After opening the older "${filedDocx.title}" and returning, Recent still matched the upload-time order and did not add it.`;
    },
  );

  await step(
    A,
    S,
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
        const rows = await repoTitles(page);
        const autoDocs =
          choice === "Auto-Docs"
            ? (await api(page, "GET", "/documents?owner=auto_doc&limit=100")).body.documents.map(
                (d) => d.title,
              )
            : null;
        expect(
          (present === null || has(rows, present)) && absent.every((t) => !has(rows, t)),
          `${choice}: ${rows.slice(0, 4)}`,
        );
        if (autoDocs)
          expect(
            rows.slice(1).every((r) => autoDocs.some((t) => r.includes(t))),
            `auto-doc rows ${rows.slice(0, 3)}`,
          );
        seen.push(
          `${choice}: ${Math.max(0, rows.length - 1)} rows${present ? `, including ${present}` : ""}`,
        );
      }
      await clearAll(page);
      return `Owner offered ${choices.join(", ")}. ${seen.join("; ")}. Each list left out the fixture paper of the other owner kinds.`;
    },
  );

  await step(
    A,
    S,
    role,
    "Search and narrow step 3: Record with Search choices; Folder becomes available with Record root",
    "Record narrows to one Contract; Folder picks the folder or Record root",
    async () => {
      await applyChoice(
        page,
        "Record",
        [`C-${contract.number} · ${contract.title}`],
        `C-${contract.number}`,
      );
      let rows = await repoTitles(page);
      expect(
        mine.every((t) => has(rows, t)) && rows.length - 1 === mine.length,
        `record rows ${rows.length - 1}`,
      );
      let pop = await openFilter(page);
      const menu = (await pop.getByRole("button").allInnerTexts()).map((t) =>
        t.replace(/[✓]/g, "").trim(),
      );
      await page.keyboard.press("Escape");
      expect(menu.includes("Folder"), `menu ${menu}`);
      await applyChoice(page, "Folder", [`DOC-029r2 ${label} Repo folder`]);
      rows = await repoTitles(page);
      expect(rows.length - 1 === 1 && has(rows, filedDocx.title), `folder rows ${rows}`);
      const chip = page.getByLabel("Record filters").getByRole("button", { name: /^Folder:/ });
      await chip.click();
      const editor = page.getByRole("dialog", { name: "Folder" });
      await editor.getByText("Record root", { exact: true }).click();
      await editor.getByRole("button", { name: "Apply" }).click();
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(700);
      rows = await repoTitles(page);
      expect(!has(rows, filedDocx.title) && has(rows, rootPdf.title), `root rows ${rows}`);
      await clearAll(page);
      await applyChoice(page, "Owner", ["Knowledge"]);
      pop = await openFilter(page);
      const kMenu = (await pop.getByRole("button").allInnerTexts()).map((t) =>
        t.replace(/[✓]/g, "").trim(),
      );
      await page.keyboard.press("Escape");
      await clearAll(page);
      await applyChoice(page, "Owner", ["Auto-Docs"]);
      pop = await openFilter(page);
      const aMenu = (await pop.getByRole("button").allInnerTexts()).map((t) =>
        t.replace(/[✓]/g, "").trim(),
      );
      await page.keyboard.press("Escape");
      await clearAll(page);
      expect(
        !kMenu.includes("Folder") && !aMenu.includes("Folder"),
        `knowledge menu ${kMenu} auto-doc menu ${aMenu}`,
      );
      return `Record with Search choices "C-${contract.number}" narrowed the list to the Contract's ${mine.length} live Documents, and the Filter menu then offered Folder. Folder "DOC-029r2 ${label} Repo folder" showed only "${filedDocx.title}"; Record root showed the Documents outside folders. With Owner Knowledge, and with Owner Auto-Docs, the Filter menu offered no Folder.`;
    },
  );

  await step(
    A,
    S,
    role,
    "Search and narrow steps 4-5: Format and Uploader accept several values; different filters must all match; Uploaded From/To includes both dates; remove one filter and Clear all; Recent hides while filtered",
    "Any-of within a filter, all-of across filters, inclusive dates, and Recent only without filters",
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
      let rows = await repoTitles(page);
      expect(
        has(rows, rootPdf.title) && has(rows, filedDocx.title) && !has(rows, archivable.title),
        `format rows ${rows}`,
      );
      const recentWhileFiltered = await page
        .getByRole("region", { name: "Recent documents" })
        .count();
      await applyChoice(page, "Kind", ["Draft · ours"]);
      rows = await repoTitles(page);
      const currentKindOnly = !has(rows, rootPdf.title);
      await page
        .getByLabel("Record filters")
        .getByRole("button", { name: "Remove Kind filter" })
        .click();
      await sleep(700);
      await applyChoice(page, "Kind", ["Executed"]);
      rows = await repoTitles(page);
      expect(
        currentKindOnly && rows.length - 1 === 1 && has(rows, filedDocx.title),
        `kind rows ${rows} currentKindOnly ${currentKindOnly}`,
      );
      await applyChoice(page, "Counterparty", [cpName], cpName);
      await applyChoice(page, "Uploader", [me.displayName], me.displayName);
      rows = await repoTitles(page);
      expect(rows.length - 1 === 1 && has(rows, filedDocx.title), `cp/uploader rows ${rows}`);
      let pop = await openFilter(page, "Uploaded");
      const dateHint = (await pop.innerText()).replace(/\s+/g, " ");
      await pop.getByRole("textbox", { name: "From", exact: true }).fill(today);
      await pop.getByRole("textbox", { name: "To", exact: true }).fill(today);
      await pop.getByRole("button", { name: "Apply" }).click();
      await sleep(900);
      rows = await repoTitles(page);
      expect(has(rows, filedDocx.title), `same-day rows ${rows}`);
      await page
        .getByLabel("Record filters")
        .getByRole("button", { name: /^Uploaded:/ })
        .click();
      pop = page.getByRole("dialog", { name: "Uploaded" });
      await pop.getByRole("textbox", { name: "To", exact: true }).fill("");
      await pop.getByRole("textbox", { name: "From", exact: true }).fill(tomorrow);
      await pop.getByRole("button", { name: "Apply" }).click();
      await sleep(900);
      await page.getByText("No documents match these filters.").waitFor({ timeout: 15000 });
      await page
        .getByLabel("Record filters")
        .getByRole("button", { name: "Remove Kind filter" })
        .click();
      await sleep(700);
      const stillEmpty = await page.getByText("No documents match these filters.").isVisible();
      await page
        .getByLabel("Record filters")
        .getByRole("button", { name: "Remove Uploaded filter" })
        .click();
      await sleep(900);
      rows = await repoTitles(page);
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
        `hint ${fmtHint.slice(0, 60)} recent ${recentWhileFiltered}/${recentAfter} widened ${widened}`,
      );
      return `On C-${contract.number}, Format PDF + Word ("Matches any selected value") kept the PDF and the Word Document. Kind Draft · ours left out "${rootPdf.title}", whose v1 is Draft · ours but whose current v2 is Draft · theirs. Kind Executed left only "${filedDocx.title}"; Counterparty ${cpName} and Uploader ${me.displayName} kept it. Uploaded From ${today} To ${today} ("Includes both dates") kept it; From ${tomorrow} showed "No documents match these filters.". Removing the Kind filter left the list empty; removing Uploaded widened it again. Recent was hidden while filters were active and returned after Clear all.`;
    },
  );

  await step(
    A,
    S,
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
      await repoTable(page).getByRole("link", { name: rootPdf.title, exact: true }).click();
      await page.waitForURL(new RegExp(`/contracts/${contract.number}/documents`), {
        timeout: 30000,
      });
      const panel = page.getByRole("complementary", { name: `${rootPdf.title}, version 2` });
      await panel.waitFor({ timeout: 30000 });
      await panel.getByText("v2", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: `Show the 1 earlier version of ${rootPdf.title}` })
        .click();
      await page.getByRole("button", { name: rootPdf.title, exact: true }).last().click();
      await page
        .getByRole("complementary", { name: `${rootPdf.title}, version 1` })
        .waitFor({ timeout: 30000 });
      await page.goto(`${BASE}/documents`);
      return `Selecting "${rootPdf.title}" opened C-${contract.number}'s Documents tab with the reader on "${rootPdf.title}, version 2". Expanding the chain and selecting the earlier filename opened version 1.`;
    },
  );

  await step(
    A,
    S,
    role,
    "Missing or archived: a hidden record's Document does not appear through a filter or direct link",
    role === "administrator"
      ? "An Administrator reaches every Contract, so the Confidential Contract's paper is listed"
      : "The Confidential Contract outside this reader's team is absent from Record choices and lists, and its address is refused",
    async () => {
      const pop = await openFilter(page, "Record");
      await pop.getByLabel("Search choices").fill(`C-${hidden.contract.number}`);
      const choiceText = (await pop.innerText()).replace(/\s+/g, " ");
      await page.keyboard.press("Escape");
      const listed = (await api(page, "GET", `/documents?limit=100`)).body.documents.some(
        (d) => d.id === hidden.doc.id,
      );
      const direct = await api(page, "GET", `/contracts/${hidden.contract.number}/documents`);
      await page.goto(`${BASE}/contracts/${hidden.contract.number}/documents`);
      await page.waitForLoadState("networkidle").catch(() => {});
      const pageText = (
        await page
          .getByRole("main")
          .innerText()
          .catch(() => "")
      )
        .replace(/\s+/g, " ")
        .slice(0, 100);
      await page.goto(`${BASE}/documents`);
      if (role === "administrator") {
        expect(
          choiceText.includes(hidden.title) && listed && direct.status === 200,
          `admin ${choiceText.slice(0, 80)} listed ${listed} direct ${direct.status}`,
        );
        return `As Administrator, Record choices for C-${hidden.contract.number} offered "${hidden.title}", the repository read listed its Document, and the record's Documents read answered ${direct.status}. The article does not claim that an Administrator is refused.`;
      }
      expect(
        !choiceText.includes(hidden.title) &&
          /No matching choices/.test(choiceText) &&
          !listed &&
          direct.status === 404,
        `legal ${choiceText.slice(0, 80)} listed ${listed} direct ${direct.status}`,
      );
      return `As Legal Team Member outside its team, Record choices for C-${hidden.contract.number} read "No matching choices", the repository read did not include its Document, the direct Documents read answered 404, and the address showed "${pageText}".`;
    },
  );

  await step(
    A,
    S,
    role,
    "Missing or archived: Filter, Show archived includes archived Documents; the offered Restore brings one back",
    "The archived row appears with Archived and Restore; Restore makes it live",
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
      let rows = await repoTitles(page);
      const hiddenBefore = !has(rows, archivable.title);
      const pop = await openFilter(page);
      await pop.getByRole("button", { name: "Show archived", exact: true }).click();
      await sleep(900);
      rows = await repoTitles(page);
      const row = rows.find((r) => r.includes(archivable.title)) ?? "";
      await page.getByRole("button", { name: `Restore ${archivable.title}` }).click();
      let live;
      for (let i = 0; i < 20; i++) {
        live = await getDoc(page, recUrl, archivable.id);
        if (!live.archivedAt) break;
        await sleep(300);
      }
      await clearAll(page);
      expect(
        hiddenBefore && /Archived/.test(row) && !live.archivedAt,
        `before ${hiddenBefore} row ${row}`,
      );
      return `After archiving "${archivable.title}" it was absent from the Record-filtered list. Filter, Show archived added its row marked Archived with a Restore action; Restore made it live again (read-back).`;
    },
  );

  await step(
    A,
    S,
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
      const target = aside.getByText(`DOC-029r2 ${label} Repo folder`, { exact: true });
      await dragMouse(page, row, target, { revealTarget: target });
      let doc;
      for (let i = 0; i < 20; i++) {
        doc = await getDoc(page, recUrl, draggable.id);
        if ((doc.folderId ?? doc.folder?.id) === folderId) break;
        await sleep(300);
      }
      await clearAll(page);
      expect(
        (doc.folderId ?? doc.folder?.id) === folderId,
        "repository drag did not file the Document",
      );
      return `Dragging the "${draggable.title}" row showed the Move to folder panel for C-${contract.number} with None and "DOC-029r2 ${label} Repo folder"; dropping on the folder filed the Document there (read-back).`;
    },
  );

  await close_(context);
}

// =====================================================================
// archive-and-delete-documents (V-C54)
// =====================================================================
async function showArchived(page, on) {
  const sw = docsSection(page).getByRole("switch", { name: "Show archived" });
  if ((await sw.getAttribute("aria-checked")) !== String(on)) await sw.click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(700);
}

async function archive(role, person) {
  const A = "archive-and-delete-documents";
  const S = "V-C54";
  const label = role === "administrator" ? "Admin" : "Legal";
  const { context, page } = await staffContext(person);
  currentPage = page;
  const contract = await createContract(
    page,
    role,
    `DOC-029r2 documents ${label} archive Contract ${stamp}`,
  );
  const recUrl = `/contracts/${contract.number}`;
  const tag = `${label.toLowerCase()}-${stamp}`;
  const main = await uploadApi(page, `${recUrl}/documents`, "doc029-draft-v1.docx", {
    as: `archive-main-${tag}.docx`,
  });
  for (const n of [2, 3])
    await api(page, "POST", `/documents/${main.id}/versions`, undefined, {
      kind: "draft_theirs",
      file: part("doc029-draft-v2.docx", `archive-main-${tag}-v${n}.docx`),
    });
  let doc = await getDoc(page, recUrl, main.id);
  const v2 = doc.versions.find((v) => v.versionNumber === 2);
  expect(
    (await api(page, "POST", `/documents/${main.id}/executed-version`, { versionId: v2.id }))
      .status < 300,
    "fixture pin",
  );
  if (!(await getDoc(page, recUrl, main.id)).isPrimary)
    expect(
      (await api(page, "POST", `/documents/${main.id}/primary`, {})).status < 300,
      "fixture primary",
    );
  const b1 = await uploadApi(page, `${recUrl}/documents`, "doc029-bulk-a.txt", {
    as: `archive-bulk-1-${tag}.txt`,
  });
  const b2 = await uploadApi(page, `${recUrl}/documents`, "doc029-bulk-b.txt", {
    as: `archive-bulk-2-${tag}.txt`,
  });

  await step(
    A,
    S,
    role,
    "Archive a Document steps 1-3: Actions, Archive; it leaves the normal list; Show archived finds its Archived row",
    "The Document leaves the list, reappears marked Archived, and keeps its Versions, files and designations",
    async () => {
      await openDocumentsTab(page, `${recUrl}/documents`);
      await chooseMenu(page, main.title, "Archive");
      await rowOf(page, main.title).waitFor({ state: "hidden", timeout: 20000 });
      await showArchived(page, true);
      const row = rowOf(page, main.title);
      await row.getByText("Archived", { exact: true }).waitFor();
      const d = await getDoc(page, recUrl, main.id);
      const downloads = [];
      for (const v of d.versions)
        downloads.push(
          (await api(page, "GET", `/documents/${main.id}/versions/${v.id}/download`)).status,
        );
      expect(
        d.archivedAt &&
          d.versions.length === 3 &&
          d.isPrimary &&
          d.versions.find((v) => v.isExecuted)?.versionNumber === 2 &&
          downloads.every((st) => st === 200),
        `archived ${JSON.stringify({ a: d.archivedAt, n: d.versions.length, p: d.isPrimary, downloads })}`,
      );
      return `Archive removed "${main.title}" from the Documents list. Show archived drew its row with the Archived mark. Read-back: 3 Versions, still Primary, Executed pin on v2, and every Version download answered 200.`;
    },
  );

  await step(
    A,
    S,
    role,
    "Restore a Document steps 1-3: Show archived, Restore from the row Actions menu; Versions and designations come back",
    "The Document is live again with its Versions, primary and executed-copy designation",
    async () => {
      await chooseMenu(page, main.title, "Restore");
      let d;
      for (let i = 0; i < 20; i++) {
        d = await getDoc(page, recUrl, main.id);
        if (!d.archivedAt) break;
        await sleep(300);
      }
      await showArchived(page, false);
      const row = rowOf(page, main.title);
      await row.waitFor();
      const text = (await row.innerText()).replace(/\s+/g, " ");
      expect(
        !d.archivedAt &&
          d.isPrimary &&
          d.versions.length === 3 &&
          d.versions.find((v) => v.isExecuted)?.versionNumber === 2 &&
          /Primary/.test(text),
        `restored ${text}`,
      );
      return `Restore in the archived row's Actions menu made the Document live. With Show archived off its row read "${text.slice(0, 90)}"; read-back kept 3 Versions, Primary, and the Executed pin on v2.`;
    },
  );

  await step(
    A,
    S,
    role,
    "Archive several live Documents with checkboxes and Archive; restore several archived Documents with Restore in the selection bar",
    "Both leave the list together and return together",
    async () => {
      await page.getByRole("checkbox", { name: `Select ${b1.title}` }).click();
      await page.getByRole("checkbox", { name: `Select ${b2.title}` }).click();
      let bar = page.getByText("2 selected", { exact: true }).locator("xpath=../..");
      await bar.getByRole("button", { name: "Archive", exact: true }).click();
      await rowOf(page, b1.title).waitFor({ state: "hidden", timeout: 20000 });
      await rowOf(page, b2.title).waitFor({ state: "hidden", timeout: 20000 });
      await showArchived(page, true);
      await page.getByRole("checkbox", { name: `Select ${b1.title}` }).click();
      await page.getByRole("checkbox", { name: `Select ${b2.title}` }).click();
      bar = page.getByText("2 selected", { exact: true }).locator("xpath=../..");
      await bar.getByRole("button", { name: "Restore", exact: true }).click();
      let live;
      for (let i = 0; i < 20; i++) {
        live = [await getDoc(page, recUrl, b1.id), await getDoc(page, recUrl, b2.id)];
        if (live.every((d) => !d.archivedAt)) break;
        await sleep(300);
      }
      await showArchived(page, false);
      expect(
        live.every((d) => !d.archivedAt),
        "bulk restore",
      );
      return `Selecting two live Documents and Archive in the selection bar removed both rows. With Show archived on, selecting both archived rows offered Restore, which made both live again (read-back).`;
    },
  );

  await step(
    A,
    S,
    role,
    "Restore a Document: refused while the owning record is archived; restore the record first",
    "The archived record offers no Show archived or Document controls; restore is refused; after restoring the record the Document restores",
    async () => {
      expect(
        (await api(page, "POST", `/documents/${b1.id}/archive`, {})).status === 200,
        "fixture doc archive",
      );
      expect(
        (await api(page, "POST", `${recUrl}/archive`, {})).status === 200,
        "fixture record archive",
      );
      await openDocumentsTab(page, `${recUrl}/documents`);
      const sw = await docsSection(page).getByRole("switch", { name: "Show archived" }).count();
      const upload = await docsSection(page)
        .getByRole("button", { name: "Upload", exact: true })
        .count();
      const menuItemsSeen = [];
      for (const trigger of await docsSection(page)
        .getByRole("button", { name: /^Actions for / })
        .all()) {
        await trigger.click();
        menuItemsSeen.push(
          ...(await page.getByRole("menu").getByRole("menuitem").allInnerTexts()).map((t) =>
            t.trim(),
          ),
        );
        await page.keyboard.press("Escape");
      }
      const menus = menuItemsSeen.filter((t) =>
        /Archive|Restore|Delete|Add version|Move to folder/.test(t),
      ).length;
      const refused = await api(page, "POST", `/documents/${b1.id}/restore`, {});
      expect(
        (await api(page, "POST", `${recUrl}/restore`, {})).status === 200,
        "fixture record restore",
      );
      await openDocumentsTab(page, `${recUrl}/documents`);
      await showArchived(page, true);
      await chooseMenu(page, b1.title, "Restore");
      let d;
      for (let i = 0; i < 20; i++) {
        d = await getDoc(page, recUrl, b1.id);
        if (!d.archivedAt) break;
        await sleep(300);
      }
      await showArchived(page, false);
      expect(
        sw === 0 && upload === 0 && menus === 0 && refused.status === 409 && !d.archivedAt,
        `switch ${sw} menus ${menus} refused ${refused.status}`,
      );
      return `While the Contract was archived, its Documents section showed no Show archived switch and no Upload (${upload}); row menus offered only ${[...new Set(menuItemsSeen)].join(", ") || "nothing"}; restoring the archived Document was refused ${refused.status} ("${String(refused.body?.detail ?? "").slice(0, 90)}"). After the Contract was restored, Show archived and Restore made the Document live.`;
    },
  );

  await step(
    A,
    S,
    role,
    "Restore a Document: a stale-state message when someone already restored the same Document",
    "Restore on a stale row shows a message; reloading shows the live Document",
    async () => {
      expect(
        (await api(page, "POST", `/documents/${b2.id}/archive`, {})).status === 200,
        "fixture archive",
      );
      await openDocumentsTab(page, `${recUrl}/documents`);
      await showArchived(page, true);
      await rowOf(page, b2.title).getByText("Archived", { exact: true }).waitFor();
      const { context: other, page: second } = await staffContext(person);
      const r = await api(second, "POST", `/documents/${b2.id}/restore`, {});
      await other.close();
      expect(r.status === 200, `second session restore ${r.status}`);
      await chooseMenu(page, b2.title, "Restore");
      const alert = docsSection(page)
        .locator('[aria-live="polite"]')
        .filter({ hasText: /archived|restore|could not|already/i });
      await alert.first().waitFor({ timeout: 15000 });
      const message = (await alert.first().innerText()).trim();
      await page.reload();
      await docsSection(page).getByRole("heading", { name: "Documents" }).waitFor();
      const live = !(await getDoc(page, recUrl, b2.id)).archivedAt;
      expect(message.length > 0 && live, `message ${message}`);
      return `A second session restored the Document while this page still showed it archived. Restore on the stale row showed "${message}". After a reload the Document was live.`;
    },
  );

  if (role !== "administrator") {
    await step(
      A,
      S,
      role,
      "Before you start and Permanently delete: only an Administrator deletes; this role gets no Delete control and the seam refuses",
      "No Delete in the row menu or selection bar; direct deletion is refused and the Document stays",
      async () => {
        await openDocumentsTab(page, `${recUrl}/documents`);
        const items = await menuItems(page, main.title);
        await page.getByRole("checkbox", { name: `Select ${b1.title}` }).click();
        const bar = page.getByText("1 selected", { exact: true }).locator("xpath=../..");
        const barDelete = await bar.getByRole("button", { name: "Delete", exact: true }).count();
        await bar.getByRole("button", { name: "Clear selection" }).click();
        const del = await api(page, "DELETE", `/documents/${main.id}`, {
          confirmTitle: main.title,
        });
        const d = await getDoc(page, recUrl, main.id);
        expect(
          !items.includes("Delete") &&
            barDelete === 0 &&
            del.status === 403 &&
            d?.versions.length === 3,
          `items ${items} bar ${barDelete} delete ${del.status}`,
        );
        return `The row menu offered ${items.join(", ")}: no Delete. The selection bar had no Delete. A direct deletion answered ${del.status}; the Document kept its 3 Versions.`;
      },
    );
    await knowledgeSection(role, page, A, S, label);
    await close_(context);
    return;
  }

  await step(
    A,
    S,
    role,
    "Permanently delete steps 1-4: Actions, Delete; the dialog names the Document and Version count; Delete stays disabled until delete is typed; Cancel keeps it",
    "Cancel and a wrong word leave the Document; the dialog text matches the guide",
    async () => {
      await openDocumentsTab(page, `${recUrl}/documents`);
      await chooseMenu(page, main.title, "Delete");
      const dialog = page.getByRole("dialog", { name: "Delete this document?" });
      await dialog.waitFor();
      const text = (await dialog.innerText()).replace(/\s+/g, " ");
      await shot(page, "r1-admin-delete-dialog.png");
      const button = dialog.getByRole("button", { name: `Delete ${main.title}` });
      const disabledEmpty = await button.isDisabled();
      await dialog.getByLabel('Type "delete" to confirm').fill(main.title);
      const disabledWrong = await button.isDisabled();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      const d = await getDoc(page, recUrl, main.id);
      expect(
        /archive-main/.test(text) &&
          /3 versions/.test(text) &&
          disabledEmpty &&
          disabledWrong &&
          d?.versions.length === 3,
        `text ${text} disabled ${disabledEmpty}/${disabledWrong}`,
      );
      return `Delete opened "Delete this document?" reading "${text.slice(0, 200)}". Delete stayed disabled with the field empty and with the Document name typed instead of the word. Cancel closed the dialog and the Document kept its 3 Versions.`;
    },
  );

  await step(
    A,
    S,
    role,
    "If deletion fails: a rename while the dialog is open makes OpenLaw refuse the deletion",
    "The deletion is refused with a message and the Document stays",
    async () => {
      await chooseMenu(page, b2.title, "Delete");
      const dialog = page.getByRole("dialog", { name: "Delete this document?" });
      const renamed = `${b2.title} renamed`;
      const patch = await api(page, "PATCH", `/documents/${b2.id}`, { title: renamed });
      expect(patch.status === 200, `fixture rename ${patch.status}`);
      await dialog.getByLabel('Type "delete" to confirm').fill("delete");
      await dialog.getByRole("button", { name: `Delete ${b2.title}` }).click();
      const alert = dialog.getByRole("alert");
      await alert.waitFor({ timeout: 15000 });
      const message = (await alert.innerText()).trim();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      const d = await getDoc(page, recUrl, b2.id);
      expect(d && d.title === renamed, "document gone after refused delete");
      return `With the dialog open, a second request renamed the Document. Typing delete and selecting Delete was refused with "${message}"; the Document remained under its new name.`;
    },
  );

  await step(
    A,
    S,
    role,
    "Permanently delete: type delete, select Delete; every Version and the primary reference go; no other Document becomes primary; the activity record remains",
    "The row is gone, Version downloads fail, no replacement primary, activity names the deletion",
    async () => {
      await openDocumentsTab(page, `${recUrl}/documents`);
      const before = await getDoc(page, recUrl, main.id);
      const contractId = (await api(page, "GET", recUrl)).body.contract.id;
      await chooseMenu(page, main.title, "Delete");
      const dialog = page.getByRole("dialog", { name: "Delete this document?" });
      await dialog.getByLabel('Type "delete" to confirm').fill("delete");
      await dialog.getByRole("button", { name: `Delete ${main.title}` }).click();
      await dialog.waitFor({ state: "hidden", timeout: 20000 });
      await rowOf(page, main.title).waitFor({ state: "hidden" });
      const downloads = [];
      for (const v of before.versions)
        downloads.push(
          (await api(page, "GET", `/documents/${main.id}/versions/${v.id}/download`)).status,
        );
      const docs = await recordDocs(page, recUrl, true);
      const activity = await api(
        page,
        "GET",
        `/activity?entityType=contract&entityId=${contractId}`,
      );
      const mention = JSON.stringify(activity.body).includes(main.title);
      expect(
        !docs.some((d) => d.id === main.id) &&
          downloads.every((st) => st === 404) &&
          !docs.some((d) => d.isPrimary) &&
          mention,
        `downloads ${downloads} primary ${docs.filter((d) => d.isPrimary).length} activity ${activity.status}/${mention}`,
      );
      return `Typing delete enabled Delete; after it the row was gone (also with archived rows included). The three Version downloads answered ${downloads.join(", ")}. No remaining Document was marked Primary. The Contract activity read still named "${main.title}".`;
    },
  );

  await step(
    A,
    S,
    role,
    "Permanently delete: several Documents with checkboxes and Delete in the selection bar, also confirmed by typing delete",
    "The bulk dialog asks for delete and removes both",
    async () => {
      const c1 = await uploadApi(page, `${recUrl}/documents`, "doc029-bulk-c.txt", {
        as: `archive-del-1-${tag}.txt`,
      });
      const c2 = await uploadApi(page, `${recUrl}/documents`, "doc029-bulk-d.txt", {
        as: `archive-del-2-${tag}.txt`,
      });
      await openDocumentsTab(page, `${recUrl}/documents`);
      await page.getByRole("checkbox", { name: `Select ${c1.title}` }).click();
      await page.getByRole("checkbox", { name: `Select ${c2.title}` }).click();
      const bar = page.getByText("2 selected", { exact: true }).locator("xpath=../..");
      await bar.getByRole("button", { name: "Delete", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Delete 2 documents?" });
      await dialog.waitFor();
      const text = (await dialog.innerText()).replace(/\s+/g, " ");
      const confirm = dialog.getByRole("button", { name: "Delete", exact: true });
      const disabled = await confirm.isDisabled();
      await dialog.getByLabel('Type "delete" to confirm').fill("delete");
      await confirm.click();
      await dialog.waitFor({ state: "hidden", timeout: 20000 });
      const docs = await recordDocs(page, recUrl, true);
      expect(
        disabled && !docs.some((d) => d.id === c1.id || d.id === c2.id),
        `disabled ${disabled}`,
      );
      return `Selecting two Documents and Delete in the selection bar opened "Delete 2 documents?" reading "${text.slice(0, 160)}". Delete was disabled until delete was typed; then both Documents were removed.`;
    },
  );

  await step(
    A,
    S,
    role,
    "You cannot delete just one Version",
    "No Version-level delete control; the seam has no single-Version delete",
    async () => {
      const d = await uploadApi(page, `${recUrl}/documents`, "doc029-draft-v1.docx", {
        as: `archive-keep-${tag}.docx`,
      });
      await api(page, "POST", `/documents/${d.id}/versions`, undefined, {
        kind: "draft_theirs",
        file: part("doc029-draft-v2.docx"),
      });
      await openDocumentsTab(page, `${recUrl}/documents`);
      await page.getByRole("button", { name: `Show the 1 earlier version of ${d.title}` }).click();
      await page
        .getByRole("button", { name: `Actions for version 1 of ${d.title}`, exact: true })
        .click();
      const items = (await page.getByRole("menu").getByRole("menuitem").allInnerTexts()).map((t) =>
        t.trim(),
      );
      await page.keyboard.press("Escape");
      const fresh = await getDoc(page, recUrl, d.id);
      const v1 = fresh.versions.find((v) => v.versionNumber === 1);
      const del = await api(page, "DELETE", `/documents/${d.id}/versions/${v1.id}`);
      const after = await getDoc(page, recUrl, d.id);
      expect(
        !items.some((i) => /Delete/.test(i)) && del.status >= 400 && after.versions.length === 2,
        `items ${items} delete ${del.status}`,
      );
      return `The earlier Version's menu offered ${items.join(", ")}: no Delete. A request to delete one Version answered ${del.status}; the Document kept both Versions.`;
    },
  );

  await knowledgeSection(role, page, A, S, label);
  await close_(context);
}

async function knowledgeSection(role, page, A, S, label) {
  await step(
    A,
    S,
    role,
    "Archive a Document step 1: a Knowledge Item's Documents section archives and restores; it has Set as primary and no Document folders",
    "Archive and Restore work in the Knowledge Documents section; Set as primary is offered; no New folder",
    async () => {
      const kType = (await api(page, "GET", "/knowledge?limit=1")).body.knowledgeItems?.[0]
        ?.knowledgeTypeId;
      const k = await api(page, "POST", "/knowledge", {
        title: `DOC-029r2 documents ${label} archive Knowledge ${stamp}`,
        knowledgeTypeId: kType,
      });
      expect(k.status === 201, `fixture knowledge ${k.status}`);
      const kid = k.body.knowledgeItem.id;
      record(role, "knowledge_item", k.body.knowledgeItem.title, kid);
      const d1 = await uploadApi(page, `/knowledge/${kid}/documents`, "doc029-services-text.pdf", {
        as: `knowledge-a-${label.toLowerCase()}-${stamp}.pdf`,
      });
      const d2 = await uploadApi(page, `/knowledge/${kid}/documents`, "doc029-bulk-a.txt", {
        as: `knowledge-b-${label.toLowerCase()}-${stamp}.txt`,
      });
      await page.goto(`${BASE}/knowledge/${kid}`);
      await docsSection(page)
        .getByRole("heading", { name: "Documents" })
        .waitFor({ timeout: 30000 });
      const newFolder = await docsSection(page).getByRole("button", { name: "New folder" }).count();
      const docsNow = await recordDocs(page, `/knowledge/${kid}`);
      const notPrimary = docsNow.find((d) => !d.isPrimary) ?? d2;
      const items = await menuItems(page, notPrimary.title);
      await chooseMenu(page, d2.title, "Archive");
      await rowOf(page, d2.title).waitFor({ state: "hidden", timeout: 20000 });
      await showArchived(page, true);
      await rowOf(page, d2.title).getByText("Archived", { exact: true }).waitFor();
      await chooseMenu(page, d2.title, "Restore");
      let live;
      for (let i = 0; i < 20; i++) {
        live = (await recordDocs(page, `/knowledge/${kid}`)).some((d) => d.id === d2.id);
        if (live) break;
        await sleep(300);
      }
      expect(
        newFolder === 0 && items.includes("Set as primary") && live,
        `newFolder ${newFolder} items ${items} live ${live}`,
      );
      return `The Knowledge Item's Documents section had no New folder button. The menu of a non-primary Document offered ${items.join(", ")} (including Set as primary). Archive removed "${d2.title}", Show archived showed it marked Archived, and Restore made it live again.`;
    },
  );
}

async function close_(context) {
  await context.close().catch(() => {});
}

// =====================================================================
// main
// =====================================================================
const STAFF = { administrator: PEOPLE.daniel, legal_team_member: PEOPLE.nadia };
try {
  await loadUserIds();
  for (const role of ROLES) {
    if (SECTIONS.includes("versions")) await versions(role, STAFF[role]);
    if (SECTIONS.includes("folders")) await folders(role, STAFF[role]);
    if (SECTIONS.includes("previews")) await previews(role, STAFF[role]);
    if (SECTIONS.includes("repository")) await repository(role, STAFF[role]);
    if (SECTIONS.includes("archive")) await archive(role, STAFF[role]);
  }
  if (SECTIONS.includes("portal")) await portal();
} finally {
  save();
  await close();
}
const failed = results.steps.filter((s) => s.result !== "pass");
console.log(`\n${results.steps.length - failed.length}/${results.steps.length} steps passed`);
