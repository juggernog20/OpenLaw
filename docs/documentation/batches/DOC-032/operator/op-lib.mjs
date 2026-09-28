// DOC-032 operator walkthrough helpers: the log, redaction, shell and Compose calls, Mailpit
// reads, a cookie API client for fixture setup and state reads, and browser sessions.
// Adapted from docs/documentation/batches/DOC-030/operator-2/op-lib.mjs.
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, "../../../../..");
const require = createRequire(path.join(root, "package.json"));
const { chromium } = require(
  path.join(root, "node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.js"),
);

export const HOME = process.env.HOME;
export const WORK = path.join(HOME, ".cache/openlaw-doc032-operator");
export const LOG = path.join(here, "walkthrough.json");
const STATE = path.join(WORK, "state.json");
const SECRETS = path.join(WORK, "secret-store.json");
// Round 2 candidate (the 4ca41822 run is kept in walkthrough-4ca41822.json).
export const COMMIT = "ad345da5842c22b7d1012bf9f5d7d12dfdb4e496";
export const BASELINE = "067c1646829df85e62b809ee9157921e867c84e7";
export const REPO = "https://github.com/juggernog20/OpenLaw.git";
export const REVIEWER = "DOC-032 independent walkthrough agent (operator)";
// A local-only address (the libvirt bridge, link down) that the host proxy binds, so the
// browser's address differs from 127.0.0.1 (health checks) and from the Compose gateway.
export const PROXY_IP = "192.168.122.1";
export const SUPPORT = {
  mailInst: { name: "openlaw-doc032-op-mail", ui: 24701 },
  mailUp: { name: "openlaw-doc032-op-mailup", ui: 24704 },
  ai: { name: "openlaw-doc032-op-ai" },
  idp: { name: "openlaw-doc032-op-idp" },
  occupier: { name: "openlaw-doc032-op-occupier", port: 24703 },
  proxy: { name: "openlaw-doc032-op-proxy", httpPort: 24702 },
};

export const PROJECTS = {
  inst: {
    project: "openlaw-doc032-opinst",
    port: 24710,
    proxyPort: 24711,
    host: "openlaw-doc032-opinst.test",
    subnets: ["10.245.70.0/24", "10.245.71.0/24"],
    mail: "mailInst",
  },
  up: {
    project: "openlaw-doc032-opup",
    port: 24720,
    proxyPort: 24721,
    host: "openlaw-doc032-opup.test",
    subnets: ["10.245.72.0/24", "10.245.73.0/24"],
    mail: "mailUp",
  },
  recover: {
    project: "openlaw-doc032-oprecover",
    port: 24730,
    subnets: ["10.245.74.0/24", "10.245.75.0/24"],
    mail: "mailUp",
  },
};
for (const [name, p] of Object.entries(PROJECTS)) {
  p.name = name;
  p.home = path.join(WORK, name);
  p.dir = path.join(p.home, "openlaw");
  p.direct = `http://127.0.0.1:${p.port}`;
  p.base = p.host ? `https://${p.host}:${p.proxyPort}` : p.direct;
}

// ---------------------------------------------------------------- private files

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
export function writePrivate(file, value) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}
mkdirSync(WORK, { recursive: true, mode: 0o700 });
export const state = readJson(STATE, {});
export const secrets = readJson(SECRETS, {});
export const saveState = () => writePrivate(STATE, state);
export const saveSecrets = () => writePrivate(SECRETS, secrets);

// ---------------------------------------------------------------- log

