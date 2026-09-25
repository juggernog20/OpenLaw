// DOC-030 mcp, phase m40: V-M40-MCP (Administrator) and V-M40-CLIENT (Legal Team Member,
// Administrator, Business User) on the shared work2 lab. Every organization MCP setting
// is read first and put back as found at the end.
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
const { log, save, step } = createLog("m40", {
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
log.runs.m40.foundPolicy = FOUND_POLICY;
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

// ---------- Claude Code, in a throwaway home only ----------
const claudeEnv = (extra = {}) => ({
  PATH: process.env.PATH,
  HOME: CLAUDE_HOME,
  CLAUDE_CONFIG_DIR: path.join(CLAUDE_HOME, ".claude"),
  DISABLE_AUTOUPDATER: "1",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  TERM: "dumb",
  ...extra,
});
function guideBashBlock(address) {
  const block = guideText.headless.match(/```bash\n(read -r -s[\s\S]*?)```/)?.[1];
  if (!block) throw new Error("The guide's Claude Code block was not found.");
  const lines = block.replaceAll("https://openlaw.company.example/mcp", address).trimEnd().split("\n");
  // The last line starts the interactive Claude Code session; it cannot run headless
  // without a Claude account in the throwaway home. `claude mcp get` replaces it.
  expectThat(lines.at(-1) === "claude", `unexpected last line ${lines.at(-1)}`);
  return { script: [...lines.slice(0, -1), "claude mcp get openlaw"].join("\n"), dropped: "claude" };
}
function filesUnder(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(p));
    else if (e.isFile() && statSync(p).size < 5_000_000) out.push(p);
  }
  return out;
}
function runClaude(args, extra = {}) {
  const r = spawnSync("claude", args, { env: claudeEnv(extra), encoding: "utf8", timeout: 90000, cwd: CLAUDE_HOME });
  return flat(`${r.stdout ?? ""} ${r.stderr ?? ""}`);
}
function claudeCodeFollow(key) {
  mkdirSync(CLAUDE_HOME, { recursive: true });
  const existing = runClaude(["mcp", "get", "openlaw"]);
  let removed = null;
  if (!/not found|No MCP server/i.test(existing)) removed = runClaude(["mcp", "remove", "--scope", "user", "openlaw"]);
  const { script, dropped } = guideBashBlock(MCP_URL);
  const file = path.join(CLAUDE_HOME, "guide-block.sh");
  writeFileSync(file, `${script}\n`, { mode: 0o600 });
  const r = spawnSync("bash", [file], { env: claudeEnv(), input: `${key}\n`, encoding: "utf8", timeout: 120000, cwd: CLAUDE_HOME });
  const out = flat(`${r.stdout} ${r.stderr}`);
  // Where Claude Code saved the header, and whether the key reached any file.
  const files = filesUnder(CLAUDE_HOME);
  const leaked = files.filter((f) => readFileSync(f, "utf8").includes(key)).map((f) => path.relative(CLAUDE_HOME, f));
  let storedHeader = null;
  for (const f of files.filter((f) => f.endsWith(".json"))) {
    try {
      const j = JSON.parse(readFileSync(f, "utf8"));
      const server = j.mcpServers?.openlaw;
      if (server) storedHeader = { file: path.relative(CLAUDE_HOME, f), type: server.type, url: server.url, headers: server.headers };
    } catch {}
  }
  const listWithKey = runClaude(["mcp", "list"], { OPENLAW_API_KEY: key });
  const listWithoutKey = runClaude(["mcp", "list"]);
  const listWrongKey = runClaude(["mcp", "list"], { OPENLAW_API_KEY: "ol_not_a_real_key_for_doc030" });
  const again = spawnSync(
    "claude",
    ["mcp", "add", "--transport", "http", "--scope", "user", "openlaw", MCP_URL, "--header", "x-api-key: ${OPENLAW_API_KEY}"],
    { env: claudeEnv(), encoding: "utf8", timeout: 60000, cwd: CLAUDE_HOME },
  );
  return {
    removedFirst: removed,
    guideBlockOutput: out.replace(key, "<key>"),
    exit: r.status,
    droppedLine: dropped,
    storedHeader,
    keyInAnyFile: leaked,
    listWithKey,
    listWithoutKey,
    listWrongKey,
    addAgain: flat(`${again.stdout} ${again.stderr}`),
  };
}
function claudeConnected(s) {
  return /openlaw:.*(✓|Connected)/.test(s) && !/openlaw:.*(✗|Failed|Needs authentication)/.test(s);
}

