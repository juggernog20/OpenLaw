// DOC-032 mcp, phase m42up: configure-mcp V-M42-MCP on the owned mcpup lab.
// The lab was built and seeded at 067c1646 (the DOC-030 pin, before M42). The Administrator
// first puts every Toolset in the ceiling on that build. The operator then upgrades the same
// Compose project to the DOC-032 pin with upgrade.sh (docs/user-guides/upgrade.md), and the
// Administrator, a Legal Team Member and a Business User walk the M42 claims with one modern
// (2026-07-28) and one legacy (2025-11-25) script Client connected.
// Keys and Client secrets stay in memory; step() scrubs them from the log.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import {
  api,
  browserSignIn,
  callTool,
  connectClient,
  createLog,
  expectThat,
  flat,
  HERE,
  labManifest,
  LABS,
  pause,
  PEOPLE,
  portalSignIn,
  PW_PATH,
  rawToolsList,
  secret,
  stamp,
  toolText,
  until,
  waitHealthy,
} from "./lib.mjs";
import { ui } from "./ui.mjs";

const LAB = LABS.mcpup;
const BASE = LAB.base;
const MCP_URL = `${BASE}/mcp`;
const U = ui(BASE);
const { chromium } = await import(PW_PATH);
const { log, save, step, finish } = createLog("m42up", {
  lab: LAB.name,
  environment: LAB.project,
  appUrl: BASE,
  mailUrl: LAB.mail,
  labManifestBeforeUpgrade: labManifest("mcpup"),
  upgradeScript: "docs/documentation/batches/DOC-032/mcp/upgrade.sh",
  earlierAttempt:
    "2026-09-28 07:2x UTC: the first run of this phase extracted the target snapshot under the script's own umask 077. docker compose build copied those modes into the app image, and the upgraded app and worker restarted in a loop with ERR_MODULE_NOT_FOUND (Cannot find package /app/apps/api/node_modules/@openlaw/db/index.js) before any migration ran: drizzle.__drizzle_migrations still had 172 rows and the ceiling still held all 13 Toolsets. This was the walkthrough script's error, not the guide's. upgrade.sh rollback started the 067c1646 images again; this run repeats the phase with the extraction under umask 022.",
});
const S = (role, page, extra = {}) => ({
  article: "configure-mcp",
  scenario: "V-M42-MCP",
  role,
  lab: LAB.name,
  page,
  ...extra,
});
const ALL13 = [
  "Workspace",
  "Contracts",
  "Matters",
  "Tasks",
  "Requests",
  "Comments",
  "Documents",
  "Auto-Docs",
  "Entities",
  "Knowledge",
  "People",
  "Team",
  "Administration",
];

const browser = await chromium.launch();
const pages = {};
async function open(role) {
  if (pages[role]) return pages[role];
  const c = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await c.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  pages[role] = await c.newPage();
  if (role === "business_user") await portalSignIn(pages[role], LAB, PEOPLE[role].email);
  else await browserSignIn(pages[role], BASE, PEOPLE[role]);
  return pages[role];
}
function upgrade(stage) {
  return execFileSync("bash", [path.join(HERE, "upgrade.sh"), stage], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 20 * 1024 * 1024,
  });
}
const t0 = new Date().toISOString();

// =====================================================================
// Before the upgrade: the 067c1646 build
// =====================================================================
let admin = await open("administrator");
await step(
  S("administrator", "/settings/mcp", { note: "running build 067c1646" }),
  "Before the upgrade (067c1646): Enable MCP, Legal Users and Business Users API keys; every Toolset in the ceiling",
  "MCP is on; both API keys switches on; Toolset ceiling 13 of 13",
  async () => {
    await U.gotoMcp(admin);
    const a = await U.toggle(admin, "Enable MCP", true);
    const b = await U.toggle(admin, "Legal Users API keys", true);
    const c = await U.toggle(admin, "Business Users API keys", true);
    const ceiling = await U.ceilingState(admin);
    for (const row of ceiling.filter((r) => !r.checked)) await U.checkbox(admin, row.name, true);
    const after = await U.ceilingState(admin);
    const summary = (await U.main(admin)).match(/\d+ of \d+ Toolsets · [a-z -]+/)?.[0];
    const policy = (await api(admin, BASE, "GET", "/api/v1/mcp-settings")).body;
    expectThat(
      after.length === 13 && after.every((r) => r.checked) && policy.toolsetCeiling.length === 13,
      JSON.stringify(after),
    );
    log.runs.m42up.policyBeforeUpgrade = policy;
    return `${a} ${b} ${c} Ceiling rows ${after.map((r) => r.name).join(", ")}; all ${after.filter((r) => r.checked).length} selected (${ceiling.filter((r) => !r.checked).length} had to be selected); summary "${summary}". Stored toolsetCeiling ${JSON.stringify(policy.toolsetCeiling)}.`;
  },
);

