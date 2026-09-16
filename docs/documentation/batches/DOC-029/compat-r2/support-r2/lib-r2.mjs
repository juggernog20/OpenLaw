// Shared helpers for the DOC-029 support independent walkthrough (round 1).
// The seed password comes from the environment. Sessions, links and mail bodies are never written to disk.
import path from "node:path";
import { fileURLToPath } from "node:url";

export const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, "../../../../../..");
export const { chromium } = await import(
  path.join(root, "node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs")
);

export const BASE = process.env.LAB_APP_URL ?? "http://127.0.0.1:23300";
export const MAIL = process.env.LAB_MAIL_URL ?? "http://127.0.0.1:23400";
const PASSWORD = process.env.LAB_PASSWORD;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const VIEWPORT = { width: 1280, height: 1000 };

function withApi(context, page) {
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

export async function passwordSignIn(browser, email) {
  if (!PASSWORD) throw new Error("LAB_PASSWORD is required");
  const context = await browser.newContext({ viewport: VIEWPORT });
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
  return withApi(context, page);
}

export async function magicSignIn(browser, email) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  for (let attempt = 0; attempt < 4; attempt++) {
    const since = Date.now() - 2000;
    await page.goto(`${BASE}/auth/login`);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await page.getByLabel("Email").fill(email);
    await page
      .getByRole("button", { name: /Send|Email me/ })
      .last()
      .click();
    let href = null;
    for (let i = 0; i < 40 && !href; i++) {
      await sleep(750);
      const search = await fetch(
        `${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
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
      return withApi(context, page);
    } catch {
      // A parallel agent may have spent a newer link; ask again.
    }
  }
  throw new Error(`magic-link sign-in failed for ${email}`);
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
function ordinal(d) {
  const s = ["th", "st", "nd", "rd"];
  const v = d % 100;
  return d + (s[(v - 20) % 10] || s[v] || s[0]);
}
export function isoPlusDays(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Pick a date in the record's calendar picker by its month/year dropdowns and the day button. */
export async function pickDate(page, triggerName, iso) {
  const [y, m, d] = iso.split("-").map(Number);
  await page.getByRole("button", { name: triggerName, exact: true }).click();
  const cal = page.getByRole("dialog", { name: "Choose a date" });
  await cal.getByRole("combobox", { name: "Year" }).selectOption(String(y));
  await cal.getByRole("combobox", { name: "Month" }).selectOption(String(m - 1));
  const label = new RegExp(`${MONTHS[m - 1]} ${ordinal(d)}, ${y}$`);
  await cal.getByRole("grid").getByRole("button", { name: label }).click();
  await cal.waitFor({ state: "hidden" });
}

/** Run an action and wait for the matching API response; returns its status. */
export async function withResponse(page, match, action, timeout = 15000) {
  const wait = page.waitForResponse((r) => r.url().includes("/api/v1/") && match(r), { timeout });
  await action();
  const res = await wait;
  return res.status();
}

export const isPatchOf = (num) => (r) =>
  r.request().method() === "PATCH" && new URL(r.url()).pathname === `/api/v1/contracts/${num}`;

export function expectThat(condition, message) {
  if (!condition) throw new Error(message);
}

export async function text(locator) {
  return ((await locator.textContent()) ?? "").replace(/\s+/g, " ").trim();
}

/** Open the Contracts list on its Default view; returns the view name that was selected before. */
export async function openContractsDefaultView(page) {
  await page.goto(`${BASE}/contracts`);
  await page.getByRole("heading", { name: "Contracts", level: 1 }).waitFor();
  await sleep(1500);
  const viewButton = page.getByRole("region", { name: "Contracts" }).getByRole("button").first();
  const before = await text(viewButton);
  if (before !== "Default view") {
    await viewButton.click();
    await page.getByText("Default view", { exact: true }).last().click();
    await sleep(1500);
  }
  return { before, now: await text(viewButton) };
}

export async function selectContractsView(page, name) {
  await page.goto(`${BASE}/contracts`);
  await page.getByRole("heading", { name: "Contracts", level: 1 }).waitFor();
  await sleep(1200);
  const viewButton = page.getByRole("region", { name: "Contracts" }).getByRole("button").first();
  if ((await text(viewButton)) === name) return name;
  await viewButton.click();
  await page.getByText(name, { exact: true }).last().click();
  await sleep(1000);
  return text(viewButton);
}

/** Upload one file as multipart to an API path; returns { status, json }. */
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
