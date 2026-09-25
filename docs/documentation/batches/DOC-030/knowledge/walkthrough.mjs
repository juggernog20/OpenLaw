// DOC-030 independent walkthrough, group "knowledge".
// Follows docs/user-guides/publish-knowledge.md (V-C34) as written, in the
// shared work2 lab built from 067c1646, once with the Legal Team Member
// (Nadia Haddad) publishing and once with the Administrator (Daniel Okafor).
// Pattern: docs/documentation/batches/DOC-029/knowledge/walkthrough-r1.mjs.
//
// Run from the worktree root:
//   LAB_PASSWORD=... node docs/documentation/batches/DOC-030/knowledge/walkthrough.mjs
// The seed password comes only from the environment. Magic links, cookies and
// mail bodies stay in memory and never reach the log. PORTAL_STATE_DIR may name
// a directory outside docs/ (the session scratchpad) so development reruns do
// not spend a reader's sign-in link budget; the credited run leaves it unset.
//
// The registry's "out-of-audience comparison reader" has no per-person
// Knowledge audience in the app. Everyone means every signed-in Portal
// session. The comparison is therefore made against Draft, published Legal
// Only, Unpublished and Archived states, a browser with no session, and a
// Confidential supporting Document.
import { chromium } from "../../../../../node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const LAB_NAME = process.env.LAB_NAME ?? "work2";
const lab = JSON.parse(
  readFileSync(path.join(root, `.documentation-labs/${LAB_NAME}/lab.json`), "utf8"),
);
const BASE = process.env.LAB_APP_URL ?? lab.appUrl;
const MAIL = process.env.LAB_MAIL_URL ?? lab.mailUrl;
const PASSWORD = process.env.LAB_PASSWORD;
if (!PASSWORD) throw new Error("LAB_PASSWORD is required");
const OUT = process.env.OUT ?? path.join(here, "walkthrough.json");
const ROLES = (process.env.ROLES ?? "legal_team_member,administrator").split(",");
const STATE_DIR = process.env.PORTAL_STATE_DIR ?? null;

const ACCOUNTS = {
  administrator: { email: "daniel.okafor@helix.example", name: "Daniel Okafor", tag: "Admin" },
  legal_team_member: { email: "nadia.haddad@helix.example", name: "Nadia Haddad", tag: "LTM" },
  // Two Business Users as Portal readers. Jonas Weber's sign-in link budget is
  // shared with other walkthrough agents on this lab, so these two are used.
  reader: { email: "mei.tanaka@helix.example", name: "Mei Tanaka" },
  second: { email: "sara.haddadi@helix.example", name: "Sara Haddadi" },
};

const now = new Date();
const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 13); // 20260925T1234
const FIX = path.join(root, "docs/documentation/batches/DOC-029/knowledge/fixtures");
const WORK = path.join(os.tmpdir(), `doc030-knowledge-${stamp}`);
mkdirSync(WORK, { recursive: true });

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
function copyFixture(source, name) {
  const target = path.join(WORK, name);
  copyFileSync(path.join(FIX, source), target);
  return target;
}

const results = {
  name: "walkthrough",
  batch: "DOC-030",
  group: "knowledge",
  reviewer: "DOC-030 independent walkthrough agent (knowledge)",
  reviewerKind: "agent",
  lab: LAB_NAME,
  labIdentity: {
    project: lab.project,
    appCommit: lab.sourceCommit,
    appImage: lab.appImageId,
    engineImage: lab.engineImageId,
    seed: lab.seed,
  },
  articleHashes: ["publish-knowledge"].map((id) => ({
    articleId: id,
    contentSha256: sha256(readFileSync(path.join(root, "docs/user-guides", `${id}.md`))),
  })),
  fixtures: Object.fromEntries(
    [
      "doc029-policy-a.pdf",
      "doc029-policy-b.pdf",
      "doc029-playbook.docx",
      "doc029-checklist.pdf",
    ].map((name) => [
      `DOC-029/knowledge/fixtures/${name}`,
      sha256(readFileSync(path.join(FIX, name))),
    ]),
  ),
  accounts: Object.fromEntries(Object.entries(ACCOUNTS).map(([k, v]) => [k, v.name])),
  stamp,
  startedAt: new Date().toISOString(),
  completedAt: null,
  passed: false,
  steps: [],
  records: [],
  productBugs: [],
  limitationChecks: [],
  cleanup: [],
};
function save() {
  results.completedAt = new Date().toISOString();
  results.passed = results.steps.length > 0 && results.steps.every((s) => s.result === "pass");
  writeFileSync(OUT, JSON.stringify(results, null, 2) + "\n");
}

async function step(role, pageLabel, action, expected, fn) {
  const entry = {
    article: "publish-knowledge",
    scenario: "V-C34",
    role,
    method: "browser-walkthrough",
    page: pageLabel,
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
  console.log(`[${role}] ${entry.result.toUpperCase()} ${action}`);
  if (entry.result === "fail") console.log(`    ${entry.actual}`);
  save();
  return entry.result === "pass";
}
function expectThat(condition, message) {
  if (!condition) throw new Error(message);
}
const q = (s) => JSON.stringify(s);
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
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 30000 });
  return { context, page };
}