// =====================================================================
// The operator's upgrade (upgrade.md)
// =====================================================================
const O = (name, expected, fn) =>
  step(S("operator", "terminal", { method: "container-operation" }), name, expected, fn);
await O(
  "Upgrade: Before you start and Prepare the target (record the running build; select 4ca41822; .env OPENLAW_BUILD_COMMIT; docker compose config --quiet; docker compose build app doc-engine)",
  "Target images built; the running containers are unchanged",
  async () => {
    const out = upgrade("prepare");
    log.runs.m42up.upgradePrepare = out;
    expectThat(
      /config ok/.test(out) && /app \S+-app:4ca41822b685 worker \S+-app:4ca41822b685/.test(out),
      out.slice(-800),
    );
    return `upgrade.sh prepare output recorded in runs.m42up.upgradePrepare. ${flat(out.match(/app \S+ worker \S+ doc-engine \S+/)?.[0])}.`;
  },
);
await O(
  "Upgrade step 4: coherent backup (stop app and worker; pg_dump; tar the file volume; list both; sha256sum)",
  "database.dump and files.tar.gz listed and hashed; app and worker stopped",
  async () => {
    const out = upgrade("backup");
    log.runs.m42up.upgradeBackup = out;
    expectThat(
      /database entries: \d+/.test(out) && /SHA256SUMS|database.dump/.test(out),
      out.slice(-600),
    );
    return flat(
      out
        .split("\n")
        .filter((l) => /entries|database.dump|files.tar.gz|app\s|worker\s/.test(l))
        .join(" | "),
    ).slice(0, 900);
  },
);
await O(
  "Upgrade: Start and verify 1 (docker compose up -d --no-build --pull never; ps; port app 3000; logs)",
  "The app migrates at start and becomes healthy on the same project and volumes; the worker stays running",
  async () => {
    const out = upgrade("start");
    log.runs.m42up.upgradeStart = out;
    await waitHealthy(BASE, 240000);
    await pause(8000);
    const logs = upgrade("logs");
    log.runs.m42up.upgradeLogs = logs;
    const migrated = execFileSync(
      "docker",
      [
        "exec",
        `${LAB.project}-postgres-1`,
        "psql",
        "-U",
        "openlaw",
        "-d",
        "openlaw",
        "-tAc",
        "select count(*) from drizzle.__drizzle_migrations",
      ],
      { encoding: "utf8" },
    ).trim();
    const ceiling = execFileSync(
      "docker",
      [
        "exec",
        `${LAB.project}-postgres-1`,
        "psql",
        "-U",
        "openlaw",
        "-d",
        "openlaw",
        "-tAc",
        "select mcp_toolset_ceiling from org_settings",
      ],
      { encoding: "utf8" },
    ).trim();
    expectThat(
      /worker \S+-app:4ca41822b685 running/.test(logs) &&
        /app \S+-app:4ca41822b685 running/.test(logs),
      logs.slice(-600),
    );
    log.runs.m42up.dbAfterUpgrade = { migrationRows: migrated, orgCeiling: ceiling };
    return `Containers after start: ${flat(logs.match(/\$ docker compose ps[\s\S]*/)?.[0]).slice(0, 400)}. Published port: ${flat(out.match(/127\.0\.0\.1:\d+/)?.[0])}. Migration rows ${migrated}. Stored ceiling after migrations (state read): ${ceiling}. Log lines kept in runs.m42up.upgradeLogs (migration and error lines only).`;
  },
);
log.runs.m42up.labImagesAfterUpgrade = {
  app: execFileSync(
    "docker",
    ["image", "inspect", `${LAB.project}-app:4ca41822b685`, "--format", "{{.Id}}"],
    { encoding: "utf8" },
  ).trim(),
  engine: execFileSync(
    "docker",
    ["image", "inspect", `${LAB.project}-engine:4ca41822b685`, "--format", "{{.Id}}"],
    { encoding: "utf8" },
  ).trim(),
};
save();

