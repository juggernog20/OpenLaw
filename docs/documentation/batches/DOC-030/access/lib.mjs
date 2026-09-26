// Shared helpers for the DOC-030 independent walkthrough of the access group.
// API sessions do fixture setup, organization setting changes and state reads only.
// Every guide step runs in a browser context as the named person.
// The seed demo password comes from LAB_PASSWORD. Links, cookies, secrets and mail bodies stay in memory.
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../../../../node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs";
import { Session } from "../../../../../scripts/seed/client.mjs";

export const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, "../../../../..");
export const LAB = JSON.parse(
  readFileSync(path.join(root, ".documentation-labs/work2/lab.json"), "utf8"),
);
export const BASE = LAB.appUrl;
export const MAIL = LAB.mailUrl;
export const PROJECT = LAB.project;
export const PASSWORD = process.env.LAB_PASSWORD;
if (!PASSWORD)
  throw new Error("Set LAB_PASSWORD to the seed demo password documented in VALIDATION.md.");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const STAMP =
  process.env.RUN_STAMP ?? new Date().toISOString().slice(0, 16).replace(/\D/g, "");

export const SEED = {
  daniel: { email: "daniel.okafor@helix.example", name: "Daniel Okafor" },
  nadia: { email: "nadia.haddad@helix.example", name: "Nadia Haddad" },
  priya: { email: "priya.raman@helix.example", name: "Priya Raman" },
  jonas: { email: "jonas.weber@helix.example", name: "Jonas Weber" },
  amara: { email: "amara.nwosu@helix.example", name: "Amara Nwosu" },
  ravi: { email: "ravi.menon@helix.example", name: "Ravi Menon" },
};

// ---------- browser ----------
let browser;
export async function launch() {
  browser ??= await chromium.launch({ headless: true });
  return browser;
}
export async function closeBrowser() {
  await browser?.close();
  browser = undefined;
}
export async function newContext() {
  const b = await launch();
  const context = await b.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.__errors = [];
  page.on("pageerror", (e) => page.__errors.push(e.message.slice(0, 200)));
  return { context, page };
}

/** Staff password sign-in in its own browser context. */
export async function staffSignIn(email) {
  const c = await newContext();
  await c.page.goto(`${BASE}/auth/login`);
  const withPassword = c.page.getByRole("button", { name: /Sign in with a password/ });
  if (await withPassword.isVisible().catch(() => false)) await withPassword.click();
  await c.page.getByLabel("Email").fill(email);
  await c.page.getByLabel("Password").fill(PASSWORD);
  await c.page.getByRole("button", { name: "Sign in", exact: true }).click();
  await c.page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 });
  return c;
}

// ---------- Mailpit ----------
export async function mailSince(email, sinceMs, subjectRe) {
  const r = await fetch(
    `${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=50`,
  ).then((x) => x.json());
  return (r.messages ?? [])
    .filter((m) => new Date(m.Created).getTime() >= sinceMs - 1500)
    .filter((m) => !subjectRe || subjectRe.test(m.Subject))
    .sort((a, b) => new Date(b.Created) - new Date(a.Created));
}

/** Waits for a new message; returns {subject, link} with the link moved to the lab host. Never persisted. */
export async function waitForLink(email, sinceMs, { subjectRe, linkRe, timeoutMs = 30000 } = {}) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const msgs = await mailSince(email, sinceMs, subjectRe);
    if (msgs.length) {
      const m = await fetch(`${MAIL}/api/v1/message/${msgs[0].ID}`).then((x) => x.json());
      const links = (m.Text ?? "").match(/https?:\/\/[^\s)>\]"]+/g) ?? [];
      const pick = links.find((l) => !linkRe || linkRe.test(l)) ?? null;
      let link = null;
      if (pick) {
        const u = new URL(pick.replace(/[.,]+$/, ""));
        const lab = new URL(BASE);
        u.protocol = lab.protocol;
        u.host = lab.host;
        link = u.toString();
      }
      return { subject: m.Subject, link, count: msgs.length, text: m.Text ?? "" };
    }
    await sleep(500);
  }
  return null;
}

