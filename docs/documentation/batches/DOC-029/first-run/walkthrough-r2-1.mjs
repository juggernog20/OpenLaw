// DOC-029 round 2 independent walkthrough, run 1, for the "Set up a new OpenLaw instance" guide (first-run).
// Scenario V-C35, role administrator, method browser-walkthrough, app commit 57e77e38.
// The reviewer adapted the round 1 script (walkthrough-r1.mjs) to the current article text.
// The reviewer did not write the article.
//
// Run from the repository root, one phase at a time, inside its own network namespace:
//   PHASE=A SCRATCH=... LAB_ADMIN_PASSWORD=... pasta --config-net -T 23311,23411 -- mise exec -- node docs/documentation/batches/DOC-029/first-run/walkthrough-r2-1.mjs
// The namespace matters on a shared host. Other labs create and remove Docker networks all the time.
// Chromium in the host namespace sees each change and aborts open requests with net::ERR_NETWORK_CHANGED.
// Phases and the lab state that each phase needs:
//   A   fresh unseeded lab, lab default email environment (SMTP_URL and SMTP_FROM set). Full path to Finish.
//   B0  fresh unseeded lab, app and worker recreated with SMTP_URL set and SMTP_FROM empty before the first account.
//   B1  same lab as B0, app and worker recreated with SMTP_URL and SMTP_FROM empty (email unset).
//   B2  same lab as B1 after completion, app and worker recreated with SMTP_URL set and SMTP_FROM empty.
//   C   fresh unseeded lab, lab default email environment. Skip optional steps.
// The first Administrator password comes only from the environment. The script never writes it,
// a cookie, a TOTP secret, a backup code, an SMTP password, or mail content to the log.
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
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
const OUT = path.join(here, "walkthrough-r2-1.json");
const ARTICLE = path.join(root, "docs/user-guides/first-run.md");
const LAB = JSON.parse(readFileSync(path.join(root, ".documentation-labs/firstrun-r2/lab.json"), "utf8"));

const ADMIN = {
  name: "DOC-029r2 first-run Avery Morgan",
  email: "avery.morgan@harbor.example",
};
const LOGO_MESSAGE = "That logo must be a PNG, JPEG, WebP, or SVG image 5 MB or smaller. Pick another file.";

const articleSha = createHash("sha256").update(readFileSync(ARTICLE)).digest("hex");

