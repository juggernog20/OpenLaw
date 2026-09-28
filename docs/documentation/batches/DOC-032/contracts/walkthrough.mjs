// DOC-032 independent walkthrough, group contracts.
// Written by the DOC-032 independent walkthrough agent (contracts) from the text of
// contract-approvals (V-C16). The agent did not write this guide. The pattern is
// DOC-030 contracts-a/walkthrough.mjs and api.mjs, cut to this one article and moved
// to the Approvals tab that replaced the Approvals & signing card.
//
// Run from the worktree root against the shared work lab:
//   LAB_PASSWORD=... node docs/documentation/batches/DOC-032/contracts/walkthrough.mjs
// ROLES=... narrows a run. SIGNING=1 with LAB=<owned lab> runs only the extra check
// of the "confirmed send from the Signatures tab" paragraph against a lab whose app
// and worker point at the e2e signing stand-in (see fixture/).
// The seed password comes from the environment. Magic links are read from the lab
// Mailpit at run time and never written. The log holds no credentials, cookies,
// links, or raw mail.
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";
import {
  here,
  BASE,
  MAIL,
  lab,
  articleHash,
  PEOPLE,
  sleep,
  must,
  q,
  until,
  recorder,
  launch,
  closeBrowser,
  passwordSession,
  portalSession,
  pdf,
} from "./api.mjs";

const ARTICLES = ["contract-approvals"];
const ROLES = (process.env.ROLES ?? "legal_team_member,administrator").split(",");
const SIGNING = process.env.SIGNING === "1";
const OUT =
  process.env.OUT ?? path.join(here, SIGNING ? "walkthrough-signing.json" : "walkthrough.json");
const stamp = Date.now();
const P = `DOC-032 contracts V-C16`;

const { results, step, save } = recorder(OUT, {
  kind: "independent-article-walkthrough-log",
  task: "DOC-032",
  group: "contracts",
  walkthroughReviewer: "DOC-032 independent walkthrough agent (contracts)",
  reviewerKind: "agent",
  appCommit: lab.sourceCommit,
  environment: lab.project,
  labName: lab.name,
  appUrl: BASE,
  mailUrl: MAIL,
  buildId: `app ${lab.appImageId}; engine ${lab.engineImageId}`,
  containerImages: lab.containerImages,
  seed: lab.seed,
  browser:
    "Playwright 1.63.0 Chromium from the worktree node_modules, headless, 1280x900 CSS px, one isolated context per identity",
  articleHashes: Object.fromEntries(ARTICLES.map((id) => [id, articleHash(id)])),
  roles: ROLES,
  signingCheck: SIGNING,
  stamp,
  identities: [],
  fixtures: [],
  records: [],
  orgSettings: [],
  productBugs: [],
});

await launch();
const S = {};
for (const key of ["daniel", "nadia", "priya", "marcus", "tom"])
  S[key] = await passwordSession(PEOPLE[key]);
S.lena = await portalSession(PEOPLE.lena);
results.identities = [
  { role: "administrator", person: "Daniel Okafor", entry: "password sign-in", context: "daniel" },
  {
    role: "legal_team_member",
    person: "Nadia Haddad",
    entry: "password sign-in",
    context: "nadia",
  },
  {
    role: "legal_team_member (named approver and comparison reader)",
    person: "Priya Raman",
    entry: "password sign-in",
    context: "priya",
  },
  {
    role: "legal_team_member (reader outside a Confidential team, second actor)",
    person: "Marcus Oyelaran",
    entry: "password sign-in",
    context: "marcus",
  },
  {
    role: "legal_team_member (type default person on the fixture type, not creator or owner)",
    person: "Tom Iwu",
    entry: "password sign-in",
    context: "tom",
  },
  {
    role: "business_user (Business approver)",
    person: "Lena Vogel",
    entry: "fresh magic link from this lab's Mailpit, Portal sign-in",
    context: "lena",
  },
];
save();

const D = S.daniel;
const users = (await D.api("GET", "/users")).json.users;
const uid = (name) => users.find((u) => u.displayName === name).id;
let options = (await D.api("GET", "/contracts/options")).json;
const typeId = (name) => options.contractTypes.find((t) => t.displayName === name).id;
const getContract = async (s, number) => (await s.api("GET", `/contracts/${number}`)).json;
const approvalsOf = async (s, number) =>
  (await s.api("GET", `/contracts/${number}/approvals`)).json?.approvals ?? [];
const notificationPrefs = async (s) =>
  ((await s.api("GET", "/me/notification-preferences")).json?.groups ?? []).find(
    (g) => g.eventGroup === "assigned_to_you",
  );

// ---------------------------------------------------------------------------
// Fixtures: created through the Administrator's API session. Not article steps.
// ---------------------------------------------------------------------------
const FX = {};
function fixture(kind, name, detail) {
  results.fixtures.push({ kind, name, detail });
  save();
}
function record(title, number, note) {
  results.records.push({ title, reference: `C-${number}`, ...(note ? { note } : {}) });
  save();
}
async function makeType(label) {
  const r = await D.api("POST", "/contract-types", { displayName: `${P} ${label} ${stamp}` });
  must(r.status === 201, `type ${label} ${r.status} ${q(r.json)}`);
  return r.json.contractType;
}

