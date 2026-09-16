// Independent agent walkthrough of configure-analysis (C43) and configure-signing (C42)
// against the live DOC-029 lab, with the real OpenRouter and DocuSign Demo connectors
// that the user entered. This agent did not write the articles.
//
// Run from the worktree root:
//   PHASE=c43|c42 LAB_PASSWORD=... mise exec -- node \
//     docs/documentation/batches/DOC-029/live-provider/walkthrough/walkthrough-live.mjs
//
// Credential safety:
// - The script never types, reads back, or prints a provider secret.
// - Every browser context blocks writes that could replace a connector:
//   PUT, PATCH and DELETE on /api/v1/ai-connector*, and DELETE on the Signing connector.
//   A Signing connector PUT is let through only when it asks for Webhook mode, and then
//   the script removes any HMAC secret and RSA key from the body first. The stored
//   connector has no HMAC secret, so the API must refuse that body before it writes.
// - The log leaves out the integration key, the User ID and anything secret.
// - It stops before Send envelope.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../../..");
const require = createRequire(path.join(root, "e2e/package.json"));
const { chromium } = require("@playwright/test");

const BASE = "http://127.0.0.1:23314";
const PASSWORD = process.env.LAB_PASSWORD;
const PHASE = process.env.PHASE;
if (!PASSWORD || !["c43", "c42"].includes(PHASE)) throw new Error("Set LAB_PASSWORD and PHASE=c43|c42");
const ADMIN = { email: "daniel.okafor@helix.example", name: "Daniel Okafor" };
const MEMBER = { email: "nadia.haddad@helix.example", name: "Nadia Haddad" };
const EXPECTED_MODEL = "deepseek/deepseek-v4.1-flash";
const OUT = path.join(here, `walkthrough-${PHASE}.json`);

const log = {
  phase: PHASE,
  reviewer: "DOC-029 independent live-provider walkthrough agent",
  reviewerKind: "agent",
  app: BASE,
  appCommit: "3fa407e3a846559914aa1a63249741f30cfb4f69",
  note: "Sanitized. No API key, RSA key, HMAC secret, integration key or User ID is recorded.",
  startedAt: new Date().toISOString(),
  guard: [],
  steps: [],
  finishedAt: null,
};
const save = () => {
  log.finishedAt = new Date().toISOString();
  writeFileSync(OUT, `${JSON.stringify(log, null, 2)}\n`);
};
async function step(id, article, role, method, action, fn, { kindOnFail = "product-bug" } = {}) {
  const entry = { id, article, role, method, action, at: new Date().toISOString(), actual: null, result: "not-run" };
  log.steps.push(entry);
  const t0 = Date.now();
  try {
    const out = await fn(entry);
    entry.actual = out;
    if (entry.result === "not-run") entry.result = "pass";
  } catch (error) {
    entry.actual = `${String(error?.message ?? error).split("\n").slice(0, 4).join(" ")}`;
    entry.result = "fail";
    entry.failureKind ??= kindOnFail;
  }
  entry.durationMs = Date.now() - t0;
  console.log(`${entry.result.toUpperCase()} ${id} ${action}\n   ${entry.actual}`);
  save();
  return entry;
}
const expect = (ok, message) => {
  if (!ok) throw new Error(message);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, message, timeout = 120000, every = 1000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(message);
    await wait(every);
  }
}

async function guard(context) {
  await context.route(/\/api\/v1\/ai-connector(\/workflows)?(\?.*)?$/, async (route) => {
    const m = route.request().method();
    if (["PUT", "PATCH", "DELETE"].includes(m)) {
      log.guard.push({ at: new Date().toISOString(), blocked: `${m} ai-connector` });
      return route.abort();
    }
    return route.continue();
  });
  await context.route(/\/api\/v1\/signing-connectors\/docusign(\?.*)?$/, async (route) => {
    const req = route.request();
    const m = req.method();
    if (m === "DELETE" || m === "PATCH") {
      log.guard.push({ at: new Date().toISOString(), blocked: `${m} signing connector` });
      return route.abort();
    }
    if (m === "PUT") {
      let body = null;
      try {
        body = JSON.parse(req.postData() ?? "null");
      } catch {}
      if (!body || body.updateMode !== "webhook") {
        log.guard.push({ at: new Date().toISOString(), blocked: "PUT signing connector (not a Webhook refusal check)" });
        return route.abort();
      }
      const stripped = { ...body };
      const removed = [];
      for (const k of ["webhookSecret", "privateKey"]) if (k in stripped) (delete stripped[k], removed.push(k));
      log.guard.push({
        at: new Date().toISOString(),
        passed: "PUT signing connector in Webhook mode with secrets removed",
        removedFields: removed,
        webhookUrl: (stripped.webhookUrl ?? "").replace(/\/\/[^@/]*@/, "//***@") || null,
      });
      return route.continue({ postData: JSON.stringify(stripped) });
    }
    return route.continue();
  });
}

