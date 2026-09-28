// Shared helpers for the DOC-032 records independent walkthrough.
// Written by the DOC-032 independent walkthrough agent (records), from the DOC-030 matters
// lib.mjs, entities api.mjs and admin-config api.mjs patterns and the DOC-032 documents lib.mjs.
// The seed password comes from the environment (LAB_PASSWORD). Sessions, sign-in links
// and mail bodies stay in memory and are never written to disk.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, "../../../../..");
export const PW_PATH = path.join(
  root,
  "node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs",
);
export const { chromium } = await import(PW_PATH);
export const lab = JSON.parse(
  readFileSync(path.join(root, ".documentation-labs/work/lab.json"), "utf8"),
);
export const BASE = process.env.LAB_APP_URL ?? lab.appUrl;
export const MAIL = process.env.LAB_MAIL_URL ?? lab.mailUrl;
const PASSWORD = process.env.LAB_PASSWORD;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const sha = (buf) => createHash("sha256").update(buf).digest("hex");
export const articleHash = (id) => sha(readFileSync(path.join(root, `docs/user-guides/${id}.md`)));

export const PEOPLE = {
  administrator: { email: "daniel.okafor@helix.example", name: "Daniel Okafor" },
  legal_team_member: { email: "nadia.haddad@helix.example", name: "Nadia Haddad" },
  devon: { email: "devon@helix.example", name: "Devon Calloway" },
  priya: { email: "priya.raman@helix.example", name: "Priya Raman" },
  ravi: { email: "ravi.menon@helix.example", name: "Ravi Menon" },
  business_user: { email: "jonas.weber@helix.example", name: "Jonas Weber" },
  amara: { email: "amara.nwosu@helix.example", name: "Amara Nwosu" },
  // A second Business User whose sign-in link budget other agents on the lab are not using.
  karim: { email: "karim.aziz@helix.example", name: "Karim Aziz" },
};

export function must(condition, message) {
  if (!condition) throw new Error(message);
}
export const tidy = (v) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim() : Array.isArray(v) ? v.map(tidy) : v;
export const q = (s) => JSON.stringify(tidy(s));
export const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export async function until(fn, message, timeout = 15000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(300);
  }
  throw new Error(`timed out: ${message}`);
}

/** Password sign-in in its own browser context. */
export async function passwordSignIn(browser, email) {
  if (!PASSWORD) throw new Error("LAB_PASSWORD is required");
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1600, height: 1000 },
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/auth/login`);
  await page.getByRole("heading").first().waitFor({ timeout: 20000 });
  const withPassword = page.getByRole("button", {
    name: /Sign in with a password|Administrator sign-in/,
  });
  if (await withPassword.isVisible().catch(() => false)) await withPassword.click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 });
  return { context, page };
}

async function signInMail(email, sinceMs) {
  const r = await fetch(
    `${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=50`,
  ).then((x) => x.json());
  return (r.messages ?? [])
    .filter((m) => new Date(m.Created).getTime() >= sinceMs - 1500)
    .filter((m) => /Sign in/i.test(m.Subject))
    .sort((a, b) => new Date(b.Created) - new Date(a.Created));
}

/**
 * Portal sign-in with a fresh magic link read from this lab's Mailpit. The link budget
 * (3 per address in 15 minutes) is shared with other agents, so a refusal waits and
 * retries. The link stays in memory only.
 */
export async function magicSignIn(browser, email) {
  const context = await browser.newContext({
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
    await page.getByLabel("Email").fill(email);
    const since = Date.now();
    await page.getByRole("button", { name: "Send link" }).click();
    const answer = await Promise.race([
      page
        .getByText("Check your email")
        .first()
        .waitFor({ timeout: 15000 })
        .then(() => "sent"),
      page
        .getByText("Too many sign-in link requests")
        .first()
        .waitFor({ timeout: 15000 })
        .then(() => "budget"),
    ]).catch(() => "none");
    if (answer !== "sent") {
      console.log(`portal sign-in for ${email}: ${answer}; waiting 60 s`);
      await sleep(60000);
      continue;
    }
    let link = null;
    for (let i = 0; i < 60 && !link; i++) {
      const [m] = await signInMail(email, since);
      if (m) {
        const full = await fetch(`${MAIL}/api/v1/message/${m.ID}`).then((x) => x.json());
        const match = full.Text?.match(/https?:\/\/[^\s)\]>"]+magic-link[^\s)\]>"]*/);
        if (match) {
          const u = new URL(match[0].replace(/[.,]+$/, ""));
          const labUrl = new URL(BASE);
          u.protocol = labUrl.protocol;
          u.host = labUrl.host;
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
    await sleep(1500);
  }
  throw new Error(`magic-link sign-in failed for ${email}`);
}

/** API call in a signed-in context. For fixture setup, competing writes and state reads only. */
export async function api(page, method, url, data, multipart) {
  const opts = { method, headers: { origin: BASE }, failOnStatusCode: false };
  if (data !== undefined) opts.data = data;
  if (multipart) opts.multipart = multipart;
  const r = await page.request.fetch(`${BASE}/api/v1${url}`, opts);
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: r.status(), json, text: json ? undefined : text.slice(0, 500) };
}
