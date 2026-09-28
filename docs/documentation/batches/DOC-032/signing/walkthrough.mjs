// DOC-032 independent walkthrough, group signing: manual-signing (V-C17-manual).
// Written by the DOC-032 independent walkthrough agent (signing) from the text of
// docs/user-guides/manual-signing.md. The agent did not write the guide. The pattern is
// the last passing script, docs/documentation/batches/DOC-030/signing-2/walkthrough.mjs,
// through its DOC-032 compat replay (compat-b/manual-signing-replay.mjs), which already
// pointed it at the work lab. Changes from that replay: the Signatures tab replaces the
// removed Approvals & signing region; a partially signed round (Add version with the
// Partially signed type, then the Partially signed Status); the Executed mark check at
// step 4; a Soft gate fixture for Move past approval, Cancel and Move anyway; the Delete
// version recovery for an Administrator and its absence for a Legal Team Member.
//
// Run from the worktree root against the shared work lab:
//   LAB_PASSWORD=... node docs/documentation/batches/DOC-032/signing/walkthrough.mjs
// Optional: ROLES=legal_team_member,administrator
// The seed password comes from the environment. The Business User's magic link is
// read from the lab Mailpit at run time and never written. The log holds no
// credentials, cookies, links or raw mail.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASE,
  PEOPLE,
  articleHash,
  closeBrowser,
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

const here = path.dirname(fileURLToPath(import.meta.url));

const ROLES = (process.env.ROLES ?? "legal_team_member,administrator").split(",");
const stamp = Date.now();
const G = "DOC-032 signing";
const REL = "docs/documentation/batches/DOC-032/signing";

const { results, step, save } = recorder(process.env.OUT ?? path.join(here, "walkthrough.json"), {
  kind: "independent-article-walkthrough-log",
  task: "DOC-032",
  group: "signing",
  issue: 1194,
  walkthroughReviewer: "DOC-032 independent walkthrough agent (signing)",
  reviewerKind: "agent",
  adaptedFrom: [
    "docs/documentation/batches/DOC-030/signing-2/walkthrough.mjs",
    "docs/documentation/batches/DOC-032/compat/compat-b/manual-signing-replay.mjs",
  ],
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
  articleHashes: { "manual-signing": articleHash("manual-signing") },
  selection: { articles: ["manual-signing"], roles: ROLES },
  stamp,
  records: [],
  screenshots: [],
});

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
// Jonas Weber's link budget is shared by many agents, so the Business User
// negative check uses Karim Aziz from the same seed, as DOC-030 signing-2 did.
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
    entry: `new magic link from the ${lab.name} Mailpit, Portal sign-in`,
  },
];