/** Portal sign-in through the guide's own steps, retried when a parallel agent spends the same person's link. */
export const budgetWaits = [];
export async function portalSignIn(email, c) {
  c ??= await newContext();
  for (let i = 0; i < 4; i++) {
    await c.page.goto(`${BASE}/portal/login`);
    await c.page.getByRole("heading").first().waitFor({ timeout: 15000 });
    await settle(c.page);
    const emailMe = c.page.getByRole("button", { name: "Email me a sign-in link" });
    if (await emailMe.isVisible().catch(() => false)) await emailMe.click();
    await c.page.getByRole("button", { name: "Send link" }).waitFor({ timeout: 15000 });
    await c.page.getByLabel("Email").fill(email);
    const since = Date.now();
    await c.page.getByRole("button", { name: "Send link" }).click();
    const answer = await Promise.race([
      c.page
        .getByText("Check your email")
        .first()
        .waitFor({ timeout: 15000 })
        .then(() => "sent"),
      c.page
        .getByText("Too many sign-in link requests")
        .first()
        .waitFor({ timeout: 15000 })
        .then(() => "budget"),
    ]).catch(() => "none");
    if (answer !== "sent") {
      // The link budget (3 per address, 30 per client address, 15 minutes) is shared with other agents on the lab.
      console.log(`portal sign-in for ${email}: ${answer}; waiting 60 s`);
      budgetWaits.push({ email, at: new Date().toISOString(), answer });
      await sleep(60000);
      i = Math.max(-1, i - 1);
      if (budgetWaits.filter((w) => w.email === email).length > 18)
        throw new Error(`link budget did not recover for ${email}`);
      continue;
    }
    const m = await waitForLink(email, since, { subjectRe: /Sign in/i, linkRe: /magic-link/ });
    if (!m?.link) continue;
    await c.page.goto(m.link);
    const ok = await c.page
      .waitForURL(
        (u) => u.pathname.startsWith("/portal") && !u.pathname.startsWith("/portal/login"),
        {
          timeout: 20000,
        },
      )
      .then(
        () => true,
        () => false,
      );
    if (ok) return c;
    await sleep(1500 * (i + 1));
  }
  throw new Error(`portal sign-in failed for ${email}`);
}