const log = existsSync(OUT)
  ? JSON.parse(readFileSync(OUT, "utf8"))
  : {
      record: "walkthrough-r2-1",
      articleId: "first-run",
      scenario: "V-C35",
      reviewer: "DOC-029r2 independent walkthrough agent (first-run, round 1)",
      reviewerKind: "agent",
      appCommit: "57e77e386be31b2a319f7143dd54d00123e65efe",
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
  browserNetwork: process.env.BROWSER_NETWORK_NOTE ?? "host network namespace",
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
let currentPage = null;
async function step(action, expected, fn, { continueOnFail = false } = {}) {
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
    if (currentPage) {
      try {
        const main = (await currentPage.locator("main").first().innerText({ timeout: 3000 })).replace(/\s+/g, " ").slice(0, 400);
        entry.actual += ` Page at failure: ${pathOf(currentPage)}; main text "${main}".`;
        await currentPage.screenshot({ path: path.join(SCRATCH, `fail-${PHASE}-${run.steps.length}.png`) });
      } catch (diagError) {
        entry.actual += ` Page at failure: ${currentPage.url()} (no main text: ${String(diagError).slice(0, 80)}).`;
      }
    }
    entry.result = "fail";
  }
  entry.at = new Date().toISOString();
  console.log(`[${PHASE}] ${entry.result.toUpperCase()} ${action}${entry.result === "fail" ? `: ${entry.actual}` : ""}`);
  save();
  // Later steps depend on this one, so a failed step stops the phase.
  if (entry.result === "fail" && !continueOnFail) throw new Error(`stopped after failed step: ${action}`);
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
const pathOf = (page) => {
  const u = new URL(page.url());
  return `${u.pathname}${u.search}`;
};
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
  return ((hmac.readUInt32BE(o) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
}
// PNG files built in scratch. Random pixels with stored (level 0) compression give a predictable size.
function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(width, height, random) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = random ? randomBytes(width * 3 + 1) : Buffer.alloc(width * 3 + 1, 0x40);
    row[0] = 0;
    rows.push(row);
  }
  const idat = deflateSync(Buffer.concat(rows), { level: random ? 0 : 9 });
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
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
  await expect(page).toHaveURL(/\/welcome(\?|$)/);
}
async function signIn(page) {
  await page.goto(`${BASE}/auth/login`);
  await page.getByLabel("Email", { exact: true }).fill(ADMIN.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await button(page, "Sign in").click();
  await expect(page).not.toHaveURL(/\/auth\/login/);
}
async function landsOnWizardWelcome(page, p) {
  await page.goto(`${BASE}${p}`);
  await page.waitForLoadState("networkidle");
  const url = new URL(page.url()).pathname;
  must(url === "/welcome", `${p} ended at ${url}, not /welcome`);
  const where = await expectStep(page, "Welcome to OpenLaw", 1);
  return `${p} -> ${pathOf(page)} (${where})`;
}
async function brandOnSignIn(browser) {
  const other = await browser.newContext();
  const p = await other.newPage();
  await p.goto(`${BASE}/auth/login`);
  await expect(p.getByLabel("Email", { exact: true })).toBeVisible();
  await p.waitForLoadState("networkidle");
  const brand = await p.locator("main p.text-lg").first().textContent();
  const logos = p.getByRole("img", { name: "Organization logo" });
  const logoCount = await logos.count();
  let logoLoaded = false;
  if (logoCount) logoLoaded = await logos.first().evaluate((img) => img.complete && img.naturalWidth > 0);
  const powered = await p.getByText("Powered by OpenLaw", { exact: true }).count();
  await other.close();
  return { brand: brand?.trim(), logoCount, logoLoaded, powered };
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
  currentPage = page;

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
      await expect(page).toHaveURL(/\/welcome(\?|$)/);
      const where = await expectStep(page, "Welcome to OpenLaw", 1);
      const me = await getJson(context, "/api/v1/me");
      must(me.user.role === "administrator", `role is ${me.user.role}`);
      await expect(button(page, "Get started")).toBeVisible();
      await expect(button(page, "Skip optional steps")).toBeVisible();
      must((await button(page, "Set up later").count()) === 0, "Welcome shows Set up later");
      return `Signed in as an administrator at ${pathOf(page)}. ${where}. The step shows Get started and Skip optional steps, and no Set up later.`;
    },
  );

  let brandBefore;
  await step(
    "Try account setup again after a user exists",
    "Account setup is not available; the visitor is sent to Sign in.",
    async () => {
      const other = await browser.newContext();
      const p2 = await other.newPage();
      await p2.goto(`${BASE}/auth/setup`);
      await expect(p2).toHaveURL(/\/auth\/login$/);
      const res = await other.request.post(`${BASE}/api/v1/auth/setup`, {
        data: { email: "second.admin@harbor.example", displayName: "DOC-029r2 first-run Second", password: randomBytes(9).toString("hex") },
      });
      const body = await res.json().catch(() => ({}));
      await other.close();
      must(res.status() === 409, `setup API answered ${res.status()}`);
      brandBefore = await brandOnSignIn(browser);
      return `A separate signed-out context was redirected from /auth/setup to /auth/login. The setup API answered 409 "${body.detail}". Before any organization save, Sign in showed brand ${JSON.stringify(brandBefore)}.`;
    },
  );

  await step(
    "Before onboarding completes, open Home and a Settings page",
    "Home opens the wizard at its Welcome step. With email configured by the environment, other pages open normally.",
    async () => {
      const home = await landsOnWizardWelcome(page, "/");
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
      const where = await expectStep(page, "Your organization", 2);
      return `${where} at ${pathOf(page)}.`;
    },
  );

  const bigPng = path.join(SCRATCH, "doc029r2-logo-over-5mb.png");
  const okPng = path.join(SCRATCH, "doc029r2-logo-under-5mb.png");
  const gif = path.join(SCRATCH, "doc029r2-logo.gif");
  writeFileSync(bigPng, png(1200, 1500, true));
  writeFileSync(okPng, png(1200, 1300, true));
  writeFileSync(gif, Buffer.from("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", "base64"));
  const sizes = { over: readFileSync(bigPng).length, under: readFileSync(okPng).length };
  await step(
    "In Your organization check the locale, the logo rules, and the Upload control",
    "Default locale offers only English (United States); Upload accepts a PNG of 5 MB or smaller and refuses a GIF and a PNG over 5 MB.",
    async () => {
      const options = await page.locator("#org-locale option").allTextContents();
      must(options.length === 1 && options[0] === "English (United States)", `locale options ${JSON.stringify(options)}`);
      await expect(button(page, "Upload")).toBeVisible();
      const accept = await page.getByLabel("Upload a logo").getAttribute("accept");
      const [chooserGif] = await Promise.all([page.waitForEvent("filechooser"), button(page, "Upload").click()]);
      await chooserGif.setFiles(gif);
      await expect(page.getByText(LOGO_MESSAGE)).toBeVisible();
      const [chooserBig] = await Promise.all([page.waitForEvent("filechooser"), button(page, "Upload").click()]);
      await chooserBig.setFiles(bigPng);
      await expect(page.getByText(LOGO_MESSAGE)).toBeVisible();
      must((await page.getByRole("img", { name: "Organization logo" }).count()) === 0, "a refused logo shows a preview");
      const [chooserOk] = await Promise.all([page.waitForEvent("filechooser"), button(page, "Upload").click()]);
      await chooserOk.setFiles(okPng);
      await expect(page.getByRole("img", { name: "Organization logo" })).toBeVisible();
      await expect(page.getByText(LOGO_MESSAGE)).toHaveCount(0);
      return `Default locale had one option, "English (United States)". The file input accepted "${accept}". A GIF and a ${sizes.over}-byte PNG (over 5 MB) were refused with "${LOGO_MESSAGE}"; a ${sizes.under}-byte PNG (under 5 MB) showed the Organization logo preview.`;
    },
  );

  const orgName = "DOC-029r2 first-run Harbor Legal";
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
      let reuploaded = false;
      if ((await page.getByRole("img", { name: "Organization logo" }).count()) === 0) {
        const [chooser] = await Promise.all([page.waitForEvent("filechooser"), button(page, "Upload").click()]);
        await chooser.setFiles(okPng);
        await expect(page.getByRole("img", { name: "Organization logo" })).toBeVisible();
        reuploaded = true;
      }
      await button(page, "Continue").click();
      const where = await expectStep(page, "Authentication", 3);
      const general = await getJson(context, "/api/v1/org/general");
      must(general.general.name === orgName, `name is ${general.general.name}`);
      must(general.general.defaultTimezone === "Europe/Lisbon", `timezone is ${general.general.defaultTimezone}`);
      must(typeof general.general.logo === "string" && general.general.logo.startsWith("data:image/png"), "logo not saved");
      const decoded = Buffer.byteLength(general.general.logo.slice(general.general.logo.indexOf(",") + 1), "base64");
      must(decoded === sizes.under, `saved logo is ${decoded} bytes, uploaded ${sizes.under}`);
      return `${where}. ${reuploaded ? "The draft logo was gone after Back, so the same PNG was chosen again. " : ""}The API read back name "${orgName}", timezone Europe/Lisbon, locale ${general.general.defaultLocale}, and a PNG logo of ${decoded} bytes.`;
    },
  );

  await step(
    "Open the sign-in page in a signed-out browser after saving Your organization",
    "The sign-in page shows the saved organization name and logo.",
    async () => {
      const after = await brandOnSignIn(browser);
      must(after.brand === orgName, `brand is ${after.brand}`);
      must(after.logoCount === 1 && after.logoLoaded, `logo ${JSON.stringify(after)}`);
      return `Before the save, Sign in showed ${JSON.stringify(brandBefore)}. After the save, it showed ${JSON.stringify(after)}.`;
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
      must((await p2.getByText("Return to setup", { exact: true }).count()) === 0, "Return to setup shown on a direct Settings visit");
      await p2.screenshot({ path: path.join(here, "r2-1-a-setup-checklist.png") });
      await p2.close();
      const labels = rows.map((r) => r.label);
      must(!labels.includes("Organization"), "Organization still listed after saving");
      const review = rows.find((r) => r.label === "Review seeded types");
      must(review && review.href === null && review.markAsReviewed, "Review seeded types row lacks Mark as reviewed or has a link");
      for (const r of rows.filter((x) => x.label !== "Review seeded types"))
        must(r.href && r.href.startsWith("/settings/"), `${r.label} has no Settings link`);
      return `Settings nav showed Organization with General and Users, and no Email page. No Return to setup on a direct visit. Setup checklist rows: ${JSON.stringify(rows)}.`;
    },
  );

  await step(
    "On Your organization type an unsaved name change, then reload the wizard page",
    "The reload keeps the current step from the page address; the saved settings remain; the unsaved entry does not.",
    async () => {
      await button(page, "Back").click();
      await expectStep(page, "Your organization", 2);
      const before = pathOf(page);
      must(before.includes("step=organization"), `address is ${before}`);
      await page.getByLabel("Organization name").fill("DOC-029r2 first-run Unsaved Name");
      await page.reload();
      const where = await expectStep(page, "Your organization", 2);
      const afterReload = pathOf(page);
      const value = await page.getByLabel("Organization name").inputValue();
      must(value === orgName, `name field shows ${value}`);
      await expect(page.getByRole("img", { name: "Organization logo" })).toBeVisible();
      await button(page, "Continue").click();
      await expectStep(page, "Authentication", 3);
      const general = await getJson(context, "/api/v1/org/general");
      must(general.general.name === orgName, "unsaved name was saved");
      return `Address before reload ${before}. After reload: ${where} at ${afterReload}; the name field showed the saved "${value}" and the saved logo, not the unsaved entry. Continue opened Authentication.`;
    },
  );

  await step(
    "From a later step, open Home before onboarding completes",
    "Home opens the wizard again at its Welcome step; Get started continues.",
    async () => {
      const at = pathOf(page);
      const home = await landsOnWizardWelcome(page, "/");
      await button(page, "Get started").click();
      await expectStep(page, "Your organization", 2);
      await button(page, "Continue").click();
      await expectStep(page, "Authentication", 3);
      return `From ${at}: ${home}. Get started opened Your organization; Continue returned to Authentication.`;
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
      await page.getByLabel("Provider ID", { exact: true }).fill("doc029r2-harbor");
      await page.getByLabel("Issuer URL", { exact: true }).fill("http://oidc:8080");
      await page.getByLabel("Email domain", { exact: true }).fill("harbor.example");
      await page.getByLabel("Client ID", { exact: true }).fill("doc029r2-first-run-client");
      await page.getByLabel("Client secret", { exact: true }).fill(randomBytes(12).toString("hex"));
      await button(page, "Register provider").click();
      await expect(page.getByText("Identity provider doc029r2-harbor is registered.")).toBeVisible();
      const callback = (await page.getByText(/Paste this callback URL into your IdP console:/).textContent()).trim();
      must(callback.includes(BASE), `callback does not use the instance address: ${callback}`);
      await expect(page.getByRole("switch", { name: "Single sign-on (SSO)", exact: true })).toBeEnabled();
      return `The step showed "Identity provider doc029r2-harbor is registered." and "${callback}". The Single sign-on (SSO) switch became enabled. The issuer was a local OpenID Connect stand-in.`;
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
      // Observe first, then judge, so a failure records what the Administrator actually sees.
      await page.waitForTimeout(4000);
      const obs = [];
      const afterContinue = pathOf(page);
      const onEnroll = /\/auth\/two-factor\/enroll$/.test(new URL(page.url()).pathname);
      obs.push(`after Continue the page was ${afterContinue}${onEnroll ? "" : ` showing "${await stepHeading(page)}" (${await progress(page)})`}`);
      const methods = await getJson(context, "/api/v1/auth/methods");
      const me = await getJson(context, "/api/v1/me");
      if (!onEnroll) await page.screenshot({ path: path.join(here, "r2-1-a-two-factor-after-continue.png") });
      obs.push(`saved legal policy ${JSON.stringify(methods.policy.legal)}; /me twoFactorSetupRequired ${me.user.twoFactorSetupRequired}`);
      if (!onEnroll) {
        await button(page, "Get started").click();
        await page.waitForTimeout(1500);
        obs.push(`Get started then showed ${pathOf(page)} "${await stepHeading(page)}"`);
        await button(page, "Continue").click();
        await page.waitForTimeout(1500);
        obs.push(`Continue on Your organization then showed ${pathOf(page)} "${await stepHeading(page)}"`);
        await page.reload();
        await page.waitForLoadState("networkidle");
        obs.push(`a reload then went to ${pathOf(page)}`);
      }
      for (const target of ["/welcome?step=portal", "/"]) {
        await page.goto(`${BASE}${target}`);
        await page.waitForLoadState("networkidle");
        obs.push(`opening ${target} went to ${pathOf(page)}`);
      }
      await page.goto(`${BASE}/`);
      await expect(page).toHaveURL(/\/auth\/two-factor\/enroll$/);
      await expect(page.getByText("Your organization requires two-factor authentication.")).toBeVisible();
      must(methods.policy.legal.requireTwoFactor === true && methods.policy.legal.magicLink === true && methods.policy.legal.password === true, `legal policy ${JSON.stringify(methods.policy.legal)}`);
      must(onEnroll, `Continue did not open two-factor setup. Observed: ${obs.join("; ")}.`);
      return `Continue opened two-factor setup. Observed: ${obs.join("; ")}.`;
    },
    { continueOnFail: true },
  );

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
      await expect(page).toHaveURL(/\/welcome(\?|$)/);
      const where = await expectStep(page, "Welcome to OpenLaw", 1);
      const landed = pathOf(page);
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
      return `The enrollment page accepted a generated TOTP code and showed the backup-code notice. "${linkName}" led to ${landed} at ${where}; /me reported no pending two-factor step. Get started showed the saved name, and Authentication showed ${JSON.stringify(state)}.`;
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
      await expect(page.getByLabel("Allowed email domains")).toBeVisible();
      const empty = (await page.getByText(/No domains allowed yet/).allTextContents()).join(" | ");
      return `${where}. The step showed the same four switches for Business Users, Allowed email domains, and "${empty}".`;
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
      const alertsAfterAdd = (await page.getByRole("alert").allTextContents()).join(" | ");
      let outcome = `not added to the list${alertsAfterAdd ? ` ("${alertsAfterAdd}")` : ""}`;
      if (listed) {
        await button(page, "Continue").click();
        await page.waitForTimeout(1500);
        const heading = await stepHeading(page);
        const alert = (await page.getByRole("alert").allTextContents()).join(" | ");
        const domains = await getJson(context, "/api/v1/auth/allowed-domains");
        must(!domains.domains.includes("rowan@harbor.example"), "OpenLaw saved an address as a domain");
        outcome = `added to the draft list; Continue stayed on ${heading} with "${alert}" and nothing was saved`;
        if (heading !== "Business-user portal") await button(page, "Back").click();
        await expectStep(page, "Business-user portal", 4);
        await button(page, "Remove rowan@harbor.example").click();
      }
      const domains = await getJson(context, "/api/v1/auth/allowed-domains");
      must(!domains.domains.includes("rowan@harbor.example"), "OpenLaw saved an address as a domain");
      return `An entry with an email username was ${outcome}. The saved list did not contain it.`;
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
      for (const label of ["SMTP server", "Port", "Connection security", "Authentication", "Sender email", "SMTP relay URL", "From address"])
        must((await page.getByLabel(label, { exact: true }).count()) === 0, `${label} field is shown`);
      for (const name of ["Save relay", "Send test email", "Clear relay", "Replace relay", "Set up later"])
        must((await button(page, name).count()) === 0, `${name} is shown`);
      await expect(button(page, "Continue")).toBeEnabled();
      return `The step said "${text}" It showed no SMTP server, Port, Connection security, Authentication or Sender email fields, and no Save relay, Send test email, Replace relay, Clear relay or Set up later. Continue was enabled.`;
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
      await page.getByLabel("Name", { exact: true }).fill("DOC-029r2 first-run Rowan Lee");
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
      await page.getByLabel("Name", { exact: true }).fill("DOC-029r2 first-run Sam Ortiz");
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
      await page.getByLabel("Name", { exact: true }).fill("DOC-029r2 first-run Unsent");
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
      return `E-signature said "${hint}". Set up later opened ${where}; the onboarding API reported the E-signature step not done.`;
    },
  );

  await step(
    "In AI analysis select Set up later",
    "The AI connector stays unconfigured; Review opens.",
    async () => {
      const hint = (await page.getByText(/^Optional\. Connect an AI provider/).textContent()).trim();
      await button(page, "Set up later").click();
      const where = await expectStep(page, "Review", 9);
      const onboarding = await getJson(context, "/api/v1/onboarding");
      must(onboarding.steps["ai-analysis"].done === false, "AI connector configured");
      return `AI analysis said "${hint}". Set up later opened ${where}; the onboarding API reported the AI analysis step not done.`;
    },
  );

  let reviewRows;
  await step(
    "In Review check the row counts and reminder offsets",
    "Review shows the seeded lists with row counts, separate Matter fields, Contract fields and Entity fields rows, the reminder offsets, and Finish.",
    async () => {
      reviewRows = await page.locator("main table tbody tr").evaluateAll((trs) =>
        trs.map((tr) => ({ list: tr.querySelector("th a")?.textContent.trim(), href: tr.querySelector("th a")?.getAttribute("href"), rows: tr.querySelector("td")?.textContent.trim() })),
      );
      const lists = reviewRows.map((r) => r.list);
      for (const name of ["Matter fields", "Contract fields", "Entity fields", "Reminder offsets"])
        must(lists.includes(name), `no ${name} row in ${JSON.stringify(lists)}`);
      await expect(button(page, "Finish")).toBeVisible();
      await expect(button(page, "Set up later")).toBeVisible();
      const onboarding = await getJson(context, "/api/v1/onboarding");
      must(!onboarding.completed && !onboarding.steps.review.done, "already completed or reviewed");
      await page.screenshot({ path: path.join(here, "r2-1-a-review-step.png") });
      return `Review rows ${JSON.stringify(reviewRows)}. Finish and Set up later were shown; onboarding was not yet complete or reviewed.`;
    },
  );

  await step(
    "In Review select a list name, then select Return to setup",
    "Settings opens that list and shows Return to setup, which opens Review again.",
    async () => {
      const target = reviewRows.find((r) => r.list === "Contract fields");
      await page.getByRole("link", { name: "Contract fields", exact: true }).click();
      await expect(page).toHaveURL(`${BASE}${target.href}`);
      const link = page.getByRole("link", { name: "Return to setup", exact: true });
      await expect(link).toBeVisible();
      const href = await link.getAttribute("href");
      await page.screenshot({ path: path.join(here, "r2-1-a-return-to-setup.png") });
      await link.click();
      const where = await expectStep(page, "Review", 9);
      const back = pathOf(page);
      await page.getByRole("link", { name: "Reminder offsets", exact: true }).click();
      await expect(page).toHaveURL(/\/settings\/reminders$/);
      await expect(page.getByRole("link", { name: "Return to setup", exact: true })).toBeVisible();
      await page.getByRole("link", { name: "Return to setup", exact: true }).click();
      await expectStep(page, "Review", 9);
      return `Contract fields opened ${target.href} with a Return to setup link to ${href}. That link opened ${where} at ${back}. Reminder offsets opened /settings/reminders with Return to setup, which also returned to Review.`;
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
      const out = [];
      for (const target of ["/welcome", "/welcome?step=review"]) {
        await page.goto(`${BASE}${target}`);
        await page.waitForLoadState("networkidle");
        const at = new URL(page.url()).pathname;
        must(at === "/", `${target} ended at ${at}`);
        out.push(`${target} -> ${at}`);
      }
      return `${out.join("; ")} after completion.`;
    },
  );

  await step(
    "After completion open Settings -> Organization -> General and Users",
    "Name, logo and timezone are shown; the checklist lists only unfinished steps; invited users appear in Users; the other settings pages open.",
    async () => {
      await page.goto(`${BASE}/settings/general`);
      await expect(page.getByLabel("Organization name")).toHaveValue(orgName);
      // The General pane shows the saved logo as a decorative image (empty alt text).
      await expect(page.locator('main img[src^="data:image/png"]').first()).toBeVisible();
      const tzShown = await page.getByRole("combobox", { name: "Default timezone" }).inputValue().catch(() => "not read");
      const rows = await outstandingRows(page);
      const labels = rows.map((r) => r.label).sort();
      must(JSON.stringify(labels) === JSON.stringify(["AI analysis", "E-signature"]), `rows ${JSON.stringify(rows)}`);
      await page.goto(`${BASE}/settings/users`);
      await expect(page.getByText("DOC-029r2 first-run Rowan Lee")).toBeVisible();
      await expect(page.getByText("DOC-029r2 first-run Sam Ortiz")).toBeVisible();
      must((await page.getByText("DOC-029r2 first-run Unsent").count()) === 0, "unsent invite listed");
      for (const p of ["/settings/authentication", "/settings/integrations/e-signature", "/settings/ai-analysis"]) {
        await page.goto(`${BASE}${p}`);
        await page.waitForLoadState("networkidle");
        must(new URL(page.url()).pathname === p, `${p} redirected to ${page.url()}`);
      }
      return `General showed the saved name, the saved PNG logo, and Default timezone "${tzShown}". Setup checklist rows after Finish: ${JSON.stringify(rows)}. Users listed Rowan Lee and Sam Ortiz and not the unsent entry. /settings/authentication, /settings/integrations/e-signature and /settings/ai-analysis opened.`;
    },
  );
  run.notes = `The TOTP secret was read from the enrollment response in memory only (${twoFactorSecretSeen ? "seen" : "not seen"}); it is not recorded. Logo PNG files were generated in scratch outside the worktree.`;
  await context.close();
}