// =====================================================================
// After the upgrade: V-M42-MCP
// =====================================================================
await admin.reload();
await step(
  S("administrator", "/settings/mcp"),
  "After the upgrade: expand Toolset ceiling; Team and Administration are unchecked with their captions",
  "MCP and API keys switches kept; 11 of 13 Toolsets; Team caption Starts off.; Administration caption Starts off. Administrators only.",
  async () => {
    await U.gotoMcp(admin);
    const title = (await U.main(admin)).match(/MCP is (on|off)/)?.[0];
    const legal = await admin
      .getByRole("switch", { name: "Legal Users API keys" })
      .getAttribute("aria-checked");
    const business = await admin
      .getByRole("switch", { name: "Business Users API keys" })
      .getAttribute("aria-checked");
    const rows = await U.ceilingState(admin);
    const summary = (await U.main(admin)).match(/\d+ of \d+ Toolsets · [a-z -]+/)?.[0];
    const team = rows.find((r) => r.name === "Team");
    const adm = rows.find((r) => r.name === "Administration");
    expectThat(
      title === "MCP is on" &&
        !team.checked &&
        !adm.checked &&
        rows.filter((r) => r.checked).length === 11 &&
        team.caption === "Starts off." &&
        adm.caption === "Starts off. Administrators only." &&
        /^11 of 13 Toolsets/.test(summary ?? ""),
      JSON.stringify({ title, rows, summary }),
    );
    return `Title "${title}"; Legal Users API keys ${legal}, Business Users API keys ${business}. Summary "${summary}". Rows: ${rows.map((r) => `${r.name}${r.checked ? " [x]" : " [ ]"}${r.caption ? ` (${r.caption})` : ""}`).join(", ")}.`;
  },
);

// ---------- an existing key, from before Team and Administration are chosen ----------
const ltm = await open("legal_team_member");
const existing = { name: `DOC-032 mcp existing LTM ${stamp}` };
await step(
  S("legal_team_member", "/settings/api-keys"),
  "Fixture: Nadia requests a key before Team and Administration are chosen (Contracts, Matters, Requests; Write); Daniel approves in the bell; Nadia collects it once",
  "Team and Administration are not offered; the key is collected",
  async () => {
    await U.apiKeysPane(ltm, "legal_team_member");
    const r = await U.requestKey(ltm, {
      name: existing.name,
      toolsets: ["Contracts", "Matters", "Requests"],
      scope: "write",
    });
    expectThat(r.status === 201, `POST ${r.status}`);
    existing.id = r.id;
    const bell = await U.approveInBell(admin, existing.name);
    const c = await U.collectAfterApproval(ltm, r.id, api);
    existing.key = c.key;
    expectThat(
      !r.offered.includes("Team") && !r.offered.includes("Administration"),
      r.offered.join(","),
    );
    return `Offered ${r.offered.length}: ${r.offered.join(", ")}. Preselected: ${r.preselected.length}. Bell item "${bell.slice(0, 160)}" approved. Key collected (${c.key.length} chars).`;
  },
);

