// DOC-030 independent walkthrough for the "Set up a new OpenLaw instance" guide (first-run).
// Scenario V-C35, role administrator, method browser-walkthrough, app commit 067c1646.
// The walkthrough agent did not write the guide. It follows the guide's own steps in a browser.
// Pattern copied from docs/documentation/batches/DOC-029/first-run/walkthrough-r3-1.mjs.
//
// Run from the worktree root, one phase at a time, inside its own network namespace:
//   LAB=firstrun2 PHASE=P0 SCRATCH=... LAB_ADMIN_PASSWORD=... \
//     pasta --config-net -T 43301,48426 -- node docs/documentation/batches/DOC-030/first-run/walkthrough.mjs
// The namespace matters on a shared host: Chromium in the host namespace aborts open requests with
// net::ERR_NETWORK_CHANGED each time another lab adds or removes a Docker network.
//
// Labs and phases:
//   firstrun2 (fresh, empty). One lifecycle, one Administrator, ends with Finish.
//     P0      email environment SMTP_URL set, SMTP_FROM empty (applied by the script before setup).
//             Wrong origin, setup token and password validation, account setup, email-required redirects,
//             Skip optional steps, and Finish / Set up later refused on Review.
//     P1ORG   email environment unset (applied by the script). Redirects, Your organization, logo rules.
//     P1AUTH  Authentication, SSO registration against a local OpenID Connect stand-in, two-factor detour.
//     P1PORTAL Business-user portal and Outbound email (form, validation, Save relay, test email, logo in mail).
//     P1INV   Setup checklist mid-way, Invite your team (logo in the invitation), E-signature, AI analysis.
//     P1REV   Review, Return to setup, Start blank (in-use refusal, success, audit log, user-row refusal,
//             onboarding-complete refusal raced against Finish in a second tab), Finish.
//     P1AFTER After Finish: wizard closed, Settings, app header.
//     P2      After completion, email environment SMTP_URL set and SMTP_FROM empty: checklist Email row.
//             Ends by restoring the lab default email environment.
//   firstrun3 (fresh, empty, lab default email environment). Two lifecycles.
//     C1      Skip optional steps with email configured.
//     C2      Set up later through every step, Set up later on Review, Mark as reviewed.
//     C3      Finish without Start blank.
//   firstrun4 (fresh, empty, lab default email environment). Re-walk after the author corrected step 3.
//     R       Create the first Administrator, steps 1 to 3, with every validation case.
//
// The first Administrator password comes only from the environment. The setup token is read from the lab
// .env at run time. The script never writes the password, the setup token, a cookie, a TOTP secret, a
// backup code, an SMTP password, a magic link or a raw mail message into any file under docs/.
// The browser session and the TOTP secret for later phases live only in SCRATCH, outside the worktree.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
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
const LAB_NAME = process.env.LAB;
const PASSWORD = process.env.LAB_ADMIN_PASSWORD;
const SCRATCH = process.env.SCRATCH;
if (!PHASE || !LAB_NAME || !PASSWORD || !SCRATCH)
  throw new Error("PHASE, LAB, LAB_ADMIN_PASSWORD and SCRATCH are required");
const LAB_DIR = path.join(root, ".documentation-labs", LAB_NAME);
const LAB = JSON.parse(readFileSync(path.join(LAB_DIR, "lab.json"), "utf8"));
const BASE = LAB.appUrl;
const MAIL = LAB.mailUrl;
const WRONG_ORIGIN = BASE.replace("127.0.0.1", "localhost");
// The setup token, read at run time from the lab .env. Never logged or written under docs/.
const SETUP_TOKEN = readFileSync(path.join(LAB_DIR, "source/.env"), "utf8").match(
  /^SETUP_TOKEN=(.+)$/m,
)?.[1];
if (!SETUP_TOKEN) throw new Error("No SETUP_TOKEN in the lab .env");

const OUT = path.join(here, "walkthrough.json");
const ARTICLE = path.join(root, "docs/user-guides/first-run.md");
const STATE = path.join(SCRATCH, `state-${LAB_NAME}.json`);
const SECRET_FILE = path.join(SCRATCH, `totp-${LAB_NAME}.txt`);

const ADMIN = { name: "Avery Morgan", email: "avery.morgan@harbor.example" };
const ORG_NAME = "Harbor Legal DOC-030";
const LOGO_MESSAGE =
  "That logo must be a PNG, JPEG, WebP, or SVG image 5 MB or smaller. Pick another file.";
const PIXEL_MESSAGE =
  "The logo must be a readable PNG, JPEG, WebP or SVG with no more than 16 million pixels.";
const TOKEN_MESSAGE =
  "The setup token is missing or wrong. Copy it from the server log, or from SETUP_TOKEN.";
const ORIGIN_MESSAGE = "This request did not come from this OpenLaw instance's own origin.";

const articleSha = createHash("sha256").update(readFileSync(ARTICLE)).digest("hex");

const log = existsSync(OUT)
  ? JSON.parse(readFileSync(OUT, "utf8"))
  : {
      record: "walkthrough",
      batch: "DOC-030",
      group: "first-run",
      articleId: "first-run",
      scenario: "V-C35",
      reviewer: "DOC-030 independent walkthrough agent (first-run)",
      reviewerKind: "agent",
      appCommit: "067c1646829df85e62b809ee9157921e867c84e7",
      applicationSha256: "34696f7630914abb33db524b3ae30eb4a89416460e5f2fe8df46457aa26f3c0d",
      runs: [],
    };
const run = {
  lab: LAB_NAME,
  phase: PHASE,
  labProject: LAB.project,
  labCreatedAt: LAB.createdAt,
  labStartedAt: LAB.startedAt,
  appImageId: LAB.appImageId,
  engineImageId: LAB.engineImageId,
  sourceCommit: LAB.sourceCommit,
  emailEnvironment: null,
  browserNetwork: process.env.BROWSER_NETWORK_NOTE ?? "pasta network namespace",
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
    page: null,
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
        const main = (await currentPage.locator("body").first().innerText({ timeout: 3000 }))
          .replace(/\s+/g, " ")
          .slice(0, 500);
        entry.actual += ` Page at failure: ${pathOf(currentPage)}; text "${main}".`;
        await currentPage.screenshot({
          path: path.join(SCRATCH, `fail-${LAB_NAME}-${PHASE}-${run.steps.length}.png`),
        });
      } catch (diagError) {
        entry.actual += ` Page at failure: ${currentPage.url()} (no text: ${String(diagError).slice(0, 80)}).`;
      }
    }
    entry.result = "fail";
  }
  if (currentPage) entry.page = pathOf(currentPage);
  entry.at = new Date().toISOString();
  console.log(
    `[${LAB_NAME} ${PHASE}] ${entry.result.toUpperCase()} ${action}${entry.result === "fail" ? `: ${entry.actual}` : ""}`,
  );
  save();
  if (entry.result === "fail" && !continueOnFail)
    throw new Error(`stopped after failed step: ${action}`);
  return entry;
}
function must(condition, message) {
  if (!condition) throw new Error(message);
}