async function portalMagicLink(browser, account) {
  const stateFile = STATE_DIR ? path.join(STATE_DIR, `${account.email}.json`) : null;
  if (stateFile && existsSync(stateFile)) {
    const context = await browser.newContext({
      baseURL: BASE,
      acceptDownloads: true,
      storageState: stateFile,
    });
    const page = await context.newPage();
    const me = await page.request.get("/api/v1/me");
    if (me.ok() && (await me.json()).user?.email === account.email) {
      await page.goto("/portal");
      return { context, page, reused: true };
    }
    await context.close();
  }
  const context = await browser.newContext({ baseURL: BASE, acceptDownloads: true });
  const page = await context.newPage();
  const requestedAt = Date.now();
  await page.goto("/portal/login");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.getByLabel("Email").fill(account.email);
  await page.getByRole("button", { name: "Send link" }).click();
  await page.getByText("Check your email").waitFor();
  let link = null;
  for (let attempt = 0; attempt < 80 && !link; attempt++) {
    const search = await fetch(
      `${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${account.email}"`)}`,
    ).then((r) => r.json());
    for (const message of search.messages ?? []) {
      if (new Date(message.Created).getTime() < requestedAt - 2000) continue;
      const full = await fetch(`${MAIL}/api/v1/message/${message.ID}`).then((r) => r.json());
      const match = full.Text?.match(/https?:\/\/\S+\/magic-link\/verify\S*/);
      if (match) {
        link = match[0];
        break;
      }
    }
    if (!link) await sleep(500);
  }
  if (!link) throw new Error(`no fresh sign-in link for ${account.name}`);
  const url = new URL(link);
  const labUrl = new URL(BASE);
  url.protocol = labUrl.protocol;
  url.host = labUrl.host;
  await page.goto(url.toString());
  await page.waitForURL((u) => u.pathname.startsWith("/portal"), { timeout: 20000 });
  expectThat(!page.url().includes("/portal/login"), "magic link did not sign in");
  if (stateFile) {
    mkdirSync(STATE_DIR, { recursive: true });
    await context.storageState({ path: stateFile });
  }
  return { context, page, reused: false };
}

async function apiJson(page, method, url, options = {}) {
  const response = await page.request.fetch(url, {
    method,
    headers: { origin: BASE, ...(options.headers ?? {}) },
    ...(options.data !== undefined ? { data: options.data } : {}),
    ...(options.multipart ? { multipart: options.multipart } : {}),
    maxRedirects: 0,
    failOnStatusCode: false,
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
async function readDocuments(page, id) {
  const { status, body } = await apiJson(page, "GET", `/api/v1/knowledge/${id}/documents`);
  expectThat(status === 200, `documents read answered ${status}`);
  return body.documents;
}
function uploadFile(filePath, mimeType) {
  return { name: path.basename(filePath), mimeType, buffer: readFileSync(filePath) };
}
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// ---------- UI helpers ----------
const itemsRegion = (page) => page.getByRole("region", { name: "Knowledge items" });
const folderTree = (page) => page.getByRole("complementary", { name: "Knowledge folders" });
async function selectFolder(page, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const button = folderTree(page).getByRole("button", {
    name: new RegExp(`^${escaped}\\s*\\d*$`),
  });
  await button.click();
  await until(
    async () => (await button.getAttribute("aria-current")) === "page",
    `folder ${name} did not become selected`,
  );
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
async function optionTexts(locator) {
  return locator.evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()));
}
async function chooseFiles(page, trigger, files) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), trigger.click()]);
  await chooser.setFiles(files);
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
function documentRow(page, title) {
  return page
    .getByRole("button", { name: `Actions for ${title}` })
    .locator("xpath=ancestor::*[self::tr or self::li][1]");
}

// ---------- publish-knowledge (V-C34) ----------
async function publishKnowledge(role, S, shared) {
  const account = ACCOUNTS[role];
  const page = S[role];
  const admin = S.administrator;
  const legal = S.legal_team_member;
  const other = role === "administrator" ? legal : admin;
  const otherName =
    role === "administrator" ? ACCOUNTS.legal_team_member.name : ACCOUNTS.administrator.name;
  const reader = S.reader;
  const second = S.second;
  const readerName = ACCOUNTS.reader.name;
  const secondName = ACCOUNTS.second.name;
  const base = `DOC-030 knowledge V-C34 ${account.tag} ${stamp}`;
  const ctx = {};
  const portalRead = async (p, id) =>
    (await apiJson(p, "GET", `/api/v1/portal/knowledge/${id}`)).status;
  const recordPage = () => `/knowledge/<${account.tag} pack>`;

  await step(
    role,
    "API fixture (publisher session)",
    "Fixture: a draft item with guidance, a primary PDF and two supporting files, plus a draft replacement, an archived item and a published Legal Only item",
    "Fixture records exist through the publisher's session.",
    async () => {
      const made = await apiJson(page, "POST", "/api/v1/knowledge/folders", {
        data: { name: `${base} folder` },
      });
      expectThat(made.status < 300, `folder ${made.status}`);
      ctx.folderName = `${base} folder`;
      ctx.folder = made.body.folders.find((f) => f.name === ctx.folderName);
      const types = (await apiJson(page, "GET", "/api/v1/knowledge/type-options")).body
        .knowledgeTypes;
      const playbook = types.find((t) => t.displayName === "Playbook") ?? types[0];
      ctx.typeId = playbook.id;
      const pdfPath = copyFixture("doc029-policy-a.pdf", `${base} primary.pdf`);
      const created = await apiJson(page, "POST", "/api/v1/knowledge/from-files", {
        multipart: {
          knowledgeTypeId: playbook.id,
          folderId: ctx.folder.id,
          file: uploadFile(pdfPath, "application/pdf"),
        },
      });
      expectThat(created.status === 201 || created.status === 200, `from-files ${created.status}`);
      const id = created.body.knowledgeItems[0].id;
      const docxPath = copyFixture("doc029-playbook.docx", `${base} supporting.docx`);
      const up = await apiJson(page, "POST", `/api/v1/knowledge/${id}/documents`, {
        multipart: { file: uploadFile(docxPath, DOCX) },
      });
      expectThat(up.status < 300, `supporting upload ${up.status} ${q(up.body)}`);
      const restrictedPath = copyFixture("doc029-checklist.pdf", `${base} internal checklist.pdf`);
      const up2 = await apiJson(page, "POST", `/api/v1/knowledge/${id}/documents`, {
        multipart: { file: uploadFile(restrictedPath, "application/pdf") },
      });
      expectThat(up2.status < 300, `second supporting upload ${up2.status}`);
      const patch = await apiJson(page, "PATCH", `/api/v1/knowledge/${id}`, {
        data: {
          title: `${base} pack`,
          body: `## ${base} heading one\n\nFictional guidance for suppliers.`,
        },
      });
      expectThat(patch.status === 200, `patch ${patch.status}`);
      const mk = async (title) => {
        const r = await apiJson(page, "POST", "/api/v1/knowledge", {
          data: { title, knowledgeTypeId: playbook.id, folderId: ctx.folder.id },
        });
        expectThat(r.status < 300, `create ${title} ${r.status}`);
        return r.body.knowledgeItem.id;
      };
      ctx.replacementTitle = `${base} replacement`;
      ctx.replacementId = await mk(ctx.replacementTitle);
      ctx.retiredTitle = `${base} retired`;
      ctx.retiredId = await mk(ctx.retiredTitle);
      const arch = await apiJson(page, "POST", `/api/v1/knowledge/${ctx.retiredId}/archive`, {
        data: {},
      });
      expectThat(arch.status === 200, `archive fixture ${arch.status}`);
      ctx.legalOnlyTitle = `${base} legal only`;
      ctx.legalOnlyId = await mk(ctx.legalOnlyTitle);
      const pub = await apiJson(page, "POST", `/api/v1/knowledge/${ctx.legalOnlyId}/publish`, {
        data: {},
      });
      expectThat(pub.status === 200, `publish legal only fixture ${pub.status}`);
      ctx.id = id;
      ctx.title = `${base} pack`;
      ctx.primaryName = path.basename(pdfPath);
      ctx.supportingName = path.basename(docxPath);
      ctx.restrictedName = path.basename(restrictedPath);
      ctx.bytes = {
        [ctx.primaryName]: readFileSync(pdfPath),
        [ctx.supportingName]: readFileSync(docxPath),
        [ctx.restrictedName]: readFileSync(restrictedPath),
      };
      const item = await readItem(page, id);
      const docs = await readDocuments(page, id);
      ctx.docTitle = Object.fromEntries(
        docs.map((d) => [d.currentVersion?.originalFilename ?? d.title, d.title]),
      );
      ctx.docId = Object.fromEntries(
        docs.map((d) => [d.currentVersion?.originalFilename ?? d.title, d.id]),
      );
      expectThat(
        item.state === "draft" &&
          item.audience === "legal_only" &&
          item.documentCount === 3 &&
          item.primaryDocument.currentVersion.originalFilename === ctx.primaryName,
        `fixture state wrong ${q({ state: item.state, audience: item.audience, n: item.documentCount })}`,
      );
      results.records.push({
        role,
        kind: "publish fixtures",
        names: [
          ctx.folderName,
          ctx.title,
          ctx.replacementTitle,
          ctx.retiredTitle,
          ctx.legalOnlyTitle,
        ],
      });
      return `${account.name}'s session created ${q(ctx.title)} (Draft, Legal Only, primary ${q(ctx.primaryName)}, supporting ${q(ctx.supportingName)} and ${q(ctx.restrictedName)}, guidance), the draft ${q(ctx.replacementTitle)}, the archived ${q(ctx.retiredTitle)} and the published Legal Only ${q(ctx.legalOnlyTitle)} in folder ${q(ctx.folderName)}. These are API fixtures, not guide steps.`;
    },
  );

  await step(
    role,
    recordPage(),
    "Before you start table rows 1-2: Draft and published Legal Only are open to both staff roles and unavailable in the Portal",
    "Both staff roles open the record; Portal readers get 404 and are returned to the Portal home.",
    async () => {
      await openRecord(page, ctx.id);
      await waitMarkers(page, { draft: true, onPortal: false }, "draft markers wrong");
      await openRecord(other, ctx.id);
      await waitMarkers(other, { draft: true }, `${otherName} does not see the Draft record`);
      const draftStatuses = [await portalRead(reader, ctx.id), await portalRead(second, ctx.id)];
      await reader.goto(`/portal/knowledge/${ctx.id}`);
      await reader.waitForURL((u) => u.pathname === "/portal");
      const menu = await recordActions(page);
      const offered = await optionTexts(menu.getByRole("menuitem"));
      expectThat(offered.includes("Publish") && !offered.includes("Unpublish"), q(offered));
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
      await openRecord(other, ctx.id);
      await waitMarkers(other, { draft: false, onPortal: false }, `${otherName} markers wrong`);
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
      return `${account.name} opened the record with the Draft marker and no On the portal; ${otherName} opened the same record in a separate browser context. Knowledge Item actions offered ${q(offered)}. ${readerName} and ${secondName} got 404 from the Portal article read, and the Portal page returned ${readerName} to /portal. Publish while Legal Only removed the Draft marker and showed no On the portal; ${otherName} saw the same, and both readers still got 404 and the Portal home. Unpublish, with no deflection link, returned the item to Draft without a dialog.`;
    },
  );

  await step(
    role,
    "/knowledge (Business User)",
    "Before you start: Business Users have no staff Knowledge authoring access",
    "A Portal reader asking for /knowledge or the record is sent away, and the staff Knowledge API refuses them.",
    async () => {
      await reader.goto("/knowledge");
      await sleep(1500);
      const listPath = new URL(reader.url()).pathname;
      await reader.goto(`/knowledge/${ctx.id}`);
      await sleep(1500);
      const recordPath = new URL(reader.url()).pathname;
      const api = [
        (await apiJson(reader, "GET", "/api/v1/knowledge")).status,
        (await apiJson(reader, "GET", `/api/v1/knowledge/${ctx.id}`)).status,
        (await apiJson(reader, "POST", `/api/v1/knowledge/${ctx.id}/publish`, { data: {} }))
          .status,
      ];
      expectThat(
        !listPath.startsWith("/knowledge") && !recordPath.startsWith("/knowledge"),
        `reader reached ${listPath} ${recordPath}`,
      );
      expectThat(
        api.every((s) => s === 403 || s === 404),
        `api ${q(api)}`,
      );
      const item = await readItem(page, ctx.id);
      expectThat(item.state === "draft", "the refused publish changed the item");
      return `${readerName} asking for /knowledge ended on ${listPath}, and the record address ended on ${recordPath}. The staff Knowledge list, record read and publish requests answered ${q(api)}, and the item stayed Draft.`;
    },
  );

  await step(
    role,
    recordPage(),
    "Publish and check the Portal steps 1-2: Audience Everyone, then Knowledge Item actions, Publish",
    "The Draft marker disappears and On the portal appears.",
    async () => {
      await openRecord(page, ctx.id);
      const audienceOptions = await optionTexts(page.locator("#knowledge-record-audience option"));
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
      await reader.goto("/portal");
      await reader.getByRole("heading", { level: 1 }).first().waitFor();
      const homeLinks = await reader.getByRole("link", { name: ctx.title }).count();
      expectThat(homeLinks === 0, "Portal home already links the item");
      return `Audience offered ${q(audienceOptions)}. Everyone saved on the draft; the item still showed Draft and no On the portal, and the Portal read answered 404. Knowledge Item actions, Publish removed Draft and showed On the portal. Before any deflection link existed, ${readerName}'s Portal home had no link to the item.`;
    },
  );

  const linkLabel = `${base} supplier pack`;
  await step(
    role,
    "/settings/intake/links (Administrator)",
    "Publish and check the Portal step 3: an Administrator adds a deflection link in Settings, Intake, Deflection links",
    "Add link takes Target Knowledge item, this item, a Label and Placement Portal home; the Knowledge item list offers only live items published for Everyone.",
    async () => {
      await admin.goto("/");
      await admin.getByRole("button", { name: ACCOUNTS.administrator.name, exact: true }).first().click();
      await admin.getByRole("menuitem", { name: "Settings" }).click();
      await admin.waitForURL(/\/settings/);
      await admin.getByRole("link", { name: "Intake", exact: true }).first().click();
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
      const absent = [ctx.replacementTitle, ctx.retiredTitle, ctx.legalOnlyTitle].filter(
        (t) => !options.includes(t),
      );
      expectThat(absent.length === 3, `non-Everyone items offered ${q(options)}`);
      await dialog.locator("#intake-link-knowledge").selectOption({ label: ctx.title });
      await dialog.locator("#intake-link-label").fill(linkLabel);
      const placements = await optionTexts(dialog.locator("#intake-link-placement option"));
      await dialog.locator("#intake-link-placement").selectOption({ label: "Portal home" });
      await dialog.getByRole("button", { name: "Add link" }).click();
      await dialog.waitFor({ state: "hidden" });
      await admin.getByText(linkLabel, { exact: true }).waitFor();
      shared.links.push(linkLabel);
      ctx.placements = placements;
      const count = (await readItem(page, ctx.id)).deflectionLinkCount;
      expectThat(count === 1, `deflectionLinkCount ${count}`);
      return `As Daniel Okafor: Settings, Intake, Deflection links, Add link. With Target Knowledge item, the Knowledge item list offered ${q(ctx.title)} and did not offer the draft ${q(ctx.replacementTitle)}, the archived ${q(ctx.retiredTitle)} or the published Legal Only ${q(ctx.legalOnlyTitle)}. Placement offered Portal home and ${placements.length - 1} request type(s). With the Label ${q(linkLabel)} and Placement Portal home, Add link added the row, and the item counted 1 deflection link.`;
    },
  );

  const download = async (p, name) => {
    const [dl] = await Promise.all([
      p.waitForEvent("download"),
      p.getByRole("link", { name: `Download ${name}` }).click(),
    ]);
    return readFileSync(await dl.path());
  };
  const portalNames = async (p) =>
    p.evaluate(() =>
      [
        ...document.querySelectorAll("section[aria-labelledby='portal-knowledge-files'] li"),
      ].map((li) => li.innerText.split("\n")[0].trim()),
    );

  await step(
    role,
    `/portal -> /portal/knowledge/<pack> (${readerName})`,
    "Publish and check the Portal step 4: a signed-in Portal reader opens the link under Before you submit and checks title, guidance and downloads",
    "Title, guidance and current downloads for the primary and supporting Documents; primary first, guidance after files; no staff controls or Version choice.",
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
      await reader.getByRole("heading", { name: `${base} heading one` }).waitFor();
      const order = await reader.evaluate(() => {
        const files = document.querySelector("#portal-knowledge-files");
        const guidance = document.querySelector("#portal-knowledge-guidance");
        return !!(
          files &&
          guidance &&
          files.compareDocumentPosition(guidance) & Node.DOCUMENT_POSITION_FOLLOWING
        );
      });
      const names = await portalNames(reader);
      expectThat(order, "guidance is not after the files");
      expectThat(names[0] === ctx.primaryName, `first file ${names[0]}`);
      expectThat(names.length === 3, `listed ${q(names)}`);
      for (const name of [ctx.primaryName, ctx.supportingName, ctx.restrictedName]) {
        const bytes = await download(reader, name);
        expectThat(bytes.equals(ctx.bytes[name]), `downloaded bytes differ for ${name}`);
      }
      const staffControls = await reader
        .getByRole("button", { name: /Knowledge Item actions|Upload|Edit|Publish/ })
        .count();
      const textboxes = await reader.getByRole("textbox").count();
      const versionChoice = await reader.getByText(/Version \d|\bv\d\b/).count();
      expectThat(
        staffControls === 0 && textboxes === 0 && versionChoice === 0,
        "staff or Version controls offered",
      );
      const portalItem = (await apiJson(reader, "GET", `/api/v1/portal/knowledge/${ctx.id}`)).body
        .knowledgeItem;
      ctx.savedArticle = `/portal/knowledge/${ctx.id}`;
      ctx.savedDownloads = Object.fromEntries(
        portalItem.documents.map((d) => [
          d.currentVersion.originalFilename ?? d.title,
          d.currentVersion.downloadUrl,
        ]),
      );
      expectThat(Object.keys(ctx.savedDownloads).length === 3, "three download addresses expected");
      const secondStatus = await portalRead(second, ctx.id);
      expectThat(secondStatus === 200, `second reader ${secondStatus}`);
      return `${readerName} opened ${q(linkLabel)} under Before you submit and reached ${q(h1)} with its guidance heading. Documents came before Guidance and listed ${q(names)}, primary first. All three downloads matched the uploaded files byte for byte. The page offered no staff actions, no text field and no Version choice. ${secondName}'s Portal session read the article too (200).`;
    },
  );

  if (role === "administrator") {
    const formLabel = `${base} form link`;
    await step(
      role,
      "/settings/intake/links, /portal/new/<type> (Administrator, reader)",
      "Publish and check the Portal step 3 alternative: Placement set to one request type shows the link on that form only",
      "The link shows under Before you submit on the chosen request form, not on the Portal home, and opens the item.",
      async () => {
        await reader.goto("/portal");
        const picker = reader.getByRole("list", { name: "Request types" });
        await picker.waitFor();
        const firstCard = picker.getByRole("link").first();
        const href = await firstCard.getAttribute("href");
        const typeName = (await firstCard.innerText()).split("\n")[0].trim();
        await admin.goto("/settings/intake/links");
        await admin.getByRole("button", { name: "Add link" }).first().click();
        const dialog = admin.getByRole("dialog", { name: "Add link" });
        await dialog.getByRole("radio", { name: "Knowledge item" }).check();
        await dialog.locator("#intake-link-knowledge").selectOption({ label: ctx.title });
        await dialog.locator("#intake-link-label").fill(formLabel);
        await dialog.locator("#intake-link-placement").selectOption({ label: typeName });
        await dialog.getByRole("button", { name: "Add link" }).click();
        await dialog.waitFor({ state: "hidden" });
        await admin.getByText(formLabel, { exact: true }).waitFor();
        shared.links.push(formLabel);
        await reader.goto("/portal");
        await reader.getByRole("list", { name: "Request types" }).waitFor();
        await sleep(500);
        const onHome = await reader.getByRole("link", { name: formLabel }).count();
        expectThat(onHome === 0, "form link shown on the Portal home");
        await reader.getByRole("list", { name: "Request types" }).getByRole("link").first().click();
        await reader.waitForURL((u) => u.pathname === href);
        const panel = reader.getByRole("region", { name: "Before you submit" });
        await panel.getByRole("link", { name: formLabel }).waitFor({ timeout: 15000 });
        await panel.getByRole("link", { name: formLabel }).click();
        await reader.waitForURL(new RegExp(`/portal/knowledge/${ctx.id}$`));
        await reader.getByRole("heading", { name: ctx.title }).waitFor();
        ctx.formHref = href;
        ctx.formLabel = formLabel;
        const count = (await readItem(page, ctx.id)).deflectionLinkCount;
        expectThat(count === 2, `deflectionLinkCount ${count}`);
        return `Add link with Placement ${q(typeName)} saved ${q(formLabel)}. ${readerName}'s Portal home did not show it. The ${q(typeName)} card opened ${href}, whose Before you submit panel listed ${q(formLabel)}, and the link opened ${q(ctx.title)}. The item then counted 2 deflection links.`;
      },
    );
  }

  await step(
    role,
    `${recordPage()} (Administrator), /portal/knowledge/<pack> (${readerName})`,
    "Before you start, Confidential paragraph, and Publish step 4: an Administrator marks one supporting Document confidential from its Actions menu",
    "The row shows CONFI; the Portal no longer lists the file and its saved download address answers as if the item were unavailable; the other files still download; a Legal Team Member does not see the file; Clear confidential mark returns it.",
    async () => {
      const title = ctx.docTitle[ctx.restrictedName];
      await openRecord(admin, ctx.id);
      await admin.getByRole("button", { name: `Actions for ${title}` }).click();
      const menuItems = await optionTexts(admin.getByRole("menu").getByRole("menuitem"));
      await admin.getByRole("menuitem", { name: "Mark confidential" }).click();
      await until(
        async () => /CONFI/.test(await documentRow(admin, title).innerText()),
        "row does not show CONFI",
      );
      const markerName = await documentRow(admin, title)
        .getByText("CONFI")
        .first()
        .evaluate((el) => (el.closest("[aria-label]")?.getAttribute("aria-label") ?? el.getAttribute("aria-label") ?? ""));
      await reader.goto(ctx.savedArticle);
      await reader.getByRole("heading", { name: ctx.title }).waitFor();
      const names = await portalNames(reader);
      expectThat(
        !names.includes(ctx.restrictedName) &&
          names.includes(ctx.primaryName) &&
          names.includes(ctx.supportingName),
        `portal listed ${q(names)}`,
      );
      const restrictedStatuses = [
        (await apiJson(reader, "GET", ctx.savedDownloads[ctx.restrictedName])).status,
        (await apiJson(second, "GET", ctx.savedDownloads[ctx.restrictedName])).status,
      ];
      const missingItem = (
        await apiJson(
          reader,
          "GET",
          ctx.savedDownloads[ctx.restrictedName].replace(ctx.id, "00000000-0000-7000-8000-000000000000"),
        )
      ).status;
      const otherStatuses = [
        (await apiJson(reader, "GET", ctx.savedDownloads[ctx.primaryName])).status,
        (await apiJson(reader, "GET", ctx.savedDownloads[ctx.supportingName])).status,
      ];
      expectThat(
        restrictedStatuses.every((s) => s === 404) && missingItem === 404,
        `confidential download ${q(restrictedStatuses)} missing item ${missingItem}`,
      );
      expectThat(otherStatuses.every((s) => s === 200), `other downloads ${q(otherStatuses)}`);
      await openRecord(legal, ctx.id);
      await sleep(800);
      const legalRow = await legal.getByRole("button", { name: `Actions for ${title}` }).count();
      const legalDocs = (await readDocuments(legal, ctx.id)).map((d) => d.id);
      const legalDirect = (
        await apiJson(legal, "GET", `/api/v1/documents/${ctx.docId[ctx.restrictedName]}`)
      ).status;
      expectThat(
        legalRow === 0 && !legalDocs.includes(ctx.docId[ctx.restrictedName]),
        `Legal Team Member still sees the Confidential Document (row ${legalRow})`,
      );
      await admin.getByRole("button", { name: `Actions for ${title}` }).click();
      await admin.getByRole("menuitem", { name: "Clear confidential mark" }).click();
      await until(
        async () => !/CONFI/.test(await documentRow(admin, title).innerText()),
        "CONFI still shown after Clear confidential mark",
      );
      await reader.reload();
      await reader.getByRole("heading", { name: ctx.title }).waitFor();
      const namesAfter = await portalNames(reader);
      expectThat(namesAfter.includes(ctx.restrictedName), `after clear ${q(namesAfter)}`);
      const bytes = await download(reader, ctx.restrictedName);
      expectThat(bytes.equals(ctx.bytes[ctx.restrictedName]), "restored file bytes differ");
      await openRecord(legal, ctx.id);
      await legal.getByRole("button", { name: `Actions for ${title}` }).waitFor();
      return `Daniel Okafor opened Actions for ${q(title)} (menu ${q(menuItems)}) and selected Mark confidential. The row then showed the CONFI lock marker (accessible name ${q(markerName)}). ${readerName}'s article then listed ${q(names)}; the saved download address for the Confidential file answered ${q(restrictedStatuses)} for ${readerName} and ${secondName}, the same 404 as a download under an item that does not exist, while the primary and the other supporting file answered ${q(otherStatuses)}. On the staff record Nadia Haddad saw no row for the file, her Documents list left it out, and a direct Document read answered ${legalDirect}. Clear confidential mark removed CONFI; the article listed the file again, its download matched byte for byte, and Nadia saw the row again.`;
    },
  );

  if (role === "legal_team_member") {
    // Not a guide step: the author's technical review lists this as a product bug
    // and a limitation to confirm or refute on the lab.
    const title = ctx.docTitle[ctx.restrictedName];
    await step(
      role,
      recordPage(),
      "Limitation check: the Legal Team Member who uploaded a Knowledge Document is offered Mark confidential, and loses the file when she uses it",
      "Confirms or refutes the author's product bug; the guide tells readers to ask an Administrator.",
      async () => {
        await openRecord(legal, ctx.id);
        await legal.getByRole("button", { name: `Actions for ${title}` }).click();
        const offered = await optionTexts(legal.getByRole("menu").getByRole("menuitem"));
        const hasMark = offered.includes("Mark confidential");
        let observed;
        if (hasMark) {
          await legal.getByRole("menuitem", { name: "Mark confidential" }).click();
          await sleep(1500);
          const rowBefore = await legal.getByRole("button", { name: `Actions for ${title}` }).count();
          await openRecord(legal, ctx.id);
          await sleep(800);
          const rowAfter = await legal.getByRole("button", { name: `Actions for ${title}` }).count();
          const clear = await apiJson(legal, "PATCH", `/api/v1/documents/${ctx.docId[ctx.restrictedName]}`, {
            data: { isConfidential: false },
          });
          const saved = (await readDocuments(admin, ctx.id)).find(
            (d) => d.id === ctx.docId[ctx.restrictedName],
          );
          observed = `Nadia Haddad's Actions menu for her own upload ${q(title)} offered ${q(offered)}. Mark confidential saved (Administrator read isConfidential ${saved?.isConfidential}). The row stayed until reload (${rowBefore}) and was gone after it (${rowAfter}). Her own attempt to clear the flag through the API answered ${clear.status}.`;
          // Put the file back as an Administrator, through the record's menu.
          await openRecord(admin, ctx.id);
          await admin.getByRole("button", { name: `Actions for ${title}` }).click();
          await admin.getByRole("menuitem", { name: "Clear confidential mark" }).click();
          await until(
            async () =>
              (await readDocuments(admin, ctx.id)).find(
                (d) => d.id === ctx.docId[ctx.restrictedName],
              )?.isConfidential === false,
            "Administrator could not clear the mark",
          );
          await openRecord(legal, ctx.id);
          await legal.getByRole("button", { name: `Actions for ${title}` }).waitFor();
          observed += " Daniel Okafor's Clear confidential mark returned the file to Nadia.";
          if (rowAfter === 0) {
            results.productBugs.push(
              `Confirmed on ${LAB_NAME} at ${lab.sourceCommit.slice(0, 8)}: a Legal Team Member who uploaded a Knowledge Document is offered Actions, Mark confidential (documents-card.tsx canFlag); after using it the Document leaves her staff record and she cannot clear the mark (PATCH answered ${clear.status}). Only an Administrator can return it. Reproduce: as Nadia Haddad upload a file to a Knowledge Item, open its Actions menu, select Mark confidential, reload the record.`,
            );
          }
        } else {
          await legal.keyboard.press("Escape");
          observed = `Nadia Haddad's Actions menu for her own upload ${q(title)} offered ${q(offered)}, with no Mark confidential.`;
        }
        results.limitationChecks.push(observed);
        return observed;
      },
    );
  }

  await step(
    role,
    `${recordPage()}, /portal/knowledge/<pack> (${readerName})`,
    "Publish and check the Portal closing text: a guidance edit and a new Version reach the Portal without another Publish",
    "After a reload the reader sees the new guidance and downloads the new current Version; the publication state is unchanged.",
    async () => {
      const before = await readItem(page, ctx.id);
      await openRecord(page, ctx.id);
      const guidance = page.getByRole("region", { name: "Guidance", exact: true });
      const editor = page.locator("#knowledge-body");
      if (!(await editor.isVisible())) {
        await guidance.getByRole("button", { name: /Edit|Add guidance/ }).first().click();
      }
      await editor.fill(`## ${base} heading two\n\nFictional guidance, second edit.`);
      await guidance.getByRole("button", { name: "Preview" }).click();
      await until(
        async () => (await readItem(page, ctx.id)).body?.includes("heading two"),
        "guidance edit not saved",
      );
      const primaryTitle = ctx.docTitle[ctx.primaryName];
      await page.getByRole("button", { name: `Actions for ${primaryTitle}` }).click();
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
      await reader.goto(ctx.savedArticle);
      await reader.getByRole("heading", { name: `${base} heading two` }).waitFor();
      const bytes = await download(reader, ctx.primaryName);
      const expected = readFileSync(path.join(FIX, "doc029-policy-b.pdf"));
      expectThat(bytes.equals(expected), "reader did not get the new current Version");
      ctx.bytes[ctx.primaryName] = expected;
      const after = await readItem(page, ctx.id);
      expectThat(
        after.state === "published" &&
          after.audience === "everyone" &&
          after.publishedAt === before.publishedAt,
        "publication state changed",
      );
      const portalItem = (await apiJson(reader, "GET", `/api/v1/portal/knowledge/${ctx.id}`)).body
        .knowledgeItem;
      ctx.savedDownloads = Object.fromEntries(
        portalItem.documents.map((d) => [
          d.currentVersion.originalFilename ?? d.title,
          d.currentVersion.downloadUrl,
        ]),
      );
      return `A guidance edit (saved on Preview) and Add version on the primary PDF made Version 2 with no second Publish. ${readerName} reopened the article, saw the new guidance heading, and the download matched the Version 2 bytes. The staff chain had ${docs.find((d) => d.isPrimary).versions.length} Versions. State, audience and the first publication time did not change.`;
    },
  );

  const labels = () => [linkLabel, ...(ctx.formLabel ? [ctx.formLabel] : [])];
  const blocked = async (label) => {
    const statuses = [];
    for (const p of [reader, second]) {
      statuses.push(await portalRead(p, ctx.id));
      for (const url of Object.values(ctx.savedDownloads))
        statuses.push((await apiJson(p, "GET", url)).status);
    }
    await reader.goto(ctx.savedArticle);
    await reader.waitForURL((u) => u.pathname === "/portal", { timeout: 15000 });
    await reader.getByRole("heading", { level: 1 }).first().waitFor();
    await sleep(500);
    let linkShown = 0;
    for (const l of labels()) linkShown += await reader.getByRole("link", { name: l }).count();
    if (ctx.formHref) {
      await reader.goto(ctx.formHref);
      await reader.getByRole("heading", { level: 1 }).first().waitFor();
      await sleep(800);
      linkShown += await reader.getByRole("link", { name: ctx.formLabel }).count();
    }
    expectThat(
      statuses.every((s) => s === 404),
      `${label}: statuses ${q(statuses)}`,
    );
    expectThat(linkShown === 0, `${label}: a link is still on the Portal home or form`);
    return statuses.length;
  };
  const available = async (label) => {
    await reader.goto("/portal");
    await reader
      .getByRole("region", { name: "Before you submit" })
      .getByRole("link", { name: linkLabel })
      .waitFor({ timeout: 15000 });
    const statuses = [await portalRead(reader, ctx.id)];
    for (const url of Object.values(ctx.savedDownloads))
      statuses.push((await apiJson(reader, "GET", url)).status);
    expectThat(
      statuses.every((s) => s === 200),
      `${label}: statuses ${q(statuses)}`,
    );
  };

  await step(
    role,
    `${recordPage()}, /portal (${readerName}, ${secondName})`,
    "Withdraw or restrict steps 1-3: change Audience to Legal Only; the dialog names the links; Cancel keeps it, Continue restricts it",
    "Cancel leaves Everyone; Continue saves Legal Only; the link, the saved article address and every saved file address stop working; the link stays in Settings.",
    async () => {
      await openRecord(page, ctx.id);
      await page.locator("#knowledge-record-audience").selectOption("legal_only");
      let dialog = page.getByRole("dialog", { name: "Remove this from the portal?" });
      const text = (await dialog.innerText()).replace(/\s+/g, " ").trim();
      const n = ctx.formLabel ? 2 : 1;
      expectThat(
        new RegExp(`${n} deflection links? points? at this item`).test(text),
        `dialog text ${text}`,
      );
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
      const shownAfter = (
        await page.locator("#knowledge-record-audience option:checked").innerText()
      ).trim();
      const denied = await blocked("Legal Only");
      await admin.goto("/settings/intake/links");
      for (const l of labels()) await admin.getByText(l, { exact: true }).waitFor();
      return `Audience Legal Only opened "Remove this from the portal?" reading ${q(text)}. Cancel left Everyone saved and shown. Continue saved Legal Only (Audience shows ${q(shownAfter)}, no Draft, no On the portal). The Portal home${ctx.formHref ? " and the request form" : ""} no longer showed the link. The saved article address returned ${readerName} to /portal, and the article and all three saved download addresses answered 404 for both Portal sessions (${denied} denied reads). The link row${ctx.formLabel ? "s" : ""} stayed in Settings, Deflection links.`;
    },
  );

  await step(
    role,
    `${recordPage()}, /portal (${readerName}, ${secondName})`,
    "Withdraw or restrict: Everyone restores a published item; Unpublish returns it to Draft; Publish makes it available again with the existing link",
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
      return `Audience Everyone on the published item brought back the link, the article and all three downloads. Unpublish asked "Remove this from the portal?"; Continue showed the Draft marker and kept Audience Everyone. The link went, and the article and file addresses answered 404 (${denied} denied reads). Publish on the draft brought back On the portal, the existing deflection link, the article and the downloads.`;
    },
  );

  await step(
    role,
    `/knowledge, ${recordPage()}, /portal (${readerName}, ${secondName})`,
    "Archive and restore steps 1-4 with Replaced by",
    "The list has no archived toggle and drops the item; Archived disables editing and removes Portal access; the saved address restores it with its earlier state, including through the link; the old Portal address does not redirect to the replacement.",
    async () => {
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
      const replacementOptions = await optionTexts(dialog.locator("#knowledge-replacement option"));
      expectThat(
        !replacementOptions.includes(ctx.retiredTitle),
        "archived item offered under Replaced by",
      );
      await dialog.locator("#knowledge-replacement").selectOption({ label: ctx.replacementTitle });
      await dialog.getByRole("button", { name: "Archive" }).click();
      await dialog.waitFor({ state: "hidden" });
      await waitMarkers(page, { archived: true, onPortal: false }, "no Archived marker");
      const disabled = {};
      for (const id of [
        "knowledge-record-title",
        "knowledge-record-type",
        "knowledge-record-folder",
        "knowledge-record-audience",
      ]) {
        disabled[id] = await page.locator(`#${id}`).isDisabled();
      }
      expectThat(Object.values(disabled).every(Boolean), `controls not disabled ${q(disabled)}`);
      const archived = await readItem(page, ctx.id);
      expectThat(
        archived.body?.includes("heading two") &&
          archived.documentCount === 3 &&
          archived.replacedBy?.id === ctx.replacementId,
        "guidance, Documents or replacement lost",
      );
      const denied = await blocked("Archived");
      await reader.goto(ctx.savedArticle);
      await reader.waitForURL((u) => u.pathname === "/portal", { timeout: 15000 });
      expectThat(
        !reader.url().includes(ctx.replacementId),
        "old address redirected to the replacement",
      );
      await page.goto("/knowledge");
      await itemsRegion(page).waitFor();
      await selectFolder(page, ctx.folderName);
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
      await page.goto("/knowledge");
      await itemsRegion(page).waitFor();
      await selectFolder(page, ctx.folderName);
      expectThat((await listTitles(page)).includes(ctx.title), "restored item not in the library");
      await available("Restored");
      return `The Knowledge list had no Show archived toggle. Archive Knowledge Item started at No replacement and did not offer the archived ${q(ctx.retiredTitle)}. With Replaced by ${q(ctx.replacementTitle)}, Archive marked the item Archived and disabled Title, Type, Folder and Audience. Guidance, the three Documents and the replacement stayed on the item. The link, the article and the file addresses stopped working (${denied} denied reads), and the old Portal address returned the reader to /portal, not to the replacement. The folder list left the item out. The saved staff address still opened it, and Restore brought back Published, Everyone and On the portal with editable fields. The item was in the library again, and the existing link, the article and the downloads worked.`;
    },
  );

  await step(
    role,
    recordPage(),
    "Check a missing item or file: the Replaced by list refreshes whenever the archive dialog opens, and a replacement that becomes unavailable while the dialog is open is refused with an explanation",
    "An item created while the record stays open is offered the next time the dialog opens; archiving that choice from another session before Archive makes the dialog show why.",
    async () => {
      await openRecord(page, ctx.id);
      let menu = await recordActions(page);
      await menu.getByRole("menuitem", { name: "Archive" }).click();
      let dialog = page.getByRole("dialog", { name: "Archive Knowledge Item" });
      await until(
        async () => !(await dialog.locator("#knowledge-replacement").isDisabled()),
        "Replaced by did not load",
      );
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      const lateTitle = `${base} late`;
      const late = await apiJson(other, "POST", "/api/v1/knowledge", {
        data: { title: lateTitle, knowledgeTypeId: ctx.typeId, folderId: ctx.folder.id },
      });
      expectThat(late.status < 300, `late fixture ${late.status}`);
      const lateId = late.body.knowledgeItem.id;
      results.records.push({ role, kind: "replacement fixture", names: [lateTitle] });
      menu = await recordActions(page);
      await menu.getByRole("menuitem", { name: "Archive" }).click();
      dialog = page.getByRole("dialog", { name: "Archive Knowledge Item" });
      const options = await until(async () => {
        if (await dialog.locator("#knowledge-replacement").isDisabled()) return null;
        const o = await optionTexts(dialog.locator("#knowledge-replacement option"));
        return o.includes(lateTitle) ? o : null;
      }, "the item created while the record was open is not offered without a reload");
      await dialog.locator("#knowledge-replacement").selectOption({ label: lateTitle });
      const competing = await apiJson(other, "POST", `/api/v1/knowledge/${lateId}/archive`, {
        data: {},
      });
      expectThat(competing.status === 200, `competing archive ${competing.status}`);
      await dialog.getByRole("button", { name: "Archive" }).click();
      const alert = dialog.getByRole("alert");
      await alert.waitFor({ timeout: 15000 });
      const alertText = (await alert.innerText()).trim();
      expectThat(/live Knowledge Item/.test(alertText), `alert ${alertText}`);
      const still = await readItem(page, ctx.id);
      expectThat(!still.archivedAt, "the item was archived with an unavailable replacement");
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      menu = await recordActions(page);
      await menu.getByRole("menuitem", { name: "Archive" }).click();
      dialog = page.getByRole("dialog", { name: "Archive Knowledge Item" });
      const reopened = await until(async () => {
        if (await dialog.locator("#knowledge-replacement").isDisabled()) return null;
        return optionTexts(dialog.locator("#knowledge-replacement option"));
      }, "Replaced by did not load");
      expectThat(!reopened.includes(lateTitle), "archived late item still offered");
      await dialog.getByRole("button", { name: "Cancel" }).click();
      return `With the record left open and no reload, ${otherName} created ${q(lateTitle)} from another session. The next time Archive Knowledge Item opened, Replaced by offered it (${options.length} choices). With it selected, ${otherName} archived it; Archive then showed the alert ${q(alertText)} inside the dialog and the item stayed live. Reopened, the dialog no longer offered the archived item.`;
    },
  );

  await step(
    role,
    "/portal/knowledge/<pack> (no session)",
    "Before you start and Check a missing item: Everyone still requires a Portal session",
    "A browser with no session goes to Portal sign-in; the article and a saved download address answer 401.",
    async () => {
      const anon = await page.context().browser().newContext({ baseURL: BASE });
      const p = await anon.newPage();
      await p.goto(ctx.savedArticle);
      await p.waitForURL(/\/portal\/login/);
      const status = (await apiJson(p, "GET", `/api/v1/portal/knowledge/${ctx.id}`)).status;
      const fileStatuses = [];
      for (const url of Object.values(ctx.savedDownloads))
        fileStatuses.push((await apiJson(p, "GET", url)).status);
      await anon.close();
      expectThat(
        status === 401 && fileStatuses.every((s) => s === 401),
        `anonymous ${status}/${q(fileStatuses)}`,
      );
      const signedIn = await portalRead(reader, ctx.id);
      expectThat(signedIn === 200, `signed-in reader ${signedIn}`);
      return `With no session the Portal article address went to /portal/login. The article read answered ${status}, and the saved download addresses answered ${q(fileStatuses)}, while ${readerName}'s session still read the published Everyone item (200).`;
    },
  );

  return ctx;
}

