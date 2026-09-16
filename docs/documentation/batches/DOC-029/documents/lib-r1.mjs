// Shared helpers for the DOC-029 documents independent walkthrough (round 1).
// Written by the DOC-029 independent walkthrough agent (documents, round 1).
// The seed password comes from the environment (LAB_PASSWORD). Sessions, sign-in links
// and mail bodies stay in memory and are never written to disk.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../../../../node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs";

export const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, "../../../../..");
export const BASE = process.env.LAB_APP_URL ?? "http://127.0.0.1:23301";
export const MAIL = process.env.LAB_MAIL_URL ?? "http://127.0.0.1:23401";
const PASSWORD = process.env.LAB_PASSWORD;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const PEOPLE = {
  daniel: { email: "daniel.okafor@helix.example", role: "administrator", name: "Daniel Okafor" },
  nadia: { email: "nadia.haddad@helix.example", role: "legal_team_member", name: "Nadia Haddad" },
  jonas: { email: "jonas.weber@helix.example", role: "business_user", name: "Jonas Weber" },
  ravi: { email: "ravi.menon@helix.example", role: "business_user", name: "Ravi Menon" },
};

let browser;
export async function launch() {
  browser ??= await chromium.launch({ headless: true });
  return browser;
}

export async function staffContext(person) {
  if (!PASSWORD) throw new Error("LAB_PASSWORD is required");
  const b = await launch();
  const context = await b.newContext({
    acceptDownloads: true,
    viewport: { width: 1600, height: 1000 },
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/auth/login`);
  const withPassword = page.getByRole("button", { name: /Sign in with a password/ });
  await page.getByRole("heading").first().waitFor({ timeout: 20000 });
  if (await withPassword.isVisible().catch(() => false)) await withPassword.click();
  await page.getByLabel("Email").fill(person.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 });
  return { context, page };
}

async function mailIds(email) {
  const r = await fetch(
    `${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=20`,
  ).then((x) => x.json());
  return (r.messages ?? []).map((m) => m.ID);
}

export async function portalContext(person) {
  const b = await launch();
  const context = await b.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  for (let attempt = 0; attempt < 5; attempt++) {
    const seen = new Set(await mailIds(person.email));
    await page.goto(`${BASE}/portal/login`);
    const magic = page.getByRole("button", { name: "Email me a sign-in link" });
    await magic.waitFor({ timeout: 20000 });
    await magic.click();
    await page.getByLabel("Email").fill(person.email);
    await page
      .getByRole("button", { name: /Send link|Send|Email me/ })
      .last()
      .click();
    let link = null;
    for (let i = 0; i < 60 && !link; i++) {
      for (const id of await mailIds(person.email)) {
        if (seen.has(id)) continue;
        const m = await fetch(`${MAIL}/api/v1/message/${id}`).then((x) => x.json());
        const match = m.Text?.match(/https?:\/\/[^\s)\]>]+magic-link\/verify[^\s)\]>]*/);
        if (match) {
          const u = new URL(match[0]);
          const lab = new URL(BASE);
          u.protocol = lab.protocol;
          u.host = lab.host;
          link = u.toString();
          break;
        }
      }
      if (!link) await sleep(500);
    }
    if (!link) continue;
    await page.goto(link);
    try {
      await page.waitForURL(
        (u) => u.pathname.startsWith("/portal") && !u.pathname.startsWith("/portal/login"),
        { timeout: 20000 },
      );
      return { context, page };
    } catch {
      // A parallel agent may have requested a newer link that spent this one; ask again.
    }
  }
  throw new Error(`magic-link sign-in failed for ${person.role}`);
}

export async function api(page, method, url, data, multipart) {
  const opts = { method, headers: { origin: BASE }, failOnStatusCode: false };
  if (data !== undefined) opts.data = data;
  if (multipart) opts.multipart = multipart;
  const r = await page.request.fetch(`${BASE}/api/v1${url}`, opts);
  const text = await r.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {}
  return { status: r.status(), body };
}

export async function close() {
  await browser?.close();
  browser = undefined;
}
