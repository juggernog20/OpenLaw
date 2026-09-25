// DOC-030 independent browser walkthrough for the admin-config group:
// types-statuses-fields (V-C38), request-forms (V-C40), reminders-and-audit (V-C41)
// and auto-doc-template (V-C56). Written by the DOC-030 independent walkthrough
// agent (admin-config). It follows each guide's steps in the browser on the shared
// work2 lab built from 067c1646 and records what the lab showed.
// Run from the worktree root:
//   LAB_PASSWORD=... node docs/documentation/batches/DOC-030/admin-config/walkthrough.mjs
// Optional: SECTIONS=types,documents,statuses,fields,form,officers,access,forms,reminders,audit,toolcalls,autodoc
// A run replaces the log entries of the sections it runs and keeps the others.
// The seed password comes only from the environment. Sign-in links, cookies, API
// key secrets and raw mail are never written to the results.
import { writeFileSync, readFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ROOT,
  BASE,
  MAIL,
  PROJECT,
  PW_PATH,
  PEOPLE,
  pause,
  q,
  escapeRe,
  flat,
  until,
  api,
  browserSignIn,
  portalSignIn,
  waitForMail,
  toLab,
} from "./api.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(PW_PATH);
const OUT = process.env.OUT ?? path.join(here, "walkthrough.json");
const SHOTS = here;
const ALL = [
  "types",
  "documents",
  "statuses",
  "fields",
  "form",
  "officers",
  "access",
  "forms",
  "reminders",
  "audit",
  "toolcalls",
  "autodoc",
];
const SECTIONS = (process.env.SECTIONS ?? ALL.join(",")).split(",");
const now = new Date();
const stamp = `${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}${String(now.getUTCSeconds()).padStart(2, "0")}`;
const G = "DOC-030 admin-config";
const name = (scenario, what) => `${G} ${scenario} ${what} ${stamp}`;
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const ARTICLES = ["types-statuses-fields", "request-forms", "reminders-and-audit", "auto-doc-template"];
const lab = JSON.parse(readFileSync(path.join(ROOT, ".documentation-labs/work2/lab.json"), "utf8"));

const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null;
const results = {
  kind: "independent-article-walkthrough",
  task: "DOC-030",
  issue: 1157,
  group: "admin-config",
  walkthroughReviewer: "DOC-030 independent walkthrough agent (admin-config)",
  reviewerKind: "agent",
  articles: ARTICLES.map((id) => ({
    articleId: id,
    articlePath: `docs/user-guides/${id}.md`,
    contentSha256: sha256(path.join(ROOT, `docs/user-guides/${id}.md`)),
  })),
  scenarios: {
    "V-C38": "types-statuses-fields",
    "V-C40": "request-forms",
    "V-C41": "reminders-and-audit",
    "V-C56": "auto-doc-template",
  },
  appCommit: lab.sourceCommit,
  lab: {
    name: lab.name,
    project: lab.project,
    appUrl: BASE,
    mailUrl: MAIL,
    appImageId: lab.appImageId,
    engineImageId: lab.engineImageId,
    seed: lab.seed,
  },
  runs: [...(previous?.runs ?? []), { sections: SECTIONS, startedAt: now.toISOString(), stamp }],
  steps: (previous?.steps ?? []).filter((s) => !SECTIONS.includes(s.section)),
  records: (previous?.records ?? []).filter((r) => !SECTIONS.includes(r.section)),
  productBugs: (previous?.productBugs ?? []).filter((r) => !SECTIONS.includes(r.section)),
  guideFailures: (previous?.guideFailures ?? []).filter((r) => !SECTIONS.includes(r.section)),
  finishedAt: null,
};
function save() {
  results.finishedAt = new Date().toISOString();
  const order = (s) => ALL.indexOf(s.section);
  results.steps.sort((a, b) => order(a) - order(b) || a.startedAt.localeCompare(b.startedAt));
  results.summary = {
    total: results.steps.length,
    pass: results.steps.filter((s) => s.result === "pass").length,
    fail: results.steps.filter((s) => s.result === "fail").length,
  };
  writeFileSync(OUT, JSON.stringify(results, null, 2) + "\n");
}

let section = null;
let currentPage = null;
async function step(scenario, role, action, expected, fn, method = "browser-walkthrough") {
  const entry = {
    section,
    scenario,
    role,
    method,
    page: null,
    action,
    expected,
    startedAt: new Date().toISOString(),
    at: null,
    actual: null,
    result: "not-run",
  };
  results.steps.push(entry);
  try {
    entry.actual = await fn();
    entry.result = "pass";
  } catch (error) {
    entry.actual = `Check did not complete: ${error instanceof Error ? error.message.split("\n").slice(0, 4).join(" ") : String(error)}`;
    entry.result = "fail";
    console.error(`[${scenario} ${role}] FAIL ${action}: ${entry.actual}`);
    if (process.env.DEBUG && currentPage) {
      try {
        console.error("URL", currentPage.url());
        console.error((await currentPage.locator("body").ariaSnapshot()).slice(0, 9000));
      } catch {}
    }
  }
  try {
    entry.page = currentPage ? new URL(currentPage.url()).pathname + new URL(currentPage.url()).search : null;
  } catch {}
  entry.at = new Date().toISOString();
  console.log(`[${scenario} ${role}] ${entry.result.toUpperCase()} ${action}`);
  save();
  return entry;
}
function expectThat(condition, message) {
  if (!condition) throw new Error(message);
}
const record = (kind, value, extra = {}) => results.records.push({ section, kind, name: value, ...extra });

