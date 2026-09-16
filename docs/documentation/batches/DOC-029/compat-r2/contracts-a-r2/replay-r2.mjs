// DOC-029 round 2 compatibility replay, group contracts-a. Adapted from contracts-a/walkthrough-r1.mjs:
// only the lab (work2), output paths, reviewer label and record names (DOC-029r2) changed.
// Original header follows.
// DOC-029 independent walkthrough, group contracts-a, round 1.
// Written by the DOC-029 independent walkthrough agent from the text of four guides:
// create-contract (V-C14), contract-stages (V-C15), contract-approvals (V-C16),
// manual-signing (V-C17-manual). The agent did not write these guides.
//
// Run from the repository root against the shared work lab:
//   LAB_PASSWORD=... mise exec -- node docs/documentation/batches/DOC-029/compat-r2/contracts-a-r2/replay-r2.mjs
// The seed password comes from the environment. Magic links are read from the lab
// Mailpit at run time and are never written. The log holds no credentials, cookies,
// links, or raw mail.
import { createRequire } from "node:module";
import { writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../../..");
const require = createRequire(path.join(root, "e2e/package.json"));
const { chromium } = require("@playwright/test");

const BASE = process.env.LAB_APP_URL ?? "http://127.0.0.1:23301";
const MAIL = process.env.LAB_MAIL_URL ?? "http://127.0.0.1:23401";
const PASSWORD = process.env.LAB_PASSWORD;
if (!PASSWORD) throw new Error("LAB_PASSWORD is required");
const OUT = process.env.OUT ?? path.join(here, "replay-r2.json");
const ONLY = (
  process.env.ONLY ?? "create-contract,contract-stages,contract-approvals,manual-signing"
).split(",");
const ROLES = (process.env.ROLES ?? "legal_team_member,administrator").split(",");
const stamp = Date.now();
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

const lab = JSON.parse(readFileSync(path.join(root, ".documentation-labs/work2/lab.json"), "utf8"));
const results = {
  kind: "independent-article-walkthrough-log",
  task: "DOC-029",
  group: "contracts-a",
  round: 2,
  walkthroughReviewer: "DOC-029r2 compatibility reviewer (contracts-a)",
  reviewerKind: "agent",
  appCommit: lab.sourceCommit,
  environment: lab.project,
  appUrl: BASE,
  mailUrl: MAIL,
  buildId: `app ${lab.appImageId}; engine ${lab.engineImageId}`,
  containerImages: lab.containerImages,
  browser:
    "Playwright Chromium from e2e/node_modules, headless, 1280x900 CSS px, one isolated context per identity",
  articleHashes: Object.fromEntries(
    ["create-contract", "contract-stages", "contract-approvals", "manual-signing"].map((id) => [
      id,
      sha(readFileSync(path.join(root, `docs/user-guides/${id}.md`))),
    ]),
  ),
  stamp,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  fixtures: [],
  records: [],
  steps: [],
};
function save() {
  results.finishedAt = new Date().toISOString();
  writeFileSync(OUT, JSON.stringify(results, null, 2));
}

async function step(article, scenario, role, actors, action, expected, fn) {
  const entry = {
    article,
    scenario,
    role,
    actors,
    method: "browser-walkthrough",
    action,
    expected,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    actual: null,
    result: "not-run",
  };
  results.steps.push(entry);
  try {
    entry.actual = await fn();
    entry.result = "pass";
  } catch (error) {
    entry.actual = `Check did not complete: ${String(error?.message ?? error)
      .split("\n")
      .slice(0, 5)
      .join(" ")}`;
    entry.result = "fail";
  }
  entry.finishedAt = new Date().toISOString();
  console.log(
    `[${article}/${role}] ${entry.result.toUpperCase()} ${action}${entry.result === "fail" ? `\n   ${entry.actual}` : ""}`,
  );
  save();
  return entry.result === "pass";
}
function must(condition, message) {
  if (!condition) throw new Error(message);
}
const tidy = (v) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim() : Array.isArray(v) ? v.map(tidy) : v;
const q = (s) => JSON.stringify(tidy(s));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

function pdf(text) {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 14 Tf 72 720 Td (${text.replace(/[()\\]/g, "")}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

// ---------- sessions ----------
const browser = await chromium.launch();
async function passwordSession(email, displayName) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/auth/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 });
  return session(ctx, page, displayName);
}
// Round 2 harness change: other DOC-029r2 groups sign Jonas Weber in on the same lab,
// so a link can be consumed or replaced by theirs. Retry with a fresh link (newest message first).
async function magicSession(email, displayName) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return await magicSessionOnce(email, displayName);
    } catch (error) {
      lastError = error;
      console.log(`magic link attempt ${attempt} for ${displayName} failed; retrying`);
      await sleep(2000 + Math.floor(Math.random() * 3000));
    }
  }
  throw lastError;
}
async function magicSessionOnce(email, displayName) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const since = Date.now() - 1500;
  await page.goto(`${BASE}/portal/login`);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send link" }).click();
  await page.getByRole("heading", { name: "Check your email" }).waitFor({ timeout: 15000 });
  let link;
  for (let i = 0; i < 60 && !link; i++) {
    await sleep(1000);
    const found = await fetch(
      `${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
    ).then((r) => r.json());
    const newest = [...(found.messages ?? [])].sort(
      (a, b) => Date.parse(b.Created) - Date.parse(a.Created),
    );
    for (const m of newest) {
      if (Date.parse(m.Created) < since) continue;
      const msg = await fetch(`${MAIL}/api/v1/message/${m.ID}`).then((r) => r.json());
      const match = msg.Text.match(/https?:\/\/\S+/g)?.find((u) => /magic|token|verify/i.test(u));
      if (match) {
        link = match;
        break;
      }
    }
  }
  if (!link) throw new Error(`no new sign-in link message for ${displayName}`);
  const url = new URL(link);
  const labUrl = new URL(BASE);
  url.protocol = labUrl.protocol;
  url.host = labUrl.host;
  await page.goto(url.toString());
  try {
    await page.waitForURL(
      (u) => u.pathname.startsWith("/portal") && !u.pathname.includes("login"),
      {
        timeout: 30000,
      },
    );
  } catch (error) {
    await ctx.close();
    throw error;
  }
  return session(ctx, page, displayName);
}
function session(ctx, page, displayName) {
  const api = async (method, p, data) => {
    const r = await page.request.fetch(`${BASE}/api/v1${p}`, {
      method,
      data,
      headers: { origin: BASE },
      failOnStatusCode: false,
    });
    let json = null;
    try {
      json = await r.json();
    } catch {}
    return { status: r.status(), json };
  };
  return { ctx, page, api, displayName };
}

const S = {};
S.daniel = await passwordSession("daniel.okafor@helix.example", "Daniel Okafor");
S.nadia = await passwordSession("nadia.haddad@helix.example", "Nadia Haddad");
S.priya = await passwordSession("priya.raman@helix.example", "Priya Raman");
S.marcus = await passwordSession("marcus.oyelaran@helix.example", "Marcus Oyelaran");
S.jonas = await magicSession("jonas.weber@helix.example", "Jonas Weber");
results.identities = [
  { role: "administrator", person: "Daniel Okafor", entry: "password sign-in", context: "daniel" },
  {
    role: "legal_team_member",
    person: "Nadia Haddad",
    entry: "password sign-in",
    context: "nadia",
  },
  {
    role: "legal_team_member (comparison reader and approver)",
    person: "Priya Raman",
    entry: "password sign-in",
    context: "priya",
  },
  {
    role: "legal_team_member (reader outside the team)",
    person: "Marcus Oyelaran",
    entry: "password sign-in",
    context: "marcus",
  },
  {
    role: "business_user",
    person: "Jonas Weber",
    entry: "new magic link from this lab's Mailpit, Portal sign-in",
    context: "jonas",
  },
];

const users = (await S.daniel.api("GET", "/users")).json.users;
const uid = (name) => users.find((u) => u.displayName === name).id;
const options = (await S.daniel.api("GET", "/contracts/options")).json;
const statusByName = (name) => options.contractStatuses.find((s) => s.displayName === name);

// ---------- fixtures (setup through the Administrator API; not article steps) ----------
const FX = {};
async function cleanupFixtures() {
  const cleanup = [];
  const other = options.contractTypes.find((t) => t.displayName === "Other").id;
  const lists = [
    ["status", "/contract-statuses", "contractStatuses"],
    ["group", "/approver-groups", "approverGroups"],
    ["type", "/contract-types", "contractTypes"],
    ["field", "/fields", "fields"],
  ];
  // Archive every live fixture this reviewer created in this or an earlier trial run.
  for (const [label, base, key] of lists) {
    const rows = (await S.daniel.api("GET", base)).json?.[key] ?? [];
    for (const row of rows.filter(
      (x) => /^DOC-029r2 contracts-a /.test(x.displayName ?? x.name ?? "") && !x.archivedAt,
    )) {
      let r = await S.daniel.api("POST", `${base}/${row.id}/archive`, {});
      if (label === "type" && r.status === 409)
        r = await S.daniel.api("POST", `${base}/${row.id}/archive`, { reassignToId: other });
      cleanup.push(
        `${label} ${row.displayName ?? row.name}: ${r.status}${r.status >= 300 ? ` ${q(r.json?.title ?? "")}` : ""}`,
      );
    }
  }
  return cleanup;
}
if (process.env.CLEANUP_ONLY) {
  console.log(await cleanupFixtures());
  await browser.close();
  process.exit(0);
}
{
  const f1 = await S.daniel.api("POST", "/fields", {
    displayName: `DOC-029r2 contracts-a Required number ${stamp}`,
    moduleScope: "contract",
    fieldType: "number",
    fieldTag: "business",
  });
  const f2 = await S.daniel.api("POST", "/fields", {
    displayName: `DOC-029r2 contracts-a Notes ${stamp}`,
    moduleScope: "contract",
    fieldType: "long_text",
    fieldTag: "business",
  });
  const t = await S.daniel.api("POST", "/contract-types", {
    displayName: `DOC-029r2 contracts-a Required type ${stamp}`,
  });
  must(
    f1.status === 201 && f2.status === 201 && t.status === 201,
    `fixture create failed ${f1.status} ${f2.status} ${t.status} ${q(t.json)}`,
  );
  FX.numField = f1.json.field;
  FX.longField = f2.json.field;
  FX.type = t.json.contractType;
  const a1 = await S.daniel.api("POST", `/contract-types/${FX.type.id}/fields`, {
    fieldId: FX.numField.id,
    isRequired: true,
  });
  const a2 = await S.daniel.api("POST", `/contract-types/${FX.type.id}/fields`, {
    fieldId: FX.longField.id,
    isRequired: false,
  });
  must(a1.status === 201 && a2.status === 201, `attach failed ${a1.status} ${a2.status}`);
  const st = await S.daniel.api("POST", "/contract-statuses", {
    displayName: `DOC-029r2 contracts-a review ${stamp}`,
    stage: "review",
  });
  must(st.status === 201, `status fixture ${st.status} ${q(st.json)}`);
  FX.status = st.json.contractStatus;
  const g = await S.daniel.api("POST", "/approver-groups", {
    name: `DOC-029r2 contracts-a sign-off ${stamp}`,
    memberIds: [uid("Marcus Oyelaran"), uid("Priya Raman")],
  });
  must(g.status === 201, `group fixture ${g.status} ${q(g.json)}`);
  FX.group = g.json.approverGroup ?? g.json.group;
  results.fixtures.push(
    {
      kind: "Field",
      name: FX.numField.displayName,
      detail: "number, business, required on the fixture type",
    },
    {
      kind: "Field",
      name: FX.longField.displayName,
      detail: "long text, business, optional on the fixture type",
    },
    {
      kind: "Contract type",
      name: FX.type.displayName,
      detail: "created for the required-Field and Change contract type checks",
    },
    {
      kind: "Contract Status",
      name: FX.status.displayName,
      detail: "Review Stage; renamed during V-C15; archived at the end",
    },
    {
      kind: "Approver group",
      name: FX.group.name,
      detail: "Marcus Oyelaran and Priya Raman; archived at the end",
    },
  );
  save();
}

let seededMatter;
{
  let cursor = null;
  for (let pageNo = 0; pageNo < 20 && !seededMatter; pageNo++) {
    const r = (
      await S.nadia.api("GET", `/matters${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`)
    ).json;
    seededMatter = (r.matters ?? []).find(
      (m) => !m.isConfidential && !m.archivedAt && !/^DOC-/.test(m.title),
    );
    cursor = r.nextCursor;
    if (!cursor) break;
  }
}

// ---------- page helpers ----------
async function checkboxNames(scope) {
  await scope.getByRole("checkbox").first().waitFor();
  const snap = await scope.ariaSnapshot();
  return [...snap.matchAll(/checkbox "([^"]+)"/g)].map((m) => m[1]);
}
async function openContract(s, number, tab = "") {
  await s.page.goto(`${BASE}/contracts/${number}${tab ? `/${tab}` : ""}`);
  await s.page.getByRole("heading", { level: 1 }).waitFor({ timeout: 20000 });
}
const getContract = async (s, number) => (await s.api("GET", `/contracts/${number}`)).json;
async function stageMove(s, number, statusName, { expectGate = null } = {}) {
  const page = s.page;
  const trigger = page.getByRole("button", { name: /— move contract$/ });
  await trigger.click();
  const menu = page.getByRole("menu");
  await menu.waitFor();
  const items = await menu.getByRole("menuitemradio").allInnerTexts();
  await menu.getByRole("menuitemradio").filter({ hasText: statusName }).first().click();
  if (expectGate) {
    const dialog = page.getByRole("dialog", { name: "Move past approval" });
    await dialog.waitFor({ timeout: 10000 });
    return { items, dialog };
  }
  await until(
    async () => (await getContract(s, number)).contract.statusName === statusName,
    `status ${statusName}`,
  );
  return { items };
}
async function statusPill(page) {
  return (await page.getByRole("region").first().innerText()).replace(/\s+/g, " ");
}
async function history(page) {
  const applet = page.getByRole("complementary", { name: "History" });
  if (!(await applet.isVisible().catch(() => false)))
    await page.getByRole("button", { name: "History" }).click();
  await applet.getByRole("list", { name: "History" }).waitFor();
  await sleep(500);
  const text = await applet.getByRole("list", { name: "History" }).innerText();
  await applet.getByRole("button", { name: "Close" }).click();
  return text.replace(/\s+/g, " ");
}
async function createViaDialog(s, { title, typeLabel, owner, confidential, matter }) {
  const page = s.page;
  await page.goto(`${BASE}/contracts`);
  await page.getByRole("button", { name: "Create contract" }).first().click();
  const d = page.getByRole("dialog", { name: "Create contract" });
  await d.getByLabel("Title").fill(title);
  if (matter) {
    await d.getByLabel("Matter").fill(matter);
  }
  await d.getByLabel("Contract type").selectOption({ label: typeLabel });
  if (owner) await d.getByLabel("Owner").selectOption({ label: owner });
  if (confidential) await d.getByRole("switch", { name: /^Confidential/ }).click();
  await d.getByRole("button", { name: "Create", exact: true }).click();
  await page.waitForURL(/\/contracts\/\d+$/, { timeout: 20000 });
  const number = Number(page.url().match(/\/contracts\/(\d+)/)[1]);
  results.records.push({ title, reference: `C-${number}` });
  save();
  return number;
}
async function quickContract(s, role, label, extra = {}) {
  const title = `DOC-029r2 contracts-a ${role} ${label} ${stamp}`;
  const r = await s.api("POST", "/contracts", {
    title,
    contractTypeId: options.contractTypes.find((t) => t.displayName === "MSA").id,
    customFields: {},
    isConfidential: Boolean(extra.confidential),
    managerId: extra.managerId ?? null,
  });
  must(r.status === 201, `setup contract ${r.status} ${q(r.json)}`);
  const number = r.json.contract.number;
  results.records.push({
    title,
    reference: `C-${number}`,
    setup: "created through the acting role's API session as a prerequisite",
  });
  return number;
}

// =====================================================================
// V-C14 create-contract
// =====================================================================
async function createContract(role, A, O) {
  const art = "create-contract";
  const sc = "V-C14";
  const page = A.page;
  const title = `DOC-029r2 contracts-a ${role} C14 ${stamp}`;
  let number;

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "Negative: Create contract refuses a blank Title, a missing Contract type, a blank required Field and an invalid number; archived references are not offered; Cancel creates nothing",
    "Each refusal shows an error in the dialog and no Contract is created; archived type, Entity and person are absent.",
    async () => {
      const before = (await A.api("GET", `/contracts?q=${encodeURIComponent(`refusal ${stamp}`)}`))
        .json;
      await page.goto(`${BASE}/contracts`);
      await page.getByRole("button", { name: "Create contract" }).first().click();
      const d = page.getByRole("dialog", { name: "Create contract" });
      await d.getByRole("button", { name: "Create", exact: true }).click();
      const e1 = (await d.getByText("Name the contract.").innerText()).trim();
      await d.getByLabel("Title").fill(`DOC-029r2 contracts-a ${role} refusal ${stamp}`);
      await d.getByRole("button", { name: "Create", exact: true }).click();
      const e2 = (await d.getByText("Pick a contract type.").innerText()).trim();
      const typeOptions = await d.getByLabel("Contract type").locator("option").allInnerTexts();
      must(
        !typeOptions.includes("Framework agreement"),
        "archived Contract type Framework agreement offered",
      );
      const ownerOptions = await d.getByLabel("Owner").locator("option").allInnerTexts();
      must(!ownerOptions.includes("Gabriel Santos"), "archived person offered as Owner");
      must(!ownerOptions.includes("Jonas Weber"), "Business User offered as Owner");
      const ownerSelected = await d.getByLabel("Owner").locator("option:checked").innerText();
      must(
        ownerSelected === A.displayName,
        `Owner did not start on the acting person: ${ownerSelected}`,
      );
      await d.getByLabel("Contract type").selectOption({ label: FX.type.displayName });
      await d.getByLabel(FX.numField.displayName).waitFor();
      await d.getByLabel(FX.longField.displayName).waitFor();
      await d.getByRole("button", { name: "Create", exact: true }).click();
      const e3 = (await d.getByText(/this contract type requires it/).innerText()).trim();
      await d
        .getByLabel(FX.numField.displayName)
        .fill("twelve")
        .catch(async () => {
          await d.getByLabel(FX.numField.displayName).evaluate((el) => {
            el.type = "text";
          });
          await d.getByLabel(FX.numField.displayName).fill("twelve");
        });
      await d.getByRole("button", { name: "Create", exact: true }).click();
      const e4 = await d
        .getByText(/enter this as a number|requires it/)
        .first()
        .innerText();
      await d.getByLabel(FX.numField.displayName).fill("12");
      await d.getByRole("button", { name: "Cancel" }).click();
      await d.waitFor({ state: "hidden" });
      await sleep(1000);
      const after = (await A.api("GET", `/contracts?q=${encodeURIComponent(`refusal ${stamp}`)}`))
        .json;
      const list = await A.api("GET", "/contracts?limit=100");
      const made = (list.json.contracts ?? []).filter(
        (c) => c.title === `DOC-029r2 contracts-a ${role} refusal ${stamp}`,
      );
      must(made.length === 0, "Cancel or a refusal created a Contract");
      return `Blank Create said ${q(e1)}; with a Title only it said ${q(e2)}. The type list omitted archived "Framework agreement"; Owner omitted archived Gabriel Santos and Business Users and started on ${A.displayName}. The fixture type showed its required and optional Fields; blank required Field said ${q(e3)}; a non-number said ${q(e4.trim())}. Cancel on a complete draft closed the dialog; the Contracts API lists no Contract with that title.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "Create the record: Title, Contract type, Fields, Owner, Confidential, optional Matter search, Create",
    "The app opens the new Contract with its title, type, Legal Owner and a new C- reference, in the Draft Status; the chosen Owner is Legal Owner and the creator is on the team as Creator.",
    async () => {
      await page.goto(`${BASE}/contracts`);
      await page.getByRole("button", { name: "Create contract" }).first().click();
      const d = page.getByRole("dialog", { name: "Create contract" });
      await d.getByLabel("Title").fill(title);
      await d.getByLabel("Contract type").selectOption({ label: "MSA" });
      await d.getByLabel("Governing law").fill("England and Wales");
      await d.getByLabel("Owner").selectOption({ label: "Unassigned" });
      await d.getByLabel("Owner").selectOption({ label: O.displayName });
      await d.getByRole("switch", { name: /^Confidential/ }).click();
      await d.getByLabel("Matter").fill(seededMatter.title.slice(0, 12));
      const matches = d
        .getByRole("list", { name: "Matter matches" })
        .or(d.getByRole("group", { name: "Matter matches" }))
        .or(d.getByLabel("Matter matches"));
      await matches.first().waitFor({ timeout: 10000 });
      await matches
        .first()
        .getByRole("button")
        .filter({ hasText: seededMatter.title })
        .first()
        .click();
      const dialogText = (await d.innerText()).replace(/\s+/g, " ");
      await d.getByRole("button", { name: "Create", exact: true }).click();
      await page.waitForURL(/\/contracts\/\d+$/, { timeout: 20000 });
      number = Number(page.url().match(/\/contracts\/(\d+)/)[1]);
      results.records.push({ title, reference: `C-${number}` });
      await page.getByRole("heading", { level: 1, name: title }).waitFor();
      const header = (await page.getByRole("region", { name: title }).innerText()).replace(
        /\s+/g,
        " ",
      );
      must(header.includes(`C-${number}`) && header.includes("Draft"), `header ${header}`);
      const type = await page
        .getByRole("main")
        .getByLabel("Contract type")
        .locator("option:checked")
        .innerText();
      const legal = (await page.getByRole("button", { name: "Legal Owner" }).innerText()).trim();
      must(type === "MSA" && legal.endsWith(O.displayName), `type ${type} legal ${legal}`);
      const c = await getContract(A, number);
      must(
        c.contract.statusName === "Draft" &&
          c.contract.isConfidential &&
          c.contract.customFields.governing_law === "England and Wales",
        `record ${q(c.contract)}`,
      );
      await page.getByRole("button", { name: "Contract team" }).click();
      const team = (
        await page.getByRole("complementary", { name: "Contract team" }).innerText()
      ).replace(/\s+/g, " ");
      must(
        /Creator/.test(team) &&
          team.includes(A.displayName) &&
          team.includes(O.displayName) &&
          /Legal Owner/.test(team),
        `team ${team}`,
      );
      await page
        .getByRole("complementary", { name: "Contract team" })
        .getByRole("button", { name: "Close" })
        .click();
      const defaults =
        (
          await A.api(
            "GET",
            `/contract-types/${options.contractTypes.find((t) => t.displayName === "MSA").id}/people`,
          )
        ).json?.people ?? [];
      const matterLink = page.getByRole("main").getByText(seededMatter.title);
      const linked = await matterLink
        .first()
        .isVisible()
        .catch(() => false);
      must(linked, "linked Matter not shown");
      return `The dialog selected Matter ${q(`M-${seededMatter.number}`)} (help text in dialog: ${q(dialogText.match(/Link only when[^.]*\. Nothing else flows across the link\./)?.[0])}). Create opened /contracts/${number} directly. Header: ${q(header)}. Overview Contract type MSA, Legal Owner ${q(legal)}; Confidential true; the Governing law Field saved. Contract team: ${q(team)}. MSA has ${defaults.length} default people, so no one else joined.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName, "Marcus Oyelaran"],
    "A link does not copy access: a Legal Team Member outside the Confidential team reads the Matter but not the Contract",
    "The Matter answers; the Confidential Contract is refused for the reader outside its team.",
    async () => {
      const m = await S.marcus.api("GET", `/matters/${seededMatter.number}`);
      const c = await S.marcus.api("GET", `/contracts/${number}`);
      must(
        m.status === 200 && (c.status === 404 || c.status === 403),
        `matter ${m.status} contract ${c.status}`,
      );
      await S.marcus.page.goto(`${BASE}/contracts/${number}`);
      await sleep(2000);
      const body = (
        await S.marcus.page
          .getByRole("main")
          .innerText()
          .catch(() => "")
      )
        .replace(/\s+/g, " ")
        .slice(0, 160);
      must(!body.includes(title), "outsider saw the Contract title");
      return `Marcus Oyelaran: Matter M-${seededMatter.number} answered ${m.status}; Contract C-${number} answered ${c.status}; his page did not show the title (${q(body)}).`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "Rename keeps the C- reference",
    "The reference stays the same after a rename.",
    async () => {
      await page.getByRole("button", { name: "Contract actions" }).click();
      await page.getByRole("menuitem", { name: "Rename contract" }).click();
      const input = page.getByRole("main").getByLabel("Title");
      await sleep(300);
      const focused = await input.evaluate((el) => el === document.activeElement);
      await input.fill(`${title} renamed`);
      await input.press("Enter");
      await until(
        async () => (await getContract(A, number)).contract.title === `${title} renamed`,
        "rename",
      );
      await page.reload();
      await page.getByRole("heading", { level: 1, name: `${title} renamed` }).waitFor();
      const header = (
        await page.getByRole("region", { name: `${title} renamed` }).innerText()
      ).replace(/\s+/g, " ");
      must(header.includes(`C-${number}`), header);
      return `Contract actions > Rename contract focused the Overview Title (${focused}); the new title saved on Enter; header now ${q(header)}.`;
    },
  );
  const title2 = `${title} renamed`;

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "Record the parties and ownership on Overview: Legal Owner, Business Owner, Our entity, Department, Region, Priority, Risk, Description, Value",
    "Core fields appear in the stated order; choices save immediately; Unassigned, Not known yet, No Department and No Region clear; Description saves on leave; Value parts save together; Other needs Custom cadence; emptying Amount removes the value.",
    async () => {
      const main = page.getByRole("main");
      const labels = await main.locator("label, [id]").evaluateAll(() => []);
      const text = (await main.innerText()).replace(/\s+/g, " ");
      const order = [
        "Title",
        "Contract type",
        "Legal Owner",
        "Business Owner",
        "Department",
        "Priority",
        "Risk",
      ].map((l) => text.indexOf(l));
      must(
        order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])),
        `order ${order}`,
      );
      // Legal Owner: pick self, Unassigned clears, pick self again.
      const pickPerson = async (label, name) => {
        await main.getByRole("button", { name: label }).click();
        const dlg = page.getByRole("dialog", { name: label });
        await dlg.getByRole("button", { name, exact: true }).click();
      };
      await pickPerson("Legal Owner", "Unassigned");
      await until(
        async () => (await getContract(A, number)).contract.manager === null,
        "Legal Owner cleared",
      );
      await pickPerson("Legal Owner", A.displayName);
      await until(
        async () => (await getContract(A, number)).contract.manager?.displayName === A.displayName,
        "Legal Owner set",
      );
      await main.getByRole("button", { name: "Legal Owner" }).click();
      const legalOffers = await page
        .getByRole("dialog", { name: "Legal Owner" })
        .getByRole("button")
        .allInnerTexts();
      await page.keyboard.press("Escape");
      must(
        !legalOffers.includes("Jonas Weber") && !legalOffers.includes("Gabriel Santos"),
        `Legal Owner offers ${legalOffers}`,
      );
      await pickPerson("Business Owner", "Jonas Weber");
      await until(
        async () =>
          (await getContract(A, number)).contract.businessOwner?.displayName === "Jonas Weber",
        "Business Owner set",
      );
      // Our entity
      const entityOptions = await main.getByLabel("Our entity").locator("option").allInnerTexts();
      must(!entityOptions.some((o) => o.includes("Portugal")), "archived Entity offered");
      await main.getByLabel("Our entity").selectOption({ label: "Helix Software Ltd" });
      await until(
        async () =>
          (await getContract(A, number)).contract.entity?.legalName === "Helix Software Ltd" ||
          (await getContract(A, number)).contract.entity?.name === "Helix Software Ltd",
        "entity set",
      );
      await main.getByLabel("Our entity").selectOption({ label: "Not known yet" });
      await until(
        async () => (await getContract(A, number)).contract.entity === null,
        "entity cleared",
      );
      await main.getByLabel("Our entity").selectOption({ label: "Helix Software Ltd" });
      await until(
        async () => (await getContract(A, number)).contract.entity !== null,
        "entity set again",
      );
      // Department / Region
      await main.getByLabel("Department").selectOption({ label: "Finance" });
      await until(
        async () => (await getContract(A, number)).contract.owningDepartment != null,
        "department",
      );
      await main.getByLabel("Department").selectOption({ label: "No Department" });
      await until(
        async () => (await getContract(A, number)).contract.owningDepartment == null,
        "department cleared",
      );
      await main.getByLabel("Department").selectOption({ label: "Finance" });
      await main.getByLabel("Region").selectOption({ label: "EMEA" });
      await until(async () => (await getContract(A, number)).contract.region != null, "region");
      await main.getByLabel("Region").selectOption({ label: "No Region" });
      await until(
        async () => (await getContract(A, number)).contract.region == null,
        "region cleared",
      );
      await main.getByLabel("Region").selectOption({ label: "EMEA" });
      await main.getByLabel("Priority").selectOption({ label: "High" });
      await main.getByLabel("Risk").selectOption({ label: "Low" });
      await until(async () => {
        const c = (await getContract(A, number)).contract;
        return (
          c.priority === "high" &&
          c.risk === "low" &&
          c.region != null &&
          c.owningDepartment != null
        );
      }, "priority/risk/region/department");
      // Description
      await main.getByLabel("Description").fill("DOC-029 fictional services description.");
      await main.getByLabel("Description").press("Enter");
      await sleep(800);
      const afterEnter = (await getContract(A, number)).contract.description;
      await main.getByLabel("Priority").focus();
      await until(
        async () =>
          ((await getContract(A, number)).contract.description ?? "").startsWith(
            "DOC-029 fictional services description.",
          ),
        "description on leave",
      );
      // Value
      const value = main.getByRole("group", { name: "Value" });
      await value.getByLabel("Amount").fill("12500");
      await value.getByLabel("Currency").selectOption({ label: "EUR — Euro" });
      await value.getByLabel("Frequency").selectOption({ label: "Other" });
      await value.getByLabel("Custom cadence").waitFor();
      await value.getByLabel("Custom cadence").fill("");
      await value.getByLabel("Custom cadence").press("Enter");
      await sleep(800);
      const cadenceError =
        (await value.innerText().catch(() => "")) +
        ((await main.getByText("Enter a custom cadence.").count())
          ? " [Enter a custom cadence.]"
          : "");
      await value.getByLabel("Custom cadence").fill("each milestone");
      await value.getByLabel("Custom cadence").press("Enter");
      const savedValue = await until(async () => {
        const v = (await getContract(A, number)).contract.value;
        return v && v.currency === "EUR" ? v : null;
      }, "value saved");
      await page.reload();
      await page.getByRole("heading", { level: 1 }).waitFor();
      const reloaded = {
        legal: (await main.getByRole("button", { name: "Legal Owner" }).innerText()).trim(),
        business: (await main.getByRole("button", { name: "Business Owner" }).innerText()).trim(),
        entity: await main.getByLabel("Our entity").locator("option:checked").innerText(),
        department: await main.getByLabel("Department").locator("option:checked").innerText(),
        region: await main.getByLabel("Region").locator("option:checked").innerText(),
        amount: await value.getByLabel("Amount").inputValue(),
        cadence: await value
          .getByLabel("Custom cadence")
          .inputValue()
          .catch(() => null),
        description: await main.getByLabel("Description").inputValue(),
      };
      // Emptying the amount removes the value.
      await value.getByLabel("Amount").click();
      await page.keyboard.press("Control+A");
      await page.keyboard.press("Backspace");
      await page.keyboard.press("Enter");
      await until(
        async () => (await getContract(A, number)).contract.value === null,
        "value removed",
      );
      await value.getByLabel("Amount").fill("12500");
      await value.getByLabel("Currency").selectOption({ label: "EUR — Euro" });
      await value.getByLabel("Frequency").selectOption({ label: "Annually" });
      await value.getByLabel("Amount").press("Enter");
      await until(
        async () => (await getContract(A, number)).contract.value?.currency === "EUR",
        "value restored",
      );
      return `Order on Overview: Title, Contract type, Legal Owner, Business Owner, Department, Priority, Risk. Legal Owner picker offered only staff ${q(legalOffers)}; Unassigned cleared it and ${A.displayName} was set. Business Owner Jonas Weber saved. Our entity omitted the archived Portugal Entity; Not known yet cleared it. No Department and No Region cleared those choices. Priority High and Risk Low saved. Description after Enter only: ${q(afterEnter)}; it saved when focus left. With Frequency Other and a blank Custom cadence, pressing Enter did not save (value API still ${q(null)} or earlier; page note present: ${/Enter a custom cadence\./.test(cadenceError)}); with "each milestone" the group saved ${q(savedValue)}. After reload: ${q(reloaded)}. Emptying Amount removed the value; it was then re-entered as 12500 EUR Annually.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "Counterparties: search, inspect the create action, link two, Make primary, remove one link",
    "A new name offers a create action; the first linked party is primary; Make primary moves the designation; removing a link keeps the Counterparty record.",
    async () => {
      const main = page.getByRole("main");
      const newName = `DOC-029r2 contracts-a ${role} Counterparty ${stamp}`;
      const box = main.getByRole("combobox", { name: "Counterparties" });
      await box.fill(newName);
      const createOption = page
        .getByRole("listbox", { name: "Counterparty matches" })
        .getByRole("option", { name: `Create "${newName}"` });
      await createOption.waitFor({ timeout: 10000 });
      await createOption.click();
      await until(
        async () =>
          ((await getContract(A, number)).counterparties ?? []).some((p) => p.name === newName),
        "new counterparty linked",
      );
      await box.fill("Litware Insurance");
      const existing = page
        .getByRole("listbox", { name: "Counterparty matches" })
        .getByRole("option", { name: "Litware Insurance Company" });
      await existing.waitFor({ timeout: 10000 });
      await existing.click();
      const two = await until(async () => {
        const p = (await getContract(A, number)).counterparties ?? [];
        return p.length === 2 ? p : null;
      }, "two counterparties");
      const primaryFirst = two.find((p) => p.isPrimary)?.name;
      must(primaryFirst === newName, `first primary ${primaryFirst}`);
      const row = main.getByRole("listitem").filter({ hasText: "Litware Insurance Company" });
      await row.getByRole("button", { name: "Make primary" }).click();
      await until(
        async () =>
          ((await getContract(A, number)).counterparties ?? []).find((p) => p.isPrimary)?.name ===
          "Litware Insurance Company",
        "primary moved",
      );
      await main.getByRole("button", { name: `Take ${newName} off the contract` }).click();
      await until(
        async () => ((await getContract(A, number)).counterparties ?? []).length === 1,
        "link removed",
      );
      const still = (
        await A.api("GET", `/counterparties?q=${encodeURIComponent(newName)}`)
      ).json.counterparties.filter((c) => c.name === newName);
      must(still.length === 1, "Counterparty record missing after unlink");
      return `Typing a new name offered ${q(`Create "${newName}"`)}; selecting it linked the new Counterparty as primary. Litware Insurance Company was linked second. Make primary moved the Primary designation to Litware. "Take ${newName} off the contract" left one linked party, and the Counterparty search still returns the record.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "Contract team: Add team member > Person > Add; membership rows and separate statements; removing membership keeps the Business Owner statement",
    "One row per person; Legal Owner, Business Owner and Creator show as statements; taking a person off the team leaves their Business Owner statement.",
    async () => {
      await page.getByRole("button", { name: "Contract team" }).click();
      const applet = page.getByRole("complementary", { name: "Contract team" });
      await applet.getByRole("button", { name: "Add team member" }).click();
      const d = page.getByRole("dialog", { name: "Add team member" });
      await d.getByLabel("Person").selectOption({ label: "Jonas Weber" });
      await d.getByRole("button", { name: "Add", exact: true }).click();
      await d.waitFor({ state: "hidden" });
      await applet.getByRole("listitem").filter({ hasText: "Jonas Weber" }).waitFor();
      const team1 = await until(async () => {
        const t = (await getContract(A, number)).team;
        return t.some((m) => m.displayName === "Jonas Weber") ? t : null;
      }, "Jonas membership");
      const rows1 = await applet.getByRole("listitem").allInnerTexts();
      await applet.getByRole("button", { name: "Take Jonas Weber off the contract team" }).click();
      const team2 = await until(async () => {
        const t = (await getContract(A, number)).team;
        return t.some((m) => m.displayName === "Jonas Weber") ? null : t;
      }, "Jonas membership removed");
      await sleep(500);
      const rows2 = await applet.getByRole("listitem").allInnerTexts();
      const bo = (await getContract(A, number)).contract.businessOwner?.displayName;
      must(bo === "Jonas Weber", `Business Owner after removal ${bo}`);
      // Add Jonas back so the Portal checks below have a team member.
      await applet.getByRole("button", { name: "Add team member" }).click();
      await d.getByLabel("Person").selectOption({ label: "Jonas Weber" });
      await d.getByRole("button", { name: "Add", exact: true }).click();
      await d.waitFor({ state: "hidden" });
      await until(
        async () =>
          (await getContract(A, number)).team.some((m) => m.displayName === "Jonas Weber"),
        "Jonas re-added",
      );
      const rows3 = await applet.getByRole("listitem").allInnerTexts();
      await applet.getByRole("button", { name: "Close" }).click();
      const flat = (a) => a.map((r) => r.replace(/\s+/g, " ").trim());
      must(
        flat(rows3).filter((r) => r.includes("Jonas Weber")).length === 1,
        "more than one row for Jonas",
      );
      return `Membership after Add: ${q(team1.map((m) => m.displayName))}; roster rows ${q(flat(rows1))}. After "Take Jonas Weber off the contract team" membership is ${q(team2.map((m) => m.displayName))}, yet the roster still shows ${q(flat(rows2))} and the record still names Jonas Weber as Business Owner. Re-added: ${q(flat(rows3))}.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "Maintain the values on Fields: text saves on leave or Enter; a choice saves when selected; Escape abandons an unsaved edit",
    "Blur and Enter save; Escape restores the saved value without a save; choices save immediately.",
    async () => {
      await page
        .getByRole("navigation", { name: "Contract sections" })
        .getByRole("link", { name: "Fields" })
        .click();
      const region = page.getByRole("region", { name: "Fields" });
      await region.waitFor();
      await region.getByLabel("Jurisdiction").fill("Courts of London");
      await region.getByLabel("Jurisdiction").press("Tab");
      await until(
        async () =>
          (await getContract(A, number)).contract.customFields.jurisdiction === "Courts of London",
        "blur save",
      );
      await region.getByLabel("Liability cap").fill("Fees paid in 12 months");
      await region.getByLabel("Liability cap").press("Enter");
      await until(
        async () =>
          (await getContract(A, number)).contract.customFields.liability_cap ===
          "Fees paid in 12 months",
        "enter save",
      );
      await region.getByLabel("Liability cap").fill("Unsaved edit");
      await region.getByLabel("Liability cap").press("Escape");
      await sleep(1000);
      const shown = await region.getByLabel("Liability cap").inputValue();
      const stored = (await getContract(A, number)).contract.customFields.liability_cap;
      must(
        shown === "Fees paid in 12 months" && stored === "Fees paid in 12 months",
        `escape shown ${shown} stored ${stored}`,
      );
      await region.getByLabel("Our position").selectOption({ label: "Customer" });
      await until(
        async () =>
          /customer/i.test(
            String((await getContract(A, number)).contract.customFields.our_position),
          ),
        "choice save",
      );
      return `Jurisdiction saved on Tab; Liability cap saved on Enter; an Escape after typing "Unsaved edit" restored ${q(shown)} and the stored value stayed ${q(stored)}; Our position Customer saved on selection.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "Change contract type on Overview asks for missing required Fields; Cancel keeps the type; Change type applies it; long text Enter makes a new line",
    "Change contract type opens for the missing required Field; blank is refused; Cancel keeps MSA; filling it and Change type re-types the record; C- reference unchanged.",
    async () => {
      await page
        .getByRole("navigation", { name: "Contract sections" })
        .getByRole("link", { name: "Overview" })
        .click();
      const main = page.getByRole("main");
      await main.getByLabel("Contract type").selectOption({ label: FX.type.displayName });
      const d = page.getByRole("dialog", { name: "Change contract type" });
      await d.waitFor();
      const note = (await d.innerText()).replace(/\s+/g, " ");
      if (role === "legal_team_member")
        await page.screenshot({ path: path.join(here, "r2-c14-change-contract-type.png") });
      await d.getByRole("button", { name: "Change type" }).click();
      await sleep(800);
      const refusal = (await d.innerText()).replace(/\s+/g, " ");
      must(await d.isVisible(), "dialog closed on blank required Field");
      await d.getByRole("button", { name: "Cancel" }).click();
      await d.waitFor({ state: "hidden" });
      await sleep(500);
      const kept = (await getContract(A, number)).contract.contractTypeName;
      must(kept === "MSA", `type after Cancel ${kept}`);
      await main.getByLabel("Contract type").selectOption({ label: FX.type.displayName });
      await d.waitFor();
      await d.getByLabel(FX.numField.displayName).fill("42");
      await d.getByRole("button", { name: "Change type" }).click();
      await d.waitFor({ state: "hidden" });
      const c = await until(async () => {
        const r = await getContract(A, number);
        return r.contract.contractTypeName === FX.type.displayName ? r : null;
      }, "retyped");
      await page
        .getByRole("navigation", { name: "Contract sections" })
        .getByRole("link", { name: "Fields" })
        .click();
      const region = page.getByRole("region", { name: "Fields" });
      await region.getByLabel(FX.numField.displayName).waitFor();
      const numShown = await region.getByLabel(FX.numField.displayName).inputValue();
      const notes = region.getByLabel(FX.longField.displayName);
      await notes.click();
      await notes.pressSequentially("Line one");
      await notes.press("Enter");
      await notes.pressSequentially("Line two");
      await sleep(600);
      const midValue = (await getContract(A, number)).contract.customFields[FX.longField.slug];
      await region.getByLabel(FX.numField.displayName).focus();
      await until(
        async () =>
          (await getContract(A, number)).contract.customFields[FX.longField.slug] ===
          "Line one\nLine two",
        "long text saved on leave",
      );
      const header = (await page.getByRole("region", { name: title2 }).innerText()).replace(
        /\s+/g,
        " ",
      );
      must(header.includes(`C-${number}`), header);
      return `Selecting ${q(FX.type.displayName)} opened Change contract type: ${q(note.slice(0, 160))}. Change type with the Field blank kept the dialog open: ${q(refusal.slice(0, 200))}. Cancel kept MSA. Filling 42 and Change type re-typed the record; Fields shows ${q(numShown)} for the required number. In the long-text Field, Enter added a new line (no save before leaving: ${q(midValue ?? null)}), and leaving saved two lines. Header still ${q(header)}.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName, "Jonas Weber (Portal)"],
    "Negative: a Business User in the Portal cannot create a Contract directly or assign its Legal Owner",
    "Jonas reaches the Contract he is on in the Portal read-only for legal details, sees no create control, and the API refuses direct creation and a Legal Owner change.",
    async () => {
      const jp = S.jonas.page;
      await jp.goto(`${BASE}/portal/contracts`);
      await sleep(2500);
      const listText = (await jp.getByRole("main").innerText()).replace(/\s+/g, " ");
      const createButtons = await jp
        .getByRole("button", { name: /create contract|new contract/i })
        .count();
      const createLinks = await jp
        .getByRole("link", { name: /create contract|new contract/i })
        .count();
      await jp.goto(`${BASE}/portal/contracts/${number}`);
      await sleep(2500);
      const detail = (await jp.getByRole("main").innerText()).replace(/\s+/g, " ");
      const legalControl =
        (await jp.getByRole("button", { name: "Legal Owner" }).count()) +
        (await jp.getByRole("combobox", { name: "Legal Owner" }).count());
      const post = await S.jonas.api("POST", "/contracts", {
        title: `DOC-029r2 contracts-a portal refusal ${stamp}`,
        contractTypeId: options.contractTypes[0].id,
        customFields: {},
        isConfidential: false,
        managerId: null,
      });
      const patch = await S.jonas.api("PATCH", `/contracts/${number}`, {
        managerId: uid("Jonas Weber"),
      });
      const after = (await getContract(A, number)).contract.manager?.displayName;
      must(
        createButtons + createLinks === 0 && legalControl === 0,
        `portal controls create=${createButtons + createLinks} legal=${legalControl}`,
      );
      must(
        post.status >= 400 && patch.status >= 400 && after === A.displayName,
        `post ${post.status} patch ${patch.status} manager ${after}`,
      );
      must(detail.includes(title2), "Jonas did not reach the Contract in the Portal");
      return `Portal Contracts list showed no create control (list begins ${q(listText.slice(0, 120))}). C-${number} in the Portal shows ${q(detail.slice(0, 220))} with no Legal Owner control. Direct API create answered ${post.status}; a Legal Owner change answered ${patch.status}; Legal Owner is still ${after}.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "Negative: an archived Contract must be restored before editing",
    "Archive shows the archived note and read-only controls; Restore makes the record editable again.",
    async () => {
      await page
        .getByRole("navigation", { name: "Contract sections" })
        .getByRole("link", { name: "Overview" })
        .click();
      await page.getByRole("button", { name: "Contract actions" }).click();
      await page.getByRole("menuitem", { name: "Archive" }).click();
      const confirm = page.getByRole("dialog");
      if (await confirm.isVisible({ timeout: 1500 }).catch(() => false))
        await confirm
          .getByRole("button", { name: /Archive/ })
          .last()
          .click();
      await until(
        async () => (await getContract(A, number)).contract.archivedAt !== null,
        "archived",
      );
      await page.reload();
      await page
        .getByText(
          "This contract is archived — it is out of the contract list. Restore it to edit.",
        )
        .waitFor();
      const main = page.getByRole("main");
      const titleDisabled = await main
        .getByLabel("Title")
        .isDisabled()
        .catch(() => true);
      const typeDisabled = await main
        .getByLabel("Contract type")
        .isDisabled()
        .catch(() => true);
      const stageButton = await page.getByRole("button", { name: /— move contract$/ }).count();
      const patch = await A.api("PATCH", `/contracts/${number}`, { priority: "low" });
      must(
        titleDisabled && typeDisabled && patch.status === 409,
        `disabled ${titleDisabled}/${typeDisabled} patch ${patch.status}`,
      );
      await page.getByRole("button", { name: "Contract actions" }).click();
      await page.getByRole("menuitem", { name: "Restore" }).click();
      if (await confirm.isVisible({ timeout: 1500 }).catch(() => false))
        await confirm
          .getByRole("button", { name: /Restore/ })
          .last()
          .click();
      await until(
        async () => (await getContract(A, number)).contract.archivedAt === null,
        "restored",
      );
      await page.reload();
      await page.getByRole("heading", { level: 1 }).waitFor();
      const enabled = await main.getByLabel("Priority").isEnabled();
      must(enabled, "not editable after Restore");
      return `Archive showed "This contract is archived — it is out of the contract list. Restore it to edit."; Title and Contract type were disabled; ${stageButton} Stage move controls; a direct edit answered ${patch.status}. Restore made Priority editable again.`;
    },
  );
  return number;
}

// =====================================================================
// V-C15 contract-stages
// =====================================================================
async function contractStages(role, A, O, renameTo) {
  const art = "contract-stages";
  const sc = "V-C15";
  const page = A.page;
  const number = await quickContract(A, role, "C15");
  await A.api("POST", `/contracts/${number}/team`, { userId: uid("Jonas Weber") });

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "Change the Status through Review, Approval, Signature and Active; read the Stage beside each Status; check the pill and History",
    "The menu lists each Status with its Stage; each move shows the new Status beside the C- reference and the Stage display, and History records it.",
    async () => {
      await openContract(A, number);
      const seen = [];
      let menuItems;
      for (const [name, stage] of [
        ["Internal review", "Review"],
        ["Awaiting approval", "Approval"],
        ["Out for signature", "Signature"],
        ["Active", "Active"],
      ]) {
        const { items } = await stageMove(A, number, name);
        menuItems ??= items;
        await until(
          async () =>
            (await page.getByRole("button", { name: `${stage} — move contract` }).count()) === 1,
          `stage button ${stage}`,
        );
        const region = (
          await page
            .getByRole("region", { name: new RegExp(`DOC-029r2 contracts-a ${role} C15`) })
            .innerText()
        ).replace(/\s+/g, " ");
        must(region.includes(`C-${number}`) && region.includes(name), region);
        seen.push(`${name} -> ${stage}`);
      }
      const envelopes = (await A.api("GET", `/contracts/${number}/envelopes`)).json.envelopes
        .length;
      const docs = (await A.api("GET", `/contracts/${number}/documents`)).json.documents.length;
      const hist = await history(page);
      must(/Active/.test(hist) && /Out for signature/.test(hist), hist);
      return `Menu items: ${q(menuItems.map((s) => s.replace(/\s+/g, " ")))}. Moves: ${seen.join("; ")}; each time the header showed the Status beside C-${number} and "<Stage> — move contract". Moving to Signature created ${envelopes} Envelopes and Active added ${docs} Documents. History: ${q(hist.slice(0, 400))}.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "Move backwards and skip Stages",
    "A move back to Review and a skip from Review to Active are both accepted.",
    async () => {
      await stageMove(A, number, "Internal review");
      await stageMove(A, number, "Active");
      const c = (await getContract(A, number)).contract;
      return `Active -> Internal review accepted, then Internal review -> Active (skipping Approval and Signature) accepted; now ${c.statusName} (${c.stage}).`;
    },
  );

  await step(
    art,
    sc,
    role,
    [S.daniel.displayName, A.displayName],
    "Negative: renaming a Status does not change its Stage",
    "After the Administrator renames the fixture Status, the menu shows the new name with the same Review Stage and the Contract in that Status keeps Stage review.",
    async () => {
      await stageMove(A, number, FX.status.displayName);
      const r = await S.daniel.api("PATCH", `/contract-statuses/${FX.status.id}`, {
        displayName: renameTo,
      });
      must(r.status === 200, `rename ${r.status}`);
      const refused = await S.daniel.api("PATCH", `/contract-statuses/${FX.status.id}`, {
        displayName: renameTo,
        stage: "active",
      });
      FX.status.displayName = renameTo;
      await page.reload();
      await page.getByRole("heading", { level: 1 }).waitFor();
      const c = (await getContract(A, number)).contract;
      await page.getByRole("button", { name: /— move contract$/ }).click();
      const item = (
        await page.getByRole("menuitemradio").filter({ hasText: renameTo }).first().innerText()
      ).replace(/\s+/g, " ");
      await page.keyboard.press("Escape");
      must(
        c.statusName === renameTo && c.stage === "review" && /Review/.test(item),
        `${c.statusName} ${c.stage} ${item}`,
      );
      return `Moved to the fixture Status; Daniel Okafor renamed it to ${q(renameTo)} (a rename carrying a Stage answered ${refused.status}). The Contract reads ${c.statusName} / ${c.stage}; the menu item reads ${q(item)}.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName, O.displayName],
    "Soft gate: Move past approval lists unresolved approvals; Cancel keeps the Status; Move anyway records the override",
    "Cancel keeps the current Status; Move anyway saves and History records the override; the approval is still pending.",
    async () => {
      await stageMove(A, number, "Awaiting approval");
      const req = await A.api("POST", `/contracts/${number}/approvals`, {
        approverIds: [uid(O.displayName)],
      });
      must(req.status === 201, `approval setup ${req.status}`);
      await page.reload();
      await page.getByRole("heading", { level: 1 }).waitFor();
      let { dialog } = await stageMove(A, number, "Out for signature", { expectGate: true });
      const text = (await dialog.innerText()).replace(/\s+/g, " ");
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      await sleep(800);
      const kept = (await getContract(A, number)).contract.statusName;
      must(kept === "Awaiting approval", `after Cancel ${kept}`);
      ({ dialog } = await stageMove(A, number, "Out for signature", { expectGate: true }));
      await dialog.getByRole("button", { name: "Move anyway" }).click();
      await until(
        async () => (await getContract(A, number)).contract.statusName === "Out for signature",
        "moved anyway",
      );
      const hist = await history(page);
      const approvals = (await A.api("GET", `/contracts/${number}/approvals`)).json.approvals;
      must(
        /overrid/i.test(hist) && approvals[0].status === "pending",
        `hist ${hist.slice(0, 200)} approval ${approvals[0].status}`,
      );
      return `Dialog: ${q(text.slice(0, 240))}. Cancel kept Awaiting approval. Move anyway saved Out for signature. History: ${q(hist.match(/[^.]*overrid[^.]*/i)?.[0]?.slice(0, 200))}. The approval for ${O.displayName} is still ${approvals[0].status}.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "Ended Contracts stay editable",
    "After moving to an Ended Status the record still accepts edits.",
    async () => {
      await stageMove(A, number, "Expired", { expectGate: false }).catch(async () => {
        const g = page.getByRole("dialog", { name: "Move past approval" });
        if (await g.isVisible()) await g.getByRole("button", { name: "Move anyway" }).click();
        await until(
          async () => (await getContract(A, number)).contract.statusName === "Expired",
          "expired",
        );
      });
      const main = page.getByRole("main");
      await main.getByLabel("Priority").selectOption({ label: "Critical" });
      await until(
        async () => (await getContract(A, number)).contract.priority === "critical",
        "ended edit",
      );
      return `Moved to Expired (Ended); Priority Critical saved on the Ended Contract.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName, "Jonas Weber (Portal)"],
    "Negative: archived records and Business Users get no Status control; Restore brings it back",
    "Archived: no Stage move control and a direct write is refused. Jonas in the Portal has no control and cannot change the Status. After Restore the control works.",
    async () => {
      const jp = S.jonas.page;
      await jp.goto(`${BASE}/portal/contracts/${number}`);
      await sleep(2000);
      const jonasControls = await jp.getByRole("button", { name: /move contract/ }).count();
      const jonasPatch = await S.jonas.api("PATCH", `/contracts/${number}`, {
        statusId: statusByName("Active").id,
      });
      const arch = await A.api("POST", `/contracts/${number}/archive`, {});
      must(arch.status < 300, `archive ${arch.status}`);
      await page.reload();
      await page.getByRole("heading", { level: 1 }).waitFor();
      const archivedControls = await page.getByRole("button", { name: /— move contract$/ }).count();
      const patch = await A.api("PATCH", `/contracts/${number}`, {
        statusId: statusByName("Active").id,
      });
      const rest = await A.api("POST", `/contracts/${number}/restore`, {});
      await page.reload();
      await page.getByRole("heading", { level: 1 }).waitFor();
      await stageMove(A, number, "Active");
      const c = (await getContract(A, number)).contract;
      must(
        jonasControls === 0 &&
          jonasPatch.status >= 400 &&
          archivedControls === 0 &&
          patch.status === 409 &&
          c.statusName === "Active",
        `jonas ${jonasControls}/${jonasPatch.status} archived ${archivedControls}/${patch.status}`,
      );
      return `Jonas Weber (team member, Portal) saw ${jonasControls} Status controls and a direct Status write answered ${jonasPatch.status}. Archived C-${number} showed ${archivedControls} Stage move controls and a direct write answered ${patch.status}. After Restore (${rest.status}) the Stage control moved it to Active.`;
    },
  );
  return number;
}

// =====================================================================
// V-C16 contract-approvals
// =====================================================================
async function contractApprovals(role, A, O) {
  const art = "contract-approvals";
  const sc = "V-C16";
  const page = A.page;
  const number = await quickContract(A, role, "C16", { managerId: uid(A.displayName) });
  const approvalsList = async () =>
    (await A.api("GET", `/contracts/${number}/approvals`)).json.approvals;
  const card = () => page.getByRole("region", { name: "Approvals & signing" });

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "Ask for approval: Approvals > Add approver > choose two people > Request approvals",
    "Picker offers Legal Team Members and Administrators only; both new rows are Pending at once; a person with a pending request is not offered again.",
    async () => {
      await openContract(A, number, "approvals");
      await card().getByRole("button", { name: "Add approver" }).click();
      const d = page.getByRole("dialog", { name: "Add approver" });
      const offered = await checkboxNames(d);
      must(
        !offered.includes("Jonas Weber") &&
          !offered.includes("Ravi Menon") &&
          offered.includes("Priya Raman"),
        `offered ${offered}`,
      );
      await d.getByRole("checkbox", { name: O.displayName }).check();
      await d.getByRole("checkbox", { name: "Priya Raman" }).check();
      await d.getByRole("button", { name: "Request approvals" }).click();
      await d.waitFor({ state: "hidden" });
      await card()
        .getByRole("row")
        .filter({ hasText: "Priya Raman" })
        .filter({ hasText: "Pending" })
        .waitFor();
      await card()
        .getByRole("row")
        .filter({ hasText: O.displayName })
        .filter({ hasText: "Pending" })
        .waitFor();
      const rows = (await approvalsList()).map(
        (a) => `${a.approver.displayName}:${a.status}:${a.requestedAt}`,
      );
      await card().getByRole("button", { name: "Add approver" }).click();
      const again = await checkboxNames(d);
      await d.getByRole("button", { name: "Cancel" }).click();
      must(!again.includes("Priya Raman") && !again.includes(O.displayName), `re-offered ${again}`);
      return `Approvers offered ${q(offered)} (no Business Users). Rows: ${q(rows)}. Reopened picker offered ${q(again)}: the two pending people were absent.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName, S.daniel.displayName],
    "Apply group: choose the Approver group, inspect named and skipped people, confirm; a later group edit does not rewrite requests",
    "The dialog names who it asks and who it skips; the group's current members are asked; editing the group afterwards leaves existing requests unchanged.",
    async () => {
      await card().getByRole("button", { name: "Apply group" }).click();
      const d = page.getByRole("dialog", { name: "Apply approver group" });
      await d.getByLabel("Approver group").selectOption({ label: FX.group.name });
      await sleep(500);
      const text = (await d.innerText()).replace(/\s+/g, " ");
      await d.getByRole("button", { name: "Apply group" }).click();
      await d.waitFor({ state: "hidden" });
      await card().getByRole("row").filter({ hasText: "Marcus Oyelaran" }).waitFor();
      const before = (await approvalsList()).map(
        (a) => `${a.approver.displayName}:${a.status}:${a.source}`,
      );
      const edit = await S.daniel.api("PUT", `/approver-groups/${FX.group.id}/members`, {
        memberIds: [uid("Marcus Oyelaran"), uid("Priya Raman"), uid("Tom Iwu")],
      });
      const after = (await approvalsList()).map(
        (a) => `${a.approver.displayName}:${a.status}:${a.source}`,
      );
      await S.daniel.api("PUT", `/approver-groups/${FX.group.id}/members`, {
        memberIds: [uid("Marcus Oyelaran"), uid("Priya Raman")],
      });
      must(
        /Marcus Oyelaran/.test(text) &&
          /Skips 1/.test(text) &&
          edit.status === 200 &&
          after.length === before.length &&
          !after.some((a) => a.startsWith("Tom Iwu")),
        `text ${text} edit ${edit.status} after ${after}`,
      );
      return `Dialog read ${q(text.slice(0, 260))}. After Apply group: ${q(before)}. The Administrator added Tom Iwu to the group (${edit.status}); requests stayed ${q(after)}. The group membership was then restored.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [O.displayName, "Priya Raman", A.displayName],
    "Give a decision as the named approver with a Note; another person cannot answer; a decision is final",
    "Only the named approver sees Approve/Reject on their row; the other staff role approves with a Note and Priya rejects with a Note; decided rows offer no further decision; a wrong-person decision is refused.",
    async () => {
      const list = await approvalsList();
      const priyaReq = list.find((a) => a.approver.displayName === "Priya Raman");
      const oReq = list.find((a) => a.approver.displayName === O.displayName);
      await openContract(O, number, "approvals");
      const oCard = O.page.getByRole("region", { name: "Approvals & signing" });
      await oCard.getByRole("row").filter({ hasText: "Priya Raman" }).waitFor();
      let oMenuOnPriya = [];
      if (await oCard.getByRole("button", { name: "Actions for Priya Raman" }).count()) {
        await oCard.getByRole("button", { name: "Actions for Priya Raman" }).click();
        oMenuOnPriya = await O.page.getByRole("menu").getByRole("menuitem").allInnerTexts();
        await O.page.keyboard.press("Escape");
      }
      const wrong = await O.api("POST", `/approvals/${priyaReq.id}/decision`, {
        decision: "approved",
      });
      must(
        !oMenuOnPriya.includes("Approve") && wrong.status === 403,
        `O menu ${oMenuOnPriya} wrong ${wrong.status}`,
      );
      await oCard.getByRole("button", { name: `Actions for ${O.displayName}` }).click();
      await O.page.getByRole("menuitem", { name: "Approve" }).click();
      const ad = O.page.getByRole("dialog", { name: "Approve this contract" });
      await ad.getByLabel("Note").fill("DOC-029 approved within budget.");
      await ad.getByRole("button", { name: "Approve" }).click();
      await ad.waitFor({ state: "hidden" });
      await oCard
        .getByRole("row")
        .filter({ hasText: O.displayName })
        .filter({ hasText: "Approved" })
        .waitFor();
      await openContract(S.priya, number, "approvals");
      const pCard = S.priya.page.getByRole("region", { name: "Approvals & signing" });
      await pCard.getByRole("button", { name: "Actions for Priya Raman" }).click();
      await S.priya.page.getByRole("menuitem", { name: "Reject" }).click();
      const rd = S.priya.page.getByRole("dialog").filter({ hasText: "A decision is final" });
      const rdTitle = (await rd.getByRole("heading").innerText()).trim();
      await rd.getByLabel("Note").fill("DOC-029 needs a lower cap.");
      await rd.getByRole("button", { name: "Reject" }).click();
      await rd.waitFor({ state: "hidden" });
      await pCard
        .getByRole("row")
        .filter({ hasText: "Priya Raman" })
        .filter({ hasText: "Rejected" })
        .waitFor();
      const again = await S.priya.api("POST", `/approvals/${priyaReq.id}/decision`, {
        decision: "approved",
      });
      const menuBtn = pCard.getByRole("button", { name: "Actions for Priya Raman" });
      let decidedMenu = "no Actions button";
      if (await menuBtn.count()) {
        await menuBtn.click();
        decidedMenu = q(await S.priya.page.getByRole("menu").getByRole("menuitem").allInnerTexts());
        await S.priya.page.keyboard.press("Escape");
      }
      await page.reload();
      await card().waitFor();
      const rowsText = (await card().getByRole("table").innerText()).replace(/\s+/g, " ");
      must(
        again.status === 409 &&
          /DOC-029 approved within budget\./.test(rowsText) &&
          /DOC-029 needs a lower cap\./.test(rowsText),
        `again ${again.status} rows ${rowsText}`,
      );
      return `${O.displayName}'s actions on Priya's row: ${oMenuOnPriya.length ? q(oMenuOnPriya) : "no Actions button"}; a direct decision on Priya's request answered ${wrong.status}. ${O.displayName} approved their own row with a Note. Priya Raman chose Reject (${q(rdTitle)}) with a Note. A second decision answered ${again.status}; Priya's decided row menu: ${decidedMenu}. Requester's table: ${q(rowsText.slice(0, 400))}.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "Ask again after a decision: a new request; the earlier decision stays",
    "A new Pending row for Priya Raman appears; the Rejected row stays.",
    async () => {
      await card().getByRole("button", { name: "Add approver" }).click();
      const d = page.getByRole("dialog", { name: "Add approver" });
      await d.getByRole("checkbox", { name: "Priya Raman" }).check();
      await d.getByRole("button", { name: "Request approvals" }).click();
      await d.waitFor({ state: "hidden" });
      const rows = await until(async () => {
        const l = (await approvalsList()).filter((a) => a.approver.displayName === "Priya Raman");
        return l.length === 2 ? l : null;
      }, "second Priya request");
      return `Priya Raman now has ${q(rows.map((a) => a.status))} requests.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName, O.displayName, "Priya Raman"],
    "Cancel request: requester, Legal Owner or Administrator can cancel a pending row; another Legal Team Member cannot; a decided approval is not erased",
    "Priya (not requester, Owner or Administrator) has no Cancel request on Marcus's row and is refused; the permitted person's Cancel request removes the pending row and History records it; decided rows stay.",
    async () => {
      const list = await approvalsList();
      const marcus = list.find((a) => a.approver.displayName === "Marcus Oyelaran");
      await S.priya.page.reload();
      const pCard = S.priya.page.getByRole("region", { name: "Approvals & signing" });
      await pCard.waitFor();
      const pBtn = pCard.getByRole("button", { name: "Actions for Marcus Oyelaran" });
      let pMenu = [];
      if (await pBtn.count()) {
        await pBtn.click();
        pMenu = await S.priya.page.getByRole("menu").getByRole("menuitem").allInnerTexts();
        await S.priya.page.keyboard.press("Escape");
      }
      const pCancel = await S.priya.api("DELETE", `/approvals/${marcus.id}`);
      must(
        !pMenu.includes("Cancel request") && pCancel.status === 403,
        `priya menu ${pMenu} cancel ${pCancel.status}`,
      );
      // The requester (A) cancels Marcus's group request.
      await page.reload();
      await card().getByRole("button", { name: "Actions for Marcus Oyelaran" }).click();
      await page.getByRole("menuitem", { name: "Cancel request" }).click();
      const confirm = page.getByRole("dialog");
      if (await confirm.isVisible({ timeout: 1500 }).catch(() => false))
        await confirm
          .getByRole("button", { name: /Cancel request|Confirm|Yes/ })
          .last()
          .click();
      await until(
        async () =>
          !(await approvalsList()).some((a) => a.approver.displayName === "Marcus Oyelaran"),
        "Marcus row removed",
      );
      // The other staff role cancels Priya's new pending request made by A:
      // for the Legal Team Member run O is the Administrator; for the Administrator run
      // O becomes the Legal Owner first.
      let who;
      if (role === "administrator") {
        await A.api("PATCH", `/contracts/${number}`, { managerId: uid(O.displayName) });
        who = `${O.displayName} as Legal Owner (not the requester)`;
      } else {
        who = `${O.displayName} as Administrator (not the requester or Legal Owner)`;
      }
      const pending = (await approvalsList()).find(
        (a) => a.approver.displayName === "Priya Raman" && a.status === "pending",
      );
      await openContract(O, number, "approvals");
      const oCard = O.page.getByRole("region", { name: "Approvals & signing" });
      const pendingRow = oCard
        .getByRole("row")
        .filter({ hasText: "Priya Raman" })
        .filter({ hasText: "Pending" });
      await pendingRow.getByRole("button", { name: "Actions for Priya Raman" }).click();
      await O.page.getByRole("menuitem", { name: "Cancel request" }).click();
      const oc = O.page.getByRole("dialog");
      if (await oc.isVisible({ timeout: 1500 }).catch(() => false))
        await oc
          .getByRole("button", { name: /Cancel request|Confirm|Yes/ })
          .last()
          .click();
      await until(
        async () => !(await approvalsList()).some((a) => a.id === pending.id),
        "Priya pending removed",
      );
      if (role === "administrator")
        await A.api("PATCH", `/contracts/${number}`, { managerId: uid(A.displayName) });
      const decided = (await approvalsList()).filter((a) => a.status !== "pending");
      const decidedCancel = await A.api("DELETE", `/approvals/${decided[0].id}`);
      const hist = await history(page);
      must(
        decided.length === 2 && decidedCancel.status === 409 && /cancel/i.test(hist),
        `decided ${decided.length} cancel ${decidedCancel.status} hist ${hist.slice(0, 200)}`,
      );
      return `Priya Raman's menu on Marcus's row: ${q(pMenu)}; a direct cancel answered ${pCancel.status}. The requester's Cancel request removed Marcus Oyelaran's pending row. ${who} cancelled Priya's second pending request. The ${decided.length} decided rows stayed (${q(decided.map((a) => `${a.approver.displayName}:${a.status}`))}); cancelling a decided one answered ${decidedCancel.status}. History: ${q(hist.match(/[A-Z][a-z]+ [A-Z][a-z]+ cancelled the approval request to [A-Z][a-z]+ [A-Z][a-z]+/g))}.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "Move beyond Approval: Move past approval lists Pending and Rejected rows; Cancel keeps; Move anyway records an override and leaves decisions",
    "Dialog lists unresolved rows; Cancel keeps the Status; Move anyway saves it; the approvals keep their decisions.",
    async () => {
      await A.api("POST", `/contracts/${number}/approvals`, { approverIds: [uid("Tom Iwu")] });
      await stageMove(A, number, "Awaiting approval").catch(() => {});
      await page.reload();
      await page.getByRole("heading", { level: 1 }).waitFor();
      let { dialog } = await stageMove(A, number, "Active", { expectGate: true });
      const text = (await dialog.innerText()).replace(/\s+/g, " ");
      if (role === "legal_team_member")
        await page.screenshot({ path: path.join(here, "r2-c16-move-past-approval.png") });
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      await sleep(800);
      must(
        (await getContract(A, number)).contract.statusName === "Awaiting approval",
        "Cancel did not keep",
      );
      ({ dialog } = await stageMove(A, number, "Active", { expectGate: true }));
      await dialog.getByRole("button", { name: "Move anyway" }).click();
      await until(
        async () => (await getContract(A, number)).contract.statusName === "Active",
        "moved",
      );
      const states = (await approvalsList()).map((a) => `${a.approver.displayName}:${a.status}`);
      must(
        /Rejected/.test(text) &&
          /Pending/.test(text) &&
          states.includes("Tom Iwu:pending") &&
          states.includes("Priya Raman:rejected"),
        `${text} ${states}`,
      );
      return `Dialog: ${q(text.slice(0, 300))}. Cancel kept Awaiting approval; Move anyway saved Active. Approvals afterwards: ${q(states)}.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName, S.daniel.displayName],
    "Negative: on Confidential work a person without access is not offered and a group with such a person is refused; applying a group does not grant access; an archived Contract offers no approval actions",
    "Picker omits Priya and Marcus; Apply group is refused by name and asks nobody; archived record shows no Add approver, Apply group or row actions.",
    async () => {
      const conf = await quickContract(A, role, "C16 confidential", {
        confidential: true,
        managerId: uid(A.displayName),
      });
      await openContract(A, conf, "approvals");
      await card().getByRole("button", { name: "Add approver" }).click();
      const d = page.getByRole("dialog", { name: "Add approver" });
      const offered = await checkboxNames(d);
      await d.getByRole("button", { name: "Cancel" }).click();
      await card().getByRole("button", { name: "Apply group" }).click();
      const g = page.getByRole("dialog", { name: "Apply approver group" });
      await g.getByLabel("Approver group").selectOption({ label: FX.group.name });
      await sleep(400);
      await g.getByRole("button", { name: "Apply group" }).click();
      await g
        .getByText(/can.t see this contract/)
        .first()
        .waitFor({ timeout: 10000 });
      const refusal = ((await g.innerText().catch(() => ""))
        .replace(/\s+/g, " ")
        .match(/[^.]*can.t see this contract[^.]*\./) ?? [""])[0];
      if (await g.isVisible().catch(() => false))
        await g.getByRole("button", { name: "Cancel" }).click();
      const asked = (await A.api("GET", `/contracts/${conf}/approvals`)).json.approvals.length;
      const priyaRead = await S.priya.api("GET", `/contracts/${conf}`);
      must(
        !offered.includes("Priya Raman") &&
          !offered.includes("Marcus Oyelaran") &&
          asked === 0 &&
          refusal !== "" &&
          priyaRead.status === 404,
        `offered ${offered} asked ${asked} refusal ${refusal} read ${priyaRead.status}`,
      );
      // Archived: no approval actions.
      await A.api("POST", `/contracts/${number}/archive`, {});
      await openContract(A, number, "approvals");
      const addBtns = await card().getByRole("button", { name: "Add approver" }).count();
      const groupBtns = await card().getByRole("button", { name: "Apply group" }).count();
      const actionBtns = await card()
        .getByRole("button", { name: /^Actions for / })
        .count();
      const ask = await A.api("POST", `/contracts/${number}/approvals`, {
        approverIds: [uid("Ines Duarte")],
      });
      await A.api("POST", `/contracts/${number}/restore`, {});
      must(
        addBtns === 0 && groupBtns === 0 && actionBtns === 0 && ask.status >= 400,
        `archived add ${addBtns} group ${groupBtns} actions ${actionBtns} ask ${ask.status}`,
      );
      return `Confidential C-${conf}: picker offered ${q(offered)} (no Priya Raman or Marcus Oyelaran). Apply group ${q(FX.group.name)} was refused: ${q(refusal.slice(0, 220))}; ${asked} approvals exist and Priya still gets ${priyaRead.status} on the record. Archived C-${number}: Add approver ${addBtns}, Apply group ${groupBtns}, row Actions ${actionBtns}; a direct ask answered ${ask.status}. Restored afterwards.`;
    },
  );
  return number;
}

// =====================================================================
// V-C17-manual manual-signing
// =====================================================================
async function manualSigning(role, A) {
  const art = "manual-signing";
  const sc = "V-C17-manual";
  const page = A.page;
  const number = await quickContract(A, role, "C17", { managerId: uid(A.displayName) });
  await A.api("POST", `/contracts/${number}/team`, { userId: uid("Jonas Weber") });
  const draftName = `doc029-contracts-a-${role}-draft.pdf`;
  const execName = `doc029-contracts-a-${role}-executed.pdf`;
  const laterName = `doc029-contracts-a-${role}-later.pdf`;
  const draftBytes = pdf(`DOC-029r2 contracts-a ${role} draft ${stamp}`);
  const execBytes = pdf(`DOC-029r2 contracts-a ${role} executed ${stamp} signed by both parties`);
  const laterBytes = pdf(`DOC-029r2 contracts-a ${role} later round ${stamp}`);
  const docs = async () => (await A.api("GET", `/contracts/${number}/documents`)).json.documents;
  const docsCard = () => page.getByRole("region", { name: "Documents" });
  let doc;

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "Step 1: Stage control to the Signature Status Out for signature without a Signing connector",
    "The Contract moves to Out for signature; no Send for signature control and no Envelope.",
    async () => {
      await openContract(A, number);
      await stageMove(A, number, "Out for signature");
      const env = (await A.api("GET", `/contracts/${number}/envelopes`)).json;
      await page
        .getByRole("navigation", { name: "Contract sections" })
        .getByRole("link", { name: "Approvals" })
        .click();
      await page.getByRole("region", { name: "Approvals & signing" }).waitFor();
      const send = await page.getByRole("button", { name: "Send for signature" }).count();
      must(
        env.envelopes.length === 0 && env.signingConfigured === false && send === 0,
        `env ${env.envelopes.length} configured ${env.signingConfigured} send ${send}`,
      );
      return `Status Out for signature (Stage signature). Signing configured: ${env.signingConfigured}; Envelopes: ${env.envelopes.length}; Send for signature controls: ${send}.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "Step 2: Documents; no Document yet, so upload the first Document; then Add version with the executed file and Kind Executed",
    "The first upload makes a Document; Add version adds Version 2 on the same Document.",
    async () => {
      await page
        .getByRole("navigation", { name: "Contract sections" })
        .getByRole("link", { name: "Documents" })
        .click();
      await docsCard().getByRole("button", { name: "Upload" }).click();
      const u = page.getByRole("dialog", { name: "Upload document" });
      await u
        .locator("input[type=file]")
        .first()
        .setInputFiles({ name: draftName, mimeType: "application/pdf", buffer: draftBytes });
      await u.getByRole("button", { name: "Upload", exact: true }).click();
      await u.waitFor({ state: "hidden", timeout: 20000 });
      await docsCard().getByRole("row").filter({ hasText: draftName }).waitFor();
      await docsCard()
        .getByRole("button", { name: `Actions for ${draftName}` })
        .click();
      await page.getByRole("menuitem", { name: "Add version" }).click();
      const v = page.getByRole("dialog", { name: "Add version" });
      await v
        .locator("input[type=file]")
        .first()
        .setInputFiles({ name: execName, mimeType: "application/pdf", buffer: execBytes });
      await v.getByLabel("Kind").selectOption({ label: "Executed" });
      await v.getByRole("button", { name: "Upload", exact: true }).click();
      await v.waitFor({ state: "hidden", timeout: 20000 });
      doc = await until(async () => {
        const d = (await docs()).find((x) => x.title === draftName);
        return d && d.versions.length === 2 ? d : null;
      }, "version 2");
      const rowText = (
        await docsCard().getByRole("row").filter({ hasText: draftName }).innerText()
      ).replace(/\s+/g, " ");
      return `Upload filed ${draftName} as the first Document (${(await docs()).length} Document). Add version filed ${execName} as Version 2 (kind ${doc.versions.find((x) => x.versionNumber === 2).kind}). Row: ${q(rowText)}.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "Step 3: read or download the uploaded Document Version and check it is the executed copy",
    "The Version downloads with the exact uploaded bytes and opens in the reader.",
    async () => {
      await docsCard().getByRole("button", { name: draftName, exact: true }).click();
      const reader = page.getByRole("complementary", { name: `${draftName}, version 2` });
      await reader.waitFor({ timeout: 20000 });
      let readerText;
      let download;
      try {
        const rendered = await reader
          .getByText(`DOC-029r2 contracts-a ${role} executed ${stamp} signed by both parties`)
          .waitFor({ timeout: 60000 })
          .then(
            () => true,
            () => false,
          );
        readerText = `${(await reader.innerText()).replace(/\s+/g, " ")}${rendered ? "" : " [page text not rendered within 60 s]"}`;
        [download] = await Promise.all([
          page.waitForEvent("download"),
          reader.getByRole("link", { name: "Download" }).click(),
        ]);
      } finally {
        await reader
          .getByRole("button", { name: "Close the document" })
          .click()
          .catch(() => {});
        await reader.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
      }
      const body = readFileSync(await download.path());
      must(sha(body) === sha(execBytes), `download ${sha(body)}`);
      return `Selecting the Document name opened the reader for version 2: ${q(readerText.slice(0, 200))}. Its Download link saved ${download.suggestedFilename()}, whose SHA-256 matches the uploaded executed file (${sha(execBytes).slice(0, 16)}…).`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "Negative: the Executed kind alone does not set the executed designation",
    "After uploading with Kind Executed, no Version is designated executed.",
    async () => {
      const d = (await docs()).find((x) => x.id === doc.id);
      const cell = (
        await docsCard().getByRole("row").filter({ hasText: draftName }).innerText()
      ).replace(/\s+/g, " ");
      must(
        d.versions.every((v) => !v.isExecuted),
        "a version is designated",
      );
      return `Version kinds ${q(d.versions.map((v) => `${v.versionNumber}:${v.kind}`))}; isExecuted all false. Row shows ${q(cell)} with the Kind column Executed and no executed designation in the Version cell.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "Step 4: Document actions > Mark as executed copy; check the designation and primary Document; the Status does not change",
    "Version 2 shows the executed designation; the Document is Primary; the Contract stays Out for signature.",
    async () => {
      await docsCard()
        .getByRole("button", { name: `Actions for ${draftName}` })
        .click();
      await page.getByRole("menuitem", { name: "Mark as executed copy" }).click();
      const d = await until(async () => {
        const x = (await docs()).find((y) => y.id === doc.id);
        return x.versions.find((v) => v.versionNumber === 2).isExecuted ? x : null;
      }, "v2 executed");
      const rowLoc = docsCard().getByRole("row").filter({ hasText: draftName });
      const versionCell = async () =>
        (await rowLoc.getByRole("cell").nth(2).innerText()).replace(/\s+/g, " ").trim();
      let refreshed = "without a reload";
      try {
        await until(
          async () => /Executed/.test(await versionCell()),
          "Version cell shows Executed",
          10000,
        );
      } catch {
        refreshed = "only after a page reload";
        await page.reload();
        await docsCard().waitFor();
        await until(
          async () => /Executed/.test(await versionCell()),
          "Version cell shows Executed after reload",
          10000,
        );
      }
      if (role === "legal_team_member")
        await docsCard().screenshot({ path: path.join(here, "r2-c17-executed-designation.png") });
      const row = `${(await rowLoc.getByRole("cell").nth(0).innerText()).replace(/\s+/g, " ").trim()} | Version cell: ${await versionCell()}`;
      const status = (await getContract(A, number)).contract.statusName;
      must(
        refreshed === "without a reload" &&
          /Primary/.test(row) &&
          d.isPrimary &&
          status === "Out for signature",
        `row ${row} status ${status}`,
      );
      return `Mark as executed copy set Version 2 executed; the row showed it ${refreshed}. Row: ${q(row)}. Primary ${d.isPrimary}. Contract Status still ${status}.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "Correct the wrong selection and a later round: Add version keeps the chain; the earlier Version keeps the designation; Unmark and mark again through that Version's own actions",
    "Version 3 becomes current while Version 2 stays executed; the earlier Version's actions offer Unmark as executed copy and then Mark as executed copy.",
    async () => {
      await docsCard()
        .getByRole("button", { name: `Actions for ${draftName}` })
        .click();
      await page.getByRole("menuitem", { name: "Add version" }).click();
      const v = page.getByRole("dialog", { name: "Add version" });
      await v
        .locator("input[type=file]")
        .first()
        .setInputFiles({ name: laterName, mimeType: "application/pdf", buffer: laterBytes });
      await v.getByRole("button", { name: "Upload", exact: true }).click();
      await v.waitFor({ state: "hidden", timeout: 20000 });
      const d3 = await until(async () => {
        const x = (await docs()).find((y) => y.id === doc.id);
        return x.versions.length === 3 ? x : null;
      }, "version 3");
      const cur = d3.versions.find((x) => x.isCurrent).versionNumber;
      const exec = d3.versions.find((x) => x.isExecuted)?.versionNumber;
      must(cur === 3 && exec === 2, `current ${cur} executed ${exec}`);
      await docsCard()
        .getByRole("button", { name: /^Show the 2 earlier versions of / })
        .click();
      const vBtn = page.getByRole("button", { name: `Actions for version 2 of ${draftName}` });
      await vBtn.click();
      const items = await page.getByRole("menu").getByRole("menuitem").allInnerTexts();
      await page.getByRole("menuitem", { name: "Unmark as executed copy" }).click();
      await until(
        async () =>
          (await docs()).find((y) => y.id === doc.id).versions.every((x) => !x.isExecuted),
        "unmarked",
      );
      await vBtn.click();
      const items2 = await page.getByRole("menu").getByRole("menuitem").allInnerTexts();
      await page.getByRole("menuitem", { name: "Mark as executed copy" }).click();
      await until(
        async () =>
          (await docs()).find((y) => y.id === doc.id).versions.find((x) => x.versionNumber === 2)
            .isExecuted,
        "remarked",
      );
      const v2 = (await docs())
        .find((y) => y.id === doc.id)
        .versions.find((x) => x.versionNumber === 2);
      const r = await page.request.get(
        `${BASE}/api/v1/documents/${doc.id}/versions/${v2.id}/download`,
      );
      must(sha(await r.body()) === sha(execBytes), "executed bytes changed");
      return `Version 3 (${laterName}) is current while Version 2 kept the designation. Version 2's own actions offered ${q(items)}; Unmark as executed copy cleared it; then ${q(items2)}; Mark as executed copy restored it. Version 2 still downloads the executed bytes.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "Step 5: Stage control to Active; check Status and Activity; no Envelope row",
    "Active is saved without a Soft gate (no approvals); History records the change; Envelopes remain zero.",
    async () => {
      await stageMove(A, number, "Active");
      const hist = await history(page);
      const env = (await A.api("GET", `/contracts/${number}/envelopes`)).json.envelopes.length;
      must(/executed/i.test(hist) && env === 0, `hist ${hist.slice(0, 300)} env ${env}`);
      return `Status Active. History: ${q(hist.slice(0, 360))}. Envelopes: ${env}.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName, "Jonas Weber (Portal)"],
    "Negative: unsupported users cannot perform the legal action; an archived record offers no legal actions",
    "Jonas (Business User on the team) has no executed-copy control and the API refuses it; the archived Contract shows no Document actions and refuses the designation; after Restore Version 2 is still designated.",
    async () => {
      const jp = S.jonas.page;
      await jp.goto(`${BASE}/portal/contracts/${number}`);
      await sleep(2500);
      const jonasText = (await jp.getByRole("main").innerText()).replace(/\s+/g, " ");
      const jonasMark =
        (await jp.getByRole("menuitem", { name: /executed copy/ }).count()) +
        (await jp.getByRole("button", { name: /executed copy/ }).count());
      const v3 = (await docs())
        .find((y) => y.id === doc.id)
        .versions.find((x) => x.versionNumber === 3);
      const jonasApi = await S.jonas.api("POST", `/documents/${doc.id}/executed-version`, {
        versionId: v3.id,
      });
      await A.api("POST", `/contracts/${number}/archive`, {});
      await openContract(A, number, "documents");
      await sleep(1500);
      const actions = await docsCard()
        .getByRole("button", { name: `Actions for ${draftName}` })
        .count();
      const archApi = await A.api("DELETE", `/documents/${doc.id}/executed-version`);
      await A.api("POST", `/contracts/${number}/restore`, {});
      const still = (await docs())
        .find((y) => y.id === doc.id)
        .versions.find((x) => x.isExecuted)?.versionNumber;
      must(
        jonasMark === 0 &&
          jonasApi.status >= 400 &&
          actions === 0 &&
          archApi.status >= 400 &&
          still === 2,
        `jonas ${jonasMark}/${jonasApi.status} archived ${actions}/${archApi.status} still ${still}`,
      );
      return `Jonas Weber in the Portal (${q(jonasText.slice(0, 120))}) had ${jonasMark} executed-copy controls; his direct designation answered ${jonasApi.status}. Archived C-${number}: ${actions} Document action menus; clearing the designation answered ${archApi.status}. After Restore Version ${still} is still designated.`;
    },
  );
  return number;
}

// ---------- run ----------
const plan = [
  { role: "legal_team_member", A: S.nadia, O: S.daniel },
  { role: "administrator", A: S.daniel, O: S.nadia },
].filter((p) => ROLES.includes(p.role));
try {
  for (const { role, A, O } of plan) {
    if (ONLY.includes("create-contract")) await createContract(role, A, O);
    if (ONLY.includes("contract-stages"))
      await contractStages(role, A, O, `DOC-029r2 contracts-a renamed by ${role} ${stamp}`);
    if (ONLY.includes("contract-approvals")) await contractApprovals(role, A, O);
    if (ONLY.includes("manual-signing")) await manualSigning(role, A);
  }
} finally {
  // Restore shared lab settings: archive the fixture Statuses, types, Fields and Approver groups.
  results.cleanup = await cleanupFixtures();
  save();
  await browser.close();
}
const failed = results.steps.filter((s) => s.result !== "pass");
console.log(
  `steps ${results.steps.length}, failed ${failed.length}; cleanup ${results.cleanup.join(", ")}`,
);