// ---------- lab email environment ----------
const OVERLAYS = {
  default: null,
  "from-missing": {
    app: { SMTP_URL: "smtp://mailpit:1025", SMTP_FROM: "" },
    worker: { SMTP_URL: "smtp://mailpit:1025", SMTP_FROM: "" },
  },
  unset: {
    app: { SMTP_URL: "", SMTP_FROM: "" },
    worker: { SMTP_URL: "", SMTP_FROM: "" },
  },
};
const ENV_NOTES = {
  default: "lab default overlay (SMTP_URL smtp://mailpit:1025 and SMTP_FROM set)",
  "from-missing": "lab overlay plus SMTP_URL smtp://mailpit:1025 and SMTP_FROM empty (app and worker)",
  unset: "lab overlay plus SMTP_URL and SMTP_FROM empty (app and worker)",
};
async function applyEmailEnvironment(kind) {
  const args = [
    "--context",
    "default",
    "compose",
    "--project-name",
    LAB.project,
    "--env-file",
    path.join(LAB_DIR, "source/.env"),
    "--file",
    path.join(LAB_DIR, "source/compose.yml"),
    "--file",
    path.join(LAB_DIR, "overlay.json"),
  ];
  if (OVERLAYS[kind]) {
    const file = path.join(SCRATCH, `email-${kind}.overlay.json`);
    writeFileSync(
      file,
      JSON.stringify({
        services: {
          app: { environment: OVERLAYS[kind].app },
          worker: { environment: OVERLAYS[kind].worker },
        },
      }),
    );
    args.push("--file", file);
  }
  execFileSync(
    "docker",
    [...args, "up", "-d", "--no-deps", "--force-recreate", "--wait", "app", "worker"],
    {
      stdio: "ignore",
    },
  );
  for (let i = 0; i < 90; i += 1) {
    try {
      const r = await fetch(`${BASE}/api/v1/auth/setup`);
      if (r.ok) {
        if (!run.emailEnvironment) run.emailEnvironment = ENV_NOTES[kind];
        return;
      }
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("app not ready after recreate");
}

// ---------- helpers ----------
async function stepHeading(page) {
  const id = await page
    .locator("main section[aria-labelledby]")
    .first()
    .getAttribute("aria-labelledby");
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
  return `${u.host === new URL(BASE).host ? "" : u.origin}${u.pathname}${u.search}`;
};
const button = (page, name) => page.getByRole("button", { name, exact: true });
async function getJson(context, p) {
  const res = await context.request.get(`${BASE}${p}`);
  must(res.ok(), `GET ${p} answered ${res.status()}`);
  return res.json();
}
async function postJson(context, p, data, method = "post") {
  const res = await context.request[method](`${BASE}${p}`, {
    data,
    headers: { origin: BASE },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status(), body };
}
async function mailpit(p) {
  const r = await fetch(`${MAIL}${p}`);
  if (!r.ok) throw new Error(`Mailpit ${r.status} for ${p}`);
  return r.json();
}
async function mailTo(address) {
  const body = await mailpit(
    `/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}&limit=50`,
  );
  return {
    count: body.messages_count ?? body.total ?? 0,
    messages: body.messages ?? [],
    subjects: (body.messages ?? []).map((m) => m.Subject),
  };
}
async function waitMail(address, atLeast = 1) {
  for (let i = 0; i < 60; i += 1) {
    const found = await mailTo(address);
    if (found.count >= atLeast) return found;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No mail reached ${address}`);
}
// Reads the newest message to an address and checks the email header: the organization name and the
// organization logo attached inline as cid:org-logo@openlaw. Records only structure, never the body.
async function checkMailHeader(address, subjectRe, screenshotName) {
  const found = await waitMail(address);
  const summary = found.messages.find((m) => subjectRe.test(m.Subject));
  must(summary, `no message matching ${subjectRe} for ${address}: ${JSON.stringify(found.subjects)}`);
  const message = await mailpit(`/api/v1/message/${summary.ID}`);
  const html = message.HTML ?? "";
  const inline = (message.Inline ?? []).map((part) => ({
    contentId: part.ContentID,
    contentType: part.ContentType,
    fileName: part.FileName,
    partId: part.PartID,
  }));
  const logoPart = inline.find((p) => p.contentId === "org-logo@openlaw");
  must(html.includes('src="cid:org-logo@openlaw"'), "the HTML header does not use cid:org-logo@openlaw");
  must(logoPart, `no inline part org-logo@openlaw in ${JSON.stringify(inline)}`);
  must(html.includes(ORG_NAME), "the organization name is not in the email");
  const res = await fetch(`${MAIL}/api/v1/message/${summary.ID}/part/${logoPart.partId}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const isPng = bytes.subarray(1, 4).toString() === "PNG";
  const width = isPng ? bytes.readUInt32BE(16) : null;
  const height = isPng ? bytes.readUInt32BE(20) : null;
  let shot = null;
  if (screenshotName) {
    const ctx = await browser.newContext({ viewport: { width: 760, height: 420 } });
    const p = await ctx.newPage();
    await p.goto(`${MAIL}/view/${summary.ID}.html`);
    await p.waitForLoadState("networkidle");
    await p.screenshot({ path: path.join(here, screenshotName), clip: { x: 0, y: 0, width: 760, height: 260 } });
    await ctx.close();
    shot = screenshotName;
  }
  return {
    subject: summary.Subject,
    headerUsesOrgLogo: true,
    orgNameInHeader: true,
    logoPart: { contentId: logoPart.contentId, contentType: logoPart.contentType, fileName: logoPart.fileName, png: isPng, width, height },
    screenshot: shot,
  };
}
function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of input.replace(/=+$/, "").toUpperCase())
    bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
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
// PNG built in scratch. "random" gives incompressible pixels (predictable size); "badge" draws a simple
// two-colour mark; otherwise the image is one flat colour.
function png(width, height, mode) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < height; y++) {
    let row;
    if (mode === "random") row = randomBytes(width * 3 + 1);
    else if (mode === "badge") {
      row = Buffer.alloc(width * 3 + 1);
      for (let x = 0; x < width; x++) {
        const inner = x > width * 0.2 && x < width * 0.8 && y > height * 0.2 && y < height * 0.8;
        const bar = inner && y > height * 0.45 && y < height * 0.55;
        const rgb = bar ? [255, 255, 255] : inner ? [217, 119, 6] : [15, 76, 129];
        row[1 + x * 3] = rgb[0];
        row[2 + x * 3] = rgb[1];
        row[3 + x * 3] = rgb[2];
      }
    } else row = Buffer.alloc(width * 3 + 1, 0x40);
    row[0] = 0;
    rows.push(row);
  }
  const idat = deflateSync(Buffer.concat(rows), { level: mode === "random" ? 0 : 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
async function outstandingRows(page) {
  const list = page.getByRole("list", { name: "Outstanding setup steps" });
  await expect(list).toBeVisible();
  return list.locator("li").evaluateAll((items) =>
    items.map((li) => {
      const a = li.querySelector("a");
      return {
        label: (a ? a.textContent : (li.childNodes[0]?.textContent ?? li.textContent)).trim(),
        href: a ? a.getAttribute("href") : null,
        markAsReviewed: [...li.querySelectorAll("button")].some(
          (b) => b.textContent.trim() === "Mark as reviewed",
        ),
      };
    }),
  );
}
async function fillSetup(page, { token, password, confirm }) {
  await page.getByLabel("Setup token").fill(token);
  await page.getByLabel("Name", { exact: true }).fill(ADMIN.name);
  await page.getByLabel("Email", { exact: true }).fill(ADMIN.email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(confirm);
}
async function createAdministrator(page) {
  await page.goto(`${BASE}/`);
  await expect(page).toHaveURL(/\/auth\/setup$/);
  await fillSetup(page, { token: SETUP_TOKEN, password: PASSWORD, confirm: PASSWORD });
  await button(page, "Create Administrator").click();
  await expect(page).toHaveURL(/\/welcome(\?|$)/);
}
async function landsOnWizardWelcome(page, p) {
  await page.goto(`${BASE}${p}`);
  await page.waitForLoadState("networkidle");
  const url = new URL(page.url()).pathname;
  must(url === "/welcome", `${p} ended at ${url}, not /welcome`);
  const where = await expectStep(page, "Welcome to OpenLaw", 1);
  return `${p} -> ${pathOf(page)} (${where})`;
}
async function brandOnSignIn() {
  const other = await browser.newContext();
  const p = await other.newPage();
  await p.goto(`${BASE}/auth/login`);
  await expect(p.getByLabel("Email", { exact: true })).toBeVisible();
  await p.waitForLoadState("networkidle");
  const brand = await p.locator("main p.text-lg").first().textContent();
  const logos = p.getByRole("img", { name: "Organization logo" });
  const logoCount = await logos.count();
  let logoLoaded = false;
  if (logoCount)
    logoLoaded = await logos.first().evaluate((img) => img.complete && img.naturalWidth > 0);
  await other.close();
  return { brand: brand?.trim(), logoCount, logoLoaded };
}
async function headerBrand(page) {
  const header = page.locator("header").first();
  await expect(header).toBeVisible();
  const name = (await header.locator("span[title]").first().getAttribute("title")) ?? "";
  const img = header.locator("img").first();
  const imgCount = await header.locator("img").count();
  const src = imgCount ? await img.getAttribute("src") : null;
  const loaded = imgCount ? await img.evaluate((i) => i.complete && i.naturalWidth > 0) : false;
  return { name, logo: Boolean(src?.startsWith("data:image/png")), loaded };
}
async function savedState(context) {
  await context.storageState({ path: STATE });
  chmodSync(STATE, 0o600);
}
async function reviewTable(page) {
  return page.locator("main table tbody tr").evaluateAll((trs) =>
    trs.map((tr) => ({
      list: tr.querySelector("th a")?.textContent.trim(),
      href: tr.querySelector("th a")?.getAttribute("href"),
      rows: tr.querySelector("td")?.textContent.trim(),
    })),
  );
}

// ---------- phases ----------
// Inside the pasta namespace, localhost resolves to ::1 first and pasta does not forward IPv6 loopback to the
// lab, which publishes on 127.0.0.1 only. The resolver rule sends the name localhost to 127.0.0.1. The browser
// still uses http://localhost:<port> as the page origin, which is what the wrong-origin check needs.
const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP localhost 127.0.0.1"] });
try {
  const phases = {
    P0: phaseP0,
    P1ORG: phaseP1Org,
    P1AUTH: phaseP1Auth,
    P1PORTAL: phaseP1Portal,
    P1INV: phaseP1Invites,
    P1REV: phaseP1Review,
    P1AFTER: phaseP1After,
    P2: phaseP2,
    C1: phaseC1,
    C2: phaseC2,
    C3: phaseC3,
    R: phaseR,
  };
  if (!phases[PHASE]) throw new Error(`Unknown phase ${PHASE}`);
  await phases[PHASE]();
} catch (error) {
  console.log(`[${LAB_NAME} ${PHASE}] ${error.message}`);
  run.stoppedBy = error.message.slice(0, 300);
} finally {
  await browser.close();
  save();
}
console.log(`[${LAB_NAME} ${PHASE}] done, ${failures} failed step(s)`);
process.exitCode = failures ? 1 : 0;

async function resumeContext() {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    storageState: STATE,
  });
  const page = await context.newPage();
  currentPage = page;
  return { context, page };
}

// ===== P0: environment sets SMTP_URL but not SMTP_FROM; account setup and email-required checks =====
async function phaseP0() {
  await applyEmailEnvironment("from-missing");
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  currentPage = page;

  await step(
    "Open the instance address on a fresh instance",
    "Set up OpenLaw shows Setup token, Name, Email, Password, Confirm password and Create Administrator.",
    async () => {
      const { needsSetup } = await (await context.request.get(`${BASE}/api/v1/auth/setup`)).json();
      must(needsSetup === true, "instance already has users");
      await page.goto(`${BASE}/`);
      await expect(page).toHaveURL(/\/auth\/setup$/);
      await expect(page.getByText("Set up OpenLaw", { exact: true }).first()).toBeVisible();
      for (const label of ["Name", "Email", "Password", "Confirm password"])
        await expect(page.getByLabel(label, { exact: true })).toBeVisible();
      await expect(page.getByLabel("Setup token")).toBeVisible();
      const tokenName = await page.locator("#setupToken").evaluate((el) => el.labels?.[0]?.innerText.trim());
      await expect(button(page, "Create Administrator")).toBeVisible();
      return `Setup token label read "${tokenName}". ` + "needsSetup was true; / redirected to /auth/setup, which showed Set up OpenLaw with Setup token, Name, Email, Password, Confirm password and Create Administrator.";
    },
  );

  await step(
    "Open OpenLaw from another address (localhost instead of the instance address 127.0.0.1) and submit the setup form",
    'OpenLaw refuses to save and shows "This request did not come from this OpenLaw instance\'s own origin."',
    async () => {
      const other = await browser.newContext();
      const p = await other.newPage();
      await p.goto(`${WRONG_ORIGIN}/auth/setup`);
      await expect(p.getByLabel("Setup token")).toBeVisible();
      await fillSetup(p, { token: SETUP_TOKEN, password: PASSWORD, confirm: PASSWORD });
      await button(p, "Create Administrator").click();
      await expect(p.getByText(ORIGIN_MESSAGE)).toBeVisible();
      const at = pathOf(p);
      await other.close();
      const { needsSetup } = await (await context.request.get(`${BASE}/api/v1/auth/setup`)).json();
      must(needsSetup === true, "a user was created from the wrong origin");
      return `At ${at}, Create Administrator showed "${ORIGIN_MESSAGE}" and needsSetup stayed true.`;
    },
  );

  await step(
    "Submit the setup form with the Setup token left empty",
    "Setup does not continue and no account is created.",
    async () => {
      await page.goto(`${BASE}/auth/setup`);
      await fillSetup(page, { token: "", password: PASSWORD, confirm: PASSWORD });
      await button(page, "Create Administrator").click();
      await page.waitForTimeout(800);
      const field = page.getByLabel("Setup token");
      const missing = await field.evaluate((el) => el.validity.valueMissing);
      const note = await field.evaluate((el) => el.validationMessage);
      const alerts = (await page.getByRole("alert").allTextContents()).join(" | ");
      const tokenMessage = await page.getByText(TOKEN_MESSAGE).count();
      await expect(page).toHaveURL(/\/auth\/setup$/);
      const users = await (await context.request.get(`${BASE}/api/v1/auth/setup`)).json();
      must(users.needsSetup === true, "a user was created");
      must(missing, "the empty token field was not reported missing");
      return `The browser blocked the submit: the Setup token field reported a missing value ("${note}"). The page ${tokenMessage ? "also showed" : "did not show"} the token message; alerts "${alerts}". The page stayed on /auth/setup and needsSetup stayed true.`;
    },
    { continueOnFail: true },
  );

  await step(
    "Submit the setup form with a wrong Setup token",
    `The page shows "${TOKEN_MESSAGE}" and no account is created.`,
    async () => {
      await fillSetup(page, { token: "wrong-token-doc030", password: PASSWORD, confirm: PASSWORD });
      await button(page, "Create Administrator").click();
      await expect(page.getByText(TOKEN_MESSAGE)).toBeVisible();
      await expect(page).toHaveURL(/\/auth\/setup$/);
      const users = await (await context.request.get(`${BASE}/api/v1/auth/setup`)).json();
      must(users.needsSetup === true, "a user was created");
      return `The page showed "${TOKEN_MESSAGE}", stayed on /auth/setup, and needsSetup stayed true.`;
    },
  );

  await step(
    "Submit a seven-character password in both fields with the correct token",
    "The password is refused and setup does not continue.",
    async () => {
      await fillSetup(page, { token: SETUP_TOKEN, password: "Short12", confirm: "Short12" });
      await button(page, "Create Administrator").click();
      await page.waitForTimeout(800);
      const tooShort = await page
        .getByLabel("Password", { exact: true })
        .evaluate((el) => el.validity.tooShort);
      must(tooShort, "the Password field did not report tooShort");
      await expect(page).toHaveURL(/\/auth\/setup$/);
      const users = await (await context.request.get(`${BASE}/api/v1/auth/setup`)).json();
      must(users.needsSetup === true, "a user was created");
      return "The Password field reported a too-short value, the page stayed on /auth/setup, and needsSetup stayed true.";
    },
  );

  await step(
    "Submit different values in Password and Confirm password",
    'The page shows "The passwords do not match." and no account is created.',
    async () => {
      await fillSetup(page, { token: SETUP_TOKEN, password: PASSWORD, confirm: `${PASSWORD}x` });
      await button(page, "Create Administrator").click();
      await expect(page.getByText("The passwords do not match.")).toBeVisible();
      await expect(page).toHaveURL(/\/auth\/setup$/);
      const users = await (await context.request.get(`${BASE}/api/v1/auth/setup`)).json();
      must(users.needsSetup === true, "a user was created");
      return 'The page showed "The passwords do not match.", stayed on /auth/setup, and needsSetup stayed true.';
    },
  );

  await step(
    "Correct the entries and select Create Administrator",
    "Setup signs the Administrator in and opens Welcome to OpenLaw.",
    async () => {
      await fillSetup(page, { token: SETUP_TOKEN, password: PASSWORD, confirm: PASSWORD });
      await button(page, "Create Administrator").click();
      await expect(page).toHaveURL(/\/welcome(\?|$)/);
      const where = await expectStep(page, "Welcome to OpenLaw", 1);
      const me = await getJson(context, "/api/v1/me");
      must(me.user.role === "administrator", `role is ${me.user.role}`);
      await expect(button(page, "Get started")).toBeVisible();
      await expect(button(page, "Skip optional steps")).toBeVisible();
      must((await button(page, "Set up later").count()) === 0, "Welcome shows Set up later");
      await savedState(context);
      return `Signed in as ${me.user.displayName ?? ADMIN.name} (role administrator) at ${pathOf(page)}. ${where}. The step shows Get started and Skip optional steps, and no Set up later.`;
    },
  );

  await step(
    "Try account setup again after a user exists",
    "Account setup is not available; the visitor is sent to Sign in and the API answers 409.",
    async () => {
      const other = await browser.newContext();
      const p2 = await other.newPage();
      await p2.goto(`${BASE}/auth/setup`);
      await expect(p2).toHaveURL(/\/auth\/login$/);
      const res = await other.request.post(`${BASE}/api/v1/auth/setup`, {
        headers: { origin: BASE },
        data: {
          email: "second.admin@harbor.example",
          displayName: "Second Admin DOC-030",
          password: randomBytes(9).toString("hex"),
          setupToken: SETUP_TOKEN,
        },
      });
      const body = await res.json().catch(() => ({}));
      await other.close();
      must(res.status() === 409, `setup API answered ${res.status()}`);
      return `A separate signed-out context was redirected from /auth/setup to /auth/login. The setup API answered 409 "${body.detail}".`;
    },
  );

  await step(
    "While email is not configured, open Home and other app pages",
    "Every app page opens the wizard at its Welcome step.",
    async () => {
      const out = [];
      for (const p of ["/", "/settings/general", "/matters", "/settings/email"])
        out.push(await landsOnWizardWelcome(page, p));
      return out.join("; ");
    },
  );

  await step(
    "On Welcome select Skip optional steps while the environment sets SMTP_URL but not SMTP_FROM",
    "Outbound email opens instead of ending onboarding; it says SMTP_FROM is not set; it is read-only, has no Set up later, and Continue is unavailable.",
    async () => {
      await expectStep(page, "Welcome to OpenLaw", 1);
      await button(page, "Skip optional steps").click();
      const where = await expectStep(page, "Outbound email", 5);
      const warning = (
        await page.getByText(/sets SMTP_URL but not SMTP_FROM/).textContent()
      ).trim();
      must((await button(page, "Set up later").count()) === 0, "Set up later shown");
      for (const name of ["Save relay", "Send test email"])
        must((await button(page, name).count()) === 0, `${name} shown for an environment source`);
      await expect(button(page, "Continue")).toBeDisabled();
      const onboarding = await getJson(context, "/api/v1/onboarding");
      must(!onboarding.completed, "onboarding completed");
      await page.screenshot({ path: path.join(here, "p0-smtp-from-missing.png") });
      return `${where} at ${pathOf(page)}. It said "${warning}" No Set up later, Save relay or Send test email; Continue disabled; onboarding not complete.`;
    },
  );

  await step(
    "Open Review by its page address while email is not configured, then select Finish and Set up later",
    "Finish is refused while outbound email is not configured: each action opens Outbound email and onboarding stays open.",
    async () => {
      const out = [];
      for (const name of ["Finish", "Set up later"]) {
        await page.goto(`${BASE}/welcome?step=review`);
        await expectStep(page, "Review", 9);
        await button(page, name).click();
        const where = await expectStep(page, "Outbound email", 5);
        await page.waitForTimeout(1000);
        const onboarding = await getJson(context, "/api/v1/onboarding");
        must(
          !onboarding.completed && !onboarding.steps.review.done,
          `${name} changed onboarding ${JSON.stringify(onboarding)}`,
        );
        out.push(
          `${name} on Review opened ${where} at ${pathOf(page)}; onboarding completed ${onboarding.completed}, review done ${onboarding.steps.review.done}`,
        );
      }
      const api = await postJson(context, "/api/v1/onboarding/complete", undefined);
      must(api.status === 409, `complete API answered ${api.status}`);
      out.push(`the completion API itself answered 409 "${api.body.detail}"`);
      return out.join(". ") + ".";
    },
  );
  await savedState(context);
  await context.close();
}

// ===== P1ORG: email unset; redirects and Your organization =====
async function phaseP1Org() {
  await applyEmailEnvironment("unset");
  const { context, page } = await resumeContext();

  await step(
    "After the operator removes email from the environment, open Home and other app pages",
    "The session is still signed in, and every app page opens the wizard at its Welcome step.",
    async () => {
      const out = [];
      for (const p of ["/", "/settings/users", "/requests", "/contracts"])
        out.push(await landsOnWizardWelcome(page, p));
      const settings = await getJson(context, "/api/v1/email-settings");
      return `${out.join("; ")}. Email source "${settings.source}".`;
    },
  );

  const brandBefore = await brandOnSignIn();
  await step(
    "On Welcome to OpenLaw select Get started",
    "Your organization opens as Step 2 of 9.",
    async () => {
      await button(page, "Get started").click();
      const where = await expectStep(page, "Your organization", 2);
      return `${where} at ${pathOf(page)}. Before any organization save, Sign in showed ${JSON.stringify(brandBefore)}.`;
    },
  );

  const bigPng = path.join(SCRATCH, "doc030-logo-over-5mb.png");
  const hugePng = path.join(SCRATCH, "doc030-logo-over-16mp.png");
  const okPng = path.join(SCRATCH, "doc030-logo-badge.png");
  const gif = path.join(SCRATCH, "doc030-logo.gif");
  writeFileSync(bigPng, png(1200, 1500, "random"));
  writeFileSync(hugePng, png(4100, 4000, "flat"));
  writeFileSync(okPng, png(256, 256, "badge"));
  writeFileSync(
    gif,
    Buffer.from("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", "base64"),
  );
  const sizes = {
    over: readFileSync(bigPng).length,
    huge: readFileSync(hugePng).length,
    ok: readFileSync(okPng).length,
  };
  async function upload(file) {
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      button(page, "Upload").click(),
    ]);
    await chooser.setFiles(file);
  }

  await step(
    "In Your organization check Default locale, the logo rules and the Upload control",
    "Default locale offers only English (United States); Upload refuses a GIF and a PNG over 5 MB with the logo message.",
    async () => {
      const options = await page.locator("#org-locale option").allTextContents();
      must(
        options.length === 1 && options[0] === "English (United States)",
        `locale options ${JSON.stringify(options)}`,
      );
      await expect(button(page, "Upload")).toBeVisible();
      await upload(gif);
      await expect(page.getByText(LOGO_MESSAGE)).toBeVisible();
      await upload(bigPng);
      await expect(page.getByText(LOGO_MESSAGE)).toBeVisible();
      must(
        (await page.getByRole("img", { name: "Organization logo" }).count()) === 0,
        "a refused logo shows a preview",
      );
      return `Default locale had one option, "English (United States)". A GIF and a ${sizes.over}-byte PNG were refused with "${LOGO_MESSAGE}", and no preview showed.`;
    },
  );

  await step(
    "Upload a PNG of 5 MB or smaller with more than 16 million pixels, enter Organization name, and select Continue",
    "Continue shows that the logo must be readable with no more than 16 million pixels, and nothing is saved.",
    async () => {
      await upload(hugePng);
      await expect(page.getByRole("img", { name: "Organization logo" })).toBeVisible();
      await page.getByLabel("Organization name").fill(ORG_NAME);
      await button(page, "Continue").click();
      await expect(page.getByText(PIXEL_MESSAGE)).toBeVisible();
      const where = await expectStep(page, "Your organization", 2);
      const general = await getJson(context, "/api/v1/org/general");
      must(general.general.logo === null, "the oversized logo was saved");
      must(general.general.name !== ORG_NAME, "the name was saved with a refused logo");
      return `A ${sizes.huge}-byte PNG of 4100 x 4000 pixels (16.4 million) was accepted by Upload with a preview. Continue showed "${PIXEL_MESSAGE}" and stayed at ${where}. The saved organization kept no logo and name "${general.general.name}".`;
    },
  );

  await step(
    "Export the image again: upload a small PNG, choose a Default timezone, then select Set up later",
    "The wizard moves on without saving the unsaved organization entries.",
    async () => {
      await upload(okPng);
      await expect(page.getByText(PIXEL_MESSAGE)).toHaveCount(0);
      await expect(page.getByRole("img", { name: "Organization logo" })).toBeVisible();
      const tz = page.getByRole("combobox", { name: "Default timezone" });
      await tz.click();
      await tz.fill("Lisbon");
      await page.getByRole("option", { name: /Lisbon/ }).first().click();
      await button(page, "Set up later").click();
      const where = await expectStep(page, "Authentication", 3);
      const general = await getJson(context, "/api/v1/org/general");
      must(general.general.name !== ORG_NAME, "name was saved by Set up later");
      must(general.general.logo === null, "logo was saved by Set up later");
      return `${where}. The saved organization still had name "${general.general.name}", no logo, timezone ${general.general.defaultTimezone}.`;
    },
  );

  await step(
    "Go Back to Your organization and select Continue with the name, logo and timezone",
    "Continue saves Organization name, logo and Default timezone and opens Authentication.",
    async () => {
      await button(page, "Back").click();
      await expectStep(page, "Your organization", 2);
      const tz = page.getByRole("combobox", { name: "Default timezone" });
      if (!/Lisbon/.test(await tz.inputValue())) {
        await tz.click();
        await tz.fill("Lisbon");
        await page.getByRole("option", { name: /Lisbon/ }).first().click();
      }
      if ((await page.getByLabel("Organization name").inputValue()) !== ORG_NAME)
        await page.getByLabel("Organization name").fill(ORG_NAME);
      let reuploaded = false;
      if ((await page.getByRole("img", { name: "Organization logo" }).count()) === 0) {
        await upload(okPng);
        await expect(page.getByRole("img", { name: "Organization logo" })).toBeVisible();
        reuploaded = true;
      }
      await button(page, "Continue").click();
      const where = await expectStep(page, "Authentication", 3);
      const general = await getJson(context, "/api/v1/org/general");
      must(general.general.name === ORG_NAME, `name is ${general.general.name}`);
      must(general.general.defaultTimezone === "Europe/Lisbon", `timezone ${general.general.defaultTimezone}`);
      must(general.general.logo?.startsWith("data:image/png"), "logo not saved");
      return `${where}. ${reuploaded ? "The draft logo was gone after Back, so the same PNG was chosen again. " : "The draft kept the chosen logo after Back. "}The API read back name "${ORG_NAME}", timezone Europe/Lisbon, locale ${general.general.defaultLocale}, and a PNG logo.`;
    },
  );

  await step(
    "Open the sign-in page in a signed-out browser after saving Your organization",
    "The sign-in page shows the saved organization name and logo.",
    async () => {
      const after = await brandOnSignIn();
      must(after.brand === ORG_NAME, `brand is ${after.brand}`);
      must(after.logoCount === 1 && after.logoLoaded, `logo ${JSON.stringify(after)}`);
      return `Before the save, Sign in showed ${JSON.stringify(brandBefore)}. After the save, it showed ${JSON.stringify(after)}.`;
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
      await page.getByLabel("Organization name").fill("Unsaved Name DOC-030");
      await page.reload();
      const where = await expectStep(page, "Your organization", 2);
      const value = await page.getByLabel("Organization name").inputValue();
      must(value === ORG_NAME, `name field shows ${value}`);
      await expect(page.getByRole("img", { name: "Organization logo" })).toBeVisible();
      await button(page, "Continue").click();
      await expectStep(page, "Authentication", 3);
      return `Address before reload ${before}. After reload: ${where} at ${pathOf(page)}; the name field showed the saved "${value}" and the saved logo, not the unsaved entry. Continue opened Authentication.`;
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
      return `From ${at}: ${home}. Get started opened Your organization.`;
    },
  );
  await savedState(context);
  await context.close();
}

// ===== P1AUTH: Authentication, SSO, two-factor =====
async function phaseP1Auth() {
  const { context, page } = await resumeContext();
  const methodsBefore = await getJson(context, "/api/v1/auth/methods");

  await step(
    "Open Authentication and turn off every sign-in method, then select Continue",
    "OpenLaw refuses a policy with no sign-in method.",
    async () => {
      await page.goto(`${BASE}/welcome?step=authentication`);
      await expectStep(page, "Authentication", 3);
      const initial = {};
      for (const name of [
        "Email and password",
        "Email magic link",
        "Single sign-on (SSO)",
        "Require two-factor authentication",
      ]) {
        const sw = page.getByRole("switch", { name, exact: true });
        await expect(sw).toBeVisible();
        initial[name] = {
          checked: (await sw.getAttribute("aria-checked")) === "true",
          disabled: await sw.isDisabled(),
        };
      }
      for (const name of ["Email and password", "Email magic link"]) {
        const sw = page.getByRole("switch", { name, exact: true });
        if ((await sw.getAttribute("aria-checked")) === "true") await sw.click();
      }
      await button(page, "Continue").click();
      await expect(page.getByText("Enable at least one sign-in method.")).toBeVisible();
      const where = await expectStep(page, "Authentication", 3);
      const after = await getJson(context, "/api/v1/auth/methods");
      must(
        JSON.stringify(after.policy.legal) === JSON.stringify(methodsBefore.policy.legal),
        "policy changed",
      );
      return `Initial switches ${JSON.stringify(initial)}. With both email methods off, Continue showed "Enable at least one sign-in method." and stayed at ${where}; the saved legal policy was unchanged.`;
    },
  );

  await step(
    "Check the Single sign-on (SSO) switch before a provider is registered",
    "The SSO switch is unavailable and Register your identity provider shows.",
    async () => {
      must(
        await page.getByRole("switch", { name: "Single sign-on (SSO)", exact: true }).isDisabled(),
        "SSO switch is enabled",
      );
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
      await page.getByLabel("Provider ID", { exact: true }).fill("harbor-idp");
      await page.getByLabel("Issuer URL", { exact: true }).fill("http://oidc:8080");
      await page.getByLabel("Email domain", { exact: true }).fill("harbor.example");
      await page.getByLabel("Client ID", { exact: true }).fill("doc030-first-run-client");
      await page.getByLabel("Client secret", { exact: true }).fill(randomBytes(12).toString("hex"));
      await button(page, "Register provider").click();
      await expect(page.getByText("Identity provider harbor-idp is registered.")).toBeVisible();
      const callback = (
        await page.getByText(/Paste this callback URL into your IdP console:/).textContent()
      ).trim();
      must(callback.includes(BASE), `callback does not use the instance address: ${callback}`);
      await expect(page.getByRole("switch", { name: "Single sign-on (SSO)", exact: true })).toBeEnabled();
      return `The step showed "Identity provider harbor-idp is registered." and "${callback}". The Single sign-on (SSO) switch became enabled. The issuer was a local OpenID Connect stand-in (oauth2-mock-server) on the lab backend network.`;
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
      await button(page, "Set up later").click();
      const next = await expectStep(page, "Business-user portal", 4);
      const after = await getJson(context, "/api/v1/auth/methods");
      must(
        JSON.stringify(after.policy.legal) === JSON.stringify(methodsBefore.policy.legal),
        `policy changed to ${JSON.stringify(after.policy.legal)}`,
      );
      return `Set up later opened ${next}. Saved legal policy stayed ${JSON.stringify(after.policy.legal)}.`;
    },
  );

  await step(
    "Turn on Email and password, Email magic link and Require two-factor authentication in Authentication, then select Continue",
    "OpenLaw makes the Administrator set up two-factor authentication before continuing.",
    async () => {
      await button(page, "Back").click();
      await expectStep(page, "Authentication", 3);
      for (const name of ["Email and password", "Email magic link", "Require two-factor authentication"]) {
        const sw = page.getByRole("switch", { name, exact: true });
        if ((await sw.getAttribute("aria-checked")) !== "true") await sw.click();
      }
      await button(page, "Continue").click();
      await page.waitForURL(/\/auth\/two-factor\/enroll$/, { timeout: 15000 });
      await expect(page.getByText("Your organization requires two-factor authentication.")).toBeVisible();
      await expect(button(page, "Turn on two-factor")).toBeVisible();
      const methods = await getJson(context, "/api/v1/auth/methods");
      must(
        methods.policy.legal.requireTwoFactor && methods.policy.legal.magicLink && methods.policy.legal.password,
        `legal policy ${JSON.stringify(methods.policy.legal)}`,
      );
      const obs = [];
      for (const target of ["/welcome?step=portal", "/"]) {
        await page.goto(`${BASE}${target}`);
        await page.waitForLoadState("networkidle");
        obs.push(`${target} -> ${pathOf(page)}`);
        must(/\/auth\/two-factor\/enroll$/.test(new URL(page.url()).pathname), `${target} did not return to enrollment`);
      }
      return `Continue saved the policy ${JSON.stringify(methods.policy.legal)} and opened /auth/two-factor/enroll with "Your organization requires two-factor authentication." and Turn on two-factor. Other addresses returned there: ${obs.join("; ")}.`;
    },
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
      writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
      await page.getByLabel("Code", { exact: true }).fill(totp(secret));
      await button(page, "Confirm").click();
      await expect(page.getByText(/Two-factor authentication is on\. Save these backup codes/)).toBeVisible();
      await page.getByRole("link", { name: "Done", exact: true }).click();
      await expect(page).toHaveURL(/\/welcome(\?|$)/);
      const where = await expectStep(page, "Welcome to OpenLaw", 1);
      const landed = pathOf(page);
      const me = await getJson(context, "/api/v1/me");
      must(!me.user.twoFactorSetupRequired && !me.user.twoFactorVerificationRequired, "two-factor still pending");
      await button(page, "Get started").click();
      await expectStep(page, "Your organization", 2);
      must((await page.getByLabel("Organization name").inputValue()) === ORG_NAME, "organization name lost");
      await button(page, "Continue").click();
      await expectStep(page, "Authentication", 3);
      const state = {};
      for (const name of ["Email and password", "Email magic link", "Single sign-on (SSO)", "Require two-factor authentication"])
        state[name] = (await page.getByRole("switch", { name, exact: true }).getAttribute("aria-checked")) === "true";
      must(state["Email and password"] && state["Email magic link"] && state["Require two-factor authentication"], `switches ${JSON.stringify(state)}`);
      return `A generated TOTP code turned two-factor on and the backup-code notice showed. Done led to ${landed} at ${where}. Get started showed the saved name, and Authentication showed ${JSON.stringify(state)}.`;
    },
  );
  await savedState(context);
  await context.close();
}

