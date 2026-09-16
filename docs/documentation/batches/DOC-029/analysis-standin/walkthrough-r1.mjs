// DOC-029 independent walkthrough, group analysis-standin, round 1.
// Articles: contract-analysis (V-C21) and compare-versions (V-C29).
// Written by the DOC-029 independent walkthrough agent from the article text.
//
// Run from the repository root with the lab and stand-in values in the environment:
//   LAB_PASSWORD=... STANDIN_API_KEY=... STANDIN_CONTROL_TOKEN=... STANDIN_CONTROL_URL=http://<ip>:8080 \
//   mise exec -- node docs/documentation/batches/DOC-029/analysis-standin/walkthrough-r1.mjs
// Optional: ROLES=administrator,legal_team_member PARTS=analysis,compare OUT=<path>
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as h from "./harness-r1.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT ?? path.join(here, "walkthrough-r1.json");
const ROLES = (process.env.ROLES ?? "administrator,legal_team_member").split(",");
const PARTS = (process.env.PARTS ?? "analysis,conversion,compare").split(",");
const stamp = Date.now();
const other = (role) => (role === "administrator" ? "legal_team_member" : "administrator");
const short = (role) => (role === "administrator" ? "Admin" : "Legal");
const q = JSON.stringify;
const labJson = JSON.parse(
  readFileSync(path.join(h.root, ".documentation-labs/analysis-r1/lab.json"), "utf8"),
);
const articleHash = (id) => h.sha256(readFileSync(path.join(h.root, `docs/user-guides/${id}.md`)));

const { results, step } = h.makeRecorder({
  kind: "independent-article-walkthrough",
  batch: "DOC-029",
  group: "analysis-standin",
  round: 1,
  walkthroughReviewer: "DOC-029 independent walkthrough agent (analysis-standin, round 1)",
  reviewerKind: "agent",
  appCommit: labJson.sourceCommit,
  environment: labJson.project,
  buildId: `app ${labJson.appImageId}; engine ${labJson.engineImageId}`,
  containerImages: labJson.containerImages,
  providerMode:
    "Local OpenAI-compatible stand-in (provider-standin.mjs) in its own container on this lab's backend network only; fictional paper and known answers; no real provider account or traffic.",
  browser: "Playwright 1.63.0 Chromium, headless, one context per identity at 1440x1000 CSS px",
  articleHashesTested: {
    "contract-analysis": articleHash("contract-analysis"),
    "compare-versions": articleHash("compare-versions"),
  },
  stamp,
  roles: ROLES,
  parts: PARTS,
  setup: [],
});
const save = () => {
  results.finishedAt = new Date().toISOString();
  writeFileSync(OUT, `${JSON.stringify(results, null, 2)}\n`);
};
const setupNote = (text) => {
  results.setup.push({ at: new Date().toISOString(), text });
  console.log(`setup: ${text}`);
};

const browser = await h.chromium.launch();
const sessions = {};
for (const role of new Set([...ROLES, ...ROLES.map(other), "administrator", "business_user"]))
  sessions[role] = await h.signIn(browser, role);
const admin = sessions.administrator.api;

// ---------- shared UI helpers ----------
async function cardStatus(page) {
  return (
    await page.getByRole("region", { name: "AI analysis" }).getByRole("status").textContent()
  ).trim();
}
async function waitStatus(page, pattern, timeout = 90000) {
  await h.until(
    async () => pattern.test(await cardStatus(page).catch(() => "")),
    `AI analysis status ${pattern}`,
    timeout,
    500,
  );
  return cardStatus(page);
}
async function resultRows(page) {
  const items = page
    .getByRole("region", { name: "AI analysis" })
    .getByRole("list", { name: "Analysis results" })
    .getByRole("listitem");
  const out = [];
  for (let i = 0; i < (await items.count()); i++) {
    const item = items.nth(i);
    const text = (await item.innerText()).replace(/\s+/g, " ").trim();
    const quote = (await item.locator("blockquote").innerText()).trim();
    out.push({ text, quote });
  }
  return out;
}
function row(rows, label, outcome) {
  const found = rows.find(
    (r) => r.text.startsWith(label) && new RegExp(`\\b${outcome}\\b`).test(r.text),
  );
  if (!found)
    throw new Error(`no ${outcome} row for ${label}; rows: ${q(rows.map((r) => r.text))}`);
  return found;
}
async function contract(api, number) {
  return h.ok(api.get(`/contracts/${number}`));
}
async function markers(api, number) {
  return Object.keys((await contract(api, number)).contract.aiUnverified ?? {});
}
async function openTab(page, number, tab) {
  const url = `${h.BASE}/contracts/${number}${tab ? `/${tab}` : ""}`;
  await page.goto(url);
  try {
    await page.getByRole("navigation", { name: "Contract sections" }).waitFor({ timeout: 20000 });
  } catch {
    // One recorded reload for a page that did not render; attempt 2 stalled once here.
    results.navigationRetries = [
      ...(results.navigationRetries ?? []),
      { at: new Date().toISOString(), url: url.replace(h.BASE, "") },
    ];
    await page.goto(url);
    await page.getByRole("navigation", { name: "Contract sections" }).waitFor({ timeout: 30000 });
  }
  await page.waitForLoadState("networkidle").catch(() => {});
}
async function menuItems(page, name) {
  await page.getByRole("button", { name }).click();
  const menu = page.getByRole("menu").last();
  await menu.waitFor();
  const items = (await menu.getByRole("menuitem").allInnerTexts()).map((s) => s.trim());
  return { menu, items };
}
async function textState(api, documentId, versionId, want, timeout = 120000) {
  return h.until(
    async () => {
      const answer = await api.get(`/documents/${documentId}/versions/${versionId}/text`);
      const state = answer.json?.text?.state;
      return want.includes(state) ? state : null;
    },
    `text state ${want} for ${versionId}`,
    timeout,
    1000,
  );
}
async function latestRun(api, number) {
  return (await contract(api, number)).analysis.latestRun;
}
async function waitRun(api, number, predicate, message, timeout = 90000) {
  return h.until(
    async () => {
      const run = await latestRun(api, number);
      return run && predicate(run) ? run : null;
    },
    message,
    timeout,
    750,
  );
}

// ---------- fixtures ----------
let analysisType;
let fieldSlugs;
let supplierName;
async function analysisSetup() {
  const connector = await h.ok(
    admin.put("/ai-connector", {
      preset: "custom",
      protocol: "openai_chat_completions",
      baseUrl: "http://analysis-provider:8080/v1",
      apiKey: h.STANDIN_KEY,
      model: h.MODEL,
    }),
  );
  if (!connector.connector.enabled) await h.ok(admin.post("/ai-connector/enable"));
  setupNote(
    "Administrator API: AI connector saved as Custom, OpenAI chat completions, base URL http://analysis-provider:8080/v1 (the stand-in), model doc029-standin-model, and enabled. This is prerequisite preparation (configure-analysis), not a C21 step.",
  );
  const type = await h.ok(
    admin.post("/contract-types", {
      displayName: `DOC-029 analysis-standin Analysis type ${stamp}`,
    }),
  );
  analysisType = type.contractType.id;
  fieldSlugs = {};
  for (const [key, displayName, fieldType, prompt] of [
    [
      "location",
      `DOC-029 Service location ${stamp}`,
      "text",
      "Extract the city where the services are performed.",
    ],
    ["tier", `DOC-029 Service tier ${stamp}`, "number", "Extract the numeric service tier."],
    ["absent", `DOC-029 Audit clause ${stamp}`, "text", "Extract the audit clause summary."],
  ]) {
    const field = await h.ok(
      admin.post("/fields", {
        displayName,
        moduleScope: "contract",
        fieldType,
        fieldTag: "legal",
        aiPrompt: prompt,
      }),
    );
    await h.ok(admin.post(`/contract-types/${analysisType}/fields`, { fieldId: field.field.id }));
    fieldSlugs[key] = { slug: field.field.slug, label: displayName };
  }
  const holder = await h.ok(
    admin.post("/contracts", {
      title: `DOC-029 analysis-standin Counterparty holder ${stamp}`,
      contractTypeId: analysisType,
    }),
  );
  supplierName = `DOC-029 Analysis Supplier ${stamp} Ltd`;
  await h.ok(
    admin.post(`/contracts/${holder.contract.number}/counterparties`, { name: supplierName }),
  );
  setupNote(
    `Administrator API: Contract type ${q(`DOC-029 analysis-standin Analysis type ${stamp}`)} with three prompted Fields (text location, number tier, text audit clause), and one live Counterparty ${q(supplierName)} created on holder Contract C-${holder.contract.number}.`,
  );
}

function paper(marker, version) {
  const v1 = version === 1;
  return [
    `DOC-029 fictional services agreement, reference ${marker}.`,
    `This Agreement is made between Helix Software Group, Inc. and ${v1 ? "Doc029 Unknown Supplier LLC" : supplierName}.`,
    "The Agreement takes effect on the thirtieth day of February 2027.",
    `This Agreement expires on ${v1 ? "March 31, 2027" : "June 30, 2027"}.`,
    `Either party may give notice of non-renewal at least ${v1 ? "60" : "90"} days before expiry.`,
    `The fees are USD ${v1 ? "2,500" : "3,000"} per month.`,
    `The services are performed in ${v1 ? "Muscat" : "Doha"}.`,
    `The service tier is ${v1 ? "1" : "2"}.`,
    "The price review takes place on January 15, 2027.",
    ...(v1
      ? []
      : [
          "The option exercise deadline is May 1, 2027.",
          "The customer may audit the supplier once a year.",
        ]),
  ];
}
function answers(version) {
  const v1 = version === 1;
  const kd = [
    {
      kind: "milestone",
      date: "2027-01-15",
      label: "Price review",
      note: null,
      evidence: "The price review takes place on January 15, 2027.",
    },
    {
      kind: "milestone",
      date: v1 ? "2027-03-31" : "2027-06-30",
      label: "Contract expiry",
      note: null,
      evidence: `This Agreement expires on ${v1 ? "March 31, 2027" : "June 30, 2027"}.`,
    },
  ];
  if (!v1)
    kd.push({
      kind: "milestone",
      date: "2027-05-01",
      label: "Option exercise deadline",
      note: null,
      evidence: "The option exercise deadline is May 1, 2027.",
    });
  return {
    term_type: { value: null, evidence: null },
    effective_date: {
      value: "2027-02-30",
      evidence: "The Agreement takes effect on the thirtieth day of February 2027.",
    },
    expiry_date: {
      value: v1 ? "2027-03-31" : "2027-06-30",
      evidence: `This Agreement expires on ${v1 ? "March 31, 2027" : "June 30, 2027"}.`,
    },
    renewal_period_months: { value: null, evidence: null },
    notice_period_days: {
      value: v1 ? 60 : 90,
      evidence: `at least ${v1 ? "60" : "90"} days before expiry`,
    },
    value: {
      value: { amount: v1 ? 250000 : 300000, currency: "USD", cadence: "monthly" },
      evidence: `The fees are USD ${v1 ? "2,500" : "3,000"} per month.`,
    },
    counterparty: {
      value: v1 ? "Doc029 Unknown Supplier LLC" : supplierName,
      evidence: v1 ? "Doc029 Unknown Supplier LLC" : supplierName,
    },
    [fieldSlugs.location.slug]: {
      value: v1 ? "Muscat" : "Doha",
      evidence: `The services are performed in ${v1 ? "Muscat" : "Doha"}.`,
    },
    [fieldSlugs.tier.slug]: {
      value: v1 ? 1 : 2,
      evidence: `The service tier is ${v1 ? "1" : "2"}.`,
    },
    [fieldSlugs.absent.slug]: v1
      ? { value: "Annual audit", evidence: "The customer may audit the supplier once a year." }
      : { value: "Annual audit", evidence: "The customer may audit the supplier once a year." },
    "key_dates:milestones": { value: kd },
  };
}

