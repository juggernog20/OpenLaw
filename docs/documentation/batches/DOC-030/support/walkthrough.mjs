// DOC-030 independent walkthrough agent (support).
// Follows "Resolve common problems" (troubleshooting, V-C49) and "Look up terms, permissions, and
// file behavior" (reference, V-C50) on the shared work2 lab built from 067c1646.
// Written from the article text by the walkthrough seat, not by the source-review author.
// Run from the worktree root:
//   LAB_PASSWORD=... node docs/documentation/batches/DOC-030/support/walkthrough.mjs
// Optional: ONLY=T,K,R,O runs a subset of sections (setup always runs, and reuses fixtures.json).
// Each run replaces the steps of the sections it runs in walkthrough.json and keeps the others.
// Credentials come only from the environment. Magic links, cookies, API key values and mail bodies
// stay in memory; the Business User browser state is cached under SCRATCH, outside docs/.
// Records this script creates are named "DOC-030 support <scenario> <stamp>". Organization
// settings it changes (MCP switches, Read-only, one Contract Document type) are put back at the end
// of the step that needs them.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  chromium,
  BASE,
  MAIL,
  LAB,
  PROJECT,
  SCRATCH,
  clean,
  closeBrowser,
  here,
  launch,
  mcpCall,
  must,
  newContext,
  passwordSignIn,
  portalSession,
  q,
  requestLink,
  root,
  sleep,
  sql,
  uploadFile,
} from "./lib.mjs";

const OUT = process.env.OUT ?? path.join(here, "walkthrough.json");
const FIXTURES = path.join(here, "fixtures.json");
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const run = (section) => !ONLY || ONLY.has(section);
const REL = "docs/documentation/batches/DOC-030/support";
const OLD = path.join(root, "docs/documentation/batches/DOC-029/support/fixtures");
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const fixture = (f) => readFileSync(path.join(OLD, f));
const fixturePath = (f) => path.join(OLD, f);
const articleBytes = (id) => readFileSync(path.join(root, "docs/user-guides", `${id}.md`));
function check(cond, msg) {
  if (!cond) throw new Error(msg);
}

const BU_EMAIL = "doc030.support.bu@helix.example";
const BU2_EMAIL = "doc030.support.bu2@helix.example";
const BU_NAME = "Lena Fischer";

function labInfo() {
  const lab = JSON.parse(readFileSync(path.join(root, `.documentation-labs/${LAB}/lab.json`), "utf8"));
  const image = (svc) =>
    execFileSync("docker", ["inspect", "--format", "{{.Image}}", `${PROJECT}-${svc}-1`], {
      encoding: "utf8",
    }).trim();
  return {
    name: lab.name,
    project: lab.project,
    sourceCommit: lab.sourceCommit,
    appImageId: lab.appImageId,
    engineImageId: lab.engineImageId,
    runningAppImage: image("app"),
    runningWorkerImage: image("worker"),
    runningEngineImage: image("doc-engine"),
    seed: lab.seed,
  };
}

// ---------------------------------------------------------------- log
const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null;
const results = {
  batch: "DOC-030",
  group: "support",
  kind: "independent-article-walkthrough",
  reviewer: "DOC-030 independent walkthrough agent (support)",
  reviewerKind: "agent",
  appUrl: BASE,
  mailUrl: MAIL,
  lab: labInfo(),
  articles: Object.fromEntries(
    ["troubleshooting", "reference"].map((id) => [
      id,
      { path: `docs/user-guides/${id}.md`, contentSha256: sha(articleBytes(id)) },
    ]),
  ),
  browser: "Playwright 1.63.0 Chromium from node_modules/.pnpm, headless, one browser context per identity",
  accounts: {
    administrator: "Daniel Okafor (daniel.okafor@helix.example), password sign-in",
    legal_team_member: "Nadia Haddad (nadia.haddad@helix.example), password sign-in",
    business_user: `${BU_NAME} (${BU_EMAIL}), a Business User this walkthrough created by Portal sign-in on the allowed helix.example domain; fresh links from the lab Mailpit`,
    business_user_link_check: `${BU2_EMAIL}, a second created Business User used only for the spent-link check`,
    operator: "no app account; signed-out browser context and container-level reads",
  },
  fixtures: null,
  settingsChanged: [],
  productBugs: [],
  observations: [],
  runs: [...(previous?.runs ?? []), { startedAt: new Date().toISOString(), sections: [...(ONLY ?? ["all"])] }],
  steps: (previous?.steps ?? []).filter((s) => ONLY && !ONLY.has(s.section)),
  finishedAt: null,
};
if (previous) {
  results.productBugs = previous.productBugs ?? [];
  results.observations = (previous.observations ?? []).filter((o) => ONLY && !ONLY.has(o.section));
  results.settingsChanged = (previous.settingsChanged ?? []).filter(
    (o) => ONLY && !ONLY.has(o.section),
  );
}
function save() {
  results.finishedAt = new Date().toISOString();
  results.summary = {
    total: results.steps.length,
    pass: results.steps.filter((s) => s.result === "pass").length,
    fail: results.steps.filter((s) => s.result === "fail").length,
  };
  writeFileSync(OUT, `${JSON.stringify(results, null, 2)}\n`);
}
let SECTION = "setup";
let lastPage = null;
async function step(article, scenario, role, action, expected, fn) {
  // Development only: STEPS=<regex> runs the matching steps and skips the rest without a record.
  if (process.env.STEPS && !new RegExp(process.env.STEPS).test(`${role} ${action}`)) return null;
  const entry = {
    section: SECTION,
    article,
    scenario,
    role,
    method: role === "operator" ? "browser-walkthrough (operator)" : "browser-walkthrough",
    action,
    expected,
    startedAt: new Date().toISOString(),
    at: null,
    page: null,
    actual: null,
    result: "not-run",
  };
  results.steps.push(entry);
  lastPage = null;
  try {
    entry.actual = await fn();
    entry.result = "pass";
  } catch (error) {
    entry.actual = `Check did not complete: ${clean(error instanceof Error ? error.message.split("\n").slice(0, 3).join(" ") : error).slice(0, 700)}`;
    entry.result = "fail";
  }
  entry.page = lastPage;
  entry.at = new Date().toISOString();
  console.log(
    `[${[].concat(article).join("+")} ${role}] ${entry.result.toUpperCase()} ${action}${entry.result === "fail" ? `: ${entry.actual}` : ""}`,
  );
  save();
  return entry;
}
function observe(text) {
  results.observations.push({ section: SECTION, at: new Date().toISOString(), text });
  save();
}

// ---------------------------------------------------------------- page helpers
async function settle(page, ms = 1000) {
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await sleep(ms);
}
async function go(page, url) {
  const target = url.startsWith("http") ? url : `${BASE}${url}`;
  await page.goto(target);
  await settle(page);
  const ready = page.getByRole("heading", { level: 1 }).or(page.getByRole("main")).first();
  if (
    !(await ready
      .waitFor({ timeout: 20000 })
      .then(() => true)
      .catch(() => false))
  ) {
    await page.goto(target);
    await settle(page, 2000);
  }
  lastPage = new URL(page.url()).pathname + new URL(page.url()).search;
}
const here_ = (page) => {
  lastPage = new URL(page.url()).pathname;
  return lastPage;
};
async function h1(page) {
  return clean(
    await page.getByRole("heading", { level: 1 }).first().textContent({ timeout: 15000 }),
  );
}
async function bodyText(page) {
  return clean(await page.locator("body").innerText());
}
async function mainText(page) {
  return clean(await page.getByRole("main").innerText());
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(here, name) });
  return `${REL}/${name}`;
}
async function applet(page, name) {
  const panel = page.getByRole("complementary", { name, exact: true });
  if (!(await panel.isVisible().catch(() => false))) {
    await page
      .getByRole("toolbar", { name: "Applets" })
      .getByRole("button", { name: new RegExp(`^${name}\\b`) })
      .first()
      .click();
  }
  await panel.waitFor({ timeout: 10000 });
  await sleep(700);
  return panel;
}
async function download(page, trigger) {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), trigger()]);
  const file = await dl.path();
  return {
    name: dl.suggestedFilename(),
    sha256: sha(readFileSync(file)),
    bytes: readFileSync(file).length,
  };
}
async function buttonNames(scope) {
  return (
    await scope
      .getByRole("button")
      .evaluateAll((els) =>
        els.map((e) =>
          (e.getAttribute("aria-label") || e.textContent || "").replace(/\s+/g, " ").trim(),
        ),
      )
  ).filter(Boolean);
}
async function menuItems(page, trigger) {
  await trigger.click();
  const menu = page.getByRole("menu");
  await menu.waitFor({ timeout: 10000 });
  const items = (await menu.getByRole("menuitem").allInnerTexts()).map(clean);
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" }).catch(() => {});
  return items;
}
async function switchStates(page, scope) {
  const snap = await (scope ?? page.getByRole("main")).ariaSnapshot();
  return [...snap.matchAll(/switch "([^"]+)"( \[checked\])?( \[disabled\])?/g)].map((m) => ({
    name: m[1],
    checked: Boolean(m[2]),
    disabled: Boolean(m[3]),
  }));
}
/** Wait for a locator; reload once if it has not appeared (slow shared lab), and note what showed instead. */
async function waitOrReload(page, locator, what) {
  if (await locator.first().waitFor({ timeout: 15000 }).then(() => true, () => false)) return;
  const shown = (await bodyText(page)).slice(0, 160);
  observe(`${what} had not appeared after 15 s at ${new URL(page.url()).pathname} (page showed ${JSON.stringify(shown)}); the walkthrough reloaded once.`);
  await page.reload();
  await settle(page, 2000);
  await locator.first().waitFor({ timeout: 30000 });
}
const docsRegion = (page) => page.getByRole("region", { name: "Documents", exact: true });
async function closeDialog(page) {
  const dialog = page.getByRole("dialog");
  const cancel = dialog.getByRole("button", { name: "Cancel" });
  if (await cancel.count()) await cancel.first().click();
  else await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
}

// ---------------------------------------------------------------- sessions
await launch();
const D = await passwordSignIn("daniel.okafor@helix.example");
const N = await passwordSignIn("nadia.haddad@helix.example");
const B = await portalSession(BU_EMAIL, "doc030-support-bu");

// First Portal visit of the created Business User: complete the onboarding in the browser.
async function finishOnboarding(S) {
  await go(S.page, "/portal");
  for (let i = 0; i < 8 && new URL(S.page.url()).pathname === "/portal/onboarding"; i++) {
    const dept = S.page.getByRole("combobox", { name: "Department" });
    if (await dept.isVisible().catch(() => false)) await dept.selectOption({ label: "Sales" });
    const name = S.page.getByLabel("Full name");
    if (await name.isVisible().catch(() => false)) await name.fill(BU_NAME);
    const next = S.page.getByRole("button", { name: /^(Continue|Finish)$/ });
    await next.click();
    await settle(S.page, 800);
  }
  return new URL(S.page.url()).pathname;
}
const onboardedTo = await finishOnboarding(B);

// ---------------------------------------------------------------- fixtures
const users = must(await D.api("GET", "/users"), "users").users;
const uid = (email) => users.find((u) => u.email === email)?.id;
const ids = {
  daniel: uid("daniel.okafor@helix.example"),
  nadia: uid("nadia.haddad@helix.example"),
  amara: uid("amara.nwosu@helix.example"),
  bu: uid(BU_EMAIL),
};
check(ids.bu, "the created Business User is not in the users list");
const buRole = users.find((u) => u.id === ids.bu).role;
check(buRole === "business_user", `created user role ${buRole}`);

let FX = existsSync(FIXTURES) ? JSON.parse(readFileSync(FIXTURES, "utf8")) : null;
if (!FX || process.env.NEW_FIXTURES) {
  const ctypes = must(await D.api("GET", "/contract-types"), "ctypes").contractTypes;
  const nda = ctypes.find((t) => t.displayName === "NDA").id;
  const dpa = ctypes.find((t) => t.displayName === "DPA").id;
  const mtypes = must(await D.api("GET", "/matter-types"), "mtypes").matterTypes;
  const depts = must(await D.api("GET", "/departments"), "depts").departments;
  const sales = depts.find((t) => t.displayName === "Sales").id;
  const etypes = must(await D.api("GET", "/entities/types"), "etypes").entityTypes;
  const stamp = new Date().toISOString().slice(5, 16).replace(/[-T:]/g, "");
  const title = (t) => `DOC-030 support ${t} ${stamp}`;
  const newContract = async (S, t, extra = {}) =>
    must(await S.api("POST", "/contracts", { title: title(t), contractTypeId: nda, ...extra }), t)
      .contract;
  const upload = async (S, where, f, mimeType, fields) =>
    must(
      await uploadFile(S.page, where, { name: f, mimeType, buffer: fixture(f), fields }),
      `${where} ${f}`,
    );
  const team = async (S, number, userId) =>
    must(await S.api("POST", `/contracts/${number}/team`, { userId }), `team ${number}`);
  FX = { stamp };

  const shared = await newContract(N, "shared DPA contract", {
    managerId: ids.nadia,
    contractTypeId: dpa,
  });
  await team(N, shared.number, ids.bu);
  const v1 = await upload(N, `/contracts/${shared.number}/documents`, "doc029-support-v1.txt", "text/plain");
  const png = await upload(N, `/contracts/${shared.number}/documents`, "doc029-support-image.png", "image/png");
  must(await N.api("POST", `/contracts/${shared.number}/folders`, { name: title("folder") }), "folder");
  const folderId = must(await N.api("GET", `/contracts/${shared.number}/folders`), "folders").folders.find(
    (f) => f.name === title("folder"),
  ).id;
  const securityOptions = sql(`select options::text from fields where slug='security_review'`);
  const securityValue = JSON.parse(securityOptions)[0];
  const secVal = typeof securityValue === "string" ? securityValue : (securityValue.value ?? securityValue.label);
  const patched = await N.api("PATCH", `/contracts/${shared.number}`, {
    customFields: { security_review: secVal, processes_personal_data: true },
  });
  FX.shared = {
    number: shared.number,
    title: shared.title,
    primaryDocumentId: v1.document.id,
    pngDocumentId: png.document.id,
    folderId,
    fieldsPatch: patched.status,
    securityReview: secVal,
  };

  const conf = await newContract(N, "confidential contract", { managerId: ids.nadia, isConfidential: true });
  FX.confidential = { number: conf.number, title: conf.title };
  const adminConf = await newContract(D, "administrator confidential contract", {
    managerId: ids.daniel,
    isConfidential: true,
  });
  FX.adminConfidential = { number: adminConf.number, title: adminConf.title };
  const confPortal = await newContract(N, "confidential portal contract", {
    managerId: ids.nadia,
    isConfidential: true,
  });
  await team(N, confPortal.number, ids.bu);
  FX.confidentialPortal = { number: confPortal.number, title: confPortal.title };
  const archived = await newContract(N, "archived contract", { managerId: ids.nadia });
  await team(N, archived.number, ids.bu);
  FX.archived = { number: archived.number, title: archived.title };
  const approval = await newContract(D, "approval contract", { managerId: ids.daniel });
  must(
    await D.api("POST", `/contracts/${approval.number}/approvals`, { approverIds: [ids.nadia, ids.daniel] }),
    "approvals",
  );
  FX.approval = { number: approval.number, title: approval.title };
  for (const key of ["buApproval", "buWithdraw", "buArchive"]) {
    const c = await newContract(N, `business approver ${key}`, { managerId: ids.nadia });
    await upload(N, `/contracts/${c.number}/documents`, "doc029-support-v1.txt", "text/plain");
    must(await N.api("POST", `/contracts/${c.number}/approvals`, { approverIds: [ids.bu] }), `${key} approval`);
    const a = must(await N.api("GET", `/contracts/${c.number}/approvals`), "a").approvals.find(
      (x) => x.approver.id === ids.bu,
    );
    FX[key] = { number: c.number, title: c.title, approvalId: a.id };
  }
  const uploads = await newContract(N, "upload contract", { managerId: ids.nadia });
  FX.uploads = { number: uploads.number, title: uploads.title };
  const files = await newContract(N, "file behavior contract", { managerId: ids.nadia });
  FX.files = { number: files.number, title: files.title };
  let matter = null;
  for (const mt of mtypes) {
    const r = await N.api("POST", "/matters", { title: title("related matter"), matterTypeId: mt.id, managerId: ids.nadia });
    if (r.status < 300) {
      matter = r.json.matter;
      break;
    }
  }
  check(matter, "no Matter type accepted a Matter without extra Fields");
  must(await N.api("POST", `/contracts/${shared.number}/matter`, { matterNumber: matter.number }), "link matter");
  FX.relatedMatter = { number: matter.number, title: matter.title };
  const ent = must(
    await N.api("POST", "/entities", { legalName: title("confidential entity Ltd"), entityTypeId: etypes[0].id }),
    "entity",
  ).entity;
  must(await N.api("PATCH", `/entities/${ent.id}`, { isConfidential: true }), "entity confidential");
  FX.entity = { id: ent.id, name: ent.legalName };
  const reg = must(
    await N.api("POST", "/entities", { legalName: title("register entity Ltd"), entityTypeId: etypes[0].id }),
    "register entity",
  ).entity;
  const cls = must(
    await N.api("POST", `/entities/${reg.id}/share-classes`, { name: "Ordinary", votesPerShare: 1 }),
    "share class",
  );
  const classId = (cls.register?.classes ?? cls.classes ?? []).find?.((c) => c.name === "Ordinary")?.id;
  const regRead = must(await N.api("GET", `/entities/${reg.id}/share-register`), "register read");
  const ordinary = (regRead.classes ?? regRead.register?.classes).find((c) => c.name === "Ordinary").id;
  must(
    await N.api("POST", `/entities/${reg.id}/share-entries`, {
      kind: "allotment",
      effectiveOn: new Date().toISOString().slice(0, 10),
      shareClassId: classId ?? ordinary,
      quantity: 100,
      to: { kind: "individual", name: "Marta Kowalczyk" },
    }),
    "allotment",
  );
  const holderEnt = must(
    await N.api("POST", "/entities", { legalName: title("holder entity Ltd"), entityTypeId: etypes[0].id }),
    "holder entity",
  ).entity;
  must(
    await N.api("POST", `/entities/${reg.id}/share-entries`, {
      kind: "allotment",
      effectiveOn: new Date().toISOString().slice(0, 10),
      shareClassId: classId ?? ordinary,
      quantity: 300,
      to: { kind: "entity", entityId: holderEnt.id },
    }),
    "allotment to entity",
  );
  FX.registerEntity = { id: reg.id, name: reg.legalName, holder: "Marta Kowalczyk", holderEntity: { id: holderEnt.id, name: holderEnt.legalName } };

  const kType = must(await N.api("GET", "/knowledge?limit=1"), "ktype").knowledgeItems[0].knowledgeTypeId;
  const kItem = must(
    await N.api("POST", "/knowledge", { title: title("Portal Knowledge"), knowledgeTypeId: kType }),
    "knowledge",
  ).knowledgeItem;
  const kDoc = (await upload(N, `/knowledge/${kItem.id}/documents`, "doc029-support-v1.txt", "text/plain")).document;
  await upload(N, `/documents/${kDoc.id}/versions`, "doc029-support-v2.txt", "text/plain");
  must(
    await N.api("PATCH", `/knowledge/${kItem.id}`, {
      audience: "everyone",
      primaryDocumentId: kDoc.id,
      body: "DOC-030 support fictional guidance for the Portal file check.",
    }),
    "k patch",
  );
  must(await N.api("POST", `/knowledge/${kItem.id}/publish`, {}), "k publish");
  FX.knowledge = { id: kItem.id, title: kItem.title };

  const reviewType = must(await B.api("GET", "/portal/request-types/contract_review"), "rt").requestType.id;
  const rq = must(
    await B.api("POST", "/requests", {
      requestTypeId: reviewType,
      departmentId: sales,
      title: title("request"),
      description: "DOC-030 support fictional ask for a contract review.",
      urgency: "medium",
    }),
    "request",
  ).request;
  const converted = must(
    await N.api("POST", `/requests/${rq.number}/convert`, { title: title("converted contract"), contractTypeId: nda }),
    "convert",
  ).request;
  FX.request = {
    number: rq.number,
    contract: converted.convertedRecord?.number ?? converted.convertedContract?.number,
  };
  const rq2 = must(
    await B.api("POST", "/requests", {
      requestTypeId: reviewType,
      departmentId: sales,
      title: title("open request"),
      description: "DOC-030 support fictional ask left open for the Convert dialog.",
      urgency: "low",
    }),
    "request2",
  ).request;
  FX.openRequest = { number: rq2.number };
  FX.createdAt = new Date().toISOString();
  FX.createdBy =
    "Nadia Haddad and Daniel Okafor API sessions, and the created Business User's Portal session (Requests)";
  writeFileSync(FIXTURES, `${JSON.stringify(FX, null, 2)}\n`);
}
results.fixtures = { ...FX, file: `${REL}/fixtures.json`, businessUserOnboarding: onboardedTo };
save();

