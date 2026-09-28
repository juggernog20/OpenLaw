// DOC-032 bridge compatibility review: sign-in smoke per role on the candidate lab.
// Written by the DOC-032 compatibility reviewer (bridge). It is not a copy of a guide walkthrough.
// It proves that each role still signs in on the release candidate ad345da5 and that every module
// list opens without the error boundary, and it records the version the running API reports.
//   Administrator      Daniel Okafor, password sign-in at /auth/login
//   Legal Team Member  Nadia Haddad, password sign-in at /auth/login
//   Contributor        Ravi Menon, a Business User on record teams, fresh sign-in link from /portal/login
//   Business User      Lena Vogel, fresh sign-in link from /portal/login
// Sign-in links are read from the lab's Mailpit and used once. The log keeps subjects, senders and
// the transfer encoding of the message parts, never a link, a cookie or a message body.
// Run from the worktree root inside a network namespace that forwards only the lab's ports:
//   LAB_PASSWORD=... pasta --config-net -T 43390,48490 -- \
//     node docs/documentation/batches/DOC-032/bridge/smoke.mjs
// LAB_NAME selects another lab manifest (default final).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const PASSWORD = process.env.LAB_PASSWORD;
if (!PASSWORD) throw new Error("LAB_PASSWORD is required");
const { chromium } = await import(
  path.join(root, "node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs")
);
const LAB_NAME = process.env.LAB_NAME ?? "final";
const lab = JSON.parse(
  readFileSync(path.join(root, `.documentation-labs/${LAB_NAME}/lab.json`), "utf8"),
);
const BASE = lab.appUrl;
const MAIL = lab.mailUrl;
const OUT = path.join(here, "smoke.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = {
  kind: "bridge-sign-in-smoke",
  task: "DOC-032",
  issue: 1194,
  reviewer: "DOC-032 compatibility reviewer (bridge)",
  reviewerKind: "agent",
  lab: LAB_NAME,
  project: lab.project,
  sourceCommit: lab.sourceCommit,
  buildId: `app ${lab.appImageId}; engine ${lab.engineImageId}`,
  seed: lab.seed,
  appUrl: BASE,
  mailUrl: MAIL,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  steps: [],
};
const save = () => {
  results.finishedAt = new Date().toISOString();
  writeFileSync(OUT, JSON.stringify(results, null, 2) + "\n");
};
async function step(role, action, expected, fn) {
  const entry = {
    role,
    action,
    expected,
    startedAt: new Date().toISOString(),
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
      .slice(0, 4)
      .join(" ")}`;
    entry.result = "fail";
  }
  entry.finishedAt = new Date().toISOString();
  console.log(`[${role}] ${entry.result.toUpperCase()} ${action}`);
  save();
}
const must = (c, m) => {
  if (!c) throw new Error(m);
};

const STAFF_LISTS = [
  "/",
  "/home/tasks",
  "/inbox",
  "/contracts",
  "/matters",
  "/documents",
  "/entities",
  "/knowledge",
  "/auto-docs",
];
const PORTAL_LISTS = ["/portal", "/portal/contracts", "/portal/matters", "/portal/approvals"];

async function openLists(page, lists) {
  const seen = [];
  for (const p of lists) {
    await page.goto(`${BASE}${p}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    const h1 = page.locator("h1").first();
    await h1.waitFor({ timeout: 20000 });
    const heading = (await h1.innerText()).replace(/\s+/g, " ").trim();
    const body = await page.locator("body").innerText();
    must(!/Something went wrong/.test(body), `${p} shows the error boundary`);
    must(
      new URL(page.url()).pathname.replace(/\/+$/, "") === p.replace(/\/+$/, "") || p === "/",
      `${p} redirected to ${new URL(page.url()).pathname}`,
    );
    seen.push(`${p} "${heading}"`);
  }
  return seen;
}

