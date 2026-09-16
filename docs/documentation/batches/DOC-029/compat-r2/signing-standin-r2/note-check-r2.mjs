// DOC-029 round 2 compatibility replay, extra check by the DOC-029r2 compatibility reviewer (signing-standin).
// The Polling phase of walkthrough-r2.mjs counted the webhook note right after the send answered and got 0
// (round 1 got 1). This check waits for the live row to render, then counts the note in the browser, in
// Polling mode, and voids the round afterwards. Lab sign-r2 with the stand-in from rewalk/signing.
// Run from the repository root: LAB_PASSWORD=... mise exec -- node <this file>
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../../..");
const { chromium } = createRequire(path.join(root, "e2e/package.json"))("@playwright/test");
const PASSWORD = process.env.LAB_PASSWORD;
if (!PASSWORD) throw new Error("LAB_PASSWORD is required");
const lab = JSON.parse(
  readFileSync(path.join(root, ".documentation-labs/sign-r2/lab.json"), "utf8"),
);
const BASE = lab.appUrl;
const NOTE =
  "Signed, declined, and voided status arrives by webhook. The executed file auto-files and the stage advances to Active.";
const STAMP = new Date()
  .toISOString()
  .replace(/[-:TZ.]/g, "")
  .slice(0, 14);
const out = {
  kind: "compatibility-extra-check",
  appCommit: lab.sourceCommit,
  environment: lab.project,
  appImageId: lab.appImageId,
  startedAt: new Date().toISOString(),
  steps: [],
};
const browser = await chromium.launch({ headless: true });
let failed = false;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1800 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/auth/login`);
  await page.getByLabel("Email").fill("nadia.haddad@helix.example");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 });
  const api = async (method, url, data, multipart) => {
    const r = await page.request.fetch(`${BASE}/api/v1${url}`, {
      method,
      data,
      multipart,
      headers: { origin: BASE },
      failOnStatusCode: false,
    });
    let json = null;
    try {
      json = await r.json();
    } catch {}
    return { status: r.status(), json };
  };
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await adminPage.goto(`${BASE}/auth/login`);
  await adminPage.getByLabel("Email").fill("daniel.okafor@helix.example");
  await adminPage.getByLabel("Password").fill(PASSWORD);
  await adminPage.getByRole("button", { name: "Sign in", exact: true }).click();
  await adminPage.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 });
  // The connector route is for Administrators, so Daniel Okafor reads the mode in his own context.
  const connector = (
    await (await adminPage.request.get(`${BASE}/api/v1/signing-connectors/docusign`)).json()
  ).connector;
  await adminContext.close();
  const typeId = (await api("GET", "/contracts/options")).json.contractTypes.find(
    (t) => t.displayName === "NDA",
  ).id;
  const title = `DOC-029r2 signing-standin note check ${STAMP}`;
  const number = (await api("POST", "/contracts", { title, contractTypeId: typeId })).json.contract
    .number;
  await api("POST", `/contracts/${number}/documents`, undefined, {
    kind: "draft_ours",
    note: "DOC-029r2 note check",
    file: {
      name: "doc029r2-note-check.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n% DOC-029r2 fictional paper\n%%EOF\n"),
    },
  });
  await page.goto(`${BASE}/contracts/${number}/approvals`);
  const card = page.getByRole("region", { name: "Approvals & signing" });
  await card.waitFor({ timeout: 20000 });
  const noteBefore = await card.getByText(NOTE).count();
  await card.getByRole("button", { name: "Send for signature" }).click();
  const dialog = page.getByRole("dialog", { name: "Send for signature" });
  await dialog.getByLabel("Signer 1 name").fill("DOC-029r2 Note Signer");
  await dialog.getByLabel("Signer 1 email").fill("note.signer.r2@counterparty.example");
  const sent = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/v1/contracts/${number}/envelopes`) && r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Send envelope" }).click();
  const sendStatus = (await sent).status();
  await card
    .locator('table[aria-labelledby="contract-signing-heading"] tbody tr')
    .filter({ hasText: "Out for signature" })
    .first()
    .waitFor({ timeout: 20000 });
  const noteAfterRow = await card.getByText(NOTE).count();
  await page.reload();
  await card
    .locator('table[aria-labelledby="contract-signing-heading"] tbody tr')
    .filter({ hasText: "Out for signature" })
    .first()
    .waitFor({ timeout: 20000 });
  const noteAfterReload = await card.getByText(NOTE).count();
  const envelopes = (await api("GET", `/contracts/${number}/envelopes`)).json.envelopes;
  const voided = await api("POST", `/envelopes/${envelopes[0].id}/void`, {
    reason: "DOC-029r2 note check done",
  });
  await page.reload();
  await card.waitFor({ timeout: 20000 });
  await card
    .locator('table[aria-labelledby="contract-signing-heading"] tbody tr')
    .filter({ hasText: "Voided" })
    .first()
    .waitFor({ timeout: 20000 });
  const noteAfterVoid = await card.getByText(NOTE).count();
  const pass =
    connector.updateMode === "polling" &&
    sendStatus === 201 &&
    noteBefore === 0 &&
    noteAfterRow === 1 &&
    noteAfterReload === 1 &&
    voided.status === 200 &&
    noteAfterVoid === 0;
  failed = !pass;
  out.steps.push({
    role: "legal_team_member",
    actor: "Nadia Haddad",
    method: "browser-walkthrough",
    expected:
      "In Polling mode, the note under a live row still says that status arrives by webhook; the note is absent with no live round",
    result: pass ? "pass" : "fail",
    actual: `Connector updateMode ${connector.updateMode}, enabled ${connector.enabled}. C-${number}: note count before sending ${noteBefore}; send answered ${sendStatus}; after the Out for signature row rendered, note count ${noteAfterRow}; after reload ${noteAfterReload}; void answered ${voided.status}; after the Voided row rendered, note count ${noteAfterVoid}. Note text: "${NOTE}"`,
  });
  await context.close();
} catch (error) {
  failed = true;
  out.fatal = String(error?.message ?? error)
    .split("\n")
    .slice(0, 4)
    .join(" ");
} finally {
  out.finishedAt = new Date().toISOString();
  writeFileSync(path.join(here, "note-check-r2.raw.json"), `${JSON.stringify(out, null, 2)}\n`);
  await browser.close();
  console.log(JSON.stringify(out, null, 2));
  process.exitCode = failed ? 1 : 0;
}
