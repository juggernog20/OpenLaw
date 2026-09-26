// DOC-030 compatibility replay (set compat), article versions-and-support (V-C51). Copy of
// DOC-029/compat-r2/support-r2/walkthrough-r2.mjs. DOC-030 changes: helpers from ./versions-and-support-replay/lib.mjs,
// default ONLY=V (the versions-and-support section), lab name from LAB_NAME (default work2), fixtures read from
// DOC-029/support/fixtures, output and screenshot paths, reviewer label, record names DOC-029r2 to "DOC-030 compat",
// the Portal sign-in waits out the sign-in link budget (3 per email address in 15 minutes, TECH-032), and the
// fixture Matter uses a Matter type without required Form Fields, and the Request fixtures (used only by the
// T and R sections) are created only when those sections run (see the DOC-030 notes at the fixtures).
// No step, selector or check changed.
// DOC-029 round 2 compatibility replay of the support walkthrough-r1.mjs against the admin2 lab (57e77e38).
// Changes from round 1: lab name admin2, fixtures read from ../../support/fixtures, record names "DOC-029r2 support ...", output and screenshot names r2.
// Follows "Resolve common problems" (V-C49), "Look up terms, permissions, and file behavior" (V-C50)
// and "Find version information and get help" (V-C51) against the shared admin lab.
// Written by the DOC-029 independent walkthrough agent (support, round 1) from the article text.
// Run from the worktree root:
//   LAB_PASSWORD=... mise exec -- node docs/documentation/batches/DOC-029/support/walkthrough-r1.mjs
// Optional: ONLY=T,R,V runs a subset of sections; OUT=<file> changes the result file.
// Credentials come only from the environment. Magic links, cookies and mail bodies stay in memory.
// The script creates only records named "DOC-030 compat support ..." and changes no organisation settings.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import {
  chromium,
  BASE,
  MAIL,
  passwordSignIn,
  uploadFile,
  must,
  here,
  root,
  sleep,
} from "./versions-and-support-replay/lib.mjs";

const OUT = process.env.OUT ?? path.join(here, "../versions-and-support-replay.json");
const ONLY = new Set((process.env.ONLY ?? "V").split(","));
const SCRATCH = process.env.SCRATCH ?? path.join(os.tmpdir(), `doc029-support-${Date.now()}`);
mkdirSync(SCRATCH, { recursive: true });
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const fixture = (f) =>
  readFileSync(path.join(root, "docs/documentation/batches/DOC-029/support/fixtures", f));
const articleBytes = (id) => readFileSync(path.join(root, "docs/user-guides", `${id}.md`));
const q = (s) => JSON.stringify(s);
const clean = (s) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
function check(cond, msg) {
  if (!cond) throw new Error(msg);
}

function labStatus() {
  try {
    const text = execFileSync(
      "mise",
      [
        "exec",
        "--",
        "node",
        "scripts/documentation/lab.mjs",
        "status",
        process.env.LAB_NAME ?? "work2",
      ],
      { cwd: root, encoding: "utf8" },
    );
    const project = text.match(/(openlaw-docs-[0-9a-f]+-[a-z0-9-]+?)-app-1/)?.[1] ?? null;
    const source = text.match(/source ([0-9a-f]{40})/)?.[1] ?? null;
    const image = (name) =>
      execFileSync("docker", ["inspect", "--format", "{{.Image}}", `${project}-${name}-1`], {
        encoding: "utf8",
      }).trim();
    return {
      project,
      source,
      appImage: image("app"),
      workerImage: image("worker"),
      engineImage: image("doc-engine"),
    };
  } catch (error) {
    return { error: String(error).slice(0, 200) };
  }
}

const results = {
  batch: "DOC-030",
  group: "support",
  set: "compat",
  kind: "independent-article-walkthrough",
  reviewer: "DOC-030 compatibility reviewer (compat)",
  reviewerKind: "agent",
  appUrl: BASE,
  mailUrl: MAIL,
  lab: labStatus(),
  articles: Object.fromEntries(
    ["troubleshooting", "reference", "versions-and-support"].map((id) => [
      id,
      { path: `docs/user-guides/${id}.md`, contentSha256: sha(articleBytes(id)) },
    ]),
  ),
  browser:
    "Playwright 1.63.0 Chromium from node_modules/.pnpm, headless, one browser context per identity",
  fixtures: null,
  startedAt: new Date().toISOString(),
  steps: [],
  finishedAt: null,
};
function save() {
  results.finishedAt = new Date().toISOString();
  writeFileSync(OUT, JSON.stringify(results, null, 2));
}
async function step(article, scenario, role, action, expected, fn) {
  const entry = {
    article,
    scenario,
    role,
    method: "browser-walkthrough",
    action,
    expected,
    startedAt: new Date().toISOString(),
    at: null,
    actual: null,
    result: "not-run",
  };
  results.steps.push(entry);
  try {
    entry.actual = await fn();
    entry.result = "pass";
  } catch (error) {
    entry.actual = `Check did not complete: ${clean(error instanceof Error ? error.message.split("\n").slice(0, 3).join(" ") : error).slice(0, 600)}`;
    entry.result = "fail";
  }
  entry.at = new Date().toISOString();
  console.log(
    `[${article} ${role}] ${entry.result.toUpperCase()} ${action}${entry.result === "fail" ? `: ${entry.actual}` : ""}`,
  );
  save();
  return entry;
}
const run = (section) => !ONLY || ONLY.has(section);

// ---------------------------------------------------------------- sessions
const browser = await chromium.launch({ headless: true });

function withApi(context, page) {
  const api = async (method, url, body) => {
    const res = await page.request.fetch(`${BASE}/api/v1${url}`, {
      method,
      data: body === undefined ? undefined : body,
      headers: { origin: BASE },
      failOnStatusCode: false,
    });
    let json = null;
    try {
      json = await res.json();
    } catch {}
    return { status: res.status(), json };
  };
  return { context, page, api };
}

