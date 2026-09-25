// DOC-030 mcp, phase m40r: a re-run on work2 of the three m40 steps whose checks failed in
// the last full m40 run (a stale row read after Revoke, and an Audit log check that did not
// filter the shared log). It repeats the Administrator and Legal Team Member revoke steps and
// the Audit log step with their fixture steps. work2's Mailpit was down (exited) at this time,
// so the Business User steps, which passed in the full m40 run, are not repeated here.
// Every organization MCP setting is read first and put back as found at the end.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  api,
  articleHash,
  browserSignIn,
  CLAUDE_HOME,
  connectClient,
  createLog,
  expectThat,
  flat,
  HERE,
  LABS,
  pause,
  PEOPLE,
  portalSignIn,
  PW_PATH,
  rawToolsList,
  REL,
  ROOT,
  sdk,
  sdkStdio,
  stamp,
  toolText,
  until,
} from "./lib.mjs";

const LAB = LABS.work2;
const BASE = LAB.base;
const MCP_URL = `${BASE}/mcp`;
const { chromium } = await import(PW_PATH);
const { log, save, step } = createLog("m40r", {
  lab: LAB.name,
  environment: LAB.project,
  appUrl: BASE,
  mailUrl: LAB.mail,
  labManifest: JSON.parse(readFileSync(path.join(ROOT, ".documentation-labs/work2/lab.json"), "utf8")),
});
const CM = { article: "configure-mcp", scenario: "V-M40-MCP", lab: LAB.name };
const CH = { article: "connect-headless-client", scenario: "V-M40-CLIENT", lab: LAB.name };
const as = (base, role, pageName) => ({ ...base, role, page: pageName });
const guideText = {
  configure: readFileSync(path.join(ROOT, "docs/user-guides/configure-mcp.md"), "utf8"),
  headless: readFileSync(path.join(ROOT, "docs/user-guides/connect-headless-client.md"), "utf8"),
};

// ---------- browser contexts ----------
const browser = await chromium.launch();
const ctx = {};
const pages = {};
async function open(role) {
  if (pages[role]) return pages[role];
  ctx[role] = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await ctx[role].grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  pages[role] = await ctx[role].newPage();
  if (role === "business_user") await portalSignIn(pages[role], LAB, PEOPLE[role].email);
  else await browserSignIn(pages[role], BASE, PEOPLE[role]);
  return pages[role];
}
const admin = await open("administrator");
const ltm = await open("legal_team_member");
const main = async (page) => flat(await page.locator("main").innerText());
const clip = (page) => page.evaluate(() => navigator.clipboard.readText());

// ---------- fixture: what we found ----------
const found = (await api(admin, BASE, "GET", "/api/v1/mcp-settings")).body;
const FOUND_POLICY = {
  enabled: found.enabled,
  legalApiKeysEnabled: found.legalApiKeysEnabled,
  businessApiKeysEnabled: found.businessApiKeysEnabled,
  legalOAuthClientsEnabled: found.legalOAuthClientsEnabled,
  businessOAuthClientsEnabled: found.businessOAuthClientsEnabled,
  dynamicClientRegistrationEnabled: found.dynamicClientRegistrationEnabled,
  toolsetCeiling: found.toolsetCeiling,
  readOnly: found.readOnly,
  apiKeyLifetimeDays: found.apiKeyLifetimeDays,
};
log.runs.m40r.foundPolicy = FOUND_POLICY;
save();
const keys = {}; // role/label -> { id, name, key } in memory only; keys never logged
const created = []; // request ids this run created
const toolNames = (r) => r.names ?? [];