// ---------- modern and legacy Clients connected ----------
const events = { modern: [], legacy: [] };
let modern;
let legacy;
let listen;
let modernReloads = [];
await step(
  S("legal_team_member", "script Clients", { method: "browser-walkthrough" }),
  "Connect one modern Client (2026-07-28, subscriptions/listen) and one legacy Client (2025-11-25) with the existing key",
  "Both connect; the modern Client's listen stream is acknowledged",
  async () => {
    modern = await connectClient(MCP_URL, { "x-api-key": existing.key }, { mode: "modern" });
    legacy = await connectClient(MCP_URL, { "x-api-key": existing.key }, { mode: "legacy" });
    modern.client.fallbackNotificationHandler = async (n) => {
      events.modern.push({ at: new Date().toISOString(), method: n.method });
      if (n.method === "notifications/tools/list_changed") {
        const names = (await modern.client.listTools()).tools.map((t) => t.name).sort();
        modernReloads.push({ at: new Date().toISOString(), names });
      }
    };
    legacy.client.fallbackNotificationHandler = async (n) => {
      events.legacy.push({ at: new Date().toISOString(), method: n.method });
    };
    listen = await modern.client.listen({
      toolsListChanged: true,
      resourcesListChanged: true,
      promptsListChanged: true,
    });
    expectThat(
      modern.protocolVersion === "2026-07-28" && legacy.protocolVersion !== "2026-07-28",
      `${modern.protocolVersion} ${legacy.protocolVersion}`,
    );
    return `Modern Client negotiated ${modern.protocolVersion}, ${modern.names.length} Tools; listen acknowledged with ${JSON.stringify(listen.honoredFilter)}. Legacy Client negotiated ${legacy.protocolVersion}, ${legacy.names.length} Tools. Team Tools in either list: ${modern.names.filter((n) => n.startsWith("openlaw_team")).length}.`;
  },
);

// ---------- select Team and Administration ----------
const since = Date.now();
await step(
  S("administrator", "/settings/mcp"),
  "Choose Team and Administration: select Team, then Administration; each shows Settings saved.",
  "Settings saved. for each; summary 13 of 13",
  async () => {
    await U.gotoMcp(admin);
    await U.expandCard(admin, "Toolset ceiling");
    const a = await U.checkbox(admin, "Team", true);
    await pause(1500);
    const b = await U.checkbox(admin, "Administration", true);
    await pause(2500);
    const summary = (await U.main(admin)).match(/\d+ of \d+ Toolsets · [a-z -]+/)?.[0];
    expectThat(/^13 of 13/.test(summary ?? ""), summary);
    return `${a} ${b} Summary "${summary}".`;
  },
);
await step(
  S("administrator", "script Clients"),
  "Negative: enabling a ceiling row does not add it to an existing key; the modern Client reloads its list without reconnecting",
  "The existing key lists no Team or Administration Tools; the modern Client received tools/list_changed and re-listed",
  async () => {
    await until(
      () => modernReloads.length >= 1,
      "no list_changed reached the modern Client",
      15000,
    );
    const raw = await rawToolsList(MCP_URL, { "x-api-key": existing.key });
    const call = await callTool(MCP_URL, { "x-api-key": existing.key }, "openlaw_team_add", {});
    const last = modernReloads.at(-1).names;
    expectThat(
      !raw.names.some((n) => /team|audit|settings_get/.test(n)) &&
        !last.some((n) => /openlaw_team|audit_log|settings_get/.test(n)),
      JSON.stringify(raw.names),
    );
    return `Modern Client notifications since the change: ${[...new Set(events.modern.map((e) => e.method))].join(", ")}; it re-listed ${last.length} Tools on the same connection (no Team or Administration Tools). Legacy Client notifications: ${events.legacy.length}. Fresh tools/list for the existing key: ${raw.names.length} Tools, none from Team or Administration. tools/call openlaw_team_add with the existing key: ${JSON.stringify(call.body).slice(0, 220)}.`;
  },
);
await step(
  S("administrator", "/settings/audit-log"),
  "The Audit log records each change",
  "An org_settings.updated entry for Team and one for Administration",
  async () => {
    const r = await api(
      admin,
      BASE,
      "GET",
      `/api/v1/audit-log?action=org_settings.updated&limit=50`,
    );
    const entries = (r.body?.entries ?? r.body?.items ?? r.body ?? []).filter?.(
      (e) => new Date(e.createdAt ?? e.at ?? 0).getTime() >= since - 2000,
    );
    const nav = await U.openSettings(admin, PEOPLE.administrator.name);
    const link = nav.getByRole("link", { name: "Audit log", exact: true });
    if (!(await link.isVisible())) await nav.getByRole("button", { name: "Advanced" }).click();
    await link.click();
    await admin.waitForURL(/\/settings\/audit-log/);
    await admin.locator("#auditAction").selectOption("org_settings.updated");
    const rows = admin.locator("main").getByText("Daniel Okafor changed the organization settings");
    await rows.first().waitFor({ timeout: 20000 });
    const n = await rows.count();
    const text = await U.main(admin);
    const i = text.indexOf("Daniel Okafor changed the organization settings");
    expectThat(n >= 2 && (entries?.length ?? 2) >= 2, `${n} entries`);
    return `Audit log, Action org_settings.updated: ${n} "Daniel Okafor changed the organization settings" entries on the page (${entries?.length ?? "?"} since the Team change by state read). Newest: "${text.slice(i, i + 300)}".`;
  },
);

