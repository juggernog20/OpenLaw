// DOC-030 independent walkthrough, access group: portal-sign-in (V-C02), roles-and-access (V-C06),
// contributor-guide (V-C25). Written from the article text by the walkthrough agent, not by the author.
// Run from the worktree root after setup.mjs:
//   LAB_PASSWORD=... node docs/documentation/batches/DOC-030/access/walkthrough.mjs [signin] [roles] [contributor]
// A run of some articles replaces only those articles' steps in walkthrough.json.
// Credentials come only from the environment. Links, cookies, secrets and mail bodies are never written.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  BASE,
  LAB,
  MAIL,
  PROJECT,
  SEED,
  applet,
  apiSession,
  call,
  check,
  closeBrowser,
  freshStep,
  go,
  h1,
  here,
  mailSince,
  makeLog,
  newContext,
  pageApi,
  portalSignIn,
  root,
  rosterRows,
  settle,
  sleep,
  sql,
  staffSignIn,
  text,
  totp,
  upload,
  waitForLink,
} from "./lib.mjs";

const fx = JSON.parse(readFileSync(path.join(here, "fixtures.json"), "utf8"));
const OUT = path.join(here, "walkthrough.json");
const ARTICLES = { signin: "portal-sign-in", roles: "roles-and-access", contributor: "contributor-guide" };
const chosen = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(ARTICLES);
const sha = (id) =>
  execFileSync("sha256sum", [path.join(root, `docs/user-guides/${id}.md`)], { encoding: "utf8" }).split(" ")[0];
const image = (svc) =>
  execFileSync("docker", ["inspect", "-f", "{{.Image}}", `${PROJECT}-${svc}-1`], { encoding: "utf8" }).trim();

const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null;
const results = {
  batch: "DOC-030",
  group: "access",
  walkthroughReviewer: "DOC-030 independent walkthrough agent (access)",
  reviewerKind: "agent",
  appCommit: LAB.sourceCommit,
  lab: {
    name: LAB.name,
    project: PROJECT,
    appUrl: BASE,
    mailUrl: MAIL,
    appImageId: LAB.appImageId,
    engineImageId: LAB.engineImageId,
    runningImages: { app: image("app"), worker: image("worker"), "doc-engine": image("doc-engine") },
    seed: LAB.seed,
  },
  browser: "Playwright 1.63.0 Chromium, headless, 1440x900, one isolated browser context per person",
  fixtures: "fixtures.json (setup.mjs); every record is named DOC-030 access <name> 09251012",
  runs: { ...(previous?.runs ?? {}) },
  articleContentSha256: { ...(previous?.articleContentSha256 ?? {}) },
  settingChanges: [...(previous?.settingChanges ?? []).filter((c) => !chosen.includes(c.module))],
  productBugs: [...(previous?.productBugs ?? []).filter((b) => !chosen.includes(b.module))],
  steps: (previous?.steps ?? []).filter((s) => !chosen.map((k) => ARTICLES[k]).includes(s.article)),
};
for (const k of chosen) {
  results.articleContentSha256[ARTICLES[k]] = sha(ARTICLES[k]);
  results.runs[ARTICLES[k]] = { startedAt: new Date().toISOString(), finishedAt: null };
}
function save() {
  writeFileSync(OUT, JSON.stringify(results, null, 2) + "\n");
}
const step = makeLog(results, save);
const summary = (article) => {
  const s = results.steps.filter((x) => x.article === article);
  return {
    total: s.length,
    pass: s.filter((x) => x.result === "pass").length,
    fail: s.filter((x) => x.result === "fail").length,
  };
};
const tag = fx.stamp;
// One browser context per person for the whole process, so each run spends one sign-in link per Business User.
const sessions = {};
async function portal(key) {
  sessions[key] ??= await portalSignIn(SEED[key].email);
  return sessions[key];
}
let adminSession = null;
async function admin() {
  adminSession ??= await apiSession(SEED.daniel.email);
  return adminSession;
}
async function staff(key) {
  sessions[key] ??= await staffSignIn(SEED[key].email);
  return sessions[key];
}
const runTag = Date.now().toString().slice(-6);

// ============================================================================
// portal-sign-in (V-C02), Business User
// ============================================================================
async function signin() {
  const A = "portal-sign-in";
  const BU = "business_user";
  const newEmail = `doc030.access.first.${runTag}@helix.example`;
  const newName = `DOC-030 access first Business User ${runTag}`;
  const expiryEmail = `doc030.access.expiry.${runTag}@helix.example`;
  const outsider = `doc030.access.${runTag}@not-allowed-domain.example`;
  const invitedOutside = `doc030.access.invited.${runTag}@partner-firm.example`;
  const pwEmail = `doc030.access.password.${runTag}@helix.example`;
  const tfEmail = `doc030.access.twofactor.${runTag}@helix.example`;
  const daniel = await apiSession(SEED.daniel.email);
  const nadiaApi = await apiSession(SEED.nadia.email);

  // A link for the time-expiry check, requested first so that five minutes pass during the run.
  const expiryPage = await newContext();
  let expiryLink = null;
  let expiryRequestedAt = null;
  await step(A, BU, "fixture.expiry-link", "Request a sign-in link now for a later check after five minutes.", "A link arrives for a new allowed-domain address.", async () => {
    await expiryPage.page.goto(`${BASE}/portal/login`);
    await expiryPage.page.getByRole("heading").first().waitFor();
    await settle(expiryPage.page);
    await expiryPage.page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expiryPage.page.getByLabel("Email").fill(expiryEmail);
    expiryRequestedAt = Date.now();
    await expiryPage.page.getByRole("button", { name: "Send link" }).click();
    await expiryPage.page.getByText("Check your email").first().waitFor({ timeout: 15000 });
    const m = await waitForLink(expiryEmail, expiryRequestedAt, { subjectRe: /Sign in/i, linkRe: /magic-link/ });
    check(m?.link, "no link arrived");
    expiryLink = m.link;
    return { page: "/portal/login", actual: `Link email "${m.subject}" arrived for a new helix.example address at ${new Date(expiryRequestedAt).toISOString()}; kept unopened for the expiry check.` };
  });

  // ---- Get a sign-in link, steps 1-6, first visit.
  const bu = await newContext();
  let firstLink = null;
  await step(A, BU, "S1.open-address", "Open the Portal address.", "The sign-in page shows the organization's name, and its logo if one is saved.", async () => {
    await bu.page.goto(`${BASE}/portal`);
    await bu.page.waitForURL(/\/portal\/login/, { timeout: 15000 });
    await bu.page.getByRole("heading", { name: "Business Portal sign-in" }).waitFor({ timeout: 15000 });
    await settle(bu.page);
    const brand = await fetch(`${BASE}/api/v1/org/branding`).then((r) => r.json());
    const main = await text(bu.page.locator("main"));
    const logos = await bu.page.getByRole("img", { name: "Organization logo" }).count();
    check(main.startsWith(brand.name), `page starts "${main.slice(0, 60)}"`);
    check(brand.logo ? logos === 1 : logos === 0, `logo images ${logos}, saved logo ${!!brand.logo}`);
    return {
      page: "/portal/login",
      actual: `Signed out, /portal opened /portal/login. The page read "${main.slice(0, 120)}". Saved name "${brand.name}", saved logo ${brand.logo ? "yes" : "none"}, Organization logo images ${logos}. The page also shows "Legal Portal" and "Powered by OpenLaw" under the name, which the guide does not mention.`,
    };
  });
  await step(A, BU, "S2.email-me", "If the page shows a password form or Continue with single sign-on, select Email me a sign-in link.", "The page changes to Get a sign-in link.", async () => {
    const pw = (await bu.page.getByLabel("Password").count()) > 0;
    const sso = await bu.page.getByRole("button", { name: "Continue with single sign-on" }).count();
    await bu.page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await bu.page.getByText("Get a sign-in link").first().waitFor({ timeout: 10000 });
    return { page: "/portal/login", actual: `Password form shown ${pw}; Continue with single sign-on ${sso > 0}. Email me a sign-in link changed the card title to Get a sign-in link.` };
  });
  let sent = 0;
  await step(A, BU, "S3-5.send-link", "Enter the work address in Email, select Send link.", "Check your email appears.", async () => {
    await bu.page.getByLabel("Email").fill(newEmail);
    sent = Date.now();
    await bu.page.getByRole("button", { name: "Send link" }).click();
    await bu.page.getByText("Check your email").first().waitFor({ timeout: 15000 });
    const body = await text(bu.page.locator("main"));
    check(/It expires in 5 minutes and works once/.test(body), body);
    return { page: "/portal/login", actual: `Check your email appeared: "${body.replace(newEmail, "<new address>").slice(body.indexOf("Check your email"), body.indexOf("Check your email") + 170)}".` };
  });
  await step(A, BU, "S6.follow-link", "Open the sign-in email and follow its link within five minutes.", "The Portal opens under that identity; first visit shows Welcome to your Business Portal; Department with Continue, Skip later, Finish opens the Portal.", async () => {
    const m = await waitForLink(newEmail, sent, { subjectRe: /Sign in/i, linkRe: /magic-link/ });
    check(m?.link, "no email");
    firstLink = m.link;
    const lifetime = sql(
      `select round(extract(epoch from (expires_at - created_at))/60) from verifications where value like '%${newEmail}%' order by created_at desc limit 1`,
    );
    await bu.page.goto(firstLink);
    await bu.page.getByText("Welcome to your Business Portal").first().waitFor({ timeout: 20000 });
    const url = new URL(bu.page.url()).pathname;
    const cont = bu.page.getByRole("button", { name: "Continue" });
    const disabled = await cont.isDisabled();
    const noSkip = (await bu.page.getByRole("button", { name: "Skip" }).count()) === 0;
    const deptLabel = await bu.page.getByText("Department", { exact: true }).first().isVisible();
    await bu.page.locator("#first-run-department").selectOption({ index: 1 });
    await sleep(600);
    await cont.click();
    await bu.page.getByLabel("Full name").waitFor();
    await bu.page.getByLabel("Full name").fill(newName);
    await bu.page.getByLabel("Full name").blur();
    await sleep(1000);
    const skipped = [];
    for (let i = 0; i < 6; i++) {
      if (await bu.page.getByRole("button", { name: "Finish" }).isVisible().catch(() => false)) break;
      skipped.push(await text(bu.page.locator("#first-run-step")));
      await bu.page.getByRole("button", { name: "Skip" }).click();
      await sleep(600);
    }
    await bu.page.getByRole("button", { name: "Finish" }).click();
    await bu.page.waitForURL((u) => u.pathname.replace(/\/$/, "") === "/portal", { timeout: 20000 });
    await settle(bu.page);
    const header = await text(bu.page.getByRole("banner"));
    const main = await text(bu.page.locator("main"));
    check(lifetime === "5", `lifetime ${lifetime}`);
    check(disabled && noSkip && deptLabel, `Continue disabled ${disabled}, no Skip ${noSkip}`);
    check(header.includes(newName) || header.includes(newEmail) || main.includes(newName), `header "${header}"`);
    return {
      page: url,
      actual: `Subject "${m.subject}". Link lifetime ${lifetime} minutes. The link opened ${url} with Welcome to your Business Portal. The Department step had Continue (disabled until a Department was chosen) and no Skip. After Full name, Skip was offered on: ${skipped.join(" | ")}. Finish opened /portal. Header: "${header.replace(newEmail, "<new address>").slice(0, 160)}". Main: "${main.slice(0, 160)}".`,
    };
  });

  // ---- Neutral response and the allowed-domain rule.
  await step(A, BU, "S7.outside-domain", "Request a link for an address outside the allowed domains with no account.", "Check your email is neutral; no link arrives.", async () => {
    const c = await newContext();
    await c.page.goto(`${BASE}/portal/login`);
    await c.page.getByRole("heading").first().waitFor();
    await settle(c.page);
    await c.page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await c.page.getByLabel("Email").fill(outsider);
    const s = Date.now();
    await c.page.getByRole("button", { name: "Send link" }).click();
    await c.page.getByText("Check your email").first().waitFor({ timeout: 15000 });
    const body = await text(c.page.locator("main"));
    await sleep(8000);
    const n = (await mailSince(outsider, s)).length;
    await c.context.close();
    check(n === 0 && /is eligible/.test(body), `messages ${n}`);
    return { page: "/portal/login", actual: `Check your email said "If <address> is eligible, a sign-in link is on its way..."; Mailpit held ${n} messages for the address after 8 s.` };
  });
  await step(A, BU, "S7b.outside-domain-existing", "Request a link for an existing active Business User account on a domain that is not allowed.", "An address outside the allowed domains with an existing account receives a link.", async () => {
    // Fixture: the Administrator invites the account and makes it a Business User (API; invites offer staff roles only).
    const inv = await call(daniel, "POST", "/auth/invites", { email: invitedOutside, displayName: `DOC-030 access partner ${runTag}`, role: "legal_team_member" });
    check(inv.status === 201, `invite ${inv.status}`);
    const role = await call(daniel, "PATCH", `/users/${inv.body.user.id}/role`, { role: "business_user" });
    const c = await newContext();
    await c.page.goto(`${BASE}/portal/login`);
    await c.page.getByRole("heading").first().waitFor();
    await settle(c.page);
    await c.page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await c.page.getByLabel("Email").fill(invitedOutside);
    const s = Date.now();
    await c.page.getByRole("button", { name: "Send link" }).click();
    await c.page.getByText("Check your email").first().waitFor({ timeout: 15000 });
    const m = await waitForLink(invitedOutside, s, { subjectRe: /Sign in/i, linkRe: /magic-link/ });
    let landed = null;
    if (m?.link) {
      await c.page.goto(m.link);
      await c.page.waitForURL((u) => u.pathname.startsWith("/portal") && !u.pathname.startsWith("/portal/login"), { timeout: 20000 }).catch(() => {});
      landed = new URL(c.page.url()).pathname;
    }
    await c.context.close();
    check(m?.link && landed?.startsWith("/portal") && landed !== "/portal/login", `mail ${!!m}, landed ${landed}`);
    return { page: "/portal/login", actual: `Fixture: Daniel invited an account at partner-firm.example (not an allowed domain) and changed its role to Business User (${role.status}). Send link showed Check your email and the sign-in email "${m.subject}" arrived; its link opened ${landed}.` };
  });

  // ---- Sign out, used link, fresh link.
  await step(A, BU, "S8.sign-out", "Select Sign out in the Portal header.", "The session ends; the Portal sign-in page shows.", async () => {
    await bu.page.goto(`${BASE}/portal`);
    await settle(bu.page);
    const direct = bu.page.getByRole("banner").getByRole("button", { name: "Sign out" });
    let via = "header button";
    if (!(await direct.isVisible().catch(() => false))) {
      via = "header menu";
      await bu.page.getByRole("banner").getByRole("button").last().click();
      await bu.page.getByRole("menuitem", { name: "Sign out" }).click();
    } else await direct.click();
    await bu.page.waitForURL(/\/portal\/login/, { timeout: 15000 });
    await bu.page.goto(`${BASE}/portal`);
    await settle(bu.page);
    const after = new URL(bu.page.url()).pathname;
    check(after === "/portal/login", after);
    return { page: "/portal", actual: `Sign out (${via}) returned to /portal/login; opening /portal again showed ${after}.` };
  });
  await step(A, BU, "S9.used-link", "Reuse the old email link after sign-out; on Sign-in link expired enter Email, select Send link, follow the new link once.", "Sign-in link expired offers Email and Send link; the new link opens the Portal; an old link does not.", async () => {
    await bu.page.goto(firstLink);
    await bu.page.getByText("Sign-in link expired").first().waitFor({ timeout: 15000 });
    const u = new URL(bu.page.url());
    const body = await text(bu.page.locator("main"));
    await bu.page.getByLabel("Email").fill(newEmail);
    const s = Date.now();
    await bu.page.getByRole("button", { name: "Send link" }).click();
    await bu.page.getByText("Check your email").first().waitFor({ timeout: 15000 });
    const m = await waitForLink(newEmail, s, { subjectRe: /Sign in/i, linkRe: /magic-link/ });
    await bu.page.goto(m.link);
    await bu.page.waitForURL((x) => x.pathname.replace(/\/$/, "") === "/portal", { timeout: 20000 });
    await settle(bu.page);
    const onboarding = await bu.page.getByText("Welcome to your Business Portal").isVisible().catch(() => false);
    check(u.pathname === "/auth/link-expired" && u.searchParams.get("portal") === "1" && !onboarding, `${u.pathname}${u.search}`);
    return { page: `${u.pathname}${u.search}`, actual: `The used link opened ${u.pathname}${u.search}: "${body.slice(body.indexOf("Sign-in link expired"), body.indexOf("Sign-in link expired") + 150)}". Email and Send link sent "${m.subject}"; its link opened /portal without repeating onboarding.` };
  });
  await step(A, BU, "S10.bad-link", "Open a sign-in link whose token was altered.", "A bad link offers a working recovery route.", async () => {
    const u = new URL(firstLink);
    u.searchParams.set("token", "doc030-access-not-a-token");
    const c = await newContext();
    await c.page.goto(u.toString());
    await settle(c.page);
    const landed = new URL(c.page.url());
    const body = await text(c.page.locator("main"));
    const sendLink = await c.page.getByRole("button", { name: "Send link" }).count();
    await c.context.close();
    check(/Sign-in link expired/.test(body) && sendLink > 0, body.slice(0, 200));
    return { page: `${landed.pathname}${landed.search}`, actual: `An altered token opened ${landed.pathname}${landed.search} with "${body.slice(0, 200)}". Email and Send link were offered (the same recovery route as S9).` };
  });

  // ---- Jonas: identity, own Requests, isolation, staff pages, Contracts, Matters.
  const J = (await portal("jonas")).page;
  const jonasReq = sql(
    `select r.number||'|'||r.title from requests r join users u on u.id=r.requester_id where u.email='${SEED.jonas.email}' and r.status<>'converted' order by r.number limit 1`,
  ).split("|");
  const amaraReq = sql(
    `select r.number||'|'||r.title from requests r join users u on u.id=r.requester_id where u.email='${SEED.amara.email}' and r.status<>'converted' order by r.number limit 1`,
  ).split("|");
  await step(A, BU, "S11.own-requests", "Follow a fresh link as Jonas; check the signed-in identity.", "The Portal opens under that identity and lists that person's Requests.", async () => {
    await go(J, "/portal");
    const header = await text(J.getByRole("banner"));
    const main = await text(J.locator("main"));
    check(main.includes(jonasReq[1].slice(0, 30)), `R-${jonasReq[0]} missing`);
    check(!main.includes(amaraReq[1].slice(0, 30)), "Amara's Request shown");
    return { page: "/portal", actual: `Header "${header.slice(0, 120)}". Jonas's own Request R-${jonasReq[0]} was listed; Amara's R-${amaraReq[0]} was not.` };
  });
  await step(A, BU, "S12.other-request-and-staff-pages", "Open another Business User's Request link and the staff Inbox, Contracts and Matters pages.", "Another Business User's Request link does not grant access; staff pages are closed.", async () => {
    await go(J, `/portal/requests/${amaraReq[0]}`);
    const landed = new URL(J.url()).pathname;
    const leaked = (await text(J.locator("main"))).includes(amaraReq[1].slice(0, 30));
    const staff = {};
    for (const p of ["/inbox", "/contracts", "/matters"]) {
      await go(J, p);
      staff[p] = new URL(J.url()).pathname;
    }
    check(!leaked && Object.values(staff).every((p) => p.startsWith("/portal")), JSON.stringify({ landed, staff }));
    return { page: `/portal/requests/${amaraReq[0]}`, actual: `Amara's Request address showed ${landed} without its title. Staff pages: ${JSON.stringify(staff)}.` };
  });
  await step(A, BU, "S13.your-contracts", "Select Contracts in the Portal navigation bar.", "Your Contracts lists non-archived Contracts whose teams include you; Show more loads more.", async () => {
    await go(J, "/portal");
    await J.getByRole("navigation", { name: "Portal" }).getByRole("link", { name: "Contracts" }).click();
    await J.waitForURL(/\/portal\/contracts/);
    await J.getByRole("heading", { name: "Your Contracts" }).waitFor({ timeout: 15000 });
    await settle(J);
    const before = await J.locator("main a[href*='/portal/contracts/']").count();
    await J.getByRole("button", { name: "Show more" }).click();
    await settle(J);
    const after = await J.locator("main a[href*='/portal/contracts/']").count();
    const list = await text(J.locator("main"));
    const archived = list.includes(fx.archivedJ.title);
    const direct = await (async () => {
      await go(J, `/portal/contracts/${fx.archivedJ.number}`);
      return h1(J);
    })();
    check(after > before && !archived && /not found/.test(direct), JSON.stringify({ before, after, archived, direct }));
    return { page: "/portal/contracts", actual: `Your Contracts showed ${before} row links; Show more raised it to ${after}. The archived team Contract C-${fx.archivedJ.number} was not listed and its address showed "${direct}".` };
  });
  await step(A, BU, "S14.read-contract", "Open a row; check reference, title, Counterparty, Stage, owners, terms, dates and Value; in Documents the Primary Document label; select the name; use the download control; use Your Contracts.", "The Contract page shows these; the Primary Document label marks the primary file; the name opens the current Version; download works; Your Contracts returns to the list.", async () => {
    const n = fx.jonasConverted.number;
    await go(J, "/portal/contracts");
    await J.getByRole("searchbox", { name: "Search Contracts" }).fill(`C-${n}`);
    await J.getByRole("searchbox", { name: "Search Contracts" }).press("Enter");
    await settle(J);
    await J.locator(`main a[href$='/portal/contracts/${n}']`).first().click();
    await J.waitForURL(new RegExp(`/portal/contracts/${n}$`));
    await settle(J);
    const main = await text(J.locator("main"));
    const labels = ["Counterparty", "Stage", "Business Owner", "Legal Owner", "Term type", "Effective date", "Expiry date", "Value", "Documents"];
    const missing = labels.filter((l) => !main.includes(l));
    const primary = await J.getByText("Primary Document", { exact: true }).first().isVisible().catch(() => false);
    const docs = J.getByRole("region", { name: "Documents" });
    const dl = docs.getByRole("link", { name: /^Download .+, version \d+$/ }).first();
    const dlName = await dl.getAttribute("aria-label");
    const [download] = await Promise.all([J.waitForEvent("download", { timeout: 20000 }).catch(() => null), dl.click()]);
    await docs.getByRole("button", { name: "doc030-access-jonas-paper.txt" }).first().click();
    const viewer = J.getByRole("complementary", { name: /doc030-access-jonas-paper\.txt, version \d+/ });
    await viewer.waitFor({ timeout: 15000 });
    const viewerName = await viewer.getAttribute("aria-label");
    await viewer.getByRole("button", { name: "Close the document" }).click();
    await J.getByRole("link", { name: "Your Contracts" }).first().click();
    const back = await J.waitForURL(/\/portal\/contracts$/, { timeout: 10000 }).then(() => true, () => false);
    check(main.includes(`C-${n}`) && missing.length === 0 && primary && download && back, JSON.stringify({ missing, primary, download: !!download, back }));
    return { page: `/portal/contracts/${n}`, actual: `C-${n} "${fx.jonasConverted.title}" showed ${labels.join(", ")} (Term type is the terms fact). Overview text: "${main.slice(main.indexOf("Overview"), main.indexOf("Overview") + 330)}". Primary Document label shown; the name opened "${viewerName}"; "${dlName}" downloaded "${download.suggestedFilename()}"; Your Contracts returned to the list.` };
  });
  await step(A, BU, "S15.matters", "Select Matters in the Portal navigation bar and open a row.", "The Matter shows its M- reference, title, Matter Type, Status, Matter Manager and Business Owner; the list uses the current-team rule.", async () => {
    const teamMatter = sql(
      `select m.number from matter_team t join matters m on m.id=t.matter_id where t.user_id='${fx.ids.jonas}' and m.archived_at is null order by m.number limit 1`,
    );
    await J.getByRole("navigation", { name: "Portal" }).getByRole("link", { name: "Matters" }).click();
    await J.waitForURL(/\/portal\/matters/);
    await settle(J);
    const list = await text(J.locator("main"));
    await J.locator(`main a[href$='/portal/matters/${teamMatter}']`).first().click();
    await J.waitForURL(new RegExp(`/portal/matters/${teamMatter}$`));
    await settle(J);
    const main = await text(J.locator("main"));
    const labels = ["Matter Type", "Status", "Matter Manager", "Business Owner"];
    const missing = labels.filter((l) => !main.includes(l));
    const notListed = !list.includes(fx.mx.title);
    check(main.includes(`M-${teamMatter}`) && missing.length === 0 && notListed, JSON.stringify({ missing, notListed }));
    return { page: `/portal/matters/${teamMatter}`, actual: `Your Matters listed Jonas's team Matters and not M-${fx.mx.number}, whose team does not include him. M-${teamMatter} showed ${labels.join(", ")}: "${main.slice(0, 260)}".` };
  });
  await step(A, BU, "S16.record-sections", "Check the record page sections and applet bar.", "Record pages offer Fields, Documents with Versions and read-only Original request; the applet bar holds Comments, History and Contract team or Matter team.", async () => {
    const n = fx.jonasConverted.number;
    await go(J, `/portal/contracts/${n}`);
    const main = await text(J.locator("main"));
    const bar = await text(J.getByRole("toolbar", { name: "Applets" }));
    const hasBar = (label) => J.getByRole("toolbar", { name: "Applets" }).getByRole("button", { name: new RegExp(`^${label}`) }).count();
    const c = { Comments: await hasBar("Comments"), History: await hasBar("History"), "Contract team": await hasBar("Contract team") };
    await go(J, `/portal/matters/${sql(`select m.number from matter_team t join matters m on m.id=t.matter_id where t.user_id='${fx.ids.jonas}' and m.archived_at is null order by m.number limit 1`)}`);
    const m = { "Matter team": await J.getByRole("toolbar", { name: "Applets" }).getByRole("button", { name: /^Matter team/ }).count() };
    check(/Fields/.test(main) && /Documents/.test(main) && /Original request/.test(main) && Object.values({ ...c, ...m }).every((v) => v > 0), JSON.stringify({ c, m }));
    return { page: `/portal/contracts/${n}`, actual: `C-${n} showed Fields, Documents (with Version rows) and Original request. Applet bar: "${bar}". The Matter page offered Matter team.` };
  });
  await step(A, BU, "S17.conversion", "Open the converted Request address; check the team.", "At conversion you become Business Owner and join the team; the Request address redirects there.", async () => {
    await go(J, `/portal/requests/${fx.jonasConverted.request}`);
    const landed = new URL(J.url()).pathname;
    const rows = await rosterRows(await applet(J, "Contract team"));
    check(landed === `/portal/contracts/${fx.jonasConverted.number}` && rows.some((r) => /Business Owner/.test(r) && r.includes("Jonas Weber")), `${landed} ${rows}`);
    return { page: `/portal/requests/${fx.jonasConverted.request}`, actual: `/portal/requests/${fx.jonasConverted.request} redirected to ${landed}. Contract team rows: ${rows.join(" | ")}.` };
  });
  await step(A, BU, "S18.new-business-owner", "Legal assigns a new Business Owner (second actor, API).", "The new Business Owner joins the team; the former owner remains a member until Legal removes them.", async () => {
    const n = fx.jonasConverted.number;
    const set = await call(nadiaApi, "PATCH", `/contracts/${n}`, { businessOwnerId: fx.ids.amara });
    await J.reload();
    await settle(J);
    const rows = await rosterRows(await applet(J, "Contract team"));
    const still = !/not found/.test(await h1(J));
    const back = await call(nadiaApi, "PATCH", `/contracts/${n}`, { businessOwnerId: fx.ids.jonas });
    const del = await call(nadiaApi, "DELETE", `/contracts/${n}/team/${fx.ids.amara}`);
    check(set.status === 200 && still && rows.some((r) => /Business Owner/.test(r) && r.includes("Amara Nwosu")) && rows.some((r) => r.includes("Jonas Weber")), JSON.stringify({ set: set.status, rows }));
    return { page: `/portal/contracts/${n}`, actual: `Nadia set Amara Nwosu as Business Owner (${set.status}). Jonas still opened C-${n}; his Contract team read: ${rows.join(" | ")}. Restored: Business Owner back to Jonas (${back.status}), Amara removed (${del.status}).` };
  });

  // ---- Amara in a separate context.
  const amara = await portal("amara");
  await step(A, BU, "S19.second-business-user", "Sign in as Amara in a separate browser context.", "Only the intended Business User session opens; each sees only their own Requests.", async () => {
    await go(amara.page, "/portal");
    const main = await text(amara.page.locator("main"));
    const header = await text(amara.page.getByRole("banner"));
    await go(amara.page, `/portal/requests/${jonasReq[0]}`);
    const landed = new URL(amara.page.url()).pathname;
    const leak = (await text(amara.page.locator("main"))).includes(jonasReq[1].slice(0, 30));
    await go(J, "/portal");
    const jHeader = await text(J.getByRole("banner"));
    check(main.includes(amaraReq[1].slice(0, 30)) && !main.includes(jonasReq[1].slice(0, 30)) && !leak, JSON.stringify({ landed, leak }));
    return { page: "/portal", actual: `Amara's header "${header.slice(0, 80)}"; her R-${amaraReq[0]} listed, Jonas's R-${jonasReq[0]} not; Jonas's Request address showed ${landed} without its title. Jonas's own context still read "${jHeader.slice(0, 80)}".` };
  });

  // ---- Staff role kept after a Portal sign-in link.
  await step(A, "legal_team_member", "S20.staff-keeps-role", "A Legal Team Member follows a Portal sign-in link.", "The account keeps its role; it does not act as a Business User.", async () => {
    const c = await portalSignIn(SEED.nadia.email).catch(async (e) => {
      throw e;
    });
    await settle(c.page);
    const landed = new URL(c.page.url()).pathname;
    const me = await pageApi(c.page, "GET", "/me");
    await go(c.page, "/contracts");
    const staff = new URL(c.page.url()).pathname;
    await c.context.close();
    check(me.body?.user?.role === "legal_team_member" || me.body?.role === "legal_team_member", JSON.stringify(me.body).slice(0, 200));
    return { page: "/portal/login", actual: `Nadia's Portal link opened ${landed}; /me role ${me.body?.user?.role ?? me.body?.role}; /contracts stayed at ${staff}.` };
  });

  // ---- Time-expired link, then its replacement works once.
  await step(A, BU, "S21.expired-link", "Follow a link after five minutes; on Sign-in link expired enter Email, Send link, follow the new link once.", "The expired link offers a fresh link; the new link works once.", async () => {
    const wait = expiryRequestedAt + 5 * 60000 + 15000 - Date.now();
    if (wait > 0) await sleep(wait);
    const p = expiryPage.page;
    await p.goto(expiryLink);
    await p.getByText("Sign-in link expired").first().waitFor({ timeout: 15000 });
    const u = new URL(p.url());
    await p.getByLabel("Email").fill(expiryEmail);
    const s = Date.now();
    await p.getByRole("button", { name: "Send link" }).click();
    await p.getByText("Check your email").first().waitFor({ timeout: 15000 });
    const m = await waitForLink(expiryEmail, s, { subjectRe: /Sign in/i, linkRe: /magic-link/ });
    await p.goto(m.link);
    const opened = await p.waitForURL((x) => x.pathname.startsWith("/portal") && !x.pathname.startsWith("/portal/login"), { timeout: 20000 }).then(() => true, () => false);
    const landed = new URL(p.url()).pathname;
    const c2 = await newContext();
    await c2.page.goto(m.link);
    const twice = await c2.page.getByText("Sign-in link expired").first().waitFor({ timeout: 15000 }).then(() => true, () => false);
    await c2.context.close();
    await expiryPage.context.close();
    check(u.pathname === "/auth/link-expired" && opened && twice, JSON.stringify({ u: u.pathname, opened, twice }));
    return { page: `${u.pathname}${u.search}`, actual: `After ${Math.round((Date.now() - expiryRequestedAt) / 60000)} minutes the first link opened ${u.pathname}${u.search} (Sign-in link expired). Email and Send link sent a new link, which opened ${landed}. The same new link in a second browser context opened Sign-in link expired (works once).` };
  });

  await settingVariants({ A, BU, daniel, pwEmail, tfEmail });
  await bu.context.close();
}

