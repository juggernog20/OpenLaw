// DOC-029 independent walkthrough (roles, round 1).
// Walks "Understand roles and record access" (V-C06) and "Work on a shared Contract or Matter" (V-C25)
// against the shared work lab. Written by the DOC-029 independent walkthrough agent from the article text.
// Run from the worktree root after setup-r1.mjs and setup-r1-part2.mjs:
//   LAB_PASSWORD=... mise exec -- node docs/documentation/batches/DOC-029/roles/walkthrough-r1.mjs
// Credentials come only from the environment. Magic links, cookies and mail bodies are never written.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { chromium, passwordSignIn, magicSignIn, api, BASE, sleep } from "./lib-r1.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(path.join(here, "fixtures-r1.json"), "utf8"));
const OUT = process.env.OUT ?? path.join(here, "walkthrough-r1.json");
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;

const CO = fx.openContract.number; // C-35 open, Daniel creator and Legal Owner
const MO = fx.openMatter.number; // M-19 open, Daniel Matter Manager
const CC = fx.confContract.number; // C-36 Confidential, Nadia creator and Legal Owner, linked to M-19
const MC = fx.confMatter.number; // M-20 Confidential, Nadia, child of M-19
const ENTITY = fx.confEntity.id;
const CJ = fx.jonasRequest.converted.convertedRecord.number; // C-37 from R-16
const RJ = fx.jonasRequest.number;
let CR = fx.raviRequest.converted.convertedRecord.number; // replaced by a fresh converted Contract in G0
let raviPrimary = fx.raviPrimary;
const MR = fx.raviMatter.number; // M-24
const DM = fx.docPagingMatter.number; // M-50

function labStatus() {
  try {
    const text = execFileSync(
      "mise",
      ["exec", "--", "node", "scripts/documentation/lab.mjs", "status", "work"],
      {
        cwd: path.resolve(here, "../../../../.."),
        encoding: "utf8",
      },
    );
    const project = text.match(/(openlaw-docs-[0-9a-f]+-work)-app-1/)?.[1] ?? null;
    const source = text.match(/source ([0-9a-f]{40})/)?.[1] ?? null;
    const image = (name) =>
      execFileSync("docker", ["inspect", "--format", "{{.Image}}", `${project}-${name}-1`], {
        encoding: "utf8",
      }).trim();
    return { project, source, appImage: image("app"), engineImage: image("doc-engine") };
  } catch (error) {
    return { error: String(error).slice(0, 200) };
  }
}

const results = {
  batch: "DOC-029",
  group: "roles",
  round: 1,
  reviewer: "DOC-029 independent walkthrough agent (roles, round 1)",
  reviewerKind: "agent",
  appUrl: BASE,
  lab: labStatus(),
  articles: {
    "roles-and-access": sha("docs/user-guides/roles-and-access.md"),
    "contributor-guide": sha("docs/user-guides/contributor-guide.md"),
  },
  fixtures: {
    openContract: `C-${CO}`,
    openMatter: `M-${MO}`,
    confidentialContract: `C-${CC}`,
    confidentialMatter: `M-${MC}`,
    confidentialEntity: "DOC-029 roles confidential entity Ltd",
    jonasContract: `C-${CJ} from R-${RJ}`,
    raviContract: `C-${CR} from R-${fx.raviRequest.number}`,
    raviMatter: `M-${MR}`,
    documentPagingMatter: `M-${DM}`,
    pagingMatters: `M-${fx.pagingMatters[0].number} to M-${fx.pagingMatters.at(-1).number}`,
  },
  startedAt: new Date().toISOString(),
  steps: [],
  finishedAt: null,
};
function sha(rel) {
  const file = path.resolve(here, "../../../../..", rel);
  return execFileSync("sha256sum", [file], { encoding: "utf8" }).split(" ")[0];
}
function save() {
  results.finishedAt = new Date().toISOString();
  writeFileSync(OUT, JSON.stringify(results, null, 2));
}

async function step(article, role, id, expected, fn) {
  if (ONLY && !ONLY.has(id.split(".")[0])) return null;
  const entry = {
    article,
    id,
    role,
    method: "browser-walkthrough",
    expected,
    actual: null,
    result: "not-run",
    startedAt: new Date().toISOString(),
    at: null,
  };
  results.steps.push(entry);
  try {
    entry.actual = await fn();
    entry.result = "pass";
  } catch (error) {
    entry.actual = `Check did not complete: ${error instanceof Error ? error.message.split("\n").slice(0, 3).join(" ") : String(error)}`;
    entry.result = "fail";
  }
  entry.at = new Date().toISOString();
  console.log(
    `[${role}] ${entry.result.toUpperCase()} ${id}: ${String(entry.actual).slice(0, 300)}`,
  );
  save();
  return entry;
}
function check(condition, message) {
  if (!condition) throw new Error(message);
}

// ---------- page helpers ----------
const NOT_FOUND = /does not exist, or you cannot open it/;
async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await sleep(600);
}
const WENT_WRONG = /Something went wrong\./;
results.transientErrors = [];
async function go(page, url) {
  await page.goto(`${BASE}${url}`);
  await settle(page);
  // A shared lab under parallel load can show the error page once. Record it and reload one time.
  if (
    WENT_WRONG.test(
      await page
        .locator("body")
        .innerText()
        .catch(() => ""),
    )
  ) {
    results.transientErrors.push({
      at: new Date().toISOString(),
      url,
      consoleErrors: (page.__errors ?? []).slice(-3),
    });
    await page.reload();
    await settle(page);
  }
}
async function refused(page) {
  return NOT_FOUND.test(await page.locator("body").innerText());
}
async function h1(page) {
  const heading = page.getByRole("heading", { level: 1 }).first();
  await heading.waitFor({ timeout: 15000 });
  return (await heading.innerText()).trim();
}
async function openRecord(page, url) {
  await go(page, url);
  const title = await h1(page);
  if (WENT_WRONG.test(title)) throw new Error(`${url} showed "Something went wrong." twice`);
  return { title, refused: await refused(page) };
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
async function addTeamMember(page, appletName, person) {
  const panel = await applet(page, appletName);
  const add = panel.getByRole("button", { name: "Add team member" });
  check(await add.isEnabled(), "Add team member is disabled");
  await add.click();
  const dialog = page.getByRole("dialog", { name: "Add team member" });
  await dialog.waitFor();
  const controls = await dialog.locator("select, input, [role=combobox], [role=radio]").count();
  const options = await dialog
    .getByRole("combobox", { name: "Person" })
    .locator("option")
    .allInnerTexts();
  await dialog.getByRole("combobox", { name: "Person" }).selectOption({ label: person });
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await dialog.waitFor({ state: "hidden", timeout: 10000 });
  await panel.getByText(person, { exact: false }).first().waitFor({ timeout: 10000 });
  return { controls, options };
}
async function removeTeamMember(page, appletName, person, module) {
  const panel = await applet(page, appletName);
  const remove = panel.getByRole("button", { name: `Take ${person} off the ${module} team` });
  await remove.click();
  const confirm = page.getByRole("alertdialog");
  if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) {
    await confirm
      .getByRole("button")
      .filter({ hasNotText: /Cancel/ })
      .last()
      .click();
  }
  await remove.waitFor({ state: "detached", timeout: 10000 });
}
async function rosterRows(panel) {
  return (await panel.getByRole("listitem").allInnerTexts()).map((t) =>
    t.replace(/\s+/g, " ").trim(),
  );
}
async function pickPerson(page, field, person) {
  await page.getByRole("button", { name: field, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: field });
  await dialog.waitFor();
  await dialog.getByRole("button", { name: person, exact: true }).click();
  await dialog.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
  await settle(page);
  const value = (await page.getByRole("button", { name: field, exact: true }).innerText()).trim();
  check(value.includes(person), `${field} shows ${value}, not ${person}`);
}

async function revealLink(page, name) {
  for (let i = 0; i < 5 && !(await page.getByRole("link", { name }).count()); i++) {
    const more = page.getByRole("button", { name: "Show more" });
    if (!(await more.count())) break;
    await more.click();
    await settle(page);
  }
}

// ---------- run ----------
const browser = await chromium.launch();
const daniel = await passwordSignIn(browser, "daniel.okafor@helix.example");
const nadia = await passwordSignIn(browser, "nadia.haddad@helix.example");
const priya = await passwordSignIn(browser, "priya.raman@helix.example");
const jonas = await magicSignIn(browser, "jonas.weber@helix.example");
for (const ctx of [daniel, nadia, priya, jonas]) {
  ctx.page.__errors = [];
  ctx.page.on("pageerror", (e) => ctx.page.__errors.push(e.message.slice(0, 200)));
}
const D = daniel.page;
const N = nadia.page;
const P = priya.page;
const J = jonas.page;

const RA = "roles-and-access";
const CG = "contributor-guide";

// ===== roles-and-access: account types =====
await step(
  RA,
  "administrator",
  "A1.accounts",
  "Users lists Administrator, Legal Team Member and Business User account types; no Contributor type exists; an Administrator can pick Legal Team Member for a Business User.",
  async () => {
    await go(D, "/settings/users");
    const table = await D.getByRole("table").innerText();
    const roleButton = D.getByRole("button", {
      name: "Business user — change the role of ravi.menon@helix.example",
    });
    await roleButton.click();
    await sleep(700);
    const menu = D.getByRole("menu").or(D.getByRole("listbox")).or(D.getByRole("dialog")).first();
    await menu.waitFor({ timeout: 5000 });
    const choices = (await menu.innerText()).replace(/\s+/g, " ").trim();
    await D.keyboard.press("Escape");
    await sleep(400);
    check(/Legal team member/i.test(choices), `role choices: ${choices}`);
    check(!/Contributor/i.test(table + choices), "Contributor still appears");
    return `Settings > Users showed ${["Administrator", "Legal team member", "Business user"].filter((r) => new RegExp(r, "i").test(table)).join(", ")} in the Role column and no Contributor. The role control for Ravi Menon offered: ${choices}. Escape closed it without a change.`;
  },
);

await step(
  RA,
  "legal_team_member",
  "A2.settings",
  "Organization settings remain Administrator-only.",
  async () => {
    await go(N, "/settings/users");
    const body = await N.locator("body").innerText();
    const users = await N.getByRole("button", { name: "Invite user" })
      .isVisible()
      .catch(() => false);
    const orgLinks = await N.getByRole("link", { name: "Users", exact: true }).count();
    check(!users, "Nadia sees Invite user");
    return `Nadia at /settings/users landed on ${new URL(N.url()).pathname}; Invite user absent; Users link count ${orgLinks}; page says: ${body.replace(/\s+/g, " ").slice(0, 160)}`;
  },
);

