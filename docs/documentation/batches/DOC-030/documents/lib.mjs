// Shared helpers for the DOC-030 documents independent walkthrough.
// Written by the DOC-030 independent walkthrough agent (documents), from the DOC-029 lib-r1.mjs pattern.
// The seed password comes from the environment (LAB_PASSWORD). Sessions, sign-in links
// and mail bodies stay in memory and are never written to disk.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../../../../node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs";

export const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, "../../../../..");
export const BASE = process.env.LAB_APP_URL ?? "http://127.0.0.1:43300";
export const MAIL = process.env.LAB_MAIL_URL ?? "http://127.0.0.1:48425";
const PASSWORD = process.env.LAB_PASSWORD;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const PEOPLE = {
  daniel: { email: "daniel.okafor@helix.example", role: "administrator", name: "Daniel Okafor" },
  nadia: { email: "nadia.haddad@helix.example", role: "legal_team_member", name: "Nadia Haddad" },
  jonas: { email: "jonas.weber@helix.example", role: "business_user", name: "Jonas Weber" },
  amara: { email: "amara.nwosu@helix.example", role: "business_user", name: "Amara Nwosu" },
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

async function mailSince(email, sinceMs) {
  const r = await fetch(
    `${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=50`,
  ).then((x) => x.json());
  return (r.messages ?? [])
    .filter((m) => new Date(m.Created).getTime() >= sinceMs - 1500)
    .filter((m) => /Sign in/i.test(m.Subject))
    .sort((a, b) => new Date(b.Created) - new Date(a.Created));
}

// Portal sign-in with a fresh magic link read from this lab's Mailpit. The link budget
// (3 per address in 15 minutes) is shared with other agents, so a refusal waits and retries.
// The link stays in memory only.
export async function portalContext(person) {
  const b = await launch();
  const context = await b.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  for (let attempt = 0; attempt < 20; attempt++) {
    await page.goto(`${BASE}/portal/login`);
    await page.getByRole("heading").first().waitFor({ timeout: 20000 });
    const emailMe = page.getByRole("button", { name: "Email me a sign-in link" });
    if (await emailMe.isVisible().catch(() => false)) await emailMe.click();
    await page.getByRole("button", { name: "Send link" }).waitFor({ timeout: 15000 });
    await page.getByLabel("Email").fill(person.email);
    const since = Date.now();
    await page.getByRole("button", { name: "Send link" }).click();
    const answer = await Promise.race([
      page.getByText("Check your email").first().waitFor({ timeout: 15000 }).then(() => "sent"),
      page
        .getByText("Too many sign-in link requests")
        .first()
        .waitFor({ timeout: 15000 })
        .then(() => "budget"),
    ]).catch(() => "none");
    if (answer !== "sent") {
      console.log(`portal sign-in for ${person.role}: ${answer}; waiting 60 s`);
      await sleep(60000);
      continue;
    }
    let link = null;
    for (let i = 0; i < 60 && !link; i++) {
      const [m] = await mailSince(person.email, since);
      if (m) {
        const full = await fetch(`${MAIL}/api/v1/message/${m.ID}`).then((x) => x.json());
        const match = full.Text?.match(/https?:\/\/[^\s)\]>"]+magic-link[^\s)\]>"]*/);
        if (match) {
          const u = new URL(match[0].replace(/[.,]+$/, ""));
          const lab = new URL(BASE);
          u.protocol = lab.protocol;
          u.host = lab.host;
          link = u.toString();
        }
      }
      if (!link) await sleep(500);
    }
    if (!link) continue;
    await page.goto(link);
    const ok = await page
      .waitForURL(
        (u) => u.pathname.startsWith("/portal") && !u.pathname.startsWith("/portal/login"),
        { timeout: 20000 },
      )
      .then(
        () => true,
        () => false,
      );
    if (ok) return { context, page };
    // A parallel agent may have requested a newer link that spent this one; ask again.
    await sleep(1500);
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
