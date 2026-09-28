// DOC-032 compatibility reviewer (bridge): access replay on the release candidate ad345da5.
// This file is a copy of DOC-032/access/walkthrough.mjs. No step, selector, check or expected
// text changed. Adapted only:
//   - helper import "./lib.mjs" -> "./access-replay/lib.mjs"; lib.mjs and phase.sh in
//     bridge/access-replay/ use one more "../" for the repository root;
//   - lab manifest and names accs -> bacc; addresses and ports 43357/48457 -> 43394/48494 and
//     the recorded lab create line (subnets 10.243.94.0/24, 10.244.94.0/24);
//   - seat label walkthroughReviewer -> "DOC-032 compatibility reviewer (bridge)";
//   - fixture record names and throwaway prefixes "DOC-032 access" / doc032.access. /
//     doc032-access- / Doc032-access- -> "DOC-032 bridge" / doc032.bridge. / doc032-bridge- /
//     Doc032-bridge- (same length, so name lengths are unchanged);
//   - log path -> bridge/access-replay.json; fixtures.json and phase.sh from bridge/access-replay/
//     (the fixtures section writes a new fixtures.json for bacc); the OIDC fixture stays
//     DOC-032/admin-org/oidc-fixture.mjs, read-only, through overlay-oidc.json.
// No screenshots are written. The original header follows.
//
// DOC-032 access independent walkthrough: staff-sign-in (V-C01) and portal-sign-in (V-C02)
// against app commit ad345da5 (replay; first walked on 4ca41822), on the owned lab `bacc` (Helix seed, light profile, random seed 7).
// Written by the DOC-032 independent walkthrough agent (access) from the guides' own steps. The
// patterns come from DOC-030/access-2/walkthrough.mjs (staff-sign-in), DOC-030/access/walkthrough.mjs
// (portal-sign-in) and DOC-032/admin-org/walkthrough.mjs (OIDC fixture, identity providers).
//
// Organization-wide sign-in settings (providers, allowed domains, sign-in methods, two-factor
// policy, email relay) are changed only on `bacc`, never on the shared `work` lab.
// The two-issuer OIDC fixture runs beside the lab (phase.sh oidc). Sections, in order:
//   fixtures   Portal records for Jonas (converted Request, Documents, paging, archived Contract)
//   staff      V-C01 per role: invitation, sign-in, two-factor, sessions, links, lockouts
//   staffSso   V-C01 organization methods: SSO with one and two providers, Administrator sign-in,
//              required two-factor, the unavailable page and its recovery, SSO not configured
//   portal     V-C02 Business User: links, expiry, isolation, Contracts, Matters, links off, 2FA, logo
//   portalSso  V-C02 SSO with one and two providers, and the empty allowed-domain list
//   mailOff    both guides with no email relay (applies phase.sh mail-off, then base, itself)
// Run each section from the worktree root inside a pasta network namespace that forwards only
// this lab's ports (Chromium in the host namespace aborts with ERR_NETWORK_CHANGED when other
// labs add Docker networks):
//   LAB_PASSWORD=... pasta --config-net -T 43394,48494 -- \
//     node docs/documentation/batches/DOC-032/bridge/access-replay.mjs <section>
// A run of a section replaces only that section's steps in access-replay.json.
// Credentials come only from the environment. Links, cookies, TOTP secrets, backup codes and
// mail bodies stay in memory; the log redacts tokens.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  BASE,
  LAB,
  MAIL,
  OIDC_IP,
  PASSWORD,
  PROJECT,
  SEED,
  apiSession,
  applet,
  buttons,
  call,
  check,
  closeBrowser,
  code,
  freshStep,
  h1,
  here,
  idpIdentity,
  lastIssuer,
  mailSince,
  must,
  newContext,
  pageApi,
  root,
  rosterRows,
  seen,
  settle,
  sleep,
  sql,
  text,
  totp,
  upload,
  waitForLink,
  wrongCode,
} from "./access-replay/lib.mjs";

const SECTIONS = ["fixtures", "staff", "staffSso", "portal", "portalSso", "mailOff"];
const section = process.argv[2];
if (!SECTIONS.includes(section)) throw new Error(`Section must be one of ${SECTIONS.join(", ")}`);
const S = "staff-sign-in";
const P = "portal-sign-in";
const SCENARIO = { [S]: "V-C01", [P]: "V-C02" };
const STAMP = new Date().toISOString().slice(5, 16).replace(/\D/g, "");
const TAG = `DOC-032 bridge`;
const OUT = path.join(here, "..", "access-replay.json");
const FIX = path.join(here, "fixtures.json");
const sha = (id) =>
  createHash("sha256")
    .update(readFileSync(path.join(root, `docs/user-guides/${id}.md`)))
    .digest("hex");
const image = (svc) =>
  execFileSync("docker", ["inspect", "-f", "{{.Image}}", `${PROJECT}-${svc}-1`], {
    encoding: "utf8",
  }).trim();

const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null;
const results = {
  batch: "DOC-032",
  group: "access",
  walkthroughReviewer: "DOC-032 compatibility reviewer (bridge)",
  reviewerKind: "agent",
  appCommit: LAB.sourceCommit,
  environment: LAB.project,
  lab: {
    name: LAB.name,
    project: PROJECT,
    appUrl: BASE,
    mailUrl: MAIL,
    appImageId: LAB.appImageId,
    engineImageId: LAB.engineImageId,
    seed: LAB.seed,
    created: `node scripts/documentation/lab.mjs create bacc --commit ${LAB.sourceCommit} --app-port 43394 --mail-port 48494 --backend-subnet 10.243.94.0/24 --engine-subnet 10.244.94.0/24; up; seed`,
  },
  browser:
    "Playwright 1.63.0 Chromium (node_modules/.pnpm), headless, 1440x900, one isolated browser context per person or device, inside a pasta network namespace",
  oidcFixture:
    "oauth2-mock-server 9.2.0 from DOC-032/admin-org/oidc-fixture.mjs in container openlaw-docs-9d2b1705-bacc-oidc-1 (overlay-oidc.json), issuers http://oidc:8080 and http://oidc:8082",
  articleContentSha256: { [S]: sha(S), [P]: sha(P) },
  sections: { ...(previous?.sections ?? {}) },
  settingChanges: (previous?.settingChanges ?? []).filter((c) => c.section !== section),
  created: (previous?.created ?? []).filter((c) => c.section !== section),
  productBugs: (previous?.productBugs ?? []).filter((b) => b.section !== section),
  summary: null,
  steps: (previous?.steps ?? []).filter((s) => s.section !== section),
};
results.sections[section] = {
  startedAt: new Date().toISOString(),
  finishedAt: null,
  stamp: STAMP,
  runningImages: { app: image("app"), worker: image("worker"), "doc-engine": image("doc-engine") },
  articleContentSha256: { [S]: sha(S), [P]: sha(P) },
};
function save() {
  // Another section may run at the same time in another process: keep its records.
  if (existsSync(OUT)) {
    const disk = JSON.parse(readFileSync(OUT, "utf8"));
    const others = (list) => (list ?? []).filter((x) => x.section !== section);
    const mine = (list) => list.filter((x) => x.section === section);
    results.steps = [...others(disk.steps), ...mine(results.steps)];
    results.created = [...others(disk.created), ...mine(results.created)];
    results.settingChanges = [...others(disk.settingChanges), ...mine(results.settingChanges)];
    results.productBugs = [...others(disk.productBugs), ...mine(results.productBugs)];
    results.sections = { ...(disk.sections ?? {}), [section]: results.sections[section] };
  }
  const all = results.steps;
  results.summary = Object.fromEntries(
    [S, P].map((a) => {
      const s = all.filter((x) => x.article === a);
      return [
        a,
        {
          steps: s.length,
          pass: s.filter((x) => x.result === "pass").length,
          fail: s.filter((x) => x.result === "fail").length,
          blocked: s.filter((x) => x.result === "blocked").length,
        },
      ];
    }),
  );
  const order = (s) => SECTIONS.indexOf(s.section);
  results.steps = [...all].sort((a, b) => order(a) - order(b));
  writeFileSync(
    OUT,
    JSON.stringify(results, null, 2).replace(/token=[^&\s"\\]+/g, "token=[redacted]") + "\n",
  );
}
const created = (what) => results.created.push({ section, at: new Date().toISOString(), what });
const setting = (what, detail) =>
  results.settingChanges.push({ section, at: new Date().toISOString(), what, detail });
const bug = (article, summary, reproduction) =>
  results.productBugs.push({ section, article, summary, reproduction });

/** One guide step as the named role. fn returns {page, actual}; a failed check throws. */
async function step(article, role, id, action, expected, fn, pg) {
  const entry = {
    article,
    scenario: SCENARIO[article],
    role,
    method: "browser-walkthrough",
    section,
    id,
    action,
    expected,
    page: null,
    actual: null,
    result: "not-run",
    startedAt: new Date().toISOString(),
    at: null,
  };
  results.steps.push(entry);
  try {
    const out = await fn();
    entry.page = out?.page ?? null;
    entry.actual = out?.actual ?? String(out);
    entry.result = "pass";
  } catch (error) {
    entry.actual = `Check failed: ${String(error?.message ?? error)
      .split("\n")
      .slice(0, 4)
      .join(" ")}`;
    try {
      if (pg && !pg.isClosed()) {
        const t = (await text(pg.locator("body"))).slice(0, 300);
        entry.actual += ` Page at failure: ${new URL(pg.url()).pathname}; text "${t}".`;
      }
    } catch {}
    entry.result = "fail";
  }
  entry.at = new Date().toISOString();
  console.log(
    `[${article}/${role}] ${entry.result.toUpperCase()} ${id}: ${String(entry.actual).slice(0, 300)}`,
  );
  save();
  return entry.result === "pass";
}

// ---------- shared browser helpers ----------
const pathOf = (page) => new URL(page.url()).pathname;
const leftAuth = (page, timeout = 20000) =>
  page
    .waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout })
    .then(
      () => true,
      () => false,
    );
const inPortal = (page, timeout = 20000) =>
  page
    .waitForURL(
      (u) => u.pathname.startsWith("/portal") && !u.pathname.startsWith("/portal/login"),
      { timeout },
    )
    .then(
      () => true,
      () => false,
    );