// ===== P1PORTAL: Business-user portal and Outbound email (unset) =====
async function phaseP1Portal() {
  const { context, page } = await resumeContext();

  await step(
    "Continue from Authentication to Business-user portal",
    "Business-user portal shows the same switches for Business Users and Allowed email domains with Add.",
    async () => {
      await page.goto(`${BASE}/welcome?step=authentication`);
      await expectStep(page, "Authentication", 3);
      await button(page, "Continue").click();
      const where = await expectStep(page, "Business-user portal", 4);
      for (const name of ["Email and password", "Email magic link", "Single sign-on (SSO)", "Require two-factor authentication"])
        await expect(page.getByRole("switch", { name, exact: true })).toBeVisible();
      await expect(page.getByLabel("Allowed email domains")).toBeVisible();
      await expect(button(page, "Add")).toBeVisible();
      const empty = (await page.getByText(/No domains allowed yet/).allTextContents()).join(" | ");
      return `${where}. The step showed the four switches, Allowed email domains, Add, and "${empty}".`;
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
    "The guide asks for a domain without an email username; OpenLaw does not save one.",
    async () => {
      await page.getByLabel("Allowed email domains").fill("rowan@harbor.example");
      await button(page, "Add").click();
      await page.waitForTimeout(300);
      const listed = await button(page, "Remove rowan@harbor.example").count();
      let outcome = "not added to the draft list";
      if (listed) {
        await button(page, "Continue").click();
        await page.waitForTimeout(1500);
        const heading = await stepHeading(page);
        const alert = (await page.getByRole("alert").allTextContents()).join(" | ");
        outcome = `added to the draft list; Continue stayed on ${heading} with "${alert}"`;
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
    "In Outbound email check the configuration source while email is unset",
    "The step asks for SMTP server, Port, Connection security, Authentication, Sender name (optional) and Sender email with Save relay; no Set up later; Continue unavailable.",
    async () => {
      const unset = (await page.getByText(/Set up outbound email to finish instance setup/).textContent()).trim();
      for (const label of ["SMTP server", "Port", "Connection security", "Authentication", "Sender name (optional)", "Sender email"])
        await expect(page.getByLabel(label, { exact: true })).toBeVisible();
      const authOptions = await page.getByLabel("Authentication", { exact: true }).locator("option").allTextContents();
      const securityOptions = await page.getByLabel("Connection security", { exact: true }).locator("option").allTextContents();
      await expect(button(page, "Save relay")).toBeVisible();
      must((await button(page, "Set up later").count()) === 0, "Set up later shown");
      must((await button(page, "Send test email").count()) === 0, "Send test email shown before a relay is saved");
      await expect(button(page, "Continue")).toBeDisabled();
      return `The step said "${unset}" It showed SMTP server, Port, Connection security ${JSON.stringify(securityOptions)}, Authentication ${JSON.stringify(authOptions)}, Sender name (optional), Sender email and Save relay; no Set up later or Send test email; Continue disabled.`;
    },
  );

  await step(
    "Reload the wizard page on Outbound email",
    "The reload keeps Outbound email because the step is part of the page address.",
    async () => {
      const before = pathOf(page);
      await page.reload();
      const where = await expectStep(page, "Outbound email", 5);
      return `Reloaded ${before}; the wizard showed ${where}.`;
    },
  );

  await step(
    "With Authentication set to Username and password, leave SMTP username and SMTP password empty and select Save relay",
    "SMTP username and SMTP password show and are required; nothing saves.",
    async () => {
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
      return `With Username and password, SMTP username and SMTP password showed and both reported a missing value; source stayed "${settings.source}". With None, the two fields were hidden.`;
    },
  );

  await step(
    "Save a relay whose SMTP server is a URL",
    "The relay is refused and email stays unset.",
    async () => {
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
    },
  );

  await step(
    "Enter SMTP server, Port, Connection security, Authentication, Sender name and Sender email, and select Save relay",
    "The relay saves, Continue becomes available, and Send test email appears; still no Set up later.",
    async () => {
      await page.getByLabel("SMTP server", { exact: true }).fill("mailpit");
      await page.getByLabel("Connection security", { exact: true }).selectOption({ label: "None" });
      await page.getByLabel("Port", { exact: true }).fill("1025");
      await page.getByLabel("Authentication", { exact: true }).selectOption({ label: "None" });
      await page.getByLabel("Sender name (optional)", { exact: true }).fill("Harbor Legal");
      await page.getByLabel("Sender email", { exact: true }).fill("legal@harbor.example");
      await button(page, "Save relay").click();
      await expect(page.getByText("Relay saved. The next email this instance sends will use it.")).toBeVisible();
      const inApp = (await page.getByText(/Outbound email is set in the app/).textContent()).trim();
      await expect(button(page, "Continue")).toBeEnabled();
      await expect(button(page, "Send test email")).toBeVisible();
      must((await button(page, "Set up later").count()) === 0, "Set up later shown after saving");
      const settings = await getJson(context, "/api/v1/email-settings");
      return `"Relay saved. The next email this instance sends will use it." and "${inApp}" showed; source "${settings.source}"; Continue enabled; Send test email shown; no Set up later.`;
    },
  );

  await step(
    "Select Send test email and check the inbox in Mailpit",
    "A test email reaches the Administrator, and its email header shows the organization name and logo.",
    async () => {
      const before = (await mailTo(ADMIN.email)).count;
      await button(page, "Send test email").click();
      await expect(page.getByText(/Test email sent to .* Check your inbox\./)).toBeVisible();
      await waitMail(ADMIN.email, before + 1);
      const header = await checkMailHeader(ADMIN.email, /test/i, "p1-test-email-header.png");
      return `The page showed "Test email sent to ${ADMIN.email}. Check your inbox." Mailpit received it: ${JSON.stringify(header)}.`;
    },
  );
  await savedState(context);
  await context.close();
}

// ===== P1INV: Setup checklist mid-way, invites, e-signature, AI analysis =====
async function phaseP1Invites() {
  const { context, page } = await resumeContext();

  await step(
    "While steps are unfinished, open Settings -> Organization -> General",
    "A Setup checklist card lists only unfinished steps; every row except Review seeded types links to its Settings page; Review seeded types has Mark as reviewed.",
    async () => {
      await page.goto(`${BASE}/settings/general`);
      await page.waitForLoadState("networkidle");
      must(new URL(page.url()).pathname === "/settings/general", `ended at ${page.url()}`);
      await expect(page.getByText("Setup checklist", { exact: true })).toBeVisible();
      const rows = await outstandingRows(page);
      must((await page.getByText("Return to setup", { exact: true }).count()) === 0, "Return to setup on a direct visit");
      await page.screenshot({ path: path.join(here, "p1-setup-checklist.png") });
      const labels = rows.map((r) => r.label);
      must(
        JSON.stringify(labels) === JSON.stringify(["Invite your team", "E-signature", "AI analysis", "Review seeded types"]),
        `rows ${JSON.stringify(rows)}`,
      );
      const review = rows.find((r) => r.label === "Review seeded types");
      must(review.href === null && review.markAsReviewed, "Review seeded types row lacks Mark as reviewed or has a link");
      for (const r of rows.filter((x) => x.label !== "Review seeded types"))
        must(r.href?.startsWith("/settings/"), `${r.label} has no Settings link`);
      return `With Organization, Business-user portal and Email done, the Setup checklist rows were ${JSON.stringify(rows)}. No Return to setup on a direct visit.`;
    },
  );

  await step(
    "Open Invite your team and invite a Legal team member",
    "Name, Email, Legal team member, Administrator and Send invite are offered; the invitation is sent and its email header shows the organization name and logo.",
    async () => {
      await page.goto(`${BASE}/welcome?step=invites`);
      const where = await expectStep(page, "Invite your team", 6);
      await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
      await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
      const roles = await page.locator("fieldset button").allTextContents();
      must(JSON.stringify(roles) === JSON.stringify(["Legal team member", "Administrator"]), `roles ${roles}`);
      await page.getByLabel("Name", { exact: true }).fill("Rowan Lee");
      await page.getByLabel("Email", { exact: true }).fill("rowan.lee@harbor.example");
      await button(page, "Legal team member").click();
      await button(page, "Send invite").click();
      await expect(page.getByText(/1 invite sent:/)).toBeVisible();
      const header = await checkMailHeader("rowan.lee@harbor.example", /./, "p1-invitation-email-header.png");
      return `${where}. Role choices ${JSON.stringify(roles)}. Send invite showed "1 invite sent:". Mailpit: ${JSON.stringify(header)}.`;
    },
  );

  await step(
    "Invite an Administrator",
    "The invitation is sent with the Administrator role.",
    async () => {
      await page.getByLabel("Name", { exact: true }).fill("Sam Ortiz");
      await page.getByLabel("Email", { exact: true }).fill("sam.ortiz@harbor.example");
      await button(page, "Administrator").click();
      must((await button(page, "Administrator").getAttribute("aria-pressed")) === "true", "Administrator not selected");
      await button(page, "Send invite").click();
      await expect(page.getByText(/2 invites sent:/)).toBeVisible();
      const mail = await waitMail("sam.ortiz@harbor.example");
      const users = await getJson(context, "/api/v1/users");
      const sam = (users.users ?? users).find?.((u) => u.email === "sam.ortiz@harbor.example");
      return `Send invite showed "2 invites sent:" and Mailpit received ${mail.count} message(s) for sam.ortiz@harbor.example, subject ${JSON.stringify(mail.subjects)}. Users API role for Sam Ortiz: ${sam?.role ?? "not read"}.`;
    },
  );

  await step(
    "Type a third invitation without sending it, then select Set up later",
    "The wizard moves to E-signature and the unsent invitation is not sent.",
    async () => {
      await page.getByLabel("Name", { exact: true }).fill("Unsent Person");
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
      return `E-signature said "${hint.slice(0, 160)}". Set up later opened ${where}; the E-signature step stayed not done.`;
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
      return `AI analysis said "${hint.slice(0, 120)}...". Set up later opened ${where}; the AI analysis step stayed not done.`;
    },
  );
  await savedState(context);
  await context.close();
}

// ===== P1REV: Review, Start blank, Finish =====
async function phaseP1Review() {
  const { context, page } = await resumeContext();
  let reviewRows;
  let fixtureMatter;
  let fieldCountBefore;

  await step(
    "In Review check the row counts and reminder offsets",
    "Review shows the seeded lists with row counts, separate Matter fields, Contract fields and Entity fields rows, Director & Officer roles, the reminder offsets, the keep-the-seeds recommendation, Start blank and Finish.",
    async () => {
      await page.goto(`${BASE}/welcome?step=review`);
      await expectStep(page, "Review", 9);
      reviewRows = await reviewTable(page);
      const lists = reviewRows.map((r) => r.list);
      for (const name of ["Matter types", "Matter statuses", "Matter fields", "Contract types", "Contract statuses", "Contract fields", "Entity types", "Director & Officer roles", "Entity fields", "Knowledge types", "Request types", "Reminder offsets"])
        must(lists.includes(name), `no ${name} row in ${JSON.stringify(lists)}`);
      const hint = (await page.getByText(/We recommend that you start with/).textContent()).trim();
      await expect(button(page, "Start blank")).toBeVisible();
      await expect(button(page, "Finish")).toBeVisible();
      await expect(button(page, "Set up later")).toBeVisible();
      const onboarding = await getJson(context, "/api/v1/onboarding");
      must(!onboarding.completed && !onboarding.steps.review.done, "already completed or reviewed");
      await page.screenshot({ path: path.join(here, "p1-review-step.png"), fullPage: true });
      return `Review rows ${JSON.stringify(reviewRows.map((r) => `${r.list}: ${r.rows}`))}. It said "${hint.slice(0, 110)}...". Start blank, Finish and Set up later were shown; onboarding not complete or reviewed.`;
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
      await link.click();
      const where = await expectStep(page, "Review", 9);
      await page.getByRole("link", { name: "Reminder offsets", exact: true }).click();
      await expect(page).toHaveURL(/\/settings\/reminders$/);
      await page.getByRole("link", { name: "Return to setup", exact: true }).click();
      await expectStep(page, "Review", 9);
      return `Contract fields opened ${target.href} with Return to setup to ${href}, which opened ${where}. Reminder offsets opened /settings/reminders with Return to setup, which also returned to Review.`;
    },
  );

  await step(
    "Fixture: create a Matter that uses a seeded Matter type (API, as the Administrator's session)",
    "A Matter now uses one seeded Matter type.",
    async () => {
      const types = await getJson(context, "/api/v1/matter-types?includeArchived=true");
      fieldCountBefore = (await getJson(context, "/api/v1/fields?includeArchived=true")).fields.length;
      const candidates = types.matterTypes.filter((t) => t.isSystemDefault && !["other", "default"].includes(t.slug));
      const tried = [];
      for (const seeded of candidates) {
        const res = await postJson(context, "/api/v1/matters", { title: "DOC-030 first-run in-use Matter", matterTypeId: seeded.id });
        if (res.status === 201) {
          fixtureMatter = { number: res.body.matter.number, type: seeded.displayName };
          break;
        }
        tried.push(`${seeded.displayName}: ${res.status}`);
      }
      must(fixtureMatter, `no Matter could be created: ${tried.join("; ")}`);
      return `Created Matter ${fixtureMatter.number} "DOC-030 first-run in-use Matter" with the seeded Matter type "${fixtureMatter.type}"${tried.length ? ` (refused first: ${tried.join("; ")})` : ""}. ${fieldCountBefore} Fields existed before Start blank.`;
    },
  );

  const countsOf = (rows) => Object.fromEntries(rows.map((r) => [r.list, r.rows]));
  await step(
    "Select Start blank and read the dialog, then confirm while a seeded row is in use",
    "The dialog names each list with the number of rows it will remove. Confirming is refused: the dialog shows the reason, names the list, and removes nothing.",
    async () => {
      await page.goto(`${BASE}/welcome?step=review`);
      await expectStep(page, "Review", 9);
      const before = countsOf(await reviewTable(page));
      await button(page, "Start blank").click();
      const dialog = page.getByRole("dialog", { name: "Start blank" });
      await expect(dialog).toBeVisible();
      const items = await dialog.locator("ul li").evaluateAll((lis) => lis.map((li) => li.innerText.replace(/\s+/g, " ").trim()));
      const warning = (await dialog.getByText(/This removes every seeded row/).textContent()).trim();
      const keeps = (await dialog.getByText(/^Kept:/).textContent()).trim();
      must(items.length === 8, `dialog lists ${JSON.stringify(items)}`);
      for (const name of ["Matter types", "Matter statuses", "Contract types", "Contract statuses", "Entity types", "Director & Officer roles", "Knowledge types", "Request types"])
        must(items.some((i) => i.startsWith(name) && /\d+ rows?$/.test(i)), `dialog does not name ${name} with a row count: ${JSON.stringify(items)}`);
      await dialog.getByRole("button", { name: "Start blank", exact: true }).click();
      const alert = dialog.getByRole("alert");
      await expect(alert).toBeVisible();
      const reason = (await alert.textContent()).trim();
      must(/Matter types/.test(reason), `reason does not name the list: ${reason}`);
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      const after = countsOf(await reviewTable(page));
      must(JSON.stringify(before) === JSON.stringify(after), `counts changed ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
      const onboarding = await getJson(context, "/api/v1/onboarding");
      must(!onboarding.steps.review.done, "review recorded by a refused Start blank");
      return `The dialog warned "${warning}", listed ${JSON.stringify(items)}, and said "${keeps}". Confirm showed "${reason}". Cancel closed it; Review counts were unchanged and the review was not recorded.`;
    },
  );

  await step(
    "Move the record first (fixture: re-type the Matter to the Default type and its Status to Open through the API), then select Start blank and confirm",
    'Start blank succeeds: the dialog closes, Review shows "Seeded rows removed. The counts below are current.", onboarding is not complete.',
    async () => {
      const types = await getJson(context, "/api/v1/matter-types");
      const def = types.matterTypes.find((t) => t.slug === "default");
      const statuses = await getJson(context, "/api/v1/matter-statuses");
      const open = statuses.matterStatuses.find((s) => s.slug === "open");
      const moved = await postJson(context, `/api/v1/matters/${fixtureMatter.number}`, { matterTypeId: def.id }, "patch");
      must(moved.status === 200, `re-type answered ${moved.status} ${JSON.stringify(moved.body).slice(0, 200)}`);
      const current = JSON.stringify(moved.body);
      let statusNote = "its Status was already Open";
      if (!current.includes(open.id)) {
        const status = await postJson(context, `/api/v1/matters/${fixtureMatter.number}`, { statusId: open.id }, "patch");
        must(status.status === 200, `status answered ${status.status} ${JSON.stringify(status.body).slice(0, 200)}`);
        statusNote = "its Status moved to Open";
      }
      await page.goto(`${BASE}/welcome?step=review`);
      await expectStep(page, "Review", 9);
      const before = await reviewTable(page);
      await button(page, "Start blank").click();
      const dialog = page.getByRole("dialog", { name: "Start blank" });
      await expect(dialog).toBeVisible();
      const items = await dialog.locator("ul li").evaluateAll((lis) => lis.map((li) => li.innerText.replace(/\s+/g, " ").trim()));
      await dialog.getByRole("button", { name: "Start blank", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText("Seeded rows removed. The counts below are current.")).toBeVisible();
      const after = await reviewTable(page);
      const onboarding = await getJson(context, "/api/v1/onboarding");
      must(!onboarding.completed, "Start blank completed onboarding");
      must(onboarding.steps.review.done, "Start blank did not record the review");
      await page.screenshot({ path: path.join(here, "p1-start-blank-done.png"), fullPage: true });
      return `Matter ${fixtureMatter.number} moved to the Default type; ${statusNote}. The dialog listed ${JSON.stringify(items)}. Confirm closed the dialog and Review showed "Seeded rows removed. The counts below are current." Counts before ${JSON.stringify(before.map((r) => `${r.list}: ${r.rows}`))}; after ${JSON.stringify(after.map((r) => `${r.list}: ${r.rows}`))}. Onboarding completed false, review done true.`;
    },
  );

  await step(
    "Check the rows Start blank kept",
    "Kept: Other in Matter types, Contract types, Entity types and Director & Officer roles; Default in Matter and Contract types; Open and Closed Matter statuses; Draft, Active, Expired Contract statuses; every Field; reminder offsets. Review, Approval and Signature Stages hold no Status; the Open Category holds only Open.",
    async () => {
      const q = "?includeArchived=true";
      const slugs = async (p, key) => (await getJson(context, `${p}${q}`))[key].map((r) => r.slug).sort();
      const kept = {
        matterTypes: await slugs("/api/v1/matter-types", "matterTypes"),
        contractTypes: await slugs("/api/v1/contract-types", "contractTypes"),
        entityTypes: await slugs("/api/v1/entity-types", "entityTypes"),
        officerRoles: await slugs("/api/v1/officer-roles", "officerRoles"),
        knowledgeTypes: await slugs("/api/v1/knowledge/types", "knowledgeTypes"),
        requestTypes: await slugs("/api/v1/request-types", "requestTypes"),
      };
      const ms = (await getJson(context, `/api/v1/matter-statuses${q}`)).matterStatuses;
      const cs = (await getJson(context, `/api/v1/contract-statuses${q}`)).contractStatuses;
      const fields = (await getJson(context, `/api/v1/fields${q}`)).fields;
      const offsets = (await getJson(context, "/api/v1/org/reminder-offsets")).offsets;
      must(JSON.stringify(kept.matterTypes) === JSON.stringify(["default", "other"]), `matter types ${kept.matterTypes}`);
      must(JSON.stringify(kept.contractTypes) === JSON.stringify(["default", "other"]), `contract types ${kept.contractTypes}`);
      must(JSON.stringify(kept.entityTypes) === JSON.stringify(["other"]), `entity types ${kept.entityTypes}`);
      must(JSON.stringify(kept.officerRoles) === JSON.stringify(["other"]), `officer roles ${kept.officerRoles}`);
      must(kept.knowledgeTypes.length === 0 && kept.requestTypes.length === 0, "knowledge or request types kept");
      must(JSON.stringify(ms.map((s) => s.slug).sort()) === JSON.stringify(["closed", "open"]), `matter statuses ${ms.map((s) => s.slug)}`);
      must(JSON.stringify(ms.filter((s) => s.category === "open").map((s) => s.slug)) === JSON.stringify(["open"]), "Open Category holds more than Open");
      must(JSON.stringify(cs.map((s) => s.slug).sort()) === JSON.stringify(["active", "draft", "expired"]), `contract statuses ${cs.map((s) => s.slug)}`);
      const byStage = {};
      for (const s of cs) (byStage[s.stage] ??= []).push(s.slug);
      for (const stage of ["review", "approval", "signature"]) must(!byStage[stage], `stage ${stage} holds ${byStage[stage]}`);
      const fieldNames = fields.map((f) => f.displayName ?? f.name);
      for (const name of ["Governing law", "Jurisdiction", "Our position"]) must(fieldNames.includes(name), `Field ${name} missing`);
      must(fields.length === fieldCountBefore, `Fields ${fieldCountBefore} -> ${fields.length}`);
      return `Types kept ${JSON.stringify(kept)}. Matter statuses ${JSON.stringify(ms.map((s) => `${s.slug}/${s.category}`))}. Contract statuses by Stage ${JSON.stringify(byStage)}. ${fields.length} of ${fieldCountBefore} Fields remain, including Governing law, Jurisdiction and Our position. Reminder offsets ${JSON.stringify(offsets)}.`;
    },
    { continueOnFail: true },
  );

  await step(
    "Open Settings -> Organization -> General after Start blank",
    "The Setup checklist does not show Review seeded types.",
    async () => {
      const p2 = await context.newPage();
      await p2.goto(`${BASE}/settings/general`);
      const rows = await outstandingRows(p2);
      await p2.close();
      must(!rows.some((r) => r.label === "Review seeded types"), `rows ${JSON.stringify(rows)}`);
      return `Setup checklist rows: ${JSON.stringify(rows.map((r) => r.label))}; no Review seeded types.`;
    },
    { continueOnFail: true },
  );

  await step(
    "Open Settings -> Advanced -> Audit log",
    "Each emptied list has one entry naming the list and the number of seeded rows removed.",
    async () => {
      const p2 = await context.newPage();
      await p2.goto(`${BASE}/settings/general`);
      const nav = p2.getByRole("navigation", { name: "Settings sections" });
      await expect(nav.getByText("Advanced", { exact: true })).toBeVisible();
      const auditLink = nav.getByRole("link", { name: "Audit log", exact: true });
      if (!(await auditLink.isVisible())) await nav.getByText("Advanced", { exact: true }).click();
      await auditLink.click();
      await expect(p2).toHaveURL(/\/settings\/audit-log/);
      await p2.waitForLoadState("networkidle");
      const text = await p2.locator("main").innerText();
      const entries = [...text.matchAll(/chose Start blank and removed (\d+) seeded rows? from ([a-z &]+?)(?=\n|$|\s{2})/g)].map((m) => `${m[2].trim()}: ${m[1]}`);
      const lines = text.split("\n").filter((l) => /chose Start blank/.test(l)).map((l) => l.trim());
      await p2.screenshot({ path: path.join(here, "p1-audit-log-start-blank.png"), fullPage: true });
      await p2.close();
      must(lines.length === 8, `expected 8 Start blank entries, saw ${lines.length}: ${JSON.stringify(lines)}`);
      for (const list of ["matter types", "matter statuses", "contract types", "contract statuses", "entity types", "officer roles", "knowledge types", "request types"])
        must(lines.filter((l) => l.includes(`from ${list}`)).length === 1, `no single entry for ${list}`);
      return `The audit log held ${lines.length} Start blank entries: ${JSON.stringify(lines)}. Parsed ${JSON.stringify(entries)}.`;
    },
    { continueOnFail: true },
  );

  await step(
    "From Review open Matter types, add a type in Settings, return to setup and select Start blank again",
    "Start blank is refused because a list holds a row the Administrator added; the message names the list and nothing is removed. Settings has no control that deletes the row.",
    async () => {
      await page.goto(`${BASE}/welcome?step=review`);
      await expectStep(page, "Review", 9);
      await page.getByRole("link", { name: "Matter types", exact: true }).click();
      await expect(page).toHaveURL(/\/settings\/matters\/types$/);
      await button(page, "Add type").click();
      await page.getByLabel("New type name", { exact: true }).fill("DOC-030 first-run Advisory");
      await button(page, "Save").click();
      await expect(page.getByText("DOC-030 first-run Advisory").first()).toBeVisible();
      const rowButtons = await page.getByRole("button").allTextContents();
      const labels = await page.getByRole("button").evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label")).filter(Boolean));
      must(!labels.some((l) => /^Delete/i.test(l)) && !rowButtons.some((t) => /^Delete/.test(t.trim())), "a Delete control exists");
      await page.getByRole("link", { name: "Return to setup", exact: true }).click();
      await expectStep(page, "Review", 9);
      const before = countsOf(await reviewTable(page));
      await button(page, "Start blank").click();
      const dialog = page.getByRole("dialog", { name: "Start blank" });
      await dialog.getByRole("button", { name: "Start blank", exact: true }).click();
      const alert = dialog.getByRole("alert");
      await expect(alert).toBeVisible();
      const reason = (await alert.textContent()).trim();
      must(/Matter types/.test(reason) && /you added/.test(reason), `reason ${reason}`);
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      const after = countsOf(await reviewTable(page));
      must(JSON.stringify(before) === JSON.stringify(after), "counts changed");
      return `Settings -> Matter types added "DOC-030 first-run Advisory" (Add type, New type name, Save). The page had no Delete control (row action labels ${JSON.stringify(labels.filter((l) => /Advisory/.test(l)))}). Start blank then showed "${reason}" and the Review counts stayed ${JSON.stringify(before)}.`;
    },
    { continueOnFail: true },
  );

  await step(
    "Open the Start blank dialog, let another tab select Finish, then confirm Start blank",
    "Start blank is refused because onboarding is already complete; the dialog shows the reason and removes nothing. Finish records the review and enters the app.",
    async () => {
      await page.goto(`${BASE}/welcome?step=review`);
      await expectStep(page, "Review", 9);
      await button(page, "Start blank").click();
      const dialog = page.getByRole("dialog", { name: "Start blank" });
      await expect(dialog).toBeVisible();
      const other = await context.newPage();
      await other.goto(`${BASE}/welcome?step=review`);
      await expectStep(other, "Review", 9);
      await button(other, "Finish").click();
      await expect(other).toHaveURL(`${BASE}/`);
      await other.waitForLoadState("networkidle");
      const finishedAt = new URL(other.url()).pathname;
      await other.close();
      const onboarding = await getJson(context, "/api/v1/onboarding");
      must(onboarding.completed && onboarding.steps.review.done, `onboarding ${JSON.stringify(onboarding)}`);
      await dialog.getByRole("button", { name: "Start blank", exact: true }).click();
      const alert = dialog.getByRole("alert");
      await expect(alert).toBeVisible();
      const reason = (await alert.textContent()).trim();
      must(/setup is complete/i.test(reason), `reason ${reason}`);
      const types = await getJson(context, "/api/v1/matter-types?includeArchived=true");
      must(types.matterTypes.some((t) => t.displayName === "DOC-030 first-run Advisory"), "user row removed");
      return `Finish in the second tab opened Home at ${finishedAt}; the onboarding API reported completed true and review done true. Confirming Start blank in the first tab then showed "${reason}", and the Matter types list was unchanged (${types.matterTypes.length} rows).`;
    },
  );
  await savedState(context);
  await context.close();
}

// ===== P1AFTER: after Finish =====
async function phaseP1After() {
  const { context, page } = await resumeContext();

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
    "Check the app header after entering the app",
    "The app header shows the saved organization name and logo.",
    async () => {
      await page.goto(`${BASE}/`);
      await page.waitForLoadState("networkidle");
      const brand = await headerBrand(page);
      must(brand.name === ORG_NAME && brand.logo && brand.loaded, `header ${JSON.stringify(brand)}`);
      await page.locator("header").first().screenshot({ path: path.join(here, "p1-app-header.png") });
      return `Header showed ${JSON.stringify(brand)}.`;
    },
  );

  await step(
    "After completion open Settings -> Organization -> General, Users and the connector pages",
    "Name, logo and timezone are shown; the checklist lists only unfinished steps; invited users appear in Users; the other settings pages open; an app-saved relay is managed under Settings -> Advanced -> Outbound email.",
    async () => {
      await page.goto(`${BASE}/settings/general`);
      await expect(page.getByLabel("Organization name")).toHaveValue(ORG_NAME);
      await expect(page.locator('main img[src^="data:image/png"]').first()).toBeVisible();
      const tzShown = await page.getByRole("combobox", { name: "Default timezone" }).inputValue().catch(() => "not read");
      const rows = await outstandingRows(page);
      const labels = rows.map((r) => r.label).sort();
      must(JSON.stringify(labels) === JSON.stringify(["AI analysis", "E-signature"]), `rows ${JSON.stringify(rows)}`);
      await page.goto(`${BASE}/settings/users`);
      await expect(page.getByText("Rowan Lee")).toBeVisible();
      await expect(page.getByText("Sam Ortiz")).toBeVisible();
      must((await page.getByText("Unsent Person").count()) === 0, "unsent invite listed");
      for (const p of ["/settings/authentication", "/settings/integrations/e-signature", "/settings/ai-analysis"]) {
        await page.goto(`${BASE}${p}`);
        await page.waitForLoadState("networkidle");
        must(new URL(page.url()).pathname === p, `${p} redirected to ${page.url()}`);
      }
      await page.goto(`${BASE}/settings/general`);
      const nav = page.getByRole("navigation", { name: "Settings sections" });
      const emailLink = nav.getByRole("link", { name: "Outbound email", exact: true });
      if (!(await emailLink.isVisible())) await nav.getByText("Advanced", { exact: true }).click();
      await emailLink.click();
      await expect(page).toHaveURL(/\/settings\/email$/);
      await expect(page.getByText(/^Sender: /).first()).toBeVisible();
      const inApp = (await page.getByText(/^Sender: /).first().textContent()).trim();
      must((await page.getByText(/Managed by your deployment configuration/).count()) === 0, "app relay shown as deployment-managed");
      const controls = [];
      for (const name of ["Send test email", "Replace relay", "Clear relay"]) if (await button(page, name).count()) controls.push(name);
      return `General showed the saved name, the PNG logo and Default timezone "${tzShown}". Setup checklist rows after Finish: ${JSON.stringify(rows)}. Users listed Rowan Lee and Sam Ortiz and not the unsent entry. /settings/authentication, /settings/integrations/e-signature and /settings/ai-analysis opened. Settings -> Advanced -> Outbound email showed the app-saved relay ("${inApp}") with ${JSON.stringify(controls)}, and no "Managed by your deployment configuration" note.`;
    },
  );
  await savedState(context);
  await context.close();
}

// ===== P2: after completion, SMTP_URL set and SMTP_FROM empty =====
async function phaseP2() {
  await applyEmailEnvironment("from-missing");
  const { context, page } = await resumeContext();
  try {
    await step(
      "After completion, with the environment setting SMTP_URL but not SMTP_FROM, open Settings -> Organization -> General",
      "The Setup checklist shows Email, and the Email row opens Settings -> Advanced -> Outbound email.",
      async () => {
        await page.goto(`${BASE}/settings/general`);
        await page.waitForLoadState("networkidle");
        const landed = pathOf(page);
        const rows = await outstandingRows(page);
        const email = rows.find((r) => r.label === "Email");
        must(email && email.href === "/settings/email", `rows ${JSON.stringify(rows)}`);
        await page.screenshot({ path: path.join(here, "p2-checklist-email-row.png") });
        await page.getByRole("list", { name: "Outstanding setup steps" }).getByRole("link", { name: "Email", exact: true }).click();
        await expect(page).toHaveURL(/\/settings\/email$/);
        await page.waitForLoadState("networkidle");
        await expect(page.getByText(/sets SMTP_URL but not SMTP_FROM/).first()).toBeVisible();
        const text = (await page.getByText(/sets SMTP_URL but not SMTP_FROM/).first().textContent()).trim();
        const nav = page.getByRole("navigation", { name: "Settings sections" });
        const current = await nav.locator('a[aria-current="page"]').allTextContents();
        return `/settings/general stayed at ${landed}. Setup checklist rows ${JSON.stringify(rows)}. The Email row opened ${pathOf(page)} (Settings nav current ${JSON.stringify(current)}), which said "${text}".`;
      },
    );
  } finally {
    await context.close();
    await applyEmailEnvironment("default");
    run.emailEnvironmentRestored = ENV_NOTES.default;
    save();
  }
}

// ===== C1: Skip optional steps with email configured =====
async function phaseC1() {
  run.emailEnvironment = ENV_NOTES.default;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  currentPage = page;
  await step(
    "Set up OpenLaw step 3 as the guide states it: leave Setup token empty and select Create Administrator",
    `The guide says a missing or wrong token shows "${TOKEN_MESSAGE}"`,
    async () => {
      const { needsSetup } = await (await context.request.get(`${BASE}/api/v1/auth/setup`)).json();
      must(needsSetup === true, "instance already has users");
      await page.goto(`${BASE}/auth/setup`);
      await fillSetup(page, { token: "", password: PASSWORD, confirm: PASSWORD });
      await button(page, "Create Administrator").click();
      await page.waitForTimeout(1500);
      const note = await page.getByLabel("Setup token").evaluate((el) => el.validationMessage);
      const shown = await page.getByText(TOKEN_MESSAGE).count();
      must(shown > 0, `the token message did not show. The browser's required-field check blocked the submit with "${note}", no request reached the app, and the page stayed on ${pathOf(page)}`);
      return `The page showed "${TOKEN_MESSAGE}".`;
    },
    { continueOnFail: true },
  );
  await step(
    "Create the first Administrator on a fresh instance with email set by the environment",
    "Setup opens Welcome to OpenLaw.",
    async () => {
      const { needsSetup } = await (await context.request.get(`${BASE}/api/v1/auth/setup`)).json();
      must(needsSetup === true, "instance already has users");
      await createAdministrator(page);
      return expectStep(page, "Welcome to OpenLaw", 1);
    },
  );
  await step(
    "On Welcome select Skip optional steps with email configured",
    "Onboarding ends and the app opens without recording the review; the wizard cannot be reopened; the Setup checklist shows Review seeded types with Mark as reviewed.",
    async () => {
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
      const review = rows.find((r) => r.label === "Review seeded types");
      must(review?.markAsReviewed && review.href === null, `rows ${JSON.stringify(rows)}`);
      must(!rows.some((r) => r.label === "Email"), "Email row while email is configured");
      return `Skip optional steps opened Home at /. The onboarding API reported completed true and review done false. /welcome then redirected to /. Setup checklist rows: ${JSON.stringify(rows)}.`;
    },
  );
  await context.close();
}

// ===== C2: Set up later on every step and on Review; Mark as reviewed =====
async function phaseC2() {
  run.emailEnvironment = ENV_NOTES.default;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  currentPage = page;
  await step(
    "Create the first Administrator on a fresh instance with email set by the environment, and select Get started",
    "Setup opens Welcome to OpenLaw; Get started opens Your organization.",
    async () => {
      const { needsSetup } = await (await context.request.get(`${BASE}/api/v1/auth/setup`)).json();
      must(needsSetup === true, "instance already has users");
      await createAdministrator(page);
      const w = await expectStep(page, "Welcome to OpenLaw", 1);
      await button(page, "Get started").click();
      return `${w}; then ${await expectStep(page, "Your organization", 2)}.`;
    },
  );
  await step(
    "Select Set up later on Your organization, Authentication and Business-user portal; read Outbound email",
    "Each Set up later moves on. With email set by the deployment environment, Outbound email is read-only, has no Set up later, and Continue is available.",
    async () => {
      const seen = [];
      for (const [next, n] of [["Authentication", 3], ["Business-user portal", 4], ["Outbound email", 5]]) {
        await button(page, "Set up later").click();
        seen.push(await expectStep(page, next, n));
      }
      const text = (await page.getByText(/Outbound email is set by the deployment environment/).textContent()).trim();
      for (const label of ["SMTP server", "Port", "Connection security", "Sender email"])
        must((await page.getByLabel(label, { exact: true }).count()) === 0, `${label} field is shown`);
      for (const name of ["Save relay", "Send test email", "Clear relay", "Replace relay", "Set up later"])
        must((await button(page, name).count()) === 0, `${name} is shown`);
      await expect(button(page, "Continue")).toBeEnabled();
      return `${seen.join(" -> ")}. The step said "${text}" with no relay fields, no Save relay, Send test email, Replace relay, Clear relay or Set up later, and Continue enabled.`;
    },
  );
  await step(
    "Continue, then select Set up later on Invite your team, E-signature, AI analysis and Review",
    "Set up later on Review ends onboarding and enters the app, but does not record the review.",
    async () => {
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
      const onboarding = await getJson(context, "/api/v1/onboarding");
      must(onboarding.completed === true && onboarding.steps.review.done === false, JSON.stringify(onboarding));
      await page.goto(`${BASE}/welcome`);
      await page.waitForLoadState("networkidle");
      must(new URL(page.url()).pathname === "/", `welcome reopened at ${page.url()}`);
      return "Set up later on Review opened Home at /. The onboarding API reported completed true and review done false. /welcome then redirected to /.";
    },
  );
  await step(
    "Open Settings -> Organization -> General and select Mark as reviewed on Review seeded types",
    "The checklist lists the unfinished steps with Settings links; Mark as reviewed removes the Review seeded types row.",
    async () => {
      await page.goto(`${BASE}/settings/general`);
      const rows = await outstandingRows(page);
      const labels = rows.map((r) => r.label);
      must(
        JSON.stringify(labels) === JSON.stringify(["Organization", "Business-user portal", "Invite your team", "E-signature", "AI analysis", "Review seeded types"]),
        `rows ${JSON.stringify(rows)}`,
      );
      for (const r of rows.filter((x) => x.label !== "Review seeded types")) must(r.href?.startsWith("/settings/"), `${r.label} not linked`);
      const list = page.getByRole("list", { name: "Outstanding setup steps" });
      await list.locator("li", { hasText: "Review seeded types" }).getByRole("button", { name: "Mark as reviewed" }).click();
      await expect(list.getByText("Review seeded types")).toHaveCount(0);
      const onboarding = await getJson(context, "/api/v1/onboarding");
      must(onboarding.steps.review.done === true, "review not recorded");
      const portal = rows.find((r) => r.label === "Business-user portal");
      await list.getByRole("link", { name: "Business-user portal" }).click();
      await expect(page).toHaveURL(`${BASE}${portal.href}`);
      return `Rows before: ${JSON.stringify(rows)}. Mark as reviewed removed Review seeded types and the API reported review done true. The Business-user portal row opened ${portal.href}.`;
    },
  );
  await context.close();
}

// ===== C3: Finish without Start blank records the review =====
async function phaseC3() {
  run.emailEnvironment = ENV_NOTES.default;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  currentPage = page;
  await step(
    "Create the first Administrator on a fresh instance with email set by the environment, and move to Review with Set up later and Continue",
    "Review opens with the review not recorded.",
    async () => {
      const { needsSetup } = await (await context.request.get(`${BASE}/api/v1/auth/setup`)).json();
      must(needsSetup === true, "instance already has users");
      await createAdministrator(page);
      await expectStep(page, "Welcome to OpenLaw", 1);
      await button(page, "Get started").click();
      for (const [next, n] of [["Authentication", 3], ["Business-user portal", 4], ["Outbound email", 5]]) {
        await button(page, "Set up later").click();
        await expectStep(page, next, n);
      }
      await button(page, "Continue").click();
      for (const [next, n] of [["E-signature", 7], ["AI analysis", 8], ["Review", 9]]) {
        await button(page, "Set up later").click();
        await expectStep(page, next, n);
      }
      const onboarding = await getJson(context, "/api/v1/onboarding");
      must(!onboarding.completed && !onboarding.steps.review.done, JSON.stringify(onboarding));
      return `Reached ${await expectStep(page, "Review", 9)}; onboarding completed false, review done false.`;
    },
  );
  await step(
    "On Review select Finish without Start blank",
    "Finish records the review, ends onboarding and enters the app; the Setup checklist has no Review seeded types row.",
    async () => {
      await button(page, "Finish").click();
      await expect(page).toHaveURL(`${BASE}/`);
      await page.waitForLoadState("networkidle");
      const onboarding = await getJson(context, "/api/v1/onboarding");
      must(onboarding.completed && onboarding.steps.review.done, JSON.stringify(onboarding));
      await page.goto(`${BASE}/settings/general`);
      const rows = await outstandingRows(page);
      must(!rows.some((r) => r.label === "Review seeded types"), `rows ${JSON.stringify(rows)}`);
      return `Finish opened Home at /. The onboarding API reported completed true and review done true. Setup checklist rows ${JSON.stringify(rows.map((r) => r.label))}.`;
    },
  );
  await context.close();
}

// ===== R: re-walk of Create the first Administrator after the step 3 correction =====
async function phaseR() {
  run.emailEnvironment = ENV_NOTES.default;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  currentPage = page;
  const stillEmpty = async () => {
    const { needsSetup } = await (await context.request.get(`${BASE}/api/v1/auth/setup`)).json();
    must(needsSetup === true, "a user was created");
  };
  await step(
    "Open the instance address on a fresh instance",
    "Set up OpenLaw shows Setup token, Name, Email, Password, Confirm password and Create Administrator.",
    async () => {
      await stillEmpty();
      await page.goto(`${BASE}/`);
      await expect(page).toHaveURL(/\/auth\/setup$/);
      await expect(page.getByText("Set up OpenLaw", { exact: true }).first()).toBeVisible();
      await expect(page.getByLabel("Setup token")).toBeVisible();
      for (const label of ["Name", "Email", "Password", "Confirm password"])
        await expect(page.getByLabel(label, { exact: true })).toBeVisible();
      await expect(button(page, "Create Administrator")).toBeVisible();
      return "/ redirected to /auth/setup, which showed Set up OpenLaw with Setup token, Name, Email, Password, Confirm password and Create Administrator.";
    },
  );
  await step(
    "Step 3: leave Setup token empty and select Create Administrator",
    "An empty required field stops the form before it is sent; no account is created.",
    async () => {
      await fillSetup(page, { token: "", password: PASSWORD, confirm: PASSWORD });
      const sent = [];
      const listener = (r) => { if (r.url().includes("/api/v1/auth/setup") && r.method() === "POST") sent.push(r.url()); };
      page.on("request", listener);
      await button(page, "Create Administrator").click();
      await page.waitForTimeout(1500);
      page.off("request", listener);
      const field = page.getByLabel("Setup token");
      const missing = await field.evaluate((el) => el.validity.valueMissing);
      const note = await field.evaluate((el) => el.validationMessage);
      must(missing, "the empty field was not reported missing");
      must(sent.length === 0, `the form was sent ${sent.length} time(s)`);
      must((await page.getByText(TOKEN_MESSAGE).count()) === 0, "the token message showed for an empty field");
      await expect(page).toHaveURL(/\/auth\/setup$/);
      await stillEmpty();
      return `The browser stopped the form with "${note}" on Setup token. No POST /api/v1/auth/setup was sent, the token message did not show, the page stayed on /auth/setup and needsSetup stayed true.`;
    },
  );
  await step(
    "Step 3: enter a wrong Setup token and select Create Administrator",
    `The page shows "${TOKEN_MESSAGE}" and no account is created.`,
    async () => {
      await fillSetup(page, { token: "wrong-token-doc030", password: PASSWORD, confirm: PASSWORD });
      await button(page, "Create Administrator").click();
      await expect(page.getByText(TOKEN_MESSAGE)).toBeVisible();
      await expect(page).toHaveURL(/\/auth\/setup$/);
      await stillEmpty();
      return `The page showed "${TOKEN_MESSAGE}", stayed on /auth/setup, and needsSetup stayed true.`;
    },
  );
  await step(
    "Step 2: submit a seven-character password in both fields with the correct token",
    "The eight-character minimum stops the form; no account is created.",
    async () => {
      await fillSetup(page, { token: SETUP_TOKEN, password: "Short12", confirm: "Short12" });
      await button(page, "Create Administrator").click();
      await page.waitForTimeout(800);
      const tooShort = await page.getByLabel("Password", { exact: true }).evaluate((el) => el.validity.tooShort);
      must(tooShort, "the Password field did not report tooShort");
      await stillEmpty();
      return "The Password field reported a too-short value, the page stayed on /auth/setup, and needsSetup stayed true.";
    },
  );
  await step(
    "Step 3: submit different values in Password and Confirm password",
    'The page shows "The passwords do not match." and no account is created.',
    async () => {
      await fillSetup(page, { token: SETUP_TOKEN, password: PASSWORD, confirm: `${PASSWORD}x` });
      await button(page, "Create Administrator").click();
      await expect(page.getByText("The passwords do not match.")).toBeVisible();
      await stillEmpty();
      return 'The page showed "The passwords do not match.", stayed on /auth/setup, and needsSetup stayed true.';
    },
  );
  await step(
    "Step 3: correct the entries and submit again",
    "A successful setup signs the Administrator in and opens Welcome to OpenLaw.",
    async () => {
      await fillSetup(page, { token: SETUP_TOKEN, password: PASSWORD, confirm: PASSWORD });
      await button(page, "Create Administrator").click();
      await expect(page).toHaveURL(/\/welcome(\?|$)/);
      const where = await expectStep(page, "Welcome to OpenLaw", 1);
      const me = await getJson(context, "/api/v1/me");
      must(me.user.role === "administrator", `role is ${me.user.role}`);
      return `Signed in as ${me.user.displayName} (role administrator) at ${pathOf(page)}: ${where}.`;
    },
  );
  await context.close();
}
