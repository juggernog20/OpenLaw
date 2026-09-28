// DOC-032 independent walkthrough, group contracts-2: terms-and-renewals (V-C18).
// Written by the DOC-032 independent walkthrough agent (contracts-2) from the text of the
// guide. The agent did not write it. Copied from the last passing script, DOC-030
// signing-2/walkthrough.mjs (its terms-and-renewals part), and adapted to the DOC-032 text:
// Renew and the Renewals rows are on the Contract's Approvals tab.
//
// Run from the worktree root against the shared work lab:
//   LAB_PASSWORD=... node docs/documentation/batches/DOC-032/contracts-2/walkthrough-terms.mjs
// Optional: ROLES=legal_team_member,administrator
// The seed password comes from the environment. The Business User's magic link is
// read from the lab Mailpit at run time and never written. The log holds no
// credentials, cookies, links or raw mail.
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  BASE,
  PEOPLE,
  articleHash,
  closeBrowser,
  here,
  lab,
  launch,
  must,
  passwordSession,
  pdf,
  portalSession,
  q,
  recorder,
  sha,
  sleep,
  tidy,
  until,
} from "./api.mjs";

const ONLY = (process.env.ONLY ?? "terms-and-renewals").split(",");
const ROLES = (process.env.ROLES ?? "legal_team_member,administrator").split(",");
const stamp = Date.now();
const G = "DOC-032 contracts-2";
const REL = "docs/documentation/batches/DOC-032/contracts-2";

const {
  results,
  step: rawStep,
  save,
} = recorder(process.env.OUT ?? path.join(here, "walkthrough-terms.json"), {
  kind: "independent-article-walkthrough-log",
  task: "DOC-032",
  group: "contracts-2",
  issue: 1194,
  walkthroughReviewer: "DOC-032 independent walkthrough agent (contracts-2)",
  reviewerKind: "agent",
  appCommit: lab.sourceCommit,
  environment: lab.project,
  lab: lab.name,
  appUrl: BASE,
  mailUrl: lab.mailUrl,
  buildId: `app ${lab.appImageId}; engine ${lab.engineImageId}`,
  containerImages: lab.containerImages,
  seed: lab.seed,
  browser:
    "Playwright 1.63.0 Chromium, headless, 1280x900 CSS px, one isolated context per identity",
  articleHashes: {
    "terms-and-renewals": articleHash("terms-and-renewals"),
  },
  selection: { articles: ONLY, roles: ROLES },
  stamp,
  records: [],
  screenshots: [],
});
const step = (article, scenario, role, actors, pageName, action, expected, fn) =>
  rawStep(article, scenario, role, actors, pageName, action, expected, fn);

await launch();
const S = {
  daniel: await passwordSession(PEOPLE.daniel),
  nadia: await passwordSession(PEOPLE.nadia),
};
const users = (await S.daniel.api("GET", "/users")).json.users;
const userByName = (name) => {
  const u = users.find((x) => x.displayName === name);
  if (!u) throw new Error(`no user ${name}`);
  return u;
};
const uid = (name) => userByName(name).id;
const options = (await S.daniel.api("GET", "/contracts/options")).json;
const typeId = (name) => options.contractTypes.find((t) => t.displayName === name).id;
// The Business User for the negative checks. Jonas Weber's link budget is shared by
// many agents, so this group uses Karim Aziz from the same seed.
const BU = { name: "Karim Aziz", email: userByName("Karim Aziz").email, role: "business_user" };
let buSession = null;
const business = async () => {
  if (!buSession) {
    buSession = await portalSession(BU);
    watch(buSession.page);
  }
  return buSession;
};
results.identities = [
  { role: "administrator", person: "Daniel Okafor", entry: "password sign-in" },
  { role: "legal_team_member", person: "Nadia Haddad", entry: "password sign-in" },
  {
    role: "business_user (negative check only)",
    person: "Karim Aziz",
    entry: "new magic link from the work lab Mailpit, Portal sign-in",
  },
];

// ---------- shared page helpers ----------
/** Wait for a region; if it does not appear, note what the page showed, reload once, and log the retry. */
results.retries = [];
// Other agents create and remove lab networks on this host; Chromium then aborts
// in-flight requests with net::ERR_NETWORK_CHANGED and the app shows its error page.
// settle() reloads once and logs the retry with the aborted requests as its cause.
const aborted = new WeakMap();
function watch(page) {
  aborted.set(page, []);
  page.on("requestfailed", (r) =>
    aborted.get(page).push({
      t: Date.now(),
      what: `${r.method()} ${new URL(r.url()).pathname} ${r.failure()?.errorText ?? ""}`,
    }),
  );
}
async function settle(page, locator, label, timeout = 30000) {
  try {
    await locator.waitFor({ timeout });
    return;
  } catch {
    const shown = tidy(
      await page
        .locator("body")
        .innerText()
        .catch(() => ""),
    ).slice(0, 240);
    const dbg = process.env.DEBUG_SHOTS;
    if (dbg)
      await page.screenshot({ path: path.join(dbg, `retry-${Date.now()}.png`) }).catch(() => {});
    const cause = (aborted.get(page) ?? [])
      .filter((x) => Date.now() - x.t < timeout + 15000)
      .map((x) => x.what);
    results.retries.push({
      at: new Date().toISOString(),
      page: new URL(page.url()).pathname,
      waitedFor: label,
      shown,
      abortedRequests: cause.slice(0, 8),
    });
    await page.reload();
    await locator.waitFor({ timeout });
  }
}
const getContract = async (s, n) => (await s.api("GET", `/contracts/${n}`)).json?.contract;
async function openContract(s, n, tab = "") {
  await s.page.goto(`${BASE}/contracts/${n}${tab ? `/${tab}` : ""}`);
  await settle(s.page, s.page.getByRole("heading", { level: 1 }), "record heading");
  await s.page.waitForLoadState("networkidle").catch(() => {});
}
async function stageMove(s, n, statusName) {
  const page = s.page;
  await page.getByRole("button", { name: /— move contract$/ }).click();
  const menu = page.getByRole("menu");
  await menu.waitFor();
  const items = tidy(await menu.getByRole("menuitemradio").allInnerTexts());
  await menu.getByRole("menuitemradio").filter({ hasText: statusName }).first().click();
  const gate = page.getByRole("dialog", { name: "Move past approval" });
  let gated = false;
  await until(async () => {
    if (await gate.isVisible().catch(() => false)) return (gated = true);
    return (await getContract(s, n)).statusName === statusName;
  }, `status ${statusName}`);
  return { items, gated, gate };
}
async function history(page) {
  const applet = page.getByRole("complementary", { name: "History" });
  if (!(await applet.isVisible().catch(() => false)))
    await page.getByRole("button", { name: "History" }).click();
  await applet.getByRole("list", { name: "History" }).waitFor();
  await sleep(600);
  const t = await applet.getByRole("list", { name: "History" }).innerText();
  await applet.getByRole("button", { name: "Close" }).click();
  return t.replace(/\s+/g, " ");
}
const docsCard = (page) => page.getByRole("region", { name: "Documents", exact: true });
const rowOf = (page, title) =>
  page
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: `Actions for ${title}`, exact: true }) });
const versionRowOf = (page, n, title) =>
  page.getByRole("row").filter({
    has: page.getByRole("button", { name: `Actions for version ${n} of ${title}`, exact: true }),
  });
