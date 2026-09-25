// DOC-030 mcp, phase lan, on the owned mcplan lab only (never work2).
// Operator: a deployment-pinned MCP rate limit, removing the BASE_URL pin, restarts.
// Administrator: sets the Instance address the way the guides say (Settings → Advanced →
// Instance address → Application address, then an API and worker restart), first to
// http://[::1]:43320 (IPv4 record check), then to the plain-HTTP LAN address
// http://192.168.50.10:43320, and checks the OAuth refusals and that API keys still work.
// The LAN origin is reached through a loopback-only forward proxy; nothing is exposed.
import net from "node:net";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  api,
  articleHash,
  browserSignIn,
  callTool,
  connectClient,
  createLog,
  expectThat,
  flat,
  LABS,
  mcplanCompose,
  pause,
  PEOPLE,
  PW_PATH,
  rawToolsList,
  ROOT,
  stamp,
  startLanProxy,
  toolText,
  undici,
  until,
  waitHealthy,
} from "./lib.mjs";

const LAB = LABS.mcplan;
const { chromium } = await import(PW_PATH);
const { log, save, step } = createLog("lan", {
  lab: LAB.name,
  environment: LAB.project,
  appUrl: LAB.base,
  mailUrl: LAB.mail,
  labManifest: JSON.parse(readFileSync(path.join(ROOT, ".documentation-labs/mcplan/lab.json"), "utf8")),
  proxy: "loopback-only forward proxy in lib.mjs startLanProxy; the lab port stays bound to 127.0.0.1",
});
const CMo = { article: "configure-mcp", scenario: "V-M40-MCP", role: "operator", lab: LAB.name };
const CMa = { article: "configure-mcp", scenario: "V-M40-MCP", role: "administrator", lab: LAB.name };
const M41 = { article: "configure-mcp", scenario: "V-M41-MCP", role: "administrator", lab: LAB.name };
const LAN = "http://192.168.50.10:43320";
const V6 = "http://[::1]:43320";
const DEFAULT = "http://localhost:3000";

