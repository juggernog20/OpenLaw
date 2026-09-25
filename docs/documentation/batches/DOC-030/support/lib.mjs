// Shared helpers for the DOC-030 support independent walkthrough.
// Adapted from DOC-029/support/lib-r1.mjs and DOC-030/access-2/lib.mjs for the work2 lab at 067c1646.
// The seed password comes from LAB_PASSWORD. Magic links, cookies, API key values and mail bodies
// stay in memory. Business User browser state is cached outside docs/ (SCRATCH) so reruns do not
// spend the three-links-per-address sign-in budget.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, "../../../../..");
export const { chromium } = await import(
  path.join(root, "node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs")
);

export const LAB = process.env.LAB_NAME ?? "work2";
export const BASE = process.env.LAB_APP_URL ?? "http://127.0.0.1:43300";
export const MAIL = process.env.LAB_MAIL_URL ?? "http://127.0.0.1:48425";
export const PROJECT = process.env.LAB_PROJECT ?? "openlaw-docs-80ceef9e-work2";
export const SCRATCH = process.env.SCRATCH ?? path.join(os.tmpdir(), "doc030-support-walkthrough");
mkdirSync(SCRATCH, { recursive: true });
const PASSWORD = process.env.LAB_PASSWORD;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const VIEWPORT = { width: 1440, height: 1000 };
export const clean = (s) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
export const q = (s) => JSON.stringify(s);

let browser;
export async function launch() {
  browser ??= await chromium.launch({ headless: true });
  return browser;
}
export async function closeBrowser() {
  await browser?.close();
  browser = undefined;
}

export function withApi(context, page) {
  const api = async (method, url, body) => {
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
  };
  return { context, page, api };
}

export async function newContext(extra = {}) {
  const b = await launch();
  const context = await b.newContext({ viewport: VIEWPORT, acceptDownloads: true, ...extra });
  const page = await context.newPage();
  return { context, page };
}

/** Staff password sign-in in its own browser context. */
export async function passwordSignIn(email) {
  if (!PASSWORD) throw new Error("LAB_PASSWORD is required");
  const { context, page } = await newContext();
  await page.goto(`${BASE}/auth/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 30000 });
  return withApi(context, page);
}

// ---------- the shared sign-in link budget ----------
export function sql(query) {
  return execFileSync(
    "docker",
    ["exec", `${PROJECT}-postgres-1`, "psql", "-U", "openlaw", "-d", "openlaw", "-At", "-c", query],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  ).trim();
}
export function sharedBudget() {
  const row = sql(
    `select value||'|'||greatest(0,extract(epoch from (expires_at-now()))::int) from verifications where identifier like 'auth-request-rate:magic-link:address:%' and expires_at > now() order by value::int desc limit 1`,
  );
  if (!row) return { used: 0, secondsLeft: 0 };
  const [used, secondsLeft] = row.split("|").map(Number);
  return { used, secondsLeft };
}
export async function waitForBudget(need) {
  for (;;) {
    const b = sharedBudget();
    if (b.used + need <= 30) return b;
    console.log(`waiting ${b.secondsLeft + 2}s for the shared magic-link budget (${b.used}/30)`);
    await sleep((b.secondsLeft + 2) * 1000);
  }
}

/** Ask for a Portal sign-in link on the Portal sign-in page; returns {href, subject} kept in memory. */
export async function requestLink(page, email) {
  await waitForBudget(1);
  await page.goto(`${BASE}/portal/login`);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.getByLabel("Email").fill(email);
  const since = Date.now() - 1500;
  await page.getByRole("button", { name: "Send link" }).click();
  await page.getByText("Check your email").first().waitFor({ timeout: 15000 });
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const search = await fetch(
      `${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=20`,
    ).then((r) => r.json());
    for (const m of search.messages ?? []) {
      if (new Date(m.Created).getTime() < since) continue;
      const message = await fetch(`${MAIL}/api/v1/message/${m.ID}`).then((r) => r.json());
      const match = message.Text?.match(/https?:\/\/[^\s)>\]"]+magic-link[^\s)>\]"]*/);
      if (match) {
        const url = new URL(match[0]);
        const lab = new URL(BASE);
        url.protocol = lab.protocol;
        url.host = lab.host;
        return { href: url.toString(), subject: message.Subject, messageId: m.ID };
      }
    }
  }
  throw new Error(`no sign-in link mail for ${email}`);
}

/**
 * Business User session. Reuses a cached browser state from SCRATCH when it still opens the
 * Portal; otherwise signs in with a fresh link from the lab Mailpit and caches the state.
 */
export async function portalSession(email, cacheName) {
  const statePath = path.join(SCRATCH, `${cacheName}.state.json`);
  if (existsSync(statePath)) {
    const { context, page } = await newContext({ storageState: statePath });
    await page.goto(`${BASE}/portal`);
    await page.waitForLoadState("networkidle").catch(() => {});
    if (new URL(page.url()).pathname.startsWith("/portal") && !page.url().includes("/login"))
      return { ...withApi(context, page), fresh: false };
    await context.close();
  }
  const { context, page } = await newContext();
  const { href } = await requestLink(page, email);
  await page.goto(href);
  await page.waitForURL(
    (u) => u.pathname.startsWith("/portal") && !u.pathname.startsWith("/portal/login"),
    { timeout: 30000 },
  );
  await context.storageState({ path: statePath });
  return { ...withApi(context, page), fresh: true };
}

export async function uploadFile(
  page,
  apiPath,
  { name, buffer, mimeType = "application/octet-stream", fields = {} },
) {
  const res = await page.request.post(`${BASE}/api/v1${apiPath}`, {
    headers: { origin: BASE },
    multipart: { ...fields, file: { name, mimeType, buffer } },
    failOnStatusCode: false,
    timeout: 120000,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status(), json };
}

export function must(r, what) {
  if (r.status >= 300)
    throw new Error(`${what}: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json;
}

/** One Streamable HTTP JSON-RPC call to the lab's MCP address with an API key header. */
export async function mcpCall(key, method, params, id = 1) {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(key ? { "x-api-key": key } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await res.text();
  let body = null;
  const data = text.match(/^data: (.*)$/m)?.[1] ?? text;
  try {
    body = JSON.parse(data);
  } catch {
    body = text.slice(0, 300);
  }
  return { status: res.status, body };
}
