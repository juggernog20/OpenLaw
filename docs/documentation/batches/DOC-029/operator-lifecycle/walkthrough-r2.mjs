// DOC-029 operator-lifecycle, round 2: independent container-operation walkthrough
// for operator-troubleshooting (V-C48) on candidate 3fa407e3.
//
// Written by the DOC-029 independent walkthrough agent (operator-lifecycle, round 2).
// Helpers are reused from walkthrough-r1.mjs. The fault-injection installation is a
// populated starting build (d1d098ba, the baseline in evidence/upgrade.json) upgraded
// to the candidate, so the automatic journal repair is observed on a real database.
//
// Run one phase at a time from the repository root:
//   mise exec -- node docs/documentation/batches/DOC-029/operator-lifecycle/walkthrough-r2.mjs <phase>
//
// Keys, fixture passwords and mail tokens stay in ~/.cache/openlaw-docs-lc2
// (mode 600) or in memory. The log receives only redacted, selected output.
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../..");
const require = createRequire(path.join(root, "e2e/package.json"));

const HOME = process.env.HOME;
const LC = path.join(HOME, ".cache/openlaw-docs-lc2");
const LOG = path.join(here, "walkthrough-r2.json");
const STATE = path.join(LC, "state.json");
const SECRETS = path.join(LC, "secret-store.json");
const PREFIX = "openlaw-docs-d029r2-lc";
const BASELINE = "d1d098ba9f4ba6557a542857d530446b76b1847c";
const CANDIDATE = "3fa407e3a846559914aa1a63249741f30cfb4f69";
const MAIL_NAME = `${PREFIX}-mail`;
const MAIL_UI = "http://127.0.0.1:23335";
const MINIO_NAME = `${PREFIX}-minio`;
const MINIO_PORT = 23336;
const OCCUPIER_NAME = `${PREFIX}-occupier`;
const OCCUPIED_PORT = 23331;
const ALT_PORT = 23332;
const PROXY_NAME = `${PREFIX}-proxy`;
const PROXY_PORT = 23337;

const PROJECTS = {
  diag: { project: `${PREFIX}-diag`, port: 23330, subnets: ["10.239.40.0/24", "10.239.41.0/24"] },
};
for (const [name, p] of Object.entries(PROJECTS)) {
  p.name = name;
  p.dir = path.join(LC, name);
  p.base = `http://127.0.0.1:${p.port}`;
}

// ---------------------------------------------------------------- files

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function writePrivate(file, value) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}
const state = readJson(STATE, {});
const secrets = readJson(SECRETS, {});
const saveState = () => writePrivate(STATE, state);
const saveSecrets = () => writePrivate(SECRETS, secrets);

const log = readJson(LOG, {
  labProjectNote:
    "Own disposable Compose project and support containers on ports 23330-23337; destroyed at the end.",
  batch: "DOC-029",
  group: "operator-lifecycle",
  round: 2,
  reviewer: "DOC-029 independent walkthrough agent (operator-lifecycle, round 2)",
  reviewerKind: "agent",
  method: "container-operation",
  candidate: CANDIDATE,
  baseline: BASELINE,
  script: "docs/documentation/batches/DOC-029/operator-lifecycle/walkthrough-r2.mjs",
  labProjects: Object.values(PROJECTS).map((p) => p.project),
  supportContainers: [MAIL_NAME, MINIO_NAME, OCCUPIER_NAME, PROXY_NAME],
  articles: {},
  images: {},
  phases: [],
  steps: [],
});
for (const id of ["operator-troubleshooting"]) {
  const bytes = readFileSync(path.join(root, "docs/user-guides", `${id}.md`));
  log.articles[id] = { contentSha256: createHash("sha256").update(bytes).digest("hex") };
}

// Every secret value known to this run. Output is checked against them before it is logged.
function secretValues() {
  const values = [];
  for (const entry of Object.values(secrets)) {
    for (const value of Object.values(entry ?? {}))
      if (typeof value === "string" && value.length >= 8) values.push(value);
  }
  for (const p of Object.values(PROJECTS)) {
    const envFile = path.join(p.dir, ".env");
    if (!existsSync(envFile)) continue;
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const match = line.match(
        /^(AUTH_SECRET|OPENLAW_SECRET_KEY|OPENLAW_SECRET_KEY_PREVIOUS|S3_SECRET_ACCESS_KEY|SMTP_URL)=(.+)$/,
      );
      if (match && match[2].length >= 8) values.push(match[2]);
    }
  }
  return values;
}
function redact(text) {
  let out = String(text ?? "");
  for (const value of secretValues()) out = out.split(value).join("[redacted]");
  out = out.replace(/token=[A-Za-z0-9._-]+/g, "token=[redacted]");
  out = out.replace(/smtps?:\/\/[^@\s"]+@/g, "smtp://[redacted]@");
  return out;
}
function saveLog() {
  log.updatedAt = new Date().toISOString();
  const text = redact(JSON.stringify(log, null, 2));
  writeFileSync(LOG, `${text}\n`);
}

let currentPhase = null;
let failures = 0;
async function step(meta, fn) {
  const entry = {
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
  try {
    const actual = await fn();
    entry.actual = redact(typeof actual === "string" ? actual : JSON.stringify(actual));
    entry.result = "pass";
  } catch (error) {
    entry.actual = redact(error?.message ?? String(error)).slice(0, 2000);
    entry.result = "fail";
    failures += 1;
  }
  entry.at = new Date().toISOString();
  saveLog();
  saveState();
  console.log(`[${entry.result}] ${meta.action}: ${String(entry.actual).slice(0, 400)}`);
  if (entry.result === "fail" && meta.critical)
    throw new Error(`critical step failed: ${meta.action}`);
  return entry;
}
function check(condition, message) {
  if (!condition) throw new Error(message);
}

// ---------------------------------------------------------------- shell

const childEnv = Object.fromEntries(
  ["PATH", "HOME", "DOCKER_CONFIG", "XDG_RUNTIME_DIR", "LANG"].flatMap((k) =>
    process.env[k] === undefined ? [] : [[k, process.env[k]]],
  ),
);
function sh(command, cwd, options = {}) {
  const result = spawnSync("bash", ["-c", command], {
    cwd,
    env: { ...childEnv, ...(options.env ?? {}) },
    encoding: "utf8",
    timeout: options.timeout ?? 900_000,
    maxBuffer: 256 * 1024 * 1024,
    input: options.input,
  });
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}
function must(command, cwd, options) {
  const r = sh(command, cwd, options);
  if (r.code !== 0)
    throw new Error(`exit ${r.code}: ${command}\n${r.stderr.slice(-1500)}${r.stdout.slice(-500)}`);
  return r;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function envSet(p, key, value) {
  const file = path.join(p.dir, ".env");
  const lines = readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => !l.startsWith(`${key}=`));
  if (value !== null) lines.push(`${key}=${value}`);
  writeFileSync(
    file,
    `${lines
      .filter((l, i) => l !== "" || i < lines.length - 1)
      .join("\n")
      .replace(/\n*$/, "\n")}`,
    { mode: 0o600 },
  );
}
function envGet(p, key) {
  const line = readFileSync(path.join(p.dir, ".env"), "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1) : undefined;
}

async function http(url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
    const text = await response.text();
    return { status: response.status, text };
  } catch (error) {
    return { status: 0, text: String(error?.cause?.code ?? error?.message ?? error) };
  }
}
async function waitReady(p, timeoutMs = 300_000) {
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

function imageIds(p) {
  const r = sh("docker compose images --format json", p.dir);
  if (r.code !== 0) return null;
  const rows = JSON.parse(r.stdout || "[]");
  return rows.map((row) => ({
    container: row.ContainerName,
    repository: row.Repository,
    tag: row.Tag,
    id: row.ID,
  }));
}
function inspectImage(ref) {
  const r = sh(`docker image inspect --format '{{.Id}}' ${ref}`, root);
  return r.code === 0 ? r.stdout.trim() : null;
}
function containerIds(p) {
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
      image: row.Image,
    }));
}

function ensureNetworks(p) {
  const created = [];
  for (const [index, network] of ["openlaw-backend", "openlaw-doc-engine"].entries()) {
    const name = `${p.project}_${network}`;
    if (sh(`docker network inspect ${name}`, root).code === 0) continue;
    must(
      [
        "docker network create",
        network === "openlaw-doc-engine" ? "--internal" : "",
        `--subnet ${p.subnets[index]}`,
        `--label com.docker.compose.project=${p.project}`,
        `--label com.docker.compose.network=${network}`,
        "--label com.docker.compose.version=5.5.1",
        name,
      ].join(" "),
      root,
    );
    created.push(name);
  }
  return created;
}
function attachSupport(p) {
  const backend = `${p.project}_openlaw-backend`;
  for (const [container, alias] of [
    [MAIL_NAME, "lc-mail"],
    [MINIO_NAME, "lc-minio"],
  ]) {
    if (sh(`docker inspect ${container}`, root).code !== 0) continue;
    const joined = sh(
      `docker inspect --format '{{json .NetworkSettings.Networks}}' ${container}`,
      root,
    ).stdout;
    if (!joined.includes(backend))
      must(`docker network connect --alias ${alias} ${backend} ${container}`, root);
  }
}

// ---------------------------------------------------------------- mail

async function mailMessages() {
  const r = await http(`${MAIL_UI}/api/v1/messages?limit=200`);
  check(r.status === 200, `Mailpit answered ${r.status}`);
  return JSON.parse(r.text).messages ?? [];
}
async function waitMail(predicate, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = (await mailMessages()).find(predicate);
    if (found) return found;
    await sleep(1500);
  }
  return null;
}
async function mailText(id) {
  const r = await http(`${MAIL_UI}/api/v1/message/${id}`);
  return JSON.parse(r.text).Text ?? "";
}
const toAddress = (message, address) =>
  (message.To ?? []).some((t) => t.Address?.toLowerCase() === address.toLowerCase());

// ---------------------------------------------------------------- API client (fixture preparation)

