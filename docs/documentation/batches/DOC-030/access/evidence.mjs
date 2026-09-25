// Writes docs/documentation/evidence/<id>.json for each access article whose walkthrough steps all passed.
// Run from the worktree root after walkthrough.mjs: node docs/documentation/batches/DOC-030/access/evidence.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const rel = (p) => path.relative(root, p);
const wt = JSON.parse(readFileSync(path.join(here, "walkthrough.json"), "utf8"));
const review = JSON.parse(readFileSync(path.join(here, "technical-review.json"), "utf8"));
const seat = "DOC-030 independent walkthrough agent (access)";
const bug =
  "Portal record ignores Branch conditions (DD-028 points 4 and 5). Reproduction: on work2, C-76 uses DOC-030 access Form type 09251012, whose Branch shows DOC-030 access Branch field 09251012 only when DOC-030 access Gate 09251012 is Yes. With the Gate at No and the Branch field empty, Ravi Menon's Portal record lists the Branch field as Not recorded (step G5). The staff record applies the Form evaluator; the Portal record does not.";
wt.productBugs = [{ module: "contributor", article: "contributor-guide", confirmsAuthorReport: true, bug }];
writeFileSync(path.join(here, "walkthrough.json"), JSON.stringify(wt, null, 2) + "\n");

const scripts = ["walkthrough.mjs", "lib.mjs", "setup.mjs", "fixtures.json", "walkthrough.json"].map((f) => rel(path.join(here, f)));
const common = [
  "Independent agent walkthrough by a different agent from the author and the technical reviewer. It is not a human user study and not feature-owner approval.",
  "The work2 lab is shared with other DOC-030 agents. The walkthrough created only records and accounts named DOC-030 access (fixtures.json) and deleted nothing that another guide uses. Legal and Administrator actions that are fixtures or a second actor's writes used API sessions; each such step says so.",
  "The shared sign-in link budget (3 per address and 30 per client address in 15 minutes) made the script wait out 429 answers before Business User sign-in. Earlier attempts are kept as walkthrough-attempt2.json, run-attempt2.log and run-3.log (run-3.log holds the final portal-sign-in run; run-4.log the final contributor-guide run; run-5.log the final roles-and-access run). The earlier failures were reviewer script errors: a stale team row from a previous run, a message read before it rendered, a task reorder that listed only two tasks, an unchanged expiry date, an Entity list read past its first page, and a History count compared by length on a full page.",
];
const prev = (id) => {
  const e = JSON.parse(execFileSync("git", ["show", `HEAD:docs/documentation/evidence/${id}.json`], { cwd: root, encoding: "utf8" }));
  return { appCommit: e.appCommit, contentSha256: e.contentSha256, verifiedAt: e.verifiedAt };
};
const prevAuthor = (id) =>
  JSON.parse(execFileSync("git", ["show", `HEAD:docs/documentation/evidence/${id}.json`], { cwd: root, encoding: "utf8" })).author;

function actualFor(article, roles) {
  const steps = wt.steps.filter((s) => s.article === article && roles.includes(s.role));
  return `${steps.length} recorded steps passed on ${wt.appCommit.slice(0, 8)}. ` + steps.map((s) => `${s.id}: ${s.actual}`).join(" ");
}
const settings = wt.settingChanges
  .filter((c) => c.what !== "final check")
  .map((c) => `${c.at} ${c.what}${c.to ? ` -> ${typeof c.to === "string" ? c.to : JSON.stringify(c.to)}` : ""}`)
  .join("; ");

