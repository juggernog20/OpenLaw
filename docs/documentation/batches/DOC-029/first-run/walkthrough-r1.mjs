// DOC-029 independent walkthrough, round 1, for the "Set up a new OpenLaw instance" guide (first-run).
// Scenario V-C35, role administrator, method browser-walkthrough.
// The reviewer wrote this script from the article text. It did not write the article.
//
// Run from the repository root, one phase at a time:
//   PHASE=A  LAB_ADMIN_PASSWORD=... mise exec -- node docs/documentation/batches/DOC-029/first-run/walkthrough-r1.mjs
// Phases and the lab state that each phase needs:
//   A   fresh unseeded lab, lab default email environment (SMTP_URL and SMTP_FROM set). Full path to Finish.
//   B0  fresh unseeded lab, app and worker recreated with SMTP_URL set and SMTP_FROM empty.
//   B1  same lab as B0, app and worker recreated with SMTP_URL and SMTP_FROM empty (email unset).
//   B2  same lab as B1 after completion, app and worker recreated with SMTP_URL set and SMTP_FROM empty.
//   C   fresh unseeded lab, lab default email environment. Skip optional steps.
// The first Administrator password comes only from the environment. The script never writes it,
// a cookie, a TOTP secret, a backup code, or mail content to the log.
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHmac, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const require = createRequire(path.join(root, "e2e/package.json"));
const playwrightTest = require("@playwright/test");
const { chromium } = playwrightTest;
const expect = playwrightTest.expect.configure({ timeout: 15000 });
const PHASE = process.env.PHASE;
const BASE = process.env.LAB_APP_URL ?? "http://127.0.0.1:23311";
const MAIL = process.env.LAB_MAIL_URL ?? "http://127.0.0.1:23411";
const PASSWORD = process.env.LAB_ADMIN_PASSWORD;
const SCRATCH = process.env.SCRATCH;
if (!PHASE || !PASSWORD || !SCRATCH) throw new Error("PHASE, LAB_ADMIN_PASSWORD and SCRATCH are required");
const OUT = path.join(here, "walkthrough-r1.json");
const ARTICLE = path.join(root, "docs/user-guides/first-run.md");
const LAB = JSON.parse(readFileSync(path.join(root, ".documentation-labs/firstrun/lab.json"), "utf8"));

const ADMIN = {
  name: "DOC-029 first-run Avery Morgan",
  email: "avery.morgan@harbor.example",
};

const { createHash } = await import("node:crypto");
const articleSha = createHash("sha256").update(readFileSync(ARTICLE)).digest("hex");

const log = existsSync(OUT)
  ? JSON.parse(readFileSync(OUT, "utf8"))
  : {
      record: "walkthrough-r1",
      articleId: "first-run",
      scenario: "V-C35",
      reviewer: "DOC-029 independent walkthrough agent (first-run, round 1)",
      reviewerKind: "agent",
      appCommit: "3fa407e3a846559914aa1a63249741f30cfb4f69",
      runs: [],
    };
const run = {
  phase: PHASE,
  labProject: LAB.project,
  labCreatedAt: LAB.createdAt,
  appImageId: LAB.appImageId,
  engineImageId: LAB.engineImageId,
  sourceCommit: LAB.sourceCommit,
  emailEnvironment: process.env.EMAIL_ENV_NOTE ?? "lab default overlay",
  articleContentSha256: articleSha,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  steps: [],
};
log.runs.push(run);
function save() {
  run.finishedAt = new Date().toISOString();
  writeFileSync(OUT, JSON.stringify(log, null, 2) + "\n");
}

let failures = 0;
async function step(action, expected, fn) {
  const entry = {
    role: "administrator",
    method: "browser-walkthrough",
    action,
    expected,
    actual: null,
    result: "not-run",
    startedAt: new Date().toISOString(),
    at: null,
  };
  run.steps.push(entry);
  try {
    entry.actual = await fn();
    entry.result = "pass";
  } catch (error) {
    failures += 1;
    entry.actual = `Check did not pass: ${error instanceof Error ? error.message.split("\n").slice(0, 6).join(" ") : String(error)}`;
    entry.result = "fail";
  }
  entry.at = new Date().toISOString();
  console.log(`[${PHASE}] ${entry.result.toUpperCase()} ${action}${entry.result === "fail" ? `: ${entry.actual}` : ""}`);
  save();
  // Later steps depend on this one, so a failed step stops the phase.
  if (entry.result === "fail") throw new Error(`stopped after failed step: ${action}`);
  return entry;
}
function must(condition, message) {
  if (!condition) throw new Error(message);
}

