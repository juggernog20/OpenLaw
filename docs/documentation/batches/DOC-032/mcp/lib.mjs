// Shared helpers for the DOC-032 mcp independent walkthrough.
// Copied from the DOC-030 mcp walk (docs/documentation/batches/DOC-030/mcp/lib.mjs) and
// pointed at the DOC-032 labs. API calls are used only for fixture setup, state reads and
// the protocol steps a Client performs. Every guide step runs in the browser as the named role.
// The seed demo password comes only from LAB_PASSWORD. API keys, Client secrets, tokens,
// sign-in links, cookies and raw mail are never written to a file: step() scrubs every
// registered secret from what it logs.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../../../../..");
export const REL = "docs/documentation/batches/DOC-032/mcp";
export const PASSWORD = process.env.LAB_PASSWORD;
if (!PASSWORD) throw new Error("Set LAB_PASSWORD to the seed demo password in VALIDATION.md.");
export const APP_COMMIT = "4ca41822b685a2a1e58a38b4f25e421cf735c54e";
export const PW_PATH = path.join(
  ROOT,
  "node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs",
);
const SDK = path.join(
  ROOT,
  "node_modules/.pnpm/@modelcontextprotocol+client@2.1.0/node_modules/@modelcontextprotocol/client",
);
export const sdk = await import(path.join(SDK, "dist/index.mjs"));
export const sdkStdio = await import(path.join(SDK, "dist/stdio.mjs"));
export const undici = await import(
  path.join(ROOT, "node_modules/.pnpm/undici@7.29.0/node_modules/undici/index.js")
);

export const LABS = {
  mcp42: {
    name: "mcp42",
    base: "http://127.0.0.1:43361",
    mail: "http://127.0.0.1:48461",
    project: "openlaw-docs-9d2b1705-mcp42",
  },
  mcpup: {
    name: "mcpup",
    base: "http://127.0.0.1:43363",
    mail: "http://127.0.0.1:48463",
    project: "openlaw-docs-9d2b1705-mcpup",
  },
};
export const labManifest = (name) =>
  JSON.parse(readFileSync(path.join(ROOT, `.documentation-labs/${name}/lab.json`), "utf8"));
export const PEOPLE = {
  administrator: { email: "daniel.okafor@helix.example", name: "Daniel Okafor" },
  legal_team_member: { email: "nadia.haddad@helix.example", name: "Nadia Haddad" },
  business_user: { email: "jonas.weber@helix.example", name: "Jonas Weber" },
};
// A throwaway HOME for the mcp-remote bridge (npx cache). Outside the worktree.
export const BRIDGE_HOME = path.join(process.env.HOME, ".cache/openlaw-doc032-mcp/bridge-home");

export const pause = (ms) => new Promise((r) => setTimeout(r, ms));
export const flat = (s) => (s ?? "").replace(/\s+/g, " ").trim();
export const sha = (buf) => createHash("sha256").update(buf).digest("hex");
export const articleHash = (id) =>
  sha(readFileSync(path.join(ROOT, "docs/user-guides", `${id}.md`)));
export const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(4, 12);

export async function until(fn, message, timeout = 15000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
    } catch {
      last = null;
    }
    if (last) return last;
    await pause(300);
  }
  throw new Error(message);
}
export function expectThat(cond, message) {
  if (!cond) throw new Error(message);
}

