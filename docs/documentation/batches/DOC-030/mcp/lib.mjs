// Shared helpers for the DOC-030 mcp independent walkthrough.
// API calls are used only for fixture setup, state reads and the OAuth protocol
// steps a Client performs. Every guide step runs in the browser as the named role.
// The seed demo password comes only from LAB_PASSWORD. API keys, Client secrets,
// sign-in links, cookies and raw mail are never written to a file.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../../../../..");
export const REL = "docs/documentation/batches/DOC-030/mcp";
export const PASSWORD = process.env.LAB_PASSWORD;
if (!PASSWORD) throw new Error("Set LAB_PASSWORD to the seed demo password in VALIDATION.md.");
export const PW_PATH = path.join(
  ROOT,
  "node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs",
);
const SDK = path.join(
  ROOT,
  "node_modules/.pnpm/@modelcontextprotocol+client@2.0.0/node_modules/@modelcontextprotocol/client",
);
export const sdk = await import(path.join(SDK, "dist/index.mjs"));
export const sdkStdio = await import(path.join(SDK, "dist/stdio.mjs"));
export const undici = await import(
  path.join(ROOT, "node_modules/.pnpm/undici@7.29.1/node_modules/undici/index.js")
);

export const LABS = {
  work2: {
    name: "work2",
    base: "http://127.0.0.1:43300",
    mail: "http://127.0.0.1:48425",
    project: "openlaw-docs-80ceef9e-work2",
  },
  mcplan: {
    name: "mcplan",
    base: "http://127.0.0.1:43320",
    mail: "http://127.0.0.1:48445",
    project: "openlaw-docs-80ceef9e-mcplan",
  },
};
export const PEOPLE = {
  administrator: { email: "daniel.okafor@helix.example", name: "Daniel Okafor" },
  legal_team_member: { email: "nadia.haddad@helix.example", name: "Nadia Haddad" },
  business_user: { email: "jonas.weber@helix.example", name: "Jonas Weber" },
};
export const CLAUDE_HOME = path.join(process.env.HOME, ".cache/openlaw-doc030/mcp-claude-home");

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

// ---------- JSON log ----------
const LOG = path.join(HERE, "walkthrough.json");
export function createLog(phase, meta) {
  const previous = existsSync(LOG) ? JSON.parse(readFileSync(LOG, "utf8")) : null;
  const log = previous ?? {
    kind: "independent-article-walkthrough",
    task: "DOC-030",
    group: "mcp",
    issue: 1157,
    independentReview: true,
    walkthroughReviewer: "DOC-030 independent walkthrough agent (mcp)",
    reviewerKind: "agent",
    method: "browser-walkthrough",
    appCommit: "067c1646829df85e62b809ee9157921e867c84e7",
    browser:
      "Playwright 1.63.0 Chromium from node_modules, headless, 1440x1000; one isolated browser context per identity",
    runs: {},
    steps: [],
    productBugs: [],
    guideFailures: [],
  };
  log.steps = log.steps.filter((s) => s.phase !== phase);
  log.runs[phase] = {
    ...meta,
    articleHashesAtStart: {
      "configure-mcp": articleHash("configure-mcp"),
      "connect-headless-client": articleHash("connect-headless-client"),
    },
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  const save = () => {
    log.runs[phase].finishedAt = new Date().toISOString();
    writeFileSync(LOG, `${JSON.stringify(log, null, 2)}\n`);
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
      entry.actual = await fn(entry);
      entry.result = "pass";
    } catch (error) {
      entry.actual = `Check did not complete: ${String(error?.message ?? error)
        .split("\n")
        .slice(0, 8)
        .join(" ")}`;
      entry.result = "fail";
    }
    entry.at = new Date().toISOString();
    console.log(
      `[${sel.role}] ${entry.result.toUpperCase()} ${sel.scenario}: ${name}${entry.result === "fail" ? ` -- ${entry.actual}` : ""}`,
    );
    save();
    return entry;
  }
  return { log, save, step };
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
/** A Business User sign-in with a fresh Portal link. 429 answers are waited out. */
export async function portalSignIn(page, lab, email) {
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
    await page.goto(u.toString());
    await page.waitForLoadState("networkidle").catch(() => {});
    const me = await page.request.get(`${lab.base}/api/v1/me`);
    if (me.ok()) return true;
    await pause(3000);
  }
  throw new Error(`magic-link sign-in failed for ${email}`);
}