// ---------- TOTP (RFC 6238, SHA-1, 30 s, 6 digits) ----------
function base32(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/[\s=-]/g, "").toUpperCase()) {
    const v = alphabet.indexOf(c);
    if (v < 0) throw new Error("secret is not base32");
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
export function totp(secret) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
  const h = createHmac("sha1", base32(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, "0");
}
export async function freshStep(margin = 8) {
  const left = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (left < margin) await sleep(left * 1000 + 500);
}

// ---------- API sessions (fixtures, setting changes and state reads) ----------
export async function apiSession(email, password = PASSWORD) {
  const s = new Session(email, BASE);
  await s.request("POST", "/api/auth/sign-in/email", {
    json: { email, password },
    headers: { origin: BASE },
  });
  return s;
}
/** Calls /api/v1 and never throws on a refusal: {status, body}. */
export async function call(s, method, p, json) {
  try {
    const r = await s.request(method, `/api/v1${p}`, {
      ...(json === undefined ? {} : { json }),
      headers: { origin: BASE },
    });
    return { status: r.status, body: r.body };
  } catch (e) {
    return { status: e.status ?? 0, body: e.body ?? String(e.message) };
  }
}
export async function upload(s, p, name, content, mimeType = "text/plain", extra = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  form.append("file", new Blob([content], { type: mimeType }), name);
  try {
    const r = await s.request("POST", `/api/v1${p}`, { form, headers: { origin: BASE } });
    return { status: r.status, body: r.body };
  } catch (e) {
    return { status: e.status ?? 0, body: e.body };
  }
}
/** Browser-context API read with the page's own session (used for state reads as that person). */
export async function pageApi(page, method, p, data) {
  const r = await page.request.fetch(`${BASE}/api/v1${p}`, {
    method,
    headers: { origin: BASE },
    failOnStatusCode: false,
    ...(data === undefined ? {} : { data }),
  });
  let body = null;
  try {
    body = await r.json();
  } catch {}
  return { status: r.status(), body };
}

/** Read-only database query for state reads (link lifetime, counts). */
export function sql(query) {
  return execFileSync(
    "docker",
    ["exec", `${PROJECT}-postgres-1`, "psql", "-U", "openlaw", "-d", "openlaw", "-At", "-c", query],
    { encoding: "utf8" },
  ).trim();
}

// ---------- page helpers ----------
export async function text(locator) {
  return (await locator.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
}
export async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await sleep(600);
}
export async function go(page, url) {
  await page.goto(`${BASE}${url}`);
  await settle(page);
  if (/Something went wrong\./.test(await text(page.locator("body")))) {
    await page.reload();
    await settle(page);
  }
}
export async function h1(page) {
  const heading = page.getByRole("heading", { level: 1 }).first();
  await heading.waitFor({ timeout: 15000 });
  return (await heading.innerText()).trim();
}
export async function applet(page, name) {
  const panel = page.getByRole("complementary", { name, exact: true });
  if (!(await panel.isVisible().catch(() => false))) {
    await page
      .getByRole("toolbar", { name: "Applets" })
      .getByRole("button", { name: new RegExp(`^${name}\\b`) })
      .first()
      .click();
  }
  await panel.waitFor({ timeout: 10000 });
  await sleep(700);
  return panel;
}
export async function rosterRows(panel) {
  return (await panel.getByRole("listitem").allInnerTexts()).map((t) =>
    t.replace(/\s+/g, " ").trim(),
  );
}

// ---------- step log ----------
export function check(condition, message) {
  if (!condition) throw new Error(message);
}
export function makeLog(results, save) {
  return async function step(article, role, id, action, expected, fn) {
    const entry = {
      article,
      id,
      role,
      method: "browser-walkthrough",
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
      if (out && typeof out === "object") {
        entry.page = out.page ?? null;
        entry.actual = out.actual;
      } else entry.actual = out;
      entry.result = "pass";
    } catch (error) {
      entry.actual = `Check did not complete: ${String(error?.message ?? error)
        .split("\n")
        .slice(0, 3)
        .join(" ")}`;
      entry.result = "fail";
    }
    entry.at = new Date().toISOString();
    console.log(
      `[${article}/${role}] ${entry.result.toUpperCase()} ${id}: ${String(entry.actual).slice(0, 400)}`,
    );
    save();
    return entry;
  };
}

/** API session for a Business User from a fresh magic link (fixture setup only). Waits out the link budget. */
export async function magicLinkSession(email, { maxWaitMs = 17 * 60000 } = {}) {
  const until = Date.now() + maxWaitMs;
  for (;;) {
    const since = Date.now();
    const r = await fetch(`${BASE}/api/v1/auth/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify({ email, group: "business" }),
    });
    if (r.status === 202) {
      const m = await waitForLink(email, since, { subjectRe: /Sign in/i, linkRe: /magic-link/ });
      if (m?.link) {
        const s = new Session(email, BASE);
        await s.request("GET", m.link, { expect: [200, 301, 302, 303, 307, 308] });
        const me = await call(s, "GET", "/me");
        if (me.status === 200) return s;
      }
    } else if (r.status !== 429) throw new Error(`magic link answered ${r.status}`);
    if (Date.now() > until) throw new Error(`no usable magic link for ${email}`);
    console.log(`link budget or race for ${email}; waiting 60 s`);
    await sleep(60000);
  }
}