async function openLogin(page, portal = false) {
  await page.goto(`${BASE}${portal ? "/portal/login" : "/auth/login"}`);
  await page.getByRole("heading").first().waitFor({ timeout: 15000 });
  await settle(page);
}
async function openMenu(page, displayName) {
  await page.getByRole("button", { name: displayName, exact: true }).click();
  return page.getByRole("menu");
}
async function signOutViaMenu(page, displayName) {
  await openMenu(page, displayName);
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL(/\/auth\/login/, { timeout: 20000 });
}
async function openProfile(page, displayName) {
  await openMenu(page, displayName);
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page.waitForURL(/\/settings/);
  const personal = page.getByRole("navigation").filter({ hasText: "Personal" }).first();
  await personal.getByRole("link", { name: "Profile", exact: true }).click();
  await page.waitForURL(/\/settings\/profile/);
  await page.getByLabel("Full name").waitFor({ timeout: 15000 });
}
async function fillLogin(page, email, password) {
  if (!/\/auth\/login/.test(page.url())) await page.goto(`${BASE}/auth/login`);
  const pw = page.getByRole("button", {
    name: /^(Sign in with a password|Administrator sign-in)$/,
  });
  if (!(await page.getByLabel("Password", { exact: true }).count()) && (await pw.count()))
    await pw.first().click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
async function enroll(page, password) {
  await page.getByRole("button", { name: "Turn on two-factor" }).click();
  const dialog = page.getByRole("dialog");
  if (password) {
    await dialog.getByLabel("Password").fill(password);
    await dialog.getByRole("button", { name: "Continue" }).click();
  }
  await dialog.getByText("No camera? Enter this secret manually").waitFor({ timeout: 15000 });
  const qr = await dialog.locator("svg").count();
  const secret = (await text(dialog.getByText("No camera? Enter this secret manually")))
    .split(":")
    .pop()
    .trim();
  return { dialog, secret, qr };
}
async function confirmEnroll(page, dialog, secret) {
  await dialog.getByLabel("Code").fill(await code(secret));
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await dialog.getByText("Save these backup codes").waitFor({ timeout: 15000 });
  const codes = [
    ...new Set((await text(dialog)).match(/\b[A-Za-z0-9]{5}-[A-Za-z0-9]{5}\b/g) ?? []),
  ];
  await dialog.getByRole("button", { name: "Done" }).click();
  await dialog.waitFor({ state: "hidden" });
  return codes;
}
/** The public branding answer and whether the name shows above the heading and form. */
async function brandingAbove(page, headingText) {
  const b = await fetch(`${BASE}/api/v1/org/branding`)
    .then((r) => r.json())
    .catch(() => null);
  const name = b?.name?.trim() ?? "";
  const nameLoc = page.locator("main p", { hasText: name || "OpenLaw" }).first();
  await nameLoc.waitFor({ timeout: 15000 }).catch(() => {});
  const nameBox = name ? await nameLoc.boundingBox().catch(() => null) : null;
  const headBox = await page
    .getByRole("heading", { name: headingText, exact: true })
    .first()
    .boundingBox()
    .catch(() => null);
  const formBox = await page
    .locator("form")
    .first()
    .boundingBox()
    .catch(() => null);
  const logoCount = await page.getByRole("img", { name: "Organization logo" }).count();
  const above = !!(
    nameBox &&
    headBox &&
    nameBox.y + nameBox.height <= headBox.y &&
    (!formBox || nameBox.y + nameBox.height <= formBox.y)
  );
  return {
    apiName: name,
    apiLogo: b?.logo ? "saved" : "none",
    nameShown: !!nameBox,
    above,
    logoCount,
  };
}
const controlsOf = (page) =>
  page
    .locator("main")
    .locator("a, button, input")
    .evaluateAll((els) =>
      els
        .map((e) =>
          e.tagName === "INPUT" ? `input ${e.getAttribute("type")}` : e.textContent.trim(),
        )
        .filter(Boolean),
    );

// ---------- sign-in request budgets (3 per address, 30 per client address, 15 minutes) ----------
function clientBudget(route = "magic-link") {
  const row = sql(
    `select value||'|'||greatest(0,extract(epoch from (expires_at-now()))::int) from verifications where identifier like 'auth-request-rate:${route}:address:%' and expires_at > now() order by value::int desc limit 1`,
  );
  if (!row) return { used: 0, secondsLeft: 0 };
  const [used, secondsLeft] = row.split("|").map(Number);
  return { used, secondsLeft };
}
async function waitForBudget(need, route = "magic-link") {
  for (;;) {
    const b = clientBudget(route);
    if (b.used + need <= 30) return b;
    console.log(
      `waiting ${b.secondsLeft + 2}s for the client-address ${route} budget (${b.used}/30)`,
    );
    await sleep((b.secondsLeft + 2) * 1000);
  }
}

// ---------- organization settings (owned lab only) ----------
const authRegion = (page, name) => page.getByRole("region", { name });
async function openAuthentication(page) {
  await page.goto(`${BASE}/settings/general`);
  const nav = page.getByRole("navigation", { name: "Settings sections" });
  const advanced = nav.getByRole("button", { name: "Advanced" });
  if ((await advanced.getAttribute("aria-expanded")) !== "true") await advanced.click();
  await nav.getByRole("link", { name: "Authentication", exact: true }).click();
  await page.waitForLoadState("networkidle");
  await authRegion(page, "Legal User Authentication").waitFor();
}
async function toggle(page, card, label) {
  const region = authRegion(page, card);
  await region.getByRole("switch", { name: label }).click();
  const note = region.locator('[aria-live="polite"]').first();
  for (let i = 0; i < 40; i++) {
    const t = (await note.innerText()).trim();
    if (t && t !== "Saving…") return t;
    await sleep(150);
  }
  return (await note.innerText()).trim();
}
async function switchState(page, card, label) {
  return authRegion(page, card).getByRole("switch", { name: label }).getAttribute("aria-checked");
}
const methodsNow = () => fetch(`${BASE}/api/v1/auth/methods`).then((r) => r.json());
/** Fixture: an organization-wide policy change through the Administrator's own session. */
async function setPolicy(page, group, policy) {
  const r = await pageApi(page, "PATCH", `/auth/policy/${group}`, policy);
  setting(`${group} authentication policy`, { request: policy, status: r.status });
  if (r.status >= 300)
    throw new Error(`policy ${group}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r;
}
const identityProvider = (page) => authRegion(page, "Identity providers");
const PROVIDER_A = {
  name: "DOC-032 bridge Helix IdP",
  providerId: "doc032-bridge-helix",
  issuer: "http://oidc:8080",
  domains: "helix.example",
  clientId: "doc032-bridge-client-a",
};
const PROVIDER_B = {
  name: "DOC-032 bridge Harbor IdP",
  providerId: "doc032-bridge-harbor",
  issuer: "http://oidc:8082",
  domains: "harbor.example",
  clientId: "doc032-bridge-client-b",
};
/** Fixture: Add provider, fill the dialog, Register provider (Settings → Advanced → Authentication). */
async function registerProvider(page, p) {
  await openAuthentication(page);
  await identityProvider(page).getByRole("button", { name: "Add provider" }).click();
  const dialog = page.getByRole("dialog", { name: "Add provider" });
  await dialog.waitFor();
  await dialog.getByLabel("Display name").fill(p.name);
  await dialog.getByLabel("Provider ID").fill(p.providerId);
  await dialog.getByLabel("Issuer URL").fill(p.issuer);
  await dialog.getByLabel("Email domains").fill(p.domains);
  await dialog.getByLabel("Client ID").fill(p.clientId);
  await dialog.getByLabel("Client secret").fill(`fixture-${STAMP}`);
  await dialog.getByRole("button", { name: "Register provider" }).click();
  await dialog.waitFor({ state: "hidden", timeout: 30000 });
  setting("identity provider registered", { providerId: p.providerId, domains: p.domains });
}
async function removeProvider(page, p) {
  await openAuthentication(page);
  await identityProvider(page)
    .getByRole("button", { name: `Remove ${p.name}` })
    .click();
  await identityProvider(page)
    .getByRole("button", { name: `Remove ${p.name}` })
    .waitFor({ state: "detached", timeout: 15000 });
  setting("identity provider removed", { providerId: p.providerId });
}
async function providersNow(page) {
  return ((await pageApi(page, "GET", "/auth/sso-providers")).body?.providers ?? []).map(
    (x) => x.providerId,
  );
}
/** Continue with single sign-on from a sign-in page as the chosen identity. Returns what happened. */
async function ssoRoundTrip(page, portal, identity, { fillEmail = true } = {}) {
  await idpIdentity(...identity);
  await openLogin(page, portal);
  const start = page.url();
  const byEmail = (await page.locator("#sso-email").count()) > 0;
  if (byEmail && fillEmail) await page.locator("#sso-email").fill(identity[1]);
  await page.getByRole("button", { name: "Continue with single sign-on" }).click();
  await page
    .waitForURL(
      (u) =>
        u.href !== start &&
        u.host === new URL(BASE).host &&
        !u.pathname.startsWith("/api/auth/sso") &&
        (!/\/(auth|portal)\/login$/.test(u.pathname) || u.searchParams.has("error")),
      { timeout: 30000 },
    )
    .catch(() => {});
  await settle(page);
  const url = new URL(page.url());
  const me = await pageApi(page, "GET", "/me");
  return {
    byEmail,
    issuer: await lastIssuer(),
    path: url.pathname,
    me: me.status,
    role: me.body?.user?.role ?? null,
    email: me.body?.user?.email ?? null,
  };
}
async function adminContext(email = SEED.daniel.email) {
  const c = await newContext();
  await openLogin(c.page);
  await fillLogin(c.page, email, PASSWORD);
  check(await leftAuth(c.page), `Administrator ${email} did not sign in`);
  return c;
}
async function inviteAndActivate(adminSession, { email, displayName, role, password }) {
  const since = Date.now();
  const inv = must(
    await call(adminSession, "POST", "/auth/invites", { email, displayName, role }),
    "invite",
  );
  const m = await waitForLink(email, since, { subjectRe: /password/i, linkRe: /set-password/ });
  const c = await newContext();
  await c.page.goto(m.link);
  await c.page.getByLabel("New password").fill(password);
  await c.page.getByLabel("Confirm password").fill(password);
  await c.page.getByRole("button", { name: "Set password" }).click();
  await c.page.getByText("Password set").waitFor({ timeout: 15000 });
  await c.context.close();
  created(`${role} account ${email} (${displayName}), activated`);
  return { email, displayName, role, password, userId: inv.user.id };
}

/** Records an observation made across several actions in one guide step. */
const rec = (article, role, id, expected, actual, pass, page) =>
  step(article, role, id, id, expected, async () => {
    if (!pass) throw new Error(actual);
    return { page, actual };
  });
async function guarded(article, role, what, fn) {
  try {
    await fn();
  } catch (e) {
    console.error(
      String(e.stack ?? e.message)
        .split("\n")
        .slice(0, 6)
        .join("\n"),
    );
    await rec(
      article,
      role,
      `script stopped: ${what}`,
      "the section completes",
      String(e.message).split("\n")[0],
      false,
      null,
    );
  }
}

// =====================================================================================
// staff: V-C01 per role (password invitation, sign-in, two-factor, sessions, links, lockouts)
// =====================================================================================
async function staff() {
  const daniel = await apiSession(SEED.daniel.email);
  for (const role of ["administrator", "legal_team_member"]) {
    await guarded(S, role, "staff", () => staffRole(daniel, role));
  }

  // Check your email does not confirm eligibility (address outside the allowed domains, no account).
  await guarded(S, "administrator", "neutral", async () => {
    const c = await newContext();
    const ghost = `doc032.bridge.nobody.${STAMP}@outside-domain.example`;
    await openLogin(c.page);
    await c.page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await c.page.getByLabel("Email").fill(ghost);
    const since = Date.now();
    await c.page.getByRole("button", { name: "Send link" }).click();
    const n1 = await seen(c.page.getByText("Check your email"));
    await openLogin(c.page);
    await c.page.getByRole("button", { name: "Set up or reset your password" }).click();
    await c.page.getByLabel("Email").fill(ghost);
    await c.page.getByRole("button", { name: "Send password setup link" }).click();
    const n2 = await seen(c.page.getByText("Check your email"));
    await sleep(5000);
    const mails = (await mailSince(ghost, since)).length;
    await rec(
      S,
      "administrator",
      "Check your email appears whether or not the address is eligible",
      "An ineligible address gets the same Check your email page for Send link and Send password setup link, and no email",
      `Signed out, for ${ghost}: Send link showed Check your email ${n1}; Send password setup link showed Check your email ${n2}; Mailpit messages to the address after 5 s: ${mails}`,
      n1 && n2 && mails === 0,
      "/auth/login",
    );
    await c.context.close();
  });

  // This sign-in link could not be used: an account archived after it requested a link.
  await guarded(S, "legal_team_member", "archived", async () => {
    const acct = await inviteAndActivate(daniel, {
      email: `doc032.bridge.c01.archived.${STAMP}@helix.example`,
      displayName: `${TAG} V-C01 ${STAMP} Archived Member`,
      role: "legal_team_member",
      password: `Doc032-archived-${STAMP}`,
    });
    await waitForBudget(1);
    const c = await newContext();
    await openLogin(c.page);
    await c.page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await c.page.getByLabel("Email").fill(acct.email);
    const since = Date.now();
    await c.page.getByRole("button", { name: "Send link" }).click();
    const m = await waitForLink(acct.email, since, { subjectRe: /Sign in/i, linkRe: /magic-link/ });
    const arch = await call(daniel, "POST", `/users/${acct.userId}/archive`);
    created(`legal_team_member account ${acct.email} archived by this walkthrough`);
    await c.page.goto(m.link);
    await sleep(2500);
    const where = pathOf(c.page);
    const shown = await seen(
      c.page.getByText(
        "This sign-in link could not be used. Request a new link or contact your administrator.",
      ),
    );
    await rec(
      S,
      "legal_team_member",
      "If the sign-in page shows This sign-in link could not be used",
      "OpenLaw refuses the sign-in for an archived account; the sign-in page shows This sign-in link could not be used. Request a new link or contact your administrator.",
      `Link emailed ${!!m?.link}; the Administrator archived the account (API ${arch.status}) before the link was opened; the link ended on ${where}; message shown ${shown}`,
      !!m?.link && arch.status === 200 && where === "/auth/login" && shown,
      "/auth/login",
    );
    await c.context.close();
  });
}

async function staffRole(daniel, role) {
  const short = role === "administrator" ? "admin" : "member";
  const email = `doc032.bridge.c01.${short}.${STAMP}@helix.example`;
  const displayName = `${TAG} V-C01 ${STAMP} ${role === "administrator" ? "Administrator" : "Legal Team Member"}`;
  const pw1 = `Doc032-${short}-first-${STAMP}`;
  const pw2 = `Doc032-${short}-reset-${STAMP}`;
  const R = (id, expected, actual, pass, page) => rec(S, role, id, expected, actual, pass, page);

  // Fixture: the seeded Administrator invites the account (API).
  let since = Date.now();
  const inv = await call(daniel, "POST", "/auth/invites", { email, displayName, role });
  const userId = inv.body?.user?.id;
  created(`${role} account ${email} (${displayName})`);
  const mail1 = await waitForLink(email, since, { subjectRe: /password/i, linkRe: /set-password/ });
  const fragment = !!mail1?.link && new URL(mail1.link).hash.startsWith("#token=");
  await R(
    "Accept a password invitation, step 1: the invitation email",
    "Email Set your OpenLaw password with a Set password control; the link expires in one hour",
    `Invite API ${inv.status}; subject "${mail1?.subject}"; HTML has a Set password control ${/Set password/.test(mail1?.html ?? "")}; text says "${((mail1?.text ?? "").match(/The link expires in one hour\./) ?? ["(no expiry line)"])[0]}"; the link opens /auth/set-password with the token in the URL fragment ${fragment}`,
    inv.status === 201 &&
      mail1?.subject === "Set your OpenLaw password" &&
      /Set password/.test(mail1?.html ?? "") &&
      /The link expires in one hour\./.test(mail1?.text ?? "") &&
      fragment,
    "Mailpit",
  );

  // If it does not work: an expired link. Test preparation expires this account's own token.
  sql(
    `update verifications set expires_at = now() - interval '1 minute' where value = '${userId}'`,
  );
  const c1 = await newContext();
  const p = c1.page;
  await p.goto(mail1.link);
  await p.getByLabel("New password").fill(pw1);
  await p.getByLabel("Confirm password").fill(pw1);
  await p.getByRole("button", { name: "Set password" }).click();
  const expired = await seen(
    p.getByText("This link has expired or was already used. Ask for a new one."),
  );
  await R(
    "If it does not work: an expired invitation link",
    "This link has expired or was already used. Ask for a new one.",
    expired
      ? "Set password on an invitation whose token had expired (test preparation moved this account's token expiry one minute into the past) showed: This link has expired or was already used. Ask for a new one."
      : `Not shown: ${(await text(p.locator("main"))).slice(0, 200)}`,
    expired,
    "/auth/set-password",
  );

  await p.goto(`${BASE}/auth/set-password`);
  const partial = await seen(
    p.getByText("This link is not valid. Ask for a new invitation or password reset."),
  );
  await R(
    "If it does not work: the browser opened only part of the link",
    "This link is not valid. Ask for a new invitation or password reset.",
    partial
      ? "Opening /auth/set-password without the #token fragment showed: This link is not valid. Ask for a new invitation or password reset."
      : `Not shown: ${(await text(p.locator("main"))).slice(0, 200)}`,
    partial,
    "/auth/set-password",
  );

  since = Date.now();
  const resend = await call(daniel, "POST", "/auth/invites", { email, displayName, role });
  const mail2 = await waitForLink(email, since, { subjectRe: /password/i, linkRe: /set-password/ });
  await R(
    "fixture: the Administrator sends a fresh invitation",
    "A new Set your OpenLaw password email",
    `Invite API ${resend.status}; subject "${mail2?.subject}"`,
    resend.status < 300 && !!mail2?.link,
    "Mailpit",
  );

  await p.goto(mail2.link);
  await p.getByLabel("New password").fill(pw1);
  await p.getByLabel("Confirm password").fill(`${pw1}x`);
  await p.getByRole("button", { name: "Set password" }).click();
  const mismatch = await seen(p.getByText("The passwords do not match."));
  await R(
    "If it does not work: passwords that do not match",
    "The passwords do not match.",
    mismatch
      ? "Different values in New password and Confirm password showed: The passwords do not match."
      : "Not shown",
    mismatch,
    "/auth/set-password",
  );
  const hint = await text(p.locator("main"));
  await p.getByLabel("Confirm password").fill(pw1);
  await p.getByRole("button", { name: "Set password" }).click();
  const setOk = await seen(p.getByText("Password set", { exact: true }), 15000);
  const signInCtl = p
    .getByRole("link", { name: "Sign in", exact: true })
    .or(p.getByRole("button", { name: "Sign in", exact: true }));
  const hasSignIn = setOk && (await signInCtl.count()) > 0;
  await R(
    "Accept a password invitation, steps 2-5",
    "New password (at least eight characters), Confirm password, Set password, then Password set with Sign in",
    `Form hint mentions eight characters ${/8 characters|eight characters/.test(hint)}; Password set ${setOk}; Sign in control ${hasSignIn}`,
    setOk && hasSignIn && /8 characters|eight characters/.test(hint),
    "/auth/set-password",
  );
  await signInCtl.first().click();
  await p.waitForURL(/\/auth\/login/, { timeout: 15000 });
  await settle(p);

  const brand = await brandingAbove(p, "Sign in");
  await R(
    "Introduction: the sign-in page shows the organization's name above the form, and its logo if saved",
    "Organization name above the Sign in form; a logo only when the Administrator saved one",
    `Public branding answer name "${brand.apiName}", logo ${brand.apiLogo}; name shown ${brand.nameShown}; above the Sign in heading and form ${brand.above}; Organization logo images ${brand.logoCount}`,
    brand.apiName.length > 0 &&
      brand.nameShown &&
      brand.above &&
      (brand.apiLogo === "saved" ? brand.logoCount === 1 : brand.logoCount === 0),
    "/auth/login",
  );

  await fillLogin(p, email, `${pw1}wrong`);
  const wrongPw = await seen(p.getByText("Check your email and password."));
  await fillLogin(p, email, pw1);
  const in6 = await leftAuth(p);
  const landed = pathOf(p);
  const menu = await openMenu(p, displayName);
  const menuText = await text(menu);
  await p.keyboard.press("Escape");
  const orgName = await p
    .getByRole("banner")
    .getByText(brand.apiName, { exact: true })
    .isVisible()
    .catch(() => false);
  await p.setViewportSize({ width: 700, height: 900 });
  await sleep(500);
  const orgNarrow = await p
    .getByRole("banner")
    .getByText(brand.apiName, { exact: true })
    .isVisible()
    .catch(() => false);
  await p.setViewportSize({ width: 1440, height: 900 });
  await R(
    "Accept a password invitation, step 6 and the check after it",
    "A wrong password shows Check your email and password.; Email and Password with Sign in reach the app; the name menu (photo or initials) shows name and email; a wide window shows the organization's name in the header",
    `Wrong password message ${wrongPw}; landed on ${landed} ${in6}; name menu "${menuText}"; organization name "${brand.apiName}" in the header at 1440 px ${orgName}, at 700 px ${orgNarrow}`,
    wrongPw &&
      in6 &&
      menuText.includes(displayName) &&
      menuText.includes(email) &&
      orgName &&
      !orgNarrow,
    landed,
  );

  const used = await newContext();
  await used.page.goto(mail2.link);
  await used.page.getByLabel("New password").fill(pw2);
  await used.page.getByLabel("Confirm password").fill(pw2);
  await used.page.getByRole("button", { name: "Set password" }).click();
  const usedRefused = await seen(
    used.page.getByText("This link has expired or was already used. Ask for a new one."),
  );
  await used.context.close();
  await R(
    "A successful activation consumes the invitation link",
    "Reopening the used link shows This link has expired or was already used. Ask for a new one.",
    usedRefused
      ? "The used invitation link, opened in a new browser, was refused with the expired-or-used message"
      : "The used link was not refused",
    usedRefused,
    "/auth/set-password",
  );

  // Turn on two-factor authentication, steps 1-8.
  await openProfile(p, displayName);
  const off0 = await seen(p.getByText("Two-factor is off"), 5000);
  const e1 = await enroll(p, pw1);
  await e1.dialog.getByLabel("Code").fill(wrongCode(e1.secret));
  await e1.dialog.getByRole("button", { name: "Confirm" }).click();
  const enrollWrong = await seen(
    e1.dialog.getByText("Wrong code. Scan the QR code again and retry."),
    8000,
  );
  const codes = await confirmEnroll(p, e1.dialog, e1.secret);
  const onMsg = await seen(p.getByText("Two-factor is on"));
  await R(
    "Turn on two-factor authentication, steps 1-8",
    "Settings from the name menu; Profile under Personal; Password & two-factor; Turn on two-factor; Password and Continue; QR code or manual secret; Code and Confirm; backup codes; Done; Profile says two-factor is on",
    `Profile said off before ${off0}; QR ${e1.qr > 0}; manual secret shown ${e1.secret.length >= 16}; a wrong code was refused ${enrollWrong}; backup codes shown ${codes.length}; after Done Profile says on ${onMsg}`,
    off0 && e1.qr > 0 && e1.secret.length >= 16 && enrollWrong && codes.length === 10 && onMsg,
    "/settings/profile",
  );

  await signOutViaMenu(p, displayName);
  await fillLogin(p, email, pw1);
  const chOpen = await p.waitForURL(/\/auth\/two-factor/, { timeout: 15000 }).then(
    () => true,
    () => false,
  );
  const chTitle = await seen(p.getByRole("heading", { name: "Two-factor authentication" }));
  await p.getByLabel("Code").fill(wrongCode(e1.secret));
  await p.getByRole("button", { name: "Verify" }).click();
  const chWrong = await seen(p.getByText("Wrong code. Try again, or restart sign-in."));
  await p.getByLabel("Code").fill(await code(e1.secret));
  await p.getByRole("button", { name: "Verify" }).click();
  const chOk = await leftAuth(p);
  await R(
    "Sign in with a second factor, steps 1-3",
    "Password sign-in opens Two-factor authentication; a wrong code shows Wrong code. Try again, or restart sign-in.; the current Code with Verify signs in",
    `Challenge ${chOpen && chTitle}; wrong code message ${chWrong}; current code reached ${pathOf(p)} ${chOk}`,
    chOpen && chTitle && chWrong && chOk,
    "/auth/two-factor",
  );

  await signOutViaMenu(p, displayName);
  await fillLogin(p, email, pw1);
  await p.waitForURL(/\/auth\/two-factor/, { timeout: 15000 });
  await p.getByRole("button", { name: "Use a backup code" }).click();
  await p.getByLabel("Backup code").fill(codes[0]);
  await p.getByRole("button", { name: "Verify" }).click();
  const bOk = await leftAuth(p);
  await signOutViaMenu(p, displayName);
  await fillLogin(p, email, pw1);
  await p.waitForURL(/\/auth\/two-factor/, { timeout: 15000 });
  await p.getByRole("button", { name: "Use a backup code" }).click();
  await p.getByLabel("Backup code").fill(codes[0]);
  await p.getByRole("button", { name: "Verify" }).click();
  const replayMsg = await seen(p.getByText("Wrong code. Try again, or restart sign-in."));
  const bReplay = /\/auth\/two-factor/.test(p.url());
  await p.getByRole("button", { name: "Sign out" }).click();
  const chOut = await p.waitForURL(/\/auth\/login/, { timeout: 15000 }).then(
    () => true,
    () => false,
  );
  await p.goto(`${BASE}/`);
  await sleep(1500);
  const stillOut = /\/auth\//.test(p.url());
  await R(
    "Use a backup code once; Sign out on the challenge restarts sign-in",
    "Use a backup code, an unused Backup code and Verify sign in; the same code cannot be reused; Sign out returns to sign-in",
    `First use reached the app ${bOk}; reuse stayed on the challenge ${bReplay} with Wrong code. Try again, or restart sign-in. ${replayMsg}; Sign out -> sign-in ${chOut}; / afterwards needs sign-in ${stillOut}`,
    bOk && bReplay && replayMsg && chOut && stillOut,
    "/auth/two-factor",
  );

  // End or recover a session: Sign out other devices.
  const signIn2fa = async (pg) => {
    await fillLogin(pg, email, pw1);
    await pg.waitForURL(/\/auth\/two-factor/, { timeout: 15000 });
    await pg.getByLabel("Code").fill(await code(e1.secret));
    await pg.getByRole("button", { name: "Verify" }).click();
    return leftAuth(pg);
  };
  await signIn2fa(p);
  const other = await newContext();
  await other.page.goto(`${BASE}/auth/login`);
  const otherIn = await signIn2fa(other.page);
  await openProfile(p, displayName);
  await p.getByRole("button", { name: "Sign out other devices" }).click();
  const sessSaved = await seen(p.getByText("Saved", { exact: true }));
  await sleep(1000);
  await other.page.reload();
  const otherOut = await other.page.waitForURL(/\/auth\/login/, { timeout: 15000 }).then(
    () => true,
    () => false,
  );
  await p.reload();
  await sleep(1500);
  const thisIn = /\/settings\/profile/.test(p.url());
  await other.context.close();
  await R(
    "End or recover a session: Settings → Profile → Sign out other devices; a revoked session goes to sign-in",
    "The other browser's session ends and reload sends it to sign-in; this session stays",
    `Second browser signed in ${otherIn}; Saved ${sessSaved}; second browser reload -> sign-in ${otherOut}; this browser still on Profile ${thisIn}`,
    otherIn && otherOut && thisIn,
    "/settings/profile",
  );

  // Re-enroll: abandon before confirming.
  await p.getByRole("button", { name: "Re-enroll" }).click();
  const d2 = p.getByRole("dialog");
  await d2.getByLabel("Password").fill(pw1);
  await d2.getByRole("button", { name: "Continue" }).click();
  await d2.getByText("No camera? Enter this secret manually").waitFor({ timeout: 15000 });
  const secret2 = (await text(d2.getByText("No camera? Enter this secret manually")))
    .split(":")
    .pop()
    .trim();
  await p.keyboard.press("Escape");
  await d2.waitFor({ state: "hidden" });
  await p.reload();
  const offAfterAbandon = await seen(p.getByText("Two-factor is off"));
  await signOutViaMenu(p, displayName);
  await fillLogin(p, email, pw1);
  const noChallenge = await leftAuth(p);
  await R(
    "Re-enroll turns off the old authenticator; closing before a new code leaves two-factor off",
    "Re-enroll and the password give a new secret; after closing the dialog Profile says two-factor is off and the password alone signs in",
    `New secret differs ${secret2 !== e1.secret}; Profile off ${offAfterAbandon}; password-only sign-in reached the app ${noChallenge}`,
    secret2 !== e1.secret && offAfterAbandon && noChallenge,
    "/settings/profile",
  );

  // Turn off two-factor needs the password.
  await openProfile(p, displayName);
  const e3 = await enroll(p, pw1);
  await confirmEnroll(p, e3.dialog, e3.secret);
  await p.getByRole("button", { name: "Turn off two-factor" }).click();
  const d3 = p.getByRole("dialog");
  await d3.getByLabel("Password").fill(`${pw1}nope`);
  await d3.getByRole("button", { name: "Continue" }).click();
  const offWrong = await seen(d3.getByText("Check your password."), 8000);
  await d3.getByLabel("Password").fill(pw1);
  await d3.getByRole("button", { name: "Continue" }).click();
  await d3.waitFor({ state: "hidden", timeout: 10000 });
  const offNow = await seen(p.getByText("Two-factor is off"));
  await signOutViaMenu(p, displayName);
  const back = /\/auth\/login/.test(p.url());
  await fillLogin(p, email, pw1);
  const pwOnly = await leftAuth(p);
  await R(
    "Turn off two-factor requires the password; Sign out in the name menu ends the session",
    "A wrong password is refused; the right one turns two-factor off; password sign-in has no challenge; Sign out returns to sign-in",
    `Wrong password message Check your password. ${offWrong}; Profile off ${offNow}; Sign out -> sign-in ${back}; password-only sign-in ${pwOnly}`,
    offWrong && offNow && back && pwOnly,
    "/settings/profile",
  );

  // Email me a sign-in link, the expired-link page, then the three-per-address budget.
  await signOutViaMenu(p, displayName);
  await waitForBudget(4);
  await p.getByRole("button", { name: "Email me a sign-in link" }).click();
  await p.getByLabel("Email").fill(email);
  since = Date.now();
  await p.getByRole("button", { name: "Send link" }).click();
  const sent1 = await seen(p.getByText("Check your email"));
  const ml1 = await waitForLink(email, since, { subjectRe: /Sign in/i, linkRe: /magic-link/ });
  const lifetime = sql(
    `select round(extract(epoch from (expires_at - created_at))/60) from verifications where value like '%${email}%' order by created_at desc limit 1`,
  );
  await p.goto(ml1.link);
  const mlIn = await leftAuth(p);
  await signOutViaMenu(p, displayName);
  await p.goto(ml1.link);
  const expiredPage = await seen(p.getByRole("heading", { name: "Sign-in link expired" }), 15000);
  const expiredText = await text(p.locator("main"));
  const expiredControls = await controlsOf(p);
  const hasEmail = (await p.locator("main").getByLabel("Email").count()) > 0;
  const hasBack = (await p.getByRole("link", { name: "Back to sign-in" }).count()) > 0;
  await R(
    "Use your organization's sign-in method: Email me a sign-in link; the link works once",
    "Email, Send link, Check your email; Sign in in the newest email signs in within five minutes; the link works once; a used link opens Sign-in link expired with Email and Send link while links are on and email works",
    `Check your email ${sent1}; subject "${ml1?.subject}"; email has a Sign in control ${/Sign in/.test(ml1?.html ?? "")}; token lifetime ${lifetime} min; the link signed in ${mlIn}; reuse after sign-out opened "${expiredText.slice(0, 140)}" with controls [${expiredControls.join(", ")}], Email ${hasEmail}, Back to sign-in ${hasBack}`,
    sent1 &&
      mlIn &&
      expiredPage &&
      /Sign in/.test(ml1?.html ?? "") &&
      lifetime === "5" &&
      hasEmail &&
      !hasBack,
    "/auth/link-expired",
  );

  await p.locator("main").getByLabel("Email").fill(email);
  since = Date.now();
  await p.getByRole("button", { name: "Send link" }).click();
  const sent2 = await seen(p.getByText("Check your email"));
  const ml2 = await waitForLink(email, since, { subjectRe: /Sign in/i, linkRe: /magic-link/ });
  await p.goto(ml2.link);
  const ml2In = await leftAuth(p);
  await signOutViaMenu(p, displayName);
  await R(
    "Sign-in link expired: enter your email and select Send link to get a new link",
    "Send link on Sign-in link expired sends a new link that signs in",
    `Check your email ${sent2}; new email "${ml2?.subject}"; the new link signed in ${ml2In}`,
    sent2 && ml2In,
    "/auth/link-expired",
  );

  const requestLink = async () => {
    await openLogin(p);
    await p.getByRole("button", { name: "Email me a sign-in link" }).click();
    await p.getByLabel("Email").fill(email);
    await p.getByRole("button", { name: "Send link" }).click();
    await sleep(1500);
    return text(p.locator("main"));
  };
  const third = await requestLink();
  const fourth = await requestLink();
  await R(
    "Sign-in link budget: three links for one email address in 15 minutes",
    "The fourth request shows Too many sign-in link requests. Try again later.",
    `Third request: "${third.slice(0, 90)}"; fourth request: "${fourth.slice(0, 160)}"`,
    third.includes("Check your email") &&
      fourth.includes("Too many sign-in link requests. Try again later."),
    "/auth/login",
  );

  // Forgotten password: session revocation and the setup-request budget.
  const holder = await newContext();
  await openLogin(holder.page);
  await fillLogin(holder.page, email, pw1);
  const holderIn = await leftAuth(holder.page);
  await openLogin(p);
  await p.getByRole("button", { name: "Set up or reset your password" }).click();
  await p.getByLabel("Email").fill(email);
  since = Date.now();
  await p.getByRole("button", { name: "Send password setup link" }).click();
  const neutral = await seen(p.getByText("Check your email"));
  const reset = await waitForLink(email, since, { subjectRe: /password/i, linkRe: /set-password/ });
  const expiresRow = sql(
    `select round(extract(epoch from (expires_at - created_at))/60) from verifications where value = '${userId}' order by created_at desc limit 1`,
  );
  await p.goto(reset.link);
  await p.getByLabel("New password").fill(pw2);
  await p.getByLabel("Confirm password").fill(pw2);
  await p.getByRole("button", { name: "Set password" }).click();
  const resetSet = await seen(p.getByText("Password set", { exact: true }), 15000);
  await holder.page.reload();
  const holderOut = await holder.page.waitForURL(/\/auth\/login/, { timeout: 15000 }).then(
    () => true,
    () => false,
  );
  await holder.context.close();
  await openLogin(p);
  await fillLogin(p, email, pw1);
  const oldRefused = await seen(p.getByText("Check your email and password."));
  await fillLogin(p, email, pw2);
  const newOk = await leftAuth(p);
  await R(
    "If you forgot your password: Set up or reset your password",
    "Below the password form; Email and Send password setup link; Check your email; Set password in the email within one hour sets a new password; the new password signs out every session",
    `Check your email ${neutral}; email "${reset?.subject}"; token lifetime ${expiresRow} min; Password set ${resetSet}; a browser signed in before the reset was sent to sign-in on reload ${holderIn && holderOut}; old password refused ${oldRefused}; new password signed in ${newOk}`,
    neutral &&
      reset?.subject === "Set your OpenLaw password" &&
      expiresRow === "60" &&
      resetSet &&
      holderIn &&
      holderOut &&
      oldRefused &&
      newOk,
    "/auth/set-password",
  );
  await signOutViaMenu(p, displayName);
  const setupRequest = async () => {
    await openLogin(p);
    await p.getByRole("button", { name: "Set up or reset your password" }).click();
    await p.getByLabel("Email").fill(email);
    await p.getByRole("button", { name: "Send password setup link" }).click();
    await sleep(1500);
    return text(p.locator("main"));
  };
  await waitForBudget(3, "password-setup");
  const s2 = await setupRequest();
  const s3 = await setupRequest();
  const s4 = await setupRequest();
  await R(
    "Password setup budget: three setup emails for one email address in 15 minutes",
    "The fourth request shows Too many password setup requests. Try again later.",
    `Second: "${s2.slice(0, 60)}"; third: "${s3.slice(0, 60)}"; fourth: "${s4.slice(0, 120)}"`,
    s2.includes("Check your email") &&
      s3.includes("Check your email") &&
      s4.includes("Too many password setup requests. Try again later."),
    "/auth/login",
  );

  // Wrong passwords: a success before the limit resets the count; ten close password sign-in.
  await openLogin(p);
  for (let i = 0; i < 9; i++) {
    await fillLogin(p, email, `${pw2}-wrong-${i}`);
    await p.getByText("Check your email and password.").waitFor({ timeout: 10000 });
  }
  const failures = () =>
    sql(
      `select coalesce(max(value::int),0) from verifications where identifier = 'password-sign-in-failures:' || encode(sha256(convert_to(lower('${email}'),'UTF8')),'hex') and expires_at > now()`,
    );
  const before = failures();
  await fillLogin(p, email, pw2);
  const resetOk = await leftAuth(p);
  const after = failures();
  await signOutViaMenu(p, displayName);

  // Two-factor lockout while the account has two-factor on.
  await fillLogin(p, email, pw2);
  await leftAuth(p);
  await openProfile(p, displayName);
  const e4 = await enroll(p, pw2);
  await confirmEnroll(p, e4.dialog, e4.secret);
  await signOutViaMenu(p, displayName);
  const attempts = [];
  let locked = false;
  for (let round = 0; round < 3 && !locked; round++) {
    await fillLogin(p, email, pw2);
    await p.waitForURL(/\/auth\/two-factor/, { timeout: 15000 });
    for (let i = 0; i < 5 && !locked; i++) {
      await p.getByLabel("Code").fill(wrongCode(e4.secret));
      await p.getByRole("button", { name: "Verify" }).click();
      await sleep(1200);
      const body = await text(p.locator("main"));
      const msg = body.includes("Too many attempts. Wait 15 minutes, then try again.")
        ? "locked"
        : body.includes("Wrong code. Try again, or restart sign-in.")
          ? "wrong"
          : "other";
      attempts.push(msg);
      if (msg === "locked") locked = true;
    }
    if (!locked) {
      await p.getByRole("button", { name: "Sign out" }).click();
      await p.waitForURL(/\/auth\/login/, { timeout: 15000 });
    }
  }
  let rightRefused = false;
  if (locked) {
    await p.getByLabel("Code").fill(await code(e4.secret));
    await p.getByRole("button", { name: "Verify" }).click();
    await sleep(1500);
    rightRefused =
      (await text(p.locator("main"))).includes(
        "Too many attempts. Wait 15 minutes, then try again.",
      ) && /\/auth\/two-factor/.test(p.url());
    await p.getByRole("button", { name: "Sign out" }).click();
    await p.waitForURL(/\/auth\/login/, { timeout: 15000 });
  }
  const wrongBeforeLock = attempts.filter((a) => a === "wrong").length;
  await R(
    "Sign in with a second factor: after 10 wrong codes the page shows Too many attempts",
    "Wrong codes show Wrong code. Try again, or restart sign-in.; after 10 wrong codes the page shows Too many attempts. Wait 15 minutes, then try again.",
    `Attempt messages in order (Sign out and password sign-in between rounds of five): ${attempts.join(", ")}; wrong-code messages before the lock ${wrongBeforeLock}; the current code during the lock was also refused ${rightRefused}`,
    locked && wrongBeforeLock === 10 && rightRefused,
    "/auth/two-factor",
  );

  const pwMsgs = [];
  for (let i = 0; i < 11; i++) {
    await fillLogin(p, email, `${pw2}-bad-${i}`);
    await sleep(1200);
    const body = await text(p.locator("main"));
    pwMsgs.push(
      body.includes("Too many attempts. Wait 15 minutes, then try again.")
        ? "locked"
        : body.includes("Check your email and password.")
          ? "wrong"
          : "other",
    );
  }
  await fillLogin(p, email, pw2);
  await sleep(2000);
  const correctLocked =
    /\/auth\/login/.test(p.url()) &&
    (await text(p.locator("main"))).includes("Too many attempts. Wait 15 minutes, then try again.");
  await R(
    "End or recover a session: wrong passwords and the 15-minute lock",
    "A wrong password shows Check your email and password.; a successful sign-in before the limit resets the count; after 10 wrong passwords the page shows Too many attempts. Wait 15 minutes, then try again., even for the correct password",
    `9 wrong passwords left a live failure count of ${before}; the correct password then signed in ${resetOk} and the count became ${after}. Then 11 wrong passwords showed: ${pwMsgs.join(", ")}; the correct password afterwards stayed on sign-in with Too many attempts ${correctLocked}`,
    before === "9" &&
      resetOk &&
      after === "0" &&
      pwMsgs.slice(0, 10).every((m) => m === "wrong") &&
      pwMsgs[10] === "locked" &&
      correctLocked,
    "/auth/login",
  );
  await c1.context.close();
}

// =====================================================================================
// staffSso: V-C01 organization sign-in methods, on the owned lab only
// =====================================================================================
async function staffSso() {
  check(OIDC_IP, "The bacc OIDC fixture is not running (phase.sh oidc)");
  const daniel = await apiSession(SEED.daniel.email);
  // Daniel's browser session is the Administrator session held in another browser context.
  const D = await adminContext();
  const legalDefault = { password: true, magicLink: true, sso: false, requireTwoFactor: false };
  const nadia = { email: SEED.nadia.email, name: SEED.nadia.name };

  // ---- Single sign-on is not configured yet: the legacy unsaved-policy fallback.
  await guarded(S, "legal_team_member", "sso-not-configured", async () => {
    const saved = sql(
      `select coalesce(authentication_policy::text,'null')||'|'||auth_mode from org_settings`,
    );
    check(saved.startsWith("null|built_in"), `unexpected start state ${saved}`);
    // Fault injection on the owned lab: no saved policy, legacy mode oidc, no identity provider.
    sql(`update org_settings set auth_mode = 'oidc'`);
    setting(
      "fault injection: org_settings.auth_mode = oidc with no saved policy and no provider",
      saved,
    );
    try {
      for (const [role, who] of [
        ["legal_team_member", nadia],
        ["administrator", { email: SEED.daniel.email, name: SEED.daniel.name }],
      ]) {
        await step(
          S,
          role,
          "Single sign-on is not configured yet; Administrator sign-in",
          "Open the sign-in page while single sign-on is on and no identity provider is connected; try Administrator sign-in",
          "The page says Single sign-on is not configured yet; Administrator sign-in opens the password form; only an Administrator signs in with a password, a Legal Team Member sees Password sign-in is disabled for this account.",
          async () => {
            const c = await newContext();
            await openLogin(c.page);
            const body = await text(c.page.locator("main"));
            const offered = await buttons(c.page);
            await c.page.getByRole("button", { name: "Administrator sign-in" }).click();
            const form = (await c.page.getByLabel("Password", { exact: true }).count()) > 0;
            await c.page.getByLabel("Email", { exact: true }).fill(who.email);
            await c.page.getByLabel("Password", { exact: true }).fill(PASSWORD);
            await c.page.getByRole("button", { name: "Sign in", exact: true }).click();
            const outcome = await Promise.race([
              c.page
                .waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 15000 })
                .then(() => "signed-in"),
              c.page
                .getByText("Password sign-in is disabled for this account.")
                .waitFor({ timeout: 15000 })
                .then(() => "disabled"),
            ]).catch(() => "timeout");
            await c.context.close();
            check(body.includes("Single sign-on is not configured yet"), body.slice(0, 200));
            check(
              form && outcome === (role === "administrator" ? "signed-in" : "disabled"),
              `form ${form} outcome ${outcome}`,
            );
            return {
              page: "/auth/login",
              actual: `The staff sign-in page read "${body.slice(0, 160)}" with buttons ${JSON.stringify(offered)}. Administrator sign-in opened the password form (${form}); ${who.name} entered Email and Password and Sign in gave: ${outcome === "disabled" ? "Password sign-in is disabled for this account." : "signed in"}.`,
            };
          },
        );
      }
    } finally {
      sql(`update org_settings set auth_mode = 'built_in'`);
      setting("fault injection reverted: org_settings.auth_mode = built_in", null);
    }
  });

  // ---- Fixture accounts for single sign-on: invited, never activated, so the identity provider is their first sign-in.
  const ssoAccount = async (role, domain = "helix.example") => {
    const short = role === "administrator" ? "admin" : "member";
    const email = `doc032.bridge.sso.${short}.${STAMP}@${domain}`;
    const displayName = `${TAG} V-C01 ${STAMP} SSO ${domain === "helix.example" ? "" : "Harbor "}${role === "administrator" ? "Administrator" : "Legal Team Member"}`;
    must(
      await call(daniel, "POST", "/auth/invites", { email, displayName, role }),
      `invite ${email}`,
    );
    created(
      `${role} account ${email} (${displayName}), invited; first sign-in through the identity provider`,
    );
    return {
      role,
      email,
      displayName,
      identity: [`doc032-bridge-${short}-${domain}-${STAMP}`, email, displayName],
    };
  };
  const ssoUsers = {
    administrator: await ssoAccount("administrator"),
    legal_team_member: await ssoAccount("legal_team_member"),
  };
  const harbor = await ssoAccount("legal_team_member", "harbor.example");

  // ---- One identity provider.
  await guarded(S, "administrator", "one-provider", async () => {
    await registerProvider(D.page, PROVIDER_A);
    await setPolicy(D.page, "legal", { ...legalDefault, sso: true });
    for (const role of ["administrator", "legal_team_member"]) {
      const u = ssoUsers[role];
      await step(
        S,
        role,
        "Use your organization's sign-in method: Continue with single sign-on (one identity provider)",
        "Select Continue with single sign-on and complete the identity-provider sign-in",
        "One button that opens the identity provider directly; the account reaches its permitted landing page",
        async () => {
          const c = await newContext();
          await openLogin(c.page);
          const offered = await buttons(c.page);
          const emailField = await c.page.locator("#sso-email").count();
          const r = await ssoRoundTrip(c.page, false, u.identity);
          const menu = await text(await openMenu(c.page, u.displayName));
          await c.context.close();
          check(
            offered.includes("Continue with single sign-on") && emailField === 0,
            JSON.stringify(offered),
          );
          check(
            r.issuer === "http://oidc:8080" && r.me === 200 && r.role === role && r.path === "/",
            JSON.stringify(r),
          );
          return {
            page: r.path,
            actual: `The staff sign-in page offered ${JSON.stringify(offered)} and no Email field. Continue with single sign-on went to ${r.issuer} (fixture identity ${u.email}) and back to ${r.path}, signed in as ${r.role}; the name menu read "${menu}".`,
          };
        },
      );
    }
  });

  // ---- Two identity providers: the email address picks the provider.
  await guarded(S, "administrator", "two-providers", async () => {
    await registerProvider(D.page, PROVIDER_B);
    for (const role of ["administrator", "legal_team_member"]) {
      const u = ssoUsers[role];
      await step(
        S,
        role,
        "Use your organization's sign-in method: more than one identity provider",
        "Enter your work address in Email, then select Continue with single sign-on",
        "The page first says Enter your work email. Your organization's identity provider opens next.; OpenLaw opens the identity provider that serves the email domain",
        async () => {
          const c = await newContext();
          await openLogin(c.page);
          const body = await text(c.page.locator("main"));
          const r = await ssoRoundTrip(c.page, false, u.identity);
          await c.context.close();
          check(
            body.includes(
              "Enter your work email. Your organization's identity provider opens next.",
            ),
            body.slice(0, 200),
          );
          check(
            r.byEmail && r.issuer === "http://oidc:8080" && r.me === 200 && r.role === role,
            JSON.stringify(r),
          );
          return {
            page: r.path,
            actual: `With two providers the page read "${body.slice(0, 170)}". ${u.email} in Email and Continue with single sign-on opened ${r.issuer} (the helix.example provider) and signed in as ${r.role} on ${r.path}.`,
          };
        },
      );
    }
    await step(
      S,
      "legal_team_member",
      "More than one identity provider: another domain opens its own provider",
      "Enter a harbor.example work address, then select Continue with single sign-on",
      "OpenLaw opens the identity provider that serves harbor.example",
      async () => {
        const c = await newContext();
        const r = await ssoRoundTrip(c.page, false, harbor.identity);
        await c.context.close();
        check(
          r.byEmail &&
            r.issuer === "http://oidc:8082" &&
            r.me === 200 &&
            r.role === "legal_team_member",
          JSON.stringify(r),
        );
        return {
          page: r.path,
          actual: `${harbor.email} opened ${r.issuer} (the harbor.example provider) and signed in as ${r.role} on ${r.path}.`,
        };
      },
    );
    for (const [role, who] of [
      ["legal_team_member", nadia],
      ["administrator", { email: SEED.daniel.email, name: SEED.daniel.name }],
    ]) {
      await step(
        S,
        role,
        "If no provider serves the domain: No single sign-on provider is set up for {domain}; check the address or use another method that the page offers",
        "Enter an address on an unserved domain and select Continue with single sign-on; then use another method the page offers",
        "No single sign-on provider is set up for unlisted.example. Check the address or contact your administrator.; the other methods stay available",
        async () => {
          const c = await newContext();
          await openLogin(c.page);
          await c.page.locator("#sso-email").fill(`doc032.bridge.${STAMP}@unlisted.example`);
          await c.page.getByRole("button", { name: "Continue with single sign-on" }).click();
          const alert = c.page.getByRole("alert").first();
          await alert.waitFor({ timeout: 15000 });
          const msg = (await alert.innerText()).trim();
          const stayed = pathOf(c.page);
          const others = await buttons(c.page);
          await c.page.getByRole("button", { name: "Sign in with a password" }).click();
          await c.page.getByLabel("Email", { exact: true }).fill(who.email);
          await c.page.getByLabel("Password", { exact: true }).fill(PASSWORD);
          await c.page.getByRole("button", { name: "Sign in", exact: true }).click();
          const ok = await leftAuth(c.page);
          await c.context.close();
          check(
            msg ===
              "No single sign-on provider is set up for unlisted.example. Check the address or contact your administrator." &&
              stayed === "/auth/login" &&
              others.includes("Email me a sign-in link") &&
              others.includes("Sign in with a password") &&
              ok,
            `${msg} ${stayed} ${JSON.stringify(others)} ${ok}`,
          );
          return {
            page: "/auth/login",
            actual: `The page stayed on ${stayed} and showed "${msg}". It still offered ${JSON.stringify(others)}; Sign in with a password as ${who.name} signed in.`,
          };
        },
      );
    }
  });

  // ---- Password sign-in off for staff: Administrator sign-in.
  await guarded(S, "administrator", "break-glass", async () => {
    await setPolicy(D.page, "legal", {
      password: false,
      magicLink: true,
      sso: true,
      requireTwoFactor: false,
    });
    for (const [role, who] of [
      ["administrator", { email: SEED.daniel.email, name: SEED.daniel.name }],
      ["legal_team_member", nadia],
    ]) {
      await step(
        S,
        role,
        "Administrator sign-in opens the password form when the organization does not allow password sign-in for staff",
        "Select Administrator sign-in, enter Email and Password, select Sign in",
        role === "administrator"
          ? "The Administrator signs in with a password"
          : "A Legal Team Member sees Password sign-in is disabled for this account. and must use a method the page offers",
        async () => {
          const c = await newContext();
          await openLogin(c.page);
          const ssoView = await buttons(c.page);
          await c.page.getByRole("button", { name: "Email me a sign-in link" }).click();
          const magicView = await buttons(c.page);
          await c.page.getByRole("button", { name: "Administrator sign-in" }).click();
          const form = (await c.page.getByLabel("Password", { exact: true }).count()) > 0;
          await c.page.getByLabel("Email", { exact: true }).fill(who.email);
          await c.page.getByLabel("Password", { exact: true }).fill(PASSWORD);
          await c.page.getByRole("button", { name: "Sign in", exact: true }).click();
          const outcome = await Promise.race([
            c.page
              .waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 15000 })
              .then(() => "signed-in"),
            c.page
              .getByText("Password sign-in is disabled for this account.")
              .waitFor({ timeout: 15000 })
              .then(() => "disabled"),
          ]).catch(() => "timeout");
          const me = await pageApi(c.page, "GET", "/me");
          await c.context.close();
          check(
            !ssoView.includes("Sign in with a password") &&
              ssoView.includes("Administrator sign-in"),
            JSON.stringify(ssoView),
          );
          check(magicView.includes("Administrator sign-in") && form, JSON.stringify(magicView));
          check(outcome === (role === "administrator" ? "signed-in" : "disabled"), outcome);
          return {
            page: "/auth/login",
            actual: `Legal policy password off, sign-in links and SSO on. The single sign-on view offered ${JSON.stringify(ssoView)}; the Get a sign-in link view offered ${JSON.stringify(magicView)}. Administrator sign-in opened the password form; ${who.name} with Email, Password and Sign in: ${outcome === "disabled" ? "Password sign-in is disabled for this account." : "signed in"} (me ${me.status}).`,
          };
        },
      );
    }
    await setPolicy(D.page, "legal", { ...legalDefault, sso: true });
  });

  // ---- Required two-factor authentication: every sign-in method asks for a code.
  await guarded(S, "administrator", "required-2fa", async () => {
    // Fixture: Daniel enrolls first, so his open session stays usable under the policy.
    await openProfile(D.page, SEED.daniel.name);
    const de = await enroll(D.page, PASSWORD);
    await confirmEnroll(D.page, de.dialog, de.secret);
    setting(
      "Daniel Okafor enrolled two-factor (fixture; turned off again at the end of this step group)",
      null,
    );
    const tfMember = await inviteAndActivate(daniel, {
      email: `doc032.bridge.c01.tf.${STAMP}@helix.example`,
      displayName: `${TAG} V-C01 ${STAMP} Required 2FA Legal Team Member`,
      role: "legal_team_member",
      password: `Doc032-tf-${STAMP}`,
    });
    await setPolicy(D.page, "legal", { ...legalDefault, sso: true, requireTwoFactor: true });
    try {
      const enrollForced = async (c, withPassword) => {
        await c.page.waitForURL(/\/auth\/two-factor\/enroll/, { timeout: 20000 });
        const body = await text(c.page.locator("main"));
        const pwField = (await c.page.getByLabel("Password", { exact: true }).count()) > 0;
        await c.page.goto(`${BASE}/contracts`);
        await settle(c.page);
        const blocked = pathOf(c.page);
        if (withPassword) await c.page.getByLabel("Password", { exact: true }).fill(withPassword);
        await c.page.getByRole("button", { name: "Turn on two-factor" }).click();
        const line = c.page.getByText("No camera? Enter this secret manually");
        await line.waitFor({ timeout: 15000 });
        const secret = (await text(line)).split(":").pop().trim();
        await c.page.getByLabel("Code").fill(await code(secret));
        await c.page.getByRole("button", { name: "Confirm" }).click();
        await c.page.getByText("Save these backup codes").waitFor({ timeout: 15000 });
        const backups = (
          (await text(c.page.locator("main"))).match(/\b[A-Za-z0-9]{5}-[A-Za-z0-9]{5}\b/g) ?? []
        ).length;
        await c.page
          .getByRole("link", { name: "Done" })
          .or(c.page.getByRole("button", { name: "Done" }))
          .first()
          .click();
        const opened = await leftAuth(c.page);
        return { body, pwField, blocked, secret, backups, opened, landed: pathOf(c.page) };
      };
      const challenge = async (c, secret) => {
        await c.page.waitForURL((u) => u.pathname === "/auth/two-factor", { timeout: 20000 });
        const t = await text(c.page.locator("main"));
        await c.page.getByLabel("Code").fill(await code(secret));
        await c.page.getByRole("button", { name: "Verify" }).click();
        return { t, ok: await leftAuth(c.page), landed: pathOf(c.page) };
      };
      const linkFor = async (c, email) => {
        await waitForBudget(1);
        await openLogin(c.page);
        await c.page.getByRole("button", { name: "Email me a sign-in link" }).click();
        await c.page.getByLabel("Email").fill(email);
        const since = Date.now();
        await c.page.getByRole("button", { name: "Send link" }).click();
        await c.page.getByText("Check your email").first().waitFor({ timeout: 15000 });
        const m = await waitForLink(email, since, { subjectRe: /Sign in/i, linkRe: /magic-link/ });
        await c.page.goto(m.link);
      };

      // Legal Team Member: password sign-in, then a sign-in link, then single sign-on.
      await step(
        S,
        "legal_team_member",
        "If your organization requires two-factor authentication (password sign-in): Two-factor authentication opens after sign-in",
        "Sign in with Email and Password; enter Password if the page asks for it, select Turn on two-factor, complete steps 5 to 8",
        "The page says Your organization requires two-factor authentication.; other pages stay closed until enrollment finishes; then the app opens",
        async () => {
          const c = await newContext();
          await openLogin(c.page);
          await fillLogin(c.page, tfMember.email, tfMember.password);
          const r = await enrollForced(c, tfMember.password);
          tfMember.secret = r.secret;
          await openProfile(c.page, tfMember.displayName);
          const profile = await text(c.page.locator("main"));
          const required = profile.includes("Required by your organization");
          const controls = {
            turnOff: await c.page.getByRole("button", { name: "Turn off two-factor" }).count(),
            reenroll: await c.page.getByRole("button", { name: "Re-enroll" }).count(),
          };
          await signOutViaMenu(c.page, tfMember.displayName);
          await fillLogin(c.page, tfMember.email, tfMember.password);
          const ch = await challenge(c, r.secret);
          await c.context.close();
          check(
            r.body.includes("Your organization requires two-factor authentication.") &&
              r.pwField &&
              r.blocked.startsWith("/auth/two-factor"),
            JSON.stringify(r),
          );
          check(
            r.backups >= 10 &&
              r.opened &&
              required &&
              controls.turnOff === 0 &&
              controls.reenroll === 0 &&
              ch.ok,
            JSON.stringify({ r, required, controls, ch }),
          );
          return {
            page: "/auth/two-factor/enroll",
            actual: `Password sign-in opened /auth/two-factor/enroll: "${r.body.slice(0, 170)}". The page asked for Password (${r.pwField}). Opening /contracts stayed on ${r.blocked}. Turn on two-factor, Code and Confirm showed ${r.backups} backup codes; Done opened ${r.landed}. Profile showed Required by your organization ${required}, with Turn off two-factor ${controls.turnOff} and Re-enroll ${controls.reenroll}. The next password sign-in asked for a code: "${ch.t.slice(0, 80)}"; Code and Verify opened ${ch.landed}.`,
          };
        },
      );
      await step(
        S,
        "legal_team_member",
        "When two-factor is required, OpenLaw asks for a code after a sign-in link",
        "Sign in with Email me a sign-in link; enter the Code",
        "The sign-in link opens Two-factor authentication; the code opens the app",
        async () => {
          const c = await newContext();
          await linkFor(c, tfMember.email);
          const ch = await challenge(c, tfMember.secret);
          await c.context.close();
          check(ch.ok, JSON.stringify(ch));
          return {
            page: "/auth/two-factor",
            actual: `The sign-in link opened the challenge "${ch.t.slice(0, 80)}"; Code and Verify opened ${ch.landed}.`,
          };
        },
      );
      // Administrator: first sign-in through single sign-on under the policy (no password on the account).
      const u = ssoUsers.administrator;
      await step(
        S,
        "administrator",
        "If your organization requires two-factor authentication (single sign-on, no password): enrollment before any page; then a code after every single sign-on",
        "Continue with single sign-on; select Turn on two-factor, complete steps 5 to 8; sign out; single sign-on again and enter the Code",
        "Two-factor authentication opens with Your organization requires two-factor authentication.; no Password field when the account has none; later single sign-on asks for a code",
        async () => {
          const c = await newContext();
          await idpIdentity(...u.identity);
          await openLogin(c.page);
          if (await c.page.locator("#sso-email").count())
            await c.page.locator("#sso-email").fill(u.email);
          await c.page.getByRole("button", { name: "Continue with single sign-on" }).click();
          const r = await enrollForced(c, null);
          u.secret = r.secret;
          await signOutViaMenu(c.page, u.displayName);
          await idpIdentity(...u.identity);
          await c.page.locator("#sso-email").fill(u.email);
          await c.page.getByRole("button", { name: "Continue with single sign-on" }).click();
          const ch = await challenge(c, r.secret);
          await signOutViaMenu(c.page, u.displayName);
          await linkFor(c, u.email);
          const ch2 = await challenge(c, r.secret);
          await c.context.close();
          check(
            r.body.includes("Your organization requires two-factor authentication.") &&
              !r.pwField &&
              r.blocked.startsWith("/auth/two-factor") &&
              r.opened,
            JSON.stringify(r),
          );
          check(ch.ok && ch2.ok, JSON.stringify({ ch, ch2 }));
          return {
            page: "/auth/two-factor/enroll",
            actual: `Single sign-on opened /auth/two-factor/enroll: "${r.body.slice(0, 170)}", with no Password field (${!r.pwField}). /contracts stayed on ${r.blocked}. Enrollment showed ${r.backups} backup codes; Done opened ${r.landed}. After Sign out, single sign-on opened the challenge and the Code opened ${ch.landed}. A sign-in link also opened the challenge and the Code opened ${ch2.landed}.`,
          };
        },
      );
    } finally {
      await setPolicy(D.page, "legal", { ...legalDefault, sso: true });
      await openProfile(D.page, SEED.daniel.name);
      await D.page.getByRole("button", { name: "Turn off two-factor" }).click();
      const d = D.page.getByRole("dialog");
      await d.getByLabel("Password").fill(PASSWORD);
      await d.getByRole("button", { name: "Continue" }).click();
      await d.waitFor({ state: "hidden", timeout: 10000 });
      setting("Daniel Okafor two-factor turned off again", null);
    }
  });

  // ---- The unavailable page: the last provider removed while SSO is the only Legal method.
  await guarded(S, "administrator", "unavailable", async () => {
    await setPolicy(D.page, "legal", {
      password: false,
      magicLink: false,
      sso: true,
      requireTwoFactor: false,
    });
    const before = (await methodsNow()).policy.legal;
    await removeProvider(D.page, PROVIDER_B);
    await removeProvider(D.page, PROVIDER_A);
    const afterPolicy = (await methodsNow()).policy.legal;
    const providers = await providersNow(D.page);
    for (const [role, who] of [
      ["legal_team_member", nadia],
      ["administrator", { email: SEED.daniel.email, name: SEED.daniel.name }],
    ]) {
      await step(
        S,
        role,
        "If the page shows only Sign-in is unavailable. Contact your administrator.",
        `Open the staff sign-in page as ${who.name} after the Administrator removed the last identity provider while single sign-on was the only Legal method`,
        "Only Sign-in is unavailable. Contact your administrator.; no Administrator sign-in link",
        async () => {
          const c = await newContext();
          await openLogin(c.page);
          const body = await text(c.page.locator("main"));
          const controls = await controlsOf(c.page);
          await c.context.close();
          check(
            body.includes("Sign-in is unavailable. Contact your administrator.") &&
              !controls.some((x) => /Administrator sign-in|Sign in|Email me/.test(x)),
            `${body} ${JSON.stringify(controls)}`,
          );
          return {
            page: "/auth/login",
            actual: `Legal policy before removal ${JSON.stringify(before)}; the Administrator removed ${PROVIDER_B.name} and then ${PROVIDER_A.name} (providers left ${JSON.stringify(providers)}); the stored Legal policy became ${JSON.stringify(afterPolicy)}. The staff sign-in page read "${body}" with controls ${JSON.stringify(controls)}; no Administrator sign-in link.`,
          };
        },
      );
    }
    bug(
      S,
      "Removing the last identity provider while single sign-on is the only Legal method leaves no staff method and no Administrator sign-in link (the same defect the DOC-032 admin-org and access authors recorded; file once).",
      `On bacc: Legal policy {password:false,magicLink:false,sso:true}; Settings → Advanced → Authentication → Remove each provider. /api/v1/auth/methods then answered legal ${JSON.stringify(afterPolicy)} and /auth/login showed only "Sign-in is unavailable. Contact your administrator." TECH-008 keeps Administrator password sign-in as break-glass (instance.ts assertPasswordSignIn still allows it), but the page offers no way in.`,
    );
    await step(
      S,
      "administrator",
      "An Administrator who is still signed in on another device turns on another method in Settings → Advanced → Authentication",
      "In the still-open Administrator session, open Settings → Advanced → Authentication and turn on Email and password under Legal User Authentication",
      "Saved; the staff sign-in page offers the password form again and a Legal Team Member signs in",
      async () => {
        await openAuthentication(D.page);
        const saved = await toggle(D.page, "Legal User Authentication", "Email and password");
        const c = await newContext();
        await openLogin(c.page);
        const offered = await buttons(c.page);
        await fillLogin(c.page, nadia.email, PASSWORD);
        const ok = await leftAuth(c.page);
        await c.context.close();
        const saved2 = await toggle(D.page, "Legal User Authentication", "Email magic link");
        check(saved === "Saved" && ok, `${saved} ${ok} ${JSON.stringify(offered)}`);
        return {
          page: "/settings/authentication",
          actual: `Daniel's session opened in another browser context stayed signed in. Email and password under Legal User Authentication showed "${saved}". A signed-out browser then showed the password form with buttons ${JSON.stringify(offered)}, and Nadia Haddad signed in (${ok}). Email magic link was turned back on too ("${saved2}"); Legal policy now ${JSON.stringify((await methodsNow()).policy.legal)}.`,
        };
      },
      D.page,
    );
  });
  await D.context.close();
}

