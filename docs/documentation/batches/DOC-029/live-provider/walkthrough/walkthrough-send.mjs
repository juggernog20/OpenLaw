// Live DocuSign Demo round trip for configure-signing (C42), Polling mode.
// It sends one Envelope from the fictional Contract "DOC-029 live signing", waits for the
// user to sign by hand, and checks the executed copy and the Contract Status.
//
// Run from the worktree root (after walkthrough-live.mjs PHASE=c42 passed):
//   LAB_PASSWORD=... SIGNER_EMAIL=... CONTRACT=38 mise exec -- node \
//     docs/documentation/batches/DOC-029/live-provider/walkthrough/walkthrough-send.mjs
//
// The Signer email is the user's controlled inbox. The log never records it.
// The script does not change either connector. It uses the same write guard as
// walkthrough-live.mjs: no PUT, PATCH or DELETE reaches a connector.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../../..");
const require = createRequire(path.join(root, "e2e/package.json"));
const { chromium } = require("@playwright/test");

const BASE = "http://127.0.0.1:23314";
const PASSWORD = process.env.LAB_PASSWORD;
const SIGNER_EMAIL = process.env.SIGNER_EMAIL;
const N = Number(process.env.CONTRACT);
const WAIT_MINUTES = Number(process.env.WAIT_MINUTES ?? 65);
if (!PASSWORD || !SIGNER_EMAIL || !N) throw new Error("LAB_PASSWORD, SIGNER_EMAIL and CONTRACT are required");
const SIGNER_NAME = "DOC-029 Test Signer";
const SUBJECT = process.env.SUBJECT ?? `DOC-029 live signing round trip C-${N}`;
const OUT = path.join(here, process.env.OUT_NAME ?? "walkthrough-c42-send.json");
const VOID_FIRST = process.env.VOID_FIRST === "1";
const HIDDEN = [SIGNER_EMAIL, ...(process.env.HIDE_ALSO ?? "").split(",").filter(Boolean)];
const hide = (s) => HIDDEN.reduce((t, e) => t.split(e).join("<signer inbox>"), String(s ?? ""));