async function setupFixtures() {
  // An Approver group for V-C16 (Marcus Oyelaran and Priya Raman).
  const g = await D.api("POST", "/approver-groups", {
    name: `${P} sign-off ${stamp}`,
    memberIds: [uid("Marcus Oyelaran"), uid("Priya Raman")],
  });
  must(g.status === 201, `group ${g.status} ${q(g.json)}`);
  FX.group = g.json.approverGroup ?? g.json.group;
  fixture("Approver group", FX.group.name, "Marcus Oyelaran and Priya Raman; used in V-C16");

  options = (await D.api("GET", "/contracts/options")).json;
}
async function cleanupFixtures() {
  const done = [];
  const other = options.contractTypes.find((t) => t.displayName === "Other").id;
  const lists = [
    ["group", "/approver-groups", "approverGroups", (x) => x.name],
    ["type", "/contract-types", "contractTypes", (x) => x.displayName],
    ["field", "/fields", "fields", (x) => x.displayName],
  ];
  for (const [label, base, key, name] of lists) {
    const rows = (await D.api("GET", base)).json?.[key] ?? [];
    for (const row of rows.filter((x) => name(x)?.startsWith(`${P} `) && !x.archivedAt)) {
      const url = `${base.split("?")[0]}/${row.id}/archive`;
      let r = await D.api("POST", url, {});
      if (label === "type" && r.status >= 400)
        r = await D.api("POST", url, { reassignToId: other });
      done.push(`${label} ${name(row)}: ${r.status}`);
    }
  }
  return done;
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------
async function openContract(s, number, tab = "") {
  await s.page.goto(`${BASE}/contracts/${number}${tab ? `/${tab}` : ""}`);
  await s.page.getByRole("heading", { level: 1 }).waitFor({ timeout: 20000 });
  await s.page.waitForLoadState("networkidle").catch(() => {});
}
const section = (s, name) =>
  s.page
    .getByRole("navigation", { name: "Contract sections" })
    .getByRole("link", { name: new RegExp(`^${name}`) })
    .click();
async function checkboxNames(scope) {
  await scope.getByRole("checkbox").first().waitFor();
  const snap = await scope.ariaSnapshot();
  return [...snap.matchAll(/checkbox "([^"]+)"/g)].map((m) => m[1]);
}
async function history(page) {
  const applet = page.getByRole("complementary", { name: "History" });
  if (!(await applet.isVisible().catch(() => false)))
    await page.getByRole("button", { name: "History" }).click();
  await applet.getByRole("list", { name: "History" }).waitFor();
  await sleep(600);
  const text = await applet.getByRole("list", { name: "History" }).innerText();
  await applet.getByRole("button", { name: "Close" }).click();
  return text.replace(/\s+/g, " ");
}
async function quickContract(s, label, extra = {}) {
  const title = `${P} ${label} ${stamp}`;
  const r = await s.api("POST", "/contracts", {
    title,
    contractTypeId: extra.contractTypeId ?? typeId("MSA"),
    customFields: {},
    isConfidential: Boolean(extra.confidential),
    managerId: extra.managerId ?? null,
  });
  must(r.status === 201, `setup contract ${r.status} ${q(r.json)}`);
  record(title, r.json.contract.number, `setup through ${s.displayName}'s API session`);
  return r.json.contract.number;
}
async function uploadPrimary(s, number, name) {
  const r = await s.page.request.post(`${BASE}/api/v1/contracts/${number}/documents`, {
    headers: { origin: BASE },
    multipart: {
      file: { name, mimeType: "application/pdf", buffer: pdf(`${P} ${name} ${stamp}`) },
    },
    failOnStatusCode: false,
  });
  must(r.status() === 201, `upload ${r.status()} ${await r.text()}`);
  return (await r.json()).document;
}

// =====================================================================
const SECTIONS = {};

/** The Apply dialog text after the group picker's option list. */
const afterPicker = (text) =>
  (text.match(/(Asks .*|This group has nobody.*|Everybody in this group.*)$/)?.[1] ?? text).slice(
    0,
    320,
  );

// =====================================================================
// V-C16 contract-approvals
// =====================================================================
// The Approvals tab renders one "Approvals" region (approvals.block).
const approvalsCard = (page) => page.getByRole("region", { name: "Approvals", exact: true });
async function openBell(s) {
  const bell = s.page.getByRole("banner").getByRole("button", { name: /^Notifications,/ });
  await bell.click();
  const pop = s.page.getByRole("dialog", { name: "Notifications" });
  await pop.waitFor();
  await sleep(1200);
  return pop;
}
async function yourApprovals(s, needle) {
  const pop = await openBell(s);
  const region = pop.getByRole("region", { name: "Your approvals" });
  const has = (await region.count()) > 0;
  const items = has
    ? (await region.getByRole("listitem").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim())
    : [];
  const mine = items.filter((t) => t.includes(needle));
  return { pop, region, has, items, mine };
}
async function stageMove(s, number, statusName, { expectGate = false } = {}) {
  const page = s.page;
  await page.getByRole("button", { name: /— move contract$/ }).click();
  const menu = page.getByRole("menu");
  await menu.waitFor();
  await menu.getByRole("menuitemradio").filter({ hasText: statusName }).first().click();
  if (expectGate) {
    const dialog = page.getByRole("dialog", { name: "Move past approval" });
    await dialog.waitFor({ timeout: 10000 });
    return dialog;
  }
  await until(
    async () => (await getContract(s, number)).contract.statusName === statusName,
    `status ${statusName}`,
  );
  return null;
}
async function addApprovers(s, names, { expectClose = true } = {}) {
  const page = s.page;
  await approvalsCard(page).getByRole("button", { name: "Add approver" }).click();
  const d = page.getByRole("dialog", { name: "Add approver" });
  const offered = await checkboxNames(d);
  for (const n of names) await d.getByRole("checkbox", { name: n }).check();
  await d.getByRole("button", { name: "Request approvals" }).click();
  if (expectClose) await d.waitFor({ state: "hidden", timeout: 15000 });
  return { d, offered };
}
async function rowActions(s, name, { row } = {}) {
  const card = approvalsCard(s.page);
  const scope = row ?? card;
  const btn = scope.getByRole("button", { name: `Actions for ${name}` });
  if (!(await btn.count())) return null;
  await btn.first().click();
  const items = await s.page.getByRole("menu").getByRole("menuitem").allInnerTexts();
  await s.page.keyboard.press("Escape");
  return items.map((x) => x.trim());
}

async function contractApprovals(role, A, O) {
  const art = "contract-approvals";
  const sc = "V-C16";
  const page = A.page;
  const number = await quickContract(A, `${role} approvals`, { managerId: uid(A.displayName) });
  const title = `${P} ${role} approvals ${stamp}`;
  await uploadPrimary(A, number, `doc032-contracts-${role}-approval.pdf`);
  const card = () => approvalsCard(page);

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "/contracts/:number/approvals",
    "Ask for approval, steps 1-3: open the Contract's Approvals tab, Add approver, choose Priya Raman and Business User Lena Vogel under Approvers, Request approvals",
    "The picker offers all active users including Business Users and not archived people; both new rows are Pending at once; a person with a pending request is not offered again.",
    async () => {
      await openContract(A, number);
      const tabLink = page
        .getByRole("navigation", { name: "Contract sections" })
        .getByRole("link", { name: /^Approvals/ });
      const tabLabel = (await tabLink.innerText()).replace(/\s+/g, " ").trim();
      await section(A, "Approvals");
      await page.waitForURL((u) => u.pathname === `/contracts/${number}/approvals`);
      const tabPath = new URL(page.url()).pathname;
      await card().waitFor();
      const { offered } = await addApprovers(A, ["Priya Raman", "Lena Vogel"]);
      await card()
        .getByRole("row")
        .filter({ hasText: "Priya Raman" })
        .filter({ hasText: "Pending" })
        .waitFor();
      await card()
        .getByRole("row")
        .filter({ hasText: "Lena Vogel" })
        .filter({ hasText: "Pending" })
        .waitFor();
      const rows = (await approvalsOf(A, number)).map(
        (a) => `${a.approver.displayName}:${a.status}`,
      );
      await card().getByRole("button", { name: "Add approver" }).click();
      const d = page.getByRole("dialog", { name: "Add approver" });
      const again = await checkboxNames(d);
      await d.getByRole("button", { name: "Cancel" }).click();
      must(
        offered.includes("Lena Vogel") &&
          offered.includes("Jonas Weber") &&
          offered.includes("Priya Raman") &&
          !offered.includes("Gabriel Santos"),
        `offered ${offered}`,
      );
      must(!again.includes("Priya Raman") && !again.includes("Lena Vogel"), `re-offered ${again}`);
      must(rows.length === 2 && rows.every((r) => r.endsWith(":pending")), `rows ${rows}`);
      return `The Approvals tab (${q(tabLabel)}, landing on ${tabPath}) > Add approver listed ${offered.length} people under Approvers, including Business Users Lena Vogel and Jonas Weber and not archived Gabriel Santos. After Request approvals: ${q(rows)}. The reopened picker offered ${again.length} people and not Priya Raman or Lena Vogel.`;
    },
  );

  await step(
    art,
    sc,
    role,
    ["Priya Raman", A.displayName],
    "Notification bell > Your approvals > Review",
    "Give a decision: with in-app notifications on, a request made by someone else is pinned under Your approvals with Review; the requester's own request is not pinned for them",
    "Priya's bell pins the request with Review, which opens the Contract's approvals; A's bell has no pinned item for a request A made to themselves.",
    async () => {
      const pref = await notificationPrefs(S.priya);
      await S.priya.page.goto(`${BASE}/`);
      await S.priya.page.waitForLoadState("networkidle").catch(() => {});
      const found = await until(
        async () => {
          const r = await yourApprovals(S.priya, title);
          if (r.mine.length) return r;
          await S.priya.page.keyboard.press("Escape");
          await S.priya.page.reload();
          return null;
        },
        "Priya's pinned approval",
        30000,
      );
      const item = found.region.getByRole("listitem").filter({ hasText: title });
      const reviewHref = await item.getByRole("link", { name: "Review" }).getAttribute("href");
      await item.getByRole("link", { name: "Review" }).click();
      await S.priya.page.waitForURL((u) => u.pathname.startsWith(`/contracts/${number}`), {
        timeout: 15000,
      });
      const landed = new URL(S.priya.page.url()).pathname;
      // The requester's own request: A asks A.
      const selfAsk = await addApprovers(A, [A.displayName]);
      const aPref = await notificationPrefs(A);
      await sleep(2500);
      await A.page.reload();
      await A.page.getByRole("heading", { level: 1 }).waitFor();
      const own = await yourApprovals(A, title);
      await A.page.keyboard.press("Escape");
      const selfRow = (await approvalsOf(A, number)).find(
        (a) => a.approver.displayName === A.displayName && a.status === "pending",
      );
      await openContract(A, number, "approvals");
      await card()
        .getByRole("row")
        .filter({ hasText: A.displayName })
        .getByRole("button", { name: `Actions for ${A.displayName}` })
        .click();
      await page.getByRole("menuitem", { name: "Cancel request" }).click();
      await until(
        async () => !(await approvalsOf(A, number)).some((a) => a.id === selfRow.id),
        "self request cancelled",
      );
      must(
        pref?.inApp === true &&
          found.mine.length === 1 &&
          landed === `/contracts/${number}/approvals`,
        `pref ${q(pref)} mine ${found.mine.length} landed ${landed}`,
      );
      must(own.mine.length === 0, `own request pinned ${q(own.mine)}`);
      return `Priya Raman's "Assigned to you" in-app preference is ${pref?.inApp}. Her bell showed Your approvals with ${found.items.length} item(s); the one for this Contract read ${q(found.mine[0])} with Review (${reviewHref}), which opened ${landed}. ${A.displayName} (in-app ${aPref?.inApp}) then asked themselves; their bell's Your approvals held ${own.items.length} item(s) and none for this Contract. That self request was cancelled.`;
    },
  );

  await step(
    art,
    sc,
    role,
    ["Priya Raman", A.displayName],
    "/contracts/:number/approvals row actions",
    "Give a decision: only the named person can answer; other people see no Approve or Reject; the dialog says a decision is final; Note; Reject in the dialog; the row shows Rejected with the note; the pinned item goes",
    "A sees only Cancel request on Priya's row and a direct decision is refused; Priya rejects with a Note; Rejected row and note; a second decision is refused; Priya's pinned item is gone.",
    async () => {
      await openContract(A, number, "approvals");
      const aMenu = await rowActions(A, "Priya Raman");
      const req = (await approvalsOf(A, number)).find(
        (a) => a.approver.displayName === "Priya Raman",
      );
      const wrong = await A.api("POST", `/approvals/${req.id}/decision`, { decision: "approved" });
      const pCard = approvalsCard(S.priya.page);
      await pCard.waitFor();
      await pCard.getByRole("button", { name: "Actions for Priya Raman" }).click();
      const pItems = await S.priya.page.getByRole("menu").getByRole("menuitem").allInnerTexts();
      await S.priya.page.getByRole("menuitem", { name: "Reject" }).click();
      const rd = S.priya.page.getByRole("dialog", { name: "Reject this contract" });
      await rd.waitFor();
      const rdText = (await rd.innerText()).replace(/\s+/g, " ");
      await rd.getByLabel("Note").fill(`${P} needs a lower liability cap.`);
      await rd.getByRole("button", { name: "Reject", exact: true }).click();
      await rd.waitFor({ state: "hidden" });
      await pCard
        .getByRole("row")
        .filter({ hasText: "Priya Raman" })
        .filter({ hasText: "Rejected" })
        .waitFor();
      const again = await S.priya.api("POST", `/approvals/${req.id}/decision`, {
        decision: "approved",
      });
      const decidedMenu = await rowActions(S.priya, "Priya Raman");
      await S.priya.page.reload();
      await S.priya.page.getByRole("heading", { level: 1 }).waitFor();
      const after = await yourApprovals(S.priya, title);
      await S.priya.page.keyboard.press("Escape");
      await page.reload();
      await card().waitFor();
      const rowText = (
        await card().getByRole("row").filter({ hasText: "Priya Raman" }).first().innerText()
      ).replace(/\s+/g, " ");
      must(
        aMenu && !aMenu.includes("Approve") && !aMenu.includes("Reject") && wrong.status === 403,
        `A menu ${aMenu} wrong ${wrong.status}`,
      );
      must(
        /A decision is final/.test(rdText) && again.status === 409,
        `dialog ${rdText} again ${again.status}`,
      );
      must(/Rejected/.test(rowText) && rowText.includes("lower liability cap"), `row ${rowText}`);
      must(after.mine.length === 0, `still pinned ${q(after.mine)}`);
      return `${A.displayName}'s actions on Priya's row: ${q(aMenu)}; a direct decision answered ${wrong.status} (${q(wrong.json?.detail)}). Priya's own actions: ${q(pItems)}. Reject opened ${q(rdText.slice(0, 140))}. With a Note she selected Reject in the dialog. ${A.displayName}'s row: ${q(rowText)}. A second decision answered ${again.status}; Priya's decided-row actions: ${decidedMenu ? q(decidedMenu) : "no Actions button"}. Her bell no longer pins this request (${after.items.length} other pinned item(s)).`;
    },
  );

  await step(
    art,
    sc,
    role,
    ["Lena Vogel (Portal)", A.displayName],
    "/portal/approvals > Your approvals > request",
    "Approve from the business portal: Approvals in the Portal navigation bar, Your approvals, Pending and Completed, search by Contract title, open the request, primary Document with Download, Note (optional), Approve saves at once; the decision shows on the Contract; the Portal bell links to the review page",
    "Lena finds the request under Pending, reviews the primary Document, approves with a note without a confirmation; Completed lists it; the Contract row shows Approved with her note.",
    async () => {
      const lp = S.lena.page;
      await lp.goto(`${BASE}/portal`);
      await lp.waitForLoadState("networkidle").catch(() => {});
      const bell = lp.getByRole("button", { name: /^Notifications,/ });
      let bellHref = null;
      if (await bell.count()) {
        await bell.first().click();
        await sleep(1200);
        const item = lp
          .getByRole("dialog", { name: "Notifications" })
          .getByRole("region", { name: "Your approvals" })
          .getByRole("listitem")
          .filter({ hasText: title });
        if (await item.count())
          bellHref = await item.first().getByRole("link", { name: "Review" }).getAttribute("href");
        await lp.keyboard.press("Escape");
      }
      await lp
        .getByRole("navigation", { name: "Portal" })
        .getByRole("link", { name: "Approvals", exact: true })
        .first()
        .click();
      await lp.getByRole("heading", { name: "Your approvals" }).waitFor();
      const tabNav = lp.getByRole("navigation", { name: "Approvals" }).last();
      const tabs = await tabNav.getByRole("link").allInnerTexts();
      const pendingCurrent = await tabNav
        .getByRole("link", { name: "Pending" })
        .getAttribute("aria-current");
      await lp.getByRole("searchbox", { name: "Search approvals" }).fill(title);
      await lp.getByRole("search").getByRole("button", { name: "Search" }).click();
      await sleep(1500);
      const rowTexts = (await lp.getByRole("row").allInnerTexts()).map((t) =>
        t.replace(/\s+/g, " "),
      );
      await lp
        .getByRole("link", { name: new RegExp(title) })
        .first()
        .click();
      await lp.waitForURL(/\/portal\/approvals\/.+/);
      const reviewPath = new URL(lp.url()).pathname;
      await lp.getByText("Your decision").first().waitFor();
      const pageText = (await lp.locator("main").innerText()).replace(/\s+/g, " ");
      const download = await lp
        .getByRole("link", { name: "Download" })
        .or(lp.getByRole("button", { name: "Download" }))
        .count();
      await lp.getByLabel("Note (optional)").fill(`${P} business sign-off given.`);
      let dialogs = 0;
      lp.on("dialog", () => dialogs++);
      await lp.getByRole("button", { name: "Approve", exact: true }).click();
      const saved = await until(
        async () =>
          (await approvalsOf(A, number)).find(
            (a) => a.approver.displayName === "Lena Vogel" && a.status === "approved",
          ),
        "Lena approved",
      );
      const confirmOpen =
        (await lp.getByRole("alertdialog").count()) + (await lp.getByRole("dialog").count());
      await lp.goto(`${BASE}/portal/approvals`);
      await lp
        .getByRole("navigation", { name: "Approvals" })
        .last()
        .getByRole("link", { name: "Completed" })
        .click();
      await sleep(1500);
      const completed = (await lp.locator("main").innerText()).replace(/\s+/g, " ").includes(title);
      await page.reload();
      await card().waitFor();
      const rowText = (
        await card().getByRole("row").filter({ hasText: "Lena Vogel" }).first().innerText()
      ).replace(/\s+/g, " ");
      const team = (await getContract(A, number)).team.map((m) => m.displayName);
      must(
        rowTexts.some((t) => t.includes(title)),
        `search rows ${rowTexts}`,
      );
      must(
        pageText.includes(`doc032-contracts-${role}-approval.pdf`) && download > 0,
        `page ${pageText.slice(0, 300)}`,
      );
      must(
        confirmOpen === 0 && dialogs === 0 && completed,
        `confirm ${confirmOpen} completed ${completed}`,
      );
      must(/Approved/.test(rowText) && rowText.includes("business sign-off"), `row ${rowText}`);
      must(!team.includes("Lena Vogel"), "Lena was added to the team");
      must(
        !/Fields|Comments/.test(pageText.replace(/Approval request.*/, "")),
        "packet shows more than the title and primary Document",
      );
      return `Lena Vogel's Portal bell item for this Contract linked to ${q(bellHref)}. Approvals in the Portal navigation opened "Your approvals" with ${q(tabs)} (Pending current: ${pendingCurrent === "page"}). Searching the Contract title listed ${q(rowTexts.filter((t) => t.includes(title)))}. The request opened ${reviewPath}; the page showed ${q(pageText.slice(0, 260))} with ${download} Download control(s). Approve with a Note saved at once (${saved.status}); no confirmation appeared. Completed lists the request. On the Contract: ${q(rowText)}. Lena is not on the Contract team (${q(team)}).`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "/contracts/:number/approvals Add approver",
    "To ask again after a decision, add a new approval request; the earlier decision stays in history",
    "A new Pending row for Priya Raman; the Rejected row stays.",
    async () => {
      await addApprovers(A, ["Priya Raman"]);
      const rows = await until(async () => {
        const l = (await approvalsOf(A, number)).filter(
          (a) => a.approver.displayName === "Priya Raman",
        );
        return l.length === 2 ? l : null;
      }, "second Priya request");
      return `Priya Raman now has ${q(rows.map((a) => a.status))} requests on C-${number}.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName, "Priya Raman", "Marcus Oyelaran"],
    "/contracts/:number/approvals Apply group",
    "Apply group: choose the Approver group, inspect the named people and the skipped pending requests, select Apply group in the dialog; later group edits do not rewrite existing requests",
    "The dialog asks Marcus and skips Priya; Apply group creates Marcus's Pending row; an Administrator's later group edit leaves the requests as they are.",
    async () => {
      await page.reload();
      await card().getByRole("button", { name: "Apply group" }).click();
      const d = page.getByRole("dialog", { name: "Apply approver group" });
      const startsOn = await d
        .getByRole("combobox", { name: "Approver group" })
        .locator("option:checked")
        .innerText();
      await d
        .getByRole("combobox", { name: "Approver group" })
        .selectOption({ label: FX.group.name });
      await sleep(400);
      const text = (await d.innerText()).replace(/\s+/g, " ");
      await d.getByRole("button", { name: "Apply group", exact: true }).click();
      await d.waitFor({ state: "hidden" });
      await card().getByRole("row").filter({ hasText: "Marcus Oyelaran" }).waitFor();
      const before = (await approvalsOf(A, number)).map(
        (a) => `${a.approver.displayName}:${a.status}:${a.source}`,
      );
      const edit = await D.api("PUT", `/approver-groups/${FX.group.id}/members`, {
        memberIds: [uid("Marcus Oyelaran"), uid("Priya Raman"), uid("Tom Iwu")],
      });
      const after = (await approvalsOf(A, number)).map(
        (a) => `${a.approver.displayName}:${a.status}:${a.source}`,
      );
      await D.api("PUT", `/approver-groups/${FX.group.id}/members`, {
        memberIds: [uid("Marcus Oyelaran"), uid("Priya Raman")],
      });
      const rowText = (
        await card().getByRole("row").filter({ hasText: "Marcus Oyelaran" }).innerText()
      ).replace(/\s+/g, " ");
      must(/Asks Marcus Oyelaran\./.test(text) && /Skips 1 person/.test(text), `dialog ${text}`);
      must(
        edit.status === 200 && JSON.stringify(before) === JSON.stringify(after),
        `edit ${edit.status} ${after}`,
      );
      return `The dialog started on ${q(startsOn)} (this MSA Contract has no default group). With ${q(FX.group.name)} chosen it read ${q(afterPicker(text))}. Apply group added Marcus's row ${q(rowText)}. Requests: ${q(before)}. Daniel Okafor added Tom Iwu to the group (${edit.status}); requests stayed ${q(after)}; the group was then put back.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName, "Marcus Oyelaran", O.displayName],
    "/contracts/:number/approvals Cancel request",
    "Cancel request: the requester, the Legal Owner or an Administrator can cancel a pending request at once without a confirmation; others cannot; a decided approval is not erased",
    "Marcus (not requester, Legal Owner or Administrator) has no Cancel request on Priya's pending row and is refused; A cancels Marcus's pending row with no confirmation and History records it; the other permitted person cancels Priya's pending row; decided rows stay and cannot be cancelled.",
    async () => {
      const list = await approvalsOf(A, number);
      const priyaPending = list.find(
        (a) => a.approver.displayName === "Priya Raman" && a.status === "pending",
      );
      const marcusPending = list.find(
        (a) => a.approver.displayName === "Marcus Oyelaran" && a.status === "pending",
      );
      await openContract(S.marcus, number, "approvals");
      const mMenu = await rowActions(S.marcus, "Priya Raman", {
        row: approvalsCard(S.marcus.page)
          .getByRole("row")
          .filter({ hasText: "Priya Raman" })
          .filter({ hasText: "Pending" }),
      });
      const mCancel = await S.marcus.api("DELETE", `/approvals/${priyaPending.id}`);
      // The requester cancels Marcus's group request.
      await page.reload();
      await card()
        .getByRole("row")
        .filter({ hasText: "Marcus Oyelaran" })
        .getByRole("button", { name: "Actions for Marcus Oyelaran" })
        .click();
      await page.getByRole("menuitem", { name: "Cancel request" }).click();
      await sleep(400);
      const confirm =
        (await page.getByRole("dialog").count()) + (await page.getByRole("alertdialog").count());
      await until(
        async () => !(await approvalsOf(A, number)).some((a) => a.id === marcusPending.id),
        "Marcus row removed",
      );
      // The other permitted person cancels Priya's pending request that A made.
      let who;
      if (role === "administrator") {
        await A.api("PATCH", `/contracts/${number}`, { managerId: uid(O.displayName) });
        who = `${O.displayName} as Legal Owner (not the requester or an Administrator)`;
      } else who = `${O.displayName} as Administrator (not the requester or Legal Owner)`;
      await openContract(O, number, "approvals");
      const oRow = approvalsCard(O.page)
        .getByRole("row")
        .filter({ hasText: "Priya Raman" })
        .filter({ hasText: "Pending" });
      await oRow.getByRole("button", { name: "Actions for Priya Raman" }).click();
      await O.page.getByRole("menuitem", { name: "Cancel request" }).click();
      await until(
        async () => !(await approvalsOf(A, number)).some((a) => a.id === priyaPending.id),
        "Priya pending removed",
      );
      if (role === "administrator")
        await A.api("PATCH", `/contracts/${number}`, { managerId: uid(A.displayName) });
      const decided = (await approvalsOf(A, number)).filter((a) => a.status !== "pending");
      const decidedMenu = await rowActions(A, "Priya Raman");
      const decidedCancel = await A.api(
        "DELETE",
        `/approvals/${decided.find((a) => a.approver.displayName === "Priya Raman").id}`,
      );
      const hist = await history(page);
      must(
        !(mMenu ?? []).includes("Cancel request") && mCancel.status === 403,
        `marcus ${mMenu} ${mCancel.status}`,
      );
      must(confirm === 0, `confirmation dialogs ${confirm}`);
      must(
        decided.length === 2 && decidedCancel.status === 409 && /cancel/i.test(hist),
        `decided ${decided.length} cancel ${decidedCancel.status}`,
      );
      return `Marcus Oyelaran's actions on Priya's pending row: ${mMenu ? q(mMenu) : "no Actions button"}; a direct cancel answered ${mCancel.status}. ${A.displayName}'s Cancel request removed Marcus's pending row at once; ${confirm} confirmation dialogs appeared. ${who} cancelled Priya's second pending request. Decided rows stayed: ${q(decided.map((a) => `${a.approver.displayName}:${a.status}`))}; actions on Priya's decided row: ${decidedMenu ? q(decidedMenu) : "none"}; cancelling a decided one answered ${decidedCancel.status}. History: ${q(hist.match(/[^.]{0,60}cancelled[^.]{0,80}/g)?.slice(0, 3))}.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "/contracts/:number Stage control",
    "Move beyond Approval: Move past approval lists Pending and Rejected rows; Cancel keeps the current Status; Move anyway saves it and records an override; the approvals keep their decisions",
    "The dialog lists the unresolved rows; Cancel keeps Awaiting approval; Move anyway saves Active; History records the override; decisions unchanged.",
    async () => {
      await addApprovers(A, ["Tom Iwu"]);
      await openContract(A, number);
      await stageMove(A, number, "Awaiting approval");
      await page.reload();
      await page.getByRole("heading", { level: 1 }).waitFor();
      let dialog = await stageMove(A, number, "Active", { expectGate: true });
      const text = (await dialog.innerText()).replace(/\s+/g, " ");
      if (role === "legal_team_member")
        await page.screenshot({ path: path.join(here, "c16-move-past-approval.png") });
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      await sleep(800);
      const kept = (await getContract(A, number)).contract.statusName;
      dialog = await stageMove(A, number, "Active", { expectGate: true });
      await dialog.getByRole("button", { name: "Move anyway" }).click();
      await until(
        async () => (await getContract(A, number)).contract.statusName === "Active",
        "moved",
      );
      const states = (await approvalsOf(A, number)).map(
        (a) => `${a.approver.displayName}:${a.status}`,
      );
      const hist = await history(page);
      must(
        /Rejected/.test(text) && /Pending/.test(text) && kept === "Awaiting approval",
        `${text} kept ${kept}`,
      );
      must(
        states.includes("Tom Iwu:pending") && states.includes("Priya Raman:rejected"),
        `${states}`,
      );
      must(/override|past approval|anyway/i.test(hist), `history ${hist.slice(0, 300)}`);
      return `Dialog: ${q(text.slice(0, 320))}. Cancel kept ${q(kept)}; Move anyway saved Active. History: ${q(hist.match(/[^.]{0,80}(?:override|past approval|anyway)[^.]{0,80}/i)?.[0])}. Approvals afterwards: ${q(states)}.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName, "Lena Vogel (Portal)"],
    "/contracts/:number/approvals on Confidential work",
    "On a Confidential Contract the picker offers only staff who can already open it plus Business Users; if the primary Document is Confidential a staff approver outside its audience is refused by name and a Business approver is not refused but sees no Document",
    "Confidential Contract: Priya and Marcus not offered, Lena offered. Open Contract with a Confidential primary Document: Marcus refused by name and no request made; Lena asked; her review page shows No document attached.",
    async () => {
      const conf = await quickContract(A, `${role} confidential approvals`, {
        confidential: true,
        managerId: uid(A.displayName),
      });
      await openContract(A, conf, "approvals");
      await card().getByRole("button", { name: "Add approver" }).click();
      const d = page.getByRole("dialog", { name: "Add approver" });
      const offered = await checkboxNames(d);
      await d.getByRole("button", { name: "Cancel" }).click();
      const docNo = await quickContract(A, `${role} confidential document`, {
        managerId: uid(A.displayName),
      });
      const doc = await uploadPrimary(A, docNo, `doc032-contracts-${role}-restricted.pdf`);
      const mark = await A.api("PATCH", `/documents/${doc.id}`, { isConfidential: true });
      await openContract(A, docNo, "approvals");
      await card().getByRole("button", { name: "Add approver" }).click();
      const d2 = page.getByRole("dialog", { name: "Add approver" });
      await d2.getByRole("checkbox", { name: "Marcus Oyelaran" }).check();
      await d2.getByRole("button", { name: "Request approvals" }).click();
      const refusal = (
        await d2
          .getByRole("alert")
          .first()
          .innerText({ timeout: 10000 })
          .catch(() => "(no alert)")
      ).trim();
      await d2.getByRole("button", { name: "Cancel" }).click();
      const none = (await approvalsOf(A, docNo)).length;
      await addApprovers(A, ["Lena Vogel"]);
      const lenaReq = (await approvalsOf(A, docNo)).find(
        (a) => a.approver.displayName === "Lena Vogel",
      );
      const lp = S.lena.page;
      await lp.goto(`${BASE}/portal/approvals/${lenaReq.id}`);
      await lp.getByText("Your decision").first().waitFor({ timeout: 20000 });
      const lenaText = (await lp.locator("main").innerText()).replace(/\s+/g, " ");
      must(
        !offered.includes("Priya Raman") &&
          !offered.includes("Marcus Oyelaran") &&
          offered.includes("Lena Vogel"),
        `offered ${offered}`,
      );
      must(
        mark.status === 200 && refusal.includes("Marcus Oyelaran") && none === 0,
        `mark ${mark.status} refusal ${refusal} none ${none}`,
      );
      must(
        /No document attached/.test(lenaText) && !lenaText.includes("restricted.pdf"),
        `lena ${lenaText.slice(0, 300)}`,
      );
      const seededOffered = offered.filter((o) => !/DOC-0\d\d|doc0\d\d/i.test(o));
      return `Confidential C-${conf}: the picker offered ${offered.length} people; the seeded ones were ${q(seededOffered)} (no Priya Raman or Marcus Oyelaran; Business Users present). Open C-${docNo} with its primary Document marked Confidential (${mark.status}): asking Marcus Oyelaran showed ${q(refusal)} and ${none} requests exist. Asking Lena Vogel succeeded; her review page read ${q(lenaText.slice(0, 220))}.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName, D.displayName],
    "/contracts/:number/approvals Apply group with a default group",
    "A Contract inherits its type's default group; the dialog starts on it; under Administrators only a Legal Team Member cannot change the choice and sees Only an administrator can choose a different group.; an archived default shows Default group unavailable — contact an administrator",
    "Dialog starts on the default; the lock follows the role and the setting; the archived default reads as unavailable and another group can be chosen by someone allowed to override.",
    async () => {
      const n = await quickContract(A, `${role} default group`, {
        contractTypeId: FX.defaultType.id,
        managerId: uid(A.displayName),
      });
      await openContract(A, n, "approvals");
      await card().getByRole("button", { name: "Apply group" }).click();
      const d = page.getByRole("dialog", { name: "Apply approver group" });
      const box = d.getByRole("combobox", { name: "Approver group" });
      const start = await box.locator("option:checked").innerText();
      const openEnabled = await box.isEnabled();
      await d.getByRole("button", { name: "Cancel" }).click();
      // Organization setting: Administrators only, set and put back around this check.
      const set = await D.api("PUT", "/org/approval-policy", {
        allowLegalApproverGroupOverride: false,
      });
      results.orgSettings.push({
        at: new Date().toISOString(),
        setting: "Who can override a default approver group?",
        value: "Administrators only",
        by: "Daniel Okafor (API, fixture)",
        status: set.status,
      });
      let lockedEnabled, lockedText, direct;
      try {
        await page.reload();
        await card().getByRole("button", { name: "Apply group" }).click();
        lockedEnabled = await box.isEnabled();
        lockedText = (await d.innerText()).replace(/\s+/g, " ");
        await d.getByRole("button", { name: "Cancel" }).click();
        direct = await A.api("POST", `/contracts/${n}/approvals/group`, { groupId: FX.group.id });
      } finally {
        const back = await D.api("PUT", "/org/approval-policy", {
          allowLegalApproverGroupOverride: true,
        });
        results.orgSettings.push({
          at: new Date().toISOString(),
          setting: "Who can override a default approver group?",
          value: "Legal team members and administrators",
          by: "Daniel Okafor (API, restored)",
          status: back.status,
        });
      }
      // Archived default.
      const arch = await D.api("POST", `/approver-groups/${FX.defaultGroup.id}/archive`, {});
      let unavailable, canChoose;
      try {
        await page.reload();
        await card().getByRole("button", { name: "Apply group" }).click();
        unavailable = await box.locator("option:checked").innerText();
        canChoose = await box.isEnabled();
        await d.getByRole("button", { name: "Cancel" }).click();
      } finally {
        await D.api("POST", `/approver-groups/${FX.defaultGroup.id}/restore`, {});
      }
      const expectLocked = role === "legal_team_member";
      must(start === FX.defaultGroup.name && openEnabled, `start ${start} enabled ${openEnabled}`);
      must(
        expectLocked
          ? !lockedEnabled &&
              lockedText.includes("Only an administrator can choose a different group.")
          : lockedEnabled && !lockedText.includes("Only an administrator"),
        `locked ${lockedEnabled} ${lockedText}`,
      );
      must(expectLocked ? direct.status === 403 : direct.status < 300, `direct ${direct.status}`);
      must(
        arch.status < 300 &&
          unavailable === "Default group unavailable — contact an administrator" &&
          canChoose,
        `archived ${arch.status} ${unavailable} ${canChoose}`,
      );
      if (!expectLocked) {
        const rows = await approvalsOf(A, n);
        for (const r of rows.filter((x) => x.status === "pending"))
          await A.api("DELETE", `/approvals/${r.id}`);
      }
      return `C-${n} of type ${q(FX.defaultType.displayName)} opened Apply approver group on ${q(start)} (select enabled: ${openEnabled}). With the organization setting at Administrators only (set ${set.status}, restored right after), the select was ${lockedEnabled ? "enabled" : "disabled"} and the dialog ${lockedText.includes("Only an administrator") ? 'said "Only an administrator can choose a different group."' : "showed no lock note"}; applying a different group through the API answered ${direct.status}${expectLocked ? "" : " (the requests it made were cancelled)"}. With the default group archived (${arch.status}) the dialog started on ${q(unavailable)} and the select was enabled for this person; the group was restored.`;
    },
  );
}
SECTIONS["contract-approvals"] = async () => {
  if (!FX.defaultType) {
    const g = await D.api("POST", "/approver-groups", {
      name: `${P} default group ${stamp}`,
      memberIds: [uid("Priya Raman"), uid("Tom Iwu")],
    });
    must(g.status === 201, `default group ${g.status} ${q(g.json)}`);
    FX.defaultGroup = g.json.approverGroup ?? g.json.group;
    FX.defaultType = await makeType("Default group type");
    const set = await D.api("PUT", `/contract-types/${FX.defaultType.id}/approval-default`, {
      groupId: FX.defaultGroup.id,
    });
    must(set.status < 300, `approval default ${set.status} ${q(set.json)}`);
    fixture(
      "Approver group",
      FX.defaultGroup.name,
      "Priya Raman and Tom Iwu; the default group of the next type",
    );
    fixture(
      "Contract type",
      FX.defaultType.displayName,
      `default approver group ${FX.defaultGroup.name}`,
    );
  }
  for (const role of ROLES) {
    const A = role === "administrator" ? S.daniel : S.nadia;
    const O = role === "administrator" ? S.nadia : S.daniel;
    await contractApprovals(role, A, O);
  }
};

// =====================================================================
// =====================================================================
// Extra check on an owned lab with the e2e signing stand-in (SIGNING=1):
// "A confirmed send from the Contract's Signatures tab also moves the Contract to a
// Signature Status. That move does not open Move past approval. It records no
// override, even when approvals remain Pending or Rejected."
// =====================================================================
async function signingSection() {
  const art = "contract-approvals";
  const sc = "V-C16";
  // Fixture: the Administrator saves and enables a Polling connector that points at the
  // stand-in. The RSA key is generated in memory and never written.
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const put = await D.api("PUT", "/signing-connectors/docusign", {
    updateMode: "polling",
    environment: "demo",
    integrationKey: "doc032-contracts-standin-integration-key",
    apiUserId: "99999999-8888-7777-6666-555555555555",
    privateKey,
  });
  must(put.status === 200, `connector ${put.status} ${q(put.json)}`);
  let conn = (await D.api("GET", "/signing-connectors/docusign")).json.connector;
  if (!conn.enabled) {
    const en = await D.api("POST", "/signing-connectors/docusign/enable", {});
    must(en.status < 300, `enable ${en.status} ${q(en.json)}`);
  }
  const test = await D.api("POST", "/signing-connectors/docusign/test", {});
  conn = (await D.api("GET", "/signing-connectors/docusign")).json.connector;
  fixture(
    "Signing connector",
    "DocuSign (Demo, Polling) pointing at the e2e signing stand-in",
    `saved ${put.status}; enabled ${conn.enabled}; test ${test.status} ${q(test.json?.accountName ?? test.json?.detail ?? test.json)}`,
  );
  must(conn.enabled && test.status < 300, `connector not usable: test ${test.status}`);

  for (const role of ROLES) {
    const A = role === "administrator" ? S.daniel : S.nadia;
    const page = A.page;
    const card = () => approvalsCard(page);
    const number = await quickContract(A, `${role} send bypass`, { managerId: uid(A.displayName) });
    await uploadPrimary(A, number, `doc032-contracts-${role}-send.pdf`);
    await step(
      art,
      sc,
      role,
      [A.displayName, "Priya Raman"],
      "/contracts/:number/signatures Send for signature",
      "Move beyond Approval, second paragraph: at an Approval Status with one Pending and one Rejected approval, a confirmed send from the Signatures tab moves the Contract to a Signature Status without opening Move past approval and records no override",
      "No Move past approval dialog; a new Out for signature row; the Contract is at a Signature Status; approvals keep Pending and Rejected; History has no override entry.",
      async () => {
        await openContract(A, number);
        await stageMove(A, number, "Awaiting approval");
        await openContract(A, number, "approvals");
        await card().waitFor();
        await addApprovers(A, ["Priya Raman", "Tom Iwu"]);
        // Second actor: Priya rejects her request (fixture state through her API session).
        const pr = (await approvalsOf(A, number)).find(
          (a) => a.approver.displayName === "Priya Raman",
        );
        const rej = await S.priya.api("POST", `/approvals/${pr.id}/decision`, {
          decision: "rejected",
          note: `${P} rejected before the send.`,
        });
        must(rej.status < 300, `reject ${rej.status} ${q(rej.json)}`);
        const before = (await getContract(A, number)).contract;
        await section(A, "Signatures");
        await page.waitForURL((u) => u.pathname === `/contracts/${number}/signatures`);
        await page.getByRole("button", { name: "Send for signature" }).first().click();
        const d = page.getByRole("dialog", { name: "Send for signature" });
        await d.waitFor();
        const versionText = await d
          .getByLabel("Version")
          .locator("option:checked")
          .innerText()
          .catch(() => "(no Version select)");
        await d.getByLabel("Signer 1 name").fill("Mara Quint");
        await d.getByLabel("Signer 1 email").fill("mara.quint@northwind.example");
        // The dialog holds a required question that electronic-signing.md does not name.
        const roundQuestion = d.getByRole("group", {
          name: "Will the agreement be fully signed when this DocuSign round is complete?",
        });
        const hasRoundQuestion = (await roundQuestion.count()) > 0;
        const sendDisabledBefore = await d
          .getByRole("button", { name: "Send envelope" })
          .isDisabled();
        if (hasRoundQuestion)
          await roundQuestion.getByRole("radio", { name: /^Yes, all required signatures/ }).check();
        let gateSeen = false;
        const gateWatch = page
          .getByRole("dialog", { name: "Move past approval" })
          .waitFor({ timeout: 15000 })
          .then(() => (gateSeen = true))
          .catch(() => {});
        await d.getByRole("button", { name: "Send envelope" }).click();
        await d.waitFor({ state: "hidden", timeout: 30000 });
        const row = await until(
          async () => {
            const t = (await page.locator("main").innerText()).replace(/\s+/g, " ");
            return /Out for signature/.test(t) ? t : null;
          },
          "Out for signature row",
          30000,
        );
        await gateWatch;
        const after = await until(async () => {
          const c = (await getContract(A, number)).contract;
          return c.stage === "signature" ? c : null;
        }, "Signature Stage");
        const states = (await approvalsOf(A, number)).map(
          (a) => `${a.approver.displayName}:${a.status}`,
        );
        const hist = await history(page);
        const override = /past approval|overrid/i.test(hist);
        const statusLine = hist.match(/[^.]{0,80}(?:status|Out for signature)[^.]{0,80}/i)?.[0];
        if (role === "legal_team_member")
          await page.screenshot({ path: path.join(here, "c16-send-without-gate.png") });
        must(before.statusName === "Awaiting approval", `before ${before.statusName}`);
        must(!gateSeen, "Move past approval opened");
        must(
          states.includes("Priya Raman:rejected") && states.includes("Tom Iwu:pending"),
          `states ${states}`,
        );
        must(!override, `override in history ${hist.slice(0, 300)}`);
        return `C-${number} stood at ${q(before.statusName)} (${before.stage}) with ${q(states)}. Signatures > Send for signature opened the dialog with Version ${q(versionText)}. With one Signer filled, Send envelope was ${sendDisabledBefore ? "disabled" : "enabled"}${hasRoundQuestion ? ' until "Yes, all required signatures will be in place" was chosen under "Will the agreement be fully signed when this DocuSign round is complete?" (a required question electronic-signing.md does not name)' : ""}; Send envelope closed the dialog. Move past approval did not open within 15 s. The tab then showed ${q(row.match(/[^.]{0,60}Out for signature[^.]{0,80}/)?.[0])}. The Contract is now ${q(after.statusName)} (${after.stage}). Approvals kept ${q(states)}. History shows no override entry; its status line reads ${q(statusLine)}.`;
      },
    );
  }
  // Put the owned lab's connector back to disabled.
  await D.api("POST", "/signing-connectors/docusign/disable", {});
}

try {
  if (process.env.CLEANUP_ONLY) {
    console.log(await cleanupFixtures());
  } else if (SIGNING) {
    await signingSection();
  } else {
    await setupFixtures();
    await SECTIONS["contract-approvals"]();
    if (!process.env.KEEP_FIXTURES) results.cleanup = await cleanupFixtures();
  }
} finally {
  save();
  await closeBrowser();
}
const failed = results.steps.filter((s) => s.result !== "pass").length;
console.log(`${results.steps.length} steps, ${failed} not passed`);