// ---------- who is offered what ----------
await step(
  S("legal_team_member", "/settings/api-keys"),
  "Request a key as a Legal Team Member: Team offered, Administration not; nothing pre-selected",
  "Team offered; Administration absent; no checkbox checked",
  async () => {
    await U.apiKeysPane(ltm, "legal_team_member");
    const f = await U.readRequestForm(ltm);
    await f.dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    const names = f.boxes.map((b) => b.name);
    const pre = f.boxes.filter((b) => b.checked).length;
    expectThat(
      names.includes("Team") && !names.includes("Administration") && pre === 0,
      JSON.stringify(f.boxes),
    );
    return `Request an API key offered ${names.length}: ${names.join(", ")}. Checked: ${pre}. Dialog says "${f.text.match(/Nothing is selected for you\./)?.[0]}".`;
  },
);
const bu = await open("business_user");
await step(
  S("business_user", "/portal/settings/api-keys"),
  "Request a key as a Business User: neither Team nor Administration; nothing pre-selected",
  "Team and Administration absent; no checkbox checked",
  async () => {
    await U.apiKeysPane(bu, "business_user");
    const f = await U.readRequestForm(bu);
    await f.dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    const names = f.boxes.map((b) => b.name);
    const pre = f.boxes.filter((b) => b.checked).length;
    expectThat(
      !names.includes("Team") && !names.includes("Administration") && pre === 0,
      JSON.stringify(f.boxes),
    );
    return `Portal Request an API key offered ${names.length}: ${names.join(", ")}. Checked: ${pre}.`;
  },
);
await step(
  S("administrator", "/settings/api-keys"),
  "Request a key as an Administrator: both Team and Administration offered; nothing pre-selected",
  "Team and Administration offered",
  async () => {
    await U.apiKeysPane(admin, "administrator");
    const f = await U.readRequestForm(admin);
    await f.dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    const names = f.boxes.map((b) => b.name);
    expectThat(names.includes("Team") && names.includes("Administration"), names.join(","));
    return `Offered ${names.length}: ${names.join(", ")}. Checked: ${f.boxes.filter((b) => b.checked).length}.`;
  },
);

// ---------- OAuth consent ----------
let clientId;
await step(
  S("administrator", "/settings/mcp"),
  "Fixture for consent: Legal Users and Business Users OAuth Clients on; Add Client with a callback URL, Save",
  "OAuth switches save; a registered Client exists",
  async () => {
    await U.gotoMcp(admin);
    const a = await U.toggle(admin, "Legal Users OAuth Clients", true);
    const b = await U.toggle(admin, "Business Users OAuth Clients", true);
    await admin.getByRole("button", { name: "Add Client", exact: true }).click();
    const dlg = admin.getByRole("dialog", { name: /Add Client|Edit Client/ });
    await dlg.getByLabel("Client name").fill(`DOC-032 mcp consent Client ${stamp}`);
    await dlg
      .getByRole("textbox", { name: /Callback URL/ })
      .first()
      .fill("https://client.example/callback");
    await dlg.getByRole("button", { name: "Save", exact: true }).click();
    await admin.getByRole("dialog", { name: "Edit Client" }).waitFor({ timeout: 10000 });
    const list = (await api(admin, BASE, "GET", "/api/v1/mcp-settings/allowed-clients")).body;
    const row = (list.clients ?? list).find(
      (c) => c.name === `DOC-032 mcp consent Client ${stamp}`,
    );
    clientId = row.clientId;
    await admin.keyboard.press("Escape");
    return `${a} ${b} Added the registered Client; the editor stayed open as Edit Client.`;
  },
);
const ALL_SCOPES = [
  "workspace",
  "contracts",
  "matters",
  "tasks",
  "requests",
  "comments",
  "documents",
  "auto-docs",
  "entities",
  "knowledge",
  "people",
  "team",
  "administration",
]
  .map((t) => `toolset:${t}`)
  .concat(["write"])
  .join(" ");