async function openSettings(page, person, link, group = "Organization") {
  await page.goto(`${BASE}/`);
  await page.getByRole("banner").getByRole("button", { name: person.name }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page.waitForURL(/\/settings/);
  const rail = page.getByRole("navigation", { name: "Settings sections" });
  if (group === "Advanced") {
    const adv = rail.getByRole("button", { name: "Advanced" });
    if ((await adv.getAttribute("aria-expanded")) !== "true") await adv.click();
    await rail.getByRole("link", { name: link, exact: true }).click();
  } else {
    await rail.getByRole("group", { name: group }).getByRole("link", { name: link, exact: true }).click();
  }
  await page.waitForLoadState("networkidle").catch(() => {});
}
async function pane(page, paneNav, link) {
  await page.getByRole("navigation", { name: paneNav }).getByRole("link", { name: link, exact: true }).click();
  await page.waitForLoadState("networkidle").catch(() => {});
}
function row(page, label) {
  return page.getByRole("listitem").filter({ has: page.getByRole("button", { name: `Rename ${label}`, exact: true }) });
}
async function addListRow(page, button, inputLabel, value, saveLabel = "Save") {
  await page.getByRole("button", { name: button, exact: true }).click();
  await page.getByRole("textbox", { name: inputLabel }).fill(value);
  await page.getByRole("button", { name: saveLabel, exact: true }).click();
  await page.getByRole("button", { name: `Rename ${value}`, exact: true }).waitFor({ timeout: 15000 });
}
async function renameRow(page, from, to) {
  await page.getByRole("button", { name: `Rename ${from}`, exact: true }).click();
  const input = page.getByRole("textbox", { name: `Rename ${from}`, exact: true });
  await input.fill(to);
  await input.press("Enter");
  await page.getByRole("button", { name: `Rename ${to}`, exact: true }).waitFor({ timeout: 15000 });
}
async function reorderPosition(page, label) {
  const aria = await page
    .getByRole("button", { name: new RegExp(`^Reorder ${escapeRe(label)}, position`) })
    .getAttribute("aria-label");
  return Number(aria.match(/position (\d+) of/)[1]);
}
async function moveUp(page, label) {
  const before = await reorderPosition(page, label);
  await page.getByRole("button", { name: new RegExp(`^Reorder ${escapeRe(label)}, position`) }).focus();
  await page.keyboard.press("ArrowUp");
  await until(async () => (await reorderPosition(page, label)) === before - 1, `${label} did not move up`);
  await pause(1500);
  await page.reload();
  await page.getByRole("button", { name: new RegExp(`^Reorder ${escapeRe(label)}, position`) }).waitFor();
  const after = await reorderPosition(page, label);
  expectThat(after === before - 1, `${label}: position ${before} became ${after} after reload`);
  return { before, after };
}
function imageId(container) {
  try {
    return execFileSync("docker", ["inspect", "--format", "{{.Image}}", container]).toString().trim();
  } catch {
    return null;
  }
}

const S = {};

// =====================================================================
// V-C38 types-statuses-fields: types
// =====================================================================
async function typesSection(admin) {
  const SC = "V-C38";
  const role = "administrator";
  const A = PEOPLE.administrator;
  const typeName = name(SC, "Supplier assessment");
  const typeRenamed = name(SC, "Supplier assessment renamed");
  const replacement = name(SC, "Replacement type");
  const archivedProbe = name(SC, "Archived probe type");
  currentPage = admin;

  await step(SC, role,
    "Add and maintain types, steps 1-2: profile menu > Settings > Organization > Matters > Types; Add type, enter a name, Save; Cancel discards a draft",
    "Cancel creates no row. Save adds the named type row.",
    async () => {
      await openSettings(admin, A, "Matters");
      await pane(admin, "Matters panes", "Types");
      await admin.getByRole("heading", { name: "Matter types" }).waitFor();
      const cancelName = name(SC, "Cancelled draft");
      await admin.getByRole("button", { name: "Add type", exact: true }).click();
      const input = admin.getByRole("textbox", { name: "New type name" });
      await input.fill(cancelName);
      await admin.getByRole("button", { name: "Cancel", exact: true }).click();
      await input.waitFor({ state: "detached", timeout: 10000 });
      await admin.reload();
      await admin.getByRole("button", { name: /^Rename / }).first().waitFor();
      const cancelled = await admin.getByRole("button", { name: `Rename ${cancelName}`, exact: true }).count();
      expectThat(cancelled === 0, "Cancel created a row");
      for (const n of [typeName, replacement, archivedProbe]) {
        await addListRow(admin, "Add type", "New type name", n);
        record("matter type", n);
      }
      const usage = flat(await row(admin, typeName).innerText());
      return `Profile menu > Settings > Organization > Matters opened the Types pane with heading "Matter types". Add type opened the "New type name" box; the draft ${q(cancelName)} with Cancel left no row after reload. Add type + Save added ${q(typeName)} (row reads ${q(usage)}), ${q(replacement)} and ${q(archivedProbe)}.`;
    });

  await step(SC, role,
    "Step 3: select the row's Rename control; open Edit, change the description, leave the field; check the Form tab exists and the saved result",
    "Rename changes the display name; the editor has Details and Form; the description saves on leaving the field and survives reload.",
    async () => {
      await renameRow(admin, typeName, typeRenamed);
      await admin.getByRole("button", { name: `Edit ${typeRenamed}`, exact: true }).click();
      await admin.getByRole("heading", { name: typeRenamed }).first().waitFor();
      const tabs = await admin.getByRole("navigation", { name: "Type sections" }).getByRole("link").allInnerTexts();
      const desc = admin.getByRole("textbox", { name: "Description" });
      const text = "DOC-030 fictional supplier assessment type.";
      await desc.fill(text);
      await desc.press("Tab");
      const note = await until(async () => (await admin.getByText(/^Saved$/).count()) > 0, "no Saved note after blur").catch(() => false);
      await pause(1000);
      await admin.reload();
      await admin.getByRole("textbox", { name: "Description" }).waitFor();
      const saved = await admin.getByRole("textbox", { name: "Description" }).inputValue();
      expectThat(saved === text, `description after reload ${q(saved)}`);
      S.matterTypeUrl = admin.url();
      await admin.getByRole("navigation", { name: "Type sections" }).getByRole("link", { name: "Form" }).click();
      await admin.getByRole("region", { name: "Form" }).waitFor();
      return `Rename changed the row to ${q(typeRenamed)}. Edit opened ${new URL(S.matterTypeUrl).pathname} with Type sections ${q(tabs.map(flat))}. The Description saved on Tab (Saved note seen: ${!!note}) and read ${q(saved)} after reload. The Form link opened the Form region.`;
    });

  await step(SC, role,
    "Step 4: focus a reorder handle and use the arrow keys to change the display order",
    "The row moves up one position and keeps it after reload.",
    async () => {
      await admin.goto(`${BASE}/settings/matters/types`);
      await admin.getByRole("heading", { name: "Matter types" }).waitFor();
      const { before, after } = await moveUp(admin, typeRenamed);
      return `The handle "Reorder ${typeRenamed}, position ${before} of …" moved to position ${after} with ArrowUp and kept it after reload.`;
    });

  await step(SC, role,
    "Step 1-3 for Contracts, Entities and Knowledge: Add type; Edit is available on Contracts and Entities, not on Knowledge",
    "Each list accepts Add type + Save; Contract and Entity rows have Edit; Knowledge rows have none.",
    async () => {
      const out = [];
      for (const [link, heading, paneNav] of [
        ["Contracts", "Contract types", "Contracts panes"],
        ["Entities", "Entity types", "Entities panes"],
        ["Knowledge", "Knowledge types", "Knowledge panes"],
      ]) {
        await openSettings(admin, A, link);
        await pane(admin, paneNav, "Types");
        await admin.getByRole("heading", { name: heading }).waitFor();
        const n = name(SC, `${link} probe type`);
        await addListRow(admin, "Add type", "New type name", n);
        record(`${link} type`, n);
        const edit = await admin.getByRole("button", { name: `Edit ${n}`, exact: true }).count();
        if (link === "Knowledge") expectThat(edit === 0, "Knowledge row has Edit");
        else expectThat(edit === 1, `${link} row has no Edit`);
        const other = await admin.getByRole("img", { name: "Other is system-protected and can't be archived" }).count();
        out.push(`${link}: added ${q(n)}; Edit ${edit ? "present" : "absent"}; Other lock images ${other}`);
      }
      return out.join(". ") + ".";
    });

  await step(SC, role,
    "Archive a type in use: read the usage count, choose the live replacement, confirm; the dialog lists only live types; Other shows a lock",
    "The dialog shows the usage count and offers only live types other than the target; the record moves to the replacement.",
    async () => {
      // Fixture: one archived type (unused) and one fictional Matter on the type to archive.
      await admin.goto(`${BASE}/settings/matters/types`);
      await admin.getByRole("button", { name: `Archive ${archivedProbe}`, exact: true }).click();
      let d = admin.getByRole("dialog");
      const probeText = flat(await d.innerText());
      await d.getByRole("button", { name: /^Archive/ }).last().click();
      await d.waitFor({ state: "hidden" });
      const types = (await api(admin, "GET", "/api/v1/matter-types?includeArchived=true")).body;
      const list = types?.types ?? types?.matterTypes ?? types ?? [];
      const typeRow = list.find((t) => t.displayName === typeRenamed);
      const replRow = list.find((t) => t.displayName === replacement);
      expectThat(typeRow && replRow, `type ids not found in ${q(Object.keys(types ?? {}))}`);
      S.matterTypeId = typeRow.id;
      S.replacementTypeId = replRow.id;
      S.archivedMatterTypeId = list.find((t) => t.displayName === archivedProbe)?.id;
      const m = await api(admin, "POST", "/api/v1/matters", { title: name(SC, "Reassigned matter"), matterTypeId: typeRow.id });
      expectThat(m.status < 300, `fixture matter answered ${m.status} ${q(m.body)}`);
      S.reassignMatter = m.body.number ?? m.body.matter?.number;
      record("matter", name(SC, "Reassigned matter"), { number: S.reassignMatter });
      await admin.reload();
      const usage = flat(await row(admin, typeRenamed).innerText());
      await admin.getByRole("button", { name: `Archive ${typeRenamed}`, exact: true }).click();
      d = admin.getByRole("dialog");
      await d.waitFor();
      const text = flat(await d.innerText());
      const select = d.getByRole("combobox");
      const options = (await select.locator("option").allInnerTexts()).map(flat);
      expectThat(!options.includes(archivedProbe), "archived type offered as a replacement");
      expectThat(!options.includes(typeRenamed), "the type itself offered as a replacement");
      await select.selectOption({ label: replacement });
      await d.getByRole("button", { name: /^Archive/ }).last().click();
      await d.waitFor({ state: "hidden", timeout: 15000 });
      const matter = await api(admin, "GET", `/api/v1/matters/${S.reassignMatter}`);
      const mtName = matter.body?.matter?.matterTypeName;
      expectThat(mtName === replacement, `matter type after archive ${mtName}`);
      const other = await admin.getByRole("img", { name: "Other is system-protected and can't be archived" }).count();
      expectThat(other === 1, "Other lock missing");
      return `Archiving the unused ${q(archivedProbe)} read ${q(probeText.slice(0, 200))}. M-${S.reassignMatter} (API fixture) used ${q(typeRenamed)}; its row read ${q(usage)}. The Archive dialog read ${q(text.slice(0, 300))}; the replacement list offered ${options.length} entries, without the archived ${q(archivedProbe)} or the type itself. After choosing ${q(replacement)} and confirming, M-${S.reassignMatter} reads Matter type ${q(mtName)}. Other shows the image "Other is system-protected and can't be archived" in place of Archive.`;
    });

  await step(SC, role,
    "Default type: Contracts and Matters each have one type named Default with no label; its row shows Archive, and the dialog refuses and says it is the Default type",
    "The Archive dialog refuses the Default type with a reason; the type stays live.",
    async () => {
      const out = [];
      for (const [mod, heading] of [["contracts", "Contract types"], ["matters", "Matter types"]]) {
        await admin.goto(`${BASE}/settings/${mod}/types`);
        await admin.getByRole("heading", { name: heading }).waitFor();
        const rowText = flat(await row(admin, "Default").innerText());
        await admin.getByRole("button", { name: "Archive Default", exact: true }).click();
        const d = admin.getByRole("dialog");
        await d.waitFor();
        const before = flat(await d.innerText());
        const confirm = d.getByRole("button", { name: /^Archive/ }).last();
        const select = d.getByRole("combobox");
        if (await select.count()) {
          const opts = (await select.locator("option").allInnerTexts()).map(flat);
          const pick = opts.find((o) => o && !/^(No reassignment|Choose)/.test(o));
          if (pick) await select.selectOption({ label: pick });
        }
        let after = before;
        if (await confirm.isEnabled()) {
          await confirm.click();
          await pause(2000);
          after = flat(await d.innerText().catch(() => "(dialog closed)"));
        }
        const refusal = flat(await d.getByRole("alert").allInnerTexts().then((a) => a.join(" ")).catch(() => ""));
        expectThat(/is the Default type/.test(refusal), `${mod}: no Default type refusal: ${refusal}`);
        await admin.keyboard.press("Escape");
        await d.waitFor({ state: "hidden" }).catch(() => {});
        await admin.reload();
        await admin.getByRole("heading", { name: heading }).waitFor();
        const stillLive = await admin.getByRole("button", { name: "Archive Default", exact: true }).count();
        expectThat(stillLive === 1, `${mod}: Default no longer live`);
        out.push(`${heading}: row ${q(rowText)} (no Default label); the Archive dialog read ${q(before.slice(0, 160))}; after choosing a replacement and Archive it showed ${q(flat(refusal))}; the Default row stayed live after reload`);
      }
      return out.join(". ") + ".";
    });

  await step(SC, role,
    "Create dialogs preselect the Default type",
    "The Create matter dialog preselects Default as its Matter type.",
    async () => {
      await admin.goto(`${BASE}/matters`);
      await admin.getByRole("button", { name: /Create matter|New matter/ }).first().click();
      const d = admin.getByRole("dialog");
      await d.waitFor();
      const sel = d.getByLabel(/Matter type/).first();
      const value = await sel.evaluate((el) => (el.tagName === "SELECT" ? el.selectedOptions[0]?.textContent : el.textContent));
      await admin.keyboard.press("Escape");
      expectThat(flat(value) === "Default", `Matter type preselected ${q(value)}`);
      return `Matters > Create matter opened with Matter type ${q(flat(value))} preselected.`;
    });

  await step(SC, role,
    "Show archived and Restore: restoring makes the type available again and does not move reassigned records back",
    "Show archived lists the archived type with Restore; after Restore it is live and the reassigned Matter keeps the replacement.",
    async () => {
      await admin.goto(`${BASE}/settings/matters/types`);
      await admin.getByRole("heading", { name: "Matter types" }).waitFor();
      const toggle = admin.getByRole("switch", { name: /Show archived/ }).or(admin.getByRole("checkbox", { name: /Show archived/ }));
      await toggle.first().click();
      const restore = admin.getByRole("button", { name: `Restore ${typeRenamed}`, exact: true });
      await restore.waitFor({ timeout: 10000 });
      await restore.click();
      await admin.getByRole("button", { name: `Archive ${typeRenamed}`, exact: true }).waitFor({ timeout: 15000 });
      const matter = await api(admin, "GET", `/api/v1/matters/${S.reassignMatter}`);
      const mtName = matter.body?.matter?.matterTypeName;
      expectThat(mtName === replacement, `matter moved back to ${mtName}`);
      return `Show archived listed ${q(typeRenamed)} with "Restore ${typeRenamed}". Restore made it live again (its Archive control returned). M-${S.reassignMatter} still reads Matter type ${q(mtName)}.`;
    });

  await step(SC, role,
    "Negative check (API): invalid reassignment onto an archived type or onto the type itself is refused",
    "The archive dialog cannot offer these choices, so the API is asked directly and refuses both with a 400 and a reason.",
    async () => {
      const toArchived = await api(admin, "POST", `/api/v1/matter-types/${S.replacementTypeId}/archive`, { reassignToId: S.archivedMatterTypeId });
      const toSelf = await api(admin, "POST", `/api/v1/matter-types/${S.replacementTypeId}/archive`, { reassignToId: S.replacementTypeId });
      const still = (await api(admin, "GET", `/api/v1/matter-types/${S.replacementTypeId}`)).body;
      expectThat(toArchived.status === 400 && toSelf.status === 400, `answers ${toArchived.status}, ${toSelf.status}`);
      const archivedAt = still?.archivedAt ?? still?.type?.archivedAt ?? null;
      expectThat(!archivedAt, "replacement type was archived");
      return `As the Administrator, POST /api/v1/matter-types/{${q(replacement)}}/archive with reassignToId = the archived ${q(archivedProbe)} answered ${toArchived.status} ${q(toArchived.body?.detail)}; with reassignToId = itself answered ${toSelf.status} ${q(toSelf.body?.detail)}. The type stayed live (archivedAt ${archivedAt}).`;
    }, "api-refusal");
}

// =====================================================================
// V-C38 types-statuses-fields: Document types
// =====================================================================
async function uploadTypeChoices(page, recordPath) {
  await page.goto(`${BASE}${recordPath}`);
  await page.getByRole("button", { name: "Upload", exact: true }).first().click();
  const d = page.getByRole("dialog", { name: "Upload document" });
  await d.waitFor();
  const type = d.getByRole("combobox", { name: "Type" });
  const options = (await type.count()) ? (await type.locator("option").allInnerTexts()).map(flat) : null;
  await d.getByRole("button", { name: "Cancel" }).click();
  return options;
}

async function documentsSection(admin) {
  const SC = "V-C38";
  const role = "administrator";
  const A = PEOPLE.administrator;
  const matterDoc = name(SC, "Board resolution");
  const matterDocRenamed = name(SC, "Board resolution renamed");
  currentPage = admin;

  await step(SC, role,
    "Add Document types, steps 1-4: Settings > Organization > Documents; Matters tab; Add type, enter a name, Save; rename and reorder",
    "The new Document type row appears in the Matters list; rename and keyboard reorder persist.",
    async () => {
      await openSettings(admin, A, "Documents");
      const tabs = (await admin.getByRole("navigation", { name: "Document type lists" }).getByRole("link").allInnerTexts()).map(flat);
      expectThat(q(tabs) === q(["Matters", "Contracts", "Entities"]), `tabs ${q(tabs)}`);
      await pane(admin, "Document type lists", "Matters");
      await admin.getByRole("heading", { name: "Document types" }).waitFor();
      const before = (await admin.getByRole("button", { name: /^Rename / }).allInnerTexts()).map(flat);
      await addListRow(admin, "Add type", "New type name", matterDoc);
      record("matter document type", matterDoc);
      await renameRow(admin, matterDoc, matterDocRenamed);
      let moved = "only one row, no reorder";
      if ((await admin.getByRole("button", { name: /^Reorder / }).count()) > 1) {
        const { before: b, after: a } = await moveUp(admin, matterDocRenamed);
        moved = `ArrowUp moved it from position ${b} to ${a}, kept after reload`;
      }
      if (!S.docMatter) {
        const mts = (await api(admin, "GET", "/api/v1/matter-types")).body?.matterTypes ?? [];
        const m = await api(admin, "POST", "/api/v1/matters", { title: name(SC, "Document types matter"), matterTypeId: mts.find((t) => t.displayName === "Default").id });
        S.docMatter = m.body?.matter?.number;
        record("matter", name(SC, "Document types matter"), { number: S.docMatter });
      }
      const upload = await uploadTypeChoices(admin, `/matters/${S.docMatter}/documents`);
      expectThat(upload && upload.includes(matterDocRenamed), `Matter upload Type choices ${q(upload)}`);
      return `Settings > Organization > Documents shows the lists ${q(tabs)}; Knowledge has none. The Matters list held ${before.length} rows before this run (${q(before)}), all made by other DOC-030 agents on this shared lab, so "starts empty" cannot be seen here. Add type + Save added ${q(matterDoc)}; Rename changed it to ${q(matterDocRenamed)}; ${moved}. A Matter's Upload dialog now shows a Type choice ${q(upload)}.`;
    });

  await step(SC, role,
    "Contracts tab: six fixed types with a lock and no rename or archive control",
    "Draft · ours, Draft · theirs, Redline · theirs, Redline · ours, Executed and Amendment each show a lock and no Rename or Archive.",
    async () => {
      await admin.goto(`${BASE}/settings/documents/matters`);
      await pane(admin, "Document type lists", "Contracts");
      await admin.getByRole("heading", { name: "Document types" }).waitFor();
      await admin.getByRole("button", { name: /^Reorder / }).first().waitFor();
      const fixed = ["Draft · ours", "Draft · theirs", "Redline · theirs", "Redline · ours", "Executed", "Amendment"];
      const out = [];
      for (const f of fixed) {
        const lock = await admin.getByRole("img", { name: `${f} is fixed. Contract workflows depend on it.` }).count();
        const rename = await admin.getByRole("button", { name: `Rename ${f}`, exact: true }).count();
        const archive = await admin.getByRole("button", { name: `Archive ${f}`, exact: true }).count();
        expectThat(lock === 1 && rename === 0 && archive === 0, `${f}: lock ${lock}, rename ${rename}, archive ${archive}`);
        out.push(f);
      }
      const others = (await admin.getByRole("button", { name: /^Rename / }).allInnerTexts()).map(flat);
      return `The Contracts list shows ${q(out)}, each with the image "<name> is fixed. Contract workflows depend on it." and no Rename or Archive control. Other rows present, all added by other DOC-030 agents: ${q(others)}.`;
    });

  await step(SC, role,
    "Entities tab: upload dialogs show a type choice only when the module's list holds a live type; archive asks for no replacement; Show archived and Restore",
    "With no live Entity Document type, an Entity upload has no Type choice; after Add type it has one; Archive names the version count without a replacement choice; the archived type leaves the upload choices; Restore brings it back.",
    async () => {
      const entities = (await api(admin, "GET", "/api/v1/entities")).body;
      const entity = (entities?.entities ?? entities?.items ?? entities ?? [])[0];
      expectThat(entity?.id, "no entity to upload to");
      const entityPath = `/entities/${entity.id}/documents`;
      await admin.goto(`${BASE}/settings/documents/entities`);
      await admin.getByRole("heading", { name: "Document types" }).waitFor();
      await pause(800);
      const live = (await admin.getByRole("button", { name: /^Rename / }).allInnerTexts()).map(flat);
      const before = live.length === 0 ? await uploadTypeChoices(admin, entityPath) : "(list not empty)";
      const entDoc = name(SC, "Entity certificate");
      await admin.goto(`${BASE}/settings/documents/entities`);
      await addListRow(admin, "Add type", "New type name", entDoc);
      record("entity document type", entDoc);
      const withType = await uploadTypeChoices(admin, entityPath);
      await admin.goto(`${BASE}/settings/documents/entities`);
      await admin.getByRole("button", { name: `Archive ${entDoc}`, exact: true }).click();
      const d = admin.getByRole("dialog");
      await d.waitFor();
      const text = flat(await d.innerText());
      const selects = await d.getByRole("combobox").count();
      await d.getByRole("button", { name: /^Archive/ }).last().click();
      await d.waitFor({ state: "hidden" });
      const afterArchive = await uploadTypeChoices(admin, entityPath);
      await admin.goto(`${BASE}/settings/documents/entities`);
      await admin.getByRole("switch", { name: "Show archived" }).click();
      await admin.getByRole("button", { name: `Restore ${entDoc}`, exact: true }).click();
      await admin.getByRole("button", { name: `Archive ${entDoc}`, exact: true }).waitFor({ timeout: 15000 });
      const restored = await uploadTypeChoices(admin, entityPath);
      // Leave the Entities list as found: archive the type again.
      await admin.goto(`${BASE}/settings/documents/entities`);
      await admin.getByRole("button", { name: `Archive ${entDoc}`, exact: true }).click();
      await admin.getByRole("dialog").getByRole("button", { name: /^Archive/ }).last().click();
      await admin.getByRole("dialog").waitFor({ state: "hidden" });
      expectThat(live.length > 0 || before === null, `Entity upload with an empty list offered ${q(before)}`);
      expectThat(withType?.includes(entDoc), `upload after Add type ${q(withType)}`);
      expectThat(selects === 0, "archive dialog asks for a replacement");
      expectThat(!(afterArchive ?? []).includes(entDoc), `archived type still offered ${q(afterArchive)}`);
      expectThat(restored?.includes(entDoc), `restored type not offered ${q(restored)}`);
      return `The Entities list held ${q(live)} live rows. On Entity ${q(entity.legalName ?? entity.name)} the Upload dialog showed ${before === null ? "no Type choice" : q(before)}. After Add type ${q(entDoc)} it showed Type ${q(withType)}. Archive read ${q(text)} with ${selects} choice controls; afterwards the Upload dialog showed ${afterArchive === null ? "no Type choice" : q(afterArchive)}. Show archived + Restore brought it back (${q(restored)}). The type was archived again to leave the list as found.`;
    });
}

// =====================================================================
// V-C38 types-statuses-fields: Statuses
// =====================================================================
async function statusesSection(admin) {
  const SC = "V-C38";
  const role = "administrator";
  const A = PEOPLE.administrator;
  currentPage = admin;
  const cStatus = name(SC, "Contract status");
  const cRenamed = name(SC, "Contract status renamed");
  const mStatus = name(SC, "Matter status");
  const mWaiting = name(SC, "Matter status waiting");
  const mClosed = name(SC, "Matter status closed");

  await step(SC, role,
    "Configure Statuses, Contract: Contracts > Statuses; Add status, name, Stage; Cancel discards; Save status; rename and reorder; no control changes the Stage",
    "The new row reads its Stage; the row has no Stage control; rename and reorder persist; Draft, Active and Expired are protected.",
    async () => {
      await openSettings(admin, A, "Contracts");
      await pane(admin, "Contracts panes", "Statuses");
      await admin.getByRole("heading", { name: "Contract statuses" }).waitFor();
      await admin.getByRole("button", { name: "Add status", exact: true }).click();
      await admin.getByRole("textbox", { name: "New status name" }).fill(name(SC, "Cancelled status"));
      const stages = (await admin.getByRole("combobox", { name: "New status stage" }).locator("option").allInnerTexts()).map(flat);
      await admin.getByRole("button", { name: "Cancel", exact: true }).click();
      await admin.getByRole("button", { name: "Add status", exact: true }).click();
      await admin.getByRole("textbox", { name: "New status name" }).fill(cStatus);
      await admin.getByRole("combobox", { name: "New status stage" }).selectOption({ label: "Review" });
      await admin.getByRole("button", { name: "Save status", exact: true }).click();
      await admin.getByRole("button", { name: `Rename ${cStatus}`, exact: true }).waitFor({ timeout: 15000 });
      record("contract status", cStatus);
      await renameRow(admin, cStatus, cRenamed);
      const r = row(admin, cRenamed);
      const rowText = flat(await r.innerText());
      const rowControls = (await r.getByRole("combobox").count()) + (await r.getByRole("radio").count());
      const { before, after } = await moveUp(admin, cRenamed);
      const cancelled = await admin.getByRole("button", { name: `Rename ${name(SC, "Cancelled status")}`, exact: true }).count();
      const locks = [];
      for (const n of ["Draft", "Active", "Expired"]) locks.push(await admin.getByRole("img", { name: `${n} is system-protected and can't be archived` }).count());
      expectThat(/Stage: Review/.test(rowText) && rowControls === 0, `row ${rowText}, controls ${rowControls}`);
      expectThat(cancelled === 0 && locks.every((l) => l === 1), `cancelled ${cancelled}, locks ${locks}`);
      return `Contracts > Statuses: Add status offered Stage choices ${q(stages)}. Cancel left no row. Save status added the row; after Rename it reads ${q(rowText)} with ${rowControls} Stage controls. ArrowUp moved it from ${before} to ${after} after reload. Draft, Active and Expired show "<name> is system-protected and can't be archived".`;
    });

  await step(SC, role,
    "Contract Status archive: the dialog for an in-use Status asks you to move Contracts yourself and does not reassign; an unused custom Status archives",
    "In-use: the dialog says to move the Contracts first and has no replacement choice. Unused: Archive status removes it.",
    async () => {
      await admin.getByRole("button", { name: "Archive Terminated", exact: true }).click();
      let d = admin.getByRole("dialog");
      await d.waitFor();
      const inUse = flat(await d.innerText());
      const choices = await d.getByRole("combobox").count();
      const canArchive = await d.getByRole("button", { name: "Archive status" }).isEnabled().catch(() => false);
      await d.getByRole("button", { name: "Cancel" }).click();
      await admin.getByRole("button", { name: `Archive ${cRenamed}`, exact: true }).click();
      d = admin.getByRole("dialog");
      const unused = flat(await d.innerText());
      await d.getByRole("button", { name: "Archive status" }).click();
      await d.waitFor({ state: "hidden" });
      const gone = await admin.getByRole("button", { name: `Rename ${cRenamed}`, exact: true }).count();
      expectThat(choices === 0 && /Move/.test(inUse) && !canArchive, `in-use dialog ${inUse}, choices ${choices}, archive enabled ${canArchive}`);
      expectThat(gone === 0, "status still listed");
      return `Archive Terminated (seeded, in use) read ${q(inUse)} with ${choices} replacement controls and Archive status enabled=${canArchive}; Cancel closed it. Archive on the unused ${q(cRenamed)} read ${q(unused)}; Archive status removed it from the live list.`;
    });

  await step(SC, role,
    "Configure Statuses, Matter: Matters > Statuses; Add status in the Open Category with the default group (In progress) and one in Waiting; a Closed Category Status; change a group on its row",
    "New Open-Category Status defaults to In progress; the row group control changes and persists; Category is fixed; Open and Closed are protected.",
    async () => {
      await openSettings(admin, A, "Matters");
      await pane(admin, "Matters panes", "Statuses");
      await admin.getByRole("heading", { name: "Matter statuses" }).waitFor();
      await admin.getByRole("button", { name: "Add status", exact: true }).click();
      await admin.getByRole("textbox", { name: "New status name" }).fill(mStatus);
      const cats = (await admin.getByRole("combobox", { name: "New status category" }).locator("option").allInnerTexts()).map(flat);
      await admin.getByRole("combobox", { name: "New status category" }).selectOption({ label: "Open" });
      const groupDefault = await admin.getByRole("combobox", { name: "New status group" }).evaluate((e) => e.selectedOptions[0].textContent);
      await admin.getByRole("button", { name: "Save status", exact: true }).click();
      await admin.getByRole("button", { name: `Rename ${mStatus}`, exact: true }).waitFor({ timeout: 15000 });
      await admin.getByRole("button", { name: "Add status", exact: true }).click();
      await admin.getByRole("textbox", { name: "New status name" }).fill(mWaiting);
      await admin.getByRole("combobox", { name: "New status category" }).selectOption({ label: "Open" });
      await admin.getByRole("combobox", { name: "New status group" }).selectOption({ label: "Waiting" });
      await admin.getByRole("button", { name: "Save status", exact: true }).click();
      await admin.getByRole("button", { name: `Rename ${mWaiting}`, exact: true }).waitFor({ timeout: 15000 });
      await admin.getByRole("button", { name: "Add status", exact: true }).click();
      await admin.getByRole("textbox", { name: "New status name" }).fill(mClosed);
      await admin.getByRole("combobox", { name: "New status category" }).selectOption({ label: "Closed" });
      const closedGroup = await admin.getByRole("combobox", { name: "New status group" }).count();
      await admin.getByRole("button", { name: "Save status", exact: true }).click();
      await admin.getByRole("button", { name: `Rename ${mClosed}`, exact: true }).waitFor({ timeout: 15000 });
      for (const n of [mStatus, mWaiting, mClosed]) record("matter status", n);
      const group = admin.getByRole("combobox", { name: `Group for ${mStatus}` });
      const saved = await group.evaluate((e) => e.selectedOptions[0].textContent);
      await group.selectOption({ label: "Open" });
      await pause(1500);
      await admin.reload();
      const reloaded = await admin.getByRole("combobox", { name: `Group for ${mStatus}` }).evaluate((e) => e.selectedOptions[0].textContent);
      const waitingGroup = await admin.getByRole("combobox", { name: `Group for ${mWaiting}` }).evaluate((e) => e.selectedOptions[0].textContent);
      const closedRow = flat(await row(admin, mClosed).innerText());
      const closedRowGroup = await row(admin, mClosed).getByRole("combobox").count();
      const locks = [];
      for (const n of ["Open", "Closed"]) locks.push(await admin.getByRole("img", { name: `${n} is system-protected and can't be archived` }).count());
      expectThat(groupDefault === "In progress" && saved === "In progress" && reloaded === "Open" && waitingGroup === "Waiting", `groups ${groupDefault} ${saved} ${reloaded} ${waitingGroup}`);
      expectThat(closedRowGroup === 0 && /Category: Closed/.test(closedRow), `closed row ${closedRow}`);
      expectThat(locks.every((l) => l === 1), `locks ${locks}`);
      return `Matters > Statuses: Add status offered Categories ${q(cats)}; with Open the group control defaulted to ${q(groupDefault)}. Save status added ${q(mStatus)} (row group ${q(saved)}) and ${q(mWaiting)} (row group ${q(waitingGroup)}). With Closed the add row showed ${closedGroup} group controls; ${q(mClosed)} reads ${q(closedRow)} with no group control. Changing ${q(mStatus)}'s row group to Open saved and read ${q(reloaded)} after reload. Open and Closed show the protected lock.`;
    });

  await step(SC, role,
    "Matter Status archive: for an in-use custom Status, choose a replacement in the same Category",
    "The dialog offers only Open-Category Statuses; after Archive status the Matter moves to the replacement.",
    async () => {
      const statuses = (await api(admin, "GET", "/api/v1/matter-statuses")).body;
      const list = statuses?.statuses ?? statuses?.matterStatuses ?? statuses ?? [];
      const mine = list.find((s) => s.displayName === mStatus);
      const mts = (await api(admin, "GET", "/api/v1/matter-types")).body;
      const defaultType = (mts?.matterTypes ?? []).find((t) => t.displayName === "Default");
      const m = await api(admin, "POST", "/api/v1/matters", { title: name(SC, "Status matter"), matterTypeId: defaultType.id });
      const number = m.body?.matter?.number ?? m.body?.number;
      expectThat(number, `fixture matter ${m.status} ${q(m.body)}`);
      record("matter", name(SC, "Status matter"), { number });
      const p = await api(admin, "PATCH", `/api/v1/matters/${number}`, { statusId: mine.id });
      expectThat(p.status < 300, `status fixture ${p.status} ${q(p.body)}`);
      await admin.reload();
      await admin.getByRole("button", { name: `Archive ${mStatus}`, exact: true }).click();
      const d = admin.getByRole("dialog");
      await d.waitFor();
      const text = flat(await d.innerText());
      const opts = (await d.getByRole("combobox").locator("option").allInnerTexts()).map(flat);
      const closedOffered = opts.includes("Closed") || opts.includes(mClosed);
      await d.getByRole("combobox").selectOption({ label: mWaiting });
      await d.getByRole("button", { name: "Archive status" }).click();
      await d.waitFor({ state: "hidden", timeout: 15000 });
      const after = (await api(admin, "GET", `/api/v1/matters/${number}`)).body?.matter?.statusName;
      expectThat(!closedOffered && after === mWaiting, `closed offered ${closedOffered}; status after ${after}`);
      return `M-${number} (API fixture) was set to ${q(mStatus)}. Its Archive dialog read ${q(text.slice(0, 200))} and offered ${q(opts)} (no Closed-Category Status). With ${q(mWaiting)} chosen, Archive status moved M-${number} to ${q(after)}.`;
    });

  await step(SC, role,
    "Negative check (API): a Stage or Category change on an existing Status is refused",
    "Neither page has a Stage or Category control, so the API is asked: a rename body carrying stage or category is refused.",
    async () => {
      const cs = (await api(admin, "GET", "/api/v1/contract-statuses?includeArchived=true")).body;
      const clist = cs?.statuses ?? cs?.contractStatuses ?? cs ?? [];
      const c = clist.find((s) => s.displayName === cRenamed) ?? clist.find((s) => s.displayName === "Terminated");
      const ms = (await api(admin, "GET", "/api/v1/matter-statuses")).body;
      const mlist = ms?.statuses ?? ms?.matterStatuses ?? ms ?? [];
      const mm = mlist.find((s) => s.displayName === mWaiting);
      const cr = await api(admin, "PATCH", `/api/v1/contract-statuses/${c.id}`, { displayName: c.displayName, stage: "ended" });
      const mr = await api(admin, "PATCH", `/api/v1/matter-statuses/${mm.id}`, { displayName: mm.displayName, category: "closed" });
      const cAfter = ((await api(admin, "GET", "/api/v1/contract-statuses?includeArchived=true")).body?.contractStatuses ?? []).find((s) => s.id === c.id);
      expectThat(cr.status === 400 && mr.status === 400, `answers ${cr.status} ${mr.status}`);
      return `As the Administrator, PATCH /api/v1/contract-statuses/{${q(c.displayName)}} with stage "ended" answered ${cr.status} ${q(cr.body?.detail ?? cr.body?.message)}; the Status keeps Stage ${q(cAfter?.stage ?? c.stage)}. PATCH /api/v1/matter-statuses/{${q(mm.displayName)}} with category "closed" answered ${mr.status} ${q(mr.body?.detail ?? mr.body?.message)}.`;
    }, "api-refusal");
}

// =====================================================================
// V-C38 types-statuses-fields: Fields
// =====================================================================
async function fieldsSection(admin) {
  const SC = "V-C38";
  const role = "administrator";
  const A = PEOPLE.administrator;
  currentPage = admin;

  await step(SC, role,
    "Create a Field, first paragraphs: Matter and Contract Fields show a collapsed Default Fields card of locked read-only rows above an expanded Custom Fields card; Governing law, Jurisdiction and Our position show a lock in place of archive",
    "Default Fields starts collapsed and expands on its heading into locked rows with no controls; Custom Fields starts expanded with Add field; the three default catalog Fields have a lock and no Archive.",
    async () => {
      const out = [];
      for (const [link, paneNav] of [["Matters", "Matters panes"], ["Contracts", "Contracts panes"]]) {
        await openSettings(admin, A, link);
        await pane(admin, paneNav, "Fields");
        const defaults = admin.getByRole("region", { name: "Default Fields" });
        const custom = admin.getByRole("region", { name: "Custom Fields" });
        await defaults.waitFor({ timeout: 15000 });
        const toggle = defaults.getByRole("button", { name: "Default Fields" });
        const start = await toggle.getAttribute("aria-expanded");
        const customStart = await custom.getByRole("button", { name: "Custom Fields" }).getAttribute("aria-expanded");
        const addField = await custom.getByRole("button", { name: "Add field" }).count();
        await toggle.click();
        await until(async () => (await toggle.getAttribute("aria-expanded")) === "true", "Default Fields did not expand");
        const rows = (await defaults.getByRole("listitem").allInnerTexts()).map(flat);
        const locks = await defaults.getByRole("img", { name: /: built-in field, read-only here$/ }).count();
        const buttons = await defaults.getByRole("list").getByRole("button").count();
        expectThat(start === "false" && customStart === "true" && addField === 1, `${link}: default ${start}, custom ${customStart}, add ${addField}`);
        expectThat(rows.length > 0 && locks === rows.length && buttons === 0, `${link}: rows ${rows.length}, locks ${locks}, buttons ${buttons}`);
        let defaultsNote = "";
        if (link === "Contracts") {
          const notes = [];
          for (const f of ["Governing law", "Jurisdiction", "Our position"]) {
            const lock = await custom.getByRole("img", { name: `${f} is a default Field and can't be archived` }).count();
            const archive = await custom.getByRole("button", { name: `Archive ${f}`, exact: true }).count();
            const rename = await custom.getByRole("button", { name: `Rename ${f}`, exact: true }).count();
            expectThat(lock === 1 && archive === 0 && rename === 1, `${f}: lock ${lock}, archive ${archive}, rename ${rename}`);
            notes.push(f);
          }
          const api1 = await api(admin, "GET", "/api/v1/fields");
          const gl = (api1.body?.fields ?? []).find((f) => f.displayName === "Governing law");
          const refused = gl ? await api(admin, "POST", `/api/v1/fields/${gl.id}/archive`, {}) : { status: "n/a" };
          defaultsNote = ` Custom Fields lists ${q(notes)} with Rename and the image "<name> is a default Field and can't be archived" in place of Archive; the API refuses the archive of Governing law with ${refused.status} ${q(refused.body?.detail ?? "")}.`;
        }
        out.push(`${link} > Fields: Default Fields aria-expanded=${start}, Custom Fields aria-expanded=${customStart} with Add field. Expanded, Default Fields lists ${rows.length} rows (${q(rows.slice(0, 4))}…), each with a "<name>: built-in field, read-only here" lock and no buttons.${defaultsNote}`);
      }
      return out.join(" ");
    });

  await step(SC, role,
    "Create a Field, steps 1-5: Matters > Fields > Add field with Name, Description, Type and Options; the type cannot change after creation; Boolean has no Yes/No control at creation; no reorder handles",
    "The Type list matches the guide; Options take one per line; the row shows the new Field; Edit has no Type control; the catalog has no reorder handles.",
    async () => {
      await openSettings(admin, A, "Matters");
      await pane(admin, "Matters panes", "Fields");
      const custom = admin.getByRole("region", { name: "Custom Fields" });
      await custom.getByRole("button", { name: "Add field" }).click();
      const d = admin.getByRole("dialog", { name: "Add field" });
      const types = (await d.getByLabel("Type").locator("option").allInnerTexts()).map(flat).filter((t) => t !== "Type…");
      const expected = ["Text", "Long text", "Number", "Currency", "Date", "Boolean", "Single select", "Multi select", "User", "Entity"];
      expectThat(q(types) === q(expected), `Type list ${q(types)}`);
      S.matterSelectField = name(SC, "Assessment scope");
      await d.getByLabel("Name").fill(S.matterSelectField);
      await d.getByLabel("Description").fill("Which part of the supplier the assessment covers.");
      await d.getByLabel("Type").selectOption({ label: "Single select" });
      await d.getByLabel("Options").fill("Security\nPrivacy\nFinance");
      const aiPrompt = await d.getByLabel("AI prompt").count();
      await d.getByRole("button", { name: "Add field" }).click();
      await d.waitFor({ state: "hidden" });
      await admin.getByRole("button", { name: `Rename ${S.matterSelectField}`, exact: true }).waitFor();
      record("matter field", S.matterSelectField);
      const rowText = flat(await row(admin, S.matterSelectField).innerText());
      S.matterBoolField = name(SC, "Assessment signed off");
      await custom.getByRole("button", { name: "Add field" }).click();
      await d.getByLabel("Name").fill(S.matterBoolField);
      await d.getByLabel("Type").selectOption({ label: "Boolean" });
      const boolControls = (await d.getByRole("radio").count()) + (await d.getByRole("switch").count()) + (await d.getByRole("checkbox").count());
      await d.getByRole("button", { name: "Add field" }).click();
      await d.waitFor({ state: "hidden" });
      await admin.getByRole("button", { name: `Rename ${S.matterBoolField}`, exact: true }).waitFor();
      record("matter field", S.matterBoolField);
      const handles = await custom.getByRole("button", { name: /^Reorder / }).count();
      await admin.getByRole("button", { name: `Edit ${S.matterSelectField}`, exact: true }).click();
      const e = admin.getByRole("dialog", { name: `Edit ${S.matterSelectField}` });
      const typeCombo = await e.getByRole("combobox", { name: "Type" }).count();
      const immutable = await e.getByText("The field type is immutable after creation.").count();
      const options = await e.getByLabel("Options").inputValue();
      await e.getByRole("button", { name: "Cancel" }).click();
      expectThat(typeCombo === 0 && immutable > 0, `Edit type combo ${typeCombo}`);
      expectThat(handles === 0 && boolControls === 0 && aiPrompt === 0, `handles ${handles}, bool controls ${boolControls}, ai ${aiPrompt}`);
      return `Add field offered Types ${q(types)}. ${q(S.matterSelectField)} (Single select, Options "Security/Privacy/Finance") saved as row ${q(rowText)}; a Matter Field has no AI prompt. The Boolean Field ${q(S.matterBoolField)} was created with ${boolControls} Yes/No controls in the dialog. Custom Fields shows ${handles} reorder handles. Edit shows no Type control and reads "The field type is immutable after creation."; Options read ${q(options)}.`;
    });

  await step(SC, role,
    "Contract Fields: AI prompt on Contract Fields other than User and Entity; a Text or Long text Field has Answer style with Organisation default",
    "Text shows AI prompt and Answer style with Organisation default; User and Entity show no AI prompt; Number shows AI prompt without Answer style.",
    async () => {
      await openSettings(admin, A, "Contracts");
      await pane(admin, "Contracts panes", "Fields");
      const custom = admin.getByRole("region", { name: "Custom Fields" });
      await custom.getByRole("button", { name: "Add field" }).click();
      const d = admin.getByRole("dialog", { name: "Add field" });
      const seen = {};
      for (const t of ["Text", "Long text", "Number", "User", "Entity"]) {
        await d.getByLabel("Type").selectOption({ label: t });
        await pause(300);
        const style = d.getByRole("combobox", { name: "Answer style" });
        seen[t] = {
          aiPrompt: await d.getByLabel("AI prompt").count(),
          answerStyle: (await style.count()) ? (await style.locator("option").allInnerTexts()).map(flat) : null,
        };
      }
      S.contractTextField = name(SC, "Supplier tier");
      await d.getByLabel("Name").fill(S.contractTextField);
      await d.getByLabel("Type").selectOption({ label: "Text" });
      await d.getByRole("button", { name: "Add field" }).click();
      await d.waitFor({ state: "hidden" });
      await admin.getByRole("button", { name: `Rename ${S.contractTextField}`, exact: true }).waitFor();
      record("contract field", S.contractTextField);
      expectThat(seen.Text.aiPrompt === 1 && seen.Text.answerStyle?.some((o) => /^Organisation default/.test(o)), `Text ${q(seen.Text)}`);
      expectThat(seen["Long text"].answerStyle && seen.User.aiPrompt === 0 && seen.Entity.aiPrompt === 0 && !seen.Number.answerStyle, `seen ${q(seen)}`);
      return `Contracts > Fields > Add field: ${Object.entries(seen).map(([t, v]) => `${t}: AI prompt ${v.aiPrompt ? "shown" : "absent"}, Answer style ${v.answerStyle ? q(v.answerStyle) : "absent"}`).join("; ")}. The Text Field ${q(S.contractTextField)} was added with Organisation default kept.`;
    });

  await step(SC, role,
    "Create a Field, step 1 for Entities: Entities > Fields > Add field",
    "An Entity Field can be added.",
    async () => {
      await openSettings(admin, A, "Entities");
      await pane(admin, "Entities panes", "Fields");
      await admin.getByRole("button", { name: "Add field" }).first().click();
      const d = admin.getByRole("dialog", { name: "Add field" });
      S.entityField = name(SC, "Registry code");
      await d.getByLabel("Name").fill(S.entityField);
      await d.getByLabel("Type").selectOption({ label: "Text" });
      await d.getByRole("button", { name: "Add field" }).click();
      await d.waitFor({ state: "hidden" });
      await admin.getByRole("button", { name: `Rename ${S.entityField}`, exact: true }).waitFor();
      record("entity field", S.entityField);
      const defaults = await admin.getByRole("region", { name: "Default Fields" }).count();
      return `Entities > Fields: Add field created ${q(S.entityField)}. The page shows ${defaults} Default Fields cards.`;
    });
}

// =====================================================================
// V-C38 types-statuses-fields: Form, Branch, records, Field archive
// =====================================================================
const formRow = (page, label) => page.getByRole("region", { name: "Form" }).getByRole("group", { name: label, exact: true });
async function switchState(page, rowLabel, sw) {
  const s = page.getByRole("switch", { name: `${rowLabel}: ${sw}`, exact: true });
  return { checked: (await s.getAttribute("aria-checked")) === "true", locked: (await s.getAttribute("aria-disabled")) === "true" };
}
async function touchpoint(page, rowLabel) {
  const t = flat(await formRow(page, rowLabel).innerText());
  return (t.match(/(Intake|Creation|Record)\s*$/) ?? t.match(/\b(Intake|Creation|Record)\b(?!.*\b(Intake|Creation|Record)\b)/) ?? [null, null])[1];
}
async function flip(page, rowLabel, sw) {
  const before = await switchState(page, rowLabel, sw);
  await page.getByRole("switch", { name: `${rowLabel}: ${sw}`, exact: true }).click();
  await until(async () => (await switchState(page, rowLabel, sw)).checked !== before.checked, `${rowLabel}: ${sw} did not change`);
  const saved = await until(async () => (await formRow(page, rowLabel).getByText("Saved", { exact: true }).count()) > 0 || (await page.getByRole("region", { name: "Form" }).getByText("Saved", { exact: true }).count()) > 0, `${rowLabel}: ${sw} showed no Saved`).catch(() => false);
  await pause(600);
  return !!saved;
}

async function formSection(admin) {
  const SC = "V-C38";
  const role = "administrator";
  const A = PEOPLE.administrator;
  currentPage = admin;
  const nda = name(SC, "Fixed-term NDA");
  const tier = name(SC, "Supplier tier form");
  const owner = name(SC, "Business contact");

  await step(SC, role,
    "Attach Fields, step 1: Types > Edit on the type > Form; Title and Type stay pinned; built-in Rows show Built-in and Visible on Portal Fixed",
    "The Form tab opens; Title and Type have a lock and disabled switches; built-in Rows show Fixed under Visible on Portal.",
    async () => {
      await openSettings(admin, A, "Contracts");
      await pane(admin, "Contracts panes", "Types");
      await addListRow(admin, "Add type", "New type name", nda);
      record("contract type", nda);
      await admin.getByRole("button", { name: `Edit ${nda}`, exact: true }).click();
      await admin.getByRole("navigation", { name: "Type sections" }).getByRole("link", { name: "Form" }).click();
      await admin.getByRole("region", { name: "Form" }).waitFor();
      S.ndaFormUrl = admin.url();
      S.ndaTypeId = S.ndaFormUrl.match(/types\/([^/]+)\/form/)[1];
      const header = flat(await admin.getByRole("region", { name: "Form" }).locator("header").innerText());
      const rows = await admin.getByRole("region", { name: "Form" }).getByRole("group").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
      const title = flat(await formRow(admin, "Title").innerText());
      const titleSw = await switchState(admin, "Title", "Required for creation");
      const termType = flat(await formRow(admin, "Term type").innerText());
      expectThat(rows[0] === "Title" && rows[1] === "Type", `first rows ${q(rows.slice(0, 2))}`);
      expectThat(/Position and switches are fixed/.test(title) && titleSw.checked, `title ${title}`);
      expectThat(/Built-in/.test(termType) && /Fixed/.test(termType), `term type ${termType}`);
      return `Added Contract type ${q(nda)}; Edit > Form opened ${new URL(S.ndaFormUrl).pathname}. The Form header reads ${q(header)}. Rows in order: ${q(rows)}. Title reads ${q(title)} (Required for creation on and locked); Term type reads ${q(termType)}.`;
    });

  await step(SC, role,
    "Attach Fields, step 2: Attach Field lists the module's Fields alphabetically; Search fields filters; choose one",
    "The menu opens with a Search fields box; typing filters the list; choosing a Field adds its Row with Touchpoint Record.",
    async () => {
      // A Contract Text Field for this run, created in the catalog as a fixture.
      const f = await api(admin, "POST", "/api/v1/fields", { displayName: tier, moduleScope: "contract", fieldType: "text" });
      expectThat(f.status < 300, `field fixture ${f.status} ${q(f.body)}`);
      record("contract field", tier);
      await admin.goto(S.ndaFormUrl);
      await admin.getByRole("button", { name: "Attach Field" }).click();
      const menu = admin.getByRole("menu");
      await menu.waitFor();
      const search = menu.getByRole("textbox", { name: "Search fields" });
      const focused = await search.evaluate((e) => e === document.activeElement);
      const all = (await menu.locator('[data-field-option]').allInnerTexts()).map((t) => flat(t.split("\n")[0]));
      const sorted = [...all].sort((a, b) => a.localeCompare(b));
      await search.fill("Supplier tier form");
      await pause(300);
      const filtered = (await menu.locator('[data-field-option]').allInnerTexts()).map(flat);
      const last = flat(await menu.getByRole("menuitem").last().innerText());
      await menu.getByRole("menuitem", { name: new RegExp(`^${escapeRe(tier)}`) }).click();
      await formRow(admin, tier).waitFor({ timeout: 15000 });
      const tp = await touchpoint(admin, tier);
      expectThat(q(all) === q(sorted), "list is not alphabetical");
      expectThat(filtered.length >= 1 && filtered.every((t) => t.includes("Supplier tier form")), `filtered ${q(filtered)}`);
      expectThat(tp === "Record", `touchpoint ${tp}`);
      return `Attach Field opened a menu with the Search fields box focused (${focused}), ${all.length} Contract Fields in alphabetical order, and ${q(last)} last. Typing "Supplier tier form" left ${q(filtered)}. Choosing it added the Row ${q(tier)} with Touchpoint ${tp}.`;
    });

  await step(SC, role,
    "Attach Fields, step 2: Create Field opens a new Field definition without leaving the Form and attaches it",
    "The Add field dialog opens over the Form; after Add field the new Row is on the Form.",
    async () => {
      await admin.getByRole("button", { name: "Create Field", exact: true }).click();
      const d = admin.getByRole("dialog", { name: "Add field" });
      await d.waitFor();
      await d.getByLabel("Name").fill(owner);
      await d.getByLabel("Type").selectOption({ label: "User" });
      await d.getByRole("button", { name: "Add field" }).click();
      await d.waitFor({ state: "hidden", timeout: 15000 });
      await formRow(admin, owner).waitFor({ timeout: 15000 });
      record("contract field", owner);
      return `Create Field opened the "Add field" dialog while ${new URL(admin.url()).pathname} stayed open. The User Field ${q(owner)} was created and its Row attached (reads ${q(flat(await formRow(admin, owner).innerText()))}).`;
    });

  await step(SC, role,
    "Attach Fields, step 3 and the switch table: each change saves (Saved); On intake form also turns on Visible on Portal and locks it; Touchpoint follows the switches; a User Row on intake cannot be required",
    "Touchpoint reads Intake, Creation or Record as the switches change; Visible on Portal is on and locked while On intake form is on; the User Row's Required switch refuses with a reason; changes survive reload.",
    async () => {
      const log = [];
      let saved = await flip(admin, tier, "On intake form");
      let vis = await switchState(admin, tier, "Visible on Portal");
      log.push(`On intake form on: Saved ${saved}, Visible on Portal checked ${vis.checked} locked ${vis.locked}, Touchpoint ${await touchpoint(admin, tier)}`);
      expectThat(vis.checked && vis.locked && (await touchpoint(admin, tier)) === "Intake", log.at(-1));
      const reason = flat(await admin.locator(`[id^="reason-"][id$="-visibleOnPortal"]`).first().textContent().catch(() => ""));
      saved = await flip(admin, tier, "Required for creation");
      log.push(`Required for creation on: Saved ${saved}, Touchpoint ${await touchpoint(admin, tier)}`);
      saved = await flip(admin, tier, "On intake form");
      vis = await switchState(admin, tier, "Visible on Portal");
      const creation = await touchpoint(admin, tier);
      log.push(`On intake form off: Saved ${saved}, Visible on Portal checked ${vis.checked} locked ${vis.locked}, Touchpoint ${creation}`);
      expectThat(creation === "Creation" && !vis.locked, log.at(-1));
      // The User Row on intake.
      await flip(admin, owner, "On intake form");
      const req = await switchState(admin, owner, "Required for creation");
      const userReason = flat(await formRow(admin, owner).locator(`[id$="-isRequired"].sr-only, [id^="reason-"][id$="-isRequired"]`).first().textContent().catch(() => ""));
      await admin.getByRole("switch", { name: `${owner}: Required for creation`, exact: true }).click({ force: true });
      await pause(800);
      const reqAfter = await switchState(admin, owner, "Required for creation");
      expectThat(req.locked && !reqAfter.checked, `user required locked ${req.locked}, after click ${reqAfter.checked}`);
      await flip(admin, owner, "On intake form");
      await admin.reload();
      await formRow(admin, tier).waitFor();
      const persisted = { intake: (await switchState(admin, tier, "On intake form")).checked, required: (await switchState(admin, tier, "Required for creation")).checked, tp: await touchpoint(admin, tier) };
      expectThat(!persisted.intake && persisted.required && persisted.tp === "Creation", `after reload ${q(persisted)}`);
      return `${log.join(". ")}. The locked Visible on Portal switch reads ${q(reason)}. With On intake form on for the User Row ${q(owner)}, its Required for creation switch is locked with ${q(userReason)} and a click left it off. After reload ${q(tier)} reads On intake form off, Required for creation on, Touchpoint ${persisted.tp}.`;
    });

  await step(SC, role,
    "Attach Fields, step 4: focus a Row's move handle and use the arrow keys; Title and Type stay pinned",
    "The Row moves up one place and keeps it after reload; Title and Type keep the first two places.",
    async () => {
      const order = async () => admin.getByRole("region", { name: "Form" }).getByRole("group").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
      const before = await order();
      await admin.getByRole("button", { name: `Move ${tier}`, exact: true }).focus();
      await admin.keyboard.press("ArrowUp");
      await until(async () => (await order()).indexOf(tier) === before.indexOf(tier) - 1, "Row did not move");
      await pause(1500);
      await admin.reload();
      await formRow(admin, tier).waitFor();
      const after = await order();
      expectThat(after.indexOf(tier) === before.indexOf(tier) - 1, `order after reload ${q(after)}`);
      // Try to move the Row above Type.
      for (let i = 0; i < after.indexOf(tier); i++) {
        await admin.getByRole("button", { name: `Move ${tier}`, exact: true }).focus();
        await admin.keyboard.press("ArrowUp");
        await pause(700);
      }
      const top = await order();
      expectThat(top[0] === "Title" && top[1] === "Type", `top ${q(top.slice(0, 3))}`);
      return `ArrowUp on "Move ${tier}" moved it from place ${before.indexOf(tier) + 1} to ${after.indexOf(tier) + 1}, kept after reload. Further ArrowUp presses stopped it at place ${top.indexOf(tier) + 1}; Title and Type stay first and second.`;
    });

  await step(SC, role,
    "Add conditional Rows with a Branch, steps 1-3: On intake form for Term type and Expiry date, Required for creation for Expiry date; Add condition in the Form header; Row Term type, Operator is, Value Fixed; grip Move Expiry date > Put under a condition… > Show when all of: Term type is Fixed",
    "The new Branch appears at the end of the Form below Term type; the completed condition saves; Expiry date moves under the Branch.",
    async () => {
      await flip(admin, "Term type", "On intake form");
      await flip(admin, "Expiry date", "On intake form");
      await flip(admin, "Expiry date", "Required for creation");
      const region = admin.getByRole("region", { name: "Form" });
      await region.locator("header").getByRole("button", { name: "Add condition" }).click();
      const editor = admin.getByRole("group", { name: "Branch conditions" });
      await editor.waitFor();
      const lastGroups = await region.getByRole("group").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
      const rowSel = editor.locator("select").nth(0);
      const opSel = editor.locator("select").nth(1);
      const rowChoices = (await rowSel.locator("option").allInnerTexts()).map(flat);
      await rowSel.selectOption({ label: "Term type" });
      const ops = (await opSel.locator("option").allInnerTexts()).map(flat);
      await opSel.selectOption({ label: "is" });
      const valueChoices = (await editor.getByRole("combobox", { name: "Value", exact: true }).locator("option").allInnerTexts()).map(flat);
      await editor.getByRole("combobox", { name: "Value", exact: true }).selectOption({ label: "Fixed" });
      const branchName = "Show when all of: Term type is Fixed";
      await region.getByText(branchName).first().waitFor({ timeout: 15000 });
      const saved = await until(async () => (await region.getByText("Saved", { exact: true }).count()) > 0, "no Saved").catch(() => false);
      await pause(800);
      const branchChildrenBefore = lastGroups.at(-1);
      await admin.getByRole("button", { name: "Move Expiry date", exact: true }).click();
      await admin.getByRole("menuitem", { name: "Put under a condition…" }).click();
      const dlg = admin.getByRole("dialog", { name: "Put under a condition" });
      await dlg.getByRole("button", { name: branchName }).click();
      const children = region.getByRole("group", { name: `Children of ${branchName}` });
      await children.getByRole("group", { name: "Expiry date", exact: true }).waitFor({ timeout: 15000 });
      await pause(1500);
      await admin.reload();
      await admin.getByRole("group", { name: `Children of ${branchName}` }).getByRole("group", { name: "Expiry date", exact: true }).waitFor({ timeout: 15000 });
      const all = await region.getByRole("group").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
      const termIdx = all.indexOf("Term type");
      const branchIdx = all.indexOf(`Children of ${branchName}`);
      expectThat(branchIdx > termIdx && branchIdx === all.length - 2, `order ${q(all)}`);
      return `On intake form was turned on for Term type and Expiry date and Required for creation for Expiry date. Add condition in the Form header opened a condition editor at the end of the Form (last group before it: ${q(branchChildrenBefore)}). Row offered ${q(rowChoices)}; Operator offered ${q(ops)}; Value offered ${q(valueChoices)}. After Term type / is / Fixed the Branch header read ${q(branchName)} (Saved seen ${!!saved}). The grip "Move Expiry date" offered Put under a condition…, and the dialog "Put under a condition" offered ${q(branchName)}. Expiry date now sits in "Children of ${branchName}", which is after Term type and last on the Form, after reload.`;
    });

  await step(SC, role,
    "Branch, step 4: Preview intake form; Fixed shows Expiry date as required, Evergreen hides it; Submit request tests validation without sending",
    "The preview reads Preview only. No Request will be sent.; Expiry date appears only for Fixed; Submit request without it is refused and sends nothing.",
    async () => {
      await admin.getByRole("region", { name: "Form" }).locator("header").getByRole("button", { name: "Preview intake form" }).click();
      const d = admin.getByRole("dialog", { name: "Preview intake form" });
      await d.waitFor();
      const intro = flat(await d.getByText(/Preview only/).first().innerText());
      const term = d.getByLabel(/^Term type/);
      const termOptions = (await term.locator("option").allInnerTexts()).map(flat);
      await term.selectOption({ label: "Fixed" });
      await pause(400);
      const expiryFixed = await d.getByText(/^Expiry date/).count();
      const expiryLabel = expiryFixed ? flat(await d.getByText(/^Expiry date/).first().innerText()) : null;
      await d.getByLabel(/^Title/).first().fill("Preview only");
      await d.getByRole("button", { name: "Submit request" }).click();
      await pause(800);
      const dialogText = await d.innerText();
      const refusal = flat([...(await d.getByRole("alert").allInnerTexts()), ...dialogText.split("\n").filter((l) => /^Fill |required|Choose |Enter /i.test(l.trim()))].join(" | "));
      const invalid = await d.locator('[aria-invalid="true"]').count();
      const done = await d.getByText("Preview complete. No Request was sent").count();
      await term.selectOption({ label: "Evergreen" });
      await pause(400);
      const expiryEvergreen = await d.getByText(/^Expiry date/).count();
      await admin.screenshot({ path: path.join(SHOTS, "v-c38-preview-intake-form.png") });
      await d.getByRole("button", { name: "Close" }).last().click();
      await d.waitFor({ state: "hidden" });
      expectThat(/Preview only\. No Request will be sent\./.test(intro), `intro ${intro}`);
      expectThat(expiryFixed > 0 && expiryEvergreen === 0, `expiry fixed ${expiryFixed}, evergreen ${expiryEvergreen}`);
      expectThat(done === 0 && refusal, `submit ${done} refusal ${refusal}`);
      return `Preview intake form opened a dialog reading ${q(intro)}. Term type offered ${q(termOptions)}. With Fixed, Expiry date appeared (${q(expiryLabel)}); Submit request with Expiry date empty showed ${q(refusal)} (${invalid} controls marked invalid) and no completion message. With Evergreen, Expiry date disappeared. Close returned to the Form. Screenshot v-c38-preview-intake-form.png.`;
    });

  await step(SC, role,
    "Branch rules: Add another condition asks AND or OR once and Join conditions changes it; a second Branch cannot start until the first is finished; Escape discards a new condition",
    "The join question offers AND and OR; the Join conditions control appears; Add condition is refused while a Branch is unfinished; Escape removes the draft.",
    async () => {
      const region = admin.getByRole("region", { name: "Form" });
      const branchName = "Show when all of: Term type is Fixed";
      await region.getByRole("button", { name: "Edit conditions" }).first().click();
      const editor = admin.getByRole("group", { name: "Branch conditions" });
      await editor.getByRole("button", { name: "Add another condition" }).click();
      const ask = editor.getByRole("group", { name: "Join the next condition with" });
      const askButtons = (await ask.getByRole("button").allInnerTexts()).map(flat);
      await ask.getByRole("button", { name: "OR", exact: true }).click();
      const join = editor.getByRole("combobox", { name: "Join conditions" });
      const joinValue = await join.evaluate((e) => e.selectedOptions[0].textContent);
      await join.selectOption({ label: "AND" });
      await editor.getByRole("button", { name: "Remove condition 2" }).click();
      await pause(800);
      await region.getByRole("button", { name: "Edit conditions" }).first().click().catch(() => {});
      // A new, unfinished Branch blocks a second one.
      await region.locator("header").getByRole("button", { name: "Add condition" }).click();
      await admin.getByRole("group", { name: "Branch conditions" }).waitFor();
      const addAgain = region.locator("header").getByRole("button", { name: "Add condition" });
      const blocked = await addAgain.getAttribute("aria-disabled");
      await admin.getByRole("group", { name: "Branch conditions" }).locator("select").first().focus();
      await admin.keyboard.press("Escape");
      await pause(600);
      const drafts = await admin.getByRole("group", { name: "Branch conditions" }).count();
      const branches = await region.getByRole("group", { name: /^Children of / }).count();
      expectThat(q(askButtons) === q(["AND", "OR", "Cancel"]) && joinValue === "OR", `ask ${q(askButtons)} join ${joinValue}`);
      expectThat(blocked === "true" && drafts === 0 && branches === 1, `blocked ${blocked}, drafts ${drafts}, branches ${branches}`);
      return `Edit conditions > Add another condition asked "Join the next condition with" offering ${q(askButtons)}; after OR, the Join conditions control read ${q(joinValue)} and was changed to AND; Remove condition 2 removed the second condition. A new Add condition opened an unfinished Branch; the header's Add condition then carried aria-disabled=${blocked} ("Complete the Branch condition first"). Escape discarded the draft (${drafts} editors, ${branches} Branch left).`;
    });

  await step(SC, role,
    "New and existing records follow the Form: a new Contract of this type needs the Required for creation Row; Rows under a false Branch are not collected or required; the record holds the value",
    "Create is refused while the required Field is empty; Expiry date is asked only for Fixed; Create succeeds with Evergreen and a value; the Contract shows the value.",
    async () => {
      await admin.goto(`${BASE}/contracts`);
      await admin.getByRole("button", { name: /New contract|Create contract/ }).first().click();
      const d = admin.getByRole("dialog", { name: "Create contract" });
      const title = name(SC, "Supplier NDA");
      await d.getByRole("textbox", { name: "Title" }).fill(title);
      await d.getByRole("combobox", { name: "Contract type" }).selectOption({ label: nda });
      await pause(1000);
      const labels = (await d.locator("label").allInnerTexts()).map(flat).filter(Boolean);
      await d.getByRole("button", { name: "Create" }).click();
      await pause(1500);
      const stillOpen = await d.isVisible();
      const alerts = flat((await d.getByRole("alert").allInnerTexts().catch(() => [])).join(" | "));
      expectThat(stillOpen, "created without the required Field");
      await d.getByRole("textbox", { name: new RegExp(`^${escapeRe(tier)}`) }).fill("Tier 2");
      const termType = d.getByLabel(/^Term type/).first();
      const termOptions = (await termType.locator("option").allInnerTexts().catch(() => [])).map(flat);
      await termType.selectOption({ label: "Fixed" });
      await pause(500);
      const labelsFixed = (await d.locator("label").allInnerTexts()).map(flat).filter((l) => /^Expiry date/.test(l));
      await termType.selectOption({ label: "Evergreen" });
      await pause(500);
      const labelsEvergreen = (await d.locator("label").allInnerTexts()).map(flat).filter((l) => /^Expiry date/.test(l));
      expectThat(labelsFixed.length === 1 && labelsEvergreen.length === 0, `Expiry with Fixed ${q(labelsFixed)}, with Evergreen ${q(labelsEvergreen)}`);
      const expiryNote = `Term type offered ${q(termOptions)}; with Fixed the dialog showed ${q(labelsFixed)}, with Evergreen no Expiry date control`;
      await d.getByRole("button", { name: "Create" }).click();
      await pause(1500);
      if (await d.isVisible()) {
        const more = flat((await d.getByRole("alert").allInnerTexts()).join(" | "));
        throw new Error(`still open after Tier 2: ${more}; labels ${q(labels)}`);
      }
      await admin.waitForURL(/\/contracts\/\d+/, { timeout: 20000 });
      S.ndaContract = admin.url().match(/\/contracts\/(\d+)/)[1];
      record("contract", title, { number: S.ndaContract });
      await admin.getByRole("navigation", { name: "Contract sections" }).getByRole("link", { name: "Fields" }).click();
      await admin.locator("main").getByRole("textbox", { name: new RegExp(`^${escapeRe(tier)}`) }).waitFor({ timeout: 15000 });
      const shown = await admin.locator("main").getByRole("textbox", { name: new RegExp(`^${escapeRe(tier)}`) }).inputValue().catch(() => null);
      expectThat(shown === "Tier 2", `record shows ${q(shown)} for the Field`);
      return `Contracts > Create contract with type ${q(nda)} showed ${q(labels)}. Create with ${q(tier)} empty kept the dialog open with ${q(alerts)}. With "Tier 2" filled, ${expiryNote}; Create with Evergreen opened C-${S.ndaContract}, whose Fields tab shows ${q(tier)} = ${q(shown)}.`;
    });

  await step(SC, role,
    "Branch rules: Remove condition keeps its children",
    "After Remove condition the Branch is gone and Expiry date stays on the Form at the root with its switches.",
    async () => {
      await admin.goto(S.ndaFormUrl);
      const region = admin.getByRole("region", { name: "Form" });
      const branchName = "Show when all of: Term type is Fixed";
      await region.getByRole("button", { name: `Actions for ${branchName}` }).click();
      await admin.getByRole("menuitem", { name: "Remove condition" }).click();
      await until(async () => (await region.getByRole("group", { name: /^Children of / }).count()) === 0, "Branch not removed");
      await pause(1200);
      await admin.reload();
      await formRow(admin, "Expiry date").waitFor();
      const all = await region.getByRole("group").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
      const req = await switchState(admin, "Expiry date", "Required for creation");
      expectThat(all.includes("Expiry date") && req.checked, `rows ${q(all)}`);
      return `Actions for ${q(branchName)} > Remove condition removed the Branch; after reload Expiry date is on the Form at the root (${all.indexOf("Expiry date") + 1} of ${all.length} groups) with Required for creation ${req.checked ? "on" : "off"}.`;
    });

  await step(SC, role,
    "Archive in the Field catalog hides the Field and keeps attachments and stored values; Show archived > Restore brings them back; Detach removes a Row and keeps the Field",
    "The archive dialog says the attachment is kept; the Form no longer shows the Row; after Restore the Row and the record's value return; Detach removes the User Row and the Field stays in the catalog.",
    async () => {
      await openSettings(admin, A, "Contracts");
      await pane(admin, "Contracts panes", "Fields");
      await admin.getByRole("button", { name: `Archive ${tier}`, exact: true }).click();
      const d = admin.getByRole("dialog");
      const text = flat(await d.innerText());
      const reassign = await d.getByRole("combobox").count();
      const shownCount = Number((text.match(/attached to (\d+) types?/) ?? [0, 0])[1]);
      if (shownCount !== 1) {
        results.productBugs.push({
          section,
          scenario: SC,
          title: "The Field archive dialog counts records holding a value as attached types",
          reproduction: `Attach a new Contract Field to one Contract type's Form only, create one Contract that holds a value for it, then open Archive on the Field in Settings > Contracts > Fields. The dialog read ${q(text)}.`,
          expected: "attached to 1 type (only one type's Form holds the Field)",
          observed: `attached to ${shownCount} types`,
          source: "apps/api/src/modules/fields/routes.ts attachmentCounts adds type attachments and records holding the slug; settings.contractFields.archiveWarning calls the sum types",
        });
      }
      await d.getByRole("button", { name: "Archive field" }).click();
      await d.waitFor({ state: "hidden" });
      await admin.goto(S.ndaFormUrl);
      await formRow(admin, "Title").waitFor();
      const rowWhileArchived = await formRow(admin, tier).count();
      const recWhileArchived = (await api(admin, "GET", `/api/v1/contracts/${S.ndaContract}`)).body;
      const storedWhileArchived = JSON.stringify(recWhileArchived?.contract?.customFields ?? recWhileArchived?.customFields ?? {}).includes("Tier 2");
      await admin.goto(`${BASE}/contracts/${S.ndaContract}`);
      await pause(1500);
      await admin.locator("main").getByRole("textbox").first().waitFor();
      const pageWhileArchived = await admin.locator("main").getByRole("textbox", { name: new RegExp(`^${escapeRe(tier)}`) }).inputValue().catch(() => "(no control)");
      await openSettings(admin, A, "Contracts");
      await pane(admin, "Contracts panes", "Fields");
      await admin.getByRole("button", { name: "Rename Governing law", exact: true }).waitFor();
      const showArchived = admin.getByRole("switch", { name: "Show archived" });
      await showArchived.click();
      await until(async () => (await showArchived.getAttribute("aria-checked")) === "true", "Show archived did not turn on");
      await admin.getByRole("button", { name: `Restore ${tier}`, exact: true }).click();
      await admin.getByRole("button", { name: `Archive ${tier}`, exact: true }).waitFor({ timeout: 15000 });
      await admin.goto(S.ndaFormUrl);
      await formRow(admin, tier).waitFor({ timeout: 15000 });
      const restoredReq = await switchState(admin, tier, "Required for creation");
      await admin.getByRole("button", { name: `Detach ${owner}`, exact: true }).click();
      await until(async () => (await formRow(admin, owner).count()) === 0, "User Row not detached");
      await pause(1000);
      await admin.goto(`${BASE}/contracts/${S.ndaContract}/fields`);
      await admin.locator("main").getByRole("textbox", { name: new RegExp(`^${escapeRe(tier)}`) }).waitFor({ timeout: 15000 });
      const pageRestored = await admin.locator("main").getByRole("textbox", { name: new RegExp(`^${escapeRe(tier)}`) }).inputValue().catch(() => "(no control)");
      expectThat(pageRestored === "Tier 2", `restored record shows ${q(pageRestored)}`);
      const catalog = ((await api(admin, "GET", "/api/v1/fields")).body?.fields ?? []).find((f) => f.displayName === owner);
      expectThat(reassign === 0 && /attachments? (is|are) kept/.test(text), `archive dialog ${text}`);
      expectThat(rowWhileArchived === 0 && restoredReq.checked, `row while archived ${rowWhileArchived}, restored required ${restoredReq.checked}`);
      expectThat(catalog && !catalog.archivedAt, "detached Field left the catalog");
      return `Archive ${q(tier)} read ${q(text)} with ${reassign} reassignment controls. While archived, the Form showed ${rowWhileArchived} Rows for it; the API still held the stored value (${storedWhileArchived}); the Contract's Fields tab control for it read ${q(pageWhileArchived)}. Show archived > Restore returned the Row with Required for creation ${restoredReq.checked ? "on" : "off"}, and C-${S.ndaContract}'s Fields tab reads ${q(pageRestored)} again. "Detach ${owner}" removed the User Row; the Field stays live in the catalog.`;
    });

  await step(SC, role,
    "Entity Forms show only Required for creation, with no On intake form or Visible on Portal switch and no intake preview",
    "An Entity type's Form has only Required for creation switches and no Preview intake form button.",
    async () => {
      await openSettings(admin, A, "Entities");
      await pane(admin, "Entities panes", "Types");
      const et = name(SC, "Entity form type");
      await addListRow(admin, "Add type", "New type name", et);
      record("entity type", et);
      await admin.getByRole("button", { name: `Edit ${et}`, exact: true }).click();
      await admin.getByRole("navigation", { name: "Type sections" }).getByRole("link", { name: "Form" }).click();
      const region = admin.getByRole("region", { name: "Form" });
      await region.waitFor();
      await region.getByRole("button", { name: "Attach Field" }).click();
      const menu = admin.getByRole("menu");
      await menu.locator("[data-field-option]").first().click();
      await region.getByRole("switch").first().waitFor({ timeout: 15000 });
      await pause(800);
      const header = flat(await region.locator("header").innerText());
      const switches = await region.getByRole("switch").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
      const preview = await region.getByRole("button", { name: "Preview intake form" }).count();
      const addCond = await region.getByRole("button", { name: "Add condition" }).count();
      expectThat(preview === 0 && switches.length > 0 && switches.every((s) => /: Required for creation$/.test(s)), `switches ${q(switches)}, preview ${preview}`);
      return `Entity type ${q(et)} (one Entity Field attached through Attach Field) Form header reads ${q(header)}; its ${switches.length} switches are all "<Row>: Required for creation" (${q(switches.slice(0, 3))}); Preview intake form buttons ${preview}; Add condition buttons ${addCond}.`;
    });
}

// =====================================================================
// V-C38 types-statuses-fields: Officer roles
// =====================================================================
async function officersSection(admin) {
  const SC = "V-C38";
  const role = "administrator";
  const A = PEOPLE.administrator;
  currentPage = admin;
  const roleName = name(SC, "Board observer");
  const renamed = name(SC, "Board observer renamed");
  const replacement = name(SC, "Board adviser");

  await step(SC, role,
    "Maintain Officer roles: Entities > Director & Officer roles; Add role, Rename, reorder",
    "The new role row appears; Rename and keyboard reorder persist; Other is protected.",
    async () => {
      await openSettings(admin, A, "Entities");
      await pane(admin, "Entities panes", "Director & Officer roles");
      await admin.getByRole("heading", { name: "Director & Officer roles" }).first().waitFor();
      await addListRow(admin, "Add role", "New role name", roleName);
      await addListRow(admin, "Add role", "New role name", replacement);
      record("officer role", roleName);
      record("officer role", replacement);
      await renameRow(admin, roleName, renamed);
      const { before, after } = await moveUp(admin, renamed);
      const other = await admin.getByRole("img", { name: "Other is system-protected and can't be archived" }).count();
      expectThat(other === 1, "Other lock missing");
      return `Entities > Director & Officer roles: Add role added ${q(roleName)} and ${q(replacement)}; Rename changed the first to ${q(renamed)}; ArrowUp moved it from ${before} to ${after}, kept after reload. Other shows "Other is system-protected and can't be archived".`;
    });

  await step(SC, role,
    "Archive an in-use role: usage counts current and resigned Officers; select the replacement and confirm Archive role; Restore does not reverse the reassignment",
    "The dialog counts both Officers; after Archive role both move to the replacement; Restore makes the role selectable and leaves them on the replacement.",
    async () => {
      const roles = (await api(admin, "GET", "/api/v1/officer-roles")).body;
      const list = roles?.officerRoles ?? roles?.roles ?? roles ?? [];
      const r = list.find((x) => x.displayName === renamed);
      const repl = list.find((x) => x.displayName === replacement);
      const entities = (await api(admin, "GET", "/api/v1/entities")).body?.entities ?? [];
      const mine = entities.find((e) => /DOC-030 admin-config/.test(e.legalName)) ?? null;
      let entityId = mine?.id;
      if (!entityId) {
        const types = (await api(admin, "GET", "/api/v1/entity-types")).body;
        const et = (types?.entityTypes ?? types ?? [])[0];
        const e = await api(admin, "POST", "/api/v1/entities", { legalName: name(SC, "Officer test Ltd"), entityTypeId: et.id });
        entityId = e.body?.entity?.id ?? e.body?.id;
        expectThat(entityId, `entity fixture ${e.status} ${q(e.body)}`);
        record("entity", name(SC, "Officer test Ltd"));
      }
      const o1 = await api(admin, "POST", `/api/v1/entities/${entityId}/officers`, { name: `Imani Fictional ${stamp}`, officerRoleId: r.id, appointedOn: "2024-01-15" });
      const o2 = await api(admin, "POST", `/api/v1/entities/${entityId}/officers`, { name: `Tomas Fictional ${stamp}`, officerRoleId: r.id, appointedOn: "2023-03-01", resignedOn: "2025-06-30" });
      expectThat(o1.status < 300 && o2.status < 300, `officer fixtures ${o1.status} ${o2.status} ${q(o2.body)}`);
      await admin.reload();
      const usage = flat(await row(admin, renamed).innerText());
      await admin.getByRole("button", { name: `Archive ${renamed}`, exact: true }).click();
      const d = admin.getByRole("dialog");
      const text = flat(await d.innerText());
      await d.getByRole("combobox").selectOption({ label: replacement });
      await d.getByRole("button", { name: "Archive role" }).click();
      await d.waitFor({ state: "hidden", timeout: 15000 });
      const officers = (await api(admin, "GET", `/api/v1/entities/${entityId}/officers?includeFormer=true`)).body;
      const olist = officers?.officers ?? officers ?? [];
      const moved = olist.filter((o) => [`Imani Fictional ${stamp}`, `Tomas Fictional ${stamp}`].includes(o.name)).map((o) => `${o.name}: ${o.officerRoleName ?? o.roleName ?? o.officerRole?.displayName ?? o.officerRoleId}`);
      await admin.getByRole("switch", { name: "Show archived" }).click();
      await admin.getByRole("button", { name: `Restore ${renamed}`, exact: true }).click();
      await admin.getByRole("button", { name: `Archive ${renamed}`, exact: true }).waitFor({ timeout: 15000 });
      const after = ((await api(admin, "GET", `/api/v1/entities/${entityId}/officers?includeFormer=true`)).body?.officers ?? []).filter((o) => o.officerRoleId === r.id).length;
      expectThat(/2 officers/.test(text) && moved.length === 2 && moved.every((m) => m.includes(replacement) || m.includes(repl.id)), `text ${text}; moved ${q(moved)}`);
      expectThat(after === 0, `${after} officers moved back`);
      return `Two fictional Officers (one current, one resigned 2025-06-30) were given ${q(renamed)} through the API. Its row read ${q(usage)}; the Archive dialog read ${q(text)}. After choosing ${q(replacement)} and Archive role, the Officers read ${q(moved)}. Show archived > Restore made ${q(renamed)} live again; ${after} Officers moved back.`;
    });
}

// =====================================================================
// V-C38 negative: non-Administrators cannot edit configuration
// =====================================================================
async function accessSection(browser, contexts) {
  const SC = "V-C38";
  // Ravi Menon, the seed's Contributor, holds the Business User role on this shared lab at the
  // time of the walk, so the Business User check runs in the forms section with Jonas Weber.
  for (const [key, person] of [["legal_team_member", PEOPLE.legal_team_member]]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    contexts.push(ctx);
    const page = await ctx.newPage();
    currentPage = page;
    await step(SC, "administrator",
      `Negative check: a ${key.replace(/_/g, " ")} (${person.name}) cannot open or change type, Status or Field configuration`,
      "The Settings rail has no Organization configuration; the configuration URLs do not show the editors; the API refuses a change.",
      async () => {
        await browserSignIn(page, person);
        await page.goto(`${BASE}/`);
        await page.getByRole("banner").getByRole("button", { name: person.name }).click();
        await page.getByRole("menuitem", { name: "Settings" }).click();
        await page.waitForURL(/\/settings/);
        await page.waitForLoadState("networkidle").catch(() => {});
        const rail = page.getByRole("navigation", { name: "Settings sections" });
        const groups = await rail.getByRole("group").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? e.querySelector("h2")?.textContent));
        const out = [];
        for (const u of ["/settings/contracts/types", "/settings/matters/statuses", "/settings/contracts/fields", "/settings/entities/officer-roles"]) {
          await page.goto(`${BASE}${u}`);
          await page.waitForLoadState("networkidle").catch(() => {});
          await pause(800);
          const add = await page.getByRole("button", { name: /^(Add type|Add status|Add field|Add role)$/ }).count();
          const heading = flat(await page.locator("main h2, main h1").first().innerText().catch(() => ""));
          out.push(`${u} -> ${new URL(page.url()).pathname} (${q(heading)}, add controls ${add})`);
          expectThat(add === 0, `${u} shows an add control`);
        }
        const types = (await api(page, "GET", "/api/v1/contract-types")).body?.contractTypes ?? [];
        const target = types[0]?.id ?? "00000000-0000-0000-0000-000000000000";
        const patch = await api(page, "POST", "/api/v1/contract-types", { displayName: name(SC, "Refused type") });
        expectThat(patch.status === 403, `API create answered ${patch.status}`);
        return `${person.name} opened Settings from the profile menu; the rail groups are ${q(groups)}. ${out.join("; ")}. POST /api/v1/contract-types answered ${patch.status} ${q(patch.body?.detail ?? patch.body?.title)}.`;
      });
  }
}

