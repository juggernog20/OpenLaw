// DOC-030 independent walkthrough, group "search", article search-and-views (scenario V-C04).
// Follows docs/user-guides/search-and-views.md in a browser for an Administrator and a Legal Team Member.
// Usage: LAB_PASSWORD=<seed demo password> node walkthrough.mjs [role ...]
// The seed password comes from the environment only. Links, cookies and mail bodies stay in memory.
// Fresh "DOC-030 search" staff accounts do the walking, so seeded accounts keep their saved views and
// searches. Daniel Okafor creates the fixtures through the lab API (scripts/seed/client.mjs).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Session } from "../../../../../scripts/seed/client.mjs";
import { chromium } from "../../../../../node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const LAB = JSON.parse(readFileSync(path.join(root, ".documentation-labs/work2/lab.json"), "utf8"));
const BASE = LAB.appUrl;
const MAIL = LAB.mailUrl;
const PROJECT = LAB.project;
const PASSWORD = process.env.LAB_PASSWORD;
if (!PASSWORD) throw new Error("Set LAB_PASSWORD to the seed demo password in VALIDATION.md.");
// Fixture state (IDs and generated fixture-account passwords) lives outside docs/.
const FX_FILE =
  process.env.FX_FILE ?? path.join(process.env.HOME, ".cache/doc030-search-walkthrough-fx.json");
const A = "search-and-views";
const S = "V-C04";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DANIEL = "daniel.okafor@helix.example";
// A seeded Business User few other walkthroughs sign in as, to spare the shared link budget.
const BUSINESS = "lena.vogel@helix.example";

