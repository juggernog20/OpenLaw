// DOC-032 independent walkthrough, records group (issue #1194).
// Written by the DOC-032 independent walkthrough agent (records), following the DOC-030 matters
// walkthrough.mjs driver pattern (one module per article, one browser context per identity).
// It follows create-matter, entity-records, entity-structure-and-access, types-statuses-fields
// and auto-doc-template on the shared `work` lab built from 4ca41822 and records what the lab showed.
// Run from the worktree root:
//   LAB_PASSWORD=... node docs/documentation/batches/DOC-032/records/walkthrough.mjs
// Optional filters: ARTICLES=create-matter,entity-records ROLES=administrator
// Several article runs may write the log at once; each save takes a lock, re-reads the log and
// replaces only the (article, role) pairs this run covers.
// Credentials come only from the environment. The log holds no cookies, links or mail bodies.
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  rmdirSync,
  renameSync,
  statSync,
} from "node:fs";
import path from "node:path";
import {
  chromium,
  passwordSignIn,
  magicSignIn,
  api,
  BASE,
  MAIL,
  PEOPLE,
  lab,
  here,
  articleHash,
  sleep,
} from "./lib.mjs";

const OUT = path.join(here, "walkthrough.json");
const LOCK = `${OUT}.lock`;
const ALL = [
  "create-matter",
  "entity-records",
  "entity-structure-and-access",
  "types-statuses-fields",
  "auto-doc-template",
];
const SCENARIO = {
  "create-matter": "V-C22",
  "entity-records": "V-C32",
  "entity-structure-and-access": "V-C53",
  "types-statuses-fields": "V-C38",
  "auto-doc-template": "V-C56",
};
const ARTICLES = (process.env.ARTICLES ?? ALL.join(",")).split(",");
const ROLES = (process.env.ROLES ?? "administrator,legal_team_member").split(",");
const now = new Date();
const stamp = now.toISOString().replace(/[-:T]/g, "").slice(4, 14); // MMDDHHMMSS UTC

const run = {
  stamp,
  startedAt: now.toISOString(),
  finishedAt: null,
  articles: ARTICLES,
  roles: ROLES,
  contentSha256: Object.fromEntries(ARTICLES.map((a) => [a, articleHash(a)])),
};
const mine = { steps: [], productBugs: [], guideFailures: [], records: [] };

async function withLock(fn) {
  for (let i = 0; i < 400; i++) {
    try {
      mkdirSync(LOCK);
      break;
    } catch {
      // A lock older than a minute belongs to a crashed run.
      try {
        if (Date.now() - statSync(LOCK).mtimeMs > 60000) rmdirSync(LOCK);
      } catch {}
      await sleep(50);
    }
  }
  try {
    return fn();
  } finally {
    try {
      rmdirSync(LOCK);
    } catch {}
  }
}

function covered(entry) {
  return ARTICLES.includes(entry.article) && (entry.role == null || ROLES.includes(entry.role));
}

