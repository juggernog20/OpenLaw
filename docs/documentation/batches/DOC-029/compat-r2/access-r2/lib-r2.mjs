// Shared helpers for the DOC-029r2 access independent walkthrough (round 2 compatibility replay).
// The seed password comes from the environment. Links, cookies, secrets and mail bodies stay in memory.
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chromium } from "../../../../../../node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs";

export const BASE = process.env.LAB_APP_URL ?? "http://127.0.0.1:23301";
export const MAIL = process.env.LAB_MAIL_URL ?? "http://127.0.0.1:23401";
export const PROJECT = process.env.LAB_PROJECT ?? "openlaw-docs-41255c61-work2";
export const SEED_PASSWORD = process.env.LAB_SEED_PASSWORD;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const SEED = {
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
export async function close() {
  await browser?.close();
  browser = undefined;
}

export async function newContext(extra = {}) {
  const b = await launch();
  const context = await b.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    ...extra,
  });
  const page = await context.newPage();
  return { context, page };
}

/** Password sign-in on the staff sign-in page. Returns after leaving /auth, or the page stays for inspection. */
export async function passwordSignIn(email, password = SEED_PASSWORD, { expectLeave = true } = {}) {
  if (!password) throw new Error("LAB_SEED_PASSWORD is required");
  const { context, page } = await newContext();
  await page.goto(`${BASE}/auth/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  if (expectLeave)
    await page.waitForURL((u) => !u.pathname.startsWith("/auth/login"), { timeout: 30000 });
  return { context, page };
}

// ---------- Mailpit ----------
export async function mailSince(email, sinceMs, subjectRe) {
  const r = await fetch(
    `${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=50`,
  ).then((x) => x.json());
  const out = [];
  for (const m of r.messages ?? []) {
    if (new Date(m.Created).getTime() < sinceMs - 1500) continue;
    if (subjectRe && !subjectRe.test(m.Subject)) continue;
    out.push(m);
  }
  return out.sort((a, b) => new Date(b.Created) - new Date(a.Created));
}

/** Waits for a new message to the address; returns {subject, link} with the link rewritten to the lab host. */
export async function waitForLink(
  email,
  sinceMs,
  { subjectRe, linkRe = /https?:\/\/[^\s)>\]"]+/g, timeoutMs = 30000 } = {},
) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const msgs = await mailSince(email, sinceMs, subjectRe);
    if (msgs.length) {
      const m = await fetch(`${MAIL}/api/v1/message/${msgs[0].ID}`).then((x) => x.json());
      const links = (m.Text ?? "").match(/https?:\/\/[^\s)>\]"]+/g) ?? [];
      const pick =
        links.find((l) => (linkRe instanceof RegExp && !linkRe.global ? linkRe.test(l) : true)) ??
        null;
      let link = null;
      if (pick) {
        const u = new URL(pick);
        const lab = new URL(BASE);
        u.protocol = lab.protocol;
        u.host = lab.host;
        link = u.toString();
      }
      return { subject: m.Subject, link, count: msgs.length };
    }
    await sleep(500);
  }
  return null;
}

// ---------- TOTP (RFC 6238, SHA-1, 30 s, 6 digits) ----------
function base32(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = secret.replace(/[\s=-]/g, "").toUpperCase();
  let bits = "";
  for (const c of clean) {
    const v = alphabet.indexOf(c);
    if (v < 0) throw new Error("secret is not base32");
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
export function totp(secret, offsetSteps = 0) {
  const counter = Math.floor(Date.now() / 1000 / 30) + offsetSteps;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", base32(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, "0");
}
/** Waits until at least `margin` seconds remain in the current TOTP step. */
export async function freshStep(margin = 8) {
  const left = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (left < margin) await sleep(left * 1000 + 500);
}

// ---------- API ----------
export async function api(page, method, path, data, multipart) {
  const opts = { method, headers: { origin: BASE }, failOnStatusCode: false };
  if (data !== undefined) opts.data = data;
  if (multipart) opts.multipart = multipart;
  const r = await page.request.fetch(`${BASE}/api/v1${path}`, opts);
  const text = await r.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {}
  return { status: r.status(), body };
}

// ---------- Lab database (test preparation only) ----------
export function sql(query) {
  return execFileSync(
    "docker",
    ["exec", `${PROJECT}-postgres-1`, "psql", "-U", "openlaw", "-d", "openlaw", "-At", "-c", query],
    {
      encoding: "utf8",
    },
  ).trim();
}

// ---------- Step log ----------
export function makeLog(meta) {
  const steps = [];
  return {
    meta,
    steps,
    record(article, role, step, expected, actual, pass) {
      const s = {
        article,
        role,
        step,
        expected,
        actual: String(actual).slice(0, 900),
        result: pass ? "pass" : "fail",
        at: new Date().toISOString(),
      };
      steps.push(s);
      console.log(
        `${pass ? "PASS" : "FAIL"} [${article}/${role}] ${step} :: ${s.actual.slice(0, 200)}`,
      );
      return pass;
    },
    notRun(article, role, step, expected, reason) {
      const s = {
        article,
        role,
        step,
        expected,
        actual: reason,
        result: "not-run",
        at: new Date().toISOString(),
      };
      steps.push(s);
      console.log(`NOT-RUN [${article}/${role}] ${step} :: ${reason}`);
    },
  };
}

export async function text(locator) {
  return (await locator.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
}

/** Fixture: invite and activate a "DOC-029r2 access" staff account for each role not already in fx.accounts. */
export async function ensureStaffAccounts(fx, adminPage) {
  const stamp = Date.now();
  for (const role of ["administrator", "legal_team_member"]) {
    if (fx.accounts[role]) continue;
    const short = role === "administrator" ? "admin" : "member";
    const email = `doc029r2.access.${short}.${stamp}@helix.example`;
    const displayName = `DOC-029r2 access ${role === "administrator" ? "Administrator" : "Legal Team Member"} ${stamp % 100000}`;
    const password = `Doc029-${short}-fixture-${stamp}`;
    const since = Date.now();
    const inv = await api(adminPage, "POST", "/auth/invites", { email, displayName, role });
    if (inv.status !== 201) throw new Error(`invite ${role}: ${inv.status}`);
    const m = await waitForLink(email, since, { subjectRe: /password/i });
    const c = await newContext();
    await c.page.goto(m.link);
    await c.page.getByLabel("New password").fill(password);
    await c.page.getByLabel("Confirm password").fill(password);
    await c.page.getByRole("button", { name: "Set password" }).click();
    await c.page.getByText("Password set").waitFor({ timeout: 15000 });
    await c.context.close();
    fx.accounts[role] = { email, displayName, password, userId: inv.body.user.id };
    fx.created.push(`${role} account ${email} (${displayName})`);
  }
}
