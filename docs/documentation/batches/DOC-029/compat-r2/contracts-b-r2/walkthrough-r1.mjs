// DOC-029 round 1 independent browser walkthrough for the contracts-b group:
//   terms-and-renewals (V-C18), contract-tasks-and-dates (V-C19),
//   contract-relations-and-ending (V-C20).
// Written by the DOC-029 independent walkthrough agent (contracts-b, round 1) from the article text.
// Run from the repository root:
//   LAB_PASSWORD=... mise exec -- node docs/documentation/batches/DOC-029/contracts-b/walkthrough-r1.mjs [--articles C18,C19,C20] [--roles legal_team_member,administrator]
// The seed password comes only from the environment and is never written to the results.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASE,
  chromium,
  expectThat,
  isoPlusDays,
  isPatchOf,
  magicSignIn,
  passwordSignIn,
  pickDate,
  root,
  sleep,
  text,
  withResponse,
} from "./lib-r1.mjs";
import { runC18 } from "./c18-r1.mjs";
import { runC19 } from "./c19-r1.mjs";
import { runC20 } from "./c20-r1.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1].split(",") : fallback;
};
const ARTICLES = arg("articles", ["C18", "C19", "C20"]);
const ROLES = arg("roles", ["legal_team_member", "administrator"]);
const OUT = process.env.OUT ?? path.join(here, "walkthrough-r2.json");
const stamp = Date.now();
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const articleFiles = {
  "terms-and-renewals": "docs/user-guides/terms-and-renewals.md",
  "contract-tasks-and-dates": "docs/user-guides/contract-tasks-and-dates.md",
  "contract-relations-and-ending": "docs/user-guides/contract-relations-and-ending.md",
};

const PEOPLE = {
  administrator: { email: "daniel.okafor@helix.example", name: "Daniel Okafor" },
  legal_team_member: { email: "nadia.haddad@helix.example", name: "Nadia Haddad" },
  reader: { email: "priya.raman@helix.example", name: "Priya Raman" },
  businessUser: { email: "ravi.menon@helix.example", name: "Ravi Menon" },
};

const results = {
  kind: "independent-article-walkthrough",
  task: "DOC-029",
  group: "contracts-b",
  round: 2,
  issues: [745, 747],
  walkthroughReviewer: "DOC-029r2 compatibility reviewer (contracts-b)",
  reviewerKind: "agent",
  method: "browser-walkthrough",
  appCommit: "57e77e386be31b2a319f7143dd54d00123e65efe",
  labProject: process.env.LAB_PROJECT ?? "openlaw-docs-41255c61-work2",
  containerImages: JSON.parse(process.env.LAB_IMAGES ?? "[]"),
  appUrl: BASE,
  browser: "Playwright 1.63.0 Chromium, headless, one context per identity at 1280x1800 CSS px",
  articles: Object.fromEntries(
    Object.entries(articleFiles).map(([id, file]) => [id, { path: file, contentSha256: sha256(path.join(root, file)) }]),
  ),
  fixtures: {
    "fixtures/doc029-services-agreement.pdf": sha256(path.join(here, "fixtures/doc029-services-agreement.pdf")),
    "fixtures/doc029-renewal-amendment.pdf": sha256(path.join(here, "fixtures/doc029-renewal-amendment.pdf")),
  },
  selection: { articles: ARTICLES, roles: ROLES },
  startedAt: new Date().toISOString(),
  stamp,
  steps: [],
  records: [],
  finishedAt: null,
};
function save() {
  results.finishedAt = new Date().toISOString();
  results.summary = {
    total: results.steps.length,
    pass: results.steps.filter((s) => s.result === "pass").length,
    fail: results.steps.filter((s) => s.result === "fail").length,
  };
  writeFileSync(OUT, JSON.stringify(results, null, 2) + "\n");
}

function makeStep(article, scenario, role) {
  return async (action, expected, fn) => {
    const entry = {
      article,
      scenario,
      role,
      method: "browser-walkthrough",
      step: action,
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
      entry.actual = `Check did not complete: ${error instanceof Error ? error.message.split("\n").slice(0, 6).join(" ") : String(error)}`;
      entry.result = "fail";
      console.error(`[${scenario} ${role}] FAIL ${action}: ${entry.actual}`);
      if (process.env.STOP_ON_FAIL) {
        entry.at = new Date().toISOString();
        save();
        throw error;
      }
    }
    entry.at = new Date().toISOString();
    console.log(`[${scenario} ${role}] ${entry.result.toUpperCase()} ${action}`);
    save();
    return entry;
  };
}

const browser = await chromium.launch();
try {
  const sessions = {
    administrator: await passwordSignIn(browser, PEOPLE.administrator.email),
    legal_team_member: await passwordSignIn(browser, PEOPLE.legal_team_member.email),
    reader: await passwordSignIn(browser, PEOPLE.reader.email),
  };
  let businessUser = null;
  const getBusinessUser = async () => {
    if (!businessUser) businessUser = await magicSignIn(browser, PEOPLE.businessUser.email);
    return businessUser;
  };
  const options = (await sessions.administrator.api("GET", "/contracts/options")).json;
  const userId = (name) => {
    const u = options.users.find((x) => x.displayName === name);
    if (!u) throw new Error(`no user ${name}`);
    return u.id;
  };
  const typeId = (name) => options.contractTypes.find((t) => (t.name ?? t.displayName) === name).id;
  const ctx = {
    here,
    stamp,
    PEOPLE,
    sessions,
    getBusinessUser,
    options,
    userId,
    typeId,
    records: results.records,
    shot: async (page, name) => {
      const file = `r2-${name}.png`;
      await page.screenshot({ path: path.join(here, file) });
      return file;
    },
    helpers: { expectThat, isoPlusDays, isPatchOf, pickDate, sleep, text, withResponse, BASE },
  };
  for (const role of ROLES) {
    const other = role === "administrator" ? "legal_team_member" : "administrator";
    const roleCtx = { ...ctx, role, other, actor: sessions[role], otherSession: sessions[other] };
    if (ARTICLES.includes("C18")) await runC18(roleCtx, makeStep("terms-and-renewals", "V-C18", role));
    if (ARTICLES.includes("C19")) await runC19(roleCtx, makeStep("contract-tasks-and-dates", "V-C19", role));
    if (ARTICLES.includes("C20")) await runC20(roleCtx, makeStep("contract-relations-and-ending", "V-C20", role));
  }
} finally {
  save();
  await browser.close();
}
console.log(JSON.stringify(results.summary));
