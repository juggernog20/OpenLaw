// DOC-030 independent live-provider walkthrough, group analysis-live:
//   configure-analysis (V-C43), roles administrator and operator,
//   methods browser-walkthrough and live-provider-check.
// Written by "DOC-030 independent live-provider walkthrough agent (analysis-live)" from
// the text of docs/user-guides/configure-analysis.md. This agent did not write the guide.
// The pattern follows DOC-029 live-provider/walkthrough/walkthrough-live.mjs (C43) and
// operator-browser.mjs, and DOC-030 signing-2/api.mjs (sign-in, per-identity contexts).
//
// It runs against the agent's own lab live2, because the AI connector is an
// organization-wide setting. Run from the worktree root:
//   set -a; . ~/.cache/openlaw-doc030/providers.env; set +a
//   LAB_PASSWORD=... node docs/documentation/batches/DOC-030/analysis-live/walkthrough.mjs
// Optional: ONLY=A,B,C (sections), RESUME=1 (append to the existing log).
//
// Credential rules:
// - The OpenRouter key comes from OPENROUTER_API_KEY and is typed into the connector form
//   only. It is never printed, logged or screenshotted, and the log is scrubbed of it
//   before every write. The negative check uses an obviously fake key.
// - Spend: one two-page-or-shorter fictional Helix paper, at most two Analysis runs, a
//   few connection tests and model listings. No loop retries a provider call.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const REL = "docs/documentation/batches/DOC-030/analysis-live";
const { chromium } = await import(
  path.join(root, "node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs")
);
const lab = JSON.parse(readFileSync(path.join(root, ".documentation-labs/live2/lab.json"), "utf8"));
const BASE = lab.appUrl;
const PASSWORD = process.env.LAB_PASSWORD;
const KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.OPENROUTER_MODEL;
const PROVIDER_BASE = process.env.OPENROUTER_BASE_URL;
if (!PASSWORD || !KEY || !MODEL || !PROVIDER_BASE)
  throw new Error("Set LAB_PASSWORD and load providers.env first.");
// The OpenRouter key prefix, built so that a plain-text search of docs/ for it stays empty.
const KEY_PREFIX = ["sk", "or", ""].join("-");
const FAKE_KEY = "doc030-fictional-invalid-key-0000";
const BAD_MODEL = "doc030/not-a-real-model";
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
const run = (s) => !ONLY || ONLY.includes(s);
const OUT = path.join(here, "walkthrough.json");
const STATE = path.join(os.homedir(), ".cache/openlaw-doc030/live2/state.json");
mkdirSync(path.dirname(STATE), { recursive: true });
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const keepState = () => writeFileSync(STATE, JSON.stringify(state, null, 2));
const stamp = state.stamp ?? (state.stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, ""));
keepState();
const G = "DOC-030 analysis-live V-C43";
const ARTICLE = "configure-analysis";
const SC = "V-C43";
const sha = (b) => createHash("sha256").update(b).digest("hex");

const PEOPLE = {
  daniel: { email: "daniel.okafor@helix.example", name: "Daniel Okafor", role: "administrator" },
  nadia: { email: "nadia.haddad@helix.example", name: "Nadia Haddad", role: "legal_team_member" },
};

