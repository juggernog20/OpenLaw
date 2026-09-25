// DOC-030 claude-live, Phase 2: one round per role with the batch owner's live claude.ai session.
//   node phase-round.mjs verify <role> <sinceISO> "<person's report>" [client]
//        server-side checks after the person connected and asked the question
//   node phase-round.mjs disconnect <role> [client]
//        Settings → Personal → API keys → Connected Clients → Disconnect → Revoke (Portal for Business Users)
//   node phase-round.mjs refused <role> <revokedAtISO> "<person's report>" [client]
//        after the person asked again: requests after the revoke answered 401 and no new Tool calls
// Run under pasta --config-net -T 43330,48450 (see phase-browser.mjs). client defaults to "Claude".
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  articleHash,
  compose,
  createLog,
  expectThat,
  flat,
  LAB,
  PEOPLE,
  PUBLIC,
  PW_PATH,
  ROOT,
  waitForMail,
} from "./lib.mjs";

const [cmd, role, arg3, arg4, arg5] = process.argv.slice(2);
const PASSWORD = process.env.LAB_PASSWORD;
if (!PASSWORD || !PEOPLE[role]) throw new Error("usage: phase-round.mjs verify|disconnect|sessions|refused <role> …; LAB_PASSWORD set");
const client = (["disconnect", "sessions", "offer"].includes(cmd) ? arg3 : arg5) ?? "Claude";
const person = PEOPLE[role];
const HOST = new URL(PUBLIC).hostname;
const dns = await (await fetch(`https://cloudflare-dns.com/dns-query?name=${HOST}&type=A`, { headers: { accept: "application/dns-json" } })).json();
const ingress = (dns.Answer ?? []).filter((a) => a.type === 1).map((a) => a.data);
const tag = `round-${role}-${client.replace(/\s+/g, "-").toLowerCase()}${process.env.ROUND ? `-${process.env.ROUND}` : ""}`;
const { log, save, step } = createLog(`${tag}-${cmd}`, { lab: LAB.name, publicOrigin: PUBLIC, client });
const secrets = [PASSWORD];
const S = (page, method = "browser-walkthrough") => ({ article: "connect-claude", scenario: "V-M41-C59", role, method, page, secrets });
const psql = (sql) =>
  execFileSync("docker", ["--context", "default", "exec", `${LAB.project}-postgres-1`, "psql", "-U", "openlaw", "-d", "openlaw", "-At", "-F", "|", "-c", sql], { encoding: "utf8" }).trim();
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const anthropic = (ip) => {
  const [a, b, c] = ip.split(".").map(Number);
  return a === 160 && b === 79 && c >= 104 && c <= 111;
};
function appRequests(sinceMs) {
  const lines = compose(["logs", "--no-color", "--since", new Date(sinceMs).toISOString(), "app"]).split("\n");
  const reqs = new Map();
  for (const l of lines) {
    const i = l.indexOf("{");
    if (i < 0) continue;
    let j;
    try {
      j = JSON.parse(l.slice(i));
    } catch {
      continue;
    }
    if (j.msg === "incoming request") reqs.set(j.reqId, { t: j.time, method: j.req.method, path: j.req.path.split("?")[0], ip: j.req.remoteAddress });
    else if (j.msg === "request completed" && reqs.has(j.reqId)) reqs.get(j.reqId).status = j.res?.statusCode;
  }
  return [...reqs.values()].filter((r) => r.t >= sinceMs);
}
const summarize = (rs) => {
  const m = new Map();
  for (const r of rs) {
    const k = `${r.method} ${r.path} ${r.status ?? "?"} from ${anthropic(r.ip) ? "Anthropic 160.79.104.0/21" : r.ip}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([k, n]) => `${n}× ${k}`).join("; ");
};

// ---------- browser as the person ----------
const { chromium } = await import(PW_PATH);
const browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${HOST} ${ingress[0]}`] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
async function signIn() {
  if (role !== "business_user") {
    await page.goto(`${PUBLIC}/auth/login`);
    await page.getByLabel("Email").fill(person.email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/auth/"), { timeout: 30000 });
    return "password sign-in";
  }
  let mail = null;
  for (let attempt = 1; attempt <= 3 && !mail; attempt++) {
    if (attempt > 1) await page.waitForTimeout(65000);
    await page.goto(`${PUBLIC}/portal/login`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByRole("button", { name: "Email me a sign-in link", exact: true }).click();
    await page.getByLabel("Email").fill(person.email);
    const since = Date.now();
    await page.getByRole("button", { name: "Send link", exact: true }).click();
    mail = await waitForMail(person.email, /sign in/i, since, 20000);
  }
  const link = mail?.text.match(/https?:\/\/[^\s<>"')\]]*magic-link\/verify[^\s<>"')\]]*/)?.[0]?.replace(/[.,]+$/, "");
  expectThat(link, "no magic link");
  await page.goto(link);
  await page.waitForURL(/\/portal/, { timeout: 30000 });
  return "Business Portal sign-in with a fresh magic link (not recorded)";
}
async function openConnectedClients() {
  if (role === "business_user") {
    await page.goto(`${PUBLIC}/portal`);
    await page.getByRole("link", { name: "Notification settings" }).click();
    await page.waitForURL(/\/portal\/settings/);
    await page.getByRole("link", { name: "API keys", exact: true }).click();
    await page.waitForURL(/\/portal\/settings\/api-keys/);
  } else {
    await page.getByRole("banner").getByRole("button", { name: person.name }).click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    await page.waitForURL(/\/settings/);
    await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "API keys", exact: true }).click();
    await page.waitForURL(/\/settings\/api-keys/);
  }
  const region = page.getByRole("region", { name: "Connected Clients" });
  await region.waitFor();
  await page.waitForLoadState("networkidle").catch(() => {});
  return region;
}
const grantRows = () =>
  psql(`select g.id, c.name, array_to_string(g.toolsets, ','), g.scope, g.granted_at, g.expires_at, coalesce(g.last_used_at::text,''), coalesce(g.revoked_at::text,''), coalesce(rb.display_name,'') from oauth_grants g join users u on u.id=g.person_id join allowed_clients c on c.id=g.allowed_client_id left join users rb on rb.id=g.revoked_by where u.email=${q(person.email)} and c.name=${q(client)} order by g.granted_at desc`)
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [id, name, toolsets, scope, grantedAt, expiresAt, lastUsedAt, revokedAt, revokedBy] = l.split("|");
      return { id, name, toolsets, scope, grantedAt, expiresAt, lastUsedAt, revokedAt, revokedBy };
    });
const toolCalls = (sinceIso) =>
  psql(`select t.created_at, t.tool, t.outcome, t.client_name, u.display_name, u.email from mcp_tool_calls t join users u on u.id=t.person_id where t.created_at >= ${q(sinceIso)} order by t.created_at`)
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [at, tool, outcome, clientName, name, email] = l.split("|");
      return { at, tool, outcome, clientName, name, email };
    });

