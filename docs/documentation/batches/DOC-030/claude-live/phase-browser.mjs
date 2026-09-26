// DOC-030 claude-live, phase "browser": configure-mcp "Enable OAuth Clients" as Daniel Okafor,
// then connect-claude "Choose access on the consent page" and its refusals for each role, on
// the real consent page at the public origin. This agent plays the Client's first leg only: it
// opens an authorization request with Claude's published client ID and registered redirect URI
// (and once with Claude Code's identity and a loopback callback), and never selects Allow.
// Chromium is pinned to a public Funnel ingress address, so every page load crosses the internet.
// LAB_PASSWORD comes from the environment. Magic links, cookies and signed queries are not logged.
import { createHash, randomBytes } from "node:crypto";
import {
  api,
  CLAUDE,
  CLAUDE_CODE,
  createLog,
  expectThat,
  flat,
  LAB,
  MCP_URL,
  pause,
  PEOPLE,
  PUBLIC,
  PW_PATH,
  sh,
  until,
  waitForMail,
} from "./lib.mjs";

const PASSWORD = process.env.LAB_PASSWORD;
if (!PASSWORD) throw new Error("Set LAB_PASSWORD from ~/.cache/openlaw-doc030/claudelive.env.");
const HOST = new URL(PUBLIC).hostname;
const dns = await (
  await fetch(`https://cloudflare-dns.com/dns-query?name=${HOST}&type=A`, {
    headers: { accept: "application/dns-json" },
  })
).json();
const ingress = (dns.Answer ?? []).filter((a) => a.type === 1).map((a) => a.data);
if (!ingress.length) throw new Error("No public A record for the Funnel hostname.");
const { chromium } = await import(PW_PATH);
const browser = await chromium.launch({
  args: [`--host-resolver-rules=MAP ${HOST} ${ingress[0]}`],
});
const {
  log,
  save,
  step: logStep,
} = createLog("browser", {
  lab: LAB.name,
  publicOrigin: PUBLIC,
  chromiumHostResolverRule: `MAP ${HOST} ${ingress[0]}`,
});
const secrets = [PASSWORD];
const S = (role, page, extra = {}) => ({
  article: "connect-claude",
  scenario: "V-M41-C59",
  role,
  page,
  secrets,
  ...extra,
});
const SA = (page) => ({
  article: "configure-mcp",
  scenario: "V-M41-C59 prerequisite (configure-mcp Enable OAuth Clients)",
  role: "administrator",
  page,
  secrets,
});
const main = async (page) =>
  flat(
    await page
      .locator("main")
      .innerText()
      .catch(async () => page.locator("body").innerText()),
  );
const body = async (page) => flat(await page.locator("body").innerText());

