// DOC-030 inbox group: independent browser walkthrough of
//   docs/user-guides/triage-requests.md (V-C12) and docs/user-guides/convert-request.md (V-C13)
// on the shared work2 lab built from app commit 067c1646829df85e62b809ee9157921e867c84e7.
// Written by the DOC-030 independent walkthrough agent (inbox) from the guide text.
// Pattern from docs/documentation/batches/DOC-029/inbox/walkthrough-r1.mjs.
//
// Prerequisites, run once from the worktree root:
//   LAB_PASSWORD=... node docs/documentation/batches/DOC-030/inbox/setup-config.mjs
//   LAB_PASSWORD=... node docs/documentation/batches/DOC-030/inbox/setup-requests.mjs
// Run (LAB_PASSWORD set in the environment):
//   LAB_PASSWORD=... node docs/documentation/batches/DOC-030/inbox/walkthrough.mjs
// Env: PHASES=triage,convert,access (default) or ai, ROLES=administrator,legal_team_member,
//      OUT=<log path>, FIXTURES, REQUESTS, LAB=work2 (or inboxai with LAB_APP_URL, LAB_MAIL_URL).
// The ai phase runs only on the separate inboxai lab with STANDIN_CONTROL_URL and
// STANDIN_CONTROL_TOKEN for the local stand-in (setup-ai.mjs, provider-standin.mjs):
//   LAB=inboxai LAB_APP_URL=http://127.0.0.1:43340 LAB_MAIL_URL=http://127.0.0.1:48465 \
//   FIXTURES=.../fixtures-ai.json REQUESTS=.../requests-ai.json OUT=.../walkthrough-ai.json \
//   PHASES=ai node docs/documentation/batches/DOC-030/inbox/walkthrough.mjs
// The seed demo password comes only from LAB_PASSWORD; magic links, cookies and raw mail are
// never written.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  apiSignIn,
  BASE,
  browserSignIn,
  MAIL,
  pause,
  PEOPLE,
  portalSignIn,
  PW_PATH,
  waitForMail,
} from "./api.mjs";
import { makePdf } from "../../../../../scripts/seed/files.mjs";

const { chromium } = await import(PW_PATH);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const fx = JSON.parse(
  readFileSync(process.env.FIXTURES ?? path.join(here, "fixtures.json"), "utf8"),
);
const reqs = JSON.parse(
  readFileSync(process.env.REQUESTS ?? path.join(here, "requests.json"), "utf8"),
).requests;
const OUT = process.env.OUT ?? path.join(here, "walkthrough.json");
const SHOTS = process.env.SHOTS ?? here;
const PHASES = (process.env.PHASES ?? "triage,convert,access").split(",");
const ROLES = (process.env.ROLES ?? "administrator,legal_team_member").split(",");
const LAB = process.env.LAB ?? "work2";
const lab = JSON.parse(readFileSync(path.join(root, ".documentation-labs", LAB, "lab.json"), "utf8"));
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const articleHash = (id) => sha(readFileSync(path.join(root, "docs/user-guides", `${id}.md`)));

const log = {
  kind: "independent-article-walkthrough",
  task: "DOC-030",
  issue: 1157,
  group: "inbox",
  independentReview: true,
  walkthroughReviewer: "DOC-030 independent walkthrough agent (inbox)",
  reviewerKind: "agent",
  method: "browser-walkthrough",
  appCommit: lab.sourceCommit,
  lab: LAB,
  environment: lab.project,
  appUrl: BASE,
  mailUrl: MAIL,
  buildId: `app ${lab.appImageId}; engine ${lab.engineImageId}`,
  containerImages: lab.containerImages,
  seed: lab.seed,
  browser:
    "Playwright 1.63.0 Chromium from node_modules, headless, 1440x1000 staff and 1280x900 Portal; one isolated browser context per identity",
  articleHashesAtStart: {
    "triage-requests": articleHash("triage-requests"),
    "convert-request": articleHash("convert-request"),
  },
  fixtures: {
    contractType: fx.contractType,
    matterType: fx.matterType,
    requestTypes: fx.requestTypes,
    fields: fx.fields,
    templates: fx.templates,
  },
  requests: reqs,
  phases: PHASES,
  roles: ROLES,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  steps: [],
  records: [],
  productBugs: [],
  guideFailures: [],
};
function save() {
  log.finishedAt = new Date().toISOString();
  writeFileSync(OUT, JSON.stringify(log, null, 2));
}
const ARTICLE_SCENARIO = { "triage-requests": "V-C12", "convert-request": "V-C13" };
async function step(article, role, name, expected, fn, page = null) {
  const entry = {
    article,
    scenario: ARTICLE_SCENARIO[article],
    role,
    method: "browser-walkthrough",
    step: name,
    expected,
    page: null,
    actual: null,
    result: "not-run",
    startedAt: new Date().toISOString(),
    at: null,
  };
  log.steps.push(entry);
  try {
    entry.actual = await fn();
    entry.result = "pass";
  } catch (error) {
    entry.actual = `Check did not complete: ${String(error?.message ?? error)
      .split("\n")
      .slice(0, 6)
      .join(" ")}`;
    entry.result = "fail";
  }
  try {
    const p = page ?? pages[role];
    if (p) entry.page = new URL(p.url()).pathname + new URL(p.url()).search;
  } catch {
    /* no page */
  }
  entry.at = new Date().toISOString();
  console.log(
    `[${role}] ${entry.result.toUpperCase()} ${article}: ${name}${entry.result === "fail" ? ` -- ${entry.actual}` : ""}`,
  );
  save();
  return entry;
}
function expectThat(cond, message) {
  if (!cond) throw new Error(message);
}
const shot = async (page, name) => {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  return path.relative(root, path.join(SHOTS, `${name}.png`));
};

// ---------- sessions ----------
const api = {
  administrator: await apiSignIn(PEOPLE.administrator.email),
  legal_team_member: await apiSignIn(PEOPLE.legal_team_member.email),
};
const other = (role) => (role === "administrator" ? "legal_team_member" : "administrator");
const OTHER_READER = {
  business_user: "second_business_user",
  second_business_user: "business_user",
  dev_requester: "dev_requester_2",
  dev_requester_2: "dev_requester",
  requester_a: "requester_b",
  requester_b: "requester_a",
};
const browser = await chromium.launch();
const contexts = {};
const pages = {};
async function staffPage(role) {
  if (pages[role]) return pages[role];
  contexts[role] = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  pages[role] = await contexts[role].newPage();
  await browserSignIn(pages[role], PEOPLE[role].email);
  return pages[role];
}
async function portalPage(key) {
  if (pages[key]) return pages[key];
  contexts[key] = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
  });
  pages[key] = await contexts[key].newPage();
  await portalSignIn(pages[key], PEOPLE[key].email);
  return pages[key];
}

async function userId(role) {
  const { body } = await api[role].get("/api/v1/me");
  return body.user?.id ?? body.id;
}
const getReq = async (n, role = "administrator") =>
  (await api[role].get(`/api/v1/requests/${n}`)).body;
const mainText = async (page) => (await page.locator("main").innerText()).replace(/\s+/g, " ");
const statusCard = (page) => page.locator('[aria-labelledby="inbox-request-outcome-heading"]');

async function gotoRequest(page, n) {
  await page.goto(`${BASE}/inbox/${n}`);
  await page.getByText(`R-${n}`, { exact: true }).first().waitFor({ timeout: 20000 });
  await page.waitForLoadState("networkidle").catch(() => {});
}

async function inboxRow(page, ref) {
  const row = page.locator("tr").filter({ has: page.getByText(ref, { exact: true }) });
  for (let i = 0; i < 12; i++) {
    if ((await row.count()) > 0) return row.first();
    const more = page.getByRole("button", { name: "Show more" });
    if ((await more.count()) === 0) break;
    await more.click();
    await pause(1200);
  }
  return row.first();
}

async function openComments(page) {
  const composer = page.getByRole("textbox", { name: "New comment" });
  if (!(await composer.isVisible().catch(() => false))) {
    await page
      .getByRole("button", { name: /^Comments( \(\d+\))?$/ })
      .first()
      .click();
  }
  await composer.waitFor({ timeout: 10000 });
  return composer;
}

async function postComment(page, tierLabel, text, file) {
  const composer = await openComments(page);
  if (tierLabel)
    await page
      .locator("label")
      .filter({ hasText: new RegExp(`^\\s*${tierLabel}\\s*$`) })
      .click();
  await composer.fill(text);
  if (file) await page.locator('aside input[type="file"], input[type="file"]').last().setInputFiles(file);
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await page.getByText(text, { exact: false }).first().waitFor({ timeout: 15000 });
}