async function signIn(browser, who) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await guard(context);
  const page = await context.newPage();
  await page.goto(`${BASE}/auth/login`);
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 });
  return { context, page, who };
}
async function api(who, method, url, body, multipart) {
  const res = await who.page.request.fetch(`${BASE}/api/v1${url}`, {
    method,
    data: body,
    multipart,
    headers: { origin: BASE },
    failOnStatusCode: false,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status(), json };
}
const aiState = async (who) => (await api(who, "GET", "/ai-connector")).json.connector;
const sigState = async (who) => (await api(who, "GET", "/signing-connectors/docusign")).json.connector;
const safeAi = (c) => ({
  configured: c.configured,
  enabled: c.enabled,
  preset: c.preset,
  protocol: c.protocol,
  baseUrl: c.baseUrl,
  model: c.model,
  hasApiKey: c.hasApiKey,
  matterPreparation: c.matterPreparation,
  contractPreparation: c.contractPreparation,
  contractConversionAnalysis: c.contractConversionAnalysis,
  updatedAt: c.updatedAt,
});
const safeSig = (c) => ({
  configured: c.configured,
  enabled: c.enabled,
  environment: c.environment,
  updateMode: c.updateMode,
  webhookUrlOverride: c.webhookUrlOverride,
  hasPrivateKey: c.hasPrivateKey,
  hasWebhookSecret: c.hasWebhookSecret,
  webhookUrl: c.webhookUrl,
  updatedAt: c.updatedAt,
});

async function findOrCreateContract(who, title, typeName, managerEmail) {
  const list = await api(who, "GET", "/contracts?includeArchived=true");
  const rows = list.json?.contracts ?? list.json?.items ?? [];
  const existing = rows.find((r) => r.title === title);
  if (existing) return { number: existing.number, created: false };
  const options = (await api(who, "GET", "/contracts/options")).json;
  const typeId = options.contractTypes.find((t) => t.displayName === typeName).id;
  const users = (await api(who, "GET", "/users")).json.users;
  const managerId = users.find((u) => u.email === managerEmail)?.id;
  const created = await api(who, "POST", "/contracts", { title, contractTypeId: typeId, ...(managerId ? { managerId } : {}) });
  expect(created.status === 201, `create ${title} answered ${created.status}`);
  return { number: created.json.contract.number, created: true };
}
async function uploadPrimary(who, number, file) {
  const buffer = readFileSync(path.join(here, "fixtures", file));
  const r = await api(who, "POST", `/contracts/${number}/documents`, undefined, {
    kind: "draft_ours",
    note: "DOC-029 fictional test paper",
    file: { name: file, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer },
  });
  expect(r.status === 201, `upload answered ${r.status} ${JSON.stringify(r.json?.detail ?? "")}`);
  return r.json.document ?? r.json;
}
const contractOf = async (who, n) => (await api(who, "GET", `/contracts/${n}`)).json;
const hasPrimary = async (who, n) => ((await api(who, "GET", `/contracts/${n}/documents`)).json.documents ?? []).some((d) => d.isPrimary);

async function openAiSettings(page) {
  await page.goto(`${BASE}/settings/ai-analysis`);
  await page.getByRole("heading", { name: "Field prompts" }).waitFor({ timeout: 30000 });
  const provider = page.getByRole("button", { name: "Provider", exact: true });
  if ((await provider.count()) && (await provider.getAttribute("aria-expanded")) === "false") await provider.click();
  await page.locator("#ai-preset").waitFor({ timeout: 10000 });
}
async function openSigningSettings(page) {
  await page.goto(`${BASE}/settings/integrations/e-signature`);
  const ds = page.getByRole("button", { name: "DocuSign", exact: true });
  await ds.waitFor({ timeout: 30000 });
  const collapsed = (await ds.getAttribute("aria-expanded")) === "false";
  if (collapsed) await ds.click();
  await page.getByLabel("Signing updates").waitFor({ timeout: 10000 });
  return collapsed;
}
const analysisCard = (page) => page.locator("section[aria-labelledby='contract-ai-analysis-heading']");
async function openFields(page, n) {
  await page.goto(`${BASE}/contracts/${n}`);
  await page.getByRole("navigation", { name: "Contract sections" }).getByRole("link", { name: "Fields", exact: true }).click();
  await page.waitForURL(new RegExp(`/contracts/${n}/fields$`), { timeout: 20000 });
  await page.waitForLoadState("networkidle").catch(() => {});
}
async function openApprovals(page, n) {
  await page.goto(`${BASE}/contracts/${n}`);
  const link = page.getByRole("navigation", { name: "Contract sections" }).getByRole("link", { name: "Approvals", exact: true });
  try {
    await link.waitFor({ timeout: 15000 });
  } catch {
    await page.goto(`${BASE}/contracts/${n}`);
    await link.waitFor({ timeout: 30000 });
  }
  await link.click();
  await page.waitForURL(new RegExp(`/contracts/${n}/approvals$`), { timeout: 20000 });
  await page.getByRole("region", { name: "Approvals & signing" }).waitFor({ timeout: 20000 });
  await page.waitForLoadState("networkidle").catch(() => {});
}
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, " ").trim();