// ---------- mcp-remote bridge, as the Claude Cowork / Desktop entry ----------
function guideDesktopEntry(address) {
  const json = guideText.headless.match(/```json\n([\s\S]*?)```/)?.[1];
  const entry = JSON.parse(json).mcpServers.openlaw;
  entry.args = entry.args.map((a) => (a === "https://openlaw.company.example/mcp" ? address : a));
  return entry;
}
async function viaBridge(entry, env) {
  const client = new sdk.Client({ name: "DOC-030 bridge check", version: "1" });
  const transport = new sdkStdio.StdioClientTransport({
    command: entry.command,
    args: entry.args,
    env: { PATH: process.env.PATH, HOME: CLAUDE_HOME, ...env },
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (d) => (stderr += d.toString()));
  try {
    await Promise.race([
      client.connect(transport),
      pause(90000).then(() => {
        throw new Error("bridge connect timed out");
      }),
    ]);
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    const who = await client.callTool({ name: "openlaw_whoami", arguments: {} });
    return { names, whoami: who.structuredContent?.person?.displayName ?? toolText(who) };
  } catch (e) {
    return { error: String(e.message ?? e), stderr: flat(stderr).slice(-600) };
  } finally {
    await client.close().catch(() => {});
  }
}

// ---------- the SDK Client checks per key ----------
async function sdkChecks(key, person) {
  const { client, names } = await connectClient(MCP_URL, { "x-api-key": key });
  const who = await client.callTool({ name: "openlaw_whoami", arguments: {} });
  const search = await client.callTool({ name: "openlaw_docs_search", arguments: { query: "Connect a headless Client" } });
  const hits = (search.structuredContent?.articles ?? search.structuredContent?.results ?? []).map((a) => a.id ?? a.slug);
  const readHeadless = await client.callTool({ name: "openlaw_docs_read", arguments: { id: "connect-headless-client" } });
  const readConfigure = await client.callTool({ name: "openlaw_docs_read", arguments: { id: "configure-mcp" } });
  await client.close();
  const bearer = await rawToolsList(MCP_URL, { authorization: `Bearer ${key}` });
  expectThat(who.structuredContent?.person?.email === person.email, `whoami returned ${JSON.stringify(who.structuredContent?.person)}`);
  expectThat(hits.includes("connect-headless-client"), `docs search hits ${hits.slice(0, 5)}`);
  expectThat(!readHeadless.isError && !readConfigure.isError, "a docs read failed");
  expectThat(bearer.status === 200 && JSON.stringify(bearer.names) === JSON.stringify(names), `Bearer answered ${bearer.status} with ${bearer.names?.length} vs ${names.length} Tools`);
  return {
    names,
    whoami: who.structuredContent,
    docsSearchTop: hits.slice(0, 3),
    docsReadHeadlessTitle: readHeadless.structuredContent?.title,
    docsReadConfigureTitle: readConfigure.structuredContent?.title,
    docsReadUnverified: [readHeadless.structuredContent?.unverified, readConfigure.structuredContent?.unverified],
    bearerStatus: bearer.status,
  };
}
async function expectRefused(key) {
  const r = await rawToolsList(MCP_URL, { "x-api-key": key });
  expectThat(r.status === 401, `expected 401, got ${r.status}`);
  return `tools/list answered ${r.status} ${JSON.stringify(r.body).slice(0, 120)}; WWW-Authenticate ${r.wwwAuthenticate ? "present" : "absent"}`;
}
function expireInDb(requestId, clientName) {
  const sql = `update api_keys set expires_at = now() - interval '1 minute' where id = (select key_id from api_key_requests where id = '${requestId}' and client_name = '${clientName.replaceAll("'", "''")}') returning id`;
  const out = execFileSync("docker", ["exec", `${LAB.project}-postgres-1`, "psql", "-U", "openlaw", "-d", "openlaw", "-tAc", sql], { encoding: "utf8" });
  expectThat(out.trim().split("\n").filter(Boolean).length >= 1, `no key row updated: ${out}`);
  return "UPDATE 1 on the walkthrough's own api_keys row";
}

// =====================================================================
// V-M40-MCP: Administrator configures, Legal Team Member is refused
// =====================================================================
await step(as(CM, "administrator", "/settings/mcp"), "Open Settings → Organization → MCP, after Integrations and before Advanced", "MCP sits after Integrations and before the Advanced group; MCP and every group switch start off", async () => {
  const nav = await gotoMcp(admin);
  const entries = flat(await nav.innerText());
  const i = entries.indexOf("Integrations");
  const m = entries.indexOf("MCP", i);
  const a = entries.indexOf("Advanced", i);
  expectThat(i >= 0 && m > i && a > m, `rail order: ${entries}`);
  const text = await main(admin);
  const switches = {};
  for (const label of ["Enable MCP", "Legal Users OAuth Clients", "Legal Users API keys", "Business Users OAuth Clients", "Business Users API keys"])
    switches[label] = await admin.getByRole("switch", { name: label, exact: true }).getAttribute("aria-checked");
  const pill = await admin.getByText(/Not reachable|^Reachable$/).count();
  return `Rail: Organization group lists ...Integrations, MCP, Advanced... Title "${text.match(/MCP is (on|off)/)?.[0]}". Switches ${JSON.stringify(switches)}. Reachability pill elements: ${pill}. (Found policy recorded in runs.m40.foundPolicy.)`;
});

await step(as(CM, "legal_team_member", "/settings/mcp"), "Only Administrators manage the section: a Legal Team Member has no Organization group and the MCP address sends them to Profile", "No Organization group; /settings/mcp lands on /settings/profile", async () => {
  const nav = await openSettings(ltm, PEOPLE.legal_team_member.name);
  const entries = flat(await nav.innerText());
  expectThat(!/Organization/.test(entries), `nav shows ${entries}`);
  await ltm.goto(`${BASE}/settings/mcp`);
  await ltm.waitForURL(/\/settings\/profile/);
  return `Settings sections nav: "${entries.slice(0, 120)}" (no Organization). Opening /settings/mcp landed on ${new URL(ltm.url()).pathname}.`;
});

await step(as(CH, "legal_team_member", "/settings/api-keys"), "Troubleshooting row 'No Request a key button' while MCP and API keys are off", "API keys pane has no Request a key button", async () => {
  await apiKeysPane(ltm, "legal_team_member");
  const n = await ltm.getByRole("button", { name: "Request a key", exact: true }).count();
  expectThat(n === 0, "Request a key is shown while MCP is off");
  return `API keys pane shows ${n} Request a key buttons. Text: "${(await main(ltm)).slice(0, 160)}"`;
});

await step(as(CM, "administrator", "/settings/mcp"), "Enable API keys 1: turn on the switch beside MCP is off", "Title changes to MCP is on; Settings saved.", async () => {
  await gotoMcp(admin);
  const r = await toggle(admin, "Enable MCP", true);
  await admin.getByText("MCP is on", { exact: true }).waitFor();
  return `${r} Title now "MCP is on". The switch's visible neighbour text was "MCP is off" before the click.`;
});

await step(as(CM, "administrator", "/settings/mcp"), "Enable API keys 2: Copy address beside Server address", "Clipboard holds the /mcp Server address", async () => {
  await admin.getByRole("button", { name: "Copy address", exact: true }).click();
  await admin.getByRole("button", { name: "Copied", exact: true }).waitFor();
  const value = await clip(admin);
  expectThat(value === MCP_URL, `clipboard ${value}`);
  return `Copy address → button reads Copied; clipboard "${value}". No reachability pill while OAuth Clients are off: ${await admin.getByText(/Not reachable|^Reachable$/).count()} elements.`;
});

await step(as(CM, "administrator", "/settings/mcp"), "Enable API keys 3: Legal Users API keys on; Business Users API keys on", "Each switch saves at once with Settings saved.", async () => {
  const a = await toggle(admin, "Legal Users API keys", true);
  const b = await toggle(admin, "Business Users API keys", true);
  const caption = (await main(admin)).match(/Administrators and Legal Team Members\.[^.]*\./)?.[0];
  return `${a} ${b} Legal Users caption: "${caption}". OAuth Clients switches stay off.`;
});

await step(as(CM, "administrator", "/settings/mcp"), "Enable API keys 4: expand Toolset ceiling; all 13 start selected; clear one", "13 of 13 selected; clearing Administration saves", async () => {
  await expandCard(admin, "Toolset ceiling");
  const boxes = admin.getByRole("checkbox");
  const labels = await boxes.evaluateAll((els) => els.map((e) => [e.closest("label")?.textContent?.trim(), e.getAttribute("aria-checked") ?? e.getAttribute("data-state")]));
  const ceiling = labels.filter(([l]) => l);
  const checked = ceiling.filter(([, s]) => s === "true" || s === "checked").length;
  const summaryBefore = (await main(admin)).match(/\d+ of \d+ Toolsets · [a-z -]+/)?.[0];
  expectThat(ceiling.length === 13 && checked === 13, `ceiling ${JSON.stringify(ceiling)}`);
  const status = await saved(admin, () => admin.getByRole("checkbox", { name: "Administration", exact: true }).click());
  const summaryAfter = (await main(admin)).match(/\d+ of \d+ Toolsets · [a-z -]+/)?.[0];
  return `Toolset ceiling expanded: ${ceiling.length} checkboxes, ${checked} checked (${ceiling.map(([l]) => l).join(", ")}). Summary "${summaryBefore}". Cleared Administration → PATCH ${status}, Settings saved., summary "${summaryAfter}".`;
});

await step(as(CM, "administrator", "/settings/mcp"), "Enable API keys 6: API key lifetime (days) set to 30 and saved with Enter", "Saves on Enter with Settings saved.", async () => {
  const input = admin.getByLabel("API key lifetime (days)");
  await input.fill("30");
  const status = await saved(admin, () => input.press("Enter"));
  await input.fill("400");
  await input.press("Enter");
  const refused = await admin.getByRole("alert").innerText().catch(() => "");
  await input.fill("30");
  await input.press("Tab");
  return `Set 30 + Enter → PATCH ${status}, Settings saved. Out-of-range 400 + Enter → alert "${flat(refused)}". Card caption: "${(await main(admin)).match(/New API keys expire[^.]*\.[^.]*\./)?.[0]}"`;
});

// =====================================================================
// V-M40-CLIENT: Legal Team Member requests, Administrator approves in the bell
// =====================================================================
const ltmName = `DOC-030 mcp Claude Code LTM ${stamp}`;
await step(as(CH, "legal_team_member", "/settings/api-keys"), "Request and collect 1-4: Settings → Personal → API keys, Request a key, Toolsets, Scope, Note, Send request", "Request an API key dialog; Toolsets limited to the ceiling; nothing selected; Write offered; row Pending approval", async () => {
  await apiKeysPane(ltm, "legal_team_member");
  const r = await requestKey(ltm, { name: ltmName, toolsets: ["Contracts", "Matters"], scope: "write", note: "DOC-030 fictional task note" });
  expectThat(r.status === 201, `POST answered ${r.status}`);
  created.push(r.id);
  keys.ltm = { id: r.id, name: ltmName };
  expectThat(!r.offered.includes("Administration") && r.offered.length === 12, `offered ${r.offered}`);
  expectThat(r.disabledBefore && r.writeShown, "Send request enabled early or Write missing");
  expectThat(/Nothing is selected for you\./.test(r.dialogText) && /Expires 30 days after approval\./.test(r.dialogText), r.dialogText);
  await ltm.getByRole("row").filter({ hasText: ltmName }).getByText("Pending approval").waitFor();
  return `Dialog "Request an API key" showed "Nothing is selected for you." and "Expires 30 days after approval. The organization sets this lifetime."; Send request disabled until filled; ${r.offered.length} Toolsets offered (Administration absent after the ceiling change); Write radio shown. Sent Contracts+Matters, Write, with a note → 201; row: "${await rowText(ltm, ltmName)}".`;
});

await step(as(CM, "administrator", "bell"), "Approve a request 1-2: bell → Your approvals, check person, Client, Toolsets, scope; Mark all read leaves it; Approve", "The approval shows Nadia Haddad, the Client name, Contracts, Matters and Write; it leaves the group once approved", async () => {
  await admin.goto(`${BASE}/settings/profile`);
  const region = await bellApprovals(admin);
  const item = region.getByRole("listitem").filter({ hasText: ltmName });
  await item.waitFor();
  const text = flat(await item.innerText());
  expectThat(/Nadia Haddad/.test(text) && /Contracts/.test(text) && /Matters/.test(text) && /Write/.test(text), text);
  const markAll = admin.getByRole("button", { name: "Mark all read", exact: true });
  const hadMarkAll = await markAll.isVisible();
  if (hadMarkAll) await markAll.click();
  await item.waitFor();
  const foot = await admin.getByText("Mark all read leaves Your approvals in place.").count();
  await item.getByRole("button", { name: "Approve", exact: true }).click();
  await item.waitFor({ state: "detached", timeout: 15000 });
  await closeBell(admin);
  return `Your approvals item: "${text.slice(0, 200)}". Mark all read ${hadMarkAll ? "clicked; item stayed" : "not shown (only approvals unread)"}; footnote shown ${foot}. Approve → item left the group.`;
});

await step(as(CH, "legal_team_member", "/settings/api-keys"), "Request and collect 5-6: return to API keys and reload; Your key is ready; Copy; outside click keeps it; Esc closes", "Key shown once with Copy and Done; outside click does not close; Esc does; row Active; later read has no key", async () => {
  await ltm.reload();
  const ready = await readyDialog(ltm);
  const r = await collect(ltm, ready, { closeWith: "Esc" });
  keys.ltm.key = r.key;
  expectThat(r.key.startsWith("ol_") && r.survivedOutside, "no key or dialog closed on outside click");
  expectThat(r.href === "/documentation/connect-headless-client" && r.target === "_blank", `${r.href} ${r.target}`);
  await ltm.reload();
  await pause(1500);
  const again = await ltm.getByRole("dialog", { name: "Your key is ready" }).count();
  const row = await rowText(ltm, ltmName);
  const reread = await api(ltm, BASE, "GET", `/api/v1/api-key-requests/${keys.ltm.id}`);
  expectThat(again === 0 && /Active/.test(row) && !reread.body?.key, "dialog came back or key re-readable");
  return `Dialog text: "${r.text.replace(r.key, "<key>").slice(0, 260)}". Outside click: still open. Copy → Copied; clipboard key starts ol_ (${r.key.length} chars). Guide link ${r.href} target ${r.target}. Esc closed it. After reload: no dialog; row "${row}". GET /api/v1/api-key-requests/:id → ${reread.status}, key field ${reread.body?.key ? "present" : "absent"}.`;
});

await step(as(CH, "legal_team_member", "terminal"), "Connect Claude Code: run the guide's Bash block literally (address replaced), then claude mcp list", "openlaw connects; the saved header keeps ${OPENLAW_API_KEY}; the key is in no file", async () => {
  const r = claudeCodeFollow(keys.ltm.key);
  log.runs.m40.claudeCodeLtm = r;
  save();
  expectThat(claudeConnected(r.listWithKey), `mcp list: ${r.listWithKey}`);
  expectThat(JSON.stringify(r.storedHeader?.headers ?? {}).includes("${OPENLAW_API_KEY}") && r.keyInAnyFile.length === 0, JSON.stringify(r.storedHeader));
  return `Block exit ${r.exit}; output "${r.guideBlockOutput.slice(0, 300)}". Saved in ${r.storedHeader.file}: ${JSON.stringify(r.storedHeader.headers)} (type ${r.storedHeader.type}). Key found in ${r.keyInAnyFile.length} files. claude mcp list with OPENLAW_API_KEY set: "${r.listWithKey.slice(0, 200)}". Unset: "${r.listWithoutKey.slice(0, 200)}". Wrong value: "${r.listWrongKey.slice(0, 200)}". Re-running add: "${r.addAgain.slice(0, 200)}". The final interactive "claude" line was not run (no Claude account in the throwaway home); claude mcp get stood in.`;
});

let ltmTools;
await step(as(CH, "legal_team_member", "SDK Client"), "Connect with an SDK Client (Streamable HTTP, x-api-key); Guide Tools read the articles; Bearer also accepted", "Granted Tools listed; whoami is Nadia; docs search finds the guide", async () => {
  ltmTools = await sdkChecks(keys.ltm.key, PEOPLE.legal_team_member);
  const n = ltmTools.names;
  expectThat(["openlaw_whoami", "openlaw_docs_search", "openlaw_docs_read", "openlaw_contracts_list", "openlaw_matters_list", "openlaw_matter_create"].every((t) => n.includes(t)), n.join(","));
  expectThat(!n.some((t) => t.startsWith("openlaw_entit") || t.startsWith("openlaw_knowledge")), "tools outside the grant listed");
  const cookie = await ltm.request.post(MCP_URL, {
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
  });
  expectThat(cookie.status() === 401, `cookie answered ${cookie.status()}`);
  return `${n.length} Tools listed, including openlaw_whoami, openlaw_docs_search, openlaw_docs_read, openlaw_contracts_list, openlaw_matters_list, openlaw_matter_create; none from Entities or Knowledge. whoami: ${JSON.stringify(ltmTools.whoami)}. docs_search top ${ltmTools.docsSearchTop}; docs_read titles "${ltmTools.docsReadHeadlessTitle}" and "${ltmTools.docsReadConfigureTitle}". Bearer header → ${ltmTools.bearerStatus}. Browser session cookie alone → ${cookie.status()}.`;
});

await step(as(CH, "legal_team_member", "mcp-remote"), "Connect Claude Cowork or Claude Desktop: the guide's mcpServers entry through npx -y mcp-remote@0.14.3 (headless), then the --header-file variant", "The bridge connects with the key from env; lists Tools; whoami is Nadia", async () => {
  const entry = guideDesktopEntry(MCP_URL);
  const viaEnv = await viaBridge(entry, { OPENLAW_API_KEY: keys.ltm.key });
  const headerFile = path.join(CLAUDE_HOME, "openlaw-header.txt");
  writeFileSync(headerFile, `x-api-key: ${keys.ltm.key}\n`, { mode: 0o600 });
  chmodSync(headerFile, 0o600);
  const i = entry.args.indexOf("--header");
  const fileArgs = [...entry.args.slice(0, i), "--header-file", headerFile, ...entry.args.slice(i + 2)];
  const viaFile = await viaBridge({ ...entry, args: fileArgs }, {});
  const noEnv = await viaBridge(entry, {});
  rmSync(headerFile);
  log.runs.m40.bridge = { args: entry.args, viaEnv: { ...viaEnv }, viaFile: { ...viaFile, args: fileArgs.map((a) => (a === headerFile ? "<header file>" : a)) }, noEnv };
  save();
  expectThat(!viaEnv.error && /Nadia/.test(viaEnv.whoami), `env: ${JSON.stringify(viaEnv)}`);
  expectThat(!viaFile.error && /Nadia/.test(viaFile.whoami), `header file: ${JSON.stringify(viaFile)}`);
  return `Args ${JSON.stringify(entry.args)} with env OPENLAW_API_KEY → ${viaEnv.names.length} Tools, whoami ${viaEnv.whoami}. --header-file variant → ${viaFile.names.length} Tools, whoami ${viaFile.whoami}. Without the env block: ${noEnv.error ? `refused (${noEnv.error.slice(0, 120)})` : `connected?! ${noEnv.whoami}`}.`;
});

// ---------- policy applies to the next request ----------
await step(as(CM, "administrator", "/settings/mcp"), "Enable API keys 5: Read-only on blocks writes from an existing Write key and hides Write in the request form", "Next tools/list drops write Tools; request form hides Write", async () => {
  await gotoMcp(admin);
  await expandCard(admin, "Toolset ceiling");
  const t = await toggle(admin, "Read-only", true);
  const after = await rawToolsList(MCP_URL, { "x-api-key": keys.ltm.key });
  const call = await (await import("./lib.mjs")).callTool(MCP_URL, { "x-api-key": keys.ltm.key }, "openlaw_matter_create", { matterTypeId: "x", answers: {} });
  await apiKeysPane(ltm, "legal_team_member");
  await ltm.getByRole("button", { name: "Request a key", exact: true }).click();
  const dialog = ltm.getByRole("dialog", { name: "Request an API key" });
  const radios = await dialog.getByRole("radio").evaluateAll((els) => els.map((e) => e.closest("label")?.textContent?.trim()));
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  const t2 = await toggle(admin, "Read-only", false);
  const back = await rawToolsList(MCP_URL, { "x-api-key": keys.ltm.key });
  expectThat(!after.names.includes("openlaw_matter_create") && back.names.includes("openlaw_matter_create") && radios.length === 1, JSON.stringify({ after: after.names, radios }));
  return `${t} Next tools/list: ${after.names.length} Tools, openlaw_matter_create absent. Calling it anyway: ${JSON.stringify(call.body).slice(0, 200)}. Request form radios: ${JSON.stringify(radios)}. ${t2} → ${back.names.length} Tools, openlaw_matter_create back.`;
});

await step(as(CM, "administrator", "/settings/mcp"), "Removing a Toolset from the ceiling blocks its Tools even on an existing key", "Next tools/list drops Matters Tools; re-adding restores them", async () => {
  const s1 = await saved(admin, () => admin.getByRole("checkbox", { name: "Matters", exact: true }).click());
  const after = await rawToolsList(MCP_URL, { "x-api-key": keys.ltm.key });
  const s2 = await saved(admin, () => admin.getByRole("checkbox", { name: "Matters", exact: true }).click());
  const back = await rawToolsList(MCP_URL, { "x-api-key": keys.ltm.key });
  expectThat(!after.names.some((n) => n.includes("matter")) && back.names.includes("openlaw_matters_list"), JSON.stringify(after.names));
  return `Cleared Matters (PATCH ${s1}) → next tools/list ${after.names.length} Tools, no Matters Tools. Re-selected (PATCH ${s2}) → ${back.names.length} Tools with openlaw_matters_list.`;
});

await step(as(CM, "administrator", "/settings/mcp"), "Turning a group's API keys off, or MCP off, blocks that group's next Client request", "401 while off; works again when on", async () => {
  const a = await toggle(admin, "Legal Users API keys", false);
  const offKeys = await rawToolsList(MCP_URL, { "x-api-key": keys.ltm.key });
  const b = await toggle(admin, "Legal Users API keys", true);
  const c = await toggle(admin, "Enable MCP", false);
  const offMcp = await rawToolsList(MCP_URL, { "x-api-key": keys.ltm.key });
  const d = await toggle(admin, "Enable MCP", true);
  const back = await rawToolsList(MCP_URL, { "x-api-key": keys.ltm.key });
  expectThat(offKeys.status === 401 && offMcp.status === 401 && back.status === 200, JSON.stringify([offKeys.status, offMcp.status, back.status]));
  return `${a} → next request ${offKeys.status}. ${b}. ${c} → next request ${offMcp.status}. ${d} → ${back.status}.`;
});

// ---------- approval re-checks policy; deny with a note ----------
const recheckName = `DOC-030 mcp recheck LTM ${stamp}`;
await step(as(CM, "administrator", "/settings/mcp"), "Approval checks the current policy: a Write request under Read-only fails in the card dialog and in the bell; Deny with a note", "Card dialog names the reason; bell says The request could not be handled. Try again.; denied row shows the note", async () => {
  await apiKeysPane(ltm, "legal_team_member");
  const r = await requestKey(ltm, { name: recheckName, toolsets: ["Contracts"], scope: "write", note: "DOC-030 recheck note" });
  created.push(r.id);
  await gotoMcp(admin);
  await expandCard(admin, "Toolset ceiling");
  await toggle(admin, "Read-only", true);
  await admin.reload();
  const row = admin.getByRole("row").filter({ hasText: recheckName });
  const rowTextBefore = flat(await row.innerText());
  await row.getByRole("button", { name: "Approve", exact: true }).click();
  const dlg = admin.getByRole("dialog", { name: "Approve" });
  await dlg.waitFor();
  const hasNote = await dlg.getByLabel("Note (Optional)").count();
  await dlg.getByRole("button", { name: "Approve", exact: true }).click();
  const cardError = flat(await dlg.getByRole("alert").innerText({ timeout: 10000 }));
  await dlg.getByRole("button", { name: "Cancel", exact: true }).click();
  const region = await bellApprovals(admin);
  const item = region.getByRole("listitem").filter({ hasText: recheckName });
  await item.getByRole("button", { name: "Approve", exact: true }).click();
  const bellError = flat(await item.getByRole("alert").innerText({ timeout: 10000 }));
  await closeBell(admin);
  await admin.reload();
  await admin.getByRole("row").filter({ hasText: recheckName }).getByRole("button", { name: "Deny", exact: true }).click();
  const deny = admin.getByRole("dialog", { name: "Deny" });
  await deny.getByLabel("Note (Optional)").fill("DOC-030 fictional denial note");
  await deny.getByRole("button", { name: "Deny", exact: true }).click();
  await deny.waitFor({ state: "detached" });
  await expandCard(admin, "Toolset ceiling");
  await toggle(admin, "Read-only", false);
  await apiKeysPane(ltm, "legal_team_member");
  const denied = await rowText(ltm, recheckName);
  expectThat(/Read-only|read-only|Write/i.test(cardError) && bellError === "The request could not be handled. Try again." && /Denied/.test(denied) && /DOC-030 fictional denial note/.test(denied), JSON.stringify({ cardError, bellError, denied }));
  return `API key requests card row: "${rowTextBefore}" (note under the Client name). Approve dialog has Note (Optional): ${hasNote}. With Read-only on, Approve → dialog alert "${cardError}". Bell Approve → "${bellError}". Deny with note → requester row "${denied}".`;
});

await step(as(CH, "legal_team_member", "/settings/api-keys"), "Troubleshooting 'Pending approval': Cancel request on its row and confirm", "Row changes to Cancelled", async () => {
  const name = `DOC-030 mcp cancel LTM ${stamp}`;
  const r = await requestKey(ltm, { name, toolsets: ["Contracts"], scope: "read" });
  created.push(r.id);
  const row = ltm.getByRole("row").filter({ hasText: name });
  await row.getByRole("button", { name: "Cancel request", exact: true }).click();
  const dlg = ltm.getByRole("dialog", { name: "Cancel request" });
  await dlg.getByRole("button", { name: "Cancel request", exact: true }).click();
  await dlg.waitFor({ state: "detached" });
  await row.getByText("Cancelled").waitFor();
  return `Row after confirm: "${await rowText(ltm, name)}".`;
});

// ---------- Administrator's own key ----------
const adminName = `DOC-030 mcp Claude Code admin ${stamp}`;
await step(as(CH, "administrator", "/settings/api-keys"), "An Administrator's own request approves itself; Your key is ready at once; Copy; Done", "Dialog appears immediately; row Active; later read has no key", async () => {
  await apiKeysPane(admin, "administrator");
  const r = await requestKey(admin, { name: adminName, toolsets: ["Contracts", "Entities"], scope: "read" });
  created.push(r.id);
  const ready = await readyDialog(admin);
  const c = await collect(admin, ready, { closeWith: "Done" });
  keys.admin = { id: r.id, name: adminName, key: c.key };
  const row = await rowText(admin, adminName);
  const reread = await api(admin, BASE, "GET", `/api/v1/api-key-requests/${r.id}`);
  expectThat(c.key.startsWith("ol_") && /Active/.test(row) && !reread.body?.key, row);
  return `POST ${r.status}; "Your key is ready" opened without an approval step: "${c.text.replace(c.key, "<key>").slice(0, 200)}". Copy then Done. Row "${row}". Re-read key field ${reread.body?.key ? "present" : "absent"}.`;
});
await step(as(CH, "administrator", "terminal"), "Connect Claude Code with the Administrator's key (guide block)", "claude mcp list shows openlaw connected", async () => {
  const r = claudeCodeFollow(keys.admin.key);
  log.runs.m40.claudeCodeAdmin = r;
  save();
  expectThat(claudeConnected(r.listWithKey) && r.keyInAnyFile.length === 0, r.listWithKey);
  return `Existing entry removed first with "claude mcp remove --scope user openlaw": ${r.removedFirst?.slice(0, 120)}. List with key: "${r.listWithKey.slice(0, 160)}". Without: "${r.listWithoutKey.slice(0, 160)}".`;
});
await step(as(CH, "administrator", "SDK Client"), "SDK Client with the Administrator's key; Guide Tools", "Contracts and Entities read Tools plus Guide Tools; whoami is Daniel", async () => {
  const r = await sdkChecks(keys.admin.key, PEOPLE.administrator);
  expectThat(r.names.includes("openlaw_contracts_list") && r.names.some((n) => n.includes("entit")) && !r.names.includes("openlaw_matters_list"), r.names.join(","));
  return `${r.names.length} Tools; whoami ${JSON.stringify(r.whoami)}; docs search top ${r.docsSearchTop}; read titles "${r.docsReadHeadlessTitle}", "${r.docsReadConfigureTitle}".`;
});

// ---------- Business User in the Portal; approval from the card ----------
const buName = `DOC-030 mcp Claude Code BU ${stamp}`;
let bu;
try {
  bu = await open("business_user");
} catch (e) {
  console.log(`Business User sign-in failed: ${e.message}`);
}
await step(as(CH, "business_user", "/portal/settings/api-keys"), "Business User: Notification settings gear → API keys → Request a key", "Request an API key dialog; Send request; row Pending approval", async () => {
  await apiKeysPane(bu, "business_user");
  const r = await requestKey(bu, { name: buName, toolsets: ["Requests", "Knowledge"], scope: "read", note: "DOC-030 fictional portal note" });
  created.push(r.id);
  keys.bu = { id: r.id, name: buName };
  await bu.getByRole("row").filter({ hasText: buName }).getByText("Pending approval").waitFor();
  return `Gear "Notification settings" → /portal/settings → API keys link → /portal/settings/api-keys. Dialog offered ${r.offered.length} Toolsets; POST ${r.status}; row "${await rowText(bu, buName)}".`;
});
await step(as(CM, "administrator", "/settings/mcp"), "Approve a request 2: API key requests card, note under the Client name, Approve dialog with Note (Optional)", "Card Approve opens a dialog with Note (Optional); the request leaves the card", async () => {
  await gotoMcp(admin);
  const row = admin.getByRole("row").filter({ hasText: buName });
  const text = flat(await row.innerText());
  expectThat(/Jonas Weber/.test(text) && /DOC-030 fictional portal note/.test(text), text);
  await row.getByRole("button", { name: "Approve", exact: true }).click();
  const dlg = admin.getByRole("dialog", { name: "Approve" });
  await dlg.getByLabel("Note (Optional)").fill("DOC-030 fictional approval note");
  await dlg.getByRole("button", { name: "Approve", exact: true }).click();
  await dlg.waitFor({ state: "detached" });
  await until(async () => (await admin.getByRole("row").filter({ hasText: buName }).count()) === 0 || !/Pending/.test(await rowText(admin, buName)), "request stayed pending");
  return `Card row before: "${text}". Approve dialog with Note (Optional) → approved; the row left API key requests.`;
});
await step(as(CH, "business_user", "/portal/settings/api-keys"), "Business User returns, reloads, collects the key once", "Your key is ready; row Active; later read has no key", async () => {
  await bu.reload();
  const ready = await readyDialog(bu);
  const c = await collect(bu, ready, { closeWith: "Done" });
  keys.bu.key = c.key;
  await bu.reload();
  await pause(1200);
  const row = await rowText(bu, buName);
  const again = await bu.getByRole("dialog", { name: "Your key is ready" }).count();
  const reread = await api(bu, BASE, "GET", `/api/v1/api-key-requests/${keys.bu.id}`);
  expectThat(c.key.startsWith("ol_") && again === 0 && !reread.body?.key, row);
  return `"${c.text.replace(c.key, "<key>").slice(0, 200)}". Outside click kept it: ${c.survivedOutside}. After reload: no dialog; row "${row}"; re-read key ${reread.body?.key ? "present" : "absent"}.`;
});
await step(as(CH, "business_user", "terminal"), "Connect Claude Code with the Business User's key (guide block)", "claude mcp list shows openlaw connected", async () => {
  const r = claudeCodeFollow(keys.bu.key);
  log.runs.m40.claudeCodeBu = r;
  save();
  expectThat(claudeConnected(r.listWithKey), r.listWithKey);
  return `List with key: "${r.listWithKey.slice(0, 160)}". Without: "${r.listWithoutKey.slice(0, 160)}".`;
});
await step(as(CH, "business_user", "SDK Client"), "SDK Client with the Business User's key; Guide Tools", "Requests and Knowledge Tools plus Guide Tools; whoami is Jonas", async () => {
  const r = await sdkChecks(keys.bu.key, PEOPLE.business_user);
  expectThat(r.names.some((n) => n.includes("request")) && !r.names.includes("openlaw_contracts_list"), r.names.join(","));
  return `${r.names.length} Tools (${r.names.join(", ")}); whoami ${JSON.stringify(r.whoami)}; docs search top ${r.docsSearchTop}.`;
});

// ---------- Active keys and grants, Tool calls ----------
await step(as(CM, "administrator", "/settings/mcp"), "Revoke and inspect 1: expand Active keys and grants; counts and the eight columns", "Owner, Client, Toolsets, Scope, Status, Granted, Last used, Expires; our keys listed", async () => {
  await gotoMcp(admin);
  const before = await admin.getByRole("button", { name: "Active keys and grants", exact: true }).getAttribute("aria-expanded");
  await expandCard(admin, "Active keys and grants");
  const counts = (await main(admin)).match(/\d+ keys? · \d+ grants?/)?.[0];
  const heads = await admin.locator("table").last().locator("th").allInnerTexts();
  const rows = {};
  for (const n of [ltmName, adminName, buName]) rows[n] = await rowText(admin, n);
  expectThat(before === "false" && ["Owner", "Client", "Toolsets", "Scope", "Status", "Granted", "Last used", "Expires"].every((h) => heads.map(flat).includes(h)), JSON.stringify(heads));
  return `Started collapsed (aria-expanded ${before}). Counts "${counts}". Columns ${JSON.stringify(heads.map(flat).filter(Boolean))}. Rows: ${JSON.stringify(rows)}.`;
});
await step(as(CM, "administrator", "/settings/audit-log/tool-calls"), "Revoke and inspect 3: Tool calls in the last day → Audit log → Tool calls; columns, From/To, Export CSV", "Lists When, Person, Client, Tool, Outcome, Duration with our calls; CSV downloads", async () => {
  await admin.getByRole("link", { name: "Tool calls in the last day" }).click();
  await admin.waitForURL(/\/settings\/audit-log\/tool-calls\?range=last-day/);
  await admin.getByRole("columnheader", { name: "When" }).waitFor();
  const heads = (await admin.getByRole("columnheader").allInnerTexts()).map(flat);
  const hasFromTo = (await admin.getByLabel("From").count()) > 0 && (await admin.getByLabel("To").count()) > 0;
  const ours = admin.getByRole("row").filter({ hasText: ltmName });
  await ours.first().waitFor({ timeout: 15000 });
  const sample = flat(await ours.first().innerText());
  const [download] = await Promise.all([admin.waitForEvent("download"), admin.getByRole("link", { name: "Export CSV" }).click()]);
  const file = await download.path();
  const csv = readFileSync(file, "utf8");
  const header = csv.split("\n")[0];
  expectThat(["When", "Person", "Client", "Tool", "Outcome", "Duration"].every((h) => heads.includes(h)) && hasFromTo && csv.includes(ltmName), JSON.stringify({ heads, header }));
  return `URL ${new URL(admin.url()).pathname}${new URL(admin.url()).search}. Columns ${JSON.stringify(heads)}. From and To filters present. A row: "${sample}". Export CSV → ${download.suggestedFilename()} (${csv.split("\n").length - 1} lines; header "${header}"; contains our Client). No Tool arguments or results columns.`;
});

// ---------- expired keys (fixture: expiry moved into the past in the lab DB) ----------
for (const role of ["legal_team_member", "administrator", "business_user"]) {
  const k = role === "legal_team_member" ? keys.ltm : role === "administrator" ? keys.admin : keys.bu;
  const page = role === "legal_team_member" ? ltm : role === "administrator" ? admin : bu;
  const sel = { ...CH, role };
  await step({ ...sel, page: "fixture" }, "Fixture setup (not a reader step): move this key's expiry into the past in the work2 database", "One api_keys row updated", async () => expireInDb(k.id, k.name));
  await step({ ...sel, page: "SDK Client" }, "Negative: an expired key cannot connect; the row says Expired", "401 Unauthorized; the API keys row reads Expired", async () => {
    const refused = await expectRefused(k.key);
    await apiKeysPane(page, role);
    const row = await rowText(page, k.name);
    const cc = runClaude(["mcp", "list"], { OPENLAW_API_KEY: k.key });
    expectThat(/Expired/.test(row), row);
    return `${refused}. Row "${row}". claude mcp list with this key: "${cc.slice(0, 140)}".`;
  });
  if (role === "legal_team_member") {
    await step({ ...CM, role: "administrator", page: "SDK Client" }, "Negative (V-M40-MCP): an expired key cannot connect", "401", async () => expectRefused(k.key));
  }
}

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
for (const role of ["legal_team_member", "administrator", "business_user"]) {
  const page = role === "legal_team_member" ? ltm : role === "administrator" ? admin : bu;
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
      const row = await rowText(ltm, k.name);
      expectThat(/Revoked/.test(row), row);
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
      const row = await rowText(page, k.name);
      expectThat(/Revoked/.test(row), row);
      return `${refused}. Row "${row}".`;
    });
  }
}
await step({ ...CM, role: "administrator", page: "/settings/mcp" }, "Negative (V-M40-MCP): a revoked key cannot connect", "401 for the key revoked from Active keys and grants", async () => {
  const revoked = log.steps.find((s) => s.phase === "m40" && s.step.startsWith("Revoke and inspect 2"));
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
  await pause(2000);
  const text = await main(admin);
  const m = text.match(/.{0,80}(org_settings|Organization settings|MCP).{0,120}/);
  expectThat(!!m, text.slice(0, 400));
  return `Audit log page shows: "${m[0]}"`;
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
  runClaude(["mcp", "remove", "--scope", "user", "openlaw"]);
  return `Revoked ${mine.filter((r) => r.status === "active").length} active keys created by this run. Policy before restore ${JSON.stringify(Object.fromEntries(Object.keys(FOUND_POLICY).map((k) => [k, now[k]])))}; PATCH ${restore.status}; now equals the found policy.`;
});

log.runs.m40.articleHashesAtEnd = { "configure-mcp": articleHash("configure-mcp"), "connect-headless-client": articleHash("connect-headless-client") };
save();
await browser.close();
const failed = log.steps.filter((s) => s.phase === "m40" && s.result !== "pass");
console.log(`m40 done: ${log.steps.filter((s) => s.phase === "m40").length} steps, ${failed.length} failed`);
