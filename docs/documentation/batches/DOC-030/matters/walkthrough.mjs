// DOC-030 independent walkthrough, matters group (issue #1157).
// Written by the DOC-030 independent walkthrough agent (matters) from the article text, on the
// shared work2 lab built from 067c1646. It follows create-matter and matter-work as an
// Administrator and as a Legal Team Member, with separate browser contexts for the comparison
// Legal Team Member (Priya Raman) and the Business User (Jonas Weber, magic link from Mailpit).
// Fixtures come from setup.mjs (fixtures.json). Run from the repository root:
//   LAB_PASSWORD=... node docs/documentation/batches/DOC-030/matters/walkthrough.mjs
// Optional filters: ARTICLES=create-matter,matter-work ROLES=administrator
// Credentials come only from the environment. The log holds no cookies, links or mail bodies.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, passwordSignIn, magicSignIn, api, BASE } from "./lib.mjs";
import createMatter from "./wt-create-matter.mjs";
import matterWork from "./wt-matter-work.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "walkthrough.json");
const fx = JSON.parse(readFileSync(path.join(here, "fixtures.json"), "utf8"));
const ARTICLES = (
  process.env.ARTICLES ?? "create-matter,matter-work"
).split(",");
const ROLES = (process.env.ROLES ?? "administrator,legal_team_member").split(",");
const stamp = Date.now();

const log = existsSync(OUT)
  ? JSON.parse(readFileSync(OUT, "utf8"))
  : {
      batch: "DOC-030",
      group: "matters",
      reviewer: "DOC-030 independent walkthrough agent (matters)",
      lab: "work2",
      runs: [],
      steps: [],
    };
const run = {
  stamp,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  articles: ARTICLES,
  roles: ROLES,
  lab: "work2",
  baseUrl: BASE,
};
log.runs.push(run);
// A rerun of one article and role replaces that pair's earlier steps.
log.steps = log.steps.filter((s) => !(ARTICLES.includes(s.article) && ROLES.includes(s.role)));
function save() {
  run.finishedAt = new Date().toISOString();
  writeFileSync(OUT, JSON.stringify(log, null, 2) + "\n");
}

export const ACCOUNTS = {
  administrator: { email: "daniel.okafor@helix.example", name: "Daniel Okafor" },
  legal_team_member: { email: "nadia.haddad@helix.example", name: "Nadia Haddad" },
};

const browser = await chromium.launch();
const sessions = {};
async function session(key) {
  if (sessions[key]) return sessions[key];
  if (key === "business_user")
    sessions[key] = await magicSignIn(browser, "jonas.weber@helix.example");
  else if (key === "priya")
    sessions[key] = await passwordSignIn(browser, "priya.raman@helix.example");
  else sessions[key] = await passwordSignIn(browser, ACCOUNTS[key].email);
  return sessions[key];
}

function makeStep(article, role) {
  return async function step(action, expected, fn) {
    const entry = {
      article,
      role,
      method: "browser-walkthrough",
      action,
      expected,
      actual: null,
      result: "not-run",
      startedAt: new Date().toISOString(),
      at: null,
      runStamp: stamp,
    };
    log.steps.push(entry);
    try {
      entry.actual = await fn();
      entry.result = "pass";
    } catch (error) {
      entry.actual = `Check did not complete: ${String(error?.message ?? error)
        .split("\n")
        .slice(0, 5)
        .join(" ")}`;
      entry.result = "fail";
    }
    entry.at = new Date().toISOString();
    console.log(
      `[${article}/${role}] ${entry.result.toUpperCase()} ${action}${entry.result === "fail" ? `\n   ${entry.actual}` : ""}`,
    );
    save();
    return entry;
  };
}

const other = { administrator: "legal_team_member", legal_team_member: "administrator" };
const modules = {
  "create-matter": createMatter,
  "matter-work": matterWork,
};
try {
  for (const article of ARTICLES) {
    for (const role of ROLES) {
      const ctx = {
        role,
        stamp,
        fx,
        here,
        BASE,
        api,
        account: ACCOUNTS[role],
        otherAccount: ACCOUNTS[other[role]],
        actor: await session(role),
        other: await session(other[role]),
        admin: await session("administrator"),
        session,
        step: makeStep(article, role),
      };
      await modules[article](ctx);
    }
  }
} finally {
  save();
  await browser.close();
}