async function phaseB0() {
  const context = await browser.newContext();
  const page = await context.newPage();
  currentPage = page;
  await step("Create the first Administrator on a fresh instance whose environment sets SMTP_URL but not SMTP_FROM", "Setup signs the Administrator in and opens Welcome to OpenLaw.", async () => {
    const { needsSetup } = await (await context.request.get(`${BASE}/api/v1/auth/setup`)).json();
    must(needsSetup === true, "instance already has users");
    await createAdministrator(page);
    const onboarding = await getJson(context, "/api/v1/onboarding");
    must(!onboarding.completed, "onboarding already complete");
    return `Created the first Administrator through Set up OpenLaw. ${await expectStep(page, "Welcome to OpenLaw", 1)}.`;
  });
  await step("While email is not configured, open Home and other app pages", "Every app page opens the wizard at its Welcome step.", async () => {
    const out = [];
    for (const p of ["/", "/settings/general", "/contracts", "/matters"]) out.push(await landsOnWizardWelcome(page, p));
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
    await page.screenshot({ path: path.join(here, "r2-1-b0-smtp-from-missing.png") });
    return `${where} at ${pathOf(page)}. It said "${warning}" No Set up later or Save relay; Continue disabled; onboarding not complete.`;
  });
  await step("Open Review by its page address while email is not configured, then select Finish and Set up later", "Setup cannot finish without working outbound email: each action opens Outbound email and onboarding stays open.", async () => {
    const out = [];
    for (const name of ["Finish", "Set up later"]) {
      await page.goto(`${BASE}/welcome?step=review`);
      await expectStep(page, "Review", 9);
      await button(page, name).click();
      const where = await expectStep(page, "Outbound email", 5);
      await page.waitForTimeout(1000);
      const onboarding = await getJson(context, "/api/v1/onboarding");
      must(!onboarding.completed && !onboarding.steps.review.done, `${name} changed onboarding ${JSON.stringify(onboarding)}`);
      out.push(`${name} on Review opened ${where} at ${pathOf(page)}; onboarding completed ${onboarding.completed}, review done ${onboarding.steps.review.done}`);
    }
    return out.join(". ") + ".";
  });
  await context.close();
}

