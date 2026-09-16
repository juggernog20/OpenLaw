// DOC-029 round 2 access independent walkthrough, walkthrough round 1. Usage: node walkthrough-r2-1.mjs [staff] [portal]
// Adapted from walkthrough-r1.mjs for app commit 57e77e38 on the work2 lab. Adds the sign-in branding checks.
// Writes walkthrough-r2-1.json (or walkthrough-r2-1.<modules>.json for a partial run). No links, cookies, secrets or passwords are logged.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeLog, close, PROJECT, BASE, MAIL } from "./lib-r2-1.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const all = { staff: "./wt-staff-sign-in-r2-1.mjs", portal: "./wt-portal-sign-in-r2-1.mjs" };
const chosen = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(all);
const images = Object.fromEntries(
  ["app", "worker", "doc-engine"].map((svc) => [svc, execFileSync("docker", ["inspect", "-f", "{{.Image}}", `${PROJECT}-${svc}-1`], { encoding: "utf8" }).trim()]),
);
const articleHashes = Object.fromEntries(
  ["staff-sign-in", "portal-sign-in"].map((id) => [
    id,
    execFileSync("sha256sum", [path.resolve(here, `../../../../user-guides/${id}.md`)], { encoding: "utf8" }).split(" ")[0],
  ]),
);
const log = makeLog({
  batch: "DOC-029",
  group: "access",
  round: 2,
  walkthroughRound: 1,
  walkthroughReviewer: "DOC-029r2 independent walkthrough agent (access, round 1)",
  reviewerKind: "agent",
  appCommit: "57e77e386be31b2a319f7143dd54d00123e65efe",
  environment: PROJECT,
  appUrl: BASE,
  mailUrl: MAIL,
  articleContentSha256: articleHashes,
  runningImages: images,
  labStatusImages: (() => {
    const lab = JSON.parse(readFileSync(path.resolve(here, "../../../../../.documentation-labs/work2/lab.json"), "utf8"));
    return { project: lab.project, sourceCommit: lab.sourceCommit, appImageId: lab.appImageId, engineImageId: lab.engineImageId, seed: lab.seed };
  })(),
  browser: "Playwright 1.63.0 Chromium (node_modules/.pnpm), headless, 1440x900, one isolated context per account or device",
  modules: chosen,
  startedAt: new Date().toISOString(),
});
const fx = { accounts: {}, contexts: {}, created: [] };
for (const name of chosen) {
  const mod = await import(all[name]);
  try {
    await mod.run(log, fx);
  } catch (e) {
    const crash = `${name}: ${String(e.message).split("\n")[0]}`;
    console.error(String(e.message).split("\n").slice(0, 4).join("\n"));
    log.record(name, "-", "script error", "module completes", crash, false);
  }
}
await close();
log.meta.finishedAt = new Date().toISOString();
log.meta.fixtures = {
  accounts: Object.fromEntries(Object.entries(fx.accounts).map(([k, v]) => [k, { email: v.email, displayName: v.displayName }])),
  created: fx.created,
};
const out = chosen.length === Object.keys(all).length ? "walkthrough-r2-1.json" : `walkthrough-r2-1.${chosen.join("-")}.json`;
const summary = {
  total: log.steps.length,
  passed: log.steps.filter((s) => s.result === "pass").length,
  failed: log.steps.filter((s) => s.result === "fail").length,
  notRun: log.steps.filter((s) => s.result === "not-run").length,
};
writeFileSync(path.join(here, out), JSON.stringify({ ...log.meta, summary, steps: log.steps }, null, 2) + "\n");
console.log(out, summary);