async function portalText(page, n) {
  await page.goto(`${BASE}/portal/requests/${n}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await pause(1200);
  const chat = page.getByRole("button", { name: /^Comments( \(\d+\))?$/ });
  if (
    (await chat.count()) > 0 &&
    !(await page
      .getByRole("textbox", { name: "New comment" })
      .isVisible()
      .catch(() => false))
  ) {
    await chat.first().click();
    await page
      .getByRole("textbox", { name: "New comment" })
      .waitFor({ timeout: 10000 })
      .catch(() => {});
    await pause(1200);
  }
  return { url: page.url(), text: (await page.locator("body").innerText()).replace(/\s+/g, " ") };
}

async function commentsOn(entityType, entityId, role = "administrator") {
  const { body } = await api[role].get(
    `/api/v1/comments?entityType=${entityType}&entityId=${entityId}&limit=100`,
  );
  return body.comments ?? [];
}

async function setStatusFilter(page, wanted) {
  const chip = page.getByRole("button", { name: /^Status: / });
  let pop = page.getByRole("dialog", { name: "Status" });
  if ((await chip.count()) === 0) {
    // The Filter menu's shared property list, narrowed with its Search filters box.
    await page.getByRole("button", { name: /^Filter/ }).first().click();
    pop = page.getByRole("dialog", { name: "Filter" });
    await pop.getByRole("textbox", { name: "Search filters" }).fill("Status");
    await pop.getByRole("button", { name: "Status", exact: true }).click();
  } else await chip.first().click();
  await pop.waitFor();
  for (const label of ["New", "Read", "Converted", "Resolved", "Declined"]) {
    const box = pop.getByRole("checkbox", { name: label, exact: true });
    if ((await box.isChecked()) !== wanted.includes(label)) await box.click();
  }
  await pop.getByRole("button", { name: "Apply" }).click();
  await page.getByRole("button", { name: `Status: ${wanted.join(", ")}` }).waitFor();
  await page.waitForLoadState("networkidle").catch(() => {});
  await pause(800);
}

const URGENCY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };

// ======================= TRIAGE (V-C12) =======================
async function triage(role) {
  const A = "triage-requests";
  const page = await staffPage(role);
  const otherRole = other(role);
  const otherPage = await staffPage(otherRole);
  const T = reqs[`${role}:triage-review`];
  const Rz = reqs[`${role}:triage-resolve`];
  const Rc = reqs[`${role}:triage-race`];
  const requesterKey = T.requester;
  const requesterName = PEOPLE[requesterKey].name;
  const requester = await portalPage(requesterKey);
  const me = PEOPLE[role].name;
  const them = PEOPLE[otherRole].name;

  await step(
    A,
    role,
    `Before any legal user opens them, ${requesterName} views ${Rz.reference} in the Portal and the Inbox list is browsed: both leave it New`,
    "Browsing the Inbox list and the Portal view do not mark a Request Read",
    async () => {
      const before = (await getReq(Rz.number)).request.status;
      expectThat(before === "new", `${Rz.reference} is ${before} before the walk`);
      const { text } = await portalText(requester, Rz.number);
      await page.goto(`${BASE}/inbox`);
      await page.getByRole("button", { name: /^Status: / }).first().waitFor({ timeout: 20000 });
      await inboxRow(page, Rz.reference);
      await pause(800);
      const after = (await getReq(Rz.number)).request.status;
      expectThat(after === "new", `${Rz.reference} became ${after}`);
      const pill = /\bNew\b/.test(text) ? "New" : "(no New pill)";
      return `${Rz.reference} stayed "new" after ${requesterName}'s Portal view (Portal pill ${pill}) and after the Inbox list was loaded in the browser.`;
    },
  );

  await step(
    A,
    role,
    "Open Inbox: Requests tab first, built-in view Status: New, Read, ordered by urgency and then age",
    "Requests tab current; chip Status: New, Read; rows New or Read, sorted by urgency then oldest first",
    async () => {
      await page.goto(`${BASE}/inbox`);
      await page.getByRole("button", { name: "Status: New, Read" }).waitFor({ timeout: 20000 });
      const tabs = await page
        .getByRole("navigation", { name: "Inbox tabs" })
        .getByRole("link")
        .allInnerTexts();
      expectThat(/^Requests/.test(tabs[0]), `first tab is ${tabs[0]}`);
      expectThat(
        new URL(page.url()).pathname === "/inbox" && !new URL(page.url()).search.includes("tab="),
        "Requests tab is not the landing tab",
      );
      const refs = (await page.locator("tbody tr td:first-child").allInnerTexts())
        .map((t) => t.trim())
        .filter((t) => /^R-\d+$/.test(t));
      expectThat(refs.length > 1, "too few rows to check order");
      const rows = [];
      for (const ref of refs) {
        const r = (await getReq(ref.slice(2))).request;
        rows.push({ ref, status: r.status, urgency: r.urgency, createdAt: r.createdAt });
      }
      expectThat(
        rows.every((r) => ["new", "read"].includes(r.status)),
        `a decided row is listed: ${JSON.stringify(rows.filter((r) => !["new", "read"].includes(r.status)))}`,
      );
      for (let i = 1; i < rows.length; i++) {
        const a = rows[i - 1],
          b = rows[i];
        const ok =
          URGENCY_RANK[a.urgency] > URGENCY_RANK[b.urgency] ||
          (a.urgency === b.urgency && a.createdAt <= b.createdAt);
        expectThat(
          ok,
          `order broken between ${a.ref} (${a.urgency}, ${a.createdAt}) and ${b.ref} (${b.urgency}, ${b.createdAt})`,
        );
      }
      const counts = rows.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {});
      return `Tabs ${tabs.join(" and ")}; /inbox opened on Requests with the chip "Status: New, Read". ${rows.length} first-page rows (${JSON.stringify(counts)}) are ordered by urgency, then by submission time oldest first.`;
    },
  );

  await step(
    A,
    role,
    `Open ${T.reference} from its row and read Form responses (Description as a Row), Attachments, Converts to, Requester, Department, Urgency`,
    "Named facts visible; the Contract type's Form collects Description, so it shows under Form responses with no Description card; opening marks it Read",
    async () => {
      await page.goto(`${BASE}/inbox`);
      const row = await inboxRow(page, T.reference);
      await row.getByRole("link").first().click();
      await page.waitForURL(`**/inbox/${T.number}`);
      await page.getByText("Form responses", { exact: true }).waitFor();
      await page.waitForLoadState("networkidle").catch(() => {});
      const text = await mainText(page);
      const detail = await getReq(T.number);
      const dept = detail.request.department?.displayName ?? detail.request.department;
      for (const needle of [
        "Form responses",
        "Attachments",
        "Converts to",
        `Contract · ${fx.contractType.name}`,
        "Requester",
        requesterName,
        "Department",
        "Urgency",
        "High",
        "Description",
        "Fictional description for",
        "Northwind Fictional Supplies",
        "Budget note stays on the Request",
        T.files[0].name,
        T.files[1].name,
      ]) {
        expectThat(text.includes(needle), `missing ${needle}`);
      }
      expectThat(
        (await page.locator('[aria-labelledby="inbox-request-description-heading"]').count()) === 0,
        "a separate Description card is shown",
      );
      const responses = (
        await page.locator('[aria-labelledby="inbox-request-responses-heading"]').innerText()
      ).replace(/\s+/g, " ");
      expectThat(responses.includes("Description"), "Description not under Form responses");
      await pause(1000);
      const status = (await getReq(T.number)).request.status;
      expectThat(status === "read", `status after opening: ${status}`);
      return `Opened from the list row link. Hero: Requester ${requesterName}, Converts to Contract · ${fx.contractType.name}, Department ${typeof dept === "string" ? dept : JSON.stringify(dept)}, Urgency High. Form responses: "${responses.slice(0, 260)}". No separate Description card. Attachments ${T.files.map((f) => f.name).join(", ")}. Opening the page changed the status from new to read.`;
    },
  );

  await step(
    A,
    role,
    `A Matter Request (${Rc.reference}) whose Matter type does not collect Description shows a separate Description card`,
    "Description card present",
    async () => {
      await gotoRequest(page, Rc.number);
      const card = page.locator('[aria-labelledby="inbox-request-description-heading"]');
      expectThat((await card.count()) === 1, "no Description card");
      const cardText = (await card.innerText()).replace(/\s+/g, " ");
      expectThat(cardText.includes("Fictional description for"), "Description text missing");
      return `${Rc.reference} (Matter · ${fx.matterType.name}) shows a Description card: "${cardText.slice(0, 120)}".`;
    },
  );

  await step(
    A,
    role,
    "Select attachment filenames: PDF displays, Word file is prepared for reading, Download saves the original bytes",
    "Viewer shows PDF and Word text; Download bytes equal the stored original",
    async () => {
      await gotoRequest(page, T.number);
      const detail = await getReq(T.number, role);
      const out = [];
      for (const att of detail.attachments) {
        await page.getByRole("button", { name: att.filename, exact: true }).click();
        const viewer = page.getByRole("dialog");
        const expectedText = att.filename.endsWith(".pdf")
          ? "Fictional attachment"
          : "Fictional Word attachment";
        await viewer.getByText(expectedText, { exact: false }).first().waitFor({ timeout: 90000 });
        const [download] = await Promise.all([
          page.waitForEvent("download"),
          viewer.getByRole("link", { name: /Download/ }).first().click(),
        ]);
        const bytes = readFileSync(await download.path());
        expectThat(
          bytes.length === T.files.find((f) => f.name === att.filename).bytes,
          `download of ${att.filename} is ${bytes.length} bytes, submitted ${T.files.find((f) => f.name === att.filename).bytes}`,
        );
        const direct = await page.request.get(
          `${BASE}/api/v1/requests/${T.number}/attachments/${att.id}`,
        );
        expectThat(
          sha(bytes) === sha(Buffer.from(await direct.body())),
          `download of ${att.filename} differs from the stored original`,
        );
        if (att.filename.endsWith(".pdf")) await shot(page, `${role}-viewer-pdf`);
        await page.keyboard.press("Escape");
        await viewer.waitFor({ state: "hidden" });
        out.push(
          `${att.filename} opened in the viewer with its text and Download saved ${bytes.length} bytes identical to the submitted file`,
        );
      }
      // The separate Download control beside each filename.
      const [dl] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("link", { name: `Download ${T.files[1].name}` }).click(),
      ]);
      const size = readFileSync(await dl.path()).length;
      expectThat(size === T.files[1].bytes, "row Download size differs");
      return `${out.join("; ")}. The row control "Download ${T.files[1].name}" saved ${size} bytes.`;
    },
  );

  await step(
    A,
    role,
    `Assign ${T.reference} from the list row: Search people, choose ${them}, Save assignment; status unchanged; the other legal session still has Triage`,
    "Row and Request page show the saved assignee; status unchanged; other session sees Triage",
    async () => {
      await page.goto(`${BASE}/inbox`);
      const row = await inboxRow(page, T.reference);
      await row.getByRole("button", { name: `Assign ${T.reference}` }).click();
      const dialog = page.getByRole("dialog", { name: `Assign ${T.reference} for triage` });
      await dialog.waitFor();
      await dialog.locator("fieldset label").first().waitFor({ timeout: 15000 });
      const listed = (await dialog.locator("fieldset label").allInnerTexts()).map((t) =>
        t.replace(/^[A-Z]{2}\s*/, "").trim(),
      );
      const users = (await api.administrator.get("/api/v1/users")).body.users;
      const nonLegal = users
        .filter((u) => !["administrator", "legal_team_member"].includes(u.role) || u.status !== "active")
        .map((u) => u.displayName);
      expectThat(
        !listed.some((n) => nonLegal.some((x) => n.includes(x))),
        `non-legal or inactive person offered: ${listed.join(", ")}`,
      );
      const before = (await getReq(T.number)).request.status;
      await dialog.getByRole("textbox", { name: "Search people" }).fill(them.split(" ")[0]);
      await pause(800);
      await dialog.locator("fieldset label").filter({ hasText: them }).click();
      await dialog.getByRole("button", { name: "Save assignment" }).click();
      await dialog.waitFor({ state: "hidden" });
      await page
        .getByRole("button", { name: `Reassign ${T.reference}: ${them}` })
        .first()
        .waitFor();
      const r = (await getReq(T.number)).request;
      expectThat(r.assignee?.displayName === them, "assignment not saved");
      expectThat(r.status === before, `status changed ${before} -> ${r.status}`);
      await gotoRequest(page, T.number);
      await page.getByRole("button", { name: `Reassign ${T.reference}: ${them}` }).waitFor();
      await gotoRequest(otherPage, T.number);
      await otherPage.getByRole("button", { name: "Triage", exact: true }).waitFor();
      return `Dialog "Assign ${T.reference} for triage" listed only active legal people (${listed.filter(Boolean).length}: ${listed.filter(Boolean).join(", ")}); typed "${them.split(" ")[0]}" in Search people, chose ${them}, Save assignment. Row and Request page read "Reassign ${T.reference}: ${them}"; status stayed ${r.status}; ${them}'s own session still shows Triage on ${T.reference}.`;
    },
  );

  await step(
    A,
    role,
    "Portal shows the saved triage assignee as Legal Owner, and Read once Legal opened the record",
    `${requesterName}'s Portal page shows Legal Owner ${them} and the Read status`,
    async () => {
      const { text } = await portalText(requester, T.number);
      expectThat(
        text.includes(`Legal Owner ${them}`) || text.includes(`Legal Owner: ${them}`),
        `Portal text lacks Legal Owner ${them}: ${text.slice(0, 400)}`,
      );
      expectThat(/\bRead\b/.test(text), "Portal does not show Read");
      expectThat(
        text.includes("Your request has been opened by the Legal team."),
        "Read banner missing",
      );
      return `${requesterName}'s Portal page for ${T.reference} shows "Legal Owner ${them}", the Read pill and "Your request has been opened by the Legal team."`;
    },
  );

  await step(
    A,
    role,
    "Reassign from the avatar control; Cancel leaves the saved assignment; Unassigned clears it and the Portal shows Not assigned yet",
    "Cancel no change; Unassigned saves none; Portal Legal Owner Not assigned yet",
    async () => {
      await gotoRequest(page, T.number);
      await page.getByRole("button", { name: `Reassign ${T.reference}: ${them}` }).click();
      let dialog = page.getByRole("dialog", { name: `Assign ${T.reference} for triage` });
      await dialog.locator("fieldset label").filter({ hasText: me }).click();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      let r = (await getReq(T.number)).request;
      expectThat(r.assignee?.displayName === them, "Cancel changed the assignment");
      await page.getByRole("button", { name: `Reassign ${T.reference}: ${them}` }).click();
      dialog = page.getByRole("dialog", { name: `Assign ${T.reference} for triage` });
      await dialog.locator("fieldset label").filter({ hasText: me }).click();
      await dialog.getByRole("button", { name: "Save assignment" }).click();
      await dialog.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: `Reassign ${T.reference}: ${me}` }).waitFor();
      await page.getByRole("button", { name: `Reassign ${T.reference}: ${me}` }).click();
      dialog = page.getByRole("dialog", { name: `Assign ${T.reference} for triage` });
      await dialog.locator("fieldset label").filter({ hasText: "Unassigned" }).click();
      await dialog.getByRole("button", { name: "Save assignment" }).click();
      await dialog.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: `Assign ${T.reference}` }).waitFor();
      r = (await getReq(T.number)).request;
      expectThat(r.assignee === null && ["new", "read"].includes(r.status), "clear not saved");
      const { text } = await portalText(requester, T.number);
      expectThat(
        text.includes("Legal Owner Not assigned yet") || text.includes("Legal Owner: Not assigned yet"),
        "Portal does not read Legal Owner Not assigned yet",
      );
      return `Cancel after choosing ${me} kept ${them}; reassigning to ${me} saved; choosing Unassigned and Save assignment cleared it (button reads Assign ${T.reference}, status ${r.status}); Portal shows "Legal Owner Not assigned yet".`;
    },
  );

  await step(
    A,
    role,
    "If it does not work: people list failure offers Retry; a failed save shows the error and keeps the saved assignee",
    "Retry reloads people; failed save leaves the prior assignee",
    async () => {
      await gotoRequest(page, T.number);
      let failNext = true;
      await page.route("**/api/v1/requests/assignees**", async (route) => {
        if (failNext) {
          failNext = false;
          return route.abort();
        }
        return route.continue();
      });
      await page.getByRole("button", { name: `Assign ${T.reference}` }).click();
      const dialog = page.getByRole("dialog", { name: `Assign ${T.reference} for triage` });
      await dialog.getByText("People could not be loaded.").waitFor({ timeout: 15000 });
      await dialog.getByRole("button", { name: "Retry" }).click();
      await dialog.locator("fieldset label").filter({ hasText: them }).waitFor({ timeout: 15000 });
      await page.unroute("**/api/v1/requests/assignees**");
      await page.route(`**/api/v1/requests/${T.number}/assignee`, (route) =>
        route.fulfill({ status: 503, contentType: "text/plain", body: "" }),
      );
      await dialog.locator("fieldset label").filter({ hasText: them }).click();
      await dialog.getByRole("button", { name: "Save assignment" }).click();
      const alertText = (await dialog.getByRole("alert").first().innerText()).trim();
      await page.unroute(`**/api/v1/requests/${T.number}/assignee`);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await gotoRequest(page, T.number);
      const r = (await getReq(T.number)).request;
      expectThat(r.assignee === null, "failed save changed the assignee");
      await page.getByRole("button", { name: `Assign ${T.reference}` }).waitFor();
      return `An aborted people load showed "People could not be loaded." with Retry; Retry listed people. A 503 save showed "${alertText}"; reopening the Request showed it still unassigned.`;
    },
  );

  await step(
    A,
    role,
    "Clarify through Comments: audience starts on Legal Only; Shared with requester reaches the Requester; Legal Only does not; the Request stays undecided",
    "Default Legal Only; shared text on Portal; Legal Only text absent; status unchanged",
    async () => {
      await gotoRequest(page, T.number);
      await openComments(page);
      const radios = await page.getByRole("radio").evaluateAll((els) =>
        els.map((e) => ({ label: e.getAttribute("aria-label") ?? e.closest("label")?.innerText ?? e.id, checked: e.checked })),
      );
      const legalOnly = page.getByRole("radio", { name: "Legal Only", exact: true });
      expectThat(await legalOnly.isChecked(), `composer does not start on Legal Only`);
      const legalText = `DOC-030 inbox ${role} legal only note ${Date.now()}`;
      const sharedText = `DOC-030 inbox ${role} question for the requester ${Date.now()}`;
      await postComment(page, null, legalText);
      await postComment(page, "Shared with requester", sharedText);
      const { text } = await portalText(requester, T.number);
      expectThat(text.includes(sharedText), "shared comment missing on Portal");
      expectThat(!text.includes(legalText), "Legal Only comment visible on Portal");
      const r = (await getReq(T.number)).request;
      expectThat(["new", "read"].includes(r.status), `status changed to ${r.status}`);
      void radios;
      return `Composer offered Legal Only (checked) and Shared with requester; posted a Legal Only note, then a Shared with requester question with Comment. ${requesterName}'s Portal page shows the question only; status stays ${r.status}.`;
    },
  );

  await step(
    A,
    role,
    "Triage menu offers Convert to contract, Convert to matter, Resolve request without converting, and no Decline",
    "Exactly the three actions",
    async () => {
      await gotoRequest(page, Rz.number);
      await page.getByRole("button", { name: "Triage", exact: true }).click();
      const items = (await page.getByRole("menuitem").allInnerTexts()).map((s) => s.trim());
      await page.keyboard.press("Escape");
      expectThat(
        JSON.stringify(items) ===
          JSON.stringify([
            "Convert to contract",
            "Convert to matter",
            "Resolve request without converting",
          ]),
        `menu: ${items.join(" | ")}`,
      );
      return `Menu items: ${items.join(" | ")}. No Decline.`;
    },
  );

  await step(
    A,
    role,
    `Resolve ${Rz.reference}: blank note refused; Cancel leaves it undecided with nothing posted`,
    "Refusal message; status undecided; no comment",
    async () => {
      await gotoRequest(page, Rz.number);
      await page.getByRole("button", { name: "Triage", exact: true }).click();
      await page.getByRole("menuitem", { name: "Resolve request without converting" }).click();
      const dialog = page.getByRole("dialog", {
        name: `Resolve ${Rz.reference} without converting`,
      });
      await dialog.waitFor();
      const label = await dialog.getByText("Resolution note (required)").count();
      expectThat(label > 0, "label Resolution note (required) missing");
      await dialog.getByRole("button", { name: "Resolve request" }).click();
      await pause(600);
      const refusal = (await dialog.getByRole("alert").first().innerText()).trim();
      await dialog.getByRole("textbox").fill("DOC-030 inbox note typed then cancelled");
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      const detail = await getReq(Rz.number);
      expectThat(["new", "read"].includes(detail.request.status), "Cancel decided the Request");
      const comments = await commentsOn("request", Rz.id);
      expectThat(
        !comments.some((c) => (c.body ?? "").includes("typed then cancelled")),
        "cancelled note posted",
      );
      return `Dialog "Resolve ${Rz.reference} without converting" with Resolution note (required); an empty submit showed "${refusal}"; Cancel with typed text left status ${detail.request.status} and posted nothing.`;
    },
  );

  let resolveNote;
  await step(
    A,
    role,
    `Assign ${Rz.reference} to ${them}, then resolve it as ${me} with a note: Status card Resolved, note in Comments, assignee kept read-only, controls gone`,
    "Assignment does not reserve; Resolved; note in Comments; no Assign or Triage",
    async () => {
      await gotoRequest(page, Rz.number);
      await page.getByRole("button", { name: `Assign ${Rz.reference}` }).click();
      const ad = page.getByRole("dialog", { name: `Assign ${Rz.reference} for triage` });
      await ad.locator("fieldset label").filter({ hasText: them }).click();
      await ad.getByRole("button", { name: "Save assignment" }).click();
      await ad.waitFor({ state: "hidden" });
      resolveNote = `DOC-030 inbox ${role} resolution: no contract is needed, use the standard purchase order ${Date.now()}`;
      await page.getByRole("button", { name: "Triage", exact: true }).click();
      await page.getByRole("menuitem", { name: "Resolve request without converting" }).click();
      const dialog = page.getByRole("dialog", {
        name: `Resolve ${Rz.reference} without converting`,
      });
      const dialogText = (await dialog.innerText()).replace(/\s+/g, " ");
      await dialog.getByRole("textbox").fill(resolveNote);
      log.resolveTimes = log.resolveTimes ?? {};
      log.resolveTimes[Rz.reference] = Date.now();
      await dialog.getByRole("button", { name: "Resolve request" }).click();
      await dialog.waitFor({ state: "hidden" });
      await statusCard(page).getByText("Resolved").first().waitFor({ timeout: 15000 });
      expectThat(
        (await page.getByRole("button", { name: "Triage", exact: true }).count()) === 0,
        "Triage still offered",
      );
      expectThat(
        (await page
          .getByRole("button", { name: new RegExp(`^(Re)?[Aa]ssign ${Rz.reference}`) })
          .count()) === 0,
        "Assign still offered",
      );
      const detail = (await getReq(Rz.number)).request;
      expectThat(detail.assignee?.displayName === them, "assignee not kept");
      await openComments(page);
      await page.getByText(resolveNote).first().waitFor();
      const comments = await commentsOn("request", Rz.id);
      const note = comments.find((c) => (c.body ?? "").includes(resolveNote));
      expectThat(note?.visibility === "full_thread", `note tier ${note?.visibility}`);
      const text = await mainText(page);
      expectThat(
        text.includes("Attachments") &&
          text.includes("Form responses") &&
          text.includes(Rz.files[0].name),
        "resolved Request lost submitted information or attachments",
      );
      await shot(page, `${role}-resolved`);
      return `Saved ${them} as assignee, then ${me} resolved it; assignment did not reserve it. Dialog text: "${dialogText.slice(0, 220)}". Status card reads Resolved; Assign and Triage are gone; ${them} stays as assignee (read-only); Comments holds the note at the full_thread tier; Form responses and ${Rz.files[0].name} remain.`;
    },
  );

  await step(
    A,
    role,
    `Requester reads the resolution note on the Portal, receives the email, and a later reply does not reopen ${Rz.reference}`,
    "Note on Portal; email arrives; status stays resolved after reply",
    async () => {
      const { text } = await portalText(requester, Rz.number);
      expectThat(text.includes(resolveNote), "note missing on Portal");
      const mail = await waitForMail(
        PEOPLE[requesterKey].email,
        new RegExp(`R-${Rz.number}\\b`, "i"),
        log.resolveTimes[Rz.reference],
        60000,
      );
      const replyText = `DOC-030 inbox requester thanks for ${Rz.reference} ${Date.now()}`;
      const composer = requester.getByRole("textbox", { name: "New comment" });
      await composer.fill(replyText);
      await requester.getByRole("button", { name: "Comment", exact: true }).click();
      await requester.getByText(replyText).first().waitFor({ timeout: 15000 });
      const r = (await getReq(Rz.number)).request;
      expectThat(r.status === "resolved", `status after reply: ${r.status}`);
      return `Portal page shows the resolution note; ${mail ? `mail "${mail.subject.replace(/\s+/g, " ")}" reached ${requesterName} in the lab Mailpit` : "no resolution email was found within 60 seconds"}; ${requesterName}'s reply posted and the Request stayed resolved.`;
    },
  );

  await step(
    A,
    role,
    `Lost race on ${Rc.reference}: ${them} resolves while the dialog is open; the dialog states their outcome with Close; the losing note is not posted`,
    "Somebody else already resolved this request.; Close; only the winning note",
    async () => {
      await gotoRequest(page, Rc.number);
      await page.getByRole("button", { name: "Triage", exact: true }).click();
      await page.getByRole("menuitem", { name: "Resolve request without converting" }).click();
      const dialog = page.getByRole("dialog", {
        name: `Resolve ${Rc.reference} without converting`,
      });
      const winning = `DOC-030 inbox ${otherRole} winning resolution ${Date.now()}`;
      const losing = `DOC-030 inbox ${role} losing resolution ${Date.now()}`;
      await dialog.getByRole("textbox").fill(losing);
      await page.route(`**/api/v1/requests/${Rc.number}/resolve`, async (route) => {
        await api[otherRole].post(`/api/v1/requests/${Rc.number}/resolve`, { reply: winning });
        await route.continue();
      });
      await dialog.getByRole("button", { name: "Resolve request" }).click();
      await dialog
        .getByText("Somebody else already resolved this request.")
        .waitFor({ timeout: 15000 });
      await dialog.getByText("Close this to read what they recorded.").waitFor();
      await page.unroute(`**/api/v1/requests/${Rc.number}/resolve`);
      await shot(page, `${role}-lost-race-resolve`);
      await dialog.getByRole("button", { name: "Close" }).first().click();
      await dialog.waitFor({ state: "hidden" });
      await statusCard(page).getByText("Resolved").first().waitFor({ timeout: 15000 });
      const comments = await commentsOn("request", Rc.id);
      const bodies = comments.map((c) => c.body ?? "");
      expectThat(
        bodies.some((b) => b.includes(winning)),
        "winning note missing",
      );
      expectThat(!bodies.some((b) => b.includes(losing)), "losing note posted");
      return `${them}'s resolution landed through the lab API while the browser write was held. The dialog said "Somebody else already resolved this request." and "Close this to read what they recorded." with Close. After Close the Status card reads Resolved; the thread holds only ${them}'s note.`;
    },
  );

  await step(
    A,
    role,
    "New and Read: the Status filter shows only New or only Read Requests",
    `${T.reference} (opened) under Read only; an unopened Request under New only`,
    async () => {
      await page.goto(`${BASE}/inbox`);
      await page.getByRole("button", { name: "Status: New, Read" }).waitFor();
      await setStatusFilter(page, ["Read"]);
      const readRefs = (await page.locator("tbody tr td:first-child").allInnerTexts()).map((t) =>
        t.trim(),
      );
      const readRow = await inboxRow(page, T.reference);
      expectThat((await readRow.count()) === 1, `${T.reference} not under Status: Read`);
      for (const ref of readRefs.filter((r) => /^R-\d+$/.test(r)).slice(0, 8)) {
        const s = (await getReq(ref.slice(2))).request.status;
        expectThat(s === "read", `${ref} is ${s} under Status: Read`);
      }
      await setStatusFilter(page, ["New"]);
      const newRefs = (await page.locator("tbody tr td:first-child").allInnerTexts())
        .map((t) => t.trim())
        .filter((r) => /^R-\d+$/.test(r));
      expectThat(!newRefs.includes(T.reference), `${T.reference} listed under Status: New`);
      for (const ref of newRefs.slice(0, 8)) {
        const s = (await getReq(ref.slice(2))).request.status;
        expectThat(s === "new", `${ref} is ${s} under Status: New`);
      }
      return `Status chip > Read only > Apply showed "Status: Read" with ${T.reference} and only read rows; New only showed "Status: New" without ${T.reference} and only new rows (${newRefs.length} on the first page).`;
    },
  );

  await step(
    A,
    role,
    "Find decided Requests: Status filter Resolved lists them; removing the Status filter lists all outcomes",
    `${Rz.reference} appears under Resolved and without the Status filter; not in the built-in New, Read view`,
    async () => {
      await page.goto(`${BASE}/inbox`);
      await page.getByRole("button", { name: "Status: New, Read" }).waitFor();
      expectThat(
        (await (await inboxRow(page, Rz.reference)).count()) === 0,
        "resolved Request still in the undecided view",
      );
      await page.getByRole("button", { name: "Remove Status filter" }).click();
      await pause(1500);
      const rowAll = await inboxRow(page, Rz.reference);
      expectThat((await rowAll.count()) === 1, "not listed without the Status filter");
      await setStatusFilter(page, ["Resolved"]);
      const rowRes = await inboxRow(page, Rz.reference);
      expectThat((await rowRes.count()) === 1, "not listed under Status: Resolved");
      return `The built-in view omitted ${Rz.reference}; Remove Status filter listed it; Filter > Status > Resolved > Apply showed the "Status: Resolved" chip and listed it.`;
    },
  );

  await step(
    A,
    role,
    "Historical Declined Request shows its reason and no Assign or Triage controls",
    "Status: Declined lists a seeded declined Request; its Status card shows Declined and the reason",
    async () => {
      await page.goto(`${BASE}/inbox`);
      await page.getByRole("button", { name: "Status: New, Read" }).waitFor();
      await setStatusFilter(page, ["Declined"]);
      const refs = (await page.locator("tbody tr td:first-child").allInnerTexts())
        .map((t) => t.trim())
        .filter((t) => /^R-\d+$/.test(t));
      expectThat(refs.length > 0, "no declined Requests listed");
      const n = refs[0].slice(2);
      const r = (await getReq(n)).request;
      expectThat(
        r.status === "declined" && r.declinedReason,
        "listed Request is not declined with a reason",
      );
      await gotoRequest(page, n);
      await statusCard(page).getByText("Declined").first().waitFor();
      const cardText = (await statusCard(page).innerText()).replace(/\s+/g, " ");
      expectThat(
        cardText.includes(r.declinedReason.replace(/\s+/g, " ").slice(0, 30)),
        "reason not on Status card",
      );
      expectThat(
        (await page.getByRole("button", { name: "Triage", exact: true }).count()) === 0,
        "Triage offered on declined",
      );
      expectThat(
        (await page.getByRole("button", { name: /^(Re)?[Aa]ssign R-/ }).count()) === 0,
        "Assign offered on declined",
      );
      const text = await mainText(page);
      return `Status: Declined listed ${refs.join(", ")}; ${refs[0]} Status card reads "${cardText.slice(0, 160)}"; no Triage or Assign controls; Form responses ${text.includes("Form responses") ? "kept" : "absent"}.`;
    },
  );
}

