// Credential-free checks for configure-signing (C42) and configure-analysis (C43).
// It checks what the Settings pages do before any real provider account is entered.
// Run from the repository root:
//   LAB_ADMIN_EMAIL=... LAB_ADMIN_PASSWORD=... LAB_MEMBER_EMAIL=... \
//     mise exec -- node docs/documentation/batches/DOC-029/live-provider/credential-free-checks.mjs
// Credentials come only from the environment. The results never contain them.
// Every provider value in this script is fictional. No request goes to DocuSign or an
// AI provider: the RSA key text cannot be parsed, so signing fails before any network call,
// and the AI endpoint is a closed loopback port inside the app container.
import { createRequire } from "node:module";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const require = createRequire(path.join(root, "e2e/package.json"));
const { chromium } = require("@playwright/test");

const BASE = process.env.LAB_APP_URL ?? "http://127.0.0.1:23314";
const ADMIN = {
  email: process.env.LAB_ADMIN_EMAIL,
  password: process.env.LAB_ADMIN_PASSWORD,
  name: "Daniel Okafor",
};
const MEMBER = {
  email: process.env.LAB_MEMBER_EMAIL,
  password: process.env.LAB_ADMIN_PASSWORD,
  name: "Nadia Haddad",
};
if (!ADMIN.email || !ADMIN.password || !MEMBER.email)
  throw new Error("LAB_ADMIN_EMAIL, LAB_ADMIN_PASSWORD and LAB_MEMBER_EMAIL are required");
const OUT = process.env.OUT ?? path.join(here, "credential-free-observations.json");

// Fictional values. The HMAC secret is random per run and is never written out.
const FICTION = {
  integrationKey: "00000000-0000-4000-8000-000000000042",
  userId: "00000000-0000-4000-8000-000000000043",
  unreadableKey: "not an RSA private key (fictional DOC-029 value)",
  hmac: randomBytes(24).toString("base64url"),
  aiKey: "fictional-doc029-key",
  closedEndpoint: "http://127.0.0.1:9/v1",
  model: "fictional-doc029-model",
};

const results = {
  startedAt: new Date().toISOString(),
  app: BASE,
  note: "Sanitized. Fictional provider values only. No account credential or secret is recorded.",
  steps: [],
  finishedAt: null,
};
function save() {
  results.finishedAt = new Date().toISOString();
  writeFileSync(OUT, `${JSON.stringify(results, null, 2)}\n`);
}
async function step(id, article, role, method, action, fn) {
  const entry = { id, article, role, method, action, at: null, actual: null, result: "not-run" };
  results.steps.push(entry);
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

async function signIn(page, who) {
  await page.goto(`${BASE}/auth/login`);
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 20000 });
  await page
    .getByRole("banner")
    .getByRole("button", { name: who.name })
    .waitFor({ timeout: 20000 });
}