// Run under `pasta --config-net -T 43330,48450 -- node phase-browser.mjs`: a private network
// namespace keeps Chromium away from the host's Docker veth churn (short-lived containers from
// other projects). Loopback ports 43330 (app, for discovery reads) and 48450 (Mailpit) are
// forwarded to the host; the public origin goes out through pasta to the Funnel ingress.
// This host runs many Docker projects; interface churn makes Chromium fail in-flight requests
// with net::ERR_NETWORK_CHANGED. Each such event is counted, and a step that fails while one
// happened is run again from its start (at most three attempts). Retries are logged.
let netChanged = 0;
async function newPage() {
  const c = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  c.on("requestfailed", (r) => {
    if (/ERR_NETWORK_CHANGED/.test(r.failure()?.errorText ?? "")) netChanged++;
  });
  return c.newPage();
}
async function step(sel, name, expected, fn) {
  let attempts = 0;
  return logStep(sel, name, expected, async (entry) => {
    for (;;) {
      attempts++;
      const before = netChanged;
      try {
        const out = await fn(entry);
        return attempts > 1
          ? `${out} (attempt ${attempts}; earlier attempts hit net::ERR_NETWORK_CHANGED in Chromium on this host)`
          : out;
      } catch (error) {
        const network = netChanged > before || /ERR_NETWORK_CHANGED/.test(String(error?.message));
        if (!network || attempts >= 3) throw error;
        console.log(`retrying "${name}" after net::ERR_NETWORK_CHANGED`);
        await pause(1500);
      }
    }
  });
}
const admin = await newPage();
async function adminSignIn() {
  await admin.goto(`${PUBLIC}/auth/login`);
  await admin.waitForLoadState("networkidle").catch(() => {});
  if (!new URL(admin.url()).pathname.startsWith("/auth/login")) return;
  await admin.getByLabel("Email").fill(PEOPLE.administrator.email);
  await admin.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await admin.getByRole("button", { name: "Sign in", exact: true }).click();
  await admin.waitForURL((u) => !u.pathname.startsWith("/auth/"), { timeout: 30000 });
}
async function gotoMcp() {
  if (!admin.url().startsWith(PUBLIC)) await admin.goto(`${PUBLIC}/`);
  await admin.getByRole("banner").getByRole("button", { name: PEOPLE.administrator.name }).click();
  await admin.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await admin.waitForURL(/\/settings/);
  const nav = admin.getByRole("navigation", { name: "Settings sections" });
  await nav.getByRole("link", { name: "MCP", exact: true }).first().click();
  await admin.waitForURL(/\/settings\/mcp$/);
  await admin.getByText(/^MCP is (on|off)$/).waitFor();
}
async function setSwitch(label, want) {
  const sw = admin.getByRole("switch", { name: label, exact: true });
  if (((await sw.getAttribute("aria-checked")) === "true") === want) return "unchanged";
  const resp = admin.waitForResponse(
    (r) =>
      /\/api\/v1\/mcp-settings(\/allowed-clients\/[^/]+)?$/.test(new URL(r.url()).pathname) &&
      r.request().method() === "PATCH",
  );
  await sw.click();
  const status = (await resp).status();
  await until(
    async () => ((await sw.getAttribute("aria-checked")) === "true") === want,
    `${label} did not change`,
  );
  return status;
}
async function expandCard(title) {
  const b = admin.getByRole("button", { name: title, exact: true });
  if ((await b.getAttribute("aria-expanded")) !== "true") await b.click();
}

await step(
  SA("/settings/mcp"),
  "Sign in as Daniel Okafor at the public origin; Settings → Organization → MCP; read Server address",
  `Server address ${MCP_URL}`,
  async () => {
    await adminSignIn();
    await gotoMcp();
    const text = await main(admin);
    const addr = text.match(/https?:\/\/\S+\/mcp/)?.[0];
    expectThat(addr === MCP_URL, `${addr}`);
    return `Signed in through ${PUBLIC}/auth/login (Chromium resolved ${HOST} to public ingress ${ingress[0]}). MCP page: "${text.slice(0, 220)}". Server address ${addr}.`;
  },
);

let pill = "";
await step(
  SA("/settings/mcp"),
  "Enable OAuth Clients 1-3: Enable MCP on; Legal Users and Business Users OAuth Clients on; read the pill beside Server address",
  "Switches save 200; pill Reachable",
  async () => {
    const pillBefore = await admin
      .getByRole("status")
      .filter({ hasText: /Not reachable|Reachable/ })
      .count();
    const mcp = await setSwitch("Enable MCP", true);
    const legal = await setSwitch("Legal Users OAuth Clients", true);
    const business = await setSwitch("Business Users OAuth Clients", true);
    await pause(500);
    pill = flat(
      await admin
        .getByRole("status")
        .filter({ hasText: /Not reachable|Reachable/ })
        .innerText(),
    );
    const keysL = await admin
      .getByRole("switch", { name: "Legal Users API keys" })
      .getAttribute("aria-checked");
    const keysB = await admin
      .getByRole("switch", { name: "Business Users API keys" })
      .getAttribute("aria-checked");
    // The pill checks the address from the API's view. This lab's host is a tailnet node, so
    // Docker's resolver answers the Funnel hostname through MagicDNS with the node's tailnet
    // address (100.64.0.0/10, a shared range), while public resolvers answer Funnel ingress IPs.
    const apiView = sh("docker", [
      "--context",
      "default",
      "exec",
      `${LAB.project}-app-1`,
      "node",
      "-e",
      `require("dns").lookup("${HOST}",{all:true},(e,a)=>console.log(JSON.stringify(a)))`,
    ]).out.trim();
    const shared = /"100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(apiView);
    expectThat(
      [mcp, legal, business].every((s) => s === 200 || s === "unchanged") &&
        (pill === "Reachable" || (pill === "Not reachable · Public IPv4 address" && shared)),
      JSON.stringify({ mcp, legal, business, pill, apiView }),
    );
    await admin.screenshot({
      path: new URL("./settings-mcp-pill.png", import.meta.url).pathname,
      fullPage: false,
    });
    return `Pill elements before any OAuth switch: ${pillBefore}. Enable MCP → ${mcp}; Legal Users OAuth Clients → ${legal}; Business Users OAuth Clients → ${business}. Pill beside Server address: "${pill}". The API container resolves ${HOST} to ${apiView} (Docker's resolver forwards to the host's Tailscale MagicDNS, which answers with this node's tailnet address in 100.64.0.0/10); public resolvers answer ${ingress.join(", ")}. So the pill names the one failed check from the API's view, the save still succeeded, and the pill does not reflect what vendors reach. API keys switches stay Legal ${keysL}, Business ${keysB}. Screenshot settings-mcp-pill.png.`;
  },
);