// ======================= CONVERT (V-C13) =======================
function dialogFor(page, ref, module) {
  return page.getByRole("dialog", { name: `Convert ${ref} to a ${module}` });
}
async function openConvert(page, n, module) {
  await gotoRequest(page, n);
  await page.getByRole("button", { name: "Triage", exact: true }).click();
  await page.getByRole("menuitem", { name: `Convert to ${module}` }).click();
}
async function pickDate(page, dialog, offsetMonths = 1, day = 15) {
  await dialog.getByRole("button", { name: "Needed by" }).click();
  const picker = page.getByRole("dialog", { name: "Choose a date" });
  await picker.waitFor();
  for (let i = 0; i < offsetMonths; i++) await picker.getByRole("button", { name: "Next month" }).click();
  const grid = picker.getByRole("grid");
  const monthName = await grid.getAttribute("aria-label");
  const cell = grid.getByRole("gridcell", {
    name: new RegExp(`, [A-Za-z]+ ${day}(st|nd|rd|th), \\d{4}$`),
  });
  const cells = await cell.all();
  let chosen = null;
  for (const c of cells) {
    const name = (await c.getAttribute("aria-label")) ?? (await c.innerText());
    const label = await c.evaluate((el) => el.getAttribute("aria-label") ?? el.textContent);
    if ((name ?? label ?? "").includes(monthName.split(" ")[0]) || cells.length === 1) {
      chosen = c;
      break;
    }
  }
  chosen = chosen ?? cells[0];
  const btn = chosen.getByRole("button");
  if ((await btn.count()) > 0) await btn.first().click();
  else await chosen.click();
  await picker.waitFor({ state: "hidden" }).catch(() => {});
  const [monthWord, year] = monthName.split(" ");
  const month = new Date(`${monthWord} 1, ${year}`).getMonth() + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function convert(role) {
  const A = "convert-request";
  const T = "triage-requests";
  const page = await staffPage(role);
  const otherRole = other(role);
  const Cc = reqs[`${role}:conv-contract`];
  const Cm = reqs[`${role}:conv-matter`];
  const Crt = reqs[`${role}:conv-retarget`];
  const Crace = reqs[`${role}:conv-race`];
  const Cst = reqs[`${role}:conv-stale`];
  const requesterKey = Cc.requester;
  const requesterName = PEOPLE[requesterKey].name;
  const requester = await portalPage(requesterKey);
  const readerKey = OTHER_READER[requesterKey];
  const reader = await portalPage(readerKey);
  const me = PEOPLE[role].name;
  const them = PEOPLE[otherRole].name;
  const F = fx.fields;
  const originals = {};
  const fixtureDir = path.join(here, "fixtures");
  mkdirSync(fixtureDir, { recursive: true });

  await step(
    A,
    role,
    `Before converting ${Cc.reference} and ${Cm.reference}: assign ${them} for triage and post a Legal Only note and a Shared with requester message, each with paper`,
    "Comments posted with attachments; the Requester sees only the shared one",
    async () => {
      const out = [];
      for (const R of [Cc, Cm]) {
        await api[role].patch(`/api/v1/requests/${R.number}/assignee`, {
          assigneeId: await userId(otherRole),
        });
        await gotoRequest(page, R.number);
        const legalFile = path.join(fixtureDir, `${role}-${R.number}-legal-paper.pdf`);
        const sharedFile = path.join(fixtureDir, `${role}-${R.number}-shared-paper.pdf`);
        writeFileSync(
          legalFile,
          makePdf(`DOC-030 inbox legal paper ${R.reference}`, ["Fictional internal note paper."]),
        );
        writeFileSync(
          sharedFile,
          makePdf(`DOC-030 inbox shared paper ${R.reference}`, [
            "Fictional paper shared with the requester.",
          ]),
        );
        const legalText = `DOC-030 inbox ${role} legal only before conversion ${R.reference}`;
        const sharedText = `DOC-030 inbox ${role} shared before conversion ${R.reference}`;
        await postComment(page, "Legal Only", legalText, legalFile);
        await postComment(page, "Shared with requester", sharedText, sharedFile);
        const { text } = await portalText(requester, R.number);
        expectThat(
          text.includes(sharedText) && !text.includes(legalText),
          `Portal reach wrong on ${R.reference}`,
        );
        const detail = await getReq(R.number, role);
        originals[R.number] = [];
        for (const att of detail.attachments) {
          const res = await page.request.get(
            `${BASE}/api/v1/requests/${R.number}/attachments/${att.id}`,
          );
          originals[R.number].push({
            id: att.id,
            filename: att.filename,
            sha: sha(Buffer.from(await res.body())),
          });
        }
        out.push(
          `${R.reference}: assignee ${them}; Legal Only and Shared with requester comments with PDFs posted; the Portal shows only the shared one`,
        );
      }
      return out.join("; ") + ".";
    },
  );

  await step(
    A,
    role,
    `Open ${Cc.reference} Triage > Convert to contract with preparation off: the manual Convert dialog opens directly`,
    "No Getting contract ready and no Unverified; Title, Type, Priority, destination Intake and Creation Rows in Form order, Counterparties picker, Needed by date picker, archived Entity note, Documents with the Request's files, Convert to matter instead; no Carries into / Does not carry into lists",
    async () => {
      const r = await api.administrator.get("/api/v1/ai-connector");
      const c = r.body.connector;
      expectThat(
        !c.contractPreparation && !c.matterPreparation && !c.contractConversionAnalysis,
        "a Request conversion switch is on in this lab",
      );
      log.aiConnectorAtConvert = log.aiConnectorAtConvert ?? {
        at: new Date().toISOString(),
        enabled: c.enabled,
        preset: c.preset,
        model: c.model,
        matterPreparation: c.matterPreparation,
        contractPreparation: c.contractPreparation,
        contractConversionAnalysis: c.contractConversionAnalysis,
      };
      await openConvert(page, Cc.number, "contract");
      const dialog = dialogFor(page, Cc.reference, "contract");
      await dialog.waitFor({ timeout: 15000 });
      const text = (await dialog.innerText()).replace(/\s+/g, " ");
      expectThat(!/Getting contract ready/.test(await page.locator("body").innerText()), "preparation shown");
      expectThat(!text.includes("Unverified"), "Unverified marker present");
      expectThat(!/Carries into|Does not carry into/.test(text), "carry lists present");
      expectThat(
        (await dialog.getByRole("textbox", { name: "Title" }).inputValue()) === Cc.title,
        "Title not seeded from the Request",
      );
      expectThat(
        (await dialog.locator("#convert-type").inputValue()) === fx.contractType.id,
        "configured Contract type not selected",
      );
      expectThat(
        (await dialog.locator("#convert-priority").inputValue()) === "high",
        "Priority not High from Urgency",
      );
      expectThat(
        (await dialog.getByRole("textbox", { name: "Description" }).inputValue()).startsWith(
          "Fictional description for",
        ),
        "Description Row not prefilled",
      );
      expectThat(
        (await dialog.getByRole("textbox", { name: F.carry.name }).inputValue()).startsWith(
          "Northwind Fictional Supplies",
        ),
        "carried answer missing",
      );
      expectThat(
        text.includes(`${fx.entities.old.name} is archived. Pick a live entity to convert.`),
        "archived Entity note missing",
      );
      expectThat((await dialog.getByRole("combobox", { name: "Counterparties" }).count()) === 1, "Counterparties picker missing");
      const neededBy = (await dialog.getByRole("button", { name: "Needed by" }).innerText()).trim();
      const order = await dialog.evaluate((el) =>
        [...el.querySelectorAll("label")].map((l) => l.textContent.replace(/\*$/, "").trim()),
      );
      const docTiles = await dialog
        .getByRole("region", { name: "Documents" })
        .getByRole("listitem")
        .allInnerTexts();
      expectThat(
        Cc.files.every((f) => docTiles.some((t) => t.includes(f.name))),
        `Documents lacks the Request's files: ${docTiles.join(" | ")}`,
      );
      const liveOptions = await dialog.locator(`#convert-${F.entity.slug} option`).allInnerTexts();
      expectThat(!liveOptions.includes(fx.entities.old.name), "archived Entity offered");
      expectThat(
        (await dialog.getByRole("button", { name: "Convert to matter instead" }).count()) === 1,
        "Convert to matter instead missing",
      );
      await shot(page, `${role}-convert-contract-dialog`);
      return `AI connector ${c.enabled ? `enabled by another group (${c.model})` : "disabled"}; all three Request conversion switches off. Dialog "Convert ${Cc.reference} to a contract" opened directly: no "Getting contract ready", no Unverified, no Carries into / Does not carry into lists. Labels in order: ${order.filter(Boolean).join(" > ")}. Title = Request title; Contract type = ${fx.contractType.name}; Priority High; Description prefilled (its Row is collected); Counterparties picker holds the proposed name; Needed by date picker reads "${neededBy}"; ${F.carry.name} prefilled; "${fx.entities.old.name} is archived. Pick a live entity to convert."; the Entity picker does not offer the archived Entity; required ${F.required.name} empty. Documents shows ${docTiles.length} Request files as tiles. Convert to matter instead is offered.`;
    },
  );

  await step(
    A,
    role,
    "If conversion is refused: empty Title, empty required Row and the archived reference are refused by name; Cancel leaves the Request undecided",
    "Named refusals; status undecided after Cancel",
    async () => {
      const dialog = dialogFor(page, Cc.reference, "contract");
      const submit = dialog.getByRole("button", { name: "Convert to contract", exact: true });
      const title = dialog.getByRole("textbox", { name: "Title" });
      await title.fill("");
      await submit.click();
      await pause(600);
      const t1 = (await dialog.getByRole("alert").first().innerText()).trim();
      await title.fill(Cc.title);
      await submit.click();
      await pause(1000);
      const t2 = (await dialog.getByRole("alert").first().innerText()).trim();
      const r0 = (await getReq(Cc.number)).request;
      expectThat(["new", "read"].includes(r0.status), "a refused press decided the Request");
      // Replace the archived reference, keep the required Row empty.
      await dialog.locator(`#convert-${F.entity.slug}`).selectOption({ label: fx.entities.live.name });
      await submit.click();
      await pause(1200);
      const t3 = (await dialog.getByRole("alert").first().innerText()).trim();
      expectThat(/contract|title/i.test(t1), `title refusal: ${t1}`);
      expectThat(t2.includes(F.entity.name), `archived refusal: ${t2}`);
      expectThat(t3.includes(F.required.name), `required refusal: ${t3}`);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      const r = (await getReq(Cc.number)).request;
      expectThat(["new", "read"].includes(r.status), "Cancel decided the Request");
      return `Empty Title: "${t1}". With the Title back, the archived Entity: "${t2}". After choosing ${fx.entities.live.name}, the empty required Row: "${t3}". No press decided the Request; Cancel closed the dialog and it stayed ${r.status}.`;
    },
  );

  let contractNumber;
  let addedFile;
  await step(
    A,
    role,
    `Convert ${Cc.reference}: change Type and back, replace the archived Entity, answer the required Row, attach two documents and remove one, convert once`,
    "Changing Type shows the new Type's Rows; one Contract; staged file uploads after the record exists; Request Converted with C- link and Converted by",
    async () => {
      await openConvert(page, Cc.number, "contract");
      const dialog = dialogFor(page, Cc.reference, "contract");
      await dialog.waitFor();
      await dialog.getByRole("textbox", { name: F.required.name }).fill(`CC-${role}-001`);
      await dialog.getByRole("textbox", { name: "Title" }).fill(`${Cc.title} reviewed`);
      await dialog.locator("#convert-type").selectOption({ label: "NDA" });
      await pause(800);
      const ndaLabels = (await dialog.locator("label").allInnerTexts()).map((t) => t.replace(/\*$/, "").trim());
      const onNda = ndaLabels.includes(F.carry.name);
      await dialog.locator("#convert-type").selectOption(fx.contractType.id);
      await pause(800);
      const titleAfter = await dialog.getByRole("textbox", { name: "Title" }).inputValue();
      const reqAfter = await dialog.getByRole("textbox", { name: F.required.name }).inputValue();
      const typeNote = `Changing Contract type to NDA ${onNda ? "kept" : "removed"} the ${F.carry.name} Row (NDA Rows: ${ndaLabels.filter(Boolean).join(", ")}); back on ${fx.contractType.name}, the edited Title read "${titleAfter}" and ${F.required.name} read "${reqAfter}".`;
      if (reqAfter !== `CC-${role}-001`)
        await dialog.getByRole("textbox", { name: F.required.name }).fill(`CC-${role}-001`);
      await dialog
        .locator(`#convert-${F.entity.slug}`)
        .selectOption({ label: fx.entities.live.name });
      // Documents: stage two files, remove one.
      addedFile = `doc030-inbox-${role}-added-${Cc.number}.pdf`;
      const dropped = `doc030-inbox-${role}-removed-${Cc.number}.pdf`;
      const addPath = path.join(fixtureDir, addedFile);
      const dropPath = path.join(fixtureDir, dropped);
      writeFileSync(addPath, makePdf(`DOC-030 inbox added paper ${Cc.reference}`, ["Fictional added document."]));
      writeFileSync(dropPath, makePdf(`DOC-030 inbox removed paper ${Cc.reference}`, ["Fictional removed document."]));
      const docs = dialog.getByRole("region", { name: "Documents" });
      const attachBtn = docs.getByRole("button", { name: "Attach documents" }).first();
      const [chooser] = await Promise.all([page.waitForEvent("filechooser"), attachBtn.click()]);
      await chooser.setFiles([addPath, dropPath]);
      await docs.getByText(dropped).first().waitFor();
      const typeSelect = docs.getByRole("combobox", { name: "Document type" });
      let typeChoice = "not offered";
      if ((await typeSelect.count()) > 0) {
        const opts = await typeSelect.locator("option").allInnerTexts();
        typeChoice = opts[1] ?? opts[0];
        if (opts[1]) await typeSelect.selectOption({ label: opts[1] });
      }
      await docs.getByRole("button", { name: `Remove ${dropped}` }).click();
      expectThat((await docs.getByText(dropped).count()) === 0, "removed file still staged");
      await dialog.getByRole("button", { name: "Convert to contract", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 60000 });
      await statusCard(page).getByText("Converted").first().waitFor({ timeout: 15000 });
      const detail = await getReq(Cc.number);
      expectThat(
        detail.request.status === "converted" && detail.request.convertedRecord?.module === "contract",
        "not converted to a contract",
      );
      contractNumber = detail.request.convertedRecord.number;
      log.records.push({ role, request: Cc.reference, record: `C-${contractNumber}` });
      const cardText = (await statusCard(page).innerText()).replace(/\s+/g, " ");
      expectThat(
        cardText.includes(`C-${contractNumber}`) && cardText.includes(`Converted by ${me}`),
        `Status card: ${cardText}`,
      );
      const list =
        (await api[role].get(`/api/v1/contracts?q=${encodeURIComponent(Cc.title)}&limit=10`)).body
          .contracts ?? [];
      const same = list.filter((c) => c.title.startsWith(Cc.title));
      expectThat(same.length === 1, `contracts with this title: ${same.length}`);
      expectThat(
        (await page.getByRole("button", { name: "Triage", exact: true }).count()) === 0,
        "Triage still offered",
      );
      return `${typeNote} Picked ${fx.entities.live.name}. Attach documents staged ${addedFile} and ${dropped}; Document type offered: ${typeChoice}; "Remove ${dropped}" took it off. Convert to contract closed the dialog. Status card: "${cardText}". Exactly one Contract carries the title (C-${contractNumber}).`;
    },
  );

  await step(
    T,
    role,
    `Converted ${Cc.reference} in the Inbox keeps assignee, Description and Form responses, shows no Attachments card or Comments, and has no Assign or Triage`,
    "Detail as described for a converted Request",
    async () => {
      await gotoRequest(page, Cc.number);
      const text = await mainText(page);
      expectThat(text.includes("Form responses") && text.includes("Fictional description for"), "Description or Form responses missing");
      expectThat(
        (await page.locator('[aria-labelledby="inbox-request-attachments-heading"]').count()) === 0,
        "Attachments card shown",
      );
      expectThat(
        (await page.getByRole("button", { name: /^Comments( \(\d+\))?$/ }).count()) === 0,
        "Comments applet present",
      );
      const r = (await getReq(Cc.number)).request;
      expectThat(r.assignee?.displayName === them, "assignee not kept");
      expectThat(
        (await page.getByRole("button", { name: "Triage", exact: true }).count()) === 0,
        "Triage offered",
      );
      expectThat(
        (await page.getByRole("button", { name: /^(Re)?[Aa]ssign R-/ }).count()) === 0,
        "Assign offered",
      );
      const link = statusCard(page).getByRole("link", { name: `C-${contractNumber}` });
      expectThat((await link.count()) === 1, "no C- link on the Status card");
      await shot(page, `${role}-converted-request`);
      return `Converted ${Cc.reference} shows Form responses with the Description answer, keeps assignee ${them} (read-only), has a C-${contractNumber} link on the Status card, no Attachments card, no Comments control, and no Triage or Assign.`;
    },
  );

  await step(
    A,
    role,
    `Open C-${contractNumber} from the Status card and check Title, Type, Priority, Description, Department, Needed by Key date, Fields, owners, team, Risk, Current / Requester switch`,
    "Values as the guide states",
    async () => {
      await gotoRequest(page, Cc.number);
      await statusCard(page).getByRole("link", { name: `C-${contractNumber}` }).click();
      await page.waitForURL(`**/contracts/${contractNumber}**`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await pause(1000);
      const { body } = await api[role].get(`/api/v1/contracts/${contractNumber}`);
      const c = body.contract;
      const req = (await getReq(Cc.number)).request;
      expectThat(c.title === `${Cc.title} reviewed`, `Title ${c.title}`);
      expectThat(c.contractTypeId === fx.contractType.id, "Type");
      expectThat(c.priority === "high", `Priority ${c.priority}`);
      expectThat(c.risk === null, "Risk set");
      expectThat(c.description === req.description, "Description differs from the Request");
      expectThat(
        (c.owningDepartmentId ?? c.owningDepartment?.id) === req.departmentId,
        `Department ${JSON.stringify(c.owningDepartment)} vs ${req.departmentId}`,
      );
      expectThat(c.manager?.displayName === me, `Legal Owner ${c.manager?.displayName}`);
      expectThat(c.businessOwner?.displayName === requesterName, "Business Owner");
      const team = body.team.map((t) => t.displayName);
      expectThat(team.includes(requesterName), "Requester not on team");
      if (fx.contractTypeDefaultPerson)
        expectThat(team.includes(fx.contractTypeDefaultPerson), "Contract Type default person not on team");
      expectThat(!team.includes(them) || them === fx.contractTypeDefaultPerson, "triage assignee joined the team");
      expectThat(c.customFields[F.carry.slug]?.startsWith("Northwind Fictional Supplies"), "carried Field missing");
      expectThat(c.customFields[F.stay.slug]?.startsWith("Budget note"), "Budget note did not carry although its Row exists");
      expectThat(c.customFields[F.required.slug] === `CC-${role}-001`, "typed required Field missing");
      expectThat(c.customFields[F.entity.slug] === fx.entities.live.id, "live Entity missing");
      expectThat(c.isConfidential === false, "Confidential flag set");
      const cps = (body.counterparties ?? []).map((p) => p.name ?? p.displayName);
      const kd = (await api[role].get(`/api/v1/contracts/${contractNumber}/key-dates`)).body.deadlines ?? [];
      const nb = kd.filter((d) => /Needed by/i.test(JSON.stringify(d)));
      expectThat(nb.length === 1 && JSON.stringify(nb[0]).includes(Cc.neededBy), `Needed by Key date: ${JSON.stringify(kd).slice(0, 300)}`);
      expectThat(req.customFields[F.stay.slug] && req.departmentId && req.description, "Request lost its answers");
      const overview = await mainText(page);
      expectThat(overview.includes("Legal Owner") && overview.includes(me), "Legal Owner not visible");
      expectThat(overview.includes("Business Owner") && overview.includes(requesterName), "Business Owner not visible");
      const switchBtn = page.getByRole("switch", { name: "Show requester description" });
      expectThat((await switchBtn.count()) === 1 && overview.includes("Current") && overview.includes("Requester"), "Current / Requester switch missing");
      await switchBtn.click();
      await pause(500);
      const reqView = await mainText(page);
      expectThat(reqView.includes(req.description.slice(0, 40)), "Requester description not shown");
      expectThat(await switchBtn.isChecked(), "switch did not move to Requester");
      await switchBtn.click();
      const fieldsLink = page.getByRole("link", { name: /^Fields/ });
      let fieldsText = overview;
      if ((await fieldsLink.count()) > 0) {
        await fieldsLink.first().click();
        await page.waitForLoadState("networkidle").catch(() => {});
        await pause(1000);
        fieldsText = await mainText(page);
      }
      expectThat(fieldsText.includes(F.carry.name) && fieldsText.includes(F.required.name), "Fields lacks the Fields");
      expectThat(!fieldsText.includes("Unverified"), "Unverified marker on Fields with AI off");
      return `C-${contractNumber}: Title "${c.title}" (edited in the dialog), Type ${fx.contractType.name}, Priority high, Risk unset, not Confidential, Description equals the Request's, Department ${c.owningDepartment?.displayName ?? c.owningDepartment ?? c.owningDepartmentId} from the Request, Legal Owner ${me} (not the triage assignee ${them}), Business Owner ${requesterName}, team ${team.join(", ")}, Counterparties ${JSON.stringify(cps)}. Fields shows ${F.carry.name}, ${F.stay.name} (both Rows on this Type), ${F.required.name} and the live Entity, with no Unverified marker. One Needed by Key date on ${Cc.neededBy}. The Current / Requester switch shows the Requester text. The Request keeps its answers, Department and Description.`;
    },
  );

  await step(
    A,
    role,
    `C-${contractNumber} Documents: each Request attachment is a root Document at Version 1 with its bytes; the first is primary; the staged file uploaded; comment paper is not filed; comments keep tiers and authors`,
    "Request files plus the added one; primary set; comments moved with tiers",
    async () => {
      const docs = (await api[role].get(`/api/v1/contracts/${contractNumber}/documents`)).body.documents ?? [];
      const names = docs.map((d) => JSON.stringify(d));
      const orig = originals[Cc.number];
      expectThat(docs.length === orig.length + 1, `document count ${docs.length}`);
      for (const o of orig) {
        const d = docs.find((x) => JSON.stringify(x).includes(o.filename));
        expectThat(d, `no Document for ${o.filename}`);
        expectThat(!d.folderId, `${o.filename} not at the root`);
        const versions = d.versions ?? [];
        expectThat(versions.length === 1, `${o.filename} versions ${versions.length}`);
        const dl = await page.request.get(`${BASE}/api/v1/documents/${d.id}/versions/${versions[0].id}/download`);
        expectThat(sha(Buffer.from(await dl.body())) === o.sha, `${o.filename} bytes differ`);
      }
      const primary = docs.filter((d) => d.isPrimary ?? d.primary);
      expectThat(primary.length === 1 && JSON.stringify(primary[0]).includes(orig[0].filename), `primary: ${primary.map((p) => p.title).join(",")}`);
      expectThat(names.some((n) => n.includes(addedFile)), "added file not uploaded");
      expectThat(!names.some((n) => /removed-|legal-paper|shared-paper/.test(n)), "removed or comment paper became a Document");
      const cid = (await api[role].get(`/api/v1/contracts/${contractNumber}`)).body.contract.id;
      const comments = await commentsOn("contract", cid, role);
      const legal = comments.find((c) => (c.body ?? "").includes("legal only before conversion"));
      const shared = comments.find((c) => (c.body ?? "").includes("shared before conversion"));
      expectThat(legal?.visibility === "legal_only" && shared?.visibility === "full_thread", "tiers not kept");
      expectThat((legal.author?.displayName ?? legal.authorName) === me, "author identity changed");
      expectThat((legal.attachments ?? []).length === 1 && (shared.attachments ?? []).length === 1, "comment paper did not stay on the comments");
      await page.goto(`${BASE}/contracts/${contractNumber}/documents`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await pause(1500);
      const docText = await mainText(page);
      expectThat(orig.every((o) => docText.includes(o.filename.replace(/\.pdf$/, ""))), "Documents tab lacks the promoted files");
      return `Documents: ${orig.map((o) => o.filename).join(", ")} at the root, one Version each with the original bytes; ${orig[0].filename} is primary; ${addedFile} uploaded after creation; the removed file and comment paper are not Documents. The Legal Only and shared comments moved to C-${contractNumber} with tiers legal_only and full_thread, author ${me}, and their PDFs still on the comments.`;
    },
  );

  await step(
    A,
    role,
    `After conversion the original ${Cc.reference} attachment links stop working (staff and Portal)`,
    "404 on original attachment routes",
    async () => {
      const out = [];
      for (const o of originals[Cc.number]) {
        const staff = await page.request.get(`${BASE}/api/v1/requests/${Cc.number}/attachments/${o.id}`);
        const portal = await requester.request.get(`${BASE}/api/v1/portal/requests/${Cc.number}/attachments/${o.id}`);
        expectThat(staff.status() === 404 && portal.status() === 404, `staff ${staff.status()} portal ${portal.status()}`);
        out.push(`${o.filename}: staff ${staff.status()}, Portal ${portal.status()}`);
      }
      return out.join("; ") + ".";
    },
  );

  await step(
    A,
    role,
    `Portal: ${requesterName}'s R- address redirects to C-${contractNumber}, the Request leaves Your requests, Original request is shown; ${PEOPLE[readerKey].name} is refused`,
    "Redirect; not in Your requests; Original request; other Business User refused",
    async () => {
      await requester.goto(`${BASE}/portal/requests/${Cc.number}`);
      await requester.waitForURL((u) => !u.pathname.endsWith(`/requests/${Cc.number}`), { timeout: 15000 });
      await requester.waitForLoadState("networkidle").catch(() => {});
      await pause(1500);
      const url = requester.url();
      const text = (await requester.locator("main").innerText()).replace(/\s+/g, " ");
      expectThat(url.includes(`/contracts/${contractNumber}`), `redirected to ${url}`);
      expectThat(/Original request/i.test(text), "Original request missing");
      await requester.goto(`${BASE}/portal`);
      await pause(2000);
      const portalHome = (await requester.locator("main").innerText()).replace(/\s+/g, " ");
      expectThat(!portalHome.includes(Cc.title), "Request still listed in Your requests");
      await reader.goto(`${BASE}/portal/requests/${Cc.number}`);
      await pause(2000);
      const readerText = (await reader.locator("body").innerText()).replace(/\s+/g, " ");
      const readerRecord = await reader.request.get(`${BASE}/api/v1/portal/contracts/${contractNumber}`);
      expectThat(!readerText.includes(Cc.title) && readerRecord.status() >= 400, "the other Business User could read it");
      return `R-${Cc.number} opened ${new URL(url).pathname}, which shows Original request; Your requests on /portal no longer lists it; ${PEOPLE[readerKey].name} saw no title at the R- address and the Portal contract API answered ${readerRecord.status()}.`;
    },
  );

  let matterNumber;
  let neededByMatter;
  await step(
    A,
    role,
    `${Cm.reference} Convert to matter: Matter template defaults (carried answer wins, template fills), No template removes them, explicitly clear the archived Entity, answer the required Row, pick Needed by`,
    "Template shows defaults; No template removes them; conversion succeeds",
    async () => {
      await openConvert(page, Cm.number, "matter");
      const dialog = dialogFor(page, Cm.reference, "matter");
      await dialog.waitFor();
      const labels = (await dialog.locator("label").allInnerTexts()).map((t) => t.replace(/\*$/, "").trim()).filter(Boolean);
      expectThat(!labels.includes("Description"), "Description shown although its Row is not collected and no draft");
      const noTemplateLabel = await dialog.locator("#convert-template option:checked").innerText();
      await dialog.locator("#convert-template").selectOption({ label: fx.templates.good.name });
      await pause(800);
      const carry = await dialog.getByRole("textbox", { name: F.mCarry.name }).inputValue();
      const region = await dialog.locator(`#convert-${F.choice.slug}`).inputValue();
      await dialog.locator("#convert-template").selectOption({ label: "No template" });
      await pause(600);
      const regionNo = await dialog.locator(`#convert-${F.choice.slug}`).inputValue();
      await dialog.locator("#convert-template").selectOption({ label: fx.templates.good.name });
      await pause(600);
      const regionAgain = await dialog.locator(`#convert-${F.choice.slug}`).inputValue();
      expectThat(carry.startsWith("Fictional Adviser"), `carried answer replaced by template: ${carry}`);
      expectThat(region === "North" && regionAgain === "North", `template default not shown: ${region}/${regionAgain}`);
      expectThat(regionNo === "", `No template kept the default: ${regionNo}`);
      await dialog.getByRole("textbox", { name: F.mRequired.name }).fill(`MC-${role}-002`);
      await dialog.locator(`#convert-${F.mEntity.slug}`).selectOption({ label: "Not set" });
      neededByMatter = await pickDate(page, dialog, 1, 15);
      const nbShown = (await dialog.getByRole("button", { name: "Needed by" }).innerText()).trim();
      const titleBefore = await dialog.getByRole("textbox", { name: "Title" }).inputValue();
      const priorityBefore = await dialog.locator("#convert-priority").inputValue();
      await shot(page, `${role}-convert-matter-dialog`);
      await dialog.getByRole("button", { name: "Convert to matter", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 60000 });
      await statusCard(page).getByText("Converted").first().waitFor({ timeout: 15000 });
      const detail = await getReq(Cm.number);
      expectThat(detail.request.convertedRecord?.module === "matter", "not a matter");
      matterNumber = detail.request.convertedRecord.number;
      log.records.push({ role, request: Cm.reference, record: `M-${matterNumber}` });
      return `Dialog rows: ${labels.join(" > ")} (no Description: the Matter type does not collect it and there is no prepared draft). Template control opened on "${noTemplateLabel}". Choosing ${fx.templates.good.name} kept ${F.mCarry.name} "${carry}" and showed ${F.choice.name} = North; No template emptied it; re-choosing showed North again. Typed ${F.mRequired.name}, set ${F.mEntity.name} to Not set, picked Needed by in the date picker (button reads "${nbShown}"), Title "${titleBefore}", Priority ${priorityBefore}. Converted to M-${matterNumber}.`;
    },
  );

  await step(
    A,
    role,
    `M-${matterNumber}: Title and Priority kept, Risk unset, Matter Manager and Business Owner, Matter section on Overview, template Tasks and Key dates from the creation date in UTC, Needed by, Documents without primary; Prepare Matter Rows is off so no Unverified values`,
    "Values as the guide states",
    async () => {
      const { body } = await api[role].get(`/api/v1/matters/${matterNumber}`);
      const m = body.matter;
      expectThat(m.title === Cm.title, `Title ${m.title}`);
      expectThat(m.priority === "high", `Priority ${m.priority}`);
      expectThat(m.risk === null, `Risk ${m.risk}`);
      expectThat(m.manager?.displayName === me, `Manager ${m.manager?.displayName}`);
      expectThat(m.businessOwner?.displayName === requesterName, "Business Owner");
      expectThat(body.team.some((t) => t.displayName === requesterName), "Requester not on team");
      expectThat(m.customFields[F.mCarry.slug]?.startsWith("Fictional Adviser"), "carried value lost");
      expectThat(m.customFields[F.choice.slug] === "North", "template default missing");
      expectThat(m.customFields[F.mRequired.slug] === `MC-${role}-002`, "typed value missing");
      expectThat(!(F.mEntity.slug in m.customFields) || m.customFields[F.mEntity.slug] === null, "explicitly cleared Entity was set");
      expectThat(Object.keys(m.aiUnverified ?? {}).length === 0, `Unverified markers with AI off: ${JSON.stringify(m.aiUnverified)}`);
      expectThat(!m.customFields[F.record.slug], "Record Row filled with AI off");
      const created = new Date(m.createdAt);
      const plus = (d) => new Date(Date.UTC(created.getUTCFullYear(), created.getUTCMonth(), created.getUTCDate() + d)).toISOString().slice(0, 10);
      const tasks = (await api[role].get(`/api/v1/matters/${matterNumber}/tasks`)).body.tasks ?? [];
      const mt = tasks.find((t) => t.title.includes("manager task"));
      const ot = tasks.find((t) => t.title.includes("open task"));
      expectThat(mt && JSON.stringify(mt).includes(plus(3)), `manager task due: ${JSON.stringify(mt)}`);
      expectThat(mt && JSON.stringify(mt.assignee ?? mt.assignees ?? mt).includes(me), "manager task not assigned to the Matter Manager");
      expectThat(ot && (ot.dueDate ?? ot.dueOn ?? null) === null, `open task due: ${JSON.stringify(ot)}`);
      const kd = (await api[role].get(`/api/v1/matters/${matterNumber}/key-dates`)).body.deadlines ?? [];
      const cp = kd.find((d) => JSON.stringify(d).includes("checkpoint"));
      expectThat(cp && JSON.stringify(cp).includes(plus(5)), `checkpoint: ${JSON.stringify(cp)}`);
      const nb = kd.filter((d) => /Needed by/i.test(JSON.stringify(d)));
      expectThat(nb.length === 1 && JSON.stringify(nb[0]).includes(neededByMatter), `Needed by Key date: ${JSON.stringify(nb)}`);
      const docs = (await api[role].get(`/api/v1/matters/${matterNumber}/documents`)).body.documents ?? [];
      expectThat(docs.length === 2 && !docs.some((d) => d.isPrimary ?? d.primary), `matter documents ${docs.length}`);
      for (const o of originals[Cm.number]) {
        const d = docs.find((x) => JSON.stringify(x).includes(o.filename));
        const versions = d.versions ?? [];
        const dl = await page.request.get(`${BASE}/api/v1/documents/${d.id}/versions/${versions[0].id}/download`);
        expectThat(versions.length === 1 && sha(Buffer.from(await dl.body())) === o.sha, `${o.filename} version or bytes`);
      }
      const mid = m.id;
      const comments = await commentsOn("matter", mid, role);
      const legal = comments.find((c) => (c.body ?? "").includes("legal only before conversion"));
      const shared = comments.find((c) => (c.body ?? "").includes("shared before conversion"));
      expectThat(legal?.visibility === "legal_only" && shared?.visibility === "full_thread", "matter comment tiers not kept");
      await page.goto(`${BASE}/matters/${matterNumber}`);
      await page.getByRole("textbox", { name: F.mCarry.name }).waitFor({ timeout: 20000 });
      await page.waitForLoadState("networkidle").catch(() => {});
      await pause(1000);
      const text = await mainText(page);
      const onOverview = (await page.getByRole("heading", { name: "Matter", level: 2, exact: true }).count()) > 0;
      const rowValues = {
        carry: await page.getByRole("textbox", { name: F.mCarry.name }).inputValue(),
        choice: await page.getByRole("combobox", { name: new RegExp(`^${F.choice.name}`) }).inputValue(),
        record: await page.getByRole("textbox", { name: F.record.name }).inputValue(),
        neededBy: await page.getByRole("textbox", { name: "Needed by" }).inputValue().catch(() => null),
      };
      expectThat(onOverview && rowValues.carry.startsWith("Fictional Adviser") && rowValues.choice === "North", `Matter section Rows: ${JSON.stringify(rowValues)}`);
      expectThat(!text.includes("Unverified"), "Unverified shown with AI off");
      expectThat((await page.getByRole("switch", { name: "Show requester description" }).count()) === 1, "Current / Requester switch missing");
      await shot(page, `${role}-matter-overview`);
      await requester.goto(`${BASE}/portal/requests/${Cm.number}`);
      await requester.waitForURL((u) => u.pathname.includes(`/matters/${matterNumber}`), { timeout: 15000 });
      await pause(1500);
      expectThat(/Original request/i.test(await requester.locator("main").innerText()), "Original request missing on the Portal matter");
      return `M-${matterNumber}: Title unchanged (no "TPL - " prefix), Priority high (not the template's low), Risk unset (not critical), Matter Manager ${me}, Business Owner ${requesterName} on the team. The Overview tab's Matter section shows ${F.mCarry.name} "${rowValues.carry}" (carried), ${F.choice.name} ${rowValues.choice} (template), ${F.mRequired.name} (typed), ${F.mEntity.name} Not set, ${F.record.name} empty, Needed by ${rowValues.neededBy}. With Prepare Matter conversions with AI off, aiUnverified is empty, ${F.record.name} (a Record Row) stays empty and no Unverified marker shows. Tasks: manager task due ${plus(3)} assigned to ${me}; open task without due date. Key dates: checkpoint ${plus(5)} and one Needed by on ${neededByMatter}. Two Documents at Version 1 with original bytes, none primary. Comments kept legal_only and full_thread tiers. Current / Requester switch shown. ${requesterName}'s R-${Cm.number} address opened /portal/matters/${matterNumber} with Original request.`;
    },
  );

  await step(
    A,
    role,
    `Re-target ${Crt.reference} (configured for Contract): Convert to matter, check the destination, switch with Convert to contract instead and back, then convert once; contract-only answers stay on the Request`,
    "Matter dialog shows only Matter Rows and does not list stay-behind answers; one Matter; Request keeps Supplier name, Budget note and Counterparties",
    async () => {
      await openConvert(page, Crt.number, "matter");
      let dialog = dialogFor(page, Crt.reference, "matter");
      await dialog.waitFor();
      const typeValue = await dialog.locator("#convert-type").inputValue();
      const matterText = (await dialog.innerText()).replace(/\s+/g, " ");
      expectThat(!matterText.includes(F.carry.name) && !matterText.includes(F.stay.name) && !matterText.includes("Counterparties"), "contract answers listed in the Matter dialog");
      await dialog.getByRole("textbox", { name: "Title" }).fill(`${Crt.title} retargeted`);
      await dialog.getByRole("button", { name: "Convert to contract instead" }).click();
      dialog = dialogFor(page, Crt.reference, "contract");
      await dialog.waitFor();
      const titleKept = await dialog.getByRole("textbox", { name: "Title" }).inputValue();
      const contractShowsCarry = (await dialog.getByRole("textbox", { name: F.carry.name }).count()) === 1;
      await dialog.getByRole("button", { name: "Convert to matter instead" }).click();
      dialog = dialogFor(page, Crt.reference, "matter");
      await dialog.waitFor();
      let refusal = "";
      if (!typeValue) {
        await dialog.getByRole("button", { name: "Convert to matter", exact: true }).click();
        await pause(600);
        refusal = (await dialog.getByRole("alert").first().innerText()).trim();
        await dialog.locator("#convert-type").selectOption(fx.matterType.id);
        await pause(800);
      }
      await dialog.getByRole("textbox", { name: F.mRequired.name }).fill("MC-retarget");
      await dialog.locator(`#convert-${F.choice.slug}`).selectOption("South");
      await dialog.getByRole("button", { name: "Convert to matter", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 60000 });
      const detail = await getReq(Crt.number);
      expectThat(detail.request.convertedRecord?.module === "matter", "not converted to a matter");
      const mn = detail.request.convertedRecord.number;
      log.records.push({ role, request: Crt.reference, record: `M-${mn}` });
      const m = (await api[role].get(`/api/v1/matters/${mn}`)).body.matter;
      expectThat(!(F.carry.slug in m.customFields) && !(F.stay.slug in m.customFields), "contract answers carried into the Matter");
      expectThat(detail.request.customFields[F.stay.slug] && detail.request.customFields[F.carry.slug], "stay-behind answers not kept on the Request");
      await gotoRequest(page, Crt.number);
      const text = await mainText(page);
      expectThat(text.includes(F.stay.name) && text.includes("Budget note stays on the Request"), "Request page lacks the stay-behind answer");
      return `Convert to matter opened with Matter type "${typeValue ? fx.matterType.name : "(none selected)"}" and listed no ${F.carry.name}, ${F.stay.name} or Counterparties Row and no stay-behind list${refusal ? `; submitting without a type showed "${refusal}"` : ""}. Convert to contract instead showed the Contract Rows (${F.carry.name} ${contractShowsCarry ? "present" : "absent"}) and kept the edited Title ("${titleKept}"); switching back and converting made M-${mn} "${m.title}". The Matter has no ${F.carry.name} or ${F.stay.name}; the Request page still shows them under Form responses.`;
    },
  );

  await step(
    A,
    role,
    `Lost race on ${Crace.reference}: ${them} converts first; the dialog states the outcome and names the record with Close; no second Contract; a second conversion is refused`,
    "Somebody else already converted this request.; It became C-n.; one record",
    async () => {
      await openConvert(page, Crace.number, "contract");
      const dialog = dialogFor(page, Crace.reference, "contract");
      await dialog.waitFor();
      await dialog.getByRole("textbox", { name: F.required.name }).fill("CC-race-browser");
      await page.route(`**/api/v1/requests/${Crace.number}/convert`, async (route) => {
        await api[otherRole].post(`/api/v1/requests/${Crace.number}/convert`, {
          title: Crace.title,
          contractTypeId: fx.contractType.id,
          customFields: { [F.required.slug]: "CC-race-winner" },
        });
        await route.continue();
      });
      await dialog.getByRole("button", { name: "Convert to contract", exact: true }).click();
      await dialog.getByText("Somebody else already converted this request.").waitFor({ timeout: 15000 });
      const winner = (await getReq(Crace.number)).request.convertedRecord;
      await dialog.getByText(`It became C-${winner.number}.`).waitFor();
      await page.unroute(`**/api/v1/requests/${Crace.number}/convert`);
      await shot(page, `${role}-lost-race-convert`);
      await dialog.getByRole("button", { name: "Close" }).first().click();
      await dialog.waitFor({ state: "hidden" });
      await statusCard(page).getByText("Converted").first().waitFor({ timeout: 15000 });
      const cardText = (await statusCard(page).innerText()).replace(/\s+/g, " ");
      const list = (await api[role].get(`/api/v1/contracts?q=${encodeURIComponent(Crace.title)}&limit=10`)).body.contracts ?? [];
      const same = list.filter((c) => c.title === Crace.title);
      expectThat(same.length === 1, `contracts with the title: ${same.length}`);
      const again = await api[role].request("POST", `/api/v1/requests/${Crace.number}/convert`, {
        json: { title: Crace.title, contractTypeId: fx.contractType.id, customFields: { [F.required.slug]: "x" } },
        expect: [409],
      });
      log.records.push({ role, request: Crace.reference, record: `C-${winner.number}`, note: `won by ${them}` });
      return `${them}'s conversion landed through the lab API while the browser write was held. Dialog: "Somebody else already converted this request." "It became C-${winner.number}." "Close this to read what they recorded." with Close. The Status card then read "${cardText.slice(0, 120)}". One Contract has the title; a second convert call answered ${again.status}.`;
    },
  );

  await step(
    A,
    role,
    `${Cst.reference}: a refused template default is recovered with No template and the required answers; a failed added upload offers Retry failed uploads and Continue`,
    "Refusal names the Field and leaves the Request undecided; record created; Retry failed uploads uploads the file",
    async () => {
      await openConvert(page, Cst.number, "matter");
      const dialog = dialogFor(page, Cst.reference, "matter");
      await dialog.waitFor();
      await dialog.locator("#convert-template").selectOption({ label: fx.templates.stale.name });
      await pause(800);
      const staleShown = await dialog.locator(`#convert-${F.choice.slug}`).inputValue();
      await dialog.getByRole("textbox", { name: F.mRequired.name }).fill("MC-stale");
      await dialog.getByRole("button", { name: "Convert to matter", exact: true }).click();
      await dialog.getByRole("alert").first().waitFor({ timeout: 15000 });
      const refusal = (await dialog.getByRole("alert").first().innerText()).trim();
      expectThat(refusal.includes(F.choice.name), `refusal does not name the Field: ${refusal}`);
      expectThat(["new", "read"].includes((await getReq(Cst.number)).request.status), "refused conversion decided the Request");
      await dialog.locator("#convert-template").selectOption({ label: "No template" });
      await pause(600);
      await dialog.getByRole("textbox", { name: F.mRequired.name }).fill("MC-stale");
      await dialog.locator(`#convert-${F.choice.slug}`).selectOption("North");
      const upName = `doc030-inbox-${role}-retry-${Cst.number}.pdf`;
      const upPath = path.join(fixtureDir, upName);
      writeFileSync(upPath, makePdf(`DOC-030 inbox retry paper ${Cst.reference}`, ["Fictional retry document."]));
      const docs = dialog.getByRole("region", { name: "Documents" });
      const [chooser] = await Promise.all([page.waitForEvent("filechooser"), docs.getByRole("button", { name: "Attach documents" }).first().click()]);
      await chooser.setFiles(upPath);
      let failOnce = true;
      await page.route("**/api/v1/matters/*/documents", async (route) => {
        if (route.request().method() === "POST" && failOnce) {
          failOnce = false;
          return route.fulfill({ status: 503, contentType: "application/problem+json", body: JSON.stringify({ title: "Service Unavailable", status: 503, detail: "Upload stand-in failure." }) });
        }
        return route.continue();
      });
      await dialog.getByRole("button", { name: "Convert to matter", exact: true }).click();
      await dialog.getByText("Record created. Some documents could not be uploaded.").waitFor({ timeout: 30000 });
      const hasContinue = (await dialog.getByRole("button", { name: "Continue" }).count()) === 1;
      await dialog.getByRole("button", { name: "Retry failed uploads" }).click();
      await pause(3000);
      await page.unroute("**/api/v1/matters/*/documents");
      await dialog.waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});
      const r = (await getReq(Cst.number)).request;
      expectThat(r.convertedRecord?.module === "matter", "not converted");
      const mdocs = (await api[role].get(`/api/v1/matters/${r.convertedRecord.number}/documents`)).body.documents ?? [];
      expectThat(mdocs.some((d) => JSON.stringify(d).includes(upName)), "retried upload missing");
      log.records.push({ role, request: Cst.reference, record: `M-${r.convertedRecord.number}` });
      return `With ${fx.templates.stale.name} the dialog showed ${F.choice.name} "${staleShown}" and the conversion was refused: "${refusal}"; the Request stayed undecided. No template, ${F.mRequired.name} and ${F.choice.name} North, plus an attached file, converted it to M-${r.convertedRecord.number}. The first upload was answered 503 by the browser route: the dialog said "Record created. Some documents could not be uploaded." with Continue ${hasContinue ? "and" : "missing,"} Retry failed uploads; Retry failed uploads uploaded ${upName} and the dialog closed.`;
    },
  );
}

// ======================= AI PREPARATION (V-C13, inboxai lab only) =======================
// Runs only on the separate inboxai lab, whose AI connector points at the local stand-in
// provider-standin.mjs. The stand-in answers from fictional facts in each Request and cites
// them exactly; its control routes hold, release or break replies. It never calls a provider.
const STANDIN = process.env.STANDIN_CONTROL_URL;
async function standin(pathname, body) {
  const response = await fetch(`${STANDIN}${pathname}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "x-control-token": process.env.STANDIN_CONTROL_TOKEN,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`stand-in control ${pathname} answered ${response.status}`);
  return response.json();
}
async function until(fn, message, timeout = 60000, every = 500) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await fn().catch((e) => {
      last = e;
      return null;
    });
    if (last) return last;
    await pause(every);
  }
  throw new Error(`timed out: ${message}`);
}
async function workflows(patch) {
  const r = await api.administrator.request("PATCH", "/api/v1/ai-connector/workflows", {
    json: patch,
  });
  const c = r.body.connector;
  return `matterPreparation ${c.matterPreparation}, contractPreparation ${c.contractPreparation}, contractConversionAnalysis ${c.contractConversionAnalysis}`;
}
const labelBoxes = (dialog) =>
  dialog.evaluate((el) =>
    [...el.querySelectorAll("label[for]")].map((l) => {
      const box = l.closest(".flex-col") ?? l.parentElement;
      return {
        label: l.textContent.replace(/\*$/, "").trim(),
        unverified: /Unverified/.test(box?.textContent ?? ""),
      };
    }),
  );
async function openBellItem(page, text) {
  await until(
    async () => {
      await page.goto(`${BASE}/inbox`);
      await page.getByRole("button", { name: /^Notifications, / }).click();
      const item = page.getByText(text).first();
      if (await item.isVisible().catch(() => false)) return item;
      await page.keyboard.press("Escape");
      return null;
    },
    `notification "${text}"`,
    90000,
    3000,
  );
  const item = page.getByText(text).first();
  await item.click();
}

function aiCites() {
  const F = fx.fields;
  const cites = [
    { slug: "description", needle: "Advisory support for onboarding a new supplier." },
    { slug: `field:${F.mRequired.slug}`, needle: "MC-AI-4411" },
    {
      slug: `field:${F.mCarry.slug}`,
      needle: "Fictional attachment 1 for",
      value: "Adviser named in the attachment",
    },
    {
      slug: `field:${F.choice.slug}`,
      conflict: true,
      needles: ["The work sits in the North region.", "the region may be South"],
    },
    { slug: `field:${F.record.slug}`, needle: "Quarterly advisory retainer for supplier onboarding" },
    { slug: `field:${F.required.slug}`, needle: "CC-AI-9911" },
    { slug: `field:${F.recordC.slug}`, needle: "Two-year supply of fictional widgets" },
    { slug: F.recordC.slug, needle: "Two-year supply of fictional widgets" },
    { slug: "risk", needle: "Risk is medium", value: "medium" },
  ];
  for (const [key, R] of Object.entries(reqs))
    if (key.endsWith(":ai-matter"))
      cites.push({ slug: "title", needle: `AI suggested matter title ${R.reference}` });
  return cites;
}

// The Matter record-Row preparation check, callable on its own (PHASES=ai-record) for a Matter
// converted earlier in the recorded ai phase: AI_RECORD_MATTERS=administrator:24,legal_team_member:26
async function recordRowStep(role, matterNumber) {
  const A = "convert-request";
  const page = await staffPage(role);
  const F = fx.fields;
  await step(
    A,
    role,
    `Prepare Matter Rows after conversion: M-${matterNumber}'s empty Record Row fills in the background with an Unverified value, with no progress or retry control; sparkle and Confirm work`,
    `${F.record.name} filled from the Request with Unverified; typed values untouched; Confirm clears the marker`,
    async () => {
      const filled = await until(async () => {
        const m = (await api[role].get(`/api/v1/matters/${matterNumber}`)).body.matter;
        return m.customFields[F.record.slug] ? m : null;
      }, "Record Row filled", 90000, 1500);
      const keys = Object.keys(filled.aiUnverified ?? {});
      expectThat(keys.some((k) => k.includes(F.record.slug)), `aiUnverified ${JSON.stringify(keys)}`);
      expectThat(filled.customFields[F.mRequired.slug] === `MC-${role}-ai` && filled.customFields[F.choice.slug] === "North", "typed values changed");
      await page.goto(`${BASE}/matters/${matterNumber}`);
      const box = page.getByRole("textbox", { name: F.record.name });
      await box.waitFor({ timeout: 20000 });
      const value = await box.inputValue();
      // The Row's wrapper holds the input, the Unverified marker, the sparkle and Confirm.
      const rowBox = box.locator("xpath=../../..");
      const aiBorder = await box.locator("xpath=..").getAttribute("data-ai-generated");
      const rowText = (await rowBox.innerText()).replace(/\s+/g, " ");
      expectThat(/Unverified/.test(rowText), `no Unverified on the row: ${rowText}`);
      const pageText = await mainText(page);
      const controls = /Running…|Retry Request-context Analysis|Run analysis/.test(pageText);
      await shot(page, `${role}-ai-matter-record-row`);
      await rowBox.getByRole("button", { name: "View source evidence" }).click();
      // The Matter page's popover heading is the generic "Unverified value".
      const pop = page.getByRole("dialog", { name: "Unverified value" });
      await pop.waitFor({ timeout: 15000 });
      const popText = (await pop.innerText()).replace(/\s+/g, " ");
      await page.keyboard.press("Escape");
      await rowBox.getByRole("button", { name: "Confirm" }).first().click();
      const confirmed = await until(async () => {
        const m = (await api[role].get(`/api/v1/matters/${matterNumber}`)).body.matter;
        return Object.keys(m.aiUnverified ?? {}).some((k) => k.includes(F.record.slug)) ? null : m;
      }, "marker cleared", 20000);
      return `Within the wait, M-${matterNumber}'s ${F.record.name} (a Record Row: not on intake, not required) read "${value}" with Unverified and the AI border (data-ai-generated ${aiBorder}) (aiUnverified keys ${JSON.stringify(keys)}); ${F.mRequired.name} and ${F.choice.name} kept the typed values. The Matter page shows ${controls ? "an analysis control" : "no progress or retry control"} for this run. The sparkle opened "${popText.slice(0, 160)}". Confirm cleared the marker (value kept: "${confirmed.customFields[F.record.slug]}").`;
    },
  );

}

async function aiPhase(role) {
  const A = "convert-request";
  const page = await staffPage(role);
  const F = fx.fields;
  const me = PEOPLE[role].name;
  const M = reqs[`${role}:ai-matter`];
  const ME = reqs[`${role}:ai-matter-edit`];
  const C = reqs[`${role}:ai-contract`];
  const CF = reqs[`${role}:ai-contract-fail`];
  const requesterName = PEOPLE[M.requester].name;
  let matterNumber;

  await step(
    A,
    role,
    `Prerequisite: the three AI conversion switches and the stand-in's cited facts; ${me} posts a Shared with requester message on ${M.reference}`,
    "Prepare Matter conversions with AI on; Fill Contract Fields after conversion on; the message reaches the Request thread",
    async () => {
      const s = await workflows({
        matterPreparation: true,
        contractPreparation: false,
        contractConversionAnalysis: true,
      });
      await standin("/control/pause", { paused: false });
      await standin("/control/malformed", { count: 0 });
      await standin("/control/fallback", { enabled: true, cite: aiCites() });
      await gotoRequest(page, M.number);
      const text = `Please call the matter: AI suggested matter title ${M.reference}. Correction pending: the region may be South.`;
      await postComment(page, "Shared with requester", text);
      return `Administrator API (setup, not a guide step): ${s}; connector Custom, model doc030-inbox-standin-model. ${me} posted "${text}" with Shared with requester in the Comments applet.`;
    },
  );

  await step(
    A,
    role,
    `${M.reference} Triage > Convert to matter with preparation on: Getting matter ready, then Close to keep working`,
    "Conversion draft dialog with Getting matter ready…, elapsed time, the leave hint, Close and Continue manually; Close leaves the Request undecided",
    async () => {
      await standin("/control/pause", { paused: true });
      await openConvert(page, M.number, "matter");
      const dialog = page.getByRole("dialog", { name: "Conversion draft" });
      await dialog.waitFor({ timeout: 15000 });
      await dialog.getByText("Getting matter ready…").waitFor();
      await until(async () => (await standin("/control/stats")).waiting > 0, "provider call held");
      await pause(2200);
      const text = (await dialog.innerText()).replace(/\s+/g, " ");
      expectThat(/Working for \d+ seconds?\./.test(text), `no elapsed time: ${text}`);
      expectThat(
        text.includes(
          "You can close this and keep working. Preparation continues, and a notification tells you when the draft is ready.",
        ),
        "leave hint missing",
      );
      const buttons = (await dialog.getByRole("button").allInnerTexts()).map((t) => t.trim()).filter(Boolean);
      expectThat(buttons.includes("Close") && buttons.includes("Continue manually"), `buttons ${buttons}`);
      await shot(page, `${role}-ai-getting-matter-ready`);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      const r = (await getReq(M.number)).request;
      expectThat(["new", "read"].includes(r.status), `status ${r.status}`);
      return `Dialog "Conversion draft": "${text.slice(0, 330)}". Buttons: ${buttons.join(", ")}. The stand-in held the provider call. Close shut the dialog; ${M.reference} stayed ${r.status}.`;
    },
  );

  await step(
    A,
    role,
    `The completion notification returns to the Convert dialog for ${M.reference} with the prepared draft`,
    "Bell item The Conversion draft for <Request title> is ready to review opens the Convert dialog",
    async () => {
      await standin("/control/pause", { paused: false });
      const itemText = `The Conversion draft for ${M.title} is ready to review`;
      await openBellItem(page, itemText);
      const dialog = dialogFor(page, M.reference, "matter");
      await dialog.waitFor({ timeout: 30000 });
      const url = new URL(page.url());
      return `After the stand-in answered, the Notifications menu listed "${itemText}". Selecting it opened ${url.pathname}${url.search} and the dialog "Convert ${M.reference} to a matter".`;
    },
  );

  await step(
    A,
    role,
    `Review the prepared ${M.reference} dialog: Unverified AI values, unchanged carried values, the Description switch, conflicting sources and Attachment reading details`,
    "AI-changed values carry Unverified with a sparkle; carried unchanged values do not; Description switch AI generated / Requester; Conflicting sources need your review:; the unreadable file is listed",
    async () => {
      const dialog = dialogFor(page, M.reference, "matter");
      const boxes = await labelBoxes(dialog);
      const flagged = boxes.filter((b) => b.unverified).map((b) => b.label);
      const plain = boxes.filter((b) => !b.unverified).map((b) => b.label);
      const title = await dialog.getByRole("textbox", { name: "Title" }).inputValue();
      expectThat(title === `AI suggested matter title ${M.reference}`, `Title ${title}`);
      const cost = await dialog.getByRole("textbox", { name: F.mRequired.name }).inputValue();
      expectThat(cost === "MC-AI-4411", `cost centre ${cost}`);
      const adviser = await dialog.getByRole("textbox", { name: F.mCarry.name }).inputValue();
      for (const l of ["Title", "Description", F.mRequired.name, F.mCarry.name])
        expectThat(flagged.includes(l), `${l} not marked Unverified (${flagged.join(", ")})`);
      for (const l of ["Matter type", "Priority"])
        expectThat(plain.includes(l), `${l} marked although carried unchanged`);
      const text = (await dialog.innerText()).replace(/\s+/g, " ");
      expectThat(text.includes("AI generated") && text.includes("Requester"), "Description switch labels missing");
      const desc = await dialog.getByRole("textbox", { name: "Description" }).inputValue();
      expectThat(desc === "Advisory support for onboarding a new supplier.", `AI description ${desc}`);
      const sw = dialog.getByRole("switch", { name: "Show requester description" });
      await sw.click();
      const reqText = (await dialog.innerText()).replace(/\s+/g, " ");
      expectThat(reqText.includes("Engagement summary: Quarterly advisory retainer"), "Requester description not shown");
      expectThat((await dialog.getByRole("textbox", { name: "Description" }).count()) === 0, "Requester view is editable");
      await sw.click();
      const descBack = await dialog.getByRole("textbox", { name: "Description" }).inputValue();
      expectThat(descBack === desc, "switching lost the AI text");
      expectThat(text.includes("Conflicting sources need your review:"), "conflict list missing");
      const conflictSection = dialog.locator("section").filter({ hasText: "Conflicting sources need your review:" });
      const conflictText = (await conflictSection.innerText()).replace(/\s+/g, " ");
      expectThat(conflictText.includes(F.choice.name), `conflict list: ${conflictText}`);
      expectThat(text.includes("Some attachments could not be fully read."), "attachment warning missing");
      await dialog.getByText("Attachment reading details").click();
      const broken = M.files[1].name;
      const details = (await dialog.locator("details").innerText()).replace(/\s+/g, " ");
      expectThat(details.includes(broken), `reading details: ${details}`);
      await shot(page, `${role}-ai-prepared-matter-dialog`);
      return `Title "${title}", Description "${desc}", ${F.mRequired.name} "${cost}" and ${F.mCarry.name} "${adviser}" carry Unverified; unmarked: ${plain.join(", ")}. The Description switch reads AI generated / Requester; Requester shows the read-only submitted text, and switching back kept the AI text. "Conflicting sources need your review:" lists ${F.choice.name}. "Some attachments could not be fully read. …" shows, and Attachment reading details reads "${details}".`;
    },
  );

  await step(
    A,
    role,
    "Open a sparkle: the saved explanation and supporting passages, no new model call; an attachment opens above the Convert dialog, which keeps your work",
    "Popover titled with the value's label, the explanation, Sources; stand-in extraction count unchanged; the reader closes back to the dialog",
    async () => {
      const dialog = dialogFor(page, M.reference, "matter");
      const before = (await standin("/control/stats")).extractions;
      await dialog.getByRole("textbox", { name: "Title" }).fill(`AI suggested matter title ${M.reference} edited`);
      const boxOf = (slug) =>
        dialog
          .locator(`label[for=convert-${slug}]`)
          .locator("xpath=ancestor::div[contains(@class,'flex-col')][1]");
      // A value cited from the Request's own answers: the popover lists its sources.
      await boxOf(F.mRequired.slug).getByRole("button", { name: "View source evidence" }).click();
      const pop = page.getByRole("dialog", { name: F.mRequired.name });
      await pop.waitFor({ timeout: 15000 });
      await pop.getByText("The source names this value.").waitFor({ timeout: 15000 });
      const popText = (await pop.innerText()).replace(/\s+/g, " ");
      expectThat(popText.includes("Sources"), `popover: ${popText}`);
      await page.keyboard.press("Escape");
      await pop.waitFor({ state: "hidden" });
      // A value cited from an attachment: the reader opens above the Convert dialog.
      await boxOf(F.mCarry.slug).getByRole("button", { name: "View source evidence" }).click();
      const reader = page.getByRole("dialog", { name: F.mCarry.name });
      await reader.waitFor({ timeout: 15000 });
      await reader.getByText("The source names this value.").waitFor({ timeout: 15000 });
      await pause(2500);
      const readerText = (await reader.innerText()).replace(/\s+/g, " ");
      expectThat(readerText.includes(M.files[0].name), `reader: ${readerText.slice(0, 300)}`);
      await shot(page, `${role}-ai-attachment-over-dialog`);
      await reader.getByRole("button", { name: "Close the document" }).first().click();
      await reader.waitFor({ state: "hidden", timeout: 10000 });
      await dialog.waitFor();
      const kept = await dialog.getByRole("textbox", { name: "Title" }).inputValue();
      expectThat(kept === `AI suggested matter title ${M.reference} edited`, `edit lost: ${kept}`);
      const after = (await standin("/control/stats")).extractions;
      expectThat(after === before, `model calls ${before} -> ${after}`);
      return `After editing the Title, the ${F.mRequired.name} sparkle ("View source evidence") opened a popover: "${popText.slice(0, 220)}". The ${F.mCarry.name} sparkle, cited from ${M.files[0].name}, opened the reader above the Convert dialog: "${readerText.slice(0, 200)}". "Close the document" returned to the dialog with the edited Title intact. Stand-in extractions stayed ${before}, so no new model call.`;
    },
  );

  await step(
    A,
    role,
    "Discard AI suggestions removes untouched AI suggestions and keeps your edits; then complete the required Rows and convert",
    "Edited Title kept; untouched AI values gone; no Unverified; one Matter",
    async () => {
      const dialog = dialogFor(page, M.reference, "matter");
      await dialog.getByRole("button", { name: "Discard AI suggestions" }).click();
      await pause(600);
      const title = await dialog.getByRole("textbox", { name: "Title" }).inputValue();
      const cost = await dialog.getByRole("textbox", { name: F.mRequired.name }).inputValue();
      const adviser = await dialog.getByRole("textbox", { name: F.mCarry.name }).inputValue();
      const text = (await dialog.innerText()).replace(/\s+/g, " ");
      expectThat(title.endsWith("edited"), `Title ${title}`);
      expectThat(cost === "", `cost centre after discard: ${cost}`);
      expectThat(adviser.startsWith("Fictional Adviser"), `adviser after discard: ${adviser}`);
      expectThat(!text.includes("Unverified"), "Unverified remains after discard");
      await dialog.getByRole("textbox", { name: F.mRequired.name }).fill(`MC-${role}-ai`);
      await dialog.locator(`#convert-${F.choice.slug}`).selectOption("North");
      await dialog.getByRole("button", { name: "Convert to matter", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 60000 });
      const r = (await getReq(M.number)).request;
      expectThat(r.convertedRecord?.module === "matter", "not converted");
      matterNumber = r.convertedRecord.number;
      log.records.push({ role, request: M.reference, record: `M-${matterNumber}`, lab: LAB });
      return `After Discard AI suggestions: Title kept the edit ("${title}"), ${F.mRequired.name} emptied, ${F.mCarry.name} back to the carried "${adviser}", Description box ${text.includes("AI generated") ? "still shown" : "gone"}, no Unverified. Typed ${F.mRequired.name}, chose ${F.choice.name} North and converted to M-${matterNumber}.`;
    },
  );

  await recordRowStep(role, matterNumber);

  await step(
    A,
    role,
    `${ME.reference}: Continue manually during preparation, convert, then edit the Matter while the Record Row run waits: the run writes nothing`,
    "Continue manually opens the manual dialog; the edited Matter gets no Unverified values",
    async () => {
      await standin("/control/pause", { paused: true });
      await openConvert(page, ME.number, "matter");
      const prep = page.getByRole("dialog", { name: "Conversion draft" });
      await prep.getByText("Getting matter ready…").waitFor({ timeout: 15000 });
      await prep.getByRole("button", { name: "Continue manually" }).click();
      const dialog = dialogFor(page, ME.reference, "matter");
      await dialog.waitFor({ timeout: 15000 });
      const text = (await dialog.innerText()).replace(/\s+/g, " ");
      expectThat(!text.includes("Unverified") && !text.includes("Discard AI suggestions"), "manual dialog shows AI state");
      await dialog.getByRole("textbox", { name: F.mRequired.name }).fill(`MC-${role}-edit`);
      await dialog.locator(`#convert-${F.choice.slug}`).selectOption("South");
      await dialog.getByRole("button", { name: "Convert to matter", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 60000 });
      const r = (await getReq(ME.number)).request;
      const mn = r.convertedRecord.number;
      log.records.push({ role, request: ME.reference, record: `M-${mn}`, lab: LAB });
      await until(async () => {
        const s = await standin("/control/stats");
        return s.waiting > 0 && (s.last?.asked ?? []).includes(`field:${F.record.slug}`) ? s : null;
      }, "Record Row run held at the stand-in", 60000, 1000);
      await page.goto(`${BASE}/matters/${mn}`);
      const priority = page.getByRole("combobox", { name: "Priority" });
      await priority.waitFor({ timeout: 20000 });
      await priority.selectOption("low");
      await until(async () => ((await api[role].get(`/api/v1/matters/${mn}`)).body.matter.priority === "low" ? true : null), "priority saved", 20000);
      await standin("/control/pause", { paused: false });
      await until(async () => ((await standin("/control/stats")).waiting === 0 ? true : null), "stand-in released", 30000);
      await pause(8000);
      const m = (await api[role].get(`/api/v1/matters/${mn}`)).body.matter;
      expectThat(!m.customFields[F.record.slug], `Record Row written: ${m.customFields[F.record.slug]}`);
      expectThat(Object.keys(m.aiUnverified ?? {}).length === 0, `markers ${JSON.stringify(m.aiUnverified)}`);
      await page.reload();
      await page.getByRole("textbox", { name: F.record.name }).waitFor();
      const shown = await page.getByRole("textbox", { name: F.record.name }).inputValue();
      return `"Getting matter ready…" then Continue manually opened "Convert ${ME.reference} to a matter" with no Unverified and no Discard AI suggestions. Converted to M-${mn} while the stand-in held calls. With the Record Row run held, ${me} changed Priority to Low on the Matter page. After release, ${F.record.name} stayed "${shown}" and the Matter has no Unverified values. "If no Unverified values appear, complete the Rows yourself" applies.`;
    },
  );

  let contractNumber;
  await step(
    A,
    role,
    `${C.reference}: with Contract preparation off, the manual dialog opens directly; Fill Contract Fields after conversion runs after creation, Run analysis reads Running…, then Unverified values land`,
    "Manual dialog; Fields header Running… while held; Record Rows filled with Unverified; typed value untouched",
    async () => {
      const s = await workflows({ contractPreparation: false, contractConversionAnalysis: true });
      await openConvert(page, C.number, "contract");
      const dialog = dialogFor(page, C.reference, "contract");
      await dialog.waitFor({ timeout: 15000 });
      const bodyText = await page.locator("body").innerText();
      expectThat(!bodyText.includes("Getting contract ready"), "preparation shown");
      await dialog.getByRole("textbox", { name: F.required.name }).fill(`CC-${role}-typed`);
      await standin("/control/pause", { paused: true });
      await dialog.getByRole("button", { name: "Convert to contract", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 60000 });
      contractNumber = (await getReq(C.number)).request.convertedRecord.number;
      log.records.push({ role, request: C.reference, record: `C-${contractNumber}`, lab: LAB });
      await page.goto(`${BASE}/contracts/${contractNumber}/fields`);
      await page.getByRole("button", { name: "Running…" }).waitFor({ timeout: 30000 });
      await shot(page, `${role}-ai-contract-running`);
      await standin("/control/pause", { paused: false });
      const c = await until(async () => {
        const x = (await api[role].get(`/api/v1/contracts/${contractNumber}`)).body.contract;
        return x.customFields[F.recordC.slug] ? x : null;
      }, "Contract summary filled", 90000, 1500);
      await page.getByText("Two-year supply of fictional widgets").first().waitFor({ timeout: 30000 }).catch(() => {});
      await pause(1500);
      const text = await mainText(page);
      const keys = Object.keys(c.aiUnverified ?? {});
      expectThat(keys.some((k) => k.includes(F.recordC.slug)), `aiUnverified ${JSON.stringify(keys)}`);
      expectThat(c.customFields[F.required.slug] === `CC-${role}-typed`, "typed value changed");
      expectThat(/Unverified/.test(text), "no Unverified marker on Fields");
      return `Switches: ${s}. Triage > Convert to contract opened "Convert ${C.reference} to a contract" directly. Converted to C-${contractNumber} with the stand-in holding calls; the Fields section header showed "Running…". After release, without a reload, ${F.recordC.name} read "${c.customFields[F.recordC.slug]}"${c.risk ? ` and Risk ${c.risk}` : ""}, marked Unverified (keys ${JSON.stringify(keys)}); ${F.required.name} kept "${c.customFields[F.required.slug]}".`;
    },
  );

  await step(
    A,
    role,
    `${CF.reference}: with Contract preparation on, a failed draft offers Retry, Cancel and Continue manually; Retry prepares the draft; an accepted AI value stays Unverified on the Contract; a failed Analysis run offers Retry Request-context Analysis`,
    "Preparation could not finish…; Retry succeeds; Unverified carried to the record; Retry Request-context Analysis recovers",
    async () => {
      const s = await workflows({ contractPreparation: true, contractConversionAnalysis: true });
      await standin("/control/malformed", { count: 6 });
      await openConvert(page, CF.number, "contract");
      const prep = page.getByRole("dialog", { name: "Conversion draft" });
      await prep.waitFor({ timeout: 15000 });
      await prep.getByRole("button", { name: "Retry" }).waitFor({ timeout: 90000 });
      const failText = (await prep.getByRole("status").innerText()).trim();
      const buttons = (await prep.getByRole("button").allInnerTexts()).map((t) => t.trim()).filter(Boolean);
      expectThat(buttons.includes("Continue manually") && buttons.includes("Cancel"), `buttons ${buttons}`);
      await shot(page, `${role}-ai-preparation-failed`);
      await standin("/control/malformed", { count: 0 });
      await prep.getByRole("button", { name: "Retry" }).click();
      const dialog = dialogFor(page, CF.reference, "contract");
      await dialog.waitFor({ timeout: 90000 });
      const boxes = await labelBoxes(dialog);
      const flagged = boxes.filter((b) => b.unverified).map((b) => b.label);
      const cost = await dialog.getByRole("textbox", { name: F.required.name }).inputValue();
      expectThat(cost === "CC-AI-9911" && flagged.includes(F.required.name), `cost ${cost}; flagged ${flagged}`);
      await standin("/control/malformed", { count: 20 });
      await dialog.getByRole("button", { name: "Convert to contract", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 60000 });
      const cn = (await getReq(CF.number)).request.convertedRecord.number;
      log.records.push({ role, request: CF.reference, record: `C-${cn}`, lab: LAB });
      const carried = (await api[role].get(`/api/v1/contracts/${cn}`)).body.contract;
      const carriedKeys = Object.keys(carried.aiUnverified ?? {});
      expectThat(carriedKeys.some((k) => k.includes(F.required.slug)), `accepted value not Unverified: ${JSON.stringify(carriedKeys)}`);
      await page.goto(`${BASE}/contracts/${cn}/fields`);
      const retry = page.getByRole("button", { name: "Retry Request-context Analysis" });
      await until(async () => {
        if (await retry.isVisible().catch(() => false)) return true;
        await page.reload();
        await pause(2000);
        return null;
      }, "Retry Request-context Analysis", 120000, 3000);
      const failure = (await mainText(page)).match(/[^.]*(could not|failed|Failed)[^.]*\./)?.[0] ?? "";
      await shot(page, `${role}-ai-contract-analysis-failed`);
      await standin("/control/malformed", { count: 0 });
      await retry.click();
      const done = await until(async () => {
        const x = (await api[role].get(`/api/v1/contracts/${cn}`)).body.contract;
        return x.customFields[F.recordC.slug] ? x : null;
      }, "Contract summary after retry", 90000, 1500);
      return `Switches: ${s}. With the stand-in breaking replies, the "Conversion draft" dialog read "${failText}" with ${buttons.join(", ")}. Retry prepared the draft: "Convert ${CF.reference} to a contract" showed ${F.required.name} "${cost}" with Unverified. Converted unchanged to C-${cn}; the Contract keeps that value Unverified (keys ${JSON.stringify(carriedKeys)}). With the stand-in breaking replies, the Fields header offered Retry Request-context Analysis ("${failure.trim()}"). After the stand-in recovered, Retry Request-context Analysis filled ${F.recordC.name} "${done.customFields[F.recordC.slug]}".`;
    },
  );
}

// ======================= ACCESS =======================
async function access() {
  await step(
    "triage-requests",
    "business_user",
    "Business Users cannot open or triage the Inbox",
    "Inbox redirects to the Portal; staff Request list, detail, assignment and convert API refused",
    async () => {
      const out = [];
      const n = reqs[`${ROLES[0]}:triage-review`].number;
      const keys = [...new Set(ROLES.map((r) => reqs[`${r}:triage-review`].requester))];
      for (const key of keys) {
        const bp = await portalPage(key);
        await bp.goto(`${BASE}/inbox`);
        await pause(2500);
        const landed = new URL(bp.url()).pathname;
        const list = await bp.request.get(`${BASE}/api/v1/requests?limit=1`);
        const detail = await bp.request.get(`${BASE}/api/v1/requests/${n}`);
        const assign = await bp.request.patch(`${BASE}/api/v1/requests/${n}/assignee`, { data: { assigneeId: null }, headers: { origin: BASE } });
        const conv = await bp.request.post(`${BASE}/api/v1/requests/${n}/convert`, { data: { title: "DOC-030 inbox refused" }, headers: { origin: BASE } });
        await bp.goto(`${BASE}/inbox/${n}`);
        await pause(2000);
        const landed2 = new URL(bp.url()).pathname;
        expectThat(!landed.startsWith("/inbox") && !landed2.startsWith("/inbox"), `${key} opened the Inbox`);
        expectThat(list.status() === 403 && detail.status() >= 400 && assign.status() >= 400 && conv.status() >= 400, `${key} API ${list.status()} ${detail.status()} ${assign.status()} ${conv.status()}`);
        out.push(`${PEOPLE[key].name}: /inbox landed on ${landed}, /inbox/${n} on ${landed2}; staff list API ${list.status()}, Request detail ${detail.status()}, assignment ${assign.status()}, convert ${conv.status()}`);
      }
      return `${out.join("; ")}.`;
    },
  );
}

try {
  for (const role of ROLES) {
    if (PHASES.includes("triage")) await triage(role);
    if (PHASES.includes("convert")) await convert(role);
    if (PHASES.includes("ai-record")) {
      const pairs = Object.fromEntries(
        (process.env.AI_RECORD_MATTERS ?? "").split(",").map((p) => p.split(":")),
      );
      if (pairs[role]) await recordRowStep(role, Number(pairs[role]));
    }
    if (PHASES.includes("ai")) {
      if (LAB !== "inboxai") throw new Error("The ai phase runs only on the inboxai lab.");
      await aiPhase(role);
    }
  }
  if (PHASES.includes("access")) await access();
} finally {
  log.articleHashesAtEnd = {
    "triage-requests": articleHash("triage-requests"),
    "convert-request": articleHash("convert-request"),
  };
  save();
  await browser.close();
}
const failed = log.steps.filter((s) => s.result !== "pass");
console.log(`${log.steps.length} steps, ${failed.length} not passed`);