// ===== Confidential Contracts and Matters =====
await step(
  RA,
  "legal_team_member",
  "B1.open-records",
  "A Legal Team Member opens non-Confidential Contracts and Matters without a team row.",
  async () => {
    const c = await openRecord(N, `/contracts/${CO}`);
    const m = await openRecord(N, `/matters/${MO}`);
    check(!c.refused && !m.refused, "refused");
    return `Nadia opened C-${CO} "${c.title}" and M-${MO} "${m.title}" with no team row.`;
  },
);

await step(
  RA,
  "administrator",
  "B2.admin-refused",
  "Administrator status does not bypass the Confidential rule: without a team row or Legal Owner / Matter Manager, Daniel is refused; a copied link and a reload do not restore access.",
  async () => {
    const c = await openRecord(D, `/contracts/${CC}`);
    await D.reload();
    await settle(D);
    const cReload = await refused(D);
    const m = await openRecord(D, `/matters/${MC}`);
    check(
      c.refused && cReload && m.refused,
      `C refused ${c.refused}, reload ${cReload}, M refused ${m.refused}`,
    );
    return `Daniel saw "${c.title}" / "C-${CC} does not exist, or you cannot open it." on the copied link and again after reload; M-${MC} showed "${m.title}".`;
  },
);

await step(
  RA,
  "administrator",
  "B3.related-links",
  "A link to a related record does not grant reach: the parent Matter shows the Confidential child and linked Contract without a link.",
  async () => {
    await go(D, `/matters/${MO}`);
    const main = await D.getByRole("main").innerText();
    const childLink = await D.getByRole("link", { name: /DOC-029 roles confidential/ }).count();
    check(
      /Restricted Matter/.test(main) && /Restricted contract/.test(main) && childLink === 0,
      "restricted placeholders missing or links present",
    );
    return `On M-${MO}, Daniel saw "Restricted Matter" under Children and "Restricted contract" under Linked Contracts, with no link to either title.`;
  },
);