// =====================================================================================
// fixtures: Portal records (API, as Legal and as the Business Users themselves)
// =====================================================================================
/** API session for a Business User from a fresh sign-in link (fixture setup only). */
async function magicLinkSession(email) {
  const { Session } = await import("../../../../../scripts/seed/client.mjs");
  await waitForBudget(1);
  const since = Date.now();
  const r = await fetch(`${BASE}/api/v1/auth/magic-link`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ email, group: "business" }),
  });
  check(r.status === 202, `magic link answered ${r.status}`);
  const m = await waitForLink(email, since, { subjectRe: /Sign in/i, linkRe: /magic-link/ });
  const s = new Session(email, BASE);
  await s.request("GET", m.link, { expect: [200, 301, 302, 303, 307, 308] });
  check((await call(s, "GET", "/me")).status === 200, `no session for ${email}`);
  return s;
}
async function fixtures() {
  const fx = existsSync(FIX) ? JSON.parse(readFileSync(FIX, "utf8")) : {};
  const saveFx = () => writeFileSync(FIX, JSON.stringify(fx, null, 2) + "\n");
  fx.stamp ??= STAMP;
  const name = (s) => `${TAG} ${s} ${fx.stamp}`;
  const d = await apiSession(SEED.daniel.email);
  const n = await apiSession(SEED.nadia.email);
  const users = must(await call(d, "GET", "/users"), "users").users;
  fx.ids = Object.fromEntries(
    Object.entries(SEED).map(([k, v]) => [k, users.find((u) => u.email === v.email)?.id ?? null]),
  );
  const nda = must(await call(d, "GET", "/contract-types"), "ctypes").contractTypes.find(
    (t) => t.displayName === "NDA",
  ).id;
  const commercial = must(await call(d, "GET", "/matter-types"), "mtypes").matterTypes.find(
    (t) => t.displayName === "Commercial",
  ).id;
  const sales = must(await call(d, "GET", "/departments"), "depts").departments.find(
    (t) => t.displayName === "Sales",
  ).id;
  const contract = async (s, body, what) =>
    must(await call(s, "POST", "/contracts", body), what).contract;
  const matter = async (s, body, what) =>
    must(await call(s, "POST", "/matters", body), what).matter;
  const request = async (email, who) => {
    const b = await magicLinkSession(email);
    const rt = must(await call(d, "GET", "/portal/request-types/contract_review"), "rt");
    return must(
      await call(b, "POST", "/requests", {
        requestTypeId: rt.requestType.id,
        departmentId: sales,
        title: name(`${who} request`),
        description: `DOC-032 bridge fictional ask from ${who}.`,
        urgency: "medium",
      }),
      `request ${who}`,
    ).request;
  };
  await step(
    P,
    "business_user",
    "fixture: Portal records",
    "API fixture setup as Legal and as the Business Users",
    "Records exist",
    async () => {
      if (!fx.amaraRequest) {
        const r = await request(SEED.amara.email, "Amara");
        fx.amaraRequest = { number: r.number, title: r.title };
        saveFx();
      }
      if (!fx.jonasConverted) {
        const rq = await request(SEED.jonas.email, "Jonas");
        const cv = must(
          await call(n, "POST", `/requests/${rq.number}/convert`, {
            title: name("Jonas converted contract"),
            contractTypeId: nda,
          }),
          "convert",
        );
        const rec2 = cv.request?.convertedRecord ?? cv.request?.conversion?.convertedRecord;
        fx.jonasConverted = {
          request: rq.number,
          number: rec2.number,
          id: rec2.id,
          title: name("Jonas converted contract"),
        };
        saveFx();
        must(
          await upload(
            n,
            `/contracts/${rec2.number}/documents`,
            "doc032-bridge-jonas-paper.txt",
            "DOC-032 bridge fictional paper for Jonas.\n",
          ),
          "jonas paper",
        );
        must(
          await call(n, "POST", `/contracts/${rec2.number}/counterparties`, {
            name: name("Fictional Partner Ltd"),
          }),
          "counterparty",
        );
        must(
          await call(n, "PATCH", `/contracts/${rec2.number}`, {
            value: { amount: 5000000, currency: "GBP", cadence: "one_time" },
            effectiveDate: "2026-02-01",
            expiryDate: "2028-01-31",
          }),
          "values",
        );
      }
      if (!fx.archivedJ) {
        const a = await contract(
          n,
          { title: name("archived team contract"), contractTypeId: nda, managerId: fx.ids.nadia },
          "archivedJ",
        );
        must(
          await call(n, "POST", `/contracts/${a.number}/team`, { userId: fx.ids.jonas }),
          "archivedJ team",
        );
        must(await call(n, "POST", `/contracts/${a.number}/archive`, {}), "archivedJ archive");
        fx.archivedJ = { number: a.number, title: a.title };
        saveFx();
      }
      if (!fx.mx) {
        const mx = await matter(
          n,
          {
            title: name("matter without Jonas"),
            matterTypeId: commercial,
            managerId: fx.ids.nadia,
          },
          "mx",
        );
        fx.mx = { number: mx.number, title: mx.title };
        saveFx();
      }
      if (!fx.paging) {
        fx.paging = [];
        for (let i = 1; i <= 26; i++) {
          const c = await contract(
            n,
            {
              title: name(`paging contract ${String(i).padStart(2, "0")}`),
              contractTypeId: nda,
              managerId: fx.ids.nadia,
            },
            `paging ${i}`,
          );
          must(
            await call(n, "POST", `/contracts/${c.number}/team`, { userId: fx.ids.jonas }),
            `paging team ${i}`,
          );
          fx.paging.push(c.number);
        }
        saveFx();
      }
      fx.createdAt ??= new Date().toISOString();
      saveFx();
      created(
        `Portal fixtures (fixtures.json): Amara's Request R-${fx.amaraRequest.number}; Jonas's Request R-${fx.jonasConverted.request} converted to C-${fx.jonasConverted.number} with doc032-bridge-jonas-paper.txt, a Counterparty, Value and dates; archived team Contract C-${fx.archivedJ.number}; Matter M-${fx.mx.number} without Jonas; 26 paging Contracts with Jonas on the team`,
      );
      return {
        page: null,
        actual: `Fixtures ready: ${JSON.stringify({ amaraRequest: fx.amaraRequest.number, converted: fx.jonasConverted.number, archived: fx.archivedJ.number, mx: fx.mx.number, paging: fx.paging.length })}`,
      };
    },
  );
}