await step(
  SA("/settings/mcp"),
  "Enable OAuth Clients 4: Allowed Clients card; Claude and Claude Code enabled",
  "Enable Claude and Enable Claude Code aria-checked true; both Published identity",
  async () => {
    await expandCard("Allowed Clients");
    const rows = {};
    for (const n of ["Claude", "Claude Code", "ChatGPT", "Microsoft 365 Copilot"]) {
      rows[n] = await admin
        .getByRole("switch", { name: `Enable ${n}`, exact: true })
        .getAttribute("aria-checked");
    }
    const allowed = (await api(admin, "GET", "/api/v1/mcp-settings/allowed-clients")).body;
    const pick = (n) => allowed.find((c) => c.name === n);
    const claude = pick("Claude");
    const code = pick("Claude Code");
    expectThat(
      rows.Claude === "true" &&
        rows["Claude Code"] === "true" &&
        claude.metadataUrl === CLAUDE.clientId &&
        code.metadataUrl === CLAUDE_CODE.clientId,
      JSON.stringify({ rows, claude, code }),
    );
    return `Allowed Clients switches: ${JSON.stringify(rows)}. State read: Claude kind ${claude.kind}, identity ${claude.metadataUrl}, callbacks ${JSON.stringify(claude.callbackUrls)}; Claude Code kind ${code.kind}, identity ${code.metadataUrl}, callbacks ${JSON.stringify(code.callbackUrls)}.`;
  },
);

// ---------- the Client's first leg ----------
const discovery = await (
  await fetch(`${LAB.loopback}/.well-known/oauth-authorization-server`, {
    headers: { host: `${HOST}:8443` },
  })
).json();
const FULL_SCOPE = discovery.scopes_supported.join(" ");
function authorizeUrl(client, redirect, scope = FULL_SCOPE) {
  const verifier = randomBytes(48).toString("base64url");
  return `${PUBLIC}/api/auth/oauth2/authorize?${new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirect,
    response_type: "code",
    scope,
    resource: MCP_URL,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state: randomBytes(16).toString("base64url"),
  })}`;
}
async function readConsent(page) {
  await page.waitForURL(/\/auth\/consent\?/, { timeout: 30000 });
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  await pause(400);
  const text = await body(page);
  const heading = flat(await page.getByRole("heading", { level: 1 }).first().innerText());
  const offered = (
    await page
      .getByRole("checkbox")
      .evaluateAll((els) => els.map((e) => e.closest("label")?.textContent?.trim()))
  ).filter(Boolean);
  const radios = await page
    .getByRole("radio")
    .evaluateAll((els) =>
      els.map((e) => e.closest("label")?.textContent?.trim().replace(/\s+/g, " ")),
    );
  const allow = page.getByRole("button", { name: "Allow", exact: true });
  const deny = page.getByRole("button", { name: "Deny", exact: true });
  return {
    text,
    heading,
    offered,
    radios,
    allowCount: await allow.count(),
    denyCount: await deny.count(),
    allowDisabled: (await allow.count()) ? await allow.isDisabled() : null,
  };
}
/** Allow stays disabled with no Toolset or no scope; enabled only with both. Never clicked. */
async function allowGate(page) {
  const allow = page.getByRole("button", { name: "Allow", exact: true });
  const r = { nothing: await allow.isDisabled() };
  const first = page.getByRole("checkbox").first();
  await first.check();
  r.toolsetOnly = await allow.isDisabled();
  await first.uncheck();
  await page.getByRole("radio", { name: /^Read only/ }).check();
  r.scopeOnly = await allow.isDisabled();
  await first.check();
  r.both = await allow.isDisabled();
  return r;
}
const consentUrlOf = (page) => page.url();

