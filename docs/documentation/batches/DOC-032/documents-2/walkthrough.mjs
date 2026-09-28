// DOC-032 documents-2 independent walkthrough: archive-and-delete-documents (V-C54),
// create-knowledge (V-C33), contributor-guide (V-C25), reference (V-C50).
// Written by the DOC-032 independent walkthrough agent (documents-2) from the article text,
// on the DOC-030 contracts-c walkthrough.mjs pattern (one entry point, one module per article).
// All parts run on the shared work lab built from 4ca41822.
//   PART=archive | knowledge | contributor | reference
// Run from the worktree root:
//   LAB_PASSWORD=... PART=archive node docs/documentation/batches/DOC-032/documents-2/walkthrough.mjs
// Every run replaces its own section of walkthrough.json beside this file.
import path from "node:path";
import { PEOPLE, articleHash, here, labInfo, recorder, session, stampNow } from "./lib.mjs";

const PART = process.env.PART;
const parts = {
  archive: { article: "archive-and-delete-documents", module: "./archive.mjs" },
  knowledge: { article: "create-knowledge", module: "./knowledge.mjs" },
  contributor: { article: "contributor-guide", module: "./contributor.mjs" },
  reference: { article: "reference", module: "./reference.mjs" },
};
const part = parts[PART];
if (!part) throw new Error(`Set PART to one of ${Object.keys(parts).join(", ")}`);
const lab = labInfo("work");
const STAMP = stampNow();
const rec = recorder(path.join(here, "walkthrough.json"), PART, {
  article: part.article,
  articleSha256: articleHash(part.article),
  labName: lab.name,
  environment: lab.project,
  appCommit: lab.sourceCommit,
  appImageId: lab.appImageId,
  engineImageId: lab.engineImageId,
  seed: lab.seed,
  stamp: STAMP,
  seat: "DOC-032 independent walkthrough agent (documents-2)",
  browser: "Playwright 1.63.0 Chromium, headless, one browser context per identity",
  records: [],
  productBugs: [],
  limitations: [],
});
const sessions = session(lab.appUrl, lab.mailUrl);
await sessions.launch();
const ctx = {
  BASE: lab.appUrl,
  MAIL: lab.mailUrl,
  lab,
  STAMP,
  step: rec.step,
  results: rec.results,
  save: rec.save,
  sessions,
  PEOPLE,
  here,
};
try {
  const run = (await import(part.module)).default;
  await run(ctx);
} catch (error) {
  rec.results.fatal = String(error?.stack ?? error)
    .split("\n")
    .slice(0, 6)
    .join(" ");
  console.error(rec.results.fatal);
} finally {
  rec.save();
  await sessions.close();
}
const failed = rec.results.steps.filter((s) => s.result !== "pass").length;
console.log(
  `${PART}: ${rec.results.steps.length} steps, ${failed} not passing${rec.results.fatal ? ", fatal" : ""}`,
);
process.exitCode = failed || rec.results.fatal ? 1 : 0;
