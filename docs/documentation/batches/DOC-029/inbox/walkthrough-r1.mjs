// DOC-029 inbox group, round 1: independent browser walkthrough of
//   docs/user-guides/triage-requests.md (V-C12) and docs/user-guides/convert-request.md (V-C13)
// on the shared work lab built from app commit 3fa407e3a846559914aa1a63249741f30cfb4f69.
// Written by the DOC-029 independent walkthrough agent (inbox, round 1) from the guide text.
//
// Prerequisites, run once from the worktree root:
//   mise exec -- node docs/documentation/batches/DOC-029/inbox/setup-config-r1.mjs
//   mise exec -- node docs/documentation/batches/DOC-029/inbox/setup-requests-r1.mjs
// Run (LAB_PASSWORD set in the environment):
//   LAB_PASSWORD=... mise exec -- node docs/documentation/batches/DOC-029/inbox/walkthrough-r1.mjs
// Env: PHASES=triage,convert,access (default all), ROLES=administrator,legal_team_member, OUT=<path>.
// The seed demo password comes only from LAB_PASSWORD; magic links, cookies and raw mail are never written.
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
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

const { chromium } = await import(PW_PATH);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const fx = JSON.parse(readFileSync(path.join(here, "fixtures-r1.json"), "utf8"));
const reqs = JSON.parse(readFileSync(path.join(here, "requests-r1.json"), "utf8")).requests;
const OUT = process.env.OUT ?? path.join(here, "walkthrough-r1.json");
const PHASES = (process.env.PHASES ?? "triage,convert,access").split(",");
const ROLES = (process.env.ROLES ?? "administrator,legal_team_member").split(",");
const PROJECT = "openlaw-docs-41255c61-work";
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const articleHash = (id) => sha(readFileSync(path.join(root, "docs/user-guides", `${id}.md`)));

function imageId(container) {
  try {
    return execSync(`docker inspect --format '{{.Image}}' ${container}`).toString().trim();
  } catch {
    return null;
  }
}

const log = {
  kind: "independent-article-walkthrough",
  task: "DOC-029",
  group: "inbox",
  round: 1,
  issues: [745, 747],
  independentReview: true,
  walkthroughReviewer: "DOC-029 independent walkthrough agent (inbox, round 1)",
  reviewerKind: "agent",
  method: "browser-walkthrough",
  appCommit: "3fa407e3a846559914aa1a63249741f30cfb4f69",
  environment: PROJECT,
  appUrl: BASE,
  mailUrl: MAIL,
  containerImages: {
    app: imageId(`${PROJECT}-app-1`),
    worker: imageId(`${PROJECT}-worker-1`),
    "doc-engine": imageId(`${PROJECT}-doc-engine-1`),
  },
  browser:
    "Playwright 1.63.0 Chromium from node_modules, headless, 1440x1000; one isolated browser context per identity",
  articleHashesAtStart: {
    "triage-requests": articleHash("triage-requests"),
    "convert-request": articleHash("convert-request"),
  },
  phases: PHASES,
  roles: ROLES,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  steps: [],
  records: [],
};
function save() {
  log.finishedAt = new Date().toISOString();
  writeFileSync(OUT, JSON.stringify(log, null, 2));
}
const ARTICLE_SCENARIO = { "triage-requests": "V-C12", "convert-request": "V-C13" };
async function step(article, role, name, expected, fn) {
  const entry = {
    article,
    scenario: ARTICLE_SCENARIO[article],
    role,
    method: "browser-walkthrough",
    step: name,
    expected,
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
  await page.screenshot({ path: path.join(here, `r1-${name}.png`) });
  return `docs/documentation/batches/DOC-029/inbox/r1-${name}.png`;
};

// ---------- sessions ----------
const api = {
  administrator: await apiSignIn(PEOPLE.administrator.email),
  legal_team_member: await apiSignIn(PEOPLE.legal_team_member.email),
};
const other = (role) => (role === "administrator" ? "legal_team_member" : "administrator");
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
  if (file) await page.locator('input[type="file"]').last().setInputFiles(file);
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

const URGENCY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };

