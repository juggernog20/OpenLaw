// DOC-029 independent walkthrough, group signing-standin, round 1.
// Article: docs/user-guides/electronic-signing.md. Scenario: V-C17-electronic.
// Written by the DOC-029 independent walkthrough agent (signing-standin, round 1) from the article text.
//
// Lab: the owned lab "sign-r1" (lab.mjs, app commit 3fa407e3) with the local DocuSign protocol
// stand-in from fixture/ applied by fixture/up.sh. The stand-in has no published port; this script
// reaches it on the lab's backend network address, found with `docker inspect`.
//
// Run from the repository root:
//   LAB_PASSWORD=... PHASE=main    mise exec -- node docs/documentation/batches/DOC-029/signing-standin/walkthrough-r1.mjs
//   LAB_PASSWORD=... PHASE=polling mise exec -- node docs/documentation/batches/DOC-029/signing-standin/walkthrough-r1.mjs
// The seed password comes only from the environment. The RSA key and the Connect secret are
// generated in memory for each main run and are never written. No cookie, link, or mail body is saved.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash, createHmac, generateKeyPairSync, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const require = createRequire(path.join(root, "e2e/package.json"));
const { chromium } = require("@playwright/test");

const PHASE = process.env.PHASE ?? "main";
const PASSWORD = process.env.LAB_PASSWORD;
if (!PASSWORD) throw new Error("LAB_PASSWORD is required");
const lab = JSON.parse(
  readFileSync(path.join(root, ".documentation-labs/sign-r1/lab.json"), "utf8"),
);
const BASE = lab.appUrl;
const MAIL = lab.mailUrl;
const PROJECT = lab.project;
const STANDIN_CONTAINER = `${PROJECT}-signing-standin-1`;
const STANDIN_IP = execFileSync("docker", [
  "--context",
  "default",
  "inspect",
  "-f",
  "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}",
  STANDIN_CONTAINER,
])
  .toString()
  .trim()
  .split(/\s+/)[0];
const STANDIN = `http://${STANDIN_IP}:8129`;
const STAMP = new Date()
  .toISOString()
  .replace(/[-:TZ.]/g, "")
  .slice(0, 14);
const OUT = path.join(here, `walkthrough-r1-${PHASE}.raw.json`);
const VIEWPORT = { width: 1280, height: 1800 };

const PEOPLE = {
  daniel: { email: "daniel.okafor@helix.example", name: "Daniel Okafor" },
  nadia: { email: "nadia.haddad@helix.example", name: "Nadia Haddad" },
  priya: { email: "priya.raman@helix.example", name: "Priya Raman" },
  marcus: { email: "marcus.oyelaran@helix.example", name: "Marcus Oyelaran" },
  ravi: { email: "ravi.menon@helix.example", name: "Ravi Menon" },
};

const results = {
  kind: "independent-article-walkthrough-raw",
  phase: PHASE,
  article: "electronic-signing",
  articleSha256: createHash("sha256")
    .update(readFileSync(path.join(root, "docs/user-guides/electronic-signing.md")))
    .digest("hex"),
  scenario: "V-C17-electronic",
  appCommit: lab.sourceCommit,
  environment: PROJECT,
  appImageId: lab.appImageId,
  engineImageId: lab.engineImageId,
  providerMode:
    "isolated local DocuSign protocol stand-in (fixture/server.mjs); no real provider account",
  stamp: STAMP,
  startedAt: new Date().toISOString(),
  steps: [],
  finishedAt: null,
};
function save() {
  results.finishedAt = new Date().toISOString();
  writeFileSync(OUT, `${JSON.stringify(results, null, 2)}\n`);
}

let failures = 0;
const blockedRoles = new Set();
async function step(role, actor, expected, fn) {
  if (blockedRoles.has(role)) {
    const skipped = {
      role,
      actor,
      method: "browser-walkthrough",
      expected,
      result: "not-run",
      actual: "Not run: an earlier step for this role failed.",
      at: new Date().toISOString(),
    };
    results.steps.push(skipped);
    console.log(`[${role}] NOT-RUN ${expected}`);
    save();
    return skipped;
  }
  const entry = {
    role,
    actor,
    method: "browser-walkthrough",
    expected,
    startedAt: new Date().toISOString(),
  };
  results.steps.push(entry);
  try {
    entry.actual = await fn();
    entry.result = "pass";
  } catch (error) {
    failures += 1;
    entry.actual = `Check did not complete: ${String(error?.message ?? error)
      .split("\n")
      .slice(0, 6)
      .join(" ")}`;
    entry.result = "fail";
    blockedRoles.add(role);
  }
  entry.at = new Date().toISOString();
  console.log(`[${role}] ${entry.result.toUpperCase()} ${expected}\n    ${entry.actual}`);
  save();
  return entry;
}
function expectThat(condition, message) {
  if (!condition) throw new Error(message);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, message, timeout = 60000, interval = 750) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(interval);
  }
  throw new Error(message);
}
const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");

// ---- stand-in and provider feed ----
async function standin(control, body) {
  const res = await fetch(`${STANDIN}/__control/${control}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}
let connectSecret = null;
async function deliver(providerEnvelopeId, status, extra = {}) {
  const body = JSON.stringify({
    event: `envelope-${status}`,
    data: {
      envelopeId: providerEnvelopeId,
      envelopeSummary: {
        status,
        ...(status === "declined" ? { declinedReason: extra.reason } : {}),
        ...(extra.completedAt ? { completedDateTime: extra.completedAt } : {}),
      },
    },
  });
  const signature = createHmac("sha256", connectSecret ?? randomBytes(16).toString("hex"))
    .update(body)
    .digest("base64");
  const res = await fetch(`${BASE}/api/v1/signing/docusign/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-docusign-signature-1": signature },
    body,
  });
  return res.status;
}

