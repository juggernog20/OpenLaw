// Shared helpers for the DOC-030 matters independent walkthrough.
// Credentials come from the environment. Sessions, links and mail bodies are never written to disk.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, "../../../../..");
const require = createRequire(import.meta.url);
export const { chromium } = require(
  path.join(root, "node_modules/.pnpm/playwright@1.63.0/node_modules/playwright"),
);

export const BASE = process.env.LAB_APP_URL ?? "http://127.0.0.1:43300";
export const MAIL = process.env.LAB_MAIL_URL ?? "http://127.0.0.1:48425";
export const PASSWORD = process.env.LAB_PASSWORD;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function passwordSignIn(browser, email) {
  if (!PASSWORD) throw new Error("LAB_PASSWORD is required");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/auth/login`);
  const withPassword = page.getByRole("button", {
    name: /Sign in with a password|Administrator sign-in/,
  });
  if (await withPassword.isVisible().catch(() => false)) await withPassword.click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 30000 });
  return { context, page };
}

export async function magicSignIn(browser, email) {
  // BU_STATE names a file outside docs/ (the session scratchpad) where a signed-in Business
  // User context is kept between runs, so reruns do not spend the shared magic-link budget.
  const statePath = process.env.BU_STATE;
  if (statePath && existsSync(statePath)) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      storageState: statePath,
    });
    const page = await context.newPage();
    const session = await page.request
      .get(`${BASE}/api/auth/get-session`, { failOnStatusCode: false })
      .then((r) => r.json().catch(() => null));
    if (session?.user?.email === email) {
      await page.goto(`${BASE}/portal`);
      return { context, page };
    }
    await context.close();
  }
  const signed = await magicLinkSignIn(browser, email);
  if (statePath) await signed.context.storageState({ path: statePath });
  return signed;
}

async function magicLinkSignIn(browser, email) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  // The API allows three link requests per address and thirty per client address in 15 minutes,
  // and every walkthrough agent on the shared lab signs in from 127.0.0.1. Ask once, and on a
  // 429 wait a minute before asking again rather than spending more of the shared budget.
  const deadline = Date.now() + 17 * 60_000;
  while (Date.now() < deadline) {
    const since = Date.now() - 1000;
    await page.goto(`${BASE}/auth/login`);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await page.getByLabel("Email").fill(email);
    const sent = page.waitForResponse(
      (r) => r.request().method() === "POST" && /magic-link/.test(new URL(r.url()).pathname),
    );
    await page
      .getByRole("button", { name: /Send|Email me/ })
      .last()
      .click();
    const status = (await sent).status();
    if (status === 429) {
      console.log(`magic link for ${email}: 429, waiting 60s`);
      await sleep(60_000);
      continue;
    }
    let hrefs = [];
    for (let i = 0; i < 80 && !hrefs.length; i++) {
      await sleep(250);
      const search = await fetch(
        `${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}" subject:"Sign in"`)}`,
      ).then((r) => r.json());
      for (const m of search.messages ?? []) {
        if (new Date(m.Created).getTime() < since) continue;
        const message = await fetch(`${MAIL}/api/v1/message/${m.ID}`).then((r) => r.json());
        const match = message.Text?.match(/https?:\/\/[^\s)>\]]+magic[^\s)>\]]*/i);
        if (match) {
          const url = new URL(match[0]);
          const lab = new URL(BASE);
          url.protocol = lab.protocol;
          url.host = lab.host;
          hrefs.push(url.toString());
        }
      }
    }
    for (const href of hrefs) {
      await page.goto(href);
      await page.waitForLoadState("networkidle").catch(() => {});
      const where = new URL(page.url());
      const session = await page.request
        .get(`${BASE}/api/auth/get-session`, { failOnStatusCode: false })
        .then((r) => r.json().catch(() => null));
      if (where.pathname.startsWith("/portal") && !where.pathname.includes("login") && session?.user)
        return { context, page };
    }
    await sleep(30_000);
  }
  throw new Error(`magic-link sign-in failed for ${email}`);
}

export async function api(page, method, url, body) {
  const res = await page.request.fetch(`${BASE}/api/v1${url}`, {
    method,
    data: body === undefined ? undefined : body,
    headers: { origin: BASE },
    failOnStatusCode: false,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status(), json };
}

export function expectThat(condition, message) {
  if (!condition) throw new Error(message);
}
export const q = (value) => JSON.stringify(value);

/** Returns the Matters this reader can list whose title matches exactly, closed and archived included. */
export async function findMatters(page, title) {
  const found = [];
  let cursor = null;
  for (let i = 0; i < 50; i++) {
    const r = await api(
      page,
      "GET",
      `/matters?includeClosed=true&includeArchived=true${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    found.push(...(r.json?.matters ?? []).filter((m) => m.title === title));
    cursor = r.json?.nextCursor;
    if (!cursor) break;
  }
  return found;
}
/** Lists the default Matters view rows (open, unarchived) or with the given flags. */
export async function listTitles(page, query = "") {
  const titles = [];
  let cursor = null;
  for (let i = 0; i < 50; i++) {
    const r = await api(
      page,
      "GET",
      `/matters?${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    titles.push(...(r.json?.matters ?? []).map((m) => m.title));
    cursor = r.json?.nextCursor;
    if (!cursor) break;
  }
  return titles;
}
export async function matterByNumber(page, number) {
  return (await api(page, "GET", `/matters/${number}`)).json;
}
/** Waits for the next PATCH to the Matter and returns its status. */
export async function patchAfter(page, number, action) {
  const wait = page.waitForResponse(
    (r) =>
      r.request().method() === "PATCH" && new URL(r.url()).pathname === `/api/v1/matters/${number}`,
    { timeout: 15000 },
  );
  await action();
  const res = await wait;
  return res.status();
}
export function utcDatePlus(iso, days) {
  const d = new Date(iso);
  const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return new Date(base + days * 86400000).toISOString().slice(0, 10);
}