// ---------- shared page helpers ----------
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
const stageButton = (page) => page.getByRole("button", { name: /— move contract$/ });
/** Open the Stage control, list its Statuses, pick one. Returns when saved or gated. */
async function stageMove(s, n, statusName) {
  const page = s.page;
  await stageButton(page).click();
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
const sections = (page) => page.getByRole("navigation", { name: "Contract sections" });
async function openSection(page, name, region) {
  await sections(page).getByRole("link", { name, exact: true }).click();
  await settle(page, region, `${name} section`);
  await sleep(600);
}
const docsCard = (page) => page.getByRole("region", { name: "Documents", exact: true });
const signaturesRegion = (page) => page.getByRole("region", { name: "Signatures", exact: true });
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
/** Open the earlier Versions of a Document if they are hidden. */
async function showEarlier(page, title) {
  const show = docsCard(page).getByRole("button", {
    name: new RegExp(
      `^Show the \\d+ earlier versions? of ${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
    ),
  });
  if (await show.count()) await show.click();
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(here, name) }).catch(() => {});
  results.screenshots.push(`${REL}/${name}`);
}
/** Add a Version to a Document through its Actions menu, optionally choosing a Type. */
async function addVersion(page, docTitle, f, typeLabel) {
  await menuPick(page, `Actions for ${docTitle}`, "Add version");
  const v = page.getByRole("dialog", { name: "Add version" });
  await v.waitFor();
  await chooseFile(page, v, f);
  const vType = v.getByLabel("Type", { exact: true });
  const offered = await optionTexts(vType);
  if (typeLabel) await vType.selectOption({ label: typeLabel });
  await v.getByRole("button", { name: "Upload", exact: true }).click();
  await v.waitFor({ state: "hidden", timeout: 30000 });
  return offered;
}

// =====================================================================
// V-C17-manual  manual-signing
// =====================================================================
async function manualSigning(role, A, O) {
  const art = "manual-signing";
  const sc = "V-C17-manual";
  const page = A.page;
  const actors = [A.displayName];
  const title = `${G} ${sc} ${role} ${stamp}`;
  let number;
  const fname = (k) => `doc032-signing-${role}-${k}-${stamp}.pdf`;
  const bytes = {
    draft: pdf(`${G} ${role} draft ${stamp}`),
    partial: pdf(`${G} ${role} partly signed round ${stamp} signed by the first party`),
    executed: pdf(`${G} ${role} executed ${stamp} signed by both parties`),
    later: pdf(`${G} ${role} later round ${stamp}`),
    wrong: pdf(`${G} ${role} wrong file ${stamp}`),
    schedule: pdf(`${G} ${role} schedule ${stamp}`),
  };
  const file = (k) => ({ name: fname(k), mimeType: "application/pdf", buffer: bytes[k] });
  const docs = async () => (await A.api("GET", `/contracts/${number}/documents`)).json.documents;
  const chain = async () => (await docs()).find((x) => x.id === doc.id);
  const pinned = async () =>
    (await chain()).versions.filter((v) => v.isExecuted).map((v) => v.versionNumber);
  let doc; // the contract paper Document
  let docTitle;

  const ok = await step(
    art,
    sc,
    role,
    actors,
    "fixture (API)",
    "Prerequisite: an unarchived Contract the actor can reach, with Business User Karim Aziz on the team; the lab has no Signing connector",
    "The Contract exists in Draft; the lab reports Signing unconfigured",
    async () => {
      const r = await A.api("POST", "/contracts", {
        title,
        contractTypeId: typeId("MSA"),
        managerId: uid(A.displayName),
        customFields: {},
      });
      must(r.status === 201, `create ${r.status} ${q(r.json)}`);
      number = r.json.contract.number;
      const t = await A.api("POST", `/contracts/${number}/team`, { userId: uid(BU.name) });
      must(t.status < 300, `team ${t.status}`);
      results.records.push({
        article: art,
        role,
        purpose: "manual signing",
        reference: `C-${number}`,
        title,
      });
      const c = await getContract(A, number);
      const env = (await A.api("GET", `/contracts/${number}/envelopes`)).json;
      must(env.signingConfigured === false, `signingConfigured ${env.signingConfigured}`);
      return `C-${number} "${title}" (MSA) created by ${A.displayName}; Status ${c.statusName}; Karim Aziz added to the team. lab.json seed.signing = "${lab.seed.signing}"; envelopes read-back signingConfigured ${env.signingConfigured}.`;
    },
  );
  if (!ok) return;

  await step(
    art,
    sc,
    role,
    actors,
    "/contracts/{n}; Signatures",
    "Before you start: with no Signing connector the Contract's Signatures tab offers no Send for signature control. Hand off step 1: use the Stage control to choose the Signature Status Out for signature",
    "The Signatures tab shows no Send for signature; the Contract moves to Out for signature",
    async () => {
      await openContract(A, number);
      await openSection(page, "Signatures", signaturesRegion(page));
      const region = signaturesRegion(page);
      const regionText = tidy(await region.innerText());
      const send = await page.getByRole("button", { name: /Send for signature/ }).count();
      must(send === 0, `Send for signature controls ${send}`);
      const { items, gated } = await stageMove(A, number, "Out for signature");
      must(!gated, "a Soft gate opened on the way to Out for signature");
      const c = await getContract(A, number);
      must(
        c.statusName === "Out for signature" && c.stage === "signature",
        `status ${c.statusName}/${c.stage}`,
      );
      const pill = tidy(await stageButton(page).innerText());
      return `Signatures tab region read ${q(regionText)} with ${send} Send for signature controls. The Stage control menu listed ${items.length} Statuses: ${q(items.join(" | "))}; choosing Out for signature saved it with no gate; the control reads "${pill}"; read-back ${c.statusName}/${c.stage}.`;
    },
  );

  await step(
    art,
    sc,
    role,
    actors,
    "Documents",
    "Hand off step 2 (first Document): open Documents; there is no Document yet, so upload the unsigned paper as a new Document first",
    "One Document with v1",
    async () => {
      await openSection(
        page,
        "Documents",
        docsCard(page).getByRole("heading", { name: "Documents" }),
      );
      await docsCard(page).getByRole("button", { name: "Upload", exact: true }).click();
      const u = page.getByRole("dialog", { name: "Upload document" });
      await u.waitFor();
      await chooseFile(page, u, file("draft"));
      const upStart = await selectedText(u.getByLabel("Type", { exact: true }));
      await u.getByRole("button", { name: "Upload", exact: true }).click();
      await u.waitFor({ state: "hidden", timeout: 30000 });
      doc = await until(async () => (await docs())[0], "first Document");
      docTitle = doc.title;
      await rowOf(page, docTitle).waitFor();
      return `Upload document: Type started on "${upStart}"; the paper filed as Document "${docTitle}" with ${doc.versions.length} Version (1 Document).`;
    },
  );

  await step(
    art,
    sc,
    role,
    actors,
    "Documents; Stage control",
    "Partially signed rounds: file the partly signed round with Add version and the Partially signed type; move the Contract to the Partially signed Status in the Signature Stage; do not mark it as the executed copy",
    "v2 carries the Partially signed type and no Executed mark; the Contract reads Partially signed in the signature Stage; no Version carries the Executed pin",
    async () => {
      const offered = await addVersion(page, docTitle, file("partial"), "Partially signed");
      const d = await until(async () => {
        const x = await chain();
        return x.versions.length === 2 ? x : null;
      }, "version 2");
      const v2 = d.versions.find((x) => x.versionNumber === 2);
      const shown = await selectedText(
        page.getByLabel(`Type of version 2 of ${docTitle}`, { exact: true }),
      );
      const cell = await versionCell(rowOf(page, docTitle));
      must(offered.includes("Partially signed"), `Type options ${q(offered)}`);
      must(
        v2.documentType?.displayName === "Partially signed" && shown === "Partially signed",
        `v2 type ${v2.documentType?.displayName} shown ${shown}`,
      );
      must(
        d.versions.every((v) => !v.isExecuted) && cell === "v2",
        `pin ${q(d.versions.map((v) => v.isExecuted))} cell ${cell}`,
      );
      const { items, gated } = await stageMove(A, number, "Partially signed");
      must(!gated, "gate on Partially signed");
      const c = await getContract(A, number);
      must(
        c.statusName === "Partially signed" && c.stage === "signature",
        `status ${c.statusName}/${c.stage}`,
      );
      const pill = tidy(await stageButton(page).innerText());
      return `Add version Type offered ${q(offered.join(", "))}; chose Partially signed and uploaded ${fname("partial")}. v2 on the same Document; Type column "${shown}"; Version cell "${cell}" (no Executed mark); isExecuted all false. The Stage control listed "Partially signed" among ${items.length} Statuses; choosing it saved with no gate; control reads "${pill}"; read-back ${c.statusName}/${c.stage}.`;
    },
  );

  await step(
    art,
    sc,
    role,
    actors,
    "Documents",
    "Hand off step 2: once signed, on the intended Document use Add version to upload the executed file (Type Executed)",
    "v3 on the same chain with the Executed type",
    async () => {
      const offered = await addVersion(page, docTitle, file("executed"), "Executed");
      const d = await until(async () => {
        const x = await chain();
        return x.versions.length === 3 ? x : null;
      }, "version 3");
      const v3 = d.versions.find((x) => x.versionNumber === 3);
      const shown = await selectedText(
        page.getByLabel(`Type of version 3 of ${docTitle}`, { exact: true }),
      );
      must(
        v3.documentType?.displayName === "Executed" && shown === "Executed" && v3.isCurrent,
        `v3 ${v3.documentType?.displayName} ${shown} current ${v3.isCurrent}`,
      );
      return `Actions -> Add version: Type offered ${q(offered.join(", "))}; chose Executed and uploaded ${fname("executed")}. Read-back: ${d.versions.length} Versions on Document "${docTitle}"; v3 current, type ${v3.documentType?.displayName}; the Type column reads "${shown}".`;
    },
  );

  await step(
    art,
    sc,
    role,
    actors,
    "Documents reader",
    "Hand off step 3: read or download the uploaded Document Version and check that it is the intended executed copy",
    "The reader opens version 3 and Download returns the exact uploaded bytes",
    async () => {
      await docsCard(page).getByRole("button", { name: docTitle, exact: true }).click();
      const reader = page.getByRole("complementary", { name: `${docTitle}, version 3` });
      await reader.waitFor({ timeout: 30000 });
      let rendered = false;
      let download;
      try {
        rendered = await reader
          .getByText(`${G} ${role} executed ${stamp} signed by both parties`)
          .waitFor({ timeout: 30000 })
          .then(
            () => true,
            () => false,
          );
        [download] = await Promise.all([
          page.waitForEvent("download"),
          reader.getByRole("link", { name: "Download" }).click(),
        ]);
      } finally {
        await reader
          .getByRole("button", { name: "Close the document" })
          .click()
          .catch(() => {});
        await reader.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
      }
      const body = readFileSync(await download.path());
      must(sha(body) === sha(bytes.executed), `download sha ${sha(body)}`);
      return `Selecting "${docTitle}" opened the reader "${docTitle}, version 3"; the executed text ${rendered ? "rendered" : "did not render within 30 s"}. Download saved ${download.suggestedFilename()} with SHA-256 equal to the uploaded executed file (${sha(bytes.executed).slice(0, 16)}...).`;
    },
  );

  await step(
    art,
    sc,
    role,
    actors,
    "Documents",
    "Negative: choosing the Executed type during upload does not set the Executed pin; the Type column can read Executed while the Version number shows no Executed mark",
    "No Version carries the pin; the Version cell reads v3 with no Executed mark while the Type column reads Executed",
    async () => {
      const d = await chain();
      const cell = await versionCell(rowOf(page, docTitle));
      const typeShown = await selectedText(
        page.getByLabel(`Type of version 3 of ${docTitle}`, { exact: true }),
      );
      must(
        d.versions.every((v) => !v.isExecuted) && cell === "v3" && typeShown === "Executed",
        `executed ${q(d.versions.map((v) => v.isExecuted))} cell "${cell}" type ${typeShown}`,
      );
      return `Read-back isExecuted: ${d.versions.map((v) => `v${v.versionNumber}=${v.isExecuted}`).join(", ")}. The Type column reads "${typeShown}" while the Version cell reads "${cell}" with no Executed mark.`;
    },
  );

  await step(
    art,
    sc,
    role,
    actors,
    "Documents",
    "Hand off step 4: open the Document's actions, select Mark as executed copy, check that Executed appears beside the Version number; with several Documents, check the paper is the primary Document",
    "v3 carries the Executed pin and its cell reads v3 Executed; the Status does not change; after a second Document is uploaded the paper keeps Primary",
    async () => {
      const items = await menuPick(page, `Actions for ${docTitle}`, "Mark as executed copy");
      await until(async () => {
        const e = await pinned();
        return e.length === 1 && e[0] === 3;
      }, "v3 executed");
      const row = rowOf(page, docTitle);
      await until(
        async () => /Executed/.test(await versionCell(row)),
        "Version cell shows Executed",
        10000,
      );
      const cell = await versionCell(row);
      if (role === "legal_team_member") await shot(page, "manual-signing-executed-pin.png");
      await docsCard(page).getByRole("button", { name: "Upload", exact: true }).click();
      const u = page.getByRole("dialog", { name: "Upload document" });
      await u.waitFor();
      await chooseFile(page, u, file("schedule"));
      await u.getByRole("button", { name: "Upload", exact: true }).click();
      await u.waitFor({ state: "hidden", timeout: 30000 });
      const all = await until(async () => {
        const x = await docs();
        return x.length === 2 ? x : null;
      }, "two Documents");
      const paper = all.find((x) => x.id === doc.id);
      const other = all.find((x) => x.id !== doc.id);
      await rowOf(page, other.title).waitFor();
      const paperName = tidy(await rowOf(page, docTitle).locator("td").first().innerText());
      const otherName = tidy(await rowOf(page, other.title).locator("td").first().innerText());
      const status = (await getContract(A, number)).statusName;
      must(cell === "v3 Executed", `cell "${cell}"`);
      must(
        paper.isPrimary &&
          !other.isPrimary &&
          /Primary/.test(paperName) &&
          !/Primary/.test(otherName),
        `primary ${paper.isPrimary}/${other.isPrimary} names "${paperName}" "${otherName}"`,
      );
      must(status === "Partially signed", `status ${status}`);
      return `Actions for ${docTitle} offered ${q(items.join(", "))}; Mark as executed copy set the pin on v3; the Version cell reads "${cell}". After a second Document "${other.title}" was uploaded, the rows read "${paperName}" and "${otherName}": the contract paper keeps Primary. Status still ${status} (marking did not change it).`;
    },
  );

  await step(
    art,
    sc,
    role,
    actors,
    "Documents",
    "Correct the wrong selection: Add version for a new round (the later upload becomes current while the pin stays); mark the correct Version (moves the pin); use the earlier Version's own actions to Mark, Unmark as executed copy and Mark again",
    "v4 becomes current while v3 stays pinned; marking v4 moves the pin; v3's own actions offer Mark / Unmark as executed copy",
    async () => {
      await addVersion(page, docTitle, file("later"));
      const d4 = await until(async () => {
        const x = await chain();
        return x.versions.length === 4 ? x : null;
      }, "version 4");
      const cur = d4.versions.find((x) => x.isCurrent).versionNumber;
      const exec = d4.versions.find((x) => x.isExecuted)?.versionNumber;
      must(cur === 4 && exec === 3, `current ${cur} executed ${exec}`);
      await menuPick(page, `Actions for ${docTitle}`, "Mark as executed copy");
      const moved = await until(async () => {
        const e = await pinned();
        return e.length === 1 && e[0] === 4 ? e : null;
      }, "pin on v4");
      await showEarlier(page, docTitle);
      await versionRowOf(page, 3, docTitle).waitFor();
      const i1 = await menuPick(
        page,
        `Actions for version 3 of ${docTitle}`,
        "Mark as executed copy",
      );
      await until(async () => {
        const e = await pinned();
        return e.length === 1 && e[0] === 3;
      }, "pin back on v3");
      await sleep(800);
      const i2 = await menuPick(
        page,
        `Actions for version 3 of ${docTitle}`,
        "Unmark as executed copy",
      );
      await until(async () => (await pinned()).length === 0, "unmarked");
      await sleep(800);
      const i3 = await menuPick(
        page,
        `Actions for version 3 of ${docTitle}`,
        "Mark as executed copy",
      );
      await until(async () => (await pinned())[0] === 3, "remarked");
      await sleep(500);
      const earlierCell = await versionCell(versionRowOf(page, 3, docTitle));
      const headCell = await versionCell(rowOf(page, docTitle));
      must(
        i1.includes("Mark as executed copy") && i2.includes("Unmark as executed copy"),
        `items ${q(i1)} ${q(i2)}`,
      );
      must(earlierCell === "v3 Executed" && headCell === "v4", `cells ${earlierCell} ${headCell}`);
      return `Add version filed ${fname("later")} as v4 on the same Document: v4 current, v3 still pinned. Mark as executed copy on the Document moved the pin to v${moved[0]}. Show the earlier versions -> v3's own actions offered ${q(i1.join(", "))}; Mark moved the pin back to v3; then ${q(i2.join(", "))} -> Unmark cleared it; then ${q(i3.join(", "))} -> Mark restored it. Version cells: head "${headCell}", earlier "${earlierCell}".`;
    },
  );

  // "If it does not work": wrong file uploaded and pinned, then recovery.
  if (role === "administrator") {
    await step(
      art,
      sc,
      role,
      actors,
      "Documents",
      "If it does not work: a wrong file was uploaded (and pinned). An Administrator removes that Version with Delete version (type delete, then Delete version); deleting the pinned Version clears the pin; mark the correct Version again",
      "The Delete version dialog names the Version; v5 goes, the other Versions stay, no Version carries the pin; marking v3 again restores the pin",
      async () => {
        await addVersion(page, docTitle, file("wrong"));
        await until(async () => (await chain()).versions.length === 5, "version 5");
        await menuPick(page, `Actions for ${docTitle}`, "Mark as executed copy");
        await until(async () => (await pinned())[0] === 5, "pin on v5");
        await sleep(600);
        const items = await menuPick(page, `Actions for ${docTitle}`, "Delete version");
        const dlg = page.getByRole("dialog", { name: "Delete version 5?" });
        await dlg.waitFor();
        const dlgText = tidy(await dlg.innerText());
        const submit = dlg.getByRole("button", {
          name: `Delete version 5 of ${docTitle}`,
          exact: true,
        });
        const disabledBefore = await submit.isDisabled();
        await dlg.getByLabel('Type "delete" to confirm').fill("delete");
        await submit.click();
        await dlg.waitFor({ state: "hidden", timeout: 20000 });
        const d = await until(async () => {
          const x = await chain();
          return x.versions.length === 4 ? x : null;
        }, "v5 removed");
        const after = d.versions.filter((v) => v.isExecuted).map((v) => v.versionNumber);
        const headAfter = d.versions.find((v) => v.isCurrent).versionNumber;
        await sleep(600);
        const headCell = await versionCell(rowOf(page, docTitle));
        must(after.length === 0, `pin after delete ${q(after)}`);
        await showEarlier(page, docTitle);
        await versionRowOf(page, 3, docTitle).waitFor();
        const vItems = await menuPick(
          page,
          `Actions for version 3 of ${docTitle}`,
          "Mark as executed copy",
        );
        await until(async () => (await pinned())[0] === 3, "pin on v3 again");
        await sleep(500);
        const cell3 = await versionCell(versionRowOf(page, 3, docTitle));
        must(
          disabledBefore &&
            items.includes("Delete version") &&
            vItems.includes("Delete version") &&
            cell3 === "v3 Executed",
          `disabled ${disabledBefore} items ${q(items)} v3 items ${q(vItems)} cell ${cell3}`,
        );
        await openContract(A, number);
        const hist = await history(page);
        await openContract(A, number, "documents");
        return `Add version filed ${fname("wrong")} as v5 and Mark as executed copy pinned it. Actions for ${docTitle} offered ${q(items.join(", "))}. Delete version opened ${q(dlgText)}; the Delete version button was disabled until "delete" was typed. After confirming, ${d.versions.length} Versions remain (${d.versions.map((v) => `v${v.versionNumber}`).join(", ")}), v${headAfter} is current and its cell reads "${headCell}"; no Version carries the Executed pin (${q(after)}). v3's own actions offered ${q(vItems.join(", "))}; Mark as executed copy restored the pin (cell "${cell3}"). History: ${q(hist.slice(0, 360))}.`;
      },
    );
  } else {
    await step(
      art,
      sc,
      role,
      actors,
      "Documents",
      "If it does not work (Legal Team Member): a wrong file was uploaded and pinned. Delete version is Administrator only, so it must not appear; correct the pin with the Version's own actions instead",
      "No Delete version item in the Document's or an earlier Version's actions; the API refuses the delete; v3 carries the pin again and v5 stays",
      async () => {
        await addVersion(page, docTitle, file("wrong"));
        await until(async () => (await chain()).versions.length === 5, "version 5");
        await menuPick(page, `Actions for ${docTitle}`, "Mark as executed copy");
        await until(async () => (await pinned())[0] === 5, "pin on v5");
        await sleep(600);
        const items = await menuPick(page, `Actions for ${docTitle}`, null);
        await showEarlier(page, docTitle);
        await versionRowOf(page, 3, docTitle).waitFor();
        const vItems = await menuPick(
          page,
          `Actions for version 3 of ${docTitle}`,
          "Mark as executed copy",
        );
        await until(async () => (await pinned())[0] === 3, "pin on v3 again");
        const v5 = (await chain()).versions.find((v) => v.versionNumber === 5);
        const api = await A.api("DELETE", `/documents/${doc.id}/versions/${v5.id}`, {
          confirmTitle: docTitle,
        });
        const d = await chain();
        must(
          !items.includes("Delete version") && !vItems.includes("Delete version"),
          `items ${q(items)} ${q(vItems)}`,
        );
        must(
          api.status === 403 && d.versions.length === 5,
          `delete ${api.status} versions ${d.versions.length}`,
        );
        await sleep(500);
        const cell3 = await versionCell(versionRowOf(page, 3, docTitle));
        return `Add version filed ${fname("wrong")} as v5 and Mark as executed copy pinned it. Actions for ${docTitle} offered ${q(items.join(", "))} (no Delete version). v3's own actions offered ${q(vItems.join(", "))} (no Delete version); Mark as executed copy moved the pin back to v3 (cell "${cell3}"). A direct DELETE of v5 as ${A.displayName} answered ${api.status}; ${d.versions.length} Versions remain.`;
      },
    );
  }

  await step(
    art,
    sc,
    role,
    actors,
    "/contracts/{n}; History; Signatures",
    "Hand off step 5: use the Stage control to choose the intended Active Status; if Move past approval appears, choose; check the Status and Activity. Manual hand-off creates no Envelope and the Signatures tab lists no signature request",
    "The Contract reaches Active without a connector; History records the pin and the Status change; Signatures lists no signature request",
    async () => {
      await openContract(A, number);
      const { gated, gate } = await stageMove(A, number, "Active");
      let gateNote =
        "Move past approval did not appear (no approvals; the move leaves the Signature Stage, which is past the approval line)";
      if (gated) {
        gateNote = `Move past approval appeared: ${q(await gate.innerText())}; Move anyway selected`;
        await gate.getByRole("button", { name: "Move anyway" }).click();
        await until(
          async () => (await getContract(A, number)).statusName === "Active",
          "Active after gate",
        );
      }
      await sleep(800);
      const pill = tidy(await stageButton(page).innerText());
      const hist = await history(page);
      const c = await getContract(A, number);
      await openSection(page, "Signatures", signaturesRegion(page));
      const sig = tidy(await signaturesRegion(page).innerText());
      const send = await page.getByRole("button", { name: /Send for signature/ }).count();
      const env = (await A.api("GET", `/contracts/${number}/envelopes`)).json.envelopes.length;
      must(c.statusName === "Active" && c.stage === "active", `status ${c.statusName} ${c.stage}`);
      must(/executed copy/i.test(hist) && /→ Active/.test(hist), `hist ${hist.slice(0, 400)}`);
      must(
        env === 0 && send === 0 && /No signature requests on this contract yet\./.test(sig),
        `env ${env} send ${send} sig ${sig}`,
      );
      return `Stage control moved C-${number} to Active; ${gateNote}. The control reads "${pill}"; read-back ${c.statusName}/${c.stage}. History: ${q(hist.slice(0, 420))}. Signatures tab: ${q(sig)}, ${send} Send for signature controls; ${env} Envelopes.`;
    },
  );

  await step(
    art,
    sc,
    role,
    [A.displayName, "Karim Aziz (Portal)"],
    "Portal and API; archived record",
    "Negative: a Business User on the team cannot perform the legal action; an archived record offers no legal actions and refuses a pin change; after Restore the pin is unchanged",
    "Karim Aziz sees no executed-copy control and the API refuses his write; the archived Contract shows no Document action menus and refuses a clear; v3 stays pinned",
    async () => {
      const bu = await business();
      await bu.page.goto(`${BASE}/portal/contracts/${number}`);
      await settle(bu.page, bu.page.getByRole("main"), "Portal record");
      await sleep(2500);
      const buText = tidy(await bu.page.getByRole("main").innerText());
      const buControls =
        (await bu.page.getByRole("menuitem", { name: /executed copy|Delete version/ }).count()) +
        (await bu.page.getByRole("button", { name: /executed copy/ }).count());
      const v4 = (await chain()).versions.find((x) => x.versionNumber === 4);
      const buApi = await bu.api("POST", `/documents/${doc.id}/executed-version`, {
        versionId: v4.id,
      });
      const a = await A.api("POST", `/contracts/${number}/archive`, {});
      must(a.status === 200, `archive ${a.status}`);
      await openContract(A, number, "documents");
      await sleep(1500);
      const actions = await page
        .getByRole("button", { name: `Actions for ${docTitle}`, exact: true })
        .count();
      const archApi = await A.api("DELETE", `/documents/${doc.id}/executed-version`);
      const rs = await A.api("POST", `/contracts/${number}/restore`, {});
      const still = await pinned();
      must(
        buControls === 0 &&
          buApi.status === 403 &&
          actions === 0 &&
          archApi.status === 409 &&
          rs.status === 200 &&
          still.length === 1 &&
          still[0] === 3,
        `bu ${buControls}/${buApi.status} archived ${actions}/${archApi.status} restore ${rs.status} still ${q(still)}`,
      );
      return `Karim Aziz in the Portal saw ${q(buText.slice(0, 140))} with ${buControls} executed-copy or Delete version controls; his direct pin of v4 answered ${buApi.status}. Archived C-${number} showed ${actions} "Actions for ${docTitle}" menus; clearing the pin answered ${archApi.status}. Restore answered ${rs.status}; v${still[0]} still carries the Executed pin.`;
    },
  );

  // Step 5's "If Move past approval appears", on its own fixture: a Contract with an
  // unresolved approval, walked through step 1 and step 5 of the guide.
  await step(
    art,
    sc,
    role,
    [A.displayName],
    "/contracts/{n} (gate fixture)",
    "Step 1 and step 5 with an unresolved approval: where Move past approval appears, select Cancel once, then Move anyway",
    "Move past approval offers Move anyway and Cancel; Cancel leaves the Status; Move anyway saves it",
    async () => {
      const gt = `${G} ${sc} gate ${role} ${stamp}`;
      const r = await A.api("POST", "/contracts", {
        title: gt,
        contractTypeId: typeId("MSA"),
        managerId: uid(A.displayName),
        customFields: {},
      });
      must(r.status === 201, `create ${r.status}`);
      const n = r.json.contract.number;
      results.records.push({
        article: art,
        role,
        purpose: "Soft gate",
        reference: `C-${n}`,
        title: gt,
      });
      const ap = await A.api("POST", `/contracts/${n}/approvals`, {
        approverIds: [uid(O.displayName)],
      });
      must(ap.status === 201, `approval request ${ap.status} ${q(ap.json)}`);
      await openContract(A, n);
      const m1 = await stageMove(A, n, "Out for signature");
      must(m1.gated, "no gate on Draft -> Out for signature");
      const gateText = tidy(await m1.gate.innerText());
      const buttons = tidy(await m1.gate.getByRole("button").allInnerTexts());
      await m1.gate.getByRole("button", { name: "Cancel", exact: true }).click();
      await m1.gate.waitFor({ state: "hidden" });
      const afterCancel = (await getContract(A, n)).statusName;
      const m2 = await stageMove(A, n, "Out for signature");
      must(m2.gated, "no gate on second try");
      await m2.gate.getByRole("button", { name: "Move anyway", exact: true }).click();
      await until(
        async () => (await getContract(A, n)).statusName === "Out for signature",
        "override saved",
      );
      await sleep(600);
      const m3 = await stageMove(A, n, "Active");
      const final = (await getContract(A, n)).statusName;
      must(
        afterCancel === "Draft" &&
          buttons.includes("Move anyway") &&
          buttons.includes("Cancel") &&
          !m3.gated &&
          final === "Active",
        `cancel ${afterCancel} buttons ${q(buttons)} step5 gated ${m3.gated} final ${final}`,
      );
      return `C-${n} with an approval pending from ${O.displayName}. Step 1 (Draft -> Out for signature): Move past approval appeared: ${q(gateText)}; buttons ${q(buttons.join(", "))}. Cancel left the Status ${afterCancel}; the second try with Move anyway saved Out for signature. Step 5 (Out for signature -> Active): Move past approval ${m3.gated ? "appeared" : "did not appear"}; the Contract reads ${final}.`;
    },
  );
}

// ---------- run ----------
watch(S.daniel.page);
watch(S.nadia.page);
const plan = [
  { role: "legal_team_member", A: S.nadia, O: S.daniel },
  { role: "administrator", A: S.daniel, O: S.nadia },
].filter((x) => ROLES.includes(x.role));
try {
  for (const { role, A, O } of plan) await manualSigning(role, A, O);
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