try {
  if (cmd === "verify") {
    const since = arg3;
    const report = arg4 ?? "";
    await step(S("claude.ai", "live-provider-check"), `The person connected ${client} as ${person.name} and asked "Use OpenLaw to tell me who I am, then find and read the guide Connect Claude."`, "The person's report of what Claude answered", async (entry) => {
      entry.personObservation = report;
      return `The person's observation, relayed by the coordinator: "${report}"`;
    });
    await step(S("server: oauth_grants, app log", "live-provider-check"), `Grant row for ${person.name} and ${client}; the vendor's requests reached the lab from Anthropic's egress range`, "One live grant with the chosen Toolsets and scope; requests from 160.79.104.0/21", async () => {
      const g = grantRows();
      const live = g.filter((r) => !r.revokedAt);
      const rs = appRequests(Date.parse(since));
      const vendor = rs.filter((r) => anthropic(r.ip));
      expectThat(live.length === 1, JSON.stringify(g));
      const identity = psql(`select c.metadata_url, oc.redirect_uris::text, oc.token_endpoint_auth_method from allowed_clients c left join oauth_clients oc on oc.client_id = c.metadata_url where c.name=${q(client)}`);
      const token = rs.filter((r) => r.path === "/api/auth/oauth2/token").map((r) => `${r.status} from ${anthropic(r.ip) ? "Anthropic" : r.ip}`);
      return `oauth_grants for ${person.email} and ${client}: ${JSON.stringify(g.map(({ id, ...r }) => r))}. Client identity, stored redirect URIs and auth method (allowed_clients ⋈ oauth_clients): ${identity}. Token endpoint requests: ${JSON.stringify(token)}. App requests since ${since}: ${summarize(rs)}. From Anthropic's range: ${vendor.length}.`;
    });
    await step(S("server: mcp_tool_calls"), `Tool calls since ${since} ran as ${person.name} via ${client}, including openlaw_whoami, openlaw_docs_search and openlaw_docs_read`, "Rows with person = the signed-in person, clientName = the Client, outcome ok", async () => {
      const calls = toolCalls(since);
      const mine = calls.filter((c) => c.email === person.email && c.clientName === client);
      const tools = [...new Set(mine.map((c) => c.tool))];
      expectThat(mine.length > 0 && tools.includes("openlaw_whoami") && mine.every((c) => c.outcome !== "pending"), JSON.stringify(calls));
      return `mcp_tool_calls since ${since}: ${calls.map((c) => `${c.at.slice(11, 19)} ${c.tool} ${c.outcome} as ${c.name} via ${c.clientName}`).join("; ")}. whoami identity: the openlaw_whoami row is attributed to ${mine.find((c) => c.tool === "openlaw_whoami")?.name} (${person.email}); the Tool answers with the credential's person, so its answer names this person.`;
    });
    await step(S("/settings/api-keys (or /portal/settings/api-keys)"), `As ${person.name}: open Connected Clients as the guide says and read the ${client} row`, "Row with Client, Toolsets, Read or Write, Granted date, Last used date and Disconnect", async () => {
      const how = await signIn();
      const region = await openConnectedClients();
      const text = flat(await region.innerText());
      const btn = await region.getByRole("button", { name: `Disconnect ${client}`, exact: true }).count();
      await page.screenshot({ path: new URL(`./connected-clients-${role}.png`, import.meta.url).pathname });
      expectThat(text.includes(client) && btn === 1 && /Granted/.test(text), text);
      return `${how}. Path: ${role === "business_user" ? "Portal header Notification settings → API keys" : "avatar menu Settings → Personal → API keys"} (${new URL(page.url()).pathname}). Connected Clients: "${text.slice(0, 400)}". Disconnect ${client} buttons: ${btn}. Screenshot connected-clients-${role}.png.`;
    });
    await step(S(role === "business_user" ? "/portal/help/connect-claude" : "/help/connect-claude"), "Compare the Guide text with Help: the article Help shows versus the bundled article openlaw_docs_read returns", "Same article text", async () => {
      const bundled = JSON.parse(execFileSync("docker", ["--context", "default", "exec", `${LAB.project}-app-1`, "node", "-e", "const b=require('/app/apps/api/dist/documentation.json');const a=b.articles.find(a=>a.id==='connect-claude');console.log(JSON.stringify({text:a.text,sha:a.contentSha256,unverified:a.unverified,edition:b.edition.id}))"], { encoding: "utf8" }));
      await page.goto(`${PUBLIC}${role === "business_user" ? "/portal/help" : "/help"}/connect-claude`);
      await page.waitForLoadState("networkidle").catch(() => {});
      const article = page.locator("article").first();
      const help = flat((await article.count()) ? await article.innerText() : await page.locator("main").innerText());
      const norm = (s) => flat(s).replace(/[|`*]/g, " ").replace(/\s+/g, " ").replace(/ ([.,;:)])/g, "$1").replace(/\( /g, "(").trim();
      const sentences = norm(bundled.text).split(/(?<=\.)\s/).filter((s) => s.length > 30);
      const missing = sentences.filter((s) => !norm(help).includes(s));
      const found = sentences.filter((s) => norm(help).includes(s)).length;
      const repoSha = articleHash("connect-claude");
      expectThat(found / sentences.length > 0.9, `${found}/${sentences.length}; missing ${JSON.stringify(missing.slice(0, 6))}`);
      return `Help at ${new URL(page.url()).pathname}: "${help.slice(0, 160)}…" (${help.length} chars). Bundled article (the text openlaw_docs_read pages out, edition ${bundled.edition}, contentSha256 ${bundled.sha}, unverified ${bundled.unverified}): ${bundled.text.length} chars; ${found} of ${sentences.length} sentences longer than 30 characters appear verbatim in the Help page (text normalized for whitespace before punctuation and table pipes). Not found: ${JSON.stringify(missing)}. The bundle is built from the pinned commit; the repository guide now hashes ${repoSha}.`;
    });
  } else if (cmd === "disconnect") {
    await step(S("/settings/api-keys (or /portal/settings/api-keys)"), `As ${person.name}: Connected Clients → Disconnect ${client} → Revoke OAuth grant → Revoke`, "The row leaves the list; the grant is revoked by this person", async (entry) => {
      const how = await signIn();
      const region = await openConnectedClients();
      const before = flat(await region.innerText());
      await region.getByRole("button", { name: `Disconnect ${client}`, exact: true }).click();
      const d = page.getByRole("dialog", { name: "Revoke OAuth grant" });
      const dialog = flat(await d.innerText());
      await d.getByRole("button", { name: "Revoke", exact: true }).click();
      await d.waitFor({ state: "detached" });
      const revokedAt = new Date().toISOString();
      entry.revokedAt = revokedAt;
      await page.waitForLoadState("networkidle").catch(() => {});
      const after = flat(await region.innerText());
      const g = grantRows();
      expectThat(!after.includes(`Disconnect ${client}`) && g[0]?.revokedAt && g[0]?.revokedBy === person.name, JSON.stringify({ after, g }));
      console.log(`REVOKED_AT ${revokedAt}`);
      return `${how}. Before: "${before.slice(0, 260)}". Dialog: "${dialog}". After Revoke (${revokedAt}): "${after.slice(0, 200)}". oauth_grants: revoked_at ${g[0].revokedAt}, revoked_by ${g[0].revokedBy}.`;
    });
  } else if (cmd === "offer") {
    await step(S("/auth/consent"), `Reproduce the consent offer for ${person.name}: a fresh authorization request with Claude's published identity asking for all 13 Toolsets and write; stop at consent`, "Offered Toolsets = requested ∩ ceiling ∩ Toolsets with a Tool for this account type", async () => {
      const { createHash, randomBytes } = await import("node:crypto");
      const disc = await (await fetch(`${LAB.loopback}/.well-known/oauth-authorization-server`, { headers: { host: HOST } })).json();
      const how = await signIn();
      const url = `${PUBLIC}/api/auth/oauth2/authorize?${new URLSearchParams({ client_id: "https://claude.ai/oauth/mcp-oauth-client-metadata", redirect_uri: "https://claude.ai/api/mcp/auth_callback", response_type: "code", scope: disc.scopes_supported.join(" "), resource: `${PUBLIC}/mcp`, code_challenge: createHash("sha256").update(randomBytes(40)).digest("base64url"), code_challenge_method: "S256", state: randomBytes(12).toString("base64url") })}`;
      await page.goto(url);
      await page.waitForURL(/\/auth\/consent\?/, { timeout: 30000 });
      await page.getByRole("heading", { level: 1 }).first().waitFor();
      await page.waitForTimeout(500);
      const offered = (await page.getByRole("checkbox").evaluateAll((els) => els.map((e) => e.closest("label")?.textContent?.trim()))).filter(Boolean);
      const radios = await page.getByRole("radio").evaluateAll((els) => els.map((e) => e.closest("label")?.querySelector("span, div")?.textContent?.trim() ?? e.closest("label")?.textContent?.trim().slice(0, 20)));
      const who = flat(await page.locator("body").innerText()).match(/Jonas Weber.{0,60}|Daniel Okafor.{0,60}|Nadia Haddad.{0,60}/)?.[0];
      const shot = `consent-offer-${role}.png`;
      await page.screenshot({ path: new URL(`./${shot}`, import.meta.url).pathname });
      const ceiling = psql("select mcp_toolset_ceiling::text from org_settings");
      return `${how}. Request scope: ${disc.scopes_supported.join(" ")}. Consent page for "${who}". Offered Toolsets (${offered.length}): ${JSON.stringify(offered)}. Scope choices: ${JSON.stringify(radios)}. Organization Toolset ceiling (one list for both groups): ${ceiling}. Allow not selected. Screenshot ${shot}.`;
    });
  } else if (cmd === "sessions") {
    await step(S("/settings/profile"), `As ${person.name}: Settings → Personal → Profile → Sign out other devices, then Sign out, so every OpenLaw browser session of this person ends`, "Other sessions revoked by the app; this session signed out; no live session left", async () => {
      const count = () => Number(psql(`select count(*) from sessions s join users u on u.id=s.user_id where u.email=${q(person.email)} and s.expires_at > now()`));
      const before = count();
      await signIn();
      await page.getByRole("banner").getByRole("button", { name: person.name }).click();
      await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
      await page.waitForURL(/\/settings/);
      await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Profile", exact: true }).click();
      await page.waitForURL(/\/settings\/profile/);
      const resp = page.waitForResponse((r) => /revoke-other-sessions/.test(r.url()));
      await page.getByRole("button", { name: "Sign out other devices", exact: true }).click();
      const status = (await resp).status();
      await page.waitForTimeout(800);
      const afterOthers = count();
      await page.getByRole("banner").getByRole("button", { name: person.name }).click();
      await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
      await page.waitForURL(/\/auth\/login/, { timeout: 30000 });
      await page.waitForTimeout(800);
      const afterAll = count();
      expectThat(status === 200 && afterOthers === 1 && afterAll === 0, JSON.stringify({ before, status, afterOthers, afterAll }));
      return `Live sessions for ${person.email} before: ${before} (plus the one this step opened). Sign out other devices → POST /api/auth/revoke-other-sessions ${status}; live sessions left: ${afterOthers} (this browser). Avatar menu → Sign out → /auth/login; live sessions left: ${afterAll}. Session counts are read from the sessions table; no row was written or deleted by hand.`;
    });
  } else if (cmd === "refused") {
    const revokedAt = arg3;
    const report = arg4 ?? "";
    await step(S("claude.ai", "live-provider-check"), `After Disconnect, the person asked ${client} the same question again`, "The person's report: OpenLaw refused or asked to reconnect", async (entry) => {
      entry.personObservation = report;
      return `The person's observation, relayed by the coordinator: "${report}"`;
    });
    await step(S("server: app log, mcp_tool_calls", "live-provider-check"), "The Client's next calls after Disconnect are refused", "Every /mcp request after the revoke answers 401; no Tool call rows after the revoke", async () => {
      const rs = appRequests(Date.parse(revokedAt));
      const mcp = rs.filter((r) => r.path === "/mcp");
      const calls = toolCalls(revokedAt).filter((c) => c.email === person.email && c.clientName === client);
      expectThat(mcp.length > 0 && mcp.every((r) => r.status === 401) && calls.length === 0, JSON.stringify({ mcp, calls }));
      return `Requests since ${revokedAt}: ${summarize(rs)}. /mcp requests: ${mcp.length}, all 401. Tool call rows for ${person.name} via ${client} after the revoke: ${calls.length}.`;
    });
  }
} finally {
  save();
  await browser.close();
}
console.log(`${tag} ${cmd}: ${log.steps.filter((s) => s.phase === `${tag}-${cmd}`).map((s) => s.result).join(",")}`);
void path;
void ROOT;
void readFileSync;