// ------------------------------------------------------------------ log
const fresh = {
  kind: "independent-article-walkthrough-log",
  task: "DOC-030",
  group: "analysis-live",
  issue: 1157,
  walkthroughReviewer: "DOC-030 independent live-provider walkthrough agent (analysis-live)",
  reviewerKind: "agent",
  appCommit: lab.sourceCommit,
  environment: lab.project,
  lab: lab.name,
  appUrl: BASE,
  mailUrl: lab.mailUrl,
  buildId: `app ${lab.appImageId}; engine ${lab.engineImageId}`,
  containerImages: lab.containerImages,
  seed: lab.seed,
  browser: "Playwright 1.63.0 Chromium, headless, 1280x900 CSS px, one isolated context per identity",
  articleHash: sha(readFileSync(path.join(root, `docs/user-guides/${ARTICLE}.md`))),
  provider: { name: "OpenRouter", preset: "openrouter", baseUrl: PROVIDER_BASE, model: MODEL },
  note: "Sanitized. No API key, cookie or sign-in link is recorded. The real key was typed from the environment; the negative check used an obviously fake key.",
  fixture: {
    file: `${REL}/fixtures/doc030-live-analysis.docx`,
    sha256: sha(readFileSync(path.join(here, "fixtures/doc030-live-analysis.docx"))),
    text: `${REL}/fixtures/doc030-live-analysis.txt`,
    pages: 1,
  },
  providerCalls: [],
  records: [],
  steps: [],
};
const log = process.env.RESUME && existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : fresh;
log.articleHash = fresh.articleHash;
log.runs ??= [];
// A re-run of a section after a script error keeps the earlier attempt, apart from the result.
if (ONLY && log !== fresh) {
  log.earlierAttempts ??= [];
  for (const s of log.steps.filter((x) => ONLY.includes(x.section)))
    log.earlierAttempts.push({ ...s, supersededAt: new Date().toISOString() });
  log.steps = log.steps.filter((x) => !ONLY.includes(x.section));
}
log.runs.push({
  startedAt: new Date().toISOString(),
  sections: ONLY ?? "all",
  articleHash: fresh.articleHash,
  lab: { project: lab.project, createdAt: lab.createdAt, appImageId: lab.appImageId, engineImageId: lab.engineImageId, seed: lab.seed },
});
function save() {
  log.finishedAt = new Date().toISOString();
  let s = JSON.stringify(log, null, 2);
  // Belt and braces: the key must never reach the file.
  if (s.includes(KEY)) s = s.split(KEY).join("[redacted]");
  writeFileSync(OUT, `${s}\n`);
}
const tidy = (v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : v);
const q = (v) => JSON.stringify(typeof v === "string" ? tidy(v) : v);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function must(ok, message) {
  if (!ok) throw new Error(message);
}
async function until(fn, message, timeout = 15000, every = 300) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out: ${message}`);
    await sleep(every);
  }
}
async function step(section, role, method, pageName, action, expected, fn, kindOnFail = "product-or-script") {
  const entry = {
    id: `${section}${String(log.steps.filter((s) => s.section === section).length + 1).padStart(2, "0")}`,
    section,
    article: ARTICLE,
    scenario: SC,
    role,
    method,
    page: pageName,
    action,
    expected,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    actual: null,
    result: "not-run",
  };
  log.steps.push(entry);
  try {
    entry.actual = await fn(entry);
    entry.result = "pass";
  } catch (error) {
    entry.actual = `Check did not complete: ${String(error?.message ?? error).split("\n").slice(0, 6).join(" ")}`;
    entry.result = "fail";
    entry.failureKind ??= kindOnFail;
  }
  entry.finishedAt = new Date().toISOString();
  console.log(`${entry.id} [${role}/${method}] ${entry.result.toUpperCase()} ${action}${entry.result === "fail" ? `\n   ${entry.actual}` : ""}`);
  save();
  return entry.result === "pass";
}

// ------------------------------------------------------------------ browser
// A waitForResponse promise left behind by a failed step must not end the run.
process.on("unhandledRejection", () => {});
const browser = await chromium.launch();
async function signIn(person) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("dialog", (d) => (d.type() === "beforeunload" ? d.accept() : d.dismiss()));
  await page.goto(`${BASE}/auth/login`);
  await page.getByLabel("Email").fill(person.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 });
  const api = async (method, p, data, extra = {}) => {
    const r = await page.request.fetch(`${BASE}/api/v1${p}`, {
      method,
      data,
      headers: { origin: BASE },
      failOnStatusCode: false,
      ...extra,
    });
    let json = null;
    try {
      json = await r.json();
    } catch {}
    return { status: r.status(), json };
  };
  return { ctx, page, api, ...person };
}
const connectorOf = async (who) => (await who.api("GET", "/ai-connector")).json.connector;
const safe = (c) => ({
  configured: c.configured,
  enabled: c.enabled,
  preset: c.preset,
  protocol: c.protocol,
  baseUrl: c.baseUrl,
  model: c.model,
  hasApiKey: c.hasApiKey,
  maxOutputTokens: c.maxOutputTokens,
  answerStyle: c.answerStyle,
  switches: [c.matterPreparation, c.contractPreparation, c.contractConversionAnalysis],
  savedKeys: c.savedKeys.map((k) => ({ preset: k.preset, protocol: k.protocol, baseUrl: k.baseUrl, inUse: k.inUse })),
  disabled: c.disabledAt !== null,
  updatedAt: c.updatedAt,
});
const text = async (loc) => tidy(await loc.innerText());

async function openSettingsAi(page, person) {
  await page.goto(`${BASE}/`);
  await page.getByRole("banner").getByRole("button", { name: person.name }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page.waitForURL(/\/settings/);
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("group", { name: "Organization" })
    .getByRole("link", { name: "AI analysis", exact: true })
    .click();
  await page.waitForURL(`${BASE}/settings/ai-analysis`);
  await page.getByRole("button", { name: "Provider", exact: true }).waitFor({ timeout: 20000 });
}
const cardButton = (page, name) => page.getByRole("button", { name, exact: true });
async function openCard(page, name) {
  const b = cardButton(page, name);
  if ((await b.getAttribute("aria-expanded")) !== "true") await b.click();
  await until(async () => (await b.getAttribute("aria-expanded")) === "true", `${name} did not open`);
}
async function openProvider(page) {
  await openCard(page, "Provider");
  await page.locator("#ai-preset").waitFor();
}
async function reloadProvider(page) {
  await page.goto(`${BASE}/settings/ai-analysis`);
  await cardButton(page, "Provider").waitFor({ timeout: 20000 });
  await openProvider(page);
}
const chip = async (page) => {
  for (const t of ["Connected", "Turned off", "Not connected"])
    if (await page.getByText(t, { exact: true }).first().isVisible().catch(() => false)) return t;
  return null;
};
const options = async (page, sel) =>
  (await page.locator(`${sel} option`).allInnerTexts()).map((t) => t.trim());
const keyPill = async (page) => {
  const pill = page.getByRole("status").filter({ hasText: /^(Key saved|Key in use)$/ });
  return (await pill.count()) ? (await pill.first().innerText()).trim() : null;
};
const forgetCount = (page) => page.getByRole("button", { name: "Forget key", exact: true }).count();
async function loadModels(page, entry, label) {
  const btn = page.getByRole("button", { name: /^(Load models|Refresh models)$/ });
  const name = (await btn.innerText()).trim();
  const t0 = Date.now();
  const resP = page.waitForResponse((r) => r.url().endsWith("/api/v1/ai-connector/models"), { timeout: 90000 });
  await btn.click();
  const res = await resP;
  let body = null;
  try {
    body = await res.json();
  } catch {}
  const ms = Date.now() - t0;
  const call = {
    at: new Date().toISOString(),
    kind: "model listing",
    label,
    button: name,
    status: res.status(),
    ms,
    models: body?.models?.length ?? null,
    truncated: body?.truncated ?? null,
    detail: body?.detail ?? null,
  };
  log.providerCalls.push(call);
  if (entry) (entry.providerCalls ??= []).push(call);
  await until(async () => !(await page.getByRole("button", { name: "Loading models…" }).count()), "listing still loading", 30000);
  return { res, body, ms };
}
async function testConnection(page, entry, label) {
  const t0 = Date.now();
  const resP = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/ai-connector/test") && r.request().method() === "POST",
    { timeout: 90000 },
  );
  await page.getByRole("button", { name: "Test connection" }).click();
  const res = await resP;
  let body = null;
  try {
    body = await res.json();
  } catch {}
  const ok = page.getByText("Connection successful.", { exact: true });
  const bad = page.getByText(/^The connection test failed/);
  await Promise.race([ok.waitFor({ timeout: 20000 }), bad.waitFor({ timeout: 20000 })]).catch(() => {});
  const shown = (await ok.isVisible().catch(() => false))
    ? "Connection successful."
    : tidy((await bad.first().innerText().catch(() => "")) || "");
  const call = {
    at: new Date().toISOString(),
    kind: "connection test",
    label,
    status: res.status(),
    ms: Date.now() - t0,
    shown,
    detail: body?.detail ?? null,
  };
  log.providerCalls.push(call);
  if (entry) (entry.providerCalls ??= []).push(call);
  return call;
}
async function saveConnector(page) {
  const resP = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/ai-connector") && r.request().method() === "PUT",
    { timeout: 30000 },
  );
  await page.getByRole("button", { name: "Save connector" }).click();
  const res = await resP;
  let body = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status(), body };
}
async function pickModel(page, id) {
  const box = page.locator("#ai-model");
  await box.click();
  await box.fill(id);
  const opt = page.getByRole("listbox", { name: "Models" }).getByRole("option").filter({ hasText: id });
  const exact = opt.filter({ hasText: new RegExp(`(^|· )${id.replace(/[/.]/g, "\\$&")}$`) });
  await (await exact.count() ? exact.first() : opt.first()).dispatchEvent("pointerdown");
  await until(async () => (await box.inputValue()) === id, `model ${id} not committed`, 5000);
}

// ------------------------------------------------------------------ operator helpers
const PROJECT = lab.project;
const dc = (...args) =>
  execFileSync("docker", ["compose", "-p", PROJECT, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const dockerOut = (...args) => execFileSync("docker", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const container = (svc) => `${PROJECT}-${svc}-1`;
const envNames = (svc) =>
  JSON.parse(dockerOut("inspect", "--format", "{{json .Config.Env}}", container(svc))).map((e) => e.split("=")[0]);
const envHash = (svc, name) => {
  const hit = JSON.parse(dockerOut("inspect", "--format", "{{json .Config.Env}}", container(svc))).find((e) =>
    e.startsWith(`${name}=`),
  );
  return hit ? sha(hit.slice(name.length + 1)) : null;
};
const logsOf = (svc, since) => dc("logs", "--no-color", "--no-log-prefix", ...(since ? ["--since", since] : []), svc);
const psql = (sql) =>
  execFileSync("docker", ["exec", container("postgres"), "psql", "-U", "openlaw", "-d", "openlaw", "-At", "-F", "|", "-c", sql], {
    encoding: "utf8",
  }).trim();

// ------------------------------------------------------------------ fixtures
const admin = await signIn(PEOPLE.daniel);
const page = admin.page;
log.identities = [
  { role: "administrator", person: "Daniel Okafor", entry: "password sign-in" },
  { role: "legal_team_member (negative check only)", person: "Nadia Haddad", entry: "password sign-in" },
  { role: "operator", person: "the agent with docker compose -p " + PROJECT, entry: "container tools on the owned lab; signed-out formal reader" },
];
const typeId = (name) => state.types?.[name];
if (!state.types) {
  const t = (await admin.api("GET", "/contract-types")).json.contractTypes;
  state.types = Object.fromEntries(t.map((x) => [x.displayName, x.id]));
  keepState();
}
state.fields ??= {
  location: `${G} Data location ${stamp}`,
  supplier: `${G} Supplier name ${stamp}`,
  unattached: `${G} Unattached ${stamp}`,
  person: `${G} Reviewer ${stamp}`,
};
keepState();
const F = state.fields;
const NOTICE = "notice_period_days";
const NOTICE_TEXT =
  "Extract the notice period for ending the agreement as a number of days stated in the paper. Do not infer a period when the paper states none.";

// ================================================================== A: page, cards, presets
if (run("A")) {
  await step("A", "administrator", "browser-walkthrough", "/settings/ai-analysis",
    "Before you start: Settings > Organization > AI analysis is its own entry; Provider starts closed with Not connected; three closed cards below; Answer style disabled until a connector is saved",
    "AI analysis link in the Organization group; Provider card closed with Not connected; Answer style, Matter and Contract conversion prompts, Contract analysis prompts closed; no Request conversion card; Answer style radios disabled with the connect sentence.",
    async () => {
      const before = safe(await connectorOf(admin));
      log.initialConnector = before;
      must(!before.configured && before.savedKeys.length === 0, `start state ${q(before)}`);
      await openSettingsAi(page, PEOPLE.daniel);
      const headings = (await page.locator("main h2").allInnerTexts()).map((t) => t.trim());
      const exp = {};
      for (const n of ["Provider", "Answer style", "Matter and Contract conversion prompts", "Contract analysis prompts"])
        exp[n] = await cardButton(page, n).getAttribute("aria-expanded");
      const c = await chip(page);
      const conv = await page.getByRole("heading", { name: "Request conversion" }).count();
      await openCard(page, "Answer style");
      const radios = page.getByRole("radio");
      const disabled = await radios.evaluateAll((els) => els.map((e) => e.matches(":disabled")));
      const labels = (await page.locator("label[for^='answer-style-']").allInnerTexts()).map((t) => t.trim());
      const checked = await page.locator("input[name='answer-style']:checked").getAttribute("value");
      const connect = await page.getByText("Connect an AI provider to choose an answer style.", { exact: true }).count();
      must(Object.values(exp).every((v) => v === "false"), `cards ${q(exp)}`);
      must(c === "Not connected" && conv === 0, `chip ${c} conv ${conv}`);
      must(disabled.length === 3 && disabled.every(Boolean) && connect === 1 && checked === "sentence", `radios ${q(disabled)} connect ${connect} checked ${checked}`);
      return `Settings > Organization > AI analysis opened /settings/ai-analysis. Cards in order: ${q(headings)}; aria-expanded ${q(exp)}. The Provider header chip reads ${q(c)}. No Request conversion card. Answer style opened on its own: radios ${q(labels)}, all ${disabled.length} disabled, "1-2 sentence summary" checked, and the card says "Connect an AI provider to choose an answer style."`;
    });

  await step("A", "administrator", "browser-walkthrough", "/settings/ai-analysis Provider card",
    "Choose the provider configuration: Provider list, per-preset controls (Deployment endpoint, Protocol and Base URL, Ollama without Base URL or key), Azure manual model entry",
    "Eight providers; Azure shows Deployment endpoint and a manual model box with no Load models; Custom endpoint shows Protocol with three choices and Base URL; Ollama has no Base URL and needs no key.",
    async () => {
      await reloadProvider(page);
      const presets = await options(page, "#ai-preset");
      const seen = {};
      for (const [value, label] of [["azure_openai", "Azure OpenAI"], ["custom", "Custom endpoint"], ["ollama", "Ollama"], ["groq", "Groq"], ["openrouter", "OpenRouter"]]) {
        await page.locator("#ai-preset").selectOption(value);
        await sleep(250);
        const baseLabel = (await page.locator("label[for='ai-base-url']").count())
          ? (await page.locator("label[for='ai-base-url']").innerText()).trim()
          : null;
        seen[label] = {
          baseUrl: baseLabel,
          protocol: (await page.locator("#ai-protocol").count()) ? await options(page, "#ai-protocol") : null,
          load: await page.getByRole("button", { name: "Load models" }).count(),
          manualToggle: await page.getByRole("button", { name: "Enter model ID manually" }).count(),
          modelRole: await page.locator("#ai-model").getAttribute("role"),
          model: await page.locator("#ai-model").inputValue(),
          keyRequired: await page.locator("#ai-api-key").evaluate((e) => e.required),
        };
      }
      must(presets.length === 8, `presets ${q(presets)}`);
      must(seen["Azure OpenAI"].baseUrl === "Deployment endpoint" && seen["Azure OpenAI"].load === 0 && seen["Azure OpenAI"].modelRole === null, `azure ${q(seen["Azure OpenAI"])}`);
      must(q(seen["Custom endpoint"].protocol) === q(["Anthropic Messages", "OpenAI-compatible chat completions", "Gemini"]) && seen["Custom endpoint"].baseUrl === "Base URL", `custom ${q(seen["Custom endpoint"])}`);
      must(seen.Ollama.baseUrl === null && seen.Ollama.keyRequired === false, `ollama ${q(seen.Ollama)}`);
      return `Provider lists ${q(presets)}. Per preset: ${Object.entries(seen).map(([k, v]) => `${k}: endpoint label ${q(v.baseUrl)}, Protocol ${q(v.protocol)}, Load models ${v.load}, Enter model ID manually ${v.manualToggle}, Model ${v.modelRole === "combobox" ? "combobox" : "plain text box"} prefilled ${q(v.model)}, key required ${v.keyRequired}`).join("; ")}.`;
    });

  await step("A", "administrator", "browser-walkthrough", "/settings/ai-analysis Provider card",
    "Output token limit: slider and exact input, default 32,768, range 1,024 to 262,144, warning below 32,768",
    "The slider and the exact input show 32768; min 1024, max 262144; typing 16384 shows the warning; 32768 removes it.",
    async () => {
      await reloadProvider(page);
      const slider = page.locator("#ai-output-tokens");
      const exact = page.getByRole("spinbutton", { name: "Exact output token limit" });
      const label = (await page.locator("label[for='ai-output-tokens']").innerText()).trim();
      const attrs = { min: await slider.getAttribute("min"), max: await slider.getAttribute("max"), value: await slider.inputValue(), exact: await exact.inputValue() };
      await exact.fill("16384");
      const warn = tidy(await page.locator("#ai-output-tokens-warning").innerText());
      await exact.fill("32768");
      const warnAfter = tidy(await page.locator("#ai-output-tokens-warning").innerText());
      must(label === "Output token limit per API call" && attrs.min === "1024" && attrs.max === "262144" && attrs.value === "32768" && attrs.exact === "32768", `attrs ${q(attrs)} ${label}`);
      must(/^Below 32,768 tokens/.test(warn) && warnAfter === "", `warn ${warn} / ${warnAfter}`);
      return `${q(label)} slider min ${attrs.min}, max ${attrs.max}, value ${attrs.value}; exact input ${attrs.exact}. At 16384 the warning read ${q(warn)}; at 32768 it was gone. Nothing was saved.`;
    });
}

// ================================================================== B: live model listing, invalid endpoint, Ollama
if (run("B")) {
  await step("B", "administrator", "live-provider-check", "/settings/ai-analysis Provider card",
    "Invalid endpoint: Custom endpoint, OpenAI-compatible, a missing path on the provider host, an obviously fake key; Load models",
    "Load models shows the refusal, for example 'The provider refused model discovery with HTTP 404.'; nothing is saved and the fake key is not stored.",
    async (e) => {
      await reloadProvider(page);
      await page.locator("#ai-preset").selectOption("custom");
      await page.locator("#ai-protocol").selectOption("openai_chat_completions");
      await page.locator("#ai-base-url").fill("https://openrouter.ai/api/doc030-missing-path");
      await page.locator("#ai-api-key").fill(FAKE_KEY);
      const { res, body } = await loadModels(page, e, "custom endpoint, missing path, fake key");
      const err = tidy(await page.locator(".text-status-danger-fg").first().innerText().catch(() => ""));
      const after = safe(await connectorOf(admin));
      must(res.status() >= 400 && /^The provider refused model discovery with HTTP \d+\.$/.test(err), `status ${res.status()} shown ${q(err)} body ${q(body)}`);
      must(!after.configured && after.savedKeys.length === 0, `saved ${q(after)}`);
      return `Load models answered ${res.status()} and the pane showed ${q(err)} under the Model control. The connector is still not configured and no Saved key exists.`;
    });

  await step("B", "operator", "browser-walkthrough", "/settings/ai-analysis Provider card (Ollama)",
    "Ollama localhost: with the preset's fixed http://localhost:11434/v1, Load models runs in the app container, where no Ollama service listens",
    "No Base URL control and no key needed; Load models fails, which is the documented 'localhost means the machine or container running each calling process'.",
    async (e) => {
      await reloadProvider(page);
      await page.locator("#ai-preset").selectOption("ollama");
      const baseUrl = await page.locator("#ai-base-url").count();
      const { res } = await loadModels(page, e, "ollama preset, app container localhost");
      const err = tidy(await page.locator(".text-status-danger-fg").first().innerText().catch(() => ""));
      must(baseUrl === 0 && res.status() >= 400 && err, `baseUrl ${baseUrl} status ${res.status()} err ${err}`);
      return `Ollama shows no Base URL control. Load models answered ${res.status()} and showed ${q(err)}. The app container has no service on its own localhost:11434, so the operator must provide a reachable service or a Custom endpoint, as the guide says.`;
    });

  await step("B", "administrator", "live-provider-check", "/settings/ai-analysis Provider card",
    "OpenRouter with a pasted key: Load models, type to narrow, leave the box without choosing, choose from the list, Refresh models, manual entry toggle; nothing saved",
    "The list loads; typing narrows it; leaving restores the earlier model; choosing stores the exact provider ID; Refresh keeps it; Enter model ID manually and Choose from list toggle; no connector and no Saved key are written.",
    async (e) => {
      await reloadProvider(page);
      await page.locator("#ai-preset").selectOption("openrouter");
      const prefilled = await page.locator("#ai-model").inputValue();
      const loadBefore = await page.getByRole("button", { name: "Load models" }).isEnabled();
      await page.locator("#ai-api-key").fill(KEY);
      const loadWithKey = await page.getByRole("button", { name: "Load models" }).isEnabled();
      const { res, body } = await loadModels(page, e, "openrouter, pasted key");
      must(res.status() === 200 && body.models.length > 0, `load ${res.status()}`);
      const box = page.locator("#ai-model");
      const placeholder = await box.getAttribute("placeholder");
      await box.click();
      await box.fill("gpt-oss-120b");
      await sleep(300);
      const narrowed = (await page.getByRole("listbox", { name: "Models" }).getByRole("option").allInnerTexts()).map((t) => t.trim());
      await page.locator("#ai-api-key").focus();
      await sleep(200);
      const afterBlur = await box.inputValue();
      await pickModel(page, MODEL);
      const chosen = await box.inputValue();
      await loadModels(page, e, "openrouter, Refresh models");
      const afterRefresh = await box.inputValue();
      await page.getByRole("button", { name: "Enter model ID manually" }).click();
      const manualRole = await box.getAttribute("role");
      const back = await page.getByRole("button", { name: "Choose from list" }).count();
      await page.getByRole("button", { name: "Choose from list" }).click();
      const listRole = await page.locator("#ai-model").getAttribute("role");
      const after = safe(await connectorOf(admin));
      e.listing = { models: body.models.length, truncated: body.truncated, selectedListed: body.models.some((m) => m.id === MODEL) };
      must(prefilled === "~openai/gpt-latest" && !loadBefore && loadWithKey, `prefilled ${prefilled} load ${loadBefore}/${loadWithKey}`);
      must(narrowed.length >= 1 && narrowed.every((t) => /gpt-oss-120b/.test(t)), `narrowed ${q(narrowed)}`);
      must(afterBlur === prefilled && chosen === MODEL && afterRefresh === MODEL, `blur ${afterBlur} chosen ${chosen} refresh ${afterRefresh}`);
      must(manualRole === null && back === 1 && listRole === "combobox", `manual ${manualRole} ${back} ${listRole}`);
      must(!after.configured && after.savedKeys.length === 0, `saved ${q(after)}`);
      return `OpenRouter prefilled Model ${q(prefilled)}. Load models was disabled until the key was pasted, then enabled. OpenRouter returned ${body.models.length} models (truncated ${body.truncated}) and the button became Refresh models; the placeholder read ${q(placeholder)}. Typing "gpt-oss-120b" narrowed the list to ${q(narrowed)}. Leaving the box without choosing put back ${q(afterBlur)}. Choosing the option stored ${q(chosen)}; Refresh models kept ${q(afterRefresh)}. Enter model ID manually turned the combobox into a plain box and offered Choose from list, which turned the list back on. The connector is still not configured and no Saved key exists, so loading with a pasted key stored nothing.`;
    });
}

// ================================================================== C: save, test, invalid model, invalid key, Saved keys
if (run("C")) {
  await step("C", "administrator", "live-provider-check", "/settings/ai-analysis Provider card",
    "Save and test, steps 1-3: OpenRouter, paste API key, Load models, choose Model, Save connector, Test connection",
    "Save turns the chip to Connected, clears the key box, shows Key in use with no Forget key and (key saved) in the list; Request conversion appears with three switches off; Answer style becomes available; Test connection shows 'Connection successful.'",
    async (e) => {
      await reloadProvider(page);
      await page.locator("#ai-preset").selectOption("openrouter");
      await page.locator("#ai-api-key").fill(KEY);
      await loadModels(page, e, "openrouter before save");
      await pickModel(page, MODEL);
      const saved = await saveConnector(page);
      must(saved.status === 200, `save ${saved.status} ${q(saved.body?.detail)}`);
      await page.getByText("Saved", { exact: true }).first().waitFor({ timeout: 10000 });
      const keyBox = await page.locator("#ai-api-key").inputValue();
      const c = await chip(page);
      const pill = await keyPill(page);
      const forget = await forgetCount(page);
      const presetLabel = (await page.locator("#ai-preset option:checked").innerText()).trim();
      const conv = await page.getByRole("heading", { name: "Request conversion" }).count();
      const sw = {};
      for (const id of ["matter-preparation", "contract-preparation", "contract-conversion-analysis"])
        sw[id] = await page.locator(`#${id}`).getAttribute("aria-checked");
      const useSwitch = await page.locator("#ai-enabled").getAttribute("aria-checked");
      const test = await testConnection(page, e, "first test after save");
      const st = safe(await connectorOf(admin));
      await openCard(page, "Answer style");
      const radiosEnabled = await page.getByRole("radio").evaluateAll((els) => els.every((x) => !x.matches(":disabled")));
      e.connector = st;
      must(keyBox === "" && c === "Connected" && pill === "Key in use" && forget === 0 && presetLabel === "OpenRouter (key saved)", `key ${keyBox.length} chip ${c} pill ${pill} forget ${forget} ${presetLabel}`);
      must(conv === 1 && Object.values(sw).every((v) => v === "false") && useSwitch === "true", `conv ${conv} ${q(sw)} use ${useSwitch}`);
      must(test.status === 200 && test.shown === "Connection successful.", `test ${q(test)}`);
      must(st.enabled && st.model === MODEL && st.preset === "openrouter" && radiosEnabled, `state ${q(st)} radios ${radiosEnabled}`);
      return `Save connector answered 200 and showed Saved. The API key box is empty again. The chip reads Connected, Use AI analysis is on, the pill beside API key reads "Key in use" with no Forget key, and the Provider option reads "OpenRouter (key saved)". A Request conversion card appeared with three switches off (${q(sw)}). Test connection answered ${test.status} in ${test.ms} ms and showed "Connection successful.". Stored: preset openrouter, model ${st.model}, key stored, output limit ${st.maxOutputTokens}. The Answer style radios are now enabled.`;
    });

  await step("C", "administrator", "live-provider-check", "/settings/ai-analysis Provider card",
    "Negative: invalid model. Enter model ID manually with a model that does not exist, leave the key blank (Key in use), Save connector, Test connection",
    "The save keeps the Saved key; the test shows 'The connection test failed.' followed by the provider message.",
    async (e) => {
      await reloadProvider(page);
      await page.getByRole("button", { name: "Enter model ID manually" }).click();
      await page.locator("#ai-model").fill(BAD_MODEL);
      const saved = await saveConnector(page);
      const test = await testConnection(page, e, "invalid model");
      const st = safe(await connectorOf(admin));
      must(saved.status === 200 && st.model === BAD_MODEL && st.savedKeys.length === 1, `save ${saved.status} ${q(st)}`);
      must(test.status >= 400 && /^The connection test failed\. /.test(test.shown), `test ${q(test)}`);
      return `With the key box blank beside "Key in use", Save connector answered 200 and kept the Saved key (Saved keys: ${st.savedKeys.length}). Test connection answered ${test.status} in ${test.ms} ms and showed ${q(test.shown)}.`;
    });

  await step("C", "administrator", "live-provider-check", "/settings/ai-analysis Provider card",
    "Rotate: choose the destination, paste a new API key, choose the valid model again, Save connector, test while enabled",
    "Saving replaces only that destination's key; the test passes again.",
    async (e) => {
      await reloadProvider(page);
      const manual = page.getByRole("button", { name: "Choose from list" });
      if (await manual.count()) await manual.click();
      await page.locator("#ai-api-key").fill(KEY);
      await loadModels(page, e, "openrouter rotate");
      await pickModel(page, MODEL);
      const saved = await saveConnector(page);
      const test = await testConnection(page, e, "after rotation");
      const st = safe(await connectorOf(admin));
      must(saved.status === 200 && st.model === MODEL && st.savedKeys.length === 1, `save ${saved.status} ${q(st)}`);
      must(test.status === 200 && test.shown === "Connection successful.", `test ${q(test)}`);
      return `Pasting the key again, choosing ${MODEL} from the list and saving answered 200. There is still one Saved key (OpenRouter, in use). Test connection answered ${test.status} in ${test.ms} ms: "Connection successful.".`;
    });

  await step("C", "administrator", "live-provider-check", "/settings/ai-analysis Provider card",
    "Negative: invalid key. Custom endpoint, OpenAI-compatible, the provider's own base URL, an obviously fake key, manual model; Save connector; Test connection",
    "The Custom destination gets its own Saved key (Key in use); the test shows 'The connection test failed.' with the provider's refusal; the OpenRouter key stays saved.",
    async (e) => {
      await reloadProvider(page);
      await page.locator("#ai-preset").selectOption("custom");
      await page.locator("#ai-protocol").selectOption("openai_chat_completions");
      await page.locator("#ai-base-url").fill(PROVIDER_BASE);
      const pillBefore = await keyPill(page);
      await page.locator("#ai-api-key").fill(FAKE_KEY);
      await page.getByRole("button", { name: "Enter model ID manually" }).click();
      await page.locator("#ai-model").fill(MODEL);
      const saved = await saveConnector(page);
      const pill = await keyPill(page);
      const test = await testConnection(page, e, "custom endpoint, fake key");
      const st = safe(await connectorOf(admin));
      const optionsNow = await options(page, "#ai-preset");
      must(pillBefore === null && saved.status === 200 && pill === "Key in use", `pill ${pillBefore}/${pill} save ${saved.status}`);
      must(test.status >= 400 && /^The connection test failed\. /.test(test.shown), `test ${q(test)}`);
      must(st.preset === "custom" && st.savedKeys.length === 2, `state ${q(st)}`);
      return `Custom endpoint with Base URL ${PROVIDER_BASE} showed no key pill before saving. After Save connector (200) the pill read "Key in use". Test connection answered ${test.status} in ${test.ms} ms and showed ${q(test.shown)}. Saved keys now: ${q(st.savedKeys)}. Provider list: ${q(optionsNow)}.`;
    });

  await step("C", "administrator", "browser-walkthrough", "/settings/ai-analysis Provider card",
    "Switch back: OpenRouter shows (key saved) and Key saved with Forget key; leave the key blank and Save connector; then Forget key on the Custom destination (matched with a trailing slash)",
    "Returning to OpenRouter reuses its Saved key; it becomes Key in use; the Custom destination's key shows Key saved with Forget key; confirming 'Forget the Saved key' deletes only that key.",
    async (e) => {
      await reloadProvider(page);
      await page.locator("#ai-preset").selectOption("openrouter");
      const pillBack = await keyPill(page);
      const forgetBack = await forgetCount(page);
      await loadModels(page, e, "openrouter with Saved key");
      await pickModel(page, MODEL);
      const saved = await saveConnector(page);
      const pillInUse = await keyPill(page);
      await page.locator("#ai-preset").selectOption("custom");
      await page.locator("#ai-protocol").selectOption("openai_chat_completions");
      await page.locator("#ai-base-url").fill(`${PROVIDER_BASE}/`);
      const pillCustom = await keyPill(page);
      const forgetCustom = await forgetCount(page);
      // API refusal for forgetting the in-use key (a state probe, not a guide step)
      const inUseKey = (await connectorOf(admin)).savedKeys.find((k) => k.inUse);
      const refusal = await admin.api("DELETE", `/ai-connector/saved-keys/${inUseKey.id}`);
      await page.getByRole("button", { name: "Forget key", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Forget the Saved key" });
      await dialog.waitFor();
      const body = tidy(await dialog.innerText());
      await dialog.getByRole("button", { name: "Forget key" }).click();
      await dialog.waitFor({ state: "hidden" });
      const pillGone = await keyPill(page);
      const st = safe(await connectorOf(admin));
      await reloadProvider(page);
      const presetAfter = await page.locator("#ai-preset").inputValue();
      must(pillBack === "Key saved" && forgetBack === 1 && saved.status === 200 && pillInUse === "Key in use", `back ${pillBack} ${forgetBack} save ${saved.status} ${pillInUse}`);
      must(pillCustom === "Key saved" && forgetCustom === 1 && pillGone === null, `custom ${pillCustom} ${forgetCustom} gone ${pillGone}`);
      must(refusal.status === 409 && st.savedKeys.length === 1 && st.savedKeys[0].preset === "openrouter" && st.preset === "openrouter" && presetAfter === "openrouter", `refusal ${refusal.status} ${q(st)}`);
      return `Back on OpenRouter the pill read ${q(pillBack)} with ${forgetBack} Forget key. Load models worked with the blank key box, and Save connector (200) made it ${q(pillInUse)}. Choosing Custom endpoint again with Base URL "${PROVIDER_BASE}/" (one trailing slash) matched the Custom Saved key: pill ${q(pillCustom)} with Forget key. The dialog read ${q(body)}; confirming removed the pill. A direct DELETE of the in-use OpenRouter key answered ${refusal.status} ${q(refusal.json?.detail)}. Saved keys now: ${q(st.savedKeys)}. After reload the form shows the saved OpenRouter connector.`;
    });
}

// ================================================================== D: prompts and answer style
if (run("D")) {
}
if (run("P")) {
  await step("P", "administrator", "browser-walkthrough", "/settings/ai-analysis cards",
    "Choose the answer style and edit prompts: each card opens on its own; Answer style saves on choice; conversion prompts list; seven analysis prompts; Contracts > Fields link",
    "Answer style radios save immediately with a save result; conversion card has Title, Description, Priority, Needed by, Counterparty and the {module} hint; the analysis card has seven prompts and a Contracts > Fields link.",
    async () => {
      await page.goto(`${BASE}/settings/ai-analysis`);
      await cardButton(page, "Answer style").waitFor({ timeout: 20000 });
      if ((await connectorOf(admin)).answerStyle !== "sentence") {
        await admin.api("PATCH", "/ai-connector", { answerStyle: "sentence" });
        await page.reload();
        await cardButton(page, "Answer style").waitFor({ timeout: 20000 });
      }
      await openCard(page, "Answer style");
      const otherOpen = await cardButton(page, "Contract analysis prompts").getAttribute("aria-expanded");
      const put = page.waitForResponse((r) => r.url().endsWith("/api/v1/ai-connector") && r.request().method() === "PATCH");
      await page.getByRole("radio", { name: "Few word summary" }).click();
      const res = await put;
      const region = page.getByRole("region", { name: "Answer style" });
      await region.getByText("Saved", { exact: true }).waitFor({ timeout: 10000 });
      const descs = (await region.locator("p[id^='answer-style-']").allInnerTexts()).map((t) => t.trim());
      const st1 = (await connectorOf(admin)).answerStyle;
      const put2 = page.waitForResponse((r) => r.url().endsWith("/api/v1/ai-connector") && r.request().method() === "PATCH");
      await page.getByRole("radio", { name: "1-2 sentence summary" }).click();
      await put2;
      const st2 = (await connectorOf(admin)).answerStyle;
      await openCard(page, "Matter and Contract conversion prompts");
      const conv = page.getByRole("region", { name: "Matter and Contract conversion prompts" });
      const convHint = tidy(await conv.locator("p").first().innerText());
      const convRows = await conv.locator("textarea").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
      await openCard(page, "Contract analysis prompts");
      const ana = page.getByRole("region", { name: "Contract analysis prompts" });
      const anaRows = await ana.locator("textarea").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
      const link = ana.getByRole("link", { name: "Contracts → Fields" });
      const href = await link.getAttribute("href");
      must(otherOpen === "false" && res.status() === 200 && st1 === "few_words" && st2 === "sentence", `open ${otherOpen} patch ${res.status()} ${st1}/${st2}`);
      must(convRows.length === 5 && /\{module\}/.test(convHint) && anaRows.length === 7 && href === "/settings/contracts/fields", `conv ${q(convRows)} ana ${q(anaRows)} ${href}`);
      return `Opening Answer style left Contract analysis prompts closed. Choosing "Few word summary" saved at once (PATCH ${res.status()}, "Saved" shown; stored few_words); choosing "1-2 sentence summary" stored sentence again. Descriptions: ${q(descs)}. Conversion card hint ${q(convHint)}; prompts ${q(convRows)}. Analysis card prompts ${q(anaRows)}; its link "Contracts → Fields" points to ${href}.`;
    });

  await step("P", "administrator", "browser-walkthrough", "/settings/ai-analysis Contract analysis prompts",
    "Edit the notice-period prompt: Enter saves; Shift+Enter adds a line break; Escape restores the saved text; clearing and leaving restores the saved text; 2,000 characters",
    "Enter sends one save and shows Reset to default; Shift+Enter adds a line break without saving; Escape puts back the saved text without saving; a cleared prompt comes back on leaving.",
    async () => {
      await page.goto(`${BASE}/settings/ai-analysis`);
      await cardButton(page, "Contract analysis prompts").waitFor({ timeout: 20000 });
      await openCard(page, "Contract analysis prompts");
      // Fixture reset: a script error in an earlier attempt left this prompt edited.
      const pre = (await admin.api("GET", "/ai-field-prompts")).json.prompts.find((p) => p.slug === NOTICE);
      if (pre.overridden) {
        await admin.api("PUT", "/ai-field-prompts", { slug: NOTICE, prompt: null });
        await page.reload();
        await cardButton(page, "Contract analysis prompts").waitFor({ timeout: 20000 });
        await openCard(page, "Contract analysis prompts");
      }
      const box = page.locator(`#ai-field-prompt-${NOTICE}`);
      const label = await box.getAttribute("aria-label");
      const put = page.waitForResponse((r) => r.url().endsWith("/api/v1/ai-field-prompts") && r.request().method() === "PUT");
      await box.click();
      await box.fill(NOTICE_TEXT);
      await box.press("Enter");
      const res = await put;
      const reset = page.getByRole("button", { name: /^Reset .* to default$/ });
      await reset.first().waitFor({ timeout: 10000 });
      const resetName = await reset.first().getAttribute("aria-label");
      const puts = [];
      const l = (r) => r.method() === "PUT" && r.url().includes("/api/v1/ai-field-prompts") && puts.push(r.postData());
      page.on("request", l);
      await box.click();
      await box.press("End");
      await box.press("Shift+Enter");
      const withBreak = (await box.inputValue()).endsWith("\n");
      await box.type(" DOC-030 abandoned text");
      await box.press("Escape");
      await sleep(1500);
      const afterEscape = await box.inputValue();
      await box.click();
      await box.fill("");
      await box.blur();
      await sleep(1500);
      const afterClear = await box.inputValue();
      page.off("request", l);
      const stored = (await admin.api("GET", "/ai-field-prompts")).json.prompts.find((p) => p.slug === NOTICE);
      const maxlength = await box.getAttribute("maxlength");
      must(res.status() === 200 && stored.overridden && stored.prompt === NOTICE_TEXT, `save ${res.status()} ${q(stored)}`);
      must(withBreak && afterEscape === NOTICE_TEXT && afterClear === NOTICE_TEXT && puts.length === 0, `break ${withBreak} esc ${q(afterEscape)} clear ${q(afterClear)} puts ${puts.length}`);
      must(maxlength === "2000", `maxlength ${maxlength}`);
      return `Input ${q(label)}. Enter sent one save (${res.status()}) and a ${q(resetName)} link appeared. Shift+Enter added a line break without a save. After typing more text, Escape put back the saved text. Clearing the box and leaving it also put back the saved text. Saves sent during Shift+Enter, Escape and the cleared blur: ${puts.length}. maxlength ${maxlength}. The edited prompt stays for the Analysis run.`;
    });

}
if (run("D")) {
  await step("D", "administrator", "browser-walkthrough", "/settings/contracts/fields",
    "Add a catalog Field to Analysis, steps 1-2: follow Contracts > Fields; Add field for Long text and Text with AI prompt and Answer style; User has no AI prompt",
    "The link opens Contracts > Fields. Text and Long text show AI prompt and Answer style with 'Organisation default (1-2 sentence summary)'; Full clause text is disabled for Text; User shows no AI prompt.",
    async () => {
      await page.goto(`${BASE}/settings/ai-analysis`);
      await openCard(page, "Contract analysis prompts");
      await page.getByRole("link", { name: "Contracts → Fields" }).click();
      await page.waitForURL(`${BASE}/settings/contracts/fields`);
      const custom = page.getByRole("region", { name: "Custom Fields" });
      await custom.waitFor({ timeout: 20000 });
      const add = async (name, type, prompt, style) => {
        await custom.getByRole("button", { name: "Add field" }).click();
        const d = page.getByRole("dialog", { name: "Add field" });
        await d.waitFor();
        await d.getByLabel("Name").fill(name);
        await d.getByLabel("Type").selectOption({ label: type });
        const seen = { aiPrompt: await d.locator("#field-ai-prompt").count() };
        const sel = d.locator("#field-answer-style");
        if (await sel.count()) {
          await until(async () => /\(/.test(await sel.locator("option").first().innerText()), "default style not shown", 8000).catch(() => {});
          seen.styleOptions = await sel.locator("option").evaluateAll((els) => els.map((o) => `${o.textContent.trim()}${o.disabled ? " [disabled]" : ""}`));
        }
        if (prompt) await d.locator("#field-ai-prompt").fill(prompt);
        if (style) await sel.selectOption({ label: style });
        await d.getByRole("button", { name: "Add field" }).click();
        await d.waitFor({ state: "hidden", timeout: 15000 });
        log.records.push({ kind: "contract field", name, type, at: new Date().toISOString() });
        return seen;
      };
      const loc = await add(F.location, "Long text", "State where the supplier must store the customer's data and when it must delete that data.", null);
      const sup = await add(F.supplier, "Text", "Name the supplier party.", "Few word summary");
      const un = await add(F.unattached, "Text", "Name the customer party.", null);
      const per = await add(F.person, "User", null, null);
      save();
      must(loc.aiPrompt === 1 && loc.styleOptions?.[0] === "Organisation default (1-2 sentence summary)" && !loc.styleOptions.some((o) => o.includes("[disabled]")), `long ${q(loc)}`);
      must(sup.aiPrompt === 1 && sup.styleOptions?.includes("Full clause text [disabled]"), `text ${q(sup)}`);
      must(per.aiPrompt === 0 && !per.styleOptions, `user ${q(per)}`);
      return `The Contracts → Fields link opened /settings/contracts/fields. Add field: Long text ${q(F.location)} showed AI prompt and Answer style ${q(loc.styleOptions)}; kept Organisation default. Text ${q(F.supplier)} showed ${q(sup.styleOptions)}; chose Few word summary. Text ${q(F.unattached)} with a prompt (left off the Form on purpose). User ${q(F.person)} showed no AI prompt box and no Answer style.`;
    });

  await step("D", "administrator", "browser-walkthrough", "/settings/contracts/types/<Vendor>/form",
    "Add a catalog Field to Analysis, step 3: open the Vendor Type's Form tab, Attach Field, choose the Field so the Form has a Row for it",
    "Attach Field lists the new Fields; choosing one adds its Row.",
    async () => {
      await page.goto(`${BASE}/settings/contracts/types`);
      await page.getByRole("button", { name: "Edit Vendor", exact: true }).click();
      await page.getByRole("navigation", { name: "Type sections" }).getByRole("link", { name: "Form" }).click();
      const form = page.getByRole("region", { name: "Form" });
      await form.waitFor();
      const attached = [];
      for (const name of [F.location, F.supplier]) {
        if (await form.getByRole("group", { name, exact: true }).count()) {
          attached.push(`${name} (already attached)`);
          continue;
        }
        await page.getByRole("button", { name: "Attach Field" }).click();
        const menu = page.getByRole("menu");
        await menu.waitFor();
        await menu.getByRole("textbox", { name: "Search fields" }).fill(name);
        await sleep(300);
        await menu.getByRole("menuitem", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).click();
        await form.getByRole("group", { name, exact: true }).waitFor({ timeout: 15000 });
        attached.push(name);
      }
      const unattached = await form.getByRole("group", { name: F.unattached, exact: true }).count();
      must(unattached === 0, "unattached Field is on the Form");
      return `Vendor > Form: Attach Field with Search fields added Rows for ${q(attached)}. ${q(F.unattached)} has no Row on this Form.`;
    });
}

// ================================================================== T: Reset to default
if (run("T")) {
  await step("T", "administrator", "browser-walkthrough", "/settings/ai-analysis Contract analysis prompts",
    "Reset to default on the overridden notice-period prompt",
    "Reset to default restores that one built-in prompt; the link disappears; no other prompt is overridden.",
    async () => {
      await page.goto(`${BASE}/settings/ai-analysis`);
      await cardButton(page, "Contract analysis prompts").waitFor({ timeout: 20000 });
      await openCard(page, "Contract analysis prompts");
      const before = (await admin.api("GET", "/ai-field-prompts")).json.prompts.filter((p) => p.overridden).map((p) => p.slug);
      const reset = page.getByRole("button", { name: "Reset Notice period (days) to default" });
      const put = page.waitForResponse((r) => r.url().endsWith("/api/v1/ai-field-prompts") && r.request().method() === "PUT");
      await reset.click();
      const res = await put;
      await reset.waitFor({ state: "detached", timeout: 10000 });
      const prompts = (await admin.api("GET", "/ai-field-prompts")).json.prompts;
      const notice = prompts.find((p) => p.slug === NOTICE);
      const shown = await page.locator(`#ai-field-prompt-${NOTICE}`).inputValue();
      const after = prompts.filter((p) => p.overridden).map((p) => p.slug);
      must(q(before) === q([NOTICE]) && res.status() === 200 && !notice.overridden && shown === notice.prompt && after.length === 0, `before ${q(before)} after ${q(after)}`);
      return `Overridden before: ${q(before)}. Reset to default sent one save (${res.status()}); the link disappeared and the box shows the built-in prompt ${q(shown.slice(0, 120))}. Overridden after: ${q(after)}.`;
    });
}

// ================================================================== E: Analysis runs
async function fieldsPage(n) {
  await page.goto(`${BASE}/contracts/${n}/fields`);
  await page.waitForLoadState("networkidle").catch(() => {});
}
async function runOf(n) {
  return (await admin.api("GET", `/contracts/${n}`)).json.analysis?.latestRun ?? null;
}
const runFacts = (r) => ({
  trigger: r.trigger,
  state: r.state,
  preset: r.preset,
  model: r.model,
  versionNumber: r.versionNumber,
  truncated: r.truncated,
  providerMs: r.startedAt && r.finishedAt ? Date.parse(r.finishedAt) - Date.parse(r.startedAt) : null,
  startedAt: r.startedAt,
  finishedAt: r.finishedAt,
  failure: r.failure,
  outcome: r.outcome,
});
async function valueOf(n, name) {
  const d = (await admin.api("GET", `/contracts/${n}`)).json;
  const ref = (d.customFieldRefs ?? []).find?.((f) => f.displayName === name);
  const fields = d.fields ?? d.contract?.customFields ?? {};
  const byId = ref ? fields[ref.slug ?? ref.id] : undefined;
  return { ref: ref ? { slug: ref.slug, id: ref.id } : null, value: byId ?? null };
}
if (run("E")) {
  await step("E", "administrator", "live-provider-check", "/contracts/<n>/fields",
    "Save and test, step 4 and Add a catalog Field, step 4: a fictional Vendor Contract gets its primary Document; wait for the automatic Analysis run; read the values",
    "Without anyone selecting Run analysis, an automatic run reads the primary Document's current Version, calls OpenRouter with the configured model, and writes supported values with Unverified markers; only attached Fields with a prompt are asked for.",
    async (e) => {
      if (!state.contract) {
        const title = `${G} ${stamp}`;
        const r = await admin.api("POST", "/contracts", { title, contractTypeId: typeId("Vendor"), customFields: {}, isConfidential: false, managerId: null });
        must(r.status === 201, `create ${r.status} ${q(r.json)}`);
        state.contract = r.json.contract.number;
        state.contractTitle = title;
        keepState();
        log.records.push({ kind: "contract", name: title, number: `C-${state.contract}`, at: new Date().toISOString() });
      }
      const n = state.contract;
      e.contract = `C-${n}`;
      if (!state.uploadedAt) {
        const buf = readFileSync(path.join(here, "fixtures/doc030-live-analysis.docx"));
        const up = await page.request.post(`${BASE}/api/v1/contracts/${n}/documents`, {
          headers: { origin: BASE },
          multipart: {
            kind: "draft_ours",
            file: { name: "doc030-live-analysis.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: buf },
          },
          failOnStatusCode: false,
        });
        must(up.status() === 201, `upload ${up.status()} ${await up.text()}`);
        state.uploadedAt = Date.now();
        keepState();
        log.records.push({ kind: "primary document", name: "doc030-live-analysis.docx", contract: `C-${n}`, at: new Date().toISOString() });
      }
      await fieldsPage(n);
      const runningSeen = await page.getByRole("button", { name: "Running…" }).isVisible().catch(() => false);
      const r = await until(async () => {
        const x = await runOf(n);
        return x && x.state !== "pending" ? x : null;
      }, "no finished Analysis run within 6 minutes", 360000, 3000);
      e.run = runFacts(r);
      e.run.uploadToFinishMs = Date.now() - state.uploadedAt;
      log.providerCalls.push({ at: new Date().toISOString(), kind: "analysis run", label: "automatic", ...e.run });
      state.run1 = r.id;
      keepState();
      await fieldsPage(n);
      await page.getByRole("button", { name: "Run analysis" }).waitFor({ timeout: 20000 });
      const unverified = await page.getByText("Unverified", { exact: true }).count();
      const sparkles = await page.getByRole("button", { name: /^View AI evidence for / }).evaluateAll((els) => els.map((x) => x.getAttribute("aria-label")));
      const main = tidy(await page.locator("main").innerText());
      const written = r.outcome?.written ?? [];
      const cat = (await admin.api("GET", "/fields")).json.fields;
      const slugOf = (name) => cat.find((f) => f.displayName === name)?.slug ?? null;
      state.slugs = { location: slugOf(F.location), supplier: slugOf(F.supplier), unattached: slugOf(F.unattached) };
      keepState();
      const lists = r.outcome ?? {};
      const where = (slug) => ["written", "kept", "unsupported", "invalid"].filter((k) => (lists[k] ?? []).some((x) => x === slug || x.endsWith(slug)));
      e.customFieldOutcome = Object.fromEntries(Object.entries(state.slugs).map(([k, v]) => [k, { slug: v, in: where(v) }]));
      const unSlug = where(state.slugs.unattached);
      const det = (await admin.api("GET", `/contracts/${n}`)).json;
      e.savedValues = {
        effectiveDate: det.contract.effectiveDate ?? null,
        expiryDate: det.contract.expiryDate ?? null,
        noticePeriodDays: det.contract.noticePeriodDays ?? null,
        termType: det.contract.termType ?? null,
        noticeDeadline: det.contract.noticeDeadline ?? null,
        value: det.contract.value ?? null,
        custom: Object.fromEntries(Object.entries(state.slugs).map(([k, v]) => [k, det.contract.customFields?.[v] ?? null])),
        aiUnverified: Object.keys(det.contract.aiUnverified ?? {}),
      };
      state.run1Values = e.savedValues;
      keepState();
      must(r.state === "ready" && r.trigger === "automatic" && r.preset === "openrouter" && r.model === MODEL, `run ${q(e.run)}`);
      must(unverified > 0 && sparkles.length > 0 && unSlug.length === 0, `unverified ${unverified} sparkles ${sparkles.length} unattached ${q(unSlug)}`);
      return `C-${n} ${q(state.contractTitle)} (Vendor). After the primary Document upload, an ${r.trigger} run finished ${r.state} on Version ${r.versionNumber} with ${r.preset} ${r.model}; provider time ${e.run.providerMs} ms, upload to finish ${e.run.uploadToFinishMs} ms, text truncated ${r.truncated}. Running… seen on first load: ${runningSeen}. Outcome written ${q(written)}, kept ${q(r.outcome?.kept ?? [])}, unsupported ${q(r.outcome?.unsupported ?? [])}, invalid ${q(r.outcome?.invalid ?? [])}. Our Fields in the outcome: ${q(e.customFieldOutcome)}; the unattached Field appears in no list. Fields page: ${unverified} Unverified markers and evidence sparkles ${q(sparkles)}. Saved values read back: ${q(e.savedValues)}. Accuracy is not claimed.`;
    });

  await step("E", "administrator", "browser-walkthrough", "/contracts/<n> Overview, Fields, History",
    "Save and test, step 4: check the run's Version, model, evidence and saved values in the browser",
    "The browser shows which Document Version the run read (evidence), the model, and the saved values with Unverified markers.",
    async (e) => {
      const n = state.contract;
      await page.goto(`${BASE}/contracts/${n}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      const sparkle = page.getByRole("button", { name: /^View AI evidence for Notice period/ }).first();
      const aiCalls = [];
      const l = (r) => /\/api\/v1\/(ai-connector|contracts\/\d+\/analysis$)/.test(r.url()) && r.method() !== "GET" && aiCalls.push(r.url());
      page.on("request", l);
      let panel = "";
      let marks = [];
      if (await sparkle.count()) {
        await sparkle.click();
        await sleep(4000);
        panel = tidy((await page.getByRole("complementary").allInnerTexts().catch(() => [])).join(" ")).slice(0, 300);
        marks = await page.locator("mark").allInnerTexts().catch(() => []);
      }
      page.off("request", l);
      const texts = {};
      for (const where of ["", "/fields", "/documents"]) {
        await page.goto(`${BASE}/contracts/${n}${where}`);
        await page.waitForLoadState("networkidle").catch(() => {});
        texts[where || "/"] = tidy(await page.locator("body").innerText());
      }
      let historyText = "";
      const hist = page.getByRole("button", { name: "History" });
      if (await hist.count()) {
        await hist.first().click();
        await sleep(2500);
        historyText = tidy(await page.getByRole("complementary", { name: "History" }).innerText().catch(() => ""));
      }
      const modelShown = Object.entries({ ...texts, history: historyText }).filter(([, t]) => t.includes(MODEL)).map(([k]) => k);
      const analysisEntry = (historyText.match(/[^.]*completed an AI analysis of this contract[^.]*/) ?? [null])[0];
      e.modelShownOn = modelShown;
      must(marks.length > 0 && aiCalls.length === 0, `evidence marks ${marks.length} aiCalls ${aiCalls.length}`);
      if (modelShown.length === 0) {
        e.failureKind = "doc-error";
        throw new Error(
          `Guide step 4 says "Check the run's Version, model, evidence, and saved values." The evidence sparkle for Notice period opened the doc panel (${q(panel.slice(0, 160))}) with highlighted ${q(marks.slice(0, 2))} and made no AI call, so Version and evidence can be checked. But no page shows the run's model: ${MODEL} appears on none of Overview, Fields, Documents or the History panel. History shows only ${q(analysisEntry)}. The run's model is recorded (API latestRun.model ${MODEL}) but the browser does not display it at this build.`,
        );
      }
      return `Evidence opened ${q(panel.slice(0, 160))} with ${q(marks.slice(0, 2))} and no AI call. Model shown on ${q(modelShown)}.`;
    }, "doc-error");

  await step("E", "administrator", "live-provider-check", "/settings/ai-analysis and /contracts/<n>/fields",
    "Answer style applies to the next run: set the Organization default to Few word summary, check the Field editor default and that written values keep their form, then select Run analysis",
    "The Field editor shows 'Organisation default (Few word summary)'; the written Long text value is unchanged before the rerun; the manual run shows Running…, finishes with the model, and may replace the Unverified value.",
    async (e) => {
      const n = state.contract;
      await page.goto(`${BASE}/settings/ai-analysis`);
      await openCard(page, "Answer style");
      const patch = page.waitForResponse((r) => r.url().endsWith("/api/v1/ai-connector") && r.request().method() === "PATCH");
      await page.getByRole("radio", { name: "Few word summary" }).click();
      await patch;
      await page.goto(`${BASE}/settings/contracts/fields`);
      await page.getByRole("button", { name: `Edit ${F.location}`, exact: true }).click();
      const d = page.getByRole("dialog");
      await d.waitFor();
      const sel = d.locator("#field-answer-style");
      await until(async () => /\(/.test(await sel.locator("option").first().innerText()), "default not loaded", 8000).catch(() => {});
      const def = (await sel.locator("option").first().innerText()).trim();
      await d.getByRole("button", { name: "Cancel" }).click();
      const before = (await admin.api("GET", `/contracts/${n}`)).json;
      const pick = (c) => JSON.stringify(Object.fromEntries(Object.entries(state.slugs ?? {}).map(([k, v]) => [k, c.customFields?.[v] ?? null])));
      const beforeCustom = pick(before.contract);
      const run1Custom = JSON.stringify(state.run1Values?.custom ?? {});
      await fieldsPage(n);
      const prior = (await runOf(n)).id;
      const btn = page.getByRole("button", { name: "Run analysis" });
      await btn.first().click();
      let running = false;
      try {
        await page.getByRole("button", { name: "Running…" }).first().waitFor({ timeout: 8000 });
        running = true;
      } catch {}
      const r = await until(async () => {
        const x = await runOf(n);
        return x && x.id !== prior && x.state !== "pending" ? x : null;
      }, "manual run did not finish in 6 minutes", 360000, 3000);
      e.run = runFacts(r);
      log.providerCalls.push({ at: new Date().toISOString(), kind: "analysis run", label: "manual after Answer style change", ...e.run });
      const after = (await admin.api("GET", `/contracts/${n}`)).json;
      const afterCustom = pick(after.contract);
      e.customBefore = beforeCustom;
      e.customAfter = afterCustom;
      await fieldsPage(n);
      const unverified = await page.getByText("Unverified", { exact: true }).count();
      // Put the Organization default back.
      await page.goto(`${BASE}/settings/ai-analysis`);
      await openCard(page, "Answer style");
      const p2 = page.waitForResponse((x) => x.url().endsWith("/api/v1/ai-connector") && x.request().method() === "PATCH");
      await page.getByRole("radio", { name: "1-2 sentence summary" }).click();
      await p2;
      must(def === "Organisation default (Few word summary)" && beforeCustom === run1Custom, `editor default ${def}; before ${beforeCustom} run1 ${run1Custom}`);
      must(r.state === "ready" && r.trigger === "manual" && r.model === MODEL && running, `run ${q(e.run)} running ${running}`);
      return `After choosing Few word summary, the Field editor for ${q(F.location)} offered ${q(def)}. Before the rerun the written custom values were ${beforeCustom === run1Custom ? "unchanged" : "changed"} since the first run: ${beforeCustom}. Run analysis showed Running… (${running}); the manual run finished ${r.state} on Version ${r.versionNumber} with ${r.preset} ${r.model} in ${e.run.providerMs} ms at the provider. Outcome written ${q(r.outcome?.written ?? [])}, kept ${q(r.outcome?.kept ?? [])}, unsupported ${q(r.outcome?.unsupported ?? [])}, invalid ${q(r.outcome?.invalid ?? [])}. Custom values after: ${afterCustom.slice(0, 600)}. Unverified markers on Fields: ${unverified}. The Organization default was put back to 1-2 sentence summary. Accuracy is not claimed.`;
    });
}

// ================================================================== F: disable
if (run("F")) {
  await step("F", "administrator", "browser-walkthrough", "/settings/ai-analysis and /contracts/<n>/fields",
    "Disable: turn off Use AI analysis; Test connection and the three switches become unavailable; saving a disabled connector keeps it disabled; the Contract keeps its Unverified values and offers no Run analysis",
    "Chip Turned off; Test connection and switches disabled; Save connector leaves it off; Run analysis absent; Unverified values stay; a run request is refused with 'No enabled AI connector is configured.'",
    async () => {
      const n = state.contract;
      await page.goto(`${BASE}/settings/ai-analysis`);
      await openProvider(page);
      const off = page.waitForResponse((r) => r.url().endsWith("/api/v1/ai-connector/disable"));
      await page.locator("#ai-enabled").click();
      const res = await off;
      await until(async () => (await chip(page)) === "Turned off", "chip not Turned off");
      const hint = tidy(await page.locator("#ai-enabled-hint").textContent());
      const testDisabled = await page.getByRole("button", { name: "Test connection" }).isDisabled();
      const sws = [];
      for (const id of ["matter-preparation", "contract-preparation", "contract-conversion-analysis"]) sws.push(await page.locator(`#${id}`).isDisabled());
      const saved = await saveConnector(page);
      const stillOff = safe(await connectorOf(admin));
      await openCard(page, "Answer style");
      const styleUsable = await page.getByRole("radio").evaluateAll((els) => els.every((x) => !x.matches(":disabled")));
      const pill = await keyPill(page);
      await fieldsPage(n);
      const runBtn = await page.getByRole("button", { name: /^(Run analysis|Running…)$/ }).count();
      const unverified = await page.getByText("Unverified", { exact: true }).count();
      const refusal = await admin.api("POST", `/contracts/${n}/analysis`);
      must(res.status() === 200 && testDisabled && sws.every(Boolean), `disable ${res.status()} test ${testDisabled} ${sws}`);
      must(saved.status === 200 && !stillOff.enabled && stillOff.hasApiKey && pill === "Key in use", `save ${saved.status} ${q(stillOff)} pill ${pill}`);
      must(runBtn === 0 && unverified > 0 && refusal.status === 409 && refusal.json?.detail === "No enabled AI connector is configured.", `run ${runBtn} unverified ${unverified} refusal ${refusal.status} ${q(refusal.json?.detail)}`);
      return `The switch sent POST /ai-connector/disable (${res.status()}). The chip reads Turned off; the hint reads ${q(hint)}. Test connection disabled ${testDisabled}; Request conversion switches disabled ${q(sws)}. Save connector while off answered ${saved.status} and the connector stayed off with its key (pill ${q(pill)}). The Answer style radios stayed usable (${styleUsable}), which confirms the author's limitation. On C-${n}: Run analysis controls ${runBtn}, Unverified markers still ${unverified}. POST /contracts/${n}/analysis answered ${refusal.status} ${q(refusal.json?.detail)}.`;
    });

  await step("F", "administrator", "browser-walkthrough", "/settings/ai-analysis (Legal Team Member)",
    "If it fails, Settings is unavailable: a Legal Team Member cannot open or change this configuration",
    "Nadia Haddad has no AI analysis link and /settings/ai-analysis sends her to /settings/profile; the connector API answers 403.",
    async () => {
      const nadia = await signIn(PEOPLE.nadia);
      await nadia.page.goto(`${BASE}/settings/profile`);
      await nadia.page.waitForLoadState("networkidle").catch(() => {});
      const org = await nadia.page.getByRole("navigation", { name: "Settings sections" }).getByRole("group", { name: "Organization" }).count();
      const link = await nadia.page.getByRole("link", { name: "AI analysis", exact: true }).count();
      await nadia.page.goto(`${BASE}/settings/ai-analysis`);
      await nadia.page.waitForURL(`${BASE}/settings/profile`, { timeout: 20000 });
      const r = await nadia.api("GET", "/ai-connector");
      await nadia.ctx.close();
      must(link === 0 && r.status === 403, `link ${link} api ${r.status}`);
      return `Nadia Haddad (Legal Team Member): Organization group shown ${org}, AI analysis links ${link}; /settings/ai-analysis sent her to /settings/profile; GET /ai-connector answered ${r.status}.`;
    });
}

// ================================================================== O: operator
if (run("O")) {
  await step("O", "operator", "live-provider-check", `docker compose -p ${PROJECT}`,
    "Before you start: the operator allows both the app and its worker to reach the provider; credentials are runtime Settings encrypted with the shared key",
    "App and worker share one non-empty OPENLAW_SECRET_KEY; no provider credential or proxy is an environment variable; the app reached OpenRouter (test, listing) and the worker ran the Analysis runs; logs hold no key.",
    async () => {
      const appEnv = envNames("app");
      const workerEnv = envNames("worker");
      const same = envHash("app", "OPENLAW_SECRET_KEY") !== null && envHash("app", "OPENLAW_SECRET_KEY") === envHash("worker", "OPENLAW_SECRET_KEY");
      const providerVars = [...appEnv, ...workerEnv].filter((n) => /OPENROUTER|^AI_|ANTHROPIC|OPENAI|GROQ|GEMINI/i.test(n));
      const proxy = [...appEnv, ...workerEnv].filter((n) => /proxy/i.test(n));
      const workerLog = logsOf("worker");
      const appLog = logsOf("app");
      const finished = workerLog.split("\n").filter((l) => /contract analysis finished/i.test(l));
      const finishedTimes = finished.map((l) => (l.match(/"time":"([^"]+)"/) ?? [])[1] ?? null);
      const keyHits = [appLog, workerLog].map((s) => s.split(KEY).length - 1);
      const prefixHits = [appLog, workerLog].map((s) => s.split(KEY_PREFIX).length - 1);
      const runs = psql("select trigger||':'||state||':'||model from contract_analysis_runs order by id");
      must(same && providerVars.length === 0 && finished.length >= 2 && keyHits.every((h) => h === 0) && prefixHits.every((h) => h === 0), `same ${same} vars ${providerVars} finished ${finished.length} key ${keyHits} prefix ${prefixHits}`);
      return `App env names ${appEnv.length}, worker ${workerEnv.length}. OPENLAW_SECRET_KEY is set and equal in both (compared by hash inside the script; no value or hash recorded). Provider-credential variables: ${q(providerVars)}; proxy variables: ${q(proxy)}. The app answered the connection tests and model listings, so it reached openrouter.ai. The worker log has ${finished.length} "contract analysis finished" lines (${q(finishedTimes)}), and the lab database holds these runs: ${q(runs.split("\n"))}. The key string and the OpenRouter key prefix occur 0 times in the app log (${appLog.split("\n").length} lines) and the worker log (${workerLog.split("\n").length} lines).`;
    });

  await step("O", "operator", "live-provider-check", `docker compose -p ${PROJECT} restart app worker; /settings/ai-analysis`,
    "Output token limit persists across restarts: save 30,720 (warning shown), restart app and worker, re-read the pane, turn the connector on and test",
    "After the restart the pane shows 30,720 and the Saved key still decrypts: Test connection passes; then 32,768 is restored.",
    async (e) => {
      await page.goto(`${BASE}/settings/ai-analysis`);
      await openProvider(page);
      await page.getByRole("spinbutton", { name: "Exact output token limit" }).fill("30720");
      const warn = tidy(await page.locator("#ai-output-tokens-warning").innerText());
      const saved = await saveConnector(page);
      must(saved.status === 200, `save ${saved.status}`);
      const t0 = Date.now();
      dc("restart", "app", "worker");
      await until(async () => {
        const r = await fetch(`${BASE}/api/v1/ai-connector`).catch(() => null);
        return r !== null && r.status < 500;
      }, "app not back after restart", 180000, 2000);
      const restartMs = Date.now() - t0;
      await page.goto(`${BASE}/settings/ai-analysis`);
      await openProvider(page);
      const exact = await page.getByRole("spinbutton", { name: "Exact output token limit" }).inputValue();
      const c1 = await chip(page);
      const on = page.waitForResponse((r) => r.url().endsWith("/api/v1/ai-connector/enable"));
      await page.locator("#ai-enabled").click();
      await on;
      await until(async () => page.getByRole("button", { name: "Test connection" }).isEnabled(), "test stays disabled", 10000);
      const test = await testConnection(page, e, "after app and worker restart");
      await page.getByRole("spinbutton", { name: "Exact output token limit" }).fill("32768");
      const saved2 = await saveConnector(page);
      const st = safe(await connectorOf(admin));
      must(/^Below 32,768 tokens/.test(warn) && exact === "30720" && c1 === "Turned off", `warn ${warn} exact ${exact} chip ${c1}`);
      must(test.status === 200 && test.shown === "Connection successful." && saved2.status === 200 && st.maxOutputTokens === 32768 && st.enabled, `test ${q(test)} ${q(st)}`);
      return `Saving 30,720 showed the below-32,768 warning. docker compose restart of app and worker took ${restartMs} ms to answer again. The pane then showed 30720 and chip ${q(c1)} (still off, as left). Turning Use AI analysis on and selecting Test connection answered ${test.status} in ${test.ms} ms: "Connection successful.", so the Saved key decrypts after the restart. 32,768 was saved back; the connector is enabled.`;
    });

  await step("O", "operator", "browser-walkthrough", "/documentation/configure-analysis (signed out)",
    "Operator guidance: signed out, open the formal reader for this guide and follow its deployment configuration link to the outbound access and encryption key sections",
    "The link opens deployment-configuration with outbound provider traffic from both the app and worker and 'Preserve and rotate encryption keys'.",
    async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const p = await ctx.newPage();
      await p.goto(`${BASE}/documentation/configure-analysis`);
      const link = p.getByRole("link", { name: "deployment configuration" }).first();
      await link.waitFor({ timeout: 20000 });
      await link.click();
      await p.waitForURL(/deployment-configuration/, { timeout: 20000 });
      const heading = p.getByRole("heading", { name: "Preserve and rotate encryption keys" });
      await heading.waitFor({ timeout: 20000 });
      const body = await p.locator("main").innerText();
      const outbound = /outbound provider traffic from both the app and worker/i.test(body);
      const key = /OPENLAW_SECRET_KEY/.test(body) && /AI/.test(body);
      const url = new URL(p.url()).pathname;
      await ctx.close();
      must(outbound && key, `outbound ${outbound} key ${key}`);
      return `Signed out, /documentation/configure-analysis linked "deployment configuration" to ${url}. That page says to allow outbound provider traffic from both the app and worker and has "Preserve and rotate encryption keys", which names OPENLAW_SECRET_KEY. The reader serves the committed article bytes of 067c1646, so this proves the operator link and target, not the reviewed wording.`;
    });
}

// ================================================================== R: remove, reconnect, forget
if (run("R")) {
  await step("R", "administrator", "browser-walkthrough", "/settings/ai-analysis",
    "Remove connector: turn one Request conversion switch on and choose Full clause text first; Remove connector and confirm",
    "The dialog says Saved keys stay on file; after removal the chip reads Not connected, the Request conversion card is gone, Answer style is back to 1-2 sentence summary and disabled, and OpenRouter still shows (key saved); the Contract keeps its Unverified values.",
    async () => {
      const n = state.contract;
      await page.goto(`${BASE}/settings/ai-analysis`);
      await openProvider(page);
      const sw = page.waitForResponse((r) => r.url().endsWith("/api/v1/ai-connector/workflows"));
      await page.locator("#matter-preparation").click();
      await sw;
      await openCard(page, "Answer style");
      const p1 = page.waitForResponse((r) => r.url().endsWith("/api/v1/ai-connector") && r.request().method() === "PATCH");
      await page.getByRole("radio", { name: "Full clause text" }).click();
      await p1;
      const before = safe(await connectorOf(admin));
      await page.getByRole("button", { name: "Remove connector" }).click();
      const d = page.getByRole("dialog", { name: "Remove the AI connector" });
      await d.waitFor();
      const body = tidy(await d.innerText());
      const del = page.waitForResponse((r) => r.url().endsWith("/api/v1/ai-connector") && r.request().method() === "DELETE");
      await d.getByRole("button", { name: "Remove connector" }).click();
      const res = await del;
      await d.waitFor({ state: "hidden" });
      await until(async () => (await chip(page)) === "Not connected", "chip not Not connected");
      const conv = await page.getByRole("heading", { name: "Request conversion" }).count();
      const checked = await page.locator("input[name='answer-style']:checked").getAttribute("value");
      const disabled = await page.getByRole("radio").evaluateAll((els) => els.every((x) => x.matches(":disabled")));
      const connect = await page.getByText("Connect an AI provider to choose an answer style.", { exact: true }).count();
      const opts = await options(page, "#ai-preset");
      const after = safe(await connectorOf(admin));
      await fieldsPage(n);
      const unverified = await page.getByText("Unverified", { exact: true }).count();
      must(before.switches[0] === true && before.answerStyle === "full_clause", `before ${q(before)}`);
      must(res.status() === 200 && conv === 0 && checked === "sentence" && disabled && connect === 1, `res ${res.status()} conv ${conv} checked ${checked} disabled ${disabled}`);
      must(opts.includes("OpenRouter (key saved)") && after.savedKeys.length === 1 && !after.configured && unverified > 0, `opts ${q(opts)} ${q(after)} unverified ${unverified}`);
      return `Before removal: Prepare Matter conversions with AI on, Answer style Full clause text. The dialog read ${q(body)}. Confirming answered ${res.status()}. The chip reads Not connected, the Request conversion card is gone, Answer style shows "1-2 sentence summary" checked and disabled with the connect sentence. The Provider list still shows "OpenRouter (key saved)"; Saved keys ${q(after.savedKeys)}. C-${n} still shows ${unverified} Unverified markers.`;
    });

  await step("R", "administrator", "browser-walkthrough", "/settings/ai-analysis",
    "Reconnect with the Saved key, check the switches start off; then Remove connector again and Forget key for OpenRouter",
    "Choosing OpenRouter shows Key saved; saving with a blank key reconnects (Key in use); the three switches are off; after a second removal Forget key deletes the OpenRouter key and the suffix disappears.",
    async (e) => {
      await reloadProvider(page);
      await page.locator("#ai-preset").selectOption("openrouter");
      const pill = await keyPill(page);
      await page.getByRole("button", { name: "Enter model ID manually" }).click();
      await page.locator("#ai-model").fill(MODEL);
      const saved = await saveConnector(page);
      const pill2 = await keyPill(page);
      const sws = [];
      for (const id of ["matter-preparation", "contract-preparation", "contract-conversion-analysis"]) sws.push(await page.locator(`#${id}`).getAttribute("aria-checked"));
      const style = (await connectorOf(admin)).answerStyle;
      await page.getByRole("button", { name: "Remove connector" }).click();
      const d = page.getByRole("dialog", { name: "Remove the AI connector" });
      await d.getByRole("button", { name: "Remove connector" }).click();
      await d.waitFor({ state: "hidden" });
      await reloadProvider(page);
      await page.locator("#ai-preset").selectOption("openrouter");
      await page.getByRole("button", { name: "Forget key", exact: true }).click();
      const fd = page.getByRole("dialog", { name: "Forget the Saved key" });
      await fd.getByRole("button", { name: "Forget key" }).click();
      await fd.waitFor({ state: "hidden" });
      await until(async () => (await keyPill(page)) === null, "pill still shown");
      const opts = await options(page, "#ai-preset");
      const st = safe(await connectorOf(admin));
      log.finalConnector = st;
      must(pill === "Key saved" && saved.status === 200 && pill2 === "Key in use" && sws.every((v) => v === "false") && style === "sentence", `pill ${pill}/${pill2} save ${saved.status} ${q(sws)} ${style}`);
      must(!st.configured && st.savedKeys.length === 0 && opts.includes("OpenRouter"), `final ${q(st)} ${q(opts)}`);
      return `OpenRouter showed ${q(pill)}. Saving with a blank key and model ${MODEL} answered ${saved.status}; the pill read ${q(pill2)}; the Request conversion switches were ${q(sws)} and Answer style ${style}. After a second Remove connector, Forget key on OpenRouter removed the pill and the Provider list reads ${q(opts)}. Final state: not configured, no Saved keys.`;
    });
}

// ================================================================== V: re-walk of the corrected step 4 (guide db82673e)
// The batch owner corrected "Save and test" step 4 after E02. This section runs on a
// freshly recreated live2 lab: connect OpenRouter, one automatic Analysis run, the new
// step 4 checks, then remove the connector and forget the key.
if (run("V")) {
  await step("V", "administrator", "live-provider-check", "/settings/ai-analysis Provider card",
    "Re-walk setup, Save and test steps 1-3 on the recreated lab: OpenRouter, paste API key, Load models, choose Model, Save connector, Test connection",
    "Connected, Key in use, 'Connection successful.'",
    async (e) => {
      const before = safe(await connectorOf(admin));
      must(!before.configured && before.savedKeys.length === 0, `start ${q(before)}`);
      await reloadProvider(page);
      await page.locator("#ai-preset").selectOption("openrouter");
      await page.locator("#ai-api-key").fill(KEY);
      await loadModels(page, e, "re-walk: openrouter before save");
      await pickModel(page, MODEL);
      const saved = await saveConnector(page);
      must(saved.status === 200, `save ${saved.status}`);
      const c = await chip(page);
      const pill = await keyPill(page);
      const test = await testConnection(page, e, "re-walk: test after save");
      const st = safe(await connectorOf(admin));
      state.connectorModel = st.model;
      keepState();
      must(c === "Connected" && pill === "Key in use" && test.status === 200 && test.shown === "Connection successful." && st.model === MODEL, `chip ${c} pill ${pill} test ${q(test)} ${q(st)}`);
      return `On the recreated lab (seed ${lab.seed.completedAt}), OpenRouter with a pasted key listed ${e.providerCalls[0].models} models. Choosing ${MODEL} and Save connector (200) gave chip Connected and pill "Key in use". Test connection answered ${test.status} in ${test.ms} ms: "Connection successful.". Saved Model: ${st.model}.`;
    });

  await step("V", "administrator", "live-provider-check", "/contracts/<n>/fields",
    "Save and test, step 4 (run 3 of 5): a fictional Vendor Contract gets the one-page paper as its primary Document; wait for the automatic Analysis run",
    "An automatic run finishes ready on Version 1 with the connector's model and writes supported values with Unverified markers.",
    async (e) => {
      if (!state.contract) {
        const title = `${G} re-walk ${stamp}`;
        const r = await admin.api("POST", "/contracts", { title, contractTypeId: typeId("Vendor"), customFields: {}, isConfidential: false, managerId: null });
        must(r.status === 201, `create ${r.status} ${q(r.json)}`);
        state.contract = r.json.contract.number;
        state.contractTitle = title;
        keepState();
        log.records.push({ kind: "contract", name: title, number: `C-${state.contract}`, lab: "live2 (recreated)", at: new Date().toISOString() });
      }
      const n = state.contract;
      if (!state.uploadedAt) {
        const buf = readFileSync(path.join(here, "fixtures/doc030-live-analysis.docx"));
        const up = await page.request.post(`${BASE}/api/v1/contracts/${n}/documents`, {
          headers: { origin: BASE },
          multipart: {
            kind: "draft_ours",
            file: { name: "doc030-live-analysis.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: buf },
          },
          failOnStatusCode: false,
        });
        must(up.status() === 201, `upload ${up.status()} ${await up.text()}`);
        state.uploadedAt = Date.now();
        keepState();
        log.records.push({ kind: "primary document", name: "doc030-live-analysis.docx", contract: `C-${n}`, lab: "live2 (recreated)", at: new Date().toISOString() });
      }
      const r = await until(async () => {
        const x = await runOf(n);
        return x && x.state !== "pending" ? x : null;
      }, "no finished Analysis run within 6 minutes", 360000, 3000);
      e.run = runFacts(r);
      e.run.uploadToFinishMs = Date.now() - state.uploadedAt;
      log.providerCalls.push({ at: new Date().toISOString(), kind: "analysis run", label: "re-walk automatic (run 3 of 5)", ...e.run });
      const det = (await admin.api("GET", `/contracts/${n}`)).json.contract;
      e.savedValues = {
        effectiveDate: det.effectiveDate ?? null,
        expiryDate: det.expiryDate ?? null,
        noticePeriodDays: det.noticePeriodDays ?? null,
        termType: det.termType ?? null,
        noticeDeadline: det.noticeDeadline ?? null,
        value: det.value ?? null,
        aiUnverified: Object.keys(det.aiUnverified ?? {}),
      };
      state.run3 = { model: r.model, versionNumber: r.versionNumber };
      keepState();
      must(r.state === "ready" && r.trigger === "automatic" && r.preset === "openrouter", `run ${q(e.run)}`);
      return `C-${n} ${q(state.contractTitle)} (Vendor). After the upload an ${r.trigger} run finished ${r.state} on Version ${r.versionNumber} with ${r.preset} ${r.model}; provider time ${e.run.providerMs} ms, upload to finish ${e.run.uploadToFinishMs} ms, truncated ${r.truncated}. Outcome written ${q(r.outcome?.written ?? [])}, kept ${q(r.outcome?.kept ?? [])}, unsupported ${q(r.outcome?.unsupported ?? [])}, invalid ${q(r.outcome?.invalid ?? [])}. Saved values: ${q(e.savedValues)}. Accuracy is not claimed.`;
    });

  await step("V", "administrator", "browser-walkthrough", "/contracts/<n> Overview, Fields, Documents, History",
    "Corrected step 4: check the run's Version, evidence and saved values; the Contract record does not name the model; the run used the Model saved on the connector",
    "The evidence sparkle opens the cited Document Version with the quote highlighted and no AI call; saved values carry Unverified markers; no page names the model; latestRun.model equals the connector's saved Model.",
    async () => {
      const n = state.contract;
      await page.goto(`${BASE}/contracts/${n}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      const overview = await page.getByText("Unverified", { exact: true }).count();
      const sparkles = await page.getByRole("button", { name: /^View AI evidence for / }).evaluateAll((els) => els.map((x) => x.getAttribute("aria-label")));
      const notice = page.getByRole("button", { name: /^View AI evidence for Notice period/ }).first();
      must(await notice.count(), `no Notice period sparkle; sparkles ${q(sparkles)}`);
      const aiCalls = [];
      const l = (r) => /\/api\/v1\/(ai-connector|contracts\/\d+\/analysis$)/.test(r.url()) && r.method() !== "GET" && aiCalls.push(r.url());
      page.on("request", l);
      await notice.click();
      await sleep(4000);
      page.off("request", l);
      const panel = tidy((await page.getByRole("complementary").allInnerTexts().catch(() => [])).join(" "));
      const versionLabel = (panel.match(/doc030-live-analysis\.docx v\d+/) ?? [null])[0];
      const marks = (await page.locator("mark").allInnerTexts().catch(() => [])).map(tidy);
      const noticeRow = tidy(await page.getByText(/Notice period/).first().locator("xpath=ancestor::*[self::div or self::li][1]").innerText().catch(() => ""));
      const texts = {};
      for (const where of ["", "/fields", "/documents", "/key-dates"]) {
        await page.goto(`${BASE}/contracts/${n}${where}`);
        await page.waitForLoadState("networkidle").catch(() => {});
        texts[where || "/"] = tidy(await page.locator("body").innerText());
      }
      const fieldsUnverified = (texts["/fields"].match(/Unverified/g) ?? []).length;
      let historyText = "";
      const hist = page.getByRole("button", { name: "History" });
      if (await hist.count()) {
        await hist.first().click();
        await sleep(2500);
        historyText = tidy(await page.getByRole("complementary", { name: "History" }).innerText().catch(() => ""));
      }
      const all = { ...texts, history: historyText };
      const modelNamed = Object.entries(all).filter(([, t]) => t.includes(MODEL) || t.includes("gpt-oss")).map(([k]) => k);
      const runModel = (await runOf(n)).model;
      const connectorModel = (await connectorOf(admin)).model;
      const det = (await admin.api("GET", `/contracts/${n}`)).json.contract;
      must(versionLabel && marks.length > 0 && aiCalls.length === 0, `version ${versionLabel} marks ${marks.length} aiCalls ${aiCalls.length}`);
      must(overview > 0 && Object.keys(det.aiUnverified ?? {}).length > 0, `unverified ${overview}`);
      must(modelNamed.length === 0, `model named on ${q(modelNamed)}`);
      must(runModel === connectorModel && runModel === MODEL, `run ${runModel} connector ${connectorModel}`);
      return `Version and evidence: the Notice period sparkle opened the doc panel on ${q(versionLabel)} with ${q(marks.slice(0, 2))} highlighted and made no AI call (${aiCalls.length}). Evidence sparkles on Overview: ${q(sparkles)}. Saved values: Overview shows ${overview} Unverified markers, Fields ${fieldsUnverified}; the notice row reads ${q(noticeRow.slice(0, 120))}; stored notice period ${det.noticePeriodDays}, effective ${det.effectiveDate}, expiry ${det.expiryDate}. No page names the model: ${MODEL} and "gpt-oss" appear on none of Overview, Fields, Documents, Key dates or History (History reads ${q((historyText.match(/[^.]*completed an AI analysis of this contract/) ?? [""])[0])}). The API records latestRun.model ${runModel}, equal to the connector's saved Model ${connectorModel}.`;
    });

  await step("V", "administrator", "browser-walkthrough", "/settings/ai-analysis",
    "Clean-up through the guide: Remove connector and confirm; then Forget key for OpenRouter",
    "Chip Not connected; Forget key deletes the Saved key; no Saved keys remain.",
    async () => {
      await reloadProvider(page);
      await page.getByRole("button", { name: "Remove connector" }).click();
      const d = page.getByRole("dialog", { name: "Remove the AI connector" });
      await d.getByRole("button", { name: "Remove connector" }).click();
      await d.waitFor({ state: "hidden" });
      await until(async () => (await chip(page)) === "Not connected", "chip not Not connected");
      await reloadProvider(page);
      await page.locator("#ai-preset").selectOption("openrouter");
      const pill = await keyPill(page);
      await page.getByRole("button", { name: "Forget key", exact: true }).click();
      const fd = page.getByRole("dialog", { name: "Forget the Saved key" });
      await fd.getByRole("button", { name: "Forget key" }).click();
      await fd.waitFor({ state: "hidden" });
      await until(async () => (await keyPill(page)) === null, "pill still shown");
      const st = safe(await connectorOf(admin));
      log.finalConnector = st;
      must(pill === "Key saved" && !st.configured && st.savedKeys.length === 0, `pill ${pill} ${q(st)}`);
      return `Remove connector and confirm gave chip Not connected. OpenRouter then showed "Key saved"; Forget key and confirm removed it. Final state: not configured, no Saved keys.`;
    });
}

log.runs.at(-1).finishedAt = new Date().toISOString();
save();
await browser.close();
const fails = log.steps.filter((s) => s.result !== "pass");
console.log(`${log.steps.length} steps, ${fails.length} not passed`);