// ---------- V-C21 contract-analysis ----------
async function analysisWalk(role) {
  const A = "contract-analysis";
  const me = sessions[role];
  const them = sessions[other(role)];
  const page = me.page;
  const api = me.api;
  const tag = `${short(role)} ${stamp}`;
  const mk = async (suffix) =>
    (
      await h.ok(
        api.post("/contracts", {
          title: `DOC-029 analysis-standin ${suffix} ${tag}`,
          contractTypeId: analysisType,
          managerId: null,
        }),
      )
    ).contract.number;
  const noPaper = await mk("No paper");
  const failedPaper = await mk("Failed extraction");
  const main = await mk("Main");
  const marker = `DOC029AS${short(role).toUpperCase()}${stamp}`;
  const markerV2 = `${marker}V2`;
  setupNote(
    `${role} API: created C-${noPaper} (no paper), C-${failedPaper} (malformed primary PDF) and C-${main} (main walk) of the analysis type; stand-in markers ${marker} and ${markerV2}.`,
  );
  results.records = [
    ...(results.records ?? []),
    { role, article: A, contracts: { noPaper, failedPaper, main } },
  ];

  await step(
    A,
    role,
    "Before you start: a Contract without a primary Document",
    "The AI analysis card says no run has happened and Run analysis is refused with the no-primary-Document reason; no run is created.",
    async () => {
      await openTab(page, noPaper, "fields");
      const status = await cardStatus(page);
      h.expectThat(status === "No analysis has run yet.", `status ${q(status)}`);
      await page
        .getByRole("region", { name: "AI analysis" })
        .getByRole("button", { name: "Run analysis" })
        .click();
      const alert = page.getByRole("region", { name: "AI analysis" }).getByRole("alert");
      await alert.waitFor({ timeout: 15000 });
      const refusal = (await alert.textContent()).trim();
      h.expectThat(/no primary Document/i.test(refusal), `refusal ${q(refusal)}`);
      const run = await latestRun(api, noPaper);
      h.expectThat(run === null, "a run was created");
      return `C-${noPaper} Fields: AI analysis card below the Fields card read ${q(status)}. Run analysis showed ${q(refusal)}; the Contract still has no Analysis run.`;
    },
  );

  await step(
    A,
    role,
    "Before you start: the primary Document text failed to extract",
    "No automatic run starts and Run analysis is refused because the target text is not ready or empty.",
    async () => {
      const broken = {
        name: `doc029-broken-${short(role).toLowerCase()}.pdf`,
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.7\nthis is not a readable PDF body\n%%EOF\n"),
      };
      const up = await h.ok(api.upload(`/contracts/${failedPaper}/documents`, broken));
      const state = await textState(api, up.document.id, up.document.versions[0].id, [
        "failed",
        "ready",
        "empty",
        "unsupported",
      ]);
      h.expectThat(state !== "ready", `text state ${state}`);
      await openTab(page, failedPaper, "fields");
      const status = await cardStatus(page);
      h.expectThat(status === "No analysis has run yet.", `status ${q(status)}`);
      await page
        .getByRole("region", { name: "AI analysis" })
        .getByRole("button", { name: "Run analysis" })
        .click();
      const alert = page.getByRole("region", { name: "AI analysis" }).getByRole("alert");
      await alert.waitFor({ timeout: 15000 });
      const refusal = (await alert.textContent()).trim();
      h.expectThat(/no ready, non-empty text/i.test(refusal), `refusal ${q(refusal)}`);
      h.expectThat((await latestRun(api, failedPaper)) === null, "a run exists");
      return `Uploaded a malformed PDF as C-${failedPaper}'s primary Document (setup); its text state became ${q(state)}. Fields still read ${q(status)} (no automatic run). Run analysis showed ${q(refusal)} and created no run.`;
    },
  );

  await step(
    A,
    role,
    "If the card is absent: disabled connector, no marked values and no run",
    "With the connector disabled, the AI analysis card is absent on a Contract with no run and no markers, the Contract actions menu has no Run analysis, and a direct run is refused. Enabling brings the card back.",
    async () => {
      await h.ok(admin.post("/ai-connector/disable"));
      try {
        await openTab(page, noPaper, "fields");
        await page.getByRole("region", { name: "Fields" }).waitFor();
        const cards = await page.getByRole("region", { name: "AI analysis" }).count();
        h.expectThat(cards === 0, "card still shown");
        const { items } = await menuItems(page, "Contract actions");
        await page.keyboard.press("Escape");
        h.expectThat(!items.includes("Run analysis"), `menu ${q(items)}`);
        const direct = await api.post(`/contracts/${noPaper}/analysis`);
        h.expectThat(direct.status === 409, `direct run ${direct.status}`);
        return `Administrator disabled the connector (setup API). C-${noPaper} Fields showed the Fields card and no AI analysis card; Contract actions offered ${q(items)}; POST analysis answered ${direct.status} ${q(direct.json?.detail)}.`;
      } finally {
        await h.ok(admin.post("/ai-connector/enable"));
        await openTab(page, noPaper, "fields");
        await page.getByRole("region", { name: "AI analysis" }).waitFor({ timeout: 15000 });
      }
    },
  );

  let v1Doc;
  await step(
    A,
    role,
    "Run Analysis: an automatic run starts when the primary Document text becomes ready",
    "The card says Running… with no Run analysis control, then updates in place to Completed … on Version 1 with the model; each result row shows the returned value, evidence and the documented outcome.",
    async () => {
      await h.standin("/control/register", { marker, answers: answers(1) });
      await h.standin("/control/pause", { paused: true });
      try {
        const pdf = await h.makePdf(
          browser,
          `doc029-services-${short(role).toLowerCase()}.pdf`,
          paper(marker, 1),
        );
        v1Doc = (await h.ok(api.upload(`/contracts/${main}/documents`, pdf))).document;
        await waitRun(api, main, (r) => r.state === "pending", "automatic run queued", 120000);
        await openTab(page, main, "fields");
        await waitStatus(page, /^Running…$/, 30000);
        const runButtons = await page
          .getByRole("region", { name: "AI analysis" })
          .getByRole("button", { name: "Run analysis" })
          .count();
        h.expectThat(runButtons === 0, "Run analysis offered while pending");
      } finally {
        await h.standin("/control/pause", { paused: false });
      }
      const status = await waitStatus(
        page,
        /^Completed .* on Version 1 with doc029-standin-model\.$/,
      );
      const rows = await resultRows(page);
      const checks = [
        ["Expiry date", "Written"],
        ["Notice period (days)", "Written"],
        ["Value", "Written"],
        [fieldSlugs.location.label, "Written"],
        [fieldSlugs.tier.label, "Written"],
        ["Counterparty", "Unmatched"],
        ["Effective date", "Invalid"],
        ["Term type", "Unsupported"],
        [fieldSlugs.absent.label, "Unsupported"],
        ["Key date", "Written"],
        ["Key date", "Kept"],
      ].map(([label, outcome]) => row(rows, label, outcome).text);
      const record = await contract(api, main);
      h.expectThat(record.counterparties.length === 0, "a Counterparty was linked");
      h.expectThat(
        record.analysis.latestRun.trigger === "automatic",
        `trigger ${record.analysis.latestRun.trigger}`,
      );
      const flagged = Object.keys(record.contract.aiUnverified ?? {});
      h.expectThat(flagged.length === 6, `markers ${q(flagged)}`);
      return `Uploaded the first PDF as C-${main}'s primary Document (setup, stand-in paused). Fields showed ${q("Running…")} and no Run analysis control. After the stand-in answered, without a page load the card read ${q(status)}. Rows: ${checks.map((t) => q(t)).join("; ")}. No Counterparty was linked for the unknown name. Six values carry Unverified: ${q(flagged)}.`;
    },
  );

  await step(
    A,
    role,
    "The card updates when a run finishes while preserving typed drafts",
    "A value typed but not yet saved on the Fields section stays in its control when the pending run completes and the card updates.",
    async () => {
      const draftContract = await mk("Typed draft");
      const draftMarker = `${marker}DRAFT`;
      await h.standin("/control/register", { marker: draftMarker, answers: answers(1) });
      await h.standin("/control/pause", { paused: true });
      let status;
      let shown;
      try {
        const pdf = await h.makePdf(
          browser,
          `doc029-draft-${short(role).toLowerCase()}.pdf`,
          paper(draftMarker, 1),
        );
        await h.ok(api.upload(`/contracts/${draftContract}/documents`, pdf));
        await waitRun(api, draftContract, (r) => r.state === "pending", "draft run queued", 120000);
        await openTab(page, draftContract, "fields");
        await waitStatus(page, /^Running…$/, 30000);
        await page
          .getByRole("region", { name: "Fields" })
          .getByRole("textbox", { name: fieldSlugs.absent.label })
          .fill("DOC-029 unsaved draft text");
      } finally {
        await h.standin("/control/pause", { paused: false });
      }
      status = await waitStatus(page, /^Completed .* on Version 1/);
      await h.sleep(1500);
      shown = await page
        .getByRole("region", { name: "Fields" })
        .getByRole("textbox", { name: fieldSlugs.absent.label })
        .inputValue();
      const locationShown = await page
        .getByRole("region", { name: "Fields" })
        .getByRole("textbox", { name: fieldSlugs.location.label })
        .inputValue();
      h.expectThat(
        shown === "DOC-029 unsaved draft text" && locationShown === "Muscat",
        `draft ${q(shown)} location ${q(locationShown)}`,
      );
      return `C-${draftContract} (separate Contract): typed "DOC-029 unsaved draft text" into ${fieldSlugs.absent.label} without leaving the control while the card read Running…. When the card updated to ${q(status)}, the typed draft was still in the control and the written ${fieldSlugs.location.label} showed ${q(locationShown)}.`;
    },
  );

  await step(
    A,
    role,
    "Run Analysis from the Contract actions menu and Unverified markers on Overview",
    "Contract actions offers Run analysis from another section. Newly written values show the Unverified indicator and an evidence sparkle.",
    async () => {
      await openTab(page, main, "");
      const { items } = await menuItems(page, "Contract actions");
      await page.keyboard.press("Escape");
      h.expectThat(items.includes("Run analysis"), `menu ${q(items)}`);
      const mainRegion = page.getByRole("main");
      const sparkles = await mainRegion
        .getByRole("button", { name: /^View AI evidence for / })
        .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
      h.expectThat(
        sparkles.includes("View AI evidence for Expiry date") &&
          sparkles.includes("View AI evidence for Notice period (days)"),
        `sparkles ${q(sparkles)}`,
      );
      const unverified = await mainRegion.getByText("Unverified", { exact: true }).count();
      const notice = mainRegion.getByRole("spinbutton", { name: "Notice period (days)" });
      const border = await notice.evaluate((el) => {
        const wrap = el.closest(".ai-field");
        if (!wrap) return null;
        const after = getComputedStyle(wrap, "::after");
        return {
          generated: wrap.getAttribute("data-ai-generated"),
          start: getComputedStyle(wrap).getPropertyValue("--ai-field-border-start").trim(),
          end: getComputedStyle(wrap).getPropertyValue("--ai-field-border-end").trim(),
          pseudo: after.backgroundImage.slice(0, 90),
        };
      });
      h.expectThat(
        border?.generated === "true" && /gradient/.test(border.pseudo),
        `border ${q(border)}`,
      );
      const shot = path.join(here, `r1-${role}-unverified-notice.png`);
      await notice.evaluate((el) =>
        el.closest(".ai-field").parentElement.scrollIntoView({ block: "center" }),
      );
      await notice
        .locator(
          "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' ai-field ')][1]",
        )
        .screenshot({ path: shot });
      return `Overview Contract actions menu: ${q(items)}. Overview shows ${unverified} Unverified indicators and sparkles ${q(sparkles)}; the Notice period control sits in an AI border wrapper ${q(border)} (screenshot ${path.basename(shot)}).`;
    },
  );

  await step(
    A,
    role,
    "Evidence sparkle opens the cited Document Version in the same-page doc panel",
    "Selecting the sparkle opens the original Document Version 1 in the doc panel and marks the quoted passage.",
    async () => {
      await page
        .getByRole("main")
        .getByRole("button", { name: "View AI evidence for Notice period (days)" })
        .click();
      const panel = page.getByRole("complementary", { name: /, version 1$/ });
      await panel.waitFor({ timeout: 30000 });
      const mark = panel.locator("mark").first();
      await mark.waitFor({ timeout: 30000 });
      const marked = (await mark.textContent()).trim();
      h.expectThat(marked === "at least 60 days before expiry", `marked ${q(marked)}`);
      const name = await panel.getAttribute("aria-label");
      const url = page.url();
      await panel.getByRole("button", { name: "Close the document" }).click();
      await openTab(page, main, "key-dates");
      const table = page.getByRole("region", { name: "Key dates" });
      const price = table.getByRole("row", { name: /Price review/ });
      const priceText = (await price.innerText()).replace(/\s+/g, " ");
      h.expectThat(/Unverified/.test(priceText), `price row ${q(priceText)}`);
      await price.getByRole("button", { name: "View AI evidence for Price review" }).click();
      const kdPanel = page.getByRole("complementary", { name: /, version 1$/ });
      await kdPanel.locator("mark").first().waitFor({ timeout: 30000 });
      const kdMark = (await kdPanel.locator("mark").first().textContent()).trim();
      await kdPanel.getByRole("button", { name: "Close the document" }).click();
      return `Overview sparkle opened ${q(name)} on the same page (${url.replace(h.BASE, "")}) with the marked passage ${q(marked)}. On Key dates the Price review sparkle opened the same Version with ${q(kdMark)} marked.`;
    },
  );

  await step(
    A,
    role,
    "Unverified values are already usable",
    "Before confirmation the extracted Key date is in the Key dates list, the notice period drives the derived deadline, and the Value is saved.",
    async () => {
      await openTab(page, main, "key-dates");
      const rows = (
        await page.getByRole("region", { name: "Key dates" }).getByRole("row").allInnerTexts()
      ).map((t) => t.replace(/\s+/g, " ").trim());
      h.expectThat(
        rows.some((r) => /Jan 15, 2027 Price review/.test(r)),
        "no Price review row",
      );
      h.expectThat(
        rows.some((r) => /Jan 30, 2027 Renewal notice deadline — 60 days before expiry/.test(r)),
        "no derived notice deadline",
      );
      h.expectThat(rows.filter((r) => /Price review/.test(r)).length === 1, "duplicate rows");
      h.expectThat(
        !rows.some((r) => /Contract expiry/.test(r)),
        "Kept expiry milestone added a row",
      );
      const record = await contract(api, main);
      h.expectThat(
        record.contract.value?.amount === 250000 &&
          record.contract.value.currency === "USD" &&
          record.contract.value.cadence === "monthly",
        `value ${q(record.contract.value)}`,
      );
      return `Key dates rows before any confirmation: ${q(rows.slice(1))}. The Kept "Contract expiry" milestone added no row. Saved Value ${q(record.contract.value)}; noticeDeadline ${record.contract.noticeDeadline}.`;
    },
  );

  await step(
    A,
    role,
    "Confirm or correct one value",
    "Confirm clears only that value's marker; editing a Field clears its marker; a Key date note-only edit keeps the marker, an event change clears it; Confirm all shows while more than one value is marked; History records the confirmation.",
    async () => {
      await openTab(page, main, "fields");
      const card = page.getByRole("region", { name: "AI analysis" });
      const before = await markers(api, main);
      await card
        .getByRole("listitem")
        .filter({ hasText: /^Notice period \(days\)/ })
        .getByRole("button", { name: "Confirm" })
        .click();
      await h.until(
        async () => !(await markers(api, main)).includes("notice_period_days"),
        "notice marker cleared",
      );
      const afterConfirm = await markers(api, main);
      h.expectThat(
        afterConfirm.length === before.length - 1,
        `confirm cleared ${before.length - afterConfirm.length}`,
      );
      const record = await contract(api, main);
      h.expectThat(record.contract.noticePeriodDays === 60, "notice changed");
      const locationBox = page
        .getByRole("region", { name: "Fields" })
        .getByRole("textbox", { name: fieldSlugs.location.label });
      await locationBox.fill("Salalah");
      await locationBox.blur();
      await h.until(
        async () =>
          (await contract(api, main)).contract.customFields[fieldSlugs.location.slug] === "Salalah",
        "location saved",
      );
      const afterEdit = await markers(api, main);
      h.expectThat(
        !afterEdit.includes(fieldSlugs.location.slug) &&
          afterEdit.length === afterConfirm.length - 1,
        `after edit ${q(afterEdit)}`,
      );
      await openTab(page, main, "key-dates");
      const kd = page.getByRole("region", { name: "Key dates" });
      const editKd = async (label, change) => {
        await kd.getByRole("button", { name: `Actions for ${label}` }).click();
        await page.getByRole("menuitem", { name: "Edit date" }).click();
        const dialog = page.getByRole("dialog");
        await dialog.waitFor();
        await change(dialog);
        await dialog.getByRole("button", { name: /^Save/ }).click();
        await dialog.waitFor({ state: "hidden", timeout: 15000 });
      };
      await editKd("Price review", async (dialog) => {
        await dialog.getByLabel(/^Note/).fill("DOC-029 note only");
      });
      await h.sleep(1000);
      const afterNote = await markers(api, main);
      h.expectThat(
        afterNote.length === afterEdit.length,
        `note-only edit changed markers ${q(afterNote)}`,
      );
      await editKd("Price review", async (dialog) => {
        await dialog.getByLabel(/^Event/).fill("Annual price review");
      });
      await h.until(
        async () => (await markers(api, main)).length === afterNote.length - 1,
        "key date marker cleared",
      );
      const afterEvent = await markers(api, main);
      await openTab(page, main, "fields");
      const confirmAll = await page
        .getByRole("region", { name: "AI analysis" })
        .getByRole("button", { name: "Confirm all" })
        .count();
      h.expectThat(
        afterEvent.length > 1 && confirmAll === 1,
        `Confirm all ${confirmAll} with ${afterEvent.length} markers`,
      );
      await page.getByRole("button", { name: "History" }).click();
      const history = page.getByRole("complementary", { name: "History" });
      await history.waitFor();
      const entry = history.getByText(/confirmed the AI-written value for/).first();
      await entry.waitFor({ timeout: 15000 });
      const historyText = (await entry.textContent()).trim();
      await history.getByRole("button", { name: "Close" }).click();
      return `Confirm beside Notice period (days) kept 60 and cleared only its marker (${before.length} -> ${afterConfirm.length}). Editing ${fieldSlugs.location.label} to Salalah on Fields cleared its marker (${afterEdit.length} left). Key dates: Edit date with a note-only change kept the Price review marker (${afterNote.length}); changing its event to "Annual price review" cleared it (${afterEvent.length} left: ${q(afterEvent)}). Confirm all was shown with ${afterEvent.length} marked values. History: ${q(historyText)}.`;
    },
  );

  let v2Doc;
  await step(
    A,
    role,
    "Rerun after a change: the executed pin is the target and a newer upload does not displace it",
    "Marking Version 1 as the executed copy starts a run on Version 1. A newer Version starts no run, Run analysis still reads Version 1, and the earlier evidence still opens Version 1. Confirmed and edited values are Kept; a reviewed Key date is not added again.",
    async () => {
      const runBefore = await latestRun(api, main);
      await openTab(page, main, "documents");
      const { menu, items } = await menuItems(page, `Actions for ${v1Doc.title}`);
      h.expectThat(items.includes("Mark as executed copy"), `menu ${q(items)}`);
      await menu.getByRole("menuitem", { name: "Mark as executed copy" }).click();
      const pinnedRun = await waitRun(
        api,
        main,
        (r) => r.id !== runBefore.id && r.state === "ready",
        "run after pin",
      );
      h.expectThat(
        pinnedRun.versionNumber === 1 && pinnedRun.trigger === "automatic",
        `pinned run ${q(pinnedRun)}`,
      );
      const kept = pinnedRun.outcome.results.filter((r) => r.outcome === "kept").map((r) => r.slug);
      h.expectThat(
        kept.includes("notice_period_days") && kept.includes(fieldSlugs.location.slug),
        `kept ${q(kept)}`,
      );
      const kdRows = await h.ok(api.get(`/contracts/${main}/key-dates`));
      h.expectThat(
        !kdRows.deadlines.some((d) => d.label === "Price review"),
        "Price review re-added",
      );
      await h.standin("/control/register", { marker: markerV2, answers: answers(2) });
      const statsBefore = await h.standin("/control/stats");
      const pdf2 = await h.makePdf(browser, v1Doc.title, paper(markerV2, 2));
      v2Doc = (await h.ok(api.upload(`/documents/${v1Doc.id}/versions`, pdf2))).document;
      const v2 = v2Doc.versions.find((v) => v.versionNumber === 2);
      await textState(api, v1Doc.id, v2.id, ["ready"]);
      await h.sleep(5000);
      const statsAfter = await h.standin("/control/stats");
      const runAfterUpload = await latestRun(api, main);
      h.expectThat(runAfterUpload.id === pinnedRun.id, "a run started after the newer upload");
      h.expectThat(
        statsAfter.extractions === statsBefore.extractions,
        "provider called after upload",
      );
      await openTab(page, main, "");
      await page
        .getByRole("main")
        .getByRole("button", { name: "View AI evidence for Expiry date" })
        .click();
      const panel = page.getByRole("complementary", { name: /, version \d+$/ });
      await panel.waitFor({ timeout: 30000 });
      const panelName = await panel.getAttribute("aria-label");
      h.expectThat(/version 1$/.test(panelName), `evidence opened ${panelName}`);
      await panel.getByRole("button", { name: "Close the document" }).click();
      await openTab(page, main, "fields");
      await page
        .getByRole("region", { name: "AI analysis" })
        .getByRole("button", { name: "Run analysis" })
        .click();
      const manual = await waitRun(
        api,
        main,
        (r) => r.id !== pinnedRun.id && r.state === "ready",
        "manual run",
      );
      const status = await waitStatus(
        page,
        /^Completed .* on Version 1 with doc029-standin-model\.$/,
      );
      h.expectThat(
        manual.trigger === "manual" && manual.versionNumber === 1,
        `manual ${q(manual)}`,
      );
      return `Documents: Actions for ${v1Doc.title} -> Mark as executed copy started automatic run on Version ${pinnedRun.versionNumber}; notice (confirmed) and location (edited) were Kept and the renamed Price review was not added again. Version 2 uploaded (setup) and its text became ready: no new run and no provider request (${statsBefore.extractions} -> ${statsAfter.extractions}). Overview Expiry date sparkle still opened ${q(panelName)}. Run analysis then read ${q(status)}.`;
    },
  );

  await step(
    A,
    role,
    "Rerun on changed input while another legal person edits a value",
    "Marking Version 2 executed runs on Version 2. An unverified value is replaced by the new answer; confirmed, edited and concurrently edited values are Kept although the returned answer differs; the matching live Counterparty is linked; a new milestone is written.",
    async () => {
      const before = await latestRun(api, main);
      await h.standin("/control/pause", { paused: true });
      let otherEdit;
      try {
        await openTab(page, main, "documents");
        const { menu, items } = await menuItems(page, `Actions for ${v1Doc.title}`);
        h.expectThat(items.includes("Mark as executed copy"), `menu ${q(items)}`);
        await menu.getByRole("menuitem", { name: "Mark as executed copy" }).click();
        await waitRun(
          api,
          main,
          (r) => r.id !== before.id && r.state === "pending",
          "pending run on v2",
        );
        await h.until(
          async () => (await h.standin("/control/stats")).waiting > 0,
          "request held at stand-in",
        );
        await openTab(them.page, main, "fields");
        const tier = them.page
          .getByRole("region", { name: "Fields" })
          .getByRole("spinbutton", { name: fieldSlugs.tier.label })
          .or(
            them.page
              .getByRole("region", { name: "Fields" })
              .getByRole("textbox", { name: fieldSlugs.tier.label }),
          );
        await tier.fill("5");
        await tier.blur();
        await h.until(
          async () =>
            (await contract(them.api, main)).contract.customFields[fieldSlugs.tier.slug] === 5,
          "tier edit saved",
        );
        otherEdit = `${sessions[other(role)].person.name} saved ${fieldSlugs.tier.label} 1 -> 5 on Fields while the run waited at the stand-in`;
      } finally {
        await h.standin("/control/pause", { paused: false });
      }
      await openTab(page, main, "fields");
      const status = await waitStatus(
        page,
        /^Completed .* on Version 2 with doc029-standin-model\.$/,
      );
      const rows = await resultRows(page);
      const record = await contract(api, main);
      const c = record.contract;
      const texts = [
        row(rows, "Expiry date", "Written").text,
        row(rows, "Notice period (days)", "Kept").text,
        row(rows, fieldSlugs.location.label, "Kept").text,
        row(rows, fieldSlugs.tier.label, "Kept").text,
        row(rows, "Counterparty", "Written").text,
        row(rows, "Value", "Written").text,
        row(rows, fieldSlugs.absent.label, "Written").text,
      ];
      h.expectThat(
        c.expiryDate === "2027-06-30" && c.noticePeriodDays === 60,
        `core ${c.expiryDate} ${c.noticePeriodDays}`,
      );
      h.expectThat(
        c.customFields[fieldSlugs.location.slug] === "Salalah" &&
          c.customFields[fieldSlugs.tier.slug] === 5,
        `fields ${q(c.customFields)}`,
      );
      h.expectThat(!c.aiUnverified?.[fieldSlugs.tier.slug], "tier marker set");
      h.expectThat(
        record.counterparties.some((p) => p.name === supplierName),
        `counterparties ${q(record.counterparties)}`,
      );
      const kdRows = (await h.ok(api.get(`/contracts/${main}/key-dates`))).deadlines;
      h.expectThat(
        kdRows.some((d) => d.label === "Option exercise deadline" && d.unverified),
        "no option deadline row",
      );
      h.expectThat(
        kdRows.some((d) => d.label === "Annual price review") &&
          !kdRows.some((d) => d.label === "Price review"),
        "price review rows changed",
      );
      const kdKept = rows
        .filter((r) => r.text.startsWith("Key date") && /Kept/.test(r.text))
        .map((r) => r.text);
      return `Documents -> Mark as executed copy on the Document pinned Version 2 and queued a run; ${otherEdit}. Card: ${q(status)}. Rows: ${texts.map((t) => q(t)).join("; ")}; Key date Kept rows ${q(kdKept)}. Saved: expiry 2027-06-30 (Unverified again), notice 60, location Salalah, tier 5 with no marker, Counterparty ${q(supplierName)} linked. Key dates: Option exercise deadline added Unverified; Annual price review unchanged.`;
    },
  );

  await step(
    A,
    role,
    "Key date removal is not undone by a later run, and an explicit clear is preserved",
    "Edit date with a note-only change keeps the marker; Remove date clears it; a later run does not add the milestone again. A cleared Field stays empty after a rerun.",
    async () => {
      await openTab(page, main, "key-dates");
      const kd = page.getByRole("region", { name: "Key dates" });
      await kd.getByRole("button", { name: "Actions for Option exercise deadline" }).click();
      await page.getByRole("menuitem", { name: "Edit date" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel(/^Note/).fill("DOC-029 check the option notice");
      await dialog.getByRole("button", { name: /^Save/ }).click();
      await dialog.waitFor({ state: "hidden" });
      await h.sleep(800);
      const afterNote = (await contract(api, main)).contract.aiUnverified ?? {};
      const optionRow = (await h.ok(api.get(`/contracts/${main}/key-dates`))).deadlines.find(
        (d) => d.label === "Option exercise deadline",
      );
      h.expectThat(optionRow?.unverified === true, "note edit cleared the option marker");
      await kd.getByRole("button", { name: "Actions for Option exercise deadline" }).click();
      await page.getByRole("menuitem", { name: "Remove date" }).click();
      const confirmDialog = page.getByRole("alertdialog").or(page.getByRole("dialog"));
      if (await confirmDialog.count())
        await confirmDialog.getByRole("button", { name: /Remove/ }).click();
      await h.until(
        async () =>
          !(await h.ok(api.get(`/contracts/${main}/key-dates`))).deadlines.some(
            (d) => d.label === "Option exercise deadline",
          ),
        "option removed",
      );
      const afterRemove = (await contract(api, main)).contract.aiUnverified ?? {};
      h.expectThat(
        Object.keys(afterRemove).length === Object.keys(afterNote).length - 1,
        "remove did not clear exactly one marker",
      );
      await openTab(page, main, "fields");
      const audit = page
        .getByRole("region", { name: "Fields" })
        .getByRole("textbox", { name: fieldSlugs.absent.label });
      await audit.fill("");
      await audit.blur();
      await h.until(
        async () =>
          (await contract(api, main)).contract.customFields[fieldSlugs.absent.slug] == null,
        "audit cleared",
      );
      const before = await latestRun(api, main);
      await page
        .getByRole("region", { name: "AI analysis" })
        .getByRole("button", { name: "Run analysis" })
        .click();
      await waitRun(api, main, (r) => r.id !== before.id && r.state === "ready", "rerun");
      const status = await waitStatus(page, /^Completed .* on Version 2/);
      const rows = await resultRows(page);
      const auditRow = row(rows, fieldSlugs.absent.label, "Kept").text;
      const kdRows = (await h.ok(api.get(`/contracts/${main}/key-dates`))).deadlines;
      h.expectThat(!kdRows.some((d) => d.label === "Option exercise deadline"), "option re-added");
      h.expectThat(
        kdRows.some((d) => d.label === "Annual price review"),
        "earlier Key date changed",
      );
      const optionKept = rows
        .filter((r) => r.text.startsWith("Key date") && /Option exercise deadline/.test(r.text))
        .map((r) => r.text);
      h.expectThat(
        optionKept.length === 1 && /Kept/.test(optionKept[0]),
        `option rows ${q(optionKept)}`,
      );
      const c = (await contract(api, main)).contract;
      h.expectThat(c.customFields[fieldSlugs.absent.slug] == null, "audit refilled");
      return `Edit date with a note-only change left Option exercise deadline Unverified. Remove date removed the row and its marker (${Object.keys(afterNote).length} -> ${Object.keys(afterRemove).length}). Cleared ${fieldSlugs.absent.label} on Fields. Run analysis: ${q(status)}; ${q(auditRow)}; ${q(optionKept[0])}; no Option exercise deadline row returned; Annual price review still listed; the audit Field stayed empty.`;
    },
  );

  await step(
    A,
    role,
    "If Analysis cannot finish: a failed run reports its reason, Version and model and changes nothing",
    "A malformed provider reply ends in Failed … on Version 2 with the model and reason; saved values and markers are unchanged; another run succeeds.",
    async () => {
      const snapshot = async () => {
        const c = (await contract(api, main)).contract;
        return q({
          e: c.expiryDate,
          n: c.noticePeriodDays,
          v: c.value,
          f: c.customFields,
          m: Object.keys(c.aiUnverified ?? {}).sort(),
        });
      };
      const before = await snapshot();
      const run0 = await latestRun(api, main);
      await h.standin("/control/malformed", { count: 10 });
      let failedStatus;
      try {
        await openTab(page, main, "fields");
        await page
          .getByRole("region", { name: "AI analysis" })
          .getByRole("button", { name: "Run analysis" })
          .click();
        await waitRun(
          api,
          main,
          (r) => r.id !== run0.id && r.state === "failed",
          "failed run",
          240000,
        );
        failedStatus = await waitStatus(
          page,
          /^Failed .* on Version 2 with doc029-standin-model: /,
          60000,
        );
      } finally {
        await h.standin("/control/malformed", { count: 0 });
      }
      const after = await snapshot();
      h.expectThat(before === after, `values changed ${before} ${after}`);
      const failed = await latestRun(api, main);
      await page
        .getByRole("region", { name: "AI analysis" })
        .getByRole("button", { name: "Run analysis" })
        .click();
      await waitRun(api, main, (r) => r.id !== failed.id && r.state === "ready", "recovery run");
      const ok = await waitStatus(page, /^Completed .* on Version 2/);
      return `With the stand-in returning non-JSON, Run analysis ended as ${q(failedStatus)}. Saved values and markers were identical before and after. With valid replies restored, Run analysis read ${q(ok)}.`;
    },
  );

  await step(
    A,
    role,
    "Supporting Documents are not the target",
    "A second Document with ready text does not start a run and sends nothing to the provider.",
    async () => {
      const supportMarker = `${marker}SUPPORT`;
      await h.standin("/control/register", { marker: supportMarker, answers: answers(2) });
      const run0 = await latestRun(api, main);
      const stats0 = await h.standin("/control/stats");
      const pdf = await h.makePdf(browser, `doc029-supporting-${short(role).toLowerCase()}.pdf`, [
        `Supporting note ${supportMarker}.`,
        "This Agreement expires on June 30, 2027.",
      ]);
      const up = await h.ok(api.upload(`/contracts/${main}/documents`, pdf));
      h.expectThat(up.document.isPrimary === false, "supporting became primary");
      await textState(api, up.document.id, up.document.versions[0].id, ["ready"]);
      await h.sleep(6000);
      const run1 = await latestRun(api, main);
      const stats1 = await h.standin("/control/stats");
      h.expectThat(
        run1.id === run0.id &&
          !stats1.byMarker[supportMarker] &&
          stats1.extractions === stats0.extractions,
        "supporting paper was analyzed",
      );
      return `A supporting PDF (not primary) reached ready text; the latest run stayed ${run0.id.slice(-6)} and the stand-in received no request for it.`;
    },
  );

  await step(
    A,
    role,
    "Roles and states: Ended, archived, disabled connector and Confirm all",
    "Ended removes Run analysis and refuses a run but allows Confirm. Archived removes Confirm and refuses it until restored. A disabled connector keeps markers and the card; Confirm all clears the remaining markers without changing values.",
    async () => {
      const statuses = (await h.ok(admin.get("/contract-statuses"))).contractStatuses;
      const ended = statuses.find((s) => s.stage === "ended" && !s.archivedAt);
      await h.ok(api.patch(`/contracts/${main}`, { statusId: ended.id, overrideSoftGate: true }));
      await openTab(page, main, "fields");
      const card = page.getByRole("region", { name: "AI analysis" });
      await card.waitFor();
      const runControls = await card.getByRole("button", { name: "Run analysis" }).count();
      const { items } = await menuItems(page, "Contract actions");
      await page.keyboard.press("Escape");
      const direct = await api.post(`/contracts/${main}/analysis`);
      h.expectThat(
        runControls === 0 && !items.includes("Run analysis") && direct.status === 409,
        `ended run ${runControls} ${q(items)} ${direct.status}`,
      );
      const m0 = await markers(api, main);
      await card
        .getByRole("listitem")
        .filter({ hasText: /^Expiry date/ })
        .getByRole("button", { name: "Confirm" })
        .click();
      await h.until(
        async () => !(await markers(api, main)).includes("expiry_date"),
        "expiry confirmed on ended",
      );
      const m1 = await markers(api, main);
      await openTab(page, main, "");
      await menuItems(page, "Contract actions");
      await page.getByRole("menuitem", { name: "Archive" }).click();
      const archiveDialog = page.getByRole("alertdialog").or(page.getByRole("dialog"));
      if (await archiveDialog.count())
        await archiveDialog.getByRole("button", { name: /^Archive/ }).click();
      await h.until(
        async () => (await contract(api, main)).contract.archivedAt !== null,
        "archived",
      );
      await openTab(page, main, "fields");
      const confirmsArchived =
        (await page.getByRole("button", { name: "Confirm" }).count()) +
        (await page.getByRole("button", { name: "Confirm all" }).count());
      const slug = m1[0];
      const refused = await api.post(`/contracts/${main}/analysis/confirm`, { slug });
      h.expectThat(
        confirmsArchived === 0 && refused.status === 409,
        `archived confirm ${confirmsArchived} ${refused.status} ${refused.text.slice(0, 120)}`,
      );
      await h.ok(api.post(`/contracts/${main}/restore`));
      const restored = (await contract(api, main)).contract;
      h.expectThat(restored.archivedAt === null && restored.stage === "ended", "restore state");
      const valuesBefore = q({
        e: restored.expiryDate,
        v: restored.value,
        cf: restored.customFields,
      });
      await h.ok(admin.post("/ai-connector/disable"));
      let summary;
      try {
        await openTab(page, main, "fields");
        const disabledCard = page.getByRole("region", { name: "AI analysis" });
        await disabledCard.waitFor({ timeout: 15000 });
        const kept = await markers(api, main);
        h.expectThat(
          kept.length === m1.length && kept.length > 1,
          `markers after disable ${q(kept)}`,
        );
        await disabledCard.getByRole("button", { name: "Confirm all" }).click();
        await h.until(async () => (await markers(api, main)).length === 0, "confirm all");
        const after = (await contract(api, main)).contract;
        h.expectThat(
          q({ e: after.expiryDate, v: after.value, cf: after.customFields }) === valuesBefore,
          "values changed by Confirm all",
        );
        summary = `Connector disabled: the card stayed with ${kept.length} Unverified values (${q(kept)}); Confirm all cleared them and no saved value changed.`;
      } finally {
        await h.ok(admin.post("/ai-connector/enable"));
      }
      return `Moved C-${main} to ${q(ended.displayName)} (Ended; setup API). Fields had no Run analysis control, Contract actions offered ${q(items)}, and POST analysis answered ${direct.status}. Confirm on Expiry date still cleared its marker (${m0.length} -> ${m1.length}). Contract actions -> Archive: no Confirm or Confirm all control; POST confirm answered ${refused.status}. Restore kept the Ended stage. ${summary}`;
    },
  );

  await step(
    A,
    role,
    "Business Users cannot run Analysis or confirm its values",
    "A Business User on the Contract team cannot open the Contract record in the app, and the run and confirm requests are refused.",
    async () => {
      const bu = sessions.business_user;
      if (!bu) throw new Error("no Business User session");
      const people = (await h.ok(admin.get(`/contracts/${main}`))).team ?? [];
      const jonas = (await h.ok(admin.get("/users?limit=200")).catch(() => null))?.users?.find(
        (u) => u.email === h.PEOPLE.business_user.email,
      );
      let teamNote = "not added";
      if (jonas && !people.some((p) => p.id === jonas.id)) {
        const added = await admin.post(`/contracts/${main}/team`, { userId: jonas.id });
        teamNote = `team add answered ${added.status}`;
      }
      await bu.page.goto(`${h.BASE}/contracts/${main}/fields`);
      await bu.page.waitForLoadState("networkidle").catch(() => {});
      const landed = new URL(bu.page.url()).pathname;
      const cards = await bu.page.getByRole("region", { name: "AI analysis" }).count();
      const run = await bu.api.post(`/contracts/${main}/analysis`);
      const confirm = await bu.api.post(`/contracts/${main}/analysis/confirm-all`);
      h.expectThat(
        cards === 0 && [403, 404].includes(run.status) && [403, 404].includes(confirm.status),
        `bu ${landed} ${cards} ${run.status} ${confirm.status}`,
      );
      return `Jonas Weber (Business User; ${teamNote}) opening /contracts/${main}/fields landed on ${q(landed)} with no AI analysis card; POST analysis answered ${run.status} and POST confirm-all answered ${confirm.status}.`;
    },
  );
  save();
}

// ---------- V-C21 Request-context Analysis ----------
async function conversionWalk(role) {
  const A = "contract-analysis";
  const me = sessions[role];
  const page = me.page;
  const api = me.api;
  const tag = `${short(role)} ${stamp}`;
  await step(
    A,
    role,
    "Analysis after Request conversion: filling, failure, Retry Request-context Analysis and completion",
    "With Fill Contract Fields after conversion on, the converted Contract's card reports filling; a failed run leaves the Contract created and offers Retry Request-context Analysis; retry completes; no separate automatic primary-Document run is queued.",
    async () => {
      const adminPage = sessions.administrator.page;
      await adminPage.goto(`${h.BASE}/settings/ai-analysis`);
      const toggle = adminPage.getByRole("switch", {
        name: "Fill Contract Fields after conversion",
      });
      await toggle.waitFor({ timeout: 20000 });
      let switchNote = "already on";
      if ((await toggle.getAttribute("aria-checked")) !== "true") {
        await toggle.click();
        await h.until(
          async () =>
            (await h.ok(admin.get("/ai-connector"))).connector.contractConversionAnalysis === true,
          "switch saved",
        );
        switchNote = "turned on by the Administrator on Settings -> AI analysis";
      }
      const types = (await h.ok(admin.get("/request-types"))).requestTypes ?? [];
      const legalQuestion = types.find((t) => t.displayName === "Legal question" && !t.archivedAt);
      const departments = (await h.ok(admin.get("/departments"))).departments;
      const needle = `DOC-029 Portal Supplier ${short(role)} ${stamp} GmbH`;
      const submitted = await h.ok(
        sessions.business_user.api.post("/requests", {
          requestTypeId: legalQuestion.id,
          departmentId: departments[0].id,
          title: `DOC-029 analysis-standin Request ${tag}`,
          description: `Please review the fictional services agreement with ${needle}. It is a DOC-029 walkthrough record.`,
          urgency: "low",
        }),
      );
      const request = {
        ...submitted.request,
        requestType: {
          displayName: legalQuestion.displayName,
          targetModule: legalQuestion.targetModule ?? null,
        },
      };
      const cite = [{ slug: "counterparty", needle }];
      await h.standin("/control/fallback", { enabled: true, cite });
      await h.standin("/control/malformed", { count: 20 });
      await h.standin("/control/pause", { paused: true });
      const stats0 = await h.standin("/control/stats");
      let converted;
      let filling;
      try {
        const body = { title: `DOC-029 analysis-standin Converted ${tag}` };
        if (request.requestType.targetModule !== "contract") body.contractTypeId = analysisType;
        const answer = await h.ok(api.post(`/requests/${request.number}/convert`, body));
        converted =
          answer.request.convertedContract?.number ?? answer.request.convertedRecord?.number;
        h.expectThat(converted, `no converted number ${q(answer.request.convertedRecord)}`);
        await openTab(page, converted, "fields");
        filling = await waitStatus(
          page,
          /^Filling Contract Fields from the Request and supporting sources…$/,
          60000,
        );
      } finally {
        await h.standin("/control/pause", { paused: false });
      }
      let failedText;
      try {
        failedText = await waitStatus(page, /^Request-context Analysis failed\./, 180000);
      } finally {
        await h.standin("/control/malformed", { count: 0 });
      }
      const exists = (await contract(api, converted)).contract;
      const retry = page
        .getByRole("region", { name: "AI analysis" })
        .getByRole("button", { name: "Retry Request-context Analysis" });
      await retry.waitFor({ timeout: 15000 });
      await retry.click();
      const done = await waitStatus(page, /^Request-context Analysis completed\./, 180000);
      const retryLeft = await retry.count();
      const run = await latestRun(api, converted);
      const rows = await resultRows(page).catch(() => []);
      const stats1 = await h.standin("/control/stats");
      await h.standin("/control/fallback", { enabled: false, cite: [] });
      const docs = (await h.ok(api.get(`/contracts/${converted}/documents`))).documents;
      const counterparties = (await contract(api, converted)).counterparties.map((c) => c.name);
      h.expectThat(
        run.trigger === "conversion" && run.state === "ready" && retryLeft === 0,
        `run ${q({ t: run.trigger, s: run.state })} retry ${retryLeft}`,
      );
      h.expectThat(
        stats1.last?.sourceKinds?.some((kind) => kind !== "document"),
        `last sources ${q(stats1.last)}`,
      );
      return `Fill Contract Fields after conversion: ${switchNote}. Jonas Weber submitted Request ${request.number} (${q(request.requestType.displayName)}) naming ${q(needle)}, and ${role} converted it to C-${converted} (both setup API). With the stand-in held, Fields read ${q(filling)}. With non-JSON replies the card read ${q(failedText)}; the Contract remained (${q(exists.title)}). Retry Request-context Analysis then read ${q(done)} and the retry control was gone. The latest run is trigger ${q(run.trigger)}; the stand-in's last call carried source kinds ${q(stats1.last.sourceKinds)} (${stats1.extractions - stats0.extractions} extraction calls). Result rows on the card: ${q(rows.map((r) => r.text))}. Documents on the Contract: ${docs.length} (the Request had no attachment, so promoted paper was not exercised). Counterparties: ${q(counterparties)}.`;
    },
  );
  save();
}

// ---------- V-C29 supplement: a new pair on an archived Document ----------
async function archivedNewPairWalk(role) {
  const A = "compare-versions";
  const me = sessions[role];
  const page = me.page;
  const api = me.api;
  const lower = short(role).toLowerCase();
  const otherType = (await h.ok(admin.get("/contract-types"))).contractTypes.find(
    (t) => t.displayName === "Other",
  );
  const number = (
    await h.ok(
      api.post("/contracts", {
        title: `DOC-029 analysis-standin Archived pair ${short(role)} ${stamp}`,
        contractTypeId: otherType.id,
      }),
    )
  ).contract.number;
  await h.ok(
    api.upload(`/contracts/${number}/documents`, {
      name: "doc029-placeholder.bin",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("DOC-029 download-only primary placeholder"),
    }),
  );
  let doc = (
    await h.ok(
      api.upload(
        `/contracts/${number}/documents`,
        await h.makeDocx(`doc029-archived-${lower}.docx`, ["Payment is due within thirty days."]),
      ),
    )
  ).document;
  doc = (
    await h.ok(
      api.upload(
        `/documents/${doc.id}/versions`,
        await h.makeDocx(`doc029-archived-${lower}.docx`, ["Payment is due within sixty days."]),
      ),
    )
  ).document;
  setupNote(
    `${role} API: Contract C-${number} with a placeholder primary and a two-Version Word Document that has never been compared.`,
  );
  await step(
    A,
    role,
    "Archiving does not stop comparing existing Versions (new pair on an archived Document)",
    "On an archived Document, Compare with previous for a pair that was never compared opens a Comparison that reaches Changes, offers no export, and adds no Version.",
    async () => {
      await openTab(page, number, "documents");
      const { menu } = await menuItems(page, `Actions for ${doc.title}`);
      await menu.getByRole("menuitem", { name: "Archive" }).click();
      const dlg = page.getByRole("alertdialog").or(page.getByRole("dialog"));
      if (await dlg.count()) await dlg.getByRole("button", { name: /^Archive/ }).click();
      await h.sleep(1500);
      await openTab(page, number, "documents");
      await page.getByRole("switch", { name: "Show archived" }).click();
      const actions = await menuItems(page, `Actions for ${doc.title}`);
      h.expectThat(
        actions.items.includes("Compare with previous"),
        `archived menu ${q(actions.items)}`,
      );
      await actions.menu.getByRole("menuitem", { name: "Compare with previous" }).click();
      await page.waitForURL(/\/compare\?/, { timeout: 30000 });
      await page.getByRole("heading", { name: "Changes" }).waitFor({ timeout: 90000 });
      const exportControls = await page
        .getByRole("button", { name: "Export track changes" })
        .count();
      const listed = (
        await h.ok(api.get(`/contracts/${number}/documents?includeArchived=true`))
      ).documents.find((d) => d.id === doc.id);
      h.expectThat(
        exportControls === 0 && listed.versions.length === 2,
        `export ${exportControls} versions ${listed.versions.length}`,
      );
      await h.ok(api.post(`/documents/${doc.id}/restore`));
      return `Documents -> Actions -> Archive on ${doc.title}; with Show archived on, its Actions still offered ${q(actions.items)}. Compare with previous opened a first-time v1 → v2 Comparison that reached Changes with no export control; the chain still has ${listed.versions.length} Versions. The Document was restored afterwards (API).`;
    },
  );
  save();
}

// ---------- V-C29 compare-versions ----------
async function compareWalk(role) {
  const A = "compare-versions";
  const me = sessions[role];
  const page = me.page;
  const api = me.api;
  const tag = `${short(role)} ${stamp}`;
  const otherType = (await h.ok(admin.get("/contract-types"))).contractTypes.find(
    (t) => t.displayName === "Other",
  );
  const number = (
    await h.ok(
      api.post("/contracts", {
        title: `DOC-029 analysis-standin Compare ${tag}`,
        contractTypeId: otherType.id,
      }),
    )
  ).contract.number;
  await h.ok(
    api.upload(`/contracts/${number}/documents`, {
      name: "doc029-placeholder.bin",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("DOC-029 download-only primary placeholder"),
    }),
  );
  const lower = short(role).toLowerCase();
  const para = (days, cadence) => [
    "DOC-029 fictional payment terms.",
    `Payment is due within ${days} days.`,
    `Invoices are issued ${cadence}.`,
  ];
  const word = async (days, cadence) =>
    h.makeDocx(`doc029-terms-${lower}.docx`, para(days, cadence));
  const uploadChain = async (files) => {
    const first = await h.ok(api.upload(`/contracts/${number}/documents`, files[0]));
    let doc = first.document;
    for (const file of files.slice(1))
      doc = (await h.ok(api.upload(`/documents/${doc.id}/versions`, file))).document;
    return doc;
  };
  const W = await uploadChain([
    await word("thirty", "monthly"),
    await word("sixty", "quarterly"),
    await word("ninety", "annually"),
  ]);
  const pdfThirty = await h.makePdf(
    browser,
    `doc029-mixed-${lower}.pdf`,
    para("thirty", "monthly"),
  );
  const P = await uploadChain([
    pdfThirty,
    { ...(await word("sixty", "monthly")), name: `doc029-mixed-${lower}.docx` },
  ]);
  const txt = {
    name: `doc029-plain-${lower}.txt`,
    mimeType: "text/plain",
    buffer: Buffer.from(para("thirty", "monthly").join("\n")),
  };
  const tPdf = await h.makePdf(
    browser,
    `doc029-plain-${lower}.pdf`,
    para("thirty", "monthly"),
    "first export",
  );
  const T = await uploadChain([txt, tPdf]);
  const X = await uploadChain([
    {
      name: `doc029-malformed-${lower}.pdf`,
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\nnot a real body\n%%EOF\n"),
    },
    await h.makePdf(browser, `doc029-malformed-${lower}.pdf`, para("thirty", "monthly")),
  ]);
  for (const doc of [W, P, T, X])
    for (const v of doc.versions)
      await textState(
        api,
        doc.id,
        v.id,
        ["ready", "failed", "unsupported", "empty", "not_applicable", "none"],
        120000,
      ).catch(() => null);
  await h.sleep(3000);
  setupNote(
    `${role} API: Contract C-${number} with a download-only primary placeholder and four supporting Documents: Word v1 thirty/monthly, v2 sixty/quarterly, v3 ninety/annually; PDF v1 / Word v2; TXT v1 / PDF v2; malformed PDF v1 / PDF v2.`,
  );
  results.records = [
    ...(results.records ?? []),
    {
      role,
      article: A,
      contract: number,
      documents: { word: W.id, mixed: P.id, plain: T.id, malformed: X.id },
    },
  ];
  const versionsOf = async (doc) =>
    (await h.ok(api.get(`/contracts/${number}/documents?includeArchived=true`))).documents.find(
      (d) => d.id === doc.id,
    )?.versions ?? [];
  const vid = (doc, n) => doc.versions.find((v) => v.versionNumber === n).id;
  const comparePath = (doc, from, to) =>
    `${h.BASE}/documents/${doc.id}/compare?from=${vid(doc, from)}&to=${vid(doc, to)}`;
  const pair = () =>
    page.getByRole("region", { name: /^Compare / }).getByRole("button", { name: /^v\d+ → v\d+$/ });
  const compareWithPrevious = async (doc) => {
    await openTab(page, number, "documents");
    const { menu, items } = await menuItems(page, `Actions for ${doc.title}`);
    h.expectThat(items.includes("Compare with previous"), `menu ${q(items)}`);
    await menu.getByRole("menuitem", { name: "Compare with previous" }).click();
    await page.waitForURL(/\/documents\/[^/]+\/compare\?/, { timeout: 30000 });
    await pair().waitFor({ timeout: 30000 });
  };

  await step(
    A,
    role,
    "Choose the Versions: Compare with previous, Preparing comparison, then Changes",
    "Compare with previous opens the pair v2 → v3; while processing is held the page says Preparing comparison and updates to Changes when ready; no Document Version is added.",
    async () => {
      h.pauseWorker();
      let pendingSeen;
      try {
        await compareWithPrevious(W);
        await page
          .getByRole("heading", { name: "Preparing comparison" })
          .waitFor({ timeout: 20000 });
        pendingSeen = (
          await page.getByRole("status").filter({ hasText: "Preparing comparison" }).innerText()
        ).replace(/\s+/g, " ");
      } finally {
        h.resumeWorker();
      }
      const label = (await pair().innerText()).trim();
      await page.getByRole("heading", { name: "Changes" }).waitFor({ timeout: 90000 });
      const count = (await versionsOf(W)).length;
      h.expectThat(label === "v2 → v3" && count === 3, `pair ${label} versions ${count}`);
      await openTab(page, number, "documents");
      await page.getByRole("button", { name: `Show the 2 earlier versions of ${W.title}` }).click();
      const { menu, items } = await menuItems(page, `Actions for version 2 of ${W.title}`);
      h.expectThat(items.includes("Compare with previous"), `version menu ${q(items)}`);
      await menu.getByRole("menuitem", { name: "Compare with previous" }).click();
      await page.waitForURL(/\/compare\?/);
      await h.until(
        async () =>
          (
            await pair()
              .innerText()
              .catch(() => "")
          ).trim() === "v1 → v2",
        "version action pair",
      );
      return `Version actions for version 2 also offered Compare with previous and opened "v1 → v2". Documents -> Actions for ${W.title} -> Compare with previous opened ${q(label)}. With this lab's worker paused the page read ${q(pendingSeen)}; after resuming it changed to the Changes view without a reload. The chain still has ${count} Versions.`;
    },
  );

  await step(
    A,
    role,
    "Pair control, change list, Previous change and Next change",
    "Choosing Older and Newer opens each pair at once; the choices keep the older before the newer; insertions and deletions describe the newer Version; Previous/Next move through changes.",
    async () => {
      await page.goto(comparePath(W, 2, 3));
      await page.getByRole("heading", { name: "Changes" }).waitFor({ timeout: 60000 });
      await pair().click();
      await page.getByLabel("Older").selectOption({ label: "v1" });
      await h.until(
        async () =>
          (
            await pair()
              .innerText()
              .catch(() => "")
          ).trim() === "v1 → v3",
        "v1 → v3",
      );
      await page
        .getByRole("heading", { name: "Changes" })
        .or(page.getByRole("heading", { name: "Preparing comparison" }))
        .first()
        .waitFor();
      await pair().click();
      const newerOptions = await page.getByLabel("Newer").locator("option").allInnerTexts();
      await page.getByLabel("Newer").selectOption({ label: "v2" });
      await h.until(
        async () =>
          (
            await pair()
              .innerText()
              .catch(() => "")
          ).trim() === "v1 → v2",
        "v1 → v2",
      );
      await page.getByRole("heading", { name: "Changes" }).waitFor({ timeout: 60000 });
      await pair().click();
      const olderOptions = await page.getByLabel("Older").locator("option").allInnerTexts();
      await page.keyboard.press("Escape");
      const changes = page
        .getByRole("complementary", { name: "Changes" })
        .getByRole("button", { name: /^¶/ });
      const names = await changes.evaluateAll((els) =>
        els.map(
          (e) => e.getAttribute("aria-label") + " = " + e.textContent.replace(/\s+/g, " ").trim(),
        ),
      );
      const doc = (
        await page.getByRole("region", { name: "Compared document" }).innerText()
      ).replace(/\s+/g, " ");
      h.expectThat(
        /Inserted: sixty/.test(doc) &&
          /Deleted: thirty/.test(doc) &&
          /Inserted: quarterly/.test(doc) &&
          /Deleted: monthly/.test(doc),
        `document ${q(doc)}`,
      );
      const current = async () =>
        changes.evaluateAll((els) =>
          els.findIndex((e) => e.getAttribute("aria-current") === "true"),
        );
      const c0 = await current();
      await page.getByRole("button", { name: "Next change" }).click();
      const c1 = await current();
      await page.getByRole("button", { name: "Previous change" }).click();
      const c2 = await current();
      h.expectThat(c0 === 0 && c1 === 1 && c2 === 0, `moves ${c0} ${c1} ${c2}`);
      h.expectThat(
        q(olderOptions) === q(["v1"]) && q(newerOptions) === q(["v2", "v3"]),
        `options ${q(olderOptions)} ${q(newerOptions)}`,
      );
      return `Older v1 opened v1 → v3 at once; Newer offered ${q(newerOptions)} and v2 opened v1 → v2. With v1 → v2, Older offered ${q(olderOptions)}. Changes: ${q(names)}. Compared text: ${q(doc)}. Next change moved the current change ${c0} -> ${c1}; Previous change moved it back to ${c2}.`;
    },
  );

  await step(
    A,
    role,
    "The Document reader offers Compare with the change count",
    "When a ready Comparison exists for the previous pair, the reader link shows its change count and opens that Comparison.",
    async () => {
      await openTab(page, number, "documents");
      await page.getByRole("button", { name: W.title, exact: true }).click();
      const panel = page.getByRole("complementary", { name: /version 3$/ });
      await panel.waitFor({ timeout: 30000 });
      const link = panel.getByRole("link", { name: /^Compare with the previous version/ });
      await link.waitFor({ timeout: 30000 });
      const name = (await link.getAttribute("aria-label")) ?? (await link.innerText());
      const panelName = await panel.getAttribute("aria-label");
      await link.click();
      await page.waitForURL(/\/compare\?/);
      await page.getByRole("heading", { name: "Changes" }).waitFor({ timeout: 30000 });
      const label = (await pair().innerText()).trim();
      h.expectThat(
        /\d+ changes?$/.test(name) && label === "v2 → v3",
        `link ${q(name)} pair ${label}`,
      );
      return `Reader panel ${q(panelName)} showed the link ${q(name)}; it opened ${q(label)} in the Changes view.`;
    },
  );

  await step(
    A,
    role,
    "Export a Word Comparison as a Generated redline",
    "Export track changes appends a Generated redline Version that records both operands; Open redline opens it; the file carries tracked changes; exporting again reuses it; reopening adds nothing; Generated redlines are not operands.",
    async () => {
      await page.goto(comparePath(W, 1, 2));
      await page.getByRole("heading", { name: "Changes" }).waitFor({ timeout: 60000 });
      await page.getByRole("button", { name: "Export track changes" }).click();
      const open = page.getByRole("link", { name: "Open redline" });
      await open.waitFor({ timeout: 60000 });
      const versions = await versionsOf(W);
      const v4 = versions.find((v) => v.versionNumber === 4);
      h.expectThat(
        v4 &&
          v4.kind === "generated_redline" &&
          v4.comparedFromVersionNumber === 1 &&
          v4.comparedToVersionNumber === 2,
        `v4 ${q(v4)}`,
      );
      const file = await api.bytes(`/documents/${W.id}/versions/${v4.id}/download`);
      const runs = await h.docxTrackedRuns(file.body);
      h.expectThat(
        q(runs.ins) === q(["sixty", "quarterly"]) && q(runs.del) === q(["thirty", "monthly"]),
        `runs ${q(runs)}`,
      );
      await open.click();
      const panel = page.getByRole("complementary", { name: /version 4$/ });
      try {
        await panel.waitFor({ timeout: 90000 });
      } catch (error) {
        const main = await page
          .locator("main")
          .ariaSnapshot()
          .catch(() => "");
        throw new Error(
          `reader did not open at ${page.url().replace(h.BASE, "")}: ${main.replace(/\s+/g, " ").slice(0, 600)}`,
        );
      }
      const panelName = await panel.getAttribute("aria-label");
      const cmp = (
        await h.ok(
          api.post(`/documents/${W.id}/comparisons`, {
            fromVersionId: vid(W, 1),
            toVersionId: vid(W, 2),
          }),
          [200, 201, 202],
        )
      ).comparison;
      const again = await api.post(`/documents/${W.id}/comparisons/${cmp.id}/export`);
      h.expectThat(
        again.status === 200 && again.json.version.id === v4.id,
        `repeat export ${again.status}`,
      );
      await page.goto(comparePath(W, 1, 2));
      await page.getByRole("link", { name: "Open redline" }).waitFor({ timeout: 30000 });
      await pair().click();
      const newer = await page.getByLabel("Newer").locator("option").allInnerTexts();
      await page.keyboard.press("Escape");
      const asOperand = await api.post(`/documents/${W.id}/comparisons`, {
        fromVersionId: vid(W, 2),
        toVersionId: v4.id,
      });
      const after = await versionsOf(W);
      h.expectThat(
        after.length === 4 && !newer.includes("v4") && asOperand.status === 400,
        `after ${after.length} ${q(newer)} ${asOperand.status}`,
      );
      return `On v1 → v2, Export track changes became Open redline. Version 4 is ${q(v4.kind)} compared from v${v4.comparedFromVersionNumber} to v${v4.comparedToVersionNumber}; its download (sha256 ${h.sha256(file.body).slice(0, 12)}…) has w:ins ${q(runs.ins)} and w:del ${q(runs.del)}. Open redline opened ${q(panelName)}. Exporting the same pair again answered ${again.status} with Version 4; reopening v1 → v2 showed Open redline; Newer offered ${q(newer)}; a request naming Version 4 as an operand answered ${asOperand.status}. The chain has ${after.length} Versions and v1-v3 remain.`;
    },
  );

  await step(
    A,
    role,
    "A text Comparison (PDF against Word)",
    "The page says it was built from extracted text, shows the wording change, shows Export needs two Word files. and cannot be exported.",
    async () => {
      await compareWithPrevious(P);
      await page.getByRole("heading", { name: "Changes" }).waitFor({ timeout: 90000 });
      const notice = await page
        .getByText("This comparison was built from extracted text, so formatting is not shown.")
        .count();
      const needs = await page.getByText("Export needs two Word files.").count();
      const exportButtons = await page
        .getByRole("button", { name: "Export track changes" })
        .count();
      const doc = (
        await page.getByRole("region", { name: "Compared document" }).innerText()
      ).replace(/\s+/g, " ");
      const cmp = (
        await h.ok(
          api.post(`/documents/${P.id}/comparisons`, {
            fromVersionId: vid(P, 1),
            toVersionId: vid(P, 2),
          }),
          [200, 201, 202],
        )
      ).comparison;
      const direct = await api.post(`/documents/${P.id}/comparisons/${cmp.id}/export`);
      const count = (await versionsOf(P)).length;
      h.expectThat(
        notice === 1 &&
          needs === 1 &&
          exportButtons === 0 &&
          direct.status === 409 &&
          /sixty/.test(doc) &&
          count === 2,
        `text ${notice} ${needs} ${exportButtons} ${direct.status} ${count}`,
      );
      return `PDF v1 → Word v2 showed the extracted-text notice and ${q("Export needs two Word files.")} with no export control. Compared text: ${q(doc.slice(0, 200))}. A direct export answered ${direct.status}; the chain still has ${count} Versions.`;
    },
  );

  await step(
    A,
    role,
    "If the Comparison fails: reason, Download links, no retry, corrected new Version",
    "A TXT operand and a failed PDF extraction each fail with a reason and Download links; reopening returns the same failure with no retry; a corrected new Version compares as No changes although its bytes differ.",
    async () => {
      await compareWithPrevious(T);
      await page.getByRole("heading", { name: "Comparison failed" }).waitFor({ timeout: 90000 });
      const card = page.getByRole("heading", { name: "Comparison failed" }).locator("..");
      const reason = (await card.locator("p").first().innerText()).trim();
      const links = page.getByRole("link", { name: /^Download / });
      const linkNames = await links.allInnerTexts();
      const hrefs = await links.evaluateAll((els) => els.map((e) => e.getAttribute("href")));
      const bytes = [];
      for (const href of hrefs)
        bytes.push(h.sha256((await api.bytes(href.replace(/^\/api\/v1/, ""))).body));
      h.expectThat(
        bytes[0] === h.sha256(txt.buffer) && bytes[1] === h.sha256(tPdf.buffer),
        "download bytes differ",
      );
      const firstUrl = page.url();
      const cmp1 = (
        await h.ok(
          api.post(`/documents/${T.id}/comparisons`, {
            fromVersionId: vid(T, 1),
            toVersionId: vid(T, 2),
          }),
          [200, 201, 202],
        )
      ).comparison;
      await page.reload();
      await page.getByRole("heading", { name: "Comparison failed" }).waitFor({ timeout: 30000 });
      const cmp2 = (
        await h.ok(
          api.post(`/documents/${T.id}/comparisons`, {
            fromVersionId: vid(T, 1),
            toVersionId: vid(T, 2),
          }),
          [200, 201, 202],
        )
      ).comparison;
      const retryButtons = await page.getByRole("main").getByRole("button").count();
      h.expectThat(
        cmp1.id === cmp2.id && cmp2.state === "failed" && retryButtons === 0,
        `reopen ${cmp1.id === cmp2.id} ${cmp2.state} buttons ${retryButtons}`,
      );
      const corrected = await h.makePdf(
        browser,
        `doc029-plain-${lower}.pdf`,
        para("thirty", "monthly"),
        "corrected export",
      );
      h.expectThat(h.sha256(corrected.buffer) !== h.sha256(tPdf.buffer), "corrected bytes equal");
      const T3 = (await h.ok(api.upload(`/documents/${T.id}/versions`, corrected))).document;
      await textState(api, T.id, vid(T3, 3), ["ready"]);
      await compareWithPrevious(T3);
      const label = (await pair().innerText()).trim();
      await page.getByRole("heading", { name: "No changes" }).waitFor({ timeout: 90000 });
      await compareWithPrevious(X);
      await page.getByRole("heading", { name: "Comparison failed" }).waitFor({ timeout: 90000 });
      const xReason = (
        await page
          .getByRole("heading", { name: "Comparison failed" })
          .locator("..")
          .locator("p")
          .first()
          .innerText()
      ).trim();
      const xLinks = await page.getByRole("link", { name: /^Download / }).count();
      h.expectThat(
        /text extraction failed|extract/i.test(xReason) && xLinks === 2,
        `malformed ${q(xReason)} ${xLinks}`,
      );
      return `TXT v1 → PDF v2 read "Comparison failed" with ${q(reason)} and ${q(linkNames)}; both downloads matched the uploaded bytes. Reloading ${firstUrl.replace(h.BASE, "")} returned the same failed Comparison (id unchanged) with no retry control. After adding a corrected PDF as Version 3 (setup, different sha256), Compare with previous opened ${q(label)} and read "No changes". Malformed PDF v1 → PDF v2 read ${q(xReason)} with ${xLinks} Download links.`;
    },
  );

  await step(
    A,
    role,
    "Archiving keeps Comparisons readable and blocks new Generated redlines until restored",
    "With the Document archived, Changes stay readable and no export is offered or accepted. With the owning Contract archived, the export is refused. After both are restored, the v2 → v3 export appends a Generated redline.",
    async () => {
      await openTab(page, number, "documents");
      const { menu } = await menuItems(page, `Actions for ${W.title}`);
      await menu.getByRole("menuitem", { name: "Archive" }).click();
      const dlg = page.getByRole("alertdialog").or(page.getByRole("dialog"));
      if (await dlg.count()) await dlg.getByRole("button", { name: /^Archive/ }).click();
      await h
        .until(
          async () =>
            (
              await h.ok(api.get(`/contracts/${number}/documents?includeArchived=true`))
            ).documents.find((d) => d.id === W.id && (d.archivedAt || d.archived)),
          "document archived",
          20000,
        )
        .catch(() => null);
      await page.goto(comparePath(W, 2, 3));
      await page.getByRole("heading", { name: "Changes" }).waitFor({ timeout: 60000 });
      const docArchivedButtons = await page
        .getByRole("button", { name: "Export track changes" })
        .count();
      const cmp = (
        await h.ok(
          api.post(`/documents/${W.id}/comparisons`, {
            fromVersionId: vid(W, 2),
            toVersionId: vid(W, 3),
          }),
          [200, 201, 202],
        )
      ).comparison;
      const refusedDoc = await api.post(`/documents/${W.id}/comparisons/${cmp.id}/export`);
      await h.ok(api.post(`/documents/${W.id}/restore`));
      await openTab(page, number, "");
      await menuItems(page, "Contract actions");
      await page.getByRole("menuitem", { name: "Archive" }).click();
      const dlg2 = page.getByRole("alertdialog").or(page.getByRole("dialog"));
      if (await dlg2.count()) await dlg2.getByRole("button", { name: /^Archive/ }).click();
      await h.until(
        async () => (await contract(api, number)).contract.archivedAt !== null,
        "contract archived",
      );
      await page.goto(comparePath(W, 2, 3));
      await page.getByRole("heading", { name: "Changes" }).waitFor({ timeout: 60000 });
      let ownerRefusal = "no export control shown";
      if (await page.getByRole("button", { name: "Export track changes" }).count()) {
        await page.getByRole("button", { name: "Export track changes" }).click();
        const alert = page.getByRole("region", { name: /^Compare / }).getByRole("alert");
        await alert.waitFor({ timeout: 20000 });
        ownerRefusal = `the control showed ${q((await alert.innerText()).trim())}`;
      }
      const refusedOwner = await api.post(`/documents/${W.id}/comparisons/${cmp.id}/export`);
      const countArchived = (await versionsOf(W)).length;
      await h.ok(api.post(`/contracts/${number}/restore`));
      await page.goto(comparePath(W, 2, 3));
      await page.getByRole("button", { name: "Export track changes" }).click();
      await page.getByRole("link", { name: "Open redline" }).waitFor({ timeout: 60000 });
      const versions = await versionsOf(W);
      const v5 = versions.find((v) => v.versionNumber === 5);
      const runs = await h.docxTrackedRuns(
        (await api.bytes(`/documents/${W.id}/versions/${v5.id}/download`)).body,
      );
      h.expectThat(
        docArchivedButtons === 0 &&
          refusedDoc.status === 409 &&
          refusedOwner.status === 409 &&
          countArchived === 4,
        `archive ${docArchivedButtons} ${refusedDoc.status} ${refusedOwner.status} ${countArchived}`,
      );
      h.expectThat(
        v5.kind === "generated_redline" &&
          v5.comparedFromVersionNumber === 2 &&
          v5.comparedToVersionNumber === 3 &&
          q(runs.ins) === q(["ninety", "annually"]) &&
          q(runs.del) === q(["sixty", "quarterly"]),
        `v5 ${q(v5)} ${q(runs)}`,
      );
      return `Documents -> Actions -> Archive on ${W.title}: v2 → v3 still showed Changes with no export control, and a direct export answered ${refusedDoc.status}. Document restored (API). Contract actions -> Archive on C-${number}: Changes stayed readable; ${ownerRefusal}; a direct export answered ${refusedOwner.status}; still ${countArchived} Versions. After Restore, Export track changes on v2 → v3 appended Version 5 (${v5.kind}, v2 -> v3; w:ins ${q(runs.ins)}, w:del ${q(runs.del)}).`;
    },
  );

  await step(
    A,
    role,
    "Close comparison returns to the owning record",
    "Close comparison opens the owning Contract's Documents section.",
    async () => {
      await page.goto(comparePath(W, 1, 2));
      await page.getByRole("link", { name: "Close comparison" }).click();
      await page.waitForURL(new RegExp(`/contracts/${number}/documents$`), { timeout: 20000 });
      await page.getByRole("button", { name: `Actions for ${W.title}` }).waitFor();
      return `Close comparison opened ${new URL(page.url()).pathname}, where ${W.title} and its Actions menu are listed.`;
    },
  );

  await step(
    A,
    role,
    "Only Administrators and Legal Team Members open Comparisons",
    "A Business User on the Contract team cannot open the Comparison page or request, read or export a Comparison.",
    async () => {
      const bu = sessions.business_user;
      const users = (await admin.get("/users")).json?.users ?? [];
      const jonas = users.find((u) => u.email === h.PEOPLE.business_user.email);
      const added = jonas
        ? (await admin.post(`/contracts/${number}/team`, { userId: jonas.id })).status
        : "no user list";
      await bu.page.goto(comparePath(W, 1, 2));
      await bu.page.waitForLoadState("networkidle").catch(() => {});
      const landed = new URL(bu.page.url()).pathname;
      const changes = await bu.page.getByRole("heading", { name: "Changes" }).count();
      const request = await bu.api.post(`/documents/${W.id}/comparisons`, {
        fromVersionId: vid(W, 1),
        toVersionId: vid(W, 2),
      });
      const cmp = (
        await h.ok(
          api.post(`/documents/${W.id}/comparisons`, {
            fromVersionId: vid(W, 2),
            toVersionId: vid(W, 3),
          }),
          [200, 201, 202],
        )
      ).comparison;
      const exp = await bu.api.post(`/documents/${W.id}/comparisons/${cmp.id}/export`);
      h.expectThat(
        changes === 0 &&
          !landed.includes("/compare") &&
          [403, 404].includes(request.status) &&
          [403, 404].includes(exp.status),
        `bu ${landed} ${changes} ${request.status} ${exp.status}`,
      );
      return `Jonas Weber (Business User; team add answered ${added}) opening the v1 → v2 Comparison URL landed on ${q(landed)} with no Changes view; requesting the pair answered ${request.status}; exporting answered ${exp.status}.`;
    },
  );
  save();
}

try {
  if (PARTS.includes("analysis")) {
    await analysisSetup();
    for (const role of ROLES) await analysisWalk(role);
  }
  if (PARTS.includes("conversion")) {
    if (!analysisType) await analysisSetup();
    for (const role of ROLES) await conversionWalk(role);
  }
  if (PARTS.includes("compare")) for (const role of ROLES) await compareWalk(role);
  if (PARTS.includes("archived-pair")) for (const role of ROLES) await archivedNewPairWalk(role);
} catch (error) {
  results.harnessError = String(error?.stack ?? error)
    .split("\n")
    .slice(0, 8)
    .join(" | ");
  console.error(error);
} finally {
  try {
    h.resumeWorker();
  } catch {
    // Not paused.
  }
  await h.standin("/control/pause", { paused: false }).catch(() => {});
  save();
  await browser.close();
}