const spec = {
  "portal-sign-in": {
    scenario: "V-C02",
    coverage: ["C02"],
    roles: [["business_user", ["business_user", "legal_team_member"]]],
    prerequisites: [
      "work2 lab from 067c1646, Helix seed light profile, random seed 7; Business Portal policy password and sign-in links on, allowed domain helix.example.",
      "New DOC-030 access Business User addresses signed in for the first time; Jonas Weber and Amara Nwosu in separate browser contexts with fresh Mailpit links; Nadia Haddad for the kept-role check.",
      "Fixtures (API): 26 paging Contracts with Jonas on the team, an archived team Contract, Jonas's converted Contract with a primary Document, Counterparty, Value and dates; an invited Business User on a domain that is not allowed.",
      "Organization settings changed for single steps and put back: email links off, SSO-first, two-factor required, saved logo.",
    ],
    expected:
      "Only the intended Business User session opens; the portal shows that person's Requests. An unapproved domain gets the supported refusal/neutral response; a bad link offers a working recovery route.",
    limitations: [
      `Organization settings were set for single steps and put back at once (the final check found the Business policy restored and no SSO provider): ${settings}.`,
      "No identity provider runs on this lab, and a local mock identity provider could not be exposed to the lab containers. For the SSO-first page an inert sso_providers row (issuer https://idp.doc030-access.invalid) was inserted in the lab database only to render the page, then deleted. The page, Email me a sign-in link and Sign in with a password were walked; Continue with single sign-on and the organization sign-in round trip were not.",
      "The page that says Sign-in is unavailable. Contact your administrator., and the missing link when OpenLaw cannot send email, need outbound email switched off. That would stop mail for every agent on the shared lab, so they were not walked.",
      "The lab has AI off, so no Contract value was Unverified and the Unverified marker was not observed.",
      "The sign-in page also shows Legal Portal and Powered by OpenLaw under the organization name. The guide does not name them (the author noted this too).",
      "The two-factor fixture account and the password-setup fixture account keep their authenticator and password after the policy was put back.",
    ],
  },
  "roles-and-access": {
    scenario: "V-C06",
    coverage: ["C06"],
    roles: [
      ["legal_team_member", ["legal_team_member"]],
      ["administrator", ["administrator"]],
      ["business_user", ["business_user"]],
    ],
    prerequisites: [
      "work2 lab from 067c1646. Daniel Okafor (Administrator), Nadia Haddad and Priya Raman (Legal Team Members) by password; Jonas Weber and Amara Nwosu (Business Users) by fresh magic links; one browser context each.",
      "Fixtures (setup.mjs, API): open and Confidential DOC-030 access Contracts and Matters with a link and a parent Matter; a Confidential parent Contract with Jonas on its team and an open child Contract; two Confidential Entities created by Nadia; three comments at Legal Only, Working Team and Full Thread; Jonas's converted Request; per run, three approval requests naming Jonas (one with a Confidential primary Document).",
      "A fixture reset at the start of each run removes leftover team rows and owners from earlier runs.",
    ],
    expected:
      "Each account sees only its permitted records/actions, including the Administrator exception. Removed membership/Grants cease granting access; parent or related-record links do not grant inherited reach.",
    limitations: [
      "Legal changes read by the Business User's Portal History (Priority, Risk, Fields, Tasks, Value, dates, Stage and Status moves, comments) were made through the API as Nadia, as the second actor; the Business User side was read in the browser and through the Portal activity read.",
      "On the Confidential Contract, Priya's Legal Owner control is enabled. Choosing herself shows the refusal Only an Administrator, the contract's creator, or its Owner can change the team on a confidential contract., which matches the guide.",
      "That removal ends notifications was not checked; old links, replies and Documents were.",
      "The Contributor and Stakeholder migration statements cannot be observed on a fresh seed. Creator is historical: Business Users cannot create records, so a Creator-only Portal case was not built.",
    ],
  },
  "contributor-guide": {
    scenario: "V-C25",
    coverage: ["C25"],
    roles: [["business_user", ["business_user", "legal_team_member"]]],
    prerequisites: [
      "work2 lab from 067c1646. Ravi Menon (Business User) by fresh magic link; Nadia Haddad (Legal Team Member) by password; Amara Nwosu for team-add reach.",
      "Fixtures (setup.mjs, API): Ravi's converted Contract C-76 of DOC-030 access Form type 09251012 (a Field Visible on Portal, a Field off the Portal, a Gate and a Branch Field), a second type whose Row for the same Field is off the Portal, an Administrator-added Document type, Ravi's Matter, a comparable Matter without Ravi, a Matter with 51 Documents and 26 paging Contracts with Ravi on the team.",
    ],
    expected:
      "Business User actions succeed only on reached work and the guide identifies the actual legal-action limits. Stage/Status moves and other reserved legal actions remain unavailable; removing Ravi's reach stops access.",
    limitations: [
      "The registry action Edit permitted business Fields has no control: the Portal record has no editable Field, and direct record writes by Ravi answered 403. The guide says to ask Legal, which is what the app supports.",
      "Removing Ravi's reach is a Legal action: Nadia removed him through Matter team in the full app; the Portal has no remove control.",
      `Product bug confirmed (not a guide failure; the guide describes the current behavior): ${bug}`,
      "Stage and Status moves, closing, ending, archiving and pinning the signed copy were done by Legal through the API as the second actor.",
    ],
  },
};

for (const [id, s] of Object.entries(spec)) {
  const steps = wt.steps.filter((x) => x.article === id);
  const failed = steps.filter((x) => x.result !== "pass");
  const hash = execFileSync("sha256sum", [path.join(root, `docs/user-guides/${id}.md`)], { encoding: "utf8" }).split(" ")[0];
  if (!steps.length || failed.length || hash !== wt.articleContentSha256[id]) {
    console.log(id, "no evidence:", failed.map((f) => f.id).join(", ") || "hash changed or not run");
    continue;
  }
  const art = review.articles.find((a) => a.articleId === id);
  const rec = {
    articleId: id,
    contentSha256: hash,
    appCommit: wt.appCommit,
    buildId: `app ${wt.lab.appImageId}; engine ${wt.lab.engineImageId}`,
    environment: wt.lab.project,
    author: `${prevAuthor(id)}; DOC-030 corrections by ${review.reviewer}`,
    technicalReviewer: review.reviewer,
    walkthroughReviewer: seat,
    reviewerKind: "agent",
    verifiedAt: wt.runs[id].finishedAt,
    status: "pass",
    sources: [`docs/user-guides/${id}.md`, rel(path.join(here, "technical-review.json")), ...scripts, ...art.sources.map((x) => x.split(" (")[0].split(" ")[0]).filter((x) => !x.startsWith("node_modules"))],
    scenarios: s.roles.map(([role, stepRoles]) => ({
      id: s.scenario,
      coverage: s.coverage,
      role,
      method: "browser-walkthrough",
      prerequisites: s.prerequisites,
      expected: s.expected,
      actual: actualFor(id, stepRoles),
      result: "pass",
      evidence: [rel(path.join(here, "walkthrough.json")), rel(path.join(here, "walkthrough.mjs")), rel(path.join(here, "lib.mjs"))],
    })),
    limitations: [...common, ...s.limitations],
    previousEvidence: prev(id),
    copyOnlyReview: null,
    compatibilityReview: null,
  };
  rec.sources = [...new Set(rec.sources)];
  writeFileSync(path.join(root, `docs/documentation/evidence/${id}.json`), JSON.stringify(rec, null, 2) + "\n");
  console.log(id, "evidence written", steps.length, "steps");
}