/** A JSON API call with the browser context's own session (state reads only). */
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
/** Connects an SDK Client; returns { client, names } or throws with the HTTP status. */
export async function connectClient(url, headers, fetchImpl) {
  const client = new sdk.Client({ name: "DOC-030 mcp walkthrough", version: "1" });
  await client.connect(
    new sdk.StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers },
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    }),
  );
  // tools/list is paged by a byte budget; follow nextCursor like a Client does.
  const names = [];
  let cursor;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    names.push(...page.tools.map((t) => t.name));
    cursor = page.nextCursor;
  } while (cursor);
  return { client, names: names.sort(), pages: undefined };
}
/** A raw tools/list over every page; returns the status code and tool names. */
export async function rawToolsList(url, headers, fetchImpl = fetch) {
  let first = null;
  const names = [];
  let cursor;
  let pages = 0;
  do {
    const r = await rawToolsPage(url, headers, fetchImpl, cursor);
    pages++;
    first ??= r;
    if (r.status !== 200 || !r.names) return r;
    names.push(...r.names);
    cursor = r.body?.result?.nextCursor;
  } while (cursor && pages < 20);
  return { ...first, names: names.sort(), pages };
}
async function rawToolsPage(url, headers, fetchImpl, cursor) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: cursor ? { cursor } : {} }),
  });
  const text = await res.text();
  let names = null;
  let body = text;
  const json = text.includes("data:")
    ? text
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5))
        .join("")
    : text;
  try {
    body = JSON.parse(json);
    names = body?.result?.tools?.map((t) => t.name).sort() ?? null;
  } catch {}
  return {
    status: res.status,
    names,
    body: typeof body === "string" ? body.slice(0, 300) : body,
    wwwAuthenticate: res.headers.get("www-authenticate"),
  };
}
export async function callTool(url, headers, name, args = {}, fetchImpl = fetch) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name, arguments: args },
    }),
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
  return { status: res.status, body };
}
export const toolText = (result) =>
  flat((result?.content ?? result?.result?.content ?? []).map((c) => c.text ?? "").join(" "));

// ---------- the owned mcplan lab (never work2) ----------
const MCPLAN_DIR = path.join(ROOT, ".documentation-labs/mcplan");
export function mcplanCompose(args, extraFiles = []) {
  const files = [
    "--file",
    path.join(MCPLAN_DIR, "source/compose.yml"),
    "--file",
    path.join(MCPLAN_DIR, "overlay.json"),
    ...extraFiles.flatMap((f) => ["--file", path.join(HERE, f)]),
  ];
  return execFileSync(
    "docker",
    [
      "--context",
      "default",
      "compose",
      "--project-name",
      LABS.mcplan.project,
      "--env-file",
      path.join(MCPLAN_DIR, "source/.env"),
      ...files,
      ...args,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}
export async function waitHealthy(base, timeout = 120000) {
  await until(
    async () => (await fetch(`${base}/api/v1/auth/setup`).catch(() => null))?.ok,
    `lab at ${base} did not answer`,
    timeout,
  );
}

/**
 * A loopback-only forward proxy for the LAN-address case. The browser asks it for
 * http://<LAN address>:43320/...; it forwards to the owned lab on 127.0.0.1:43320
 * and keeps the Host header, so the lab sees the LAN origin. Nothing leaves this machine.
 */
export async function startLanProxy(target = { host: "127.0.0.1", port: 43320 }) {
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