export const log = readJson(LOG, {
  batch: "DOC-032",
  group: "operator",
  reviewer: REVIEWER,
  reviewerKind: "agent",
  method: "container-operation",
  appCommit: COMMIT,
  startingBuild: BASELINE,
  script: "docs/documentation/batches/DOC-032/operator/walkthrough.mjs",
  helper: "docs/documentation/batches/DOC-032/operator/op-lib.mjs",
  projects: Object.values(PROJECTS).map((p) => p.project),
  supportContainers: Object.values(SUPPORT).map((s) => s.name),
  round: 2,
  previousRun:
    "docs/documentation/batches/DOC-032/operator/walkthrough-4ca41822.json (same scripts at COMMIT 4ca41822)",
  note: "Container-operation walkthrough by an agent acting as a fictional operator, not a human operator study. Every command ran against disposable Compose projects owned by this walkthrough (openlaw-doc032-op*), cloned from GitHub at the named revisions and built by the guides' own commands. Keys, passwords, setup tokens, API keys, cookies, mail bodies and links are not recorded; command output is reduced to exit codes and selected, redacted lines. The starting build's seed Administrator is shown as [seed Administrator].",
  articles: {},
  images: {},
  runs: [],
  steps: [],
  guideFailures: [],
  productBugs: [],
  observations: [],
});
for (const id of ["install", "upgrade"]) {
  const bytes = readFileSync(path.join(root, "docs/user-guides", `${id}.md`));
  log.articles[id] = { contentSha256: createHash("sha256").update(bytes).digest("hex") };
}