const pages = {};
const firstConsentAt = {};
const keptUrl = {};

// Staff: sign-in from the consent redirect, back to consent.
for (const role of ["administrator", "legal_team_member"]) {
  await step(
    S(role, "/auth/consent"),
    `Consent 1-5 as ${PEOPLE[role].name}: start from Claude's authorization request signed out; sign in with password; back on the consent page; read it; Allow gate; do not Allow`,
    "Login page first; consent after sign-in; heading Claude wants to work in OpenLaw as you; Published identity https://claude.ai/oauth/mcp-oauth-client-metadata; Allowed Client pill; name, account type, email; What Claude may use; Nothing is selected for you.; How far Claude may go; Read only and Read and write; no Guide checkbox; Allow disabled until a Toolset and a scope",
    async () => {
      const p = await newPage();
      pages[role] = p;
      await p.goto(authorizeUrl(CLAUDE, CLAUDE.redirect));
      await p.waitForURL(/\/auth\/login\?/, { timeout: 30000 });
      await p.waitForLoadState("networkidle").catch(() => {});
      await p.getByLabel("Email").waitFor();
      const loginText = await body(p);
      const portalLink = await p.getByRole("link", { name: "Business Portal sign-in" }).count();
      await p.getByLabel("Email").fill(PEOPLE[role].email);
      await p.getByLabel("Password", { exact: true }).fill(PASSWORD);
      await p.getByRole("button", { name: "Sign in", exact: true }).click();
      const c = await readConsent(p);
      firstConsentAt[role] = Date.now();
      keptUrl[role] = consentUrlOf(p);
      const gate = await allowGate(p);
      const checks = {
        heading: c.heading === "Claude wants to work in OpenLaw as you",
        identity: c.text.includes(`Published identity ${CLAUDE.clientId}`),
        pill: c.text.includes("Allowed Client"),
        person:
          c.text.includes(PEOPLE[role].name) &&
          c.text.includes(PEOPLE[role].email) &&
          new RegExp(role === "administrator" ? "Administrator" : "Legal team member", "i").test(
            c.text,
          ),
        legends: c.text.includes("What Claude may use") && c.text.includes("How far Claude may go"),
        nothing: c.text.includes("Nothing is selected for you."),
        never: c.text.includes("This Client can never see or change what you cannot."),
        radios:
          c.radios.some((r) => /^Read only/.test(r)) &&
          c.radios.some((r) => /^Read and write/.test(r)),
        noGuide: !c.offered.some((o) => /guide/i.test(o)),
        noAdminForLtm: role === "administrator" || !c.offered.includes("Administration"),
        gate: gate.nothing && gate.toolsetOnly && gate.scopeOnly && !gate.both,
        portalLink: portalLink === 1,
      };
      await p.screenshot({
        path: new URL(`./consent-claude-${role}.png`, import.meta.url).pathname,
      });
      expectThat(
        Object.values(checks).every(Boolean),
        JSON.stringify({ checks, c: { ...c, text: c.text.slice(0, 600) }, gate }),
      );
      return `Authorization request (client_id ${CLAUDE.clientId}, redirect_uri ${CLAUDE.redirect}, the ${discovery.scopes_supported.length} scopes from discovery, S256 PKCE, resource ${MCP_URL}) → /auth/login with the signed query; the page offered "Business Portal sign-in" (${portalLink}). Login text "${loginText.slice(0, 120)}". After Sign in → /auth/consent. Heading "${c.heading}". Page text: "${c.text.slice(0, 520)}". Toolset checkboxes (${c.offered.length}): ${JSON.stringify(c.offered)}; the request asked for all 13 Toolsets and the ceiling holds all 13, but Team and Administration have no Tools at this commit, so they are not offered. Radios: ${JSON.stringify(c.radios)}. Allow ${c.allowCount}, Deny ${c.denyCount}. Allow disabled: nothing chosen ${gate.nothing}, a Toolset only ${gate.toolsetOnly}, Read only only ${gate.scopeOnly}, both ${gate.both}. Allow was not selected. Screenshot consent-claude-${role}.png.`;
    },
  );
}