// =====================================================================
// V-C40 request-forms
// =====================================================================
async function portalCard(page, label) {
  await page.goto(`${BASE}/portal`);
  const list = page.getByRole("list", { name: "Request types" });
  await list.waitFor({ timeout: 20000 });
  const link = list.getByRole("link", { name: new RegExp(escapeRe(label)) });
  return { list, link };
}
async function submittedNumber(page, since) {
  const r = (await api(page, "GET", "/api/v1/portal/requests")).body;
  const list = r?.requests ?? r ?? [];
  const mine = list.filter((x) => new Date(x.createdAt ?? x.submittedAt ?? 0).getTime() >= since - 5000);
  return (mine[0] ?? list[0])?.number;
}

async function formsSection(admin, browser, contexts) {
  const SC = "V-C40";
  const role = "administrator";
  const A = PEOPLE.administrator;
  const F = {
    msa: name(SC, "MSA"),
    advisory: name(SC, "Advisory"),
    gone: name(SC, "Retired destination"),
    dealValue: name(SC, "Deal value"),
    matterScope: name(SC, "Advice area"),
    contractForm: name(SC, "Docs Contract review"),
    matterForm: name(SC, "Docs Matter advice"),
    goneForm: name(SC, "Docs retired destination form"),
    extLabel: name(SC, "Supplier checklist"),
    kiLabel: name(SC, "How to ask Legal"),
  };
  S.F = F;
  currentPage = admin;

  // Fixtures through the API: destination types, catalog Fields and their Forms.
  await step(SC, role,
    "Before you start (fixture): live destination Contract and Matter types whose Forms hold the Rows to collect",
    "Two destination types exist with intake Rows; a third Contract type exists for the archived-destination check.",
    async () => {
      const ct = async (displayName) => {
        const r = await api(admin, "POST", "/api/v1/contract-types", { displayName });
        expectThat(r.status < 300, `contract type ${r.status} ${q(r.body)}`);
        return r.body?.contractType?.id ?? r.body?.id;
      };
      S.msaId = await ct(F.msa);
      S.goneId = await ct(F.gone);
      const mt = await api(admin, "POST", "/api/v1/matter-types", { displayName: F.advisory });
      S.advisoryId = mt.body?.matterType?.id ?? mt.body?.id;
      expectThat(S.msaId && S.goneId && S.advisoryId, `ids ${S.msaId} ${S.goneId} ${S.advisoryId} ${q(mt.body)}`);
      const deal = await api(admin, "POST", "/api/v1/fields", { displayName: F.dealValue, moduleScope: "contract", fieldType: "number" });
      const scope = await api(admin, "POST", "/api/v1/fields", { displayName: F.matterScope, moduleScope: "matter", fieldType: "single_select", options: ["Employment", "Privacy", "Tax"] });
      expectThat(deal.status < 300 && scope.status < 300, `fields ${deal.status} ${q(deal.body)} ${scope.status} ${q(scope.body)}`);
      const dealF = deal.body?.field ?? deal.body;
      const scopeF = scope.body?.field ?? scope.body;
      S.dealSlug = dealF.slug;
      S.scopeSlug = scopeF.slug;
      const cf = (await api(admin, "GET", `/api/v1/contract-types/${S.msaId}/form`)).body?.form;
      expectThat(Array.isArray(cf), `contract form ${q(cf)}`);
      const expiry = { ...cf.find((n) => n.rowRef === "expiry_date"), onIntakeForm: true, isRequired: true, visibleOnPortal: true };
      const form = cf
        .filter((n) => n.rowRef !== "expiry_date")
        .map((n) => (["term_type", "value", "counterparties"].includes(n.rowRef) ? { ...n, onIntakeForm: true, visibleOnPortal: true } : n));
      const at = form.findIndex((n) => n.rowRef === "description") + 1;
      form.splice(at, 0, { kind: "row", id: dealF.id, rowRef: dealF.slug, fieldType: "number", onIntakeForm: true, isRequired: true, visibleOnPortal: true });
      form.push({ kind: "branch", id: crypto.randomUUID(), match: "all", conditions: [{ rowRef: "term_type", operator: "equals", value: "fixed" }], children: [expiry] });
      const put = await api(admin, "PUT", `/api/v1/contract-types/${S.msaId}/form`, { form });
      expectThat(put.status < 300, `contract form put ${put.status} ${q(put.body)}`);
      const mf = (await api(admin, "GET", `/api/v1/matter-types/${S.advisoryId}/form`)).body?.form;
      mf.push({ kind: "row", id: scopeF.id, rowRef: scopeF.slug, fieldType: "single_select", onIntakeForm: true, isRequired: true, visibleOnPortal: true });
      const mput = await api(admin, "PUT", `/api/v1/matter-types/${S.advisoryId}/form`, { form: mf });
      expectThat(mput.status < 300, `matter form put ${mput.status} ${q(mput.body)}`);
      for (const [k, v] of [["contract type", F.msa], ["contract type", F.gone], ["matter type", F.advisory], ["contract field", F.dealValue], ["matter field", F.matterScope]]) record(k, v);
      return `API fixtures as the Administrator: Contract types ${q(F.msa)} and ${q(F.gone)}; Matter type ${q(F.advisory)}; Contract Number Field ${q(F.dealValue)}; Matter Single select Field ${q(F.matterScope)} (Employment, Privacy, Tax). ${q(F.msa)}'s Form: ${q(F.dealValue)} after Description (On intake form, Required for creation); Term type, Value and Counterparties On intake form; a Branch "Term type is Fixed" at the end holding Expiry date (On intake form, Required for creation). ${q(F.advisory)}'s Form: ${q(F.matterScope)} On intake form and Required for creation.`;
    }, "fixture-setup");

  await step(SC, role,
    "Create the request type, steps 1-4: profile menu > Settings > Intake > Request types; Add request type (Cancel discards); Save; Edit; Description saves on leaving the field; a new type starts with a Matter destination",
    "Cancel leaves no row; Save adds the row; the editor opens with Default destination Matter and Default matter type Default; the Description survives reload.",
    async () => {
      await openSettings(admin, A, "Intake");
      await pane(admin, "Intake panes", "Request types");
      await admin.getByRole("heading", { name: "Request types" }).first().waitFor();
      const header = flat(await admin.locator("main").getByText("Destination", { exact: true }).first().innerText().catch(() => ""));
      await admin.getByRole("button", { name: "Add request type", exact: true }).click();
      await admin.getByRole("textbox", { name: "New request type name" }).fill(name(SC, "Cancelled request type"));
      await admin.getByRole("button", { name: "Cancel", exact: true }).click();
      for (const n of [F.contractForm, F.matterForm, F.goneForm]) {
        await addListRow(admin, "Add request type", "New request type name", n);
        record("request type", n);
      }
      const cancelled = await admin.getByRole("button", { name: `Rename ${name(SC, "Cancelled request type")}`, exact: true }).count();
      const newRow = flat(await row(admin, F.contractForm).innerText());
      await admin.getByRole("button", { name: `Edit ${F.contractForm}`, exact: true }).click();
      await admin.getByRole("textbox", { name: "Description" }).waitFor();
      S.contractFormUrl = admin.url();
      const dest = await admin.getByRole("combobox", { name: "Default destination" }).evaluate((e) => e.selectedOptions[0]?.textContent);
      const destType = await admin.getByRole("combobox", { name: "Default matter type" }).evaluate((e) => e.selectedOptions[0]?.textContent).catch(() => null);
      const desc = admin.getByRole("textbox", { name: "Description" });
      await desc.fill("Ask Legal to review a supplier contract. Fictional DOC-030 walkthrough form.");
      await desc.press("Tab");
      await pause(1500);
      await admin.reload();
      const saved = await admin.getByRole("textbox", { name: "Description" }).inputValue();
      expectThat(cancelled === 0 && dest === "Matter" && destType === "Default", `cancelled ${cancelled}, dest ${dest}, type ${destType}`);
      expectThat(/supplier contract/.test(saved), `description ${saved}`);
      return `Profile menu > Settings > Intake > Request types listed a Destination column (${q(header)}). Add request type + Cancel left no row; Save added ${q(F.contractForm)} (row ${q(newRow)}), ${q(F.matterForm)} and ${q(F.goneForm)}. Edit opened the editor with Default destination ${q(dest)} and Default matter type ${q(destType)}. The Description saved on Tab and read ${q(saved)} after reload.`;
    });

  await step(SC, role,
    "Set the default destination, steps 1-3: Contract; Default contract type lists Default first; pick the destination type; changing the module clears the type; the Intake form card follows",
    "Default contract type starts on Default, lists it first, and saves the chosen type; Matter then Contract resets it to Default; the card shows the destination Form; the list's Destination column reads Contract · type.",
    async () => {
      const dest = admin.getByRole("combobox", { name: "Default destination" });
      await dest.selectOption({ label: "Contract" });
      const typeSel = admin.getByRole("combobox", { name: "Default contract type" });
      await typeSel.waitFor();
      const first = flat(await typeSel.locator("option").first().innerText());
      const initial = await typeSel.evaluate((e) => e.selectedOptions[0]?.textContent);
      await typeSel.selectOption({ label: F.msa });
      await pause(1500);
      const card = admin.getByRole("region", { name: "Intake form" });
      await card.getByText(F.dealValue).waitFor({ timeout: 15000 });
      await dest.selectOption({ label: "Matter" });
      await pause(1200);
      const cleared = await admin.getByRole("combobox", { name: "Default matter type" }).evaluate((e) => e.selectedOptions[0]?.textContent);
      await dest.selectOption({ label: "Contract" });
      await pause(1200);
      const clearedBack = await admin.getByRole("combobox", { name: "Default contract type" }).evaluate((e) => e.selectedOptions[0]?.textContent);
      await admin.getByRole("combobox", { name: "Default contract type" }).selectOption({ label: F.msa });
      await pause(1500);
      await admin.reload();
      const after = await admin.getByRole("combobox", { name: "Default contract type" }).evaluate((e) => e.selectedOptions[0]?.textContent);
      await admin.getByRole("link", { name: "All request types" }).click();
      const listRow = flat(await row(admin, F.contractForm).innerText());
      expectThat(first === "Default" && initial === "Default" && after === F.msa, `first ${first}, initial ${initial}, after ${after}`);
      expectThat(cleared === "Default" && clearedBack === "Default", `cleared ${cleared} ${clearedBack}`);
      expectThat(listRow.includes(`Contract · ${F.msa}`), `list row ${listRow}`);
      return `Default destination Contract showed Default contract type ${q(initial)} with ${q(first)} as the first option; choosing ${q(F.msa)} refreshed the Intake form card to its Rows. Switching to Matter reset the type to ${q(cleared)}; back to Contract it read ${q(clearedBack)}. After choosing ${q(F.msa)} again and reloading it read ${q(after)}. The list row reads ${q(listRow)}.`;
    });

  await step(SC, role,
    "Publish an estimated turnaround: 0 to 36,500 or blank; save on leaving the control or Enter",
    "36501 is refused with the range message; 5 saves and survives reload.",
    async () => {
      await admin.goto(S.contractFormUrl);
      const t = admin.getByRole("spinbutton", { name: "Target turnaround (business days)" });
      await t.fill("36501");
      await t.press("Enter");
      await pause(1200);
      const refusal = flat(await admin.getByText(/Enter a whole number from 0 to 36,500/).first().innerText().catch(() => ""));
      await t.fill("5");
      await t.press("Tab");
      await pause(1500);
      await admin.reload();
      const saved = await admin.getByRole("spinbutton", { name: "Target turnaround (business days)" }).inputValue();
      expectThat(refusal && saved === "5", `refusal ${refusal}, saved ${saved}`);
      return `36501 + Enter showed ${q(refusal)}. 5 + Tab saved; after reload the control reads ${q(saved)}.`;
    });

  await step(SC, role,
    "Read and preview the Intake form: the read-only card lists Title, Department, Urgency, the Intake Rows with Branch headers, Attachments last, each Required or Optional; Preview intake form shows the name and description, follows the Branch, validates on Submit request and sends nothing; Escape returns to the eye button",
    "The card order and markers match the Form; the preview shows the Request type name and description; Expiry date shows only for Fixed; Submit request refuses missing answers; Escape closes and focus returns to the eye button.",
    async () => {
      const card = admin.getByRole("region", { name: "Intake form" });
      await card.getByRole("listitem").last().getByText("Attachments").waitFor({ timeout: 15000 });
      const items = (await card.getByRole("listitem").allInnerTexts()).map(flat);
      const controls = (await card.getByRole("textbox").count()) + (await card.getByRole("switch").count()) + (await card.getByRole("combobox").count());
      expectThat(/^Title/.test(items[0]) && /^Department/.test(items[1]) && /^Urgency/.test(items[2]) && /^Attachments/.test(items.at(-1)), `items ${q(items)}`);
      const cardText = flat(await card.innerText());
      await card.getByRole("button", { name: "Preview intake form" }).click();
      const d = admin.getByRole("dialog", { name: "Preview intake form" });
      await d.waitFor();
      const dText = flat(await d.innerText());
      const term = d.getByLabel(/^Term type/);
      await term.selectOption({ label: "Fixed" });
      await pause(300);
      const fixed = await d.getByText(/^Expiry date/).count();
      await term.selectOption({ label: "Evergreen" });
      await pause(300);
      const evergreen = await d.getByText(/^Expiry date/).count();
      await d.getByRole("button", { name: "Submit request" }).click();
      await pause(700);
      const refusal = flat((await d.innerText()).split("\n").filter((l) => /is required|^Fill /.test(l.trim())).join(" | "));
      await admin.keyboard.press("Escape");
      await d.waitFor({ state: "hidden" });
      const focus = await admin.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent);
      expectThat(controls === 0 && dText.includes(F.contractForm) && /supplier contract/.test(dText), `controls ${controls}; preview ${dText.slice(0, 200)}`);
      expectThat(fixed > 0 && evergreen === 0 && refusal, `fixed ${fixed} evergreen ${evergreen} refusal ${refusal}`);
      expectThat(/Preview intake form/.test(focus ?? ""), `focus ${focus}`);
      return `The Intake form card has no inputs (${controls}) and lists ${q(items)}; its text includes the Branch header (${/Term type is Fixed/.test(cardText) ? "Show when … Term type is Fixed present" : "no Branch header text"}). The eye button opened a preview naming ${q(F.contractForm)} with its description. Expiry date showed for Fixed and not for Evergreen. Submit request showed ${q(refusal)} and sent nothing. Escape closed it and focus returned to ${q(focus)}.`;
    });

  await step(SC, role,
    "Choose the Intake Rows, step 1: Edit form in the card header opens the destination type's Form tab",
    "Edit form opens the Form tab of the chosen Contract type.",
    async () => {
      await admin.getByRole("region", { name: "Intake form" }).getByRole("link", { name: "Edit form" }).click();
      await admin.waitForURL(/\/settings\/contracts\/types\/[^/]+\/form/, { timeout: 15000 });
      const heading = flat(await admin.getByRole("region", { name: "Form" }).locator("header").innerText());
      expectThat(admin.url().includes(S.msaId) && heading.includes(F.msa), `url ${admin.url()} header ${heading}`);
      const builtins = [];
      for (const b of ["Counterparties", "Effective date", "Expiry date", "Term type", "Value"]) builtins.push(`${b}: ${await formRow(admin, b).count() ? "present" : "absent"}`);
      const status = await formRow(admin, "Status").count();
      return `Edit form opened ${new URL(admin.url()).pathname} (Form header ${q(heading)}). Built-in Contract Rows: ${builtins.join(", ")}; Status Row ${status ? "present" : "absent"}.`;
    });

  await step(SC, role,
    "Second request type for a Matter destination; a module-only Contract destination reads the Default type's Form",
    "The Matter request type saves its destination; with Default type the card reads the Default Contract type's Form.",
    async () => {
      await admin.goto(`${BASE}/settings/intake/request-types`);
      await admin.getByRole("button", { name: `Edit ${F.goneForm}`, exact: true }).click();
      await admin.getByRole("combobox", { name: "Default destination" }).selectOption({ label: "Contract" });
      await pause(1200);
      const defaultCard = flat(await admin.getByRole("region", { name: "Intake form" }).innerText());
      const editHref = await admin.getByRole("region", { name: "Intake form" }).getByRole("link", { name: "Edit form" }).getAttribute("href");
      await admin.getByRole("combobox", { name: "Default contract type" }).selectOption({ label: F.gone });
      await admin.getByRole("textbox", { name: "Description" }).fill("Fictional form whose destination type will be archived.");
      await admin.getByRole("textbox", { name: "Description" }).press("Tab");
      await pause(1200);
      await admin.goto(`${BASE}/settings/intake/request-types`);
      await admin.getByRole("button", { name: `Edit ${F.matterForm}`, exact: true }).click();
      await admin.getByRole("textbox", { name: "Description" }).fill("Ask Legal for advice. Fictional DOC-030 walkthrough form.");
      await admin.getByRole("textbox", { name: "Description" }).press("Tab");
      await admin.getByRole("combobox", { name: "Default matter type" }).selectOption({ label: F.advisory });
      await pause(1500);
      await admin.getByRole("region", { name: "Intake form" }).getByText(F.matterScope).waitFor({ timeout: 15000 });
      const card = (await admin.getByRole("region", { name: "Intake form" }).getByRole("listitem").allInnerTexts()).map(flat);
      const cts = (await api(admin, "GET", "/api/v1/contract-types")).body?.contractTypes ?? [];
      const def = cts.find((t) => t.isDefault);
      expectThat(editHref?.includes(def?.id), `module-only Edit form ${editHref}, default ${def?.id}`);
      return `${q(F.goneForm)} with Contract and type Default showed a card for the Default type (${q(defaultCard.slice(0, 120))}…) whose Edit form link opens the Default Contract type (${q(def?.displayName)}); it was then pointed at ${q(F.gone)}. ${q(F.matterForm)} saved Default destination Matter with ${q(F.advisory)}; its card lists ${q(card)}.`;
    });

  await step(SC, role,
    "Offer guidance before submission, steps 1-4: Deflection links > Add link; External address needs http(s); Knowledge item; Label; Placement; Edit; reorder",
    "A bare address is refused; the external and Knowledge links save with their placements; Edit and keyboard reorder persist.",
    async () => {
      await openSettings(admin, A, "Intake");
      await pane(admin, "Intake panes", "Deflection links");
      await admin.getByRole("heading", { name: "Deflection links" }).first().waitFor();
      await admin.getByRole("button", { name: "Add link" }).first().click();
      let d = admin.getByRole("dialog", { name: "Add link" });
      await d.getByRole("radio", { name: "External address" }).check();
      await d.getByRole("textbox", { name: "Address" }).fill("example.com/doc-030-supplier-checklist");
      await d.getByRole("textbox", { name: "Label" }).fill(F.extLabel);
      await d.getByRole("combobox", { name: "Placement" }).selectOption({ label: F.contractForm });
      await d.getByRole("button", { name: "Add link" }).click();
      await pause(800);
      const refusal = flat(await d.getByText(/Enter a full web address/).first().innerText().catch(() => ""));
      await d.getByRole("textbox", { name: "Address" }).fill("https://example.com/doc-030-supplier-checklist");
      await d.getByRole("button", { name: "Add link" }).click();
      await d.waitFor({ state: "hidden", timeout: 15000 });
      await admin.getByRole("button", { name: "Add link" }).first().click();
      d = admin.getByRole("dialog", { name: "Add link" });
      await d.getByRole("radio", { name: "Knowledge item" }).check();
      const kiSel = d.getByRole("combobox", { name: "Knowledge item" });
      const kis = (await kiSel.locator("option").allInnerTexts()).map(flat).filter((o) => o && !/^Choose/.test(o) && !/\(archived\)$/.test(o));
      S.kiName = kis.find((o) => /legal/i.test(o)) ?? kis[0];
      await kiSel.selectOption({ label: S.kiName });
      await d.getByRole("textbox", { name: "Label" }).fill(`${F.kiLabel} draft`);
      await d.getByRole("combobox", { name: "Placement" }).selectOption({ label: F.matterForm });
      await d.getByRole("button", { name: "Add link" }).click();
      await d.waitFor({ state: "hidden", timeout: 15000 });
      await admin.getByRole("button", { name: `Edit ${F.kiLabel} draft`, exact: true }).click();
      d = admin.getByRole("dialog");
      await d.getByRole("textbox", { name: "Label" }).fill(F.kiLabel);
      await d.getByRole("button", { name: "Save" }).click();
      await d.waitFor({ state: "hidden", timeout: 15000 });
      for (const l of [F.extLabel, F.kiLabel]) record("deflection link", l);
      const pos = async () => Number((await admin.getByRole("button", { name: new RegExp(`^Reorder ${escapeRe(F.kiLabel)}, position`) }).getAttribute("aria-label")).match(/position (\d+)/)[1]);
      const before = await pos();
      await admin.getByRole("button", { name: new RegExp(`^Reorder ${escapeRe(F.kiLabel)}, position`) }).focus();
      await admin.keyboard.press("ArrowUp");
      await pause(1500);
      await admin.reload();
      await admin.getByRole("button", { name: new RegExp(`^Reorder ${escapeRe(F.kiLabel)}, position`) }).waitFor();
      const after = await pos();
      expectThat(refusal && after === before - 1, `refusal ${refusal}, positions ${before} ${after}`);
      return `A bare address was refused with ${q(refusal)}; with https:// the External address link ${q(F.extLabel)} saved with Placement ${q(F.contractForm)}. Knowledge item offered ${kis.length} live items; ${q(S.kiName)} saved as ${q(F.kiLabel)} for ${q(F.matterForm)} after Edit changed its Label. ArrowUp moved it from ${before} to ${after}, kept after reload.`;
    });

  // Business User context: one fresh magic link for the whole section.
  // BU_STATE (outside docs/) lets repeated development runs reuse one Portal session.
  const buState = process.env.BU_STATE && existsSync(process.env.BU_STATE) ? process.env.BU_STATE : undefined;
  const bctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, storageState: buState });
  contexts.push(bctx);
  const business = await bctx.newPage();
  S.business = business;
  async function businessSignIn() {
    if (buState && (await business.request.get(`${BASE}/api/v1/me`)).ok()) return "reused a Portal session from an earlier magic-link sign-in in this walk";
    await portalSignIn(business, PEOPLE.business_user.email);
    if (process.env.BU_STATE) await bctx.storageState({ path: process.env.BU_STATE });
    return "signed in with a fresh magic link from the lab Mailpit";
  }

  await step(SC, "business_user",
    "Negative check (V-C38, V-C40 editors): a Business User cannot open configuration; Check the result on the Portal: cards, Before you submit, Fields, order and required markers; submit with a required answer missing, then valid answers",
    "Settings configuration URLs send the Business User away; the card shows the description and Estimated turnaround: 5 business days; the form shows the external guidance and the Rows in Form order with required markers; a missing required answer is refused; valid answers create a Request.",
    async () => {
      currentPage = business;
      const how = await businessSignIn();
      const denied = [];
      for (const u of ["/settings/contracts/types", "/settings/intake/request-types"]) {
        await business.goto(`${BASE}${u}`);
        await business.waitForLoadState("networkidle").catch(() => {});
        await pause(800);
        denied.push(`${u} -> ${new URL(business.url()).pathname}`);
        expectThat(!new URL(business.url()).pathname.startsWith("/settings/contracts") && !new URL(business.url()).pathname.startsWith("/settings/intake"), `Business User stayed on ${business.url()}`);
      }
      const { list, link } = await portalCard(business, F.contractForm);
      const card = flat(await link.innerText());
      expectThat(/Estimated turnaround: 5 business days/.test(card) && /supplier contract/.test(card), `card ${card}`);
      await link.click();
      await business.getByRole("heading", { name: F.contractForm, level: 1 }).waitFor({ timeout: 20000 });
      const guide = business.getByRole("region", { name: /Before you submit/ });
      const ext = guide.getByRole("link", { name: new RegExp(escapeRe(F.extLabel)) });
      const href = await ext.getAttribute("href");
      const labels = (await business.locator("main label").allInnerTexts()).map(flat).filter(Boolean);
      await business.screenshot({ path: path.join(SHOTS, "v-c40-portal-contract-form.png"), fullPage: true });
      await business.getByRole("textbox", { name: /^Title/ }).fill(name(SC, "Supplier contract request"));
      await business.getByRole("button", { name: "Submit request" }).click();
      await pause(1500);
      const refusal = flat((await business.locator("main").innerText()).split("\n").filter((l) => /is required|^Fill /.test(l.trim())).join(" | "));
      const still = await business.getByRole("button", { name: "Submit request" }).count();
      expectThat(refusal && still === 1, `missing required not refused: ${refusal}`);
      const dept = business.getByLabel(/^Department/).first();
      const deptOpts = (await dept.locator("option").allInnerTexts().catch(() => [])).map(flat).filter((o) => o && !/^(Choose|Select|Not set)/.test(o));
      if (deptOpts.length) await dept.selectOption({ label: deptOpts[0] });
      const urg = business.getByLabel(/^Urgency/).first();
      const urgOpts = (await urg.locator("option").allInnerTexts().catch(() => [])).map(flat).filter((o) => o && !/^(Choose|Select|Not set)/.test(o));
      if (urgOpts.length) await urg.selectOption({ label: urgOpts.find((o) => /Medium|Normal/.test(o)) ?? urgOpts[0] });
      await business.getByLabel(new RegExp(`^${escapeRe(F.dealValue)}`)).fill("125000");
      const termSel = business.getByLabel(/^Term type/).first();
      const termOpts = (await termSel.locator("option").allInnerTexts()).map(flat);
      await termSel.selectOption({ value: "fixed" });
      await pause(500);
      const expiryFixed = (await business.locator("main label").allInnerTexts()).map(flat).filter((l) => /^Expiry date/.test(l));
      await termSel.selectOption({ value: "evergreen" });
      await pause(500);
      const expiryEvergreen = (await business.locator("main label").allInnerTexts()).map(flat).filter((l) => /^Expiry date/.test(l));
      expectThat(expiryFixed.length === 1 && expiryEvergreen.length === 0, `Portal Expiry date: fixed ${q(expiryFixed)}, evergreen ${q(expiryEvergreen)}`);
      if (termOpts.includes("evergreen")) {
        results.productBugs.push({
          section,
          scenario: SC,
          title: "The Portal form shows Term type choices as machine values",
          reproduction: `Turn on On intake form for the built-in Term type Row on a Contract type's Form, point a Request type at it, and open that form on the Portal as a Business User. The Term type choices read ${q(termOpts)}.`,
          expected: "Not set, Fixed, Auto-renew, Evergreen (the labels the Form builder preview and the Create contract dialog show)",
          observed: q(termOpts),
          source: "apps/web/src/routes/portal-request-form.tsx built-in Term type Row options",
        });
      }
      const since = Date.now();
      await business.getByRole("button", { name: "Submit request" }).click();
      await business.getByText("Thanks! Your request has been submitted to legal.").waitFor({ timeout: 20000 });
      S.contractRequest = await submittedNumber(business, since);
      record("request", name(SC, "Supplier contract request"), { number: S.contractRequest });
      expectThat(href === "https://example.com/doc-030-supplier-checklist", `href ${href}`);
      return `Jonas Weber ${how}. ${denied.join("; ")}. Portal card: ${q(card)}. ${q(F.contractForm)} shows Before you submit with ${q(F.extLabel)} -> ${href}; labels ${q(labels)}. Submit with only a Title showed ${q(refusal)} and stayed on the form. Term type offered ${q(termOpts)}; with fixed the form showed ${q(expiryFixed)}, with evergreen no Expiry date. With Department ${q(deptOpts[0])}, ${q(F.dealValue)} 125000 and Term type evergreen, Submit showed "Thanks! Your request has been submitted to legal." (R-${S.contractRequest}). Screenshot v-c40-portal-contract-form.png.`;
    });

  await step(SC, "business_user",
    "Check the result on the Portal for the Matter form: guidance for that form only; submit valid answers",
    "The Matter form shows the Knowledge link and not the external one; valid answers create a Request; the Knowledge link opens.",
    async () => {
      const { link } = await portalCard(business, F.matterForm);
      await link.click();
      await business.getByRole("heading", { name: F.matterForm, level: 1 }).waitFor({ timeout: 20000 });
      const guide = business.getByRole("region", { name: /Before you submit/ });
      const ki = await guide.getByRole("link", { name: new RegExp(escapeRe(F.kiLabel)) }).count();
      const ext = await guide.getByRole("link", { name: new RegExp(escapeRe(F.extLabel)) }).count();
      const labels = (await business.locator("main label").allInnerTexts()).map(flat).filter(Boolean);
      await business.getByRole("textbox", { name: /^Title/ }).fill(name(SC, "Advice request"));
      const dept = business.getByLabel(/^Department/).first();
      const deptOpts = (await dept.locator("option").allInnerTexts().catch(() => [])).map(flat).filter((o) => o && !/^(Choose|Select|Not set)/.test(o));
      if (deptOpts.length) await dept.selectOption({ label: deptOpts[0] });
      const urg = business.getByLabel(/^Urgency/).first();
      const urgOpts = (await urg.locator("option").allInnerTexts().catch(() => [])).map(flat).filter((o) => o && !/^(Choose|Select|Not set)/.test(o));
      if (urgOpts.length) await urg.selectOption({ label: urgOpts[0] });
      await business.getByLabel(new RegExp(`^${escapeRe(F.matterScope)}`)).selectOption({ label: "Privacy" });
      const since = Date.now();
      await business.getByRole("button", { name: "Submit request" }).click();
      await business.getByText("Thanks! Your request has been submitted to legal.").waitFor({ timeout: 20000 });
      S.matterRequest = await submittedNumber(business, since);
      record("request", name(SC, "Advice request"), { number: S.matterRequest });
      // Follow the guidance link.
      const { link: again } = await portalCard(business, F.matterForm);
      await again.click();
      await business.getByRole("region", { name: /Before you submit/ }).getByRole("link", { name: new RegExp(escapeRe(F.kiLabel)) }).click();
      await business.waitForLoadState("networkidle").catch(() => {});
      await pause(1000);
      const kiPath = new URL(business.url()).pathname;
      const kiHeading = flat(await business.getByRole("heading", { level: 1 }).first().innerText().catch(() => ""));
      expectThat(ki === 1 && ext === 0, `ki ${ki}, ext ${ext}`);
      expectThat(kiHeading && kiHeading !== F.matterForm, `Knowledge heading ${kiHeading}`);
      return `${q(F.matterForm)} shows Before you submit with ${q(F.kiLabel)} only (external link count ${ext}); labels ${q(labels)}. Submit with ${q(F.matterScope)} Privacy created R-${S.matterRequest}. The Knowledge link opened ${kiPath} with heading ${q(kiHeading)}.`;
    });

  currentPage = admin;
  await step(SC, role,
    "Check the result: convert the Contract form Request to a Contract and check the intended answers on the new record",
    "The Convert dialog proposes the configured Contract type; the new Contract holds Deal value and Term type from the Request.",
    async () => {
      await admin.goto(`${BASE}/inbox/${S.contractRequest}`);
      await admin.getByRole("button", { name: "Triage" }).click();
      await admin.getByRole("menuitem", { name: "Convert to contract" }).click();
      const d = admin.getByRole("dialog", { name: new RegExp(`^Convert R-${S.contractRequest} to a contract`) });
      await d.waitFor({ timeout: 15000 });
      const type = await d.getByLabel("Contract type").evaluate((e) => (e.tagName === "SELECT" ? e.selectedOptions[0]?.textContent : e.textContent));
      const dText = flat(await d.innerText());
      await d.getByRole("button", { name: "Convert to contract" }).click();
      const conv = await until(async () => (await api(admin, "GET", `/api/v1/requests/${S.contractRequest}`)).body?.request?.convertedRecord, "Request not converted", 30000);
      S.convertedContract = String(conv.number);
      await pause(1500);
      const pageLink = flat(await admin.locator("main").getByRole("link", { name: new RegExp(`C-${S.convertedContract}`) }).first().innerText().catch(() => ""));
      const statusCard = flat(await admin.getByRole("region", { name: "Status" }).innerText().catch(() => ""));
      await admin.goto(`${BASE}/contracts/${S.convertedContract}`);
      record("contract", "converted", { number: S.convertedContract });
      const c = (await api(admin, "GET", `/api/v1/contracts/${S.convertedContract}`)).body;
      const deal = c?.contract?.customFields?.[S.dealSlug];
      const term = c?.contract?.termType;
      const typeName = c?.contract?.contractTypeName ?? c?.contract?.contractType?.displayName;
      await admin.getByRole("navigation", { name: "Contract sections" }).getByRole("link", { name: "Fields" }).click();
      const shown = await admin.locator("main").getByRole("textbox", { name: new RegExp(`^${escapeRe(F.dealValue)}`) }).inputValue().catch(async () => admin.locator("main").getByRole("spinbutton", { name: new RegExp(`^${escapeRe(F.dealValue)}`) }).inputValue().catch(() => null));
      expectThat(flat(type) === F.msa && Number(deal) === 125000 && term === "evergreen", `type ${type}, deal ${deal}, term ${term}`);
      return `Inbox R-${S.contractRequest} > Triage > Convert to contract opened a dialog with Contract type ${q(flat(type))} (${q(dText.slice(0, 160))}…). After Convert the Request page read Status ${q(statusCard)}${pageLink ? ` with a link ${q(pageLink)}` : ""}. C-${S.convertedContract} is of type ${q(typeName)}; it holds ${q(F.dealValue)} ${deal} (Fields tab shows ${q(shown)}) and Term type ${term}.`;
    });

  await step(SC, role,
    "Check the result: convert the Matter form Request to a Matter and check the answer",
    "The Convert dialog proposes the configured Matter type; the new Matter holds the Field answer.",
    async () => {
      await admin.goto(`${BASE}/inbox/${S.matterRequest}`);
      await admin.getByRole("button", { name: "Triage" }).click();
      await admin.getByRole("menuitem", { name: "Convert to matter" }).click();
      const d = admin.getByRole("dialog", { name: new RegExp(`^Convert R-${S.matterRequest} to a matter`) });
      await d.waitFor({ timeout: 15000 });
      const type = await d.getByLabel("Matter type").evaluate((e) => (e.tagName === "SELECT" ? e.selectedOptions[0]?.textContent : e.textContent));
      await d.getByRole("button", { name: "Convert to matter" }).click();
      const conv = await until(async () => (await api(admin, "GET", `/api/v1/requests/${S.matterRequest}`)).body?.request?.convertedRecord, "Request not converted", 30000);
      S.convertedMatter = String(conv.number);
      await pause(1500);
      const statusCard = flat(await admin.getByRole("region", { name: "Status" }).innerText().catch(() => ""));
      record("matter", "converted", { number: S.convertedMatter });
      const m = (await api(admin, "GET", `/api/v1/matters/${S.convertedMatter}`)).body?.matter;
      expectThat(flat(type) === F.advisory && m?.customFields?.[S.scopeSlug] === "Privacy" && m?.matterTypeName === F.advisory, `type ${type}, value ${q(m?.customFields)}`);
      return `Inbox R-${S.matterRequest} > Triage > Convert to matter proposed Matter type ${q(flat(type))}. After Convert the Request page read Status ${q(statusCard)}; M-${S.convertedMatter} (${q(m.matterTypeName)}) is holding ${q(F.matterScope)} = ${q(m.customFields[S.scopeSlug])}.`;
    });

  await step(SC, "business_user",
    "Negative check: archived destination type. Submit on the form while its type is live; archive the type; the editor shows it unavailable; the Portal still lists the form and opening it shows an error instead of the questions (suspected product bug)",
    "The guide says the Business User sees an error instead of the questions and that OpenLaw does not send the form to another type or module.",
    async () => {
      currentPage = business;
      const { link } = await portalCard(business, F.goneForm);
      await link.click();
      await business.getByRole("heading", { name: F.goneForm, level: 1 }).waitFor({ timeout: 20000 });
      await business.getByRole("textbox", { name: /^Title/ }).fill(name(SC, "Retired destination request"));
      const dept = business.getByLabel(/^Department/).first();
      const deptOpts = (await dept.locator("option").allInnerTexts().catch(() => [])).map(flat).filter((o) => o && !/^(Choose|Select|Not set)/.test(o));
      if (deptOpts.length) await dept.selectOption({ label: deptOpts[0] });
      const urg = business.getByLabel(/^Urgency/).first();
      const urgOpts = (await urg.locator("option").allInnerTexts().catch(() => [])).map(flat).filter((o) => o && !/^(Choose|Select|Not set)/.test(o));
      if (urgOpts.length) await urg.selectOption({ label: urgOpts[0] });
      const since = Date.now();
      await business.getByRole("button", { name: "Submit request" }).click();
      await business.getByText("Thanks! Your request has been submitted to legal.").waitFor({ timeout: 20000 });
      S.goneRequest = await submittedNumber(business, since);
      record("request", name(SC, "Retired destination request"), { number: S.goneRequest });
      // Administrator archives the destination type in the browser.
      currentPage = admin;
      await admin.goto(`${BASE}/settings/contracts/types`);
      await admin.getByRole("button", { name: `Archive ${F.gone}`, exact: true }).click();
      const d = admin.getByRole("dialog");
      await d.getByRole("button", { name: /^Archive/ }).last().click();
      await d.waitFor({ state: "hidden", timeout: 15000 });
      await admin.goto(`${BASE}/settings/intake/request-types`);
      const listRow = flat(await row(admin, F.goneForm).innerText());
      await admin.getByRole("button", { name: `Edit ${F.goneForm}`, exact: true }).click();
      await admin.getByRole("combobox", { name: "Default contract type" }).waitFor();
      const shown = await admin.getByRole("combobox", { name: "Default contract type" }).evaluate((e) => e.selectedOptions[0]?.textContent);
      const cardText = flat(await admin.getByRole("region", { name: "Intake form" }).innerText().catch(() => ""));
      // Business User view.
      currentPage = business;
      const { list, link: stillListed } = await portalCard(business, F.goneForm);
      const listed = await stillListed.count();
      let opened = "not listed";
      if (listed) {
        await stillListed.click();
        await business.waitForLoadState("networkidle").catch(() => {});
        await pause(2000);
        opened = flat(await business.locator("body").innerText()).slice(0, 300);
        await business.screenshot({ path: path.join(SHOTS, "v-c40-portal-archived-destination.png"), fullPage: true });
      }
      const apiRead = await api(business, "GET", `/api/v1/portal/request-types`);
      const portalType = (apiRead.body?.requestTypes ?? apiRead.body ?? []).find?.((t) => t.displayName === F.goneForm);
      const detail = portalType ? await api(business, "GET", `/api/v1/portal/request-types/${portalType.slug ?? portalType.id}`) : null;
      S.goneObserved = { listRow, shown, cardText, listed, opened, detail: detail ? `${detail.status} ${q(detail.body?.detail ?? detail.body?.title)}` : null };
      const questions = listed ? await business.getByRole("button", { name: "Submit request" }).count() : 0;
      expectThat(/\(unavailable\)/.test(shown ?? ""), `editor shows ${shown}`);
      if (listed && questions === 0) {
        results.productBugs.push({
          section,
          scenario: SC,
          title: "The Portal lists a Request type whose destination type is archived, and opening it shows the generic error page",
          reproduction: `As the Administrator, point Request type ${q(F.goneForm)} at Contract type ${q(F.gone)}, then archive that Contract type (Settings > Contracts > Types > Archive). As Jonas Weber (Business User) open the Portal: the card is still listed. Select it.`,
          expected: "Either the Portal stops listing the form, or it opens the Default type's Form (INT-002 archived target type addendum: an archived target type reads as no type), or it names the problem.",
          observed: `The card stays listed (${listed}). Opening it shows ${q(opened)} with no form questions. GET /api/v1/portal/request-types/{slug} answers ${S.goneObserved.detail}.`,
          source: "apps/api/src/lib/intake-form.ts readIntakeTree (400 This Request type needs a destination type.); apps/web/src/routes/portal-request-form.tsx loader throws for any non-404 failure; apps/api/src/modules/portal/routes.ts lists the type",
          confirmsAuthorSuspicion: true,
        });
      }
      return `R-${S.goneRequest} was submitted on ${q(F.goneForm)} while ${q(F.gone)} was live. The Administrator archived ${q(F.gone)} (no Contracts used it). The Request types list row then read ${q(listRow)}; the editor's Default contract type read ${q(shown)}; the Intake form card read ${q(cardText.slice(0, 160))}. On the Portal the card is still listed (${listed}); opening it showed ${q(opened)} with ${questions} Submit request buttons. The API detail read answers ${S.goneObserved.detail}. The guide's "If it does not work" describes this as an error instead of the questions; the product bug is recorded.`;
    });

  currentPage = admin;
  await step(SC, role,
    "Negative check: conversion with an archived destination type does not switch modules",
    "The Convert dialog for the Request stays on Contract (conversion reads the archived type as no type) and does not route to Matter.",
    async () => {
      await admin.goto(`${BASE}/inbox/${S.goneRequest}`);
      const convertsTo = flat(await admin.locator("main").getByText(/Converts to/).first().locator("..").innerText().catch(() => ""));
      await admin.getByRole("button", { name: "Triage" }).click();
      const items = (await admin.getByRole("menuitem").allInnerTexts()).map(flat);
      await admin.getByRole("menuitem", { name: "Convert to contract" }).click();
      const d = admin.getByRole("dialog", { name: new RegExp(`^Convert R-${S.goneRequest} to a`) });
      await d.waitFor({ timeout: 15000 });
      const title = flat(await d.getByRole("heading").first().innerText());
      const typeSel = d.getByLabel("Contract type");
      const type = await typeSel.evaluate((e) => (e.tagName === "SELECT" ? e.selectedOptions[0]?.textContent : e.textContent));
      const offered = (await typeSel.locator("option").allInnerTexts().catch(() => [])).map(flat);
      await admin.keyboard.press("Escape");
      expectThat(/to a contract/.test(title) && !offered.includes(F.gone), `title ${title}, offered archived ${offered.includes(F.gone)}`);
      return `Inbox R-${S.goneRequest} reads ${q(convertsTo.slice(0, 120))}. Triage offered ${q(items)}. Convert to contract opened ${q(title)} with Contract type ${q(flat(type))}; the archived ${q(F.gone)} is not offered (${offered.length} options). The dialog stays in the Contract module. It was closed without converting.`;
    });

  await step(SC, role,
    "Archive a request type: the dialog shows how many Requests use it; choose a live replacement; the Portal drops the form; Show archived > Restore offers it again",
    "The count matches; after archive the Requests move and the Portal no longer lists the form; Restore brings it back.",
    async () => {
      await admin.goto(`${BASE}/settings/intake/request-types`);
      await admin.getByRole("button", { name: `Archive ${F.goneForm}`, exact: true }).click();
      const d = admin.getByRole("dialog");
      const text = flat(await d.innerText());
      await d.getByRole("combobox").selectOption({ label: F.contractForm });
      await d.getByRole("button", { name: "Archive type" }).click();
      await d.waitFor({ state: "hidden", timeout: 15000 });
      currentPage = business;
      const { list } = await portalCard(business, F.contractForm);
      const listedAfter = await list.getByRole("link", { name: new RegExp(escapeRe(F.goneForm)) }).count();
      const req = (await api(admin, "GET", `/api/v1/requests/${S.goneRequest}`)).body;
      const reqType = req?.request?.requestTypeName ?? req?.requestTypeName ?? req?.request?.requestType?.displayName;
      currentPage = admin;
      await admin.goto(`${BASE}/settings/intake/request-types`);
      await admin.getByRole("switch", { name: "Show archived" }).click();
      await admin.getByRole("button", { name: `Restore ${F.goneForm}`, exact: true }).click();
      await admin.getByRole("button", { name: `Archive ${F.goneForm}`, exact: true }).waitFor({ timeout: 15000 });
      expectThat(/used by 1 request/.test(text) && listedAfter === 0, `text ${text}, listed ${listedAfter}`);
      // Leave the retired-destination form archived so no other walker meets the error page.
      await admin.getByRole("button", { name: `Archive ${F.goneForm}`, exact: true }).click();
      const d2 = admin.getByRole("dialog");
      await d2.getByRole("button", { name: "Archive type" }).click();
      await d2.waitFor({ state: "hidden", timeout: 15000 });
      return `Archive ${q(F.goneForm)} read ${q(text)}; with ${q(F.contractForm)} chosen, Archive type archived it. The Portal then listed it ${listedAfter} times; R-${S.goneRequest} reads request type ${q(reqType)}. Show archived > Restore made it live again; it was archived again afterwards (no Requests left) so other walkers do not meet its error page.`;
    });
}