export function secretValues() {
  const values = [];
  const visit = (v) => {
    if (typeof v === "string" && v.length >= 8) values.push(v);
    else if (v && typeof v === "object") Object.values(v).forEach(visit);
  };
  visit(secrets);
  if (process.env.LAB_PASSWORD) values.push(process.env.LAB_PASSWORD);
  for (const p of Object.values(PROJECTS)) {
    const envFile = path.join(p.dir, ".env");
    if (!existsSync(envFile)) continue;
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const m = line.match(
        /^(AUTH_SECRET|OPENLAW_SECRET_KEY|OPENLAW_SECRET_KEY_PREVIOUS|SETUP_TOKEN|S3_SECRET_ACCESS_KEY|SMTP_URL|VAPID_PRIVATE_KEY)=(.+)$/,
      );
      if (m && m[2].length >= 8) values.push(m[2]);
    }
  }
  return values;
}
export function redact(text) {
  let out = String(text ?? "");
  for (const value of secretValues()) out = out.split(value).join("[redacted]");
  out = out.replace(/token=[A-Za-z0-9._%-]+/g, "token=[redacted]");
  out = out.replace(/smtps?:\/\/[^@\s"]+@/g, "smtp://[redacted]@");
  out = out.replace(/ol_[A-Za-z0-9_-]{16,}/g, "ol_[redacted]");
  // The starting build's seed names its bootstrap Administrator after a real person.
  out = out.replace(/blair@helix\.example\.?/gi, "[seed Administrator]");
  out = out.replace(/blair@helix\.?/gi, "[seed Administrator]");
  out = out.replace(/Blair Wentworth/g, "[seed Administrator]");
  return out;
}
export function saveLog() {
  log.updatedAt = new Date().toISOString();
  writeFileSync(LOG, `${redact(JSON.stringify(log, null, 2))}\n`);
}

let currentPhase = null;
export let failures = 0;
export function setPhase(phase) {
  currentPhase = phase;
}
/** One recorded step. meta: article, scenario, role, method, action, command, expected, critical. */
export async function step(meta, fn) {
  const entry = {
    phase: currentPhase,
    article: meta.article,
    scenario: meta.scenario,
    role: meta.role ?? "operator",
    method: meta.method ?? "container-operation",
    page: meta.page ?? null,
    action: meta.action,
    command: meta.command,
    expected: meta.expected,
    startedAt: new Date().toISOString(),
    at: null,
    actual: null,
    result: "not-run",
  };
  log.steps.push(entry);
  const t0 = Date.now();
  try {
    const actual = await fn();
    entry.actual = redact(typeof actual === "string" ? actual : JSON.stringify(actual));
    entry.result = "pass";
  } catch (error) {
    entry.actual = redact(error?.message ?? String(error)).slice(0, 3000);
    entry.result = "fail";
    failures += 1;
  }
  entry.elapsedMs = Date.now() - t0;
  entry.at = new Date().toISOString();
  saveLog();
  saveState();
  console.log(`[${entry.result}] ${meta.action}: ${String(entry.actual).slice(0, 700)}`);
  if (entry.result === "fail" && meta.critical)
    throw new Error(`critical step failed: ${meta.action}`);
  return entry;
}
export function check(condition, message) {
  if (!condition) throw new Error(message);
}

// ---------------------------------------------------------------- shell

const childEnv = Object.fromEntries(
  ["PATH", "HOME", "DOCKER_CONFIG", "XDG_RUNTIME_DIR", "LANG"].flatMap((k) =>
    process.env[k] === undefined ? [] : [[k, process.env[k]]],
  ),
);
export function sh(command, cwd, options = {}) {
  const t0 = Date.now();
  const result = spawnSync("bash", ["-c", command], {
    cwd,
    env: { ...childEnv, ...(options.env ?? {}) },
    encoding: "utf8",
    timeout: options.timeout ?? 900_000,
    maxBuffer: 256 * 1024 * 1024,
    input: options.input,
  });
  return {
    code: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ms: Date.now() - t0,
  };
}
export function must(command, cwd, options) {
  const r = sh(command, cwd, options);
  if (r.code !== 0)
    throw new Error(`exit ${r.code}: ${command}\n${r.stderr.slice(-1500)}${r.stdout.slice(-500)}`);
  return r;
}
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const lines = (text, pattern, max = 3) =>
  String(text)
    .split("\n")
    .filter((l) => pattern.test(l))
    .map((l) => l.trim().slice(0, 400))
    .slice(0, max);
export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

export function envSet(p, key, value) {
  const file = path.join(p.dir, ".env");
  const kept = readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => !l.startsWith(`${key}=`));
  while (kept.length && kept[kept.length - 1] === "") kept.pop();
  if (value !== null) kept.push(`${key}=${value}`);
  writeFileSync(file, `${kept.join("\n")}\n`, { mode: 0o600 });
}
export function envGet(p, key) {
  const line = readFileSync(path.join(p.dir, ".env"), "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1) : undefined;
}

export async function http(url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
    const text = await response.text();
    return { status: response.status, text, headers: response.headers };
  } catch (error) {
    return { status: 0, text: String(error?.cause?.code ?? error?.message ?? error) };
  }
}
export async function waitReady(p, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await http(`${p.direct}/readyz`);
    if (last.status === 200) return last;
    await sleep(2000);
  }
  throw new Error(
    `readyz did not answer 200 within ${timeoutMs} ms; last ${last?.status} ${last?.text?.slice(0, 200)}`,
  );
}
export function psAll(p) {
  const r = sh("docker compose ps --all --format json", p.dir);
  return r.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .map((row) => ({
      service: row.Service,
      id: row.ID,
      state: row.State,
      status: row.Status,
      health: row.Health,
      image: row.Image,
    }));
}
export function inspectImage(ref) {
  const r = sh(`docker image inspect --format '{{.Id}}' ${ref}`, root);
  return r.code === 0 ? r.stdout.trim() : null;
}
export function containerImage(p, service) {
  const id = sh(`docker compose ps -aq ${service}`, p.dir).stdout.trim().split("\n")[0];
  if (!id) return null;
  return sh(`docker inspect --format '{{.Image}}' ${id}`, p.dir).stdout.trim();
}
export function recordImages(label, p) {
  log.images[label] = {
    project: p.project,
    at: new Date().toISOString(),
    containers: Object.fromEntries(
      ["app", "worker", "doc-engine", "postgres"].map((s) => [s, containerImage(p, s)]),
    ),
  };
  saveLog();
  return log.images[label];
}
export function psql(p, sql, db = "openlaw") {
  return must(
    `docker compose exec -T postgres psql -U openlaw -d ${db} -At -F '|' -c ${JSON.stringify(sql)}`,
    p.dir,
  ).stdout.trim();
}
export function recreate(p, services = "app worker") {
  return must(`docker compose up -d --no-build --pull never --force-recreate ${services}`, p.dir, {
    timeout: 300_000,
  });
}
export function attach(p, container, alias) {
  const backend = `${p.project}_openlaw-backend`;
  if (sh(`docker inspect ${container}`, root).code !== 0) return false;
  const joined = sh(
    `docker inspect --format '{{json .NetworkSettings.Networks}}' ${container}`,
    root,
  ).stdout;
  if (!joined.includes(`"${backend}"`))
    must(`docker network connect --alias ${alias} ${backend} ${container}`, root);
  return true;
}
export function attachSupport(p) {
  attach(p, SUPPORT[p.mail].name, "doc032-mail");
  attach(p, SUPPORT.ai.name, "doc032-ai");
  attach(p, SUPPORT.idp.name, "doc032-idp");
}
/** The host-specific network override: explicit subnets, because Docker's default pools are exhausted. */
export function networkOverride(p) {
  return [
    "# DOC-032 walkthrough host override: explicit subnets (the host's default address pools are exhausted).",
    "networks:",
    "  openlaw-backend:",
    "    ipam:",
    "      config:",
    `        - subnet: ${p.subnets[0]}`,
    "  openlaw-doc-engine:",
    "    ipam:",
    "      config:",
    `        - subnet: ${p.subnets[1]}`,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------- mail

export const mailUi = (p) => `http://127.0.0.1:${SUPPORT[p.mail].ui}`;
export async function mailMessages(p) {
  const r = await http(`${mailUi(p)}/api/v1/messages?limit=500`);
  check(r.status === 200, `Mailpit answered ${r.status}`);
  return JSON.parse(r.text).messages ?? [];
}
export async function waitMail(p, predicate, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = (await mailMessages(p)).find(predicate);
    if (found) return found;
    await sleep(1500);
  }
  return null;
}
export async function mailText(p, id) {
  const r = await http(`${mailUi(p)}/api/v1/message/${id}`);
  return JSON.parse(r.text).Text ?? "";
}
export const toAddress = (message, address) =>
  (message.To ?? []).some((t) => t.Address?.toLowerCase() === address.toLowerCase());
export const since = (message, t) => Date.parse(message.Created) >= t - 2000;

// ---------------------------------------------------------------- API client (fixtures and state reads)

export class Api {
  constructor(base, origin = base) {
    this.base = base;
    this.origin = origin;
    this.jar = new Map();
  }
  headers(extra = {}) {
    const h = { accept: "application/json", origin: this.origin, ...extra };
    if (this.jar.size) h.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    return h;
  }
  keep(response) {
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(";", 1)[0];
      const i = pair.indexOf("=");
      if (i > 0) this.jar.set(pair.slice(0, i).trim(), pair.slice(i + 1));
    }
  }
  async raw(method, route, { json, form, headers = {} } = {}) {
    const response = await fetch(new URL(route, this.base), {
      method,
      headers: this.headers({
        ...(json !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      }),
      body: json !== undefined ? JSON.stringify(json) : form,
    });
    this.keep(response);
    const buffer = Buffer.from(await response.arrayBuffer());
    let body = null;
    try {
      body = JSON.parse(buffer.toString("utf8"));
    } catch {
      body = null;
    }
    return { status: response.status, body, buffer, headers: response.headers };
  }
  async call(method, route, options = {}) {
    const r = await this.raw(method, route, options);
    const accept = options.accept ?? [200, 201];
    if (!accept.includes(r.status))
      throw new Error(
        `${method} ${route} answered ${r.status}: ${r.buffer.toString("utf8").slice(0, 400)}`,
      );
    return r.body;
  }
  get = (route, o) => this.call("GET", route, o);
  post = (route, json, o) => this.call("POST", route, { json, ...o });
  patch = (route, json, o) => this.call("PATCH", route, { json, ...o });
  put = (route, json, o) => this.call("PUT", route, { json, ...o });
  async signIn(email, password) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const r = await this.raw("POST", "/api/auth/sign-in/email", { json: { email, password } });
      if (r.status === 200) return r.body;
      if (r.status !== 429)
        throw new Error(`sign-in answered ${r.status}: ${r.buffer.toString("utf8").slice(0, 200)}`);
      await sleep(12_000);
    }
    throw new Error("sign-in still rate limited after retries");
  }
  async sha(route) {
    const r = await this.raw("GET", route);
    if (r.status !== 200) return { status: r.status, sha256: null };
    return { status: 200, sha256: sha256(r.buffer), bytes: r.buffer.length };
  }
}

