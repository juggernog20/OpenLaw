// Shared helpers for the DOC-029 roles independent walkthrough (round 1).
// Credentials come from the environment. Sessions, links and mail bodies are never written to disk.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, "../../../../..");
const require = createRequire(path.join(root, "e2e/package.json"));
export const { chromium } = require("@playwright/test");

export const BASE = process.env.LAB_APP_URL ?? "http://127.0.0.1:23301";
export const MAIL = process.env.LAB_MAIL_URL ?? "http://127.0.0.1:23401";
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
      return { context, page };
    } catch {
      // A parallel agent may have spent a newer link; ask again.
    }
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