async function phaseB1() {
  const context = await browser.newContext();
  const page = await context.newPage();
  currentPage = page;
  await step("Sign in again after the operator removes email from the environment", "The unfinished wizard opens.", async () => {
    await signIn(page);
    await page.waitForLoadState("networkidle");
    must(new URL(page.url()).pathname === "/welcome", `landed at ${page.url()}`);
    return `${pathOf(page)}: ${await expectStep(page, "Welcome to OpenLaw", 1)}`;
  });
  await step("While email is unset, open Home and other app pages", "Every app page opens the wizard at its Welcome step.", async () => {
    const out = [];
    for (const p of ["/", "/settings/users", "/requests"]) out.push(await landsOnWizardWelcome(page, p));
    return out.join("; ");
  });
  await step("Select Skip optional steps with email unset", "Outbound email opens with SMTP server, Port, Connection security, Authentication, Sender email, Sender name (optional) and Save relay; no Set up later; Continue unavailable.", async () => {
    await button(page, "Skip optional steps").click();
    const where = await expectStep(page, "Outbound email", 5);
    for (const label of ["SMTP server", "Port", "Connection security", "Authentication", "Sender name (optional)", "Sender email"])
      await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    const authOptions = await page.getByLabel("Authentication", { exact: true }).locator("option").allTextContents();
    const securityOptions = await page.getByLabel("Connection security", { exact: true }).locator("option").allTextContents();
    const authValue = await page.getByLabel("Authentication", { exact: true }).evaluate((el) => el.selectedOptions[0].textContent);
    await expect(button(page, "Save relay")).toBeVisible();
    must((await button(page, "Set up later").count()) === 0, "Set up later shown");
    must((await button(page, "Send test email").count()) === 0, "Send test email shown before a relay is saved");
    await expect(button(page, "Continue")).toBeDisabled();
    return `${where} at ${pathOf(page)}. SMTP server, Port, Connection security (${JSON.stringify(securityOptions)}), Authentication (${JSON.stringify(authOptions)}, selected "${authValue}"), Sender name (optional), Sender email and Save relay shown; no Set up later or Send test email; Continue disabled.`;
  });
  await step("Reload the wizard page on Outbound email", "The reload keeps Outbound email because the step is part of the page address.", async () => {
    const before = pathOf(page);
    await page.reload();
    const where = await expectStep(page, "Outbound email", 5);
    return `Reloaded ${before}; the wizard showed ${where}.`;
  });
  await step("With Authentication set to Username and password, leave SMTP username and SMTP password empty and select Save relay", "SMTP username and SMTP password show and are required; nothing saves.", async () => {
    await page.getByLabel("Authentication", { exact: true }).selectOption({ label: "Username and password" });
    await expect(page.getByLabel("SMTP username", { exact: true })).toBeVisible();
    await expect(page.getByLabel("SMTP password", { exact: true })).toBeVisible();
    await page.getByLabel("SMTP server", { exact: true }).fill("mailpit");
    await page.getByLabel("Sender email", { exact: true }).fill("legal@harbor.example");
    await button(page, "Save relay").click();
    await page.waitForTimeout(800);
    const missing = await page.getByLabel("SMTP username", { exact: true }).evaluate((el) => el.validity.valueMissing);
    const missingPw = await page.getByLabel("SMTP password", { exact: true }).evaluate((el) => el.validity.valueMissing);
    must(missing && missingPw, "username/password not required");
    const settings = await getJson(context, "/api/v1/email-settings");
    must(settings.source === "unset", `source ${settings.source}`);
    await page.getByLabel("Authentication", { exact: true }).selectOption({ label: "None" });
    must((await page.getByLabel("SMTP username", { exact: true }).count()) === 0, "username still shown with None");
    return `With Username and password selected, SMTP username and SMTP password showed and both reported a missing value; source stayed "${settings.source}". With None selected, the two fields were hidden.`;
  });
  await step("Save a relay whose SMTP server is a URL", "The relay is refused and email stays unset.", async () => {
    await page.getByLabel("SMTP server", { exact: true }).fill("https://mail.harbor.example");
    await page.getByLabel("Connection security", { exact: true }).selectOption({ label: "None" });
    await page.getByLabel("Port", { exact: true }).fill("1025");
    await page.getByLabel("Sender email", { exact: true }).fill("legal@harbor.example");
    await button(page, "Save relay").click();
    await page.waitForTimeout(1500);
    const alerts = (await page.getByRole("alert").allTextContents()).join(" | ");
    const settings = await getJson(context, "/api/v1/email-settings");
    must(settings.source === "unset", `source ${settings.source}`);
    await expect(button(page, "Continue")).toBeDisabled();
    return `Save relay with SMTP server "https://mail.harbor.example" left source "${settings.source}" and Continue disabled. Messages: "${alerts}".`;
  });
  await step("Enter SMTP server, Port, Connection security, Authentication, Sender name and Sender email, select Save relay, then Send test email", "The relay saves, Continue becomes available, and a test email reaches the Administrator.", async () => {
    await page.getByLabel("SMTP server", { exact: true }).fill("mailpit");
    await page.getByLabel("Connection security", { exact: true }).selectOption({ label: "None" });
    await page.getByLabel("Port", { exact: true }).fill("1025");
    await page.getByLabel("Authentication", { exact: true }).selectOption({ label: "None" });
    await page.getByLabel("Sender name (optional)", { exact: true }).fill("DOC-029r2 first-run Harbor Legal");
    await page.getByLabel("Sender email", { exact: true }).fill("legal@harbor.example");
    await button(page, "Save relay").click();
    await expect(page.getByText("Relay saved. The next email this instance sends will use it.")).toBeVisible();
    const inApp = (await page.getByText(/Outbound email is set in the app/).textContent()).trim();
    await expect(button(page, "Continue")).toBeEnabled();
    must((await button(page, "Set up later").count()) === 0, "Set up later shown after saving");
    const before = (await mailTo(ADMIN.email)).count;
    await button(page, "Send test email").click();
    await expect(page.getByText(/Test email sent to .* Check your inbox\./)).toBeVisible();
    const mail = await waitMail(ADMIN.email, before + 1);
    const settings = await getJson(context, "/api/v1/email-settings");
    return `"Relay saved. The next email this instance sends will use it." and "${inApp}" shown; source "${settings.source}"; Continue enabled; still no Set up later. Send test email reported success and Mailpit held ${mail.count} message(s) for the Administrator, subjects ${JSON.stringify(mail.subjects)}.`;
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
  currentPage = page;
  await step("After completion, with SMTP_URL set and SMTP_FROM unset in the environment, open Settings -> Organization -> General", "The Setup checklist shows Email as a row without a Settings link.", async () => {
    await signIn(page);
    await page.waitForLoadState("networkidle");
    const landed = new URL(page.url()).pathname;
    await page.goto(`${BASE}/settings/general`);
    const rows = await outstandingRows(page);
    const email = rows.find((r) => r.label === "Email");
    must(email && email.href === null, `rows ${JSON.stringify(rows)}`);
    for (const r of rows.filter((x) => !["Email", "Review seeded types"].includes(x.label))) must(r.href?.startsWith("/settings/"), `${r.label} not linked`);
    await page.screenshot({ path: path.join(here, "r2-1-b2-checklist-email-row.png") });
    return `Sign-in landed at ${landed}. Setup checklist rows: ${JSON.stringify(rows)}.`;
  });
  await context.close();
}

async function phaseC() {
  const context = await browser.newContext();
  const page = await context.newPage();
  currentPage = page;
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