async function passwordSignIn(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/auth/login`);
  await page.getByRole("heading").first().waitFor({ timeout: 20000 });
  const withPassword = page.getByRole("button", { name: /Sign in with a password/ });
  if (await withPassword.isVisible().catch(() => false)) await withPassword.click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 });
  const me = await (await page.request.get(`${BASE}/api/v1/me`)).json();
  return { ctx, page, me };
}

async function linkSignIn(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 1000 } });
  const page = await ctx.newPage();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const since = Date.now() - 1500;
    await page.goto(`${BASE}/portal/login`);
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
      await sleep(60_000);
      continue;
    }
    for (let i = 0; i < 90; i++) {
      await sleep(500);
      const search = await fetch(
        `${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
      ).then((r) => r.json());
      for (const m of search.messages ?? []) {
        if (new Date(m.Created).getTime() < since) continue;
        const message = await fetch(`${MAIL}/api/v1/message/${m.ID}`).then((r) => r.json());
        const match = message.Text?.match(/https?:\/\/[^\s)>\]]+magic[^\s)>\]]*/i);
        if (!match) continue;
        const raw = await fetch(`${MAIL}/api/v1/message/${m.ID}/raw`).then((r) => r.text());
        const encodings = [
          ...new Set(
            [...raw.matchAll(/^Content-Transfer-Encoding:\s*(\S+)/gim)].map((x) =>
              x[1].toLowerCase(),
            ),
          ),
        ];
        const htmlLink = (message.HTML ?? "").includes(new URL(match[0]).pathname);
        const url = new URL(match[0].replace(/[.,]+$/, ""));
        const labUrl = new URL(BASE);
        const linkOrigin = url.origin;
        url.protocol = labUrl.protocol;
        url.host = labUrl.host;
        await page.goto(url.toString());
        await page.waitForLoadState("networkidle").catch(() => {});
        const me = await page.request.get(`${BASE}/api/v1/me`, { failOnStatusCode: false });
        must(me.ok(), `the sign-in link did not sign ${email} in (/api/v1/me ${me.status()})`);
        return {
          ctx,
          page,
          me: await me.json(),
          mail: {
            subject: message.Subject,
            from: `${message.From?.Name ?? ""} <${message.From?.Address}>`,
            transferEncodings: encodings,
            linkOrigin,
            linkInTextAndHtml: htmlLink,
            requestStatus: status,
            attempt,
          },
        };
      }
    }
  }
  throw new Error(`no sign-in link for ${email}`);
}

const browser = await chromium.launch({ headless: true });
try {
  await step(
    "anonymous",
    "GET /api/v1/meta on the running API",
    "The candidate reports OpenLaw 0.1.0 (the release bump in packages/shared OPENLAW_VERSION).",
    async () => {
      const meta = await fetch(`${BASE}/api/v1/meta`).then((r) => r.json());
      must(meta.version === "0.1.0", `version ${meta.version}`);
      return `GET /api/v1/meta answered ${JSON.stringify(meta)}.`;
    },
  );

  for (const [role, email] of [
    ["administrator", "daniel.okafor@helix.example"],
    ["legal_team_member", "nadia.haddad@helix.example"],
  ]) {
    let session;
    await step(
      role,
      `Password sign-in at /auth/login as ${email}`,
      "The sign-in lands in the staff app and /api/v1/me names the account with its role.",
      async () => {
        session = await passwordSignIn(browser, email);
        must(session.me.user?.email === email, `me ${session.me.user?.email}`);
        must(session.me.user?.role === role, `role ${session.me.user?.role}`);
        return `Signed in; landed on ${new URL(session.page.url()).pathname}; /api/v1/me: ${session.me.user.email}, role ${session.me.user.role}.`;
      },
    );
    if (!session) continue;
    await step(
      role,
      `Open each staff module list: ${STAFF_LISTS.join(", ")}`,
      "Each list opens with its heading and no error boundary.",
      async () => `Opened: ${(await openLists(session.page, STAFF_LISTS)).join("; ")}.`,
    );
    if (role === "administrator")
      await step(
        role,
        "Open Settings → General and Settings → Users",
        "Both settings pages open with their headings and no error boundary.",
        async () =>
          `Opened: ${(await openLists(session.page, ["/settings/general", "/settings/users"])).join("; ")}.`,
      );
    await session.ctx.close();
  }

  for (const [role, email] of [
    ["contributor", "ravi.menon@helix.example"],
    ["business_user", "lena.vogel@helix.example"],
  ]) {
    let session;
    await step(
      role,
      `Fresh sign-in link from /portal/login (Email me a sign-in link) for ${email}, read from Mailpit and opened once`,
      "OpenLaw sends one sign-in email through its relay; the link in the message signs the Business User in to the Portal.",
      async () => {
        session = await linkSignIn(browser, email);
        must(session.me.user?.email === email, `me ${session.me.user?.email}`);
        return `Request answered ${session.mail.requestStatus}; message "${session.mail.subject}" from ${session.mail.from}; part transfer encodings ${session.mail.transferEncodings.join(", ") || "none declared"}; link origin ${session.mail.linkOrigin}, link path also in the HTML part: ${session.mail.linkInTextAndHtml}; after opening it /api/v1/me names ${session.me.user.email}, role ${session.me.user.role}; landed on ${new URL(session.page.url()).pathname}.`;
      },
    );
    if (!session) continue;
    await step(
      role,
      `Open each Portal module list: ${PORTAL_LISTS.join(", ")}`,
      "Each Portal list opens with its heading and no error boundary.",
      async () => `Opened: ${(await openLists(session.page, PORTAL_LISTS)).join("; ")}.`,
    );
    await session.ctx.close();
  }
} finally {
  await browser.close();
  save();
}
const failed = results.steps.filter((s) => s.result !== "pass").length;
console.log(`${results.steps.length} steps, ${failed} failed`);