// ---------- helpers ----------
async function stepHeading(page) {
  const id = await page.locator("main section[aria-labelledby]").first().getAttribute("aria-labelledby");
  return (await page.locator(`[id="${id}"]`).textContent())?.trim();
}
async function progress(page) {
  return (await page.getByText(/^Step \d+ of \d+$/).textContent())?.trim();
}
async function expectStep(page, title, n) {
  await expect(page.getByText(`Step ${n} of 9`, { exact: true })).toBeVisible();
  await expect.poll(() => stepHeading(page)).toBe(title);
  return `${await progress(page)}: ${await stepHeading(page)}`;
}
const button = (page, name) => page.getByRole("button", { name, exact: true });
async function getJson(context, p) {
  const res = await context.request.get(`${BASE}${p}`);
  must(res.ok(), `GET ${p} answered ${res.status()}`);
  return res.json();
}
async function mailTo(address) {
  const res = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);
  const body = await res.json();
  return { count: body.messages_count ?? body.total ?? 0, subjects: (body.messages ?? []).map((m) => m.Subject) };
}
async function waitMail(address, atLeast = 1) {
  for (let i = 0; i < 40; i += 1) {
    const found = await mailTo(address);
    if (found.count >= atLeast) return found;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No mail reached ${address}`);
}
function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of input.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totp(secret, offset = 0) {
  const counter = Math.floor(Date.now() / 1000 / 30) + offset;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const o = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac.readUInt32BE(o) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
  return code;
}
async function outstandingRows(page) {
  const list = page.getByRole("list", { name: "Outstanding setup steps" });
  await expect(list).toBeVisible();
  return list.locator("li").evaluateAll((items) =>
    items.map((li) => {
      const a = li.querySelector("a");
      return {
        label: (a ? a.textContent : li.childNodes[0]?.textContent ?? li.textContent).trim(),
        href: a ? a.getAttribute("href") : null,
        markAsReviewed: [...li.querySelectorAll("button")].some((b) => b.textContent.trim() === "Mark as reviewed"),
      };
    }),
  );
}
async function createAdministrator(page) {
  await page.goto(`${BASE}/`);
  await expect(page).toHaveURL(/\/auth\/setup$/);
  await page.getByLabel("Name", { exact: true }).fill(ADMIN.name);
  await page.getByLabel("Email", { exact: true }).fill(ADMIN.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password", { exact: true }).fill(PASSWORD);
  await button(page, "Create Administrator").click();
  await expect(page).toHaveURL(/\/welcome$/);
}
async function signIn(page) {
  await page.goto(`${BASE}/auth/login`);
  await page.getByLabel("Email", { exact: true }).fill(ADMIN.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await button(page, "Sign in").click();
  await expect(page).not.toHaveURL(/\/auth\/login/);
}
async function landsOnWizard(page, p) {
  await page.goto(`${BASE}${p}`);
  await page.waitForLoadState("networkidle");
  const url = new URL(page.url()).pathname;
  must(url === "/welcome", `${p} ended at ${url}, not /welcome`);
  return `${p} -> ${url}`;
}

// ---------- phases ----------
const browser = await chromium.launch();
try {
  if (PHASE === "A") await phaseA();
  else if (PHASE === "B0") await phaseB0();
  else if (PHASE === "B1") await phaseB1();
  else if (PHASE === "B2") await phaseB2();
  else if (PHASE === "C") await phaseC();
  else throw new Error(`Unknown phase ${PHASE}`);
} catch (error) {
  console.log(`[${PHASE}] ${error.message}`);
} finally {
  await browser.close();
  save();
}
console.log(`[${PHASE}] done, ${failures} failed step(s)`);
process.exitCode = failures ? 1 : 0;

async function phaseA() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await step(
    "Open the instance address on a fresh instance",
    "Set up OpenLaw shows Name, Email, Password, Confirm password and Create Administrator.",
    async () => {
      const setup = await context.request.get(`${BASE}/api/v1/auth/setup`);
      const { needsSetup } = await setup.json();
      must(needsSetup === true, "instance already has users");
      await page.goto(`${BASE}/`);
      await expect(page).toHaveURL(/\/auth\/setup$/);
      await expect(page.getByText("Set up OpenLaw", { exact: true }).first()).toBeVisible();
      for (const label of ["Name", "Email", "Password", "Confirm password"])
        await expect(page.getByLabel(label, { exact: true })).toBeVisible();
      await expect(button(page, "Create Administrator")).toBeVisible();
      return "needsSetup was true; / redirected to /auth/setup, which showed Set up OpenLaw with Name, Email, Password, Confirm password and Create Administrator.";
    },
  );

  await step(
    "Submit a seven-character password in both fields",
    "The password is refused and setup does not continue.",
    async () => {
      await page.getByLabel("Name", { exact: true }).fill(ADMIN.name);
      await page.getByLabel("Email", { exact: true }).fill(ADMIN.email);
      await page.getByLabel("Password", { exact: true }).fill("Short12");
      await page.getByLabel("Confirm password", { exact: true }).fill("Short12");
      await button(page, "Create Administrator").click();
      await page.waitForTimeout(800);
      const tooShort = await page.getByLabel("Password", { exact: true }).evaluate((el) => el.validity.tooShort);
      must(tooShort, "the Password field did not report tooShort");
      await expect(page).toHaveURL(/\/auth\/setup$/);
      const users = await (await context.request.get(`${BASE}/api/v1/auth/setup`)).json();
      must(users.needsSetup === true, "a user was created");
      return "The Password field reported a too-short value, the page stayed on /auth/setup, and needsSetup stayed true.";
    },
  );

  await step(
    "Submit different values in Password and Confirm password",
    "A validation message shows and no account is created.",
    async () => {
      await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
      await page.getByLabel("Confirm password", { exact: true }).fill(`${PASSWORD}x`);
      await button(page, "Create Administrator").click();
      await expect(page.getByText("The passwords do not match.")).toBeVisible();
      await expect(page).toHaveURL(/\/auth\/setup$/);
      const users = await (await context.request.get(`${BASE}/api/v1/auth/setup`)).json();
      must(users.needsSetup === true, "a user was created");
      return 'The page showed "The passwords do not match.", stayed on /auth/setup, and needsSetup stayed true.';
    },
  );

  await step(
    "Correct the validation message and submit again",
    "Setup signs the Administrator in and opens Welcome to OpenLaw.",
    async () => {
      await page.getByLabel("Confirm password", { exact: true }).fill(PASSWORD);
      await button(page, "Create Administrator").click();
      await expect(page).toHaveURL(/\/welcome$/);
      const where = await expectStep(page, "Welcome to OpenLaw", 1);
      const me = await getJson(context, "/api/v1/me");
      must(me.user.role === "administrator", `role is ${me.user.role}`);
      await expect(button(page, "Get started")).toBeVisible();
      await expect(button(page, "Skip optional steps")).toBeVisible();
      must((await button(page, "Set up later").count()) === 0, "Welcome shows Set up later");
      return `Signed in as an administrator at /welcome. ${where}. The step shows Get started and Skip optional steps, and no Set up later.`;
    },
  );

  await step(
    "Try account setup again after a user exists",
    "Account setup is not available; the visitor is sent to Sign in.",
    async () => {
      const other = await browser.newContext();
      const p2 = await other.newPage();
      await p2.goto(`${BASE}/auth/setup`);
      await expect(p2).toHaveURL(/\/auth\/login$/);
      const res = await other.request.post(`${BASE}/api/v1/auth/setup`, {
        data: { email: "second.admin@harbor.example", displayName: "DOC-029 first-run Second", password: randomBytes(9).toString("hex") },
      });
      const body = await res.json().catch(() => ({}));
      await other.close();
      must(res.status() === 409, `setup API answered ${res.status()}`);
      return `A separate signed-out context was redirected from /auth/setup to /auth/login. The setup API answered 409 "${body.detail}".`;
    },
  );

  await step(
    "Before onboarding completes, open Home and a Settings page",
    "Home opens the wizard again. With email configured by the environment, other pages open normally.",
    async () => {
      const home = await landsOnWizard(page, "/");
      await page.goto(`${BASE}/settings/general`);
      await page.waitForLoadState("networkidle");
      const settingsPath = new URL(page.url()).pathname;
      must(settingsPath === "/settings/general", `settings ended at ${settingsPath}`);
      await page.goto(`${BASE}/welcome`);
      await expectStep(page, "Welcome to OpenLaw", 1);
      return `${home}. /settings/general stayed at /settings/general while email was configured.`;
    },
  );

  await step(
    "On Welcome to OpenLaw select Get started",
    "Your organization opens as Step 2 of 9.",
    async () => {
      await button(page, "Get started").click();
      return expectStep(page, "Your organization", 2);
    },
  );

  const logoDir = SCRATCH;
  const smallPng = path.join(logoDir, "doc029-logo.png");
  const bigPng = path.join(logoDir, "doc029-logo-large.png");
  const gif = path.join(logoDir, "doc029-logo.gif");
  await step(
    "In Your organization check the locale, the logo rules, and the Upload control",
    "Default locale offers only English (United States); Upload accepts a PNG under 256 KB and refuses other files.",
    async () => {
      const options = await page.locator("#org-locale option").allTextContents();
      must(options.length === 1 && options[0] === "English (United States)", `locale options ${JSON.stringify(options)}`);
      await expect(button(page, "Upload")).toBeVisible();
      const accept = await page.getByLabel("Upload a logo").getAttribute("accept");
      const [chooserGif] = await Promise.all([page.waitForEvent("filechooser"), button(page, "Upload").click()]);
      await chooserGif.setFiles(gif);
      await expect(page.getByText("That logo must be a PNG, JPEG, WebP, or SVG image under 256 KB. Pick another file.")).toBeVisible();
      const [chooserBig] = await Promise.all([page.waitForEvent("filechooser"), button(page, "Upload").click()]);
      await chooserBig.setFiles(bigPng);
      await expect(page.getByText("That logo must be a PNG, JPEG, WebP, or SVG image under 256 KB. Pick another file.")).toBeVisible();
      must((await page.getByRole("img", { name: "Organization logo" }).count()) === 0, "a refused logo shows a preview");
      const [chooserOk] = await Promise.all([page.waitForEvent("filechooser"), button(page, "Upload").click()]);
      await chooserOk.setFiles(smallPng);
      await expect(page.getByRole("img", { name: "Organization logo" })).toBeVisible();
      return `Default locale had one option, "English (United States)". The file input accepted "${accept}". A GIF and a 300 KB PNG were refused with the logo rule message; a small PNG showed the Organization logo preview.`;
    },
  );

  const orgName = "DOC-029 first-run Harbor Legal";
  await step(
    "Enter an organization name and timezone, then select Set up later",
    "The wizard moves on without saving the unsaved organization entries.",
    async () => {
      await page.getByLabel("Organization name").fill(orgName);
      const tz = page.getByRole("combobox", { name: "Default timezone" });
      await tz.click();
      await tz.fill("Lisbon");
      await page.getByRole("option", { name: /Lisbon/ }).first().click();
      await button(page, "Set up later").click();
      const where = await expectStep(page, "Authentication", 3);
      const general = await getJson(context, "/api/v1/org/general");
      must(general.general.name !== orgName, "name was saved by Set up later");
      must(general.general.logo === null, "logo was saved by Set up later");
      return `${where}. The saved organization still had name "${general.general.name}", no logo, timezone ${general.general.defaultTimezone}.`;
    },
  );

  await step(
    "Go Back to Your organization and select Continue",
    "Continue saves Organization name, logo and Default timezone and opens Authentication.",
    async () => {
      await button(page, "Back").click();
      await expectStep(page, "Your organization", 2);
      const tz = page.getByRole("combobox", { name: "Default timezone" });
      const tzValue = await tz.inputValue();
      if (!/Lisbon/.test(tzValue)) {
        await tz.click();
        await tz.fill("Lisbon");
        await page.getByRole("option", { name: /Lisbon/ }).first().click();
      }
      if ((await page.getByLabel("Organization name").inputValue()) !== orgName)
        await page.getByLabel("Organization name").fill(orgName);
      await button(page, "Continue").click();
      const where = await expectStep(page, "Authentication", 3);
      const general = await getJson(context, "/api/v1/org/general");
      must(general.general.name === orgName, `name is ${general.general.name}`);
      must(general.general.defaultTimezone === "Europe/Lisbon", `timezone is ${general.general.defaultTimezone}`);
      must(typeof general.general.logo === "string" && general.general.logo.startsWith("data:image/png"), "logo not saved");
      return `${where}. The API read back name "${orgName}", timezone Europe/Lisbon, locale ${general.general.defaultLocale}, and a PNG logo.`;
    },
  );

  await step(
    "While steps are unfinished, open Settings -> Organization -> General",
    "A Setup checklist card lists unfinished steps; each row links to its Settings page except Email; Review seeded types has Mark as reviewed.",
    async () => {
      const p2 = await context.newPage();
      await p2.goto(`${BASE}/settings/general`);
      const nav = p2.getByRole("navigation", { name: "Settings sections" });
      await expect(nav.getByText("Organization", { exact: true })).toBeVisible();
      await expect(nav.getByRole("link", { name: "General", exact: true })).toBeVisible();
      await expect(nav.getByRole("link", { name: "Users", exact: true })).toBeVisible();
      must((await nav.getByRole("link", { name: "Email", exact: true }).count()) === 0, "an Email settings page exists");
      await expect(p2.getByText("Setup checklist", { exact: true })).toBeVisible();
      const rows = await outstandingRows(p2);
      await p2.screenshot({ path: path.join(here, "r1-a-setup-checklist.png") });
      await p2.close();
      const labels = rows.map((r) => r.label);
      must(!labels.includes("Organization"), "Organization still listed after saving");
      const review = rows.find((r) => r.label === "Review seeded types");
      must(review && review.href === null && review.markAsReviewed, "Review seeded types row lacks Mark as reviewed or has a link");
      for (const r of rows.filter((x) => x.label !== "Review seeded types"))
        must(r.href && r.href.startsWith("/settings/"), `${r.label} has no Settings link`);
      return `Settings nav showed Organization with General and Users, and no Email page. Setup checklist rows: ${JSON.stringify(rows)}.`;
    },
  );

  await step(
    "Reload the unfinished wizard",
    "The wizard returns to Welcome; after Get started, saved settings remain.",
    async () => {
      await page.reload();
      const where = await expectStep(page, "Welcome to OpenLaw", 1);
      await button(page, "Get started").click();
      await expectStep(page, "Your organization", 2);
      const value = await page.getByLabel("Organization name").inputValue();
      must(value === orgName, `name field shows ${value}`);
      await expect(page.getByRole("img", { name: "Organization logo" })).toBeVisible();
      await button(page, "Continue").click();
      await expectStep(page, "Authentication", 3);
      return `After reload: ${where}. Get started showed the saved name "${value}" and logo; Continue opened Authentication.`;
    },
  );

  const methodsBefore = await getJson(context, "/api/v1/auth/methods");
  await step(
    "In Authentication, turn off every sign-in method and select Continue",
    "OpenLaw refuses a policy with no sign-in method.",
    async () => {
      for (const name of ["Email and password", "Email magic link", "Require two-factor authentication", "Single sign-on (SSO)"])
        await expect(page.getByRole("switch", { name, exact: true })).toBeVisible();
      const initial = {};
      for (const name of ["Email and password", "Email magic link", "Single sign-on (SSO)", "Require two-factor authentication"]) {
        const sw = page.getByRole("switch", { name, exact: true });
        initial[name] = { checked: (await sw.getAttribute("aria-checked")) === "true", disabled: await sw.isDisabled() };
      }
      for (const name of ["Email and password", "Email magic link"]) {
        const sw = page.getByRole("switch", { name, exact: true });
        if ((await sw.getAttribute("aria-checked")) === "true") await sw.click();
      }
      await button(page, "Continue").click();
      await expect(page.getByText("Enable at least one sign-in method.")).toBeVisible();
      const where = await expectStep(page, "Authentication", 3);
      const after = await getJson(context, "/api/v1/auth/methods");
      must(JSON.stringify(after.policy.legal) === JSON.stringify(methodsBefore.policy.legal), "policy changed");
      return `Initial switches ${JSON.stringify(initial)}. With both email methods off, Continue showed "Enable at least one sign-in method." and stayed at ${where}; the saved legal policy was unchanged.`;
    },
  );

  await step(
    "Check the Single sign-on (SSO) switch before a provider is registered",
    "The SSO switch is unavailable and the Register your identity provider form shows.",
    async () => {
      must(await page.getByRole("switch", { name: "Single sign-on (SSO)", exact: true }).isDisabled(), "SSO switch is enabled");
      await expect(page.getByText("Register your identity provider", { exact: true })).toBeVisible();
      for (const label of ["Provider ID", "Issuer URL", "Email domain", "Client ID", "Client secret"])
        await expect(page.getByLabel(label, { exact: true })).toBeVisible();
      await expect(button(page, "Register provider")).toBeVisible();
      return "Single sign-on (SSO) was disabled. Register your identity provider showed Provider ID, Issuer URL, Email domain, Client ID, Client secret and Register provider.";
    },
  );

  await step(
    "Complete Register your identity provider and select Register provider",
    "OpenLaw shows a callback URL to copy, and the SSO switch becomes available.",
    async () => {
      await page.getByLabel("Provider ID", { exact: true }).fill("doc029-harbor");
      await page.getByLabel("Issuer URL", { exact: true }).fill("http://oidc:8080");
      await page.getByLabel("Email domain", { exact: true }).fill("harbor.example");
      await page.getByLabel("Client ID", { exact: true }).fill("doc029-first-run-client");
      await page.getByLabel("Client secret", { exact: true }).fill(randomBytes(12).toString("hex"));
      await button(page, "Register provider").click();
      await expect(page.getByText("Identity provider doc029-harbor is registered.")).toBeVisible();
      const callback = (await page.getByText(/Paste this callback URL into your IdP console:/).textContent()).trim();
      must(callback.includes(BASE), `callback does not use the instance address: ${callback}`);
      await expect(page.getByRole("switch", { name: "Single sign-on (SSO)", exact: true })).toBeEnabled();
      return `The step showed "Identity provider doc029-harbor is registered." and "${callback}". The Single sign-on (SSO) switch became enabled. The issuer was a local OpenID Connect stand-in.`;
    },
  );

  await step(
    "Change an Authentication switch, then select Set up later",
    "The wizard moves to Business-user portal without saving the change.",
    async () => {
      const pw = page.getByRole("switch", { name: "Email and password", exact: true });
      if ((await pw.getAttribute("aria-checked")) !== "true") await pw.click();
      const ml = page.getByRole("switch", { name: "Email magic link", exact: true });
      await ml.click();
      const where = await expectStep(page, "Authentication", 3);
      await button(page, "Set up later").click();
      const next = await expectStep(page, "Business-user portal", 4);
      const after = await getJson(context, "/api/v1/auth/methods");
      must(JSON.stringify(after.policy.legal) === JSON.stringify(methodsBefore.policy.legal), `policy changed to ${JSON.stringify(after.policy.legal)}`);
      return `From ${where}, Set up later opened ${next}. Saved legal policy stayed ${JSON.stringify(after.policy.legal)}.`;
    },
  );

  let twoFactorSecretSeen = false;
  await step(
    "Turn on Email and password, Email magic link and Require two-factor authentication, then select Continue",
    "OpenLaw makes the Administrator set up two-factor authentication before continuing.",
    async () => {
      await button(page, "Back").click();
      await expectStep(page, "Authentication", 3);
      for (const name of ["Email and password", "Email magic link", "Require two-factor authentication"]) {
        const sw = page.getByRole("switch", { name, exact: true });
        if ((await sw.getAttribute("aria-checked")) !== "true") await sw.click();
      }
      await button(page, "Continue").click();
      await expect(page).toHaveURL(/\/auth\/two-factor\/enroll$/);
      await expect(page.getByText("Your organization requires two-factor authentication.")).toBeVisible();
      const methods = await getJson(context, "/api/v1/auth/methods");
      must(methods.policy.legal.requireTwoFactor === true && methods.policy.legal.magicLink === true && methods.policy.legal.password === true, `legal policy ${JSON.stringify(methods.policy.legal)}`);
      await landsOnEnrollAnyway(page);
      return `Continue saved the legal policy ${JSON.stringify(methods.policy.legal)} and opened /auth/two-factor/enroll with "Your organization requires two-factor authentication." Opening /welcome and / also returned to the enrollment page.`;
    },
  );
  async function landsOnEnrollAnyway(p) {
    for (const target of ["/welcome", "/"]) {
      await p.goto(`${BASE}${target}`);
      await expect(p).toHaveURL(/\/auth\/two-factor\/enroll$/);
    }
  }

  await step(
    "Set up two-factor authentication with an authenticator code",
    "After setup, the wizard opens again at its Welcome step and the saved choices remain.",
    async () => {
      await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
      const [enableResponse] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/two-factor/enable") && r.request().method() === "POST"),
        button(page, "Turn on two-factor").click(),
      ]);
      const enabled = await enableResponse.json();
      const secret = new URL(enabled.totpURI).searchParams.get("secret");
      twoFactorSecretSeen = Boolean(secret);
      await page.getByLabel("Code", { exact: true }).fill(totp(secret));
      await button(page, "Confirm").click();
      await expect(page.getByText(/Two-factor authentication is on\. Save these backup codes/)).toBeVisible();
      const link = page.getByRole("link", { name: /^(Done|Continue)$/ }).first();
      const linkName = (await link.textContent()).trim();
      await link.click();
      await expect(page).toHaveURL(/\/welcome$/);
      const where = await expectStep(page, "Welcome to OpenLaw", 1);
      const me = await getJson(context, "/api/v1/me");
      must(!me.user.twoFactorSetupRequired && !me.user.twoFactorVerificationRequired, "two-factor still pending");
      await button(page, "Get started").click();
      await expectStep(page, "Your organization", 2);
      must((await page.getByLabel("Organization name").inputValue()) === orgName, "organization name lost");
      await button(page, "Continue").click();
      await expectStep(page, "Authentication", 3);
      const state = {};
      for (const name of ["Email and password", "Email magic link", "Single sign-on (SSO)", "Require two-factor authentication"])
        state[name] = (await page.getByRole("switch", { name, exact: true }).getAttribute("aria-checked")) === "true";
      must(state["Email and password"] && state["Email magic link"] && state["Require two-factor authentication"], `switches ${JSON.stringify(state)}`);
      return `The enrollment page accepted a generated TOTP code and showed the backup-code notice. "${linkName}" led to /welcome at ${where}; /me reported no pending two-factor step. Get started showed the saved name, and Authentication showed ${JSON.stringify(state)}.`;
    },
  );

  await step(
    "Continue from Authentication without changes",
    "Business-user portal opens.",
    async () => {
      await button(page, "Continue").click();
      const where = await expectStep(page, "Business-user portal", 4);
      for (const name of ["Email and password", "Email magic link", "Single sign-on (SSO)", "Require two-factor authentication"])
        await expect(page.getByRole("switch", { name, exact: true })).toBeVisible();
      await expect(page.getByText("No domains allowed yet. Magic-link sign-in is unavailable.")).toBeVisible();
      return `${where}. The step showed the same four switches for Business Users, Allowed email domains, and "No domains allowed yet. Magic-link sign-in is unavailable."`;
    },
  );

  await step(
    "Add a domain, then select Set up later",
    "The wizard moves to Outbound email without saving the domain.",
    async () => {
      await page.getByLabel("Allowed email domains").fill("unsaved.example");
      await button(page, "Add").click();
      await expect(button(page, "Remove unsaved.example")).toBeVisible();
      await button(page, "Set up later").click();
      const where = await expectStep(page, "Outbound email", 5);
      const domains = await getJson(context, "/api/v1/auth/allowed-domains");
      must(domains.domains.length === 0, `domains saved: ${domains.domains}`);
      await button(page, "Back").click();
      await expectStep(page, "Business-user portal", 4);
      if (await button(page, "Remove unsaved.example").count()) await button(page, "Remove unsaved.example").click();
      return `${where}. The saved allowed-domain list stayed empty.`;
    },
  );

  await step(
    "Add an entry with an email username",
    "The guide asks for a domain without an email username; record what OpenLaw does with one.",
    async () => {
      await page.getByLabel("Allowed email domains").fill("rowan@harbor.example");
      await button(page, "Add").click();
      await page.waitForTimeout(300);
      const listed = await button(page, "Remove rowan@harbor.example").count();
      let outcome = "not added to the list";
      if (listed) {
        await button(page, "Continue").click();
        await page.waitForTimeout(1500);
        const heading = await stepHeading(page);
        const alert = (await page.getByRole("alert").allTextContents()).join(" | ");
        const domains = await getJson(context, "/api/v1/auth/allowed-domains");
        must(!domains.domains.includes("rowan@harbor.example"), "OpenLaw saved an address as a domain");
        outcome = `added to the draft list; Continue stayed on ${heading} with "${alert}" and nothing was saved`;
        if (heading !== "Business-user portal") {
          await button(page, "Back").click();
        }
        await expectStep(page, "Business-user portal", 4);
        await button(page, "Remove rowan@harbor.example").click();
      }
      return `An entry with an email username was ${outcome}.`;
    },
  );

  await step(
    "Turn on Email magic link for Business Users, add helix.example and harbor.example, then select Continue",
    "Continue saves the switches and the list and opens Outbound email.",
    async () => {
      const ml = page.getByRole("switch", { name: "Email magic link", exact: true });
      if ((await ml.getAttribute("aria-checked")) !== "true") await ml.click();
      for (const d of ["helix.example", "harbor.example"]) {
        await page.getByLabel("Allowed email domains").fill(d);
        await button(page, "Add").click();
        await expect(button(page, `Remove ${d}`)).toBeVisible();
      }
      await button(page, "Continue").click();
      const where = await expectStep(page, "Outbound email", 5);
      const domains = await getJson(context, "/api/v1/auth/allowed-domains");
      const methods = await getJson(context, "/api/v1/auth/methods");
      must(JSON.stringify([...domains.domains].sort()) === JSON.stringify(["harbor.example", "helix.example"]), `domains ${domains.domains}`);
      must(methods.policy.business.magicLink === true, "business magic link not saved");
      return `${where}. Saved domains ${JSON.stringify(domains.domains)}; business policy ${JSON.stringify(methods.policy.business)}.`;
    },
  );

  await step(
    "In Outbound email check the configuration source set by the deployment environment",
    "The step is read-only, has no Set up later, and Continue is available because email is configured.",
    async () => {
      const text = (await page.getByText(/Outbound email is set by the deployment environment/).textContent()).trim();
      for (const label of ["SMTP relay URL", "From address"])
        must((await page.getByLabel(label, { exact: true }).count()) === 0, `${label} field is shown`);
      for (const name of ["Save relay", "Send test email", "Clear relay", "Replace relay", "Set up later"])
        must((await button(page, name).count()) === 0, `${name} is shown`);
      await expect(button(page, "Continue")).toBeEnabled();
      return `The step said "${text}" It showed no relay fields, no Save relay, Send test email, Replace relay, Clear relay or Set up later. Continue was enabled.`;
    },
  );

  await step(
    "Continue to Invite your team and invite a Legal team member",
    "Name, Email, Legal team member, Administrator and Send invite are offered; the invitation is sent.",
    async () => {
      await button(page, "Continue").click();
      const where = await expectStep(page, "Invite your team", 6);
      await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
      await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
      const roles = await page.locator("fieldset button").allTextContents();
      must(JSON.stringify(roles) === JSON.stringify(["Legal team member", "Administrator"]), `roles ${roles}`);
      await page.getByLabel("Name", { exact: true }).fill("DOC-029 first-run Rowan Lee");
      await page.getByLabel("Email", { exact: true }).fill("rowan.lee@harbor.example");
      await button(page, "Legal team member").click();
      await button(page, "Send invite").click();
      await expect(page.getByText(/1 invite sent:/)).toBeVisible();
      const mail = await waitMail("rowan.lee@harbor.example");
      return `${where}. Role choices ${JSON.stringify(roles)}. Send invite showed "1 invite sent:" and Mailpit received ${mail.count} message(s) for rowan.lee@harbor.example, subject ${JSON.stringify(mail.subjects)}.`;
    },
  );

  await step(
    "Invite an Administrator",
    "The invitation is sent with the Administrator role.",
    async () => {
      await page.getByLabel("Name", { exact: true }).fill("DOC-029 first-run Sam Ortiz");
      await page.getByLabel("Email", { exact: true }).fill("sam.ortiz@harbor.example");
      await button(page, "Administrator").click();
      must((await button(page, "Administrator").getAttribute("aria-pressed")) === "true", "Administrator not selected");
      await button(page, "Send invite").click();
      await expect(page.getByText(/2 invites sent:/)).toBeVisible();
      const mail = await waitMail("sam.ortiz@harbor.example");
      return `Send invite showed "2 invites sent:" and Mailpit received ${mail.count} message(s) for sam.ortiz@harbor.example.`;
    },
  );

  await step(
    "Type a third invitation without sending it, then select Set up later",
    "The wizard moves to E-signature and the unsent invitation is not sent.",
    async () => {
      await page.getByLabel("Name", { exact: true }).fill("DOC-029 first-run Unsent");
      await page.getByLabel("Email", { exact: true }).fill("unsent.person@harbor.example");
      await button(page, "Set up later").click();
      const where = await expectStep(page, "E-signature", 7);
      await page.waitForTimeout(2000);
      const mail = await mailTo("unsent.person@harbor.example");
      must(mail.count === 0, "the unsent invitation was delivered");
      return `${where}. Mailpit had no message for unsent.person@harbor.example.`;
    },
  );

  await step(
    "In E-signature select Set up later",
    "The manual signing hand-off stays; AI analysis opens.",
    async () => {
      const hint = (await page.getByText(/The manual hand-off stays the path/).textContent()).trim();
      await button(page, "Set up later").click();
      const where = await expectStep(page, "AI analysis", 8);
      const onboarding = await getJson(context, "/api/v1/onboarding");
      must(onboarding.steps["e-signature"].done === false, "signing connector configured");
      return `E-signature said "${hint}". Set up later opened ${where}; the Signing connector stayed unconfigured.`;
    },
  );

  await step(
    "In AI analysis select Set up later",
    "Without a connector Contract analysis does not run; Review opens.",
    async () => {
      const hint = (await page.getByText(/Skip it and Contract analysis does not run/).textContent()).trim();
      await button(page, "Set up later").click();
      const where = await expectStep(page, "Review", 9);
      const onboarding = await getJson(context, "/api/v1/onboarding");
      must(onboarding.steps["ai-analysis"].done === false, "AI connector configured");
      return `AI analysis said "${hint}". Set up later opened ${where}; the AI connector stayed unconfigured.`;
    },
  );

  await step(
    "In Review check the row counts and reminder offsets",
    "Review shows the seeded lists with row counts and the reminder offsets, with Finish.",
    async () => {
      const rows = await page.locator("main table tbody tr").evaluateAll((trs) =>
        trs.map((tr) => ({ list: tr.querySelector("th a")?.textContent.trim(), rows: tr.querySelector("td")?.textContent.trim(), detail: tr.querySelector("th p")?.textContent.trim() ?? undefined })),
      );
      must(rows.length >= 2, "no review rows");
      must(rows.some((r) => r.list === "Reminder offsets"), "no Reminder offsets row");
      await expect(button(page, "Finish")).toBeVisible();
      await expect(button(page, "Set up later")).toBeVisible();
      const onboarding = await getJson(context, "/api/v1/onboarding");
      must(!onboarding.completed && !onboarding.steps.review.done, "already completed or reviewed");
      await page.screenshot({ path: path.join(here, "r1-a-review-step.png") });
      return `Review rows ${JSON.stringify(rows)}. Finish and Set up later were shown; onboarding was not yet complete or reviewed.`;
    },
  );

  await step(
    "Select Finish",
    "Finish records the review, ends onboarding and enters the app.",
    async () => {
      await button(page, "Finish").click();
      await expect(page).toHaveURL(`${BASE}/`);
      await page.waitForLoadState("networkidle");
      must(new URL(page.url()).pathname === "/", `ended at ${page.url()}`);
      const onboarding = await getJson(context, "/api/v1/onboarding");
      must(onboarding.completed && onboarding.steps.review.done, `onboarding ${JSON.stringify(onboarding)}`);
      return "Finish opened Home at /. The onboarding API reported completed true and review done true.";
    },
  );

  await step(
    "Try to reopen the welcome wizard after completion",
    "The wizard cannot be reopened; Home opens instead.",
    async () => {
      await page.goto(`${BASE}/welcome`);
      await page.waitForLoadState("networkidle");
      const at = new URL(page.url()).pathname;
      must(at === "/", `ended at ${at}`);
      return "/welcome redirected to / after completion.";
    },
  );

  await step(
    "After completion open Settings -> Organization -> General and Users",
    "Name, logo and timezone are shown; the checklist lists only unfinished steps; invited users appear in Users.",
    async () => {
      await page.goto(`${BASE}/settings/general`);
      await expect(page.getByLabel("Organization name")).toHaveValue(orgName);
      const rows = await outstandingRows(page);
      const labels = rows.map((r) => r.label).sort();
      must(JSON.stringify(labels) === JSON.stringify(["AI analysis", "E-signature"]), `rows ${JSON.stringify(rows)}`);
      await page.goto(`${BASE}/settings/users`);
      await expect(page.getByText("DOC-029 first-run Rowan Lee")).toBeVisible();
      await expect(page.getByText("DOC-029 first-run Sam Ortiz")).toBeVisible();
      must((await page.getByText("DOC-029 first-run Unsent").count()) === 0, "unsent invite listed");
      for (const p of ["/settings/authentication", "/settings/integrations/e-signature", "/settings/ai-analysis"]) {
        await page.goto(`${BASE}${p}`);
        await page.waitForLoadState("networkidle");
        must(new URL(page.url()).pathname === p, `${p} redirected to ${page.url()}`);
      }
      return `General showed the saved name. Setup checklist rows after Finish: ${JSON.stringify(rows)}. Users listed Rowan Lee and Sam Ortiz and not the unsent entry. /settings/authentication, /settings/integrations/e-signature and /settings/ai-analysis opened.`;
    },
  );
  run.notes = `The TOTP secret was read from the enrollment response in memory only (${twoFactorSecretSeen ? "seen" : "not seen"}); it is not recorded.`;
  await context.close();
}

async function phaseB0() {
  const context = await browser.newContext();
  const page = await context.newPage();
  await step("Create the first Administrator (or sign in, if an earlier run on this lab created it) on an instance whose environment sets SMTP_URL but not SMTP_FROM", "The unfinished wizard opens at Welcome to OpenLaw.", async () => {
    const { needsSetup } = await (await context.request.get(`${BASE}/api/v1/auth/setup`)).json();
    if (needsSetup) await createAdministrator(page);
    else {
      await signIn(page);
      await page.goto(`${BASE}/welcome`);
    }
    const onboarding = await getJson(context, "/api/v1/onboarding");
    must(!onboarding.completed, "onboarding already complete");
    return `${needsSetup ? "Created" : "Signed in as"} the first Administrator. ${await expectStep(page, "Welcome to OpenLaw", 1)}.`;
  });
  await step("While email is not configured, open Home and other app pages", "Every app page opens the wizard.", async () => {
    const out = [];
    for (const p of ["/", "/settings/general", "/contracts", "/matters"]) out.push(await landsOnWizard(page, p));
    return out.join("; ");
  });
  await step("On Welcome select Skip optional steps while email is not configured", "Outbound email opens instead of ending onboarding; it says SMTP_FROM is not set; no Set up later; Continue unavailable.", async () => {
    await expectStep(page, "Welcome to OpenLaw", 1);
    await button(page, "Skip optional steps").click();
    const where = await expectStep(page, "Outbound email", 5);
    const warning = (await page.getByText(/sets SMTP_URL but not SMTP_FROM/).textContent()).trim();
    must((await button(page, "Set up later").count()) === 0, "Set up later shown");
    must((await button(page, "Save relay").count()) === 0, "Save relay shown for an environment source");
    await expect(button(page, "Continue")).toBeDisabled();
    const onboarding = await getJson(context, "/api/v1/onboarding");
    must(!onboarding.completed, "onboarding completed");
    await page.screenshot({ path: path.join(here, "r1-b0-smtp-from-missing.png") });
    return `${where}. It said "${warning}" No Set up later or Save relay; Continue disabled; onboarding not complete.`;
  });
  await context.close();
}

async function phaseB1() {
  const context = await browser.newContext();
  const page = await context.newPage();
  await step("Sign in again after the operator removes email from the environment", "The unfinished wizard opens.", async () => {
    await signIn(page);
    await page.waitForLoadState("networkidle");
    must(new URL(page.url()).pathname === "/welcome", `landed at ${page.url()}`);
    return expectStep(page, "Welcome to OpenLaw", 1);
  });
  await step("While email is unset, open Home and other app pages", "Every app page opens the wizard.", async () => {
    const out = [];
    for (const p of ["/", "/settings/users", "/requests"]) out.push(await landsOnWizard(page, p));
    return out.join("; ");
  });
  await step("Select Skip optional steps with email unset", "Outbound email opens with SMTP relay URL, From address and Save relay; no Set up later; Continue unavailable.", async () => {
    await button(page, "Skip optional steps").click();
    const where = await expectStep(page, "Outbound email", 5);
    await expect(page.getByLabel("SMTP relay URL")).toBeVisible();
    await expect(page.getByLabel("From address")).toBeVisible();
    await expect(button(page, "Save relay")).toBeVisible();
    must((await button(page, "Set up later").count()) === 0, "Set up later shown");
    await expect(button(page, "Continue")).toBeDisabled();
    return `${where}. SMTP relay URL, From address and Save relay shown; no Set up later; Continue disabled.`;
  });
  await step("Save a relay that is not an SMTP URL", "The relay is refused and email stays unset.", async () => {
    await page.getByLabel("SMTP relay URL").fill("https://mail.harbor.example");
    await page.getByLabel("From address").fill("DOC-029 first-run <legal@harbor.example>");
    await button(page, "Save relay").click();
    await page.waitForTimeout(1000);
    const alerts = (await page.getByRole("alert").allTextContents()).join(" | ");
    const settings = await getJson(context, "/api/v1/email-settings");
    must(settings.source === "unset", `source ${settings.source}`);
    await expect(button(page, "Continue")).toBeDisabled();
    return `Save relay with an https:// URL left source "${settings.source}" and Continue disabled. Messages: "${alerts}".`;
  });
  await step("Enter SMTP relay URL and From address, select Save relay, then Send test email", "The relay saves, Continue becomes available, and a test email reaches the Administrator.", async () => {
    await page.getByLabel("SMTP relay URL").fill("smtp://mailpit:1025");
    await page.getByLabel("From address").fill("DOC-029 first-run <legal@harbor.example>");
    await button(page, "Save relay").click();
    await expect(page.getByText("Relay saved. The next email this instance sends will use it.")).toBeVisible();
    const inApp = (await page.getByText(/Outbound email is set in the app/).textContent()).trim();
    await expect(button(page, "Continue")).toBeEnabled();
    const before = (await mailTo(ADMIN.email)).count;
    await button(page, "Send test email").click();
    await expect(page.getByText(/Test email sent to .* Check your inbox\./)).toBeVisible();
    const mail = await waitMail(ADMIN.email, before + 1);
    return `"Relay saved..." and "${inApp}" shown; Continue enabled. Send test email reported success and Mailpit held ${mail.count} message(s) for the Administrator.`;
  });
  await step("Move through the remaining steps with Set up later, and select Set up later on Review", "Set up later on Review ends onboarding without recording the review.", async () => {
    await button(page, "Continue").click();
    await expectStep(page, "Invite your team", 6);
    await button(page, "Set up later").click();
    await expectStep(page, "E-signature", 7);
    await button(page, "Set up later").click();
    await expectStep(page, "AI analysis", 8);
    await button(page, "Set up later").click();
    await expectStep(page, "Review", 9);
    await button(page, "Set up later").click();
    await expect(page).toHaveURL(`${BASE}/`);
    await page.waitForLoadState("networkidle");
    must(new URL(page.url()).pathname === "/", `ended at ${page.url()}`);
    const onboarding = await getJson(context, "/api/v1/onboarding");
    must(onboarding.completed === true && onboarding.steps.review.done === false, JSON.stringify(onboarding));
    return "Set up later on Review opened Home at /. The onboarding API reported completed true and review done false.";
  });
  await step("Open Settings -> Organization -> General and select Mark as reviewed on Review seeded types", "The checklist lists the unfinished steps with Settings links; Mark as reviewed removes the Review row.", async () => {
    await page.goto(`${BASE}/settings/general`);
    const rows = await outstandingRows(page);
    const labels = rows.map((r) => r.label);
    for (const expected of ["Organization", "Business-user portal", "Invite your team", "E-signature", "AI analysis", "Review seeded types"])
      must(labels.includes(expected), `missing ${expected} in ${JSON.stringify(rows)}`);
    must(!labels.includes("Email"), "Email row shown while email is configured");
    for (const r of rows.filter((x) => x.label !== "Review seeded types")) must(r.href?.startsWith("/settings/"), `${r.label} not linked`);
    const reviewRow = page.getByRole("list", { name: "Outstanding setup steps" }).locator("li", { hasText: "Review seeded types" });
    await reviewRow.getByRole("button", { name: "Mark as reviewed" }).click();
    await expect(page.getByRole("list", { name: "Outstanding setup steps" }).getByText("Review seeded types")).toHaveCount(0);
    const onboarding = await getJson(context, "/api/v1/onboarding");
    must(onboarding.steps.review.done === true, "review not recorded");
    const firstLink = rows.find((r) => r.label === "Business-user portal");
    await page.getByRole("list", { name: "Outstanding setup steps" }).getByRole("link", { name: "Business-user portal" }).click();
    await expect(page).toHaveURL(`${BASE}${firstLink.href}`);
    return `Rows before: ${JSON.stringify(rows)}. Mark as reviewed removed Review seeded types and the API reported review done true. The Business-user portal row opened ${firstLink.href}.`;
  });
  await step("Try to reopen the wizard after Set up later on Review", "The wizard cannot be reopened.", async () => {
    await page.goto(`${BASE}/welcome`);
    await page.waitForLoadState("networkidle");
    must(new URL(page.url()).pathname === "/", `ended at ${page.url()}`);
    return "/welcome redirected to /.";
  });
  await context.close();
}