// ---------- shared UI helpers ----------
async function openSettings(page, name) {
  await page.getByRole("banner").getByRole("button", { name }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await page.waitForURL(/\/settings/);
  return page.getByRole("navigation", { name: "Settings sections" });
}
async function gotoMcp(page) {
  const nav = await openSettings(page, PEOPLE.administrator.name);
  await nav.getByRole("link", { name: "MCP", exact: true }).first().click();
  await page.waitForURL(/\/settings\/mcp$/);
  await page.getByText(/^MCP is (on|off)$/).waitFor();
  return nav;
}
async function saved(page, action) {
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/mcp-settings") && r.request().method() === "PATCH",
  );
  await action();
  const r = await response;
  await page.getByRole("status").filter({ hasText: "Settings saved." }).waitFor({ timeout: 10000 });
  return r.status();
}
async function toggle(page, label, want) {
  const sw = page.getByRole("switch", { name: label, exact: true });
  const now = (await sw.getAttribute("aria-checked")) === "true";
  if (now === want) return `${label} already ${want ? "on" : "off"}`;
  const status = await saved(page, () => sw.click());
  expectThat(status === 200, `${label} PATCH answered ${status}`);
  await until(async () => ((await sw.getAttribute("aria-checked")) === "true") === want, `${label} did not change`);
  return `${label} turned ${want ? "on" : "off"}; Settings saved.`;
}
async function expandCard(page, title) {
  const button = page.getByRole("button", { name: title, exact: true });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  return button;
}
async function apiKeysPane(page, role) {
  if (role === "business_user") {
    await page.goto(`${BASE}/portal`);
    await page.getByRole("link", { name: "Notification settings" }).click();
    await page.waitForURL(/\/portal\/settings$/);
    await page.getByRole("link", { name: "API keys", exact: true }).click();
    await page.waitForURL(/\/portal\/settings\/api-keys/);
  } else {
    const nav = await openSettings(page, PEOPLE[role].name);
    await nav.getByRole("link", { name: "API keys", exact: true }).click();
    await page.waitForURL(/\/settings\/api-keys/);
  }
  await page.getByRole("heading", { name: "API keys" }).first().waitFor();
}
async function requestKey(page, { name, toolsets, scope, note }) {
  await page.getByRole("button", { name: "Request a key", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Request an API key" });
  await dialog.waitFor();
  const text = flat(await dialog.innerText());
  const send = dialog.getByRole("button", { name: "Send request" });
  const disabledBefore = await send.isDisabled();
  await dialog.getByLabel("Client name").fill(name);
  for (const t of toolsets) await dialog.getByRole("checkbox", { name: t, exact: true }).check();
  const writeRadio = dialog.getByRole("radio", { name: /^Write\./ });
  const writeShown = (await writeRadio.count()) > 0;
  await dialog.getByRole("radio", { name: scope === "write" ? /^Write\./ : /^Read\./ }).check();
  if (note) await dialog.getByLabel("Note (Optional)").fill(note);
  const offered = await dialog.getByRole("checkbox").evaluateAll((els) =>
    els.map((e) => e.closest("label")?.textContent?.trim()),
  );
  const posted = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/api-key-requests") && r.request().method() === "POST",
  );
  await send.click();
  const response = await posted;
  const body = await response.json();
  return { id: body.id, status: response.status(), dialogText: text, disabledBefore, writeShown, offered, body };
}
async function readyDialog(page) {
  const ready = page.getByRole("dialog", { name: "Your key is ready" });
  await ready.waitFor({ timeout: 20000 });
  return ready;
}
async function collect(page, ready, { closeWith }) {
  const text = flat(await ready.innerText());
  // A click outside the dialog must not close it.
  await page.mouse.click(5, 5);
  await pause(400);
  const survivedOutside = await ready.isVisible();
  await ready.getByRole("button", { name: "Copy", exact: true }).click();
  await ready.getByRole("button", { name: "Copied", exact: true }).waitFor();
  const key = (await clip(page)).trim();
  const link = ready.getByRole("link", { name: /Connect a headless Client/ });
  const href = await link.getAttribute("href");
  const target = await link.getAttribute("target");
  if (closeWith === "Esc") await page.keyboard.press("Escape");
  else await ready.getByRole("button", { name: "Done", exact: true }).click();
  await ready.waitFor({ state: "detached", timeout: 10000 });
  return { key, text, survivedOutside, href, target };
}
function rowText(page, name) {
  return page.getByRole("row").filter({ hasText: name }).first().innerText().then(flat);
}
async function bellApprovals(page) {
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const region = page.getByRole("region", { name: "Your approvals" });
  await region.waitFor({ timeout: 15000 });
  return region;
}
async function closeBell(page) {
  await page.keyboard.press("Escape");
  await pause(300);
}

async function expectRefused(key) {
  const r = await rawToolsList(MCP_URL, { "x-api-key": key });
  expectThat(r.status === 401, `expected 401, got ${r.status}`);
  return `tools/list answered ${r.status} ${JSON.stringify(r.body).slice(0, 120)}; WWW-Authenticate ${r.wwwAuthenticate ? "present" : "absent"}`;
}

// ---------- fixture: the policy the revoke steps need (as in the m40 run) ----------
await step(as(CM, "administrator", "/settings/mcp"), "Fixture (repeats Enable API keys 1 and 3): MCP on and Legal Users API keys on", "Settings saved.", async () => {
  await gotoMcp(admin);
  const a = await toggle(admin, "Enable MCP", true);
  const b = await toggle(admin, "Legal Users API keys", true);
  return `${a} ${b}`;
});
// ---------- revoked keys: fresh keys per role, then Revoke ----------
async function freshKey(role, page) {
  const name = `DOC-030 mcp revoke ${role} ${stamp}`;
  await apiKeysPane(page, role);
  const r = await requestKey(page, { name, toolsets: role === "business_user" ? ["Requests"] : ["Contracts"], scope: "read" });
  created.push(r.id);
  if (role !== "administrator") {
    await admin.goto(`${BASE}/settings/profile`);
    const region = await bellApprovals(admin);
    const item = region.getByRole("listitem").filter({ hasText: name });
    await item.getByRole("button", { name: "Approve", exact: true }).click();
    await item.waitFor({ state: "detached" });
    await closeBell(admin);
    // Metadata list only; GET /:id would collect the key outside the browser.
    await until(async () => (await api(page, BASE, "GET", "/api/v1/api-key-requests")).body?.requests?.find((q) => q.id === r.id)?.keyAvailable, "approval not stored", 20000);
    await page.reload();
  }
  const c = await collect(page, await readyDialog(page), { closeWith: "Done" });
  return { id: r.id, name, key: c.key };
}
for (const role of ["legal_team_member", "administrator"]) {
  const page = role === "legal_team_member" ? ltm : admin;
  let k;
  await step({ ...CH, role, page: "/settings/api-keys" }, "Fixture: a second key for the revoke check (request, approve, collect)", "Key collected and connects", async () => {
    k = await freshKey(role, page);
    const ok = await rawToolsList(MCP_URL, { "x-api-key": k.key });
    expectThat(ok.status === 200, `status ${ok.status}`);
    return `Collected; tools/list ${ok.status} with ${ok.names.length} Tools.`;
  });
  if (!k) continue;
  if (role === "legal_team_member") {
    await step({ ...CM, role: "administrator", page: "/settings/mcp" }, "Revoke and inspect 2: Revoke on a key in Active keys and grants → Revoke API key → Revoke", "Next request refused; owner's row says Revoked", async () => {
      await gotoMcp(admin);
      await expandCard(admin, "Active keys and grants");
      await admin.getByRole("row").filter({ hasText: k.name }).getByRole("button", { name: "Revoke", exact: true }).click();
      const dlg = admin.getByRole("dialog", { name: "Revoke API key" });
      const warn = flat(await dlg.innerText());
      await dlg.getByRole("button", { name: "Revoke", exact: true }).click();
      await dlg.waitFor({ state: "detached" });
      const refused = await expectRefused(k.key);
      await apiKeysPane(ltm, role);
      const row = await until(async () => {
        const t = await rowText(ltm, k.name);
        if (/Revoked/.test(t)) return t;
        await ltm.reload();
        return null;
      }, "Nadia's row never read Revoked", 20000);
      return `Dialog "Revoke API key": "${warn}". After Revoke: ${refused}. Nadia's row "${row}".`;
    });
    await step({ ...CH, role, page: "SDK Client" }, "Negative: a revoked key cannot connect", "401", async () => expectRefused(k.key));
  } else {
    await step({ ...CH, role, page: role === "business_user" ? "/portal/settings/api-keys" : "/settings/api-keys" }, "Stop access: Revoke on its own row → Revoke API key → Revoke; next request refused; row Revoked", "401; row Revoked", async () => {
      await apiKeysPane(page, role);
      await page.getByRole("row").filter({ hasText: k.name }).getByRole("button", { name: "Revoke", exact: true }).click();
      const dlg = page.getByRole("dialog", { name: "Revoke API key" });
      await dlg.getByRole("button", { name: "Revoke", exact: true }).click();
      await dlg.waitFor({ state: "detached" });
      const refused = await expectRefused(k.key);
      const row = await until(async () => {
        const t = await rowText(page, k.name);
        if (/Revoked/.test(t)) return t;
        await page.reload();
        return null;
      }, "the row never read Revoked", 20000);
      return `${refused}. Row "${row}".`;
    });
  }
}
await step({ ...CM, role: "administrator", page: "/settings/mcp" }, "Negative (V-M40-MCP): a revoked key cannot connect", "401 for the key revoked from Active keys and grants", async () => {
  const revoked = log.steps.find((s) => s.phase === "m40r" && s.step.startsWith("Revoke and inspect 2"));
  expectThat(revoked?.result === "pass", "the revoke step did not pass");
  return `See the "Revoke and inspect 2" step: ${revoked.actual.slice(0, 200)}`;
});

// ---------- the audit trail of the Organization changes ----------
await step(as(CM, "administrator", "/settings/audit-log"), "Each Organization change is recorded in the Audit log", "Audit log lists the MCP setting changes made in this run", async () => {
  const nav = await openSettings(admin, PEOPLE.administrator.name);
  const auditLink = nav.getByRole("link", { name: "Audit log", exact: true });
  if (!(await auditLink.isVisible())) await nav.getByRole("button", { name: "Advanced" }).click();
  await auditLink.click();
  await admin.waitForURL(/\/settings\/audit-log/);
  // Other agents share work2, so narrow to this Administrator and the settings action.
  await admin.locator("#auditAction").selectOption("org_settings.updated");
  const person = admin.locator("#auditActor");
  if (await person.count()) await person.selectOption({ label: PEOPLE.administrator.name });
  const entries = admin.locator("main").getByText("Daniel Okafor changed the organization settings");
  await entries.first().waitFor({ timeout: 20000 });
  const n = await entries.count();
  const text = await main(admin);
  const i = text.indexOf("Daniel Okafor changed the organization settings");
  expectThat(n >= 1, "no organization settings entries");
  return `Action filter "org_settings.updated" option label "${flat(await admin.locator("#auditAction option:checked").innerText())}", Person Daniel Okafor: ${n} "Daniel Okafor changed the organization settings" entries on the first page; newest: "${text.slice(i, i + 260)}".`;
});

// ---------- restore everything this run changed ----------
await step(as(CM, "administrator", "fixture"), "Cleanup: revoke keys this run left active and put every organization MCP setting back as found", "Policy equals the found policy", async () => {
  const list = (await api(admin, BASE, "GET", "/api/v1/mcp-settings/api-keys")).body;
  const mine = list.filter((r) => created.includes(r.id));
  for (const r of mine.filter((r) => r.status === "active")) await api(admin, BASE, "POST", `/api/v1/api-key-requests/${r.id}/revoke`);
  for (const r of mine.filter((r) => r.status === "pending")) await api(admin, BASE, "POST", `/api/v1/api-key-requests/${r.id}/deny`, {});
  const now = (await api(admin, BASE, "GET", "/api/v1/mcp-settings")).body;
  const restore = await api(admin, BASE, "PATCH", "/api/v1/mcp-settings", FOUND_POLICY);
  const after = (await api(admin, BASE, "GET", "/api/v1/mcp-settings")).body;
  const same = Object.keys(FOUND_POLICY).every((k) => JSON.stringify(after[k]) === JSON.stringify(FOUND_POLICY[k]));
  expectThat(restore.status === 200 && same, JSON.stringify(after));
  return `Revoked ${mine.filter((r) => r.status === "active").length} active keys created by this run. Policy before restore ${JSON.stringify(Object.fromEntries(Object.keys(FOUND_POLICY).map((k) => [k, now[k]])))}; PATCH ${restore.status}; now equals the found policy.`;
});

log.runs.m40r.articleHashesAtEnd = { "configure-mcp": articleHash("configure-mcp"), "connect-headless-client": articleHash("connect-headless-client") };
save();
await browser.close();
const failed = log.steps.filter((s) => s.phase === "m40r" && s.result !== "pass");
console.log(`m40r done: ${log.steps.filter((s) => s.phase === "m40r").length} steps, ${failed.length} failed`);