class Api {
  constructor(base) {
    this.base = base;
    this.jar = new Map();
  }
  headers(extra = {}) {
    const h = { origin: this.base, accept: "application/json", ...extra };
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
  async raw(method, route, { json, form } = {}) {
    const headers = this.headers(json !== undefined ? { "content-type": "application/json" } : {});
    const response = await fetch(new URL(route, this.base), {
      method,
      headers,
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
    return { status: response.status, body, buffer };
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
    // Production authentication rate limits stay on; wait out a 429 instead of failing.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const r = await this.raw("POST", "/api/auth/sign-in/email", { json: { email, password } });
      if (r.status === 200) return r.body;
      if (r.status !== 429)
        throw new Error(`sign-in answered ${r.status}: ${r.buffer.toString("utf8").slice(0, 200)}`);
      await sleep(15_000);
    }
    throw new Error("sign-in still rate limited after retries");
  }
  async sha(route) {
    const r = await this.raw("GET", route);
    if (r.status !== 200) return { status: r.status, sha256: null };
    return {
      status: 200,
      sha256: createHash("sha256").update(r.buffer).digest("hex"),
      bytes: r.buffer.length,
    };
  }
  async upload(route, filename, bytes, type, fields = {}) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append("file", new File([bytes], filename, { type }));
    return this.call("POST", route, { form, accept: [201] });
  }
}

function pdf(lines) {
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

async function waitText(api, documentId, versionId, timeoutMs = 240_000, accept = ["ready"]) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const r = await api.raw("GET", `/api/v1/documents/${documentId}/versions/${versionId}/text`);
    last = r.body?.text?.state ?? `http ${r.status}`;
    if (accept.includes(last)) return { state: last, text: r.body?.text?.text ?? "" };
    if (["failed", "unsupported"].includes(last) && !accept.includes(last))
      return { state: last, text: "" };
    await sleep(2000);
  }
  return { state: last, text: "" };
}
async function textState(api, documentId, versionId) {
  const r = await api.raw("GET", `/api/v1/documents/${documentId}/versions/${versionId}/text`);
  return r.body?.text?.state ?? `http ${r.status}`;
}

// ---------------------------------------------------------------- browser

