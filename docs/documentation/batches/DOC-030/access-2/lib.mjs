// Shared helpers for the DOC-030 access-2 independent walkthrough.
// Adapted from DOC-029/access/lib-r2-1.mjs and DOC-029/inbox/api.mjs for the work2 lab at 067c1646.
// The seed password comes from LAB_PASSWORD. Links, cookies, secrets and mail bodies stay in memory.
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chromium } from "../../../../../node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs";

export const BASE = process.env.LAB_APP_URL ?? "http://127.0.0.1:43300";
export const MAIL = process.env.LAB_MAIL_URL ?? "http://127.0.0.1:48425";
export const PROJECT = process.env.LAB_PROJECT ?? "openlaw-docs-80ceef9e-work2";
export const SEED_PASSWORD = process.env.LAB_PASSWORD;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const TAG = "DOC-030 access-2";

export const SEED = {
  daniel: { email: "daniel.okafor@helix.example", role: "administrator", name: "Daniel Okafor" },
  nadia: { email: "nadia.haddad@helix.example", role: "legal_team_member", name: "Nadia Haddad" },
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

export const seen = (locator, timeout = 10000) =>
  locator
    .first()
    .waitFor({ timeout })
    .then(
      () => true,
      () => false,
    );

export async function text(locator) {
  return (await locator.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
}

/** Staff password sign-in in a new isolated context. */
export async function signIn(email, password = SEED_PASSWORD) {
  if (!password) throw new Error("LAB_PASSWORD is required");
  const c = await newContext();
  await c.page.goto(`${BASE}/auth/login`);
  await c.page.getByLabel("Email").fill(email);
  await c.page.getByLabel("Password").fill(password);
  await c.page.getByRole("button", { name: "Sign in", exact: true }).click();
  await c.page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 });
  return c;
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

/** Waits for a new message; returns {subject, link, count, text} with the link moved to the lab host. */
export async function waitForLink(email, sinceMs, { subjectRe, linkRe, timeoutMs = 30000 } = {}) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const msgs = await mailSince(email, sinceMs, subjectRe);
    if (msgs.length) {
      const m = await fetch(`${MAIL}/api/v1/message/${msgs[0].ID}`).then((x) => x.json());
      const links = (m.Text ?? "").match(/https?:\/\/[^\s)>\]"]+/g) ?? [];
      const pick = links.find((l) => (linkRe ? linkRe.test(l) : true)) ?? null;
      let link = null;
      if (pick) {
        const u = new URL(pick);
        const lab = new URL(BASE);
        u.protocol = lab.protocol;
        u.host = lab.host;
        link = u.toString();
      }
      const body = (m.Text ?? "").replace(/https?:\/\/\S+/g, "<link>");
      return { subject: m.Subject, link, count: msgs.length, text: body };
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
/** A six-digit code that is not valid in the steps around now. */
export function wrongCode(secret) {
  const valid = new Set([-1, 0, 1].map((o) => totp(secret, o)));
  let n = 123456;
  while (valid.has(String(n))) n++;
  return String(n);
}
export async function freshStep(margin = 8) {
  const left = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (left < margin) await sleep(left * 1000 + 500);
}

// ---------- API (fixture setup, a second actor's write, state reads) ----------
export async function api(page, method, path, data, multipart) {
  const opts = { method, headers: { origin: BASE }, failOnStatusCode: false };
  if (data !== undefined) opts.data = data;
  if (multipart) opts.multipart = multipart;
  const r = await page.request.fetch(`${BASE}/api/v1${path}`, opts);
  const t = await r.text();
  let body = t;
  try {
    body = JSON.parse(t);
  } catch {}
  return { status: r.status(), body };
}
export function must(r, what) {
  if (r.status >= 300)
    throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  return r.body;
}

// ---------- Lab database: state reads, and fixture preparation on this walkthrough's own rows ----------
export function sql(query) {
  return execFileSync(
    "docker",
    ["exec", `${PROJECT}-postgres-1`, "psql", "-U", "openlaw", "-d", "openlaw", "-At", "-c", query],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  ).trim();
}

/** The shared per-client-address sign-in link budget: hits in the live window, and seconds left. */
export function sharedBudget(route = "magic-link") {
  const row = sql(
    `select value||'|'||greatest(0,extract(epoch from (expires_at-now()))::int) from verifications where identifier like 'auth-request-rate:${route}:address:%' and expires_at > now() order by value::int desc limit 1`,
  );
  if (!row) return { used: 0, secondsLeft: 0 };
  const [used, secondsLeft] = row.split("|").map(Number);
  return { used, secondsLeft };
}
/** Waits until the shared address budget has room for `need` more requests. */
export async function waitForBudget(need, route = "magic-link") {
  for (;;) {
    const b = sharedBudget(route);
    if (b.used + need <= 30) return b;
    console.log(`waiting ${b.secondsLeft + 2}s for the shared ${route} budget (${b.used}/30)`);
    await sleep((b.secondsLeft + 2) * 1000);
  }
}

// ---------- Step log ----------
export function makeLog() {
  const steps = [];
  return {
    steps,
    record(article, role, step, expected, actual, pass, page) {
      const s = {
        article,
        role,
        step,
        page: page ?? null,
        expected,
        actual: String(actual).slice(0, 1400),
        result: pass ? "pass" : "fail",
        at: new Date().toISOString(),
      };
      steps.push(s);
      console.log(
        `${pass ? "PASS" : "FAIL"} [${article}/${role}] ${step} :: ${s.actual.slice(0, 300)}`,
      );
      return pass;
    },
    notRun(article, role, step, expected, reason) {
      steps.push({
        article,
        role,
        step,
        page: null,
        expected,
        actual: reason,
        result: "not-run",
        at: new Date().toISOString(),
      });
      console.log(`NOT-RUN [${article}/${role}] ${step} :: ${reason}`);
    },
  };
}
export const pathOf = (page) => {
  try {
    const u = new URL(page.url());
    return u.pathname;
  } catch {
    return null;
  }
};

/** Invites a staff account and activates it through the set-password page (fixture setup). */
export async function inviteAndActivate(adminPage, { email, displayName, role, password }) {
  const since = Date.now();
  const inv = await api(adminPage, "POST", "/auth/invites", { email, displayName, role });
  if (inv.status !== 201) throw new Error(`invite ${role}: ${inv.status}`);
  const m = await waitForLink(email, since, { subjectRe: /password/i, linkRe: /set-password/ });
  const c = await newContext();
  await c.page.goto(m.link);
  await c.page.getByLabel("New password").fill(password);
  await c.page.getByLabel("Confirm password").fill(password);
  await c.page.getByRole("button", { name: "Set password" }).click();
  await c.page.getByText("Password set").waitFor({ timeout: 15000 });
  await c.context.close();
  return { email, displayName, role, password, userId: inv.body.user.id };
}

/** Business User sign-in with a fresh Portal link read from Mailpit. */
export async function portalSignIn(email) {
  await waitForBudget(1);
  const c = await newContext();
  await c.page.goto(`${BASE}/portal/login`);
  await c.page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await c.page.getByLabel("Email").fill(email);
  const since = Date.now();
  await c.page.getByRole("button", { name: "Send link" }).click();
  await c.page.getByText("Check your email").first().waitFor({ timeout: 15000 });
  const m = await waitForLink(email, since, { subjectRe: /Sign in/i, linkRe: /magic-link/ });
  if (!m?.link) throw new Error("no Portal sign-in mail");
  await c.page.goto(m.link);
  await c.page.waitForURL(
    (u) => u.pathname.startsWith("/portal") && !u.pathname.startsWith("/portal/login"),
    { timeout: 30000 },
  );
  return c;
}