await step(
  RA,
  "administrator",
  "B4.list-search",
  "Search and lists omit Confidential records the person cannot reach.",
  async () => {
    const titles = async (module) => {
      const all = [];
      let cursor = null;
      do {
        const page = await api(
          D,
          "GET",
          `/${module}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        );
        all.push(...page.json[module].map((row) => row.title));
        cursor = page.json.nextCursor;
      } while (cursor);
      return all;
    };
    const ct = await titles("contracts");
    const mt = await titles("matters");
    await go(D, `/contracts`);
    const search = D.getByRole("banner").getByRole("combobox", { name: "Search" });
    await search.fill("DOC-029 roles");
    await sleep(2500);
    const table = (
      await D.getByRole("listbox")
        .first()
        .innerText()
        .catch(async () => D.locator("body").innerText())
    ).replace(/\s+/g, " ");
    await D.keyboard.press("Escape");
    check(/DOC-029 roles open/.test(table), "open records missing from search");
    check(!/DOC-029 roles confidential/.test(table), "listed");
    check(
      ct.includes("DOC-029 roles open contract") &&
        !ct.includes("DOC-029 roles confidential contract") &&
        !mt.includes("DOC-029 roles confidential matter"),
      "API lists it",
    );
    return `Daniel\'s header Search for "DOC-029 roles" offered "${table.slice(0, 200)}" and no Confidential title; the full Contracts list (${ct.length} rows) and Matters list (${mt.length} rows) omitted C-${CC} and M-${MC}.`;
  },
);

await step(
  RA,
  "legal_team_member",
  "B5.team-add-admin",
  "Nadia (Creator, Legal Owner) opens Contract team, selects Add team member, chooses Daniel in Person and selects Add. Each person appears once with no role picker. Daniel then reaches the record.",
  async () => {
    await go(N, `/contracts/${CC}`);
    const { controls, options } = await addTeamMember(N, "Contract team", "Daniel Okafor");
    const panel = await applet(N, "Contract team");
    const rows = await rosterRows(panel);
    const c = await openRecord(D, `/contracts/${CC}`);
    check(!c.refused, "Daniel still refused");
    check(controls === 1, `dialog has ${controls} controls`);
    check(!options.includes("Nadia Haddad"), "existing member offered");
    check(rows.filter((r) => r.includes("Daniel Okafor")).length === 1, "Daniel row count");
    return `Add team member dialog had one control (Person) and no role picker; Nadia (already on the team) was not offered. Roster: ${rows.join(" | ")}. Daniel then opened C-${CC} "${c.title}".`;
  },
);

await step(
  RA,
  "administrator",
  "B6.admin-audience",
  "An Administrator who can reach the Confidential record may change its audience.",
  async () => {
    await go(D, `/contracts/${CC}`);
    const panel = await applet(D, "Contract team");
    const add = await panel.getByRole("button", { name: "Add team member" }).isEnabled();
    const sw = await D.getByRole("switch", { name: /Confidential/ }).isEnabled();
    check(add && sw, `add ${add} switch ${sw}`);
    return `Daniel, on the team as an Administrator, had Add team member enabled and the Confidential switch enabled on C-${CC}.`;
  },
);

await step(
  RA,
  "legal_team_member",
  "B7.reader-no-audience-right",
  "Being able to read a Confidential record does not give the right to change its audience (Priya, Legal Team Member on the team, not Creator or Legal Owner).",
  async () => {
    await go(N, `/contracts/${CC}`);
    await addTeamMember(N, "Contract team", "Priya Raman");
    const c = await openRecord(P, `/contracts/${CC}`);
    check(!c.refused, "Priya refused");
    const panel = await applet(P, "Contract team");
    const add = await panel.getByRole("button", { name: "Add team member" }).isEnabled();
    const removes = await panel
      .getByRole("button", { name: /^Take .* off the contract team$/ })
      .evaluateAll((els) => els.map((e) => !e.disabled));
    const sw = await P.getByRole("switch", { name: /Confidential/ }).isEnabled();
    check(!add && !sw && !removes.some(Boolean), `add ${add} switch ${sw} removes ${removes}`);
    return `Priya opened C-${CC}; Add team member disabled, the Confidential switch disabled, and ${removes.length} remove controls all disabled or absent.`;
  },
);

await step(
  RA,
  "legal_team_member",
  "B8.remove-ends-access",
  "Removing a team row with the person's remove control ends Confidential access on the next read.",
  async () => {
    await go(N, `/contracts/${CC}`);
    await removeTeamMember(N, "Contract team", "Priya Raman", "contract");
    await removeTeamMember(N, "Contract team", "Daniel Okafor", "contract");
    await D.reload();
    await settle(D);
    const d = await refused(D);
    await P.reload();
    await settle(P);
    const p = await refused(P);
    check(d && p, `Daniel refused ${d}, Priya refused ${p}`);
    return `Nadia removed Priya and Daniel; on reload both saw "does not exist, or you cannot open it" for C-${CC}.`;
  },
);

await step(
  RA,
  "legal_team_member",
  "B9.legal-owner",
  "On a Confidential Contract, being Legal Owner admits an Administrator without a team row; changing the owner back refuses them again.",
  async () => {
    await go(N, `/contracts/${CC}`);
    await pickPerson(N, "Legal Owner", "Daniel Okafor");
    const c = await openRecord(D, `/contracts/${CC}`);
    const panel = await applet(D, "Contract team");
    const rows = await rosterRows(panel);
    check(!c.refused, "Daniel refused as Legal Owner");
    await pickPerson(D, "Legal Owner", "Nadia Haddad");
    const n = await openRecord(N, `/contracts/${CC}`);
    let again = false;
    for (let i = 0; i < 3 && !again; i++) {
      await sleep(1000);
      await D.reload();
      await settle(D);
      again = await refused(D);
    }
    check(!n.refused && again, `Nadia refused ${n.refused}, Daniel refused ${again}`);
    return `After Nadia set Legal Owner to Daniel on Overview, Daniel opened C-${CC} with no team row (roster: ${rows.join(" | ")}). Daniel set Legal Owner back to Nadia; Nadia kept access and Daniel's reload was refused.`;
  },
);

await step(
  RA,
  "legal_team_member",
  "B10.matter-manager-and-team",
  "On a Confidential Matter, a team row or Matter Manager admits the person; removal refuses them.",
  async () => {
    await go(N, `/matters/${MC}`);
    await addTeamMember(N, "Matter team", "Daniel Okafor");
    const viaTeam = await openRecord(D, `/matters/${MC}`);
    await removeTeamMember(N, "Matter team", "Daniel Okafor", "matter");
    await D.reload();
    await settle(D);
    const afterRemove = await refused(D);
    await go(N, `/matters/${MC}`);
    await pickPerson(N, "Matter Manager", "Daniel Okafor");
    const viaManager = await openRecord(D, `/matters/${MC}`);
    await pickPerson(D, "Matter Manager", "Nadia Haddad");
    await D.reload();
    await settle(D);
    const afterManager = await refused(D);
    check(
      !viaTeam.refused && afterRemove && !viaManager.refused && afterManager,
      JSON.stringify({ viaTeam, afterRemove, viaManager, afterManager }),
    );
    return `Daniel opened M-${MC} through a Matter team row, was refused after Nadia removed it, opened it again as Matter Manager, and was refused after he returned Matter Manager to Nadia.`;
  },
);

await step(
  RA,
  "legal_team_member",
  "B11.ltm-removal-open",
  "Removing a Legal Team Member from an open record does not end their ordinary access; a Confidential Document narrows to the named audience.",
  async () => {
    await go(N, `/contracts/${CO}/documents`);
    const before = /doc029-roles-confidential-note/.test(await N.getByRole("main").innerText());
    await go(D, `/contracts/${CO}`);
    await addTeamMember(D, "Contract team", "Nadia Haddad");
    await go(N, `/contracts/${CO}/documents`);
    const onTeam = /doc029-roles-confidential-note/.test(await N.getByRole("main").innerText());
    await go(D, `/contracts/${CO}`);
    await removeTeamMember(D, "Contract team", "Nadia Haddad", "contract");
    const after = await openRecord(N, `/contracts/${CO}`);
    await go(N, `/contracts/${CO}/documents`);
    const afterDoc = /doc029-roles-confidential-note/.test(await N.getByRole("main").innerText());
    await go(D, `/contracts/${CO}/documents`);
    const danielDoc = /doc029-roles-confidential-note/.test(await D.getByRole("main").innerText());
    check(!after.refused, "Nadia refused after removal");
    check(
      !before && onTeam && !afterDoc && danielDoc,
      JSON.stringify({ before, onTeam, afterDoc, danielDoc }),
    );
    return `Nadia opened C-${CO} after Daniel added and removed her team row. The Confidential Document doc029-roles-confidential-note.txt was hidden from her before, shown while she was on the team, hidden after removal, and shown to Daniel on the team throughout.`;
  },
);

// ===== Confidential Entities =====
await step(
  RA,
  "administrator",
  "C1.entity-admin-refused",
  "Every person needs a Grant for a Confidential Entity, Administrators too.",
  async () => {
    const e = await openRecord(D, `/entities/${ENTITY}`);
    const p = await openRecord(P, `/entities/${ENTITY}`);
    check(e.refused && p.refused, `Daniel ${e.refused}, Priya ${p.refused}`);
    return `Daniel saw "${e.title}" and Priya saw "${p.title}" for the Confidential Entity; neither has a Grant.`;
  },
);

await step(
  RA,
  "legal_team_member",
  "C2.entity-grant",
  "The creator has a Grant. A Legal Team Member with a Grant uses Manage access to give and remove Grants. A Grant applies to that Entity only.",
  async () => {
    await go(N, `/entities/${ENTITY}`);
    await N.getByRole("button", { name: "Manage access" }).click();
    const dialog = N.getByRole("dialog", { name: "Confidential access" });
    await dialog.waitFor();
    const intro = (await dialog.innerText()).replace(/\s+/g, " ").slice(0, 220);
    check(
      await dialog.getByRole("button", { name: "Remove Nadia Haddad" }).isVisible(),
      "creator Grant missing",
    );
    const options = await dialog
      .getByRole("combobox", { name: "Person" })
      .locator("option")
      .allInnerTexts();
    await dialog.getByRole("combobox", { name: "Person" }).selectOption({ label: "Daniel Okafor" });
    await dialog.getByRole("button", { name: "Grant access" }).click();
    await dialog.getByRole("button", { name: "Remove Daniel Okafor" }).waitFor({ timeout: 10000 });
    const e = await openRecord(D, `/entities/${ENTITY}`);
    const manage = await D.getByRole("button", { name: "Manage access" })
      .isVisible()
      .catch(() => false);
    const other = await api(D, "GET", "/entities?q=DOC-029");
    await dialog.getByRole("button", { name: "Remove Daniel Okafor" }).click();
    const confirm = N.getByRole("alertdialog");
    if (await confirm.isVisible({ timeout: 1500 }).catch(() => false))
      await confirm.getByRole("button").last().click();
    await dialog
      .getByRole("button", { name: "Remove Daniel Okafor" })
      .waitFor({ state: "detached", timeout: 10000 });
    await D.reload();
    await settle(D);
    const after = await refused(D);
    check(!e.refused && manage && after, JSON.stringify({ e, manage, after }));
    check(!options.some((o) => /Jonas|Ravi|Amara/.test(o)), "Business Users offered");
    return `Dialog: "${intro}". Nadia's creator Grant was listed. Person offered only Administrators and Legal Team Members (${options.length - 1} people). After Grant access, Daniel opened the Entity and saw Manage access. After Remove Daniel Okafor, Daniel's reload was refused. Entity list for Daniel with the Grant: ${other.status}.`;
  },
);

await step(
  RA,
  "legal_team_member",
  "C3.last-grant",
  "A Confidential Entity must keep at least one active person with a Grant.",
  async () => {
    await go(N, `/entities/${ENTITY}`);
    await N.getByRole("button", { name: "Manage access" }).click();
    const dialog = N.getByRole("dialog", { name: "Confidential access" });
    await dialog.waitFor();
    const remove = dialog.getByRole("button", { name: "Remove Nadia Haddad" });
    const enabled = await remove.isEnabled();
    let message = "remove control disabled";
    if (enabled) {
      await remove.click();
      const confirm = N.getByRole("alertdialog");
      if (await confirm.isVisible({ timeout: 1500 }).catch(() => false))
        await confirm.getByRole("button").last().click();
      await sleep(2000);
      message = (
        await dialog
          .getByRole("alert")
          .or(N.getByRole("status"))
          .first()
          .innerText()
          .catch(() => "no alert text")
      ).replace(/\s+/g, " ");
    }
    await N.keyboard.press("Escape");
    const still = await openRecord(N, `/entities/${ENTITY}`);
    check(!still.refused, "Nadia lost the last Grant");
    return `Removing the only Grant was refused (${message.slice(0, 200)}); Nadia still opens the Entity.`;
  },
);

await step(
  RA,
  "administrator",
  "C4.open-entity-manage",
  "An Administrator can manage access on an Entity that is not Confidential; a Legal Team Member without a Grant cannot.",
  async () => {
    const list = await api(D, "GET", "/entities");
    const open = list.json.entities.find(
      (e) => !e.isConfidential && !e.archivedAt && /^Helix/.test(e.legalName),
    );
    await go(D, `/entities/${open.id}`);
    const danielManage = await D.getByRole("button", { name: "Manage access" })
      .isVisible()
      .catch(() => false);
    await go(N, `/entities/${open.id}`);
    const nadiaManage = await N.getByRole("button", { name: "Manage access" })
      .isVisible()
      .catch(() => false);
    check(danielManage && !nadiaManage, `Daniel ${danielManage}, Nadia ${nadiaManage}`);
    return `On the non-Confidential Entity "${open.legalName}", Daniel saw Manage access and Nadia did not. No Grant was changed.`;
  },
);

// ===== Business User reach =====
await step(
  RA,
  "business_user",
  "D1.full-app-closed",
  "Business Users use the Portal; they cannot open the Entities module or full-app records and search.",
  async () => {
    const seen = [];
    for (const url of [
      `/contracts/${CO}`,
      "/search",
      "/entities",
      `/entities/${ENTITY}`,
      "/settings/users",
    ]) {
      await go(J, url);
      seen.push(`${url} -> ${new URL(J.url()).pathname}`);
    }
    const nav = await J.getByRole("navigation", { name: "Portal" }).innerText();
    const entityApi = await api(J, "GET", `/entities/${ENTITY}`);
    check(seen.every((s) => s.endsWith("/portal")) && !/Entities/.test(nav), seen.join("; "));
    return `${seen.join("; ")}. Portal navigation: ${nav.replace(/\s+/g, " ")}. Entity read answered ${entityApi.status}.`;
  },
);

await step(
  RA,
  "business_user",
  "D2.not-on-team",
  "A Business User reaches only records whose teams include them.",
  async () => {
    const out = [];
    for (const url of [
      `/portal/contracts/${CO}`,
      `/portal/contracts/${CC}`,
      `/portal/matters/${MO}`,
      `/portal/matters/${MC}`,
    ]) {
      await go(J, url);
      out.push(`${url}: ${await h1(J)}`);
    }
    check(
      out.every((o) => /not found/.test(o)),
      out.join("; "),
    );
    return out.join("; ");
  },
);

await step(
  RA,
  "business_user",
  "D3.conversion",
  "At conversion the Requester becomes Business Owner and a team member; the old Request address leads to the record.",
  async () => {
    await go(J, `/portal/requests/${RJ}`);
    const landed = new URL(J.url()).pathname;
    const title = await h1(J);
    const panel = await applet(J, "Contract team");
    const rows = await rosterRows(panel);
    const list = await (async () => {
      await go(J, "/portal/contracts");
      await J.getByRole("searchbox", { name: "Search Contracts" }).fill(`C-${CJ}`);
      await J.getByRole("searchbox", { name: "Search Contracts" }).press("Enter");
      await settle(J);
      return J.getByRole("main").innerText();
    })();
    check(
      title.includes("Jonas converted contract") &&
        rows.some((r) => /Business Owner.*Jonas Weber/.test(r)) &&
        list.includes(`C-${CJ}`),
      `${landed} ${title} ${rows}`,
    );
    return `/portal/requests/${RJ} showed "${title}" (address ${landed}). Contract team rows: ${rows.join(" | ")}. Your Contracts lists C-${CJ}.`;
  },
);

await step(
  RA,
  "legal_team_member",
  "D4.add-business-user",
  "Adding a Business User to the team gives them Portal access to the record.",
  async () => {
    await go(N, `/contracts/${CO}`);
    await addTeamMember(N, "Contract team", "Jonas Weber");
    const c = await openRecord(J, `/portal/contracts/${CO}`);
    check(!c.refused && c.title === "DOC-029 roles open contract", c.title);
    await go(J, "/portal/contracts");
    await J.getByRole("searchbox", { name: "Search Contracts" }).fill(
      "DOC-029 roles open contract",
    );
    await J.getByRole("searchbox", { name: "Search Contracts" }).press("Enter");
    await settle(J);
    const list = await J.getByRole("main").innerText();
    check(list.includes(`C-${CO}`), "not listed");
    return `After Nadia added Jonas through Contract team, Jonas opened /portal/contracts/${CO} "${c.title}" and Your Contracts listed C-${CO}.`;
  },
);

await step(
  RA,
  "business_user",
  "D5.comments-tiers",
  "Business Users read and post Full thread comments; they do not see Legal only or Working team; a later-added member reads the Full Thread history.",
  async () => {
    const reply = `DOC-029 roles reply from Jonas ${Date.now().toString().slice(-6)}`;
    await go(J, `/portal/contracts/${CO}`);
    const panel = await applet(J, "Comments");
    await sleep(1000);
    const text = (await panel.innerText()).replace(/\s+/g, " ");
    const audience = await panel
      .getByRole("radiogroup")
      .or(panel.getByRole("group", { name: "Audience" }))
      .count();
    await panel.getByRole("textbox", { name: "New comment" }).fill(reply);
    await panel.getByRole("button", { name: "Comment", exact: true }).click();
    await panel.getByText(reply).waitFor({ timeout: 10000 });
    const legal = await Promise.resolve().then(async () => {
      await go(N, `/contracts/${CO}`);
      const p = await applet(N, "Comments");
      await p.getByText(reply).waitFor({ timeout: 10000 });
      const item = p.getByRole("listitem").filter({ hasText: reply });
      const radios = await p
        .getByRole("radio")
        .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? e.id));
      const radioLabels = await p
        .getByRole("group", { name: "Audience" })
        .innerText()
        .catch(() => "");
      return {
        item: (await item.innerText()).replace(/\s+/g, " "),
        radios: radioLabels.replace(/\s+/g, " "),
      };
    });
    check(
      text.includes("DOC-029 roles Full thread note") &&
        !text.includes("DOC-029 roles Legal only note") &&
        !text.includes("DOC-029 roles Working team note") &&
        audience === 0,
      text.slice(0, 300),
    );
    return `Jonas's Comments showed the earlier Full Thread note and neither the Legal Only nor the Working Team note; no audience picker. His reply posted. Nadia saw it as "${legal.item.slice(0, 120)}". Nadia's audience choices read "${legal.radios}". Label check: the Contract applet names the tiers Legal Only, Internal team and Contract Team; the words "Full thread", "Legal only" and "Working team" did not appear as labels in either view.`;
  },
);

await step(
  RA,
  "legal_team_member",
  "D5b.tier-labels",
  "Label check for the article text: Business Users read and post **Full thread** comments and do not see **Legal only** or **Working team**; Legal must choose Full Thread for a message intended for the business. A reader should find those labels on a Contract or Matter.",
  async () => {
    await go(N, `/contracts/${CO}`);
    const lp = await applet(N, "Comments");
    await lp.getByText("DOC-029 roles Full thread note").waitFor({ timeout: 20000 });
    const audience = (await lp.getByRole("group", { name: "Audience" }).innerText()).replace(
      /\s+/g,
      " ",
    );
    const items = await lp.getByRole("listitem").allInnerTexts();
    await N.screenshot({ path: path.join(here, "r1-legal-audience-labels.png") });
    await go(N, `/matters/${MO}`);
    const mp = await applet(N, "Comments");
    const maudience = (await mp.getByRole("group", { name: "Audience" }).innerText()).replace(
      /\s+/g,
      " ",
    );
    // Tier chips only: strip the comment bodies, which contain the fixture words "Legal only note" and so on.
    const chipText = items
      .join("\n")
      .split("\n")
      .filter((line) => !/DOC-029/.test(line))
      .join(" ");
    const all = `${audience} ${chipText} ${maudience}`;
    const found = ["Full thread", "Legal only", "Working team"].filter((l) => all.includes(l));
    const observed = `Contract Audience choices: "${audience}". Matter Audience choices: "${maudience}". Contract comment header chips include: ${[...new Set(chipText.match(/Legal Only|Internal team|Contract Team|Full thread|Legal only|Working team/g) ?? [])].join(", ")}.`;
    check(
      found.length === 3,
      `${observed} The labels Full thread, Legal only and Working team are not shown on Contracts or Matters (found: ${found.join(", ") || "none"}). The visible labels are Contract Team / Matter Team (Full Thread tier), Legal Only, and Internal team (older Working Team comments). See r1-legal-audience-labels.png.`,
    );
    return observed;
  },
);

await step(
  RA,
  "business_user",
  "D6.history-portal-limits",
  "The History applet shows shared comments and business record changes and excludes Legal Only and Working Team activity. The Portal excludes legal Fields, Tasks, Key dates, Approvals and signing controls.",
  async () => {
    await go(J, `/portal/contracts/${CO}`);
    const hist = (await (await applet(J, "History")).innerText()).replace(/\s+/g, " ");
    const main = await J.getByRole("main").innerText();
    const forbidden = ["Tasks", "Key dates", "Approvals", "Signature", "Send for signature"].filter(
      (w) => new RegExp(`\\b${w}\\b`).test(main),
    );
    const stageButtons = await J.getByRole("button", { name: /move contract/ }).count();
    check(
      !/Legal only note|Working team note/.test(hist) &&
        forbidden.length === 0 &&
        stageButtons === 0,
      `${hist.slice(0, 200)} ${forbidden}`,
    );
    return `Portal History: "${hist.slice(0, 260)}". No Tasks, Key dates, Approvals or signing controls, and no Stage move buttons, on the Portal record.`;
  },
);

await step(
  RA,
  "business_user",
  "D6b.history-business-change",
  "The History applet shows shared comments and business record changes (a Legal change to a business value such as Region or Description).",
  async () => {
    await go(N, `/contracts/${CO}`);
    await h1(N);
    const region = N.getByRole("combobox", { name: "Region" }).first();
    await region.selectOption({ label: "APAC" });
    await settle(N);
    await sleep(1500);
    const desc = N.getByRole("textbox", { name: "Description" });
    await desc.fill(`DOC-029 roles shared description ${Date.now().toString().slice(-6)}`);
    await desc.blur();
    await settle(N);
    await sleep(1500);
    const legalHist = (await (await applet(N, "History")).innerText()).replace(/\s+/g, " ");
    await go(J, `/portal/contracts/${CO}`);
    const overview = (await J.getByRole("region", { name: "Overview" }).innerText()).replace(
      /\s+/g,
      " ",
    );
    const hist = (await (await applet(J, "History")).innerText()).replace(/\s+/g, " ");
    const api1 = await api(
      J,
      "GET",
      `/portal/activity?entityType=contract&entityId=${fx.openContract.id}`,
    );
    const actions = (api1.json?.entries ?? []).map((e) => e.action);
    await J.screenshot({ path: path.join(here, "r1-portal-history.png") });
    await go(N, `/contracts/${CO}`);
    await h1(N);
    await N.getByRole("combobox", { name: "Region" }).first().selectOption({ label: "EMEA" });
    await settle(N);
    check(
      /APAC/.test(overview),
      `Portal Overview did not show the new Region: ${overview.slice(0, 160)}`,
    );
    check(
      actions.some((a) => a === "contract.updated"),
      `Legal's full-app History read "${legalHist.slice(0, 200)}". Jonas's Portal Overview showed Region APAC and the new Description, but his History read "${hist.slice(0, 200)}" and the Portal activity read returned actions [${actions.join(", ")}], with no record change. Source: contract.updated is written at RECORD_ACTIVITY_TIER (working_team, apps/api/src/lib/activity.ts:106) and /portal/activity selects only full_thread rows (apps/api/src/modules/portal/applets.ts). See r1-portal-history.png.`,
    );
    return `Jonas's History showed the change: ${hist.slice(0, 200)}`;
  },
);

await step(
  RA,
  "business_user",
  "D7.portal-team-add",
  "Business Users may add existing people from the Portal on non-Confidential records.",
  async () => {
    await go(J, `/portal/contracts/${CO}`);
    const { options } = await addTeamMember(J, "Contract team", "Amara Nwosu");
    const panel = await applet(J, "Contract team");
    const rows = await rosterRows(panel);
    const removes = await panel.getByRole("button", { name: /off the/ }).count();
    await go(N, `/contracts/${CO}`);
    const legalRows = await rosterRows(await applet(N, "Contract team"));
    await removeTeamMember(N, "Contract team", "Amara Nwosu", "contract");
    check(
      legalRows.some((r) => r.includes("Amara Nwosu")) &&
        !options.includes("Jonas Weber") &&
        removes === 0,
      legalRows.join("|"),
    );
    return `Jonas added Amara Nwosu (existing members were not offered). Portal roster: ${rows.join(" | ")}; no remove control in the Portal. Nadia saw Amara on the same team in the full app and removed her to restore the fixture.`;
  },
);

await step(
  RA,
  "legal_team_member",
  "D8.business-owner-statements",
  "Owner statements appear on the person's row in both apps. Changing Business Owner does not add or remove membership. Removing membership leaves statements visible, and statements alone do not grant Portal access; removal ends access on the next read, including old links.",
  async () => {
    await go(N, `/contracts/${CO}`);
    await pickPerson(N, "Business Owner", "Jonas Weber");
    const fullRows = await rosterRows(await applet(N, "Contract team"));
    await go(J, `/portal/contracts/${CO}`);
    const portalRows = await rosterRows(await applet(J, "Contract team"));
    await go(N, `/contracts/${CO}`);
    await removeTeamMember(N, "Contract team", "Jonas Weber", "contract");
    await sleep(800);
    const afterRows = await rosterRows(await applet(N, "Contract team"));
    await J.reload();
    await settle(J);
    const jRefused = /not found/.test(await h1(J));
    const docs = await api(J, "GET", `/portal/contracts/${CO}/documents`);
    await go(N, `/matters/${MO}`);
    await pickPerson(N, "Business Owner", "Jonas Weber");
    const mRows = await rosterRows(await applet(N, "Matter team"));
    const jm = await openRecord(J, `/portal/matters/${MO}`);
    await go(N, `/contracts/${CO}`);
    await pickPerson(N, "Business Owner", "Unassigned");
    await go(N, `/matters/${MO}`);
    await pickPerson(N, "Business Owner", "Unassigned");
    check(
      fullRows.some((r) => /Business Owner.*Jonas Weber/.test(r)) &&
        portalRows.some((r) => /Business Owner.*Jonas Weber/.test(r)),
      "statement rows",
    );
    check(jRefused && docs.status >= 400, `refused ${jRefused} docs ${docs.status}`);
    check(
      !mRows.some((r) => r.includes("Jonas Weber") && !/Business Owner/.test(r)) &&
        /not found/.test(jm.title),
      `${mRows} ${jm.title}`,
    );
    return `Full-app row: ${fullRows.filter((r) => r.includes("Jonas")).join()}; Portal row: ${portalRows.filter((r) => r.includes("Jonas")).join()}. After Nadia removed Jonas's membership the full-app roster showed: ${afterRows.join(" | ")}. Jonas's reload of the old link showed "Contract not found" and the Documents read answered ${docs.status}. Setting Jonas as Business Owner on M-${MO} left him outside the team (${mRows.join(" | ")}) and the Portal refused "${jm.title}". Both Business Owners were returned to Unassigned.`;
  },
);

await step(
  RA,
  "business_user",
  "D9.related-no-reach",
  "A link or parent relation does not grant a Business User access to the related record.",
  async () => {
    await go(N, `/matters/${MO}`);
    await addTeamMember(N, "Matter team", "Jonas Weber");
    const m = await openRecord(J, `/portal/matters/${MO}`);
    const main = await J.getByRole("main").innerText();
    const c = await openRecord(J, `/portal/contracts/${CC}`);
    const child = await openRecord(J, `/portal/matters/${MC}`);
    await go(N, `/matters/${MO}`);
    await removeTeamMember(N, "Matter team", "Jonas Weber", "matter");
    check(
      !m.refused &&
        !/DOC-029 roles confidential (contract|matter)/.test(main) &&
        /not found/.test(c.title) &&
        /not found/.test(child.title),
      JSON.stringify({ m, c, child }),
    );
    return `With Jonas on the M-${MO} team he opened it (${/DOC-029 roles confidential (contract|matter)/.test(main) ? "a Confidential record title appeared" : "no Confidential record title appeared"}), but the linked C-${CC} showed "${c.title}" and the child M-${MC} showed "${child.title}". Nadia removed him afterwards.`;
  },
);

await step(
  RA,
  "business_user",
  "D10.confidential-portal",
  "A Business User always needs a team row on a Confidential record; Confidential team changes stay with Legal.",
  async () => {
    await go(N, `/contracts/${CC}`);
    await addTeamMember(N, "Contract team", "Jonas Weber");
    const c = await openRecord(J, `/portal/contracts/${CC}`);
    const panel = await applet(J, "Contract team");
    const add = await panel.getByRole("button", { name: "Add team member" }).isEnabled();
    const note = (await panel.innerText()).replace(/\s+/g, " ");
    await go(N, `/contracts/${CC}`);
    await removeTeamMember(N, "Contract team", "Jonas Weber", "contract");
    await J.reload();
    await settle(J);
    const after = /not found/.test(await h1(J));
    check(
      !c.refused && !add && /Ask Legal to add members to a Confidential record/.test(note) && after,
      note,
    );
    return `With a team row Jonas opened C-${CC} in the Portal; Add team member was disabled with "Ask Legal to add members to a Confidential record." After Nadia removed the row, his reload showed Contract not found.`;
  },
);

await step(
  RA,
  "business_user",
  "D11.archived-request",
  "An archived record leaves the Portal; the old Request link shows the original ask and an archived notice, without Documents or a conversation.",
  async () => {
    const archived = await api(N, "POST", `/contracts/${CJ}/archive`, {});
    check(archived.status < 300, `archive ${archived.status}`);
    await go(J, "/portal/contracts");
    await J.getByRole("searchbox", { name: "Search Contracts" }).fill("DOC-029 roles Jonas");
    await J.getByRole("searchbox", { name: "Search Contracts" }).press("Enter");
    await settle(J);
    const list = await J.getByRole("main").innerText();
    const direct = await openRecord(J, `/portal/contracts/${CJ}`);
    await go(J, `/portal/requests/${RJ}`);
    const main = (await J.getByRole("main").innerText()).replace(/\s+/g, " ");
    const docs = await J.getByRole("region", { name: "Documents" }).count();
    const comments =
      (await J.getByRole("textbox", { name: "New comment" }).count()) +
      (await J.getByRole("button", { name: "Comments" }).count());
    const restored = await api(N, "POST", `/contracts/${CJ}/restore`, {});
    check(
      !list.includes(`C-${CJ}`) &&
        /not found/.test(direct.title) &&
        /archived/.test(main) &&
        main.includes("DOC-029 roles fictional ask from Jonas") &&
        docs === 0 &&
        comments === 0,
      main.slice(0, 300),
    );
    return `Legal archived C-${CJ} (API stand-in for Contract actions). Your Contracts no longer listed it and the direct link showed "${direct.title}". /portal/requests/${RJ} read: "${main.slice(0, 260)}" with no Documents region and no comment controls. Legal restored C-${CJ} afterwards (${restored.status}).`;
  },
);

// ===== contributor-guide (Ravi, Business User) =====
const ravi = await magicSignIn(browser, "ravi.menon@helix.example");
const R = ravi.page;

await step(
  CG,
  "business_user",
  "G0.fixture",
  "Fixture: Ravi submits a fresh Contract review Request; Legal converts it and uploads the primary Document (API stand-ins for the Portal form, the Inbox conversion and the Legal upload).",
  async () => {
    const stamp = Date.now().toString().slice(-6);
    const users = (await api(D, "GET", "/users")).json.users;
    const rt = (await api(D, "GET", "/portal/request-types/contract_review")).json;
    const sales = rt.departments.find((d) => d.displayName === "Sales").id;
    const rq = await api(R, "POST", "/requests", {
      requestTypeId: rt.requestType.id,
      departmentId: sales,
      title: `DOC-029 roles Ravi request ${stamp}`,
      description: "DOC-029 roles fictional ask from Ravi.",
      urgency: "medium",
    });
    check(rq.status === 201, `request ${rq.status}`);
    const nda = (await api(D, "GET", "/contract-types")).json.contractTypes.find(
      (t) => t.displayName === "NDA",
    ).id;
    const cv = await api(N, "POST", `/requests/${rq.json.request.number}/convert`, {
      title: `DOC-029 roles Ravi converted contract ${stamp}`,
      contractTypeId: nda,
    });
    check(cv.status === 200, `convert ${cv.status}`);
    CR = cv.json.request.convertedRecord.number;
    const res = await N.request.post(`${BASE}/api/v1/contracts/${CR}/documents`, {
      headers: { origin: BASE },
      multipart: {
        file: {
          name: "doc029-roles-supporting-v1.txt",
          mimeType: "text/plain",
          buffer: readFileSync(path.join(here, "fixtures", "doc029-roles-supporting-v1.txt")),
        },
      },
    });
    const doc = (await res.json()).document;
    raviPrimary = { id: doc.id, v1: doc.versions[0].id };
    results.fixtures.raviContract = `C-${CR} from R-${rq.json.request.number}`;
    return `Ravi submitted R-${rq.json.request.number}; Nadia converted it to C-${CR} and uploaded doc029-roles-supporting-v1.txt (primary: ${doc.isPrimary}).`;
  },
);

await step(
  CG,
  "business_user",
  "G1.before-start",
  "Before Legal adds Ravi, the Matter is absent and refused. After Legal adds him, he selects Matters in the Portal navigation, chooses the record, and checks title and M- reference. A link or related record does not grant access.",
  async () => {
    const before = await openRecord(R, `/portal/matters/${MR}`);
    await go(N, `/matters/${MR}`);
    await addTeamMember(N, "Matter team", "Ravi Menon");
    await go(R, "/portal");
    await R.getByRole("navigation", { name: "Portal" })
      .getByRole("link", { name: "Matters" })
      .click();
    await settle(R);
    await revealLink(R, "DOC-029 roles Ravi matter");
    await R.getByRole("link", { name: "DOC-029 roles Ravi matter" }).click();
    await settle(R);
    const title = await h1(R);
    const main = await R.getByRole("main").innerText();
    const comparable = await openRecord(R, `/portal/matters/${MO}`);
    check(
      /not found/.test(before.title) &&
        title === "DOC-029 roles Ravi matter" &&
        main.includes(`M-${MR}`) &&
        /not found/.test(comparable.title),
      `${before.title} ${title}`,
    );
    return `Before: "${before.title}". After Nadia added Ravi, Portal > Matters listed it; the record showed "${title}" and M-${MR}. The comparable M-${MO} showed "${comparable.title}".`;
  },
);

await step(
  CG,
  "business_user",
  "G2.find-search",
  "Enter a title or reference in Search and press Enter or select Search. Contract search also matches the primary Counterparty.",
  async () => {
    const cp = await api(N, "POST", `/contracts/${CR}/counterparties`, {
      name: "DOC-029 Roles Fictional Supplier Ltd",
    });
    await go(R, "/portal/matters");
    const box = R.getByRole("searchbox", { name: "Search Matters" });
    await box.fill("DOC-029 roles Ravi");
    await box.press("Enter");
    await settle(R);
    const byTitle = await R.getByRole("table").innerText();
    const url1 = R.url();
    await box.fill(`M-${MR}`);
    await R.getByRole("search", { name: "Search Matters" })
      .getByRole("button", { name: "Search", exact: true })
      .click();
    await settle(R);
    const byRef = await R.getByRole("table").innerText();
    await go(R, "/portal/contracts");
    const cbox = R.getByRole("searchbox", { name: "Search Contracts" });
    await cbox.fill("Roles Fictional Supplier");
    await cbox.press("Enter");
    await settle(R);
    const byCp = await R.getByRole("table").innerText();
    check(
      byTitle.includes(`M-${MR}`) &&
        byRef.includes(`M-${MR}`) &&
        byCp.includes(`C-${CR}`) &&
        !byRef.includes("paging"),
      `${byTitle} / ${byRef} / ${byCp}`,
    );
    return `Search "DOC-029 roles Ravi" + Enter listed M-${MR} (address ${new URL(url1).search}); "M-${MR}" + Search listed only M-${MR}; Contracts search "Roles Fictional Supplier" listed C-${CR} by its primary Counterparty (added by Legal, ${cp.status}).`;
  },
);

await step(
  CG,
  "business_user",
  "G3.filter",
  "Select Filter, choose a property and value, select Apply. Contracts offer Stage, Type, Legal Owner and Expiry date; Matters offer Status, Type, Matter Manager and open or closed lifecycle. Filters combine with search; remove a chip or Clear all.",
  async () => {
    await go(R, "/portal/contracts");
    await R.getByRole("button", { name: "Filter", exact: true }).click();
    const cprops = (
      await R.getByRole("dialog", { name: "Filter" }).getByRole("button").allInnerTexts()
    ).map((s) => s.trim());
    await R.keyboard.press("Escape");
    await go(R, "/portal/matters");
    await R.getByRole("button", { name: "Filter", exact: true }).click();
    const fd = R.getByRole("dialog", { name: "Filter" });
    const mprops = (await fd.getByRole("button").allInnerTexts()).map((s) => s.trim());
    await fd.getByRole("button", { name: "Lifecycle" }).click();
    await sleep(500);
    const lifeChoices = (await R.getByRole("dialog").last().innerText()).replace(/\s+/g, " ");
    await R.getByRole("dialog").last().getByText("Open", { exact: true }).first().click();
    await R.getByRole("dialog").last().getByRole("button", { name: "Apply" }).click();
    await settle(R);
    const box = R.getByRole("searchbox", { name: "Search Matters" });
    await box.fill("DOC-029 roles");
    await box.press("Enter");
    await settle(R);
    const status = await R.getByRole("status").first().innerText();
    const chips = await R.getByRole("button", { name: /Remove .* filter/ }).count();
    const url = new URL(R.url()).search;
    await R.getByRole("button", { name: "Clear all" }).click();
    await settle(R);
    const cleared = await R.getByRole("button", { name: /Remove .* filter/ }).count();
    check(
      ["Type", "Legal Owner", "Stage", "Expiry date"].every((p) => cprops.includes(p)) &&
        ["Type", "Matter Manager", "Status", "Lifecycle"].every((p) => mprops.includes(p)) &&
        chips === 1 &&
        cleared === 0,
      `${cprops} / ${mprops} / chips ${chips}`,
    );
    return `Contracts Filter offered ${cprops.join(", ")}; Matters Filter offered ${mprops.join(", ")}. Lifecycle choices: "${lifeChoices.slice(0, 80)}". Lifecycle Open plus search "DOC-029 roles" showed "${status}" with one filter chip (address ${url}). Clear all removed the chip.`;
  },
);

await step(
  CG,
  "business_user",
  "G4.sort-columns-more-back",
  "Heading sort cycles ascending, descending, default. Columns chooses and reorders columns; a heading edge resizes. Show more adds the next page. Search, filters and sort stay in the address for Back and bookmarks.",
  async () => {
    await go(R, "/portal/matters");
    const firstStatus = await R.getByRole("status").first().innerText();
    const rowsBefore = await R.getByRole("table").getByRole("row").count();
    await R.getByRole("button", { name: "Show more" }).click();
    await settle(R);
    const rowsAfter = await R.getByRole("table").getByRole("row").count();
    const heading = R.getByRole("columnheader", { name: "Title" }).getByRole("button", {
      name: "Title",
    });
    await heading.click();
    await settle(R);
    const s1 = new URL(R.url()).search;
    const a1 = await R.getByRole("columnheader", { name: "Title" }).getAttribute("aria-sort");
    await heading.click();
    await settle(R);
    const s2 = new URL(R.url()).search;
    const a2 = await R.getByRole("columnheader", { name: "Title" }).getAttribute("aria-sort");
    await heading.click();
    await settle(R);
    const s3 = new URL(R.url()).search;
    await heading.click();
    await heading.click();
    await settle(R);
    const bookmarked = R.url();
    await revealLink(R, "DOC-029 roles Ravi matter");
    await R.getByRole("link", { name: "DOC-029 roles Ravi matter" }).click();
    await settle(R);
    await R.goBack();
    await settle(R);
    const back = R.url();
    await R.getByRole("button", { name: "Columns" }).click();
    await sleep(500);
    const colMenu = R.getByRole("dialog").or(R.getByRole("menu")).last();
    const colText = (await colMenu.innerText()).replace(/\s+/g, " ");
    await R.keyboard.press("Escape");
    const sep = R.getByRole("separator", { name: "Width of the Reference column" });
    const box = await R.getByRole("columnheader", { name: "Reference" }).boundingBox();
    const sb = await sep.boundingBox();
    // Grab the handle inside the Reference heading; the right half of the 9px strip sits under the next heading.
    await R.mouse.move(sb.x + 2, sb.y + sb.height / 2);
    await R.mouse.down();
    await R.mouse.move(sb.x + 60, sb.y + sb.height / 2, { steps: 6 });
    await R.mouse.move(sb.x + 120, sb.y + sb.height / 2, { steps: 6 });
    await R.mouse.up();
    await sleep(500);
    const box2 = await R.getByRole("columnheader", { name: "Reference" }).boundingBox();
    await sep.focus();
    await R.keyboard.press("Home");
    await sleep(400);
    const box3 = await R.getByRole("columnheader", { name: "Reference" }).boundingBox();
    await go(R, bookmarked.replace(BASE, ""));
    const reopened = await R.getByRole("columnheader", { name: "Title" }).getAttribute("aria-sort");
    check(
      rowsAfter > rowsBefore &&
        /sort=/.test(s1) &&
        /sort=/.test(s2) &&
        !/sort=/.test(s3) &&
        back === bookmarked &&
        Math.abs(box2.width - box.width) > 40,
      JSON.stringify({
        rowsBefore,
        rowsAfter,
        s1,
        s2,
        s3,
        back,
        bookmarked,
        w1: box.width,
        w2: box2.width,
      }),
    );
    return `Your Matters first showed "${firstStatus}" (${rowsBefore - 1} rows); Show more raised it to ${rowsAfter - 1} rows. Title heading: ${a1} (${s1}), ${a2} (${s2}), then default (${s3 || "no query"}). Back from a record returned to ${new URL(back).search}, and opening that address again kept aria-sort ${reopened}. Columns showed "${colText.slice(0, 160)}". Dragging the Reference heading edge changed its width from ${Math.round(box.width)} to ${Math.round(box2.width)} px; Home on the handle returned it to ${Math.round(box3.width)} px.`;
  },
);

await step(
  CG,
  "business_user",
  "G5.read-record",
  "Record details and Fields show current full-app values; Contracts and Matters both show Department and Region; a Contract shows Overview with Value and dates. Business Fields and Description are read-only; Legal's change appears on reload. Original request is read-only and does not change when Legal edits the live Description.",
  async () => {
    await go(R, `/portal/matters/${MR}`);
    const mMain = await R.getByRole("main").innerText();
    await go(R, `/portal/contracts/${CR}`);
    const overview = await R.getByRole("region", { name: "Overview" }).innerText();
    const fields = R.getByRole("region", { name: "Fields" });
    const editable = await R.getByRole("main")
      .locator(
        "input:not([type=file]):not([type=search]), textarea, select, [contenteditable=true]",
      )
      .evaluateAll((els) =>
        els
          .filter(
            (e) =>
              !e.closest("[role=search]") &&
              e.getAttribute("aria-label") !== "Search Documents" &&
              !e.closest("form[role=search]"),
          )
          .map((e) => e.getAttribute("aria-label") ?? e.tagName),
      );
    await go(N, `/contracts/${CR}`);
    await h1(N);
    const desc = N.getByRole("textbox", { name: "Description" });
    await desc.fill("DOC-029 roles description updated by Legal.");
    await desc.blur();
    await settle(N);
    await sleep(1500);
    await R.reload();
    await settle(R);
    const fieldsAfter = await fields.innerText();
    const main = (await R.getByRole("main").innerText()).replace(/\s+/g, " ");
    const original = main.slice(main.indexOf("Original request"));
    const history = (await (await applet(R, "History")).innerText()).replace(/\s+/g, " ");
    check(
      /Department/.test(mMain) &&
        /Region/.test(mMain) &&
        /Department/.test(overview) &&
        /Region/.test(overview) &&
        /Value/.test(overview) &&
        /Effective date/.test(overview) &&
        fieldsAfter.includes("DOC-029 roles description updated by Legal.") &&
        original.includes("DOC-029 roles fictional ask from Ravi.") &&
        editable.length === 0,
      JSON.stringify({ editable, fieldsAfter, history }),
    );
    return `M-${MR} details showed Department and Region. C-${CR} Overview: "${overview.replace(/\s+/g, " ").slice(0, 200)}". No editable value controls in the record body (${editable.length}). After Nadia changed the Description in the full app, Ravi's reload showed it under Fields, while Original request still read "${original.slice(0, 160)}". Portal History read "${history.slice(0, 160)}" (the History claim is scored in roles-and-access D6b).`;
  },
);

await step(
  CG,
  "business_user",
  "G6.documents-read",
  "Documents lists the Primary Document first with current Version, kind, uploader and date; the name opens a preview (processing may finish after upload); the download control downloads.",
  async () => {
    const pdf = await N.request.post(`${BASE}/api/v1/contracts/${CR}/documents`, {
      headers: { origin: BASE },
      multipart: {
        file: {
          name: "doc029-roles-preview.pdf",
          mimeType: "application/pdf",
          buffer: readFileSync(path.join(here, "fixtures", "doc029-roles-preview.pdf")),
        },
      },
    });
    check(pdf.status() === 201, `pdf upload ${pdf.status()}`);
    await go(R, `/portal/contracts/${CR}`);
    const region = R.getByRole("region", { name: "Documents" });
    const rows = (await region.getByRole("listitem").allInnerTexts()).map((t) =>
      t.replace(/\s+/g, " "),
    );
    let previewText = "";
    for (let i = 0; i < 12; i++) {
      await region.getByRole("button", { name: "doc029-roles-preview.pdf" }).first().click();
      const viewer = R.getByRole("complementary", { name: /doc029-roles-preview.pdf/ });
      await viewer.waitFor({ timeout: 15000 });
      await sleep(3000);
      previewText = (await viewer.innerText()).replace(/\s+/g, " ");
      const rendered =
        (await viewer.locator("canvas, img, iframe, embed, object").count()) +
        (/DOC-029 roles fictional preview paper/.test(previewText) ? 1 : 0);
      if (rendered && !/Preparing|processing/i.test(previewText)) break;
      await viewer.getByRole("button", { name: "Close the document" }).click();
      await sleep(5000);
      await R.reload();
      await settle(R);
    }
    await R.screenshot({ path: path.join(here, "r1-portal-preview.png") });
    const viewer = R.getByRole("complementary", { name: /doc029-roles-preview.pdf/ });
    const shape = await viewer.locator("canvas, img, iframe, embed, object").count();
    await viewer.getByRole("button", { name: "Close the document" }).click();
    const href = await region
      .getByRole("link", { name: /Download doc029-roles-supporting-v1.txt, version 1/ })
      .getAttribute("href");
    const dl = await R.request.get(new URL(href, BASE).toString());
    check(
      /^Primary Document doc029-roles-supporting-v1.txt Version 1 .*Nadia Haddad/.test(rows[0]) &&
        dl.status() === 200 &&
        shape > 0,
      JSON.stringify({ rows, shape, previewText }),
    );
    return `First row: "${rows[0].slice(0, 140)}". Selecting doc029-roles-preview.pdf opened its viewer panel ("${previewText.slice(0, 100)}", ${shape} rendered page element(s)); see r1-portal-preview.png. The download control answered ${dl.status()}.`;
  },
);

await step(
  CG,
  "business_user",
  "G7.upload-new-documents",
  "Select Upload documents, choose New documents under Add as, choose Kind and optional Note, select Upload. Kind and Note apply to every file. Successful files stay if another fails; Retry failed uploads retries only the failures.",
  async () => {
    await go(R, `/portal/contracts/${CR}`);
    let failedOnce = false;
    let posts = 0;
    await R.route(`**/api/v1/contracts/${CR}/documents`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      posts++;
      const body = route.request().postDataBuffer()?.toString("latin1") ?? "";
      if (!failedOnce && body.includes("doc029-roles-confidential-note.txt")) {
        failedOnce = true;
        return route.fulfill({
          status: 503,
          contentType: "application/problem+json",
          body: JSON.stringify({
            title: "Injected failure",
            status: 503,
            detail: "DOC-029 injected upload failure.",
          }),
        });
      }
      return route.continue();
    });
    await R.getByRole("button", { name: "Upload documents" }).click();
    const dialog = R.getByRole("dialog", { name: "Upload documents" });
    await dialog.waitFor();
    const addAs = await dialog
      .getByRole("combobox", { name: "Add as" })
      .locator("option")
      .allInnerTexts();
    await dialog.getByRole("combobox", { name: "Add as" }).selectOption({ label: "New documents" });
    await dialog
      .locator("input[type=file]")
      .setInputFiles([
        path.join(here, "fixtures", "doc029-roles-business-upload.txt"),
        path.join(here, "fixtures", "doc029-roles-confidential-note.txt"),
      ]);
    const kinds = await dialog
      .getByRole("combobox", { name: "Kind" })
      .locator("option")
      .allInnerTexts();
    await dialog.getByRole("combobox", { name: "Kind" }).selectOption({ index: 0 });
    await dialog
      .getByRole("textbox", { name: "Note (optional)" })
      .fill("DOC-029 roles business note");
    await dialog.getByRole("button", { name: "Upload", exact: true }).click();
    await dialog.getByRole("button", { name: "Retry failed uploads" }).waitFor({ timeout: 20000 });
    const mid = (await dialog.innerText()).replace(/\s+/g, " ");
    await dialog.getByRole("button", { name: "Retry failed uploads" }).click();
    await dialog.waitFor({ state: "hidden", timeout: 20000 });
    await R.unroute(`**/api/v1/contracts/${CR}/documents`);
    await settle(R);
    const docs = await api(R, "GET", `/portal/contracts/${CR}/documents`);
    const list = docs.json.documents ?? docs.json.items ?? [];
    const names = list.map((d) => d.title);
    const uploads = list.filter((d) => /business-upload|confidential-note/.test(d.title));
    const text = (await R.getByRole("region", { name: "Documents" }).innerText()).replace(
      /\s+/g,
      " ",
    );
    check(
      posts === 3 &&
        names.filter((n) => n === "doc029-roles-business-upload.txt").length === 1 &&
        uploads.length === 2 &&
        /^Primary Document/.test(
          (
            await R.getByRole("region", { name: "Documents" })
              .getByRole("listitem")
              .first()
              .innerText()
          ).trim(),
        ) &&
        uploads.every((d) => d.versions[0].note === "DOC-029 roles business note"),
      JSON.stringify({ posts, names, notes: uploads.map((d) => d.versions[0].note) }),
    );
    return `Add as offered: ${addAs.join(", ")}. Kind offered ${kinds.length} kinds. With one upload failure injected by the reviewer's browser route, the dialog showed "${mid.slice(0, 220)}". Retry failed uploads sent only the failed file (${posts} POSTs in total). Both Documents exist once, each with the note. Documents now read: "${text.slice(0, 180)}".`;
  },
);

