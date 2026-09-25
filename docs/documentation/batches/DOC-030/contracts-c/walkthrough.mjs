// DOC-030 contracts-c independent walkthrough: electronic-signing, matter-templates,
// archive-and-delete-documents. One entry point; PART picks the article and phase:
//   PART=signing-main | signing-polling   lab c3sign (owned; signing stand-in applied by signing/up.sh)
//   PART=templates | documents            shared lab work2
// Run from the worktree root: LAB_PASSWORD=... PART=... node docs/documentation/batches/DOC-030/contracts-c/walkthrough.mjs
// Every run writes its section of walkthrough.json beside this file.
import path from "node:path";
import { PEOPLE, articleHash, here, labInfo, recorder, session, stampNow } from "./lib.mjs";

const PART = process.env.PART;
const parts = {
  "signing-main": { lab: "c3sign", article: "electronic-signing", module: "./signing.mjs", phase: "main" },
  "signing-polling": { lab: "c3sign", article: "electronic-signing", module: "./signing.mjs", phase: "polling" },
  templates: { lab: "work2", article: "matter-templates", module: "./templates.mjs", phase: "main" },
  documents: { lab: "work2", article: "archive-and-delete-documents", module: "./documents.mjs", phase: "main" },
};
const part = parts[PART];
if (!part) throw new Error(`Set PART to one of ${Object.keys(parts).join(", ")}`);
const lab = labInfo(part.lab);
const STAMP = stampNow();
const rec = recorder(path.join(here, "walkthrough.json"), PART, {
  article: part.article,
  articleSha256: articleHash(part.article),
  phase: part.phase,
  labName: part.lab,
  environment: lab.project,
  appCommit: lab.sourceCommit,
  appImageId: lab.appImageId,
  engineImageId: lab.engineImageId,
  seed: lab.seed,
  stamp: STAMP,
  seat: "DOC-030 independent walkthrough agent (contracts-c)",
});
const sessions = session(lab.appUrl, lab.mailUrl);
await sessions.launch();
const ctx = {
  BASE: lab.appUrl,
  MAIL: lab.mailUrl,
  lab,
  STAMP,
  PHASE: part.phase,
  step: rec.step,
  results: rec.results,
  sessions,
  PEOPLE,
  here,
};
try {
  const run = (await import(part.module)).default;
  await run(ctx);
} catch (error) {
  rec.results.fatal = String(error?.stack ?? error).split("\n").slice(0, 6).join(" ");
  console.error(rec.results.fatal);
} finally {
  rec.save();
  await sessions.close();
}
const failed = rec.results.steps.filter((s) => s.result !== "pass").length;
console.log(`${PART}: ${rec.results.steps.length} steps, ${failed} not passing${rec.results.fatal ? ", fatal" : ""}`);
process.exitCode = failed || rec.results.fatal ? 1 : 0;