// Organization setting variants: links off, SSO-first, two-factor, logo. Each is set, walked and put back.
async function settingVariants({ A, BU, daniel, pwEmail, tfEmail }) {
  const methods = async () => (await fetch(`${BASE}/api/v1/auth/methods`).then((r) => r.json()));
  const before = await methods();
  const original = before.policy.business;
  const general = await call(daniel, "GET", "/org/general");
  const change = (what, from, to) =>
    results.settingChanges.push({ module: "signin", at: new Date().toISOString(), what, from, to });
  const setBusiness = async (opts) => {
    const r = await call(daniel, "PATCH", "/auth/policy/business", opts);
    change("business authentication policy", null, opts);
    return r;
  };
  const restore = async () => {
    const r = await call(daniel, "PATCH", "/auth/policy/business", original);
    change("business authentication policy restored", null, original);
    return r.status;
  };
  const loginView = async (c) => {
    await c.page.goto(`${BASE}/portal/login`);
    await c.page.getByRole("heading").first().waitFor({ timeout: 15000 });
    await settle(c.page);
    return {
      body: await text(c.page.locator("main")),
      buttons: (await c.page.locator("main").getByRole("button").allInnerTexts()).map((s) => s.trim()),
    };
  };

  // ---- Email links switched off.
  try {
    await step(A, BU, "V1.links-off", "With email links switched off for the Portal, open the sign-in page; use Set up or reset your password, Send password setup link, follow the one-hour link, set the password, sign in.", "No Email me a sign-in link; Email and Password with Sign in; password setup works; the expired-link page offers only Back to sign-in.", async () => {
      const r = await setBusiness({ ...original, password: true, magicLink: false, sso: false });
      check(r.status === 200, `policy ${r.status}`);
      const c = await newContext();
      const v = await loginView(c);
      check(!v.buttons.includes("Email me a sign-in link") && v.buttons.includes("Sign in") && v.buttons.includes("Set up or reset your password"), v.buttons.join("|"));
      await c.page.getByRole("button", { name: "Set up or reset your password" }).click();
      await c.page.getByLabel("Email").fill(pwEmail);
      const s = Date.now();
      await c.page.getByRole("button", { name: "Send password setup link" }).click();
      await c.page.getByText(/expires in one hour/).first().waitFor({ timeout: 15000 }).catch(() => {});
      const neutral = await text(c.page.locator("main"));
      const m = await waitForLink(pwEmail, s, { subjectRe: /password/i });
      check(m?.link, "no setup email");
      const pw = `Doc030-access-${runTag}`;
      await c.page.goto(m.link);
      await c.page.getByLabel("New password").fill(pw);
      await c.page.getByLabel("Confirm password").fill(pw);
      await c.page.getByRole("button", { name: "Set password" }).click();
      await c.page.getByText("Password set").first().waitFor({ timeout: 15000 });
      await c.page.goto(`${BASE}/portal/login`);
      await c.page.getByLabel("Email").fill(pwEmail);
      await c.page.getByLabel("Password").fill(pw);
      await c.page.getByRole("button", { name: "Sign in", exact: true }).click();
      const inPortal = await c.page.waitForURL((u) => u.pathname.startsWith("/portal") && !u.pathname.startsWith("/portal/login"), { timeout: 20000 }).then(() => true, () => false);
      const landed = new URL(c.page.url()).pathname;
      const e = await newContext();
      await e.page.goto(`${BASE}/auth/link-expired?portal=1`);
      await e.page.getByText("Sign-in link expired").first().waitFor({ timeout: 15000 });
      const expBody = await text(e.page.locator("main"));
      const expSend = await e.page.getByRole("button", { name: "Send link" }).count();
      await e.page.getByRole("link", { name: "Back to sign-in" }).click();
      await e.page.waitForURL(/\/portal\/login/, { timeout: 10000 });
      await e.context.close();
      await c.context.close();
      check(inPortal && expSend === 0 && /one hour/.test(neutral), JSON.stringify({ inPortal, expSend }));
      state.pw = { email: pwEmail, password: pw };
      return { page: "/portal/login", actual: `Policy saved (email links off). Sign-in page buttons: ${v.buttons.join(", ")}. Send password setup link showed "${neutral.slice(neutral.indexOf("Check"), neutral.indexOf("Check") + 140).replace(pwEmail, "<address>")}"; "${m.subject}" arrived; Password set; Email, Password and Sign in opened ${landed}. /auth/link-expired?portal=1 read "${expBody.slice(0, 150)}" with no Send link; Back to sign-in returned to /portal/login.` };
    });
  } finally {
    await restore();
  }

  // ---- SSO-first page. No identity provider can run on this lab, so an inert provider row stands in for page rendering only.
  const providerId = `doc030-access-${runTag}`;
  try {
    sql(
      `insert into sso_providers (id, provider_id, issuer, domain, user_id, domain_verified) values ('${providerId}', '${providerId}', 'https://idp.doc030-access.invalid', 'doc030-access.invalid', '${fx.ids.daniel}', true)`,
    );
    change("sso_providers row (inert stand-in for page rendering)", null, providerId);
    await step(A, BU, "V2.sso-first", "On a page that shows Continue with single sign-on, select Email me a sign-in link; with links off, select Sign in with a password.", "Email me a sign-in link leads to Get a sign-in link; Sign in with a password leads to the password form.", async () => {
      const r1 = await setBusiness({ ...original, password: true, magicLink: true, sso: true });
      check(r1.status === 200, `policy ${r1.status} ${JSON.stringify(r1.body).slice(0, 120)}`);
      const c = await newContext();
      const v1 = await loginView(c);
      await c.page.getByRole("button", { name: "Email me a sign-in link" }).click();
      await c.page.getByText("Get a sign-in link").first().waitFor({ timeout: 10000 });
      const r2 = await setBusiness({ ...original, password: true, magicLink: false, sso: true });
      const v2 = await loginView(c);
      await c.page.getByRole("button", { name: "Sign in with a password" }).click();
      await c.page.getByLabel("Password").waitFor({ timeout: 10000 });
      const pwForm = (await c.page.getByLabel("Email").count()) > 0;
      await c.context.close();
      check(v1.buttons.includes("Continue with single sign-on") && !v2.buttons.includes("Email me a sign-in link") && v2.buttons.includes("Sign in with a password") && pwForm && r2.status === 200, JSON.stringify({ v1: v1.buttons, v2: v2.buttons }));
      return { page: "/portal/login", actual: `SSO on with links on: buttons ${v1.buttons.join(", ")}; Email me a sign-in link opened Get a sign-in link. SSO on with links off: buttons ${v2.buttons.join(", ")}; Sign in with a password opened Email and Password. Continue with single sign-on was not followed: the stand-in provider has no identity provider behind it.` };
    });
  } finally {
    await restore();
    sql(`delete from sso_providers where id='${providerId}'`);
    change("sso_providers row removed", providerId, null);
  }

  // ---- Required two-factor authentication for the Portal: links requested before the policy window keeps it short.
  const tfContext = await newContext();
  const req = async (email) => {
    const s = Date.now();
    let r;
    for (let i = 0; i < 18; i++) {
      r = await fetch(`${BASE}/api/v1/auth/magic-link`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ email, group: "business" }) });
      if (r.status !== 429) break;
      await sleep(60000);
    }
    if (r.status !== 202) throw new Error(`link request ${r.status}`);
    return (await waitForLink(email, s, { subjectRe: /Sign in/i, linkRe: /magic-link/ })).link;
  };
  // Fixture: the new address signs in once and finishes onboarding before the window.
  await portalSignIn(tfEmail, tfContext);
  await tfContext.page.getByText("Welcome to your Business Portal").first().waitFor({ timeout: 15000 }).catch(() => {});
  if (await tfContext.page.locator("#first-run-department").isVisible().catch(() => false)) {
    await tfContext.page.locator("#first-run-department").selectOption({ index: 1 });
    await sleep(500);
    await tfContext.page.getByRole("button", { name: "Continue" }).click();
    for (let i = 0; i < 8 && !(await tfContext.page.getByRole("button", { name: "Finish" }).isVisible().catch(() => false)); i++) {
      await tfContext.page.getByRole("button", { name: /Skip|Continue/ }).last().click();
      await sleep(500);
    }
    await tfContext.page.getByRole("button", { name: "Finish" }).click();
    await tfContext.page.waitForURL((u) => u.pathname.replace(/\/$/, "") === "/portal", { timeout: 20000 });
  }
  await tfContext.context.close();
  const link1 = await req(tfEmail);
  const link2 = await req(tfEmail);
  try {
    await step(A, BU, "V3.two-factor", "With two-factor required for the Portal, follow a sign-in link; set up the authenticator app; sign out; follow a new link and enter the code. Sign in with a password under the same policy.", "OpenLaw asks to set up an authenticator app before the Portal opens, then asks for a code each time; this applies to sign-in links and passwords.", async () => {
      const r = await setBusiness({ ...original, requireTwoFactor: true });
      check(r.status === 200, `policy ${r.status}`);
      const c = await newContext();
      await c.page.goto(link1);
      await c.page.waitForURL(/\/auth\/two-factor\/enroll/, { timeout: 20000 });
      const enrollUrl = new URL(c.page.url());
      const enrollText = await text(c.page.locator("main"));
      await c.page.getByRole("button", { name: "Turn on two-factor" }).click();
      const secretLine = c.page.getByText("No camera? Enter this secret manually");
      await secretLine.waitFor({ timeout: 15000 });
      const secret = (await text(secretLine)).split(":").pop().trim();
      await freshStep();
      await c.page.getByLabel("Code").fill(totp(secret));
      await c.page.getByRole("button", { name: "Confirm" }).click();
      await c.page.getByRole("link", { name: "Done" }).waitFor({ timeout: 15000 });
      await c.page.getByRole("link", { name: "Done" }).click();
      await c.page.waitForURL((u) => u.pathname.startsWith("/portal"), { timeout: 20000 });
      await settle(c.page);
      const afterEnroll = new URL(c.page.url()).pathname;
      await c.context.close();
      const c2 = await newContext();
      await c2.page.goto(link2);
      await c2.page.waitForURL(/\/auth\/two-factor/, { timeout: 20000 });
      const challengeUrl = new URL(c2.page.url());
      const challengeText = await text(c2.page.locator("main"));
      await freshStep();
      await c2.page.getByLabel("Code").fill(totp(secret));
      await c2.page.getByRole("button", { name: "Verify" }).click();
      const opened = await c2.page.waitForURL((u) => u.pathname.startsWith("/portal") && !u.pathname.startsWith("/portal/login"), { timeout: 20000 }).then(() => true, () => false);
      const landed = new URL(c2.page.url()).pathname;
      await c2.context.close();
      let pwResult = "not run (no password account from V1)";
      if (state.pw) {
        const c3 = await newContext();
        await c3.page.goto(`${BASE}/portal/login`);
        await c3.page.getByLabel("Email").fill(state.pw.email);
        await c3.page.getByLabel("Password").fill(state.pw.password);
        await c3.page.getByRole("button", { name: "Sign in", exact: true }).click();
        await c3.page.waitForURL(/\/auth\/two-factor/, { timeout: 20000 }).catch(() => {});
        const u3 = new URL(c3.page.url());
        pwResult = `${u3.pathname}${u3.search}`;
        await c3.context.close();
      }
      check(enrollUrl.pathname === "/auth/two-factor/enroll" && /requires two-factor/.test(enrollText) && challengeUrl.pathname === "/auth/two-factor" && opened && /two-factor\/enroll/.test(pwResult), JSON.stringify({ enroll: enrollUrl.pathname, challenge: challengeUrl.pathname, opened, pwResult }));
      return { page: `${enrollUrl.pathname}${enrollUrl.search}`, actual: `Policy saved (two-factor required for the Portal). The sign-in link opened ${enrollUrl.pathname}${enrollUrl.search}: "${enrollText.slice(0, 150)}". Turn on two-factor showed the QR code and manual secret; Code and Confirm showed backup codes; Done opened ${afterEnroll}. After sign-out, a second link opened ${challengeUrl.pathname}${challengeUrl.search}: "${challengeText.slice(0, 100)}"; Code and Verify opened ${landed}. A password sign-in by the V1 account under the same policy opened ${pwResult}.` };
    });
  } finally {
    await restore();
  }

  // ---- Saved logo on the sign-in page.
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGPQyt9AEmIY1TCqYfhqAABiiUkQSo+fDgAAAABJRU5ErkJggg==";
  const oldLogo = general.body?.logo ?? null;
  try {
    await step(A, BU, "V4.logo", "Open the Portal address after an Administrator saves a logo.", "The sign-in page shows the organization's name and its logo.", async () => {
      const r = await call(daniel, "PATCH", "/org/general", { logo: png });
      change("organization logo", oldLogo ? "saved logo" : null, "DOC-030 access 16x16 test logo");
      check(r.status === 200, `logo ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
      const c = await newContext();
      await loginView(c);
      const img = c.page.getByRole("img", { name: "Organization logo" });
      await img.waitFor({ timeout: 10000 });
      const main = await text(c.page.locator("main"));
      await c.context.close();
      return { page: "/portal/login", actual: `With a saved logo the page showed one Organization logo image and "${main.slice(0, 60)}".` };
    });
  } finally {
    const r = await call(daniel, "PATCH", "/org/general", { logo: oldLogo });
    change("organization logo restored", "DOC-030 access 16x16 test logo", oldLogo ? "saved logo" : null);
    if (r.status !== 200) results.settingChanges.push({ module: "signin", at: new Date().toISOString(), what: "logo restore failed", status: r.status });
  }
  const after = await methods();
  results.settingChanges.push({ module: "signin", at: new Date().toISOString(), what: "final check", policyRestored: JSON.stringify(after.policy.business) === JSON.stringify(original), ssoProviderId: after.ssoProviderId });
  save();
}
const state = {};

// ============================================================================
// Shared helpers for record pages
// ============================================================================
const NOT_FOUND = /does not exist, or you cannot open it/;
async function refused(page) {
  return NOT_FOUND.test(await text(page.locator("body")));
}
async function openRecord(page, url) {
  await go(page, url);
  const title = await h1(page);
  return { title, refused: (await refused(page)) || /not found/.test(title) };
}
async function addTeamMember(page, appletName, person) {
  const panel = await applet(page, appletName);
  const add = panel.getByRole("button", { name: "Add team member" });
  check(await add.isEnabled(), "Add team member is disabled");
  await add.click();
  const dialog = page.getByRole("dialog", { name: "Add team member" });
  await dialog.waitFor();
  const controls = await dialog.locator("select, input, [role=combobox], [role=radio]").count();
  const options = (await dialog.getByRole("combobox", { name: "Person" }).locator("option").allInnerTexts()).map((s) => s.trim());
  await dialog.getByRole("combobox", { name: "Person" }).selectOption({ label: person });
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await dialog.waitFor({ state: "hidden", timeout: 10000 });
  await panel.getByText(person, { exact: false }).first().waitFor({ timeout: 10000 });
  return { controls, options };
}
async function removeTeamMember(page, appletName, person, module) {
  const panel = await applet(page, appletName);
  const remove = panel.getByRole("button", { name: `Take ${person} off the ${module} team` });
  await remove.click();
  const confirm = page.getByRole("alertdialog");
  if (await confirm.isVisible({ timeout: 1500 }).catch(() => false))
    await confirm.getByRole("button").filter({ hasNotText: /Cancel/ }).last().click();
  await remove.waitFor({ state: "detached", timeout: 10000 });
}
async function pickPerson(page, field, person) {
  await page.getByRole("button", { name: field, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: field });
  await dialog.waitFor();
  await dialog.getByRole("button", { name: person, exact: true }).click();
  await dialog.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
  await settle(page);
  const value = (await page.getByRole("button", { name: field, exact: true }).innerText()).trim();
  check(value.includes(person), `${field} shows ${value}, not ${person}`);
}
async function legalComment(page, url, audienceLabel, body) {
  await go(page, url);
  const panel = await applet(page, "Comments");
  const group = panel.getByRole("group", { name: "Audience" });
  await group.getByText(audienceLabel, { exact: true }).click();
  check(await group.getByRole("radio", { name: audienceLabel, exact: true }).isChecked(), `${audienceLabel} not selected`);
  await panel.getByRole("textbox", { name: "New comment" }).fill(body);
  await panel.getByRole("button", { name: "Comment", exact: true }).click();
  await panel.getByText(body).waitFor({ timeout: 15000 });
  return (await text(panel.getByRole("listitem").filter({ hasText: body }).first())).replace(body, "");
}
async function portalActivity(page, entityType, entityId) {
  const r = await pageApi(page, "GET", `/portal/activity?entityType=${entityType}&entityId=${entityId}`);
  return (r.body?.entries ?? []).map((e) => ({ id: e.id, action: e.action, actor: e.actor?.displayName ?? null }));
}
async function historyPanel(page, url) {
  await go(page, url);
  const panel = await applet(page, "History");
  await sleep(800);
  return text(panel);
}
const idOf = (module, number) => sql(`select id from ${module}s where number=${number}`);

/**
 * Makes Legal changes one at a time (second actor, API) and reads the reader's Portal History after each.
 * Returns rows {what, expectedShown, newEntries, actions}.
 */
async function historyProbe({ reader, legal, module, number, typed }) {
  const id = idOf(module, number);
  const base = module === "contract" ? "contracts" : "matters";
  const tasksBase = module === "contract" ? "/tasks" : "/matter-tasks";
  const url = `/portal/${base}/${number}`;
  const rows = [];
  const cur = (await call(legal, "GET", `/${base}/${number}`)).body;
  const record = cur?.contract ?? cur?.matter ?? cur;
  let taskA = null;
  let taskB = null;
  const statuses =
    module === "contract"
      ? (await call(await admin(), "GET", "/contract-statuses")).body.contractStatuses.filter((s) => !s.archivedAt)
      : (await call(await admin(), "GET", "/matter-statuses")).body.matterStatuses.filter((s) => !s.archivedAt);
  const currentStatus = statuses.find((s) => s.id === record.statusId);
  const actions = [];
  const comment = (visibility, body) => () => call(legal, "POST", "/comments", { entityType: module, entityId: id, body, visibility });
  actions.push(["Priority change", false, () => call(legal, "PATCH", `/${base}/${number}`, { priority: record.priority === "high" ? "low" : "high" })]);
  actions.push(["Risk change", false, () => call(legal, "PATCH", `/${base}/${number}`, { risk: record.risk === "high" ? "low" : "high" })]);
  actions.push(["Legal Only comment", false, comment("legal_only", `DOC-030 access Legal Only history probe ${runTag}`)]);
  actions.push(["Working Team (Internal team) comment", false, comment("working_team", `DOC-030 access Working Team history probe ${runTag}`)]);
  if (typed) {
    actions.push(["Field kept off the Portal changed", false, () => call(legal, "PATCH", `/${base}/${number}`, { customFields: { [fx.form.hidden.key]: `DOC-030 access hidden change ${runTag}` } })]);
    actions.push(["Field with Visible on Portal changed", true, () => call(legal, "PATCH", `/${base}/${number}`, { customFields: { [fx.form.visible.key]: `DOC-030 access shown change ${runTag}` } })]);
  }
  actions.push([
    "Task added with a due date",
    true,
    async () => {
      const r = await call(legal, "POST", `/${base}/${number}/tasks`, { title: `DOC-030 access probe task A ${runTag}`, dueDate: "2026-12-15" });
      taskA = r.body?.createdTaskId;
      return r;
    },
  ]);
  actions.push([
    "Second task added",
    true,
    async () => {
      const r = await call(legal, "POST", `/${base}/${number}/tasks`, { title: `DOC-030 access probe task B ${runTag}` });
      taskB = r.body?.createdTaskId;
      return r;
    },
  ]);
  actions.push(["Task edited", false, () => call(legal, "PATCH", `${tasksBase}/${taskA}`, { title: `DOC-030 access probe task A edited ${runTag}` })]);
  actions.push([
    "Tasks reordered",
    false,
    async () => {
      const all = (await call(legal, "GET", `/${base}/${number}/tasks`)).body.tasks.map((t) => t.id);
      return call(legal, "PUT", `/${base}/${number}/tasks/reorder`, { taskIds: [...all].reverse() });
    },
  ]);
  actions.push(["Task completed", true, () => call(legal, "POST", `${tasksBase}/${taskA}/toggle`, {})]);
  actions.push(["Task removed", false, () => call(legal, "DELETE", `${tasksBase}/${taskB}`)]);
  if (module === "contract") {
    const value = record.value?.amount ?? 0;
    actions.push(["Value changed", true, () => call(legal, "PATCH", `/${base}/${number}`, { value: { amount: value + 100000, currency: "GBP", cadence: "annually" } })]);
    const newExpiry = `2029-${String((Number(runTag) % 12) + 1).padStart(2, "0")}-${record.expiryDate?.endsWith("-14") ? "15" : "14"}`;
    actions.push(["Expiry date changed", true, () => call(legal, "PATCH", `/${base}/${number}`, { expiryDate: newExpiry })]);
    const target = statuses.find((s) => s.stage !== currentStatus?.stage && s.stage === "review") ?? statuses.find((s) => s.stage !== currentStatus?.stage);
    actions.push([`Stage move to ${target.displayName} (${target.stage})`, true, () => call(legal, "PATCH", `/${base}/${number}`, { statusId: target.id, overrideSoftGate: true })]);
  } else {
    const target = statuses.find((s) => s.id !== record.statusId && s.category === "open") ?? statuses.find((s) => s.id !== record.statusId);
    actions.push([`Status move to ${target.displayName}`, true, () => call(legal, "PATCH", `/${base}/${number}`, { statusId: target.id })]);
  }
  actions.push(["Full Thread (team) comment", true, comment("full_thread", `DOC-030 access team history probe ${runTag}`)]);
  for (const [what, shown, act] of actions) {
    const before = await portalActivity(reader, module, id);
    const r = await act();
    await sleep(700);
    const after = await portalActivity(reader, module, id);
    const fresh = after.filter((e) => !before.some((b) => b.id === e.id));
    rows.push({ what, expectedShown: shown, status: r.status, newEntries: fresh.length, actions: fresh.map((e) => e.action) });
  }
  const panelText = await historyPanel(reader, url);
  // Put the record back where it was.
  await call(legal, "PATCH", `/${base}/${number}`, {
    statusId: record.statusId,
    ...(module === "contract" ? { overrideSoftGate: true } : {}),
    priority: record.priority,
    risk: record.risk ?? null,
  });
  return { rows, panelText };
}
function historyVerdict(probe) {
  const bad = probe.rows.filter((r) => r.status >= 300 || (r.expectedShown ? r.newEntries < 1 : r.newEntries !== 0));
  check(bad.length === 0, `unexpected: ${JSON.stringify(bad)}`);
  return probe.rows.map((r) => `${r.what}: ${r.expectedShown ? "shown" : "not shown"} (${r.newEntries} new${r.actions.length ? ` ${r.actions.join(",")}` : ""})`).join("; ");
}

// ============================================================================
// roles-and-access (V-C06): Administrator, Legal Team Member, Business User
// ============================================================================
async function roles() {
  const RA = "roles-and-access";
  const D = (await staff("daniel")).page;
  const N = (await staff("nadia")).page;
  const P = (await staff("priya")).page;
  const J = (await portal("jonas")).page;
  const nadiaApi = await apiSession(SEED.nadia.email);
  const CO = fx.co.number;
  const MO = fx.mo.number;
  const CC = fx.cc.number;
  const MC = fx.mc.number;
  const ENTITY = fx.entity.id;
  const runApprovals = {};

  await step(RA, "legal_team_member", "fixture.reset", "Put the roles fixture records in their starting state and create this run's approval requests (API).", "Jonas is on no fixture team; the Confidential records hold only their creator; three approval requests name Jonas.", async () => {
    const out = [];
    for (const [m, n, u] of [
      ["contracts", CO, fx.ids.jonas], ["contracts", CO, fx.ids.amara], ["contracts", CO, fx.ids.nadia],
      ["matters", MO, fx.ids.jonas],
      ["contracts", CC, fx.ids.daniel], ["contracts", CC, fx.ids.priya], ["contracts", CC, fx.ids.jonas],
      ["matters", MC, fx.ids.daniel],
    ]) out.push((await call(nadiaApi, "DELETE", `/${m}/${n}/team/${u}`)).status);
    const danielApi = await apiSession(SEED.daniel.email);
    out.push((await call(danielApi, "PATCH", `/contracts/${CO}`, { businessOwnerId: null, managerId: fx.ids.daniel })).status);
    out.push((await call(nadiaApi, "PATCH", `/contracts/${CC}`, { managerId: fx.ids.nadia })).status);
    out.push((await call(nadiaApi, "PATCH", `/matters/${MC}`, { managerId: fx.ids.nadia })).status);
    for (const [k, confidential] of [["open", false], ["confidentialPaper", true], ["withdraw", false]]) {
      const c = (await call(nadiaApi, "POST", "/contracts", { title: `DOC-030 access ${k} approval ${runTag}`, contractTypeId: fx.types.nda, managerId: fx.ids.nadia })).body.contract;
      let doc = null;
      if (k !== "withdraw") {
        doc = (await upload(nadiaApi, `/contracts/${c.number}/documents`, `doc030-access-${k}-paper-${runTag}.txt`, `DOC-030 access fictional ${k} paper.\n`)).body.document;
        if (confidential) await call(nadiaApi, "PATCH", `/documents/${doc.id}`, { isConfidential: true });
      }
      const a = (await call(nadiaApi, "POST", `/contracts/${c.number}/approvals`, { approverIds: [fx.ids.jonas] })).body;
      runApprovals[k] = { number: c.number, title: c.title, file: doc ? `doc030-access-${k}-paper-${runTag}.txt` : null, approvalId: (a.approvals ?? [a.approval ?? a])[0]?.id };
    }
    return `Reset answers: ${out.join(",")}. Approval requests naming Jonas on C-${runApprovals.open.number}, C-${runApprovals.confidentialPaper.number} (Confidential primary Document) and C-${runApprovals.withdraw.number}.`;
  });
  await step(RA, "administrator", "A1.accounts", "Open Settings > Users and a Business User's role control.", "Account types are Administrator, Legal Team Member and Business User; Contributor is no longer an account type; an Administrator can change an account to Legal Team Member.", async () => {
    await go(D, "/settings/users");
    const table = await text(D.getByRole("table").first());
    const roleButton = D.getByRole("button", { name: /change the role of ravi\.menon@helix\.example/ });
    await roleButton.click();
    await sleep(700);
    const menu = D.getByRole("menu").or(D.getByRole("listbox")).or(D.getByRole("dialog")).first();
    await menu.waitFor({ timeout: 5000 });
    const choices = await text(menu);
    await D.keyboard.press("Escape");
    check(/Legal team member/i.test(choices) && !/Contributor/i.test(table + choices), choices);
    return { page: "/settings/users", actual: `The Role column showed ${["Administrator", "Legal team member", "Business user"].filter((r) => new RegExp(r, "i").test(table)).join(", ")} and no Contributor. Ravi Menon's role control offered "${choices}". Escape closed it with no change.` };
  });
  await step(RA, "legal_team_member", "A2.settings-admin-only", "As a Legal Team Member, open Settings > Users.", "Organization settings remain Administrator-only.", async () => {
    await go(N, "/settings/users");
    const invite = await N.getByRole("button", { name: "Invite user" }).isVisible().catch(() => false);
    const r = await pageApi(N, "PATCH", "/org/general", { name: "DOC-030 access probe" });
    check(!invite && r.status === 403, `invite ${invite}, org write ${r.status}`);
    return { page: "/settings/users", actual: `Nadia at /settings/users landed on ${new URL(N.url()).pathname} with no Invite user; an organization settings write answered ${r.status}.` };
  });
  await step(RA, "legal_team_member", "B1.open-records", "Open a non-Confidential Contract and Matter without a team row.", "A Legal Team Member has full legal work on open records.", async () => {
    const c = await openRecord(N, `/contracts/${CO}`);
    const m = await openRecord(N, `/matters/${MO}`);
    check(!c.refused && !m.refused, "refused");
    return { page: `/contracts/${CO}`, actual: `Nadia (no team row) opened C-${CO} "${c.title}" and M-${MO} "${m.title}".` };
  });
  await step(RA, "administrator", "B2.admin-confidential", "Open a Confidential Contract and Matter with no team row, no Legal Owner and no Matter Manager; reload.", "Administrator status does not bypass the Confidential rule; a copied link or reload cannot restore access.", async () => {
    const c = await openRecord(D, `/contracts/${CC}`);
    await D.reload();
    await settle(D);
    const again = await refused(D);
    const m = await openRecord(D, `/matters/${MC}`);
    check(c.refused && again && m.refused, JSON.stringify({ c, again, m }));
    return { page: `/contracts/${CC}`, actual: `Daniel saw "${c.title}" / "This Contract does not exist, or you cannot open it." for C-${CC} on the copied link and after reload; M-${MC} showed "${m.title}".` };
  });
  await step(RA, "administrator", "B3.related-records", "Open the open parent Matter and the open child Contract whose parent is Confidential.", "An unreachable related record shows as Restricted contract or Restricted Matter with no link; a parent's team and Confidential flag do not pass to child Contracts.", async () => {
    await go(D, `/matters/${MO}`);
    const main = await text(D.getByRole("main"));
    const links = await D.getByRole("link", { name: new RegExp(`${fx.cc.title}|${fx.mc.title}`) }).count();
    const child = await openRecord(D, `/contracts/${fx.child.number}`);
    const cmain = await text(D.getByRole("main"));
    const parentLink = await D.getByRole("link", { name: fx.parent.title }).count();
    const jParent = await openRecord(J, `/portal/contracts/${fx.parent.number}`);
    const jChild = await openRecord(J, `/portal/contracts/${fx.child.number}`);
    check(/Restricted Matter/.test(main) && /Restricted contract/.test(main) && links === 0, main.slice(0, 300));
    check(!child.refused && /Restricted contract/.test(cmain) && parentLink === 0, cmain.slice(0, 200));
    check(!jParent.refused && jChild.refused, JSON.stringify({ jParent, jChild }));
    return { page: `/matters/${MO}`, actual: `On M-${MO} Daniel saw "Restricted Matter" for the Confidential child M-${MC} and "Restricted contract" for the linked C-${CC}, with no links to their titles. Daniel opened the open child C-${fx.child.number}; its parent (Confidential C-${fx.parent.number}) showed as "Restricted contract" with no link. Jonas, on the parent's team, opened C-${fx.parent.number} in the Portal but the child showed "${jChild.title}".` };
  });
  await step(RA, "legal_team_member", "B4.add-team-member", "As Creator and Legal Owner, open Contract team, select Add team member, choose Daniel in Person, select Add.", "Each person appears once with no role picker; the Administrator can then open the Confidential record.", async () => {
    await go(N, `/contracts/${CC}`);
    const { controls, options } = await addTeamMember(N, "Contract team", "Daniel Okafor");
    const rows = await rosterRows(await applet(N, "Contract team"));
    const c = await openRecord(D, `/contracts/${CC}`);
    check(!c.refused && controls === 1 && !options.includes("Nadia Haddad") && rows.filter((r) => r.includes("Daniel Okafor")).length === 1, JSON.stringify({ controls, options: options.length, rows }));
    return { page: `/contracts/${CC}`, actual: `The Add team member dialog had one control, Person, and no role picker; Nadia (already on the team) was not offered. Roster: ${rows.join(" | ")}. Daniel then opened C-${CC} "${c.title}".` };
  });
  await step(RA, "administrator", "B5.admin-audience", "As an Administrator who can reach the Confidential record, check the audience controls.", "An Administrator who can reach the record may change its Confidential audience.", async () => {
    await go(D, `/contracts/${CC}`);
    const add = await (await applet(D, "Contract team")).getByRole("button", { name: "Add team member" }).isEnabled();
    const sw = await D.locator("#contract-confidential").isEnabled();
    const owner = await D.getByRole("button", { name: "Legal Owner", exact: true }).isEnabled();
    check(add && sw && owner, JSON.stringify({ add, sw, owner }));
    return { page: `/contracts/${CC}`, actual: `Daniel (team row, Administrator) had Add team member, the Confidential switch and the Legal Owner control enabled on C-${CC}.` };
  });
  await step(RA, "legal_team_member", "B6.reader-no-audience-right", "Add Priya (Legal Team Member, not Creator or Legal Owner) to the team; as Priya, check the audience controls and try to name a new Legal Owner.", "Being able to read the record does not give the right to change its audience; naming a new Legal Owner is an audience change.", async () => {
    await go(N, `/contracts/${CC}`);
    await addTeamMember(N, "Contract team", "Priya Raman");
    let c = await openRecord(P, `/contracts/${CC}`);
    for (let i = 0; i < 3 && c.refused; i++) {
      await sleep(1500);
      c = await openRecord(P, `/contracts/${CC}`);
    }
    const panel = await applet(P, "Contract team");
    const add = await panel.getByRole("button", { name: "Add team member" }).isEnabled();
    const removes = await panel.getByRole("button", { name: /^Take .* off the contract team$/ }).evaluateAll((els) => els.map((e) => !e.disabled));
    const sw = await P.locator("#contract-confidential").isEnabled();
    const ownerBtn = P.getByRole("button", { name: "Legal Owner", exact: true });
    const ownerEnabled = await ownerBtn.isEnabled().catch(() => false);
    let uiTry = "Legal Owner control disabled";
    if (ownerEnabled) {
      await ownerBtn.click();
      const dialog = P.getByRole("dialog", { name: "Legal Owner" });
      await dialog.waitFor();
      await dialog.getByRole("button", { name: "Priya Raman", exact: true }).click();
      await sleep(2000);
      const alert = await text(P.getByRole("alert").first());
      await P.keyboard.press("Escape");
      await P.reload();
      await settle(P);
      uiTry = `choosing Priya Raman showed "${alert.slice(0, 160)}"; after reload the Legal Owner control read "${await text(P.getByRole("button", { name: "Legal Owner", exact: true }))}"`;
    }
    const w = await pageApi(P, "PATCH", `/contracts/${CC}`, { managerId: fx.ids.priya });
    check(!c.refused && !add && !sw && !removes.some(Boolean) && w.status >= 400, JSON.stringify({ add, sw, removes, ownerEnabled, w: w.status }));
    return { page: `/contracts/${CC}`, actual: `Priya opened C-${CC}. Add team member disabled; Confidential switch disabled; ${removes.length} remove controls, none enabled; Legal Owner control enabled ${ownerEnabled}: ${uiTry}. Naming herself Legal Owner through the record write answered ${w.status} (${JSON.stringify(w.body?.detail ?? w.body?.title ?? "").slice(0, 120)}).` };
  });
  await step(RA, "legal_team_member", "B7.remove-ends-access", "Remove Priya and Daniel with each person's remove control.", "Removal ends Confidential access on the next read.", async () => {
    await go(N, `/contracts/${CC}`);
    await removeTeamMember(N, "Contract team", "Priya Raman", "contract");
    await removeTeamMember(N, "Contract team", "Daniel Okafor", "contract");
    let d = false;
    let p = false;
    let pText = "";
    for (let i = 0; i < 3 && !(d && p); i++) {
      await sleep(1000);
      await go(D, `/contracts/${CC}`);
      await go(P, `/contracts/${CC}`);
      d = await refused(D);
      p = await refused(P);
      pText = (await text(P.locator("main"))).slice(0, 200);
    }
    check(d && p, JSON.stringify({ d, p, pText, pUrl: P.url() }));
    return { page: `/contracts/${CC}`, actual: `After Nadia removed both rows, Daniel's and Priya's reloads of C-${CC} showed "does not exist, or you cannot open it".` };
  });
  await step(RA, "legal_team_member", "B8.legal-owner", "Name Daniel Legal Owner on the Confidential Contract in Overview; then Daniel names Nadia again.", "A Legal Owner reaches a Confidential Contract without a team row; changing the owner back ends it.", async () => {
    await go(N, `/contracts/${CC}`);
    await pickPerson(N, "Legal Owner", "Daniel Okafor");
    const c = await openRecord(D, `/contracts/${CC}`);
    const rows = await rosterRows(await applet(D, "Contract team"));
    await pickPerson(D, "Legal Owner", "Nadia Haddad");
    let again = false;
    for (let i = 0; i < 3 && !again; i++) {
      await sleep(1000);
      await D.reload();
      await settle(D);
      again = await refused(D);
    }
    const n = await openRecord(N, `/contracts/${CC}`);
    check(!c.refused && again && !n.refused, JSON.stringify({ c, again }));
    return { page: `/contracts/${CC}`, actual: `After Nadia set Legal Owner to Daniel, Daniel opened C-${CC} (roster: ${rows.join(" | ")}). Daniel set Legal Owner back to Nadia; his reload was then refused and Nadia kept access.` };
  });
  await step(RA, "legal_team_member", "B9.matter-manager-and-team", "On the Confidential Matter, add and remove Daniel's team row, then name him Matter Manager and change it back.", "A team row or Matter Manager admits the person; removal ends access.", async () => {
    await go(N, `/matters/${MC}`);
    await addTeamMember(N, "Matter team", "Daniel Okafor");
    const viaTeam = await openRecord(D, `/matters/${MC}`);
    await go(N, `/matters/${MC}`);
    await removeTeamMember(N, "Matter team", "Daniel Okafor", "matter");
    await D.reload();
    await settle(D);
    const afterRemove = await refused(D);
    await go(N, `/matters/${MC}`);
    await pickPerson(N, "Matter Manager", "Daniel Okafor");
    const viaManager = await openRecord(D, `/matters/${MC}`);
    await pickPerson(D, "Matter Manager", "Nadia Haddad");
    await sleep(800);
    await D.reload();
    await settle(D);
    const afterManager = await refused(D);
    check(!viaTeam.refused && afterRemove && !viaManager.refused && afterManager, JSON.stringify({ viaTeam, afterRemove, viaManager, afterManager }));
    return { page: `/matters/${MC}`, actual: `Daniel opened M-${MC} through a team row, was refused after removal, opened it again as Matter Manager, and was refused after he named Nadia Matter Manager again.` };
  });
  await step(RA, "legal_team_member", "B10.ltm-open-removal-and-document", "Add and remove Nadia on the open Contract team; read its Confidential Document each time.", "Removing a Legal Team Member from an open record does not end ordinary access; a Document's Confidential flag narrows its audience.", async () => {
    const has = async (page) => {
      await go(page, `/contracts/${CO}/documents`);
      return (await text(page.getByRole("main"))).includes("doc030-access-confidential-note.txt");
    };
    const before = await has(N);
    await go(D, `/contracts/${CO}`);
    await addTeamMember(D, "Contract team", "Nadia Haddad");
    const onTeam = await has(N);
    await go(D, `/contracts/${CO}`);
    await removeTeamMember(D, "Contract team", "Nadia Haddad", "contract");
    const after = await openRecord(N, `/contracts/${CO}`);
    const afterDoc = await has(N);
    const danielDoc = await has(D);
    check(!after.refused && !before && onTeam && !afterDoc && danielDoc, JSON.stringify({ before, onTeam, afterDoc, danielDoc }));
    return { page: `/contracts/${CO}/documents`, actual: `The Confidential Document doc030-access-confidential-note.txt was hidden from Nadia before, shown while she was on the team, and hidden after removal; she still opened C-${CO}. Daniel (creator, Legal Owner) saw it throughout.` };
  });
  await step(RA, "administrator", "C1.entity-admin-needs-grant", "As Administrator and as a Legal Team Member without a Grant, open a Confidential Entity.", "Every person needs a Grant for a Confidential Entity; Administrators need one too.", async () => {
    const e = await openRecord(D, `/entities/${ENTITY}`);
    const p = await openRecord(P, `/entities/${ENTITY}`);
    check(e.refused && p.refused, JSON.stringify({ e, p }));
    return { page: `/entities/${ENTITY}`, actual: `Daniel saw "${e.title}" and Priya saw "${p.title}" for the Confidential Entity; neither has a Grant.` };
  });
  await step(RA, "legal_team_member", "C2.entity-grant", "As the creator, use Manage access to give Daniel a Grant, then remove it.", "The creator has a Grant; a grantee gives and removes Grants with Manage access; a Grant applies to that Entity only.", async () => {
    await go(N, `/entities/${ENTITY}`);
    await N.getByRole("button", { name: "Manage access" }).click();
    const dialog = N.getByRole("dialog", { name: "Confidential access" });
    await dialog.waitFor();
    const creator = await dialog.getByRole("button", { name: "Remove Nadia Haddad" }).waitFor({ timeout: 10000 }).then(() => true, () => false);
    const options = await dialog.getByRole("combobox", { name: "Person" }).locator("option").allInnerTexts();
    await dialog.getByRole("combobox", { name: "Person" }).selectOption({ label: "Daniel Okafor" });
    await dialog.getByRole("button", { name: "Grant access" }).click();
    await dialog.getByRole("button", { name: "Remove Daniel Okafor" }).waitFor({ timeout: 10000 });
    const e = await openRecord(D, `/entities/${ENTITY}`);
    const manage = await D.getByRole("button", { name: "Manage access" }).isVisible().catch(() => false);
    const other = await openRecord(D, `/entities/${fx.entity2.id}`);
    await dialog.getByRole("button", { name: "Remove Daniel Okafor" }).click();
    const confirm = N.getByRole("alertdialog");
    if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) await confirm.getByRole("button").last().click();
    await dialog.getByRole("button", { name: "Remove Daniel Okafor" }).waitFor({ state: "detached", timeout: 10000 });
    await N.keyboard.press("Escape");
    await D.reload();
    await settle(D);
    const after = await refused(D);
    check(creator && !e.refused && manage && other.refused && after && !options.some((o) => /Jonas|Ravi|Amara/.test(o)), JSON.stringify({ creator, e, manage, other, after }));
    return { page: `/entities/${ENTITY}`, actual: `Manage access opened Confidential access with Nadia's creator Grant listed. Person offered ${options.length - 1} staff people and no Business Users. After Grant access, Daniel opened the Entity and saw Manage access, but the second Confidential Entity still showed "${other.title}". After Remove Daniel Okafor, Daniel's reload was refused.` };
  });
  await step(RA, "legal_team_member", "C3.last-grant", "Try to remove the only Grant.", "A Confidential Entity must keep at least one active person with a Grant.", async () => {
    await go(N, `/entities/${ENTITY}`);
    await N.getByRole("button", { name: "Manage access" }).click();
    const dialog = N.getByRole("dialog", { name: "Confidential access" });
    await dialog.waitFor();
    const remove = dialog.getByRole("button", { name: "Remove Nadia Haddad" });
    const enabled = await remove.isEnabled();
    let message = "the remove control was disabled";
    if (enabled) {
      await remove.click();
      const confirm = N.getByRole("alertdialog");
      if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) await confirm.getByRole("button").last().click();
      await sleep(2000);
      message = await text(dialog.getByRole("alert").or(N.getByRole("status")).first());
    }
    await N.keyboard.press("Escape");
    const still = await openRecord(N, `/entities/${ENTITY}`);
    check(!still.refused, "Nadia lost the last Grant");
    return { page: `/entities/${ENTITY}`, actual: `Removing the only Grant was refused (${message.slice(0, 200)}); Nadia still opened the Entity.` };
  });
  await step(RA, "administrator", "C4.open-entity-manage", "Open a non-Confidential Entity as Administrator and as a Legal Team Member.", "An Administrator can manage access on an Entity that is not Confidential.", async () => {
    const [oid, oname] = sql("select id||'|'||legal_name from entities where legal_name='Helix Software Group, Inc.' and not is_confidential and archived_at is null limit 1").split("|");
    const open = { id: oid, legalName: oname };
    await go(D, `/entities/${open.id}`);
    const dm = await D.getByRole("button", { name: "Manage access" }).isVisible().catch(() => false);
    await go(N, `/entities/${open.id}`);
    const nm = await N.getByRole("button", { name: "Manage access" }).isVisible().catch(() => false);
    check(dm && !nm, JSON.stringify({ dm, nm }));
    return { page: `/entities/${open.id}`, actual: `On "${open.legalName}" Daniel saw Manage access and Nadia (no Grant) did not. No Grant was changed.` };
  });
  await step(RA, "business_user", "D1.full-app-closed", "As a Business User, open full-app records, Entities and Settings addresses.", "Business Users work through the Portal and cannot open the Entities module.", async () => {
    const seen = [];
    for (const url of [`/contracts/${CO}`, "/entities", `/entities/${ENTITY}`, "/settings/users"]) {
      await go(J, url);
      seen.push(`${url} -> ${new URL(J.url()).pathname}`);
    }
    const nav = await text(J.getByRole("navigation", { name: "Portal" }));
    const api = await pageApi(J, "GET", `/entities/${ENTITY}`);
    check(seen.every((s) => /-> \/portal/.test(s)) && !/Entities/.test(nav) && api.status >= 400, seen.join("; "));
    return { page: "/portal", actual: `${seen.join("; ")}. Portal navigation: "${nav}". An Entity read answered ${api.status}.` };
  });
  await step(RA, "business_user", "D2.not-on-team", "Open Portal addresses of records whose teams do not include the Business User.", "Business Users reach only non-archived records whose teams include them.", async () => {
    const out = [];
    for (const url of [`/portal/contracts/${CO}`, `/portal/contracts/${CC}`, `/portal/matters/${MO}`, `/portal/matters/${MC}`]) {
      const r = await openRecord(J, url);
      out.push(`${url}: ${r.title}`);
      check(r.refused, url);
    }
    return { page: "/portal/contracts", actual: out.join("; ") };
  });
  await step(RA, "business_user", "D3.conversion", "Open the Business User's converted Request address.", "At conversion the Requester becomes Business Owner and a team member; the old Request address leads to that record.", async () => {
    await go(J, `/portal/requests/${fx.jonasConverted.request}`);
    const landed = new URL(J.url()).pathname;
    const rows = await rosterRows(await applet(J, "Contract team"));
    check(landed === `/portal/contracts/${fx.jonasConverted.number}` && rows.some((r) => /Business Owner/.test(r) && r.includes("Jonas Weber")), `${landed} ${rows}`);
    return { page: landed, actual: `/portal/requests/${fx.jonasConverted.request} led to ${landed}. Contract team: ${rows.join(" | ")}.` };
  });
  await step(RA, "legal_team_member", "D4.add-business-user", "Open Contract team on the open Contract, Add team member, choose Jonas, Add.", "Adding a Business User gives them access to the record in the Portal.", async () => {
    await go(N, `/contracts/${CO}`);
    await addTeamMember(N, "Contract team", "Jonas Weber");
    const c = await openRecord(J, `/portal/contracts/${CO}`);
    check(!c.refused, c.title);
    return { page: `/portal/contracts/${CO}`, actual: `After Nadia added Jonas, he opened /portal/contracts/${CO} "${c.title}".` };
  });
  await step(RA, "business_user", "D5.comments", "As the later-added Business User, open Comments and reply.", "Business Users read and post Full Thread comments with the Contract Team label, see earlier Contract Team comments, and do not see Legal Only or older Internal team comments.", async () => {
    const reply = `DOC-030 access reply from Jonas ${runTag}`;
    await go(J, `/portal/contracts/${CO}`);
    const panel = await applet(J, "Comments");
    await sleep(1000);
    const all = await text(panel);
    const radios = await panel.getByRole("radio").count();
    const fullRow = (await text(panel.getByRole("listitem").filter({ hasText: "DOC-030 access Full thread note" }).first())).replace("DOC-030 access Full thread note", "");
    await panel.getByRole("textbox", { name: "New comment" }).fill(reply);
    await panel.getByRole("button", { name: "Comment", exact: true }).click();
    await panel.getByText(reply).waitFor({ timeout: 10000 });
    const mine = (await text(panel.getByRole("listitem").filter({ hasText: reply }).first())).replace(reply, "");
    check(all.includes("DOC-030 access Full thread note") && !all.includes("DOC-030 access Legal only note") && !all.includes("DOC-030 access Working team note") && radios === 0 && /Contract Team/.test(fullRow) && /Contract Team/.test(mine), JSON.stringify({ fullRow, mine, radios }));
    return { page: `/portal/contracts/${CO}`, actual: `Jonas, added after the three fixture comments, saw the earlier Full Thread comment ("${fullRow.slice(0, 80)}") and neither the Legal Only nor the Working Team comment; no audience picker. His reply row read "${mine.slice(0, 80)}".` };
  });
  await step(RA, "legal_team_member", "D6.legal-audience", "As Legal, open Comments on the Contract and on a Matter.", "Legal chooses Contract Team or Matter Team above New comment; Full Thread rows show Contract Team; Legal Only and older Internal team rows show those labels.", async () => {
    await go(N, `/contracts/${CO}`);
    const lp = await applet(N, "Comments");
    await lp.getByText("DOC-030 access Full thread note").waitFor({ timeout: 20000 });
    const group = lp.getByRole("group", { name: "Audience" });
    const audience = await text(group);
    const gy = (await group.boundingBox()).y;
    const ty = (await lp.getByRole("textbox", { name: "New comment" }).boundingBox()).y;
    const row = async (body) => (await text(lp.getByRole("listitem").filter({ hasText: body }).first())).replace(body, "");
    const full = await row("DOC-030 access Full thread note");
    const legal = await row("DOC-030 access Legal only note");
    const work = await row("DOC-030 access Working team note");
    await go(N, `/matters/${MO}`);
    const maud = await text((await applet(N, "Comments")).getByRole("group", { name: "Audience" }));
    check(/Legal Only/.test(audience) && /Contract Team/.test(audience) && /Matter Team/.test(maud) && gy < ty && /Contract Team/.test(full) && /Legal Only/.test(legal) && /Internal team/.test(work), JSON.stringify({ audience, maud, full, legal, work }));
    return { page: `/contracts/${CO}`, actual: `Audience above New comment offered "${audience}" on the Contract and "${maud}" on the Matter. Row labels: Full Thread "${full.slice(0, 60)}"; Legal Only "${legal.slice(0, 60)}"; older Working Team "${work.slice(0, 60)}".` };
  });
  await step(RA, "business_user", "D7.portal-history", "Legal changes the open Contract one item at a time; the Business User reads Portal History after each.", "History shows Contract Team comments, Stage moves, owners, Value, dates, Visible on Portal Fields, and Tasks added or completed; it excludes Legal Only and Internal team comments, Priority, Risk and Fields not Visible on Portal.", async () => {
    await call(nadiaApi, "PATCH", `/contracts/${CO}`, { contractTypeId: fx.form.typeA.id });
    const probe = await historyProbe({ reader: J, legal: nadiaApi, module: "contract", number: CO, typed: true });
    const verdict = historyVerdict(probe);
    const owner = await (async () => {
      const before = await portalActivity(J, "contract", fx.co.id);
      const r = await call(nadiaApi, "PATCH", `/contracts/${CO}`, { managerId: fx.ids.nadia });
      await sleep(700);
      const after = await portalActivity(J, "contract", fx.co.id);
      await call(nadiaApi, "PATCH", `/contracts/${CO}`, { managerId: fx.ids.daniel });
      return { status: r.status, fresh: after.filter((e) => !before.some((b) => b.id === e.id)).length };
    })();
    check(owner.fresh >= 1, `Legal Owner change not shown: ${JSON.stringify(owner)}`);
    await J.screenshot({ path: path.join(here, "roles-portal-history.png") });
    return { page: `/portal/contracts/${CO}`, actual: `${verdict}; Legal Owner change: shown (${owner.fresh} new). Portal History panel: "${probe.panelText.slice(0, 700)}". See roles-portal-history.png.` };
  });
  await step(RA, "business_user", "D8.no-legal-controls", "Look for Field, Task, Key date, approval request and signing controls on the Portal record.", "The Portal record has no controls for Fields, Tasks, Key dates, approval requests or signing.", async () => {
    await go(J, `/portal/contracts/${CO}`);
    const main = await text(J.getByRole("main"));
    const buttons = (await J.getByRole("main").getByRole("button").allInnerTexts()).map((s) => s.trim()).filter(Boolean);
    const bad = buttons.filter((b) => /Task|Key date|Approv|Sign|Edit|Stage|Status|Move/i.test(b) && !/\.(txt|pdf)$/.test(b));
    const inputs = await J.getByRole("main").locator("input:not([type=file]):not([type=search]), textarea, select").evaluateAll((els) => els.filter((e) => !e.closest("[role=search]") && !e.closest("form[role=search]") && e.getAttribute("aria-label") !== "Search Documents").map((e) => e.getAttribute("aria-label") ?? e.id));
    check(bad.length === 0 && inputs.length === 0 && !/Key dates|Send for signature/.test(main), JSON.stringify({ bad, inputs }));
    return { page: `/portal/contracts/${CO}`, actual: `No Field inputs (${inputs.length}), no Task, Key date, approval or signing controls; main buttons were: ${[...new Set(buttons)].slice(0, 20).join(", ")}.` };
  });
  await step(RA, "business_user", "D9.portal-team-add", "In the Portal, open Contract team, Add team member, choose an existing person, Add.", "Business Users may add existing people from the Portal on non-Confidential records; there is no remove control.", async () => {
    await go(J, `/portal/contracts/${CO}`);
    const { options } = await addTeamMember(J, "Contract team", "Amara Nwosu");
    const panel = await applet(J, "Contract team");
    const removes = await panel.getByRole("button", { name: /off the/ }).count();
    await go(N, `/contracts/${CO}`);
    const legalRows = await rosterRows(await applet(N, "Contract team"));
    await removeTeamMember(N, "Contract team", "Amara Nwosu", "contract");
    check(legalRows.some((r) => r.includes("Amara Nwosu")) && !options.includes("Jonas Weber") && removes === 0, legalRows.join("|"));
    return { page: `/portal/contracts/${CO}`, actual: `Jonas added Amara Nwosu (existing members were not offered); no remove control in the Portal. Nadia saw Amara on the same team in the full app and removed her.` };
  });
  await step(RA, "legal_team_member", "D10.business-owner", "On Overview, assign Amara as Business Owner; try to remove her; change the Business Owner; remove her; then clear the Business Owner.", "Assigning a Business Owner adds that person to the team; change or clear the Business Owner before removing them; reassignment leaves the former owner on the team; removal ends Business User access on the next read, including old links, replies and Documents.", async () => {
    const A = (await portal("amara")).page;
    await go(N, `/contracts/${CO}`);
    await pickPerson(N, "Business Owner", "Amara Nwosu");
    const rows1 = await rosterRows(await applet(N, "Contract team"));
    const removeCtl = await (await applet(N, "Contract team")).getByRole("button", { name: "Take Amara Nwosu off the contract team" }).count();
    const refusedRemove = await call(nadiaApi, "DELETE", `/contracts/${CO}/team/${fx.ids.amara}`);
    const aOpen = await openRecord(A, `/portal/contracts/${CO}`);
    const aRows = await rosterRows(await applet(A, "Contract team"));
    await go(N, `/contracts/${CO}`);
    await pickPerson(N, "Business Owner", "Jonas Weber");
    const rows2 = await rosterRows(await applet(N, "Contract team"));
    await removeTeamMember(N, "Contract team", "Amara Nwosu", "contract");
    await A.reload();
    await settle(A);
    const aAfter = /not found/.test(await h1(A));
    const aDocs = await pageApi(A, "GET", `/portal/contracts/${CO}/documents`);
    const aReply = await pageApi(A, "POST", "/comments", { entityType: "contract", entityId: fx.co.id, body: "DOC-030 access late reply", visibility: "full_thread" });
    await go(N, `/contracts/${CO}`);
    await pickPerson(N, "Business Owner", "Unassigned");
    const rows3 = await rosterRows(await applet(N, "Contract team"));
    check(rows1.some((r) => /Business Owner/.test(r) && r.includes("Amara Nwosu")) && removeCtl === 0 && refusedRemove.status === 409 && !aOpen.refused, JSON.stringify({ rows1, removeCtl, refusedRemove: refusedRemove.status }));
    check(rows2.some((r) => r.includes("Amara Nwosu")) && aAfter && aDocs.status >= 400 && aReply.status >= 400 && rows3.some((r) => r.includes("Jonas Weber")), JSON.stringify({ rows2, aAfter, aDocs: aDocs.status, aReply: aReply.status, rows3 }));
    return { page: `/contracts/${CO}`, actual: `Setting Business Owner to Amara added her row: ${rows1.join(" | ")}. Her row had no remove control, and a direct removal answered ${refusedRemove.status} "${refusedRemove.body?.detail}". Amara opened C-${CO} in the Portal (her roster: ${aRows.join(" | ")}). After Business Owner changed to Jonas, Amara stayed on the team (${rows2.join(" | ")}). Nadia then removed her; Amara's reload of the old link showed Contract not found, a Documents read answered ${aDocs.status} and a reply answered ${aReply.status}. Business Owner cleared to Unassigned; Jonas kept his team row (${rows3.join(" | ")}).` };
  });
  await step(RA, "business_user", "D11.matter-team-and-status", "Legal adds Jonas to the open Matter and posts with Matter Team and Legal Only; Legal moves its Status.", "A Full Thread comment shows Matter Team; Legal Only stays hidden; the Status move appears in Portal History; linked and child Confidential records stay closed.", async () => {
    await go(N, `/matters/${MO}`);
    await addTeamMember(N, "Matter team", "Jonas Weber");
    const team = await legalComment(N, `/matters/${MO}`, "Matter Team", `DOC-030 access Matter Team note ${runTag}`);
    const legal = await legalComment(N, `/matters/${MO}`, "Legal Only", `DOC-030 access Matter Legal Only note ${runTag}`);
    const probe = await historyProbe({ reader: J, legal: nadiaApi, module: "matter", number: MO, typed: false });
    const verdict = historyVerdict(probe);
    await go(J, `/portal/matters/${MO}`);
    const jc = await applet(J, "Comments");
    await jc.getByText(`DOC-030 access Matter Team note ${runTag}`).waitFor({ timeout: 15000 });
    const jText = await text(jc);
    const jRow = (await text(jc.getByRole("listitem").filter({ hasText: `DOC-030 access Matter Team note ${runTag}` }).first())).replace(`DOC-030 access Matter Team note ${runTag}`, "");
    const main = await text(J.getByRole("main"));
    const c = await openRecord(J, `/portal/contracts/${CC}`);
    const child = await openRecord(J, `/portal/matters/${MC}`);
    check(/Matter Team/.test(team) && /Legal Only/.test(legal) && /Matter Team/.test(jRow) && !jText.includes(`Matter Legal Only note ${runTag}`) && c.refused && child.refused && !main.includes(fx.cc.title) && !main.includes(fx.mc.title), JSON.stringify({ team, legal, jRow }));
    return { page: `/portal/matters/${MO}`, actual: `Nadia's rows: "${team.slice(0, 50)}" and "${legal.slice(0, 50)}". Jonas saw the Matter Team comment ("${jRow.slice(0, 60)}") and not the Legal Only one. Matter History probe: ${verdict}. Linked C-${CC} showed "${c.title}" and child M-${MC} showed "${child.title}"; the Matter page named neither.` };
  });
  await step(RA, "business_user", "D12.confidential-portal", "Legal adds Jonas to the Confidential Contract; Jonas opens Contract team; Legal removes him.", "A Business User needs a team row on a Confidential record; Portal team changes on Confidential records stay with Legal.", async () => {
    await go(N, `/contracts/${CC}`);
    await addTeamMember(N, "Contract team", "Jonas Weber");
    const c = await openRecord(J, `/portal/contracts/${CC}`);
    const panel = await applet(J, "Contract team");
    const add = await panel.getByRole("button", { name: "Add team member" }).isEnabled();
    const note = await text(panel);
    await go(N, `/contracts/${CC}`);
    await removeTeamMember(N, "Contract team", "Jonas Weber", "contract");
    await J.reload();
    await settle(J);
    const after = /not found/.test(await h1(J));
    check(!c.refused && !add && /Ask Legal to add members to a Confidential record/.test(note) && after, note);
    return { page: `/portal/contracts/${CC}`, actual: `With a team row Jonas opened C-${CC}; Add team member was disabled with "Ask Legal to add members to a Confidential record." After removal his reload showed Contract not found.` };
  });
  await step(RA, "business_user", "D13.approval-exception", "Open Approvals in the Portal; open a request; open one whose primary Document is Confidential; Legal withdraws one request and archives one Contract.", "The request shows the Contract title and current primary Document, no team row, comments, Fields or other Documents; a Confidential primary Document is not shown to an approver off the team; withdrawal or archiving ends access.", async () => {
    await go(J, "/portal");
    await J.getByRole("navigation", { name: "Portal" }).getByRole("link", { name: "Approvals" }).click();
    await J.getByRole("heading", { name: "Your approvals" }).waitFor({ timeout: 15000 });
    await settle(J);
    const list = await text(J.getByRole("main"));
    const listed = ["open", "confidentialPaper", "withdraw"].every((k) => list.includes(runApprovals[k].title));
    await go(J, `/portal/approvals/${runApprovals.open.approvalId}`);
    const packet = await text(J.getByRole("main"));
    const toolbar = await J.getByRole("toolbar", { name: "Applets" }).count();
    const direct = await openRecord(J, `/portal/contracts/${runApprovals.open.number}`);
    await go(J, `/portal/approvals/${runApprovals.confidentialPaper.approvalId}`);
    const cpacket = await text(J.getByRole("main"));
    const wd = await call(nadiaApi, "DELETE", `/approvals/${runApprovals.withdraw.approvalId}`);
    const ar = await call(nadiaApi, "POST", `/contracts/${runApprovals.confidentialPaper.number}/archive`, {});
    await go(J, "/portal/approvals");
    const list2 = await text(J.getByRole("main"));
    await go(J, `/portal/approvals/${runApprovals.withdraw.approvalId}`);
    const wdPage = await text(J.getByRole("main"));
    const rs = await call(nadiaApi, "POST", `/contracts/${runApprovals.confidentialPaper.number}/restore`, {});
    check(listed && packet.includes(runApprovals.open.title) && packet.includes(runApprovals.open.file) && toolbar === 0 && !/Fields|Comments|Contract team/.test(packet) && direct.refused, packet.slice(0, 300));
    check(/No document attached/.test(cpacket) && !cpacket.includes(runApprovals.confidentialPaper.file), cpacket.slice(0, 300));
    check(wd.status < 300 && ar.status < 300 && !list2.includes(runApprovals.withdraw.title) && !list2.includes(runApprovals.confidentialPaper.title), JSON.stringify({ wd: wd.status, ar: ar.status }));
    return { page: "/portal/approvals", actual: `Your approvals (Pending) listed the three DOC-030 access requests created for this run naming Jonas. The open request read "${packet.slice(0, 260)}" with no applet bar, Fields, comments or team; /portal/contracts/${runApprovals.open.number} showed "${direct.title}". The request whose primary Document is Confidential read "${cpacket.slice(0, 200)}". Legal withdrew one request (${wd.status}) and archived the other Contract (${ar.status}); both left Your approvals, and the withdrawn request's address read "${wdPage.slice(0, 120)}". Legal restored the Contract afterwards (${rs.status}).` };
  });
  await step(RA, "business_user", "D14.archived-request", "Legal archives the converted Contract; the Business User opens Your Contracts, the record link and the old Request link.", "An archived record leaves the Portal; the old Request link shows the original ask and an archived notice, without Documents or a conversation.", async () => {
    const n = fx.jonasConverted.number;
    const ar = await call(nadiaApi, "POST", `/contracts/${n}/archive`, {});
    await go(J, "/portal/contracts");
    await J.getByRole("searchbox", { name: "Search Contracts" }).fill(`C-${n}`);
    await J.getByRole("searchbox", { name: "Search Contracts" }).press("Enter");
    await settle(J);
    const list = await text(J.getByRole("main"));
    const direct = await openRecord(J, `/portal/contracts/${n}`);
    await go(J, `/portal/requests/${fx.jonasConverted.request}`);
    const main = await text(J.getByRole("main"));
    const docs = await J.getByRole("region", { name: "Documents" }).count();
    const comments = (await J.getByRole("textbox", { name: "New comment" }).count()) + (await J.getByRole("toolbar", { name: "Applets" }).count());
    const rs = await call(nadiaApi, "POST", `/contracts/${n}/restore`, {});
    check(ar.status < 300 && !new RegExp(`\\bC-${n}\\b`).test(list) && direct.refused && /archived/.test(main) && main.includes("DOC-030 access fictional ask from Jonas") && docs === 0 && comments === 0, main.slice(0, 300));
    return { page: `/portal/requests/${fx.jonasConverted.request}`, actual: `Legal archived C-${n} (${ar.status}). Your Contracts no longer listed it; its link showed "${direct.title}". The old Request link read "${main.slice(0, 260)}" with no Documents and no comment controls. Legal restored C-${n} (${rs.status}).` };
  });
}

