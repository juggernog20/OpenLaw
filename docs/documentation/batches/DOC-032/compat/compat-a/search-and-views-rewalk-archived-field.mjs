// DOC-032 compatibility replay (set compat-a), article search-and-views (V-C04), archived-Field step.
// Copy of the DOC-030 script docs/documentation/batches/DOC-030/search/rewalk-archived-field.mjs.
// Seat: DOC-032 compatibility reviewer (compat-a). Lab: .documentation-labs/work/lab.json.
// Changed from the DOC-030 script, and nothing else (no step, selector, expected text or check):
// - import paths and the repository root go one folder deeper (compat/compat-a/);
// - lab manifest work2 -> work (app http://127.0.0.1:43340);
// - FX_FILE default -> ~/.cache/doc032-compat-a-search-replay-fx.json (the accounts made by search-and-views-replay.mjs);
// - fixture Field and saved-search names "DOC-030 search V-C04 <stamp> ..." -> "DOC-032 compat compat-a search <last 6 stamp digits> ...";
// - log path walkthrough.json -> search-and-views-replay.json; the run is appended under `reruns` (as in DOC-030)
//   and under `runs`; the rerun reason names the replay.
// Usage (after search-and-views-replay.mjs): LAB_PASSWORD=<seed demo password> node search-and-views-rewalk-archived-field.mjs
//
// Original DOC-030 header:
// DOC-030 search re-walk after the author's change to the archived-Field sentence (guide hash e68143e1…).
// Re-walks only the archived-Field saved-search step for both roles with a fresh fixture Field, then
// appends the run to walkthrough.json under "reruns". Earlier steps and their times stay as they are.
// Usage: LAB_PASSWORD=<seed demo password> node rewalk-archived-field.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Session } from "../../../../../../scripts/seed/client.mjs";
import { chromium } from "../../../../../../node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../../..");
const LAB = JSON.parse(readFileSync(path.join(root, ".documentation-labs/work/lab.json"), "utf8"));
const BASE = LAB.appUrl;
const PASSWORD = process.env.LAB_PASSWORD;
if (!PASSWORD) throw new Error("Set LAB_PASSWORD to the seed demo password in VALIDATION.md.");
const FX_FILE =
  process.env.FX_FILE ??
  path.join(process.env.HOME, ".cache/doc032-compat-a-search-replay-fx.json");