await step(
  CG,
  "business_user",
  "G8.add-version-signed-copy",
  "Add version opens the dialog with that Document selected and takes one file; it works on the primary Contract Document. Earlier versions expand; Signed copy marks the Version Legal pinned. Uploading a Version changes neither designation.",
  async () => {
    const pin = await api(N, "PUT", `/documents/${raviPrimary.id}/executed-version`, {
      versionId: raviPrimary.v1,
    });
    const pin2 =
      pin.status >= 400
        ? await api(N, "POST", `/documents/${raviPrimary.id}/executed-version`, {
            versionId: raviPrimary.v1,
          })
        : pin;
    await go(R, `/portal/contracts/${CR}`);
    const region = R.getByRole("region", { name: "Documents" });
    const row = region
      .getByRole("listitem")
      .filter({ hasText: "doc029-roles-supporting-v1.txt" })
      .first();
    const hadHistory = await row.getByRole("button", { name: /earlier version/ }).count();
    await row.getByRole("button", { name: "Add version" }).click();
    const dialog = R.getByRole("dialog", { name: "Upload documents" });
    await dialog.waitFor();
    const selected = await dialog
      .getByRole("combobox", { name: "Add as" })
      .evaluate((s) => s.options[s.selectedIndex].text);
    const multiple = await dialog.locator("input[type=file]").getAttribute("multiple");
    await dialog
      .locator("input[type=file]")
      .setInputFiles(path.join(here, "fixtures", "doc029-roles-supporting-v2.txt"));
    await dialog.getByRole("button", { name: "Upload", exact: true }).click();
    await dialog.waitFor({ state: "hidden", timeout: 20000 });
    await settle(R);
    const row2 = region
      .getByRole("listitem")
      .filter({ hasText: "doc029-roles-supporting" })
      .first();
    await row2.getByRole("button", { name: /1 earlier version/ }).click();
    await sleep(500);
    const text = (await row2.innerText()).replace(/\s+/g, " ");
    const first = (await region.getByRole("listitem").first().innerText()).replace(/\s+/g, " ");
    check(
      hadHistory === 0 &&
        /New version of/.test(selected) &&
        multiple === null &&
        /Version 2/.test(text) &&
        /Signed copy/.test(text) &&
        /^Primary Document/.test(first) &&
        /Primary Document/.test(text),
      JSON.stringify({ hadHistory, selected, multiple, text, first }),
    );
    return `Legal pinned Version 1 as the signed copy (API stand-in, ${pin2.status}). Before, the one-Version Document had no earlier versions control. Add version opened Upload documents with "${selected}" and a single-file input. After upload the row read "${text.slice(0, 260)}". The first row is still the Primary Document.`;
  },
);