// =====================================================================================
// portal: V-C02 Business User (steps S1-S21 follow the guide; V1-V4 are setting variants)
// =====================================================================================
const BU = "business_user";
async function portalLinkSignIn(email, c) {
  c ??= await newContext();
  await waitForBudget(1);
  await openLogin(c.page, true);
  const emailMe = c.page.getByRole("button", { name: "Email me a sign-in link" });
  if (await emailMe.isVisible().catch(() => false)) await emailMe.click();
  await c.page.getByLabel("Email").fill(email);
  const since = Date.now();
  await c.page.getByRole("button", { name: "Send link" }).click();
  await c.page.getByText("Check your email").first().waitFor({ timeout: 15000 });
  const m = await waitForLink(email, since, { subjectRe: /Sign in/i, linkRe: /magic-link/ });
  check(m?.link, `no sign-in email for ${email}`);
  await c.page.goto(m.link);
  check(await inPortal(c.page), `the link for ${email} did not open the Portal`);
  await settle(c.page);
  return c;
}
async function go(page, url) {
  await page.goto(`${BASE}${url}`);
  await settle(page);
}
async function finishOnboarding(page, fullName) {
  await page.getByText("Welcome to your Business Portal").first().waitFor({ timeout: 20000 });
  await page.locator("#first-run-department").selectOption({ index: 1 });
  await sleep(500);
  await page.getByRole("button", { name: "Continue" }).click();
  if (fullName) {
    await page.getByLabel("Full name").waitFor();
    await page.getByLabel("Full name").fill(fullName);
    await page.getByLabel("Full name").blur();
    await sleep(800);
  }
  for (
    let i = 0;
    i < 8 &&
    !(await page
      .getByRole("button", { name: "Finish" })
      .isVisible()
      .catch(() => false));
    i++
  ) {
    await page
      .getByRole("button", { name: /^(Skip|Continue)$/ })
      .last()
      .click();
    await sleep(500);
  }
  await page.getByRole("button", { name: "Finish" }).click();
  await page.waitForURL((u) => u.pathname.replace(/\/$/, "") === "/portal", { timeout: 20000 });
}

