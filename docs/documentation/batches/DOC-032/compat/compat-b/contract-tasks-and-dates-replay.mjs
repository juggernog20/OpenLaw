// DOC-032 compatibility replay (set compat-b), article contract-tasks-and-dates (V-C19). Copy of
// DOC-030/contracts-b/walkthrough.mjs with its lib.mjs and c19.mjs in ./contract-tasks-and-dates-replay/.
// Changes: helper paths, only C19 imported and run (C21 is contract-analysis), lab manifest `work`
// (LAB_NAME), task/issue/reviewer labels, output path, fixture names "DOC-032 compat compat-b ...".
// No step or check changed.
//   LAB_PASSWORD=... node docs/documentation/batches/DOC-032/compat/compat-b/contract-tasks-and-dates-replay.mjs
// DOC-030 independent browser walkthrough for the contracts-b group:
//   contract-tasks-and-dates (V-C19) and contract-analysis (V-C21).
// Written by the DOC-030 independent walkthrough agent (contracts-b) from the guide text.
// Pattern: DOC-029 contracts-b/walkthrough-r1.mjs and analysis-standin/walkthrough-r1.mjs.
//
// Run from the worktree root against the shared work2 lab:
//   LAB_PASSWORD=... [STANDIN_CONTROL_URL=http://<ip>:8080 STANDIN_API_KEY=... STANDIN_CONTROL_TOKEN=...] \
//   node docs/documentation/batches/DOC-030/contracts-b/walkthrough.mjs [--articles C19,C21] [--roles legal_team_member,administrator]
// V-C21 needs the provider stand-in (./provider-standin.mjs, adapted from DOC-029 analysis-standin) running in
// its own container on the work2 backend network with the alias doc030-cb-provider.
// The password and stand-in keys come only from the environment and are never written to the results.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as h from "./contract-tasks-and-dates-replay/lib.mjs";
import { runC19 } from "./contract-tasks-and-dates-replay/c19.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1].split(",") : fallback;
};
const ARTICLES = arg("articles", ["C19"]);
const ROLES = arg("roles", ["legal_team_member", "administrator"]);
const PARTS = arg("parts", null);
const OUT = process.env.OUT ?? path.join(here, "contract-tasks-and-dates-replay.json");
const stamp = Date.now();
const fileHash = (file) => h.sha256(readFileSync(path.join(h.root, file)));
const articleFiles = {
  "contract-tasks-and-dates": "docs/user-guides/contract-tasks-and-dates.md",
};
const PEOPLE = {
  ...h.PEOPLE,
  business_user_team: { email: "ravi.menon@helix.example", name: "Ravi Menon" },
};

const results = {
  kind: "article-compatibility-replay",
  batch: "DOC-032",
  issue: 1194,
  set: "compat-b",
  adaptedFrom: "docs/documentation/batches/DOC-030/contracts-b/walkthrough.mjs",
  walkthroughReviewer: "DOC-032 compatibility reviewer (compat-b)",
  reviewerKind: "agent",
  method: "browser-walkthrough",
  appCommit: h.LAB.sourceCommit,
  environment: h.LAB.project,
  lab: process.env.LAB_NAME ?? "work",
  buildId: `app ${h.LAB.appImageId}; engine ${h.LAB.engineImageId}`,
  containerImages: h.LAB.containerImages,
  seed: h.LAB.seed,
  appUrl: h.BASE,
  browser: `Playwright 1.63.0 Chromium, headless, one context per identity at ${h.VIEWPORT.width}x${h.VIEWPORT.height} CSS px`,
  providerMode: null,
  articles: Object.fromEntries(
    Object.entries(articleFiles).map(([id, file]) => [
      id,
      { path: file, contentSha256: fileHash(file) },
    ]),
  ),
  selection: { articles: ARTICLES, roles: ROLES, parts: PARTS },
  startedAt: new Date().toISOString(),
  stamp,
  setup: [],
  notes: [],
  records: [],
  productBugs: [],
  observations: [],
  guideFailures: [],
  steps: [],
  finishedAt: null,
};
function save() {
  results.finishedAt = new Date().toISOString();
  results.summary = {
    total: results.steps.length,
    pass: results.steps.filter((s) => s.result === "pass").length,
    fail: results.steps.filter((s) => s.result === "fail").length,
  };
  writeFileSync(OUT, `${JSON.stringify(results, null, 2)}\n`);
}
const stepFor = h.makeRecorder(results, save);

const browser = await h.chromium.launch();
try {
  const sessions = {};
  for (const role of ["administrator", "legal_team_member"])
    sessions[role] = await h.passwordSignIn(browser, role);
  let businessUser = null;
  const getBusinessUser = async () => {
    if (!businessUser) businessUser = await h.magicSignIn(browser, "business_user_team_login");
    return businessUser;
  };
  h.PEOPLE.business_user_team_login = PEOPLE.business_user_team;
  // Sign the Business User in once, before the walk, so a busy sign-in link budget cannot fail a late step.
  try {
    await getBusinessUser();
    results.setup.push({
      at: new Date().toISOString(),
      text: "Ravi Menon (Business User) signed in to the Portal with a fresh magic link from the lab Mailpit; the same Portal session serves V-C19 and V-C21.",
    });
  } catch (error) {
    results.setup.push({
      at: new Date().toISOString(),
      text: `Ravi Menon sign-in failed before the walk: ${error.message}`,
    });
  }
  const options = (await sessions.administrator.api("GET", "/contracts/options")).json;
  const userId = (name) => {
    const u = options.users.find((x) => x.displayName === name);
    if (!u) throw new Error(`no user ${name}`);
    return u.id;
  };
  const typeId = (name) => options.contractTypes.find((t) => (t.name ?? t.displayName) === name).id;
  const taskFileName = `doc032-compat-b-task-note-${stamp}.pdf`;
  const taskPdf = await h.makePdf(browser, taskFileName, [
    "DOC-032 fictional task attachment.",
    "Nothing in this file is real.",
  ]);
  const taskFile = path.join(process.env.TMPDIR ?? "/tmp", taskFileName);
  writeFileSync(taskFile, taskPdf.buffer);
  const ctx = {
    here,
    stamp,
    PEOPLE,
    sessions,
    getBusinessUser,
    options,
    userId,
    typeId,
    h,
    browser,
    records: results.records,
    notes: results.notes,
    observations: results.observations,
    setup: results.setup,
    productBugs: results.productBugs,
    taskFile,
    taskFileName,
  };
  for (const role of ROLES) {
    const other = role === "administrator" ? "legal_team_member" : "administrator";
    const roleCtx = { ...ctx, role, other, actor: sessions[role], otherSession: sessions[other] };
    if (ARTICLES.includes("C19"))
      await runC19(roleCtx, stepFor("contract-tasks-and-dates", "V-C19", role));
  }
} finally {
  save();
  await browser.close();
}
console.log(JSON.stringify(results.summary));