async function cleanup(admin, shared) {
  for (const label of shared.links) {
    try {
      await admin.goto("/settings/intake/links");
      await admin.getByText(label, { exact: true }).waitFor();
      await admin.getByRole("button", { name: `Remove ${label}` }).click();
      await sleep(400);
      const confirm = admin.getByRole("alertdialog").or(admin.getByRole("dialog"));
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
  const { body } = await apiJson(admin, "GET", "/api/v1/knowledge?state=published");
  for (const row of (body?.knowledgeItems ?? []).filter(
    (r) => r.title.startsWith("DOC-030 knowledge V-C34") && r.title.includes(stamp),
  )) {
    const r = await apiJson(admin, "POST", `/api/v1/knowledge/${row.id}/archive`, { data: {} });
    results.cleanup.push(`Archived published fixture ${row.title} (${r.status}).`);
  }
}

// ---------- main ----------
const browser = await chromium.launch();
const shared = { links: [] };
const S = {};
try {
  S.administrator = (await staffSignIn(browser, ACCOUNTS.administrator)).page;
  S.legal_team_member = (await staffSignIn(browser, ACCOUNTS.legal_team_member)).page;
  const r1 = await portalMagicLink(browser, ACCOUNTS.reader);
  const r2 = await portalMagicLink(browser, ACCOUNTS.second);
  S.reader = r1.page;
  S.second = r2.page;
  results.portalSessions = {
    [ACCOUNTS.reader.name]: r1.reused ? "reused development session" : "fresh magic link",
    [ACCOUNTS.second.name]: r2.reused ? "reused development session" : "fresh magic link",
  };
  for (const role of ROLES) await publishKnowledge(role, S, shared);
} finally {
  if (S.administrator) {
    try {
      await cleanup(S.administrator, shared);
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
