// Writes docs/documentation/evidence/<id>.json for the documents-2 articles from walkthrough.json.
// Written by the DOC-030 independent walkthrough agent (documents-2). It writes a record only
// for an article whose every required role and method passed, and only when the guide's hash
// still matches the hash the walkthrough ran against.
// Run from the worktree root: node docs/documentation/batches/DOC-030/documents-2/evidence.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const REL = "docs/documentation/batches/DOC-030/documents-2";
const log = JSON.parse(fs.readFileSync(path.join(here, "walkthrough.json"), "utf8"));
const review = JSON.parse(fs.readFileSync(path.join(root, "docs/documentation/batches/DOC-030/shared-files/technical-review.json"), "utf8"));
const plan = JSON.parse(fs.readFileSync(path.join(root, "docs/documentation/batches/DOC-030/plan.json"), "utf8"));
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, f))).digest("hex");
const NAMES = { administrator: "Daniel Okafor (Administrator)", legal_team_member: "Nadia Haddad (Legal Team Member)" };
const labLine = `Shared lab ${log.lab.project} (${log.lab.name}) built from ${log.appCommit}, Helix seed ${log.lab.seed.scale} profile, random seed ${log.lab.seed.randomSeed}, seeded ${log.lab.seed.startedAt} to ${log.lab.seed.completedAt}.`;
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const PREREQ = {
  "document-folders": [
    "Fictional Contract, Matter and Entity records named \"DOC-030 documents-2 … folders …\" created by the signed-in role through the lab API, with two loose text Documents on the Contract. A local folder tree (one nested folder, one empty folder, two files) and a 101 MiB zero-byte file, one MiB over the lab's default 100 MB upload ceiling, generated at run time as the intentionally failing file.",
    "Administrator added the Matter Document type \"DOC-030 documents-2 Matter type <stamp>\" in Settings → Documents in the browser; the run archived it at the end. The Entity list held a type another agent had added.",
  ],
  "document-repository": [
    "Per role: a Contract with a Counterparty, a folder and four Documents (a two-Version PDF whose v1 is Draft · ours and v2 Draft · theirs, an Executed DOCX in the folder, two text files), plus one Document each on a Matter, an Entity, a Knowledge Item and an Auto-Doc template. A Confidential Contract created by the Administrator alone, with its own Counterparty and Document, as the hidden owner. A two-Version text Document with a different marker word in each Version for the search check.",
  ],
  "create-knowledge": [
    "Seeded Knowledge types (Template, Precedent, Playbook, Article) and folders. An archived Knowledge type fixture created by the Administrator through the lab API and deleted at the end. Fictional PDF and DOCX files from the DOC-029 knowledge fixtures, copied under run-specific names.",
  ],
};