await step(
  CG,
  "business_user",
  "G9.drop-and-no-folders",
  "Files can be dropped onto Documents; Business Users cannot manage folders or archive paper.",
  async () => {
    await go(R, `/portal/contracts/${CR}`);
    const region = R.getByRole("region", { name: "Documents" });
    const target = region.getByRole("button", { name: "Drop files here or click to upload" });
    const dt = await R.evaluateHandle(() => {
      const d = new DataTransfer();
      d.items.add(
        new File(["DOC-029 roles dropped paper"], "doc029-roles-dropped.txt", {
          type: "text/plain",
        }),
      );
      return d;
    });
    await target.dispatchEvent("dragover", { dataTransfer: dt });
    await target.dispatchEvent("drop", { dataTransfer: dt });
    const dialog = R.getByRole("dialog", { name: "Upload documents" });
    await dialog.waitFor({ timeout: 10000 });
    const listed = (await dialog.innerText()).includes("doc029-roles-dropped.txt");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    const all = (await region.innerText()).replace(/\s+/g, " ");
    const forbidden = ["New folder", "Folder", "Archive", "Move"].filter((w) =>
      new RegExp(`\\b${w}\\b`).test(all),
    );
    check(listed && forbidden.length === 0, `${listed} ${forbidden}`);
    return `Dropping doc029-roles-dropped.txt on "Drop files here or click to upload" opened Upload documents with the file listed (cancelled). No folder or archive controls in Documents.`;
  },
);

