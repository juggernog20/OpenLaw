// DOC-030 independent browser walkthrough for V-C07 (comments-and-activity) and
// V-C08 (notifications), group "conversations", against the work2 lab built from
// 067c1646829df85e62b809ee9157921e867c84e7.
// Written by the DOC-030 independent walkthrough agent (conversations) from the current
// article text, following the pattern of DOC-029 conversations walkthrough-r1.mjs.
// It is not the author's script.
// Run from the worktree root, one or more sections at a time:
//   LAB_PASSWORD=... SECTIONS=setup-n,leadtimes node docs/documentation/batches/DOC-030/conversations/walkthrough.mjs
// Each run appends its steps to walkthrough.json. Magic links, activation links, cookies,
// API keys and raw mail stay in memory and are never written to the log.
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as L from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const FIX = path.join(root, "docs/documentation/batches/DOC-029/conversations/fixtures");
const fixture = (name) => path.join(FIX, name);
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const OUT = path.join(here, "walkthrough.json");
const FX = path.join(here, "fixtures.json");
const SECTIONS = (process.env.SECTIONS ?? "").split(",").filter(Boolean);
const run = (name) => SECTIONS.includes(name);
const lab = JSON.parse(readFileSync(path.join(root, ".documentation-labs/work2/lab.json"), "utf8"));
const PG = `${lab.project}-postgres-1`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => JSON.stringify(s);
const CA = "comments-and-activity";
const NT = "notifications";
const SEAT = "DOC-030 independent walkthrough agent (conversations)";

const results = existsSync(OUT)
  ? JSON.parse(readFileSync(OUT, "utf8"))
  : {
      kind: "independent-article-walkthrough",
      task: "DOC-030",
      issue: 1157,
      group: "conversations",
      independentReview: true,
      walkthroughReviewer: SEAT,
      reviewerKind: "agent",
      method: "browser-walkthrough",
      scenarios: { "comments-and-activity": "V-C07", notifications: "V-C08" },
      appCommit: lab.sourceCommit,
      buildId: `app ${lab.appImageId}; engine ${lab.engineImageId}`,
      environment: lab.project,
      labName: lab.name,
      seed: lab.seed,
      containerImages: lab.containerImages,
      appUrl: L.BASE,
      mailUrl: L.MAIL,
      browser:
        "Playwright 1.63.0 Chromium from node_modules/.pnpm, headless, 1440x900, one isolated browser context per identity",
      fixtures: Object.fromEntries(
        [
          "doc029-conv-notice.pdf",
          "doc029-conv-schedule.pdf",
          "doc029-conv-portal-note.pdf",
          "doc029-conv-legal-memo.pdf",
          ...[1, 2, 3, 4, 5, 6].map((n) => `doc029-conv-extra-${n}.txt`),
        ].map((name) => [name, sha256(fixture(name))]),
      ),
      runs: [],
      fixturePreparation: [],
      records: {},
      steps: [],
      productBugs: [],
      guideFailures: [],
      limitations: [],
    };
results.articles = ["comments-and-activity", "notifications"].map((id) => ({
  articleId: id,
  articlePath: `docs/user-guides/${id}.md`,
  contentSha256: sha256(path.join(root, `docs/user-guides/${id}.md`)),
}));
const thisRun = { sections: SECTIONS, startedAt: new Date().toISOString(), finishedAt: null };
results.runs.push(thisRun);

function save() {
  thisRun.finishedAt = new Date().toISOString();
  const current = results.steps.filter((s) => !s.superseded);
  results.summary = {
    total: results.steps.length,
    pass: results.steps.filter((s) => s.result === "pass").length,
    fail: results.steps.filter((s) => s.result === "fail").length,
    superseded: results.steps.length - current.length,
    current: current.length,
    currentPass: current.filter((s) => s.result === "pass").length,
  };
  writeFileSync(OUT, JSON.stringify(results, null, 2) + "\n");
}
function prep(text) {
  results.fixturePreparation.push({ at: new Date().toISOString(), text });
  save();
}
function saveFx() {
  writeFileSync(FX, JSON.stringify(fx, null, 2) + "\n");
  results.records = fx;
}
async function step(article, role, action, expected, fn) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(action)) return null;
  const entry = {
    article,
    role,
    method: "browser-walkthrough",
    step: action,
    expected,
    startedAt: new Date().toISOString(),
    at: null,
    page: null,
    actual: null,
    result: "not-run",
  };
  results.steps.push(entry);
  try {
    entry.actual = await fn();
    entry.result = "pass";
  } catch (error) {
    const msg =
      error instanceof Error ? error.message.split("\n").slice(0, 8).join(" ") : String(error);
    entry.actual = `Check did not complete: ${msg}`;
    entry.result = "fail";
  }
  entry.at = new Date().toISOString();
  entry.page = lastPage;
  console.log(`[${role}] ${entry.result.toUpperCase()} ${article}: ${action}`);
  if (entry.result === "fail") console.log(`    ${entry.actual}`);
  save();
  return entry;
}
let lastPage = null;
function at(page) {
  lastPage = new URL(page.url()).pathname + new URL(page.url()).search;
  return lastPage;
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}

// ---------- shared helpers ----------
function psql(sql) {
  return execFileSync(
    "docker",
    [
      "exec",
      "-e",
      `SQL=${sql}`,
      PG,
      "sh",
      "-c",
      'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$SQL"',
    ],
    { encoding: "utf8" },
  ).trim();
}
const mailSearch = L.mailSearch;
async function mailCount(email, subjectPart, since = null) {
  const msgs = await mailSearch(`to:"${email}"`);
  return msgs.filter((m) => m.Subject.includes(subjectPart) && (!since || m.Created >= since))
    .length;
}
async function mailsSince(email, since) {
  return (await mailSearch(`to:"${email}"`)).filter((m) => m.Created >= since);
}
async function mailText(id) {
  return (await L.mailMessage(id)).Text ?? "";
}
async function mailHtml(id) {
  return (await L.mailMessage(id)).HTML ?? "";
}
/** Waits until the pg-boss queue has no pending notification jobs, then a quiet window. */
async function settleQueue(quietMs = 4000) {
  for (let i = 0; i < 60; i++) {
    const pending = Number(
      psql(
        "select count(*) from pgboss.job where state in ('created','retry','active') and name not like '%sweep%' and name <> 'notification.morning-round' and start_after <= now()",
      ),
    );
    if (pending === 0) break;
    await sleep(1000);
  }
  await sleep(quietMs);
}
function utcDate(plusDays = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + plusDays);
  return d.toISOString().slice(0, 10);
}
/** A reproducible password for a fresh fictional account, derived from the lab password. Never stored. */
function freshPassword(email) {
  return `Doc030-${createHmac("sha256", L.PASSWORD).update(email).digest("hex").slice(0, 24)}`;
}

const applet = (page) => page.getByRole("complementary", { name: "Comments" });
async function openApplet(page, name) {
  const button = page
    .getByRole("toolbar", { name: "Applets" })
    .getByRole("button", { name: new RegExp(`^${name}`) });
  await button.waitFor({ timeout: 20000 });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  return button;
}
async function openComments(page) {
  await openApplet(page, "Comments");
  const a = applet(page);
  await a.waitFor({ timeout: 20000 });
  await a
    .getByRole("textbox", { name: "New comment" })
    .or(a.getByRole("alert"))
    .first()
    .waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  return a;
}
const rowWith = (a, text) => a.getByRole("listitem").filter({ hasText: text });
async function chooseTier(a, label) {
  const radio = a.getByRole("radio", { name: label });
  if (await radio.isChecked()) return;
  await a
    .getByRole("group", { name: "Audience" })
    .locator("label")
    .filter({ hasText: label })
    .first()
    .click();
  if (!(await radio.isChecked())) await radio.check({ force: true });
}
async function audienceText(a) {
  return (
    await a
      .locator("p")
      .filter({ hasText: /^Visible to/ })
      .first()
      .textContent()
  ).trim();
}
async function postComment(page, text, { tier, files } = {}) {
  const a = applet(page);
  if (tier) await chooseTier(a, tier);
  await a.getByRole("textbox", { name: "New comment" }).fill(text);
  if (files) await a.locator('input[type="file"]').setInputFiles(files.map(fixture));
  await a.getByRole("button", { name: "Comment", exact: true }).click();
  await rowWith(a, text).first().waitFor({ timeout: 20000 });
  return rowWith(a, text).first();
}
async function rowSummary(row) {
  return (await row.innerText()).replace(/\s+/g, " ").trim();
}
const flat = (s) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();

// ---------- notification helpers ----------
const bell = (page) => page.getByRole("banner").getByRole("button", { name: /^Notifications,/ });
async function bellName(page) {
  return (await bell(page).getAttribute("aria-label")) ?? (await bell(page).innerText());
}
async function unreadApi(page, portal = false) {
  return (
    await L.api(
      page,
      "GET",
      portal ? "/portal/notifications/unread-count" : "/notifications/unread-count",
    )
  ).body.unread;
}
async function openBell(page) {
  await bell(page).click();
  const dialog = page.getByRole("dialog", { name: "Notifications" });
  await dialog.waitFor();
  await dialog
    .getByRole("list")
    .or(dialog.getByRole("alert"))
    .or(dialog.getByText(/^Nothing to catch up on/))
    .first()
    .waitFor({ timeout: 15000 });
  await page.waitForTimeout(700);
  return dialog;
}
async function closeBell(page) {
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Notifications" }).waitFor({ state: "hidden" });
}
async function findItem(page, dialog, re, maxPages = 5) {
  for (let i = 0; i < maxPages; i++) {
    const link = dialog.getByRole("link", { name: re }).first();
    if (await link.count()) return link;
    const older = dialog.getByRole("button", { name: "Show older" });
    if (!(await older.count())) break;
    await older.click();
    await page.waitForTimeout(1500);
  }
  return null;
}
async function itemsMatching(page, re, portal = false, since = null) {
  let cursor = null;
  const found = [];
  for (let i = 0; i < 40; i++) {
    const r = await L.api(
      page,
      "GET",
      `${portal ? "/portal/notifications" : "/notifications"}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    const items = r.body.items ?? r.body.notifications ?? [];
    let older = false;
    for (const it of items) {
      if (since && it.createdAt < since) {
        older = true;
        continue;
      }
      if (re.test(JSON.stringify(it))) found.push(it);
    }
    cursor = r.body.nextCursor;
    if (!cursor || older || (!since && i >= 5)) break;
  }
  return found;
}
async function aboutComment(page, commentId, since, portal = false) {
  return itemsMatching(page, new RegExp(commentId), portal, since);
}
async function setSwitch(page, name, on) {
  const sw = page.getByRole("switch", { name, exact: true });
  await sw.waitFor();
  const now = (await sw.getAttribute("aria-checked")) === "true";
  if (now !== on) {
    await sw.click();
    await page.getByText("Saved", { exact: true }).first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(300);
  }
  return now;
}
async function switchStates(page, names) {
  const out = {};
  for (const n of names) {
    const sw = page.getByRole("switch", { name: n, exact: true });
    out[n] = (await sw.count()) ? (await sw.getAttribute("aria-checked")) === "true" : "absent";
  }
  return out;
}
async function allSwitches(page) {
  const out = {};
  for (const sw of await page.getByRole("switch").all()) {
    const name = await sw.evaluate(
      (e) =>
        e.getAttribute("aria-label") ??
        (e.id ? document.querySelector(`label[for="${e.id}"]`)?.textContent : null) ??
        e.getAttribute("aria-labelledby"),
    );
    out[flat(name)] = (await sw.getAttribute("aria-checked")) === "true";
  }
  return out;
}
async function openStaffNotificationSettings(page, displayName) {
  await page.goto(`${L.BASE}/`);
  if (page.url().includes("/onboarding")) await page.goto(`${L.BASE}/`);
  await page.getByRole("banner").getByRole("button", { name: displayName }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("group", { name: "Personal" })
    .getByRole("link", { name: "Notifications" })
    .click();
  await page.getByRole("heading", { name: "Notification preferences" }).waitFor();
  await page.waitForTimeout(500);
  at(page);
}
async function comment(page, entityType, entityId, body, visibility, mentions = []) {
  const r = await L.api(page, "POST", "/comments", {
    entityType,
    entityId,
    body,
    visibility,
    mentions,
  });
  expect(r.status < 300, `comment ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  const id = r.body.comment?.id ?? r.body.id;
  expect(id, `no comment id in ${JSON.stringify(r.body).slice(0, 200)}`);
  return id;
}
const STAFF_SWITCHES = [
  "Assigned to you In-app",
  "Assigned to you Email",
  "Assigned to you Push",
  "Activity on your records In-app",
  "Activity on your records Email",
  "Activity on your records Push",
  "Dates approaching In-app",
  "Dates approaching Email",
  "Dates approaching Push",
  "New requests In-app",
  "New requests Email",
  "New requests Push",
  "Knowledge items In-app",
  "Knowledge items Email",
  "Knowledge items Push",
  "Approvals Email",
  "Tasks Email",
  "Dates Email",
  "Obligations Email",
  "Intake Email",
];
const STAFF_EXPECTED = {
  "Assigned to you In-app": true,
  "Assigned to you Email": true,
  "Assigned to you Push": true,
  "Activity on your records In-app": true,
  "Activity on your records Email": false,
  "Activity on your records Push": false,
  "Dates approaching In-app": true,
  "Dates approaching Email": "absent",
  "Dates approaching Push": true,
  "New requests In-app": true,
  "New requests Email": false,
  "New requests Push": false,
  "Knowledge items In-app": "absent",
  "Knowledge items Email": true,
  "Knowledge items Push": "absent",
  "Approvals Email": true,
  "Tasks Email": true,
  "Dates Email": true,
  "Obligations Email": true,
  "Intake Email": false,
};

// ---------- fresh fictional accounts ----------
async function inviteFresh(key, role, label) {
  const d = ctx.daniel.page;
  const email = `doc030-conv-${stamp}-${key}@helix.example`;
  const displayName = `DOC-030 conversations ${label} ${stamp}`;
  const inv = await L.api(d, "POST", "/auth/invites", { email, displayName, role });
  expect(inv.status === 201, `invite ${inv.status} ${JSON.stringify(inv.body).slice(0, 200)}`);
  const id = inv.body.user?.id;
  let href = null;
  for (let i = 0; i < 80 && !href; i++) {
    const [m] = await mailSearch(`to:"${email}"`, 5);
    if (m) {
      const t = await mailText(m.ID);
      const match = t.match(/https?:\/\/[^\s)\]]+\/auth\/set-password[^\s)\]]*/);
      if (match) {
        const u = new URL(match[0]);
        const lab = new URL(L.BASE);
        u.protocol = lab.protocol;
        u.host = lab.host;
        href = u.toString();
      }
    }
    if (!href) await sleep(750);
  }
  expect(href, `no activation mail for ${key}`);
  const b = await L.launch();
  const context = await b.newContext({ baseURL: L.BASE, viewport: { width: 1440, height: 900 } });
  context.setDefaultTimeout(15000);
  const page = await context.newPage();
  const password = freshPassword(email);
  await page.goto(href);
  href = null;
  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Set password" }).click();
  await page
    .getByText("Password set")
    .first()
    .waitFor({ timeout: 15000 })
    .catch(() => {});
  await context.close();
  return { key, role, label, email, displayName, id };
}
/** Walks a fresh Business User through Portal onboarding once: a Department, a fictional name, defaults. */
async function portalOnboarding(page, acct) {
  await page.goto(`${L.BASE}/portal`);
  await page.waitForTimeout(1500);
  const seen = [];
  for (let i = 0; i < 8 && page.url().includes("/portal/onboarding"); i++) {
    const main = page.locator("main");
    seen.push(
      flat(
        await main
          .getByText(/^Step \d of \d$/)
          .first()
          .textContent()
          .catch(() => ""),
      ),
    );
    const select = main.locator("select");
    if (await select.count()) await select.first().selectOption({ index: 1 });
    const name = main.getByRole("textbox", { name: "Full name" });
    if (await name.count()) await name.fill(`DOC-030 conversations Business ${stamp}`);
    const finish = main.getByRole("button", { name: "Finish" });
    if (await finish.count()) await finish.click();
    else await main.getByRole("button", { name: "Continue" }).click();
    await page.waitForTimeout(1200);
  }
  return seen;
}
async function freshContext(acct) {
  if (acct.role === "business_user") {
    const c = await L.portalContext(acct.email);
    if (!acct.onboarded) {
      const steps = await portalOnboarding(c.page, acct);
      acct.onboarded = true;
      const me = (await L.api(c.page, "GET", "/me")).body;
      acct.displayName = me.user?.displayName ?? me.displayName;
      prep(
        `The fresh Business User completed Portal onboarding once (${steps.join(", ")}) with the first Department, the name ${acct.displayName}, and the default theme and notification choices.`,
      );
    }
    return c;
  }
  const c = await L.staffContext(acct.email, freshPassword(acct.email));
  if (c.page.url().includes("/onboarding")) await c.page.goto(`${L.BASE}/`);
  return c;
}
async function freshPage(key) {
  const acct = fx.fresh[key];
  ctx[key] ??= await freshContext(acct);
  return ctx[key].page;
}