const proxy = await startLanProxy();
const browser = await chromium.launch();
async function adminAt(origin) {
  const viaProxy = origin !== LAB.base;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    ...(viaProxy ? { proxy: { server: proxy.url, bypass: "<-loopback>" } } : {}),
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  const page = await context.newPage();
  await browserSignIn(page, origin, PEOPLE.administrator);
  return { context, page };
}
/** fetch that sends the LAN Host header over a socket to the owned lab on 127.0.0.1. */
const lanDispatcher = new undici.Agent({
  connect: (_opts, cb) => {
    const socket = net.connect({ host: "127.0.0.1", port: 43320 });
    socket.once("connect", () => cb(null, socket));
    socket.once("error", (e) => cb(e, null));
  },
});
const lanFetch = (url, init = {}) => undici.fetch(url, { ...init, dispatcher: lanDispatcher });
const main = async (page) => flat(await page.locator("main").innerText());
async function openSettings(page) {
  await page.getByRole("banner").getByRole("button", { name: PEOPLE.administrator.name }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await page.waitForURL(/\/settings/);
  return page.getByRole("navigation", { name: "Settings sections" });
}
async function advancedEntry(page, label) {
  const nav = await openSettings(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  const link = () => (label === "MCP" ? nav.getByRole("link", { name: "MCP", exact: true }).last() : nav.getByRole("link", { name: label, exact: true }));
  const count = () => nav.getByRole("link", { name: "MCP", exact: true }).count();
  const shown = label === "MCP" ? (await count()) > 1 : await link().isVisible();
  if (!shown) await nav.getByRole("button", { name: "Advanced" }).click();
  await until(async () => (label === "MCP" ? (await count()) > 1 : await link().isVisible()), `${label} not in the rail`);
  await link().click();
}
async function gotoMcp(page) {
  const nav = await openSettings(page);
  await nav.getByRole("link", { name: "MCP", exact: true }).first().click();
  await page.waitForURL(/\/settings\/mcp$/);
  await page.getByText(/^MCP is (on|off)$/).waitFor();
}
async function setSwitch(page, label, want) {
  const sw = page.getByRole("switch", { name: label, exact: true });
  if (((await sw.getAttribute("aria-checked")) === "true") === want) return 0;
  const resp = page.waitForResponse((r) => r.url().endsWith("/api/v1/mcp-settings") && r.request().method() === "PATCH");
  await sw.click();
  return (await resp).status();
}
async function setInstanceAddress(page, value) {
  await advancedEntry(page, "Instance address");
  await page.waitForURL(/\/settings\/instance/);
  const field = page.getByLabel("Application address");
  const before = await field.inputValue();
  const card = flat(await page.locator("main").innerText());
  await field.fill(value);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const msg = await page.getByText("Settings saved. Restart the API and worker to apply changes.").innerText({ timeout: 15000 });
  return { before, card: card.slice(0, 300), msg };
}
function operatorRestart() {
  mcplanCompose(["restart", "app", "worker"], ["overlay-unpin.json"]);
}

// =====================================================================
// Operator: the deployment pins Calls per hour per credential
// =====================================================================
let a = await adminAt(LAB.base);
await step({ ...CMo, page: "/settings/mcp-limits" }, "Settings → Organization → Advanced → MCP before any pin: Calls per hour per credential defaults to 600", "Field shows 600 as Default; OAuth grant lifetime (days) 90", async () => {
  await advancedEntry(a.page, "MCP");
  await a.page.waitForURL(/\/settings\/mcp-limits/);
  await a.page.getByLabel("Calls per hour per credential").waitFor();
  const rate = await a.page.getByLabel("Calls per hour per credential").inputValue();
  const life = await a.page.getByLabel("OAuth grant lifetime (days)").inputValue();
  const text = await main(a.page);
  expectThat(rate === "600" && life === "90", `${rate} ${life}`);
  return `Advanced → MCP: Calls per hour per credential ${rate}, OAuth grant lifetime (days) ${life}. Text: "${text.slice(0, 400)}"`;
});
await step({ ...CMo, method: "browser-walkthrough", page: "container + /settings/mcp-limits" }, "Operator sets MCP_RATE_LIMIT_PER_HOUR=3 in the deployment and recreates API and worker; the field shows Read only", "Deployment configuration · Read only; the input cannot be changed", async () => {
  mcplanCompose(["up", "-d", "--no-build", "--no-deps", "app", "worker"], ["overlay-rate.json"]);
  await waitHealthy(LAB.base);
  await a.context.close();
  a = await adminAt(LAB.base);
  await advancedEntry(a.page, "MCP");
  await a.page.waitForURL(/\/settings\/mcp-limits/);
  const input = a.page.getByLabel("Calls per hour per credential");
  await input.waitFor();
  const value = await input.inputValue();
  const readOnly = await input.getAttribute("readonly");
  const text = await main(a.page);
  expectThat(value === "3" && readOnly !== null && /Read only/.test(text) && /Deployment configuration/.test(text), text.slice(0, 500));
  return `After recreate with overlay-rate.json: value ${value}, input readonly=${readOnly !== null}; page text "${text.match(/.{0,120}Read only.{0,160}/)?.[0]}"`;
});
let limitKey;
await step({ ...CMo, page: "SDK Client" }, "A refused Client call names the limit and reset time", "The fourth call in the hour is refused with the limit and reset time", async () => {
  await gotoMcp(a.page);
  await setSwitch(a.page, "Enable MCP", true);
  await setSwitch(a.page, "Legal Users API keys", true);
  const nav = await openSettings(a.page);
  await nav.getByRole("link", { name: "API keys", exact: true }).click();
  await a.page.getByRole("button", { name: "Request a key", exact: true }).click();
  const dlg = a.page.getByRole("dialog", { name: "Request an API key" });
  await dlg.getByLabel("Client name").fill(`DOC-030 mcp rate limit ${stamp}`);
  await dlg.getByRole("checkbox", { name: "Contracts", exact: true }).check();
  await dlg.getByRole("radio", { name: /^Read\./ }).check();
  await dlg.getByRole("button", { name: "Send request" }).click();
  const ready = a.page.getByRole("dialog", { name: "Your key is ready" });
  await ready.waitFor();
  await ready.getByRole("button", { name: "Copy", exact: true }).click();
  limitKey = (await a.page.evaluate(() => navigator.clipboard.readText())).trim();
  await ready.getByRole("button", { name: "Done", exact: true }).click();
  const results = [];
  for (let i = 0; i < 5; i++) results.push(await callTool(`${LAB.base}/mcp`, { "x-api-key": limitKey }, "openlaw_whoami", {}));
  const texts = results.map((r) => `${r.status}:${toolText(r.body?.result ?? r.body).slice(0, 160) || JSON.stringify(r.body).slice(0, 160)}`);
  const refused = texts.find((t) => /limit|reset/i.test(t));
  expectThat(!!refused, texts.join(" | "));
  return `Five openlaw_whoami calls: ${texts.map((t) => t.slice(0, 60)).join(" | ")}. Refusal: "${refused}".`;
});

// =====================================================================
// Operator removes the BASE_URL pin; Administrator sets the Instance address
// =====================================================================
await step({ ...CMo, page: "container" }, "Operator removes the BASE_URL pin and the rate pin, and recreates API and worker", "The app answers; Instance address falls back to its default", async () => {
  mcplanCompose(["up", "-d", "--no-build", "--no-deps", "app", "worker"], ["overlay-unpin.json"]);
  await waitHealthy(LAB.base);
  const env = mcplanCompose(["exec", "-T", "app", "sh", "-c", 'printf "%s|%s" "$BASE_URL" "$MCP_RATE_LIMIT_PER_HOUR"'], ["overlay-unpin.json"]);
  return `Recreated with overlay-unpin.json; app sees BASE_URL="${env.split("|")[0]}", MCP_RATE_LIMIT_PER_HOUR="${env.split("|")[1]}".`;
});
await a.context.close();
a = await adminAt(DEFAULT);
await step({ ...M41, page: "/settings/instance" }, "Administrator sets Application address to http://[::1]:43320 in Settings → Advanced → Instance address; before the restart nothing changes", "Settings saved. Restart the API and worker to apply changes.; the MCP Server address still shows the old origin", async () => {
  const r = await setInstanceAddress(a.page, V6);
  await gotoMcp(a.page);
  const addr = (await main(a.page)).match(/http\S+\/mcp/)?.[0];
  expectThat(addr === `${DEFAULT}/mcp`, addr);
  return `Field before "${r.before}"; saved "${V6}" → "${r.msg}". Before restart the MCP Server address still reads ${addr}.`;
});
await step({ ...CMo, page: "container" }, "Operator restarts the API and worker", "App answers again", async () => {
  operatorRestart();
  await waitHealthy(LAB.base);
  return "docker compose restart app worker; health check passed.";
});
await a.context.close();
a = await adminAt(V6);
await step({ ...M41, page: "/settings/mcp" }, "Reachability pill on an IPv6-only address: OAuth Clients on shows Not reachable with HTTPS scheme, IPv4 record and Public IPv4 address", "Switch saves (loopback keeps the authorization server); pill names all three checks", async () => {
  await gotoMcp(a.page);
  const addr = (await main(a.page)).match(/http\S+\/mcp/)?.[0];
  const pillBefore = await a.page.getByText(/Not reachable|^Reachable$/).count();
  const status = await setSwitch(a.page, "Legal Users OAuth Clients", true);
  const pill = flat(await a.page.getByRole("status").filter({ hasText: /Not reachable|Reachable/ }).innerText());
  const checked = await a.page.getByRole("switch", { name: "Legal Users OAuth Clients" }).getAttribute("aria-checked");
  await setSwitch(a.page, "Legal Users OAuth Clients", false);
  const pillAfter = await a.page.getByText(/Not reachable|^Reachable$/).count();
  expectThat(addr === `${V6}/mcp` && status === 200 && checked === "true" && pill === "Not reachable · HTTPS scheme, IPv4 record, Public IPv4 address", JSON.stringify({ addr, status, pill }));
  return `Server address ${addr}. Pill before: ${pillBefore}. Legal Users OAuth Clients → PATCH ${status}, switch on; pill "${pill}". Switched off again → pill elements ${pillAfter}.`;
});
await step({ ...M41, page: "/settings/instance" }, "Administrator sets the plain-HTTP LAN Application address http://192.168.50.10:43320", "Settings saved. Restart the API and worker to apply changes.", async () => {
  const r = await setInstanceAddress(a.page, LAN);
  return `Field before "${r.before}"; saved "${LAN}" → "${r.msg}".`;
});
await step({ ...CMo, page: "container" }, "Operator restarts the API and worker after the Instance address change", "App answers again", async () => {
  operatorRestart();
  await waitHealthy(LAB.base);
  return "docker compose restart app worker; health check passed.";
});
await a.context.close();
a = await adminAt(LAN);
await step({ ...M41, page: "/settings/mcp" }, "Negative: on a plain-HTTP LAN address the OAuth Clients switches stay off and the pill names the failed checks, including HTTPS scheme", "PATCH refused; switches off; Not reachable · HTTPS scheme, Public IPv4 address", async () => {
  await gotoMcp(a.page);
  const addr = (await main(a.page)).match(/http\S+\/mcp/)?.[0];
  const s1 = await setSwitch(a.page, "Legal Users OAuth Clients", true);
  await pause(800);
  const legal = await a.page.getByRole("switch", { name: "Legal Users OAuth Clients" }).getAttribute("aria-checked");
  const pill = flat(await a.page.getByRole("status").filter({ hasText: /Not reachable|Reachable/ }).innerText());
  const s2 = await setSwitch(a.page, "Business Users OAuth Clients", true);
  await pause(800);
  const business = await a.page.getByRole("switch", { name: "Business Users OAuth Clients" }).getAttribute("aria-checked");
  const saved = await a.page.getByText("Settings saved.").count();
  expectThat(addr === `${LAN}/mcp` && s1 === 400 && s2 === 400 && legal === "false" && business === "false" && /^Not reachable · HTTPS scheme/.test(pill), JSON.stringify({ addr, s1, s2, legal, business, pill }));
  return `Server address ${addr}. Legal Users OAuth Clients → PATCH ${s1}, switch stays off; Business Users OAuth Clients → PATCH ${s2}, stays off. Pill "${pill}". "Settings saved." elements: ${saved}.`;
});
await step({ ...M41, page: "/settings/mcp" }, "Negative: Add Client and Generate secret fail on the LAN address", "Add Client Save shows the save failure; Generate secret on the template shows the secret failure", async () => {
  await a.page.getByRole("button", { name: "Add Client", exact: true }).click();
  const add = a.page.getByRole("dialog", { name: "Add Client" });
  await add.getByLabel("Client name").fill(`DOC-030 mcp LAN client ${stamp}`);
  await add.getByLabel("Callback URL 1").fill("http://127.0.0.1:43999/callback");
  await add.getByRole("button", { name: "Save", exact: true }).click();
  const addError = flat(await add.getByRole("alert").innerText({ timeout: 10000 }));
  await add.getByRole("button", { name: "Cancel", exact: true }).click();
  await a.page.getByRole("button", { name: "Edit Microsoft 365 Copilot" }).click();
  const edit = a.page.getByRole("dialog", { name: "Edit Client" });
  const generate = edit.getByRole("button", { name: "Generate secret", exact: true });
  await generate.click();
  const genError = flat(await edit.getByRole("alert").innerText({ timeout: 10000 }));
  await edit.getByRole("button", { name: "Cancel", exact: true }).click();
  expectThat(/could not be saved/.test(addError) && /could not be generated/.test(genError), `${addError} | ${genError}`);
  return `Add Client → Save: "${addError}". Edit Microsoft 365 Copilot → Generate secret: "${genError}".`;
});
await step({ ...M41, page: "HTTP" }, "Negative: the well-known documents return 404 on the LAN address", "404 for the OAuth and OpenID discovery documents", async () => {
  const paths = ["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration", "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-authorization-server/api/auth", "/.well-known/openid-configuration/api/auth"];
  const out = [];
  for (const p of paths) out.push(`${p} ${(await lanFetch(`${LAN}${p}`)).status}`);
  expectThat(out.every((o) => o.endsWith(" 404")), out.join(", "));
  return out.join(", ");
});
let lanKey;
await step({ ...M41, page: "/settings/api-keys" }, "API keys work on the LAN address: the Administrator's own key and an SDK Client at the LAN Server address", "Key collected; the Client connects and whoami is Daniel", async () => {
  await gotoMcp(a.page);
  const legalKeys = await a.page.getByRole("switch", { name: "Legal Users API keys" }).getAttribute("aria-checked");
  const nav = await openSettings(a.page);
  await nav.getByRole("link", { name: "API keys", exact: true }).click();
  await a.page.getByRole("button", { name: "Request a key", exact: true }).click();
  const dlg = a.page.getByRole("dialog", { name: "Request an API key" });
  await dlg.getByLabel("Client name").fill(`DOC-030 mcp LAN key ${stamp}`);
  await dlg.getByRole("checkbox", { name: "Contracts", exact: true }).check();
  await dlg.getByRole("radio", { name: /^Read\./ }).check();
  await dlg.getByRole("button", { name: "Send request" }).click();
  const ready = a.page.getByRole("dialog", { name: "Your key is ready" });
  await ready.waitFor();
  // http://192.168.50.10 is not a secure context, so the browser offers no clipboard API.
  const errors = [];
  a.page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));
  const secure = await a.page.evaluate(() => ({ isSecureContext, clipboard: typeof navigator.clipboard }));
  await ready.getByRole("button", { name: "Copy", exact: true }).click();
  await pause(1000);
  const afterCopy = {
    button: flat(await ready.getByRole("button").first().innerText()),
    alert: (await ready.getByRole("alert").count()) ? flat(await ready.getByRole("alert").innerText()) : null,
    pageErrors: errors,
  };
  // The reader falls back to selecting the key text in the dialog.
  lanKey = flat(await ready.locator("code").innerText());
  await ready.getByRole("button", { name: "Done", exact: true }).click();
  await ready.waitFor({ state: "detached" });
  log.runs.lan.lanCopy = { secure, afterCopy };
  save();
  const { client, names } = await connectClient(`${LAN}/mcp`, { "x-api-key": lanKey }, lanFetch);
  const who = await client.callTool({ name: "openlaw_whoami", arguments: {} });
  await client.close();
  expectThat(/Daniel/.test(who.structuredContent?.person?.displayName ?? ""), JSON.stringify(who.structuredContent));
  return `Legal Users API keys ${legalKeys}. On the LAN origin isSecureContext=${secure.isSecureContext}, navigator.clipboard ${secure.clipboard}; Copy → button "${afterCopy.button}", alert ${afterCopy.alert ? `"${afterCopy.alert}"` : "none"}, page errors ${JSON.stringify(afterCopy.pageErrors)}. Key taken by selecting the dialog text (starts ol_: ${lanKey.startsWith("ol_")}). SDK Client at ${LAN}/mcp: ${names.length} Tools; whoami ${who.structuredContent.person.displayName}.`;
});
await step({ ...CMo, page: "/settings/mcp" }, "Private deployment: API keys work at the private Server address; OAuth stays unavailable there", "See the LAN steps above", async () => {
  const lanSteps = log.steps.filter((s) => s.phase === "lan" && s.scenario === "V-M41-MCP");
  expectThat(lanSteps.every((s) => s.result === "pass"), "a LAN step failed");
  return `The LAN-address steps passed: ${lanSteps.map((s) => s.step.slice(0, 50)).join("; ")}.`;
});

