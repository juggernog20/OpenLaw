// Shared helpers for the DOC-030 portal independent walkthrough.
// Credentials come from the environment only; links and cookies stay in memory.
import { existsSync } from "node:fs";
import { chromium } from "../../../../../node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs";

export const BASE = process.env.LAB_APP_URL ?? "http://127.0.0.1:43300";
export const MAIL = process.env.LAB_MAIL_URL ?? "http://127.0.0.1:48425";
const PASSWORD = process.env.LAB_PASSWORD;
if (!PASSWORD)
  throw new Error("LAB_PASSWORD is required (the seed demo password from VALIDATION.md)");
export const PEOPLE = {
  daniel: { email: "daniel.okafor@helix.example", role: "administrator" },
  nadia: { email: "nadia.haddad@helix.example", role: "legal_team_member" },
  jonas: { email: "jonas.weber@helix.example", role: "business_user" },
  amara: { email: "amara.nwosu@helix.example", role: "business_user" },
};

let browser;
export async function launch() {
  browser ??= await chromium.launch({ headless: true });
  return browser;
}

export async function staffContext(person) {
  const b = await launch();
  const context = await b.newContext({
    baseURL: BASE,
    acceptDownloads: true,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/auth/login`);
  await page.getByRole("heading").first().waitFor({ timeout: 20000 });
  const pw = page.getByRole("button", { name: "Sign in with a password" });
  if (await pw.isVisible().catch(() => false)) await pw.click();
  await page.getByLabel("Email").fill(person.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 });
  return { context, page };
}

// Sign-in link requests are budgeted per email address and per client address, and the lab is
// shared with other agents. So one fresh magic link per identity is saved as a browser session in
// SESSIONS (a private directory outside the repository) and reused while it stays valid.
const SESSIONS = process.env.SESSIONS ?? null;

async function mailAfter(email, since) {
  const r = await fetch(
    `${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}" subject:"Sign in"`)}&limit=5`,
  ).then((x) => x.json());
  return (r.messages ?? []).filter((m) => Date.parse(m.Created) >= since).at(-1)?.ID ?? null;
}

async function portalSessionIsLive(context, person) {
  const r = await context.request.get(`${BASE}/api/v1/me`);
  if (r.status() !== 200) return false;
  const me = await r.json();
  return me.user?.email === person.email;
}

export async function portalContext(person) {
  const b = await launch();
  const saved = SESSIONS ? `${SESSIONS}/${person.email}.json` : null;
  const options = { baseURL: BASE, acceptDownloads: true, viewport: { width: 1440, height: 900 } };
  if (saved && existsSync(saved)) {
    const context = await b.newContext({ ...options, storageState: saved });
    if (await portalSessionIsLive(context, person)) {
      const page = await context.newPage();
      await page.goto(`${BASE}/portal`);
      return { context, page, reused: true };
    }
    await context.close();
  }
  const context = await b.newContext(options);
  const page = await context.newPage();
  await page.goto(`${BASE}/portal/login`);
  const magic = page.getByRole("button", { name: "Email me a sign-in link" });
  await magic.waitFor({ timeout: 20000 });
  await magic.click();
  await page.getByLabel("Email").fill(person.email);
  const since = Date.now() - 1000;
  await page.getByRole("button", { name: "Send link" }).click();
  await page.getByText("Check your email").first().waitFor({ timeout: 15000 });
  let link = null;
  for (let i = 0; i < 60 && !link; i++) {
    const id = await mailAfter(person.email, since);
    if (id) {
      const m = await fetch(`${MAIL}/api/v1/message/${id}`).then((x) => x.json());
      const match = m.Text.match(/https?:\/\/[^\s)\]]+magic-link\/verify[^\s)\]]*/);
      if (match) {
        const u = new URL(match[0]);
        const lab = new URL(BASE);
        u.protocol = lab.protocol;
        u.host = lab.host;
        link = u.toString();
      }
    }
    if (!link) await new Promise((r) => setTimeout(r, 500));
  }
  if (!link) throw new Error(`no fresh sign-in mail for ${person.role}`);
  await page.goto(link);
  await page.waitForURL(
    (u) => u.pathname.startsWith("/portal") && !u.pathname.startsWith("/portal/login"),
    { timeout: 30000 },
  );
  link = null;
  if (saved) await context.storageState({ path: saved });
  return { context, page, reused: false };
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