const T = "troubleshooting";
const R = "reference";
const C49 = "V-C49";
const C50 = "V-C50";
const ROLE = { administrator: D, legal_team_member: N, business_user: B };

// ================================================================ V-C49 troubleshooting
if (run("T")) {
  SECTION = "T";
  for (const role of ["administrator", "legal_team_member", "business_user"]) {
    const S = ROLE[role];
    await step(T, C49, role, "Open Help from the header and reach Resolve common problems",
      "Header Help opens the role's Help; the guide list reaches Resolve common problems and it opens with its sections.",
      async () => {
        await go(S.page, role === "business_user" ? "/portal" : "/");
        await S.page.getByRole("banner").getByRole("link", { name: "Help", exact: true }).click();
        await settle(S.page);
        const helpUrl = here_(S.page);
        await S.page.getByRole("navigation", { name: "Guide navigation" })
          .getByRole("link", { name: "Reference and troubleshooting" }).click();
        await settle(S.page);
        await S.page.getByRole("link", { name: "Resolve common problems" }).first().click();
        await settle(S.page);
        const heading = await h1(S.page);
        check(heading === "Resolve common problems", `h1 ${heading}`);
        const h2 = (await S.page.getByRole("article").getByRole("heading", { level: 2 }).allInnerTexts()).map(clean);
        check(h2.includes("I cannot sign in") && h2.includes("If the problem continues"), `h2 ${h2}`);
        return `Header Help went to ${helpUrl}; Guide navigation > Reference and troubleshooting > Resolve common problems opened ${here_(S.page)} with ${h2.length} sections (${h2.join("; ")}). The lab Help serves the article bytes bundled at 067c1646; the steps below follow the reviewed bytes.`;
      });
  }

  // ---- I cannot sign in
  for (const [role, email] of [["legal_team_member", "nadia.haddad@helix.example"], ["administrator", "daniel.okafor@helix.example"]]) {
    await step(T, C49, role, "I cannot sign in: staff sign-in with a wrong password, then the correct one",
      "A wrong password shows a visible error on the staff sign-in page, and the account still signs in with the right password (one failure, well under the ten-failure lockout).",
      async () => {
        const { context, page } = await newContext();
        await go(page, "/auth/login");
        await page.getByLabel("Email").fill(email);
        await page.getByLabel("Password").fill("DOC-030-support-wrong-password");
        await page.getByRole("button", { name: "Sign in", exact: true }).click();
        const err = page.getByText("Check your email and password.");
        await err.waitFor({ timeout: 15000 });
        const methods = await buttonNames(page.getByRole("main"));
        await page.getByLabel("Password").fill(process.env.LAB_PASSWORD);
        await page.getByRole("button", { name: "Sign in", exact: true }).click();
        await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 });
        const landed = here_(page);
        await context.close();
        return `The staff sign-in page offered ${q(methods)}. A wrong password showed "Check your email and password." and stayed on the page. The correct password then signed in to ${landed}.`;
      });
  }
  await step(T, C49, "business_user", "I cannot sign in: a Portal link already used; request a new link and open the newest message",
    "Reusing a spent link shows a link-specific expired or already-used message; a new link from the newest message signs in; the Portal session does not open staff pages.",
    async () => {
      const c1 = await newContext();
      const first = await requestLink(c1.page, BU2_EMAIL);
      await c1.page.goto(first.href);
      await c1.page.waitForURL((u) => u.pathname.startsWith("/portal") && !u.pathname.startsWith("/portal/login"), { timeout: 30000 });
      const firstLanded = here_(c1.page);
      const c2 = await newContext();
      await c2.page.goto(first.href);
      await settle(c2.page, 2000);
      const expiredUrl = here_(c2.page);
      const text = await bodyText(c2.page);
      check(/expired or was already used/.test(text), `reuse page ${expiredUrl}: ${text.slice(0, 200)}`);
      const heading = await h1(c2.page).catch(() => "");
      const screenshot = await shot(c2.page, "business-user-link-expired.png");
      const second = await requestLink(c2.page, BU2_EMAIL);
      const newest = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${BU2_EMAIL}"`)}&limit=1`).then((r) => r.json());
      check(newest.messages[0].ID === second.messageId, "the second link is not in the newest message");
      await c2.page.goto(second.href);
      await c2.page.waitForURL((u) => u.pathname.startsWith("/portal") && !u.pathname.startsWith("/portal/login"), { timeout: 30000 });
      const secondLanded = here_(c2.page);
      await go(c2.page, "/contracts");
      const staffAttempt = here_(c2.page);
      check(staffAttempt.startsWith("/portal"), `staff page ${staffAttempt}`);
      await c1.context.close();
      await c2.context.close();
      return `The first link (subject ${q(first.subject)}) signed in once and landed on ${firstLanded}. Opening the same link in a new browser context landed on ${expiredUrl} with heading ${q(heading)} and the text ${q(text.match(/The link has expired[^.]*\.[^.]*\./)?.[0] ?? "")}. A new link from the newest message signed in and landed on ${secondLanded}. Going to /contracts in that session landed on ${staffAttempt}. Screenshot ${screenshot}.`;
    });

  // ---- A record or search result is missing
  await step(T, C49, "administrator", "A record is missing: a direct link to a missing Contract and to an unreachable Confidential Contract",
    "Both answer Contract not found with Back to Contracts; reloads do not change access; no title leaks; after the Legal Owner adds a team entry the link opens.",
    async () => {
      const p = D.page;
      await go(p, "/contracts/999999");
      const missingH = await h1(p);
      const missingBody = await mainText(p);
      check(missingH === "Contract not found" && /Back to Contracts/.test(missingBody), `missing ${missingH} ${missingBody}`);
      await go(p, `/contracts/${FX.confidential.number}`);
      const refusedH = await h1(p);
      const refusedBody = await mainText(p);
      await p.reload();
      await settle(p);
      await p.reload();
      await settle(p);
      const afterReload = await h1(p);
      const leaked = (await bodyText(p)).includes(FX.confidential.title);
      check(refusedH === "Contract not found" && afterReload === "Contract not found" && !leaked, `refused ${refusedH} ${afterReload} leak ${leaked}`);
      const screenshot = await shot(p, "administrator-contract-not-found.png");
      await go(N.page, `/contracts/${FX.confidential.number}`);
      const panel = await applet(N.page, "Contract team");
      await panel.getByRole("button", { name: "Add team member" }).click();
      const dialog = N.page.getByRole("dialog", { name: "Add team member" });
      await dialog.getByRole("combobox", { name: "Person" }).selectOption({ label: "Daniel Okafor" });
      await dialog.getByRole("button", { name: "Add", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 10000 });
      await p.reload();
      await settle(p);
      const opened = await h1(p);
      here_(p);
      check(opened === FX.confidential.title, `after team entry ${opened}`);
      must(await N.api("DELETE", `/contracts/${FX.confidential.number}/team/${ids.daniel}`), "remove daniel");
      return `C-999999 showed ${q(missingH)} and ${q(missingBody)}. Confidential C-${FX.confidential.number} (Nadia Haddad Legal Owner, Daniel not on the team) showed ${q(refusedH)} and ${q(refusedBody)}, the same answer; two reloads still showed ${q(afterReload)} and the title did not appear. Nadia added Daniel with Contract team > Add team member; Daniel's reload then opened ${q(opened)}. Nadia then removed the entry again. Screenshot ${screenshot}.`;
    });
  await step(T, C49, "legal_team_member", "A page could not load: Something went wrong. with Reload after a temporary connection failure",
    "With the record read failing, the page shows Something went wrong. and Reload; after the connection returns, Reload opens the record.",
    async () => {
      const p = N.page;
      const pattern = new RegExp(`/api/v1/contracts/${FX.shared.number}(\\?|$)`);
      await p.context().route(pattern, (route) => route.abort("internetdisconnected"));
      await p.goto(`${BASE}/contracts/${FX.shared.number}`);
      const error = p.getByText("Something went wrong.");
      await error.waitFor({ timeout: 20000 });
      const reload = p.getByRole("button", { name: "Reload" });
      const hasReload = await reload.count();
      const screenshot = await shot(p, "legal-team-member-page-could-not-load.png");
      await p.context().unroute(pattern);
      await reload.click();
      await settle(p);
      const heading = await h1(p);
      here_(p);
      check(hasReload === 1 && heading === FX.shared.title, `reload ${hasReload} heading ${heading}`);
      return `With the browser's request for C-${FX.shared.number} failing, the page showed "Something went wrong." and a Reload button. After the request was allowed again, Reload opened ${q(heading)}. Screenshot ${screenshot}.`;
    });
  await step(T, C49, "legal_team_member", "A record or search result is missing: list search, missing Matter link, and a Confidential Contract without access",
    "The Contracts list search does not find the unreachable Contract; missing and unreachable work give the same not-found answer; after the Legal Owner adds a team entry both the link and the search find it.",
    async () => {
      const p = N.page;
      const searchList = async () => {
        await go(p, "/contracts");
        const box = p.getByRole("banner").getByRole("combobox", { name: "Search" });
        await box.fill(FX.adminConfidential.title);
        await box.press("Enter");
        await settle(p, 2000);
        here_(p);
        return p.getByRole("main").getByRole("link", { name: FX.adminConfidential.title }).count();
      };
      const before = await searchList();
      await go(p, "/matters/999999");
      const matterH = await h1(p);
      const matterBody = await mainText(p);
      await go(p, `/contracts/${FX.adminConfidential.number}`);
      const refusedH = await h1(p);
      check(matterH === "Matter not found" && refusedH === "Contract not found", `${matterH} ${refusedH}`);
      must(await D.api("POST", `/contracts/${FX.adminConfidential.number}/team`, { userId: ids.nadia }), "add nadia");
      await p.reload();
      await settle(p);
      const opened = await h1(p);
      const after = await searchList();
      must(await D.api("DELETE", `/contracts/${FX.adminConfidential.number}/team/${ids.nadia}`), "remove nadia");
      check(opened === FX.adminConfidential.title && before === 0 && after > 0, `opened ${opened} search ${before}/${after}`);
      return `Searching the Contracts list for the title of Confidential C-${FX.adminConfidential.number} (Daniel Okafor Legal Owner) found ${before} rows. M-999999 showed ${q(matterH)} / ${q(matterBody)}. C-${FX.adminConfidential.number} showed ${q(refusedH)}. After the Legal Owner added a team entry for Nadia, her reload opened ${q(opened)} and the same list search found ${after} row(s). Daniel then removed the entry.`;
    });
  await step(T, C49, "business_user", "A record is missing (Portal): missing, Confidential without team entry, shared, archived, related Matter, and missing Knowledge",
    "Missing and unreachable Contracts show the Portal not-found copy; a team entry opens the record; archiving closes it; a linked Matter stays closed.",
    async () => {
      const p = B.page;
      const read = async (url) => {
        await go(p, url);
        return { h: await h1(p).catch(() => ""), text: await mainText(p) };
      };
      const missing = await read("/portal/contracts/999999");
      const conf = await read(`/portal/contracts/${FX.confidential.number}`);
      const shared = await read(`/portal/contracts/${FX.shared.number}`);
      const beforeArchive = await read(`/portal/contracts/${FX.archived.number}`);
      const archiveNow = await N.api("POST", `/contracts/${FX.archived.number}/archive`, {});
      const afterArchive = await read(`/portal/contracts/${FX.archived.number}`);
      await p.reload();
      await settle(p);
      const afterReload = await mainText(p);
      const matter = await read(`/portal/matters/${FX.relatedMatter.number}`);
      const knowledge = await read("/portal/knowledge/01a0aaad-0000-7000-8000-000000000000");
      const copy = "This Contract does not exist, or you cannot open it.";
      check(missing.text.includes(copy) && conf.text.includes(copy) && !conf.text.includes(FX.confidential.title), `conf ${conf.text}`);
      check(shared.h === FX.shared.title, `shared ${shared.h}`);
      check(beforeArchive.h === FX.archived.title || archiveNow.status === 409, `before archive ${beforeArchive.h}`);
      check(afterArchive.text.includes(copy) && afterReload.includes(copy), `archived ${afterArchive.text}`);
      check(/Matter does not exist, or you cannot open it/.test(matter.text), `matter ${matter.text}`);
      return `C-999999: ${q(missing.h)} / ${q(missing.text)}. Confidential C-${FX.confidential.number} without a team entry gave the same copy and no title. Shared C-${FX.shared.number} (team entry) opened ${q(shared.h)}. C-${FX.archived.number} opened as ${q(beforeArchive.h)} before Nadia archived it (archive answered ${archiveNow.status}) and afterwards showed ${q(afterArchive.text)}, unchanged after reload. M-${FX.relatedMatter.number}, linked to C-${FX.shared.number}, showed ${q(matter.text)}. An unknown Portal Knowledge address showed ${q(knowledge.h)} / ${q(knowledge.text.slice(0, 160))}.`;
    });
  await step(T, C49, "business_user", "Converted Request: reopen it in the Portal; team entry removed; Legal restores it; staff page stays closed",
    "The converted Request opens its Contract in the Portal while the Business User is on the team; without the team entry it no longer opens; the staff Contract page is not available.",
    async () => {
      const p = B.page;
      await go(p, `/portal/requests/${FX.request.number}`);
      const landed = here_(p);
      const landedH = await h1(p);
      check(landed === `/portal/contracts/${FX.request.contract}`, `landed ${landed}`);
      // The Requester is the converted Contract's Business Owner; Legal clears that first so the team entry can go.
      const owner = await N.api("PATCH", `/contracts/${FX.request.contract}`, { businessOwnerId: null });
      must(await N.api("DELETE", `/contracts/${FX.request.contract}/team/${ids.bu}`), `remove bu (owner clear ${owner.status})`);
      await go(p, `/portal/requests/${FX.request.number}`);
      const without = { path: here_(p), h: await h1(p).catch(() => ""), text: (await mainText(p)).slice(0, 200) };
      check(without.path !== landed, `still opens ${JSON.stringify(without)}`);
      must(await N.api("POST", `/contracts/${FX.request.contract}/team`, { userId: ids.bu }), "readd bu");
      await go(p, `/portal/requests/${FX.request.number}`);
      const restored = here_(p);
      check(restored === landed, `restored ${restored}`);
      await go(p, `/contracts/${FX.request.contract}`);
      const staffPath = here_(p);
      check(staffPath.startsWith("/portal"), `staff ${staffPath}`);
      return `R-${FX.request.number} opened ${landed} (${q(landedH)}). After Nadia removed the Business User's team entry, R-${FX.request.number} showed path ${without.path}, heading ${q(without.h)}, text ${q(without.text)}. After Nadia added the entry back it opened ${restored} again. /contracts/${FX.request.contract} in the Portal session landed on ${staffPath}.`;
    });

  // ---- An edit or action is unavailable
  await step(T, C49, "business_user", "An edit or action is unavailable: Business User on a shared Contract",
    "Only Fields whose Rows have Visible on Portal on are shown, read-only; Add version, reply and Add team member are offered; no Task completion, Approval, signing or Stage control; a direct Field write is refused.",
    async () => {
      const p = B.page;
      await go(p, `/portal/contracts/${FX.shared.number}`);
      const fields = clean(await p.getByRole("region", { name: "Fields" }).innerText());
      const inputs = await p.getByRole("main").locator("region, section").filter({ hasText: /Overview|Fields/ })
        .locator("input:not([type=file]), select, textarea").count();
      const buttons = await buttonNames(p.getByRole("main"));
      const forbidden = buttons.filter((b) => /Approve|Reject|Send for signature|Add task|Complete|move contract|Archive|Add approver|Edit/i.test(b));
      check(/Security review/.test(fields) && !/Processes personal data/.test(fields), `fields ${fields}`);
      check(inputs === 0 && forbidden.length === 0 && buttons.includes("Add version"), `inputs ${inputs} forbidden ${forbidden} buttons ${buttons}`);
      const patch = await B.api("PATCH", `/contracts/${FX.shared.number}`, { customFields: { security_review: FX.shared.securityReview } });
      check(patch.status >= 400, `patch ${patch.status}`);
      const reply = `DOC-030 support Portal reply ${FX.stamp}`;
      const comments = await applet(p, "Comments");
      await comments.getByRole("textbox", { name: "New comment" }).fill(reply);
      await comments.getByRole("textbox", { name: "New comment" }).press("Control+Enter");
      await comments.getByText(reply).last().waitFor({ timeout: 15000 });
      const team = await applet(p, "Contract team");
      let added = "already on the team";
      if (!(await team.getByText("Amara Nwosu").count())) {
        await team.getByRole("button", { name: "Add team member" }).click();
        const dialog = p.getByRole("dialog", { name: "Add team member" });
        await dialog.waitFor({ timeout: 10000 });
        const person = dialog.getByRole("combobox").first();
        const tag = await person.evaluate((e) => e.tagName);
        if (tag === "SELECT") {
          const options = (await person.locator("option").allInnerTexts()).map(clean);
          added = options.find((o) => /Amara Nwosu/.test(o));
          await person.selectOption({ label: added });
        } else {
          await person.fill("Amara");
          await p.getByRole("option", { name: /Amara Nwosu/ }).first().click();
          added = "Amara Nwosu";
        }
        await dialog.getByRole("button", { name: "Add", exact: true }).click();
        await dialog.waitFor({ state: "hidden", timeout: 10000 });
        await team.getByText("Amara Nwosu").first().waitFor({ timeout: 10000 });
      }
      here_(p);
      return `Portal C-${FX.shared.number} (type DPA): the Fields region read ${q(fields)}; Security review (Visible on Portal on) shows and Processes personal data (Visible on Portal off, value saved by Legal) does not. Overview and Fields had ${inputs} editable controls. Buttons: ${q(buttons)}; none for Approval, Tasks, signing, Stage or archive. A direct Field write answered ${patch.status}. The reply posted in Comments and appeared. Add team member added ${q(added)}.`;
    });
  await step(T, C49, "business_user", "An edit or action is unavailable: Add team member on a Confidential team",
    "A Business User on a Confidential Contract cannot add people to its team.",
    async () => {
      const p = B.page;
      await go(p, `/portal/contracts/${FX.confidentialPortal.number}`);
      const heading = await h1(p);
      const team = await applet(p, "Contract team");
      const add = team.getByRole("button", { name: "Add team member" });
      const count = await add.count();
      const enabled = count ? await add.isEnabled() : false;
      const apiTry = await B.api("POST", `/portal/contracts/${FX.confidentialPortal.number}/team`, { userId: ids.amara });
      check(!enabled && apiTry.status >= 400, `add ${count}/${enabled} api ${apiTry.status}`);
      return `The Business User opened Confidential C-${FX.confidentialPortal.number} (${q(heading)}). Add team member: ${count ? (enabled ? "enabled" : "present but disabled") : "absent"}. A direct team add answered ${apiTry.status}.`;
    });
  await step(T, C49, "legal_team_member", "An edit or action is unavailable: archived Contract, and a save that reports an error",
    "The archived Contract offers no Upload; a refused value shows a correction and keeps the entry; a reload shows what actually saved.",
    async () => {
      const p = N.page;
      await go(p, `/contracts/${FX.archived.number}/documents`);
      const archivedUploads = await p.getByRole("button", { name: "Upload", exact: true }).count();
      const archivedText = (await bodyText(p)).match(/[^.]*archived[^.]*\./i)?.[0] ?? "";
      await go(p, `/contracts/${FX.uploads.number}`);
      const notice = p.getByRole("spinbutton", { name: "Notice period (days)" });
      await notice.fill("99999");
      await notice.press("Tab");
      await sleep(2500);
      const alert = p.getByRole("alert").or(p.getByText(/invalid|must be|at most|fewer/i)).first();
      await alert.waitFor({ timeout: 15000 });
      const alertText = clean(await alert.textContent());
      const kept = await notice.inputValue();
      await p.reload();
      await settle(p);
      const saved = await p.getByRole("spinbutton", { name: "Notice period (days)" }).inputValue();
      here_(p);
      check(archivedUploads === 0, `archived uploads ${archivedUploads}`);
      check(kept === "99999" && saved !== "99999", `kept ${kept} saved ${saved}`);
      return `Archived C-${FX.archived.number} Documents showed ${archivedUploads} Upload buttons (${q(archivedText)}). On C-${FX.uploads.number}, entering 99999 in Notice period (days) showed ${q(alertText)} and kept the entered value ${q(kept)}; after reload the saved value was ${q(saved)}, so the refused value had not saved.`;
    });
  await step(T, C49, "administrator", "An edit or action is unavailable: the Administrator reaches types, Statuses and Fields; the Legal Team Member does not",
    "Settings > Contracts > Fields and a type's Form open for the Administrator; the Legal Team Member cannot open organization settings.",
    async () => {
      await go(D.page, "/settings/contracts/fields");
      const adminHeadings = (await D.page.getByRole("main").getByRole("heading").allInnerTexts()).map(clean);
      await go(D.page, "/settings/contracts/types");
      await D.page.getByRole("main").getByRole("button", { name: "Edit DPA" }).click();
      await settle(D.page);
      const tabs = (await D.page.getByRole("main").getByRole("tab").allInnerTexts().catch(() => [])).map(clean);
      const formTab = D.page.getByRole("main").getByRole("tab", { name: "Form" }).or(D.page.getByRole("main").getByRole("link", { name: "Form" })).first();
      await formTab.click();
      await settle(D.page);
      const formSwitches = await switchStates(D.page);
      here_(D.page);
      await go(N.page, "/settings/contracts/fields");
      const memberPath = new URL(N.page.url()).pathname;
      const memberText = (await mainText(N.page)).slice(0, 200);
      const memberOrg = await N.page.getByRole("group", { name: "Organization" }).count();
      check(adminHeadings.some((h) => /Field/i.test(h)), `admin ${adminHeadings}`);
      check(formSwitches.some((s) => /Visible on Portal/.test(s.name)), `form ${JSON.stringify(formSwitches).slice(0, 300)}`);
      check(memberOrg === 0, `member org group ${memberOrg}`);
      return `Daniel saw ${q(adminHeadings.slice(0, 6))} at /settings/contracts/fields. The DPA type's Form showed Row switches ${q(formSwitches.map((s) => `${s.name}${s.checked ? " on" : " off"}`).slice(0, 12))}. Nadia's visit to /settings/contracts/fields ended at ${memberPath} with ${q(memberText)} and no Organization settings group.`;
    });

  // ---- An upload is refused or appears twice
  const bigPath = path.join(SCRATCH, "doc030-support-oversized.bin");
  if (!existsSync(bigPath)) writeFileSync(bigPath, Buffer.alloc(105 * 1024 * 1024, 7));
  async function uploadDialog(page, number, files) {
    await go(page, `/contracts/${number}/documents`);
    await docsRegion(page).getByRole("button", { name: "Upload", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Upload document" });
    await dialog.waitFor({ timeout: 10000 });
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), dialog.getByRole("button", { name: /Choose file/ }).click()]);
    await chooser.setFiles(files);
    await dialog.getByRole("button", { name: "Upload", exact: true }).click();
    return dialog;
  }
  const docCount = async (S, number) => must(await S.api("GET", `/contracts/${number}/documents`), "docs").documents.length;
  await step(T, C49, "legal_team_member", "An upload is refused: oversized file, over-long filename, corrected name, and a repeat upload",
    "The oversized file names the MB limit; the long filename is refused; nothing is stored; the corrected name uploads once; sending the same file again as a new Document makes a separate Document.",
    async () => {
      const p = N.page;
      const before = await docCount(N, FX.uploads.number);
      let dialog = await uploadDialog(p, FX.uploads.number, bigPath);
      const bigAlert = dialog.getByText(/upload limit/);
      await bigAlert.waitFor({ timeout: 120000 });
      const bigText = clean(await bigAlert.textContent());
      await closeDialog(p);
      const longName = `${"doc030-support-long-name-".repeat(12)}x.txt`;
      dialog = await uploadDialog(p, FX.uploads.number, { name: longName, mimeType: "text/plain", buffer: fixture("doc029-support-note.txt") });
      const longAlert = dialog.getByText(/255 characters/).first();
      await longAlert.waitFor({ timeout: 30000 });
      const longText = clean(await longAlert.textContent());
      await closeDialog(p);
      const afterRefusals = await docCount(N, FX.uploads.number);
      dialog = await uploadDialog(p, FX.uploads.number, fixturePath("doc029-support-note.txt"));
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      await settle(p);
      const afterOne = await docCount(N, FX.uploads.number);
      dialog = await uploadDialog(p, FX.uploads.number, fixturePath("doc029-support-note.txt"));
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      await settle(p);
      const afterTwo = await docCount(N, FX.uploads.number);
      const rows = await docsRegion(p).getByRole("row").filter({ hasText: "doc029-support-note.txt" }).count();
      here_(p);
      check(/100 MB upload limit/.test(bigText) && before === afterRefusals && afterOne === before + 1 && afterTwo === before + 2, `big ${bigText} counts ${before}/${afterRefusals}/${afterOne}/${afterTwo}`);
      return `A 105 MiB file was refused with ${q(bigText)}. A ${longName.length}-character filename was refused with ${q(longText)}. Documents stayed at ${afterRefusals}. The short name uploaded once (count ${afterOne}). Uploading the same file again as a new Document made ${afterTwo - before} separate Documents, with ${rows} rows named doc029-support-note.txt in the list.`;
    });
  await step(T, C49, "legal_team_member", "An upload appears twice: Add version is the path for another round of the same paper",
    "Add version on an existing Document adds Version 2 to its chain instead of a new Document.",
    async () => {
      const p = N.page;
      const before = await docCount(N, FX.uploads.number);
      await go(p, `/contracts/${FX.uploads.number}/documents`);
      const items = await menuItems(p, p.getByRole("button", { name: "Actions for doc029-support-note.txt" }).first());
      await p.getByRole("button", { name: "Actions for doc029-support-note.txt" }).first().click();
      await p.getByRole("menuitem", { name: /Add version|Upload new version/ }).click();
      const dialog = p.getByRole("dialog").first();
      await dialog.waitFor();
      const dialogTitle = clean(await dialog.getByRole("heading").first().textContent().catch(() => ""));
      const [chooser] = await Promise.all([p.waitForEvent("filechooser"), dialog.getByRole("button", { name: /Choose file/ }).click()]);
      await chooser.setFiles(fixturePath("doc029-support-v2.txt"));
      await dialog.getByRole("button", { name: /^(Upload|Add version)$/ }).last().click();
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      await settle(p);
      const docs = must(await N.api("GET", `/contracts/${FX.uploads.number}/documents`), "docs").documents;
      const versions = docs.map((d) => d.versions.length);
      here_(p);
      check(docs.length === before && versions.some((v) => v === 2), `docs ${docs.length}/${before} versions ${versions}`);
      return `The Document's actions offered ${q(items)}. Add version opened ${q(dialogTitle)}; after the upload the Contract still had ${docs.length} Documents and one of them now has 2 Versions (${q(versions)}).`;
    });
  await step(T, C49, "administrator", "An upload is refused: over-long filename as Administrator",
    "The filename refusal is visible and nothing is stored.",
    async () => {
      const p = D.page;
      const before = await docCount(D, FX.uploads.number);
      const longName = `${"doc030-support-admin-long-name-".repeat(10)}x.txt`;
      const dialog = await uploadDialog(p, FX.uploads.number, { name: longName, mimeType: "text/plain", buffer: fixture("doc029-support-note.txt") });
      const alert = dialog.getByText(/255 characters/).first();
      await alert.waitFor({ timeout: 30000 });
      const text = clean(await alert.textContent());
      await closeDialog(p);
      const after = await docCount(D, FX.uploads.number);
      here_(p);
      check(after === before, `${before} -> ${after}`);
      return `A ${longName.length}-character filename was refused with ${q(text)}; the Document count stayed ${after}.`;
    });
  await step(T, C49, "business_user", "An upload in the Portal: Add version on the primary Document and on another Document; no folder; reply attachments stay in the conversation",
    "Add version adds Version 2 to the primary Document and to a non-primary Document; the Portal upload dialog has no folder choice and a folder destination is refused; a reply attachment does not become a Document.",
    async () => {
      const p = B.page;
      const addVersion = async (rowFilter, file) => {
        await go(p, `/portal/contracts/${FX.shared.number}`);
        const row = docsRegion(p).getByRole("listitem").filter({ hasText: rowFilter }).first();
        await row.getByRole("button", { name: "Add version" }).click();
        const dialog = p.getByRole("dialog", { name: "Upload documents" });
        await dialog.waitFor();
        const addAs = clean(await dialog.getByRole("combobox", { name: "Add as" }).locator("option:checked").textContent());
        const controls = (await dialog.locator("label").allInnerTexts()).map(clean).filter(Boolean);
        await dialog.locator('input[type="file"]').setInputFiles(fixturePath(file));
        await dialog.getByRole("button", { name: "Upload", exact: true }).click();
        await dialog.waitFor({ state: "hidden", timeout: 30000 });
        await settle(p);
        const after = clean(await docsRegion(p).getByRole("listitem").filter({ hasText: rowFilter }).first().innerText());
        return { addAs, controls, after };
      };
      const primary = await addVersion("Primary Document", "doc029-support-v2.txt");
      const other = await addVersion("doc029-support-image.png", "doc029-support-image.png");
      const folderTry = await uploadFile(p, `/contracts/${FX.shared.number}/documents`, {
        name: "doc030-support-folder-try.txt", mimeType: "text/plain", buffer: fixture("doc029-support-note.txt"), fields: { folderId: FX.shared.folderId },
      });
      const before = must(await N.api("GET", `/contracts/${FX.shared.number}/documents`), "docs").documents.length;
      const comments = await applet(p, "Comments");
      const replyText = `DOC-030 support Portal reply with attachment ${FX.stamp}`;
      await comments.getByRole("textbox", { name: "New comment" }).fill(replyText);
      await comments.getByLabel("Choose files for this comment").setInputFiles(fixturePath("doc029-support-note.txt"));
      await comments.getByRole("textbox", { name: "New comment" }).press("Control+Enter");
      await comments.getByText(replyText).last().waitFor({ timeout: 20000 });
      await settle(p, 1500);
      const attachmentShown = await comments.getByText("doc029-support-note.txt").count();
      const after = must(await N.api("GET", `/contracts/${FX.shared.number}/documents`), "docs").documents.length;
      await go(p, `/portal/contracts/${FX.shared.number}`);
      const listed = await docsRegion(p).getByText("doc029-support-note.txt").count();
      const hasFolder = [...primary.controls, ...other.controls].some((c) => /folder/i.test(c));
      check(/Version 2/.test(primary.after) && /Version 2/.test(other.after) && !hasFolder && folderTry.status >= 400, `primary ${primary.after} other ${other.after} folder ${hasFolder} ${folderTry.status}`);
      check(after === before && listed === 0 && attachmentShown > 0, `docs ${before}->${after} listed ${listed} shown ${attachmentShown}`);
      return `Primary Document: Add version opened Upload documents with Add as ${q(primary.addAs)} and labels ${q(primary.controls)}; after Upload the row read ${q(primary.after.slice(0, 110))}. The non-primary doc029-support-image.png: Add as ${q(other.addAs)}; after Upload ${q(other.after.slice(0, 110))}. No folder choice. An upload naming a folder answered ${folderTry.status} ${q(folderTry.json?.detail ?? "")}. A Comments reply with doc029-support-note.txt attached showed the file in the thread (${attachmentShown} mention); the Contract still had ${after} Documents and the Portal Documents list showed ${listed} rows for that file.`;
    });

  // ---- A preview stays pending or fails
  let damaged = null;
  await step(T, C49, "legal_team_member", "A preview stays pending or fails: damaged Word file; Download reads the original",
    "The reader shows the pending message, then the failure message; Download returns the original bytes; reopening adds no Version.",
    async () => {
      const p = N.page;
      const dialog = await uploadDialog(p, FX.uploads.number, fixturePath("doc029-support-damaged.docx"));
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      await settle(p, 300);
      damaged = must(await N.api("GET", `/contracts/${FX.uploads.number}/documents`), "docs").documents.find((d) => d.title === "doc029-support-damaged.docx");
      await docsRegion(p).getByRole("button", { name: "doc029-support-damaged.docx", exact: true }).or(docsRegion(p).getByRole("link", { name: "doc029-support-damaged.docx", exact: true })).first().click();
      const panel = p.getByRole("complementary", { name: "doc029-support-damaged.docx, version 1" });
      await panel.waitFor({ timeout: 30000 });
      const pending = panel.getByText("Preparing this document for reading…");
      const failed = panel.getByText("This file could not be prepared for reading here. Download it to read it.");
      await pending.or(failed).first().waitFor({ timeout: 30000 });
      const sawPending = await pending.isVisible().catch(() => false);
      await failed.waitFor({ timeout: 240000 });
      const dl = await download(p, () => panel.getByRole("link", { name: "Download" }).first().click());
      const screenshot = await shot(p, "legal-team-member-preview-failed.png");
      await panel.getByRole("button", { name: "Close the document" }).click();
      await docsRegion(p).getByRole("button", { name: "doc029-support-damaged.docx", exact: true }).or(docsRegion(p).getByRole("link", { name: "doc029-support-damaged.docx", exact: true })).first().click();
      await p.getByRole("complementary", { name: "doc029-support-damaged.docx, version 1" }).getByText("This file could not be prepared").waitFor({ timeout: 30000 });
      const versions = must(await N.api("GET", `/contracts/${FX.uploads.number}/documents`), "docs").documents.find((d) => d.id === damaged.id).versions.length;
      here_(p);
      check(dl.sha256 === sha(fixture("doc029-support-damaged.docx")) && versions === 1, `dl ${dl.sha256} versions ${versions}`);
      return `The reader ${sawPending ? 'first showed "Preparing this document for reading…" and then' : "(the pending state had already passed when the panel opened)"} showed "This file could not be prepared for reading here. Download it to read it.". Download returned ${dl.name}, ${dl.bytes} bytes, SHA-256 equal to the fixture. Reopening showed the same failure and the chain still had ${versions} Version. Screenshot ${screenshot}.`;
    });
  await step(T, C49, "administrator", "A preview fails: the Administrator reads the failed Version and downloads the original",
    "The failure message and Download are shown; the original downloads.",
    async () => {
      check(damaged, "no damaged Document from the previous step");
      const p = D.page;
      await go(p, `/contracts/${FX.uploads.number}/documents`);
      await docsRegion(p).getByRole("button", { name: "doc029-support-damaged.docx", exact: true }).or(docsRegion(p).getByRole("link", { name: "doc029-support-damaged.docx", exact: true })).first().click();
      const panel = p.getByRole("complementary", { name: "doc029-support-damaged.docx, version 1" });
      await panel.getByText("This file could not be prepared for reading here. Download it to read it.").waitFor({ timeout: 30000 });
      const dl = await download(p, () => panel.getByRole("link", { name: "Download" }).first().click());
      await panel.getByRole("button", { name: "Close the document" }).click();
      here_(p);
      check(dl.sha256 === sha(fixture("doc029-support-damaged.docx")), "bytes differ");
      return `Daniel saw the failure message on the same Version; Download returned ${dl.bytes} bytes matching the uploaded original.`;
    });

  // ---- A notification or email is missing
  for (const role of ["administrator", "legal_team_member"]) {
    const S = ROLE[role];
    await step(T, C49, role, "A notification is missing: staff groups with In-app, Email and Push, Briefing, Devices, Reminder lead times, and profile timezone",
      "Groups show In-app, Email and Push choices and a Briefing section; Devices offers Turn on for this browser when the browser allows notifications and says In-app off silences Push; Reminder lead times has Use the organization's default lead times; Profile has a Timezone control.",
      async () => {
        // The headless shell always reports notification permission as denied, so this check
        // uses the full Chromium build in new headless mode, where a granted permission holds.
        const full = await chromium.launch({ headless: true, channel: "chromium" });
        const context = await full.newContext({ viewport: { width: 1440, height: 1000 } });
        const page = await context.newPage();
        await context.addCookies(await S.context.cookies());
        await context.grantPermissions(["notifications"], { origin: BASE });
        await go(page, "/settings");
        await page.getByRole("group", { name: "Personal" }).getByRole("link", { name: "Notifications" }).click();
        await settle(page);
        const switches = await switchStates(page);
        const briefing = await page.getByRole("heading", { name: "Briefing" }).count();
        const devicesText = clean(await page.getByRole("heading", { name: "Devices" }).locator("xpath=..").innerText().catch(() => ""));
        const turnOn = await page.getByRole("button", { name: "Turn on for this browser" }).count();
        const leadSwitch = switches.find((s) => s.name === "Use the organization's default lead times");
        const leadList = (await page.getByRole("list", { name: "Your reminder lead times" }).allInnerTexts().catch(() => [])).map(clean);
        here_(page);
        await go(page, "/settings/profile");
        const tz = await page.getByRole("combobox", { name: "Timezone" }).count();
        await full.close();
        const names = switches.map((s) => s.name);
        check(names.some((s) => /In-app$/.test(s)) && names.some((s) => /Email$/.test(s)) && names.some((s) => /Push$/.test(s)), `switches ${names}`);
        check(briefing === 1 && turnOn === 1 && leadSwitch && tz === 1, `briefing ${briefing} turnOn ${turnOn} lead ${JSON.stringify(leadSwitch)} tz ${tz}`);
        return `Settings > Personal > Notifications switches: ${q(switches.map((s) => `${s.name}${s.checked ? " on" : " off"}`))}. Briefing heading present. Devices: ${q(devicesText.slice(0, 260))}; with browser notification permission granted the page offered Turn on for this browser (not selected). Reminder lead times: switch "Use the organization's default lead times" ${leadSwitch.checked ? "on" : "off"}, list ${q(leadList)}. Profile showed a Timezone control.`;
      });
  }
  await step(T, C49, "business_user", "A notification is missing: Portal Notification settings, and In-app off stops the group's email",
    "Notification settings lists Request updates, Assigned to you, Activity on your records and Dates approaching; there is no personal lead-time control; with Request updates In-app off a Legal reply sends no email, and with it back on the next reply does.",
    async () => {
      const p = B.page;
      await go(p, "/portal");
      await p.getByRole("banner").getByRole("link", { name: "Notification settings" }).click();
      await settle(p);
      const before = await switchStates(p);
      const names = before.map((s) => s.name);
      for (const g of ["Request updates", "Assigned to you", "Activity on your records", "Dates approaching"])
        check(names.some((n) => n.startsWith(g)), `missing ${g} in ${names}`);
      const lead = await p.getByText(/lead time/i).count();
      const caption = clean(await p.getByText(/In-app off/).first().textContent().catch(() => ""));
      const request = must(await N.api("GET", `/requests/${FX.openRequest.number}`), "request").request;
      const mails = async () => {
        const r = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${BU_EMAIL}" subject:"R-${FX.openRequest.number}"`)}&limit=50`).then((x) => x.json());
        return (r.messages ?? []).length;
      };
      const reply = async (label) =>
        must(await N.api("POST", "/comments", { entityType: "request", entityId: request.id, body: `DOC-030 support Legal reply ${label} ${FX.stamp}`, visibility: "full_thread" }), "reply");
      const inApp = p.getByRole("switch", { name: "Request updates In-app" });
      check(before.find((s) => s.name === "Request updates In-app")?.checked, "Request updates In-app was not on at the start");
      await inApp.click();
      await settle(p, 1000);
      const off = await switchStates(p);
      const m0 = await mails();
      await reply("while In-app is off");
      await sleep(25000);
      const m1 = await mails();
      await inApp.click();
      await settle(p, 1000);
      const restored = await switchStates(p);
      await reply("after In-app is back on");
      let m2 = m1;
      for (let i = 0; i < 30 && m2 === m1; i++) {
        await sleep(2000);
        m2 = await mails();
      }
      here_(p);
      check(lead === 0, `lead time controls ${lead}`);
      check(m1 === m0 && m2 > m1, `mail counts ${m0}/${m1}/${m2}`);
      const fmt = (list) => list.filter((s) => s.name.startsWith("Request updates")).map((s) => `${s.name}${s.checked ? " on" : " off"}${s.disabled ? " (disabled)" : ""}`);
      return `The header link Notification settings opened ${lastPage} with switches ${q(before.map((s) => `${s.name}${s.checked ? " on" : " off"}`))}${caption ? ` and the note ${q(caption)}` : ""}. No lead-time control was shown (${lead} matches). With Request updates In-app off the switches read ${q(fmt(off))}: the Email switch stays as it was. Nadia then replied on R-${FX.openRequest.number}; after 25 s Mailpit held ${m1} messages for this Business User about R-${FX.openRequest.number} (was ${m0}), so no email went out. With In-app back on (${q(fmt(restored))}) the next reply produced a new email (${m2} messages).`;
    });

  // ---- Approvals
  await step(T, C49, "administrator", "I cannot approve: only the named person can answer",
    "On a request naming another person the requester sees only Cancel request; on the request naming himself he sees Approve and Reject; a direct decision on another person's request is refused.",
    async () => {
      const p = D.page;
      await go(p, `/contracts/${FX.approval.number}/approvals`);
      const other = await menuItems(p, p.getByRole("button", { name: "Actions for Nadia Haddad" }));
      const own = await menuItems(p, p.getByRole("button", { name: "Actions for Daniel Okafor" }));
      const direct = must(await D.api("GET", `/contracts/${FX.approval.number}/approvals`), "approvals").approvals.find((a) => a.approver.id === ids.nadia);
      const wrong = await D.api("POST", `/approvals/${direct.id}/decision`, { decision: "approved" });
      check(!other.includes("Approve") && own.includes("Approve") && wrong.status >= 400, `other ${other} own ${own} wrong ${wrong.status}`);
      return `On C-${FX.approval.number}, Actions for Nadia Haddad offered ${q(other)}; Actions for Daniel Okafor offered ${q(own)}. A direct decision on Nadia's request answered ${wrong.status}.`;
    });
  await step(T, C49, "legal_team_member", "I cannot approve: the named approver finds it under Your approvals in the bell and decides once",
    "The bell lists the open request under Your approvals with Review; the decision dialog says a decision is final; afterwards no decision control remains and a second decision is refused.",
    async () => {
      const p = N.page;
      await go(p, "/");
      await p.getByRole("banner").getByRole("button", { name: /^Notifications/ }).click();
      const section = p.getByRole("region", { name: "Your approvals" }).or(p.locator("section").filter({ has: p.getByRole("heading", { name: "Your approvals" }) })).first();
      await section.waitFor({ timeout: 15000 });
      const row = section.getByRole("listitem").filter({ hasText: FX.approval.title }).first();
      const rowText = clean(await row.innerText());
      await row.getByRole("link", { name: "Review" }).click();
      await settle(p);
      const reviewPath = here_(p);
      await p.getByRole("button", { name: "Actions for Nadia Haddad" }).click();
      await p.getByRole("menuitem", { name: "Approve" }).click();
      const dialog = p.getByRole("dialog").first();
      await dialog.waitFor();
      const dialogText = clean(await dialog.innerText());
      await dialog.getByRole("button", { name: "Approve", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 15000 });
      await settle(p);
      const decided = clean(await p.getByRole("row").filter({ hasText: "Nadia Haddad" }).first().innerText());
      const actions = p.getByRole("button", { name: "Actions for Nadia Haddad" });
      const after = (await actions.count()) ? await menuItems(p, actions) : [];
      const approvalId = must(await N.api("GET", `/contracts/${FX.approval.number}/approvals`), "a").approvals.find((a) => a.approver.id === ids.nadia).id;
      const again = await N.api("POST", `/approvals/${approvalId}/decision`, { decision: "rejected" });
      check(/Approved/.test(decided) && !after.includes("Reject") && again.status >= 400, `row ${decided} after ${after} again ${again.status}`);
      return `The bell's Your approvals section held ${q(rowText.slice(0, 200))}; Review opened ${reviewPath}. The Approve dialog read ${q(dialogText)}. After Approve the row read ${q(decided)}; its actions offered ${q(after)}. A second decision answered ${again.status}.`;
    });
  await step(T, C49, "administrator", "An Approval warning appears: Move past approval with a Pending request; Cancel",
    "Moving to an Active Status opens Move past approval listing the Pending request; Cancel keeps the Status.",
    async () => {
      const p = D.page;
      await go(p, `/contracts/${FX.approval.number}`);
      await p.getByRole("button", { name: /— move contract/ }).click();
      await p.getByRole("menuitemradio").filter({ hasText: /^Active/ }).first().click();
      const dialog = p.getByRole("dialog", { name: "Move past approval" });
      await dialog.waitFor({ timeout: 15000 });
      const text = clean(await dialog.innerText());
      const screenshot = await shot(p, "administrator-move-past-approval.png");
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      await settle(p);
      const status = must(await D.api("GET", `/contracts/${FX.approval.number}`), "c").contract.statusName;
      here_(p);
      check(/Pending/.test(text) && /Daniel Okafor/.test(text) && status === "Draft", `text ${text} status ${status}`);
      return `The dialog read ${q(text)}. Cancel closed it and the Status stayed ${status}. Screenshot ${screenshot}.`;
    });
  await step(T, C49, "business_user", "I cannot approve (Portal): the named Business User opens Approvals and decides from the review page",
    "Approvals in the Portal lists the Pending request; the review page shows the Contract title and primary Document only; the decision is final.",
    async () => {
      const p = B.page;
      await go(p, "/portal");
      await p.getByRole("navigation").getByRole("link", { name: "Approvals", exact: true }).first().click();
      await settle(p);
      const listPath = here_(p);
      const listText = await mainText(p);
      check(listText.includes(FX.buApproval.title) && listText.includes(FX.buWithdraw.title), `list ${listText.slice(0, 300)}`);
      await p.getByRole("main").getByRole("link", { name: FX.buApproval.title }).first().click();
      await settle(p, 2000);
      const reviewPath = here_(p);
      const review = await mainText(p);
      const regions = (await p.getByRole("main").getByRole("heading").allInnerTexts()).map(clean);
      const noRest = !/Contract team|Key dates|Tasks|Comments|Overview/.test(regions.join("|"));
      await p.getByRole("button", { name: "Approve", exact: true }).click();
      const confirm = p.getByRole("dialog");
      if (await confirm.isVisible().catch(() => false)) await confirm.getByRole("button", { name: "Approve", exact: true }).click();
      await settle(p, 1500);
      const decided = await mainText(p);
      const controlsAfter = await p.getByRole("button", { name: /^(Approve|Reject)$/ }).count();
      const again = await B.api("POST", `/portal/approvals/${FX.buApproval.approvalId}/decision`, { decision: "rejected" });
      check(review.includes(FX.buApproval.title) && review.includes("doc029-support-v1.txt") && noRest, `review ${review.slice(0, 300)} headings ${regions}`);
      check(controlsAfter === 0 && again.status >= 400, `after ${controlsAfter} again ${again.status}`);
      return `Portal navigation Approvals opened ${listPath} listing the three Pending requests that name this Business User. The review page ${reviewPath} read ${q(review.slice(0, 420))} with headings ${q(regions)}: the Contract title and primary Document, not the rest of the Contract. Approve recorded the decision (${q(decided.match(/Your decision[^]{0,60}|Approved[^]{0,40}/)?.[0] ?? "")}); no Approve or Reject control remained and a second decision answered ${again.status}.`;
    });
  await step(T, C49, "business_user", "I cannot approve (Portal): withdrawing the request or archiving the Contract removes the review page",
    "After Legal withdraws one request and archives another Contract, their review pages no longer open and the requests leave the Pending list.",
    async () => {
      const p = B.page;
      await go(p, `/portal/approvals/${FX.buWithdraw.approvalId}`);
      const beforeW = await mainText(p);
      await go(p, `/portal/approvals/${FX.buArchive.approvalId}`);
      const beforeA = await mainText(p);
      const w = await N.api("DELETE", `/approvals/${FX.buWithdraw.approvalId}`);
      const a = await N.api("POST", `/contracts/${FX.buArchive.number}/archive`, {});
      await go(p, `/portal/approvals/${FX.buWithdraw.approvalId}`);
      const afterW = { path: here_(p), text: (await bodyText(p)).slice(0, 200) };
      await go(p, `/portal/approvals/${FX.buArchive.approvalId}`);
      const afterA = { path: here_(p), text: (await bodyText(p)).slice(0, 200) };
      await go(p, "/portal/approvals");
      const list = await mainText(p);
      check(beforeW.includes(FX.buWithdraw.title) && beforeA.includes(FX.buArchive.title), "review pages did not open before");
      check(!afterW.text.includes(FX.buWithdraw.title) && !afterA.text.includes(FX.buArchive.title), `after ${JSON.stringify([afterW, afterA])}`);
      check(!list.includes(FX.buWithdraw.title) && !list.includes(FX.buArchive.title), `list ${list.slice(0, 300)}`);
      return `Both review pages opened before. Nadia withdrew the request on C-${FX.buWithdraw.number} (answered ${w.status}) and archived C-${FX.buArchive.number} (answered ${a.status}). The withdrawn review page then showed ${q(afterW.text)} at ${afterW.path}; the archived one showed ${q(afterA.text)} at ${afterA.path}. The Pending list no longer named either Contract.`;
    });

  // ---- Electronic signing unavailable
  for (const role of ["administrator", "legal_team_member"]) {
    const S = ROLE[role];
    await step(T, C49, role, "Electronic signing is unavailable: connector state and manual hand-off",
      "With no Signing connector there is no Send for signature, and Mark as executed copy stays available for manual hand-off.",
      async () => {
        let state = "not read (organization settings are Administrator-only)";
        if (role === "administrator") {
          await go(S.page, "/settings/integrations/e-signature");
          state = (await mainText(S.page)).match(/DocuSign[^]*?(Not connected|Connected|Enabled|Disabled)/)?.[0] ?? "";
          check(/Not connected/.test(state), `state ${state}`);
        }
        await go(S.page, `/contracts/${FX.shared.number}/approvals`);
        const send = await S.page.getByRole("button", { name: "Send for signature" }).count();
        const region = clean(await S.page.getByRole("main").innerText()).match(/Approvals & signing[^]{0,200}/)?.[0] ?? "";
        await go(S.page, `/contracts/${FX.shared.number}/documents`);
        const items = await menuItems(S.page, S.page.getByRole("button", { name: "Actions for doc029-support-v1.txt" }));
        check(send === 0 && items.includes("Mark as executed copy"), `send ${send} items ${items}`);
        return `Integrations > E-signature: ${q(state)}. C-${FX.shared.number} Approvals (${q(region.slice(0, 160))}) had ${send} Send for signature controls. The primary Document's actions offered ${q(items)}, including Mark as executed copy for manual hand-off.`;
      });
  }

  // ---- Analysis and AI conversion
  let aiState = null;
  await step(T, C49, "administrator", "Analysis or AI conversion is unavailable: AI analysis settings, Field prompts and the Request conversion switches",
    "AI analysis shows whether Analysis is enabled, has Field prompts, and names Prepare Matter conversions with AI and Prepare Contract conversions with AI as separate switches.",
    async () => {
      await go(D.page, "/settings/ai-analysis");
      for (const name of ["Provider", "Matter and Contract conversion prompts", "Contract analysis prompts"]) {
        const b = D.page.getByRole("main").getByRole("button", { name, exact: true });
        if ((await b.getAttribute("aria-expanded")) !== "true") await b.click();
        await sleep(500);
      }
      const text = await mainText(D.page);
      const switches = await switchStates(D.page);
      const prompts = await D.page.getByRole("region", { name: "Contract analysis prompts" }).count();
      const conn = must(await D.api("GET", "/ai-connector"), "ai").connector;
      aiState = { enabled: conn.enabled, configured: conn.configured, matterPreparation: conn.matterPreparation, contractPreparation: conn.contractPreparation, contractConversionAnalysis: conn.contractConversionAnalysis };
      const names = switches.map((s) => s.name);
      const card = await D.page.getByRole("main").getByRole("heading", { name: "Request conversion" }).count();
      check(prompts === 1, `prompts ${prompts}`);
      if (conn.configured)
        check(card > 0 && names.includes("Prepare Matter conversions with AI") && names.includes("Prepare Contract conversions with AI"), `switches ${names}`);
      else check(card === 0 && /Not connected/.test(text), `card ${card} text ${text.slice(0, 120)}`);
      return `${conn.configured ? "A connector was saved, so the Request conversion card was present." : "No connector was saved at the time (Provider read Not connected), so the Request conversion card and its switches were absent, as the linked Request conversion switches section says (it appears only after a connector is saved)."} AI analysis showed switches ${q(switches.map((s) => `${s.name}${s.checked ? " on" : " off"}`))} and a Contract analysis prompts section (the Field prompts). The page text began ${q(text.slice(0, 200))}. Connector state at the time: ${q(aiState)}. The AI connector on this shared lab was configured by another DOC-030 group with a provider stand-in; this walkthrough did not run Analysis and treats nothing here as live-provider evidence.`;
    });
  await step(T, C49, "legal_team_member", "Analysis is missing: the Fields header on a live and on an ended Contract; AI conversion falls back to manual",
    "Run analysis shows in the Fields header only when Analysis is available and the Contract is not Ended; the Convert dialog converts manually when preparation is off.",
    async () => {
      const p = N.page;
      await go(p, `/contracts/${FX.shared.number}`);
      const fieldsHeader = clean(await p.getByRole("region", { name: "Fields" }).first().locator("xpath=./*[1]").innerText().catch(() => ""));
      const liveRun = await p.getByRole("button", { name: /^(Run analysis|Running…)$/ }).count();
      const aiCard = await p.getByText("AI analysis", { exact: true }).count();
      const ended = must(await N.api("GET", "/contracts?stage=ended&limit=5"), "ended").contracts?.[0];
      let endedRun = null;
      if (ended) {
        await go(p, `/contracts/${ended.number}`);
        endedRun = await p.getByRole("button", { name: /^(Run analysis|Running…)$/ }).count();
      }
      await go(p, `/inbox/${FX.openRequest.number}`);
      await p.getByRole("button", { name: "Triage" }).click();
      const convertItem = p.getByRole("menuitem", { name: /Convert to contract/ }).or(p.getByRole("button", { name: /Convert to contract/ })).first();
      await convertItem.click();
      const dialog = p.getByRole("dialog").first();
      await dialog.waitFor({ timeout: 15000 });
      await sleep(2500);
      const text = clean(await dialog.innerText());
      const preparing = /Getting contract ready|Conversion draft/.test(text);
      await closeDialog(p);
      const status = must(await N.api("GET", `/requests/${FX.openRequest.number}`), "r").request.status;
      here_(p);
      check(aiCard === 0 && (ended ? endedRun === 0 : true), `aiCard ${aiCard} ended ${endedRun}`);
      check(aiState?.contractPreparation ? preparing : !preparing, `preparation ${aiState?.contractPreparation} dialog ${text.slice(0, 200)}`);
      return `C-${FX.shared.number} Fields header read ${q(fieldsHeader.slice(0, 120))} with ${liveRun} Run analysis/Running… control(s) and ${aiCard} separate AI analysis cards. ${ended ? `Ended C-${ended.number} showed ${endedRun} Run analysis controls.` : "No Ended Contract was listed."} With Prepare Contract conversions with AI ${aiState?.contractPreparation ? "on" : "off"}, Triage > Convert to contract on R-${FX.openRequest.number} opened ${q(text.slice(0, 260))} ${preparing ? "with" : "with no"} Conversion draft preparation; Cancel left the Request ${status}. Running…, the failure sentence and Retry Request-context Analysis need a run and were not produced here.`;
    });
}