// ============================================================================ C43
async function c43(browser) {
  const admin = await signIn(browser, ADMIN);
  const page = admin.page;
  const before = safeAi(await aiState(admin));
  log.initialAiConnector = before;
  expect(before.configured && before.enabled && before.preset === "openrouter" && before.model === EXPECTED_MODEL && before.hasApiKey, `unexpected start state ${JSON.stringify(before)}`);
  const writes = [];
  page.on("request", (r) => {
    if (["PUT", "POST", "PATCH", "DELETE"].includes(r.method()) && /\/api\/v1\/(ai-|contracts\/\d+\/analysis)/.test(r.url()))
      writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });

  await step("A01", "configure-analysis", "administrator", "browser-walkthrough", "Open Settings > Organization > AI analysis; check the card order, chip and Request conversion switches", async () => {
    await page.goto(`${BASE}/settings/profile`);
    const org = page.getByRole("group", { name: "Organization" });
    await org.waitFor({ timeout: 20000 });
    await org.getByRole("link", { name: "AI analysis", exact: true }).click();
    await page.waitForURL(`${BASE}/settings/ai-analysis`);
    await page.getByRole("heading", { name: "Field prompts" }).waitFor();
    const headings = (await page.locator("h2").allInnerTexts()).map((t) => t.trim());
    const provider = page.getByRole("button", { name: "Provider", exact: true });
    const providerExpanded = await provider.getAttribute("aria-expanded");
    const chip = await page.getByText("Connected", { exact: true }).first().isVisible();
    const promptsCollapse = await page.getByRole("button", { name: "Field prompts", exact: true }).count();
    const sw = [];
    for (const id of ["matter-preparation", "contract-preparation", "contract-conversion-analysis"])
      sw.push(`${id} checked=${await page.locator(`#${id}`).getAttribute("aria-checked")}`);
    expect(headings[headings.length - 1] === "Field prompts", `last card ${headings.at(-1)}`);
    expect(chip, "Connected chip not visible");
    expect(promptsCollapse === 0, "Field prompts has a collapse control");
    return `The Organization rail group has AI analysis as its own link to /settings/ai-analysis. Cards: ${headings.join(" > ")}. Provider card aria-expanded=${providerExpanded}. Chip reads Connected. Field prompts is the last card and has no collapse control. Request conversion switches: ${sw.join(", ")}.`;
  });

  await step("A02", "configure-analysis", "administrator", "live-provider-check", "Expand Provider; check the saved OpenRouter settings; Test connection", async (e) => {
    await openAiSettings(page);
    const preset = await page.locator("#ai-preset").inputValue();
    const model = await page.locator("#ai-model").inputValue();
    const keyBlank = (await page.locator("#ai-api-key").inputValue()) === "";
    const keepHint = await page.getByText("Leave blank to keep the current key. Paste a new one to rotate.").isVisible();
    const t0 = Date.now();
    await page.getByRole("button", { name: "Test connection" }).click();
    const ok = page.getByText("Connection successful.", { exact: true });
    const bad = page.getByText(/^The connection test failed/);
    await Promise.race([ok.waitFor({ timeout: 90000 }), bad.waitFor({ timeout: 90000 })]);
    const ms = Date.now() - t0;
    const failed = await bad.isVisible().catch(() => false);
    e.provider = "OpenRouter";
    e.model = model;
    e.testMs = ms;
    expect(preset === "openrouter" && model === EXPECTED_MODEL && keyBlank && keepHint, `preset=${preset} model=${model} keyBlank=${keyBlank} keepHint=${keepHint}`);
    expect(!failed, `Test connection failed: ${failed ? await bad.innerText() : ""}`);
    return `Provider OpenRouter, Model ${model}. The API key input is blank and shows "Leave blank to keep the current key. Paste a new one to rotate." Test connection showed "Connection successful." after ${ms} ms.`;
  }, { kindOnFail: "environment" });

  await step("A03", "configure-analysis", "administrator", "live-provider-check", "Load models with the stored key; Search models; Refresh models; check that nothing is saved", async (e) => {
    const w0 = writes.length;
    const load = page.getByRole("button", { name: "Load models" });
    const canLoad = await load.isEnabled();
    const t0 = Date.now();
    const listed = page.waitForResponse((r) => r.url().endsWith("/api/v1/ai-connector/models"), { timeout: 90000 });
    await load.click();
    const res = await listed;
    const body = await res.json();
    const loadMs = Date.now() - t0;
    await page.getByRole("button", { name: "Refresh models" }).waitFor({ timeout: 20000 });
    const all = await page.locator("select#ai-model option").count();
    await page.getByRole("searchbox", { name: "Search models" }).fill("deepseek-v4.1");
    await wait(300);
    const filtered = (await page.locator("select#ai-model option").allInnerTexts()).map((t) => t.trim());
    const selected = await page.locator("select#ai-model").inputValue();
    const inList = body.models.some((m) => m.id === EXPECTED_MODEL);
    await page.getByRole("searchbox", { name: "Search models" }).fill("");
    const listed2 = page.waitForResponse((r) => r.url().endsWith("/api/v1/ai-connector/models"), { timeout: 90000 });
    await page.getByRole("button", { name: "Refresh models" }).click();
    await listed2;
    await page.getByRole("button", { name: "Refresh models" }).waitFor({ timeout: 20000 });
    const selectedAfterRefresh = await page.locator("select#ai-model").inputValue();
    const after = safeAi(await aiState(admin));
    const newWrites = writes.slice(w0).filter((w) => !w.endsWith("/ai-connector/models"));
    e.modelsListed = body.models.length;
    e.loadMs = loadMs;
    expect(canLoad && res.status() === 200, `load status ${res.status()} canLoad=${canLoad}`);
    expect(selected === EXPECTED_MODEL && selectedAfterRefresh === EXPECTED_MODEL, `selection changed ${selected}/${selectedAfterRefresh}`);
    expect(after.model === EXPECTED_MODEL && after.updatedAt === before.updatedAt && newWrites.length === 0, `saved state changed or writes ${newWrites}`);
    return `Load models was enabled with the stored key (API key input blank). OpenRouter returned ${body.models.length} models in ${loadMs} ms (truncated=${body.truncated}); ${EXPECTED_MODEL} ${inList ? "is" : "is not"} in the list. The button then read Refresh models. The select had ${all} options. Search models "deepseek-v4.1" left ${filtered.length} options: ${filtered.slice(0, 6).join(" | ")}. Model stayed ${selected} after the search and after Refresh models. The connector's updatedAt did not change and no save request was sent.`;
  }, { kindOnFail: "doc-error" });

  const NOTICE = "notice_period_days";
  const NOTICE_TEXT = "Extract the notice period for non-renewal or termination as a number of days stated in the paper. Do not infer a period when the paper states none.";
  await step("A04", "configure-analysis", "administrator", "browser-walkthrough", "Field prompts: edit the notice-period prompt, press Enter, wait for the save result", async () => {
    await page.reload();
    await page.getByRole("heading", { name: "Field prompts" }).waitFor();
    const box = page.locator(`#ai-field-prompt-${NOTICE}`);
    const label = await box.getAttribute("aria-label");
    const put = page.waitForResponse((r) => r.url().endsWith("/api/v1/ai-field-prompts") && r.request().method() === "PUT", { timeout: 20000 });
    await box.click();
    await box.fill(NOTICE_TEXT);
    await box.press("Enter");
    const res = await put;
    const reset = page.getByRole("button", { name: /^Reset .*notice.* to default$/i });
    await reset.waitFor({ timeout: 10000 });
    const valueAfter = await box.inputValue();
    const stored = (await api(admin, "GET", "/ai-field-prompts")).json.prompts.find((p) => p.slug === NOTICE);
    const maxlength = await box.getAttribute("maxlength");
    expect(res.status() === 200 && stored.overridden && stored.prompt === NOTICE_TEXT && !valueAfter.includes("\n"), `status=${res.status()} overridden=${stored.overridden}`);
    return `Input "${label}". Enter sent one save (${res.status()}), kept no line break, and the stored prompt is now the edited text (overridden=true). "${await text(reset)}" appeared for that prompt. maxlength=${maxlength}.`;
  });

  await step("A05", "configure-analysis", "administrator", "browser-walkthrough", "Field prompts: Shift+Enter inserts a line break; clearing the prompt and leaving restores the saved text", async () => {
    const box = page.locator(`#ai-field-prompt-${NOTICE}`);
    const puts = [];
    const l = (r) => r.method() === "PUT" && r.url().includes("/api/v1/ai-field-prompts") && puts.push(1);
    page.on("request", l);
    await box.click();
    await box.press("End");
    await box.press("Shift+Enter");
    const withBreak = await box.inputValue();
    const hasBreak = withBreak.endsWith("\n");
    await box.press("Backspace");
    await box.fill("");
    await box.blur();
    await wait(1500);
    const afterClear = await box.inputValue();
    page.off("request", l);
    const stored = (await api(admin, "GET", "/ai-field-prompts")).json.prompts.find((p) => p.slug === NOTICE);
    expect(hasBreak, "Shift+Enter did not insert a line break");
    expect(afterClear === NOTICE_TEXT && stored.prompt === NOTICE_TEXT, `after clear box="${afterClear.slice(0, 40)}" stored="${stored.prompt.slice(0, 40)}"`);
    return `Shift+Enter put a line break at the end of the text without saving. After clearing the input and leaving it, the box showed the saved text again and the stored prompt was unchanged. Save requests sent: ${puts.length}.`;
  });

  await step("A06", "configure-analysis", "administrator", "browser-walkthrough", "Field prompts: type in the effective-date prompt, press Escape, reload", async (e) => {
    const slug = "effective_date";
    const box = page.locator(`#ai-field-prompt-${slug}`);
    const original = (await api(admin, "GET", "/ai-field-prompts")).json.prompts.find((p) => p.slug === slug);
    expect(!original.overridden, "effective_date prompt already overridden before the check");
    const puts = [];
    const l = (r) => r.method() === "PUT" && r.url().includes("/api/v1/ai-field-prompts") && puts.push(r.postData());
    page.on("request", l);
    await box.click();
    await box.fill("DOC-029 abandoned prompt text. Escape should discard this.");
    await box.press("Escape");
    const afterEscape = await box.inputValue();
    await wait(2000);
    page.off("request", l);
    await page.reload();
    await page.getByRole("heading", { name: "Field prompts" }).waitFor();
    const reloaded = await page.locator(`#ai-field-prompt-${slug}`).inputValue();
    const stored = (await api(admin, "GET", "/ai-field-prompts")).json.prompts.find((p) => p.slug === slug);
    let restore = "Nothing to restore.";
    if (stored.overridden) {
      const reset = page.getByRole("button", { name: /^Reset .*effective.* to default$/i });
      const put = page.waitForResponse((r) => r.url().endsWith("/api/v1/ai-field-prompts") && r.request().method() === "PUT", { timeout: 20000 });
      await reset.click();
      await put;
      await reset.waitFor({ state: "detached", timeout: 10000 });
      const back = (await api(admin, "GET", "/ai-field-prompts")).json.prompts.find((p) => p.slug === slug);
      restore = `Reset to default in the pane restored the built-in prompt (overridden=${back.overridden}, equals default=${back.prompt === back.defaultPrompt}).`;
    }
    const summary = `Right after Escape the box showed ${afterEscape === original.prompt ? "the saved text" : "the typed text"}. Save requests after Escape: ${puts.length}. After reload the box showed ${reloaded === original.prompt ? "the saved text" : "the abandoned text"}; stored overridden=${stored.overridden}. ${restore}`;
    if (stored.overridden || puts.length > 0) {
      e.note = {
        kind: "product-bug",
        issue: "#887",
        text: "Escape saved the discarded text. The Escape handler reverts the draft and then blurs the input; the blur handler commits the stale draft (ai-field-prompts-card.tsx). The author removes the Escape sentence from the article, so this is a product-bug note, not a scenario failure. The prompt was restored with Reset to default.",
      };
    }
    return summary;
  });

  // ---- Analysis run on a fictional Contract
  let analysisNumber;
  await step("A07", "configure-analysis", "administrator", "live-provider-check", "Create the fictional Contract DOC-029 live analysis, upload its primary Document, wait for the automatic Analysis run", async (e) => {
    const c = await findOrCreateContract(admin, "DOC-029 live analysis", "NDA", MEMBER.email);
    analysisNumber = c.number;
    e.contract = `C-${c.number}`;
    let doc = null;
    if (!(await hasPrimary(admin, c.number))) doc = await uploadPrimary(admin, c.number, "doc029-live-analysis.docx");
    const uploadedAt = Date.now();
    const run = await until(async () => {
      const r = (await contractOf(admin, c.number)).analysis?.latestRun;
      return r && r.state !== "pending" ? r : null;
    }, "no finished Analysis run within 6 minutes", 360000, 2000);
    e.autoRun = { trigger: run.trigger, state: run.state, model: run.model, preset: run.preset, versionNumber: run.versionNumber, startedAt: run.startedAt, finishedAt: run.finishedAt, providerMs: run.startedAt && run.finishedAt ? Date.parse(run.finishedAt) - Date.parse(run.startedAt) : null, uploadToFinishMs: Date.now() - uploadedAt };
    const outcome = run.outcome ? JSON.stringify(run.outcome).slice(0, 1200) : null;
    e.outcomeExcerpt = outcome;
    expect(run.state === "ready", `run ${run.state}: ${run.failure}`);
    expect(run.trigger === "automatic" || !c.created, `first run trigger ${run.trigger}`);
    expect(run.model === EXPECTED_MODEL && run.preset === "openrouter", `run model ${run.preset}/${run.model}`);
    return `C-${c.number} ${c.created ? "created" : "reused"} (NDA, Legal Owner Nadia Haddad). ${doc ? "Uploaded doc029-live-analysis.docx as the primary Document." : "Primary Document already present."} Without anyone selecting Run analysis, a ${run.trigger} run finished ${run.state} on Version ${run.versionNumber} with ${run.preset} ${run.model}. Provider time ${e.autoRun.providerMs} ms; upload to finish ${e.autoRun.uploadToFinishMs} ms.`;
  }, { kindOnFail: "environment" });

  await step("A08", "configure-analysis", "administrator", "browser-walkthrough", "Read the AI analysis card: completion sentence, results, Unverified values", async (e) => {
    await openFields(page, analysisNumber);
    const card = analysisCard(page);
    await card.waitFor({ timeout: 20000 });
    const cardText = await text(card);
    const completed = cardText.match(/Completed .*? on Version \d+ with \S+?\.(?= |$)/)?.[0];
    const rows = await card.locator("li").allInnerTexts().catch(() => []);
    const unverified = await page.getByText("Unverified", { exact: true }).count();
    const detail = (await contractOf(admin, analysisNumber)).contract;
    e.savedValues = { effectiveDate: detail.effectiveDate ?? null, expiryDate: detail.expiryDate ?? null, noticePeriodDays: detail.noticePeriodDays ?? null, termType: detail.termType ?? null };
    expect(completed && completed.includes(EXPECTED_MODEL), `completion sentence missing: ${cardText.slice(0, 300)}`);
    return `Card sentence: "${completed}". Result rows (${rows.length}): ${rows.map((r) => r.replace(/\s+/g, " ").trim()).join(" || ").slice(0, 900)}. "Unverified" markers on the page: ${unverified}. Saved values read from the Contract: ${JSON.stringify(e.savedValues)}. Accuracy is not claimed.`;
  });

  await step("A09", "configure-analysis", "administrator", "live-provider-check", "Rerun deliberately after the prompt edit: select Run analysis and wait", async (e) => {
    await openFields(page, analysisNumber);
    const card = analysisCard(page);
    const run = card.getByRole("button", { name: "Run analysis" });
    await run.waitFor({ timeout: 20000 });
    const prior = (await contractOf(admin, analysisNumber)).analysis.latestRun.id;
    const t0 = Date.now();
    await run.click();
    let sawRunning = false;
    try {
      await card.getByText("Running…").waitFor({ timeout: 10000 });
      sawRunning = true;
    } catch {}
    const done = await until(async () => {
      const r = (await contractOf(admin, analysisNumber)).analysis.latestRun;
      return r.id !== prior && r.state !== "pending" ? r : null;
    }, "manual run did not finish in 6 minutes", 360000, 2000);
    await card.getByText(/Completed .* on Version \d+ with /).waitFor({ timeout: 30000 }).catch(() => {});
    const sentence = (await text(card)).match(/(Completed|Failed) .*? on Version \d+ with \S+?\.(?= |$)/)?.[0];
    e.manualRun = { trigger: done.trigger, state: done.state, model: done.model, versionNumber: done.versionNumber, providerMs: done.startedAt && done.finishedAt ? Date.parse(done.finishedAt) - Date.parse(done.startedAt) : null, clickToFinishMs: Date.now() - t0 };
    const noticeRow = (await card.locator("li").allInnerTexts()).find((r) => /notice/i.test(r));
    expect(done.state === "ready" && done.trigger === "manual" && done.model === EXPECTED_MODEL, `manual run ${done.trigger}/${done.state}/${done.failure}`);
    return `Run analysis showed Running…: ${sawRunning}. The manual run finished ${done.state} on Version ${done.versionNumber} with ${done.model}; provider time ${e.manualRun.providerMs} ms, click to finish ${e.manualRun.clickToFinishMs} ms. Card: "${sentence}". Notice-period row: ${noticeRow ? noticeRow.replace(/\s+/g, " ").trim() : "not shown"}.`;
  }, { kindOnFail: "environment" });

  await step("A10", "configure-analysis", "administrator", "browser-walkthrough", "Open the evidence sparkle for Notice period (days) on Overview; check the doc panel opens on the cited Version", async () => {
    await page.goto(`${BASE}/contracts/${analysisNumber}`);
    const sparkles = page.getByRole("button", { name: /^View AI evidence for / });
    await sparkles.first().waitFor({ timeout: 20000 });
    const names = await sparkles.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
    const notice = page.getByRole("button", { name: /^View AI evidence for Notice period/ }).first();
    const aiCalls = [];
    const l = (r) => /\/api\/v1\/(ai-connector|contracts\/\d+\/analysis$)/.test(r.url()) && r.method() !== "GET" && aiCalls.push(r.url());
    page.on("request", l);
    await notice.click();
    await wait(4000);
    page.off("request", l);
    const url = page.url();
    const popover = await page.getByRole("dialog").allInnerTexts().catch(() => []);
    const marks = await page.locator("mark").allInnerTexts().catch(() => []);
    const panel = await page.getByRole("complementary").allInnerTexts().catch(() => []);
    expect(names.length > 0 && aiCalls.length === 0, `sparkles=${names.length} aiCalls=${aiCalls.length}`);
    return `Evidence sparkles on Overview: ${names.join(", ")}. Selecting the Notice period sparkle made no AI call (${aiCalls.length}). URL after: ${url.replace(BASE, "")}. Highlighted text: ${JSON.stringify(marks.slice(0, 3))}. Popover text: ${JSON.stringify(popover.map((t) => t.replace(/\s+/g, " ").slice(0, 120)))}. Side panel starts: "${panel.join(" ").replace(/\s+/g, " ").slice(0, 200)}".`;
  });

  // ---- Failure behaviour and disabling
  let noPaperNumber;
  await step("A11", "configure-analysis", "administrator", "browser-walkthrough", "Failure the articles document: Analysis refused for a Contract without a primary Document while the connector passes its test", async () => {
    const c = await findOrCreateContract(admin, "DOC-029 live analysis no paper", "NDA", MEMBER.email);
    noPaperNumber = c.number;
    const r = await api(admin, "POST", `/contracts/${c.number}/analysis`);
    await openFields(page, c.number);
    const card = analysisCard(page);
    const cardShown = await card.count();
    let uiResult = "card absent";
    if (cardShown) {
      const btn = card.getByRole("button", { name: "Run analysis" });
      if (await btn.count()) {
        await btn.click();
        await wait(2500);
        uiResult = `card shown; after Run analysis the page says: "${(await text(card)).slice(0, 250)}"`;
      } else uiResult = `card shown without Run analysis: "${(await text(card)).slice(0, 200)}"`;
    }
    const toast = await page.getByRole("status").allInnerTexts().catch(() => []);
    expect(r.status === 409, `API answered ${r.status}`);
    return `C-${c.number} has no primary Document. POST /analysis answered ${r.status} "${r.json?.detail}". In the browser: ${uiResult}. Status regions: ${toast.join(" | ").replace(/\s+/g, " ").slice(0, 200)}.`;
  });

  await step("A12", "configure-analysis", "administrator", "browser-walkthrough", "Turn off Use AI analysis; check chip, Test connection, Request conversion switches, Contract card and refusal", async (e) => {
    await openAiSettings(page);
    const t0 = Date.now();
    const off = page.waitForResponse((r) => r.url().endsWith("/api/v1/ai-connector/disable"), { timeout: 20000 });
    await page.locator("#ai-enabled").click();
    const res = await off;
    await page.getByText("Turned off", { exact: true }).first().waitFor({ timeout: 10000 });
    const hint = await page.locator("#ai-enabled-hint").innerText();
    const testDisabled = await page.getByRole("button", { name: "Test connection" }).isDisabled();
    const sws = [];
    for (const id of ["matter-preparation", "contract-preparation", "contract-conversion-analysis"]) sws.push(await page.locator(`#${id}`).isDisabled());
    const state = safeAi(await aiState(admin));
    await openFields(page, analysisNumber);
    const card = analysisCard(page);
    const cardCount = await card.count();
    const runCount = cardCount ? await card.getByRole("button", { name: "Run analysis" }).count() : 0;
    const unverified = await page.getByText("Unverified", { exact: true }).count();
    const refusal = await api(admin, "POST", `/contracts/${analysisNumber}/analysis`);
    const testApi = await api(admin, "POST", "/ai-connector/test");
    const menuBtn = page.getByRole("button", { name: /actions/i }).first();
    e.disabledAt = new Date(t0).toISOString();
    expect(res.status() === 200 && !state.enabled && state.model === EXPECTED_MODEL && state.hasApiKey, `disable ${res.status()} ${JSON.stringify(state)}`);
    expect(testDisabled && sws.every(Boolean), `test=${testDisabled} switches=${sws}`);
    expect(runCount === 0 && refusal.status === 409, `run button ${runCount} refusal ${refusal.status}`);
    return `The switch sent POST /ai-connector/disable (${res.status()}). Chip reads Turned off; hint "${hint}". Test connection disabled=${testDisabled}; Request conversion switches disabled=${sws.join("/")}. The stored connector kept preset, model and key (hasApiKey=${state.hasApiKey}). On C-${analysisNumber}: AI analysis card shown=${cardCount > 0}, Run analysis buttons=${runCount}, Unverified markers still shown=${unverified}. POST /analysis answered ${refusal.status} "${refusal.json?.detail}". POST /ai-connector/test answered ${testApi.status} "${testApi.json?.detail}".`;
  });

  await step("A13", "configure-analysis", "legal_team_member", "browser-walkthrough", "While off: a Legal Team Member sees no Run analysis and cannot open or change the AI settings", async () => {
    const member = await signIn(browser, MEMBER);
    await openFields(member.page, analysisNumber);
    const card = analysisCard(member.page);
    const runOff = (await card.count()) ? await card.getByRole("button", { name: "Run analysis" }).count() : 0;
    await member.page.goto(`${BASE}/settings/ai-analysis`);
    await member.page.waitForURL(`${BASE}/settings/profile`, { timeout: 20000 });
    const apiRes = await api(member, "GET", "/ai-connector");
    const prompts = await api(member, "PUT", "/ai-field-prompts", { slug: NOTICE, prompt: "DOC-029 member attempt" });
    await member.context.close();
    expect(runOff === 0 && apiRes.status === 403 && prompts.status === 403, `run=${runOff} api=${apiRes.status} prompts=${prompts.status}`);
    return `Nadia Haddad (Legal Team Member, Legal Owner of C-${analysisNumber}) sees no Run analysis while the connector is off. /settings/ai-analysis forwards to /settings/profile. GET /ai-connector answered ${apiRes.status}; a prompt save answered ${prompts.status}.`;
  });

  await step("A14", "configure-analysis", "administrator", "live-provider-check", "Turn Use AI analysis on again; Test connection; Legal Team Member sees Run analysis again", async (e) => {
    await openAiSettings(page);
    const on = page.waitForResponse((r) => r.url().endsWith("/api/v1/ai-connector/enable"), { timeout: 20000 });
    await page.locator("#ai-enabled").click();
    const res = await on;
    await page.getByRole("button", { name: "Test connection" }).waitFor();
    await until(async () => page.getByRole("button", { name: "Test connection" }).isEnabled(), "Test connection stayed disabled", 10000, 300);
    const t0 = Date.now();
    await page.getByRole("button", { name: "Test connection" }).click();
    const ok = page.getByText("Connection successful.", { exact: true });
    const bad = page.getByText(/^The connection test failed/);
    await Promise.race([ok.waitFor({ timeout: 90000 }), bad.waitFor({ timeout: 90000 })]);
    e.testMs = Date.now() - t0;
    const failed = await bad.isVisible().catch(() => false);
    const state = safeAi(await aiState(admin));
    const member = await signIn(browser, MEMBER);
    await openFields(member.page, analysisNumber);
    const runOn = await analysisCard(member.page).getByRole("button", { name: "Run analysis" }).count();
    await member.context.close();
    expect(res.status() === 200 && state.enabled && !failed && state.model === EXPECTED_MODEL, `enable ${res.status()} failed=${failed}`);
    return `The switch sent POST /ai-connector/enable (${res.status()}). Chip Connected=${await page.getByText("Connected", { exact: true }).first().isVisible()}. Test connection showed "Connection successful." after ${e.testMs} ms. Model ${state.model}. Nadia Haddad now sees Run analysis buttons: ${runOn}.`;
  }, { kindOnFail: "environment" });

  await step("A15", "configure-analysis", "administrator", "browser-walkthrough", "Load models failure: Custom endpoint with a fictional key against a missing path (not saved)", async () => {
    await openAiSettings(page);
    await page.locator("#ai-preset").selectOption("custom");
    await page.locator("#ai-protocol").selectOption({ label: "OpenAI-compatible chat completions" }).catch(() => {});
    await page.locator("#ai-base-url").fill("https://openrouter.ai/api/doc029-missing-path");
    await page.locator("#ai-api-key").fill("doc029-fictional-not-a-key");
    const listed = page.waitForResponse((r) => r.url().endsWith("/api/v1/ai-connector/models"), { timeout: 90000 });
    await page.getByRole("button", { name: "Load models" }).click();
    const res = await listed;
    const err = page.getByText("Models could not be loaded").or(page.locator(".text-status-danger-fg")).first();
    await err.waitFor({ timeout: 30000 });
    const shown = await err.innerText();
    const manual = await page.getByRole("button", { name: "Enter model ID manually" }).count();
    await page.reload();
    const state = safeAi(await aiState(admin));
    expect(res.status() >= 400 && state.preset === "openrouter" && state.model === EXPECTED_MODEL && state.hasApiKey, `status=${res.status()} ${JSON.stringify(state)}`);
    return `Load models answered ${res.status()}. The pane showed "${shown.replace(/\s+/g, " ")}" beside the control; Enter model ID manually buttons: ${manual}. After reload the saved connector is still OpenRouter ${state.model}.`;
  });

  await step("A16", "configure-analysis", "administrator", "browser-walkthrough", "Reset the notice-period prompt to default; check the end state", async () => {
    await openAiSettings(page);
    const reset = page.getByRole("button", { name: /^Reset .*notice.* to default$/i });
    const put = page.waitForResponse((r) => r.url().endsWith("/api/v1/ai-field-prompts") && r.request().method() === "PUT", { timeout: 20000 });
    await reset.click();
    await put;
    await reset.waitFor({ state: "detached", timeout: 10000 });
    const prompts = (await api(admin, "GET", "/ai-field-prompts")).json.prompts;
    const overridden = prompts.filter((p) => p.overridden).map((p) => p.slug);
    const state = safeAi(await aiState(admin));
    log.finalAiConnector = state;
    expect(overridden.length === 0 && state.enabled && state.preset === "openrouter" && state.model === EXPECTED_MODEL && state.hasApiKey, `overridden=${overridden} ${JSON.stringify(state)}`);
    return `Reset to default restored the built-in notice-period prompt and the link disappeared. Overridden prompts: none. Connector: enabled, OpenRouter, ${state.model}, key stored. Request conversion switches: ${state.matterPreparation}/${state.contractPreparation}/${state.contractConversionAnalysis}.`;
  });
  log.guardBlockedCount = log.guard.filter((g) => g.blocked).length;
  await admin.context.close();
}

// ============================================================================ C42
async function c42(browser) {
  const admin = await signIn(browser, ADMIN);
  const page = admin.page;
  const before = safeSig(await sigState(admin));
  log.initialSigningConnector = before;
  expect(before.configured && before.enabled && before.environment === "demo" && before.updateMode === "polling" && before.hasPrivateKey, `unexpected start ${JSON.stringify(before)}`);
  const sigWrites = [];
  page.on("request", (r) => {
    if (["PUT", "POST", "PATCH", "DELETE"].includes(r.method()) && /signing-connectors|envelopes/.test(r.url())) sigWrites.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });

  await step("S01", "configure-signing", "administrator", "browser-walkthrough", "Open Settings > Organization > Integrations > E-signature; expand DocuSign; check the saved Polling connector", async () => {
    await page.goto(`${BASE}/settings/profile`);
    const org = page.getByRole("group", { name: "Organization" });
    await org.waitFor({ timeout: 20000 });
    await org.getByRole("link", { name: "Integrations", exact: true }).click();
    await page.waitForURL(/\/settings\/integrations\/e-signature$/);
    const collapsed = await openSigningSettings(page);
    const env = await page.getByLabel("Environment").inputValue();
    const mode = await page.getByLabel("Signing updates").inputValue();
    const rsaBlank = (await page.getByLabel("RSA private key").inputValue()) === "";
    const callback = await page.getByLabel("Public callback URL").count();
    const hmac = await page.getByLabel("Connect HMAC secret").count();
    const webhookUrl = await page.locator("#ds-webhook-url").count();
    const chip = await page.getByText("Connected", { exact: true }).first().isVisible();
    const sw = page.getByRole("switch", { name: "Send for signature from records" });
    const swOn = await sw.getAttribute("aria-checked");
    const pollingHint = await page.getByText(/^Keeps OpenLaw private\./).isVisible();
    const remove = await page.getByRole("button", { name: "Remove connector" }).count();
    expect(env === "demo" && mode === "polling" && rsaBlank && callback === 0 && hmac === 0 && chip && swOn === "true", `env=${env} mode=${mode} rsaBlank=${rsaBlank} callback=${callback} hmac=${hmac} chip=${chip} switch=${swOn}`);
    return `Integrations opens /settings/integrations/e-signature. DocuSign card started collapsed=${collapsed}. Environment Demo; Signing updates Polling with the "Keeps OpenLaw private..." hint (${pollingHint}). Integration key and User ID are filled (values not recorded). RSA private key input is blank. Public callback URL, Connect HMAC secret and Webhook URL are absent (${callback}/${hmac}/${webhookUrl}). Chip reads Connected; Send for signature from records is on. Remove connector is present (${remove}) and was not selected.`;
  });

  await step("S02", "configure-signing", "administrator", "live-provider-check", "Test connection against DocuSign Demo", async (e) => {
    const t0 = Date.now();
    await page.getByRole("button", { name: "Test connection" }).click();
    const ok = page.getByText(/^Connected to .*\.$/);
    const bad = page.getByText(/^The connection test failed/);
    await Promise.race([ok.waitFor({ timeout: 90000 }), bad.waitFor({ timeout: 90000 })]);
    e.testMs = Date.now() - t0;
    const failed = await bad.isVisible().catch(() => false);
    const msg = failed ? await bad.innerText() : await ok.innerText();
    e.account = msg;
    expect(!failed, msg);
    return `Test connection showed "${msg}" after ${e.testMs} ms (DocuSign Demo).`;
  }, { kindOnFail: "environment" });

  await step("S03", "configure-signing", "administrator", "browser-walkthrough", "Choose Webhook without saving; check the extra fields; Save with the HMAC secret blank", async () => {
    await page.getByLabel("Signing updates").selectOption("webhook");
    const callback = page.getByLabel("Public callback URL");
    await callback.waitFor({ timeout: 5000 });
    const hmac = page.getByLabel("Connect HMAC secret");
    const required = await hmac.evaluate((el) => el.required);
    const hint = await page.getByText(/^Required\. OpenLaw checks it on every delivery/).isVisible();
    const callbackHint = await page.getByText(/^Enter the gateway's HTTPS address/).innerText();
    const webhookHint = await page.getByText(/^Receives updates as DocuSign delivers them/).isVisible();
    const n = sigWrites.length;
    await page.getByRole("button", { name: "Save connector" }).click();
    await wait(1000);
    const missing = await hmac.evaluate((el) => el.validity.valueMissing);
    const state = safeSig(await sigState(admin));
    expect(required && missing && sigWrites.length === n && state.updateMode === "polling" && state.updatedAt === before.updatedAt, `required=${required} missing=${missing} writes=${sigWrites.slice(n)}`);
    return `Webhook shows Public callback URL (hint "${callbackHint.slice(0, 120)}...") and Connect HMAC secret (required, "Required. OpenLaw checks it on every delivery..." ${hint}). Webhook hint shown=${webhookHint}. Save with the HMAC secret blank: the browser refused the submit and sent no request. The stored mode is still Polling.`;
  });

  await step("S04", "configure-signing", "administrator", "browser-walkthrough", "Webhook refusals: http:// callback URL, and an HTTPS URL with a query (secret removed from each request by the guard)", async () => {
    const tries = [];
    for (const url of ["http://gateway.doc029.example/api/v1/signing/docusign/webhook", "https://gateway.doc029.example/api/v1/signing/docusign/webhook?token=x", "https://user:pw@gateway.doc029.example/hook"]) {
      await page.getByLabel("Public callback URL").fill(url);
      await page.getByLabel("Connect HMAC secret").fill("doc029-fictional-hmac-value-never-sent");
      const put = page.waitForResponse((r) => r.url().endsWith("/api/v1/signing-connectors/docusign") && r.request().method() === "PUT", { timeout: 20000 });
      await page.getByRole("button", { name: "Save connector" }).click();
      const res = await put;
      const body = await res.json().catch(() => ({}));
      await wait(800);
      const pane = await page.getByText(/invalid|HTTPS|Paste the DocuSign Connect HMAC/i).allInnerTexts();
      tries.push({ url: url.replace(/\/\/[^@/]*@/, "//***@"), status: res.status(), api: body.detail ?? body.title ?? null, pane: pane.map((t) => t.trim()).filter((t) => t.length < 200) });
    }
    const state = safeSig(await sigState(admin));
    await page.reload();
    await openSigningSettings(page);
    const modeAfterReload = await page.getByLabel("Signing updates").inputValue();
    const rsaBlank = (await page.getByLabel("RSA private key").inputValue()) === "";
    expect(tries.every((t) => t.status === 400), JSON.stringify(tries));
    expect(state.updateMode === "polling" && !state.hasWebhookSecret && state.updatedAt === before.updatedAt && state.webhookUrlOverride === null, `stored changed ${JSON.stringify(state)}`);
    return `${tries.map((t) => `${t.url}: API ${t.status} "${t.api}"; pane shows ${JSON.stringify(t.pane)}`).join(". ")}. The stored connector did not change (Polling, no HMAC secret, updatedAt unchanged). After reload the form shows ${modeAfterReload} and a blank RSA key input=${rsaBlank}.`;
  });

  let signingNumber;
  await step("S05", "configure-signing", "administrator", "browser-walkthrough", "Prepare the fictional Contract DOC-029 live signing with a primary Document containing /sig/; move it to Out for signature", async (e) => {
    const c = await findOrCreateContract(admin, "DOC-029 live signing", "NDA", MEMBER.email);
    signingNumber = c.number;
    e.contract = `C-${c.number}`;
    let uploaded = false;
    if (!(await hasPrimary(admin, c.number))) {
      await uploadPrimary(admin, c.number, "doc029-live-signing.docx");
      uploaded = true;
    }
    const docs = (await api(admin, "GET", `/contracts/${c.number}/documents`)).json.documents;
    await page.goto(`${BASE}/contracts/${c.number}`);
    const control = page.getByRole("button", { name: /move contract$/ });
    await control.waitFor({ timeout: 20000 });
    const current = (await contractOf(admin, c.number)).contract;
    let moved = "already there";
    if (current.statusName !== "Out for signature") {
      const answered = page.waitForResponse((r) => r.url().endsWith(`/api/v1/contracts/${c.number}`) && r.request().method() === "PATCH");
      await control.click();
      await page.getByRole("menuitemradio").filter({ hasText: /^Out for signature/ }).first().click();
      moved = `PATCH ${(await answered).status()}`;
    }
    const after = (await contractOf(admin, c.number)).contract;
    const auto = (await contractOf(admin, c.number)).analysis?.latestRun;
    e.autoAnalysisOnSigningPaper = auto ? { trigger: auto.trigger, state: auto.state, model: auto.model } : null;
    return `C-${c.number} ${c.created ? "created" : "reused"} (NDA). ${uploaded ? "Uploaded" : "Kept"} doc029-live-signing.docx (sha256 d3d85da2...) as the primary Document; documents: ${docs.map((d) => d.title ?? d.name).join(", ")}. Status move: ${moved}; status now ${after.statusName} (stage ${after.stage}). Note: the AI connector was on, so the upload also queued an automatic Analysis run of this fictional paper (${auto ? `${auto.trigger} ${auto.state}` : "none seen yet"}).`;
  });

  await step("S06", "configure-signing", "administrator", "browser-walkthrough", "Turn off Send for signature from records; check Test connection and the Contract; turn it back on and retest", async (e) => {
    await openSigningSettings(page);
    const sw = page.getByRole("switch", { name: "Send for signature from records" });
    const off = page.waitForResponse((r) => r.url().endsWith("/signing-connectors/docusign/disable"), { timeout: 20000 });
    await sw.click();
    const offRes = await off;
    await page.getByText("Turned off", { exact: true }).first().waitFor({ timeout: 10000 });
    const testBtn = page.getByRole("button", { name: "Test connection" });
    const testEnabledWhileOff = await testBtn.isEnabled();
    let testMsg = "button disabled";
    if (testEnabledWhileOff) {
      await testBtn.click();
      const bad = page.getByText(/^The connection test failed|No e-signature connector/);
      await bad.first().waitFor({ timeout: 30000 }).catch(() => {});
      testMsg = (await page.locator("p[aria-live]").allInnerTexts()).join(" | ").trim() || "(no message)";
    }
    await openApprovals(page, signingNumber);
    const sendWhileOff = await page.getByRole("region", { name: "Approvals & signing" }).getByRole("button", { name: "Send for signature" }).count();
    await openSigningSettings(page);
    const on = page.waitForResponse((r) => r.url().endsWith("/signing-connectors/docusign/enable"), { timeout: 20000 });
    await page.getByRole("switch", { name: "Send for signature from records" }).click();
    const onRes = await on;
    await page.getByText("Connected", { exact: true }).first().waitFor({ timeout: 10000 });
    const t0 = Date.now();
    await page.getByRole("button", { name: "Test connection" }).click();
    const ok = page.getByText(/^Connected to .*\.$/);
    await ok.waitFor({ timeout: 90000 });
    e.retestMs = Date.now() - t0;
    const retestMsg = await ok.innerText();
    const state = safeSig(await sigState(admin));
    await openApprovals(page, signingNumber);
    const sendWhileOn = await page.getByRole("region", { name: "Approvals & signing" }).getByRole("button", { name: "Send for signature" }).count();
    expect(offRes.status() === 200 && onRes.status() === 200 && sendWhileOff === 0 && sendWhileOn === 1 && state.enabled && state.updateMode === "polling" && state.hasPrivateKey, `off=${offRes.status()} on=${onRes.status()} send ${sendWhileOff}/${sendWhileOn} ${JSON.stringify(state)}`);
    return `Switch off answered ${offRes.status()}; chip Turned off. Test connection stayed enabled=${testEnabledWhileOff}; selecting it showed "${testMsg}". C-${signingNumber} Approvals & signing had Send for signature buttons=${sendWhileOff} while off. Switch on answered ${onRes.status()}; retest showed "${retestMsg}" after ${e.retestMs} ms. Send for signature buttons now=${sendWhileOn}. Stored connector: enabled, Demo, Polling, RSA key kept.`;
  });

  await step("S07", "configure-signing", "administrator", "browser-walkthrough", "Open Send for signature on C-signing; fill Version, Signer name and Subject; Cancel (nothing is sent)", async (e) => {
    await openApprovals(page, signingNumber);
    await page.getByRole("region", { name: "Approvals & signing" }).getByRole("button", { name: "Send for signature" }).click();
    const dialog = page.getByRole("dialog", { name: "Send for signature" });
    await dialog.waitFor();
    const versions = (await dialog.getByLabel("Version").locator("option").allInnerTexts()).map((t) => t.trim());
    await dialog.getByLabel("Signer 1 name").fill("DOC-029 Test Signer");
    const subject = `DOC-029 live signing round trip C-${signingNumber}`;
    e.subject = subject;
    await dialog.getByLabel(/^Subject/).fill(subject);
    const labels = await dialog.locator("label").allInnerTexts();
    const n = sigWrites.length;
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await dialog.waitFor({ state: "detached", timeout: 10000 });
    const env = (await api(admin, "GET", `/contracts/${signingNumber}/envelopes`)).json;
    const sent = sigWrites.slice(n).filter((w) => w.includes("envelopes"));
    expect(sent.length === 0 && (env.envelopes?.length ?? 0) === 0, `envelopes ${env.envelopes?.length} writes ${sent}`);
    return `The dialog offered Version: ${versions.join(" | ")}. Labels: ${labels.map((t) => t.trim()).join(", ")}. After filling the Signer name and Subject "${subject}", Cancel closed the dialog. No envelope request was sent and C-${signingNumber} has 0 Envelopes. Stopped before Send envelope.`;
  });

  await step("S08", "configure-signing", "legal_team_member", "browser-walkthrough", "Legal Team Member cannot open or change the Signing connector but sees Send for signature on the reached Contract", async () => {
    const member = await signIn(browser, MEMBER);
    await member.page.goto(`${BASE}/settings/integrations/e-signature`);
    await member.page.waitForURL(`${BASE}/settings/profile`, { timeout: 20000 });
    const g = await api(member, "GET", "/signing-connectors/docusign");
    const t = await api(member, "POST", "/signing-connectors/docusign/test");
    await openApprovals(member.page, signingNumber);
    const send = await member.page.getByRole("region", { name: "Approvals & signing" }).getByRole("button", { name: "Send for signature" }).count();
    await member.context.close();
    expect(g.status === 403 && t.status === 403 && send === 1, `get=${g.status} test=${t.status} send=${send}`);
    return `Nadia Haddad: /settings/integrations/e-signature forwards to /settings/profile; GET connector ${g.status}; POST test ${t.status}. On C-${signingNumber} (her Contract) Send for signature is shown (${send}).`;
  });

  const after = safeSig(await sigState(admin));
  log.finalSigningConnector = after;
  log.guardBlockedCount = log.guard.filter((g) => g.blocked).length;
  await admin.context.close();
}

const browser = await chromium.launch();
try {
  if (PHASE === "c43") await c43(browser);
  else await c42(browser);
} catch (error) {
  log.abort = String(error?.message ?? error).split("\n").slice(0, 3).join(" ");
  console.error("ABORT", log.abort);
} finally {
  await browser.close();
  save();
}
