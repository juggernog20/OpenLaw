// Shared helpers for the DOC-030 contracts-b independent walkthrough.
// Adapted from DOC-029 contracts-b/lib-r1.mjs and analysis-standin/harness-r1.mjs.
// The seed password and the stand-in keys come only from the environment.
// Sessions, links, cookies and mail bodies are never written to disk.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, "../../../../..");
export const { chromium } = await import(
  path.join(root, "node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs")
);

export const LAB = JSON.parse(
  readFileSync(path.join(root, ".documentation-labs/work2/lab.json"), "utf8"),
);
export const BASE = process.env.LAB_APP_URL ?? LAB.appUrl;
export const MAIL = process.env.LAB_MAIL_URL ?? LAB.mailUrl;
const PASSWORD = process.env.LAB_PASSWORD;
export const STANDIN = process.env.STANDIN_CONTROL_URL;
const CONTROL_TOKEN = process.env.STANDIN_CONTROL_TOKEN;
export const STANDIN_KEY = process.env.STANDIN_API_KEY;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const VIEWPORT = { width: 1280, height: 1600 };
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const q = JSON.stringify;

export const PEOPLE = {
  administrator: { email: "daniel.okafor@helix.example", name: "Daniel Okafor" },
  legal_team_member: { email: "nadia.haddad@helix.example", name: "Nadia Haddad" },
  reader: { email: "priya.raman@helix.example", name: "Priya Raman" },
  business_user: { email: "jonas.weber@helix.example", name: "Jonas Weber" },
};

export function expectThat(condition, message) {
  if (!condition) throw new Error(message);
}
export async function until(fn, message, timeout = 60000, every = 500) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const last = await fn();
    if (last) return last;
    await sleep(every);
  }
  throw new Error(`timed out: ${message}`);
}
export async function text(locator) {
  return ((await locator.textContent()) ?? "").replace(/\s+/g, " ").trim();
}

function withApi(context, page, role, person) {
  const api = async (method, url, body, extra = {}) => {
    const res = await context.request.fetch(`${BASE}/api/v1${url}`, {
      method,
      data: body === undefined ? undefined : body,
      headers: { origin: BASE },
      failOnStatusCode: false,
      ...extra,
    });
    const raw = await res.text();
    let json = null;
    try {
      json = JSON.parse(raw);
    } catch {}
    return { status: res.status(), json, text: raw };
  };
  api.upload = (url, file, fields = {}) =>
    api("POST", url, undefined, {
      multipart: { ...fields, file: { name: file.name, mimeType: file.mimeType, buffer: file.buffer } },
    });
  api.ok = async (method, url, body) => {
    const r = await api(method, url, body);
    if (r.status >= 300) throw new Error(`${method} ${url} answered ${r.status}: ${r.text.slice(0, 300)}`);
    return r.json;
  };
  return { context, page, api, role, person };
}

export async function passwordSignIn(browser, role) {
  if (!PASSWORD) throw new Error("LAB_PASSWORD is required");
  const person = PEOPLE[role];
  const context = await browser.newContext({ viewport: VIEWPORT, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  await page.goto(`${BASE}/auth/login`);
  const withPassword = page.getByRole("button", {
    name: /Sign in with a password|Administrator sign-in/,
  });
  if (await withPassword.isVisible().catch(() => false)) await withPassword.click();
  await page.getByLabel("Email").fill(person.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 30000 });
  return withApi(context, page, role, person);
}

export async function magicSignIn(browser, role) {
  const person = PEOPLE[role];
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  // The lab is shared: other agents spend the per-client sign-in link budget
  // (thirty per client address in 15 minutes). On 429 wait a minute and ask again.
  let limited = 0;
  for (let attempt = 0; attempt < 4; ) {
    const since = Date.now() - 2000;
    const res = await context.request.post(`${BASE}/api/v1/auth/magic-link`, {
      headers: { origin: BASE },
      data: { email: person.email, group: "business" },
      failOnStatusCode: false,
    });
    if (res.status() === 429 && limited < 25) {
      limited++;
      console.log(`magic link for ${person.email}: 429, waiting 60 s (${limited})`);
      await sleep(60000);
      continue;
    }
    attempt++;
    if (res.status() >= 300) {
      await sleep(3000);
      continue;
    }
    let href = null;
    for (let i = 0; i < 40 && !href; i++) {
      await sleep(750);
      const search = await fetch(
        `${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${person.email}"`)}`,
      ).then((r) => r.json());
      for (const m of search.messages ?? []) {
        if (new Date(m.Created).getTime() < since) continue;
        const message = await fetch(`${MAIL}/api/v1/message/${m.ID}`).then((r) => r.json());
        const match =
          message.Text?.match(/https?:\/\/[^\s)>\]]+magic[^\s)>\]]*/i) ??
          message.Text?.match(/https?:\/\/[^\s)>\]]+token=[^\s)>\]]*/);
        if (match) {
          const url = new URL(match[0]);
          const lab = new URL(BASE);
          url.protocol = lab.protocol;
          url.host = lab.host;
          href = url.toString();
          break;
        }
      }
    }
    if (!href) continue;
    await page.goto(href);
    try {
      await page.waitForURL((url) => url.pathname.startsWith("/portal"), { timeout: 20000 });
      return withApi(context, page, role, person);
    } catch {
      // A parallel agent may have spent a newer link; ask again.
    }
  }
  throw new Error(`magic-link sign-in failed for ${person.email}`);
}

export function isoPlusDays(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function withResponse(page, match, action, timeout = 15000) {
  const wait = page.waitForResponse((r) => r.url().includes("/api/v1/") && match(r), { timeout });
  wait.catch(() => {});
  await action();
  const res = await wait;
  return res.status();
}

export async function standin(pathname, body) {
  const response = await fetch(`${STANDIN}${pathname}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "x-control-token": CONTROL_TOKEN, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`stand-in control ${pathname} answered ${response.status}`);
  return response.json();
}

/** A text PDF made by headless Chromium from simple HTML paragraphs. */
export async function makePdf(browser, name, paragraphs) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const html = `<!doctype html><html><head><title>${name}</title></head><body style="font-family: serif; font-size: 13pt">${paragraphs.map((p) => `<p>${p}</p>`).join("")}</body></html>`;
  await page.setContent(html);
  const buffer = await page.pdf({ format: "A4" });
  await context.close();
  return { name, mimeType: "application/pdf", buffer };
}

export function makeRecorder(results, save) {
  return (article, scenario, role) =>
    async (action, expected, fn, { page } = {}) => {
      const entry = {
        article,
        scenario,
        role,
        method: "browser-walkthrough",
        step: action,
        page: null,
        expected,
        actual: null,
        result: "not-run",
        startedAt: new Date().toISOString(),
        at: null,
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
        console.error(`[${scenario} ${role}] FAIL ${action}: ${entry.actual}`);
      }
      try {
        if (page) entry.page = new URL(page.url()).pathname;
      } catch {}
      entry.at = new Date().toISOString();
      console.log(`[${scenario} ${role}] ${entry.result.toUpperCase()} ${action}`);
      save();
      return entry;
    };
}