async function versionCell(row) {
  return tidy(await row.locator("td").filter({ hasText: /^v\d+/ }).first().innerText());
}
async function selectedText(select) {
  return (await select.locator("option:checked").innerText()).trim();
}
async function optionTexts(select) {
  return (await select.locator("option").allInnerTexts()).map((t) => t.trim());
}
async function chooseFile(page, dialog, file) {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    dialog.getByRole("button", { name: /Choose files?$/ }).click(),
  ]);
  await chooser.setFiles(file);
}
async function menuPick(page, buttonName, item) {
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  const menu = page.getByRole("menu");
  await menu.waitFor();
  const items = tidy(await menu.getByRole("menuitem").allInnerTexts());
  if (item) await menu.getByRole("menuitem", { name: item, exact: true }).click();
  else {
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
  }
  return items;
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(here, name) }).catch(() => {});
  results.screenshots.push(`${REL}/${name}`);
}
async function withResponse(page, match, action, timeout = 20000) {
  const wait = page.waitForResponse((r) => r.url().includes("/api/v1/") && match(r), { timeout });
  wait.catch(() => {});
  await action();
  return (await wait).status();
}
const isPatchOf = (n) => (r) =>
  r.request().method() === "PATCH" && new URL(r.url()).pathname === `/api/v1/contracts/${n}`;
const isRenewal = (n) => (r) =>
  r.request().method() === "POST" && r.url().endsWith(`/contracts/${n}/renewal`);

const MONTHS =
  "January February March April May June July August September October November December".split(
    " ",
  );
