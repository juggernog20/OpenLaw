// DOC-029 round 2 independent walkthrough of configure-analysis (C43) on the admin2 lab
// (app commit 57e77e386be31b2a319f7143dd54d00123e65efe). This agent did not write the article.
//
// The round 2 labs have no live provider credentials. So this script runs only the
// credential-free parts of V-C43: the Settings page, the connector form, refusals,
// Load models and Test connection against a closed loopback endpoint, the Use AI analysis
// switch, Field prompts, the catalog Field route, the Legal Team Member refusal, the
// operator documentation link, and operator container checks. It cannot pass the
// live-provider-check method. Adapted from round 1 credential-free-checks.mjs and
// walkthrough/operator-browser.mjs.
//
// Run from the worktree root:
//   LAB_PASSWORD=... mise exec -- node docs/documentation/batches/DOC-029/live-provider/walkthrough-r2-1.mjs
// The password comes only from the environment. The log never contains it.
// Every provider value is fictional. The AI endpoint is a closed loopback port inside the
// app container, so no request leaves the lab.
// The lab is shared, so the script keeps the connector enabled for the shortest time,
// restores every prompt it changes, and removes the connector at the end.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const require = createRequire(path.join(root, "e2e/package.json"));
const { chromium } = require("@playwright/test");

const BASE = process.env.LAB_APP_URL ?? "http://127.0.0.1:23300";
const PROJECT = process.env.LAB_PROJECT ?? "openlaw-docs-41255c61-admin2";
const PASSWORD = process.env.LAB_PASSWORD;
if (!PASSWORD) throw new Error("LAB_PASSWORD is required");
const ADMIN = { email: "daniel.okafor@helix.example", name: "Daniel Okafor" };
const MEMBER = { email: "nadia.haddad@helix.example", name: "Nadia Haddad" };
const OUT = path.join(here, "walkthrough-r2-1.json");

const FICTION = {
  aiKey: "fictional-doc029r2-key",
  closedEndpoint: "http://127.0.0.1:9/v1",
  model: "fictional-doc029r2-model",
};

