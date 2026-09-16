// DOC-029 round 2 compatibility replay copy of conversations/walkthrough-r2.mjs, by the DOC-029r2 compatibility reviewer (conversations).
// Changes: lab project and lab.json (work2), repository-root and fixture paths, helper import (lib-r2.mjs), and record names (DOC-029r2 conversations, doc029r2-conv-*). Checks are unchanged.
// DOC-029 round 2 independent browser walkthrough for V-C08 (notifications), group "conversations".
// Written by the DOC-029 independent walkthrough agent (conversations, round 2) from the
// corrected article text. It reuses the round 1 helpers and checks, and it replaces the
// round 1 Portal Activity check with checks of the corrected converted-record paragraph.
// It is not the author's script.
// Run from the repository root:
//   mise exec -- node docs/documentation/batches/DOC-029/conversations/walkthrough-r2.mjs
// The seed demo password comes from the environment or the published seed default.
// Magic links, cookies, and raw mail stay in memory and are never written to the log.
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as L from "./lib-r2.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../../..");
const FIX = path.join(here, "../../conversations/fixtures");
const fixture = (name) => path.join(FIX, name);
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const OUT = process.env.OUT ?? path.join(here, "walkthrough-r2.json");
const SECTIONS = (process.env.SECTIONS ?? "all").split(",");
const run = (name) => SECTIONS.includes("all") || SECTIONS.includes(name);
const PROJECT = "openlaw-docs-41255c61-work2";
const PG = `${PROJECT}-postgres-1`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => JSON.stringify(s);

