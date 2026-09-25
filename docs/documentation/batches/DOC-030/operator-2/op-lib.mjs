// DOC-030 operator-2 walkthrough helpers: the log, redaction, shell and Compose calls,
// Mailpit reads, a cookie API client for fixture setup and state reads, and browser sessions.
// Adapted from DOC-029 operator-lifecycle/walkthrough-r2-1.mjs and operator-install/walkthrough-r2-2.mjs.
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
// Round 2 re-walks the corrected guides on fresh projects with their own private state.
export const ROUND = process.env.OP2_ROUND === "2" ? 2 : 1;
export const WORK = path.join(HOME, ROUND === 2 ? ".cache/openlaw-doc030/operator/op2r2" : ".cache/openlaw-doc030/operator/op2");
export const LOG = path.join(here, "walkthrough.json");
const STATE = path.join(WORK, "state.json");
const SECRETS = path.join(WORK, "secret-store.json");
export const COMMIT = "067c1646829df85e62b809ee9157921e867c84e7";
export const BASELINE = "d1d098ba9f4ba6557a542857d530446b76b1847c";
export const REPO = "https://github.com/juggernog20/OpenLaw.git";
export const REVIEWER = "DOC-030 independent walkthrough agent (operator-2)";
export const MAIL_NAME = "openlaw-doc030-op2-mail";
export const MAIL_UI = "http://127.0.0.1:24601";
export const AI_NAME = "openlaw-doc030-op2-ai";
export const OCCUPIER_NAME = "openlaw-doc030-op2-occupier";
export const PROXY_NAME = "openlaw-doc030-op2-proxy";
export const CPROXY_NAME = "openlaw-doc030-op2-cproxy";