async function phaseB2() {
  const context = await browser.newContext();
  const page = await context.newPage();
  await step("After completion, with SMTP_URL set and SMTP_FROM unset in the environment, open Settings -> Organization -> General", "The Setup checklist shows Email as a row without a Settings link.", async () => {
    await signIn(page);
    await page.waitForLoadState("networkidle");
    const landed = new URL(page.url()).pathname;
    await page.goto(`${BASE}/settings/general`);
    const rows = await outstandingRows(page);
    const email = rows.find((r) => r.label === "Email");
    must(email && email.href === null, `rows ${JSON.stringify(rows)}`);
    for (const r of rows.filter((x) => !["Email", "Review seeded types"].includes(x.label))) must(r.href?.startsWith("/settings/"), `${r.label} not linked`);
    await page.screenshot({ path: path.join(here, "r1-b2-checklist-email-row.png") });
    return `Sign-in landed at ${landed}. Setup checklist rows: ${JSON.stringify(rows)}.`;
  });
  await context.close();
}

async function phaseC() {
  const context = await browser.newContext();
  const page = await context.newPage();
  await step("Create the first Administrator on a fresh instance with email set by the environment", "Setup opens Welcome to OpenLaw.", async () => {
    await createAdministrator(page);
    return expectStep(page, "Welcome to OpenLaw", 1);
  });
  await step("On Welcome select Skip optional steps with email configured", "Onboarding ends and the app opens without recording the review.", async () => {
    await button(page, "Skip optional steps").click();
    await expect(page).toHaveURL(`${BASE}/`);
    await page.waitForLoadState("networkidle");
    must(new URL(page.url()).pathname === "/", `ended at ${page.url()}`);
    const onboarding = await getJson(context, "/api/v1/onboarding");
    must(onboarding.completed === true && onboarding.steps.review.done === false, JSON.stringify(onboarding));
    await page.goto(`${BASE}/welcome`);
    await page.waitForLoadState("networkidle");
    must(new URL(page.url()).pathname === "/", `welcome reopened at ${page.url()}`);
    await page.goto(`${BASE}/settings/general`);
    const rows = await outstandingRows(page);
    return `Skip optional steps opened Home at /. The onboarding API reported completed true and review done false. /welcome then redirected to /. Setup checklist rows: ${JSON.stringify(rows)}.`;
  });
  await context.close();
}
