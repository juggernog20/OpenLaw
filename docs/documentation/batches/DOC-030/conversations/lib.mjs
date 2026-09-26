// Shared helpers for the DOC-030 conversations independent walkthrough.
// Copied from the DOC-029 conversations lib-r1.mjs and the DOC-029 inbox api.mjs helper.
// The seed demo password comes from LAB_PASSWORD only. Magic links, activation links,
// cookies and raw mail stay in memory and are never written to a file.
import { existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { chromium } from "../../../../../node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs";

export const BASE = process.env.LAB_APP_URL ?? "http://127.0.0.1:43300";
export const MAIL = process.env.LAB_MAIL_URL ?? "http://127.0.0.1:48425";
export const PASSWORD = process.env.LAB_PASSWORD;
if (!PASSWORD)
  throw new Error("Set LAB_PASSWORD to the seed demo password documented in VALIDATION.md.");

export const PEOPLE = {
  daniel: { email: "daniel.okafor@helix.example", name: "Daniel Okafor", role: "administrator" },
  nadia: { email: "nadia.haddad@helix.example", name: "Nadia Haddad", role: "legal_team_member" },
  jonas: { email: "jonas.weber@helix.example", name: "Jonas Weber", role: "business_user" },
  amara: { email: "amara.nwosu@helix.example", name: "Amara Nwosu", role: "business_user" },
};

export const pause = (ms) => new Promise((r) => setTimeout(r, ms));

let browser;
export async function launch() {
  browser ??= await chromium.launch({ headless: true });
  return browser;
}

// Signed-in browser state is cached outside docs/ (the session scratch directory), so a
// later section reuses a session instead of spending the shared sign-in link budget.
const STATE_DIR = process.env.WALK_STATE_DIR;
const stateFile = (email) =>
  STATE_DIR
    ? `${STATE_DIR}/state-${createHash("sha256").update(email).digest("hex").slice(0, 16)}.json`
    : null;
async function newContext(email) {
  const b = await launch();
  const file = email ? stateFile(email) : null;
  const context = await b.newContext({
    baseURL: BASE,
    acceptDownloads: true,
    viewport: { width: 1440, height: 900 },
    ...(file && existsSync(file) ? { storageState: file } : {}),
  });
  context.setDefaultTimeout(15000);
  return context;
}

/** Password sign-in in its own browser context. */
async function cachedSession(email) {
  const file = stateFile(email);
  if (!file || !existsSync(file)) return null;
  const context = await newContext(email);
  const page = await context.newPage();
  const me = await page.request.get(`${BASE}/api/v1/me`);
  if (me.ok()) return { context, page };
  await context.close();
  return null;
}
async function keepSession(email, context) {
  const file = stateFile(email);
  if (!file) return;
  mkdirSync(STATE_DIR, { recursive: true });
  await context.storageState({ path: file });
}

export async function staffContext(email, password = PASSWORD) {
  const cached = await cachedSession(email);
  if (cached) return cached;
  const context = await newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/auth/login`);
  await page.getByRole("heading").first().waitFor({ timeout: 20000 });
  const pw = page.getByRole("button", { name: "Sign in with a password" });
  if (await pw.isVisible().catch(() => false)) await pw.click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 });
  await keepSession(email, context);
  return { context, page };
}

async function mailpit(path) {
  const r = await fetch(`${MAIL}${path}`);
  if (!r.ok) throw new Error(`Mailpit ${r.status} for ${path}`);
  return r.json();
}
export async function mailSearch(query, limit = 200) {
  const r = await mailpit(`/api/v1/search?query=${encodeURIComponent(query)}&limit=${limit}`);
  return r.messages ?? [];
}
export async function mailMessage(id) {
  return mailpit(`/api/v1/message/${id}`);
}

/** Newest message to an address created after `since` whose subject matches. */
export async function waitForMail(address, subjectRe, since, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await mailSearch(`to:"${address}"`, 30);
    const match = found.find(
      (m) =>
        new Date(m.Created).getTime() >= since - 1500 && (!subjectRe || subjectRe.test(m.Subject)),
    );
    if (match) {
      const message = await mailMessage(match.ID);
      if (message.Text) return { id: match.ID, subject: message.Subject, text: message.Text };
    }
    await pause(700);
  }
  return null;
}

/** Requests a fresh magic link and returns it rewritten to the lab host. Never persisted. */
export async function freshMagicLink(email) {
  const since = Date.now();
  const r = await fetch(`${BASE}/api/v1/auth/magic-link`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ email, group: "business" }),
  });
  if (r.status !== 202) throw new Error(`magic link request answered ${r.status}`);
  const mail = await waitForMail(email, /sign in/i, since);
  if (!mail) throw new Error(`no sign-in mail for ${email}`);
  const match = mail.text.match(/https?:\/\/[^\s<>"')]*\/api\/auth\/magic-link\/verify[^\s<>"')]*/);
  if (!match) throw new Error("no magic link in the sign-in mail");
  const url = new URL(match[0].replace(/[.,]+$/, ""));
  const lab = new URL(BASE);
  url.protocol = lab.protocol;
  url.host = lab.host;
  return url.toString();
}

/** A Business User browser sign-in in its own context, retried if a parallel agent spends the link. */
export async function portalContext(email) {
  const cached = await cachedSession(email);
  if (cached) return cached;
  const context = await newContext();
  const page = await context.newPage();
  let last;
  // The lab allows three link requests per address and thirty per client address in
  // fifteen minutes, shared with the other walkthrough agents, so a refusal waits.
  for (let attempt = 1; attempt <= 40; attempt++) {
    try {
      const link = await freshMagicLink(email);
      await page.goto(link);
      await page.waitForLoadState("networkidle").catch(() => {});
      const me = await page.request.get(`${BASE}/api/v1/me`);
      if (me.ok()) {
        await keepSession(email, context);
        return { context, page };
      }
      last = new Error(`me answered ${me.status()}`);
    } catch (e) {
      last = e;
    }
    await pause(/429/.test(String(last?.message)) ? 20000 + Math.random() * 5000 : 3000);
  }
  throw new Error(`magic-link sign-in failed for ${email}: ${last?.message}`);
}

export async function api(page, method, path, data, multipart) {
  const opts = {};
  if (data !== undefined) opts.data = data;
  if (multipart) opts.multipart = multipart;
  const r = await page.request.fetch(`${BASE}/api/v1${path}`, { method, ...opts });
  let body = null;
  const text = await r.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: r.status(), body };
}

export async function close() {
  await browser?.close();
}

/** Chromium in its new headless mode, which keeps granted notification permissions. */
export async function launchNewHeadless() {
  return chromium.launch({ channel: "chromium", headless: true });
}