// ---- browser and API helpers ----
async function passwordSignIn(browser, person) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  await page.goto(`${BASE}/auth/login`);
  await page.getByLabel("Email").fill(person.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 30000 });
  return { context, page, person };
}
async function magicSignIn(browser, person) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  for (let attempt = 0; attempt < 4; attempt++) {
    const since = Date.now() - 2000;
    await page.goto(`${BASE}/auth/login`);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await page.getByLabel("Email").fill(person.email);
    await page
      .getByRole("button", { name: /Send|Email me/ })
      .last()
      .click();
    let href = null;
    for (let i = 0; i < 40 && !href; i++) {
      await sleep(750);
      const search = await fetch(
        `${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${person.email}"`)}`,
      ).then((r) => r.json());
      for (const m of search.messages ?? []) {
        if (new Date(m.Created).getTime() < since) continue;
        const message = await fetch(`${MAIL}/api/v1/message/${m.ID}`).then((r) => r.json());
        const match =
          message.Text?.match(/https?:\/\/[^\s)>\]]+magic[^\s)>\]]*/i) ??
          message.Text?.match(/https?:\/\/[^\s)>\]]+token=[^\s)>\]]*/);
        if (match) {
          const url = new URL(match[0]);
          const labUrl = new URL(BASE);
          url.protocol = labUrl.protocol;
          url.host = labUrl.host;
          href = url.toString();
          break;
        }
      }
    }
    if (!href) continue;
    await page.goto(href);
    try {
      await page.waitForURL((url) => url.pathname.startsWith("/portal"), { timeout: 20000 });
      return { context, page, person };
    } catch {
      // Ask again.
    }
  }
  throw new Error(`magic-link sign-in failed for ${person.email}`);
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
const signing = async (who, number) =>
  (await api(who, "GET", `/contracts/${number}/envelopes`)).json;
const paper = async (who, number) =>
  (await api(who, "GET", `/contracts/${number}/documents?includeArchived=true`)).json.documents;
const contractOf = async (who, number) =>
  (await api(who, "GET", `/contracts/${number}`)).json.contract;

function fictionalPdf(label) {
  return Buffer.from(
    `%PDF-1.4\n% DOC-029 signing-standin fictional paper: ${label}\n1 0 obj << >> endobj\n%%EOF\n`,
  );
}
async function upload(who, number, name, bytes, kind, note) {
  const r = await api(who, "POST", `/contracts/${number}/documents`, undefined, {
    kind,
    note,
    file: { name, mimeType: "application/pdf", buffer: bytes },
  });
  expectThat(r.status === 201, `upload ${name} answered ${r.status}`);
  return r.json.document ?? r.json;
}
async function addVersion(who, documentId, name, bytes, kind, note) {
  const r = await api(who, "POST", `/documents/${documentId}/versions`, undefined, {
    kind,
    note,
    file: { name, mimeType: "application/pdf", buffer: bytes },
  });
  expectThat(r.status === 201, `version ${name} answered ${r.status}`);
}

const card = (page) => page.getByRole("region", { name: "Approvals & signing" });
const sendButton = (page) => card(page).getByRole("button", { name: "Send for signature" });
const envelopeRows = (page) =>
  card(page).locator('table[aria-labelledby="contract-signing-heading"] tbody tr');
async function openApprovals(page, number) {
  await page.goto(`${BASE}/contracts/${number}`);
  await page
    .getByRole("navigation", { name: "Contract sections" })
    .getByRole("link", { name: "Approvals", exact: true })
    .click();
  await page.waitForURL(new RegExp(`/contracts/${number}/approvals$`));
  await card(page).waitFor({ timeout: 20000 });
  await page.waitForLoadState("networkidle").catch(() => {});
}
async function rowTexts(page) {
  const rows = envelopeRows(page);
  const n = await rows.count();
  const out = [];
  for (let i = 0; i < n; i++) out.push((await rows.nth(i).innerText()).replace(/\s+/g, " ").trim());
  return out;
}
async function moveStatus(page, number, statusName) {
  await page.goto(`${BASE}/contracts/${number}`);
  const control = page.getByRole("button", { name: /move contract$/ });
  await control.waitFor({ timeout: 20000 });
  const answered = page.waitForResponse(
    (r) => r.url().endsWith(`/api/v1/contracts/${number}`) && r.request().method() === "PATCH",
  );
  await control.click();
  await page
    .getByRole("menuitemradio")
    .filter({ hasText: new RegExp(`^${statusName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) })
    .first()
    .click();
  const res = await answered;
  expectThat(res.status() === 200, `status move answered ${res.status()}`);
}
async function openSendDialog(page) {
  await sendButton(page).click();
  const dialog = page.getByRole("dialog", { name: "Send for signature" });
  await dialog.waitFor();
  return dialog;
}
async function fillSigners(dialog, signers) {
  for (let i = 0; i < signers.length; i++) {
    if (i > 0) await dialog.getByRole("button", { name: "Add signer" }).click();
    await dialog.getByLabel(`Signer ${i + 1} name`).fill(signers[i].name);
    await dialog.getByLabel(`Signer ${i + 1} email`).fill(signers[i].email);
  }
}
async function sendEnvelope(page, number, { versionLabel, signers, subject }) {
  const dialog = await openSendDialog(page);
  if (versionLabel) await dialog.getByLabel("Version").selectOption({ label: versionLabel });
  await fillSigners(dialog, signers);
  if (subject) await dialog.getByLabel("Subject", { exact: true }).fill(subject);
  const sent = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/v1/contracts/${number}/envelopes`) && r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Send envelope" }).click();
  const res = await sent;
  return { dialog, status: res.status() };
}
const signersFor = (role, round) => [
  {
    name: `DOC-029 Signer One ${round}`,
    email: `signer.one.${role}.${round}@counterparty.example`,
  },
  {
    name: `DOC-029 Signer Two ${round}`,
    email: `signer.two.${role}.${round}@counterparty.example`,
  },
];
async function newestProviderEnvelope(before) {
  const state = await standin("state");
  expectThat(
    state.envelopes.length === before + 1,
    `provider holds ${state.envelopes.length} envelopes, expected ${before + 1}`,
  );
  return state.envelopes[state.envelopes.length - 1];
}

// ---- phases ----
async function main(browser) {
  const daniel = await passwordSignIn(browser, PEOPLE.daniel);
  const nadia = await passwordSignIn(browser, PEOPLE.nadia);
  const priya = await passwordSignIn(browser, PEOPLE.priya);
  const marcus = await passwordSignIn(browser, PEOPLE.marcus);
  const users = (await api(daniel, "GET", "/users")).json.users;
  const idOf = (person) => users.find((u) => u.email === person.email).id;
  const options = (await api(daniel, "GET", "/contracts/options")).json;
  const typeId = options.contractTypes.find((t) => t.displayName === "NDA").id;

  const flows = [
    {
      role: "legal_team_member",
      sender: nadia,
      owner: priya,
      unrelated: marcus,
      voider: daniel,
      voiderWhy: "Administrator who is neither sender nor Legal Owner",
      rival: priya,
    },
    {
      role: "administrator",
      sender: daniel,
      owner: nadia,
      unrelated: priya,
      voider: nadia,
      voiderWhy: "Legal Owner",
      rival: nadia,
    },
  ];

  await step(
    "administrator",
    PEOPLE.daniel.name,
    "The lab starts with no Signing connector",
    async () => {
      const c = (await api(daniel, "GET", "/signing-connectors/docusign")).json.connector;
      expectThat(!c.configured, "a connector is already configured");
      return `Connector configured=${c.configured}, enabled=${c.enabled}, updateMode default ${c.updateMode}`;
    },
  );

  // Prerequisite records.
  for (const flow of flows) {
    const title = `DOC-029 signing-standin ${flow.role} ${STAMP}`;
    const created = await api(flow.sender, "POST", "/contracts", {
      title,
      contractTypeId: typeId,
      managerId: idOf(flow.owner.person),
    });
    expectThat(created.status === 201, `create answered ${created.status}`);
    flow.number = created.json.contract.number;
    flow.title = title;
    flow.v1 = fictionalPdf(`${flow.role} primary version 1`);
    flow.v2 = fictionalPdf(`${flow.role} primary version 2`);
    flow.v1Name = `doc029-primary-${flow.role}.pdf`;
    flow.v2Name = `doc029-primary-v2-${flow.role}.pdf`;
    flow.supportName = `doc029-supporting-${flow.role}.pdf`;
    const noPaper = await api(flow.sender, "POST", "/contracts", {
      title: `DOC-029 signing-standin ${flow.role} no paper ${STAMP}`,
      contractTypeId: typeId,
    });
    flow.noPaperNumber = noPaper.json.contract.number;
    const team = await api(flow.sender, "POST", `/contracts/${flow.number}/team`, {
      userId: idOf(PEOPLE.ravi),
    });
    flow.raviOnTeam = team.status;
  }

  for (const flow of flows) {
    await step(
      flow.role,
      flow.sender.person.name,
      "Send for signature is absent with no connector configured, both before and after a primary Document exists",
      async () => {
        await openApprovals(flow.sender.page, flow.number);
        const before = await sendButton(flow.sender.page).count();
        const doc = await upload(
          flow.sender,
          flow.number,
          flow.v1Name,
          flow.v1,
          "draft_ours",
          "DOC-029 first round",
        );
        await addVersion(
          flow.sender,
          doc.id,
          flow.v2Name,
          flow.v2,
          "redline_theirs",
          "DOC-029 agreed round",
        );
        await upload(
          flow.sender,
          flow.number,
          flow.supportName,
          fictionalPdf(`${flow.role} supporting`),
          "draft_ours",
          "DOC-029 supporting paper",
        );
        await openApprovals(flow.sender.page, flow.number);
        const after = await sendButton(flow.sender.page).count();
        const s = await signing(flow.sender, flow.number);
        expectThat(before === 0 && after === 0, `Send for signature count ${before}/${after}`);
        expectThat(!s.signingConfigured && s.primaryDocument, "unexpected signing state");
        flow.documentId = s.primaryDocument.id;
        return `C-${flow.number}: no Send for signature without paper; after a primary Document (2 Versions) and a supporting Document it is still absent; API signingConfigured=false, primary ${s.primaryDocument.title}`;
      },
    );
  }

  // Administrator configures the connector (setup; the configure-signing guide owns these steps).
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  connectSecret = randomBytes(24).toString("base64url");
  await step(
    "administrator",
    PEOPLE.daniel.name,
    "Setup: the Administrator saves and enables a Webhook-mode DocuSign connector that points at the stand-in, and Test connection reaches it",
    async () => {
      const page = daniel.page;
      await page.goto(`${BASE}/settings/integrations/e-signature`);
      const docusign = page.getByRole("button", { name: "DocuSign", exact: true });
      await docusign.waitFor({ timeout: 20000 });
      if ((await docusign.getAttribute("aria-expanded")) === "false") await docusign.click();
      await page.getByLabel("Environment").selectOption("demo");
      const defaultMode = await page.getByLabel("Signing updates").inputValue();
      await page.getByLabel("Signing updates").selectOption("webhook");
      await page.getByLabel("Integration key").fill("doc029-standin-integration-key");
      await page.getByLabel("User ID").fill("doc029-standin-user");
      await page.getByLabel("RSA private key").fill(privateKey);
      await page.getByLabel("Connect HMAC secret").fill(connectSecret);
      const saved = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/v1/signing-connectors/docusign") && r.request().method() === "PUT",
      );
      await page.getByRole("button", { name: "Save connector" }).click();
      expectThat((await saved).status() === 200, "save refused");
      let c = (await api(daniel, "GET", "/signing-connectors/docusign")).json.connector;
      if (!c.enabled) {
        await page.getByRole("switch", { name: "Send for signature from records" }).click();
        await until(
          async () =>
            (await api(daniel, "GET", "/signing-connectors/docusign")).json.connector.enabled,
          "connector never enabled",
        );
      }
      await page.getByRole("button", { name: "Test connection" }).click();
      await page.getByText("Connected to DOC-029 signing stand-in.").waitFor({ timeout: 20000 });
      c = (await api(daniel, "GET", "/signing-connectors/docusign")).json.connector;
      return `Signing updates showed ${defaultMode} before the change; saved Demo/Webhook, enabled=${c.enabled}, updateMode=${c.updateMode}; Test connection said "Connected to DOC-029 signing stand-in."`;
    },
  );

  for (const flow of flows) {
    await step(
      flow.role,
      flow.sender.person.name,
      "With the connector enabled, Send for signature stays absent when no primary Document is set and appears when one is",
      async () => {
        await openApprovals(flow.sender.page, flow.noPaperNumber);
        const noPaper = await sendButton(flow.sender.page).count();
        await openApprovals(flow.sender.page, flow.number);
        const withPaper = await sendButton(flow.sender.page).count();
        expectThat(noPaper === 0 && withPaper === 1, `counts ${noPaper}/${withPaper}`);
        return `C-${flow.noPaperNumber} (no paper): Send for signature absent; C-${flow.number} (primary Document): Send for signature shown`;
      },
    );
  }

  await step(
    "administrator",
    PEOPLE.daniel.name,
    "Setup: the Administrator turns Send for signature from records off, then on again",
    async () => {
      const page = daniel.page;
      await page.goto(`${BASE}/settings/integrations/e-signature`);
      const docusign = page.getByRole("button", { name: "DocuSign", exact: true });
      await docusign.waitFor({ timeout: 20000 });
      if ((await docusign.getAttribute("aria-expanded")) === "false") await docusign.click();
      await page.getByRole("switch", { name: "Send for signature from records" }).click();
      await until(
        async () =>
          !(await api(daniel, "GET", "/signing-connectors/docusign")).json.connector.enabled,
        "connector never disabled",
      );
      const seen = [];
      for (const flow of flows) {
        await openApprovals(flow.sender.page, flow.number);
        seen.push(
          `${flow.role} C-${flow.number} disabled: ${await sendButton(flow.sender.page).count()} Send`,
        );
      }
      await page.goto(`${BASE}/settings/integrations/e-signature`);
      await docusign.waitFor({ timeout: 20000 });
      if ((await docusign.getAttribute("aria-expanded")) === "false") await docusign.click();
      await page.getByRole("switch", { name: "Send for signature from records" }).click();
      await until(
        async () =>
          (await api(daniel, "GET", "/signing-connectors/docusign")).json.connector.enabled,
        "connector never re-enabled",
      );
      for (const flow of flows) {
        await openApprovals(flow.sender.page, flow.number);
        seen.push(
          `${flow.role} C-${flow.number} enabled: ${await sendButton(flow.sender.page).count()} Send`,
        );
      }
      expectThat(
        seen.filter((s) => s.includes("disabled: 0")).length === 2 &&
          seen.filter((s) => s.includes("enabled: 1")).length === 2,
        seen.join("; "),
      );
      return seen.join("; ");
    },
  );

  for (const flow of flows) {
    const { role, sender, number } = flow;
    const page = sender.page;
    const v1Label = `Version 1 — ${flow.v1Name}`;
    const v2Current = `Version 2 — ${flow.v2Name} (current)`;

    await step(
      role,
      sender.person.name,
      "Before you start: the sender moves the Contract to the Signature Status Out for signature",
      async () => {
        await moveStatus(page, number, "Out for signature");
        const c = await contractOf(sender, number);
        expectThat(c.stage === "signature", `stage ${c.stage}`);
        return `Status ${c.statusName} (stage ${c.stage})`;
      },
    );

    await step(
      role,
      sender.person.name,
      "Send the Envelope steps 1-3 and 5: Approvals > Send for signature opens the dialog; Version lists only primary Document Versions with the current one selected; empty and duplicate Signers are refused; Add signer and remove work; Cancel sends nothing",
      async () => {
        const providerBefore = await standin("state");
        await openApprovals(page, number);
        const dialog = await openSendDialog(page);
        const optionTexts = (
          await dialog.getByLabel("Version").locator("option").allInnerTexts()
        ).map((t) => t.trim());
        const selected = await dialog
          .getByLabel("Version")
          .evaluate((el) => el.options[el.selectedIndex].text);
        const versionHelp = await dialog
          .getByText("Only the primary document goes out. Attachments are not sent.")
          .count();
        const signersHelp = await dialog
          .getByText("Everyone you name is asked at once. They sign in any order.")
          .count();
        expectThat(
          optionTexts.length === 2 && optionTexts[0] === v2Current && optionTexts[1] === v1Label,
          `options ${optionTexts.join(" | ")}`,
        );
        expectThat(selected === v2Current, `selected ${selected}`);
        expectThat(
          !optionTexts.some((t) => t.includes("supporting")),
          "supporting Document offered",
        );
        await dialog.getByRole("button", { name: "Send envelope" }).click();
        const emptyAlert = (await dialog.getByRole("alert").innerText()).trim();
        expectThat(
          emptyAlert === "Give every signer a name and an email address.",
          `empty alert ${emptyAlert}`,
        );
        await fillSigners(dialog, [
          { name: "DOC-029 Duplicate One", email: `dup.${role}@counterparty.example` },
          { name: "DOC-029 Duplicate Two", email: `dup.${role}@counterparty.example` },
          { name: "DOC-029 Unwanted Row", email: `unwanted.${role}@counterparty.example` },
        ]);
        await dialog.getByRole("button", { name: "Remove signer 3" }).click();
        const rowsAfterRemove = await dialog.getByLabel(/^Signer \d+ name$/).count();
        await dialog.getByRole("button", { name: "Send envelope" }).click();
        await until(
          async () =>
            (await dialog.getByRole("alert").count()) > 0 &&
            (await dialog.getByRole("alert").innerText()).trim() !== "",
          "no duplicate alert",
        );
        const dupAlert = (await dialog.getByRole("alert").innerText()).trim();
        expectThat(
          dupAlert === "Each signer needs their own email address.",
          `duplicate alert ${dupAlert}`,
        );
        await dialog.getByRole("button", { name: "Cancel" }).click();
        await dialog.waitFor({ state: "hidden" });
        const s = await signing(sender, number);
        const providerAfter = await standin("state");
        expectThat(rowsAfterRemove === 2, `rows after remove ${rowsAfterRemove}`);
        expectThat(s.envelopes.length === 0, "an Envelope was recorded");
        expectThat(
          providerAfter.envelopes.length === providerBefore.envelopes.length,
          "the provider holds a new envelope",
        );
        return `Version options: ${optionTexts.join(" | ")}; selected "${selected}"; help texts shown ${versionHelp}/${signersHelp}; empty Signers: "${emptyAlert}"; Remove signer 3 left ${rowsAfterRemove} rows; duplicate address: "${dupAlert}"; Cancel closed the dialog with 0 Envelopes in the app and ${providerAfter.envelopes.length} (unchanged) at the provider`;
      },
    );

    await step(
      role,
      sender.person.name,
      "If sending fails: during a provider outage the dialog shows the error and no round exists; after reload the retry sends Version 1 with a blank Subject; the row shows Out for signature, Version, Signers and sent time; the provider receives only that primary PDF with subject C-<number> <title>; the Status does not move",
      async () => {
        const before = (await standin("state")).envelopes.length;
        await standin("faults", { outage: true });
        await openApprovals(page, number);
        const attempt = await sendEnvelope(page, number, {
          versionLabel: v1Label,
          signers: signersFor(role, "r1"),
        });
        await until(
          async () => (await attempt.dialog.getByRole("alert").count()) > 0,
          "no outage alert",
        );
        const outageAlert = (await attempt.dialog.getByRole("alert").innerText()).trim();
        const duringOutage = (await signing(sender, number)).envelopes.length;
        await attempt.dialog.getByRole("button", { name: "Cancel" }).click();
        await standin("faults", { outage: false });
        await openApprovals(page, number); // reload the Envelope list before retrying
        const rowsAfterReload = await envelopeRows(page).count();
        expectThat(duringOutage === 0 && rowsAfterReload === 0, "a round exists after the outage");
        const retry = await sendEnvelope(page, number, {
          versionLabel: v1Label,
          signers: signersFor(role, "r1"),
        });
        expectThat(retry.status === 201, `retry answered ${retry.status}`);
        await retry.dialog.waitFor({ state: "hidden" });
        const rows = await rowTexts(page);
        const header = await page.getByText("Envelope sent", { exact: true }).count();
        const note = await card(page)
          .getByText(
            "Signed, declined, and voided status arrives by webhook. The executed file auto-files and the stage advances to Active.",
          )
          .count();
        const provider = await newestProviderEnvelope(before);
        const c = await contractOf(sender, number);
        expectThat(
          rows.length === 1 &&
            rows[0].includes("Out for signature") &&
            rows[0].includes("Version 1") &&
            rows[0].includes(`by ${sender.person.name}`),
          `row ${rows[0]}`,
        );
        for (const signer of signersFor(role, "r1"))
          expectThat(
            rows[0].includes(signer.name) && rows[0].includes(signer.email),
            "signer missing from row",
          );
        expectThat(header === 1, "header does not say Envelope sent");
        expectThat(provider.subject === `C-${number} ${flow.title}`, `subject ${provider.subject}`);
        expectThat(
          provider.documentSha256 === sha(flow.v1) && provider.documentCount === 1,
          "provider paper differs from Version 1",
        );
        expectThat(
          provider.signers.length === 2 &&
            new Set(provider.signers.map((s) => s.routingOrder)).size === 1,
          "signers not asked at once",
        );
        expectThat(c.stage === "signature", `stage ${c.stage}`);
        flow.liveProviderId = provider.id;
        return `Outage alert: "${outageAlert}"; 0 rounds in app and after reload; retry row: "${rows[0]}"; header Envelope sent; note under live row: "${note ? "Signed, declined, and voided status arrives by webhook. …" : "absent"}"; provider envelope subject "${provider.subject}", ${provider.documentCount} document equal to Version 1 bytes, 2 fictional Signers with the same routingOrder ${provider.signers[0].routingOrder}; Status still ${c.statusName}`;
      },
    );

    await step(
      role,
      sender.person.name,
      "One live Envelope only: Send for signature is absent while it is out, and a direct second send is refused",
      async () => {
        await openApprovals(page, number);
        const count = await sendButton(page).count();
        const second = await api(sender, "POST", `/contracts/${number}/envelopes`, {
          documentVersionId: (await signing(sender, number)).primaryDocument.versions[0].id,
          signers: signersFor(role, "second"),
        });
        expectThat(count === 0 && second.status === 409, `button ${count}, API ${second.status}`);
        return `Send for signature absent; direct second send answered ${second.status}: "${second.json?.detail ?? second.json?.title}"`;
      },
    );

    await step(
      role,
      `${flow.unrelated.person.name}, ${sender.person.name}, ${flow.voider.person.name}`,
      `Withdraw: an unrelated Legal Team Member has no envelope actions and cannot void; the sender has the actions; the ${flow.voiderWhy} voids with a required Reason, Cancel keeps the round, and a Voided round frees a new send without moving the Status`,
      async () => {
        const envelopeId = (await signing(sender, number)).envelopes[0].id;
        await openApprovals(flow.unrelated.page, number);
        const unrelatedActions = await card(flow.unrelated.page)
          .getByRole("button", { name: /^Actions for the envelope sent on/ })
          .count();
        const unrelatedVoid = await api(flow.unrelated, "POST", `/envelopes/${envelopeId}/void`, {
          reason: "DOC-029 should be refused",
        });
        await openApprovals(page, number);
        const senderActions = await card(page)
          .getByRole("button", { name: /^Actions for the envelope sent on/ })
          .count();
        expectThat(
          unrelatedActions === 0 && unrelatedVoid.status === 403 && senderActions === 1,
          `unrelated ${unrelatedActions}/${unrelatedVoid.status}, sender ${senderActions}`,
        );
        const vp = flow.voider.page;
        await openApprovals(vp, number);
        await card(vp)
          .getByRole("button", { name: /^Actions for the envelope sent on/ })
          .click();
        await vp.getByRole("menuitem", { name: "Void envelope" }).click();
        let dialog = vp.getByRole("dialog", { name: "Void envelope" });
        await dialog.waitFor();
        await dialog.getByRole("button", { name: "Void envelope" }).click();
        await until(async () => (await dialog.getByRole("alert").count()) > 0, "no reason alert");
        const reasonAlert = (await dialog.getByRole("alert").innerText()).trim();
        await dialog.getByRole("button", { name: "Cancel" }).click();
        await dialog.waitFor({ state: "hidden" });
        const afterCancel = (await signing(sender, number)).envelopes[0].status;
        await card(vp)
          .getByRole("button", { name: /^Actions for the envelope sent on/ })
          .click();
        await vp.getByRole("menuitem", { name: "Void envelope" }).click();
        dialog = vp.getByRole("dialog", { name: "Void envelope" });
        const reason = `DOC-029 wrong signatory ${role} ${STAMP}`;
        await dialog.getByLabel("Reason").fill(reason);
        const voided = vp.waitForResponse((r) => r.url().endsWith(`/envelopes/${envelopeId}/void`));
        await dialog.getByRole("button", { name: "Void envelope" }).click();
        const voidStatus = (await voided).status();
        await dialog.waitFor({ state: "hidden" });
        await openApprovals(page, number);
        const rows = await rowTexts(page);
        const header = await page.getByText("Envelope voided", { exact: true }).count();
        const sendAgain = await sendButton(page).count();
        const provider = (await standin("state")).envelopes.find(
          (e) => e.id === flow.liveProviderId,
        );
        const c = await contractOf(sender, number);
        expectThat(
          reasonAlert === "Say why this envelope is being voided.",
          `reason alert ${reasonAlert}`,
        );
        expectThat(
          afterCancel === "sent" && voidStatus === 200,
          `cancel ${afterCancel}, void ${voidStatus}`,
        );
        expectThat(rows[0].includes("Voided") && rows[0].includes(reason), `row ${rows[0]}`);
        expectThat(
          sendAgain === 1 &&
            provider.status === "voided" &&
            provider.voidedReason === reason &&
            c.stage === "signature",
          "after void",
        );
        return `${flow.unrelated.person.name}: 0 envelope actions, void answered ${unrelatedVoid.status}; sender ${sender.person.name}: actions menu shown; ${flow.voider.person.name} (${flow.voiderWhy}): empty Reason refused with "${reasonAlert}", Cancel kept status ${afterCancel}, confirm answered ${voidStatus}; row "${rows[0]}"; header Envelope voided ${header}; provider status ${provider.status} with the reason; Send for signature shown again; Status still ${c.statusName}`;
      },
    );

    await step(
      role,
      sender.person.name,
      "Decline: a provider-reported Declined round records its reason, keeps the Voided round in history, files nothing, does not end or archive the Contract, and allows another send",
      async () => {
        const before = (await standin("state")).envelopes.length;
        const versionsBefore = (await paper(sender, number)).find((d) => d.id === flow.documentId)
          .versions.length;
        await openApprovals(page, number);
        const sent = await sendEnvelope(page, number, {
          signers: signersFor(role, "r2"),
          subject: `DOC-029 signing-standin ${role} decline round`,
        });
        expectThat(sent.status === 201, `send answered ${sent.status}`);
        const provider = await newestProviderEnvelope(before);
        const reason = `DOC-029 fictional signer declined ${STAMP}`;
        await standin("decline", { id: provider.id, reason });
        const webhook = await deliver(provider.id, "declined", {
          reason,
          completedAt: new Date().toISOString(),
        });
        await openApprovals(page, number);
        const rows = await rowTexts(page);
        const header = await page.getByText("Envelope declined", { exact: true }).count();
        const docs = await paper(sender, number);
        const versionsAfter = docs.find((d) => d.id === flow.documentId).versions.length;
        const c = await contractOf(sender, number);
        const sendAgain = await sendButton(page).count();
        expectThat(webhook === 204, `webhook ${webhook}`);
        expectThat(
          rows.length === 2 &&
            rows[0].includes("Declined") &&
            rows[0].includes(reason) &&
            rows[1].includes("Voided"),
          rows.join(" / "),
        );
        expectThat(
          versionsAfter === versionsBefore &&
            c.stage === "signature" &&
            !c.archivedAt &&
            sendAgain === 1 &&
            header === 1,
          "after decline",
        );
        return `Signed provider decline delivery answered ${webhook}; rows: "${rows[0]}" / "${rows[1]}"; header Envelope declined; primary Document still ${versionsAfter} Versions; Status ${c.statusName}, archivedAt ${c.archivedAt ?? null}; Send for signature shown`;
      },
    );

    await step(
      role,
      `${sender.person.name}, ${flow.rival.person.name}`,
      "If another sender won: with both dialogs open, the second send is refused in the dialog, and reloading shows the winner's live round instead of creating another",
      async () => {
        const before = (await standin("state")).envelopes.length;
        await openApprovals(page, number);
        await openApprovals(flow.rival.page, number);
        const rivalDialog = await openSendDialog(flow.rival.page);
        await fillSigners(rivalDialog, signersFor(role, "rival"));
        const sent = await sendEnvelope(page, number, {
          signers: signersFor(role, "r3"),
          subject: `DOC-029 signing-standin ${role} completion round`,
        });
        expectThat(sent.status === 201, `winner send ${sent.status}`);
        await sent.dialog.waitFor({ state: "hidden" });
        await rivalDialog.getByRole("button", { name: "Send envelope" }).click();
        await until(
          async () => (await rivalDialog.getByRole("alert").count()) > 0,
          "no refusal in rival dialog",
        );
        const refusal = (await rivalDialog.getByRole("alert").innerText()).trim();
        await rivalDialog.getByRole("button", { name: "Cancel" }).click();
        await openApprovals(flow.rival.page, number);
        const rows = await rowTexts(flow.rival.page);
        const after = (await standin("state")).envelopes.length;
        expectThat(
          rows[0].includes("Out for signature") &&
            rows[0].includes(`by ${sender.person.name}`) &&
            after === before + 1,
          `rows ${rows[0]}, provider ${before}->${after}`,
        );
        flow.liveProviderId = (await standin("state")).envelopes[after - 1].id;
        return `${flow.rival.person.name}'s later send showed "${refusal}"; after reload the first row reads "${rows[0]}"; the provider holds ${after - before} new envelope`;
      },
    );

    await step(
      role,
      sender.person.name,
      "Follow completion: a provider-reported completion shows Signed, then Executed copy; the executed PDF equals the provider's output, is filed once as the pinned executed Version on the primary Document chain, the supporting Document is untouched, and the Contract moves to Active; a repeated delivery adds nothing",
      async () => {
        const providerState = (await standin("state")).envelopes.find(
          (e) => e.id === flow.liveProviderId,
        );
        await standin("complete", { id: flow.liveProviderId });
        const webhook = await deliver(flow.liveProviderId, "completed", {
          completedAt: new Date().toISOString(),
        });
        const immediately = (await signing(sender, number)).envelopes[0];
        await openApprovals(page, number);
        const firstRead = (await rowTexts(page))[0];
        await until(
          async () => {
            await openApprovals(page, number);
            return (await card(page).getByRole("link", { name: "Executed copy" }).count()) === 1;
          },
          "Executed copy never appeared",
          120000,
          2000,
        );
        const rows = await rowTexts(page);
        const header = await page.getByText("Envelope signed", { exact: true }).count();
        const link = card(page).getByRole("link", { name: "Executed copy" });
        const href = await link.getAttribute("href");
        const downloadPromise = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
        await link.click();
        const download = await downloadPromise;
        let openedSha = null;
        if (download) openedSha = sha(readFileSync(await download.path()));
        const fetched = await page.request.get(`${BASE}${href}`);
        const fetchedSha = sha(await fetched.body());
        const docs = await paper(sender, number);
        const primary = docs.find((d) => d.id === flow.documentId);
        const supporting = docs.find((d) => d.id !== flow.documentId);
        const chain = [...primary.versions].sort((a, b) => a.versionNumber - b.versionNumber);
        const executed = chain[chain.length - 1];
        const c = await contractOf(sender, number);
        await page.goto(`${BASE}/contracts/${number}/documents`);
        const docsRegion = page.getByRole("region", { name: "Documents" });
        await docsRegion.waitFor();
        const primaryRow = (
          await docsRegion.getByRole("row").filter({ hasText: flow.v1Name }).first().innerText()
        ).replace(/\s+/g, " ");
        await docsRegion.getByRole("button", { name: `Actions for ${flow.v1Name}` }).click();
        const unmark = await page
          .getByRole("menuitem", { name: "Unmark as executed copy" })
          .count();
        await page.keyboard.press("Escape");
        const repeat = await deliver(flow.liveProviderId, "completed", {
          completedAt: new Date().toISOString(),
        });
        await sleep(4000);
        const docsAgain = await paper(sender, number);
        const envelopesAgain = (await signing(sender, number)).envelopes.length;
        expectThat(webhook === 204 && repeat === 204, `webhooks ${webhook}/${repeat}`);
        expectThat(rows[0].includes("Signed") && header === 1, `row ${rows[0]}`);
        expectThat(
          fetchedSha === providerState.executedSha256 &&
            (openedSha === null || openedSha === providerState.executedSha256),
          "executed bytes differ",
        );
        expectThat(
          executed.kind === "executed" &&
            executed.isExecuted &&
            executed.isCurrent &&
            chain.length === 3,
          `chain ${JSON.stringify(chain.map((v) => [v.versionNumber, v.kind, v.isExecuted]))}`,
        );
        expectThat(
          supporting.versions.length === 1 && !supporting.versions.some((v) => v.isExecuted),
          "supporting Document changed",
        );
        expectThat(c.stage === "active" && c.statusName === "Active", `status ${c.statusName}`);
        expectThat(unmark === 1, "no Unmark as executed copy");
        expectThat(
          docsAgain.find((d) => d.id === flow.documentId).versions.length === 3 &&
            envelopesAgain === 3,
          "repeat delivery changed something",
        );
        flow.executedCount = 1;
        return `Completion delivery answered ${webhook}; API right after: status ${immediately.status}, executedFetch ${immediately.executedFetch}; first page read: "${firstRead}"; final row: "${rows[0]}"; header Envelope signed; Executed copy ${download ? "opened as a download" : "link followed"} and its bytes equal the provider output; primary Document Version ${executed.versionNumber} "${executed.originalFilename}" kind executed, current, designated; Documents row "${primaryRow.slice(0, 120)}" with Unmark as executed copy; supporting Document still 1 Version; Status ${c.statusName}; repeated delivery answered ${repeat} and added no Version or Envelope`;
      },
    );

    await step(
      role,
      sender.person.name,
      "If someone moved the Contract to another Stage before completion, filing still pins the executed Version but completion does not overwrite that Stage",
      async () => {
        await moveStatus(page, number, "Out for signature");
        const before = (await standin("state")).envelopes.length;
        await openApprovals(page, number);
        const sent = await sendEnvelope(page, number, { signers: signersFor(role, "r4") });
        expectThat(sent.status === 201, `send ${sent.status}`);
        const provider = await newestProviderEnvelope(before);
        await moveStatus(page, number, "Internal review");
        await standin("complete", { id: provider.id });
        const webhook = await deliver(provider.id, "completed", {
          completedAt: new Date().toISOString(),
        });
        await until(
          async () => (await signing(sender, number)).envelopes[0].executedFetch === "ready",
          "never filed",
          120000,
          1500,
        );
        const chain = [
          ...(await paper(sender, number)).find((d) => d.id === flow.documentId).versions,
        ].sort((a, b) => a.versionNumber - b.versionNumber);
        const last = chain[chain.length - 1];
        const c = await contractOf(sender, number);
        expectThat(
          webhook === 204 &&
            last.versionNumber === 4 &&
            last.isExecuted &&
            last.isCurrent &&
            c.statusName === "Internal review",
          `v${last.versionNumber} ${c.statusName}`,
        );
        return `Moved to Internal review after sending; completion (${webhook}) filed Version ${last.versionNumber} as current and designated executed; Status stayed ${c.statusName}`;
      },
    );

    await step(
      role,
      sender.person.name,
      "If voiding is refused because the provider already completed the round: the dialog shows the refusal; after the provider's feed arrives, reloading shows the recorded Signed outcome",
      async () => {
        const before = (await standin("state")).envelopes.length;
        await openApprovals(page, number);
        const sent = await sendEnvelope(page, number, { signers: signersFor(role, "r5") });
        expectThat(sent.status === 201, `send ${sent.status}`);
        await sent.dialog.waitFor({ state: "hidden" });
        const provider = await newestProviderEnvelope(before);
        await standin("complete", { id: provider.id });
        await card(page)
          .getByRole("button", { name: /^Actions for the envelope sent on/ })
          .first()
          .click();
        await page.getByRole("menuitem", { name: "Void envelope" }).click();
        const dialog = page.getByRole("dialog", { name: "Void envelope" });
        await dialog.getByLabel("Reason").fill("DOC-029 late void attempt");
        await dialog.getByRole("button", { name: "Void envelope" }).click();
        await until(async () => (await dialog.getByRole("alert").count()) > 0, "no refusal");
        const refusal = (await dialog.getByRole("alert").innerText()).trim();
        await dialog.getByRole("button", { name: "Cancel" }).click();
        await openApprovals(page, number);
        const reloadedBeforeFeed = (await rowTexts(page))[0];
        const webhook = await deliver(provider.id, "completed", {
          completedAt: new Date().toISOString(),
        });
        await openApprovals(page, number);
        const reloadedAfterFeed = (await rowTexts(page))[0];
        expectThat(
          refusal.startsWith("The provider says this envelope is no longer live") &&
            reloadedAfterFeed.includes("Signed"),
          `${refusal} / ${reloadedAfterFeed}`,
        );
        await until(
          async () => (await signing(sender, number)).envelopes[0].executedFetch === "ready",
          "never filed",
          120000,
          1500,
        );
        return `Void refused in the dialog: "${refusal}"; reload before the provider feed: "${reloadedBeforeFeed}"; after the feed (${webhook}) and reload: "${reloadedAfterFeed}"`;
      },
    );

    await step(
      role,
      sender.person.name,
      "If the row says the executed copy could not be filed: a Signed round whose executed file cannot be fetched shows that message and creates no Version",
      async () => {
        await standin("faults", { combinedRefused: true });
        try {
          const before = (await standin("state")).envelopes.length;
          const versionsBefore = (await paper(sender, number)).find((d) => d.id === flow.documentId)
            .versions.length;
          await openApprovals(page, number);
          const sent = await sendEnvelope(page, number, { signers: signersFor(role, "r6") });
          expectThat(sent.status === 201, `send ${sent.status}`);
          const provider = await newestProviderEnvelope(before);
          await standin("complete", { id: provider.id });
          const webhook = await deliver(provider.id, "completed", {
            completedAt: new Date().toISOString(),
          });
          await until(
            async () => (await signing(sender, number)).envelopes[0].executedFetch === "failed",
            "never recorded the failure",
            120000,
            1500,
          );
          await openApprovals(page, number);
          const row = (await rowTexts(page))[0];
          const versionsAfter = (await paper(sender, number)).find((d) => d.id === flow.documentId)
            .versions.length;
          expectThat(
            row.includes("Signed") &&
              row.includes(
                "The executed copy could not be filed. Upload it to the record instead.",
              ) &&
              versionsAfter === versionsBefore,
            row,
          );
          return `Delivery ${webhook}; row: "${row}"; primary Document still ${versionsAfter} Versions`;
        } finally {
          await standin("faults", { combinedRefused: false });
        }
      },
    );

    await step(
      role,
      `${PEOPLE.ravi.name} (Business User on the team)`,
      "Negative: a Business User on the Contract team cannot read or send Envelopes",
      async () => {
        const ravi = await magicSignIn(browser, PEOPLE.ravi);
        try {
          const read = await api(ravi, "GET", `/contracts/${number}/envelopes`);
          const send = await api(ravi, "POST", `/contracts/${number}/envelopes`, {
            documentVersionId: "x",
            signers: signersFor(role, "ravi"),
          });
          expectThat(
            read.status === 403 && send.status === 403,
            `read ${read.status}, send ${send.status}`,
          );
          return `Team add answered ${flow.raviOnTeam}; Ravi Menon signed in by a fresh magic link to the Portal; envelope read answered ${read.status}, send answered ${send.status}`;
        } finally {
          await ravi.context.close();
        }
      },
    );

    await step(
      role,
      sender.person.name,
      "Send for signature is absent on an archived Contract; its recorded rounds stay readable",
      async () => {
        const arch = await api(sender, "POST", `/contracts/${number}/archive`);
        expectThat(arch.status === 200, `archive ${arch.status}`);
        try {
          await openApprovals(page, number);
          const rows = await envelopeRows(page).count();
          const send = await sendButton(page).count();
          const actions = await card(page)
            .getByRole("button", { name: /^Actions for the envelope sent on/ })
            .count();
          const direct = await api(sender, "POST", `/contracts/${number}/envelopes`, {
            documentVersionId:
              (await signing(sender, number)).primaryDocument?.versions?.[0]?.id ?? "x",
            signers: signersFor(role, "archived"),
          });
          expectThat(
            send === 0 && rows >= 6 && direct.status === 409,
            `send ${send}, rows ${rows}, direct ${direct.status}`,
          );
          return `Archived C-${number}: ${rows} rounds readable, Send for signature absent, ${actions} envelope actions, direct send answered ${direct.status}`;
        } finally {
          const restored = await api(sender, "POST", `/contracts/${number}/restore`);
          expectThat(restored.status === 200, `restore ${restored.status}`);
        }
      },
    );
  }
  results.contracts = flows.map((f) => ({
    role: f.role,
    number: f.number,
    noPaperNumber: f.noPaperNumber,
    title: f.title,
  }));
  for (const who of [daniel, nadia, priya, marcus]) await who.context.close();
}