async function openConsent(page) {
  const verifier = randomBytes(48).toString("base64url");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: "https://client.example/callback",
    response_type: "code",
    scope: ALL_SCOPES,
    resource: MCP_URL,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state: randomBytes(8).toString("hex"),
  });
  await page.goto(`${BASE}/api/auth/oauth2/authorize?${params}`);
  await page.waitForURL(/\/auth\/consent\?/, { timeout: 20000 });
  await page.getByRole("button", { name: "Allow", exact: true }).waitFor();
  const boxes = await page.getByRole("checkbox").evaluateAll((els) =>
    els.map((e) => ({
      name: e.getAttribute("aria-label") ?? e.closest("label")?.textContent?.trim(),
      checked: e.getAttribute("aria-checked") === "true" || e.dataset.state === "checked",
    })),
  );
  const allowDisabled = await page.getByRole("button", { name: "Allow", exact: true }).isDisabled();
  const heading = flat(await page.getByRole("heading", { level: 1 }).first().innerText());
  await page.getByRole("button", { name: "Deny", exact: true }).click();
  await page
    .waitForURL((u) => !u.pathname.startsWith("/auth/consent"), { timeout: 15000 })
    .catch(() => {});
  return { boxes, allowDisabled, heading };
}
for (const role of ["legal_team_member", "business_user"]) {
  const page = role === "legal_team_member" ? ltm : bu;
  await step(
    S(role, "/auth/consent"),
    `OAuth consent as ${PEOPLE[role].name}: the Client requests all 13 Toolsets; note the Toolsets offered`,
    role === "legal_team_member"
      ? "Team offered, Administration not; nothing pre-selected"
      : "Neither Team nor Administration; nothing pre-selected",
    async () => {
      const c = await openConsent(page);
      const names = c.boxes.map((b) => b.name);
      const pre = c.boxes.filter((b) => b.checked).length;
      const ok =
        role === "legal_team_member"
          ? names.includes("Team") && !names.includes("Administration")
          : !names.includes("Team") && !names.includes("Administration");
      expectThat(ok && pre === 0 && c.allowDisabled, JSON.stringify(c));
      return `Heading "${c.heading}". Offered ${names.length}: ${names.join(", ")}. Checked ${pre}. Allow disabled before a choice: ${c.allowDisabled}. Selected Deny.`;
    },
  );
}