// =====================================================================
// V-C41 reminders-and-audit: lead times, comment emails, delivery
// =====================================================================
function localDate(zone, addDays = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const d = new Date(`${parts}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + addDays);
  return d.toISOString().slice(0, 10);
}
function localHour(zone) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", hourCycle: "h23" }).format(new Date()));
}
const ZONES = ["Asia/Dubai", "Asia/Tokyo", "Europe/London", "America/New_York", "Pacific/Honolulu", "Pacific/Pago_Pago", "Asia/Kolkata", "Australia/Sydney", "America/Los_Angeles", "Pacific/Kiritimati", "Pacific/Auckland"];
async function leadTimes(page) {
  await page.getByRole("heading", { name: "Reminder lead times" }).waitFor();
  await page.getByRole("button", { name: /^Reorder / }).first().waitFor();
  await pause(400);
  return page.getByRole("button", { name: /^Reorder / }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label").replace(/^Reorder (.*), position.*$/, "$1")));
}
async function addLeadTime(page, days) {
  await page.getByRole("button", { name: "Add lead time" }).click();
  await page.getByRole("spinbutton", { name: "days before the date" }).fill(String(days));
  const save = page.getByRole("button", { name: "Save", exact: true });
  if (await save.isEnabled()) await save.click();
  else await page.getByRole("spinbutton", { name: "days before the date" }).press("Enter");
  await pause(1200);
  const open = page.getByRole("listitem").filter({ has: page.getByRole("spinbutton", { name: "days before the date" }) });
  if (await open.count()) return flat(await open.innerText()) || "(Save stayed disabled)";
  return null;
}
async function closeAddRow(page) {
  const cancel = page.getByRole("button", { name: "Cancel", exact: true });
  if (await cancel.count()) {
    await cancel.click();
    await page.getByRole("spinbutton", { name: "days before the date" }).waitFor({ state: "detached", timeout: 10000 });
  }
}
async function runMorningRound(admin) {
  const r = await api(admin, "POST", "/api/v1/notifications/morning-round");
  if (r.status === 200) return { how: "POST /api/v1/notifications/morning-round (the lab's dev overlay trigger, which runs the cron's own round)", summary: r.body };
  const script = `const m=await import('/app/node_modules/.pnpm/pg-boss@12.34.0/node_modules/pg-boss/dist/index.js');
const b=new m.PgBoss({connectionString:process.env.DATABASE_URL, supervise:false, schedule:false});
await b.start(); let id=null; for (let i=0;i<60 && !id;i++){ id=await b.send('notification.morning-round',{}); if(!id) await new Promise(r=>setTimeout(r,2000)); }
let job=null; for (let i=0;i<120;i++){ job=await b.getJobById('notification.morning-round', id); if(job && ['completed','failed','cancelled'].includes(job.state)) break; await new Promise(r=>setTimeout(r,1000)); }
console.log(JSON.stringify({id, state: job?.state, output: job?.output ?? null})); await b.stop({graceful:false, wait:false}); process.exit(0);`;
  const out = execFileSync("docker", ["exec", "-w", "/app/apps/api", `${PROJECT}-worker-1`, "node", "--input-type=module", "-e", script], { timeout: 300000 }).toString().trim().split("\n").pop();
  return { how: `pg-boss job notification.morning-round queued in ${PROJECT}-worker-1 (trigger route answered ${r.status})`, summary: JSON.parse(out) };
}
async function inviteAndActivate(admin, browser, contexts, displayName, email) {
  await admin.goto(`${BASE}/settings/users`);
  await admin.getByRole("button", { name: "Invite user" }).click();
  const d = admin.getByRole("dialog", { name: "Invite user" });
  await d.getByRole("textbox", { name: "Display name" }).fill(displayName);
  await d.getByRole("textbox", { name: "Email" }).fill(email);
  await d.getByRole("radio", { name: "Legal team member" }).check();
  const since = Date.now();
  await d.getByRole("button", { name: "Send invite" }).click();
  await d.waitFor({ state: "hidden", timeout: 15000 });
  const mail = await waitForMail(email, null, since, 90000);
  expectThat(mail, `no invitation mail for ${email}`);
  const match = mail.text.match(/https?:\/\/[^\s)\]>"]+\/auth\/set-password[^\s)\]>"]*/);
  expectThat(match, "no set-password link in the invitation");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  contexts.push(ctx);
  const page = await ctx.newPage();
  await page.goto(toLab(match[0]));
  await page.getByLabel("New password").fill(process.env.LAB_PASSWORD);
  await page.getByLabel("Confirm password").fill(process.env.LAB_PASSWORD);
  await page.getByRole("button", { name: "Set password" }).click();
  await page.getByText("Password set").waitFor({ timeout: 20000 });
  await browserSignIn(page, { email, name: displayName });
  return page;
}
async function setTimezone(page, zone) {
  await page.goto(`${BASE}/settings/profile`);
  const combo = page.getByRole("combobox", { name: "Timezone" });
  await combo.click();
  const city = zone.split("/").pop().replace(/_/g, " ");
  await combo.fill(city);
  await page.getByRole("option", { name: new RegExp(escapeRe(city)) }).first().click();
  await pause(1500);
  const me = await api(page, "GET", "/api/v1/me");
  return me.body?.user?.timezone ?? me.body?.timezone;
}
async function addKeyDate(page, matterNumber, { date, event, extraLead = null, recipient = null }) {
  await page.goto(`${BASE}/matters/${matterNumber}/key-dates`);
  await page.getByRole("button", { name: "Add date" }).or(page.getByRole("heading", { name: "Something went wrong." })).first().waitFor({ timeout: 20000 });
  if (await page.getByRole("heading", { name: "Something went wrong." }).count()) {
    S.keyDateErrorPages = (S.keyDateErrorPages ?? 0) + 1;
    await pause(2000);
    await page.reload();
  }
  await page.getByRole("button", { name: "Add date" }).click();
  const d = page.getByRole("dialog", { name: "Add a Key date" });
  await d.getByRole("textbox", { name: "Date" }).fill(date);
  await d.getByRole("textbox", { name: "Event" }).fill(event);
  if (extraLead !== null) {
    await d.getByRole("spinbutton", { name: "Additional lead time (days before)" }).fill(String(extraLead));
    await d.getByRole("button", { name: "Add lead time" }).click();
  }
  const remind = flat(await d.getByText(/^This date will remind:/).textContent());
  const boxes = await d.getByRole("checkbox").evaluateAll((els) => els.map((e) => `${e.getAttribute("aria-label") ?? e.parentElement?.textContent}: ${e.checked ?? e.getAttribute("aria-checked")}`));
  if (recipient) {
    const box = d.getByRole("checkbox", { name: recipient });
    if ((await box.getAttribute("aria-checked")) !== "true" && !(await box.isChecked().catch(() => false))) await box.check();
  }
  await d.getByRole("button", { name: "Add date" }).click();
  await d.waitFor({ state: "hidden", timeout: 15000 });
  return { remind, boxes };
}

async function remindersSection(admin, browser, contexts) {
  const SC = "V-C41";
  const role = "administrator";
  const A = PEOPLE.administrator;
  currentPage = admin;
  const orig = (await api(admin, "GET", "/api/v1/org/reminder-offsets")).body?.offsets;
  S.originalOffsets = orig;
  const probe = [9, 11, 12, 13, 17, 19, 23].find((n) => !orig.includes(n));

  try {
    await step(SC, role,
      "Set reminder lead times, steps 1-2: profile menu > Settings > Organization > Notifications shows Reminder lead times; Personal > Notifications changes only your preferences",
      "Organization > Notifications shows the Reminder lead times list; Personal > Notifications shows Notification preferences and the personal lead time switch.",
      async () => {
        await openSettings(admin, A, "Notifications");
        const list = await leadTimes(admin);
        const orgPath = new URL(admin.url()).pathname;
        const headings = (await admin.locator("main").getByRole("heading").allInnerTexts()).map(flat);
        const note = flat(await admin.getByText(/Keep at least one lead time/).first().innerText());
        await openSettings(admin, A, "Notifications", "Personal");
        await admin.getByRole("heading", { name: "Notification preferences" }).waitFor();
        const personalPath = new URL(admin.url()).pathname;
        const own = await admin.getByRole("switch", { name: "Use the organization's default lead times" }).count();
        S.originalLeadTimes = list;
        expectThat(orgPath !== personalPath && own === 1, `${orgPath} ${personalPath} ${own}`);
        return `Organization > Notifications opened ${orgPath} with headings ${q(headings)} and the list ${q(list)}; the note reads ${q(note)}. Personal > Notifications opened ${personalPath} with Notification preferences and the switch "Use the organization's default lead times".`;
      });

    await step(SC, role,
      "Steps 3-5: Add lead time with Save; Cancel discards; a duplicate and 731 are refused; reorder with the arrow keys; Remove; reload and confirm; at most 20 entries",
      "The new lead time is added; duplicates and 731 are refused; the reorder persists after reload; a 21st entry is refused; Remove removes an entry.",
      async () => {
        await openSettings(admin, A, "Notifications");
        await leadTimes(admin);
        await admin.getByRole("button", { name: "Add lead time" }).click();
        await admin.getByRole("spinbutton", { name: "days before the date" }).fill("33");
        await admin.getByRole("button", { name: "Cancel", exact: true }).click();
        await pause(800);
        const afterCancel = await leadTimes(admin);
        expectThat(!afterCancel.includes("33 days before"), `Cancel saved 33`);
        const label = `${probe} days before`;
        await addLeadTime(admin, probe);
        await admin.getByRole("button", { name: new RegExp(`^Reorder ${label}, position`) }).waitFor({ timeout: 10000 });
        const dup = await addLeadTime(admin, probe);
        await closeAddRow(admin);
        const big = await addLeadTime(admin, 731);
        await closeAddRow(admin);
        const zero = (await leadTimes(admin)).includes("On the day");
        const listNow = await leadTimes(admin);
        expectThat(listNow.filter((l) => l === label).length === 1 && !listNow.includes("731 days before"), `list ${q(listNow)}`);
        const { before, after } = await moveUp(admin, label);
        const reloaded = await leadTimes(admin);
        const extra = [];
        for (let n = 40; (await leadTimes(admin)).length < 20; n++) {
          if (orig.includes(n)) continue;
          await addLeadTime(admin, n);
          extra.push(n);
        }
        const twentyFirst = await addLeadTime(admin, 90);
        await closeAddRow(admin);
        const after21 = await leadTimes(admin);
        for (const n of extra) {
          await admin.getByRole("button", { name: `Remove ${n} days before`, exact: true }).click();
          await admin.getByRole("button", { name: `Remove ${n} days before`, exact: true }).waitFor({ state: "detached", timeout: 10000 });
        }
        expectThat(after21.length === 20 && !after21.includes("90 days before"), `21st saved: ${after21.length}`);
        expectThat(dup && big, "a refusal showed nothing");
        await admin.screenshot({ path: path.join(SHOTS, "v-c41-reminder-lead-times.png") });
        return `Add lead time with 33 and Cancel saved nothing. ${probe} + Save added ${q(label)}. A second ${probe} stayed in the add row with ${q(dup)}; 731 with ${q(big)}. "On the day" (0) is on the list: ${zero}. ArrowUp moved ${q(label)} from ${before} to ${after}; after reload the list read ${q(reloaded)}. ${extra.length} temporary entries filled the list to 20; 90 was then refused with ${q(twentyFirst)} and the list stayed at ${after21.length}. Remove took the temporary entries away again.`;
      });

    await step(SC, role,
      "Choose whether comment emails carry the words: Comment emails card, Include comment words in email, on by default; saves on change; recorded as an Administrator-only Audit log event",
      "The switch starts on, turns off and saves, and the Audit log shows the change with an Administrator audience; it is put back on.",
      async () => {
        await openSettings(admin, A, "Notifications");
        const sw = admin.getByRole("switch", { name: "Include comment words in email" });
        const start = await sw.getAttribute("aria-checked");
        const help = flat(await admin.getByText(/Applies to everyone in the organization/).innerText());
        await sw.click();
        await until(async () => (await sw.getAttribute("aria-checked")) === "false", "switch did not turn off");
        await pause(1200);
        await admin.reload();
        const persisted = await admin.getByRole("switch", { name: "Include comment words in email" }).getAttribute("aria-checked");
        await admin.getByRole("switch", { name: "Include comment words in email" }).click();
        await until(async () => (await admin.getByRole("switch", { name: "Include comment words in email" }).getAttribute("aria-checked")) === "true", "switch did not turn back on");
        await pause(1200);
        await admin.goto(`${BASE}/settings/audit-log`);
        await admin.getByRole("searchbox", { name: "Search" }).fill("comment");
        await pause(2000);
        const rows = (await admin.getByRole("table").getByRole("row").allInnerTexts()).slice(1).map(flat).filter((r) => /Daniel Okafor/.test(r) && /comment/i.test(r));
        await admin.getByRole("button", { name: "Clear filters" }).click();
        expectThat(start === "true" && persisted === "false", `start ${start}, persisted ${persisted}`);
        expectThat(rows.length > 0 && /Administrator/.test(rows[0]), `audit rows ${q(rows.slice(0, 2))}`);
        return `The Comment emails card's switch started on (${start}); help ${q(help)}. Turning it off saved and read off after reload; it was turned back on. Audit log Search "comment" shows ${rows.length} of Daniel Okafor's rows, newest ${q(rows[0]?.slice(0, 260))}.`;
      });

    await step(SC, role,
      "Check delivery: two fictional Legal Team Members, one past 08:00 and one before 08:00 in their saved timezone; Key dates at listed and unlisted distances; a Key date's own lead time; run the morning round; read each bell and briefing email",
      "The past-08:00 colleague gets one reminder per Key date at a listed distance (two Key dates on one date each remind) and for the Key date's own lead time, none at an unlisted distance; the before-08:00 colleague gets nothing yet.",
      async () => {
        const ready = ZONES.find((z) => localHour(z) >= 9 && localHour(z) <= 21);
        const early = ZONES.find((z) => localHour(z) < 7);
        expectThat(ready && early, `no zone pair: ${q(ZONES.map((z) => [z, localHour(z)]))}`);
        const users = {};
        for (const [key, zone] of [["ready", ready], ["early", early]]) {
          const displayName = name(SC, `Reminder ${key}`);
          const email = `doc030-admincfg-${key}-${stamp}@helix.example`;
          const page = await inviteAndActivate(admin, browser, contexts, displayName, email);
          const saved = await setTimezone(page, zone);
          expectThat(saved === zone, `timezone saved as ${saved}`);
          const me = await api(page, "GET", "/api/v1/me");
          users[key] = { displayName, email, zone, page, id: me.body?.user?.id ?? me.body?.id, hour: localHour(zone) };
          record("user", displayName, { role: "legal_team_member", timezone: zone });
          const mts = (await api(admin, "GET", "/api/v1/matter-types")).body?.matterTypes ?? [];
          const m = await api(admin, "POST", "/api/v1/matters", { title: name(SC, `Reminder matter ${key}`), matterTypeId: mts.find((t) => t.displayName === "Default").id, managerId: users[key].id });
          users[key].matter = m.body?.matter?.number;
          expectThat(users[key].matter, `matter fixture ${m.status} ${q(m.body)}`);
          record("matter", name(SC, `Reminder matter ${key}`), { number: users[key].matter });
        }
        const r = users.ready;
        const listed = orig.filter((n) => n > 1).sort((a, b) => a - b)[0] ?? 7;
        const unlisted = [11, 12, 13, 17, 19, 23].find((n) => !orig.includes(n));
        const own = [15, 16, 18, 20, 22].find((n) => !orig.includes(n));
        const plan = [
          { event: name(SC, `KD listed A ${listed}`), days: listed, expect: true },
          { event: name(SC, `KD listed B ${listed}`), days: listed, expect: true },
          { event: name(SC, `KD unlisted ${unlisted}`), days: unlisted, expect: false },
          { event: name(SC, `KD own lead ${own}`), days: own, extraLead: own, expect: true },
        ];
        const notes = [];
        for (const k of plan) {
          k.date = localDate(r.zone, k.days);
          const res = await addKeyDate(admin, r.matter, { date: k.date, event: k.event, extraLead: k.extraLead ?? null, recipient: r.displayName });
          notes.push(`${k.event.replace(`${G} ${SC} `, "")} on ${k.date}: ${res.remind}`);
        }
        const e = users.early;
        const earlyKd = { event: name(SC, `KD early ${listed}`), date: localDate(e.zone, listed) };
        await addKeyDate(admin, e.matter, { ...earlyKd, recipient: e.displayName });
        const round = await runMorningRound(admin);
        await pause(4000);
        const bell = await api(r.page, "GET", "/api/v1/notifications");
        const items = bell.body?.notifications ?? bell.body?.items ?? [];
        const observed = {};
        for (const k of plan) observed[k.event] = items.filter((n) => JSON.stringify(n).includes(k.event)).length;
        const mail = await waitForMail(r.email, /briefing/i, Date.now() - 120000, 45000);
        const mailHits = {};
        for (const k of plan) mailHits[k.event] = mail ? mail.text.includes(k.event) : null;
        const earlyBell = await api(e.page, "GET", "/api/v1/notifications");
        const earlyHas = JSON.stringify(earlyBell.body).includes(earlyKd.event);
        const earlyMail = await waitForMail(e.email, /briefing/i, Date.now() - 120000, 5000);
        await r.page.goto(`${BASE}/`);
        const bellButton = await r.page.getByRole("banner").getByRole("button", { name: /^Notifications/ }).getAttribute("aria-label");
        const wrong = plan.filter((k) => (k.expect ? observed[k.event] !== 1 : observed[k.event] !== 0));
        expectThat(wrong.length === 0, `bell ${q(observed)}; mail ${q(mailHits)}; round ${q(round)}`);
        expectThat(!earlyHas && !earlyMail, `early colleague served: bell ${earlyHas}, mail ${!!earlyMail}`);
        return `Invited ${q(r.displayName)} (timezone ${r.zone}, local hour ${r.hour}) and ${q(e.displayName)} (${e.zone}, local hour ${e.hour}) as Legal Team Members; each set a password from the invitation mail and saved the timezone on Profile. Each manages one Matter (M-${r.matter}, M-${e.matter}). Key dates on M-${r.matter}: ${notes.join("; ")}. The Key dates page showed the generic error page ${S.keyDateErrorPages ?? 0} times on navigation and loaded after Reload. The round ran through ${round.how}: ${q(round.summary)}. ${q(r.displayName)}'s bell items per Key date: ${q(observed)}; header bell ${q(bellButton)}; briefing mail ${mail ? q(mail.subject) : "not found"} with Key date names ${q(mailHits)}. ${q(e.displayName)} (before 08:00): bell holds its Key date ${earlyHas}; briefing mail ${earlyMail ? "found" : "none"}.`;
      });
  } finally {
    await step(SC, role,
      "Restore the organization lead time list (the guide's last-entry rule checked on the way) and confirm it after reload",
      "The last entry cannot be removed; the list reads as before the walkthrough.",
      async () => {
        await openSettings(admin, A, "Notifications");
        let list = await leadTimes(admin);
        for (const l of list.slice(1)) {
          await admin.getByRole("button", { name: `Remove ${l}`, exact: true }).click();
          await admin.getByRole("button", { name: `Remove ${l}`, exact: true }).waitFor({ state: "detached", timeout: 10000 });
        }
        const last = (await leadTimes(admin))[0];
        const lastRemove = admin.getByRole("button", { name: `Remove ${last}`, exact: true });
        const lastState = (await lastRemove.count()) === 0 ? "no Remove control" : `Remove disabled=${await lastRemove.isDisabled()} aria-disabled=${await lastRemove.getAttribute("aria-disabled")}`;
        if ((await lastRemove.count()) && (await lastRemove.isEnabled())) {
          await lastRemove.click();
          await pause(1200);
        }
        const stillOne = (await leadTimes(admin)).length;
        const put = await api(admin, "PUT", "/api/v1/org/reminder-offsets", { offsets: S.originalOffsets });
        await admin.reload();
        const final = await leadTimes(admin);
        const now = (await api(admin, "GET", "/api/v1/org/reminder-offsets")).body?.offsets;
        expectThat(stillOne === 1, `last entry removed (${stillOne})`);
        expectThat(q(now) === q(S.originalOffsets), `final ${q(now)} vs ${q(S.originalOffsets)}`);
        return `Removed entries down to one (${q(last)}): ${lastState}; the list kept ${stillOne} entry. The original offsets ${q(S.originalOffsets)} were put back with PUT /api/v1/org/reminder-offsets (${put.status}); after reload the page reads ${q(final)}.`;
      }, "restore");
  }
}