export function pdf(textLines) {
  const escape = (line) => line.replace(/[\\()]/g, (c) => `\\${c}`);
  const content = [
    "BT",
    "/F1 12 Tf",
    "72 720 Td",
    "14 TL",
    ...textLines.map((l) => `(${escape(l)}) Tj T*`),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

export async function waitText(send, documentId, versionId, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const r = await send("GET", `/api/v1/documents/${documentId}/versions/${versionId}/text`);
    last = r.body?.text?.state ?? `http ${r.status}`;
    if (last === "ready") return { state: last, text: r.body?.text?.text ?? "" };
    if (["failed", "unsupported"].includes(last)) return { state: last, text: "" };
    await sleep(2000);
  }
  return { state: last, text: "" };
}

// ---------------------------------------------------------------- browser

let browser;
export async function openBrowser() {
  const rules = Object.values(PROJECTS)
    .filter((p) => p.host)
    .map((p) => `MAP ${p.host} ${PROXY_IP}`)
    .join(", ");
  browser ??= await chromium.launch({
    headless: true,
    args: [`--host-resolver-rules=${rules}`],
  });
  return browser;
}
export async function closeBrowser() {
  if (browser) await browser.close();
  browser = null;
}
export async function newSession(base) {
  const b = await openBrowser();
  const context = await b.newContext({
    ignoreHTTPSErrors: true,
    baseURL: base,
    viewport: { width: 1360, height: 900 },
  });
  const page = await context.newPage();
  const s = { context, page, base };
  // Requests run inside the page (same origin, the browser's cookies and host mapping).
  s.request = async (method, route, json) => {
    if (!page.url().startsWith(base)) await page.goto(base, { waitUntil: "domcontentloaded" });
    let r;
    for (let attempt = 0; ; attempt += 1) {
      try {
        r = await inPage(method, route, json);
        break;
      } catch (error) {
        if (attempt >= 3) throw error;
        await page.waitForLoadState("networkidle").catch(() => {});
        await sleep(1000);
      }
    }
    const buffer = Buffer.from(r.b64, "base64");
    let parsed = null;
    try {
      parsed = JSON.parse(buffer.toString("utf8"));
    } catch {
      parsed = null;
    }
    return { status: r.status, body: parsed, buffer };
  };
  const inPage = (method, route, json) =>
    page.evaluate(
      async ({ method, route, json }) => {
        const res = await fetch(route, {
          method,
          credentials: "same-origin",
          headers: json ? { "content-type": "application/json" } : {},
          body: json ? JSON.stringify(json) : undefined,
        });
        const bytes = new Uint8Array(await res.arrayBuffer());
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000)
          bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return { status: res.status, b64: btoa(bin) };
      },
      { method, route, json },
    );
  return s;
}
/** Password sign-in through the app's own sign-in page, retried past the production rate limit. */
export async function browserSignIn(base, email, password) {
  const s = await newSession(base);
  const { page } = s;
  const notes = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    // Docker network changes on the host can abort a navigation with ERR_NETWORK_CHANGED.
    for (let n = 0; ; n += 1) {
      try {
        await page.goto(`${base}/auth/login`, { waitUntil: "domcontentloaded" });
        break;
      } catch (error) {
        if (n >= 4 || !/ERR_NETWORK_CHANGED|ERR_CONNECTION/.test(error.message)) throw error;
        notes.push(`navigation retried: ${error.message.split("\n")[0].slice(0, 80)}`);
        await sleep(3000);
      }
    }
    await page.getByLabel("Email").first().waitFor({ timeout: 30_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    const withPassword = page.getByRole("button", { name: "Sign in with a password" });
    if (await withPassword.isVisible().catch(() => false)) await withPassword.click();
    await page.getByLabel("Email").first().fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const left = await page
      .waitForURL((u) => !u.pathname.startsWith("/auth/login"), { timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    if (left) break;
    notes.push(
      `attempt ${attempt + 1}: ${(await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 160)}`,
    );
    await sleep(15_000);
  }
  await page.waitForLoadState("networkidle").catch(() => {});
  const me = await s.request("GET", "/api/v1/me");
  const body = me.status === 200 ? me.body : null;
  s.role = body?.user?.role ?? null;
  s.userId = body?.user?.id ?? null;
  s.notes = notes;
  s.landed = new URL(page.url()).pathname;
  return s;
}
export async function bodyText(page) {
  return (
    await page
      .locator("body")
      .innerText()
      .catch(() => "")
  ).replace(/\s+/g, " ");
}
