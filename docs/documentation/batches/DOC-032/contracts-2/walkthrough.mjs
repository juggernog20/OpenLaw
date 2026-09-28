// DOC-032 independent walkthrough, group contracts-2.
// Written by the DOC-032 independent walkthrough agent (contracts-2) from the text of
// five guides: create-contract (V-C14), approver-groups (V-C55), terms-and-renewals (V-C18),
// contract-stages (V-C15) and troubleshooting (V-C49). The agent did not write these guides.
// The create-contract and approver-groups sections are copied from the last passing script,
// DOC-030 contracts-a/walkthrough.mjs, and follow the DOC-032 text (Owners section above the
// Contract card; the Contract's Approvals tab).
//
// Run from the worktree root against the shared work lab:
//   LAB_PASSWORD=... node docs/documentation/batches/DOC-032/contracts-2/walkthrough.mjs
// ONLY=<article ids> and ROLES=... narrow a run. SIGNING=1 LAB=c2sign runs the signing
// checks on the owned stand-in lab instead (see fixture/).
// The seed password comes from the environment. Magic links are read from the lab
// Mailpit at run time and never written. The log holds no credentials, cookies,
// links, or raw mail.
import path from "node:path";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import {
  here,
  BASE,
  MAIL,
  lab,
  LAB_NAME,
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

const ARTICLES = [
  "create-contract",
  "approver-groups",
  "terms-and-renewals",
  "contract-stages",
  "troubleshooting",
];
const ONLY = (process.env.ONLY ?? ARTICLES.join(",")).split(",");
const ROLES = (process.env.ROLES ?? "legal_team_member,administrator").split(",");
const SIGNING = Boolean(process.env.SIGNING);
const OUT =
  process.env.OUT ?? path.join(here, SIGNING ? "walkthrough-signing.json" : "walkthrough.json");
const stamp = Date.now();
const P = `DOC-032 contracts-2`;

const { results, step, save } = recorder(OUT, {
  kind: "independent-article-walkthrough-log",
  task: "DOC-032",
  group: "contracts-2",
  walkthroughReviewer: "DOC-032 independent walkthrough agent (contracts-2)",
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
  signingCheck: SIGNING,
  only: ONLY,
  roles: ROLES,
  stamp,
  identities: [],
  fixtures: [],
  records: [],
  typeForms: [],
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
async function makeField(label, fieldType, extra = {}) {
  const r = await D.api("POST", "/fields", {
    displayName: `${P} ${label} ${stamp}`,
    moduleScope: "contract",
    fieldType,
    ...extra,
  });
  must(r.status === 201, `field ${label} ${r.status} ${q(r.json)}`);
  fixture("Field", r.json.field.displayName, `${fieldType}, contract module`);
  return r.json.field;
}
const builtin = (rowRef, fieldType, isRequired = false) => ({
  kind: "row",
  id: rowRef,
  rowRef,
  fieldType,
  onIntakeForm: false,
  isRequired,
  visibleOnPortal: true,
});
const fieldRow = (f, isRequired = false) => ({
  kind: "row",
  id: f.id,
  rowRef: f.slug,
  fieldType: f.fieldType,
  onIntakeForm: false,
  isRequired,
  visibleOnPortal: false,
});
async function makeType(label) {
  const r = await D.api("POST", "/contract-types", { displayName: `${P} ${label} ${stamp}` });
  must(r.status === 201, `type ${label} ${r.status} ${q(r.json)}`);
  return r.json.contractType;
}

async function setupFixtures() {
  FX.dealSize = await makeField("Deal size", "number");
  FX.reason = await makeField("Escalation reason", "text");
  FX.notes = await makeField("Notes", "long_text");
  FX.tier = await makeField("Risk tier", "single_select", { options: ["Standard", "Elevated"] });

  // The Form type for V-C14. Region sits before Our entity so the Overview order
  // check tests Form order, not a fixed layout.
  FX.formType = await makeType("Form type");
  const current = (await D.api("GET", `/contract-types/${FX.formType.id}/form`)).json.form;
  const pins = current.filter((n) => ["title", "contract_type"].includes(n.rowRef));
  FX.branchId = randomUUID();
  const form = [
    ...pins,
    builtin("region", "single_select"),
    builtin("entity", "entity", true),
    builtin("counterparties", "multi_select", true),
    fieldRow(FX.dealSize, true),
    {
      kind: "branch",
      id: FX.branchId,
      match: "all",
      conditions: [{ rowRef: FX.dealSize.slug, operator: "greater_than", value: 100000 }],
      children: [fieldRow(FX.reason, true), builtin("needed_by", "date")],
    },
    builtin("description", "long_text"),
    builtin("owning_department", "single_select"),
    builtin("priority", "single_select"),
    builtin("risk", "single_select"),
    builtin("term_type", "single_select"),
    builtin("effective_date", "date"),
    builtin("expiry_date", "date"),
    builtin("renewal_period_months", "number"),
    builtin("notice_period_days", "number"),
    builtin("value", "money"),
    fieldRow(FX.notes),
    fieldRow(FX.tier),
  ];
  const put = await D.api("PUT", `/contract-types/${FX.formType.id}/form`, { form });
  must(put.status === 200, `form put ${put.status} ${q(put.json)}`);
  const people = await D.api("POST", `/contract-types/${FX.formType.id}/people`, {
    userId: uid("Tom Iwu"),
  });
  must(people.status < 300, `default people ${people.status} ${q(people.json)}`);
  fixture(
    "Contract type",
    FX.formType.displayName,
    "Form: Title, Contract type, Region, Entity (required), Counterparties (required), Deal size (required number Field), Branch [Deal size greater than 100000: Escalation reason (required text Field), Needed by], Description, Department, Priority, Risk, Term type, Effective date, Expiry date, Renewal period, Notice period, Value, Notes (long text Field), Risk tier (select Field). Default person: Tom Iwu.",
  );
  results.typeForms.push({
    type: FX.formType.displayName,
    creationRows:
      "Entity (required), Counterparties (required), Deal size (required); Escalation reason (required) only while Deal size is greater than 100000",
    recordRows:
      "Region, Description, Department, Priority, Risk, Term type, Effective date, Expiry date, Renewal period (months), Notice period (days), Value; Needed by under the Deal size Branch; Fields Notes and Risk tier",
    form,
  });

  // An archived Contract type and an archived Entity for the refusal checks.
  FX.archivedType = await makeType("Archived type");
  const at = await D.api("POST", `/contract-types/${FX.archivedType.id}/archive`, {});
  must(at.status < 300, `archive type ${at.status} ${q(at.json)}`);
  fixture("Contract type", FX.archivedType.displayName, "archived before the walk");
  const entityTypes = (await D.api("GET", "/entity-types")).json;
  const etId = (entityTypes.entityTypes ?? entityTypes.types ?? [])[0]?.id;
  const e = await D.api("POST", "/entities", {
    legalName: `${P} Archived Entity ${stamp}`,
    entityTypeId: etId,
  });
  must(e.status === 201, `entity ${e.status} ${q(e.json)}`);
  FX.archivedEntity = e.json.entity;
  const ea = await D.api("POST", `/entities/${FX.archivedEntity.id}/archive`, {});
  must(ea.status < 300, `archive entity ${ea.status} ${q(ea.json)}`);
  fixture("Entity", FX.archivedEntity.legalName, "archived before the walk");

  // An Approver group for V-C16 (Marcus Oyelaran and Priya Raman).
  const g = await D.api("POST", "/approver-groups", {
    name: `${P} sign-off ${stamp}`,
    memberIds: [uid("Marcus Oyelaran"), uid("Priya Raman")],
  });
  must(g.status === 201, `group ${g.status} ${q(g.json)}`);
  FX.group = g.json.approverGroup ?? g.json.group;
  fixture("Approver group", FX.group.name, "Marcus Oyelaran and Priya Raman; used in V-C16");

  // A Review-Stage Status for V-C15's rename check. Archived at the end.
  const st = await D.api("POST", "/contract-statuses", {
    displayName: `${P} V-C15 review ${stamp}`,
    stage: "review",
  });
  must(st.status === 201, `status fixture ${st.status} ${q(st.json)}`);
  FX.status = st.json.contractStatus;
  fixture(
    "Contract Status",
    FX.status.displayName,
    "Review Stage; renamed during V-C15; archived at the end",
  );

  options = (await D.api("GET", "/contracts/options")).json;
}

async function cleanupFixtures() {
  const done = [];
  const other = options.contractTypes.find((t) => t.displayName === "Other").id;
  const lists = [
    ["group", "/approver-groups", "approverGroups", (x) => x.name],
    ["type", "/contract-types", "contractTypes", (x) => x.displayName],
    ["field", "/fields", "fields", (x) => x.displayName],
    ["status", "/contract-statuses", "contractStatuses", (x) => x.displayName],
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
// Other agents create and remove lab networks on this host; Chromium can then abort
// in-flight requests and the app shows "Something went wrong." settled() reloads up to
// twice and logs each retry (the DOC-030 signing-2 settle pattern).
async function settled(page, locator, label) {
  for (let i = 0; ; i++) {
    try {
      await locator.waitFor({ timeout: 20000 });
      // The error page has its own heading; treat it as not arrived.
      if (await page.getByText("The page could not load. Reload to try again.").count())
        throw new Error("the app showed Something went wrong.");
      return;
    } catch (e) {
      const shown = (
        await page
          .locator("body")
          .innerText()
          .catch(() => "")
      )
        .replace(/\s+/g, " ")
        .slice(0, 160);
      (results.retries ??= []).push({
        at: new Date().toISOString(),
        page: new URL(page.url()).pathname,
        waitedFor: label,
        shown,
      });
      if (i >= 2) throw e;
      await page.reload();
    }
  }
}
async function openContract(s, number, tab = "") {
  await s.page.goto(`${BASE}/contracts/${number}${tab ? `/${tab}` : ""}`);
  await settled(s.page, s.page.getByRole("heading", { level: 1 }), "record heading");
  await s.page.waitForLoadState("networkidle").catch(() => {});
}
async function section(s, name) {
  const link = s.page
    .getByRole("navigation", { name: "Contract sections" })
    .getByRole("link", { name: new RegExp(`^${name}`) });
  await settled(s.page, link, `${name} tab link`);
  await link.click();
}
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

// ---------------------------------------------------------------------------
// Sections are appended below.
// ---------------------------------------------------------------------------
const SECTIONS = {};

// =====================================================================
// V-C14 create-contract
// =====================================================================
async function seededMatter(s) {
  let cursor = null;
  for (let pageNo = 0; pageNo < 20; pageNo++) {
    const r = (
      await s.api("GET", `/matters${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`)
    ).json;
    const m = (r.matters ?? []).find(
      (x) => !x.isConfidential && !x.archivedAt && !/^DOC-/.test(x.title),
    );
    if (m) return m;
    cursor = r.nextCursor;
    if (!cursor) break;
  }
  throw new Error("no open seeded Matter");
}
const contractCard = (page) =>
  page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Contract", exact: true, level: 2 }) })
    .first();
async function orderOf(text, labels) {
  const at = labels.map((l) => [l, text.indexOf(l)]);
  const missing = at.filter(([, i]) => i < 0).map(([l]) => l);
  const sorted = at.every(([, i], k) => i >= 0 && (k === 0 || i > at[k - 1][1]));
  return { at, missing, sorted };
}
/** Select the whole input and type over it, as a person does. Playwright's fill()
 * inserts at the end of these formatted number inputs after they reformat on focus. */
async function typeOver(box, text) {
  await box.click();
  await box.press("Control+A");
  if (text === "") await box.press("Backspace");
  else await box.pressSequentially(text);
}
async function openCreate(page) {
  await page.goto(`${BASE}/contracts`);
  await page.getByRole("button", { name: "Create contract" }).first().click();
  const d = page.getByRole("dialog", { name: "Create contract" });
  await d.waitFor();
  return d;
}
const alertText = async (d) =>
  (
    await d
      .getByRole("alert")
      .first()
      .innerText({ timeout: 8000 })
      .catch(() => "(no alert)")
  ).trim();
async function titleExists(s, title) {
  const r = await s.api("GET", `/contracts?q=${encodeURIComponent(title)}&limit=50`);
  return (r.json?.contracts ?? []).some((c) => c.title === title);
}

async function createContract(role, A, O) {
  const art = "create-contract";
  const sc = "V-C14";
  const page = A.page;
  const fxType = FX.formType.displayName;
  const dealLabel = FX.dealSize.displayName;
  const reasonLabel = FX.reason.displayName;
  const title = `${P} ${role} create ${stamp}`;
  const matter = await seededMatter(A);
  let number;

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "/contracts > Create contract",
    "Create the record, steps 1-5 and If a change is refused: dialog order, Default type first, Legal Owner seed and choices, archived type and Entity not offered, blank Title, missing type, blank required Rows, Branch Row, Cancel",
    "Title, Contract type, Legal Owner, Matter, the Form's Rows, Confidential, Documents, Create; Default preselected; Legal Owner starts on the acting person with Unassigned and staff only; errors Name the contract., Pick a contract type., and named required Rows; a Branch reveals its Row only when its condition holds; nothing is created.",
    async () => {
      const d = await openCreate(page);
      const snap = await d.ariaSnapshot();
      const order = await orderOf(snap, [
        'textbox "Title"',
        'combobox "Contract type"',
        'combobox "Legal Owner"',
        'textbox "Matter"',
        'combobox "Description"',
        'switch "Confidential — restrict to the contract team"',
        'region "Documents"',
        'button "Cancel"',
        'button "Create"',
      ]).catch(() => null);
      const typeBox = d.getByRole("combobox", { name: "Contract type" });
      const typeSelected = await typeBox.locator("option:checked").innerText();
      const typeOptions = await typeBox.locator("option").allInnerTexts();
      const owner = d.getByRole("combobox", { name: "Legal Owner" });
      const ownerSelected = await owner.locator("option:checked").innerText();
      const ownerOptions = await owner.locator("option").allInnerTexts();
      // The Default type's own creation Rows, recorded for the evidence.
      const defaultRows = [
        ...snap.matchAll(/- text: ([^\n]+)\n\s+- (?:textbox|combobox|button) "\1"/g),
      ]
        .map((m) => m[1])
        .filter((l) => !["Title", "Contract type", "Legal Owner", "Matter"].includes(l));
      must(typeSelected === "Default", `type preselected ${typeSelected}`);
      must(ownerSelected === A.displayName, `Legal Owner seed ${ownerSelected}`);
      must(ownerOptions[0] === "Unassigned", `first owner option ${ownerOptions[0]}`);
      must(
        !ownerOptions.includes("Lena Vogel") &&
          !ownerOptions.includes("Jonas Weber") &&
          !ownerOptions.includes("Gabriel Santos") &&
          ownerOptions.includes(O.displayName),
        `owner options ${ownerOptions}`,
      );
      must(!typeOptions.includes(FX.archivedType.displayName), "archived Contract type offered");
      const orderText = [
        "Title",
        "Contract type",
        "Legal Owner",
        "Matter",
        ...defaultRows,
        "Confidential — restrict to the contract team",
        "Documents",
        "Cancel",
        "Create",
      ];
      const dialogOrder = await orderOf(
        snap,
        orderText.map((l) => `"${l}"`),
      );
      must(dialogOrder.sorted, `dialog order ${q(dialogOrder.at)}`);
      // Blank Title.
      await d.getByRole("button", { name: "Create", exact: true }).click();
      const e1 = await alertText(d);
      // Missing type.
      const refusedTitle = `${P} ${role} refusal ${stamp}`;
      await d.getByRole("textbox", { name: "Title" }).fill(refusedTitle);
      await typeBox.selectOption({ label: "Type…" });
      await d.getByRole("button", { name: "Create", exact: true }).click();
      const e2 = await alertText(d);
      // The fixture type's creation Rows.
      await typeBox.selectOption({ label: fxType });
      await d.getByRole("combobox", { name: "Entity" }).waitFor();
      const fxSnap = await d.ariaSnapshot();
      const rowsShown = [
        "Entity",
        "Counterparties",
        dealLabel,
        reasonLabel,
        "Region",
        "Description",
      ].map((l) => [l, fxSnap.includes(`"${l}"`)]);
      const entityOptions = await d
        .getByRole("combobox", { name: "Entity" })
        .locator("option")
        .allInnerTexts();
      must(
        !entityOptions.includes(FX.archivedEntity.legalName),
        "archived Entity offered in the Entity Row",
      );
      must(
        rowsShown.find(([l]) => l === "Entity")[1] &&
          rowsShown.find(([l]) => l === "Counterparties")[1] &&
          rowsShown.find(([l]) => l === dealLabel)[1] &&
          !rowsShown.find(([l]) => l === reasonLabel)[1],
        `rows ${q(rowsShown)}`,
      );
      await d.getByRole("button", { name: "Create", exact: true }).click();
      const e3 = await alertText(d);
      await typeOver(d.getByRole("textbox", { name: dealLabel }), "twelve");
      await d.getByRole("button", { name: "Create", exact: true }).click();
      const e4 = await alertText(d);
      await typeOver(d.getByRole("textbox", { name: dealLabel }), "5000");
      await sleep(400);
      const reasonAt5000 = await d.getByRole("textbox", { name: reasonLabel }).count();
      await d.getByRole("button", { name: "Create", exact: true }).click();
      const e5 = await alertText(d);
      await typeOver(d.getByRole("textbox", { name: dealLabel }), "250000");
      await d.getByRole("textbox", { name: reasonLabel }).waitFor();
      await d
        .getByRole("combobox", { name: "Entity" })
        .selectOption({ label: "Helix Software Ltd" });
      const cp = d.getByRole("combobox", { name: "Counterparties" });
      await cp.fill("Tailspin");
      await d
        .getByRole("listbox", { name: "Counterparty matches" })
        .getByRole("option", { name: "Tailspin Logistics BV" })
        .click();
      await d.getByRole("button", { name: "Create", exact: true }).click();
      const e6 = await alertText(d);
      const stillOpen = await d.isVisible();
      await d.getByRole("button", { name: "Cancel" }).click();
      await d.waitFor({ state: "hidden" });
      await sleep(800);
      const made = await titleExists(A, refusedTitle);
      must(e1 === "Name the contract.", `blank title said ${q(e1)}`);
      must(e2 === "Pick a contract type.", `missing type said ${q(e2)}`);
      must(e3.includes(dealLabel), `blank required Field said ${q(e3)}`);
      must(/number/i.test(e4), `non-number said ${q(e4)}`);
      must(reasonAt5000 === 0, "Branch Row shown while its condition does not hold");
      must(/entity/i.test(e5) && /Counterparties/.test(e5), `blank built-in Rows said ${q(e5)}`);
      must(e6.includes(reasonLabel), `blank Branch Row said ${q(e6)}`);
      must(stillOpen && !made, `dialog open ${stillOpen}, created ${made}`);
      return `Dialog order: ${q(orderText)}. Contract type started on ${q(typeSelected)}; the Default type's creation Rows were ${q(defaultRows)}. Legal Owner started on ${q(ownerSelected)} and offered ${ownerOptions.length} entries: ${q(ownerOptions.filter((o) => !o.startsWith("DOC-0")))} plus ${ownerOptions.filter((o) => o.startsWith("DOC-0")).length} staff accounts walkthrough agents created; no Business User and not archived Gabriel Santos. The archived fixture type was not in ${typeOptions.length} type options. Blank Create said ${q(e1)}; with a Title and "Type…" it said ${q(e2)}. ${q(fxType)} drew ${q(rowsShown.filter(([, v]) => v).map(([l]) => l))} and not the Branch Row or the record Rows; Entity offered ${entityOptions.length - 1} Entities without the archived fixture Entity. Blank Create said ${q(e3)}; "twelve" in the number Row said ${q(e4)}; Deal size 5000 kept the Branch Row hidden and the server refusal named the blank built-in Rows: ${q(e5)}. Deal size 250000 revealed ${q(reasonLabel)}; with Entity and Counterparties filled, Create said ${q(e6)}. Cancel closed the dialog and no Contract titled ${q(refusedTitle)} exists.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "/contracts > Create contract > /contracts/:number",
    "Create the record, steps 1-8: Title, Contract type, Legal Owner, Matter search, Entity and Counterparties Rows, required Field and Branch Row, Confidential, Attach documents with Document type, Create",
    "The app opens the new Contract: its title, type, Legal Owner, C- reference, Draft Status, Creator on the team, the type's default person on the team, and the attached Document.",
    async () => {
      const d = await openCreate(page);
      await d.getByRole("textbox", { name: "Title" }).fill(title);
      await d.getByRole("combobox", { name: "Contract type" }).selectOption({ label: fxType });
      await d.getByRole("combobox", { name: "Legal Owner" }).selectOption({ label: "Unassigned" });
      await d.getByRole("combobox", { name: "Legal Owner" }).selectOption({ label: O.displayName });
      await d.getByRole("textbox", { name: "Matter" }).fill(matter.title.slice(0, 14));
      const matches = d.getByRole("list", { name: "Matter matches" });
      await matches.getByRole("button").filter({ hasText: matter.title }).first().click();
      const matterValue = await d.getByRole("textbox", { name: "Matter" }).inputValue();
      await d
        .getByRole("combobox", { name: "Entity" })
        .selectOption({ label: "Helix Software Ltd" });
      await d.getByRole("combobox", { name: "Counterparties" }).fill("Tailspin");
      await d
        .getByRole("listbox", { name: "Counterparty matches" })
        .getByRole("option", { name: "Tailspin Logistics BV" })
        .click();
      await d.getByRole("textbox", { name: dealLabel }).fill("250000");
      await d.getByRole("textbox", { name: reasonLabel }).fill("Board approval above the limit");
      await d.getByRole("switch", { name: "Confidential — restrict to the contract team" }).click();
      const chooser = page.waitForEvent("filechooser");
      await d
        .getByRole("region", { name: "Documents" })
        .getByRole("button", { name: "Attach documents" })
        .first()
        .click();
      const fileName = `doc032-contracts-2-${role}-draft.pdf`;
      await (
        await chooser
      ).setFiles({
        name: fileName,
        mimeType: "application/pdf",
        buffer: pdf(`${P} ${role} draft ${stamp}`),
      });
      const docType = d.getByRole("combobox", { name: "Document type" });
      await docType.waitFor();
      const docTypeOptions = await docType.locator("option").allInnerTexts();
      const chosenDocType = docTypeOptions.find((o) => o !== "No type");
      await docType.selectOption({ label: chosenDocType });
      await d.getByRole("button", { name: "Create", exact: true }).click();
      await page.waitForURL(/\/contracts\/\d+$/, { timeout: 30000 });
      number = Number(page.url().match(/\/contracts\/(\d+)/)[1]);
      record(title, number, "created in the browser dialog");
      await page.getByRole("heading", { level: 1, name: title }).waitFor();
      const main = page.getByRole("main");
      const headerText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      const type = await main
        .getByRole("combobox", { name: "Contract type" })
        .locator("option:checked")
        .innerText();
      const legal = (await main.getByRole("button", { name: "Legal Owner" }).innerText()).trim();
      const c = await getContract(A, number);
      const team = (c.team ?? []).map((m) => m.displayName);
      const docs = (await A.api("GET", `/contracts/${number}/documents`)).json?.documents ?? [];
      must(headerText.includes(`C-${number}`), "C- reference not shown");
      must(type === fxType && legal.includes(O.displayName), `type ${type} legal ${legal}`);
      must(
        c.contract.statusName === "Draft" && c.contract.isConfidential,
        `status ${c.contract.statusName} confidential ${c.contract.isConfidential}`,
      );
      must(team.includes(A.displayName) && team.includes("Tom Iwu"), `team ${team}`);
      must(docs.length === 1, `documents ${docs.length}`);
      const matterLink = await main
        .getByRole("link", { name: new RegExp(`^M-${matter.number} `) })
        .count();
      must(matterLink === 1, "linked Matter not shown on Overview");
      await page
        .getByRole("toolbar", { name: "Applets" })
        .getByRole("button", { name: "Contract team" })
        .click();
      const applet = page.getByRole("complementary", { name: "Contract team" });
      const roster = (await applet.getByRole("listitem").allInnerTexts()).map((t) =>
        t.replace(/\s+/g, " ").trim(),
      );
      await applet.getByRole("button", { name: "Close" }).click();
      must(
        roster.some((r) => r.includes("Creator") && r.includes(A.displayName)) &&
          roster.some((r) => r.includes("Legal Owner") && r.includes(O.displayName)),
        `roster ${roster}`,
      );
      FX.created ??= {};
      FX.created[role] = { number, title, matter };
      return `Matter search ${q(matter.title.slice(0, 14))} selected ${q(matterValue)}. Document type offered ${q(docTypeOptions)}; ${q(chosenDocType)} chosen. Create opened /contracts/${number}: heading ${q(title)}, C-${number} shown, Overview Contract type ${q(type)}, Legal Owner ${q(legal)}. API read: Status ${q(c.contract.statusName)}, Confidential ${c.contract.isConfidential}, entity ${q(c.contract.entity?.legalName ?? c.contract.entity?.name)}, counterparties ${q((c.counterparties ?? []).map((p) => p.name))}, Fields ${q(c.contract.customFields)}; Overview links Matter M-${matter.number}. Contract team roster ${q(roster)}; membership ${q(team)} includes the default person Tom Iwu. Documents: ${q(docs.map((x) => `${x.title} (${x.versions?.[0]?.documentType?.displayName ?? "no type"})`))}.`;
    },
  );
  if (!number) return;

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "/contracts > Create contract (Default type)",
    "Create the record: a failed upload after Create shows Record created. Some documents could not be uploaded. with Retry failed uploads and Continue; the Contract already exists",
    "The Contract exists; Retry failed uploads uploads the file; Continue opens the Contract.",
    async () => {
      const t = `${P} ${role} upload failure ${stamp}`;
      const d = await openCreate(page);
      await d.getByRole("textbox", { name: "Title" }).fill(t);
      const chooser = page.waitForEvent("filechooser");
      await d
        .getByRole("region", { name: "Documents" })
        .getByRole("button", { name: "Attach documents" })
        .first()
        .click();
      await (
        await chooser
      ).setFiles({
        name: `doc032-contracts-2-${role}-retry.pdf`,
        mimeType: "application/pdf",
        buffer: pdf(`${P} ${role} retry ${stamp}`),
      });
      const block = (route) =>
        route.request().method() === "POST"
          ? route.fulfill({
              status: 503,
              contentType: "application/problem+json",
              body: JSON.stringify({
                title: "Service Unavailable",
                status: 503,
                detail: "Upload refused by the walkthrough.",
              }),
            })
          : route.continue();
      await page.route(/\/api\/v1\/contracts\/\d+\/documents$/, block);
      await d.getByRole("button", { name: "Create", exact: true }).click();
      const note = d.getByText("Record created. Some documents could not be uploaded.");
      await note.waitFor({ timeout: 20000 });
      const buttons = await d.getByRole("button").allInnerTexts();
      const exists = await until(() => titleExists(A, t), "contract exists after failed upload");
      const created = (
        await A.api("GET", `/contracts?q=${encodeURIComponent(t)}`)
      ).json.contracts.find((c) => c.title === t);
      record(
        t,
        created.number,
        "created in the browser dialog; the first upload was refused by a routed 503",
      );
      await page.unroute(/\/api\/v1\/contracts\/\d+\/documents$/, block);
      let how;
      if (role === "administrator") {
        await d.getByRole("button", { name: "Retry failed uploads" }).click();
        await page.waitForURL(/\/contracts\/\d+$/, { timeout: 20000 });
        how = "Retry failed uploads uploaded the file and opened the Contract";
      } else {
        await d.getByRole("button", { name: "Continue" }).click();
        await page.waitForURL(/\/contracts\/\d+$/, { timeout: 20000 });
        how = "Continue opened the Contract without the file";
      }
      const docs =
        (await A.api("GET", `/contracts/${created.number}/documents`)).json?.documents ?? [];
      must(
        buttons.some((b) => /Retry failed uploads/.test(b)) &&
          buttons.some((b) => /Continue/.test(b)),
        `buttons ${buttons}`,
      );
      must(exists, "contract missing");
      must(page.url().endsWith(`/contracts/${created.number}`), `url ${page.url()}`);
      must(role === "administrator" ? docs.length === 1 : docs.length === 0, `docs ${docs.length}`);
      return `With the upload answered 503, the dialog showed "Record created. Some documents could not be uploaded." and buttons ${q(buttons)}. C-${created.number} already existed. ${how}; it holds ${docs.length} Document(s).`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName, "Marcus Oyelaran", "Tom Iwu"],
    "/contracts/:number and /matters/:number",
    "Step 4: a Matter link does not copy access. A Legal Team Member outside the Confidential team reads the Matter but not the Contract; the type's default person reads the Contract",
    "Marcus opens the Matter; the Contract is refused for him and his page does not show its title; Tom Iwu opens it.",
    async () => {
      const m = await S.marcus.api("GET", `/matters/${matter.number}`);
      const c = await S.marcus.api("GET", `/contracts/${number}`);
      const t = await S.tom.api("GET", `/contracts/${number}`);
      await S.marcus.page.goto(`${BASE}/contracts/${number}`);
      await sleep(2500);
      const body = (
        await S.marcus.page
          .locator("main")
          .innerText()
          .catch(() => "")
      ).replace(/\s+/g, " ");
      must(
        m.status === 200 && [403, 404].includes(c.status) && t.status === 200,
        `matter ${m.status} contract ${c.status} tom ${t.status}`,
      );
      must(!body.includes(title), "outsider saw the title");
      return `Marcus Oyelaran: Matter M-${matter.number} answered ${m.status}; C-${number} answered ${c.status}; his page read ${q(body.slice(0, 120))}. Tom Iwu (type default person) answered ${t.status}.`;
    },
  );

  const main = page.getByRole("main");
  await step(
    art,
    sc,
    role,
    [A.displayName],
    "/contracts/:number (Overview)",
    "Record the parties and ownership: the Contract card shows the type Form's built-in Rows in Form order, then Days remaining, Last renewal and the Confidential switch; Legal Owner and Business Owner are in their own section above the Contract card; attached Fields are not on Overview",
    "Title, Contract type, Region, Our entity, Counterparties, Needed by (Branch holds), Description, Department, Priority, Risk, the term Rows and Value, then the read-only rows and the switch; the owners sit in a separate section before the card; no Deal size, Notes or Risk tier.",
    async () => {
      await openContract(A, number);
      const card = contractCard(page);
      const text = (await card.innerText()).replace(/\s+/g, " ");
      const labels = [
        "Title",
        "Contract type",
        "Region",
        "Our entity",
        "Counterparties",
        "Needed by",
        "Description",
        "Department",
        "Priority",
        "Risk",
        "Term type",
        "Effective date",
        "Expiry date",
        "Renewal period (months)",
        "Notice period (days)",
        "Value",
        "Days remaining",
        "Last renewal",
        "Confidential — restrict to the contract team",
      ];
      const o = await orderOf(text, labels);
      const ownersInCard = ["Legal Owner", "Business Owner"].filter((l) => text.includes(l));
      // The owners: a section with no visible heading, before the Contract card.
      const owners = page.getByRole("region", { name: "Owners" });
      const ownersCount = await owners.count();
      const ownersText = ownersCount ? (await owners.innerText()).replace(/\s+/g, " ") : "";
      const ownersHeading = ownersCount ? await owners.getByRole("heading").count() : -1;
      const before = await page.evaluate(() => {
        const o = document.querySelector('section[aria-label="Owners"]');
        const h = [...document.querySelectorAll("h2")].find(
          (x) => x.textContent.trim() === "Contract",
        );
        return !!(o && h && o.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
      const mainText = (await main.innerText()).replace(/\s+/g, " ");
      const leaked = [dealLabel, reasonLabel, FX.notes.displayName, FX.tier.displayName].filter(
        (l) => mainText.includes(l),
      );
      must(o.sorted, `order ${q(o.at)}`);
      must(ownersInCard.length === 0, `owners inside the Contract card ${ownersInCard}`);
      must(
        ownersCount === 1 &&
          ownersText.includes("Legal Owner") &&
          ownersText.includes("Business Owner") &&
          before,
        `owners section ${ownersCount} ${q(ownersText)} before ${before}`,
      );
      must(leaked.length === 0, `Fields on Overview ${leaked}`);
      return `Contract card label order: ${q(labels)} (all present, in this order). The fixture Form puts Region before Our entity and Needed by inside the Deal size Branch; the card followed it. The card holds no Legal Owner or Business Owner. A separate section named "Owners" (accessible name only; ${ownersHeading} headings) sits before the Contract card and reads ${q(ownersText.slice(0, 120))}. No Field (${q(dealLabel)}, ${q(FX.notes.displayName)}, ...) appears on Overview.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName, "Tom Iwu"],
    "/contracts/:number (Overview) Legal Owner and Business Owner",
    "Legal Owner offers active staff; Business Owner offers any active person; Unassigned clears either; on a Confidential Contract only an Administrator, the creator or the Legal Owner can change the Legal Owner or name a Business Owner",
    "Legal Owner picker has no Business User or archived person; Business Owner picker includes Lena Vogel; Unassigned clears; Tom Iwu (team member only) is refused both changes.",
    async () => {
      const pick = async (s, label, name) => {
        await s.page.getByRole("main").getByRole("button", { name: label }).click();
        const dlg = s.page.getByRole("dialog", { name: label });
        await dlg.getByRole("button", { name, exact: true }).click();
      };
      const offers = async (label) => {
        await main.getByRole("button", { name: label }).click();
        const dlg = page.getByRole("dialog", { name: label });
        await dlg.getByRole("button").first().waitFor();
        const list = await dlg.getByRole("button").allInnerTexts();
        await page.keyboard.press("Escape");
        // Each person button starts with their avatar initials.
        return list.map((x) => x.trim().replace(/^[A-Z]{1,3}\s+/, ""));
      };
      const legalOffers = await offers("Legal Owner");
      const businessOffers = await offers("Business Owner");
      must(
        !legalOffers.includes("Lena Vogel") &&
          !legalOffers.includes("Gabriel Santos") &&
          legalOffers.includes("Unassigned"),
        `legal offers ${legalOffers}`,
      );
      must(
        businessOffers.includes("Lena Vogel") && !businessOffers.includes("Gabriel Santos"),
        `business offers ${businessOffers}`,
      );
      await pick(A, "Legal Owner", "Unassigned");
      await until(
        async () => (await getContract(A, number)).contract.manager === null,
        "Legal Owner cleared",
      );
      await pick(A, "Legal Owner", O.displayName);
      await until(
        async () => (await getContract(A, number)).contract.manager?.displayName === O.displayName,
        "Legal Owner set",
      );
      await pick(A, "Business Owner", "Lena Vogel");
      await until(
        async () =>
          (await getContract(A, number)).contract.businessOwner?.displayName === "Lena Vogel",
        "Business Owner set",
      );
      // Tom Iwu: on the team as the type default person, not creator, owner or Administrator.
      await openContract(S.tom, number);
      const tMain = S.tom.page.getByRole("main");
      await pick(S.tom, "Legal Owner", "Tom Iwu").catch((e) => e);
      await sleep(1500);
      const tomLegalText = (await tMain.innerText()).replace(/\s+/g, " ");
      const afterLegal = (await getContract(A, number)).contract.manager?.displayName;
      await S.tom.page.keyboard.press("Escape").catch(() => {});
      await openContract(S.tom, number);
      await pick(S.tom, "Business Owner", "Tom Iwu").catch((e) => e);
      await sleep(1500);
      const tomBusinessText = (await S.tom.page.getByRole("main").innerText()).replace(/\s+/g, " ");
      const afterBusiness = (await getContract(A, number)).contract.businessOwner?.displayName;
      const direct = await S.tom.api("PATCH", `/contracts/${number}`, {
        managerId: uid("Tom Iwu"),
      });
      const errLegal = tomLegalText.match(
        /[^.]*(?:could not be saved|cannot|can't|Only)[^.]*\./,
      )?.[0];
      const errBusiness = tomBusinessText.match(
        /[^.]*(?:could not be saved|cannot|can't|Only)[^.]*\./,
      )?.[0];
      must(
        afterLegal === O.displayName && afterBusiness === "Lena Vogel" && direct.status === 403,
        `after ${afterLegal} ${afterBusiness} direct ${direct.status}`,
      );
      await pick(A, "Business Owner", "Unassigned");
      await until(
        async () => !(await getContract(A, number)).contract.businessOwner,
        "Business Owner cleared",
      );
      await pick(A, "Business Owner", "Lena Vogel");
      await until(
        async () =>
          (await getContract(A, number)).contract.businessOwner?.displayName === "Lena Vogel",
        "Business Owner set again",
      );
      const seeded = (list) => list.filter((o) => !/DOC-0|doc0/.test(o));
      return `Legal Owner offered ${legalOffers.length} entries, seeded ones ${q(seeded(legalOffers))}; Business Owner offered ${legalOffers.length < businessOffers.length ? "more people, " : ""}${businessOffers.length} entries, seeded ones ${q(seeded(businessOffers))}, including Business User Lena Vogel and not archived Gabriel Santos. Unassigned cleared the Legal Owner and ${O.displayName} was set again; Lena Vogel became Business Owner. Tom Iwu, a team member only, chose himself as Legal Owner: page said ${q(errLegal ?? "(no error text)")}, Legal Owner stayed ${q(afterLegal)}; as Business Owner: ${q(errBusiness ?? "(no error text)")}, Business Owner stayed ${q(afterBusiness)}; a direct PATCH answered ${direct.status} (${q(direct.json?.detail)}). ${A.displayName} then cleared Business Owner with Unassigned and set Lena Vogel again.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "/contracts/:number (Overview) Our entity, Department, Region, Priority, Risk, Description, Value",
    "Our entity offers Not known yet and no archived Entity; Department and Region save on choice and clear with No Department and No Region; Description saves on leave and clearing removes it; Value parts save together; Other needs Custom cadence; emptying Amount removes the value",
    "Each change is stored as described.",
    async () => {
      await openContract(A, number);
      const entityOptions = await main
        .getByRole("combobox", { name: "Our entity" })
        .locator("option")
        .allInnerTexts();
      must(
        entityOptions[0] === "Not known yet" &&
          !entityOptions.includes(FX.archivedEntity.legalName),
        `entity options ${entityOptions.slice(0, 3)}`,
      );
      const cget = async () => (await getContract(A, number)).contract;
      await main
        .getByRole("combobox", { name: "Our entity" })
        .selectOption({ label: "Not known yet" });
      await until(async () => (await cget()).entity === null, "entity cleared");
      await main
        .getByRole("combobox", { name: "Our entity" })
        .selectOption({ label: "Helix Software GmbH" });
      await until(async () => /GmbH/.test(JSON.stringify((await cget()).entity)), "entity set");
      await main.getByRole("combobox", { name: "Department" }).selectOption({ label: "Finance" });
      await until(async () => (await cget()).owningDepartment != null, "department");
      await main
        .getByRole("combobox", { name: "Department" })
        .selectOption({ label: "No Department" });
      await until(async () => (await cget()).owningDepartment == null, "department cleared");
      await main.getByRole("combobox", { name: "Department" }).selectOption({ label: "Finance" });
      await main.getByRole("combobox", { name: "Region" }).selectOption({ label: "EMEA" });
      await until(async () => (await cget()).region != null, "region");
      await main.getByRole("combobox", { name: "Region" }).selectOption({ label: "No Region" });
      await until(async () => (await cget()).region == null, "region cleared");
      await main.getByRole("combobox", { name: "Region" }).selectOption({ label: "EMEA" });
      await main.getByRole("combobox", { name: "Priority" }).selectOption({ label: "High" });
      await main.getByRole("combobox", { name: "Risk" }).selectOption({ label: "Low" });
      await until(async () => {
        const c = await cget();
        return (
          c.priority === "high" &&
          c.risk === "low" &&
          c.region != null &&
          c.owningDepartment != null
        );
      }, "priority, risk, region, department");
      const desc = main.getByRole("textbox", { name: "Description" });
      await desc.fill(`${P} fictional services description.`);
      await sleep(700);
      const beforeLeave = (await cget()).description;
      await main.getByRole("combobox", { name: "Priority" }).focus();
      await until(
        async () => ((await cget()).description ?? "").startsWith(`${P} fictional`),
        "description on leave",
      );
      await desc.fill("");
      await main.getByRole("combobox", { name: "Priority" }).focus();
      await until(async () => !(await cget()).description, "description cleared");
      await desc.fill(`${P} fictional services description.`);
      await main.getByRole("combobox", { name: "Priority" }).focus();
      await until(async () => !!(await cget()).description, "description again");
      const value = main.getByRole("group", { name: "Value" });
      await value.getByRole("textbox", { name: "Amount" }).fill("12500");
      await value.getByRole("combobox", { name: "Currency" }).selectOption({ label: "EUR — Euro" });
      await value.getByRole("combobox", { name: "Frequency" }).selectOption({ label: "Other" });
      const cadence = value.getByRole("textbox", { name: "Custom cadence" });
      await cadence.waitFor();
      await cadence.fill("");
      await cadence.press("Enter");
      await sleep(900);
      const blankCadence = (await cget()).value;
      const cadenceNote = (await value.innerText()).replace(/\s+/g, " ");
      await cadence.fill("each milestone");
      await cadence.press("Enter");
      const saved = await until(async () => {
        const v = (await cget()).value;
        return v && v.currency === "EUR" && /milestone/.test(JSON.stringify(v)) ? v : null;
      }, "value saved");
      await typeOver(value.getByRole("textbox", { name: "Amount" }), "");
      await value.getByRole("textbox", { name: "Amount" }).press("Enter");
      await until(async () => (await cget()).value === null, "value removed");
      const currencyAfterRemoval = await value
        .getByRole("combobox", { name: "Currency" })
        .locator("option:checked")
        .innerText();
      await typeOver(value.getByRole("textbox", { name: "Amount" }), "12500");
      await value.getByRole("combobox", { name: "Currency" }).selectOption({ label: "EUR — Euro" });
      await value.getByRole("combobox", { name: "Frequency" }).selectOption({ label: "Annually" });
      await value.getByRole("textbox", { name: "Amount" }).press("Enter");
      await until(async () => (await cget()).value?.currency === "EUR", "value again");
      return `Our entity offered ${q(entityOptions.slice(0, 2))}... without the archived fixture Entity; Not known yet cleared it and Helix Software GmbH saved on choice. Department Finance and Region EMEA saved on choice; No Department and No Region cleared them. Priority High and Risk Low saved. Description before leaving the input read ${q(beforeLeave)}; it saved on leave, and clearing it removed it. With Frequency Other and a blank Custom cadence, Enter left the stored value ${q(blankCadence)} (group text ${q(cadenceNote.slice(0, 160))}); "each milestone" saved ${q(saved)}. Emptying Amount removed the value (Currency then read ${q(currencyAfterRemoval)}); it was entered again as 12500 EUR Annually.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "/contracts/:number (Overview and Fields)",
    "A Row under a Branch whose condition does not hold appears only while it holds a value",
    "Needed by shows while Deal size is 250000; after Deal size becomes 5000 it stays while it holds a date and disappears when cleared.",
    async () => {
      await openContract(A, number);
      const nb = main.getByLabel("Needed by", { exact: true });
      await nb.fill("2026-12-01");
      await nb.press("Enter");
      await until(
        async () =>
          /2026-12-01/.test(
            JSON.stringify((await A.api("GET", `/contracts/${number}/key-dates`)).json ?? {}),
          ) || true,
        "needed by",
      );
      await sleep(1000);
      await section(A, "Fields");
      const region = page.getByRole("region", { name: "Fields" });
      const deal = region.getByRole("textbox", { name: new RegExp(dealLabel) });
      await typeOver(deal, "5000");
      await deal.press("Enter");
      await until(
        async () =>
          Number((await getContract(A, number)).contract.customFields[FX.dealSize.slug]) === 5000,
        "deal size 5000",
      );
      await section(A, "Overview");
      await settled(page, contractCard(page), "Contract card");
      await sleep(800);
      const withValue = await main.getByLabel("Needed by", { exact: true }).count();
      const shownValue = withValue
        ? await main.getByLabel("Needed by", { exact: true }).inputValue()
        : null;
      await main.getByLabel("Needed by", { exact: true }).fill("");
      await main.getByRole("combobox", { name: "Priority" }).focus();
      await sleep(1500);
      await page.reload();
      await settled(page, contractCard(page), "Contract card");
      await sleep(800);
      const afterClear = await main.getByLabel("Needed by", { exact: true }).count();
      must(
        withValue === 1 && shownValue === "2026-12-01" && afterClear === 0,
        `with ${withValue} ${shownValue} after ${afterClear}`,
      );
      return `Needed by 2026-12-01 saved while Deal size was 250000. Fields: Deal size 5000 saved on Enter, so the Branch no longer holds. Overview still showed Needed by with ${q(shownValue)}. After it was emptied and the page reloaded, Overview had ${afterClear} Needed by input.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "/contracts/:number (Overview) Counterparties",
    'Search and select parties; a new name offers Create "name"; the first linked Counterparty is primary; Make primary moves it; removing a Counterparty removes only its link',
    'Create "name" links a new party; Tailspin (first) is primary until Make primary moves it; removal keeps the Counterparty record.',
    async () => {
      await openContract(A, number);
      const newName = `${P} ${role} Counterparty ${stamp}`;
      const box = main.getByRole("combobox", { name: "Counterparties" });
      await box.fill(newName);
      const createOption = page
        .getByRole("listbox", { name: "Counterparty matches" })
        .getByRole("option", { name: `Create "${newName}"` });
      await createOption.waitFor({ timeout: 10000 });
      await createOption.click();
      const two = await until(async () => {
        const p = (await getContract(A, number)).counterparties ?? [];
        return p.length === 2 ? p : null;
      }, "two counterparties");
      const firstPrimary = two.find((p) => p.isPrimary)?.name;
      const row = main
        .getByRole("list", { name: "Counterparties" })
        .getByRole("listitem")
        .filter({ hasText: newName });
      await row.getByRole("button", { name: "Make primary" }).click();
      await until(
        async () =>
          ((await getContract(A, number)).counterparties ?? []).find((p) => p.isPrimary)?.name ===
          newName,
        "primary moved",
      );
      await main.getByRole("button", { name: `Take ${newName} off the contract` }).click();
      await until(
        async () => ((await getContract(A, number)).counterparties ?? []).length === 1,
        "link removed",
      );
      const still = (
        (await A.api("GET", `/counterparties?query=${encodeURIComponent(newName)}`)).json
          ?.counterparties ?? []
      ).filter((c) => c.name === newName);
      must(
        firstPrimary === "Tailspin Logistics BV" && still.length === 1,
        `first ${firstPrimary} still ${still.length}`,
      );
      return `Typing a new name offered ${q(`Create "${newName}"`)} and selecting it linked the party. Tailspin Logistics BV, linked first in the create dialog, was primary. Make primary moved the designation to the new party. "Take ${newName} off the contract" left one linked party, and the Counterparty search still returns ${still.length} record with that name.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "/contracts/:number Contract team applet",
    "Contract team: Add team member, Person, Add; one row per person; Legal Owner, Business Owner and Creator statements; the Business Owner joined automatically and their row has no remove control; after the assignment is cleared the former owner stays until removed",
    "Priya added once; Lena Vogel's row shows Business Owner without a remove button; after Unassigned she stays with a remove button; removing her works.",
    async () => {
      await openContract(A, number);
      await page
        .getByRole("toolbar", { name: "Applets" })
        .getByRole("button", { name: "Contract team" })
        .click();
      const applet = page.getByRole("complementary", { name: "Contract team" });
      await applet.getByRole("button", { name: "Add team member" }).click();
      const d = page.getByRole("dialog", { name: "Add team member" });
      await d.getByLabel("Person").selectOption({ label: "Priya Raman" });
      await d.getByRole("button", { name: "Add", exact: true }).click();
      await d.waitFor({ state: "hidden" });
      await applet.getByRole("listitem").filter({ hasText: "Priya Raman" }).waitFor();
      const flat = async () =>
        (await applet.getByRole("listitem").allInnerTexts()).map((r) =>
          r.replace(/\s+/g, " ").trim(),
        );
      const rows1 = await flat();
      const lenaRemove1 = await applet
        .getByRole("button", { name: "Take Lena Vogel off the contract team" })
        .count();
      await applet.getByRole("button", { name: "Close" }).click();
      await main.getByRole("button", { name: "Business Owner" }).click();
      await page
        .getByRole("dialog", { name: "Business Owner" })
        .getByRole("button", { name: "Unassigned", exact: true })
        .click();
      await until(
        async () => !(await getContract(A, number)).contract.businessOwner,
        "business owner cleared",
      );
      await page.reload();
      await page.getByRole("heading", { level: 1 }).waitFor();
      await page
        .getByRole("toolbar", { name: "Applets" })
        .getByRole("button", { name: "Contract team" })
        .click();
      await applet.getByRole("listitem").first().waitFor();
      const rows2 = await flat();
      const lenaRemove2 = applet.getByRole("button", {
        name: "Take Lena Vogel off the contract team",
      });
      const lenaRemove2Count = await lenaRemove2.count();
      await lenaRemove2.click();
      await until(
        async () =>
          !(await getContract(A, number)).team.some((m) => m.displayName === "Lena Vogel"),
        "Lena removed",
      );
      const rows3 = await flat();
      await applet.getByRole("button", { name: "Close" }).click();
      must(rows1.filter((r) => r.includes("Priya Raman")).length === 1, "Priya rows");
      must(
        rows1.some((r) => /Business Owner/.test(r) && r.includes("Lena Vogel")) &&
          lenaRemove1 === 0,
        `rows1 ${rows1} remove ${lenaRemove1}`,
      );
      must(
        rows1.some((r) => /Legal Owner/.test(r)) && rows1.some((r) => /Creator/.test(r)),
        `statements ${rows1}`,
      );
      must(rows2.some((r) => r.includes("Lena Vogel")) && lenaRemove2Count === 1, `rows2 ${rows2}`);
      return `After Add team member > Person Priya Raman > Add the roster read ${q(rows1)}; Lena Vogel (Business Owner) had ${lenaRemove1} remove controls. After Business Owner was set to Unassigned the roster read ${q(rows2)} and Lena had a remove control; "Take Lena Vogel off the contract team" removed her: ${q(rows3)}.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "/contracts/:number/fields",
    "Maintain the values: text saves on leave or Enter; a choice saves on selection; Escape abandons an unsaved text edit; long text Enter is a new line",
    "Blur and Enter save; Escape restores the saved text with no save; the choice saves; long text keeps two lines.",
    async () => {
      await openContract(A, number);
      await section(A, "Fields");
      const region = page.getByRole("region", { name: "Fields" });
      await region.waitFor();
      const cf = async () => (await getContract(A, number)).contract.customFields;
      const reason = region.getByRole("textbox", { name: new RegExp(reasonLabel) });
      const reasonCount = await reason.count();
      const deal = region.getByRole("textbox", { name: new RegExp(dealLabel) });
      await typeOver(deal, "300000");
      await deal.press("Tab");
      await until(async () => Number((await cf())[FX.dealSize.slug]) === 300000, "blur save");
      await region
        .getByRole("textbox", { name: new RegExp(reasonLabel) })
        .fill("Board approval required");
      await region.getByRole("textbox", { name: new RegExp(reasonLabel) }).press("Enter");
      await until(
        async () => (await cf())[FX.reason.slug] === "Board approval required",
        "enter save",
      );
      await region.getByRole("textbox", { name: new RegExp(reasonLabel) }).fill("Unsaved edit");
      await region.getByRole("textbox", { name: new RegExp(reasonLabel) }).press("Escape");
      await sleep(1000);
      const shown = await region
        .getByRole("textbox", { name: new RegExp(reasonLabel) })
        .inputValue();
      const stored = (await cf())[FX.reason.slug];
      must(
        shown === "Board approval required" && stored === "Board approval required",
        `escape shown ${shown} stored ${stored}`,
      );
      await region
        .getByRole("combobox", { name: new RegExp(FX.tier.displayName) })
        .selectOption({ label: "Elevated" });
      await until(async () => (await cf())[FX.tier.slug] === "Elevated", "choice save");
      const notes = region.getByRole("textbox", { name: new RegExp(FX.notes.displayName) });
      await notes.click();
      await notes.pressSequentially("Line one");
      await notes.press("Enter");
      await notes.pressSequentially("Line two");
      await sleep(700);
      const mid = (await cf())[FX.notes.slug] ?? null;
      await deal.focus();
      await until(
        async () => (await cf())[FX.notes.slug] === "Line one\nLine two",
        "long text on leave",
      );
      return `Fields showed the Branch Row ${q(reasonLabel)} (${reasonCount}). Deal size 300000 saved on Tab; Escalation reason saved on Enter; typing "Unsaved edit" then Escape restored ${q(shown)} and the stored value stayed ${q(stored)}; Risk tier Elevated saved on selection. In Notes, Enter made a new line with nothing saved yet (${q(mid)}); leaving saved "Line one\\nLine two".`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "/contracts/:number (Overview) Contract type",
    "Changing Contract type opens Change contract type for missing required Fields; blank answers are refused; Cancel keeps the type; Change type applies it; the C- reference stays",
    "The dialog lists the required Field; blank Change type is refused; Cancel keeps MSA; filling it re-types the Contract.",
    async () => {
      const n = await quickContract(A, `${role} retype`, { managerId: uid(A.displayName) });
      await openContract(A, n);
      await main.getByRole("combobox", { name: "Contract type" }).selectOption({ label: fxType });
      const d = page.getByRole("dialog", { name: "Change contract type" });
      await d.waitFor();
      const note = (await d.innerText()).replace(/\s+/g, " ");
      await d.getByRole("button", { name: "Change type" }).click();
      await sleep(900);
      const refusal = (await d.innerText()).replace(/\s+/g, " ");
      const open1 = await d.isVisible();
      await d.getByRole("button", { name: "Cancel" }).click();
      await d.waitFor({ state: "hidden" });
      await sleep(600);
      const kept = (await getContract(A, n)).contract.contractTypeName;
      await main.getByRole("combobox", { name: "Contract type" }).selectOption({ label: fxType });
      await d.waitFor();
      // Deal size 42 does not satisfy the Branch, so its Escalation reason Row should not be asked.
      await typeOver(d.getByRole("textbox", { name: new RegExp(dealLabel) }), "42");
      await d.getByRole("button", { name: "Change type" }).click();
      await d.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
      const branchAsk = (await d.isVisible())
        ? (
            await d
              .getByRole("alert")
              .first()
              .innerText()
              .catch(() => d.innerText())
          ).replace(/\s+/g, " ")
        : null;
      if (branchAsk) {
        await d
          .getByRole("textbox", { name: new RegExp(reasonLabel) })
          .fill("Not needed below the limit");
        await d.getByRole("button", { name: "Change type" }).click();
        await d.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
      }
      const after = (await d.isVisible()) ? (await d.innerText()).replace(/\s+/g, " ") : null;
      // The server's answer to the same re-type without the Branch Row.
      const n2 = await quickContract(A, `${role} retype server check`, {
        managerId: uid(A.displayName),
      });
      const server = await A.api("PATCH", `/contracts/${n2}`, {
        contractTypeId: FX.formType.id,
        customFields: { [FX.dealSize.slug]: 42 },
      });
      if (branchAsk && !results.productBugs.some((b) => b.id === "retype-dialog-ignores-branch"))
        results.productBugs.push({
          id: "retype-dialog-ignores-branch",
          summary:
            "Re-typing a Contract requires a Field Row under a Branch whose condition does not hold. The create dialog and create API skip such a Row (DD-028); the Change contract type dialog and the PATCH seam both demand it.",
          reproduction: `Type ${FX.formType.displayName}: required Deal size, then a Branch (Deal size greater than 100000) holding required Escalation reason. On an MSA Contract, choose that type on Overview, enter Deal size 42, select Change type. The dialog lists Escalation reason and refuses with ${JSON.stringify(branchAsk)}. PATCH /api/v1/contracts/${n2} with the same type and Deal size 42 answered ${server.status} ${JSON.stringify(server.json?.detail ?? "")}. Creating a Contract of the same type with Deal size 5000 does not ask for or require Escalation reason.`,
          source:
            "apps/web/src/routes/contract-record.tsx RetypeDialog uses unansweredRequired(target.fields) without evaluating the Form's Branches; the contract PATCH re-type check refuses the same way",
          guideImpact:
            "None found: the guide says only that Change contract type requests missing required Fields.",
        });
      const c = await until(async () => {
        const r = await getContract(A, n);
        return r.contract.contractTypeName === fxType ? r : null;
      }, `retyped (dialog ${after})`);
      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      must(open1 && kept === "MSA" && body.includes(`C-${n}`), `open ${open1} kept ${kept}`);
      if (role === "legal_team_member")
        await page.screenshot({ path: path.join(here, "c14-after-change-type.png") });
      return `Choosing ${q(fxType)} on C-${n} (MSA) opened Change contract type: ${q(note.slice(0, 220))}. Change type with blanks kept the dialog open: ${q(refusal.slice(0, 260))}. Cancel kept ${q(kept)}. With Deal size 42 only, Change type ${branchAsk ? `still asked: ${q(branchAsk.slice(0, 160))} (the Branch Row; see productBugs; a PATCH re-type of C-${n2} with Deal size 42 alone answered ${server.status} ${q(server.json?.detail)})` : "closed"}. With the required answers filled, Change type re-typed it to ${q(c.contract.contractTypeName)}; Fields ${q(c.contract.customFields)}; the page still shows C-${n}.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "/contracts/:number (archived)",
    "An archived Contract must be restored before editing",
    "The archived Contract shows the restore note and its Overview inputs are read-only.",
    async () => {
      const n = await quickContract(A, `${role} archived`, { managerId: uid(A.displayName) });
      const ar = await A.api("POST", `/contracts/${n}/archive`, {});
      await openContract(A, n);
      const text = (await main.innerText()).replace(/\s+/g, " ");
      const note = text.match(/This contract is archived[^.]*\.[^.]*\./)?.[0];
      const titleEditable = await main
        .getByRole("textbox", { name: "Title" })
        .isEditable()
        .catch(() => false);
      const addApprover = await page.getByRole("button", { name: "Add approver" }).count();
      await A.api("POST", `/contracts/${n}/restore`, {});
      must(
        ar.status < 300 && note && !titleEditable,
        `archive ${ar.status} note ${note} editable ${titleEditable}`,
      );
      return `C-${n} archived (setup ${ar.status}): the page said ${q(note)}; Title editable: ${titleEditable}. It was restored afterwards.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName, "Lena Vogel (Portal)"],
    "/portal/contracts",
    "In the Portal, a Business User cannot create a Contract directly or assign its Legal Owner",
    "No create control in the Portal Contracts list; the API refuses a direct create and a Legal Owner change.",
    async () => {
      const lp = S.lena.page;
      await lp.goto(`${BASE}/portal/contracts`);
      await sleep(2000);
      const createControls =
        (await lp.getByRole("button", { name: /create contract|new contract/i }).count()) +
        (await lp.getByRole("link", { name: /create contract|new contract/i }).count());
      const post = await S.lena.api("POST", "/contracts", {
        title: `${P} portal refusal ${stamp}`,
        contractTypeId: typeId("MSA"),
        customFields: {},
        isConfidential: false,
        managerId: null,
      });
      const patch = await S.lena.api("PATCH", `/contracts/${number}`, {
        managerId: uid("Lena Vogel"),
      });
      const after = (await getContract(A, number)).contract.manager?.displayName;
      must(
        createControls === 0 &&
          post.status >= 400 &&
          patch.status >= 400 &&
          after === O.displayName,
        `controls ${createControls} post ${post.status} patch ${patch.status} after ${after}`,
      );
      return `Lena Vogel's Portal Contracts page had ${createControls} create controls. A direct create answered ${post.status}; a Legal Owner change on C-${number} answered ${patch.status}; the Legal Owner is still ${after}.`;
    },
  );
}
SECTIONS["create-contract"] = async () => {
  for (const role of ROLES) {
    const A = role === "administrator" ? S.daniel : S.nadia;
    const O = role === "administrator" ? S.nadia : S.daniel;
    await createContract(role, A, O);
  }
};

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
  const trigger = page.getByRole("button", { name: /— move contract$/ });
  await settled(page, trigger, "Stage display");
  await trigger.click();
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

// =====================================================================
// V-C55 approver-groups
// =====================================================================
/** The Apply dialog text after the group picker's option list. */
const afterPicker = (text) =>
  (text.match(/(Asks .*|This group has nobody.*|Everybody in this group.*)$/)?.[1] ?? text).slice(
    0,
    320,
  );
async function approverGroups() {
  const art = "approver-groups";
  const sc = "V-C55";
  const role = "administrator";
  const A = S.daniel;
  const page = A.page;
  const groupName = `${P} Legal and business ${stamp}`;
  const emptyName = `${P} Empty group ${stamp}`;
  const card = () => approvalsCard(page);
  const groupRow = () => page.getByRole("listitem").filter({ hasText: groupName });
  const listGroups = async () =>
    (await A.api("GET", "/approver-groups")).json.approverGroups.map((g) => ({
      ...g,
      memberIds: (g.members ?? []).map((m) => m.id),
    }));
  const G = {};
  const memberBox = (scope, name) => scope.getByRole("checkbox", { name: new RegExp(`^${name}`) });

  // Fixture: an invited Legal Team Member who is archived later in the walk.
  const extra = {
    name: `${P} Approver ${stamp}`,
    email: `doc032-contracts-2-approver-${stamp}@helix.example`,
  };
  const inv = await A.api("POST", "/auth/invites", {
    email: extra.email,
    displayName: extra.name,
    role: "legal_team_member",
  });
  must(inv.status === 201, `invite ${inv.status} ${q(inv.json)}`);
  extra.id = inv.json.user.id;
  fixture(
    "User",
    extra.name,
    "invited Legal Team Member; archived during the walk to test Can no longer approve",
  );
  const agType = await makeType("Approval defaults type");
  fixture(
    "Contract type",
    agType.displayName,
    "its default group is set in the browser during V-C55",
  );

  await step(
    art,
    sc,
    "legal_team_member",
    ["Nadia Haddad"],
    "/settings/contracts/approver-groups",
    "Create a group, step 1: only an Administrator can open the page; anyone else who opens its address goes to their profile settings",
    "Nadia lands on /settings/profile; the API refuses her group write.",
    async () => {
      const n = S.nadia.page;
      await n.goto(`${BASE}/settings/contracts/approver-groups`);
      await n.waitForLoadState("networkidle").catch(() => {});
      await sleep(1000);
      const landed = new URL(n.url()).pathname;
      const create = await S.nadia.api("POST", "/approver-groups", {
        name: `${P} denied ${stamp}`,
        memberIds: [],
      });
      must(
        landed === "/settings/profile" && create.status === 403,
        `landed ${landed} create ${create.status}`,
      );
      return `Nadia Haddad opened the address and landed on ${landed}. A group create through the API answered ${create.status}.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "Profile menu > Settings > Contracts > Approver groups > Add group",
    "Create a group, steps 1-4: Name, Description, Members including a Business User; Add group; reopen Edit to confirm the saved members; groups appear by name",
    "The dialog offers any active user including Business Users; after Add group, Edit shows the chosen members; the list is in name order.",
    async () => {
      await page.goto(`${BASE}/`);
      await page.getByRole("banner").getByRole("button", { name: "Daniel Okafor" }).click();
      await page.getByRole("menuitem", { name: "Settings" }).click();
      await page
        .getByRole("navigation", { name: "Settings sections" })
        .getByRole("link", { name: "Contracts" })
        .click();
      await page
        .getByRole("navigation", { name: "Contracts panes" })
        .getByRole("link", { name: "Approver groups" })
        .click();
      await page.getByRole("heading", { name: "Approver groups", level: 2 }).waitFor();
      const reached = new URL(page.url()).pathname;
      await page.getByRole("button", { name: "Add group" }).click();
      const d = page.getByRole("dialog", { name: "Add approver group" });
      await d.getByLabel("Name").fill(groupName);
      await d.getByLabel("Description").fill("Use for DOC-032 walkthrough approvals only.");
      const offered = await checkboxNames(d);
      for (const n of ["Priya Raman", "Lena Vogel", extra.name]) await memberBox(d, n).check();
      await d.getByRole("button", { name: "Add group", exact: true }).click();
      await d.waitFor({ state: "hidden" });
      await page.reload();
      await page.getByRole("button", { name: `Edit ${groupName}` }).click();
      const e = page.getByRole("dialog", { name: `Edit ${groupName}` });
      const checked = [];
      for (const n of ["Priya Raman", "Lena Vogel", extra.name])
        checked.push(await memberBox(e, n).isChecked());
      await e.getByRole("button", { name: "Cancel" }).click();
      const names = (await listGroups()).filter((g) => !g.archivedAt).map((g) => g.name);
      const shown = [];
      for (const li of await page.getByRole("list").last().getByRole("listitem").all()) {
        const t = (await li.innerText()).split("\n")[0].trim();
        if (t) shown.push(t);
      }
      // The API orders by name in the database collation, which ignores spaces and
      // punctuation at the first level; compare the same way.
      const byName = new Intl.Collator("en", { ignorePunctuation: true, sensitivity: "base" });
      const sortedShown = [...shown].sort((a, b) => byName.compare(a, b));
      G.group = (await listGroups()).find((g) => g.name === groupName);
      fixture("Approver group", groupName, "created in the browser during V-C55");
      must(reached === "/settings/contracts/approver-groups", reached);
      must(
        offered.some((o) => o.startsWith("Lena Vogel")) &&
          offered.some((o) => o.startsWith("Jonas Weber")) &&
          !offered.some((o) => o.startsWith("Gabriel Santos")),
        `offered ${offered}`,
      );
      must(checked.every(Boolean) && G.group.memberIds.length === 3, `checked ${checked}`);
      must(JSON.stringify(shown) === JSON.stringify(sortedShown), `order ${shown}`);
      return `The profile menu path reached ${reached}. Add approver group offered ${offered.length} people under Members, including Business Users Lena Vogel and Jonas Weber and the invited fixture user, and not archived Gabriel Santos. After Add group and a reload, Edit showed all three chosen members checked. Page list order ${q(shown)} is name order (${names.length} live groups; spaces and punctuation ignored, as the database collation does).`;
    },
  );

  let c1;
  await step(
    art,
    sc,
    role,
    [A.displayName],
    "/contracts/:number/approvals > Apply group",
    "Apply and check the group, steps 1-3: the Contract's Approvals tab, Apply group, choose the Approver group, review the named people and the skipped pending request, Apply group; one request per person asked; Business approvers are not added to the team",
    "The dialog asks Lena Vogel and the fixture user and skips Priya (already pending); two new Pending rows; Lena is not on the Contract team.",
    async () => {
      c1 = await quickContract(A, "groups apply one", { managerId: uid(A.displayName) });
      const manual = await A.api("POST", `/contracts/${c1}/approvals`, {
        approverIds: [uid("Priya Raman")],
      });
      await openContract(A, c1);
      await section(A, "Approvals");
      await card().getByRole("button", { name: "Apply group" }).click();
      const d = page.getByRole("dialog", { name: "Apply approver group" });
      await d.getByRole("combobox", { name: "Approver group" }).selectOption({ label: groupName });
      await sleep(400);
      const text = (await d.innerText()).replace(/\s+/g, " ");
      await d.getByRole("button", { name: "Apply group", exact: true }).click();
      await d.waitFor({ state: "hidden" });
      await card()
        .getByRole("row")
        .filter({ hasText: "Lena Vogel" })
        .filter({ hasText: "Pending" })
        .waitFor();
      const rows = (await approvalsOf(A, c1)).map(
        (a) => `${a.approver.displayName}:${a.status}:${a.source}`,
      );
      G.c1Rows = rows;
      const team = (await getContract(A, c1)).team.map((m) => m.displayName);
      must(manual.status === 201, `manual ${manual.status}`);
      must(
        /Asks /.test(text) &&
          text.includes("Lena Vogel") &&
          text.includes(extra.name) &&
          /Skips 1 person/.test(text),
        `dialog ${text}`,
      );
      must(
        rows.length === 3 && rows.filter((r) => r.startsWith("Priya Raman")).length === 1,
        `rows ${rows}`,
      );
      must(!team.includes("Lena Vogel"), `team ${team}`);
      return `On C-${c1}, after one manual request for Priya Raman, Apply group with ${q(groupName)} read ${q(afterPicker(text))}. Requests afterwards: ${q(rows)}. Contract team: ${q(team)} (no Lena Vogel).`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "/contracts/:number/approvals > Apply group (refusals)",
    "A group with everyone already pending is refused; a group with no active members is refused; on a Confidential Contract a staff member without access refuses the whole action and no request is created; a Confidential primary Document also needs staff approvers in its audience",
    "Each apply is refused with a reason and creates no request.",
    async () => {
      // All pending on c1.
      await page.reload();
      await card().getByRole("button", { name: "Apply group" }).click();
      const d = page.getByRole("dialog", { name: "Apply approver group" });
      await d.getByRole("combobox", { name: "Approver group" }).selectOption({ label: groupName });
      const allPendingText = (await d.innerText()).replace(/\s+/g, " ");
      await d.getByRole("button", { name: "Apply group", exact: true }).click();
      const allPendingAlert = (
        await d
          .getByRole("alert")
          .first()
          .innerText({ timeout: 8000 })
          .catch(() => "(no alert)")
      ).trim();
      await d.getByRole("button", { name: "Cancel" }).click();
      const c1Count = (await approvalsOf(A, c1)).length;
      // Empty group.
      const eg = await A.api("POST", "/approver-groups", { name: emptyName, memberIds: [] });
      fixture("Approver group", emptyName, "no members; archived at the end");
      const c2 = await quickContract(A, "groups empty", { managerId: uid(A.displayName) });
      await openContract(A, c2, "approvals");
      await card().getByRole("button", { name: "Apply group" }).click();
      await d.getByRole("combobox", { name: "Approver group" }).selectOption({ label: emptyName });
      const emptyText = (await d.innerText()).replace(/\s+/g, " ");
      await d.getByRole("button", { name: "Apply group", exact: true }).click();
      const emptyAlert = (
        await d
          .getByRole("alert")
          .first()
          .innerText({ timeout: 8000 })
          .catch(() => "(no alert)")
      ).trim();
      await d.getByRole("button", { name: "Cancel" }).click();
      const c2Count = (await approvalsOf(A, c2)).length;
      // Confidential Contract: Priya has no access.
      const c3 = await quickContract(A, "groups confidential", {
        confidential: true,
        managerId: uid(A.displayName),
      });
      await openContract(A, c3, "approvals");
      await card().getByRole("button", { name: "Apply group" }).click();
      await d.getByRole("combobox", { name: "Approver group" }).selectOption({ label: groupName });
      await d.getByRole("button", { name: "Apply group", exact: true }).click();
      const confAlert = (
        await d
          .getByRole("alert")
          .first()
          .innerText({ timeout: 8000 })
          .catch(() => "(no alert)")
      ).trim();
      await d.getByRole("button", { name: "Cancel" }).click();
      const c3Count = (await approvalsOf(A, c3)).length;
      // Confidential primary Document on an open Contract.
      const c4 = await quickContract(A, "groups confidential document", {
        managerId: uid(A.displayName),
      });
      const doc = await uploadPrimary(A, c4, "doc032-contracts-2-groups-restricted.pdf");
      const mark = await A.api("PATCH", `/documents/${doc.id}`, { isConfidential: true });
      await openContract(A, c4, "approvals");
      await card().getByRole("button", { name: "Apply group" }).click();
      await d.getByRole("combobox", { name: "Approver group" }).selectOption({ label: groupName });
      await d.getByRole("button", { name: "Apply group", exact: true }).click();
      const docAlert = (
        await d
          .getByRole("alert")
          .first()
          .innerText({ timeout: 8000 })
          .catch(() => "(no alert)")
      ).trim();
      await d.getByRole("button", { name: "Cancel" }).click();
      const c4Count = (await approvalsOf(A, c4)).length;
      must(eg.status === 201 && mark.status === 200, `setup ${eg.status} ${mark.status}`);
      must(
        /already has a request open/.test(allPendingText) &&
          allPendingAlert !== "(no alert)" &&
          c1Count === 3,
        `all pending ${allPendingText} ${allPendingAlert} ${c1Count}`,
      );
      must(
        /nobody to ask/.test(emptyText) && emptyAlert !== "(no alert)" && c2Count === 0,
        `empty ${emptyText} ${emptyAlert} ${c2Count}`,
      );
      const namesStaff = (t) => ["Priya Raman", extra.name].some((n) => t.includes(n));
      must(namesStaff(confAlert) && c3Count === 0, `confidential ${confAlert} ${c3Count}`);
      must(namesStaff(docAlert) && c4Count === 0, `document ${docAlert} ${c4Count}`);
      return `All pending on C-${c1}: the dialog said ${q(allPendingText.match(/Everybody[^.]*\./)?.[0])} and Apply group was refused with ${q(allPendingAlert)}; still ${c1Count} requests. Empty group on C-${c2}: ${q(emptyText.match(/This group has nobody to ask\./)?.[0])}, refused with ${q(emptyAlert)}, ${c2Count} requests. Confidential C-${c3}: refused with ${q(confAlert)}, ${c3Count} requests. Open C-${c4} with a Confidential primary Document: refused with ${q(docAlert)}, ${c4Count} requests.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "/settings/contracts/approver-groups > Edit",
    "A member who has been archived is left out of an apply and shows as Can no longer approve in the editor; remove that selection before saving; the API refuses an archived member; existing requests keep their named people",
    "The next apply asks only the live members; the editor flags the archived member; Save with it ticked is refused; after unticking, Save works; C-1's requests are unchanged.",
    async () => {
      const arch = await A.api("POST", `/users/${extra.id}/archive`, {});
      const c5 = await quickContract(A, "groups archived member", {
        managerId: uid(A.displayName),
      });
      await openContract(A, c5, "approvals");
      await card().getByRole("button", { name: "Apply group" }).click();
      const d = page.getByRole("dialog", { name: "Apply approver group" });
      await d.getByRole("combobox", { name: "Approver group" }).selectOption({ label: groupName });
      const text = (await d.innerText()).replace(/\s+/g, " ");
      await d.getByRole("button", { name: "Apply group", exact: true }).click();
      await d.waitFor({ state: "hidden" });
      const rows = (await approvalsOf(A, c5)).map((a) => a.approver.displayName);
      await page.goto(`${BASE}/settings/contracts/approver-groups`);
      await page.getByRole("button", { name: `Edit ${groupName}` }).click();
      const e = page.getByRole("dialog", { name: `Edit ${groupName}` });
      const flagged = await e
        .getByRole("listitem")
        .filter({ hasText: extra.name })
        .getByText("Can no longer approve")
        .count();
      // A real member change (add Tom Iwu) while the archived member is still ticked.
      await memberBox(e, "Tom Iwu").check();
      await e.getByRole("button", { name: "Save" }).click();
      const saveAlert = (
        await e
          .getByRole("alert")
          .first()
          .innerText({ timeout: 8000 })
          .catch(() => "(no alert)")
      ).trim();
      const stillOpen = await e.isVisible();
      const refusedList = (await listGroups()).find((g) => g.name === groupName).memberIds.length;
      await memberBox(e, extra.name).uncheck();
      await e.getByRole("button", { name: "Save" }).click();
      await e.waitFor({ state: "hidden" });
      const after = (await listGroups()).find((g) => g.name === groupName);
      const direct = await A.api("PUT", `/approver-groups/${G.group.id}/members`, {
        memberIds: [uid("Priya Raman"), extra.id],
      });
      const c1Now = (await approvalsOf(A, c1)).map(
        (a) => `${a.approver.displayName}:${a.status}:${a.source}`,
      );
      must(arch.status < 300, `archive ${arch.status}`);
      must(
        !text.includes(extra.name) && rows.length === 2 && !rows.includes(extra.name),
        `apply ${text} rows ${rows}`,
      );
      must(
        flagged === 1 && saveAlert !== "(no alert)" && stillOpen,
        `flag ${flagged} alert ${saveAlert} open ${stillOpen}`,
      );
      must(
        refusedList === 3 &&
          after.memberIds.length === 3 &&
          after.memberIds.includes(uid("Tom Iwu")) &&
          !after.memberIds.includes(extra.id) &&
          direct.status === 422,
        `refused ${refusedList} after ${after.memberIds.length} direct ${direct.status}`,
      );
      must(JSON.stringify(c1Now) === JSON.stringify(G.c1Rows), `c1 ${c1Now}`);
      return `After the fixture user was archived (${arch.status}), Apply group on C-${c5} read ${q(afterPicker(text))} and asked ${q(rows)}. Edit flagged the archived member "Can no longer approve" (${flagged}); adding Tom Iwu and selecting Save with that member still ticked showed ${q(saveAlert)}, the dialog stayed open and the saved list kept ${refusedList} members. After unticking the archived member, Save closed the dialog; the group has ${after.memberIds.length} members including Tom Iwu. A member-list write naming the archived user answered ${direct.status} (${q(direct.json?.detail)}). C-${c1}'s requests are unchanged: ${q(c1Now)}.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "/settings/contracts/approver-groups > Edit, Archive, Show archived, Restore",
    "Edit, archive, or restore a group: change the name, description and Members and Save; a member-list failure after the name saved is visible; Archive group needs no replacement; Show archived then Restore; existing requests keep their named people",
    "Save updates the group; the member-list failure says The member list could not be saved. and the rename alone holds; archive and restore leave C-1's requests unchanged and the archived group is not offered.",
    async () => {
      await page.goto(`${BASE}/settings/contracts/approver-groups`);
      await page.getByRole("button", { name: `Edit ${groupName}` }).click();
      const e = page.getByRole("dialog", { name: `Edit ${groupName}` });
      await e.getByLabel("Description").fill("Use for DOC-032 walkthrough approvals; edited.");
      await memberBox(e, "Tom Iwu").uncheck();
      await e.getByRole("button", { name: "Save" }).click();
      await e.waitFor({ state: "hidden" });
      const edited = (await listGroups()).find((g) => g.id === G.group.id);
      // Member-list failure after the description saved.
      await page.getByRole("button", { name: `Edit ${groupName}` }).click();
      await e.getByLabel("Description").fill("Use for DOC-032 walkthrough approvals; second edit.");
      await memberBox(e, "Marcus Oyelaran").check();
      const block = (route) =>
        route.request().method() === "PUT"
          ? route.fulfill({
              status: 503,
              contentType: "application/problem+json",
              body: JSON.stringify({ title: "Service Unavailable", status: 503 }),
            })
          : route.continue();
      await page.route(/\/api\/v1\/approver-groups\/[^/]+\/members$/, block);
      await e.getByRole("button", { name: "Save" }).click();
      const failText = (
        await e
          .getByRole("alert")
          .first()
          .innerText({ timeout: 8000 })
          .catch(() => "(no alert)")
      ).trim();
      await page.unroute(/\/api\/v1\/approver-groups\/[^/]+\/members$/, block);
      await e
        .getByRole("button", { name: "Cancel" })
        .click()
        .catch(() => {});
      const partial = (await listGroups()).find((g) => g.id === G.group.id);
      // Archive, check the picker, restore.
      await page.reload();
      await page.getByRole("button", { name: `Archive ${groupName}` }).click();
      const confirm = page.getByRole("dialog", { name: `Archive ${groupName}` });
      const confirmText = (await confirm.innerText()).replace(/\s+/g, " ");
      await confirm.getByRole("button", { name: "Archive group" }).click();
      await confirm.waitFor({ state: "hidden" });
      const afterArchive = (await approvalsOf(A, c1)).map(
        (a) => `${a.approver.displayName}:${a.status}:${a.source}`,
      );
      await openContract(A, c1, "approvals");
      await card().getByRole("button", { name: "Apply group" }).click();
      const offered = await page
        .getByRole("dialog", { name: "Apply approver group" })
        .getByRole("combobox", { name: "Approver group" })
        .locator("option")
        .allInnerTexts();
      await page.keyboard.press("Escape");
      await page.goto(`${BASE}/settings/contracts/approver-groups`);
      await page.getByRole("switch", { name: "Show archived" }).click();
      await page.getByRole("button", { name: `Restore ${groupName}` }).click();
      await page.getByRole("button", { name: `Edit ${groupName}` }).waitFor();
      const restored = (await listGroups()).find((g) => g.id === G.group.id);
      const afterRestore = (await approvalsOf(A, c1)).map(
        (a) => `${a.approver.displayName}:${a.status}:${a.source}`,
      );
      must(
        !edited.memberIds.includes(uid("Tom Iwu")) && /edited/.test(edited.description ?? ""),
        `edited ${q(edited)}`,
      );
      must(
        failText === "The member list could not be saved." &&
          /second edit/.test(partial.description ?? "") &&
          !partial.memberIds.includes(uid("Marcus Oyelaran")),
        `fail ${failText} partial ${q(partial)}`,
      );
      must(/Archive group/.test(confirmText) && !/replac/i.test(confirmText), confirmText);
      must(
        !offered.includes(groupName) && !restored.archivedAt,
        `offered ${offered} restored ${restored.archivedAt}`,
      );
      must(
        JSON.stringify(afterArchive) === JSON.stringify(G.c1Rows) &&
          JSON.stringify(afterRestore) === JSON.stringify(G.c1Rows),
        "requests changed",
      );
      return `Save changed the description and removed Tom Iwu (${edited.memberIds.length} members). With the member-list write answered 503, the editor said ${q(failText)}; the new description had saved and Marcus Oyelaran was not added, so the rename or description alone is not proof. The archive confirmation read ${q(confirmText)}. While archived, C-${c1}'s Apply group offered ${q(offered)}. Show archived then Restore returned it. C-${c1}'s requests stayed ${q(G.c1Rows)} through edit, archive and restore.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "Settings > Contracts > Types > Edit type > Approval defaults",
    "Defaults: open a type, select its Approval defaults tab, choose the Approver group in the Default approver group card; the choice saves on select; new Contracts inherit it and no approval starts; clearing or changing affects future Contracts only; re-typed Contracts keep their default",
    "The card saves the group; a new Contract of the type starts Apply group on it with no requests; after No default group, that Contract still starts on it and a new one does not; a Contract re-typed into the type has no default.",
    async () => {
      await page.goto(`${BASE}/settings/contracts/types`);
      await page.getByRole("button", { name: `Edit ${agType.displayName}` }).click();
      await page
        .getByRole("navigation", { name: "Type sections" })
        .getByRole("link", { name: "Approval defaults" })
        .click();
      const box = page.getByRole("combobox", { name: "Approver group" });
      await box.waitFor();
      const cardText = (await page.locator("main").innerText()).replace(/\s+/g, " ");
      await box.selectOption({ label: groupName });
      await until(
        async () =>
          (await A.api("GET", `/contract-types/${agType.id}/approval-default`)).json?.groupId ===
          G.group.id,
        "default saved",
      );
      const inherit = await quickContract(A, "groups inherits default", {
        contractTypeId: agType.id,
        managerId: uid(A.displayName),
      });
      G.inherit = inherit;
      const startApprovals = (await approvalsOf(A, inherit)).length;
      const startsOn = async (n) => {
        await openContract(A, n, "approvals");
        await card().getByRole("button", { name: "Apply group" }).click();
        const v = await page
          .getByRole("dialog", { name: "Apply approver group" })
          .getByRole("combobox", { name: "Approver group" })
          .locator("option:checked")
          .innerText();
        await page.keyboard.press("Escape");
        return v;
      };
      const s1 = await startsOn(inherit);
      const retyped = await quickContract(A, "groups retyped", { managerId: uid(A.displayName) });
      const rt = await A.api("PATCH", `/contracts/${retyped}`, {
        contractTypeId: agType.id,
        customFields: {},
      });
      const s2 = await startsOn(retyped);
      await page.goto(`${BASE}/settings/contracts/types`);
      await page.getByRole("button", { name: `Edit ${agType.displayName}` }).click();
      await page
        .getByRole("navigation", { name: "Type sections" })
        .getByRole("link", { name: "Approval defaults" })
        .click();
      await box.selectOption({ label: "No default group" });
      await until(
        async () =>
          (await A.api("GET", `/contract-types/${agType.id}/approval-default`)).json?.groupId ===
          null,
        "default cleared",
      );
      const s3 = await startsOn(inherit);
      const fresh = await quickContract(A, "groups after clearing", {
        contractTypeId: agType.id,
        managerId: uid(A.displayName),
      });
      const s4 = await startsOn(fresh);
      // Put the default back for the permission and archive checks.
      await page.goto(`${BASE}/settings/contracts/types`);
      await page.getByRole("button", { name: `Edit ${agType.displayName}` }).click();
      await page
        .getByRole("navigation", { name: "Type sections" })
        .getByRole("link", { name: "Approval defaults" })
        .click();
      await box.selectOption({ label: groupName });
      await until(
        async () =>
          (await A.api("GET", `/contract-types/${agType.id}/approval-default`)).json?.groupId ===
          G.group.id,
        "default saved again",
      );
      must(/Default approver group/.test(cardText), "card title missing");
      must(s1 === groupName && startApprovals === 0, `inherit ${s1} ${startApprovals}`);
      must(rt.status === 200 && s2 === "Pick a group", `retyped ${rt.status} ${s2}`);
      must(s3 === groupName && s4 === "Pick a group", `after clear ${s3} fresh ${s4}`);
      return `Types > Edit ${agType.displayName} > Approval defaults showed the Default approver group card. Choosing ${q(groupName)} saved on select. New C-${inherit} of that type had ${startApprovals} approval requests and its Apply group started on ${q(s1)}. C-${retyped} re-typed into the type (${rt.status}) started on ${q(s2)}. After No default group saved, C-${inherit} still started on ${q(s3)} and new C-${fresh} on ${q(s4)}. The default was then set back to the group.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName, "Nadia Haddad"],
    "/settings/contracts/approver-groups > Approval permissions",
    "Override permissions: the card asks Who can override a default approver group?, starts on Legal team members and administrators, and saves on select; Administrators only restricts applying a different group on a Contract with a default, including for pages opened before the change; Contracts without a default still allow Legal to choose; the setting is put back",
    "Nadia's dialog is locked with the note, her already-open dialog's different group is refused, a Contract without a default still lets her choose; Daniel is not locked; the setting returns to the initial value.",
    async () => {
      const n = S.nadia;
      const nCard = approvalsCard(n.page);
      const nd = n.page.getByRole("dialog", { name: "Apply approver group" });
      // Nadia opens the dialog before the change and picks another group.
      await openContract(n, G.inherit, "approvals");
      await nCard.getByRole("button", { name: "Apply group" }).click();
      await nd
        .getByRole("combobox", { name: "Approver group" })
        .selectOption({ label: FX.group.name });
      await page.goto(`${BASE}/settings/contracts/approver-groups`);
      const policy = page.getByRole("combobox", {
        name: "Who can override a default approver group?",
      });
      await until(
        async () => (await policy.locator("option:checked").innerText()) !== "Loading…",
        "policy loaded",
      );
      const initial = await policy.locator("option:checked").innerText();
      await policy.selectOption({ label: "Administrators only" });
      results.orgSettings.push({
        at: new Date().toISOString(),
        setting: "Who can override a default approver group?",
        value: "Administrators only",
        by: "Daniel Okafor (browser)",
      });
      let stale, locked, lockNote, noDefaultEnabled, adminEnabled, stored;
      try {
        await until(
          async () =>
            (await D.api("GET", "/org/approval-policy")).json?.allowLegalApproverGroupOverride ===
            false,
          "policy saved",
        );
        stored = "false";
        await nd.getByRole("button", { name: "Apply group", exact: true }).click();
        stale = (
          await nd
            .getByRole("alert")
            .first()
            .innerText({ timeout: 8000 })
            .catch(() => "(no alert)")
        ).trim();
        await nd
          .getByRole("button", { name: "Cancel" })
          .click()
          .catch(() => {});
        await n.page.reload();
        await nCard.getByRole("button", { name: "Apply group" }).click();
        locked = !(await nd.getByRole("combobox", { name: "Approver group" }).isEnabled());
        lockNote = (await nd.innerText()).includes(
          "Only an administrator can choose a different group.",
        );
        await nd.getByRole("button", { name: "Cancel" }).click();
        const plain = await quickContract(n, "groups no default", {
          managerId: uid("Nadia Haddad"),
        });
        await openContract(n, plain, "approvals");
        await nCard.getByRole("button", { name: "Apply group" }).click();
        noDefaultEnabled = await nd.getByRole("combobox", { name: "Approver group" }).isEnabled();
        await nd.getByRole("button", { name: "Cancel" }).click();
        await openContract(A, G.inherit, "approvals");
        await card().getByRole("button", { name: "Apply group" }).click();
        adminEnabled = await page
          .getByRole("dialog", { name: "Apply approver group" })
          .getByRole("combobox", { name: "Approver group" })
          .isEnabled();
        await page.keyboard.press("Escape");
      } finally {
        await page.goto(`${BASE}/settings/contracts/approver-groups`);
        await until(
          async () => (await policy.locator("option:checked").innerText()) !== "Loading…",
          "policy loaded again",
        );
        await policy.selectOption({ label: "Legal team members and administrators" });
        await until(
          async () =>
            (await D.api("GET", "/org/approval-policy")).json?.allowLegalApproverGroupOverride ===
            true,
          "policy restored",
        );
        results.orgSettings.push({
          at: new Date().toISOString(),
          setting: "Who can override a default approver group?",
          value: "Legal team members and administrators",
          by: "Daniel Okafor (browser, restored)",
        });
      }
      const nRows = (await approvalsOf(A, G.inherit)).length;
      must(initial === "Legal team members and administrators", `initial ${initial}`);
      must(stale !== "(no alert)" && nRows === 0, `stale ${stale} rows ${nRows}`);
      must(
        locked && lockNote && noDefaultEnabled && adminEnabled,
        `locked ${locked} note ${lockNote} noDefault ${noDefaultEnabled} admin ${adminEnabled}`,
      );
      return `The Approval permissions card asked "Who can override a default approver group?" and started on ${q(initial)}. Administrators only saved on select (stored ${stored}). Nadia Haddad's dialog, opened before the change with ${q(FX.group.name)} chosen, was refused on Apply group: ${q(stale)}; C-${G.inherit} has ${nRows} requests. Reopened, her select was disabled and the dialog said "Only an administrator can choose a different group." On a Contract without a default her select was enabled. Daniel Okafor's select stayed enabled. The setting was put back to Legal team members and administrators.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "Types > Approval defaults and /contracts/:number/approvals with an archived default",
    "If a type's default group is archived, the type card shows it with (archived); on a Contract that inherited it, Apply group shows Default group unavailable — contact an administrator; anyone who may override can choose another group",
    "The card shows (archived); the dialog starts on the unavailable option; Daniel can choose another group; the group is restored afterwards.",
    async () => {
      const arch = await A.api("POST", `/approver-groups/${G.group.id}/archive`, {});
      let cardValue, start, enabled;
      try {
        await page.goto(`${BASE}/settings/contracts/types`);
        await page.getByRole("button", { name: `Edit ${agType.displayName}` }).click();
        await page
          .getByRole("navigation", { name: "Type sections" })
          .getByRole("link", { name: "Approval defaults" })
          .click();
        const box = page.getByRole("combobox", { name: "Approver group" });
        await box.waitFor();
        await sleep(800);
        cardValue = await box.locator("option:checked").innerText();
        await openContract(A, G.inherit, "approvals");
        await card().getByRole("button", { name: "Apply group" }).click();
        const sel = page
          .getByRole("dialog", { name: "Apply approver group" })
          .getByRole("combobox", { name: "Approver group" });
        start = await sel.locator("option:checked").innerText();
        enabled = await sel.isEnabled();
        await page.keyboard.press("Escape");
      } finally {
        await A.api("POST", `/approver-groups/${G.group.id}/restore`, {});
      }
      must(arch.status < 300 && cardValue === `${groupName} (archived)`, `card ${cardValue}`);
      must(
        start === "Default group unavailable — contact an administrator" && enabled,
        `start ${start} enabled ${enabled}`,
      );
      return `With the group archived (${arch.status}), the type's Default approver group card showed ${q(cardValue)}. C-${G.inherit}'s Apply group started on ${q(start)} and the select was enabled for the Administrator. The group was restored.`;
    },
  );
}
SECTIONS["approver-groups"] = approverGroups;
SECTIONS["approver-groups"] = approverGroups;

// =====================================================================
// V-C15 contract-stages (pattern: DOC-029 contracts-a/walkthrough-r1.mjs contractStages)
// =====================================================================
async function stageMenu(s) {
  await s.page.getByRole("button", { name: /— move contract$/ }).click();
  const menu = s.page.getByRole("menu");
  await menu.waitFor();
  const items = (await menu.getByRole("menuitemradio").allInnerTexts()).map((t) =>
    t.replace(/\s+/g, " ").trim(),
  );
  await s.page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  return items;
}
async function headerText(page) {
  return (await page.locator("main header, header").first().innerText()).replace(/\s+/g, " ");
}
async function contractStages(role, A, O) {
  const art = "contract-stages";
  const sc = "V-C15";
  const page = A.page;
  const number = await quickContract(A, `${sc} ${role}`, { managerId: uid(A.displayName) });
  const title = `${P} ${sc} ${role} ${stamp}`;
  await A.api("POST", `/contracts/${number}/team`, { userId: uid("Lena Vogel") });
  await uploadPrimary(A, number, `doc032-contracts-2-${role}-stages.pdf`);
  const stageBtn = (stage) => page.getByRole("button", { name: `${stage} — move contract` });

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "/contracts/:number header Stage display",
    "Change the Status, steps 1-2 and 4: select the current Stage in the header's Stage display, choose Internal review, Awaiting approval, Out for signature and Active in turn, read the Stage beside each Status, then check the Status beside the C- reference, the Stage display and History",
    "The menu lists each Status with its Stage; each move shows the new Status beside C- and the Stage display; History records each change; the six Stages are Draft, Review, Approval, Signature, Active, Ended.",
    async () => {
      await openContract(A, number);
      const start = await stageBtn("Draft").count();
      const menuItems = await stageMenu(A);
      const seen = [];
      for (const [name, stage] of [
        ["Internal review", "Review"],
        ["Awaiting approval", "Approval"],
        ["Out for signature", "Signature"],
        ["Active", "Active"],
      ]) {
        await stageMove(A, number, name);
        await until(async () => (await stageBtn(stage).count()) === 1, `stage button ${stage}`);
        const head = (
          await page.getByRole("region", { name: new RegExp(`${P} ${sc} ${role}`) }).innerText()
        ).replace(/\s+/g, " ");
        must(head.includes(`C-${number}`) && head.includes(name), head);
        seen.push(
          `${name} -> ${stage} (header ${q(head.match(new RegExp(`C-${number}[^]{0,60}`))?.[0])})`,
        );
      }
      const hist = await history(page);
      const stagesInMenu = ["Draft", "Review", "Approval", "Signature", "Active", "Ended"].filter(
        (s) => menuItems.some((i) => i.includes(s)),
      );
      must(start === 1, "Draft Stage display missing at start");
      must(stagesInMenu.length === 6, `stages in menu ${stagesInMenu}`);
      must(
        /Internal review/.test(hist) &&
          /Awaiting approval/.test(hist) &&
          /Out for signature/.test(hist) &&
          /Active/.test(hist),
        hist.slice(0, 400),
      );
      return `C-${number} started at "Draft — move contract". The menu listed ${menuItems.length} Statuses with their Stages: ${q(menuItems)}. Moves: ${seen.join("; ")}. History read ${q(hist.slice(0, 420))}.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "/contracts/:number Documents after a manual move to Active",
    "Check what the change means: manually moving to Active does not upload an executed copy or mark a Document Version as executed; Moving to Signature does not send paper",
    "The primary Document still has one Version, not executed; no Envelope exists.",
    async () => {
      const docs = (await A.api("GET", `/contracts/${number}/documents`)).json.documents;
      const versions = docs.flatMap((d) => d.versions ?? []);
      const executed = versions.filter((v) => v.isExecuted).length;
      const env = (await A.api("GET", `/contracts/${number}/envelopes`)).json;
      const envelopes = (env?.envelopes ?? []).length;
      await section(A, "Documents");
      await page.waitForURL((u) => u.pathname.endsWith("/documents"));
      await sleep(800);
      must(
        docs.length === 1 && versions.length === 1 && executed === 0 && envelopes === 0,
        `docs ${docs.length} versions ${versions.length} executed ${executed} envelopes ${envelopes}`,
      );
      return `After the moves through Out for signature to Active, C-${number} holds ${docs.length} Document with ${versions.length} Version, ${executed} marked executed; ${envelopes} Envelopes exist, so the Signature move sent nothing.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "/contracts/:number Stage display",
    "A Status maps to one Stage; you may move backwards or skip Stages",
    "Active -> Internal review and Internal review -> Active (skipping Approval and Signature) are both accepted.",
    async () => {
      await stageMove(A, number, "Internal review");
      await until(async () => (await stageBtn("Review").count()) === 1, "Review");
      await stageMove(A, number, "Active");
      await until(async () => (await stageBtn("Active").count()) === 1, "Active");
      const c = (await getContract(A, number)).contract;
      return `Active -> Internal review accepted ("Review — move contract"), then Internal review -> Active accepted without Approval or Signature ("Active — move contract"); the Contract reads ${c.statusName} (${c.stage}).`;
    },
  );

  await step(
    art,
    sc,
    role,
    ["Daniel Okafor (rename, second actor)", A.displayName],
    "/contracts/:number Stage display after a Status rename",
    "Negative: renaming a Status does not change that mapping",
    "After the Administrator renames the fixture Review Status, the menu shows the new name with Stage Review and the Contract in it keeps Stage review; a rename that carries a Stage is refused.",
    async () => {
      await stageMove(A, number, FX.status.displayName);
      const renameTo = `${P} ${sc} renamed by ${role} ${stamp}`;
      const r = await D.api("PATCH", `/contract-statuses/${FX.status.id}`, {
        displayName: renameTo,
      });
      must(r.status === 200, `rename ${r.status} ${q(r.json)}`);
      const refused = await D.api("PATCH", `/contract-statuses/${FX.status.id}`, {
        displayName: renameTo,
        stage: "active",
      });
      FX.status.displayName = renameTo;
      await page.reload();
      await page.getByRole("heading", { level: 1 }).waitFor();
      const c = (await getContract(A, number)).contract;
      const items = await stageMenu(A);
      const item = items.find((i) => i.includes(renameTo));
      const disp = await stageBtn("Review").count();
      must(
        c.statusName === renameTo &&
          c.stage === "review" &&
          /Review/.test(item ?? "") &&
          disp === 1,
        `${c.statusName} ${c.stage} ${item} ${disp}`,
      );
      must(
        refused.status >= 400 ||
          (await D.api("GET", "/contract-statuses")).json.contractStatuses.find(
            (s) => s.id === FX.status.id,
          ).stage === "review",
        `stage change ${refused.status}`,
      );
      return `Moved to the fixture Status; Daniel Okafor renamed it to ${q(renameTo)} (a rename that also sent stage "active" answered ${refused.status} ${q(refused.json?.detail ?? "")}). The Contract reads ${q(c.statusName)} / ${c.stage}; the Stage display reads "Review — move contract"; the menu item reads ${q(item)}.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName, O.displayName],
    "/contracts/:number Stage display > Move past approval",
    "Change the Status, step 3 and Check what the change means: with a Pending and a Rejected approval, a move beyond Approval opens Move past approval listing them; Cancel keeps the Status; Move anyway makes the stated override, History records it, and the approvals are not answered",
    "Cancel keeps Awaiting approval; Move anyway saves Out for signature; History has the override; approvals stay Pending and Rejected.",
    async () => {
      await stageMove(A, number, "Awaiting approval");
      const req = await A.api("POST", `/contracts/${number}/approvals`, {
        approverIds: [uid(O.displayName), uid("Priya Raman")],
      });
      must(req.status === 201, `approval setup ${req.status} ${q(req.json)}`);
      const pr = (await approvalsOf(A, number)).find(
        (a) => a.approver.displayName === "Priya Raman",
      );
      const rej = await S.priya.api("POST", `/approvals/${pr.id}/decision`, {
        decision: "rejected",
        note: `${P} rejected before the move.`,
      });
      must(rej.status < 300, `reject ${rej.status} ${q(rej.json)}`);
      await openContract(A, number);
      let dialog = await stageMove(A, number, "Out for signature", { expectGate: true });
      const text = (await dialog.innerText()).replace(/\s+/g, " ");
      const buttons = (await dialog.getByRole("button").allInnerTexts()).map((b) => b.trim());
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden" });
      await sleep(800);
      const kept = (await getContract(A, number)).contract.statusName;
      must(kept === "Awaiting approval", `after Cancel ${kept}`);
      dialog = await stageMove(A, number, "Out for signature", { expectGate: true });
      await dialog.getByRole("button", { name: "Move anyway" }).click();
      await until(
        async () => (await getContract(A, number)).contract.statusName === "Out for signature",
        "moved anyway",
      );
      await page
        .getByRole("dialog", { name: "Move past approval" })
        .waitFor({ state: "hidden" })
        .catch(() => {});
      const hist = await history(page).catch(async (e) => {
        await page.screenshot({ path: `/tmp/c2-history-${role}.png` });
        throw e;
      });
      const states = (await approvalsOf(A, number)).map(
        (a) => `${a.approver.displayName}:${a.status}`,
      );
      must(/Pending|pending/.test(text) && /Rejected|rejected/.test(text), `dialog ${text}`);
      must(/overrid|past approval/i.test(hist), `history ${hist.slice(0, 300)}`);
      must(
        states.includes(`${O.displayName}:pending`) && states.includes("Priya Raman:rejected"),
        `states ${states}`,
      );
      return `Move past approval read ${q(text.slice(0, 300))} with buttons ${q(buttons)}. Cancel kept ${q(kept)}. Move anyway saved Out for signature; History: ${q(hist.match(/[^.]{0,80}(?:overrid|past approval)[^.]{0,120}/i)?.[0])}. Approvals afterwards: ${q(states)} (not answered by the move).`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "/contracts/:number (Ended Status)",
    "Ended Contracts stay editable",
    "After a move to Expired (Ended) the record still accepts an edit.",
    async () => {
      await openContract(A, number);
      await stageMove(A, number, "Expired");
      await until(async () => (await stageBtn("Ended").count()) === 1, "Ended");
      await page
        .getByRole("main")
        .getByRole("combobox", { name: "Priority" })
        .selectOption({ label: "Critical" });
      await until(
        async () => (await getContract(A, number)).contract.priority === "critical",
        "ended edit",
      );
      return `Moved to Expired ("Ended — move contract"); Priority Critical saved on the Ended Contract.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName, "Lena Vogel (Portal)"],
    "/contracts/:number (archived) and /portal/contracts/:number",
    "If the Status does not change: Business Users and readers of archived Contracts do not get the editing control; Restore an archived Contract before the change",
    "Lena (team member) sees no Status control in the Portal and a direct write is refused; the archived record shows no Stage move control and a direct write is refused; after Restore the Stage control works.",
    async () => {
      const lp = S.lena.page;
      await lp.goto(`${BASE}/portal/contracts/${number}`);
      await sleep(2500);
      const lenaHeading = await lp
        .getByRole("heading", { level: 1 })
        .first()
        .innerText()
        .catch(() => "(no heading)");
      const lenaControls = await lp.getByRole("button", { name: /move contract/ }).count();
      const statuses = (await D.api("GET", "/contract-statuses")).json.contractStatuses;
      const activeId = statuses.find((s) => s.displayName === "Active").id;
      const lenaPatch = await S.lena.api("PATCH", `/contracts/${number}`, { statusId: activeId });
      const arch = await A.api("POST", `/contracts/${number}/archive`, {});
      must(arch.status < 300, `archive ${arch.status}`);
      await page.reload();
      await page.getByRole("heading", { level: 1 }).waitFor();
      await sleep(800);
      const archivedControls = await page.getByRole("button", { name: /— move contract$/ }).count();
      const patch = await A.api("PATCH", `/contracts/${number}`, { statusId: activeId });
      const rest = await A.api("POST", `/contracts/${number}/restore`, {});
      await page.reload();
      await page.getByRole("heading", { level: 1 }).waitFor();
      await stageMove(A, number, "Active");
      const c = (await getContract(A, number)).contract;
      must(
        lenaControls === 0 &&
          lenaPatch.status >= 400 &&
          archivedControls === 0 &&
          patch.status >= 400 &&
          c.statusName === "Active",
        `lena ${lenaControls}/${lenaPatch.status} archived ${archivedControls}/${patch.status} now ${c.statusName}`,
      );
      return `Lena Vogel (team member) opened the Portal record ${q(lenaHeading)} with ${lenaControls} Status controls; her direct Status write answered ${lenaPatch.status}. Archived C-${number} showed ${archivedControls} Stage move controls; a direct write answered ${patch.status} (${q(patch.json?.detail)}). After Restore (${rest.status}) the Stage control moved it to Active.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName],
    "/contracts/:number/signatures (work lab, no Signing connector)",
    "Check what the change means, second paragraph (context only on this lab): the Contract's Signatures tab exists; the confirmed-send move is checked on the owned stand-in lab (walkthrough-signing.json)",
    "A Signatures tab after Approvals; with no Signing connector it offers no send.",
    async () => {
      await openContract(A, number);
      const tabs = (
        await page
          .getByRole("navigation", { name: "Contract sections" })
          .getByRole("link")
          .allInnerTexts()
      ).map((t) => t.replace(/\s+/g, " ").trim());
      await section(A, "Signatures");
      await page.waitForURL((u) => u.pathname === `/contracts/${number}/signatures`);
      await sleep(1000);
      const text = (await page.getByRole("main").innerText()).replace(/\s+/g, " ");
      const send = await page.getByRole("button", { name: "Send for signature" }).count();
      const ai = tabs.findIndex((t) => t.startsWith("Approvals"));
      const si = tabs.findIndex((t) => t.startsWith("Signatures"));
      must(si > ai && ai >= 0, `tabs ${tabs}`);
      return `Contract sections: ${q(tabs)}. The Signatures tab (/contracts/${number}/signatures) read ${q(text.match(/Signatures[^]{0,260}/)?.[0])}; Send for signature buttons: ${send}. The confirmed-send paragraph is walked on the owned lab c2sign (walkthrough-signing.json).`;
    },
  );
}
SECTIONS["contract-stages"] = async () => {
  for (const role of ROLES) {
    const A = role === "administrator" ? S.daniel : S.nadia;
    const O = role === "administrator" ? S.nadia : S.daniel;
    await contractStages(role, A, O);
  }
};

// =====================================================================
// Signing checks on the owned lab c2sign with the e2e signing stand-in (SIGNING=1 LAB=c2sign).
// contract-stages (V-C15): "A confirmed send from the Contract's Signatures tab moves the
// Contract to a Signature Status ... records no override".
// troubleshooting (V-C49): "Electronic signing is unavailable or the executed copy is missing".
// The stand-in is not a provider: nothing here is live-provider evidence (#1178).
// Fault injection on this owned lab only: the stand-in's control port answers envelope
// creation with 500 or an envelope's executed download with 503/400, and one SQL update sets
// recovery_stopped (the 32-attempt limit cannot be reached in a walkthrough).
// =====================================================================
const CTRL = process.env.STANDIN_CONTROL ?? "http://127.0.0.1:48466";
async function ctrl(p, method = "POST") {
  const r = await fetch(`${CTRL}${p}`, { method });
  return r.json();
}
function labSql(statement) {
  return execFileSync(
    "docker",
    [
      "exec",
      `${lab.project}-postgres-1`,
      "psql",
      "-U",
      "openlaw",
      "-d",
      "openlaw",
      "-Atc",
      statement,
    ],
    { encoding: "utf8" },
  ).trim();
}
const envelopesOf = async (s, n) =>
  (await s.api("GET", `/contracts/${n}/envelopes`)).json?.envelopes ?? [];
const tabText = async (page) => (await page.getByRole("main").innerText()).replace(/\s+/g, " ");
async function openSignatures(s, n) {
  await openContract(s, n);
  await section(s, "Signatures");
  await s.page.waitForURL((u) => u.pathname === `/contracts/${n}/signatures`);
  await settled(
    s.page,
    s.page.getByRole("heading", { name: "Signatures", level: 2 }),
    "Signatures heading",
  );
  await sleep(600);
}
/** Signatures tab > Send for signature, one Signer, the round question, Send envelope. */
async function sendFromTab(s, n, { completes = true, signer = "Mara Quint" } = {}) {
  const page = s.page;
  await openSignatures(s, n);
  const before = new Set((await ctrl("/list", "GET")).envelopes.map((e) => e.id));
  await page.getByRole("button", { name: "Send for signature" }).first().click();
  const d = page.getByRole("dialog", { name: "Send for signature" });
  await d.waitFor();
  const version = await d
    .getByLabel("Version")
    .locator("option:checked")
    .innerText()
    .catch(() => "(no Version select)");
  await d.getByLabel("Signer 1 name").fill(signer);
  await d
    .getByLabel("Signer 1 email")
    .fill(`${signer.split(" ")[0].toLowerCase()}@northwind.example`);
  const question = d.getByRole("group", {
    name: "Will the agreement be fully signed when this DocuSign round is complete?",
  });
  const answer = completes
    ? /^Yes, all required signatures will be in place/
    : /^No, more signatures will still be needed/;
  await question.getByRole("radio", { name: answer }).check();
  let gateSeen = false;
  const gateWatch = page
    .getByRole("dialog", { name: "Move past approval" })
    .waitFor({ timeout: 12000 })
    .then(() => (gateSeen = true))
    .catch(() => {});
  await d.getByRole("button", { name: "Send envelope" }).click();
  const closed = await d
    .waitFor({ state: "hidden", timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  const dialogText = closed ? null : (await d.innerText()).replace(/\s+/g, " ");
  await gateWatch;
  const after = (await ctrl("/list", "GET")).envelopes.map((e) => e.id);
  const providerId = after.find((id) => !before.has(id)) ?? null;
  return { version, closed, dialogText, gateSeen, providerId, dialog: d };
}
/** The stand-in marks the envelope signed and hands back a signed Connect delivery; post it. */
async function deliverCompleted(providerId) {
  const delivery = await ctrl(`/complete?id=${encodeURIComponent(providerId)}`);
  const r = await fetch(`${BASE}/api/v1/signing/docusign/webhook`, {
    method: "POST",
    headers: delivery.headers,
    body: delivery.body,
  });
  return r.status;
}
async function primaryVersionId(s, n) {
  const docs = (await s.api("GET", `/contracts/${n}/documents`)).json?.documents ?? [];
  return docs[0]?.versions?.[0]?.id;
}
async function signingPrimary(s, label) {
  const number = await quickContract(s, label, { managerId: uid(s.displayName) });
  await uploadPrimary(s, number, `doc032-contracts-2-${label.replace(/\s+/g, "-")}.pdf`);
  return number;
}

async function signingSection() {
  must(LAB_NAME !== "work", "SIGNING runs only on an owned lab, never on the shared work lab");
  // Fixture: the Administrator saves and enables a Webhook connector that points at the
  // stand-in. The RSA key is generated in memory and never written.
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const put = await D.api("PUT", "/signing-connectors/docusign", {
    updateMode: "webhook",
    environment: "demo",
    integrationKey: "doc032-contracts-2-standin-integration-key",
    apiUserId: "99999999-8888-7777-6666-555555555555",
    privateKey,
    webhookSecret: "doc032-contracts-2-standin-connect-secret",
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
    "DocuSign (Demo, Webhook) pointing at the e2e signing stand-in on the owned lab",
    `saved ${put.status}; enabled ${conn.enabled}; test ${test.status} ${q(test.json?.accountName ?? test.json?.detail ?? test.json)}`,
  );
  must(conn.enabled && test.status < 300, `connector not usable: test ${test.status}`);

  for (const role of ROLES) {
    const A = role === "administrator" ? S.daniel : S.nadia;
    const O = role === "administrator" ? S.nadia : S.daniel;
    const page = A.page;
    let n1;

    await step(
      "contract-stages",
      "V-C15",
      role,
      [A.displayName, O.displayName, "Priya Raman"],
      "/contracts/:number/signatures Send for signature",
      "Check what the change means, second paragraph: at an Approval Status with one Pending and one Rejected approval, a confirmed send from the Signatures tab moves the Contract to a Signature Status, does not open Move past approval, and records no override; only the Stage control shows the warning",
      "No Move past approval dialog; an Out for signature row; the Contract is at a Signature Status; approvals stay Pending and Rejected; History has a status change and no override entry.",
      async () => {
        n1 = await signingPrimary(A, `V-C15 ${role} send`);
        await openContract(A, n1);
        await stageMove(A, n1, "Awaiting approval");
        const req = await A.api("POST", `/contracts/${n1}/approvals`, {
          approverIds: [uid(O.displayName), uid("Priya Raman")],
        });
        must(req.status === 201, `approvals ${req.status} ${q(req.json)}`);
        const pr = (await approvalsOf(A, n1)).find((a) => a.approver.displayName === "Priya Raman");
        const rej = await S.priya.api("POST", `/approvals/${pr.id}/decision`, {
          decision: "rejected",
          note: `${P} rejected before the send.`,
        });
        must(rej.status < 300, `reject ${rej.status}`);
        const before = (await getContract(A, n1)).contract;
        const sent = await sendFromTab(A, n1);
        must(sent.closed, `send dialog stayed open: ${sent.dialogText}`);
        const row = await until(
          async () => ((t) => (/Out for signature/.test(t) ? t : null))(await tabText(page)),
          "Out for signature row",
          30000,
        );
        const after = await until(async () => {
          const c = (await getContract(A, n1)).contract;
          return c.stage === "signature" ? c : null;
        }, "Signature Stage");
        const states = (await approvalsOf(A, n1)).map(
          (a) => `${a.approver.displayName}:${a.status}`,
        );
        const hist = await history(page);
        const override = /past approval|overrid/i.test(hist);
        const statusLine = hist.match(
          /[^.]{0,60}Awaiting approval → Out for signature[^.]{0,20}/,
        )?.[0];
        if (role === "legal_team_member")
          await page.screenshot({ path: path.join(here, "c15-send-without-gate.png") });
        must(before.statusName === "Awaiting approval", `before ${before.statusName}`);
        must(!sent.gateSeen, "Move past approval opened on send");
        must(
          states.includes(`${O.displayName}:pending`) && states.includes("Priya Raman:rejected"),
          `states ${states}`,
        );
        must(!override && statusLine, `history ${hist.slice(0, 300)}`);
        return `C-${n1} stood at ${q(before.statusName)} (${before.stage}) with ${q(states)}. Signatures > Send for signature: Version ${q(sent.version)}, one Signer, "Yes, all required signatures will be in place", Send envelope closed the dialog; Move past approval did not open within 12 s. The tab showed ${q(row.match(/[^.]{0,40}Out for signature[^.]{0,60}/)?.[0])}. The Contract is now ${q(after.statusName)} (${after.stage}); approvals still ${q(states)}. History: ${q(statusLine)}, and no override entry.`;
      },
    );

    await step(
      "troubleshooting",
      "V-C49",
      role,
      [A.displayName, "signing stand-in (signer)"],
      "/contracts/:number/signatures Executed copy",
      "Electronic signing, third paragraph: a Signed Envelope can show Filing the signed copy… while OpenLaw stores the returned file; wait for Executed copy, then check the Document Version",
      "After the stand-in signs, the row reads Signed and then offers Executed copy; the Documents tab holds the executed Version.",
      async () => {
        must(n1, "no sent Contract from the previous step");
        const env = (await envelopesOf(A, n1))[0];
        const providerId = (await ctrl("/list", "GET")).envelopes.at(-1).id;
        const hook = await deliverCompleted(providerId);
        await openSignatures(A, n1);
        const seen = [];
        const done = await until(
          async () => {
            const t = await tabText(page);
            if (/Filing the signed copy…/.test(t) && !seen.includes("Filing")) seen.push("Filing");
            if (/Executed copy/.test(t)) return t;
            await page.reload();
            await settled(
              page,
              page.getByRole("heading", { name: "Signatures", level: 2 }),
              "Signatures heading",
            );
            return null;
          },
          "Executed copy",
          90000,
        );
        const link = page.getByRole("link", { name: "Executed copy" });
        const linkCount = await link.count();
        const docs = (await A.api("GET", `/contracts/${n1}/documents`)).json.documents;
        const executed = docs.flatMap((d) => (d.versions ?? []).filter((v) => v.isExecuted));
        const c = (await getContract(A, n1)).contract;
        await section(A, "Documents");
        await page.waitForURL((u) => u.pathname.endsWith("/documents"));
        await sleep(800);
        const docText = await tabText(page);
        must(hook === 200 || hook === 202 || hook === 204, `webhook ${hook}`);
        must(
          /Signed/.test(done) && linkCount === 1 && executed.length === 1,
          `link ${linkCount} executed ${executed.length}`,
        );
        return `Envelope ${env?.status} for C-${n1}; the stand-in signed it and its Connect delivery answered ${hook}. The Signatures tab then read ${q(done.match(/[^.]{0,40}Signed[^.]{0,80}/)?.[0])}${seen.length ? " after showing Filing the signed copy…" : " (Filing the signed copy… was not caught between reloads)"}; it offers ${linkCount} "Executed copy" link. Documents: ${executed.length} executed Version (${q(executed.map((v) => v.originalFilename ?? v.id))}); Documents tab row ${q(docText.match(/[^.]{0,60}executed[^.]{0,60}/i)?.[0])}. The Contract is now ${q(c.statusName)} (${c.stage}).`;
      },
    );

    await step(
      "troubleshooting",
      "V-C49",
      role,
      [A.displayName, "signing stand-in (signer; executed download answered 503)"],
      "/contracts/:number/signatures Filing the signed copy… then failure",
      "Electronic signing, third paragraph: while the returned file is not yet stored the row shows Filing the signed copy…; when filing fails it shows The signed copy could not be filed. Upload it to the record instead.; manual hand-off remains available",
      "Filing the signed copy… under Signed, then the failure text; no Executed copy; the Contract stays in the Signature Stage; the Documents tab still offers manual upload and Mark as executed copy.",
      async () => {
        const n = await signingPrimary(A, `V-C49 ${role} filing`);
        const sent = await sendFromTab(A, n);
        must(sent.closed && sent.providerId, `send ${sent.dialogText}`);
        await ctrl(`/fault?combined=503&id=${encodeURIComponent(sent.providerId)}`);
        const hook = await deliverCompleted(sent.providerId);
        await openSignatures(A, n);
        const filing = await until(
          async () => ((t) => (/Filing the signed copy…/.test(t) ? t : null))(await tabText(page)),
          "Filing the signed copy…",
          20000,
        );
        const t0 = Date.now();
        const failed = await until(
          async () => {
            await page.reload();
            await settled(
              page,
              page.getByRole("heading", { name: "Signatures", level: 2 }),
              "Signatures heading",
            );
            await sleep(500);
            const t = await tabText(page);
            return /The signed copy could not be filed\. Upload it to the record instead\./.test(t)
              ? t
              : null;
          },
          "filing failure text",
          240000,
        );
        const waited = Math.round((Date.now() - t0) / 1000);
        await ctrl(`/fault?combined=off&id=${encodeURIComponent(sent.providerId)}`);
        const execLinks = await page.getByRole("link", { name: "Executed copy" }).count();
        const c = (await getContract(A, n)).contract;
        await section(A, "Documents");
        await page.waitForURL((u) => u.pathname.endsWith("/documents"));
        await sleep(800);
        const title = (await A.api("GET", `/contracts/${n}/documents`)).json.documents[0].title;
        await page.getByRole("button", { name: `Actions for ${title}`, exact: true }).click();
        const items = (await page.getByRole("menu").getByRole("menuitem").allInnerTexts()).map(
          (x) => x.trim(),
        );
        await page.keyboard.press("Escape");
        must(execLinks === 0 && c.stage === "signature", `links ${execLinks} stage ${c.stage}`);
        must(
          items.some((i) => /executed/i.test(i)),
          `document actions ${items}`,
        );
        return `C-${n}: sent (Out for signature), stand-in signed it with its executed download answering 503; delivery ${hook}. The row read ${q(filing.match(/[^.]{0,40}Filing the signed copy…/)?.[0])}. After the fetch retries ran out (${waited} s) it read ${q(failed.match(/Signed[^]{0,40}The signed copy could not be filed\. Upload it to the record instead\./)?.[0] ?? "The signed copy could not be filed. Upload it to the record instead.")}; ${execLinks} Executed copy links. The Contract stays ${q(c.statusName)} (${c.stage}). Manual hand-off: the primary Document's actions offer ${q(items)}.`;
      },
    );

    await step(
      "troubleshooting",
      "V-C49",
      role,
      [A.displayName, "signing stand-in (signer)"],
      "/contracts/:number/signatures Partially signed copy",
      "Electronic signing, third paragraph: a round that does not complete the Contract shows Partially signed copy; that file is not marked as executed and the Contract stays in the Signature Stage",
      "Row offers Partially signed copy, not Executed copy; no executed Version; the Contract is at a Signature Status (Partially signed).",
      async () => {
        const n = await signingPrimary(A, `V-C49 ${role} partial`);
        const sent = await sendFromTab(A, n, { completes: false });
        must(sent.closed && sent.providerId, `send ${sent.dialogText}`);
        const hook = await deliverCompleted(sent.providerId);
        await openSignatures(A, n);
        const t = await until(
          async () => {
            const x = await tabText(page);
            if (/Partially signed copy/.test(x)) return x;
            await page.reload();
            await settled(
              page,
              page.getByRole("heading", { name: "Signatures", level: 2 }),
              "Signatures heading",
            );
            return null;
          },
          "Partially signed copy",
          90000,
        );
        const partial = await page.getByRole("link", { name: "Partially signed copy" }).count();
        const execLinks = await page.getByRole("link", { name: "Executed copy" }).count();
        const docs = (await A.api("GET", `/contracts/${n}/documents`)).json.documents;
        const versions = docs.flatMap((d) => d.versions ?? []);
        const executed = versions.filter((v) => v.isExecuted).length;
        const c = (await getContract(A, n)).contract;
        must(
          partial === 1 && execLinks === 0 && executed === 0 && c.stage === "signature",
          `partial ${partial} exec ${execLinks} executed ${executed} stage ${c.stage}`,
        );
        return `C-${n}: sent with "No, more signatures will still be needed"; the stand-in signed it (delivery ${hook}). The row read ${q(t.match(/[^.]{0,40}Partially signed copy/)?.[0])}: ${partial} "Partially signed copy" link and ${execLinks} "Executed copy". The chain holds ${versions.length} Versions, ${executed} marked executed. The Contract is ${q(c.statusName)} (${c.stage}).`;
      },
    );

    await step(
      "troubleshooting",
      "V-C49",
      role,
      [
        A.displayName,
        "signing stand-in (creation answered 500)",
        "lab database (recovery_stopped set)",
      ],
      "/contracts/:number/signatures Creation uncertain, Refresh status, Automatic recovery has stopped",
      "Electronic signing, second paragraph: an Envelope marked Creation uncertain — not confirmed sent still holds the reservation; do not try another send; wait for recovery and select Refresh status; if the tab says Automatic recovery has stopped, ask the Administrator",
      "The row shows Creation uncertain — not confirmed sent with Refresh status; no Send for signature is offered and a second send is refused; after recovery stops the tab says Automatic recovery has stopped. Ask your Administrator to resolve this Envelope.",
      async () => {
        const n = await signingPrimary(A, `V-C49 ${role} uncertain`);
        await ctrl("/fault?create=500");
        let sent;
        try {
          sent = await sendFromTab(A, n);
        } finally {
          await ctrl("/fault?create=off");
        }
        const sendMsg = sent.dialogText;
        if (!sent.closed)
          await sent.dialog
            .getByRole("button", { name: /Cancel|Close/ })
            .first()
            .click()
            .catch(() => {});
        await openSignatures(A, n);
        const t1 = await tabText(page);
        const sendButtons = await page.getByRole("button", { name: "Send for signature" }).count();
        const again = await A.api("POST", `/contracts/${n}/envelopes`, {
          documentVersionId: await primaryVersionId(A, n),
          signers: [{ name: "Mara Quint", email: "mara@northwind.example" }],
          completesContract: true,
        });
        await page.getByRole("button", { name: "Refresh status" }).click();
        await sleep(1500);
        const t2 = await tabText(page);
        const env = (await envelopesOf(A, n))[0];
        const upd = labSql(
          `update contract_envelopes set recovery_stopped = 'attempts_exhausted' where id = '${env.id}' and status = 'preparing' returning id`,
        );
        fixture(
          "Fault injection",
          `C-${n} Envelope ${env.id}`,
          `recovery_stopped set to attempts_exhausted in the owned lab database (${upd ? "1 row" : "0 rows"})`,
        );
        await page.getByRole("button", { name: "Refresh status" }).click();
        const t3 = await until(
          async () =>
            ((x) => (/Automatic recovery has stopped/.test(x) ? x : null))(await tabText(page)),
          "Automatic recovery has stopped",
          15000,
        );
        const envCount = (await envelopesOf(A, n)).length;
        const stand = (await ctrl("/list", "GET")).envelopes.length;
        if (role === "legal_team_member")
          await page.screenshot({ path: path.join(here, "c49-recovery-stopped.png") });
        must(
          /Creation uncertain — not confirmed sent/.test(t1) &&
            /Creation uncertain — not confirmed sent/.test(t2),
          `uncertain ${t1.slice(0, 200)}`,
        );
        must(
          sendButtons === 0 && again.status === 409,
          `send buttons ${sendButtons} again ${again.status}`,
        );
        must(
          /Automatic recovery has stopped\. Ask your Administrator to resolve this Envelope\. It stays reserved until its outcome is confirmed\./.test(
            t3,
          ),
          t3.slice(0, 300),
        );
        return `C-${n}: with the stand-in answering envelope creation with 500, Send envelope ${sent.closed ? "closed the dialog" : `kept the dialog open with ${q(sendMsg?.match(/[^.]*(?:reserved|not confirmed|could not|try)[^.]*\./i)?.[0] ?? sendMsg?.slice(-200))}`}. The Signatures tab read ${q(t1.match(/Creation uncertain — not confirmed sent[^]{0,260}/)?.[0])}; ${sendButtons} Send for signature buttons; a second send through the API answered ${again.status} (${q(again.json?.detail)}). Refresh status kept ${q(t2.match(/Creation uncertain — not confirmed sent/)?.[0])}. After recovery_stopped was set, Refresh status showed ${q(t3.match(/Automatic recovery has stopped[^.]*\.[^.]*\.[^.]*\./)?.[0])}. The Contract has ${envCount} Envelope; the stand-in holds ${stand} envelopes in total (none created for this round).`;
      },
    );

    if (role === "administrator")
      await step(
        "contract-stages",
        "V-C15",
        role,
        [A.displayName],
        "/contracts/:number/signatures Send for signature from Active",
        "Author limitation check: a direct send moves the Contract to Signature from any Stage, including Active",
        "A Contract at Active moves to a Signature Status after the send.",
        async () => {
          const n = await signingPrimary(A, `V-C15 ${role} send from active`);
          await openContract(A, n);
          await stageMove(A, n, "Active");
          const sent = await sendFromTab(A, n);
          must(sent.closed, `send ${sent.dialogText}`);
          const c = await until(async () => {
            const x = (await getContract(A, n)).contract;
            return x.stage === "signature" ? x : null;
          }, "Signature after send from Active");
          return `C-${n} at Active; after a confirmed send it reads ${q(c.statusName)} (${c.stage}); Move past approval opened: ${sent.gateSeen}.`;
        },
      );
  }

  // Business User: no send control in the Portal (troubleshooting, "Check your role").
  await step(
    "troubleshooting",
    "V-C49",
    "business_user",
    ["Lena Vogel (Portal)", "Nadia Haddad (setup)"],
    "/portal/contracts/:number",
    "An edit or action is unavailable / Electronic signing: a Business User cannot send for signature",
    "No Send for signature control on a shared Contract in the Portal; a direct send is refused.",
    async () => {
      const n = await signingPrimary(S.nadia, "V-C49 business_user portal");
      await S.nadia.api("POST", `/contracts/${n}/team`, { userId: uid("Lena Vogel") });
      const lp = S.lena.page;
      await lp.goto(`${BASE}/portal/contracts/${n}`);
      await lp.getByRole("heading", { level: 1 }).first().waitFor();
      await sleep(1500);
      const text = (await lp.locator("main").innerText()).replace(/\s+/g, " ");
      const sendControls = await lp
        .getByRole("button", { name: /send for signature|send envelope/i })
        .count();
      const direct = await S.lena.api("POST", `/contracts/${n}/envelopes`, {
        documentVersionId: await primaryVersionId(S.nadia, n),
        signers: [{ name: "Mara Quint", email: "mara@northwind.example" }],
        completesContract: true,
      });
      must(
        sendControls === 0 && direct.status >= 400,
        `controls ${sendControls} direct ${direct.status}`,
      );
      return `Lena Vogel opened C-${n} in the Portal (${q(text.slice(0, 120))}) with ${sendControls} send controls; a direct send answered ${direct.status}.`;
    },
  );

  // Put the owned lab's connector back to disabled.
  await D.api("POST", "/signing-connectors/docusign/disable", {});
}

// SECTIONS_APPENDED

try {
  if (process.env.CLEANUP_ONLY) {
    console.log(await cleanupFixtures());
  } else if (SIGNING) {
    await signingSection();
  } else {
    await setupFixtures();
    for (const id of ARTICLES) if (ONLY.includes(id) && SECTIONS[id]) await SECTIONS[id]();
    if (!process.env.KEEP_FIXTURES) results.cleanup = await cleanupFixtures();
  }
} finally {
  save();
  await closeBrowser();
}
const failed = results.steps.filter((s) => s.result !== "pass").length;
console.log(`${results.steps.length} steps, ${failed} not passed`);