await step(
  CG,
  "business_user",
  "G10.search-documents",
  "Search Documents finds a Document by name or any Version's filename; Show more loads another page.",
  async () => {
    await go(R, `/portal/contracts/${CR}`);
    const region = R.getByRole("region", { name: "Documents" });
    await region.getByRole("textbox", { name: "Search Documents" }).fill("supporting-v1");
    await region.getByRole("button", { name: "Search", exact: true }).click();
    await settle(R);
    const byOld = (await region.innerText()).replace(/\s+/g, " ");
    await go(R, `/portal/matters/${DM}`);
    const dregion = R.getByRole("region", { name: "Documents" });
    const before = await dregion.getByRole("button", { name: /^doc029-roles-page-/ }).count();
    await dregion.getByRole("button", { name: "Show more" }).click();
    await settle(R);
    const after = await dregion.getByRole("button", { name: /^doc029-roles-page-/ }).count();
    await dregion.getByRole("textbox", { name: "Search Documents" }).fill("page-37");
    await dregion.getByRole("textbox", { name: "Search Documents" }).press("Enter");
    await settle(R);
    const byName = await dregion
      .getByRole("button", { name: /^doc029-roles-page-/ })
      .allInnerTexts();
    check(
      /doc029-roles-supporting-v1.txt/.test(byOld) &&
        /Version 2/.test(byOld) &&
        before === 50 &&
        after === 51 &&
        byName.length === 1,
      JSON.stringify({ before, after, byName }),
    );
    return `Searching "supporting-v1" (the Version 1 filename) listed the Document whose current Version is 2. On M-${DM}, Documents showed ${before} rows; Show more added the rest (${after}). Searching "page-37" listed ${byName.join(", ")}.`;
  },
);

