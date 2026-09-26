// DOC-030 mcp, phase m41: V-M41-MCP on the owned mcplan lab (loopback Instance address
// http://127.0.0.1:43320, saved in Settings → Advanced after the lan phase). The OAuth
// Client's own protocol steps (authorize URL, token exchange, refresh, self-registration)
// are made with fetch, as a Client makes them; every OpenLaw screen step runs in the browser.
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  api,
  articleHash,
  browserSignIn,
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
  until,
  waitHealthy,
} from "./lib.mjs";

const LAB = LABS.mcplan;
const BASE = LAB.base;
const MCP_URL = `${BASE}/mcp`;
const { chromium } = await import(PW_PATH);
const { log, save, step } = createLog("m41", {
  lab: LAB.name,
  environment: LAB.project,
  appUrl: BASE,
  mailUrl: LAB.mail,
  labManifest: JSON.parse(
    readFileSync(path.join(ROOT, ".documentation-labs/mcplan/lab.json"), "utf8"),
  ),
  instanceAddress:
    "Application address http://127.0.0.1:43320 saved in Settings → Advanced (BASE_URL unpinned by overlay-unpin.json)",
});
const S = (page, role = "administrator") => ({
  article: "configure-mcp",
  scenario: "V-M41-MCP",
  role,
  lab: LAB.name,
  page,
});
const DAY = 86400000;

// ---------- a loopback callback for the registered Clients ----------
let lastCallback;
const cb = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname !== "/callback") return res.writeHead(404).end();
  lastCallback = url;
  res.writeHead(200, { "content-type": "text/plain" }).end("DOC-030 fictional Client callback.");
});
await new Promise((r) => cb.listen(0, "127.0.0.1", r));
const REDIRECT = `http://127.0.0.1:${cb.address().port}/callback`;