// ---------- step log ----------
const steps = [];
const productBugs = [];
const guideFailures = [];
function record(role, step, expected, actual, pass, page) {
  const s = {
    article: A,
    scenario: S,
    role,
    step,
    page: page ?? null,
    expected,
    actual: String(actual).slice(0, 1500),
    result: pass ? "pass" : "fail",
    at: new Date().toISOString(),
  };
  steps.push(s);
  console.log(`${pass ? "PASS" : "FAIL"} [${role}] ${step} :: ${s.actual.slice(0, 260)}`);
  return pass;
}
const txt = async (loc) => (await loc.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
const seen = (loc, timeout = 10000) =>
  loc
    .first()
    .waitFor({ timeout })
    .then(
      () => true,
      () => false,
    );
const pathOf = (p) => {
  const u = new URL(p.url());
  return u.pathname + (u.search.length > 60 ? u.search.slice(0, 60) + "…" : u.search);
};
function decodeAq(url) {
  const aq = new URL(url).searchParams.get("aq");
  if (!aq) return null;
  return JSON.parse(Buffer.from(aq, "base64url").toString("utf8"));
}

// ---------- lab helpers ----------
function sql(query) {
  return execFileSync(
    "docker",
    ["exec", `${PROJECT}-postgres-1`, "psql", "-U", "openlaw", "-d", "openlaw", "-At", "-c", query],
    { encoding: "utf8" },
  ).trim();
}
async function apiSignIn(email, password = PASSWORD) {
  const s = new Session(email, BASE);
  await s.request("POST", "/api/auth/sign-in/email", {
    json: { email, password },
    headers: { origin: BASE },
  });
  return s;
}
const H = { headers: { origin: BASE } };
async function mailLink(email, since, subjectRe) {
  const until = Date.now() + 45000;
  while (Date.now() < until) {
    const r = await fetch(
      `${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=20`,
    ).then((x) => x.json());
    const m = (r.messages ?? []).find(
      (m) => new Date(m.Created).getTime() >= since - 1500 && subjectRe.test(m.Subject),
    );
    if (m) {
      const full = await fetch(`${MAIL}/api/v1/message/${m.ID}`).then((x) => x.json());
      const links = (full.Text ?? "").match(/https?:\/\/[^\s<>"')\]]+/g) ?? [];
      const pick = links.find((l) => /magic-link\/verify|reset|password|invite|token/i.test(l)) ?? links[0];
      if (pick) {
        const u = new URL(pick.replace(/[.,]+$/, ""));
        const lab = new URL(BASE);
        u.protocol = lab.protocol;
        u.host = lab.host;
        return u.toString();
      }
    }
    await sleep(700);
  }
  return null;
}

function pdf(line) {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 14 Tf 72 700 Td (${line}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out +=
    `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offsets.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([Buffer.from(out, "latin1")], { type: "application/pdf" });
}
const dayOffset = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// ---------- fixtures ----------
async function fixtures() {
  if (existsSync(FX_FILE) && !process.env.FRESH) {
    const fx = JSON.parse(readFileSync(FX_FILE, "utf8"));
    console.log(`reusing fixtures ${fx.stamp}`);
    // A reused fixture Field was archived at the end of the previous run; restore it for this one.
    const d = await apiSignIn(DANIEL);
    await d.post(`/api/v1/fields/${fx.field.id}/restore`, {}, H).catch(() => {});
    delete fx.fieldUrls;
    return fx;
  }
  const d = await apiSignIn(DANIEL);
  const stamp = Date.now();
  const letters = String(stamp)
    .slice(-8)
    .split("")
    .map((c) => "abcdefghij"[Number(c)])
    .join("");
  const fx = {
    stamp,
    prefix: `DOC-030 search ${S} ${stamp}`,
    T: `quire${letters}`,
    X: `vellum${letters}`,
    W1: `ember${letters}`,
    W2: `frost${letters}`,
    accounts: {},
    created: [],
  };
  const users = (await d.get("/api/v1/users", H)).body.users;
  fx.danielId = users.find((u) => u.email === DANIEL).id;
  const ctypes = (await d.get("/api/v1/contract-types", H)).body.contractTypes;
  const nda = ctypes.find((t) => t.displayName === "NDA") ?? ctypes[0];
  const mtypes = (await d.get("/api/v1/matter-types", H)).body;
  const contract = async (label, extra = {}) => {
    const r = await d.post(
      "/api/v1/contracts",
      { title: `${fx.prefix} ${label}`, contractTypeId: nda.id, managerId: fx.danielId, ...extra },
      H,
    );
    await sleep(1200); // distinct created_at values for the Newest and Oldest checks
    return r.body.contract.number;
  };
  // Creation order: Charlie, Alpha, Bravo (Matter), Delta, then the Document on Holder.
  fx.charlie = await contract(`Charlie ${fx.T} ${fx.X}`, { expiryDate: dayOffset(200) });
  fx.alpha = await contract(`Alpha ${fx.T}`, { expiryDate: dayOffset(30) });
  // Use the first Matter type whose Intake needs no answers.
  let m;
  for (const t of mtypes.matterTypes ?? mtypes.types ?? mtypes) {
    m = await d
      .post("/api/v1/matters", { title: `${fx.prefix} Bravo ${fx.T}`, matterTypeId: t.id, managerId: fx.danielId }, H)
      .catch(() => null);
    if (m) break;
  }
  fx.bravo = m.body.matter.number;
  await sleep(1200);
  fx.delta = await contract(`Delta ${fx.T}`);
  fx.golf = await contract(`Golf ${fx.X}`);
  fx.holder = await contract(`Holder`);
  fx.hidden = await contract(`Confidential ${fx.T}`, { isConfidential: true });
  const form = new FormData();
  form.append(
    "file",
    pdf(`DOC-030 search fictional clause names ${fx.T} and ${fx.W1} inside this Document.`),
    `${fx.prefix} Echo.pdf`,
  );
  const up = await d.upload(`/api/v1/contracts/${fx.holder}/documents`, form, H);
  fx.documentId = up.body.document.id;
  // Wait for text processing of version 1, then add version 2 with different words.
  const findDoc = async (word) => {
    const r = await d.get(`/api/v1/search?q=${word}&kind=document`, H);
    return r.body.results.some((x) => x.kind === "document" && x.id === fx.documentId);
  };
  let v1 = false;
  for (let i = 0; i < 90 && !v1; i++) {
    v1 = await findDoc(fx.W1);
    if (!v1) await sleep(2000);
  }
  const form2 = new FormData();
  form2.append(
    "file",
    pdf(`DOC-030 search revised clause names ${fx.T} and ${fx.W2} inside this Document.`),
    `${fx.prefix} Echo.pdf`,
  );
  await d.upload(`/api/v1/documents/${fx.documentId}/versions`, form2, H);
  let v2 = false;
  for (let i = 0; i < 90 && !v2; i++) {
    v2 = await findDoc(fx.W2);
    if (!v2) await sleep(2000);
  }
  fx.indexed = { v1, v2, v1GoneAfterV2: !(await findDoc(fx.W1)) };
  // A contract-scope Field for the Fields, archived-Field and open-error checks.
  const f = await d.post(
    "/api/v1/fields",
    { displayName: `${fx.prefix} reference`, moduleScope: "contract", fieldType: "text" },
    H,
  );
  fx.field = { id: f.body.field.id, label: f.body.field.displayName };
  // Daniel reaches the Confidential Contract, so its absence for the walkers is reach, not a missing row.
  fx.danielSeesHidden = (await d.get(`/api/v1/search?q=${fx.T}&kind=contract`, H)).body.results.some(
    (x) => x.number === fx.hidden,
  );
  fx.created.push(
    `Contracts C-${fx.charlie} (Charlie, expiry +200 d), C-${fx.alpha} (Alpha, expiry +30 d), C-${fx.delta} (Delta, no expiry), C-${fx.golf} (Golf, exclusion word only), C-${fx.holder} (Holder, owns the Document), Confidential C-${fx.hidden}; Matter M-${fx.bravo} (Bravo); Document "${fx.prefix} Echo.pdf" v1 and v2 on C-${fx.holder}; contract Field "${fx.field.label}"`,
  );
  // Fresh walker accounts.
  for (const role of ["administrator", "legal_team_member"]) {
    const short = role === "administrator" ? "admin" : "member";
    const email = `doc030.search.${short}.${stamp}@helix.example`;
    const displayName = `DOC-030 search ${role === "administrator" ? "Administrator" : "Legal Team Member"} ${stamp % 100000}`;
    const password = `Doc030-${short}-fixture-${stamp}`;
    const since = Date.now();
    const inv = await d.post("/api/v1/auth/invites", { email, displayName, role }, H);
    const link = await mailLink(email, since, /password|invit|join|welcome/i);
    if (!link) throw new Error(`no invite mail for ${email}`);
    const b = await chromium.launch({ headless: true });
    const pg = await (await b.newContext()).newPage();
    await pg.goto(link);
    await pg.getByLabel("New password").fill(password);
    await pg.getByLabel("Confirm password").fill(password);
    await pg.getByRole("button", { name: "Set password" }).click();
    await pg.getByText("Password set").waitFor({ timeout: 20000 });
    await b.close();
    fx.accounts[role] = { email, displayName, password, userId: inv.body.user.id };
    fx.created.push(`${role} account ${email} (${displayName})`);
  }
  writeFileSync(FX_FILE, JSON.stringify(fx, null, 2));
  return fx;
}

// ---------- browser ----------
let browser;
async function context() {
  browser ??= await chromium.launch({ headless: true });
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: "Europe/London" });
  return { context: c, page: await c.newPage() };
}
async function signIn(email, password) {
  const c = await context();
  await c.page.goto(`${BASE}/auth/login`);
  await c.page.getByLabel("Email").fill(email);
  await c.page.getByLabel("Password").fill(password);
  await c.page.getByRole("button", { name: "Sign in", exact: true }).click();
  await c.page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 });
  return c;
}

// ---------- walk ----------
async function walk(role, fx) {
  const R = (step, expected, actual, pass, p) => record(role, step, expected, actual, pass, p);
  const acct = fx.accounts[role];
  const c = await signIn(acct.email, acct.password);
  const p = c.page;
  // Reset: remove this fixture account's saved searches and views left by an earlier development run.
  let leftovers = 0;
  for (const surface of ["search", "contracts"]) {
    const v = await p.request.get(`${BASE}/api/v1/list-views?surface=${surface}`, H).then((r) => r.json());
    for (const view of v.views ?? []) {
      await p.request.delete(`${BASE}/api/v1/list-views/${view.id}`, H);
      leftovers++;
    }
  }
  if (leftovers) console.log(`removed ${leftovers} leftover views for ${role}`);
  const nameOf = (text) =>
    ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Golf", "Holder", "Confidential"].find((n) =>
      text.includes(`${fx.prefix} ${n}`),
    ) ?? "other";
  const rows = async () =>
    (await p.locator("main li").evaluateAll((els) => els.map((e) => e.innerText))).map((t) =>
      t.replace(/\s+/g, " ").trim(),
    );
  const totalText = async () => txt(p.locator("main p").filter({ hasText: /^\d+ match(es)?$/ }));
  const header = p.getByRole("combobox", { name: "Search" });
  const listbox = p.getByRole("listbox", { name: "Search results" });
  const dialog = p.getByRole("dialog", { name: "Advanced search" });
  const preview = dialog.getByRole("region", { name: "Preview" });
  const previewTotal = async (settle = 1200) => {
    await sleep(settle);
    for (let i = 0; i < 40; i++) {
      const t = await txt(preview.getByRole("heading").first());
      if (/match/.test(t) && !(await preview.getByText("Searching…").isVisible().catch(() => false)))
        return t;
      await sleep(250);
    }
    return txt(preview);
  };
  const headerGroups = async () => {
    await sleep(1500);
    await listbox.getByRole("status").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
    return listbox.getByRole("group").evaluateAll((gs) =>
      gs.map((g) => ({
        group: g.getAttribute("aria-label"),
        options: [...g.querySelectorAll("[role=option]")].map((o) => o.innerText.replace(/\s+/g, " ").trim()),
      })),
    );
  };
  const typeHeader = async (value) => {
    await header.click();
    await header.fill("");
    await header.fill(value);
    await listbox.waitFor({ timeout: 10000 }).catch(() => {});
  };
  const openDialogFromHeader = async () => {
    await p.getByRole("button", { name: "Advanced search", exact: true }).click();
    await dialog.waitFor();
  };
  const kindChip = (k) => dialog.getByRole("group", { name: "Kinds" }).getByRole("button", { name: k, exact: true });
  const addCondition = async (kindLabel, property) => {
    await dialog.getByRole("button", { name: "Add condition" }).click();
    const props = p.getByRole("dialog", { name: "Properties" });
    await props.getByLabel("Search properties").fill(property);
    await props.getByRole("group", { name: kindLabel }).getByRole("button", { name: property, exact: true }).click();
    return dialog.getByRole("group", { name: `${kindLabel} ${property} condition` });
  };
  const chooseValues = async (row, label, values) => {
    await row.getByRole("button", { name: "Choose values" }).click();
    const pop = p.getByRole("dialog", { name: label });
    for (const v of values) await pop.getByRole("checkbox", { name: v, exact: true }).click();
    await pop.getByRole("button", { name: "Apply" }).click();
  };
  const clearDialog = async () => {
    await dialog.getByRole("button", { name: "Clear", exact: true }).click();
    await sleep(300);
  };
  const closeDialog = async () => {
    await dialog.getByRole("button", { name: "Close Advanced search" }).click();
    await dialog.waitFor({ state: "detached" });
  };
  const onlyMine = (list) => list.map(nameOf);

  // ===== Before you start: reach =====
  // ===== Search across your work, steps 1-3 =====
  await p.goto(`${BASE}/`);
  await sleep(1500);
  await p.locator("body").click({ position: { x: 5, y: 450 } });
  await p.keyboard.press("/");
  const focused = await header.evaluate((el) => el === document.activeElement);
  await p.keyboard.type("q");
  await sleep(800);
  const oneCharList = await listbox.isVisible().catch(() => false);
  await p.keyboard.type(fx.T.slice(1));
  await listbox.waitFor({ timeout: 10000 });
  const groups = await headerGroups();
  const groupSummary = groups.map((g) => `${g.group}: ${g.options.map(nameOf).join(",")}`).join("; ");
  const flat = groups.flatMap((g) => g.options.map(nameOf));
  const docOpt = groups.find((g) => g.group === "Document")?.options[0] ?? "";
  R(
    "Search across your work, steps 1-2: / focuses Search; two characters open the header list",
    "/ outside a text field focuses the header Search box; one character opens no list; the unique word lists the reachable Contracts, the Matter and the Document grouped by kind, never the Confidential Contract",
    `/ focused Search ${focused}; list after one character ${oneCharList}; groups ${groupSummary}; Document option "${docOpt.slice(0, 140)}"; Confidential listed ${flat.includes("Confidential")}`,
    focused &&
      !oneCharList &&
      ["Alpha", "Charlie", "Delta", "Bravo", "Echo"].every((n) => flat.includes(n)) &&
      !flat.includes("Confidential") &&
      docOpt.includes(`C-${fx.holder} · ${fx.prefix} Holder`),
    "/",
  );
  await listbox.getByRole("option", { name: /See all results/ }).click();
  await p.waitForURL(/\/search\?q=/);
  await p.locator("main li").filter({ hasText: fx.prefix }).first().waitFor({ timeout: 15000 });
  await sleep(1000);
  const r1 = await rows();
  const t1 = await totalText();
  const docRow = r1.find((r) => nameOf(r) === "Echo") ?? "";
  const heading = await txt(p.getByRole("heading", { level: 1 }).first());
  const sortBtn = p.getByRole("button", { name: /^Sort: / });
  const sortName0 = await sortBtn.getAttribute("aria-label");
  R(
    "Search across your work, step 3: See all results opens the results page",
    "The results page shows the exact match total above the rows and the Document row names its owning record as C-n · title; the match is in the Document although the owner title lacks the word; the sort starts at Relevance",
    `URL ${pathOf(p)}; heading "${heading}"; total "${t1}" with ${r1.length} rows (${onlyMine(r1).join(",")}); Document row "${docRow.slice(0, 160)}"; sort control "${sortName0}"`,
    t1 === `${r1.length} matches` &&
      r1.length === 5 &&
      docRow.includes(`C-${fx.holder} · ${fx.prefix} Holder`) &&
      !onlyMine(r1).includes("Confidential") &&
      sortName0 === "Sort: Relevance",
    "/search",
  );

  // Step 4: kind links.
  const kindNav = p.getByRole("navigation", { name: "Filter search results" });
  await kindNav.getByRole("link", { name: "Document", exact: true }).click();
  await p.waitForURL(/aq=|kind=document/);
  await sleep(1500);
  const rDoc = await rows();
  await kindNav.getByRole("link", { name: "All", exact: true }).click();
  await sleep(1500);
  const rAll = await rows();
  R(
    "Search across your work, step 4: a kind narrows and All returns",
    "Document keeps only Document rows; All returns every kind",
    `Document: ${rDoc.length} rows (${onlyMine(rDoc).join(",")}); All: ${rAll.length} rows (${onlyMine(rAll).join(",")}); URL ${pathOf(p)}`,
    rDoc.length === 1 && nameOf(rDoc[0]) === "Echo" && rAll.length === 5,
    "/search",
  );

  // Document result opens the latest Version with the find text.
  await p.goto(`${BASE}/search?q=${fx.T}`);
  await p.locator("main li").filter({ hasText: `${fx.prefix} Echo` }).getByRole("link").click();
  await p.waitForURL(new RegExp(`/contracts/${fx.holder}/documents\\?.*find=`), { timeout: 15000 });
  const docUrl = new URL(p.url());
  const latestVersion = sql(
    `select id from document_versions where document_id='${fx.documentId}' order by version_number desc limit 1`,
  );
  await sleep(4000);
  const findFilled = await p
    .locator("input")
    .evaluateAll((els, t) => els.some((e) => e.value === t), fx.T);
  R(
    "Document result opens the latest Version with the reader's find control",
    "Opening the Document result goes to the owning record's Documents with the latest Version and the search text in find",
    `Opened ${docUrl.pathname}; version param is latest (v2) ${docUrl.searchParams.get("version") === latestVersion}; find param "${docUrl.searchParams.get("find") === fx.T ? "the search word" : docUrl.searchParams.get("find")}"; a find input holds the word ${findFilled}`,
    docUrl.searchParams.get("version") === latestVersion && findFilled,
    docUrl.pathname,
  );

  // Earlier Versions' words are not searched.
  await p.goto(`${BASE}/search?q=${fx.W1}`);
  const oldGone = await seen(p.getByText("No matches", { exact: true }), 15000);
  await p.goto(`${BASE}/search?q=${fx.W2}`);
  await p.locator("main li").first().waitFor({ timeout: 15000 }).catch(() => {});
  const newRows = await rows();
  R(
    "Each Document appears once from its latest Version; earlier Versions' words are not searched",
    "A word only in version 1 finds nothing; a word only in version 2 finds the one Document row",
    `Version 1 word: No matches ${oldGone}; version 2 word: ${newRows.length} row(s) (${onlyMine(newRows).join(",")})`,
    oldGone && newRows.length === 1 && nameOf(newRows[0]) === "Echo",
    "/search",
  );

  // Header list up to ten per kind; results page total and 25 rows with Show more.
  await p.goto(`${BASE}/`);
  await sleep(1000);
  await typeHeader("helix");
  const hg = await headerGroups();
  const perKind = hg.map((g) => `${g.group} ${g.options.length}`).join(", ");
  await listbox.getByRole("option", { name: /See all results/ }).click();
  await p.waitForURL(/\/search\?q=helix/);
  await p.locator("main li").first().waitFor({ timeout: 15000 });
  const helixTotal = await totalText();
  const firstPage = (await rows()).length;
  const more = p.getByRole("button", { name: "Show more" });
  const hasMore = await more.isVisible();
  await more.click();
  await sleep(2500);
  const secondPage = (await rows()).length;
  R(
    "Header list shows up to ten per kind; results page shows the exact total and 25 rows at a time; Show more",
    "No kind group exceeds ten rows; the results page total exceeds the header rows; 25 rows then Show more adds the next page",
    `Header groups: ${perKind}; results total "${helixTotal}"; first page ${firstPage} rows; Show more visible ${hasMore}; after Show more ${secondPage} rows`,
    hg.every((g) => g.options.length <= 10) &&
      hg.some((g) => g.options.length === 10) &&
      firstPage === 25 &&
      hasMore &&
      secondPage > 25 &&
      Number(helixTotal.split(" ")[0]) >= secondPage,
    "/search",
  );

  // Counterparty result opens the Contract results for its name.
  await typeHeader("Northwind Traders");
  await headerGroups();
  const cpOption = listbox.getByRole("group", { name: "Counterparty" }).getByRole("option").first();
  const cpText = await txt(cpOption);
  await cpOption.click();
  await p.waitForURL(/\/search\?/);
  await sleep(1500);
  const cpUrl = new URL(p.url());
  const cpRows = await rows();
  const contractOnly = await kindNav.getByRole("link", { name: "Contract", exact: true }).getAttribute("aria-current");
  R(
    "A Counterparty result opens the Contract results for that Counterparty's name",
    "Selecting the Counterparty goes to the results page for its name with the Contract kind selected",
    `Option "${cpText}"; URL q="${cpUrl.searchParams.get("q")}" kind=${cpUrl.searchParams.get("kind")}; Contract kind current ${contractOnly}; ${cpRows.length} rows, all Contracts ${cpRows.every((r) => /^C-\d+/.test(r))}`,
    cpUrl.searchParams.get("kind") === "contract" &&
      cpText.includes(cpUrl.searchParams.get("q") ?? "\u0000") &&
      contractOnly === "page" &&
      cpRows.length > 0,
    "/search",
  );

  // ===== Combine words and conditions =====
  await p.goto(`${BASE}/`);
  await sleep(1000);
  await typeHeader(fx.T);
  await openDialogFromHeader();
  const carried = await dialog.getByLabel("All of these words").inputValue();
  const labels = [];
  for (const l of ["All of these words", "This exact phrase", "Any of these words", "None of these words"])
    labels.push(`${l} ${await dialog.getByLabel(l).isVisible()}`);
  const scopes = [];
  for (const l of ["Titles and numbers", "Record text", "Document contents"])
    scopes.push(`${l} ${await dialog.getByRole("checkbox", { name: l }).isChecked()}`);
  const kindsList = await dialog
    .getByRole("group", { name: "Kinds" })
    .getByRole("button")
    .evaluateAll((bs) => bs.map((b) => b.innerText.trim()));
  const addDisabled = await dialog.getByRole("button", { name: "Add condition" }).isDisabled();
  const total0 = await previewTotal();
  R(
    "Combine words and conditions: the sliders open Advanced search with the header words in All of these words",
    "Header words carry into All of these words; four Words rows; three Search in boxes checked; seven Kinds; Add condition unavailable with no kind",
    `All of these words holds the header word ${carried === fx.T}; rows ${labels.join(", ")}; Search in ${scopes.join(", ")}; Kinds ${kindsList.join(", ")}; Add condition disabled ${addDisabled}; Preview "${total0}"`,
    carried === fx.T &&
      kindsList.join(",") === "Contract,Matter,Document,Entity,Counterparty,Request,Knowledge Item" &&
      addDisabled &&
      total0 === "5 matches",
    "dialog",
  );
  await closeDialog();
  // Advanced search… at the foot of the header list.
  await typeHeader(fx.T);
  await listbox.getByRole("option", { name: /Advanced search…/ }).click();
  const footOpened = await seen(dialog, 5000);
  const footCarried = footOpened ? await dialog.getByLabel("All of these words").inputValue() : "";
  R(
    "Advanced search… at the foot of the header list opens the dialog",
    "The foot row opens Advanced search with the typed words",
    `Dialog opened ${footOpened}; words carried ${footCarried === fx.T}`,
    footOpened && footCarried === fx.T,
    "dialog",
  );

  // Words rows: 200 characters; or and a leading - are words.
  await dialog.getByLabel("None of these words").fill("z".repeat(201));
  const tooLong = await seen(preview.getByText("Search words rows must be 200 characters or fewer."), 5000);
  await dialog.getByLabel("None of these words").fill("");
  await dialog.getByLabel("All of these words").fill(`${fx.T} -${fx.X}`);
  const minusTotal = await previewTotal();
  const minusRows = onlyMine(await preview.getByRole("listitem").allInnerTexts());
  await dialog.getByLabel("All of these words").fill(`${fx.T} or ${fx.X}`);
  const orTotal = await previewTotal();
  const orRows = onlyMine(await preview.getByRole("listitem").allInnerTexts());
  R(
    "Words rows hold up to 200 characters; or and a leading - inside a row are not operators",
    "201 characters are refused in the Preview; 'T -X' and 'T or X' in All of these words both require T and X (only Charlie holds both)",
    `201 characters refused ${tooLong}; "T -X": ${minusTotal} (${minusRows.join(",")}); "T or X": ${orTotal} (${orRows.join(",")})`,
    tooLong &&
      minusTotal === "1 match" &&
      minusRows.join() === "Charlie" &&
      orTotal === "1 match" &&
      orRows.join() === "Charlie",
    "dialog",
  );

  // Search in.
  await dialog.getByLabel("All of these words").fill(fx.T);
  for (const l of ["Titles and numbers", "Record text", "Document contents"])
    await dialog.getByRole("checkbox", { name: l }).click();
  const noScope = await seen(preview.getByText("Choose at least one search scope."), 5000);
  const searchDisabled = await dialog.getByRole("button", { name: "Search", exact: true }).isDisabled();
  await dialog.getByRole("checkbox", { name: "Document contents" }).click();
  const contentsTotal = await previewTotal();
  const contentsRows = onlyMine(await preview.getByRole("listitem").allInnerTexts());
  await dialog.getByRole("checkbox", { name: "Titles and numbers" }).click();
  await dialog.getByRole("checkbox", { name: "Record text" }).click();
  R(
    "Search in: Document contents applies to Documents only; at least one scope with words",
    "No scope checked names the problem and disables Search; Document contents alone returns only the Document",
    `No scope message ${noScope}; Search disabled ${searchDisabled}; Document contents only: ${contentsTotal} (${contentsRows.join(",")})`,
    noScope && searchDisabled && contentsTotal === "1 match" && contentsRows.join() === "Echo",
    "dialog",
  );

  // Kinds, Add condition, property list, Fields.
  await kindChip("Contract").click();
  const helpSel = await txt(dialog.getByText("Only selected kinds are searched."));
  const addEnabled = !(await dialog.getByRole("button", { name: "Add condition" }).isDisabled());
  await kindChip("Matter").click();
  await dialog.getByRole("button", { name: "Add condition" }).click();
  const props = p.getByRole("dialog", { name: "Properties" });
  await props.waitFor();
  const propGroups = await props.getByRole("group").evaluateAll((gs) => gs.map((g) => g.getAttribute("aria-label")));
  const contractProps = await txt(props.getByRole("group", { name: "Contract" }));
  const fieldListed = contractProps.includes(fx.field.label) && contractProps.includes("Fields");
  await props.getByLabel("Search properties").fill("Expiry");
  const narrowed = await props.getByRole("button").allInnerTexts();
  await p.keyboard.press("Escape");
  R(
    "Kinds and Add condition: groups per selected kind, Search properties, live Fields",
    "Selecting a kind enables Add condition and says only selected kinds are searched; the list groups properties under Contract and Matter; the Contract group lists live Fields; Search properties narrows by label",
    `Help "${helpSel}"; Add condition enabled ${addEnabled}; groups ${propGroups.join(", ")}; Contract group lists the fixture Field under Fields ${fieldListed}; "Expiry" narrows to ${narrowed.map((s) => s.trim()).join(" | ")}`,
    helpSel === "Only selected kinds are searched." &&
      addEnabled &&
      propGroups.join() === "Contract,Matter" &&
      fieldListed &&
      narrowed.map((s) => s.trim()).join() === "Expiry date",
    "dialog",
  );

  // Relative date example with N validation.
  const expiry = await addCondition("Contract", "Expiry date");
  const ops = await expiry.getByLabel("Operator").locator("option").allInnerTexts();
  await expiry.getByLabel("Operator").selectOption({ label: "in the next N days" });
  await expiry.getByLabel("Number of days").fill("0");
  await sleep(600);
  const badN = await txt(preview.getByRole("alert"));
  await expiry.getByLabel("Number of days").fill("3651");
  await sleep(600);
  const badN2 = await txt(preview.getByRole("alert"));
  await expiry.getByLabel("Number of days").fill("90");
  const relTotal = await previewTotal();
  const relRows = onlyMine(await preview.getByRole("listitem").allInnerTexts());
  R(
    "Dates: operators, N from 1 to 3650 in Number of days, Contract Expiry date in the next 90 days",
    "Date operators include before, after, on, between and the relative set; an invalid N is named in the Preview; with Contract and Matter selected, 90 keeps Alpha (+30 days) and drops Charlie (+200) and Delta (no date), while the Matter Bravo stays because a Contract condition never limits Matters",
    `Operators: ${ops.join(", ")}; N=0 "${badN}"; N=3651 "${badN2}"; N=90 ${relTotal} (${relRows.join(",")})`,
    ["before", "after", "on", "between", "in the last N days", "in the next N days", "today", "this week", "this month", "this quarter", "this year"].every((o) => ops.includes(o)) &&
      badN.length > 0 &&
      badN2.length > 0 &&
      relTotal === "2 matches" &&
      relRows.sort().join() === "Alpha,Bravo",
    "dialog",
  );

  // Match all / Match any with a Matter condition too; then run.
  const status = await addCondition("Matter", "Status");
  const matterStatuses = sql(`select display_name from matter_statuses where category='open' order by 1 limit 1`);
  await chooseValues(status, "Status", [matterStatuses]);
  const allTotal = await previewTotal();
  await dialog.getByRole("group", { name: "Match conditions" }).getByRole("button", { name: "Match any" }).click();
  const anyTotal = await previewTotal();
  await dialog.getByRole("group", { name: "Match conditions" }).getByRole("button", { name: "Match all" }).click();
  await previewTotal();
  const bravoStatus = sql(
    `select s.display_name from matters m join matter_statuses s on s.id=m.status_id where m.number=${fx.bravo}`,
  );
  R(
    "Match all and Match any apply per kind; a Contract condition never limits Matters",
    "With a Contract Expiry condition and a Matter Status condition, Contracts are limited only by the Contract condition and the Matter only by the Matter condition",
    `Matter Status is any of ${matterStatuses} (Bravo is ${bravoStatus}): Match all ${allTotal}, Match any ${anyTotal}`,
    allTotal === (bravoStatus === matterStatuses ? "2 matches" : "1 match") && anyTotal === allTotal,
    "dialog",
  );
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await p.waitForURL(/aq=/);
  await sleep(2000);
  const q1 = decodeAq(p.url());
  const chipNames = await p
    .getByRole("button", { name: /^Edit / })
    .evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label")));
  const wordsChip = await p.getByRole("link", { name: `Remove All of these words: ${fx.T}` }).isVisible();
  const runRows = onlyMine(await rows());
  const runTotal = await totalText();
  R(
    "Search runs the question, closes the dialog, and shows chips that agree with the URL and rows",
    "The dialog closes; the address holds the question; a words chip and a chip per condition; the chip reads Contract Expiry date in the next 90 days",
    `URL question kinds ${q1?.kinds}, ${q1?.conditions.length} conditions; condition chips ${chipNames.join(" | ")}; words chip ${wordsChip}; total "${runTotal}", rows ${runRows.join(",")}`,
    q1?.conditions.length === 2 &&
      chipNames.includes("Edit Contract Expiry date in the next 90 days") &&
      wordsChip &&
      runRows.includes("Alpha") &&
      !runRows.includes("Charlie"),
    "/search",
  );

  // Advanced on the results page opens the whole question; chip edit focuses the row.
  await p.getByRole("button", { name: "Advanced", exact: true }).click();
  await dialog.waitFor();
  const wholeQ = (await dialog.getByRole("group", { name: "Contract Expiry date condition" }).isVisible()) &&
    (await dialog.getByLabel("All of these words").inputValue()) === fx.T;
  await closeDialog();
  await p.getByRole("button", { name: "Edit Contract Expiry date in the next 90 days" }).click();
  await dialog.waitFor();
  await sleep(500);
  const rowFocused = await dialog
    .getByRole("group", { name: "Contract Expiry date condition" })
    .evaluate((el) => el === document.activeElement);
  await closeDialog();
  R(
    "Advanced on the results page opens the whole question; a condition chip opens its row",
    "Advanced shows the words and conditions of the page's question; selecting a chip opens the dialog focused on that row",
    `Whole question in the dialog ${wholeQ}; chip edit focused the Contract Expiry date row ${rowFocused}`,
    wholeQ && rowFocused,
    "/search",
  );

  // Kind link keeps only its own conditions; All removes every condition.
  const withBoth = p.url();
  await kindNav.getByRole("link", { name: "Contract", exact: true }).click();
  await sleep(1500);
  const qC = decodeAq(p.url());
  await kindNav.getByRole("link", { name: "All", exact: true }).click();
  await sleep(1500);
  const qAll = decodeAq(p.url());
  R(
    "Results-page kinds: a kind keeps only its own conditions; All removes every condition",
    "Contract keeps the Contract condition and drops the Matter one; All clears kinds and conditions",
    `Contract link: kinds ${qC?.kinds}, conditions ${qC?.conditions.map((x) => `${x.kind}:${x.property}`)}; All: kinds [${qAll?.kinds ?? ""}], conditions ${qAll?.conditions.length ?? 0}`,
    qC?.kinds.join() === "contract" &&
      qC.conditions.length === 1 &&
      qC.conditions[0].kind === "contract" &&
      (qAll?.kinds.length ?? 0) === 0 &&
      (qAll?.conditions.length ?? 0) === 0,
    "/search",
  );

  // Remove a condition chip, reload, Back.
  await p.goto(withBoth);
  await sleep(2000);
  await p.getByRole("link", { name: "Remove Contract Expiry date in the next 90 days" }).click();
  await sleep(2000);
  const afterRemove = decodeAq(p.url());
  const removedRows = onlyMine(await rows());
  await p.reload();
  await sleep(2000);
  const reloadRows = onlyMine(await rows());
  await p.goBack();
  await sleep(2000);
  const backQ = decodeAq(p.url());
  const backChip = await p.getByRole("button", { name: "Edit Contract Expiry date in the next 90 days" }).isVisible();
  R(
    "A chip's remove control runs the question without it; the address keeps the question through reload and Back",
    "Removing the Expiry chip returns all three Contracts; reload keeps the rows; Back restores the condition and its chip",
    `After remove: ${afterRemove?.conditions.length} condition(s), rows ${removedRows.join(",")}; after reload rows ${reloadRows.join(",")}; Back: ${backQ?.conditions.length} conditions, chip visible ${backChip}`,
    afterRemove?.conditions.length === 1 &&
      ["Alpha", "Charlie", "Delta"].every((n) => removedRows.includes(n)) &&
      reloadRows.join() === removedRows.join() &&
      backQ?.conditions.length === 2 &&
      backChip,
    "/search",
  );

  // Removing a kind removes its conditions with a notice.
  await p.getByRole("button", { name: "Advanced", exact: true }).click();
  await dialog.waitFor();
  await kindChip("Matter").click();
  const kindNotice = await txt(dialog.getByRole("status").filter({ hasText: "were removed" }));
  const matterRowGone = !(await dialog.getByRole("group", { name: "Matter Status condition" }).isVisible());
  R(
    "Removing a kind removes its conditions, and the dialog says so",
    "Deselecting Matter removes the Matter Status condition with Conditions for Matter were removed.",
    `Notice "${kindNotice}"; Matter row gone ${matterRowGone}`,
    kindNotice === "Conditions for Matter were removed." && matterRowGone,
    "dialog",
  );

  // Preview limit, Clear, 20 conditions.
  await clearDialog();
  const cleared =
    (await dialog.getByLabel("All of these words").inputValue()) === "" &&
    (await seen(preview.getByText("Build your search"), 3000));
  await kindChip("Contract").click();
  const n0 = await previewTotal();
  const previewRows = await preview.getByRole("listitem").count();
  const limitLine = await txt(preview.getByText(/^Showing the first/));
  const help = await preview.getByText("Preview updates as you change the question.").isVisible();
  for (let i = 0; i < 20; i++) {
    await dialog.getByRole("button", { name: "Add condition" }).click();
    const pl = p.getByRole("dialog", { name: "Properties" });
    await pl.getByLabel("Search properties").fill("Title");
    await pl.getByRole("button", { name: "Title", exact: true }).click();
  }
  await dialog.getByRole("button", { name: "Add condition" }).click();
  const limit20 = await seen(dialog.getByText("A search can have at most 20 conditions."), 5000);
  const count20 = await dialog.getByRole("group", { name: "Contract Title condition" }).count();
  if (!(await dialog.isVisible())) await openDialogFromHeader();
  await clearDialog();
  R(
    "Preview shows the exact total and up to ten rows; Clear empties the question; up to 20 conditions",
    "Clear leaves empty words and Build your search; Contract alone previews ten rows with Showing the first 10 of N; a 21st condition is refused",
    `Cleared ${cleared}; Contract: ${n0}, ${previewRows} rows, "${limitLine}", help line ${help}; 20 rows added ${count20}, 21st refused ${limit20}`,
    cleared && previewRows === 10 && limitLine === `Showing the first 10 of ${n0}` && help && count20 === 20 && limit20,
    "dialog",
  );

  // Show flags (seed Contracts and Matters; ground truth from the lab database at the same moment).
  const visibleContracts = (extra) =>
    Number(
      sql(
        `select count(*) from contracts c join contract_statuses s on s.id=c.status_id where not c.is_confidential ${extra}`,
      ),
    );
  if (!(await dialog.isVisible())) await openDialogFromHeader();
  await kindChip("Contract").click();
  // Other agents write to this lab at the same time, so each Preview total is compared with the
  // database count read just before and just after it.
  const n = (t) => Number(String(t).split(" ")[0]);
  const measure = async (dbFn) => {
    const before = dbFn();
    const ui = await previewTotal();
    const after = dbFn();
    return { ui, db: before === after ? `${before}` : `${before}..${after}`, ok: n(ui) === before || n(ui) === after };
  };
  const dbAll = () => visibleContracts("and c.archived_at is null");
  const dbNotEndedFn = () => visibleContracts("and c.archived_at is null and c.ended_at is null and s.stage <> 'ended'");
  const dbDraftFn = () => visibleContracts("and c.archived_at is null and s.display_name='Draft'");
  const dbArchFn = () => visibleContracts("");
  const dbMattersFn = () => Number(sql(`select count(*) from matters where not is_confidential and archived_at is null`));
  const dbOpenFn = () =>
    Number(
      sql(
        `select count(*) from matters m join matter_statuses s on s.id=m.status_id where not m.is_confidential and m.archived_at is null and s.category='open'`,
      ),
    );
  const base = await measure(dbAll);
  const ended = await addCondition("Contract", "Show ended");
  const endedYes = await measure(dbAll);
  await ended.getByLabel("Value").selectOption({ label: "No" });
  const endedNo = await measure(dbNotEndedFn);
  await ended.getByLabel("Value").selectOption({ label: "Yes" });
  const st = await addCondition("Contract", "Status");
  await chooseValues(st, "Status", ["Draft"]);
  const allFlag = await measure(dbDraftFn);
  await dialog.getByRole("group", { name: "Match conditions" }).getByRole("button", { name: "Match any" }).click();
  const anyFlag = await measure(dbAll);
  await dialog.getByRole("group", { name: "Match conditions" }).getByRole("button", { name: "Match all" }).click();
  await clearDialog();
  await kindChip("Contract").click();
  await addCondition("Contract", "Show archived");
  const archYes = await measure(dbArchFn);
  await clearDialog();
  await kindChip("Matter").click();
  const mBase = await measure(dbMattersFn);
  const closed = await addCondition("Matter", "Show closed");
  await closed.getByLabel("Value").selectOption({ label: "No" });
  const closedNo = await measure(dbOpenFn);
  const m = (label, x) => `${label} ${x.ui} (db ${x.db})`;
  R(
    "Show ended, Show closed and Show archived; Match any with a Show condition",
    "Contracts include ended by default (Show ended Yes = default); Show ended No leaves ended out; Show archived Yes adds archived; Match all Status Draft + Show ended Yes = Draft only; Match any = every reachable Contract of the kind; Show closed No = open Matters",
    [
      m("Contract default", base),
      m("Show ended Yes", endedYes),
      m("Show ended No (db not ended)", endedNo),
      m("Status Draft + Show ended Yes, Match all (db Draft)", allFlag),
      m("Match any (db every non-archived)", anyFlag),
      m("Show archived Yes (db incl. archived)", archYes),
      m("Matters default", mBase),
      m("Show closed No (db open)", closedNo),
    ].join("; "),
    [base, endedYes, endedNo, allFlag, anyFlag, archYes, mBase, closedNo].every((x) => x.ok) &&
      n(endedNo.ui) < n(base.ui) &&
      n(allFlag.ui) < n(anyFlag.ui) &&
      n(archYes.ui) > n(base.ui) &&
      n(closedNo.ui) < n(mBase.ui),
    "dialog",
  );
  await clearDialog();

  // No records match this question.
  await kindChip("Contract").click();
  const title = await addCondition("Contract", "Title");
  await title.getByLabel("Value").fill(`zz${fx.T}qx`);
  await previewTotal();
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await p.waitForURL(/aq=/);
  const noRecords = await seen(p.getByText("No records match this question."), 15000);
  await p.goto(`${BASE}/search?q=zz${fx.T}qx`);
  const noMatches = await seen(p.getByText("No matches", { exact: true }), 15000);
  R(
    "Recover from an empty answer: No records match this question. and No matches",
    "A conditions-only question with no match says No records match this question.; an unmatched word says No matches",
    `Conditions-only empty answer ${noRecords}; words-only empty answer No matches ${noMatches}`,
    noRecords && noMatches,
    "/search",
  );

  // ===== Sort search results =====
  await p.goto(`${BASE}/search?q=${fx.T}`);
  await p.locator("main li").first().waitFor();
  const orders = {};
  for (const [label, key] of [
    ["Newest", "newest"],
    ["Oldest", "oldest"],
    ["Expiry soonest", "expiry"],
    ["Title", "title"],
    ["Relevance", "relevance"],
  ]) {
    await sortBtn.click();
    await p.getByRole("menuitemradio", { name: label, exact: true }).click();
    await p.waitForURL((u) => (decodeAq(u.toString())?.sort ?? "relevance") === key);
    await sleep(1500);
    orders[key] = { rows: onlyMine(await rows()), control: await sortBtn.getAttribute("aria-label") };
  }
  await sortBtn.click();
  await p.getByRole("menuitemradio", { name: "Oldest", exact: true }).click();
  await sleep(1500);
  await p.reload();
  await sleep(2000);
  const reloadSort = await sortBtn.getAttribute("aria-label");
  const exp = orders.expiry.rows;
  R(
    "Sort search results: Relevance, Newest, Oldest, Expiry soonest, Title; the address keeps the sort",
    "Newest: Echo (latest Version upload), Delta, Bravo, Alpha, Charlie; Oldest the reverse; Expiry soonest: Alpha, Charlie, then Delta (no expiry), then other kinds; Title A to Z: Alpha, Bravo, Charlie, Delta, Echo; reload keeps Oldest",
    Object.entries(orders)
      .map(([k, v]) => `${k}: ${v.rows.join(",")} (${v.control})`)
      .join("; ") + `; after reload "${reloadSort}"`,
    orders.newest.rows.join() === "Echo,Delta,Bravo,Alpha,Charlie" &&
      orders.oldest.rows.join() === "Charlie,Alpha,Bravo,Delta,Echo" &&
      exp.slice(0, 3).join() === "Alpha,Charlie,Delta" &&
      exp.slice(3).sort().join() === "Bravo,Echo" &&
      orders.title.rows.join() === "Alpha,Bravo,Charlie,Delta,Echo" &&
      orders.relevance.control === "Sort: Relevance" &&
      reloadSort === "Sort: Oldest",
    "/search",
  );

  // ===== Save and reopen a search =====
  const savedName = `${fx.prefix} Renewals due ${role === "administrator" ? "A" : "M"}`;
  await p.getByRole("button", { name: "Advanced", exact: true }).click();
  await dialog.waitFor();
  await kindChip("Contract").click();
  await previewTotal();
  await dialog.getByRole("button", { name: "Save search", exact: true }).click();
  const saveDlg = p.getByRole("dialog", { name: "Save this search" });
  const saveTitled = await seen(saveDlg, 5000);
  await saveDlg.getByLabel("Name").fill(savedName);
  await saveDlg.getByRole("button", { name: "Save", exact: true }).click();
  await saveDlg.waitFor({ state: "detached" });
  const activeLabel = await dialog.getByRole("button", { name: `${savedName} actions` }).isVisible();
  // Duplicate name, different case.
  await dialog.getByRole("button", { name: `${savedName} actions` }).click();
  await p.getByRole("menuitem", { name: "Save as…" }).click();
  await saveDlg.getByLabel("Name").fill(savedName.toUpperCase());
  await saveDlg.getByRole("button", { name: "Save", exact: true }).click();
  const dupMsg = await txt(saveDlg.getByRole("alert"));
  await saveDlg.getByRole("button", { name: "Cancel" }).click();
  const stored = (await p.request.get(`${BASE}/api/v1/list-views?surface=search`, H).then((r) => r.json())).views;
  const mine = stored.find((v) => v.name === savedName);
  R(
    "Save and reopen a search, steps 1-2: Save search, Save this search, Name, Save; a duplicate name is refused",
    "Save this search stores the question with its kinds and sort; the control then names the search; the same name in other letter case is refused",
    `Dialog "Save this search" ${saveTitled}; control shows "${savedName} actions" ${activeLabel}; stored kinds ${mine?.layout?.kinds ?? mine?.config?.kinds}, sort ${mine?.layout?.sort ?? mine?.config?.sort}, words ${JSON.stringify(mine?.config?.words?.all === fx.T)}; duplicate "${dupMsg}"; stored searches with that name ${stored.filter((v) => v.name.toLowerCase() === savedName.toLowerCase()).length}`,
    saveTitled &&
      activeLabel &&
      (mine?.config)?.sort === "oldest" &&
      dupMsg === "You already have a view with that name on this list." &&
      stored.filter((v) => v.name.toLowerCase() === savedName.toLowerCase()).length === 1,
    "dialog",
  );
  await closeDialog();

  // Step 3: empty header box, Saved group, runs at once.
  await p.goto(`${BASE}/`);
  await sleep(1500);
  await header.click();
  await listbox.waitFor();
  await sleep(1500);
  const savedGroup = await listbox.getByRole("group", { name: "Saved" }).getByRole("option").allInnerTexts();
  const recentGroup = await listbox.getByRole("group", { name: "Recent" }).getByRole("option").count();
  const seeAllDisabled = await listbox.getByRole("option", { name: /See all results/ }).getAttribute("aria-disabled");
  await listbox.getByRole("group", { name: "Saved" }).getByRole("option", { name: savedName }).click();
  await p.waitForURL(/aq=/);
  await sleep(2000);
  const reopenRows = onlyMine(await rows());
  const reopenSort = await sortBtn.getAttribute("aria-label");
  R(
    "Save and reopen a search, step 3: the empty header box Saved group runs the search at once",
    "Focusing the empty box lists Saved and Recent; See all results is unavailable; selecting the saved search opens the results page with its kinds and sort",
    `Saved entries ${savedGroup.map((s) => s.trim()).filter((s) => s.startsWith(fx.prefix)).join(" | ")}; Recent entries ${recentGroup}; See all results aria-disabled ${seeAllDisabled}; opened ${pathOf(p)} rows ${reopenRows.join(",")} "${reopenSort}"`,
    savedGroup.some((s) => s.includes(savedName)) &&
      recentGroup > 0 &&
      recentGroup <= 5 &&
      seeAllDisabled === "true" &&
      reopenRows.join() === "Charlie,Alpha,Delta" &&
      reopenSort === "Sort: Oldest",
    "/",
  );

  // Step 4: select under Saved searches loads without running; Search runs it.
  await p.goto(`${BASE}/`);
  await sleep(1500);
  await openDialogFromHeader();
  const savedList = dialog.getByRole("region", { name: "Saved searches" });
  await savedList.getByRole("button", { name: savedName, exact: true }).click();
  await sleep(1500);
  const loadedWords = await dialog.getByLabel("All of these words").inputValue();
  const loadedKind = await kindChip("Contract").getAttribute("aria-pressed");
  const stillHome = new URL(p.url()).pathname === "/";
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await p.waitForURL(/aq=/);
  await sleep(1500);
  const ranRows = onlyMine(await rows());
  R(
    "Save and reopen a search, step 4: Saved searches loads the question without running; Search runs it",
    "The dialog shows the stored words and kind while the page stays put; Search opens the results",
    `Loaded words match ${loadedWords === fx.T}; Contract pressed ${loadedKind}; page stayed at / ${stillHome}; after Search ${pathOf(p)} rows ${ranRows.join(",")}`,
    loadedWords === fx.T && loadedKind === "true" && stillHome && ranRows.join() === "Charlie,Alpha,Delta",
    "dialog",
  );

  // Modified, Save replaces, menu items, Discard.
  await openDialogFromHeader();
  await savedList.getByRole("button", { name: savedName, exact: true }).click();
  await sleep(1200);
  const actions = dialog.getByRole("button", { name: `${savedName} actions` });
  const before = await txt(actions);
  await kindChip("Matter").click();
  await sleep(500);
  const modifiedLabel = await txt(actions);
  const saveEnabled = !(await dialog.getByRole("button", { name: "Save search", exact: true }).isDisabled());
  await actions.click();
  const menuItems = (await p.getByRole("menuitem").allInnerTexts()).map((s) => s.trim());
  await p.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "Save search", exact: true }).click();
  await sleep(1500);
  const afterSave = await txt(actions);
  const stored2 = (await p.request.get(`${BASE}/api/v1/list-views?surface=search`, H).then((r) => r.json())).views.find(
    (v) => v.name === savedName,
  );
  await kindChip("Document").click();
  await sleep(400);
  await actions.click();
  await p.getByRole("menuitem", { name: "Discard unsaved changes" }).click();
  await sleep(1200);
  const discarded =
    (await kindChip("Document").getAttribute("aria-pressed")) === "false" && !(await txt(actions)).includes("Modified");
  R(
    "Changing a selected saved search marks it Modified; Save search replaces it; the menu offers Save as…, Rename…, Delete…, Discard unsaved changes",
    "Adding a kind shows Modified beside Save search; Save search stores it and clears Modified; Discard unsaved changes restores the stored question",
    `Before "${before}"; after change "${modifiedLabel}", Save search enabled ${saveEnabled}; menu ${menuItems.join(" | ")}; after Save "${afterSave}", stored kinds ${(stored2?.config)?.kinds}; Discard restored ${discarded}`,
    !before.includes("Modified") &&
      modifiedLabel.includes("Modified") &&
      saveEnabled &&
      ["Save", "Save as…", "Rename…", "Delete…", "Discard unsaved changes"].every((i) => menuItems.includes(i)) &&
      !afterSave.includes("Modified") &&
      (stored2?.config)?.kinds.join() === "contract,matter" &&
      discarded,
    "dialog",
  );
  await closeDialog();

  // The dialog forgets the selection on close: Save search then saves a new search.
  await openDialogFromHeader();
  await kindChip("Entity").click();
  await dialog.getByRole("button", { name: "Save search", exact: true }).click();
  const asksName = await seen(p.getByRole("dialog", { name: "Save this search" }), 5000);
  await p.getByRole("dialog", { name: "Save this search" }).getByRole("button", { name: "Cancel" }).click();
  const noActive = !(await dialog.getByRole("button", { name: `${savedName} actions` }).isVisible());
  R(
    "The dialog forgets the selected saved search when it closes",
    "After closing and reopening, Save search asks for a new Name instead of replacing",
    `Save this search dialog opened ${asksName}; no active saved search control ${noActive}`,
    asksName && noActive,
    "dialog",
  );

  // Recent searches in the dialog restore a question; Search runs it.
  const recents = dialog.getByRole("region", { name: "Recent searches" }).getByRole("button");
  const recentCount = await recents.count();
  const firstRecent = (await recents.first().innerText()).trim();
  const urlBeforeRecent = p.url();
  await recents.first().click();
  await sleep(1200);
  const restoredWords = await dialog.getByLabel("All of these words").inputValue();
  const stayed = p.url() === urlBeforeRecent;
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await p.waitForURL(/\/search/);
  R(
    "Recent searches lists at most five questions; selecting one restores it; Search runs it",
    "Up to five Recent searches; selecting restores the question without running; Search opens the results",
    `${recentCount} recent entries; first "${firstRecent.slice(0, 80)}"; restored words "${restoredWords.slice(0, 40)}"; page stayed ${stayed}; after Search ${pathOf(p)}`,
    recentCount > 0 && recentCount <= 5 && stayed && /\/search/.test(p.url()),
    "dialog",
  );

  // Another device: the saved search follows the account; recent is browser-only.
  const other = await signIn(acct.email, acct.password);
  const oh = other.page.getByRole("combobox", { name: "Search" });
  await oh.click();
  const olist = other.page.getByRole("listbox", { name: "Search results" });
  await olist.waitFor();
  await sleep(1500);
  const otherSaved = (await olist.getByRole("group", { name: "Saved" }).getByRole("option").allInnerTexts()).some((s) =>
    s.includes(savedName),
  );
  const otherRecent = await olist.getByRole("group", { name: "Recent" }).count();
  await other.context.close();
  R(
    "A saved search follows the account to another device; Recent lives in this browser only",
    "A second browser lists the saved search under Saved and has no Recent group",
    `Second browser Saved lists it ${otherSaved}; Recent groups ${otherRecent}`,
    otherSaved && otherRecent === 0,
    "/",
  );

  // Recent entry from the empty header box runs at once; sign-out clears Recent.
  await p.goto(`${BASE}/`);
  await sleep(1200);
  await header.click();
  await listbox.waitFor();
  await sleep(1000);
  await listbox.getByRole("group", { name: "Recent" }).getByRole("option").first().click();
  await p.waitForURL(/\/search\?/);
  const recentRan = /\/search\?/.test(p.url());
  // No default: /search alone opens the prompt, not a saved search.
  await p.goto(`${BASE}/search`);
  await sleep(1500);
  const promptShown = await seen(
    p.getByText("Search contracts, matters, documents, entities, counterparties, and requests").first(),
    5000,
  );
  const noRowsNoDefault = (await p.locator("main li").count()) === 0;
  await p.getByRole("button", { name: acct.displayName }).click();
  await p.getByRole("menuitem", { name: "Sign out" }).click();
  await p.waitForURL(/\/auth\/login/);
  await p.getByLabel("Email").fill(acct.email);
  await p.getByLabel("Password").fill(acct.password);
  await p.getByRole("button", { name: "Sign in", exact: true }).click();
  await p.waitForURL((u) => !u.pathname.startsWith("/auth"));
  await sleep(1500);
  await header.click();
  await listbox.waitFor().catch(() => {});
  await sleep(1200);
  const recentAfterSignOut = await listbox.getByRole("group", { name: "Recent" }).count();
  R(
    "Recent entry runs at once; a saved search has no default; signing out clears Recent",
    "Selecting a Recent entry in the empty header box opens results; /search opens the empty prompt; after sign-out and sign-in the Recent group is gone",
    `Recent entry opened results ${recentRan}; /search prompt ${promptShown} with no rows ${noRowsNoDefault}; Recent groups after sign-out ${recentAfterSignOut}`,
    recentRan && promptShown && noRowsNoDefault && recentAfterSignOut === 0,
    "/",
  );
  await p.keyboard.press("Escape");

  // Row menu Rename… and Delete….
  await openDialogFromHeader();
  await savedList.getByRole("button", { name: `Manage ${savedName}` }).click();
  const rowItems = (await p.getByRole("menuitem").allInnerTexts()).map((s) => s.trim());
  await p.getByRole("menuitem", { name: "Rename…" }).click();
  const renameDlg = p.getByRole("dialog", { name: "Rename this saved search" });
  const renameTitled = await seen(renameDlg, 5000);
  await renameDlg.getByLabel("Name").fill(`${savedName} 2`);
  await renameDlg.getByRole("button", { name: "Rename" }).click();
  await renameDlg.waitFor({ state: "detached" });
  const renamed = await savedList.getByRole("button", { name: `${savedName} 2`, exact: true }).isVisible();
  await savedList.getByRole("button", { name: `Manage ${savedName} 2` }).click();
  await p.getByRole("menuitem", { name: "Delete…" }).click();
  const delDlg = p.getByRole("dialog", { name: "Delete this saved search?" });
  const delText = await txt(delDlg);
  const contractsBefore = sql(`select count(*) from contracts where title like '${fx.prefix}%'`);
  await delDlg.getByRole("button", { name: "Delete" }).click();
  await delDlg.waitFor({ state: "detached" });
  await sleep(800);
  const gone = !(await savedList.getByRole("button", { name: `${savedName} 2`, exact: true }).isVisible());
  const contractsAfter = sql(`select count(*) from contracts where title like '${fx.prefix}%'`);
  R(
    "A row's menu in Saved searches offers Rename… and Delete…; Delete removes the saved search, not records",
    "Rename this saved search renames it; Delete this saved search? says records are not touched; the search disappears and the Contracts remain",
    `Row menu ${rowItems.join(" | ")}; rename dialog ${renameTitled}, renamed ${renamed}; delete dialog "${delText.slice(0, 140)}"; gone ${gone}; fixture Contracts ${contractsBefore} -> ${contractsAfter}`,
    rowItems.join() === "Rename…,Delete…" &&
      renameTitled &&
      renamed &&
      delText.includes("The records it finds are not touched.") &&
      gone &&
      contractsBefore === contractsAfter,
    "dialog",
  );
  await closeDialog();

  // A saved search with a Field condition: open error when the Field catalog cannot load.
  const fieldSearch = `${fx.prefix} field ${role === "administrator" ? "A" : "M"}`;
  await openDialogFromHeader();
  await kindChip("Contract").click();
  const fRow = await addCondition("Contract", fx.field.label);
  await fRow.getByLabel("Value").fill("ref");
  await previewTotal();
  await dialog.getByRole("button", { name: "Save search", exact: true }).click();
  await saveDlg.getByLabel("Name").fill(fieldSearch);
  await saveDlg.getByRole("button", { name: "Save", exact: true }).click();
  await saveDlg.waitFor({ state: "detached" });
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await p.waitForURL(/aq=/);
  fx.fieldUrls ??= {};
  fx.fieldUrls[role] = p.url();
  await p.goto(`${BASE}/`);
  await sleep(1000);
  await openDialogFromHeader();
  await p.route("**/api/v1/search/fields**", (r) => r.abort());
  await savedList.getByRole("button", { name: fieldSearch, exact: true }).click();
  const openErr = await seen(dialog.getByText("This search could not open. Try again."), 8000);
  await p.unroute("**/api/v1/search/fields**");
  await savedList.getByRole("button", { name: fieldSearch, exact: true }).click();
  await sleep(1500);
  const retried = await dialog.getByRole("group", { name: `Contract ${fx.field.label} condition` }).isVisible();
  await closeDialog();
  R(
    "If a saved search does not load in the dialog, the dialog says so",
    "With the Field catalog blocked, selecting a saved search holding a Field condition shows This search could not open. Try again.; a retry after recovery loads it",
    `Error shown ${openErr}; retry loaded the Field condition ${retried}`,
    openErr && retried,
    "dialog",
  );

  // Failed reads.
  await p.goto(`${BASE}/search?q=helix`);
  await p.getByRole("button", { name: "Show more" }).waitFor({ timeout: 15000 });
  const fp = (await rows()).length;
  await p.route("**/api/v1/search/query**", (route) =>
    (route.request().postData() ?? "").includes('"cursor"') ? route.abort() : route.continue(),
  );
  await p.getByRole("button", { name: "Show more" }).click();
  const nextErr = await seen(p.getByText("The next results could not be read. Try again."), 10000);
  const kept = (await rows()).length;
  await p.unroute("**/api/v1/search/query**");
  await p.getByRole("button", { name: "Show more" }).click();
  await sleep(2500);
  const grown = (await rows()).length;
  await p.route("**/api/v1/search**", (route) => route.abort());
  await header.fill(`${fx.T}x`);
  const headerErr = await seen(listbox.getByText("Search could not load"), 10000);
  await header.fill("");
  await p.goto(`${BASE}/search?q=${fx.T}`);
  const pageErr = await seen(p.getByText("Search could not load. Try again."), 15000);
  await p.unroute("**/api/v1/search**");
  await p.goto(`${BASE}/search?q=${fx.T}`);
  const recovered = await seen(p.locator("main li"), 15000);
  R(
    "Failed reads are not empty answers",
    "A blocked next page keeps the rows with The next results could not be read. Try again. and Show more retries; a blocked search shows Search could not load in the header and Search could not load. Try again. on the page; a retry after recovery works",
    `First page ${fp}; next-page error ${nextErr} with ${kept} rows kept; retry grew to ${grown}; header error ${headerErr}; page error ${pageErr}; recovered ${recovered}`,
    nextErr && kept === fp && grown > fp && headerErr && pageErr && recovered,
    "/search",
  );

  // Reach: the Confidential Contract never appears.
  await p.goto(`${BASE}/contracts/${fx.hidden}`);
  const directHidden = await seen(p.getByText("Contract not found"), 15000);
  const isHidden = (x) => x.kind === "contract" && x.number === fx.hidden;
  const apiHidden = (
    await p.request.get(`${BASE}/api/v1/search?q=${fx.T}&kind=contract`, H).then((r) => r.json())
  ).results.some(isHidden);
  const qHidden = (
    await p.request
      .post(`${BASE}/api/v1/search/query`, {
        ...H,
        data: {
          version: 1,
          words: { all: fx.T, phrase: "", any: "", none: "" },
          scope: { titles: true, text: true, contents: true },
          kinds: [],
          conditions: [],
          match: "all",
          sort: "relevance",
          limit: 25,
        },
      })
      .then((r) => r.json())
  ).results.some(isHidden);
  R(
    "Search shows only records you can reach",
    "The Confidential Contract (reachable by its creator) is absent from header search, questions and a direct link",
    `Daniel reaches it ${fx.danielSeesHidden}; walker direct link Contract not found ${directHidden}; header API includes it ${apiHidden}; question API includes it ${qHidden}`,
    fx.danielSeesHidden && directHidden && !apiHidden && !qHidden,
    "/contracts",
  );

  // Product check: header list vs results page parsing of "or" and a leading "-".
  await p.goto(`${BASE}/`);
  await sleep(1000);
  await typeHeader(`${fx.T} -${fx.X}`);
  const hMinus = (await headerGroups()).flatMap((g) => g.options.map(nameOf));
  await listbox.getByRole("option", { name: /See all results/ }).click();
  await p.waitForURL(/\/search\?q=/);
  await sleep(2000);
  const pMinus = onlyMine(await rows());
  await p.goto(`${BASE}/`);
  await sleep(1000);
  await typeHeader(`${fx.T} or ${fx.X}`);
  const hOr = (await headerGroups()).flatMap((g) => g.options.map(nameOf));
  await listbox.getByRole("option", { name: /See all results/ }).click();
  await p.waitForURL(/\/search\?q=/);
  await sleep(2000);
  const pOr = onlyMine(await rows());
  const consistent = hMinus.sort().join() === pMinus.sort().join() && hOr.sort().join() === pOr.sort().join();
  record(
    role,
    "Product check (not a guide step): header list and results page read the same words the same way",
    "The same text gives the same records in the header list and on See all results",
    `"T -X": header ${hMinus.join(",")}; results page ${pMinus.join(",")}. "T or X": header ${hOr.join(",")}; results page ${pOr.join(",")}. Consistent ${consistent}`,
    true,
    "/search",
  );
  if (!consistent)
    productBugs.push({
      role,
      summary:
        "The header list treats `or` and a leading `-` as operators; See all results turns the same text into All of these words, where they are plain words.",
      reproduction: `Type "<word> -<other>" in the header search box: the list shows ${hMinus.join(", ")}. Select See all results: the page shows ${pMinus.join(", ")}. Type "<word> or <other>": header ${hOr.join(", ")}, page ${pOr.join(", ")}.`,
      source:
        "apps/api/src/modules/search/service.ts: groupedSearch passes q to websearch_to_tsquery; querySearch quotes each word via terms().",
    });

  // ===== Filter and sort a list =====
  await p.goto(`${BASE}/`);
  await p.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Contracts" }).click();
  await p.waitForURL(/\/contracts/);
  await p.getByRole("button", { name: /^Filter/ }).waitFor();
  await sleep(2000);
  const countText = async () => txt(p.getByRole("region", { name: "Contracts" }).getByRole("paragraph").first());
  const filterPop = p.getByRole("dialog", { name: "Filter" });
  const addFilter = async (prop, value) => {
    await p.getByRole("button", { name: /^Filter/ }).click();
    await filterPop.getByRole("button", { name: prop, exact: true }).click();
    const any = await filterPop.getByText("Matches any selected value").isVisible().catch(() => false);
    await filterPop.getByRole("checkbox", { name: value, exact: true }).click();
    await filterPop.getByRole("button", { name: "Apply" }).click();
    await sleep(2500);
    return any;
  };
  const allCount = await countText();
  const anyHint = await addFilter("Owner", "Daniel Okafor");
  const chip = await p.getByRole("button", { name: "Owner: Daniel Okafor" }).isVisible();
  const nums = await p
    .locator("main tbody tr")
    .evaluateAll((rs) => rs.map((r) => (r.innerText.match(/C-(\d+)/) ?? [])[1]).filter(Boolean));
  const owners = nums.slice(0, 25).map((x) => sql(`select manager_id from contracts where number=${x}`));
  const allDaniel = owners.length > 0 && owners.every((o) => o === fx.danielId);
  const ownerCount = await countText();
  await addFilter("Status", "Draft");
  const twoChips = (await p.getByRole("button", { name: /^Remove .* filter$/ }).count()) === 2;
  const bothCount = await countText();
  const titleHeader = p.getByRole("columnheader", { name: "Title" });
  await p.getByRole("button", { name: "Title", exact: true }).click();
  await p.waitForURL(/dir=asc/);
  const s1 = await titleHeader.getAttribute("aria-sort");
  await p.getByRole("button", { name: "Title", exact: true }).click();
  await p.waitForURL(/dir=desc/);
  const s2 = await titleHeader.getAttribute("aria-sort");
  await p.goBack();
  await p.waitForURL(/dir=asc/);
  await sleep(1500);
  const backSort = await titleHeader.getAttribute("aria-sort");
  await p.goBack();
  await p.waitForURL((u) => !u.search.includes("sort="));
  await sleep(1500);
  const back2Sort = await titleHeader.getAttribute("aria-sort");
  const back2Chips = await p.getByRole("button", { name: /^Remove .* filter$/ }).count();
  await p.goBack();
  await sleep(1500);
  const back3Chips = await p.getByRole("button", { name: /^Remove .* filter$/ }).count();
  await p.goForward();
  await sleep(1500);
  const fwdChips = await p.getByRole("button", { name: /^Remove .* filter$/ }).count();
  await p.goForward();
  await p.waitForURL(/dir=asc/);
  await sleep(1500);
  const fwdSort = await titleHeader.getAttribute("aria-sort");
  await p.getByRole("button", { name: "Remove Status filter" }).click();
  await sleep(2000);
  const afterRemoveF = await p.getByRole("button", { name: /^Remove .* filter$/ }).count();
  await p.getByRole("button", { name: "Clear all" }).click();
  await sleep(2000);
  const afterClear = await p.getByRole("button", { name: /^Remove .* filter$/ }).count();
  // A date filter says it includes both dates.
  await p.getByRole("button", { name: /^Filter/ }).click();
  await filterPop.getByLabel("Search filters").fill("date");
  const dateProp = (await filterPop.getByRole("button").allInnerTexts()).map((s) => s.trim()).find((s) => /date/i.test(s));
  await filterPop.getByRole("button", { name: dateProp, exact: true }).click();
  const inclusive = await filterPop.getByText("Includes both dates").isVisible();
  await p.keyboard.press("Escape");
  R(
    "Filter and sort a list, steps 1-6, with Back and Forward",
    "Owner with Apply shows a chip and matching rows; another filter narrows; the Title heading cycles; Back and Forward restore chips and sort; remove and Clear all clear filters; date filters include both dates",
    `Count ${allCount} -> Owner ${ownerCount} -> Owner+Status ${bothCount}; chip ${chip}; Matches any selected value ${anyHint}; first-page rows owned by Daniel ${allDaniel} (${owners.length}); two chips ${twoChips}; Title ${s1} -> ${s2}; Back -> ${backSort}, Back -> ${back2Sort} with ${back2Chips} chips, Back -> ${back3Chips} chips; Forward -> ${fwdChips} chips, Forward -> ${fwdSort}; remove Status leaves ${afterRemoveF}; Clear all leaves ${afterClear}; ${dateProp} says Includes both dates ${inclusive}`,
    chip &&
      anyHint &&
      allDaniel &&
      twoChips &&
      s1 === "ascending" &&
      s2 === "descending" &&
      backSort === "ascending" &&
      back2Sort === null &&
      back2Chips === 2 &&
      back3Chips === 1 &&
      fwdChips === 2 &&
      fwdSort === "ascending" &&
      afterRemoveF === 1 &&
      afterClear === 0 &&
      ownerCount !== allCount &&
      bothCount !== ownerCount &&
      inclusive,
    "/contracts",
  );
  await addFilter("Owner", "Me");
  const emptyState = await seen(p.getByText("No contracts match these filters"), 10000);
  await p.getByRole("button", { name: "Clear all" }).click();
  await sleep(2000);
  const rowsBack = await p.locator("main tbody tr").count();
  R(
    "No contracts match these filters",
    "An empty filter answer shows the message; removing filters restores rows",
    `Owner Me empty message ${emptyState}; rows after Clear all ${rowsBack}`,
    emptyState && rowsBack > 0,
    "/contracts",
  );

  // ===== Save a view =====
  const viewName = `${fx.prefix} Daniel portfolio ${role === "administrator" ? "A" : "M"}`;
  const headers = async () =>
    p.locator("main th").evaluateAll((els) => els.map((e) => e.innerText.trim()).filter(Boolean));
  const sortIs = async (want) => {
    for (let i = 0; i < 40; i++) {
      if ((await titleHeader.getAttribute("aria-sort")) === want) return true;
      await sleep(250);
    }
    return false;
  };
  // The list keeps the earlier sort, so select the heading until it shows the wanted state.
  const sortTo = async (want) => {
    for (let i = 0; i < 3; i++) {
      if ((await titleHeader.getAttribute("aria-sort")) === want) return true;
      await p.getByRole("button", { name: "Title", exact: true }).click();
      if (await sortIs(want)) return true;
      await sleep(500);
    }
    return false;
  };
  await addFilter("Owner", "Daniel Okafor");
  await sortTo("ascending");
  await p.getByRole("button", { name: "Columns" }).click();
  await p.getByRole("button", { name: "Move Counterparty later" }).click({ timeout: 10000 });
  await p.keyboard.press("Escape");
  await sleep(800);
  const movedHeaders = await headers();
  const viewsBtn = p.getByRole("region", { name: "Contracts" }).getByRole("button").first();
  const viewsLabel0 = await txt(viewsBtn);
  await viewsBtn.click();
  await p.getByRole("menuitem", { name: "Save as…" }).click();
  await p.getByRole("dialog", { name: "Save this view" }).getByLabel("Name").fill(viewName);
  await p.getByRole("dialog", { name: "Save this view" }).getByRole("button", { name: "Save" }).click();
  await sleep(2500);
  const savedLabel = await txt(viewsBtn);
  await addFilter("Status", "Draft");
  const modified = (await txt(viewsBtn)).includes("Modified");
  await viewsBtn.click();
  await p.getByRole("menuitem", { name: "Discard unsaved changes" }).click();
  await sleep(2500);
  const discardedV =
    (await p.getByRole("button", { name: /^Remove .* filter$/ }).count()) === 1 && !(await txt(viewsBtn)).includes("Modified");
  await sortTo("descending");
  await sleep(1000);
  const modified2 = (await txt(viewsBtn)).includes("Modified");
  await viewsBtn.click();
  await p.getByRole("menuitem", { name: "Save", exact: true }).click();
  await sleep(2500);
  const savedAgain = !(await txt(viewsBtn)).includes("Modified");
  await viewsBtn.click();
  await p.getByRole("menuitemradio", { name: "Default view" }).click();
  await sleep(2500);
  const builtIn =
    (await p.getByRole("button", { name: /^Remove .* filter$/ }).count()) === 0 && (await txt(viewsBtn)).startsWith("Default view");
  const builtInHeaders = await headers();
  await viewsBtn.click();
  await p.getByRole("menuitemradio", { name: viewName }).click();
  await sleep(2500);
  const restoredChip = await p.getByRole("button", { name: "Owner: Daniel Okafor" }).isVisible();
  await sortIs("descending");
  const restoredSort = await titleHeader.getAttribute("aria-sort");
  const storedView = (
    await p.request.get(`${BASE}/api/v1/list-views?surface=contracts`, H).then((r) => r.json())
  ).views.find((v) => v.name === viewName);
  const restoredHeaders = await headers();
  if (role === "legal_team_member")
    await p.screenshot({ path: path.join(here, "legal_team_member-saved-view.png") });
  R(
    "Save a view, steps 1-6, Modified, Discard unsaved changes, Save, Default view",
    "Save as… with a Name stores filters, sort and column order; a change marks Modified; Discard restores; Save replaces; Default view shows the built-in layout; selecting the view restores it",
    `Views control "${viewsLabel0}"; columns after Move Counterparty later ${movedHeaders.join("|")}; saved label "${savedLabel}"; Modified ${modified}; Discard restored ${discardedV}; second change Modified ${modified2}, Save cleared ${savedAgain}; Default view built-in ${builtIn} (${builtInHeaders.join("|")}); reselected: chip ${restoredChip}, sort ${restoredSort}, columns ${restoredHeaders.join("|")}; stored sort ${JSON.stringify(storedView?.config?.sort)}; URL ${pathOf(p)}`,
    viewsLabel0.startsWith("Default view") &&
      savedLabel === viewName &&
      modified &&
      discardedV &&
      modified2 &&
      savedAgain &&
      builtIn &&
      restoredChip &&
      restoredSort === "descending" &&
      JSON.stringify(restoredHeaders) === JSON.stringify(movedHeaders) &&
      JSON.stringify(builtInHeaders) !== JSON.stringify(movedHeaders),
    "/contracts",
  );
  await viewsBtn.click();
  await p.getByRole("menuitem", { name: "Set as default" }).click();
  await sleep(1500);
  await viewsBtn.click();
  const marker = await txt(p.getByRole("menuitemradio", { name: new RegExp(viewName) }));
  await p.keyboard.press("Escape");
  await p.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Home", exact: true }).click();
  await p.waitForURL(`${BASE}/`);
  await p.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Contracts" }).click();
  await p.waitForURL(/\/contracts/);
  await sleep(2500);
  const opensWithView =
    (await txt(viewsBtn)).startsWith(viewName) && (await p.getByRole("button", { name: "Owner: Daniel Okafor" }).isVisible());
  await viewsBtn.click();
  await p.getByRole("menuitem", { name: "Rename…" }).click();
  await p.getByRole("dialog", { name: "Rename this view" }).getByLabel("Name").fill(`${viewName} 2`);
  await p.getByRole("dialog", { name: "Rename this view" }).getByRole("button", { name: "Rename" }).click();
  await sleep(2000);
  const renamedV = (await txt(viewsBtn)).startsWith(`${viewName} 2`);
  await viewsBtn.click();
  await p.getByRole("menuitem", { name: "Save as…" }).click();
  await p.getByRole("dialog", { name: "Save this view" }).getByLabel("Name").fill(`${viewName} 2`.toUpperCase());
  await p.getByRole("dialog", { name: "Save this view" }).getByRole("button", { name: "Save" }).click();
  await sleep(2000);
  const dupV = await txt(p.getByRole("dialog", { name: "Save this view" }).getByRole("alert"));
  await p.getByRole("dialog", { name: "Save this view" }).getByRole("button", { name: "Cancel" }).click();
  const other2 = await signIn(acct.email, acct.password);
  await other2.page.goto(`${BASE}/contracts`);
  await sleep(3000);
  const otherBtn = other2.page.getByRole("region", { name: "Contracts" }).getByRole("button").first();
  const otherHasView =
    (await txt(otherBtn)).startsWith(`${viewName} 2`) &&
    (await other2.page.getByRole("button", { name: "Owner: Daniel Okafor" }).isVisible());
  await other2.context.close();
  R(
    "Set as default marks Opens here; Rename…; duplicate name refused; the view follows the account",
    "Set as default opens the list with the view and the menu marks it Opens here; Rename… changes the name; a name differing only by case is refused; a second browser opens the view",
    `Menu entry "${marker}"; opens with view ${opensWithView}; renamed ${renamedV}; duplicate "${dupV}"; second browser ${otherHasView}`,
    marker.includes("Opens here") &&
      opensWithView &&
      renamedV &&
      dupV === "You already have a view with that name on this list." &&
      otherHasView,
    "/contracts",
  );
  const rowsBefore = sql(`select count(*) from contracts`);
  await viewsBtn.click();
  await p.getByRole("menuitem", { name: "Delete…" }).click();
  const vDel = p.getByRole("dialog", { name: "Delete this view?" });
  const vDelText = await txt(vDel);
  await vDel.getByRole("button", { name: "Delete" }).click();
  await sleep(2500);
  await viewsBtn.click();
  const stillListed = (await p.getByRole("menuitemradio", { name: `${viewName} 2` }).count()) > 0;
  await p.keyboard.press("Escape");
  const rowsAfter = sql(`select count(*) from contracts`);
  R(
    "Delete… removes the saved view after confirmation and does not delete records",
    "The confirmation says the records are not touched; the view is gone; records remain",
    `Dialog "${vDelText.slice(0, 140)}"; still listed ${stillListed}; contracts ${rowsBefore} -> ${rowsAfter}`,
    vDelText.includes("The records in it are not touched.") && !stillListed && Number(rowsAfter) >= Number(rowsBefore),
    "/contracts",
  );
  return c;
}

// ---------- main ----------
const fx = await fixtures();
const meta = {
  batch: "DOC-030",
  group: "search",
  article: A,
  scenario: S,
  walkthroughReviewer: "DOC-030 independent walkthrough agent (search)",
  reviewerKind: "agent",
  appCommit: LAB.sourceCommit,
  environment: PROJECT,
  lab: {
    name: LAB.name,
    project: LAB.project,
    appUrl: BASE,
    mailUrl: MAIL,
    appImageId: LAB.appImageId,
    engineImageId: LAB.engineImageId,
    snapshotDigest: LAB.snapshotDigest,
    seed: LAB.seed,
  },
  runningImages: Object.fromEntries(
    ["app", "worker", "doc-engine"].map((svc) => [
      svc,
      execFileSync("docker", ["inspect", "-f", "{{.Image}}", `${PROJECT}-${svc}-1`], { encoding: "utf8" }).trim(),
    ]),
  ),
  guideSha256: execFileSync("sha256sum", [path.join(root, "docs/user-guides/search-and-views.md")], {
    encoding: "utf8",
  }).split(" ")[0],
  browser: "Playwright 1.63.0 Chromium, headless, 1440x900, Europe/London, one isolated context per account or device",
  startedAt: new Date().toISOString(),
  fixtures: {
    stamp: fx.stamp,
    prefix: fx.prefix,
    indexed: fx.indexed,
    created: fx.created,
    accounts: Object.fromEntries(
      Object.entries(fx.accounts).map(([k, v]) => [k, { email: v.email, displayName: v.displayName }]),
    ),
  },
};
const roles = process.argv.slice(2).length ? process.argv.slice(2) : ["administrator", "legal_team_member"];
const open = {};
for (const role of roles) {
  try {
    open[role] = await walk(role, fx);
  } catch (e) {
    const msg = String(e.message).split("\n").slice(0, 3).join(" ");
    console.error(msg);
    record(role, "script error", "the walkthrough completes", msg, false);
  }
}
// An Administrator archives the fixture Field; each walker's question that used it drops it with the notice.
if (fx.fieldUrls && Object.keys(open).length) {
  const d = await apiSignIn(DANIEL);
  await d.post(`/api/v1/fields/${fx.field.id}/archive`, {}, H).catch((e) => console.error(String(e)));
  for (const [role, c] of Object.entries(open)) {
    if (!c || !fx.fieldUrls[role]) continue;
    const p = c.page;
    await p.goto(fx.fieldUrls[role]);
    const notice = await seen(p.getByText("Unavailable Field conditions were removed."), 15000);
    const chips = await p.getByRole("button", { name: /^Edit / }).count();
    const fieldSearch = `${fx.prefix} field ${role === "administrator" ? "A" : "M"}`;
    // The saved search holding the archived Field, run from the header Saved group.
    await p.goto(`${BASE}/`);
    await sleep(1000);
    await p.getByRole("combobox", { name: "Search" }).click();
    const lb = p.getByRole("listbox", { name: "Search results" });
    await lb.waitFor();
    await sleep(1200);
    await lb.getByRole("group", { name: "Saved" }).getByRole("option", { name: fieldSearch }).click();
    await p.waitForURL(/aq=/);
    const savedNotice = await seen(p.getByText("Unavailable Field conditions were removed."), 15000);
    // The same saved search opened under Saved searches in the dialog.
    await p.getByRole("button", { name: "Advanced", exact: true }).click();
    const dlg = p.getByRole("dialog", { name: "Advanced search" });
    await dlg.waitFor();
    await dlg.getByRole("region", { name: "Saved searches" }).getByRole("button", { name: fieldSearch, exact: true }).click();
    await sleep(2000);
    const dialogNotice = await txt(dlg.getByRole("status").filter({ hasText: "removed" }));
    const rowGone = !(await dlg.getByRole("group", { name: `Contract ${fx.field.label} condition` }).isVisible());
    // Clean up this walker's remaining saved search.
    await dlg.getByRole("region", { name: "Saved searches" }).getByRole("button", { name: `Manage ${fieldSearch}` }).click();
    await p.getByRole("menuitem", { name: "Delete…" }).click();
    await p.getByRole("dialog", { name: "Delete this saved search?" }).getByRole("button", { name: "Delete" }).click();
    await sleep(1000);
    record(
      role,
      "A Field an Administrator archives is removed from the question with a notice",
      "Reopening the question that used the archived Field says Unavailable Field conditions were removed. and drops its chip",
      `Results page notice ${notice}; condition chips left ${chips}; saved search run from the header Saved group shows the notice ${savedNotice}; the saved search selected under Saved searches in the dialog says "${dialogNotice}" and the Field row is gone ${rowGone}`,
      notice && chips === 0 && savedNotice && rowGone,
      "/search",
    );
    if (dialogNotice && dialogNotice !== "Unavailable Field conditions were removed.")
      guideFailures.push({
        role,
        note: `Opening a saved search whose Field was archived shows "${dialogNotice}" in the dialog, not the notice the guide names. The results page shows the guide's notice.`,
      });
    await c.context.close();
  }
}
// A Business User has no app search.
{
  const jc = await context();
  try {
    let r;
    let link = null;
    // The shared sign-in link budget answers 429 when spent; wait it out (up to about 16 minutes).
    for (let attempt = 1; attempt <= 9 && !link; attempt++) {
      const since = Date.now();
      r = await fetch(`${BASE}/api/v1/auth/magic-link`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE },
        body: JSON.stringify({ email: BUSINESS, group: "business" }),
      });
      link = r.status === 202 ? await mailLink(BUSINESS, since, /sign in/i) : null;
      if (!link) await sleep(120000);
    }
    if (link) await jc.page.goto(link);
    await jc.page.waitForLoadState("networkidle").catch(() => {});
    await jc.page.goto(`${BASE}/search?q=${fx.T}`);
    await jc.page.waitForURL(/\/portal/, { timeout: 15000 }).catch(() => {});
    record(
      "business_user",
      "Before you start: Business Users are sent from the search page to the Portal",
      "Opening /search as the Business User Lena Vogel lands on the Portal",
      `Magic link requested ${r.status}; landed on ${new URL(jc.page.url()).pathname}`,
      new URL(jc.page.url()).pathname.startsWith("/portal"),
      "/search",
    );
  } catch (e) {
    record("business_user", "Business User redirect", "lands on the Portal", String(e.message), false);
  }
  await jc.context.close();
}
await browser?.close();
meta.finishedAt = new Date().toISOString();
const summary = {
  total: steps.length,
  passed: steps.filter((s) => s.result === "pass").length,
  failed: steps.filter((s) => s.result === "fail").length,
};
const out = process.env.OUT ?? "walkthrough.json";
writeFileSync(
  path.join(here, out),
  JSON.stringify({ ...meta, summary, guideFailures, productBugs, steps }, null, 2) + "\n",
);
console.log(out, summary);
