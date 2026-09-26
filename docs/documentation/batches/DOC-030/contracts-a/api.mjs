// Shared helpers for the DOC-030 contracts-a independent walkthrough.
// Copied from the DOC-029 inbox api.mjs pattern: password sign-in, a fresh
// Portal magic link read from the lab Mailpit, and one browser context per
// identity. API calls in a context are used only for fixture setup, a second
// actor's competing write, and state reads. Every guide step runs in the browser.
// The seed demo password comes from LAB_PASSWORD. Links and cookies are never saved.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, "../../../../..");
export const BASE = process.env.LAB_APP_URL ?? "http://127.0.0.1:43300";
export const MAIL = process.env.LAB_MAIL_URL ?? "http://127.0.0.1:48425";
export const PASSWORD = process.env.LAB_PASSWORD;
if (!PASSWORD)
  throw new Error("Set LAB_PASSWORD to the seed demo password documented in VALIDATION.md.");
const PW = path.join(
  root,
  "node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs",
);
export const { chromium } = await import(PW);

export const lab = JSON.parse(
  readFileSync(path.join(root, ".documentation-labs/work2/lab.json"), "utf8"),
);
export const sha = (buf) => createHash("sha256").update(buf).digest("hex");
export const articleHash = (id) => sha(readFileSync(path.join(root, `docs/user-guides/${id}.md`)));

export const PEOPLE = {
  daniel: { email: "daniel.okafor@helix.example", name: "Daniel Okafor", role: "administrator" },
  nadia: { email: "nadia.haddad@helix.example", name: "Nadia Haddad", role: "legal_team_member" },
  priya: { email: "priya.raman@helix.example", name: "Priya Raman", role: "legal_team_member" },
  marcus: {
    email: "marcus.oyelaran@helix.example",
    name: "Marcus Oyelaran",
    role: "legal_team_member",
  },
  tom: { email: "tom.iwu@helix.example", name: "Tom Iwu", role: "legal_team_member" },
  jonas: { email: "jonas.weber@helix.example", name: "Jonas Weber", role: "business_user" },
  // Jonas Weber's sign-in link budget (3 per address in 15 minutes) is shared with
  // other walkthrough agents on this lab, so the Business approver is Lena Vogel.
  lena: { email: "lena.vogel@helix.example", name: "Lena Vogel", role: "business_user" },
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function must(condition, message) {
  if (!condition) throw new Error(message);
}
export const tidy = (v) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim() : Array.isArray(v) ? v.map(tidy) : v;
export const q = (s) => JSON.stringify(tidy(s));
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

/** A JSON log with one entry per step. Links and tokens never reach it. */
export function recorder(file, meta) {
  const results = { ...meta, startedAt: new Date().toISOString(), finishedAt: null, steps: [] };
  const save = () => {
    results.finishedAt = new Date().toISOString();
    writeFileSync(
      file,
      JSON.stringify(results, null, 2).replace(/token=[^&\s"\\]+/g, "token=[redacted]") + "\n",
    );
  };
  async function step(article, scenario, role, actors, page, action, expected, fn) {
    const entry = {
      article,
      scenario,
      role,
      method: "browser-walkthrough",
      actors,
      page,
      action,
      expected,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      actual: null,
      result: "not-run",
    };
    results.steps.push(entry);
    try {
      entry.actual = await fn();
      entry.result = "pass";
    } catch (error) {
      entry.actual = `Check did not complete: ${String(error?.message ?? error)
        .split("\n")
        .slice(0, 6)
        .join(" ")}`;
      entry.result = "fail";
    }
    entry.finishedAt = new Date().toISOString();
    console.log(
      `[${article}/${role}] ${entry.result.toUpperCase()} ${action}${entry.result === "fail" ? `\n   ${entry.actual}` : ""}`,
    );
    save();
    return entry.result === "pass";
  }
  return { results, step, save };
}

async function mailpit(p) {
  const r = await fetch(`${MAIL}${p}`);
  if (!r.ok) throw new Error(`Mailpit ${r.status} for ${p}`);
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
      if (message.Text) return { subject: message.Subject, text: message.Text };
    }
    await sleep(700);
  }
  return null;
}

async function freshMagicLink(email) {
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
  const labUrl = new URL(BASE);
  url.protocol = labUrl.protocol;
  url.host = labUrl.host;
  return url.toString();
}

let browser;
export async function launch() {
  browser = await chromium.launch();
  return browser;
}
export async function closeBrowser() {
  await browser?.close();
}

function wrap(ctx, page, person) {
  // Leaving a page with an unsaved edit asks before unloading; accept so a failed
  // step cannot pin later steps to the old page. Other dialogs are dismissed.
  page.on("dialog", (d) => (d.type() === "beforeunload" ? d.accept() : d.dismiss()));
  const api = async (method, p, data, extra = {}) => {
    const r = await page.request.fetch(`${BASE}/api/v1${p}`, {
      method,
      data,
      headers: { origin: BASE },
      failOnStatusCode: false,
      ...extra,
    });
    let json = null;
    try {
      json = await r.json();
    } catch {}
    return { status: r.status(), json };
  };
  return { ctx, page, api, ...person, displayName: person.name };
}

export async function passwordSession(person) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/auth/login`);
  await page.getByLabel("Email").fill(person.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 });
  return wrap(ctx, page, person);
}

/** A Business User Portal sign-in, retried if a parallel agent spends the link.
 * PORTAL_STATE may name a browser storage file outside docs/ (the session
 * scratchpad) so development reruns do not spend the address's link budget. */
export async function portalSession(person) {
  const stateFile = process.env.PORTAL_STATE;
  if (stateFile && existsSync(stateFile)) {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      storageState: stateFile,
    });
    const page = await ctx.newPage();
    const me = await page.request.get(`${BASE}/api/v1/me`);
    if (me.ok() && (await me.json()).user?.email === person.email) {
      await page.goto(`${BASE}/portal`);
      return wrap(ctx, page, person);
    }
    await ctx.close();
  }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  let last;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const link = await freshMagicLink(person.email);
      await page.goto(link);
      await page.waitForLoadState("networkidle").catch(() => {});
      const me = await page.request.get(`${BASE}/api/v1/me`);
      if (me.ok()) {
        if (stateFile) await ctx.storageState({ path: stateFile });
        return wrap(ctx, page, person);
      }
      last = new Error(`me answered ${me.status()}`);
    } catch (e) {
      last = e;
    }
    await sleep(1500 * attempt);
  }
  throw new Error(`magic-link sign-in failed for ${person.email}: ${last?.message}`);
}

/** A one-page PDF with fictional text, for a primary Document fixture. */
export function pdf(text) {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 14 Tf 72 720 Td (${text.replace(/[()\\]/g, "")}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