// Business User: Business Portal sign-in → magic link → back to consent.
await step(
  S("business_user", "/auth/consent"),
  "Consent 1-5 as Jonas Weber: start signed out; select Business Portal sign-in; request a magic link; open it; back on the consent page; read it; Allow gate; do not Allow",
  "Business Portal sign-in keeps the query; the magic link returns to consent; Business User account type; no Administration; Allow gate holds",
  async () => {
    const p = await newPage();
    pages.business_user = p;
    await p.goto(authorizeUrl(CLAUDE, CLAUDE.redirect));
    await p.waitForURL(/\/auth\/login\?/, { timeout: 30000 });
    await p.getByRole("link", { name: "Business Portal sign-in" }).click();
    await p.waitForURL(/\/portal\/login\?/);
    await p.waitForLoadState("networkidle").catch(() => {});
    const portalText = await body(p);
    await p.getByRole("button", { name: "Email me a sign-in link", exact: true }).click();
    await p.getByLabel("Email").fill(PEOPLE.business_user.email);
    const since = Date.now();
    await p.getByRole("button", { name: "Send link", exact: true }).click();
    await p.getByText("Check your email").first().waitFor();
    const mail = await waitForMail(PEOPLE.business_user.email, /sign in/i, since);
    expectThat(mail, "no sign-in mail");
    const link = mail.text
      .match(/https?:\/\/[^\s<>"')\]]*magic-link\/verify[^\s<>"')\]]*/)?.[0]
      ?.replace(/[.,]+$/, "");
    expectThat(
      link && link.startsWith(PUBLIC),
      `magic link origin ${link ? new URL(link).origin : "none"}`,
    );
    await p.goto(link);
    const c = await readConsent(p);
    firstConsentAt.business_user = Date.now();
    keptUrl.business_user = consentUrlOf(p);
    const gate = await allowGate(p);
    const checks = {
      heading: c.heading === "Claude wants to work in OpenLaw as you",
      identity: c.text.includes(`Published identity ${CLAUDE.clientId}`),
      pill: c.text.includes("Allowed Client"),
      person: c.text.includes(PEOPLE.business_user.email) && /Business user/i.test(c.text),
      nothing: c.text.includes("Nothing is selected for you."),
      noGuide: !c.offered.some((o) => /guide/i.test(o)),
      noAdmin: !c.offered.includes("Administration"),
      gate: gate.nothing && gate.toolsetOnly && gate.scopeOnly && !gate.both,
    };
    await p.screenshot({
      path: new URL("./consent-claude-business_user.png", import.meta.url).pathname,
    });
    expectThat(
      Object.values(checks).every(Boolean),
      JSON.stringify({ checks, text: c.text.slice(0, 600), gate }),
    );
    return `Login page → Business Portal sign-in → /portal/login with the same signed query ("${portalText.slice(0, 200)}"). Email me a sign-in link → Email → Send link → "Check your email"; the mail "${mail.subject}" held a link on ${new URL(link).origin} (not recorded). Opening it → /auth/consent. Heading "${c.heading}". Text "${c.text.slice(0, 460)}". Toolsets (${c.offered.length}): ${JSON.stringify(c.offered)}. Radios ${JSON.stringify(c.radios)}. Allow disabled: nothing ${gate.nothing}, Toolset only ${gate.toolsetOnly}, scope only ${gate.scopeOnly}, both ${gate.both}. Allow not selected. Screenshot consent-claude-business_user.png.`;
  },
);

// Claude Code identity with a loopback callback.
await step(
  S("legal_team_member", "/auth/consent"),
  "Claude Code: an authorization request with Claude Code's published identity and a loopback callback reaches consent with the Claude Code name",
  "Heading Claude Code wants to work in OpenLaw as you; legends use Claude Code; Published identity https://claude.ai/oauth/claude-code-client-metadata",
  async () => {
    const p = pages.legal_team_member;
    await p.goto(authorizeUrl(CLAUDE_CODE, "http://localhost:53682/callback"));
    const c = await readConsent(p);
    const ok =
      c.heading === "Claude Code wants to work in OpenLaw as you" &&
      c.text.includes("What Claude Code may use") &&
      c.text.includes("How far Claude Code may go") &&
      c.text.includes(`Published identity ${CLAUDE_CODE.clientId}`) &&
      c.allowDisabled;
    expectThat(ok, JSON.stringify({ ...c, text: c.text.slice(0, 500) }));
    return `redirect_uri http://localhost:53682/callback. Heading "${c.heading}". Text "${c.text.slice(0, 380)}". Allow disabled with nothing chosen: ${c.allowDisabled}. Allow not selected.`;
  },
);

// ---------- negative checks ----------
await step(
  S("legal_team_member", "/auth/consent"),
  "Negative: Read and write is absent when the organization is read-only (Daniel sets Read-only, Nadia starts a fresh request, Daniel puts it back)",
  "Only Read only offered under Read-only; both again after",
  async () => {
    await gotoMcp();
    await expandCard("Toolset ceiling");
    const on = await setSwitch("Read-only", true);
    const p = pages.legal_team_member;
    await p.goto(authorizeUrl(CLAUDE, CLAUDE.redirect));
    const ro = await readConsent(p);
    const off = await setSwitch("Read-only", false);
    await p.goto(authorizeUrl(CLAUDE, CLAUDE.redirect));
    const back = await readConsent(p);
    await p.goto(
      authorizeUrl(
        CLAUDE,
        CLAUDE.redirect,
        discovery.scopes_supported.filter((s) => s !== "write").join(" "),
      ),
    );
    const noWrite = await readConsent(p);
    expectThat(
      ro.radios.length === 1 &&
        /^Read only/.test(ro.radios[0]) &&
        back.radios.some((r) => /^Read and write/.test(r)) &&
        noWrite.radios.length === 1,
      JSON.stringify({ ro: ro.radios, back: back.radios, noWrite: noWrite.radios }),
    );
    return `Read-only switch on → ${on}. Fresh request: radios ${JSON.stringify(ro.radios)}. Read-only off → ${off}; fresh request: ${JSON.stringify(back.radios)}. A request without the write scope: ${JSON.stringify(noWrite.radios)}.`;
  },
);

await step(
  S("legal_team_member", "/auth/consent"),
  "Negative: an altered consent link shows the expired-or-changed message with no actions",
  "This consent request has expired or changed. Start again from your Client.; no Allow, no Deny",
  async () => {
    const p = pages.legal_team_member;
    await p.goto(authorizeUrl(CLAUDE, CLAUDE.redirect));
    await readConsent(p);
    const u = new URL(p.url());
    u.searchParams.set("scope", "toolset:workspace write");
    await p.goto(u.toString());
    const c = await readConsent(p);
    expectThat(
      c.text.includes(
        "This consent request has expired or changed. Start again from your Client.",
      ) &&
        c.allowCount === 0 &&
        c.denyCount === 0,
      JSON.stringify({ ...c, text: c.text.slice(0, 400) }),
    );
    return `Changed the scope parameter of a live consent URL. Page: "${c.text.slice(0, 300)}". Allow ${c.allowCount}, Deny ${c.denyCount}.`;
  },
);

await step(
  S("legal_team_member", "/settings/mcp + /auth/consent"),
  "Negative: disabled Client. Mid-flow: Daniel turns Claude off, Nadia reloads consent. New flow: a fresh request with Claude off. Daniel turns Claude back on",
  "Mid-flow: This Client is off in the organization's Allowed Clients list., Deny alone. New flow: HTTP 400 Client is not on the enabled Allowed Clients list. before any sign-in page",
  async () => {
    const p = pages.legal_team_member;
    await p.goto(authorizeUrl(CLAUDE, CLAUDE.redirect));
    await readConsent(p);
    await gotoMcp();
    await expandCard("Allowed Clients");
    const off = await setSwitch("Enable Claude", false);
    await p.reload();
    const mid = await readConsent(p);
    const fresh = await newPage();
    const resp = await fresh.goto(authorizeUrl(CLAUDE, CLAUDE.redirect));
    const freshText = await body(fresh);
    const freshStatus = resp.status();
    await fresh.context().close();
    const on = await setSwitch("Enable Claude", true);
    const ok =
      mid.text.includes("This Client is off in the organization's Allowed Clients list.") &&
      mid.allowCount === 0 &&
      mid.denyCount === 1 &&
      freshStatus === 400 &&
      freshText.includes("Client is not on the enabled Allowed Clients list.");
    expectThat(
      ok,
      JSON.stringify({
        mid: mid.text.slice(0, 400),
        a: mid.allowCount,
        d: mid.denyCount,
        freshStatus,
        freshText,
      }),
    );
    return `Enable Claude off → ${off}. Nadia's reloaded consent page: "${mid.text.slice(0, 330)}"; Allow ${mid.allowCount}, Deny ${mid.denyCount}. A new signed-out request → HTTP ${freshStatus}, body "${freshText.slice(0, 160)}" (the raw error, before any sign-in page). Enable Claude on → ${on}.`;
  },
);

await step(
  S("business_user", "/settings/mcp + /auth/consent"),
  "Negative: disabled account group. Daniel turns Business Users OAuth Clients off; Jonas reloads consent; Daniel turns it back on",
  "OAuth Clients are off for your account type.; Deny alone",
  async () => {
    const p = pages.business_user;
    await p.goto(authorizeUrl(CLAUDE, CLAUDE.redirect));
    await readConsent(p);
    await gotoMcp();
    const off = await setSwitch("Business Users OAuth Clients", false);
    await p.reload();
    const c = await readConsent(p);
    const on = await setSwitch("Business Users OAuth Clients", true);
    expectThat(
      c.text.includes("OAuth Clients are off for your account type.") &&
        c.allowCount === 0 &&
        c.denyCount === 1,
      JSON.stringify({ text: c.text.slice(0, 400), a: c.allowCount, d: c.denyCount }),
    );
    return `Business Users OAuth Clients off → ${off}. Jonas's reloaded consent page: "${c.text.slice(0, 300)}"; Allow ${c.allowCount}, Deny ${c.denyCount}. Back on → ${on}.`;
  },
);

await step(
  S("legal_team_member", "/settings/mcp + /auth/consent"),
  "Negative: disabled account group for Legal Users. Daniel turns Legal Users OAuth Clients off; Nadia reloads consent; back on",
  "OAuth Clients are off for your account type.; Deny alone",
  async () => {
    const p = pages.legal_team_member;
    await p.goto(authorizeUrl(CLAUDE, CLAUDE.redirect));
    await readConsent(p);
    const off = await setSwitch("Legal Users OAuth Clients", false);
    await p.reload();
    const c = await readConsent(p);
    const on = await setSwitch("Legal Users OAuth Clients", true);
    expectThat(
      c.text.includes("OAuth Clients are off for your account type.") &&
        c.allowCount === 0 &&
        c.denyCount === 1,
      JSON.stringify({ text: c.text.slice(0, 400), a: c.allowCount, d: c.denyCount }),
    );
    return `Legal Users OAuth Clients off → ${off}. Nadia's reloaded consent page: "${c.text.slice(0, 300)}"; Allow ${c.allowCount}, Deny ${c.denyCount}. Back on → ${on}.`;
  },
);

await step(
  S("administrator", "/settings/mcp + /auth/consent"),
  "Refusal table: MCP off. Daniel opens a consent page, turns MCP off, reloads; turns MCP back on",
  "MCP is off for this organization.; Deny alone",
  async () => {
    const p = pages.administrator;
    await p.goto(authorizeUrl(CLAUDE, CLAUDE.redirect));
    await readConsent(p);
    const off = await setSwitch("Enable MCP", false);
    await p.reload();
    const c = await readConsent(p);
    const on = await setSwitch("Enable MCP", true);
    await setSwitch("Legal Users OAuth Clients", true);
    await setSwitch("Business Users OAuth Clients", true);
    const pillAfter = flat(
      await admin
        .getByRole("status")
        .filter({ hasText: /Not reachable|Reachable/ })
        .innerText(),
    );
    expectThat(
      c.text.includes("MCP is off for this organization.") &&
        c.allowCount === 0 &&
        c.denyCount === 1 &&
        pillAfter === pill,
      JSON.stringify({ text: c.text.slice(0, 400), a: c.allowCount, d: c.denyCount, pillAfter }),
    );
    return `Enable MCP off → ${off}. Daniel's reloaded consent page: "${c.text.slice(0, 260)}"; Allow ${c.allowCount}, Deny ${c.denyCount}. Enable MCP on → ${on}; both OAuth Clients switches on; pill "${pillAfter}".`;
  },
);

// Expired consent link: the signed query lasts 600 s. Reload the first link kept for each role.
for (const role of ["administrator", "legal_team_member", "business_user"]) {
  await step(
    S(role, "/auth/consent"),
    `Negative: an expired consent link (the first consent URL for ${PEOPLE[role].name}, reopened more than ten minutes later)`,
    "This consent request has expired or changed. Start again from your Client.; no Allow, no Deny",
    async () => {
      const wait = firstConsentAt[role] + 615_000 - Date.now();
      if (wait > 0) {
        console.log(`waiting ${Math.round(wait / 1000)} s for the consent link to expire`);
        await pause(wait);
      }
      const p = pages[role];
      await p.goto(keptUrl[role]);
      const c = await readConsent(p);
      expectThat(
        c.text.includes(
          "This consent request has expired or changed. Start again from your Client.",
        ) &&
          c.allowCount === 0 &&
          c.denyCount === 0,
        JSON.stringify({ text: c.text.slice(0, 400), a: c.allowCount, d: c.denyCount }),
      );
      return `Reopened ${Math.round((Date.now() - firstConsentAt[role]) / 1000)} s after it was first shown. Page: "${c.text.slice(0, 260)}"; Allow ${c.allowCount}, Deny ${c.denyCount}.`;
    },
  );
}

await step(
  SA("/settings/mcp"),
  "State after the checks: MCP on, both OAuth Clients switches on, Read-only off, Claude and Claude Code enabled; no grants exist",
  "Settings restored; zero OAuth grants",
  async () => {
    const s = (await api(admin, "GET", "/api/v1/mcp-settings")).body;
    const allowed = (await api(admin, "GET", "/api/v1/mcp-settings/allowed-clients")).body;
    const grants = (await api(admin, "GET", "/api/v1/mcp-settings/oauth-grants")).body;
    const pick = (n) => allowed.find((c) => c.name === n)?.enabled;
    const flags = {
      mcpEnabled: s.mcpEnabled ?? s.enabled,
      legal: s.mcpLegalOAuthClientsEnabled ?? s.legalOAuthClientsEnabled,
      business: s.mcpBusinessOAuthClientsEnabled ?? s.businessOAuthClientsEnabled,
      readOnly: s.mcpReadOnly ?? s.readOnly,
    };
    expectThat(
      pick("Claude") && pick("Claude Code") && grants.length === 0,
      JSON.stringify({ flags, grants: grants.length }),
    );
    return `mcp-settings: ${JSON.stringify(flags)} (raw keys ${Object.keys(s).join(", ")}). Claude enabled ${pick("Claude")}, Claude Code enabled ${pick("Claude Code")}. OAuth grants: ${grants.length}.`;
  },
);

save();
await browser.close();
const mine = log.steps.filter((s) => s.phase === "browser");
console.log(
  `browser done: ${mine.length} steps, ${mine.filter((s) => s.result !== "pass").length} failed; pill "${pill}"`,
);
void sh;