// ---------- secrets never reach the log ----------
const SECRETS = new Set([PASSWORD]);
export function secret(value) {
  if (value && String(value).length >= 6) SECRETS.add(String(value));
  return value;
}
export function scrub(text) {
  let t = String(text ?? "");
  for (const s of SECRETS) t = t.split(s).join("<redacted>");
  return t
    .replace(/(token|code|session|cookie|secret|password)=([^&\s"']{6,})/gi, "$1=<redacted>")
    .replace(/\bol_[A-Za-z0-9_-]{10,}/g, "<key>")
    .replace(/Bearer\s+(?!resource_metadata)[A-Za-z0-9._~+/=-]{10,}/g, "Bearer <redacted>");
}

// ---------- JSON log ----------
const LOG = path.join(HERE, "walkthrough.json");
const ARTICLES = ["configure-mcp", "connect-headless-client", "connect-claude"];
export function createLog(phase, meta) {
  const previous = existsSync(LOG) ? JSON.parse(readFileSync(LOG, "utf8")) : null;
  const log = previous ?? {
    kind: "independent-article-walkthrough",
    task: "DOC-032",
    group: "mcp",
    issue: 1194,
    independentReview: true,
    walkthroughReviewer: "DOC-032 independent walkthrough agent (mcp)",
    reviewerKind: "agent",
    method: "browser-walkthrough",
    appCommit: APP_COMMIT,
    browser:
      "Playwright 1.63.0 Chromium from node_modules, headless, 1440x1000; one isolated browser context per identity",
    mcpClient:
      "@modelcontextprotocol/client 2.1.0 from node_modules over Streamable HTTP. Modern Client: versionNegotiation { pin: '2026-07-28' }. Legacy Client: the SDK default ('legacy'), which negotiates 2025-11-25.",
    runs: {},
    steps: [],
    productBugs: [],
    guideFailures: [],
  };
  log.steps = log.steps.filter((s) => s.phase !== phase);
  log.runs[phase] = {
    ...meta,
    articleHashesAtStart: Object.fromEntries(ARTICLES.map((a) => [a, articleHash(a)])),
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  const save = () => {
    log.runs[phase].finishedAt = new Date().toISOString();
    writeFileSync(LOG, `${scrub(JSON.stringify(log, null, 2))}\n`);
  };
  async function step(sel, name, expected, fn) {
    const entry = {
      phase,
      article: sel.article,
      scenario: sel.scenario,
      role: sel.role,
      method: sel.method ?? "browser-walkthrough",
      lab: sel.lab,
      page: sel.page ?? null,
      step: name,
      expected,
      actual: null,
      result: "not-run",
      startedAt: new Date().toISOString(),
      at: null,
    };
    log.steps.push(entry);
    try {
      entry.actual = scrub(await fn(entry));
      entry.result = entry.result === "not-run" ? "pass" : entry.result;
    } catch (error) {
      entry.actual = scrub(
        `Check did not complete: ${String(error?.message ?? error)
          .split("\n")
          .slice(0, 8)
          .join(" ")}`,
      );
      entry.result = "fail";
    }
    entry.at = new Date().toISOString();
    console.log(
      `[${sel.role}] ${entry.result.toUpperCase()} ${sel.scenario}: ${name}${entry.result === "fail" ? ` -- ${entry.actual}` : ""}`,
    );
    save();
    return entry;
  }
  function finish() {
    log.runs[phase].articleHashesAtEnd = Object.fromEntries(
      ARTICLES.map((a) => [a, articleHash(a)]),
    );
    save();
    const mine = log.steps.filter((s) => s.phase === phase);
    console.log(
      `${phase} done: ${mine.length} steps, ${mine.filter((s) => s.result === "fail").length} failed, ${mine.filter((s) => s.result === "blocked").length} blocked`,
    );
  }
  return { log, save, step, finish };
}

// ---------- browser ----------
export async function browserSignIn(page, base, person) {
  await page.goto(`${base}/auth/login`);
  await page.getByLabel("Email").fill(person.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth/"), { timeout: 30000 });
}

async function mailpit(mail, p) {
  const r = await fetch(`${mail}${p}`);
  if (!r.ok) throw new Error(`Mailpit ${r.status} for ${p}`);
  return r.json();
}
export async function waitForMail(mail, address, subjectRe, since, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await mailpit(
      mail,
      `/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}&limit=40`,
    );
    const match = (found.messages ?? []).find(
      (m) =>
        new Date(m.Created).getTime() >= since - 1500 && (!subjectRe || subjectRe.test(m.Subject)),
    );
    if (match) {
      const message = await mailpit(mail, `/api/v1/message/${match.ID}`);
      return { subject: message.Subject, text: message.Text ?? "" };
    }
    await pause(800);
  }
  return null;
}
/** A fresh Portal sign-in link read from the lab's Mailpit (never logged). */
export async function magicLink(lab, email) {
  for (let attempt = 1; attempt <= 20; attempt++) {
    const since = Date.now();
    const r = await fetch(`${lab.base}/api/v1/auth/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: lab.base },
      body: JSON.stringify({ email, group: "business" }),
    });
    if (r.status === 429) {
      console.log("magic link 429; waiting 60 s");
      await pause(60000);
      continue;
    }
    if (r.status !== 202) throw new Error(`magic link request answered ${r.status}`);
    const mail = await waitForMail(lab.mail, email, /sign in/i, since);
    if (!mail) continue;
    const match = mail.text.match(/https?:\/\/[^\s<>"')\]]*magic-link\/verify[^\s<>"')\]]*/);
    if (!match) continue;
    const u = new URL(match[0].replace(/[.,]+$/, ""));
    const b = new URL(lab.base);
    u.protocol = b.protocol;
    u.host = b.host;
    return secret(u.toString());
  }
  throw new Error(`no magic link arrived for ${email}`);
}
/** A Business User sign-in with a fresh Portal link. */
export async function portalSignIn(page, lab, email) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    await page.goto(await magicLink(lab, email));
    await page.waitForLoadState("networkidle").catch(() => {});
    const me = await page.request.get(`${lab.base}/api/v1/me`);
    if (me.ok()) return true;
    await pause(3000);
  }
  throw new Error(`magic-link sign-in failed for ${email}`);
}

/** A JSON API call with the browser context's own session (state reads and fixtures only). */
export async function api(page, base, method, url, data) {
  const res = await page.request.fetch(`${base}${url}`, {
    method,
    data,
    headers: { origin: base, ...(data ? { "content-type": "application/json" } : {}) },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status(), body };
}

// ---------- MCP Clients ----------
/**
 * Connects an SDK Client over Streamable HTTP. mode "modern" pins protocol revision
 * 2026-07-28; mode "legacy" is the SDK default 2025 handshake. Returns the client, the
 * negotiated protocol revision and every Tool name.
 */
export async function connectClient(url, headers, { mode = "legacy", fetchImpl, options } = {}) {
  const client = new sdk.Client(
    { name: `DOC-032 mcp ${mode} Client`, version: "1" },
    {
      ...(mode === "modern" ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : {}),
      ...(options ?? {}),
    },
  );
  await client.connect(
    new sdk.StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers },
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    }),
  );
  const names = [];
  let cursor;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    names.push(...page.tools.map((t) => t.name));
    cursor = page.nextCursor;
  } while (cursor);
  const protocolVersion =
    client.protocolVersion ?? client.transport?.protocolVersion ?? client._protocolVersion;
  return { client, names: names.sort(), protocolVersion };
}
/** One raw JSON-RPC call over Streamable HTTP on the 2025-06-18 revision (no session). */
export async function rawCall(url, headers, method, params = {}, fetchImpl = fetch) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await res.text();
  const json = text.includes("data:")
    ? text
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5))
        .join("")
    : text;
  let body = null;
  try {
    body = JSON.parse(json);
  } catch {
    body = text.slice(0, 300);
  }
  return { status: res.status, body, wwwAuthenticate: res.headers.get("www-authenticate") };
}
/** A raw tools/list over every page; returns the status code and tool names. */
export async function rawToolsList(url, headers, fetchImpl = fetch) {
  const names = [];
  let cursor;
  let pages = 0;
  let first = null;
  do {
    const r = await rawCall(url, headers, "tools/list", cursor ? { cursor } : {}, fetchImpl);
    pages++;
    first ??= r;
    const list = r.body?.result?.tools;
    if (r.status !== 200 || !list) return { ...r, names: null };
    names.push(...list.map((t) => t.name));
    cursor = r.body?.result?.nextCursor;
  } while (cursor && pages < 20);
  return { ...first, names: names.sort(), pages };
}
export async function callTool(url, headers, name, args = {}, fetchImpl = fetch) {
  return rawCall(url, headers, "tools/call", { name, arguments: args }, fetchImpl);
}
export const toolText = (result) =>
  flat((result?.content ?? result?.result?.content ?? []).map((c) => c.text ?? "").join(" "));

// ---------- operator commands against an owned lab (never the shared work lab) ----------
export function labCompose(labName, args, extraFiles = []) {
  expectThat(labName !== "work" && labName !== "firstrun", "never the shared labs");
  const dir = path.join(ROOT, ".documentation-labs", labName);
  const files = [
    "--file",
    path.join(dir, "source/compose.yml"),
    "--file",
    path.join(dir, "overlay.json"),
    ...extraFiles.flatMap((f) => ["--file", path.isAbsolute(f) ? f : path.join(HERE, f)]),
  ];
  return execFileSync(
    "docker",
    [
      "--context",
      "default",
      "compose",
      "--project-name",
      labManifest(labName).project,
      "--env-file",
      path.join(dir, "source/.env"),
      ...files,
      ...args,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}
export function psql(project, sql) {
  return execFileSync(
    "docker",
    ["exec", `${project}-postgres-1`, "psql", "-U", "openlaw", "-d", "openlaw", "-tAc", sql],
    { encoding: "utf8" },
  ).trim();
}
export async function waitHealthy(base, timeout = 180000) {
  await until(
    async () => (await fetch(`${base}/api/v1/auth/setup`).catch(() => null))?.ok,
    `lab at ${base} did not answer`,
    timeout,
  );
}

/**
 * A loopback-only forward proxy for the LAN-address case. The browser asks it for
 * http://<LAN address>:<port>/...; it forwards to the owned lab on 127.0.0.1 and keeps
 * the Host header, so the lab sees the LAN origin. Nothing leaves this machine.
 */
export async function startLanProxy(target) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://placeholder");
    const upstream = http.request(
      {
        host: target.host,
        port: target.port,
        method: req.method,
        path: `${u.pathname}${u.search}`,
        headers: req.headers,
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", () => {
      res.writeHead(502).end();
    });
    req.pipe(upstream);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
