// DOC-029 independent walkthrough, group "knowledge", round 1.
// Follows docs/user-guides/create-knowledge.md (V-C33) and
// docs/user-guides/publish-knowledge.md (V-C34) as written, in the shared
// entities lab, for the Legal Team Member and the Administrator.
//
// Run from the worktree root:
//   LAB_PASSWORD=... mise exec -- node docs/documentation/batches/DOC-029/knowledge/walkthrough-r1.mjs
// The seed password comes only from the environment. Magic links, cookies
// and mail bodies stay in memory and never reach the log.
import { chromium } from "../../../../../node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const BASE = process.env.LAB_APP_URL ?? "http://127.0.0.1:23302";
const MAIL = process.env.LAB_MAIL_URL ?? "http://127.0.0.1:23402";
const LAB = process.env.LAB_NAME ?? "entities";
const PASSWORD = process.env.LAB_PASSWORD;
if (!PASSWORD) throw new Error("LAB_PASSWORD is required");
const OUT = process.env.OUT ?? path.join(here, "walkthrough-r1.json");
const ONLY = process.env.ONLY ?? "all"; // all | create | publish
const ROLES = (process.env.ROLES ?? "legal_team_member,administrator").split(",");

const ACCOUNTS = {
  administrator: { email: "daniel.okafor@helix.example", name: "Daniel Okafor", tag: "Admin" },
  legal_team_member: { email: "nadia.haddad@helix.example", name: "Nadia Haddad", tag: "LTM" },
  business_user_staff: { email: "ravi.menon@helix.example", name: "Ravi Menon" },
  portal_reader: { email: "jonas.weber@helix.example", name: "Jonas Weber" },
};

const stamp = randomBytes(3).toString("hex").toUpperCase();
const FIX = path.join(here, "fixtures");
const WORK = path.join(os.tmpdir(), `doc029-knowledge-${stamp}`);
mkdirSync(WORK, { recursive: true });

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}
function copyFixture(source, name) {
  const target = path.join(WORK, name);
  copyFileSync(path.join(FIX, source), target);
  return target;
}

function labIdentity() {
  const status = execFileSync(
    "mise",
    ["exec", "--", "node", "scripts/documentation/lab.mjs", "status", LAB],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  const project = status.match(/(openlaw-docs-[0-9a-f]+-[a-z0-9-]+)-app-1/)?.[1] ?? null;
  const source = status.match(/source ([0-9a-f]{40})/)?.[1] ?? null;
  const inspect = (tag) =>
    execFileSync("docker", ["image", "inspect", "-f", "{{.Id}}", tag], { encoding: "utf8" }).trim();
  const short = source?.slice(0, 12);
  return {
    project,
    appCommit: source,
    appImage: project ? inspect(`${project}-app:${short}`) : null,
    engineImage: project ? inspect(`${project}-engine:${short}`) : null,
  };
}

const results = {
  name: "walkthrough-r1",
  batch: "DOC-029",
  group: "knowledge",
  round: 1,
  reviewer: "DOC-029 independent walkthrough agent (knowledge, round 1)",
  reviewerKind: "agent",
  lab: LAB,
  labIdentity: labIdentity(),
  articleHashes: ["create-knowledge", "publish-knowledge"].map((id) => ({
    articleId: id,
    contentSha256: sha256(readFileSync(path.join(root, "docs/user-guides", `${id}.md`))),
  })),
  fixtures: Object.fromEntries(
    [
      "doc029-policy-a.pdf",
      "doc029-policy-b.pdf",
      "doc029-playbook.docx",
      "doc029-playbook-v2.docx",
      "doc029-checklist.pdf",
    ].map((name) => [name, sha256(readFileSync(path.join(FIX, name)))]),
  ),
  stamp,
  startedAt: new Date().toISOString(),
  completedAt: null,
  steps: [],
  records: [],
  cleanup: [],
};
function save() {
  results.completedAt = new Date().toISOString();
  results.passed = results.steps.length > 0 && results.steps.every((s) => s.result === "pass");
  writeFileSync(OUT, JSON.stringify(results, null, 2) + "\n");
}

async function step(role, article, action, expected, fn) {
  const entry = {
    role,
    article,
    method: "browser-walkthrough",
    action,
    expected,
    actual: null,
    result: "not-run",
    startedAt: new Date().toISOString(),
    completedAt: null,
  };
  results.steps.push(entry);
  try {
    entry.actual = await fn();
    entry.result = "pass";
  } catch (error) {
    entry.actual = `Check did not pass: ${error instanceof Error ? error.message.split("\n").slice(0, 6).join(" ") : String(error)}`;
    entry.result = "fail";
  }
  entry.completedAt = new Date().toISOString();
  console.log(`[${role}] ${entry.result.toUpperCase()} ${article}: ${action}`);
  if (entry.result === "fail") console.log(`    ${entry.actual}`);
  save();
  return entry.result === "pass";
}
function expectThat(condition, message) {
  if (!condition) throw new Error(message);
}
const q = (s) => JSON.stringify(s);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, message, timeout = 15000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(250);
  }
  throw new Error(message);
}

// ---------- sessions ----------
async function staffSignIn(browser, account) {
  const context = await browser.newContext({ baseURL: BASE, acceptDownloads: true });
  const page = await context.newPage();
  await page.goto("/auth/login");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/login"), { timeout: 20000 });
  return { context, page };
}

