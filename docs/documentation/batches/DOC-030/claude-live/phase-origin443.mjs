// DOC-030 claude-live, phase "origin443": the coordinator moved the lab from :8443 to :443
// because claude.ai never reached :8443. This phase records the coordinator's report, then
// repeats the outside checks against https://omarchy.tail0a8904.ts.net (pinned to a public
// Funnel ingress address) and re-reads the pill as Daniel Okafor.
// Run under: pasta --config-net -T 43330,48450 -- node phase-origin443.mjs
import path from "node:path";
import {
  createLog,
  expectThat,
  flat,
  LAB,
  MCP_URL,
  PEOPLE,
  PUBLIC,
  PW_PATH,
  ROOT,
} from "./lib.mjs";

const PASSWORD = process.env.LAB_PASSWORD;
if (!PASSWORD) throw new Error("Set LAB_PASSWORD.");
const HOST = new URL(PUBLIC).hostname;
const { log, save, step } = createLog("origin443", {
  lab: LAB.name,
  publicOrigin: PUBLIC,
  coordinatorReport: {
    receivedAt: new Date().toISOString(),
    source: "DOC-030 coordinator, relaying the batch owner (a person with a claude.ai account)",
    portMove:
      "claude.ai never contacted the lab on port 8443. claude.ai's Add custom connector check said \"Couldn't reach this address\" and the app log showed no request, while public relay requests on 8443 returned 200. With the owner's approval the coordinator moved the lab to 443: BASE_URL=https://omarchy.tail0a8904.ts.net in the lab .env; app and worker recreated with docker compose -p openlaw-docs-80ceef9e-claudelive -f compose.yml -f ../overlay.json up -d --no-build --pull never app worker; Tailscale Funnel now serves 443 → 127.0.0.1:43330; 8443 is off. The owner's tailnet-only 443 → 127.0.0.1:3773 serve is removed for this session and saved by the coordinator, who restores it at teardown.",
    claudeAiObservation:
      'With the connector on 443, claude.ai\'s check reached the server. It detected "Sign in now" and "Use Claude\'s published identity (CIMD)". claude.ai\'s current flow: Customize → Connectors → Add (a plus icon labelled "Add") → Add custom connector. Step 1 asks for Name and MCP server URL, then Continue. Step 2 shows Authentication (Sign in now, Detected), OAuth client (Use Claude\'s published identity, Detected; Register automatically; Use your own OAuth client), Request headers and Advanced, then Add. The connector page then says "You\'re not connected to OpenLaw DOC-030 yet." with Connect.',
  },
});
const S = {
  article: "deployment-configuration",
  scenario: "V-M41-PUBLIC",
  role: "operator",
  method: "container-operation",
  page: "Tailscale Funnel 443",
};

log.guideFailures = log.guideFailures.filter((g) => !g.id?.startsWith("claude-live-"));
log.guideFailures.push(
  {
    id: "claude-live-port-8443",
    article: "deployment-configuration",
    section: "Publicly reachable, step 1",
    step: "Give the instance a public DNS hostname with a public IPv4 address … Set that HTTPS origin as BASE_URL",
    expected:
      "Any public HTTPS origin that passes the guide's checks works for claude.ai custom connectors.",
    observed:
      "An origin on port 8443 (https://omarchy.tail0a8904.ts.net:8443) passed every check in the guide from outside (public A records, trusted certificate, JSON discovery, 401 with WWW-Authenticate), but claude.ai's Add custom connector check said \"Couldn't reach this address\" and no request reached the app. On port 443 the same host was reached at once. The guide does not say that the hosted vendors need the default HTTPS port.",
    source:
      "batch owner's claude.ai session, relayed by the coordinator; app log read by the coordinator",
    reportedToAuthor: true,
  },
  {
    id: "claude-live-connector-dialog",
    article: "connect-claude",
    section: "Connect claude.ai, Claude Desktop or Cowork, steps 1-4",
    step: "Customize → Connectors, select +, then Add custom connector … Leave the OAuth Client ID and secret in Advanced settings empty … Select Add, then Connect",
    expected:
      "The labels in the guide: +, Add custom connector, Advanced settings with OAuth Client ID and secret, Add, Connect.",
    observed:
      'claude.ai today: Customize → Connectors → Add (a plus icon labelled "Add") → Add custom connector. Step 1: Name and MCP server URL, then Continue. Step 2: Authentication (Sign in now, Detected); OAuth client (Use Claude\'s published identity, Detected; Register automatically; Use your own OAuth client); Request headers; Advanced; then Add. The connector page says "You\'re not connected to OpenLaw DOC-030 yet." with Connect. There are no OAuth Client ID and secret fields under Advanced settings to leave empty; the matching choice is OAuth client → Use Claude\'s published identity.',
    source:
      "batch owner's claude.ai session, relayed by the coordinator (the person's observation)",
    reportedToAuthor: true,
  },
);
save();