async function portal() {
  const fx = JSON.parse(readFileSync(FIX, "utf8"));
  const tag = STAMP;
  const newEmail = `doc032.bridge.first.${tag}@helix.example`;
  const newName = `${TAG} first Business User ${tag}`;
  const expiryEmail = `doc032.bridge.expiry.${tag}@helix.example`;
  const outsider = `doc032.bridge.${tag}@not-allowed-domain.example`;
  const invitedOutside = `doc032.bridge.invited.${tag}@partner-firm.example`;
  const pwEmail = `doc032.bridge.password.${tag}@helix.example`;
  const tfEmail = `doc032.bridge.twofactor.${tag}@helix.example`;
  const daniel = await apiSession(SEED.daniel.email);
  const nadiaApi = await apiSession(SEED.nadia.email);

  const expiryPage = await newContext();
  let expiryLink = null;
  let expiryRequestedAt = null;
  await step(
    P,
    BU,
    "fixture.expiry-link",
    "Request a sign-in link now for the check after five minutes.",
    "A link arrives for a new allowed-domain address.",
    async () => {
      await openLogin(expiryPage.page, true);
      await expiryPage.page.getByRole("button", { name: "Email me a sign-in link" }).click();
      await expiryPage.page.getByLabel("Email").fill(expiryEmail);
      expiryRequestedAt = Date.now();
      await expiryPage.page.getByRole("button", { name: "Send link" }).click();
      await expiryPage.page.getByText("Check your email").first().waitFor({ timeout: 15000 });
      const m = await waitForLink(expiryEmail, expiryRequestedAt, {
        subjectRe: /Sign in/i,
        linkRe: /magic-link/,
      });
      check(m?.link, "no link arrived");
      expiryLink = m.link;
      created(`Business User ${expiryEmail} (sign-in link requested; created on first use)`);
      return {
        page: "/portal/login",
        actual: `Link email "${m.subject}" arrived for a new helix.example address at ${new Date(expiryRequestedAt).toISOString()}; kept unopened for the expiry check.`,
      };
    },
  );

  // ---- Get a sign-in link, steps 1-6, first visit.
  const bu = await newContext();
  let firstLink = null;
  await step(
    P,
    BU,
    "S1.open-address",
    "Open the Portal address.",
    "The sign-in page shows the organization's name, and its logo if one is saved.",
    async () => {
      await bu.page.goto(`${BASE}/portal`);
      await bu.page.waitForURL(/\/portal\/login/, { timeout: 15000 });
      await bu.page
        .getByRole("heading", { name: "Business Portal sign-in" })
        .waitFor({ timeout: 15000 });
      await settle(bu.page);
      const brand = await fetch(`${BASE}/api/v1/org/branding`).then((r) => r.json());
      const main = await text(bu.page.locator("main"));
      const logos = await bu.page.getByRole("img", { name: "Organization logo" }).count();
      check(main.startsWith(brand.name), `page starts "${main.slice(0, 60)}"`);
      check(
        brand.logo ? logos === 1 : logos === 0,
        `logo images ${logos}, saved logo ${!!brand.logo}`,
      );
      return {
        page: "/portal/login",
        actual: `Signed out, /portal opened /portal/login with the heading Business Portal sign-in. The page read "${main.slice(0, 140)}". Saved name "${brand.name}", saved logo ${brand.logo ? "yes" : "none"}, Organization logo images ${logos}.`,
      };
    },
    bu.page,
  );
  await step(
    P,
    BU,
    "S2.email-me",
    "If the page shows a password form or Continue with single sign-on, select Email me a sign-in link.",
    "The page changes to Get a sign-in link.",
    async () => {
      const pw = (await bu.page.getByLabel("Password").count()) > 0;
      const sso = await bu.page
        .getByRole("button", { name: "Continue with single sign-on" })
        .count();
      await bu.page.getByRole("button", { name: "Email me a sign-in link" }).click();
      await bu.page.getByText("Get a sign-in link").first().waitFor({ timeout: 10000 });
      return {
        page: "/portal/login",
        actual: `Password form shown ${pw}; Continue with single sign-on ${sso > 0}. Email me a sign-in link changed the card to Get a sign-in link.`,
      };
    },
    bu.page,
  );
  let sent = 0;
  await step(
    P,
    BU,
    "S3-5.send-link",
    "Enter the work address in Email, select Send link.",
    "Check your email appears.",
    async () => {
      await bu.page.getByLabel("Email").fill(newEmail);
      sent = Date.now();
      await bu.page.getByRole("button", { name: "Send link" }).click();
      await bu.page.getByText("Check your email").first().waitFor({ timeout: 15000 });
      const body = await text(bu.page.locator("main"));
      const i = body.indexOf("Check your email");
      return {
        page: "/portal/login",
        actual: `Check your email appeared: "${body.replace(newEmail, "<new address>").slice(i, i + 170)}".`,
      };
    },
    bu.page,
  );
  await step(
    P,
    BU,
    "S6.follow-link",
    "Open the sign-in email for that address and follow its link within five minutes.",
    "The Portal opens under that identity; the first visit shows Welcome to your Business Portal; Department with Continue, Skip on later steps, Finish opens the Portal.",
    async () => {
      const m = await waitForLink(newEmail, sent, { subjectRe: /Sign in/i, linkRe: /magic-link/ });
      check(m?.link, "no email");
      firstLink = m.link;
      created(`Business User ${newEmail} (${newName}), created by the first sign-in link`);
      const lifetime = sql(
        `select round(extract(epoch from (expires_at - created_at))/60) from verifications where value like '%${newEmail}%' order by created_at desc limit 1`,
      );
      await bu.page.goto(firstLink);
      await bu.page
        .getByText("Welcome to your Business Portal")
        .first()
        .waitFor({ timeout: 20000 });
      const url = pathOf(bu.page);
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
        if (
          await bu.page
            .getByRole("button", { name: "Finish" })
            .isVisible()
            .catch(() => false)
        )
          break;
        skipped.push(await text(bu.page.locator("#first-run-step")));
        await bu.page.getByRole("button", { name: "Skip" }).click();
        await sleep(600);
      }
      await bu.page.getByRole("button", { name: "Finish" }).click();
      await bu.page.waitForURL((u) => u.pathname.replace(/\/$/, "") === "/portal", {
        timeout: 20000,
      });
      await settle(bu.page);
      const header = await text(bu.page.getByRole("banner"));
      const main = await text(bu.page.locator("main"));
      check(lifetime === "5", `lifetime ${lifetime}`);
      check(disabled && noSkip && deptLabel, `Continue disabled ${disabled}, no Skip ${noSkip}`);
      check(
        header.includes(newName) || main.includes(newName) || header.includes(newEmail),
        `header "${header}"`,
      );
      return {
        page: url,
        actual: `Subject "${m.subject}". Link lifetime ${lifetime} minutes. The link opened ${url} with Welcome to your Business Portal. The Department step had Continue (disabled until a Department was chosen) and no Skip. After Full name, Skip was offered on: ${skipped.join(" | ")}. Finish opened /portal. Header: "${header.replace(newEmail, "<new address>").slice(0, 160)}". Main: "${main.slice(0, 160)}".`,
      };
    },
    bu.page,
  );

  await step(
    P,
    BU,
    "S7.outside-domain",
    "Request a link for an address outside the allowed domains with no account.",
    "Check your email is neutral; no link arrives.",
    async () => {
      const c = await newContext();
      await openLogin(c.page, true);
      await c.page.getByRole("button", { name: "Email me a sign-in link" }).click();
      await c.page.getByLabel("Email").fill(outsider);
      const s = Date.now();
      await c.page.getByRole("button", { name: "Send link" }).click();
      await c.page.getByText("Check your email").first().waitFor({ timeout: 15000 });
      const body = await text(c.page.locator("main"));
      await sleep(8000);
      const count = (await mailSince(outsider, s)).length;
      await c.context.close();
      check(count === 0 && /is eligible/.test(body), `messages ${count}`);
      return {
        page: "/portal/login",
        actual: `Check your email said "${body.slice(body.indexOf("If"), body.indexOf("If") + 110).replace(outsider, "<address>")}"; Mailpit held ${count} messages for the address after 8 s.`,
      };
    },
  );
  await step(
    P,
    BU,
    "S7b.outside-domain-existing",
    "Request a link for an existing active Business User account on a domain that is not allowed.",
    "An address outside the allowed domains with an existing active account receives a link.",
    async () => {
      const inv = await call(daniel, "POST", "/auth/invites", {
        email: invitedOutside,
        displayName: `${TAG} partner ${tag}`,
        role: "legal_team_member",
      });
      check(inv.status === 201, `invite ${inv.status}`);
      const role = await call(daniel, "PATCH", `/users/${inv.body.user.id}/role`, {
        role: "business_user",
      });
      created(`Business User ${invitedOutside} (invited by Daniel, role changed to Business User)`);
      const c = await newContext();
      await openLogin(c.page, true);
      await c.page.getByRole("button", { name: "Email me a sign-in link" }).click();
      await c.page.getByLabel("Email").fill(invitedOutside);
      const s = Date.now();
      await c.page.getByRole("button", { name: "Send link" }).click();
      await c.page.getByText("Check your email").first().waitFor({ timeout: 15000 });
      const m = await waitForLink(invitedOutside, s, {
        subjectRe: /Sign in/i,
        linkRe: /magic-link/,
      });
      let landed = null;
      if (m?.link) {
        await c.page.goto(m.link);
        await inPortal(c.page);
        landed = pathOf(c.page);
      }
      await c.context.close();
      check(
        m?.link && landed?.startsWith("/portal") && landed !== "/portal/login",
        `mail ${!!m}, landed ${landed}`,
      );
      return {
        page: "/portal/login",
        actual: `Fixture: Daniel invited an account at partner-firm.example (not an allowed domain) and changed its role to Business User (${role.status}). Send link showed Check your email and "${m.subject}" arrived; its link opened ${landed}.`,
      };
    },
  );

  await step(
    P,
    BU,
    "S8.sign-out",
    "Select Sign out in the Portal header.",
    "The session ends; the Portal sign-in page shows.",
    async () => {
      await go(bu.page, "/portal");
      const direct = bu.page.getByRole("banner").getByRole("button", { name: "Sign out" });
      let via = "header button";
      if (!(await direct.isVisible().catch(() => false))) {
        via = "header menu";
        await bu.page.getByRole("banner").getByRole("button").last().click();
        await bu.page.getByRole("menuitem", { name: "Sign out" }).click();
      } else await direct.click();
      await bu.page.waitForURL(/\/portal\/login/, { timeout: 15000 });
      await go(bu.page, "/portal");
      const after = pathOf(bu.page);
      check(after === "/portal/login", after);
      return {
        page: "/portal",
        actual: `Sign out (${via}) returned to /portal/login; opening /portal again showed ${after}.`,
      };
    },
    bu.page,
  );
  await step(
    P,
    BU,
    "S9.used-link",
    "Reuse the old email link after sign-out; on Sign-in link expired enter Email, select Send link, follow the new link once.",
    "Sign-in link expired offers Email and Send link; the new link opens the Portal; the old link does not.",
    async () => {
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
      await bu.page.waitForURL((x) => x.pathname.replace(/\/$/, "") === "/portal", {
        timeout: 20000,
      });
      await settle(bu.page);
      const onboarding = await bu.page
        .getByText("Welcome to your Business Portal")
        .isVisible()
        .catch(() => false);
      check(u.pathname === "/auth/link-expired" && !onboarding, `${u.pathname}${u.search}`);
      const i = body.indexOf("Sign-in link expired");
      return {
        page: `${u.pathname}${u.search}`,
        actual: `The used link opened ${u.pathname}${u.search}: "${body.slice(i, i + 150)}". Email and Send link sent "${m.subject}"; its link opened /portal without repeating the first-visit steps.`,
      };
    },
    bu.page,
  );
  await step(
    P,
    BU,
    "S10.bad-link",
    "Open a sign-in link whose token was altered.",
    "A bad link offers a working recovery route.",
    async () => {
      const u = new URL(firstLink);
      u.searchParams.set("token", "doc032-bridge-not-a-token");
      const c = await newContext();
      await c.page.goto(u.toString());
      await settle(c.page);
      const landed = new URL(c.page.url());
      const body = await text(c.page.locator("main"));
      const sendLink = await c.page.getByRole("button", { name: "Send link" }).count();
      await c.context.close();
      check(/Sign-in link expired/.test(body) && sendLink > 0, body.slice(0, 200));
      return {
        page: `${landed.pathname}${landed.search}`,
        actual: `An altered token opened ${landed.pathname}${landed.search} with "${body.slice(0, 200)}". Email and Send link were offered (the same recovery route as S9).`,
      };
    },
  );

  // ---- Jonas: identity, own Requests, isolation, staff pages, Contracts, Matters.
  const jonas = await portalLinkSignIn(SEED.jonas.email);
  const J = jonas.page;
  const jonasReq = sql(
    `select r.number||'|'||r.title from requests r join users u on u.id=r.requester_id where u.email='${SEED.jonas.email}' and r.status<>'converted' order by r.number limit 1`,
  ).split("|");
  const amaraReq = [String(fx.amaraRequest.number), fx.amaraRequest.title];
  await step(
    P,
    BU,
    "S11.own-requests",
    "Follow a fresh link as Jonas; check the signed-in identity.",
    "The Portal opens under that identity and lists that person's Requests.",
    async () => {
      await go(J, "/portal");
      const header = await text(J.getByRole("banner"));
      const main = await text(J.locator("main"));
      check(main.includes(jonasReq[1].slice(0, 30)), `R-${jonasReq[0]} missing`);
      check(!main.includes(amaraReq[1].slice(0, 30)), "Amara's Request shown");
      return {
        page: "/portal",
        actual: `Header "${header.slice(0, 120)}". Jonas's own Request R-${jonasReq[0]} "${jonasReq[1].slice(0, 50)}" was listed; Amara's R-${amaraReq[0]} was not.`,
      };
    },
    J,
  );
  await step(
    P,
    BU,
    "S12.other-request-and-staff-pages",
    "Open another Business User's Request link and the staff Inbox, Contracts and Matters pages.",
    "Another Business User's Request link does not grant access; Business Users cannot enter the staff pages.",
    async () => {
      await go(J, `/portal/requests/${amaraReq[0]}`);
      const landed = pathOf(J);
      const leaked = (await text(J.locator("main"))).includes(amaraReq[1].slice(0, 30));
      const shown = (await text(J.locator("main"))).slice(0, 120);
      const staffPages = {};
      for (const p of ["/inbox", "/contracts", "/matters"]) {
        await go(J, p);
        staffPages[p] = pathOf(J);
      }
      check(
        !leaked && Object.values(staffPages).every((p) => p.startsWith("/portal")),
        JSON.stringify({ landed, staffPages }),
      );
      return {
        page: `/portal/requests/${amaraReq[0]}`,
        actual: `Amara's Request address showed ${landed} with "${shown}" and not its title. Staff pages ended on: ${JSON.stringify(staffPages)}.`,
      };
    },
    J,
  );
  await step(
    P,
    BU,
    "S13.your-contracts",
    "Select Contracts in the Portal navigation bar.",
    "Your Contracts lists non-archived Contracts whose teams include you; Show more loads more.",
    async () => {
      await go(J, "/portal");
      await J.getByRole("navigation", { name: "Portal" })
        .getByRole("link", { name: "Contracts" })
        .click();
      await J.waitForURL(/\/portal\/contracts/);
      await J.getByRole("heading", { name: "Your Contracts" }).waitFor({ timeout: 15000 });
      await settle(J);
      const before = await J.locator("main a[href*='/portal/contracts/']").count();
      await J.getByRole("button", { name: "Show more" }).click();
      await settle(J);
      const after = await J.locator("main a[href*='/portal/contracts/']").count();
      const list = await text(J.locator("main"));
      const archived = list.includes(fx.archivedJ.title);
      await go(J, `/portal/contracts/${fx.archivedJ.number}`);
      const direct = await h1(J);
      check(
        after > before &&
          !archived &&
          /not found|cannot open/i.test(direct + (await text(J.locator("main")))),
        JSON.stringify({ before, after, archived, direct }),
      );
      return {
        page: "/portal/contracts",
        actual: `Your Contracts showed ${before} row links; Show more raised it to ${after}. The archived team Contract C-${fx.archivedJ.number} was not listed and its address showed "${direct}".`,
      };
    },
    J,
  );
  await step(
    P,
    BU,
    "S14.read-contract",
    "Open a row; check reference, title, Counterparty, Stage, owners, terms, dates and Value; in Documents the Primary Document label; select the name; use the download control; use Your Contracts.",
    "The Contract page shows these; Primary Document marks the primary file; the name opens the current Version; download works; Your Contracts returns to the list.",
    async () => {
      const n = fx.jonasConverted.number;
      await go(J, "/portal/contracts");
      await J.getByRole("searchbox", { name: "Search Contracts" }).fill(`C-${n}`);
      await J.getByRole("searchbox", { name: "Search Contracts" }).press("Enter");
      await settle(J);
      await J.locator(`main a[href$='/portal/contracts/${n}']`).first().click();
      await J.waitForURL(new RegExp(`/portal/contracts/${n}$`));
      await settle(J);
      const main = await text(J.locator("main"));
      const labels = [
        "Counterparty",
        "Stage",
        "Business Owner",
        "Legal Owner",
        "Term type",
        "Effective date",
        "Expiry date",
        "Value",
        "Documents",
      ];
      const missing = labels.filter((l) => !main.includes(l));
      const primary = await J.getByText("Primary Document", { exact: true })
        .first()
        .isVisible()
        .catch(() => false);
      const docs = J.getByRole("region", { name: "Documents" });
      const dl = docs.getByRole("link", { name: /^Download .+, version \d+$/ }).first();
      const dlName = await dl.getAttribute("aria-label");
      const [download] = await Promise.all([
        J.waitForEvent("download", { timeout: 20000 }).catch(() => null),
        dl.click(),
      ]);
      await docs.getByRole("button", { name: "doc032-bridge-jonas-paper.txt" }).first().click();
      const viewer = J.getByRole("complementary", {
        name: /doc032-bridge-jonas-paper\.txt, version \d+/,
      });
      await viewer.waitFor({ timeout: 15000 });
      const viewerName = await viewer.getAttribute("aria-label");
      await viewer.getByRole("button", { name: "Close the document" }).click();
      await J.getByRole("link", { name: "Your Contracts" }).first().click();
      const back = await J.waitForURL(/\/portal\/contracts$/, { timeout: 10000 }).then(
        () => true,
        () => false,
      );
      check(
        main.includes(`C-${n}`) && missing.length === 0 && primary && download && back,
        JSON.stringify({ missing, primary, download: !!download, back }),
      );
      const o = main.indexOf("Overview");
      return {
        page: `/portal/contracts/${n}`,
        actual: `C-${n} "${fx.jonasConverted.title}" showed ${labels.join(", ")}. Overview text: "${main.slice(o, o + 300)}". Primary Document label shown; the name opened "${viewerName}"; "${dlName}" downloaded "${download.suggestedFilename()}"; Your Contracts returned to the list.`,
      };
    },
    J,
  );
  await step(
    P,
    BU,
    "S15.matters",
    "Select Matters in the Portal navigation bar and open a row.",
    "The Matter shows its M- reference, title, Matter Type, Status, Matter Manager and Business Owner; the list uses the current-team rule.",
    async () => {
      const teamMatter = sql(
        `select m.number from matter_team t join matters m on m.id=t.matter_id where t.user_id='${fx.ids.jonas}' and m.archived_at is null order by m.number limit 1`,
      );
      await J.getByRole("navigation", { name: "Portal" })
        .getByRole("link", { name: "Matters" })
        .click();
      await J.waitForURL(/\/portal\/matters/);
      await settle(J);
      const list = await text(J.locator("main"));
      await J.locator(`main a[href$='/portal/matters/${teamMatter}']`).first().click();
      await J.waitForURL(new RegExp(`/portal/matters/${teamMatter}$`));
      await settle(J);
      const main = await text(J.locator("main"));
      const labels = ["Matter Type", "Status", "Matter Manager", "Business Owner"];
      const missing = labels.filter((l) => !main.includes(l));
      check(
        main.includes(`M-${teamMatter}`) && missing.length === 0 && !list.includes(fx.mx.title),
        JSON.stringify({ missing }),
      );
      return {
        page: `/portal/matters/${teamMatter}`,
        actual: `Your Matters listed Jonas's team Matters and not M-${fx.mx.number}, whose team does not include him. M-${teamMatter} showed ${labels.join(", ")}: "${main.slice(0, 240)}".`,
      };
    },
    J,
  );
  await step(
    P,
    BU,
    "S16.record-sections",
    "Check the record page sections and applet bar.",
    "Record pages offer Fields, Documents with Versions and read-only Original request; the applet bar holds Comments, History and Contract team or Matter team.",
    async () => {
      const n = fx.jonasConverted.number;
      await go(J, `/portal/contracts/${n}`);
      const main = await text(J.locator("main"));
      const bar = await text(J.getByRole("toolbar", { name: "Applets" }));
      const has = (label) =>
        J.getByRole("toolbar", { name: "Applets" })
          .getByRole("button", { name: new RegExp(`^${label}`) })
          .count();
      const c = {
        Comments: await has("Comments"),
        History: await has("History"),
        "Contract team": await has("Contract team"),
      };
      await go(
        J,
        `/portal/matters/${sql(`select m.number from matter_team t join matters m on m.id=t.matter_id where t.user_id='${fx.ids.jonas}' and m.archived_at is null order by m.number limit 1`)}`,
      );
      const m = { "Matter team": await has("Matter team") };
      check(
        /Fields/.test(main) &&
          /Documents/.test(main) &&
          /Original request/.test(main) &&
          Object.values({ ...c, ...m }).every((v) => v > 0),
        JSON.stringify({ c, m }),
      );
      return {
        page: `/portal/contracts/${n}`,
        actual: `C-${n} showed Fields, Documents (with Version rows) and Original request. Applet bar: "${bar}". The Matter page offered Matter team.`,
      };
    },
    J,
  );
  await step(
    P,
    BU,
    "S17.conversion",
    "Open the converted Request address; check the team.",
    "At conversion you become Business Owner and join the team; the Request address redirects there.",
    async () => {
      await go(J, `/portal/requests/${fx.jonasConverted.request}`);
      const landed = pathOf(J);
      const rows = await rosterRows(await applet(J, "Contract team"));
      check(
        landed === `/portal/contracts/${fx.jonasConverted.number}` &&
          rows.some((r) => /Business Owner/.test(r) && r.includes("Jonas Weber")),
        `${landed} ${rows}`,
      );
      return {
        page: `/portal/requests/${fx.jonasConverted.request}`,
        actual: `/portal/requests/${fx.jonasConverted.request} redirected to ${landed}. Contract team rows: ${rows.join(" | ")}.`,
      };
    },
    J,
  );
  await step(
    P,
    BU,
    "S18.new-business-owner",
    "Legal assigns a new Business Owner (second actor, API).",
    "The new Business Owner joins the team; the former owner remains a member until Legal removes them.",
    async () => {
      const n = fx.jonasConverted.number;
      const set = await call(nadiaApi, "PATCH", `/contracts/${n}`, {
        businessOwnerId: fx.ids.amara,
      });
      await J.reload();
      await settle(J);
      const rows = await rosterRows(await applet(J, "Contract team"));
      const still = !/not found/i.test(await h1(J));
      const back = await call(nadiaApi, "PATCH", `/contracts/${n}`, {
        businessOwnerId: fx.ids.jonas,
      });
      const del = await call(nadiaApi, "DELETE", `/contracts/${n}/team/${fx.ids.amara}`);
      check(
        set.status === 200 &&
          still &&
          rows.some((r) => /Business Owner/.test(r) && r.includes("Amara Nwosu")) &&
          rows.some((r) => r.includes("Jonas Weber")),
        JSON.stringify({ set: set.status, rows }),
      );
      return {
        page: `/portal/contracts/${n}`,
        actual: `Nadia set Amara Nwosu as Business Owner (${set.status}). Jonas still opened C-${n}; his Contract team read: ${rows.join(" | ")}. Restored: Business Owner back to Jonas (${back.status}), Amara removed (${del.status}).`,
      };
    },
    J,
  );

  const amara = await portalLinkSignIn(SEED.amara.email);
  await step(
    P,
    BU,
    "S19.second-business-user",
    "Sign in as Amara in a separate browser context.",
    "Only the intended Business User session opens; each sees only their own Requests.",
    async () => {
      await go(amara.page, "/portal");
      const main = await text(amara.page.locator("main"));
      const header = await text(amara.page.getByRole("banner"));
      await go(amara.page, `/portal/requests/${jonasReq[0]}`);
      const landed = pathOf(amara.page);
      const leak = (await text(amara.page.locator("main"))).includes(jonasReq[1].slice(0, 30));
      await go(J, "/portal");
      const jHeader = await text(J.getByRole("banner"));
      check(
        main.includes(amaraReq[1].slice(0, 30)) &&
          !main.includes(jonasReq[1].slice(0, 30)) &&
          !leak &&
          jHeader.includes("Jonas"),
        JSON.stringify({ landed, leak }),
      );
      return {
        page: "/portal",
        actual: `Amara's header "${header.slice(0, 80)}"; her R-${amaraReq[0]} listed, Jonas's R-${jonasReq[0]} not; Jonas's Request address showed ${landed} without its title. Jonas's own context still read "${jHeader.slice(0, 80)}".`,
      };
    },
    amara.page,
  );
  await amara.context.close();

  await step(
    P,
    "legal_team_member",
    "S20.staff-keeps-role",
    "A Legal Team Member follows a Portal sign-in link.",
    "The account keeps its role when it follows a sign-in link; it does not act as a Business User.",
    async () => {
      const c = await portalLinkSignIn(SEED.nadia.email).catch(async () => {
        const x = await newContext();
        return x;
      });
      await settle(c.page);
      const landed = pathOf(c.page);
      const me = await pageApi(c.page, "GET", "/me");
      await go(c.page, "/contracts");
      const staffPage = pathOf(c.page);
      await c.context.close();
      check(
        me.body?.user?.role === "legal_team_member" && staffPage === "/contracts",
        JSON.stringify(me.body?.user?.role),
      );
      return {
        page: landed,
        actual: `Nadia's Portal sign-in link opened ${landed}; /me role ${me.body?.user?.role}; the staff page /contracts opened (${staffPage}).`,
      };
    },
  );

  // ---- Setting variants (organization-wide; owned lab only): links off, two-factor, logo.
  const original = (await methodsNow()).policy.business;
  const setBusiness = async (opts) => {
    const r = await call(daniel, "PATCH", "/auth/policy/business", opts);
    setting("business authentication policy", { request: opts, status: r.status });
    return r;
  };
  const state = {};
  try {
    await step(
      P,
      BU,
      "V1.links-off",
      "With email links switched off for the Portal, open the sign-in page; use Set up or reset your password, Send password setup link, follow the one-hour link, set the password, sign in with Email and Password.",
      "No Email me a sign-in link; Email and Password with Sign in; password setup works; the expired-link page offers only Back to sign-in.",
      async () => {
        const r = await setBusiness({ ...original, password: true, magicLink: false, sso: false });
        check(r.status === 200, `policy ${r.status}`);
        const c = await newContext();
        await openLogin(c.page, true);
        const btns = await buttons(c.page);
        check(
          !btns.includes("Email me a sign-in link") &&
            btns.includes("Sign in") &&
            btns.includes("Set up or reset your password"),
          btns.join("|"),
        );
        await c.page.getByRole("button", { name: "Set up or reset your password" }).click();
        await c.page.getByLabel("Email").fill(pwEmail);
        const s = Date.now();
        await c.page.getByRole("button", { name: "Send password setup link" }).click();
        await c.page
          .getByText(/expires in one hour/)
          .first()
          .waitFor({ timeout: 15000 })
          .catch(() => {});
        const neutral = await text(c.page.locator("main"));
        const m = await waitForLink(pwEmail, s, { subjectRe: /password/i });
        check(m?.link, "no setup email");
        created(`Business User ${pwEmail} (created by password setup with links off)`);
        const pw = `Doc032-bridge-${tag}`;
        await c.page.goto(m.link);
        await c.page.getByLabel("New password").fill(pw);
        await c.page.getByLabel("Confirm password").fill(pw);
        await c.page.getByRole("button", { name: "Set password" }).click();
        await c.page.getByText("Password set").first().waitFor({ timeout: 15000 });
        await openLogin(c.page, true);
        await c.page.getByLabel("Email").fill(pwEmail);
        await c.page.getByLabel("Password").fill(pw);
        await c.page.getByRole("button", { name: "Sign in", exact: true }).click();
        const opened = await inPortal(c.page);
        const landed = pathOf(c.page);
        const e = await newContext();
        await e.page.goto(`${BASE}/auth/link-expired?portal=1`);
        await e.page.getByText("Sign-in link expired").first().waitFor({ timeout: 15000 });
        const expBody = await text(e.page.locator("main"));
        const expSend = await e.page.getByRole("button", { name: "Send link" }).count();
        await e.page.getByRole("link", { name: "Back to sign-in" }).click();
        await e.page.waitForURL(/\/portal\/login/, { timeout: 10000 });
        await e.context.close();
        await c.context.close();
        check(
          opened && expSend === 0 && /one hour/.test(neutral),
          JSON.stringify({ opened, expSend }),
        );
        state.pw = { email: pwEmail, password: pw };
        const i = neutral.indexOf("Check");
        return {
          page: "/portal/login",
          actual: `Policy saved (email links off). Sign-in page buttons: ${btns.join(", ")}. Send password setup link showed "${neutral.slice(i, i + 140).replace(pwEmail, "<address>")}"; "${m.subject}" arrived; Password set; Email, Password and Sign in opened ${landed}. /auth/link-expired?portal=1 read "${expBody.slice(0, 150)}" with no Send link; Back to sign-in returned to /portal/login.`,
        };
      },
    );
  } finally {
    await setBusiness(original);
  }

  // Required two-factor authentication for the Portal.
  const tf = await portalLinkSignIn(tfEmail);
  await finishOnboarding(tf.page, null).catch(() => {});
  await tf.context.close();
  created(
    `Business User ${tfEmail} (created by a sign-in link; first visit finished in the browser)`,
  );
  const reqLink = async (email) => {
    await waitForBudget(1);
    const s = Date.now();
    const r = await fetch(`${BASE}/api/v1/auth/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify({ email, group: "business" }),
    });
    check(r.status === 202, `link request ${r.status}`);
    return (await waitForLink(email, s, { subjectRe: /Sign in/i, linkRe: /magic-link/ })).link;
  };
  const link1 = await reqLink(tfEmail);
  const link2 = await reqLink(tfEmail);
  try {
    await step(
      P,
      BU,
      "V3.two-factor",
      "With two-factor required for the Portal, follow a sign-in link; set up the authenticator app; sign out; follow a new link and enter the code. Sign in with a password under the same policy.",
      "OpenLaw asks to set up an authenticator app before the Portal opens, then asks for a code each time; this applies to sign-in links and passwords.",
      async () => {
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
        await c.page.getByLabel("Code").fill(await code(secret));
        await c.page.getByRole("button", { name: "Confirm" }).click();
        await c.page.getByRole("link", { name: "Done" }).waitFor({ timeout: 15000 });
        await c.page.getByRole("link", { name: "Done" }).click();
        await c.page.waitForURL((u) => u.pathname.startsWith("/portal"), { timeout: 20000 });
        await settle(c.page);
        const afterEnroll = pathOf(c.page);
        await c.context.close();
        const c2 = await newContext();
        await c2.page.goto(link2);
        await c2.page.waitForURL((u) => u.pathname === "/auth/two-factor", { timeout: 20000 });
        const challengeText = await text(c2.page.locator("main"));
        await c2.page.getByLabel("Code").fill(await code(secret));
        await c2.page.getByRole("button", { name: "Verify" }).click();
        const opened = await inPortal(c2.page);
        const landed = pathOf(c2.page);
        await c2.context.close();
        let pwResult = "not run (no password account from V1)";
        if (state.pw) {
          const c3 = await newContext();
          await openLogin(c3.page, true);
          await c3.page.getByLabel("Email").fill(state.pw.email);
          await c3.page.getByLabel("Password").fill(state.pw.password);
          await c3.page.getByRole("button", { name: "Sign in", exact: true }).click();
          await c3.page.waitForURL(/\/auth\/two-factor/, { timeout: 20000 }).catch(() => {});
          pwResult = pathOf(c3.page);
          await c3.context.close();
        }
        check(
          enrollUrl.pathname === "/auth/two-factor/enroll" &&
            /requires two-factor/.test(enrollText) &&
            opened &&
            /two-factor\/enroll/.test(pwResult),
          JSON.stringify({ enroll: enrollUrl.pathname, opened, pwResult }),
        );
        return {
          page: enrollUrl.pathname,
          actual: `Policy saved (two-factor required for the Portal). The sign-in link opened ${enrollUrl.pathname}: "${enrollText.slice(0, 150)}". Turn on two-factor showed the QR code and manual secret; Code and Confirm showed backup codes; Done opened ${afterEnroll}. After that, a second link opened /auth/two-factor: "${challengeText.slice(0, 100)}"; Code and Verify opened ${landed}. A password sign-in by the V1 account under the same policy opened ${pwResult}.`,
        };
      },
    );
  } finally {
    await setBusiness(original);
  }

  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGPQyt9AEmIY1TCqYfhqAABiiUkQSo+fDgAAAABJRU5ErkJggg==";
  const general = await call(daniel, "GET", "/org/general");
  const oldLogo = general.body?.logo ?? null;
  try {
    await step(
      P,
      BU,
      "V4.logo",
      "Open the Portal address after an Administrator saves a logo.",
      "The sign-in page shows the organization's name and its logo.",
      async () => {
        const r = await call(daniel, "PATCH", "/org/general", { logo: png });
        setting("organization logo", { to: "DOC-032 bridge 16x16 test logo", status: r.status });
        check(r.status === 200, `logo ${r.status}`);
        const c = await newContext();
        await openLogin(c.page, true);
        const img = c.page.getByRole("img", { name: "Organization logo" });
        await img.waitFor({ timeout: 10000 });
        const main = await text(c.page.locator("main"));
        await c.context.close();
        return {
          page: "/portal/login",
          actual: `With a saved logo the page showed one Organization logo image and "${main.slice(0, 60)}".`,
        };
      },
    );
  } finally {
    const r = await call(daniel, "PATCH", "/org/general", { logo: oldLogo });
    setting("organization logo restored", { status: r.status });
  }

  await step(
    P,
    BU,
    "S21.expired-link",
    "Follow a link after five minutes; on Sign-in link expired enter Email, Send link, follow the new link once.",
    "The expired link offers a fresh link; the new link works once.",
    async () => {
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
      const opened = await inPortal(p);
      const landed = pathOf(p);
      const c2 = await newContext();
      await c2.page.goto(m.link);
      const twice = await seen(c2.page.getByText("Sign-in link expired"), 15000);
      await c2.context.close();
      await expiryPage.context.close();
      check(
        u.pathname === "/auth/link-expired" && opened && twice,
        JSON.stringify({ u: u.pathname, opened, twice }),
      );
      return {
        page: `${u.pathname}${u.search}`,
        actual: `After ${Math.round((Date.now() - expiryRequestedAt) / 60000)} minutes the first link opened ${u.pathname}${u.search} (Sign-in link expired). Email and Send link sent a new link, which opened ${landed}. The same new link in a second browser context opened Sign-in link expired (works once).`,
      };
    },
  );
  await jonas.context.close();
  await bu.context.close();
  const after = (await methodsNow()).policy.business;
  setting("final check", {
    businessPolicyRestored: JSON.stringify(after) === JSON.stringify(original),
  });
}

// =====================================================================================
// portalSso: V-C02 single sign-on with one and two providers; the empty allowed-domain list
// =====================================================================================
const allowedDomains = () =>
  JSON.parse(sql(`select allowed_email_domains::text from org_settings`));
async function portalSso() {
  check(OIDC_IP, "The bacc OIDC fixture is not running (phase.sh oidc)");
  const D = await adminContext();
  const businessDefault = { password: true, magicLink: true, sso: false, requireTwoFactor: false };
  const jonasIdentity = [`doc032-bridge-jonas-${STAMP}`, SEED.jonas.email, SEED.jonas.name];
  for (const p of [PROVIDER_A, PROVIDER_B])
    if ((await providersNow(D.page)).includes(p.providerId)) await removeProvider(D.page, p);
  await registerProvider(D.page, PROVIDER_A);
  await setPolicy(D.page, "business", { ...businessDefault, sso: true });

  await step(
    P,
    BU,
    "SSO1.one-provider",
    "Open the Portal sign-in page with one identity provider; select Email me a sign-in link; then, in another browser, select Continue with single sign-on and complete the sign-in as Jonas",
    "The page shows Continue with single sign-on; Email me a sign-in link changes it to Get a sign-in link; single sign-on opens the Portal under Jonas's identity",
    async () => {
      const c = await newContext();
      await openLogin(c.page, true);
      const offered = await buttons(c.page);
      const emailField = await c.page.locator("#sso-email").count();
      await c.page.getByRole("button", { name: "Email me a sign-in link" }).click();
      const getLink = await seen(c.page.getByText("Get a sign-in link"));
      await c.context.close();
      const j = await newContext();
      const r = await ssoRoundTrip(j.page, true, jonasIdentity);
      const main = await text(j.page.locator("main"));
      await j.context.close();
      check(
        offered.includes("Continue with single sign-on") && emailField === 0 && getLink,
        JSON.stringify(offered),
      );
      check(
        r.issuer === "http://oidc:8080" &&
          r.me === 200 &&
          r.role === "business_user" &&
          r.email === SEED.jonas.email &&
          r.path.startsWith("/portal"),
        JSON.stringify(r),
      );
      return {
        page: "/portal/login",
        actual: `Business SSO on with one provider: buttons ${JSON.stringify(offered)}, no Email field. Email me a sign-in link showed Get a sign-in link (${getLink}). Continue with single sign-on went to ${r.issuer} and back to ${r.path} as ${r.email} (${r.role}); the Portal read "${main.slice(0, 120)}".`,
      };
    },
  );

  await registerProvider(D.page, PROVIDER_B);
  const sso2Email = `doc032.bridge.sso2.${STAMP}@helix.example`;
  created(`Business User ${sso2Email} (created by a sign-in link in SSO2)`);
  await step(
    P,
    BU,
    "SSO2.email-field-then-link",
    "Get a sign-in link, step 2, with an Email field above Continue with single sign-on: select Email me a sign-in link, then Email, Send link, follow the link",
    "Email me a sign-in link is below the Email field and Continue with single sign-on; it changes the page to Get a sign-in link; the link signs in",
    async () => {
      const c = await newContext();
      await openLogin(c.page, true);
      const body = await text(c.page.locator("main"));
      const offered = await buttons(c.page);
      const emailField = await c.page.locator("#sso-email").count();
      await c.page.getByRole("button", { name: "Email me a sign-in link" }).click();
      await c.page.getByText("Get a sign-in link").first().waitFor({ timeout: 10000 });
      await waitForBudget(1);
      await c.page.getByLabel("Email").fill(sso2Email);
      const s = Date.now();
      await c.page.getByRole("button", { name: "Send link" }).click();
      await c.page.getByText("Check your email").first().waitFor({ timeout: 15000 });
      const m = await waitForLink(sso2Email, s, { subjectRe: /Sign in/i, linkRe: /magic-link/ });
      await c.page.goto(m.link);
      const ok = await inPortal(c.page);
      await c.context.close();
      check(
        emailField === 1 &&
          offered.includes("Continue with single sign-on") &&
          offered.includes("Email me a sign-in link") &&
          ok,
        JSON.stringify({ emailField, offered, ok }),
      );
      return {
        page: "/portal/login",
        actual: `With two providers the Portal page read "${body.slice(0, 160)}" with an Email field and buttons ${JSON.stringify(offered)}. Email me a sign-in link showed Get a sign-in link; Send link for ${sso2Email} and the emailed link opened the Portal (${ok}).`,
      };
    },
  );

  await setPolicy(D.page, "business", {
    password: true,
    magicLink: false,
    sso: true,
    requireTwoFactor: false,
  });
  await step(
    P,
    BU,
    "SSO3.links-off-several-providers",
    "When email links are switched off and there is more than one identity provider: enter Email, then select Continue with single sign-on",
    "No Email me a sign-in link; OpenLaw opens the identity provider that serves the domain and the Portal opens",
    async () => {
      const c = await newContext();
      await openLogin(c.page, true);
      const offered = await buttons(c.page);
      const r = await ssoRoundTrip(c.page, true, jonasIdentity);
      await c.context.close();
      check(
        !offered.includes("Email me a sign-in link") &&
          r.byEmail &&
          r.issuer === "http://oidc:8080" &&
          r.me === 200 &&
          r.role === "business_user",
        JSON.stringify({ offered, r }),
      );
      return {
        page: r.path,
        actual: `Links off, SSO on with two providers: buttons ${JSON.stringify(offered)}. Jonas's address in Email and Continue with single sign-on opened ${r.issuer} and the Portal at ${r.path} (${r.role}).`,
      };
    },
  );
  await step(
    P,
    BU,
    "SSO4.unserved-domain",
    "Enter an address whose domain no provider serves and select Continue with single sign-on",
    "No single sign-on provider is set up for {domain}. Check the address or contact your administrator.",
    async () => {
      const c = await newContext();
      await openLogin(c.page, true);
      await c.page.locator("#sso-email").fill(`doc032.bridge.${STAMP}@unlisted.example`);
      await c.page.getByRole("button", { name: "Continue with single sign-on" }).click();
      const alert = c.page.getByRole("alert").first();
      await alert.waitFor({ timeout: 15000 });
      const msg = (await alert.innerText()).trim();
      await c.context.close();
      check(
        msg ===
          "No single sign-on provider is set up for unlisted.example. Check the address or contact your administrator.",
        msg,
      );
      return { page: "/portal/login", actual: `The Portal page showed "${msg}".` };
    },
  );
  const setupEmail = `doc032.bridge.ssopw.${STAMP}@helix.example`;
  await step(
    P,
    BU,
    "SSO5.password-first",
    "If the page shows Continue with single sign-on and you have a password, select Sign in with a password first; without a password yet, Set up or reset your password, Email, Send password setup link, follow the link, set the password, then sign in",
    "Sign in with a password opens Email and Password; the setup link sets a password; Email, Password and Sign in open the Portal",
    async () => {
      const c = await newContext();
      await openLogin(c.page, true);
      await c.page.getByRole("button", { name: "Sign in with a password" }).click();
      const form = (await c.page.getByLabel("Password", { exact: true }).count()) > 0;
      await c.page.getByRole("button", { name: "Set up or reset your password" }).click();
      await c.page.getByLabel("Email").fill(setupEmail);
      const s = Date.now();
      await c.page.getByRole("button", { name: "Send password setup link" }).click();
      await c.page.getByText("Check your email").first().waitFor({ timeout: 15000 });
      const m = await waitForLink(setupEmail, s, { subjectRe: /password/i });
      check(m?.link, "no setup email");
      created(
        `Business User ${setupEmail} (created by password setup while Portal links were off)`,
      );
      const pw = `Doc032-ssopw-${STAMP}`;
      await c.page.goto(m.link);
      await c.page.getByLabel("New password").fill(pw);
      await c.page.getByLabel("Confirm password").fill(pw);
      await c.page.getByRole("button", { name: "Set password" }).click();
      await c.page.getByText("Password set").first().waitFor({ timeout: 15000 });
      await openLogin(c.page, true);
      await c.page.getByRole("button", { name: "Sign in with a password" }).click();
      await c.page.getByLabel("Email", { exact: true }).fill(setupEmail);
      await c.page.getByLabel("Password", { exact: true }).fill(pw);
      await c.page.getByRole("button", { name: "Sign in", exact: true }).click();
      const ok = await inPortal(c.page);
      const landed = pathOf(c.page);
      await c.context.close();
      check(form && ok, JSON.stringify({ form, ok }));
      return {
        page: "/portal/login",
        actual: `Sign in with a password opened Email and Password (${form}). Set up or reset your password, Email and Send password setup link brought "${m.subject}"; Password set; Sign in with a password, Email, Password and Sign in opened ${landed}.`,
      };
    },
  );

  // ---- The empty allowed-domain list.
  await setPolicy(D.page, "business", { ...businessDefault, sso: true });
  const existingEarly = await newContext();
  let earlyLink = null;
  await waitForBudget(1);
  {
    await openLogin(existingEarly.page, true);
    await existingEarly.page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await existingEarly.page.getByLabel("Email").fill(setupEmail);
    const s = Date.now();
    await existingEarly.page.getByRole("button", { name: "Send link" }).click();
    earlyLink = (await waitForLink(setupEmail, s, { subjectRe: /Sign in/i, linkRe: /magic-link/ }))
      ?.link;
    check(earlyLink, `no sign-in link for ${setupEmail} before the removal`);
  }
  const domainsBefore = allowedDomains();
  const methodsBefore = (await methodsNow()).policy.business;
  await openAuthentication(D.page);
  for (const dmn of domainsBefore) {
    await D.page.getByRole("button", { name: `Remove ${dmn}` }).click();
    await D.page.getByRole("button", { name: `Remove ${dmn}` }).waitFor({ state: "detached" });
  }
  setting("allowed email domains emptied", { before: domainsBefore, after: allowedDomains() });
  const methodsAfter = (await methodsNow()).policy.business;
  await step(
    P,
    BU,
    "D1.last-domain-removed",
    "Open the Portal address after the Administrator removed the last allowed email domain; try an existing account's sign-in link sent before the removal",
    "OpenLaw turns off every Business Portal sign-in method; the page shows Sign-in is unavailable. Contact your administrator.; existing accounts cannot sign in either",
    async () => {
      const c = await newContext();
      await openLogin(c.page, true);
      const body = await text(c.page.locator("main"));
      const controls = await controlsOf(c.page);
      await c.context.close();
      await existingEarly.page.goto(earlyLink);
      await settle(existingEarly.page);
      const linkLanded = pathOf(existingEarly.page);
      const linkText = await text(existingEarly.page.locator("main"));
      const me = await pageApi(existingEarly.page, "GET", "/me");
      await existingEarly.context.close();
      check(domainsBefore.length > 0 && allowedDomains().length === 0, "domains not emptied");
      check(
        !methodsAfter.password && !methodsAfter.magicLink && !methodsAfter.sso,
        JSON.stringify(methodsAfter),
      );
      check(
        body.includes("Sign-in is unavailable. Contact your administrator.") &&
          !controls.some((x) => /Sign in|Email me|single sign-on/.test(x)),
        `${body} ${JSON.stringify(controls)}`,
      );
      check(
        me.status === 401 && (linkLanded === "/portal/login" || linkLanded.startsWith("/auth/")),
        `${me.status} ${linkLanded}`,
      );
      return {
        page: "/portal/login",
        actual: `Business policy before ${JSON.stringify(methodsBefore)}; Daniel removed ${JSON.stringify(domainsBefore)} under Business Portal Authentication (list now ${JSON.stringify(allowedDomains())}); the stored Business policy became ${JSON.stringify(methodsAfter)}. The Portal sign-in page read "${body}" with controls ${JSON.stringify(controls)}. The existing Business User ${setupEmail}'s sign-in link, sent before the removal, ended on ${linkLanded} with "${linkText.slice(0, 120)}" and no session (me ${me.status}).`,
      };
    },
  );
  bug(
    P,
    "Removing the last allowed email domain turns off every Business Portal sign-in method, so existing Business Users are locked out (the same defect the DOC-032 admin-org and access authors recorded; file once).",
    `On bacc: Settings → Advanced → Authentication → Business Portal Authentication → Remove helix.example (the only domain). /api/v1/auth/methods then answered business ${JSON.stringify(methodsAfter)}; /portal/login showed only "Sign-in is unavailable. Contact your administrator." and an existing Business User's earlier sign-in link gave no session. TECH-008 (2026-09-27 addendum) and SET-004 say the list governs new accounts only.`,
  );
  await step(
    P,
    BU,
    "D2.domain-and-method-restored",
    "Ask Legal to add a domain and turn a sign-in method back on; then get a sign-in link",
    "After the Administrator adds a domain and turns a method on, the Portal page offers it again and an existing Business User signs in",
    async () => {
      await openAuthentication(D.page);
      await D.page.getByLabel("Allowed email domains").fill("helix.example");
      await authRegion(D.page, "Business Portal Authentication")
        .getByRole("button", { name: "Add", exact: true })
        .click();
      await D.page.getByRole("button", { name: "Remove helix.example" }).waitFor();
      const afterAdd = (await methodsNow()).policy.business;
      const c0 = await newContext();
      await openLogin(c0.page, true);
      const stillClosed = (await text(c0.page.locator("main"))).includes(
        "Sign-in is unavailable. Contact your administrator.",
      );
      await c0.context.close();
      const saved = await toggle(D.page, "Business Portal Authentication", "Email magic link");
      setting("allowed email domain helix.example added; Business Email magic link turned on", {
        afterAdd,
        saved,
      });
      const a = await portalLinkSignIn(setupEmail);
      const main = await text(a.page.locator("main"));
      await a.context.close();
      check(saved === "Saved" && main.length > 0, saved);
      return {
        page: "/portal",
        actual: `Daniel added helix.example; the Business policy was then ${JSON.stringify(afterAdd)} and the Portal page still read Sign-in is unavailable (${stillClosed}). Email magic link under Business Portal Authentication showed "${saved}". the existing Business User ${setupEmail} then used Email me a sign-in link and the emailed link opened the Portal: "${main.slice(0, 100)}".`,
      };
    },
    D.page,
  );

  // Clean-up on the owned lab: providers removed; the lab default policy restored.
  await setPolicy(D.page, "business", businessDefault);
  for (const p of [PROVIDER_A, PROVIDER_B])
    if ((await providersNow(D.page)).includes(p.providerId)) await removeProvider(D.page, p);
  setting("final state", { methods: (await methodsNow()).policy, domains: allowedDomains() });
  await D.context.close();
}