// =====================================================================
// Back to the loopback address for the OAuth phase
// =====================================================================
await step({ ...M41, page: "/settings/instance" }, "Administrator sets Application address back to http://127.0.0.1:43320", "Settings saved. Restart the API and worker to apply changes.", async () => {
  const r = await setInstanceAddress(a.page, LAB.base);
  return `Saved "${LAB.base}" → "${r.msg}".`;
});
await step({ ...CMo, page: "container" }, "Operator restarts the API and worker", "App answers; well-known documents answer 200 again", async () => {
  operatorRestart();
  await waitHealthy(LAB.base);
  const wk = await fetch(`${LAB.base}/.well-known/oauth-authorization-server`);
  expectThat(wk.status === 200, `${wk.status}`);
  return `Restarted; /.well-known/oauth-authorization-server now ${wk.status}.`;
});
await a.context.close();
a = await adminAt(LAB.base);
await step({ ...CMa, page: "fixture" }, "Cleanup: revoke the rate-limit and LAN keys; turn Legal Users API keys off again", "Keys revoked", async () => {
  const list = (await api(a.page, LAB.base, "GET", "/api/v1/mcp-settings/api-keys")).body;
  const mine = list.filter((r) => r.clientName.startsWith("DOC-030 mcp") && r.status === "active");
  for (const r of mine) await api(a.page, LAB.base, "POST", `/api/v1/api-key-requests/${r.id}/revoke`);
  const after = await rawToolsList(`${LAB.base}/mcp`, { "x-api-key": lanKey });
  return `Revoked ${mine.length} keys; the LAN key now answers ${after.status}.`;
});
log.runs.lan.articleHashesAtEnd = { "configure-mcp": articleHash("configure-mcp"), "connect-headless-client": articleHash("connect-headless-client") };
save();
await browser.close();
proxy.server.close();
const failed = log.steps.filter((s) => s.phase === "lan" && s.result !== "pass");
console.log(`lan done: ${log.steps.filter((s) => s.phase === "lan").length} steps, ${failed.length} failed`);
process.exit(0);