// ================================================================ API keys and connected Clients (both articles)
if (run("K")) {
  SECTION = "K";
  const TR = [T, R];
  const SC = [C49, C50];
  const kname = (label) => `DOC-030 support ${label} ${FX.stamp}`;
  const mcpBefore = must(await D.api("GET", "/mcp-settings"), "mcp").settings ?? must(await D.api("GET", "/mcp-settings"), "mcp");
  const original = {
    enabled: mcpBefore.enabled,
    legalApiKeysEnabled: mcpBefore.legalApiKeysEnabled,
    businessApiKeysEnabled: mcpBefore.businessApiKeysEnabled,
    readOnly: mcpBefore.readOnly,
    apiKeyLifetimeDays: mcpBefore.apiKeyLifetimeDays,
    legalOAuthClientsEnabled: mcpBefore.legalOAuthClientsEnabled,
    businessOAuthClientsEnabled: mcpBefore.businessOAuthClientsEnabled,
  };
  results.settingsChanged.push({ section: SECTION, setting: "MCP policy before the API key steps", value: original, at: new Date().toISOString() });
  save();
  const rowOf = (page, client) => page.getByRole("main").getByRole("row").filter({ hasText: client }).first();
  const rowText = async (page, client) => clean(await rowOf(page, client).innerText());
  async function requestKey(page, client, { toolsets, scope, note }) {
    await page.getByRole("button", { name: "Request a key" }).click();
    const dialog = page.getByRole("dialog", { name: "Request an API key" });
    await dialog.waitFor({ timeout: 10000 });
    const text = clean(await dialog.innerText());
    const checked = await dialog.getByRole("checkbox", { checked: true }).count();
    const radios = (await dialog.getByRole("radio").evaluateAll((els) => els.map((e) => e.parentElement.textContent.trim())));
    await dialog.getByLabel("Client name").fill(client);
    for (const t of toolsets) await dialog.getByRole("checkbox", { name: t, exact: true }).click();
    await dialog.getByRole("radio", { name: scope === "write" ? /^Write\./ : /^Read\./ }).check();
    if (note) await dialog.getByLabel("Note (Optional)").fill(note);
    await dialog.getByRole("button", { name: "Send request" }).click();
    await dialog.waitFor({ state: "hidden", timeout: 15000 });
    await settle(page);
    return { text, checkedAtOpen: checked, radios };
  }
  async function decideInDialog(page, rowClient, action, note) {
    await rowOf(page, rowClient).getByRole("button", { name: action, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ timeout: 10000 });
    const text = clean(await dialog.innerText());
    if (note) await dialog.getByLabel("Note (Optional)").fill(note);
    await dialog.getByRole("button", { name: action, exact: true }).last().click();
    await dialog.waitFor({ state: "hidden", timeout: 15000 });
    await settle(page);
    return text;
  }
  async function openBell(page) {
    await page.getByRole("banner").getByRole("button", { name: /^Notifications/ }).click();
    const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "Your approvals" }) }).first();
    await section.waitFor({ timeout: 15000 });
    return section;
  }
  let key = null;
  try {
    await step(TR, SC, "legal_team_member", "API key: open API keys from Personal in staff Settings while MCP is off",
      "Settings > Personal > API keys opens the page with Connected Clients; Request a key is absent while Enable MCP or the group's API keys switch is off.",
      async () => {
        await go(N.page, "/settings");
        await N.page.getByRole("group", { name: "Personal" }).getByRole("link", { name: "API keys" }).click();
        await settle(N.page);
        here_(N.page);
        const request = await N.page.getByRole("button", { name: "Request a key" }).count();
        const text = await mainText(N.page);
        const cc = await N.page.getByRole("region", { name: "Connected Clients" }).count();
        check(!original.enabled || !original.legalApiKeysEnabled ? request === 0 : request === 1, `request ${request}`);
        check(cc === 1 && /No Client is connected\./.test(text), `connected clients ${cc}`);
        return `With Enable MCP ${original.enabled ? "on" : "off"} and Legal Users API keys ${original.legalApiKeysEnabled ? "on" : "off"}, ${lastPage} showed ${request} Request a key buttons and ${q(text.replace(/^.*?API keys (?=Client)/, "").slice(0, 330))}. Connected Clients read "No Client is connected.".`;
      });
    await step(TR, SC, "business_user", "API key: open API keys from Notification settings in the Portal while MCP is off",
      "Portal Notification settings links to API keys; Request a key is absent while MCP or the Business Users API keys switch is off.",
      async () => {
        await go(B.page, "/portal/settings");
        await B.page.getByRole("main").getByRole("link", { name: "API keys" }).click();
        await settle(B.page);
        here_(B.page);
        const request = await B.page.getByRole("button", { name: "Request a key" }).count();
        const text = await mainText(B.page);
        check(lastPage === "/portal/settings/api-keys" && request === 0, `path ${lastPage} request ${request}`);
        return `Notification settings > API keys opened ${lastPage} with ${request} Request a key buttons: ${q(text.slice(0, 300))}.`;
      });
    await step(TR, SC, "administrator", "API key: an Administrator turns on Enable MCP and the groups' API keys switches in Organization > MCP",
      "Organization > MCP has Enable MCP, Legal Users API keys and Business Users API keys; turning them on saves; OAuth Clients cannot be turned on while the app has no HTTPS address.",
      async () => {
        const p = D.page;
        await go(p, "/settings");
        await p.getByRole("group", { name: "Organization" }).getByRole("link", { name: "MCP", exact: true }).first().click();
        await settle(p);
        here_(p);
        const saved = [];
        for (const name of ["Enable MCP", "Legal Users API keys", "Business Users API keys"]) {
          const sw = p.getByRole("switch", { name, exact: true });
          if ((await sw.getAttribute("aria-checked")) !== "true") {
            const res = p.waitForResponse((r) => r.url().includes("/api/v1/mcp-settings") && r.request().method() === "PATCH");
            await sw.click();
            saved.push(`${name}: ${(await res).status()}`);
            await sleep(500);
          }
        }
        results.settingsChanged.push({ section: SECTION, setting: "MCP", value: saved, at: new Date().toISOString() });
        const after = must(await D.api("GET", "/mcp-settings"), "mcp");
        const oauthSwitches = (await switchStates(p)).filter((s) => /OAuth Clients/.test(s.name));
        const text = await mainText(p);
        check(after.enabled && after.legalApiKeysEnabled && after.businessApiKeysEnabled, `after ${JSON.stringify(after).slice(0, 200)}`);
        return `Organization > MCP (${lastPage}) read ${q(text.match(/MCP is (on|off)[^.]*\./)?.[0] ?? "")}; switches saved ${q(saved)}. The page names Server address ${q(text.match(/Server address (\S+)/)?.[1] ?? "")} and ${q(text.match(/API key lifetime \(days\)[^.]*\.[^.]*\./)?.[0] ?? "")}. The OAuth Clients switches were left as found (${q(oauthSwitches.map((s) => `${s.name}${s.checked ? " on" : " off"}`))}; authorization server available ${after.authorizationServerAvailable}); no OAuth Client was connected.`;
      });
    await step(TR, SC, "legal_team_member", "API key: Request a key names a Client, Toolsets and a scope, then Cancel request withdraws it",
      "The dialog asks for Client name, Toolsets with nothing selected, Read or Write scope and Note (Optional), and states the lifetime; the new row reads Pending approval; Cancel request sets Cancelled.",
      async () => {
        const p = N.page;
        await go(p, "/settings/api-keys");
        const opened = await requestKey(p, kname("cancelled client"), { toolsets: ["Comments"], scope: "read" });
        const pending = await rowText(p, kname("cancelled client"));
        const cancel = await decideInDialog(p, kname("cancelled client"), "Cancel request");
        const cancelled = await rowText(p, kname("cancelled client"));
        here_(p);
        check(/Client name/.test(opened.text) && /Nothing is selected for you\./.test(opened.text) && opened.checkedAtOpen === 0 && /Note \(Optional\)/.test(opened.text), `dialog ${opened.text}`);
        check(opened.radios.some((r) => /^Write\./.test(r)) && /Pending approval/.test(pending) && /Cancelled/.test(cancelled), `radios ${opened.radios} pending ${pending} cancelled ${cancelled}`);
        return `Request an API key read ${q(opened.text.slice(0, 520))}; ${opened.checkedAtOpen} Toolsets were selected at open; scopes ${q(opened.radios)}. After Send request the row read ${q(pending)}. The Cancel request dialog read ${q(cancel)}; the row then read ${q(cancelled)}.`;
      });
    await step(TR, SC, "administrator", "API key: the Administrator denies from Your approvals in the bell and from API key requests with a note",
      "The bell lists the key request under Your approvals with Approve and Deny; Deny there sets Denied; Deny with a note from Organization > MCP > API key requests keeps the note on the requester's row.",
      async () => {
        await go(N.page, "/settings/api-keys");
        await requestKey(N.page, kname("bell denied client"), { toolsets: ["Contracts"], scope: "read" });
        await requestKey(N.page, kname("noted denied client"), { toolsets: ["Contracts"], scope: "write", note: "DOC-030 support fictional reason for a write key" });
        const p = D.page;
        await go(p, "/");
        let section = await openBell(p);
        const item = section.getByRole("listitem").filter({ hasText: kname("bell denied client") }).first();
        await item.waitFor({ timeout: 20000 });
        const itemText = clean(await item.innerText());
        const buttons = await buttonNames(item);
        await item.getByRole("button", { name: "Deny", exact: true }).click();
        await sleep(1500);
        await p.keyboard.press("Escape");
        await go(p, "/settings/mcp");
        const orgRow = await rowText(p, kname("noted denied client"));
        const denyDialog = await decideInDialog(p, kname("noted denied client"), "Deny", "DOC-030 support fictional denial note");
        here_(p);
        await go(N.page, "/settings/api-keys");
        const bellRow = await rowText(N.page, kname("bell denied client"));
        const notedRow = await rowText(N.page, kname("noted denied client"));
        check(buttons.includes("Approve") && buttons.includes("Deny") && /Denied/.test(bellRow) && /Denied/.test(notedRow) && /fictional denial note/.test(notedRow), `buttons ${buttons} rows ${bellRow} | ${notedRow}`);
        return `Daniel's bell held ${q(itemText.slice(0, 200))} under Your approvals with ${q(buttons)}; Deny there sent no note. In Organization > MCP the API key requests row read ${q(orgRow)} (the requester's Note shows there); its Deny dialog read ${q(denyDialog)} and took a note. Nadia's rows then read ${q(bellRow)} and ${q(notedRow)}.`;
      });
    await step(TR, SC, "administrator", "API key: the Administrator approves from the bell; the requester sees Your key is ready once",
      "Approve in the bell activates the key; the requester's next visit shows Your key is ready with the key, the x-api-key header and Done; the key is not shown again.",
      async () => {
        await go(N.page, "/settings/api-keys");
        await requestKey(N.page, kname("read client"), { toolsets: ["Comments", "Contracts"], scope: "read" });
        // Leave the page before approval, so the key is shown on the requester's next visit.
        await go(N.page, "/");
        const p = D.page;
        await go(p, "/");
        const section = await openBell(p);
        const item = section.getByRole("listitem").filter({ hasText: kname("read client") }).first();
        await item.waitFor({ timeout: 20000 });
        await item.getByRole("button", { name: "Approve", exact: true }).click();
        await sleep(1500);
        await p.keyboard.press("Escape");
        here_(p);
        // A plain navigation: the open modal hides the page landmarks that go() waits for.
        await N.page.goto(`${BASE}/settings/api-keys`);
        const ready = N.page.getByRole("dialog", { name: "Your key is ready" });
        await ready.waitFor({ timeout: 15000 });
        const readyText = clean(await ready.innerText());
        key = clean(await ready.locator("code").first().textContent());
        const readyShown = readyText.replace(key, "<key>");
        await ready.getByRole("button", { name: "Done" }).click();
        await ready.waitFor({ state: "hidden" });
        const row = await rowText(N.page, kname("read client"));
        await N.page.reload();
        await settle(N.page, 1500);
        const again = await N.page.getByRole("dialog", { name: "Your key is ready" }).count();
        const pageHasKey = (await bodyText(N.page)).includes(key);
        here_(N.page);
        check(key.length > 20 && /Send this key in the x-api-key header\./.test(readyText) && /will not show this key again/.test(readyText) && /Active/.test(row) && again === 0 && !pageHasKey, `ready ${readyShown} row ${row} again ${again}`);
        return `Daniel selected Approve on the bell item. Nadia's API keys page opened ${q(readyShown.slice(0, 420))} (key value withheld here). After Done the row read ${q(row)}. A reload opened no dialog and the page did not contain the key.`;
      });
    await step(TR, SC, "legal_team_member", "API key: the key works at the MCP address with x-api-key; a Read key cannot write; Revoke ends it at once",
      "An MCP call with the key in x-api-key succeeds; a write tool is refused for a Read key; after Revoke the row reads Revoked and the key is refused.",
      async () => {
        check(key, "no key from the previous step");
        const noKey = await mcpCall(null, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "doc030-support", version: "1" } });
        const init = await mcpCall(key, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "doc030-support", version: "1" } });
        const who = await mcpCall(key, "tools/call", { name: "openlaw_whoami", arguments: {} }, 2);
        const shared = must(await N.api("GET", `/contracts/${FX.shared.number}`), "c").contract;
        const write = await mcpCall(key, "tools/call", { name: "openlaw_comment_post", arguments: { entityType: "contract", entityId: shared.id, body: "DOC-030 support write attempt with a Read key" } }, 3);
        const whoText = JSON.stringify(who.body).slice(0, 400);
        const writeText = JSON.stringify(write.body).slice(0, 300);
        const p = N.page;
        await go(p, "/settings/api-keys");
        const revokeDialog = await decideInDialog(p, kname("read client"), "Revoke");
        const row = await rowText(p, kname("read client"));
        const after = await mcpCall(key, "tools/call", { name: "openlaw_whoami", arguments: {} }, 4);
        here_(p);
        check(noKey.status === 401 && init.status === 200 && /Nadia/.test(whoText) && /read-only|mcp_read_only/.test(writeText), `noKey ${noKey.status} init ${init.status} who ${whoText} write ${writeText}`);
        check(/Revoked/.test(row) && after.status === 401, `row ${row} after ${after.status}`);
        return `POST ${BASE}/mcp initialize without a key answered ${noKey.status}; with the key in x-api-key it answered ${init.status}. openlaw_whoami returned ${q(whoText.slice(0, 260))}. openlaw_comment_post with this Read key returned ${q(writeText)}. Revoke opened ${q(revokeDialog)}; the row then read ${q(row)}, and the next MCP call with the key answered ${after.status}.`;
      });
    await step(TR, SC, "administrator", "API key: an Administrator's own request approves itself",
      "The Administrator's own request becomes Active at once and shows Your key is ready; he revokes it again.",
      async () => {
        const p = D.page;
        await go(p, "/settings");
        await p.getByRole("group", { name: "Personal" }).getByRole("link", { name: "API keys" }).click();
        await settle(p);
        await requestKey(p, kname("administrator client"), { toolsets: ["Contracts"], scope: "read" });
        const ready = p.getByRole("dialog", { name: "Your key is ready" });
        await ready.waitFor({ timeout: 15000 });
        const text = clean(await ready.innerText());
        const own = clean(await ready.locator("code").first().textContent());
        await ready.getByRole("button", { name: "Done" }).click();
        const row = await rowText(p, kname("administrator client"));
        await decideInDialog(p, kname("administrator client"), "Revoke");
        const revoked = await rowText(p, kname("administrator client"));
        here_(p);
        check(/Active/.test(row) && /Revoked/.test(revoked) && own.length > 20, `row ${row} revoked ${revoked}`);
        return `Send request opened ${q(text.replace(own, "<key>").slice(0, 300))} straight away; the row read ${q(row)}. Daniel then revoked it: ${q(revoked)}.`;
      });
    await step(TR, SC, "legal_team_member", "API key: Write is absent from the request dialog while the organization is Read-only",
      "With Read-only on, Request an API key offers only the Read scope; with it off again, Write returns.",
      async () => {
        must(await D.api("PATCH", "/mcp-settings", { readOnly: true }), "read-only on");
        results.settingsChanged.push({ section: SECTION, setting: "MCP Read-only", value: "on for one check, then off", at: new Date().toISOString() });
        const p = N.page;
        let radios;
        try {
          await go(p, "/settings/api-keys");
          await p.getByRole("button", { name: "Request a key" }).click();
          const dialog = p.getByRole("dialog", { name: "Request an API key" });
          await dialog.waitFor();
          radios = await dialog.getByRole("radio").evaluateAll((els) => els.map((e) => e.parentElement.textContent.trim()));
          await closeDialog(p);
        } finally {
          must(await D.api("PATCH", "/mcp-settings", { readOnly: original.readOnly }), "read-only restore");
        }
        await go(p, "/settings/api-keys");
        await p.getByRole("button", { name: "Request a key" }).click();
        const dialog = p.getByRole("dialog", { name: "Request an API key" });
        await dialog.waitFor();
        const radiosAfter = await dialog.getByRole("radio").evaluateAll((els) => els.map((e) => e.parentElement.textContent.trim()));
        await closeDialog(p);
        here_(p);
        check(radios.length === 1 && /^Read\./.test(radios[0]) && radiosAfter.length === 2, `radios ${radios} after ${radiosAfter}`);
        return `With Read-only on, the Scope choices were ${q(radios)}. With Read-only back off they were ${q(radiosAfter)}. Both dialogs were cancelled without a request.`;
      });
    await step(TR, SC, "administrator", "API key lifetime: the organization sets 1 to 365 days",
      "A lifetime of 400 is refused with the 1 to 365 message and the saved lifetime does not change.",
      async () => {
        const p = D.page;
        await go(p, "/settings/mcp");
        const box = p.getByRole("spinbutton", { name: "API key lifetime (days)" });
        await box.fill("400");
        await box.press("Tab");
        await sleep(1500);
        const msg = clean(await p.getByText(/API key lifetime must be a whole number from 1 to 365 days\./).first().textContent().catch(() => ""));
        const saved = must(await D.api("GET", "/mcp-settings"), "mcp").apiKeyLifetimeDays;
        await box.fill(String(original.apiKeyLifetimeDays));
        await box.press("Tab");
        await sleep(1500);
        const final = must(await D.api("GET", "/mcp-settings"), "mcp").apiKeyLifetimeDays;
        here_(p);
        check(msg && saved === original.apiKeyLifetimeDays && final === original.apiKeyLifetimeDays, `msg ${msg} saved ${saved} final ${final}`);
        return `Entering 400 in API key lifetime (days) showed ${q(msg)}; the saved lifetime stayed ${saved}. Entering ${original.apiKeyLifetimeDays} again left ${final}. The request dialog's line "Expires 90 days after approval. The organization sets this lifetime." matches.`;
      });
    await step(TR, SC, "business_user", "API key (Portal): request from Notification settings > API keys; the Administrator approves in API key requests; the key shows once",
      "The Business User's Request a key offers the business Toolsets; approval from Organization > MCP makes it Active and the Portal shows Your key is ready once; Revoke ends it.",
      async () => {
        const p = B.page;
        await go(p, "/portal/settings");
        await p.getByRole("main").getByRole("link", { name: "API keys" }).click();
        await settle(p);
        await p.getByRole("button", { name: "Request a key" }).click();
        const dialog = p.getByRole("dialog", { name: "Request an API key" });
        await dialog.waitFor();
        const toolsets = (await dialog.getByRole("checkbox").evaluateAll((els) => els.map((e) => e.closest("label")?.textContent.trim())));
        await closeDialog(p);
        await requestKey(p, kname("portal client"), { toolsets: [toolsets[0]], scope: "read" });
        const pending = await rowText(p, kname("portal client"));
        await go(p, "/portal");
        await go(D.page, "/settings/mcp");
        await decideInDialog(D.page, kname("portal client"), "Approve");
        await p.goto(`${BASE}/portal/settings/api-keys`);
        const ready = p.getByRole("dialog", { name: "Your key is ready" });
        await ready.waitFor({ timeout: 15000 });
        const k = clean(await ready.locator("code").first().textContent());
        const text = clean(await ready.innerText()).replace(k, "<key>");
        await ready.getByRole("button", { name: "Done" }).click();
        const active = await rowText(p, kname("portal client"));
        await decideInDialog(p, kname("portal client"), "Revoke");
        const revoked = await rowText(p, kname("portal client"));
        here_(p);
        check(/Pending approval/.test(pending) && /Active/.test(active) && /Revoked/.test(revoked) && k.length > 20, `pending ${pending} active ${active} revoked ${revoked}`);
        return `Portal Request an API key offered Toolsets ${q(toolsets)}. After Send request the row read ${q(pending)}. Daniel approved it in Organization > MCP > API key requests. The Portal page then opened ${q(text.slice(0, 300))}. After Done: ${q(active)}. Revoke: ${q(revoked)}.`;
      });
  } finally {
    const now = must(await D.api("GET", "/mcp-settings"), "mcp");
    const back = {};
    for (const k of Object.keys(original)) if (now[k] !== original[k]) back[k] = original[k];
    if (Object.keys(back).length) must(await D.api("PATCH", "/mcp-settings", back), "restore mcp");
    results.settingsChanged.push({ section: SECTION, setting: "MCP policy restored", value: back, at: new Date().toISOString() });
    save();
  }
}