// =====================================================================================
// mailOff: both guides with no email relay (phase.sh mail-off, then base)
// =====================================================================================
function phase(name) {
  const out = execFileSync(path.join(here, "phase.sh"), [name], { encoding: "utf8" });
  setting(`deployment phase ${name}`, out.trim().split("\n").pop());
}
async function waitEmail(configured) {
  for (let i = 0; i < 60; i++) {
    const m = await methodsNow().catch(() => null);
    if (m && m.emailConfigured === configured) return m;
    await sleep(2000);
  }
  throw new Error(`emailConfigured never became ${configured}`);
}
async function mailOff() {
  const D = await adminContext();
  phase("mail-off");
  try {
    const m0 = await waitEmail(false);
    await step(
      S,
      "legal_team_member",
      "M1.no-email: Email me a sign-in link and Set up or reset your password need email",
      "Open the staff sign-in page while OpenLaw cannot send email; open an expired sign-in link; select Back to sign-in and use another method",
      "No Email me a sign-in link and no Set up or reset your password; Sign-in link expired shows only Back to sign-in, which returns to sign-in; password sign-in works",
      async () => {
        const c = await newContext();
        await openLogin(c.page);
        const offered = await buttons(c.page);
        await c.page.goto(`${BASE}/auth/link-expired`);
        await c.page
          .getByRole("heading", { name: "Sign-in link expired" })
          .waitFor({ timeout: 15000 });
        const controls = await controlsOf(c.page);
        await c.page.getByRole("link", { name: "Back to sign-in" }).click();
        const back = await c.page.waitForURL(/\/auth\/login/, { timeout: 10000 }).then(
          () => true,
          () => false,
        );
        await fillLogin(c.page, SEED.nadia.email, PASSWORD);
        const ok = await leftAuth(c.page);
        await c.context.close();
        check(
          !offered.includes("Email me a sign-in link") &&
            !offered.includes("Set up or reset your password") &&
            offered.includes("Sign in"),
          JSON.stringify(offered),
        );
        check(
          !controls.some((x) => /Send link|input/.test(x)) &&
            controls.includes("Back to sign-in") &&
            back &&
            ok,
          JSON.stringify(controls),
        );
        return {
          page: "/auth/login",
          actual: `App and worker recreated with SMTP_URL and SMTP_FROM empty; /auth/methods emailConfigured ${m0.emailConfigured}. The staff sign-in page offered ${JSON.stringify(offered)}. /auth/link-expired showed controls ${JSON.stringify(controls)}; Back to sign-in returned to sign-in (${back}) and Nadia Haddad signed in with a password (${ok}).`,
        };
      },
    );
    await step(
      P,
      BU,
      "M2.no-email: the Portal without email",
      "Open the Portal sign-in page and an expired Portal link while OpenLaw cannot send email",
      "No Email me a sign-in link (use the method the page shows); the expired-link page only offers Back to sign-in",
      async () => {
        const c = await newContext();
        await openLogin(c.page, true);
        const offered = await buttons(c.page);
        await c.page.goto(`${BASE}/auth/link-expired?portal=1`);
        await c.page.getByText("Sign-in link expired").first().waitFor({ timeout: 15000 });
        const controls = await controlsOf(c.page);
        await c.page.getByRole("link", { name: "Back to sign-in" }).click();
        const back = await c.page.waitForURL(/\/portal\/login/, { timeout: 10000 }).then(
          () => true,
          () => false,
        );
        await c.context.close();
        check(
          !offered.includes("Email me a sign-in link") &&
            offered.includes("Sign in") &&
            controls.includes("Back to sign-in") &&
            !controls.some((x) => /Send link|input/.test(x)) &&
            back,
          JSON.stringify({ offered, controls }),
        );
        return {
          page: "/portal/login",
          actual: `The Portal page offered ${JSON.stringify(offered)}. /auth/link-expired?portal=1 showed ${JSON.stringify(controls)}; Back to sign-in returned to /portal/login (${back}).`,
        };
      },
    );
    await setPolicy(D.page, "legal", {
      password: false,
      magicLink: true,
      sso: false,
      requireTwoFactor: false,
    });
    await step(
      S,
      "administrator",
      "M3.links-only-without-email: Sign-in is unavailable",
      "Open the staff sign-in page when sign-in links are the only Legal method and OpenLaw cannot send email; recover from the still-open Administrator session",
      "Only Sign-in is unavailable. Contact your administrator.; no Administrator sign-in link; Settings → Advanced → Authentication turns on another method",
      async () => {
        const c = await newContext();
        await openLogin(c.page);
        const body = await text(c.page.locator("main"));
        const controls = await controlsOf(c.page);
        await openAuthentication(D.page);
        const saved = await toggle(D.page, "Legal User Authentication", "Email and password");
        await openLogin(c.page);
        const offered = await buttons(c.page);
        await fillLogin(c.page, SEED.daniel.email, PASSWORD);
        const ok = await leftAuth(c.page);
        await c.context.close();
        check(
          body.includes("Sign-in is unavailable. Contact your administrator.") &&
            !controls.some((x) => /Administrator sign-in|Sign in/.test(x)),
          `${body} ${JSON.stringify(controls)}`,
        );
        check(saved === "Saved" && ok, `${saved} ${ok}`);
        return {
          page: "/auth/login",
          actual: `Legal policy sign-in links only, no email relay: the staff page read "${body}" with controls ${JSON.stringify(controls)}. In Daniel's open session, Settings → Advanced → Authentication → Email and password showed "${saved}"; the staff page then offered ${JSON.stringify(offered)} and Daniel signed in with a password (${ok}).`,
        };
      },
      D.page,
    );
    await setPolicy(D.page, "legal", {
      password: true,
      magicLink: true,
      sso: false,
      requireTwoFactor: false,
    });
  } finally {
    phase("base");
    await waitEmail(true);
    await D.context.close();
  }
}

// =====================================================================================
// Runner
// =====================================================================================
try {
  await { fixtures, staff, staffSso, portal, portalSso, mailOff }[section]();
} catch (e) {
  console.error(
    String(e.stack ?? e.message)
      .split("\n")
      .slice(0, 8)
      .join("\n"),
  );
  await rec(
    section.startsWith("portal") ? P : S,
    "-",
    `script stopped: ${section}`,
    "the section completes",
    String(e.message).split("\n")[0],
    false,
    null,
  );
} finally {
  await closeBrowser();
  results.sections[section].finishedAt = new Date().toISOString();
  save();
  console.log(JSON.stringify(results.summary));
}
