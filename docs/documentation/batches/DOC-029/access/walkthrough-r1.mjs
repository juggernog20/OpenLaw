// DOC-029 access independent walkthrough, round 1. Usage: node walkthrough-r1.mjs [module ...]
// Modules: staff portal home search settings. Writes walkthrough-r1.json (or walkthrough-r1.<modules>.json for a partial run).
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeLog, close, PROJECT, BASE, MAIL } from "./lib-r1.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const all = { staff: "./wt-staff-sign-in-r1.mjs", portal: "./wt-portal-sign-in-r1.mjs", home: "./wt-find-your-work-r1.mjs", search: "./wt-search-and-views-r1.mjs", settings: "./wt-personal-settings-r1.mjs" };
const chosen = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(all);
const images = Object.fromEntries(
  ["app", "worker", "doc-engine"].map((svc) => [svc, execFileSync("docker", ["inspect", "-f", "{{.Image}}", `${PROJECT}-${svc}-1`], { encoding: "utf8" }).trim()]),
);
const log = makeLog({
  batch: "DOC-029",
  group: "access",
  round: 1,
  walkthroughReviewer: "DOC-029 independent walkthrough agent (access, round 1)",
  reviewerKind: "agent",
  appCommit: "3fa407e3a846559914aa1a63249741f30cfb4f69",
  environment: PROJECT,
  appUrl: BASE,
  mailUrl: MAIL,
  runningImages: images,
  labStatusImages: (() => {
    const lab = JSON.parse(readFileSync(path.resolve(here, "../../../../../.documentation-labs/work/lab.json"), "utf8"));
    return { project: lab.project, sourceCommit: lab.sourceCommit, appImageId: lab.appImageId, engineImageId: lab.engineImageId, seed: lab.seed };
  })(),
  browser: "Playwright 1.63.0 Chromium (node_modules/.pnpm), headless, 1440x900, one isolated context per account or device",
  modules: chosen,
  startedAt: new Date().toISOString(),
});
const fx = { accounts: {}, contexts: {}, created: [] };
let crash = null;
for (const name of chosen) {
  const mod = await import(all[name]);
  try {
    await mod.run(log, fx);
  } catch (e) {
    crash = `${name}: ${String(e.message).split("\n")[0]}`;
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
const out = chosen.length === Object.keys(all).length ? "walkthrough-r1.json" : `walkthrough-r1.${chosen.join("-")}.json`;
const summary = { total: log.steps.length, passed: log.steps.filter((s) => s.result === "pass").length, failed: log.steps.filter((s) => s.result === "fail").length };
writeFileSync(path.join(here, out), JSON.stringify({ ...log.meta, summary, steps: log.steps }, null, 2) + "\n");
console.log(out, summary);