/** Ask for a Portal sign-in link and return it (kept in memory only). */
async function requestLink(page, email) {
  const since = Date.now() - 1500;
  await page.goto(`${BASE}/auth/login`);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.getByLabel("Email").fill(email);
  await page
    .getByRole("button", { name: /Send|Email me/ })
    .last()
    .click();
  await sleep(1500);
  if (await page.getByText("Too many sign-in link requests. Try again later.").isVisible()) {
    console.log(`sign-in link budget spent for ${email}; waiting 60 s`);
    await sleep(60000);
    return requestLink(page, email);
  }
  for (let i = 0; i < 40; i++) {
    await sleep(750);
    const search = await fetch(
      `${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
    ).then((r) => r.json());
    for (const m of search.messages ?? []) {
      if (new Date(m.Created).getTime() < since) continue;
      const message = await fetch(`${MAIL}/api/v1/message/${m.ID}`).then((r) => r.json());
      const match =
        message.Text?.match(/https?:\/\/[^\s)>\]]+magic[^\s)>\]]*/i) ??
        message.Text?.match(/https?:\/\/[^\s)>\]]+token=[^\s)>\]]*/);
      if (match) {
        const url = new URL(match[0]);
        const lab = new URL(BASE);
        url.protocol = lab.protocol;
        url.host = lab.host;
        return { href: url.toString(), subject: message.Subject };
      }
    }
  }
  throw new Error(`no sign-in link mail for ${email}`);
}
async function portalSignIn(email) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  for (let attempt = 0; attempt < 4; attempt++) {
    const { href } = await requestLink(page, email);
    await page.goto(href);
    try {
      await page.waitForURL((url) => url.pathname.startsWith("/portal"), { timeout: 20000 });
      return withApi(context, page);
    } catch {}
  }
  throw new Error(`Portal sign-in failed for ${email}`);
}
async function staff(email) {
  const s = await passwordSignIn(browser, email);
  return s;
}

const D = await staff("daniel.okafor@helix.example");
const N = await staff("nadia.haddad@helix.example");
const J = await portalSignIn("jonas.weber@helix.example");
const ROLE_SESSION = { administrator: D, legal_team_member: N, business_user: J };
const ROLE_NAME = {
  administrator: "Daniel Okafor",
  legal_team_member: "Nadia Haddad",
  business_user: "Jonas Weber",
};

// ---------------------------------------------------------------- page helpers
async function settle(page, ms = 1200) {
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await sleep(ms);
}
async function go(page, url) {
  const target = url.startsWith("http") ? url : `${BASE}${url}`;
  await page.goto(target);
  await settle(page);
  // A shared lab can be slow: wait for the page heading or main landmark, and load once more if neither appears.
  const ready = page.getByRole("heading", { level: 1 }).or(page.getByRole("main")).first();
  if (
    !(await ready
      .waitFor({ timeout: 20000 })
      .then(() => true)
      .catch(() => false))
  ) {
    results.slowLoads = [
      ...(results.slowLoads ?? []),
      { path: new URL(target).pathname, at: new Date().toISOString() },
    ];
    await page.goto(target);
    await settle(page, 2000);
  }
}
async function h1(page) {
  return clean(
    await page.getByRole("heading", { level: 1 }).first().textContent({ timeout: 15000 }),
  );
}
async function bodyText(page) {
  return clean(await page.locator("body").innerText());
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(here, name) });
  return `docs/documentation/batches/DOC-030/compat/versions-and-support-replay/${name}`;
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
async function switchNames(page) {
  const snap = await page.getByRole("main").ariaSnapshot();
  return [...snap.matchAll(/switch "([^"]+)"/g)].map((m) => m[1]);
}
const docsRegion = (page) => page.getByRole("region", { name: "Documents", exact: true });

// ---------------------------------------------------------------- fixtures
const users = must(await D.api("GET", "/users"), "users").users;
const uid = (email) => users.find((u) => u.email === email).id;
const ids = {
  daniel: uid("daniel.okafor@helix.example"),
  nadia: uid("nadia.haddad@helix.example"),
  jonas: uid("jonas.weber@helix.example"),
  amara: uid("amara.nwosu@helix.example"),
};
const ctypes = must(await D.api("GET", "/contract-types"), "ctypes").contractTypes;
const nda = ctypes.find((t) => t.displayName === "NDA").id;
const mtypes = must(await D.api("GET", "/matter-types"), "mtypes").matterTypes;
// DOC-030 harness change: at 067c1646 the seeded Matter types carry required Form Fields
// (Employment requires Country), so the fixture Matter uses the first type whose creation Form
// asks for nothing beyond Title and Matter type.
const rowsOf = (nodes) =>
  (nodes ?? []).flatMap((n) => (n.kind === "row" ? [n] : rowsOf(n.children)));
const plainMatterType = must(
  await D.api("GET", "/matters/options"),
  "matter options",
).matterTypes.find(
  (t) =>
    !rowsOf(t.creationForm).some(
      (r) => r.isRequired && !["title", "matter_type"].includes(r.rowRef),
    ),
);
const depts = must(await D.api("GET", "/departments"), "depts").departments;
const sales = depts.find((t) => t.displayName === "Sales").id;
const etypes = must(await D.api("GET", "/entities/types"), "etypes").entityTypes;
const stamp = Date.now().toString(36);
const title = (t) => `DOC-030 compat support ${t} ${stamp}`;
const newContract = async (S, t, extra = {}) =>
  must(await S.api("POST", "/contracts", { title: title(t), contractTypeId: nda, ...extra }), t)
    .contract;

const FX = { stamp };
{
  const conf = await newContract(N, "confidential contract", {
    managerId: ids.nadia,
    isConfidential: true,
  });
  FX.confidential = { number: conf.number, title: conf.title };
  const adminConf = await newContract(D, "administrator confidential contract", {
    managerId: ids.daniel,
    isConfidential: true,
  });
  FX.adminConfidential = { number: adminConf.number, title: adminConf.title };
  const shared = await newContract(N, "shared contract", { managerId: ids.nadia });
  must(
    await N.api("POST", `/contracts/${shared.number}/team`, { userId: ids.jonas }),
    "team jonas",
  );
  const v1 = must(
    await uploadFile(N.page, `/contracts/${shared.number}/documents`, {
      name: "doc029-support-v1.txt",
      mimeType: "text/plain",
      buffer: fixture("doc029-support-v1.txt"),
    }),
    "v1",
  );
  must(
    await N.api("POST", `/contracts/${shared.number}/folders`, {
      name: "DOC-030 compat support folder",
    }),
    "folder",
  );
  const folderId = must(
    await N.api("GET", `/contracts/${shared.number}/folders`),
    "folders",
  ).folders.find((f) => f.name === "DOC-030 compat support folder").id;
  FX.shared = { number: shared.number, title: shared.title, documentId: v1.document.id, folderId };
  must(
    await uploadFile(N.page, `/contracts/${shared.number}/documents`, {
      name: "doc029-support-image.png",
      mimeType: "image/png",
      buffer: fixture("doc029-support-image.png"),
    }),
    "png shared",
  );
  const kType = must(await N.api("GET", "/knowledge?limit=1"), "ktype").knowledgeItems[0]
    .knowledgeTypeId;
  const kItem = must(
    await N.api("POST", "/knowledge", { title: title("Portal Knowledge"), knowledgeTypeId: kType }),
    "knowledge",
  ).knowledgeItem;
  const kDoc = must(
    await uploadFile(N.page, `/knowledge/${kItem.id}/documents`, {
      name: "doc029-support-v1.txt",
      mimeType: "text/plain",
      buffer: fixture("doc029-support-v1.txt"),
    }),
    "k v1",
  ).document;
  must(
    await uploadFile(N.page, `/documents/${kDoc.id}/versions`, {
      name: "doc029-support-v2.txt",
      mimeType: "text/plain",
      buffer: fixture("doc029-support-v2.txt"),
      fields: { kind: "general" },
    }),
    "k v2",
  );
  must(
    await N.api("PATCH", `/knowledge/${kItem.id}`, {
      audience: "everyone",
      primaryDocumentId: kDoc.id,
      body: "DOC-030 compat support fictional guidance for the Portal file check.",
    }),
    "k patch",
  );
  must(await N.api("POST", `/knowledge/${kItem.id}/publish`, {}), "k publish");
  FX.knowledge = { id: kItem.id, title: kItem.title };
  const confPortal = await newContract(N, "confidential portal contract", {
    managerId: ids.nadia,
    isConfidential: true,
  });
  must(
    await N.api("POST", `/contracts/${confPortal.number}/team`, { userId: ids.jonas }),
    "team jonas conf",
  );
  FX.confidentialPortal = { number: confPortal.number, title: confPortal.title };
  const archived = await newContract(N, "archived contract", { managerId: ids.nadia });
  must(
    await N.api("POST", `/contracts/${archived.number}/team`, { userId: ids.jonas }),
    "team jonas archived",
  );
  FX.archived = { number: archived.number, title: archived.title };
  const approval = await newContract(D, "approval contract", { managerId: ids.daniel });
  must(
    await D.api("POST", `/contracts/${approval.number}/approvals`, {
      approverIds: [ids.nadia, ids.daniel],
    }),
    "approvals",
  );
  FX.approval = { number: approval.number, title: approval.title };
  const uploads = await newContract(N, "upload contract", { managerId: ids.nadia });
  FX.uploads = { number: uploads.number, title: uploads.title };
  const files = await newContract(N, "file behavior contract", { managerId: ids.nadia });
  FX.files = { number: files.number, title: files.title };
  const matter = must(
    await N.api("POST", "/matters", {
      title: title("related matter"),
      matterTypeId: plainMatterType.id,
      managerId: ids.nadia,
    }),
    "matter",
  ).matter;
  must(
    await N.api("POST", `/contracts/${shared.number}/matter`, { matterNumber: matter.number }),
    "link matter",
  );
  FX.relatedMatter = { number: matter.number, title: matter.title };
  const ent = must(
    await N.api("POST", "/entities", {
      legalName: title("confidential entity Ltd"),
      entityTypeId: etypes[0].id,
    }),
    "entity",
  ).entity;
  must(
    await N.api("PATCH", `/entities/${ent.id}`, { isConfidential: true }),
    "entity confidential",
  );
  FX.entity = { id: ent.id, name: ent.legalName };
  // DOC-030 harness change: only the troubleshooting (T) and reference (R) sections use the two
  // Request fixtures. At 067c1646 the retired counterparty_name intake field is refused ("That field
  // is not on this request type's form."), so these fixtures are created only when T or R runs.
  if (run("T") || run("R")) {
    const reviewType = must(await J.api("GET", "/portal/request-types/contract_review"), "rt")
      .requestType.id;
    const rq = must(
      await J.api("POST", "/requests", {
        requestTypeId: reviewType,
        departmentId: sales,
        title: title("request"),
        description: "DOC-030 compat support fictional ask for a contract review.",
        urgency: "medium",
        customFields: { counterparty_name: "DOC-029r2 Fictional Counterparty Ltd" },
      }),
      "request",
    ).request;
    const converted = must(
      await N.api("POST", `/requests/${rq.number}/convert`, {
        title: title("converted contract"),
        contractTypeId: nda,
      }),
      "convert",
    ).request;
    FX.request = {
      number: rq.number,
      contract: converted.convertedRecord?.number ?? converted.convertedContract?.number,
    };
    const rq2 = must(
      await J.api("POST", "/requests", {
        requestTypeId: reviewType,
        departmentId: sales,
        title: title("open request"),
        description: "DOC-030 compat support fictional ask left open for the Convert dialog.",
        urgency: "low",
        customFields: { counterparty_name: "DOC-029r2 Fictional Counterparty Ltd" },
      }),
      "request2",
    ).request;
    FX.openRequest = { number: rq2.number };
  }
  results.fixtures = {
    ...FX,
    createdAt: new Date().toISOString(),
    createdBy: "Nadia Haddad and Daniel Okafor API sessions, Jonas Weber Portal session",
  };
  save();
}

const T = "troubleshooting";
const R = "reference";
const V = "versions-and-support";
const C49 = "V-C49";
const C50 = "V-C50";
const C51 = "V-C51";

// Internal links of the article bytes under review, checked in the signed-out formal reader.
function articleLinks(id) {
  const md = articleBytes(id).toString("utf8");
  return [
    ...new Set(
      [...md.matchAll(/\]\(([a-z0-9-]+)\.md(#[a-z0-9-]+)?\)/g)].map((m) => `${m[1]}${m[2] ?? ""}`),
    ),
  ];
}

// ================================================================ V-C49 troubleshooting
if (run("T")) {
  for (const role of ["administrator", "legal_team_member", "business_user"]) {
    const S = ROLE_SESSION[role];
    await step(
      T,
      C49,
      role,
      "Open Help from the header and reach Resolve common problems",
      "Header Help opens the role's Help; Reference and troubleshooting lists Resolve common problems and it opens with its sections.",
      async () => {
        await go(S.page, role === "business_user" ? "/portal" : "/");
        await S.page.getByRole("banner").getByRole("link", { name: "Help", exact: true }).click();
        await settle(S.page);
        const helpUrl = new URL(S.page.url()).pathname;
        await S.page
          .getByRole("navigation", { name: "Guide navigation" })
          .getByRole("link", { name: "Reference and troubleshooting" })
          .click();
        await settle(S.page);
        await S.page.getByRole("link", { name: "Resolve common problems" }).first().click();
        await settle(S.page);
        const heading = await h1(S.page);
        check(heading === "Resolve common problems", `h1 ${heading}`);
        const h2 = (
          await S.page.getByRole("article").getByRole("heading", { level: 2 }).allInnerTexts()
        ).map(clean);
        check(
          h2.includes("I cannot sign in") && h2.includes("If the problem continues"),
          `h2 ${h2}`,
        );
        const meta = clean(
          await S.page
            .getByText(/^For .*(Validation in progress|Unverified article)?/)
            .first()
            .textContent()
            .catch(() => ""),
        );
        return `Header Help went to ${helpUrl}; Reference and troubleshooting > Resolve common problems opened ${new URL(S.page.url()).pathname} with ${h2.length} sections (${h2.join("; ")}). Meta line: ${q(meta)}.`;
      },
    );
  }

  // ---- I cannot sign in
  await step(
    T,
    C49,
    "legal_team_member",
    "I cannot sign in: staff sign-in with a wrong password, then the correct one",
    "A wrong password shows a visible error and the account still signs in with the right password.",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await go(page, "/auth/login");
      await page.getByLabel("Email").fill("nadia.haddad@helix.example");
      await page.getByLabel("Password").fill("DOC-030-compat-support-wrong-password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      const err = page.getByText("Check your email and password.");
      await err.waitFor({ timeout: 15000 });
      const methods = await buttonNames(page.getByRole("main"));
      await page.getByLabel("Password").fill(process.env.LAB_PASSWORD);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 });
      const landed = new URL(page.url()).pathname;
      await ctx.close();
      return `The staff sign-in page offered ${q(methods)}. A wrong password showed "Check your email and password." and stayed on the page. The correct password then signed in to ${landed}.`;
    },
  );
  await step(
    T,
    C49,
    "administrator",
    "I cannot sign in: Administrator staff sign-in with a wrong password, then the correct one",
    "A wrong password shows a visible error and the account still signs in.",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await go(page, "/auth/login");
      await page.getByLabel("Email").fill("daniel.okafor@helix.example");
      await page.getByLabel("Password").fill("DOC-030-compat-support-wrong-password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByText("Check your email and password.").waitFor({ timeout: 15000 });
      await page.getByLabel("Password").fill(process.env.LAB_PASSWORD);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 });
      const landed = new URL(page.url()).pathname;
      await ctx.close();
      return `Wrong password showed "Check your email and password."; the correct password signed in to ${landed}.`;
    },
  );
  await step(
    T,
    C49,
    "business_user",
    "I cannot sign in: a Portal link already used; request a new link and open the newest message",
    "Reusing a spent link shows the expired or already-used copy; a new link signs in; the Portal session does not open staff pages.",
    async () => {
      const ctx1 = await browser.newContext();
      const p1 = await ctx1.newPage();
      const first = await requestLink(p1, "jonas.weber@helix.example");
      await p1.goto(first.href);
      await p1.waitForURL((u) => u.pathname.startsWith("/portal"), { timeout: 20000 });
      const ctx2 = await browser.newContext();
      const p2 = await ctx2.newPage();
      await p2.goto(first.href);
      await settle(p2, 2000);
      const expiredUrl = new URL(p2.url()).pathname;
      const text = await bodyText(p2);
      check(
        /expired or was already used/.test(text),
        `reuse page ${expiredUrl}: ${text.slice(0, 200)}`,
      );
      const heading = await h1(p2).catch(() => "");
      const screenshot = await shot(p2, "doc030-portal-link-expired.png");
      const second = await requestLink(p2, "jonas.weber@helix.example");
      await p2.goto(second.href);
      await p2.waitForURL((u) => u.pathname.startsWith("/portal"), { timeout: 20000 });
      await go(p2, "/contracts");
      const staffAttempt = new URL(p2.url()).pathname;
      check(staffAttempt.startsWith("/portal"), `staff page ${staffAttempt}`);
      await ctx1.close();
      await ctx2.close();
      return `The first link (subject ${q(first.subject)}) signed in once. Opening the same link in a new context landed on ${expiredUrl} with heading ${q(heading)} and the text ${q(text.match(/The link has expired[^.]*\.[^.]*\./)?.[0] ?? "")}. A new link from the newest message signed in to the Portal. Going to /contracts in that session landed on ${staffAttempt}. Screenshot ${screenshot}.`;
    },
  );

  // ---- A record or search result is missing
  await step(
    T,
    C49,
    "administrator",
    "A record is missing: a direct link to a missing Contract and to an unreachable Confidential Contract",
    "Both answer Contract not found with Back to Contracts; reloads do not change access; no title leaks; after the Legal Owner adds a team entry the link opens.",
    async () => {
      const p = D.page;
      await go(p, "/contracts/999999");
      const missingH = await h1(p);
      const missingBody = clean(await p.getByRole("main").innerText());
      check(
        missingH === "Contract not found" && /Back to Contracts/.test(missingBody),
        `missing ${missingH} ${missingBody}`,
      );
      await go(p, `/contracts/${FX.confidential.number}`);
      const refusedH = await h1(p);
      const refusedBody = clean(await p.getByRole("main").innerText());
      await p.reload();
      await settle(p);
      await p.reload();
      await settle(p);
      const afterReload = await h1(p);
      const leaked = (await bodyText(p)).includes(FX.confidential.title);
      check(
        refusedH === "Contract not found" && afterReload === "Contract not found" && !leaked,
        `refused ${refusedH} ${afterReload} leak ${leaked}`,
      );
      const screenshot = await shot(p, "doc030-admin-contract-not-found.png");
      // Recovery: the Legal Owner adds the team entry through the Contract team applet.
      await go(N.page, `/contracts/${FX.confidential.number}`);
      const panel = await applet(N.page, "Contract team");
      await panel.getByRole("button", { name: "Add team member" }).click();
      const dialog = N.page.getByRole("dialog", { name: "Add team member" });
      await dialog
        .getByRole("combobox", { name: "Person" })
        .selectOption({ label: "Daniel Okafor" });
      await dialog.getByRole("button", { name: "Add", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 10000 });
      await p.reload();
      await settle(p);
      const opened = await h1(p);
      check(opened === FX.confidential.title, `after team entry ${opened}`);
      must(
        await N.api("DELETE", `/contracts/${FX.confidential.number}/team/${ids.daniel}`),
        "remove daniel",
      );
      return `C-999999 showed ${q(missingH)} and ${q(missingBody)}. Confidential C-${FX.confidential.number} (Nadia Haddad Legal Owner, Daniel not on the team) showed ${q(refusedH)} and ${q(refusedBody)}, the same answer; two reloads still showed ${q(afterReload)} and the title did not appear. Nadia added Daniel with Contract team > Add team member; Daniel's reload then opened ${q(opened)}. Nadia then removed the entry again. Screenshot ${screenshot}.`;
    },
  );
  await step(
    T,
    C49,
    "legal_team_member",
    "A page could not load: Something went wrong. with Reload after a temporary connection failure",
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
      const screenshot = await shot(p, "doc030-member-page-could-not-load.png");
      await p.context().unroute(pattern);
      await reload.click();
      await settle(p);
      const heading = await h1(p);
      check(
        hasReload === 1 && heading === FX.shared.title,
        `reload ${hasReload} heading ${heading}`,
      );
      return `With the browser's request for C-${FX.shared.number} failing, the page showed "Something went wrong." and a Reload button. After the request was allowed again, Reload opened ${q(heading)}. Screenshot ${screenshot}.`;
    },
  );
  await step(
    T,
    C49,
    "legal_team_member",
    "A record is missing: missing Contract and Matter links, and a Confidential Contract without access",
    "Missing and unreachable work give the same not-found answer; the Administrator can recover access by adding a team entry.",
    async () => {
      const p = N.page;
      await go(p, "/matters/999999");
      const matterH = await h1(p);
      const matterBody = clean(await p.getByRole("main").innerText());
      await go(p, `/contracts/${FX.adminConfidential.number}`);
      const refusedH = await h1(p);
      const refusedBody = clean(await p.getByRole("main").innerText());
      check(
        matterH === "Matter not found" && refusedH === "Contract not found",
        `${matterH} ${refusedH}`,
      );
      must(
        await D.api("POST", `/contracts/${FX.adminConfidential.number}/team`, {
          userId: ids.nadia,
        }),
        "add nadia",
      );
      await p.reload();
      await settle(p);
      const opened = await h1(p);
      check(opened === FX.adminConfidential.title, `opened ${opened}`);
      await go(p, "/contracts");
      await p
        .getByRole("combobox", { name: "Search" })
        .first()
        .fill("DOC-030 compat support administrator confidential")
        .catch(() => {});
      return `M-999999 showed ${q(matterH)} / ${q(matterBody)}. C-${FX.adminConfidential.number} (Confidential, Daniel Okafor Legal Owner) showed ${q(refusedH)} / ${q(refusedBody)}. After the Legal Owner added a team entry for Nadia, her reload opened ${q(opened)}.`;
    },
  );
  await step(
    T,
    C49,
    "business_user",
    "A record is missing (Portal): missing, Confidential without team entry, shared, archived, related Matter, and missing Knowledge",
    "Missing and unreachable Contracts show the Portal not-found copy; a team entry opens the record; archiving closes it; a linked Matter stays closed.",
    async () => {
      const p = J.page;
      const read = async (url) => {
        await go(p, url);
        return {
          h: await h1(p).catch(() => ""),
          text: clean(await p.getByRole("main").innerText()),
        };
      };
      const missing = await read("/portal/contracts/999999");
      const conf = await read(`/portal/contracts/${FX.confidential.number}`);
      const shared = await read(`/portal/contracts/${FX.shared.number}`);
      const beforeArchive = await read(`/portal/contracts/${FX.archived.number}`);
      must(await N.api("POST", `/contracts/${FX.archived.number}/archive`, {}), "archive");
      const afterArchive = await read(`/portal/contracts/${FX.archived.number}`);
      await p.reload();
      await settle(p);
      const afterReload = clean(await p.getByRole("main").innerText());
      const matter = await read(`/portal/matters/${FX.relatedMatter.number}`);
      const knowledge = await read("/portal/knowledge/01a0aaad-0000-7000-8000-000000000000");
      const copy = "This Contract does not exist, or you cannot open it.";
      check(
        missing.text.includes(copy) &&
          conf.text.includes(copy) &&
          !conf.text.includes(FX.confidential.title),
        `conf ${conf.text}`,
      );
      check(
        shared.h === FX.shared.title && beforeArchive.h === FX.archived.title,
        `shared ${shared.h} ${beforeArchive.h}`,
      );
      check(
        afterArchive.text.includes(copy) && afterReload.includes(copy),
        `archived ${afterArchive.text}`,
      );
      check(
        /Matter does not exist, or you cannot open it/.test(matter.text),
        `matter ${matter.text}`,
      );
      return `C-999999: ${q(missing.h)} / ${q(missing.text)}. Confidential C-${FX.confidential.number} without a team entry gave the same copy and no title. Shared C-${FX.shared.number} (team entry) opened ${q(shared.h)}. C-${FX.archived.number} opened before Nadia archived it and afterwards showed ${q(afterArchive.text)}, unchanged after reload. M-${FX.relatedMatter.number}, linked to C-${FX.shared.number}, showed ${q(matter.text)}. An unknown Portal Knowledge address showed ${q(knowledge.h)} / ${q(knowledge.text.slice(0, 160))}.`;
    },
  );
  await step(
    T,
    C49,
    "business_user",
    "Converted Request: reopen it in the Portal; team entry removed; Legal restores it; staff page stays closed",
    "The converted Request opens its Contract in the Portal while Jonas is on the team; without the team entry it no longer opens; the staff Contract page is not available.",
    async () => {
      const p = J.page;
      await go(p, `/portal/requests/${FX.request.number}`);
      const landed = new URL(p.url()).pathname;
      const landedH = await h1(p);
      check(landed === `/portal/contracts/${FX.request.contract}`, `landed ${landed}`);
      await applet(p, "Contract team");
      const jonasOnTeam =
        (await p
          .getByRole("complementary", { name: "Contract team" })
          .getByText("Jonas Weber")
          .count()) > 0;
      must(
        await N.api("DELETE", `/contracts/${FX.request.contract}/team/${ids.jonas}`),
        "remove jonas",
      );
      await go(p, `/portal/requests/${FX.request.number}`);
      const without = {
        path: new URL(p.url()).pathname,
        h: await h1(p).catch(() => ""),
        text: clean(await p.getByRole("main").innerText()).slice(0, 200),
      };
      check(
        !without.text.includes(FX.request.contract ? `C-${FX.request.contract}` : "zzz") ||
          without.path !== landed,
        `still opens ${JSON.stringify(without)}`,
      );
      must(
        await N.api("POST", `/contracts/${FX.request.contract}/team`, { userId: ids.jonas }),
        "readd jonas",
      );
      await go(p, `/portal/requests/${FX.request.number}`);
      const restored = new URL(p.url()).pathname;
      check(restored === landed, `restored ${restored}`);
      await go(p, `/contracts/${FX.request.contract}`);
      const staffPath = new URL(p.url()).pathname;
      check(staffPath.startsWith("/portal"), `staff ${staffPath}`);
      return `R-${FX.request.number} opened ${landed} (${q(landedH)}); the converted Contract's team held Jonas: ${jonasOnTeam}. After Nadia removed Jonas's team entry, R-${FX.request.number} showed path ${without.path}, heading ${q(without.h)}, text ${q(without.text)}. After Nadia added the entry back it opened ${restored} again. /contracts/${FX.request.contract} in the Portal session landed on ${staffPath}.`;
    },
  );

  // ---- An edit or action is unavailable
  await step(
    T,
    C49,
    "business_user",
    "An edit or action is unavailable: Business User controls on a shared Contract",
    "Fields are read-only; Add version, reply and Add team member are offered; no Task completion, Approval, signing or Stage control; a direct Field write is refused.",
    async () => {
      const p = J.page;
      await go(p, `/portal/contracts/${FX.shared.number}`);
      const overviewInputs = await p
        .getByRole("region", { name: "Overview" })
        .locator("input, select, textarea, [role=combobox]")
        .count();
      const fieldInputs = await p
        .getByRole("region", { name: "Fields" })
        .locator("input, select, textarea, [role=combobox]")
        .count();
      const buttons = await buttonNames(p.getByRole("main"));
      const forbidden = buttons.filter((b) =>
        /Approve|Reject|Send for signature|Add task|Complete|move contract|Archive|Add approver/i.test(
          b,
        ),
      );
      check(
        overviewInputs === 0 && fieldInputs === 0 && forbidden.length === 0,
        `inputs ${overviewInputs}/${fieldInputs} forbidden ${forbidden}`,
      );
      check(buttons.includes("Add version"), `no Add version in ${buttons}`);
      const patch = await J.api("PATCH", `/contracts/${FX.shared.number}`, {
        description: "DOC-030 compat support Business User edit attempt",
      });
      check(patch.status >= 400, `patch ${patch.status}`);
      // reply in the conversation
      const comments = await applet(p, "Comments");
      await comments
        .getByRole("textbox", { name: "New comment" })
        .fill(`DOC-030 compat support Portal reply ${stamp}`);
      await comments
        .getByRole("button", { name: /^(Post|Send|Comment|Add comment)/ })
        .first()
        .click()
        .catch(async () => {
          await comments.getByRole("textbox", { name: "New comment" }).press("Control+Enter");
        });
      await comments
        .getByText(`DOC-030 compat support Portal reply ${stamp}`)
        .last()
        .waitFor({ timeout: 15000 });
      // add an existing person to the non-Confidential team
      const team = await applet(p, "Contract team");
      await team.getByRole("button", { name: "Add team member" }).click();
      const dialog = p.getByRole("dialog", { name: "Add team member" });
      await dialog.waitFor({ timeout: 10000 });
      const dialogText = clean(await dialog.innerText());
      const person = dialog.getByRole("combobox").first();
      let added = "no Person picker";
      if (await person.count()) {
        const tag = await person.evaluate((e) => e.tagName);
        if (tag === "SELECT") {
          const options = (await person.locator("option").allInnerTexts()).map(clean);
          const choice =
            options.find((o) => /Amara Nwosu/.test(o)) ??
            options.find((o) => o && !/Select|Choose|…/.test(o));
          await person.selectOption({ label: choice });
          added = choice;
        } else {
          await person.fill("Amara");
          await p
            .getByRole("option", { name: /Amara Nwosu/ })
            .first()
            .click();
          added = "Amara Nwosu";
        }
      }
      await dialog.getByRole("button", { name: "Add", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 10000 });
      await team
        .getByText(added.replace(/\s*\(.*$/, "").split(" · ")[0], { exact: false })
        .first()
        .waitFor({ timeout: 10000 });
      return `Portal C-${FX.shared.number}: Overview and Fields had ${overviewInputs} and ${fieldInputs} editable controls. Buttons: ${q(buttons)}; none for Approval, Tasks, signing, Stage or archive. A direct description write answered ${patch.status}. Jonas posted a reply in Comments and it appeared. Add team member (${q(dialogText.slice(0, 160))}) added ${q(added)} to the team.`;
    },
  );
  await step(
    T,
    C49,
    "business_user",
    "An edit or action is unavailable: Add team member on a Confidential team",
    "A Business User on a Confidential Contract cannot add people to its team.",
    async () => {
      const p = J.page;
      await go(p, `/portal/contracts/${FX.confidentialPortal.number}`);
      const heading = await h1(p);
      const team = await applet(p, "Contract team");
      const add = team.getByRole("button", { name: "Add team member" });
      const count = await add.count();
      const enabled = count ? await add.isEnabled() : false;
      const apiTry = await J.api("POST", `/portal/contracts/${FX.confidentialPortal.number}/team`, {
        userId: ids.amara,
      });
      check(!enabled && apiTry.status >= 400, `add ${count}/${enabled} api ${apiTry.status}`);
      return `Jonas opened Confidential C-${FX.confidentialPortal.number} (${q(heading)}). Add team member: ${count ? (enabled ? "enabled" : "present but disabled") : "absent"}. A direct team add answered ${apiTry.status}.`;
    },
  );
  await step(
    T,
    C49,
    "legal_team_member",
    "An edit or action is unavailable: archived Contract, and a save that reports an error",
    "The archived Contract offers no Upload; a refused value shows a correction and a reload shows what actually saved.",
    async () => {
      const p = N.page;
      await go(p, `/contracts/${FX.archived.number}/documents`);
      const archivedUploads = await p.getByRole("button", { name: "Upload", exact: true }).count();
      const archivedText =
        clean(await p.locator("body").innerText()).match(/archived[^.]*\./i)?.[0] ?? "";
      await go(p, `/contracts/${FX.uploads.number}`);
      const notice = p.getByRole("spinbutton", { name: "Notice period (days)" });
      await notice.fill("99999");
      await notice.press("Tab");
      await sleep(2500);
      const shown = p.getByText("One or more request fields are invalid.");
      await shown.first().waitFor({ timeout: 15000 });
      const alerts = [clean(await shown.first().textContent())];
      const kept = await notice.inputValue();
      const invalid = await notice.getAttribute("aria-invalid");
      const described = "";
      await p.reload();
      await settle(p);
      const saved = await p.getByRole("spinbutton", { name: "Notice period (days)" }).inputValue();
      check(archivedUploads === 0, `archived uploads ${archivedUploads}`);
      check(kept === "99999" && saved !== "99999", `kept ${kept} saved ${saved}`);
      return `Archived C-${FX.archived.number} Documents showed ${archivedUploads} Upload buttons (${q(archivedText)}). On C-${FX.uploads.number}, entering 99999 in Notice period (days) showed ${q(alerts.join(" | "))} beside the field and kept the entered value ${q(kept)} (aria-invalid ${invalid}); after reload the saved value was ${q(saved)}, so the refused value had not saved.`;
    },
  );
  await step(
    T,
    C49,
    "administrator",
    "An edit or action is unavailable: Administrator reaches configured Fields; Legal Team Member does not",
    "Settings > Contracts > Fields opens for the Administrator; the Legal Team Member cannot open organization settings.",
    async () => {
      await go(D.page, "/settings/contracts/fields");
      const adminHeadings = (await D.page.getByRole("heading").allInnerTexts())
        .map(clean)
        .filter((h) => /Field/i.test(h));
      await go(N.page, "/settings/contracts/fields");
      const memberPath = new URL(N.page.url()).pathname;
      const memberHeadings = (await N.page.getByRole("heading").allInnerTexts()).map(clean);
      check(adminHeadings.length > 0, `admin ${adminHeadings}`);
      check(!memberHeadings.some((h) => /Contract fields/i.test(h)), `member ${memberHeadings}`);
      return `Daniel saw ${q(adminHeadings)} at /settings/contracts/fields. Nadia's visit ended at ${memberPath} with headings ${q(memberHeadings.slice(0, 5))}.`;
    },
  );

  // ---- An upload is refused or appears twice
  const bigPath = path.join(SCRATCH, "doc029-support-oversized.bin");
  if (!existsSync(bigPath)) writeFileSync(bigPath, Buffer.alloc(105 * 1024 * 1024, 7));
  async function uploadDialog(page, number, files) {
    await go(page, `/contracts/${number}/documents`);
    await docsRegion(page).getByRole("button", { name: "Upload", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Upload document" });
    await dialog.waitFor({ timeout: 10000 });
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      dialog.getByRole("button", { name: /Choose file/ }).click(),
    ]);
    await chooser.setFiles(files);
    await dialog.getByRole("button", { name: "Upload", exact: true }).click();
    return dialog;
  }
  async function docCount(S, number) {
    return must(await S.api("GET", `/contracts/${number}/documents`), "docs").documents.length;
  }
  await step(
    T,
    C49,
    "legal_team_member",
    "An upload is refused: oversized file, over-long filename, corrected name, and a repeat upload",
    "The oversized file names the MB limit; the long filename is refused; nothing is stored; the corrected name uploads once; sending the same file again as a new Document makes a second row.",
    async () => {
      const p = N.page;
      const before = await docCount(N, FX.uploads.number);
      let dialog = await uploadDialog(p, FX.uploads.number, bigPath);
      const bigAlert = dialog.getByText(/upload limit/);
      await bigAlert.waitFor({ timeout: 120000 });
      const bigText = clean(await bigAlert.textContent());
      await page_escape(p);
      const longName = `${"doc029-support-long-name-".repeat(12)}x.txt`;
      dialog = await uploadDialog(p, FX.uploads.number, {
        name: longName,
        mimeType: "text/plain",
        buffer: fixture("doc029-support-note.txt"),
      });
      const longAlert = dialog.getByText(/255 characters/).first();
      await longAlert.waitFor({ timeout: 30000 });
      const longText = clean(await longAlert.textContent());
      await page_escape(p);
      const afterRefusals = await docCount(N, FX.uploads.number);
      dialog = await uploadDialog(
        p,
        FX.uploads.number,
        path.join(
          root,
          "docs/documentation/batches/DOC-029/support/fixtures",
          "doc029-support-note.txt",
        ),
      );
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      await settle(p);
      const afterOne = await docCount(N, FX.uploads.number);
      dialog = await uploadDialog(
        p,
        FX.uploads.number,
        path.join(
          root,
          "docs/documentation/batches/DOC-029/support/fixtures",
          "doc029-support-note.txt",
        ),
      );
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      await settle(p);
      const docs = must(
        await N.api("GET", `/contracts/${FX.uploads.number}/documents`),
        "docs",
      ).documents;
      const rows = await docsRegion(p)
        .getByRole("row")
        .filter({ hasText: "doc029-support-note.txt" })
        .count();
      check(
        /100 MB upload limit/.test(bigText) &&
          before === afterRefusals &&
          afterOne === before + 1 &&
          docs.length === before + 2,
        `big ${bigText} counts ${before}/${afterRefusals}/${afterOne}/${docs.length}`,
      );
      return `A 105 MiB file was refused with ${q(bigText)}. A ${longName.length}-character filename was refused with ${q(longText)}. Documents stayed at ${afterRefusals}. The short name uploaded once (count ${afterOne}). Uploading the same file again as a new Document made ${docs.length - before} separate Documents, with ${rows} rows named doc029-support-note.txt in the list.`;
    },
  );
  async function page_escape(p) {
    const dialog = p.getByRole("dialog");
    const cancel = dialog.getByRole("button", { name: "Cancel" });
    if (await cancel.count()) await cancel.first().click();
    else await p.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
  }
  await step(
    T,
    C49,
    "administrator",
    "An upload is refused: over-long filename as Administrator",
    "The filename refusal is visible and nothing is stored.",
    async () => {
      const p = D.page;
      const before = await docCount(D, FX.uploads.number);
      const longName = `${"doc029-support-admin-long-name-".repeat(10)}x.txt`;
      const dialog = await uploadDialog(p, FX.uploads.number, {
        name: longName,
        mimeType: "text/plain",
        buffer: fixture("doc029-support-note.txt"),
      });
      const alert = dialog.getByText(/255 characters/).first();
      await alert.waitFor({ timeout: 30000 });
      const text = clean(await alert.textContent());
      await page_escape(p);
      const after = await docCount(D, FX.uploads.number);
      check(after === before, `${before} -> ${after}`);
      return `A ${longName.length}-character filename was refused with ${q(text)}; the Document count stayed ${after}.`;
    },
  );
  await step(
    T,
    C49,
    "business_user",
    "An upload in the Portal: Add version on the primary Document; no folder destination",
    "Add version adds Version 2 to the primary Document; the Portal upload dialog has no folder choice and a folder destination is refused.",
    async () => {
      const p = J.page;
      await go(p, `/portal/contracts/${FX.shared.number}`);
      const row = docsRegion(p)
        .getByRole("listitem")
        .filter({ hasText: "Primary Document" })
        .first();
      await row.getByRole("button", { name: "Add version" }).click();
      const dialog = p.getByRole("dialog", { name: "Upload documents" });
      await dialog.waitFor();
      const addAs = clean(
        await dialog
          .getByRole("combobox", { name: "Add as" })
          .locator("option:checked")
          .textContent(),
      );
      const controls = (await dialog.locator("label, [role=combobox], select").allInnerTexts())
        .map(clean)
        .filter(Boolean);
      await dialog
        .locator('input[type="file"]')
        .setInputFiles(
          path.join(
            root,
            "docs/documentation/batches/DOC-029/support/fixtures",
            "doc029-support-v2.txt",
          ),
        );
      await dialog.getByRole("button", { name: "Upload", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      await settle(p);
      const rowText = clean(
        await docsRegion(p)
          .getByRole("listitem")
          .filter({ hasText: "Primary Document" })
          .first()
          .innerText(),
      );
      const folderTry = await uploadFile(p, `/contracts/${FX.shared.number}/documents`, {
        name: "doc029-support-folder-try.txt",
        mimeType: "text/plain",
        buffer: fixture("doc029-support-note.txt"),
        fields: { folderId: FX.shared.folderId },
      });
      const hasFolder = controls.some((c) => /folder/i.test(c));
      check(
        /Version 2/.test(rowText) &&
          /New version of/.test(addAs) &&
          !hasFolder &&
          folderTry.status >= 400,
        `row ${rowText} addAs ${addAs} folder ${hasFolder} ${folderTry.status}`,
      );
      return `On the Primary Document row, Add version opened Upload documents with Add as ${q(addAs)} and controls ${q(controls)} (no folder choice). After Upload the row read ${q(rowText.slice(0, 120))}. An upload naming a folder answered ${folderTry.status} ${q(folderTry.json?.detail ?? "")}.`;
    },
  );

  // ---- A preview stays pending or fails
  let damaged = null;
  await step(
    T,
    C49,
    "legal_team_member",
    "A preview stays pending or fails: damaged Word file; Download reads the original",
    "The reader shows the pending message, then the failure message; Download returns the original bytes; reopening adds no Version.",
    async () => {
      const p = N.page;
      const dialog = await uploadDialog(
        p,
        FX.uploads.number,
        path.join(
          root,
          "docs/documentation/batches/DOC-029/support/fixtures",
          "doc029-support-damaged.docx",
        ),
      );
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      await settle(p, 300);
      const docs = must(
        await N.api("GET", `/contracts/${FX.uploads.number}/documents`),
        "docs",
      ).documents;
      damaged = docs.find((d) => d.title === "doc029-support-damaged.docx");
      await p
        .getByRole("button", { name: "doc029-support-damaged.docx", exact: true })
        .first()
        .click();
      const panel = p.getByRole("complementary", {
        name: "doc029-support-damaged.docx, version 1",
      });
      await panel.waitFor({ timeout: 30000 });
      const pending = panel.getByText("Preparing this document for reading…");
      const failed = panel.getByText(
        "This file could not be prepared for reading here. Download it to read it.",
      );
      await pending.or(failed).first().waitFor({ timeout: 30000 });
      const sawPending = await pending.isVisible().catch(() => false);
      await failed.waitFor({ timeout: 240000 });
      const dl = await download(p, () =>
        panel.getByRole("link", { name: "Download" }).first().click(),
      );
      const screenshot = await shot(p, "doc030-member-preview-failed.png");
      await panel.getByRole("button", { name: "Close the document" }).click();
      await p
        .getByRole("button", { name: "doc029-support-damaged.docx", exact: true })
        .first()
        .click();
      await p
        .getByRole("complementary", { name: "doc029-support-damaged.docx, version 1" })
        .getByText("This file could not be prepared")
        .waitFor({ timeout: 30000 });
      const versions = must(
        await N.api("GET", `/contracts/${FX.uploads.number}/documents`),
        "docs",
      ).documents.find((d) => d.id === damaged.id).versions.length;
      check(
        dl.sha256 === sha(fixture("doc029-support-damaged.docx")) && versions === 1,
        `dl ${dl.sha256} versions ${versions}`,
      );
      return `The reader ${sawPending ? 'first showed "Preparing this document for reading…" and then' : "(the pending state had already passed when the panel opened)"} showed "This file could not be prepared for reading here. Download it to read it.". Download returned ${dl.name}, ${dl.bytes} bytes, SHA-256 equal to the fixture. Reopening showed the same failure and the chain still had ${versions} Version. Screenshot ${screenshot}.`;
    },
  );
  await step(
    T,
    C49,
    "administrator",
    "A preview fails: the Administrator reads the failed Version and downloads the original",
    "The failure message and Download are shown; the original downloads.",
    async () => {
      check(damaged, "no damaged Document from the previous step");
      const p = D.page;
      await go(p, `/contracts/${FX.uploads.number}/documents`);
      await p
        .getByRole("button", { name: "doc029-support-damaged.docx", exact: true })
        .first()
        .click();
      const panel = p.getByRole("complementary", {
        name: "doc029-support-damaged.docx, version 1",
      });
      await panel
        .getByText("This file could not be prepared for reading here. Download it to read it.")
        .waitFor({ timeout: 30000 });
      const dl = await download(p, () =>
        panel.getByRole("link", { name: "Download" }).first().click(),
      );
      await panel.getByRole("button", { name: "Close the document" }).click();
      check(dl.sha256 === sha(fixture("doc029-support-damaged.docx")), "bytes differ");
      return `Daniel saw the failure message on the same Version; Download returned ${dl.bytes} bytes matching the uploaded original.`;
    },
  );

  // ---- A notification or email is missing
  for (const role of ["administrator", "legal_team_member"]) {
    const S = ROLE_SESSION[role];
    await step(
      T,
      C49,
      role,
      "A notification is missing: staff Notification preferences and profile timezone",
      "Groups show In-app and Email switches, a Briefing section and the In-app/Email rule; Profile has a Timezone control.",
      async () => {
        await go(S.page, "/settings/notifications");
        const switches = await switchNames(S.page);
        const briefing = await S.page.getByRole("heading", { name: "Briefing" }).count();
        const caption = clean(
          await S.page
            .getByText(/In-app off turns the group off entirely/)
            .first()
            .textContent(),
        );
        await go(S.page, "/settings/profile");
        const tz = await S.page.getByRole("combobox", { name: "Timezone" }).count();
        check(
          switches.some((s) => /In-app$/.test(s)) &&
            switches.some((s) => /Email$/.test(s)) &&
            briefing === 1 &&
            tz === 1,
          `switches ${switches} briefing ${briefing} tz ${tz}`,
        );
        return `Switches: ${q(switches)}. Briefing heading present. Caption: ${q(caption)}. Profile showed a Timezone control.`;
      },
    );
  }
  await step(
    T,
    C49,
    "business_user",
    "A notification is missing: Portal Notification settings",
    "Notification settings lists Request updates, Assigned to you and Activity on your records with In-app and Email.",
    async () => {
      const p = J.page;
      await go(p, "/portal");
      await p.getByRole("banner").getByRole("link", { name: "Notification settings" }).click();
      await settle(p);
      const switches = await switchNames(p);
      const caption = clean(
        await p
          .getByText(/In-app off turns the group off entirely/)
          .first()
          .textContent(),
      );
      for (const g of ["Request updates", "Assigned to you", "Activity on your records"])
        check(
          switches.includes(`${g} In-app`) && switches.includes(`${g} Email`),
          `missing ${g} in ${switches}`,
        );
      return `The header link Notification settings opened ${new URL(p.url()).pathname} with switches ${q(switches)} and caption ${q(caption)}.`;
    },
  );

  // ---- Approvals
  await step(
    T,
    C49,
    "administrator",
    "I cannot approve: only the named person can answer",
    "On a request naming another person the requester sees only Cancel request; on the request naming himself he sees Approve and Reject.",
    async () => {
      const p = D.page;
      await go(p, `/contracts/${FX.approval.number}/approvals`);
      const other = await menuItems(p, p.getByRole("button", { name: "Actions for Nadia Haddad" }));
      const own = await menuItems(p, p.getByRole("button", { name: "Actions for Daniel Okafor" }));
      const direct = must(
        await D.api("GET", `/contracts/${FX.approval.number}/approvals`),
        "approvals",
      ).approvals.find((a) => a.approver.id === ids.nadia);
      const wrong = await D.api("POST", `/approvals/${direct.id}/decision`, {
        decision: "approved",
      });
      check(
        !other.includes("Approve") && own.includes("Approve") && wrong.status >= 400,
        `other ${other} own ${own} wrong ${wrong.status}`,
      );
      return `On C-${FX.approval.number}, Actions for Nadia Haddad offered ${q(other)}; Actions for Daniel Okafor offered ${q(own)}. A direct decision on Nadia's request answered ${wrong.status}.`;
    },
  );
  await step(
    T,
    C49,
    "legal_team_member",
    "I cannot approve: the named approver decides once; the decision is final",
    "The dialog says a decision is final; afterwards no decision control remains and a second decision is refused.",
    async () => {
      const p = N.page;
      await go(p, `/contracts/${FX.approval.number}/approvals`);
      await p.getByRole("button", { name: "Actions for Nadia Haddad" }).click();
      await p.getByRole("menuitem", { name: "Approve" }).click();
      const dialog = p.getByRole("dialog").first();
      await dialog.waitFor();
      const dialogText = clean(await dialog.innerText());
      await dialog.getByRole("button", { name: "Approve", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 15000 });
      await settle(p);
      const row = clean(
        await p.getByRole("row").filter({ hasText: "Nadia Haddad" }).first().innerText(),
      );
      const actions = p.getByRole("button", { name: "Actions for Nadia Haddad" });
      const after = (await actions.count()) ? await menuItems(p, actions) : [];
      const approvalId = must(
        await N.api("GET", `/contracts/${FX.approval.number}/approvals`),
        "a",
      ).approvals.find((a) => a.approver.id === ids.nadia).id;
      const again = await N.api("POST", `/approvals/${approvalId}/decision`, {
        decision: "rejected",
      });
      check(
        /Approved/.test(row) && !after.includes("Reject") && again.status >= 400,
        `row ${row} after ${after} again ${again.status}`,
      );
      return `The Approve dialog read ${q(dialogText)}. After Approve the row read ${q(row)}; its actions offered ${q(after)}. A second decision answered ${again.status}.`;
    },
  );
  await step(
    T,
    C49,
    "administrator",
    "An Approval warning appears: Move past approval with a Pending request; Cancel",
    "Moving to an Active Status opens Move past approval listing the Pending request; Cancel keeps the Status.",
    async () => {
      const p = D.page;
      await go(p, `/contracts/${FX.approval.number}`);
      await p.getByRole("button", { name: /— move contract/ }).click();
      await p
        .getByRole("menuitemradio")
        .filter({ hasText: /^Active/ })
        .first()
        .click();
      const dialog = p.getByRole("dialog", { name: "Move past approval" });
      await dialog.waitFor({ timeout: 15000 });
      const text = clean(await dialog.innerText());
      const screenshot = await shot(p, "doc030-admin-move-past-approval.png");
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      await settle(p);
      const status = must(await D.api("GET", `/contracts/${FX.approval.number}`), "c").contract
        .statusName;
      check(
        /Pending/.test(text) && /Daniel Okafor/.test(text) && status === "Draft",
        `text ${text} status ${status}`,
      );
      return `The dialog read ${q(text)}. Cancel closed it and the Status stayed ${status}. Screenshot ${screenshot}.`;
    },
  );

  // ---- Electronic signing unavailable
  await step(
    T,
    C49,
    "administrator",
    "Electronic signing is unavailable: connector state and manual hand-off",
    "Integrations > E-signature shows the connector state; with no connector there is no Send for signature, and Mark as executed copy stays available.",
    async () => {
      await go(D.page, "/settings/integrations/e-signature");
      const state =
        clean(await D.page.getByRole("main").innerText()).match(
          /DocuSign[^]*?(Not connected|Connected|Enabled|Disabled)/,
        )?.[0] ?? "";
      await go(D.page, `/contracts/${FX.shared.number}/approvals`);
      const send = await D.page.getByRole("button", { name: "Send for signature" }).count();
      await go(D.page, `/contracts/${FX.shared.number}/documents`);
      const items = await menuItems(
        D.page,
        D.page.getByRole("button", { name: "Actions for doc029-support-v1.txt" }),
      );
      check(
        /Not connected/.test(state) && send === 0 && items.includes("Mark as executed copy"),
        `state ${state} send ${send} items ${items}`,
      );
      return `Integrations > E-signature read ${q(state)}. C-${FX.shared.number} Approvals had ${send} Send for signature controls. The primary Document's actions offered ${q(items)}, including Mark as executed copy for manual hand-off.`;
    },
  );
  await step(
    T,
    C49,
    "legal_team_member",
    "Electronic signing is unavailable: no send control for the Legal Team Member",
    "No Send for signature appears while the connector is not connected; manual hand-off remains available.",
    async () => {
      await go(N.page, `/contracts/${FX.shared.number}/approvals`);
      const send = await N.page.getByRole("button", { name: "Send for signature" }).count();
      const region = clean(
        await N.page
          .getByRole("region", { name: "Approvals & signing" })
          .innerText()
          .catch(() => ""),
      );
      await go(N.page, `/contracts/${FX.shared.number}/documents`);
      const items = await menuItems(
        N.page,
        N.page.getByRole("button", { name: "Actions for doc029-support-v1.txt" }),
      );
      check(send === 0 && items.includes("Mark as executed copy"), `send ${send} items ${items}`);
      return `Approvals & signing (${q(region.slice(0, 160))}) had no Send for signature. The primary Document offered ${q(items)}.`;
    },
  );

  // ---- Analysis and AI conversion
  await step(
    T,
    C49,
    "administrator",
    "Analysis is missing: AI analysis settings show the provider state",
    "The AI analysis settings page shows whether the provider is connected; Field prompts are visible for the Administrator.",
    async () => {
      await go(D.page, "/settings/ai-analysis");
      const text = clean(await D.page.getByRole("main").innerText());
      const state = text.match(/Provider\s*(Not connected|Connected)/)?.[0] ?? "";
      const prompts = await D.page.getByRole("heading", { name: "Field prompts" }).count();
      check(/Not connected/.test(state) && prompts === 1, `state ${state}`);
      return `AI analysis read ${q(state)} with a Field prompts section. The article's step to ask the Administrator about connector or Field-prompt configuration matches this page.`;
    },
  );
  await step(
    T,
    C49,
    "legal_team_member",
    "Analysis and AI conversion are unavailable: Contract and Convert dialog without a provider",
    "No Analysis run control appears on the Contract; the Convert dialog allows manual conversion without a Conversion draft.",
    async () => {
      const p = N.page;
      await go(p, `/contracts/${FX.shared.number}`);
      const analysisButtons = (await buttonNames(p.locator("body"))).filter((b) =>
        /analy|AI/i.test(b),
      );
      const aiCard = await p.getByText("AI analysis", { exact: true }).count();
      await go(p, `/inbox/${FX.openRequest.number}`);
      const triage = p.getByRole("button", { name: "Triage" });
      await triage.click();
      const convertItem = p
        .getByRole("menuitem", { name: /Convert to contract/ })
        .or(p.getByRole("button", { name: /Convert to contract/ }))
        .first();
      await convertItem.waitFor({ timeout: 10000 });
      await convertItem.click();
      const dialog = p.getByRole("dialog").first();
      await dialog.waitFor({ timeout: 15000 });
      await sleep(2500);
      const text = clean(await dialog.innerText());
      const preparing = /Preparing|Conversion draft/i.test(text);
      const cancel = dialog.getByRole("button", { name: "Cancel" });
      if (await cancel.count()) await cancel.click();
      else await p.keyboard.press("Escape");
      const status = must(await N.api("GET", `/requests/${FX.openRequest.number}`), "r").request
        .status;
      check(
        analysisButtons.length === 0 && !preparing && status !== "converted",
        `buttons ${analysisButtons} preparing ${preparing} status ${status}`,
      );
      return `C-${FX.shared.number} showed no Analysis buttons (${q(analysisButtons)}) and ${aiCard} AI analysis cards. Triage > Convert to contract on R-${FX.openRequest.number} opened a dialog reading ${q(text.slice(0, 300))} with no Conversion draft preparation; Cancel left the Request ${status}.`;
    },
  );
}

// ================================================================ V-C50 reference
if (run("R")) {
  await step(
    R,
    C50,
    "administrator",
    "Roles: the role control offers the fixed account roles",
    "The role control offers Administrator, Legal team member and Business user, with no Contributor or operator role.",
    async () => {
      const p = D.page;
      await go(p, "/settings/users");
      await p
        .getByRole("button", {
          name: "Legal team member — change the role of priya.raman@helix.example",
        })
        .click();
      const menu = p.getByRole("menu").or(p.getByRole("listbox")).or(p.getByRole("dialog")).first();
      await menu.waitFor({ timeout: 10000 });
      const options = clean(await menu.innerText());
      await p.keyboard.press("Escape");
      check(
        /Administrator/.test(options) &&
          /Legal team member/.test(options) &&
          /Business user/.test(options) &&
          !/Contributor|operator/i.test(options),
        options,
      );
      return `The role control for Priya Raman offered ${q(options)}. Escape closed it with no change.`;
    },
  );
  await step(
    R,
    C50,
    "administrator",
    "Stage, Status and Category: fixed backbones behind configurable labels",
    "Contract statuses each show one Stage from Draft, Review, Approval, Signature, Active, Ended; a new Matter status asks for Open or Closed.",
    async () => {
      const p = D.page;
      await go(p, "/settings/contracts/statuses");
      const stages = [
        ...new Set(
          (clean(await p.getByRole("main").innerText()).match(/Stage: (\w+)/g) ?? []).map((s) =>
            s.slice(7),
          ),
        ),
      ];
      await go(p, "/settings/matters/statuses");
      await p.getByRole("button", { name: "Add status" }).click();
      await sleep(800);
      const scope = p.getByRole("dialog").first();
      const inDialog = (await scope.count()) ? scope : p.getByRole("main");
      const category = inDialog
        .getByRole("combobox")
        .filter({ has: p.locator("option", { hasText: "Closed" }) })
        .first();
      const opts = (await category.count())
        ? (await category.locator("option").allInnerTexts()).map(clean)
        : [clean(await inDialog.innerText()).slice(0, 200)];
      const cancel = inDialog.getByRole("button", { name: "Cancel" });
      if (await cancel.count()) await cancel.first().click();
      else await p.keyboard.press("Escape");
      const expected = ["Draft", "Review", "Approval", "Signature", "Active", "Ended"];
      check(
        expected.every((s) => stages.includes(s)) &&
          stages.every((s) => expected.includes(s)) &&
          opts.some((o) => /Open/.test(o)) &&
          opts.some((o) => /Closed/.test(o)),
        `stages ${stages} opts ${opts}`,
      );
      return `Contract statuses showed Stages ${q(stages)}. Matter statuses > Add status offered Category choices ${q(opts)}; Cancel left the list unchanged.`;
    },
  );
  await step(
    R,
    C50,
    "legal_team_member",
    "Task and Key date, Entity and Counterparty: compare the terms with the Contract dialogs",
    "Add a key date has no assignee but has reminder lead times and team recipients; Add task has an assignee and due date; the Contract shows Our entity separately from Counterparties.",
    async () => {
      const p = N.page;
      await go(p, `/contracts/${FX.shared.number}/key-dates`);
      await p.getByRole("button", { name: "Add date" }).click();
      const kd = p.getByRole("dialog", { name: "Add a key date" });
      await kd.waitFor();
      await kd.getByRole("checkbox", { name: "Nadia Haddad" }).waitFor({ timeout: 20000 });
      const kdText = clean(await kd.innerText());
      const kdAssignee = /assign/i.test(kdText);
      await kd.getByRole("button", { name: "Cancel" }).click();
      await go(p, `/contracts/${FX.shared.number}/tasks`);
      await p.getByRole("button", { name: "Add task" }).click();
      await sleep(1000);
      const taskScope = p.getByRole("dialog").first();
      const taskText = clean(
        await (
          (await taskScope.count()) ? taskScope : p.getByRole("region", { name: "Tasks" })
        ).innerText(),
      );
      await p.keyboard.press("Escape");
      await go(p, `/contracts/${FX.shared.number}`);
      const entity = await p.getByRole("combobox", { name: "Our entity" }).count();
      const counterparties = await p.getByRole("combobox", { name: "Counterparties" }).count();
      check(
        !kdAssignee &&
          /Additional lead time/.test(kdText) &&
          /Nadia Haddad/.test(kdText) &&
          entity === 1 &&
          counterparties === 1,
        `kd ${kdText} entity ${entity} cp ${counterparties}`,
      );
      return `Add a key date read ${q(kdText.slice(0, 420))}: no assignee, an Additional lead time and team recipients. Add task showed ${q(taskText.slice(0, 260))}. The Contract Overview has separate Our entity and Counterparties controls.`;
    },
  );
  await step(
    R,
    C50,
    "legal_team_member",
    "Document terms: Version kinds, Executed pin, primary Document, no Version delete; permanent delete is Administrator-only",
    "Kind offers Draft · ours and Executed; actions offer Mark as executed copy; no Version delete action; only the Administrator sees permanent deletion.",
    async () => {
      await go(N.page, `/contracts/${FX.shared.number}/documents`);
      const kinds = (
        await N.page
          .getByRole("combobox", { name: /^Kind of version \d+ of doc029-support-v1.txt/ })
          .first()
          .locator("option")
          .allInnerTexts()
      ).map(clean);
      const primary = clean(
        await N.page
          .getByRole("row")
          .filter({ hasText: "doc029-support-v1.txt" })
          .first()
          .innerText(),
      );
      const memberItems = await menuItems(
        N.page,
        N.page.getByRole("button", { name: "Actions for doc029-support-v1.txt" }),
      );
      await go(D.page, `/contracts/${FX.shared.number}/documents`);
      const adminItems = await menuItems(
        D.page,
        D.page.getByRole("button", { name: "Actions for doc029-support-v1.txt" }),
      );
      const versionDelete = [...memberItems, ...adminItems].filter((i) =>
        /delete.*version/i.test(i),
      );
      const adminDelete = adminItems.filter((i) => /delete/i.test(i));
      const memberDelete = memberItems.filter((i) => /delete/i.test(i));
      check(
        kinds.includes("Draft · ours") &&
          kinds.includes("Executed") &&
          memberItems.includes("Mark as executed copy") &&
          versionDelete.length === 0 &&
          adminDelete.length > 0 &&
          memberDelete.length === 0,
        `kinds ${kinds} member ${memberItems} admin ${adminItems}`,
      );
      return `Kind options: ${q(kinds)}. Row: ${q(primary.slice(0, 120))}. Nadia's actions: ${q(memberItems)}. Daniel's actions: ${q(adminItems)}. No action deletes a single Version; only the Administrator's menu has ${q(adminDelete)}.`;
    },
  );
  await step(
    R,
    C50,
    "legal_team_member",
    "File behavior: PNG reads inline, SVG is download-only, EML opens the email reader",
    "The PNG opens in the reader, the SVG shows the download-only card, and the EML shows its subject and body.",
    async () => {
      const S = N;
      for (const [f, mime] of [
        ["doc029-support-image.png", "image/png"],
        ["doc029-support-diagram.svg", "image/svg+xml"],
        ["doc029-support-message.eml", "message/rfc822"],
      ]) {
        must(
          await uploadFile(S.page, `/contracts/${FX.files.number}/documents`, {
            name: f,
            mimeType: mime,
            buffer: fixture(f),
          }),
          f,
        );
      }
      const docs = must(
        await S.api("GET", `/contracts/${FX.files.number}/documents`),
        "docs",
      ).documents;
      const open = async (name) => {
        const doc = docs.find((d) => d.title === name);
        const v = doc.versions.at(-1);
        await go(S.page, `/contracts/${FX.files.number}/documents?doc=${doc.id}&version=${v.id}`);
        await sleep(4000);
        const panel = S.page
          .getByRole("complementary")
          .filter({ has: S.page.getByRole("button", { name: "Close the document" }) })
          .first();
        const visible = await panel.isVisible().catch(() => false);
        return {
          visible,
          text: visible ? clean(await panel.innerText()).slice(0, 220) : "",
          imgs: visible ? await panel.locator("img").count() : 0,
        };
      };
      const png = await open("doc029-support-image.png");
      const svg = await open("doc029-support-diagram.svg");
      const eml = await open("doc029-support-message.eml");
      check(png.visible && png.imgs > 0, `png ${JSON.stringify(png)}`);
      check(/does not open here/.test(svg.text) || !svg.visible, `svg ${JSON.stringify(svg)}`);
      check(/DOC-029 support fictional message/.test(eml.text), `eml ${JSON.stringify(eml)}`);
      return `PNG reader: ${png.imgs} image(s), ${q(png.text.slice(0, 80))}. SVG: ${svg.visible ? q(svg.text) : "no reader opened"}. EML reader: ${q(eml.text)}.`;
    },
  );
  await step(
    R,
    C50,
    "administrator",
    "Permissions: the Administrator needs a Grant for a Confidential Entity and named access for a Confidential Contract",
    "Without a Grant the Entity answers Entity not found; with a Grant it opens; the Confidential Contract without team entry answers Contract not found.",
    async () => {
      const p = D.page;
      await go(p, `/entities/${FX.entity.id}`);
      const before = await h1(p);
      must(
        await N.api("POST", `/entities/${FX.entity.id}/grants`, { userId: ids.daniel }),
        "grant",
      );
      await p.reload();
      await settle(p);
      const withGrant = await h1(p);
      must(await N.api("DELETE", `/entities/${FX.entity.id}/grants/${ids.daniel}`), "revoke");
      await p.reload();
      await settle(p);
      const revoked = await h1(p);
      await go(p, `/contracts/${FX.confidential.number}`);
      const contract = await h1(p);
      check(
        before === "Entity not found" &&
          withGrant === FX.entity.name &&
          revoked === "Entity not found" &&
          contract === "Contract not found",
        `${before} ${withGrant} ${revoked} ${contract}`,
      );
      return `Confidential Entity: ${q(before)} before the Grant, ${q(withGrant)} after Nadia granted Daniel, ${q(revoked)} after removal. Confidential C-${FX.confidential.number}: ${q(contract)}.`;
    },
  );
  await step(
    R,
    C50,
    "legal_team_member",
    "Permissions: organization settings remain Administrator-only",
    "The Legal Team Member cannot open Settings > Users.",
    async () => {
      await go(N.page, "/settings/users");
      const pathName = new URL(N.page.url()).pathname;
      const headings = (await N.page.getByRole("heading").allInnerTexts()).map(clean);
      const invite = await N.page.getByRole("button", { name: "Invite user" }).count();
      check(invite === 0, `invite ${invite}`);
      return `Nadia's visit to /settings/users ended at ${pathName} with headings ${q(headings.slice(0, 5))} and no Invite user control.`;
    },
  );
  await step(
    R,
    C50,
    "business_user",
    "Permissions and Portal files: staff workspace closed; shared Documents read and download with earlier Versions; related Matter closed",
    "Staff addresses land in the Portal; the shared Contract's primary Document shows Version 2 with Version 1 available to read and download; the linked Matter is not reachable.",
    async () => {
      const p = J.page;
      await go(p, "/documents");
      const staffPath = new URL(p.url()).pathname;
      await go(p, `/portal/contracts/${FX.shared.number}`);
      const row = docsRegion(p)
        .getByRole("listitem")
        .filter({ hasText: "Primary Document" })
        .first();
      const rowText = clean(await row.innerText());
      const earlier = row.getByRole("button", { name: /earlier version/i });
      let earlierText = "no earlier Versions control";
      if (await earlier.count()) {
        await earlier.first().click();
        await sleep(800);
        earlierText = clean(await docsRegion(p).innerText()).slice(0, 300);
      }
      const links = await docsRegion(p)
        .getByRole("link", { name: /^Download doc029-support-v[12]\.txt, version [12]$/ })
        .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") || e.textContent));
      const v1 = docsRegion(p)
        .getByRole("link", { name: /^Download .*version 1$/ })
        .first();
      const dl = (await v1.count()) ? await download(p, () => v1.click()) : null;
      await docsRegion(p)
        .getByRole("button", { name: "doc029-support-image.png", exact: true })
        .first()
        .click();
      const pngPanel = p.getByRole("complementary", {
        name: "doc029-support-image.png, version 1",
      });
      await pngPanel.waitFor({ timeout: 30000 });
      await sleep(2000);
      const reader = await pngPanel.locator("img").count();
      check(
        staffPath.startsWith("/portal") &&
          /Version 2/.test(rowText) &&
          links.length === 2 &&
          reader > 0 &&
          dl?.sha256 === sha(fixture("doc029-support-v1.txt")),
        `staff ${staffPath} row ${rowText} links ${links}`,
      );
      return `/documents in the Portal session landed on ${staffPath}. Primary Document row: ${q(rowText.slice(0, 140))}. Earlier Versions: ${q(earlierText)}. Download links: ${q(links)}${dl ? `; Version 1 downloaded ${dl.bytes} bytes (${dl.sha256 === sha(fixture("doc029-support-v1.txt")) ? "matches" : "differs from"} the uploaded v1)` : ""}. Selecting doc029-support-image.png opened the Portal reader with ${reader} image(s). The related Matter refusal is recorded in the Portal missing-record step.`;
    },
  );
  await step(
    R,
    C50,
    "business_user",
    "Portal files: published Knowledge offers current-file downloads without a Version picker",
    "A published Knowledge Item with a two-Version file shows a Download for the current file only.",
    async () => {
      const p = J.page;
      await go(p, `/portal/knowledge/${FX.knowledge.id}`);
      const main = p.getByRole("main");
      const heading = await h1(p);
      const links = (await main.getByRole("link", { name: /Download/ }).allInnerTexts()).map(clean);
      const versionControls = await main
        .getByRole("combobox")
        .or(main.getByRole("button", { name: /version/i }))
        .count();
      const dl = await download(p, () =>
        main
          .getByRole("link", { name: /Download/ })
          .first()
          .click(),
      );
      check(
        heading === FX.knowledge.title &&
          links.length === 1 &&
          versionControls === 0 &&
          dl.sha256 === sha(fixture("doc029-support-v2.txt")),
        `h ${heading} links ${links} vc ${versionControls} dl ${dl.bytes}`,
      );
      return `Portal Knowledge ${q(heading)} (published, audience everyone, primary file with Versions 1 and 2) showed ${links.length} Download link (${q(links)}) and ${versionControls} Version controls. The download returned ${dl.bytes} bytes equal to Version 2, the current file.`;
    },
  );
  await step(
    R,
    C50,
    "operator",
    "Deployment operator: read the reference signed out in the formal documentation",
    "The formal reader opens without an app session and shows the Deployment operator row and MAX_UPLOAD_MB.",
    async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const apiCalls = [];
      page.on("request", (r) => {
        if (new URL(r.url()).pathname.startsWith("/api/")) apiCalls.push(new URL(r.url()).pathname);
      });
      await go(page, "/documentation/reference");
      const heading = await h1(page);
      const text = await bodyText(page);
      const disk = articleBytes("reference").toString("utf8");
      const operatorRow = /Deployment operator\s*Maintains the installation/.test(text);
      const limit = text.includes("MAX_UPLOAD_MB");
      await go(page, "/help");
      const helpRedirect = new URL(page.url()).pathname;
      await ctx.close();
      check(
        heading === "Look up terms, permissions, and file behavior" &&
          operatorRow &&
          limit &&
          disk.includes("MAX_UPLOAD_MB") &&
          disk.includes("| Deployment operator |") &&
          helpRedirect.startsWith("/documentation"),
        `h ${heading} row ${operatorRow} limit ${limit} help ${helpRedirect}`,
      );
      return `Signed out, /documentation/reference showed ${q(heading)}, the Deployment operator row and MAX_UPLOAD_MB. App API requests seen while reading signed out: ${q(apiCalls)} (a session check, not organisation data). Signed-out /help landed on ${helpRedirect}. The reviewed bytes carry the same row and variable.`;
    },
  );
  await step(
    R,
    C50,
    "operator",
    "Links in the reviewed reference resolve in the formal documentation",
    "Every internal link and anchor in the reviewed bytes opens an article and heading in the bundled edition.",
    async () => linkCheck("reference"),
  );
}

async function linkCheck(id) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const bad = [];
  const links = articleLinks(id);
  for (const link of links) {
    const [target, anchor] = link.split("#");
    await go(page, `/documentation/${target}`);
    const heading = await h1(page).catch(() => "");
    if (heading === "Article unavailable" || !heading) bad.push(`${link}: ${heading}`);
    else if (anchor && !(await page.locator(`[id="${anchor}"]`).count()))
      bad.push(`${link}: no anchor`);
  }
  await ctx.close();
  check(bad.length === 0, `unresolved ${bad}`);
  return `${links.length} internal targets from the reviewed bytes all opened in /documentation: ${q(links)}.`;
}

