// DOC-032 mcp, phase claude: the vendor-free parts of connect-claude (V-M41-C59, V-M42-C59)
// on the owned mcp42 lab (loopback Instance address; OAuth runs on a loopback BASE_URL, which
// the guide allows for development). Copied in pattern from DOC-030 claude-live phase-browser
// and phase-local. This agent plays only the Client's protocol legs with fetch (authorization
// request, PKCE token exchange as a public client, /mcp calls); every OpenLaw screen step runs
// in the browser as the named role. Claude's callback at claude.ai is captured by the browser
// route and never sent. The claude CLI is not run (batch instruction). Live-provider checks
// (claude.ai, Claude Desktop, Cowork, Claude Code with a real account) are recorded as blocked.
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import {
  api,
  connectClient,
  createLog,
  expectThat,
  flat,
  labManifest,
  LABS,
  magicLink,
  pause,
  PASSWORD,
  PEOPLE,
  PW_PATH,
  rawCall,
  rawToolsList,
  secret,
  stamp,
  until,
  waitForMail,
} from "./lib.mjs";
import { ui } from "./ui.mjs";

const LAB = LABS.mcp42;
const BASE = LAB.base;
const MCP = `${BASE}/mcp`;
const U = ui(BASE);
const CLAUDE = {
  name: "Claude",
  id: "https://claude.ai/oauth/mcp-oauth-client-metadata",
  redirect: "https://claude.ai/api/mcp/auth_callback",
};
const CODE = { name: "Claude Code", id: "https://claude.ai/oauth/claude-code-client-metadata" };
const { chromium } = await import(PW_PATH);
const { log, save, step, finish } = createLog("claude", {
  lab: LAB.name,
  environment: LAB.project,
  appUrl: BASE,
  mailUrl: LAB.mail,
  labManifest: labManifest("mcp42"),
  instanceAddress:
    "Application address http://127.0.0.1:43361 (saved in Settings → Advanced in phase lan; BASE_URL unpinned by overlay-unpin.json; overlay-dns.json lets the API fetch the Claude published identities)",
});
const S = (role, page, extra = {}) => ({
  article: "connect-claude",
  scenario: "V-M41-C59",
  role,
  lab: LAB.name,
  page,
  ...extra,
});
const S42 = (role, page, extra = {}) => S(role, page, { scenario: "V-M42-C59", ...extra });
const ROLES = ["administrator", "legal_team_member", "business_user"];

// ---------- browser ----------
const browser = await chromium.launch();
async function newPage() {
  const c = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  c.captured = [];
  await c.route("https://claude.ai/**", (route) => {
    c.captured.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: "DOC-032 captured Claude callback",
    });
  });
  return c.newPage();
}
const body = async (page) => flat(await page.locator("body").innerText());
const admin = await newPage();
await admin.goto(`${BASE}/auth/login`);
await admin.getByLabel("Email").fill(PEOPLE.administrator.email);
await admin.getByLabel("Password", { exact: true }).fill(PASSWORD);
await admin.getByRole("button", { name: "Sign in", exact: true }).click();
await admin.waitForURL((u) => !u.pathname.startsWith("/auth/"), { timeout: 30000 });

