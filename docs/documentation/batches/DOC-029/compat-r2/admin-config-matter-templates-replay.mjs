// DOC-029 round 2 compatibility replay of the round 1 admin-config walkthrough
// (admin-config/walkthrough-r1.mjs), run for matter-templates by the
// DOC-029r2 compatibility reviewer (admin-config) against the admin2 lab built from
// 57e77e386be31b2a319f7143dd54d00123e65efe. Only the lab project, record-name prefix,
// output paths, round metadata, and the leftover-link filter (scoped to this prefix) changed.
// Original header:
// DOC-029 round 1 independent browser walkthrough for the admin-config group:
// types-statuses-fields (V-C38), matter-templates (V-C39), request-forms (V-C40),
// and reminders-and-audit (V-C41).
// Written by the DOC-029 independent walkthrough agent (admin-config, round 1). It follows
// the current article text and records what the admin documentation lab showed.
// Run from the repository root:
//   LAB_PASSWORD=... mise exec -- node docs/documentation/batches/DOC-029/admin-config/walkthrough-r1.mjs
// Optional: SECTIONS=types,templates,forms,reminders,audit,access (default: all).
// The seed password comes only from the environment and is never written to the results.
// Sign-in links, cookies, and raw mail are never written to the results.
import { writeFileSync, readFileSync, mkdtempSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const { chromium } = await import(
  path.join(root, "node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs")
);

const BASE = process.env.LAB_APP_URL ?? "http://127.0.0.1:23300";
const MAIL = process.env.LAB_MAIL_URL ?? "http://127.0.0.1:23400";
const PROJECT = process.env.LAB_PROJECT ?? "openlaw-docs-41255c61-admin2";
const PASSWORD = process.env.LAB_PASSWORD;
if (!PASSWORD) throw new Error("LAB_PASSWORD is required");
const ADMIN = { email: "daniel.okafor@helix.example", displayName: "Daniel Okafor" };
const MEMBER = { email: "nadia.haddad@helix.example", displayName: "Nadia Haddad" };
const BUSINESS = { email: "jonas.weber@helix.example", displayName: "Jonas Weber" };
const OUT = process.env.OUT ?? path.join(here, "admin-config-matter-templates-replay.json");
const SHOTS = process.env.SHOTS ?? here;
const SECTIONS = (process.env.SECTIONS ?? "types,templates,forms,reminders,audit,access").split(",");
const stamp = Date.now().toString(36);
const G = `DOC-029r2 admin-config compat`;
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const ARTICLES = ["types-statuses-fields", "matter-templates", "request-forms", "reminders-and-audit"];

function imageId(container) {
  try {
    return execFileSync("docker", ["inspect", "--format", "{{.Image}}", container]).toString().trim();
  } catch {
    return null;
  }
}

const results = {
  kind: "independent-article-walkthrough",
  task: "DOC-029",
  group: "admin-config",
  round: 2,
  issues: [745, 747],
  walkthroughReviewer: "DOC-029r2 compatibility reviewer (admin-config)",
  reviewerKind: "agent",
  articles: ARTICLES.map((id) => ({
    articleId: id,
    articlePath: `docs/user-guides/${id}.md`,
    contentSha256: sha256(path.join(root, `docs/user-guides/${id}.md`)),
  })),
  scenarios: {
    "V-C38": "types-statuses-fields",
    "V-C39": "matter-templates",
    "V-C40": "request-forms",
    "V-C41": "reminders-and-audit",
  },
  appCommit: "57e77e386be31b2a319f7143dd54d00123e65efe",
  labProject: PROJECT,
  images: {
    app: imageId(`${PROJECT}-app-1`),
    engine: imageId(`${PROJECT}-doc-engine-1`),
    worker: imageId(`${PROJECT}-worker-1`),
  },
  appUrl: BASE,
  sections: SECTIONS,
  startedAt: new Date().toISOString(),
  stamp,
  steps: [],
  records: [],
  finishedAt: null,
};
function save() {
  results.finishedAt = new Date().toISOString();
  results.summary = {
    total: results.steps.length,
    pass: results.steps.filter((s) => s.result === "pass").length,
    fail: results.steps.filter((s) => s.result === "fail").length,
  };
  writeFileSync(OUT, JSON.stringify(results, null, 2) + "\n");
}

let currentPage = null;
async function step(scenario, role, action, expected, fn, method = "browser-walkthrough") {
  const entry = {
    scenario,
    role,
    method,
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
        console.error((await currentPage.locator("body").ariaSnapshot()).slice(0, 6000));
      } catch {}
    }
  }
  entry.at = new Date().toISOString();
  console.log(`[${scenario} ${role}] ${entry.result.toUpperCase()} ${action}`);
  save();
  return entry;
}
function expectThat(condition, message) {
  if (!condition) throw new Error(message);
}
const q = (s) => JSON.stringify(s);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, message, timeout = 15000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await pause(300);
  }
  throw new Error(message);
}