// ---------- V-C08 fixtures and the morning-round preparation ----------
async function setupNotifications() {
  const d = ctx.daniel.page;
  const LA = "America/Los_Angeles";
  fx.fresh = {};
  await step(
    NT,
    "administrator",
    "Fixture: invite fresh fictional accounts and check the initial Notification preferences on each staff account",
    "Each fresh staff account shows the guide's initial channel choices, including Push",
    async () => {
      const specs = [
        ["l1", "legal_team_member", "Legal Own List"],
        ["l2", "legal_team_member", "Legal Los Angeles"],
        ["l3", "legal_team_member", "Legal No Date Bell"],
        ["a1", "administrator", "Admin"],
      ];
      const out = [];
      for (const [key, role, label] of specs) {
        const acct = await inviteFresh(key, role, label);
        fx.fresh[key] = acct;
        saveFx();
        const page = await freshPage(key);
        // Keep the account outside any morning round until its fixtures are ready.
        const tz = await L.api(page, "PATCH", "/me/preferences", { timezone: LA });
        expect(tz.status < 300, `timezone ${tz.status}`);
        await openStaffNotificationSettings(page, acct.displayName);
        const states = await switchStates(page, STAFF_SWITCHES);
        const diff = Object.keys(STAFF_EXPECTED).filter((k) => STAFF_EXPECTED[k] !== states[k]);
        expect(diff.length === 0, `${key} initial diff ${diff} ${q(states)}`);
        out.push(
          `${role} ${acct.displayName}: initial switches match (${Object.keys(states).length} checked)`,
        );
      }
      // A fresh Business User, created by a first Portal magic-link sign-in on the allowed domain.
      const bu = {
        key: "b1",
        role: "business_user",
        label: "Business",
        email: `doc030-conv-${stamp}-b1@helix.example`,
      };
      fx.fresh.b1 = bu;
      const bp = await freshPage("b1");
      const me = (await L.api(bp, "GET", "/me")).body;
      bu.id = me.user?.id ?? me.id;
      bu.displayName = me.user?.displayName ?? me.displayName;
      const tz = await L.api(bp, "PATCH", "/me/preferences", { timezone: LA });
      saveFx();
      out.push(
        `business_user ${bu.email} created by first magic-link sign-in (role ${me.user?.role ?? me.role}, timezone set HTTP ${tz.status})`,
      );
      prep(
        `Daniel Okafor invited four fresh fictional staff accounts through the invites API (DOC-030 conversations Legal Own List, Legal Los Angeles, Legal No Date Bell, and Admin, stamp ${stamp}); each set a derived in-memory password from its activation mail. A fresh Business User (${bu.email}) was created by its first Portal magic-link sign-in. Every fresh account had its timezone set to ${LA} through the preferences API so no morning round could serve it before its fixtures were ready.`,
      );
      return out.join("; ");
    },
  );

  await step(
    NT,
    "administrator",
    "Fixture: the fresh Business User's Request is converted to a Contract; staff join its team; Key dates and Tasks are added",
    "Contract created from the Request with the fresh accounts on its team",
    async () => {
      const bp = await freshPage("b1");
      const types = (await L.api(d, "GET", "/request-types")).body.requestTypes;
      const deps = (await L.api(d, "GET", "/departments/options")).body.departments;
      const ct = (await L.api(d, "GET", "/contract-types")).body.contractTypes;
      const question = types.find((t) => t.slug === "legal_question");
      const submit = async (title) => {
        const r = await L.api(bp, "POST", "/requests", {
          requestTypeId: question.id,
          departmentId: deps[0].id,
          title,
          description:
            "DOC-030 conversations fixture. Fictional request for the notifications walkthrough.",
          urgency: "medium",
          customFields: {},
        });
        expect(r.status < 300, `submit ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
        return r.body.request;
      };
      const rq = await submit(`DOC-030 conversations notifications Contract ${stamp}`);
      const open = await submit(`DOC-030 conversations notifications open Request ${stamp}`);
      const sales = ct.find((t) => t.slug === "sales");
      const cv = await L.api(d, "POST", `/requests/${rq.number}/convert`, {
        title: rq.title,
        contractTypeId: sales.id,
      });
      expect(cv.status < 300, `convert ${cv.status} ${JSON.stringify(cv.body).slice(0, 300)}`);
      const contract = cv.body.request.convertedRecord;
      const c = (await L.api(d, "GET", `/contracts/${contract.number}`)).body;
      fx.n = {
        request: rq.number,
        openRequest: open.number,
        openRequestId:
          (await L.api(bp, "GET", `/portal/requests/${open.number}`)).body?.request?.id ?? null,
        contract: contract.number,
        contractId: (c.contract ?? c).id,
        title: rq.title,
        openTitle: open.title,
      };
      if (!fx.n.openRequestId)
        fx.n.openRequestId = (await L.api(d, "GET", `/requests/${open.number}`)).body.request.id;
      for (const k of ["l1", "l2", "l3", "a1"]) {
        const r = await L.api(d, "POST", `/contracts/${contract.number}/team`, {
          userId: fx.fresh[k].id,
        });
        expect(r.status < 300, `team ${k} ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
      }
      // The fresh Administrator becomes the Legal Owner so the seed accounts stay out of the date audience.
      const own = await L.api(d, "PATCH", `/contracts/${contract.number}`, {
        managerId: fx.fresh.a1.id,
      });
      const today = utcDate(0);
      for (const k of ["a1", "l3"]) {
        const r = await L.api(d, "POST", `/contracts/${contract.number}/tasks`, {
          title: `DOC-030 conversations ${stamp} due today for ${fx.fresh[k].label}`,
          assigneeId: fx.fresh[k].id,
          dueDate: today,
        });
        expect(r.status < 300, `task ${k} ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
      }
      const kd = {};
      for (const [slot, plus] of [
        ["three", 3],
        ["seven", 7],
      ]) {
        const r = await L.api(d, "POST", `/contracts/${contract.number}/key-dates`, {
          date: utcDate(plus),
          label: `DOC-030 conversations ${stamp} ${slot}-day check`,
        });
        expect(r.status < 300, `key date ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
        kd[slot] = utcDate(plus);
      }
      fx.n.keyDates = kd;
      fx.n.today = today;
      saveFx();
      const team = (await L.api(d, "GET", `/contracts/${contract.number}/team`)).body;
      prep(
        `The fresh Business User submitted R-${rq.number} and R-${open.number} through the Requests API. Daniel Okafor converted R-${rq.number} to Sales Contract C-${contract.number}, added the four fresh staff accounts to its team, made the fresh Administrator its Legal Owner (HTTP ${own.status}), created Tasks due ${today} for the fresh Administrator and Legal No Date Bell, and added the Key dates "${stamp} three-day check" on ${kd.three} and "${stamp} seven-day check" on ${kd.seven} through the API. R-${open.number} stays unconverted.`,
      );
      return `C-${contract.number} from R-${rq.number}; team read ${q(JSON.stringify(team).slice(0, 400))}.`;
    },
  );
}

async function leadTimes() {
  const only2 = run("leadtimes-reset");
  const role = "legal_team_member";
  const l1 = await freshPage("l1");
  const l2 = await freshPage("l2");
  const a1 = await freshPage("a1");
  const card = (page) =>
    page
      .locator("section, div")
      .filter({ has: page.getByRole("heading", { name: "Reminder lead times" }) })
      .last();

  if (!only2)
    await step(
      NT,
      role,
      "Set your own reminder lead times: turn off Use the organization's default lead times, add a lead time, remove others, check bounds and the last entry, reload",
      "The list starts as a copy of the organization list; 731 is refused; 3 is added; the last lead time cannot be removed; the saved indication shows; the choice survives reload",
      async () => {
        const acct = fx.fresh.l1;
        await openStaffNotificationSettings(l1, acct.displayName);
        await l1.getByRole("heading", { name: "Reminder lead times" }).waitFor();
        const sw = l1.getByRole("switch", { name: "Use the organization's default lead times" });
        const initial = await sw.getAttribute("aria-checked");
        const list = l1.getByRole("list", { name: "Your reminder lead times" });
        const orgShown = (await list.getByRole("listitem").allInnerTexts()).map(flat);
        await sw.click();
        await l1.getByText("Saved", { exact: true }).first().waitFor({ timeout: 10000 });
        const copy = (await list.getByRole("listitem").allInnerTexts()).map(flat);
        const input = l1.getByRole("spinbutton", { name: "days before the date" });
        await input.fill("731");
        await l1.getByRole("button", { name: "Add lead time" }).click();
        await l1.waitForTimeout(800);
        const tooFar =
          (await input.evaluate((e) => e.validationMessage)) ||
          flat(
            await l1
              .getByText(/between 0 and 730/)
              .first()
              .textContent()
              .catch(() => ""),
          );
        const afterTooFar = (await list.getByRole("listitem").allInnerTexts()).map(flat);
        expect(afterTooFar.join() === copy.join() && tooFar, `731 changed the list ${afterTooFar}`);
        await input.fill("3");
        await l1.getByRole("button", { name: "Add lead time" }).click();
        await list.getByText("3 days before", { exact: true }).waitFor({ timeout: 10000 });
        for (const label of copy) {
          await list.getByRole("button", { name: `Remove ${label}` }).click();
          await l1.waitForTimeout(700);
          await list
            .getByText(label, { exact: true })
            .waitFor({ state: "detached", timeout: 10000 });
        }
        const left = (await list.getByRole("listitem").allInnerTexts()).map(flat);
        const lastDisabled = await list
          .getByRole("button", { name: "Remove 3 days before" })
          .isDisabled();
        await l1.reload();
        await l1.getByRole("heading", { name: "Reminder lead times" }).waitFor();
        const afterReload = (
          await l1
            .getByRole("list", { name: "Your reminder lead times" })
            .getByRole("listitem")
            .allInnerTexts()
        ).map(flat);
        const swAfter = await l1
          .getByRole("switch", { name: "Use the organization's default lead times" })
          .getAttribute("aria-checked");
        const apiOwn = (await L.api(l1, "GET", "/me/notification-preferences")).body
          .reminderOffsetDays;
        at(l1);
        expect(
          initial === "true" &&
            copy.join() === orgShown.join() &&
            left.join() === "3 days before" &&
            lastDisabled &&
            afterReload.join() === "3 days before" &&
            swAfter === "false" &&
            q(apiOwn) === "[3]",
          JSON.stringify({
            initial,
            orgShown,
            copy,
            left,
            lastDisabled,
            afterReload,
            swAfter,
            apiOwn,
          }),
        );
        return `Reminder lead times card: the switch "Use the organization's default lead times" started on and showed ${q(orgShown)}. Turning it off showed Saved and the same list as her own copy ${q(copy)}. Entering 731 and selecting Add lead time was refused with ${q(tooFar)} and left the list unchanged. Entering 3 added "3 days before"; removing the five copied entries with their Remove controls left ${q(left)}, and "Remove 3 days before" was disabled. After reload the switch stayed off with ${q(afterReload)} (API list ${q(apiOwn)}).`;
      },
    );

  await step(
    NT,
    role,
    "Turn Use the organization's default lead times back on to delete the personal list",
    "Turning the switch back on shows the organization list again and the personal list is gone",
    async () => {
      const acct = fx.fresh.l2;
      await openStaffNotificationSettings(l2, acct.displayName);
      const sw = l2.getByRole("switch", { name: "Use the organization's default lead times" });
      await sw.click();
      await l2.getByText("Saved", { exact: true }).first().waitFor({ timeout: 10000 });
      const mid = (await L.api(l2, "GET", "/me/notification-preferences")).body.reminderOffsetDays;
      await l2.waitForTimeout(500);
      await sw.click();
      await l2.getByText("Saved", { exact: true }).first().waitFor({ timeout: 10000 });
      await l2.waitForTimeout(1000);
      await l2.reload();
      await l2.getByRole("heading", { name: "Reminder lead times" }).waitFor();
      await l2
        .getByRole("list", { name: "Your reminder lead times" })
        .getByRole("listitem")
        .first()
        .waitFor();
      const list = (
        await l2
          .getByRole("list", { name: "Your reminder lead times" })
          .getByRole("listitem")
          .allInnerTexts()
      ).map(flat);
      const removeButtons = await l2
        .getByRole("list", { name: "Your reminder lead times" })
        .getByRole("button")
        .count();
      const after = (await L.api(l2, "GET", "/me/notification-preferences")).body
        .reminderOffsetDays;
      at(l2);
      expect(
        q(mid) !== "null" && after === null && removeButtons === 0 && list.length > 0,
        JSON.stringify({ mid, after, list }),
      );
      return `With the switch off her own list was ${q(mid)}; turning it back on and reloading showed the organization list ${q(list)} with ${removeButtons} remove controls, and her saved list read ${q(after)}.`;
    },
  );

  if (!only2)
    await step(
      NT,
      "administrator",
      "An Administrator's Notifications page has the same cards; a Business User's Portal settings have no Reminder lead times card",
      "Administrator sees Notification preferences, Devices, Reminder lead times, Briefing; Portal Notification settings has no Reminder lead times card and no Briefing",
      async () => {
        await openStaffNotificationSettings(a1, fx.fresh.a1.displayName);
        const headings = (await a1.locator("main").getByRole("heading").allInnerTexts()).map(flat);
        const b1 = await freshPage("b1");
        await b1.goto(`${L.BASE}/portal`);
        await b1.getByRole("banner").getByRole("link", { name: "Notification settings" }).click();
        await b1.getByRole("heading", { name: "Notification settings", level: 1 }).waitFor();
        await b1.waitForTimeout(800);
        const pHeadings = (await b1.locator("main").getByRole("heading").allInnerTexts()).map(flat);
        const lead = await b1.getByText("Reminder lead times").count();
        const briefing = await b1.getByText("Briefing", { exact: true }).count();
        at(b1);
        expect(
          ["Notification preferences", "Devices", "Reminder lead times", "Briefing"].every((h) =>
            headings.includes(h),
          ) &&
            lead === 0 &&
            briefing === 0,
          JSON.stringify({ headings, pHeadings, lead, briefing }),
        );
        return `Administrator page headings ${q(headings)}. Portal Notification settings headings ${q(pHeadings)}, with ${lead} Reminder lead times and ${briefing} Briefing text.`;
      },
    );
}

async function keyDateDialog() {
  const role = "legal_team_member";
  const l1 = await freshPage("l1");
  await step(
    NT,
    role,
    "Key date dialog: Global reminders shows the organization list, an additional lead time joins This date will remind; recipients include the Business User on the team",
    "Global reminders and This date will remind lines; 731 refused; Business User offered as a recipient; the saved Key date keeps its lead time",
    async () => {
      const label = `DOC-030 conversations ${stamp} five-day check`;
      await l1.goto(`${L.BASE}/contracts/${fx.n.contract}`);
      await l1
        .getByRole("link", { name: /^Key dates/ })
        .first()
        .click();
      await l1.getByRole("button", { name: "Add date" }).first().click();
      const dialog = l1.getByRole("dialog", { name: "Add a key date" });
      await dialog.waitFor();
      await dialog.getByText(/^Global reminders:/).waitFor();
      const global = flat(await dialog.getByText(/^Global reminders:/).textContent());
      await dialog.getByRole("textbox", { name: "Date" }).fill(utcDate(5));
      await dialog.getByRole("textbox", { name: "Event" }).fill(label);
      const lead = dialog.getByRole("spinbutton", { name: "Additional lead time (days before)" });
      await lead.fill("731");
      const disabled731 = await dialog.getByRole("button", { name: "Add lead time" }).isDisabled();
      await lead.fill("5");
      await dialog.getByRole("button", { name: "Add lead time" }).click();
      const combined = flat(await dialog.getByText(/^This date will remind:/).textContent());
      const names = [];
      for (const cb of await dialog.getByRole("checkbox").all())
        names.push(
          flat(
            await cb.evaluate(
              (e) => e.labels?.[0]?.textContent ?? e.getAttribute("aria-label") ?? "",
            ),
          ),
        );
      const buOffered = names.some((x) => x.includes(fx.fresh.b1.displayName ?? fx.fresh.b1.email));
      const usualBefore = await dialog
        .getByRole("button", { name: "Use the usual audience" })
        .count();
      await dialog.getByRole("button", { name: "Add date" }).click();
      await dialog.waitFor({ state: "hidden" });
      const kd = (
        await L.api(l1, "GET", `/contracts/${fx.n.contract}/key-dates`)
      ).body.deadlines.find((x) => x.label === label);
      fx.n.keyDates.five = utcDate(5);
      saveFx();
      at(l1);
      expect(
        /Global reminders:/.test(global) &&
          disabled731 &&
          buOffered &&
          kd &&
          kd.reminderOffsetDays.includes(5) &&
          kd.reminderRecipientIds.length === 0,
        JSON.stringify({ global, combined, disabled731, names, buOffered, kd }),
      );
      return `Legal Own List's Add a key date dialog read ${q(global)} (the organization list, not her own list of 3 days). Additional lead time 731 left Add lead time disabled (${disabled731}); 5 was added and the dialog read ${q(combined)}. Recipient checkboxes offered ${q(names)}, including the Business User on the team (${buOffered}); Use the usual audience controls with nothing selected: ${usualBefore}. Saved ${utcDate(5)} with lead times ${q(kd.reminderOffsetDays)} and no selected recipients.`;
    },
  );
}

/** Puts every fresh account except Legal Los Angeles on UTC (no saved timezone) before the round. */
async function morningReady() {
  await step(
    NT,
    "legal_team_member",
    "Fixture: set the fresh accounts' timezones and the No Date Bell account's Dates approaching In-app switch before the morning round",
    "Legal No Date Bell shows Dates approaching In-app off after reload; timezones saved",
    async () => {
      const l3 = await freshPage("l3");
      await openStaffNotificationSettings(l3, fx.fresh.l3.displayName);
      await setSwitch(l3, "Dates approaching In-app", false);
      await l3.reload();
      await l3.getByRole("heading", { name: "Notification preferences" }).waitFor();
      await l3.getByRole("switch", { name: "Dates approaching In-app", exact: true }).waitFor();
      const s = await switchStates(l3, [
        "Dates approaching In-app",
        "Dates approaching Push",
        "Dates Email",
      ]);
      const out = {};
      for (const k of ["l1", "l3", "a1", "b1"]) {
        const p = await freshPage(k);
        out[k] = (await L.api(p, "PATCH", "/me/preferences", { timezone: null })).status;
      }
      fx.n.morningReadyAt = new Date().toISOString();
      saveFx();
      prep(
        `At ${fx.n.morningReadyAt} the fresh Legal Own List, Legal No Date Bell, Admin and Business accounts had their saved timezone cleared (so the morning process uses UTC) through the preferences API; Legal Los Angeles kept America/Los_Angeles. The next hourly morning round runs at the top of the hour UTC.`,
      );
      expect(s["Dates approaching In-app"] === false, q(s));
      return `Legal No Date Bell after reload: ${q(s)}. Timezone clears answered ${q(out)}.`;
    },
  );
}

// Jonas Weber reached the lab's limit of 20 Requests an hour (other agents share him), so the
// fresh Business User raises the V-C07 Requests and walks the Portal steps.
async function jonasPage() {
  return freshPage("b1");
}

// ---------- V-C07 fixtures ----------
async function setupComments() {
  const d = ctx.daniel.page;
  const j = await jonasPage();
  await step(
    CA,
    "administrator",
    "Fixture: the fresh Business User's Requests become a Contract, a Matter, and a to-be-archived Contract; Nadia Haddad joins the teams",
    "Records created and teams set",
    async () => {
      const types = (await L.api(d, "GET", "/request-types")).body.requestTypes;
      const deps = (await L.api(d, "GET", "/departments/options")).body.departments;
      const ct = (await L.api(d, "GET", "/contract-types")).body.contractTypes;
      const mt = (await L.api(d, "GET", "/matter-types")).body;
      const question = types.find((t) => t.slug === "legal_question");
      const submit = async (title) => {
        const r = await L.api(j, "POST", "/requests", {
          requestTypeId: question.id,
          departmentId: deps[0].id,
          title,
          description:
            "DOC-030 conversations fixture. Fictional request for the comments walkthrough.",
          urgency: "medium",
          customFields: {},
        });
        expect(r.status < 300, `submit ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
        return r.body.request;
      };
      const tag = `DOC-030 conversations ${stamp}`;
      const rc = await submit(`${tag} Contract`);
      const rm = await submit(`${tag} Matter`);
      const ru = await submit(`${tag} open Request`);
      const ra = await submit(`${tag} archive Contract`);
      const sales = ct.find((t) => t.slug === "sales");
      const litigation = (mt.matterTypes ?? mt.types).find((t) => t.slug === "litigation");
      const convert = async (req, payload) => {
        const r = await L.api(d, "POST", `/requests/${req.number}/convert`, {
          title: req.title,
          ...payload,
        });
        expect(r.status < 300, `convert ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
        return r.body.request.convertedRecord;
      };
      const contract = await convert(rc, { contractTypeId: sales.id });
      const matter = await convert(rm, { matterTypeId: litigation.id });
      const archive = await convert(ra, { contractTypeId: sales.id });
      const c = (await L.api(d, "GET", `/contracts/${contract.number}`)).body;
      const m = (await L.api(d, "GET", `/matters/${matter.number}`)).body;
      const ar = (await L.api(d, "GET", `/contracts/${archive.number}`)).body;
      const oreq = (await L.api(d, "GET", `/requests/${ru.number}`)).body;
      const users = (await L.api(d, "GET", "/users?limit=200")).body.users;
      const idOf = (email) => users.find((u) => u.email === email)?.id;
      fx.c = {
        tag,
        contractRequest: rc.number,
        matterRequest: rm.number,
        openRequest: ru.number,
        archiveRequest: ra.number,
        contract: contract.number,
        matter: matter.number,
        archive: archive.number,
        contractTitle: rc.title,
        matterTitle: rm.title,
        openTitle: ru.title,
        contractId: (c.contract ?? c).id,
        matterId: (m.matter ?? m).id,
        archiveId: (ar.contract ?? ar).id,
        openRequestId: (oreq.request ?? oreq).id,
        ids: {
          daniel: idOf(L.PEOPLE.daniel.email),
          nadia: idOf(L.PEOPLE.nadia.email),
          jonas: fx.fresh.b1.id,
          amara: idOf(L.PEOPLE.amara.email),
        },
      };
      for (const [kind, n] of [
        ["contracts", contract.number],
        ["matters", matter.number],
      ]) {
        const r = await L.api(d, "POST", `/${kind}/${n}/team`, { userId: fx.c.ids.nadia });
        expect(
          r.status < 300,
          `team add ${kind} ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`,
        );
      }
      saveFx();
      prep(
        `The fresh Business User (${fx.fresh.b1.displayName}) submitted four Legal question Requests through the Portal API (R-${rc.number}, R-${rm.number}, R-${ru.number}, R-${ra.number}). Daniel Okafor converted R-${rc.number} to Sales Contract C-${contract.number}, R-${rm.number} to Litigation Matter M-${matter.number}, and R-${ra.number} to Sales Contract C-${archive.number} through the convert API; R-${ru.number} stays unconverted. Daniel added Nadia Haddad to the C-${contract.number} and M-${matter.number} teams through the team API.`,
      );
      return `C-${contract.number}, M-${matter.number}, C-${archive.number}, open R-${ru.number}.`;
    },
  );
}

// ---------- V-C07 as the Legal Team Member ----------
async function memberComments() {
  const p = ctx.nadia.page;
  const role = "legal_team_member";
  const C = `${L.BASE}/contracts/${fx.c.contract}`;
  const M = `${L.BASE}/matters/${fx.c.matter}`;
  const tag = fx.c.tag;

  await step(
    CA,
    role,
    "Choose an audience on a record: open the Contract, select Comments, read the audience options and the description below the composer",
    "Legal Only and Contract Team offered, Contract Team selected first, description changes with the choice, no Internal team option",
    async () => {
      await p.goto(C);
      const a = await openComments(p);
      at(p);
      const labels = flat(await a.getByRole("group", { name: "Audience" }).innerText());
      const teamChecked = await a.getByRole("radio", { name: "Contract Team" }).isChecked();
      const teamText = await audienceText(a);
      await chooseTier(a, "Legal Only");
      const legalText = await audienceText(a);
      const internal = await a.getByRole("radio", { name: /Internal team|Working team/ }).count();
      await chooseTier(a, "Contract Team");
      expect(
        teamChecked && /Administrators and Legal Team Members/.test(legalText) && internal === 0,
        JSON.stringify({ teamChecked, legalText, internal }),
      );
      return `C-${fx.c.contract} Comments applet opened from the Applets toolbar. Audience offered ${q(labels)} with Contract Team checked first. The description read ${q(teamText)} for Contract Team and ${q(legalText)} for Legal Only. No Internal team option was offered.`;
    },
  );

  await step(
    CA,
    role,
    "Write in New comment, select Comment, and check the post appears under your name with the audience badge (Legal Only and Contract Team)",
    "Each post appears under Nadia Haddad with its audience badge",
    async () => {
      const lo = await postComment(p, `${tag} Nadia legal only note`, { tier: "Legal Only" });
      const tt = await postComment(p, `${tag} Nadia contract team note`, { tier: "Contract Team" });
      const los = await rowSummary(lo);
      const tts = await rowSummary(tt);
      expect(/Nadia Haddad/.test(los) && /Legal Only/.test(los), `legal only row ${los}`);
      expect(/Nadia Haddad/.test(tts) && /Contract Team/.test(tts), `team row ${tts}`);
      return `Rows read ${q(los)} and ${q(tts)}.`;
    },
  );

  await step(
    CA,
    role,
    "Choose an audience on a Matter: Matter Team first, Legal Only available, post both",
    "Matter Team is the starting audience and posts carry Matter Team or Legal Only badges",
    async () => {
      await p.goto(M);
      const a = await openComments(p);
      at(p);
      const labels = flat(await a.getByRole("group", { name: "Audience" }).innerText());
      const first = await a.getByRole("radio", { name: "Matter Team" }).isChecked();
      const teamText = await audienceText(a);
      const mt = await postComment(p, `${tag} Nadia matter team note`, { tier: "Matter Team" });
      const ml = await postComment(p, `${tag} Nadia matter legal only note`, {
        tier: "Legal Only",
      });
      const s1 = await rowSummary(mt);
      const s2 = await rowSummary(ml);
      expect(first && /Matter Team/.test(s1) && /Legal Only/.test(s2), `rows ${s1} / ${s2}`);
      return `M-${fx.c.matter} Audience offered ${q(labels)}, Matter Team checked first, description ${q(teamText)}. Rows read ${q(s1)} and ${q(s2)}.`;
    },
  );

  await step(
    CA,
    role,
    "Mention a person: type @ and part of a name, choose on the People tab, check Mentioned, Remove, choose again, Comment",
    "People tab lists reachable people, Files tab present for Legal, Mentioned list with Remove, post succeeds without a widen prompt",
    async () => {
      await p.goto(C);
      const a = await openComments(p);
      at(p);
      const box = a.getByRole("textbox", { name: "New comment" });
      await box.fill("");
      await box.pressSequentially(`${tag} Nadia asks @Dan`, { delay: 30 });
      const listbox = a.getByRole("listbox", { name: "People and files you can mention" });
      await listbox.waitFor({ timeout: 10000 });
      const tabs = await a.getByRole("tab").allInnerTexts();
      expect(tabs.includes("People") && tabs.includes("Files"), `tabs ${tabs}`);
      const options = await listbox.getByRole("option").allInnerTexts();
      await listbox.getByRole("option", { name: /Daniel Okafor/ }).click();
      const mentioned = a.getByRole("list", { name: "Mentioned" });
      await mentioned.waitFor({ timeout: 5000 });
      const picked = flat(await mentioned.innerText());
      await mentioned.getByRole("button", { name: "Remove Daniel Okafor" }).click();
      const afterRemove = await a.getByRole("list", { name: "Mentioned" }).count();
      await box.pressSequentially(" @Dan", { delay: 30 });
      await listbox.getByRole("option", { name: /Daniel Okafor/ }).click();
      await box.pressSequentially(" to check the notice letter.", { delay: 5 });
      await a.getByRole("button", { name: "Comment", exact: true }).click();
      const row = rowWith(a, "to check the notice letter.").first();
      await row.waitFor({ timeout: 15000 });
      const widen = await p.getByRole("dialog", { name: "Widen the audience?" }).count();
      expect(widen === 0 && afterRemove === 0, `widen ${widen} afterRemove ${afterRemove}`);
      return `Typing @Dan opened the tabs ${q(tabs)} with People selected, listing ${q(options.map(flat))}. Choosing Daniel Okafor added ${q(picked)} to the Mentioned list; Remove Daniel Okafor emptied it. After choosing him again, Comment posted ${q(await rowSummary(row))} at Contract Team without a widen prompt.`;
    },
  );

  await step(
    CA,
    role,
    "Typing a name as ordinary text alone does not select a recipient",
    "No Mentioned list when the name is typed without choosing from the list",
    async () => {
      const a = applet(p);
      const box = a.getByRole("textbox", { name: "New comment" });
      await box.fill(`${tag} plain text Daniel Okafor without a pick`);
      await p.waitForTimeout(500);
      const lists = await a.getByRole("list", { name: "Mentioned" }).count();
      await box.fill("");
      expect(lists === 0, "Mentioned list appeared");
      return 'Typing "Daniel Okafor" without @ and without choosing showed no Mentioned list; the draft was cleared unposted.';
    },
  );

  await step(
    CA,
    role,
    "Widen the audience? on a Legal Only mention of a Business User: Cancel keeps editing without posting, Widen and post posts at the proposed audience",
    "Dialog names the proposed audience; Cancel posts nothing; Widen and post posts at Contract Team",
    async () => {
      const a = applet(p);
      await chooseTier(a, "Legal Only");
      const box = a.getByRole("textbox", { name: "New comment" });
      const text = `${tag} Nadia legal only mention for`;
      await box.fill("");
      await box.pressSequentially(`${text} @Business`, { delay: 30 });
      await a
        .getByRole("listbox", { name: "People and files you can mention" })
        .getByRole("option", { name: new RegExp(fx.fresh.b1.displayName) })
        .click();
      await a.getByRole("button", { name: "Comment", exact: true }).click();
      const dialog = p.getByRole("dialog", { name: "Widen the audience?" });
      await dialog.waitFor({ timeout: 10000 });
      const body = flat(await dialog.innerText());
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      const draftKept = await box.inputValue();
      await p.waitForTimeout(1500);
      const postedAfterCancel = await rowWith(a, text).count();
      expect(
        postedAfterCancel === 0 && draftKept.includes(text),
        "comment posted after Cancel or draft lost",
      );
      await a.getByRole("button", { name: "Comment", exact: true }).click();
      await dialog.waitFor({ timeout: 10000 });
      await dialog.getByRole("button", { name: "Widen and post" }).click();
      const row = rowWith(a, text).first();
      await row.waitFor({ timeout: 15000 });
      const s = await rowSummary(row);
      expect(/Contract Team/.test(s), `widened row ${s}`);
      return `Dialog read ${q(body)}. Cancel closed it, kept the draft ${q(draftKept)}, and no row was posted. Widen and post published ${q(s)}.`;
    },
  );

  await step(
    CA,
    role,
    "Attach paper: Attach files, choose files, check filenames, Remove one, check the audience, post, preview by filename, and Download",
    "Up to five files; selected filenames listed with Remove; post carries the remaining attachment; preview opens; Download retrieves the file",
    async () => {
      const a = applet(p);
      await chooseTier(a, "Contract Team");
      const text = `${tag} Nadia shares the notice letter`;
      await a.getByRole("textbox", { name: "New comment" }).fill(text);
      const bound = flat(await a.getByText(/^Up to \d+ files\.$/).textContent());
      const chooser = p.waitForEvent("filechooser");
      await a.getByRole("button", { name: "Attach files" }).click();
      await (
        await chooser
      ).setFiles([fixture("doc029-conv-notice.pdf"), fixture("doc029-conv-schedule.pdf")]);
      const chosen = a.getByRole("list", { name: "Files attached to this comment" });
      await chosen.waitFor({ timeout: 5000 });
      const listed = flat(await chosen.innerText());
      await a.getByRole("button", { name: "Remove doc029-conv-schedule.pdf" }).click();
      const listedAfter = flat(await chosen.innerText());
      const audience = await audienceText(a);
      await a.getByRole("button", { name: "Comment", exact: true }).click();
      const row = rowWith(a, text).first();
      await row.waitFor({ timeout: 20000 });
      const s = await rowSummary(row);
      expect(/doc029-conv-notice\.pdf/.test(s) && !/doc029-conv-schedule/.test(s), `row ${s}`);
      await row
        .getByRole("button", { name: /doc029-conv-notice\.pdf/ })
        .first()
        .click();
      const preview = p.getByRole("dialog").filter({ hasText: "doc029-conv-notice.pdf" });
      await preview.waitFor({ timeout: 15000 });
      await p.waitForTimeout(1500);
      const previewButtons = (await preview.getByRole("button").allInnerTexts())
        .map(flat)
        .filter(Boolean);
      const previewLinks = (await preview.getByRole("link").allInnerTexts())
        .map(flat)
        .filter(Boolean);
      await p.keyboard.press("Escape");
      const dl = p.waitForEvent("download");
      await row.getByRole("link", { name: "Download doc029-conv-notice.pdf" }).click();
      const download = await dl;
      const same = sha256(await download.path()) === sha256(fixture("doc029-conv-notice.pdf"));
      expect(same, "downloaded bytes differ from the fixture");
      return `Composer read ${q(bound)}. Choosing two PDFs listed ${q(listed)}; Remove doc029-conv-schedule.pdf left ${q(listedAfter)}. Audience line before posting: ${q(audience)}. Posted row ${q(s)}. Selecting the filename opened a preview dialog (buttons ${q(previewButtons)}, links ${q(previewLinks)}). Download doc029-conv-notice.pdf saved ${download.suggestedFilename()} with bytes identical to the fixture.`;
    },
  );

  await step(
    CA,
    role,
    "Attach files accepts up to five files",
    "Choosing six files keeps at most five in the list",
    async () => {
      const a = applet(p);
      await a
        .getByRole("textbox", { name: "New comment" })
        .fill(`${tag} six file probe (not posted)`);
      const chooser = p.waitForEvent("filechooser");
      await a.getByRole("button", { name: "Attach files" }).click();
      await (
        await chooser
      ).setFiles([1, 2, 3, 4, 5, 6].map((k) => fixture(`doc029-conv-extra-${k}.txt`)));
      await p.waitForTimeout(800);
      const listed = await a
        .getByRole("list", { name: "Files attached to this comment" })
        .getByRole("listitem")
        .count();
      const alert = (await a.getByRole("alert").allInnerTexts()).map(flat);
      const addDisabled = await a.getByRole("button", { name: "Attach files" }).isDisabled();
      await p.reload();
      expect(listed <= 5, `listed ${listed}`);
      return `Choosing six text files listed ${listed} files (alerts ${q(alert)}; Attach files disabled: ${addDisabled}). The draft was discarded unposted by a reload.`;
    },
  );

  await step(
    CA,
    role,
    "A failed post: keep the draft, check the error, check for an existing post, then retry once",
    "Error shown; text and paper stay in the composer; no row and no Filed to marker; retry posts exactly once",
    async () => {
      await p.goto(C);
      const a = await openComments(p);
      const text = `${tag} Nadia retry after a failed post`;
      await a.getByRole("textbox", { name: "New comment" }).fill(text);
      await a.locator('input[type="file"]').setInputFiles([fixture("doc029-conv-schedule.pdf")]);
      let aborted = 0;
      const handler = async (route) => {
        if (route.request().method() === "POST" && aborted === 0) {
          aborted += 1;
          return route.abort("failed");
        }
        return route.continue();
      };
      await p.route(/\/api\/v1\/comments(\?.*)?$/, handler);
      await a.getByRole("button", { name: "Comment", exact: true }).click();
      const alert = a.getByRole("alert").filter({ hasText: "could not be posted" });
      await alert.waitFor({ timeout: 10000 });
      const alertText = flat(await alert.textContent());
      const kept = await a.getByRole("textbox", { name: "New comment" }).inputValue();
      const paper = flat(
        await a.getByRole("list", { name: "Files attached to this comment" }).innerText(),
      );
      const rows = await rowWith(a, text).count();
      const filed = await a.getByText(/^Filed to/).count();
      await p.unroute(/\/api\/v1\/comments(\?.*)?$/, handler);
      expect(
        kept === text && /doc029-conv-schedule\.pdf/.test(paper) && rows === 0,
        "draft or paper lost, or row posted",
      );
      // Check for an existing post in a second tab before retrying, so the draft stays.
      const check = await p.context().newPage();
      await check.goto(C);
      const a2 = await openComments(check);
      const existing = await rowWith(a2, text).count();
      await check.close();
      await a.getByRole("button", { name: "Comment", exact: true }).click();
      await rowWith(a, text).first().waitFor({ timeout: 15000 });
      await p.waitForTimeout(1500);
      const count = await rowWith(a, text).count();
      expect(count === 1 && existing === 0, `posted ${count} times; existing ${existing}`);
      return `With the comment POST aborted once, the composer showed ${q(alertText)}, kept the text and the paper ${q(paper)}; no row was posted and ${filed} Filed to markers were shown. A second tab found ${existing} existing posts with that text. Selecting Comment again posted exactly ${count} row with the attachment.`;
    },
  );

  await step(
    CA,
    role,
    "File to Contract: the preview also offers it; File attachment asks for Destination, a New Document name or a New Version on an existing Document, and an optional Type; File; the attachment stays and shows Filed to",
    "Controls named in the guide; after filing, the thread row shows Filed to with the Document and Version; the Document is on the record",
    async () => {
      const a = applet(p);
      const row = rowWith(a, `${tag} Nadia shares the notice letter`).first();
      await row
        .getByRole("button", { name: /doc029-conv-notice\.pdf/ })
        .first()
        .click();
      const preview = p.getByRole("dialog").filter({ hasText: "doc029-conv-notice.pdf" });
      await preview.waitFor();
      const inPreview = await preview.getByRole("button", { name: "File to Contract" }).count();
      await p.keyboard.press("Escape");
      await preview.waitFor({ state: "hidden" });
      await row.getByRole("button", { name: "File to Contract" }).click();
      const dialog = p.getByRole("dialog", { name: "File attachment" });
      await dialog.waitFor();
      await p.waitForTimeout(800);
      const destOptions = (
        await dialog.getByLabel("Destination").locator("option").allInnerTexts()
      ).map(flat);
      const typeSelect = dialog.getByLabel("Type", { exact: true });
      const typeOptions = (await typeSelect.count())
        ? (await typeSelect.locator("option").allInnerTexts()).map(flat)
        : [];
      const docName = `${tag} filed notice letter`;
      await dialog.getByLabel("Document name").fill(docName);
      if (typeOptions.length > 1) await typeSelect.selectOption({ index: 1 });
      await dialog.getByRole("button", { name: "File", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 20000 });
      const filed = row.getByText(/Filed to/);
      await filed.waitFor({ timeout: 15000 });
      const filedText = flat(await filed.innerText());
      const stillThere = await row.getByRole("button", { name: /doc029-conv-notice\.pdf/ }).count();
      const fileAgain = await row.getByRole("button", { name: "File to Contract" }).count();
      // A second attachment filed as a New Version on that Document.
      const row2 = rowWith(a, `${tag} Nadia retry after a failed post`).first();
      await row2.getByRole("button", { name: "File to Contract" }).click();
      await dialog.waitFor();
      await p.waitForTimeout(800);
      await dialog
        .getByLabel("Destination")
        .selectOption({ label: "New Version on an existing Document" });
      await dialog.getByLabel("Document", { exact: true }).selectOption({ label: docName });
      await dialog.getByLabel("Note").fill(`${tag} schedule as a new version`);
      await dialog.getByRole("button", { name: "File", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 20000 });
      const filed2 = row2.getByText(/Filed to/);
      await filed2.waitFor({ timeout: 15000 });
      const filed2Text = flat(await filed2.innerText());
      const docs = await L.api(p, "GET", `/contracts/${fx.c.contract}/documents`);
      const onRecord = JSON.stringify(docs.body).includes(docName);
      expect(
        filedText.includes(docName) &&
          stillThere > 0 &&
          onRecord &&
          fileAgain === 0 &&
          filed2Text.includes(docName),
        JSON.stringify({ filedText, filed2Text, onRecord, fileAgain }),
      );
      return `The preview offered File to Contract (${inPreview}). The row's File to Contract opened File attachment with Destination options ${q(destOptions)}, Document name, and Type options ${q(typeOptions)}. Filing as a New Document named ${q(docName)} with the first Type closed the dialog; the thread row still lists doc029-conv-notice.pdf and shows ${q(filedText)}, with ${fileAgain} File to Contract controls left on it. Filing the retry post's schedule as a New Version on an existing Document (${q(docName)}) left that row showing ${q(filed2Text)}. The record's Documents read includes the new Document.`;
    },
  );

  await step(
    CA,
    role,
    "Edit or remove a post: Edit then Cancel, Edit then Save shows edited, Delete asks for confirmation and leaves the author tombstone; no Redact for a Legal Team Member",
    "Cancel leaves the text; Save marks edited; the edit box has no audience control; Delete confirmation then Comment deleted by its author.; menu has Edit and Delete only",
    async () => {
      const a = applet(p);
      const text = `${tag} Nadia wording to correct`;
      const row = await postComment(p, text, { tier: "Contract Team" });
      await row.getByRole("button", { name: "Comment actions" }).click();
      const items = (await p.getByRole("menuitem").allInnerTexts()).map(flat);
      await p.getByRole("menuitem", { name: "Edit" }).click();
      const edit = row.getByRole("textbox", { name: "Edit comment" });
      await edit.fill(`${text} (draft change)`);
      const radiosInEdit = await row.getByRole("radio").count();
      await row.getByRole("button", { name: "Cancel" }).click();
      const afterCancel = await rowSummary(rowWith(a, text).first());
      await rowWith(a, text).first().getByRole("button", { name: "Comment actions" }).click();
      await p.getByRole("menuitem", { name: "Edit" }).click();
      await rowWith(a, text)
        .first()
        .getByRole("textbox", { name: "Edit comment" })
        .fill(`${text} corrected`);
      await rowWith(a, text).first().getByRole("button", { name: "Save" }).click();
      const editedRow = rowWith(a, `${text} corrected`).first();
      await editedRow.getByText("edited").waitFor({ timeout: 10000 });
      const afterSave = await rowSummary(editedRow);
      await editedRow.getByRole("button", { name: "Comment actions" }).click();
      await p.getByRole("menuitem", { name: "Delete" }).click();
      const confirm = p.getByRole("dialog", { name: "Delete this comment?" });
      await confirm.waitFor();
      const confirmText = flat(await confirm.innerText());
      await confirm.getByRole("button", { name: "Delete" }).click();
      await a.getByText("Comment deleted by its author.").first().waitFor({ timeout: 10000 });
      const gone = await rowWith(a, `${text} corrected`).count();
      expect(
        !items.some((i) => /Redact/.test(i)) &&
          !afterCancel.includes("draft change") &&
          !/edited/.test(afterCancel) &&
          radiosInEdit === 0 &&
          gone === 0,
        JSON.stringify({ items, afterCancel, radiosInEdit, gone }),
      );
      return `Comment actions on her own comment offered ${q(items)}. Edit opened Edit comment with ${radiosInEdit} audience radios; Cancel left ${q(afterCancel)}. Save left ${q(afterSave)}. Delete asked ${q(confirmText)}; confirming left Comment deleted by its author. and ${gone} rows with the text.`;
    },
  );

  await step(
    CA,
    role,
    "Show older and the unread Comments badge on a Matter with more comments than one page",
    "The badge counts unread comments she can see; Show older loads earlier comments; reading the loaded conversation updates the count",
    async () => {
      if (!fx.c.bulkPosted) {
        for (let i = 1; i <= 55; i++)
          await comment(
            ctx.daniel.page,
            "matter",
            fx.c.matterId,
            `${tag} Daniel bulk update ${String(i).padStart(2, "0")}`,
            "full_thread",
          );
        await comment(
          ctx.daniel.page,
          "matter",
          fx.c.matterId,
          `${tag} Daniel matter legal only bulk note`,
          "legal_only",
        );
        fx.c.bulkPosted = true;
        saveFx();
        prep(
          `Daniel Okafor posted 55 Matter Team comments and one Legal Only comment on M-${fx.c.matter} through the comments API, to give the Matter more than one page of comments.`,
        );
      }
      await p.goto(M);
      const toolbar = p.getByRole("toolbar", { name: "Applets" });
      await toolbar.waitFor();
      await p.waitForTimeout(2000);
      const before = flat(await toolbar.getByRole("button", { name: /^Comments/ }).innerText());
      const beforeName = await toolbar
        .getByRole("button", { name: /^Comments/ })
        .getAttribute("aria-label");
      const a = await openComments(p);
      const firstLoaded = await a.getByRole("listitem").count();
      const older = a.getByRole("button", { name: "Show older" });
      await older.waitFor({ timeout: 10000 });
      await older.click();
      await rowWith(a, "Daniel bulk update 01").first().waitFor({ timeout: 15000 });
      const afterOlder = await a.getByRole("listitem").count();
      await p.waitForTimeout(2000);
      await openApplet(p, "Comments");
      await p
        .getByRole("toolbar", { name: "Applets" })
        .getByRole("button", { name: /^Comments/ })
        .click();
      await p.waitForTimeout(1500);
      const after = flat(await toolbar.getByRole("button", { name: /^Comments/ }).innerText());
      const afterName = await toolbar
        .getByRole("button", { name: /^Comments/ })
        .getAttribute("aria-label");
      at(p);
      expect(afterOlder > firstLoaded, `older ${firstLoaded} -> ${afterOlder}`);
      return `Before opening, the Comments applet button read ${q(before)} (name ${q(beforeName)}). The first load listed ${firstLoaded} rows with Show older at the head; Show older brought ${afterOlder} rows including bulk update 01. After reading, the button read ${q(after)} (name ${q(afterName)}).`;
    },
  );

  await step(
    CA,
    role,
    "Read the Activity feed: History on the Matter, entries in order, Show older",
    "History lists actions on the record, including comment actions, with Show older for earlier changes",
    async () => {
      await p.goto(M);
      await openApplet(p, "History");
      const panel = p.getByRole("complementary", { name: "History" });
      await panel.waitFor();
      await p.waitForTimeout(1500);
      const n1 = await panel.getByRole("listitem").count();
      const first = flat(await panel.getByRole("listitem").first().innerText());
      await panel.getByRole("button", { name: "Show older" }).click();
      await p.waitForTimeout(2000);
      const n2 = await panel.getByRole("listitem").count();
      const last = flat(await panel.getByRole("listitem").last().innerText());
      at(p);
      expect(n2 > n1, `older did not add entries ${n1} -> ${n2}`);
      return `History listed ${n1} entries, first ${q(first)}. Show older brought ${n2} entries; the last reads ${q(last)}.`;
    },
  );

  await step(
    CA,
    role,
    "Choose an audience in the Inbox: a Request offers Legal Only and Shared with requester, starting on Legal Only; the Inbox Request has no History panel",
    "Two audiences, Legal Only first, descriptions shown; posts carry their audience; no History applet",
    async () => {
      await p.goto(`${L.BASE}/inbox/${fx.c.openRequest}`);
      const toolbar = p.getByRole("toolbar", { name: "Applets" });
      await toolbar.waitFor();
      const applets = await toolbar
        .getByRole("button")
        .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? e.textContent.trim()));
      const a = await openComments(p);
      at(p);
      const labels = flat(await a.getByRole("group", { name: "Audience" }).innerText());
      const legalFirst = await a.getByRole("radio", { name: "Legal Only" }).isChecked();
      const legalText = await audienceText(a);
      await chooseTier(a, "Shared with requester");
      const sharedText = await audienceText(a);
      const shared = await postComment(p, `${tag} Nadia shared reply on the open Request`, {
        tier: "Shared with requester",
      });
      const legal = await postComment(p, `${tag} Nadia legal only Request note`, {
        tier: "Legal Only",
      });
      expect(
        legalFirst && !applets.some((x) => /History/.test(x)),
        `applets ${applets} legalFirst ${legalFirst}`,
      );
      return `R-${fx.c.openRequest} Applets toolbar offered ${q(applets)}. Audience offered ${q(labels)} with Legal Only checked; descriptions ${q(legalText)} and ${q(sharedText)}. Posted rows ${q(await rowSummary(shared))} and ${q(await rowSummary(legal))}.`;
    },
  );

  await step(
    CA,
    role,
    "A converted Request in the Inbox has no conversation; open its linked record instead",
    "No Comments applet on the converted Request; its Status links the Contract",
    async () => {
      await p.goto(`${L.BASE}/inbox/${fx.c.contractRequest}`);
      await p.getByRole("heading", { level: 1 }).waitFor();
      await p.waitForTimeout(2000);
      const applets = await p.getByRole("toolbar", { name: "Applets" }).getByRole("button").count();
      const link = p.getByRole("link", { name: `C-${fx.c.contract}` }).first();
      const href = await link.getAttribute("href");
      await link.click();
      await p.waitForURL(new RegExp(`/contracts/${fx.c.contract}`));
      at(p);
      expect(applets === 0, `applets ${applets}`);
      return `R-${fx.c.contractRequest} in the Inbox showed ${applets} applet buttons and a link C-${fx.c.contract} (${href}); selecting it opened the Contract.`;
    },
  );

  await step(
    CA,
    role,
    "Internal team: an older Working Team comment stays readable to Legal with its label and cannot be chosen; on a Request it reads Working team",
    "Contract row shows Internal team; Inbox Request row shows Working team; neither is a composer option",
    async () => {
      if (!fx.c.workingTeam) {
        await comment(
          p,
          "contract",
          fx.c.contractId,
          `${tag} older working team note`,
          "working_team",
        );
        await comment(
          p,
          "request",
          fx.c.openRequestId,
          `${tag} older working team request note`,
          "working_team",
        );
        fx.c.workingTeam = true;
        saveFx();
        prep(
          `Nadia Haddad posted one working_team comment on C-${fx.c.contract} and one on R-${fx.c.openRequest} through the comments API to stand in for older Working Team comments; the composer does not offer that tier.`,
        );
      }
      await p.goto(C);
      let a = await openComments(p);
      const crow = rowWith(a, `${tag} older working team note`).first();
      await crow.waitFor();
      const cs = await rowSummary(crow);
      const cOptions = flat(await a.getByRole("group", { name: "Audience" }).innerText());
      await p.goto(`${L.BASE}/inbox/${fx.c.openRequest}`);
      a = await openComments(p);
      const rrow = rowWith(a, `${tag} older working team request note`).first();
      await rrow.waitFor();
      const rs = await rowSummary(rrow);
      const rOptions = flat(await a.getByRole("group", { name: "Audience" }).innerText());
      at(p);
      expect(
        /Internal team/.test(cs) &&
          /Working team/.test(rs) &&
          !/Internal|Working/.test(cOptions + rOptions),
        JSON.stringify({ cs, rs, cOptions, rOptions }),
      );
      return `Nadia's Contract row read ${q(cs)} with composer options ${q(cOptions)}. Her Inbox Request row read ${q(rs)} with options ${q(rOptions)}.`;
    },
  );

  await step(
    CA,
    role,
    "A Task has its own conversation on the Tasks tab, with no audience choice and no audience badge",
    "Task details shows Comments & attachments with a composer and no Audience radios; the posted row has no tier badge",
    async () => {
      if (!fx.c.taskId) {
        const r = await L.api(p, "POST", `/contracts/${fx.c.contract}/tasks`, {
          title: `${tag} prepare the signing pack`,
          dueDate: utcDate(10),
        });
        expect(r.status < 300, `task ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
        const listed = (await L.api(p, "GET", `/contracts/${fx.c.contract}/tasks`)).body;
        fx.c.taskId = (listed.tasks ?? listed).find(
          (x) => x.title === `${tag} prepare the signing pack`,
        )?.id;
        saveFx();
        prep(
          `Nadia Haddad added the Task "${tag} prepare the signing pack" due ${utcDate(10)} on C-${fx.c.contract} through the tasks API.`,
        );
      }
      await p.goto(`${C}/tasks`);
      await p.getByText(`${tag} prepare the signing pack`).first().click();
      const dialog = p.getByRole("dialog", { name: "Task details" });
      await dialog.waitFor({ timeout: 15000 });
      await dialog.getByText("Comments & attachments").waitFor();
      const box = dialog.getByRole("textbox", { name: "New comment" });
      await box.waitFor({ timeout: 15000 });
      const radios = await dialog.getByRole("radio").count();
      const audience = flat(
        await dialog
          .locator("p")
          .filter({ hasText: /^Visible to/ })
          .first()
          .textContent()
          .catch(() => ""),
      );
      const text = `${tag} Nadia task note`;
      await box.fill(text);
      await dialog.getByRole("button", { name: "Comment", exact: true }).click();
      const row = dialog.getByRole("listitem").filter({ hasText: text }).first();
      await row.waitFor({ timeout: 15000 });
      const s = await rowSummary(row);
      at(p);
      expect(
        radios === 0 && !/Legal Only|Contract Team|Internal team|Working team|Full Thread/.test(s),
        JSON.stringify({ radios, s }),
      );
      return `Selecting the Task on the Tasks tab opened Task details (${new URL(p.url()).pathname}${new URL(p.url()).search}) with "Comments & attachments", ${radios} audience radios and the line ${q(audience)}. The posted row read ${q(s)} with no audience badge.`;
    },
  );

  await step(
    CA,
    role,
    "If the conversation or History cannot load: follow the message to reopen; retry Show older when only the earlier page failed",
    "The conversation could not be read. Reopen the panel to try again.; reopening recovers; The earlier comments could not be read. Try again. keeps loaded rows and the retry loads more; The history could not be read. Reopen the panel to try again.",
    async () => {
      const n = p;
      await n.goto(M);
      await n.getByRole("toolbar", { name: "Applets" }).waitFor();
      let block = true;
      const thread = (route) =>
        block && route.request().method() === "GET" && !/unread|mention/.test(route.request().url())
          ? route.abort("failed")
          : route.continue();
      await n.route(/\/api\/v1\/comments\?/, thread);
      await openApplet(n, "Comments");
      const a = applet(n);
      await a
        .getByText("The conversation could not be read. Reopen the panel to try again.")
        .waitFor({ timeout: 15000 });
      block = false;
      await n.unroute(/\/api\/v1\/comments\?/, thread);
      await a.getByRole("button", { name: "Close" }).click();
      await a.waitFor({ state: "hidden" });
      await openApplet(n, "Comments");
      await a.getByRole("button", { name: "Show older" }).waitFor({ timeout: 15000 });
      const loaded = await a.getByRole("listitem").count();
      let blockOlder = true;
      const older = (route) =>
        blockOlder && /before=|cursor=/.test(route.request().url())
          ? route.abort("failed")
          : route.continue();
      await n.route(/\/api\/v1\/comments\?/, older);
      await a.getByRole("button", { name: "Show older" }).click();
      await a
        .getByText("The earlier comments could not be read. Try again.")
        .waitFor({ timeout: 15000 });
      const kept = await a.getByRole("listitem").count();
      blockOlder = false;
      await a.getByRole("button", { name: "Show older" }).click();
      await rowWith(a, "Daniel bulk update 01").first().waitFor({ timeout: 15000 });
      const more = await a.getByRole("listitem").count();
      await n.unroute(/\/api\/v1\/comments\?/, older);
      await n.goto(M);
      await n.getByRole("toolbar", { name: "Applets" }).waitFor();
      let blockHist = true;
      const hist = (route) => (blockHist ? route.abort("failed") : route.continue());
      await n.route(/\/api\/v1\/activity\?/, hist);
      await openApplet(n, "History");
      const panel = n.getByRole("complementary", { name: "History" });
      await panel
        .getByText("The history could not be read. Reopen the panel to try again.")
        .waitFor({ timeout: 15000 });
      blockHist = false;
      await n.unroute(/\/api\/v1\/activity\?/, hist);
      await panel.getByRole("button", { name: "Close" }).click();
      await panel.waitFor({ state: "hidden" });
      await openApplet(n, "History");
      await panel.getByRole("listitem").first().waitFor({ timeout: 15000 });
      const hRows = await panel.getByRole("listitem").count();
      at(n);
      expect(
        loaded > 0 && kept === loaded && more > kept && hRows > 0,
        JSON.stringify({ loaded, kept, more, hRows }),
      );
      return `A blocked thread read showed "The conversation could not be read. Reopen the panel to try again."; closing and reopening Comments loaded ${loaded} rows. A blocked earlier page showed "The earlier comments could not be read. Try again." with ${kept} rows kept; the retry brought ${more}. A blocked History read showed "The history could not be read. Reopen the panel to try again."; reopening listed ${hRows} entries.`;
    },
  );
}

// ---------- V-C07 as the Administrator ----------
async function adminComments() {
  const p = ctx.daniel.page;
  const role = "administrator";
  const C = `${L.BASE}/contracts/${fx.c.contract}`;
  const M = `${L.BASE}/matters/${fx.c.matter}`;
  const tag = fx.c.tag;

  await step(
    CA,
    role,
    "Choose an audience on a record and post at both audiences, one with Legal Only paper",
    "Legal Only and Contract Team offered; posts show under Daniel Okafor with their badges and attachment",
    async () => {
      await p.goto(C);
      const a = await openComments(p);
      at(p);
      const labels = flat(await a.getByRole("group", { name: "Audience" }).innerText());
      const first = await a.getByRole("radio", { name: "Contract Team" }).isChecked();
      const team = await postComment(p, `${tag} Daniel owner note`, { tier: "Contract Team" });
      const legal = await postComment(p, `${tag} Daniel legal only memo`, {
        tier: "Legal Only",
        files: ["doc029-conv-legal-memo.pdf"],
      });
      const s2 = await rowSummary(legal);
      expect(
        first && /Legal Only/.test(s2) && /doc029-conv-legal-memo\.pdf/.test(s2),
        `rows ${s2}`,
      );
      return `Audience offered ${q(labels)}, Contract Team first (${first}). Rows ${q(await rowSummary(team))} and ${q(s2)}.`;
    },
  );

  await step(
    CA,
    role,
    "Another author's comment: Comment actions offers Redact and no Edit",
    "The menu on Nadia's live comment offers Redact only",
    async () => {
      const a = applet(p);
      const row = rowWith(a, `${tag} Nadia contract team note`).first();
      await row.getByRole("button", { name: "Comment actions" }).click();
      const items = (await p.getByRole("menuitem").allInnerTexts()).map(flat);
      await p.keyboard.press("Escape");
      expect(items.length === 1 && items[0] === "Redact", `menu ${items}`);
      return `Comment actions on Nadia Haddad's Contract Team comment offered ${q(items)}.`;
    },
  );

  await step(
    CA,
    role,
    "File to Matter on a Matter conversation attachment",
    "A Matter Team post with paper offers File to Matter; the dialog opens with Destination; Cancel files nothing",
    async () => {
      await p.goto(M);
      await openComments(p);
      at(p);
      const row = await postComment(p, `${tag} Daniel matter paper`, {
        tier: "Matter Team",
        files: ["doc029-conv-schedule.pdf"],
      });
      const offer = await row.getByRole("button", { name: "File to Matter" }).count();
      await row.getByRole("button", { name: "File to Matter" }).click();
      const dialog = p.getByRole("dialog", { name: "File attachment" });
      await dialog.waitFor();
      const dest = (await dialog.getByLabel("Destination").locator("option").allInnerTexts()).map(
        flat,
      );
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      const filed = await row.getByText(/Filed to/).count();
      expect(offer === 1 && filed === 0, `offer ${offer} filed ${filed}`);
      return `The Matter Team row ${q(await rowSummary(row))} offered File to Matter; it opened File attachment with Destination ${q(dest)}; Cancel closed it with ${filed} Filed to markers.`;
    },
  );

  await step(
    CA,
    role,
    "Legal Request conversation: Comment actions on his own live comment edits and deletes; Request paper offers no File control",
    "Edit then Save shows edited; Delete confirmation leaves the author tombstone; a Request attachment has no File to control",
    async () => {
      await p.goto(`${L.BASE}/inbox/${fx.c.openRequest}`);
      const a = await openComments(p);
      at(p);
      const text = `${tag} Daniel request paper`;
      const row = await postComment(p, text, {
        tier: "Shared with requester",
        files: ["doc029-conv-schedule.pdf"],
      });
      const fileControls = await row.getByRole("button", { name: /^File to/ }).count();
      await row.getByRole("button", { name: "Comment actions" }).click();
      const items = (await p.getByRole("menuitem").allInnerTexts()).map(flat);
      await p.getByRole("menuitem", { name: "Edit" }).click();
      await row.getByRole("textbox", { name: "Edit comment" }).fill(`${text} revised`);
      await row.getByRole("button", { name: "Save" }).click();
      const edited = rowWith(a, `${text} revised`).first();
      await edited.getByText("edited").waitFor();
      const es = await rowSummary(edited);
      const t2 = `${tag} Daniel request note to delete`;
      const del = await postComment(p, t2, { tier: "Legal Only" });
      await del.getByRole("button", { name: "Comment actions" }).click();
      await p.getByRole("menuitem", { name: "Delete" }).click();
      const confirm = p.getByRole("dialog", { name: "Delete this comment?" });
      await confirm.getByRole("button", { name: "Delete" }).click();
      await confirm.waitFor({ state: "hidden" });
      await p.waitForTimeout(1000);
      const gone = await rowWith(a, t2).count();
      const tomb = await a.getByText("Comment deleted by its author.").count();
      expect(
        fileControls === 0 && gone === 0 && tomb > 0,
        `file ${fileControls} gone ${gone} tomb ${tomb}`,
      );
      return `On R-${fx.c.openRequest} his Shared with requester post with paper showed ${fileControls} File controls. His menu offered ${q(items)}; Save left ${q(es)}. Deleting a Legal Only note after the confirmation left ${tomb} Comment deleted by its author. tombstones and no row with its text.`;
    },
  );
}

// ---------- V-C07 as the Business User ----------
async function portalComments() {
  const p = await jonasPage();
  const role = "business_user";
  const tag = fx.c.tag;

  await step(
    CA,
    role,
    "Reply from the Portal on a never-converted Request: Comments in the applet bar, no audience picker, Legal Only and Working Team comments absent, mention and attach, Comment",
    "The Shared with requester reply is visible, Legal Only and Working team notes are absent, the reply posts under the Business User's name with paper",
    async () => {
      await p.goto(`${L.BASE}/portal/requests/${fx.c.openRequest}`);
      const a = await openComments(p);
      at(p);
      const radios = await a.getByRole("radio").count();
      const shared = await rowWith(a, `${tag} Nadia shared reply on the open Request`).count();
      const legal = await rowWith(a, `${tag} Nadia legal only Request note`).count();
      const wt = await rowWith(a, `${tag} older working team request note`).count();
      const box = a.getByRole("textbox", { name: "New comment" });
      const text = `${tag} Business User replies on the open Request for`;
      await box.pressSequentially(`${text} @Nad`, { delay: 30 });
      const listbox = a.getByRole("listbox", { name: "People and files you can mention" });
      await listbox.waitFor();
      const tabs = await a.getByRole("tab").allInnerTexts();
      const options = (await listbox.getByRole("option").allInnerTexts()).map(flat);
      await listbox.getByRole("option", { name: /Nadia Haddad/ }).click();
      const chooser = p.waitForEvent("filechooser");
      await a.getByRole("button", { name: "Attach files" }).click();
      await (await chooser).setFiles([fixture("doc029-conv-portal-note.pdf")]);
      await a.getByRole("button", { name: "Comment", exact: true }).click();
      const row = rowWith(a, text).first();
      await row.waitFor({ timeout: 15000 });
      const s = await rowSummary(row);
      expect(
        radios === 0 &&
          shared === 1 &&
          legal === 0 &&
          wt === 0 &&
          s.includes(fx.fresh.b1.displayName) &&
          /doc029-conv-portal-note\.pdf/.test(s),
        JSON.stringify({ radios, shared, legal, wt, s }),
      );
      return `R-${fx.c.openRequest} Portal Comments showed ${radios} audience radios, ${shared} Shared with requester reply from Nadia, ${legal} rows of her Legal Only note and ${wt} of the Working team note. @Nad showed tabs ${q(tabs)} listing ${q(options)}; after choosing Nadia Haddad and attaching doc029-conv-portal-note.pdf, Comment posted ${q(s)}.`;
    },
  );

  await step(
    CA,
    role,
    "Portal: Comment actions edits and deletes his own words",
    "Edit and Delete offered on his own comment, no Redact; edited marker; author tombstone; no actions on Legal's reply",
    async () => {
      const a = applet(p);
      const text = `${tag} Business User second thought`;
      const row = await postComment(p, text);
      await row.getByRole("button", { name: "Comment actions" }).click();
      const items = (await p.getByRole("menuitem").allInnerTexts()).map(flat);
      await p.getByRole("menuitem", { name: "Edit" }).click();
      await row.getByRole("textbox", { name: "Edit comment" }).fill(`${text} revised`);
      await row.getByRole("button", { name: "Save" }).click();
      const edited = rowWith(a, `${text} revised`).first();
      await edited.getByText("edited").waitFor();
      const es = await rowSummary(edited);
      await edited.getByRole("button", { name: "Comment actions" }).click();
      await p.getByRole("menuitem", { name: "Delete" }).click();
      const confirm = p.getByRole("dialog", { name: "Delete this comment?" });
      await confirm.getByRole("button", { name: "Delete" }).click();
      await confirm.waitFor({ state: "hidden" });
      await a.getByText("Comment deleted by its author.").first().waitFor();
      const otherMenu = await rowWith(a, `${tag} Nadia shared reply on the open Request`)
        .first()
        .getByRole("button", { name: "Comment actions" })
        .count();
      expect(
        !items.some((i) => /Redact/.test(i)) && otherMenu === 0,
        `items ${items} other ${otherMenu}`,
      );
      return `His menu offered ${q(items)}; Save left ${q(es)}; Delete after confirmation left Comment deleted by its author.; Nadia's reply had ${otherMenu} Comment actions buttons.`;
    },
  );

  await step(
    CA,
    role,
    "After conversion the Request address opens the Contract; its Comments hold team comments and their paper but no Legal Only or Working Team content, no filing, no audience picker",
    "Redirect to the Portal Contract; Contract Team rows and the widened mention visible; Legal Only rows, the memo and the Internal team note absent; Download works; no File to Contract",
    async () => {
      await p.goto(`${L.BASE}/portal/requests/${fx.c.contractRequest}`);
      await p.waitForURL(new RegExp(`/portal/contracts/${fx.c.contract}`), { timeout: 20000 });
      const a = await openComments(p);
      at(p);
      const seen = {
        team: await rowWith(a, `${tag} Nadia contract team note`).count(),
        widened: await rowWith(a, `${tag} Nadia legal only mention for`).count(),
        notice: await rowWith(a, `${tag} Nadia shares the notice letter`).count(),
        danielTeam: await rowWith(a, `${tag} Daniel owner note`).count(),
        legalOnly: await rowWith(a, `${tag} Nadia legal only note`).count(),
        danielMemo: await rowWith(a, `${tag} Daniel legal only memo`).count(),
        memoFile: await a.getByText("doc029-conv-legal-memo.pdf").count(),
        workingTeam: await rowWith(a, `${tag} older working team note`).count(),
      };
      const radios = await a.getByRole("radio").count();
      const fileTo = await a.getByRole("button", { name: /^File to/ }).count();
      const row = rowWith(a, `${tag} Nadia shares the notice letter`).first();
      const dl = p.waitForEvent("download");
      await row.getByRole("link", { name: "Download doc029-conv-notice.pdf" }).click();
      const download = await dl;
      const same = sha256(await download.path()) === sha256(fixture("doc029-conv-notice.pdf"));
      expect(
        seen.team &&
          seen.widened &&
          seen.notice &&
          seen.danielTeam &&
          !seen.legalOnly &&
          !seen.danielMemo &&
          !seen.memoFile &&
          !seen.workingTeam &&
          radios === 0 &&
          fileTo === 0 &&
          same,
        JSON.stringify({ seen, radios, fileTo, same }),
      );
      return `/portal/requests/${fx.c.contractRequest} redirected to ${new URL(p.url()).pathname}. Comments counts ${q(seen)}; ${radios} audience radios; ${fileTo} File to controls; the notice letter downloaded with fixture-identical bytes. Its row read ${q(await rowSummary(row))}.`;
    },
  );

  await step(
    CA,
    role,
    "Portal Matter: Show older; Legal Only notes absent",
    "Show older loads the earlier Matter Team comments; the Legal Only notes are not in the view",
    async () => {
      await p.goto(`${L.BASE}/portal/matters/${fx.c.matter}`);
      const toolbar = p.getByRole("toolbar", { name: "Applets" });
      await toolbar.waitFor();
      await p.waitForTimeout(2000);
      const badge = flat(await toolbar.getByRole("button", { name: /^Comments/ }).innerText());
      const a = await openComments(p);
      at(p);
      await a.getByRole("button", { name: "Show older" }).click();
      await rowWith(a, "Daniel bulk update 01").first().waitFor();
      const legal = await rowWith(a, `${tag} Daniel matter legal only bulk note`).count();
      const legal2 = await rowWith(a, `${tag} Nadia matter legal only note`).count();
      const team = await rowWith(a, `${tag} Nadia matter team note`).count();
      expect(legal === 0 && legal2 === 0 && team === 1, `legal ${legal}/${legal2} team ${team}`);
      return `Before opening, the Portal Comments button read ${q(badge)}. Show older loaded bulk update 01; Nadia's Matter Team note was present; the Legal Only notes from Daniel and Nadia were absent (${legal}, ${legal2}).`;
    },
  );
}

// ---------- V-C07 Portal History record progress ----------
async function historyEntries(page, portal = false) {
  const panel = page.getByRole("complementary", { name: "History" });
  await panel.waitFor();
  await page.waitForTimeout(2000);
  for (let i = 0; i < 6; i++) {
    const older = panel.getByRole("button", { name: "Show older" });
    if (!(await older.count())) break;
    await older.click();
    await page.waitForTimeout(1500);
  }
  return (await panel.getByRole("listitem").allInnerTexts()).map(flat);
}
async function portalHistory() {
  const n = ctx.nadia.page;
  const j = await jonasPage();
  const tag = fx.c.tag;
  const role = "business_user";
  await step(
    CA,
    "legal_team_member",
    "Fixture: Legal record progress on the Contract and the Matter for the Portal History checks",
    "Stage move, same-Stage Status move, title and Portal-visible and hidden Field edits, Task added, edited, completed, reordered and removed, a Matter Status move and closing",
    async () => {
      if (fx.c.progressDone) return "Already arranged in an earlier run.";
      const statuses = (await L.api(ctx.daniel.page, "GET", "/contract-statuses")).body
        .contractStatuses;
      const sid = (slug) => statuses.find((s) => s.slug === slug).id;
      const cn = fx.c.contract;
      const out = [];
      const call = async (label, method, pathName, body) => {
        const r = await L.api(n, method, pathName, body);
        out.push(`${label} ${r.status}`);
        expect(r.status < 300, `${label} ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
        return r.body;
      };
      if (!fx.c.progressPart1) {
        await call("contract to Internal review", "PATCH", `/contracts/${cn}`, {
          statusId: sid("internal_review"),
        });
        await call("contract to With counterparty", "PATCH", `/contracts/${cn}`, {
          statusId: sid("redlining"),
        });
        await call("contract title", "PATCH", `/contracts/${cn}`, {
          title: `${fx.c.contractTitle} (renamed)`,
        });
        await call("portal-visible field", "PATCH", `/contracts/${cn}`, {
          customFields: { deal_desk_reference: `DD-${stamp}` },
        });
        await call("hidden field", "PATCH", `/contracts/${cn}`, {
          customFields: { governing_law: "England and Wales" },
        });
        await call("task added", "POST", `/contracts/${cn}/tasks`, {
          title: `${tag} collect signatures`,
          dueDate: utcDate(14),
        });
        await call("task added 2", "POST", `/contracts/${cn}/tasks`, {
          title: `${tag} draft cover note`,
        });
        fx.c.progressPart1 = true;
        saveFx();
      }
      const list = async () => {
        const t = (await L.api(n, "GET", `/contracts/${cn}/tasks`)).body;
        return t.tasks ?? t;
      };
      const byTitle = async (title) => (await list()).find((t) => t.title === title)?.id;
      if (!fx.c.progressPart2) {
        const id1 = await byTitle(`${tag} collect signatures`);
        const id2 = await byTitle(`${tag} draft cover note`);
        await call("task edited", "PATCH", `/tasks/${id2}`, {
          title: `${tag} draft cover note v2`,
        });
        await call("task completed", "POST", `/tasks/${id1}/toggle`);
        const ids = (await list()).map((t) => t.id);
        const ro = await L.api(n, "POST", `/contracts/${cn}/tasks/reorder`, {
          taskIds: [...ids].reverse(),
        });
        out.push(`task reordered ${ro.status}`);
        await call("task removed", "DELETE", `/tasks/${id2}`);
        fx.c.progressPart2 = true;
        saveFx();
      }
      const ms = JSON.parse(
        `[${psql("select json_build_object('id', id, 'slug', slug) from matter_statuses where archived_at is null").split("\n").join(",")}]`,
      );
      const mid = (slug) => ms.find((s) => s.slug === slug).id;
      const mn = fx.c.matter;
      await call("matter to In progress", "PATCH", `/matters/${mn}`, {
        statusId: mid("in_progress"),
        confirmReopen: true,
      });
      await call("matter portal-visible field", "PATCH", `/matters/${mn}`, {
        customFields: { budget_approved: 25000 },
      });
      await call("matter hidden field", "PATCH", `/matters/${mn}`, {
        customFields: { external_counsel: "Fictional Chambers LLP" },
      });
      fx.c.progressDone = true;
      saveFx();
      prep(
        `Nadia Haddad made record progress through the API as fixtures for Portal History: C-${cn} Draft to Internal review (a Stage move), Internal review to With counterparty (same Stage), a title change, deal_desk_reference (Visible on Portal) and governing_law (not on the Portal) edits, two Tasks added (one due ${utcDate(14)}), one edited, one completed, a reorder, one removed; M-${mn} (closed with a note in the first run) moved to In progress, then budget_approved (Visible on Portal) and external_counsel (not on the Portal) edits. Results: ${out.join(", ")}.`,
      );
      return out.join(", ");
    },
  );

  await step(
    CA,
    role,
    "Portal History on the Contract: shared comment activity and the record progress the Portal record shows",
    "Stage move named by Stage, title and Portal-visible Field changes, Task added with due date and Task completed; no same-Stage Status move, hidden Field, Task edit, reorder or removal, and no Legal Only or Working Team comment activity",
    async () => {
      await j.goto(`${L.BASE}/portal/contracts/${fx.c.contract}`);
      await openApplet(j, "History");
      const entries = await historyEntries(j, true);
      at(j);
      const staff = await (async () => {
        await n.goto(`${L.BASE}/contracts/${fx.c.contract}`);
        await openApplet(n, "History");
        return historyEntries(n);
      })();
      const has = (re) => entries.some((e) => re.test(e));
      const checks = {
        stage: has(/changed the stage/),
        status: has(/changed the status/),
        title: has(/changed Title/) || has(/Title/),
        visibleField:
          has(/Deal desk reference|deal desk/i) || has(/changed 2 fields|changed # fields/),
        hiddenField: has(/Governing law/i),
        taskAdded: has(new RegExp(`added the task ${tag} collect signatures, due`)),
        taskCompleted: has(new RegExp(`completed the task ${tag} collect signatures`)),
        taskEdited: has(/changed the task/),
        taskReordered: has(/reordered the task checklist/),
        taskRemoved: has(/removed the task/),
        comments: entries.filter((e) => /commented/.test(e)).length,
      };
      const staffComments = staff.filter((e) => /commented/.test(e)).length;
      expect(
        checks.stage &&
          !checks.status &&
          checks.visibleField &&
          !checks.hiddenField &&
          checks.taskAdded &&
          checks.taskCompleted &&
          !checks.taskEdited &&
          !checks.taskReordered &&
          !checks.taskRemoved &&
          checks.comments > 0 &&
          checks.comments < staffComments,
        JSON.stringify({ checks, staffComments, entries }),
      );
      return `The Business User's Portal History on C-${fx.c.contract} listed ${entries.length} entries: ${q(entries)}. Checks ${q(checks)}. Nadia's staff History listed ${staff.length} entries with ${staffComments} comment entries (the Portal showed ${checks.comments}), including ${q(staff.filter((e) => /status|stage|task|Governing/i.test(e)))}.`;
    },
  );

  await step(
    CA,
    role,
    "Portal History on the Matter: a Status move and Portal-visible Field changes, no hidden Field; then Legal closes the Matter with a note and the note stays out",
    "Matter Status move shown; Portal-visible Field shown; hidden Field and closing note absent",
    async () => {
      const mn = fx.c.matter;
      if (!fx.c.matterClosed) {
        const ms = JSON.parse(
          `[${psql("select json_build_object('id', id, 'slug', slug) from matter_statuses where archived_at is null").split("\n").join(",")}]`,
        );
        const r = await L.api(n, "PATCH", `/matters/${mn}`, {
          statusId: ms.find((s) => s.slug === "closed").id,
          closingNote: `${tag} closing note kept inside Legal`,
        });
        expect(r.status < 300, `close ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
        fx.c.matterClosed = true;
        saveFx();
        prep(
          `Nadia Haddad closed M-${mn} with a closing note through the API after the Matter conversation checks.`,
        );
      }
      await j.goto(`${L.BASE}/portal/matters/${mn}`);
      await openApplet(j, "History");
      const entries = await historyEntries(j, true);
      at(j);
      const text = entries.join(" | ");
      const checks = {
        statusMoves: entries.filter((e) => /changed the status/.test(e)).length,
        visibleField: /Budget approved|budget/i.test(text),
        hiddenField: /External counsel/i.test(text),
        closingNote: /closing note kept inside Legal/.test(text),
      };
      expect(
        checks.statusMoves >= 2 &&
          checks.visibleField &&
          !checks.hiddenField &&
          !checks.closingNote,
        JSON.stringify({ checks, entries: entries.slice(0, 12) }),
      );
      return `Portal History on M-${mn} began ${q(entries.slice(0, 8))}. Checks ${q(checks)}.`;
    },
  );

  await step(
    CA,
    role,
    "Portal History on a Request that was never converted shows only shared comment activity",
    "Only comment entries; no Legal Only or Working Team comment activity",
    async () => {
      await j.goto(`${L.BASE}/portal/requests/${fx.c.openRequest}`);
      const toolbar = j.getByRole("toolbar", { name: "Applets" });
      await toolbar.waitFor();
      const applets = await toolbar
        .getByRole("button")
        .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? e.textContent.trim()));
      await openApplet(j, "History");
      const entries = await historyEntries(j, true);
      at(j);
      const staffRows = await L.api(
        n,
        "GET",
        `/activity?entityType=request&entityId=${fx.c.openRequestId}&limit=100`,
      );
      const onlyComments = entries.every((e) => /comment/.test(e));
      expect(entries.length > 0 && onlyComments, JSON.stringify({ entries }));
      return `R-${fx.c.openRequest} Portal applets ${q(applets)}; History listed ${entries.length} entries, all comment activity: ${q(entries)}. (Staff activity read HTTP ${staffRows.status}.)`;
    },
  );
}

// ---------- V-C07 linked record redaction ----------
async function linkedRedaction() {
  const d = ctx.daniel.page;
  const n = ctx.nadia.page;
  const tag = fx.c.tag;
  await step(
    CA,
    "legal_team_member",
    "An Activity entry about a linked record you cannot reach leaves out that record's number and title",
    "Nadia's History entry for the link names no number or title of the Confidential Contract she is not on; Daniel's names it",
    async () => {
      if (!fx.c.hidden) {
        const ct = (await L.api(d, "GET", "/contract-types")).body.contractTypes;
        const r = await L.api(d, "POST", "/contracts", {
          title: `${tag} confidential side letter`,
          contractTypeId: ct.find((t) => t.slug === "sales").id,
        });
        expect(r.status < 300, `create ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
        const hidden = r.body.contract ?? r.body;
        const conf = await L.api(d, "PATCH", `/contracts/${hidden.number}`, {
          isConfidential: true,
        });
        expect(conf.status < 300, `confidential ${conf.status}`);
        const link = await L.api(d, "POST", `/contracts/${fx.c.contract}/relations`, {
          relatedContractNumber: hidden.number,
          relationType: "related",
        });
        expect(link.status < 300, `link ${link.status} ${JSON.stringify(link.body).slice(0, 300)}`);
        fx.c.hidden = { number: hidden.number, title: `${tag} confidential side letter` };
        saveFx();
        prep(
          `Daniel Okafor created C-${hidden.number} "${tag} confidential side letter", marked it Confidential (Nadia Haddad is not on its team), and linked C-${fx.c.contract} to it as related, through the API.`,
        );
      }
      const reach = (await L.api(n, "GET", `/contracts/${fx.c.hidden.number}`)).status;
      await n.goto(`${L.BASE}/contracts/${fx.c.contract}`);
      await openApplet(n, "History");
      const nEntries = (await historyEntries(n)).filter((e) => /linked this contract/.test(e));
      at(n);
      await d.goto(`${L.BASE}/contracts/${fx.c.contract}`);
      await openApplet(d, "History");
      const dEntries = (await historyEntries(d)).filter((e) => /linked this contract/.test(e));
      const hiddenRef = `C-${fx.c.hidden.number}`;
      expect(
        reach >= 400 &&
          nEntries.length > 0 &&
          !nEntries.some((e) => e.includes(hiddenRef) || e.includes("confidential side letter")) &&
          dEntries.some((e) => e.includes("confidential side letter")),
        JSON.stringify({ reach, nEntries, dEntries }),
      );
      return `Nadia's read of ${hiddenRef} answered HTTP ${reach}. Her History entry read ${q(nEntries)}; Daniel's read ${q(dEntries)}.`;
    },
  );
}

// ---------- V-C07 Administrator redaction and archive ----------
async function adminRedact() {
  const p = ctx.daniel.page;
  const role = "administrator";
  const C = `${L.BASE}/contracts/${fx.c.contract}`;
  const tag = fx.c.tag;

  await step(
    CA,
    role,
    "Redact a reached comment with paper, an author-deleted comment, and the comment whose attachment was filed",
    "Confirmation read first; the thread says Comment removed by an Administrator.; the attachment no longer serves; the filed Document stays on the record",
    async () => {
      await p.goto(C);
      const a = await openComments(p);
      at(p);
      const target = rowWith(a, `${tag} Daniel legal only memo`).first();
      const attachmentHref = await target
        .getByRole("link", { name: "Download doc029-conv-legal-memo.pdf" })
        .getAttribute("href");
      const before = (await p.request.get(`${L.BASE}${attachmentHref}`)).status();
      await target.getByRole("button", { name: "Comment actions" }).click();
      const ownItems = (await p.getByRole("menuitem").allInnerTexts()).map(flat);
      await p.getByRole("menuitem", { name: "Redact" }).click();
      const confirm = p.getByRole("dialog", { name: "Redact this comment?" });
      await confirm.waitFor();
      const text = flat(await confirm.innerText());
      await confirm.getByRole("button", { name: "Redact" }).click();
      await confirm.waitFor({ state: "hidden" });
      await p.waitForTimeout(1500);
      const after = (await p.request.get(`${L.BASE}${attachmentHref}`)).status();
      const deleted = a
        .getByRole("listitem")
        .filter({ hasText: "Comment deleted by its author." })
        .first();
      await deleted.getByRole("button", { name: "Comment actions" }).click();
      const delItems = (await p.getByRole("menuitem").allInnerTexts()).map(flat);
      await p.getByRole("menuitem", { name: "Redact" }).click();
      await confirm.getByRole("button", { name: "Redact" }).click();
      await confirm.waitFor({ state: "hidden" });
      await p.waitForTimeout(1000);
      const filedRow = rowWith(a, `${tag} Nadia shares the notice letter`).first();
      await filedRow.getByRole("button", { name: "Comment actions" }).click();
      await p.getByRole("menuitem", { name: "Redact" }).click();
      await confirm.getByRole("button", { name: "Redact" }).click();
      await confirm.waitFor({ state: "hidden" });
      await p.waitForTimeout(1500);
      const tombs = await a.getByText("Comment removed by an Administrator.").count();
      const docs = await L.api(p, "GET", `/contracts/${fx.c.contract}/documents`);
      const docStays = JSON.stringify(docs.body).includes(`${tag} filed notice letter`);
      expect(
        before === 200 && after === 404 && tombs >= 3 && docStays,
        JSON.stringify({ before, after, tombs, docStays }),
      );
      return `Redact on his own Legal Only memo (menu ${q(ownItems)}) asked ${q(text)}. After confirming, the row became Comment removed by an Administrator. and its attachment URL answered ${after} (it answered ${before} before). On Nadia's author-deleted comment the menu offered ${q(delItems)} and the redaction replaced that tombstone. Redacting the notice-letter comment left the filed Document on the record (${docStays}). The thread now shows ${tombs} administrator tombstones.`;
    },
  );

  await step(
    CA,
    role,
    "Archived record: the attachment offers no File to Contract",
    "File to Contract before archiving; none after",
    async () => {
      await p.goto(`${L.BASE}/contracts/${fx.c.archive}`);
      await openComments(p);
      const row0 = await postComment(p, `${tag} Daniel archive paper`, {
        tier: "Contract Team",
        files: ["doc029-conv-schedule.pdf"],
      });
      const beforeArchive = await row0.getByRole("button", { name: "File to Contract" }).count();
      const ar = await L.api(p, "POST", `/contracts/${fx.c.archive}/archive`);
      expect(ar.status < 300, `archive ${ar.status}`);
      prep(
        `Daniel Okafor archived C-${fx.c.archive} through the archive API after posting a Contract Team comment with paper in the browser.`,
      );
      await p.goto(`${L.BASE}/contracts/${fx.c.archive}`);
      const a = await openComments(p);
      at(p);
      const row = rowWith(a, `${tag} Daniel archive paper`).first();
      await row.waitFor();
      const after = await row.getByRole("button", { name: /^File to/ }).count();
      expect(beforeArchive === 1 && after === 0, `before ${beforeArchive} after ${after}`);
      return `Before archiving, the row offered File to Contract (${beforeArchive}). After archiving C-${fx.c.archive}, the same row showed ${after} File to controls: ${q(await rowSummary(row))}.`;
    },
  );
}

async function portalAfter() {
  const role = "business_user";
  const tag = fx.c.tag;
  const p = await jonasPage();
  const d = ctx.daniel.page;

  await step(
    CA,
    role,
    "Archived destination: the Request address shows the original request with no conversation",
    "The Portal Request page shows the archived message and no Comments",
    async () => {
      await p.goto(`${L.BASE}/portal/requests/${fx.c.archiveRequest}`);
      await p.getByRole("heading", { level: 1 }).waitFor();
      await p.waitForTimeout(2000);
      at(p);
      const msg = flat(
        await p
          .getByText(/archived/)
          .first()
          .textContent()
          .catch(() => ""),
      );
      const comments = await p.getByRole("button", { name: /^Comments/ }).count();
      const recordRead = (await L.api(p, "GET", `/portal/contracts/${fx.c.archive}`)).status;
      expect(
        /archived/.test(msg) && comments === 0 && recordRead >= 400,
        `msg ${msg} comments ${comments} record ${recordRead}`,
      );
      return `/portal/requests/${fx.c.archiveRequest} stayed at ${new URL(p.url()).pathname}, showed ${q(msg)}, and had ${comments} Comments buttons; the archived C-${fx.c.archive} record read answered HTTP ${recordRead}.`;
    },
  );

  await step(
    CA,
    role,
    "A later-added Business User reads earlier team comments; a removed person loses them, including through the old Request link",
    "Amara sees earlier Contract Team comments after being added; after removal the requester cannot open the Contract or its conversation through /portal/requests",
    async () => {
      const add = await L.api(d, "POST", `/contracts/${fx.c.contract}/team`, {
        userId: fx.c.ids.amara,
      });
      expect(add.status < 300, `add amara ${add.status}`);
      ctx.amara ??= await L.portalContext(L.PEOPLE.amara.email);
      const ap = ctx.amara.page;
      await ap.goto(`${L.BASE}/portal/contracts/${fx.c.contract}`);
      const a = await openComments(ap);
      const earlier = await rowWith(a, `${tag} Nadia contract team note`).count();
      const legal = await rowWith(a, `${tag} Nadia legal only note`).count();
      const rm = await L.api(d, "DELETE", `/contracts/${fx.c.contract}/team/${fx.c.ids.amara}`);
      await ap.goto(`${L.BASE}/portal/contracts/${fx.c.contract}`);
      await ap.waitForTimeout(3000);
      const amaraAfter = flat(await ap.locator("main").innerText()).slice(0, 160);
      const amaraApi = (await L.api(ap, "GET", `/portal/contracts/${fx.c.contract}`)).status;
      // The requester is the Business Owner after conversion; the API refuses to remove the
      // Business Owner from the team until Legal clears that field.
      const bo = await L.api(d, "PATCH", `/contracts/${fx.c.contract}`, { businessOwnerId: null });
      const rj = await L.api(d, "DELETE", `/contracts/${fx.c.contract}/team/${fx.c.ids.jonas}`);
      let jonasAfter, jonasComments, jonasApi, restore;
      try {
        await p.goto(`${L.BASE}/portal/requests/${fx.c.contractRequest}`);
        await p.waitForTimeout(3000);
        at(p);
        jonasAfter = flat(await p.locator("main").innerText()).slice(0, 200);
        jonasComments = await p.getByRole("button", { name: /^Comments/ }).count();
        jonasApi = (await L.api(p, "GET", `/portal/contracts/${fx.c.contract}`)).status;
      } finally {
        restore = await L.api(d, "POST", `/contracts/${fx.c.contract}/team`, {
          userId: fx.c.ids.jonas,
        });
        await L.api(d, "PATCH", `/contracts/${fx.c.contract}`, { businessOwnerId: fx.c.ids.jonas });
      }
      prep(
        `Daniel Okafor added Amara Nwosu (Business User) to the C-${fx.c.contract} team through the team API, then removed her again. He then cleared the Business Owner (HTTP ${bo.status}; the API refuses to take the Business Owner off the team), removed the requester from the team (HTTP ${rj.status}), and afterwards restored both.`,
      );
      expect(
        earlier === 1 &&
          legal === 0 &&
          rm.status < 300 &&
          bo.status < 300 &&
          rj.status < 300 &&
          amaraApi >= 400 &&
          jonasApi >= 400 &&
          jonasComments === 0 &&
          restore.status < 300,
        JSON.stringify({
          earlier,
          legal,
          amaraApi,
          jonasApi,
          jonasComments,
          restore: restore.status,
        }),
      );
      return `After being added, Amara Nwosu saw Nadia's earlier Contract Team note (${earlier}) and not her Legal Only note (${legal}). After removal Amara's Portal Contract page read ${q(amaraAfter)} (record read HTTP ${amaraApi}). After the requester's removal, /portal/requests/${fx.c.contractRequest} showed ${q(jonasAfter)} with ${jonasComments} Comments buttons (record read HTTP ${jonasApi}). The requester was restored to the team (HTTP ${restore.status}).`;
    },
  );
}

// ---------- V-C08 as the Legal Team Member ----------
async function memberBell() {
  const role = "legal_team_member";
  const p = await freshPage("l1");
  const n = ctx.nadia.page;
  const acct = fx.fresh.l1;
  const tag = `DOC-030 conversations ${stamp}`;
  const title = fx.n.title;

  await step(
    NT,
    role,
    "Open a notification: the badge shows 9+ over nine, unread items carry a dot, opening the panel marks nothing read, selecting an item opens its record and marks it read",
    "Badge 9+; Unread markers; count unchanged by opening; the selected item opens the Contract and becomes read",
    async () => {
      if (!fx.n.bellFill) {
        for (let i = 1; i <= 11; i++)
          await comment(
            n,
            "contract",
            fx.n.contractId,
            `${tag} bell fill ${String(i).padStart(2, "0")} for Legal Own List`,
            "full_thread",
            [acct.id],
          );
        fx.n.bellFill = true;
        saveFx();
        prep(
          `Nadia Haddad posted eleven Contract Team comments mentioning Legal Own List on C-${fx.n.contract} through the comments API to give that account more than nine unread bell items.`,
        );
        await settleQueue(2000);
      }
      await p.goto(`${L.BASE}/`);
      await bell(p).waitFor();
      await p.waitForTimeout(1500);
      const name = await bellName(p);
      const badge = flat(await bell(p).innerText());
      const before = await unreadApi(p);
      const dialog = await openBell(p);
      const unreadMarks = await dialog.getByText("Unread", { exact: true }).count();
      const item = dialog
        .getByRole("link", { name: new RegExp(`Nadia Haddad mentioned you on .*${stamp}`) })
        .first();
      await item.waitFor({ timeout: 10000 });
      const itemName = flat(await item.innerText());
      const href = await item.getAttribute("href");
      await closeBell(p);
      await p.waitForTimeout(1000);
      const afterOpen = await unreadApi(p);
      const d2 = await openBell(p);
      await d2
        .getByRole("link", { name: new RegExp(`Nadia Haddad mentioned you on .*${stamp}`) })
        .first()
        .click();
      await p.waitForURL(new RegExp(`/contracts/${fx.n.contract}`));
      at(p);
      await p.waitForTimeout(1500);
      const afterSelect = await unreadApi(p);
      const d3 = await openBell(p);
      const againName = flat(
        await d3
          .getByRole("link", { name: new RegExp(`mentioned you on .*${stamp}`) })
          .first()
          .innerText(),
      );
      await closeBell(p);
      expect(
        before > 9 &&
          badge === "9+" &&
          afterOpen === before &&
          afterSelect === before - 1 &&
          !/^Unread/.test(againName),
        JSON.stringify({ before, badge, afterOpen, afterSelect, againName }),
      );
      return `Header button read ${q(name)} with badge ${q(badge)}. The panel showed ${unreadMarks} Unread markers; the newest mention item read ${q(itemName)} linking ${href}. Closing left unread at ${afterOpen} (was ${before}). Selecting the item opened /contracts/${fx.n.contract}; unread went to ${afterSelect} and on reopening the item read ${q(againName)} without the Unread marker.`;
    },
  );

  await step(
    NT,
    role,
    "Your approvals: an open Contract Approval addressed to you is pinned first with Review; other items follow under Earlier; it counts in the badge after reading; Mark all read leaves it and the panel says so",
    "Your approvals group with Review; Earlier heading; Mark all read present while other items are unread; after Mark all read the approval stays, badge 1, note Mark all read leaves Your approvals in place.",
    async () => {
      if (!fx.n.staffApproval) {
        const r = await L.api(n, "POST", `/contracts/${fx.n.contract}/approvals`, {
          approverIds: [acct.id],
        });
        expect(r.status < 300, `approval ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
        const rows = r.body.approvals ?? r.body.requests ?? [];
        const mine =
          rows.find(
            (x) =>
              (x.approverId ?? x.approver?.id) === acct.id && (x.status ?? x.state) === "pending",
          ) ?? rows.find((x) => (x.approverId ?? x.approver?.id) === acct.id);
        fx.n.staffApproval = mine?.id ?? null;
        saveFx();
        prep(
          `Nadia Haddad requested approval of C-${fx.n.contract} from Legal Own List through the approvals API (approval ${fx.n.staffApproval}).`,
        );
        await settleQueue(2000);
      }
      await p.goto(`${L.BASE}/`);
      await p.waitForTimeout(1000);
      const dialog = await openBell(p);
      const groupHeading = dialog.getByRole("heading", { name: /Your approvals/ });
      await groupHeading.waitFor({ timeout: 10000 });
      const heading = flat(await groupHeading.innerText());
      const earlier = await dialog.getByRole("heading", { name: "Earlier" }).count();
      const section = dialog.getByRole("region", { name: "Your approvals" });
      const row = flat(await section.getByRole("listitem").first().innerText());
      const review = section.getByRole("link", { name: "Review" }).first();
      const reviewHref = await review.getAttribute("href");
      const order = await dialog.evaluate((el) =>
        [...el.querySelectorAll("h3")].map((h) => h.textContent.trim()),
      );
      const markAll = await dialog.getByRole("button", { name: "Mark all read" }).count();
      const note = flat(
        await dialog
          .getByText("Mark all read leaves Your approvals in place.")
          .textContent()
          .catch(() => ""),
      );
      await dialog.getByRole("button", { name: "Mark all read" }).click();
      await p.waitForTimeout(1500);
      const unreadAfter = await unreadApi(p);
      const stillApproval = await dialog.getByRole("heading", { name: /Your approvals/ }).count();
      const markAllAfter = await dialog.getByRole("button", { name: "Mark all read" }).count();
      await closeBell(p);
      const name = await bellName(p);
      const badge = flat(await bell(p).innerText());
      const d2 = await openBell(p);
      await d2.getByRole("link", { name: "Review" }).first().click();
      await p.waitForTimeout(2000);
      const landed = at(p);
      await p.goto(`${L.BASE}/`);
      await p.waitForTimeout(1000);
      const stillCounted = await unreadApi(p);
      expect(
        earlier === 1 &&
          markAll === 1 &&
          stillApproval === 1 &&
          markAllAfter === 0 &&
          unreadAfter >= 1 &&
          note &&
          stillCounted >= 1,
        JSON.stringify({
          heading,
          earlier,
          markAll,
          unreadAfter,
          stillApproval,
          markAllAfter,
          note,
          stillCounted,
        }),
      );
      return `The panel headings read ${q(order)}; Your approvals (${q(heading)}) held ${q(row)} with Review linking ${reviewHref}. Mark all read was shown (${markAll}) and the foot read ${q(note)}. After Mark all read the unread count was ${unreadAfter}, Your approvals stayed (${stillApproval}) and Mark all read disappeared (${markAllAfter}); the header read ${q(name)} with badge ${q(badge)}. Selecting Review opened ${landed}; the approval still counted (${stillCounted} unread).`;
    },
  );

  await step(
    NT,
    role,
    "An approval leaves Your approvals when you answer it",
    "After answering, the group is gone and the badge drops",
    async () => {
      const before = await unreadApi(p);
      const r = await L.api(p, "POST", `/approvals/${fx.n.staffApproval}/decision`, {
        decision: "approved",
        note: "DOC-030 fictional approval",
      });
      prep(
        `Legal Own List answered approval ${fx.n.staffApproval} through the decision API (HTTP ${r.status}); the approval procedure itself belongs to the contract-approvals guide.`,
      );
      await p.goto(`${L.BASE}/`);
      await p.waitForTimeout(1500);
      const dialog = await openBell(p);
      const group = await dialog.getByRole("heading", { name: /Your approvals/ }).count();
      await closeBell(p);
      const after = await unreadApi(p);
      expect(
        r.status < 300 && group === 0 && after < before,
        JSON.stringify({ status: r.status, body: r.body, group, before, after }),
      );
      return `Answering the approval (HTTP ${r.status}) removed Your approvals from the panel (${group}) and unread went from ${before} to ${after}.`;
    },
  );

  await step(
    NT,
    role,
    "Show older loads earlier items",
    "More items after Show older",
    async () => {
      if (!fx.n.bellMore) {
        for (let i = 1; i <= 16; i++)
          await comment(
            n,
            "contract",
            fx.n.contractId,
            `${tag} bell page ${String(i).padStart(2, "0")} for Legal Own List`,
            "full_thread",
            [acct.id],
          );
        fx.n.bellMore = true;
        saveFx();
        prep(
          `Nadia Haddad posted sixteen more mentions of Legal Own List on C-${fx.n.contract} through the comments API so the bell has more than one page.`,
        );
        await settleQueue(2000);
      }
      await p.goto(`${L.BASE}/`);
      const dialog = await openBell(p);
      const n1 = await dialog.getByRole("listitem").count();
      await dialog.getByRole("button", { name: "Show older" }).click();
      await p.waitForTimeout(2000);
      const n2 = await dialog.getByRole("listitem").count();
      await closeBell(p);
      expect(n2 > n1, JSON.stringify({ n1, n2 }));
      return `The panel listed ${n1} items; Show older brought ${n2}.`;
    },
  );

  await step(
    NT,
    role,
    "Change preferences: profile menu, Settings, Personal, Notifications; Notification preferences shows In-app, Email and Push per group with the documented initial choices; Briefing switches",
    "Five groups with the documented switches and initial choices; Dates approaching has no Email switch; Knowledge items has only Email; Briefing Approvals, Tasks, Dates, Obligations on and Intake off; caption",
    async () => {
      const l2 = await freshPage("l2");
      await openStaffNotificationSettings(l2, fx.fresh.l2.displayName);
      const states = await switchStates(l2, STAFF_SWITCHES);
      const diff = Object.keys(STAFF_EXPECTED).filter((k) => STAFF_EXPECTED[k] !== states[k]);
      const cols = (await l2.getByRole("columnheader").allInnerTexts()).map(flat);
      const caption = flat(
        await l2.getByText(/^These switches change the email only/).textContent(),
      );
      expect(diff.length === 0, `diff ${diff}`);
      return `Profile menu > Settings > Personal > Notifications reached ${lastPage} for Legal Los Angeles (switches untouched by other steps). Column headers ${q(cols)}. Switch states ${q(states)} match the guide's table ("absent" where the guide says there is no switch). Briefing caption ${q(caption)}.`;
    },
  );

  await step(
    NT,
    role,
    "Assigned to you: Email off keeps the bell item and sends no mail; Email on sends mail; In-app off stops the bell item and the email; each choice survives a reload; a mention gives one item, not a second comment item",
    "Mention item with no mail; then mail; then neither; reload keeps each choice; no separate commented-on item for the mention",
    async () => {
      const email = acct.email;
      const subject = `You were mentioned on ${title}`;
      const mentionRound = async (label) => {
        const since = new Date(Date.now() - 2000).toISOString();
        const beforeMail = await mailCount(email, subject);
        const id = await comment(
          n,
          "contract",
          fx.n.contractId,
          `${tag} mention round ${label}`,
          "full_thread",
          [acct.id],
        );
        await settleQueue();
        const afterMail = await mailCount(email, subject);
        const items = await aboutComment(p, id, since);
        return {
          bell: items.filter((x) => /mention/.test(x.eventType)).length,
          mail: afterMail - beforeMail,
          commentItems: items.filter((x) => x.eventType === "comment.posted").length,
        };
      };
      await openStaffNotificationSettings(p, acct.displayName);
      await setSwitch(p, "Assigned to you Email", false);
      await p.reload();
      await p.getByRole("switch", { name: "Assigned to you Email", exact: true }).waitFor();
      const keptOff = await p
        .getByRole("switch", { name: "Assigned to you Email", exact: true })
        .getAttribute("aria-checked");
      const r1 = await mentionRound("email-off");
      await setSwitch(p, "Assigned to you Email", true);
      const r2 = await mentionRound("email-on");
      await setSwitch(p, "Assigned to you In-app", false);
      await p.reload();
      await p.getByRole("switch", { name: "Assigned to you In-app", exact: true }).waitFor();
      const keptInApp = await p
        .getByRole("switch", { name: "Assigned to you In-app", exact: true })
        .getAttribute("aria-checked");
      const pushWhileOff = await p
        .getByRole("switch", { name: "Assigned to you Push", exact: true })
        .getAttribute("aria-checked");
      const r3 = await mentionRound("inapp-off");
      await setSwitch(p, "Assigned to you In-app", true);
      expect(
        keptOff === "false" &&
          r1.bell === 1 &&
          r1.mail === 0 &&
          r1.commentItems === 0 &&
          r2.bell === 1 &&
          r2.mail === 1 &&
          keptInApp === "false" &&
          r3.bell === 0 &&
          r3.mail === 0,
        JSON.stringify({ keptOff, r1, r2, keptInApp, r3 }),
      );
      return `Email off (still off after reload): a mention gave ${r1.bell} bell item, ${r1.commentItems} extra comment items, and ${r1.mail} "${subject}" mail after the queue settled. Email on: ${r2.bell} item and ${r2.mail} mail. In-app off (still off after reload; the Push switch read aria-checked=${pushWhileOff}): ${r3.bell} items and ${r3.mail} mail. In-app restored to on; Email left on.`;
    },
  );

  await step(
    NT,
    role,
    "A failed preference save shows the error and the switch returns to its earlier value",
    "An error is displayed; the switch returns to its earlier value, also after reload",
    async () => {
      await openStaffNotificationSettings(p, acct.displayName);
      const sw = p.getByRole("switch", { name: "New requests Push", exact: true });
      const before = await sw.getAttribute("aria-checked");
      const handler = (route) =>
        route.request().method() === "PATCH" ? route.abort("failed") : route.continue();
      await p.route(/\/api\/v1\/me\/notification-preferences/, handler);
      await sw.click();
      const err = p.getByText(/could not be saved/i).first();
      await err.waitFor({ timeout: 10000 });
      const errText = flat(await err.textContent());
      await p.waitForTimeout(500);
      const after = await sw.getAttribute("aria-checked");
      await p.unroute(/\/api\/v1\/me\/notification-preferences/, handler);
      await p.reload();
      const reloaded = await p
        .getByRole("switch", { name: "New requests Push", exact: true })
        .getAttribute("aria-checked");
      expect(before === after && before === reloaded, `${before} ${after} ${reloaded}`);
      return `With the save blocked, selecting New requests Push showed ${q(errText)} and the switch returned to aria-checked=${after} (was ${before}); after reload it read ${reloaded}.`;
    },
  );

  await step(
    NT,
    role,
    "New requests: a new Request reaches the Legal user's bell and opens the Inbox Request",
    "A new request item links /inbox/N and opens it",
    async () => {
      const b1 = await freshPage("b1");
      if (!fx.n.bellRequest) {
        const d = ctx.daniel.page;
        const r = await L.api(b1, "POST", "/requests", {
          requestTypeId: (await L.api(d, "GET", "/request-types")).body.requestTypes.find(
            (t) => t.slug === "legal_question",
          ).id,
          departmentId: (await L.api(d, "GET", "/departments/options")).body.departments[0].id,
          title: `DOC-030 conversations new request bell ${stamp}`,
          description: "DOC-030 conversations fictional bell check.",
          urgency: "low",
          customFields: {},
        });
        expect(r.status < 300, `submit ${r.status}`);
        fx.n.bellRequest = r.body.request.number;
        saveFx();
        prep(
          `The fresh Business User submitted R-${fx.n.bellRequest} through the Requests API for the New requests and Request receipt checks.`,
        );
        await settleQueue(2000);
      }
      await p.goto(`${L.BASE}/`);
      const dialog = await openBell(p);
      const link = await findItem(
        p,
        dialog,
        new RegExp(`new request: DOC-030 conversations new request bell ${stamp}`),
      );
      expect(link, "no new request item");
      const label = flat(await link.innerText());
      await link.click();
      await p.waitForURL(new RegExp(`/inbox/${fx.n.bellRequest}`));
      at(p);
      return `The bell item ${q(label)} opened ${new URL(p.url()).pathname}.`;
    },
  );
}

// ---------- device notifications ----------
async function devicesCardText(page) {
  const main = flat(await page.locator("main").innerText());
  const from = main.indexOf("Devices");
  const to = main.indexOf("Reminder lead times", from);
  return main.slice(from, to > from ? to : undefined);
}
async function devices() {
  const b = await L.launchNewHeadless();
  const out = {};
  await step(
    NT,
    "legal_team_member",
    "Turn on device notifications: Devices card, Turn on for this browser, allow, then the card says Notifications are on for this browser. and lists the browser; Show details in notifications; Revoke",
    "Reach as many documented states as the headless browser allows and record each",
    async () => {
      const acct = fx.fresh.l2;
      // Context 1: permission granted.
      const c1 = await b.newContext({
        baseURL: L.BASE,
        viewport: { width: 1440, height: 900 },
        storageState: undefined,
      });
      await c1.grantPermissions(["notifications"], { origin: L.BASE });
      const p1 = await c1.newPage();
      await p1.goto(`${L.BASE}/auth/login`);
      const pw = p1.getByRole("button", { name: "Sign in with a password" });
      if (await pw.isVisible().catch(() => false)) await pw.click();
      await p1.getByLabel("Email").fill(acct.email);
      await p1.getByLabel("Password").fill(freshPassword(acct.email));
      await p1.getByRole("button", { name: "Sign in", exact: true }).click();
      await p1.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 });
      await openStaffNotificationSettings(p1, acct.displayName);
      const card = p1
        .locator("div, section")
        .filter({ has: p1.getByRole("heading", { name: "Devices", exact: true }) })
        .last();
      await p1.getByRole("heading", { name: "Devices", exact: true }).waitFor();
      await p1.waitForTimeout(2000);
      out.support = await p1.evaluate(() => ({
        sw: "serviceWorker" in navigator,
        push: "PushManager" in window,
        notification: "Notification" in window,
        permission: typeof Notification !== "undefined" ? Notification.permission : null,
      }));
      out.cardBefore = await devicesCardText(p1);
      out.detailsSwitch = await p1
        .getByRole("switch", { name: "Show details in notifications" })
        .getAttribute("aria-checked");
      const turnOn = p1.getByRole("button", { name: "Turn on for this browser" });
      out.turnOnShown = await turnOn.count();
      if (out.turnOnShown) {
        await turnOn.click();
        await p1.waitForTimeout(8000);
        out.cardAfter = await devicesCardText(p1);
        out.enabled = await p1.getByText("Notifications are on for this browser.").count();
        out.subscriptions =
          (await L.api(p1, "GET", "/notifications/subscriptions")).body?.subscriptions?.length ??
          null;
        const revoke = p1.getByRole("button", { name: /^Revoke / });
        out.revokeButtons = await revoke.count();
        if (out.revokeButtons) {
          out.revokeName = await revoke.first().getAttribute("aria-label");
          await revoke.first().click();
          await p1.waitForTimeout(2500);
          out.afterRevoke = await devicesCardText(p1);
          out.subscriptionsAfterRevoke =
            (await L.api(p1, "GET", "/notifications/subscriptions")).body?.subscriptions?.length ??
            null;
        }
      }
      // Show details in notifications off and back on, saved for all browsers.
      await setSwitch(p1, "Show details in notifications", false);
      out.detailsSaved = (
        await L.api(p1, "GET", "/me/notification-preferences")
      ).body.showRecordNamesOnDevices;
      await setSwitch(p1, "Show details in notifications", true);
      await c1.close();
      // Context 2: permission denied by the browser.
      const c2 = await b.newContext({ baseURL: L.BASE, viewport: { width: 1440, height: 900 } });
      const p2 = await c2.newPage();
      await p2.goto(`${L.BASE}/auth/login`);
      const pw2 = p2.getByRole("button", { name: "Sign in with a password" });
      if (await pw2.isVisible().catch(() => false)) await pw2.click();
      await p2.getByLabel("Email").fill(acct.email);
      await p2.getByLabel("Password").fill(freshPassword(acct.email));
      await p2.getByRole("button", { name: "Sign in", exact: true }).click();
      await p2.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 });
      await openStaffNotificationSettings(p2, acct.displayName);
      at(p2);
      await p2.waitForTimeout(2000);
      const turnOn2 = p2.getByRole("button", { name: "Turn on for this browser" });
      if (await turnOn2.count()) {
        await turnOn2.click();
        await p2.waitForTimeout(4000);
      }
      const card2 = p2
        .locator("div, section")
        .filter({ has: p2.getByRole("heading", { name: "Devices", exact: true }) })
        .last();
      out.deniedCard = await devicesCardText(p2);
      out.deniedPermission = await p2.evaluate(() => Notification.permission);
      await c2.close();
      await b.close();
      const bp = await freshPage("b1");
      await bp.goto(`${L.BASE}/portal/settings`);
      await bp.getByRole("heading", { name: "Devices" }).waitFor();
      await bp.waitForTimeout(1500);
      out.portalCard = flat(await bp.locator("main").innerText())
        .split("How we tell you about your work")
        .pop()
        .slice(0, 600);
      out.portalCard = out.portalCard.slice(out.portalCard.indexOf("Devices"));
      results.records.deviceStates = out;
      expect(
        /Devices/.test(out.cardBefore) &&
          out.detailsSwitch === "true" &&
          out.detailsSaved === false,
        JSON.stringify(out),
      );
      return `Chromium (new headless mode) support ${q(out.support)}. Devices card before: ${q(out.cardBefore)}; Show details in notifications started aria-checked=${out.detailsSwitch}. With permission granted, Turn on for this browser (${out.turnOnShown}) gave ${q(out.cardAfter)} (enabled message ${out.enabled}, subscriptions ${out.subscriptions}, Revoke controls ${out.revokeButtons} ${q(out.revokeName ?? "")}; after Revoke ${q(out.afterRevoke ?? "not reached")}, subscriptions ${out.subscriptionsAfterRevoke ?? "n/a"}). Turning Show details in notifications off saved showRecordNamesOnDevices=${out.detailsSaved}; it was turned back on. In a context without the permission, Turn on for this browser left permission ${q(out.deniedPermission)} and the card read ${q(out.deniedCard)}. The Business User's Portal Notification settings Devices card (headless shell) read ${q(out.portalCard)}.`;
    },
  );
}

// ---------- V-C08 as the Administrator ----------
async function adminNotifications() {
  const role = "administrator";
  const p = await freshPage("a1");
  const n = ctx.nadia.page;
  const acct = fx.fresh.a1;
  const tag = `DOC-030 conversations ${stamp}`;
  const title = fx.n.title;

  await step(
    NT,
    role,
    "Activity on your records as the Legal Owner: Email off gives a bell item and no mail; Email on sends New comment mail; your own comment gives no item; the item opens the Contract",
    "commented on item without mail; with Email on the mail arrives; his own comment produces no item",
    async () => {
      const email = acct.email;
      const subject = `New comment on ${title}`;
      await openStaffNotificationSettings(p, acct.displayName);
      const init = await switchStates(p, [
        "Activity on your records In-app",
        "Activity on your records Email",
        "Activity on your records Push",
      ]);
      const round = async (label, actor = n) => {
        const since = new Date(Date.now() - 2000).toISOString();
        const bm = await mailCount(email, subject);
        const id = await comment(
          actor,
          "contract",
          fx.n.contractId,
          `${tag} activity round ${label}`,
          "full_thread",
        );
        await settleQueue();
        const am = await mailCount(email, subject);
        return { bell: (await aboutComment(p, id, since)).length, mail: am - bm };
      };
      const r1 = await round("email-off");
      await setSwitch(p, "Activity on your records Email", true);
      const r2 = await round("email-on");
      await setSwitch(p, "Activity on your records Email", false);
      const own = await round("own", p);
      await p.goto(`${L.BASE}/`);
      const dialog = await openBell(p);
      const link = await findItem(p, dialog, new RegExp(`Nadia Haddad commented on .*${stamp}`));
      expect(link, "no commented on item");
      const label = flat(await link.innerText());
      await link.click();
      await p.waitForURL(new RegExp(`/contracts/${fx.n.contract}`));
      at(p);
      expect(
        r1.bell === 1 &&
          r1.mail === 0 &&
          r2.bell === 1 &&
          r2.mail === 1 &&
          own.bell === 0 &&
          own.mail === 0,
        JSON.stringify({ init, r1, r2, own }),
      );
      return `Initial Activity on your records ${q(init)}. Email off: Nadia's comment gave ${r1.bell} bell item and ${r1.mail} "${subject}" mail. Email on: ${r2.bell} item and ${r2.mail} mail. Email turned off again. His own comment gave ${own.bell} items and ${own.mail} mail. The item ${q(label)} opened ${new URL(p.url()).pathname}.`;
    },
  );

  await step(
    NT,
    role,
    "If an update is missing: a failed bell read and a failed older page show their messages and recover",
    "Notifications could not be read. Close this and open it again.; reopening lists items; The older notifications could not be read. Try again.; retry loads more",
    async () => {
      await p.goto(`${L.BASE}/`);
      await bell(p).waitFor();
      let block = true;
      const handler = (route) =>
        block && route.request().method() === "GET" && !/unread-count/.test(route.request().url())
          ? route.abort("failed")
          : route.continue();
      await p.route(/\/api\/v1\/notifications(\?.*)?$/, handler);
      await bell(p).click();
      const dialog = p.getByRole("dialog", { name: "Notifications" });
      await dialog
        .getByText("Notifications could not be read. Close this and open it again.")
        .waitFor({ timeout: 10000 });
      block = false;
      await p.unroute(/\/api\/v1\/notifications(\?.*)?$/, handler);
      await closeBell(p);
      const d2 = await openBell(p);
      const rows = await d2.getByRole("listitem").count();
      let blockOlder = true;
      const older = (route) =>
        blockOlder && /cursor=/.test(route.request().url())
          ? route.abort("failed")
          : route.continue();
      await p.route(/\/api\/v1\/notifications\?/, older);
      await d2.getByRole("button", { name: "Show older" }).click();
      await d2
        .getByText("The older notifications could not be read. Try again.")
        .waitFor({ timeout: 10000 });
      const kept = await d2.getByRole("listitem").count();
      blockOlder = false;
      await d2.getByRole("button", { name: "Show older" }).click();
      await p.waitForTimeout(2000);
      const more = await d2.getByRole("listitem").count();
      await p.unroute(/\/api\/v1\/notifications\?/, older);
      await closeBell(p);
      at(p);
      expect(rows > 0 && kept === rows && more > kept, JSON.stringify({ rows, kept, more }));
      return `A blocked read showed "Notifications could not be read. Close this and open it again."; reopening listed ${rows} items. A blocked older page showed "The older notifications could not be read. Try again." with ${kept} rows kept; the retry brought ${more}.`;
    },
  );
}

// ---------- API key approvals and MCP attribution ----------
async function withMcpEnabled(fn) {
  const d = ctx.daniel.page;
  const before = (await L.api(d, "GET", "/mcp-settings")).body;
  const want = { enabled: true, legalApiKeysEnabled: true, businessApiKeysEnabled: true };
  const change = Object.fromEntries(Object.entries(want).filter(([k, v]) => before[k] !== v));
  const restore = Object.fromEntries(Object.keys(change).map((k) => [k, before[k]]));
  let set = { status: "unchanged" };
  if (Object.keys(change).length) set = await L.api(d, "PATCH", "/mcp-settings", change);
  prep(
    `Organization MCP settings before the API key checks: ${q({ enabled: before.enabled, legalApiKeysEnabled: before.legalApiKeysEnabled, businessApiKeysEnabled: before.businessApiKeysEnabled })}. Daniel Okafor set ${q(change)} through the MCP settings API (HTTP ${set.status}) for the API key and MCP attribution checks.`,
  );
  try {
    return await fn();
  } finally {
    if (Object.keys(restore).length) {
      const r = await L.api(d, "PATCH", "/mcp-settings", restore);
      prep(
        `Daniel Okafor restored the organization MCP settings to ${q(restore)} (HTTP ${r.status}).`,
      );
    }
  }
}
async function mcpCall(key, name, args) {
  const r = await fetch(`${L.BASE}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "x-api-key": key,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const text = await r.text();
  const data = text.includes("data:")
    ? text
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5))
        .join("")
    : text;
  let body;
  try {
    body = JSON.parse(data);
  } catch {
    body = data;
  }
  return { status: r.status, body };
}
async function apiKeysAndVia() {
  const a1 = await freshPage("a1");
  const l1 = await freshPage("l1");
  const b1 = await freshPage("b1");
  const tag = `DOC-030 conversations ${stamp}`;
  await withMcpEnabled(async () => {
    await step(
      NT,
      "administrator",
      "Act on Your approvals as an Administrator: an API key request appears under Your approvals with Approve and Deny in the row; Approve handles it",
      "Your approvals row names the requester and Client with Approve and Deny; after Approve the group empties and the requester is told",
      async () => {
        const req = await L.api(l1, "POST", "/api-key-requests", {
          clientName: "Claude",
          toolsets: ["comments"],
          scope: "write",
          note: "DOC-030 fictional key for the attribution check",
        });
        expect(
          req.status === 201,
          `request ${req.status} ${JSON.stringify(req.body).slice(0, 200)}`,
        );
        fx.n.keyRequest = req.body.id;
        saveFx();
        prep(
          `Legal Own List requested an API key for the Client "Claude" (comments Toolset, write) through the API key request API (request ${req.body.id}); the request procedure belongs to the Configure MCP guide.`,
        );
        await settleQueue(2000);
        await a1.goto(`${L.BASE}/`);
        await a1.waitForTimeout(1000);
        const dialog = await openBell(a1);
        const group = dialog.getByRole("heading", { name: /Your approvals/ });
        await group.waitFor({ timeout: 10000 });
        const section = dialog.getByRole("region", { name: "Your approvals" });
        const row = section
          .getByRole("listitem")
          .filter({ hasText: fx.fresh.l1.displayName })
          .first();
        const rowText = flat(await row.innerText());
        const buttons = (await row.getByRole("button").allInnerTexts()).map(flat);
        await row.getByRole("button", { name: "Approve" }).click();
        await a1.waitForTimeout(3000);
        const stillThere = await section
          .getByRole("listitem")
          .filter({ hasText: fx.fresh.l1.displayName })
          .count();
        const dialogText = flat(
          await a1
            .getByRole("dialog")
            .last()
            .innerText()
            .catch(() => ""),
        );
        await a1.keyboard.press("Escape");
        await a1.waitForTimeout(500);
        if (await a1.getByRole("dialog", { name: "Notifications" }).count()) await closeBell(a1);
        const status = (await L.api(l1, "GET", "/api-key-requests")).body.requests.find(
          (r) => r.id === fx.n.keyRequest,
        )?.status;
        at(a1);
        expect(
          buttons.includes("Approve") &&
            buttons.includes("Deny") &&
            stillThere === 0 &&
            status === "active",
          JSON.stringify({ rowText, buttons, stillThere, status }),
        );
        return `Your approvals held ${q(rowText)} with buttons ${q(buttons)}. Approve removed the row (${stillThere} left); the page then showed ${q(dialogText.slice(0, 160))}. The request status read ${status}.`;
      },
    );

    await step(
      NT,
      "legal_team_member",
      "An API key item opens the API keys page; an action through an MCP Client names the person and the Client in the bell and in History",
      "Approved item opens /settings/api-keys; a comment posted through the key reads '<person>, via Claude,' in the Administrator's bell and in the Contract History",
      async () => {
        await l1.goto(`${L.BASE}/`);
        const dialog = await openBell(l1);
        const item = await findItem(l1, dialog, /API key request was approved/);
        expect(item, "no approved item");
        const itemText = flat(await item.innerText());
        await item.click();
        await l1.waitForURL(/\/settings\/api-keys/, { timeout: 15000 });
        const landed = at(l1);
        const read = await L.api(l1, "GET", `/api-key-requests/${fx.n.keyRequest}`);
        let key = read.body.key;
        expect(key, `no key on the first detail read (${read.status})`);
        const posted = await mcpCall(key, "openlaw_comment_post", {
          entityType: "contract",
          entityId: fx.n.contractId,
          body: `${tag} posted through the Claude client`,
          visibility: "full_thread",
        });
        key = null;
        const ok = posted.status === 200 && !posted.body?.result?.isError;
        prep(
          `Legal Own List read the one-time key in memory and posted one Contract Team comment on C-${fx.n.contract} through the MCP endpoint's openlaw_comment_post tool (HTTP ${posted.status}); the key was never written down.`,
        );
        await settleQueue(2000);
        const a1 = await freshPage("a1");
        await a1.goto(`${L.BASE}/contracts/${fx.n.contract}`);
        await openApplet(a1, "History");
        const hist = (await historyEntries(a1)).filter((e) => /via Claude/.test(e));
        const bellItems = await itemsMatching(
          a1,
          /posted through the Claude client|via/,
          false,
          new Date(Date.now() - 300000).toISOString(),
        );
        const d2 = await openBell(a1);
        const viaItem = await findItem(a1, d2, /via Claude/);
        const viaText = viaItem ? flat(await viaItem.innerText()) : null;
        await closeBell(a1);
        const revoke = await L.api(l1, "POST", `/api-key-requests/${fx.n.keyRequest}/revoke`);
        prep(`Legal Own List revoked the API key after the check (HTTP ${revoke.status}).`);
        expect(
          landed.startsWith("/settings/api-keys") &&
            ok &&
            hist.length > 0 &&
            hist[0].includes(`${fx.fresh.l1.displayName}, via Claude,`),
          JSON.stringify({ itemText, landed, posted: posted.status, hist, viaText }),
        );
        return `The bell item ${q(itemText)} opened ${landed}. The comment through the key answered HTTP ${posted.status}. The Administrator's Contract History read ${q(hist)}; his bell item read ${q(viaText)} (${bellItems.length} items matched).`;
      },
    );

    await step(
      NT,
      "business_user",
      "Deny in the row: a Business User's API key request is denied from the Administrator's bell; the decision reaches the Portal bell under Assigned to you and opens the Portal API keys page",
      "Deny handles the request; the Portal item reads Your API key request was denied and opens /portal/settings/api-keys",
      async () => {
        const req = await L.api(b1, "POST", "/api-key-requests", {
          clientName: "Claude",
          toolsets: ["comments"],
          scope: "read",
        });
        expect(
          req.status === 201,
          `request ${req.status} ${JSON.stringify(req.body).slice(0, 200)}`,
        );
        fx.n.buKeyRequest = req.body.id;
        saveFx();
        prep(
          `The fresh Business User requested an API key for "Claude" (comments, read) through the API key request API (request ${req.body.id}).`,
        );
        await settleQueue(2000);
        await a1.goto(`${L.BASE}/`);
        const dialog = await openBell(a1);
        const group = dialog.getByRole("heading", { name: /Your approvals/ });
        await group.waitFor({ timeout: 10000 });
        const row = dialog
          .getByRole("region", { name: "Your approvals" })
          .getByRole("listitem")
          .filter({ hasText: fx.fresh.b1.displayName })
          .first();
        const rowText = flat(await row.innerText());
        await row.getByRole("button", { name: "Deny" }).click();
        await a1.waitForTimeout(2500);
        await closeBell(a1).catch(() => {});
        const status = (await L.api(b1, "GET", "/api-key-requests")).body.requests.find(
          (r) => r.id === fx.n.buKeyRequest,
        )?.status;
        await settleQueue(2000);
        await b1.goto(`${L.BASE}/portal`);
        const pd = await openBell(b1);
        const item = await findItem(b1, pd, /API key request was denied/);
        expect(item, "no denied item in the Portal bell");
        const itemText = flat(await item.innerText());
        await item.click();
        await b1.waitForURL(/\/portal\/settings\/api-keys/, { timeout: 15000 });
        const landed = at(b1);
        expect(status === "denied", JSON.stringify({ rowText, status, itemText, landed }));
        return `Administrator row ${q(rowText)}; Deny set the request to ${status}. The Portal bell item ${q(itemText)} opened ${landed}.`;
      },
    );

    await step(
      NT,
      "administrator",
      "A handled API key request item opens the MCP settings page",
      "The requested item, no longer an open approval, links /settings/mcp",
      async () => {
        await a1.goto(`${L.BASE}/`);
        const dialog = await openBell(a1);
        const item = await findItem(a1, dialog, /requested an API key for Claude/);
        expect(item, "no requested item");
        const itemText = flat(await item.innerText());
        await item.click();
        await a1.waitForURL(/\/settings\/mcp/, { timeout: 15000 });
        return `The handled item ${q(itemText)} opened ${at(a1)}.`;
      },
    );
  });
}