await step(
  CG,
  "business_user",
  "G11.comments",
  "Open Comments, write a reply, attach a file, select Comment; @ mentions people who can hear it; Comment actions edits or deletes own comment; unread badge clears after load; draft and attachments survive switching applets; no audience picker.",
  async () => {
    const tag = `DOC-029 roles ask ${Date.now().toString().slice(-6)}`;
    await api(N, "POST", "/comments", {
      entityType: "matter",
      entityId: fx.raviMatter.id,
      body: "DOC-029 roles Legal reply for Ravi",
      visibility: "full_thread",
    });
    await go(R, `/portal/matters/${MR}`);
    const toolbarBtn = R.getByRole("toolbar", { name: "Applets" }).getByRole("button", {
      name: /^Comments/,
    });
    const badgeBefore =
      (await toolbarBtn.innerText()).trim() +
      " " +
      ((await toolbarBtn.getAttribute("aria-label")) ?? "");
    const panel = await applet(R, "Comments");
    await sleep(1500);
    const pickers = await panel.getByRole("radio").count();
    const box = panel.getByRole("textbox", { name: "New comment" });
    await box.fill("DOC-029 roles draft kept ");
    await panel
      .locator("input[type=file]")
      .setInputFiles(path.join(here, "fixtures", "doc029-roles-business-upload.txt"));
    await applet(R, "History");
    await applet(R, "Comments");
    const switched = await panel.getByRole("textbox", { name: "New comment" }).inputValue();
    await panel.getByRole("button", { name: "Close" }).click();
    await panel.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await applet(R, "Comments");
    const kept = await panel.getByRole("textbox", { name: "New comment" }).inputValue();
    const keptFile = (await panel.innerText()).includes("doc029-roles-business-upload.txt");
    await R.goto(R.url());
    await settle(R);
    const badgeAfter = await R.getByRole("toolbar", { name: "Applets" })
      .getByRole("button", { name: /^Comments/ })
      .evaluate((b) => b.innerText + " " + (b.getAttribute("aria-label") ?? ""));
    const p2 = await applet(R, "Comments");
    const box2 = p2.getByRole("textbox", { name: "New comment" });
    const stillDraft = await box2.inputValue();
    await box2.fill("");
    await box2.pressSequentially(`${tag} @Nad`, { delay: 40 });
    const listbox = R.getByRole("listbox", { name: "People and files you can mention" });
    await listbox.waitFor({ timeout: 10000 });
    const mentionOptions = (await listbox.getByRole("option").allInnerTexts()).map((s) =>
      s.replace(/\s+/g, " "),
    );
    await listbox.getByRole("option").first().click();
    await p2
      .locator("input[type=file]")
      .setInputFiles(path.join(here, "fixtures", "doc029-roles-business-upload.txt"));
    await p2.getByRole("button", { name: "Comment", exact: true }).click();
    const mine = p2.getByRole("listitem").filter({ hasText: tag });
    await mine.waitFor({ timeout: 15000 });
    const posted = (await mine.innerText()).replace(/\s+/g, " ");
    await mine.getByRole("button", { name: "Comment actions" }).click();
    await R.getByRole("menuitem", { name: "Edit" }).click();
    const editor = p2.getByRole("textbox", { name: "Edit comment" });
    await editor.fill(`${tag} edited`);
    await p2.getByRole("button", { name: "Save" }).click();
    await p2.getByText(`${tag} edited`).waitFor({ timeout: 10000 });
    const edited = p2.getByRole("listitem").filter({ hasText: `${tag} edited` });
    await edited.getByRole("button", { name: "Comment actions" }).click();
    await R.getByRole("menuitem", { name: "Delete" }).click();
    const confirm = R.getByRole("dialog", { name: "Delete this comment?" });
    await confirm.getByRole("button", { name: "Delete" }).click();
    await sleep(1500);
    const final = (await p2.innerText()).replace(/\s+/g, " ");
    check(
      pickers === 0 &&
        switched.startsWith("DOC-029 roles draft kept") &&
        kept.startsWith("DOC-029 roles draft kept") &&
        keptFile &&
        posted.includes("doc029-roles-business-upload.txt") &&
        mentionOptions.some((o) => /Nadia/.test(o)) &&
        (!final.includes(`${tag} edited`) || /deleted/i.test(final)),
      JSON.stringify({
        pickers,
        kept,
        keptFile,
        posted,
        mentionOptions,
        final: final.slice(0, 200),
      }),
    );
    return `Comments badge before opening: "${badgeBefore}"; after the comments loaded and a reload: "${badgeAfter}". No audience picker (${pickers} radios). The draft stayed after switching to History and back, and the draft and its attachment stayed after closing and reopening Comments (a full reload ${stillDraft ? "also kept" : "did not keep"} the draft). Typing @Nad offered ${mentionOptions.join("; ")}. The posted reply read "${posted.slice(0, 160)}". Comment actions > Edit > Save changed it; Delete removed it ("${final.slice(0, 160)}").`;
  },
);

