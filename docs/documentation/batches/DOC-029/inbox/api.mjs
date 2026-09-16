// Shared helpers for the DOC-029 inbox independent walkthrough (round 1).
// API sessions are used only for fixture setup, the second legal session's
// competing writes, and state reads. Every guide step runs in the browser.
// The seed demo password is the only credential; links and cookies are never saved.
import { Session } from "../../../../../scripts/seed/client.mjs";

export const BASE = process.env.LAB_APP_URL ?? "http://127.0.0.1:23301";
export const MAIL = process.env.LAB_MAIL_URL ?? "http://127.0.0.1:23401";
export const PASSWORD = process.env.LAB_PASSWORD;
if (!PASSWORD)
  throw new Error("Set LAB_PASSWORD to the seed demo password documented in VALIDATION.md.");
export const PW_PATH =
  "/home/blairwentworth/.cache/openlaw-docs-status/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs";

export const PEOPLE = {
  administrator: { email: "daniel.okafor@helix.example", name: "Daniel Okafor" },
  legal_team_member: { email: "nadia.haddad@helix.example", name: "Nadia Haddad" },
  contributor: { email: "ravi.menon@helix.example", name: "Ravi Menon" },
  business_user: { email: "jonas.weber@helix.example", name: "Jonas Weber" },
  second_business_user: { email: "amara.nwosu@helix.example", name: "Amara Nwosu" },
};

export const pause = (ms) => new Promise((r) => setTimeout(r, ms));

export async function apiSignIn(email) {
  const s = new Session(email, BASE);
  await s.request("POST", "/api/auth/sign-in/email", {
    json: { email, password: PASSWORD },
    headers: { origin: BASE },
  });
  return s;
}

async function mailpit(path) {
  const r = await fetch(`${MAIL}${path}`);
  if (!r.ok) throw new Error(`Mailpit ${r.status} for ${path}`);
  return r.json();
}

/** Newest message to an address created after `since` whose subject matches. */
export async function waitForMail(address, subjectRe, since, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await mailpit(
      `/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}&limit=30`,
    );
    const match = (found.messages ?? []).find(
      (m) =>
        new Date(m.Created).getTime() >= since - 1500 && (!subjectRe || subjectRe.test(m.Subject)),
    );
    if (match) {
      const message = await mailpit(`/api/v1/message/${match.ID}`);
      if (message.Text)
        return {
          id: match.ID,
          subject: message.Subject,
          text: message.Text,
          created: match.Created,
        };
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
export async function portalSignIn(page, email) {
  let last;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const link = await freshMagicLink(email);
      await page.goto(link);
      await page.waitForLoadState("networkidle").catch(() => {});
      const me = await page.request.get(`${BASE}/api/v1/me`);
      if (me.ok()) return true;
      last = new Error(`me answered ${me.status()}`);
    } catch (e) {
      last = e;
    }
    await pause(1500 * attempt);
  }
  throw new Error(`magic-link sign-in failed for ${email}: ${last?.message}`);
}

export async function browserSignIn(page, email) {
  await page.goto(`${BASE}/auth/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth/login"), { timeout: 20000 });
}