// ---------- ceiling and Read-only changes while both Clients are connected ----------
await step(
  S("administrator", "/settings/mcp + script Clients"),
  "Clear Matters from the ceiling while the modern and legacy Clients are connected",
  "Modern Client reloads without Matters Tools; legacy Client keeps its old list; a legacy call for a Matters Tool is refused",
  async () => {
    const before = modernReloads.length;
    const legacyBefore = (await legacy.client.listTools()).tools.map((t) => t.name);
    events.legacy.length = 0;
    await U.gotoMcp(admin);
    await U.expandCard(admin, "Toolset ceiling");
    const a = await U.checkbox(admin, "Matters", false);
    await until(() => modernReloads.length > before, "modern Client got no list_changed", 15000);
    const modernNow = modernReloads.at(-1).names;
    const legacyCached = legacyBefore;
    const refused = await legacy.client
      .callTool({ name: "openlaw_matters_list", arguments: {} })
      .catch((e) => ({ thrown: e.message }));
    const legacyRefreshed = (await legacy.client.listTools()).tools.map((t) => t.name);
    expectThat(
      !modernNow.some((n) => n.includes("matter")) &&
        legacyCached.includes("openlaw_matters_list") &&
        (refused.isError || refused.thrown) &&
        !legacyRefreshed.some((n) => n.includes("matter")) &&
        events.legacy.length === 0,
      JSON.stringify({ modernNow, refused, legacyRefreshed, legacyEvents: events.legacy }),
    );
    return `${a} Modern Client: list_changed arrived; re-listed on the same connection → ${modernNow.length} Tools, no Matters Tools. Legacy Client: ${events.legacy.length} notifications; its list from before the change still names openlaw_matters_list. Legacy call openlaw_matters_list → ${JSON.stringify(refused).slice(0, 240)}. After the legacy Client refreshed: ${legacyRefreshed.length} Tools, no Matters Tools.`;
  },
);
await step(
  S("administrator", "/settings/mcp + script Clients"),
  "Turn Read-only on while both Clients are connected, then off; select Matters again",
  "Modern Client reloads without write Tools; a legacy write call is refused; the lists come back after the changes",
  async () => {
    const before = modernReloads.length;
    const legacyOld = (await legacy.client.listTools()).tools.map((t) => t.name);
    const a = await U.toggle(admin, "Read-only", true);
    await until(() => modernReloads.length > before, "no list_changed for Read-only", 15000);
    const ro = modernReloads.at(-1).names;
    const write = await legacy.client
      .callTool({
        name: "openlaw_contract_update",
        arguments: { contractId: "00000000-0000-0000-0000-000000000000" },
      })
      .catch((e) => ({ thrown: e.message }));
    const b = await U.toggle(admin, "Read-only", false);
    const c = await U.checkbox(admin, "Matters", true);
    await pause(2500);
    const back = modernReloads.at(-1).names;
    expectThat(
      legacyOld.includes("openlaw_contract_update") &&
        !ro.includes("openlaw_contract_update") &&
        (write.isError || write.thrown) &&
        back.includes("openlaw_matters_list") &&
        back.includes("openlaw_contract_update"),
      JSON.stringify({ ro, write, back }),
    );
    return `${a} Modern Client re-listed ${ro.length} Tools, openlaw_contract_update absent. Legacy call openlaw_contract_update (still in its old list) → ${JSON.stringify(write).slice(0, 240)}. ${b} ${c} Modern Client now lists ${back.length} Tools with openlaw_matters_list and openlaw_contract_update. Modern notifications in this run: ${events.modern.length}; legacy: ${events.legacy.length}.`;
  },
);
await step(
  S("legal_team_member", "/settings/api-keys + script Clients"),
  "Revoke the existing key on its own row: the modern Client's listen stream closes and the next call is unauthorized",
  "listen closes; next call 401",
  async () => {
    await U.apiKeysPane(ltm, "legal_team_member");
    await ltm
      .getByRole("row")
      .filter({ hasText: existing.name })
      .getByRole("button", { name: "Revoke", exact: true })
      .click();
    const dlg = ltm.getByRole("dialog", { name: "Revoke API key" });
    await dlg.getByRole("button", { name: "Revoke", exact: true }).click();
    await dlg.waitFor({ state: "detached" });
    const how = await Promise.race([
      listen.closed,
      pause(20000).then(() => "still open after 20 s"),
    ]);
    const next = await rawToolsList(MCP_URL, { "x-api-key": existing.key });
    expectThat(how !== "still open after 20 s" && next.status === 401, `${how} ${next.status}`);
    await modern.client.close().catch(() => {});
    await legacy.client.close().catch(() => {});
    return `Listen stream ended: ${how}. Next tools/list → ${next.status}. Row "${await U.rowText(ltm, existing.name)}".`;
  },
);

log.runs.m42up.notifications = events;
log.runs.m42up.startedWalkAt = t0;
finish();
await browser.close();
process.exit(0);