const log = {
  phase: "c42-send",
  reviewer: "DOC-029 independent live-provider walkthrough agent",
  reviewerKind: "agent",
  app: BASE,
  appCommit: "3fa407e3a846559914aa1a63249741f30cfb4f69",
  note: "Sanitized. The Signer inbox belongs to the user and is not recorded. No connector secret is recorded.",
  contract: `C-${N}`,
  subject: SUBJECT,
  signerName: SIGNER_NAME,
  startedAt: new Date().toISOString(),
  steps: [],
  timeline: [],
  finishedAt: null,
};
const save = () => {
  log.finishedAt = new Date().toISOString();
  writeFileSync(OUT, `${hide(JSON.stringify(log, null, 2))}\n`);
};
async function step(id, role, method, action, fn, kindOnFail = "product-bug") {
  const entry = { id, article: "configure-signing", role, method, action, at: new Date().toISOString(), actual: null, result: "not-run" };
  log.steps.push(entry);
  try {
    entry.actual = hide(await fn(entry));
    entry.result = "pass";
  } catch (error) {
    entry.actual = hide(String(error?.message ?? error).split("\n").slice(0, 4).join(" "));
    entry.result = "fail";
    entry.failureKind = kindOnFail;
  }
  console.log(`${entry.result.toUpperCase()} ${id} ${action}\n   ${entry.actual}`);
  save();
  return entry;
}
const expect = (ok, m) => {
  if (!ok) throw new Error(m);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route(/\/api\/v1\/(ai-connector|signing-connectors\/docusign)(\/workflows)?(\?.*)?$/, (route) =>
    ["PUT", "PATCH", "DELETE"].includes(route.request().method()) ? route.abort() : route.continue(),
  );
  const page = await context.newPage();
  await page.goto(`${BASE}/auth/login`);
  await page.getByLabel("Email").fill("daniel.okafor@helix.example");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 });
  const api = async (url) => (await page.request.get(`${BASE}/api/v1${url}`)).json();
  const envelopes = async () => ((await api(`/contracts/${N}/envelopes`)).envelopes ?? []).sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt));
  const card = () => page.getByRole("region", { name: "Approvals & signing" });
  async function openApprovals() {
    for (let i = 0; i < 3; i++) {
      await page.goto(`${BASE}/contracts/${N}`);
      const link = page.getByRole("navigation", { name: "Contract sections" }).getByRole("link", { name: "Approvals", exact: true });
      try {
        await link.waitFor({ timeout: 20000 });
        await link.click();
        await page.waitForURL(new RegExp(`/contracts/${N}/approvals$`), { timeout: 20000 });
        await card().waitFor({ timeout: 20000 });
        await page.waitForLoadState("networkidle").catch(() => {});
        return;
      } catch {}
    }
    throw new Error("Approvals section did not open");
  }

  if (VOID_FIRST) {
    await step("S09a", "administrator", "live-provider-check", "Void the live Envelope whose email did not arrive: row actions, Void envelope, Reason, confirm; check the row and the Contract", async () => {
      const live = (await envelopes()).filter((x) => x.status === "sent");
      expect(live.length === 1, `live Envelopes ${live.length}`);
      const statusBefore = (await api(`/contracts/${N}`)).contract;
      await openApprovals();
      await card().getByRole("button", { name: /^Actions for the envelope sent on/ }).first().click();
      await page.getByRole("menuitem", { name: "Void envelope" }).click();
      const dialog = page.getByRole("dialog", { name: "Void envelope" });
      await dialog.waitFor();
      const dialogText = (await dialog.innerText()).replace(/\s+/g, " ").trim();
      await dialog.getByLabel("Reason").fill(process.env.VOID_REASON ?? "DOC-029 test: the signing email did not reach the Signer inbox. Resending to another inbox.");
      const voided = page.waitForResponse((r) => /\/envelopes\/[^/]+\/void$/.test(r.url()) && r.request().method() === "POST", { timeout: 90000 });
      await dialog.getByRole("button", { name: "Void envelope" }).click();
      const res = await voided;
      await dialog.waitFor({ state: "detached", timeout: 20000 }).catch(() => {});
      await openApprovals();
      const rows = await card().locator("tbody tr").allInnerTexts();
      const env = (await envelopes()).find((x) => x.id === live[0].id);
      const after = (await api(`/contracts/${N}`)).contract;
      const sendButtons = await card().getByRole("button", { name: "Send for signature" }).count();
      log.timeline.push({ at: new Date().toISOString(), event: "voided first Envelope", status: env?.status });
      expect(res.status() < 300 && env?.status === "voided" && sendButtons === 1, `void ${res.status()} status ${env?.status} send ${sendButtons}`);
      return `Dialog: "${dialogText.slice(0, 300)}". Void answered ${res.status()}. The Envelope is ${env.status} with reason "${env.reason}", completed ${env.completedAt}. Row text: ${rows.map((r) => r.replace(/\s+/g, " ").trim()).join(" || ")}. Send for signature is offered again (${sendButtons}). Contract Status before ${statusBefore.statusName}, after ${after.statusName} (stage ${after.stage}); it is not ended or archived (archivedAt=${after.archivedAt ?? null}).`;
    }, "environment");
  }

  const pre = (await envelopes()).filter((x) => x.status === "sent");
  const sig = (await api("/signing-connectors/docusign")).connector;
  expect(sig.enabled && sig.updateMode === "polling" && sig.environment === "demo", "connector not enabled Demo Polling");

  if (pre.length === 0) {
    await step("S09", "administrator", "live-provider-check", "Send the Envelope: Version, one Signer, Subject, Send envelope; check the new row", async (e) => {
      await openApprovals();
      await card().getByRole("button", { name: "Send for signature" }).click();
      const dialog = page.getByRole("dialog", { name: "Send for signature" });
      await dialog.waitFor();
      const version = await dialog.getByLabel("Version").evaluate((el) => el.options[el.selectedIndex].text);
      await dialog.getByLabel("Signer 1 name").fill(SIGNER_NAME);
      await dialog.getByLabel("Signer 1 email").fill(SIGNER_EMAIL);
      await dialog.getByLabel(/^Subject/).fill(SUBJECT);
      const sent = page.waitForResponse((r) => r.url().endsWith(`/api/v1/contracts/${N}/envelopes`) && r.request().method() === "POST", { timeout: 90000 });
      const t0 = Date.now();
      await dialog.getByRole("button", { name: "Send envelope" }).click();
      const res = await sent;
      e.sendMs = Date.now() - t0;
      await dialog.waitFor({ state: "detached", timeout: 20000 }).catch(() => {});
      await openApprovals();
      const rows = await card().locator("tbody tr").allInnerTexts();
      const env = await envelopes();
      e.sentAt = env[0]?.sentAt;
      log.timeline.push({ at: new Date().toISOString(), status: env[0]?.status, executedFetch: env[0]?.executedFetch, event: "sent" });
      expect(res.status() === 201 || res.status() === 200, `send answered ${res.status()}`);
      expect(env[0].status === "sent" && env.filter((x) => x.status === "sent").length === 1, `envelopes ${JSON.stringify(env.map((x) => x.status))}`);
      return `Version chosen: "${version}". Send envelope answered ${res.status()} after ${e.sendMs} ms. API: status ${env[0].status}, Document ${env[0].documentTitle} Version ${env[0].documentVersionNumber}, ${env[0].signers.length} Signer, sent ${env[0].sentAt}. Row text: ${rows.map((r) => r.replace(/\s+/g, " ").trim()).join(" || ")}. Send for signature buttons now: ${await card().getByRole("button", { name: "Send for signature" }).count()}.`;
    }, "environment");
  } else {
    log.timeline.push({ at: new Date().toISOString(), note: `An Envelope already existed (${pre.map((x) => x.status).join(", ")}); the script did not send another.` });
    save();
  }

  // Wait for the user to sign and for Polling to bring the result back.
  const deadline = Date.now() + WAIT_MINUTES * 60000;
  let last = "";
  let env = (await envelopes())[0];
  while (Date.now() < deadline) {
    env = (await envelopes())[0];
    if (!env) break;
    const key = `${env?.status}/${env?.executedFetch}`;
    if (key !== last) {
      log.timeline.push({ at: new Date().toISOString(), status: env?.status, executedFetch: env?.executedFetch, completedAt: env?.completedAt });
      console.log(new Date().toISOString(), key);
      last = key;
      save();
    }
    if (env && env.status !== "sent" && env.executedFetch !== "pending") break;
    if (env && ["declined", "voided"].includes(env.status)) break;
    await wait(30000);
  }

  await step("S10", "administrator", "live-provider-check", "After the Signer completes in DocuSign and Polling runs: check Signed, Executed copy, the executed Version on the original chain, and the Contract Status", async (e) => {
    env = (await envelopes())[0];
    expect(env?.status === "signed", `Envelope status ${env?.status} after ${WAIT_MINUTES} minutes`);
    expect(env.executedFetch === "ready", `executedFetch ${env.executedFetch}`);
    const docs = (await api(`/contracts/${N}/documents?includeArchived=true`)).documents;
    const primary = docs.find((d) => d.isPrimary);
    const executed = primary?.versions.filter((v) => v.isExecuted) ?? [];
    const contract = (await api(`/contracts/${N}`)).contract;
    await openApprovals();
    const rows = await card().locator("tbody tr").allInnerTexts();
    const copyLink = await card().getByRole("link", { name: /Executed copy/ }).count() + (await card().getByRole("button", { name: /Executed copy/ }).count());
    e.completedAt = env.completedAt;
    e.contractStatus = `${contract.statusName} (${contract.stage})`;
    expect(primary && executed.length === 1 && env.executedCopy, `executed versions ${executed.length}`);
    expect(contract.stage === "active", `Contract status ${contract.statusName} (${contract.stage})`);
    return `Envelope ${env.status}, completed ${env.completedAt}, executed copy ${env.executedFetch}. Row: ${rows.map((r) => r.replace(/\s+/g, " ").trim()).join(" || ")}. Executed copy controls: ${copyLink}. Primary Document "${primary.title}" versions: ${primary.versions.map((v) => `v${v.versionNumber} ${v.kind}${v.isExecuted ? " executed" : ""}${v.isCurrent ? " current" : ""} ${v.originalFilename}`).join("; ")}. Contract Status moved from Out for signature to ${contract.statusName} (stage ${contract.stage}).`;
  }, "environment");

  await context.close();
} catch (error) {
  log.abort = hide(String(error?.message ?? error).split("\n").slice(0, 3).join(" "));
  console.error("ABORT", log.abort);
} finally {
  await browser.close();
  save();
}
