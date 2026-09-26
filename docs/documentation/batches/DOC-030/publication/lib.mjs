// Shared helpers for the DOC-030 publication review (V-HELP and V-OFFLINE).
// This is an agent check. Credentials come from the environment; links and cookies stay in memory.
import { chromium } from "../../../../../node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { compileWorkspace } from "../../../../../scripts/documentation/build.mjs";
import { searchDocumentation } from "../../../../../scripts/documentation/reader.mjs";

export { chromium };
export const BASE = process.env.LAB_APP_URL ?? "http://127.0.0.1:43310";
export const MAIL = process.env.LAB_MAIL_URL ?? "http://127.0.0.1:48430";
export const REVIEWER = "DOC-030 independent publication reviewer agent";
const PASSWORD = process.env.LAB_PASSWORD;

export const PEOPLE = {
  administrator: { email: "daniel.okafor@helix.example" },
  legal_team_member: { email: "nadia.haddad@helix.example" },
  business_user: { email: "jonas.weber@helix.example" },
};

/** The same compilation the image ran (apps/web/vite-documentation.ts compiles with development: true); used only to state the expected reader sets. */
export const bundle = compileWorkspace({ development: true }).bundle;
export function expectedIds(destination, audience = "") {
  return searchDocumentation(bundle, { destination, audience }).map((a) => a.id);
}
/** Guide count for this edition, read from the catalog rather than copied from DOC-029. */
const catalog = JSON.parse(
  readFileSync(new URL("../../../articles.json", import.meta.url), "utf8"),
);
export const TOTAL = (catalog.articles ?? catalog).length;
export const titleOf = (id) => bundle.articles.find((a) => a.id === id)?.title;

/** Everything except the loopback lab is refused, so no reading path can use the internet. */
export function isLocal(url) {
  if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("about:")) return true;
  const lab = new URL(BASE);
  try {
    const u = new URL(url);
    return u.protocol === "file:" || u.host === lab.host;
  } catch {
    return false;
  }
}

let browser;
export async function launch(options = {}) {
  browser ??= await chromium.launch({ headless: true, ...options });
  return browser;
}

/** A context with internet access blocked and every request recorded as path only. */
export async function guardedContext(options = {}, existing) {
  const context =
    existing ??
    (await (
      await launch()
    ).newContext({
      baseURL: BASE,
      viewport: { width: 1280, height: 900 },
      ...options,
    }));
  const log = { api: [], blocked: [], all: 0 };
  await context.route("**/*", (route) => {
    const url = route.request().url();
    log.all++;
    if (!isLocal(url)) {
      log.blocked.push(new URL(url).origin);
      return route.abort("internetdisconnected");
    }
    const u = new URL(url);
    if (u.pathname.startsWith("/api/")) log.api.push(`${route.request().method()} ${u.pathname}`);
    return route.continue();
  });
  return { context, log };
}

export async function staffSession(role, guarded) {
  if (!PASSWORD) throw new Error("LAB_PASSWORD is required");
  const { context, log } = guarded ?? (await guardedContext());
  const page = await context.newPage();
  await page.goto(`${BASE}/auth/login`);
  await page.getByRole("heading").first().waitFor({ timeout: 20000 });
  const pw = page.getByRole("button", { name: "Sign in with a password" });
  if (await pw.isVisible().catch(() => false)) await pw.click();
  await page.getByLabel("Email").fill(PEOPLE[role].email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 });
  return { context, page, log };
}

async function newestMailId(email) {
  const r = await fetch(
    `${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=1`,
  ).then((x) => x.json());
  return r.messages?.[0]?.ID ?? null;
}

export async function portalSession(guarded) {
  const email = PEOPLE.business_user.email;
  const { context, log } = guarded ?? (await guardedContext());
  const page = await context.newPage();
  const before = await newestMailId(email);
  await page.goto(`${BASE}/portal/login`);
  const magic = page.getByRole("button", { name: "Email me a sign-in link" });
  await magic.waitFor({ timeout: 20000 });
  await magic.click();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send link" }).click();
  await page.getByText("Check your email").first().waitFor({ timeout: 15000 });
  let link = null;
  for (let i = 0; i < 60 && !link; i++) {
    const id = await newestMailId(email);
    if (id && id !== before) {
      const m = await fetch(`${MAIL}/api/v1/message/${id}`).then((x) => x.json());
      const match = m.Text.match(/https?:\/\/[^\s)\]]+magic-link\/verify[^\s)\]]*/);
      if (match) {
        const u = new URL(match[0]);
        const lab = new URL(BASE);
        u.protocol = lab.protocol;
        u.host = lab.host;
        link = u.toString();
      }
    }
    if (!link) await new Promise((r) => setTimeout(r, 500));
  }
  if (!link) throw new Error("no fresh sign-in mail for the Business User");
  await page.goto(link);
  link = null;
  await page.waitForURL(
    (u) => u.pathname.startsWith("/portal") && !u.pathname.startsWith("/portal/login"),
    { timeout: 30000 },
  );
  return { context, page, log };
}

/** Records one observation. A thrown error becomes a failed step with its message. */
export function recorder(meta) {
  const record = { ...meta, reviewer: REVIEWER, reviewerKind: "agent", steps: [] };
  record.startedAt = new Date().toISOString();
  return {
    record,
    async step(role, action, fn) {
      const startedAt = new Date().toISOString();
      let actual, result;
      try {
        actual = await fn();
        result = "pass";
      } catch (error) {
        actual = {
          error: String(error?.message ?? error)
            .split("\n")[0]
            .slice(0, 400),
        };
        result = "fail";
      }
      record.steps.push({
        role,
        method: "browser-walkthrough",
        action,
        startedAt,
        at: new Date().toISOString(),
        result,
        actual,
      });
      console.log(
        `${result.toUpperCase()} ${role}: ${action}${result === "fail" ? ` ${JSON.stringify(actual)}` : ""}`,
      );
      return actual;
    },
    save(path) {
      record.completedAt = new Date().toISOString();
      record.passed = record.steps.every((s) => s.result === "pass");
      writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
      return record.passed;
    },
  };
}

export function check(condition, message) {
  if (!condition) throw new Error(message);
}

export async function close() {
  await browser?.close();
  browser = undefined;
}