const lab = JSON.parse(readFileSync(path.join(root, ".documentation-labs/work2/lab.json"), "utf8"));
const results = {
  kind: "compatibility-replay",
  task: "DOC-029",
  group: "conversations",
  round: 2,
  issues: [745, 747],
  independentReview: true,
  walkthroughReviewer: "DOC-029r2 compatibility reviewer (conversations)",
  reviewerKind: "agent",
  method: "browser-walkthrough",
  articles: ["notifications"].map((id) => ({
    articleId: id,
    articlePath: `docs/user-guides/${id}.md`,
    contentSha256: sha256(path.join(root, `docs/user-guides/${id}.md`)),
  })),
  scenarios: { notifications: "V-C08" },
  appCommit: lab.sourceCommit,
  buildId: `app ${lab.appImageId}; engine ${lab.engineImageId}`,
  environment: lab.project,
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
  sections: SECTIONS,
  startedAt: new Date().toISOString(),
  fixturePreparation: [],
  records: {},
  steps: [],
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
function prep(text) {
  results.fixturePreparation.push({ at: new Date().toISOString(), text });
  save();
}
async function step(article, role, action, expected, fn) {
  const entry = {
    article,
    role,
    method: "browser-walkthrough",
    step: action,
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
    const msg = error instanceof Error ? error.message.split("\n").slice(0, 6).join(" ") : String(error);
    entry.actual = `Check did not complete: ${msg}`;
    entry.result = "fail";
  }
  entry.at = new Date().toISOString();
  console.log(`[${role}] ${entry.result.toUpperCase()} ${article}: ${action}`);
  if (entry.result === "fail") console.log(`    ${entry.actual}`);
  save();
  return entry;
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}

// ---------- shared helpers ----------
const CA = "comments-and-activity";
const NT = "notifications";

function psql(sql) {
  return execFileSync(
    "docker",
    ["exec", PG, "sh", "-c", `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$SQL"`],
    { env: { ...process.env }, encoding: "utf8", input: "" },
  );
}
function psqlWith(sql) {
  return execFileSync(
    "docker",
    ["exec", "-e", `SQL=${sql}`, PG, "sh", "-c", 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$SQL"'],
    { encoding: "utf8" },
  ).trim();
}

async function mailSearch(query) {
  const r = await fetch(`${L.MAIL}/api/v1/search?query=${encodeURIComponent(query)}&limit=500`).then((x) => x.json());
  return r.messages ?? [];
}
/** Total messages matching a query, not capped by the page size. */
async function mailTotal(query) {
  const r = await fetch(`${L.MAIL}/api/v1/search?query=${encodeURIComponent(query)}&limit=1`).then((x) => x.json());
  return r.messages_count ?? 0;
}
/** Count messages to one address whose subject contains a marker. */
async function mailCount(email, subjectPart) {
  const msgs = await mailSearch(`to:"${email}" subject:"${subjectPart}"`);
  return msgs.filter((m) => m.Subject.includes(subjectPart)).length;
}
async function waitMail(email, subjectPart, before, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const msgs = (await mailSearch(`to:"${email}" subject:"${subjectPart}"`)).filter((m) =>
      m.Subject.includes(subjectPart),
    );
    if (msgs.length > before) return msgs[0].Subject;
    await sleep(750);
  }
  throw new Error(`no new mail to ${email} with subject containing ${q(subjectPart)}`);
}
/** Waits until the pg-boss email queue has no pending jobs, then a fixed quiet window. */
async function settleQueue(quietMs = 4000) {
  for (let i = 0; i < 60; i++) {
    const pending = Number(
      psqlWith(
        "select count(*) from pgboss.job where state in ('created','retry','active') and name not like '%sweep%' and name <> 'notification.morning-round'",
      ),
    );
    if (pending === 0) break;
    await sleep(1000);
  }
  await sleep(quietMs);
}

const applet = (page) => page.getByRole("complementary", { name: "Comments" });
async function openApplet(page, name) {
  const button = page.getByRole("toolbar", { name: "Applets" }).getByRole("button", { name: new RegExp(`^${name}`) });
  await button.waitFor({ timeout: 20000 });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  return button;
}
async function openComments(page) {
  await openApplet(page, "Comments");
  const a = applet(page);
  await a.waitFor({ timeout: 20000 });
  await a.getByRole("textbox", { name: "New comment" }).or(a.getByRole("alert")).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  return a;
}
const rowWith = (a, text) => a.getByRole("listitem").filter({ hasText: text });
async function chooseTier(a, label) {
  const radio = a.getByRole("radio", { name: label });
  if (await radio.isChecked()) return;
  await a.getByRole("group", { name: "Audience" }).locator("label").filter({ hasText: label }).first().click();
  if (!(await radio.isChecked())) await radio.check({ force: true });
}
async function audienceText(a) {
  return (await a.locator("p").filter({ hasText: /^Visible to/ }).first().textContent()).trim();
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
async function snapshot(locator) {
  return (await locator.ariaSnapshot()).split("\n").filter((l) => !/option "/.test(l)).join("\n");
}

// ---------- fixtures ----------
async function setupFixtures() {
  const d = ctx.daniel.page;
  const j = ctx.jonas.page;
  const types = (await L.api(d, "GET", "/request-types")).body.requestTypes;
  const deps = (await L.api(d, "GET", "/departments/options")).body.departments;
  const ct = (await L.api(d, "GET", "/contract-types")).body;
  const mt = (await L.api(d, "GET", "/matter-types")).body;
  const question = types.find((t) => t.slug === "legal_question");
  const submit = async (title) => {
    const r = await L.api(j, "POST", "/requests", {
      requestTypeId: question.id,
      departmentId: deps[0].id,
      title,
      description: "DOC-029r2 conversations fixture. Fictional request for the comments walkthrough.",
      urgency: "medium",
      customFields: {},
    });
    expect(r.status < 300, `submit ${r.status}`);
    return r.body.request;
  };
  const rc = await submit(`DOC-029r2 conversations Contract ${stamp}`);
  const rm = await submit(`DOC-029r2 conversations Matter ${stamp}`);
  const ru = await submit(`DOC-029r2 conversations open Request ${stamp}`);
  const ra = await submit(`DOC-029r2 conversations archive Contract ${stamp}`);
  const contractType = (ct.contractTypes ?? ct.types).find((t) => t.slug === "msa") ?? (ct.contractTypes ?? ct.types)[0];
  const matterType = (mt.matterTypes ?? mt.types).find((t) => t.slug === "advisory") ?? (mt.matterTypes ?? mt.types)[0];
  const convert = async (req, payload) => {
    const r = await L.api(d, "POST", `/requests/${req.number}/convert`, { title: req.title, ...payload });
    expect(r.status < 300, `convert ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
    return r.body.request.convertedRecord;
  };
  const contract = await convert(rc, { contractTypeId: contractType.id });
  const matter = await convert(rm, { matterTypeId: matterType.id });
  const archive = await convert(ra, { contractTypeId: contractType.id });
  const people = (await L.api(d, "GET", "/users?limit=100")).body;
  fx = {
    createdAt: new Date().toISOString(),
    stamp,
    contractRequest: rc.number,
    matterRequest: rm.number,
    openRequest: ru.number,
    archiveRequest: ra.number,
    contract,
    matter,
    archive,
    contractTitle: rc.title,
    matterTitle: rm.title,
    openTitle: ru.title,
    archiveTitle: ra.title,
  };
  const c = (await L.api(d, "GET", `/contracts/${contract.number}`)).body;
  const m = (await L.api(d, "GET", `/matters/${matter.number}`)).body;
  const ar = (await L.api(d, "GET", `/contracts/${archive.number}`)).body;
  const oreq = (await L.api(d, "GET", `/requests/${ru.number}`)).body;
  fx.contractId = (c.contract ?? c).id;
  fx.matterId = (m.matter ?? m).id;
  fx.archiveId = (ar.contract ?? ar).id;
  fx.openRequestId = (oreq.request ?? oreq).id;
  const users = people.users ?? people;
  const idOf = (email) => users.find((u) => u.email === email)?.id;
  fx.ids = {
    daniel: idOf(L.PEOPLE.daniel.email),
    nadia: idOf(L.PEOPLE.nadia.email),
    jonas: idOf(L.PEOPLE.jonas.email),
    amara: idOf(L.PEOPLE.amara.email),
  };
  // Nadia joins the Contract and Matter teams so she is in their activity audience.
  for (const [kind, n] of [["contracts", contract.number], ["matters", matter.number]]) {
    const r = await L.api(d, "POST", `/${kind}/${n}/team`, { userId: fx.ids.nadia });
    expect(r.status < 300, `team add ${kind} ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  }
  writeFileSync(path.join(here, "fixtures-r2.json"), JSON.stringify(fx, null, 2) + "\n");
  results.records = fx;
  prep(
    `Jonas Weber submitted four Legal question Requests through the Portal API (R-${rc.number}, R-${rm.number}, R-${ru.number}, R-${ra.number}). Daniel Okafor converted R-${rc.number} to Contract C-${contract.number}, R-${rm.number} to Matter M-${matter.number}, and R-${ra.number} to Contract C-${archive.number} through the convert API; R-${ru.number} stays unconverted. Daniel added Nadia Haddad to the C-${contract.number} and M-${matter.number} teams through the team API. The Request submission and conversion procedures belong to other guides.`,
  );
}


// ---------- notification helpers ----------
const bell = (page) => page.getByRole("banner").getByRole("button", { name: /^Notifications,/ });
async function bellName(page) {
  return (await bell(page).getAttribute("aria-label")) ?? (await bell(page).innerText());
}
async function unreadApi(page, portal = false) {
  return (await L.api(page, "GET", portal ? "/portal/notifications/unread-count" : "/notifications/unread-count")).body.unread;
}
async function openBell(page) {
  await bell(page).click();
  const dialog = page.getByRole("dialog", { name: "Notifications" });
  await dialog.waitFor();
  await dialog.getByRole("list").or(dialog.getByRole("alert")).or(dialog.getByText(/^Nothing to catch up on/)).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  return dialog;
}
async function closeBell(page) {
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Notifications" }).waitFor({ state: "hidden" });
}
async function findItem(page, dialog, re, maxPages = 4) {
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
    const r = await L.api(page, "GET", `${portal ? "/portal/notifications" : "/notifications"}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
    const items = r.body.items ?? r.body.notifications ?? [];
    let older = false;
    for (const it of items) {
      if (since && it.createdAt < since) { older = true; continue; }
      if (re.test(JSON.stringify(it))) found.push(it);
    }
    cursor = r.body.nextCursor;
    if (!cursor || older || (!since && i >= 5)) break;
  }
  return found;
}
/** Notifications a person received about one posted comment. */
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
  }
  return now;
}
async function switchStates(page, names) {
  const out = {};
  for (const n of names) out[n] = (await page.getByRole("switch", { name: n, exact: true }).getAttribute("aria-checked")) === "true";
  return out;
}
async function openStaffNotificationSettings(page, displayName) {
  await page.goto(`${L.BASE}/`);
  await page.getByRole("banner").getByRole("button", { name: displayName }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("group", { name: "Personal" }).getByRole("link", { name: "Notifications" }).click();
  await page.getByRole("heading", { name: "Notification preferences" }).waitFor();
}
async function comment(page, entityType, entityId, body, visibility, mentions = []) {
  const r = await L.api(page, "POST", "/comments", { entityType, entityId, body, visibility, mentions });
  expect(r.status < 300, `comment ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  const id = r.body.comment?.id ?? r.body.id;
  expect(id, `no comment id in ${JSON.stringify(r.body).slice(0, 200)}`);
  return id;
}
const STAFF_SWITCHES = [
  "Assigned to you In-app", "Assigned to you Email",
  "Activity on your records In-app", "Activity on your records Email",
  "Dates approaching In-app", "New requests In-app", "New requests Email", "Knowledge items Email",
  "Approvals Email", "Tasks Email", "Dates Email", "Obligations Email", "Intake Email",
];

// ---------- V-C08 as the Legal Team Member ----------
async function memberNotifications() {
  const p = ctx.nadia.page;
  const d = ctx.daniel.page;
  const role = "legal_team_member";
  const tag = `DOC-029r2 conversations ${stamp}`;
  const title = fx.contractTitle;

  await step(NT, role, "Open a notification: badge with 9+, unread dots, opening the panel marks nothing read, selecting an item opens its record and marks it read", "Badge shows 9+ over nine; items marked Unread; count unchanged by opening; the selected item opens the Contract and becomes read", async () => {
    const startUnread = await unreadApi(p);
    if (startUnread < 10) {
      for (let k = 0; k < 10 - startUnread; k++) await comment(d, "contract", fx.contractId, `${tag} Daniel badge filler ${k + 1}`, "full_thread");
      prep(`Nadia Haddad had ${startUnread} unread notifications, so Daniel Okafor posted ${10 - startUnread} Contract Team comments on C-${fx.contract.number} through the comments API to take her above nine for the 9+ badge check.`);
    }
    await comment(d, "contract", fx.contractId, `${tag} Daniel bell check for Nadia`, "full_thread", [fx.ids.nadia]);
    await settleQueue(1500);
    prep(`Notification events were arranged by posting comments through the comments API as the acting role (Daniel Okafor, Nadia Haddad) on C-${fx.contract.number}, M-${fx.matter.number}, and R-${fx.openRequest}; the notification steps under test were then followed in the browser.`);
    await p.goto(`${L.BASE}/`);
    await bell(p).waitFor();
    await p.waitForTimeout(1500);
    const name = await bellName(p);
    const badge = (await bell(p).innerText()).trim();
    const before = await unreadApi(p);
    const dialog = await openBell(p);
    const unreadMarks = await dialog.getByText("Unread", { exact: true }).count();
    const item = dialog.getByRole("link", { name: new RegExp(`Daniel Okafor mentioned you on .*${stamp}`) }).first();
    await item.waitFor({ timeout: 10000 });
    const itemName = (await item.getAttribute("aria-label")) ?? (await item.innerText());
    const href = await item.getAttribute("href");
    await closeBell(p);
    await p.waitForTimeout(1000);
    const afterOpen = await unreadApi(p);
    const d2 = await openBell(p);
    await d2.getByRole("link", { name: new RegExp(`Daniel Okafor mentioned you on .*${stamp}`) }).first().click();
    await p.waitForURL(new RegExp(`/contracts/${fx.contract.number}`));
    await p.waitForTimeout(1500);
    const [it] = (await itemsMatching(p, new RegExp(fx.contractId), false, new Date(Date.now() - 120000).toISOString())).filter((x) => /mention/.test(x.eventType));
    const d3 = await openBell(p);
    const again = d3.getByRole("link", { name: new RegExp(`mentioned you on .*${stamp}`) }).first();
    const againName = (await again.getAttribute("aria-label")) ?? (await again.innerText());
    await closeBell(p);
    expect(before > 9 && badge === "9+" && afterOpen >= before && !/^Unread/.test(againName.trim()), JSON.stringify({ before, badge, afterOpen, againName }));
    return `Header button read ${q(name)} with badge ${q(badge)}. The panel showed ${unreadMarks} Unread markers; the newest mention item read ${q(itemName.replace(/\s+/g, " "))} linking ${href}. Closing left unread at ${afterOpen} (was ${before}; other lab activity can only raise it). Selecting the item opened ${new URL(p.url()).pathname}, and on reopening the item read ${q(againName.replace(/\s+/g, " "))} without the Unread marker (API readAt ${it?.readAt ? "set" : "unknown"}).`;
  });

  await step(NT, role, "Show older loads earlier items; Mark all read clears unread and then disappears", "More than 25 items after Show older; unread 0 after Mark all read; the control is absent with nothing unread", async () => {
    const dialog = await openBell(p);
    const n1 = await dialog.getByRole("listitem").count();
    await dialog.getByRole("button", { name: "Show older" }).click();
    await p.waitForTimeout(2000);
    const n2 = await dialog.getByRole("listitem").count();
    const markAll = dialog.getByRole("button", { name: "Mark all read" });
    const had = await markAll.count();
    await markAll.click();
    await p.waitForTimeout(1500);
    const unread = await unreadApi(p);
    const still = await dialog.getByRole("button", { name: "Mark all read" }).count();
    const marks = await dialog.getByText("Unread", { exact: true }).count();
    await closeBell(p);
    const name = await bellName(p);
    expect(n2 > n1 && had === 1 && (unread === 0 ? still === 0 : true), JSON.stringify({ n1, n2, had, unread, still }));
    return `The panel listed ${n1} items; Show older brought ${n2}. Mark all read was present (${had}); after selecting it unread read ${unread}, ${marks} Unread markers remained, and Mark all read was ${still ? "still shown because new lab events arrived" : "gone"}. The header then read ${q(name)}.`;
  });

  await step(NT, role, "Change preferences: profile menu, Settings, Personal, Notifications; groups and initial choices match the table; Briefing switches", "Five groups with the documented switches and initial choices; Briefing Approvals, Tasks, Dates, Obligations on and Intake off", async () => {
    await openStaffNotificationSettings(p, "Nadia Haddad");
    const states = await switchStates(p, STAFF_SWITCHES);
    const inAppDates = await p.getByRole("switch", { name: "Dates approaching Email", exact: true }).count();
    const knowledgeInApp = await p.getByRole("switch", { name: "Knowledge items In-app", exact: true }).count();
    const expected = { "Assigned to you In-app": true, "Assigned to you Email": true, "Activity on your records In-app": true, "Activity on your records Email": false, "Dates approaching In-app": true, "New requests In-app": true, "New requests Email": false, "Knowledge items Email": true, "Approvals Email": true, "Tasks Email": true, "Dates Email": true, "Obligations Email": true, "Intake Email": false };
    const diff = Object.keys(expected).filter((k) => expected[k] !== states[k]);
    expect(diff.length === 0 && inAppDates === 0 && knowledgeInApp === 0, `diff ${diff} datesEmail ${inAppDates} knowledgeInApp ${knowledgeInApp}`);
    return `Profile menu > Settings > Personal > Notifications reached ${new URL(p.url()).pathname}. Switch states ${q(states)} match the guide's initial choices; Dates approaching has no Email switch and Knowledge items has no In-app switch.`;
  });

  await step(NT, role, "Assigned to you: Email off keeps the bell item and sends no mail; Email on sends mail; In-app off stops both; each choice survives a reload; a mention gives one item, not a second comment item", "Mention item with no mail; then mail; then neither; reload keeps each choice; no separate commented-on item for the mention", async () => {
    const email = L.PEOPLE.nadia.email;
    const subject = `You were mentioned on ${title}`;
    const out = [];
    const mentionRound = async (label) => {
      const since = new Date(Date.now() - 2000).toISOString();
      const beforeMail = await mailCount(email, subject);
      const id = await comment(d, "contract", fx.contractId, `${tag} Daniel mention round ${label}`, "full_thread", [fx.ids.nadia]);
      await settleQueue();
      const afterMail = await mailCount(email, subject);
      const items = await aboutComment(p, id, since);
      return { bell: items.filter((x) => /mention/.test(x.eventType)).length, mail: afterMail - beforeMail, commentItems: items.filter((x) => x.eventType === "comment.posted").length, eventTypes: items.map((x) => x.eventType) };
    };
    await openStaffNotificationSettings(p, "Nadia Haddad");
    const origEmail = await setSwitch(p, "Assigned to you Email", false);
    await p.reload();
    const keptOff = await p.getByRole("switch", { name: "Assigned to you Email", exact: true }).getAttribute("aria-checked");
    const r1 = await mentionRound("email-off");
    await setSwitch(p, "Assigned to you Email", true);
    const r2 = await mentionRound("email-on");
    await setSwitch(p, "Assigned to you In-app", false);
    await p.reload();
    const keptInApp = await p.getByRole("switch", { name: "Assigned to you In-app", exact: true }).getAttribute("aria-checked");
    const r3 = await mentionRound("inapp-off");
    await setSwitch(p, "Assigned to you In-app", true);
    await setSwitch(p, "Assigned to you Email", origEmail);
    // The UI item text for the bell check.
    await p.reload();
    const dialog = await openBell(p);
    const itemText = await dialog.getByRole("link", { name: /mentioned you on/ }).first().getAttribute("aria-label").catch(() => null);
    await closeBell(p);
    expect(keptOff === "false" && r1.bell === 1 && r1.mail === 0 && r1.commentItems === 0 && r2.bell === 1 && r2.mail === 1 && keptInApp === "false" && r3.bell === 0 && r3.mail === 0, JSON.stringify({ keptOff, r1, r2, keptInApp, r3 }));
    return `Email off (still off after reload): a mention gave ${r1.bell} bell item, ${r1.commentItems} extra comment items, and ${r1.mail} "${subject}" mail after the queue settled. Email on: ${r2.bell} item and ${r2.mail} mail. In-app off (still off after reload): ${r3.bell} items and ${r3.mail} mail. Choices restored to In-app on and Email ${origEmail ? "on" : "off"}.`;
  });

  await step(NT, role, "A failed preference save shows the error and the switch returns to its earlier value", "The change could not be saved. Try again.; switch back to its earlier value, also after reload", async () => {
    await openStaffNotificationSettings(p, "Nadia Haddad");
    const sw = p.getByRole("switch", { name: "New requests Email", exact: true });
    const before = await sw.getAttribute("aria-checked");
    const handler = (route) => (route.request().method() === "PATCH" ? route.abort("failed") : route.continue());
    await p.route(/\/api\/v1\/me\/notification-preferences/, handler);
    await sw.click();
    await p.getByText("The change could not be saved. Try again.").waitFor({ timeout: 10000 });
    const after = await sw.getAttribute("aria-checked");
    await p.unroute(/\/api\/v1\/me\/notification-preferences/, handler);
    await p.reload();
    const reloaded = await p.getByRole("switch", { name: "New requests Email", exact: true }).getAttribute("aria-checked");
    expect(before === after && before === reloaded, `${before} ${after} ${reloaded}`);
    return `With the PATCH aborted, selecting New requests Email showed "The change could not be saved. Try again." and the switch returned to aria-checked=${after} (was ${before}); after reload it read ${reloaded}.`;
  });

  await step(NT, role, "New requests: a new Request reaches the Legal user's bell and opens the Inbox Request", "New request item links /inbox/N and opens it", async () => {
    const r = await L.api(ctx.jonas.page, "POST", "/requests", { requestTypeId: (await L.api(d, "GET", "/request-types")).body.requestTypes.find((t) => t.slug === "legal_question").id, departmentId: (await L.api(d, "GET", "/departments/options")).body.departments[0].id, title: `DOC-029r2 conversations new request bell ${stamp}`, description: "DOC-029r2 conversations fictional bell check.", urgency: "low", customFields: {} });
    expect(r.status < 300, `submit ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    fx.bellRequest = r.body.request.number;
    prep(`Jonas Weber submitted R-${fx.bellRequest} through the Requests API from his Portal session for the New requests and Request receipt checks.`);
    await p.goto(`${L.BASE}/`);
    const dialog = await openBell(p);
    const link = await findItem(p, dialog, new RegExp(`new request: DOC-029r2 conversations new request bell ${stamp}`));
    expect(link, "no new request item");
    const label = await link.getAttribute("aria-label") ?? (await link.innerText());
    await link.click();
    await p.waitForURL(new RegExp(`/inbox/${fx.bellRequest}`));
    return `The bell item ${q(label.replace(/\s+/g, " "))} opened ${new URL(p.url()).pathname}.`;
  });
}

// ---------- V-C08 as the Administrator ----------
async function adminNotifications() {
  const p = ctx.daniel.page;
  const n = ctx.nadia.page;
  const role = "administrator";
  const tag = `DOC-029r2 conversations ${stamp}`;
  const title = fx.contractTitle;

  await step(NT, role, "Activity on your records as the Owner: Email off gives a bell item and no mail; Email on sends New comment mail; own comment gives no item; the item opens the Contract", "commented on item without mail; with Email on the mail arrives; his own comment produces no item", async () => {
    const email = L.PEOPLE.daniel.email;
    const subject = `New comment on ${title}`;
    await openStaffNotificationSettings(p, "Daniel Okafor");
    const init = await switchStates(p, ["Activity on your records In-app", "Activity on your records Email"]);
    const round = async (label, actor = n) => {
      const since = new Date(Date.now() - 2000).toISOString();
      const bm = await mailCount(email, subject);
      const id = await comment(actor, "contract", fx.contractId, `${tag} activity round ${label}`, "full_thread");
      await settleQueue();
      const am = await mailCount(email, subject);
      return { bell: (await aboutComment(p, id, since)).length, mail: am - bm };
    };
    await setSwitch(p, "Activity on your records Email", false);
    const r1 = await round("email-off");
    await setSwitch(p, "Activity on your records Email", true);
    const r2 = await round("email-on");
    await setSwitch(p, "Activity on your records Email", init["Activity on your records Email"]);
    const own = await round("own", p);
    await p.goto(`${L.BASE}/`);
    const dialog = await openBell(p);
    const link = await findItem(p, dialog, new RegExp(`Nadia Haddad commented on .*${stamp}`));
    expect(link, "no commented on item");
    const label = (await link.getAttribute("aria-label")) ?? (await link.innerText());
    await link.click();
    await p.waitForURL(new RegExp(`/contracts/${fx.contract.number}`));
    expect(r1.bell === 1 && r1.mail === 0 && r2.bell === 1 && r2.mail === 1 && own.bell === 0 && own.mail === 0, JSON.stringify({ r1, r2, own }));
    return `Initial Activity on your records ${q(init)}. Email off: Nadia's comment gave ${r1.bell} bell item and ${r1.mail} "${subject}" mail. Email on: ${r2.bell} item and ${r2.mail} mail. Restored. His own comment gave ${own.bell} items and ${own.mail} mail. The item ${q(label.replace(/\s+/g, " "))} opened ${new URL(p.url()).pathname}.`;
  });

  await step(NT, role, "If an update is missing: a failed bell read and a failed older page show their messages and recover", "Notifications could not be read. Close this and open it again.; reopening lists items; The older notifications could not be read. Try again.; retry loads more", async () => {
    await p.goto(`${L.BASE}/`);
    await bell(p).waitFor();
    let block = true;
    const handler = (route) => (block && route.request().method() === "GET" && !/unread-count/.test(route.request().url()) ? route.abort("failed") : route.continue());
    await p.route(/\/api\/v1\/notifications(\?.*)?$/, handler);
    await bell(p).click();
    const dialog = p.getByRole("dialog", { name: "Notifications" });
    const err = dialog.getByText("Notifications could not be read. Close this and open it again.");
    await err.waitFor({ timeout: 10000 });
    block = false;
    await closeBell(p);
    const d2 = await openBell(p);
    const rows = await d2.getByRole("listitem").count();
    block = false;
    await p.unroute(/\/api\/v1\/notifications(\?.*)?$/, handler);
    let blockOlder = true;
    const older = (route) => (blockOlder && /cursor=/.test(route.request().url()) ? route.abort("failed") : route.continue());
    await p.route(/\/api\/v1\/notifications\?/, older);
    await d2.getByRole("button", { name: "Show older" }).click();
    const oerr = d2.getByText("The older notifications could not be read. Try again.");
    await oerr.waitFor({ timeout: 10000 });
    const kept = await d2.getByRole("listitem").count();
    blockOlder = false;
    await d2.getByRole("button", { name: "Show older" }).click();
    await p.waitForTimeout(2000);
    const more = await d2.getByRole("listitem").count();
    await p.unroute(/\/api\/v1\/notifications\?/, older);
    await closeBell(p);
    expect(rows > 0 && kept === rows && more > kept, JSON.stringify({ rows, kept, more }));
    return `A blocked read showed "Notifications could not be read. Close this and open it again."; reopening listed ${rows} items. A blocked older page showed "The older notifications could not be read. Try again." with ${kept} rows kept; the retry brought ${more}.`;
  });

  await step(NT, role, "Settings page for an Administrator matches the guide's groups and Briefing sections", "Same five groups and five Briefing switches", async () => {
    await openStaffNotificationSettings(p, "Daniel Okafor");
    const states = await switchStates(p, STAFF_SWITCHES);
    const heading = await p.getByRole("heading", { name: "Briefing" }).count();
    const caption = (await p.getByText(/^These switches change the email only/).textContent()).trim();
    return `Daniel's pane showed Notification preferences and ${heading} Briefing heading with switches ${q(states)}; caption ${q(caption)}.`;
  });
}

// ---------- V-C08 as the Business User ----------
async function portalNotifications() {
  const p = ctx.jonas.page;
  const n = ctx.nadia.page;
  const d = ctx.daniel.page;
  const role = "business_user";
  const tag = `DOC-029r2 conversations ${stamp}`;
  const email = L.PEOPLE.jonas.email;

  await step(NT, role, "Portal bell: a Request receipt opens the Request; a converted Request's record item opens the Contract", "Receipt item links /portal/requests/N; a C-N comment item opens /portal/contracts/N", async () => {
    await comment(n, "contract", fx.contractId, `${tag} Nadia team update for Jonas`, "full_thread");
    await p.goto(`${L.BASE}/portal`);
    const dialog = await openBell(p);
    const receipt = await findItem(p, dialog, new RegExp(`received your request DOC-029r2 conversations new request bell ${stamp}`));
    expect(receipt, "no receipt item");
    const rl = (await receipt.getAttribute("aria-label")) ?? (await receipt.innerText());
    const rhref = await receipt.getAttribute("href");
    await closeBell(p);
    const d2 = await openBell(p);
    const rec = await findItem(p, d2, new RegExp(`Nadia Haddad .* ${fx.contractTitle}`));
    expect(rec, "no record item");
    const label = (await rec.getAttribute("aria-label")) ?? (await rec.innerText());
    const href = await rec.getAttribute("href");
    await rec.click();
    await p.waitForURL(new RegExp(`/portal/contracts/${fx.contract.number}`));
    const landed = new URL(p.url()).pathname;
    await p.goto(`${L.BASE}/portal`);
    const d3 = await openBell(p);
    const team = await findItem(p, d3, new RegExp(`added you to the Contract team for ${fx.contractTitle}`));
    let teamText = "no team-addition item found";
    if (team) {
      teamText = `${((await team.getAttribute("aria-label")) ?? (await team.innerText())).replace(/\s+/g, " ")} -> ${await team.getAttribute("href")}`;
      await closeBell(p);
    } else await closeBell(p);
    expect(rhref === `/portal/requests/${fx.bellRequest}`, `receipt href ${rhref}`);
    return `Portal header read ${q(await bellName(p))}. Receipt item ${q(rl.replace(/\s+/g, " "))} links ${rhref}. The item for Nadia's comment on the converted Contract read ${q(label.replace(/\s+/g, " "))}, linked ${href}, and opened ${landed}. Team addition item: ${q(teamText)}.`;
  });

  await step(NT, role, "Change Portal preferences: Notification settings offers Request updates, Assigned to you, Activity on your records with the documented initial choices and no Briefing", "Three groups, In-app and Email each, Activity email off initially, no Briefing", async () => {
    await p.getByRole("banner").getByRole("link", { name: "Notification settings" }).click();
    await p.getByRole("heading", { name: "Notification settings", level: 1 }).waitFor();
    const names = await p.getByRole("switch").evaluateAll((els) => els.map((e) => `${e.getAttribute("aria-label") ?? ""}=${e.getAttribute("aria-checked")}`));
    const briefing = await p.getByText("Briefing").count();
    const expected = ["Request updates In-app=true", "Request updates Email=true", "Assigned to you In-app=true", "Assigned to you Email=true", "Activity on your records In-app=true", "Activity on your records Email=false"];
    const labels = await p.getByRole("switch").evaluateAll((els) => els.map((e) => e.getAttribute("aria-labelledby") || e.id));
    const accessible = [];
    for (const sw of await p.getByRole("switch").all()) accessible.push(`${(await sw.evaluate((e) => e.getAttribute("aria-label"))) ?? ""}`);
    const states = await switchStates(p, expected.map((e) => e.split("=")[0]));
    const diff = expected.filter((e) => String(states[e.split("=")[0]]) !== e.split("=")[1]);
    expect(diff.length === 0 && briefing === 0 && (await p.getByRole("switch").count()) === 6, `diff ${diff} briefing ${briefing}`);
    return `/portal/settings showed 6 switches with states ${q(states)} and ${briefing} Briefing text.`;
  });

  await step(NT, role, "Portal Request updates: Email off keeps the bell item with no mail; Email on sends mail; In-app off stops both; choices survive reload", "Legal replied item without mail; with mail; neither", async () => {
    const subject = `Legal replied on`;
    const marker = fx.openTitle;
    const round = async (label) => {
      const since = new Date(Date.now() - 2000).toISOString();
      const bm = (await mailSearch(`to:"${email}" subject:"${subject}"`)).filter((m) => m.Subject.includes(marker)).length;
      const id = await comment(n, "request", fx.openRequestId, `${tag} Nadia reply round ${label}`, "full_thread");
      await settleQueue();
      const am = (await mailSearch(`to:"${email}" subject:"${subject}"`)).filter((m) => m.Subject.includes(marker)).length;
      const items = await aboutComment(p, id, since, true);
      return { bell: items.length, mail: am - bm, eventTypes: items.map((x) => x.eventType) };
    };
    await p.goto(`${L.BASE}/portal/settings`);
    await setSwitch(p, "Request updates Email", false);
    await p.reload();
    const kept = await p.getByRole("switch", { name: "Request updates Email", exact: true }).getAttribute("aria-checked");
    const r1 = await round("email-off");
    await setSwitch(p, "Request updates Email", true);
    const r2 = await round("email-on");
    await setSwitch(p, "Request updates In-app", false);
    await p.reload();
    const kept2 = await p.getByRole("switch", { name: "Request updates In-app", exact: true }).getAttribute("aria-checked");
    const r3 = await round("inapp-off");
    await setSwitch(p, "Request updates In-app", true);
    expect(kept === "false" && kept2 === "false" && r1.bell === 1 && r1.mail === 0 && r2.bell === 1 && r2.mail === 1 && r3.bell === 0 && r3.mail === 0, JSON.stringify({ kept, kept2, r1, r2, r3 }));
    return `Email off (kept after reload): Nadia's Shared with requester reply on R-${fx.openRequest} gave ${r1.bell} bell item and ${r1.mail} "Legal replied on" mail. Email on: ${r2.bell} item and ${r2.mail} mail. In-app off (kept after reload): ${r3.bell} items and ${r3.mail} mail. Restored to both on.`;
  });

  await step(NT, role, "Portal Assigned to you: a team mention on his converted Contract gives one mention item and You were mentioned mail; a Legal Only comment gives nothing", "mentioned you item with mail; nothing for Legal Only", async () => {
    const title = fx.contractTitle;
    const since = new Date(Date.now() - 2000).toISOString();
    const bm = await mailCount(email, `You were mentioned on ${title}`);
    const mid = await comment(n, "contract", fx.contractId, `${tag} Nadia mentions Jonas`, "full_thread", [fx.ids.jonas]);
    const lid = await comment(n, "contract", fx.contractId, `${tag} Nadia legal only no portal item`, "legal_only");
    await settleQueue();
    const am = await mailCount(email, `You were mentioned on ${title}`);
    const mItems = await aboutComment(p, mid, since, true);
    const lItems = await aboutComment(p, lid, since, true);
    expect(am - bm === 1 && mItems.length === 1 && /mention/.test(mItems[0].eventType) && lItems.length === 0, JSON.stringify({ mention: [mItems.map((x) => x.eventType), am - bm], legal: lItems.length }));
    return `A Contract Team mention of Jonas on C-${fx.contract.number} gave exactly one Portal item (${mItems.map((x) => x.eventType)}) and ${am - bm} "You were mentioned on" mail. A Legal Only comment on the same Contract gave ${lItems.length} Portal items.`;
  });

  await step(NT, role, "Converted record, the Requester: a shared comment on the Contract converted from his Request reaches him as a reply under Request updates, with the bell item saying replied on your request and the email subject starting Legal replied on, although Activity on your records Email is off", "request.replied item (no comment.posted), bell text replied on your request, one Legal replied on mail; the Activity on your records Email switch is off", async () => {
    const title = fx.contractTitle;
    await p.goto(`${L.BASE}/portal`);
    await p.getByRole("banner").getByRole("link", { name: "Notification settings" }).click();
    await p.getByRole("heading", { name: "Notification settings", level: 1 }).waitFor();
    const prefs = await switchStates(p, ["Request updates In-app", "Request updates Email", "Activity on your records In-app", "Activity on your records Email"]);
    const since = new Date(Date.now() - 2000).toISOString();
    const bm = (await mailSearch(`to:"${email}"`)).filter((m) => m.Subject.startsWith("Legal replied on") && m.Subject.includes(title)).length;
    const bAll = await mailTotal(`to:"${email}"`);
    const cid = await comment(n, "contract", fx.contractId, `${tag} Nadia shared comment for the Requester`, "full_thread");
    await settleQueue();
    const items = await aboutComment(p, cid, since, true);
    const replied = (await mailSearch(`to:"${email}"`)).filter((m) => m.Subject.startsWith("Legal replied on") && m.Subject.includes(title));
    await p.goto(`${L.BASE}/portal`);
    const dialog = await openBell(p);
    const link = dialog.getByRole("link", { name: new RegExp(`Nadia Haddad replied on your request ${title}`) }).first();
    await link.waitFor({ timeout: 10000 });
    const label = ((await link.getAttribute("aria-label")) ?? (await link.innerText())).replace(/\s+/g, " ").trim();
    const href = await link.getAttribute("href");
    await p.screenshot({ path: path.join(here, "r2-portal-bell-converted-contract-reply.png") });
    results.screenshots = [...(results.screenshots ?? []), "r2-portal-bell-converted-contract-reply.png"];
    await link.click();
    await p.waitForURL(new RegExp(`/portal/contracts/${fx.contract.number}`), { timeout: 15000 });
    const landed = new URL(p.url()).pathname;
    expect(
      prefs["Request updates Email"] && !prefs["Activity on your records Email"] &&
        items.length === 1 && items[0].eventType === "request.replied" &&
        replied.length - bm === 1,
      JSON.stringify({ prefs, types: items.map((x) => x.eventType), mailDelta: replied.length - bm }),
    );
    return `Jonas's Portal Notification settings read ${q(prefs)}. Nadia's Contract Team comment on C-${fx.contract.number} (converted from his R-${fx.contractRequest}) gave him ${q(items.map((x) => `${x.eventType} -> ${x.entityType}`))} and ${replied.length - bm} new mail with subject ${q(replied[0]?.Subject)} (${(await mailTotal(`to:"${email}"`)) - bAll} mails in all to him). The bell item read ${q(label)}, linked ${href}, and opened ${landed}.`;
  });

  await step(NT, role, "Converted record, the Requester: turn off Email for Request updates in Notification settings; the next shared comment keeps the bell item and sends no Legal replied on mail", "Saved; after reload off; one request.replied item; zero Legal replied on mail; switch restored", async () => {
    const title = fx.contractTitle;
    await p.goto(`${L.BASE}/portal`);
    await p.getByRole("banner").getByRole("link", { name: "Notification settings" }).click();
    await p.getByRole("heading", { name: "Notification settings", level: 1 }).waitFor();
    await setSwitch(p, "Request updates Email", false);
    await p.reload();
    const kept = await p.getByRole("switch", { name: "Request updates Email", exact: true }).getAttribute("aria-checked");
    let items, delta, allDelta;
    try {
      const since = new Date(Date.now() - 2000).toISOString();
      const count = async () => (await mailSearch(`to:"${email}"`)).filter((m) => m.Subject.startsWith("Legal replied on") && m.Subject.includes(title)).length;
      const bm = await count();
      const bAll = await mailTotal(`to:"${email}"`);
      const cid = await comment(n, "contract", fx.contractId, `${tag} Nadia shared comment with Request updates Email off`, "full_thread");
      await settleQueue();
      items = await aboutComment(p, cid, since, true);
      delta = (await count()) - bm;
      allDelta = (await mailTotal(`to:"${email}"`)) - bAll;
    } finally {
      await setSwitch(p, "Request updates Email", true);
    }
    expect(kept === "false" && items.length === 1 && items[0].eventType === "request.replied" && delta === 0 && allDelta === 0, JSON.stringify({ kept, types: items?.map((x) => x.eventType), delta, allDelta }));
    return `Request updates Email read ${kept} after reload. Nadia's next Contract Team comment gave Jonas ${q(items.map((x) => x.eventType))}, ${delta} Legal replied on mail, and ${allDelta} mails in all after the queue settled. Request updates Email was turned on again.`;
  });

  await step(NT, role, "Team member who did not raise the Request: Contract team addition under Assigned to you; the same shared comment under Activity on your records; Email off gives no mail, Email on gives mail, In-app off stops both", "contract.team_added item and You were added to mail; comment.posted with no mail; with Email on one mail; with In-app off no item and no mail", async () => {
    const title = fx.contractTitle;
    const aEmail = L.PEOPLE.amara.email;
    const sinceAdd = new Date(Date.now() - 2000).toISOString();
    const addMailBefore = (await mailSearch(`to:"${aEmail}"`)).filter((m) => m.Subject.includes(`You were added to ${title}`)).length;
    const add = await L.api(d, "POST", `/contracts/${fx.contract.number}/team`, { userId: fx.ids.amara });
    expect(add.status < 300, `add amara ${add.status}`);
    fx.amaraOnTeam = true;
    prep(`Daniel Okafor added Amara Nwosu (Business User, not the Requester) to the C-${fx.contract.number} team through the team API for the team-member comparison.`);
    ctx.amara ??= await L.portalContext(L.PEOPLE.amara);
    ctx.amara.context.setDefaultTimeout(15000);
    const a = ctx.amara.page;
    await settleQueue();
    const addItems = (await itemsMatching(a, new RegExp(fx.contractId), true, sinceAdd)).map((x) => x.eventType);
    const addMail = (await mailSearch(`to:"${aEmail}"`)).filter((m) => m.Subject.includes(`You were added to ${title}`)).length - addMailBefore;
    await a.goto(`${L.BASE}/portal`);
    await a.getByRole("banner").getByRole("link", { name: "Notification settings" }).click();
    await a.getByRole("heading", { name: "Notification settings", level: 1 }).waitFor();
    const init = await switchStates(a, ["Activity on your records In-app", "Activity on your records Email"]);
    const round = async (label) => {
      const since = new Date(Date.now() - 2000).toISOString();
      const bAll = await mailTotal(`to:"${aEmail}"`);
      const jBefore = (await mailSearch(`to:"${email}"`)).filter((m) => m.Subject.startsWith("Legal replied on")).length;
      const cid = await comment(n, "contract", fx.contractId, `${tag} Nadia team comment round ${label}`, "full_thread");
      await settleQueue();
      const items = await aboutComment(a, cid, since, true);
      const newCount = (await mailTotal(`to:"${aEmail}"`)) - bAll;
      const mails = newCount > 0 ? (await mailSearch(`to:"${aEmail}"`)).slice(0, newCount).map((m) => m.Subject) : [];
      const jItems = await aboutComment(p, cid, since, true);
      const jReplied = (await mailSearch(`to:"${email}"`)).filter((m) => m.Subject.startsWith("Legal replied on")).length - jBefore;
      return { types: items.map((x) => x.eventType), mails, jonas: { types: jItems.map((x) => x.eventType), repliedMail: jReplied } };
    };
    const r1 = await round("amara-email-off");
    await setSwitch(a, "Activity on your records Email", true);
    let r2, r3, kept;
    try {
      r2 = await round("amara-email-on");
      await setSwitch(a, "Activity on your records In-app", false);
      await a.reload();
      kept = await a.getByRole("switch", { name: "Activity on your records In-app", exact: true }).getAttribute("aria-checked");
      r3 = await round("amara-inapp-off");
    } finally {
      await setSwitch(a, "Activity on your records In-app", true);
      await setSwitch(a, "Activity on your records Email", false);
    }
    const ok =
      addItems.includes("contract.team_added") && addMail === 1 &&
      init["Activity on your records In-app"] && !init["Activity on your records Email"] &&
      r1.types.length === 1 && r1.types[0] === "comment.posted" && r1.mails.length === 0 &&
      r1.jonas.types.length === 1 && r1.jonas.types[0] === "request.replied" && r1.jonas.repliedMail === 1 &&
      r2.types.length === 1 && r2.types[0] === "comment.posted" && r2.mails.length === 1 &&
      kept === "false" && r3.types.length === 0 && r3.mails.length === 0;
    expect(ok, JSON.stringify({ addItems, addMail, init, r1, r2, kept, r3 }));
    return `Adding Amara gave her ${q(addItems)} and ${addMail} "You were added to ${title}" mail. Her Portal Activity on your records started ${q(init)}. Email off: Nadia's comment gave Amara ${q(r1.types)} and mail ${q(r1.mails)}, while Jonas, the Requester, got ${q(r1.jonas.types)} and ${r1.jonas.repliedMail} Legal replied on mail. Email on: ${q(r2.types)} and mail ${q(r2.mails)}. In-app off (kept after reload): ${q(r3.types)} and mail ${q(r3.mails)}. Amara's switches were restored to In-app on, Email off.`;
  });

  await step(NT, role, "Activity on your records also covers supporting Documents and Contract status changes on the records whose team you are on", "Amara gets document.added and contract.status_changed items for C-N", async () => {
    const a = ctx.amara.page;
    const since = new Date(Date.now() - 2000).toISOString();
    const up = await L.api(d, "POST", `/contracts/${fx.contract.number}/documents`, undefined, {
      file: { name: "doc029-conv-portal-note.pdf", mimeType: "application/pdf", buffer: readFileSync(fixture("doc029-conv-portal-note.pdf")) },
    });
    expect(up.status < 300, `upload ${up.status} ${JSON.stringify(up.body).slice(0, 200)}`);
    const up2 = await L.api(d, "POST", `/contracts/${fx.contract.number}/documents`, undefined, {
      file: { name: "doc029-conv-schedule.pdf", mimeType: "application/pdf", buffer: readFileSync(fixture("doc029-conv-schedule.pdf")) },
    });
    expect(up2.status < 300, `upload2 ${up2.status}`);
    const statuses = (await L.api(d, "GET", "/contract-statuses")).body;
    const list = statuses.statuses ?? statuses.contractStatuses ?? statuses;
    const current = (await L.api(d, "GET", `/contracts/${fx.contract.number}`)).body;
    const cur = current.contract ?? current;
    const target = list.find((s) => s.id !== (cur.statusId ?? cur.status?.id) && !s.archivedAt && s.stage !== "executed" && s.stage !== "signature") ?? list.find((s) => s.id !== (cur.statusId ?? cur.status?.id));
    const st = await L.api(d, "PATCH", `/contracts/${fx.contract.number}`, { statusId: target.id });
    expect(st.status < 300, `status ${st.status} ${JSON.stringify(st.body).slice(0, 200)}`);
    prep(`Daniel Okafor uploaded two fictional PDFs (doc029-conv-portal-note.pdf, doc029-conv-schedule.pdf) to C-${fx.contract.number} through the documents API and moved its status to ${q(target.displayName ?? target.label ?? target.name)} through the contract API.`);
    await settleQueue();
    const aTypes = (await itemsMatching(a, new RegExp(fx.contractId), true, since)).map((x) => x.eventType);
    const jTypes = (await itemsMatching(p, new RegExp(`${fx.contractId}|${fx.contractRequest}`), true, since)).map((x) => x.eventType);
    await a.goto(`${L.BASE}/portal`);
    const dialog = await openBell(a);
    const texts = (await dialog.getByRole("link", { name: new RegExp(fx.contractTitle) }).allInnerTexts()).slice(0, 4).map((x) => x.replace(/\s+/g, " ").trim());
    await closeBell(a);
    expect(aTypes.includes("document.added") && aTypes.includes("contract.status_changed"), JSON.stringify({ aTypes, jTypes }));
    return `After two uploads and a status change, Amara's Portal notifications for C-${fx.contract.number} were ${q(aTypes)}; her newest bell items read ${q(texts)}. For comparison Jonas received ${q(jTypes)}.`;
  });

  await step(NT, role, "Portal: a Business User receives no Legal Only comment item and a mention takes Assigned to you, not a second comment item (Amara, team member)", "No item for Legal Only; one comment.mentioned for a mention", async () => {
    const a = ctx.amara.page;
    const since = new Date(Date.now() - 2000).toISOString();
    const mid = await comment(n, "contract", fx.contractId, `${tag} Nadia mentions Amara`, "full_thread", [fx.ids.amara]);
    const lid = await comment(n, "contract", fx.contractId, `${tag} Nadia legal only for Amara check`, "legal_only");
    await settleQueue();
    const m = (await aboutComment(a, mid, since, true)).map((x) => x.eventType);
    const l = (await aboutComment(a, lid, since, true)).map((x) => x.eventType);
    const rm = await L.api(d, "DELETE", `/contracts/${fx.contract.number}/team/${fx.ids.amara}`);
    fx.amaraOnTeam = rm.status >= 300;
    prep(`Daniel Okafor removed Amara Nwosu from the C-${fx.contract.number} team after the comparison (HTTP ${rm.status}).`);
    expect(m.length === 1 && m[0] === "comment.mentioned" && l.length === 0, JSON.stringify({ m, l }));
    return `A Contract Team mention of Amara gave ${q(m)}; a Legal Only comment gave ${q(l)}.`;
  });

  await step(NT, role, "A failed Portal preference save shows the error and keeps the earlier value", "The change could not be saved. Try again.; switch reverts", async () => {
    await p.goto(`${L.BASE}/portal/settings`);
    const sw = p.getByRole("switch", { name: "Activity on your records Email", exact: true });
    const before = await sw.getAttribute("aria-checked");
    const handler = (route) => (["PATCH", "PUT", "POST"].includes(route.request().method()) ? route.abort("failed") : route.continue());
    await p.route(/notification-preferences/, handler);
    await sw.click();
    await p.getByText("The change could not be saved. Try again.").waitFor({ timeout: 10000 });
    const after = await sw.getAttribute("aria-checked");
    await p.unroute(/notification-preferences/, handler);
    await p.reload();
    const reloaded = await p.getByRole("switch", { name: "Activity on your records Email", exact: true }).getAttribute("aria-checked");
    expect(before === after && after === reloaded, `${before} ${after} ${reloaded}`);
    return `With the save aborted the page showed "The change could not be saved. Try again."; the switch stayed aria-checked=${after} and read ${reloaded} after reload.`;
  });

  await step(NT, role, "Removing team membership removes record notifications from the Portal bell; restoring brings them back", "No C-N items while off the team; items return after restore", async () => {
    const title = fx.contractTitle;
    const before = (await itemsMatching(p, new RegExp(fx.contractId), true, fx.createdAt)).length;
    const rm = await L.api(d, "DELETE", `/contracts/${fx.contract.number}/team/${fx.ids.jonas}`);
    let during, visible;
    try {
      expect(rm.status < 300, `remove ${rm.status}`);
      await p.goto(`${L.BASE}/portal`);
      const dialog = await openBell(p);
      during = (await itemsMatching(p, new RegExp(fx.contractId), true, fx.createdAt)).length;
      visible = await dialog.getByRole("link", { name: new RegExp(`on ${title}`) }).count();
      await closeBell(p);
    } finally {
      const add = await L.api(d, "POST", `/contracts/${fx.contract.number}/team`, { userId: fx.ids.jonas });
      expect(add.status < 300, `restore ${add.status}`);
    }
    const after = (await itemsMatching(p, new RegExp(fx.contractId), true, fx.createdAt)).length;
    prep(`Daniel Okafor removed and restored Jonas Weber on the C-${fx.contract.number} team through the team API for the Portal bell access check.`);
    expect(before > 0 && during === 0 && visible === 0 && after >= before, JSON.stringify({ before, during, visible, after }));
    return `Jonas had ${before} C-${fx.contract.number} notifications; while off the team the Portal bell read returned ${during} and the panel showed ${visible} links for the Contract; after restore it returned ${after}.`;
  });
}

// ---------- V-C08 morning round, Key date reminders, and briefing ----------
function localDate(tz, plusDays = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const d = new Date(`${parts}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + plusDays);
  return d.toISOString().slice(0, 10);
}
function localHour(tz) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(new Date()));
}
async function queueMorningRound() {
  const id = psqlWith(
    "insert into pgboss.job (name, data, policy, expire_seconds, deletion_seconds, keep_until, retry_limit) select 'notification.morning-round', '{}'::jsonb, q.policy, q.expire_seconds, q.deletion_seconds, now() + interval '1 day', 0 from pgboss.queue q where q.name = 'notification.morning-round' returning id",
  ).split("\n")[0];
  for (let i = 0; i < 180; i++) {
    const state = psqlWith(`select state from pgboss.job where id = '${id}'`);
    if (state === "completed") return { id, state };
    if (state === "failed") throw new Error(`round ${id} failed`);
    await sleep(1000);
  }
  throw new Error(`round ${id} did not complete`);
}
async function mailTo(email, since) {
  return (await mailSearch(`to:"${email}"`)).filter((m) => m.Created >= since);
}
async function mailText(id) {
  const m = await fetch(`${L.MAIL}/api/v1/message/${id}`).then((x) => x.json());
  return m.Text ?? "";
}
function sectionsOf(text) {
  return ["Approvals", "Tasks", "Dates", "Obligations", "Knowledge", "Intake"].filter((h) => new RegExp(`^${h}$`, "m").test(text));
}

async function morning() {
  const d = ctx.daniel.page;
  const n = ctx.nadia.page;
  const tag = `DOC-029r2 conversations ${stamp}`;
  // Pick one saved timezone where the local hour is 8 or later and one where it is before 8.
  const LA = ["America/Los_Angeles", "America/New_York", "Europe/London", "Asia/Dubai", "Asia/Tokyo"].find((tz) => localHour(tz) >= 9 && localHour(tz) <= 21);
  const HNL = ["Pacific/Honolulu", "America/Anchorage", "America/Los_Angeles", "America/New_York", "Europe/London", "Asia/Dubai", "Asia/Tokyo", "Pacific/Auckland"].find((tz) => localHour(tz) >= 1 && localHour(tz) < 7);
  expect(LA && HNL, `no timezone pair: ${LA} ${HNL}`);
  const browser = await L.launch();
  const specs = [
    { key: "a", role: "legal_team_member", label: "Member Dates" },
    { key: "b", role: "legal_team_member", label: "Member No Date Bell" },
    { key: "c", role: "administrator", label: "Admin No Date Email" },
    { key: "e", role: "legal_team_member", label: "Member Before Eight" },
  ];
  const fresh = {};
  await step(NT, "administrator", "Fixture: invite fresh fictional accounts and check the initial Notification preferences on each", "Each fresh account shows the guide's initial choices", async () => {
    const out = [];
    for (const spec of specs) {
      const email = `doc029r2-conv-${stamp}-${spec.key}@helix.example`;
      const displayName = `DOC-029r2 conversations ${spec.label} ${stamp}`;
      const inv = await L.api(d, "POST", "/auth/invites", { email, displayName, role: spec.role });
      expect(inv.status === 201, `invite ${inv.status} ${JSON.stringify(inv.body).slice(0, 200)}`);
      const id = inv.body.user?.id;
      let href = null;
      for (let i = 0; i < 60 && !href; i++) {
        const [m] = await mailSearch(`to:"${email}"`);
        if (m) {
          const t = await mailText(m.ID);
          const match = t.match(/https?:\/\/[^\s)\]]+\/auth\/set-password[^\s)\]]*/);
          if (match) { const u = new URL(match[0]); const lab = new URL(L.BASE); u.protocol = lab.protocol; u.host = lab.host; href = u.toString(); }
        }
        if (!href) await sleep(750);
      }
      expect(href, `no activation mail for ${spec.key}`);
      const context = await browser.newContext({ baseURL: L.BASE, viewport: { width: 1440, height: 900 } });
      context.setDefaultTimeout(15000);
      const page = await context.newPage();
      const password = `Doc029-${createHash("sha256").update(`${Math.random()}${Date.now()}`).digest("hex").slice(0, 20)}`;
      await page.goto(href);
      href = null;
      await page.getByLabel("New password").fill(password);
      await page.getByLabel("Confirm password").fill(password);
      await page.getByRole("button", { name: "Set password" }).click();
      await page.getByText("Password set").first().waitFor({ timeout: 15000 }).catch(() => {});
      await page.goto(`${L.BASE}/auth/login`);
      const pw = page.getByRole("button", { name: "Sign in with a password" });
      if (await pw.isVisible().catch(() => false)) await pw.click();
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 });
      // Keep the account outside any morning until its fixtures are ready.
      const tz = await L.api(page, "PATCH", "/me/preferences", { timezone: HNL });
      expect(tz.status < 300, `timezone ${tz.status}`);
      if (page.url().includes("/onboarding")) await page.goto(`${L.BASE}/`);
      await openStaffNotificationSettings(page, displayName);
      const states = await switchStates(page, STAFF_SWITCHES);
      const expected = { "Assigned to you In-app": true, "Assigned to you Email": true, "Activity on your records In-app": true, "Activity on your records Email": false, "Dates approaching In-app": true, "New requests In-app": true, "New requests Email": false, "Knowledge items Email": true, "Approvals Email": true, "Tasks Email": true, "Dates Email": true, "Obligations Email": true, "Intake Email": false };
      const diff = Object.keys(expected).filter((k) => expected[k] !== states[k]);
      expect(diff.length === 0, `${spec.key} initial diff ${diff}`);
      fresh[spec.key] = { ...spec, email, displayName, id, context, page };
      out.push(`${spec.role} ${displayName}: initial choices match`);
    }
    results.records.freshAccounts = Object.values(fresh).map((f) => ({ role: f.role, displayName: f.displayName, email: f.email, userId: f.id }));
    prep(`Daniel Okafor invited four fresh fictional accounts through the invites API (three Legal Team Members and one Administrator, all named "DOC-029r2 conversations ... ${stamp}"). Each set a random in-memory password from its activation mail, signed in, and had its timezone set to ${HNL} through the preferences API so no morning round could serve it before its fixtures were ready.`);
    return out.join("; ");
  });
  if (Object.keys(fresh).length < 4) return;

  const offsets = (await L.api(d, "GET", "/org/reminder-offsets")).body;
  const today = localDate(LA);
  const plus7 = localDate(LA, 7);
  const plus3 = localDate(LA, 3);
  await step(NT, "legal_team_member", "Key date reminders: the Add a key date dialog shows global reminders and the combined schedule, bounds additional lead times, offers team members but not Business Users, and narrows recipients", "Global reminders and This date will remind lines; 731 not addable; Business User on the team not offered; the saved Key date keeps its lead time and one recipient", async () => {
    for (const f of Object.values(fresh)) {
      const r = await L.api(d, "POST", `/contracts/${fx.contract.number}/team`, { userId: f.id });
      expect(r.status < 300, `team ${f.key} ${r.status}`);
    }
    for (const f of [fresh.b, fresh.c]) {
      const r = await L.api(d, "POST", `/contracts/${fx.contract.number}/tasks`, { title: `${tag} due today for ${f.label}`, assigneeId: f.id, dueDate: today, addToTeam: true });
      expect(r.status < 300, `task ${f.key} ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    }
    for (const label of [`${tag} board pack`, `${tag} filing window`]) {
      const r = await L.api(d, "POST", `/contracts/${fx.contract.number}/key-dates`, { date: plus7, label });
      expect(r.status < 300, `key date ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    }
    prep(`Daniel Okafor added the four fresh accounts to the C-${fx.contract.number} team, created one Task due ${today} for "Member No Date Bell" and for "Admin No Date Email", and added two Key dates on ${plus7} (${tag} board pack, ${tag} filing window) through the API. Global reminder lead times in this lab: ${q(offsets)}.`);
    const p = n;
    await p.goto(`${L.BASE}/contracts/${fx.contract.number}`);
    await p.getByRole("link", { name: /^Key dates/ }).first().click();
    await p.getByRole("button", { name: "Add date" }).first().click();
    const dialog = p.getByRole("dialog", { name: "Add a key date" });
    await dialog.waitFor();
    await dialog.getByText(/^Global reminders:/).waitFor();
    const global = (await dialog.getByText(/^Global reminders:/).textContent()).trim();
    await dialog.getByRole("textbox", { name: "Date" }).fill(plus3);
    await dialog.getByRole("textbox", { name: "Event" }).fill(`${tag} narrowed review`);
    const lead = dialog.getByRole("spinbutton", { name: "Additional lead time (days before)" });
    await lead.fill("731");
    const disabled731 = await dialog.getByRole("button", { name: "Add lead time" }).isDisabled();
    await lead.fill("3");
    await dialog.getByRole("button", { name: "Add lead time" }).click();
    const combined = (await dialog.getByText(/^This date will remind:/).textContent()).trim();
    const people = await dialog.getByRole("checkbox").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? e.id));
    const names = [];
    for (const cb of await dialog.getByRole("checkbox").all()) names.push((await cb.evaluate((e) => e.labels?.[0]?.textContent ?? e.getAttribute("aria-label") ?? "")).trim());
    const jonasOffered = names.some((x) => /Jonas Weber/.test(x));
    await dialog.getByRole("checkbox", { name: fresh.a.displayName }).check();
    const usual = await dialog.getByRole("button", { name: "Use the usual audience" }).count();
    await dialog.getByRole("button", { name: "Add date" }).click();
    await dialog.waitFor({ state: "hidden" });
    const kd = (await L.api(d, "GET", `/contracts/${fx.contract.number}/key-dates`)).body.deadlines.find((x) => x.label === `${tag} narrowed review`);
    expect(disabled731 && !jonasOffered && kd && kd.reminderOffsetDays.includes(3) && kd.reminderRecipientIds.length === 1 && kd.reminderRecipientIds[0] === fresh.a.id, JSON.stringify({ disabled731, jonasOffered, kd }));
    return `Nadia's Add a key date dialog read ${q(global)}. Additional lead time 731 left Add lead time disabled (${disabled731}); 3 was added and the dialog read ${q(combined)}. Recipient checkboxes offered ${q(names)} (Jonas Weber, a Business User on the team, ${jonasOffered ? "was" : "was not"} offered); Use the usual audience controls shown after a pick: ${usual}. Saved ${plus3} with lead times ${q(kd.reminderOffsetDays)} and one recipient (the "Member Dates" account).`;
  });

  await step(NT, "legal_team_member", "Set the daily briefing and group switches on the fresh accounts before the morning", "Saved indications for Dates approaching In-app off (Member No Date Bell) and Briefing Dates Email off (Admin No Date Email)", async () => {
    await openStaffNotificationSettings(fresh.b.page, fresh.b.displayName);
    await setSwitch(fresh.b.page, "Dates approaching In-app", false);
    await openStaffNotificationSettings(fresh.c.page, fresh.c.displayName);
    await setSwitch(fresh.c.page, "Dates Email", false);
    await fresh.b.page.reload();
    await fresh.c.page.reload();
    const b = await switchStates(fresh.b.page, ["Dates approaching In-app", "Dates Email"]);
    const c = await switchStates(fresh.c.page, ["Dates approaching In-app", "Dates Email"]);
    for (const f of [fresh.a, fresh.b, fresh.c]) {
      const r = await L.api(f.page, "PATCH", "/me/preferences", { timezone: LA });
      expect(r.status < 300, `tz ${f.key}`);
    }
    prep(`The Member Dates, Member No Date Bell, and Admin No Date Email accounts had their timezone set to ${LA} (local hour ${localHour(LA)}) through the preferences API; Member Before Eight stayed on ${HNL} (local hour ${localHour(HNL)}).`);
    expect(!b["Dates approaching In-app"] && b["Dates Email"] && c["Dates approaching In-app"] && !c["Dates Email"], JSON.stringify({ b, c }));
    return `After reload, Member No Date Bell read ${q(b)} and Admin No Date Email read ${q(c)}.`;
  });

  const since = new Date(Date.now() - 1000).toISOString();
  let round1;
  await step(NT, "legal_team_member", "Understand reminder timing: a morning round after 8:00 in the saved timezone serves the briefing and date reminders; before 8:00 it defers", "Accounts in the after-8:00 timezone receive what their switches allow; the before-8:00 account receives nothing; Business User receives no briefing", async () => {
    round1 = await queueMorningRound();
    prep(`A morning round was queued as notification.morning-round in the lab's own pg-boss queue (job ${round1.id}) instead of waiting for the hourly cron; the worker ran it with its real clock, rules, notifier, and mailer.`);
    await settleQueue(5000);
    const report = {};
    for (const f of Object.values(fresh)) {
      const all = await mailTo(f.email, since);
      const mails = all.filter((m) => /^Your daily briefing$|^\d+ dates? on your|new Knowledge item/.test(m.Subject));
      const briefing = [];
      for (const m of mails) briefing.push({ subject: m.Subject, sections: sectionsOf(await mailText(m.ID)) });
      const items = (await itemsMatching(f.page, /date\.|briefing/, false, since)).map((x) => ({ type: x.eventType, label: x.payload?.label ?? null, reminderOffsetDays: x.reminderOffsetDays ?? x.payload?.reminderOffsetDays ?? null }));
      report[f.key] = { mails: briefing, otherMail: all.filter((m) => !mails.includes(m)).map((m) => m.Subject), bell: items };
    }
    const jonasBriefing = (await mailTo(L.PEOPLE.jonas.email, since)).filter((m) => /briefing|dates? on your/i.test(m.Subject)).length;
    results.records.morningRound1 = report;
    const a = report.a, b = report.b, c = report.c, e = report.e;
    const labels = (r) => r.bell.filter((x) => x.type.startsWith("date.") && String(x.label).includes(stamp)).map((x) => x.label).sort();
    const ok =
      labels(a).length === 3 && a.mails.length === 1 && a.mails[0].sections.includes("Dates") &&
      labels(b).length === 0 && b.mails.length === 1 && b.mails[0].sections.includes("Tasks") && !b.mails[0].sections.includes("Dates") &&
      labels(c).length === 2 && !labels(c).some((x) => /narrowed/.test(x)) && c.mails.length === 1 && c.mails[0].sections.includes("Tasks") && !c.mails[0].sections.includes("Dates") &&
      e.mails.length === 0 && e.bell.filter((x) => String(x.label).includes(stamp) || x.type === "briefing.ready").length === 0 && jonasBriefing === 0;
    expect(ok, JSON.stringify({ report, jonasBriefing }));
    return `Round ${round1.state}. Member Dates (${LA}): bell ${q(a.bell)}, mail ${q(a.mails)}. Member No Date Bell (${LA}, Dates approaching In-app off): bell ${q(b.bell)}, mail ${q(b.mails)}. Admin No Date Email (${LA}, Briefing Dates Email off): bell ${q(c.bell)}, mail ${q(c.mails)}. Member Before Eight (${HNL}, before 08:00): bell ${q(e.bell)}, mail ${q(e.mails)}. Jonas Weber received ${jonasBriefing} briefing mails.`;
  });

  await step(NT, "administrator", "The daily bell summary opens Home; a second round the same local day sends no second briefing or reminder", "Your daily briefing is ready opens /; second round adds no mail or date items", async () => {
    const p = fresh.c.page;
    await p.goto(`${L.BASE}/contracts/${fx.contract.number}`);
    const dialog = await openBell(p);
    const link = dialog.getByRole("link", { name: /Your daily briefing is ready/ }).first();
    await link.waitFor({ timeout: 10000 });
    const href = await link.getAttribute("href");
    const dateLinks = await dialog.getByRole("link", { name: new RegExp(`${stamp} (board pack|filing window) on .* is coming up`) }).allInnerTexts();
    await link.click();
    await p.waitForURL((u) => u.pathname === "/", { timeout: 15000 });
    const since2 = new Date(Date.now() - 1000).toISOString();
    const round2 = await queueMorningRound();
    await settleQueue(5000);
    const extra = {};
    for (const f of Object.values(fresh)) {
      extra[f.key] = { mails: (await mailTo(f.email, since2)).map((m) => m.Subject), bell: (await itemsMatching(f.page, /date\.|briefing/, false, since2)).length };
    }
    const quiet = ["a", "b", "c"].every((k) => extra[k].mails.length === 0 && extra[k].bell === 0);
    expect(href === "/" && quiet, JSON.stringify({ href, extra }));
    return `Admin No Date Email's bell listed the Key date items ${q(dateLinks.map((x) => x.replace(/\s+/g, " ")))} and Your daily briefing is ready linking ${href}; selecting it opened Home. A second queued round (${round2.state}) gave ${q(extra)}.`;
  });

  for (const f of Object.values(fresh)) await f.context.close();
}

// ---------- supplement: checks added after the main run ----------
async function supplement() {
  const n = ctx.nadia.page;
  const j = ctx.jonas.page;
  const tag = `DOC-029r2 conversations ${fx.stamp}`;
  const MORNING_STAMP = process.env.MORNING_STAMP ?? stamp;
  const only = (process.env.SUPP ?? "usual,bu,lines").split(",");

  if (only.includes("usual")) await step(NT, "legal_team_member", "When the selected recipient has left the team, editing the Key date offers Use the usual audience", "Edit key date explains the departed recipient and offers Use the usual audience; choosing it clears the selection", async () => {
    const d = ctx.daniel.page;
    const label = MORNING_STAMP ? `DOC-029r2 conversations ${MORNING_STAMP} narrowed review` : `${tag} narrowed review`;
    const kd = (await L.api(d, "GET", `/contracts/${fx.contract.number}/key-dates`)).body.deadlines.find((x) => x.label === label);
    const recipient = kd.reminderRecipientIds[0];
    const openEdit = async () => {
      await n.goto(`${L.BASE}/contracts/${fx.contract.number}`);
      await n.getByRole("link", { name: /^Key dates/ }).first().click();
      await n.getByRole("button", { name: `Actions for ${label}` }).click();
      await n.getByRole("menuitem", { name: "Edit date" }).click();
      const dialog = n.getByRole("dialog", { name: "Edit key date" });
      await dialog.waitFor();
      await dialog.getByText(/^This date will remind:/).waitFor();
      await n.waitForTimeout(800);
      return dialog;
    };
    let dialog = await openEdit();
    const beforeUsual = await dialog.getByRole("button", { name: "Use the usual audience" }).count();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    const rm = await L.api(d, "DELETE", `/contracts/${fx.contract.number}/team/${recipient}`);
    expect(rm.status < 300, `remove ${rm.status}`);
    let status, offered, checkedAfter;
    try {
      dialog = await openEdit();
      status = (await dialog.getByRole("status").filter({ hasText: "left the team" }).innerText()).replace(/\s+/g, " ").trim();
      offered = await dialog.getByRole("button", { name: "Use the usual audience" }).count();
      await dialog.getByRole("button", { name: "Use the usual audience" }).click();
      checkedAfter = await dialog.getByRole("checkbox", { checked: true }).count();
      const stillStatus = await dialog.getByText("Some selected recipients have left the team").count();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      expect(beforeUsual === 0 && offered === 1 && checkedAfter === 0 && stillStatus === 0, JSON.stringify({ beforeUsual, offered, checkedAfter, stillStatus }));
    } finally {
      await L.api(d, "POST", `/contracts/${fx.contract.number}/team`, { userId: recipient });
    }
    prep(`Daniel Okafor removed the selected recipient of ${label} from the C-${fx.contract.number} team through the team API and restored it after the check.`);
    return `With the selected recipient still on the team, Edit key date showed ${beforeUsual} Use the usual audience controls. After that person left the team, the dialog read ${q(status)} and offered Use the usual audience (${offered}); choosing it left ${checkedAfter} recipients selected. Cancel closed it without saving.`;
  });

  if (only.includes("bu")) await step(NT, "business_user", "A Business User on the team receives no date reminders or briefing from the morning rounds", "No date.* or briefing items in the Portal bell for the Contract after the rounds", async () => {
    const items = await itemsMatching(j, /date\.|briefing/, true, fx.createdAt);
    expect(items.length === 0, JSON.stringify(items.map((x) => x.eventType)));
    return `Jonas's Portal notifications since the fixtures were created include ${items.length} date reminder or briefing items, although he is on the C-${fx.contract.number} team whose Key dates reminded the Legal accounts.`;
  });

  if (MORNING_STAMP && only.includes("lines")) {
    await step(NT, "legal_team_member", "The briefing lines name each Key date", "The Member Dates briefing email names both same-date Key dates and the narrowed one", async () => {
      const email = `doc029r2-conv-${MORNING_STAMP}-a@helix.example`;
      const [m] = (await mailSearch(`to:"${email}" subject:"Your daily briefing"`)).filter((x) => x.Subject === "Your daily briefing");
      expect(m, "no briefing mail");
      const text = await mailText(m.ID);
      const names = ["board pack", "filing window", "narrowed review"].map((x) => `${MORNING_STAMP} ${x}`);
      const present = names.filter((x) => text.includes(x));
      expect(present.length === 3, `present ${present}`);
      return `The Member Dates ${MORNING_STAMP} briefing email's Dates section names ${q(present)}.`;
    });
  }
}

// ---------- focused screenshots ----------
async function shots() {
  const j = ctx.jonas.page;
  results.screenshots ??= [];
  await step(NT, "business_user", "Screenshot: Portal Notification settings with the three groups", "Screenshot saved", async () => {
    await j.goto(`${L.BASE}/portal`);
    await j.getByRole("banner").getByRole("link", { name: "Notification settings" }).click();
    await j.getByRole("heading", { name: "Notification settings", level: 1 }).waitFor();
    await j.waitForTimeout(800);
    await j.screenshot({ path: path.join(here, "r2-portal-notification-settings.png") });
    results.screenshots.push("r2-portal-notification-settings.png");
    return "Saved r2-portal-notification-settings.png.";
  });
}

// ---------- main ----------
let fx = existsSync(path.join(here, "fixtures-r2.json")) ? JSON.parse(readFileSync(path.join(here, "fixtures-r2.json"), "utf8")) : null;
const stamp = process.env.STAMP ?? String(Date.now()).slice(-6);
results.stamp = stamp;

const ctx = {};
try {
  ctx.nadia = await L.staffContext(L.PEOPLE.nadia);
  ctx.daniel = await L.staffContext(L.PEOPLE.daniel);
  ctx.jonas = await L.portalContext(L.PEOPLE.jonas);
  results.identities = [
    { role: "administrator", account: "Daniel Okafor (seed)", entry: "password sign-in" },
    { role: "legal_team_member", account: "Nadia Haddad (seed)", entry: "password sign-in" },
    { role: "business_user", account: "Jonas Weber (seed)", entry: "fresh magic link read from the work lab Mailpit, never stored" },
  ];

  if (run("setup")) await setupFixtures();
  for (const c of Object.values(ctx)) c.context.setDefaultTimeout(15000);
  if (run("member-notifications")) await memberNotifications();
  if (run("admin-notifications")) await adminNotifications();
  if (run("portal-notifications")) await portalNotifications();
  if (run("morning")) await morning();
  if (run("supplement")) await supplement();
  if (run("shots")) await shots();
  for (const c of Object.values(ctx)) await c.context.close().catch(() => {});
} finally {
  save();
  await L.close();
}
