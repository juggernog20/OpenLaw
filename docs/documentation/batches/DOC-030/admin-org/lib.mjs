// Shared helpers for the DOC-030 admin-org independent walkthrough, adapted from DOC-029/admin-org/lib.mjs.
// Credentials come from the environment and never reach the result files.
import { createRequire } from "node:module";
import { writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, "../../../../..");
const require = createRequire(
  path.join(root, "node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/package.json"),
);
export const { chromium } = require("playwright");
export const PASSWORD = process.env.LAB_PASSWORD;
if (!PASSWORD) throw new Error("LAB_PASSWORD is required");

export const articleHash = (id) =>
  createHash("sha256")
    .update(readFileSync(path.join(root, `docs/user-guides/${id}.md`)))
    .digest("hex");

export function recorder(file, meta) {
  const results = { ...meta, startedAt: new Date().toISOString(), steps: [], finishedAt: null };
  const save = () => {
    results.finishedAt = new Date().toISOString();
    // Sign-in, invitation and setup tokens never reach the log.
    writeFileSync(
      file,
      JSON.stringify(results, null, 2).replace(/token=[^&\s"\\]+/g, "token=[redacted]") + "\n",
    );
  };
  // `pg` is the Playwright page the step acts on; its address after the step
  // is recorded as the step's page.
  async function step(article, role, action, expected, fn, pg) {
    const entry = {
      article,
      scenario: article === "organisation-and-users" ? "V-C36" : "V-C37",
      role,
      method: "browser-walkthrough",
      lab: meta.labName,
      page: null,
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
      entry.actual = `Check failed: ${String(error?.message ?? error)
        .split("\n")
        .slice(0, 6)
        .join(" ")}`;
      entry.result = "fail";
    }
    entry.finishedAt = new Date().toISOString();
    try {
      if (pg && !pg.isClosed()) {
        const u = new URL(pg.url());
        entry.page = u.origin + u.pathname;
      }
    } catch {}
    console.log(
      `[${role}] ${entry.result.toUpperCase()} ${action}${entry.result === "fail" ? " :: " + entry.actual : ""}`,
    );
    save();
    return entry;
  }
  return { results, step, save };
}

export function expect(condition, message) {
  if (!condition) throw new Error(message);
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function signIn(page, base, email, password = PASSWORD) {
  await page.goto(`${base}/auth/login`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth/login"), { timeout: 20000 });
}

export async function mailSearch(mail, query) {
  const r = await fetch(`${mail}/api/v1/search?query=${encodeURIComponent(query)}`).then((x) =>
    x.json(),
  );
  return r.messages ?? [];
}
export async function mailMessage(mail, id) {
  return fetch(`${mail}/api/v1/message/${id}`).then((x) => x.json());
}
/** Waits for a message to `to` newer than `since`, returns {subject, from, link} without storing the body. */
export async function waitMail(mail, to, since, pattern, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const list = await mailSearch(mail, `to:"${to}"`);
    for (const m of list) {
      if (new Date(m.Created) < since) continue;
      const full = await mailMessage(mail, m.ID);
      const match = pattern ? full.Text.match(pattern) : null;
      if (!pattern || match)
        return {
          subject: full.Subject,
          from: full.From?.Address,
          fromName: full.From?.Name,
          link: match?.[0],
        };
    }
    await sleep(750);
  }
  return null;
}
export async function countMail(mail, to, since) {
  const list = await mailSearch(mail, `to:"${to}"`);
  return list.filter((m) => new Date(m.Created) >= since).length;
}
export async function api(page, base, method, url, body) {
  return page.evaluate(
    async ({ method, url, body }) => {
      const r = await fetch(url, {
        method,
        headers: body ? { "content-type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
        credentials: "include",
      });
      let data = null;
      try {
        data = await r.json();
      } catch {}
      return { status: r.status, data };
    },
    { method, url: `${base}${url}`, body },
  );
}
