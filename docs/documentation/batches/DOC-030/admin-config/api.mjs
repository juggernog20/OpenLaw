// Shared helpers for the DOC-030 admin-config independent walkthrough.
// API calls are used only for fixture setup, API-only refusals and state reads.
// Every guide step runs in the browser. The seed demo password comes only from
// LAB_PASSWORD. Sign-in links, cookies and raw mail are never written to a file.
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "../../../../..");
export const BASE = process.env.LAB_APP_URL ?? "http://127.0.0.1:43300";
export const MAIL = process.env.LAB_MAIL_URL ?? "http://127.0.0.1:48425";
export const PROJECT = process.env.LAB_PROJECT ?? "openlaw-docs-80ceef9e-work2";
export const PASSWORD = process.env.LAB_PASSWORD;
if (!PASSWORD) throw new Error("Set LAB_PASSWORD to the seed demo password in VALIDATION.md.");
export const PW_PATH = path.join(
  ROOT,
  "node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs",
);

export const PEOPLE = {
  administrator: { email: "daniel.okafor@helix.example", name: "Daniel Okafor" },
  legal_team_member: { email: "nadia.haddad@helix.example", name: "Nadia Haddad" },
  contributor: { email: "ravi.menon@helix.example", name: "Ravi Menon" },
  business_user: { email: "jonas.weber@helix.example", name: "Jonas Weber" },
};

export const pause = (ms) => new Promise((r) => setTimeout(r, ms));
export const q = (s) => JSON.stringify(s);
export const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const flat = (s) => (s ?? "").replace(/\s+/g, " ").trim();

export async function until(fn, message, timeout = 15000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await pause(300);
  }
  throw new Error(message);
}

/** A JSON API call made with the browser context's own session. */
export async function api(page, method, url, data) {
  const res = await page.request.fetch(`${BASE}${url}`, {
    method,
    data,
    headers: { origin: BASE, ...(data ? { "content-type": "application/json" } : {}) },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status(), body };
}

export async function browserSignIn(page, person) {
  await page.goto(`${BASE}/auth/login`);
  await page.getByLabel("Email").fill(person.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth/"), { timeout: 30000 });
}

async function mailpit(p) {
  const r = await fetch(`${MAIL}${p}`);
  if (!r.ok) throw new Error(`Mailpit ${r.status} for ${p}`);
  return r.json();
}

/** Newest message to an address created after `since` whose subject matches. */
export async function waitForMail(address, subjectRe, since, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await mailpit(
      `/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}&limit=40`,
    );
    const match = (found.messages ?? []).find(
      (m) =>
        new Date(m.Created).getTime() >= since - 1500 && (!subjectRe || subjectRe.test(m.Subject)),
    );
    if (match) {
      const message = await mailpit(`/api/v1/message/${match.ID}`);
      return {
        id: match.ID,
        subject: message.Subject,
        text: message.Text ?? "",
        created: match.Created,
      };
    }
    await pause(800);
  }
  return null;
}

export function toLab(href) {
  const u = new URL(href);
  const lab = new URL(BASE);
  u.protocol = lab.protocol;
  u.host = lab.host;
  return u.toString();
}

/** Requests a fresh Portal sign-in link and opens it. 429 answers are waited out. */
export async function portalSignIn(page, email) {
  for (let attempt = 1; attempt <= 20; attempt++) {
    const since = Date.now();
    const r = await fetch(`${BASE}/api/v1/auth/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify({ email, group: "business" }),
    });
    // The shared lab limits sign-in links per address and per client; other walkers spend them too.
    if (r.status === 429 || r.status >= 500) {
      await pause(60000);
      continue;
    }
    if (r.status !== 202) throw new Error(`magic link request answered ${r.status}`);
    const mail = await waitForMail(email, /sign in/i, since);
    if (!mail) continue;
    const match = mail.text.match(/https?:\/\/[^\s<>"')\]]*magic-link\/verify[^\s<>"')\]]*/);
    if (!match) continue;
    await page.goto(toLab(match[0].replace(/[.,]+$/, "")));
    await page.waitForLoadState("networkidle").catch(() => {});
    const me = await page.request.get(`${BASE}/api/v1/me`);
    if (me.ok()) return true;
    await pause(3000);
  }
  throw new Error(`magic-link sign-in failed for ${email}`);
}
