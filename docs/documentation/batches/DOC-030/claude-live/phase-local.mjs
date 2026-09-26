// DOC-030 claude-live, phase "local": connect-claude claims that need no vendor, on the owned
// loopback lab claudelocal (http://127.0.0.1:43340, never exposed; OAuth runs on a loopback
// BASE_URL, which the guide allows for development). This agent plays the Client's protocol
// legs with fetch (authorization request, PKCE token exchange as a public client, /mcp calls);
// every OpenLaw screen step runs in the browser as the named role.
// Run under: pasta --config-net -T 43340,48460 -- node phase-local.mjs   (LAB_PASSWORD = seed password)
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import { createLog, expectThat, flat, pause, PEOPLE, PW_PATH, until } from "./lib.mjs";

const PASSWORD = process.env.LAB_PASSWORD;
if (!PASSWORD) throw new Error("Set LAB_PASSWORD to the seed password.");
const BASE = "http://127.0.0.1:43340";
const MAIL = "http://127.0.0.1:48460";
const MCP = `${BASE}/mcp`;
const CLAUDE = {
  name: "Claude",
  id: "https://claude.ai/oauth/mcp-oauth-client-metadata",
  redirect: "https://claude.ai/api/mcp/auth_callback",
};
const CODE = { name: "Claude Code", id: "https://claude.ai/oauth/claude-code-client-metadata" };
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(4, 12);
const CC_ONLY = process.env.PARTS === "cc";
const { log, save, step } = createLog(CC_ONLY ? "local-cc" : "local", {
  lab: "claudelocal",
  environment: "openlaw-docs-80ceef9e-claudelocal",
  appUrl: BASE,
  note: "Loopback lab, not exposed. Compose was started with the extra file overlay-subnets.json (explicit 10.231.40.0/24 and 10.231.41.0/24 subnets) because Docker's predefined address pools on this host were exhausted; lab.mjs built the images and seeded the lab. The host firewall admits container DNS only from Docker's default ranges, so the same file gives app and worker public resolvers (1.1.1.1, 9.9.9.9) so the API can fetch Claude's published identity. A first run failed every Claude and Claude Code authorization request at that fetch (connect timeout, then EAI_AGAIN). The seed password is used; the lab is reachable only on 127.0.0.1.",
});
const S = (role, page) => ({
  article: "connect-claude",
  scenario: "V-M41-C59",
  role,
  method: "browser-walkthrough",
  page,
  secrets: [PASSWORD],
});