let ingress = [];
await step(
  S,
  "Tailscale state after the move: Funnel on 443 → 127.0.0.1:43330; 8443 off; tcp 5901 unchanged",
  "funnel status shows only the 443 Funnel and the 5901 entry",
  async () => {
    const { execFileSync } = await import("node:child_process");
    const st = execFileSync("tailscale", ["funnel", "status"], { encoding: "utf8" });
    const ok =
      /https:\/\/omarchy\.tail0a8904\.ts\.net \(Funnel on\)\s*\n\|-- \/ proxy http:\/\/127\.0\.0\.1:43330/.test(
        st,
      ) &&
      !/:8443/.test(st) &&
      /:5901 \(tailnet only\)/.test(st);
    expectThat(ok, st);
    return `tailscale funnel status: "https://omarchy.tail0a8904.ts.net (Funnel on) |-- / proxy http://127.0.0.1:43330"; no 8443 entry; tcp :5901 → localhost:5900 unchanged. The owner's tailnet-only 443 → 3773 entry is removed for this session by the coordinator.`;
  },
).catch(() => {});

const undici = await import(
  path.join(ROOT, "node_modules/.pnpm/undici@7.29.1/node_modules/undici/index.js")
);
await step(
  S,
  "Public DNS and certificate for the 443 origin",
  "Public A records; TLS verified",
  async () => {
    const cf = await (
      await fetch(`https://cloudflare-dns.com/dns-query?name=${HOST}&type=A`, {
        headers: { accept: "application/dns-json" },
      })
    ).json();
    ingress = (cf.Answer ?? []).filter((a) => a.type === 1).map((a) => a.data);
    const r = await undici.fetch(`${PUBLIC}/readyz`, {
      dispatcher: new undici.Agent({
        connect: {
          lookup: (_h, o, cb) =>
            o?.all ? cb(null, [{ address: ingress[0], family: 4 }]) : cb(null, ingress[0], 4),
        },
      }),
    });
    expectThat(ingress.length && r.status === 200, `${ingress} ${r.status}`);
    return `Cloudflare DoH A: ${ingress.join(", ")}. /readyz via ${ingress[0]}:443 → ${r.status} with a verified certificate (undici default trust).`;
  },
);
const outside = (p, init = {}) =>
  undici.fetch(`${PUBLIC}${p}`, {
    ...init,
    dispatcher: new undici.Agent({
      connect: {
        lookup: (_h, o, cb) =>
          o?.all ? cb(null, [{ address: ingress[0], family: 4 }]) : cb(null, ingress[0], 4),
      },
    }),
  });

