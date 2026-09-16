// Shared helpers for the DOC-029r2 portal independent walkthrough (round 2 compatibility replay).
// Credentials come from the environment or the seed default; links and cookies stay in memory.
import { chromium } from "../../../../../../node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs";

export const BASE = process.env.LAB_APP_URL ?? "http://127.0.0.1:23301";
export const MAIL = process.env.LAB_MAIL_URL ?? "http://127.0.0.1:23401";
const PASSWORD = process.env.LAB_SEED_PASSWORD;
if (!PASSWORD)
  throw new Error("LAB_SEED_PASSWORD is required (the seed password from VALIDATION.md)");
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

async function newestMailId(email) {
  const r = await fetch(
    `${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=1`,
  ).then((x) => x.json());
  return r.messages?.[0]?.ID ?? null;
}

export async function portalContext(person) {
  const b = await launch();
  const context = await b.newContext({
    baseURL: BASE,
    acceptDownloads: true,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const before = await newestMailId(person.email);
  await page.goto(`${BASE}/portal/login`);
  const magic = page.getByRole("button", { name: "Email me a sign-in link" });
  await magic.waitFor({ timeout: 20000 });
  await magic.click();
  await page.getByLabel("Email").fill(person.email);
  await page.getByRole("button", { name: "Send link" }).click();
  await page.getByText("Check your email").first().waitFor({ timeout: 15000 });
  let link = null;
  for (let i = 0; i < 60 && !link; i++) {
    const id = await newestMailId(person.email);
    if (id && id !== before) {
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
  return { context, page };
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