const ordinal = (d) => {
  const s = ["th", "st", "nd", "rd"];
  const v = d % 100;
  return d + (s[(v - 20) % 10] || s[v] || s[0]);
};
/** Pick a date in the record's calendar picker by its month and year dropdowns. */
async function pickDate(page, triggerName, iso) {
  const [y, m, d] = iso.split("-").map(Number);
  await page.getByRole("button", { name: triggerName, exact: true }).click();
  const cal = page.getByRole("dialog", { name: "Choose a date" });
  await cal.getByRole("combobox", { name: "Year" }).selectOption(String(y));
  await cal.getByRole("combobox", { name: "Month" }).selectOption(String(m - 1));
  await cal
    .getByRole("grid")
    .getByRole("button", { name: new RegExp(`${MONTHS[m - 1]} ${ordinal(d)}, ${y}$`) })
    .click();
  await cal.waitFor({ state: "hidden" });
}
const isoPlusDays = (days) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// =====================================================================
// V-C18  terms-and-renewals
// =====================================================================
async function termsAndRenewals(role, A, O) {
  const art = "terms-and-renewals";
  const sc = "V-C18";
  const p = A.page;
  const actors = [A.displayName];
  const tag = `${role} ${stamp}`;
  const parentTitle = `${G} ${sc} ${tag}`;
  let num;
  const read = async (n = num, s = A) => getContract(s, n);
  const overview = async (n = num) => {
    await p.goto(`${BASE}/contracts/${n}`);
    await settle(
      p,
      p.getByRole("heading", { name: "Contract", exact: true, level: 2 }),
      "Contract card heading",
    );
    await p.waitForLoadState("networkidle").catch(() => {});
  };
  const contractCard = () =>
    p
      .locator("section")
      .filter({ has: p.getByRole("heading", { name: "Contract", exact: true, level: 2 }) })
      .last();
  const keyDateRows = async () => {
    await p.goto(`${BASE}/contracts/${num}/key-dates`);
    const region = p.getByRole("region", { name: "Key dates" });
    await settle(p, region, "Key dates region");
    await sleep(800);
    const rows = region.getByRole("row");
    const count = await rows.count();
    const out = [];
    for (let i = 1; i < count; i++) {
      const row = rows.nth(i);
      out.push({
        text: tidy(await row.innerText()),
        actions: await row.getByRole("button").count(),
      });
    }
    return out;
  };
  // "Open Approvals": the record's Approvals tab in the Contract sections navigation.
  const approvals = async (page = p, n = num) => {
    await page.goto(`${BASE}/contracts/${n}`);
    const tab = page
      .getByRole("navigation", { name: "Contract sections" })
      .getByRole("link", { name: /^Approvals/ });
    await settle(page, tab, "Approvals tab link");
    await tab.click();
    await settle(
      page,
      page.getByRole("region", { name: "Approvals", exact: true }),
      "Approvals region",
    );
    await sleep(600);
  };
  // The Renewals block under the Approvals block: a table named by its "Renewals" heading.
  const renewRows = async () =>
    p
      .getByRole("region", { name: "Approvals", exact: true })
      .getByRole("table", { name: "Renewals" })
      .getByText(/Term advanced to/)
      .count();

  const ok = await step(
    art,
    sc,
    role,
    actors,
    "fixture (API)",
    "Prerequisite: an unarchived NDA Contract with an Entity, a Counterparty, a value, High priority and risk, the Confidential flag, and the other staff role and a Business User on the team",
    "The record exists for this role",
    async () => {
      const created = await A.api("POST", "/contracts", {
        title: parentTitle,
        contractTypeId: typeId("NDA"),
        managerId: uid(A.displayName),
        isConfidential: true,
        customFields: {},
      });
      must(created.status === 201, `create ${created.status} ${q(created.json)}`);
      num = created.json.contract.number;
      for (const name of [O.displayName, BU.name]) {
        const t = await A.api("POST", `/contracts/${num}/team`, { userId: uid(name) });
        must(t.status < 300, `team add ${name} ${t.status}`);
      }
      const ent = (await A.api("GET", "/entities?limit=100")).json;
      const list = ent.entities ?? ent.items ?? ent.rows ?? [];
      const entity =
        list.find((e) => /^Helix/.test(e.legalName) && !e.archivedAt) ??
        list.find((e) => !/^DOC-0/.test(e.legalName) && !e.archivedAt) ??
        list[0];
      for (const body of [
        { entityId: entity.id },
        { value: { amount: 990000, currency: "GBP", cadence: "annually" } },
        { priority: "high" },
        { risk: "high" },
      ]) {
        const r = await A.api("PATCH", `/contracts/${num}`, body);
        must(r.status === 200, `PATCH ${Object.keys(body)[0]} ${r.status}`);
      }
      const cp = await A.api("POST", `/contracts/${num}/counterparties`, {
        name: `${G} Counterparty ${tag}`,
      });
      must(cp.status < 300, `counterparty ${cp.status}`);
      results.records.push({
        article: art,
        role,
        purpose: "term and renewal",
        reference: `C-${num}`,
        title: parentTitle,
      });
      return `C-${num} "${parentTitle}" (NDA) by ${A.displayName}; entity ${entity.legalName}; value GBP 9,900.00 annually; High priority and risk; Confidential; team adds ${O.displayName} and ${BU.name}.`;
    },
  );
  if (!ok) return;

  await step(
    art,
    sc,
    role,
    actors,
    "Overview",
    "Record the term: on Overview use the Contract card; its Rows follow the Contract type's Form; choose Term type Fixed term, then Effective date, Expiry date and Notice period (days), one change at a time",
    "The term controls sit in the Contract card in the NDA Form's order; Fixed term offers no renewal-period value; each value saves on its own; the notice deadline is expiry minus the notice period",
    async () => {
      await overview();
      const card = contractCard();
      const labels = tidy(await card.locator("label").allInnerTexts()).filter(Boolean);
      const form = options.contractTypes
        .find((t) => t.displayName === "NDA")
        .form.map((r) => r.rowRef);
      // Renewal period (months) is a read-only Row (no <label>) until the type is Auto-renewing,
      // so the order check reads the card's text for all five names.
      const cardText = tidy(await card.innerText());
      const want = [
        "Term type",
        "Effective date",
        "Expiry date",
        "Renewal period (months)",
        "Notice period (days)",
      ];
      const idx = want.map((w) => cardText.indexOf(w));
      must(
        idx.every((i) => i >= 0) && idx.every((i, k) => k === 0 || i > idx[k - 1]),
        `card text ${cardText.slice(0, 600)}`,
      );
      const termType = card.getByRole("combobox", { name: "Term type" });
      const typeOptions = await optionTexts(termType);
      const s1 = await withResponse(p, isPatchOf(num), () =>
        termType.selectOption({ label: "Fixed term" }),
      );
      await sleep(500);
      const renewal = p.getByRole("spinbutton", { name: "Renewal period (months)" });
      const renewalEditable =
        (await renewal.count()) > 0 && (await renewal.isEditable().catch(() => false));
      const s2 = await withResponse(p, isPatchOf(num), () =>
        pickDate(p, "Effective date", "2026-02-01"),
      );
      const s3 = await withResponse(p, isPatchOf(num), () =>
        pickDate(p, "Expiry date", "2027-01-31"),
      );
      const notice = p.getByRole("spinbutton", { name: "Notice period (days)" });
      await notice.fill("30");
      const s4 = await withResponse(p, isPatchOf(num), () => notice.press("Tab"));
      must(
        [s1, s2, s3, s4].every((s) => s === 200),
        `PATCH ${s1} ${s2} ${s3} ${s4}`,
      );
      const c = await read();
      must(
        c.termType === "fixed" &&
          c.effectiveDate === "2026-02-01" &&
          c.expiryDate === "2027-01-31" &&
          c.noticePeriodDays === 30,
        `saved ${q([c.termType, c.effectiveDate, c.expiryDate, c.noticePeriodDays])}`,
      );
      must(!renewalEditable, "Renewal period editable on Fixed term");
      must(c.noticeDeadline === "2027-01-01", `notice deadline ${c.noticeDeadline}`);
      await overview();
      const eff = tidy(
        await p.getByRole("button", { name: "Effective date", exact: true }).innerText(),
      );
      const exp = tidy(
        await p.getByRole("button", { name: "Expiry date", exact: true }).innerText(),
      );
      return `Contract card labels in order: ${q(labels.join(" | "))}; the five term Rows appear in the order ${want.join(", ")} (NDA Form rows: ${form.join(", ")}). Term type offered ${q(typeOptions.join(", "))}. Four separate saves answered 200. Renewal period (months) was ${renewalEditable ? "editable" : (await renewal.count()) ? "shown but not editable" : "shown read-only with no value"} on Fixed term. After reload the pickers read "${eff}" and "${exp}", notice 30 days; read-back notice deadline ${c.noticeDeadline} (Jan 31, 2027 minus 30 days).`;
    },
  );

  await step(
    art,
    sc,
    role,
    actors,
    "Overview; Key dates",
    "Term timeline draws the recorded dates; Key dates shows Current term expires and Renewal notice deadline derived from the term",
    "Derived rows match the term and carry no row actions",
    async () => {
      await overview();
      const timeline = tidy(await p.getByRole("region", { name: "Term timeline" }).innerText());
      must(
        !/No term dates|No effective date|No expiry date/.test(timeline),
        `timeline ${timeline}`,
      );
      const rows = await keyDateRows();
      const exp = rows.find((r) => r.text.includes("Current term expires"));
      const nd = rows.find((r) => r.text.includes("Renewal notice deadline"));
      must(
        exp &&
          exp.text.startsWith("Jan 31, 2027") &&
          exp.text.includes("Derived") &&
          exp.actions === 0,
        `expiry row ${q(exp)}`,
      );
      must(
        nd &&
          nd.text.startsWith("Jan 1, 2027") &&
          nd.text.includes("30 days before expiry") &&
          nd.actions === 0,
        `notice row ${q(nd)}`,
      );
      return `Term timeline: ${q(timeline.slice(0, 180))}. Key dates rows: "${exp.text}" and "${nd.text}", each with 0 row actions.`;
    },
  );

  await step(
    art,
    sc,
    role,
    actors,
    "Overview",
    "Change Term type to Auto-renewing and enter Renewal period (months)",
    "Auto-renewing accepts a renewal period in months",
    async () => {
      await overview();
      const s1 = await withResponse(p, isPatchOf(num), () =>
        p.getByRole("combobox", { name: "Term type" }).selectOption({ label: "Auto-renewing" }),
      );
      await sleep(500);
      const renewal = p.getByRole("spinbutton", { name: "Renewal period (months)" });
      await renewal.fill("1");
      const s2 = await withResponse(p, isPatchOf(num), () => renewal.press("Tab"));
      const c = await read();
      must(
        s1 === 200 && s2 === 200 && c.termType === "auto_renew" && c.renewalPeriodMonths === 1,
        `saved ${c.termType} ${c.renewalPeriodMonths}`,
      );
      return `Term type Auto-renewing (PATCH ${s1}) and Renewal period 1 month (PATCH ${s2}) saved; expiry still ${c.expiryDate}.`;
    },
  );

  await step(
    art,
    sc,
    role,
    actors,
    "Overview; Key dates",
    "Change Term type to Evergreen and review the saved values",
    "Evergreen has no expiry date; the change clears the expiry and the renewal period",
    async () => {
      await overview();
      const s = await withResponse(p, isPatchOf(num), () =>
        p.getByRole("combobox", { name: "Term type" }).selectOption({ label: "Evergreen" }),
      );
      await overview();
      const c = await read();
      const expiryPicker = await p
        .getByRole("button", { name: "Expiry date", exact: true })
        .count();
      must(
        s === 200 &&
          c.termType === "evergreen" &&
          c.expiryDate === null &&
          c.renewalPeriodMonths === null,
        `saved ${q([c.termType, c.expiryDate, c.renewalPeriodMonths])}`,
      );
      must(expiryPicker === 0, "Expiry date picker still offered on Evergreen");
      const rows = await keyDateRows();
      return `Evergreen saved (PATCH ${s}); read-back expiry ${c.expiryDate}, renewal period ${c.renewalPeriodMonths}, effective date kept ${c.effectiveDate}; the card offers no Expiry date picker (${expiryPicker}). Key dates now lists: ${q(rows.map((r) => r.text).join(" | ") || "no derived term rows")}.`;
    },
  );

  await step(
    art,
    sc,
    role,
    actors,
    "Overview",
    "Back to Auto-renewing with expiry and renewal period, then change to Fixed term and review; finally restore Auto-renewing with a 1-month period",
    "Changing away from Auto-renewing clears the renewal period and keeps the expiry",
    async () => {
      await overview();
      await withResponse(p, isPatchOf(num), () =>
        p.getByRole("combobox", { name: "Term type" }).selectOption({ label: "Auto-renewing" }),
      );
      await sleep(500);
      await withResponse(p, isPatchOf(num), () => pickDate(p, "Expiry date", "2027-01-31"));
      const renewal = p.getByRole("spinbutton", { name: "Renewal period (months)" });
      await renewal.fill("1");
      await withResponse(p, isPatchOf(num), () => renewal.press("Tab"));
      await withResponse(p, isPatchOf(num), () =>
        p.getByRole("combobox", { name: "Term type" }).selectOption({ label: "Fixed term" }),
      );
      const fixed = await read();
      must(
        fixed.termType === "fixed" &&
          fixed.renewalPeriodMonths === null &&
          fixed.expiryDate === "2027-01-31",
        `after Fixed ${q([fixed.termType, fixed.renewalPeriodMonths, fixed.expiryDate])}`,
      );
      await overview();
      await withResponse(p, isPatchOf(num), () =>
        p.getByRole("combobox", { name: "Term type" }).selectOption({ label: "Auto-renewing" }),
      );
      await sleep(500);
      const renewal2 = p.getByRole("spinbutton", { name: "Renewal period (months)" });
      await renewal2.fill("1");
      await withResponse(p, isPatchOf(num), () => renewal2.press("Tab"));
      const c = await read();
      must(
        c.termType === "auto_renew" &&
          c.renewalPeriodMonths === 1 &&
          c.expiryDate === "2027-01-31" &&
          c.noticeDeadline === "2027-01-01",
        `final ${q([c.termType, c.renewalPeriodMonths, c.expiryDate, c.noticeDeadline])}`,
      );
      return `Auto-renewing -> Fixed term cleared the renewal period (null) and kept expiry 2027-01-31. Restored: Auto-renewing, expiry ${c.expiryDate}, renewal 1 month, notice 30 days, notice deadline ${c.noticeDeadline}.`;
    },
  );

  await step(
    art,
    sc,
    role,
    actors,
    "Key dates",
    "Negative: a Task due before the notice deadline does not feed the term-derived deadlines",
    "Current term expires and Renewal notice deadline stay derived from the term; the Task is not a Key date row",
    async () => {
      const t = await A.api("POST", `/contracts/${num}/tasks`, {
        title: `${G} early task ${tag}`,
        dueDate: "2026-12-01",
      });
      must(t.status === 201, `task ${t.status}`);
      const rows = await keyDateRows();
      const nd = rows.find((r) => r.text.includes("Renewal notice deadline"));
      const exp = rows.find((r) => r.text.includes("Current term expires"));
      must(
        nd?.text.startsWith("Jan 1, 2027") && exp?.text.startsWith("Jan 31, 2027"),
        `rows ${rows.map((r) => r.text).join(" | ")}`,
      );
      must(!rows.some((r) => r.text.includes("early task")), "Task appears in Key dates");
      const c = await read();
      must(
        c.noticeDeadline === "2027-01-01" && c.expiryDate === "2027-01-31",
        "term deadlines changed",
      );
      return `A Task due 2026-12-01 was added (fixture). Key dates still reads "${exp.text}" and "${nd.text}" and lists no Task row; read-back notice deadline ${c.noticeDeadline}.`;
    },
  );

  await step(
    art,
    sc,
    role,
    actors,
    "Approvals",
    "Confirm a renewal steps 1-3: open Approvals and select Renew; Confirm the roll is the default; a New expiry date that is not after the current expiry is refused; Cancel changes nothing; Paper as amendment is absent without a primary Document",
    "The dialog refuses the invalid date with its message; Cancel keeps the term; no Paper as amendment option",
    async () => {
      await approvals();
      await p.getByRole("button", { name: "Renew", exact: true }).click();
      const dialog = p.getByRole("dialog", { name: "Confirm renewal" });
      await dialog.waitFor();
      const vehicles = tidy(
        await dialog
          .getByRole("radio")
          .evaluateAll((els) =>
            els.map((e) => e.closest("label")?.innerText ?? e.getAttribute("aria-label") ?? ""),
          ),
      );
      const roll = dialog.getByRole("radio", { name: /Confirm the roll/ });
      must(await roll.isChecked(), "Confirm the roll not default");
      const amendment = await dialog.getByRole("radio", { name: /Paper as amendment/ }).count();
      const input = dialog.getByRole("textbox", { name: "New expiry date" });
      const proposed = await input.inputValue();
      const current = tidy(await dialog.getByText(/The term currently runs to/).innerText());
      await input.fill("2027-01-31");
      await dialog.getByRole("button", { name: "Confirm renewal" }).click();
      const alert = dialog.getByText(
        "A roll moves the term forward. Pick a date after the current expiry.",
      );
      await alert.waitFor({ timeout: 5000 });
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      const c = await read();
      must(proposed === "2027-02-28", `proposal ${proposed}`);
      must(amendment === 0, "Paper as amendment offered without a primary Document");
      must(c.expiryDate === "2027-01-31", `expiry ${c.expiryDate}`);
      return `Renew opened "Confirm renewal" with options ${q(vehicles.join(" / ").slice(0, 300))}; Confirm the roll was checked; "${current}"; proposed New expiry date ${proposed}; ${amendment} Paper as amendment options (no primary Document). Entering 2027-01-31 then Confirm renewal showed "A roll moves the term forward. Pick a date after the current expiry." Cancel left expiry ${c.expiryDate}.`;
    },
  );

  await step(
    art,
    sc,
    role,
    actors,
    "Approvals; Overview; Key dates",
    "Confirm a renewal step 4: Confirm renewal with the proposed date, then check the new expiry, notice deadline, Last renewal and the new row under Renewals on the Approvals tab; Status and Stage unchanged",
    "The term advances only through the confirmation; Status and Stage do not change",
    async () => {
      const before = await read();
      await approvals();
      await p.getByRole("button", { name: "Renew", exact: true }).click();
      const dialog = p.getByRole("dialog", { name: "Confirm renewal" });
      const proposed = await dialog.getByRole("textbox", { name: "New expiry date" }).inputValue();
      const status = await withResponse(p, isRenewal(num), () =>
        dialog.getByRole("button", { name: "Confirm renewal" }).click(),
      );
      await dialog.waitFor({ state: "hidden" });
      const c = await read();
      await approvals();
      const rows = await renewRows();
      const rowText = tidy(
        await p
          .getByRole("region", { name: "Approvals", exact: true })
          .getByRole("table", { name: "Renewals" })
          .getByText(/Term advanced to/)
          .first()
          .locator("xpath=ancestor::*[self::li or self::tr][1]")
          .innerText(),
      );
      await overview();
      const lastRenewal = tidy(
        await p.getByText("Last renewal", { exact: true }).locator("xpath=..").innerText(),
      );
      const kd = await keyDateRows();
      const nd = kd.find((r) => r.text.includes("Renewal notice deadline"));
      must(
        status === 200 && proposed === "2027-02-28" && c.expiryDate === "2027-02-28",
        `status ${status} proposal ${proposed} expiry ${c.expiryDate}`,
      );
      must(
        c.noticeDeadline === "2027-01-29" && nd?.text.startsWith("Jan 29, 2027"),
        `notice ${c.noticeDeadline} ${nd?.text}`,
      );
      must(rows === 1 && !/—$/.test(lastRenewal), `rows ${rows} last renewal "${lastRenewal}"`);
      must(
        c.statusName === before.statusName && c.stage === before.stage,
        `status moved ${before.statusName} -> ${c.statusName}`,
      );
      return `Confirm renewal (POST ${status}) moved expiry 2027-01-31 -> ${c.expiryDate}; notice deadline ${c.noticeDeadline} ("${nd.text}"); the Approvals tab shows ${rows} row under Renewals: "${rowText}"; Overview "${lastRenewal}"; Status stays ${c.statusName} (${c.stage}).`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName, O.displayName],
    "Approvals",
    "Stale date: with Renew open, the other staff role changes the expiry; Confirm renewal is refused and the dialog shows the refreshed expiry; Cancel and reopen Renew gives a fresh proposed date",
    "A stale roll is refused and re-read; no second roll is recorded",
    async () => {
      await approvals();
      await p.getByRole("button", { name: "Renew", exact: true }).click();
      const dialog = p.getByRole("dialog", { name: "Confirm renewal" });
      const input = dialog.getByRole("textbox", { name: "New expiry date" });
      const proposal = await input.inputValue();
      const moved = await O.api("PATCH", `/contracts/${num}`, { expiryDate: "2027-04-30" });
      must(moved.status === 200, `other PATCH ${moved.status}`);
      await sleep(1500);
      const status = await withResponse(p, isRenewal(num), () =>
        dialog.getByRole("button", { name: "Confirm renewal" }).click(),
      );
      const refusal = tidy(await dialog.getByRole("alert").first().innerText());
      await sleep(1000);
      const current = tidy(await dialog.getByText(/The term currently runs to/).innerText());
      const kept = await input.inputValue();
      await shot(p, `${role}-renewal-stale-refused.png`);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      await p.getByRole("button", { name: "Renew", exact: true }).click();
      const d2 = p.getByRole("dialog", { name: "Confirm renewal" });
      const fresh = await d2.getByRole("textbox", { name: "New expiry date" }).inputValue();
      await d2.getByRole("button", { name: "Cancel" }).click();
      const c = await read();
      await approvals();
      const rows = await renewRows();
      must(status === 409 && refusal.length > 0, `status ${status} refusal "${refusal}"`);
      must(
        /Apr 30, 2027/.test(current) &&
          fresh === "2027-05-30" &&
          c.expiryDate === "2027-04-30" &&
          rows === 1,
        `current "${current}" fresh ${fresh} expiry ${c.expiryDate} rows ${rows}`,
      );
      return `Dialog proposed ${proposal}; ${O.displayName} moved expiry to 2027-04-30 (second actor's API write). Confirm renewal answered ${status}: "${refusal}". The dialog then said "${current}" and kept the entered ${kept}. Cancel and reopen proposed ${fresh}. Expiry ${c.expiryDate}; renewal rows still ${rows}.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName, O.displayName],
    "Approvals (two browser contexts)",
    "Competing confirmations: both staff roles open Renew on the same expiry; the first Confirm renewal records the roll and the second is refused",
    "Two competing confirmations do not record the same roll twice",
    async () => {
      const q2 = O.page;
      await approvals();
      await approvals(q2);
      await p.getByRole("button", { name: "Renew", exact: true }).click();
      await q2.getByRole("button", { name: "Renew", exact: true }).click();
      const d1 = p.getByRole("dialog", { name: "Confirm renewal" });
      const d2 = q2.getByRole("dialog", { name: "Confirm renewal" });
      const v1 = await d1.getByRole("textbox", { name: "New expiry date" }).inputValue();
      const v2 = await d2.getByRole("textbox", { name: "New expiry date" }).inputValue();
      const s1 = await withResponse(p, isRenewal(num), () =>
        d1.getByRole("button", { name: "Confirm renewal" }).click(),
      );
      const s2 = await withResponse(q2, isRenewal(num), () =>
        d2.getByRole("button", { name: "Confirm renewal" }).click(),
      );
      const refusal = tidy(await d2.getByRole("alert").first().innerText());
      await d2.getByRole("button", { name: "Cancel" }).click();
      const c = await read();
      await approvals();
      const rows = await renewRows();
      must(
        s1 === 200 && s2 === 409 && rows === 2 && c.expiryDate === "2027-05-30",
        `s1 ${s1} s2 ${s2} rows ${rows} expiry ${c.expiryDate}`,
      );
      return `Both dialogs proposed ${v1} / ${v2}. ${A.displayName}'s Confirm renewal answered ${s1}; ${O.displayName}'s answered ${s2}: "${refusal}". Expiry ${c.expiryDate}; renewal rows ${rows} (one per distinct roll).`;
    },
  );

  await step(
    art,
    sc,
    role,
    actors,
    "Documents; Approvals",
    "Paper as amendment: upload the first Document; reopen Renew without a reload, then reload the record and reopen Renew; File the amendment opens Add version with Type set to Amendment; the new Version is not executed until marked, and marking replaces the chain's designation",
    "The option appears after a reload; Add version opens on the primary Document with Type Amendment; no new Contract; no expiry change",
    async () => {
      const before = await read();
      await p.goto(`${BASE}/contracts/${num}/documents`);
      await settle(p, docsCard(p).getByRole("heading", { name: "Documents" }), "Documents card");
      await docsCard(p).getByRole("button", { name: "Upload", exact: true }).click();
      const up = p.getByRole("dialog", { name: "Upload document" });
      await up.waitFor();
      await chooseFile(p, up, {
        name: `doc032-contracts-2-${role}-agreement.pdf`,
        mimeType: "application/pdf",
        buffer: pdf(`${G} ${tag} agreement`),
      });
      await up.getByRole("button", { name: "Upload", exact: true }).click();
      await up.waitFor({ state: "hidden", timeout: 30000 });
      const docList = async () =>
        (await A.api("GET", `/contracts/${num}/documents`)).json.documents;
      const d0 = await until(async () => (await docList())[0], "first Document");
      const title = d0.title;
      await menuPick(p, `Actions for ${title}`, "Mark as executed copy");
      await until(async () => (await docList())[0].versions[0].isExecuted, "v1 executed");
      // Without a reload: open Approvals in the same page through the section navigation.
      await p
        .getByRole("navigation", { name: "Contract sections" })
        .getByRole("link", { name: "Approvals" })
        .click();
      await settle(
        p,
        p.getByRole("region", { name: "Approvals", exact: true }),
        "Approvals region after section navigation",
      );
      await sleep(800);
      await p.getByRole("button", { name: "Renew", exact: true }).click();
      let dialog = p.getByRole("dialog", { name: "Confirm renewal" });
      await dialog.waitFor();
      const beforeReload = await dialog.getByRole("radio", { name: /Paper as amendment/ }).count();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await p.reload();
      await settle(
        p,
        p.getByRole("region", { name: "Approvals", exact: true }),
        "Approvals region after reload",
      );
      await sleep(800);
      await p.getByRole("button", { name: "Renew", exact: true }).click();
      dialog = p.getByRole("dialog", { name: "Confirm renewal" });
      await dialog.waitFor();
      await dialog.getByText("Paper as amendment", { exact: true }).click();
      const note =
        tidy(await dialog.innerText()).match(
          /Opens this record's Documents section[^.]*\.[^.]*\./,
        )?.[0] ?? "";
      await dialog.getByRole("button", { name: "File the amendment" }).click();
      const add = p.getByRole("dialog", { name: "Add version" });
      await add.waitFor({ timeout: 15000 });
      const typeSel = add.getByLabel("Type", { exact: true });
      const seeded = await selectedText(typeSel);
      const url = new URL(p.url()).pathname;
      await chooseFile(p, add, {
        name: `doc032-contracts-2-${role}-renewal-amendment.pdf`,
        mimeType: "application/pdf",
        buffer: pdf(`${G} ${tag} renewal amendment`),
      });
      await add.getByRole("button", { name: "Upload", exact: true }).click();
      await add.waitFor({ state: "hidden", timeout: 30000 });
      const vs = await until(async () => {
        const d = (await docList()).find((x) => x.id === d0.id);
        return d.versions.length === 2 ? d.versions : null;
      }, "amendment version");
      const sum1 = vs
        .map(
          (v) =>
            `v${v.versionNumber} ${v.documentType?.displayName ?? "no type"} executed=${v.isExecuted}`,
        )
        .join("; ");
      const v1 = vs.find((v) => v.versionNumber === 1);
      const v2 = vs.find((v) => v.versionNumber === 2);
      must(seeded === "Amendment" && url.endsWith("/documents"), `type "${seeded}" url ${url}`);
      must(
        v2.documentType?.displayName === "Amendment" && !v2.isExecuted && v1.isExecuted,
        `versions ${sum1}`,
      );
      await p.reload();
      await settle(p, docsCard(p).getByRole("heading", { name: "Documents" }), "Documents card");
      await menuPick(p, `Actions for ${title}`, "Mark as executed copy");
      const vs2 = await until(async () => {
        const d = (await docList()).find((x) => x.id === d0.id);
        return d.versions.find((v) => v.versionNumber === 2).isExecuted ? d.versions : null;
      }, "v2 executed");
      const sum2 = vs2.map((v) => `v${v.versionNumber} executed=${v.isExecuted}`).join("; ");
      const c = await read();
      const rel = (await A.api("GET", `/contracts/${num}/relations`)).json;
      const relCount = JSON.stringify(rel).match(/"number"/g)?.length ?? 0;
      must(!vs2.find((v) => v.versionNumber === 1).isExecuted, `after mark ${sum2}`);
      must(c.expiryDate === before.expiryDate, `expiry changed ${c.expiryDate}`);
      return `Uploaded "${title}" as the first (primary) Document and marked v1 executed. Reopening Renew without a reload (section navigation only) ${beforeReload ? "already offered" : "did not offer"} Paper as amendment; after a reload it was offered. Its note read ${q(note)}. File the amendment moved to ${url} and opened "Add version" with Type "${seeded}". After Upload: ${sum1}. Mark as executed copy on the Document gave: ${sum2} (replaced v1). Expiry still ${c.expiryDate}; relations read-back holds ${relCount} related records.`;
    },
  );

  const routed = async (label, radio, button, newTitle, relationCheck) => {
    await approvals();
    await p.getByRole("button", { name: "Renew", exact: true }).click();
    const dialog = p.getByRole("dialog", { name: "Confirm renewal" });
    await dialog.getByText(radio, { exact: true }).click();
    await dialog.getByRole("button", { name: button }).click();
    const create = p.getByRole("dialog", { name: label });
    await create.waitFor();
    const intro = tidy(await create.getByText(/^Prefilled from/).innerText());
    const titleBox = create.getByRole("textbox", { name: "Title" });
    const prefilledTitle = await titleBox.inputValue();
    const typeLabel = await selectedText(create.getByRole("combobox", { name: "Contract type" }));
    const ownerBox = create.getByRole("combobox", { name: "Legal Owner" });
    const ownerLabel = (await ownerBox.count())
      ? await selectedText(ownerBox)
      : "(no Legal Owner control)";
    await titleBox.fill(newTitle);
    const created = p.waitForResponse(
      (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/v1/contracts",
    );
    await create.getByRole("button", { name: "Create", exact: true }).click();
    const res = await created;
    const body = await res.json();
    const childNum = body.contract.number;
    await p.waitForURL(new RegExp(`/contracts/${childNum}`), { timeout: 15000 }).catch(() => {});
    const child = await read(childNum);
    const team = JSON.stringify((await A.api("GET", `/contracts/${childNum}`)).json.team ?? []);
    await p.goto(`${BASE}/contracts/${childNum}`);
    const relRegion = p.getByRole("region", { name: "Related contracts" });
    await settle(p, relRegion, "Related contracts region");
    await sleep(1000);
    const relText = tidy(await relRegion.innerText());
    const parent = await read();
    results.records.push({
      article: art,
      role,
      purpose: label,
      reference: `C-${childNum}`,
      title: newTitle,
    });
    const f = {
      entity: child.entity?.legalName ?? child.entity?.name ?? null,
      counterparty: child.primaryCounterparty?.name ?? null,
      value: child.value,
      termType: child.termType,
      expiry: child.expiryDate,
      renewal: child.renewalPeriodMonths,
      notice: child.noticePeriodDays,
      manager: child.manager?.displayName ?? null,
      status: child.statusName,
      priority: child.priority,
      risk: child.risk,
      confidential: child.isConfidential,
    };
    must(
      res.status() === 201 && prefilledTitle === parentTitle && typeLabel === "NDA",
      `create ${res.status()} title "${prefilledTitle}" type ${typeLabel}`,
    );
    must(
      f.counterparty &&
        f.entity &&
        f.value?.amount === 990000 &&
        f.termType === "auto_renew" &&
        f.expiry === parent.expiryDate,
      `carried ${q(f)}`,
    );
    must(
      f.status === "Draft" && f.confidential === false && f.risk === null && f.priority !== "high",
      `not carried ${q(f)}`,
    );
    must(!team.includes(BU.name) && !team.includes(O.displayName), `team ${team.slice(0, 300)}`);
    must(relationCheck(relText, `C-${num}`), `relation "${relText}"`);
    return `${radio} -> ${button} opened "${label}": "${intro}". Prefilled Title "${prefilledTitle}", Contract type ${typeLabel}, Legal Owner ${ownerLabel}; Title edited; Create answered ${res.status()} for C-${childNum}. Carried over: entity ${f.entity}, counterparty ${f.counterparty}, value ${q(f.value)}, ${f.termType} to ${f.expiry} (renewal ${f.renewal}, notice ${f.notice}). Not carried: Legal Owner ${f.manager}, Status ${f.status}, Priority ${f.priority}, Risk ${f.risk}, Confidential ${f.confidential}; team has neither ${O.displayName} nor ${BU.name}. Related contracts on C-${childNum}: "${relText}". C-${num} still expires ${parent.expiryDate}.`;
  };

  await step(
    art,
    sc,
    role,
    actors,
    "Approvals; create dialog",
    "Create child contract from Renew: review and edit the prefilled Title and Contract type, create, and check the new C- reference and relationship",
    "A new Contract parented to this one; Entity, Counterparties, value and term shape carry over; Legal Owner, team, Status, Priority, Risk and Confidential need their own review",
    () =>
      routed(
        "Create child contract",
        "Create child contract",
        "Open the child contract",
        `${G} child ${tag}`,
        (rel, ref) => /Parent/i.test(rel) && rel.includes(ref),
      ),
  );

  await step(
    art,
    sc,
    role,
    actors,
    "Approvals; create dialog",
    "New successor contract from Renew: review, create, and check the new C- reference and Renews relationship",
    "A new Contract linked as renewing this predecessor, with the same carry-over rules",
    () =>
      routed(
        "Create successor contract",
        "New successor contract",
        "Open the successor",
        `${G} successor ${tag}`,
        (rel, ref) => /Renews/i.test(rel) && rel.includes(ref),
      ),
  );

  await step(
    art,
    sc,
    role,
    actors,
    "Approvals",
    "Renewal banner: an Auto-renewing Contract whose expiry has passed shows Renewal date passed — pending confirmation; Review renewal opens the same dialog",
    "The banner and Review renewal appear; the app does not advance expiry automatically",
    async () => {
      const created = await A.api("POST", "/contracts", {
        title: `${G} lapsed ${tag}`,
        contractTypeId: typeId("NDA"),
        managerId: uid(A.displayName),
        customFields: {},
      });
      must(created.status === 201, `create ${created.status}`);
      const lapsed = created.json.contract.number;
      results.records.push({
        article: art,
        role,
        purpose: "passed renewal date",
        reference: `C-${lapsed}`,
        title: `${G} lapsed ${tag}`,
      });
      await A.api("PATCH", `/contracts/${lapsed}`, { termType: "auto_renew" });
      const past = isoPlusDays(-5);
      const e = await A.api("PATCH", `/contracts/${lapsed}`, {
        expiryDate: past,
        renewalPeriodMonths: 12,
      });
      must(e.status === 200, `expiry PATCH ${e.status}`);
      await approvals(p, lapsed);
      const banner = p.getByText(/Renewal date passed — pending confirmation/);
      await banner.waitFor({ timeout: 10000 });
      const bannerText = tidy(await banner.innerText());
      await p.getByRole("button", { name: "Review renewal" }).click();
      const dialog = p.getByRole("dialog", { name: "Confirm renewal" });
      await dialog.waitFor();
      const proposal = await dialog.getByRole("textbox", { name: "New expiry date" }).inputValue();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      const c = await read(lapsed);
      must(c.expiryDate === past && proposal > past, `expiry ${c.expiryDate} proposal ${proposal}`);
      return `C-${lapsed} (fixture) Auto-renewing, 12 months, expiry ${past}: banner "${bannerText}"; Review renewal opened Confirm renewal proposing ${proposal}; Cancel left expiry ${c.expiryDate} (no automatic advance).`;
    },
  );

  await step(
    art,
    sc,
    role,
    actors,
    "Approvals",
    "Negative: an archived Contract offers no Renew and refuses a renewal write; Restore keeps the recorded rolls",
    "Archived records are handled differently from an active renewal",
    async () => {
      const a = await A.api("POST", `/contracts/${num}/archive`, {});
      must(a.status === 200, `archive ${a.status}`);
      await approvals();
      const renewCount = await p.getByRole("button", { name: "Renew", exact: true }).count();
      const c0 = await read();
      const write = await A.api("POST", `/contracts/${num}/renewal`, {
        fromExpiry: c0.expiryDate,
        toExpiry: "2027-12-31",
      });
      const r = await A.api("POST", `/contracts/${num}/restore`, {});
      const c = await read();
      await approvals();
      const rows = await renewRows();
      must(
        renewCount === 0 &&
          write.status === 409 &&
          r.status === 200 &&
          c.expiryDate === c0.expiryDate &&
          rows === 2,
        `renew ${renewCount} write ${write.status} restore ${r.status} rows ${rows}`,
      );
      return `Archived C-${num}: Approvals showed ${renewCount} Renew buttons and a renewal write answered ${write.status}. After Restore (${r.status}) expiry ${c.expiryDate} and ${rows} renewal rows remain.`;
    },
  );

  // ---------- run ----------
}

// ---------- run ----------
watch(S.daniel.page);
watch(S.nadia.page);
const plan = [
  { role: "legal_team_member", A: S.nadia, O: S.daniel },
  { role: "administrator", A: S.daniel, O: S.nadia },
].filter((x) => ROLES.includes(x.role));
try {
  for (const { role, A, O } of plan) {
    if (ONLY.includes("terms-and-renewals")) await termsAndRenewals(role, A, O);
  }
} finally {
  results.summary = {
    total: results.steps.length,
    pass: results.steps.filter((s) => s.result === "pass").length,
    fail: results.steps.filter((s) => s.result === "fail").length,
  };
  save();
  await closeBrowser();
}
console.log(JSON.stringify(results.summary));