// =====================================================================
// V-C41 reminders-and-audit: Audit log
// =====================================================================
async function auditRows(page) {
  await pause(1500);
  const table = page.getByRole("table");
  await table.or(page.getByText(/^No (entry|Tool calls) match/)).first().waitFor();
  if (!(await table.count())) return [];
  return (await table.getByRole("row").allInnerTexts()).slice(1).map(flat);
}
async function exportCsv(page, linkName = "Export CSV") {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: linkName }).click()]);
  const dir = mkdtempSync(path.join(os.tmpdir(), "doc030-audit-"));
  const file = path.join(dir, download.suggestedFilename());
  await download.saveAs(file);
  const text = readFileSync(file, "utf8");
  rmSync(dir, { recursive: true, force: true });
  return { name: download.suggestedFilename(), lines: text.trim().split("\n") };
}
function browserToday(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
async function selectContaining(page, label, re) {
  const sel = page.getByRole("combobox", { name: label });
  const opts = (await sel.locator("option").allInnerTexts()).map(flat);
  const pick = opts.find((o) => re.test(o));
  expectThat(pick, `${label} has no option matching ${re}: ${q(opts.slice(0, 30))}`);
  await sel.selectOption({ label: pick });
  return pick;
}

async function auditSection(admin, browser, contexts) {
  const SC = "V-C41";
  const role = "administrator";
  const A = PEOPLE.administrator;
  currentPage = admin;

  await step(SC, role,
    "Find a change in the Audit log, steps 1-2: Settings > Advanced > Audit log; combine Person, Action and Record",
    "The Activity tab opens; Person Daniel Okafor plus an Action plus a Record kind narrow to matching rows only.",
    async () => {
      await openSettings(admin, A, "Audit log", "Advanced");
      await admin.getByRole("navigation", { name: "Audit log panes" }).waitFor();
      const tabs = (await admin.getByRole("navigation", { name: "Audit log panes" }).getByRole("link").allInnerTexts()).map(flat);
      const header = (await admin.getByRole("columnheader").allInnerTexts()).map(flat);
      await admin.getByRole("combobox", { name: "Person" }).selectOption({ label: A.name });
      const actions = (await admin.getByRole("combobox", { name: "Action" }).locator("option").allInnerTexts()).map(flat);
      const action = await selectContaining(admin, "Action", /matter type|matter_type/i);
      const records = (await admin.getByRole("combobox", { name: "Record" }).locator("option").allInnerTexts()).map(flat);
      const rows = await auditRows(admin);
      expectThat(rows.length > 0 && rows.every((r) => r.startsWith(A.name)), `rows ${q(rows.slice(0, 3))}`);
      await admin.screenshot({ path: path.join(SHOTS, "v-c41-audit-log-filtered.png") });
      return `Settings > Advanced > Audit log opened ${new URL(admin.url()).pathname} with tabs ${q(tabs)} and columns ${q(header)}. Action offered ${actions.length} choices; Record offered ${q(records)}. Person Daniel Okafor + Action ${q(action)} showed ${rows.length} rows, all by Daniel Okafor, for example ${q(rows[0].slice(0, 220))}.`;
    });

  await step(SC, role,
    "Steps 3-5: From and To in the browser's local days; Search; read event, record, audience, time and before-and-after values; Show older; Clear filters",
    "Today's bounds keep rows; yesterday's bounds remove them; Search narrows to this walk's records; Show older adds rows; Clear filters resets every filter.",
    async () => {
      await admin.getByRole("textbox", { name: "From" }).fill(browserToday(0));
      await admin.getByRole("textbox", { name: "To" }).fill(browserToday(0));
      const todayRows = await auditRows(admin);
      await admin.getByRole("textbox", { name: "From" }).fill(browserToday(-1));
      await admin.getByRole("textbox", { name: "To" }).fill(browserToday(-1));
      const yRows = await auditRows(admin);
      await admin.getByRole("button", { name: "Clear filters" }).click();
      await pause(800);
      const cleared = {
        person: flat(await admin.getByRole("combobox", { name: "Person" }).locator("option:checked").innerText()),
        action: flat(await admin.getByRole("combobox", { name: "Action" }).locator("option:checked").innerText()),
        record: flat(await admin.getByRole("combobox", { name: "Record" }).locator("option:checked").innerText()),
        from: await admin.getByRole("textbox", { name: "From" }).inputValue(),
        search: await admin.getByRole("searchbox", { name: "Search" }).inputValue(),
      };
      const first = (await auditRows(admin)).length;
      await admin.getByRole("button", { name: "Show older" }).click();
      await until(async () => (await admin.getByRole("table").getByRole("row").count()) - 1 > first, "Show older added no rows");
      const second = (await auditRows(admin)).length;
      await admin.getByRole("searchbox", { name: "Search" }).fill(`${G} V-C38`);
      const searched = await auditRows(admin);
      const withChange = searched.find((r) => /→/.test(r));
      await admin.getByRole("button", { name: "Clear filters" }).click();
      expectThat(todayRows.length > 0 && yRows.length === 0, `today ${todayRows.length}, yesterday ${yRows.length}`);
      expectThat(!cleared.from && !cleared.search, `cleared ${q(cleared)}`);
      const exports = searched.filter((r) => !r.includes(G));
      expectThat(searched.length > 0 && exports.every((r) => /exported the audit log/.test(r)), `search ${q(exports.slice(0, 2))}`);
      return `From/To ${browserToday(0)} kept ${todayRows.length} rows; ${browserToday(-1)} left ${yRows.length}. Clear filters reset to ${q(cleared)}. Unfiltered first page ${first} rows; Show older made ${second}. Search "${G} V-C38" left ${searched.length} rows: ${searched.length - exports.length} name this walk's records and ${exports.length} are earlier "exported the audit log" entries whose saved filter holds the same words; one with before-and-after values reads ${q(withChange?.slice(0, 260))}.`;
    });

  await step(SC, role,
    "Export CSV downloads the matching entries",
    "The file has a header and only rows that match the filter.",
    async () => {
      await admin.getByRole("combobox", { name: "Person" }).selectOption({ label: A.name });
      await admin.getByRole("searchbox", { name: "Search" }).fill(`${G} V-C38`);
      const shown = (await auditRows(admin)).length;
      const csv = await exportCsv(admin);
      const body = csv.lines.slice(1);
      await admin.getByRole("button", { name: "Clear filters" }).click();
      expectThat(body.length > 0 && body.every((l) => l.includes(G) || l.startsWith('"') || /V-C38/.test(l)), `csv ${q(body.slice(0, 2))}`);
      return `With Person Daniel Okafor and Search "${G} V-C38" the page showed ${shown} rows. Export CSV downloaded ${q(csv.name)} with header ${q(csv.lines[0])} and ${body.length} data lines naming this walk's records. The file was saved outside the repository and deleted.`;
    });

  await step(SC, "legal_team_member+administrator",
    "Entries about a Confidential Matter appear only when the Administrator is in its audience, in the page and in Export CSV",
    "While Nadia Haddad's Confidential Matter excludes Daniel Okafor, Search and the CSV hold none of its entries; after Nadia adds Daniel to the team they appear.",
    async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      contexts.push(ctx);
      const member = await ctx.newPage();
      await browserSignIn(member, PEOPLE.legal_team_member);
      const title = name(SC, "Confidential audit");
      const mts = (await api(admin, "GET", "/api/v1/matter-types")).body?.matterTypes ?? [];
      const me = (await api(member, "GET", "/api/v1/me")).body;
      const m = await api(member, "POST", "/api/v1/matters", { title, matterTypeId: (mts.find((t) => t.displayName === "Default") ?? mts[0])?.id, isConfidential: true, managerId: me?.user?.id ?? me?.id });
      const number = m.body?.matter?.number;
      expectThat(number, `confidential matter ${m.status} ${q(m.body)}`);
      record("matter (confidential)", title, { number, createdBy: PEOPLE.legal_team_member.name });
      const adminRead = await api(admin, "GET", `/api/v1/matters/${number}`);
      await admin.goto(`${BASE}/settings/audit-log`);
      await admin.getByRole("searchbox", { name: "Search" }).fill(title);
      const hidden = (await auditRows(admin)).filter((r) => r.includes(title) || r.includes(`M-${number}`));
      const csvHidden = (await exportCsv(admin)).lines.slice(1).filter((l) => l.includes(title) || l.includes(`M-${number}`)).length;
      currentPage = member;
      await member.goto(`${BASE}/matters/${number}`);
      await member.getByRole("button", { name: "Matter team" }).click();
      await member.getByRole("button", { name: "Add team member" }).click();
      const td = member.getByRole("dialog", { name: "Add team member" });
      await td.getByRole("combobox", { name: "Person" }).selectOption({ label: A.name });
      await td.getByRole("button", { name: "Add", exact: true }).click();
      await td.waitFor({ state: "hidden", timeout: 15000 });
      await until(async () => (await api(admin, "GET", `/api/v1/matters/${number}`)).status === 200, "Daniel still cannot read the Matter");
      currentPage = admin;
      await admin.getByRole("button", { name: "Clear filters" }).click();
      await admin.getByRole("searchbox", { name: "Search" }).fill(title);
      const shown = await auditRows(admin);
      const csvShown = (await exportCsv(admin)).lines.slice(1).filter((l) => l.includes(title) || l.includes(`M-${number}`)).length;
      await admin.getByRole("button", { name: "Clear filters" }).click();
      expectThat(hidden.length === 0 && csvHidden === 0, `hidden entries shown ${hidden.length}/${csvHidden}`);
      expectThat(shown.length > 0 && csvShown > 0, `entries still hidden ${shown.length}/${csvShown}`);
      return `Nadia Haddad created Confidential M-${number} ${q(title)} (API fixture as Nadia). Daniel's GET of it answered ${adminRead.status}. Audit log Search for the title showed ${hidden.length} entries and Export CSV held ${csvHidden}. After Nadia added Daniel Okafor through Matter team > Add team member, the same Search showed ${shown.length} rows (for example ${q(shown[0]?.slice(0, 200))}) and the CSV held ${csvShown}.`;
    });

  await step(SC, "legal_team_member",
    "Negative check: the Audit log is unavailable to other roles",
    "Nadia Haddad (Legal Team Member) is sent away from /settings/audit-log and its Tool calls tab, and the API refuses both.",
    async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      contexts.push(ctx);
      const member = await ctx.newPage();
      currentPage = member;
      await browserSignIn(member, PEOPLE.legal_team_member);
      const out = [];
      for (const [u, a] of [["/settings/audit-log", "/api/v1/audit-log"], ["/settings/audit-log/tool-calls", "/api/v1/audit-log/tool-calls"]]) {
        await member.goto(`${BASE}${u}`);
        await member.waitForLoadState("networkidle").catch(() => {});
        await pause(1000);
        const landed = new URL(member.url()).pathname;
        const r = await api(member, "GET", a);
        expectThat(landed !== u && r.status === 403, `${u} -> ${landed}; ${a} ${r.status}`);
        out.push(`${u} -> ${landed}; GET ${a} answered ${r.status}`);
      }
      const rail = (await member.getByRole("navigation", { name: "Settings sections" }).getByRole("link").allInnerTexts()).map(flat);
      return `${out.join(". ")}. Nadia's Settings rail lists ${q(rail)}.`;
    });
}