// A one-page fictional PDF for the preview check.
function tinyPdf(line) {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 12 Tf 20 70 Td (${line}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

// ============================================================================
// contributor-guide (V-C25): Business User Ravi
// ============================================================================
async function contributor() {
  const CG = "contributor-guide";
  const BU = "business_user";
  const N = (await staff("nadia")).page;
  const R = (await portal("ravi")).page;
  const nadiaApi = await apiSession(SEED.nadia.email);
  const CR = fx.raviConverted.number;
  const CRid = idOf("contract", CR);
  const MR = fx.mr.number;
  const MX = fx.mx.number;
  const DM = fx.dm.number;
  const tmp = path.join((await import("node:os")).tmpdir(), `doc030-access-${runTag}`);
  const { mkdirSync, writeFileSync: wf } = await import("node:fs");
  mkdirSync(tmp, { recursive: true });
  const file = (name, body) => {
    const p = path.join(tmp, name);
    wf(p, body);
    return p;
  };

  await step(CG, "legal_team_member", "fixture.reset", "Put Ravi's fixture records in their starting state (API).", "Ravi is on the converted Contract team and absent from the Matter and comparable records.", async () => {
    const out = [];
    for (const [m, n, u] of [["matters", MR, fx.ids.ravi], ["matters", MR, fx.ids.amara], ["matters", fx.mc.number, fx.ids.ravi]]) out.push((await call(nadiaApi, "DELETE", `/${m}/${n}/team/${u}`)).status);
    out.push((await call(nadiaApi, "POST", `/matters/${MR}/restore`, {})).status);
    const open = (await call(await admin(), "GET", "/matter-statuses")).body.matterStatuses.find((s) => s.slug === "open");
    out.push((await call(nadiaApi, "PATCH", `/matters/${MR}`, { statusId: open.id, confirmReopen: true })).status);
    return `Reset answers: ${out.join(",")}.`;
  });

  await step(CG, BU, "G1.before-start", "Before Legal adds Ravi, open the Matter; after Legal adds him with Matter team, select Matters in the Portal navigation bar and choose the record; check the title and M- reference; check the converted Contract's team.", "The record opens only after Legal adds him; being Business Owner adds you to the team; a copied link to a comparable record does not grant access.", async () => {
    const before = await openRecord(R, `/portal/matters/${MR}`);
    await go(N, `/matters/${MR}`);
    await addTeamMember(N, "Matter team", "Ravi Menon");
    await go(R, "/portal");
    await R.getByRole("navigation", { name: "Portal" }).getByRole("link", { name: "Matters" }).click();
    await settle(R);
    await R.getByRole("link", { name: fx.mr.title }).click();
    await settle(R);
    const title = await h1(R);
    const main = await text(R.getByRole("main"));
    const comparable = await openRecord(R, `/portal/matters/${MX}`);
    await go(R, `/portal/contracts/${CR}`);
    const rows = await rosterRows(await applet(R, "Contract team"));
    check(before.refused && title === fx.mr.title && main.includes(`M-${MR}`) && comparable.refused && rows.some((r) => /Business Owner/.test(r) && r.includes("Ravi Menon")), JSON.stringify({ before, title, comparable, rows }));
    return { page: `/portal/matters/${MR}`, actual: `Before: "${before.title}". After Nadia added Ravi through Matter team, Matters listed the record; it showed "${title}" and M-${MR}. The comparable M-${MX} showed "${comparable.title}". On his converted C-${CR} the team read: ${rows.join(" | ")}.` };
  });
  await step(CG, BU, "G2.search", "Enter a title or reference in Search, press Enter or select Search; search Contracts by the primary Counterparty.", "Search matches title and reference; Contract search also matches the primary Counterparty.", async () => {
    await go(R, "/portal/matters");
    const box = R.getByRole("searchbox", { name: "Search Matters" });
    await box.fill("DOC-030 access Ravi");
    await box.press("Enter");
    await settle(R);
    const byTitle = await text(R.getByRole("table"));
    await box.fill(`M-${MR}`);
    await R.getByRole("search", { name: "Search Matters" }).getByRole("button", { name: "Search", exact: true }).click();
    await settle(R);
    const byRef = await text(R.getByRole("table"));
    await go(R, "/portal/contracts");
    const cbox = R.getByRole("searchbox", { name: "Search Contracts" });
    await cbox.fill("Fictional Supplier");
    await cbox.press("Enter");
    await settle(R);
    const byCp = await text(R.getByRole("table"));
    check(byTitle.includes(`M-${MR}`) && byRef.includes(`M-${MR}`) && !byRef.includes(`M-${DM}`) && byCp.includes(`C-${CR}`), JSON.stringify({ byTitle, byRef, byCp }).slice(0, 400));
    return { page: "/portal/matters", actual: `"DOC-030 access Ravi" + Enter listed M-${MR}; "M-${MR}" + Search listed only M-${MR}; Contracts search "Fictional Supplier" listed C-${CR} through its primary Counterparty.` };
  });
  await step(CG, BU, "G3.filter", "Select Filter, choose a property and value, select Apply; combine with search; remove a chip or use Clear all.", "Contracts offer Stage, Type, Legal Owner and Expiry date; Matters offer Status, Type, Matter Manager and open or closed lifecycle.", async () => {
    await go(R, "/portal/contracts");
    await R.getByRole("button", { name: "Filter", exact: true }).click();
    const cprops = (await R.getByRole("dialog", { name: "Filter" }).getByRole("button").allInnerTexts()).map((s) => s.trim());
    await R.keyboard.press("Escape");
    await go(R, "/portal/matters");
    await R.getByRole("button", { name: "Filter", exact: true }).click();
    const fd = R.getByRole("dialog", { name: "Filter" });
    const mprops = (await fd.getByRole("button").allInnerTexts()).map((s) => s.trim());
    await fd.getByRole("button", { name: "Lifecycle" }).click();
    await sleep(500);
    const life = await text(R.getByRole("dialog").last());
    await R.getByRole("dialog").last().getByText("Open", { exact: true }).first().click();
    await R.getByRole("dialog").last().getByRole("button", { name: "Apply" }).click();
    await settle(R);
    const box = R.getByRole("searchbox", { name: "Search Matters" });
    await box.fill("DOC-030 access");
    await box.press("Enter");
    await settle(R);
    const chips = await R.getByRole("button", { name: /Remove .* filter/ }).count();
    const url = new URL(R.url()).search;
    await R.getByRole("button", { name: "Clear all" }).click();
    await settle(R);
    const cleared = await R.getByRole("button", { name: /Remove .* filter/ }).count();
    check(["Type", "Legal Owner", "Stage", "Expiry date"].every((p) => cprops.includes(p)) && ["Type", "Matter Manager", "Status", "Lifecycle"].every((p) => mprops.includes(p)) && chips === 1 && cleared === 0, JSON.stringify({ cprops, mprops, chips, cleared }));
    return { page: "/portal/matters", actual: `Contracts Filter offered ${cprops.join(", ")}; Matters Filter offered ${mprops.join(", ")}. Lifecycle showed "${life.slice(0, 80)}". Lifecycle Open with search "DOC-030 access" gave one chip (address ${url}); Clear all removed it.` };
  });
  await step(CG, BU, "G4.sort-columns-more", "Select a column heading to sort; use Columns; drag a heading's edge; Show more; Back and a bookmark.", "Sorting cycles ascending, descending and default; Columns chooses and reorders; the edge resizes; Show more adds a page; the address keeps search, filters and sort.", async () => {
    await go(R, "/portal/contracts");
    const rowsBefore = await R.getByRole("table").getByRole("row").count();
    await R.getByRole("button", { name: "Show more" }).click();
    await settle(R);
    const rowsAfter = await R.getByRole("table").getByRole("row").count();
    const heading = R.getByRole("columnheader", { name: "Title" }).getByRole("button", { name: "Title" });
    const sorts = [];
    for (let i = 0; i < 3; i++) {
      await heading.click();
      await settle(R);
      sorts.push(`${await R.getByRole("columnheader", { name: "Title" }).getAttribute("aria-sort")} ${new URL(R.url()).search || "(no query)"}`);
    }
    await heading.click();
    await settle(R);
    const bookmarked = R.url();
    await R.locator("main table a[href*='/portal/contracts/']").first().click();
    await settle(R);
    await R.goBack();
    await settle(R);
    const back = R.url();
    await R.getByRole("button", { name: "Columns" }).click();
    await sleep(500);
    const colText = await text(R.getByRole("dialog").or(R.getByRole("menu")).last());
    await R.keyboard.press("Escape");
    const sep = R.getByRole("separator", { name: "Width of the Reference column" });
    const w0 = (await R.getByRole("columnheader", { name: "Reference" }).boundingBox()).width;
    const sb = await sep.boundingBox();
    await R.mouse.move(sb.x + 2, sb.y + sb.height / 2);
    await R.mouse.down();
    await R.mouse.move(sb.x + 60, sb.y + sb.height / 2, { steps: 6 });
    await R.mouse.move(sb.x + 120, sb.y + sb.height / 2, { steps: 6 });
    await R.mouse.up();
    await sleep(400);
    const w1 = (await R.getByRole("columnheader", { name: "Reference" }).boundingBox()).width;
    await sep.focus();
    await R.keyboard.press("Home");
    await go(R, bookmarked.replace(BASE, ""));
    const reopened = await R.getByRole("columnheader", { name: "Title" }).getAttribute("aria-sort");
    check(rowsAfter > rowsBefore && /sort=/.test(sorts[0]) && /sort=/.test(sorts[1]) && !/sort=/.test(sorts[2]) && back === bookmarked && Math.abs(w1 - w0) > 40 && /Title|Reference/.test(colText), JSON.stringify({ rowsBefore, rowsAfter, sorts, back, bookmarked, w0, w1 }));
    return { page: "/portal/contracts", actual: `Your Contracts rows ${rowsBefore - 1} -> ${rowsAfter - 1} after Show more. Title heading: ${sorts.join(" -> ")}. Back from a record returned to ${new URL(back).search}; reopening the bookmarked address kept aria-sort ${reopened}. Columns showed "${colText.slice(0, 140)}". Dragging the Reference edge changed its width ${Math.round(w0)} -> ${Math.round(w1)} px.` };
  });
  await step(CG, BU, "G5.read-record", "Read the record details and Fields on the Contract and the Matter; look for edit controls; Legal changes a Visible on Portal Field and the Description; reload.", "Department and Region on both; Overview with Value and dates; Visible on Portal Field Rows and Description are read-only; a Row off the Portal is absent; a Row under a false Branch is listed as Not recorded; Legal's change appears on reload; Original request does not change.", async () => {
    await go(R, `/portal/matters/${MR}`);
    const mMain = await text(R.getByRole("main"));
    await go(R, `/portal/contracts/${CR}`);
    const overview = await text(R.getByRole("region", { name: "Overview" }));
    const fields = R.getByRole("region", { name: "Fields" });
    const fText = await text(fields);
    const editable = await R.getByRole("main").locator("input:not([type=file]):not([type=search]), textarea, select, [contenteditable=true]").evaluateAll((els) => els.filter((e) => !e.closest("[role=search]") && !e.closest("form[role=search]") && e.getAttribute("aria-label") !== "Search Documents").map((e) => e.getAttribute("aria-label") ?? e.tagName));
    const newValue = `DOC-030 access Legal update ${runTag}`;
    await call(nadiaApi, "PATCH", `/contracts/${CR}`, { customFields: { [fx.form.visible.key]: newValue }, description: `DOC-030 access live description ${runTag}` });
    await R.reload();
    await settle(R);
    const fAfter = await text(R.getByRole("region", { name: "Fields" }));
    const main = await text(R.getByRole("main"));
    const original = main.slice(main.indexOf("Original request"));
    await go(R, `/portal/contracts/${fx.cr2.number}`);
    const cr2Fields = await text(R.getByRole("region", { name: "Fields" }));
    const branchRow = fText.slice(fText.indexOf(fx.form.branch.name), fText.indexOf(fx.form.branch.name) + fx.form.branch.name.length + 20);
    check(/Department/.test(mMain) && /Region/.test(mMain) && !/Original request/.test(mMain) && /Department/.test(overview) && /Region/.test(overview) && /Value/.test(overview) && /Effective date/.test(overview) && /Expiry date/.test(overview), overview);
    check(fText.includes(fx.form.visible.name) && !fText.includes(fx.form.hidden.name) && fText.includes(fx.form.gate.name) && /Not recorded/.test(branchRow) && editable.length === 0, JSON.stringify({ fText, editable }));
    check(fAfter.includes(newValue) && fAfter.includes(`DOC-030 access live description ${runTag}`) && original.includes("DOC-030 access fictional ask from Ravi.") && !cr2Fields.includes(fx.form.visible.name), JSON.stringify({ original: original.slice(0, 200), cr2Fields }));
    return { page: `/portal/contracts/${CR}`, actual: `M-${MR} showed Department and Region and no Original request (it started without a Request). C-${CR} Overview: "${overview.slice(0, 260)}". Fields: "${fText.slice(0, 400)}". The Visible field and the Gate (No) were listed; the Hidden field was absent; the Branch field was listed as "${branchRow}" although the Gate is No. No editable controls in the record (${editable.length}); Business Users cannot edit any Field. After Nadia changed the Visible field and the Description, Ravi's reload showed both, and Original request still read "${original.slice(0, 160)}". On C-${fx.cr2.number} (the second type, where the same Field's Row is off the Portal) Fields read "${cr2Fields.slice(0, 160)}".` };
  });
  await step(CG, BU, "G6.documents-read", "Read Documents: order, row facts, kind for a Version of an Administrator-added type; select a name to preview; download.", "The Primary Document comes first; each row shows current Version, kind, uploader and date; a Version of an Administrator-added type reads General; the name opens a preview; the download control downloads.", async () => {
    const pdf = await upload(nadiaApi, `/contracts/${CR}/documents`, `doc030-access-preview-${runTag}.pdf`, tinyPdf("DOC-030 access fictional preview paper"), "application/pdf", { documentTypeId: fx.docType.id });
    check(pdf.status === 201, `pdf ${pdf.status} ${JSON.stringify(pdf.body).slice(0, 200)}`);
    await go(R, `/portal/contracts/${CR}`);
    const region = R.getByRole("region", { name: "Documents" });
    const rows = (await region.getByRole("listitem").allInnerTexts()).map((t) => t.replace(/\s+/g, " "));
    const pdfRow = rows.find((r) => r.includes(`doc030-access-preview-${runTag}.pdf`)) ?? "";
    let viewerText = "";
    let rendered = 0;
    for (let i = 0; i < 10; i++) {
      await region.getByRole("button", { name: `doc030-access-preview-${runTag}.pdf` }).first().click();
      const viewer = R.getByRole("complementary", { name: new RegExp(`doc030-access-preview-${runTag}\\.pdf`) });
      await viewer.waitFor({ timeout: 15000 });
      await sleep(2500);
      viewerText = await text(viewer);
      rendered = await viewer.locator("canvas, img, iframe, embed, object").count();
      if (rendered && !/Preparing|processing/i.test(viewerText)) break;
      await viewer.getByRole("button", { name: "Close the document" }).click();
      await sleep(4000);
      await R.reload();
      await settle(R);
    }
    await R.screenshot({ path: path.join(here, "contributor-portal-preview.png") });
    await R.getByRole("complementary", { name: new RegExp(`doc030-access-preview-${runTag}\\.pdf`) }).getByRole("button", { name: "Close the document" }).click();
    const href = await region.getByRole("link", { name: /Download doc030-access-supporting-v1\.txt, version \d+/ }).first().getAttribute("href");
    const dl = await R.request.get(new URL(href, BASE).toString());
    check(/^Primary Document doc030-access-supporting-v1\.txt/.test(rows[0]) && /Version 1/.test(pdfRow) && /General/.test(pdfRow) && /Nadia Haddad/.test(pdfRow) && rendered > 0 && dl.status() === 200, JSON.stringify({ first: rows[0], pdfRow, rendered }));
    return { page: `/portal/contracts/${CR}`, actual: `First row: "${rows[0].slice(0, 140)}". The PDF uploaded by Legal with the Administrator-added type "${fx.docType.name}" read "${pdfRow.slice(0, 160)}" (kind General). Its name opened the viewer with ${rendered} rendered page element(s); see contributor-portal-preview.png. The download control answered ${dl.status()}.` };
  });
  await step(CG, BU, "G7.upload-contract", "Select Upload documents; choose New documents under Add as; choose Kind; enter Note (optional); Upload two files with one failure; Retry failed uploads.", "Kind starts on General and offers the six fixed Contract types; Kind and Note apply to every file; Legal sees the Kind as the Version's Document type and General as no type; Retry failed uploads retries only the failures.", async () => {
    const f1 = file(`doc030-access-business-upload-${runTag}.txt`, "DOC-030 access fictional business upload.\n");
    const f2 = file(`doc030-access-second-upload-${runTag}.txt`, "DOC-030 access fictional second upload.\n");
    const f3 = file(`doc030-access-general-upload-${runTag}.txt`, "DOC-030 access fictional general upload.\n");
    await go(R, `/portal/contracts/${CR}`);
    let failed = false;
    let posts = 0;
    await R.route(`**/api/v1/contracts/${CR}/documents`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      posts++;
      const body = route.request().postDataBuffer()?.toString("latin1") ?? "";
      if (!failed && body.includes(`doc030-access-second-upload-${runTag}.txt`)) {
        failed = true;
        return route.fulfill({ status: 503, contentType: "application/problem+json", body: JSON.stringify({ title: "Injected failure", status: 503, detail: "DOC-030 injected upload failure." }) });
      }
      return route.continue();
    });
    await R.getByRole("button", { name: "Upload documents" }).click();
    const dialog = R.getByRole("dialog", { name: "Upload documents" });
    await dialog.waitFor();
    const addAs = await dialog.getByRole("combobox", { name: "Add as" }).locator("option").allInnerTexts();
    await dialog.getByRole("combobox", { name: "Add as" }).selectOption({ label: "New documents" });
    await dialog.locator("input[type=file]").setInputFiles([f1, f2]);
    const kind = dialog.getByRole("combobox", { name: "Kind" });
    const kindDefault = await kind.evaluate((s) => s.options[s.selectedIndex].text);
    const kinds = await kind.locator("option").allInnerTexts();
    await kind.selectOption({ label: "Draft · theirs" });
    await dialog.getByRole("textbox", { name: "Note (optional)" }).fill(`DOC-030 access business note ${runTag}`);
    await dialog.getByRole("button", { name: "Upload", exact: true }).click();
    await dialog.getByRole("button", { name: "Retry failed uploads" }).waitFor({ timeout: 20000 });
    const mid = await text(dialog);
    await dialog.getByRole("button", { name: "Retry failed uploads" }).click();
    await dialog.waitFor({ state: "hidden", timeout: 20000 });
    await R.unroute(`**/api/v1/contracts/${CR}/documents`);
    await settle(R);
    await R.getByRole("button", { name: "Upload documents" }).click();
    await dialog.waitFor();
    await dialog.locator("input[type=file]").setInputFiles([f3]);
    await dialog.getByRole("button", { name: "Upload", exact: true }).click();
    await dialog.waitFor({ state: "hidden", timeout: 20000 });
    await settle(R);
    const staffDocs = (await call(nadiaApi, "GET", `/contracts/${CR}/documents`)).body;
    const list = staffDocs.documents ?? staffDocs.items ?? [];
    const find = (n) => list.find((d) => d.title === n || d.versions?.[0]?.originalFilename === n);
    const d1 = find(`doc030-access-business-upload-${runTag}.txt`);
    const d2 = find(`doc030-access-second-upload-${runTag}.txt`);
    const d3 = find(`doc030-access-general-upload-${runTag}.txt`);
    const typeOf = (d) => d?.versions?.[0]?.documentType?.displayName ?? d?.versions?.[0]?.documentTypeName ?? d?.versions?.[0]?.documentTypeId ?? null;
    const noteOf = (d) => d?.versions?.[0]?.note ?? null;
    const legalView = { d1: typeOf(d1), d2: typeOf(d2), d3: typeOf(d3) };
    check(posts === 3 && d1 && d2 && d3 && noteOf(d1) === noteOf(d2) && noteOf(d1) === `DOC-030 access business note ${runTag}` && kindDefault === "General" && kinds.length === 7 && kinds.includes("Executed"), JSON.stringify({ posts, kinds, kindDefault, legalView, notes: [noteOf(d1), noteOf(d2)] }));
    check(/Draft · theirs/i.test(String(legalView.d1)) && /Draft · theirs/i.test(String(legalView.d2)) && !legalView.d3, `Legal types ${JSON.stringify(legalView)} ${JSON.stringify(d1?.versions?.[0]).slice(0, 300)}`);
    return { page: `/portal/contracts/${CR}`, actual: `Add as offered ${addAs.join(", ")}. Kind started on ${kindDefault} and offered ${kinds.join(", ")}. With one failure injected by the reviewer's browser route, the dialog read "${mid.slice(0, 200)}"; Retry failed uploads sent only the failed file (${posts} POSTs). Both Documents carry the note. Legal's Document list shows the Draft · theirs uploads as ${JSON.stringify(legalView.d1)} / ${JSON.stringify(legalView.d2)}, and the General upload with no type (${JSON.stringify(legalView.d3)}).` };
  });
  await step(CG, BU, "G7b.upload-matter", "Open Upload documents on the Matter.", "Matter uploads have no Kind control.", async () => {
    await go(R, `/portal/matters/${MR}`);
    await R.getByRole("button", { name: "Upload documents" }).click();
    const dialog = R.getByRole("dialog", { name: "Upload documents" });
    await dialog.waitFor();
    await dialog.locator("input[type=file]").setInputFiles([file(`doc030-access-matter-upload-${runTag}.txt`, "DOC-030 access fictional Matter upload.\n")]);
    const kind = await dialog.getByRole("combobox", { name: "Kind" }).count();
    const labels = await text(dialog);
    await dialog.getByRole("button", { name: "Upload", exact: true }).click();
    await dialog.waitFor({ state: "hidden", timeout: 20000 });
    check(kind === 0 && /Note \(optional\)/.test(labels), labels);
    return { page: `/portal/matters/${MR}`, actual: `The Matter Upload documents dialog read "${labels.slice(0, 200)}" with no Kind control; the upload finished.` };
  });
  await step(CG, BU, "G8.add-version", "Select Add version beside the primary Contract Document; upload one file; expand earlier versions.", "Add version opens the dialog with that Document selected and takes one file; Signed copy marks the Version Legal pinned; uploading a Version changes neither designation.", async () => {
    await call(nadiaApi, "POST", `/documents/${fx.raviPrimary.id}/executed-version`, { versionId: fx.raviPrimary.v1 });
    await go(R, `/portal/contracts/${CR}`);
    const region = R.getByRole("region", { name: "Documents" });
    const row = region.getByRole("listitem").filter({ hasText: "doc030-access-supporting" }).first();
    await row.getByRole("button", { name: "Add version" }).click();
    const dialog = R.getByRole("dialog", { name: "Upload documents" });
    await dialog.waitFor();
    const selected = await dialog.getByRole("combobox", { name: "Add as" }).evaluate((s) => s.options[s.selectedIndex].text);
    const multiple = await dialog.locator("input[type=file]").getAttribute("multiple");
    await dialog.locator("input[type=file]").setInputFiles(file(`doc030-access-supporting-${runTag}.txt`, "DOC-030 access fictional supporting paper, next version.\n"));
    await dialog.getByRole("button", { name: "Upload", exact: true }).click();
    await dialog.waitFor({ state: "hidden", timeout: 20000 });
    await settle(R);
    const row2 = region.getByRole("listitem").filter({ hasText: "doc030-access-supporting" }).first();
    await row2.getByRole("button", { name: /earlier version/ }).click();
    await sleep(500);
    const t = await text(row2);
    const first = await text(region.getByRole("listitem").first());
    check(/New version of/.test(selected) && multiple === null && /Signed copy/.test(t) && /^Primary Document/.test(first), JSON.stringify({ selected, multiple, t: t.slice(0, 300), first: first.slice(0, 80) }));
    return { page: `/portal/contracts/${CR}`, actual: `Legal pinned Version 1 as the signed copy (API). Add version opened Upload documents with "${selected}" and a single-file input. After upload the row read "${t.slice(0, 280)}"; the first row is still the Primary Document.` };
  });
  await step(CG, BU, "G9.drop-no-folders", "Drop a file onto Documents; look for folder and archive controls.", "Dropping opens the upload dialog with the file; Business Users cannot manage folders or archive paper.", async () => {
    await go(R, `/portal/contracts/${CR}`);
    const region = R.getByRole("region", { name: "Documents" });
    const target = region.getByRole("button", { name: "Drop files here or click to upload" });
    const dt = await R.evaluateHandle(() => {
      const d = new DataTransfer();
      d.items.add(new File(["DOC-030 access dropped paper"], "doc030-access-dropped.txt", { type: "text/plain" }));
      return d;
    });
    await target.dispatchEvent("dragover", { dataTransfer: dt });
    await target.dispatchEvent("drop", { dataTransfer: dt });
    const dialog = R.getByRole("dialog", { name: "Upload documents" });
    await dialog.waitFor({ timeout: 10000 });
    const listed = (await text(dialog)).includes("doc030-access-dropped.txt");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    const all = await text(region);
    const forbidden = ["New folder", "Folder", "Archive", "Move"].filter((w) => new RegExp(`\\b${w}\\b`).test(all));
    check(listed && forbidden.length === 0, JSON.stringify({ listed, forbidden }));
    return { page: `/portal/contracts/${CR}`, actual: `Dropping doc030-access-dropped.txt on "Drop files here or click to upload" opened Upload documents with the file listed (cancelled). Documents had no folder or archive controls.` };
  });
  await step(CG, BU, "G10.search-documents", "Use Search Documents with an earlier Version's filename and a name; use Show more.", "Search Documents finds by name or any Version's filename; Show more loads another page.", async () => {
    await go(R, `/portal/contracts/${CR}`);
    const region = R.getByRole("region", { name: "Documents" });
    await region.getByRole("textbox", { name: "Search Documents" }).fill("supporting-v1");
    await region.getByRole("button", { name: "Search", exact: true }).click();
    await settle(R);
    const byOld = await text(region);
    await go(R, `/portal/matters/${DM}`);
    const d = R.getByRole("region", { name: "Documents" });
    const before = await d.getByRole("button", { name: /^doc030-access-page-/ }).count();
    await d.getByRole("button", { name: "Show more" }).click();
    await settle(R);
    const after = await d.getByRole("button", { name: /^doc030-access-page-/ }).count();
    await d.getByRole("textbox", { name: "Search Documents" }).fill("page-37");
    await d.getByRole("textbox", { name: "Search Documents" }).press("Enter");
    await settle(R);
    const byName = await d.getByRole("button", { name: /^doc030-access-page-/ }).allInnerTexts();
    check(/doc030-access-supporting/.test(byOld) && before === 50 && after === 51 && byName.length === 1, JSON.stringify({ before, after, byName, byOld: byOld.slice(0, 200) }));
    return { page: `/portal/matters/${DM}`, actual: `"supporting-v1" (the first Version's filename) listed the supporting Document whose current Version is newer: "${byOld.slice(0, 160)}". On M-${DM} Documents showed ${before} rows and Show more added the rest (${after}); "page-37" listed ${byName.join(", ")}.` };
  });
  await step(CG, BU, "G11.comments", "Open Comments, write a reply, attach a file, select Comment; type @; use Comment actions to edit and delete; switch applets with a draft.", "The unread badge clears after the comments load; the draft and attachments stay; @ offers people who can hear the comment; Comment actions edit and delete; there is no audience picker.", async () => {
    const t = `DOC-030 access ask ${runTag}`;
    await call(nadiaApi, "POST", "/comments", { entityType: "matter", entityId: fx.mr.id, body: `DOC-030 access Legal reply for Ravi ${runTag}`, visibility: "full_thread" });
    await go(R, `/portal/matters/${MR}`);
    const btn = R.getByRole("toolbar", { name: "Applets" }).getByRole("button", { name: /^Comments/ });
    const badgeBefore = `${(await btn.innerText()).trim()} ${(await btn.getAttribute("aria-label")) ?? ""}`;
    const panel = await applet(R, "Comments");
    await sleep(1500);
    const pickers = await panel.getByRole("radio").count();
    const attach = file(`doc030-access-comment-${runTag}.txt`, "DOC-030 access fictional comment attachment.\n");
    await panel.getByRole("textbox", { name: "New comment" }).fill("DOC-030 access draft kept ");
    await panel.locator("input[type=file]").setInputFiles(attach);
    await applet(R, "History");
    await applet(R, "Comments");
    const switched = await panel.getByRole("textbox", { name: "New comment" }).inputValue();
    await panel.getByRole("button", { name: "Close" }).click();
    await panel.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await applet(R, "Comments");
    const kept = await panel.getByRole("textbox", { name: "New comment" }).inputValue();
    const keptFile = (await text(panel)).includes(`doc030-access-comment-${runTag}.txt`);
    await R.goto(R.url());
    await settle(R);
    const badgeAfter = await R.getByRole("toolbar", { name: "Applets" }).getByRole("button", { name: /^Comments/ }).evaluate((b) => `${b.innerText} ${b.getAttribute("aria-label") ?? ""}`);
    const p2 = await applet(R, "Comments");
    const box = p2.getByRole("textbox", { name: "New comment" });
    await box.fill("");
    await box.pressSequentially(`${t} @Nad`, { delay: 40 });
    const lb = R.getByRole("listbox", { name: "People and files you can mention" });
    await lb.waitFor({ timeout: 10000 });
    const mentions = (await lb.getByRole("option").allInnerTexts()).map((s) => s.replace(/\s+/g, " "));
    await lb.getByRole("option").first().click();
    await p2.locator("input[type=file]").setInputFiles(attach);
    await p2.getByRole("button", { name: "Comment", exact: true }).click();
    const mine = p2.getByRole("listitem").filter({ hasText: t });
    await mine.waitFor({ timeout: 15000 });
    const posted = await text(mine);
    await mine.getByRole("button", { name: "Comment actions" }).click();
    await R.getByRole("menuitem", { name: "Edit" }).click();
    await p2.getByRole("textbox", { name: "Edit comment" }).fill(`${t} edited`);
    await p2.getByRole("button", { name: "Save" }).click();
    await p2.getByText(`${t} edited`).waitFor({ timeout: 10000 });
    const edited = p2.getByRole("listitem").filter({ hasText: `${t} edited` });
    await edited.getByRole("button", { name: "Comment actions" }).click();
    await R.getByRole("menuitem", { name: "Delete" }).click();
    await R.getByRole("dialog", { name: "Delete this comment?" }).getByRole("button", { name: "Delete" }).click();
    await sleep(1500);
    const final = await text(p2);
    check(pickers === 0 && switched.startsWith("DOC-030 access draft kept") && kept.startsWith("DOC-030 access draft kept") && keptFile && posted.includes(`doc030-access-comment-${runTag}.txt`) && mentions.some((o) => /Nadia/.test(o)) && (!final.includes(`${t} edited`) || /deleted/i.test(final)), JSON.stringify({ pickers, kept, keptFile, mentions, posted: posted.slice(0, 120) }));
    return { page: `/portal/matters/${MR}`, actual: `Comments button before opening: "${badgeBefore}"; after the comments loaded and a reload: "${badgeAfter}". No audience picker. The draft and its attachment stayed after switching to History and back and after closing and reopening Comments. @Nad offered ${mentions.join("; ")}. The reply posted with its attachment; Comment actions > Edit > Save changed it; Delete removed it.` };
  });
  await step(CG, BU, "G12.reply-label", "Post a reply on the Matter and on the Contract; read the text below the composer.", "The reply shows Matter Team or Contract Team; the text below the composer names the audience; Legal Only and older Internal team messages stay outside.", async () => {
    await call(nadiaApi, "POST", "/comments", { entityType: "matter", entityId: fx.mr.id, body: `DOC-030 access hidden Legal Only ${runTag}`, visibility: "legal_only" });
    await call(nadiaApi, "POST", "/comments", { entityType: "matter", entityId: fx.mr.id, body: `DOC-030 access hidden Internal team ${runTag}`, visibility: "working_team" });
    const out = {};
    for (const [label, url, module] of [["Matter Team", `/portal/matters/${MR}`, "Matter"], ["Contract Team", `/portal/contracts/${CR}`, "Contract"]]) {
      await go(R, url);
      const panel = await applet(R, "Comments");
      await sleep(1000);
      const hint = ((await text(panel)).match(/Visible to [^.]*\./) ?? [""])[0];
      const body = `DOC-030 access Ravi reply on ${module} ${runTag}`;
      await panel.getByRole("textbox", { name: "New comment" }).fill(body);
      await panel.getByRole("button", { name: "Comment", exact: true }).click();
      const item = panel.getByRole("listitem").filter({ hasText: body }).first();
      await item.waitFor({ timeout: 15000 });
      const row = (await text(item)).replace(body, "");
      const all = await text(panel);
      if (module === "Matter") await R.screenshot({ path: path.join(here, "contributor-reply-label.png") });
      out[module] = { row, hint, hidden: all.includes(`hidden Legal Only ${runTag}`) || all.includes(`hidden Internal team ${runTag}`), labels: /Legal Only|Internal team/.test(all) };
      check(new RegExp(label).test(row) && hint === `Visible to Legal and all ${module} team members.`, JSON.stringify(out[module]));
    }
    check(!out.Matter.hidden && !out.Matter.labels && !out.Contract.labels, JSON.stringify(out));
    return { page: `/portal/matters/${MR}`, actual: `Matter reply row "${out.Matter.row.slice(0, 70)}", composer text "${out.Matter.hint}"; Contract reply row "${out.Contract.row.slice(0, 70)}", composer text "${out.Contract.hint}". Legal Only and Working Team comments on M-${MR} did not appear. See contributor-reply-label.png.` };
  });
  await step(CG, BU, "G13.history", "Legal changes the Contract and closes the Matter with a closing note one item at a time; open History each time.", "History lists Stage and Status moves, changes to values the Portal draws and to Visible on Portal Fields, Tasks added (with due date) or completed, and replies, newest first; it excludes Legal Only and Working Team messages, edited, reordered or removed Tasks, Priority, Risk and Fields kept off the Portal; a Matter's closing note stays with Legal.", async () => {
    const probe = await historyProbe({ reader: R, legal: nadiaApi, module: "contract", number: CR, typed: true });
    const verdict = historyVerdict(probe);
    const closed = (await call(await admin(), "GET", "/matter-statuses")).body.matterStatuses.find((s) => s.category === "closed" && !s.archivedAt);
    const before = await portalActivity(R, "matter", fx.mr.id);
    const note = `DOC-030 access closing note ${runTag}`;
    const mv = await call(nadiaApi, "PATCH", `/matters/${MR}`, { statusId: closed.id, closingNote: note });
    await sleep(800);
    const after = await portalActivity(R, "matter", fx.mr.id);
    const panel = await historyPanel(R, `/portal/matters/${MR}`);
    await R.screenshot({ path: path.join(here, "contributor-portal-history.png") });
    const open = (await call(await admin(), "GET", "/matter-statuses")).body.matterStatuses.find((s) => s.slug === "open");
    await call(nadiaApi, "PATCH", `/matters/${MR}`, { statusId: open.id, confirmReopen: true });
    const closeEntries = after.filter((e) => !before.some((b) => b.id === e.id));
    check(mv.status === 200 && closeEntries.length > 0 && !panel.includes(note) && /DOC-030 access probe task A/.test(probe.panelText) && /due Dec 15/.test(probe.panelText), JSON.stringify({ mv: mv.status, panel: panel.slice(0, 200), history: probe.panelText.slice(0, 300) }));
    return { page: `/portal/contracts/${CR}`, actual: `${verdict}. Contract History panel (newest first): "${probe.panelText.slice(0, 700)}". Closing M-${MR} as "${closed.displayName}" with a closing note added ${closeEntries.length} History entry (${closeEntries.map((e) => e.action).join(", ")}); the Matter panel read "${panel.slice(0, 200)}" and did not contain the note. See contributor-portal-history.png. Legal reopened the Matter.` };
  });
  await step(CG, BU, "G14.team-add", "Open Matter team; Add team member; choose an existing person; Add. Then open a Confidential record's team.", "Existing members are excluded; the person joins the same team as in the full app; Business Users added gain Portal access; Confidential records: ask Legal; no remove control.", async () => {
    await go(R, `/portal/matters/${MR}`);
    const { options } = await addTeamMember(R, "Matter team", "Amara Nwosu");
    const removes = await (await applet(R, "Matter team")).getByRole("button", { name: /off the/ }).count();
    const A = (await portal("amara")).page;
    const aOpen = await openRecord(A, `/portal/matters/${MR}`);
    await go(N, `/matters/${MR}`);
    const legal = await rosterRows(await applet(N, "Matter team"));
    await removeTeamMember(N, "Matter team", "Amara Nwosu", "matter");
    await go(N, `/matters/${fx.mc.number}`);
    await addTeamMember(N, "Matter team", "Ravi Menon");
    await go(R, `/portal/matters/${fx.mc.number}`);
    const cp = await applet(R, "Matter team");
    const cadd = await cp.getByRole("button", { name: "Add team member" }).isEnabled();
    const cnote = await text(cp);
    await go(N, `/matters/${fx.mc.number}`);
    await removeTeamMember(N, "Matter team", "Ravi Menon", "matter");
    check(!options.includes("Ravi Menon") && !options.includes("Nadia Haddad") && legal.some((r) => r.includes("Amara Nwosu")) && removes === 0 && !aOpen.refused && !cadd && /Ask Legal to add members to a Confidential record/.test(cnote), JSON.stringify({ options: options.length, legal, removes, cadd, cnote }));
    return { page: `/portal/matters/${MR}`, actual: `The picker excluded Ravi and Nadia (existing members). Ravi added Amara Nwosu; she then opened M-${MR} in the Portal, and Nadia saw her on the full-app team (${legal.join(" | ")}). No remove control in the Portal. On Confidential M-${fx.mc.number} Add team member was disabled: "${cnote.slice(0, 120)}". Nadia removed Amara and Ravi afterwards.` };
  });
  await step(CG, BU, "G15.legal-limits", "Look for controls for Fields, Description, Value, dates, Status, Type, owners, parties, confidentiality, relationships, Tasks, Key dates, approval requests, signatures and team removal.", "These stay with Legal; Stage and Status moves are unavailable.", async () => {
    const out = [];
    for (const url of [`/portal/contracts/${CR}`, `/portal/matters/${MR}`]) {
      await go(R, url);
      const main = await text(R.getByRole("main"));
      const buttons = (await R.getByRole("main").getByRole("button").allInnerTexts()).map((s) => s.trim()).filter((b) => b && !/\.(txt|pdf)$/.test(b));
      const bad = buttons.filter((b) => /move|Stage|Status|Owner|Confidential|Counterpart|Link|Task|Key date|Approv|Sign|Archive|Remove|Edit/i.test(b));
      out.push({ url, bad, switches: await R.getByRole("switch").count(), sections: ["Tasks", "Key dates"].filter((w) => main.includes(w)) });
    }
    const write = await pageApi(R, "PATCH", `/contracts/${CR}`, { title: "DOC-030 access probe" });
    const stage = await pageApi(R, "PATCH", `/matters/${MR}`, { priority: "high" });
    check(out.every((o) => o.bad.length === 0 && o.switches === 0 && o.sections.length === 0) && write.status >= 400 && stage.status >= 400, JSON.stringify(out));
    return { page: `/portal/contracts/${CR}`, actual: `Neither Portal record offered Stage or Status moves, owner, party, confidentiality, relationship, Task, Key date, approval, signing or team-removal controls. Direct record writes answered ${write.status} and ${stage.status}.` };
  });
  await step(CG, BU, "G16.close-end-archive-remove", "Legal closes the Matter and ends the Contract; then archives and restores the Matter; then removes Ravi from the Matter team.", "Closing or Ending keeps permitted Portal work; archiving removes the record from the Portal; removing Ravi's reach stops access.", async () => {
    const closed = (await call(await admin(), "GET", "/matter-statuses")).body.matterStatuses.find((s) => s.category === "closed" && !s.archivedAt);
    const open = (await call(await admin(), "GET", "/matter-statuses")).body.matterStatuses.find((s) => s.slug === "open");
    const mv = await call(nadiaApi, "PATCH", `/matters/${MR}`, { statusId: closed.id, closingNote: "DOC-030 access fictional closing note." });
    const openClosed = await openRecord(R, `/portal/matters/${MR}`);
    const uploadClosed = await R.getByRole("button", { name: "Upload documents" }).isEnabled().catch(() => false);
    const cur = (await call(nadiaApi, "GET", `/contracts/${CR}`)).body;
    const curStatus = (cur.contract ?? cur).statusId;
    const ended = (await call(await admin(), "GET", "/contract-statuses")).body.contractStatuses.find((s) => s.stage === "ended" && !s.archivedAt);
    const end = await call(nadiaApi, "PATCH", `/contracts/${CR}`, { statusId: ended.id, overrideSoftGate: true });
    const openEnded = await openRecord(R, `/portal/contracts/${CR}`);
    const uploadEnded = await R.getByRole("button", { name: "Upload documents" }).isEnabled().catch(() => false);
    const commentEnded = await (await applet(R, "Comments")).getByRole("textbox", { name: "New comment" }).isEditable().catch(() => false);
    const back = await call(nadiaApi, "PATCH", `/contracts/${CR}`, { statusId: curStatus, overrideSoftGate: true });
    const ar = await call(nadiaApi, "POST", `/matters/${MR}/archive`, {});
    await go(R, "/portal/matters");
    const listArchived = await text(R.getByRole("main"));
    const openArchived = await openRecord(R, `/portal/matters/${MR}`);
    const rs = await call(nadiaApi, "POST", `/matters/${MR}/restore`, {});
    const reopen = await call(nadiaApi, "PATCH", `/matters/${MR}`, { statusId: open.id, confirmReopen: true });
    await go(N, `/matters/${MR}`);
    await removeTeamMember(N, "Matter team", "Ravi Menon", "matter");
    await R.goto(`${BASE}/portal/matters/${MR}`);
    await settle(R);
    const removed = /not found/.test(await h1(R));
    const docs = await pageApi(R, "GET", `/portal/matters/${MR}/documents`);
    check(mv.status === 200 && !openClosed.refused && uploadClosed && end.status === 200 && !openEnded.refused && uploadEnded && commentEnded && ar.status < 300 && !listArchived.includes(fx.mr.title) && openArchived.refused && removed && docs.status >= 400, JSON.stringify({ mv: mv.status, uploadClosed, end: end.status, uploadEnded, commentEnded, ar: ar.status, openArchived, removed, docs: docs.status }));
    return { page: `/portal/matters/${MR}`, actual: `Legal closed M-${MR} as "${closed.displayName}" (${mv.status}); Ravi still opened it with Upload documents enabled. Legal ended C-${CR} as "${ended.displayName}" (${end.status}); Ravi still opened it with Upload documents and the Comments composer; Legal moved it back (${back.status}). After archiving (${ar.status}) M-${MR} left Your Matters and its link showed "${openArchived.title}"; Legal restored (${rs.status}) and reopened (${reopen.status}) it. After Nadia removed Ravi through Matter team, his reload showed "Matter not found" and a Documents read answered ${docs.status}.` };
  });
  await step(CG, BU, "G17.approvals", "Select Approvals in the Portal navigation bar; search by Contract title and by requester name; open a request; enter Note (optional); Approve; then Reject another; open Completed.", "Your approvals lists Pending requests; the request shows the primary Document; Approve or Reject; a decision is final; completed decisions appear under Completed; only the named approver can decide; the request does not add you to the team.", async () => {
    const make = async (k) => {
      const c = (await call(nadiaApi, "POST", "/contracts", { title: `DOC-030 access Ravi ${k} approval ${runTag}`, contractTypeId: fx.types.nda, managerId: fx.ids.nadia })).body.contract;
      await upload(nadiaApi, `/contracts/${c.number}/documents`, `doc030-access-${k}-paper-${runTag}.txt`, `DOC-030 access fictional paper to ${k}.\n`);
      const a = (await call(nadiaApi, "POST", `/contracts/${c.number}/approvals`, { approverIds: [fx.ids.ravi] })).body;
      return { number: c.number, title: c.title, id: (a.approvals ?? [a.approval ?? a])[0]?.id };
    };
    const ap = await make("approve");
    const rj = await make("reject");
    await go(R, "/portal");
    await R.getByRole("navigation", { name: "Portal" }).getByRole("link", { name: "Approvals" }).click();
    await R.getByRole("heading", { name: "Your approvals" }).waitFor({ timeout: 15000 });
    await settle(R);
    const pending = await text(R.getByRole("main"));
    const search = R.getByRole("searchbox", { name: "Search approvals" });
    await search.fill(`Ravi approve approval ${runTag}`);
    await R.getByRole("search").getByRole("button", { name: "Search" }).click();
    await settle(R);
    const byTitle = await text(R.getByRole("main"));
    await search.fill("Nadia");
    await R.getByRole("search").getByRole("button", { name: "Search" }).click();
    await settle(R);
    const byRequester = await text(R.getByRole("main"));
    await go(R, `/portal/approvals/${ap.id}`);
    const packet = await text(R.getByRole("main"));
    const jonasTry = await pageApi((await portal("jonas")).page, "POST", `/portal/approvals/${ap.id}/decision`, { decision: "approved" });
    await R.getByLabel("Note (optional)").fill(`DOC-030 access approval note ${runTag}`);
    await R.getByRole("button", { name: "Approve" }).click();
    await R.getByRole("status").filter({ hasText: /Approved/ }).first().waitFor({ timeout: 15000 });
    const decided = await text(R.getByRole("main"));
    const buttonsLeft = await R.getByRole("button", { name: /^(Approve|Reject)$/ }).count();
    const again = await pageApi(R, "POST", `/portal/approvals/${ap.id}/decision`, { decision: "rejected" });
    await go(R, `/portal/approvals/${rj.id}`);
    await R.getByRole("button", { name: "Reject" }).click();
    await R.getByRole("status").filter({ hasText: /Rejected/ }).first().waitFor({ timeout: 15000 });
    await go(R, "/portal/approvals");
    await R.getByRole("link", { name: "Completed" }).click();
    await settle(R);
    const completed = await text(R.getByRole("main"));
    const direct = await openRecord(R, `/portal/contracts/${ap.number}`);
    check(pending.includes(ap.title) && pending.includes(rj.title) && byTitle.includes(ap.title) && !byTitle.includes(rj.title) && byRequester.includes(ap.title), JSON.stringify({ byTitle: byTitle.slice(0, 200) }));
    check(packet.includes(`doc030-access-approve-paper-${runTag}.txt`) && jonasTry.status >= 400 && buttonsLeft === 0 && again.status === 409 && completed.includes(ap.title) && completed.includes(rj.title) && direct.refused, JSON.stringify({ jonas: jonasTry.status, buttonsLeft, again: again.status, direct }));
    return { page: "/portal/approvals", actual: `Your approvals (Pending) listed both new requests. Searching the Contract title kept only that request; searching "Nadia" (the requester) listed both. The request page read "${packet.slice(0, 240)}". Jonas's decision on Ravi's request answered ${jonasTry.status}. Ravi entered a Note and selected Approve; the page then read "${decided.slice(decided.indexOf("Your decision"), decided.indexOf("Your decision") + 120)}" with no Approve or Reject, and a second decision answered ${again.status}. Reject on the other request worked. Completed listed both. /portal/contracts/${ap.number} showed "${direct.title}" (the request did not add Ravi to the team).` };
  });
}

// ============================================================================
// run
// ============================================================================
const modules = { signin, roles, contributor };
for (const k of chosen) {
  if (!modules[k]) continue;
  try {
    await modules[k]();
  } catch (e) {
    results.steps.push({ article: ARTICLES[k], id: "script-error", role: "-", method: "browser-walkthrough", action: "run module", expected: "module completes", actual: String(e?.message ?? e).split("\n").slice(0, 3).join(" "), result: "fail", at: new Date().toISOString() });
    console.error(e);
  }
  results.runs[ARTICLES[k]].finishedAt = new Date().toISOString();
  results.runs[ARTICLES[k]].summary = summary(ARTICLES[k]);
  save();
}
await closeBrowser();
save();
for (const k of chosen) console.log(ARTICLES[k], JSON.stringify(summary(ARTICLES[k])));
