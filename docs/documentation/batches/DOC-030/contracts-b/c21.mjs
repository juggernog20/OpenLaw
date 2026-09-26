import { execFileSync } from "node:child_process";
// V-C21: "Review Contract analysis and verify values", followed as written for each role.
// Adapted from DOC-029 analysis-standin/walkthrough-r1.mjs for the DES-075 amendment layout
// (run controls and run note in the Fields section header; no AI analysis card).
// Provider mode: local stand-in (see walkthrough.mjs providerMode). Never a real provider.
const STANDIN_BASE = "http://doc030-cb-provider:8080/v1";
const MODEL = "doc030-contracts-b-standin-model";

export async function runC21(ctx, stepFor) {
  const { h, sessions, PEOPLE, stamp, browser, getBusinessUser, roles } = ctx;
  const { expectThat, sleep, text, q, BASE, until } = h;
  const admin = sessions.administrator.api;
  const setupNote = (s) => {
    ctx.setup.push({ at: new Date().toISOString(), text: s });
    console.log(`setup: ${s}`);
  };
  const short = (role) => (role === "administrator" ? "Admin" : "Legal");
  const otherOf = (role) => (role === "administrator" ? "legal_team_member" : "administrator");

  // ---------- helpers ----------
  // State read only: the stored marker map, which the record API filters (see the productBugs entry).
  const storedMarkers = (number) => {
    const out = execFileSync(
      "docker",
      [
        "--context",
        "default",
        "exec",
        `${h.LAB.project}-postgres-1`,
        "sh",
        "-c",
        `psql -U "\${POSTGRES_USER:-postgres}" -d "\${POSTGRES_DB:-openlaw}" -Atc "select coalesce(string_agg(k, ','), '') from contracts, jsonb_object_keys(coalesce(ai_unverified, '{}'::jsonb)) k where number = ${Number(number)}"`,
      ],
      { encoding: "utf8" },
    ).trim();
    return out ? out.split(",").sort() : [];
  };
  const contract = async (api, number) => api.ok("GET", `/contracts/${number}`);
  const markers = async (api, number) =>
    Object.keys((await contract(api, number)).contract.aiUnverified ?? {}).sort();
  const latestRun = async (api, number) => (await contract(api, number)).analysis.latestRun;
  const waitRun = (api, number, pred, msg, timeout = 120000) =>
    until(
      async () => {
        const run = await latestRun(api, number);
        return run && pred(run) ? run : null;
      },
      msg,
      timeout,
      750,
    );
  const textState = (api, documentId, versionId, want, timeout = 150000) =>
    until(
      async () => {
        const a = await api("GET", `/documents/${documentId}/versions/${versionId}/text`);
        const state = a.json?.text?.state;
        return want.includes(state) ? state : null;
      },
      `text state ${want} for ${versionId}`,
      timeout,
      1000,
    );
  async function openTab(page, number, tab) {
    const url = `${BASE}/contracts/${number}${tab ? `/${tab}` : ""}`;
    await page.goto(url);
    try {
      await page.getByRole("navigation", { name: "Contract sections" }).waitFor({ timeout: 25000 });
    } catch {
      ctx.notes.push(`reloaded ${url.replace(BASE, "")} once after a stalled render`);
      await page.goto(url);
      await page.getByRole("navigation", { name: "Contract sections" }).waitFor({ timeout: 30000 });
    }
    await page.waitForLoadState("networkidle").catch(() => {});
    await sleep(500);
  }
  const fieldsRegion = (page) => page.getByRole("region", { name: "Fields" });
  async function headerControls(page) {
    const region = fieldsRegion(page);
    await region.waitFor();
    const names = await region.getByRole("button").evaluateAll((els) =>
      els.map((e) => ({
        name: (e.getAttribute("aria-label") ?? e.textContent ?? "").trim(),
        disabled: e.disabled,
      })),
    );
    return names.filter((b) =>
      /^(Run analysis|Running…|Confirm all|Retry Request-context Analysis)$/.test(b.name),
    );
  }
  async function fieldsAlerts(page) {
    return (await fieldsRegion(page).getByRole("alert").allTextContents())
      .map((s) => s.trim())
      .filter(Boolean);
  }
  async function menuItems(page, name) {
    await page.getByRole("button", { name }).click();
    const menu = page.getByRole("menu").last();
    await menu.waitFor();
    const items = (await menu.getByRole("menuitem").allInnerTexts()).map((s) => s.trim());
    return { menu, items };
  }
  const sparkle = (page, label) =>
    page
      .getByRole("main")
      .getByRole("button", { name: `View AI evidence for ${label}`, exact: true });
  const rowConfirm = (page, label) =>
    sparkle(page, label)
      .locator("xpath=preceding-sibling::*[1]")
      .getByRole("button", { name: "Confirm" });

  // ---------- fixtures ----------
  let typeId;
  let fieldSlugs;
  let supplierName;
  let myKeyId = null;
  const connector0 = (await admin.ok("GET", "/ai-connector")).connector;

  function paper(marker, version) {
    const v1 = version === 1;
    return [
      `DOC-030 fictional services agreement, reference ${marker}.`,
      `This Agreement is made between Helix Software Group, Inc. and ${v1 ? "Doc030 Unknown Supplier LLC" : supplierName}.`,
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
      counterparties: {
        value: v1 ? "Doc030 Unknown Supplier LLC" : supplierName,
        evidence: v1 ? "Doc030 Unknown Supplier LLC" : supplierName,
      },
      [fieldSlugs.location.slug]: {
        value: v1 ? "Muscat" : "Doha",
        evidence: `The services are performed in ${v1 ? "Muscat" : "Doha"}.`,
      },
      [fieldSlugs.tier.slug]: {
        value: v1 ? 1 : 2,
        evidence: `The service tier is ${v1 ? "1" : "2"}.`,
      },
      [fieldSlugs.absent.slug]: {
        value: "Annual audit",
        evidence: "The customer may audit the supplier once a year.",
      },
      "key_dates:milestones": { value: kd },
    };
  }

  async function setup() {
    if (
      connector0.configured &&
      connector0.baseUrl !== `${STANDIN_BASE}/` &&
      connector0.baseUrl !== STANDIN_BASE
    )
      throw new Error(
        `the work2 AI connector is already configured by someone else (${connector0.preset} ${connector0.baseUrl}); V-C21 not started`,
      );
    const saved = await admin.ok("PUT", "/ai-connector", {
      preset: "custom",
      protocol: "openai_chat_completions",
      baseUrl: STANDIN_BASE,
      apiKey: h.STANDIN_KEY,
      model: MODEL,
    });
    myKeyId =
      saved.connector.savedKeys?.find((k) => (k.baseUrl ?? "").startsWith(STANDIN_BASE))?.id ??
      null;
    if (!saved.connector.enabled) await admin.ok("POST", "/ai-connector/enable");
    setupNote(
      `Administrator API: AI connector (was ${connector0.configured ? "configured" : "not configured"}, ${connector0.enabled ? "enabled" : "disabled"}) saved as Custom, OpenAI chat completions, base URL ${STANDIN_BASE} (the stand-in), model ${MODEL}, and enabled for V-C21 only. Prerequisite preparation from configure-analysis, not a C21 step.`,
    );
    const type = await admin.ok("POST", "/contract-types", {
      displayName: `DOC-030 contracts-b Analysis type ${stamp}`,
    });
    typeId = type.contractType.id;
    fieldSlugs = {};
    const newRows = [];
    for (const [key, displayName, fieldType, prompt] of [
      [
        "location",
        `DOC-030 Service location ${stamp}`,
        "text",
        "Extract the city where the services are performed.",
      ],
      ["tier", `DOC-030 Service tier ${stamp}`, "number", "Extract the numeric service tier."],
      ["absent", `DOC-030 Audit clause ${stamp}`, "text", "Extract the audit clause summary."],
    ]) {
      const field = await admin.ok("POST", "/fields", {
        displayName,
        moduleScope: "contract",
        fieldType,
        fieldTag: "legal",
        aiPrompt: prompt,
      });
      fieldSlugs[key] = { slug: field.field.slug, label: displayName, id: field.field.id };
      newRows.push({
        kind: "row",
        id: field.field.id,
        rowRef: field.field.slug,
        fieldType,
        onIntakeForm: false,
        isRequired: false,
        visibleOnPortal: false,
      });
    }
    const form = (await admin.ok("GET", `/contract-types/${typeId}/form`)).form;
    await admin.ok("PUT", `/contract-types/${typeId}/form`, { form: [...form, ...newRows] });
    const holder = await admin.ok("POST", "/contracts", {
      title: `DOC-030 contracts-b V-C21 Counterparty holder ${stamp}`,
      contractTypeId: typeId,
    });
    supplierName = `DOC-030 Analysis Supplier ${stamp} Ltd`;
    await admin.ok("POST", `/contracts/${holder.contract.number}/counterparties`, {
      name: supplierName,
    });
    ctx.records.push({
      article: "contract-analysis",
      role: "administrator",
      reference: `C-${holder.contract.number}`,
      title: `DOC-030 contracts-b V-C21 Counterparty holder ${stamp}`,
    });
    setupNote(
      `Administrator API: Contract type "DOC-030 contracts-b Analysis type ${stamp}" whose Form gains three prompted record Rows (text location, number tier, text audit clause), and live Counterparty "${supplierName}" on holder Contract C-${holder.contract.number}.`,
    );
  }

  async function restore() {
    const now = (await admin.ok("GET", "/ai-connector")).connector;
    if (now.configured && (now.baseUrl ?? "").startsWith(STANDIN_BASE)) {
      if (!connector0.configured) {
        const d = await admin("DELETE", "/ai-connector");
        setupNote(
          `Administrator API: removed the stand-in AI connector (DELETE ${d.status}); work2 is back to no AI connector.`,
        );
      } else {
        setupNote(
          "Administrator API: the connector was configured before V-C21; it was left on the stand-in. Manual restore needed.",
        );
      }
    } else
      setupNote(
        `Restore: the connector no longer points at the stand-in (${now.baseUrl}); left as is.`,
      );
    const keys = (await admin.ok("GET", "/ai-connector")).connector.savedKeys ?? [];
    for (const k of keys.filter(
      (k) => (k.baseUrl ?? "").startsWith(STANDIN_BASE) || k.id === myKeyId,
    )) {
      const d = await admin("DELETE", `/ai-connector/saved-keys/${k.id}`);
      setupNote(`Administrator API: deleted the stand-in Saved key (${d.status}).`);
    }
    const after = (await admin.ok("GET", "/ai-connector")).connector;
    setupNote(
      `Connector after restore: configured ${after.configured}, enabled ${after.enabled}, saved keys ${after.savedKeys.length}, conversion analysis ${after.contractConversionAnalysis}.`,
    );
  }

  // ---------- one role ----------
  async function walk(role) {
    const step = stepFor(role);
    const me = sessions[role];
    const them = sessions[otherOf(role)];
    const page = me.page;
    const api = me.api;
    const tag = `${short(role)} ${stamp}`;
    const mk = async (suffix) =>
      (
        await api.ok("POST", "/contracts", {
          title: `DOC-030 contracts-b V-C21 ${suffix} ${tag}`,
          contractTypeId: typeId,
          managerId: null,
        })
      ).contract.number;
    const noPaper = await mk("No paper");
    const failedPaper = await mk("Failed extraction");
    const main = await mk("Main");
    const marker = `DOC030CB${short(role).toUpperCase()}${stamp}`;
    const markerV2 = `${marker}V2`;
    for (const [n, s] of [
      [noPaper, "No paper"],
      [failedPaper, "Failed extraction"],
      [main, "Main"],
    ])
      ctx.records.push({
        article: "contract-analysis",
        role,
        reference: `C-${n}`,
        title: `DOC-030 contracts-b V-C21 ${s} ${tag}`,
      });
    setupNote(
      `${role} API: created C-${noPaper} (no paper), C-${failedPaper} (unreadable primary PDF) and C-${main} (main walk) of the analysis type; stand-in markers ${marker} and ${markerV2}.`,
    );

    await step(
      "If Analysis cannot finish: no primary Document; Run analysis in the Fields header and in the Contract actions menu",
      "The refusal reason shows under the Fields section header for both entry points; no run is created",
      async () => {
        await openTab(page, noPaper, "fields");
        const controls = await headerControls(page);
        await fieldsRegion(page).getByRole("button", { name: "Run analysis" }).click();
        await fieldsRegion(page).getByRole("alert").first().waitFor({ timeout: 15000 });
        const fromHeader = await fieldsAlerts(page);
        await openTab(page, noPaper, "");
        const { menu, items } = await menuItems(page, "Contract actions");
        await menu.getByRole("menuitem", { name: "Run analysis" }).click();
        await sleep(1500);
        await page
          .getByRole("navigation", { name: "Contract sections" })
          .getByRole("link", { name: "Fields" })
          .click();
        await fieldsRegion(page).getByRole("alert").first().waitFor({ timeout: 15000 });
        const fromMenu = await fieldsAlerts(page);
        const run = await latestRun(api, noPaper);
        expectThat(
          controls.some((c) => c.name === "Run analysis"),
          `header ${q(controls)}`,
        );
        expectThat(items.includes("Run analysis"), `menu ${q(items)}`);
        expectThat(
          fromHeader.some((a) => /primary Document/i.test(a)) &&
            fromMenu.some((a) => /primary Document/i.test(a)),
          `alerts ${q({ fromHeader, fromMenu })}`,
        );
        expectThat(run === null, "a run was created");
        return `C-${noPaper} Fields header offered ${q(controls.map((c) => c.name))}. Run analysis showed ${q(fromHeader)} under the Fields header. Overview -> Contract actions (${q(items)}) -> Run analysis, then the Fields tab, showed ${q(fromMenu)} in the same place. No Analysis run exists.`;
      },
      { page },
    );

    await step(
      "If Analysis cannot finish: failed extraction of the primary Document text",
      "No automatic run starts and Run analysis is refused because the target text is not ready or is empty",
      async () => {
        const broken = {
          name: `doc030-broken-${short(role).toLowerCase()}.pdf`,
          mimeType: "application/pdf",
          buffer: Buffer.from("%PDF-1.7\nthis is not a readable PDF body\n%%EOF\n"),
        };
        const up = (await api.upload(`/contracts/${failedPaper}/documents`, broken)).json;
        const state = await textState(api, up.document.id, up.document.versions[0].id, [
          "failed",
          "ready",
          "empty",
          "unsupported",
        ]);
        expectThat(state !== "ready", `text state ${state}`);
        await openTab(page, failedPaper, "fields");
        await fieldsRegion(page).getByRole("button", { name: "Run analysis" }).click();
        await fieldsRegion(page).getByRole("alert").first().waitFor({ timeout: 15000 });
        const alerts = await fieldsAlerts(page);
        expectThat(
          alerts.some((a) => /text/i.test(a)),
          `alerts ${q(alerts)}`,
        );
        expectThat((await latestRun(api, failedPaper)) === null, "a run exists");
        return `Uploaded an unreadable PDF as C-${failedPaper}'s primary Document (setup API); its text state became ${q(state)}; no automatic run. Run analysis showed ${q(alerts)} under the Fields header and created no run.`;
      },
      { page },
    );

    await step(
      "If Analysis cannot finish: with the connector disabled, no run and no marked value, the Fields header shows no Analysis controls",
      "No Run analysis or Confirm all in the Fields header or Run analysis in Contract actions; a direct run is refused; enabling brings Run analysis back",
      async () => {
        await admin.ok("POST", "/ai-connector/disable");
        let out;
        try {
          await openTab(page, noPaper, "fields");
          const controls = await headerControls(page);
          const { items } = await menuItems(page, "Contract actions");
          await page.keyboard.press("Escape");
          const direct = await api("POST", `/contracts/${noPaper}/analysis`);
          expectThat(controls.length === 0, `controls ${q(controls)}`);
          expectThat(!items.includes("Run analysis"), `menu ${q(items)}`);
          expectThat(direct.status === 409, `direct ${direct.status}`);
          out = `Administrator disabled the connector (setup API). C-${noPaper} Fields header had no Analysis controls; Contract actions offered ${q(items)}; a direct run answered ${direct.status} ${q(direct.json?.detail)}.`;
        } finally {
          await admin.ok("POST", "/ai-connector/enable");
        }
        await openTab(page, noPaper, "fields");
        const back = await headerControls(page);
        expectThat(
          back.some((c) => c.name === "Run analysis"),
          `after enable ${q(back)}`,
        );
        return `${out} After enabling, the header shows ${q(back.map((c) => c.name))}.`;
      },
      { page },
    );

    let v1Doc;
    await step(
      "Run Analysis and read its outcome: an automatic run starts when the target text becomes ready; the control says Running… and stays disabled; a finished run shows no summary sentence; values carry Unverified where they live",
      "Running… disabled while pending; after the run the record updates with markers on Overview, Fields and Key dates; unsupported, invalid and unmatched answers write nothing; no Counterparty is linked",
      async () => {
        await h.standin("/control/register", { marker, answers: answers(1) });
        await h.standin("/control/pause", { paused: true });
        let pendingControls;
        try {
          const pdf = await h.makePdf(
            browser,
            `doc030-services-${short(role).toLowerCase()}.pdf`,
            paper(marker, 1),
          );
          v1Doc = (await api.upload(`/contracts/${main}/documents`, pdf)).json.document;
          await waitRun(api, main, (r) => r.state === "pending", "automatic run queued", 150000);
          await openTab(page, main, "fields");
          await until(
            async () => (await headerControls(page)).some((c) => c.name === "Running…"),
            "Running… shown",
            30000,
          );
          pendingControls = await headerControls(page);
          const menuRun = await menuItems(page, "Contract actions");
          await page.keyboard.press("Escape");
          pendingControls.push({ menu: menuRun.items });
        } finally {
          await h.standin("/control/pause", { paused: false });
        }
        await waitRun(api, main, (r) => r.state === "ready", "run finished");
        await until(
          async () => (await headerControls(page)).some((c) => c.name === "Run analysis"),
          "record updated in place",
          60000,
        );
        const note = (await fieldsAlerts(page)).concat(
          await fieldsRegion(page).getByRole("status").allTextContents(),
        );
        const record = await contract(api, main);
        const flagged = Object.keys(record.contract.aiUnverified ?? {}).sort();
        const fieldsText = await text(fieldsRegion(page));
        const locationShown = await fieldsRegion(page)
          .getByRole("textbox", { name: fieldSlugs.location.label })
          .inputValue();
        const unverifiedOnFields = await fieldsRegion(page)
          .getByText("Unverified", { exact: true })
          .count();
        const kd = (await api.ok("GET", `/contracts/${main}/key-dates`)).deadlines;
        const running = pendingControls.find((c) => c.name === "Running…");
        expectThat(
          running && running.disabled && !pendingControls.some((c) => c.name === "Run analysis"),
          `pending controls ${q(pendingControls)}`,
        );
        expectThat(
          record.analysis.latestRun.trigger === "automatic",
          `trigger ${record.analysis.latestRun.trigger}`,
        );
        const want = [
          "expiry_date",
          "notice_period_days",
          "value",
          fieldSlugs.location.slug,
          fieldSlugs.tier.slug,
        ].sort();
        expectThat(
          want.every((s) => flagged.includes(s)) &&
            !flagged.includes("effective_date") &&
            !flagged.includes("term_type") &&
            !flagged.includes("counterparties") &&
            !flagged.includes(fieldSlugs.absent.slug),
          `markers ${q(flagged)}`,
        );
        expectThat(record.counterparties.length === 0, "a Counterparty was linked");
        expectThat(
          kd.some((d) => d.label === "Price review" && d.unverified) &&
            !kd.some((d) => d.label === "Contract expiry"),
          `key dates ${q(kd.map((d) => d.label))}`,
        );
        expectThat(
          note.filter((n) => /complet|finished|wrote|written/i.test(n)).length === 0,
          `summary sentence ${q(note)}`,
        );
        expectThat(
          locationShown === "Muscat" && unverifiedOnFields >= 2,
          `fields ${locationShown} ${unverifiedOnFields}`,
        );
        expectThat(
          !/Unmatched|Doc030 Unknown Supplier/.test(await text(page.getByRole("main"))),
          "unmatched name surfaced",
        );
        return `Uploaded the Version 1 PDF as C-${main}'s primary Document (setup API; stand-in held). Fields header while pending: ${q(pendingControls)} (Running… disabled, no Run analysis). After the stand-in answered, without a reload the header showed Run analysis again and no summary sentence (alerts/status: ${q(note)}). Unverified keys: ${q(flagged)} (Fields shows ${unverifiedOnFields} Unverified markers; location ${q(locationShown)}). Effective date (invalid answer), Term type (null), audit clause (quote not in text) and the unknown Counterparty wrote nothing; no Counterparty linked and the page does not mention the unmatched name. Key dates: Price review added Unverified; the Contract expiry milestone matched the term date and added nothing.`;
      },
      { page },
    );

    await step(
      "The record updates when the run finishes while preserving typed drafts",
      "A value typed but not saved on Fields stays in its control when a pending run completes",
      async () => {
        const draftContract = await mk("Typed draft");
        ctx.records.push({
          article: "contract-analysis",
          role,
          reference: `C-${draftContract}`,
          title: `DOC-030 contracts-b V-C21 Typed draft ${tag}`,
        });
        const draftMarker = `${marker}DRAFT`;
        await h.standin("/control/register", { marker: draftMarker, answers: answers(1) });
        await h.standin("/control/pause", { paused: true });
        try {
          const pdf = await h.makePdf(
            browser,
            `doc030-draft-${short(role).toLowerCase()}.pdf`,
            paper(draftMarker, 1),
          );
          await api.upload(`/contracts/${draftContract}/documents`, pdf);
          await waitRun(
            api,
            draftContract,
            (r) => r.state === "pending",
            "draft run queued",
            150000,
          );
          await openTab(page, draftContract, "fields");
          await fieldsRegion(page)
            .getByRole("textbox", { name: fieldSlugs.absent.label })
            .fill("DOC-030 unsaved draft text");
        } finally {
          await h.standin("/control/pause", { paused: false });
        }
        await waitRun(api, draftContract, (r) => r.state === "ready", "draft run finished");
        await until(
          async () =>
            (await fieldsRegion(page)
              .getByRole("textbox", { name: fieldSlugs.location.label })
              .inputValue()) === "Muscat",
          "location updated",
          60000,
        );
        const shown = await fieldsRegion(page)
          .getByRole("textbox", { name: fieldSlugs.absent.label })
          .inputValue();
        expectThat(shown === "DOC-030 unsaved draft text", `draft ${q(shown)}`);
        return `C-${draftContract}: typed "DOC-030 unsaved draft text" into ${fieldSlugs.absent.label} (not saved) while the run was pending. When the record updated and ${fieldSlugs.location.label} showed "Muscat", the typed draft was still in its control.`;
      },
      { page },
    );

    await step(
      "Contract actions offers Run analysis from any section; each newly AI-written value on Overview has the purple border, the Unverified indicator, an evidence sparkle and Confirm",
      "Menu item present on Overview; Overview rows show marker, sparkle, Confirm and the AI border",
      async () => {
        await openTab(page, main, "");
        const { items } = await menuItems(page, "Contract actions");
        await page.keyboard.press("Escape");
        const mainRegion = page.getByRole("main");
        const sparkles = await mainRegion
          .getByRole("button", { name: /^View AI evidence for / })
          .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
        const unverified = await mainRegion.getByText("Unverified", { exact: true }).count();
        const confirms = await rowConfirm(page, "Notice period (days)").count();
        const notice = mainRegion.getByRole("spinbutton", { name: "Notice period (days)" });
        const border = await notice.evaluate((el) => {
          const wrap = el.closest(".ai-field");
          if (!wrap) return null;
          return {
            generated: wrap.getAttribute("data-ai-generated"),
            pseudo: getComputedStyle(wrap, "::after").backgroundImage.slice(0, 60),
          };
        });
        expectThat(items.includes("Run analysis"), `menu ${q(items)}`);
        expectThat(
          sparkles.includes("View AI evidence for Expiry date") &&
            sparkles.includes("View AI evidence for Notice period (days)") &&
            sparkles.includes("View AI evidence for Value"),
          `sparkles ${q(sparkles)}`,
        );
        expectThat(
          confirms === 1 && unverified >= 3,
          `confirm ${confirms} unverified ${unverified}`,
        );
        expectThat(
          border?.generated === "true" && /gradient/.test(border.pseudo),
          `border ${q(border)}`,
        );
        return `Overview Contract actions: ${q(items)}. Overview shows ${unverified} Unverified indicators, sparkles ${q(sparkles)}, and Confirm beside Notice period (days); the Notice period control sits in an AI border wrapper ${q(border)}.`;
      },
      { page },
    );

    await step(
      "Select the sparkle to open the cited original Document Version in the same-page doc panel and locate its quoted passage",
      "The sparkle opens Version 1 in the doc panel with the quoted passage marked; a Key date sparkle does the same",
      async () => {
        await sparkle(page, "Notice period (days)").click();
        const panel = page.getByRole("complementary", { name: /, version 1$/ });
        await panel.waitFor({ timeout: 30000 });
        const mark = panel.locator("mark").first();
        await mark.waitFor({ timeout: 30000 });
        const marked = (await mark.textContent()).trim();
        const name = await panel.getAttribute("aria-label");
        const url = page.url();
        await panel.getByRole("button", { name: "Close the document" }).click();
        await openTab(page, main, "key-dates");
        const priceRow = page
          .getByRole("region", { name: "Key dates" })
          .getByRole("row", { name: /Price review/ });
        const priceText = await text(priceRow);
        await priceRow.getByRole("button", { name: "View AI evidence for Price review" }).click();
        const kdPanel = page.getByRole("complementary", { name: /, version 1$/ });
        await kdPanel.locator("mark").first().waitFor({ timeout: 30000 });
        const kdMark = (await kdPanel.locator("mark").first().textContent()).trim();
        await kdPanel.getByRole("button", { name: "Close the document" }).click();
        expectThat(marked === "at least 60 days before expiry", `marked ${q(marked)}`);
        expectThat(/Unverified/.test(priceText), `price row ${q(priceText)}`);
        return `Overview Notice period sparkle opened ${q(name)} on the same page (${url.replace(BASE, "")}) with ${q(marked)} marked. Key dates row ${q(priceText)}: its sparkle opened the same Version with ${q(kdMark)} marked.`;
      },
      { page },
    );

    await step(
      "Unverified values are already usable",
      "Before confirmation the extracted Key date is in the list, the notice period drives the derived deadline, and the Value is saved",
      async () => {
        await openTab(page, main, "key-dates");
        const rows = (
          await page.getByRole("region", { name: "Key dates" }).getByRole("row").allInnerTexts()
        ).map((t) => t.replace(/\s+/g, " ").trim());
        const record = await contract(api, main);
        expectThat(
          rows.some((r) => /Price review/.test(r)),
          "no Price review row",
        );
        expectThat(
          rows.some((r) => /notice/i.test(r) && /60 days before expiry/.test(r)),
          `no derived notice deadline in ${q(rows)}`,
        );
        expectThat(
          record.contract.value?.amount === 250000 &&
            record.contract.value.currency === "USD" &&
            record.contract.value.cadence === "monthly",
          `value ${q(record.contract.value)}`,
        );
        return `Key dates rows before any confirmation: ${q(rows.slice(1))}. Saved Value ${q(record.contract.value)}; notice deadline ${record.contract.noticeDeadline}.`;
      },
      { page },
    );

    await step(
      "Confirm or correct one value: Confirm beside a value; edit a Field; Key date note-only edit then event edit; Confirm all shows in the Fields header while more than one value is marked; History records the confirmation",
      "Confirm clears only that marker; editing clears its marker; a note-only change keeps the Key date marker and an event change clears it; History shows the confirmation",
      async () => {
        const before = await markers(api, main);
        await openTab(page, main, "");
        await rowConfirm(page, "Notice period (days)").click();
        await until(
          async () => !(await markers(api, main)).includes("notice_period_days"),
          "notice marker cleared",
        );
        await sleep(600);
        const sparkleGone = (await sparkle(page, "Notice period (days)").count()) === 0;
        const afterConfirm = await markers(api, main);
        expectThat(
          afterConfirm.length === before.length - 1,
          `confirm cleared ${before.length - afterConfirm.length}`,
        );
        expectThat(
          (await contract(api, main)).contract.noticePeriodDays === 60,
          "notice value changed",
        );
        await openTab(page, main, "fields");
        const locationBox = fieldsRegion(page).getByRole("textbox", {
          name: fieldSlugs.location.label,
        });
        await locationBox.fill("Salalah");
        await locationBox.blur();
        await until(
          async () =>
            (await contract(api, main)).contract.customFields[fieldSlugs.location.slug] ===
            "Salalah",
          "location saved",
        );
        const afterEdit = await markers(api, main);
        expectThat(
          !afterEdit.includes(fieldSlugs.location.slug) &&
            afterEdit.length === afterConfirm.length - 1,
          `after edit ${q(afterEdit)}`,
        );
        await openTab(page, main, "key-dates");
        const kd = page.getByRole("region", { name: "Key dates" });
        const editKd = async (label, change) => {
          await kd.getByRole("button", { name: `Actions for ${label}` }).click();
          await page.getByRole("menuitem", { name: "Edit date" }).click();
          const dialog = page.getByRole("dialog", { name: "Edit key date" });
          await dialog.waitFor();
          await change(dialog);
          await dialog.getByRole("button", { name: "Save" }).click();
          await dialog.waitFor({ state: "hidden", timeout: 15000 });
        };
        await editKd("Price review", (d) =>
          d.getByRole("textbox", { name: "Note" }).fill("DOC-030 note only"),
        );
        await sleep(1000);
        const priceMarked = async (label) =>
          (await api.ok("GET", `/contracts/${main}/key-dates`)).deadlines.find(
            (d) => d.label === label,
          )?.unverified;
        const afterNote = await priceMarked("Price review");
        await editKd("Price review", (d) =>
          d.getByRole("textbox", { name: "Event" }).fill("Annual price review"),
        );
        await until(
          async () =>
            (await priceMarked("Annual price review")) === false ||
            (await priceMarked("Annual price review")) === undefined ||
            (await priceMarked("Annual price review")) === null,
          "key date marker cleared",
        );
        const afterEvent = await markers(api, main);
        await openTab(page, main, "fields");
        const controls = await headerControls(page);
        await page.getByRole("button", { name: "History" }).click();
        const history = page.getByRole("complementary", { name: "History" });
        await history.waitFor();
        await sleep(1500);
        const entry = history.getByText(/confirmed/i).first();
        await entry.waitFor({ timeout: 15000 });
        const historyText = (await entry.textContent()).trim();
        const analysisEntry = (
          await history.getByText(/AI analysis of this contract/).allTextContents()
        ).slice(0, 3);
        await history.getByRole("button", { name: "Close" }).click();
        expectThat(afterNote === true, `note-only edit cleared the marker (${afterNote})`);
        expectThat(
          controls.some((c) => c.name === "Confirm all") && afterEvent.length > 1,
          `Confirm all ${q(controls)} with ${afterEvent.length} markers`,
        );
        expectThat(sparkleGone, "sparkle still shown after Confirm");
        expectThat(analysisEntry.length > 0, "History shows no Analysis entry");
        return `Overview Confirm beside Notice period (days) kept 60 and cleared only its marker and sparkle (${before.length} -> ${afterConfirm.length} marked). Editing ${fieldSlugs.location.label} to Salalah on Fields cleared its marker (${afterEdit.length} left). Key dates: Edit date with a note-only change kept Price review Unverified; changing the event to "Annual price review" cleared it. Fields header with ${afterEvent.length} marked values: ${q(controls.map((c) => c.name))}. History: ${q(historyText)}; Analysis entries ${q(analysisEntry)}.`;
      },
      { page },
    );

    let v2Doc;
    let pinnedRunId;
    await step(
      "Rerun after a change: marking Version 1 executed runs on Version 1; a newer upload does not displace the pin or start a run; the evidence still opens the Version that run read; Run analysis reads Version 1",
      "Pin run on Version 1 keeps confirmed and edited values and does not add the reviewed Key date again; Version 2 upload sends nothing to the provider; sparkle opens Version 1; manual run reads Version 1",
      async () => {
        const runBefore = await latestRun(api, main);
        await openTab(page, main, "documents");
        const { menu, items } = await menuItems(page, `Actions for ${v1Doc.title}`);
        expectThat(items.includes("Mark as executed copy"), `menu ${q(items)}`);
        await menu.getByRole("menuitem", { name: "Mark as executed copy" }).click();
        const pinnedRun = await waitRun(
          api,
          main,
          (r) => r.id !== runBefore.id && r.state === "ready",
          "run after pin",
        );
        pinnedRunId = pinnedRun.id;
        const c1 = (await contract(api, main)).contract;
        const kd1 = (await api.ok("GET", `/contracts/${main}/key-dates`)).deadlines;
        await h.standin("/control/register", { marker: markerV2, answers: answers(2) });
        const statsBefore = await h.standin("/control/stats");
        const pdf2 = await h.makePdf(browser, v1Doc.title, paper(markerV2, 2));
        v2Doc = (await api.upload(`/documents/${v1Doc.id}/versions`, pdf2)).json.document;
        const v2 = v2Doc.versions.find((v) => v.versionNumber === 2);
        await textState(api, v1Doc.id, v2.id, ["ready"]);
        await sleep(6000);
        const statsAfter = await h.standin("/control/stats");
        const runAfterUpload = await latestRun(api, main);
        await openTab(page, main, "");
        await sparkle(page, "Expiry date").click();
        const panel = page.getByRole("complementary", { name: /, version \d+$/ });
        await panel.waitFor({ timeout: 30000 });
        const panelName = await panel.getAttribute("aria-label");
        await panel.getByRole("button", { name: "Close the document" }).click();
        await openTab(page, main, "fields");
        await fieldsRegion(page).getByRole("button", { name: "Run analysis" }).click();
        const manual = await waitRun(
          api,
          main,
          (r) => r.id !== pinnedRun.id && r.state === "ready",
          "manual run",
        );
        expectThat(
          pinnedRun.versionNumber === 1 && pinnedRun.trigger === "automatic",
          `pinned run ${q(pinnedRun)}`,
        );
        expectThat(
          c1.noticePeriodDays === 60 && c1.customFields[fieldSlugs.location.slug] === "Salalah",
          `kept ${c1.noticePeriodDays} ${c1.customFields[fieldSlugs.location.slug]}`,
        );
        expectThat(!kd1.some((d) => d.label === "Price review"), "Price review re-added");
        expectThat(
          runAfterUpload.id === pinnedRun.id && statsAfter.extractions === statsBefore.extractions,
          "a run started after the newer upload",
        );
        expectThat(/version 1$/.test(panelName), `evidence opened ${panelName}`);
        expectThat(
          manual.trigger === "manual" && manual.versionNumber === 1,
          `manual ${q(manual)}`,
        );
        return `Documents: Actions for ${v1Doc.title} -> Mark as executed copy started an automatic run on Version ${pinnedRun.versionNumber}; notice stayed 60 (confirmed), location stayed Salalah (edited), and "Price review" was not added again. Version 2 uploaded (setup API) and its text became ready: no new run and no provider request (${statsBefore.extractions} -> ${statsAfter.extractions}). Overview Expiry date sparkle still opened ${q(panelName)}. Run analysis then ran manually on Version ${manual.versionNumber}.`;
      },
      { page },
    );

    await step(
      "Rerun on changed input while another legal person edits a value: marking Version 2 executed runs on Version 2",
      "An unverified value is replaced by the new answer; confirmed, edited and concurrently edited values are kept; the matching live Counterparty is linked; a new milestone is added; the evidence then opens Version 2",
      async () => {
        const before = await latestRun(api, main);
        await h.standin("/control/pause", { paused: true });
        let otherEdit;
        try {
          await openTab(page, main, "documents");
          const { menu, items } = await menuItems(page, `Actions for ${v1Doc.title}`);
          expectThat(items.includes("Mark as executed copy"), `menu ${q(items)}`);
          await menu.getByRole("menuitem", { name: "Mark as executed copy" }).click();
          await waitRun(
            api,
            main,
            (r) => r.id !== before.id && r.state === "pending",
            "pending run on v2",
          );
          await until(
            async () => (await h.standin("/control/stats")).waiting > 0,
            "request held at stand-in",
            90000,
          );
          await openTab(them.page, main, "fields");
          const tier = fieldsRegion(them.page)
            .getByRole("spinbutton", { name: fieldSlugs.tier.label })
            .or(fieldsRegion(them.page).getByRole("textbox", { name: fieldSlugs.tier.label }));
          await tier.fill("5");
          await tier.blur();
          await until(
            async () =>
              (await contract(them.api, main)).contract.customFields[fieldSlugs.tier.slug] === 5,
            "tier edit saved",
          );
          otherEdit = `${PEOPLE[otherOf(role)].name} saved ${fieldSlugs.tier.label} 1 -> 5 on Fields while the run waited at the stand-in`;
        } finally {
          await h.standin("/control/pause", { paused: false });
        }
        const run = await waitRun(
          api,
          main,
          (r) => r.id !== before.id && r.state === "ready",
          "v2 run finished",
        );
        const record = await contract(api, main);
        const c = record.contract;
        const kdRows = (await api.ok("GET", `/contracts/${main}/key-dates`)).deadlines;
        await openTab(page, main, "");
        await sparkle(page, "Expiry date").click();
        const panel = page.getByRole("complementary", { name: /, version \d+$/ });
        await panel.waitFor({ timeout: 30000 });
        const panelName = await panel.getAttribute("aria-label");
        await panel.getByRole("button", { name: "Close the document" }).click();
        expectThat(run.versionNumber === 2, `run version ${run.versionNumber}`);
        expectThat(
          c.expiryDate === "2027-06-30" && c.aiUnverified?.expiry_date && c.noticePeriodDays === 60,
          `core ${c.expiryDate} ${c.noticePeriodDays}`,
        );
        expectThat(
          c.customFields[fieldSlugs.location.slug] === "Salalah" &&
            c.customFields[fieldSlugs.tier.slug] === 5 &&
            !c.aiUnverified?.[fieldSlugs.tier.slug],
          `fields ${q(c.customFields)}`,
        );
        expectThat(
          record.counterparties.some((p) => p.name === supplierName),
          `counterparties ${q(record.counterparties)}`,
        );
        expectThat(
          kdRows.some((d) => d.label === "Option exercise deadline" && d.unverified) &&
            kdRows.some((d) => d.label === "Annual price review") &&
            !kdRows.some((d) => d.label === "Price review"),
          `key dates ${q(kdRows.map((d) => d.label))}`,
        );
        expectThat(/version 2$/.test(panelName), `evidence opened ${panelName}`);
        return `Documents -> Mark as executed copy pinned Version 2 and queued a run; ${otherEdit}. The run read Version ${run.versionNumber}. Saved: expiry 2027-06-30 (Unverified again, replaced), notice 60 (confirmed, kept although the answer was 90), location Salalah (edited, kept), tier 5 with no marker (concurrent edit kept), Counterparty "${supplierName}" linked. Key dates: Option exercise deadline added Unverified; Annual price review unchanged. Expiry date sparkle now opens ${q(panelName)}.`;
      },
      { page },
    );

    await step(
      "A later run does not change or remove a Key date an earlier run added and does not re-add a removed one; an explicit clear is preserved",
      "Note-only edit keeps the marker; Remove date clears it; a rerun does not add it again; a cleared Field stays empty",
      async () => {
        await openTab(page, main, "key-dates");
        const kd = page.getByRole("region", { name: "Key dates" });
        await kd.getByRole("button", { name: "Actions for Option exercise deadline" }).click();
        await page.getByRole("menuitem", { name: "Edit date" }).click();
        const dialog = page.getByRole("dialog", { name: "Edit key date" });
        await dialog.getByRole("textbox", { name: "Note" }).fill("DOC-030 check the option notice");
        await dialog.getByRole("button", { name: "Save" }).click();
        await dialog.waitFor({ state: "hidden" });
        await sleep(800);
        const optionRow = (await api.ok("GET", `/contracts/${main}/key-dates`)).deadlines.find(
          (d) => d.label === "Option exercise deadline",
        );
        expectThat(optionRow?.unverified === true, "note edit cleared the option marker");
        await kd.getByRole("button", { name: "Actions for Option exercise deadline" }).click();
        await page.getByRole("menuitem", { name: "Remove date" }).click();
        const confirmDialog = page.getByRole("alertdialog");
        if (await confirmDialog.count())
          await confirmDialog.getByRole("button", { name: /Remove/ }).click();
        await until(
          async () =>
            !(await api.ok("GET", `/contracts/${main}/key-dates`)).deadlines.some(
              (d) => d.label === "Option exercise deadline",
            ),
          "option removed",
        );
        await openTab(page, main, "fields");
        const audit = fieldsRegion(page).getByRole("textbox", { name: fieldSlugs.absent.label });
        const auditBefore = await audit.inputValue();
        await audit.fill("");
        await audit.blur();
        await until(
          async () =>
            (await contract(api, main)).contract.customFields[fieldSlugs.absent.slug] == null,
          "audit cleared",
        );
        const before = await latestRun(api, main);
        await fieldsRegion(page).getByRole("button", { name: "Run analysis" }).click();
        await waitRun(api, main, (r) => r.id !== before.id && r.state === "ready", "rerun");
        const kdRows = (await api.ok("GET", `/contracts/${main}/key-dates`)).deadlines;
        const c = (await contract(api, main)).contract;
        expectThat(!kdRows.some((d) => d.label === "Option exercise deadline"), "option re-added");
        expectThat(
          kdRows.some((d) => d.label === "Annual price review"),
          "earlier Key date changed",
        );
        expectThat(c.customFields[fieldSlugs.absent.slug] == null, "audit refilled");
        return `Edit date with a note-only change left Option exercise deadline Unverified; Remove date removed it and its marker. Cleared ${fieldSlugs.absent.label} on Fields (was ${q(auditBefore)}). Run analysis on Version 2 finished: no Option exercise deadline row returned, Annual price review still listed, the audit Field stayed empty.`;
      },
      { page },
    );

    await step(
      "If Analysis cannot finish: a failed run shows Analysis failed: and its reason under the Fields header and changes nothing; another run succeeds",
      "Analysis failed: <reason> under the Fields header; saved values and markers unchanged; the next run completes and the note goes",
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
        let failedNote;
        try {
          await openTab(page, main, "fields");
          await fieldsRegion(page).getByRole("button", { name: "Run analysis" }).click();
          await waitRun(
            api,
            main,
            (r) => r.id !== run0.id && r.state === "failed",
            "failed run",
            300000,
          );
          await until(
            async () => (await fieldsAlerts(page)).some((a) => /^Analysis failed:/.test(a)),
            "failure note",
            60000,
          );
          failedNote = (await fieldsAlerts(page)).find((a) => /^Analysis failed:/.test(a));
        } finally {
          await h.standin("/control/malformed", { count: 0 });
        }
        const after = await snapshot();
        expectThat(before === after, `values changed ${before} ${after}`);
        const failed = await latestRun(api, main);
        await fieldsRegion(page).getByRole("button", { name: "Run analysis" }).click();
        await waitRun(api, main, (r) => r.id !== failed.id && r.state === "ready", "recovery run");
        await until(
          async () => !(await fieldsAlerts(page)).some((a) => /^Analysis failed:/.test(a)),
          "failure note gone",
          60000,
        );
        return `With the stand-in returning non-JSON, the Fields header note read ${q(failedNote)}. Saved values and markers were identical before and after. With valid replies restored, Run analysis completed and the failure note went.`;
      },
      { page },
    );

    await step(
      "Stale evidence: a removed source makes a citation unavailable",
      "After the cited Document is archived, the value keeps its marker and the sparkle says Source evidence is unavailable",
      async () => {
        const staleNum = await mk("Stale evidence");
        ctx.records.push({
          article: "contract-analysis",
          role,
          reference: `C-${staleNum}`,
          title: `DOC-030 contracts-b V-C21 Stale evidence ${tag}`,
        });
        const staleMarker = `${marker}STALE`;
        await h.standin("/control/register", { marker: staleMarker, answers: answers(1) });
        const pdf = await h.makePdf(
          browser,
          `doc030-stale-${short(role).toLowerCase()}.pdf`,
          paper(staleMarker, 1),
        );
        const doc = (await api.upload(`/contracts/${staleNum}/documents`, pdf)).json.document;
        await waitRun(api, staleNum, (r) => r.state === "ready", "stale run", 180000);
        const arch = await api("POST", `/documents/${doc.id}/archive`);
        expectThat(arch.status < 300, `archive ${arch.status} ${arch.text.slice(0, 200)}`);
        await openTab(page, staleNum, "");
        await sparkle(page, "Expiry date").click();
        const pop = page.getByRole("dialog", { name: "View AI evidence for Expiry date" });
        await pop.getByRole("alert").waitFor({ timeout: 20000 });
        const msg = await text(pop.getByRole("alert"));
        const panels = await page.getByRole("complementary", { name: /, version \d+$/ }).count();
        const stillMarked = (await markers(api, staleNum)).includes("expiry_date");
        await page.keyboard.press("Escape");
        expectThat(
          /Source evidence is unavailable/.test(msg) && panels === 0 && stillMarked,
          `msg ${q(msg)} panels ${panels} marked ${stillMarked}`,
        );
        return `C-${staleNum}: after the run the cited Document was archived (setup API ${arch.status}). Overview Expiry date sparkle showed ${q(msg)}; no doc panel opened; the value is still Unverified.`;
      },
      { page },
    );

    await step(
      "Roles and states: Ended, archived, disabled connector and Confirm all",
      "Ended: no Run analysis, run refused, Confirm still works. Archived: no Confirm or Confirm all; confirm refused. Disabled connector: markers and row controls stay, History keeps runs, Confirm all clears the rest without changing values",
      async () => {
        const statuses = (await admin.ok("GET", "/contract-statuses")).contractStatuses;
        const ended = statuses.find((s) => s.stage === "ended" && !s.archivedAt);
        await api.ok("PATCH", `/contracts/${main}`, { statusId: ended.id, overrideSoftGate: true });
        await openTab(page, main, "fields");
        const endedControls = await headerControls(page);
        const { items } = await menuItems(page, "Contract actions");
        await page.keyboard.press("Escape");
        const direct = await api("POST", `/contracts/${main}/analysis`);
        expectThat(
          !endedControls.some((c) => c.name === "Run analysis") &&
            !items.includes("Run analysis") &&
            direct.status === 409,
          `ended ${q(endedControls)} ${q(items)} ${direct.status}`,
        );
        const m0 = await markers(api, main);
        await openTab(page, main, "");
        await rowConfirm(page, "Expiry date").click();
        await until(
          async () => !(await markers(api, main)).includes("expiry_date"),
          "expiry confirmed on Ended",
        );
        const m1 = await markers(api, main);
        await menuItems(page, "Contract actions");
        await page.getByRole("menuitem", { name: "Archive" }).click();
        const archiveDialog = page.getByRole("alertdialog").or(page.getByRole("dialog"));
        if (await archiveDialog.count())
          await archiveDialog.getByRole("button", { name: /^Archive/ }).click();
        await until(
          async () => (await contract(api, main)).contract.archivedAt !== null,
          "archived",
        );
        await openTab(page, main, "fields");
        const confirmsArchived =
          (await page.getByRole("button", { name: "Confirm", exact: true }).count()) +
          (await page.getByRole("button", { name: "Confirm all" }).count());
        const refused = await api("POST", `/contracts/${main}/analysis/confirm`, { slug: m1[0] });
        expectThat(
          confirmsArchived === 0 && refused.status === 409,
          `archived confirm ${confirmsArchived} ${refused.status}`,
        );
        await api.ok("POST", `/contracts/${main}/restore`);
        const restored = (await contract(api, main)).contract;
        const valuesBefore = q({
          e: restored.expiryDate,
          v: restored.value,
          cf: restored.customFields,
        });
        await admin.ok("POST", "/ai-connector/disable");
        let summary;
        try {
          await openTab(page, main, "fields");
          const disabledControls = await headerControls(page);
          const kept = await markers(api, main);
          const rowConfirms = await fieldsRegion(page)
            .getByRole("button", { name: "Confirm", exact: true })
            .count();
          await page.getByRole("button", { name: "History" }).click();
          const history = page.getByRole("complementary", { name: "History" });
          await history.waitFor();
          await sleep(1500);
          const runs = (await history.getByText(/AI analysis of this contract/).allTextContents())
            .length;
          await history.getByRole("button", { name: "Close" }).click();
          await fieldsRegion(page).getByRole("button", { name: "Confirm all" }).click();
          await until(async () => (await markers(api, main)).length === 0, "confirm all");
          const after = (await contract(api, main)).contract;
          expectThat(
            !disabledControls.some((c) => c.name === "Run analysis") &&
              disabledControls.some((c) => c.name === "Confirm all"),
            `disabled controls ${q(disabledControls)}`,
          );
          expectThat(
            kept.length === m1.length && kept.length > 1,
            `markers after disable ${q(kept)}`,
          );
          expectThat(runs > 0, "History lost the runs");
          expectThat(
            q({ e: after.expiryDate, v: after.value, cf: after.customFields }) === valuesBefore,
            "values changed by Confirm all",
          );
          summary = `Connector disabled (setup API): the Fields header offered ${q(disabledControls.map((c) => c.name))}; ${kept.length} values stayed Unverified with ${rowConfirms} row Confirm controls on Fields; History still lists ${runs} Analysis entries; Confirm all cleared every marker and changed no saved value.`;
        } finally {
          await admin.ok("POST", "/ai-connector/enable");
        }
        return `Moved C-${main} to "${ended.displayName}" (Ended; setup API). Fields header ${q(endedControls.map((c) => c.name))}, Contract actions ${q(items)}, direct run ${direct.status}. Confirm beside Expiry date on Overview still cleared its marker (${m0.length} -> ${m1.length}). Contract actions -> Archive: no Confirm or Confirm all; a direct confirm answered ${refused.status}. Restored (setup API). ${summary}`;
      },
      { page },
    );

    await step(
      "Business Users cannot run Analysis or confirm its values",
      "A Business User on the Contract team cannot open the record in the full app; run and confirm requests are refused",
      async () => {
        const bu = await getBusinessUser();
        const buId = ctx.userId(PEOPLE.business_user_team.name);
        const added = await admin("POST", `/contracts/${main}/team`, { userId: buId });
        await bu.page.goto(`${BASE}/contracts/${main}/fields`);
        await bu.page.waitForLoadState("networkidle").catch(() => {});
        await sleep(1500);
        const landed = new URL(bu.page.url()).pathname;
        const runButtons = await bu.page
          .getByRole("button", { name: /Run analysis|Confirm/ })
          .count();
        const run = await bu.api("POST", `/contracts/${main}/analysis`);
        const confirm = await bu.api("POST", `/contracts/${main}/analysis/confirm-all`);
        expectThat(
          runButtons === 0 &&
            [403, 404].includes(run.status) &&
            [403, 404].includes(confirm.status),
          `bu ${landed} ${runButtons} ${run.status} ${confirm.status}`,
        );
        return `${PEOPLE.business_user_team.name} (Business User; team add answered ${added.status}) opening /contracts/${main}/fields landed on ${landed} with no Run analysis or Confirm control; POST analysis answered ${run.status} and POST confirm-all answered ${confirm.status}.`;
      },
      { page },
    );
  }

  async function conversionWalk(role) {
    const step = stepFor(role);
    const me = sessions[role];
    const page = me.page;
    const api = me.api;
    const tag = `${short(role)} ${stamp}`;
    let converted;
    let request;
    const needle = `DOC030 Nizwa ${short(role)}${stamp}`;
    await step(
      "Analysis after Request conversion: with Fill Contract Fields after conversion on, a failed run shows the documented note under the Fields header; Retry Request-context Analysis fills the Type's Record Rows",
      "The Contract remains created; the note reads as the guide quotes it; Retry Request-context Analysis completes and goes; a filled record Field Row shows Unverified and Confirm where it lives",
      async () => {
        const adminPage = sessions.administrator.page;
        await adminPage.goto(`${BASE}/settings/ai-analysis`);
        const toggle = adminPage.getByRole("switch", {
          name: "Fill Contract Fields after conversion",
        });
        await toggle.waitFor({ timeout: 20000 });
        let switchNote = "already on";
        if ((await toggle.getAttribute("aria-checked")) !== "true") {
          await toggle.click();
          await until(
            async () =>
              (await admin.ok("GET", "/ai-connector")).connector.contractConversionAnalysis ===
              true,
            "switch saved",
          );
          switchNote = "turned on by the Administrator on Settings -> AI analysis";
        }
        const bu = await getBusinessUser();
        const types = (await admin.ok("GET", "/request-types")).requestTypes ?? [];
        const rt =
          types.find(
            (t) => !t.archivedAt && (t.targetModule === "contract" || t.targetModule == null),
          ) ?? types[0];
        const departments = (await admin.ok("GET", "/departments")).departments;
        const submitted = await bu.api("POST", "/requests", {
          requestTypeId: rt.id,
          departmentId: departments[0]?.id,
          title: `DOC-030 contracts-b V-C21 Request ${tag}`,
          description: `Please review the fictional services agreement. The services are performed in ${needle}. The risk is high. It is a DOC-030 walkthrough record.`,
          urgency: "low",
        });
        expectThat(
          submitted.status < 300,
          `request ${submitted.status} ${submitted.text.slice(0, 300)}`,
        );
        request = submitted.json.request;
        await h.standin("/control/fallback", {
          enabled: true,
          cite: [
            { slug: fieldSlugs.location.slug, needle },
            { slug: "risk", needle: "high" },
          ],
        });
        await h.standin("/control/malformed", { count: 20 });
        let failedNote;
        try {
          const answer = await api("POST", `/requests/${request.number}/convert`, {
            title: `DOC-030 contracts-b V-C21 Converted ${tag}`,
            contractTypeId: typeId,
          });
          expectThat(answer.status < 300, `convert ${answer.status} ${answer.text.slice(0, 300)}`);
          converted =
            answer.json.request.convertedContract?.number ??
            answer.json.request.convertedRecord?.number;
          expectThat(converted, `no converted number ${q(answer.json.request).slice(0, 300)}`);
          ctx.records.push({
            article: "contract-analysis",
            role,
            reference: `C-${converted}`,
            title: `DOC-030 contracts-b V-C21 Converted ${tag}`,
            request: `R-${request.number}`,
          });
          await waitRun(
            api,
            converted,
            (r) => r.trigger === "conversion" && r.state === "failed",
            "conversion run failed",
            300000,
          );
          await openTab(page, converted, "fields");
          await until(
            async () =>
              (await fieldsAlerts(page)).some((a) => /^Request-context Analysis failed\./.test(a)),
            "failure note",
            30000,
          );
          failedNote = (await fieldsAlerts(page)).find((a) =>
            /^Request-context Analysis failed\./.test(a),
          );
        } finally {
          await h.standin("/control/malformed", { count: 0 });
        }
        const exists = (await contract(api, converted)).contract;
        const retry = fieldsRegion(page).getByRole("button", {
          name: "Retry Request-context Analysis",
        });
        await retry.waitFor({ timeout: 15000 });
        const failedRun = await latestRun(api, converted);
        await retry.click();
        const done = await waitRun(
          api,
          converted,
          (r) => r.id !== failedRun.id && r.state === "ready",
          "retry finished",
          300000,
        );
        await until(async () => (await retry.count()) === 0, "retry control gone", 60000);
        const stats = await h.standin("/control/stats");
        await openTab(page, converted, "fields");
        const locValue = await fieldsRegion(page)
          .getByRole("textbox", { name: fieldSlugs.location.label })
          .inputValue();
        const fieldsUnverified = await fieldsRegion(page)
          .getByText("Unverified", { exact: true })
          .count();
        const fieldsConfirm = await fieldsRegion(page)
          .getByRole("button", { name: "Confirm", exact: true })
          .count();
        const flagged = Object.keys((await contract(api, converted)).contract.aiUnverified ?? {});
        expectThat(
          /^Request-context Analysis failed\. The Contract was created successfully\. Check the Type, sources and AI settings, then retry\.$/.test(
            failedNote,
          ),
          `note ${q(failedNote)}`,
        );
        expectThat(done.trigger === "conversion", `retry trigger ${done.trigger}`);
        expectThat(
          locValue === needle &&
            flagged.includes(fieldSlugs.location.slug) &&
            fieldsUnverified === 1 &&
            fieldsConfirm === 1,
          `location ${q(locValue)} flagged ${q(flagged)} unverified ${fieldsUnverified} confirm ${fieldsConfirm}`,
        );
        expectThat(
          stats.last?.sourceKinds?.some((k) => k !== "document"),
          `sources ${q(stats.last)}`,
        );
        return `Fill Contract Fields after conversion: ${switchNote}. ${PEOPLE.business_user_team.name} submitted R-${request.number} (setup API, type ${q(rt.displayName)}); ${role} converted it to C-${converted} (setup API) with the analysis type. With non-JSON replies the note under the Fields header read ${q(failedNote)}; the Contract remained (${q(exists.title)}). Retry Request-context Analysis ran a conversion run that completed, and the retry control went. On Fields, ${fieldSlugs.location.label} = ${q(locValue)} with ${fieldsUnverified} Unverified marker and ${fieldsConfirm} Confirm. The stand-in's last call carried source kinds ${q(stats.last.sourceKinds)} and asked ${q(stats.last.asked)}.`;
      },
      { page },
    );
    if (!converted) return;
    await step(
      "Analysis after Request conversion (guide at 450aba9d): no page shows a marker, evidence or Confirm for Risk, Region or Department when this run filled them; those values do not count towards showing Confirm all, so the Fields header can show only Run analysis",
      "With Risk and one Field written by the run, Overview and Fields show no Risk marker, evidence or Confirm; the Fields header shows only Run analysis although the stored marker set holds both",
      async () => {
        const activity = (
          await admin.ok(
            "GET",
            `/activity?entityType=contract&entityId=${(await contract(api, converted)).contract.id}`,
          )
        ).entries;
        const written =
          activity.find((e) => e.action === "contract.analysis_completed")?.payload?.written ?? [];
        const rec = (await contract(api, converted)).contract;
        await openTab(page, converted, "");
        const main = page.getByRole("main");
        const riskEvidence = await main
          .getByRole("button", { name: /evidence for (Risk|Region|Department)/i })
          .count();
        const overviewUnverified = await main.getByText("Unverified", { exact: true }).count();
        const overviewConfirm = await main
          .getByRole("button", { name: "Confirm", exact: true })
          .count();
        await openTab(page, converted, "fields");
        const controls = await headerControls(page);
        const fieldsUnverified = await fieldsRegion(page)
          .getByText("Unverified", { exact: true })
          .count();
        const stored = storedMarkers(converted);
        const apiMarked = Object.keys(rec.aiUnverified ?? {});
        expectThat(
          written.includes("risk") && rec.risk === "high",
          `risk not written: ${q(written)} ${rec.risk}`,
        );
        expectThat(
          stored.includes("risk") && stored.includes(fieldSlugs.location.slug),
          `stored ${q(stored)}`,
        );
        expectThat(
          riskEvidence === 0 && overviewUnverified === 0 && overviewConfirm === 0,
          `Overview risk evidence ${riskEvidence} unverified ${overviewUnverified} confirm ${overviewConfirm}`,
        );
        expectThat(
          controls.map((c) => c.name).join() === "Run analysis" && fieldsUnverified === 1,
          `header ${q(controls)} fields unverified ${fieldsUnverified}`,
        );
        return `C-${converted}: the run wrote ${q(written)}; stored markers (database read) ${q(stored)}; the record API lists ${q(apiMarked)}. Overview shows Risk "high" with ${riskEvidence} Risk/Region/Department evidence controls, ${overviewUnverified} Unverified markers and ${overviewConfirm} Confirm controls. Fields shows ${fieldsUnverified} Unverified marker (${fieldSlugs.location.label}) and its header offers only ${q(controls.map((c) => c.name))}: the hidden Risk marker does not count towards Confirm all.`;
      },
      { page },
    );
    await step(
      "Analysis after Request conversion (guide at 450aba9d): when Confirm all appears for other values, it also clears the hidden Risk, Region and Department markers",
      "With Risk and two Fields written, Confirm all appears for the two visible Field markers; selecting it clears every stored marker, including Risk, and keeps the values",
      async () => {
        const bu = await getBusinessUser();
        const types = (await admin.ok("GET", "/request-types")).requestTypes ?? [];
        const rt =
          types.find(
            (t) => !t.archivedAt && (t.targetModule === "contract" || t.targetModule == null),
          ) ?? types[0];
        const departments = (await admin.ok("GET", "/departments")).departments;
        const needle2 = `DOC030 Sohar ${short(role)}${stamp}`;
        const audit2 = `DOC030 yearly audit ${short(role)}${stamp}`;
        const submitted = await bu.api("POST", "/requests", {
          requestTypeId: rt.id,
          departmentId: departments[0]?.id,
          title: `DOC-030 contracts-b V-C21 Request B ${tag}`,
          description: `Please review the fictional services agreement. The services are performed in ${needle2}. Audit: ${audit2}. The risk is high. It is a DOC-030 walkthrough record.`,
          urgency: "low",
        });
        expectThat(
          submitted.status < 300,
          `request ${submitted.status} ${submitted.text.slice(0, 300)}`,
        );
        const requestB = submitted.json.request;
        await h.standin("/control/fallback", {
          enabled: true,
          cite: [
            { slug: fieldSlugs.location.slug, needle: needle2 },
            { slug: fieldSlugs.absent.slug, needle: audit2 },
            { slug: "risk", needle: "high" },
          ],
        });
        let convertedB;
        try {
          const answer = await api("POST", `/requests/${requestB.number}/convert`, {
            title: `DOC-030 contracts-b V-C21 Converted B ${tag}`,
            contractTypeId: typeId,
          });
          expectThat(answer.status < 300, `convert ${answer.status} ${answer.text.slice(0, 300)}`);
          convertedB =
            answer.json.request.convertedContract?.number ??
            answer.json.request.convertedRecord?.number;
          ctx.records.push({
            article: "contract-analysis",
            role,
            reference: `C-${convertedB}`,
            title: `DOC-030 contracts-b V-C21 Converted B ${tag}`,
            request: `R-${requestB.number}`,
          });
          await waitRun(
            api,
            convertedB,
            (r) => r.trigger === "conversion" && r.state === "ready",
            "conversion run B finished",
            300000,
          );
        } finally {
          await h.standin("/control/fallback", { enabled: false, cite: [] });
        }
        const before = storedMarkers(convertedB);
        await openTab(page, convertedB, "");
        const riskEvidence = await page
          .getByRole("main")
          .getByRole("button", { name: /evidence for (Risk|Region|Department)/i })
          .count();
        await openTab(page, convertedB, "fields");
        const controls = await headerControls(page);
        const fieldsUnverified = await fieldsRegion(page)
          .getByText("Unverified", { exact: true })
          .count();
        expectThat(before.includes("risk") && before.length === 3, `stored before ${q(before)}`);
        expectThat(
          riskEvidence === 0 &&
            fieldsUnverified === 2 &&
            controls.some((c) => c.name === "Confirm all"),
          `risk evidence ${riskEvidence} fields ${fieldsUnverified} header ${q(controls)}`,
        );
        await fieldsRegion(page).getByRole("button", { name: "Confirm all" }).click();
        await until(
          async () => storedMarkers(convertedB).length === 0,
          "every stored marker cleared",
          30000,
        );
        const rec = (await contract(api, convertedB)).contract;
        await sleep(800);
        const controlsAfter = await headerControls(page);
        expectThat(
          rec.risk === "high" &&
            rec.customFields[fieldSlugs.location.slug] === needle2 &&
            rec.customFields[fieldSlugs.absent.slug] === audit2,
          `values ${rec.risk} ${q(rec.customFields)}`,
        );
        return `${PEOPLE.business_user_team.name} submitted R-${requestB.number} (setup API); ${role} converted it to C-${convertedB} (setup API). Stored markers (database read) ${q(before)}. Overview showed ${riskEvidence} Risk/Region/Department evidence controls; Fields showed ${fieldsUnverified} Unverified markers and the header offered ${q(controls.map((c) => c.name))}. Confirm all cleared every stored marker, including risk (stored set now empty); Risk stayed "high" and both Field values stayed. Header afterwards: ${q(controlsAfter.map((c) => c.name))}.`;
      },
      { page },
    );
  }

  try {
    await setup();
    if (!ctx.parts || ctx.parts.includes("analysis")) for (const role of roles) await walk(role);
    if (!ctx.parts || ctx.parts.includes("conversion"))
      for (const role of roles) await conversionWalk(role);
  } finally {
    try {
      await h.standin("/control/fallback", { enabled: false, cite: [] });
      await h.standin("/control/pause", { paused: false });
      await h.standin("/control/malformed", { count: 0 });
      ctx.setup.push({
        at: new Date().toISOString(),
        text: `Stand-in request counts: ${q(await h.standin("/control/stats"))}`,
      });
    } catch {}
    await restore();
  }
}
