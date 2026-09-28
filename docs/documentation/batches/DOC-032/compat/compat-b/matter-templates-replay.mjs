// DOC-032 compatibility replay (set compat-b), article matter-templates (V-C39). Copy of
// DOC-030/contracts-c/walkthrough.mjs with lib.mjs and templates.mjs in ./matter-templates-replay/.
// Changes: helper paths, only the templates part kept (signing and documents belong to other articles), lab `work`,
// seat label, output path. No step or check changed.
//   LAB_PASSWORD=... PART=templates node docs/documentation/batches/DOC-032/compat/compat-b/matter-templates-replay.mjs
// DOC-030 contracts-c independent walkthrough: electronic-signing, matter-templates,
// archive-and-delete-documents. One entry point; PART picks the article and phase:
//   PART=signing-main | signing-polling   lab c3sign (owned; signing stand-in applied by signing/up.sh)
//   PART=templates | documents            shared lab work2
// Run from the worktree root: LAB_PASSWORD=... PART=... node docs/documentation/batches/DOC-030/contracts-c/walkthrough.mjs
// Every run writes its section of walkthrough.json beside this file.
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PEOPLE,
  articleHash,
  labInfo,
  recorder,
  session,
  stampNow,
} from "./matter-templates-replay/lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

const PART = process.env.PART ?? "templates";
const parts = {
  templates: {
    lab: "work",
    article: "matter-templates",
    module: "./matter-templates-replay/templates.mjs",
    phase: "main",
  },
};
const part = parts[PART];
if (!part) throw new Error(`Set PART to one of ${Object.keys(parts).join(", ")}`);
const lab = labInfo(part.lab);
const STAMP = stampNow();
const rec = recorder(path.join(here, "matter-templates-replay.json"), PART, {
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
  seat: "DOC-032 compatibility reviewer (compat-b)",
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
