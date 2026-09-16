// DOC-029 operator-lifecycle, round 1: independent container-operation walkthrough
// for the upgrade (V-C46), backup-and-restore (V-C47) and operator-troubleshooting
// (V-C48) articles on candidate 3fa407e3.
//
// Written by the DOC-029 independent walkthrough agent (operator-lifecycle, round 1).
// It follows the article commands in private installation directories under
// ~/.cache/openlaw-docs-lc and appends observations to walkthrough-r1.json.
//
// Run one phase at a time from the repository root:
//   mise exec -- node docs/documentation/batches/DOC-029/operator-lifecycle/walkthrough-r1.mjs <phase>
//
// Keys, fixture passwords and mail tokens stay in ~/.cache/openlaw-docs-lc
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
const LC = path.join(HOME, ".cache/openlaw-docs-lc");
const LOG = path.join(here, "walkthrough-r1.json");
const STATE = path.join(LC, "state.json");
const SECRETS = path.join(LC, "secret-store.json");
const PREFIX = "openlaw-docs-41255c61-lc";
const BASELINE = "d1d098ba9f4ba6557a542857d530446b76b1847c";
const CANDIDATE = "3fa407e3a846559914aa1a63249741f30cfb4f69";
const MAIL_NAME = `${PREFIX}-mail`;
const MAIL_UI = "http://127.0.0.1:23335";
const MINIO_NAME = `${PREFIX}-minio`;
const MINIO_PORT = 23336;