const browser = await chromium.launch();
async function context(role) {
  const c = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await c.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const p = await c.newPage();
  await browserSignIn(p, BASE, PEOPLE[role]);
  return p;
}
const admin = await context("administrator");
const ltm = await context("legal_team_member");
const main = async (page) => flat(await page.locator("main").innerText());
const clip = (page) => page.evaluate(() => navigator.clipboard.readText());
async function openSettings(page, name = PEOPLE.administrator.name) {
  // After a consent the tab sits on the Client's callback page; come back to OpenLaw first.
  if (!page.url().startsWith(BASE)) await page.goto(`${BASE}/`);
  await page.getByRole("banner").getByRole("button", { name }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await page.waitForURL(/\/settings/);
  await page.waitForLoadState("networkidle").catch(() => {});
  return page.getByRole("navigation", { name: "Settings sections" });
}
async function gotoMcp(page = admin) {
  const nav = await openSettings(page);
  await nav.getByRole("link", { name: "MCP", exact: true }).first().click();
  await page.waitForURL(/\/settings\/mcp$/);
  await page.getByText(/^MCP is (on|off)$/).waitFor();
}
async function setSwitch(label, want, page = admin) {
  const sw = page.getByRole("switch", { name: label, exact: true });
  if (((await sw.getAttribute("aria-checked")) === "true") === want) return 0;
  const resp = page.waitForResponse(
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
async function expandCard(title, page = admin) {
  const b = page.getByRole("button", { name: title, exact: true });
  if ((await b.getAttribute("aria-expanded")) !== "true") await b.click();
  return b;
}
function clientRow(name) {
  return admin
    .locator("div.flex.flex-wrap.items-center")
    .filter({ has: admin.getByRole("switch", { name: `Enable ${name}`, exact: true }) })
    .first();
}
async function secretDialog() {
  const d = admin.getByRole("dialog", { name: "Your Client secret is ready" });
  await d.waitFor();
  const text = flat(await d.innerText());
  await admin.mouse.click(5, 5);
  await pause(300);
  const survived = await d.isVisible();
  await d.getByRole("button", { name: "Copy", exact: true }).click();
  await d.getByRole("button", { name: "Copied", exact: true }).waitFor();
  const secret = (await clip(admin)).trim();
  const clientId = flat(await d.locator("dd").last().innerText());
  await d.getByRole("button", { name: "Done", exact: true }).click();
  await d.waitFor({ state: "detached" });
  return { secret, clientId, text: text.replace(secret, "<secret>"), survived };
}
const allowed = async () =>
  (await api(admin, BASE, "GET", "/api/v1/mcp-settings/allowed-clients")).body;
const grants = async () =>
  (await api(admin, BASE, "GET", "/api/v1/mcp-settings/oauth-grants")).body;

// ---------- the Client side of OAuth ----------
async function consent(page, clientId, { toolsets, write, scope }) {
  const verifier = randomBytes(48).toString("base64url");
  const state = randomBytes(16).toString("base64url");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope,
    resource: MCP_URL,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state,
  });
  lastCallback = undefined;
  await page.goto(`${BASE}/api/auth/oauth2/authorize?${params}`);
  await page.waitForURL(/\/auth\/consent\?/);
  const heading = flat(
    await page
      .getByRole("heading", { level: 1 })
      .first()
      .innerText()
      .catch(() => ""),
  );
  const text = await main(page).catch(async () => flat(await page.locator("body").innerText()));
  const offered = await page
    .getByRole("checkbox")
    .evaluateAll((els) => els.map((e) => e.closest("label")?.textContent?.trim()));
  const radios = await page
    .getByRole("radio")
    .evaluateAll((els) => els.map((e) => e.closest("label")?.textContent?.trim().slice(0, 40)));
  const allowDisabled = await page.getByRole("button", { name: "Allow", exact: true }).isDisabled();
  for (const t of toolsets) await page.getByRole("checkbox", { name: t, exact: true }).check();
  await page
    .getByRole("radio", { name: write ? "Read and write" : "Read only", exact: true })
    .check();
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  await until(() => lastCallback, "no callback", 20000);
  expectThat(lastCallback.searchParams.get("state") === state, "state mismatch");
  return {
    code: lastCallback.searchParams.get("code"),
    verifier,
    heading,
    text: text.slice(0, 300),
    offered,
    radios,
    allowDisabled,
  };
}
async function token(form) {
  const r = await fetch(`${BASE}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ resource: MCP_URL, ...form }),
  });
  let body = null;
  try {
    body = await r.json();
  } catch {}
  return { status: r.status, body };
}
async function exchange(clientId, secret, c) {
  const t = await token({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: secret,
    code: c.code,
    redirect_uri: REDIRECT,
    code_verifier: c.verifier,
  });
  expectThat(
    t.status === 200 && t.body?.access_token,
    `token ${t.status} ${JSON.stringify(t.body)}`,
  );
  return t.body;
}
const bearer = (access) => ({ authorization: `Bearer ${access}` });

// =====================================================================
await step(
  S("/settings/mcp"),
  "Enable OAuth Clients 1-3: MCP on; Legal Users and Business Users OAuth Clients on; pill beside Server address",
  "Switches save; pill appears only while an OAuth switch is on: Not reachable · HTTPS scheme, Public IPv4 address; API keys switches unchanged",
  async () => {
    await gotoMcp();
    await setSwitch("Enable MCP", true);
    await setSwitch("Legal Users OAuth Clients", false);
    await setSwitch("Business Users OAuth Clients", false);
    const pillOff = await admin.getByText(/Not reachable|^Reachable$/).count();
    const s1 = await setSwitch("Legal Users OAuth Clients", true);
    const pill = flat(
      await admin
        .getByRole("status")
        .filter({ hasText: /Not reachable|Reachable/ })
        .innerText(),
    );
    const s2 = await setSwitch("Business Users OAuth Clients", true);
    const keysL = await admin
      .getByRole("switch", { name: "Legal Users API keys" })
      .getAttribute("aria-checked");
    const keysB = await admin
      .getByRole("switch", { name: "Business Users API keys" })
      .getAttribute("aria-checked");
    const addr = (await main(admin)).match(/http\S+\/mcp/)?.[0];
    const caption = (await main(admin)).match(/OAuth Clients expose[^.]*\./)?.[0];
    expectThat(
      pillOff === 0 &&
        s1 === 200 &&
        s2 === 200 &&
        pill === "Not reachable · HTTPS scheme, Public IPv4 address",
      JSON.stringify({ pillOff, s1, s2, pill }),
    );
    return `Server address ${addr}. Pill while both OAuth switches off: ${pillOff} elements. Legal Users OAuth Clients → ${s1}; pill "${pill}". Business Users OAuth Clients → ${s2}. API keys switches stay Legal ${keysL}, Business ${keysB}. Row caption: "${caption}"`;
  },
);

await step(
  S("/settings/mcp"),
  "Manage Allowed Clients: card starts open; four seeded Clients enabled; published identities with metadata URL captions, not editable; toggle one off and on",
  "Claude, Claude Code and ChatGPT Published identity; Microsoft 365 Copilot Registered client with No secret generated",
  async () => {
    await admin.reload();
    const cardOpen = await admin
      .getByRole("button", { name: "Allowed Clients", exact: true })
      .getAttribute("aria-expanded");
    const rows = {};
    for (const n of ["Claude", "Claude Code", "ChatGPT", "Microsoft 365 Copilot"]) {
      rows[n] = {
        text: flat(await clientRow(n).innerText()),
        enabled: await admin
          .getByRole("switch", { name: `Enable ${n}`, exact: true })
          .getAttribute("aria-checked"),
        edit: await admin.getByRole("button", { name: `Edit ${n}`, exact: true }).count(),
      };
    }
    const off = await setSwitch("Enable Claude", false);
    const on = await setSwitch("Enable Claude", true);
    const dyn = await admin
      .getByRole("switch", { name: "Dynamic client registration" })
      .getAttribute("aria-checked");
    expectThat(
      cardOpen === "true" &&
        Object.values(rows).every((r) => r.enabled === "true") &&
        rows.Claude.edit === 0 &&
        rows["Microsoft 365 Copilot"].edit === 1 &&
        /No secret generated/.test(rows["Microsoft 365 Copilot"].text),
      JSON.stringify(rows),
    );
    return `Allowed Clients aria-expanded ${cardOpen}. Rows ${JSON.stringify(rows)}. Enable Claude off → ${off}, on → ${on}. Dynamic client registration starts ${dyn}.`;
  },
);

let copilot = {};
await step(
  S("/settings/mcp"),
  "Microsoft 365 Copilot template: Edit → Edit Client with Client name, Client id, Callback URLs (two read-only, one empty); fill the slot and Save; a non-loopback http callback is refused",
  "Fixed callbacks read-only; slot saves; http://192.168.1.5 callback shows the save failure",
  async () => {
    await admin.getByRole("button", { name: "Edit Microsoft 365 Copilot", exact: true }).click();
    const d = admin.getByRole("dialog", { name: "Edit Client" });
    const text = flat(await d.innerText());
    const cbs = [];
    for (let i = 1; i <= 3; i++) {
      const f = d.getByLabel(`Callback URL ${i}`);
      cbs.push({
        value: await f.inputValue(),
        readOnly: (await f.getAttribute("readonly")) !== null,
      });
    }
    await d.getByLabel("Callback URL 3").fill("http://192.168.1.5/consent");
    await d.getByRole("button", { name: "Save", exact: true }).click();
    const refused = flat(await d.getByRole("alert").innerText({ timeout: 10000 }));
    await d
      .getByLabel("Callback URL 3")
      .fill("https://copilotstudio.fictional.example/consent-redirect");
    await d.getByRole("button", { name: "Add callback URL" }).click();
    const slots = await d.getByLabel(/^Callback URL \d$/).count();
    await d.getByRole("button", { name: "Save", exact: true }).click();
    await d.waitFor({ state: "detached" });
    const saved = (await allowed()).find((c) => c.name === "Microsoft 365 Copilot").callbackUrls;
    expectThat(
      cbs[0].readOnly &&
        cbs[1].readOnly &&
        !cbs[2].readOnly &&
        cbs[2].value === "" &&
        /Generate a secret to create the client id\./.test(text) &&
        /could not be saved/.test(refused) &&
        saved[2] === "https://copilotstudio.fictional.example/consent-redirect",
      JSON.stringify({ cbs, refused, saved }),
    );
    return `Edit Client text: "${text.slice(0, 260)}". Callbacks ${JSON.stringify(cbs)}. http://192.168.1.5/consent → "${refused}". Add callback URL → ${slots} slots. Saved callbacks ${JSON.stringify(saved)}.`;
  },
);
await step(
  S("/settings/mcp"),
  "Template 1-2: Edit → Generate secret; Your Client secret is ready; Copy; Client id; Done",
  "One-time secret dialog; caption becomes Secret generated; the button becomes Rotate secret",
  async () => {
    await admin.getByRole("button", { name: "Edit Microsoft 365 Copilot", exact: true }).click();
    const d = admin.getByRole("dialog", { name: "Edit Client" });
    await d.getByRole("button", { name: "Generate secret", exact: true }).click();
    const s = await secretDialog();
    copilot = s;
    const caption = flat(await clientRow("Microsoft 365 Copilot").innerText());
    await admin.getByRole("button", { name: "Edit Microsoft 365 Copilot", exact: true }).click();
    const d2 = admin.getByRole("dialog", { name: "Edit Client" });
    const rotate = await d2.getByRole("button", { name: "Rotate secret", exact: true }).count();
    const idShown = flat(await d2.locator("code").innerText());
    const del = await d2.getByRole("button", { name: "Delete Client" }).count();
    await d2.getByRole("button", { name: "Cancel", exact: true }).click();
    expectThat(
      s.secret.length > 16 &&
        s.survived &&
        /Secret generated/.test(caption) &&
        rotate === 1 &&
        idShown === s.clientId &&
        del === 0,
      JSON.stringify({ caption, rotate, idShown, del }),
    );
    return `Dialog: "${s.text.slice(0, 260)}". Outside click kept it open. Secret copied (${s.secret.length} chars), Client id ${s.clientId}. Row now "${caption}". Edit shows Client id ${idShown} and Rotate secret; Delete Client buttons for the seeded template: ${del}.`;
  },
);

let c1 = {};
const c1Name = `DOC-030 mcp registered ${stamp}`;
await step(
  S("/settings/mcp"),
  "Add Client: Client name and a loopback callback, Save; the editor stays open as Edit Client; Generate secret",
  "Editor turns into Edit Client; secret dialog; new Client starts enabled; Delete Client offered",
  async () => {
    await admin.getByRole("button", { name: "Add Client", exact: true }).click();
    const d = admin.getByRole("dialog", { name: "Add Client" });
    await d.getByLabel("Client name").fill(c1Name);
    await d.getByLabel("Callback URL 1").fill(REDIRECT);
    await d.getByRole("button", { name: "Save", exact: true }).click();
    const e = admin.getByRole("dialog", { name: "Edit Client" });
    await e.waitFor();
    const del = await e.getByRole("button", { name: "Delete Client" }).count();
    await e.getByRole("button", { name: "Generate secret", exact: true }).click();
    c1 = await secretDialog();
    const enabled = await admin
      .getByRole("switch", { name: `Enable ${c1Name}` })
      .getAttribute("aria-checked");
    expectThat(del === 1 && enabled === "true", `${del} ${enabled}`);
    return `After Save the dialog title is Edit Client; Delete Client offered (${del}). Generate secret → "${c1.text.slice(0, 120)}"; Client id ${c1.clientId}. Row: "${flat(await clientRow(c1Name).innerText())}", enabled ${enabled}.`;
  },
);

let grantA = {};
await step(
  S("/auth/consent", "legal_team_member"),
  "A Legal Team Member consents: choose from the requested Toolsets and Read and write (no Administrator approval)",
  "Consent page lists only requested Toolsets and both scope choices; Allow returns a code; tokens work on /mcp",
  async () => {
    const c = await consent(ltm, c1.clientId, {
      toolsets: ["Matters"],
      write: true,
      scope: "toolset:matters toolset:contracts write offline_access",
    });
    const t = await exchange(c1.clientId, c1.secret, c);
    const tools = await rawToolsList(MCP_URL, bearer(t.access_token));
    grantA = { access: t.access_token, refresh: t.refresh_token, scope: t.scope };
    expectThat(
      tools.status === 200 &&
        tools.names.includes("openlaw_matter_create") &&
        !tools.names.includes("openlaw_contracts_list") &&
        c.offered.length === 2,
      JSON.stringify({ offered: c.offered, names: tools.names }),
    );
    return `Consent heading "${c.heading}"; text "${c.text.slice(0, 200)}". Offered Toolsets ${JSON.stringify(c.offered)}; radios ${JSON.stringify(c.radios)}; Allow disabled before choosing: ${c.allowDisabled}. Chose Matters + Read and write → callback with code. Token scope "${t.scope}". tools/list ${tools.status}: ${tools.names.length} Tools incl. openlaw_matter_create, no Contracts Tools.`;
  },
);

await step(
  S("/settings/mcp"),
  "Active keys and grants lists the grant with Owner, Client, Toolsets, Scope, Status, Granted, Last used and Expires (default 90 days)",
  "1 grant; Expires 90 days after Granted",
  async () => {
    await gotoMcp();
    await expandCard("Active keys and grants");
    const counts = (await main(admin)).match(/\d+ keys? · \d+ grants?/)?.[0];
    const row = flat(await admin.getByRole("row").filter({ hasText: c1Name }).innerText());
    const g = (await grants()).find((x) => x.clientName === c1Name);
    const days = Math.round((new Date(g.expiresAt) - new Date(g.grantedAt)) / DAY);
    grantA.id = g.id;
    expectThat(days === 90 && /Nadia Haddad/.test(row) && /Active/.test(row), `${row} ${days}`);
    return `Counts "${counts}". Row "${row}". State read: grantedAt ${g.grantedAt}, expiresAt ${g.expiresAt} (${days} days).`;
  },
);

await step(
  S("/settings/mcp"),
  "Policy on an existing grant: Read-only, the Allowed Client switch and the group's OAuth Clients switch apply to the next request",
  "Read-only drops write Tools; Client off or group off → 401; back on → 200",
  async () => {
    await expandCard("Toolset ceiling");
    await setSwitch("Read-only", true);
    const ro = await rawToolsList(MCP_URL, bearer(grantA.access));
    await setSwitch("Read-only", false);
    await setSwitch(`Enable ${c1Name}`, false);
    const clientOff = await rawToolsList(MCP_URL, bearer(grantA.access));
    await setSwitch(`Enable ${c1Name}`, true);
    await setSwitch("Legal Users OAuth Clients", false);
    const groupOff = await rawToolsList(MCP_URL, bearer(grantA.access));
    await setSwitch("Legal Users OAuth Clients", true);
    const back = await rawToolsList(MCP_URL, bearer(grantA.access));
    expectThat(
      ro.status === 200 &&
        !ro.names.includes("openlaw_matter_create") &&
        clientOff.status === 401 &&
        groupOff.status === 401 &&
        back.status === 200,
      JSON.stringify([ro.names, clientOff.status, groupOff.status, back.status]),
    );
    return `Read-only on → ${ro.names.length} Tools, openlaw_matter_create absent. Enable ${c1Name} off → ${clientOff.status}. Legal Users OAuth Clients off → ${groupOff.status}. All back on → ${back.status}.`;
  },
);

let c1Secret2;
await step(
  S("/settings/mcp"),
  "Negative: Rotate secret invalidates the old secret at once and keeps the grant",
  "Old secret refused at the token endpoint; grant still listed; new secret refreshes",
  async () => {
    const before = (await grants()).filter((g) => g.clientName === c1Name).length;
    await admin.getByRole("button", { name: `Edit ${c1Name}`, exact: true }).click();
    const d = admin.getByRole("dialog", { name: "Edit Client" });
    await d.getByRole("button", { name: "Rotate secret", exact: true }).click();
    const s = await secretDialog();
    c1Secret2 = s.secret;
    const old = await token({
      grant_type: "refresh_token",
      client_id: c1.clientId,
      client_secret: c1.secret,
      refresh_token: grantA.refresh,
    });
    const after = (await grants()).filter((g) => g.clientName === c1Name).length;
    await admin.reload();
    await expandCard("Active keys and grants");
    const row = flat(await admin.getByRole("row").filter({ hasText: c1Name }).innerText());
    const fresh = await token({
      grant_type: "refresh_token",
      client_id: c1.clientId,
      client_secret: c1Secret2,
      refresh_token: grantA.refresh,
    });
    const works =
      fresh.status === 200
        ? await rawToolsList(MCP_URL, bearer(fresh.body.access_token))
        : { status: null };
    if (fresh.status === 200)
      grantA = {
        ...grantA,
        access: fresh.body.access_token,
        refresh: fresh.body.refresh_token ?? grantA.refresh,
      };
    expectThat(
      s.clientId === c1.clientId &&
        old.status >= 400 &&
        before === 1 &&
        after === 1 &&
        fresh.status === 200 &&
        works.status === 200,
      JSON.stringify({ old, before, after, fresh: fresh.status, works: works.status }),
    );
    return `Rotate secret → "${s.text.slice(0, 120)}"; same Client id. Refresh with the old secret → ${old.status} ${JSON.stringify(old.body)}. Grants for the Client before ${before}, after ${after}; row "${row}". Refresh with the new secret → ${fresh.status}; tools/list with the new access token → ${works.status}.`;
  },
);

await step(
  S("/settings/mcp"),
  "Dynamic client registration: on lets a Client register itself (Registered by the Client); off refuses new registrations and drops the endpoint from discovery but keeps the entry",
  "Entry enabled with caption Registered by the Client; after off, registration refused and entry unchanged; Delete Client removes it",
  async () => {
    const s1 = await setSwitch("Dynamic client registration", true);
    const disc = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
    const endpoint = disc.registration_endpoint;
    const reg = async (name) => {
      const r = await fetch(endpoint ?? `${BASE}/api/auth/oauth2/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: name,
          application_type: "native",
          redirect_uris: [REDIRECT],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        }),
      });
      return { status: r.status, body: (await r.text()).slice(0, 200) };
    };
    const selfName = `DOC-030 mcp self-registered ${stamp}`;
    const r1 = await reg(selfName);
    await admin.reload();
    const row = flat(await clientRow(selfName).innerText());
    const enabled = await admin
      .getByRole("switch", { name: `Enable ${selfName}` })
      .getAttribute("aria-checked");
    const s2 = await setSwitch("Dynamic client registration", false);
    const disc2 = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
    const r2 = await reg(`${selfName} second`);
    await admin.reload();
    const rowAfter = flat(await clientRow(selfName).innerText());
    const enabledAfter = await admin
      .getByRole("switch", { name: `Enable ${selfName}` })
      .getAttribute("aria-checked");
    await admin.getByRole("button", { name: `Edit ${selfName}`, exact: true }).click();
    const d = admin.getByRole("dialog", { name: "Edit Client" });
    await d.getByRole("button", { name: "Delete Client" }).click();
    await d.waitFor({ state: "detached" });
    const gone = (await allowed()).some((c) => c.name === selfName);
    expectThat(
      s1 === 200 &&
        !!endpoint &&
        r1.status === 201 &&
        /Registered by the Client/.test(row) &&
        enabled === "true" &&
        !disc2.registration_endpoint &&
        r2.status >= 400 &&
        enabledAfter === "true" &&
        !gone,
      JSON.stringify({ s1, endpoint, r1, row, s2, r2, rowAfter }),
    );
    return `On (${s1}): discovery registration_endpoint ${new URL(endpoint).pathname}; self-registration (a native Client with a loopback callback) → ${r1.status}; row "${row}", enabled ${enabled}. Off (${s2}): discovery has registration_endpoint ${"registration_endpoint" in disc2}; a new registration → ${r2.status} ${r2.body}; the earlier entry is still "${rowAfter}", enabled ${enabledAfter}. Edit → Delete Client removed it.`;
  },
);

await step(
  S("/settings/mcp"),
  "Revoke a grant from Active keys and grants: Revoke → Revoke OAuth grant → Revoke",
  "Next request refused; grant leaves the list",
  async () => {
    await admin.reload();
    await expandCard("Active keys and grants");
    await admin
      .getByRole("row")
      .filter({ hasText: c1Name })
      .getByRole("button", { name: "Revoke", exact: true })
      .click();
    const d = admin.getByRole("dialog", { name: "Revoke OAuth grant" });
    const warn = flat(await d.innerText());
    await d.getByRole("button", { name: "Revoke", exact: true }).click();
    await d.waitFor({ state: "detached" });
    const after = await rawToolsList(MCP_URL, bearer(grantA.access));
    const refresh = await token({
      grant_type: "refresh_token",
      client_id: c1.clientId,
      client_secret: c1Secret2,
      refresh_token: grantA.refresh,
    });
    const counts = (await main(admin)).match(/\d+ keys? · \d+ grants?/)?.[0];
    expectThat(
      after.status === 401 && refresh.status >= 400,
      JSON.stringify([after.status, refresh.status]),
    );
    return `Dialog "${warn}". After Revoke: tools/list ${after.status}; refresh ${refresh.status}; counts "${counts}".`;
  },
);

// ---------- grant lifetime: saved, bound at boot, applies after restart ----------
let c2 = {};
const c2Name = `DOC-030 mcp lifetime ${stamp}`;
let grantD = {};
let grantN = {};
await step(
  S("/settings/mcp-limits"),
  "OAuth grant lifetime (days): set 7 in Settings → Organization → Advanced → MCP and Save",
  "Settings saved. Restart the API and worker to apply changes.; a grant made before the restart still gets 90 days",
  async () => {
    await gotoMcp();
    await admin.getByRole("button", { name: "Add Client", exact: true }).click();
    const a = admin.getByRole("dialog", { name: "Add Client" });
    await a.getByLabel("Client name").fill(c2Name);
    await a.getByLabel("Callback URL 1").fill(REDIRECT);
    await a.getByRole("button", { name: "Save", exact: true }).click();
    await admin
      .getByRole("dialog", { name: "Edit Client" })
      .getByRole("button", { name: "Generate secret", exact: true })
      .click();
    c2 = await secretDialog();
    const nav = await openSettings(admin);
    if ((await nav.getByRole("link", { name: "MCP", exact: true }).count()) < 2)
      await nav.getByRole("button", { name: "Advanced" }).click();
    await until(
      async () => (await nav.getByRole("link", { name: "MCP", exact: true }).count()) > 1,
      "Advanced MCP not shown",
    );
    await nav.getByRole("link", { name: "MCP", exact: true }).last().click();
    await admin.waitForURL(/\/settings\/mcp-limits/);
    const f = admin.getByLabel("OAuth grant lifetime (days)");
    await f.fill("7");
    await admin.getByRole("button", { name: "Save", exact: true }).click();
    const msg = await admin
      .getByText("Settings saved. Restart the API and worker to apply changes.")
      .innerText({ timeout: 15000 });
    const pending =
      (await main(admin)).match(/Saved changes are waiting for a restart[^.]*\./)?.[0] ?? null;
    const c = await consent(admin, c2.clientId, {
      toolsets: ["Contracts"],
      write: false,
      scope: "toolset:contracts offline_access",
    });
    const t = await exchange(c2.clientId, c2.secret, c);
    grantD = { access: t.access_token, refresh: t.refresh_token };
    const g = (await grants()).find((x) => x.clientName === c2Name && x.owner === "Daniel Okafor");
    grantD.expiresAt = g.expiresAt;
    const days = Math.round((new Date(g.expiresAt) - new Date(g.grantedAt)) / DAY);
    expectThat(days === 90, `pre-restart grant ${days} days`);
    return `Saved 7 → "${msg}". Pending note: "${pending}". A grant made before the restart (Daniel Okafor, ${c2Name}): ${days} days (expiresAt ${g.expiresAt}).`;
  },
);
await step(
  S("container", "operator"),
  "Operator restarts the API and worker so the saved lifetime applies",
  "App answers again",
  async () => {
    mcplanCompose(["restart", "app", "worker"], ["overlay-unpin.json"]);
    await waitHealthy(BASE);
    return "docker compose restart app worker; health check passed.";
  },
);
await step(
  S("/settings/mcp"),
  "New grants use the lifetime after restart; existing grants keep their expiry; refresh does not extend it",
  "New grant 7 days; Daniel's earlier grant keeps its 90-day expiry after a refresh",
  async () => {
    const c = await consent(ltm, c2.clientId, {
      toolsets: ["Contracts"],
      write: false,
      scope: "toolset:contracts offline_access",
    });
    const t = await exchange(c2.clientId, c2.secret, c);
    grantN = { access: t.access_token };
    const all = await grants();
    const n = all.find((x) => x.clientName === c2Name && x.owner === "Nadia Haddad");
    const d = all.find((x) => x.clientName === c2Name && x.owner === "Daniel Okafor");
    const nDays = Math.round((new Date(n.expiresAt) - new Date(n.grantedAt)) / DAY);
    const r = await token({
      grant_type: "refresh_token",
      client_id: c2.clientId,
      client_secret: c2.secret,
      refresh_token: grantD.refresh,
    });
    const d2 = (await grants()).find((x) => x.clientName === c2Name && x.owner === "Daniel Okafor");
    await gotoMcp();
    await expandCard("Active keys and grants");
    const rows = (await admin.getByRole("row").filter({ hasText: c2Name }).allInnerTexts()).map(
      flat,
    );
    const advanced = await (async () => {
      const nav = await openSettings(admin);
      if ((await nav.getByRole("link", { name: "MCP", exact: true }).count()) < 2)
        await nav.getByRole("button", { name: "Advanced" }).click();
      await nav.getByRole("link", { name: "MCP", exact: true }).last().click();
      await admin.waitForURL(/\/settings\/mcp-limits/);
      return (await main(admin)).match(/OAuth grant lifetime \(days\).{0,80}/)?.[0];
    })();
    expectThat(
      nDays === 7 &&
        d.expiresAt === grantD.expiresAt &&
        r.status === 200 &&
        d2.expiresAt === grantD.expiresAt,
      JSON.stringify({ nDays, d, r: r.status, d2 }),
    );
    return `Nadia's new grant after restart: ${nDays} days (expiresAt ${n.expiresAt}). Daniel's earlier grant keeps ${d.expiresAt}; refresh → ${r.status}; expiry after refresh ${d2.expiresAt}. Active keys and grants rows: ${JSON.stringify(rows)}. Advanced page: "${advanced}".`;
  },
);

await step(
  S("/settings/api-keys", "legal_team_member"),
  "People disconnect their own Clients: Connected Clients on the API keys pane → Disconnect → Revoke OAuth grant → Revoke",
  "Grant leaves Connected Clients; its next request is refused",
  async () => {
    const nav = await openSettings(ltm, PEOPLE.legal_team_member.name);
    await nav.getByRole("link", { name: "API keys", exact: true }).click();
    const region = ltm.getByRole("region", { name: "Connected Clients" });
    const text = flat(await region.innerText());
    await region.getByRole("button", { name: `Disconnect ${c2Name}`, exact: true }).click();
    const d = ltm.getByRole("dialog", { name: "Revoke OAuth grant" });
    await d.getByRole("button", { name: "Revoke", exact: true }).click();
    await d.waitFor({ state: "detached" });
    const after = await rawToolsList(MCP_URL, bearer(grantN.access));
    const still = flat(await region.innerText());
    expectThat(after.status === 401 && !still.includes(c2Name), `${after.status} ${still}`);
    return `Connected Clients before: "${text.slice(0, 200)}". Disconnect → Revoke OAuth grant → Revoke; next request ${after.status}; Connected Clients now "${still.slice(0, 120)}".`;
  },
);

await step(
  S("/settings/mcp"),
  "Delete Client removes the entry and its grants, and stops their access",
  "Daniel's grant for the deleted Client is gone and refused",
  async () => {
    await gotoMcp();
    const before = (await grants()).filter((g) => g.clientName === c2Name).length;
    await admin.getByRole("button", { name: `Edit ${c2Name}`, exact: true }).click();
    const d = admin.getByRole("dialog", { name: "Edit Client" });
    await d.getByRole("button", { name: "Delete Client" }).click();
    await d.waitFor({ state: "detached" });
    const after = (await grants()).filter((g) => g.clientName === c2Name).length;
    const refused = await rawToolsList(MCP_URL, bearer(grantD.access));
    const listed = (await allowed()).some((c) => c.name === c2Name);
    expectThat(
      before === 1 && after === 0 && refused.status === 401 && !listed,
      JSON.stringify({ before, after, refused: refused.status }),
    );
    return `Grants for ${c2Name} before ${before}, after ${after}; entry listed ${listed}; Daniel's token now ${refused.status}.`;
  },
);

log.runs.m41.articleHashesAtEnd = {
  "configure-mcp": articleHash("configure-mcp"),
  "connect-headless-client": articleHash("connect-headless-client"),
};
save();
await browser.close();
cb.close();
const failed = log.steps.filter((s) => s.phase === "m41" && s.result !== "pass");
console.log(
  `m41 done: ${log.steps.filter((s) => s.phase === "m41").length} steps, ${failed.length} failed`,
);
process.exit(0);