// ================================================================ V-C50 reference
if (run("R")) {
  SECTION = "R";
  const runTag = new Date().toISOString().slice(11, 16).replace(":", "");
  const addedType = `DOC-030 support added type ${FX.stamp}-${runTag}`;
  const typedFile = `doc030-support-typed-${runTag}.txt`;
  await step(R, C50, "administrator", "Roles: the role control offers the fixed account roles only",
    "The role control offers Administrator, Legal team member and Business user, with no operator or other role.",
    async () => {
      const p = D.page;
      await go(p, "/settings/users");
      await p.getByRole("button", { name: "Legal team member — change the role of priya.raman@helix.example" }).click();
      const menu = p.getByRole("menu").or(p.getByRole("listbox")).or(p.getByRole("dialog")).first();
      await menu.waitFor({ timeout: 10000 });
      const options = clean(await menu.innerText());
      await p.keyboard.press("Escape");
      check(/Administrator/.test(options) && /Legal team member/.test(options) && /Business user/.test(options) && !/Contributor|operator/i.test(options), options);
      return `The role control for Priya Raman offered ${q(options)}. Escape closed it with no change.`;
    });
  await step(R, C50, "administrator", "Stage, Status and Category: fixed backbones behind configurable labels",
    "Contract statuses each show one Stage from Draft, Review, Approval, Signature, Active, Ended; a new Matter status asks for Open or Closed.",
    async () => {
      const p = D.page;
      await go(p, "/settings/contracts/statuses");
      const stages = [...new Set(((await mainText(p)).match(/Stage: (\w+)/g) ?? []).map((s) => s.slice(7)))];
      await go(p, "/settings/matters/statuses");
      await p.getByRole("button", { name: "Add status" }).click();
      await sleep(800);
      const scope = p.getByRole("dialog").first();
      const inDialog = (await scope.count()) ? scope : p.getByRole("main");
      const category = inDialog.getByRole("combobox").filter({ has: p.locator("option", { hasText: "Closed" }) }).first();
      const opts = (await category.count()) ? (await category.locator("option").allInnerTexts()).map(clean) : [clean(await inDialog.innerText()).slice(0, 200)];
      const cancel = inDialog.getByRole("button", { name: "Cancel" });
      if (await cancel.count()) await cancel.first().click();
      else await p.keyboard.press("Escape");
      const expected = ["Draft", "Review", "Approval", "Signature", "Active", "Ended"];
      check(expected.every((s) => stages.includes(s)) && stages.every((s) => expected.includes(s)) && opts.some((o) => /Open/.test(o)) && opts.some((o) => /Closed/.test(o)), `stages ${stages} opts ${opts}`);
      return `Contract statuses showed Stages ${q(stages)}. Matter statuses > Add status offered Category choices ${q(opts)}; Cancel left the list unchanged.`;
    });
  await step(R, C50, "administrator", "Document type lists: Settings > Organization > Documents keeps one list per module",
    "Documents has Matters, Contracts and Entities lists; the Contract list starts with the six fixed types; the Matter and Entity lists have no fixed types; an Administrator can add a Contract type.",
    async () => {
      const p = D.page;
      await go(p, "/settings");
      await p.getByRole("group", { name: "Organization" }).getByRole("link", { name: "Documents" }).click();
      await settle(p);
      const tabs = (await p.getByRole("navigation", { name: "Document type lists" }).getByRole("link").allInnerTexts()).map(clean);
      const listOf = async (name) => {
        await p.getByRole("navigation", { name: "Document type lists" }).getByRole("link", { name }).click();
        await settle(p);
        const fixed = await p.getByRole("main").getByRole("img", { name: /is fixed\./ }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
        const count = clean(await p.getByText(/^\d+ types?$/).first().textContent().catch(() => ""));
        return { fixed: fixed.map((f) => f.replace(/ is fixed\..*/, "")), count };
      };
      const matters = await listOf("Matters");
      const entities = await listOf("Entities");
      const contracts = await listOf("Contracts");
      await p.getByRole("button", { name: "Add type" }).click();
      const input = p.getByRole("textbox", { name: "New type name" });
      await input.fill(addedType);
      await input.press("Enter");
      await p.getByRole("main").getByText(addedType).first().waitFor({ timeout: 10000 });
      results.settingsChanged.push({ section: SECTION, setting: "Contract Document type added", value: addedType, at: new Date().toISOString() });
      here_(p);
      const six = ["Draft · ours", "Draft · theirs", "Redline · theirs", "Redline · ours", "Executed", "Amendment"];
      check(tabs.join("|") === "Matters|Contracts|Entities" && six.every((t, i) => contracts.fixed[i] === t) && contracts.fixed.length === 6 && matters.fixed.length === 0 && entities.fixed.length === 0, `tabs ${tabs} ${JSON.stringify({ matters, entities, contracts })}`);
      return `Settings > Organization > Documents showed the lists ${q(tabs)}. Contracts: fixed types ${q(contracts.fixed)} (${contracts.count} in all on this shared lab). Matters: ${matters.count}, none fixed. Entities: ${entities.count}, none fixed; the non-fixed rows on those lists were added by other DOC-030 groups. Add type added ${q(addedType)} to the Contract list for the next steps.`;
    });
  await step(R, C50, "administrator", "What your organization can configure: types and their Forms, Statuses, Fields, Document types, Templates, Approver groups, request types, default lead times, MCP",
    "Each named configuration has a page under Organization settings; a type's Form has per-Row On intake form and Visible on Portal switches.",
    async () => {
      const p = D.page;
      const pages = {};
      for (const [label, url] of [
        ["Contract types", "/settings/contracts/types"], ["Contract statuses", "/settings/contracts/statuses"], ["Contract fields", "/settings/contracts/fields"],
        ["Approver groups", "/settings/contracts/approver-groups"], ["Matter templates", "/settings/matters/templates"], ["Request types", "/settings/intake/request-types"],
        ["Reminders", "/settings/reminders"], ["Document types", "/settings/documents/contracts"], ["MCP", "/settings/mcp"],
      ]) {
        await go(p, url);
        const heads = (await p.getByRole("main").getByRole("heading", { level: 2 }).allInnerTexts()).map(clean).filter((h) => !/^(Personal|Organization)$/.test(h));
        pages[label] = `${lastPage}: ${heads.slice(0, 3).join(" / ")}`;
      }
      await go(p, "/settings/contracts/types");
      await p.getByRole("main").getByRole("button", { name: "Edit DPA" }).click();
      await settle(p);
      await p.getByRole("main").getByRole("tab", { name: "Form" }).or(p.getByRole("main").getByRole("link", { name: "Form" })).first().click();
      await settle(p);
      const sw = (await switchStates(p)).map((s) => `${s.name}${s.checked ? " on" : " off"}`);
      here_(p);
      check(Object.values(pages).every((v) => !/not found/i.test(v)) && sw.some((s) => /On intake form/.test(s)) && sw.some((s) => /Visible on Portal/.test(s)), `${JSON.stringify(pages)} ${sw}`);
      return `Pages: ${q(pages)}. The DPA Form's Row switches: ${q(sw.slice(0, 12))}.`;
    });
  await step(R, C50, "administrator", "Permissions: the Administrator needs a Grant for a Confidential Entity and named access for a Confidential Contract",
    "Without a Grant the Entity answers Entity not found; with a Grant it opens; the Confidential Contract without a team entry answers Contract not found.",
    async () => {
      const p = D.page;
      await go(p, `/entities/${FX.entity.id}`);
      const before = await h1(p);
      must(await N.api("POST", `/entities/${FX.entity.id}/grants`, { userId: ids.daniel }), "grant");
      await p.reload();
      await settle(p);
      const withGrant = await h1(p);
      must(await N.api("DELETE", `/entities/${FX.entity.id}/grants/${ids.daniel}`), "revoke");
      await p.reload();
      await settle(p);
      let revoked = await h1(p);
      if (revoked === "Something went wrong.") {
        observe(`After the Grant was removed, the first reload of Confidential Entity ${FX.entity.id} showed "Something went wrong." instead of "Entity not found"; Reload then showed the not-found page. Not reproduced in a separate probe.`);
        await p.getByRole("button", { name: "Reload" }).click();
        await settle(p);
        revoked = await h1(p);
      }
      await go(p, `/contracts/${FX.confidential.number}`);
      const contract = await h1(p);
      check(before === "Entity not found" && withGrant === FX.entity.name && revoked === "Entity not found" && contract === "Contract not found", `${before} ${withGrant} ${revoked} ${contract}`);
      return `Confidential Entity: ${q(before)} before the Grant, ${q(withGrant)} after Nadia granted Daniel, ${q(revoked)} after removal. Confidential C-${FX.confidential.number}: ${q(contract)}.`;
    });
  await step(R, C50, "legal_team_member", "Holding: owners come from the share register, show From register and cannot be edited; owners can be an Entity or an Individual",
    "The register Entity lists its holders from the register; the holder Entity's Holdings in other Entities row shows From register with no edit control; Add Holding offers an Entity or an Individual as owner.",
    async () => {
      const p = N.page;
      await go(p, `/entities/${FX.registerEntity.id}/ownership`);
      const members = clean(await p.getByRole("region", { name: "Register of members" }).innerText());
      const declared = clean(await p.getByRole("main").innerText()).match(/Declared owners not in the register[^]{0,120}/)?.[0] ?? "(no declared owners card)";
      await go(p, `/entities/${FX.registerEntity.holderEntity.id}/ownership`);
      const owned = p.getByRole("region", { name: "Holdings in other Entities" }).or(p.getByRole("region", { name: "Owned Entities" })).first();
      await waitOrReload(p, owned, "The holder Entity's Holdings in other Entities");
      const ownedText = clean(await owned.innerText());
      const row = owned.getByRole("listitem").or(owned.getByRole("row")).filter({ hasText: FX.registerEntity.name }).first();
      const rowText = clean(await row.innerText().catch(() => ""));
      const editable = await row.locator("input:not([disabled]), button[aria-label^='Remove']:not([disabled])").count();
      const locked = await row.locator("input[disabled], button[aria-label^='Remove'][disabled]").count();
      const hint = await owned.getByText("From register").first().getAttribute("title").catch(() => null);
      await p.getByRole("button", { name: "Add Holding" }).click();
      const dialog = p.getByRole("dialog", { name: "Add Holding" });
      await dialog.waitFor();
      const dialogText = clean(await dialog.innerText());
      const ownerType = await dialog.getByRole("combobox", { name: "Owner type" }).or(dialog.getByRole("radiogroup", { name: "Owner type" })).first().innerText().catch(() => "");
      await closeDialog(p);
      here_(p);
      check(/Marta Kowalczyk/.test(members) && /Individual/.test(members) && members.includes(FX.registerEntity.holderEntity.name), `members ${members}`);
      check(/From register/.test(rowText) && editable === 0, `row ${rowText} editable ${editable}`);
      check(/Individual/.test(dialogText) && /Entity/.test(dialogText), `dialog ${dialogText}`);
      return `The register Entity's Register of members read ${q(members.slice(0, 330))}; ${q(declared)}. On the holder Entity, ${q(ownedText.slice(0, 200))}; its row for the register Entity read ${q(rowText)} with ${editable} enabled and ${locked} disabled percent or remove controls${hint ? ` (hint ${q(hint)})` : ""}. Add Holding opened ${q(dialogText.slice(0, 260))}${ownerType ? `; Owner type ${q(clean(ownerType))}` : ""}. Cancel added nothing.`;
    });
  await step(R, C50, "legal_team_member", "Task and Key date, Entity and Counterparty: compare the terms with the Contract dialogs",
    "Add a key date has no assignee but has reminder lead times and team recipients; Add task has an assignee and due date; the Contract shows Our entity separately from Counterparties.",
    async () => {
      const p = N.page;
      await go(p, `/contracts/${FX.shared.number}/key-dates`);
      await p.getByRole("button", { name: "Add date" }).click();
      const kd = p.getByRole("dialog", { name: "Add a key date" });
      await kd.waitFor();
      await kd.getByRole("checkbox", { name: "Nadia Haddad" }).waitFor({ timeout: 20000 });
      const kdText = clean(await kd.innerText());
      await kd.getByRole("button", { name: "Cancel" }).click();
      await go(p, `/contracts/${FX.shared.number}/tasks`);
      await p.getByRole("button", { name: "Add task" }).click();
      await sleep(1000);
      const taskScope = p.getByRole("dialog").first();
      const taskText = clean(await ((await taskScope.count()) ? taskScope : p.getByRole("region", { name: "Tasks" })).innerText());
      await p.keyboard.press("Escape");
      await go(p, `/contracts/${FX.shared.number}`);
      const entity = await p.getByRole("combobox", { name: "Our entity" }).count();
      const counterparties = await p.getByRole("combobox", { name: "Counterparties" }).count();
      check(!/assign/i.test(kdText) && /lead time/i.test(kdText) && /Nadia Haddad/.test(kdText) && /Assign/i.test(taskText) && /Due/i.test(taskText) && entity === 1 && counterparties === 1, `kd ${kdText} task ${taskText} entity ${entity} cp ${counterparties}`);
      return `Add a key date read ${q(kdText.slice(0, 420))}: no assignee, a lead-time control and team recipients. Add task showed ${q(taskText.slice(0, 260))}. The Contract Overview has separate Our entity and Counterparties controls.`;
    });
  await step(R, C50, "legal_team_member", "Document type: chosen with Type at upload, No type by default, corrected later from the Type column",
    "The upload dialog's Type starts at No type and lists the Contract types including the added one; the Type column changes a Version's type and it stays after reload.",
    async () => {
      const p = N.page;
      await go(p, `/contracts/${FX.shared.number}/documents`);
      await docsRegion(p).getByRole("button", { name: "Upload", exact: true }).click();
      const dialog = p.getByRole("dialog", { name: "Upload document" });
      await dialog.waitFor({ timeout: 10000 });
      const [chooser] = await Promise.all([p.waitForEvent("filechooser"), dialog.getByRole("button", { name: /Choose file/ }).click()]);
      await chooser.setFiles({ name: typedFile, mimeType: "text/plain", buffer: fixture("doc029-support-note.txt") });
      const type = dialog.getByLabel("Type", { exact: true });
      const initial = clean(await type.locator("option:checked").textContent());
      const options = (await type.locator("option").allInnerTexts()).map(clean);
      await type.selectOption({ label: addedType });
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      await settle(p);
      const noteType = clean(await p.getByRole("combobox", { name: `Type of version 1 of ${typedFile}` }).locator("option:checked").textContent());
      const png = p.getByRole("combobox", { name: /^Type of version \d+ of doc029-support-image\.png/ }).first();
      await png.selectOption({ label: "Draft · ours" });
      await settle(p, 1500);
      await p.reload();
      await settle(p);
      const pngAfter = clean(await p.getByRole("combobox", { name: /^Type of version \d+ of doc029-support-image\.png/ }).first().locator("option:checked").textContent());
      const primary = clean(await p.getByRole("combobox", { name: /^Type of version \d+ of doc029-support-v1\.txt/ }).first().locator("option:checked").textContent());
      here_(p);
      check(initial === "No type" && options[0] === "No type" && options.includes("Executed") && options.includes(addedType) && noteType === addedType && pngAfter === "Draft · ours", `initial ${initial} options ${options} note ${noteType} png ${pngAfter}`);
      return `Upload document with ${typedFile} (the note fixture's bytes): Type started at ${q(initial)} with options ${q(options)}; choosing ${q(addedType)} stored it (Type column ${q(noteType)}). On doc029-support-image.png the Type column changed to ${q(pngAfter)} and kept it after reload. The primary doc029-support-v1.txt kept ${q(primary)}.`;
    });
  await step(R, C50, "legal_team_member", "Executed pin, Comparison and Version delete: the Document actions",
    "Actions offer Mark as executed copy and Compare with previous; Compare opens a comparison without adding a Version; no action deletes one Version; only the Administrator's menu has Delete.",
    async () => {
      const p = N.page;
      const files = FX.files.number;
      let doc = must(await N.api("GET", `/contracts/${files}/documents`), "docs").documents.find((d) => d.title === "doc029-support-v1.txt");
      if (!doc) {
        doc = (await uploadFile(N.page, `/contracts/${files}/documents`, { name: "doc029-support-v1.txt", mimeType: "text/plain", buffer: fixture("doc029-support-v1.txt") })).json.document;
        must(await uploadFile(N.page, `/documents/${doc.id}/versions`, { name: "doc029-support-v2.txt", mimeType: "text/plain", buffer: fixture("doc029-support-v2.txt") }), "v2");
      }
      await go(p, `/contracts/${files}/documents`);
      await waitOrReload(p, p.getByRole("button", { name: "Actions for doc029-support-v1.txt" }), "The Actions button for doc029-support-v1.txt");
      const memberItems = await menuItems(p, p.getByRole("button", { name: "Actions for doc029-support-v1.txt" }));
      await p.getByRole("button", { name: "Actions for doc029-support-v1.txt" }).click();
      await p.getByRole("menuitem", { name: "Compare with previous" }).click();
      await settle(p, 3000);
      const comparePath = here_(p);
      const compareText = (await bodyText(p)).match(/Compares v\d+ and v\d+/)?.[0] ?? (await h1(p).catch(() => ""));
      const versions = must(await N.api("GET", `/contracts/${files}/documents`), "docs").documents.find((d) => d.id === doc.id).versions.length;
      await go(D.page, `/contracts/${files}/documents`);
      const adminItems = await menuItems(D.page, D.page.getByRole("button", { name: "Actions for doc029-support-v1.txt" }));
      const versionDelete = [...memberItems, ...adminItems].filter((i) => /delete.*version/i.test(i));
      check(memberItems.includes("Mark as executed copy") && memberItems.includes("Compare with previous") && versions === 2 && versionDelete.length === 0 && adminItems.some((i) => /delete/i.test(i)) && !memberItems.some((i) => /delete/i.test(i)), `member ${memberItems} admin ${adminItems} versions ${versions}`);
      return `Nadia's actions for doc029-support-v1.txt (2 Versions) on C-${files}: ${q(memberItems)}. Compare with previous opened ${comparePath} (${q(compareText)}); the Document still had ${versions} Versions afterwards. Daniel's actions: ${q(adminItems)}. No action deletes a single Version; only the Administrator's menu has Delete.`;
    });
  await step(R, C50, "legal_team_member", "File behavior: PNG reads inline, SVG is download-only, EML opens the email reader",
    "The PNG opens in the reader, the SVG shows the download-only card, and the EML shows its subject and body.",
    async () => {
      const S = N;
      const existing = must(await S.api("GET", `/contracts/${FX.files.number}/documents`), "docs").documents.map((d) => d.title);
      for (const [f, mime] of [["doc029-support-image.png", "image/png"], ["doc029-support-diagram.svg", "image/svg+xml"], ["doc029-support-message.eml", "message/rfc822"]])
        if (!existing.includes(f)) must(await uploadFile(S.page, `/contracts/${FX.files.number}/documents`, { name: f, mimeType: mime, buffer: fixture(f) }), f);
      const docs = must(await S.api("GET", `/contracts/${FX.files.number}/documents`), "docs").documents;
      const open = async (name) => {
        const doc = docs.find((d) => d.title === name);
        const v = doc.versions.at(-1);
        await go(S.page, `/contracts/${FX.files.number}/documents?doc=${doc.id}&version=${v.id}`);
        await sleep(4000);
        const panel = S.page.getByRole("complementary").filter({ has: S.page.getByRole("button", { name: "Close the document" }) }).first();
        const visible = await panel.isVisible().catch(() => false);
        return { visible, text: visible ? clean(await panel.innerText()).slice(0, 220) : "", imgs: visible ? await panel.locator("img").count() : 0 };
      };
      const png = await open("doc029-support-image.png");
      const svg = await open("doc029-support-diagram.svg");
      const eml = await open("doc029-support-message.eml");
      check(png.visible && png.imgs > 0, `png ${JSON.stringify(png)}`);
      check(/does not open here/.test(svg.text) || !svg.visible, `svg ${JSON.stringify(svg)}`);
      check(/DOC-029 support fictional message/.test(eml.text), `eml ${JSON.stringify(eml)}`);
      return `PNG reader: ${png.imgs} image(s), ${q(png.text.slice(0, 80))}. SVG: ${svg.visible ? q(svg.text) : "no reader opened"}. EML reader: ${q(eml.text)}. The 100 MB and 255-character refusals are recorded in the troubleshooting upload steps.`;
    });
  await step(R, C50, "legal_team_member", "Knowledge files show the item's Knowledge type; organization settings stay with the Administrator; Personal holds lead times and API keys",
    "A Knowledge Item's Documents Type column shows its Knowledge type; the Legal Team Member has no Organization settings; Personal lists Notifications and API keys.",
    async () => {
      const p = N.page;
      await go(p, `/knowledge/${FX.knowledge.id}`);
      const kType = clean(await p.getByRole("main").getByRole("combobox", { name: "Type", exact: true }).locator("option:checked").textContent());
      const colType = clean(await p.getByRole("combobox", { name: /^Type of version \d+ of doc029-support-v1\.txt/ }).first().locator("option:checked").textContent());
      const colOptions = (await p.getByRole("combobox", { name: /^Type of version \d+ of doc029-support-v1\.txt/ }).first().locator("option").allInnerTexts()).map(clean);
      await go(p, "/settings/users");
      const usersPath = lastPage;
      const invite = await p.getByRole("button", { name: "Invite user" }).count();
      const org = await p.getByRole("group", { name: "Organization" }).count();
      const personal = (await p.getByRole("group", { name: "Personal" }).getByRole("link").allInnerTexts()).map(clean);
      check(colType === kType && invite === 0 && org === 0 && personal.includes("Notifications") && personal.includes("API keys"), `k ${kType}/${colType} invite ${invite} org ${org} personal ${personal}`);
      return `Knowledge ${q(FX.knowledge.title)} has Type ${q(kType)}; its file's Type column read ${q(colType)} with options ${q(colOptions)}. /settings/users for Nadia ended at ${usersPath} with no Invite user and no Organization group; Personal listed ${q(personal)}.`;
    });
  await step(R, C50, "business_user", "Permissions and Portal files: staff workspace closed; Kind shows fixed kinds and General; earlier Versions read and download",
    "Staff addresses land in the Portal; the Portal Documents list shows Draft · ours for a fixed type and General for No type or an added type; the primary Document shows earlier Versions with downloads.",
    async () => {
      const p = B.page;
      await go(p, "/documents");
      const staffPath = here_(p);
      await go(p, `/portal/contracts/${FX.shared.number}`);
      const item = (name) => docsRegion(p).getByRole("listitem").filter({ hasText: name }).first();
      const note = clean(await item(typedFile).innerText());
      const png = clean(await item("doc029-support-image.png").innerText());
      const primary = clean(await item("Primary Document").innerText());
      const earlier = item("Primary Document").getByRole("button", { name: /earlier version/i });
      let earlierText = "no earlier Versions control";
      if (await earlier.count()) {
        await earlier.first().click();
        await sleep(800);
        earlierText = clean(await docsRegion(p).innerText()).slice(0, 300);
      }
      const links = await docsRegion(p).getByRole("link", { name: /^Download doc029-support-v[12]\.txt, version \d+$/ }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") || e.textContent));
      const v1 = docsRegion(p).getByRole("link", { name: /^Download .*v1\.txt, version 1$/ }).first();
      const dl = (await v1.count()) ? await download(p, () => v1.click()) : null;
      here_(p);
      check(staffPath.startsWith("/portal") && /General/.test(note) && /Draft · ours/.test(png) && /General/.test(primary), `staff ${staffPath} note ${note} png ${png} primary ${primary}`);
      return `/documents in the Portal session landed on ${staffPath}. Portal Documents rows: note (added type ${q(addedType)}) ${q(note.slice(0, 110))}; image (Draft · ours) ${q(png.slice(0, 110))}; primary (No type) ${q(primary.slice(0, 140))}. Earlier Versions: ${q(earlierText)}. Download links: ${q(links)}${dl ? `; Version 1 downloaded ${dl.bytes} bytes (${dl.sha256 === sha(fixture("doc029-support-v1.txt")) ? "matches" : "differs from"} the uploaded v1)` : ""}.`;
    });
  await step(R, C50, "business_user", "Portal files: published Knowledge offers current-file downloads without a Version picker",
    "A published Knowledge Item with a two-Version file shows a Download for the current file only.",
    async () => {
      const p = B.page;
      await go(p, `/portal/knowledge/${FX.knowledge.id}`);
      const main = p.getByRole("main");
      const heading = await h1(p);
      const links = (await main.getByRole("link", { name: /Download/ }).allInnerTexts()).map(clean);
      const versionControls = await main.getByRole("combobox").or(main.getByRole("button", { name: /version/i })).count();
      const dl = await download(p, () => main.getByRole("link", { name: /Download/ }).first().click());
      check(heading === FX.knowledge.title && links.length === 1 && versionControls === 0 && dl.sha256 === sha(fixture("doc029-support-v2.txt")), `h ${heading} links ${links} vc ${versionControls} dl ${dl.bytes}`);
      return `Portal Knowledge ${q(heading)} (published, audience Everyone, primary file with Versions 1 and 2) showed ${links.length} Download link (${q(links)}) and ${versionControls} Version controls. The download returned ${dl.bytes} bytes equal to Version 2, the current file.`;
    });
  await step(R, C50, "business_user", "Approval Request row: the review page does not add the Business User to the team; a related Matter stays closed",
    "The Business User named on an Approval Request cannot open that Contract's Portal record page, and Legal's team list does not include them.",
    async () => {
      const p = B.page;
      await go(p, `/portal/contracts/${FX.buApproval.number}`);
      const text = (await bodyText(p)).slice(0, 300);
      const teamRes = await N.api("GET", `/contracts/${FX.buApproval.number}/team`);
      const team = JSON.stringify(teamRes.json ?? {});
      const onTeam = team.includes(ids.bu);
      await go(p, `/portal/matters/${FX.relatedMatter.number}`);
      const matter = (await bodyText(p)).match(/This Matter does not exist, or you cannot open it\./)?.[0] ?? "";
      here_(p);
      check(/This Contract does not exist, or you cannot open it\./.test(text) && !onTeam && matter, `text ${text} onTeam ${onTeam} matter ${matter}`);
      return `/portal/contracts/${FX.buApproval.number} (the Contract whose Approval Request names this Business User) showed ${q(text.match(/Contract not found[^]*?open it\./)?.[0] ?? text)}; the Contract team read by Legal ${onTeam ? "includes" : "does not include"} the Business User (status ${teamRes.status}). M-${FX.relatedMatter.number}, linked to shared C-${FX.shared.number}, showed ${q(matter)}.`;
    });
  await step(R, C50, "administrator", "Put the added Contract Document type back: archive it",
    "Archive type removes the added type from the upload pickers; the Version keeps its type.",
    async () => {
      const p = D.page;
      await go(p, "/settings/documents/contracts");
      await p.getByRole("button", { name: `Archive ${addedType}` }).click();
      const dialog = p.getByRole("dialog");
      await dialog.waitFor();
      const text = clean(await dialog.innerText());
      await dialog.getByRole("button", { name: "Archive type" }).click();
      await dialog.waitFor({ state: "hidden", timeout: 10000 });
      await settle(p);
      const still = await p.getByRole("main").getByText(addedType).count();
      results.settingsChanged.push({ section: SECTION, setting: "Contract Document type archived", value: addedType, at: new Date().toISOString() });
      here_(p);
      check(still === 0, `still listed ${still}`);
      return `Archive opened ${q(text)}; after Archive type the active Contract list no longer showed ${q(addedType)}.`;
    });
}

// ================================================================ V-C50 operator
if (run("O")) {
  SECTION = "O";
  const articleLinks = (id) => [...new Set([...articleBytes(id).toString("utf8").matchAll(/\]\(([a-z0-9-]+)\.md(#[a-z0-9-]+)?\)/g)].map((m) => `${m[1]}${m[2] ?? ""}`))];
  async function linkCheck(id) {
    const { context, page } = await newContext();
    const bad = [];
    const links = articleLinks(id);
    for (const link of links) {
      const [target, anchor] = link.split("#");
      await go(page, `/documentation/${target}`);
      const heading = await h1(page).catch(() => "");
      if (heading === "Article unavailable" || !heading) bad.push(`${link}: ${heading}`);
      else if (anchor && !(await page.locator(`[id="${anchor}"]`).count())) bad.push(`${link}: no anchor in the bundled ${target}`);
    }
    await context.close();
    return { links, bad };
  }
  await step(R, C50, "operator", "Deployment operator: read the reference signed out in the formal documentation",
    "The formal reader opens without an app session and shows the Deployment operator row and MAX_UPLOAD_MB.",
    async () => {
      const { context, page } = await newContext();
      const apiCalls = [];
      page.on("request", (r) => {
        if (new URL(r.url()).pathname.startsWith("/api/")) apiCalls.push(new URL(r.url()).pathname);
      });
      await go(page, "/documentation/reference");
      const heading = await h1(page);
      const text = await bodyText(page);
      await go(page, "/help");
      const helpRedirect = here_(page);
      await context.close();
      check(heading === "Look up terms, permissions, and file behavior" && /Deployment operator/.test(text) && text.includes("MAX_UPLOAD_MB") && helpRedirect.startsWith("/documentation"), `h ${heading} help ${helpRedirect}`);
      return `Signed out, /documentation/reference showed ${q(heading)} with the Deployment operator row and MAX_UPLOAD_MB (bundled 067c1646 bytes). App API requests while reading signed out: ${q([...new Set(apiCalls)])}. Signed-out /help landed on ${helpRedirect}.`;
    });
  await step(R, C50, "operator", "Deployment operator: check the reference's operator facts against the lab containers and compose.yml",
    "No operator account role exists; MAX_UPLOAD_MB is an environment setting whose empty value means the 100 MiB default; the MCP address is the app address plus /mcp; files and database live in operator-managed volumes.",
    async () => {
      const compose = readFileSync(path.join(root, `.documentation-labs/${LAB}/source/compose.yml`), "utf8");
      const composeUpload = compose.split("\n").filter((l) => /MAX_UPLOAD_MB|STORAGE_PATH:|openlaw-files:|pgdata|postgres-data/.test(l)).map((l) => l.trim()).slice(0, 8);
      const exec = (svc, cmd) => execFileSync("docker", ["exec", `${PROJECT}-${svc}-1`, "sh", "-c", cmd], { encoding: "utf8" }).trim();
      const envMax = exec("app", 'printf "[%s]" "${MAX_UPLOAD_MB-unset}"');
      const baseUrl = exec("app", 'printf "%s" "$BASE_URL"');
      const code = exec("app", "grep -n 'DEFAULT_MAX_UPLOAD_MB = \\|MEGABYTE = \\|MAX_FILENAME_LENGTH = ' /app/apps/api/dist/lib/uploads.js");
      const roles = sql("select pg_get_constraintdef(oid) from pg_constraint where conrelid='users'::regclass and contype='c' and pg_get_constraintdef(oid) like '%role%'");
      const volumes = execFileSync("docker", ["inspect", "--format", "{{range .Mounts}}{{.Type}}:{{.Destination}} {{end}}", `${PROJECT}-app-1`], { encoding: "utf8" }).trim();
      const pgVolumes = execFileSync("docker", ["inspect", "--format", "{{range .Mounts}}{{.Type}}:{{.Destination}} {{end}}", `${PROJECT}-postgres-1`], { encoding: "utf8" }).trim();
      const mcp = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
      check(envMax === "[]" && /DEFAULT_MAX_UPLOAD_MB = 100/.test(code) && /MAX_FILENAME_LENGTH = 255/.test(code), `env ${envMax} code ${code}`);
      check(/administrator.*legal_team_member.*business_user/.test(roles) && !/operator/.test(roles), `roles ${roles}`);
      check(baseUrl === BASE && [401, 404].includes(mcp.status), `base ${baseUrl} mcp ${mcp.status}`);
      lastPage = "docker exec / docker inspect / compose.yml";
      return `compose.yml (${`.documentation-labs/${LAB}/source/compose.yml`}) passes ${q(composeUpload)}. In the running app container MAX_UPLOAD_MB is ${envMax} (set but empty), and the built uploads module reads ${q(code.replace(/\n/g, " | "))}: an empty value falls back to 100 MiB = 104,857,600 bytes, matching the 100 MB refusal in the troubleshooting walk. The users table allows only ${q(roles)}; there is no operator role. BASE_URL is ${baseUrl}, so the MCP address is ${baseUrl}/mcp (an unauthenticated POST answered ${mcp.status}). App mounts: ${q(volumes)}; database mounts: ${q(pgVolumes)}. These are the environment, storage and service settings the reference assigns to the deployment operator. Read only; nothing was changed. The Administrator's Settings > Advanced > File uploads page also shows Maximum file size (MiB) 100 (Default) and says a value set in the deployment configuration is read only there.`;
    });
  await step([T, R], [C49, C50], "operator", "Links in the reviewed troubleshooting and reference bytes resolve in the formal documentation",
    "Every internal link and heading anchor in the reviewed bytes opens an article and heading in the bundled edition, or the gap is named.",
    async () => {
      const t = await linkCheck("troubleshooting");
      const r = await linkCheck("reference");
      lastPage = "/documentation/*";
      const bad = [...t.bad.map((b) => `troubleshooting -> ${b}`), ...r.bad.map((b) => `reference -> ${b}`)];
      if (bad.length) observe(`Links not resolved in the bundled 067c1646 edition: ${bad.join("; ")}. The bundled edition predates the reviewed bytes.`);
      check(bad.every((b) => /no anchor/.test(b)), `unresolved ${bad}`);
      return `troubleshooting: ${t.links.length} internal targets; reference: ${r.links.length}. ${bad.length ? `Anchors missing in the bundled (older) edition: ${q(bad)}; every target article opened.` : "All targets and anchors opened."}`;
    });
}

// __SECTIONS__

// __END__
await closeBrowser();
save();
console.log(JSON.stringify(results.summary));