const { chromium } = await import(PW_PATH);
const browser = await chromium.launch();
async function ctx() {
  const c = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // Claude's callback lives at claude.ai; the browser's redirect there is captured, not sent.
  c.captured = [];
  await c.route("https://claude.ai/**", (route) => {
    c.captured.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: "DOC-030 captured Claude callback",
    });
  });
  return c;
}
async function mail(address, since) {
  for (let i = 0; i < 60; i++) {
    const r = await (
      await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}&limit=5`)
    ).json();
    const m = (r.messages ?? []).find(
      (x) => new Date(x.Created).getTime() >= since - 1500 && /sign in/i.test(x.Subject),
    );
    if (m) return (await (await fetch(`${MAIL}/api/v1/message/${m.ID}`)).json()).Text;
    await pause(1000);
  }
  return null;
}
async function signIn(page, role) {
  const p = PEOPLE[role];
  if (role !== "business_user") {
    await page.goto(`${BASE}/auth/login`);
    await page.getByLabel("Email").fill(p.email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/auth/"), { timeout: 30000 });
    return;
  }
  await page.goto(`${BASE}/portal/login`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByRole("button", { name: "Email me a sign-in link", exact: true }).click();
  await page.getByLabel("Email").fill(p.email);
  const since = Date.now();
  await page.getByRole("button", { name: "Send link", exact: true }).click();
  const text = await mail(p.email, since);
  const link = text
    ?.match(/https?:\/\/[^\s<>"')\]]*magic-link\/verify[^\s<>"')\]]*/)?.[0]
    ?.replace(/[.,]+$/, "");
  expectThat(link, "no magic link");
  await page.goto(link);
  await page.waitForURL(/\/portal/, { timeout: 30000 });
}
const pages = {};
for (const role of CC_ONLY
  ? ["administrator", "legal_team_member"]
  : ["administrator", "legal_team_member", "business_user"]) {
  pages[role] = await (await ctx()).newPage();
  await signIn(pages[role], role);
}
const admin = pages.administrator;

async function gotoMcp() {
  await admin.goto(`${BASE}/`);
  await admin.getByRole("banner").getByRole("button", { name: PEOPLE.administrator.name }).click();
  await admin.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await admin
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("link", { name: "MCP", exact: true })
    .first()
    .click();
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

// ---------- the Client's protocol legs ----------
function authorizeUrl(clientId, redirect, scope, extra = {}) {
  const verifier = randomBytes(48).toString("base64url");
  const state = randomBytes(12).toString("base64url");
  const url = `${BASE}/api/auth/oauth2/authorize?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: "code",
    scope,
    resource: MCP,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state,
    ...extra,
  })}`;
  return { url, verifier, state };
}
async function consentPage(page) {
  await page.waitForURL(/\/auth\/consent\?/, { timeout: 30000 });
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  await pause(400);
  return {
    text: flat(await page.locator("body").innerText()),
    heading: flat(await page.getByRole("heading", { level: 1 }).first().innerText()),
    allow: await page.getByRole("button", { name: "Allow", exact: true }).count(),
    deny: await page.getByRole("button", { name: "Deny", exact: true }).count(),
  };
}
async function allow(page, toolsets, write) {
  for (const t of toolsets) await page.getByRole("checkbox", { name: t, exact: true }).check();
  await page.getByRole("radio", { name: write ? /^Read and write/ : /^Read only/ }).check();
  await page.getByRole("button", { name: "Allow", exact: true }).click();
}
async function token(clientId, code, redirect, verifier) {
  const r = await fetch(`${BASE}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: redirect,
      code_verifier: verifier,
      resource: MCP,
    }),
  });
  let body = null;
  try {
    body = await r.json();
  } catch {}
  return { status: r.status, body };
}
async function toolsList(access) {
  const r = await fetch(MCP, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      authorization: `Bearer ${access}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  const text = await r.text();
  let names = [];
  try {
    const j = JSON.parse(
      text.includes("data:")
        ? text
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5))
            .join("")
        : text,
    );
    names = j.result?.tools?.map((t) => t.name) ?? [];
  } catch {}
  return { status: r.status, names, www: r.headers.get("www-authenticate") };
}

if (!CC_ONLY) {
  // =====================================================================
  await step(
    S("administrator", "/settings/mcp"),
    "Setup as Daniel Okafor: Enable MCP, Legal Users and Business Users OAuth Clients on; Claude and Claude Code enabled",
    "Switches save",
    async () => {
      await gotoMcp();
      const r = [
        await setSwitch("Enable MCP", true),
        await setSwitch("Legal Users OAuth Clients", true),
        await setSwitch("Business Users OAuth Clients", true),
      ];
      const pill = flat(
        await admin
          .getByRole("status")
          .filter({ hasText: /Not reachable|Reachable/ })
          .innerText(),
      );
      await expandCard("Allowed Clients");
      const en = [
        await admin
          .getByRole("switch", { name: "Enable Claude", exact: true })
          .getAttribute("aria-checked"),
        await admin
          .getByRole("switch", { name: "Enable Claude Code", exact: true })
          .getAttribute("aria-checked"),
      ];
      expectThat(
        r.every((x) => x === 200 || x === "unchanged") && en.every((x) => x === "true"),
        JSON.stringify({ r, en }),
      );
      return `Enable MCP, Legal Users OAuth Clients, Business Users OAuth Clients → ${JSON.stringify(r)}. Pill "${pill}" (loopback http Instance address). Enable Claude ${en[0]}, Enable Claude Code ${en[1]}.`;
    },
  );

  const grants = {};
  for (const role of ["administrator", "legal_team_member", "business_user"]) {
    await step(
      S(role, "/auth/consent"),
      `Create an OAuth grant as ${PEOPLE[role].name} on the real consent page with Claude's published client ID; capture the code from the redirect to claude.ai's callback; exchange it with PKCE as a public client`,
      "Allow redirects to https://claude.ai/api/mcp/auth_callback with code and state; token 200; tools/list 200 with Workspace Tools",
      async () => {
        const page = pages[role];
        page.context().captured.length = 0;
        const a = authorizeUrl(
          CLAUDE.id,
          CLAUDE.redirect,
          "toolset:workspace toolset:contracts write offline_access",
        );
        await page.goto(a.url);
        const c = await consentPage(page);
        await allow(page, ["Workspace"], false);
        const cb = await until(
          () => page.context().captured.find((u) => u.startsWith(CLAUDE.redirect)),
          "no callback to claude.ai",
          20000,
        );
        const u = new URL(cb);
        expectThat(
          u.searchParams.get("state") === a.state && u.searchParams.get("code"),
          "state or code missing",
        );
        const t = await token(CLAUDE.id, u.searchParams.get("code"), CLAUDE.redirect, a.verifier);
        expectThat(t.status === 200 && t.body?.access_token, `token ${t.status}`);
        const tl = await toolsList(t.body.access_token);
        grants[role] = t.body.access_token;
        expectThat(tl.status === 200 && tl.names.includes("openlaw_whoami"), JSON.stringify(tl));
        return `Consent heading "${c.heading}". Chose Workspace and Read only, Allow → browser redirected to ${CLAUDE.redirect} with code and matching state (captured by the test, not sent to claude.ai). POST /api/auth/oauth2/token (authorization_code, client_id = the metadata URL, no secret, PKCE verifier, resource ${MCP}) → ${t.status}, token scope "${t.body.scope}". tools/list → ${tl.status}, ${tl.names.length} Tools: ${tl.names.join(", ")}.`;
      },
    );
  }
  const all = async () => {
    expectThat(Object.keys(grants).length === 3, `only ${Object.keys(grants).length} grants`);
    return Object.fromEntries(
      await Promise.all(
        Object.entries(grants).map(async ([r, a]) => [r, (await toolsList(a)).status]),
      ),
    );
  };

  await step(
    S("administrator", "/settings/mcp"),
    "Existing grants: Daniel turns MCP off → every grant's next call refused; back on → accepted",
    "All three 401 while off; 200 after",
    async () => {
      await gotoMcp();
      const off = await setSwitch("Enable MCP", false);
      const during = await all();
      const on = await setSwitch("Enable MCP", true);
      await setSwitch("Legal Users OAuth Clients", true);
      await setSwitch("Business Users OAuth Clients", true);
      const after = await all();
      expectThat(
        Object.values(during).every((s) => s === 401) &&
          Object.values(after).every((s) => s === 200),
        JSON.stringify({ during, after }),
      );
      return `Enable MCP off → ${off}; tools/list per grant ${JSON.stringify(during)}. On → ${on}; ${JSON.stringify(after)}.`;
    },
  );
  await step(
    S("legal_team_member", "/settings/mcp"),
    "Existing grants: Daniel turns Legal Users OAuth Clients off → Nadia's and Daniel's next calls refused, Jonas unaffected; back on",
    "Legal 401, Business 200; all 200 after",
    async () => {
      const off = await setSwitch("Legal Users OAuth Clients", false);
      const during = await all();
      const on = await setSwitch("Legal Users OAuth Clients", true);
      const after = await all();
      expectThat(
        during.administrator === 401 &&
          during.legal_team_member === 401 &&
          during.business_user === 200 &&
          Object.values(after).every((s) => s === 200),
        JSON.stringify({ during, after }),
      );
      return `Legal Users OAuth Clients off → ${off}; ${JSON.stringify(during)}. On → ${on}; ${JSON.stringify(after)}.`;
    },
  );
  await step(
    S("business_user", "/settings/mcp"),
    "Existing grants: Daniel turns Business Users OAuth Clients off → Jonas's next call refused, Legal Users unaffected; back on",
    "Business 401, Legal 200; all 200 after",
    async () => {
      const off = await setSwitch("Business Users OAuth Clients", false);
      const during = await all();
      const on = await setSwitch("Business Users OAuth Clients", true);
      const after = await all();
      expectThat(
        during.business_user === 401 &&
          during.administrator === 200 &&
          during.legal_team_member === 200 &&
          Object.values(after).every((s) => s === 200),
        JSON.stringify({ during, after }),
      );
      return `Business Users OAuth Clients off → ${off}; ${JSON.stringify(during)}. On → ${on}; ${JSON.stringify(after)}.`;
    },
  );
  await step(
    S("administrator", "/settings/mcp"),
    "Existing grants: Daniel turns the Claude Allowed Client off → every Claude grant's next call refused; back on",
    "All three 401 while off; 200 after",
    async () => {
      await expandCard("Allowed Clients");
      const off = await setSwitch("Enable Claude", false);
      const during = await all();
      const on = await setSwitch("Enable Claude", true);
      const after = await all();
      expectThat(
        Object.values(during).every((s) => s === 401) &&
          Object.values(after).every((s) => s === 200),
        JSON.stringify({ during, after }),
      );
      return `Enable Claude off → ${off}; ${JSON.stringify(during)}. On → ${on}; ${JSON.stringify(after)}.`;
    },
  );

  await step(
    S("legal_team_member", "/auth/consent"),
    "Refusal table: a Client removed after the person started. Daniel adds a registered Client; Nadia opens its consent page; Daniel deletes the Client; Nadia reloads. A new request is then refused before sign-in",
    "This Client is not on the organization's Allowed Clients list. with Deny alone; new request HTTP 400 Client is not on the enabled Allowed Clients list.",
    async () => {
      const name = `DOC-030 claude-live removed ${stamp}`;
      await gotoMcp();
      await expandCard("Allowed Clients");
      await admin.getByRole("button", { name: "Add Client", exact: true }).click();
      const d = admin.getByRole("dialog", { name: "Add Client" });
      await d.getByLabel("Client name").fill(name);
      await d.getByLabel("Callback URL 1").fill("http://127.0.0.1:53999/callback");
      await d.getByRole("button", { name: "Save", exact: true }).click();
      const e = admin.getByRole("dialog", { name: "Edit Client" });
      await e.getByRole("button", { name: "Generate secret", exact: true }).click();
      const sd = admin.getByRole("dialog", { name: "Your Client secret is ready" });
      await sd.waitFor();
      const clientId = flat(await sd.locator("dd").last().innerText());
      await sd.getByRole("button", { name: "Done", exact: true }).click();
      await sd.waitFor({ state: "detached" });
      const nadia = pages.legal_team_member;
      const a = authorizeUrl(clientId, "http://127.0.0.1:53999/callback", "toolset:workspace");
      await nadia.goto(a.url);
      const before = await consentPage(nadia);
      await admin.getByRole("button", { name: `Edit ${name}`, exact: true }).click();
      const e2 = admin.getByRole("dialog", { name: "Edit Client" });
      await e2.getByRole("button", { name: "Delete Client" }).click();
      await e2.waitFor({ state: "detached" });
      await nadia.reload();
      const after = await consentPage(nadia);
      const fresh = await (await ctx()).newPage();
      const resp = await fresh.goto(
        authorizeUrl(clientId, "http://127.0.0.1:53999/callback", "toolset:workspace").url,
      );
      const freshText = flat(await fresh.locator("body").innerText());
      await nadia.screenshot({
        path: new URL("./consent-client-removed.png", import.meta.url).pathname,
      });
      expectThat(
        before.allow === 1 &&
          after.text.includes("This Client is not on the organization's Allowed Clients list.") &&
          after.allow === 0 &&
          after.deny === 1 &&
          resp.status() === 400 &&
          freshText.includes("Client is not on the enabled Allowed Clients list."),
        JSON.stringify({
          before: before.heading,
          after: after.text.slice(0, 400),
          a: after.allow,
          d: after.deny,
          fresh: resp.status(),
          freshText,
        }),
      );
      return `Registered Client "${name}" (loopback callback) saved and given a secret; Nadia's consent page: "${before.heading}", Allow ${before.allow}. Daniel: Edit → Delete Client. Nadia reloads: "${after.text.slice(0, 260)}"; Allow ${after.allow}, Deny ${after.deny}. A new request for the deleted client_id → HTTP ${resp.status()} "${freshText.slice(0, 120)}". Screenshot consent-client-removed.png.`;
    },
  );
}
// ---------- Claude Code loopback callback forms ----------
/** Settings → Personal → API keys → Connected Clients → Disconnect Claude Code → Revoke, when a row exists. */
async function disconnectCC(page) {
  await page.goto(`${BASE}/`);
  await page
    .getByRole("banner")
    .getByRole("button", { name: PEOPLE.legal_team_member.name })
    .click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("link", { name: "API keys", exact: true })
    .click();
  const region = page.getByRole("region", { name: "Connected Clients" });
  await region.waitFor();
  await page.waitForLoadState("networkidle").catch(() => {});
  const btn = region.getByRole("button", { name: "Disconnect Claude Code", exact: true });
  if (!(await btn.count())) return false;
  await btn.click();
  const dlg = page.getByRole("dialog", { name: "Revoke OAuth grant" });
  await dlg.getByRole("button", { name: "Revoke", exact: true }).click();
  await dlg.waitFor({ state: "detached" });
  return true;
}
let lastCallback;
const cb = http.createServer((req, res) => {
  lastCallback = new URL(req.url, "http://127.0.0.1");
  res.writeHead(200, { "content-type": "text/plain" }).end("DOC-030 loopback callback");
});
await new Promise((r) => cb.listen(0, "127.0.0.1", r));
const PORT = cb.address().port;
for (const host of ["localhost", "127.0.0.1"]) {
  await step(
    S("legal_team_member", "/auth/consent"),
    `Claude Code loopback callback http://${host}:<port>/callback: consent, Allow, the browser returns to the loopback listener, the code exchanges with PKCE`,
    "Consent heading Claude Code …; callback received on the loopback port; token 200; tools/list 200",
    async () => {
      const nadia = pages.legal_team_member;
      const redirect = `http://${host}:${PORT}/callback`;
      // The second connection of the same Client has a live grant and a remembered consent. Without
      // prompt=consent the server issues a code at once; the request below records that, then asks
      // again with prompt=consent (as Claude's own requests do) to see the page and new choices.
      let remembered = "";
      if (host === "localhost" && (await disconnectCC(nadia)))
        remembered =
          "Setup: Nadia's earlier Claude Code grant from a previous run of this script was disconnected in Connected Clients first. ";
      if (host === "127.0.0.1") {
        const r = authorizeUrl(CODE.id, redirect, "toolset:workspace offline_access");
        lastCallback = undefined;
        await nadia.goto(r.url);
        await until(() => lastCallback, "no callback without prompt", 20000);
        const rt = await token(
          CODE.id,
          lastCallback.searchParams.get("code"),
          redirect,
          r.verifier,
        );
        // Disconnect as the guide says, so the next connection needs new consent.
        expectThat(await disconnectCC(nadia), "no Claude Code row to disconnect");
        remembered = `First, with Nadia's live Claude Code grant (from the localhost step) and no prompt parameter: no consent page; the loopback listener received /callback with a code at once; token → ${rt.status}. Then Settings → Personal → API keys → Connected Clients → Disconnect Claude Code → Revoke, and a new request: `;
      }
      const a = authorizeUrl(CODE.id, redirect, "toolset:workspace offline_access");
      lastCallback = undefined;
      await nadia.goto(a.url);
      const c = await consentPage(nadia);
      await allow(nadia, ["Workspace"], false);
      await until(() => lastCallback, "no loopback callback", 20000);
      const t = await token(CODE.id, lastCallback.searchParams.get("code"), redirect, a.verifier);
      const tl =
        t.status === 200 ? await toolsList(t.body.access_token) : { status: null, names: [] };
      expectThat(
        c.heading === "Claude Code wants to work in OpenLaw as you" &&
          lastCallback.searchParams.get("state") === a.state &&
          t.status === 200 &&
          tl.status === 200,
        JSON.stringify({ c: c.heading, t: t.status, tl: tl.status }),
      );
      return `${remembered}redirect_uri ${redirect.replace(String(PORT), "<port>")} (port ${PORT}). Consent "${c.heading}"; Workspace + Read only → Allow → the loopback listener received /callback with code and matching state. Token (public client, PKCE) → ${t.status}; tools/list → ${tl.status}, ${tl.names.length} Tools.`;
    },
  );
}
await step(
  S("legal_team_member", "/auth/consent"),
  "Connect the same Client again: with Nadia's live Claude Code grant (Workspace, Read only), a new request with prompt=consent (as Claude's own requests carry) shows the consent page; new choices replace the earlier Toolsets and scope",
  "Consent page shown; after Allow the one grant row holds Contracts and write",
  async () => {
    const { execFileSync } = await import("node:child_process");
    const q = (sql) =>
      execFileSync(
        "docker",
        [
          "--context",
          "default",
          "exec",
          "openlaw-docs-80ceef9e-claudelocal-postgres-1",
          "psql",
          "-U",
          "openlaw",
          "-d",
          "openlaw",
          "-At",
          "-F",
          "|",
          "-c",
          sql,
        ],
        { encoding: "utf8" },
      ).trim();
    const rows = () =>
      q(
        "select array_to_string(g.toolsets, ','), g.scope, g.revoked_at is null from oauth_grants g join users u on u.id=g.person_id join allowed_clients c on c.id=g.allowed_client_id where u.email='nadia.haddad@helix.example' and c.name='Claude Code'",
      );
    const before = rows();
    const nadia = pages.legal_team_member;
    const redirect = `http://127.0.0.1:${PORT}/callback`;
    const a = authorizeUrl(
      CODE.id,
      redirect,
      "toolset:workspace toolset:contracts write offline_access",
      { prompt: "consent" },
    );
    lastCallback = undefined;
    await nadia.goto(a.url);
    const c = await consentPage(nadia);
    await allow(nadia, ["Contracts"], true);
    await until(() => lastCallback, "no loopback callback", 20000);
    const t = await token(CODE.id, lastCallback.searchParams.get("code"), redirect, a.verifier);
    const after = rows();
    expectThat(
      c.heading === "Claude Code wants to work in OpenLaw as you" &&
        t.status === 200 &&
        after === "contracts|write|t",
      JSON.stringify({ before, after, t: t.status }),
    );
    return `Grant before: ${before}. Request with prompt=consent → consent page "${c.heading}" (nothing pre-selected). Chose Contracts and Read and write → Allow → callback, token ${t.status}. Grant after (one row per person and Client): ${after}. Without prompt, the earlier step showed that a live grant's remembered consent issues a code without the page.`;
  },
);

await step(
  S("legal_team_member", "/api/auth/oauth2/authorize"),
  "Negative: Claude Code with a non-loopback or wrong-path callback is refused before consent",
  "http://192.168.1.5:<port>/callback and http://localhost:<port>/other refused",
  async () => {
    const out = [];
    for (const redirect of [
      `http://192.168.1.5:${PORT}/callback`,
      `http://localhost:${PORT}/other`,
    ]) {
      const p = await (await ctx()).newPage();
      const resp = await p.goto(authorizeUrl(CODE.id, redirect, "toolset:workspace").url);
      out.push({
        redirect: redirect.replace(String(PORT), "<port>"),
        status: resp.status(),
        url: new URL(p.url()).pathname,
        text: flat(await p.locator("body").innerText()).slice(0, 120),
      });
    }
    expectThat(
      out.every((o) => o.status >= 400 && !o.url.startsWith("/auth/")),
      JSON.stringify(out),
    );
    return JSON.stringify(out);
  },
);

save();
cb.close();
await browser.close();
const mine = log.steps.filter((s) => s.phase === (CC_ONLY ? "local-cc" : "local"));
console.log(
  `local done: ${mine.length} steps, ${mine.filter((s) => s.result !== "pass").length} failed`,
);