const PROJECTS = {
  upgrade: {
    project: `${PREFIX}-upgrade`,
    port: 23330,
    subnets: ["10.239.30.0/24", "10.239.31.0/24"],
  },
  recovery: {
    project: `${PREFIX}-recovery`,
    port: 23331,
    subnets: ["10.239.32.0/24", "10.239.33.0/24"],
  },
  restore: {
    project: `${PREFIX}-restore`,
    port: 23332,
    subnets: ["10.239.34.0/24", "10.239.35.0/24"],
  },
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
  batch: "DOC-029",
  group: "operator-lifecycle",
  round: 1,
  reviewer: "DOC-029 independent walkthrough agent (operator-lifecycle, round 1)",
  reviewerKind: "agent",
  method: "container-operation",
  candidate: CANDIDATE,
  baseline: BASELINE,
  script: "docs/documentation/batches/DOC-029/operator-lifecycle/walkthrough-r1.mjs",
  labProjects: Object.values(PROJECTS).map((p) => p.project),
  supportContainers: [MAIL_NAME, MINIO_NAME],
  articles: {},
  images: {},
  phases: [],
  steps: [],
});
for (const id of ["upgrade", "backup-and-restore", "operator-troubleshooting"]) {
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

phases["support-up"] = async () => {
  await step(
    {
      scenario: "setup",
      action: "Create project networks with explicit subnets (host address pools are exhausted)",
    },
    () => {
      const made = Object.values(PROJECTS).flatMap((p) => ensureNetworks(p));
      return `created ${made.length} networks: ${made.join(", ")}`;
    },
  );
  await step(
    { scenario: "setup", action: "Start an owned Mailpit relay for controlled recipients" },
    () => {
      if (sh(`docker inspect ${MAIL_NAME}`, root).code !== 0)
        must(
          `docker run -d --name ${MAIL_NAME} --label openlaw-docs-owner=${PREFIX} --network ${PROJECTS.upgrade.project}_openlaw-backend --network-alias lc-mail -p 127.0.0.1:23335:8025 axllent/mailpit:v1.30 --smtp-auth-accept-any --smtp-auth-allow-insecure`,
          root,
        );
      return `Mailpit ${MAIL_NAME} on ${PROJECTS.upgrade.project}_openlaw-backend as lc-mail, UI 127.0.0.1:23335`;
    },
  );
};

phases["baseline-install"] = async () => {
  const p = PROJECTS.upgrade;
  await step(
    {
      scenario: "V-C46",
      article: "install",
      action: "Clone and select the starting build",
      critical: true,
    },
    () => cloneAndCheckout(p, BASELINE).join("; "),
  );
  await step(
    {
      scenario: "V-C46",
      article: "install",
      action: "Write .env and compose.operator.yml per the installation guide",
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
      scenario: "V-C46",
      article: "install",
      action: "Build and start the starting build",
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
  const p = PROJECTS.upgrade;
  const pw = secrets.fixture ?? {
    admin: randomBytes(12).toString("base64url"),
    reader: randomBytes(12).toString("base64url"),
    contributor: randomBytes(12).toString("base64url"),
    relay: randomBytes(9).toString("base64url"),
  };
  secrets.fixture = pw;
  saveSecrets();
  const people = {
    admin: { email: "morgan.baseline@lifecycle.example", displayName: "DOC-029 Morgan Baseline" },
    reader: {
      email: "rowan.reader@lifecycle.example",
      displayName: "DOC-029 Rowan Reader",
      role: "legal_team_member",
    },
    contributor: {
      email: "casey.contributor@lifecycle.example",
      displayName: "DOC-029 Casey Contributor",
      role: "contributor",
    },
  };
  const api = new Api(p.base);
  const inventory = {
    people: {},
    contracts: [],
    matters: [],
    entity: null,
    field: null,
    documents: [],
  };
  state.people = people;
  state.inventory = inventory;

  await step(
    {
      scenario: "V-C46",
      method: "automated-test",
      action: "Fixture: create the first Administrator and save an encrypted SMTP relay",
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
        smtpFrom: "DOC-029 Lifecycle <openlaw@lifecycle.example>",
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
      return `Administrator ${me.role}; saved relay source ${(await api.get("/api/v1/email-settings")).source}; test email delivered to the controlled recipient`;
    },
  );

  await step(
    {
      scenario: "V-C46",
      method: "automated-test",
      action: "Fixture: invite and activate a Legal Team Member and a Contributor",
      critical: true,
    },
    async () => {
      const out = [];
      for (const key of ["reader", "contributor"]) {
        const person = people[key];
        const since = Date.now();
        const created = await api.post("/api/v1/auth/invites", {
          email: person.email,
          displayName: person.displayName,
          role: person.role,
        });
        const message = await waitMail(
          (m) => toAddress(m, person.email) && Date.parse(m.Created) >= since - 2000,
        );
        check(message, `no invitation for ${key}`);
        const token = (await mailText(message.ID)).match(/token=([A-Za-z0-9._-]+)/)?.[1];
        check(token, "invitation has no token");
        const anon = new Api(p.base);
        await anon.post("/api/auth/reset-password", { newPassword: pw[key], token });
        const session = new Api(p.base);
        await session.signIn(person.email, pw[key]);
        const me = (await session.get("/api/v1/me")).user;
        inventory.people[key] = { email: person.email, role: me.role, id: created.user.id };
        out.push(`${key} ${me.role} activated`);
      }
      return out.join("; ");
    },
  );

  await step(
    {
      scenario: "V-C46",
      method: "automated-test",
      action:
        "Fixture: Entity, custom Contract Field, three Contracts (one Confidential), a Matter",
      critical: true,
    },
    async () => {
      const entityTypes = (await api.get("/api/v1/entity-types")).entityTypes;
      const entity = (
        await api.post("/api/v1/entities", {
          legalName: "DOC-029 lifecycle Holdings Ltd",
          entityTypeId: entityTypes[0].id,
          jurisdiction: "England and Wales",
          status: "active",
        })
      ).entity;
      inventory.entity = { id: entity.id, legalName: entity.legalName };
      const contractTypes = (await api.get("/api/v1/contract-types")).contractTypes;
      const type = contractTypes[0];
      const field = (
        await api.post("/api/v1/fields", {
          displayName: "DOC-029 lifecycle reference",
          moduleScope: "contract",
          fieldType: "text",
          fieldTag: "business",
        })
      ).field;
      await api.post(`/api/v1/contract-types/${type.id}/fields`, {
        fieldId: field.id,
        isRequired: false,
      });
      inventory.field = { slug: field.slug, displayName: field.displayName };
      for (const [title, confidential] of [
        ["DOC-029 lifecycle supply agreement", false],
        ["DOC-029 lifecycle services agreement", false],
        ["DOC-029 lifecycle confidential settlement", true],
      ]) {
        const created = (
          await api.post("/api/v1/contracts", {
            title,
            contractTypeId: type.id,
            isConfidential: confidential,
          })
        ).contract;
        const updated = (
          await api.patch(`/api/v1/contracts/${created.number}`, {
            entityId: entity.id,
            customFields: { [field.slug]: `ref-${created.number}` },
            isConfidential: confidential,
          })
        ).contract;
        inventory.contracts.push({
          number: updated.number,
          id: updated.id,
          title: updated.title,
          isConfidential: updated.isConfidential,
          entity: updated.entity?.legalName ?? null,
          customFields: updated.customFields,
        });
      }
      const matterTypes = (await api.get("/api/v1/matter-types")).matterTypes;
      const matter = (
        await api.post("/api/v1/matters", {
          title: "DOC-029 lifecycle regulatory advice",
          matterTypeId: matterTypes[0].id,
        })
      ).matter;
      inventory.matters.push({ number: matter.number, id: matter.id, title: matter.title });
      return {
        contracts: inventory.contracts.map(
          (c) =>
            `${c.number} confidential=${c.isConfidential} field=${c.customFields?.[field.slug]}`,
        ),
        matter: matter.number,
        entity: entity.legalName,
      };
    },
  );

  await step(
    {
      scenario: "V-C46",
      method: "automated-test",
      action:
        "Fixture: two Documents with original and later Versions (one a PDF), and Contributor membership",
      critical: true,
    },
    async () => {
      const [first, , confidential] = inventory.contracts;
      const d1 = (
        await api.upload(
          `/api/v1/contracts/${first.number}/documents`,
          "doc029-lifecycle-draft.txt",
          Buffer.from("DOC-029 lifecycle draft, original version.\n"),
          "text/plain",
        )
      ).document;
      await api.upload(
        `/api/v1/documents/${d1.id}/versions`,
        "doc029-lifecycle-draft-v2.txt",
        Buffer.from("DOC-029 lifecycle draft, later version.\n"),
        "text/plain",
      );
      const d2 = (
        await api.upload(
          `/api/v1/contracts/${confidential.number}/documents`,
          "doc029-lifecycle-settlement.pdf",
          pdf([
            "DOC-029 lifecycle settlement, original.",
            "The parties settle the lifecycle claim.",
          ]),
          "application/pdf",
        )
      ).document;
      await api.upload(
        `/api/v1/documents/${d2.id}/versions`,
        "doc029-lifecycle-settlement-v2.pdf",
        pdf([
          "DOC-029 lifecycle settlement, later.",
          "The parties settle the lifecycle claim in full.",
        ]),
        "application/pdf",
      );
      for (const [contract, doc] of [
        [first, d1],
        [confidential, d2],
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
            recordedChecksum: v.checksumSha256,
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
      await api.post(
        `/api/v1/contracts/${first.number}/team`,
        { userId: inventory.people.contributor.id, role: "contributor" },
        { accept: [201] },
      );
      return inventory.documents.map(
        (d) =>
          `${d.title}: ${d.versions.map((v) => `v${v.versionNumber} ${v.sha256.slice(0, 12)} text=${v.textState}`).join(", ")}`,
      );
    },
  );

  await step(
    {
      scenario: "V-C46",
      method: "automated-test",
      action: "Fixture: record baseline reach for the lower-access accounts",
      critical: true,
    },
    async () => {
      const reach = {};
      for (const key of ["reader", "contributor"]) {
        const session = new Api(p.base);
        await session.signIn(people[key].email, pw[key]);
        reach[key] = {};
        for (const c of inventory.contracts)
          reach[key][c.number] = (await session.raw("GET", `/api/v1/contracts/${c.number}`)).status;
      }
      inventory.baselineReach = reach;
      const conf = inventory.contracts.find((c) => c.isConfidential).number;
      check(
        reach.reader[conf] !== 200 && reach.contributor[conf] !== 200,
        "a lower-access account reached the Confidential Contract on the baseline",
      );
      return reach;
    },
  );
  state.people = people;
  state.inventory = inventory;
  saveState();
};

// Upgrade article: Before you start, Prepare the target, and the coherent backup it calls for.
phases["upgrade"] = async () => {
  const p = PROJECTS.upgrade;
  const A = "upgrade";
  await step(
    {
      scenario: "V-C46",
      article: A,
      action:
        "Before you start: record source revision, image identities, project, file list and storage configuration",
      critical: true,
    },
    () => {
      const rev = must("git rev-parse HEAD", p.dir).stdout.trim();
      const config = JSON.parse(must("docker compose config --format json", p.dir).stdout);
      const app = config.services.app.environment;
      const record = {
        sourceRevision: rev,
        images: recordImages("upgrade-before", p).services,
        project: config.name,
        composeFile: envGet(p, "COMPOSE_FILE"),
        storage: {
          STORAGE_DRIVER: app.STORAGE_DRIVER || "(unset: local)",
          STORAGE_PATH: app.STORAGE_PATH,
          S3_BUCKET: app.S3_BUCKET || "(unset)",
        },
        keysRetained: Boolean(secrets.upgrade?.AUTH_SECRET && secrets.upgrade?.OPENLAW_SECRET_KEY),
      };
      check(rev === BASELINE, `source revision ${rev}`);
      state.upgradeBefore = { containers: containerIds(p), rev };
      saveState();
      return record;
    },
  );
  await step(
    {
      scenario: "V-C46",
      article: A,
      action: "Prepare step 1: fetch the source and inspect local changes",
      command: "git status --short; git fetch origin; git rev-parse HEAD",
      critical: true,
    },
    () => {
      const status = must("git status --short", p.dir).stdout.trim();
      must("git fetch origin", p.dir, { timeout: 300_000 });
      const head = must("git rev-parse HEAD", p.dir).stdout.trim();
      return `git status --short: ${JSON.stringify(status)}; git fetch origin exit 0; HEAD ${head}`;
    },
  );
  await step(
    {
      scenario: "V-C46",
      article: A,
      action:
        "Prepare step 2: select the target, update OPENLAW_BUILD_COMMIT, validate and build without recreating containers",
      command: `git checkout --detach ${CANDIDATE}; docker compose config --quiet; docker compose build app doc-engine`,
      critical: true,
    },
    () => {
      must(`git checkout --detach ${CANDIDATE}`, p.dir);
      envSet(p, "OPENLAW_BUILD_COMMIT", CANDIDATE);
      must("docker compose config --quiet", p.dir);
      const t0 = Date.now();
      must("docker compose build app doc-engine", p.dir, { timeout: 3_000_000 });
      const after = containerIds(p);
      const before = state.upgradeBefore.containers;
      const unchanged = before.every((b) =>
        after.some((a) => a.id === b.id && a.state === "running"),
      );
      check(unchanged, "running containers changed during the build");
      const images = JSON.parse(must("docker compose config --format json", p.dir).stdout).services;
      const appImage = images.app.image;
      const workerImage = images.worker.image;
      check(appImage === workerImage, "app and worker resolve to different images");
      const appId = inspectImage(appImage);
      const engineId = inspectImage(images["doc-engine"].image);
      log.images.candidateBuilt = {
        app: appImage,
        appId,
        engine: images["doc-engine"].image,
        engineId,
        at: new Date().toISOString(),
      };
      return `build ${Math.round((Date.now() - t0) / 1000)} s; ${before.length} containers kept their IDs and kept running on the starting images; app and worker both resolve to ${appImage} (${appId}); engine ${engineId}; postgres stays ${images.postgres.image}`;
    },
  );
  const backupDir = path.join(LC, "backups", "pre-upgrade");
  await runBackup(p, backupDir, {
    scenario: "V-C46",
    article: "backup-and-restore (called from upgrade step 3)",
    restart: false,
    pre: BASELINE,
  });
  state.preUpgradeBackup = backupDir;
  saveState();
};

// Backup article, Take a coherent backup, steps 1 to 5.
async function runBackup(p, backupDir, { scenario, article, restart, pre }) {
  const env = { BACKUP_DIR: backupDir };
  await step(
    {
      scenario,
      article,
      action: "Backup step 1: create a fresh private backup directory",
      command: 'BACKUP_DIR=...; umask 077; mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"',
      critical: true,
    },
    () => {
      check(!existsSync(backupDir), "backup directory already exists");
      must('umask 077\nmkdir -p "$BACKUP_DIR"\nchmod 700 "$BACKUP_DIR"', p.dir, { env });
      return `mode ${must(`stat -c %a "$BACKUP_DIR"`, p.dir, { env }).stdout.trim()}`;
    },
  );
  await step(
    {
      scenario,
      article,
      action: "Backup step 2: stop app and worker, keep Postgres running",
      command: "docker compose stop app worker; docker compose ps --all",
      critical: true,
    },
    () => {
      must("docker compose stop app worker", p.dir, { timeout: 180_000 });
      const rows = containerIds(p);
      const s = Object.fromEntries(rows.map((r) => [r.service, r.state]));
      check(
        s.app === "exited" && s.worker === "exited" && s.postgres === "running",
        JSON.stringify(s),
      );
      return s;
    },
  );
  await step(
    {
      scenario,
      article,
      action: "Backup step 3: dump the database, archive the file volume, record source and images",
      command:
        'pg_dump --format=custom > "$BACKUP_DIR/database.dump"; run app tar -czf - ...; git rev-parse HEAD; docker compose images --format json',
      critical: true,
    },
    () => {
      const out = [];
      for (const command of [
        'docker compose exec -T postgres pg_dump -U openlaw -d openlaw --format=custom > "$BACKUP_DIR/database.dump"',
        'docker compose run -T --rm --no-deps app tar -czf - -C /var/lib/openlaw/files . > "$BACKUP_DIR/files.tar.gz"',
        'git rev-parse HEAD > "$BACKUP_DIR/app-source.txt"',
        'docker compose images --format json > "$BACKUP_DIR/images.json"',
      ]) {
        const r = sh(umaskWrap(command), p.dir, { env, timeout: 600_000 });
        out.push(`exit ${r.code}`);
        check(r.code === 0, `${command}: ${r.stderr.slice(-400)}`);
      }
      const source = readFileSync(path.join(backupDir, "app-source.txt"), "utf8").trim();
      const images = JSON.parse(readFileSync(path.join(backupDir, "images.json"), "utf8"));
      const appImage = images.find((i) => i.ContainerName?.includes("-app-"));
      if (pre)
        writeFileSync(path.join(backupDir, "pre-upgrade-revision.txt"), `${pre}\n`, {
          mode: 0o600,
        });
      return `four commands ${out.join(", ")}; app-source.txt ${source}; images.json app ${appImage?.Repository}:${appImage?.Tag} ${appImage?.ID}${pre ? `; pre-upgrade revision ${pre} recorded beside it` : ""}; dump ${bytes(backupDir, "database.dump")} bytes, files ${bytes(backupDir, "files.tar.gz")} bytes`;
    },
  );
  await step(
    {
      scenario,
      article,
      action: "Backup step 4: list both archives and record hashes",
      command: "pg_restore --list; tar -tzf; sha256sum > SHA256SUMS",
      critical: true,
    },
    () => {
      must(
        'docker compose exec -T postgres pg_restore --list < "$BACKUP_DIR/database.dump" > "$BACKUP_DIR/database-contents.txt"',
        p.dir,
        { env },
      );
      must('tar -tzf "$BACKUP_DIR/files.tar.gz" > "$BACKUP_DIR/file-contents.txt"', p.dir, { env });
      must('(cd "$BACKUP_DIR" && sha256sum database.dump files.tar.gz > SHA256SUMS)', p.dir, {
        env,
      });
      const entries = readFileSync(path.join(backupDir, "database-contents.txt"), "utf8")
        .split("\n")
        .filter((l) => l && !l.startsWith(";")).length;
      const files = readFileSync(path.join(backupDir, "file-contents.txt"), "utf8")
        .split("\n")
        .filter((l) => l && !l.endsWith("/")).length;
      return `pg_restore --list ${entries} TOC entries; tar lists ${files} files; SHA256SUMS ${readFileSync(path.join(backupDir, "SHA256SUMS"), "utf8").trim().replace(/\s+/g, " ")}`;
    },
  );
  if (restart) {
    await step(
      {
        scenario,
        article,
        action: "Backup step 5: restart app and worker, confirm readiness and an actual operation",
        command: "docker compose up -d --no-build --pull never",
        critical: true,
      },
      async () => {
        must("docker compose up -d --no-build --pull never", p.dir);
        await waitReady(p);
        const api = await adminApi(p);
        const c = state.inventory.contracts[0];
        const read = await api.raw("GET", `/api/v1/contracts/${c.number}`);
        const doc = state.inventory.documents[0];
        const v = doc.versions[0];
        const got = await api.sha(`/api/v1/documents/${doc.id}/versions/${v.id}/download`);
        check(read.status === 200 && got.sha256 === v.sha256, "operation after pause failed");
        return `readyz 200; Contract ${c.number} read 200; Version download hash matches ${v.sha256.slice(0, 12)}`;
      },
    );
    await step(
      {
        scenario,
        article,
        action: "Copy the backup to its retained location and verify hashes there",
        critical: true,
      },
      () => {
        const retained = `${backupDir}-retained`;
        must(`umask 077; mkdir -p "${retained}"; cp -p "$BACKUP_DIR"/* "${retained}/"`, p.dir, {
          env,
        });
        const r = must(`cd "${retained}" && sha256sum --check SHA256SUMS`, p.dir);
        return `${retained.replace(HOME, "~")}: ${r.stdout.trim().replace(/\n/g, "; ")}`;
      },
    );
  }
}
function umaskWrap(command) {
  return `umask 077\n${command}`;
}
function bytes(dir, name) {
  return readFileSync(path.join(dir, name)).length;
}
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

phases["upgrade-start"] = async () => {
  const p = PROJECTS.upgrade;
  const A = "upgrade";
  await step(
    {
      scenario: "V-C46",
      article: A,
      action: "Start step 1: start the target with the retained project and volumes",
      command:
        "docker compose up -d --no-build --pull never; docker compose ps; docker compose logs --tail=100 app worker",
      critical: true,
      expected:
        "Readiness after migrations. The app log first shows 'migrations: reconciled 0090_onboarding_reviewed_types; continuing with pending migrations'.",
    },
    async () => {
      const t0 = Date.now();
      must("docker compose up -d --no-build --pull never", p.dir);
      await waitReady(p, 600_000);
      const ps = containerIds(p);
      const logs = must("docker compose logs --tail=100 app worker", p.dir).stdout;
      const full = must("docker compose logs --no-log-prefix app", p.dir).stdout;
      const migrationLines = full
        .split("\n")
        .filter((l) => /migrat/i.test(l))
        .map((l) => l.trim())
        .slice(0, 10);
      const reconciled = full
        .split("\n")
        .findIndex((l) =>
          l.includes(
            "migrations: reconciled 0090_onboarding_reviewed_types; continuing with pending migrations",
          ),
        );
      const firstMigrationLine = full.split("\n").findIndex((l) => /migrations?:/i.test(l));
      check(
        reconciled >= 0,
        `reconciled line not in app log; migration lines: ${JSON.stringify(migrationLines)}`,
      );
      check(
        reconciled === firstMigrationLine,
        `reconciled line is not the first migration line: ${JSON.stringify(migrationLines)}`,
      );
      const journal = must(
        `docker compose exec -T postgres psql -U openlaw -d openlaw -At -c "select count(*), max(created_at) from drizzle.__drizzle_migrations"`,
        p.dir,
      ).stdout.trim();
      const errors = logs.split("\n").filter((l) => /error|fatal|refus/i.test(l)).length;
      return {
        readyAfterSeconds: Math.round((Date.now() - t0) / 1000),
        ps: ps.map((r) => `${r.service} ${r.state} ${r.image}`),
        migrationLogLines: migrationLines,
        reconciledLineIsFirstMigrationLine: true,
        journalRowsAndLatest: journal,
        tail100ErrorLikeLines: errors,
        images: recordImages("upgrade-after", p).services,
      };
    },
  );
};

phases["upgrade-verify"] = async () => {
  const p = PROJECTS.upgrade;
  await verifyInstance(p, {
    scenario: "V-C46",
    article: "upgrade",
    label: "after upgrade",
    expectNewUploadAbsent: null,
  });
};

// Upgrade steps 2 to 5 / restore verification. Shared by the upgraded, recovered and restored targets.
async function verifyInstance(
  p,
  { scenario, article, label, expectAbsentDocument, apiOnly = false },
) {
  const inv = state.inventory;
  const conf = inv.contracts.find((c) => c.isConfidential);
  const sessions = {};
  await step(
    {
      scenario,
      article,
      role: "administrator",
      method: "browser-walkthrough",
      action: `${label}: Administrator signs in through the origin and sees representative records`,
      critical: true,
    },
    async () => {
      const s = await signInFor(p, state.people.admin.email, secrets.fixture.admin, apiOnly);
      sessions.admin = s;
      check(s.role === "administrator", `role ${s.role}; ${s.notes.join("; ")}`);
      const out = {
        signIn: s.how,
        landed: s.landed,
        role: s.role,
        contracts: {},
        fields: {},
        entity: null,
        matter: null,
      };
      for (const c of inv.contracts) {
        const r = await s.request("GET", `/api/v1/contracts/${c.number}`);
        check(r.status === 200, `Contract ${c.number} answered ${r.status}`);
        const row = r.body.contract;
        check(
          row.title === c.title && row.isConfidential === c.isConfidential,
          `Contract ${c.number} changed`,
        );
        check(
          row.customFields?.[inv.field.slug] === c.customFields?.[inv.field.slug],
          `Field on ${c.number}: ${JSON.stringify(row.customFields)}`,
        );
        check((row.entity?.legalName ?? null) === c.entity, `Entity on ${c.number}`);
        out.contracts[c.number] = "title, Confidential flag, Entity and Field value match";
      }
      const m = await s.request("GET", `/api/v1/matters/${inv.matters[0].number}`);
      check(
        m.status === 200 && m.body.matter.title === inv.matters[0].title,
        `Matter answered ${m.status}`,
      );
      out.matter = `${inv.matters[0].number} title matches`;
      const e = await s.request("GET", `/api/v1/entities/${inv.entity.id}`);
      check(
        e.status === 200 && e.body.entity.legalName === inv.entity.legalName,
        `Entity answered ${e.status}`,
      );
      out.entity = "legal name matches";
      if (s.page) {
        await s.page.goto(`${p.base}/contracts/${conf.number}`, { waitUntil: "networkidle" });
        const shot = path.join(here, `r1-${p.name}-admin-confidential-contract.png`);
        await s.page.getByText(conf.title).first().waitFor({ timeout: 20_000 });
        await s.page.screenshot({ path: shot });
        out.screenshot = path.relative(root, shot);
      }
      return out;
    },
  );
  await step(
    {
      scenario,
      article,
      role: "administrator",
      action: `${label}: download original and later Versions and compare hashes with the inventory`,
      critical: true,
    },
    async () => {
      const s = sessions.admin;
      const out = [];
      for (const d of inv.documents) {
        if (expectAbsentDocument && d.id === expectAbsentDocument) continue;
        for (const v of d.versions) {
          const got = await browserSha(s, `/api/v1/documents/${d.id}/versions/${v.id}/download`);
          check(
            got.sha256 === v.sha256,
            `${d.title} v${v.versionNumber}: ${got.status} ${got.sha256}`,
          );
          out.push(`${d.title} v${v.versionNumber} ${v.sha256.slice(0, 16)} match`);
        }
      }
      return out;
    },
  );
  for (const key of ["reader", "contributor"]) {
    await step(
      {
        scenario,
        article,
        role: state.inventory.people[key].role,
        method: "browser-walkthrough",
        action: `${label}: lower-access account (${key}) signs in; Confidential record outside its audience stays refused`,
        critical: false,
      },
      async () => {
        const s = await signInFor(p, state.people[key].email, secrets.fixture[key], apiOnly);
        sessions[key] = s;
        const reach = {};
        for (const c of inv.contracts)
          reach[c.number] = (await s.request("GET", `/api/v1/contracts/${c.number}`)).status;
        const portalReach = {};
        if (s.role === "business_user")
          for (const c of inv.contracts)
            portalReach[c.number] = (
              await s.request("GET", `/api/v1/portal/contracts/${c.number}`)
            ).status;
        if (s.role === "business_user")
          check(
            portalReach[conf.number] !== 200,
            `portal reach on the Confidential Contract ${portalReach[conf.number]}`,
          );
        const confDoc = inv.documents.find((d) => d.contract === conf.number);
        const docStatus = (
          await s.request(
            "GET",
            `/api/v1/documents/${confDoc.id}/versions/${confDoc.versions[0].id}/download`,
          )
        ).status;
        check(
          reach[conf.number] !== 200 && docStatus !== 200,
          `Confidential reach ${reach[conf.number]}, download ${docStatus}`,
        );
        if (s.page)
          await s.page.goto(`${p.base}/contracts/${conf.number}`, { waitUntil: "networkidle" });
        const visible = s.page
          ? await s.page
              .getByText(conf.title)
              .first()
              .isVisible()
              .catch(() => false)
          : null;
        check(!visible, "Confidential title visible in the browser");
        return {
          signIn: s.how,
          landed: s.landed,
          role: s.role,
          baselineReach: inv.baselineReach[key],
          reachNow: reach,
          portalReach,
          confidentialDocumentDownload: docStatus,
          confidentialTitleVisibleInBrowser: visible,
        };
      },
    );
  }
  await step(
    {
      scenario,
      article,
      role: "administrator",
      action: `${label}: a new upload is processed by the worker`,
      critical: false,
    },
    async () => {
      const s = sessions.admin;
      const api = await adminApi(p);
      const c = inv.contracts[1];
      const name = `doc029-lifecycle-${p.name}-${Date.now()}.pdf`;
      const doc = (
        await api.upload(
          `/api/v1/contracts/${c.number}/documents`,
          name,
          pdf([`DOC-029 lifecycle new upload on ${label}.`, "Worker processing check."]),
          "application/pdf",
        )
      ).document;
      const v = doc.versions.find((x) => x.isCurrent) ?? doc.versions[0];
      const text = await waitText(api, doc.id, v.id, 300_000);
      check(
        text.state === "ready" && /Worker processing check/.test(text.text),
        `text state ${text.state}`,
      );
      state.newUploads = {
        ...(state.newUploads ?? {}),
        [p.name]: { id: doc.id, title: doc.title, contract: c.number },
      };
      saveState();
      void s;
      return `Document ${doc.title} on Contract ${c.number}: text ${text.state}, extracted words present`;
    },
  );
  if (expectAbsentDocument !== undefined && expectAbsentDocument !== null) {
    // not used
  }
  await step(
    {
      scenario,
      article,
      role: "administrator",
      action: `${label}: actual use of the saved encrypted relay (test email)`,
      critical: false,
    },
    async () => {
      const s = sessions.admin;
      const settings = await s.request("GET", "/api/v1/email-settings");
      const since = Date.now();
      const sent = await s.request("POST", "/api/v1/email-settings/test");
      check(sent.status === 200, `test send ${sent.status} ${JSON.stringify(sent.body)}`);
      const mail = await waitMail(
        (m) =>
          toAddress(m, state.people.admin.email) &&
          m.Subject === "OpenLaw test email" &&
          Date.parse(m.Created) >= since - 2000,
      );
      check(mail, "no message at the controlled recipient");
      return `email-settings source ${settings.body?.source}; POST test 200; message delivered to the controlled recipient through the saved relay`;
    },
  );
  await step(
    {
      scenario,
      article,
      action: `${label}: inspect outstanding jobs and Envelopes`,
      command: "psql: pg-boss job states; envelopes count",
      critical: false,
    },
    () => {
      const jobs = must(
        `docker compose exec -T postgres psql -U openlaw -d openlaw -At -F ' ' -c "select state, count(*) from pgboss.job group by state order by state"`,
        p.dir,
      )
        .stdout.trim()
        .replace(/\n/g, "; ");
      const env = sh(
        `docker compose exec -T postgres psql -U openlaw -d openlaw -At -F ' ' -c "select status, count(*) from contract_envelopes group by status"`,
        p.dir,
      );
      return `pg-boss job states: ${jobs || "(none)"}; contract_envelopes: ${env.code === 0 ? env.stdout.trim() || "(none)" : "query failed"}`;
    },
  );
  for (const s of Object.values(sessions)) await s.context.close();
  return sessions;
}

// V-C46 negative check: restore the pre-upgrade backup into a separate empty target on the starting build.
phases["recovery"] = async () => {
  const p = PROJECTS.recovery;
  const backup = state.preUpgradeBackup;
  await restoreInto(p, backup, BASELINE, {
    scenario: "V-C46",
    article: "upgrade (If the upgrade cannot be accepted) + backup-and-restore",
    keysFrom: "upgrade",
  });
  await phases["recovery-verify"]();
};
phases["recovery-verify"] = async () => {
  const p = PROJECTS.recovery;
  await step(
    {
      scenario: "V-C46",
      method: "browser-walkthrough",
      action: "recovery target: starting-build web client at /login",
      critical: false,
    },
    async () => {
      const b = await chromium();
      const context = await b.newContext();
      const page = await context.newPage();
      await page.goto(`${p.base}/login`, { waitUntil: "networkidle" });
      const text = (await page.locator("body").innerText()).slice(0, 160).replace(/\s+/g, " ");
      await context.close();
      return `observation only: ${text}`;
    },
  );
  await verifyInstance(p, {
    scenario: "V-C46",
    article: "upgrade (If the upgrade cannot be accepted)",
    label: "recovery target",
    apiOnly: true,
  });
  await step(
    {
      scenario: "V-C46",
      article: "upgrade",
      action:
        "recovery target: work accepted after the backup is absent; running image is the starting build",
      critical: false,
    },
    async () => {
      const api = await adminApi(p);
      const later = state.newUploads?.upgrade;
      check(later, "no post-backup upload recorded on the upgraded instance");
      const r = await api.raw("GET", `/api/v1/contracts/${later.contract}/documents`);
      const present = r.body.documents.some((d) => d.id === later.id);
      check(!present, "post-backup Document present in the recovery target");
      const images = recordImages("recovery", p).services;
      const app = images.find((i) => i.container.includes("-app-"));
      check(app.tag === BASELINE, `app tag ${app.tag}`);
      const journal = must(
        `docker compose exec -T postgres psql -U openlaw -d openlaw -At -c "select count(*) from drizzle.__drizzle_migrations"`,
        p.dir,
      ).stdout.trim();
      return `upload accepted on the upgraded instance after the backup (${later.title}) is absent; app runs openlaw-local:${app.tag} (${app.id}); journal rows ${journal}; the migrated database of ${PROJECTS.upgrade.project} was never opened by an older image`;
    },
  );
};

// Backup article, Restore into a different empty target, steps 1 to 5.
async function restoreInto(p, backupDir, revision, { scenario, article, keysFrom }) {
  const env = { BACKUP_DIR: backupDir };
  await step(
    {
      scenario,
      article,
      action: `Restore step 1: prepare source ${revision.slice(0, 8)} and images, retained keys, distinct project and port`,
      critical: true,
    },
    () => {
      const lines = cloneAndCheckout(p, revision);
      if (!existsSync(path.join(p.dir, ".env"))) writeInstallConfig(p, revision);
      envSet(p, "AUTH_SECRET", secrets[keysFrom].AUTH_SECRET);
      envSet(p, "OPENLAW_SECRET_KEY", secrets[keysFrom].OPENLAW_SECRET_KEY);
      storeKeys(p);
      must("docker compose config --quiet", p.dir);
      ensureNetworks(p);
      must("docker compose build app doc-engine", p.dir, { timeout: 3_000_000 });
      const recorded = JSON.parse(readFileSync(path.join(backupDir, "images.json"), "utf8"));
      const recordedApp = recorded.find((i) => i.ContainerName?.includes("-app-"));
      const images = JSON.parse(must("docker compose config --format json", p.dir).stdout).services;
      return `${lines.join("; ")}; project ${p.project}, port ${p.port}; retained AUTH_SECRET and OPENLAW_SECRET_KEY supplied from the secret store; backup images.json names ${recordedApp.Repository}:${recordedApp.Tag}; target app image ${images.app.image} (${inspectImage(images.app.image)}); no first-run setup done`;
    },
  );
  await step(
    {
      scenario,
      article,
      action: "Restore step 2: verify hashes on the target host and start Postgres",
      command: '(cd "$BACKUP_DIR" && sha256sum --check SHA256SUMS); docker compose up -d postgres',
      critical: true,
    },
    () => {
      const check1 = must('(cd "$BACKUP_DIR" && sha256sum --check SHA256SUMS)', p.dir, { env })
        .stdout.trim()
        .replace(/\n/g, "; ");
      must("docker compose up -d postgres", p.dir);
      return check1;
    },
  );
  await step(
    {
      scenario,
      article,
      action: "Confirm the target database and file store are empty before importing",
      critical: true,
    },
    async () => {
      let tables = "";
      for (let i = 0; i < 60; i += 1) {
        const r = sh(
          `docker compose exec -T postgres psql -U openlaw -d openlaw -At -c "select count(*) from information_schema.tables where table_schema not in ('pg_catalog','information_schema')"`,
          p.dir,
        );
        if (r.code === 0) {
          tables = r.stdout.trim();
          break;
        }
        await sleep(2000);
      }
      const files = must(
        "docker compose run -T --rm --no-deps app sh -c 'find /var/lib/openlaw/files -mindepth 1 | wc -l'",
        p.dir,
      ).stdout.trim();
      check(tables === "0" && files === "0", `tables ${tables}, files ${files}`);
      return `non-system tables ${tables}; entries in /var/lib/openlaw/files ${files}`;
    },
  );
  await step(
    {
      scenario,
      article,
      action: "Restore step 3: restore the database with --exit-on-error",
      command:
        'docker compose exec -T postgres pg_restore -U openlaw -d openlaw --exit-on-error --no-owner --no-privileges < "$BACKUP_DIR/database.dump"',
      critical: true,
    },
    () => {
      const r = sh(
        'docker compose exec -T postgres pg_restore -U openlaw -d openlaw --exit-on-error --no-owner --no-privileges < "$BACKUP_DIR/database.dump"',
        p.dir,
        { env, timeout: 600_000 },
      );
      check(r.code === 0, `pg_restore exit ${r.code}: ${r.stderr.slice(-500)}`);
      return `pg_restore exit 0; stderr lines ${r.stderr.trim() ? r.stderr.trim().split("\n").length : 0}`;
    },
  );
  await step(
    {
      scenario,
      article,
      action: "Restore step 4: restore local files through the target app volume",
      command:
        'docker compose run -T --rm --no-deps app tar -xzf - -C /var/lib/openlaw/files < "$BACKUP_DIR/files.tar.gz"',
      critical: true,
    },
    () => {
      must(
        'docker compose run -T --rm --no-deps app tar -xzf - -C /var/lib/openlaw/files < "$BACKUP_DIR/files.tar.gz"',
        p.dir,
        { env, timeout: 600_000 },
      );
      const files = must(
        "docker compose run -T --rm --no-deps app sh -c 'find /var/lib/openlaw/files -type f | wc -l'",
        p.dir,
      ).stdout.trim();
      return `tar exit 0; files now in the target volume ${files}`;
    },
  );
  await step(
    {
      scenario,
      article,
      action:
        "Restore step 5: start the target and check readiness (controlled relay reachable under its saved name first)",
      command: "docker compose up -d --no-build --pull never; docker compose ps",
      critical: true,
    },
    async () => {
      attachSupport(p);
      must("docker compose up -d --no-build --pull never", p.dir);
      await waitReady(p, 600_000);
      return {
        readyz: 200,
        ps: containerIds(p).map((r) => `${r.service} ${r.state}`),
        images: recordImages(`${p.name}-start`, p).services,
      };
    },
  );
}

phases["backup"] = async () => {
  const p = PROJECTS.upgrade;
  await runBackup(p, path.join(LC, "backups", "candidate"), {
    scenario: "V-C47",
    article: "backup-and-restore",
    restart: true,
  });
  state.candidateBackup = path.join(LC, "backups", "candidate-retained");
  saveState();
};

phases["restore"] = async () => {
  const p = PROJECTS.restore;
  await restoreInto(p, state.candidateBackup, CANDIDATE, {
    scenario: "V-C47",
    article: "backup-and-restore",
    keysFrom: "upgrade",
  });
  await verifyInstance(p, {
    scenario: "V-C47",
    article: "backup-and-restore",
    label: "restored target",
  });
};

function recreate(p, services = "app worker") {
  return sh(`docker compose up -d --no-build --pull never --force-recreate ${services}`, p.dir, {
    timeout: 300_000,
  });
}

phases["restore-negatives"] = async () => {
  const p = PROJECTS.restore;
  const A = "backup-and-restore";
  const goodKey = secrets.upgrade.OPENLAW_SECRET_KEY;
  await step(
    {
      scenario: "V-C47",
      article: A,
      action: "Negative: wrong OPENLAW_SECRET_KEY (valid length) on the restored target",
      expected:
        "Records work but the saved relay credentials are unavailable; nothing is delivered.",
      critical: false,
    },
    async () => {
      envSet(p, "OPENLAW_SECRET_KEY", randomBytes(32).toString("base64"));
      const r = recreate(p);
      check(r.code === 0, r.stderr.slice(-300));
      await waitReady(p);
      const bootLine = must("docker compose logs --no-log-prefix app", p.dir)
        .stdout.split("\n")
        .filter((l) => /credential|secret key|could not be opened|unreadable/i.test(l))
        .slice(-3);
      const api = await adminApi(p);
      const read = await api.raw("GET", `/api/v1/contracts/${state.inventory.contracts[0].number}`);
      const settings = await api.get("/api/v1/email-settings");
      const since = Date.now();
      const test = await api.raw("POST", "/api/v1/email-settings/test");
      const mail = await waitMail(
        (m) => toAddress(m, state.people.admin.email) && Date.parse(m.Created) >= since - 2000,
        15_000,
      );
      check(
        read.status === 200 && test.status !== 200 && !mail,
        `read ${read.status}, test ${test.status}, mail ${Boolean(mail)}`,
      );
      return {
        contractRead: read.status,
        emailSettingsSource: settings.source,
        testSend: test.status,
        testDetail: test.body?.detail ?? test.body?.message,
        delivered: false,
        bootLogLines: bootLine,
      };
    },
  );
  await step(
    {
      scenario: "V-C47",
      article: A,
      action:
        "Recovery: restore the retained key, recreate app and worker, send through the saved relay",
      critical: false,
    },
    async () => {
      envSet(p, "OPENLAW_SECRET_KEY", goodKey);
      const r = recreate(p);
      check(r.code === 0, r.stderr.slice(-300));
      await waitReady(p);
      const api = await adminApi(p);
      const since = Date.now();
      const test = await api.raw("POST", "/api/v1/email-settings/test");
      const mail = await waitMail(
        (m) => toAddress(m, state.people.admin.email) && Date.parse(m.Created) >= since - 2000,
      );
      check(test.status === 200 && mail, `test ${test.status}`);
      return "test send 200 and delivered to the controlled recipient";
    },
  );
  await step(
    {
      scenario: "V-C47",
      article: A,
      action: "Negative: remove one stored blob from the restored file volume",
      expected: "The Document is still listed while its download fails.",
      critical: false,
    },
    async () => {
      const d = state.inventory.documents[0];
      const v = d.versions[0];
      const key = must(
        `docker compose exec -T postgres psql -U openlaw -d openlaw -At -c "select file_ref from document_versions where id='${v.id}'"`,
        p.dir,
      ).stdout.trim();
      check(key, "no storage key");
      const rel = key.replace(/^local:/, "");
      must(
        `docker compose run -T --rm --no-deps app sh -c 'rm -- "/var/lib/openlaw/files/${rel}"'`,
        p.dir,
      );
      const api = await adminApi(p);
      const listed = (await api.get(`/api/v1/contracts/${d.contract}/documents`)).documents.some(
        (x) => x.id === d.id,
      );
      const got = await api.sha(`/api/v1/documents/${d.id}/versions/${v.id}/download`);
      check(listed && got.status !== 200, `listed ${listed}, download ${got.status}`);
      return `Document listed ${listed}; version ${v.versionNumber} download HTTP ${got.status}`;
    },
  );
  await step(
    {
      scenario: "V-C47",
      article: A,
      action:
        "Recovery: reapply the retained file backup to the isolated target and compare hashes",
      command:
        'docker compose run -T --rm --no-deps app tar -xzf - -C /var/lib/openlaw/files < "$BACKUP_DIR/files.tar.gz"',
      critical: false,
    },
    async () => {
      must(
        'docker compose run -T --rm --no-deps app tar -xzf - -C /var/lib/openlaw/files < "$BACKUP_DIR/files.tar.gz"',
        p.dir,
        { env: { BACKUP_DIR: state.candidateBackup } },
      );
      const api = await adminApi(p);
      const d = state.inventory.documents[0];
      const out = [];
      for (const v of d.versions) {
        const got = await api.sha(`/api/v1/documents/${d.id}/versions/${v.id}/download`);
        check(got.sha256 === v.sha256, `v${v.versionNumber} ${got.status}`);
        out.push(`v${v.versionNumber} ${got.sha256.slice(0, 16)} match`);
      }
      return out.join("; ");
    },
  );
  await step(
    {
      scenario: "V-C47",
      article: A,
      action: "Negative: startup with a missing key",
      command: "docker compose config --quiet (OPENLAW_SECRET_KEY removed)",
      expected: "Compose refuses before any container changes.",
      critical: false,
    },
    () => {
      envSet(p, "OPENLAW_SECRET_KEY", null);
      const r = sh("docker compose config --quiet", p.dir);
      const up = sh("docker compose up -d --no-build --pull never", p.dir);
      envSet(p, "OPENLAW_SECRET_KEY", goodKey);
      check(r.code !== 0 && up.code !== 0, `config ${r.code}, up ${up.code}`);
      return `config --quiet exit ${r.code}: ${r.stderr.trim().split("\n").pop()}; up exit ${up.code}; key restored`;
    },
  );
};

// ---------------------------------------------------------------- diagnostics (V-C48) on the upgraded instance

const T = "operator-troubleshooting";
function lines(text, pattern, n = 4) {
  return text
    .split("\n")
    .filter((l) => pattern.test(l))
    .map((l) => l.trim().slice(0, 300))
    .slice(0, n);
}

phases["diag-baseline"] = async () => {
  const p = PROJECTS.upgrade;
  await step(
    {
      scenario: "V-C48",
      article: T,
      action: "Start with the observed failure: baseline health commands",
      command:
        "docker compose config --quiet; docker compose ps --all; docker compose logs --since=10m app worker",
      critical: true,
    },
    async () => {
      must("docker compose config --quiet", p.dir);
      const ps = containerIds(p);
      const logs = must("docker compose logs --since=10m app worker", p.dir).stdout;
      const h = await http(`${p.base}/healthz`);
      const r = await http(`${p.base}/readyz`);
      const leaked = secretValues().some((v) => logs.includes(v));
      check(!leaked, "a key or relay credential appears in the logs");
      return {
        ps: ps.map((x) => `${x.service} ${x.state}`),
        healthz: h.status,
        readyz: r.status,
        logLines: logs.split("\n").length,
        secretsInLogs: leaked,
      };
    },
  );
};

phases["diag-startup"] = async () => {
  const p = PROJECTS.upgrade;
  const good = {
    AUTH_SECRET: secrets.upgrade.AUTH_SECRET,
    OPENLAW_SECRET_KEY: secrets.upgrade.OPENLAW_SECRET_KEY,
  };
  await step(
    {
      scenario: "V-C48",
      article: T,
      action: "Missing key: Compose refuses the command",
      critical: false,
    },
    () => {
      const out = {};
      for (const key of ["AUTH_SECRET", "OPENLAW_SECRET_KEY"]) {
        envSet(p, key, null);
        const r = sh("docker compose config --quiet", p.dir);
        envSet(p, key, good[key]);
        check(r.code !== 0, `${key} missing but config exit 0`);
        out[key] = `exit ${r.code}: ${r.stderr.trim().split("\n").pop()}`;
      }
      return out;
    },
  );
  await step(
    {
      scenario: "V-C48",
      article: T,
      action: "Short OPENLAW_SECRET_KEY: config passes but app and worker refuse to start; recover",
      expected:
        "config --quiet passes; app and worker stop at startup; correct key and recreate restores readiness.",
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
      recreate(p);
      await waitReady(p);
      const api = await adminApi(p);
      const read = await api.raw("GET", `/api/v1/contracts/${state.inventory.contracts[0].number}`);
      check(
        cfg.code === 0 && ready.status !== 200 && read.status === 200,
        `config ${cfg.code}, readyz ${ready.status}`,
      );
      return {
        configQuiet: cfg.code,
        readyzWhileShort: ready.status,
        ps,
        appLog: lines(appLogs, /OPENLAW_SECRET_KEY|32|secret/i),
        workerLog: lines(workerLogs, /OPENLAW_SECRET_KEY|32|secret/i),
        afterRecovery: `readyz 200; Contract read ${read.status}`,
      };
    },
  );
  await step(
    {
      scenario: "V-C48",
      article: T,
      action: "Short AUTH_SECRET: only a warning in the log, the app starts; restore",
      critical: false,
    },
    async () => {
      envSet(p, "AUTH_SECRET", "short-auth-secret");
      recreate(p);
      const ready = await waitReady(p)
        .then(() => 200)
        .catch(() => 0);
      const logs = sh("docker compose logs --no-log-prefix app", p.dir).stdout;
      const warn = lines(logs, /AUTH_SECRET|BETTER_AUTH_SECRET|secret.*(short|length|32)/i, 3);
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
      scenario: "V-C48",
      article: T,
      action:
        "Port already allocated: failed bind, app and worker containers removed; recover on the intended port",
      critical: false,
    },
    async () => {
      const occupied = PROJECTS.recovery.port;
      const listener = await http(`http://127.0.0.1:${occupied}/healthz`);
      envSet(p, "PORT", `127.0.0.1:${occupied}`);
      const up = sh("docker compose up -d --no-build --pull never", p.dir, { timeout: 300_000 });
      const ps = containerIds(p).map((x) => `${x.service} ${x.state}`);
      const errLine = up.stderr
        .split("\n")
        .filter((l) => /allocated|bind|address already/i.test(l))
        .slice(0, 2);
      envSet(p, "PORT", `127.0.0.1:${p.port}`);
      const up2 = sh("docker compose up -d --no-build --pull never", p.dir, { timeout: 300_000 });
      await waitReady(p);
      const hasApp = ps.some((x) => x.startsWith("app "));
      const hasWorker = ps.some((x) => x.startsWith("worker "));
      check(up.code !== 0 && up2.code === 0, `first up ${up.code}, second ${up2.code}`);
      return {
        occupiedBy: `${PROJECTS.recovery.project} (healthz ${listener.status})`,
        upExit: up.code,
        error: errLine,
        psAfterFailedBind: ps,
        appContainerPresent: hasApp,
        workerContainerPresent: hasWorker,
        recovery: `up exit ${up2.code}; readyz 200 on ${p.port}`,
      };
    },
  );
  await step(
    {
      scenario: "V-C48",
      article: T,
      action: "App keeps restarting: unresolvable DATABASE_URL; first specific error; recover",
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
      const first = lines(logs, /ENOTFOUND|getaddrinfo|ECONNREFUSED|error/i, 2);
      check(
        first.length > 0 && ready.status !== 200,
        `error lines ${first.length}, readyz ${ready.status}`,
      );
      return {
        restartCountAndState: restarts,
        readyz: ready.status,
        firstErrorLines: first,
        recovery: "DATABASE_URL override removed, app recreated, readyz 200",
      };
    },
  );
  await step(
    {
      scenario: "V-C48",
      article: T,
      action:
        "/healthz works but /readyz fails: database stopped under a running app; restore and verify read and write",
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
        json: { description: `DOC-029 lifecycle write check ${new Date().toISOString()}` },
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

phases["diag-port-recheck"] = async () => {
  const p = PROJECTS.upgrade;
  await step(
    {
      scenario: "V-C48",
      article: T,
      action:
        "Port row recheck: container state after a failed bind, read with docker compose ps --all and docker compose ps",
      expected: "Article: a failed bind leaves the app and worker containers removed.",
      critical: false,
    },
    async () => {
      envSet(p, "PORT", `127.0.0.1:${PROJECTS.recovery.port}`);
      const up = sh("docker compose up -d --no-build --pull never", p.dir, { timeout: 300_000 });
      const all = must("docker compose ps --all --format '{{.Service}} {{.State}}'", p.dir)
        .stdout.trim()
        .split("\n");
      const running = must("docker compose ps --format '{{.Service}} {{.State}}'", p.dir)
        .stdout.trim()
        .split("\n");
      envSet(p, "PORT", `127.0.0.1:${p.port}`);
      const up2 = sh("docker compose up -d --no-build --pull never", p.dir, { timeout: 300_000 });
      await waitReady(p);
      const removed =
        !all.some((l) => l.startsWith("app ")) && !all.some((l) => l.startsWith("worker "));
      const summary = {
        upExit: up.code,
        psAll: all,
        ps: running,
        recovery: `up exit ${up2.code}; readyz 200`,
      };
      check(
        up.code !== 0 && removed,
        `app and worker are not removed after the failed bind: ${JSON.stringify(summary)}`,
      );
      return summary;
    },
  );
};

phases["diag-migration"] = async () => {
  const p = PROJECTS.upgrade;
  const q = (sql) =>
    must(
      `docker compose exec -T postgres psql -U openlaw -d openlaw -At -F '|' -c "${sql}"`,
      p.dir,
    ).stdout.trim();
  await step(
    {
      scenario: "V-C48",
      article: T,
      action:
        "Migration failure: controlled journal fault gives the refusal; both read-only commands run; fixture undo restores readiness",
      expected:
        "App refuses with 'This database cannot apply the migrations it is missing'; the two commands list the journal and shipped hashes.",
      critical: false,
    },
    async () => {
      const row = q(
        "select id, hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 1",
      );
      const [id, hash] = row.split("|");
      state.migrationFault = { id, hash };
      saveState();
      q(
        `update drizzle.__drizzle_migrations set hash = 'doc029lifecyclefault' || substr(hash, 21) where id = ${id}`,
      );
      recreate(p, "app");
      await sleep(30_000);
      const logs = sh("docker compose logs --no-log-prefix --tail=80 app", p.dir).stdout;
      const refusal = lines(
        logs,
        /cannot apply the migrations|__drizzle_migrations|unrecognized|missing/i,
        4,
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
      const faultShown = c1.stdout.includes("doc029lifecyclefault");
      const shippedHasOriginal = c2.stdout.includes(hash);
      q(`update drizzle.__drizzle_migrations set hash = '${hash}' where id = ${id}`);
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
          shippedHasOriginal,
        JSON.stringify({
          refusal,
          ready: ready.status,
          c1: c1.code,
          c2: c2.code,
          faultShown,
          shippedHasOriginal,
        }),
      );
      const tag = c2.stdout
        .split("\n")
        .find((l) => l.includes(hash))
        ?.trim()
        .slice(0, 160);
      return {
        refusal,
        readyzWhileRefusing: ready.status,
        psqlCommandExit: c1.code,
        faultyRowListed: faultShown,
        lintHashesExit: c2.code,
        shippedEntryForOriginalHash: tag,
        undo: "the fixture custodian wrote back the exact recorded hash; readyz 200",
      };
    },
  );
  await step(
    {
      scenario: "V-C48",
      article: T,
      action: "Known automatic repair: reconciled log line observed during the upgrade",
      critical: false,
    },
    () => {
      const logs = must("docker compose logs --no-log-prefix app", p.dir).stdout;
      const upgradeStep = log.steps.find(
        (s) => s.action.startsWith("Start step 1") && s.result === "pass",
      );
      check(upgradeStep, "no passing upgrade start step");
      return `upgrade start step recorded ${JSON.parse(upgradeStep.actual)
        .migrationLogLines.filter((l) => l.includes("reconciled"))
        .join(
          " | ",
        )}; current log retains ${lines(logs, /reconciled/).length} such lines after recreations`;
    },
  );
};

phases["diag-mail"] = async () => {
  const p = PROJECTS.upgrade;
  const goodKey = secrets.upgrade.OPENLAW_SECRET_KEY;
  await step(
    {
      scenario: "V-C48",
      article: T,
      action:
        "Email: SMTP_URL pins the environment and the saved relay is ignored; remove override to restore",
      critical: false,
    },
    async () => {
      envSet(p, "SMTP_URL", "smtp://lc-mail:2599");
      envSet(p, "SMTP_FROM", "DOC-029 Env Override <env@lifecycle.example>");
      recreate(p);
      await waitReady(p);
      let api = await adminApi(p);
      const pinned = await api.get("/api/v1/email-settings");
      const save = await api.raw("PUT", "/api/v1/email-settings", {
        json: { smtpUrl: "smtp://lc-mail:1025", smtpFrom: "x@lifecycle.example" },
      });
      const test = await api.raw("POST", "/api/v1/email-settings/test");
      envSet(p, "SMTP_URL", null);
      envSet(p, "SMTP_FROM", null);
      recreate(p);
      await waitReady(p);
      api = await adminApi(p);
      const restored = await api.get("/api/v1/email-settings");
      const since = Date.now();
      const test2 = await api.raw("POST", "/api/v1/email-settings/test");
      const mail = await waitMail(
        (m) => toAddress(m, state.people.admin.email) && Date.parse(m.Created) >= since - 2000,
      );
      check(
        pinned.source === "env" &&
          test.status !== 200 &&
          save.status === 409 &&
          test2.status === 200 &&
          mail,
        JSON.stringify({
          pinned: pinned.source,
          save: save.status,
          test: test.status,
          test2: test2.status,
        }),
      );
      return {
        pinnedSource: pinned.source,
        fromAddress: pinned.fromAddress,
        saveWhilePinned: save.status,
        testWhilePinned: `${test.status} ${test.body?.detail ?? ""}`,
        afterRemoval: `source ${restored.source}; test ${test2.status}; delivered through the saved relay`,
      };
    },
  );
  await step(
    {
      scenario: "V-C48",
      article: T,
      action: "Email: wrong OPENLAW_SECRET_KEY reads the saved relay as absent; restore the key",
      expected:
        "Email state unset; test fails with 'The test email could not be sent. SMTP is not configured — save a relay first.'; unrelated Contract readable.",
      critical: false,
    },
    async () => {
      envSet(p, "OPENLAW_SECRET_KEY", randomBytes(32).toString("base64"));
      recreate(p);
      await waitReady(p);
      let api = await adminApi(p);
      const settings = await api.get("/api/v1/email-settings");
      const test = await api.raw("POST", "/api/v1/email-settings/test");
      const read = await api.raw("GET", `/api/v1/contracts/${state.inventory.contracts[0].number}`);
      envSet(p, "OPENLAW_SECRET_KEY", goodKey);
      recreate(p);
      await waitReady(p);
      api = await adminApi(p);
      const since = Date.now();
      const test2 = await api.raw("POST", "/api/v1/email-settings/test");
      const mail = await waitMail(
        (m) => toAddress(m, state.people.admin.email) && Date.parse(m.Created) >= since - 2000,
      );
      const detail = test.body?.detail ?? test.body?.message ?? "";
      check(
        detail.includes(
          "The test email could not be sent. SMTP is not configured — save a relay first.",
        ) &&
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
        afterKeyRestored: `test ${test2.status}; delivered`,
      };
    },
  );
};

phases["diag-storage"] = async () => {
  const p = PROJECTS.upgrade;
  const minioSecret = secrets.minio?.secret ?? randomBytes(18).toString("base64url");
  secrets.minio = { user: "doc029lifecycle", secret: minioSecret };
  saveSecrets();
  await step(
    {
      scenario: "V-C48",
      method: "automated-test",
      action:
        "Fixture: owned MinIO with a pre-created bucket; switch the write driver to s3 and upload one file",
      critical: true,
    },
    async () => {
      if (sh(`docker inspect ${MINIO_NAME}`, root).code !== 0)
        must(
          `docker run -d --name ${MINIO_NAME} --label openlaw-docs-owner=${PREFIX} --network ${p.project}_openlaw-backend --network-alias lc-minio -p 127.0.0.1:${MINIO_PORT}:9000 -e MINIO_ROOT_USER=doc029lifecycle -e MINIO_ROOT_PASSWORD=${minioSecret} minio/minio:RELEASE.2025-09-07T16-13-09Z server /data`,
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
        credentials: { accessKeyId: "doc029lifecycle", secretAccessKey: minioSecret },
      });
      await client.send(new s3.CreateBucketCommand({ Bucket: "doc029-lifecycle" })).catch((e) => {
        if (!/BucketAlready/.test(e.name)) throw e;
      });
      for (const [k, v] of [
        ["STORAGE_DRIVER", "s3"],
        ["S3_BUCKET", "doc029-lifecycle"],
        ["S3_ENDPOINT", "http://lc-minio:9000"],
        ["S3_ACCESS_KEY_ID", "doc029lifecycle"],
        ["S3_SECRET_ACCESS_KEY", minioSecret],
      ])
        envSet(p, k, v);
      recreate(p);
      await waitReady(p);
      const api = await adminApi(p);
      const c = state.inventory.contracts[1];
      const body = Buffer.from(`DOC-029 lifecycle object-store file ${Date.now()}\n`);
      const doc = (
        await api.upload(
          `/api/v1/contracts/${c.number}/documents`,
          "doc029-lifecycle-s3.txt",
          body,
          "text/plain",
        )
      ).document;
      const v = doc.versions[0];
      const key = must(
        `docker compose exec -T postgres psql -U openlaw -d openlaw -At -c "select file_ref from document_versions where id='${v.id}'"`,
        p.dir,
      ).stdout.trim();
      const got = await api.sha(`/api/v1/documents/${doc.id}/versions/${v.id}/download`);
      const sha = createHash("sha256").update(body).digest("hex");
      check(
        key.startsWith("s3:") && got.sha256 === sha,
        `key ${key.split(":")[0]}, sha ${got.status}`,
      );
      state.s3Doc = { id: doc.id, versionId: v.id, sha256: sha, contract: c.number };
      saveState();
      return `write driver s3; new Version stored under ${key.split(":")[0]}:; download hash matches; earlier local Versions untouched`;
    },
  );
  await step(
    {
      scenario: "V-C48",
      article: T,
      action:
        "Storage fault: wrong retained S3 endpoint; ready app, failing download on that store only; correct and verify",
      critical: false,
    },
    async () => {
      envSet(p, "S3_ENDPOINT", "http://lc-no-such-minio:9000");
      recreate(p);
      const ready = await waitReady(p, 180_000)
        .then(() => 200)
        .catch((e) => e.message.slice(0, 120));
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
        s3DocumentListed: listed,
        s3Download: s3got.status,
        localDownloadHashMatches: true,
        afterCorrection: "s3 download hash matches",
      };
    },
  );
  await step(
    {
      scenario: "V-C48",
      article: T,
      action: "Upload too large: MAX_UPLOAD_MB=1 refuses above and accepts below; restore",
      critical: false,
    },
    async () => {
      envSet(p, "MAX_UPLOAD_MB", "1");
      recreate(p);
      await waitReady(p);
      const api = await adminApi(p);
      const c = state.inventory.contracts[1];
      const big = await api.raw("POST", `/api/v1/contracts/${c.number}/documents`, {
        form: (() => {
          const f = new FormData();
          f.append(
            "file",
            new File([Buffer.alloc(1_100_000, 97)], "doc029-lifecycle-big.txt", {
              type: "text/plain",
            }),
          );
          return f;
        })(),
      });
      const small = await api.raw("POST", `/api/v1/contracts/${c.number}/documents`, {
        form: (() => {
          const f = new FormData();
          f.append(
            "file",
            new File([Buffer.alloc(900_000, 98)], "doc029-lifecycle-small.txt", {
              type: "text/plain",
            }),
          );
          return f;
        })(),
      });
      envSet(p, "MAX_UPLOAD_MB", null);
      recreate(p);
      await waitReady(p);
      check(big.status >= 400 && small.status === 201, `big ${big.status}, small ${small.status}`);
      return {
        over: `${big.status} ${big.body?.detail ?? ""}`,
        under: small.status,
        restored: "MAX_UPLOAD_MB removed; readyz 200",
      };
    },
  );
};

phases["diag-worker"] = async () => {
  const p = PROJECTS.upgrade;
  const c = state.inventory.contracts[1];
  await step(
    {
      scenario: "V-C48",
      article: T,
      action:
        "Worker stopped: new upload stays pending with original downloadable; resume and verify",
      command:
        "docker compose ps worker doc-engine; docker compose logs --since=10m worker doc-engine",
      critical: false,
    },
    async () => {
      must("docker compose stop worker", p.dir, { timeout: 120_000 });
      const ps = must("docker compose ps worker doc-engine --format json", p.dir)
        .stdout.trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .map((x) => `${x.Service} ${x.State}`);
      const api = await adminApi(p);
      const body = pdf([
        "DOC-029 lifecycle worker-stopped upload.",
        "Processing resumes after the worker returns.",
      ]);
      const doc = (
        await api.upload(
          `/api/v1/contracts/${c.number}/documents`,
          "doc029-lifecycle-worker.pdf",
          body,
          "application/pdf",
        )
      ).document;
      const v = doc.versions[0];
      await sleep(20_000);
      const pending = await textState(api, doc.id, v.id);
      const got = await api.sha(`/api/v1/documents/${doc.id}/versions/${v.id}/download`);
      const logs = must("docker compose logs --since=10m worker doc-engine", p.dir).stdout.split(
        "\n",
      ).length;
      must("docker compose start worker", p.dir);
      const text = await waitText(api, doc.id, v.id, 300_000);
      check(
        pending === "pending" &&
          got.sha256 === createHash("sha256").update(body).digest("hex") &&
          text.state === "ready",
        `pending ${pending}, download ${got.status}, after ${text.state}`,
      );
      return {
        ps,
        stateWhileStopped: pending,
        originalDownload: "hash matches",
        logsLines: logs,
        afterResume: text.state,
      };
    },
  );
  await step(
    {
      scenario: "V-C48",
      article: T,
      action:
        "Engine unavailable: a PDF reaches a terminal failed state while the API stays ready; restore engine and process a new PDF",
      critical: false,
    },
    async () => {
      must("docker compose stop doc-engine", p.dir);
      const api = await adminApi(p);
      const body = pdf(["DOC-029 lifecycle engine-down upload.", "This one should fail."]);
      const doc = (
        await api.upload(
          `/api/v1/contracts/${c.number}/documents`,
          "doc029-lifecycle-engine-down.pdf",
          body,
          "application/pdf",
        )
      ).document;
      const v = doc.versions[0];
      const t0 = Date.now();
      const failed = await waitText(api, doc.id, v.id, 600_000, ["failed"]);
      const ready = await http(`${p.base}/readyz`);
      const got = await api.sha(`/api/v1/documents/${doc.id}/versions/${v.id}/download`);
      const ps = must("docker compose ps --all doc-engine --format json", p.dir).stdout.trim();
      must("docker compose start doc-engine", p.dir);
      await sleep(15_000);
      const body2 = pdf([
        "DOC-029 lifecycle engine-restored upload.",
        "Processing after the engine returns.",
      ]);
      const doc2 = (
        await api.upload(
          `/api/v1/contracts/${c.number}/documents`,
          "doc029-lifecycle-engine-back.pdf",
          body2,
          "application/pdf",
        )
      ).document;
      const text2 = await waitText(api, doc2.id, doc2.versions[0].id, 300_000);
      const stillFailed = await textState(api, doc.id, v.id);
      check(
        failed.state === "failed" &&
          ready.status === 200 &&
          got.status === 200 &&
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
        originalDownload: got.status,
        engineState: JSON.parse(ps).State,
        newPdfAfterRestore: text2.state,
        earlierFailedRecordNow: stillFailed,
      };
    },
  );
};

phases["diag-providers"] = async () => {
  const p = PROJECTS.upgrade;
  await step(
    {
      scenario: "V-C48",
      article: T,
      role: "administrator",
      method: "browser-walkthrough",
      action:
        "External providers: Signing updates mode and AI Test connection controls exist (no provider access)",
      critical: false,
    },
    async () => {
      const s = await browserSignIn(p, state.people.admin.email, secrets.fixture.admin);
      const out = {};
      const signing = await s.request("GET", "/api/v1/signing-connectors/docusign");
      out.signingConnectorApi = signing.status;
      await s.page.goto(`${p.base}/settings`, { waitUntil: "networkidle" });
      const links = await s.page.getByRole("link").allInnerTexts();
      out.settingsLinks = links.filter((t) => /sign|ai|analysis/i.test(t)).slice(0, 6);
      for (const candidate of ["/settings/integrations/e-signature"]) {
        await s.page.goto(`${p.base}${candidate}`, { waitUntil: "networkidle" });
        const provider = s.page.getByRole("button", { name: "DocuSign" });
        if (await provider.isVisible({ timeout: 10_000 }).catch(() => false))
          await provider.click();
        const select = s.page.getByLabel("Signing updates");
        if (await select.isVisible({ timeout: 10_000 }).catch(() => false)) {
          out.signingPage = candidate;
          const options = await s.page.locator("#ds-update-mode option").allInnerTexts();
          out.polling = options.includes("Polling");
          out.webhook = options.includes("Webhook");
          await select.selectOption("polling");
          out.pollingHint = (await s.page.locator("#ds-update-mode-hint").innerText()).slice(
            0,
            200,
          );
          await select.selectOption("webhook");
          out.webhookHint = (await s.page.locator("#ds-update-mode-hint").innerText()).slice(
            0,
            200,
          );
          break;
        }
      }
      for (const candidate of ["/settings/ai-analysis"]) {
        await s.page.goto(`${p.base}${candidate}`, { waitUntil: "networkidle" });
        if (
          await s.page
            .getByRole("button", { name: /Test connection/i })
            .first()
            .isVisible()
            .catch(() => false)
        ) {
          out.aiPage = candidate;
          out.testConnection = true;
          break;
        }
      }
      await s.context.close();
      check(out.signingPage && out.polling && out.webhook, JSON.stringify(out));
      return out;
    },
  );
};

phases["portal-reach"] = async () => {
  const p = PROJECTS[process.argv[3] ?? "upgrade"];
  const inv = state.inventory;
  const conf = inv.contracts.find((c) => c.isConfidential);
  await step(
    {
      scenario: p.name === "restore" ? "V-C47" : "V-C46",
      article: p.name === "restore" ? "backup-and-restore" : "upgrade",
      role: "business_user",
      method: "browser-walkthrough",
      action: `${p.name}: former Contributor (now Business User) portal reach; Confidential Contract stays refused`,
      critical: false,
    },
    async () => {
      const s = await browserSignIn(p, state.people.contributor.email, secrets.fixture.contributor);
      const portalReach = {};
      for (const c of inv.contracts)
        portalReach[c.number] = (
          await s.request("GET", `/api/v1/portal/contracts/${c.number}`)
        ).status;
      const listed = (await s.request("GET", "/api/v1/portal/contracts")).body;
      await s.context.close();
      check(portalReach[conf.number] !== 200, `portal Confidential ${portalReach[conf.number]}`);
      return {
        role: s.role,
        baselineStaffReach: inv.baselineReach.contributor,
        portalReach,
        portalListCount: listed?.contracts?.length ?? null,
      };
    },
  );
};

phases["diag-log-scan"] = async () => {
  await step(
    {
      scenario: "V-C48",
      article: T,
      action:
        "Negative: container logs after every induced fault omit keys, relay and storage credentials, and fixture passwords",
      critical: false,
    },
    () => {
      const out = {};
      const values = secretValues().filter((v) => !/^short-/.test(v));
      for (const p of Object.values(PROJECTS)) {
        if (!existsSync(path.join(p.dir, ".env"))) continue;
        const logs = sh("docker compose logs --no-log-prefix app worker doc-engine", p.dir, {
          timeout: 120_000,
        }).stdout;
        const hits = values.filter((v) => logs.includes(v)).length;
        const relayUrl = /smtps?:\/\/[^\s"]*:[^\s"@]+@/.test(logs);
        out[p.project] = {
          logLines: logs.split("\n").length,
          secretValuesChecked: values.length,
          hits,
          relayUrlWithCredentials: relayUrl,
        };
        check(hits === 0 && !relayUrl, `${p.project}: ${hits} secret values in logs`);
      }
      return out;
    },
  );
};

phases["status"] = async () => {
  for (const p of Object.values(PROJECTS)) {
    if (!existsSync(p.dir)) continue;
    console.log(p.project, JSON.stringify(containerIds(p)), JSON.stringify(imageIds(p)));
  }
};

phases["destroy"] = async () => {
  await step(
    {
      scenario: "teardown",
      action: "Destroy owned projects, support containers, networks and private backups",
    },
    () => {
      const out = [];
      for (const p of Object.values(PROJECTS)) {
        if (existsSync(path.join(p.dir, ".env"))) {
          const r = sh(`docker compose -p ${p.project} down -v --remove-orphans`, p.dir, {
            timeout: 300_000,
          });
          out.push(`${p.project} down -v exit ${r.code}`);
        }
      }
      for (const c of [MAIL_NAME, MINIO_NAME])
        out.push(`${c} rm exit ${sh(`docker rm -f ${c}`, root).code}`);
      for (const p of Object.values(PROJECTS))
        for (const n of ["openlaw-backend", "openlaw-doc-engine"]) {
          const name = `${p.project}_${n}`;
          if (sh(`docker network inspect ${name}`, root).code === 0)
            out.push(`${name} rm exit ${sh(`docker network rm ${name}`, root).code}`);
        }
      const left = sh(
        `docker ps -a --filter label=com.docker.compose.project --format '{{.Names}}' | grep -c '^${PREFIX}-' || true`,
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
  console.error(`Usage: walkthrough-r1.mjs ${Object.keys(phases).join("|")}`);
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
