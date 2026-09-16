// DOC-029r2 replay of the round 1 credential-free checks for configure-signing (C42) only.
// Adapted from live-provider/credential-free-checks.mjs: lab URL defaults to admin2, the AI analysis
// steps (another article) are left out, and R01 checks only the E-signature page.
// It checks what the E-signature Settings page does before any real provider account is entered.
// Run from the repository root:
//   LAB_ADMIN_EMAIL=... LAB_ADMIN_PASSWORD=... LAB_MEMBER_EMAIL=... \
//     mise exec -- node docs/documentation/batches/DOC-029/compat-r2/live-provider-r2/credential-free-checks-r2.mjs
// Credentials come only from the environment. The results never contain them.
// Every provider value in this script is fictional. No request goes to DocuSign: the RSA key
// text cannot be parsed, so signing fails before any network call.
import { createRequire } from "node:module";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../../..");
const require = createRequire(path.join(root, "e2e/package.json"));
const { chromium } = require("@playwright/test");
const BASE = process.env.LAB_APP_URL ?? "http://127.0.0.1:23300";
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
const OUT = process.env.OUT ?? path.join(here, "credential-free-observations-r2.json");

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

  // Start from the base lab's state: no signing connector. Refuse to run otherwise.
  {
    const signing = await (await api.get(`${BASE}/api/v1/signing-connectors/docusign`)).json();
    if (signing.connector.configured)
      throw new Error(
        "A signing connector already exists in this lab. These checks need the unconfigured state.",
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


  // ---------------------------------------------------------------- Legal Team Member
  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  await step(
    "R01",
    "configure-signing",
    "legal_team_member",
    "browser-walkthrough",
    "Open the E-signature Settings page as a Legal Team Member",
    async () => {
      await signIn(member, MEMBER);
      await member.goto(`${BASE}/settings/integrations/e-signature`);
      await member.waitForURL(`${BASE}/settings/profile`);
      const organization = await member.getByRole("group", { name: "Organization" }).count();
      const signing = await memberContext.request.get(`${BASE}/api/v1/signing-connectors/docusign`);
      expect(organization === 0 && signing.status() === 403, "member not refused");
      return `The address forwards to /settings/profile. The Organization rail group is absent. The connector API answers ${signing.status()}.`;
    },
  );
  await memberContext.close();
  await adminContext.close();
} finally {
  await browser.close();
  save();
}