// =====================================================================
// V-C41 reminders-and-audit: Tool calls (needs one MCP call)
// =====================================================================
async function toolCallsSection(admin, browser, contexts) {
  const SC = "V-C41";
  const role = "administrator";
  const A = PEOPLE.administrator;
  currentPage = admin;
  const policyBefore = (await api(admin, "GET", "/api/v1/mcp-settings")).body;
  const clientName = name(SC, "Headless client");
  let client = null;
  try {
    await step(SC, "legal_team_member+administrator",
      "Fixture: one MCP Tool call through an API key that Nadia Haddad requests and Daniel Okafor approves on this lab; one Tool makes a change",
      "MCP is on with Legal API keys allowed; the approved key connects a Client; openlaw_whoami answers; a write Tool changes a fictional record.",
      async () => {
        const needs = !policyBefore.enabled || !policyBefore.legalApiKeysEnabled || policyBefore.readOnly;
        if (needs) {
          const p = await api(admin, "PATCH", "/api/v1/mcp-settings", { enabled: true, legalApiKeysEnabled: true, readOnly: false });
          expectThat(p.status === 200, `policy ${p.status} ${q(p.body)}`);
        }
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        contexts.push(ctx);
        const member = await ctx.newPage();
        currentPage = member;
        await browserSignIn(member, PEOPLE.legal_team_member);
        await member.goto(`${BASE}/settings/api-keys`);
        await member.getByRole("button", { name: "Request a key", exact: true }).click();
        const d = member.getByRole("dialog", { name: "Request an API key" });
        await d.getByLabel("Client name").fill(clientName);
        await d.getByRole("checkbox", { name: "Matters", exact: true }).check();
        const writeRadio = d.getByRole("radio", { name: /^Read and write/ });
        if (await writeRadio.count()) await writeRadio.check();
        else await d.getByRole("radio").last().check();
        await d.getByRole("button", { name: "Send request" }).click();
        await member.getByRole("row").filter({ hasText: clientName }).waitFor({ timeout: 15000 });
        currentPage = admin;
        await admin.goto(`${BASE}/`);
        await admin.getByRole("button", { name: /^Notifications/ }).click();
        const approval = admin.getByRole("region", { name: "Your approvals" }).getByRole("listitem").filter({ hasText: clientName });
        await approval.getByRole("button", { name: "Approve", exact: true }).click();
        await approval.waitFor({ state: "detached", timeout: 15000 });
        await admin.keyboard.press("Escape");
        currentPage = member;
        await member.reload();
        const ready = member.getByRole("dialog", { name: "Your key is ready" });
        await ready.waitFor({ timeout: 15000 });
        const key = await ready.getByRole("code").innerText();
        await ready.getByRole("button", { name: "Done", exact: true }).click();
        record("api key", clientName, { owner: PEOPLE.legal_team_member.name });
        const mod = await import(path.join(ROOT, "node_modules/.pnpm/@modelcontextprotocol+client@2.0.0/node_modules/@modelcontextprotocol/client/dist/index.mjs"));
        client = new mod.Client({ name: clientName, version: "1" });
        await client.connect(new mod.StreamableHTTPClientTransport(new URL("/mcp", BASE), { requestInit: { headers: { "x-api-key": key } } }));
        const tools = (await client.listTools()).tools;
        const who = await client.callTool({ name: "openlaw_whoami", arguments: {} });
        let change = "no write Tool called";
        const create = tools.find((t) => /^openlaw_matter_create$/.test(t.name));
        if (create) {
          const mts = (await api(admin, "GET", "/api/v1/matter-types")).body?.matterTypes ?? [];
          const title = name(SC, "Matter via MCP");
          const args = { matterTypeId: mts.find((t) => t.displayName === "Default").id, answers: { title } };
          const res = await client.callTool({ name: create.name, arguments: args });
          S.mcpMatterTitle = title;
          change = `${create.name} answered isError=${!!res.isError} ${q(JSON.stringify(res.structuredContent ?? res.content).slice(0, 160))}`;
          record("matter", title, { via: clientName });
        }
        S.mcpClientName = clientName;
        S.mcpTools = tools.map((t) => t.name);
        expectThat(!who.isError, "whoami failed");
        return `MCP policy before: enabled ${policyBefore.enabled}, Legal API keys ${policyBefore.legalApiKeysEnabled}, read-only ${policyBefore.readOnly}${needs ? "; turned on for this step and put back afterwards" : ""}. Nadia Haddad requested ${q(clientName)} on Settings > API keys (Matters, read and write); Daniel Okafor approved it from the bell's Your approvals; Nadia's "Your key is ready" dialog showed the key once (not recorded). The SDK Client connected over /mcp with ${tools.length} Tools; openlaw_whoami answered; ${change}.`;
      }, "fixture-setup");

    currentPage = admin;
    await step(SC, role,
      "Read Tool calls, steps 1-3: Settings > Advanced > Audit log > Tool calls; When, Person, Client, Tool, Outcome, Duration; From and To; Load more; Clear filters",
      "The tab lists the call with Nadia Haddad, the Client name, openlaw_whoami, an outcome and a duration; the date filters narrow; Clear filters resets.",
      async () => {
        await openSettings(admin, A, "Audit log", "Advanced");
        await admin.getByRole("navigation", { name: "Audit log panes" }).getByRole("link", { name: "Tool calls" }).click();
        await admin.getByRole("heading", { name: "Tool calls" }).waitFor();
        const header = (await admin.getByRole("columnheader").allInnerTexts()).map(flat);
        const mine = async () => (await auditRows(admin)).filter((r) => r.includes(clientName));
        const rows = await until(async () => { const m = await mine(); return m.length ? m : null; }, "no Tool call row for the Client", 20000);
        await admin.getByRole("textbox", { name: "From" }).fill(browserToday(-1));
        await admin.getByRole("textbox", { name: "To" }).fill(browserToday(-1));
        const yesterday = await mine();
        await admin.getByRole("button", { name: "Clear filters" }).click();
        await pause(800);
        const loadMore = await admin.getByRole("button", { name: "Load more" }).count();
        let more = "no Load more button (all calls fit on one page)";
        if (loadMore) {
          const before = (await auditRows(admin)).length;
          await admin.getByRole("button", { name: "Load more" }).click();
          await pause(1500);
          more = `Load more took the table from ${before} to ${(await auditRows(admin)).length} rows`;
        }
        const text = rows.join(" | ");
        expectThat(/Nadia Haddad/.test(text) && /openlaw_whoami/.test(text) && /(Success|Error|Refused|Pending)/.test(text) && /\d+ ms/.test(text), `rows ${text}`);
        expectThat(yesterday.length === 0, `yesterday rows ${yesterday.length}`);
        return `Tool calls columns ${q(header)}. Rows for ${q(clientName)}: ${q(rows.map((r) => r.slice(0, 160)))}. From/To = ${browserToday(-1)} hid them. ${more}. Clear filters reset the dates.`;
      });

    await step(SC, role,
      "Tool calls: a change a Tool made appears on the Activity tab attributed to the person via the Client; Export CSV of calls is itself recorded on the Activity tab as an Administrator-only event",
      "Activity shows Nadia Haddad, via the Client, creating the Matter; after Export CSV an Administrator-only export entry appears.",
      async () => {
        let via = "no write Tool was available";
        if (S.mcpMatterTitle) {
          await admin.goto(`${BASE}/settings/audit-log`);
          await admin.getByRole("searchbox", { name: "Search" }).fill(S.mcpMatterTitle);
          const rows = await auditRows(admin);
          via = rows.find((r) => r.includes("via")) ?? rows[0] ?? "(none)";
          expectThat(new RegExp(`Nadia Haddad, via ${escapeRe(clientName)}`).test(via), `activity ${q(rows.slice(0, 2))}`);
        }
        await admin.goto(`${BASE}/settings/audit-log/tool-calls`);
        await admin.getByRole("heading", { name: "Tool calls" }).waitFor();
        const csv = await exportCsv(admin);
        await admin.goto(`${BASE}/settings/audit-log`);
        await admin.getByRole("combobox", { name: "Person" }).selectOption({ label: A.name });
        const exportAction = await selectContaining(admin, "Action", /export/i);
        const rows = await auditRows(admin);
        await admin.getByRole("button", { name: "Clear filters" }).click();
        expectThat(rows.length > 0 && /Administrator/.test(rows[0]), `export rows ${q(rows.slice(0, 2))}`);
        return `Activity Search for the Matter the Tool made reads ${q(via.slice(0, 220))}. Tool calls Export CSV downloaded ${q(csv.name)} with header ${q(csv.lines[0])} and ${csv.lines.length - 1} data lines (file deleted). Activity with Person Daniel Okafor and Action ${q(exportAction)} now shows ${q(rows[0]?.slice(0, 200))}.`;
      });

    await step(SC, role,
      "On Settings, MCP, the Tool calls in the last day button opens the Tool calls tab filtered to the last 24 hours",
      "The link opens /settings/audit-log/tool-calls with a last-day range and the From date set.",
      async () => {
        await openSettings(admin, A, "MCP");
        await admin.getByRole("link", { name: "Tool calls in the last day" }).click();
        await admin.waitForURL(/\/settings\/audit-log\/tool-calls/, { timeout: 15000 });
        await admin.getByRole("heading", { name: "Tool calls" }).waitFor();
        const from = await admin.getByRole("textbox", { name: "From" }).inputValue();
        const rows = (await auditRows(admin)).filter((r) => r.includes(clientName)).length;
        const note = flat(await admin.getByText(/^Last 24 hours:/).first().innerText().catch(() => ""));
        expectThat(/range=last-day/.test(admin.url()) && note, `url ${admin.url()} note ${note}`);
        return `Settings > MCP > Tool calls in the last day opened ${new URL(admin.url()).pathname + new URL(admin.url()).search}; the tab reads ${q(note)} (From box ${q(from)}); it lists ${rows} rows for ${q(clientName)}.`;
      });
  } finally {
    try { await client?.close(); } catch {}
    await step(SC, role,
      "Restore the MCP policy",
      "The MCP policy reads as before this walk.",
      async () => {
        const keys = (await api(admin, "GET", "/api/v1/mcp-settings/api-keys")).body;
        const list = Array.isArray(keys) ? keys : keys?.keys ?? [];
        const mine = list.find((k) => k.clientName === clientName);
        let revoked = "key not found in the listing";
        if (mine?.id) revoked = `POST /api/v1/api-key-requests/{id}/revoke answered ${(await api(admin, "POST", `/api/v1/api-key-requests/${mine.id}/revoke`, {})).status}`;
        const p = await api(admin, "PATCH", "/api/v1/mcp-settings", { enabled: policyBefore.enabled, legalApiKeysEnabled: policyBefore.legalApiKeysEnabled, readOnly: policyBefore.readOnly });
        const now = (await api(admin, "GET", "/api/v1/mcp-settings")).body;
        expectThat(now.enabled === policyBefore.enabled && now.legalApiKeysEnabled === policyBefore.legalApiKeysEnabled, `policy now ${now.enabled}/${now.legalApiKeysEnabled}`);
        return `The walk's key: ${revoked}. PATCH /api/v1/mcp-settings answered ${p.status}; MCP enabled ${now.enabled}, Legal API keys ${now.legalApiKeysEnabled}, read-only ${now.readOnly}, as before.`;
      }, "restore");
  }
}