// ---------- the Client's protocol legs ----------
// prompt=consent, as Claude's own authorization requests carry; without it a live grant's
// remembered consent issues a code at once and no consent page appears.
function authorizeUrl(clientId, redirect, scope, extra = { prompt: "consent" }) {
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
async function readConsent(page) {
  await page.waitForURL(/\/auth\/consent\?/, { timeout: 30000 });
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  await pause(400);
  const allow = page.getByRole("button", { name: "Allow", exact: true });
  return {
    text: await body(page),
    heading: flat(await page.getByRole("heading", { level: 1 }).first().innerText()),
    offered: (
      await page
        .getByRole("checkbox")
        .evaluateAll((els) =>
          els.map((e) => e.getAttribute("aria-label") ?? e.closest("label")?.textContent?.trim()),
        )
    ).filter(Boolean),
    checked: await page
      .getByRole("checkbox")
      .evaluateAll(
        (els) =>
          els.filter(
            (e) => e.getAttribute("aria-checked") === "true" || e.dataset.state === "checked",
          ).length,
      ),
    radios: await page
      .getByRole("radio")
      .evaluateAll((els) =>
        els.map((e) => e.closest("label")?.textContent?.trim().replace(/\s+/g, " ")),
      ),
    allowCount: await allow.count(),
    denyCount: await page.getByRole("button", { name: "Deny", exact: true }).count(),
    allowDisabled: (await allow.count()) ? await allow.isDisabled() : null,
  };
}
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
  await first.uncheck();
  return r;
}
async function allowWith(page, toolsets, write) {
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
  let b = null;
  try {
    b = await r.json();
  } catch {}
  for (const t of ["access_token", "refresh_token", "id_token"]) if (b?.[t]) secret(b[t]);
  return { status: r.status, body: b };
}
const bearer = (access) => ({ authorization: `Bearer ${access}` });
async function portalSignInFromLogin(page) {
  await page.getByRole("link", { name: "Business Portal sign-in" }).click();
  await page.waitForURL(/\/portal\/login\?/);
  await page.waitForLoadState("networkidle").catch(() => {});
  for (let attempt = 1; attempt <= 12; attempt++) {
    await page
      .getByRole("button", { name: "Email me a sign-in link", exact: true })
      .click()
      .catch(() => {});
    await page.getByLabel("Email").fill(PEOPLE.business_user.email);
    const since = Date.now();
    await page.getByRole("button", { name: "Send link", exact: true }).click();
    const sent = await page
      .getByText("Check your email")
      .first()
      .waitFor({ timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (!sent) {
      console.log("portal link not sent (rate limit?); waiting 60 s");
      await pause(60000);
      await page.reload();
      continue;
    }
    const mail = await waitForMail(LAB.mail, PEOPLE.business_user.email, /sign in/i, since);
    const link = mail?.text
      .match(/https?:\/\/[^\s<>"')\]]*magic-link\/verify[^\s<>"')\]]*/)?.[0]
      ?.replace(/[.,]+$/, "");
    if (!link) continue;
    secret(link);
    await page.goto(link);
    return true;
  }
  throw new Error("no Portal sign-in link");
}

// =====================================================================
await step(
  S("administrator", "/settings/mcp", { article: "configure-mcp", scenario: "V-M41-MCP" }),
  "Before you start (connect-claude): Enable MCP, Legal Users and Business Users OAuth Clients on; Claude and Claude Code are enabled Allowed Clients; copy the Server address",
  "Switches save; Claude and Claude Code enabled; Server address ends /mcp",
  async () => {
    await U.gotoMcp(admin);
    const r = [
      await U.toggle(admin, "Enable MCP", true),
      await U.toggle(admin, "Legal Users OAuth Clients", true),
      await U.toggle(admin, "Business Users OAuth Clients", true),
    ];
    await U.expandCard(admin, "Allowed Clients");
    const en = {
      Claude: await admin
        .getByRole("switch", { name: "Enable Claude", exact: true })
        .getAttribute("aria-checked"),
      "Claude Code": await admin
        .getByRole("switch", { name: "Enable Claude Code", exact: true })
        .getAttribute("aria-checked"),
    };
    const addr = (await U.main(admin)).match(/http\S+\/mcp/)?.[0];
    expectThat(
      en.Claude === "true" && en["Claude Code"] === "true" && addr === MCP,
      JSON.stringify({ en, addr }),
    );
    return `${r.join(" ")} Allowed Clients: ${JSON.stringify(en)}. Server address ${addr}.`;
  },
);

// ---------- Choose access on the consent page, per role ----------
const pages = {};
const firstConsent = {};
const grants = {};
const CHOICE = {
  administrator: { toolsets: ["Workspace", "Contracts"], write: false },
  legal_team_member: { toolsets: ["Workspace", "Requests"], write: false },
  business_user: { toolsets: ["Workspace", "Contracts", "Requests"], write: false },
};
const REQUEST_SCOPE =
  "toolset:workspace toolset:contracts toolset:requests toolset:matters write offline_access";
for (const role of ROLES) {
  await step(
    S(role, "/auth/login → /auth/consent"),
    `Choose access on the consent page 1-5 as ${PEOPLE[role].name}: start signed out from Claude's authorization request; sign in${role === "business_user" ? " with Business Portal sign-in" : ""}; read the page; Allow gate; Allow`,
    "Sign-in returns to consent; heading Claude wants to work in OpenLaw as you; Published identity and address; Allowed Client pill; name, account type, email; What Claude may use; Nothing is selected for you.; How far Claude may go; Read only and Read and write; This Client can never see or change what you cannot.; Allow disabled until a Toolset and a scope; Allow returns to the Client",
    async () => {
      const p = await newPage();
      pages[role] = p;
      const a = authorizeUrl(CLAUDE.id, CLAUDE.redirect, REQUEST_SCOPE);
      await p.goto(a.url);
      await p.waitForURL(/\/auth\/login\?/, { timeout: 30000 });
      await p.getByLabel("Email").waitFor();
      if (role === "business_user") await portalSignInFromLogin(p);
      else {
        await p.getByLabel("Email").fill(PEOPLE[role].email);
        await p.getByLabel("Password", { exact: true }).fill(PASSWORD);
        await p.getByRole("button", { name: "Sign in", exact: true }).click();
      }
      const c = await readConsent(p);
      firstConsent[role] = { at: Date.now(), url: p.url() };
      const gate = await allowGate(p);
      const checks = {
        heading: c.heading === "Claude wants to work in OpenLaw as you",
        identity: c.text.includes(`Published identity ${CLAUDE.id}`),
        pill: c.text.includes("Allowed Client"),
        person: c.text.includes(PEOPLE[role].email),
        legends: c.text.includes("What Claude may use") && c.text.includes("How far Claude may go"),
        nothing: c.text.includes("Nothing is selected for you.") && c.checked === 0,
        never: c.text.includes("This Client can never see or change what you cannot."),
        radios:
          c.radios.some((r) => /^Read only/.test(r)) &&
          c.radios.some((r) => /^Read and write/.test(r)),
        requestedOnly: c.offered.every((o) =>
          ["Workspace", "Contracts", "Requests", "Matters"].includes(o),
        ),
        noGuide: !c.offered.some((o) => /guide/i.test(o)),
        gate: gate.nothing && gate.toolsetOnly && gate.scopeOnly && !gate.both,
      };
      expectThat(
        Object.values(checks).every(Boolean),
        JSON.stringify({ checks, c: { ...c, text: c.text.slice(0, 700) }, gate }),
      );
      p.context().captured.length = 0;
      await allowWith(p, CHOICE[role].toolsets, CHOICE[role].write);
      const cb = await until(
        () => p.context().captured.find((u) => u.startsWith(CLAUDE.redirect)),
        "no callback to claude.ai",
        20000,
      );
      const u = new URL(cb);
      expectThat(
        u.searchParams.get("state") === a.state && u.searchParams.get("code"),
        "state or code missing",
      );
      const t = await token(CLAUDE.id, u.searchParams.get("code"), CLAUDE.redirect, a.verifier);
      expectThat(
        t.status === 200 && t.body?.access_token,
        `token ${t.status} ${JSON.stringify(t.body)}`,
      );
      grants[role] = t.body.access_token;
      const tl = await rawToolsList(MCP, bearer(grants[role]));
      return `Requested ${REQUEST_SCOPE}. Signed out → /auth/login${role === "business_user" ? " → Business Portal sign-in → Email me a sign-in link → Send link → the mailed link (not recorded)" : " → password"} → back on /auth/consent. Heading "${c.heading}". Text "${c.text.slice(0, 520)}". Offered (${c.offered.length}): ${c.offered.join(", ")}; checked ${c.checked}. Radios ${JSON.stringify(c.radios)}. Allow disabled: nothing ${gate.nothing}, Toolset only ${gate.toolsetOnly}, scope only ${gate.scopeOnly}, both ${gate.both}. Chose ${CHOICE[role].toolsets.join(", ")} + Read only → Allow → the browser went to ${CLAUDE.redirect} with code and matching state (captured, not sent). Token (public client, PKCE) → ${t.status}, scope "${t.body.scope}". tools/list → ${tl.status}, ${tl.names?.length} Tools.`;
    },
  );
}

// ---------- the Client acts as the person; Guide reads Connect Claude ----------
const helpText = await (async () => {
  const p = await admin.context().newPage();
  await p.goto(`${BASE}/documentation/connect-claude`);
  await p.getByRole("heading", { name: "Connect Claude" }).first().waitFor({ timeout: 20000 });
  const t = flat(await p.locator("main").innerText());
  await p.close();
  return t;
})();
for (const role of ROLES) {
  await step(
    S(role, "script Client (OAuth grant)"),
    "Ask: tell me who I am, then find and read the guide Connect Claude (openlaw_whoami, openlaw_docs_search, openlaw_docs_read); compare with Help",
    "whoami is the signed-in person with the chosen Toolsets and scope; search finds connect-claude; the read matches Help",
    async () => {
      const { client, names, protocolVersion } = await connectClient(MCP, bearer(grants[role]), {
        mode: "modern",
      });
      const who = await client.callTool({ name: "openlaw_whoami", arguments: {} });
      const search = await client.callTool({
        name: "openlaw_docs_search",
        arguments: { query: "Connect Claude" },
      });
      const hits = (
        search.structuredContent?.articles ??
        search.structuredContent?.results ??
        []
      ).map((x) => x.id ?? x.slug);
      const read = await client.callTool({
        name: "openlaw_docs_read",
        arguments: { id: "connect-claude" },
      });
      const md =
        read.structuredContent?.markdown ??
        read.structuredContent?.body ??
        read.structuredContent?.content ??
        JSON.stringify(read.structuredContent);
      // Guide and Help come from the guides built into the pinned image (commit 4ca41822).
      // The author's uncommitted corrections (git diff HEAD) are not in that build.
      const sentences = [
        "Let Claude work in OpenLaw as you.",
        "Allow stays disabled until you choose at least one Toolset and a scope.",
        "The consent link lasts ten minutes.",
        "It proposes a Disposition, type, urgency and assignee for each Request.",
      ];
      const notYetBuilt = [
        "Claude Code splits prompt arguments on spaces",
        "A Business User does not see it.",
        "OpenLaw refuses the address if Contracts is not in your grant",
      ];
      const inHelp = sentences.filter((x) => helpText.includes(x)).length;
      const inRead = sentences.filter((x) => String(md).includes(x)).length;
      const newInHelp = notYetBuilt.filter((x) => helpText.includes(x)).length;
      const newInRead = notYetBuilt.filter((x) => String(md).includes(x)).length;
      await client.close();
      const person = who.structuredContent?.person;
      expectThat(
        person?.email === PEOPLE[role].email &&
          hits.includes("connect-claude") &&
          inHelp === sentences.length &&
          inRead === sentences.length &&
          newInHelp === newInRead,
        JSON.stringify({ person, hits, inHelp, inRead, newInHelp, newInRead }),
      );
      return `Modern Client (${protocolVersion}) with the Bearer token: ${names.length} Tools. whoami ${person.displayName}, ${who.structuredContent.accountType}, Toolsets ${JSON.stringify(who.structuredContent.toolsets)}, scope ${who.structuredContent.scope}. docs_search "Connect Claude" top ${hits.slice(0, 3).join(", ")}. docs_read connect-claude title "${read.structuredContent?.title}", unverified ${read.structuredContent?.unverified}. ${inRead}/${sentences.length} check sentences in the Guide read and ${inHelp}/${sentences.length} on Help (/documentation/connect-claude); Guide and Help agree. Sentences from the author's uncommitted corrections: ${newInRead}/${notYetBuilt.length} in the Guide read, ${newInHelp}/${notYetBuilt.length} on Help (the pinned image was built from the committed guide).`;
    },
  );
}

// ---------- V-M42-C59, the OpenLaw side of attach and prompts ----------
for (const role of ROLES) {
  await step(
    S42(role, "script Client (OAuth grant)"),
    role === "business_user"
      ? "Prompts and addresses under the Business User's grant: no triage prompt; summary works on a reached Contract; an unreached Contract is refused by address"
      : role === "legal_team_member"
        ? "Prompts and addresses under a grant without Contracts: triage_inbox and summarize_record listed; a Contract address is refused because Contracts is not in the grant"
        : "Prompts and addresses under a grant with Contracts: the Contract address and summary work; triage_inbox needs Requests",
    "As the guide's Attach a record and run a prompt section says",
    async () => {
      const { client } = await connectClient(MCP, bearer(grants[role]), { mode: "modern" });
      const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
      const out = [`prompts/list: ${prompts.join(", ") || "(none)"}`];
      let ok = true;
      const contractNumbers = async (c) => {
        const r = await c
          .callTool({ name: "openlaw_contracts_list", arguments: { limit: 100 } })
          .catch(() => null);
        return (r?.structuredContent?.contracts ?? []).map((x) => x.number);
      };
      if (role === "legal_team_member") {
        const raw = await rawCall(MCP, bearer(grants[role]), "resources/read", {
          uri: "openlaw://contracts/C-1",
        });
        out.push(
          `resources/read openlaw://contracts/C-1 without Contracts in the grant → HTTP ${raw.status}; WWW-Authenticate ${raw.wwwAuthenticate ? `"${raw.wwwAuthenticate.slice(0, 200)}"` : "absent"}; body ${JSON.stringify(raw.body).slice(0, 200)}`,
        );
        const t = await client.getPrompt({ name: "triage_inbox", arguments: { limit: "10" } });
        out.push(
          `triage_inbox limit 10 → ${t.messages?.length} messages, embedded ${t.messages?.[1]?.content?.resource?.uri}; asks for confirmation: ${/Wait for the person's confirmation/.test(t.messages?.[0]?.content?.text ?? "")}; Convert link ${/\/inbox\/\{number\}/.test(t.messages?.[0]?.content?.text ?? "")}`,
        );
        ok =
          prompts.includes("triage_inbox") &&
          raw.status === 403 &&
          /insufficient_scope/.test(raw.wwwAuthenticate ?? "") &&
          t.messages?.length === 2;
      } else if (role === "administrator") {
        const n = (await contractNumbers(client))[0];
        const r = await client.readResource({ uri: `openlaw://contracts/C-${n}` });
        const s = await client.getPrompt({
          name: "summarize_record",
          arguments: { record: `openlaw://contracts/C-${n}` },
        });
        const raw = await rawCall(MCP, bearer(grants[role]), "prompts/get", {
          name: "triage_inbox",
          arguments: {},
        });
        out.push(
          `resources/read openlaw://contracts/C-${n} → "${r.contents?.[0]?._meta?.title}"; summarize_record → embedded ${s.messages?.[1]?.content?.resource?.uri}, "${s.messages?.[0]?.content?.text?.match(/Do not change the record\./)?.[0]}"; triage_inbox without Requests in the grant → HTTP ${raw.status} ${raw.wwwAuthenticate ? `WWW-Authenticate "${raw.wwwAuthenticate.slice(0, 160)}"` : JSON.stringify(raw.body).slice(0, 160)}`,
        );
        ok = !r.isError && s.messages?.length === 2 && !prompts.includes("triage_inbox");
      } else {
        const mine = await contractNumbers(client);
        const all =
          (
            await rawCall(MCP, bearer(grants.administrator), "tools/call", {
              name: "openlaw_contracts_list",
              arguments: { limit: 100 },
            })
          ).body?.result?.structuredContent?.contracts?.map((x) => x.number) ?? [];
        const unreached = all.find((x) => !mine.includes(x));
        const s = await client.getPrompt({
          name: "summarize_record",
          arguments: { record: `openlaw://contracts/C-${mine[0]}` },
        });
        const refused = await client.readResource({ uri: `openlaw://contracts/C-${unreached}` });
        const t = await client.getPrompt({ name: "triage_inbox", arguments: {} });
        out.push(
          `summarize_record on reached C-${mine[0]} → embedded ${s.messages?.[1]?.content?.resource?.uri}; unreached C-${unreached} → ${flat(refused.content?.[0]?.text)}; triage_inbox → ${flat(t.content?.[0]?.text)}`,
        );
        ok =
          !prompts.includes("triage_inbox") &&
          s.messages?.length === 2 &&
          refused.isError &&
          /^not_found/.test(flat(refused.content?.[0]?.text)) &&
          t.isError;
      }
      await client.close();
      expectThat(ok, out.join(" | "));
      return out.join(" | ");
    },
  );
}
await step(
  S42("legal_team_member", "script Client (OAuth grant)"),
  "Search for triage_inbox through Guide and read Connect Claude; compare with Help",
  "docs_search finds connect-claude; the triage paragraph is the same in Guide and Help",
  async () => {
    const { client } = await connectClient(MCP, bearer(grants.legal_team_member), {
      mode: "modern",
    });
    const search = await client.callTool({
      name: "openlaw_docs_search",
      arguments: { query: "triage_inbox" },
    });
    const hits = (
      search.structuredContent?.articles ??
      search.structuredContent?.results ??
      []
    ).map((x) => x.id ?? x.slug);
    const read = await client.callTool({
      name: "openlaw_docs_read",
      arguments: { id: "connect-claude" },
    });
    const md = JSON.stringify(read.structuredContent);
    await client.close();
    const s = "It proposes a Disposition, type, urgency and assignee for each Request.";
    expectThat(
      hits.includes("connect-claude") && md.includes(s) && helpText.includes(s),
      JSON.stringify(hits),
    );
    return `docs_search "triage_inbox" → ${hits.join(", ")}. "${s}" is in the Guide read and on Help.`;
  },
);

// ---------- Claude Code identity with loopback callbacks ----------
let lastCallback;
const cb = http.createServer((req, res) => {
  lastCallback = new URL(req.url, "http://127.0.0.1");
  res.writeHead(200, { "content-type": "text/plain" }).end("DOC-032 loopback callback");
});
await new Promise((r) => cb.listen(0, "127.0.0.1", r));
const PORT = cb.address().port;
let ccAccess;
for (const host of ["localhost", "127.0.0.1"]) {
  await step(
    S("legal_team_member", "/auth/consent"),
    `Claude Code: published identity and loopback callback http://${host}:<port>/callback; consent names Claude Code; Allow returns to the loopback listener; the code exchanges with PKCE`,
    "Heading Claude Code wants to work in OpenLaw as you; What Claude Code may use; How far Claude Code may go; callback received; token 200",
    async () => {
      const nadia = pages.legal_team_member;
      const redirect = `http://${host}:${PORT}/callback`;
      const a = authorizeUrl(
        CODE.id,
        redirect,
        "toolset:workspace toolset:contracts toolset:requests write offline_access",
        { prompt: "consent" },
      );
      lastCallback = undefined;
      await nadia.goto(a.url);
      const c = await readConsent(nadia);
      await allowWith(
        nadia,
        host === "localhost" ? ["Workspace"] : ["Contracts", "Requests"],
        host !== "localhost",
      );
      await until(() => lastCallback, "no loopback callback", 20000);
      const t = await token(CODE.id, lastCallback.searchParams.get("code"), redirect, a.verifier);
      const tl =
        t.status === 200
          ? await rawToolsList(MCP, bearer(t.body.access_token))
          : { status: null, names: [] };
      ccAccess = t.body?.access_token;
      expectThat(
        c.heading === "Claude Code wants to work in OpenLaw as you" &&
          c.text.includes("What Claude Code may use") &&
          c.text.includes("How far Claude Code may go") &&
          c.text.includes(`Published identity ${CODE.id}`) &&
          lastCallback.searchParams.get("state") === a.state &&
          t.status === 200 &&
          tl.status === 200,
        JSON.stringify({ h: c.heading, t: t.status, tl: tl.status, text: c.text.slice(0, 300) }),
      );
      return `redirect_uri http://${host}:<port>/callback. Consent "${c.heading}"; offered ${c.offered.join(", ")}; radios ${JSON.stringify(c.radios)}. Chose ${host === "localhost" ? "Workspace + Read only" : "Contracts, Requests + Read and write"} → Allow → the listener received /callback with code and matching state. Token → ${t.status}, scope "${t.body?.scope}". tools/list → ${tl.status}, ${tl.names?.length} Tools.`;
    },
  );
}
await step(
  S("legal_team_member", "/settings/api-keys"),
  "If you connect the same Client again, your new choices replace the earlier Toolsets and scope (Connected Clients shows one Claude Code row)",
  "One Claude Code row with Contracts, Requests and Write",
  async () => {
    const nadia = pages.legal_team_member;
    await nadia.goto(`${BASE}/`);
    await U.apiKeysPane(nadia, "legal_team_member");
    const region = nadia.getByRole("region", { name: "Connected Clients" });
    await region.waitFor();
    const rows = (await region.getByRole("listitem").filter({ hasText: /^C/ }).allInnerTexts())
      .map(flat)
      .filter((t) => t.includes("Claude Code"));
    expectThat(
      rows.length === 1 &&
        /Contracts/.test(rows[0]) &&
        /Requests/.test(rows[0]) &&
        /Write/.test(rows[0]) &&
        !/Workspace/.test(rows[0]),
      JSON.stringify(rows),
    );
    return `Connected Clients rows for Claude Code: ${JSON.stringify(rows)}.`;
  },
);
await step(
  S("legal_team_member", "/api/auth/oauth2/authorize"),
  "Negative: Claude Code with a non-loopback or wrong-path callback is refused before consent",
  "Refused before any consent page",
  async () => {
    const out = [];
    for (const redirect of [
      `http://192.168.1.5:${PORT}/callback`,
      `http://localhost:${PORT}/other`,
    ]) {
      const p = await newPage();
      const resp = await p.goto(authorizeUrl(CODE.id, redirect, "toolset:workspace").url);
      out.push({
        redirect: redirect.replace(String(PORT), "<port>"),
        status: resp.status(),
        path: new URL(p.url()).pathname,
        text: (await body(p)).slice(0, 100),
      });
      await p.context().close();
    }
    expectThat(
      out.every((o) => o.status >= 400 && !o.path.startsWith("/auth/")),
      JSON.stringify(out),
    );
    return JSON.stringify(out);
  },
);

// ---------- refusals on the consent page ----------
await step(
  S("legal_team_member", "/settings/mcp + /auth/consent"),
  "Negative: Read and write is absent when the organization is read-only (the Administrator sets Read-only; a fresh request; back off)",
  "Only Read only offered under Read-only; both again after",
  async () => {
    const p = pages.legal_team_member;
    await U.gotoMcp(admin);
    await U.expandCard(admin, "Toolset ceiling");
    const on = await U.toggle(admin, "Read-only", true);
    await p.goto(authorizeUrl(CLAUDE.id, CLAUDE.redirect, REQUEST_SCOPE).url);
    const ro = await readConsent(p);
    const off = await U.toggle(admin, "Read-only", false);
    await p.goto(authorizeUrl(CLAUDE.id, CLAUDE.redirect, REQUEST_SCOPE).url);
    const back = await readConsent(p);
    await p.goto(authorizeUrl(CLAUDE.id, CLAUDE.redirect, "toolset:workspace offline_access").url);
    const noWrite = await readConsent(p);
    expectThat(
      ro.radios.length === 1 &&
        /^Read only/.test(ro.radios[0]) &&
        back.radios.some((r) => /^Read and write/.test(r)) &&
        noWrite.radios.length === 1,
      JSON.stringify({ ro: ro.radios, back: back.radios, noWrite: noWrite.radios }),
    );
    return `${on} Fresh request: radios ${JSON.stringify(ro.radios)}. ${off} Fresh request: ${JSON.stringify(back.radios)}. A request without the write scope: ${JSON.stringify(noWrite.radios)}.`;
  },
);
await step(
  S("legal_team_member", "/auth/consent"),
  "Negative: an altered consent link shows the expired-or-changed message with no actions",
  "This consent request has expired or changed. Start again from your Client.; no Allow, no Deny",
  async () => {
    const p = pages.legal_team_member;
    await p.goto(authorizeUrl(CLAUDE.id, CLAUDE.redirect, REQUEST_SCOPE).url);
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
    return `Changed the scope parameter of a live consent URL. Page: "${c.text.slice(0, 260)}". Allow ${c.allowCount}, Deny ${c.denyCount}.`;
  },
);
await step(
  S("legal_team_member", "/settings/mcp + /auth/consent"),
  "Negative: disabled Client. Mid-flow the Administrator turns Claude off and the person reloads; a new request with Claude off; Claude back on",
  "Mid-flow: This Client is off in the organization's Allowed Clients list., Deny alone. New request: Client is not on the enabled Allowed Clients list. before any sign-in page",
  async () => {
    const p = pages.legal_team_member;
    await p.goto(authorizeUrl(CLAUDE.id, CLAUDE.redirect, REQUEST_SCOPE).url);
    await readConsent(p);
    await U.gotoMcp(admin);
    await U.expandCard(admin, "Allowed Clients");
    const off = await U.toggle(admin, "Enable Claude", false);
    await p.reload();
    const mid = await readConsent(p);
    const fresh = await newPage();
    const resp = await fresh.goto(authorizeUrl(CLAUDE.id, CLAUDE.redirect, REQUEST_SCOPE).url);
    const freshText = await body(fresh);
    await fresh.context().close();
    const on = await U.toggle(admin, "Enable Claude", true);
    expectThat(
      mid.text.includes("This Client is off in the organization's Allowed Clients list.") &&
        mid.allowCount === 0 &&
        mid.denyCount === 1 &&
        resp.status() === 400 &&
        freshText.includes("Client is not on the enabled Allowed Clients list."),
      JSON.stringify({ mid: mid.text.slice(0, 300), s: resp.status(), freshText }),
    );
    return `${off} Reloaded consent: "${mid.text.slice(0, 260)}"; Allow ${mid.allowCount}, Deny ${mid.denyCount}. New signed-out request → HTTP ${resp.status()} "${freshText.slice(0, 120)}". ${on}`;
  },
);
for (const [role, label] of [
  ["business_user", "Business Users OAuth Clients"],
  ["legal_team_member", "Legal Users OAuth Clients"],
]) {
  await step(
    S(role, "/settings/mcp + /auth/consent"),
    `Negative: disabled account group. The Administrator turns ${label} off; ${PEOPLE[role].name} reloads consent; back on`,
    "OAuth Clients are off for your account type.; Deny alone",
    async () => {
      const p = pages[role];
      await p.goto(authorizeUrl(CLAUDE.id, CLAUDE.redirect, REQUEST_SCOPE).url);
      await readConsent(p);
      await U.gotoMcp(admin);
      const off = await U.toggle(admin, label, false);
      await p.reload();
      const c = await readConsent(p);
      const on = await U.toggle(admin, label, true);
      expectThat(
        c.text.includes("OAuth Clients are off for your account type.") &&
          c.allowCount === 0 &&
          c.denyCount === 1,
        JSON.stringify({ text: c.text.slice(0, 300), a: c.allowCount, d: c.denyCount }),
      );
      return `${off} Reloaded consent: "${c.text.slice(0, 240)}"; Allow ${c.allowCount}, Deny ${c.denyCount}. ${on}`;
    },
  );
}
await step(
  S("administrator", "/settings/mcp + /auth/consent"),
  "Refusal table: MCP off. The Administrator opens a consent page, turns MCP off, reloads; MCP back on",
  "MCP is off for this organization.; Deny alone",
  async () => {
    const p = pages.administrator;
    await p.goto(authorizeUrl(CLAUDE.id, CLAUDE.redirect, REQUEST_SCOPE).url);
    await readConsent(p);
    await U.gotoMcp(admin);
    const off = await U.toggle(admin, "Enable MCP", false);
    await p.reload();
    const c = await readConsent(p);
    const on = await U.toggle(admin, "Enable MCP", true);
    await U.toggle(admin, "Legal Users OAuth Clients", true);
    await U.toggle(admin, "Business Users OAuth Clients", true);
    expectThat(
      c.text.includes("MCP is off for this organization.") &&
        c.allowCount === 0 &&
        c.denyCount === 1,
      JSON.stringify({ text: c.text.slice(0, 300) }),
    );
    return `${off} Reloaded consent: "${c.text.slice(0, 240)}"; Allow ${c.allowCount}, Deny ${c.denyCount}. ${on}`;
  },
);
await step(
  S("legal_team_member", "/settings/mcp + /auth/consent"),
  "Refusal table: a Client removed after the person started (the Administrator adds a registered Client, the person opens its consent page, the Administrator deletes it, the person reloads)",
  "This Client is not on the organization's Allowed Clients list.; Deny alone",
  async () => {
    const name = `DOC-032 mcp removed ${stamp}`;
    await U.gotoMcp(admin);
    await U.expandCard(admin, "Allowed Clients");
    await admin.getByRole("button", { name: "Add Client", exact: true }).click();
    const d = admin.getByRole("dialog", { name: "Add Client" });
    await d.getByLabel("Client name").fill(name);
    await d.getByLabel("Callback URL 1").fill("http://127.0.0.1:53999/callback");
    await d.getByRole("button", { name: "Save", exact: true }).click();
    const e = admin.getByRole("dialog", { name: "Edit Client" });
    await e.waitFor();
    const list = (await api(admin, BASE, "GET", "/api/v1/mcp-settings/allowed-clients")).body;
    const clientId = (list.clients ?? list).find((x) => x.name === name).clientId;
    const p = pages.legal_team_member;
    await p.goto(
      authorizeUrl(clientId, "http://127.0.0.1:53999/callback", "toolset:workspace").url,
    );
    const before = await readConsent(p);
    await e.getByRole("button", { name: "Delete Client" }).click();
    await e.waitFor({ state: "detached" });
    await p.reload();
    const after = await readConsent(p);
    expectThat(
      after.text.includes("This Client is not on the organization's Allowed Clients list.") &&
        after.allowCount === 0 &&
        after.denyCount === 1,
      JSON.stringify({ text: after.text.slice(0, 300) }),
    );
    return `Consent "${before.heading}" (Allow ${before.allowCount}). After Delete Client and reload: "${after.text.slice(0, 240)}"; Allow ${after.allowCount}, Deny ${after.denyCount}.`;
  },
);

// ---------- existing grants follow the Administrator's switches ----------
const statuses = async () =>
  Object.fromEntries(
    await Promise.all(
      ROLES.map(async (r) => [r, (await rawToolsList(MCP, bearer(grants[r]))).status]),
    ),
  );
await step(
  S("administrator", "/settings/mcp"),
  "Disconnect or fix: if the Administrator turns off MCP, a group's OAuth Clients or the Client, the next call is refused",
  "401 while off for the affected grants; 200 after",
  async () => {
    await U.gotoMcp(admin);
    const r = [];
    for (const [label, affected] of [
      ["Enable MCP", ROLES],
      ["Legal Users OAuth Clients", ["administrator", "legal_team_member"]],
      ["Business Users OAuth Clients", ["business_user"]],
      ["Enable Claude", ROLES],
    ]) {
      if (label === "Enable Claude") await U.expandCard(admin, "Allowed Clients");
      await U.toggle(admin, label, false);
      const during = await statuses();
      await U.toggle(admin, label, true);
      if (label === "Enable MCP") {
        await U.toggle(admin, "Legal Users OAuth Clients", true);
        await U.toggle(admin, "Business Users OAuth Clients", true);
      }
      const after = await statuses();
      r.push(`${label} off → ${JSON.stringify(during)}; on → ${JSON.stringify(after)}`);
      expectThat(
        ROLES.every((x) => during[x] === (affected.includes(x) ? 401 : 200) && after[x] === 200),
        r.at(-1),
      );
    }
    return r.join(" | ");
  },
);

// ---------- Disconnect ----------
for (const role of ROLES) {
  await step(
    S(role, role === "business_user" ? "/portal/settings/api-keys" : "/settings/api-keys"),
    "Disconnect: API keys → Connected Clients; check Client, Toolsets, scope, granted and last use; Disconnect → Revoke OAuth grant → Revoke; the row leaves; the next call is refused",
    "Row shows Claude with the chosen Toolsets and Read; after Revoke the row is gone and tools/list answers 401",
    async () => {
      const p = pages[role];
      await p.goto(`${BASE}/`);
      await U.apiKeysPane(p, role);
      const region = p.getByRole("region", { name: "Connected Clients" });
      await region.waitFor();
      const rowText = (await region.getByRole("listitem").allInnerTexts()).map(flat).join(" || ");
      await region.getByRole("button", { name: "Disconnect Claude", exact: true }).click();
      const dlg = p.getByRole("dialog", { name: "Revoke OAuth grant" });
      const dlgText = flat(await dlg.innerText());
      await dlg.getByRole("button", { name: "Revoke", exact: true }).click();
      await dlg.waitFor({ state: "detached" });
      await pause(800);
      const left = await region
        .getByRole("button", { name: "Disconnect Claude", exact: true })
        .count();
      const next = await rawToolsList(MCP, bearer(grants[role]));
      expectThat(left === 0 && next.status === 401, JSON.stringify({ left, next: next.status }));
      return `Connected Clients rows: "${rowText}". Dialog "${dlgText}". After Revoke: Disconnect Claude buttons ${left}; next tools/list ${next.status}.`;
    },
  );
}

// ---------- expired consent links (ten minutes) ----------
for (const role of ROLES) {
  await step(
    S(role, "/auth/consent"),
    `Negative: an expired consent link (the first consent URL for ${PEOPLE[role].name}, reopened after ten minutes)`,
    "This consent request has expired or changed. Start again from your Client.; no Allow, no Deny",
    async () => {
      const wait = firstConsent[role].at + 615_000 - Date.now();
      if (wait > 0) {
        console.log(`waiting ${Math.round(wait / 1000)} s for the consent link to expire`);
        await pause(wait);
      }
      const p = pages[role];
      await p.goto(firstConsent[role].url);
      const c = await readConsent(p);
      expectThat(
        c.text.includes(
          "This consent request has expired or changed. Start again from your Client.",
        ) &&
          c.allowCount === 0 &&
          c.denyCount === 0,
        JSON.stringify({ text: c.text.slice(0, 300) }),
      );
      return `Reopened ${Math.round((Date.now() - firstConsent[role].at) / 1000)} s later. Page: "${c.text.slice(0, 220)}"; Allow ${c.allowCount}, Deny ${c.denyCount}.`;
    },
  );
}

// ---------- live-provider checks: blocked ----------
const BLOCKED =
  "Blocked: needs the owner's real Anthropic account in claude.ai, Claude Desktop, Cowork and Claude Code, and a publicly reachable HTTPS deployment. The batch instruction for this seat forbids running the claude CLI, and no stand-in is used.";
for (const [scenario, what] of [
  [
    "V-M41-C59",
    "claude.ai, Claude Desktop and Cowork custom connector (Customize → Connectors → Add custom connector → Connect → consent); Claude Code over HTTP with /mcp and over private HTTPS with its loopback callback; Disconnect from the vendor side",
  ],
  [
    "V-M42-C59",
    "Claude Code: @openlaw:openlaw://contracts/{number}, /openlaw:triage_inbox, /openlaw:summarize_record; claude.ai: + → Connectors → Add to OpenLaw attachment menu with the Inbox resource and the summary prompt",
  ],
]) {
  for (const role of ROLES) {
    await step(
      { ...S(role, "vendor"), scenario, method: "live-provider-check" },
      `Live provider: ${what}`,
      "The Client acts as the signed-in person within the selected Toolsets, scope and record access",
      async (entry) => {
        entry.result = "blocked";
        return BLOCKED;
      },
    );
  }
}

// ---------- state after ----------
await step(
  S("administrator", "fixture", { article: "configure-mcp", scenario: "V-M41-MCP" }),
  "Cleanup: disconnect any remaining grants from this phase; MCP settings as the next phase expects",
  "No active grants from this phase",
  async () => {
    const list = (await api(admin, BASE, "GET", "/api/v1/mcp-settings/oauth-grants")).body ?? [];
    let n = 0;
    for (const g of list.filter?.((x) => !x.revokedAt) ?? []) {
      const r = await api(admin, BASE, "POST", `/api/v1/oauth-grants/${g.id}/revoke`);
      if (r.status < 300) n++;
    }
    return `Revoked ${n} remaining grants (state write through the Administrator's session).`;
  },
);

void log;
void save;
void magicLink;
finish();
cb.close();
await browser.close();
process.exit(0);