// ======================= TRIAGE (V-C12) =======================
async function triage(role) {
  const A = "triage-requests";
  const page = await staffPage(role);
  const otherRole = other(role);
  const otherPage = await staffPage(otherRole);
  const jonas = await portalPage("business_user");
  const T = reqs[`${role}:triage-review`];
  const Rz = reqs[`${role}:triage-resolve`];
  const Rc = reqs[`${role}:triage-race`];
  const me = PEOPLE[role].name;
  const them = PEOPLE[otherRole].name;

  await step(
    A,
    role,
    "Open Inbox: Requests tab first, built-in view Status: New, ordered by urgency then age",
    "Requests tab is the current tab; Status: New chip; rows sorted by urgency then oldest first",
    async () => {
      await page.goto(`${BASE}/inbox`);
      await page.getByRole("button", { name: "Status: New" }).waitFor({ timeout: 20000 });
      const current = await page
        .locator('a[aria-current="page"]')
        .filter({ hasText: /^Requests \(/ })
        .count();
      expectThat(current === 1, "Requests tab is not the current tab");
      const tabs = await page
        .locator("main a")
        .filter({ hasText: /^(Requests|Unassigned contracts) \(/ })
        .allInnerTexts();
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
        rows.every((r) => r.status === "new"),
        "a non-New row is listed",
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
      return `Tabs ${tabs.join(" and ")}; Requests current; Status: New chip shown; ${rows.length} first-page rows all New and ordered by urgency, then by submission time oldest first.`;
    },
  );

  await step(
    A,
    role,
    `Open ${T.reference} and read Description, Form responses, Attachments, Converts to, Requester, Department, Urgency`,
    "All named facts visible on the Request page",
    async () => {
      const row = await inboxRow(page, T.reference);
      await row.getByRole("link").first().click();
      await page.waitForURL(`**/inbox/${T.number}`);
      await page.getByText("Form responses", { exact: true }).waitFor();
      const text = await mainText(page);
      for (const needle of [
        "Description",
        "Form responses",
        "Attachments",
        "Converts to",
        "Contract · DOC-029 inbox Supplier agreement",
        "Requester",
        "Jonas Weber",
        "Department",
        "Engineering",
        "Urgency",
        "High",
        "Northwind Fictional Supplies",
        "Budget note stays on the Request",
        T.files[0].name,
        T.files[1].name,
      ]) {
        expectThat(text.includes(needle), `missing ${needle}`);
      }
      return `Opened from the list row link. Page shows Requester Jonas Weber, Converts to Contract · DOC-029 inbox Supplier agreement, Department Engineering, Urgency High, Description, two Form responses, and Attachments ${T.files.map((f) => f.name).join(", ")}.`;
    },
  );

  await step(
    A,
    role,
    "Select attachment filenames: PDF displays, Word file is prepared for reading, Download saves the original bytes",
    "Viewer shows PDF and Word text; Download bytes equal the stored original",
    async () => {
      const detail = await getReq(T.number, role);
      const out = [];
      for (const att of detail.attachments) {
        const original = await api[role].request(
          "GET",
          `/api/v1/requests/${T.number}/attachments/${att.id}`,
          {},
        );
        await page.getByRole("button", { name: att.filename, exact: true }).click();
        const viewer = page.getByRole("dialog");
        const expectedText = att.filename.endsWith(".pdf")
          ? "Fictional attachment"
          : "Fictional Word attachment";
        await viewer.getByText(expectedText, { exact: false }).first().waitFor({ timeout: 60000 });
        const [download] = await Promise.all([
          page.waitForEvent("download"),
          viewer.getByRole("link", { name: "Download" }).click(),
        ]);
        const bytes = readFileSync(await download.path());
        const direct = await page.request.get(
          `${BASE}/api/v1/requests/${T.number}/attachments/${att.id}`,
        );
        const directBytes = Buffer.from(await direct.body());
        expectThat(
          sha(bytes) === sha(directBytes),
          `download of ${att.filename} differs from the stored original`,
        );
        expectThat(
          bytes.length === T.files.find((f) => f.name === att.filename).bytes,
          `download of ${att.filename} differs in size from the submitted file`,
        );
        if (att.filename.endsWith(".pdf")) await shot(page, `${role}-viewer-pdf`);
        await page.keyboard.press("Escape");
        await viewer.waitFor({ state: "hidden" });
        out.push(
          `${att.filename} opened in the viewer with its text and downloaded ${bytes.length} bytes identical to the submitted file`,
        );
        void original;
      }
      return out.join("; ") + ".";
    },
  );

  await step(
    A,
    role,
    `Assign ${T.reference} from the list row: Search people, choose ${them}, Save assignment; status stays New; the other legal session still has Triage`,
    "Row and Request page show the saved assignee; status New; other session sees Triage",
    async () => {
      await page.goto(`${BASE}/inbox`);
      const row = await inboxRow(page, T.reference);
      await row.getByRole("button", { name: `Assign ${T.reference}` }).click();
      const dialog = page.getByRole("dialog", { name: `Assign ${T.reference} for triage` });
      await dialog.waitFor();
      const listed = (await dialog.locator("fieldset label").allInnerTexts()).map((t) =>
        t.replace(/^[A-Z]{2}\s*/, "").trim(),
      );
      expectThat(
        !listed.some((n) => /Ravi Menon|Jonas Weber|Amara Nwosu/.test(n)),
        `non-legal person offered: ${listed.join(", ")}`,
      );
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
      expectThat(
        r.assignee?.displayName === them && r.status === "new",
        "assignment not saved or status changed",
      );
      await gotoRequest(page, T.number);
      await page.getByRole("button", { name: `Reassign ${T.reference}: ${them}` }).waitFor();
      await gotoRequest(otherPage, T.number);
      await otherPage.getByRole("button", { name: "Triage", exact: true }).waitFor();
      return `Dialog offered only staff (${listed.filter(Boolean).join(", ")}); searched "${them.split(" ")[0]}", chose ${them}, saved. Row and Request page read "Reassign ${T.reference}: ${them}"; API status new; ${them}'s own session still shows Triage on ${T.reference}.`;
    },
  );

  await step(
    A,
    role,
    "Portal shows the saved triage assignee as Owner",
    `Jonas's Portal page reads Owner: ${them}`,
    async () => {
      const { text } = await portalText(jonas, T.number);
      expectThat(text.includes(`Owner: ${them}`), `Portal text lacks Owner: ${them}`);
      return `Jonas Weber's Portal page for ${T.reference} reads "Owner: ${them}".`;
    },
  );

  await step(
    A,
    role,
    "Reassign from the avatar control; Cancel leaves the saved assignment; Unassigned clears it and the Portal shows Not assigned yet",
    "Cancel no change; Unassigned saves null; Portal Owner: Not assigned yet",
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
      expectThat(r.assignee === null && r.status === "new", "clear not saved");
      const { text } = await portalText(jonas, T.number);
      expectThat(
        text.includes("Owner: Not assigned yet"),
        "Portal does not read Owner: Not assigned yet",
      );
      return `Cancel after choosing ${me} kept ${them}; reassigning to ${me} saved; choosing Unassigned and Save assignment cleared it (button reads Assign ${T.reference}, status new); Portal reads "Owner: Not assigned yet".`;
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
      return `Aborted people load showed "People could not be loaded." with Retry; Retry listed people. A 503 save showed "${alertText}"; reopening the Request showed it still unassigned.`;
    },
  );

  await step(
    A,
    role,
    "Clarify through Comments: audience starts on Legal only; Shared with requester reaches Jonas; Legal only does not; Request stays New",
    "Default Legal only; shared text on Portal; legal-only text absent; status new",
    async () => {
      await gotoRequest(page, T.number);
      await openComments(page);
      const checked = await page
        .locator('input[name="comment-tier"]:checked')
        .getAttribute("value");
      expectThat(checked === "legal_only", `composer starts on ${checked}`);
      const legalText = `DOC-029 inbox ${role} legal only note ${Date.now()}`;
      const sharedText = `DOC-029 inbox ${role} question for the requester ${Date.now()}`;
      await postComment(page, null, legalText);
      await postComment(page, "Shared with requester", sharedText);
      const { text } = await portalText(jonas, T.number);
      expectThat(text.includes(sharedText), "shared comment missing on Portal");
      expectThat(!text.includes(legalText), "Legal only comment visible on Portal");
      const r = (await getReq(T.number)).request;
      expectThat(r.status === "new", "status changed after comments");
      return `Composer started on Legal only; posted a Legal only note and a Shared with requester question with Comment. Jonas's Portal page shows the question only; status stays new.`;
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
      return `Menu items: ${items.join(" | ")}.`;
    },
  );

  await step(
    A,
    role,
    `Resolve ${Rz.reference}: blank note refused; Cancel leaves it undecided with nothing posted`,
    "Refusal message; status new; no comment",
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
      const refusal = (
        await dialog
          .getByText("Explain why this request is being resolved without converting.")
          .first()
          .innerText()
      ).trim();
      await dialog.getByRole("textbox").fill("DOC-029 inbox note typed then cancelled");
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      const detail = await getReq(Rz.number);
      expectThat(detail.request.status === "new", "Cancel decided the Request");
      const comments = await commentsOn("request", Rz.id);
      expectThat(
        !comments.some((c) => (c.body ?? "").includes("typed then cancelled")),
        "cancelled note posted",
      );
      return `Dialog "Resolve ${Rz.reference} without converting" with Resolution note (required); an empty submit showed "${refusal}"; Cancel with typed text left status new and posted nothing.`;
    },
  );

  let resolveNote;
  await step(
    A,
    role,
    `Assign ${Rz.reference} to ${them}, then resolve it as ${me} with a note: Status card Resolved, note in Comments, assignee kept read-only, controls gone`,
    "Assignment does not reserve; Resolved; note in Comments; no Assign/Triage",
    async () => {
      await gotoRequest(page, Rz.number);
      await page.getByRole("button", { name: `Assign ${Rz.reference}` }).click();
      const ad = page.getByRole("dialog", { name: `Assign ${Rz.reference} for triage` });
      await ad.locator("fieldset label").filter({ hasText: them }).click();
      await ad.getByRole("button", { name: "Save assignment" }).click();
      await ad.waitFor({ state: "hidden" });
      resolveNote = `DOC-029 inbox ${role} resolution: no contract is needed, use the standard purchase order ${Date.now()}`;
      await page.getByRole("button", { name: "Triage", exact: true }).click();
      await page.getByRole("menuitem", { name: "Resolve request without converting" }).click();
      const dialog = page.getByRole("dialog", {
        name: `Resolve ${Rz.reference} without converting`,
      });
      const notice = await dialog
        .getByText("This goes on the request's thread, and to the requester by email.")
        .count();
      await dialog.getByRole("textbox").fill(resolveNote);
      log.resolveTimes = log.resolveTimes ?? {};
      log.resolveTimes[Rz.reference] = Date.now();
      await dialog.getByRole("button", { name: "Resolve request" }).click();
      await dialog.waitFor({ state: "hidden" });
      const statusCard = page.locator('[aria-labelledby="inbox-request-outcome-heading"]');
      await statusCard.getByText("Resolved").first().waitFor({ timeout: 15000 });
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
      expectThat(
        (await page.getByRole("img", { name: them }).count()) > 0,
        "assignee not shown read-only",
      );
      await openComments(page);
      await page.getByText(resolveNote).first().waitFor();
      const text = await mainText(page);
      expectThat(
        text.includes("Attachments") &&
          text.includes("Form responses") &&
          text.includes(Rz.files[0].name),
        "resolved Request lost submitted information or attachments",
      );
      await shot(page, `${role}-resolved`);
      return `Saved ${them} as assignee, then ${me} resolved it (assignment did not reserve it). Dialog notice present: ${notice > 0}. Status card reads Resolved; Assign and Triage are gone; ${them} shows as read-only avatar; Comments contains the note; Form responses and the ${Rz.files[0].name} attachment remain.`;
    },
  );

  await step(
    A,
    role,
    `Requester reads the resolution note on the Portal, receives the email, and a later reply does not reopen ${Rz.reference}`,
    "Note on Portal; email arrives; status stays resolved after reply",
    async () => {
      const { text } = await portalText(jonas, Rz.number);
      expectThat(text.includes(resolveNote), "note missing on Portal");
      const mail = await waitForMail(
        PEOPLE.business_user.email,
        new RegExp(`resolved.*R-${Rz.number}\\b|R-${Rz.number}\\b.*resolved`, "i"),
        log.resolveTimes[Rz.reference],
        60000,
      );
      const replyText = `DOC-029 inbox Jonas thanks for ${Rz.reference} ${Date.now()}`;
      const composer = jonas.getByRole("textbox", { name: "New comment" });
      await composer.fill(replyText);
      await jonas.getByRole("button", { name: "Comment", exact: true }).click();
      await jonas.getByText(replyText).first().waitFor({ timeout: 15000 });
      const r = (await getReq(Rz.number)).request;
      expectThat(r.status === "resolved", `status after reply: ${r.status}`);
      return `Portal page shows the resolution note; ${mail ? `mail "${mail.subject.replace(/\s+/g, " ")}" reached Jonas in the lab Mailpit` : "no resolution email was found within 60 seconds"}; Jonas's reply posted and the Request stayed resolved.`;
    },
  );

  await step(
    A,
    role,
    `Lost race on ${Rc.reference}: ${them} resolves while the dialog is open; dialog states their outcome with Close; the losing note is not posted`,
    "Somebody else already resolved this request.; Close; only the winning note",
    async () => {
      await gotoRequest(page, Rc.number);
      await page.getByRole("button", { name: "Triage", exact: true }).click();
      await page.getByRole("menuitem", { name: "Resolve request without converting" }).click();
      const dialog = page.getByRole("dialog", {
        name: `Resolve ${Rc.reference} without converting`,
      });
      const winning = `DOC-029 inbox ${otherRole} winning resolution ${Date.now()}`;
      const losing = `DOC-029 inbox ${role} losing resolution ${Date.now()}`;
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
      await page
        .locator('[aria-labelledby="inbox-request-outcome-heading"]')
        .getByText("Resolved")
        .first()
        .waitFor({ timeout: 15000 });
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
    "Find decided Requests: Status filter Resolved lists them; removing the Status filter lists all outcomes",
    `${Rz.reference} appears under Resolved and without the Status filter; not in the New view`,
    async () => {
      await page.goto(`${BASE}/inbox`);
      await page.getByRole("button", { name: "Status: New" }).waitFor();
      expectThat(
        (await (await inboxRow(page, Rz.reference)).count()) === 0,
        "resolved Request still in the New view",
      );
      await page.getByRole("button", { name: "Remove Status filter" }).click();
      await pause(1500);
      const rowAll = await inboxRow(page, Rz.reference);
      expectThat((await rowAll.count()) === 1, "not listed without the Status filter");
      await page
        .getByRole("button", { name: /^Filter/ })
        .first()
        .click();
      await page.getByText("Status", { exact: true }).last().click();
      await page.getByRole("checkbox", { name: "Resolved" }).click();
      await page.getByRole("button", { name: "Apply" }).click();
      await page.getByRole("button", { name: /Status: Resolved/ }).waitFor();
      const rowRes = await inboxRow(page, Rz.reference);
      expectThat((await rowRes.count()) === 1, "not listed under Status: Resolved");
      return `New view omitted ${Rz.reference}; Remove Status filter listed it; Filter > Status > Resolved > Apply showed the Status: Resolved chip and listed it.`;
    },
  );

  await step(
    A,
    role,
    "Historical Declined Request shows its reason and no Assign or Triage controls",
    "Status: Declined lists a seeded declined Request; its Status card shows Declined and the reason",
    async () => {
      await page.goto(`${BASE}/inbox`);
      await page.getByRole("button", { name: "Status: New" }).click();
      const pop = page.getByRole("dialog").last();
      await page.getByRole("checkbox", { name: "New" }).click();
      await page.getByRole("checkbox", { name: "Declined" }).click();
      await page.getByRole("button", { name: "Apply" }).click();
      await page.getByRole("button", { name: /Status: Declined/ }).waitFor();
      void pop;
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
      const card = page.locator('[aria-labelledby="inbox-request-outcome-heading"]');
      await card.getByText("Declined").first().waitFor();
      const cardText = (await card.innerText()).replace(/\s+/g, " ");
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
      return `Status: Declined listed ${refs.join(", ")}; ${refs[0]} Status card reads "${cardText.slice(0, 160)}"; no Triage or Assign controls.`;
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

async function convert(role) {
  const A = "convert-request";
  const T = "triage-requests";
  const page = await staffPage(role);
  const otherRole = other(role);
  const jonas = await portalPage("business_user");
  const amara = await portalPage("second_business_user");
  const Cc = reqs[`${role}:conv-contract`];
  const Cm = reqs[`${role}:conv-matter`];
  const Crt = reqs[`${role}:conv-retarget`];
  const Crace = reqs[`${role}:conv-race`];
  const Cst = reqs[`${role}:conv-stale`];
  const me = PEOPLE[role].name;
  const them = PEOPLE[otherRole].name;
  const F = fx.fields;
  const neededBy = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  const originals = {};

  await step(
    A,
    role,
    `Before converting ${Cc.reference} and ${Cm.reference}: assign ${them} for triage and post a Legal only note and a Shared with requester message with paper`,
    "Comments posted with attachments; Jonas sees only the shared one",
    async () => {
      const out = [];
      for (const R of [Cc, Cm]) {
        await api[role].patch(`/api/v1/requests/${R.number}/assignee`, {
          assigneeId: await userId(otherRole),
        });
        await gotoRequest(page, R.number);
        const legalFile = path.join(here, "fixtures", `r1-${role}-${R.number}-legal-paper.pdf`);
        const sharedFile = path.join(here, "fixtures", `r1-${role}-${R.number}-shared-paper.pdf`);
        const { makePdf } = await import("../../../../../scripts/seed/files.mjs");
        const { mkdirSync } = await import("node:fs");
        mkdirSync(path.join(here, "fixtures"), { recursive: true });
        writeFileSync(
          legalFile,
          makePdf(`DOC-029 inbox legal paper ${R.reference}`, ["Fictional internal note paper."]),
        );
        writeFileSync(
          sharedFile,
          makePdf(`DOC-029 inbox shared paper ${R.reference}`, [
            "Fictional paper shared with the requester.",
          ]),
        );
        const legalText = `DOC-029 inbox ${role} legal only before conversion ${R.reference}`;
        const sharedText = `DOC-029 inbox ${role} shared before conversion ${R.reference}`;
        await postComment(page, "Legal only", legalText, legalFile);
        await postComment(page, "Shared with requester", sharedText, sharedFile);
        const { text } = await portalText(jonas, R.number);
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
          `${R.reference}: assignee ${them}; Legal only and Shared with requester comments with PDFs posted; Portal shows only the shared one`,
        );
      }
      return out.join("; ") + ".";
    },
  );

  await step(
    A,
    role,
    `Open ${Cc.reference} Triage > Convert to contract with preparation off: manual Convert dialog opens directly`,
    "No Getting contract ready, no Description box, no Unverified markers; Title, Type, Priority from Urgency, Counterparty, Needed by, carried Field, stay list, required Field, archived Entity note",
    async () => {
      const r = await api.administrator.get("/api/v1/ai-connector");
      const c = r.body.connector;
      expectThat(
        !c.contractPreparation && !c.matterPreparation && !c.contractConversionAnalysis,
        "AI switches are not all off in this lab",
      );
      await openConvert(page, Cc.number, "contract");
      const dialog = dialogFor(page, Cc.reference, "contract");
      await dialog.waitFor({ timeout: 15000 });
      const text = (await dialog.innerText()).replace(/\s+/g, " ");
      expectThat(
        !/Getting contract ready/.test(await page.locator("body").innerText()),
        "preparation shown",
      );
      expectThat(
        (await dialog.getByLabel("Description").count()) === 0,
        "Description box present in manual conversion",
      );
      expectThat(!text.includes("Unverified"), "Unverified marker present");
      expectThat(
        (await dialog.getByLabel(/^Title/).inputValue()) === Cc.title,
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
        (await dialog.getByLabel(F.carry.name).inputValue()).startsWith(
          "Northwind Fictional Supplies",
        ),
        "carried answer missing",
      );
      expectThat(
        text.includes("Does not carry into the contract") && text.includes(F.stay.name),
        "stay list missing",
      );
      expectThat(
        text.includes(`${fx.entities.old.name} is archived. Pick a live entity to convert.`),
        "archived Entity note missing",
      );
      expectThat(
        text.includes("Counterparty") && text.includes("Needed by"),
        "Counterparty or Needed by missing",
      );
      const liveOptions = await dialog.locator(`#convert-${F.entity.slug} option`).allInnerTexts();
      expectThat(!liveOptions.includes(fx.entities.old.name), "archived Entity offered");
      await shot(page, `${role}-convert-contract-dialog`);
      return `AI connector switches all off. Dialog "Convert ${Cc.reference} to a contract" opened directly with no preparation and no Description box. Title = Request title; Contract type = ${fx.contractType.name}; Priority High; Counterparty and Needed by boxes; ${F.carry.name} prefilled; "Does not carry into the contract" lists ${F.stay.name}; required ${F.required.name} empty; "${fx.entities.old.name} is archived. Pick a live entity to convert."; the Entity picker does not offer the archived Entity. No Unverified marker.`;
    },
  );

  await step(
    A,
    role,
    "Refusals: empty Title, empty required Field, and the archived reference are refused by name; Cancel leaves the Request undecided",
    "Named refusals; status new after Cancel",
    async () => {
      const dialog = dialogFor(page, Cc.reference, "contract");
      const submit = dialog.getByRole("button", { name: "Convert to contract", exact: true });
      const title = dialog.getByLabel(/^Title/);
      await title.fill("");
      await submit.click();
      const t1 = (await dialog.getByRole("alert").first().innerText()).trim();
      await title.fill(Cc.title);
      await submit.click();
      await pause(800);
      const t2 = (await dialog.getByRole("alert").first().innerText()).trim();
      await dialog.getByLabel(F.required.name).fill(`CC-${role}-001`);
      await submit.click();
      await pause(800);
      const t3 = (await dialog.getByRole("alert").first().innerText()).trim();
      expectThat(/Name the contract/.test(t1), `title refusal: ${t1}`);
      expectThat(t2.includes(F.required.name), `required refusal: ${t2}`);
      expectThat(t3.includes(F.entity.name), `archived refusal: ${t3}`);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      const r = (await getReq(Cc.number)).request;
      expectThat(r.status === "new", "Cancel decided the Request");
      return `Empty Title: "${t1}". Empty required Field: "${t2}". Archived Entity: "${t3}". Cancel closed the dialog and the Request stayed new.`;
    },
  );

  let contractNumber;
  let typeChangeNote = "";
  await step(
    A,
    role,
    `Convert ${Cc.reference}: replace the archived Entity with a live one, answer the required Field, set Needed by, and convert once`,
    "One Contract; Request Converted with C- link and Converted by; no Triage",
    async () => {
      await openConvert(page, Cc.number, "contract");
      const dialog = dialogFor(page, Cc.reference, "contract");
      await dialog.waitFor();
      await dialog.getByLabel(F.required.name).fill(`CC-${role}-001`);
      await dialog.locator("#convert-type").selectOption({ label: "NDA" });
      await pause(800);
      const onNda = await dialog.getByLabel(F.required.name).count();
      await dialog.locator("#convert-type").selectOption(fx.contractType.id);
      await pause(800);
      const keptAfterTypeChange = await dialog.getByLabel(F.required.name).inputValue();
      typeChangeNote = `Changing Contract type to NDA ${onNda ? "kept" : "removed"} the ${F.required.name} box; back on ${fx.contractType.name} it read "${keptAfterTypeChange}".`;
      if (keptAfterTypeChange !== `CC-${role}-001`)
        await dialog.getByLabel(F.required.name).fill(`CC-${role}-001`);
      await dialog
        .locator(`#convert-${F.entity.slug}`)
        .selectOption({ label: fx.entities.live.name });
      await dialog.locator("#convert-needed-by").fill(neededBy);
      await dialog.getByRole("button", { name: "Convert to contract", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      const card = page.locator('[aria-labelledby="inbox-request-outcome-heading"]');
      await card.getByText("Converted").first().waitFor({ timeout: 15000 });
      const detail = await getReq(Cc.number);
      expectThat(
        detail.request.status === "converted" &&
          detail.request.convertedRecord?.module === "contract",
        "not converted to a contract",
      );
      contractNumber = detail.request.convertedRecord.number;
      log.records.push({ role, request: Cc.reference, record: `C-${contractNumber}` });
      const cardText = (await card.innerText()).replace(/\s+/g, " ");
      expectThat(
        cardText.includes(`C-${contractNumber}`) && cardText.includes(`Converted by ${me}`),
        `Status card: ${cardText}`,
      );
      const list =
        (await api[role].get(`/api/v1/contracts?q=${encodeURIComponent(Cc.title)}&limit=10`)).body
          .contracts ?? [];
      const same = list.filter((c) => c.title === Cc.title);
      expectThat(same.length === 1, `contracts with this title: ${same.length}`);
      expectThat(
        (await page.getByRole("button", { name: "Triage", exact: true }).count()) === 0,
        "Triage still offered",
      );
      return `${typeChangeNote} Converted. Status card: "${cardText}". Exactly one Contract carries the title (C-${contractNumber}).`;
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
      expectThat(
        text.includes("Description") && text.includes("Form responses"),
        "Description or Form responses missing",
      );
      expectThat(!text.includes("Attachments"), "Attachments card shown");
      expectThat(
        (await page.getByRole("button", { name: /^Comments( \(\d+\))?$/ }).count()) === 0,
        "Comments applet present",
      );
      expectThat((await page.getByRole("img", { name: them }).count()) > 0, "assignee not kept");
      expectThat(
        (await page.getByRole("button", { name: "Triage", exact: true }).count()) === 0,
        "Triage offered",
      );
      const link = page
        .locator('[aria-labelledby="inbox-request-outcome-heading"]')
        .getByRole("link", { name: `C-${contractNumber}` });
      expectThat((await link.count()) === 1, "no C- link on the Status card");
      await shot(page, `${role}-converted-request`);
      return `Converted ${Cc.reference} shows Description, Form responses, read-only assignee ${them}, a C-${contractNumber} link on the Status card, no Attachments card, no Comments control, and no Triage or Assign.`;
    },
  );

  await step(
    A,
    role,
    `Open C-${contractNumber} from the Status card and check Title, Type, Priority, Description, Department, Needed by Key date, Fields, owners, team, Risk`,
    "Values as the guide states",
    async () => {
      await page
        .locator('[aria-labelledby="inbox-request-outcome-heading"]')
        .getByRole("link", { name: `C-${contractNumber}` })
        .click();
      await page.waitForURL(`**/contracts/${contractNumber}**`);
      await page.waitForLoadState("networkidle").catch(() => {});
      const { body } = await api[role].get(`/api/v1/contracts/${contractNumber}`);
      const c = body.contract;
      const req = (await getReq(Cc.number)).request;
      expectThat(c.title === Cc.title, "Title");
      expectThat(c.contractTypeId === fx.contractType.id, "Type");
      expectThat(c.priority === "high", `Priority ${c.priority}`);
      expectThat(c.risk === null, "Risk set");
      expectThat(c.description === req.description, "Description differs from the Request");
      expectThat(
        c.owningDepartment === req.department,
        `Department ${c.owningDepartment} vs ${req.department}`,
      );
      expectThat(c.manager?.displayName === me, `Legal Owner ${c.manager?.displayName}`);
      expectThat(c.businessOwner?.displayName === "Jonas Weber", "Business Owner");
      const team = body.team.map((t) => t.displayName);
      expectThat(team.includes("Jonas Weber"), "Requester not on team");
      if (fx.contractTypeDefaultPerson)
        expectThat(
          team.includes(fx.contractTypeDefaultPerson),
          "Contract Type default person not on team",
        );
      expectThat(
        !team.includes(them) || them === fx.contractTypeDefaultPerson,
        "triage assignee joined the team",
      );
      expectThat(
        c.customFields[F.carry.slug]?.startsWith("Northwind Fictional Supplies"),
        "carried Field missing",
      );
      expectThat(
        c.customFields[F.required.slug] === `CC-${role}-001`,
        "typed required Field missing",
      );
      expectThat(c.customFields[F.entity.slug] === fx.entities.live.id, "live Entity missing");
      expectThat(!(F.stay.slug in c.customFields), "request-only answer carried");
      const kd =
        (await api[role].get(`/api/v1/contracts/${contractNumber}/key-dates`)).body.deadlines ?? [];
      const nb = kd.find((d) => /Needed by/i.test(d.label ?? d.title ?? ""));
      expectThat(
        nb && JSON.stringify(nb).includes(neededBy),
        `Needed by Key date missing: ${JSON.stringify(kd).slice(0, 200)}`,
      );
      expectThat(
        req.customFields[F.stay.slug] && req.department && req.description,
        "Request lost its answers",
      );
      const overview = await mainText(page);
      expectThat(
        overview.includes("Legal Owner") &&
          overview.includes(me) &&
          overview.includes("Business Owner") &&
          overview.includes("Jonas Weber"),
        "owners not visible",
      );
      expectThat(
        overview.includes("Current") && overview.includes("Requester"),
        "Current / Requester switch missing",
      );
      await page.getByRole("link", { name: /^Fields/ }).click();
      await page.waitForLoadState("networkidle").catch(() => {});
      await pause(1000);
      const fieldsText = await mainText(page);
      expectThat(
        fieldsText.includes(F.carry.name) && fieldsText.includes(F.required.name),
        "Fields tab lacks the Fields",
      );
      await page.getByRole("link", { name: /^Key dates/ }).click();
      await pause(1500);
      expectThat((await mainText(page)).includes("Needed by"), "Needed by not on Key dates tab");
      return `C-${contractNumber}: Title and Type as confirmed, Priority high, Risk unset, Description equals the Request's, Department ${c.owningDepartment}, Legal Owner ${me} (not the triage assignee ${them}), Business Owner Jonas Weber, team ${team.join(", ")}; Fields tab shows ${F.carry.name} (carried), ${F.required.name} (typed) and the live Entity; ${F.stay.name} did not carry; Key dates shows Needed by ${neededBy}. Overview shows the Current / Requester switch. The Request keeps its answers, Department and Description.`;
    },
  );

  await step(
    A,
    role,
    `C-${contractNumber} Documents: each Request attachment is a root Document at Version 1 with its bytes; the first is primary; comment paper is not filed; comments keep tiers and authors`,
    "Two Documents; primary set; comments moved with tiers",
    async () => {
      const docs =
        (await api[role].get(`/api/v1/contracts/${contractNumber}/documents`)).body.documents ?? [];
      const names = docs.map((d) => d.title ?? d.filename ?? d.name);
      const orig = originals[Cc.number];
      expectThat(docs.length === orig.length, `document count ${docs.length}`);
      const details = [];
      for (const o of orig) {
        const d = docs.find((x) => JSON.stringify(x).includes(o.filename));
        expectThat(d, `no Document for ${o.filename}`);
        expectThat(!d.folderId, `${o.filename} not at the root`);
        const versions = d.versions ?? [];
        expectThat(versions.length === 1, `${o.filename} versions ${versions.length}`);
        const dl = await page.request.get(
          `${BASE}/api/v1/documents/${d.id}/versions/${versions[0].id}/download`,
        );
        const got = sha(Buffer.from(await dl.body()));
        expectThat(got === o.sha, `${o.filename} bytes differ`);
        details.push({ file: o.filename, primary: Boolean(d.isPrimary ?? d.primary) });
      }
      const primary = docs.filter((d) => d.isPrimary ?? d.primary);
      expectThat(
        primary.length === 1 && JSON.stringify(primary[0]).includes(orig[0].filename),
        `primary: ${JSON.stringify(details)}`,
      );
      expectThat(
        !names.some((n) => /legal-paper|shared-paper/.test(n ?? "")),
        "comment paper became a Document",
      );
      const cid = (await api[role].get(`/api/v1/contracts/${contractNumber}`)).body.contract.id;
      const comments = await commentsOn("contract", cid, role);
      const legal = comments.find((c) => (c.body ?? "").includes("legal only before conversion"));
      const shared = comments.find((c) => (c.body ?? "").includes("shared before conversion"));
      expectThat(
        legal?.visibility === "legal_only" && shared?.visibility === "full_thread",
        "tiers not kept",
      );
      expectThat((legal.author?.displayName ?? legal.authorName) === me, "author identity changed");
      expectThat(
        (legal.attachments ?? []).length === 1 && (shared.attachments ?? []).length === 1,
        "comment paper did not stay on the comments",
      );
      await page.goto(`${BASE}/contracts/${contractNumber}/documents`);
      await pause(2000);
      const docText = await mainText(page);
      expectThat(
        orig.every((o) => docText.includes(o.filename.replace(/\.pdf$/, ""))),
        "Documents tab lacks the promoted files",
      );
      return `Documents: ${orig.map((o) => o.filename).join(", ")} at the root, one Version each with the original bytes; ${orig[0].filename} is primary. The Legal only and shared comments moved to C-${contractNumber} with tiers legal_only and full_thread, author ${me}, and their PDFs still on the comments, not filed as Documents.`;
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
        const staff = await page.request.get(
          `${BASE}/api/v1/requests/${Cc.number}/attachments/${o.id}`,
        );
        const portal = await jonas.request.get(
          `${BASE}/api/v1/portal/requests/${Cc.number}/attachments/${o.id}`,
        );
        expectThat(
          staff.status() === 404 && portal.status() === 404,
          `staff ${staff.status()} portal ${portal.status()}`,
        );
        out.push(`${o.filename}: staff ${staff.status()}, Portal ${portal.status()}`);
      }
      return out.join("; ") + ".";
    },
  );

  await step(
    A,
    role,
    `Portal: Jonas's R- address redirects to C-${contractNumber}, the Request leaves Your requests, Original request is shown; Amara is refused`,
    "Redirect; not in Your requests; Original request; Amara refused",
    async () => {
      await jonas.goto(`${BASE}/portal/requests/${Cc.number}`);
      await jonas.waitForURL((u) => !u.pathname.endsWith(`/requests/${Cc.number}`), {
        timeout: 15000,
      });
      await jonas.waitForLoadState("networkidle").catch(() => {});
      await pause(1500);
      const url = jonas.url();
      const text = (await jonas.locator("main").innerText()).replace(/\s+/g, " ");
      expectThat(url.includes(`/contracts/${contractNumber}`), `redirected to ${url}`);
      expectThat(/Original request/i.test(text), "Original request missing");
      const listed = (await jonas.request.get(`${BASE}/api/v1/portal/requests?limit=200`)).json
        ? await (await jonas.request.get(`${BASE}/api/v1/portal/requests?limit=200`)).json()
        : {};
      const inList = JSON.stringify(listed).includes(`"number":${Cc.number},`);
      await jonas.goto(`${BASE}/portal`);
      await pause(2000);
      const portalHome = (await jonas.locator("main").innerText()).replace(/\s+/g, " ");
      expectThat(!portalHome.includes(Cc.title), "Request still listed in Your requests");
      await amara.goto(`${BASE}/portal/requests/${Cc.number}`);
      await pause(2000);
      const amaraText = (await amara.locator("body").innerText()).replace(/\s+/g, " ");
      const amaraRecord = await amara.request.get(
        `${BASE}/api/v1/portal/contracts/${contractNumber}`,
      );
      expectThat(
        !amaraText.includes(Cc.title) && amaraRecord.status() >= 400,
        "Amara could read it",
      );
      return `R-${Cc.number} opened ${new URL(url).pathname}, which shows Original request; Your requests on /portal no longer lists it (API list includes it: ${inList}); Amara Nwosu saw no title at the R- address and the Portal contract API answered ${amaraRecord.status()}.`;
    },
  );

  let matterNumber;
  await step(
    A,
    role,
    `${Cm.reference} Convert to matter: choose the Matter template, review defaults (carried answer wins, template default fills), explicitly clear the archived Entity, answer required Field`,
    "Template shows defaults; No template removes them; conversion succeeds",
    async () => {
      await openConvert(page, Cm.number, "matter");
      const dialog = dialogFor(page, Cm.reference, "matter");
      await dialog.waitFor();
      const initialTemplate = await dialog.locator("#convert-template").inputValue();
      const noTemplateLabel = await dialog.locator("#convert-template option:checked").innerText();
      await dialog.locator("#convert-template").selectOption({ label: fx.templates.good.name });
      await pause(800);
      const carry = await dialog.getByLabel(F.carry.name).inputValue();
      const region = await dialog.locator(`#convert-${F.choice.slug}`).inputValue();
      await dialog.locator("#convert-template").selectOption({ label: "No template" });
      await pause(600);
      const regionNo = await dialog.locator(`#convert-${F.choice.slug}`).inputValue();
      await dialog.locator("#convert-template").selectOption({ label: fx.templates.good.name });
      await pause(600);
      const regionAgain = await dialog.locator(`#convert-${F.choice.slug}`).inputValue();
      expectThat(
        carry.startsWith("Northwind Fictional Supplies"),
        `carried answer replaced by template: ${carry}`,
      );
      expectThat(
        region === "North" && regionAgain === "North",
        `template default not shown: ${region}/${regionAgain}`,
      );
      expectThat(regionNo === "", `No template kept the default: ${regionNo}`);
      await dialog.getByLabel(F.required.name).fill(`CC-${role}-002`);
      await dialog.locator(`#convert-${F.entity.slug}`).selectOption({ label: "Not set" });
      await dialog.locator("#convert-needed-by").fill(neededBy);
      const titleBefore = await dialog.getByLabel(/^Title/).inputValue();
      const priorityBefore = await dialog.locator("#convert-priority").inputValue();
      await shot(page, `${role}-convert-matter-dialog`);
      log.matterCreatedAt = log.matterCreatedAt ?? {};
      await dialog.getByRole("button", { name: "Convert to matter", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      await page
        .locator('[aria-labelledby="inbox-request-outcome-heading"]')
        .getByText("Converted")
        .first()
        .waitFor({ timeout: 15000 });
      const detail = await getReq(Cm.number);
      expectThat(detail.request.convertedRecord?.module === "matter", "not a matter");
      matterNumber = detail.request.convertedRecord.number;
      log.records.push({ role, request: Cm.reference, record: `M-${matterNumber}` });
      return `Template control opened on "${noTemplateLabel}" (value "${initialTemplate}"). Choosing ${fx.templates.good.name} kept ${F.carry.name} "${carry}" and showed ${F.region ?? F.choice.name} = North; No template emptied it; re-choosing showed North again. Typed the required Field, set the Entity to Not set, Title "${titleBefore}", Priority ${priorityBefore}. Converted to M-${matterNumber}.`;
    },
  );

  await step(
    A,
    role,
    `M-${matterNumber}: Title and Priority kept, Risk unset, Matter Manager and Business Owner, Custom fields, template Tasks and Key dates from the creation date in UTC, Documents without primary`,
    "Values as the guide states",
    async () => {
      const { body } = await api[role].get(`/api/v1/matters/${matterNumber}`);
      const m = body.matter;
      expectThat(m.title === Cm.title, `Title ${m.title}`);
      expectThat(m.priority === "high", `Priority ${m.priority}`);
      expectThat(m.risk === null, `Risk ${m.risk}`);
      expectThat(m.manager?.displayName === me, `Manager ${m.manager?.displayName}`);
      expectThat(m.businessOwner?.displayName === "Jonas Weber", "Business Owner");
      expectThat(
        body.team.some((t) => t.displayName === "Jonas Weber"),
        "Requester not on team",
      );
      expectThat(
        m.customFields[F.carry.slug]?.startsWith("Northwind Fictional Supplies"),
        "carried value lost",
      );
      expectThat(m.customFields[F.choice.slug] === "North", "template default missing");
      expectThat(m.customFields[F.required.slug] === `CC-${role}-002`, "typed value missing");
      expectThat(!(F.entity.slug in m.customFields), "explicitly cleared Entity was set");
      const created = new Date(m.createdAt);
      const plus = (d) =>
        new Date(
          Date.UTC(created.getUTCFullYear(), created.getUTCMonth(), created.getUTCDate() + d),
        )
          .toISOString()
          .slice(0, 10);
      const tasks = (await api[role].get(`/api/v1/matters/${matterNumber}/tasks`)).body.tasks ?? [];
      const mt = tasks.find((t) => t.title.includes("manager task"));
      const ot = tasks.find((t) => t.title.includes("open task"));
      expectThat(
        mt && JSON.stringify(mt).includes(plus(3)),
        `manager task due: ${JSON.stringify(mt)}`,
      );
      expectThat(
        mt && JSON.stringify(mt.assignee ?? mt.assignees ?? mt).includes(me),
        "manager task not assigned to the Matter Manager",
      );
      expectThat(
        ot && (ot.dueDate ?? ot.dueOn ?? null) === null,
        `open task due: ${JSON.stringify(ot)}`,
      );
      expectThat(ot && !(ot.assignee ?? null), `open task assignee: ${JSON.stringify(ot)}`);
      const kd =
        (await api[role].get(`/api/v1/matters/${matterNumber}/key-dates`)).body.deadlines ?? [];
      const cp = kd.find((d) => JSON.stringify(d).includes("checkpoint"));
      expectThat(cp && JSON.stringify(cp).includes(plus(5)), `checkpoint: ${JSON.stringify(cp)}`);
      expectThat(
        kd.some(
          (d) => /Needed by/i.test(JSON.stringify(d)) && JSON.stringify(d).includes(neededBy),
        ),
        "Needed by Key date missing",
      );
      const docs =
        (await api[role].get(`/api/v1/matters/${matterNumber}/documents`)).body.documents ?? [];
      expectThat(
        docs.length === 2 && !docs.some((d) => d.isPrimary ?? d.primary),
        `matter documents ${docs.length}`,
      );
      for (const o of originals[Cm.number]) {
        const d = docs.find((x) => JSON.stringify(x).includes(o.filename));
        const versions = d.versions ?? [];
        const dl = await page.request.get(
          `${BASE}/api/v1/documents/${d.id}/versions/${versions[0].id}/download`,
        );
        expectThat(
          versions.length === 1 && sha(Buffer.from(await dl.body())) === o.sha,
          `${o.filename} version or bytes`,
        );
      }
      await page.goto(`${BASE}/matters/${matterNumber}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await pause(1500);
      const text = await mainText(page);
      expectThat(
        text.includes("Custom fields") && text.includes(F.carry.name),
        "Custom fields on Overview missing",
      );
      expectThat(
        text.includes("Current") && text.includes("Requester"),
        "Current / Requester switch missing",
      );
      await shot(page, `${role}-matter-overview`);
      await jonas.goto(`${BASE}/portal/requests/${Cm.number}`);
      await jonas.waitForURL((u) => u.pathname.includes(`/matters/${matterNumber}`), {
        timeout: 15000,
      });
      await pause(1500);
      expectThat(
        /Original request/i.test(await jonas.locator("main").innerText()),
        "Original request missing on the Portal matter",
      );
      return `M-${matterNumber}: Title unchanged (no TPL - prefix), Priority high (not the template's low), Risk unset (not critical), Matter Manager ${me}, Business Owner Jonas Weber on the team. Custom fields on Overview: carried supplier, Region North from the template, typed ${F.required.name}, Entity empty. Tasks: manager task due ${plus(3)} assigned to ${me}; open task without due date or assignee. Key dates: checkpoint ${plus(5)} and Needed by ${neededBy}. Two Documents at Version 1 with original bytes, none primary. Current / Requester switch shown. Jonas's R-${Cm.number} address opened /portal/matters/${matterNumber} with Original request.`;
    },
  );

  await step(
    A,
    role,
    `Re-target ${Crt.reference} (configured for Contract): Convert to matter, check the destination, switch with Convert to contract instead and back, then convert once`,
    "Matter type must be chosen; one Matter created",
    async () => {
      await openConvert(page, Crt.number, "matter");
      let dialog = dialogFor(page, Crt.reference, "matter");
      await dialog.waitFor();
      const typeValue = await dialog.locator("#convert-type").inputValue();
      await dialog.getByLabel(/^Title/).fill(`${Crt.title} retargeted`);
      await dialog.getByRole("button", { name: "Convert to contract instead" }).click();
      dialog = dialogFor(page, Crt.reference, "contract");
      await dialog.waitFor();
      const titleKept = await dialog.getByLabel(/^Title/).inputValue();
      await dialog.getByRole("button", { name: "Convert to matter instead" }).click();
      dialog = dialogFor(page, Crt.reference, "matter");
      await dialog.waitFor();
      let refusal = "";
      if (!typeValue) {
        await dialog
          .getByLabel(F.required.name)
          .fill("CC-retarget")
          .catch(() => {});
        await dialog.getByRole("button", { name: "Convert to matter", exact: true }).click();
        refusal = (await dialog.getByRole("alert").first().innerText()).trim();
      }
      await dialog.locator("#convert-type").selectOption(fx.matterType.id);
      await pause(600);
      await dialog.getByLabel(F.required.name).fill("CC-retarget");
      await dialog.getByRole("button", { name: "Convert to matter", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      const detail = await getReq(Crt.number);
      expectThat(detail.request.convertedRecord?.module === "matter", "not converted to a matter");
      log.records.push({
        role,
        request: Crt.reference,
        record: `M-${detail.request.convertedRecord.number}`,
      });
      return `Convert to matter opened with Matter type "${typeValue || "(none selected)"}"${refusal ? `; submitting without a type showed "${refusal}"` : ""}; Title edit survived Convert to contract instead ("${titleKept}") and back; after choosing ${fx.matterType.name} it converted to M-${detail.request.convertedRecord.number}.`;
    },
  );

  await step(
    A,
    role,
    `Lost race on ${Crace.reference}: ${them} converts first; the dialog states the outcome and record with Close; no second Contract`,
    "Somebody else already converted this request.; It became C-n.; one record",
    async () => {
      await openConvert(page, Crace.number, "contract");
      const dialog = dialogFor(page, Crace.reference, "contract");
      await dialog.waitFor();
      await dialog.getByLabel(F.required.name).fill("CC-race-browser");
      await page.route(`**/api/v1/requests/${Crace.number}/convert`, async (route) => {
        await api[otherRole].post(`/api/v1/requests/${Crace.number}/convert`, {
          title: Crace.title,
          customFields: { [F.required.slug]: "CC-race-winner" },
        });
        await route.continue();
      });
      await dialog.getByRole("button", { name: "Convert to contract", exact: true }).click();
      await dialog
        .getByText("Somebody else already converted this request.")
        .waitFor({ timeout: 15000 });
      const winner = (await getReq(Crace.number)).request.convertedRecord;
      await dialog.getByText(`It became C-${winner.number}.`).waitFor();
      await page.unroute(`**/api/v1/requests/${Crace.number}/convert`);
      await shot(page, `${role}-lost-race-convert`);
      await dialog.getByRole("button", { name: "Close" }).first().click();
      await dialog.waitFor({ state: "hidden" });
      const list =
        (await api[role].get(`/api/v1/contracts?q=${encodeURIComponent(Crace.title)}&limit=10`))
          .body.contracts ?? [];
      const same = list.filter((c) => c.title === Crace.title);
      expectThat(same.length === 1, `contracts with the title: ${same.length}`);
      const again = await api[role].request("POST", `/api/v1/requests/${Crace.number}/convert`, {
        json: { title: Crace.title },
        expect: [409],
      });
      log.records.push({
        role,
        request: Crace.reference,
        record: `C-${winner.number}`,
        note: `won by ${them}`,
      });
      return `${them}'s conversion landed through the lab API while the browser write was held. Dialog: "Somebody else already converted this request." and "It became C-${winner.number}." with Close. One Contract has the title; a second convert call answered ${again.status}.`;
    },
  );

  await step(
    A,
    role,
    `${Cst.reference}: a refused template default is recovered by choosing No template and answering the required Field`,
    "Refusal names the Field; Request stays new; then converts",
    async () => {
      await openConvert(page, Cst.number, "matter");
      let dialog = dialogFor(page, Cst.reference, "matter");
      await dialog.waitFor();
      await dialog.locator("#convert-template").selectOption({ label: fx.templates.stale.name });
      await pause(800);
      await dialog.getByLabel(F.required.name).fill("CC-stale");
      await dialog.getByRole("button", { name: "Convert to matter", exact: true }).click();
      await dialog.getByRole("alert").first().waitFor({ timeout: 15000 });
      const refusal = (await dialog.getByRole("alert").first().innerText()).trim();
      expectThat(refusal.includes(F.choice.name), `refusal does not name the Field: ${refusal}`);
      expectThat(
        (await getReq(Cst.number)).request.status === "new",
        "refused conversion decided the Request",
      );
      await dialog.locator("#convert-template").selectOption({ label: "No template" });
      await pause(600);
      await dialog.getByLabel(F.required.name).fill("CC-stale");
      await dialog.getByRole("button", { name: "Convert to matter", exact: true }).click();
      await dialog.waitFor({ state: "hidden", timeout: 30000 });
      const r = (await getReq(Cst.number)).request;
      expectThat(r.convertedRecord?.module === "matter", "not converted");
      log.records.push({ role, request: Cst.reference, record: `M-${r.convertedRecord.number}` });
      return `With ${fx.templates.stale.name} the conversion was refused: "${refusal}"; the Request stayed new. No template plus the required answer converted it to M-${r.convertedRecord.number}.`;
    },
  );
}

// ======================= ACCESS =======================
async function access() {
  // The guide names Business Users as unable to triage. A Contributor check is added when a
  // Contributor account can sign in; during round 1 the seed Contributor had another role.
  await step(
    "triage-requests",
    "business_user",
    "Business Users cannot open or triage the Inbox",
    "Inbox redirects to the Portal; staff Request list and convert API refused",
    async () => {
      const out = [];
      for (const key of ["business_user", "second_business_user"]) {
        const bp = await portalPage(key);
        await bp.goto(`${BASE}/inbox`);
        await pause(2500);
        const landed = new URL(bp.url()).pathname;
        const list = await bp.request.get(`${BASE}/api/v1/requests?limit=1`);
        const n = reqs["administrator:triage-review"].number;
        const detail = await bp.request.get(`${BASE}/api/v1/requests/${n}`);
        const conv = await bp.request.post(`${BASE}/api/v1/requests/${n}/convert`, {
          data: { title: "DOC-029 inbox refused" },
          headers: { origin: BASE },
        });
        expectThat(landed !== "/inbox" && !landed.startsWith("/inbox/"), `${key} opened the Inbox`);
        expectThat(
          list.status() === 403 && detail.status() >= 400 && conv.status() >= 400,
          `${key} API ${list.status()} ${detail.status()} ${conv.status()}`,
        );
        out.push(
          `${PEOPLE[key].name}: /inbox landed on ${landed}; staff list API ${list.status()}, staff Request detail ${detail.status()}, convert ${conv.status()}`,
        );
      }
      const contributor = await api.administrator.get("/api/v1/users");
      const ravi = (contributor.body.users ?? []).find((u) => u.email === PEOPLE.contributor.email);
      return `${out.join("; ")}. Contributor check not run: the seed Contributor account currently has role ${ravi?.role ?? "unknown"} in this shared lab.`;
    },
  );
}

try {
  for (const role of ROLES) {
    if (PHASES.includes("triage")) await triage(role);
    if (PHASES.includes("convert")) await convert(role);
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