let browser;
async function chromium() {
  if (!browser) {
    const { chromium: c } = require("@playwright/test");
    browser = await c.launch({ headless: true });
  }
  return browser;
}
async function apiSession(p, email, password) {
  const api = new Api(p.base);
  await api.signIn(email, password);
  const me = await api.raw("GET", "/api/v1/me");
  return {
    context: { close: async () => {} },
    page: null,
    how: "api (POST /api/auth/sign-in/email with the origin header)",
    notes: [],
    landed: null,
    role: me.body?.user?.role ?? null,
    request: (method, route, json) => api.raw(method, route, json !== undefined ? { json } : {}),
  };
}
async function signInFor(p, email, password, apiOnly) {
  return apiOnly ? apiSession(p, email, password) : browserSignIn(p, email, password);
}
async function browserSignIn(p, email, password) {
  const b = await chromium();
  const context = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const signedIn = async (ms) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const r = await page.request.get(`${p.base}/api/v1/me`).catch(() => null);
      if (r?.ok()) return true;
      await sleep(1000);
    }
    return false;
  };
  let how = "password";
  const notes = [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.goto(`${p.base}/login`, { waitUntil: "networkidle" });
    await page
      .getByLabel("Email")
      .first()
      .waitFor({ timeout: 30_000 })
      .catch(() => {});
    const withPassword = page.getByRole("button", { name: "Sign in with a password" });
    if (await withPassword.isVisible().catch(() => false)) await withPassword.click();
    const breakGlass = page.getByRole("button", { name: "Administrator sign-in" });
    if (
      !(await page
        .getByLabel("Password")
        .isVisible()
        .catch(() => false)) &&
      (await breakGlass.isVisible().catch(() => false))
    )
      await breakGlass.click();
    if (
      await page
        .getByLabel("Password")
        .isVisible()
        .catch(() => false)
    ) {
      how = "password";
      await page.getByLabel("Email").first().fill(email);
      await page.getByLabel("Password").fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
    } else {
      how = "magic-link";
      const since = Date.now();
      const magic = page.getByRole("button", { name: "Email me a sign-in link" });
      if (await magic.isVisible().catch(() => false)) await magic.click();
      await page.getByLabel("Email").first().fill(email);
      await page.getByRole("button", { name: "Send link" }).click();
      const message = await waitMail(
        (m) => toAddress(m, email) && Date.parse(m.Created) >= since - 2000,
        60_000,
      );
      if (message) {
        const link = (await mailText(message.ID)).match(/https?:\/\/\S+/)?.[0];
        if (link) await page.goto(link.replace(/[)>.,]+$/, ""), { waitUntil: "networkidle" });
      }
    }
    if (await signedIn(15_000)) break;
    // Production authentication rate limits stay on. A refused attempt is retried after a pause.
    notes.push(`attempt ${attempt + 1} not signed in at ${new URL(page.url()).pathname}`);
    await sleep(20_000);
  }
  await page
    .waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 })
    .catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  const me = await page.request.get(`${p.base}/api/v1/me`);
  const body = me.ok() ? await me.json() : null;
  const request = async (method, route, json) => {
    const r = await page.request.fetch(`${p.base}${route}`, {
      method,
      headers: { origin: p.base, ...(json ? { "content-type": "application/json" } : {}) },
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
  return {
    context,
    page,
    how,
    notes,
    landed: new URL(page.url()).pathname,
    role: body?.user?.role ?? null,
    request,
  };
}
async function browserSha(session, route) {
  const r = await session.request("GET", route);
  return r.status === 200
    ? { status: 200, sha256: createHash("sha256").update(r.buffer).digest("hex") }
    : { status: r.status, sha256: null };
}

// ---------------------------------------------------------------- shared install helpers

function cloneAndCheckout(p, revision) {
  const lines = [];
  if (!existsSync(p.dir)) {
    must(`git clone https://github.com/juggernog20/OpenLaw.git ${p.name}`, LC, {
      timeout: 600_000,
    });
    lines.push("git clone https://github.com/juggernog20/OpenLaw.git: exit 0");
  }
  must(`git checkout --detach ${revision}`, p.dir);
  lines.push(
    `git checkout --detach ${revision}: exit 0; HEAD ${must("git rev-parse HEAD", p.dir).stdout.trim()}`,
  );
  return lines;
}
// Install article, Prepare the source and configuration, steps 2 to 4.
function writeInstallConfig(p, revision) {
  const envCommand = [
    "(",
    "  umask 077",
    "  set -C",
    "  cat .env.example > .env || exit 1",
    "  chmod 600 .env",
    '  sed -i "s|^AUTH_SECRET=$|AUTH_SECRET=$(openssl rand -base64 32)|" .env',
    '  sed -i "s|^OPENLAW_SECRET_KEY=$|OPENLAW_SECRET_KEY=$(openssl rand -base64 32)|" .env',
    ")",
  ].join("\n");
  must(envCommand, p.dir);
  for (const [key, value] of [
    ["COMPOSE_PROJECT_NAME", p.project],
    ["COMPOSE_FILE", "compose.yml:compose.operator.yml"],
    ["OPENLAW_BUILD_COMMIT", revision],
    ["OPENLAW_BUILD_DIRTY", "false"],
    ["BASE_URL", p.base],
    ["PORT", `127.0.0.1:${p.port}`],
  ])
    envSet(p, key, value);
  writeFileSync(
    path.join(p.dir, "compose.operator.yml"),
    [
      "services:",
      "  app:",
      "    image: openlaw-local:${OPENLAW_BUILD_COMMIT:?Set the source revision}",
      "  worker:",
      "    image: openlaw-local:${OPENLAW_BUILD_COMMIT:?Set the source revision}",
      "  doc-engine:",
      "    image: openlaw-engine-local:${OPENLAW_BUILD_COMMIT:?Set the source revision}",
      "",
    ].join("\n"),
  );
}
function storeKeys(p) {
  secrets[p.name] = {
    ...(secrets[p.name] ?? {}),
    AUTH_SECRET: envGet(p, "AUTH_SECRET"),
    OPENLAW_SECRET_KEY: envGet(p, "OPENLAW_SECRET_KEY"),
  };
  saveSecrets();
}

function recordImages(label, p) {
  log.images[label] = {
    project: p.project,
    at: new Date().toISOString(),
    services: imageIds(p),
  };
  saveLog();
  return log.images[label];
}

// ---------------------------------------------------------------- phases
const phases = {};
const adminApis = new Map();
async function adminApi(p) {
  const cached = adminApis.get(p.name);
  if (cached) {
    const me = await cached.raw("GET", "/api/v1/me").catch(() => ({ status: 0 }));
    if (me.status === 200) return cached;
  }
  const api = new Api(p.base);
  await api.signIn(state.people.admin.email, secrets.fixture.admin);
  adminApis.set(p.name, api);
  return api;
}
const P = PROJECTS.diag;
const T = "operator-troubleshooting";
const S = "V-C48";
function lines(text, pattern, n = 4) {
  return text
    .split("\n")
    .filter((l) => pattern.test(l))
    .map((l) => l.trim().slice(0, 300))
    .slice(0, n);
}
function recreate(p, services = "app worker") {
  return sh(`docker compose up -d --no-build --pull never --force-recreate ${services}`, p.dir, {
    timeout: 300_000,
  });
}
const psq = (p, sql) =>
  must(
    `docker compose exec -T postgres psql -U openlaw -d openlaw -At -F '|' -c "${sql}"`,
    p.dir,
  ).stdout.trim();
function psAll(p) {
  return must("docker compose ps --all --format '{{.Service}} {{.State}}'", p.dir)
    .stdout.trim()
    .split("\n")
    .filter(Boolean);
}

// ---------------------------------------------------------------- fixture: support, starting build, population, upgrade

phases["support-up"] = async () => {
  await step(
    {
      scenario: "setup",
      action: "Create project networks with explicit subnets (host address pools are exhausted)",
    },
    () => {
      const made = ensureNetworks(P);
      return `created ${made.length} networks: ${made.join(", ")}`;
    },
  );
  await step(
    { scenario: "setup", action: "Start an owned Mailpit relay for controlled recipients" },
    () => {
      if (sh(`docker inspect ${MAIL_NAME}`, root).code !== 0)
        must(
          `docker run -d --name ${MAIL_NAME} --label openlaw-docs-owner=${PREFIX} --network ${P.project}_openlaw-backend --network-alias lc-mail -p 127.0.0.1:23335:8025 axllent/mailpit:v1.30 --smtp-auth-accept-any --smtp-auth-allow-insecure`,
          root,
        );
      return `Mailpit ${MAIL_NAME} on ${P.project}_openlaw-backend as lc-mail, UI 127.0.0.1:23335`;
    },
  );
};

phases["baseline-install"] = async () => {
  const p = P;
  await step(
    {
      scenario: S,
      method: "automated-test",
      action: "Fixture: clone and select the starting build",
      critical: true,
    },
    () => cloneAndCheckout(p, BASELINE).join("; "),
  );
  await step(
    {
      scenario: S,
      method: "automated-test",
      action: "Fixture: write .env and compose.operator.yml per the installation guide",
      critical: true,
    },
    () => {
      if (!existsSync(path.join(p.dir, ".env"))) writeInstallConfig(p, BASELINE);
      storeKeys(p);
      return `project ${p.project}, OPENLAW_BUILD_COMMIT ${BASELINE}, BASE_URL ${p.base}; keys copied to the private secret store`;
    },
  );
  await step(
    {
      scenario: S,
      method: "automated-test",
      action: "Fixture: build and start the starting build",
      critical: true,
      command:
        "docker compose config --quiet; docker compose build app doc-engine; docker compose up -d --no-build --pull never",
    },
    async () => {
      must("docker compose config --quiet", p.dir);
      ensureNetworks(p);
      must("docker compose build app doc-engine", p.dir, { timeout: 3_000_000 });
      must("docker compose up -d --no-build --pull never", p.dir);
      await waitReady(p);
      attachSupport(p);
      return { readyz: 200, images: recordImages("baseline-install", p).services };
    },
  );
};

phases["populate"] = async () => {
  const p = P;
  const pw = secrets.fixture ?? {
    admin: randomBytes(12).toString("base64url"),
    reader: randomBytes(12).toString("base64url"),
    relay: randomBytes(9).toString("base64url"),
  };
  secrets.fixture = pw;
  saveSecrets();
  const people = {
    admin: {
      email: "morgan.diagnose@lifecycle.example",
      displayName: "DOC-029 operator-lifecycle Morgan Diagnose",
    },
    reader: {
      email: "rowan.diagnose@lifecycle.example",
      displayName: "DOC-029 operator-lifecycle Rowan Diagnose",
      role: "legal_team_member",
    },
  };
  const api = new Api(p.base);
  const inventory = { people: {}, contracts: [], documents: [] };
  state.people = people;
  state.inventory = inventory;
  await step(
    {
      scenario: S,
      method: "automated-test",
      action: "Fixture: first Administrator and a saved encrypted SMTP relay",
      critical: true,
    },
    async () => {
      const setup = await api.get("/api/v1/auth/setup");
      if (setup.needsSetup)
        await api.post(
          "/api/v1/auth/setup",
          { ...people.admin, password: pw.admin },
          { accept: [201] },
        );
      else await api.signIn(people.admin.email, pw.admin);
      await api.put("/api/v1/email-settings", {
        smtpUrl: `smtp://lc-relay:${pw.relay}@lc-mail:1025`,
        smtpFrom: "DOC-029 operator-lifecycle <openlaw@lifecycle.example>",
      });
      const since = Date.now();
      await api.post("/api/v1/email-settings/test");
      const mail = await waitMail(
        (m) =>
          toAddress(m, people.admin.email) &&
          m.Subject === "OpenLaw test email" &&
          Date.parse(m.Created) >= since - 2000,
      );
      check(mail, "test email not delivered");
      await api.post("/api/v1/onboarding/complete");
      const me = (await api.get("/api/v1/me")).user;
      inventory.people.admin = { email: people.admin.email, role: me.role, id: me.id };
      return `Administrator ${me.role}; saved relay source ${(await api.get("/api/v1/email-settings")).source}; test email delivered`;
    },
  );
  await step(
    {
      scenario: S,
      method: "automated-test",
      action: "Fixture: invite and activate a Legal Team Member",
      critical: true,
    },
    async () => {
      const person = people.reader;
      const since = Date.now();
      const created = await api.post("/api/v1/auth/invites", {
        email: person.email,
        displayName: person.displayName,
        role: person.role,
      });
      const message = await waitMail(
        (m) => toAddress(m, person.email) && Date.parse(m.Created) >= since - 2000,
      );
      check(message, "no invitation");
      const token = (await mailText(message.ID)).match(/token=([A-Za-z0-9._-]+)/)?.[1];
      check(token, "invitation has no token");
      await new Api(p.base).post("/api/auth/reset-password", { newPassword: pw.reader, token });
      const session = new Api(p.base);
      await session.signIn(person.email, pw.reader);
      const me = (await session.get("/api/v1/me")).user;
      inventory.people.reader = { email: person.email, role: me.role, id: created.user.id };
      return `reader ${me.role} activated`;
    },
  );
  await step(
    {
      scenario: S,
      method: "automated-test",
      action: "Fixture: two Contracts and two Documents with Versions (one PDF)",
      critical: true,
    },
    async () => {
      const type = (await api.get("/api/v1/contract-types")).contractTypes[0];
      for (const title of [
        "DOC-029 operator-lifecycle supply agreement",
        "DOC-029 operator-lifecycle services agreement",
      ]) {
        const c = (await api.post("/api/v1/contracts", { title, contractTypeId: type.id }))
          .contract;
        inventory.contracts.push({ number: c.number, id: c.id, title: c.title });
      }
      const [first, second] = inventory.contracts;
      const d1 = (
        await api.upload(
          `/api/v1/contracts/${first.number}/documents`,
          "doc029-diagnose-draft.txt",
          Buffer.from("DOC-029 operator-lifecycle draft, original.\n"),
          "text/plain",
        )
      ).document;
      const d2 = (
        await api.upload(
          `/api/v1/contracts/${second.number}/documents`,
          "doc029-diagnose-terms.pdf",
          pdf(["DOC-029 operator-lifecycle terms, original.", "Fictional terms for diagnostics."]),
          "application/pdf",
        )
      ).document;
      for (const [contract, doc] of [
        [first, d1],
        [second, d2],
      ]) {
        const listed = (
          await api.get(`/api/v1/contracts/${contract.number}/documents`)
        ).documents.find((row) => row.id === doc.id);
        const versions = [];
        for (const v of listed.versions) {
          const got = await api.sha(`/api/v1/documents/${doc.id}/versions/${v.id}/download`);
          const text = await waitText(api, doc.id, v.id, 240_000, ["ready", "unsupported"]);
          versions.push({
            id: v.id,
            versionNumber: v.versionNumber,
            sha256: got.sha256,
            textState: text.state,
          });
        }
        inventory.documents.push({
          id: doc.id,
          contract: contract.number,
          title: listed.title,
          versions,
        });
      }
      return inventory.documents.map(
        (d) =>
          `${d.title}: ${d.versions.map((v) => `v${v.versionNumber} ${v.sha256.slice(0, 12)} text=${v.textState}`).join(", ")}`,
      );
    },
  );
  state.people = people;
  state.inventory = inventory;
  saveState();
};

phases["upgrade"] = async () => {
  const p = P;
  await step(
    {
      scenario: S,
      method: "automated-test",
      action:
        "Fixture: the starting database recorded the earlier 0090_request_triage_assignee migration",
      critical: true,
    },
    () => {
      const shipped = must("git show HEAD:packages/db/migrations/meta/_journal.json", p.dir).stdout;
      const entry = JSON.parse(shipped).entries.find(
        (e) => e.tag === "0090_request_triage_assignee",
      );
      check(entry, "starting build does not ship 0090_request_triage_assignee");
      const row = psq(
        p,
        `select count(*) from drizzle.__drizzle_migrations where created_at = ${entry.when}`,
      );
      check(row === "1", `journal rows at ${entry.when}: ${row}`);
      const count = psq(p, "select count(*) from drizzle.__drizzle_migrations");
      return `starting build ${must("git rev-parse HEAD", p.dir).stdout.trim()} ships 0090_request_triage_assignee stamped ${entry.when}; the journal holds that row; ${count} journal rows`;
    },
  );
  await step(
    {
      scenario: S,
      method: "automated-test",
      action: "Fixture: coherent pre-upgrade database dump kept privately",
      critical: true,
    },
    () => {
      const dir = path.join(LC, "backups");
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      must("docker compose stop app worker", p.dir, { timeout: 180_000 });
      must(
        `umask 077; docker compose exec -T postgres pg_dump -U openlaw -d openlaw --format=custom > "${dir}/pre-upgrade.dump"`,
        p.dir,
      );
      return `pg_dump with app and worker stopped: ${readFileSync(path.join(dir, "pre-upgrade.dump")).length} bytes`;
    },
  );
  await step(
    {
      scenario: S,
      method: "automated-test",
      action: "Fixture: select the candidate, build, start; the app logs the automatic repair",
      command: `git checkout --detach ${CANDIDATE}; docker compose build app doc-engine; docker compose up -d --no-build --pull never`,
      critical: true,
      expected:
        "Article, Migration failures: the app logs 'migrations: reconciled <migration>; continuing with pending migrations' for a database that recorded the earlier 0090_request_triage_assignee migration.",
    },
    async () => {
      must(`git checkout --detach ${CANDIDATE}`, p.dir);
      envSet(p, "OPENLAW_BUILD_COMMIT", CANDIDATE);
      must("docker compose config --quiet", p.dir);
      must("docker compose build app doc-engine", p.dir, { timeout: 3_000_000 });
      must("docker compose up -d --no-build --pull never", p.dir);
      await waitReady(p, 600_000);
      const full = must("docker compose logs --no-log-prefix app", p.dir).stdout;
      const reconciled = lines(
        full,
        /migrations: reconciled .*; continuing with pending migrations/,
      );
      check(
        reconciled.length > 0,
        `no reconciled line: ${JSON.stringify(lines(full, /migrat/i, 6))}`,
      );
      return {
        reconciled,
        readyz: 200,
        journalRows: psq(p, "select count(*) from drizzle.__drizzle_migrations"),
        images: recordImages("candidate", p).services,
      };
    },
  );
};

// ---------------------------------------------------------------- Start with the observed failure

phases["diag-baseline"] = async () => {
  const p = P;
  await step(
    {
      scenario: S,
      article: T,
      action: "Start with the observed failure: the three commands",
      command:
        "docker compose config --quiet; docker compose ps --all; docker compose logs --since=10m app worker",
      critical: true,
    },
    async () => {
      const cfg = sh("docker compose config --quiet", p.dir);
      const ps = sh("docker compose ps --all", p.dir);
      const logs = must("docker compose logs --since=10m app worker", p.dir).stdout;
      const h = await http(`${p.base}/healthz`);
      const r = await http(`${p.base}/readyz`);
      const leaked = secretValues().some((v) => logs.includes(v));
      check(
        cfg.code === 0 && cfg.stdout.trim() === "" && ps.code === 0 && !leaked,
        `config ${cfg.code} ${cfg.stdout.length}, ps ${ps.code}, leaked ${leaked}`,
      );
      return {
        configQuietExit: cfg.code,
        configQuietPrintsNothing: cfg.stdout.trim() === "",
        psAll: psAll(p),
        healthz: h.status,
        readyz: r.status,
        logLines: logs.split("\n").length,
        keysOrRelayCredentialInLogs: leaked,
      };
    },
  );
};

// ---------------------------------------------------------------- Startup, origin, and database

phases["diag-startup"] = async () => {
  const p = P;
  const good = {
    AUTH_SECRET: secrets.diag.AUTH_SECRET,
    OPENLAW_SECRET_KEY: secrets.diag.OPENLAW_SECRET_KEY,
  };
  await step(
    {
      scenario: S,
      article: T,
      action: "Missing key: Compose refuses config and up for either key",
      expected: "Compose refuses the command when either key is missing.",
      critical: false,
    },
    () => {
      const out = {};
      for (const key of ["AUTH_SECRET", "OPENLAW_SECRET_KEY"]) {
        const before = containerIds(p)
          .map((c) => c.id)
          .sort()
          .join(",");
        envSet(p, key, null);
        const cfg = sh("docker compose config --quiet", p.dir);
        const up = sh("docker compose up -d --no-build --pull never", p.dir);
        envSet(p, key, good[key]);
        const after = containerIds(p)
          .map((c) => c.id)
          .sort()
          .join(",");
        check(
          cfg.code !== 0 && up.code !== 0 && before === after,
          `${key}: config ${cfg.code}, up ${up.code}, containers unchanged ${before === after}`,
        );
        out[key] = {
          config: `exit ${cfg.code}: ${cfg.stderr.trim().split("\n").pop()}`,
          up: `exit ${up.code}`,
          containersUnchanged: true,
        };
      }
      return out;
    },
  );
  await step(
    {
      scenario: S,
      article: T,
      action:
        "Short OPENLAW_SECRET_KEY: config passes, app and worker refuse; supply the key, config --quiet, recreate, check startup",
      critical: false,
    },
    async () => {
      envSet(p, "OPENLAW_SECRET_KEY", "short-key-under-32-chars");
      const cfg = sh("docker compose config --quiet", p.dir);
      recreate(p);
      await sleep(20_000);
      const appLogs = sh("docker compose logs --no-log-prefix --tail=40 app", p.dir).stdout;
      const workerLogs = sh("docker compose logs --no-log-prefix --tail=40 worker", p.dir).stdout;
      const ready = await http(`${p.base}/readyz`);
      const ps = containerIds(p).map((x) => `${x.service} ${x.state} ${x.status}`);
      envSet(p, "OPENLAW_SECRET_KEY", good.OPENLAW_SECRET_KEY);
      const cfg2 = sh("docker compose config --quiet", p.dir);
      recreate(p);
      await waitReady(p);
      const api = await adminApi(p);
      const read = await api.raw("GET", `/api/v1/contracts/${state.inventory.contracts[0].number}`);
      const appRefusal = lines(appLogs, /OPENLAW_SECRET_KEY/, 1);
      const workerRefusal = lines(workerLogs, /OPENLAW_SECRET_KEY/, 1);
      check(
        cfg.code === 0 &&
          ready.status !== 200 &&
          appRefusal.length &&
          workerRefusal.length &&
          cfg2.code === 0 &&
          read.status === 200,
        JSON.stringify({
          cfg: cfg.code,
          ready: ready.status,
          appRefusal,
          workerRefusal,
          read: read.status,
        }),
      );
      return {
        configQuietWithShortKey: cfg.code,
        readyzWhileShort: ready.status,
        ps,
        appLog: appRefusal,
        workerLog: workerRefusal,
        recovery: `config --quiet ${cfg2.code}; recreated; readyz 200; Contract read ${read.status}`,
      };
    },
  );
  await step(
    {
      scenario: S,
      article: T,
      action:
        "Short AUTH_SECRET: only a warning is logged and the app starts; restore the retained value",
      critical: false,
    },
    async () => {
      envSet(p, "AUTH_SECRET", "short-auth-secret");
      recreate(p);
      const ready = await waitReady(p)
        .then(() => 200)
        .catch(() => 0);
      const logs = sh("docker compose logs --no-log-prefix app", p.dir).stdout;
      const warn = lines(logs, /BETTER_AUTH_SECRET|AUTH_SECRET/i, 2);
      envSet(p, "AUTH_SECRET", good.AUTH_SECRET);
      recreate(p);
      await waitReady(p);
      check(ready === 200 && warn.length > 0, `readyz ${ready}, warning ${warn.length}`);
      return {
        readyzWithShortAuthSecret: ready,
        warning: warn,
        restored: "readyz 200 with the retained AUTH_SECRET",
      };
    },
  );
  await step(
    {
      scenario: S,
      article: T,
      action:
        "Port is already allocated: failed bind; ps --all shows app and worker created; plain ps omits them; instance down; correct PORT and run the same up again",
      expected:
        "After a failed bind, docker compose ps --all shows the app and worker containers in the created state. Plain docker compose ps does not list them. The instance stays down until you correct the port and run the same docker compose up -d --no-build --pull never command again.",
      critical: false,
    },
    async () => {
      const listener = await http(`http://127.0.0.1:${OCCUPIED_PORT}/`);
      check(listener.status === 200, `occupier not listening: ${listener.status}`);
      envSet(p, "PORT", `127.0.0.1:${OCCUPIED_PORT}`);
      const up = sh("docker compose up -d --no-build --pull never", p.dir, { timeout: 300_000 });
      const all = psAll(p);
      const plain = must("docker compose ps --format '{{.Service}} {{.State}}'", p.dir)
        .stdout.trim()
        .split("\n")
        .filter(Boolean);
      const table = must("docker compose ps --all", p.dir)
        .stdout.split("\n")
        .filter((l) => /-app-|-worker-/.test(l))
        .map((l) => l.replace(/\s+/g, " ").slice(0, 200));
      await sleep(3000);
      const directDown = await http(`${p.base}/readyz`, { timeoutMs: 3000 });
      const occupiedStill = await http(`http://127.0.0.1:${OCCUPIED_PORT}/`);
      const errLine = up.stderr
        .split("\n")
        .filter((l) => /allocated/i.test(l))
        .map((l) => l.replace(/endpoint \S+ \([0-9a-f]+\)/, "endpoint …"))
        .slice(0, 1);
      envSet(p, "PORT", `127.0.0.1:${p.port}`);
      const up2 = sh("docker compose up -d --no-build --pull never", p.dir, { timeout: 300_000 });
      await waitReady(p);
      const allAfter = psAll(p);
      const created = (svc) => all.includes(`${svc} created`);
      const listed = (svc) => plain.some((l) => l.startsWith(`${svc} `));
      check(
        up.code !== 0 &&
          created("app") &&
          created("worker") &&
          !listed("app") &&
          !listed("worker") &&
          directDown.status !== 200 &&
          occupiedStill.status === 200 &&
          up2.code === 0,
        JSON.stringify({ up: up.code, all, plain, directDown: directDown.status, up2: up2.code }),
      );
      return {
        upExit: up.code,
        error: errLine,
        psAll: all,
        psAllTableRows: table,
        plainPs: plain,
        readyzWhileFailed: `${directDown.status} ${directDown.text.slice(0, 40)}`,
        otherListenerUntouched: occupiedStill.status,
        recovery: { upExit: up2.code, readyz: 200, psAll: allAfter },
      };
    },
  );
  await step(
    {
      scenario: S,
      article: T,
      action:
        "Port recovery by choosing an unused port: update PORT and BASE_URL together, then check the actual origin; return to the original origin",
      critical: false,
    },
    async () => {
      const alt = `http://127.0.0.1:${ALT_PORT}`;
      envSet(p, "PORT", `127.0.0.1:${ALT_PORT}`);
      envSet(p, "BASE_URL", alt);
      const up = sh("docker compose up -d --no-build --pull never", p.dir, { timeout: 300_000 });
      await waitReady({ base: alt });
      const api = new Api(alt);
      await api.signIn(state.people.admin.email, secrets.fixture.admin);
      const me = await api.raw("GET", "/api/v1/me");
      envSet(p, "PORT", `127.0.0.1:${p.port}`);
      envSet(p, "BASE_URL", p.base);
      const up2 = sh("docker compose up -d --no-build --pull never", p.dir, { timeout: 300_000 });
      await waitReady(p);
      adminApis.clear();
      const back = await adminApi(p);
      const me2 = await back.raw("GET", "/api/v1/me");
      check(
        up.code === 0 && me.status === 200 && up2.code === 0 && me2.status === 200,
        JSON.stringify({ up: up.code, me: me.status, up2: up2.code, me2: me2.status }),
      );
      return {
        upOnUnusedPort: up.code,
        readyzOnUnusedPort: 200,
        signInThroughThatOrigin: me.status,
        returnedToOriginal: `up ${up2.code}; readyz 200; sign-in ${me2.status}`,
      };
    },
  );
  await step(
    {
      scenario: S,
      article: T,
      action:
        "App keeps restarting: unresolvable DATABASE_URL; first specific error in app logs; correct and recreate",
      critical: false,
    },
    async () => {
      envSet(p, "DATABASE_URL", "postgres://openlaw:openlaw@lc-no-such-database:5432/openlaw");
      recreate(p);
      await sleep(45_000);
      const logs = sh("docker compose logs --no-log-prefix app", p.dir).stdout;
      const restarts = sh(
        `docker inspect --format '{{.RestartCount}} {{.State.Status}}' $(docker compose ps -aq app)`,
        p.dir,
      ).stdout.trim();
      const ready = await http(`${p.base}/readyz`);
      envSet(p, "DATABASE_URL", null);
      recreate(p);
      await waitReady(p);
      const first = lines(logs, /ENOTFOUND|getaddrinfo|ECONNREFUSED|timeout|error/i, 2);
      check(
        first.length > 0 && ready.status !== 200,
        `error lines ${first.length}, readyz ${ready.status}`,
      );
      return {
        restartCountAndState: restarts,
        readyz: ready.status,
        firstErrorLines: first,
        recovery: "override removed, app recreated, readyz 200",
      };
    },
  );
  await step(
    {
      scenario: S,
      article: T,
      action:
        "/healthz works but /readyz fails: database stopped; restore; verify a record read and write",
      critical: false,
    },
    async () => {
      must("docker compose stop postgres", p.dir);
      await sleep(5000);
      const h = await http(`${p.base}/healthz`);
      const r = await http(`${p.base}/readyz`);
      must("docker compose start postgres", p.dir);
      await waitReady(p);
      const api = await adminApi(p);
      const c = state.inventory.contracts[1];
      const read = await api.raw("GET", `/api/v1/contracts/${c.number}`);
      const write = await api.raw("PATCH", `/api/v1/contracts/${c.number}`, {
        json: { description: `DOC-029 operator-lifecycle write check ${new Date().toISOString()}` },
      });
      check(
        h.status === 200 && r.status !== 200 && read.status === 200 && write.status === 200,
        `healthz ${h.status} readyz ${r.status} read ${read.status} write ${write.status}`,
      );
      return {
        healthz: h.status,
        readyz: `${r.status} ${r.text.slice(0, 80)}`,
        afterRestore: `readyz 200; Contract read ${read.status}; write ${write.status}`,
      };
    },
  );
};

phases["occupier-up"] = async () => {
  await step(
    { scenario: "setup", action: "Start an unrelated listener that holds the occupied port" },
    () => {
      if (sh(`docker inspect ${OCCUPIER_NAME}`, root).code !== 0)
        must(
          `docker run -d --name ${OCCUPIER_NAME} --label openlaw-docs-owner=${PREFIX} -p 127.0.0.1:${OCCUPIED_PORT}:80 caddy:2-alpine caddy respond --listen :80 "DOC-029 unrelated listener"`,
          root,
        );
      return `${OCCUPIER_NAME} on 127.0.0.1:${OCCUPIED_PORT}`;
    },
  );
};

// ---------------------------------------------------------------- Migration failures

phases["diag-migration"] = async () => {
  const p = P;
  await step(
    {
      scenario: S,
      article: T,
      action:
        "Migration failure: controlled journal fault; refusal text; both read-only commands; custodian undo",
      expected:
        "App refuses with 'This database cannot apply the migrations it is missing'; the two commands list the recorded journal and shipped hashes.",
      critical: false,
    },
    async () => {
      const dir = path.join(LC, "backups");
      must(
        `umask 077; docker compose exec -T postgres pg_dump -U openlaw -d openlaw --format=custom > "${dir}/pre-fault.dump"`,
        p.dir,
      );
      const row = psq(
        p,
        "select id, hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 1",
      );
      const [id, hash] = row.split("|");
      state.migrationFault = { id, hash };
      saveState();
      psq(
        p,
        `update drizzle.__drizzle_migrations set hash = 'doc029diagnosefault' || substr(hash, 20) where id = ${id}`,
      );
      recreate(p, "app");
      await sleep(30_000);
      const logs = sh("docker compose logs --no-log-prefix --tail=80 app", p.dir).stdout;
      const refusal = lines(
        logs,
        /cannot apply the migrations|stamped at or before|Refusing to start|^\s*- \d{4}_/i,
        5,
      );
      const ready = await http(`${p.base}/readyz`);
      const c1 = sh(
        `docker compose exec -T postgres psql -U openlaw -d openlaw -c 'select hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 5;'`,
        p.dir,
      );
      const c2 = sh(
        "docker compose run -T --rm --no-deps app node scripts/lint-migration-journal.mjs --hashes",
        p.dir,
        { timeout: 180_000 },
      );
      const faultShown = c1.stdout.includes("doc029diagnosefault");
      const shipped = c2.stdout
        .split("\n")
        .find((l) => l.includes(hash))
        ?.trim()
        .slice(0, 160);
      const journalRowsUnchanged = psq(p, "select count(*) from drizzle.__drizzle_migrations");
      psq(p, `update drizzle.__drizzle_migrations set hash = '${hash}' where id = ${id}`);
      recreate(p, "app");
      await waitReady(p);
      check(
        refusal.some((l) =>
          l.includes("This database cannot apply the migrations it is missing"),
        ) &&
          ready.status !== 200 &&
          c1.code === 0 &&
          c2.code === 0 &&
          faultShown &&
          shipped,
        JSON.stringify({
          refusal,
          ready: ready.status,
          c1: c1.code,
          c2: c2.code,
          faultShown,
          shipped,
        }),
      );
      return {
        refusal,
        readyzWhileRefusing: ready.status,
        psqlCommandExit: c1.code,
        faultyRowListed: faultShown,
        lintHashesExit: c2.code,
        shippedEntryMatchingRecordedHash: shipped,
        journalRows: journalRowsUnchanged,
        undo: "fixture custodian wrote back the exact recorded hash (not an operator repair); readyz 200",
      };
    },
  );
  await step(
    {
      scenario: S,
      article: T,
      action:
        "accounts.issuer refusals: run the shipped 0060_account_issuer.sql against a scratch pre-0060 accounts shape; each refusal names its case and applies none of the migration",
      expected:
        "'Cannot resolve an issuer for accounts under provider(s)' for accounts under a provider the database no longer holds; 'Two accounts share one 1.7 identity' for one provider registered twice; no issuer column left behind.",
      critical: false,
    },
    () => {
      const sqlFile = must(
        "docker compose run -T --rm --no-deps app sh -c 'cat packages/db/migrations/0060_account_issuer.sql 2>/dev/null || find / -name 0060_account_issuer.sql 2>/dev/null | head -1 | xargs cat'",
        p.dir,
      ).stdout;
      check(
        sqlFile.includes("Cannot resolve an issuer"),
        "migration file not found in the candidate image",
      );
      const migration = sqlFile.replace(/--> statement-breakpoint/g, "");
      const run = (label, seed) => {
        const db = `doc029_issuer_${label}`;
        must(
          `docker compose exec -T postgres psql -U openlaw -d openlaw -c "drop database if exists ${db}" -c "create database ${db}"`,
          p.dir,
        );
        must(`docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U openlaw -d ${db}`, p.dir, {
          input: `create table sso_providers (provider_id text primary key, issuer text not null);\ncreate table accounts (id text primary key, provider_id text not null, account_id text not null, unique (provider_id, account_id));\n${seed}\n`,
        });
        const r = sh(
          `docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U openlaw -d ${db}`,
          p.dir,
          { input: migration },
        );
        const column = must(
          `docker compose exec -T postgres psql -U openlaw -d ${db} -At -c "select count(*) from information_schema.columns where table_name='accounts' and column_name='issuer'"`,
          p.dir,
        ).stdout.trim();
        must(
          `docker compose exec -T postgres psql -U openlaw -d openlaw -c "drop database ${db}"`,
          p.dir,
        );
        return { exit: r.code, error: lines(r.stderr, /ERROR/, 1), issuerColumnAfter: column };
      };
      const orphan = run(
        "orphan",
        "insert into accounts values ('a1','credential','u1'),('a2','doc029-retired-idp','subject-1');",
      );
      const dup = run(
        "dup",
        "insert into sso_providers values ('doc029-idp-a','https://idp.doc029.example'),('doc029-idp-b','https://idp.doc029.example');\ninsert into accounts values ('a1','doc029-idp-a','subject-1'),('a2','doc029-idp-b','subject-1');",
      );
      const clean = run(
        "clean",
        "insert into sso_providers values ('doc029-idp-a','https://idp.doc029.example');\ninsert into accounts values ('a1','credential','u1'),('a2','doc029-idp-a','subject-1');",
      );
      check(
        orphan.exit !== 0 &&
          orphan.error
            .join()
            .includes(
              "Cannot resolve an issuer for accounts under provider(s): doc029-retired-idp",
            ) &&
          orphan.issuerColumnAfter === "0",
        JSON.stringify(orphan),
      );
      check(
        dup.exit !== 0 &&
          dup.error.join().includes("Two accounts share one 1.7 identity") &&
          dup.issuerColumnAfter === "0",
        JSON.stringify(dup),
      );
      check(clean.exit === 0 && clean.issuerColumnAfter === "1", JSON.stringify(clean));
      return {
        providerNoLongerHeld: orphan,
        providerRegisteredTwice: dup,
        correctedShape: clean,
        scratchDatabasesDropped: true,
      };
    },
  );
};

// ---------------------------------------------------------------- Email and stored credentials

phases["diag-mail"] = async () => {
  const p = P;
  const goodKey = secrets.diag.OPENLAW_SECRET_KEY;
  await step(
    {
      scenario: S,
      article: T,
      action:
        "SMTP_URL pins the environment: saved relay ignored; valid SMTP_FROM; recreate app and worker; then remove the override and verify delivery",
      critical: false,
    },
    async () => {
      envSet(p, "SMTP_URL", "smtp://lc-mail:1025");
      envSet(p, "SMTP_FROM", "DOC-029 operator-lifecycle env <env@lifecycle.example>");
      recreate(p);
      await waitReady(p);
      adminApis.clear();
      let api = await adminApi(p);
      const pinned = await api.get("/api/v1/email-settings");
      const since = Date.now();
      const test = await api.raw("POST", "/api/v1/email-settings/test");
      const mail = await waitMail(
        (m) => toAddress(m, state.people.admin.email) && Date.parse(m.Created) >= since - 2000,
      );
      const pinnedFrom = mail?.From?.Address;
      const save = await api.raw("PUT", "/api/v1/email-settings", {
        json: { smtpUrl: "smtp://lc-mail:1025", smtpFrom: "x@lifecycle.example" },
      });
      envSet(p, "SMTP_URL", null);
      envSet(p, "SMTP_FROM", null);
      recreate(p);
      await waitReady(p);
      adminApis.clear();
      api = await adminApi(p);
      const restored = await api.get("/api/v1/email-settings");
      const since2 = Date.now();
      const test2 = await api.raw("POST", "/api/v1/email-settings/test");
      const mail2 = await waitMail(
        (m) => toAddress(m, state.people.admin.email) && Date.parse(m.Created) >= since2 - 2000,
      );
      check(
        pinned.source === "env" &&
          test.status === 200 &&
          pinnedFrom === "env@lifecycle.example" &&
          save.status >= 400 &&
          restored.source !== "env" &&
          test2.status === 200 &&
          mail2?.From?.Address === "openlaw@lifecycle.example",
        JSON.stringify({
          pinned: pinned.source,
          test: test.status,
          pinnedFrom,
          save: save.status,
          restored: restored.source,
          test2: test2.status,
          from2: mail2?.From?.Address,
        }),
      );
      return {
        pinnedSource: pinned.source,
        testWhilePinned: test.status,
        deliveredFrom: pinnedFrom,
        saveWhilePinned: `${save.status} ${save.body?.detail ?? ""}`.slice(0, 160),
        afterRemoval: {
          source: restored.source,
          test: test2.status,
          deliveredFrom: mail2.From.Address,
        },
      };
    },
  );
  await step(
    {
      scenario: S,
      article: T,
      action:
        "Wrong OPENLAW_SECRET_KEY: email state unset, test send gives the exact message, unrelated Contract readable; restore the key",
      expected: "The test email could not be sent. SMTP is not configured — save a relay first.",
      critical: false,
    },
    async () => {
      envSet(p, "OPENLAW_SECRET_KEY", randomBytes(32).toString("base64"));
      recreate(p);
      await waitReady(p);
      adminApis.clear();
      let api = await adminApi(p);
      const settings = await api.get("/api/v1/email-settings");
      const test = await api.raw("POST", "/api/v1/email-settings/test");
      const read = await api.raw("GET", `/api/v1/contracts/${state.inventory.contracts[0].number}`);
      const doc = state.inventory.documents[0];
      const dl = await api.sha(
        `/api/v1/documents/${doc.id}/versions/${doc.versions[0].id}/download`,
      );
      envSet(p, "OPENLAW_SECRET_KEY", goodKey);
      recreate(p);
      await waitReady(p);
      adminApis.clear();
      api = await adminApi(p);
      const settings2 = await api.get("/api/v1/email-settings");
      const since = Date.now();
      const test2 = await api.raw("POST", "/api/v1/email-settings/test");
      const mail = await waitMail(
        (m) => toAddress(m, state.people.admin.email) && Date.parse(m.Created) >= since - 2000,
      );
      const detail = test.body?.detail ?? test.body?.message ?? "";
      check(
        detail ===
          "The test email could not be sent. SMTP is not configured — save a relay first." &&
          settings.source === "unset" &&
          read.status === 200 &&
          test2.status === 200 &&
          mail,
        JSON.stringify({
          settings,
          test: test.status,
          detail,
          read: read.status,
          test2: test2.status,
        }),
      );
      return {
        emailSettingsWithWrongKey: settings,
        testSend: `${test.status} ${detail}`,
        unrelatedContractRead: read.status,
        unrelatedDownloadHashMatches: dl.sha256 === doc.versions[0].sha256,
        afterKeyRestored: `source ${settings2.source}; test ${test2.status}; delivered`,
      };
    },
  );
};

// ---------------------------------------------------------------- Storage and uploads

phases["diag-storage"] = async () => {
  const p = P;
  const minioSecret = secrets.minio?.secret ?? randomBytes(18).toString("base64url");
  secrets.minio = { user: "doc029diagnose", secret: minioSecret };
  saveSecrets();
  await step(
    {
      scenario: S,
      article: T,
      action: "Local storage: the file volume belongs to the image's unprivileged user",
      command:
        "docker compose run -T --rm --no-deps app sh -c 'id; stat -c \"%U %u %a\" /var/lib/openlaw/files'",
      critical: false,
    },
    () => {
      const r = must(
        `docker compose run -T --rm --no-deps app sh -c 'id -u; id -un; stat -c "%U %u %a" /var/lib/openlaw/files'`,
        p.dir,
      )
        .stdout.trim()
        .split("\n");
      check(r[0] !== "0" && r[2].split(" ")[1] === r[0], JSON.stringify(r));
      return { uid: r[0], user: r[1], volumeOwnerUidMode: r[2] };
    },
  );
  await step(
    {
      scenario: S,
      method: "automated-test",
      action:
        "Fixture: owned MinIO with a pre-created bucket; write driver s3 on app and worker; upload one file",
      critical: true,
    },
    async () => {
      if (sh(`docker inspect ${MINIO_NAME}`, root).code !== 0)
        must(
          `docker run -d --name ${MINIO_NAME} --label openlaw-docs-owner=${PREFIX} --network ${p.project}_openlaw-backend --network-alias lc-minio -p 127.0.0.1:${MINIO_PORT}:9000 -e MINIO_ROOT_USER=doc029diagnose -e MINIO_ROOT_PASSWORD=${minioSecret} minio/minio:RELEASE.2025-09-07T16-13-09Z server /data`,
          root,
        );
      await sleep(5000);
      const s3 = require(
        path.join(
          root,
          "node_modules/.pnpm/@aws-sdk+client-s3@3.1133.0/node_modules/@aws-sdk/client-s3",
        ),
      );
      const client = new s3.S3Client({
        endpoint: `http://127.0.0.1:${MINIO_PORT}`,
        region: "us-east-1",
        forcePathStyle: true,
        credentials: { accessKeyId: "doc029diagnose", secretAccessKey: minioSecret },
      });
      await client.send(new s3.CreateBucketCommand({ Bucket: "doc029-diagnose" })).catch((e) => {
        if (!/BucketAlready/.test(e.name)) throw e;
      });
      for (const [k, v] of [
        ["STORAGE_DRIVER", "s3"],
        ["S3_BUCKET", "doc029-diagnose"],
        ["S3_ENDPOINT", "http://lc-minio:9000"],
        ["S3_ACCESS_KEY_ID", "doc029diagnose"],
        ["S3_SECRET_ACCESS_KEY", minioSecret],
        ["S3_REGION", "us-east-1"],
        ["S3_FORCE_PATH_STYLE", "true"],
      ])
        envSet(p, k, v);
      recreate(p);
      await waitReady(p);
      adminApis.clear();
      const api = await adminApi(p);
      const c = state.inventory.contracts[1];
      const body = Buffer.from(`DOC-029 operator-lifecycle object-store file ${Date.now()}\n`);
      const doc = (
        await api.upload(
          `/api/v1/contracts/${c.number}/documents`,
          "doc029-diagnose-s3.txt",
          body,
          "text/plain",
        )
      ).document;
      const v = doc.versions[0];
      const key = psq(p, `select file_ref from document_versions where id='${v.id}'`);
      const got = await api.sha(`/api/v1/documents/${doc.id}/versions/${v.id}/download`);
      const sha = createHash("sha256").update(body).digest("hex");
      check(
        key.startsWith("s3:") && got.sha256 === sha,
        `key ${key.split(":")[0]}, sha ${got.status}`,
      );
      state.s3Doc = { id: doc.id, versionId: v.id, sha256: sha, contract: c.number };
      saveState();
      return `write driver s3; new Version stored under ${key.split(":")[0]}:; download hash matches`;
    },
  );
  await step(
    {
      scenario: S,
      article: T,
      action:
        "Storage: wrong S3 endpoint; app ready; Document listed but its download fails; local Documents intact; correct and verify bytes",
      critical: false,
    },
    async () => {
      envSet(p, "S3_ENDPOINT", "http://lc-no-such-minio:9000");
      recreate(p);
      const ready = await waitReady(p, 180_000)
        .then(() => 200)
        .catch((e) => e.message.slice(0, 120));
      adminApis.clear();
      let api = await adminApi(p);
      const s3got = await api.sha(
        `/api/v1/documents/${state.s3Doc.id}/versions/${state.s3Doc.versionId}/download`,
      );
      const d = state.inventory.documents[0];
      const localGot = await api.sha(
        `/api/v1/documents/${d.id}/versions/${d.versions[0].id}/download`,
      );
      const listed = (
        await api.get(`/api/v1/contracts/${state.s3Doc.contract}/documents`)
      ).documents.some((x) => x.id === state.s3Doc.id);
      envSet(p, "S3_ENDPOINT", "http://lc-minio:9000");
      recreate(p);
      await waitReady(p);
      adminApis.clear();
      api = await adminApi(p);
      const s3after = await api.sha(
        `/api/v1/documents/${state.s3Doc.id}/versions/${state.s3Doc.versionId}/download`,
      );
      check(
        ready === 200 &&
          s3got.status !== 200 &&
          listed &&
          localGot.sha256 === d.versions[0].sha256 &&
          s3after.sha256 === state.s3Doc.sha256,
        JSON.stringify({
          ready,
          s3: s3got.status,
          local: localGot.status,
          s3after: s3after.status,
        }),
      );
      return {
        readyzWithWrongEndpoint: ready,
        documentListed: listed,
        s3Download: s3got.status,
        localDownloadHashMatches: true,
        afterCorrection: "s3 download hash matches",
      };
    },
  );
  await step(
    {
      scenario: S,
      article: T,
      action:
        "Storage: the bucket must already exist; a missing bucket leaves the app ready and fails the upload; restore",
      critical: false,
    },
    async () => {
      envSet(p, "S3_BUCKET", "doc029-diagnose-missing");
      recreate(p);
      const ready = await waitReady(p, 180_000)
        .then(() => 200)
        .catch((e) => e.message.slice(0, 120));
      adminApis.clear();
      let api = await adminApi(p);
      const c = state.inventory.contracts[1];
      const form = new FormData();
      form.append(
        "file",
        new File(
          [Buffer.from("DOC-029 operator-lifecycle missing bucket\n")],
          "doc029-diagnose-missing-bucket.txt",
          { type: "text/plain" },
        ),
      );
      const up = await api.raw("POST", `/api/v1/contracts/${c.number}/documents`, { form });
      envSet(p, "S3_BUCKET", "doc029-diagnose");
      recreate(p);
      await waitReady(p);
      adminApis.clear();
      api = await adminApi(p);
      const s3after = await api.sha(
        `/api/v1/documents/${state.s3Doc.id}/versions/${state.s3Doc.versionId}/download`,
      );
      check(
        ready === 200 && up.status >= 400 && s3after.sha256 === state.s3Doc.sha256,
        JSON.stringify({ ready, up: up.status, after: s3after.status }),
      );
      return {
        readyzWithMissingBucket: ready,
        upload: `${up.status} ${up.body?.detail ?? up.body?.title ?? ""}`.slice(0, 160),
        afterRestore: "bucket restored; s3 download hash matches",
      };
    },
  );
  await step(
    {
      scenario: S,
      article: T,
      action: "Upload too large: MAX_UPLOAD_MB=1; test above and below; restore",
      critical: false,
    },
    async () => {
      envSet(p, "MAX_UPLOAD_MB", "1");
      recreate(p);
      await waitReady(p);
      adminApis.clear();
      const api = await adminApi(p);
      const c = state.inventory.contracts[1];
      const file = (n, fill, name) => {
        const f = new FormData();
        f.append("file", new File([Buffer.alloc(n, fill)], name, { type: "text/plain" }));
        return f;
      };
      const big = await api.raw("POST", `/api/v1/contracts/${c.number}/documents`, {
        form: file(1_100_000, 97, "doc029-diagnose-big.txt"),
      });
      const small = await api.raw("POST", `/api/v1/contracts/${c.number}/documents`, {
        form: file(900_000, 98, "doc029-diagnose-small.txt"),
      });
      envSet(p, "MAX_UPLOAD_MB", null);
      recreate(p);
      await waitReady(p);
      check(big.status === 413 && small.status === 201, `big ${big.status}, small ${small.status}`);
      return {
        over: `${big.status} ${big.body?.detail ?? ""}`,
        under: small.status,
        restored: "MAX_UPLOAD_MB removed; readyz 200",
      };
    },
  );
};

// ---------------------------------------------------------------- Worker and document processing

phases["diag-worker"] = async () => {
  const p = P;
  const c = state.inventory.contracts[1];
  await step(
    {
      scenario: S,
      article: T,
      action:
        "Worker stopped: the two commands; new upload stays pending; original downloadable; resume; new fictional Document processed",
      command:
        "docker compose ps worker doc-engine; docker compose logs --since=10m worker doc-engine",
      critical: false,
    },
    async () => {
      must("docker compose stop worker", p.dir, { timeout: 120_000 });
      const ps = sh("docker compose ps worker doc-engine", p.dir);
      const psRows = ps.stdout
        .split("\n")
        .slice(1)
        .filter(Boolean)
        .map((l) => l.replace(/\s+/g, " ").slice(0, 120));
      const logs = sh("docker compose logs --since=10m worker doc-engine", p.dir);
      adminApis.clear();
      const api = await adminApi(p);
      const body = pdf([
        "DOC-029 operator-lifecycle worker-stopped upload.",
        "Processing resumes after the worker returns.",
      ]);
      const doc = (
        await api.upload(
          `/api/v1/contracts/${c.number}/documents`,
          "doc029-diagnose-worker.pdf",
          body,
          "application/pdf",
        )
      ).document;
      const v = doc.versions[0];
      await sleep(20_000);
      const pending = await textState(api, doc.id, v.id);
      const got = await api.sha(`/api/v1/documents/${doc.id}/versions/${v.id}/download`);
      must("docker compose start worker", p.dir);
      const text = await waitText(api, doc.id, v.id, 300_000);
      check(
        ps.code === 0 &&
          logs.code === 0 &&
          pending === "pending" &&
          got.sha256 === createHash("sha256").update(body).digest("hex") &&
          text.state === "ready",
        `ps ${ps.code}, logs ${logs.code}, pending ${pending}, download ${got.status}, after ${text.state}`,
      );
      return {
        psRows,
        workerListed: psRows.some((l) => /worker/.test(l)),
        logsExit: logs.code,
        stateWhileStopped: pending,
        originalDownload: "hash matches",
        afterResume: text.state,
      };
    },
  );
  await step(
    {
      scenario: S,
      article: T,
      action:
        "Engine down: a PDF reaches failed while the API stays ready; original downloadable; restore engine; a new controlled PDF is processed; earlier failure not retried",
      critical: false,
    },
    async () => {
      must("docker compose stop doc-engine", p.dir);
      const api = await adminApi(p);
      const body = pdf([
        "DOC-029 operator-lifecycle engine-down upload.",
        "This one is expected to fail.",
      ]);
      const doc = (
        await api.upload(
          `/api/v1/contracts/${c.number}/documents`,
          "doc029-diagnose-engine-down.pdf",
          body,
          "application/pdf",
        )
      ).document;
      const v = doc.versions[0];
      const t0 = Date.now();
      const failed = await waitText(api, doc.id, v.id, 600_000, ["failed"]);
      const ready = await http(`${p.base}/readyz`);
      const got = await api.sha(`/api/v1/documents/${doc.id}/versions/${v.id}/download`);
      const workerErr = lines(
        sh("docker compose logs --since=10m worker", p.dir).stdout,
        /doc-engine|engine|ECONNREFUSED|ENOTFOUND|fetch failed/i,
        2,
      );
      must("docker compose start doc-engine", p.dir);
      await sleep(15_000);
      const body2 = pdf([
        "DOC-029 operator-lifecycle engine-restored upload.",
        "Processing after the engine returns.",
      ]);
      const doc2 = (
        await (
          await adminApi(p)
        ).upload(
          `/api/v1/contracts/${c.number}/documents`,
          "doc029-diagnose-engine-back.pdf",
          body2,
          "application/pdf",
        )
      ).document;
      const text2 = await waitText(api, doc2.id, doc2.versions[0].id, 300_000);
      await sleep(30_000);
      const stillFailed = await textState(api, doc.id, v.id);
      check(
        failed.state === "failed" &&
          ready.status === 200 &&
          got.sha256 === createHash("sha256").update(body).digest("hex") &&
          text2.state === "ready",
        JSON.stringify({
          failed: failed.state,
          ready: ready.status,
          dl: got.status,
          text2: text2.state,
        }),
      );
      return {
        failedAfterSeconds: Math.round((Date.now() - t0) / 1000),
        readyzWhileEngineDown: ready.status,
        originalDownloadHashMatches: true,
        workerLogLines: workerErr,
        newPdfAfterRestore: text2.state,
        earlierFailedRecord45sAfterRestore: stillFailed,
      };
    },
  );
};

// ---------------------------------------------------------------- External providers (controls only; no provider access)

phases["diag-providers"] = async () => {
  const p = P;
  await step(
    {
      scenario: S,
      article: T,
      role: "administrator",
      method: "browser-walkthrough",
      action:
        "Signing updates: Polling and Webhook options and their hints; Analysis settings offer a connection test",
      critical: false,
    },
    async () => {
      const s = await browserSignIn(p, state.people.admin.email, secrets.fixture.admin);
      const out = {};
      await s.page.goto(`${p.base}/settings/integrations/e-signature`, {
        waitUntil: "networkidle",
      });
      const provider = s.page.getByRole("button", { name: "DocuSign" });
      if (await provider.isVisible({ timeout: 10_000 }).catch(() => false)) await provider.click();
      const select = s.page.getByLabel("Signing updates");
      await select.waitFor({ timeout: 15_000 });
      out.options = await s.page.locator("#ds-update-mode option").allInnerTexts();
      await select.selectOption("polling");
      out.pollingHint = (await s.page.locator("#ds-update-mode-hint").innerText()).slice(0, 220);
      await select.selectOption("webhook");
      out.webhookHint = (await s.page.locator("#ds-update-mode-hint").innerText()).slice(0, 220);
      await s.page.screenshot({ path: path.join(here, "r2-signing-updates-webhook-hint.png") });
      await s.page.goto(`${p.base}/settings/ai-analysis`, { waitUntil: "networkidle" });
      await s.page
        .getByRole("button", { name: "Provider", exact: true })
        .first()
        .click()
        .catch(() => {});
      out.aiTestConnection = await s.page
        .getByRole("button", { name: "Test connection" })
        .first()
        .waitFor({ timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      if (!out.aiTestConnection)
        out.aiPageText = (
          await s.page
            .locator("main")
            .innerText()
            .catch(() => "")
        )
          .replace(/\s+/g, " ")
          .slice(0, 400);
      await s.context.close();
      check(
        out.options.includes("Polling") &&
          out.options.includes("Webhook") &&
          /outbound/i.test(out.pollingHint) &&
          /public/i.test(out.webhookHint) &&
          /Connect/.test(out.webhookHint) &&
          out.aiTestConnection,
        JSON.stringify(out),
      );
      out.nothingSaved = "the selection was not saved";
      return out;
    },
  );
};

// ---------------------------------------------------------------- Proxy origin and live updates

function nginxConf(buffered) {
  return [
    "events {}",
    "http {",
    "  server {",
    "    listen 80;",
    "    location / {",
    "      proxy_pass http://app:3000;",
    "      proxy_http_version 1.1;",
    "      proxy_set_header Host $http_host;",
    "      proxy_set_header X-Forwarded-Proto $scheme;",
    "      proxy_set_header X-Forwarded-For $remote_addr;",
    '      proxy_set_header Connection "";',
    "      proxy_read_timeout 3600s;",
    ...(buffered
      ? [
          "      proxy_buffering on;",
          "      proxy_ignore_headers X-Accel-Buffering;",
          "      proxy_buffer_size 64k;",
          "      proxy_buffers 8 64k;",
          "      proxy_busy_buffers_size 128k;",
          "      gzip on;",
          "      gzip_proxied any;",
          "      gzip_types text/event-stream;",
          "      gzip_min_length 0;",
          '      proxy_set_header Accept-Encoding "";',
        ]
      : ["      proxy_buffering off;"]),
    "    }",
    "  }",
    "}",
    "",
  ].join("\n");
}
function proxyUp(buffered) {
  const conf = path.join(LC, "nginx.conf");
  writeFileSync(conf, nginxConf(buffered), { mode: 0o644 });
  sh(`docker rm -f ${PROXY_NAME}`, root);
  must(
    `docker run -d --name ${PROXY_NAME} --label openlaw-docs-owner=${PREFIX} --network ${P.project}_openlaw-backend -p 127.0.0.1:${PROXY_PORT}:80 -v ${conf}:/etc/nginx/nginx.conf:ro nginx:1.27-alpine`,
    root,
  );
}
async function liveUpdateCheck(proxyBase, contract, waitMs) {
  const b = await chromium();
  const pa = { base: proxyBase };
  const first = await browserSignIn(pa, state.people.admin.email, secrets.fixture.admin);
  const second = await browserSignIn(pa, state.people.reader.email, secrets.fixture.reader);
  await first.page.goto(`${proxyBase}/contracts/${contract.number}`, { waitUntil: "networkidle" });
  await first.page.evaluate((id) => {
    window.__doc029 = { frames: [], opened: false };
    const es = new EventSource(`/api/events?entityType=contract&entityId=${id}`);
    es.onopen = () => {
      window.__doc029.opened = true;
    };
    es.addEventListener("record", (e) =>
      window.__doc029.frames.push({ at: Date.now(), data: e.data }),
    );
  }, contract.id);
  await sleep(3000);
  const body = `DOC-029 operator-lifecycle live update check ${Date.now()}`;
  const sentAt = Date.now();
  const posted = await second.request("POST", "/api/v1/comments", {
    entityType: "contract",
    entityId: contract.id,
    body,
    visibility: "working_team",
  });
  const deadline = Date.now() + waitMs;
  let frames = [];
  while (Date.now() < deadline) {
    frames = await first.page.evaluate(() => window.__doc029.frames);
    if (frames.some((f) => f.data.includes("comment.posted"))) break;
    await sleep(500);
  }
  const opened = await first.page.evaluate(() => window.__doc029.opened);
  const hit = frames.find((f) => f.data.includes("comment.posted"));
  const result = {
    secondPersonRole: second.role,
    commentPost: posted.status,
    streamOpened: opened,
    frameArrivedAfterMs: hit ? hit.at - sentAt : null,
    waitedMs: waitMs,
  };
  await first.context.close();
  await second.context.close();
  void b;
  return result;
}

phases["diag-proxy"] = async () => {
  const p = P;
  const proxyBase = `http://127.0.0.1:${PROXY_PORT}`;
  await step(
    {
      scenario: S,
      article: T,
      action: "Sign-in behind the proxy fails while BASE_URL names a different origin",
      critical: false,
    },
    async () => {
      proxyUp(false);
      await waitReady({ base: proxyBase }, 60_000);
      const api = new Api(proxyBase);
      const r = await api.raw("POST", "/api/auth/sign-in/email", {
        json: { email: state.people.admin.email, password: secrets.fixture.admin },
      });
      check(
        r.status !== 200,
        `sign-in through the proxy answered ${r.status} while BASE_URL is ${p.base}`,
      );
      return {
        baseUrl: p.base,
        proxyOrigin: proxyBase,
        signInThroughProxy: `${r.status} ${JSON.stringify(r.body)?.slice(0, 120)}`,
      };
    },
  );
  await step(
    {
      scenario: S,
      article: T,
      action:
        "Correct BASE_URL to the proxy origin, recreate app and worker; sign-in and a newly issued link through the public address work",
      critical: false,
    },
    async () => {
      envSet(p, "BASE_URL", proxyBase);
      recreate(p);
      await waitReady({ base: proxyBase });
      const api = new Api(proxyBase);
      await api.signIn(state.people.admin.email, secrets.fixture.admin);
      const email = `nadia.proxy.${Date.now()}@lifecycle.example`;
      const since = Date.now();
      await api.post("/api/v1/auth/invites", {
        email,
        displayName: "DOC-029 operator-lifecycle Nadia Proxy",
        role: "legal_team_member",
      });
      const message = await waitMail(
        (m) => toAddress(m, email) && Date.parse(m.Created) >= since - 2000,
      );
      check(message, "no invitation delivered");
      const link = (await mailText(message.ID)).match(/https?:\/\/[^\s)>]+/)?.[0] ?? "";
      const token = link.match(/token=([A-Za-z0-9._-]+)/)?.[1];
      const pw = randomBytes(12).toString("base64url");
      const reset = await new Api(proxyBase).raw("POST", "/api/auth/reset-password", {
        json: { newPassword: pw, token },
      });
      const invited = new Api(proxyBase);
      await invited.signIn(email, pw);
      const me = await invited.raw("GET", "/api/v1/me");
      check(
        link.startsWith(`${proxyBase}/`) && reset.status === 200 && me.status === 200,
        JSON.stringify({ origin: link.slice(0, 30), reset: reset.status, me: me.status }),
      );
      return {
        adminSignInThroughProxy: 200,
        invitationLinkOrigin: new URL(link).origin,
        invitationAccepted: reset.status,
        invitedSignIn: me.status,
        invitedRole: me.body?.user?.role,
      };
    },
  );
  const contract = state.inventory.contracts[0];
  await step(
    {
      scenario: S,
      article: T,
      role: "administrator",
      method: "browser-walkthrough",
      action:
        "Live updates: a buffering proxy holds back the event stream; a change from a second signed-in browser does not arrive",
      critical: false,
    },
    async () => {
      proxyUp(true);
      await waitReady({ base: proxyBase }, 60_000);
      const r = await liveUpdateCheck(proxyBase, contract, 20_000);
      check(r.commentPost === 201 && r.frameArrivedAfterMs === null, JSON.stringify(r));
      return r;
    },
  );
  await step(
    {
      scenario: S,
      article: T,
      role: "administrator",
      method: "browser-walkthrough",
      action:
        "Live updates: allow the stream to stay open without buffering; a change from a second signed-in browser arrives",
      critical: false,
    },
    async () => {
      proxyUp(false);
      await waitReady({ base: proxyBase }, 60_000);
      const r = await liveUpdateCheck(proxyBase, contract, 20_000);
      check(
        r.commentPost === 201 && r.frameArrivedAfterMs !== null && r.frameArrivedAfterMs < 10_000,
        JSON.stringify(r),
      );
      return r;
    },
  );
  await step(
    { scenario: "setup", action: "Return BASE_URL to the direct origin and remove the proxy" },
    async () => {
      envSet(p, "BASE_URL", p.base);
      recreate(p);
      await waitReady(p);
      sh(`docker rm -f ${PROXY_NAME}`, root);
      adminApis.clear();
      return "BASE_URL restored; readyz 200";
    },
  );
};

// ---------------------------------------------------------------- negative: logs

phases["diag-live-retry"] = async () => {
  const p = P;
  const proxyBase = `http://127.0.0.1:${PROXY_PORT}`;
  const contract = state.inventory.contracts[0];
  await step(
    { scenario: "setup", action: "Retry setup: BASE_URL at the proxy origin again" },
    async () => {
      envSet(p, "BASE_URL", proxyBase);
      recreate(p);
      proxyUp(true);
      await waitReady({ base: proxyBase });
      return "BASE_URL at the proxy; proxy restarted with buffering and gzip of the event stream";
    },
  );
  await step(
    {
      scenario: S,
      article: T,
      role: "administrator",
      method: "browser-walkthrough",
      action:
        "Live updates (retry 1): a proxy that buffers and compresses the event stream; a change from a second signed-in browser does not arrive",
      critical: false,
    },
    async () => {
      const r = await liveUpdateCheck(proxyBase, contract, 20_000);
      check(r.commentPost === 201 && r.frameArrivedAfterMs === null, JSON.stringify(r));
      return r;
    },
  );
  await step(
    {
      scenario: S,
      article: T,
      role: "administrator",
      method: "browser-walkthrough",
      action:
        "Live updates (retry 1): allow the stream to stay open without buffering; a change from a second signed-in browser arrives",
      critical: false,
    },
    async () => {
      proxyUp(false);
      await waitReady({ base: proxyBase }, 60_000);
      const r = await liveUpdateCheck(proxyBase, contract, 20_000);
      check(
        r.commentPost === 201 && r.frameArrivedAfterMs !== null && r.frameArrivedAfterMs < 10_000,
        JSON.stringify(r),
      );
      return r;
    },
  );
  await step(
    { scenario: "setup", action: "Return BASE_URL to the direct origin and remove the proxy" },
    async () => {
      envSet(p, "BASE_URL", p.base);
      recreate(p);
      await waitReady(p);
      sh(`docker rm -f ${PROXY_NAME}`, root);
      return "BASE_URL restored; readyz 200";
    },
  );
};

phases["diag-log-scan"] = async () => {
  await step(
    {
      scenario: S,
      article: T,
      action:
        "Negative: container logs after every induced fault omit keys, relay and storage credentials, and fixture passwords",
      critical: false,
    },
    () => {
      const values = secretValues().filter((v) => !/^short-/.test(v));
      const logs = sh("docker compose logs --no-log-prefix app worker doc-engine postgres", P.dir, {
        timeout: 120_000,
      }).stdout;
      const hits = values.filter((v) => logs.includes(v)).length;
      const relayUrl = /smtps?:\/\/[^\s"]*:[^\s"@]+@/.test(logs);
      check(
        values.length > 0 && hits === 0 && !relayUrl,
        `${hits} secret values in logs; relay URL with credentials ${relayUrl}`,
      );
      return {
        logLines: logs.split("\n").length,
        secretValuesChecked: values.length,
        hits,
        relayUrlWithCredentials: relayUrl,
      };
    },
  );
};

phases["destroy"] = async () => {
  await step(
    {
      scenario: "teardown",
      action: "Destroy the owned project, support containers, networks and private backups",
    },
    () => {
      const out = [];
      if (existsSync(path.join(P.dir, ".env")))
        out.push(
          `${P.project} down -v exit ${sh(`docker compose -p ${P.project} down -v --remove-orphans`, P.dir, { timeout: 300_000 }).code}`,
        );
      for (const c of [MAIL_NAME, MINIO_NAME, OCCUPIER_NAME, PROXY_NAME])
        out.push(`${c} rm exit ${sh(`docker rm -f ${c}`, root).code}`);
      for (const n of ["openlaw-backend", "openlaw-doc-engine"]) {
        const name = `${P.project}_${n}`;
        if (sh(`docker network inspect ${name}`, root).code === 0)
          out.push(`${name} rm exit ${sh(`docker network rm ${name}`, root).code}`);
      }
      const left = sh(
        `docker ps -a --format '{{.Names}}' | grep -c '^${PREFIX}-' || true`,
        root,
      ).stdout.trim();
      out.push(`remaining containers with prefix: ${left}`);
      return out.join("; ");
    },
  );
};

// ---------------------------------------------------------------- main

const phase = process.argv[2];
if (!phases[phase]) {
  console.error(`Usage: walkthrough-r2.mjs ${Object.keys(phases).join("|")}`);
  process.exit(2);
}
currentPhase = phase;
const phaseEntry = { phase, startedAt: new Date().toISOString(), finishedAt: null, failures: 0 };
log.phases.push(phaseEntry);
try {
  await phases[phase]();
} catch (error) {
  console.error(redact(error?.stack ?? error));
  phaseEntry.error = redact(error?.message ?? String(error)).slice(0, 800);
} finally {
  phaseEntry.finishedAt = new Date().toISOString();
  phaseEntry.failures = failures;
  saveLog();
  if (browser) await browser.close();
}
process.exit(failures || phaseEntry.error ? 1 : 0);