const fx = JSON.parse(readFileSync(FX_FILE, "utf8"));
const H = { headers: { origin: BASE } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const steps = [];
const record = (role, step, expected, actual, pass, page) => {
  steps.push({
    article: "search-and-views",
    scenario: "V-C04",
    role,
    step,
    page,
    expected,
    actual,
    result: pass ? "pass" : "fail",
    at: new Date().toISOString(),
  });
  console.log(`${pass ? "PASS" : "FAIL"} [${role}] ${step} :: ${actual}`);
};
const seen = (loc, timeout = 10000) =>
  loc
    .first()
    .waitFor({ timeout })
    .then(
      () => true,
      () => false,
    );
const txt = async (loc) =>
  (
    await loc
      .first()
      .innerText({ timeout: 5000 })
      .catch(() => "")
  )
    .replace(/\s+/g, " ")
    .trim();
const startedAt = new Date().toISOString();
const guideSha256 = execFileSync(
  "sha256sum",
  [path.join(root, "docs/user-guides/search-and-views.md")],
  { encoding: "utf8" },
).split(" ")[0];

// Fresh fixture Field, created by Daniel Okafor.
const d = new Session("daniel", BASE);
await d.request("POST", "/api/auth/sign-in/email", {
  json: { email: "daniel.okafor@helix.example", password: PASSWORD },
  headers: { origin: BASE },
});
const stamp = Date.now();
const created = (
  await d.post(
    "/api/v1/fields",
    {
      displayName: `DOC-032 compat compat-a search ${String(stamp).slice(-6)} ref`,
      moduleScope: "contract",
      fieldType: "text",
    },
    H,
  )
).body.field;
const field = { id: created.id, label: created.displayName };
console.log(`fixture Field ${field.label}`);

const browser = await chromium.launch({ headless: true });
const ctx = {};
for (const role of ["administrator", "legal_team_member"]) {
  const acct = fx.accounts[role];
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    timezoneId: "Europe/London",
  });
  const p = await context.newPage();
  await p.goto(`${BASE}/auth/login`);
  await p.getByLabel("Email").fill(acct.email);
  await p.getByLabel("Password").fill(acct.password);
  await p.getByRole("button", { name: "Sign in", exact: true }).click();
  await p.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 });
  await sleep(1000);
  // Build and save a question with a condition on the fresh Field (the guide's Save and reopen steps).
  const name = `DOC-032 compat compat-a search ${String(stamp).slice(-6)} field ${role === "administrator" ? "A" : "M"}`;
  await p.getByRole("button", { name: "Advanced search", exact: true }).click();
  const dialog = p.getByRole("dialog", { name: "Advanced search" });
  await dialog.waitFor();
  await dialog
    .getByRole("group", { name: "Kinds" })
    .getByRole("button", { name: "Contract", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Add condition" }).click();
  const props = p.getByRole("dialog", { name: "Properties" });
  await props.getByLabel("Search properties").fill(field.label);
  await props
    .getByRole("group", { name: "Contract" })
    .getByRole("button", { name: field.label, exact: true })
    .click();
  await dialog
    .getByRole("group", { name: `Contract ${field.label} condition` })
    .getByLabel("Value")
    .fill("ref");
  await sleep(1500);
  await dialog.getByRole("button", { name: "Save search", exact: true }).click();
  const save = p.getByRole("dialog", { name: "Save this search" });
  await save.getByLabel("Name").fill(name);
  await save.getByRole("button", { name: "Save", exact: true }).click();
  await save.waitFor({ state: "detached" });
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await p.waitForURL(/aq=/);
  ctx[role] = { context, p, name, url: p.url() };
}

// An Administrator archives the Field.
await d.post(`/api/v1/fields/${field.id}/archive`, {}, H);
await sleep(1500);

for (const [role, { context, p, name, url }] of Object.entries(ctx)) {
  // Results page with the question that used the Field.
  await p.goto(url);
  const pageNotice = await seen(p.getByText("Unavailable Field conditions were removed."), 15000);
  const chips = await p.getByRole("button", { name: /^Edit / }).count();
  // The saved search run from the empty header box Saved group.
  await p.goto(`${BASE}/`);
  await sleep(1000);
  await p.getByRole("combobox", { name: "Search" }).click();
  const lb = p.getByRole("listbox", { name: "Search results" });
  await lb.waitFor();
  await sleep(1200);
  await lb.getByRole("group", { name: "Saved" }).getByRole("option", { name }).click();
  await p.waitForURL(/aq=/);
  const headerNotice = await seen(p.getByText("Unavailable Field conditions were removed."), 15000);
  // The saved search selected under Saved searches in the dialog.
  await p.getByRole("button", { name: "Advanced", exact: true }).click();
  const dialog = p.getByRole("dialog", { name: "Advanced search" });
  await dialog.waitFor();
  const saved = dialog.getByRole("region", { name: "Saved searches" });
  await saved.getByRole("button", { name, exact: true }).click();
  await sleep(2000);
  const dialogNotice = await txt(dialog.getByRole("status").filter({ hasText: "removed" }));
  const rowGone = !(await dialog
    .getByRole("group", { name: `Contract ${field.label} condition` })
    .isVisible());
  record(
    role,
    "Re-walk (guide e68143e1): a Field an Administrator archives is removed from the question with a notice",
    "The results page and a saved search run from the header say Unavailable Field conditions were removed.; selecting that saved search under Saved searches in the dialog says Unavailable search conditions were removed.; the Field condition is gone",
    `Results page notice ${pageNotice}, condition chips left ${chips}; header Saved entry notice ${headerNotice}; dialog notice "${dialogNotice}", Field row gone ${rowGone}`,
    pageNotice &&
      chips === 0 &&
      headerNotice &&
      dialogNotice === "Unavailable search conditions were removed." &&
      rowGone,
    "/search",
  );
  // Clean up this walker's saved search.
  await saved.getByRole("button", { name: `Manage ${name}` }).click();
  await p.getByRole("menuitem", { name: "Delete…" }).click();
  await p
    .getByRole("dialog", { name: "Delete this saved search?" })
    .getByRole("button", { name: "Delete" })
    .click();
  await sleep(1000);
  await context.close();
}
await browser.close();

const logPath = path.join(here, "search-and-views-replay.json");
const log = JSON.parse(readFileSync(logPath, "utf8"));
log.reruns ??= [];
log.reruns.push({
  reason:
    "DOC-032 replay of the DOC-030 re-walk of the archived-Field step (guide e68143e1 names the Saved searches dialog notice). Only that step was walked again; the earlier steps stand with their times.",
  guideSha256,
  startedAt,
  finishedAt: new Date().toISOString(),
  fixtures: {
    created: [`contract Field "${field.label}" (archived by Daniel Okafor during the re-walk)`],
  },
  summary: {
    total: steps.length,
    passed: steps.filter((s) => s.result === "pass").length,
    failed: steps.filter((s) => s.result === "fail").length,
  },
  steps,
});
log.runs ??= [];
log.runs.push({
  attempt: log.runs.length + 1,
  script: "search-and-views-rewalk-archived-field.mjs",
  roles: ["administrator", "legal_team_member"],
  fixturesStamp: fx.stamp,
  startedAt,
  finishedAt: log.reruns.at(-1).finishedAt,
  note: process.env.RUN_NOTE ?? null,
  superseded: false,
  summary: log.reruns.at(-1).summary,
  steps,
});
writeFileSync(logPath, JSON.stringify(log, null, 2) + "\n");
console.log(log.reruns.at(-1).summary);