// ================================================================ V-C51 versions and support
if (run("V")) {
  const staffRoles = ["administrator", "legal_team_member"];
  for (const role of [...staffRoles, "business_user"]) {
    const S = ROLE_SESSION[role];
    const helpBase = role === "business_user" ? "/portal/help" : "/help";
    await step(
      V,
      C51,
      role,
      "Find the applicable edition: Help, All documentation below Browse guides, Edition details",
      "Header Help opens Help; the Documentation navigation below Browse guides holds Help and All documentation; Edition details lists the edition, Supported app, Distribution commit, Content digest and Publication target with the standalone links.",
      async () => {
        const p = S.page;
        await go(p, role === "business_user" ? "/portal" : "/");
        await p.getByRole("banner").getByRole("link", { name: "Help", exact: true }).click();
        await settle(p);
        await go(p, `${helpBase}/versions-and-support`);
        const heading = await h1(p);
        const order = await p.evaluate(() => {
          const guides = document.querySelector('[aria-label="Guide navigation"]');
          const docs = document.querySelector('nav[aria-label="Documentation"]');
          return guides && docs
            ? Boolean(guides.compareDocumentPosition(docs) & Node.DOCUMENT_POSITION_FOLLOWING)
            : null;
        });
        const docNav = (
          await p
            .getByRole("navigation", { name: "Documentation" })
            .getByRole("link")
            .allInnerTexts()
        ).map(clean);
        const badge = clean(
          await p
            .getByText(/^(Validation in progress|Unverified article)$/)
            .first()
            .textContent()
            .catch(() => "none"),
        );
        const preview = await p
          .locator("body")
          .evaluate(
            (b) =>
              [...b.querySelectorAll("*")].filter(
                (e) =>
                  !e.closest("article") &&
                  e.children.length === 0 &&
                  e.textContent.trim() ===
                    "Development preview: draft and validation content is unverified.",
              ).length,
          );
        const details = p.locator("details#edition");
        await details.locator("summary").click();
        const pairs = await details
          .locator("dl")
          .evaluate((dl) =>
            [...dl.querySelectorAll("dt")].map((dt) => [
              dt.textContent.trim(),
              dt.nextElementSibling?.textContent.trim(),
            ]),
          );
        const detailLinks = (await details.getByRole("link").allInnerTexts()).map(clean);
        const retention = clean(await details.locator("p").last().textContent());
        const screenshot =
          role === "administrator" ? await shot(p, "doc030-admin-edition-details.png") : null;
        await p
          .getByRole("navigation", { name: "Documentation" })
          .getByRole("link", { name: "All documentation" })
          .click();
        await settle(p);
        const allPath = new URL(p.url()).pathname;
        const labels = pairs.map((x) => x[0]);
        check(
          heading === "Find version information and get help" &&
            order === true &&
            docNav.join("|") === "Help|All documentation" &&
            allPath === "/documentation",
          `h ${heading} order ${order} nav ${docNav} all ${allPath}`,
        );
        check(
          [
            "Edition details",
            "Supported app",
            "Distribution commit",
            "Content digest",
            "Publication target",
          ].every((l) => labels.includes(l)) &&
            detailLinks.includes("Open standalone edition") &&
            detailLinks.includes("Download standalone edition"),
          `pairs ${JSON.stringify(pairs)} links ${detailLinks}`,
        );
        results.edition ??= Object.fromEntries(pairs);
        return `Header Help worked; ${helpBase}/versions-and-support opened ${q(heading)} with badge ${q(badge)} and ${preview} development preview notices outside the article prose. The Documentation navigation after Guide navigation (Browse guides) held ${q(docNav)}. Edition details: ${q(pairs)}; links ${q(detailLinks)}; ${q(retention)}. All documentation opened ${allPath}.${screenshot ? ` Screenshot ${screenshot}.` : ""}`;
      },
    );
    await step(
      V,
      C51,
      role,
      "If a link names another edition, a missing article or a missing section",
      "An unknown edition and a missing article show Article unavailable with their explanation and a way back; a missing section shows its notice and On this page; nothing loads an external manual.",
      async () => {
        const p = S.page;
        const external = [];
        const listener = (r) => {
          const u = new URL(r.url());
          if (u.host !== new URL(BASE).host && !u.protocol.startsWith("data"))
            external.push(u.host);
        };
        p.on("request", listener);
        await go(p, `${helpBase}/versions-and-support?edition=doc029-support-older-edition`);
        const edH = await h1(p);
        const edText = clean(
          await p
            .getByText(/requested edition is not bundled/)
            .first()
            .textContent(),
        );
        await go(p, `${helpBase}/doc029-support-missing-article`);
        const missH = await h1(p);
        const missText = clean(
          await p
            .getByText(/not available in the bundled edition/)
            .first()
            .textContent(),
        );
        const back = (await p.getByRole("link", { name: "Overview" }).count()) > 0;
        await go(p, `${helpBase}/versions-and-support#doc029-support-missing-section`);
        const secText = clean(
          await p
            .getByText(/requested section is unavailable/)
            .first()
            .textContent(),
        );
        const outline = await p.getByText("On this page", { exact: true }).count();
        p.off("request", listener);
        check(
          edH === "Article unavailable" &&
            missH === "Article unavailable" &&
            back &&
            outline > 0 &&
            external.length === 0,
          `ed ${edH} miss ${missH} back ${back} outline ${outline} ext ${external}`,
        );
        return `?edition=doc029-support-older-edition: ${q(edH)} / ${q(edText)}. Missing article: ${q(missH)} / ${q(missText)} with an Overview link. Missing section: ${q(secText)} with On this page. External requests: ${q([...new Set(external)])}.`;
      },
    );
    await step(
      V,
      C51,
      role,
      "An article outside the Help selection offers the full documentation; search finds the support guide",
      "The out-of-selection article offers Read this article in the full documentation, which opens the formal article; searching for version information finds this guide.",
      async () => {
        const p = S.page;
        const outside = role === "business_user" ? "configure-analysis" : "upgrade";
        await go(p, `${helpBase}/${outside}`);
        const heading = await h1(p);
        const link = p.getByRole("link", { name: "Read this article in the full documentation" });
        const count = await link.count();
        await link.first().click();
        await settle(p);
        const formalPath = new URL(p.url()).pathname;
        const formalH = await h1(p);
        await go(p, helpBase);
        await p
          .getByRole("searchbox", { name: "Search documentation" })
          .fill("version information");
        await p.getByRole("button", { name: "Search", exact: true }).click();
        await settle(p);
        const found = await p
          .getByRole("link", { name: "Find version information and get help" })
          .count();
        check(
          count === 1 && formalPath === `/documentation/${outside}` && found > 0,
          `count ${count} formal ${formalPath} found ${found}`,
        );
        return `${helpBase}/${outside} showed ${q(heading)} with Read this article in the full documentation, which opened ${formalPath} (${q(formalH)}). Search "version information" in Help listed the guide.`;
      },
    );
    await step(
      V,
      C51,
      role,
      "Report a defect: the GitHub tracker link, and an external failure leaves local reading usable",
      "The tracker link points at the OpenLaw GitHub issues; with GitHub blocked the navigation fails and the local article reads again.",
      async () => {
        const p = S.page;
        await go(p, `${helpBase}/versions-and-support`);
        const tracker = p.getByRole("link", { name: "OpenLaw GitHub issue tracker" });
        const href = await tracker.getAttribute("href");
        await p.context().route(/github\.com/, (route) => route.abort("internetdisconnected"));
        let failure = "no error";
        try {
          await Promise.all([p.waitForEvent("requestfailed", { timeout: 10000 }), tracker.click()]);
          failure = "request to github.com failed";
        } catch (e) {
          failure = clean(e.message).slice(0, 120);
        }
        await settle(p, 800);
        await p.context().unroute(/github\.com/);
        await go(p, `${helpBase}/versions-and-support`);
        const heading = await h1(p);
        const report = await p
          .getByRole("heading", { name: "Report a product defect or documentation correction" })
          .count();
        check(
          href === "https://github.com/juggernog20/OpenLaw/issues" &&
            heading === "Find version information and get help" &&
            report === 1,
          `href ${href} h ${heading}`,
        );
        return `Tracker link href ${q(href)}. With github.com blocked: ${failure}. Returning to the local article showed ${q(heading)} and its report section.`;
      },
    );
  }

  await step(
    V,
    C51,
    "operator",
    "Signed-out reading, standalone edition, and an offline copy with and without JavaScript",
    "Formal documentation reads signed out; Open standalone edition loads; the downloaded edition extracts and its index and prose open from disk offline, with and without JavaScript.",
    async () => {
      const ctx = await browser.newContext({ acceptDownloads: true });
      const page = await ctx.newPage();
      const apiCalls = [];
      page.on("request", (r) => {
        if (new URL(r.url()).pathname.startsWith("/api/")) apiCalls.push(new URL(r.url()).pathname);
      });
      await go(page, "/documentation/versions-and-support");
      const heading = await h1(page);
      await page.locator("details#edition summary").click();
      const openHref = await page
        .getByRole("link", { name: "Open standalone edition" })
        .getAttribute("href");
      const dl = await download(page, () =>
        page.getByRole("link", { name: "Download standalone edition" }).click(),
      );
      const saved = path.join(SCRATCH, "export.tar.gz");
      const [dlEvent] = [null];
      const res = await page.request.get(
        `${BASE}/documentation-export/openlaw-documentation.tar.gz`,
      );
      writeFileSync(saved, await res.body());
      const outDir = path.join(SCRATCH, "export");
      rmSync(outDir, { recursive: true, force: true });
      mkdirSync(outDir, { recursive: true });
      execFileSync("tar", ["-xzf", saved, "-C", outDir]);
      const findIndex = (dir) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          if (e.isFile() && e.name === "index.html") return path.join(dir, e.name);
        }
        for (const e of readdirSync(dir, { withFileTypes: true }))
          if (e.isDirectory()) {
            const f = findIndex(path.join(dir, e.name));
            if (f) return f;
          }
        return null;
      };
      const index = findIndex(outDir);
      await go(page, openHref);
      const servedTitle = await page.title();
      await ctx.close();
      const read = async (js) => {
        const c = await browser.newContext({ javaScriptEnabled: js, offline: true });
        const pg = await c.newPage();
        await pg.goto(`file://${index}`);
        let t = clean(await pg.locator("body").innerText()).slice(0, 5000);
        let article = "";
        await pg.locator('a[href="section-reference.html"]').first().click();
        await pg.waitForLoadState("load");
        const sectionText = clean(await pg.locator("body").innerText()).slice(0, 300);
        await pg.locator('a[href="versions-and-support.html"]').first().click();
        await pg.waitForLoadState("load");
        article = clean(await pg.locator("body").innerText());
        t += ` || section: ${sectionText}`;
        await c.close();
        return { t, article };
      };
      const withJs = await read(true);
      const noJs = await read(false);
      check(
        heading === "Find version information and get help" &&
          index &&
          /Report a product defect/.test(withJs.article) &&
          /Report a product defect/.test(noJs.article),
        `h ${heading} idx ${index} nojs ${noJs.article.slice(0, 100)}`,
      );
      const noscript = /requires JavaScript|needs JavaScript/i.test(noJs.t);
      return `Signed out, /documentation/versions-and-support showed ${q(heading)} (app API calls ${q(apiCalls)}). Download standalone edition gave ${dl.name} (${dl.bytes} bytes). Open standalone edition (${openHref}) served ${q(servedTitle)}. The archive extracted to an index at ${path.relative(outDir, index)}. In an offline context from file://, with JavaScript the index and the support article read; without JavaScript the index read (search notice shown: ${noscript}) and the article prose included "Report a product defect or documentation correction".`;
    },
  );
  await step(
    V,
    C51,
    "operator",
    "Links in the reviewed versions-and-support and troubleshooting bytes resolve",
    "Every internal link and anchor opens in the bundled edition.",
    async () => {
      const a = await linkCheck("versions-and-support");
      const b = await linkCheck("troubleshooting");
      return `versions-and-support: ${a} troubleshooting: ${b}`;
    },
  );
  await step(
    V,
    C51,
    "administrator",
    "Check the relevant limitation: Administrators need named access to Confidential Contracts",
    "The Administrator without a team entry or Legal Owner role gets Contract not found for a Confidential Contract.",
    async () => {
      await go(D.page, `/contracts/${FX.confidential.number}`);
      const heading = await h1(D.page);
      check(heading === "Contract not found", heading);
      return `Daniel opened Confidential C-${FX.confidential.number} and saw ${q(heading)}.`;
    },
  );
}

await browser.close();
results.summary = {
  total: results.steps.length,
  pass: results.steps.filter((s) => s.result === "pass").length,
  fail: results.steps.filter((s) => s.result === "fail").length,
};
save();
console.log(JSON.stringify(results.summary));