async function polling(browser) {
  const daniel = await passwordSignIn(browser, PEOPLE.daniel);
  const nadia = await passwordSignIn(browser, PEOPLE.nadia);
  const options = (await api(daniel, "GET", "/contracts/options")).json;
  const typeId = options.contractTypes.find((t) => t.displayName === "NDA").id;
  await step(
    "administrator",
    PEOPLE.daniel.name,
    "Setup: the Administrator switches Signing updates to Polling",
    async () => {
      const page = daniel.page;
      await page.goto(`${BASE}/settings/integrations/e-signature`);
      const docusign = page.getByRole("button", { name: "DocuSign", exact: true });
      await docusign.waitFor({ timeout: 20000 });
      if ((await docusign.getAttribute("aria-expanded")) === "false") await docusign.click();
      await page.getByLabel("Signing updates").selectOption("polling");
      const hint = await page
        .getByText(/Updates can take about 15 to 20 minutes while the worker is running/)
        .count();
      const saved = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/v1/signing-connectors/docusign") && r.request().method() === "PUT",
      );
      await page.getByRole("button", { name: "Save connector" }).click();
      expectThat((await saved).status() === 200, "save refused");
      const c = (await api(daniel, "GET", "/signing-connectors/docusign")).json.connector;
      expectThat(
        c.updateMode === "polling" && c.enabled,
        JSON.stringify({ mode: c.updateMode, enabled: c.enabled }),
      );
      return `Saved updateMode ${c.updateMode}; the Polling hint about 15 to 20 minutes is shown (${hint})`;
    },
  );
  const title = `DOC-029 signing-standin polling ${STAMP}`;
  const created = await api(nadia, "POST", "/contracts", { title, contractTypeId: typeId });
  const number = created.json.contract.number;
  const bytes = fictionalPdf("polling primary");
  await upload(nadia, number, "doc029-polling.pdf", bytes, "draft_ours", "DOC-029 polling round");
  let providerId;
  let completedAt;
  await step(
    "legal_team_member",
    PEOPLE.nadia.name,
    "Polling: the live row still carries the webhook note; a completion reported only at the provider reaches the row without a webhook, within about 15 to 20 minutes while the worker runs",
    async () => {
      await moveStatus(nadia.page, number, "Out for signature");
      const before = (await standin("state")).envelopes.length;
      await openApprovals(nadia.page, number);
      const sent = await sendEnvelope(nadia.page, number, { signers: signersFor("polling", "p1") });
      expectThat(sent.status === 201, `send ${sent.status}`);
      const sentAt = Date.now();
      const note = await card(nadia.page)
        .getByText(
          "Signed, declined, and voided status arrives by webhook. The executed file auto-files and the stage advances to Active.",
        )
        .count();
      const provider = await newestProviderEnvelope(before);
      providerId = provider.id;
      await standin("complete", { id: providerId });
      completedAt = Date.now();
      const refused = await deliver(providerId, "completed", {
        completedAt: new Date().toISOString(),
      });
      await until(
        async () => (await signing(nadia, number)).envelopes[0].status === "signed",
        "polling never reported completion within 30 minutes",
        30 * 60 * 1000,
        30000,
      );
      const signedAt = Date.now();
      await until(
        async () => (await signing(nadia, number)).envelopes[0].executedFetch === "ready",
        "never filed",
        300000,
        5000,
      );
      await openApprovals(nadia.page, number);
      const row = (await rowTexts(nadia.page))[0];
      const c = await contractOf(nadia, number);
      const minutes = ((signedAt - completedAt) / 60000).toFixed(1);
      expectThat(row.includes("Signed") && c.stage === "active", `${row} ${c.statusName}`);
      return `C-${number}: webhook note under the live row shown (${note}); a signed delivery in Polling mode answered ${refused}; with no delivery accepted, the record read Signed ${minutes} minutes after the provider completion (${((signedAt - sentAt) / 60000).toFixed(1)} minutes after sending); row "${row}"; Status ${c.statusName}`;
    },
  );
  results.contracts = [{ role: "polling", number, title }];
  await daniel.context.close();
  await nadia.context.close();
}

const browser = await chromium.launch({ headless: true });
try {
  if (PHASE === "main") await main(browser);
  else if (PHASE === "polling") await polling(browser);
  else throw new Error(`unknown PHASE ${PHASE}`);
} catch (error) {
  failures += 1;
  results.fatal = String(error?.message ?? error)
    .split("\n")
    .slice(0, 6)
    .join(" ");
  console.error(results.fatal);
} finally {
  save();
  await browser.close();
}
process.exitCode = failures ? 1 : 0;