await step(
  CG,
  "business_user",
  "G11b.reply-tier-label",
  "Label check for the article text: your reply appears on the Contract or Matter at **Full thread**.",
  async () => {
    await go(R, `/portal/matters/${MR}`);
    const panel = await applet(R, "Comments");
    await sleep(1000);
    const text = (await panel.innerText()).replace(/\s+/g, " ");
    await R.screenshot({ path: path.join(here, "r1-portal-reply-tier-label.png") });
    const chips = [
      ...new Set(text.match(/Matter Team|Contract Team|Full thread|Full Thread/g) ?? []),
    ];
    check(
      /Full thread/.test(text),
      `Ravi's Portal Comments label each reply "${chips.join(", ")}" and the composer says "${(text.match(/Visible to[^.]*\./) ?? [""])[0]}"; the label Full thread does not appear. See r1-portal-reply-tier-label.png.`,
    );
    return `Portal Comments show ${chips.join(", ")}.`;
  },
);

await step(
  CG,
  "business_user",
  "G12.team-add",
  "Open Matter team, Add team member, choose an existing person, Add; existing members are excluded; for a Confidential record ask Legal; no Portal remove control.",
  async () => {
    await go(R, `/portal/matters/${MR}`);
    const { options } = await addTeamMember(R, "Matter team", "Amara Nwosu");
    const panel = await applet(R, "Matter team");
    const rows = await rosterRows(panel);
    const removes = await panel.getByRole("button", { name: /off the/ }).count();
    await go(N, `/matters/${MR}`);
    const legal = await rosterRows(await applet(N, "Matter team"));
    await removeTeamMember(N, "Matter team", "Amara Nwosu", "matter");
    await go(N, `/matters/${MC}`);
    await addTeamMember(N, "Matter team", "Ravi Menon");
    await go(R, `/portal/matters/${MC}`);
    const cpanel = await applet(R, "Matter team");
    const cadd = await cpanel.getByRole("button", { name: "Add team member" }).isEnabled();
    const cnote = (await cpanel.innerText()).replace(/\s+/g, " ");
    await go(N, `/matters/${MC}`);
    await removeTeamMember(N, "Matter team", "Ravi Menon", "matter");
    check(
      !options.includes("Ravi Menon") &&
        !options.includes("Nadia Haddad") &&
        legal.some((r) => r.includes("Amara Nwosu")) &&
        removes === 0 &&
        !cadd &&
        /Ask Legal/.test(cnote),
      JSON.stringify({ options, legal, removes, cadd, cnote }),
    );
    return `Picker excluded Ravi and Nadia; Ravi added Amara Nwosu, who appeared in the full-app Matter team (${legal.join(" | ")}); no Portal remove control. On Confidential M-${MC}, Add team member was disabled: "${cnote.slice(0, 120)}". Nadia removed Amara and Ravi afterwards.`;
  },
);

await step(
  CG,
  "business_user",
  "G13.legal-limits",
  "Stage/Status moves, owners, parties, confidentiality, relationships, Tasks, Key dates, Approvals and signatures stay with Legal.",
  async () => {
    const out = [];
    for (const url of [`/portal/contracts/${CR}`, `/portal/matters/${MR}`]) {
      await go(R, url);
      const main = await R.getByRole("main").innerText();
      const buttons = (await R.getByRole("main").getByRole("button").allInnerTexts())
        .map((s) => s.trim())
        .filter((b) => b && !/\.(txt|pdf)$/.test(b));
      const bad = buttons.filter((b) =>
        /move|Stage|Status|Owner|Confidential|Counterpart|Link|Task|Key date|Approv|Sign|Archive|Remove/i.test(
          b,
        ),
      );
      const switches = await R.getByRole("switch").count();
      out.push({
        url,
        bad,
        switches,
        sections: ["Tasks", "Key dates", "Approvals"].filter((w) => main.includes(w)),
      });
    }
    const write = await api(R, "PATCH", `/contracts/${CR}`, { title: "DOC-029 roles hijack" });
    check(
      out.every((o) => o.bad.length === 0 && o.switches === 0 && o.sections.length === 0) &&
        write.status >= 400,
      JSON.stringify(out),
    );
    return `Neither Portal record offered Stage or Status moves, owner, party, confidentiality or relationship controls, or Tasks, Key dates or Approvals sections. A direct record write answered ${write.status}.`;
  },
);

await step(
  CG,
  "business_user",
  "G14.close-archive-remove",
  "Closing a Matter does not remove Portal work; archiving removes the record from the Portal; removing Ravi's membership stops access.",
  async () => {
    const statuses = await api(D, "GET", "/matter-statuses");
    const closed = (statuses.json.matterStatuses ?? statuses.json.statuses ?? []).find(
      (s) => s.category === "closed" && !s.archivedAt,
    );
    const moved = await api(N, "PATCH", `/matters/${MR}`, {
      statusId: closed.id,
      closingNote: "DOC-029 roles fictional closing note.",
    });
    await go(R, "/portal/matters");
    const box = R.getByRole("searchbox", { name: "Search Matters" });
    await box.fill("DOC-029 roles Ravi");
    await box.press("Enter");
    await settle(R);
    const listClosed = await R.getByRole("main").innerText();
    const openClosed = await openRecord(R, `/portal/matters/${MR}`);
    const uploadClosed = await R.getByRole("button", { name: "Upload documents" })
      .isEnabled()
      .catch(() => false);
    const archived = await api(N, "POST", `/matters/${MR}/archive`, {});
    await go(R, "/portal/matters");
    const listArchived = await R.getByRole("main").innerText();
    const openArchived = await openRecord(R, `/portal/matters/${MR}`);
    const restored = await api(N, "POST", `/matters/${MR}/restore`, {});
    const reopened = await openRecord(R, `/portal/matters/${MR}`);
    const openStatus = (statuses.json.matterStatuses ?? []).find((st) => st.slug === "open");
    const reopenedStatus = await api(N, "PATCH", `/matters/${MR}`, {
      statusId: openStatus.id,
      confirmReopen: true,
    });
    await go(N, `/matters/${MR}`);
    await removeTeamMember(N, "Matter team", "Ravi Menon", "matter");
    await R.reload();
    await settle(R);
    const removed = /not found/.test(await h1(R));
    const docs = await api(R, "GET", `/portal/matters/${MR}/documents`);
    check(
      moved.status < 300 &&
        listClosed.includes(`M-${MR}`) &&
        !openClosed.refused &&
        uploadClosed &&
        !listArchived.includes("DOC-029 roles Ravi matter") &&
        /not found/.test(openArchived.title) &&
        !reopened.refused &&
        removed &&
        docs.status >= 400,
      JSON.stringify({
        moved: moved.status,
        openClosed,
        uploadClosed,
        openArchived,
        reopened,
        removed,
        docs: docs.status,
      }),
    );
    return `Legal moved M-${MR} to "${closed.displayName}" (API stand-in, ${moved.status}); Ravi still found and opened it with Upload documents enabled. After Legal archived it (${archived.status}) it left Your Matters and the link showed "${openArchived.title}". Legal restored it (${restored.status}) and Ravi opened it again; Legal then reopened it (${reopenedStatus.status}). After Nadia removed Ravi through Matter team, his reload showed Matter not found and the Documents read answered ${docs.status}.`;
  },
);

// Cleanup: archive the paging Matters so they leave the Portal and default lists.
await step(
  CG,
  "legal_team_member",
  "Z1.cleanup",
  "Fixture cleanup: archive the 25 paging Matters.",
  async () => {
    const codes = [];
    for (const m of fx.pagingMatters)
      codes.push((await api(N, "POST", `/matters/${m.number}/archive`, {})).status);
    return `Archive answered ${[...new Set(codes)].join(",")} for ${codes.length} paging Matters.`;
  },
);

await browser.close();
save();
const failed = results.steps.filter((s) => s.result !== "pass");
console.log(`done: ${results.steps.length - failed.length} pass, ${failed.length} fail`);