const log = {
  phase: "live-provider round 2, walkthrough round 1 (credential-free)",
  reviewer: "DOC-029r2 independent walkthrough agent (live-provider, round 1)",
  reviewerKind: "agent",
  article: "configure-analysis",
  app: BASE,
  lab: PROJECT,
  appCommit: "57e77e386be31b2a319f7143dd54d00123e65efe",
  note: "Sanitized. Fictional provider values only. No password, cookie, key value or hash is recorded.",
  startedAt: new Date().toISOString(),
  steps: [],
  finishedAt: null,
};
const save = () => {
  log.finishedAt = new Date().toISOString();
  writeFileSync(OUT, `${JSON.stringify(log, null, 2)}\n`);
};
async function step(id, role, method, action, fn) {
  const entry = { id, role, method, action, at: null, actual: null, result: "not-run" };
  log.steps.push(entry);
  try {
    entry.actual = await fn();
    entry.result = "pass";
  } catch (error) {
    entry.actual = `Check did not complete: ${String(error?.message ?? error)
      .split("\n")
      .slice(0, 3)
      .join(" ")}`;
    entry.result = "fail";
  }
  entry.at = new Date().toISOString();
  console.log(`${entry.result.toUpperCase()} ${id} ${action}`);
  save();
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function signIn(page, who) {
  await page.goto(`${BASE}/auth/login`);
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 20000 });
  await page
    .getByRole("banner")
    .getByRole("button", { name: who.name })
    .waitFor({ timeout: 20000 });
}
function writeCounter(page, pattern) {
  const seen = [];
  page.on("request", (request) => {
    if (
      ["PUT", "POST", "DELETE", "PATCH"].includes(request.method()) &&
      pattern.test(request.url())
    )
      seen.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  return seen;
}
const invalidFields = (page, ids) =>
  page.evaluate(
    (list) => list.filter((id) => document.getElementById(id)?.validity.valueMissing),
    ids,
  );

function docker(args) {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

const browser = await chromium.launch();
let adminContext;
try {
  adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await adminContext.newPage();
  await signIn(page, ADMIN);
  const api = adminContext.request;
  {
    const ai = await (await api.get(`${BASE}/api/v1/ai-connector`)).json();
    if (ai.connector.configured)
      throw new Error(
        "An AI connector already exists in this lab. These checks need the unconfigured state.",
      );
  }
  const aiWrites = writeCounter(page, /\/api\/v1\/ai-connector/);

  await step(
    "A01",
    "administrator",
    "browser-walkthrough",
    "Open Settings > Organization > AI analysis; check the page before a connector is saved",
    async () => {
      await page.goto(`${BASE}/settings`);
      const railLink = page.locator('nav a[href="/settings/ai-analysis"]');
      await railLink.waitFor({ timeout: 20000 });
      const group = await page
        .getByRole("group", { name: "Organization" })
        .locator('a[href="/settings/ai-analysis"]')
        .count();
      await railLink.click();
      await page.waitForURL(`${BASE}/settings/ai-analysis`);
      const toggle = page.getByRole("button", { name: "Provider", exact: true });
      await toggle.waitFor();
      const collapsed = (await toggle.getAttribute("aria-expanded")) === "false";
      const notConnected = await page.getByText("Not connected").isVisible();
      const prompts = await page.locator("textarea[id^=ai-field-prompt-]").count();
      const disclosure = await page
        .getByRole("heading", { name: "Field prompts" })
        .getByRole("button")
        .count();
      const conversion = await page.getByRole("heading", { name: "Request conversion" }).count();
      const link = await page
        .getByRole("link", { name: "Contracts → Fields" })
        .getAttribute("href");
      const order = (await page.locator("h2").allInnerTexts()).map((t) => t.trim());
      expect(
        (await railLink.innerText()).trim() === "AI analysis" &&
          group === 1 &&
          prompts === 7 &&
          disclosure === 0 &&
          conversion === 0 &&
          link === "/settings/contracts/fields",
        `group=${group} prompts=${prompts} disclosure=${disclosure} conversion=${conversion} link=${link}`,
      );
      return `AI analysis is its own link in the Organization rail group. Provider starts collapsed=${collapsed} with Not connected=${notConnected}. Card headings: ${order.join(" > ")}. Field prompts has no collapse control and holds 7 prompts, with a Contracts → Fields link to /settings/contracts/fields. No Request conversion card before a connector is saved.`;
    },
  );

  await step(
    "A02",
    "administrator",
    "browser-walkthrough",
    "Expand Provider; check presets, the default form and the Provider card intro",
    async () => {
      await page.getByRole("button", { name: "Provider", exact: true }).click();
      const options = await page.locator("#ai-preset option").allInnerTexts();
      const preset = await page.locator("#ai-preset").inputValue();
      const keyRequired = await page
        .getByText("Required for this provider. The key is write-only and encrypted at rest.")
        .isVisible();
      const load = page.getByRole("button", { name: "Load models" });
      const loadDisabled = await load.isDisabled();
      const testDisabled = await page.getByRole("button", { name: "Test connection" }).isDisabled();
      const model = await page.locator("#ai-model").inputValue();
      await page.locator("#ai-api-key").fill(FICTION.aiKey);
      const loadEnabledWithKey = await load.isEnabled();
      await page.locator("#ai-api-key").fill("");
      const intro = await page
        .getByText(/^Connect your AI provider/)
        .first()
        .innerText()
        .catch(() => "(intro not found)");
      const expected = [
        "Anthropic",
        "OpenAI",
        "Azure OpenAI",
        "Gemini",
        "OpenRouter",
        "Ollama",
        "Custom endpoint",
      ];
      expect(
        expected.every((o) => options.includes(o)) &&
          options.length === 7 &&
          preset === "anthropic" &&
          keyRequired &&
          loadDisabled &&
          testDisabled &&
          loadEnabledWithKey,
        `options=${options} preset=${preset} keyRequired=${keyRequired} loadDisabled=${loadDisabled} testDisabled=${testDisabled}`,
      );
      return `Provider options match the article table: ${options.join(", ")}. Default Anthropic with prefilled model ${model}. The API key hint says it is required. Load models is disabled until a key is typed. Test connection is disabled. Provider card intro: "${intro.replace(/\s+/g, " ").trim()}"`;
    },
  );

  await step(
    "A03",
    "administrator",
    "browser-walkthrough",
    "Select Save connector with no API key",
    async () => {
      const before = aiWrites.length;
      await page.getByRole("button", { name: "Save connector" }).click();
      await wait(800);
      const missing = await invalidFields(page, ["ai-api-key"]);
      expect(aiWrites.length === before && missing.length === 1, "save not blocked");
      return "The browser refused the submit because API key is required. No request reached the API.";
    },
  );

  await step(
    "A04",
    "administrator",
    "browser-walkthrough",
    "Check the OpenRouter, Azure OpenAI, Ollama and Custom endpoint forms",
    async () => {
      const facts = [];
      await page.locator("#ai-preset").selectOption("openrouter");
      facts.push(
        `OpenRouter: model "${await page.locator("#ai-model").inputValue()}", Base URL shown=${(await page.locator("#ai-base-url").count()) > 0}, Load models shown=${await page.getByRole("button", { name: "Load models" }).isVisible()}`,
      );
      await page.locator("#ai-preset").selectOption("azure_openai");
      const azureLabel = await page.getByText("Deployment endpoint", { exact: true }).isVisible();
      const azureManual = (await page.locator("input#ai-model").count()) === 1;
      const azureLoad = await page.getByRole("button", { name: "Load models" }).count();
      facts.push(
        `Azure OpenAI: Deployment endpoint=${azureLabel}, manual model input=${azureManual}, Load models buttons=${azureLoad}`,
      );
      await page.locator("#ai-preset").selectOption("ollama");
      const ollamaOptional = await page
        .getByText("Ollama does not require an API key.")
        .isVisible();
      const ollamaBase = (await page.locator("#ai-base-url").count()) > 0;
      facts.push(`Ollama: key optional hint=${ollamaOptional}, Base URL shown=${ollamaBase}`);
      await page.locator("#ai-preset").selectOption("custom");
      const protocols = await page.locator("#ai-protocol option").allInnerTexts();
      facts.push(
        `Custom endpoint: Protocol options=${protocols.join(" / ")}, Base URL shown=${(await page.locator("#ai-base-url").count()) > 0}`,
      );
      expect(
        azureLabel &&
          azureManual &&
          azureLoad === 0 &&
          ollamaOptional &&
          !ollamaBase &&
          ["Anthropic Messages", "OpenAI-compatible chat completions", "Gemini"].every((p) =>
            protocols.includes(p),
          ),
        facts.join("; "),
      );
      return facts.join(". ");
    },
  );

  await step(
    "A05",
    "administrator",
    "browser-walkthrough",
    "Custom endpoint: save a Base URL with embedded credentials",
    async () => {
      await page.locator("#ai-base-url").fill("http://user:pass@127.0.0.1:9/v1");
      await page.locator("#ai-api-key").fill(FICTION.aiKey);
      await page.getByRole("button", { name: "Enter model ID manually" }).click();
      await page.locator("#ai-model").fill(FICTION.model);
      await page.getByRole("button", { name: "Save connector" }).click();
      const refusal = page.getByText("The provider base URL must not contain credentials.");
      await refusal.waitFor({ timeout: 10000 });
      const state = await (await api.get(`${BASE}/api/v1/ai-connector`)).json();
      expect(!state.connector.configured, "connector created");
      return 'The pane showed "The provider base URL must not contain credentials." No connector was created.';
    },
  );

  await step(
    "A06",
    "administrator",
    "automated-test",
    "API refusals for incomplete or invalid AI saves, and Test with no connector",
    async () => {
      const put = (data) => api.put(`${BASE}/api/v1/ai-connector`, { data });
      const noKey = await put({ preset: "openrouter", model: "x" });
      const ftp = await put({
        preset: "custom",
        protocol: "openai_chat_completions",
        baseUrl: "ftp://127.0.0.1/v1",
        apiKey: FICTION.aiKey,
        model: "x",
      });
      const noModel = await put({
        preset: "custom",
        protocol: "openai_chat_completions",
        baseUrl: FICTION.closedEndpoint,
        apiKey: FICTION.aiKey,
        model: " ",
      });
      const azureList = await api.post(`${BASE}/api/v1/ai-connector/models`, {
        data: { preset: "azure_openai", baseUrl: "https://example.test/x", apiKey: FICTION.aiKey },
      });
      const test = await api.post(`${BASE}/api/v1/ai-connector/test`);
      const detail = async (r) =>
        `${r.status()} "${(await r.json().catch(() => ({}))).detail ?? "validation"}"`;
      const out = [
        `OpenRouter without key: ${await detail(noKey)}`,
        `Custom with ftp URL: ${await detail(ftp)}`,
        `Blank model: ${noModel.status()}`,
        `Azure Load models: ${await detail(azureList)}`,
        `Test with no connector: ${await detail(test)}`,
      ];
      const state = await (await api.get(`${BASE}/api/v1/ai-connector`)).json();
      expect(
        [noKey, ftp, noModel, azureList, test].every((r) => r.status() === 400) &&
          !state.connector.configured,
        out.join("; "),
      );
      return `${out.join(". ")}. No connector was created.`;
    },
  );

  await step(
    "A07",
    "administrator",
    "browser-walkthrough",
    "Load models against a closed loopback endpoint (Model list cannot be loaded)",
    async () => {
      await page.reload();
      await page.getByRole("button", { name: "Provider", exact: true }).click();
      await page.locator("#ai-preset").selectOption("custom");
      await page.locator("#ai-base-url").fill(FICTION.closedEndpoint);
      await page.locator("#ai-api-key").fill(FICTION.aiKey);
      await page.getByRole("button", { name: "Load models" }).click();
      const error = page.locator(".text-status-danger-fg").first();
      await error.waitFor({ timeout: 40000 });
      const manual = await page
        .getByRole("button", { name: "Enter model ID manually" })
        .isVisible();
      const state = await (await api.get(`${BASE}/api/v1/ai-connector`)).json();
      expect(
        !state.connector.configured && manual,
        `configured=${state.connector.configured} manual=${manual}`,
      );
      return `Load models showed "${(await error.innerText()).trim()}" beside the control. Enter model ID manually stays available. Nothing was saved.`;
    },
  );

  await step(
    "A08",
    "administrator",
    "browser-walkthrough",
    "Save the fictional Custom endpoint; check Connected, the switch, Request conversion; Test connection fails; turn off at once",
    async () => {
      await page.getByRole("button", { name: "Enter model ID manually" }).click();
      await page.locator("#ai-model").fill(FICTION.model);
      await page.getByRole("button", { name: "Save connector" }).click();
      await page.locator("#ai-enabled").waitFor({ timeout: 10000 });
      const chip = await page.getByText("Connected", { exact: true }).isVisible();
      const state = await (await api.get(`${BASE}/api/v1/ai-connector`)).json();
      const heading = page.getByRole("heading", { name: "Request conversion" });
      await heading.waitFor();
      const switches = [];
      for (const id of [
        "matter-preparation",
        "contract-preparation",
        "contract-conversion-analysis",
      ])
        switches.push(
          `${id}: checked=${await page.locator(`#${id}`).getAttribute("aria-checked")}, enabled=${await page.locator(`#${id}`).isEnabled()}`,
        );
      const order = (await page.locator("h2").allInnerTexts()).map((t) => t.trim());
      await page.getByRole("button", { name: "Test connection" }).click();
      const failure = page.getByText(/^The connection test failed\./);
      await failure.waitFor({ timeout: 40000 });
      const failureText = (await failure.innerText()).trim();
      // Shared lab: turn the connector off right away so no automatic run starts.
      await page.locator("#ai-enabled").click();
      await page.getByText("Turned off", { exact: true }).waitFor({ timeout: 10000 });
      expect(
        chip && state.connector.enabled && switches.every((s) => s.includes("checked=false")),
        `chip=${chip} enabled=${state.connector.enabled} ${switches}`,
      );
      return `A new connector saved enabled (API enabled=true) and the chip reads Connected before any successful test. Request conversion appeared with three switches off (${switches.join("; ")}). Card order: ${order.join(" > ")}. Test connection showed "${failureText}" (Endpoint or connection failure row). The connector was then turned off.`;
    },
  );

  await step(
    "A09",
    "administrator",
    "browser-walkthrough",
    "Turned off: Test connection and switches disabled; save a change while off; API refusals",
    async () => {
      await page.reload();
      await page.getByRole("button", { name: "Provider", exact: true }).click();
      const hint = await page
        .getByText(/^Off since /)
        .innerText()
        .catch(() => "(no Off since hint)");
      const testDisabled = await page.getByRole("button", { name: "Test connection" }).isDisabled();
      const switchesDisabled = [];
      for (const id of [
        "matter-preparation",
        "contract-preparation",
        "contract-conversion-analysis",
      ])
        switchesDisabled.push(await page.locator(`#${id}`).isDisabled());
      const keep = await page
        .getByText("Leave blank to keep the current key. Paste a new one to rotate.")
        .isVisible();
      const keyBlank = (await page.locator("#ai-api-key").inputValue()) === "";
      await page
        .getByRole("button", { name: "Enter model ID manually" })
        .click()
        .catch(() => undefined);
      await page.locator("#ai-model").fill(`${FICTION.model}-2`);
      await page.getByRole("button", { name: "Save connector" }).click();
      await wait(1500);
      const state = await (await api.get(`${BASE}/api/v1/ai-connector`)).json();
      const apiTest = await api.post(`${BASE}/api/v1/ai-connector/test`);
      const detail = (await apiTest.json().catch(() => ({}))).detail;
      expect(
        testDisabled &&
          switchesDisabled.every(Boolean) &&
          keep &&
          keyBlank &&
          !state.connector.enabled &&
          state.connector.model.endsWith("-2") &&
          state.connector.hasApiKey !== false,
        `test=${testDisabled} switches=${switchesDisabled} keep=${keep} blank=${keyBlank} enabled=${state.connector.enabled} model=${state.connector.model}`,
      );
      return `Chip reads Turned off; hint "${hint.trim()}". Test connection and the three Request conversion switches are disabled. The API key input is blank with "Leave blank to keep the current key. Paste a new one to rotate." Saving a changed Model with a blank key for the same destination stored it and left the connector off. The test API answers ${apiTest.status()} "${detail}".`;
    },
  );

  await step(
    "A10",
    "administrator",
    "browser-walkthrough",
    "Changed destination requires a new API key",
    async () => {
      await page.locator("#ai-base-url").fill("http://127.0.0.1:10/v1");
      const required = await page
        .getByText("Required for this provider. The key is write-only and encrypted at rest.")
        .isVisible();
      const before = aiWrites.length;
      await page.getByRole("button", { name: "Save connector" }).click();
      await wait(800);
      const blocked = aiWrites.length === before;
      await page.locator("#ai-base-url").fill(FICTION.closedEndpoint);
      expect(required && blocked, `required=${required} blocked=${blocked}`);
      return "Changing Base URL switches the key hint to required, and the browser blocks a save without a new key. No request was sent.";
    },
  );

  await step(
    "A11",
    "administrator",
    "browser-walkthrough",
    "Field prompt: Enter saves, Shift+Enter inserts a line break, clearing restores, Reset to default, maxlength",
    async () => {
      await page.reload();
      const box = page.locator("textarea[id^=ai-field-prompt-]").first();
      const id = await box.getAttribute("id");
      const original = await box.inputValue();
      await box.click();
      await box.fill("DOC-029r2 fictional prompt");
      await box.press("Shift+Enter");
      await box.type("second line");
      const withBreak = await box.inputValue();
      await box.press("Enter");
      const reset = page.getByRole("button", { name: /^Reset .* to default$/ }).first();
      await reset.waitFor({ timeout: 10000 });
      await wait(800);
      const slug = id.replace("ai-field-prompt-", "");
      const saved = await (await api.get(`${BASE}/api/v1/ai-field-prompts`)).json();
      const savedText = JSON.stringify(saved).includes("DOC-029r2 fictional prompt\\nsecond line");
      await box.click();
      await box.fill("");
      await box.blur();
      await wait(800);
      const afterClear = await box.inputValue();
      await reset.click();
      await reset.waitFor({ state: "detached", timeout: 10000 });
      const afterReset = await box.inputValue();
      const maxLength = await box.getAttribute("maxlength");
      expect(
        withBreak === "DOC-029r2 fictional prompt\nsecond line" &&
          savedText &&
          afterClear === withBreak &&
          afterReset === original &&
          maxLength === "2000",
        `break=${JSON.stringify(withBreak)} saved=${savedText} clear=${JSON.stringify(afterClear)} reset=${afterReset === original} max=${maxLength}`,
      );
      return `On ${id} (${slug}): Shift+Enter inserted a line break, Enter saved the two-line text (read back from the API) and showed Reset to default. Clearing the box and leaving restored the saved text. Reset to default restored the built-in prompt and the reset control left. maxlength is 2000.`;
    },
  );

  await step(
    "A12",
    "administrator",
    "browser-walkthrough",
    "Known issue #887 re-check: Escape in a Field prompt (the article makes no Escape claim)",
    async () => {
      const box = page.locator("textarea[id^=ai-field-prompt-]").first();
      const id = await box.getAttribute("id");
      const original = await box.inputValue();
      await box.click();
      await box.fill("DOC-029r2 abandoned prompt edit");
      await box.press("Escape");
      await wait(1500);
      await page.reload();
      const reloaded = await page.locator(`#${id}`).inputValue();
      const stored = reloaded !== original;
      if (stored) {
        await page
          .getByRole("button", { name: /^Reset .* to default$/ })
          .first()
          .click();
        await page
          .getByRole("button", { name: /^Reset .* to default$/ })
          .first()
          .waitFor({ state: "detached", timeout: 10000 });
      }
      const restored = (await page.locator(`#${id}`).inputValue()) === original;
      expect(restored, "prompt not restored");
      return `After Escape and reload the abandoned text was ${stored ? "stored (defect #887 is still present)" : "not stored"}. ${stored ? "Reset to default restored the built-in prompt." : ""} The article has no Escape sentence, so this is not a step failure.`;
    },
  );

  await step(
    "A13",
    "administrator",
    "browser-walkthrough",
    "Follow Contracts → Fields; open Add field and find Scope and AI prompt (cancel without saving)",
    async () => {
      await page.getByRole("link", { name: "Contracts → Fields" }).click();
      await page.waitForURL(`${BASE}/settings/contracts/fields`);
      const headings = (await page.locator("h2").allInnerTexts()).map((t) => t.trim());
      const add = page.getByRole("button", { name: /Add field/i }).first();
      await add.waitFor({ timeout: 10000 });
      await add.click();
      const dialog = page.getByRole("dialog").first();
      await dialog.waitFor({ timeout: 10000 });
      const scope = await dialog.getByText("Scope", { exact: true }).count();
      const prompt = await dialog.getByText("AI prompt", { exact: true }).count();
      const text = (await dialog.innerText()).replace(/\s+/g, " ").slice(0, 300);
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached", timeout: 10000 }).catch(() => undefined);
      expect(scope > 0 && prompt > 0, `scope=${scope} prompt=${prompt} dialog="${text}"`);
      return `The link opened /settings/contracts/fields. Card headings: ${headings.join(" > ")}. Add field opened a dialog with Scope and AI prompt controls. The agent closed it without saving. Attaching a Field to a Type and running Analysis need a live provider and were not run.`;
    },
  );

  await step(
    "A14",
    "administrator",
    "browser-walkthrough",
    "Turn Use AI analysis on and off again; Remove connector",
    async () => {
      await page.goto(`${BASE}/settings/ai-analysis`);
      await page.getByRole("button", { name: "Provider", exact: true }).click();
      await page.locator("#ai-enabled").click();
      await page.getByText("Connected", { exact: true }).waitFor({ timeout: 10000 });
      const testEnabled = await page.getByRole("button", { name: "Test connection" }).isEnabled();
      await page.locator("#ai-enabled").click();
      await page.getByText("Turned off", { exact: true }).waitFor({ timeout: 10000 });
      await page.getByRole("button", { name: "Remove connector" }).click();
      const dialog = page.getByRole("dialog", { name: "Remove the AI connector" });
      await dialog.waitFor();
      const body = (await dialog.innerText()).replace(/\s+/g, " ").trim();
      await dialog.getByRole("button", { name: "Remove connector" }).click();
      await page.getByText("Not connected").waitFor({ timeout: 10000 });
      const conversion = await page.getByRole("heading", { name: "Request conversion" }).count();
      const state = await (await api.get(`${BASE}/api/v1/ai-connector`)).json();
      expect(
        testEnabled && !state.connector.configured && conversion === 0,
        `test=${testEnabled} configured=${state.connector.configured} conversion=${conversion}`,
      );
      return `Turning the switch on showed Connected and enabled Test connection; the agent turned it off again at once. The remove dialog says "${body}". After confirming, the chip reads Not connected, the Request conversion card is gone, and the API reports configured false.`;
    },
  );

  // Legal Team Member, separate context.
  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  await step(
    "R01",
    "legal_team_member",
    "browser-walkthrough",
    "Open AI analysis settings as a Legal Team Member (Settings is unavailable row)",
    async () => {
      await signIn(member, MEMBER);
      await member.goto(`${BASE}/settings/ai-analysis`);
      await member.waitForURL(`${BASE}/settings/profile`, { timeout: 20000 });
      const organization = await member.getByRole("group", { name: "Organization" }).count();
      const ai = await memberContext.request.get(`${BASE}/api/v1/ai-connector`);
      // Attempt 1 used an invalid slug and got 400 (validation) instead of the role refusal.
      const promptsRead = await memberContext.request.get(`${BASE}/api/v1/ai-field-prompts`);
      const prompts = await memberContext.request.put(`${BASE}/api/v1/ai-field-prompts`, {
        data: { slug: "term_type", prompt: null },
      });
      expect(
        organization === 0 &&
          ai.status() === 403 &&
          promptsRead.status() === 403 &&
          prompts.status() === 403,
        `org=${organization} ai=${ai.status()} promptsRead=${promptsRead.status()} prompts=${prompts.status()}`,
      );
      return `/settings/ai-analysis forwards to /settings/profile. The Organization rail group is absent. The connector API answers ${ai.status()}, the prompt read API answers ${promptsRead.status()}, and the prompt save API answers ${prompts.status()}.`;
    },
  );
  await memberContext.close();

  // Operator: signed-out reader link.
  const opContext = await browser.newContext();
  const op = await opContext.newPage();
  await step(
    "OB01",
    "operator",
    "browser-walkthrough",
    "Signed out, open /documentation/configure-analysis and follow the deployment configuration link",
    async () => {
      await op.goto(`${BASE}/documentation/configure-analysis`);
      const link = op.getByRole("link", { name: "deployment configuration" }).first();
      await link.waitFor({ timeout: 20000 });
      await link.click();
      await op.waitForURL(/deployment-configuration/, { timeout: 20000 });
      await op
        .getByRole("heading", { name: "Preserve and rotate encryption keys" })
        .waitFor({ timeout: 20000 });
      const body = await op.locator("main").innerText();
      const outbound = body.includes(
        "Allow the required outbound provider traffic from both the app and worker",
      );
      const key = /OPENLAW_SECRET_KEY` encrypts|OPENLAW_SECRET_KEY encrypts/.test(body);
      expect(outbound && key, `outbound=${outbound} key=${key}`);
      return `Signed out, the reader opened /documentation/configure-analysis. Its deployment configuration link opened ${new URL(op.url()).pathname}, which says to allow outbound provider traffic from both the app and worker and has "Preserve and rotate encryption keys" naming OPENLAW_SECRET_KEY. The reader serves the article bytes built into the lab image; this proves the link and its target, not the reviewed wording.`;
    },
  );
  await opContext.close();

  // Operator: container checks. Names, counts and hash equality only.
  await step(
    "O01",
    "operator",
    "container-operation",
    "App and worker share OPENLAW_SECRET_KEY; no provider credential or proxy in the environment",
    async () => {
      const envOf = (svc) => {
        const out = docker([
          "inspect",
          "--format",
          "{{range .Config.Env}}{{println .}}{{end}}",
          `${PROJECT}-${svc}-1`,
        ]);
        return Object.fromEntries(
          out
            .split("\n")
            .filter(Boolean)
            .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
        );
      };
      const app = envOf("app");
      const worker = envOf("worker");
      const h = (v) =>
        createHash("sha256")
          .update(v ?? "")
          .digest("hex");
      const same =
        !!app.OPENLAW_SECRET_KEY && h(app.OPENLAW_SECRET_KEY) === h(worker.OPENLAW_SECRET_KEY);
      const credNames = [...Object.keys(app), ...Object.keys(worker)].filter((n) =>
        /^(AI_|OPENROUTER|OPENAI|ANTHROPIC|GEMINI|AZURE)/i.test(n),
      );
      const proxy = [...Object.keys(app), ...Object.keys(worker)].filter((n) => /proxy/i.test(n));
      expect(same && credNames.length === 0, `same=${same} cred=${credNames}`);
      return `Both containers set a non-empty OPENLAW_SECRET_KEY with equal values (compared by hash equality; nothing printed). No AI provider credential variable is set. Proxy variables: ${proxy.length ? proxy.join(", ") : "none"}. Outbound reach to a real provider was not tested (no live credentials).`;
    },
  );
  await step(
    "O02",
    "operator",
    "container-operation",
    "App and worker logs contain no fictional key or bearer text",
    async () => {
      const logs = (svc) => {
        try {
          return execFileSync("docker", ["logs", "--since", log.startedAt, `${PROJECT}-${svc}-1`], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            maxBuffer: 64 * 1024 * 1024,
          });
        } catch (e) {
          return `${e.stdout ?? ""}${e.stderr ?? ""}`;
        }
      };
      const counts = {};
      for (const svc of ["app", "worker"]) {
        const text = logs(svc);
        counts[svc] = {
          lines: text.split("\n").length,
          fictionalKey: text.split(FICTION.aiKey).length - 1,
          bearer: (text.match(/bearer /gi) ?? []).length,
        };
      }
      expect(
        counts.app.fictionalKey === 0 &&
          counts.worker.fictionalKey === 0 &&
          counts.app.bearer === 0 &&
          counts.worker.bearer === 0,
        JSON.stringify(counts),
      );
      return `Since the run started: app ${counts.app.lines} lines, worker ${counts.worker.lines} lines. The fictional API key and "bearer " appear 0 times in both.`;
    },
  );
} finally {
  // Safety net: never leave a connector behind on the shared lab.
  try {
    if (adminContext) {
      const state = await (await adminContext.request.get(`${BASE}/api/v1/ai-connector`)).json();
      if (state.connector.configured) {
        await adminContext.request.delete(`${BASE}/api/v1/ai-connector`);
        log.cleanup = "The script removed a leftover connector in cleanup.";
      }
    }
  } catch {}
  await browser.close();
  save();
}