await step(
  S,
  "Discovery paths on the 443 origin return JSON with the new issuer",
  "Each well-known path 200 JSON; issuer https://omarchy.tail0a8904.ts.net/api/auth",
  async () => {
    const out = [];
    let bad = 0;
    for (const p of [
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-authorization-server/api/auth",
      "/.well-known/openid-configuration",
      "/.well-known/openid-configuration/api/auth",
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
      "/api/auth/jwks",
    ]) {
      const r = await outside(p);
      const type = (r.headers.get("content-type") ?? "").split(";")[0];
      let j = null;
      try {
        j = JSON.parse(await r.text());
      } catch {}
      const good =
        r.status === 200 &&
        type.includes("json") &&
        j &&
        (!j.issuer || j.issuer === `${PUBLIC}/api/auth`) &&
        (!j.resource || j.resource === MCP_URL);
      if (!good) bad++;
      out.push(
        `${p} → ${r.status} ${type} (${j?.issuer ? `issuer ${j.issuer}` : j?.resource ? `resource ${j.resource}` : j?.keys ? `${j.keys.length} key(s)` : "?"})`,
      );
    }
    expectThat(bad === 0, out.join("; "));
    return out.join("; ");
  },
);

await step(
  S,
  "Unauthenticated /mcp on the 443 origin returns 401 with WWW-Authenticate",
  `401; resource_metadata="${PUBLIC}/.well-known/oauth-protected-resource"`,
  async () => {
    const r = await outside("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "DOC-030 claude-live probe", version: "1" },
        },
      }),
    });
    const www = r.headers.get("www-authenticate") ?? "";
    await r.text();
    expectThat(
      r.status === 401 &&
        www.includes(`resource_metadata="${PUBLIC}/.well-known/oauth-protected-resource"`),
      `${r.status} ${www}`,
    );
    return `POST /mcp initialize without credentials → ${r.status}; WWW-Authenticate: ${www.slice(0, 110)}…`;
  },
);

await step(
  {
    ...S,
    role: "administrator",
    method: "browser-walkthrough",
    article: "configure-mcp",
    scenario: "V-M41-C59 prerequisite (configure-mcp Enable OAuth Clients)",
    page: "/settings/mcp",
    secrets: [PASSWORD],
  },
  "Re-read Server address and the pill as Daniel Okafor on the 443 origin",
  `Server address ${MCP_URL}; pill text recorded`,
  async () => {
    const { chromium } = await import(PW_PATH);
    const browser = await chromium.launch({
      args: [`--host-resolver-rules=MAP ${HOST} ${ingress[0]}`],
    });
    try {
      const page = await (
        await browser.newContext({ viewport: { width: 1440, height: 1000 } })
      ).newPage();
      await page.goto(`${PUBLIC}/auth/login`);
      await page.getByLabel("Email").fill(PEOPLE.administrator.email);
      await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL((u) => !u.pathname.startsWith("/auth/"), { timeout: 30000 });
      await page
        .getByRole("banner")
        .getByRole("button", { name: PEOPLE.administrator.name })
        .click();
      await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
      await page
        .getByRole("navigation", { name: "Settings sections" })
        .getByRole("link", { name: "MCP", exact: true })
        .first()
        .click();
      await page.waitForURL(/\/settings\/mcp$/);
      await page.getByText(/^MCP is (on|off)$/).waitFor();
      const text = flat(await page.locator("main").innerText());
      const addr = text.match(/https?:\/\/\S+\/mcp/)?.[0];
      const pill = flat(
        await page
          .getByRole("status")
          .filter({ hasText: /Not reachable|Reachable/ })
          .innerText(),
      );
      const sw = {};
      for (const n of [
        "Enable MCP",
        "Legal Users OAuth Clients",
        "Business Users OAuth Clients",
        "Enable Claude",
        "Enable Claude Code",
      ])
        sw[n] = await page
          .getByRole("switch", { name: n, exact: true })
          .getAttribute("aria-checked");
      await page.screenshot({
        path: new URL("./settings-mcp-pill-443.png", import.meta.url).pathname,
      });
      expectThat(
        addr === MCP_URL && Object.values(sw).every((v) => v === "true"),
        JSON.stringify({ addr, pill, sw }),
      );
      return `Server address ${addr}. Pill "${pill}". Switches ${JSON.stringify(sw)}. Screenshot settings-mcp-pill-443.png.`;
    } finally {
      await browser.close();
    }
  },
);
save();
console.log("origin443 done");