async function signIn(page, email, displayName) {
  await page.goto(`${BASE}/auth/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/"), { timeout: 20000 });
  await page.getByRole("banner").getByRole("button", { name: displayName }).waitFor({ timeout: 20000 });
}

async function newestMailId(email) {
  const r = await fetch(
    `${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=1`,
  ).then((x) => x.json());
  return r.messages?.[0]?.ID ?? null;
}
function toLab(href) {
  const u = new URL(href);
  const lab = new URL(BASE);
  u.protocol = lab.protocol;
  u.host = lab.host;
  return u.toString();
}
async function magicLinkSignIn(page, email) {
  const before = await newestMailId(email);
  await page.goto(`${BASE}/portal/login`);
  const magic = page.getByRole("button", { name: "Email me a sign-in link" });
  await magic.waitFor({ timeout: 20000 });
  await magic.click();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send link" }).click();
  await page.getByText("Check your email").first().waitFor({ timeout: 15000 });
  for (let i = 0; i < 60; i++) {
    const id = await newestMailId(email);
    if (id && id !== before) {
      const m = await fetch(`${MAIL}/api/v1/message/${id}`).then((r) => r.json());
      const match = m.Text.match(/https?:\/\/[^\s)\]]+magic-link\/verify[^\s)\]]*/);
      if (match) {
        await page.goto(toLab(match[0]));
        await page.waitForURL((url) => !/\/(auth|portal\/login)/.test(url.pathname), {
          timeout: 30000,
        });
        return;
      }
    }
    await pause(500);
  }
  throw new Error("no fresh sign-in mail");
}

async function api(page, method, url, data) {
  const res = await page.request.fetch(`${BASE}${url}`, {
    method,
    data,
    headers: data ? { "content-type": "application/json" } : undefined,
  });
  let body = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status(), body };
}

// Open Settings from the profile menu, then a section link in the Settings rail.
async function openSettings(page, group, link) {
  await page.goto(`${BASE}/`);
  await page.getByRole("banner").getByRole("button", { name: ADMIN.displayName }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page.waitForURL(/\/settings/);
  const rail = page.getByRole("navigation", { name: "Settings sections" });
  if (link === "Audit log") {
    await rail.getByRole("button", { name: "Security" }).click();
  }
  await rail.getByRole("group", { name: group }).getByRole("link", { name: link, exact: true }).click();
}

function row(page, name) {
  return page.getByRole("listitem").filter({ has: page.getByRole("button", { name: `Rename ${name}`, exact: true }) });
}

// The Attach field menu can open taller than the viewport when the catalog is long,
// so items are chosen with the keyboard (focus the item, press Enter).
async function pickMenuItem(page, name) {
  const item = page.getByRole("menuitem", { name: new RegExp(`^${escapeRe(name)}`) });
  await item.waitFor({ state: "attached" });
  await item.focus();
  await page.keyboard.press("Enter");
}

async function addListRow(page, button, inputLabel, name) {
  await page.getByRole("button", { name: button, exact: true }).click();
  const input = page.getByRole("textbox", { name: inputLabel });
  await input.fill(name);
  await input.press("Enter");
  await page.getByRole("button", { name: `Rename ${name}`, exact: true }).waitFor({ timeout: 15000 });
}

async function renameRow(page, from, to) {
  await page.getByRole("button", { name: `Rename ${from}`, exact: true }).click();
  const input = page.getByRole("textbox", { name: `Rename ${from}`, exact: true });
  await input.fill(to);
  await input.press("Enter");
  await page.getByRole("button", { name: `Rename ${to}`, exact: true }).waitFor({ timeout: 15000 });
}

async function reorderPosition(page, name) {
  const label = await page
    .getByRole("button", { name: new RegExp(`^Reorder ${escapeRe(name)}, position`) })
    .getAttribute("aria-label");
  return Number(label.match(/position (\d+) of/)[1]);
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------- shared state between sections ----------
const S = {};

// =====================================================================
// V-C38 types-statuses-fields
// =====================================================================
async function typesSection(admin, member) {
  const SC = "V-C38";
  const role = "administrator";
  const typeName = `${G} Supplier assessment ${stamp}`;
  const typeRenamed = `${G} Supplier assessment renamed ${stamp}`;
  const replacementType = `${G} Replacement type ${stamp}`;
  const fieldName = `${G} Assessment scope ${stamp}`;
  const fieldTwo = `${G} Assessment note ${stamp}`;
  const contractType = `${G} Contract type ${stamp}`;
  currentPage = admin;

  await step(SC, role, "Add and maintain types, step 1-2: open Settings > Organization > Matters > Types, select Add type, enter a name, press Enter", "The new type row appears in the Matter types list.", async () => {
    await openSettings(admin, "Organization", "Matters");
    await admin.getByRole("navigation", { name: "Matters panes" }).getByRole("link", { name: "Types" }).click();
    await admin.getByRole("heading", { name: "Matter types" }).waitFor();
    await addListRow(admin, "Add type", "New type name", typeName);
    await addListRow(admin, "Add type", "New type name", replacementType);
    const usage = (await row(admin, typeName).innerText()).replace(/\s+/g, " ");
    results.records.push({ kind: "matter type", name: typeName }, { kind: "matter type", name: replacementType });
    return `Profile menu > Settings opened ${new URL(admin.url()).pathname}. Add type with the name ${q(typeName)} and Enter added the row ${q(usage)}. A second type ${q(replacementType)} was added the same way for the archive check.`;
  });

  await step(SC, role, "Step 3: rename the row with Rename; open Edit, change the description, leave the field, check the saved result; the Slug stays fixed", "Rename changes the display name. Edit shows a fixed Slug and saves the description on blur.", async () => {
    await renameRow(admin, typeName, typeRenamed);
    await admin.getByRole("button", { name: `Edit ${typeRenamed}`, exact: true }).click();
    await admin.getByRole("heading", { name: typeRenamed }).waitFor();
    const slugBox = admin.getByRole("textbox", { name: "Slug" });
    const slug = await slugBox.inputValue();
    const slugEditable = await slugBox.isEditable();
    const note = (await admin.getByText(/Slug is immutable/).textContent()).trim();
    const desc = admin.getByRole("textbox", { name: "Description" });
    await desc.fill("DOC-029 fictional supplier assessment type.");
    await desc.press("Tab");
    await pause(1500);
    await admin.reload();
    await admin.getByRole("textbox", { name: "Description" }).waitFor();
    const saved = await admin.getByRole("textbox", { name: "Description" }).inputValue();
    const slugAfter = await admin.getByRole("textbox", { name: "Slug" }).inputValue();
    expectThat(saved === "DOC-029 fictional supplier assessment type.", `description after reload ${q(saved)}`);
    expectThat(!slugEditable, "Slug is editable");
    expectThat(slugAfter === slug, "slug changed after rename");
    expectThat(!slug.includes("renamed"), `slug followed the rename: ${slug}`);
    S.matterTypeUrl = admin.url();
    return `Rename changed the row to ${q(typeRenamed)}. Edit opened ${new URL(admin.url()).pathname} with heading ${q(typeRenamed)}. Slug ${q(slug)} is read-only (editable=${slugEditable}) with the note ${q(note)}; it kept the original name after the rename. The description saved on Tab and read ${q(saved)} after reload.`;
  });

  await step(SC, role, "Step 4: focus a reorder handle and use the arrow keys to change the display order", "The row moves one position and the order persists after reload.", async () => {
    await admin.getByRole("link", { name: "All types" }).click();
    await admin.getByRole("heading", { name: "Matter types" }).waitFor();
    const before = await reorderPosition(admin, typeRenamed);
    await admin.getByRole("button", { name: new RegExp(`^Reorder ${escapeRe(typeRenamed)}, position`) }).focus();
    await admin.keyboard.press("ArrowUp");
    await until(async () => (await reorderPosition(admin, typeRenamed)) === before - 1, "row did not move up");
    await pause(1200);
    await admin.reload();
    await admin.getByRole("heading", { name: "Matter types" }).waitFor();
    const after = await reorderPosition(admin, typeRenamed);
    expectThat(after === before - 1, `after reload position ${after}, before ${before}`);
    const other = await admin.getByRole("img", { name: "Other is system-protected and can't be archived" }).count();
    expectThat(other === 1, "Other lock not shown");
    return `The handle for ${q(typeRenamed)} was at position ${before}. ArrowUp moved it to position ${after}, and it stayed there after reload. Other shows the lock image "Other is system-protected and can't be archived" and has no Archive control.`;
  });

  await step(SC, role, "Step 1-2 for the other modules: Contracts, Entities, and Knowledge Types each accept Add type; Edit exists only where the article says it may", "Contracts and Entities rows have Edit; Knowledge rows have none.", async () => {
    const out = [];
    for (const [link, heading, pane] of [
      ["Contracts", "Contract types", "Contracts panes"],
      ["Entities", "Entity types", "Entities panes"],
      ["Knowledge", "Knowledge types", "Knowledge panes"],
    ]) {
      await openSettings(admin, "Organization", link);
      await admin.getByRole("navigation", { name: pane }).getByRole("link", { name: "Types" }).click();
      await admin.getByRole("heading", { name: heading }).waitFor();
      const name = link === "Contracts" ? contractType : `${G} ${link} type ${stamp}`;
      await addListRow(admin, "Add type", "New type name", name);
      const edit = await admin.getByRole("button", { name: `Edit ${name}`, exact: true }).count();
      results.records.push({ kind: `${link} type`, name });
      out.push(`${link}: added ${q(name)}, Edit control ${edit ? "present" : "absent"}`);
      if (link === "Knowledge") expectThat(edit === 0, "Knowledge row has Edit");
      else expectThat(edit === 1, `${link} row has no Edit`);
      if (link !== "Contracts") {
        await admin.getByRole("button", { name: `Archive ${name}`, exact: true }).click();
        const dialog = admin.getByRole("dialog");
        const text = (await dialog.innerText()).replace(/\s+/g, " ");
        await dialog.getByRole("button", { name: /^Archive/ }).click();
        await dialog.waitFor({ state: "hidden" });
        out.push(`archived the unused probe type; the dialog read ${q(text.slice(0, 160))}`);
      }
    }
    return out.join(". ") + ".";
  });

  await step(SC, role, "Create a Field, steps 1-5: Matters > Fields > Add field with Name, Description, Type, Scope, Tag, and Options", "The Type list matches the article order; the new Field row shows its Type, Scope, and Tag.", async () => {
    await openSettings(admin, "Organization", "Matters");
    await admin.getByRole("navigation", { name: "Matters panes" }).getByRole("link", { name: "Fields" }).click();
    await admin.getByRole("heading", { name: "Fields" }).waitFor();
    await admin.getByRole("button", { name: "Add field" }).click();
    const d = admin.getByRole("dialog", { name: "Add field" });
    const types = (await d.getByLabel("Type").locator("option").allInnerTexts()).filter((t) => t !== "Type…");
    const expectedTypes = ["Text", "Long text", "Number", "Currency", "Date", "Boolean", "Single select", "Multi select", "User", "Entity"];
    expectThat(q(types) === q(expectedTypes), `Type list ${q(types)}`);
    const scopes = await d.getByLabel("Scope").locator("option").allInnerTexts();
    const tags = await d.getByLabel("Tag").locator("option").allInnerTexts();
    await d.getByLabel("Name").fill(fieldName);
    await d.getByLabel("Description").fill("Which part of the supplier the assessment covers.");
    await d.getByLabel("Type").selectOption({ label: "Single select" });
    await d.getByLabel("Scope").selectOption({ label: "Matter" });
    await d.getByLabel("Tag").selectOption({ label: "Legal" });
    await d.getByLabel("Options").fill("Security\nPrivacy\nFinance");
    await d.getByRole("button", { name: "Add field" }).click();
    await d.waitFor({ state: "hidden" });
    await admin.getByRole("button", { name: `Rename ${fieldName}`, exact: true }).waitFor();
    const rowText = (await row(admin, fieldName).innerText()).replace(/\s+/g, " ");
    expectThat(/Single select/.test(rowText) && /Matter/.test(rowText) && /Legal/.test(rowText), `row ${rowText}`);
    // A second Text field for the attachment order check.
    await admin.getByRole("button", { name: "Add field" }).click();
    await d.getByLabel("Name").fill(fieldTwo);
    await d.getByLabel("Type").selectOption({ label: "Text" });
    await d.getByRole("button", { name: "Add field" }).click();
    await d.waitFor({ state: "hidden" });
    await admin.getByRole("button", { name: `Rename ${fieldTwo}`, exact: true }).waitFor();
    const handles = await admin.getByRole("button", { name: /^Reorder / }).count();
    expectThat(handles === 0, `Field catalog has ${handles} reorder handles`);
    await admin.getByRole("button", { name: `Edit ${fieldName}`, exact: true }).click();
    const e = admin.getByRole("dialog", { name: `Edit ${fieldName}` });
    const typeCombo = await e.getByRole("combobox", { name: "Type" }).count();
    const typeText = (await e.getByText("The field type is immutable after creation.").textContent()).trim();
    const options = await e.getByLabel("Options").inputValue();
    await e.getByRole("button", { name: "Cancel" }).click();
    expectThat(typeCombo === 0, "Edit offers a Type control");
    results.records.push({ kind: "field", name: fieldName }, { kind: "field", name: fieldTwo });
    return `Type offered ${q(types)}, Scope ${q(scopes)}, Tag ${q(tags)}. Add field created the row ${q(rowText)}. A second Text Field ${q(fieldTwo)} was added. The Field catalog shows 0 reorder handles. Edit shows no Type control and reads ${q(typeText)}; Options read ${q(options)}.`;
  });

  await step(SC, role, "Attach Fields and set requiredness, steps 1-3: Types > Edit > Attach field, turn on Required, reorder the attached Fields", "Both Fields attach; Required saves; keyboard reorder changes the attached order.", async () => {
    await admin.goto(S.matterTypeUrl);
    await admin.getByRole("heading", { name: "Attached fields" }).waitFor();
    for (const name of [fieldName, fieldTwo]) {
      await admin.getByRole("button", { name: "Attach field" }).click();
      await pickMenuItem(admin, name);
      await admin.getByRole("list", { name: "Attached fields" }).getByText(name).waitFor();
    }
    const req = admin.getByRole("checkbox", { name: `${fieldName} required` });
    await req.click();
    await until(async () => (await req.isChecked()) && (await req.isEnabled()), "Required did not save");
    await pause(800);
    const list = admin.getByRole("list", { name: "Attached fields" });
    const before = await list.getByRole("button", { name: /^Reorder / }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    await admin.getByRole("button", { name: new RegExp(`^Reorder ${escapeRe(fieldTwo)}, position`) }).focus();
    await admin.keyboard.press("ArrowUp");
    await pause(1500);
    await admin.reload();
    await admin.getByRole("heading", { name: "Attached fields" }).waitFor();
    const after = await admin.getByRole("list", { name: "Attached fields" }).getByRole("button", { name: /^Reorder / }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    const checked = await admin.getByRole("checkbox", { name: `${fieldName} required` }).isChecked();
    expectThat(checked, "Required did not persist");
    expectThat(after[0].includes(fieldTwo), `order after reload ${q(after)}`);
    return `Attach field listed both new Fields; both attached. Required was on for ${q(fieldName)} after reload. Order before ${q(before)}; after ArrowUp and reload ${q(after)}.`;
  });

  await step(SC, role, "Step 4: create a fictional Matter of this type, first leaving the required Field empty, then with a valid value", "Creation is refused without the required Field and accepted with it; the record holds the value.", async () => {
    await admin.goto(`${BASE}/matters`);
    await admin.getByRole("button", { name: /Create matter|New matter/ }).first().click();
    const d = admin.getByRole("dialog", { name: "Create matter" });
    const title = `${G} Supplier matter ${stamp}`;
    await d.getByLabel("Title").fill(title);
    await d.getByLabel("Matter type").selectOption({ label: typeRenamed });
    await pause(800);
    await d.getByRole("button", { name: "Create" }).click();
    await pause(1500);
    const stillOpen = await d.isVisible();
    const refusal = stillOpen
      ? (await d.locator('[role="alert"]').allInnerTexts()).map((t) => t.trim()).filter(Boolean)
      : null;
    const invalid = await d.locator('[aria-invalid="true"]').evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") || e.id));
    expectThat(stillOpen, "Matter was created without the required Field");
    const fieldControl = d.getByLabel(new RegExp(escapeRe(fieldName)));
    await fieldControl.first().selectOption({ label: "Privacy" });
    await d.getByRole("button", { name: "Create" }).click();
    await admin.waitForURL(/\/matters\/\d+/, { timeout: 20000 });
    const number = admin.url().match(/\/matters\/(\d+)/)[1];
    S.matterNumber = number;
    S.matterTitle = title;
    await pause(1500);
    const main = (await admin.locator("main").innerText()).replace(/\s+/g, " ");
    expectThat(main.includes(fieldName) && main.includes("Privacy"), "Overview does not show the Field value");
    results.records.push({ kind: "matter", name: title, number });
    return `With ${q(fieldName)} empty, Create left the dialog open; alerts ${q(refusal)}; invalid controls ${q(invalid)}. With Privacy chosen, Create opened M-${number}, whose Overview shows ${q(fieldName)} with Privacy.`;
  });

  await step(SC, role, "Global Fields: promote the Field to Global in Edit, attach it to a Contract type, then try to narrow it back to Matter", "Promotion saves. Narrowing is refused while the Contract type attaches it and allowed after Detach.", async () => {
    await openSettings(admin, "Organization", "Matters");
    await admin.getByRole("navigation", { name: "Matters panes" }).getByRole("link", { name: "Fields" }).click();
    await admin.getByRole("button", { name: `Edit ${fieldName}`, exact: true }).click();
    let e = admin.getByRole("dialog", { name: `Edit ${fieldName}` });
    await e.getByLabel("Scope").selectOption({ label: "Global" });
    await e.getByRole("button", { name: "Save" }).click();
    await e.waitFor({ state: "hidden" });
    const promoted = (await row(admin, fieldName).innerText()).replace(/\s+/g, " ");
    expectThat(/Global/.test(promoted), `row after promote ${promoted}`);
    // Attach to the Contract type.
    await openSettings(admin, "Organization", "Contracts");
    await admin.getByRole("button", { name: `Edit ${contractType}`, exact: true }).click();
    await admin.getByRole("heading", { name: "Attached fields" }).waitFor();
    S.contractTypeUrl = admin.url();
    await admin.getByRole("button", { name: "Attach field" }).click();
    await pickMenuItem(admin, fieldName);
    await admin.getByRole("list", { name: "Attached fields" }).getByText(fieldName).waitFor();
    // Narrow back.
    await openSettings(admin, "Organization", "Matters");
    await admin.getByRole("navigation", { name: "Matters panes" }).getByRole("link", { name: "Fields" }).click();
    await admin.getByRole("button", { name: `Edit ${fieldName}`, exact: true }).click();
    e = admin.getByRole("dialog", { name: `Edit ${fieldName}` });
    await e.getByLabel("Scope").selectOption({ label: "Matter" });
    await e.getByRole("button", { name: "Save" }).click();
    const alert = e.getByRole("alert");
    await alert.waitFor({ timeout: 15000 });
    const refusal = (await alert.innerText()).trim();
    await e.getByRole("button", { name: "Cancel" }).click();
    await admin.reload();
    const stillGlobal = (await row(admin, fieldName).innerText()).replace(/\s+/g, " ");
    expectThat(/Global/.test(stillGlobal), `row after refused narrow ${stillGlobal}`);
    // Detach from the Contract type, then narrowing is allowed.
    await admin.goto(S.contractTypeUrl);
    await admin.getByRole("button", { name: `Detach ${fieldName}` }).click();
    const confirm = admin.getByRole("dialog");
    if (await confirm.isVisible().catch(() => false)) {
      await confirm.getByRole("button", { name: /Detach/ }).click();
    }
    await until(async () => (await admin.getByRole("list", { name: "Attached fields" }).getByText(fieldName).count()) === 0, "Field still attached to the Contract type");
    await openSettings(admin, "Organization", "Matters");
    await admin.getByRole("navigation", { name: "Matters panes" }).getByRole("link", { name: "Fields" }).click();
    await admin.getByRole("button", { name: `Edit ${fieldName}`, exact: true }).click();
    e = admin.getByRole("dialog", { name: `Edit ${fieldName}` });
    await e.getByLabel("Scope").selectOption({ label: "Matter" });
    await e.getByRole("button", { name: "Save" }).click();
    await e.waitFor({ state: "hidden" });
    const narrowed = (await row(admin, fieldName).innerText()).replace(/\s+/g, " ");
    expectThat(/Scope: Matter/.test(narrowed), `row after narrow ${narrowed}`);
    return `Edit > Scope Global saved; the row read ${q(promoted)}. The Field attached to Contract type ${q(contractType)}. Narrowing to Matter was refused with ${q(refusal)} and the row stayed Global. After Detach on the Contract type, narrowing saved and the row read ${q(narrowed)}.`;
  });

  await step(SC, role, "Detach and Archive keep stored values: detach the Field from the Matter type, archive it in the catalog, then Show archived and Restore", "The definition stays in the catalog after Detach; the Matter keeps its stored value; Archive hides the Field; Restore brings it back.", async () => {
    await admin.goto(S.matterTypeUrl);
    await admin.getByRole("heading", { name: "Attached fields" }).waitFor();
    await admin.getByRole("button", { name: `Detach ${fieldTwo}` }).click();
    const confirm = admin.getByRole("dialog");
    if (await confirm.isVisible().catch(() => false)) await confirm.getByRole("button", { name: /Detach/ }).click();
    await until(async () => (await admin.getByRole("list", { name: "Attached fields" }).getByText(fieldTwo).count()) === 0, "not detached");
    await openSettings(admin, "Organization", "Matters");
    await admin.getByRole("navigation", { name: "Matters panes" }).getByRole("link", { name: "Fields" }).click();
    await admin.getByRole("button", { name: `Rename ${fieldName}`, exact: true }).waitFor();
    const inCatalog = await admin.getByRole("button", { name: `Rename ${fieldTwo}`, exact: true }).count();
    expectThat(inCatalog === 1, "detached Field left the catalog");
    // Archive the required, attached Field with a stored value.
    await admin.getByRole("button", { name: `Archive ${fieldName}`, exact: true }).click();
    const d = admin.getByRole("dialog");
    const text = (await d.innerText()).replace(/\s+/g, " ");
    await d.getByRole("button", { name: /^Archive/ }).click();
    await d.waitFor({ state: "hidden" });
    await until(async () => (await admin.getByRole("button", { name: `Rename ${fieldName}`, exact: true }).count()) === 0, "archived Field still listed");
    const matter = await api(admin, "GET", `/api/v1/matters/${S.matterNumber}`);
    const stored = Object.values(matter.body?.matter?.customFields ?? {}).includes("Privacy");
    expectThat(stored, "stored value missing while the Field is archived");
    const attachedWhileArchived = await (async () => {
      await admin.goto(S.matterTypeUrl);
      await admin.getByRole("heading", { name: "Attached fields" }).waitFor();
      return (await admin.getByRole("list", { name: "Attached fields" }).innerText()).replace(/\s+/g, " ");
    })();
    await openSettings(admin, "Organization", "Matters");
    await admin.getByRole("navigation", { name: "Matters panes" }).getByRole("link", { name: "Fields" }).click();
    await admin.getByRole("switch", { name: "Show archived" }).click();
    await admin.getByRole("button", { name: `Restore ${fieldName}`, exact: true }).click();
    await admin.getByRole("button", { name: `Archive ${fieldName}`, exact: true }).waitFor({ timeout: 15000 });
    await admin.getByRole("switch", { name: "Show archived" }).click();
    await admin.goto(`${BASE}/matters/${S.matterNumber}`);
    await pause(2000);
    const main = (await admin.locator("main").innerText()).replace(/\s+/g, " ");
    expectThat(main.includes("Privacy"), "Matter lost the value after archive and restore");
    return `Detach removed ${q(fieldTwo)} from the type; it stayed in the Field catalog. The Archive dialog read ${q(text.slice(0, 200))}; the Field left the live list. While archived, GET /api/v1/matters/${S.matterNumber} answered ${matter.status} and ${stored ? "still held" : "did not show"} the Privacy value, and the type editor's Attached fields read ${q(attachedWhileArchived.slice(0, 200))}. Show archived > Restore made the Field live again, and M-${S.matterNumber} still shows Privacy.`;
  });

  await step(SC, role, "Archive an in-use type: read the usage count, try without a replacement, then choose the live replacement; Restore does not move the Matter back", "The dialog names the usage count; archive without a replacement is refused; with a replacement the Matter moves; Restore leaves it on the replacement.", async () => {
    await openSettings(admin, "Organization", "Matters");
    await admin.getByRole("button", { name: `Archive ${typeRenamed}`, exact: true }).click();
    const d = admin.getByRole("dialog", { name: `Archive ${typeRenamed}` });
    const text = (await d.innerText()).replace(/\s+/g, " ");
    const select = d.getByRole("combobox");
    const options = await select.locator("option").allInnerTexts();
    const archiveBtn = d.getByRole("button", { name: "Archive type" });
    let noReplacement;
    if (await archiveBtn.isEnabled()) {
      await archiveBtn.click();
      await pause(2000);
      const open = await d.isVisible();
      const dialogText = open ? (await d.innerText()).replace(/\s+/g, " ") : null;
      const typeRow = await api(admin, "GET", `/api/v1/matters/${S.matterNumber}`);
      noReplacement = `Archive type with "No reassignment" left the dialog open=${open}, dialog text now ${q(dialogText?.slice(0, 300))}; M-${S.matterNumber} still has type ${q(typeRow.body?.matter?.matterTypeName)}`;
      expectThat(await d.isVisible(), "archive without replacement closed the dialog");
    } else {
      noReplacement = "Archive type was disabled";
    }
    expectThat(!options.includes(typeRenamed), "the type offers itself as replacement");
    await select.selectOption({ label: replacementType });
    await archiveBtn.click();
    await d.waitFor({ state: "hidden", timeout: 15000 });
    const after = await api(admin, "GET", `/api/v1/matters/${S.matterNumber}`);
    await admin.goto(`${BASE}/matters/${S.matterNumber}`);
    await admin.getByRole("combobox", { name: "Matter type" }).waitFor();
    const typeNow = await admin.getByRole("combobox", { name: "Matter type" }).locator("option:checked").innerText();
    expectThat(typeNow === replacementType, `Matter type is ${typeNow}`);
    await openSettings(admin, "Organization", "Matters");
    await admin.getByRole("switch", { name: "Show archived" }).click();
    await admin.getByRole("button", { name: `Restore ${typeRenamed}`, exact: true }).click();
    await admin.getByRole("button", { name: `Archive ${typeRenamed}`, exact: true }).waitFor({ timeout: 15000 });
    await admin.goto(`${BASE}/matters/${S.matterNumber}`);
    await admin.getByRole("combobox", { name: "Matter type" }).waitFor();
    const typeAfterRestore = await admin.getByRole("combobox", { name: "Matter type" }).locator("option:checked").innerText();
    expectThat(typeAfterRestore === replacementType, `after restore the Matter type is ${typeAfterRestore}`);
    return `The dialog read ${q(text.slice(0, 220))}. Replacement choices: ${q(options)}. Without a replacement: ${noReplacement}. With ${q(replacementType)} chosen, Archive type closed the dialog and M-${S.matterNumber} shows Matter type ${q(typeNow)}. Show archived > Restore made ${q(typeRenamed)} live again; M-${S.matterNumber} still shows ${q(typeAfterRestore)}.`;
  });

  await step(SC, role, "Configure Statuses: add a Contract Status with a Stage, rename it, and check the protected and in-use rows", "The new row keeps its Stage after rename; no control changes the Stage; Draft, Active, and Expired are protected; an in-use Status cannot be archived from the dialog.", async () => {
    await openSettings(admin, "Organization", "Contracts");
    await admin.getByRole("navigation", { name: "Contracts panes" }).getByRole("link", { name: "Statuses" }).click();
    await admin.getByRole("heading", { name: "Contract statuses" }).waitFor();
    const name = `${G} Legal check ${stamp}`;
    const renamed = `${G} Legal check renamed ${stamp}`;
    await admin.getByRole("button", { name: "Add status" }).click();
    const stages = await admin.getByRole("combobox", { name: "New status stage" }).locator("option").allInnerTexts();
    await admin.getByRole("combobox", { name: "New status stage" }).selectOption({ label: "Review" });
    const input = admin.getByRole("textbox", { name: "New status name" });
    await input.fill(name);
    await input.press("Enter");
    await admin.getByRole("button", { name: `Rename ${name}`, exact: true }).waitFor({ timeout: 15000 });
    await renameRow(admin, name, renamed);
    await admin.reload();
    await admin.getByRole("button", { name: `Rename ${renamed}`, exact: true }).waitFor();
    const r = (await row(admin, renamed).innerText()).replace(/\s+/g, " ");
    const combos = await row(admin, renamed).getByRole("combobox").count();
    expectThat(/Stage: Review/.test(r), `row ${r}`);
    expectThat(combos === 0, "a Stage control is on the row");
    const locks = [];
    for (const n of ["Draft", "Active", "Expired"]) locks.push(await admin.getByRole("img", { name: `${n} is system-protected and can't be archived` }).count());
    expectThat(locks.every((c) => c === 1), `locks ${q(locks)}`);
    // An in-use custom Status.
    const inUse = admin.getByRole("listitem").filter({ hasText: /Stage: \w+\s*[1-9]\d* contracts?/ }).filter({ has: admin.getByRole("button", { name: /^Archive / }) }).first();
    const inUseName = (await inUse.getByRole("button", { name: /^Rename / }).getAttribute("aria-label")).replace(/^Rename /, "");
    await inUse.getByRole("button", { name: /^Archive / }).click();
    const d = admin.getByRole("dialog");
    const dtext = (await d.innerText()).replace(/\s+/g, " ");
    const disabled = await d.getByRole("button", { name: "Archive status" }).isDisabled();
    const selects = await d.getByRole("combobox").count();
    await d.getByRole("button", { name: "Cancel" }).click();
    expectThat(disabled && selects === 0, "in-use Contract Status dialog allowed archive or offered reassignment");
    // Archive the unused new Status.
    await admin.getByRole("button", { name: `Archive ${renamed}`, exact: true }).click();
    await admin.getByRole("dialog").getByRole("button", { name: "Archive status" }).click();
    await admin.getByRole("dialog").waitFor({ state: "hidden" });
    results.records.push({ kind: "contract status (archived)", name: renamed });
    return `Stage choices: ${q(stages)}. The new Status ${q(name)} was added with Review and Enter, renamed to ${q(renamed)}, and after reload the row reads ${q(r)} with no Stage control. Draft, Active, and Expired show the protected lock. Archive on the in-use Status ${q(inUseName)} read ${q(dtext)} with Archive status disabled and no reassignment select. The unused new Status archived.`;
  });

  await step(SC, role, "Configure Statuses: add Matter Statuses in the Open Category with and without a group, rename, change the group on the row, and archive an in-use Status with a same-Category replacement", "A new Open Status uses In progress unless another group is chosen; rename keeps Category and group; the archive replacement lists only same-Category Statuses and the Matter moves.", async () => {
    await openSettings(admin, "Organization", "Matters");
    await admin.getByRole("navigation", { name: "Matters panes" }).getByRole("link", { name: "Statuses" }).click();
    await admin.getByRole("heading", { name: "Matter statuses" }).waitFor();
    const a = `${G} Waiting on supplier ${stamp}`;
    const aRenamed = `${G} Waiting on supplier renamed ${stamp}`;
    const b = `${G} Default group ${stamp}`;
    await admin.getByRole("button", { name: "Add status" }).click();
    const cats = await admin.getByRole("combobox", { name: "New status category" }).locator("option").allInnerTexts();
    await admin.getByRole("combobox", { name: "New status category" }).selectOption({ label: "Open" });
    const groupCombo = admin.getByRole("combobox", { name: "New status group" });
    const groups = await groupCombo.locator("option").allInnerTexts();
    const defaultGroup = await groupCombo.locator("option:checked").innerText();
    await groupCombo.selectOption({ label: "Waiting" });
    let input = admin.getByRole("textbox", { name: "New status name" });
    await input.fill(a);
    await input.press("Enter");
    await admin.getByRole("button", { name: `Rename ${a}`, exact: true }).waitFor({ timeout: 15000 });
    await admin.getByRole("button", { name: "Add status" }).click();
    await admin.getByRole("combobox", { name: "New status category" }).selectOption({ label: "Open" });
    input = admin.getByRole("textbox", { name: "New status name" });
    await input.fill(b);
    await input.press("Enter");
    await admin.getByRole("button", { name: `Rename ${b}`, exact: true }).waitFor({ timeout: 15000 });
    await renameRow(admin, a, aRenamed);
    await admin.reload();
    await admin.getByRole("button", { name: `Rename ${aRenamed}`, exact: true }).waitFor();
    const aGroup = await admin.getByRole("combobox", { name: `Group for ${aRenamed}` }).locator("option:checked").innerText();
    const bGroup = await admin.getByRole("combobox", { name: `Group for ${b}` }).locator("option:checked").innerText();
    expectThat(defaultGroup === "In progress" && bGroup === "In progress", `default group ${defaultGroup}/${bGroup}`);
    expectThat(aGroup === "Waiting", `renamed group ${aGroup}`);
    await admin.getByRole("combobox", { name: `Group for ${b}` }).selectOption({ label: "Open" });
    await pause(1500);
    await admin.reload();
    await admin.getByRole("button", { name: `Rename ${b}`, exact: true }).waitFor();
    const bGroupAfter = await admin.getByRole("combobox", { name: `Group for ${b}` }).locator("option:checked").innerText();
    expectThat(bGroupAfter === "Open", `group change did not persist: ${bGroupAfter}`);
    const locks = [await admin.getByRole("img", { name: "Open is system-protected and can't be archived" }).count(), await admin.getByRole("img", { name: "Closed is system-protected and can't be archived" }).count()];
    expectThat(locks.every((c) => c === 1), "Open/Closed not protected");
    // Put the fictional Matter on status a, through the record's status control.
    const statuses = await api(admin, "GET", `/api/v1/matter-statuses`);
    const list = statuses.body?.matterStatuses ?? [];
    const target = (Array.isArray(list) ? list : []).find((s) => s.displayName === aRenamed);
    expectThat(target, `status ${aRenamed} not found in API list (${statuses.status})`);
    await admin.goto(`${BASE}/matters/${S.matterNumber}`);
    await admin.getByRole("button", { name: "Waiting — move matter" }).click();
    const menuItems = await admin.getByRole("menu").getByRole("menuitemradio").allInnerTexts();
    await admin.getByRole("menu").getByRole("menuitemradio", { name: aRenamed }).click();
    const moved = `the Waiting group menu, which listed ${q(menuItems)}`;
    await until(async () => {
      const m = await api(admin, "GET", `/api/v1/matters/${S.matterNumber}`);
      return m.body?.matter?.statusId === target.id;
    }, `M-${S.matterNumber} did not move to ${aRenamed}`);
    await openSettings(admin, "Organization", "Matters");
    await admin.getByRole("navigation", { name: "Matters panes" }).getByRole("link", { name: "Statuses" }).click();
    await admin.getByRole("button", { name: `Archive ${aRenamed}`, exact: true }).click();
    const d = admin.getByRole("dialog", { name: `Archive ${aRenamed}` });
    const dtext = (await d.innerText()).replace(/\s+/g, " ");
    const options = await d.getByRole("combobox").locator("option").allInnerTexts();
    const disabledBefore = await d.getByRole("button", { name: "Archive status" }).isDisabled();
    expectThat(disabledBefore, "Archive status enabled without a replacement");
    expectThat(!options.includes("Closed"), `replacement list includes Closed: ${q(options)}`);
    await d.getByRole("combobox").selectOption({ label: b });
    await d.getByRole("button", { name: "Archive status" }).click();
    await d.waitFor({ state: "hidden", timeout: 15000 });
    const bId = (Array.isArray(list) ? list : []).find((s) => s.displayName === b)?.id;
    const after = await api(admin, "GET", `/api/v1/matters/${S.matterNumber}`);
    expectThat(bId && after.body?.matter?.statusId === bId, "Matter did not move to the replacement Status");
    results.records.push({ kind: "matter status (archived)", name: aRenamed }, { kind: "matter status", name: b });
    return `Category choices ${q(cats)}; with Open chosen the group select offered ${q(groups)} and started at ${q(defaultGroup)}. ${q(a)} was added with Waiting; ${q(b)} was added without choosing a group and reads ${q(bGroup)}. After rename and reload ${q(aRenamed)} keeps group ${q(aGroup)}. Changing ${q(b)}'s row group to Open persisted after reload. Open and Closed show the protected lock. M-${S.matterNumber} was moved to ${q(aRenamed)} from the record's status control (${moved}). Its Archive dialog read ${q(dtext.slice(0, 160))} with Archive status disabled until a replacement was chosen; replacements offered ${q(options)} (no Closed-Category Status). Choosing ${q(b)} archived it and the Matter now carries ${q(b)}.`;
  });

  await step(SC, role, "Maintain Officer roles: Add role, Rename, reorder; archive an in-use role that has a current and a resigned Officer, choose the replacement and confirm Archive role; Restore does not reverse it", "The usage count includes the resigned Officer; both entries move to the replacement; Other cannot be archived; Restore leaves them on the replacement.", async () => {
    await openSettings(admin, "Organization", "Entities");
    await admin.getByRole("navigation", { name: "Entities panes" }).getByRole("link", { name: "Officer roles" }).click();
    await admin.getByRole("heading", { name: "Officer roles" }).waitFor();
    const roleName = `${G} Board observer ${stamp}`;
    const roleRenamed = `${G} Board observer renamed ${stamp}`;
    await addListRow(admin, "Add role", "New role name", roleName);
    await renameRow(admin, roleName, roleRenamed);
    const before = await reorderPosition(admin, roleRenamed);
    await admin.getByRole("button", { name: new RegExp(`^Reorder ${escapeRe(roleRenamed)}, position`) }).focus();
    await admin.keyboard.press("ArrowUp");
    await until(async () => (await reorderPosition(admin, roleRenamed)) === before - 1, "role did not move");
    const otherLock = await admin.getByRole("img", { name: "Other is system-protected and can't be archived" }).count();
    expectThat(otherLock === 1, "Other role not protected");
    // Fictional Entity with one current and one resigned Officer in this role.
    const entityName = `${G} Officer Holdings ${stamp}`;
    await admin.goto(`${BASE}/entities`);
    await admin.getByRole("button", { name: "Add entity" }).click();
    const ed = admin.getByRole("dialog", { name: "Add entity" });
    await ed.getByLabel("Legal name").fill(entityName);
    await ed.getByLabel("Entity type").selectOption({ label: "Corporation" });
    const created = admin.waitForResponse((r) => r.request().method() === "POST" && /\/api\/v1\/entities$/.test(r.url()));
    await ed.getByRole("button", { name: "Register" }).click();
    const createdBody = await (await created).json();
    const entityId = createdBody?.entity?.id ?? createdBody?.id;
    expectThat(entityId, "no Entity id in the Register response");
    S.entityUrl = `${BASE}/entities/${entityId}`;
    results.records.push({ kind: "entity", name: entityName, id: entityId });
    await admin.goto(S.entityUrl);
    const officersRegion = admin.getByRole("region", { name: "Directors & Officers" });
    for (const [person, resigned] of [
      ["DOC-029 Fictional Current Observer", null],
      ["DOC-029 Fictional Former Observer", "2026-03-31"],
    ]) {
      await officersRegion.getByRole("button", { name: "Add director or officer" }).click();
      await officersRegion.getByLabel("Director or officer name", { exact: true }).fill(person);
      await officersRegion.getByLabel("Role", { exact: true }).selectOption({ label: roleRenamed });
      await officersRegion.getByLabel("Appointed on", { exact: true }).fill("2025-01-15");
      await officersRegion.getByRole("button", { name: "Add", exact: true }).click();
      const resignedBox = officersRegion.getByRole("textbox", { name: `${person} Resigned on` });
      await resignedBox.waitFor({ timeout: 15000 });
      if (resigned) {
        await resignedBox.fill(resigned);
        const saved = admin.waitForResponse((r) => r.request().method() === "PATCH" && /\/officers\//.test(r.url()));
        // Leave the date field by selecting the card heading; Tab only moves between date segments.
        await officersRegion.getByRole("heading", { name: "Directors & Officers" }).click();
        expectThat((await saved).ok(), "resignation date did not save");
      }
    }
    await openSettings(admin, "Organization", "Entities");
    await admin.getByRole("navigation", { name: "Entities panes" }).getByRole("link", { name: "Officer roles" }).click();
    await admin.getByRole("button", { name: `Rename ${roleRenamed}`, exact: true }).waitFor();
    const usage = (await row(admin, roleRenamed).innerText()).replace(/\s+/g, " ");
    await admin.getByRole("button", { name: `Archive ${roleRenamed}`, exact: true }).click();
    const d = admin.getByRole("dialog", { name: `Archive ${roleRenamed}` });
    const dtext = (await d.innerText()).replace(/\s+/g, " ");
    await d.getByRole("combobox").selectOption({ label: "Director" }).catch(async () => {
      await d.getByRole("combobox").selectOption({ label: "Other" });
    });
    const replacement = await d.getByRole("combobox").locator("option:checked").innerText();
    await d.getByRole("button", { name: "Archive role" }).click();
    await d.waitFor({ state: "hidden", timeout: 15000 });
    await admin.getByRole("switch", { name: "Show archived" }).click();
    await admin.getByRole("button", { name: `Restore ${roleRenamed}`, exact: true }).click();
    await admin.getByRole("button", { name: `Archive ${roleRenamed}`, exact: true }).waitFor({ timeout: 15000 });
    const usageAfterRestore = (await row(admin, roleRenamed).innerText()).replace(/\s+/g, " ");
    await admin.goto(S.entityUrl);
    const region = admin.getByRole("region", { name: "Directors & Officers" });
    await region.getByRole("combobox", { name: / Role$/ }).first().waitFor();
    const currentOnly = await region.getByRole("combobox", { name: / Role$/ }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    expectThat(currentOnly.length === 1, `current Officers ${q(currentOnly)}`);
    await region.getByRole("checkbox", { name: "Show former" }).check();
    await pause(1500);
    const roles = await region.getByRole("combobox", { name: / Role$/ }).evaluateAll((els) => els.map((e) => `${e.getAttribute("aria-label")}: ${e.selectedOptions[0]?.textContent}`));
    expectThat(/2 officers/.test(usage), `usage before archive ${usage}`);
    expectThat(roles.length === 2 && roles.every((r) => r.endsWith(`: ${replacement}`)), `officer roles ${q(roles)}`);
    expectThat(/0 officers/.test(usageAfterRestore), `usage after restore ${usageAfterRestore}`);
    results.records.push({ kind: "officer role", name: roleRenamed });
    return `Add role created ${q(roleName)}; Rename changed it to ${q(roleRenamed)}; ArrowUp on its handle moved it from position ${before} to ${before - 1}. Other shows the protected lock. On the fictional Entity ${q(entityName)} one current and one resigned Officer were added with this role; the role row then read ${q(usage)}. The Archive dialog read ${q(dtext.slice(0, 200))}. With replacement ${q(replacement)}, Archive role closed the dialog. Show archived > Restore made the role live; its row reads ${q(usageAfterRestore)}, so the reassignment was not reversed. Without Show former the Entity lists only ${q(currentOnly)}; with Show former on, the Directors & Officers roles read ${q(roles)}.`;
  });
}

// =====================================================================
// V-C40 request-forms
// =====================================================================
async function createTypeWithFields(admin, module, name, fieldNames) {
  const link = module === "matter" ? "Matters" : "Contracts";
  await openSettings(admin, "Organization", link);
  await admin.getByRole("button", { name: "Add type" }).waitFor();
  await addListRow(admin, "Add type", "New type name", name);
  await admin.getByRole("button", { name: `Edit ${name}`, exact: true }).click();
  await admin.getByRole("heading", { name: "Attached fields" }).waitFor();
  for (const f of fieldNames) {
    await admin.getByRole("button", { name: "Attach field" }).click();
    await pickMenuItem(admin, f);
    await admin.getByRole("list", { name: "Attached fields" }).getByText(f, { exact: true }).waitFor();
  }
  results.records.push({ kind: `${module} type`, name, attached: fieldNames });
  return admin.url();
}
async function createField(admin, { name, type, scope }) {
  await openSettings(admin, "Organization", "Matters");
  await admin.getByRole("navigation", { name: "Matters panes" }).getByRole("link", { name: "Fields" }).click();
  await admin.getByRole("button", { name: "Add field" }).click();
  const d = admin.getByRole("dialog", { name: "Add field" });
  await d.getByLabel("Name").fill(name);
  await d.getByLabel("Type").selectOption({ label: type });
  await d.getByLabel("Scope").selectOption({ label: scope });
  if (/select/.test(type)) await d.getByLabel("Options").fill("One\nTwo");
  await d.getByRole("button", { name: "Add field" }).click();
  await d.waitFor({ state: "hidden" });
  results.records.push({ kind: "field", name, type, scope });
}
async function openIntake(admin, pane = "Request types") {
  await openSettings(admin, "Organization", "Intake");
  await admin.getByRole("navigation", { name: "Intake panes" }).getByRole("link", { name: pane }).click();
  await admin.getByRole("heading", { name: pane }).waitFor();
}
async function attachMenuItems(page) {
  await page.getByRole("button", { name: "Attach field" }).click();
  const items = await page.getByRole("menuitem").allInnerTexts();
  await page.keyboard.press("Escape");
  return items.map((t) => t.replace(/\s+/g, " ").trim());
}
async function submitPortal(page, slugPath, { title, fill = async () => {} }) {
  await page.goto(`${BASE}${slugPath}`);
  await page.getByRole("textbox", { name: "Title (required)" }).fill(title);
  await page.getByRole("textbox", { name: "Description (required)" }).fill("Fictional DOC-029 walkthrough request. No real work is needed.");
  await fill(page);
  await page.getByRole("button", { name: "Submit request" }).click();
  const heading = page.getByRole("heading", { name: /^Request R-\d+ is with Legal$/ });
  await heading.waitFor({ timeout: 20000 });
  const ref = (await heading.innerText()).match(/R-(\d+)/)[1];
  return ref;
}
async function openConvert(admin, number, module) {
  await admin.goto(`${BASE}/inbox/${number}`);
  await admin.getByRole("button", { name: "Triage" }).click();
  await admin.getByRole("menuitem", { name: `Convert to ${module}` }).click();
  const d = admin.getByRole("dialog", { name: `Convert R-${number} to a ${module}` });
  await d.waitFor({ timeout: 20000 });
  return d;
}

async function formsSection(admin, business) {
  const SC = "V-C40";
  const role = "administrator";
  currentPage = admin;
  const F = {
    contractForm: `${G} Contract form ${stamp}`,
    matterForm: `${G} Matter form ${stamp}`,
    targetForm: `${G} Archived target form ${stamp}`,
    contractType: `${G} Forms MSA ${stamp}`,
    matterType: `${G} Forms matter type ${stamp}`,
    targetType: `${G} Target to archive ${stamp}`,
    listedEntity: `${G} Portal supplier ${stamp}`,
    entityField: `${G} Supplier entity ${stamp}`,
    userField: `${G} Account manager ${stamp}`,
    extLabel: `${G} Supplier checklist ${stamp}`,
    kiLabel: `${G} Ask Legal guidance ${stamp}`,
  };
  S.forms = F;

  await step(SC, role, "Before you start: live destination types and Fields (fixtures created through Settings)", "A Contract type with the Global Deal value (USD) Field, a Matter type with a Global Entity Field, and a Global User Field exist.", async () => {
    await createField(admin, { name: F.entityField, type: "Entity", scope: "Global" });
    await createField(admin, { name: F.userField, type: "User", scope: "Global" });
    await createTypeWithFields(admin, "contract", F.contractType, ["Deal value (USD)"]);
    await createTypeWithFields(admin, "matter", F.matterType, [F.entityField]);
    await openSettings(admin, "Organization", "Contracts");
    await addListRow(admin, "Add type", "New type name", F.targetType);
    results.records.push({ kind: "contract type", name: F.targetType });
    await admin.goto(`${BASE}/entities`);
    await admin.getByRole("button", { name: "Add entity" }).click();
    const ed = admin.getByRole("dialog", { name: "Add entity" });
    await ed.getByLabel("Legal name").fill(F.listedEntity);
    await ed.getByLabel("Entity type").selectOption({ label: "Corporation" });
    const created = admin.waitForResponse((r) => r.request().method() === "POST" && /\/api\/v1\/entities$/.test(r.url()));
    await ed.getByRole("button", { name: "Register" }).click();
    const entityId = (await (await created).json())?.entity?.id;
    await admin.goto(`${BASE}/entities/${entityId}`);
    const listed = admin.getByRole("switch", { name: "Portal-listed" });
    await listed.click();
    await until(async () => (await listed.getAttribute("aria-checked")) === "true", "Portal-listed did not turn on");
    results.records.push({ kind: "entity (Portal-listed)", name: F.listedEntity, id: entityId });
    return `Created Global Entity Field ${q(F.entityField)} and Global User Field ${q(F.userField)} in Matters > Fields. Created Contract type ${q(F.contractType)} with Deal value (USD) attached, Matter type ${q(F.matterType)} with ${q(F.entityField)} attached, and Contract type ${q(F.targetType)} with no Fields. Registered Entity ${q(F.listedEntity)} and turned on Portal-listed on its record; no seeded Entity in this lab is Portal-listed.`;
  });

  await step(SC, role, "Create the request type, steps 1-4: Settings > Intake > Request types > Add request type with Enter, Edit, Description saved on leaving the field; the list Target column and the editor have no Target control", "The new row shows Target: No target; the editor has Display name, Description, and Target turnaround, and no Target or Slug control; the Description persists after reload.", async () => {
    await openIntake(admin);
    for (const name of [F.contractForm, F.matterForm, F.targetForm]) {
      await admin.getByRole("button", { name: "Add request type" }).click();
      const input = admin.getByRole("textbox").filter({ hasNot: admin.locator("[aria-label='Search']") }).last();
      await input.fill(name);
      await input.press("Enter");
      await admin.getByRole("button", { name: `Rename ${name}`, exact: true }).waitFor({ timeout: 15000 });
      results.records.push({ kind: "request type", name });
    }
    const rowText = (await row(admin, F.contractForm).innerText()).replace(/\s+/g, " ");
    expectThat(/Target: No target/.test(rowText), `row ${rowText}`);
    const descs = { [F.contractForm]: "Use this DOC-029 form for a supplier contract review.", [F.matterForm]: "Use this DOC-029 form for supplier advice that is not a contract.", [F.targetForm]: "DOC-029 form bound to a Contract type that will be archived." };
    const urls = {};
    let controls = null;
    for (const name of [F.contractForm, F.matterForm, F.targetForm]) {
      await openIntake(admin);
      await admin.getByRole("button", { name: `Edit ${name}`, exact: true }).click();
      await admin.getByRole("heading", { name, exact: true }).waitFor();
      urls[name] = admin.url();
      const desc = admin.getByRole("textbox", { name: "Description" });
      await desc.fill(descs[name]);
      await desc.press("Tab");
      await pause(1200);
      if (!controls) {
        controls = {
          labels: await admin.locator("main label").allInnerTexts(),
          target: await admin.getByLabel(/^Target$/).count(),
          slug: await admin.getByRole("textbox", { name: "Slug" }).count(),
        };
      }
    }
    await admin.goto(urls[F.contractForm]);
    const saved = await admin.getByRole("textbox", { name: "Description" }).inputValue();
    expectThat(saved === descs[F.contractForm], `description ${saved}`);
    expectThat(controls.target === 0 && controls.slug === 0, `editor controls ${q(controls)}`);
    S.formUrls = urls;
    return `Add request type with Enter created ${q(F.contractForm)}, ${q(F.matterForm)} and ${q(F.targetForm)}. The list row reads ${q(rowText)}. Edit opened each editor; the Description saved on Tab and read ${q(saved)} after reload. Editor labels ${q(controls.labels)}; Target controls ${controls.target}, Slug controls ${controls.slug}.`;
  });

  await step(SC, role, "Publish an estimated turnaround: 36501 is refused, 5 saves on leaving the control", "36501 shows an error and is not saved; 5 is saved and persists after reload.", async () => {
    await admin.goto(S.formUrls[F.contractForm]);
    const box = admin.getByRole("spinbutton", { name: "Target turnaround (business days)" });
    const note = (await admin.getByText(/Counts Monday–Friday/).textContent()).trim();
    await box.fill("36501");
    await box.press("Tab");
    await pause(1500);
    const refusal = (await admin.locator("main").innerText()).match(/[^\n]*(36,?500|whole number|between)[^\n]*/i)?.[0] ?? null;
    await box.fill("5");
    await box.press("Enter");
    await pause(1500);
    await admin.reload();
    const saved = await admin.getByRole("spinbutton", { name: "Target turnaround (business days)" }).inputValue();
    expectThat(saved === "5", `turnaround after reload ${saved}`);
    expectThat(refusal, "no refusal text for 36501");
    await admin.goto(S.formUrls[F.matterForm]);
    const mbox = admin.getByRole("spinbutton", { name: "Target turnaround (business days)" });
    await mbox.fill("0");
    await mbox.press("Enter");
    await pause(1200);
    return `The control note reads ${q(note)}. 36501 with Tab showed ${q(refusal)}. 5 with Enter saved; after reload the value is ${q(saved)}. The Matter form was set to 0.`;
  });

  await step(SC, role, "Choose the form fields, steps 1-3: Attach field, Required, reorder with the arrow keys; No target offers only Global Fields; the fixed basics; a User Field cannot be required, an Entity Field can", "The No target menu lists only Global Fields; Required persists; the order changes; Department is a required basic; the User Field's Required is refused; the Entity Field's Required saves.", async () => {
    await admin.goto(S.formUrls[F.contractForm]);
    await admin.getByRole("heading", { name: "Form fields" }).waitFor();
    const menu = await attachMenuItems(admin);
    const nonGlobal = menu.filter((t) => !/· global$/.test(t));
    expectThat(menu.length > 0 && nonGlobal.length === 0, `non-global menu items ${q(nonGlobal)}`);
    const basics = (await admin.getByRole("list", { name: "Basics are always on the form" }).getByRole("checkbox").evaluateAll((els) => els.map((e) => `${e.getAttribute("aria-label")}: ${e.getAttribute("aria-checked") ?? e.checked}`)));
    for (const f of ["Deal value (USD)", "Country", "Needed by"]) {
      await admin.getByRole("button", { name: "Attach field" }).click();
      await pickMenuItem(admin, f);
      await admin.getByRole("button", { name: `Detach ${f}` }).waitFor();
    }
    const req = admin.getByRole("checkbox", { name: "Deal value (USD) required" });
    await req.click();
    await until(async () => (await req.isChecked()) && (await req.isEnabled()), "Required did not save");
    await admin.getByRole("button", { name: /^Reorder Needed by, position/ }).focus();
    await admin.keyboard.press("ArrowUp");
    await pause(1500);
    await admin.reload();
    await admin.getByRole("button", { name: /^Reorder Needed by, position/ }).waitFor();
    const order = await admin.getByRole("list", { name: "Form fields" }).getByRole("button", { name: /^Reorder / }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label").replace(/^Reorder (.*), position.*$/, "$1")));
    const reqAfter = await admin.getByRole("checkbox", { name: "Deal value (USD) required" }).isChecked();
    expectThat(reqAfter && q(order) === q(["Deal value (USD)", "Needed by", "Country"]), `order ${q(order)} required ${reqAfter}`);
    // Seeded targeted types: read their Attach field menus only.
    const seeded = {};
    for (const [name, label] of [["Vendor onboarding", "Contract · Vendor"], ["Employment question", "Matter · Employment"]]) {
      await openIntake(admin);
      await admin.getByRole("button", { name: `Edit ${name}`, exact: true }).click();
      await admin.getByRole("heading", { name: "Form fields" }).waitFor();
      const items = await attachMenuItems(admin);
      seeded[`${name} (${label})`] = { global: items.filter((t) => /· global$/.test(t)).length, moduleScoped: items.filter((t) => !/· global$/.test(t)) };
    }
    expectThat(seeded["Vendor onboarding (Contract · Vendor)"].moduleScoped.some((t) => /Governing law|Jurisdiction|Liability cap/.test(t)), "Contract target menu lacks Contract Fields");
    expectThat(seeded["Employment question (Matter · Employment)"].moduleScoped.some((t) => /External counsel|Regulator|Budget/.test(t)), "Matter target menu lacks Matter Fields");
    // Matter form: Entity required allowed, User required refused.
    await admin.goto(S.formUrls[F.matterForm]);
    await admin.getByRole("heading", { name: "Form fields" }).waitFor();
    for (const f of [F.entityField, F.userField]) {
      await admin.getByRole("button", { name: "Attach field" }).click();
      await pickMenuItem(admin, f);
      await admin.getByRole("button", { name: `Detach ${f}` }).waitFor();
    }
    const ent = admin.getByRole("checkbox", { name: `${F.entityField} required` });
    await ent.click();
    await until(async () => (await ent.isChecked()) && (await ent.isEnabled()), "Entity Required did not save");
    const usr = admin.getByRole("checkbox", { name: `${F.userField} required` });
    const usrDisabled = await usr.isDisabled();
    let usrOutcome = "Required checkbox disabled";
    if (!usrDisabled) {
      await usr.click();
      await pause(1500);
      usrOutcome = `clicked; checked=${await usr.isChecked()}; message ${q((await admin.locator("main").innerText()).match(/[^\n]*(User|person|Portal)[^\n]*required[^\n]*|[^\n]*required[^\n]*(User|person|Portal)[^\n]*/i)?.[0] ?? null)}`;
    }
    const userRowText = (await admin.getByRole("list", { name: "Form fields" }).getByRole("listitem").filter({ hasText: F.userField }).innerText()).replace(/\s+/g, " ");
    await admin.reload();
    const usrAfter = await admin.getByRole("checkbox", { name: `${F.userField} required` }).isChecked();
    const entAfter = await admin.getByRole("checkbox", { name: `${F.entityField} required` }).isChecked();
    expectThat(!usrAfter && entAfter, `user required ${usrAfter}, entity required ${entAfter}`);
    return `No target menu: ${menu.length} items, all "· global" (${q(menu.slice(0, 4))}...). Basics: ${q(basics)}. Attached Deal value (USD), Country and Needed by; Required on Deal value (USD); ArrowUp on Needed by; after reload the order is ${q(order)} and Deal value (USD) is still required. Seeded menus (read only, no change): ${q(seeded)}. On ${q(F.matterForm)} the Entity Field's Required saved and persisted; the User Field: ${usrOutcome}; its row reads ${q(userRowText)}; after reload it is not required.`;
  });

  await step(SC, role, "Offer guidance before submission, steps 1-4: Deflection links > Add link with an External address (refuse an address without https://) and with a Knowledge item; Placement on each form; Edit; reorder", "An address without http:// or https:// is refused; both links save with the chosen placement; Edit changes the label; a handle moves with the arrow keys.", async () => {
    await openIntake(admin, "Deflection links");
    await admin.getByRole("button", { name: "Add link" }).click();
    let d = admin.getByRole("dialog", { name: "Add link" });
    await d.getByRole("radio", { name: "External address" }).check();
    await d.getByRole("textbox", { name: "Address" }).fill("example.com/doc-029-supplier-checklist");
    await d.getByRole("textbox", { name: "Label" }).fill(F.extLabel);
    await d.getByRole("combobox", { name: "Placement" }).selectOption({ label: F.contractForm });
    await d.getByRole("button", { name: "Add link" }).click();
    await pause(1200);
    const refusal = (await d.innerText()).match(/Enter a full web address[^\n]*/)?.[0] ?? null;
    expectThat(refusal && (await d.isVisible()), "address without a scheme was not refused");
    await d.getByRole("textbox", { name: "Address" }).fill("https://example.com/doc-029-supplier-checklist");
    await d.getByRole("button", { name: "Add link" }).click();
    await d.waitFor({ state: "hidden", timeout: 15000 });
    await admin.getByRole("button", { name: "Add link" }).click();
    d = admin.getByRole("dialog", { name: "Add link" });
    await d.getByRole("radio", { name: "Knowledge item" }).check();
    const kiOptions = (await d.getByRole("combobox", { name: "Knowledge item" }).locator("option").allInnerTexts()).filter((t) => !/Choose an item/.test(t));
    await d.getByRole("combobox", { name: "Knowledge item" }).selectOption({ label: "How to ask legal for help" });
    await d.getByRole("textbox", { name: "Label" }).fill(`${F.kiLabel} draft`);
    await d.getByRole("combobox", { name: "Placement" }).selectOption({ label: F.matterForm });
    await d.getByRole("button", { name: "Add link" }).click();
    await d.waitFor({ state: "hidden", timeout: 15000 });
    await admin.getByRole("button", { name: `Edit ${F.kiLabel} draft`, exact: true }).click();
    d = admin.getByRole("dialog", { name: `Edit ${F.kiLabel} draft` });
    await d.getByRole("textbox", { name: "Label" }).fill(F.kiLabel);
    await d.getByRole("button", { name: "Save" }).click();
    await d.waitFor({ state: "hidden", timeout: 15000 });
    const extRow = (await admin.getByRole("listitem").filter({ has: admin.getByRole("button", { name: `Edit ${F.extLabel}`, exact: true }) }).innerText()).replace(/\s+/g, " ");
    const kiRow = (await admin.getByRole("listitem").filter({ has: admin.getByRole("button", { name: `Edit ${F.kiLabel}`, exact: true }) }).innerText()).replace(/\s+/g, " ");
    const before = await reorderPosition(admin, F.kiLabel);
    await admin.getByRole("button", { name: new RegExp(`^Reorder ${escapeRe(F.kiLabel)}, position`) }).focus();
    await admin.keyboard.press("ArrowUp");
    await until(async () => (await reorderPosition(admin, F.kiLabel)) === before - 1, "link did not move");
    await pause(1200);
    await admin.reload();
    const after = await reorderPosition(admin, F.kiLabel);
    expectThat(after === before - 1, `link position after reload ${after}`);
    results.records.push({ kind: "deflection link", name: F.extLabel }, { kind: "deflection link", name: F.kiLabel });
    return `Address "example.com/doc-029-supplier-checklist" was refused with ${q(refusal)}; with https:// the external link saved. Knowledge item offered ${kiOptions.length} items; "How to ask legal for help" saved. Edit changed the Knowledge link label to ${q(F.kiLabel)}. Rows: ${q(extRow)}; ${q(kiRow)}. ArrowUp moved the Knowledge link from position ${before} to ${after}, kept after reload.`;
  });

  await step(SC, "business_user", "Check the result on the Portal: request-type cards, Before you submit, Fields, order, and required markers; submit with a required answer missing, then with valid answers", "Both cards show the description and estimated turnaround; each form shows its own guidance; Fields appear in the configured order with required markers; a missing required answer is refused; valid answers create a Request.", async () => {
    currentPage = business;
    await business.goto(`${BASE}/portal`);
    await business.getByRole("list", { name: "Request types" }).getByRole("link", { name: new RegExp(escapeRe(F.matterForm)) }).waitFor({ timeout: 20000 });
    const cards = await business.getByRole("list", { name: "Request types" }).getByRole("link").allInnerTexts();
    const contractCard = cards.find((c) => c.includes(F.contractForm))?.replace(/\s+/g, " ");
    const matterCard = cards.find((c) => c.includes(F.matterForm))?.replace(/\s+/g, " ");
    expectThat(/Estimated turnaround: 5 business days/.test(contractCard ?? "") && /supplier contract review/.test(contractCard ?? ""), `contract card ${contractCard}`);
    await business.getByRole("list", { name: "Request types" }).getByRole("link", { name: new RegExp(escapeRe(F.contractForm)) }).click();
    await business.getByRole("heading", { name: F.contractForm, level: 1 }).waitFor();
    const contractPath = new URL(business.url()).pathname;
    const guide = business.getByRole("region", { name: "Before you submit" });
    const extLink = guide.getByRole("link", { name: new RegExp(escapeRe(F.extLabel)) });
    const extHref = await extLink.getAttribute("href");
    const extTarget = await extLink.getAttribute("target");
    const details = business.locator("main").getByText(/^Details for /);
    const labels = await business.locator("main label").allInnerTexts();
    const detailLabels = labels.slice(labels.findIndex((l) => /Urgency/.test(l)) + 1).map((l) => l.replace(/\*/g, "").replace(/\s+/g, " ").trim());
    expectThat(extHref === "https://example.com/doc-029-supplier-checklist", `external href ${extHref}`);
    expectThat(q(detailLabels.slice(0, 3)) === q(["Deal value (USD) (required)", "Needed by", "Country"]), `detail labels ${q(detailLabels)}`);
    await business.screenshot({ path: path.join(SHOTS, "r1-portal-contract-form.png"), fullPage: true });
    // Missing required answer.
    await business.getByRole("textbox", { name: "Title (required)" }).fill(`${G} Supplier contract request ${stamp}`);
    await business.getByRole("textbox", { name: "Description (required)" }).fill("Fictional DOC-029 walkthrough request. No real work is needed.");
    await business.getByRole("button", { name: "Submit request" }).click();
    await pause(1500);
    const missing = (await business.locator("main").innerText()).match(/[^\n]*Deal value \(USD\)[^\n]*required[^\n]*/)?.[0] ?? null;
    const stillForm = /\/portal\/new\//.test(business.url()) && (await business.getByRole("button", { name: "Submit request" }).count()) === 1;
    expectThat(missing && stillForm, `missing required not refused: ${missing}`);
    await business.getByRole("textbox", { name: "Deal value (USD) (required)" }).fill("125000");
    const countryOptions = (await business.getByRole("combobox", { name: "Country" }).locator("option").allInnerTexts()).map((t) => t.trim());
    S.countryAnswer = countryOptions.find((o) => o && !/^(Not set|Choose|Select)/.test(o));
    await business.getByRole("combobox", { name: "Country" }).selectOption({ label: S.countryAnswer });
    await business.getByRole("button", { name: "Submit request" }).click();
    const heading = business.getByRole("heading", { name: /^Request R-\d+ is with Legal$/ });
    await heading.waitFor({ timeout: 20000 });
    S.contractRequest = (await heading.innerText()).match(/R-(\d+)/)[1];
    results.records.push({ kind: "request", name: `${G} Supplier contract request ${stamp}`, number: S.contractRequest });
    // Matter form.
    await business.goto(`${BASE}/portal`);
    await business.getByRole("list", { name: "Request types" }).getByRole("link", { name: new RegExp(escapeRe(F.matterForm)) }).click();
    await business.getByRole("heading", { name: F.matterForm, level: 1 }).waitFor();
    const mguide = business.getByRole("region", { name: "Before you submit" });
    const kiLink = mguide.getByRole("link", { name: new RegExp(escapeRe(F.kiLabel)) });
    const kiCount = await kiLink.count();
    const extOnMatter = await mguide.getByRole("link", { name: new RegExp(escapeRe(F.extLabel)) }).count().catch(() => 0);
    const mlabels = (await business.locator("main label").allInnerTexts()).map((l) => l.replace(/\*/g, "").replace(/\s+/g, " ").trim());
    const entityControl = business.getByLabel(new RegExp(`^${escapeRe(F.entityField)}`));
    const entityOptions = (await entityControl.locator("option").allInnerTexts().catch(() => [])).map((t) => t.trim());
    const userPresent = mlabels.some((l) => l.startsWith(F.userField));
    expectThat(kiCount === 1 && extOnMatter === 0, `guidance on matter form: ki ${kiCount}, ext ${extOnMatter}`);
    expectThat(mlabels.includes(`${F.entityField} (required)`), `matter form labels ${q(mlabels)}`);
    const liveEntities = ((await api(admin, "GET", "/api/v1/entities")).body?.entities ?? []).map((e) => e.legalName ?? e.name);
    const offered = entityOptions.filter((o) => o !== "Not set");
    expectThat(offered.includes(F.listedEntity) && offered.every((o) => o.startsWith(`${G} Portal supplier`)), `Portal Entity choices ${q(entityOptions)}`);
    S.portalEntityOptions = entityOptions;
    await kiLink.click();
    await business.waitForURL(/\/portal\/knowledge\//, { timeout: 15000 });
    const kiHeading = await until(async () => {
      const t = (await business.getByRole("heading", { level: 1 }).first().innerText().catch(() => "")).trim();
      return t && t !== F.matterForm ? t : null;
    }, "Knowledge page heading did not load");
    const kiPath = new URL(business.url()).pathname;
    return `Portal cards: ${q(contractCard)}; ${q(matterCard)}. ${q(F.contractForm)} opened ${contractPath}; Before you submit links to ${extHref} (target ${q(extTarget)}); detail Fields read ${q(detailLabels)}. Submit without Deal value stayed on the form and showed ${q(missing)}. With 125000 and Country ${q(S.countryAnswer)}, Submit showed "Request R-${S.contractRequest} is with Legal". ${q(F.matterForm)} lists labels ${q(mlabels)}; Before you submit shows only ${q(F.kiLabel)}; the User Field is ${userPresent ? "present" : "not shown"} on the Portal form; the Entity choices are ${q(entityOptions)}: only Entities this walkthrough made Portal-listed, out of ${liveEntities.length} live Entities the Administrator can read. Following the Knowledge link opened ${kiPath} with heading ${q(kiHeading)}.`;
  });

  await step(SC, "business_user", "Submit the Matter form with a valid Entity answer", "A Request is created.", async () => {
    await business.goto(`${BASE}/portal`);
    await business.getByRole("list", { name: "Request types" }).getByRole("link", { name: new RegExp(escapeRe(F.matterForm)) }).click();
    await business.getByRole("heading", { name: F.matterForm, level: 1 }).waitFor();
    const title = `${G} Supplier advice request ${stamp}`;
    await business.getByRole("textbox", { name: "Title (required)" }).fill(title);
    await business.getByRole("textbox", { name: "Description (required)" }).fill("Fictional DOC-029 walkthrough request. No real work is needed.");
    await business.getByRole("combobox", { name: "Urgency (required)" }).selectOption({ label: "High" });
    const entityControl = business.getByLabel(new RegExp(`^${escapeRe(F.entityField)}`));
    S.portalEntityChoice = S.portalEntityOptions.find((o) => o && !/Not set|Choose|Select|None|—/.test(o));
    await entityControl.selectOption({ label: S.portalEntityChoice });
    await business.getByRole("button", { name: "Submit request" }).click();
    const heading = business.getByRole("heading", { name: /^Request R-\d+ is with Legal$/ });
    await heading.waitFor({ timeout: 20000 });
    S.matterRequest = (await heading.innerText()).match(/R-(\d+)/)[1];
    S.matterRequestTitle = title;
    results.records.push({ kind: "request", name: title, number: S.matterRequest });
    return `Submitted ${q(title)} with Urgency High and Entity ${q(S.portalEntityChoice)}; the confirmation reads "Request R-${S.matterRequest} is with Legal".`;
  });

  await step(SC, role, "Have Legal convert the Contract Request: a blank Type is refused; the attached Field carries; the answer the destination type does not attach is listed under Does not carry into the contract", "Convert without a type shows Pick a contract type.; with the Contract type chosen, Deal value (USD) carries, Counterparty name is listed as not carrying, and the Contract is created with the value.", async () => {
    currentPage = admin;
    const d = await openConvert(admin, S.contractRequest, "contract");
    const typeBefore = await d.getByRole("combobox", { name: "Contract type" }).locator("option:checked").innerText();
    await d.getByRole("button", { name: "Convert to contract" }).click();
    await pause(1000);
    const blank = (await d.innerText()).match(/Pick a contract type\./)?.[0] ?? null;
    expectThat(blank && (await d.isVisible()), "blank type not refused");
    await d.getByRole("combobox", { name: "Contract type" }).selectOption({ label: F.contractType });
    await pause(1500);
    const text = (await d.innerText()).replace(/\s+/g, " ");
    const notCarry = text.match(/Does not carry into the contract.{0,160}/)?.[0] ?? null;
    expectThat(notCarry && /Country/.test(notCarry), `not-carry section ${notCarry}; dialog ${text.slice(0, 600)}`);
    await d.getByRole("button", { name: "Convert to contract" }).click();
    await admin.waitForURL(/\/contracts\/\d+/, { timeout: 20000 }).catch(() => {});
    await pause(2000);
    const req = await api(admin, "GET", `/api/v1/requests/${S.contractRequest}`);
    const reqText = JSON.stringify(req.body);
    const contractNumber = req.body?.request?.convertedRecord?.module === "contract" ? req.body.request.convertedRecord.number : null;
    expectThat(contractNumber, `no contract number (url ${admin.url()}, request ${req.status})`);
    const contract = await api(admin, "GET", `/api/v1/contracts/${contractNumber}`);
    const cText = JSON.stringify(contract.body);
    expectThat(cText.includes("125000") && cText.includes(F.contractType), "Contract lacks the type or Deal value");
    results.records.push({ kind: "contract", number: contractNumber, from: `R-${S.contractRequest}` });
    return `The Convert dialog opened with Contract type ${q(typeBefore)}. Convert without a type showed ${q(blank)} and stayed open. With ${q(F.contractType)} chosen the dialog read ${q(notCarry)}; Country is not attached to that Contract type. Convert created C-${contractNumber}; GET /api/v1/contracts/${contractNumber} shows type ${q(F.contractType)} and Deal value 125000.`;
  });

  await step(SC, role, "If a configured destination type is archived, select a live type during conversion (fixture: the Target set through the API, because the editor has no Target control)", "The Target column names the configured Contract type; after that type is archived, conversion does not use it or switch module; a live type must be chosen and the Request becomes a Contract of that type.", async () => {
    const types = await api(admin, "GET", "/api/v1/request-types");
    const rt = (types.body?.requestTypes ?? []).find((t) => t.displayName === F.targetForm);
    const ct = (await api(admin, "GET", "/api/v1/contract-types")).body?.contractTypes?.find((t) => t.displayName === F.targetType);
    expectThat(rt && ct, "fixture ids not found");
    const patch = await api(admin, "PATCH", `/api/v1/request-types/${rt.id}`, { targetModule: "contract", targetTypeId: ct.id });
    expectThat(patch.status === 200, `target PATCH ${patch.status}`);
    await openIntake(admin);
    const rowText = (await row(admin, F.targetForm).innerText()).replace(/\s+/g, " ");
    currentPage = business;
    const number = await submitPortal(business, `/portal`, {
      title: `${G} Archived target request ${stamp}`,
    }).catch(async () => {
      await business.goto(`${BASE}/portal`);
      await business.getByRole("list", { name: "Request types" }).getByRole("link", { name: new RegExp(escapeRe(F.targetForm)) }).click();
      await business.getByRole("textbox", { name: "Title (required)" }).fill(`${G} Archived target request ${stamp}`);
      await business.getByRole("textbox", { name: "Description (required)" }).fill("Fictional DOC-029 walkthrough request. No real work is needed.");
      await business.getByRole("button", { name: "Submit request" }).click();
      const h = business.getByRole("heading", { name: /^Request R-\d+ is with Legal$/ });
      await h.waitFor({ timeout: 20000 });
      return (await h.innerText()).match(/R-(\d+)/)[1];
    });
    results.records.push({ kind: "request", name: `${G} Archived target request ${stamp}`, number });
    currentPage = admin;
    await openSettings(admin, "Organization", "Contracts");
    await admin.getByRole("button", { name: `Archive ${F.targetType}`, exact: true }).click();
    const ad = admin.getByRole("dialog");
    await ad.getByRole("button", { name: "Archive type" }).click();
    await ad.waitFor({ state: "hidden", timeout: 15000 });
    await admin.goto(`${BASE}/inbox/${number}`);
    const overview = (await admin.getByRole("region", { name: "Overview" }).innerText()).replace(/\s+/g, " ");
    const d = await openConvert(admin, number, "contract");
    const typeCombo = d.getByRole("combobox", { name: "Contract type" });
    const selected = await typeCombo.locator("option:checked").innerText();
    const offered = await typeCombo.locator("option").allInnerTexts();
    expectThat(!offered.includes(F.targetType), "archived type offered");
    await d.getByRole("button", { name: "Convert to contract" }).click();
    await pause(1000);
    const refusal = (await d.innerText()).match(/Pick a contract type\./)?.[0] ?? null;
    expectThat(refusal && (await d.isVisible()), "conversion went ahead without a live type");
    await typeCombo.selectOption({ label: F.contractType });
    await d.getByRole("button", { name: "Convert to contract" }).click();
    await d.waitFor({ state: "hidden", timeout: 20000 });
    const req = await api(admin, "GET", `/api/v1/requests/${number}`);
    const reqText = JSON.stringify(req.body);
    const outcome = req.body?.request?.convertedRecord;
    const contractNumber = outcome?.module === "contract" ? outcome.number : null;
    expectThat(contractNumber, `request outcome ${q(outcome)}`);
    const contract = await api(admin, "GET", `/api/v1/contracts/${contractNumber}`);
    expectThat(JSON.stringify(contract.body).includes(F.contractType), "contract type is not the chosen live type");
    // Restore the fixture type.
    await openSettings(admin, "Organization", "Contracts");
    await admin.getByRole("switch", { name: "Show archived" }).click();
    await admin.getByRole("button", { name: `Restore ${F.targetType}`, exact: true }).click();
    await admin.getByRole("button", { name: `Archive ${F.targetType}`, exact: true }).waitFor({ timeout: 15000 });
    results.records.push({ kind: "contract", number: contractNumber, from: `R-${number}` });
    return `PATCH /api/v1/request-types/<id> set the Target (${patch.status}); the list row then read ${q(rowText)}. Jonas Weber submitted R-${number}. The Target Contract type was archived. The Request Overview read ${q(overview)}. Convert to contract opened with Contract type ${q(selected)}; the archived type was not offered. Convert without a type showed ${q(refusal)}. With ${q(F.contractType)} chosen, R-${number} became C-${contractNumber} of that type, not a Matter. The fixture type was restored afterwards.`;
  });

  await step(SC, role, "Archive a request type: the dialog reports no usage and no replacement; the Portal drops the card and the form; the Request stays readable; Show archived > Restore offers it again", "Archive removes the card and form from the Portal; the earlier Request still opens for the Requester; Restore brings the card back.", async () => {
    currentPage = business;
    await business.goto(`${BASE}/portal`);
    await business.getByRole("list", { name: "Request types" }).getByRole("link", { name: new RegExp(escapeRe(F.targetForm)) }).click();
    await business.getByRole("heading", { name: F.targetForm, level: 1 }).waitFor();
    const formPath = new URL(business.url()).pathname;
    await business.getByRole("textbox", { name: "Title (required)" }).fill(`${G} Open request on archived form ${stamp}`);
    await business.getByRole("textbox", { name: "Description (required)" }).fill("Fictional DOC-029 walkthrough request. No real work is needed.");
    await business.getByRole("button", { name: "Submit request" }).click();
    const h = business.getByRole("heading", { name: /^Request R-\d+ is with Legal$/ });
    await h.waitFor({ timeout: 20000 });
    const openNumber = (await h.innerText()).match(/R-(\d+)/)[1];
    results.records.push({ kind: "request (left open)", name: `${G} Open request on archived form ${stamp}`, number: openNumber });
    currentPage = admin;
    await openIntake(admin);
    await admin.getByRole("button", { name: `Archive ${F.targetForm}`, exact: true }).click();
    const d = admin.getByRole("dialog");
    const dtext = (await d.innerText()).replace(/\s+/g, " ");
    const selects = await d.getByRole("combobox").count();
    const enabledSelects = await d.getByRole("combobox").evaluateAll((els) => els.filter((e) => !e.disabled).length);
    await d.getByRole("button", { name: /^Archive/ }).click();
    await d.waitFor({ state: "hidden", timeout: 15000 });
    currentPage = business;
    let cardGone = false;
    let polls = 0;
    for (; polls < 10 && !cardGone; polls++) {
      await business.goto(`${BASE}/portal`);
      await business.getByRole("list", { name: "Request types" }).waitFor();
      await pause(2000);
      cardGone = (await business.getByRole("list", { name: "Request types" }).getByRole("link", { name: new RegExp(escapeRe(F.targetForm)) }).count()) === 0;
    }
    await business.goto(`${BASE}${formPath}`);
    await pause(2500);
    const formLanded = new URL(business.url()).pathname;
    await business.goto(`${BASE}/portal/requests/${openNumber}`);
    await pause(2500);
    const reqText = (await business.locator("main").innerText()).replace(/\s+/g, " ");
    expectThat(cardGone && formLanded !== formPath, `card gone ${cardGone}, form landed ${formLanded}`);
    expectThat(reqText.includes(`${G} Open request on archived form ${stamp}`), "Request not readable");
    currentPage = admin;
    await openIntake(admin);
    await admin.getByRole("switch", { name: "Show archived" }).click();
    await admin.getByRole("button", { name: `Restore ${F.targetForm}`, exact: true }).click();
    await admin.getByRole("button", { name: `Archive ${F.targetForm}`, exact: true }).waitFor({ timeout: 15000 });
    currentPage = business;
    let cardBack = 0;
    for (let i = 0; i < 5 && !cardBack; i++) {
      await business.goto(`${BASE}/portal`);
      await business.getByRole("list", { name: "Request types" }).waitFor();
      await pause(2000);
      cardBack = await business.getByRole("list", { name: "Request types" }).getByRole("link", { name: new RegExp(escapeRe(F.targetForm)) }).count();
    }
    expectThat(cardBack === 1, "card not back after Restore");
    expectThat(enabledSelects === 0 && /not used by any requests/.test(dtext), `archive dialog: ${dtext}`);
    return `Jonas Weber submitted R-${openNumber} on ${q(F.targetForm)} (${formPath}). The Archive dialog read ${q(dtext.slice(0, 220))} ; its ${selects} reassignment select(s) are disabled (${enabledSelects} enabled), although R-${openNumber} and an earlier converted Request name this type. After Archive the Portal home had no card for it (seen on load ${polls} of up to 10, 2 seconds apart), and ${formPath} sent the browser to ${formLanded}. /portal/requests/${openNumber} still showed the Request title. Show archived > Restore brought the card back (${cardBack}).`;
  });

  await step(SC, role, "Remove the walkthrough's deflection links and turn off Portal-listed on its Entities", "Remove deletes each link at once with no archive; the Knowledge Item stays published; the Entities leave Portal pickers.", async () => {
    currentPage = admin;
    await openIntake(admin, "Deflection links");
    const removed = [];
    // Current run's links first, then any left by this group's earlier development runs.
    const labels = [F.extLabel, F.kiLabel];
    const older = await admin.getByRole("button", { name: new RegExp(`^Remove ${escapeRe(G)} `) }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label").replace(/^Remove /, "")));
    for (const l of older) if (!labels.includes(l)) labels.push(l);
    for (const label of labels) {
      await admin.getByRole("button", { name: `Remove ${label}`, exact: true }).click();
      const confirm = admin.getByRole("dialog");
      if (await confirm.isVisible().catch(() => false)) await confirm.getByRole("button", { name: /^Remove/ }).click();
      await admin.getByRole("button", { name: `Remove ${label}`, exact: true }).waitFor({ state: "detached", timeout: 15000 });
      removed.push(label);
    }
    await admin.reload();
    await admin.getByRole("heading", { name: "Deflection links" }).waitFor();
    const archivedSwitch = await admin.getByRole("switch", { name: "Show archived" }).count();
    const leftovers = await admin.getByRole("button", { name: new RegExp(`^Remove ${escapeRe(G)} `) }).count();
    currentPage = business;
    await business.goto(`${BASE}/portal/knowledge/01a0aaad-b43b-75c9-b4fb-4ea4806e7e48`);
    const kiStill = await until(async () => {
      const t = (await business.getByRole("heading", { level: 1 }).first().innerText().catch(() => "")).trim();
      return t === "How to ask legal for help" ? t : null;
    }, "Knowledge Item no longer opens");
    currentPage = admin;
    const entities = [];
    const all = (await api(admin, "GET", "/api/v1/entities")).body;
    const list = all?.entities ?? all?.items ?? [];
    for (const e of list.filter((x) => (x.legalName ?? "").startsWith(`${G} Portal supplier`))) {
      await admin.goto(`${BASE}/entities/${e.id}`);
      const sw = admin.getByRole("switch", { name: "Portal-listed" });
      await sw.waitFor();
      if ((await sw.getAttribute("aria-checked")) === "true") {
        await sw.click();
        await until(async () => (await sw.getAttribute("aria-checked")) === "false", "Portal-listed did not turn off");
      }
      entities.push(e.legalName);
    }
    expectThat(leftovers === 0 && archivedSwitch === 0, `links left ${leftovers}, archive switch ${archivedSwitch}`);
    return `Removed this run's links ${q([F.extLabel, F.kiLabel])} and ${removed.length - 2} links left by earlier development runs of this script; after reload no DOC-029 admin-config link remains and the pane has no Show archived switch. The Knowledge Item still opens on the Portal with heading ${q(kiStill)}. Portal-listed is now off for ${q(entities)}.`;
  });
}

// =====================================================================
// V-C39 matter-templates (and the Matter half of V-C40)
// =====================================================================
function utcDatePlus(iso, days) {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
async function openTemplates(admin, typeName) {
  await openSettings(admin, "Organization", "Matters");
  await admin.getByRole("navigation", { name: "Matters panes" }).getByRole("link", { name: "Templates" }).click();
  await admin.getByRole("heading", { name: "Matter templates" }).waitFor();
  await admin.getByRole("combobox", { name: "Matter type" }).selectOption({ label: typeName });
  await pause(1000);
}
async function saveTemplate(admin) {
  await admin.getByRole("button", { name: "Save template" }).click();
  await pause(2500);
  const main = await admin.locator("main").innerText();
  const error = main.match(/[^\n]*(could not be saved|Give every row|Give [^\n]* a number|Name the template)[^\n]*/)?.[0] ?? null;
  return { error, saved: /Saved/.test(main) };
}
async function readTemplate(admin) {
  const tasks = [];
  const nTasks = await admin.getByRole("textbox", { name: /^Task \d+ title$/ }).count();
  for (let i = 1; i <= nTasks; i++) {
    tasks.push([
      await admin.getByRole("textbox", { name: `Task ${i} title` }).inputValue(),
      await admin.getByRole("spinbutton", { name: `Task ${i} due offset in days` }).inputValue(),
      await admin.getByRole("combobox", { name: `Task ${i} role` }).locator("option:checked").innerText(),
    ]);
  }
  const dates = [];
  const nDates = await admin.getByRole("textbox", { name: /^Key date \d+ label$/ }).count();
  for (let i = 1; i <= nDates; i++) {
    dates.push([
      await admin.getByRole("textbox", { name: `Key date ${i} label` }).inputValue(),
      await admin.getByRole("spinbutton", { name: `Key date ${i} offset in days` }).inputValue(),
      await admin.getByRole("textbox", { name: `Key date ${i} note` }).inputValue(),
    ]);
  }
  return {
    name: await admin.getByRole("textbox", { name: "Name" }).first().inputValue(),
    priority: await admin.getByRole("combobox", { name: "Priority" }).locator("option:checked").innerText(),
    risk: await admin.getByRole("combobox", { name: "Risk" }).locator("option:checked").innerText(),
    prefix: await admin.getByRole("textbox", { name: "Title prefix" }).inputValue(),
    tasks,
    dates,
  };
}
async function matterSnapshot(admin, number) {
  const m = (await api(admin, "GET", `/api/v1/matters/${number}`)).body?.matter;
  await admin.goto(`${BASE}/matters/${number}/tasks`);
  await admin.getByRole("heading", { name: "Tasks", level: 2 }).waitFor();
  await pause(1500);
  const tasks = await admin.getByRole("region", { name: "Tasks" }).getByRole("listitem").evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
  await admin.goto(`${BASE}/matters/${number}/key-dates`);
  await admin.getByRole("heading", { name: "Key dates", level: 2 }).waitFor();
  await pause(1500);
  const dates = await admin.getByRole("region", { name: "Key dates" }).getByRole("row").evaluateAll((els) => els.slice(1).map((e) => e.innerText.replace(/\s+/g, " ").trim()));
  const apiTasks = (await api(admin, "GET", `/api/v1/matters/${number}/tasks`)).body;
  const apiDates = (await api(admin, "GET", `/api/v1/matters/${number}/key-dates`)).body;
  return { m, tasks, dates, apiTasks, apiDates };
}
function taskFacts(apiTasks) {
  const list = apiTasks?.tasks ?? apiTasks?.items ?? [];
  return list.map((t) => [t.title, t.dueDate ?? t.dueOn ?? null, t.assignee?.displayName ?? t.assigneeName ?? null]);
}
function dateFacts(apiDates) {
  const list = apiDates?.deadlines ?? apiDates?.keyDates ?? [];
  return list.map((k) => [k.label ?? k.event ?? k.title, k.date ?? k.dueDate]);
}

async function templatesSection(admin, business) {
  const SC = "V-C39";
  const role = "administrator";
  currentPage = admin;
  const F = S.forms;
  const T = {
    type: `${G} Template type ${stamp}`,
    region: `${G} Template region ${stamp}`,
    counsel: `${G} Template counsel ${stamp}`,
    name: `${G} Supplier onboarding template ${stamp}`,
    task1: `${G} Confirm the supplier scope ${stamp}`,
    task2: `${G} Open the evidence folder ${stamp}`,
    task3: `${G} Check the sanctions list ${stamp}`,
    date1: `${G} Supplier review ${stamp}`,
    date2: `${G} Kick-off ${stamp}`,
  };
  S.templates = T;

  await step(SC, role, "Before you start: a live Matter type with the Fields the template should fill", "The type has an optional Text Field, a required Text Field, and the Entity Field the Matter form collects.", async () => {
    await createField(admin, { name: T.region, type: "Text", scope: "Matter" });
    await createField(admin, { name: T.counsel, type: "Text", scope: "Matter" });
    S.templateTypeUrl = await createTypeWithFields(admin, "matter", T.type, [T.region, T.counsel, F.entityField]);
    const req = admin.getByRole("checkbox", { name: `${T.counsel} required` });
    await req.click();
    await until(async () => (await req.isChecked()) && (await req.isEnabled()), "Required did not save");
    return `Created Matter Fields ${q(T.region)} and ${q(T.counsel)}, and Matter type ${q(T.type)} with both and ${q(F.entityField)} attached; ${q(T.counsel)} is Required.`;
  });

  await step(SC, role, "Create and edit a template, steps 1-7: Templates > Matter type > Add template (Name, Description); Edit; Matter defaults; Custom field defaults; Tasks with offsets, roles and reorder; Key dates; Save template; reopen and confirm", "The template saves, and after reload all four areas hold the entered values in the chosen order.", async () => {
    await openTemplates(admin, T.type);
    await admin.getByRole("button", { name: "Add template" }).click();
    const d = admin.getByRole("dialog", { name: "Add Matter template" });
    await d.getByLabel("Name").fill(T.name);
    await d.getByLabel("Description").fill("DOC-029 fictional onboarding checklist for a supplier.");
    await d.getByRole("button", { name: "Add template" }).click();
    await d.waitFor({ state: "hidden" });
    const rowText = (await row(admin, T.name).innerText()).replace(/\s+/g, " ");
    await admin.getByRole("link", { name: `Edit ${T.name}` }).click();
    await admin.getByRole("heading", { name: "Matter defaults" }).waitFor();
    S.templateUrl = admin.url();
    const typeNote = (await admin.getByText(/^Matter type: /).textContent()).trim();
    await admin.getByRole("combobox", { name: "Priority" }).selectOption({ label: "Low" });
    await admin.getByRole("combobox", { name: "Risk" }).selectOption({ label: "Medium" });
    await admin.getByRole("textbox", { name: "Title prefix" }).fill("Supplier - ");
    await admin.getByRole("textbox", { name: T.region, exact: true }).fill("EMEA default");
    await admin.getByRole("textbox", { name: T.counsel, exact: true }).fill("DOC-029 Fictional Counsel LLP");
    for (const [title, offset, roleName] of [[T.task1, "2", "Matter Manager"], [T.task2, "", "Unassigned"], [T.task3, "5", "Matter Manager"]]) {
      await admin.getByRole("button", { name: "Add task" }).click();
      const i = await admin.getByRole("textbox", { name: /^Task \d+ title$/ }).count();
      await admin.getByRole("textbox", { name: `Task ${i} title` }).fill(title);
      await admin.getByRole("spinbutton", { name: `Task ${i} due offset in days` }).fill(offset);
      await admin.getByRole("combobox", { name: `Task ${i} role` }).selectOption({ label: roleName });
    }
    await admin.getByRole("button", { name: new RegExp(`^Reorder ${escapeRe(T.task3)}, position`) }).focus();
    await admin.keyboard.press("ArrowUp");
    await pause(500);
    for (const [label, offset, note] of [[T.date1, "10", "Fictional review with the supplier."], [T.date2, "0", ""]]) {
      await admin.getByRole("button", { name: "Add key date" }).click();
      const i = await admin.getByRole("textbox", { name: /^Key date \d+ label$/ }).count();
      await admin.getByRole("textbox", { name: `Key date ${i} label` }).fill(label);
      await admin.getByRole("spinbutton", { name: `Key date ${i} offset in days` }).fill(offset);
      await admin.getByRole("textbox", { name: `Key date ${i} note` }).fill(note);
    }
    const saved = await saveTemplate(admin);
    expectThat(!saved.error, `save error ${saved.error}`);
    await admin.reload();
    await admin.getByRole("heading", { name: "Matter defaults" }).waitFor();
    await pause(1000);
    const t = await readTemplate(admin);
    const regionDefault = await admin.getByRole("textbox", { name: T.region, exact: true }).inputValue();
    const counselDefault = await admin.getByRole("textbox", { name: T.counsel, exact: true }).inputValue();
    expectThat(t.priority === "Low" && t.risk === "Medium" && t.prefix.trim() === "Supplier -", `defaults ${q(t)}`);
    expectThat(regionDefault === "EMEA default" && counselDefault === "DOC-029 Fictional Counsel LLP", "Field defaults not saved");
    expectThat(q(t.tasks) === q([[T.task1, "2", "Matter Manager"], [T.task3, "5", "Matter Manager"], [T.task2, "", "Unassigned"]]), `tasks ${q(t.tasks)}`);
    expectThat(q(t.dates) === q([[T.date1, "10", "Fictional review with the supplier."], [T.date2, "0", ""]]), `dates ${q(t.dates)}`);
    results.records.push({ kind: "matter template", name: T.name });
    await admin.screenshot({ path: path.join(SHOTS, "r1-matter-template-editor.png"), fullPage: true });
    return `Add template created the row ${q(rowText)}. Edit opened the editor (${q(typeNote)}). Save template reported saved=${saved.saved}. After reload: Priority ${q(t.priority)}, Risk ${q(t.risk)}, Title prefix ${q(t.prefix)}; Field defaults ${q([regionDefault, counselDefault])}; Tasks ${q(t.tasks)} (the third Task moved up with ArrowUp); Key dates ${q(t.dates)}.`;
  });

  await step(SC, role, "Offsets are whole numbers from 0 to 3650; a Key date needs an offset; the editor names the problem", "3651 and a blank Key date offset are refused with an error, and the saved template stays unchanged.", async () => {
    await admin.goto(S.templateUrl);
    await admin.getByRole("heading", { name: "Matter defaults" }).waitFor();
    await admin.getByRole("combobox", { name: "Priority" }).selectOption({ label: "Critical" });
    await admin.getByRole("spinbutton", { name: "Task 1 due offset in days" }).fill("3651");
    const big = await saveTemplate(admin);
    await admin.reload();
    await admin.getByRole("heading", { name: "Matter defaults" }).waitFor();
    await pause(800);
    const afterBig = await readTemplate(admin);
    await admin.getByRole("spinbutton", { name: "Key date 1 offset in days" }).fill("");
    const blank = await saveTemplate(admin);
    await admin.reload();
    await admin.getByRole("heading", { name: "Matter defaults" }).waitFor();
    await pause(800);
    const afterBlank = await readTemplate(admin);
    expectThat(big.error && blank.error, `errors ${q([big.error, blank.error])}`);
    expectThat(afterBig.priority === "Low" && afterBig.tasks[0][1] === "2" && afterBlank.dates[0][1] === "10", "a refused save changed the template");
    return `Priority Critical with Task 1 offset 3651: Save template showed ${q(big.error)}; after reload Priority is ${q(afterBig.priority)} and Task 1 offset ${q(afterBig.tasks[0][1])}, so no section saved. A blank Key date 1 offset showed ${q(blank.error)}; after reload it reads ${q(afterBlank.dates[0][1])}.`;
  });

  await step(SC, role, "Test both creation paths, direct creation: Create matter with the template; suggested title, Priority, Risk and Fields; Matter Manager starts as the person who opens it; clear the optional Field; check Overview, Tasks, assignments and Key dates", "Dialog shows the template defaults; the Matter keeps the cleared optional Field empty; Tasks and Key dates use the Matter's UTC creation date; Matter Manager Tasks go to the manager; the Task with no offset has no due date.", async () => {
    await admin.goto(`${BASE}/matters`);
    await admin.getByRole("button", { name: /Create matter|New matter/ }).first().click();
    const d = admin.getByRole("dialog", { name: "Create matter" });
    await d.getByLabel("Matter type").selectOption({ label: T.type });
    await pause(800);
    const templateOptions = await d.getByLabel("Matter template").locator("option").allInnerTexts();
    await d.getByLabel("Matter template").selectOption({ label: T.name });
    await pause(1000);
    const suggested = {
      title: await d.getByLabel("Title").inputValue(),
      priority: await d.getByLabel("Priority").locator("option:checked").innerText(),
      risk: await d.getByLabel("Risk").locator("option:checked").innerText(),
      manager: await d.getByLabel("Matter Manager").locator("option:checked").innerText(),
      region: await d.getByRole("textbox", { name: T.region, exact: true }).inputValue(),
      counsel: await d.getByRole("textbox", { name: T.counsel, exact: true }).inputValue(),
    };
    expectThat(suggested.title.trim() === "Supplier -" && suggested.priority === "Low" && suggested.risk === "Medium" && suggested.manager === ADMIN.displayName, `suggested ${q(suggested)}`);
    await d.getByLabel("Title").fill(`Supplier - ${G} Direct matter ${stamp}`);
    await d.getByRole("textbox", { name: T.region, exact: true }).fill("");
    const posted = admin.waitForRequest((r) => r.method() === "POST" && /\/api\/v1\/matters$/.test(r.url()));
    await d.getByRole("button", { name: "Create" }).click();
    S.createBody = JSON.parse((await posted).postData() ?? "{}");
    await admin.waitForURL(/\/matters\/\d+/, { timeout: 20000 });
    const number = admin.url().match(/\/matters\/(\d+)/)[1];
    S.directMatter = number;
    results.records.push({ kind: "matter", name: `Supplier - ${G} Direct matter ${stamp}`, number });
    const snap = await matterSnapshot(admin, number);
    const anchor = snap.m.createdAt.slice(0, 10);
    const tf = taskFacts(snap.apiTasks);
    const df = dateFacts(snap.apiDates);
    const cf = snap.m.customFields ?? {};
    const regionValue = Object.entries(cf).find(([k]) => k.includes("template_region"))?.[1] ?? null;
    const counselValue = Object.entries(cf).find(([k]) => k.includes("template_counsel"))?.[1] ?? null;
    const expectTasks = [[T.task1, utcDatePlus(anchor, 2), ADMIN.displayName], [T.task3, utcDatePlus(anchor, 5), ADMIN.displayName], [T.task2, null, null]];
    const expectDates = [[T.date1, utcDatePlus(anchor, 10)], [T.date2, anchor]];
    const tfSorted = expectTasks.map((e) => tf.find((t) => t[0] === e[0]));
    const dfSorted = expectDates.map((e) => df.find((t) => t[0] === e[0]));
    S.directSnapshot = { tasks: tf, dates: df };
    expectThat(snap.m.priority === "low" && snap.m.risk === "medium", `priority/risk ${snap.m.priority}/${snap.m.risk}`);
    expectThat((regionValue === null || regionValue === "") && counselValue === "DOC-029 Fictional Counsel LLP", `fields ${q(cf)}`);
    expectThat(q(tfSorted) === q(expectTasks), `tasks ${q(tf)} expected ${q(expectTasks)}`);
    expectThat(q(dfSorted.map((x) => x && [x[0], String(x[1]).slice(0, 10)])) === q(expectDates), `dates ${q(df)} expected ${q(expectDates)}`);
    return `Template choices for the type: ${q(templateOptions)}. Choosing the template filled ${q(suggested)}. With the optional region cleared, Create opened M-${number}, created ${snap.m.createdAt} (UTC anchor ${anchor}). API: priority ${q(snap.m.priority)}, risk ${q(snap.m.risk)}, region ${q(regionValue)}, counsel ${q(counselValue)}. Tasks page rows ${q(snap.tasks)}. Key dates page rows ${q(snap.dates)}. Task facts ${q(tf)}; Key date facts ${q(df)}.`;
  });

  await step(SC, role, "Direct creation with Matter Manager set to Unassigned", "Matter Manager Tasks stay unassigned.", async () => {
    await admin.goto(`${BASE}/matters`);
    await admin.getByRole("button", { name: /Create matter|New matter/ }).first().click();
    const d = admin.getByRole("dialog", { name: "Create matter" });
    await d.getByLabel("Matter type").selectOption({ label: T.type });
    await pause(800);
    await d.getByLabel("Matter template").selectOption({ label: T.name });
    await pause(800);
    await d.getByLabel("Title").fill(`Supplier - ${G} Unassigned matter ${stamp}`);
    await d.getByLabel("Matter Manager").selectOption({ label: "Unassigned" });
    await d.getByRole("button", { name: "Create" }).click();
    await admin.waitForURL(/\/matters\/\d+/, { timeout: 20000 });
    const number = admin.url().match(/\/matters\/(\d+)/)[1];
    results.records.push({ kind: "matter", name: `Supplier - ${G} Unassigned matter ${stamp}`, number });
    const snap = await matterSnapshot(admin, number);
    const tf = taskFacts(snap.apiTasks);
    expectThat(tf.length === 3 && tf.every((t) => t[2] === null), `assignees ${q(tf)}`);
    return `M-${number} with Matter Manager Unassigned has Tasks ${q(tf)}; the Tasks page rows read ${q(snap.tasks)}.`;
  });

  await step("V-C39,V-C40", role, "Test both creation paths, Request conversion: convert the Matter form Request with the Matter type and template; check carried answers, defaults, Priority, Risk, title, Manager, Tasks and Key dates", "The Entity answer carries; template Field defaults fill the rest; Priority stays the Request's Urgency, Risk stays unset, the title has no template prefix; the converting person is Matter Manager and gets the Manager Tasks; dates use the new Matter's UTC creation date.", async () => {
    const d = await openConvert(admin, S.matterRequest, "matter");
    const priorityBefore = await d.getByRole("combobox", { name: "Priority" }).locator("option:checked").innerText();
    await d.getByRole("combobox", { name: "Matter type" }).selectOption({ label: T.type });
    await pause(1500);
    const templates = await d.getByRole("combobox", { name: "Matter template" }).locator("option").allInnerTexts();
    await d.getByRole("combobox", { name: "Matter template" }).selectOption({ label: T.name });
    await pause(1500);
    const text = (await d.innerText()).replace(/\s+/g, " ");
    const notCarry = text.match(/Does not carry into the matter.{0,120}/)?.[0] ?? null;
    const reviewed = {
      title: await d.getByRole("textbox", { name: "Title" }).inputValue(),
      priority: await d.getByRole("combobox", { name: "Priority" }).locator("option:checked").innerText(),
      region: await d.getByRole("textbox", { name: T.region, exact: true }).inputValue().catch(() => null),
      counsel: await d.getByRole("textbox", { name: T.counsel, exact: true }).inputValue().catch(() => null),
    };
    await d.getByRole("button", { name: "Convert to matter" }).click();
    await d.waitFor({ state: "hidden", timeout: 20000 });
    const req = await api(admin, "GET", `/api/v1/requests/${S.matterRequest}`);
    const outcome = req.body?.request?.convertedRecord;
    expectThat(outcome?.module === "matter", `outcome ${q(outcome)}`);
    const number = outcome.number;
    S.convertedMatter = number;
    results.records.push({ kind: "matter", from: `R-${S.matterRequest}`, number });
    const snap = await matterSnapshot(admin, number);
    const anchor = snap.m.createdAt.slice(0, 10);
    const tf = taskFacts(snap.apiTasks);
    const df = dateFacts(snap.apiDates);
    const cf = snap.m.customFields ?? {};
    const entityValue = Object.entries(cf).find(([k]) => k.includes("supplier_entity"))?.[1] ?? null;
    const expectTasks = [[T.task1, utcDatePlus(anchor, 2), ADMIN.displayName], [T.task3, utcDatePlus(anchor, 5), ADMIN.displayName], [T.task2, null, null]];
    const tfSorted = expectTasks.map((e) => tf.find((t) => t[0] === e[0]));
    const expectDates = [[T.date1, utcDatePlus(anchor, 10)], [T.date2, anchor]];
    const dfSorted = expectDates.map((e) => df.find((t) => t[0] === e[0]));
    expectThat(snap.m.title === S.matterRequestTitle, `title ${snap.m.title}`);
    expectThat(snap.m.priority === "high" && snap.m.risk === null, `priority/risk ${snap.m.priority}/${snap.m.risk}`);
    expectThat(snap.m.manager?.displayName === ADMIN.displayName, `manager ${q(snap.m.manager)}`);
    expectThat(entityValue, `entity value missing ${q(cf)}`);
    expectThat(Object.values(cf).includes("DOC-029 Fictional Counsel LLP") && Object.values(cf).includes("EMEA default"), `template defaults ${q(cf)}`);
    expectThat(q(tfSorted) === q(expectTasks), `tasks ${q(tf)} expected ${q(expectTasks)}`);
    expectThat(q(dfSorted.map((x) => x && [x[0], String(x[1]).slice(0, 10)])) === q(expectDates), `dates ${q(df)}`);
    expectThat(!notCarry, `an answer stayed behind: ${notCarry}`);
    return `Convert R-${S.matterRequest} to a matter opened with Priority ${q(priorityBefore)} (the Request's Urgency). Template choices ${q(templates)}. After choosing type and template the dialog showed ${q(reviewed)} and no "Does not carry into the matter" list. Convert created M-${number} (created ${snap.m.createdAt}, UTC anchor ${anchor}; the Request was submitted earlier). API: title ${q(snap.m.title)}, priority ${q(snap.m.priority)} (template default was Low), risk ${q(snap.m.risk)} (template default was Medium), manager ${q(snap.m.manager?.displayName)}, Entity value present, template Field defaults present. Task facts ${q(tf)}; Key date facts ${q(df)}.`;
  });

  await step(SC, role, "Change or archive a template: edit and save; existing Matters keep their Tasks and dates; a new Matter uses the change; Archive template removes it from creation; Show archived > Restore brings it back", "The earlier Matter is unchanged; a new Matter shows the edited Task; the archived template is not offered and cannot be used; Restore makes it available.", async () => {
    await admin.goto(S.templateUrl);
    await admin.getByRole("heading", { name: "Matter defaults" }).waitFor();
    const edited = `${T.task1} revised`;
    await admin.getByRole("textbox", { name: "Task 1 title" }).fill(edited);
    await admin.getByRole("spinbutton", { name: "Task 1 due offset in days" }).fill("3");
    const saved = await saveTemplate(admin);
    expectThat(!saved.error, `save error ${saved.error}`);
    const before = S.directSnapshot.tasks;
    const directNow = taskFacts((await api(admin, "GET", `/api/v1/matters/${S.directMatter}/tasks`)).body);
    expectThat(q(directNow) === q(before), `existing Matter changed: ${q(directNow)}`);
    await admin.goto(`${BASE}/matters`);
    await admin.getByRole("button", { name: /Create matter|New matter/ }).first().click();
    let d = admin.getByRole("dialog", { name: "Create matter" });
    await d.getByLabel("Matter type").selectOption({ label: T.type });
    await pause(800);
    await d.getByLabel("Matter template").selectOption({ label: T.name });
    await pause(800);
    await d.getByLabel("Title").fill(`Supplier - ${G} After change matter ${stamp}`);
    await d.getByRole("button", { name: "Create" }).click();
    await admin.waitForURL(/\/matters\/\d+/, { timeout: 20000 });
    const number = admin.url().match(/\/matters\/(\d+)/)[1];
    results.records.push({ kind: "matter", name: `Supplier - ${G} After change matter ${stamp}`, number });
    const m = (await api(admin, "GET", `/api/v1/matters/${number}`)).body.matter;
    const newTasks = taskFacts((await api(admin, "GET", `/api/v1/matters/${number}/tasks`)).body);
    const newTask1 = newTasks.find((t) => t[0] === edited);
    expectThat(newTask1 && newTask1[1] === utcDatePlus(m.createdAt, 3), `new Matter tasks ${q(newTasks)}`);
    // Archive.
    await openTemplates(admin, T.type);
    await admin.getByRole("button", { name: `Archive ${T.name}`, exact: true }).click();
    const ad = admin.getByRole("dialog");
    const adText = (await ad.innerText()).replace(/\s+/g, " ");
    await ad.getByRole("button", { name: "Archive template" }).click();
    await ad.waitFor({ state: "hidden", timeout: 15000 });
    await admin.goto(`${BASE}/matters`);
    await admin.getByRole("button", { name: /Create matter|New matter/ }).first().click();
    d = admin.getByRole("dialog", { name: "Create matter" });
    await d.getByLabel("Matter type").selectOption({ label: T.type });
    await pause(800);
    const archivedOptions = await d.getByLabel("Matter template").locator("option").allInnerTexts();
    await d.getByRole("button", { name: "Cancel" }).click();
    expectThat(!archivedOptions.includes(T.name), `archived template offered ${q(archivedOptions)}`);
    const body = { ...S.createBody, title: `${G} Refused archived template ${stamp}` };
    const refused = await api(admin, "POST", "/api/v1/matters", body);
    expectThat(refused.status >= 400, `API accepted the archived template (${refused.status})`);
    await openTemplates(admin, T.type);
    await admin.getByRole("switch", { name: "Show archived" }).click();
    await admin.getByRole("button", { name: `Restore ${T.name}`, exact: true }).click();
    await admin.getByRole("button", { name: `Archive ${T.name}`, exact: true }).waitFor({ timeout: 15000 });
    await admin.goto(`${BASE}/matters`);
    await admin.getByRole("button", { name: /Create matter|New matter/ }).first().click();
    d = admin.getByRole("dialog", { name: "Create matter" });
    await d.getByLabel("Matter type").selectOption({ label: T.type });
    await pause(800);
    const restoredOptions = await d.getByLabel("Matter template").locator("option").allInnerTexts();
    await d.getByRole("button", { name: "Cancel" }).click();
    expectThat(restoredOptions.includes(T.name), "restored template not offered");
    return `Task 1 was renamed ${q(edited)} with offset 3 and saved. M-${S.directMatter} still has Tasks ${q(directNow)}. New M-${number} (created ${m.createdAt}) has ${q(newTask1)}. The Archive dialog read ${q(adText.slice(0, 200))}; after Archive template the Create matter dialog offered ${q(archivedOptions)}. POST /api/v1/matters with the archived template id (same body the dialog sent earlier) answered ${refused.status} ${q(refused.body?.detail ?? refused.body?.title ?? null)}. Show archived > Restore made it available again: ${q(restoredOptions)}.`;
  });

  await step(SC, role, "A Field detached from the template's type: the editor names its retained saved value; reattach restores it", "After Detach the editor says the Field is no longer attached and shows the retained value; after reattach the default is editable again.", async () => {
    await admin.goto(S.templateTypeUrl);
    await admin.getByRole("heading", { name: "Attached fields" }).waitFor();
    await admin.getByRole("button", { name: `Detach ${T.region}` }).click();
    await until(async () => (await admin.getByRole("list", { name: "Attached fields" }).getByText(T.region, { exact: true }).count()) === 0, "not detached");
    await admin.goto(S.templateUrl);
    await admin.getByRole("heading", { name: "Custom field defaults" }).waitFor();
    await pause(1000);
    const note = (await admin.getByText(/is no longer attached to this Matter type/).textContent()).trim();
    await admin.goto(S.templateTypeUrl);
    await admin.getByRole("button", { name: "Attach field" }).click();
    await pickMenuItem(admin, T.region);
    await admin.getByRole("list", { name: "Attached fields" }).getByText(T.region, { exact: true }).waitFor();
    await admin.goto(S.templateUrl);
    await admin.getByRole("heading", { name: "Custom field defaults" }).waitFor();
    await pause(1000);
    const value = await admin.getByRole("textbox", { name: T.region, exact: true }).inputValue();
    expectThat(/EMEA default/.test(note) && value === "EMEA default", `note ${note}, value ${value}`);
    return `After Detach on the type, the template editor read ${q(note)}. After Attach field on the type again, the default control shows ${q(value)}.`;
  });
}

// =====================================================================
// V-C41 reminders-and-audit: lead times and delivery
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
const ZONES = ["Asia/Dubai", "Asia/Tokyo", "Europe/London", "America/New_York", "Pacific/Honolulu", "Pacific/Pago_Pago", "Asia/Kolkata", "Australia/Sydney"];

async function leadTimes(page) {
  await page.getByRole("heading", { name: "Reminder lead times" }).waitFor();
  await pause(500);
  return page.getByRole("button", { name: /^Reorder / }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label").replace(/^Reorder (.*), position.*$/, "$1")));
}
async function addLeadTime(page, days) {
  await page.getByRole("button", { name: "Add lead time" }).click();
  const input = page.getByRole("spinbutton", { name: "days before the date" });
  await input.fill(String(days));
  await input.press("Enter");
  await pause(1200);
  const open = page.getByRole("listitem").filter({ has: page.getByRole("spinbutton", { name: "days before the date" }) });
  if (await open.count()) return (await open.innerText()).replace(/\s+/g, " ").trim();
  return null;
}
function dayLabel(days) {
  return days === 0 ? "On the day" : days === 1 ? "1 day before" : `${days} days before`;
}

async function runMorningRound() {
  const script = `const m=await import('/app/node_modules/.pnpm/pg-boss@12.32.0/node_modules/pg-boss/dist/index.js');
const b=new m.PgBoss({connectionString:process.env.DATABASE_URL, supervise:false, schedule:false});
await b.start();
let id=null; for (let i=0;i<60 && !id;i++){ id=await b.send('notification.morning-round',{}); if(!id) await new Promise(r=>setTimeout(r,2000)); }
const sent=new Date().toISOString(); let job=null;
for (let i=0;i<120;i++){ job=await b.getJobById('notification.morning-round', id); if(job && ['completed','failed','cancelled'].includes(job.state)) break; await new Promise(r=>setTimeout(r,1000)); }
console.log(JSON.stringify({id, sent, state: job?.state, completedOn: job?.completedOn, output: job?.output ?? null}));
await b.stop({graceful:false, wait:false}); process.exit(0);`;
  const out = execFileSync("docker", ["exec", "-w", "/app/apps/api", `${PROJECT}-worker-1`, "node", "--input-type=module", "-e", script], { timeout: 300000 }).toString().trim().split("\n").pop();
  return JSON.parse(out);
}

async function inviteAndActivate(admin, browser, displayName, email) {
  await admin.goto(`${BASE}/settings/users`);
  await admin.getByRole("button", { name: "Invite user" }).click();
  const d = admin.getByRole("dialog", { name: "Invite user" });
  await d.getByLabel("Display name").fill(displayName);
  await d.getByLabel("Email").fill(email);
  await d.getByRole("radio", { name: "Legal team member" }).check();
  await d.getByRole("button", { name: "Send invite" }).click();
  await d.waitFor({ state: "hidden", timeout: 15000 });
  let href = null;
  for (let i = 0; i < 60 && !href; i++) {
    const id = await newestMailId(email);
    if (id) {
      const m = await fetch(`${MAIL}/api/v1/message/${id}`).then((r) => r.json());
      const match = m.Text.match(/https?:\/\/[^\s)\]]+\/auth\/set-password[^\s)\]]*/);
      if (match) href = toLab(match[0]);
    }
    if (!href) await pause(500);
  }
  expectThat(href, `no invitation mail for ${email}`);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(href);
  await page.getByLabel("New password").fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Set password" }).click();
  await page.getByText("Password set").waitFor({ timeout: 20000 });
  await signIn(page, email, displayName);
  return { ctx, page };
}

async function setTimezone(page, zone) {
  await page.goto(`${BASE}/settings/profile`);
  const combo = page.getByRole("combobox", { name: "Timezone" });
  await combo.click();
  await combo.fill(zone.split("/").pop().replace(/_/g, " "));
  await page.getByRole("option", { name: new RegExp(escapeRe(zone.split("/").pop().replace(/_/g, " "))) }).first().click();
  await pause(1500);
  const me = await api(page, "GET", "/api/v1/me");
  return me.body?.user?.timezone ?? me.body?.timezone;
}

async function addKeyDate(page, matterNumber, { date, event, extraLead = null, onlyRecipient = null }) {
  await page.goto(`${BASE}/matters/${matterNumber}/key-dates`);
  await page.getByRole("button", { name: "Add date" }).click();
  const d = page.getByRole("dialog", { name: "Add a Key date" });
  await d.getByLabel("Date").fill(date);
  await d.getByLabel("Event").fill(event);
  if (extraLead !== null) {
    await d.getByRole("spinbutton", { name: "Additional lead time (days before)" }).fill(String(extraLead));
    await d.getByRole("button", { name: "Add lead time" }).click();
  }
  let remind = (await d.getByText(/^This date will remind:/).textContent()).trim();
  if (onlyRecipient) await d.getByRole("checkbox", { name: onlyRecipient }).check();
  await d.getByRole("button", { name: "Add date" }).click();
  await d.waitFor({ state: "hidden", timeout: 15000 });
  return remind;
}

async function remindersSection(admin, browser) {
  const SC = "V-C41";
  const role = "administrator";
  currentPage = admin;
  let original = null;

  await step(SC, role, "Set reminder lead times, steps 1-2: profile menu > Settings > Organization > Notifications opens Reminder lead times; Personal > Notifications is a different page", "Organization > Notifications shows Reminder lead times; Personal > Notifications shows the person's own preferences.", async () => {
    await openSettings(admin, "Organization", "Notifications");
    original = await leadTimes(admin);
    const orgPath = new URL(admin.url()).pathname;
    const rail = admin.getByRole("navigation", { name: "Settings sections" });
    await rail.getByRole("group", { name: "Personal" }).getByRole("link", { name: "Notifications", exact: true }).click();
    await admin.getByRole("heading", { name: "Notification preferences" }).waitFor();
    const personalPath = new URL(admin.url()).pathname;
    S.originalLeadTimes = original;
    return `Organization > Notifications opened ${orgPath} with heading Reminder lead times and the list ${q(original)}. Personal > Notifications opened ${personalPath} with heading Notification preferences.`;
  });

  await step(SC, role, "Steps 3-5: Add lead time 9 with Enter, refuse a duplicate and 731, reorder with the arrow keys, reload and confirm; check the 20-entry limit and that the last entry cannot be removed", "9 days before is added; a duplicate and 731 are refused; the reordered list persists; a 21st entry is refused; the last entry has no working Remove.", async () => {
    await openSettings(admin, "Organization", "Notifications");
    await leadTimes(admin);
    const addAlerts = await addLeadTime(admin, 9);
    await admin.getByRole("button", { name: /^Reorder 9 days before, position/ }).waitFor({ timeout: 10000 });
    const dup = await addLeadTime(admin, 9);
    const listAfterDup = await leadTimes(admin);
    await admin.keyboard.press("Escape");
    const tooBig = await addLeadTime(admin, 731);
    await admin.keyboard.press("Escape");
    const listAfterBig = await leadTimes(admin);
    expectThat(listAfterDup.filter((l) => l === "9 days before").length === 1, `duplicate added: ${q(listAfterDup)}`);
    expectThat(!listAfterBig.includes("731 days before"), `731 added: ${q(listAfterBig)}`);
    const before = await reorderPosition(admin, "9 days before");
    await admin.getByRole("button", { name: /^Reorder 9 days before, position/ }).focus();
    await admin.keyboard.press("ArrowUp");
    await until(async () => (await reorderPosition(admin, "9 days before")) === before - 1, "lead time did not move");
    await pause(1500);
    await admin.reload();
    const reloaded = await leadTimes(admin);
    expectThat(reloaded.indexOf("9 days before") === before - 2, `reloaded ${q(reloaded)}`);
    await admin.screenshot({ path: path.join(SHOTS, "r1-reminder-lead-times.png") });
    // 20-entry limit.
    const extra = [];
    for (let n = 40; (await leadTimes(admin)).length < 20; n++) {
      await addLeadTime(admin, n);
      extra.push(n);
    }
    const at20 = (await leadTimes(admin)).length;
    const twentyFirst = await addLeadTime(admin, 90);
    await admin.keyboard.press("Escape");
    const after21 = await leadTimes(admin);
    const addDisabled = await admin.getByRole("button", { name: "Add lead time" }).isDisabled();
    expectThat(after21.length === 20 && !after21.includes("90 days before"), `21st entry saved: ${after21.length}`);
    expectThat(dup && tooBig && twentyFirst, "a refusal showed no message");
    for (const n of extra) {
      await admin.getByRole("button", { name: `Remove ${n} days before`, exact: true }).click();
      await admin.getByRole("button", { name: `Remove ${n} days before`, exact: true }).waitFor({ state: "detached", timeout: 10000 });
    }
    return `Add lead time with 9 and Enter added "9 days before" (open add row after Enter: ${q(addAlerts)}). A second 9 was refused in the add row with ${q(dup)}; the list still had one 9. 731 was refused with ${q(tooBig)}. ArrowUp moved 9 from position ${before} to ${before - 1}; after reload the list read ${q(reloaded)}. ${extra.length} temporary entries (40 to ${39 + extra.length}) filled the list to ${at20}; adding 90 was then refused with ${q(twentyFirst)} (Add lead time disabled=${addDisabled}) and the list stayed at ${after21.length}. The temporary entries were removed.`;
  });

  await step(SC, role, "Check delivery, part 1: prepare two eligible fictional Legal Team Members in different saved timezones, a Matter for each, and Key dates at chosen distances", "Invitations activate; timezones save; Key dates show the lead times each will use.", async () => {
    const morning = ZONES.find((z) => localHour(z) >= 9 && localHour(z) <= 22);
    const early = ZONES.find((z) => localHour(z) < 7);
    expectThat(morning && early, `no zone pair for this hour: ${q(ZONES.map((z) => [z, localHour(z)]))}`);
    const users = {};
    for (const [key, zone] of [["ready", morning], ["early", early]]) {
      const displayName = `${G} Reminder ${key} ${stamp}`;
      const email = `doc029-admincfg-${key}-${stamp}@helix.example`;
      const { ctx, page } = await inviteAndActivate(admin, browser, displayName, email);
      const saved = await setTimezone(page, zone);
      expectThat(saved === zone, `timezone saved as ${saved}`);
      const me = await api(page, "GET", "/api/v1/me");
      users[key] = { displayName, email, zone, ctx, page, id: me.body?.user?.id ?? me.body?.id, localHour: localHour(zone), today: localDate(zone) };
      results.records.push({ kind: "user", name: displayName, role: "legal_team_member", timezone: zone });
    }
    S.reminderUsers = users;
    // One Matter each, managed by that person.
    for (const key of ["ready", "early"]) {
      const u = users[key];
      await admin.goto(`${BASE}/matters`);
      await admin.getByRole("button", { name: /Create matter|New matter/ }).first().click();
      const d = admin.getByRole("dialog", { name: "Create matter" });
      const title = `${G} Reminder matter ${key} ${stamp}`;
      await d.getByLabel("Title").fill(title);
      await d.getByLabel("Matter type").selectOption({ label: "Advisory" });
      await pause(500);
      await d.getByLabel("Matter Manager").selectOption({ label: u.displayName });
      await d.getByRole("button", { name: "Create" }).click();
      await admin.waitForURL(/\/matters\/\d+/, { timeout: 20000 });
      u.matter = admin.url().match(/\/matters\/(\d+)/)[1];
      results.records.push({ kind: "matter", name: title, number: u.matter });
    }
    const r = users.ready;
    const plan = [
      { event: `${G} KD org nine ${stamp}`, days: 9, expect: true },
      { event: `${G} KD eleven unlisted ${stamp}`, days: 11, expect: false },
      { event: `${G} KD seven A ${stamp}`, days: 7, expect: true },
      { event: `${G} KD seven B ${stamp}`, days: 7, expect: true },
      { event: `${G} KD own twelve ${stamp}`, days: 12, extraLead: 12, expect: true },
      { event: `${G} KD own three to admin only ${stamp}`, days: 3, extraLead: 3, onlyRecipient: ADMIN.displayName, expect: false },
    ];
    const reminds = [];
    for (const k of plan) {
      k.date = localDate(r.zone, k.days);
      k.remind = await addKeyDate(admin, r.matter, { date: k.date, event: k.event, extraLead: k.extraLead ?? null, onlyRecipient: k.onlyRecipient ?? null });
      reminds.push(`${k.event.replace(`${G} `, "").replace(` ${stamp}`, "")} on ${k.date}: ${k.remind}`);
    }
    const e = users.early;
    const earlyKd = { event: `${G} KD early seven ${stamp}`, days: 7, date: localDate(e.zone, 7) };
    earlyKd.remind = await addKeyDate(admin, e.matter, earlyKd);
    S.keyDatePlan = plan;
    S.earlyKeyDate = earlyKd;
    return `Invited ${q(r.displayName)} and ${q(e.displayName)} as Legal Team Members; each set a password from the invitation mail. ${q(r.displayName)} saved timezone ${r.zone} (local hour ${r.localHour}, past 08:00); ${q(e.displayName)} saved ${e.zone} (local hour ${e.localHour}, before 08:00). Default preferences were kept (Dates approaching In-app on, Dates briefing on). M-${r.matter} (manager ${q(r.displayName)}) got Key dates: ${reminds.join("; ")}. M-${e.matter} (manager ${q(e.displayName)}) got ${q(earlyKd.event)} on ${earlyKd.date}. The organization list includes 9 and 7, not 11, 12, or 3.`;
  });

  await step(SC, role, "Check delivery, part 2: run the morning round in the lab worker, then check each colleague's bell and briefing email", "The past-08:00 colleague gets one reminder for each listed Key date, including both Key dates on the same date and the Key date's own lead time; nothing for 11 days or for the Key date that selects only another recipient. The before-08:00 colleague gets nothing yet.", async () => {
    const r = S.reminderUsers.ready;
    const e = S.reminderUsers.early;
    const job = await runMorningRound();
    expectThat(job.state === "completed", `round state ${job.state}`);
    await pause(3000);
    const bell = await api(r.page, "GET", "/api/v1/notifications");
    const bellText = JSON.stringify(bell.body);
    const items = bell.body?.notifications ?? bell.body?.items ?? [];
    const observed = {};
    for (const k of S.keyDatePlan) observed[k.event] = items.filter((n) => n.eventType === "date.key_date_approaching" && n.payload?.label === k.event).map((n) => `offset ${n.payload.offsetDays}`);
    // Briefing mail.
    let mail = null;
    for (let i = 0; i < 40 && !mail; i++) {
      const search = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${r.email}"`)}`).then((x) => x.json());
      const brief = (search.messages ?? []).find((m) => /briefing/i.test(m.Subject));
      if (brief) mail = await fetch(`${MAIL}/api/v1/message/${brief.ID}`).then((x) => x.json());
      else await pause(750);
    }
    const mailHits = {};
    for (const k of S.keyDatePlan) mailHits[k.event] = mail ? mail.Text.includes(k.event) : null;
    const earlyBell = await api(e.page, "GET", "/api/v1/notifications");
    const earlySearch = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${e.email}"`)}`).then((x) => x.json());
    const earlyMails = (earlySearch.messages ?? []).filter((m) => /briefing/i.test(m.Subject)).length;
    const earlyHasIt = JSON.stringify(earlyBell.body).includes(S.earlyKeyDate.event);
    await r.page.goto(`${BASE}/`);
    const bellButton = (await r.page.getByRole("banner").getByRole("button", { name: /^Notifications/ }).getAttribute("aria-label")) ?? "";
    const wrong = S.keyDatePlan.filter((k) => {
      const got = observed[k.event].length === 1 && mailHits[k.event] === true;
      const none = observed[k.event].length === 0 && mailHits[k.event] === false;
      return k.expect ? !got : !none;
    });
    expectThat(wrong.length === 0, `unexpected reminder outcome for ${q(wrong.map((k) => k.event))}; bell ${q(observed)}; mail ${q(mailHits)}`);
    expectThat(!earlyHasIt && earlyMails === 0, `early colleague was served: bell ${earlyHasIt}, mails ${earlyMails}`);
    return `Queued notification.morning-round in ${PROJECT}-worker-1 at ${job.sent}; job ${job.state} at ${job.completedOn}. ${q(r.displayName)}: GET /api/v1/notifications answered ${bell.status} with ${items.length} items; key_date_approaching items per Key date ${q(observed)}. Briefing mail ${mail ? `subject ${q(mail.Subject)}` : "not found"}; Key date names in the mail ${q(mailHits)}. The colleague's header bell reads ${q(bellButton)}. ${q(e.displayName)} (local hour ${localHour(e.zone)}): bell has the early Key date=${earlyHasIt}; briefing mails ${earlyMails}.`;
  });

  await step(SC, role, "Restore the organization lead time list and confirm it after reload", "The list matches the list recorded before the walkthrough.", async () => {
    await openSettings(admin, "Organization", "Notifications");
    let list = await leadTimes(admin);
    for (const l of list) if (!S.originalLeadTimes.includes(l)) {
      await admin.getByRole("button", { name: `Remove ${l}`, exact: true }).click();
      await admin.getByRole("button", { name: `Remove ${l}`, exact: true }).waitFor({ state: "detached", timeout: 10000 });
    }
    // Last-entry check on a copy: remove down to one, confirm the last cannot go, then add the rest back in order.
    list = await leadTimes(admin);
    for (const l of list.slice(1)) {
      await admin.getByRole("button", { name: `Remove ${l}`, exact: true }).click();
      await admin.getByRole("button", { name: `Remove ${l}`, exact: true }).waitFor({ state: "detached", timeout: 10000 });
    }
    const last = (await leadTimes(admin))[0];
    const lastRemove = admin.getByRole("button", { name: `Remove ${last}`, exact: true });
    const lastDisabled = (await lastRemove.count()) === 0 || (await lastRemove.isDisabled());
    let lastOutcome = lastDisabled ? "Remove is not available" : null;
    if (!lastDisabled) {
      await lastRemove.click();
      await pause(1500);
      lastOutcome = `Remove clicked; alerts ${q(await admin.getByRole("alert").allInnerTexts())}; list ${q(await leadTimes(admin))}`;
    }
    const help = (await admin.getByText(/Keep at least one lead time/).textContent()).trim();
    for (const l of S.originalLeadTimes.slice(1)) {
      const days = l === "On the day" ? 0 : Number(l.match(/\d+/)[0]);
      await addLeadTime(admin, days);
    }
    // Put entries back in the recorded order with the keyboard.
    for (let i = 0; i < S.originalLeadTimes.length; i++) {
      const label = S.originalLeadTimes[i];
      let pos = await reorderPosition(admin, label);
      while (pos - 1 > i) {
        await admin.getByRole("button", { name: new RegExp(`^Reorder ${escapeRe(label)}, position`) }).focus();
        await admin.keyboard.press("ArrowUp");
        await until(async () => (await reorderPosition(admin, label)) === pos - 1, "restore reorder failed");
        pos -= 1;
      }
    }
    await pause(1500);
    await admin.reload();
    const final = await leadTimes(admin);
    expectThat(q(final) === q(S.originalLeadTimes), `final ${q(final)} vs ${q(S.originalLeadTimes)}`);
    expectThat((await leadTimes(admin)).length > 0, "empty list");
    expectThat(!lastOutcome.startsWith("Remove clicked") || /list \["/.test(lastOutcome), "last entry removed");
    return `Removed the walkthrough's entries. With one entry left (${q(last)}): ${lastOutcome}. The page note reads ${q(help)}. The original entries were added back and reordered; after reload the list reads ${q(final)}, the same as before the walkthrough.`;
  });
}

// =====================================================================
// V-C41 reminders-and-audit: Audit log
// =====================================================================
async function auditRows(page) {
  await pause(1500);
  const table = page.getByRole("table");
  await table.or(page.getByText("No entry matches these filters.")).first().waitFor();
  if (!(await table.count())) return [];
  return (await table.getByRole("row").allInnerTexts()).slice(1).map((t) => t.replace(/\s+/g, " ").trim());
}
async function exportCsv(page) {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Export CSV" }).click()]);
  const dir = mkdtempSync(path.join(os.tmpdir(), "doc029-audit-"));
  const file = path.join(dir, download.suggestedFilename());
  await download.saveAs(file);
  const text = readFileSync(file, "utf8");
  return { name: download.suggestedFilename(), text, lines: text.trim().split("\n") };
}
function browserToday(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function auditSection(admin, member) {
  const SC = "V-C41";
  const role = "administrator";
  currentPage = admin;

  await step(SC, role, "Find a change in the Audit log, steps 1-2: Settings > Security > Audit log; combine Person, Action, and Record to find the walkthrough's lead time changes", "Entries by Daniel Okafor for org_settings.updated on System show the before and after lead times, including 9 days.", async () => {
    await openSettings(admin, "Organization", "Audit log");
    await admin.getByRole("heading", { name: "Audit log" }).waitFor();
    const pathName = new URL(admin.url()).pathname;
    await admin.getByRole("combobox", { name: "Person" }).selectOption({ label: ADMIN.displayName });
    await admin.getByRole("combobox", { name: "Action" }).selectOption({ label: "org_settings.updated" });
    await admin.getByRole("combobox", { name: "Record" }).selectOption({ label: "System" });
    const rows = await auditRows(admin);
    const nine = rows.filter((r) => /Reminder lead times/.test(r) && /9 days/.test(r));
    const header = await admin.getByRole("columnheader").allInnerTexts();
    expectThat(rows.length > 0 && rows.every((r) => r.startsWith(ADMIN.displayName)), `rows ${q(rows.slice(0, 3))}`);
    expectThat(nine.length > 0, "no lead time entry with 9 days");
    S.auditPath = pathName;
    await admin.screenshot({ path: path.join(SHOTS, "r1-audit-log-filtered.png") });
    return `Settings > Security > Audit log opened ${pathName}. Columns ${q(header)}. Person Daniel Okafor + Action org_settings.updated + Record System showed ${rows.length} rows, all by Daniel Okafor. ${nine.length} rows show a 9-day change, for example ${q(nine[nine.length - 1].slice(0, 220))}.`;
  });

  await step(SC, role, "Steps 3-5: narrow with From and To in the browser's local days and with Search; read event, record, audience, and time; Show older; Clear filters", "Today's bounds keep the entries; a range that ends yesterday removes them; Search narrows to the walkthrough's Matter type; Show older adds rows; Clear filters resets every filter.", async () => {
    const today = browserToday(0);
    const yesterday = browserToday(-1);
    await admin.getByRole("textbox", { name: "From" }).fill(today);
    await admin.getByRole("textbox", { name: "To" }).fill(today);
    const todayRows = await auditRows(admin);
    await admin.getByRole("textbox", { name: "From" }).fill(yesterday);
    await admin.getByRole("textbox", { name: "To" }).fill(yesterday);
    const yRows = await auditRows(admin);
    const yText = (await admin.getByText("No entry matches these filters.").count()) ? "No entry matches these filters." : null;
    expectThat(todayRows.length > 0, "no rows today");
    expectThat(yRows.length === 0 || yRows.every((r) => /^No /.test(r)), `rows for yesterday ${q(yRows.slice(0, 2))}`);
    await admin.getByRole("button", { name: "Clear filters" }).click();
    await pause(800);
    const cleared = {
      person: await admin.getByRole("combobox", { name: "Person" }).locator("option:checked").innerText(),
      action: await admin.getByRole("combobox", { name: "Action" }).locator("option:checked").innerText(),
      record: await admin.getByRole("combobox", { name: "Record" }).locator("option:checked").innerText(),
      from: await admin.getByRole("textbox", { name: "From" }).inputValue(),
      to: await admin.getByRole("textbox", { name: "To" }).inputValue(),
      search: await admin.getByRole("searchbox", { name: "Search" }).inputValue(),
    };
    expectThat(cleared.person === "Anyone" && cleared.action === "Any action" && cleared.record === "Any record" && !cleared.from && !cleared.to && !cleared.search, `cleared ${q(cleared)}`);
    const firstPage = (await auditRows(admin)).length;
    const older = admin.getByRole("button", { name: "Show older" });
    await older.waitFor({ timeout: 10000 });
    await older.click();
    await until(async () => (await admin.getByRole("table").getByRole("row").count()) - 1 > firstPage, "Show older added no rows");
    const secondPage = (await auditRows(admin)).length;
    const term = `${G} Supplier assessment`;
    await admin.getByRole("searchbox", { name: "Search" }).fill(term);
    const searched = await auditRows(admin);
    expectThat(searched.length > 0 && searched.every((r) => r.includes("DOC-029 admin-config")), `search rows ${q(searched.slice(0, 3))}`);
    const sample = searched[0];
    await admin.getByRole("button", { name: "Clear filters" }).click();
    return `From and To set to ${today} (browser local day) kept ${todayRows.length} rows; ${yesterday} to ${yesterday} left ${yRows.length} entry rows (${q(yText)}). Clear filters reset to ${q(cleared)}. The unfiltered first page had ${firstPage} rows; Show older made it ${secondPage}. Search ${q(term)} left ${searched.length} rows that all name the walkthrough's records, for example ${q(sample.slice(0, 240))}.`;
  });

  await step(SC, role, "Export CSV applies the current filters", "The downloaded file has a header and only entries that match the filters.", async () => {
    await admin.getByRole("combobox", { name: "Action" }).selectOption({ label: "org_settings.updated" });
    await admin.getByRole("combobox", { name: "Person" }).selectOption({ label: ADMIN.displayName });
    const shown = (await auditRows(admin)).length;
    const href = await admin.getByRole("link", { name: "Export CSV" }).getAttribute("href");
    const csv = await exportCsv(admin);
    const body = csv.lines.slice(1);
    expectThat(body.length > 0 && body.every((l) => l.includes("org_settings.updated") || l.includes("organization settings")), `csv rows ${q(body.slice(0, 2))}`);
    await admin.getByRole("button", { name: "Clear filters" }).click();
    return `With Person Daniel Okafor and Action org_settings.updated, the page showed ${shown} rows. Export CSV (${href}) downloaded ${q(csv.name)} with header ${q(csv.lines[0])} and ${body.length} data lines, all org_settings.updated entries. The file was kept outside the repository and not retained.`;
  });

  await step(SC, "legal_team_member+administrator", "Entries about a Confidential Matter appear only when the Administrator is in its audience, in the page and in Export CSV", "While Nadia Haddad's Confidential Matter excludes Daniel Okafor, Search finds none of its entries and the CSV has none; after Nadia adds Daniel to the Matter team, its entries appear.", async () => {
    currentPage = member;
    const title = `${G} Confidential audit ${stamp}`;
    await member.goto(`${BASE}/matters`);
    await member.getByRole("button", { name: /Create matter|New matter/ }).first().click();
    const d = member.getByRole("dialog", { name: "Create matter" });
    await d.getByLabel("Title").fill(title);
    await d.getByLabel("Matter type").selectOption({ label: "Advisory" });
    await pause(500);
    const manager = await d.getByLabel("Matter Manager").locator("option:checked").innerText();
    await d.getByRole("switch", { name: "Confidential — restrict to the matter team" }).click();
    await d.getByRole("button", { name: "Create" }).click();
    await member.waitForURL(/\/matters\/\d+/, { timeout: 20000 });
    const number = member.url().match(/\/matters\/(\d+)/)[1];
    results.records.push({ kind: "matter (confidential)", name: title, number, createdBy: MEMBER.displayName });
    currentPage = admin;
    const adminRecord = await api(admin, "GET", `/api/v1/matters/${number}`);
    await openSettings(admin, "Organization", "Audit log");
    await admin.getByRole("searchbox", { name: "Search" }).fill(title);
    const hidden = await auditRows(admin);
    const hiddenEntries = hidden.filter((r) => r.includes(title) || r.includes(`M-${number}`));
    const csvHidden = await exportCsv(admin);
    const csvHiddenHits = csvHidden.lines.slice(1).filter((l) => l.includes(title) || l.includes(`M-${number}`)).length;
    expectThat(hiddenEntries.length === 0 && csvHiddenHits === 0, `hidden entries shown: page ${hiddenEntries.length}, csv ${csvHiddenHits}`);
    // Nadia adds Daniel to the team.
    currentPage = member;
    await member.goto(`${BASE}/matters/${number}`);
    await member.getByRole("button", { name: "Matter team" }).click();
    await member.getByRole("button", { name: "Add team member" }).click();
    const td = member.getByRole("dialog", { name: "Add team member" });
    await td.getByRole("combobox", { name: "Person" }).selectOption({ label: ADMIN.displayName });
    await td.getByRole("button", { name: "Add", exact: true }).click();
    await td.waitFor({ state: "hidden", timeout: 15000 });
    await until(async () => (await api(admin, "GET", `/api/v1/matters/${number}`)).status === 200, "Daniel still cannot read the Matter");
    currentPage = admin;
    await admin.getByRole("button", { name: "Clear filters" }).click();
    await admin.getByRole("searchbox", { name: "Search" }).fill(title);
    const shown = await auditRows(admin);
    const csvShown = await exportCsv(admin);
    const csvShownHits = csvShown.lines.slice(1).filter((l) => l.includes(title) || l.includes(`M-${number}`) || l.includes("matter.created")).length;
    expectThat(shown.length > 0 && csvShownHits > 0, `entries still hidden: page ${shown.length}, csv ${csvShownHits}`);
    await admin.getByRole("button", { name: "Clear filters" }).click();
    return `Nadia Haddad created Confidential M-${number} ${q(title)} with Matter Manager ${q(manager)}. Daniel Okafor's GET /api/v1/matters/${number} answered ${adminRecord.status}. Search for the title in the Audit log showed ${hiddenEntries.length} entries for it, and Export CSV held ${csvHiddenHits}. After Nadia added Daniel Okafor from Matter team, the same Search showed ${shown.length} rows, for example ${q(shown[0]?.slice(0, 200))}, and the CSV held ${csvShownHits} matching lines.`;
  });
}

// =====================================================================
// Negative access checks (V-C38, V-C39, V-C40, V-C41)
// =====================================================================
async function accessSection(member, business) {
  const pages = [
    ["V-C38", "/settings/matters/types", "POST", "/api/v1/matter-types", { displayName: `${G} refused type ${stamp}` }],
    ["V-C38", "/settings/matters/fields", "POST", "/api/v1/fields", { displayName: `${G} refused field ${stamp}`, fieldType: "text", moduleScope: "matter", fieldTag: "business" }],
    ["V-C39", "/settings/matters/templates", "GET", "/api/v1/matter-templates", null],
    ["V-C40", "/settings/intake/request-types", "POST", "/api/v1/request-types", { displayName: `${G} refused request type ${stamp}` }],
    ["V-C41", "/settings/reminders", "PUT", "/api/v1/org/reminder-offsets", { offsets: [1] }],
    ["V-C41", "/settings/audit-log", "GET", "/api/v1/audit-log", null],
  ];
  for (const [who, page, label] of [["legal_team_member", member, MEMBER.displayName], ["business_user", business, BUSINESS.displayName]]) {
    currentPage = page;
    const me = await api(page, "GET", "/api/v1/me");
    const actualRole = me.body?.user?.role ?? me.body?.role;
    for (const [sc, url, method, apiUrl, body] of pages) {
      await step(sc, who, `Negative: ${label} (${who}) opens ${url} and calls ${method} ${apiUrl}`, "The Settings page does not open for this role and the API refuses the call.", async () => {
        expectThat(actualRole === who, `signed-in role is ${actualRole}`);
        await page.goto(`${BASE}${url}`);
        await pause(2500);
        const landed = new URL(page.url()).pathname;
        const res = await api(page, method, apiUrl, body);
        expectThat(landed !== url, `${who} stayed on ${url}`);
        expectThat(res.status === 403 || res.status === 401, `API answered ${res.status}`);
        return `/api/v1/me reports ${q(actualRole)}. ${url} sent the browser to ${landed}. ${method} ${apiUrl} answered ${res.status}${res.body?.title ? ` (${q(res.body.title)})` : ""}.`;
      });
    }
  }
}

// =====================================================================
// main
// =====================================================================
const browser = await chromium.launch({ headless: true });
try {
  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const admin = await adminContext.newPage();
  await step("all", "administrator", "Sign in as the seeded Administrator", "The app opens with the Administrator's name in the header.", async () => {
    await signIn(admin, ADMIN.email, ADMIN.displayName);
    const me = await api(admin, "GET", "/api/v1/me");
    const r = me.body?.user?.role ?? me.body?.role;
    expectThat(r === "administrator", `role ${r}`);
    return `Signed in through /auth/login; /api/v1/me reports role ${q(r)}.`;
  });
  if (process.env.DEBUG) admin.on("request", (r) => { if (r.url().includes("/api/") && r.method() !== "GET") console.log(new Date().toISOString(), "REQ", r.method(), r.url()); });
  if (SECTIONS.includes("types")) await typesSection(admin);
  if (SECTIONS.includes("reminders")) await remindersSection(admin, browser);
  const memberContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const member = await memberContext.newPage();
  await step("all", "legal_team_member", "Sign in as the seeded Legal Team Member in a separate browser context", "The app opens with the Legal Team Member's name in the header.", async () => {
    await signIn(member, MEMBER.email, MEMBER.displayName);
    return "Signed in through /auth/login in its own browser context.";
  });
  const businessContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const business = await businessContext.newPage();
  await step("all", "business_user", "Sign in as the seeded Business User with a fresh emailed sign-in link in a separate browser context", "The Portal opens.", async () => {
    await magicLinkSignIn(business, BUSINESS.email);
    return `Requested a fresh link at /portal/login and followed it from Mailpit; the browser opened ${new URL(business.url()).pathname}.`;
  });
  if (SECTIONS.includes("forms")) await formsSection(admin, business);
  if (SECTIONS.includes("templates")) await templatesSection(admin, business);
  if (SECTIONS.includes("audit")) await auditSection(admin, member);
  if (SECTIONS.includes("access")) await accessSection(member, business);
} finally {
  save();
  await browser.close();
  console.log(`results: ${OUT}`);
}