async function save() {
  run.finishedAt = new Date().toISOString();
  await withLock(() => {
    const log = existsSync(OUT)
      ? JSON.parse(readFileSync(OUT, "utf8"))
      : {
          kind: "independent-article-walkthrough",
          task: "DOC-032",
          issue: 1194,
          group: "records",
          walkthroughReviewer: "DOC-032 independent walkthrough agent (records)",
          reviewerKind: "agent",
          appCommit: lab.sourceCommit,
          lab: {
            name: lab.name,
            project: lab.project,
            appUrl: BASE,
            mailUrl: MAIL,
            appImageId: lab.appImageId,
            engineImageId: lab.engineImageId,
            seed: lab.seed,
          },
          articles: {},
          runs: [],
          steps: [],
          records: [],
          productBugs: [],
          guideFailures: [],
        };
    for (const a of ARTICLES)
      log.articles[a] = {
        scenario: SCENARIO[a],
        articlePath: `docs/user-guides/${a}.md`,
        contentSha256: run.contentSha256[a],
      };
    const i = log.runs.findIndex((r) => r.stamp === stamp && r.startedAt === run.startedAt);
    if (i >= 0) log.runs[i] = run;
    else log.runs.push(run);
    for (const key of ["steps", "records", "productBugs", "guideFailures"]) {
      log[key] = [...(log[key] ?? []).filter((e) => !covered(e)), ...mine[key]];
    }
    const order = (s) => ALL.indexOf(s.article);
    log.steps.sort(
      (a, b) =>
        order(a) - order(b) ||
        String(a.role).localeCompare(String(b.role)) ||
        a.startedAt.localeCompare(b.startedAt),
    );
    log.summary = Object.fromEntries(
      ALL.filter((a) => log.steps.some((s) => s.article === a)).map((a) => {
        const s = log.steps.filter((x) => x.article === a);
        return [
          a,
          {
            total: s.length,
            pass: s.filter((x) => x.result === "pass").length,
            fail: s.filter((x) => x.result === "fail").length,
            blocked: s.filter((x) => x.result === "blocked").length,
          },
        ];
      }),
    );
    const tmp = `${OUT}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(log, null, 2) + "\n");
    renameSync(tmp, OUT);
  });
}

const browser = await chromium.launch({ headless: true });
const sessions = {};
async function session(key) {
  if (sessions[key]) return sessions[key];
  const person = PEOPLE[key];
  if (!person) throw new Error(`unknown identity ${key}`);
  sessions[key] = ["business_user", "amara", "karim"].includes(key)
    ? await magicSignIn(browser, person.email)
    : await passwordSignIn(browser, person.email);
  return sessions[key];
}

function makeCtx(article, role) {
  let currentPage = null;
  const scenario = SCENARIO[article];
  async function step(action, expected, fn, opts = {}) {
    const entry = {
      article,
      scenario,
      role,
      method: opts.method ?? "browser-walkthrough",
      actor: opts.actor ?? PEOPLE[role]?.name ?? role,
      page: null,
      action,
      expected,
      actual: null,
      result: "not-run",
      startedAt: new Date().toISOString(),
      at: null,
      runStamp: stamp,
    };
    mine.steps.push(entry);
    try {
      entry.actual = await fn();
      entry.result = "pass";
    } catch (error) {
      entry.actual = `Check did not complete: ${String(error?.message ?? error)
        .split("\n")
        .slice(0, 6)
        .join(" ")}`;
      entry.result = "fail";
      if (process.env.DEBUG && currentPage) {
        try {
          console.error("URL", currentPage.url());
          console.error((await currentPage.locator("body").ariaSnapshot()).slice(0, 9000));
        } catch {}
      }
    }
    try {
      const p = opts.page ?? currentPage;
      if (p) {
        const u = new URL(p.url());
        entry.page = u.pathname + u.search;
      }
    } catch {}
    entry.at = new Date().toISOString();
    console.log(
      `[${article}/${role}] ${entry.result.toUpperCase()} ${action}${entry.result === "fail" ? `\n   ${entry.actual}` : ""}`,
    );
    await save();
    return entry;
  }
  return {
    article,
    scenario,
    role,
    stamp,
    here,
    BASE,
    MAIL,
    api,
    browser,
    session,
    account: PEOPLE[role],
    /** Name for every record this run creates. */
    name: (what) => `DOC-032 records ${scenario} ${what} ${stamp}`,
    step,
    setPage: (p) => (currentPage = p),
    record: async (what) => {
      mine.records.push({ article, role, runStamp: stamp, ...what });
      await save();
    },
    productBug: async (bug) => {
      mine.productBugs.push({ article, role, runStamp: stamp, ...bug });
      await save();
    },
    guideFailure: async (failure) => {
      mine.guideFailures.push({ article, role, runStamp: stamp, ...failure });
      await save();
    },
    shot: async (page, file) => {
      await page.screenshot({ path: path.join(here, file) });
      return `docs/documentation/batches/DOC-032/records/${file}`;
    },
  };
}

try {
  for (const article of ARTICLES) {
    const mod = (await import(`./wt-${article}.mjs`)).default;
    for (const role of ROLES) {
      await mod(makeCtx(article, role));
    }
  }
} finally {
  await save();
  await browser.close();
}