const written = [];
const skipped = [];
for (const [articleId, g] of Object.entries(Object.fromEntries(plan.groups["documents-2"].map((a) => [a.id, a])))) {
  const guide = `docs/user-guides/${articleId}.md`;
  const hash = sha(guide);
  const steps = log.steps.filter((s) => s.article === articleId);
  const scenario = g.scenarios[0];
  const author = review.articles.find((a) => a.articleId === articleId);
  const problems = [];
  if (hash !== log.articleHashes[articleId]) problems.push("guide changed after the walk");
  const scenarios = [];
  for (const role of scenario.roles) {
    for (const method of scenario.requiredMethods) {
      const mine = steps.filter((s) => s.role === role && s.method === method);
      const bu = steps.filter((s) => s.role === "business_user");
      if (!mine.length || mine.some((s) => s.result !== "pass")) problems.push(`${role} ${method}: ${mine.filter((s) => s.result !== "pass").length} failed of ${mine.length}`);
      if (!bu.length || bu.some((s) => s.result !== "pass")) problems.push("business user negative check did not pass");
      const actual = [
        `${mine.length} browser steps passed as ${NAMES[role]} in an isolated Playwright Chromium context.`,
        ...mine.map((s, i) => `(${i + 1}) ${clip(s.actual, 700)}`),
        `Business User negative check, Jonas Weber through a fresh Portal magic link: ${bu.map((s) => clip(s.actual, 500)).join(" ")}`,
      ].join(" ");
      scenarios.push({
        id: scenario.id,
        coverage: scenario.coverage,
        role,
        method,
        prerequisites: [labLine, ...PREREQ[articleId]],
        expected: `${scenario.expectedResults.join(" ")} Negative checks: ${scenario.negativeChecks.join(" ")}`,
        actual,
        result: "pass",
        evidence: [`${REL}/walkthrough.json`, `${REL}/walkthrough.mjs`],
      });
    }
  }
  if (problems.length) {
    skipped.push(`${articleId}: ${problems.join("; ")}`);
    continue;
  }
  const lastAt = steps.map((s) => s.at).sort().at(-1);
  // The prior record's values: plan.json keeps its commit and time; the author recorded its hash.
  const prev = { appCommit: g.priorEvidence.appCommit, contentSha256: author.contentSha256Before, verifiedAt: g.priorEvidence.verifiedAt };
  const limitations = [
    "Independent agent walkthrough by a different agent from the author and technical reviewer; not a human user study and not the feature owner's approval.",
    `work2 is shared with other DOC-030 agents. Only records named "DOC-030 documents-2 …" were created. Organization settings changed for the run and put back: ${log.settingsChanged.map((s) => `${s.setting} "${s.added}" (${s.restored ?? "not restored"})`).join("; ")}. Development runs before the recorded run left more DOC-030 documents-2 records; they are not credited.`,
    ...log.limitations.filter((l) => l.article === articleId).map((l) => `${l.claim} ${l.note}`),
  ];
  if (articleId === "document-folders")
    limitations.push(
      "The retryable failure was a connection the browser dropped once for one file (a Playwright route abort), and Cancel remaining ran with each upload slowed four seconds by the browser. The size refusal was real: the lab refused the 101 MiB file with \"That file is over the 100 MB upload limit.\". Cycle refusals were checked with a second request through the lab API after the browser showed no such choice.",
    );
  if (articleId === "document-repository")
    limitations.push(
      "Confirmed the author's limitation: DOC-009 does not state the latest-Version rule. On the lab, header Search found a Document by a word only in its latest Version and did not find it by a word only in its earlier Version.",
      "The Kind filter offers the fixed kinds (General, Draft · ours, Draft · theirs, Redline · theirs, Redline · ours, Executed, Amendment, Generated redline) while the list's Type column shows the Document type name. The guide names the Kind filter and does not say the rows show the kind.",
      "Archived owning records, saved views and Contributor or Business User use of the staff repository beyond the refused address and read were not exercised.",
    );
  if (articleId === "create-knowledge")
    limitations.push(
      "Failed attachment uploads in New Knowledge Item were produced by the browser dropping the upload request (Playwright route abort). The archived-item upload refusal was checked with a second request through the lab API after the browser hid Upload.",
      "The Archive Knowledge Item dialog now offers Replaced by with No replacement; the run archived with No replacement. The guide makes no claim about the replacement choice.",
    );
  const record = {
    articleId,
    contentSha256: hash,
    appCommit: log.appCommit,
    buildId: `app ${log.lab.appImageId}; engine ${log.lab.engineImageId}`,
    environment: log.lab.project,
    author: review.reviewer,
    technicalReviewer: review.reviewer,
    walkthroughReviewer: log.walkthroughReviewer,
    reviewerKind: "agent",
    verifiedAt: lastAt,
    status: "pass",
    sources: [
      guide,
      "docs/documentation/batches/DOC-030/shared-files/technical-review.json",
      `${REL}/walkthrough.mjs`,
      `${REL}/walkthrough.json`,
      `${REL}/lib.mjs`,
      ...author.sources,
    ],
    scenarios,
    limitations,
    previousEvidence: prev,
    copyOnlyReview: null,
    compatibilityReview: null,
  };
  fs.writeFileSync(path.join(root, "docs/documentation/evidence", `${articleId}.json`), JSON.stringify(record, null, 2) + "\n");
  written.push(articleId);
}
console.log("written", written.join(", ") || "none");
if (skipped.length) console.log("skipped\n  " + skipped.join("\n  "));