// ---------- V-C08 as the Business User ----------
async function portalNotifications() {
  const role = "business_user";
  const p = await freshPage("b1");
  const n = ctx.nadia.page;
  const d = ctx.daniel.page;
  const acct = fx.fresh.b1;
  const email = acct.email;
  const tag = `DOC-030 conversations ${stamp}`;
  const title = fx.n.title;

  await step(
    NT,
    role,
    "Portal bell: a Request receipt opens the Request; an item for the Contract converted from his Request opens the Portal Contract and says Legal replied on his request",
    "Receipt item links /portal/requests/N; the converted Contract comment item reads replied on your request and opens /portal/contracts/N",
    async () => {
      await comment(
        n,
        "contract",
        fx.n.contractId,
        `${tag} Nadia team update for the requester`,
        "full_thread",
      );
      await settleQueue(2000);
      await p.goto(`${L.BASE}/portal`);
      const name = await bellName(p);
      const dialog = await openBell(p);
      const receipt = await findItem(
        p,
        dialog,
        new RegExp(`received your request DOC-030 conversations new request bell ${stamp}`),
      );
      expect(receipt, "no receipt item");
      const rl = flat(await receipt.innerText());
      const rhref = await receipt.getAttribute("href");
      await closeBell(p);
      const d2 = await openBell(p);
      const rec = await findItem(
        p,
        d2,
        new RegExp(`Nadia Haddad replied on your request ${title}`),
      );
      expect(rec, "no replied item for the converted Contract");
      const label = flat(await rec.innerText());
      const href = await rec.getAttribute("href");
      await rec.click();
      await p.waitForURL(new RegExp(`/portal/contracts/${fx.n.contract}`));
      const landed = at(p);
      expect(rhref === `/portal/requests/${fx.n.bellRequest}`, `receipt href ${rhref}`);
      return `Portal header read ${q(name)}. Receipt item ${q(rl)} links ${rhref}. The item for Nadia's comment on the converted Contract read ${q(label)}, linked ${href}, and opened ${landed}.`;
    },
  );

  await step(
    NT,
    role,
    "Change Portal preferences: Notification settings in the header; How we tell you about your work; In-app, Email and Push for four groups with the documented initial choices; no Briefing and no Reminder lead times",
    "Four groups by three channels; Activity on your records Email and Push off; the rest on",
    async () => {
      await p.goto(`${L.BASE}/portal`);
      await p.getByRole("banner").getByRole("link", { name: "Notification settings" }).click();
      await p.getByRole("heading", { name: "Notification settings", level: 1 }).waitFor();
      await p.getByRole("heading", { name: "How we tell you about your work" }).waitFor();
      at(p);
      const groups = [
        "Request updates",
        "Assigned to you",
        "Activity on your records",
        "Dates approaching",
      ];
      const names = groups.flatMap((g) => ["In-app", "Email", "Push"].map((c) => `${g} ${c}`));
      const states = await switchStates(p, names);
      const expected = Object.fromEntries(
        names.map((k) => [k, !/^Activity on your records (Email|Push)$/.test(k)]),
      );
      const diff = names.filter((k) => states[k] !== expected[k]);
      const details = [];
      for (const re of [
        /^Receipts, replies/,
        /^Contract team additions/,
        /^Shared comments/,
        /^Key-date reminders/,
      ])
        details.push(
          flat(
            await p
              .getByText(re)
              .first()
              .textContent()
              .catch(() => ""),
          ),
        );
      const briefing = await p.getByText("Briefing", { exact: true }).count();
      const lead = await p.getByText("Reminder lead times").count();
      const total = await p.locator("main").getByRole("switch").count();
      expect(diff.length === 0 && briefing === 0 && lead === 0, JSON.stringify({ diff, states }));
      return `/portal/settings showed ${total} switches (including Show details in notifications) with states ${q(states)}; row text ${q(details)}; ${briefing} Briefing and ${lead} Reminder lead times text.`;
    },
  );

  await step(
    NT,
    role,
    "Portal Request updates: Email off keeps the bell item with no mail; Email on sends mail; In-app off stops both; choices survive reload",
    "Legal replied item without mail; with mail; neither",
    async () => {
      const subject = "Legal replied on";
      const round = async (label) => {
        const since = new Date(Date.now() - 2000).toISOString();
        const bm = (await mailSearch(`to:"${email}"`)).filter(
          (m) => m.Subject.startsWith(subject) && m.Subject.includes(fx.n.openTitle),
        ).length;
        const id = await comment(
          n,
          "request",
          fx.n.openRequestId,
          `${tag} Nadia reply round ${label}`,
          "full_thread",
        );
        await settleQueue();
        const am = (await mailSearch(`to:"${email}"`)).filter(
          (m) => m.Subject.startsWith(subject) && m.Subject.includes(fx.n.openTitle),
        ).length;
        const items = await aboutComment(p, id, since, true);
        return { bell: items.length, mail: am - bm };
      };
      await p.goto(`${L.BASE}/portal/settings`);
      await setSwitch(p, "Request updates Email", false);
      await p.reload();
      await p.getByRole("switch", { name: "Request updates Email", exact: true }).waitFor();
      const kept = await p
        .getByRole("switch", { name: "Request updates Email", exact: true })
        .getAttribute("aria-checked");
      const r1 = await round("email-off");
      await setSwitch(p, "Request updates Email", true);
      const r2 = await round("email-on");
      await setSwitch(p, "Request updates In-app", false);
      await p.reload();
      await p.getByRole("switch", { name: "Request updates In-app", exact: true }).waitFor();
      const kept2 = await p
        .getByRole("switch", { name: "Request updates In-app", exact: true })
        .getAttribute("aria-checked");
      const r3 = await round("inapp-off");
      await setSwitch(p, "Request updates In-app", true);
      at(p);
      expect(
        kept === "false" &&
          kept2 === "false" &&
          r1.bell === 1 &&
          r1.mail === 0 &&
          r2.bell === 1 &&
          r2.mail === 1 &&
          r3.bell === 0 &&
          r3.mail === 0,
        JSON.stringify({ kept, kept2, r1, r2, r3 }),
      );
      return `Email off (kept after reload): Nadia's Shared with requester reply on R-${fx.n.openRequest} gave ${r1.bell} bell item and ${r1.mail} "Legal replied on" mail. Email on: ${r2.bell} item and ${r2.mail} mail. In-app off (kept after reload): ${r3.bell} items and ${r3.mail} mail. Restored to both on.`;
    },
  );

  await step(
    NT,
    role,
    "Converted-record replies use Request updates: turning off Email for Activity on your records does not stop Legal replied on; turning off Email for Request updates does; a team member who did not raise the Request gets the comment under Activity on your records",
    "Requester gets request.replied with Legal replied on mail while Activity Email is off; no mail with Request updates Email off; Amara gets comment.posted",
    async () => {
      const add = await L.api(d, "POST", `/contracts/${fx.n.contract}/team`, {
        userId: (await L.api(d, "GET", "/users?limit=200")).body.users.find(
          (u) => u.email === L.PEOPLE.amara.email,
        ).id,
      });
      expect(add.status < 300, `add amara ${add.status}`);
      ctx.amara ??= await L.portalContext(L.PEOPLE.amara.email);
      await p.goto(`${L.BASE}/portal/settings`);
      await p.getByRole("switch", { name: "Request updates Email", exact: true }).waitFor();
      const prefs = await switchStates(p, [
        "Activity on your records Email",
        "Request updates Email",
      ]);
      const subj = `Legal replied on`;
      const once = async (label) => {
        const since = new Date(Date.now() - 2000).toISOString();
        const id = await comment(
          n,
          "contract",
          fx.n.contractId,
          `${tag} converted reply ${label}`,
          "full_thread",
        );
        await settleQueue();
        const mine = await aboutComment(p, id, since, true);
        const amara = await aboutComment(ctx.amara.page, id, since, true);
        const mail = (await mailsSince(email, since))
          .map((m) => m.Subject)
          .filter((s) => s.includes(title));
        return { mine: mine.map((x) => x.eventType), amara: amara.map((x) => x.eventType), mail };
      };
      const r1 = await once("activity-email-off");
      await setSwitch(p, "Request updates Email", false);
      const r2 = await once("request-updates-email-off");
      await setSwitch(p, "Request updates Email", true);
      const rm = await L.api(
        d,
        "DELETE",
        `/contracts/${fx.n.contract}/team/${fx.c?.ids?.amara ?? (await L.api(d, "GET", "/users?limit=200")).body.users.find((u) => u.email === L.PEOPLE.amara.email).id}`,
      );
      prep(
        `Daniel Okafor added Amara Nwosu to the C-${fx.n.contract} team for the comparison and removed her afterwards (HTTP ${rm.status}).`,
      );
      at(p);
      expect(
        r1.mine.includes("request.replied") &&
          r1.mail.some((s) => s.startsWith(subj)) &&
          r2.mine.includes("request.replied") &&
          r2.mail.length === 0 &&
          r1.amara.includes("comment.posted"),
        JSON.stringify({ prefs, r1, r2 }),
      );
      return `With ${q(prefs)}, Nadia's Contract Team comment on C-${fx.n.contract} gave the requester ${q(r1.mine)} and mail ${q(r1.mail)}; Amara (on the team, not the requester) got ${q(r1.amara)}. With Request updates Email off, the next comment gave ${q(r2.mine)} and mail ${q(r2.mail)}. Request updates Email restored.`;
    },
  );

  await step(
    NT,
    role,
    "Portal Assigned to you: a team mention on his Contract gives one mention item and You were mentioned mail; a Legal Only comment gives nothing",
    "mentioned you item with mail; nothing for Legal Only",
    async () => {
      const since = new Date(Date.now() - 2000).toISOString();
      const bm = await mailCount(email, `You were mentioned on ${title}`);
      const mid = await comment(
        n,
        "contract",
        fx.n.contractId,
        `${tag} Nadia mentions the requester`,
        "full_thread",
        [acct.id],
      );
      const lid = await comment(
        n,
        "contract",
        fx.n.contractId,
        `${tag} Nadia legal only no portal item`,
        "legal_only",
      );
      await settleQueue();
      const am = await mailCount(email, `You were mentioned on ${title}`);
      const mItems = await aboutComment(p, mid, since, true);
      const lItems = await aboutComment(p, lid, since, true);
      expect(
        am - bm === 1 &&
          mItems.length === 1 &&
          /mention/.test(mItems[0].eventType) &&
          lItems.length === 0,
        JSON.stringify({
          mention: [mItems.map((x) => x.eventType), am - bm],
          legal: lItems.length,
        }),
      );
      return `A Contract Team mention on C-${fx.n.contract} gave exactly one Portal item (${mItems.map((x) => x.eventType)}) and ${am - bm} "You were mentioned on" mail. A Legal Only comment on the same Contract gave ${lItems.length} Portal items.`;
    },
  );

  await step(
    NT,
    role,
    "Your approvals in the Portal: a Contract Approval addressed to the Business User is pinned with Review, which opens the Portal review page; it leaves the group when the requester cancels it",
    "Your approvals row with Review linking /portal/approvals/{id}; after cancel the group is gone",
    async () => {
      const r = await L.api(n, "POST", `/contracts/${fx.n.contract}/approvals`, {
        approverIds: [acct.id],
      });
      expect(r.status < 300, `approval ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
      const mine = r.body.approvals.find(
        (x) => x.approver?.id === acct.id && x.status === "pending",
      );
      prep(
        `Nadia Haddad requested approval of C-${fx.n.contract} from the fresh Business User through the approvals API (approval ${mine?.id}).`,
      );
      await settleQueue(2000);
      await p.goto(`${L.BASE}/portal`);
      await p.waitForTimeout(1000);
      const dialog = await openBell(p);
      const group = dialog.getByRole("heading", { name: /Your approvals/ });
      await group.waitFor({ timeout: 10000 });
      const section = dialog.getByRole("region", { name: "Your approvals" });
      const row = flat(await section.getByRole("listitem").first().innerText());
      const earlier = await dialog.getByRole("heading", { name: "Earlier" }).count();
      await section.getByRole("link", { name: "Review" }).first().click();
      await p.waitForURL(/\/portal\/approvals\//, { timeout: 15000 });
      const landed = at(p);
      const heading = flat(
        await p
          .getByRole("heading", { level: 1 })
          .first()
          .textContent()
          .catch(() => ""),
      );
      const cancel = await L.api(n, "DELETE", `/approvals/${mine.id}`);
      prep(
        `Nadia Haddad cancelled that approval request through the approvals API (HTTP ${cancel.status}).`,
      );
      await p.goto(`${L.BASE}/portal`);
      await p.waitForTimeout(1500);
      const d2 = await openBell(p);
      const after = await d2.getByRole("heading", { name: /Your approvals/ }).count();
      await closeBell(p);
      expect(
        landed === `/portal/approvals/${mine.id}` && earlier === 1 && after === 0,
        JSON.stringify({ landed, earlier, after }),
      );
      return `The Portal bell showed Your approvals with ${q(row)} and an Earlier heading (${earlier}). Review opened ${landed} (heading ${q(heading)}). After Nadia cancelled the request, Your approvals was gone (${after}).`;
    },
  );

  await step(
    NT,
    role,
    "A failed Portal preference save shows the error and keeps the earlier value",
    "An error; the switch reverts",
    async () => {
      await p.goto(`${L.BASE}/portal/settings`);
      const sw = p.getByRole("switch", { name: "Activity on your records Email", exact: true });
      await sw.waitFor();
      const before = await sw.getAttribute("aria-checked");
      const handler = (route) =>
        ["PATCH", "PUT", "POST"].includes(route.request().method())
          ? route.abort("failed")
          : route.continue();
      await p.route(/notification-preferences/, handler);
      await sw.click();
      const err = p.getByText(/could not be saved/i).first();
      await err.waitFor({ timeout: 10000 });
      const errText = flat(await err.textContent());
      const after = await sw.getAttribute("aria-checked");
      await p.unroute(/notification-preferences/, handler);
      await p.reload();
      const reloaded = await p
        .getByRole("switch", { name: "Activity on your records Email", exact: true })
        .getAttribute("aria-checked");
      at(p);
      expect(before === after && after === reloaded, `${before} ${after} ${reloaded}`);
      return `With the save blocked the page showed ${q(errText)}; the switch stayed aria-checked=${after} and read ${reloaded} after reload.`;
    },
  );

  await step(
    NT,
    role,
    "Removing team membership removes record notifications from the Portal bell; restoring brings them back",
    "No Contract items while off the team; items return after restore",
    async () => {
      const before = (await itemsMatching(p, new RegExp(fx.n.contractId), true, fx.n.today)).length;
      const bo = await L.api(d, "PATCH", `/contracts/${fx.n.contract}`, { businessOwnerId: null });
      const rm = await L.api(d, "DELETE", `/contracts/${fx.n.contract}/team/${acct.id}`);
      let during, visible;
      try {
        expect(rm.status < 300, `remove ${rm.status} ${JSON.stringify(rm.body).slice(0, 200)}`);
        await p.goto(`${L.BASE}/portal`);
        const dialog = await openBell(p);
        during = (await itemsMatching(p, new RegExp(fx.n.contractId), true, fx.n.today)).length;
        visible = await dialog.getByRole("link", { name: new RegExp(title) }).count();
        await closeBell(p);
      } finally {
        const add = await L.api(d, "POST", `/contracts/${fx.n.contract}/team`, { userId: acct.id });
        await L.api(d, "PATCH", `/contracts/${fx.n.contract}`, { businessOwnerId: acct.id });
        expect(add.status < 300, `restore ${add.status}`);
      }
      const after = (await itemsMatching(p, new RegExp(fx.n.contractId), true, fx.n.today)).length;
      prep(
        `Daniel Okafor cleared the Business Owner (HTTP ${bo.status}), removed the fresh Business User from the C-${fx.n.contract} team (HTTP ${rm.status}), and restored both afterwards, through the API, for the Portal bell access check.`,
      );
      expect(
        before > 0 && during === 0 && visible === 0 && after >= before,
        JSON.stringify({ before, during, visible, after }),
      );
      return `The Business User had ${before} C-${fx.n.contract} notifications; while off the team the Portal bell read returned ${during} and the panel showed ${visible} links for the Contract; after restore it returned ${after}.`;
    },
  );
}

// ---------- comment emails ----------
function htmlText(html) {
  return flat(
    html
      .replace(/<style[\s\S]*?<\/style>/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&rarr;/g, "→")
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&hellip;/g, "…"),
  );
}
async function waitMailWith(email, marker, since, timeoutMs = 45000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    for (const m of await mailsSince(email, since)) {
      const msg = await L.mailMessage(m.ID);
      const t = htmlText(msg.HTML ?? "") + " " + flat(msg.Text ?? "");
      if (!marker || t.includes(marker) || m.Subject.includes(marker))
        return {
          subject: m.Subject,
          text: htmlText(msg.HTML ?? ""),
          plain: flat(msg.Text ?? ""),
          attachments: (msg.Attachments ?? []).length,
        };
    }
    await sleep(800);
  }
  return null;
}
async function commentEmails() {
  const n = ctx.nadia.page;
  const l1 = await freshPage("l1");
  const b1 = await freshPage("b1");
  const a1 = await freshPage("a1");
  const tag = `DOC-030 conversations ${stamp}`;
  const L1 = fx.fresh.l1;

  await step(
    NT,
    "legal_team_member",
    "Read comment emails: a long Contract Team mention with an attachment arrives with the words cut at 280 characters, …, Read the full comment, the tier beside the author, no attachment, and a footer linking to notification settings",
    "Mention email shows the author with Full Thread, the cut words ending in …, Read the full comment, no attachment name, and the footer",
    async () => {
      const since = new Date(Date.now() - 1000).toISOString();
      const long =
        `${tag} long email check. ` +
        "The fictional supplier asks for a longer notice period and a revised cap on liability for data incidents. ".repeat(
          4,
        ) +
        "TAIL-MARKER-NOT-IN-EMAIL";
      const r = await n.request.post(`${L.BASE}/api/v1/comments`, {
        multipart: {
          entityType: "contract",
          entityId: fx.n.contractId,
          body: long,
          visibility: "full_thread",
          mentions: JSON.stringify([L1.id]),
          file: {
            name: "doc029-conv-schedule.pdf",
            mimeType: "application/pdf",
            buffer: readFileSync(fixture("doc029-conv-schedule.pdf")),
          },
        },
      });
      let posted = r.status();
      if (posted >= 300) {
        // Fall back to a plain comment when the multipart shape differs.
        await comment(n, "contract", fx.n.contractId, long, "full_thread", [L1.id]);
        posted = `${posted} then JSON`;
      }
      const mail = await waitMailWith(L1.email, "long email check", since);
      expect(mail, "no mention email");
      const t = mail.text;
      const checks = {
        subject: mail.subject,
        tier:
          /Nadia Haddad\s*·?\s*Full Thread/.test(t) ||
          (t.includes("Nadia Haddad") && t.includes("Full Thread")),
        cut: t.includes("…") && !t.includes("TAIL-MARKER-NOT-IN-EMAIL"),
        readFull: t.includes("Read the full comment"),
        attachmentNamed: t.includes("doc029-conv-schedule"),
        attachments: mail.attachments,
        footer: /notification settings/.test(t),
        footerText: (t.match(/[^.]*notification settings\./) ?? [""])[0].trim(),
      };
      expect(
        checks.tier &&
          checks.cut &&
          checks.readFull &&
          !checks.attachmentNamed &&
          checks.attachments === 0 &&
          checks.footer,
        JSON.stringify({ checks, posted, t: t.slice(0, 1200) }),
      );
      return `Comment posted (HTTP ${posted}). The email ${q(mail.subject)} read ${q(t.slice(0, 700))}. Checks ${q(checks)}.`;
    },
  );

  await step(
    NT,
    "legal_team_member",
    "Staff emails show Legal Only for a Legal Only comment; a Task comment email shows no tier",
    "Legal Only beside the author; no tier on a Task comment email",
    async () => {
      const since = new Date(Date.now() - 1000).toISOString();
      await comment(
        n,
        "contract",
        fx.n.contractId,
        `${tag} legal only words for the email`,
        "legal_only",
        [L1.id],
      );
      const m1 = await waitMailWith(L1.email, "legal only words for the email", since);
      if (!fx.n.taskId) {
        const t = await L.api(n, "POST", `/contracts/${fx.n.contract}/tasks`, {
          title: `${tag} email task`,
          assigneeId: L1.id,
        });
        const listed = (await L.api(n, "GET", `/contracts/${fx.n.contract}/tasks`)).body;
        fx.n.taskId = (listed.tasks ?? listed).find((x) => x.title === `${tag} email task`)?.id;
        expect(fx.n.taskId, `task ${t.status}`);
        saveFx();
        prep(
          `Nadia Haddad added the Task "${tag} email task" assigned to Legal Own List on C-${fx.n.contract} through the tasks API.`,
        );
      }
      await comment(
        n,
        "contract_task",
        fx.n.taskId,
        `${tag} task words for the email`,
        "working_team",
        [L1.id],
      );
      const m2 = await waitMailWith(L1.email, "task words for the email", since);
      expect(m1 && m2, `mails ${!!m1} ${!!m2}`);
      const tierOn = (t) =>
        ["Legal Only", "Working Team", "Full Thread"].filter((x) => t.includes(x));
      expect(
        tierOn(m1.text).includes("Legal Only") && tierOn(m2.text).length === 0,
        JSON.stringify({ m1: m1.text.slice(0, 500), m2: m2.text.slice(0, 500) }),
      );
      return `Legal Only mention email ${q(m1.subject)} named tiers ${q(tierOn(m1.text))}. Task comment email ${q(m2.subject)} named tiers ${q(tierOn(m2.text))}: ${q(m2.text.slice(0, 300))}.`;
    },
  );

  await step(
    NT,
    "business_user",
    "Portal emails show the words and no tier; only people who can read the comment receive the email",
    "Legal replied on email has the words and no tier; a Legal Only comment sends the Business User nothing",
    async () => {
      const since = new Date(Date.now() - 1000).toISOString();
      await comment(
        n,
        "contract",
        fx.n.contractId,
        `${tag} shared words for the requester email`,
        "full_thread",
      );
      await comment(
        n,
        "contract",
        fx.n.contractId,
        `${tag} legal only words the requester must not get`,
        "legal_only",
      );
      const m = await waitMailWith(
        fx.fresh.b1.email,
        "shared words for the requester email",
        since,
      );
      await settleQueue();
      const leaked = await waitMailWith(fx.fresh.b1.email, "must not get", since, 3000);
      expect(m && !leaked, `mail ${!!m} leaked ${!!leaked}`);
      const tiers = ["Legal Only", "Working Team", "Full Thread"].filter((x) => m.text.includes(x));
      expect(tiers.length === 0, `tiers ${tiers}`);
      return `The Business User's email ${q(m.subject)} read ${q(m.text.slice(0, 500))} (tiers named: ${q(tiers)}). No email carried the Legal Only words.`;
    },
  );

  await step(
    NT,
    "legal_team_member",
    "The email reads the words at send time: an edit before the send is included; a delete before the send leaves no words",
    "Edited words in the first email; no words in the second",
    async () => {
      const round = async (label, change) => {
        const since = new Date(Date.now() - 1000).toISOString();
        const id = await comment(
          n,
          "contract",
          fx.n.contractId,
          `${tag} ${label} original words`,
          "full_thread",
          [L1.id],
        );
        const r = await change(id);
        const doneAt = new Date().toISOString();
        const mail = await waitMailWith(L1.email, null, since, 30000);
        await settleQueue(2000);
        const mails = [];
        for (const m of await mailsSince(L1.email, since)) {
          const t = htmlText((await L.mailMessage(m.ID)).HTML ?? "");
          if (t.includes("You were mentioned"))
            mails.push({
              created: m.Created,
              words: t.includes(`${label} revised words`)
                ? "revised"
                : t.includes(`${label} original words`)
                  ? "original"
                  : "none",
            });
        }
        return { status: r.status, doneAt, mails, first: !!mail };
      };
      // The worker sends within milliseconds, so an edit can lose the race to the send.
      // A single email with the revised words shows the words are read at send time.
      const edits = [];
      let edit;
      for (let i = 1; i <= 10; i++) {
        const label = `edit-before-send-${stamp}-${Date.now() % 100000}`;
        edit = await round(label, (id) =>
          L.api(n, "PATCH", `/comments/${id}`, { body: `${tag} ${label} revised words` }),
        );
        edits.push(edit.mails.map((m) => m.words).join());
        if (edit.mails[0]?.words === "revised") break;
      }
      const del = await round("delete-before-send", (id) => L.api(n, "DELETE", `/comments/${id}`));
      results.records.preSendTiming = { edits, edit, del };
      expect(
        edits.length > 0 &&
          edit.status < 300 &&
          del.status < 300 &&
          edit.mails.length === 1 &&
          edit.mails[0].words === "revised" &&
          del.mails.length === 1 &&
          del.mails[0].words === "none",
        JSON.stringify({ edits, edit, del }),
      );
      return `Mentions edited right after posting gave emails with ${q(edits)} words in turn (an edit that lands after the send leaves the original words); the last edit (HTTP ${edit.status}, done ${edit.doneAt}) produced ${q(edit.mails)}: the email carried the revised words. A mention deleted right after posting (HTTP ${del.status}, done ${del.doneAt}) produced ${q(del.mails)}: the email had no words. Earlier runs of this step lost the race in the same way; see the superseded entries.`;
    },
  );

  await step(
    NT,
    "administrator",
    "An Administrator turns comment words off for the organization; the emails then link to the record without the words; the switch is put back",
    "With Include comment words in email off, a mention email has no words; restored on",
    async () => {
      await a1.goto(`${L.BASE}/settings`);
      await a1
        .getByRole("navigation", { name: "Settings sections" })
        .getByRole("group", { name: "Organization" })
        .getByRole("link", { name: "Notifications" })
        .click();
      const sw = a1.getByRole("switch", { name: "Include comment words in email" });
      await sw.waitFor();
      at(a1);
      const before = await sw.getAttribute("aria-checked");
      const help = flat(
        await a1
          .getByText(/^Applies to everyone in the organization/)
          .textContent()
          .catch(() => ""),
      );
      let mail;
      try {
        if (before === "true") {
          await sw.click();
          await a1.getByText("Saved", { exact: true }).first().waitFor({ timeout: 10000 });
        }
        prep(
          `The fresh Administrator turned "Include comment words in email" off in Settings, Organization, Notifications for one mention email, then turned it back on.`,
        );
        const since = new Date(Date.now() - 1000).toISOString();
        await comment(
          n,
          "contract",
          fx.n.contractId,
          `${tag} words while the switch is off`,
          "full_thread",
          [L1.id],
        );
        await settleQueue(2000);
        const mails = await mailsSince(L1.email, since);
        mail = mails.length
          ? {
              subject: mails[0].Subject,
              text: htmlText((await L.mailMessage(mails[0].ID)).HTML ?? ""),
            }
          : null;
      } finally {
        await a1.reload();
        const sw2 = a1.getByRole("switch", { name: "Include comment words in email" });
        await sw2.waitFor();
        if ((await sw2.getAttribute("aria-checked")) !== before) {
          await sw2.click();
          await a1.getByText("Saved", { exact: true }).first().waitFor({ timeout: 10000 });
        }
      }
      const restored = (await L.api(a1, "GET", "/org/notifications")).body.commentWordsInEmail;
      expect(
        mail && !mail.text.includes("words while the switch is off") && restored === true,
        JSON.stringify({ mail, restored }),
      );
      return `The switch started aria-checked=${before} with help ${q(help)}. With it off, the mention email ${q(mail.subject)} read ${q(mail.text.slice(0, 400))} without the words. The switch was restored (commentWordsInEmail ${restored}).`;
    },
  );
}

// ---------- morning round results ----------
async function morningCheck() {
  const k3 = `DOC-030 conversations ${stamp} three-day check`;
  const k5 = `DOC-030 conversations ${stamp} five-day check`;
  const k7 = `DOC-030 conversations ${stamp} seven-day check`;
  const since = fx.n.morningReadyAt;
  const report = {};
  for (const key of ["l1", "l2", "l3", "a1", "b1"]) {
    const page = await freshPage(key);
    const portal = key === "b1";
    const items = await itemsMatching(page, /date\.|briefing/, portal, since);
    const mails = [];
    for (const m of await mailsSince(fx.fresh[key].email, since)) {
      if (!/briefing|date|coming up|reminder/i.test(m.Subject)) continue;
      const t = htmlText((await L.mailMessage(m.ID)).HTML ?? "");
      mails.push({
        subject: m.Subject,
        keyDates: [k3, k5, k7]
          .filter((k) => t.includes(k))
          .map((k) => k.split(" ").slice(-2).join(" ")),
        sections: ["Approvals", "Tasks", "Dates", "Obligations", "Knowledge", "Intake"].filter(
          (h) => new RegExp(`\\b${h}\\b`).test(t),
        ),
        portalLink: /\/portal\//.test((await L.mailMessage(m.ID)).HTML ?? ""),
        viewAll: /View all/.test(t),
      });
    }
    report[key] = {
      bell: items.map(
        (x) =>
          `${x.eventType}:${x.payload?.label ?? ""}${x.reminderOffsetDays ?? x.payload?.reminderOffsetDays ?? x.payload?.offsetDays ?? ""}`,
      ),
      keyDates: [k3, k5, k7]
        .filter((k) => items.some((x) => JSON.stringify(x).includes(k)))
        .map((k) => k.split(" ").slice(-2).join(" ")),
      mails,
    };
  }
  results.records.morningRound = report;
  const rounds = psql(
    "select to_char(created_on, 'HH24:MI:SS') || ' ' || state from pgboss.job where name = 'notification.morning-round' order by created_on desc limit 3",
  );
  await step(
    NT,
    "legal_team_member",
    "Understand reminder timing: after the hourly round, a staff account with its own lead-time list is reminded on its list plus the Key date's own lead times; the organization list applies to others; the round waits for 8:00 in the saved timezone",
    "Legal Own List: three-day and five-day Key dates only; Administrator: five-day and seven-day only; Legal Los Angeles: nothing yet; Legal No Date Bell: no date items and no Dates section",
    async () => {
      const r = report;
      expect(
        r.l1.keyDates.join() === "three-day check,five-day check" ||
          r.l1.keyDates.sort().join() === ["five-day check", "three-day check"].join(),
        `l1 ${q(r.l1)}`,
      );
      expect(
        r.a1.keyDates.sort().join() === ["five-day check", "seven-day check"].join(),
        `a1 ${q(r.a1)}`,
      );
      expect(r.l2.keyDates.length === 0 && r.l2.mails.length === 0, `l2 ${q(r.l2)}`);
      expect(
        r.l3.keyDates.length === 0 && !r.l3.mails.some((m) => m.sections.includes("Dates")),
        `l3 ${q(r.l3)}`,
      );
      return `Morning rounds ${q(rounds)}. Legal Own List (own list [3], UTC): ${q(r.l1)}. Admin (organization list, UTC): ${q(r.a1)}. Legal Los Angeles (organization list, America/Los_Angeles, before 08:00 local): ${q(r.l2)}. Legal No Date Bell (Dates approaching In-app off): ${q(r.l3)}.`;
    },
  );
  await step(
    NT,
    "business_user",
    "Business Users receive Key-date reminders on their Contracts, including one daily email summary linking to their Portal records; no staff briefing sections",
    "Portal bell has the five-day and seven-day Key date items; one date summary email with Portal links; no Your daily briefing",
    async () => {
      const r = report.b1;
      expect(
        r.keyDates.sort().join() === ["five-day check", "seven-day check"].join() &&
          r.mails.length === 1 &&
          r.mails[0].portalLink &&
          !r.mails.some((m) => /daily briefing/i.test(m.subject)),
        q(r),
      );
      return `Business User: ${q(r)}.`;
    },
  );
  await step(
    NT,
    "administrator",
    "Set the daily briefing: the Administrator's briefing email has the Dates and Tasks sections; the daily bell summary opens Home",
    "Your daily briefing email with Dates and Tasks; Your daily briefing is ready opens /",
    async () => {
      const p = await freshPage("a1");
      await p.goto(`${L.BASE}/contracts/${fx.n.contract}`);
      const dialog = await openBell(p);
      const link = await findItem(p, dialog, /Your daily briefing is ready/);
      expect(link, "no briefing item");
      const href = await link.getAttribute("href");
      await link.click();
      await p.waitForURL((u) => u.pathname === "/", { timeout: 15000 });
      at(p);
      const r = report.a1;
      const briefing = r.mails.find((m) => /briefing/i.test(m.subject));
      expect(
        briefing &&
          briefing.sections.includes("Dates") &&
          briefing.sections.includes("Tasks") &&
          href === "/",
        q({ r, href }),
      );
      return `Admin briefing mail ${q(briefing)}; the bell item Your daily briefing is ready linked ${href} and opened Home.`;
    },
  );
}

async function viaHistory() {
  const n = ctx.nadia.page;
  await step(
    CA,
    "legal_team_member",
    "Read the Activity feed: an action taken through an MCP Client shows the person and the Client",
    "The History entry for the comment posted through the API key reads '<person>, via Claude, commented'",
    async () => {
      await n.goto(`${L.BASE}/contracts/${fx.n.contract}`);
      await openApplet(n, "History");
      const entries = (await historyEntries(n)).filter((e) => /via Claude/.test(e));
      at(n);
      expect(
        entries.some((e) => e.startsWith(`${fx.fresh.l1.displayName}, via Claude, commented`)),
        q(entries),
      );
      return `Nadia Haddad's History on C-${fx.n.contract} read ${q(entries)} for the comment Legal Own List posted through the MCP endpoint with an API key named for the Client "Claude".`;
    },
  );
}

// ---------- main ----------
let fx = existsSync(FX) ? JSON.parse(readFileSync(FX, "utf8")) : {};
const stamp = fx.stamp ?? process.env.STAMP ?? String(Date.now()).slice(-6);
fx.stamp = stamp;
results.stamp = stamp;
const ctx = {};
try {
  ctx.daniel = await L.staffContext(L.PEOPLE.daniel.email);
  ctx.nadia = await L.staffContext(L.PEOPLE.nadia.email);
  results.identities = [
    {
      role: "administrator",
      account: "Daniel Okafor (seed) and DOC-030 conversations Admin (fresh)",
      entry: "password sign-in",
    },
    {
      role: "legal_team_member",
      account: "Nadia Haddad (seed) and DOC-030 conversations Legal accounts (fresh)",
      entry: "password sign-in",
    },
    {
      role: "business_user",
      account:
        "Amara Nwosu (seed) and DOC-030 conversations Business (fresh); Jonas Weber was not used because the lab refused his Requests (20 an hour, shared with other agents)",
      entry: "fresh magic link read from the work2 Mailpit, never stored",
    },
  ];
  if (run("setup-n")) await setupNotifications();
  if (run("leadtimes") || run("leadtimes-reset")) await leadTimes();
  if (run("keydate")) await keyDateDialog();
  if (run("morning-ready")) await morningReady();
  if (run("setup-c")) await setupComments();
  if (run("member-comments")) await memberComments();
  if (run("admin-comments")) await adminComments();
  if (run("portal-comments")) await portalComments();
  if (run("portal-history")) await portalHistory();
  if (run("linked")) await linkedRedaction();
  if (run("admin-redact")) await adminRedact();
  if (run("portal-after")) await portalAfter();
  if (run("member-bell")) await memberBell();
  if (run("devices")) await devices();
  if (run("admin-notifications")) await adminNotifications();
  if (run("api-keys")) await apiKeysAndVia();
  if (run("via-history")) await viaHistory();
  if (run("portal-notifications")) await portalNotifications();
  if (run("emails")) await commentEmails();
  if (run("morning-check")) await morningCheck();
} finally {
  saveFx();
  save();
  await L.close();
}