async function portalMagicLink(browser, account) {
  const context = await browser.newContext({ baseURL: BASE, acceptDownloads: true });
  const page = await context.newPage();
  const requestedAt = Date.now();
  await page.goto("/portal/login");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.getByLabel("Email").fill(account.email);
  await page.getByRole("button", { name: "Send link" }).click();
  await page.getByText("Check your email").waitFor();
  let link = null;
  for (let attempt = 0; attempt < 60 && !link; attempt++) {
    const search = await fetch(
      `${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${account.email}"`)}`,
    ).then((r) => r.json());
    for (const message of search.messages ?? []) {
      if (new Date(message.Created).getTime() < requestedAt - 2000) continue;
      const full = await fetch(`${MAIL}/api/v1/message/${message.ID}`).then((r) => r.json());
      const match = full.Text.match(/https?:\/\/\S+\/magic-link\/verify\S*/);
      if (match) {
        link = match[0];
        break;
      }
    }
    if (!link) await sleep(500);
  }
  if (!link) throw new Error(`no fresh sign-in link for ${account.name}`);
  const url = new URL(link);
  const lab = new URL(BASE);
  url.protocol = lab.protocol;
  url.host = lab.host;
  await page.goto(url.toString());
  await page.waitForURL((u) => u.pathname.startsWith("/portal"), { timeout: 20000 });
  expectThat(!page.url().includes("/portal/login"), "magic link did not sign in");
  return { context, page };
}

async function apiJson(page, method, url, options = {}) {
  const response = await page.request.fetch(url, {
    method,
    headers: { origin: BASE, ...(options.headers ?? {}) },
    ...(options.data !== undefined ? { data: options.data } : {}),
    ...(options.multipart ? { multipart: options.multipart } : {}),
    maxRedirects: 0,
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status(), body };
}
async function readItem(page, id) {
  const { status, body } = await apiJson(page, "GET", `/api/v1/knowledge/${id}`);
  expectThat(status === 200, `item read answered ${status}`);
  return body.knowledgeItem;
}
async function readDocuments(page, id, includeArchived = false) {
  const { status, body } = await apiJson(
    page,
    "GET",
    `/api/v1/knowledge/${id}/documents${includeArchived ? "?includeArchived=true" : ""}`,
  );
  expectThat(status === 200, `documents read answered ${status}`);
  return body.documents;
}
async function readFolders(page) {
  const { body } = await apiJson(page, "GET", "/api/v1/knowledge/folders");
  return body.folders;
}
function uploadFile(filePath, mimeType) {
  return { name: path.basename(filePath), mimeType, buffer: readFileSync(filePath) };
}

// ---------- UI helpers ----------
const itemsRegion = (page) => page.getByRole("region", { name: "Knowledge items" });
const folderTree = (page) => page.getByRole("complementary", { name: "Knowledge folders" });
function folderButton(page, name) {
  return folderTree(page).getByRole("button", { name: new RegExp(`^${escapeRe(name)}\\s*\\d*$`) });
}
async function openKnowledge(page) {
  await page.goto("/");
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
  await sleep(500);
  const region = itemsRegion(page);
  const empty = await region.getByText("No Knowledge items match these filters").count();
  if (empty) return [];
  return region
    .locator("tbody tr")
    .evaluateAll((rows) =>
      rows.map((row) => (row.querySelector("td")?.innerText ?? "").split("\n")[0].trim()),
    );
}
async function addFolder(page, name) {
  await folderTree(page).getByRole("button", { name: "Add folder" }).click();
  const dialog = page.getByRole("dialog", { name: "Add folder" });
  await dialog.getByLabel("Folder name").fill(name);
  await dialog.getByRole("button", { name: "Add folder" }).click();
  await dialog.waitFor({ state: "hidden" });
  const folder = await until(
    async () => (await readFolders(page)).find((row) => row.name === name),
    `folder ${name} not saved`,
  );
  await folderButton(page, name).waitFor();
  return folder;
}
async function chooseFiles(page, trigger, files) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), trigger.click()]);
  await chooser.setFiles(files);
}
async function optionTexts(locator) {
  return locator.evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()));
}
async function openRecord(page, id) {
  await page.goto(`/knowledge/${id}`);
  await page.locator("#knowledge-record-type").waitFor({ timeout: 20000 });
  await page.getByRole("region", { name: "Guidance", exact: true }).waitFor();
}
async function recordActions(page) {
  await page.getByRole("button", { name: "Knowledge Item actions" }).click();
  return page.getByRole("menu");
}
async function markers(page) {
  const bar = page.locator("section[aria-labelledby='page-title']");
  const text = await bar.innerText();
  return {
    draft: /\bDraft\b/.test(text),
    onPortal: /On the portal/.test(text),
    archived: /\bArchived\b/.test(text),
  };
}
async function waitMarkers(page, wanted, message) {
  return until(async () => {
    const m = await markers(page);
    return Object.entries(wanted).every(([k, v]) => m[k] === v) ? m : null;
  }, message);
}

// ---------- create-knowledge (V-C33) ----------
async function createKnowledge(role, page, account, shared) {
  const A = "create-knowledge";
  const base = `DOC-029 knowledge ${account.tag} ${stamp}`;
  const ctx = {};

  await step(
    role,
    A,
    "Before you start: open Knowledge from the navigation",
    "Knowledge opens with New, All Knowledge and the Knowledge items list.",
    async () => {
      await openKnowledge(page);
      await page.getByRole("button", { name: "New", exact: true }).waitFor();
      await folderTree(page).getByRole("button", { name: "All Knowledge" }).waitFor();
      return `The navigation link Knowledge opened /knowledge with the New button, the All Knowledge folder entry and the Knowledge items region as ${account.name}.`;
    },
  );

  await step(
    role,
    A,
    "Organize the library step 2: Add folder at top level, then a child under the selected folder",
    "With All Knowledge selected the folder is top-level; with a folder selected the new folder is its child.",
    async () => {
      await selectAll(page);
      ctx.parent = await addFolder(page, `${base} parent`);
      expectThat(ctx.parent.parentId === null, "top-level folder has a parent");
      await selectFolder(page, `${base} parent`);
      ctx.child = await addFolder(page, `${base} child`);
      expectThat(
        ctx.child.parentId === ctx.parent.id,
        "child folder not under the selected folder",
      );
      results.records.push({ role, kind: "folders", names: [`${base} parent`, `${base} child`] });
      return `Add folder with All Knowledge selected saved "${base} parent" with no parent. With that folder selected, Add folder saved "${base} child" with the parent folder as its parent.`;
    },
  );

  await step(
    role,
    A,
    "Start with files step 2: Folder starts at the selected folder, or at Library",
    "New from files shows Library with All Knowledge selected and the selected folder otherwise.",
    async () => {
      await selectAll(page);
      await page.getByRole("button", { name: "New", exact: true }).click();
      await page.getByRole("menuitem", { name: "New from files" }).click();
      let dialog = page.getByRole("dialog", { name: "New from files" });
      const rootValue = await dialog.locator("#knowledge-files-folder").inputValue();
      const rootLabel = await dialog.locator("#knowledge-files-folder option:checked").innerText();
      expectThat(rootValue === "" && rootLabel.trim() === "Library", `root default ${rootLabel}`);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      await selectFolder(page, `${base} parent`);
      await page.getByRole("button", { name: "New", exact: true }).click();
      await page.getByRole("menuitem", { name: "New from files" }).click();
      dialog = page.getByRole("dialog", { name: "New from files" });
      const selectedValue = await dialog.locator("#knowledge-files-folder").inputValue();
      expectThat(
        selectedValue === ctx.parent.id,
        "folder default did not follow the selected folder",
      );
      return `With All Knowledge selected the Folder control read Library. With "${base} parent" selected it started at that folder.`;
    },
  );

  await step(
    role,
    A,
    "Start with files steps 2-3: choose two files, a Type, and Create drafts",
    "Each file creates a separate draft item named after the file, with its own primary Document; the first item opens and the other is in Knowledge.",
    async () => {
      const dialog = page.getByRole("dialog", { name: "New from files" });
      const fileA = copyFixture("doc029-policy-a.pdf", `${base} policy A.pdf`);
      const fileB = copyFixture("doc029-policy-b.pdf", `${base} policy B.pdf`);
      await chooseFiles(page, dialog.getByText("Drop files here or choose files"), [fileA, fileB]);
      await dialog.getByText("2 files selected").waitFor();
      await dialog.locator("#knowledge-files-type").selectOption({ label: "Precedent" });
      await dialog.getByRole("button", { name: "Create drafts" }).click();
      await page.waitForURL(/\/knowledge\/[0-9a-f-]{36}$/, { timeout: 30000 });
      const firstId = page.url().split("/").pop();
      const heading = await until(async () => {
        const text = (
          await page
            .locator("#page-title")
            .innerText()
            .catch(() => "")
        ).trim();
        return text.startsWith(base) ? text : null;
      }, "record heading did not render");
      const m = await markers(page);
      expectThat(m.draft, "first item has no Draft marker");
      const first = await readItem(page, firstId);
      expectThat(
        [`${base} policy A.pdf`, `${base} policy B.pdf`].includes(first.title),
        `title ${first.title}`,
      );
      expectThat(heading === first.title, "heading does not match");
      expectThat(
        first.state === "draft" && first.audience === "legal_only",
        "not draft/legal only",
      );
      expectThat(first.folderId === ctx.parent.id, "first item not in the chosen folder");
      expectThat(first.knowledgeTypeName === "Precedent", `type ${first.knowledgeTypeName}`);
      expectThat(
        first.primaryDocument && first.documentCount === 1,
        "first item has no single primary Document",
      );
      const primaryControl = await page
        .getByRole("button", { name: `Open preview of ${first.primaryDocument.title}` })
        .count();
      expectThat(primaryControl === 1, "Primary document control does not name the file");
      await page
        .locator("section[aria-labelledby='page-title']")
        .getByRole("link", { name: "Knowledge" })
        .click();
      await page.waitForURL(/\/knowledge$/);
      await selectFolder(page, `${base} parent`);
      const titles = await listTitles(page);
      const other = first.title.endsWith("A.pdf") ? `${base} policy B.pdf` : `${base} policy A.pdf`;
      expectThat(
        titles.includes(other) && titles.includes(first.title),
        `list titles ${q(titles)}`,
      );
      const { body } = await apiJson(page, "GET", `/api/v1/knowledge?folder=${ctx.parent.id}`);
      const otherRow = body.knowledgeItems.find((row) => row.title === other);
      expectThat(
        otherRow &&
          otherRow.state === "draft" &&
          otherRow.primaryDocument &&
          otherRow.documentCount === 1,
        "second item not a separate draft with its own primary",
      );
      ctx.itemA = first.title.endsWith("A.pdf") ? first : otherRow;
      ctx.itemB = first.title.endsWith("A.pdf") ? otherRow : first;
      results.records.push({ role, kind: "knowledge items", names: [first.title, other] });
      return `Create drafts opened ${q(first.title)} with the Draft marker, Legal Only, Type Precedent, the parent folder and its file under Primary document. The Knowledge breadcrumb returned to the list, and the parent folder listed both ${q(`${base} policy A.pdf`)} and ${q(`${base} policy B.pdf`)}. Each was a draft with one Document of its own as primary.`;
    },
  );

  await step(
    role,
    A,
    "Start with files step 4: Title saves on Enter and on leaving the field; Type and Folder save on change",
    "Each value is saved and survives a reload.",
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
        type: (await page.locator("#knowledge-record-type option:checked").innerText()).trim(),
        folder: await page.locator("#knowledge-record-folder").inputValue(),
        heading: (await page.getByRole("heading", { level: 1 }).innerText()).trim(),
      };
      expectThat(
        after.title === `${base} policy A reviewed` && after.heading === after.title,
        `title after reload ${after.title}`,
      );
      expectThat(
        after.type === "Playbook" && after.folder === ctx.child.id,
        "type or folder lost after reload",
      );
      ctx.itemA.title = after.title;
      return `Enter saved ${q(`${base} policy A renamed`)}. Moving focus to Type saved ${q(after.title)}. Type Playbook and Folder "${base} child" saved on change. After a reload the title, heading, Type and Folder showed the saved values.`;
    },
  );

  await step(
    role,
    A,
    "Start with guidance steps 1-2: New Knowledge Item with Attach documents; a failed upload offers Retry failed uploads",
    "The item exists after the failed upload; Retry failed uploads uploads the file; the item is Draft and Legal Only.",
    async () => {
      await page.goto("/knowledge");
      await itemsRegion(page).waitFor();
      await page.getByRole("button", { name: "New", exact: true }).click();
      await page.getByRole("menuitem", { name: "New Knowledge Item" }).click();
      const dialog = page.getByRole("dialog", { name: "New Knowledge Item" });
      await dialog.locator("#knowledge-title").fill(`${base} guidance`);
      await dialog.locator("#knowledge-type").selectOption({ label: "Article" });
      await dialog.locator("#knowledge-folder").selectOption(ctx.parent.id);
      const docx = copyFixture("doc029-playbook.docx", `${base} playbook.docx`);
      await chooseFiles(page, dialog.locator("button", { hasText: "Attach documents" }), [docx]);
      await dialog.getByLabel("Document kind").selectOption({ label: "Draft · theirs" });
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
      const { body } = await apiJson(page, "GET", `/api/v1/knowledge?folder=${ctx.parent.id}`);
      const existing = body.knowledgeItems.find((row) => row.title === `${base} guidance`);
      expectThat(existing && existing.documentCount === 0, "item missing after the failed upload");
      await page.unroute("**/api/v1/knowledge/*/documents");
      await retry.click();
      await page.waitForURL(new RegExp(`/knowledge/${existing.id}$`), { timeout: 30000 });
      const item = await readItem(page, existing.id);
      expectThat(
        item.state === "draft" && item.audience === "legal_only",
        "not Draft / Legal Only",
      );
      expectThat(
        item.primaryDocument?.title && item.documentCount === 1,
        "retried upload did not become the primary Document",
      );
      const m = await markers(page);
      expectThat(m.draft, "no Draft marker");
      const audience = (
        await page.locator("#knowledge-record-audience option:checked").innerText()
      ).trim();
      expectThat(audience === "Legal Only", `audience ${audience}`);
      const docs = await readDocuments(page, existing.id);
      const kind = docs[0].versions?.[0]?.kind ?? docs[0].currentVersion?.kind ?? null;
      ctx.guidance = item;
      ctx.docxTitle = item.primaryDocument.title;
      results.records.push({ role, kind: "knowledge item", names: [`${base} guidance`] });
      return `New Knowledge Item took Title, Type Article, Folder and one attached DOCX with Document kind "Draft · theirs". The reviewer's browser dropped the first upload request. The dialog then read "Record created. Some documents could not be uploaded." and offered Retry failed uploads and Continue, and the item already existed with no Document. Retry failed uploads uploaded the file and opened the item: Draft marker, Audience Legal Only, and ${q(ctx.docxTitle)} under Primary document (kind ${kind}).`;
    },
  );

  await step(
    role,
    A,
    "Start with guidance step 2: Continue after a failed upload keeps the item",
    "Continue opens the created item without the failed file.",
    async () => {
      await page.goto("/knowledge");
      await itemsRegion(page).waitFor();
      await page.getByRole("button", { name: "New", exact: true }).click();
      await page.getByRole("menuitem", { name: "New Knowledge Item" }).click();
      const dialog = page.getByRole("dialog", { name: "New Knowledge Item" });
      await dialog.locator("#knowledge-title").fill(`${base} continue`);
      const pdf = copyFixture("doc029-checklist.pdf", `${base} continue checklist.pdf`);
      await chooseFiles(page, dialog.locator("button", { hasText: "Attach documents" }), [pdf]);
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
      expectThat(
        item.title === `${base} continue` && item.documentCount === 0 && !item.primaryDocument,
        "continue item wrong",
      );
      ctx.continueItem = item;
      results.records.push({ role, kind: "knowledge item", names: [`${base} continue`] });
      return `With the upload request dropped, Continue closed the dialog and opened ${q(item.title)}: a Draft item with no Document and Primary document None.`;
    },
  );

  await step(
    role,
    A,
    "Start with guidance steps 3-4: Add guidance, Preview renders Markdown and saves on blur, Edit returns to the source",
    "Headings, lists, emphasis, code and links render; raw HTML is not rendered as HTML; the source survives a reload.",
    async () => {
      await openRecord(page, ctx.guidance.id);
      const guidance = page.getByRole("region", { name: "Guidance", exact: true });
      await guidance.getByRole("button", { name: "Add guidance" }).click();
      const editor = page.locator("#knowledge-body");
      await editor.waitFor();
      const helpText = (await guidance.innerText()).trim();
      expectThat(
        /Use Preview to see how your guidance will appear to readers\./.test(helpText),
        "help text missing",
      );
      expectThat(!/markdown/i.test(helpText), "the editor names Markdown rules");
      const source = [
        `## ${base} supplier checks`,
        "",
        "Use this **fictional** list before *onboarding* a supplier.",
        "",
        "- Check the `vendor-id` field",
        "- Read the [supplier policy](https://example.com/doc029-policy)",
        "",
        "<b>raw-html-doc029</b>",
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
        rawB: [...el.querySelectorAll("b")].some((n) => n.textContent === "raw-html-doc029"),
        text: el.innerText,
      }));
      expectThat(
        rendered.strong.includes("fictional") && rendered.em.includes("onboarding"),
        "emphasis not rendered",
      );
      expectThat(
        rendered.li === 2 && rendered.code.includes("vendor-id"),
        "list or code not rendered",
      );
      expectThat(rendered.links.includes("https://example.com/doc029-policy"), "link not rendered");
      expectThat(!rendered.rawB, "raw HTML rendered as HTML");
      await guidance.getByRole("button", { name: "Edit" }).click();
      expectThat((await editor.inputValue()) === source, "Edit did not return to the source");
      await page.reload();
      await page.locator("#knowledge-record-type").waitFor({ timeout: 20000 });
      await page.locator("#knowledge-body").waitFor();
      expectThat(
        (await page.locator("#knowledge-body").inputValue()) === source,
        "source lost after reload",
      );
      return `Add guidance opened the editor. Its only help text was "Use Preview to see how your guidance will appear to readers." and it named no Markdown rules. Preview saved the source on blur and rendered the heading, bold and italic text, a two-item list, inline code and the link. The raw <b> tag did not become a bold element (visible text: ${q(rendered.text.includes("raw-html-doc029") ? "tag text shown as text" : "tag removed")}). Edit showed the source again, and the source was still there after a reload.`;
    },
  );

  await step(
    role,
    A,
    "Add Documents step 1: upload a new Document in the Documents section",
    "Upload adds a new v1 Document; the first Document stays primary.",
    async () => {
      const documents = page.getByRole("region", { name: /^Documents/ }).first();
      await page.getByRole("button", { name: "Upload", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Upload document" });
      const pdf = copyFixture("doc029-checklist.pdf", `${base} supporting checklist.pdf`);
      await chooseFiles(page, dialog.getByRole("button", { name: /Choose files/ }), [pdf]);
      await dialog.locator("#document-kind").waitFor();
      const chooseFolder = await dialog.getByRole("button", { name: /Choose folder/ }).count();
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      const docs = await until(async () => {
        const rows = await readDocuments(page, ctx.guidance.id);
        return rows.length === 2 ? rows : null;
      }, "second Document not listed");
      const pdfDoc = docs.find((d) => d.title !== ctx.docxTitle);
      const docxDoc = docs.find((d) => d.title === ctx.docxTitle);
      expectThat(docxDoc.isPrimary && !pdfDoc.isPrimary, "first Document is no longer primary");
      ctx.pdfTitle = pdfDoc.title;
      ctx.pdfDocId = pdfDoc.id;
      ctx.docxDocId = docxDoc.id;
      const newFolderButton = await page.getByRole("button", { name: "New folder" }).count();
      ctx.flatObservation = { newFolderButton, chooseFolder };
      return `Upload, Choose files and Upload added ${q(ctx.pdfTitle)} as a second Document with v1. ${q(ctx.docxTitle)}, the first Document, kept the primary designation. The Documents section offered no New folder button (count ${newFolderButton}). The upload dialog offered Choose folder ${chooseFolder} time(s).`;
    },
  );

  await step(
    role,
    A,
    "Add Documents step 2: Set as primary moves the Primary mark and the Primary document control",
    "The chosen Document shows Primary and is named under Primary document.",
    async () => {
      await page.getByRole("button", { name: `Actions for ${ctx.docxTitle}` }).click();
      const noSetOnPrimary = await page.getByRole("menuitem", { name: "Set as primary" }).count();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: `Actions for ${ctx.pdfTitle}` }).click();
      await page.getByRole("menuitem", { name: "Set as primary" }).click();
      await page
        .getByRole("button", { name: `Open preview of ${ctx.pdfTitle}` })
        .waitFor({ timeout: 15000 });
      const docs = await readDocuments(page, ctx.guidance.id);
      expectThat(
        docs.find((d) => d.id === ctx.pdfDocId).isPrimary &&
          !docs.find((d) => d.id === ctx.docxDocId).isPrimary,
        "designation did not move",
      );
      const rowText = await page
        .getByRole("button", { name: `Actions for ${ctx.pdfTitle}` })
        .locator("xpath=ancestor::*[self::tr or self::li][1]")
        .innerText();
      expectThat(/Primary/.test(rowText), "Primary mark missing on the chosen row");
      expectThat(noSetOnPrimary === 0, "Set as primary offered on the primary row");
      return `The primary row's Actions menu offered no Set as primary. On ${q(ctx.pdfTitle)} Actions, Set as primary put the Primary mark on that row, and the Primary document control above the Documents section changed to that title.`;
    },
  );

  await step(
    role,
    A,
    "Add Documents step 3: Open preview reads the primary Document's current Version; the other Document keeps its own Version history",
    "The reader opens on the primary's current Version; a new Version on the supporting Document stays on its own chain.",
    async () => {
      await page.getByRole("button", { name: `Open preview of ${ctx.pdfTitle}` }).click();
      const close = page.getByRole("button", { name: "Close the document" });
      await close.waitFor({ timeout: 20000 });
      const readerLabel = await page.getByLabel(`${ctx.pdfTitle}, version 1`).count();
      expectThat(readerLabel > 0, "reader is not labelled with the current Version");
      await close.click();
      await close.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: `Actions for ${ctx.docxTitle}` }).click();
      await page.getByRole("menuitem", { name: "Add version" }).click();
      const dialog = page.getByRole("dialog", { name: "Add version" });
      const v2 = copyFixture("doc029-playbook-v2.docx", `${base} playbook v2.docx`);
      await chooseFiles(page, dialog.getByRole("button", { name: /Choose file/ }), [v2]);
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      const docs = await until(async () => {
        const rows = await readDocuments(page, ctx.guidance.id);
        return rows.find((d) => d.id === ctx.docxDocId).versions.length === 2 ? rows : null;
      }, "supporting Document did not get Version 2");
      const pdfDoc = docs.find((d) => d.id === ctx.pdfDocId);
      expectThat(
        pdfDoc.isPrimary && pdfDoc.versions.length === 1,
        "primary changed by supporting version",
      );
      return `Open preview opened the document reader for ${q(ctx.pdfTitle)} labelled \"${ctx.pdfTitle}, version 1\", the current Version, and Close the document shut it. Add version on the supporting DOCX made Version 2 on that Document only. The primary PDF kept one Version and its designation.`;
    },
  );

  await step(
    role,
    A,
    "Add Documents closing text: archiving the primary Document preserves Versions and designation and picks no replacement; restore returns it",
    "The archived primary leaves the ordinary list, no other row becomes Primary, and restore returns it with its designation.",
    async () => {
      await page.getByRole("button", { name: `Actions for ${ctx.pdfTitle}` }).click();
      await page.getByRole("menuitem", { name: "Archive" }).click();
      const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog"));
      if (await confirm.count()) {
        await confirm.getByRole("button", { name: "Archive" }).click();
      }
      await until(
        async () =>
          (await page.getByRole("button", { name: `Actions for ${ctx.pdfTitle}` }).count()) === 0,
        "archived Document still in the ordinary list",
      );
      const docxRow = await page
        .getByRole("button", { name: `Actions for ${ctx.docxTitle}` })
        .locator("xpath=ancestor::*[self::tr or self::li][1]")
        .innerText();
      expectThat(!/\bPrimary\b/.test(docxRow), "a replacement primary was chosen");
      const archivedDocs = await readDocuments(page, ctx.guidance.id, true);
      const archived = archivedDocs.find((d) => d.id === ctx.pdfDocId);
      expectThat(
        archived.archivedAt && archived.isPrimary && archived.versions.length === 1,
        "archived Document lost its designation or Versions",
      );
      await page.getByLabel("Show archived").click();
      await page.getByRole("button", { name: `Actions for ${ctx.pdfTitle}` }).click();
      await page.getByRole("menuitem", { name: "Restore" }).click();
      await until(
        async () =>
          !(await readDocuments(page, ctx.guidance.id)).find((d) => d.id === ctx.pdfDocId)
            ?.archivedAt === false ||
          (await readDocuments(page, ctx.guidance.id)).some((d) => d.id === ctx.pdfDocId),
        "restore did not return the Document",
      );
      await page.reload();
      await page.locator("#knowledge-record-type").waitFor({ timeout: 20000 });
      await page.getByRole("button", { name: `Open preview of ${ctx.pdfTitle}` }).waitFor();
      const restoredRow = await page
        .getByRole("button", { name: `Actions for ${ctx.pdfTitle}` })
        .locator("xpath=ancestor::*[self::tr or self::li][1]")
        .innerText();
      expectThat(/Primary/.test(restoredRow), "restored row lost Primary");
      return `Archive took ${q(ctx.pdfTitle)} out of the ordinary Documents list. The supporting DOCX did not get the Primary mark. With archived rows included, the PDF still had its one Version and its primary designation. Show archived and Restore returned it to the ordinary list with the Primary mark, and the Primary document control named it after a reload.`;
    },
  );

  await step(
    role,
    A,
    "Add Documents closing text: an item's Documents use a flat list, even when files come from Choose folder",
    "The Documents section has no New folder control, and a folder pick imports its file at the item root with no Document folder.",
    async () => {
      await openRecord(page, ctx.guidance.id);
      const newFolder = await page.getByRole("button", { name: "New folder" }).count();
      await page.getByRole("button", { name: "Upload", exact: true }).click();
      const dir = path.join(WORK, `${account.tag}-folder-pick`, "inner");
      mkdirSync(dir, { recursive: true });
      copyFileSync(
        path.join(FIX, "doc029-checklist.pdf"),
        path.join(dir, `${base} folder pick.pdf`),
      );
      await page.locator("#document-directory").setInputFiles(path.dirname(dir));
      const importButton = page
        .getByRole("dialog")
        .getByRole("button", { name: /^Import 1 file$/ });
      await importButton.waitFor({ timeout: 15000 });
      await importButton.click();
      const docs = await until(async () => {
        const rows = await readDocuments(page, ctx.guidance.id);
        return rows.some((d) => d.title === `${base} folder pick.pdf`) ? rows : null;
      }, "folder pick did not import");
      const picked = docs.find((d) => d.title === `${base} folder pick.pdf`);
      expectThat(
        newFolder === 0 && picked.folderId === null && docs.every((d) => d.folderId === null),
        "Documents are not flat",
      );
      return `The Documents section had no New folder button. Upload, Choose folder on a folder holding one file in a subfolder offered Import 1 file, and the import placed ${q(picked.title)} at the item root with no Document folder, beside the other Documents (${docs.length} in the flat list).`;
    },
  );

  await step(
    role,
    A,
    "Organize the library step 1: All Knowledge, a folder with its descendants, and separate filters",
    "A folder lists its descendants; Type, State, Audience, Author and Format narrow the list; clearing restores it.",
    async () => {
      await page.goto("/knowledge");
      await itemsRegion(page).waitFor();
      for (const label of ["Type", "State", "Audience", "Author", "Format"]) {
        await page.getByRole("combobox", { name: label, exact: true }).first().waitFor();
      }
      await selectFolder(page, `${base} parent`);
      let titles = await listTitles(page);
      expectThat(
        titles.includes(ctx.itemA.title) &&
          titles.includes(ctx.itemB.title) &&
          titles.includes(`${base} guidance`),
        `parent folder list ${q(titles)}`,
      );
      await selectFolder(page, `${base} child`);
      titles = await listTitles(page);
      expectThat(
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
      expectThat(
        titles.includes(ctx.itemB.title) && !titles.includes(ctx.itemA.title),
        `type filter ${q(titles)}`,
      );
      await page
        .getByRole("combobox", { name: "State", exact: true })
        .first()
        .selectOption({ label: "Published" });
      await sleep(800);
      titles = await listTitles(page);
      expectThat(!titles.includes(ctx.itemB.title), "State Published did not hide the draft");
      const emptyShown = await itemsRegion(page)
        .getByText("No Knowledge items match these filters")
        .count();
      await page.getByRole("button", { name: "Clear filters" }).first().click();
      await sleep(800);
      await selectFolder(page, `${base} parent`);
      await page
        .getByRole("combobox", { name: "Author", exact: true })
        .first()
        .selectOption({ label: account.name });
      await sleep(800);
      titles = await listTitles(page);
      expectThat(titles.includes(ctx.itemB.title), `author ${q(titles)}`);
      await page
        .getByRole("combobox", { name: "Format", exact: true })
        .first()
        .selectOption({ label: "Word" });
      await sleep(800);
      titles = await listTitles(page);
      expectThat(
        !titles.includes(ctx.itemB.title),
        `author+format Word kept the PDF item ${q(titles)}`,
      );
      const guidanceWithWord = titles.includes(`${base} guidance`);
      await page
        .getByRole("combobox", { name: "Format", exact: true })
        .first()
        .selectOption({ label: "PDF" });
      await sleep(800);
      titles = await listTitles(page);
      expectThat(titles.includes(ctx.itemB.title), `format PDF ${q(titles)}`);
      await page
        .getByRole("combobox", { name: "Audience", exact: true })
        .first()
        .selectOption({ label: "Everyone" });
      await sleep(800);
      titles = await listTitles(page);
      expectThat(!titles.includes(ctx.itemB.title), "Audience Everyone kept a Legal Only item");
      await page.getByRole("button", { name: "Clear filters" }).first().click();
      await sleep(800);
      await selectFolder(page, `${base} parent`);
      titles = await listTitles(page);
      expectThat(
        titles.includes(ctx.itemB.title) && titles.includes(ctx.itemA.title),
        "items did not return after clearing",
      );
      return `Type, State, Audience, Author and Format were each offered. The parent folder listed the item in its child folder as well as its own items; the child folder listed only its item. Type Precedent dropped the Playbook item. State Published hid the drafts (empty-state text shown: ${emptyShown > 0}). Author ${account.name} kept the PDF item; adding Format Word dropped it (guidance item listed under Word: ${guidanceWithWord}), and Format PDF brought it back. Audience Everyone then hid that Legal Only item. Clear filters and reselecting the folder brought all items back.`;
    },
  );

  await step(
    role,
    A,
    "Organize the library step 3: Rename or move selected folder excludes the folder and its descendants and saves the change",
    "Parent folder omits the folder and its child; Save folder renames or moves it.",
    async () => {
      await selectAll(page);
      ctx.target = await addFolder(page, `${base} target`);
      await selectFolder(page, `${base} parent`);
      await page.getByRole("button", { name: "Rename or move selected folder" }).click();
      let dialog = page.getByRole("dialog", { name: "Rename or move folder" });
      const options = await dialog
        .locator("#knowledge-folder-parent option")
        .evaluateAll((els) => els.map((e) => e.value));
      expectThat(
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
      await dialog.locator("#knowledge-folder-parent").selectOption(ctx.target.id);
      await dialog.getByRole("button", { name: "Save folder" }).click();
      await dialog.waitFor({ state: "hidden" });
      const folders = await until(async () => {
        const rows = await readFolders(page);
        return rows.find((r) => r.id === ctx.child.id)?.parentId === ctx.target.id ? rows : null;
      }, "child folder did not move");
      await selectFolder(page, `${base} target`);
      const titles = await listTitles(page);
      expectThat(
        titles.includes(ctx.itemA.title),
        "moved folder's item not listed under the new parent",
      );
      expectThat(
        (await readItem(page, ctx.itemA.id)).folderId === ctx.child.id,
        "item left its folder",
      );
      return `In Rename or move folder for the parent folder, Parent folder offered Library, other folders and "${base} target", but not the folder itself or its child. Save folder renamed it to "${base} parent renamed". Moving the child folder under "${base} target" with Parent folder and Save folder kept its item in it, and the target folder listed that item.`;
    },
  );

  await step(
    role,
    A,
    "Organize the library step 4: up/down controls change sibling order",
    "Move up then Move down changes the saved order and returns it.",
    async () => {
      await selectFolder(page, `${base} target`);
      const orderOf = async () => {
        const rows = await readFolders(page);
        const siblings = rows
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
      return `The target folder was at sibling position ${start + 1}. Move up saved position ${start}, and Move down saved position ${start + 1} again (${clicks} click(s) in total).`;
    },
  );

  await step(
    role,
    A,
    "Organize the library step 5: Delete selected folder moves its items and child folders to its parent",
    "The confirmation says nothing is deleted; the child folder and the item remain with their Documents.",
    async () => {
      await selectFolder(page, `${base} target`);
      await page.getByRole("button", { name: "Delete selected folder" }).click();
      const dialog = page.getByRole("dialog", { name: `Delete the ${base} target folder?` });
      const text = await dialog.innerText();
      expectThat(
        /Its folders and items move to the parent folder\. Nothing is deleted\./.test(text),
        "confirmation text differs",
      );
      await dialog.getByRole("button", { name: "Delete folder" }).click();
      await dialog.waitFor({ state: "hidden" });
      const folders = await readFolders(page);
      expectThat(!folders.some((r) => r.id === ctx.target.id), "folder still exists");
      expectThat(
        folders.find((r) => r.id === ctx.child.id)?.parentId === null,
        "child did not move to the parent (Library)",
      );
      const item = await readItem(page, ctx.itemA.id);
      expectThat(
        item.folderId === ctx.child.id && item.documentCount === 1 && !item.archivedAt,
        "item or its Document changed",
      );
      return `The dialog "Delete the ${base} target folder?" read "Its folders and items move to the parent folder. Nothing is deleted." Delete folder removed the folder. Its child folder became top-level, and ${q(item.title)} stayed in that child folder with its one Document.`;
    },
  );

  await step(
    role,
    A,
    "Recover from an unavailable choice: Manage types… beside Type is for Administrators; archived types are not offered",
    "Only the Administrator sees Manage types…; the archived type is absent from the record and both create dialogs.",
    async () => {
      await openRecord(page, ctx.itemA.id);
      const manage = page.getByRole("link", { name: "Manage types…" });
      const manageCount = await manage.count();
      let manageTarget = null;
      if (role === "administrator") {
        expectThat(manageCount === 1, "Administrator has no Manage types…");
      } else {
        expectThat(manageCount === 0, "Legal Team Member sees Manage types…");
      }
      const recordOptions = await optionTexts(page.locator("#knowledge-record-type option"));
      await page.goto("/knowledge");
      await itemsRegion(page).waitFor();
      await page.getByRole("button", { name: "New", exact: true }).click();
      await page.getByRole("menuitem", { name: "New Knowledge Item" }).click();
      let dialog = page.getByRole("dialog", { name: "New Knowledge Item" });
      const createOptions = await optionTexts(dialog.locator("#knowledge-type option"));
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await page.getByRole("button", { name: "New", exact: true }).click();
      await page.getByRole("menuitem", { name: "New from files" }).click();
      dialog = page.getByRole("dialog", { name: "New from files" });
      const filesOptions = await optionTexts(dialog.locator("#knowledge-files-type option"));
      await dialog.getByRole("button", { name: "Cancel" }).click();
      for (const list of [recordOptions, createOptions, filesOptions]) {
        expectThat(!list.includes(shared.archivedTypeName), "archived type offered");
        expectThat(list.includes("Playbook"), "live type missing");
      }
      if (role === "administrator") {
        await openRecord(page, ctx.itemA.id);
        await page.getByRole("link", { name: "Manage types…" }).click();
        await page.waitForURL(/\/settings\/knowledge\/types$/);
        manageTarget = new URL(page.url()).pathname;
      }
      return `${role === "administrator" ? `Manage types… was beside Type and opened ${manageTarget}.` : "No Manage types… link was beside Type for the Legal Team Member."} The archived Knowledge type ${q(shared.archivedTypeName)} was absent from the record Type control, the New Knowledge Item dialog and the New from files dialog, while Playbook was offered in all three.`;
    },
  );

  await step(
    role,
    A,
    "Recover from an unavailable choice: an archived item cannot be edited or receive uploads; Restore makes it editable",
    "Archived disables Title, Type, Folder, Audience and guidance, hides Upload, and a direct upload is refused; Restore re-enables them.",
    async () => {
      await openRecord(page, ctx.guidance.id);
      const menu = await recordActions(page);
      await menu.getByRole("menuitem", { name: "Archive" }).click();
      const dialog = page.getByRole("dialog", { name: "Archive Knowledge Item" });
      await dialog.getByRole("button", { name: "Archive" }).click();
      await dialog.waitFor({ state: "hidden" });
      await waitMarkers(page, { archived: true }, "no Archived marker");
      const disabled = {};
      for (const id of [
        "knowledge-record-title",
        "knowledge-record-type",
        "knowledge-record-folder",
        "knowledge-record-audience",
      ]) {
        disabled[id] = await page.locator(`#${id}`).isDisabled();
      }
      disabled.guidanceEditor = await page
        .locator("#knowledge-body")
        .isDisabled({ timeout: 3000 })
        .catch(() => null);
      disabled.guidanceToggle = await page
        .getByRole("region", { name: "Guidance", exact: true })
        .getByRole("button")
        .first()
        .isDisabled();
      expectThat(
        Object.values(disabled).every((v) => v !== false),
        `controls not disabled ${q(disabled)}`,
      );
      const uploadCount = await page.getByRole("button", { name: "Upload", exact: true }).count();
      expectThat(uploadCount === 0, "Upload still offered");
      const refused = await apiJson(
        page,
        "POST",
        `/api/v1/knowledge/${ctx.guidance.id}/documents`,
        {
          multipart: {
            kind: "draft_ours",
            file: uploadFile(path.join(FIX, "doc029-checklist.pdf"), "application/pdf"),
          },
        },
      );
      expectThat(refused.status === 409, `direct upload answered ${refused.status}`);
      await page.reload();
      await page.locator("#knowledge-record-type").waitFor({ timeout: 20000 });
      await waitMarkers(page, { archived: true }, "archived record did not reopen");
      const menu2 = await recordActions(page);
      await menu2.getByRole("menuitem", { name: "Restore" }).click();
      await waitMarkers(page, { archived: false }, "Restore did not clear Archived");
      expectThat(
        !(await page.locator("#knowledge-record-title").isDisabled()),
        "title still disabled after restore",
      );
      await page.getByRole("button", { name: "Upload", exact: true }).waitFor();
      return `Archive marked the item Archived and disabled Title, Type, Folder, Audience and the guidance editor. Upload disappeared, and a direct upload to the item answered ${refused.status} (${q(refused.body?.detail ?? "")}). After a reload the saved address still opened the archived item. Knowledge Item actions, Restore cleared Archived and made the fields and Upload available again.`;
    },
  );

  return ctx;
}

// ---------- publish-knowledge (V-C34) ----------
async function publishKnowledge(role, page, account, admin, reader, second, shared) {
  const A = "publish-knowledge";
  const base = `DOC-029 knowledge ${account.tag} ${stamp}`;
  const ctx = {};
  const portalRead = async (p, id) =>
    (await apiJson(p, "GET", `/api/v1/portal/knowledge/${id}`)).status;

  await step(
    role,
    A,
    "Fixture: a draft item with guidance, a primary PDF and a supporting DOCX, plus a live draft replacement",
    "Fixture records exist through the publisher's session.",
    async () => {
      const folder = await (async () => {
        const r = await apiJson(page, "POST", "/api/v1/knowledge/folders", {
          data: { name: `${base} publish` },
        });
        expectThat(r.status < 300, `folder ${r.status}`);
        return r.body.folders.find((f) => f.name === `${base} publish`);
      })();
      ctx.folder = folder;
      const pdfPath = copyFixture("doc029-policy-a.pdf", `${base} pack primary.pdf`);
      const types = (await apiJson(page, "GET", "/api/v1/knowledge/type-options")).body
        .knowledgeTypes;
      const playbook = types.find((t) => t.displayName === "Playbook");
      const created = await apiJson(page, "POST", "/api/v1/knowledge/from-files", {
        multipart: {
          knowledgeTypeId: playbook.id,
          folderId: folder.id,
          file: uploadFile(pdfPath, "application/pdf"),
        },
      });
      expectThat(created.status === 201 || created.status === 200, `from-files ${created.status}`);
      const id = created.body.knowledgeItems[0].id;
      const docxPath = copyFixture("doc029-playbook.docx", `${base} pack supporting.docx`);
      const up = await apiJson(page, "POST", `/api/v1/knowledge/${id}/documents`, {
        multipart: {
          kind: "draft_ours",
          file: uploadFile(
            docxPath,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          ),
        },
      });
      expectThat(up.status < 300, `supporting upload ${up.status}`);
      const patch = await apiJson(page, "PATCH", `/api/v1/knowledge/${id}`, {
        data: {
          title: `${base} pack`,
          body: `## ${base} pack heading one\n\nFictional guidance for suppliers.`,
        },
      });
      expectThat(patch.status === 200, `patch ${patch.status}`);
      const replacement = await apiJson(page, "POST", "/api/v1/knowledge", {
        data: {
          title: `${base} replacement pack`,
          knowledgeTypeId: playbook.id,
          folderId: folder.id,
        },
      });
      expectThat(replacement.status < 300, `replacement ${replacement.status}`);
      ctx.id = id;
      ctx.title = `${base} pack`;
      ctx.replacementId = replacement.body.knowledgeItem.id;
      ctx.replacementTitle = `${base} replacement pack`;
      ctx.primaryName = path.basename(pdfPath);
      ctx.supportingName = path.basename(docxPath);
      ctx.primaryBytes = readFileSync(pdfPath);
      ctx.supportingBytes = readFileSync(docxPath);
      const item = await readItem(page, id);
      expectThat(
        item.state === "draft" &&
          item.audience === "legal_only" &&
          item.documentCount === 2 &&
          item.primaryDocument.currentVersion.originalFilename === ctx.primaryName,
        "fixture state wrong",
      );
      results.records.push({
        role,
        kind: "publish fixtures",
        names: [ctx.title, ctx.replacementTitle, `${base} publish`],
      });
      return `The publisher's session created ${q(ctx.title)} (Draft, Legal Only, primary ${q(ctx.primaryName)}, supporting ${q(ctx.supportingName)}, guidance) and ${q(ctx.replacementTitle)} in folder "${base} publish". These are fixtures made through the API, not guide steps.`;
    },
  );

  await step(
    role,
    A,
    "Before you start table rows 1-2: Draft and published Legal Only are unavailable in the Portal",
    "Portal readers are returned to the Portal home and the article read answers 404; staff can open the record.",
    async () => {
      await openRecord(page, ctx.id);
      await waitMarkers(page, { draft: true, onPortal: false }, "draft markers wrong");
      const draftStatuses = [await portalRead(reader, ctx.id), await portalRead(second, ctx.id)];
      await reader.goto(`/portal/knowledge/${ctx.id}`);
      await reader.waitForURL((u) => u.pathname === "/portal");
      const menu = await recordActions(page);
      await menu.getByRole("menuitem", { name: "Publish" }).click();
      await waitMarkers(
        page,
        { draft: false, onPortal: false },
        "Publish Legal Only markers wrong",
      );
      const item = await readItem(page, ctx.id);
      expectThat(
        item.state === "published" && item.audience === "legal_only",
        "not published legal only",
      );
      const legalStatuses = [await portalRead(reader, ctx.id), await portalRead(second, ctx.id)];
      await reader.goto(`/portal/knowledge/${ctx.id}`);
      await reader.waitForURL((u) => u.pathname === "/portal");
      expectThat(
        [...draftStatuses, ...legalStatuses].every((s) => s === 404),
        `portal statuses ${q([draftStatuses, legalStatuses])}`,
      );
      const menu2 = await recordActions(page);
      await menu2.getByRole("menuitem", { name: "Unpublish" }).click();
      await waitMarkers(page, { draft: true }, "Unpublish with no links did not return to Draft");
      return `${account.name} opened the Draft record (Draft marker, no On the portal). Jonas Weber and Ravi Menon in their Portal sessions got 404 from the article read, and the Portal page returned Jonas to /portal. Publish while Legal Only removed the Draft marker without On the portal, and both readers still got 404 and the Portal home. Unpublish, with no deflection link, returned the item to Draft without a dialog.`;
    },
  );

  await step(
    role,
    A,
    "Publish and check the Portal steps 1-2: Audience Everyone, then Publish from Knowledge Item actions",
    "The Draft marker disappears and On the portal appears.",
    async () => {
      await page.locator("#knowledge-record-audience").selectOption({ label: "Everyone" });
      await until(
        async () => (await readItem(page, ctx.id)).audience === "everyone",
        "audience did not save",
      );
      const draftEveryone = await markers(page);
      expectThat(
        draftEveryone.draft && !draftEveryone.onPortal,
        "draft Everyone showed On the portal",
      );
      expectThat(
        (await portalRead(reader, ctx.id)) === 404,
        "draft Everyone readable in the Portal",
      );
      const menu = await recordActions(page);
      await menu.getByRole("menuitem", { name: "Publish" }).click();
      await waitMarkers(
        page,
        { draft: false, onPortal: true },
        "Publish did not show On the portal",
      );
      const item = await readItem(page, ctx.id);
      expectThat(
        item.state === "published" && item.audience === "everyone",
        "not published for Everyone",
      );
      const homeBefore = await (async () => {
        await reader.goto("/portal");
        await reader.getByText("What do you need from Legal?").waitFor();
        return reader
          .getByRole("link", { name: `DOC-029 knowledge ${account.tag} ${stamp} supplier pack` })
          .count();
      })();
      expectThat(homeBefore === 0, "Portal home already links the item");
      return `Audience Everyone saved on the draft; the item still showed Draft, no On the portal, and the Portal read answered 404. Knowledge Item actions, Publish removed Draft and showed On the portal. Before any deflection link existed, the Portal home had no link to the item.`;
    },
  );

  const linkLabel = `${base} supplier pack`;
  await step(
    role,
    A,
    "Publish and check the Portal step 3: an Administrator adds a deflection link in Settings, Intake, Deflection links",
    "Add link takes Target Knowledge item, the item, a Label and Placement Portal home.",
    async () => {
      await admin.goto("/");
      await admin
        .getByRole("banner")
        .getByRole("button", { name: ACCOUNTS.administrator.name })
        .click();
      await admin.getByRole("menuitem", { name: "Settings" }).click();
      await admin.waitForURL(/\/settings/);
      await admin.getByRole("link", { name: "Intake", exact: true }).click();
      await admin
        .getByRole("link", { name: "Deflection links" })
        .or(admin.getByRole("tab", { name: "Deflection links" }))
        .first()
        .click();
      await admin.waitForURL(/\/settings\/intake\/links$/);
      await admin.getByRole("button", { name: "Add link" }).first().click();
      const dialog = admin.getByRole("dialog", { name: "Add link" });
      await dialog.getByRole("radio", { name: "Knowledge item" }).check();
      const options = await optionTexts(dialog.locator("#intake-link-knowledge option"));
      expectThat(options.includes(ctx.title), "published Everyone item not offered");
      expectThat(
        !options.includes(ctx.replacementTitle),
        "draft replacement offered as a link target",
      );
      await dialog.locator("#intake-link-knowledge").selectOption({ label: ctx.title });
      await dialog.getByLabel("Label").fill(linkLabel);
      await dialog.locator("#intake-link-placement").selectOption({ label: "Portal home" });
      await dialog.getByRole("button", { name: "Add link" }).click();
      await dialog.waitFor({ state: "hidden" });
      await admin.getByText(linkLabel, { exact: true }).waitFor();
      shared.links.push(linkLabel);
      await openRecord(page, ctx.id);
      const count = (await readItem(page, ctx.id)).deflectionLinkCount;
      expectThat(count === 1, `deflectionLinkCount ${count}`);
      return `As Daniel Okafor: user menu, Settings, Intake, Deflection links, Add link. Target Knowledge item offered ${q(ctx.title)} and did not offer the draft ${q(ctx.replacementTitle)}. With the Label ${q(linkLabel)} and Placement Portal home, Add link added the row. The item then counted 1 deflection link.`;
    },
  );

  const download = async (p, name) => {
    const [dl] = await Promise.all([
      p.waitForEvent("download"),
      p.getByRole("link", { name: `Download ${name}` }).click(),
    ]);
    const file = await dl.path();
    return readFileSync(file);
  };

  await step(
    role,
    A,
    "Publish and check the Portal step 4: a signed-in Portal reader opens the link under Before you submit and downloads both Documents",
    "Title, guidance and downloads for primary and supporting Documents; primary first, guidance after files; no staff controls or Version choice.",
    async () => {
      await reader.goto("/portal");
      const panel = reader.getByRole("region", { name: "Before you submit" });
      await panel.getByRole("link", { name: linkLabel }).click();
      await reader.waitForURL(new RegExp(`/portal/knowledge/${ctx.id}$`));
      const h1 = await until(async () => {
        const text = (
          await reader
            .getByRole("heading", { level: 1 })
            .first()
            .innerText()
            .catch(() => "")
        ).trim();
        return text === ctx.title ? text : null;
      }, "Portal article heading did not render");
      expectThat(h1 === ctx.title, `heading ${h1}`);
      await reader.getByRole("heading", { name: `${base} pack heading one` }).waitFor();
      const order = await reader.evaluate(() => {
        const files = document.querySelector("#portal-knowledge-files");
        const guidance = document.querySelector("#portal-knowledge-guidance");
        const names = [
          ...document.querySelectorAll("section[aria-labelledby='portal-knowledge-files'] li"),
        ].map((li) => li.innerText.split("\n")[0].trim());
        return {
          filesFirst: !!(
            files &&
            guidance &&
            files.compareDocumentPosition(guidance) & Node.DOCUMENT_POSITION_FOLLOWING
          ),
          names,
        };
      });
      expectThat(order.filesFirst, "guidance is not after the files");
      expectThat(order.names[0] === ctx.primaryName, `first file ${order.names[0]}`);
      const primary = await download(reader, ctx.primaryName);
      const supporting = await download(reader, ctx.supportingName);
      expectThat(
        primary.equals(ctx.primaryBytes) && supporting.equals(ctx.supportingBytes),
        "downloaded bytes differ",
      );
      const staffControls = await reader
        .getByRole("button", { name: /Knowledge Item actions|Upload|Edit|Publish/ })
        .count();
      const textboxes = await reader.getByRole("textbox").count();
      const versionChoice = await reader.getByText(/Version \d|v\d\b/).count();
      expectThat(
        staffControls === 0 && textboxes === 0 && versionChoice === 0,
        "staff or Version controls offered",
      );
      const portalItem = (await apiJson(reader, "GET", `/api/v1/portal/knowledge/${ctx.id}`)).body
        .knowledgeItem;
      ctx.savedArticle = `/portal/knowledge/${ctx.id}`;
      ctx.savedDownloads = portalItem.documents.map((d) => d.currentVersion.downloadUrl);
      expectThat(ctx.savedDownloads.length === 2, "two download addresses expected");
      const secondStatus = await portalRead(second, ctx.id);
      expectThat(secondStatus === 200, `second reader ${secondStatus}`);
      return `Jonas Weber opened ${q(linkLabel)} under Before you submit and reached ${q(ctx.title)} with its guidance heading. The Documents section came before Guidance, and ${q(ctx.primaryName)} was listed first. Both downloads matched the uploaded PDF and DOCX byte for byte. The page offered no staff actions, no text field and no Version choice. Ravi Menon's Portal session could also read the article (200).`;
    },
  );

  await step(
    role,
    A,
    "Publish and check the Portal closing text: a guidance edit and a new Version reach the Portal without another Publish",
    "After a reload the reader sees the new guidance and downloads the new current Version; the state is unchanged.",
    async () => {
      const before = await readItem(page, ctx.id);
      await openRecord(page, ctx.id);
      const editor = page.locator("#knowledge-body");
      await editor.fill(`## ${base} pack heading two\n\nFictional guidance, second edit.`);
      await page
        .getByRole("region", { name: "Guidance", exact: true })
        .getByRole("button", { name: "Preview" })
        .click();
      await until(
        async () => (await readItem(page, ctx.id)).body?.includes("heading two"),
        "guidance edit not saved",
      );
      await page
        .getByRole("button", { name: `Actions for ${before.primaryDocument.title}` })
        .click();
      await page.getByRole("menuitem", { name: "Add version" }).click();
      const dialog = page.getByRole("dialog", { name: "Add version" });
      const v2 = copyFixture("doc029-policy-b.pdf", ctx.primaryName);
      await chooseFiles(page, dialog.getByRole("button", { name: /Choose file/ }), [v2]);
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      const docs = await until(async () => {
        const rows = await readDocuments(page, ctx.id);
        return rows.find((d) => d.isPrimary)?.versions.length === 2 ? rows : null;
      }, "Version 2 not added");
      await reader.reload();
      await reader.getByRole("heading", { name: `${base} pack heading two` }).waitFor();
      const bytes = await download(reader, ctx.primaryName);
      const expected = readFileSync(path.join(FIX, "doc029-policy-b.pdf"));
      expectThat(bytes.equals(expected), "reader did not get the new current Version");
      const after = await readItem(page, ctx.id);
      expectThat(
        after.state === "published" &&
          after.audience === "everyone" &&
          after.publishedAt === before.publishedAt,
        "publication state changed",
      );
      ctx.savedDownloads = (
        await apiJson(reader, "GET", `/api/v1/portal/knowledge/${ctx.id}`)
      ).body.knowledgeItem.documents.map((d) => d.currentVersion.downloadUrl);
      return `A guidance edit (saved on Preview) and Add version on the primary PDF made Version 2 with no second Publish. After a reload Jonas Weber saw the new guidance heading, and his download matched the Version 2 bytes. The staff chain still had both Versions (${docs.find((d) => d.isPrimary).versions.length}). State, audience and the first publication time did not change.`;
    },
  );

  const blocked = async (label) => {
    const statuses = [];
    for (const p of [reader, second]) {
      statuses.push(await portalRead(p, ctx.id));
      for (const url of ctx.savedDownloads) statuses.push((await apiJson(p, "GET", url)).status);
    }
    await reader.goto(ctx.savedArticle);
    await reader.waitForURL((u) => u.pathname === "/portal", { timeout: 15000 });
    await reader.getByText("What do you need from Legal?").waitFor();
    const linkShown = await reader.getByRole("link", { name: linkLabel }).count();
    expectThat(
      statuses.every((s) => s === 404),
      `${label}: statuses ${q(statuses)}`,
    );
    expectThat(linkShown === 0, `${label}: link still on the Portal home`);
    return statuses.length;
  };
  const available = async (label) => {
    await reader.goto("/portal");
    await reader
      .getByRole("region", { name: "Before you submit" })
      .getByRole("link", { name: linkLabel })
      .waitFor({ timeout: 15000 });
    const statuses = [await portalRead(reader, ctx.id)];
    for (const url of ctx.savedDownloads) statuses.push((await apiJson(reader, "GET", url)).status);
    expectThat(
      statuses.every((s) => s === 200),
      `${label}: statuses ${q(statuses)}`,
    );
  };

  await step(
    role,
    A,
    "Withdraw or restrict steps 1-3: change Audience to Legal Only; the dialog names the link; Cancel keeps it, Continue restricts it",
    "Cancel leaves Everyone; Continue saves Legal Only; the link, the saved article address and both saved file addresses stop working; the link stays in Settings.",
    async () => {
      await openRecord(page, ctx.id);
      await page.locator("#knowledge-record-audience").selectOption("legal_only");
      let dialog = page.getByRole("dialog", { name: "Remove this from the portal?" });
      const text = await dialog.innerText();
      expectThat(/1 deflection link points at this item/.test(text), `dialog text ${text}`);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      await sleep(800);
      expectThat(
        (await readItem(page, ctx.id)).audience === "everyone",
        "Cancel changed the audience",
      );
      const shown = await page.locator("#knowledge-record-audience").inputValue();
      expectThat(shown === "everyone", `control shows ${shown} after Cancel`);
      await page.locator("#knowledge-record-audience").selectOption("legal_only");
      dialog = page.getByRole("dialog", { name: "Remove this from the portal?" });
      await dialog.getByRole("button", { name: "Continue" }).click();
      await until(
        async () => (await readItem(page, ctx.id)).audience === "legal_only",
        "Continue did not save Legal Only",
      );
      await waitMarkers(page, { onPortal: false, draft: false }, "On the portal still shown");
      const denied = await blocked("Legal Only");
      await admin.goto("/settings/intake/links");
      await admin.getByText(linkLabel, { exact: true }).waitFor();
      return `Audience Legal Only opened "Remove this from the portal?" with the text ${q(text.replace(/\s+/g, " ").trim())}. Cancel left Everyone saved and shown. Continue saved Legal Only and removed On the portal. The Portal home no longer showed the link. The saved article address returned Jonas to /portal, and the article and both saved download addresses answered 404 for both Portal sessions (${denied} denied reads). The link row stayed in Settings, Deflection links.`;
    },
  );

  await step(
    role,
    A,
    "Withdraw or restrict: Unpublish returns the item to Draft; Everyone and Publish make it available again with the existing link",
    "Setting Everyone restores access on the published item; Unpublish blocks it; Publish restores it with no link change.",
    async () => {
      await openRecord(page, ctx.id);
      await page.locator("#knowledge-record-audience").selectOption("everyone");
      await until(
        async () => (await readItem(page, ctx.id)).audience === "everyone",
        "Everyone did not save",
      );
      await available("Everyone again");
      const menu = await recordActions(page);
      await menu.getByRole("menuitem", { name: "Unpublish" }).click();
      const dialog = page.getByRole("dialog", { name: "Remove this from the portal?" });
      await dialog.getByRole("button", { name: "Continue" }).click();
      await waitMarkers(
        page,
        { draft: true, onPortal: false },
        "Unpublish did not return to Draft",
      );
      const item = await readItem(page, ctx.id);
      expectThat(
        item.state === "draft" && item.audience === "everyone",
        "draft state or audience wrong",
      );
      const denied = await blocked("Unpublished");
      const menu2 = await recordActions(page);
      await menu2.getByRole("menuitem", { name: "Publish" }).click();
      await waitMarkers(
        page,
        { draft: false, onPortal: true },
        "Publish did not return On the portal",
      );
      await available("Published again");
      return `Audience Everyone on the published item brought back the link, the article and both downloads. Unpublish asked "Remove this from the portal?"; Continue showed the Draft marker and kept Audience Everyone. The link went, and the article and file addresses answered 404 (${denied} denied reads). Publish on the draft brought back On the portal, the existing deflection link, the article and both downloads.`;
    },
  );

  await step(
    role,
    A,
    "Archive and restore steps 1-4 with Replaced by",
    "The list has no archived toggle and drops the item; Archived disables editing and removes Portal access; the saved address restores it with its earlier state, including through the link; the old Portal address does not redirect to the replacement.",
    async () => {
      const saved = `/knowledge/${ctx.id}`;
      await page.goto("/knowledge");
      await itemsRegion(page).waitFor();
      const toggle = await page.getByText("Show archived").count();
      expectThat(toggle === 0, "Knowledge list has an archived toggle");
      await openRecord(page, ctx.id);
      const menu = await recordActions(page);
      await menu.getByRole("menuitem", { name: "Archive" }).click();
      const dialog = page.getByRole("dialog", { name: "Archive Knowledge Item" });
      await until(
        async () => !(await dialog.locator("#knowledge-replacement").isDisabled()),
        "Replaced by did not load",
      );
      const noneLabel = (
        await dialog.locator("#knowledge-replacement option:checked").innerText()
      ).trim();
      expectThat(noneLabel === "No replacement", `default ${noneLabel}`);
      await dialog.locator("#knowledge-replacement").selectOption({ label: ctx.replacementTitle });
      await dialog.getByRole("button", { name: "Archive" }).click();
      await dialog.waitFor({ state: "hidden" });
      await waitMarkers(page, { archived: true, onPortal: false }, "no Archived marker");
      const disabled =
        (await page.locator("#knowledge-record-title").isDisabled()) &&
        (await page.locator("#knowledge-record-audience").isDisabled());
      expectThat(disabled, "controls not disabled");
      expectThat(
        (await page.getByRole("button", { name: `Actions for ${ctx.primaryName}` }).count()) +
          (await page.getByText(ctx.supportingName).count()) >
          0,
        "Documents not shown on archived item",
      );
      const archived = await readItem(page, ctx.id);
      expectThat(
        archived.body?.includes("heading two") &&
          archived.documentCount === 2 &&
          archived.replacedBy?.id === ctx.replacementId,
        "guidance, Documents or replacement lost",
      );
      const denied = await blocked("Archived");
      expectThat(
        !reader.url().includes(ctx.replacementId),
        "old address redirected to the replacement",
      );
      await page.goto(`/knowledge`);
      await selectFolder(page, `${base} publish`);
      const titles = await listTitles(page);
      expectThat(
        !titles.includes(ctx.title) && titles.includes(ctx.replacementTitle),
        `list while archived ${q(titles)}`,
      );
      await openRecord(page, ctx.id);
      await waitMarkers(page, { archived: true }, "saved address did not open the archived item");
      const menu2 = await recordActions(page);
      await menu2.getByRole("menuitem", { name: "Restore" }).click();
      await waitMarkers(
        page,
        { archived: false, onPortal: true, draft: false },
        "Restore did not return published Everyone",
      );
      expectThat(
        !(await page.locator("#knowledge-record-title").isDisabled()),
        "fields not editable after restore",
      );
      await page.goto(`/knowledge`);
      await selectFolder(page, `${base} publish`);
      expectThat((await listTitles(page)).includes(ctx.title), "restored item not in the library");
      await available("Restored");
      return `The Knowledge list had no Show archived toggle. Archive Knowledge Item started at No replacement; with Replaced by ${q(ctx.replacementTitle)}, Archive marked the item Archived and disabled Title and Audience. Guidance, both Documents and the replacement stayed on the item. The link, the article and both file addresses stopped working (${denied} denied reads). The old Portal address returned the reader to /portal, not to the replacement. The folder list left the item out. The saved staff address still opened it, and Restore brought back Published, Everyone and On the portal with editable fields. The item was in the library again, and the existing link, the article and both downloads worked.`;
    },
  );

  await step(
    role,
    A,
    "Check a missing item: archived replacements are not offered, and the Replaced by list refreshes only after a reload",
    "An archived item is absent from Replaced by; an item created while the record is open appears only after a reload.",
    async () => {
      const types = (await apiJson(page, "GET", "/api/v1/knowledge/type-options")).body
        .knowledgeTypes;
      const playbook = types.find((t) => t.displayName === "Playbook");
      const retired = await apiJson(page, "POST", "/api/v1/knowledge", {
        data: {
          title: `${base} retired pack`,
          knowledgeTypeId: playbook.id,
          folderId: ctx.folder.id,
        },
      });
      const retiredId = retired.body.knowledgeItem.id;
      const arch = await apiJson(page, "POST", `/api/v1/knowledge/${retiredId}/archive`, {
        data: {},
      });
      expectThat(arch.status === 200, `archive fixture ${arch.status}`);
      const refused = await apiJson(
        page,
        "POST",
        `/api/v1/knowledge/${ctx.replacementId}/archive`,
        { data: { replacedById: retiredId } },
      );
      await openRecord(page, ctx.id);
      let menu = await recordActions(page);
      await menu.getByRole("menuitem", { name: "Archive" }).click();
      let dialog = page.getByRole("dialog", { name: "Archive Knowledge Item" });
      await until(
        async () => !(await dialog.locator("#knowledge-replacement").isDisabled()),
        "Replaced by did not load",
      );
      let options = await optionTexts(dialog.locator("#knowledge-replacement option"));
      expectThat(
        !options.includes(`${base} retired pack`) && options.includes(ctx.replacementTitle),
        "archived item offered or live item missing",
      );
      await dialog.getByRole("button", { name: "Cancel" }).click();
      const late = await apiJson(page, "POST", "/api/v1/knowledge", {
        data: { title: `${base} late pack`, knowledgeTypeId: playbook.id, folderId: ctx.folder.id },
      });
      expectThat(late.status < 300, "late fixture");
      menu = await recordActions(page);
      await menu.getByRole("menuitem", { name: "Archive" }).click();
      dialog = page.getByRole("dialog", { name: "Archive Knowledge Item" });
      options = await optionTexts(dialog.locator("#knowledge-replacement option"));
      const staleMissing = !options.includes(`${base} late pack`);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await page.reload();
      await page.locator("#knowledge-record-type").waitFor({ timeout: 20000 });
      menu = await recordActions(page);
      await menu.getByRole("menuitem", { name: "Archive" }).click();
      dialog = page.getByRole("dialog", { name: "Archive Knowledge Item" });
      await until(
        async () => !(await dialog.locator("#knowledge-replacement").isDisabled()),
        "Replaced by did not load",
      );
      options = await optionTexts(dialog.locator("#knowledge-replacement option"));
      expectThat(
        staleMissing && options.includes(`${base} late pack`),
        `stale ${staleMissing}, after reload ${options.includes(`${base} late pack`)}`,
      );
      await dialog.getByRole("button", { name: "Cancel" }).click();
      results.records.push({
        role,
        kind: "replacement fixtures",
        names: [`${base} retired pack`, `${base} late pack`],
      });
      return `The archived fixture ${q(`${base} retired pack`)} was not in Replaced by, and a direct archive naming it as a replacement answered ${refused.status}. An item created while the record stayed open was missing when the dialog opened again (${staleMissing}), and it was offered after a reload.`;
    },
  );

  await step(
    role,
    A,
    "Check a missing item: a browser with no Portal session cannot read a published Everyone item",
    "The Portal page goes to Portal sign-in and the article read answers 401.",
    async () => {
      const anon = await page.context().browser().newContext({ baseURL: BASE });
      const p = await anon.newPage();
      await p.goto(`/portal/knowledge/${ctx.id}`);
      await p.waitForURL(/\/portal\/login/);
      const status = (await apiJson(p, "GET", `/api/v1/portal/knowledge/${ctx.id}`)).status;
      const fileStatus = (await apiJson(p, "GET", ctx.savedDownloads[0])).status;
      await anon.close();
      expectThat(status === 401 && fileStatus === 401, `anonymous ${status}/${fileStatus}`);
      return `With no session, the Portal article page went to /portal/login. The article read answered ${status}, and a saved download address answered ${fileStatus}.`;
    },
  );

  return ctx;
}

// ---------- role-independent checks ----------
async function businessUserChecks(page, reader, shared, sampleId) {
  const A = "create-knowledge";
  await step(
    "business_user",
    A,
    "Before you start: Business Users cannot author or browse the staff Knowledge library",
    "A Business User is kept out of /knowledge and a Knowledge record; the staff API refuses them.",
    async () => {
      await page.goto("/");
      await sleep(1500);
      const landed = new URL(page.url()).pathname;
      await page.goto("/knowledge");
      await sleep(1500);
      const listPath = new URL(page.url()).pathname;
      await page.goto(`/knowledge/${sampleId}`);
      await sleep(1500);
      const recordPath = new URL(page.url()).pathname;
      const navLink = await page.getByRole("link", { name: "Knowledge", exact: true }).count();
      const api = [
        (await apiJson(page, "GET", "/api/v1/knowledge")).status,
        (await apiJson(page, "GET", `/api/v1/knowledge/${sampleId}`)).status,
        (await apiJson(page, "GET", `/api/v1/knowledge/${sampleId}/documents`)).status,
        (
          await apiJson(page, "POST", "/api/v1/knowledge", {
            data: { title: "DOC-029 knowledge refused", knowledgeTypeId: shared.liveTypeId },
          })
        ).status,
      ];
      const readerPaths = [];
      await reader.goto("/knowledge");
      await sleep(1500);
      readerPaths.push(new URL(reader.url()).pathname);
      expectThat(
        !listPath.startsWith("/knowledge") &&
          !recordPath.startsWith("/knowledge") &&
          !readerPaths[0].startsWith("/knowledge"),
        "Business User reached the staff library",
      );
      expectThat(
        navLink === 0 && api.every((s) => s === 403 || s === 404),
        `nav ${navLink} api ${q(api)}`,
      );
      return `Ravi Menon (Business User) signed in to the Business Portal with a fresh magic link; the app root sent him to ${landed}. /knowledge sent him to ${listPath}, and a Knowledge record address sent him to ${recordPath}, with no Knowledge navigation link. The staff Knowledge list, record, Documents and create requests answered ${q(api)}. Jonas Weber's Portal session asking for /knowledge ended on ${readerPaths[0]}.`;
    },
  );
}

async function helpSeparation(page, role, title) {
  await step(
    role,
    "create-knowledge",
    "Before you start: Help search does not search Knowledge Items",
    "Help finds the Knowledge guide by its title but not a Knowledge Item by its title.",
    async () => {
      await page.goto("/help");
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
      await box.fill(title);
      await box.press("Enter");
      await page.getByText(/No matching articles/).waitFor({ timeout: 15000 });
      return `Help search found the guide "Create and organize Knowledge Items" by its title. A search for the Knowledge Item title ${q(title)} answered "No matching articles".`;
    },
  );
}

async function cleanup(admin, shared) {
  // Cleanup: remove the deflection links, archive published fixtures, delete the archived type.
  for (const label of shared.links) {
    try {
      await admin.goto("/settings/intake/links");
      await admin.getByRole("button", { name: `Remove ${label}` }).click();
      const confirm = admin.getByRole("dialog").or(admin.getByRole("alertdialog"));
      if (await confirm.count())
        await confirm
          .getByRole("button", { name: /Remove|Delete|Continue/ })
          .first()
          .click();
      await until(
        async () => (await admin.getByText(label, { exact: true }).count()) === 0,
        "link not removed",
        8000,
      );
      results.cleanup.push(`Removed deflection link ${label}.`);
    } catch (error) {
      results.cleanup.push(`Could not remove deflection link ${label}: ${error.message}`);
    }
  }
  const { body: mine } = await apiJson(
    admin,
    "GET",
    "/api/v1/knowledge?state=published&audience=everyone",
  );
  for (const row of mine.knowledgeItems.filter(
    (r) => r.title.includes(`DOC-029 knowledge`) && r.title.includes(stamp),
  )) {
    const r = await apiJson(admin, "POST", `/api/v1/knowledge/${row.id}/archive`, { data: {} });
    results.cleanup.push(`Archived published fixture ${row.title} (${r.status}).`);
  }
  if (!shared.archivedTypeId) return;
  const del = await apiJson(admin, "DELETE", `/api/v1/knowledge/types/${shared.archivedTypeId}`);
  results.cleanup.push(`Deleted the archived Knowledge type fixture (${del.status}).`);
}

// ---------- main ----------
const browser = await chromium.launch();
const shared = { links: [] };
const sessions = {};
try {
  sessions.administrator = await staffSignIn(browser, ACCOUNTS.administrator);
  if (ROLES.includes("legal_team_member"))
    sessions.legal_team_member = await staffSignIn(browser, ACCOUNTS.legal_team_member);
  const admin = sessions.administrator.page;

  // Fixture: an archived Knowledge type, made by the Administrator and removed at the end.
  shared.archivedTypeName = `DOC-029 knowledge retired type ${stamp}`;
  const madeType = await apiJson(admin, "POST", "/api/v1/knowledge/types", {
    data: { displayName: shared.archivedTypeName },
  });
  if (madeType.status >= 300) throw new Error(`type fixture ${madeType.status}`);
  shared.archivedTypeId = madeType.body.knowledgeType.id;
  const archivedType = await apiJson(
    admin,
    "POST",
    `/api/v1/knowledge/types/${shared.archivedTypeId}/archive`,
    { data: {} },
  );
  if (archivedType.status >= 300)
    throw new Error(`type archive ${archivedType.status} ${JSON.stringify(archivedType.body)}`);
  results.records.push({
    role: "administrator",
    kind: "archived Knowledge type fixture",
    names: [shared.archivedTypeName],
  });
  shared.liveTypeId = (
    await apiJson(admin, "GET", "/api/v1/knowledge/type-options")
  ).body.knowledgeTypes[0].id;

  const created = {};
  if (ONLY === "all" || ONLY === "create") {
    for (const role of ROLES) {
      created[role] = await createKnowledge(role, sessions[role].page, ACCOUNTS[role], shared);
    }
  }
  const reader = (await portalMagicLink(browser, ACCOUNTS.portal_reader)).page;
  const second = (await portalMagicLink(browser, ACCOUNTS.business_user_staff)).page;

  if (ONLY === "all" || ONLY === "create") {
    const sample = created.legal_team_member?.itemA?.id ?? created.administrator?.itemA?.id;
    if (sample) await businessUserChecks(second, reader, shared, sample);
    const firstRole = ROLES[0];
    if (created[firstRole]?.guidance)
      await helpSeparation(
        sessions[firstRole].page,
        firstRole,
        `DOC-029 knowledge ${ACCOUNTS[firstRole].tag} ${stamp} guidance`,
      );
  }
  if (ONLY === "all" || ONLY === "publish") {
    for (const role of ROLES) {
      await publishKnowledge(
        role,
        sessions[role].page,
        ACCOUNTS[role],
        admin,
        reader,
        second,
        shared,
      );
    }
  }
} finally {
  if (sessions.administrator) {
    try {
      await cleanup(sessions.administrator.page, shared);
    } catch (error) {
      results.cleanup.push(`Cleanup stopped: ${error.message}`);
    }
  }
  save();
  await browser.close();
}
console.log(
  `steps ${results.steps.length}, passed ${results.steps.filter((s) => s.result === "pass").length}`,
);
