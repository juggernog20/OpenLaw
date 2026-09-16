// Writes docs/documentation/evidence/<id>.json for each documents-group article whose
// walkthrough-r1.json steps all passed for every required role. A failing article keeps
// its earlier record untouched. Written by the DOC-029 independent walkthrough agent
// (documents, round 1). Run from the worktree root:
//   mise exec -- node docs/documentation/batches/DOC-029/documents/evidence-r1.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const rel = (p) => path.relative(root, p);
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const log = JSON.parse(fs.readFileSync(path.join(here, "walkthrough-r1.json"), "utf8"));
const review = JSON.parse(fs.readFileSync(path.join(here, "technical-review.json"), "utf8"));
const scenarios = JSON.parse(
  fs.readFileSync(path.join(root, "docs/documentation/scenarios.json"), "utf8"),
).scenarios;
const SUMMARY = JSON.parse(fs.readFileSync(path.join(here, "evidence-summaries-r1.json"), "utf8"));
const REVIEWER = "DOC-029 independent walkthrough agent (documents, round 1)";
const TECH = "DOC-029 source-review author agent (documents)";
const images = log.lab.images;
const buildId = `app ${images.app}; engine ${images["doc-engine"]}`;
const evidencePaths = [
  rel(path.join(here, "walkthrough-r1.json")),
  rel(path.join(here, "walkthrough-r1.mjs")),
];
const written = [];
const skipped = [];

for (const article of review.articles) {
  const id = article.articleId;
  const file = path.join(root, "docs/user-guides", `${id}.md`);
  const contentSha256 = sha(fs.readFileSync(file));
  const required = scenarios.filter((s) => s.articles.includes(id));
  const steps = log.steps.filter((s) => s.article === id);
  const problems = [];
  if (log.articleHashes[id] !== contentSha256)
    problems.push("article bytes changed after the walkthrough");
  if (steps.length === 0) problems.push("no steps");
  if (steps.some((s) => s.result !== "pass")) problems.push("a step did not pass");
  for (const s of required)
    for (const role of s.roles)
      if (!steps.some((st) => st.scenario === s.id && st.role === role && st.result === "pass"))
        problems.push(`no passing step for ${s.id}/${role}`);
  if (problems.length) {
    skipped.push({ id, problems });
    continue;
  }
  const evidenceFile = path.join(root, "docs/documentation/evidence", `${id}.json`);
  const old = JSON.parse(fs.readFileSync(evidenceFile, "utf8"));
  const record = {
    articleId: id,
    contentSha256,
    appCommit: log.appCommit,
    buildId,
    environment: log.lab.project,
    author: `${old.author}; corrections by ${TECH}`,
    technicalReviewer: TECH,
    walkthroughReviewer: REVIEWER,
    reviewerKind: "agent",
    verifiedAt: new Date().toISOString(),
    status: "pass",
    sources: [
      `docs/user-guides/${id}.md`,
      ...article.sources,
      rel(path.join(here, "technical-review.json")),
      ...evidencePaths,
    ],
    scenarios: required.flatMap((s) =>
      s.roles.flatMap((role) =>
        s.requiredMethods.map((method) => {
          const mine = steps.filter((st) => st.scenario === s.id && st.role === role);
          return {
            id: s.id,
            coverage: s.coverage,
            role,
            method,
            prerequisites: SUMMARY[id].prerequisites,
            expected: [...s.expectedResults, ...s.negativeChecks].join(" "),
            actual: `${mine.length} recorded browser steps passed for this role. ${SUMMARY[id].actual[role]}`,
            result: "pass",
            evidence: [...evidencePaths, ...(SUMMARY[id].screenshots?.[role] ?? [])],
          };
        }),
      ),
    ),
    limitations: SUMMARY[id].limitations,
    previousEvidence: {
      appCommit: old.appCommit,
      contentSha256: old.contentSha256,
      verifiedAt: old.verifiedAt,
    },
    copyOnlyReview: null,
    compatibilityReview: null,
  };
  fs.writeFileSync(evidenceFile, JSON.stringify(record, null, 2) + "\n");
  written.push(id);
}
console.log(JSON.stringify({ written, skipped }, null, 2));