export const PROJECTS = {
  inst: { project: "openlaw-doc030-opinst", port: 24610 },
  up: { project: "openlaw-doc030-opup", port: 24620 },
  recover: { project: "openlaw-doc030-oprecover", port: 24621 },
  restore: { project: "openlaw-doc030-oprestore", port: 24622 },
  migfix: { project: "openlaw-doc030-opmigfix", port: 24623 },
};
if (ROUND === 2) {
  PROJECTS.inst = { project: "openlaw-doc030-opinst2", port: 24640 };
  PROJECTS.up = { project: "openlaw-doc030-opup2", port: 24650 };
  PROJECTS.restore = { project: "openlaw-doc030-oprestore2", port: 24652 };
  delete PROJECTS.recover;
  delete PROJECTS.migfix;
}
for (const [name, p] of Object.entries(PROJECTS)) {
  p.name = name;
  p.home = path.join(WORK, name);
  p.dir = path.join(p.home, "openlaw");
  p.base = `http://127.0.0.1:${p.port}`;
}
// Round 2: the upgraded instance sits behind a same-host Caddy proxy, and its origin is the proxy's.
if (ROUND === 2) {
  PROJECTS.up.proxyPort = 24651;
  PROJECTS.up.base = "http://127.0.0.1:24651";
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
  batch: "DOC-030",
  group: "operator-2",
  reviewer: REVIEWER,
  reviewerKind: "agent",
  method: "container-operation",
  appCommit: COMMIT,
  baseline: BASELINE,
  script: "docs/documentation/batches/DOC-030/operator-2/walkthrough.mjs",
  helper: "docs/documentation/batches/DOC-030/operator-2/op-lib.mjs",
  projects: Object.values(PROJECTS).map((p) => p.project),
  supportContainers: [MAIL_NAME, AI_NAME, OCCUPIER_NAME, PROXY_NAME, CPROXY_NAME],
  note: "Container-operation walkthrough by an agent, not a human operator study. Every command ran against disposable Compose projects owned by this walkthrough, cloned from GitHub at the named revisions and built by the guides' own commands. Keys, passwords, setup tokens, cookies, mail bodies and links are not recorded; command output is reduced to exit codes and selected, redacted lines.",
  articles: {},
  images: {},
  runs: [],
  steps: [],
  guideFailures: [],
  productBugs: [],
});
for (const id of ["install", "upgrade", "backup-and-restore", "operator-troubleshooting"]) {
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
/**
 * One recorded step. meta: article, scenario, role, method, action, command, expected,
 * critical, guideFailure (a string naming the guide claim when a failure is the guide's).
 */
export async function step(meta, fn) {
  const entry = {
    round: ROUND,
    phase: currentPhase,
    article: meta.article,
    scenario: meta.scenario,
    role: meta.role ?? "operator",
    method: meta.method ?? "container-operation",
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
  console.log(`[${entry.result}] ${meta.action}: ${String(entry.actual).slice(0, 600)}`);
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
    last = await http(`${p.base}/readyz`);
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
export function imageIds(p) {
  const r = sh("docker compose images --format json", p.dir);
  if (r.code !== 0) return null;
  return JSON.parse(r.stdout || "[]").map((row) => ({
    container: row.ContainerName,
    repository: row.Repository,
    tag: row.Tag,
    id: row.ID,
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
    services: imageIds(p),
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
export function upCommand(p, command = "docker compose up -d --no-build --pull never", opts = {}) {
  const r = sh(command, p.dir, { timeout: 600_000, ...opts });
  if (r.code !== 0 && /address pools have been fully subnetted/.test(r.stderr)) {
    const made = [];
    const base = 60 + Object.keys(PROJECTS).indexOf(p.name) * 2;
    for (const [i, network] of ["openlaw-backend", "openlaw-doc-engine"].entries()) {
      const name = `${p.project}_${network}`;
      if (sh(`docker network inspect ${name}`, root).code === 0) continue;
      must(
        [
          "docker network create",
          network === "openlaw-doc-engine" ? "--internal" : "",
          `--subnet 10.241.${base + i}.0/24`,
          `--label com.docker.compose.project=${p.project}`,
          `--label com.docker.compose.network=${network}`,
          name,
        ].join(" "),
        root,
      );
      made.push(name);
    }
    log.networkFallback = [
      ...(log.networkFallback ?? []),
      { project: p.project, at: new Date().toISOString(), created: made },
    ];
    return sh(command, p.dir, { timeout: 600_000, ...opts });
  }
  return r;
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
  if (!joined.includes(backend))
    must(`docker network connect --alias ${alias} ${backend} ${container}`, root);
  return true;
}
export function attachSupport(p) {
  attach(p, MAIL_NAME, "op2-mail");
  attach(p, AI_NAME, "op2-ai");
  attach(p, "openlaw-doc030-op2-minio", "op2-minio");
}

// ---------------------------------------------------------------- mail

export async function mailMessages() {
  const r = await http(`${MAIL_UI}/api/v1/messages?limit=500`);
  check(r.status === 200, `Mailpit answered ${r.status}`);
  return JSON.parse(r.text).messages ?? [];
}
export async function waitMail(predicate, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = (await mailMessages()).find(predicate);
    if (found) return found;
    await sleep(1500);
  }
  return null;
}
export async function mailText(id) {
  const r = await http(`${MAIL_UI}/api/v1/message/${id}`);
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
    const h = { origin: this.origin, accept: "application/json", ...extra };
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
  async raw(method, route, { json, form, dispatcher } = {}) {
    const headers = this.headers(json !== undefined ? { "content-type": "application/json" } : {});
    const response = await fetch(new URL(route, this.base), {
      method,
      headers,
      body: json !== undefined ? JSON.stringify(json) : form,
      dispatcher,
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
  async upload(route, filename, bytes, type, fields = {}) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append("file", new File([bytes], filename, { type }));
    return this.call("POST", route, { form, accept: [201] });
  }
}

export function pdf(lines) {
  const escape = (line) => line.replace(/[\\()]/g, (c) => `\\${c}`);
  const content = [
    "BT",
    "/F1 12 Tf",
    "72 720 Td",
    "14 TL",
    ...lines.map((l) => `(${escape(l)}) Tj T*`),
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

export async function textState(api, documentId, versionId) {
  const r = await api.raw("GET", `/api/v1/documents/${documentId}/versions/${versionId}/text`);
  return r.body?.text?.state ?? `http ${r.status}`;
}
export async function waitText(api, documentId, versionId, timeoutMs = 240_000, accept = ["ready"]) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const r = await api.raw("GET", `/api/v1/documents/${documentId}/versions/${versionId}/text`);
    last = r.body?.text?.state ?? `http ${r.status}`;
    if (accept.includes(last)) return { state: last, text: r.body?.text?.text ?? "" };
    if (["failed", "unsupported"].includes(last)) return { state: last, text: "" };
    await sleep(2000);
  }
  return { state: last, text: "" };
}

// ---------------------------------------------------------------- browser

let browser;
export async function openBrowser() {
  browser ??= await chromium.launch({ headless: true });
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
  return { context, page, base };
}
/** Password sign-in through the app's own sign-in page, retried past the production rate limit. */
export async function browserSignIn(base, email, password) {
  const s = await newSession(base);
  const { page } = s;
  const notes = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.goto(`${base}/auth/login`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Email").first().waitFor({ timeout: 30_000 });
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
  const me = await page.request.get(`${base}/api/v1/me`);
  const body = me.ok() ? await me.json() : null;
  s.role = body?.user?.role ?? null;
  s.notes = notes;
  s.landed = new URL(page.url()).pathname;
  s.request = async (method, route, json) => {
    const r = await page.request.fetch(`${base}${route}`, {
      method,
      headers: { origin: base, ...(json ? { "content-type": "application/json" } : {}) },
      data: json ? JSON.stringify(json) : undefined,
    });
    const buffer = await r.body();
    let parsed = null;
    try {
      parsed = JSON.parse(buffer.toString("utf8"));
    } catch {
      parsed = null;
    }
    return { status: r.status(), body: parsed, buffer };
  };
  return s;
}
export async function bodyText(page) {
  return (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
}