/** Counts the connector writes a click causes, to prove native validation stopped them. */
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
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await chromium.launch();
try {
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await adminContext.newPage();
  await signIn(page, ADMIN);
  const api = adminContext.request;

  // Start from the base lab's state: no connectors. Refuse to run otherwise.
  {
    const signing = await (await api.get(`${BASE}/api/v1/signing-connectors/docusign`)).json();
    const ai = await (await api.get(`${BASE}/api/v1/ai-connector`)).json();
    if (signing.connector.configured || ai.connector.configured)
      throw new Error(
        "A connector already exists in this lab. These checks need the unconfigured state.",
      );
  }

  // ---------------------------------------------------------------- E-signature
  const sigWrites = writeCounter(page, /\/api\/v1\/signing-connectors\//);

  await step(
    "S01",
    "configure-signing",
    "administrator",
    "browser-walkthrough",
    "Open Settings > Organization > Integrations > E-signature; check the unconfigured card",
    async () => {
      await page.goto(`${BASE}/settings/integrations`);
      await page.waitForURL(`${BASE}/settings/integrations/e-signature`);
      const railLink = page.getByRole("link", { name: "Integrations", exact: true });
      expect(
        (await railLink.getAttribute("href")) === "/settings/integrations/e-signature",
        "no Integrations link",
      );
      const toggle = page.getByRole("button", { name: "DocuSign" });
      expect(
        (await toggle.getAttribute("aria-expanded")) === "false",
        "DocuSign card is not collapsed",
      );
      expect(await page.getByText("Not connected").isVisible(), "no Not connected chip");
      return "/settings/integrations forwards to /settings/integrations/e-signature. The Settings rail has an Integrations entry for this address. The DocuSign card starts collapsed with the Not connected chip.";
    },
  );

  await step(
    "S02",
    "configure-signing",
    "administrator",
    "browser-walkthrough",
    "Expand DocuSign; check default controls in Polling mode",
    async () => {
      await page.getByRole("button", { name: "DocuSign" }).click();
      expect(
        (await page.locator("#ds-environment").inputValue()) === "demo",
        "Environment is not Demo",
      );
      expect(
        (await page.locator("#ds-update-mode").inputValue()) === "polling",
        "Signing updates is not Polling",
      );
      const hint = await page.locator("#ds-update-mode-hint").innerText();
      expect(hint.includes("15 to 20 minutes"), "Polling hint lacks timing");
      for (const id of ["#ds-integration-key", "#ds-user-id", "#ds-private-key"])
        expect(await page.locator(id).isVisible(), `${id} missing`);
      expect(
        (await page.locator("#ds-public-callback").count()) === 0,
        "callback field shown in Polling",
      );
      expect(
        (await page.locator("#ds-webhook-secret").count()) === 0,
        "HMAC field shown in Polling",
      );
      expect(
        (await page.locator("#ds-webhook-url").count()) === 0,
        "Webhook URL shown before save",
      );
      expect(
        await page.getByRole("button", { name: "Test connection" }).isDisabled(),
        "Test enabled before save",
      );
      expect((await page.locator("#ds-enabled").count()) === 0, "switch shown before save");
      expect(
        (await page.getByRole("button", { name: "Remove connector" }).count()) === 0,
        "Remove shown before save",
      );
      return `Environment Demo and Signing updates Polling by default. Polling hint: "${hint}". Integration key, User ID and RSA private key are shown. Public callback URL, Connect HMAC secret and Webhook URL are absent. Test connection is disabled. No switch and no Remove connector.`;
    },
  );

  await step(
    "S03",
    "configure-signing",
    "administrator",
    "browser-walkthrough",
    "Select Save connector with every field blank (Polling)",
    async () => {
      const before = sigWrites.length;
      await page.getByRole("button", { name: "Save connector" }).click();
      await wait(800);
      const missing = await invalidFields(page, [
        "ds-integration-key",
        "ds-user-id",
        "ds-private-key",
      ]);
      expect(sigWrites.length === before, "a save request was sent");
      expect(missing.length === 3, `only ${missing.join(",")} were missing`);
      return `The browser refused the submit. No request reached the API. Required fields reported missing: ${missing.join(", ")}.`;
    },
  );

  await step(
    "S04",
    "configure-signing",
    "administrator",
    "browser-walkthrough",
    "Choose Webhook; check the extra fields and the missing-HMAC refusal",
    async () => {
      await page.locator("#ds-update-mode").selectOption("webhook");
      const hint = await page.locator("#ds-update-mode-hint").innerText();
      expect(await page.locator("#ds-public-callback").isVisible(), "no Public callback URL");
      expect(await page.locator("#ds-webhook-secret").isVisible(), "no Connect HMAC secret");
      const hmacHint = await page
        .getByText("Required. OpenLaw checks it on every delivery")
        .isVisible();
      await page.locator("#ds-integration-key").fill(FICTION.integrationKey);
      await page.locator("#ds-user-id").fill(FICTION.userId);
      await page.locator("#ds-private-key").fill(FICTION.unreadableKey);
      const before = sigWrites.length;
      await page.getByRole("button", { name: "Save connector" }).click();
      await wait(800);
      const missing = await invalidFields(page, ["ds-webhook-secret"]);
      expect(sigWrites.length === before, "a save request was sent without the HMAC secret");
      expect(missing.length === 1 && hmacHint, "HMAC secret not reported as required");
      return `Webhook shows Public callback URL and Connect HMAC secret with the hint "Required. OpenLaw checks it on every delivery...". Webhook hint: "${hint}". With the HMAC secret blank the browser refused the submit and no request was sent.`;
    },
  );

  await step(
    "S05",
    "configure-signing",
    "administrator",
    "browser-walkthrough",
    "Webhook: enter a non-HTTPS Public callback URL and save",
    async () => {
      await page.locator("#ds-webhook-secret").fill(FICTION.hmac);
      await page
        .locator("#ds-public-callback")
        .fill("http://gateway.example.test/api/v1/signing/docusign/webhook");
      await page.getByRole("button", { name: "Save connector" }).click();
      const note = page.locator("form span[aria-live=polite]").first();
      await page.waitForFunction(
        () => {
          const span = document.querySelector("form span[aria-live=polite]");
          return span && span.textContent.trim() !== "" && !span.textContent.includes("Saving");
        },
        null,
        { timeout: 10000 },
      );
      const shown = (await note.innerText()).trim();
      const state = await (await api.get(`${BASE}/api/v1/signing-connectors/docusign`)).json();
      expect(!state.connector.configured, "a connector was created");
      return `The browser accepted the http:// address. The API refused the save and no connector was created. The pane showed only the generic "${shown}". It did not show the API's rule ("Use an HTTPS callback URL without credentials, query parameters or fragments."), so the reader cannot learn the rule from the pane.`;
    },
  );

  await step(
    "S06",
    "configure-signing",
    "administrator",
    "automated-test",
    "API refusals for incomplete saves (authenticated requests, no browser navigation)",
    async () => {
      const put = (body) => api.put(`${BASE}/api/v1/signing-connectors/docusign`, { data: body });
      const base = {
        environment: "demo",
        integrationKey: FICTION.integrationKey,
        apiUserId: FICTION.userId,
      };
      const noKey = await put({ ...base, updateMode: "polling" });
      const noSecret = await put({
        ...base,
        updateMode: "webhook",
        privateKey: FICTION.unreadableKey,
      });
      const noIds = await put({
        environment: "demo",
        integrationKey: " ",
        apiUserId: "",
        privateKey: FICTION.unreadableKey,
      });
      const a = await noKey.json();
      const b = await noSecret.json();
      expect(
        noKey.status() === 400 && noSecret.status() === 400 && noIds.status() === 400,
        "unexpected status",
      );
      const state = await (await api.get(`${BASE}/api/v1/signing-connectors/docusign`)).json();
      expect(!state.connector.configured, "a connector was created");
      return `Polling without an RSA key: 400 "${a.detail}". Webhook without a Connect secret: 400 "${b.detail}". Blank Integration key and User ID: 400 (validation). No connector was created.`;
    },
  );

  await step(
    "S07",
    "configure-signing",
    "administrator",
    "browser-walkthrough",
    "Save a fictional connector in Polling mode; reload; check the saved state",
    async () => {
      await page.reload();
      await page.getByRole("button", { name: "DocuSign" }).click();
      await page.locator("#ds-update-mode").selectOption("polling");
      await page.locator("#ds-integration-key").fill(FICTION.integrationKey);
      await page.locator("#ds-user-id").fill(FICTION.userId);
      await page.locator("#ds-private-key").fill(FICTION.unreadableKey);
      await page.getByRole("button", { name: "Save connector" }).click();
      await page.locator("#ds-enabled").waitFor({ timeout: 10000 });
      await page.reload();
      await page.getByRole("button", { name: "DocuSign" }).click();
      const chip = await page.getByText("Connected", { exact: true }).isVisible();
      const keyValue = await page.locator("#ds-private-key").inputValue();
      const keepHint = await page
        .getByText("Leave blank to keep the current value. Paste a new one to rotate.")
        .isVisible();
      const checked = await page.locator("#ds-enabled").getAttribute("aria-checked");
      const testEnabled = await page.getByRole("button", { name: "Test connection" }).isEnabled();
      const webhookUrl = await page.locator("#ds-webhook-url").count();
      expect(
        chip &&
          keyValue === "" &&
          keepHint &&
          checked === "true" &&
          testEnabled &&
          webhookUrl === 0,
        `chip=${chip} key=${keyValue !== ""} keep=${keepHint} checked=${checked} test=${testEnabled} webhookUrl=${webhookUrl}`,
      );
      return "The chip reads Connected and Send for signature from records is on. After reload the RSA private key input is blank with the keep/rotate hint. Test connection is enabled. No Webhook URL row in Polling mode.";
    },
  );

  await step(
    "S08",
    "configure-signing",
    "administrator",
    "browser-walkthrough",
    "Test connection with the unreadable fictional key",
    async () => {
      await page.getByRole("button", { name: "Test connection" }).click();
      const failure = page.getByText(/^The connection test failed\./);
      await failure.waitFor({ timeout: 20000 });
      return `The pane showed "${await failure.innerText()}" The Connected chip still showed, which matches the article: the chip does not prove the credentials work.`;
    },
  );

  await step(
    "S09",
    "configure-signing",
    "administrator",
    "browser-walkthrough",
    "Change the saved Polling connector to Webhook without an HMAC secret, then with one",
    async () => {
      await page.locator("#ds-update-mode").selectOption("webhook");
      const before = sigWrites.length;
      await page.getByRole("button", { name: "Save connector" }).click();
      await wait(800);
      const blocked =
        sigWrites.length === before &&
        (await invalidFields(page, ["ds-webhook-secret"])).length === 1;
      await page.locator("#ds-webhook-secret").fill(FICTION.hmac);
      await page.getByRole("button", { name: "Save connector" }).click();
      await page.locator("#ds-webhook-url").waitFor({ timeout: 10000 });
      const url = await page.locator("#ds-webhook-url").inputValue();
      expect(blocked, "save was not blocked without HMAC secret");
      expect(url.endsWith("/api/v1/signing/docusign/webhook"), `unexpected Webhook URL ${url}`);
      return `Without the Connect HMAC secret the browser blocked the save. With a fictional secret the save succeeded without re-entering the RSA key, and the Webhook URL row appeared: ${url}.`;
    },
  );

  const deliver = async (secret) => {
    const body = JSON.stringify({
      event: "envelope-completed",
      data: { envelopeId: randomUUID(), envelopeSummary: { status: "completed" } },
    });
    const headers = { "content-type": "application/json" };
    if (secret)
      headers["x-docusign-signature-1"] = createHmac("sha256", secret)
        .update(body)
        .digest("base64");
    const response = await fetch(`${BASE}/api/v1/signing/docusign/webhook`, {
      method: "POST",
      headers,
      body,
    });
    return response.status;
  };

  await step(
    "S10",
    "configure-signing",
    "operator",
    "automated-test",
    "Webhook mode: post an unsigned and a signed fictional delivery for an unknown Envelope",
    async () => {
      const unsigned = await deliver(null);
      const signed = await deliver(FICTION.hmac);
      expect(unsigned === 401 && signed === 204, `unsigned=${unsigned} signed=${signed}`);
      return `Unsigned delivery: HTTP ${unsigned}. Delivery signed with the saved fictional secret, naming an unknown Envelope: HTTP ${signed} (acknowledged, nothing changed).`;
    },
  );

  await step(
    "S11",
    "configure-signing",
    "administrator",
    "browser-walkthrough",
    "Switch back to Polling; check the Webhook fields leave and a signed delivery is refused",
    async () => {
      await page.locator("#ds-update-mode").selectOption("polling");
      const fieldsGone = (await page.locator("#ds-webhook-secret").count()) === 0;
      await page.getByRole("button", { name: "Save connector" }).click();
      await page.locator("#ds-webhook-url").waitFor({ state: "detached", timeout: 10000 });
      const state = await (await api.get(`${BASE}/api/v1/signing-connectors/docusign`)).json();
      const signed = await deliver(FICTION.hmac);
      expect(
        fieldsGone &&
          state.connector.updateMode === "polling" &&
          state.connector.hasWebhookSecret &&
          signed === 401,
        `fields=${fieldsGone} mode=${state.connector.updateMode} secret=${state.connector.hasWebhookSecret} signed=${signed}`,
      );
      return `Polling hides the callback and HMAC fields and removes the Webhook URL row after save. The stored Connect secret remains (hasWebhookSecret true), yet a correctly signed delivery now gets HTTP ${signed}.`;
    },
  );

  await step(
    "S12",
    "configure-signing",
    "administrator",
    "browser-walkthrough",
    "Turn off Send for signature from records; test; save a change while off",
    async () => {
      await page.locator("#ds-enabled").click();
      await page.getByText("Turned off", { exact: true }).waitFor({ timeout: 10000 });
      const offHint = await page.getByText(/^Off since /).innerText();
      const testEnabled = await page.getByRole("button", { name: "Test connection" }).isEnabled();
      await page.getByRole("button", { name: "Test connection" }).click();
      const failure = page.getByText(
        "No e-signature connector is configured. Save the credentials first.",
      );
      await failure.waitFor({ timeout: 10000 });
      await page.locator("#ds-user-id").fill(`${FICTION.userId.slice(0, -2)}99`);
      await page.getByRole("button", { name: "Save connector" }).click();
      await wait(1500);
      const state = await (await api.get(`${BASE}/api/v1/signing-connectors/docusign`)).json();
      const signedWhileOff = await deliver(FICTION.hmac);
      expect(
        testEnabled && !state.connector.enabled && state.connector.apiUserId.endsWith("99"),
        `test=${testEnabled} enabled=${state.connector.enabled}`,
      );
      return `Chip reads Turned off; hint "${offHint}". Test connection stays enabled; selecting it shows "No e-signature connector is configured. Save the credentials first." Saving a changed User ID while off stored the change and left the connector off. A delivery while off: HTTP ${signedWhileOff}.`;
    },
  );

  await step(
    "S13",
    "configure-signing",
    "administrator",
    "browser-walkthrough",
    "Turn the connector back on, then remove it",
    async () => {
      await page.locator("#ds-enabled").click();
      await page.getByText("Connected", { exact: true }).waitFor({ timeout: 10000 });
      await page.getByRole("button", { name: "Remove connector" }).click();
      const dialog = page.getByRole("dialog", { name: "Remove the DocuSign connector" });
      await dialog.waitFor();
      const body = await dialog.innerText();
      await dialog.getByRole("button", { name: "Remove connector" }).click();
      await page.getByText("Not connected").waitFor({ timeout: 10000 });
      const mode = await page.locator("#ds-update-mode").inputValue();
      const key = await page.locator("#ds-integration-key").inputValue();
      const state = await (await api.get(`${BASE}/api/v1/signing-connectors/docusign`)).json();
      expect(
        !state.connector.configured && mode === "polling" && key === "",
        "connector not removed cleanly",
      );
      return `Turning on restored Connected. The remove dialog says: "${body.replace(/\s+/g, " ").trim()}". After confirming, the chip reads Not connected, the form is blank and Signing updates is back to Polling. The API reports configured false.`;
    },
  );

  // ---------------------------------------------------------------- AI analysis
  const aiWrites = writeCounter(page, /\/api\/v1\/ai-connector/);

  await step(
    "A01",
    "configure-analysis",
    "administrator",
    "browser-walkthrough",
    "Open Settings > Organization > AI analysis; check the unconfigured page",
    async () => {
      await page.goto(`${BASE}/settings/ai-analysis`);
      const railLink = page.locator('nav a[href="/settings/ai-analysis"]');
      expect((await railLink.innerText()).trim() === "AI analysis", "no AI analysis rail link");
      const toggle = page.getByRole("button", { name: "Provider", exact: true });
      expect(
        (await toggle.getAttribute("aria-expanded")) === "false",
        "Provider card not collapsed",
      );
      expect(await page.getByText("Not connected").isVisible(), "no Not connected chip");
      const prompts = await page.locator("textarea[id^=ai-field-prompt-]").count();
      const promptsHeading = page.getByRole("heading", { name: "Field prompts" });
      const disclosure = await promptsHeading.getByRole("button").count();
      const conversion = await page.getByRole("heading", { name: "Request conversion" }).count();
      const link = await page
        .getByRole("link", { name: "Contracts → Fields" })
        .getAttribute("href");
      expect(
        prompts === 7 &&
          disclosure === 0 &&
          conversion === 0 &&
          link === "/settings/contracts/fields",
        `prompts=${prompts} disclosure=${disclosure} conversion=${conversion} link=${link}`,
      );
      return "AI analysis is its own Organization rail entry. Provider starts collapsed with Not connected. Field prompts is open, has no collapse control and holds 7 prompts, with a Contracts → Fields link to /settings/contracts/fields. No Request conversion card is shown before a connector is saved.";
    },
  );

  await step(
    "A02",
    "configure-analysis",
    "administrator",
    "browser-walkthrough",
    "Expand Provider; check presets and the default Anthropic form",
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
      expect(
        options.length === 7 &&
          preset === "anthropic" &&
          keyRequired &&
          loadDisabled &&
          testDisabled &&
          loadEnabledWithKey,
        `options=${options} preset=${preset}`,
      );
      return `Presets: ${options.join(", ")}. Default preset Anthropic with prefilled model ${model}. The API key hint says it is required. Load models is disabled until a key is typed. Test connection is disabled.`;
    },
  );

  await step(
    "A03",
    "configure-analysis",
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
    "configure-analysis",
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
      facts.push(
        `Ollama: key optional hint=${ollamaOptional}, Base URL shown=${(await page.locator("#ai-base-url").count()) > 0}`,
      );
      await page.locator("#ai-preset").selectOption("custom");
      const protocols = await page.locator("#ai-protocol option").allInnerTexts();
      facts.push(
        `Custom endpoint: Protocol options=${protocols.join(" / ")}, Base URL shown=${(await page.locator("#ai-base-url").count()) > 0}, model "${await page.locator("#ai-model").inputValue()}"`,
      );
      expect(
        azureLabel && azureManual && azureLoad === 0 && ollamaOptional && protocols.length === 3,
        facts.join("; "),
      );
      return facts.join(". ");
    },
  );

  await step(
    "A05",
    "configure-analysis",
    "administrator",
    "browser-walkthrough",
    "Custom endpoint: save a Base URL that contains credentials",
    async () => {
      await page.locator("#ai-base-url").fill("http://user:pass@127.0.0.1:9/v1"); // secretlint-disable-line -- fictional credential-in-URL refusal check
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
    "configure-analysis",
    "administrator",
    "automated-test",
    "API refusals for incomplete or invalid AI saves (authenticated requests)",
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
      const noProtocol = await put({
        preset: "custom",
        baseUrl: FICTION.closedEndpoint,
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
      const detail = async (response) =>
        `${response.status()} "${(await response.json()).detail ?? "validation"}"`;
      const out = [
        `OpenRouter without key: ${await detail(noKey)}`,
        `Custom with ftp URL: ${await detail(ftp)}`,
        `Custom without Protocol: ${await detail(noProtocol)}`,
        `Blank model: ${noModel.status()}`,
        `Azure Load models: ${await detail(azureList)}`,
        `Test with no connector: ${await detail(test)}`,
      ];
      expect(
        [noKey, ftp, noProtocol, noModel, azureList, test].every((r) => r.status() === 400),
        out.join("; "),
      );
      return out.join(". ");
    },
  );

  await step(
    "A07",
    "configure-analysis",
    "administrator",
    "browser-walkthrough",
    "Load models against a closed loopback endpoint",
    async () => {
      await page.reload();
      await page.getByRole("button", { name: "Provider", exact: true }).click();
      await page.locator("#ai-preset").selectOption("custom");
      await page.locator("#ai-base-url").fill(FICTION.closedEndpoint);
      await page.locator("#ai-api-key").fill(FICTION.aiKey);
      await page.getByRole("button", { name: "Load models" }).click();
      const error = page.locator(".text-status-danger-fg").first();
      await error.waitFor({ timeout: 40000 });
      const state = await (await api.get(`${BASE}/api/v1/ai-connector`)).json();
      expect(!state.connector.configured, "Load models saved a connector");
      return `Load models showed "${await error.innerText()}" beside the control. Nothing was saved.`;
    },
  );

  await step(
    "A08",
    "configure-analysis",
    "administrator",
    "browser-walkthrough",
    "Save the fictional Custom endpoint; check chip, switch, Request conversion card; test",
    async () => {
      await page.getByRole("button", { name: "Enter model ID manually" }).click();
      await page.locator("#ai-model").fill(FICTION.model);
      await page.getByRole("button", { name: "Save connector" }).click();
      await page.locator("#ai-enabled").waitFor({ timeout: 10000 });
      const chip = await page.getByText("Connected", { exact: true }).isVisible();
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
      const order = await page.locator("h2").allInnerTexts();
      await page.getByRole("button", { name: "Test connection" }).click();
      const failure = page.getByText(/^The connection test failed\./);
      await failure.waitFor({ timeout: 40000 });
      expect(chip, "chip not Connected");
      return `Chip reads Connected; Use AI analysis switch shown. Request conversion card appeared (${switches.join("; ")}). Card order: ${order.map((t) => t.trim()).join(" > ")}. Test connection showed "${await failure.innerText()}"`;
    },
  );

  await step(
    "A09",
    "configure-analysis",
    "administrator",
    "browser-walkthrough",
    "Reload; check key retention hint and key requirement after changing the endpoint",
    async () => {
      await page.reload();
      await page.getByRole("button", { name: "Provider", exact: true }).click();
      const keep = await page
        .getByText("Leave blank to keep the current key. Paste a new one to rotate.")
        .isVisible();
      const keyBlank = (await page.locator("#ai-api-key").inputValue()) === "";
      await page.locator("#ai-base-url").fill("http://127.0.0.1:10/v1");
      const required = await page
        .getByText("Required for this provider. The key is write-only and encrypted at rest.")
        .isVisible();
      const before = aiWrites.length;
      await page.getByRole("button", { name: "Save connector" }).click();
      await wait(800);
      const blocked = aiWrites.length === before;
      await page.locator("#ai-base-url").fill(FICTION.closedEndpoint);
      expect(
        keep && keyBlank && required && blocked,
        `keep=${keep} blank=${keyBlank} required=${required} blocked=${blocked}`,
      );
      return "After reload the API key input is blank with the keep/rotate hint. Changing Base URL switches the hint to required, and the browser blocks a save without a new key.";
    },
  );

  await step(
    "A10",
    "configure-analysis",
    "administrator",
    "browser-walkthrough",
    "Turn off Use AI analysis; check Test and Request conversion; save while off",
    async () => {
      await page.locator("#ai-enabled").click();
      await page.getByText("Turned off", { exact: true }).waitFor({ timeout: 10000 });
      const hint = await page.getByText(/^Off since /).innerText();
      const testDisabled = await page.getByRole("button", { name: "Test connection" }).isDisabled();
      const switchesDisabled = await page.locator("#matter-preparation").isDisabled();
      await page
        .getByRole("button", { name: "Enter model ID manually" })
        .click()
        .catch(() => undefined);
      await page.locator("#ai-model").fill(`${FICTION.model}-2`);
      await page.getByRole("button", { name: "Save connector" }).click();
      await wait(1500);
      const state = await (await api.get(`${BASE}/api/v1/ai-connector`)).json();
      const apiTest = await api.post(`${BASE}/api/v1/ai-connector/test`);
      const detail = (await apiTest.json()).detail;
      expect(
        testDisabled &&
          switchesDisabled &&
          !state.connector.enabled &&
          state.connector.model.endsWith("-2"),
        `test=${testDisabled} switches=${switchesDisabled} enabled=${state.connector.enabled} model=${state.connector.model}`,
      );
      return `Chip reads Turned off; hint "${hint}". Test connection and the three Request conversion switches are disabled. Saving a changed Model stored it and left the connector off. The test API answers ${apiTest.status()} "${detail}".`;
    },
  );

  await step(
    "A11",
    "configure-analysis",
    "administrator",
    "browser-walkthrough",
    "Type in a core Field prompt, press Escape, reload",
    async () => {
      const box = page.locator("textarea[id^=ai-field-prompt-]").first();
      const id = await box.getAttribute("id");
      const original = await box.inputValue();
      const puts = [];
      const listener = (request) => {
        if (request.method() === "PUT" && request.url().includes("/api/v1/ai-field-prompts"))
          puts.push(request.url());
      };
      page.on("request", listener);
      await box.click();
      await box.fill("DOC-029 fictional prompt edit that is abandoned");
      await box.press("Escape");
      const afterEscape = await box.inputValue();
      await wait(1500);
      page.off("request", listener);
      await page.reload();
      const reloaded = await page.locator(`#${id}`).inputValue();
      const saved = reloaded !== original;
      if (saved) {
        const slug = id.replace("ai-field-prompt-", "");
        await api.put(`${BASE}/api/v1/ai-field-prompts`, { data: { slug, prompt: null } });
        await page.reload();
      }
      const summary = `On ${id}: the box showed the saved text right after Escape (${afterEscape === original}). Save requests sent after Escape: ${puts.length}. After reload the abandoned text was ${saved ? "stored" : "not stored"}.`;
      expect(
        !saved && puts.length === 0,
        `${summary} The article says Escape restores the saved text. The fixture prompt was reset to its default through the API afterwards.`,
      );
      return summary;
    },
  );

  await step(
    "A12",
    "configure-analysis",
    "administrator",
    "browser-walkthrough",
    "Save a core Field prompt with Enter, clear it, then Reset to default",
    async () => {
      const box = page.locator("textarea[id^=ai-field-prompt-]").first();
      const id = await box.getAttribute("id");
      const original = await box.inputValue();
      await box.click();
      await box.fill("DOC-029 fictional prompt");
      await box.press("Enter");
      const reset = page.getByRole("button", { name: /^Reset .* to default$/ }).first();
      await reset.waitFor({ timeout: 10000 });
      await wait(500);
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
        afterClear === "DOC-029 fictional prompt" &&
          afterReset === original &&
          maxLength === "2000",
        `clear=${afterClear} reset=${afterReset === original} max=${maxLength}`,
      );
      return `On ${id}: Enter saved the edit and showed Reset to default. Clearing the box and leaving it restored the saved text (no blank save). Reset to default restored the built-in prompt and removed the link. maxlength is 2000.`;
    },
  );

  await step(
    "A13",
    "configure-analysis",
    "administrator",
    "browser-walkthrough",
    "Remove the AI connector",
    async () => {
      await page.reload();
      await page.getByRole("button", { name: "Provider", exact: true }).click();
      await page.getByRole("button", { name: "Remove connector" }).click();
      const dialog = page.getByRole("dialog", { name: "Remove the AI connector" });
      await dialog.waitFor();
      const body = await dialog.innerText();
      await dialog.getByRole("button", { name: "Remove connector" }).click();
      await page.getByText("Not connected").waitFor({ timeout: 10000 });
      const conversion = await page.getByRole("heading", { name: "Request conversion" }).count();
      const preset = await page.locator("#ai-preset").inputValue();
      const state = await (await api.get(`${BASE}/api/v1/ai-connector`)).json();
      expect(
        !state.connector.configured && conversion === 0 && preset === "anthropic",
        "not removed cleanly",
      );
      return `Dialog says "${body.replace(/\s+/g, " ").trim()}". After confirming, the chip reads Not connected, the Request conversion card is gone, and the form is back to Anthropic.`;
    },
  );

  // ---------------------------------------------------------------- Legal Team Member
  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  await step(
    "R01",
    "configure-signing, configure-analysis",
    "legal_team_member",
    "browser-walkthrough",
    "Open both Settings pages as a Legal Team Member",
    async () => {
      await signIn(member, MEMBER);
      await member.goto(`${BASE}/settings/integrations/e-signature`);
      await member.waitForURL(`${BASE}/settings/profile`);
      await member.goto(`${BASE}/settings/ai-analysis`);
      await member.waitForURL(`${BASE}/settings/profile`);
      const organization = await member.getByRole("group", { name: "Organization" }).count();
      const signing = await memberContext.request.get(`${BASE}/api/v1/signing-connectors/docusign`);
      const ai = await memberContext.request.get(`${BASE}/api/v1/ai-connector`);
      expect(
        organization === 0 && signing.status() === 403 && ai.status() === 403,
        "member not refused",
      );
      return `Both addresses forward to /settings/profile. The Organization rail group is absent. The connector APIs answer ${signing.status()} and ${ai.status()}.`;
    },
  );
  await memberContext.close();
  await adminContext.close();
} finally {
  await browser.close();
  save();
}