// =====================================================================
// V-C56 auto-doc-template
// =====================================================================
const FIXTURES = path.join(here, "fixtures");
const fixture = (n) => path.join(FIXTURES, n);
function adTab(page, label) {
  return page.getByRole("navigation", { name: "Auto-Doc sections" }).getByRole("link", { name: label });
}
async function uploadRefused(page, file) {
  await page.getByRole("button", { name: "Upload version" }).click();
  const dialog = page.getByRole("dialog", { name: "Upload version" });
  await dialog.getByLabel("Word template").setInputFiles(file);
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  const alert = dialog.getByRole("alert");
  await alert.waitFor({ timeout: 20000 });
  const text = flat(await alert.textContent());
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await dialog.waitFor({ state: "hidden" });
  return text;
}
async function uploadReport(page, file) {
  await page.getByRole("button", { name: "Upload version" }).click();
  const dialog = page.getByRole("dialog", { name: "Upload version" });
  const caption = flat(await dialog.getByText(/Each upload adds a file version/).textContent());
  await dialog.getByLabel("Word template").setInputFiles(file);
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  const status = dialog.getByRole("status");
  await status.waitFor({ timeout: 30000 });
  const report = flat(await status.textContent());
  await dialog.getByRole("button", { name: "Close" }).click();
  await dialog.waitFor({ state: "hidden" });
  return { report, caption };
}
async function adFields(page) {
  const labels = await page.getByRole("button", { name: /^Edit / }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  return labels.filter((l) => !/^Edit the rule for /.test(l)).map((l) => l.replace(/^Edit /, ""));
}
async function pill(page) {
  return flat(await page.getByText(/^File version \d+$/).first().textContent());
}

async function autoDocSection(browser, contexts) {
  const SC = "V-C56";
  for (const [role, person] of [["legal_team_member", PEOPLE.legal_team_member], ["administrator", PEOPLE.administrator]]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    contexts.push(ctx);
    const page = await ctx.newPage();
    currentPage = page;
    await browserSignIn(page, person);
    const adName = name(SC, `${role === "administrator" ? "Admin" : "Member"} Services Agreement`);
    let base = null;

    await step(SC, role,
      "Download a starter template: Download starter template (.docx) beside the page title on Auto-Docs",
      "A Word file downloads with an instruction page (placeholders, bold, underline, italic, capitals, three date formats, currency, blocks) and an example services agreement with five fields and a confidentiality block.",
      async () => {
        await page.goto(`${BASE}/`);
        await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Auto-Docs" }).click();
        await page.getByRole("heading", { name: "Auto-Docs", level: 1 }).waitFor();
        const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download starter template (.docx)" }).click()]);
        const dir = mkdtempSync(path.join(os.tmpdir(), "doc030-starter-"));
        const file = path.join(dir, download.suggestedFilename());
        await download.saveAs(file);
        const xml = execFileSync("unzip", ["-p", file, "word/document.xml"]).toString();
        rmSync(dir, { recursive: true, force: true });
        const text = xml.replace(/<w:br[^>]*w:type="page"[^>]*\/>/g, "\n[PAGE BREAK]\n").replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "");
        const placeholders = [...new Set([...text.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1]))];
        const pageBreak = /\[PAGE BREAK\]/.test(text);
        const agreement = text.slice(text.indexOf("[PAGE BREAK]"));
        const agreementNames = [...new Set([...agreement.matchAll(/\{\{([a-z][a-z0-9_]*)(?:\|[^}]*)?\}\}/g)].map((m) => m[1]))];
        const has = (re) => placeholders.some((p) => re.test(p));
        expectThat(pageBreak && has(/\|bold$/) && has(/\|underline$/) && has(/\|italic$/) && has(/\|upper$/) && has(/date:YYYY-MM-DD/) && has(/date:DD\/MM\/YYYY/) && has(/date:MMMM D, YYYY/) && has(/currency:/) && has(/^#block/), `starter placeholders ${q(placeholders)}`);
        expectThat(agreementNames.length === 5 && /\{\{#block confidentiality/.test(agreement), `agreement names ${q(agreementNames)}`);
        return `Primary navigation > Auto-Docs showed the link "Download starter template (.docx)" beside the title; it downloaded ${q(download.suggestedFilename())} (saved outside the repository and deleted). The file has a page break; the instruction page shows ${q([...new Set([...text.slice(0, text.indexOf("[PAGE BREAK]")).matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1]))])}; the agreement after the break uses ${q(agreementNames)} and a confidentiality Block.`;
      });

    await step(SC, role,
      "Before you start: open Auto-Docs, create an Auto-Doc, open its Form section; the file shows on the left and the form on the right; Upload version",
      "The Form section shows an empty template pane beside the form and an Upload version button.",
      async () => {
        await page.getByRole("button", { name: "Create Auto-Doc" }).first().click();
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("Name").fill(adName);
        await dialog.getByRole("button", { name: "Create", exact: true }).click();
        await page.waitForURL(/\/auto-docs\/[0-9a-f-]+/, { timeout: 20000 });
        base = page.url().replace(/\/(overview|form|settings)?$/, "").match(/.*\/auto-docs\/[0-9a-f-]+/)[0];
        record("auto-doc", adName, { role });
        await adTab(page, "Form").click();
        await page.waitForURL(/\/form$/);
        const empty = flat(await page.getByText("Upload a Word file to start the form.").textContent());
        expectThat(await page.getByRole("button", { name: "Upload version" }).isVisible(), "no Upload version");
        return `Create Auto-Doc > Name > Create made ${q(adName)} and opened ${new URL(base).pathname}. The Form section reads ${q(empty)} with Upload version.`;
      });

    await step(SC, role,
      "Upload the file with Placeholders, directives (bold, italic, underline, upper, dates, currency) and one Block; read the template pane",
      "The upload reports the counts; the pane marks every Placeholder and Block in body, header, footer, footnote and endnote; new fields follow the pane order, body first; directives set the field types.",
      async () => {
        const { report, caption } = await uploadReport(page, fixture("doc030-services-v1.docx"));
        await page.getByRole("heading", { name: "doc030-services-v1.docx" }).waitFor();
        const summary = flat(await page.getByText(/\d+ Placeholders?, \d+ Blocks?/).first().textContent());
        const parts = {};
        for (const n of ["Body", "Header", "Footer", "Footnotes", "Endnotes"]) {
          const sec = page.locator(`section[aria-label="${n}"]`);
          parts[n] = (await sec.count()) ? await sec.getByRole("button", { name: /^Placeholder / }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label").replace(/^Placeholder /, ""))) : null;
        }
        const partOrder = await page.locator("section[aria-label]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")).filter((l) => ["Body", "Header", "Footer", "Footnotes", "Endnotes"].includes(l)));
        const block = flat(await page.getByRole("button", { name: "Block arbitration" }).textContent());
        const fields = await adFields(page);
        const types = {};
        for (const [slug, label] of [["fee_amount", "Fee amount"], ["signing_date", "Signing date"], ["provider_contact", "Provider contact"], ["governing_law", "Governing law"], ["client_matter", "Client matter"]]) {
          await page.getByRole("button", { name: `Placeholder ${slug}`, exact: true }).or(page.getByRole("button", { name: new RegExp(`^Placeholder ${slug}\\|`) })).first().click();
          types[slug] = flat(await page.getByRole("region", { name: label }).getByLabel("Type").locator("option:checked").innerText());
        }
        expectThat(/File version 1:/.test(report), `report ${report}`);
        expectThat(partOrder[0] === "Body" && parts.Header?.length && parts.Footer?.length && parts.Footnotes?.length && parts.Endnotes?.length, `parts ${q(parts)}`);
        expectThat(types.fee_amount === "Currency" && types.signing_date === "Date" && types.provider_contact === "Text" && types.governing_law === "Text", `types ${q(types)}`);
        expectThat(fields.indexOf("Client matter") > fields.indexOf("Arbitration seat") && fields.indexOf("Schedule number") > fields.indexOf("Arbitration seat"), `order ${q(fields)}`);
        if (role === "administrator") await page.screenshot({ path: path.join(SHOTS, "v-c56-admin-template-pane.png"), fullPage: true });
        return `Upload version caption ${q(caption)}; report ${q(report)}. Pane summary ${q(summary)}; parts in order ${q(partOrder)} with chips ${q(parts)}. Block tag ${q(block)}. Fields in order ${q(fields)} (body first). Types: ${q(types)}; the header {{counterparty_name|upper}} and the bold, italic and underline Placeholders uploaded without refusal.`;
      });

    await step(SC, role,
      "Edit a field from its card: select its chip, change the label and help; Template placeholder connects the field to the marker; the form follows each commit",
      "The chip opens the card with Label, Template placeholder, Type and Help text; the Fields list follows the new label; help saves.",
      async () => {
        const chip = page.getByRole("button", { name: "Placeholder counterparty_name", exact: true }).first();
        await chip.click();
        const card = page.getByRole("region", { name: "Counterparty name" });
        await card.waitFor();
        const controls = [];
        for (const l of ["Label", "Template placeholder", "Type", "Help text"]) controls.push(`${l}:${await card.getByLabel(l, { exact: true }).count()}`);
        const tp = await card.getByLabel("Template placeholder", { exact: true }).inputValue();
        await card.getByLabel("Label", { exact: true }).fill("Counterparty legal name");
        await card.getByLabel("Label", { exact: true }).press("Enter");
        const renamed = page.getByRole("region", { name: "Counterparty legal name" });
        await renamed.waitFor({ timeout: 15000 });
        await renamed.getByLabel("Help text").fill("Use the registered company name.");
        await renamed.getByLabel("Help text").press("Enter");
        await pause(1000);
        const listed = await adFields(page);
        expectThat(listed.includes("Counterparty legal name") && controls.every((c) => c.endsWith(":1")), `controls ${q(controls)}; list ${q(listed)}`);
        return `The chip opened the card with ${q(controls)}; Template placeholder reads ${q(tp)}. Label "Counterparty legal name" + Enter renamed the card and the Fields list (${q(listed.slice(0, 4))}…); Help text saved.`;
      });

    await step(SC, role,
      "Mark a Block: open the Block under Clauses, choose When a rule matches, pick the form field, the operator and the value",
      "Clauses notes that a Block with no rule is always included; after the rule the Block tag and Clauses row show the rule.",
      async () => {
        const before = flat(await page.getByRole("button", { name: "Block arbitration" }).textContent());
        const note = flat(await page.getByText("A Block with no rule is always included.").textContent());
        await page.getByRole("button", { name: "Edit the rule for arbitration" }).click();
        const card = page.getByRole("region", { name: "arbitration" });
        await card.waitFor();
        const include = (await card.getByLabel("Include").locator("option").allInnerTexts()).map(flat);
        await card.getByLabel("Include").selectOption({ label: "When a rule matches" });
        await card.getByLabel("Form field").selectOption({ label: "Governing law" });
        const ops = (await card.getByLabel("Operator").locator("option").allInnerTexts()).map(flat);
        await card.getByLabel("Operator").selectOption({ index: 0 });
        await card.getByLabel("Value").fill("England and Wales");
        await card.getByLabel("Value").press("Tab");
        await pause(1500);
        const after = flat(await page.getByRole("button", { name: "Block arbitration" }).textContent());
        const rowText = flat(await page.getByText(/Included when/).first().textContent().catch(() => "(none)"));
        expectThat(after !== before && /when/i.test(after + rowText), `block ${before} -> ${after}`);
        return `Clauses reads ${q(note)}; Block tag ${q(before)}. Include offered ${q(include)}; Operator offered ${q(ops)}. After When a rule matches / Governing law / ${q(ops[0])} / "England and Wales" the tag reads ${q(after)} and the row ${q(rowText)}.`;
      });

    await step(SC, role,
      "Negative: an unclosed Block, an unclosed brace, a bad name, an unknown directive, an unknown currency code and two directives on one Placeholder are refused and quote the text",
      "Each upload is refused with the offending text quoted; no file version is written.",
      async () => {
        const out = {};
        for (const [f, re] of [
          ["doc030-unclosed-block.docx", /#block arbitration/],
          ["doc030-unclosed-brace.docx", /\{\{counterparty_name/],
          ["doc030-bad-name.docx", /Counterparty-Name/],
          ["doc030-bad-directive.docx", /lower/],
          ["doc030-bad-currency.docx", /ZZZ/],
          ["doc030-two-directives-one-placeholder.docx", /upper\|bold|counterparty_name/],
        ]) {
          out[f] = await uploadRefused(page, fixture(f));
          expectThat(re.test(out[f]), `${f}: ${out[f]}`);
        }
        const p = await pill(page);
        expectThat(p === "File version 1", `pill ${p}`);
        return `Refusals: ${Object.entries(out).map(([f, t]) => `${f}: ${q(t)}`).join("; ")}. The pane still reads ${q(p)}.`;
      });

    await step(SC, role,
      "Negative: a macro, a non-hyperlink external link, an INCLUDETEXT field and a package that expands past 32 MiB are refused with the reason named",
      "Each upload is refused and the refusal names the reason; no file version is written.",
      async () => {
        const out = {};
        for (const [f, re] of [
          ["doc030-macro.docx", /macro/i],
          ["doc030-external-link.docx", /external .*link.*Only hyperlinks/i],
          ["doc030-includetext-field.docx", /INCLUDETEXT/],
          ["doc030-expands-past-32mib.docx", /32 MiB/],
        ]) {
          out[f] = await uploadRefused(page, fixture(f));
          expectThat(re.test(out[f]), `${f}: ${out[f]}`);
        }
        const p = await pill(page);
        expectThat(p === "File version 1", `pill ${p}`);
        return `Refusals: ${Object.entries(out).map(([f, t]) => `${f}: ${q(t)}`).join("; ")}. The pane still reads ${q(p)}. Fixtures are fictional files built by fixtures/build-fixtures.py.`;
      });

    await step(SC, role,
      "Negative: Publish refuses a field whose type cannot print its directive and names it (currency directive on a Text field)",
      "Publish shows a refusal naming the field and the Placeholder; the Auto-Doc stays Draft.",
      async () => {
        await page.getByRole("button", { name: "Placeholder fee_amount|currency:USD", exact: true }).or(page.getByRole("button", { name: "Placeholder fee_amount", exact: true })).first().click();
        const card = page.getByRole("region", { name: "Fee amount" });
        await card.getByLabel("Type").selectOption({ label: "Text" });
        await pause(1200);
        await page.getByRole("button", { name: "Publish", exact: true }).first().click();
        const dialog = page.getByRole("dialog", { name: "Publish" });
        await dialog.getByRole("button", { name: "Publish", exact: true }).click();
        const alert = dialog.getByRole("alert");
        await alert.waitFor({ timeout: 15000 });
        const text = flat(await alert.textContent());
        await dialog.getByRole("button", { name: "Cancel" }).click();
        await dialog.waitFor({ state: "hidden" });
        await card.getByLabel("Type").selectOption({ label: "Currency" });
        await pause(1200);
        expectThat(/Fee amount/.test(text) && /fee_amount\|currency:USD/.test(text), `refusal ${text}`);
        if (role === "administrator") await page.screenshot({ path: path.join(SHOTS, "v-c56-admin-publish-refusal.png") });
        return `With Fee amount set to Text, Publish refused with ${q(text)}. Type was set back to Currency.`;
      });

    await step(SC, role,
      "Upload a new version that drops a Placeholder: the orphaned field stays, marked No Placeholder in file version N; a new Placeholder gets a new field",
      "Signing date stays with the mark; Notice address is added.",
      async () => {
        const { report } = await uploadReport(page, fixture("doc030-services-v2.docx"));
        await page.getByRole("heading", { name: "doc030-services-v2.docx" }).waitFor();
        const p = await pill(page);
        const mark = flat(await page.getByText(/^No Placeholder in file version \d+$/).first().textContent());
        const fields = await adFields(page);
        expectThat(fields.includes("Signing date") && fields.includes("Notice address") && mark === "No Placeholder in file version 2", `fields ${q(fields)} mark ${mark}`);
        if (role === "legal_team_member") await page.screenshot({ path: path.join(SHOTS, "v-c56-member-orphaned-field.png"), fullPage: true });
        return `Report ${q(report)}; pane ${q(p)}. Fields ${q(fields)}; the Signing date row reads ${q(mark)}.`;
      });

    await step(SC, role,
      "Publish pins one file version and one form version together; later edits change nothing live until you publish again",
      "The Publish dialog offers file and form versions; after Publish the state is Published; a later edit leaves the live pair and Overview warns that a newer version exists.",
      async () => {
        await page.getByRole("button", { name: "Publish", exact: true }).first().click();
        const dialog = page.getByRole("dialog", { name: "Publish" });
        const files = (await dialog.getByLabel("File version").locator("option").allInnerTexts()).map(flat);
        const forms = (await dialog.getByLabel("Form version").locator("option").allInnerTexts()).map(flat);
        const caption = flat(await dialog.getByText(/Later edits leave this pair unchanged/).textContent());
        await dialog.getByLabel("File version").selectOption({ label: "File version 2" });
        await dialog.getByRole("button", { name: "Publish", exact: true }).click();
        let refusal = null;
        await dialog.waitFor({ state: "hidden", timeout: 15000 }).catch(async () => {
          refusal = flat(await dialog.getByRole("alert").textContent().catch(() => ""));
        });
        if (refusal !== null) {
          // The orphaned field may block Publish: remove it (the guide: remove the field or put the Placeholder back).
          await dialog.getByRole("button", { name: "Cancel" }).click();
          await page.getByRole("button", { name: "Remove Signing date", exact: true }).click();
          await pause(1500);
          await page.getByRole("button", { name: "Publish", exact: true }).first().click();
          await dialog.getByLabel("File version").selectOption({ label: "File version 2" });
          await dialog.getByRole("button", { name: "Publish", exact: true }).click();
          await dialog.waitFor({ state: "hidden", timeout: 15000 });
        }
        await page.getByText("Published", { exact: true }).first().waitFor({ timeout: 15000 });
        await adTab(page, "Overview").click();
        const live = flat(await page.getByText(/^Live since /).textContent());
        await adTab(page, "Form").click();
        await page.getByRole("button", { name: "Placeholder governing_law", exact: true }).first().click();
        const card = page.getByRole("region", { name: "Governing law" });
        await card.getByLabel("Help text").fill("Name the jurisdiction.");
        await card.getByLabel("Help text").press("Enter");
        await pause(1200);
        await adTab(page, "Overview").click();
        const liveAfter = flat(await page.getByText(/^Live since /).textContent());
        const newer = flat(await page.getByText(/newer than the currently published/).textContent());
        expectThat(live === liveAfter, `live changed ${live} -> ${liveAfter}`);
        return `Publish offered file versions ${q(files)} and form versions ${q(forms)} with caption ${q(caption)}${refusal ? `; the first Publish with the orphaned field showed ${q(refusal)}, so Remove Signing date was used as the guide says, then Publish succeeded` : ""}. After Publish with File version 2 the state reads Published and Overview reads ${q(live)}. A later Help text edit left ${q(liveAfter)} and Overview warns ${q(newer)}.`;
      });

    await step(SC, role,
      "Directive disagreement: one name with a date directive and a currency directive becomes a text field, and Publish names the gap",
      "The new field is Text; Publish refuses and names the Placeholder.",
      async () => {
        await page.goto(`${BASE}/auto-docs`);
        await page.getByRole("button", { name: "Create Auto-Doc" }).first().click();
        const dialog = page.getByRole("dialog");
        const n2 = name(SC, `${role === "administrator" ? "Admin" : "Member"} disagreeing directives`);
        await dialog.getByLabel("Name").fill(n2);
        await dialog.getByRole("button", { name: "Create", exact: true }).click();
        await page.waitForURL(/\/auto-docs\/[0-9a-f-]+/, { timeout: 20000 });
        record("auto-doc", n2, { role });
        await adTab(page, "Form").click();
        const { report } = await uploadReport(page, fixture("doc030-disagreeing-directives.docx"));
        await page.getByRole("button", { name: /^Placeholder payment/ }).first().click();
        const type = flat(await page.getByRole("region", { name: "Payment" }).getByLabel("Type").locator("option:checked").innerText());
        await page.getByRole("button", { name: "Publish", exact: true }).first().click();
        const pub = page.getByRole("dialog", { name: "Publish" });
        await pub.getByRole("button", { name: "Publish", exact: true }).click();
        const alert = pub.getByRole("alert");
        await alert.waitFor({ timeout: 15000 });
        const text = flat(await alert.textContent());
        await pub.getByRole("button", { name: "Cancel" }).click();
        expectThat(type === "Text" && /payment\|/.test(text), `type ${type}, refusal ${text}`);
        return `${q(n2)}: upload of {{payment|currency:USD}} and {{payment|date:YYYY-MM-DD}} reported ${q(report)}; the Payment field's Type is ${q(type)}. Publish refused with ${q(text)}.`;
      });
  }

}

// SECTION-MARKER






// =====================================================================
async function main() {
  const browser = await chromium.launch();
  const contexts = [];
  async function contextFor(person) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    contexts.push(ctx);
    const page = await ctx.newPage();
    await browserSignIn(page, person);
    return page;
  }
  results.images = {
    app: imageId(`${PROJECT}-app-1`),
    engine: imageId(`${PROJECT}-doc-engine-1`),
    worker: imageId(`${PROJECT}-worker-1`),
  };
  const admin = await contextFor(PEOPLE.administrator);
  const table = {
    types: () => typesSection(admin),
    documents: () => documentsSection(admin),
    statuses: () => statusesSection(admin),
    fields: () => fieldsSection(admin),
    form: () => formSection(admin),
    officers: () => officersSection(admin),
    access: () => accessSection(browser, contexts),
    forms: () => formsSection(admin, browser, contexts),
    reminders: () => remindersSection(admin, browser, contexts),
    audit: () => auditSection(admin, browser, contexts),
    toolcalls: () => toolCallsSection(admin, browser, contexts),
    autodoc: () => autoDocSection(browser, contexts),
  };
  try {
    for (const s of SECTIONS) {
      if (!table[s]) continue;
      section = s;
      await table[s]();
    }
  } finally {
    save();
    for (const c of contexts) await c.close().catch(() => {});
    await browser.close();
  }
  console.log(JSON.stringify(results.summary));
}
await main();
